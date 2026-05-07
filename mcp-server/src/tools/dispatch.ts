import {
  ok,
  optString,
  optStringArray,
  requireInt,
  requireString,
  type ToolDefinition,
} from "../helpers.js";

export const dispatchTools: ToolDefinition[] = [
  {
    name: "log_dispatch",
    description:
      "Record a sub-agent dispatch. Use role ∈ {mapping-agent, memory-auditor, explore, custom}. file_path points to the dispatch record (e.g., _meta/prompts/<timestamp>-<role>-<seq>.md). Status starts as 'dispatched'.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        seq: { type: "integer" },
        role: { type: "string" },
        file_path: { type: "string" },
        subsystem_id: { type: "string" },
      },
      required: ["session_id", "seq", "role", "file_path"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireString(args, "session_id");
      const seq = requireInt(args, "seq");
      const role = requireString(args, "role");
      const filePath = requireString(args, "file_path");
      const subsystemId = optString(args, "subsystem_id");
      ctx.db
        .prepare(
          `INSERT INTO subagent_log (session_id, seq, role, file_path, subsystem_id, status)
           VALUES (?, ?, ?, ?, ?, 'dispatched')`,
        )
        .run(sessionId, seq, role, filePath, subsystemId);
      return ok();
    },
  },
  {
    name: "complete_dispatch",
    description:
      "Mark a dispatch complete. artifacts_written is a JSON array of paths the sub-agent wrote to.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        seq: { type: "integer" },
        artifacts_written: { type: "array", items: { type: "string" } },
      },
      required: ["session_id", "seq"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireString(args, "session_id");
      const seq = requireInt(args, "seq");
      const artifacts = optStringArray(args, "artifacts_written");
      const res = ctx.db
        .prepare(
          `UPDATE subagent_log SET status='completed', completed_at=datetime('now'),
            artifacts_written = COALESCE(?, artifacts_written)
           WHERE session_id = ? AND seq = ?`,
        )
        .run(artifacts ? JSON.stringify(artifacts) : null, sessionId, seq);
      if (res.changes === 0) {
        return { ok: false, error: `no dispatch for session ${sessionId} seq ${seq}` };
      }
      return ok();
    },
  },
  {
    name: "get_dispatch_history",
    description:
      "List dispatch records, newest first. Filter by session_id; omit to get the global history.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = optString(args, "session_id");
      const rows = (
        sessionId
          ? ctx.db
              .prepare(
                `SELECT session_id, seq, role, dispatched_at, completed_at, status, file_path, subsystem_id, artifacts_written
                   FROM subagent_log WHERE session_id = ? ORDER BY seq`,
              )
              .all(sessionId)
          : ctx.db
              .prepare(
                `SELECT session_id, seq, role, dispatched_at, completed_at, status, file_path, subsystem_id, artifacts_written
                   FROM subagent_log ORDER BY dispatched_at DESC LIMIT 100`,
              )
              .all()
      ) as Array<{ artifacts_written: string | null }>;
      return rows.map((r) => ({
        ...r,
        artifacts_written: r.artifacts_written ? JSON.parse(r.artifacts_written) : [],
      }));
    },
  },
];
