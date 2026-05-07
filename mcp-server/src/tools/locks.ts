import { ok, optInt, optString, requireString, type ToolDefinition } from "../helpers.js";

export const lockTools: ToolDefinition[] = [
  {
    name: "acquire_lock",
    description:
      "Acquire a write lock on an artifact path (relative to project storage). Used by the coordinator to serialize sub-agent writes to the same artifact. ttl_minutes defaults to 15. Returns {ok:true} on success, or {ok:false, held_by, expires_at} when the artifact is already locked.",
    inputSchema: {
      type: "object",
      properties: {
        artifact_path: { type: "string" },
        holder_id: { type: "string" },
        intent: { type: "string" },
        ttl_minutes: { type: "integer" },
      },
      required: ["artifact_path", "holder_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const artifactPath = requireString(args, "artifact_path");
      const holderId = requireString(args, "holder_id");
      const intent = optString(args, "intent");
      const ttl = optInt(args, "ttl_minutes", 15) ?? 15;
      // Clear expired holders first.
      ctx.db
        .prepare(
          "DELETE FROM write_locks WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')",
        )
        .run();
      const existing = ctx.db
        .prepare(
          "SELECT holder_id, acquired_at, expires_at, intent FROM write_locks WHERE artifact_path = ?",
        )
        .get(artifactPath) as
        | {
            holder_id: string;
            acquired_at: string;
            expires_at: string | null;
            intent: string | null;
          }
        | undefined;
      if (existing && existing.holder_id !== holderId) {
        return {
          ok: false,
          held_by: existing.holder_id,
          acquired_at: existing.acquired_at,
          expires_at: existing.expires_at,
          intent: existing.intent,
        };
      }
      // Fresh acquisition (or same holder extending).
      ctx.db
        .prepare(
          `INSERT INTO write_locks (artifact_path, holder_id, intent, expires_at)
           VALUES (?, ?, ?, datetime('now', ? || ' minutes'))
           ON CONFLICT(artifact_path) DO UPDATE SET
             holder_id = excluded.holder_id,
             intent = excluded.intent,
             expires_at = excluded.expires_at,
             acquired_at = datetime('now')`,
        )
        .run(artifactPath, holderId, intent, `+${ttl}`);
      return ok();
    },
  },
  {
    name: "release_lock",
    description:
      "Release a write lock. Only the holder may release it. Safe to call even if no lock exists.",
    inputSchema: {
      type: "object",
      properties: {
        artifact_path: { type: "string" },
        holder_id: { type: "string" },
      },
      required: ["artifact_path", "holder_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const artifactPath = requireString(args, "artifact_path");
      const holderId = requireString(args, "holder_id");
      ctx.db
        .prepare("DELETE FROM write_locks WHERE artifact_path = ? AND holder_id = ?")
        .run(artifactPath, holderId);
      return ok();
    },
  },
  {
    name: "get_active_locks",
    description:
      "Return all currently held (non-expired) locks. Reads from the active_write_locks view.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, ctx) => {
      return ctx.db
        .prepare(
          "SELECT artifact_path, holder_id, acquired_at, expires_at, intent FROM active_write_locks ORDER BY acquired_at",
        )
        .all();
    },
  },
];
