import {
  ok,
  optInt,
  optString,
  requireString,
  requireWorkspaceSourcePath,
  type ToolDefinition,
} from "../helpers.js";

export const staleTools: ToolDefinition[] = [
  {
    name: "get_stale_backlog",
    description:
      "Return stale scoped files prioritized by their subsystem's access heat (hottest first). limit defaults to 10. Each row names the subsystem, the file, the commit it was examined at, and why it is stale ('git-drift' or 'absent').",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const limit = optInt(args, "limit", 10) ?? 10;
      // Reads the file ledger rather than `entries`: the ledger is populated by
      // every survey that reaches the structural phase, so an empty backlog here
      // means "nothing drifted", not "nothing was ever recorded" (finding B03-2).
      return ctx.db
        .prepare(
          `SELECT fl.subsystem_id            AS subsystem_id,
                  fl.file_path               AS source_path,
                  fl.ref_sha                 AS ref_sha,
                  fl.classification          AS classification,
                  fl.stale_since             AS stale_since,
                  fl.stale_reason            AS stale_reason,
                  COALESCE(h.heat, 0)        AS heat,
                  COALESCE(h.access_count,0) AS access_count
             FROM file_ledger fl
             LEFT JOIN hot_subsystems h ON h.entry_id = fl.subsystem_id
            WHERE fl.stale = 1
            ORDER BY heat DESC, fl.subsystem_id, fl.file_path
            LIMIT ?`,
        )
        .all(limit);
    },
  },
  {
    name: "clear_staleness",
    description:
      "Mark a scoped file fresh after re-examination, setting its ref_sha to the commit it was reverified at. Clearing is per file so re-reading one file does not silently vouch for the rest of its subsystem.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        file_path: { type: "string" },
        ref_sha: { type: "string" },
      },
      required: ["subsystem_id", "file_path", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = requireString(args, "subsystem_id");
      const filePath = requireWorkspaceSourcePath(args.file_path);
      const refSha = requireString(args, "ref_sha");
      const row = ctx.db
        .prepare("SELECT stale_reason FROM file_ledger WHERE subsystem_id = ? AND file_path = ?")
        .get(subsystemId, filePath) as { stale_reason: string | null } | undefined;
      if (!row) {
        return { ok: false, error: `no scoped file: ${subsystemId} / ${filePath}` };
      }
      // A row marked 'absent' names a file the repository no longer tracks.
      // Re-examination cannot make that true again, so clearing it would assert
      // a fresh reading of something that is not there.
      if (row.stale_reason === "absent") {
        return {
          ok: false,
          error: `${filePath} is absent from the working tree; retire the ledger row or restore the file rather than clearing staleness`,
        };
      }
      const res = ctx.db
        .prepare(
          `UPDATE file_ledger
              SET stale = 0, stale_since = NULL, stale_reason = NULL, ref_sha = ?
            WHERE subsystem_id = ? AND file_path = ?`,
        )
        .run(refSha, subsystemId, filePath);
      if (res.changes === 0) {
        return { ok: false, error: `no scoped file: ${subsystemId} / ${filePath}` };
      }
      ctx.db
        .prepare("DELETE FROM scope_gaps WHERE file_path = ? AND kind = 'absent'")
        .run(filePath);
      return ok();
    },
  },
  {
    name: "retire_ledger_file",
    description:
      "Remove a file ledger row whose file no longer exists in the repository, without discarding the subsystem's dispositions, findings, artifacts, or cross-references. Refuses while the file is still tracked, so this cannot be used to quietly narrow a subsystem's scope.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        file_path: { type: "string" },
        reason: { type: "string" },
      },
      required: ["subsystem_id", "file_path"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = requireString(args, "subsystem_id");
      const filePath = requireWorkspaceSourcePath(args.file_path);
      const reason = optString(args, "reason");
      const row = ctx.db
        .prepare("SELECT stale_reason FROM file_ledger WHERE subsystem_id = ? AND file_path = ?")
        .get(subsystemId, filePath) as { stale_reason: string | null } | undefined;
      if (!row) return { ok: false, error: `no scoped file: ${subsystemId} / ${filePath}` };
      if (row.stale_reason !== "absent") {
        return {
          ok: false,
          error: `${filePath} is not recorded as absent; run detect_changes first, and retire only rows whose file the repository no longer tracks`,
        };
      }
      const txn = ctx.db.transaction(() => {
        ctx.db
          .prepare("DELETE FROM file_ledger WHERE subsystem_id = ? AND file_path = ?")
          .run(subsystemId, filePath);
        ctx.db
          .prepare("DELETE FROM scope_gaps WHERE file_path = ? AND kind = 'absent'")
          .run(filePath);
      });
      txn();
      return ok({ retired: filePath, reason: reason ?? null });
    },
  },
];
