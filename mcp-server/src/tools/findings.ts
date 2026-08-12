import { spawnSync } from "node:child_process";
import { SqliteError } from "better-sqlite3";
import {
  ok,
  optString,
  optStringArray,
  requireEnum,
  requireInt,
  requireString,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import {
  requireActiveSession,
  requireOverturnEvidence,
  requireSubsystemStatus,
} from "../invariants.js";

const SEVERITY = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const STATUS = ["confirmed-bug", "confirmed-acceptable", "fixed", "ruled-out"] as const;
const PASS_TYPES = ["onboarding", "survey", "adversarial", "refresh"] as const;

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

function stateForStatus(status: (typeof STATUS)[number]): "open" | "accepted" | "ruled-out" {
  if (status === "confirmed-bug") return "open";
  if (status === "confirmed-acceptable") return "accepted";
  return "ruled-out";
}

export const findingTools: ToolDefinition[] = [
  {
    name: "add_finding",
    description:
      "Record a confirmed finding. finding_id conventionally looks like 'B01-1' (subsystem code + sequence). primary_files is a JSON array of file:symbol@sha references. business_context explains why this is (or isn't) a real bug in domain terms.",
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
      const severity = requireEnum(args, "severity", SEVERITY);
      const status = requireEnum(args, "status", STATUS);
      const passType = requireEnum(args, "pass_type", PASS_TYPES);
      const fixLocation = optString(args, "fix_location");
      const primaryFiles = optStringArray(args, "primary_files");
      const businessContext = optString(args, "business_context");
      const refSha = requireString(args, "ref_sha");
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
                 (finding_id, resolution_state, rationale, session_id)
               VALUES (?, ?, ?, ?)`,
            )
            .run(findingId, stateForStatus(status), `Finding recorded as ${status}`, sessionId);
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
      const status = requireEnum(args, "status", STATUS);
      const fixLocation = optString(args, "fix_location");
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
        fixSha = resolveCommit(ctx, requestedFixSha);
      }

      const evidenceId =
        status === "ruled-out"
          ? ((
              ctx.db
                .prepare(
                  `SELECT e.id
                     FROM finding_evidence fe
                     JOIN evidence e ON e.id = fe.evidence_id
                    WHERE fe.finding_id = ? AND e.session_id = ?
                    ORDER BY e.id DESC LIMIT 1`,
                )
                .get(findingId, sessionId) as { id: number } | undefined
            )?.id ?? null)
          : null;
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
               (finding_id, resolution_state, fix_location, fix_sha, evidence_id,
                rationale, session_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            findingId,
            resolutionState,
            status === "fixed" ? fixLocation : null,
            fixSha,
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
      const fixSha = resolveCommit(ctx, current.fix_sha);
      const evidenceSha = resolveCommit(ctx, evidence.ref_sha);
      requireAncestor(ctx, fixSha, evidenceSha);
      ctx.db
        .prepare(
          `INSERT INTO finding_resolution_events
             (finding_id, resolution_state, fix_location, fix_sha, evidence_id,
              rationale, session_id)
           VALUES (?, 'verified-fixed', ?, ?, ?, ?, ?)`,
        )
        .run(findingId, current.fix_location, fixSha, evidenceId, note, sessionId);
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
                  COALESCE(r.resolution_state,
                    CASE f.status WHEN 'fixed' THEN 'fixed-pending-verification'
                                  WHEN 'ruled-out' THEN 'ruled-out'
                                  WHEN 'confirmed-acceptable' THEN 'accepted'
                                  ELSE 'open' END) AS resolution_state,
                  r.fix_sha, r.evidence_id AS resolution_evidence_id,
                  r.recorded_at AS resolution_recorded_at
             FROM findings f
             LEFT JOIN finding_resolution_current r ON r.finding_id = f.finding_id
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
                SUM(CASE WHEN COALESCE(r.resolution_state,
                    CASE WHEN f.status='fixed' THEN 'fixed-pending-verification' END)
                    = 'fixed-pending-verification' THEN 1 ELSE 0 END) AS fixed_pending_verification,
                SUM(CASE WHEN r.resolution_state='verified-fixed' THEN 1 ELSE 0 END) AS verified_fixed
           FROM findings f
           LEFT JOIN finding_resolution_current r ON r.finding_id=f.finding_id
          GROUP BY f.subsystem_id ORDER BY f.subsystem_id`,
        )
        .all();
    },
  },
];
