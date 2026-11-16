import {
  OBLIGATION_BEARING_SQL,
  ok,
  optInt,
  optString,
  requireString,
  requireWorkspaceSourcePath,
  resolveWorkspaceCommit,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";

const CLEAR_REASON_CAP = 400;

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
            WHERE fl.stale = 1 AND ${OBLIGATION_BEARING_SQL}
            ORDER BY heat DESC, fl.subsystem_id, fl.file_path
            LIMIT ?`,
        )
        .all(limit);
    },
  },
  {
    name: "clear_staleness",
    description:
      "Mark a scoped file fresh after re-examination, setting its ref_sha to the commit it was reverified at (a name such as HEAD is resolved to its commit). Clearing is per file so re-reading one file does not silently vouch for the rest of its subsystem. Every clear records its basis in staleness_clears: evidence_id, an evidence row citing this file, or reason, one line of at most 400 bytes saying what the re-examination found; at least one is required. Returns the clear's id.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        file_path: { type: "string" },
        ref_sha: { type: "string" },
        evidence_id: { type: "integer" },
        reason: { type: "string" },
      },
      required: ["subsystem_id", "file_path", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = requireString(args, "subsystem_id");
      const filePath = requireWorkspaceSourcePath(args.file_path);
      const evidenceId = optInt(args, "evidence_id");
      const reason = optString(args, "reason")?.trim() || null;
      if (evidenceId === null && reason === null) {
        throw new ToolError(
          "clear_staleness refuses: a clear records its basis. Pass evidence_id, an evidence row " +
            "citing this file, or reason, one line saying what the re-examination found.",
        );
      }
      if (
        reason !== null &&
        (/[\r\n]/.test(reason) || Buffer.byteLength(reason) > CLEAR_REASON_CAP)
      ) {
        throw new ToolError(`reason must be one line of at most ${CLEAR_REASON_CAP} bytes`);
      }
      if (evidenceId !== null) {
        const cited = ctx.db
          .prepare("SELECT file_path FROM evidence WHERE id = ?")
          .get(evidenceId) as { file_path: string } | undefined;
        if (!cited || cited.file_path !== filePath) {
          throw new ToolError(
            `evidence ${evidenceId} ${cited ? `cites ${cited.file_path}` : "does not exist"}; ` +
              `cite an evidence row for ${filePath}, or pass a reason.`,
          );
        }
      }
      const refSha = resolveWorkspaceCommit(ctx, requireString(args, "ref_sha"));
      const row = ctx.db
        .prepare(
          "SELECT stale, stale_reason, ref_sha FROM file_ledger WHERE subsystem_id = ? AND file_path = ?",
        )
        .get(subsystemId, filePath) as
        | { stale: number; stale_reason: string | null; ref_sha: string | null }
        | undefined;
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
      const clear = ctx.db.transaction(() => {
        ctx.db
          .prepare(
            `UPDATE file_ledger
                SET stale = 0, stale_since = NULL, stale_reason = NULL, ref_sha = ?
              WHERE subsystem_id = ? AND file_path = ?`,
          )
          .run(refSha, subsystemId, filePath);
        ctx.db
          .prepare("DELETE FROM scope_gaps WHERE file_path = ? AND kind = 'absent'")
          .run(filePath);
        return ctx.db
          .prepare(
            `INSERT INTO staleness_clears
               (subsystem_id, file_path, ref_sha, prior_ref_sha, prior_stale_reason,
                evidence_id, reason, session_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            subsystemId,
            filePath,
            refSha,
            row.ref_sha,
            row.stale ? (row.stale_reason ?? "stale") : null,
            evidenceId,
            reason,
            ctx.sessionId,
          ).lastInsertRowid;
      });
      return ok({ clear_id: Number(clear()), ref_sha: refSha });
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
