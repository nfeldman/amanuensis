import { SqliteError } from "better-sqlite3";
import {
  ok,
  optString,
  optStringArray,
  requireEnum,
  requireString,
  type ToolDefinition,
} from "../helpers.js";
import { requireActiveSession, requireSubsystemStatus } from "../invariants.js";

const SEVERITY = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const STATUS = ["confirmed-bug", "confirmed-acceptable", "fixed", "ruled-out"] as const;
const PASS_TYPES = ["onboarding", "survey", "adversarial", "refresh"] as const;

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

      // A finding is a concern-pass artifact at minimum, and an
      // adversarial artifact when the pass is 'adversarial'. The
      // knowledge-depth contract rejects both if the subsystem has not
      // reached the requisite phase.
      const minStatus = passType === "adversarial" ? "adversarial" : "concerns";
      requireSubsystemStatus(ctx.db, subsystemId, minStatus, "add_finding");

      try {
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
      "Change a finding's status (e.g., confirmed-bug → fixed). Optionally record fix_location. Returns previous_status.",
    inputSchema: {
      type: "object",
      properties: {
        finding_id: { type: "string" },
        status: { type: "string" },
        fix_location: { type: "string" },
      },
      required: ["finding_id", "status"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "update_finding_status");
      const findingId = requireString(args, "finding_id");
      const status = requireEnum(args, "status", STATUS);
      const fixLocation = optString(args, "fix_location");
      const row = ctx.db
        .prepare("SELECT status, subsystem_id FROM findings WHERE finding_id = ?")
        .get(findingId) as { status: string; subsystem_id: string } | undefined;
      if (!row) return { ok: false, error: `unknown finding: ${findingId}` };
      // Status updates (including adversarial overturns that flip a
      // confirmed-bug to ruled-out) require the subsystem to be at
      // concerns-pass depth or deeper. An earlier phase lacks the
      // evidentiary base to re-classify a finding.
      requireSubsystemStatus(ctx.db, row.subsystem_id, "concerns", "update_finding_status");
      ctx.db
        .prepare(
          "UPDATE findings SET status = ?, fix_location = COALESCE(?, fix_location), updated_at = datetime('now') WHERE finding_id = ?",
        )
        .run(status, fixLocation, findingId);
      return ok({ previous_status: row.status });
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
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const clauses: string[] = [];
      const params: string[] = [];
      for (const key of ["subsystem_id", "severity", "status"] as const) {
        const v = optString(args, key);
        if (v != null) {
          clauses.push(`${key} = ?`);
          params.push(v);
        }
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = ctx.db
        .prepare(
          `SELECT finding_id, subsystem_id, symptom, root_cause, severity, status,
                  fix_location, primary_files, business_context, ref_sha, session_id,
                  pass_type, created_at, updated_at
             FROM findings ${where}
             ORDER BY
               CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                             WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,
               subsystem_id, finding_id`,
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
      "Return per-subsystem severity/status roll-up (total, critical, high, medium, low, open_bugs, fixed). Reads from the finding_summary view.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, ctx) => {
      return ctx.db
        .prepare(
          "SELECT subsystem_id, total_findings AS total, critical, high, medium, low, open_bugs, fixed FROM finding_summary ORDER BY subsystem_id",
        )
        .all();
    },
  },
];
