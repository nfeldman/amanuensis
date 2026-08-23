import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  optBool,
  optString,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function findMaterializer(): string | null {
  const envOverride = process.env.AMANUENSIS_MATERIALIZER;
  if (envOverride && existsSync(envOverride)) return envOverride;
  const candidates = [
    join(moduleDir, "..", "..", "..", "materializer", "materialize.py"),
    join(moduleDir, "..", "..", "materializer", "materialize.py"),
    join(moduleDir, "..", "materializer", "materialize.py"),
  ].map((p) => resolve(p));
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return null;
}

interface Mismatch {
  axis: "state" | "coverage" | "content";
  object_type: string;
  object_id: string;
  detail: string;
}

interface Readback {
  ok: boolean;
  axes: {
    state: { ok: boolean };
    coverage: { ok: boolean };
    content: { ok: boolean };
  };
  mismatch_count: number;
  mismatches: Mismatch[];
}

type Summary = Record<string, unknown> & {
  ok?: boolean;
  mode?: string;
  readback?: Readback | null;
  axes?: Readback["axes"];
  mismatches?: Mismatch[];
  mismatch_count?: number;
};

function parseSummary(stdout: string): Summary | null {
  const last = stdout.trim().split("\n").filter(Boolean).pop();
  if (!last) return null;
  try {
    return JSON.parse(last) as Summary;
  } catch {
    return null;
  }
}

function currentSha(ctx: ServerContext): string | null {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ctx.project.workspacePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

function preflightVerificationIdentity(
  ctx: ServerContext,
  outputDir: string,
  mode: "readback" | "clean-publish",
  requestedRunId: string | null,
): void {
  if (!requestedRunId) return;
  const existing = ctx.db
    .prepare("SELECT output_dir, mode, source_sha FROM projection_verification_runs WHERE run_id=?")
    .get(requestedRunId) as
    | { output_dir: string; mode: string; source_sha: string | null }
    | undefined;
  if (
    existing &&
    (existing.output_dir !== outputDir ||
      existing.mode !== mode ||
      existing.source_sha !== currentSha(ctx))
  ) {
    throw new ToolError(
      `verification_run_id ${requestedRunId} is already bound to a different projection proof`,
    );
  }
}

function recordReadback(
  ctx: ServerContext,
  outputDir: string,
  mode: "readback" | "clean-publish",
  summary: Summary,
  requestedRunId: string | null,
): string | null {
  const readback: Readback | null = summary.readback
    ? summary.readback
    : summary.axes
      ? {
          ok: summary.ok === true,
          axes: summary.axes,
          mismatch_count: summary.mismatch_count ?? summary.mismatches?.length ?? 0,
          mismatches: summary.mismatches ?? [],
        }
      : null;
  if (!readback) return null;
  const runId = requestedRunId ?? `projection-${randomUUID()}`;
  const sourceSha = currentSha(ctx);
  const existing = ctx.db
    .prepare(
      `SELECT output_dir, mode, source_sha, state_ok, coverage_ok, content_ok,
              ok, summary_json
         FROM projection_verification_runs WHERE run_id=?`,
    )
    .get(runId) as
    | {
        output_dir: string;
        mode: string;
        source_sha: string | null;
        state_ok: number;
        coverage_ok: number;
        content_ok: number;
        ok: number;
        summary_json: string;
      }
    | undefined;
  if (existing) {
    const sameProof =
      existing.output_dir === outputDir &&
      existing.mode === mode &&
      existing.source_sha === sourceSha &&
      existing.state_ok === (readback.axes.state.ok ? 1 : 0) &&
      existing.coverage_ok === (readback.axes.coverage.ok ? 1 : 0) &&
      existing.content_ok === (readback.axes.content.ok ? 1 : 0) &&
      existing.ok === (readback.ok ? 1 : 0) &&
      existing.summary_json === JSON.stringify(readback);
    if (!sameProof) {
      throw new ToolError(
        `verification_run_id ${runId} is already bound to a different projection proof`,
      );
    }
    return runId;
  }
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO projection_verification_runs
           (run_id, output_dir, mode, source_sha, state_ok, coverage_ok,
            content_ok, ok, summary_json, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        outputDir,
        mode,
        sourceSha,
        readback.axes.state.ok ? 1 : 0,
        readback.axes.coverage.ok ? 1 : 0,
        readback.axes.content.ok ? 1 : 0,
        readback.ok ? 1 : 0,
        JSON.stringify(readback),
        ctx.sessionId,
      );
    const insert = ctx.db.prepare(
      `INSERT INTO projection_mismatches
         (run_id, axis, object_type, object_id, detail)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const mismatch of readback.mismatches) {
      insert.run(runId, mismatch.axis, mismatch.object_type, mismatch.object_id, mismatch.detail);
    }
  })();
  return runId;
}

function execute(
  ctx: ServerContext,
  outputDir: string,
  extraArgs: string[],
  recordMode: "readback" | "clean-publish",
  verificationRunId: string | null,
): Summary {
  preflightVerificationIdentity(ctx, outputDir, recordMode, verificationRunId);
  const script = findMaterializer();
  if (!script) {
    return {
      ok: false,
      error:
        "materializer not found; set AMANUENSIS_MATERIALIZER or install it next to mcp-server/",
    };
  }
  const py = process.env.AMANUENSIS_PYTHON ?? "python3";
  const result = spawnSync(
    py,
    [script, "--storage", ctx.project.storagePath, "--output", outputDir, ...extraArgs],
    { encoding: "utf8" },
  );
  if (result.error)
    return { ok: false, error: `materializer failed to start: ${result.error.message}` };
  const summary = parseSummary(result.stdout || "");
  if (!summary) {
    return {
      ok: false,
      error: `materializer exited ${result.status}: ${result.stderr?.trim() || result.stdout?.trim() || "no JSON summary"}`,
    };
  }
  summary.exit_status = result.status;
  if (result.stderr?.trim()) summary.stderr = result.stderr.trim();
  const projectionRunId = recordReadback(ctx, outputDir, recordMode, summary, verificationRunId);
  if (projectionRunId) summary.projection_run_id = projectionRunId;
  return summary;
}

export const materializeTools: ToolDefinition[] = [
  {
    name: "materialize_docs",
    description:
      "Render synchronized self-contained HTML and Markdown conspectus views, returning html_entrypoint as the primary human reading surface, then read both formats back independently on state, coverage, and content axes. clean_publish=true renders in isolation and promotes only when every axis is green; a red run leaves the previous output untouched and records mismatches without altering durable truth.",
    inputSchema: {
      type: "object",
      properties: {
        output_dir: { type: "string" },
        force_full: { type: "boolean" },
        clean_publish: { type: "boolean" },
        verify_readback: { type: "boolean" },
        verification_run_id: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const outputDir = resolve(
        optString(args, "output_dir") ?? join(ctx.project.storagePath, "docs"),
      );
      const forceFull = optBool(args, "force_full", false);
      const cleanPublish = optBool(args, "clean_publish", false);
      const verifyReadback = optBool(args, "verify_readback", true);
      const verificationRunId = optString(args, "verification_run_id");
      const cliArgs: string[] = [];
      if (forceFull) cliArgs.push("--force-full");
      if (cleanPublish) cliArgs.push("--clean-publish");
      if (!verifyReadback) cliArgs.push("--no-verify-readback");
      return execute(
        ctx,
        outputDir,
        cliArgs,
        cleanPublish ? "clean-publish" : "readback",
        verificationRunId,
      );
    },
  },
  {
    name: "verify_materialized_docs",
    description:
      "Read back existing HTML and Markdown projections without rendering or repairing them. Records state, coverage, and content mismatches as an auditable verification run and returns the HTML entrypoint; durable source truth is read-only.",
    inputSchema: {
      type: "object",
      properties: {
        output_dir: { type: "string" },
        verification_run_id: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const outputDir = resolve(
        optString(args, "output_dir") ?? join(ctx.project.storagePath, "docs"),
      );
      return execute(
        ctx,
        outputDir,
        ["--readback-only"],
        "readback",
        optString(args, "verification_run_id"),
      );
    },
  },
];
