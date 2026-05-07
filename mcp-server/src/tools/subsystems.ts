import {
  ok,
  optInt,
  optString,
  requireEnum,
  requireString,
  type ToolDefinition,
} from "../helpers.js";
import {
  enforceMonotonicTransition,
  enforcePhasePrerequisites,
  readSubsystemStatus,
  STATUS_ORDER,
  type SubsystemStatus,
} from "../invariants.js";

const ALL_STATUSES = [...STATUS_ORDER, "deferred"] as const;

// The canonical schema does not include explicit columns for subsystem name,
// scope, jump-in reading, etc. — those live in the master-plan.md prose.
// The server-owned `subsystems` table (created during db init) persists them
// so agents can address subsystems structurally (list, status filter, etc.)
// without re-parsing markdown on every call.
export const subsystemTools: ToolDefinition[] = [
  {
    name: "list_subsystems",
    description:
      "Return the registered subsystems (master plan), sorted by survey priority " +
      "(1 = survey first), with unprioritized subsystems falling back to alphabetical. " +
      "Optionally filter by status. Each row includes a finding rollup (confirmed_bugs) " +
      "for quick dashboarding and the layer / priority the coordinator assigned.",
    inputSchema: {
      type: "object",
      properties: { status_filter: { type: "string" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const statusFilter = optString(args, "status_filter");
      // NULL priority sorts LAST by explicit ordering (not SQLite's
      // default NULLS FIRST for ASC). Ties on priority fall back to
      // layer, then id. Bug counts arrive in the same query via
      // LEFT JOIN + COUNT(*) FILTER, eliminating a second round-trip
      // and a JS Map merge.
      const sql = `
        SELECT s.id, s.name, s.status, s.layer, s.scope, s.jump_in_reading, s.notes, s.priority,
               COUNT(f.finding_id) FILTER (WHERE f.status='confirmed-bug') AS confirmed_bugs
          FROM subsystems s
          LEFT JOIN findings f ON f.subsystem_id = s.id
         ${statusFilter ? "WHERE s.status = ?" : ""}
         GROUP BY s.id
         ORDER BY CASE WHEN s.priority IS NULL THEN 1 ELSE 0 END, s.priority, s.layer, s.id`;
      const stmt = ctx.db.prepare(sql);
      return (statusFilter ? stmt.all(statusFilter) : stmt.all()) as Array<{
        id: string;
        name: string;
        status: string;
        layer: string | null;
        scope: string | null;
        jump_in_reading: string | null;
        notes: string | null;
        priority: number | null;
        confirmed_bugs: number;
      }>;
    },
  },
  {
    name: "upsert_subsystem",
    description:
      "Create or replace a subsystem entry. status defaults to 'unmapped'. " +
      "`priority` (integer, 1 = survey first) is optional — set it during " +
      "onboarding Phase 5 so the master plan orders subsystems by survey " +
      "urgency. Omit priority to leave it unchanged on update. Use " +
      "update_subsystem_status to advance status without rewriting the " +
      "other fields.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        status: { type: "string" },
        layer: { type: "string" },
        scope: { type: "string" },
        jump_in_reading: { type: "string" },
        notes: { type: "string" },
        priority: {
          type: "integer",
          minimum: 1,
          description: "Survey priority, 1 = highest. Omit to leave unchanged on update.",
        },
      },
      required: ["id", "name"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const id = requireString(args, "id");
      const name = requireString(args, "name");
      const status = (optString(args, "status") ?? "unmapped") as SubsystemStatus;
      const layer = optString(args, "layer");
      const scope = optString(args, "scope");
      const jumpIn = optString(args, "jump_in_reading");
      const notes = optString(args, "notes");
      const priority = optInt(args, "priority");
      if (priority != null && priority < 1) {
        return { ok: false, error: "priority must be a positive integer (1 = highest)" };
      }

      // Upsert may hit an existing row — enforce that the new status is
      // not a silent regression. Fresh inserts bypass the guard (there
      // is no prior status to compare against).
      enforceMonotonicTransition(id, readSubsystemStatus(ctx.db, id), status);

      // COALESCE on the UPDATE path: omitted priority leaves the
      // prior value alone. Pass explicit priority=null in the future
      // if we need a "clear it" path.
      ctx.db
        .prepare(
          `INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading, notes, priority)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name=excluded.name,
             status=excluded.status,
             layer=COALESCE(excluded.layer, subsystems.layer),
             scope=COALESCE(excluded.scope, subsystems.scope),
             jump_in_reading=COALESCE(excluded.jump_in_reading, subsystems.jump_in_reading),
             notes=COALESCE(excluded.notes, subsystems.notes),
             priority=COALESCE(excluded.priority, subsystems.priority),
             updated_at=datetime('now')`,
        )
        .run(id, name, status, layer, scope, jumpIn, notes, priority ?? null);
      return ok();
    },
  },
  {
    name: "update_subsystem_status",
    description:
      "Advance a subsystem's status along the survey progression " +
      "(unmapped → scoping → structural → concerns → adversarial → mapped). " +
      "Transitions are monotonic: the server rejects regressions so " +
      "dependent dispositions and findings cannot be silently orphaned. " +
      "Use reset_subsystem to explicitly discard prior survey data and " +
      "restart from an earlier phase. The 'deferred' flag is orthogonal " +
      "and can be set or cleared from any status. Returns the previous status.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: [...ALL_STATUSES] },
      },
      required: ["id", "status"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const id = requireString(args, "id");
      const status = requireEnum(args, "status", ALL_STATUSES);
      const currentStatus = readSubsystemStatus(ctx.db, id);
      if (currentStatus === null) return { ok: false, error: `unknown subsystem: ${id}` };

      enforceMonotonicTransition(id, currentStatus, status);

      // Enforce that each newly-reached status has the prior phase's evidence.
      // Checked after the monotonic guard so regression attempts are caught first.
      // Skipped for deferred toggles (both directions) and no-op same-status writes.
      const currentRank = STATUS_ORDER.indexOf(
        currentStatus as Exclude<SubsystemStatus, "deferred">,
      );
      const targetRank = STATUS_ORDER.indexOf(status as Exclude<SubsystemStatus, "deferred">);
      if (currentRank >= 0 && targetRank > currentRank) {
        for (const s of STATUS_ORDER.slice(currentRank + 1, targetRank + 1)) {
          enforcePhasePrerequisites(ctx.db, id, s);
        }
      }

      ctx.db
        .prepare("UPDATE subsystems SET status=?, updated_at=datetime('now') WHERE id=?")
        .run(status, id);
      return ok({ previous_status: currentStatus });
    },
  },
  {
    name: "set_subsystem_priority",
    description:
      "Set a subsystem's survey priority (1 = survey first). Pass " +
      "`priority: null` to clear. The coordinator assigns these during " +
      "onboarding Phase 5 (ranking every identified subsystem by how " +
      "much downstream work depends on it) and may refine them later " +
      "when new dependencies are discovered or a human answers a " +
      "`priority-ranking` open question.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        priority: {
          type: ["integer", "null"],
          minimum: 1,
          description: "1 = survey first. null to clear.",
        },
      },
      required: ["id", "priority"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const id = requireString(args, "id");
      const raw = args.priority;
      let priority: number | null;
      if (raw === null || raw === undefined) {
        priority = null;
      } else if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1) {
        priority = raw;
      } else {
        return {
          ok: false,
          error: "priority must be a positive integer or null",
        };
      }
      const row = ctx.db.prepare("SELECT priority FROM subsystems WHERE id = ?").get(id) as
        | { priority: number | null }
        | undefined;
      if (!row) return { ok: false, error: `unknown subsystem: ${id}` };
      ctx.db
        .prepare("UPDATE subsystems SET priority=?, updated_at=datetime('now') WHERE id=?")
        .run(priority, id);
      return ok({ previous_priority: row.priority, new_priority: priority });
    },
  },
  {
    name: "reset_subsystem",
    description:
      "Discard a subsystem's survey artifacts and reset its status to " +
      "an earlier phase. This is the only path that regresses a " +
      "subsystem's knowledge depth — the normal update_subsystem_status " +
      "tool rejects regressions. reset_subsystem deletes dependent rows " +
      "(dispositions, findings, field-notes, xrefs, artifact manifest " +
      "entries for this subsystem) so the conspectus remains internally " +
      "consistent with the new status. The reason is recorded for " +
      "audit; supply enough context that a future analyst understands " +
      "why the earlier survey was discarded.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        to_status: {
          type: "string",
          enum: [...STATUS_ORDER],
          description: "The status to reset to. Must be a non-deferred depth.",
        },
        reason: { type: "string" },
      },
      required: ["id", "to_status", "reason"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const id = requireString(args, "id");
      const toStatus = requireEnum(args, "to_status", STATUS_ORDER);
      const reason = requireString(args, "reason");
      if (reason.trim().length < 8) {
        return { ok: false, error: "reason must be at least 8 characters" };
      }

      const row = ctx.db.prepare("SELECT status FROM subsystems WHERE id = ?").get(id) as
        | { status: string }
        | undefined;
      if (!row) return { ok: false, error: `unknown subsystem: ${id}` };

      const deleted: Record<string, number> = {};
      const txn = ctx.db.transaction(() => {
        // Dependent rows are cleared transactionally so an interrupted
        // reset never leaves a subsystem at scoping-status with stale
        // concern dispositions attached.
        deleted.dispositions = ctx.db
          .prepare("DELETE FROM dispositions WHERE subsystem_id = ?")
          .run(id).changes;
        deleted.findings = ctx.db
          .prepare("DELETE FROM findings WHERE subsystem_id = ?")
          .run(id).changes;
        deleted.field_notes = ctx.db
          .prepare("DELETE FROM field_notes WHERE location = ?")
          .run(id).changes;
        deleted.xrefs = ctx.db
          .prepare("DELETE FROM xrefs WHERE from_id = ? OR to_id = ?")
          .run(id, id).changes;
        deleted.artifacts = ctx.db
          .prepare("DELETE FROM artifacts WHERE subsystem_id = ?")
          .run(id).changes;
        // file_ledger rows are preserved unless the reset target is
        // scoping or earlier — they are the scope itself, not survey
        // output.
        if (toStatus === "unmapped" || toStatus === "scoping") {
          deleted.file_ledger = ctx.db
            .prepare("DELETE FROM file_ledger WHERE subsystem_id = ?")
            .run(id).changes;
        }
        ctx.db
          .prepare(
            "UPDATE subsystems SET status=?, updated_at=datetime('now'), notes = COALESCE(notes, '') || char(10) || ? WHERE id = ?",
          )
          .run(toStatus, `[reset ${new Date().toISOString()}] ${reason}`, id);
      });
      txn();

      return ok({
        previous_status: row.status,
        new_status: toStatus,
        deleted,
      });
    },
  },
];
