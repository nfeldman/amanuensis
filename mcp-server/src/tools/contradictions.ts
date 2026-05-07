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
      "Apply a resolution to a contradiction. resolution ∈ {a-supersedes-b, b-supersedes-a, scope-distinction, unresolved}. scope_note is required for scope-distinction and documents why the findings apply to distinct scopes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        resolution: { type: "string" },
        scope_note: { type: "string" },
        session_id: { type: "string" },
      },
      required: ["id", "resolution"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "resolve_contradiction");
      const id = requireInt(args, "id");
      const resolution = requireEnum(args, "resolution", RESOLUTIONS);
      const scopeNote = optString(args, "scope_note");
      const sessionId = optString(args, "session_id") ?? ctx.sessionId;
      if (resolution === "scope-distinction" && !scopeNote) {
        return { ok: false, error: "scope-distinction requires scope_note" };
      }
      const res = ctx.db
        .prepare(
          `UPDATE contradictions
             SET resolution=?, scope_note=?, resolved_at=datetime('now'), session_id=?
             WHERE id=?`,
        )
        .run(resolution, scopeNote, sessionId, id);
      if (res.changes === 0) return { ok: false, error: `unknown contradiction: ${id}` };
      return ok();
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
                    resolution, scope_note, detected_at, resolved_at, session_id
               FROM contradictions ORDER BY detected_at DESC`,
          )
          .all();
      }
      return ctx.db
        .prepare(
          `SELECT id, finding_a, finding_b, shared_location, conflict_type,
                  resolution, scope_note, detected_at, resolved_at, session_id
             FROM contradictions
             WHERE resolution = ?
             ORDER BY detected_at DESC`,
        )
        .all(filter);
    },
  },
];
