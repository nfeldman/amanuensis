import {
  ok,
  optString,
  requireEnum,
  requireString,
  requireWorkspaceSourcePath,
  resolveWorkspaceCommit,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";
import { FILE_CLASSIFICATIONS, type FileClassification } from "../vocabulary.js";

function isClassification(v: string): v is FileClassification {
  return (FILE_CLASSIFICATIONS as readonly string[]).includes(v);
}

/**
 * A stale ledger row's ref_sha moves only through clear_staleness. detect_changes
 * marks a row fresh again once its content matches its ref_sha, so a writer that
 * advanced the ref_sha of a stale row would discharge the staleness on the next
 * reconciliation with no basis recorded in staleness_clears. Classification and
 * rationale may still change; only the revision is held.
 */
function refuseStaleRefMove(
  ctx: ServerContext,
  subsystemId: string,
  moves: ReadonlyArray<{ file_path: string; ref_sha: string }>,
): void {
  const current = ctx.db.prepare(
    "SELECT stale, stale_reason, ref_sha FROM file_ledger WHERE subsystem_id = ? AND file_path = ?",
  );
  const held: string[] = [];
  for (const move of moves) {
    const row = current.get(subsystemId, move.file_path) as
      | { stale: number; stale_reason: string | null; ref_sha: string | null }
      | undefined;
    // Rows written before revisions were resolved may hold an abbreviation
    // (48 such rows in the self-conspectus); the same commit is not a move.
    const sameCommit =
      row?.ref_sha != null &&
      /^[0-9a-f]{7,40}$/.test(row.ref_sha) &&
      move.ref_sha.startsWith(row.ref_sha);
    if (row?.stale && !sameCommit) {
      held.push(`${move.file_path} (${row.stale_reason ?? "stale"})`);
    }
  }
  if (held.length > 0) {
    throw new ToolError(
      `${held.join(", ")} ${held.length === 1 ? "is" : "are"} stale in ${subsystemId}; ` +
        "a stale row's ref_sha moves only through clear_staleness, which records what the " +
        "re-examination found. Clear it first, or omit the new ref_sha to change only the classification.",
    );
  }
}

export const fileTools: ToolDefinition[] = [
  {
    name: "add_files_to_scope",
    description:
      "Append or update file ledger rows for a subsystem. Each file gets a why_in_scope rationale and an optional classification (default 'candidate'). ref_sha anchors the observation to a specific commit; a name such as HEAD is resolved to its commit. A row already marked stale keeps its ref_sha: re-adding it at a different commit is refused, because only clear_staleness records the re-examination that discharges staleness.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        ref_sha: { type: "string" },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file_path: { type: "string" },
              why_in_scope: { type: "string" },
              classification: { type: "string" },
            },
            required: ["file_path"],
            additionalProperties: false,
          },
        },
      },
      required: ["subsystem_id", "ref_sha", "files"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "add_files_to_scope");
      const subsystemId = requireString(args, "subsystem_id");
      const requestedRef = requireString(args, "ref_sha");
      const files = args.files as Array<{
        file_path: string;
        why_in_scope?: string;
        classification?: string;
      }>;
      if (!Array.isArray(files) || files.length === 0) {
        return { ok: false, error: "files must be a non-empty array" };
      }
      // Validate classifications up front so a single bad value rejects
      // the whole batch before any rows are written. Database errors
      // raised inside the transaction propagate as themselves rather
      // than being swallowed and relabelled as validation failures.
      const normalized = files.map((f) => {
        const classification = f.classification ?? "candidate";
        if (!isClassification(classification)) {
          throw new ToolError(`invalid classification: ${classification}`);
        }
        return {
          file_path: requireWorkspaceSourcePath(f.file_path),
          why_in_scope: f.why_in_scope ?? null,
          classification,
        };
      });
      // A stored name such as HEAD is compared by detect_changes as `git diff HEAD
      // <current>`, which is empty whenever HEAD is current: the row could never
      // turn stale.
      const refSha = resolveWorkspaceCommit(ctx, requestedRef);
      const stmt = ctx.db.prepare(
        `INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at)
         VALUES (?, ?, ?, ?, ?, CASE WHEN ?='examined' THEN datetime('now') ELSE NULL END)
         ON CONFLICT(subsystem_id, file_path) DO UPDATE SET
           why_in_scope = COALESCE(excluded.why_in_scope, file_ledger.why_in_scope),
           classification = COALESCE(excluded.classification, file_ledger.classification),
           ref_sha = excluded.ref_sha,
           examined_at = CASE WHEN excluded.classification='examined' THEN datetime('now') ELSE file_ledger.examined_at END`,
      );
      ctx.db.transaction(() => {
        refuseStaleRefMove(
          ctx,
          subsystemId,
          normalized.map((f) => ({ file_path: f.file_path, ref_sha: refSha })),
        );
        for (const f of normalized) {
          stmt.run(
            subsystemId,
            f.file_path,
            f.why_in_scope,
            f.classification,
            refSha,
            f.classification,
          );
        }
      })();
      return ok({ added: normalized.length });
    },
  },
  {
    name: "update_file_classification",
    description:
      "Transition a scoped file to a new classification (e.g., candidate → examined). Updates examined_at when the new classification is 'examined'. An optional ref_sha moves the row's revision (a name such as HEAD is resolved to its commit); on a stale row that is refused, since clear_staleness is what records a re-examination.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        file_path: { type: "string" },
        classification: { type: "string" },
        ref_sha: { type: "string" },
      },
      required: ["subsystem_id", "file_path", "classification"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "update_file_classification");
      const subsystemId = requireString(args, "subsystem_id");
      const filePath = requireWorkspaceSourcePath(args.file_path);
      const classification = requireEnum(args, "classification", FILE_CLASSIFICATIONS);
      const requestedRef = optString(args, "ref_sha");
      const refSha = requestedRef === null ? null : resolveWorkspaceCommit(ctx, requestedRef);
      if (refSha !== null)
        refuseStaleRefMove(ctx, subsystemId, [{ file_path: filePath, ref_sha: refSha }]);
      const res = ctx.db
        .prepare(
          `UPDATE file_ledger
             SET classification = ?,
                 ref_sha = COALESCE(?, ref_sha),
                 examined_at = CASE WHEN ?='examined' THEN datetime('now') ELSE examined_at END
           WHERE subsystem_id = ? AND file_path = ?`,
        )
        .run(classification, refSha, classification, subsystemId, filePath);
      if (res.changes === 0) {
        return { ok: false, error: "no matching file_ledger row" };
      }
      return ok();
    },
  },
  {
    name: "get_subsystem_files",
    description:
      "List the file ledger for a subsystem. classification_filter narrows to e.g. 'examined' or 'candidate'.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        classification_filter: { type: "string" },
      },
      required: ["subsystem_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = requireString(args, "subsystem_id");
      const classificationFilter = optString(args, "classification_filter");
      const rows = classificationFilter
        ? ctx.db
            .prepare(
              "SELECT file_path, why_in_scope, classification, ref_sha, examined_at FROM file_ledger WHERE subsystem_id = ? AND classification = ? ORDER BY file_path",
            )
            .all(subsystemId, classificationFilter)
        : ctx.db
            .prepare(
              "SELECT file_path, why_in_scope, classification, ref_sha, examined_at FROM file_ledger WHERE subsystem_id = ? ORDER BY file_path",
            )
            .all(subsystemId);
      return rows;
    },
  },
];
