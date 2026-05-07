import {
  ok,
  optInt,
  optString,
  requireEnum,
  requireInt,
  requireString,
  type ToolDefinition,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const CATEGORIES = ["pattern", "anomaly", "connection", "tension", "candidate-concern"] as const;

export const fieldNoteTools: ToolDefinition[] = [
  {
    name: "add_field_note",
    description:
      "Record a peripheral observation the phase structure did not ask for. Categories: pattern (recurrence), anomaly (deviation), connection (cross-subsystem), tension (local correctness vs. global coherence), candidate-concern (pattern that might warrant a new concern code).",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        observation: { type: "string" },
        location: { type: "string" },
        ref_sha: { type: "string" },
        session_id: { type: "string" },
      },
      required: ["category", "observation"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "add_field_note");
      const category = requireEnum(args, "category", CATEGORIES);
      const observation = requireString(args, "observation");
      const location = optString(args, "location");
      const refSha = optString(args, "ref_sha");
      const sessionId = optString(args, "session_id") ?? ctx.sessionId;
      const info = ctx.db
        .prepare(
          `INSERT INTO field_notes (category, observation, location, ref_sha, session_id)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(category, observation, location, refSha, sessionId);
      return ok({ id: info.lastInsertRowid });
    },
  },
  {
    name: "get_field_notes",
    description:
      "List field notes, newest first. Filter by category and/or follow_up ('open', a finding ID, or 'dismissed'). limit defaults to 50.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        follow_up: { type: "string" },
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const category = optString(args, "category");
      const followUp = optString(args, "follow_up");
      const limit = optInt(args, "limit", 50) ?? 50;
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (category) {
        clauses.push("category = ?");
        params.push(category);
      }
      if (followUp) {
        clauses.push("follow_up = ?");
        params.push(followUp);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return ctx.db
        .prepare(
          `SELECT id, category, observation, location, ref_sha, follow_up, session_id, created_at
             FROM field_notes ${where}
             ORDER BY created_at DESC
             LIMIT ?`,
        )
        .all(...params, limit);
    },
  },
  {
    name: "resolve_field_note",
    description:
      "Attach a resolution to a field note: a finding ID if it was promoted to a confirmed finding, or 'dismissed' if it was determined not to be relevant. Leaves 'open' for the default pending state.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        follow_up: { type: "string" },
      },
      required: ["id", "follow_up"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "resolve_field_note");
      const id = requireInt(args, "id");
      const followUp = requireString(args, "follow_up");
      const res = ctx.db
        .prepare("UPDATE field_notes SET follow_up = ? WHERE id = ?")
        .run(followUp, id);
      if (res.changes === 0) return { ok: false, error: `unknown field note: ${id}` };
      return ok();
    },
  },
];
