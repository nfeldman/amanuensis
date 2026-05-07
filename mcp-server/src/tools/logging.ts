import { ok, optString, requireInt, requireString, type ToolDefinition } from "../helpers.js";

// Demand priority used when no query_log evidence exists yet. Order
// reflects the schema's documented field-importance ranking. Update
// this single list if the seven-field contract gains or reshapes a
// field.
const FIELD_DEMAND_DEFAULT_PRIORITY = [
  "what",
  "how",
  "see-also",
  "where",
  "why",
  "confidence",
  "when",
] as const;

export const loggingTools: ToolDefinition[] = [
  {
    name: "log_access",
    description:
      "Record that an entry was loaded or read (for access-heat tracking). trigger is free text like 'phase-3 read' or 'xref from B-02'. entry_tier ∈ {0, 1, 2}.",
    inputSchema: {
      type: "object",
      properties: {
        entry_id: { type: "string" },
        entry_tier: { type: "integer" },
        trigger: { type: "string" },
        session_id: { type: "string" },
      },
      required: ["entry_id", "entry_tier"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const entryId = requireString(args, "entry_id");
      const entryTier = requireInt(args, "entry_tier");
      const trigger = optString(args, "trigger");
      const sessionId = optString(args, "session_id") ?? ctx.sessionId;
      ctx.db
        .prepare(
          "INSERT INTO access_log (entry_id, entry_tier, trigger, session_id) VALUES (?, ?, ?, ?)",
        )
        .run(entryId, entryTier, trigger, sessionId);
      return ok();
    },
  },
  {
    name: "log_query",
    description:
      "Record a human query and which of the seven fields the answer drew on (what, why, how, when, where, see-also, confidence). tier_reached is the deepest tier the agent had to load (0–3). Used to compute field demand for adaptive compression.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        fields_hit: { type: "array", items: { type: "string" } },
        tier_reached: { type: "integer" },
        subsystem_id: { type: "string" },
        session_id: { type: "string" },
      },
      required: ["question", "fields_hit", "tier_reached"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const question = requireString(args, "question");
      const tierReached = requireInt(args, "tier_reached");
      const fields = args.fields_hit;
      if (!Array.isArray(fields) || fields.some((f) => typeof f !== "string")) {
        return { ok: false, error: "fields_hit must be string[]" };
      }
      const subsystemId = optString(args, "subsystem_id");
      const sessionId = optString(args, "session_id") ?? ctx.sessionId;
      ctx.db
        .prepare(
          `INSERT INTO query_log (question, fields_hit, tier_reached, subsystem_id, session_id)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(question, JSON.stringify(fields), tierReached, subsystemId, sessionId);
      return ok();
    },
  },
  {
    name: "get_field_demand",
    description:
      "Return demand ranking across the seven fields (what, why, how, when, where, see-also, confidence). Used to prioritize what gets preserved during Tier 2 → Tier 1 compression.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, ctx) => {
      const hasData = ctx.db.prepare("SELECT 1 FROM query_log LIMIT 1").get();
      if (!hasData) {
        return FIELD_DEMAND_DEFAULT_PRIORITY.map((field) => ({
          field,
          demand_count: 0,
          demand_ratio: 0,
          default: true,
        }));
      }
      return ctx.db
        .prepare(
          "SELECT field, demand_count, demand_ratio, last_demanded, avg_tier_reached FROM field_demand",
        )
        .all();
    },
  },
];
