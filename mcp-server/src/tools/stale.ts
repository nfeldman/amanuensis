import { ok, optInt, requireInt, requireString, type ToolDefinition } from "../helpers.js";

export const staleTools: ToolDefinition[] = [
  {
    name: "get_stale_backlog",
    description:
      "Return stale entries prioritized by access heat (hottest stale items first). limit defaults to 10. Read from the stale_backlog view.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const limit = optInt(args, "limit", 10) ?? 10;
      return ctx.db
        .prepare(
          "SELECT id, tier, subsystem_id, source_path, ref_sha, stale_since, stale_reason, heat, access_count FROM stale_backlog LIMIT ?",
        )
        .all(limit);
    },
  },
  {
    name: "clear_staleness",
    description:
      "Mark an entry fresh after re-examination. Updates ref_sha to the sha at which the entry was reverified.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        tier: { type: "integer" },
        ref_sha: { type: "string" },
      },
      required: ["id", "tier", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const id = requireString(args, "id");
      const tier = requireInt(args, "tier");
      const refSha = requireString(args, "ref_sha");
      const res = ctx.db
        .prepare(
          `UPDATE entries SET stale = 0, stale_since = NULL, stale_reason = NULL, ref_sha = ?, updated_at = datetime('now')
           WHERE id = ? AND tier = ?`,
        )
        .run(refSha, id, tier);
      if (res.changes === 0) return { ok: false, error: `no entry: ${id} at tier ${tier}` };
      return ok();
    },
  },
];
