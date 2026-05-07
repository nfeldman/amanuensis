import {
  ok,
  optBool,
  optString,
  requireEnum,
  requireString,
  type ToolDefinition,
} from "../helpers.js";
import { requireActiveSession, requireSubsystemStatus } from "../invariants.js";

const CLASSIFICATIONS = [
  "confirmed-bug",
  "confirmed-acceptable",
  "ruled-out",
  "out-of-scope",
  "unresolved-competition",
] as const;
const EVIDENCE_QUALITY = [
  "code-verified",
  "contract-stated",
  "comment-asserted",
  "name-inferred",
  "pattern-matched",
] as const;
const PASS_TYPES = ["onboarding", "survey", "adversarial", "refresh"] as const;

export const dispositionTools: ToolDefinition[] = [
  {
    name: "set_disposition",
    description:
      "Record how a concern applies to a subsystem. Every disposition must carry evidence (file:symbol@sha), evidence_quality (how solid that evidence is), a rationale, and the pass that produced it. This is the primary DB analog of the subsystem survey's Concern Disposition Table.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        concern_code: { type: "string" },
        classification: { type: "string" },
        evidence: { type: "string" },
        evidence_quality: { type: "string" },
        linchpin_dependent: { type: "boolean" },
        rationale: { type: "string" },
        ref_sha: { type: "string" },
        session_id: { type: "string" },
        pass_type: { type: "string" },
      },
      required: [
        "subsystem_id",
        "concern_code",
        "classification",
        "evidence",
        "evidence_quality",
        "rationale",
        "ref_sha",
        "pass_type",
      ],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "set_disposition");
      const subsystemId = requireString(args, "subsystem_id");
      const concernCode = requireString(args, "concern_code");
      const classification = requireEnum(args, "classification", CLASSIFICATIONS);
      const evidence = requireString(args, "evidence");
      const evidenceQuality = requireEnum(args, "evidence_quality", EVIDENCE_QUALITY);
      const linchpin = optBool(args, "linchpin_dependent", false);
      const rationale = requireString(args, "rationale");
      const refSha = requireString(args, "ref_sha");
      const passType = requireEnum(args, "pass_type", PASS_TYPES);
      const sessionId = optString(args, "session_id") ?? ctx.sessionId;

      // Knowledge-depth contract: dispositions are only authorized
      // once the subsystem has reached the concerns pass. Adversarial
      // writes reach higher still. The gate rejects premature writes
      // instead of silently accepting claims a structural or scoping
      // survey cannot support.
      const minStatus = passType === "adversarial" ? "adversarial" : "concerns";
      requireSubsystemStatus(ctx.db, subsystemId, minStatus, "set_disposition");

      // Verify the concern exists to avoid silent FK-style orphans.
      const concernExists = ctx.db
        .prepare("SELECT 1 FROM concerns WHERE code = ?")
        .get(concernCode);
      if (!concernExists) {
        return { ok: false, error: `concern ${concernCode} does not exist — add it first` };
      }

      ctx.db
        .prepare(
          `INSERT INTO dispositions
            (subsystem_id, concern_code, classification, evidence, evidence_quality,
             linchpin_dependent, rationale, ref_sha, session_id, pass_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(subsystem_id, concern_code) DO UPDATE SET
             classification = excluded.classification,
             evidence = excluded.evidence,
             evidence_quality = excluded.evidence_quality,
             linchpin_dependent = excluded.linchpin_dependent,
             rationale = excluded.rationale,
             assessed_at = datetime('now'),
             ref_sha = excluded.ref_sha,
             session_id = excluded.session_id,
             pass_type = excluded.pass_type`,
        )
        .run(
          subsystemId,
          concernCode,
          classification,
          evidence,
          evidenceQuality,
          linchpin ? 1 : 0,
          rationale,
          refSha,
          sessionId,
          passType,
        );
      return ok();
    },
  },
  {
    name: "get_dispositions",
    description:
      "Return dispositions. Filter by subsystem_id, concern_code, or both. Omit both to return everything (useful for adversarial review across the conspectus).",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        concern_code: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = optString(args, "subsystem_id");
      const concernCode = optString(args, "concern_code");
      const clauses: string[] = [];
      const params: string[] = [];
      if (subsystemId) {
        clauses.push("subsystem_id = ?");
        params.push(subsystemId);
      }
      if (concernCode) {
        clauses.push("concern_code = ?");
        params.push(concernCode);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return ctx.db
        .prepare(
          `SELECT subsystem_id, concern_code, classification, evidence, evidence_quality,
                  linchpin_dependent, rationale, ref_sha, session_id, pass_type, assessed_at
             FROM dispositions ${where}
             ORDER BY subsystem_id, concern_code`,
        )
        .all(...params);
    },
  },
  {
    name: "get_concern_coverage",
    description:
      "Return the concern × subsystem matrix (active concerns × registered subsystems) with current disposition or '—' for unexamined cells. Used to produce the materialized heatmap.",
    inputSchema: {
      type: "object",
      properties: { subsystem_id: { type: "string" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = optString(args, "subsystem_id");
      // Coverage is the cartesian product of active concerns × registered
      // subsystems, left-joined with dispositions so unexamined cells
      // surface as the em-dash sentinel. We let SQLite assemble the matrix
      // rather than reconstituting it row-by-row in JS — for a populated
      // conspectus this is one query instead of three plus a hash join.
      const sql = `
        SELECT c.code AS concern_code,
               c.category AS category,
               s.id AS subsystem_id,
               COALESCE(d.classification, '—') AS disposition,
               d.assessed_at AS assessed_at
          FROM concerns c
          CROSS JOIN subsystems s
          LEFT JOIN dispositions d
            ON d.concern_code = c.code AND d.subsystem_id = s.id
         WHERE c.status = 'active' ${subsystemId ? "AND s.id = ?" : ""}
         ORDER BY s.id, c.code`;
      const stmt = ctx.db.prepare(sql);
      return (subsystemId ? stmt.all(subsystemId) : stmt.all()) as Array<{
        concern_code: string;
        category: string | null;
        subsystem_id: string;
        disposition: string;
        assessed_at: string | null;
      }>;
    },
  },
];
