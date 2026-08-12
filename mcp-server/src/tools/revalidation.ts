import {
  ok,
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

const AUTHORITY_MODES = ["observe-only", "conspectus-write", "branch-write"] as const;
const ATTEMPT_FAILURES = ["failed", "timed-out"] as const;
const SCORE_VERDICTS = ["accepted", "rejected", "inconclusive"] as const;
const RESOLUTION_OUTCOMES = ["revalidated", "retired", "no-change", "needs-more-work"] as const;

interface ObligationRow {
  obligation_id: string;
  trigger_type: string;
  trigger_id: string;
  destination_type: string;
  destination_id: string;
  source_impact_run_id: string;
  owner: string;
  state: string;
  blocking: number;
  priority: number;
}

interface RunRow {
  run_id: string;
  source_impact_run_id: string;
  status: string;
  allowed_sources: string;
  provider_allowlist: string;
  allowed_write_prefixes: string;
  authority_mode: (typeof AUTHORITY_MODES)[number];
  max_concurrency: number;
  max_attempts_per_obligation: number;
  max_tokens_per_attempt: number;
  max_total_tokens: number;
  max_total_cost_microusd: number;
  expected_obligation_count: number;
}

interface AttemptRow {
  attempt_id: string;
  run_id: string;
  obligation_id: string;
  replicate_id: string;
  attempt_number: number;
  worker_id: string;
  provider: string;
  model: string;
  status: string;
  planned_tokens: number;
  planned_cost_microusd: number;
  actual_tokens: number | null;
  actual_cost_microusd: number | null;
  budget_violation: number;
  boundary_violation: number;
}

function requirePositive(value: number, name: string): number {
  if (value <= 0) throw new ToolError(`${name} must be greater than zero`);
  return value;
}

function requireNonNegative(value: number, name: string): number {
  if (value < 0) throw new ToolError(`${name} must be non-negative`);
  return value;
}

function normalizePrefixes(values: string[], name: string, allowEmpty = false): string[] {
  if (!allowEmpty && values.length === 0) throw new ToolError(`${name} must not be empty`);
  const normalized = [...new Set(values.map((value) => value.replace(/^\.\//, "")))];
  for (const value of normalized) {
    if (!value || value.startsWith("/") || value.split("/").includes("..")) {
      throw new ToolError(`${name} must contain only relative, non-traversing paths`);
    }
  }
  return normalized.sort();
}

function pathAllowed(path: string, prefixes: string[]): boolean {
  const normalized = path.replace(/^\.\//, "");
  return prefixes.some((prefix) => {
    const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return normalized === prefix || normalized.startsWith(base);
  });
}

function getRun(ctx: ServerContext, runId: string): RunRow {
  const row = ctx.db.prepare("SELECT * FROM revalidation_runs WHERE run_id = ?").get(runId) as
    | RunRow
    | undefined;
  if (!row) throw new ToolError(`unknown revalidation run: ${runId}`);
  return row;
}

function getAttempt(ctx: ServerContext, runId: string, attemptId: string): AttemptRow | null {
  return (
    (ctx.db
      .prepare("SELECT * FROM revalidation_attempts WHERE run_id = ? AND attempt_id = ?")
      .get(runId, attemptId) as AttemptRow | undefined) ?? null
  );
}

function recordViolation(
  ctx: ServerContext,
  values: {
    runId: string;
    obligationId?: string | null;
    attemptId?: string | null;
    type:
      | "duplicate-landing"
      | "duplicate-score"
      | "unknown-attempt"
      | "source-boundary"
      | "authority-boundary"
      | "budget-overrun";
    detail: Record<string, unknown>;
  },
): void {
  ctx.db
    .prepare(
      `INSERT INTO revalidation_protocol_violations
         (run_id, obligation_id, attempt_id, violation_type, detail_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      values.runId,
      values.obligationId ?? null,
      values.attemptId ?? null,
      values.type,
      JSON.stringify(values.detail),
    );
  ctx.db
    .prepare("UPDATE revalidation_runs SET status='failed', completed_at=NULL WHERE run_id=?")
    .run(values.runId);
}

function buildWorkPacket(
  ctx: ServerContext,
  obligation: ObligationRow,
  allowedSources: string[],
  authorityMode: (typeof AUTHORITY_MODES)[number],
  allowedWritePrefixes: string[],
): Record<string, unknown> {
  if (obligation.destination_type !== "claim") {
    return {
      obligation,
      dispatchable: false,
      blocked_reason: `unsupported destination type: ${obligation.destination_type}`,
      allowed_actions: [],
    };
  }
  const claim = ctx.db
    .prepare(
      `SELECT claim_id, claim_key, subject_type, subject_id, statement, epistemic_kind,
              asserted_at_sha, valid_from_sha, valid_until_sha
         FROM claims WHERE claim_id = ?`,
    )
    .get(obligation.destination_id) as Record<string, unknown> | undefined;
  if (!claim) {
    return {
      obligation,
      dispatchable: false,
      blocked_reason: "destination claim is missing",
      allowed_actions: [],
    };
  }
  const evidence = ctx.db
    .prepare(
      `SELECT e.id, e.file_path, e.symbol, e.line_range, e.ref_sha, e.kind, ce.role
         FROM claim_evidence ce JOIN evidence e ON e.id = ce.evidence_id
        WHERE ce.claim_id = ? ORDER BY e.id`,
    )
    .all(obligation.destination_id) as Array<Record<string, unknown> & { file_path: string }>;
  const includedEvidence = evidence.filter((row) => pathAllowed(row.file_path, allowedSources));
  const excludedEvidence = evidence
    .filter((row) => !pathAllowed(row.file_path, allowedSources))
    .map((row) => ({ id: row.id, file_path: row.file_path, reason: "outside allowed_sources" }));
  const invalidation = ctx.db
    .prepare(
      `SELECT reason_path, evidence_id, applied_at
         FROM change_impact_invalidations
        WHERE run_id = ? AND claim_id = ?`,
    )
    .get(obligation.source_impact_run_id, obligation.destination_id) as
    | { reason_path: string; evidence_id: number | null; applied_at: string | null }
    | undefined;
  const neighborhood = ctx.db
    .prepare(
      `SELECT object_type, object_id, impact_kind, invalidates, reason_path
         FROM change_impact_objects
        WHERE run_id = ? AND object_type NOT IN ('control','gap')
        ORDER BY object_type, object_id`,
    )
    .all(obligation.source_impact_run_id)
    .map((row) => {
      const typed = row as { reason_path: string };
      return { ...typed, reason_path: JSON.parse(typed.reason_path) };
    })
    .filter((row) => {
      const path = row.reason_path as Array<{ id?: string }>;
      return path.some(
        (step) => step.id === claim.subject_id || step.id === obligation.destination_id,
      );
    });
  const dispatchable = includedEvidence.length > 0 && !!invalidation;
  return {
    schema_version: 1,
    obligation,
    claim,
    included_evidence: includedEvidence,
    excluded_evidence: excludedEvidence,
    impact_reason_path: invalidation ? JSON.parse(invalidation.reason_path) : null,
    impacted_neighborhood: neighborhood,
    dispatchable,
    blocked_reason: dispatchable ? null : "no allowed evidence or impact invalidation",
    authority: {
      mode: authorityMode,
      allowed_write_prefixes: allowedWritePrefixes,
      allowed_actions:
        authorityMode === "observe-only"
          ? ["inspect", "report"]
          : ["inspect", "report", "write-within-prefix"],
    },
  };
}

function listIds(ctx: ServerContext, sql: string, runId: string, column: string): string[] {
  return (ctx.db.prepare(sql).all(runId) as Array<Record<string, unknown>>).map((row) =>
    String(row[column]),
  );
}

export const revalidationTools: ToolDefinition[] = [
  {
    name: "plan_revalidation_run",
    description:
      "Create a bounded revalidation run from an applied impact run. The planner verifies one durable obligation per applied invalidation, compiles source-filtered evidence neighborhoods, and stores the exact work packets before dispatch.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        impact_run_id: { type: "string" },
        allowed_sources: { type: "array", items: { type: "string" }, minItems: 1 },
        provider_allowlist: { type: "array", items: { type: "string" }, minItems: 1 },
        authority_mode: { type: "string", enum: AUTHORITY_MODES },
        allowed_write_prefixes: { type: "array", items: { type: "string" } },
        max_concurrency: { type: "integer", minimum: 1 },
        max_attempts_per_obligation: { type: "integer", minimum: 1 },
        max_tokens_per_attempt: { type: "integer", minimum: 1 },
        max_total_tokens: { type: "integer", minimum: 1 },
        max_total_cost_microusd: { type: "integer", minimum: 0 },
      },
      required: [
        "run_id",
        "impact_run_id",
        "allowed_sources",
        "provider_allowlist",
        "authority_mode",
        "max_concurrency",
        "max_attempts_per_obligation",
        "max_tokens_per_attempt",
        "max_total_tokens",
        "max_total_cost_microusd",
      ],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "plan_revalidation_run");
      const runId = requireString(args, "run_id");
      const impactRunId = requireString(args, "impact_run_id");
      const impact = ctx.db
        .prepare("SELECT status FROM change_impact_runs WHERE run_id = ?")
        .get(impactRunId) as { status: string } | undefined;
      if (!impact) throw new ToolError(`unknown change impact run: ${impactRunId}`);
      if (impact.status !== "applied") {
        throw new ToolError(`change impact ${impactRunId} is ${impact.status}, not applied`);
      }
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
      const authorityMode = requireEnum(args, "authority_mode", AUTHORITY_MODES);
      const allowedWritePrefixes = normalizePrefixes(
        optStringArray(args, "allowed_write_prefixes") ?? [],
        "allowed_write_prefixes",
        true,
      );
      if (authorityMode !== "observe-only" && allowedWritePrefixes.length === 0) {
        throw new ToolError("write authority requires at least one allowed_write_prefix");
      }
      const limits = {
        maxConcurrency: requirePositive(requireInt(args, "max_concurrency"), "max_concurrency"),
        maxAttempts: requirePositive(
          requireInt(args, "max_attempts_per_obligation"),
          "max_attempts_per_obligation",
        ),
        maxTokensPerAttempt: requirePositive(
          requireInt(args, "max_tokens_per_attempt"),
          "max_tokens_per_attempt",
        ),
        maxTotalTokens: requirePositive(requireInt(args, "max_total_tokens"), "max_total_tokens"),
        maxTotalCost: requireNonNegative(
          requireInt(args, "max_total_cost_microusd"),
          "max_total_cost_microusd",
        ),
      };
      const applied = ctx.db
        .prepare(
          `SELECT claim_id FROM change_impact_invalidations
            WHERE run_id = ? AND state = 'applied' ORDER BY claim_id`,
        )
        .all(impactRunId) as Array<{ claim_id: string }>;
      const obligations = ctx.db
        .prepare(
          `SELECT * FROM revalidation_obligations
            WHERE source_impact_run_id = ? AND trigger_type = 'claim-invalidation'
              AND state != 'closed'
            ORDER BY priority, obligation_id`,
        )
        .all(impactRunId) as ObligationRow[];
      const activeAssignments = ctx.db
        .prepare(
          `SELECT DISTINCT rro.obligation_id
             FROM revalidation_run_obligations rro
             JOIN revalidation_runs rr ON rr.run_id=rro.run_id
            WHERE rr.source_impact_run_id=? AND rr.status NOT IN ('complete','failed')
            ORDER BY rro.obligation_id`,
        )
        .all(impactRunId) as Array<{ obligation_id: string }>;
      if (activeAssignments.length > 0) {
        throw new ToolError(
          `obligations already assigned to an active run: ${activeAssignments.map((row) => row.obligation_id).join(", ")}`,
        );
      }
      const destinations = new Set(obligations.map((row) => row.destination_id));
      const missing = applied.map((row) => row.claim_id).filter((id) => !destinations.has(id));
      if (missing.length > 0) {
        throw new ToolError(`applied invalidations without obligations: ${missing.join(", ")}`);
      }
      if (obligations.length === 0) {
        throw new ToolError(`no open revalidation obligations for impact ${impactRunId}`);
      }
      const packets = obligations.map((obligation) =>
        buildWorkPacket(ctx, obligation, allowedSources, authorityMode, allowedWritePrefixes),
      );
      ctx.db.transaction(() => {
        ctx.db
          .prepare(
            `INSERT INTO revalidation_runs
               (run_id, source_impact_run_id, allowed_sources, provider_allowlist,
                allowed_write_prefixes, authority_mode, max_concurrency,
                max_attempts_per_obligation, max_tokens_per_attempt, max_total_tokens,
                max_total_cost_microusd, expected_obligation_count, session_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            runId,
            impactRunId,
            JSON.stringify(allowedSources),
            JSON.stringify(providers),
            JSON.stringify(allowedWritePrefixes),
            authorityMode,
            limits.maxConcurrency,
            limits.maxAttempts,
            limits.maxTokensPerAttempt,
            limits.maxTotalTokens,
            limits.maxTotalCost,
            obligations.length,
            sessionId,
          );
        const insert = ctx.db.prepare(
          `INSERT INTO revalidation_run_obligations
             (run_id, obligation_id, ordinal, work_packet)
           VALUES (?, ?, ?, ?)`,
        );
        packets.forEach((packet, ordinal) => {
          const obligation = packet.obligation as ObligationRow;
          insert.run(runId, obligation.obligation_id, ordinal, JSON.stringify(packet));
          if (!packet.dispatchable) {
            ctx.db
              .prepare(
                `UPDATE revalidation_obligations
                    SET state='blocked', updated_at=datetime('now')
                  WHERE obligation_id = ?`,
              )
              .run(obligation.obligation_id);
          }
        });
      })();
      return {
        run_id: runId,
        impact_run_id: impactRunId,
        expected_obligations: obligations.length,
        dispatchable: packets.filter((packet) => packet.dispatchable).length,
        blocked: packets.filter((packet) => !packet.dispatchable).length,
        limits,
      };
    },
  },
  {
    name: "dispatch_revalidation_attempt",
    description:
      "Dispatch one immutable, uniquely identified attempt from a planned work packet. Enforces provider, concurrency, per-attempt, aggregate budget, retry-number, and maximum-attempt bounds before work begins.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        obligation_id: { type: "string" },
        attempt_id: { type: "string" },
        replicate_id: { type: "string" },
        attempt_number: { type: "integer", minimum: 1 },
        worker_id: { type: "string" },
        provider: { type: "string" },
        model: { type: "string" },
        planned_tokens: { type: "integer", minimum: 1 },
        planned_cost_microusd: { type: "integer", minimum: 0 },
      },
      required: [
        "run_id",
        "obligation_id",
        "attempt_id",
        "replicate_id",
        "attempt_number",
        "worker_id",
        "provider",
        "model",
        "planned_tokens",
        "planned_cost_microusd",
      ],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "dispatch_revalidation_attempt");
      const runId = requireString(args, "run_id");
      const obligationId = requireString(args, "obligation_id");
      const attemptId = requireString(args, "attempt_id");
      const replicateId = requireString(args, "replicate_id");
      const attemptNumber = requirePositive(requireInt(args, "attempt_number"), "attempt_number");
      const workerId = requireString(args, "worker_id");
      const provider = requireString(args, "provider");
      const model = requireString(args, "model");
      const plannedTokens = requirePositive(requireInt(args, "planned_tokens"), "planned_tokens");
      const plannedCost = requireNonNegative(
        requireInt(args, "planned_cost_microusd"),
        "planned_cost_microusd",
      );
      const run = getRun(ctx, runId);
      if (!["planned", "running", "reconciling"].includes(run.status)) {
        throw new ToolError(`revalidation run ${runId} is ${run.status}`);
      }
      const providers = JSON.parse(run.provider_allowlist) as string[];
      if (!providers.includes(provider)) {
        throw new ToolError(`provider ${provider} is outside the run provider_allowlist`);
      }
      if (plannedTokens > run.max_tokens_per_attempt) {
        throw new ToolError(
          `planned_tokens exceeds max_tokens_per_attempt ${run.max_tokens_per_attempt}`,
        );
      }
      const assignment = ctx.db
        .prepare(
          `SELECT ro.state, rro.work_packet
             FROM revalidation_run_obligations rro
             JOIN revalidation_obligations ro ON ro.obligation_id = rro.obligation_id
            WHERE rro.run_id = ? AND rro.obligation_id = ?`,
        )
        .get(runId, obligationId) as { state: string; work_packet: string } | undefined;
      if (!assignment) throw new ToolError(`obligation ${obligationId} is not in run ${runId}`);
      const packet = JSON.parse(assignment.work_packet) as { dispatchable?: boolean };
      if (
        !packet.dispatchable ||
        ["blocked", "closed", "dead-letter", "deferred"].includes(assignment.state)
      ) {
        throw new ToolError(`obligation ${obligationId} is not dispatchable (${assignment.state})`);
      }
      const totals = ctx.db
        .prepare(
          `SELECT COUNT(*) FILTER (WHERE status='dispatched') AS active,
                  COALESCE(SUM(planned_tokens), 0) AS tokens,
                  COALESCE(SUM(planned_cost_microusd), 0) AS cost
             FROM revalidation_attempts WHERE run_id = ?`,
        )
        .get(runId) as { active: number; tokens: number; cost: number };
      if (totals.active >= run.max_concurrency) {
        throw new ToolError(`max_concurrency ${run.max_concurrency} reached`);
      }
      if (totals.tokens + plannedTokens > run.max_total_tokens) {
        throw new ToolError(`dispatch would exceed max_total_tokens ${run.max_total_tokens}`);
      }
      if (totals.cost + plannedCost > run.max_total_cost_microusd) {
        throw new ToolError(
          `dispatch would exceed max_total_cost_microusd ${run.max_total_cost_microusd}`,
        );
      }
      const totalAttempts = ctx.db
        .prepare(
          "SELECT COUNT(*) AS n FROM revalidation_attempts WHERE run_id = ? AND obligation_id = ?",
        )
        .get(runId, obligationId) as { n: number };
      if (totalAttempts.n >= run.max_attempts_per_obligation) {
        throw new ToolError(
          `obligation ${obligationId} reached max_attempts_per_obligation ${run.max_attempts_per_obligation}`,
        );
      }
      const prior = ctx.db
        .prepare(
          `SELECT COALESCE(MAX(attempt_number), 0) AS n
             FROM revalidation_attempts
            WHERE run_id = ? AND obligation_id = ? AND replicate_id = ?`,
        )
        .get(runId, obligationId, replicateId) as { n: number };
      if (attemptNumber !== prior.n + 1) {
        throw new ToolError(
          `attempt_number for ${obligationId}/${replicateId} must be ${prior.n + 1}`,
        );
      }
      try {
        ctx.db.transaction(() => {
          ctx.db
            .prepare(
              `INSERT INTO revalidation_attempts
                 (attempt_id, run_id, obligation_id, replicate_id, attempt_number,
                  worker_id, provider, model, planned_tokens, planned_cost_microusd)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              attemptId,
              runId,
              obligationId,
              replicateId,
              attemptNumber,
              workerId,
              provider,
              model,
              plannedTokens,
              plannedCost,
            );
          ctx.db
            .prepare(
              `UPDATE revalidation_obligations
                  SET state='dispatched', updated_at=datetime('now')
                WHERE obligation_id = ?`,
            )
            .run(obligationId);
          ctx.db
            .prepare("UPDATE revalidation_runs SET status='running' WHERE run_id = ?")
            .run(runId);
        })();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("UNIQUE constraint failed")) {
          throw new ToolError(`attempt identity already exists: ${attemptId}`);
        }
        throw error;
      }
      return ok({
        run_id: runId,
        obligation_id: obligationId,
        attempt_id: attemptId,
        work_packet: packet,
      });
    },
  },
  {
    name: "land_revalidation_result",
    description:
      "Record one worker result without discarding over-budget or out-of-authority telemetry. Duplicate or unknown deliveries become durable protocol violations and keep reconciliation red.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        attempt_id: { type: "string" },
        result: { type: "object" },
        artifacts_written: { type: "array", items: { type: "string" } },
        consulted_sources: { type: "array", items: { type: "string" } },
        actual_tokens: { type: "integer", minimum: 0 },
        actual_cost_microusd: { type: "integer", minimum: 0 },
      },
      required: ["run_id", "attempt_id", "result", "actual_tokens", "actual_cost_microusd"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "land_revalidation_result");
      const runId = requireString(args, "run_id");
      const attemptId = requireString(args, "attempt_id");
      const run = getRun(ctx, runId);
      const attempt = getAttempt(ctx, runId, attemptId);
      if (!attempt) {
        recordViolation(ctx, {
          runId,
          attemptId,
          type: "unknown-attempt",
          detail: { received: true },
        });
        return { ok: false, error: `unknown attempt ${attemptId}`, violation: "unknown-attempt" };
      }
      if (attempt.status !== "dispatched") {
        recordViolation(ctx, {
          runId,
          obligationId: attempt.obligation_id,
          attemptId,
          type: "duplicate-landing",
          detail: { existing_status: attempt.status },
        });
        return {
          ok: false,
          error: `attempt ${attemptId} already ${attempt.status}`,
          violation: "duplicate-landing",
        };
      }
      const result = args.result;
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new ToolError("result must be an object");
      }
      const artifacts = optStringArray(args, "artifacts_written") ?? [];
      const consultedSources = optStringArray(args, "consulted_sources") ?? [];
      const actualTokens = requireNonNegative(requireInt(args, "actual_tokens"), "actual_tokens");
      const actualCost = requireNonNegative(
        requireInt(args, "actual_cost_microusd"),
        "actual_cost_microusd",
      );
      const totals = ctx.db
        .prepare(
          `SELECT COALESCE(SUM(actual_tokens), 0) AS tokens,
                  COALESCE(SUM(actual_cost_microusd), 0) AS cost
             FROM revalidation_attempts WHERE run_id = ?`,
        )
        .get(runId) as { tokens: number; cost: number };
      const budgetViolation =
        actualTokens > attempt.planned_tokens ||
        actualCost > attempt.planned_cost_microusd ||
        totals.tokens + actualTokens > run.max_total_tokens ||
        totals.cost + actualCost > run.max_total_cost_microusd;
      const allowedWrites = JSON.parse(run.allowed_write_prefixes) as string[];
      const allowedSources = JSON.parse(run.allowed_sources) as string[];
      const authorityViolation = run.authority_mode === "observe-only" && artifacts.length > 0;
      const writeBoundaryViolation =
        run.authority_mode !== "observe-only" &&
        artifacts.some((path) => !pathAllowed(path, allowedWrites));
      const readBoundaryViolation = consultedSources.some(
        (path) => !pathAllowed(path, allowedSources),
      );
      const boundaryViolation =
        authorityViolation || writeBoundaryViolation || readBoundaryViolation;
      ctx.db.transaction(() => {
        ctx.db
          .prepare(
            `UPDATE revalidation_attempts
                SET status='landed', actual_tokens=?, actual_cost_microusd=?,
                    result_json=?, artifacts_written=?, consulted_sources=?, budget_violation=?,
                    boundary_violation=?, landed_at=datetime('now')
              WHERE attempt_id = ?`,
          )
          .run(
            actualTokens,
            actualCost,
            JSON.stringify(result),
            JSON.stringify(artifacts),
            JSON.stringify(consultedSources),
            budgetViolation ? 1 : 0,
            boundaryViolation ? 1 : 0,
            attemptId,
          );
        ctx.db
          .prepare(
            `UPDATE revalidation_obligations
                SET state='landed', updated_at=datetime('now')
              WHERE obligation_id = ?`,
          )
          .run(attempt.obligation_id);
        if (budgetViolation) {
          recordViolation(ctx, {
            runId,
            obligationId: attempt.obligation_id,
            attemptId,
            type: "budget-overrun",
            detail: { actual_tokens: actualTokens, actual_cost_microusd: actualCost },
          });
        }
        if (authorityViolation) {
          recordViolation(ctx, {
            runId,
            obligationId: attempt.obligation_id,
            attemptId,
            type: "authority-boundary",
            detail: { authority_mode: run.authority_mode, artifacts_written: artifacts },
          });
        }
        if (writeBoundaryViolation) {
          recordViolation(ctx, {
            runId,
            obligationId: attempt.obligation_id,
            attemptId,
            type: "source-boundary",
            detail: {
              boundary: "write",
              allowed_write_prefixes: allowedWrites,
              artifacts_written: artifacts,
            },
          });
        }
        if (readBoundaryViolation) {
          recordViolation(ctx, {
            runId,
            obligationId: attempt.obligation_id,
            attemptId,
            type: "source-boundary",
            detail: {
              boundary: "read",
              allowed_sources: allowedSources,
              consulted_sources: consultedSources,
            },
          });
        }
      })();
      return ok({
        attempt_id: attemptId,
        budget_violation: budgetViolation,
        boundary_violation: boundaryViolation,
      });
    },
  },
  {
    name: "fail_revalidation_attempt",
    description:
      "Record a failed or timed-out attempt, preserving it and reopening its obligation only when the configured retry budget remains.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        attempt_id: { type: "string" },
        status: { type: "string", enum: ATTEMPT_FAILURES },
        reason: { type: "string" },
      },
      required: ["run_id", "attempt_id", "status", "reason"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "fail_revalidation_attempt");
      const runId = requireString(args, "run_id");
      const attemptId = requireString(args, "attempt_id");
      const status = requireEnum(args, "status", ATTEMPT_FAILURES);
      const reason = requireString(args, "reason");
      const run = getRun(ctx, runId);
      const attempt = getAttempt(ctx, runId, attemptId);
      if (!attempt) throw new ToolError(`unknown attempt ${attemptId}`);
      if (attempt.status !== "dispatched") {
        throw new ToolError(`attempt ${attemptId} is ${attempt.status}, not dispatched`);
      }
      const count = ctx.db
        .prepare(
          "SELECT COUNT(*) AS n FROM revalidation_attempts WHERE run_id=? AND obligation_id=?",
        )
        .get(runId, attempt.obligation_id) as { n: number };
      const nextState = count.n >= run.max_attempts_per_obligation ? "dead-letter" : "ready";
      ctx.db.transaction(() => {
        ctx.db
          .prepare(
            `UPDATE revalidation_attempts
                SET status=?, result_json=?, landed_at=datetime('now')
              WHERE attempt_id=?`,
          )
          .run(status, JSON.stringify({ reason }), attemptId);
        ctx.db
          .prepare(
            `UPDATE revalidation_obligations
                SET state=?, updated_at=datetime('now')
              WHERE obligation_id=?`,
          )
          .run(nextState, attempt.obligation_id);
      })();
      return ok({ attempt_id: attemptId, status, obligation_state: nextState });
    },
  },
  {
    name: "score_revalidation_result",
    description:
      "Score a landed result. Accepted work can close an obligation only with new structured evidence; revalidated outcomes additionally require a current replacement claim backed by that evidence. Rejected/inconclusive work retries or dead-letters by policy.",
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
      requireActiveSession(ctx, "score_revalidation_result");
      const runId = requireString(args, "run_id");
      const attemptId = requireString(args, "attempt_id");
      const verdict = requireEnum(args, "verdict", SCORE_VERDICTS);
      const resolutionOutcome = requireEnum(args, "resolution_outcome", RESOLUTION_OUTCOMES);
      const rationale = requireString(args, "rationale");
      const run = getRun(ctx, runId);
      const attempt = getAttempt(ctx, runId, attemptId);
      if (!attempt) throw new ToolError(`unknown attempt ${attemptId}`);
      if (attempt.status === "scored") {
        recordViolation(ctx, {
          runId,
          obligationId: attempt.obligation_id,
          attemptId,
          type: "duplicate-score",
          detail: { verdict, resolution_outcome: resolutionOutcome },
        });
        return {
          ok: false,
          error: `attempt ${attemptId} already scored`,
          violation: "duplicate-score",
        };
      }
      if (attempt.status !== "landed") {
        throw new ToolError(`attempt ${attemptId} is ${attempt.status}, not landed`);
      }
      const evidenceId = optInt(args, "resolution_evidence_id");
      const resolutionClaimId = optString(args, "resolution_claim_id");
      if (verdict === "accepted") {
        if (attempt.budget_violation || attempt.boundary_violation) {
          throw new ToolError("a budget or authority violating result cannot be accepted");
        }
        if (evidenceId === null) {
          throw new ToolError("accepted result requires resolution_evidence_id");
        }
        const evidence = ctx.db.prepare("SELECT 1 FROM evidence WHERE id = ?").get(evidenceId);
        if (!evidence) throw new ToolError(`unknown resolution evidence: ${evidenceId}`);
        const obligation = ctx.db
          .prepare("SELECT destination_id FROM revalidation_obligations WHERE obligation_id=?")
          .get(attempt.obligation_id) as { destination_id: string };
        const priorEvidence = ctx.db
          .prepare("SELECT 1 FROM claim_evidence WHERE claim_id=? AND evidence_id=?")
          .get(obligation.destination_id, evidenceId);
        if (priorEvidence) {
          throw new ToolError(
            "accepted result requires new evidence not attached to the invalidated claim",
          );
        }
        if (resolutionOutcome === "needs-more-work") {
          throw new ToolError("accepted verdict cannot use needs-more-work outcome");
        }
        if (resolutionOutcome === "revalidated") {
          if (!resolutionClaimId) {
            throw new ToolError("revalidated outcome requires resolution_claim_id");
          }
          const replacement = ctx.db
            .prepare(
              `SELECT replacement.valid_until_sha,
                      replacement.claim_key = invalidated.claim_key AS same_key
                 FROM claims replacement
                 JOIN claims invalidated ON invalidated.claim_id=?
                WHERE replacement.claim_id=?`,
            )
            .get(obligation.destination_id, resolutionClaimId) as
            | { valid_until_sha: string | null; same_key: number }
            | undefined;
          if (!replacement || replacement.valid_until_sha !== null) {
            throw new ToolError("resolution_claim_id must name current claim authority");
          }
          if (replacement.same_key !== 1) {
            throw new ToolError("replacement claim must occupy the invalidated claim_key");
          }
          const attached = ctx.db
            .prepare(
              "SELECT 1 FROM claim_evidence WHERE claim_id = ? AND evidence_id = ? AND role = 'supports'",
            )
            .get(resolutionClaimId, evidenceId);
          if (!attached) {
            throw new ToolError("resolution evidence must support the replacement claim");
          }
        }
      } else if (resolutionOutcome !== "needs-more-work") {
        throw new ToolError("rejected or inconclusive verdict requires needs-more-work outcome");
      }
      const count = ctx.db
        .prepare(
          "SELECT COUNT(*) AS n FROM revalidation_attempts WHERE run_id=? AND obligation_id=?",
        )
        .get(runId, attempt.obligation_id) as { n: number };
      const nextState =
        verdict === "accepted"
          ? "closed"
          : count.n >= run.max_attempts_per_obligation
            ? "dead-letter"
            : "ready";
      const score = {
        verdict,
        resolution_outcome: resolutionOutcome,
        rationale,
        resolution_evidence_id: evidenceId,
        resolution_claim_id: resolutionClaimId,
      };
      ctx.db.transaction(() => {
        ctx.db
          .prepare(
            `UPDATE revalidation_attempts
                SET status='scored', score_json=?, scored_at=datetime('now')
              WHERE attempt_id=?`,
          )
          .run(JSON.stringify(score), attemptId);
        ctx.db
          .prepare(
            `UPDATE revalidation_obligations
                SET state=?, resolution_evidence_id=?, resolution_note=?,
                    updated_at=datetime('now'),
                    closed_at=CASE WHEN ?='closed' THEN datetime('now') ELSE closed_at END
              WHERE obligation_id=?`,
          )
          .run(
            nextState,
            verdict === "accepted" ? evidenceId : null,
            rationale,
            nextState,
            attempt.obligation_id,
          );
      })();
      return ok({ attempt_id: attemptId, verdict, obligation_state: nextState });
    },
  },
  {
    name: "reconcile_revalidation_run",
    description:
      "Reconcile expected obligations against attempts, landings, scores, closures, and protocol/budget/authority violations. Completion is exact fan-in, never non-emptiness; every diagnostic remains queryable.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "reconcile_revalidation_run");
      const runId = requireString(args, "run_id");
      const run = getRun(ctx, runId);
      const actualObligations = ctx.db
        .prepare("SELECT COUNT(*) AS n FROM revalidation_run_obligations WHERE run_id = ?")
        .get(runId) as { n: number };
      const missingAttempts = listIds(
        ctx,
        `SELECT rro.obligation_id
           FROM revalidation_run_obligations rro
          WHERE rro.run_id = ? AND NOT EXISTS (
            SELECT 1 FROM revalidation_attempts a
             WHERE a.run_id=rro.run_id AND a.obligation_id=rro.obligation_id
          ) ORDER BY rro.obligation_id`,
        runId,
        "obligation_id",
      );
      const missingLandings = listIds(
        ctx,
        "SELECT attempt_id FROM revalidation_attempts WHERE run_id=? AND status='dispatched' ORDER BY attempt_id",
        runId,
        "attempt_id",
      );
      const unscored = listIds(
        ctx,
        "SELECT attempt_id FROM revalidation_attempts WHERE run_id=? AND status='landed' ORDER BY attempt_id",
        runId,
        "attempt_id",
      );
      const timedOut = listIds(
        ctx,
        `SELECT a.attempt_id FROM revalidation_attempts a
          JOIN revalidation_obligations o ON o.obligation_id=a.obligation_id
         WHERE a.run_id=? AND a.status='timed-out' AND o.state!='closed'
         ORDER BY a.attempt_id`,
        runId,
        "attempt_id",
      );
      const failed = listIds(
        ctx,
        `SELECT a.attempt_id FROM revalidation_attempts a
          JOIN revalidation_obligations o ON o.obligation_id=a.obligation_id
         WHERE a.run_id=? AND a.status='failed' AND o.state!='closed'
         ORDER BY a.attempt_id`,
        runId,
        "attempt_id",
      );
      const unresolved = listIds(
        ctx,
        `SELECT o.obligation_id FROM revalidation_run_obligations rro
          JOIN revalidation_obligations o ON o.obligation_id=rro.obligation_id
         WHERE rro.run_id=? AND o.state!='closed' ORDER BY o.obligation_id`,
        runId,
        "obligation_id",
      );
      const violations = ctx.db
        .prepare(
          `SELECT id, obligation_id, attempt_id, violation_type, detail_json, created_at
             FROM revalidation_protocol_violations WHERE run_id=? ORDER BY id`,
        )
        .all(runId) as Array<{
        id: number;
        obligation_id: string | null;
        attempt_id: string | null;
        violation_type: string;
        detail_json: string;
        created_at: string;
      }>;
      const parsedViolations = violations.map((row) => {
        const { detail_json: detailJson, ...rest } = row;
        return { ...rest, detail: JSON.parse(detailJson) };
      });
      const duplicates = parsedViolations
        .filter((row) =>
          ["duplicate-landing", "duplicate-score"].includes(String(row.violation_type)),
        )
        .map((row) => row.attempt_id);
      const hardViolation = parsedViolations.length > 0;
      const exactFanIn = actualObligations.n === run.expected_obligation_count;
      const complete =
        exactFanIn &&
        missingAttempts.length === 0 &&
        missingLandings.length === 0 &&
        unscored.length === 0 &&
        timedOut.length === 0 &&
        failed.length === 0 &&
        unresolved.length === 0 &&
        parsedViolations.length === 0;
      const counts = ctx.db
        .prepare(
          `SELECT COUNT(*) AS dispatched,
                  COUNT(*) FILTER (WHERE status IN ('landed','scored')) AS landed,
                  COUNT(*) FILTER (WHERE status='scored') AS scored
             FROM revalidation_attempts WHERE run_id=?`,
        )
        .get(runId);
      const nextStatus = complete
        ? "complete"
        : hardViolation ||
            unresolved.some((id) => {
              const state = ctx.db
                .prepare("SELECT state FROM revalidation_obligations WHERE obligation_id=?")
                .get(id) as { state: string };
              return state.state === "dead-letter";
            })
          ? "failed"
          : "running";
      ctx.db
        .prepare(
          `UPDATE revalidation_runs
              SET status=?, completed_at=CASE WHEN ?='complete' THEN datetime('now') ELSE NULL END
            WHERE run_id=?`,
        )
        .run(nextStatus, nextStatus, runId);
      return {
        run_id: runId,
        complete,
        status: nextStatus,
        expected_obligations: run.expected_obligation_count,
        actual_obligations: actualObligations.n,
        exact_fan_in: exactFanIn,
        counts,
        diagnostics: {
          missing_attempts: missingAttempts,
          missing_landings: missingLandings,
          unscored,
          timed_out: timedOut,
          failed,
          duplicates,
          unresolved,
          protocol_violations: parsedViolations,
        },
      };
    },
  },
  {
    name: "get_revalidation_dashboard",
    description:
      "Return revalidation summary counts plus queryable obligations, runs, attempts, and protocol violations. Filters keep blocked, retried, deferred, dead-letter, and orphaned work visible.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        obligation_state: { type: "string" },
        limit: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const runId = optString(args, "run_id");
      const state = optString(args, "obligation_state");
      const limit = optInt(args, "limit", 100) ?? 100;
      if (limit <= 0) throw new ToolError("limit must be greater than zero");
      const clauses: string[] = [];
      const params: Array<string | number> = [];
      if (runId) {
        clauses.push(
          "o.obligation_id IN (SELECT obligation_id FROM revalidation_run_obligations WHERE run_id=?)",
        );
        params.push(runId);
      }
      if (state) {
        clauses.push("o.state=?");
        params.push(state);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      params.push(limit);
      const obligations = ctx.db
        .prepare(
          `SELECT o.*,
                  (SELECT COUNT(*) FROM revalidation_attempts a
                    WHERE a.obligation_id=o.obligation_id) AS attempt_count
             FROM revalidation_obligations o ${where}
            ORDER BY o.blocking DESC, o.priority, o.created_at, o.obligation_id LIMIT ?`,
        )
        .all(...params);
      const runs = runId
        ? ctx.db.prepare("SELECT * FROM revalidation_runs WHERE run_id=?").all(runId)
        : ctx.db
            .prepare("SELECT * FROM revalidation_runs ORDER BY created_at DESC LIMIT ?")
            .all(limit);
      const attempts = runId
        ? ctx.db
            .prepare(
              "SELECT * FROM revalidation_attempts WHERE run_id=? ORDER BY dispatched_at, attempt_id",
            )
            .all(runId)
        : [];
      const violations = runId
        ? ctx.db
            .prepare("SELECT * FROM revalidation_protocol_violations WHERE run_id=? ORDER BY id")
            .all(runId)
        : [];
      return {
        summary: ctx.db.prepare("SELECT * FROM revalidation_dashboard").get(),
        obligations,
        runs,
        attempts,
        violations,
      };
    },
  },
];
