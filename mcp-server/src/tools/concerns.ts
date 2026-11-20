import {
  ok,
  optString,
  requireEnum,
  requireString,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";

/** A territory of `concern-territories.md`, named by its id: T1, T2, … */
export const TERRITORY_ID = /^T[1-9]\d*$/;
/** A probe is a sentence or two; the cap keeps `list_concerns`, which serves every row, bounded. */
const PROBE_CAP = 1200;

export const concernTools: ToolDefinition[] = [
  {
    name: "list_concerns",
    description:
      "Return concern codes with status, origin, the territory each was seeded from and the probe that tests it. Use status_filter='active' to get the working checklist; 'retired' and 'merged' are excluded by default only if a filter is passed.",
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
              "SELECT code, category, origin, status, notes, territory, probe FROM concerns WHERE status = ? ORDER BY code",
            )
            .all(statusFilter)
        : ctx.db
            .prepare(
              "SELECT code, category, origin, status, notes, territory, probe FROM concerns ORDER BY code",
            )
            .all();
      return rows;
    },
  },
  {
    name: "add_concern",
    description:
      "Add a concern to the calibrated checklist. origin='seeded' for concerns derived from territory map; 'discovered' for those found mid-survey. Use codes like CC-1 (cache coherence #1), SC-3 (seam contract #3). territory is the id of the territory of concern-territories.md the concern was seeded from (T1, T2, …) and probe is the codebase-specific check that tests it, in at most 1200 bytes; adding a code again updates them when given and keeps them when not.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        category: { type: "string" },
        origin: { type: "string", enum: ["seeded", "discovered"] },
        discovered_in: { type: "string" },
        notes: { type: "string" },
        territory: { type: "string", pattern: "^T[1-9][0-9]*$" },
        probe: { type: "string" },
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
      const territory = optString(args, "territory");
      const probe = optString(args, "probe");
      if (territory !== null && !TERRITORY_ID.test(territory)) {
        throw new ToolError(
          "add_concern refuses: territory is the id of a territory in concern-territories.md, such as T7. Name it by id, not in words.",
        );
      }
      if (probe !== null && Buffer.byteLength(probe, "utf8") > PROBE_CAP) {
        throw new ToolError(
          `add_concern refuses: a probe is limited to ${PROBE_CAP} bytes. Say the check in fewer; the cap counts UTF-8 bytes.`,
        );
      }
      ctx.db
        .prepare(
          `INSERT INTO concerns (code, category, origin, discovered_in, notes, status, territory, probe)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
           ON CONFLICT(code) DO UPDATE SET
             category=excluded.category,
             notes=excluded.notes,
             territory=COALESCE(excluded.territory, concerns.territory),
             probe=COALESCE(excluded.probe, concerns.probe)`,
        )
        .run(code, category, origin, discoveredIn, notes, territory, probe);
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
