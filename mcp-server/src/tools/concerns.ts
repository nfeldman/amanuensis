import { ok, optString, requireEnum, requireString, type ToolDefinition } from "../helpers.js";

export const concernTools: ToolDefinition[] = [
  {
    name: "list_concerns",
    description:
      "Return concern codes with status and origin. Use status_filter='active' to get the working checklist; 'retired' and 'merged' are excluded by default only if a filter is passed.",
    inputSchema: {
      type: "object",
      properties: { status_filter: { type: "string" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const statusFilter = optString(args, "status_filter");
      const rows = statusFilter
        ? ctx.db
            .prepare(
              "SELECT code, category, origin, status, notes FROM concerns WHERE status = ? ORDER BY code",
            )
            .all(statusFilter)
        : ctx.db
            .prepare("SELECT code, category, origin, status, notes FROM concerns ORDER BY code")
            .all();
      return rows;
    },
  },
  {
    name: "add_concern",
    description:
      "Add a concern to the calibrated checklist. origin='seeded' for concerns derived from territory map; 'discovered' for those found mid-survey. Use codes like CC-1 (cache coherence #1), SC-3 (seam contract #3).",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        category: { type: "string" },
        origin: { type: "string", enum: ["seeded", "discovered"] },
        discovered_in: { type: "string" },
        notes: { type: "string" },
      },
      required: ["code", "origin"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const code = requireString(args, "code");
      const origin = requireEnum(args, "origin", ["seeded", "discovered"] as const);
      const category = optString(args, "category");
      const discoveredIn = optString(args, "discovered_in");
      const notes = optString(args, "notes");
      ctx.db
        .prepare(
          `INSERT INTO concerns (code, category, origin, discovered_in, notes, status)
           VALUES (?, ?, ?, ?, ?, 'active')
           ON CONFLICT(code) DO UPDATE SET
             category=excluded.category,
             notes=excluded.notes`,
        )
        .run(code, category, origin, discoveredIn, notes);
      return ok();
    },
  },
  {
    name: "retire_concern",
    description:
      "Retire a concern or merge it into another. For action='merge', provide merged_into. Retiring records a final state — it does not delete the row, so historical dispositions keyed on this code remain readable.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        action: { type: "string", enum: ["retire", "merge"] },
        merged_into: { type: "string" },
      },
      required: ["code", "action"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const code = requireString(args, "code");
      const action = requireEnum(args, "action", ["retire", "merge"] as const);
      const mergedInto = optString(args, "merged_into");
      if (action === "merge" && !mergedInto) {
        return { ok: false, error: "merge requires merged_into" };
      }
      if (action === "merge" && mergedInto) {
        const exists = ctx.db.prepare("SELECT 1 FROM concerns WHERE code = ?").get(mergedInto);
        if (!exists)
          return { ok: false, error: `merged_into concern ${mergedInto} does not exist` };
      }
      ctx.db
        .prepare("UPDATE concerns SET status = ?, merged_into = ? WHERE code = ?")
        .run(action === "retire" ? "retired" : "merged", mergedInto, code);
      return ok();
    },
  },
];
