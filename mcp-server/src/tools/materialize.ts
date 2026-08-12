import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { optBool, optString, type ServerContext, type ToolDefinition } from "../helpers.js";

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

function recordReadback(
  ctx: ServerContext,
  outputDir: string,
  mode: "readback" | "clean-publish",
  summary: Summary,
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
  const runId = `projection-${randomUUID()}`;
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
        currentSha(ctx),
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
): Summary {
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
  const projectionRunId = recordReadback(ctx, outputDir, recordMode, summary);
  if (projectionRunId) summary.projection_run_id = projectionRunId;
  return summary;
}

export const materializeTools: ToolDefinition[] = [
  {
    name: "materialize_docs",
    description:
      "Render the conspectus and read the finished projection back on independent state, coverage, and content axes. clean_publish=true renders in isolation and promotes only when every axis is green; a red run leaves the previous output untouched and records mismatches without altering durable truth.",
    inputSchema: {
      type: "object",
      properties: {
        output_dir: { type: "string" },
        force_full: { type: "boolean" },
        clean_publish: { type: "boolean" },
        verify_readback: { type: "boolean" },
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
      const cliArgs: string[] = [];
      if (forceFull) cliArgs.push("--force-full");
      if (cleanPublish) cliArgs.push("--clean-publish");
      if (!verifyReadback) cliArgs.push("--no-verify-readback");
      return execute(ctx, outputDir, cliArgs, cleanPublish ? "clean-publish" : "readback");
    },
  },
  {
    name: "verify_materialized_docs",
    description:
      "Read back an existing projection without rendering or repairing it. Records state, coverage, and content mismatches as an auditable verification run; durable source truth is read-only.",
    inputSchema: {
      type: "object",
      properties: { output_dir: { type: "string" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const outputDir = resolve(
        optString(args, "output_dir") ?? join(ctx.project.storagePath, "docs"),
      );
      return execute(ctx, outputDir, ["--readback-only"], "readback");
    },
  },
];
