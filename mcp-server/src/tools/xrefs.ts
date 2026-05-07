import { ok, optString, requireString, type ToolDefinition } from "../helpers.js";

export const xrefTools: ToolDefinition[] = [
  {
    name: "add_xref",
    description:
      "Record a cross-reference between two subsystems. relationship is free-form but should use one of the canonical values: shared-pattern, data-flow, dependency, mirrors, contention, temporal-coupling. strength ∈ {observed, confirmed, structural}; defaults to 'observed'.",
    inputSchema: {
      type: "object",
      properties: {
        from_id: { type: "string" },
        to_id: { type: "string" },
        relationship: { type: "string" },
        strength: { type: "string", enum: ["observed", "confirmed", "structural"] },
        context: { type: "string" },
      },
      required: ["from_id", "to_id", "relationship"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const fromId = requireString(args, "from_id");
      const toId = requireString(args, "to_id");
      const relationship = requireString(args, "relationship");
      const strength = optString(args, "strength") ?? "observed";
      const context = optString(args, "context");
      ctx.db
        .prepare(
          `INSERT INTO xrefs (from_id, to_id, relationship, strength, context)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(from_id, to_id, relationship) DO UPDATE SET
             strength = excluded.strength,
             context = excluded.context`,
        )
        .run(fromId, toId, relationship, strength, context);
      return ok();
    },
  },
  {
    name: "get_xrefs",
    description: "Return cross-references involving a subsystem (as either source or target).",
    inputSchema: {
      type: "object",
      properties: { subsystem_id: { type: "string" } },
      required: ["subsystem_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = requireString(args, "subsystem_id");
      return ctx.db
        .prepare(
          `SELECT from_id, to_id, relationship, strength, context, discovered_at
             FROM xrefs
             WHERE from_id = ? OR to_id = ?
             ORDER BY discovered_at DESC`,
        )
        .all(subsystemId, subsystemId);
    },
  },
];
