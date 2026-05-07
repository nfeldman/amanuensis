import {
  ok,
  optString,
  requireExistingIds,
  requireString,
  type ToolDefinition,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const KINDS = [
  "cache",
  "queue",
  "table",
  "event-bus",
  "rpc",
  "shared-memory",
  "file",
  "config",
  "other",
] as const;

export const seamTools: ToolDefinition[] = [
  {
    name: "upsert_seam",
    description:
      "Record (or update) a seam — a boundary where two subsystems share an object (cache, queue, table, event bus, RPC interface, etc.). Per concern-seeding.md Territory 11, seams are mandatory Phase 2 output. Seam concerns (SC-N codes) can only be assessed once both parties reach 'mapped'; use get_seam_assessability to check readiness.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        shared_object: { type: "string" },
        shared_object_kind: { type: "string" },
        party_a: { type: "string" },
        party_b: { type: "string" },
        a_writes: { type: "string" },
        a_reads: { type: "string" },
        b_writes: { type: "string" },
        b_reads: { type: "string" },
        ordering_assumption: { type: "string" },
        cardinality: { type: "string" },
        staleness_tolerance: { type: "string" },
        schema_owner: { type: "string" },
        notes: { type: "string" },
      },
      required: ["id", "shared_object", "party_a", "party_b"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "upsert_seam");
      const id = requireString(args, "id");
      const sharedObject = requireString(args, "shared_object");
      const sharedObjectKind = optString(args, "shared_object_kind");
      if (sharedObjectKind && !KINDS.includes(sharedObjectKind as (typeof KINDS)[number])) {
        return { ok: false, error: `shared_object_kind must be one of: ${KINDS.join(", ")}` };
      }
      const partyA = requireString(args, "party_a");
      const partyB = requireString(args, "party_b");
      // Validate subsystem references — the FK would reject anyway, but
      // the error message is clearer this way and reports both parties
      // at once when both are missing.
      requireExistingIds(ctx.db, "subsystems", "id", [partyA, partyB], "subsystem(s)");
      ctx.db
        .prepare(
          `INSERT INTO seams
            (id, shared_object, shared_object_kind, party_a, party_b,
             a_writes, a_reads, b_writes, b_reads,
             ordering_assumption, cardinality, staleness_tolerance, schema_owner, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             shared_object = excluded.shared_object,
             shared_object_kind = excluded.shared_object_kind,
             party_a = excluded.party_a,
             party_b = excluded.party_b,
             a_writes = COALESCE(excluded.a_writes, seams.a_writes),
             a_reads = COALESCE(excluded.a_reads, seams.a_reads),
             b_writes = COALESCE(excluded.b_writes, seams.b_writes),
             b_reads = COALESCE(excluded.b_reads, seams.b_reads),
             ordering_assumption = COALESCE(excluded.ordering_assumption, seams.ordering_assumption),
             cardinality = COALESCE(excluded.cardinality, seams.cardinality),
             staleness_tolerance = COALESCE(excluded.staleness_tolerance, seams.staleness_tolerance),
             schema_owner = COALESCE(excluded.schema_owner, seams.schema_owner),
             notes = COALESCE(excluded.notes, seams.notes),
             updated_at = datetime('now')`,
        )
        .run(
          id,
          sharedObject,
          sharedObjectKind,
          partyA,
          partyB,
          optString(args, "a_writes"),
          optString(args, "a_reads"),
          optString(args, "b_writes"),
          optString(args, "b_reads"),
          optString(args, "ordering_assumption"),
          optString(args, "cardinality"),
          optString(args, "staleness_tolerance"),
          optString(args, "schema_owner"),
          optString(args, "notes"),
        );
      return ok();
    },
  },
  {
    name: "list_seams",
    description:
      "List seams. Filter by a subsystem (returns seams where the subsystem is party_a or party_b).",
    inputSchema: {
      type: "object",
      properties: { subsystem_id: { type: "string" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = optString(args, "subsystem_id");
      const rows = subsystemId
        ? ctx.db
            .prepare("SELECT * FROM seams WHERE party_a = ? OR party_b = ? ORDER BY id")
            .all(subsystemId, subsystemId)
        : ctx.db.prepare("SELECT * FROM seams ORDER BY id").all();
      return rows;
    },
  },
  {
    name: "get_seam_assessability",
    description:
      "Return every seam with the status of both parties and whether it is currently assessable (both parties 'mapped'). Lets the adversarial agent triage which seam concerns can be evaluated now vs. which must wait.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, ctx) => {
      return ctx.db.prepare("SELECT * FROM seam_assessability ORDER BY seam_id").all();
    },
  },
];
