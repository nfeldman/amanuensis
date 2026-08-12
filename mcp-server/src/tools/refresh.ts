import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  optBool,
  optInt,
  optString,
  optStringArray,
  requireEnum,
  requireInt,
  requireString,
  requireStringArray,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";
import { impactTools } from "./impact.js";
import { materializeTools } from "./materialize.js";
import { resolutionTools } from "./resolution.js";
import { revalidationTools } from "./revalidation.js";

const DETERMINISM_MODES = ["provider-default", "seeded", "local-deterministic"] as const;
const DISCOVERY_MODES = ["explicit-only", "request-if-gap"] as const;
const AUTHORITY_MODES = ["observe-only", "conspectus-write", "branch-write"] as const;
const SIDE_EFFECTS = [
  "analysis-api-call",
  "conspectus-write",
  "branch-write",
  "external-message",
  "deploy",
  "merge",
  "decision-acceptance",
] as const;
const FAILURE_STATUSES = ["failed", "timed-out"] as const;
const SCORE_VERDICTS = ["accepted", "rejected", "inconclusive"] as const;
const RESOLUTION_OUTCOMES = ["revalidated", "retired", "no-change", "needs-more-work"] as const;
const CRASH_POINTS = [
  "after-impact-predict",
  "after-impact-apply",
  "after-revalidation-plan",
  "after-dispatch",
  "after-readback",
] as const;

type CrashPoint = (typeof CRASH_POINTS)[number];

interface RefreshRun {
  run_id: string;
  replicate_id: string;
  status: string;
  base_sha: string;
  head_sha: string;
  allowed_sources: string;
  provider_allowlist: string;
  selected_provider: string;
  model: string;
  runtime: string;
  determinism_mode: (typeof DETERMINISM_MODES)[number];
  determinism_seed: number | null;
  runtime_input_json: string;
  relation_discovery_mode: (typeof DISCOVERY_MODES)[number];
  max_relation_depth: number;
  authority_mode: (typeof AUTHORITY_MODES)[number];
  allowed_write_prefixes: string;
  allowed_side_effects: string;
  auto_dispatch: number;
  max_concurrency: number;
  max_attempts_per_obligation: number;
  max_tokens_per_attempt: number;
  max_total_tokens: number;
  max_total_cost_microusd: number;
  planned_tokens_per_attempt: number;
  planned_cost_microusd: number;
  output_dir: string;
  manifest_json: string;
  manifest_hash: string;
  impact_run_id: string;
  revalidation_run_id: string | null;
  projection_run_id: string | null;
  blocking_reasons_json: string;
  session_id: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
}

function git(ctx: ServerContext, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("git", args, {
    cwd: ctx.project.workspacePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveCommit(ctx: ServerContext, requested: string): string {
  const result = git(ctx, ["rev-parse", "--verify", `${requested}^{commit}`]);
  const sha = result.stdout?.toString().trim() ?? "";
  if (result.status !== 0 || !sha) throw new ToolError(`unknown git commit: ${requested}`);
  return sha;
}

function requireAncestor(ctx: ServerContext, baseSha: string, headSha: string): void {
  const result = git(ctx, ["merge-base", "--is-ancestor", baseSha, headSha]);
  if (result.status === 0) return;
  if (result.status === 1)
    throw new ToolError(`base_sha ${baseSha} must be an ancestor of ${headSha}`);
  throw new ToolError(`cannot compare refresh commits: ${result.stderr?.toString().trim()}`);
}

function positive(value: number, name: string): number {
  if (value <= 0) throw new ToolError(`${name} must be greater than zero`);
  return value;
}

function nonNegative(value: number, name: string): number {
  if (value < 0) throw new ToolError(`${name} must be non-negative`);
  return value;
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith("../"));
}

function isWithinStorage(root: string, candidate: string): boolean {
  if (!isWithin(root, candidate)) return false;
  let existing = candidate;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return false;
    existing = parent;
  }
  return isWithin(realpathSync(root), realpathSync(existing));
}

function normalizePrefixes(values: string[], name: string, allowEmpty = false): string[] {
  const normalized = [...new Set(values.map((value) => value.replace(/^\.\//, "")))].sort();
  if (!allowEmpty && normalized.length === 0) throw new ToolError(`${name} must not be empty`);
  for (const value of normalized) {
    if (!value || value.startsWith("/") || value.split("/").includes("..")) {
      throw new ToolError(`${name} must contain relative, non-traversing paths`);
    }
  }
  return normalized;
}

function invoke(
  definitions: ToolDefinition[],
  name: string,
  args: Record<string, unknown>,
  ctx: ServerContext,
): unknown {
  const tool = definitions.find((candidate) => candidate.name === name);
  if (!tool) throw new ToolError(`internal refresh dependency missing: ${name}`);
  return tool.handler(args, ctx);
}

function getRun(ctx: ServerContext, runId: string): RefreshRun {
  const row = ctx.db.prepare("SELECT * FROM refresh_runs WHERE run_id=?").get(runId) as
    | RefreshRun
    | undefined;
  if (!row) throw new ToolError(`unknown refresh run: ${runId}`);
  return row;
}

function requireResultRun(ctx: ServerContext, runId: string): RefreshRun {
  const run = getRun(ctx, runId);
  if (!["revalidation-planned", "executing"].includes(run.status)) {
    throw new ToolError(
      `refresh run ${runId} does not accept provider results while ${run.status}`,
    );
  }
  return run;
}

function recordStage(
  ctx: ServerContext,
  runId: string,
  stage: string,
  eventType: "completed" | "adopted" | "blocked" | "failed" | "cancelled",
  idempotencyKey: string,
  detail: Record<string, unknown>,
): void {
  ctx.db
    .prepare(
      `INSERT OR IGNORE INTO refresh_stage_events
         (run_id, stage, event_type, idempotency_key, detail_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(runId, stage, eventType, idempotencyKey, JSON.stringify(detail));
}

function setStatus(
  ctx: ServerContext,
  runId: string,
  status: string,
  values: {
    error?: string | null;
    revalidationRunId?: string | null;
    projectionRunId?: string | null;
  } = {},
): void {
  ctx.db
    .prepare(
      `UPDATE refresh_runs
          SET status=?, error=?,
              revalidation_run_id=COALESCE(?, revalidation_run_id),
              projection_run_id=COALESCE(?, projection_run_id),
              updated_at=datetime('now'),
              completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END
        WHERE run_id=?`,
    )
    .run(
      status,
      values.error ?? null,
      values.revalidationRunId ?? null,
      values.projectionRunId ?? null,
      status,
      runId,
    );
}

function maybeCrash(requested: CrashPoint | null, point: CrashPoint): void {
  if (requested === point) {
    throw new ToolError(`simulated refresh crash at ${point}`);
  }
}

function runtimeRoute(run: RefreshRun): string {
  if (run.determinism_mode === "seeded") return `${run.runtime}:provider-seeded`;
  if (run.determinism_mode === "local-deterministic") return `${run.runtime}:local-deterministic`;
  return `${run.runtime}:provider-default`;
}

function adoptAttempts(ctx: ServerContext, run: RefreshRun): number {
  if (!run.revalidation_run_id) return 0;
  const attempts = ctx.db
    .prepare(
      `SELECT attempt_id, obligation_id, status
         FROM revalidation_attempts WHERE run_id=? ORDER BY dispatched_at, attempt_id`,
    )
    .all(run.revalidation_run_id) as Array<{
    attempt_id: string;
    obligation_id: string;
    status: string;
  }>;
  const insert = ctx.db.prepare(
    `INSERT INTO refresh_dispatches
       (run_id, obligation_id, attempt_id, runtime_route, runtime_input_json, status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, attempt_id) DO UPDATE SET
       status=excluded.status, updated_at=datetime('now')`,
  );
  for (const attempt of attempts) {
    insert.run(
      run.run_id,
      attempt.obligation_id,
      attempt.attempt_id,
      runtimeRoute(run),
      run.runtime_input_json,
      attempt.status,
    );
  }
  return attempts.length;
}

function dispatchReady(ctx: ServerContext, run: RefreshRun, crashAfter: CrashPoint | null): number {
  if (!run.revalidation_run_id || run.auto_dispatch !== 1) return 0;
  adoptAttempts(ctx, run);
  const active = ctx.db
    .prepare(
      "SELECT COUNT(*) AS n FROM revalidation_attempts WHERE run_id=? AND status='dispatched'",
    )
    .get(run.revalidation_run_id) as { n: number };
  let slots = Math.max(0, run.max_concurrency - active.n);
  if (slots === 0) return 0;
  const obligations = ctx.db
    .prepare(
      `SELECT rro.ordinal, rro.obligation_id, o.state,
              COUNT(a.attempt_id) AS attempt_count,
              MAX(CASE WHEN a.status IN ('dispatched','landed') THEN 1 ELSE 0 END) AS active_attempt
         FROM revalidation_run_obligations rro
         JOIN revalidation_obligations o ON o.obligation_id=rro.obligation_id
         LEFT JOIN revalidation_attempts a
           ON a.run_id=rro.run_id AND a.obligation_id=rro.obligation_id
        WHERE rro.run_id=? AND json_extract(rro.work_packet, '$.dispatchable')=1
        GROUP BY rro.ordinal, rro.obligation_id, o.state
        ORDER BY rro.ordinal`,
    )
    .all(run.revalidation_run_id) as Array<{
    ordinal: number;
    obligation_id: string;
    state: string;
    attempt_count: number;
    active_attempt: number;
  }>;
  let dispatched = 0;
  for (const obligation of obligations) {
    if (slots === 0) break;
    if (obligation.state === "closed" || obligation.active_attempt === 1) continue;
    if (!["ready", "open"].includes(obligation.state)) continue;
    const attemptNumber = obligation.attempt_count + 1;
    if (attemptNumber > run.max_attempts_per_obligation) continue;
    const attemptId = `${run.run_id}:attempt:${obligation.ordinal}:${attemptNumber}`;
    const existed = !!ctx.db
      .prepare("SELECT 1 FROM revalidation_attempts WHERE attempt_id=?")
      .get(attemptId);
    if (!existed) {
      invoke(
        revalidationTools,
        "dispatch_revalidation_attempt",
        {
          run_id: run.revalidation_run_id,
          obligation_id: obligation.obligation_id,
          attempt_id: attemptId,
          replicate_id: run.replicate_id,
          attempt_number: attemptNumber,
          worker_id: `refresh:${run.run_id}`,
          provider: run.selected_provider,
          model: run.model,
          planned_tokens: run.planned_tokens_per_attempt,
          planned_cost_microusd: run.planned_cost_microusd,
        },
        ctx,
      );
      maybeCrash(crashAfter, "after-dispatch");
    }
    ctx.db
      .prepare(
        `INSERT OR IGNORE INTO refresh_dispatches
           (run_id, obligation_id, attempt_id, runtime_route, runtime_input_json, status)
         VALUES (?, ?, ?, ?, ?, 'dispatched')`,
      )
      .run(
        run.run_id,
        obligation.obligation_id,
        attemptId,
        runtimeRoute(run),
        run.runtime_input_json,
      );
    recordStage(
      ctx,
      run.run_id,
      "dispatch",
      existed ? "adopted" : "completed",
      `dispatch:${attemptId}`,
      {
        attempt_id: attemptId,
        obligation_id: obligation.obligation_id,
        runtime_route: runtimeRoute(run),
      },
    );
    dispatched += existed ? 0 : 1;
    slots -= 1;
  }
  return dispatched;
}

function drive(
  ctx: ServerContext,
  runId: string,
  crashAfter: CrashPoint | null,
): Record<string, unknown> {
  requireActiveSession(ctx, "execute_refresh_run");
  let run = getRun(ctx, runId);
  if (["blocked", "cancelled", "failed"].includes(run.status)) {
    throw new ToolError(`refresh run ${runId} is ${run.status}`);
  }
  if (run.status === "completed") return readRun(ctx, runId);

  let impact = ctx.db
    .prepare("SELECT status FROM change_impact_runs WHERE run_id=?")
    .get(run.impact_run_id) as { status: string } | undefined;
  if (!impact) {
    invoke(
      impactTools,
      "predict_change_impact",
      {
        base_sha: run.base_sha,
        head_sha: run.head_sha,
        run_id: run.impact_run_id,
        max_depth: run.max_relation_depth,
        relation_discovery: run.relation_discovery_mode,
      },
      ctx,
    );
    maybeCrash(crashAfter, "after-impact-predict");
    impact = { status: "predicted" };
    recordStage(ctx, runId, "impact-predict", "completed", "impact-predict", {
      impact_run_id: run.impact_run_id,
    });
  } else {
    recordStage(ctx, runId, "impact-predict", "adopted", "impact-predict", {
      impact_run_id: run.impact_run_id,
    });
  }
  setStatus(ctx, runId, "impact-predicted");

  if (impact.status === "predicted") {
    invoke(
      impactTools,
      "apply_change_impact",
      { run_id: run.impact_run_id, reason: `unattended refresh ${runId}` },
      ctx,
    );
    maybeCrash(crashAfter, "after-impact-apply");
    recordStage(ctx, runId, "impact-apply", "completed", "impact-apply", {
      impact_run_id: run.impact_run_id,
    });
  } else {
    recordStage(ctx, runId, "impact-apply", "adopted", "impact-apply", {
      impact_run_id: run.impact_run_id,
    });
  }
  setStatus(ctx, runId, "impact-applied");

  const invalidations = ctx.db
    .prepare(
      "SELECT COUNT(*) AS n FROM change_impact_invalidations WHERE run_id=? AND state='applied'",
    )
    .get(run.impact_run_id) as { n: number };
  if (invalidations.n > 0) {
    const revalidationRunId = run.revalidation_run_id ?? `${runId}:revalidation`;
    const existingRevalidation = ctx.db
      .prepare("SELECT status FROM revalidation_runs WHERE run_id=?")
      .get(revalidationRunId) as { status: string } | undefined;
    if (!existingRevalidation) {
      invoke(
        revalidationTools,
        "plan_revalidation_run",
        {
          run_id: revalidationRunId,
          impact_run_id: run.impact_run_id,
          allowed_sources: JSON.parse(run.allowed_sources),
          provider_allowlist: JSON.parse(run.provider_allowlist),
          authority_mode: run.authority_mode,
          allowed_write_prefixes: JSON.parse(run.allowed_write_prefixes),
          max_concurrency: run.max_concurrency,
          max_attempts_per_obligation: run.max_attempts_per_obligation,
          max_tokens_per_attempt: run.max_tokens_per_attempt,
          max_total_tokens: run.max_total_tokens,
          max_total_cost_microusd: run.max_total_cost_microusd,
        },
        ctx,
      );
      maybeCrash(crashAfter, "after-revalidation-plan");
      recordStage(ctx, runId, "revalidation-plan", "completed", "revalidation-plan", {
        revalidation_run_id: revalidationRunId,
      });
    } else {
      recordStage(ctx, runId, "revalidation-plan", "adopted", "revalidation-plan", {
        revalidation_run_id: revalidationRunId,
      });
    }
    setStatus(ctx, runId, "revalidation-planned", { revalidationRunId });
    run = getRun(ctx, runId);
    dispatchReady(ctx, run, crashAfter);
    setStatus(ctx, runId, "executing");
    const reconciliation = invoke(
      revalidationTools,
      "reconcile_revalidation_run",
      { run_id: revalidationRunId },
      ctx,
    ) as { complete: boolean; status: string; diagnostics: Record<string, unknown> };
    recordStage(ctx, runId, "reconcile", "completed", `reconcile:${reconciliation.status}`, {
      complete: reconciliation.complete,
      status: reconciliation.status,
      diagnostics: reconciliation.diagnostics,
    });
    if (!reconciliation.complete) {
      if (reconciliation.status === "failed") {
        setStatus(ctx, runId, "failed", { error: "revalidation reconciliation failed" });
      }
      return readRun(ctx, runId);
    }
  }

  setStatus(ctx, runId, "verifying");
  const audit = invoke(resolutionTools, "audit_resolution_invariants", {}, ctx) as {
    ok: boolean;
    violations: unknown[];
  };
  if (!audit.ok) {
    recordStage(ctx, runId, "readback", "blocked", "resolution-audit", {
      violations: audit.violations,
    });
    setStatus(ctx, runId, "blocked", { error: "resolution invariant audit is red" });
    return readRun(ctx, runId);
  }

  const projectionRunId = `projection:${runId}:final`;
  const existingProjection = ctx.db
    .prepare(
      `SELECT ok, state_ok, coverage_ok, content_ok, output_dir, mode, source_sha
         FROM projection_verification_runs WHERE run_id=?`,
    )
    .get(projectionRunId) as
    | {
        ok: number;
        state_ok: number;
        coverage_ok: number;
        content_ok: number;
        output_dir: string;
        mode: string;
        source_sha: string | null;
      }
    | undefined;
  if (!existingProjection) {
    const materialized = invoke(
      materializeTools,
      "materialize_docs",
      {
        output_dir: run.output_dir,
        clean_publish: true,
        verify_readback: true,
        verification_run_id: projectionRunId,
      },
      ctx,
    ) as { ok?: boolean; published?: boolean; error?: string };
    if (!materialized.ok || !materialized.published) {
      recordStage(ctx, runId, "readback", "blocked", "projection-readback", materialized);
      setStatus(ctx, runId, "blocked", {
        error: materialized.error ?? "projection read-back is red",
      });
      return readRun(ctx, runId);
    }
    maybeCrash(crashAfter, "after-readback");
    recordStage(ctx, runId, "readback", "completed", "projection-readback", {
      projection_run_id: projectionRunId,
    });
  }
  const projection = ctx.db
    .prepare(
      `SELECT ok, state_ok, coverage_ok, content_ok, output_dir, mode, source_sha
         FROM projection_verification_runs WHERE run_id=?`,
    )
    .get(projectionRunId) as {
    ok: number;
    state_ok: number;
    coverage_ok: number;
    content_ok: number;
    output_dir: string;
    mode: string;
    source_sha: string | null;
  };
  const projectionBound =
    projection &&
    projection.ok === 1 &&
    projection.state_ok === 1 &&
    projection.coverage_ok === 1 &&
    projection.content_ok === 1 &&
    projection.output_dir === run.output_dir &&
    projection.mode === "clean-publish" &&
    projection.source_sha === run.head_sha;
  if (!projectionBound) {
    recordStage(ctx, runId, "readback", "blocked", "projection-binding", {
      projection_run_id: projectionRunId,
      expected_output_dir: run.output_dir,
      expected_source_sha: run.head_sha,
      observed: projection ?? null,
    });
    setStatus(ctx, runId, "blocked", {
      error: "durable projection verification is red or bound to different source state",
      projectionRunId,
    });
    return readRun(ctx, runId);
  }
  if (existingProjection) {
    recordStage(ctx, runId, "readback", "adopted", "projection-readback", {
      projection_run_id: projectionRunId,
    });
  }
  recordStage(ctx, runId, "complete", "completed", "complete", {
    impact_run_id: run.impact_run_id,
    revalidation_run_id: run.revalidation_run_id,
    projection_run_id: projectionRunId,
    completion_basis: "durable-reconciliation-and-readback",
  });
  setStatus(ctx, runId, "completed", { projectionRunId });
  return readRun(ctx, runId);
}

function readRun(ctx: ServerContext, runId: string): Record<string, unknown> {
  const run = getRun(ctx, runId);
  const events = ctx.db
    .prepare("SELECT * FROM refresh_stage_events WHERE run_id=? ORDER BY id")
    .all(runId)
    .map((row) => {
      const typed = row as Record<string, unknown> & { detail_json: string };
      const { detail_json: detailJson, ...rest } = typed;
      return { ...rest, detail: JSON.parse(detailJson) };
    });
  const dispatches = ctx.db
    .prepare(
      `SELECT rd.*, a.attempt_number, a.provider, a.model,
              a.actual_tokens, a.actual_cost_microusd
         FROM refresh_dispatches rd
         JOIN revalidation_attempts a ON a.attempt_id=rd.attempt_id
        WHERE rd.run_id=? ORDER BY rd.created_at, rd.attempt_id`,
    )
    .all(runId)
    .map((row) => {
      const typed = row as Record<string, unknown> & { runtime_input_json: string };
      const { runtime_input_json: runtimeInput, ...rest } = typed;
      return { ...rest, runtime_input: JSON.parse(runtimeInput) };
    });
  const projection = run.projection_run_id
    ? ctx.db
        .prepare("SELECT * FROM projection_verification_runs WHERE run_id=?")
        .get(run.projection_run_id)
    : null;
  const revalidation = run.revalidation_run_id
    ? ctx.db.prepare("SELECT * FROM revalidation_runs WHERE run_id=?").get(run.revalidation_run_id)
    : null;
  const { manifest_json: manifestJson, blocking_reasons_json: blockingJson, ...columns } = run;
  return {
    ...columns,
    manifest: JSON.parse(manifestJson),
    blocking_reasons: JSON.parse(blockingJson),
    events,
    dispatches,
    revalidation,
    projection,
    completion_basis: run.status === "completed" ? "durable-reconciliation-and-readback" : null,
  };
}

export const refreshTools: ToolDefinition[] = [
  {
    name: "plan_refresh_run",
    description:
      "Create an immutable unattended-refresh execution manifest. Pins commit range, source/provider/model/runtime inputs, determinism route, budgets, replicate identity, authority, side-effect envelope, child IDs, and output. Out-of-envelope providers or effects create a durable blocked plan before any dispatch.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        replicate_id: { type: "string" },
        base_sha: { type: "string" },
        head_sha: { type: "string" },
        allowed_sources: { type: "array", items: { type: "string" }, minItems: 1 },
        provider_allowlist: { type: "array", items: { type: "string" }, minItems: 1 },
        selected_provider: { type: "string" },
        model: { type: "string" },
        runtime: { type: "string" },
        determinism_mode: { type: "string", enum: DETERMINISM_MODES },
        determinism_seed: { type: "integer" },
        relation_discovery: { type: "string", enum: DISCOVERY_MODES },
        max_depth: { type: "integer", minimum: 0, maximum: 16 },
        authority_mode: { type: "string", enum: AUTHORITY_MODES },
        allowed_write_prefixes: { type: "array", items: { type: "string" } },
        allowed_side_effects: { type: "array", items: { type: "string", enum: SIDE_EFFECTS } },
        auto_dispatch: { type: "boolean" },
        max_concurrency: { type: "integer", minimum: 1 },
        max_attempts_per_obligation: { type: "integer", minimum: 1 },
        max_tokens_per_attempt: { type: "integer", minimum: 1 },
        max_total_tokens: { type: "integer", minimum: 1 },
        max_total_cost_microusd: { type: "integer", minimum: 0 },
        planned_tokens_per_attempt: { type: "integer", minimum: 1 },
        planned_cost_microusd: { type: "integer", minimum: 0 },
        output_dir: { type: "string" },
      },
      required: [
        "base_sha",
        "head_sha",
        "allowed_sources",
        "provider_allowlist",
        "selected_provider",
        "model",
        "runtime",
        "determinism_mode",
        "authority_mode",
        "allowed_side_effects",
        "max_concurrency",
        "max_attempts_per_obligation",
        "max_tokens_per_attempt",
        "max_total_tokens",
        "max_total_cost_microusd",
        "planned_tokens_per_attempt",
        "planned_cost_microusd",
      ],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "plan_refresh_run");
      const runId = optString(args, "run_id") ?? `refresh-${randomUUID()}`;
      if (ctx.db.prepare("SELECT 1 FROM refresh_runs WHERE run_id=?").get(runId)) {
        throw new ToolError(`refresh run_id already exists: ${runId}`);
      }
      const replicateId = optString(args, "replicate_id") ?? `replicate-${randomUUID()}`;
      const baseSha = resolveCommit(ctx, requireString(args, "base_sha"));
      const headSha = resolveCommit(ctx, requireString(args, "head_sha"));
      const checkedOutHead = resolveCommit(ctx, "HEAD");
      if (baseSha === headSha) throw new ToolError("refresh range must contain a change");
      requireAncestor(ctx, baseSha, headSha);
      const allowedSources = normalizePrefixes(
        requireStringArray(args, "allowed_sources", { minLength: 1 }),
        "allowed_sources",
      );
      const providers = [
        ...new Set(requireStringArray(args, "provider_allowlist", { minLength: 1 })),
      ]
        .filter(Boolean)
        .sort();
      if (providers.length === 0) throw new ToolError("provider_allowlist must not be empty");
      const selectedProvider = requireString(args, "selected_provider");
      const model = requireString(args, "model");
      const runtime = requireString(args, "runtime");
      const determinismMode = requireEnum(args, "determinism_mode", DETERMINISM_MODES);
      const seed = optInt(args, "determinism_seed");
      if (determinismMode === "seeded" && seed === null) {
        throw new ToolError("seeded determinism requires determinism_seed");
      }
      if (determinismMode !== "seeded" && seed !== null) {
        throw new ToolError("determinism_seed is only valid with seeded determinism");
      }
      const relationDiscovery = requireEnum(
        { relation_discovery: optString(args, "relation_discovery") ?? "explicit-only" },
        "relation_discovery",
        DISCOVERY_MODES,
      );
      const maxDepth = optInt(args, "max_depth", 8) ?? 8;
      if (maxDepth < 0 || maxDepth > 16) throw new ToolError("max_depth must be between 0 and 16");
      const authorityMode = requireEnum(args, "authority_mode", AUTHORITY_MODES);
      const writePrefixes = normalizePrefixes(
        optStringArray(args, "allowed_write_prefixes") ?? [],
        "allowed_write_prefixes",
        true,
      );
      const effects = [
        ...new Set(
          requireStringArray(args, "allowed_side_effects").map((effect) =>
            requireEnum({ effect }, "effect", SIDE_EFFECTS),
          ),
        ),
      ].sort();
      const autoDispatch = optBool(args, "auto_dispatch", true);
      const limits = {
        maxConcurrency: positive(requireInt(args, "max_concurrency"), "max_concurrency"),
        maxAttempts: positive(
          requireInt(args, "max_attempts_per_obligation"),
          "max_attempts_per_obligation",
        ),
        maxTokens: positive(requireInt(args, "max_tokens_per_attempt"), "max_tokens_per_attempt"),
        maxTotalTokens: positive(requireInt(args, "max_total_tokens"), "max_total_tokens"),
        maxCost: nonNegative(
          requireInt(args, "max_total_cost_microusd"),
          "max_total_cost_microusd",
        ),
        plannedTokens: positive(
          requireInt(args, "planned_tokens_per_attempt"),
          "planned_tokens_per_attempt",
        ),
        plannedCost: nonNegative(
          requireInt(args, "planned_cost_microusd"),
          "planned_cost_microusd",
        ),
      };
      const requestedOutput = optString(args, "output_dir");
      const outputDir = requestedOutput
        ? isAbsolute(requestedOutput)
          ? resolve(requestedOutput)
          : resolve(ctx.project.storagePath, requestedOutput)
        : resolve(ctx.project.storagePath, "docs");
      const blockers: string[] = [];
      if (headSha !== checkedOutHead) {
        blockers.push("head_sha must match checked-out HEAD for final projection proof");
      }
      if (!providers.includes(selectedProvider)) {
        blockers.push(`selected provider ${selectedProvider} is outside provider_allowlist`);
      }
      if (!effects.includes("analysis-api-call")) {
        blockers.push("analysis-api-call is not authorized");
      }
      if (!effects.includes("conspectus-write")) {
        blockers.push("conspectus-write is required for final projection read-back");
      }
      for (const forbidden of [
        "external-message",
        "deploy",
        "merge",
        "decision-acceptance",
      ] as const) {
        if (effects.includes(forbidden)) blockers.push(`${forbidden} is outside refresh authority`);
      }
      if (authorityMode !== "observe-only" && writePrefixes.length === 0) {
        blockers.push(`${authorityMode} requires allowed_write_prefixes`);
      }
      if (authorityMode === "observe-only") {
        blockers.push("observe-only authority cannot publish the final conspectus projection");
      }
      if (authorityMode === "branch-write" && !effects.includes("branch-write")) {
        blockers.push("branch-write authority was not included in allowed_side_effects");
      }
      if (authorityMode !== "branch-write" && effects.includes("branch-write")) {
        blockers.push(`branch-write is outside ${authorityMode} authority`);
      }
      if (!isWithinStorage(ctx.project.storagePath, outputDir)) {
        blockers.push("output_dir is outside the project storage boundary");
      }
      if (determinismMode === "local-deterministic" && !runtime.startsWith("local")) {
        blockers.push("local-deterministic mode requires a local runtime route");
      }
      if (limits.plannedTokens > limits.maxTokens) {
        blockers.push("planned_tokens_per_attempt exceeds max_tokens_per_attempt");
      }
      if (limits.plannedTokens > limits.maxTotalTokens || limits.plannedCost > limits.maxCost) {
        blockers.push("one planned attempt exceeds aggregate budget");
      }
      const runtimeInput = {
        provider: selectedProvider,
        model,
        runtime,
        route:
          determinismMode === "seeded"
            ? `${runtime}:provider-seeded`
            : determinismMode === "local-deterministic"
              ? `${runtime}:local-deterministic`
              : `${runtime}:provider-default`,
        request_options: determinismMode === "seeded" ? { seed } : {},
        deterministic_scheduler: determinismMode === "local-deterministic",
      };
      const impactRunId = `${runId}:impact`;
      const manifest = {
        run_id: runId,
        replicate_id: replicateId,
        repository: { base_sha: baseSha, head_sha: headSha },
        source_set: allowedSources,
        provider: { allowlist: providers, selected: selectedProvider, model, runtime },
        determinism: { mode: determinismMode, seed, runtime_input: runtimeInput },
        relation_discovery: { mode: relationDiscovery, max_depth: maxDepth },
        authority: {
          mode: authorityMode,
          allowed_write_prefixes: writePrefixes,
          allowed_side_effects: effects,
          decision_policy: "human-only",
          approval_policy: "preauthorized-envelope",
        },
        budgets: limits,
        auto_dispatch: autoDispatch,
        output_dir: outputDir,
        child_ids: { impact_run_id: impactRunId, revalidation_run_id: `${runId}:revalidation` },
      };
      const manifestJson = JSON.stringify(manifest);
      const manifestHash = createHash("sha256").update(manifestJson).digest("hex");
      const status = blockers.length > 0 ? "blocked" : "planned";
      ctx.db.transaction(() => {
        ctx.db
          .prepare(
            `INSERT INTO refresh_runs
               (run_id, replicate_id, status, base_sha, head_sha, allowed_sources,
                provider_allowlist, selected_provider, model, runtime,
                determinism_mode, determinism_seed, runtime_input_json,
                relation_discovery_mode, max_relation_depth, authority_mode,
                allowed_write_prefixes, allowed_side_effects, auto_dispatch,
                max_concurrency, max_attempts_per_obligation, max_tokens_per_attempt,
                max_total_tokens, max_total_cost_microusd, planned_tokens_per_attempt,
                planned_cost_microusd, output_dir, manifest_json, manifest_hash,
                impact_run_id, blocking_reasons_json, session_id, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            runId,
            replicateId,
            status,
            baseSha,
            headSha,
            JSON.stringify(allowedSources),
            JSON.stringify(providers),
            selectedProvider,
            model,
            runtime,
            determinismMode,
            seed,
            JSON.stringify(runtimeInput),
            relationDiscovery,
            maxDepth,
            authorityMode,
            JSON.stringify(writePrefixes),
            JSON.stringify(effects),
            autoDispatch ? 1 : 0,
            limits.maxConcurrency,
            limits.maxAttempts,
            limits.maxTokens,
            limits.maxTotalTokens,
            limits.maxCost,
            limits.plannedTokens,
            limits.plannedCost,
            outputDir,
            manifestJson,
            manifestHash,
            impactRunId,
            JSON.stringify(blockers),
            sessionId,
            blockers.length > 0 ? blockers.join("; ") : null,
          );
        recordStage(ctx, runId, "plan", blockers.length > 0 ? "blocked" : "completed", "plan", {
          manifest_hash: manifestHash,
          blockers,
        });
      })();
      return readRun(ctx, runId);
    },
  },
  {
    name: "execute_refresh_run",
    description:
      "Advance a planned refresh idempotently through impact prediction/application, revalidation planning, bounded automatic dispatch, durable reconciliation, clean publication read-back, and completion. simulation_crash_after is a validation fault injector; deterministic child identities let resume adopt landed work.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        simulation_crash_after: { type: "string", enum: CRASH_POINTS },
      },
      required: ["run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const runId = requireString(args, "run_id");
      const crash = optString(args, "simulation_crash_after");
      if (crash !== null && !CRASH_POINTS.includes(crash as CrashPoint)) {
        throw new ToolError(`unknown simulation_crash_after: ${crash}`);
      }
      return drive(ctx, runId, crash as CrashPoint | null);
    },
  },
  {
    name: "resume_refresh_run",
    description:
      "Resume an interrupted refresh by adopting deterministic child runs and attempts, then advancing from durable state. No worker success message is treated as completion.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => drive(ctx, requireString(args, "run_id"), null),
  },
  {
    name: "cancel_refresh_run",
    description:
      "Cancel a nonterminal refresh. Dispatched attempts are retained as failed history, their unfinished obligations return to ready, and no claim or obligation is marked resolved.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" }, reason: { type: "string" } },
      required: ["run_id", "reason"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "cancel_refresh_run");
      const runId = requireString(args, "run_id");
      const reason = requireString(args, "reason");
      const run = getRun(ctx, runId);
      if (["completed", "cancelled", "failed"].includes(run.status)) {
        throw new ToolError(`refresh run ${runId} is already ${run.status}`);
      }
      ctx.db.transaction(() => {
        if (run.revalidation_run_id) {
          adoptAttempts(ctx, run);
          const dispatched = ctx.db
            .prepare(
              "SELECT attempt_id, obligation_id FROM revalidation_attempts WHERE run_id=? AND status='dispatched'",
            )
            .all(run.revalidation_run_id) as Array<{ attempt_id: string; obligation_id: string }>;
          for (const attempt of dispatched) {
            ctx.db
              .prepare(
                `UPDATE revalidation_attempts
                    SET status='failed', result_json=?, landed_at=datetime('now')
                  WHERE attempt_id=?`,
              )
              .run(JSON.stringify({ reason: `refresh cancelled: ${reason}` }), attempt.attempt_id);
            ctx.db
              .prepare(
                "UPDATE revalidation_obligations SET state='ready', updated_at=datetime('now') WHERE obligation_id=?",
              )
              .run(attempt.obligation_id);
            ctx.db
              .prepare(
                "UPDATE refresh_dispatches SET status='failed', updated_at=datetime('now') WHERE attempt_id=?",
              )
              .run(attempt.attempt_id);
          }
          ctx.db
            .prepare(
              `UPDATE revalidation_runs
                  SET status='failed', completed_at=NULL
                WHERE run_id=? AND status!='complete'`,
            )
            .run(run.revalidation_run_id);
        }
        ctx.db
          .prepare(
            `UPDATE refresh_runs
                SET status='cancelled', error=?, cancelled_at=datetime('now'), updated_at=datetime('now')
              WHERE run_id=?`,
          )
          .run(reason, runId);
        recordStage(ctx, runId, "cancel", "cancelled", "cancel", { reason });
      })();
      return readRun(ctx, runId);
    },
  },
  {
    name: "land_refresh_result",
    description:
      "Land one provider result through the refresh envelope. A3 records budget/source/authority violations; this wrapper updates the refresh outbox but does not score or complete the run.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        attempt_id: { type: "string" },
        result: { type: "object" },
        actual_tokens: { type: "integer", minimum: 0 },
        actual_cost_microusd: { type: "integer", minimum: 0 },
        artifacts_written: { type: "array", items: { type: "string" } },
        consulted_sources: { type: "array", items: { type: "string" } },
      },
      required: ["run_id", "attempt_id", "result", "actual_tokens", "actual_cost_microusd"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const run = requireResultRun(ctx, requireString(args, "run_id"));
      if (!run.revalidation_run_id) throw new ToolError("refresh has no revalidation run");
      const attemptId = requireString(args, "attempt_id");
      const result = invoke(
        revalidationTools,
        "land_revalidation_result",
        {
          run_id: run.revalidation_run_id,
          attempt_id: attemptId,
          result: args.result,
          actual_tokens: requireInt(args, "actual_tokens"),
          actual_cost_microusd: requireInt(args, "actual_cost_microusd"),
          artifacts_written: optStringArray(args, "artifacts_written") ?? [],
          consulted_sources: optStringArray(args, "consulted_sources") ?? [],
        },
        ctx,
      );
      ctx.db
        .prepare(
          "UPDATE refresh_dispatches SET status='landed', updated_at=datetime('now') WHERE run_id=? AND attempt_id=?",
        )
        .run(run.run_id, attemptId);
      return result;
    },
  },
  {
    name: "fail_refresh_result",
    description:
      "Record a failed or timed-out refresh attempt without losing retry identity. Resume may dispatch the next deterministic attempt while policy permits.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        attempt_id: { type: "string" },
        status: { type: "string", enum: FAILURE_STATUSES },
        reason: { type: "string" },
      },
      required: ["run_id", "attempt_id", "status", "reason"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const run = requireResultRun(ctx, requireString(args, "run_id"));
      if (!run.revalidation_run_id) throw new ToolError("refresh has no revalidation run");
      const attemptId = requireString(args, "attempt_id");
      const status = requireEnum(args, "status", FAILURE_STATUSES);
      const result = invoke(
        revalidationTools,
        "fail_revalidation_attempt",
        {
          run_id: run.revalidation_run_id,
          attempt_id: attemptId,
          status,
          reason: requireString(args, "reason"),
        },
        ctx,
      );
      ctx.db
        .prepare(
          "UPDATE refresh_dispatches SET status=?, updated_at=datetime('now') WHERE run_id=? AND attempt_id=?",
        )
        .run(status, run.run_id, attemptId);
      return result;
    },
  },
  {
    name: "score_refresh_result",
    description:
      "Score a landed refresh result through the evidence-gated A3 closure contract. Completion still requires resume to reconcile all landed state and pass final projection read-back.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        attempt_id: { type: "string" },
        verdict: { type: "string", enum: SCORE_VERDICTS },
        resolution_outcome: { type: "string", enum: RESOLUTION_OUTCOMES },
        rationale: { type: "string" },
        resolution_evidence_id: { type: "integer" },
        resolution_claim_id: { type: "string" },
      },
      required: ["run_id", "attempt_id", "verdict", "resolution_outcome", "rationale"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const run = requireResultRun(ctx, requireString(args, "run_id"));
      if (!run.revalidation_run_id) throw new ToolError("refresh has no revalidation run");
      const attemptId = requireString(args, "attempt_id");
      const callArgs: Record<string, unknown> = {
        run_id: run.revalidation_run_id,
        attempt_id: attemptId,
        verdict: requireEnum(args, "verdict", SCORE_VERDICTS),
        resolution_outcome: requireEnum(args, "resolution_outcome", RESOLUTION_OUTCOMES),
        rationale: requireString(args, "rationale"),
      };
      const evidenceId = optInt(args, "resolution_evidence_id");
      const claimId = optString(args, "resolution_claim_id");
      if (evidenceId !== null) callArgs.resolution_evidence_id = evidenceId;
      if (claimId !== null) callArgs.resolution_claim_id = claimId;
      const result = invoke(revalidationTools, "score_revalidation_result", callArgs, ctx);
      ctx.db
        .prepare(
          "UPDATE refresh_dispatches SET status='scored', updated_at=datetime('now') WHERE run_id=? AND attempt_id=?",
        )
        .run(run.run_id, attemptId);
      return result;
    },
  },
  {
    name: "get_refresh_run",
    description:
      "Read the immutable refresh manifest, custody events, provider outbox attempts, child-run state, blockers, durable projection proof, and completion basis.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => readRun(ctx, requireString(args, "run_id")),
  },
];
