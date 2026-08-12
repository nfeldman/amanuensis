import {
  ok,
  optString,
  requireEnum,
  requireExistingIds,
  requireInt,
  requireString,
  type ToolDefinition,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const RESOLUTIONS = [
  "a-supersedes-b",
  "b-supersedes-a",
  "scope-distinction",
  "unresolved",
] as const;

export const contradictionTools: ToolDefinition[] = [
  {
    name: "add_contradiction",
    description:
      "Record a contradiction between two findings. Use when the same file/symbol is implicated in findings whose classifications or severities are logically incompatible. conflict_type: 'classification-conflict', 'severity-conflict', etc. Leaves the contradiction as 'unresolved' until resolve_contradiction is called.",
    inputSchema: {
      type: "object",
      properties: {
        finding_a: { type: "string" },
        finding_b: { type: "string" },
        shared_location: { type: "string" },
        conflict_type: { type: "string" },
      },
      required: ["finding_a", "finding_b", "conflict_type"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "add_contradiction");
      const findingA = requireString(args, "finding_a");
      const findingB = requireString(args, "finding_b");
      const conflictType = requireString(args, "conflict_type");
      const sharedLocation = optString(args, "shared_location");
      // Guard against orphan references — the FK constraint would reject
      // these anyway; surfacing the clearer error here also lets the
      // agent see both missing IDs at once when both are wrong.
      requireExistingIds(ctx.db, "findings", "finding_id", [findingA, findingB], "finding(s)");
      const info = ctx.db
        .prepare(
          `INSERT INTO contradictions (finding_a, finding_b, shared_location, conflict_type, resolution)
           VALUES (?, ?, ?, ?, 'unresolved')`,
        )
        .run(findingA, findingB, sharedLocation, conflictType);
      return ok({ id: info.lastInsertRowid });
    },
  },
  {
    name: "resolve_contradiction",
    description:
      "Apply an evidence-backed resolution to a contradiction and append its proof history. Non-unresolved resolutions require structured evidence collected in the active session, attached to one of the contradictory findings, plus a rationale. scope_note is additionally required for scope-distinction.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        resolution: { type: "string" },
        scope_note: { type: "string" },
        evidence_id: { type: "integer" },
        rationale: { type: "string" },
      },
      required: ["id", "resolution", "rationale"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "resolve_contradiction");
      const id = requireInt(args, "id");
      const resolution = requireEnum(args, "resolution", RESOLUTIONS);
      const scopeNote = optString(args, "scope_note");
      const rationale = requireString(args, "rationale");
      const evidenceId = args.evidence_id == null ? null : requireInt(args, "evidence_id");
      if (resolution === "scope-distinction" && !scopeNote) {
        return { ok: false, error: "scope-distinction requires scope_note" };
      }
      if (resolution !== "unresolved") {
        if (evidenceId === null) {
          return { ok: false, error: "resolved contradiction requires evidence_id" };
        }
        const evidence = ctx.db
          .prepare(
            `SELECT e.session_id,
                    EXISTS (
                      SELECT 1
                        FROM contradictions c
                        JOIN finding_evidence fe
                          ON fe.finding_id IN (c.finding_a, c.finding_b)
                       WHERE c.id=? AND fe.evidence_id=e.id
                    ) AS attached_to_party
               FROM evidence e WHERE e.id=?`,
          )
          .get(id, evidenceId) as
          | { session_id: string | null; attached_to_party: number }
          | undefined;
        if (!evidence) return { ok: false, error: `unknown evidence: ${evidenceId}` };
        if (evidence.session_id !== sessionId) {
          return {
            ok: false,
            error: "contradiction resolution requires evidence from the active session",
          };
        }
        if (!evidence.attached_to_party) {
          return {
            ok: false,
            error: "contradiction resolution evidence must be attached to one of its findings",
          };
        }
      }
      const exists = ctx.db.prepare("SELECT 1 FROM contradictions WHERE id=?").get(id);
      if (!exists) return { ok: false, error: `unknown contradiction: ${id}` };
      ctx.db.transaction(() => {
        ctx.db
          .prepare(
            `UPDATE contradictions
               SET resolution=?, scope_note=?,
                   resolved_at=CASE WHEN ?='unresolved' THEN NULL ELSE datetime('now') END,
                   session_id=?
               WHERE id=?`,
          )
          .run(resolution, scopeNote, resolution, sessionId, id);
        ctx.db
          .prepare(
            `INSERT INTO contradiction_resolution_events
               (contradiction_id, resolution, scope_note, evidence_id, rationale, session_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(id, resolution, scopeNote, evidenceId, rationale, sessionId);
      })();
      return ok({ evidence_id: evidenceId });
    },
  },
  {
    name: "get_contradictions",
    description:
      "List contradictions. resolution_filter defaults to 'unresolved'; pass 'all' to return every row regardless of status.",
    inputSchema: {
      type: "object",
      properties: { resolution_filter: { type: "string" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const filter = optString(args, "resolution_filter") ?? "unresolved";
      if (filter === "all") {
        return ctx.db
          .prepare(
            `SELECT id, finding_a, finding_b, shared_location, conflict_type,
                    resolution, scope_note, detected_at, resolved_at, session_id,
                    (SELECT evidence_id FROM contradiction_resolution_events cre
                      WHERE cre.contradiction_id=contradictions.id ORDER BY cre.id DESC LIMIT 1)
                      AS resolution_evidence_id
               FROM contradictions ORDER BY detected_at DESC`,
          )
          .all();
      }
      return ctx.db
        .prepare(
          `SELECT id, finding_a, finding_b, shared_location, conflict_type,
                  resolution, scope_note, detected_at, resolved_at, session_id,
                  (SELECT evidence_id FROM contradiction_resolution_events cre
                    WHERE cre.contradiction_id=contradictions.id ORDER BY cre.id DESC LIMIT 1)
                    AS resolution_evidence_id
             FROM contradictions
             WHERE resolution = ?
             ORDER BY detected_at DESC`,
        )
        .all(filter);
    },
  },
];
