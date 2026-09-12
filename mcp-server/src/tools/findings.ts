import { spawnSync } from "node:child_process";
import { SqliteError } from "better-sqlite3";
import {
  ok,
  optString,
  optStringArray,
  requireEnum,
  requireInt,
  requireString,
  requireWorkspaceCitation,
  requireWorkspaceSourcePath,
  resolveWorkspaceCommit,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import {
  requireActiveSession,
  requireOverturnEvidence,
  requireSubsystemStatus,
} from "../invariants.js";
import {
  FINDING_RESOLUTION_STATES,
  FINDING_STATUSES,
  PASS_TYPES,
  SEVERITIES,
} from "../vocabulary.js";

// One count per resolution state, generated from the enum source so the roll-up
// cannot fall behind the vocabulary. The column for a state is its value with
// dashes replaced, which keeps the two names `get_finding_summary` already
// published — `fixed_pending_verification` and `verified_fixed`.
const RESOLUTION_STATE_COUNTS = FINDING_RESOLUTION_STATES.map(
  (state) =>
    `SUM(CASE WHEN v.resolution_state='${state}' THEN 1 ELSE 0 END) AS ${state.replace(/-/g, "_")}`,
).join(",\n                ");

function git(ctx: ServerContext, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("git", args, {
    cwd: ctx.project.workspacePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function requireAncestor(ctx: ServerContext, ancestor: string, descendant: string): void {
  const result = git(ctx, ["merge-base", "--is-ancestor", ancestor, descendant]);
  if (result.status === 0) return;
  if (result.status === 1) {
    throw new ToolError(
      `verification evidence at ${descendant} predates or is outside the repair lineage ${ancestor}`,
    );
  }
  throw new ToolError(
    `cannot compare repair and evidence commits: ${result.stderr?.toString().trim() || "git failed"}`,
  );
}

function stateForStatus(
  status: (typeof FINDING_STATUSES)[number],
): "open" | "accepted" | "ruled-out" {
  if (status === "confirmed-bug") return "open";
  if (status === "confirmed-acceptable") return "accepted";
  return "ruled-out";
}

export const findingTools: ToolDefinition[] = [
  {
    name: "add_finding",
    description:
      "Record a confirmed finding. finding_id conventionally looks like 'B01-1' (subsystem code + sequence). primary_files is a JSON array of file:symbol@sha references. business_context explains why this is (or isn't) a real bug in domain terms. ref_sha is the revision the finding was read at: it must resolve to a commit in the bound workspace, is stored resolved, and is the revision the opening resolution event is placed at.",
    inputSchema: {
      type: "object",
      properties: {
        finding_id: { type: "string" },
        subsystem_id: { type: "string" },
        symptom: { type: "string" },
        root_cause: { type: "string" },
        severity: { type: "string" },
        status: { type: "string" },
        fix_location: { type: "string" },
        primary_files: { type: "array", items: { type: "string" } },
        business_context: { type: "string" },
        ref_sha: { type: "string" },
        session_id: { type: "string" },
        pass_type: { type: "string" },
      },
      required: [
        "finding_id",
        "subsystem_id",
        "symptom",
        "root_cause",
        "severity",
        "status",
        "ref_sha",
        "pass_type",
      ],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "add_finding");
      const findingId = requireString(args, "finding_id");
      const subsystemId = requireString(args, "subsystem_id");
      const symptom = requireString(args, "symptom");
      const rootCause = requireString(args, "root_cause");
      const severity = requireEnum(args, "severity", SEVERITIES);
      const status = requireEnum(args, "status", FINDING_STATUSES);
      const passType = requireEnum(args, "pass_type", PASS_TYPES);
      const rawFixLocation = optString(args, "fix_location");
      const fixLocation = rawFixLocation
        ? requireWorkspaceSourcePath(rawFixLocation, "fix_location")
        : null;
      const primaryFiles = optStringArray(args, "primary_files")?.map((citation) =>
        requireWorkspaceCitation(citation, "primary_files"),
      );
      const businessContext = optString(args, "business_context");
      const requestedRefSha = requireString(args, "ref_sha");
      const sessionId = optString(args, "session_id") ?? ctx.sessionId;

      if (status === "fixed" || status === "ruled-out") {
        throw new ToolError(
          `add_finding cannot create a finding already ${status}; record the finding first, then use the evidence-gated resolution transition`,
        );
      }

      // A finding is a concern-pass artifact at minimum, and an
      // adversarial artifact when the pass is 'adversarial'. The
      // knowledge-depth contract rejects both if the subsystem has not
      // reached the requisite phase.
      const minStatus = passType === "adversarial" ? "adversarial" : "concerns";
      requireSubsystemStatus(ctx.db, subsystemId, minStatus, "add_finding");

      // Resolved in the bound workspace, and stored resolved: the opening
      // resolution event is cut by this revision and every reader reports the
      // finding revision-bound on it, so an unresolvable one would publish a
      // binding the record cannot support (F6/codex). It runs after the
      // authorization gates because a caller writing to the wrong subsystem is
      // better told that than told about its revision, and because a refused
      // write should not spawn a git subprocess first.
      const refSha = resolveWorkspaceCommit(ctx, requestedRefSha);

      try {
        ctx.db.transaction(() => {
          ctx.db
            .prepare(
              `INSERT INTO findings
              (finding_id, subsystem_id, symptom, root_cause, severity, status,
               fix_location, primary_files, business_context, ref_sha, session_id, pass_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              findingId,
              subsystemId,
              symptom,
              rootCause,
              severity,
              status,
              fixLocation,
              primaryFiles ? JSON.stringify(primaryFiles) : null,
              businessContext,
              refSha,
              sessionId,
              passType,
            );
          ctx.db
            .prepare(
              `INSERT INTO finding_resolution_events
                 (finding_id, resolution_state, effective_sha, rationale, session_id)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .run(
              findingId,
              stateForStatus(status),
              // The revision the finding was read at. Without it the opening
              // event carries no revision at all and every historical cut
              // counts it as unplaceable (F5/codex).
              refSha,
              `Finding recorded as ${status}`,
              sessionId,
            );
        })();
      } catch (e) {
        // The PK on findings.finding_id is the only UNIQUE constraint on
        // this table; any other SqliteError is a real failure and must
        // surface unaltered.
        if (e instanceof SqliteError && e.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
          return {
            ok: false,
            error: `finding ${findingId} already exists; use update_finding_status to change it`,
          };
        }
        throw e;
      }
      return ok();
    },
  },
  {
    name: "update_finding_status",
    description:
      "Change a finding's coarse compatibility status. A transition to fixed requires fix_location + fix_sha and creates fixed-pending-verification; it never creates verified-fixed. Use verify_finding_fix with post-fix evidence for that. Overturning to ruled-out requires new disproving evidence attached in the current session.",
    inputSchema: {
      type: "object",
      properties: {
        finding_id: { type: "string" },
        status: { type: "string" },
        fix_location: { type: "string" },
        fix_sha: { type: "string" },
        resolution_note: { type: "string" },
      },
      required: ["finding_id", "status"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "update_finding_status");
      const findingId = requireString(args, "finding_id");
      const status = requireEnum(args, "status", FINDING_STATUSES);
      const rawFixLocation = optString(args, "fix_location");
      const fixLocation = rawFixLocation
        ? requireWorkspaceSourcePath(rawFixLocation, "fix_location")
        : null;
      const requestedFixSha = optString(args, "fix_sha");
      const resolutionNote = optString(args, "resolution_note");
      const row = ctx.db
        .prepare("SELECT status, subsystem_id FROM findings WHERE finding_id = ?")
        .get(findingId) as { status: string; subsystem_id: string } | undefined;
      if (!row) return { ok: false, error: `unknown finding: ${findingId}` };
      // Status updates (including adversarial overturns that flip a
      // confirmed-bug to ruled-out) require the subsystem to be at
      // concerns-pass depth or deeper. An earlier phase lacks the
      // evidentiary base to re-classify a finding.
      requireSubsystemStatus(ctx.db, row.subsystem_id, "concerns", "update_finding_status");
      // Evidence-required-to-overturn: a flip to 'ruled-out' must be backed
      // by new evidence gathered in this session, not a bare reclassification.
      requireOverturnEvidence(ctx.db, findingId, sessionId, row.status, status);
      let fixSha: string | null = null;
      if (status === "fixed") {
        if (!fixLocation || !requestedFixSha) {
          throw new ToolError(
            "fixed requires both fix_location and fix_sha and remains pending until verify_finding_fix succeeds",
          );
        }
        fixSha = resolveWorkspaceCommit(ctx, requestedFixSha, "fix_sha");
      }

      const overturnEvidence =
        status === "ruled-out"
          ? (ctx.db
              .prepare(
                `SELECT e.id, e.ref_sha
                   FROM finding_evidence fe
                   JOIN evidence e ON e.id = fe.evidence_id
                  WHERE fe.finding_id = ? AND e.session_id = ?
                  ORDER BY e.id DESC LIMIT 1`,
              )
              .get(findingId, sessionId) as { id: number; ref_sha: string | null } | undefined)
          : undefined;
      const evidenceId = overturnEvidence?.id ?? null;
      const overturnSha = overturnEvidence?.ref_sha ?? null;
      const resolutionState =
        status === "fixed" ? "fixed-pending-verification" : stateForStatus(status);
      ctx.db.transaction(() => {
        ctx.db
          .prepare(
            "UPDATE findings SET status = ?, fix_location = COALESCE(?, fix_location), updated_at = datetime('now') WHERE finding_id = ?",
          )
          .run(status, fixLocation, findingId);
        ctx.db
          .prepare(
            `INSERT INTO finding_resolution_events
               (finding_id, resolution_state, fix_location, fix_sha, effective_sha,
                evidence_id, rationale, session_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            findingId,
            resolutionState,
            status === "fixed" ? fixLocation : null,
            fixSha,
            // A repair is read at the commit that carries it; an overturn is
            // read at the revision its disproving evidence was collected at.
            fixSha ?? overturnSha,
            evidenceId,
            resolutionNote ?? `Status changed from ${row.status} to ${status}`,
            sessionId,
          );
      })();
      return ok({
        previous_status: row.status,
        resolution_state: resolutionState,
        fix_sha: fixSha,
      });
    },
  },
  {
    name: "verify_finding_fix",
    description:
      "Promote a fixed-pending-verification finding to verified-fixed. The evidence must be attached to the finding, collected in the active session, and repository-bound to the fix commit or one of its descendants. Historical events remain append-only.",
    inputSchema: {
      type: "object",
      properties: {
        finding_id: { type: "string" },
        evidence_id: { type: "integer" },
        verification_note: { type: "string" },
      },
      required: ["finding_id", "evidence_id", "verification_note"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "verify_finding_fix");
      const findingId = requireString(args, "finding_id");
      const evidenceId = requireInt(args, "evidence_id");
      const note = requireString(args, "verification_note");
      const current = ctx.db
        .prepare(
          `SELECT f.status, f.subsystem_id, r.resolution_state, r.fix_location, r.fix_sha
             FROM findings f
             LEFT JOIN finding_resolution_current r ON r.finding_id = f.finding_id
            WHERE f.finding_id = ?`,
        )
        .get(findingId) as
        | {
            status: string;
            subsystem_id: string;
            resolution_state: string | null;
            fix_location: string | null;
            fix_sha: string | null;
          }
        | undefined;
      if (!current) throw new ToolError(`unknown finding: ${findingId}`);
      requireSubsystemStatus(ctx.db, current.subsystem_id, "concerns", "verify_finding_fix");
      if (current.status !== "fixed" || current.resolution_state !== "fixed-pending-verification") {
        throw new ToolError(
          `finding ${findingId} is not fixed-pending-verification (current: ${current.resolution_state ?? current.status})`,
        );
      }
      if (!current.fix_sha || !current.fix_location) {
        throw new ToolError(`finding ${findingId} has no repository-bound repair event`);
      }
      const evidence = ctx.db
        .prepare(
          `SELECT e.ref_sha, e.session_id, fe.role
             FROM evidence e
             JOIN finding_evidence fe ON fe.evidence_id = e.id
            WHERE e.id = ? AND fe.finding_id = ?`,
        )
        .get(evidenceId, findingId) as
        | { ref_sha: string; session_id: string | null; role: string | null }
        | undefined;
      if (!evidence) {
        throw new ToolError(`evidence ${evidenceId} is not attached to finding ${findingId}`);
      }
      if (evidence.session_id !== sessionId) {
        throw new ToolError("verification requires evidence collected in the active session");
      }
      if (evidence.role !== "fix-verification") {
        throw new ToolError("verification evidence must be attached with role fix-verification");
      }
      const fixSha = resolveWorkspaceCommit(ctx, current.fix_sha, "fix_sha");
      const evidenceSha = resolveWorkspaceCommit(
        ctx,
        evidence.ref_sha,
        "the verification evidence ref_sha",
      );
      requireAncestor(ctx, fixSha, evidenceSha);
      ctx.db
        .prepare(
          `INSERT INTO finding_resolution_events
             (finding_id, resolution_state, fix_location, fix_sha, effective_sha,
              evidence_id, rationale, session_id)
           VALUES (?, 'verified-fixed', ?, ?, ?, ?, ?, ?)`,
        )
        // `fix_sha` still names the repair this event confirms; `effective_sha`
        // is the revision the verification itself was read at — a strict
        // descendant, by the requireAncestor check above. A replay that cut by
        // `fix_sha` reported verified-fixed at the repair commit (F5/codex).
        .run(findingId, current.fix_location, fixSha, evidenceSha, evidenceId, note, sessionId);
      return ok({
        finding_id: findingId,
        resolution_state: "verified-fixed",
        fix_sha: fixSha,
        evidence_sha: evidenceSha,
        evidence_id: evidenceId,
      });
    },
  },
  {
    name: "get_finding_resolution_history",
    description:
      "Return the append-only resolution history for one finding, including pending repairs, verification evidence, reopenings, and superseded verified states.",
    inputSchema: {
      type: "object",
      properties: { finding_id: { type: "string" } },
      required: ["finding_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const findingId = requireString(args, "finding_id");
      return ctx.db
        .prepare(
          `SELECT id, origin_key, finding_id, resolution_state, fix_location,
                  fix_sha, evidence_id, rationale, session_id, recorded_at
             FROM finding_resolution_events
            WHERE finding_id = ? ORDER BY id`,
        )
        .all(findingId);
    },
  },
  {
    name: "get_findings",
    description:
      "List findings with optional filters (subsystem_id, severity, status). primary_files is returned as a JSON-parsed array.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        severity: { type: "string" },
        status: { type: "string" },
        resolution_state: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const clauses: string[] = [];
      const params: string[] = [];
      for (const key of ["subsystem_id", "severity", "status", "resolution_state"] as const) {
        const v = optString(args, key);
        if (v != null) {
          clauses.push(key === "resolution_state" ? "resolution_state = ?" : `f.${key} = ?`);
          params.push(v);
        }
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = ctx.db
        .prepare(
          `SELECT f.finding_id, f.subsystem_id, f.symptom, f.root_cause, f.severity, f.status,
                  f.fix_location, f.primary_files, f.business_context, f.ref_sha, f.session_id,
                  f.pass_type, f.created_at, f.updated_at,
                  v.resolution_state, v.fix_sha, v.resolution_evidence_id,
                  v.resolution_recorded_at
             FROM findings f
             JOIN finding_state_current v ON v.finding_id = f.finding_id
             ${where}
             ORDER BY
               CASE f.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                             WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,
               f.subsystem_id, f.finding_id`,
        )
        .all(...params) as Array<{ primary_files: string | null }>;
      return rows.map((r) => ({
        ...r,
        primary_files: r.primary_files ? JSON.parse(r.primary_files) : [],
      }));
    },
  },
  {
    name: "get_finding_summary",
    description:
      "Return per-subsystem roll-up, distinguishing fixed-pending-verification from verified-fixed.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, ctx) => {
      return ctx.db
        .prepare(
          `SELECT f.subsystem_id,
                COUNT(*) AS total,
                SUM(CASE WHEN f.severity='CRITICAL' THEN 1 ELSE 0 END) AS critical,
                SUM(CASE WHEN f.severity='HIGH' THEN 1 ELSE 0 END) AS high,
                SUM(CASE WHEN f.severity='MEDIUM' THEN 1 ELSE 0 END) AS medium,
                SUM(CASE WHEN f.severity='LOW' THEN 1 ELSE 0 END) AS low,
                SUM(CASE WHEN f.status='confirmed-bug' THEN 1 ELSE 0 END) AS open_bugs,
                SUM(CASE WHEN f.status='fixed' THEN 1 ELSE 0 END) AS fixed,
                ${RESOLUTION_STATE_COUNTS}
           FROM findings f
           JOIN finding_state_current v ON v.finding_id=f.finding_id
          GROUP BY f.subsystem_id ORDER BY f.subsystem_id`,
        )
        .all();
    },
  },
];
