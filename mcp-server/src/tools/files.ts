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
 *
 * Returns the rows among `paths` that are stale at a commit other than `refSha`.
 */
function staleRowsAtOtherCommits(
  ctx: ServerContext,
  subsystemId: string,
  paths: readonly string[],
  refSha: string,
): Map<string, { stale_reason: string; ref_sha: string | null }> {
  const current = ctx.db.prepare(
    "SELECT stale, stale_reason, ref_sha FROM file_ledger WHERE subsystem_id = ? AND file_path = ?",
  );
  const held = new Map<string, { stale_reason: string; ref_sha: string | null }>();
  for (const path of paths) {
    const row = current.get(subsystemId, path) as
      | { stale: number; stale_reason: string | null; ref_sha: string | null }
      | undefined;
    if (!row?.stale) continue;
    if (!sameCommit(ctx, row.ref_sha, refSha)) {
      held.set(path, { stale_reason: row.stale_reason ?? "stale", ref_sha: row.ref_sha });
    }
  }
  return held;
}

/**
 * Rows written before revisions were resolved may hold an abbreviation (48 in
 * the self-conspectus). It names the same commit only if it still resolves, and
 * resolves uniquely, to that commit: a bare prefix match would accept a later
 * commit that happens to share the prefix.
 */
function sameCommit(ctx: ServerContext, stored: string | null, resolved: string): boolean {
  if (stored === null) return false;
  if (stored === resolved) return true;
  if (!/^[0-9a-f]{7,39}$/.test(stored) || !resolved.startsWith(stored)) return false;
  try {
    return resolveWorkspaceCommit(ctx, stored) === resolved;
  } catch {
    return false;
  }
}

export const fileTools: ToolDefinition[] = [
  {
    name: "add_files_to_scope",
    description:
      "Append or update file ledger rows for a subsystem. Each file gets a why_in_scope rationale and an optional classification (default 'candidate'). ref_sha anchors the observation to a specific commit; a name such as HEAD is resolved to its commit. A row already marked stale keeps its ref_sha, because only clear_staleness records the re-examination that discharges staleness; its other fields are updated, and the response lists it under held_stale.",
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
      // Re-scoping is routine (Phase 1 re-adds rows from an earlier session at
      // the survey's commit), so a stale row in the batch is held rather than
      // refusing the batch: it keeps its revision and is reported.
      const held = ctx.db.transaction(() => {
        const stale = staleRowsAtOtherCommits(
          ctx,
          subsystemId,
          normalized.map((f) => f.file_path),
          refSha,
        );
        for (const f of normalized) {
          stmt.run(
            subsystemId,
            f.file_path,
            f.why_in_scope,
            f.classification,
            stale.has(f.file_path) ? stale.get(f.file_path)?.ref_sha : refSha,
            f.classification,
          );
        }
        return stale;
      })();
      return ok({
        added: normalized.length,
        held_stale: [...held].map(([file_path, row]) => ({
          file_path,
          stale_reason: row.stale_reason,
          ref_sha: row.ref_sha,
          note: "kept its ref_sha; clear_staleness records the re-examination that moves it",
        })),
      });
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
      if (refSha !== null) {
        const stale = staleRowsAtOtherCommits(ctx, subsystemId, [filePath], refSha).get(filePath);
        if (stale) {
          throw new ToolError(
            `${filePath} is stale in ${subsystemId} (${stale.stale_reason}); a stale row's ref_sha ` +
              "moves only through clear_staleness, which records what the re-examination found. " +
              "Clear it first, or omit ref_sha to change only the classification.",
          );
        }
      }
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
