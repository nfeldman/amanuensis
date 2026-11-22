import { codeIndexEnabled, type IndexedSymbol } from "../code-index/store.js";
import {
  OBLIGATION_BEARING_SQL,
  ok,
  optInt,
  optString,
  requireString,
  requireWorkspaceSourcePath,
  resolveWorkspaceCommit,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { indexOrUnavailable, lineRangeOf } from "./code-index.js";
import { type Definitions, readDefinitions } from "./evidence.js";

const CLEAR_REASON_CAP = 400;

// ---------------------------------------------------------------------------------------
// The refresh hint (semantic-index PLAN §4.5)
//
// Each evidence row on a stale ledger file is given what happened to its cited text at the
// target revision. It says nothing more: a definition with the same text can behave
// differently because something it calls, reads or is configured by changed, so `same-text`
// is a place to look at the diff around, not a verdict. Nothing here clears staleness.

export type AnchorState =
  | "same-text"
  | "moved"
  | "changed"
  | "gone"
  | "ambiguous"
  | "unavailable"
  | "unanchored";

export interface AnchorHint {
  evidence_id: number;
  symbol: string | null;
  line_range: string | null;
  ref_sha: string;
  anchor_state: AnchorState;
  /** The citeable lines of the definition, or definitions, the state is about. */
  target_lines: string[];
  /** Why absence cannot be shown, when the state is `unavailable`. */
  reason?: string;
}

interface CitedRow {
  evidence_id: number;
  symbol: string | null;
  line_range: string | null;
  ref_sha: string;
  symbol_id: string | null;
  lang: string | null;
  kind: string | null;
  def_start_line: number | null;
  def_end_line: number | null;
  span_sha256: string | null;
}

type Anchor = CitedRow & { symbol_id: string; lang: string; kind: string };

function anchorState(
  anchor: Anchor,
  found: Definitions,
): Pick<AnchorHint, "anchor_state" | "target_lines" | "reason"> {
  const lines = (defs: IndexedSymbol[]) => defs.map(lineRangeOf);
  const sameId = found.symbols.filter((s) => s.symbol_id === anchor.symbol_id);
  const sameKind = sameId.filter((s) => s.kind === anchor.kind);
  // A definition whose declaration holds a syntax error is not listed, so a miss in a file
  // that parsed partially shows nothing.
  if (found.partial && sameKind.length === 0) {
    return { anchor_state: "unavailable", target_lines: [], reason: "parse-partial" };
  }
  // Under the same symbol_id with another kind (a prototype that became a definition), the
  // cited text cannot be the same.
  const defs = sameKind.length > 0 ? sameKind : sameId;
  if (defs.length === 0) return { anchor_state: "gone", target_lines: [] };
  if (defs.length > 1) return { anchor_state: "ambiguous", target_lines: lines(defs) };
  const def = defs[0] as IndexedSymbol;
  const target_lines = lines(defs);
  if (def.kind !== anchor.kind || def.span_sha256 !== anchor.span_sha256) {
    return { anchor_state: "changed", target_lines };
  }
  const moved =
    def.doc_start_line !== anchor.def_start_line || def.end_line !== anchor.def_end_line;
  return { anchor_state: moved ? "moved" : "same-text", target_lines };
}

/** The refresh hint of every evidence row citing `filePath`, at `target` (null: no revision). */
export function anchorHints(
  ctx: ServerContext,
  target: string | null,
  filePath: string,
): AnchorHint[] {
  const rows = ctx.db
    .prepare(
      `SELECT e.id AS evidence_id, e.symbol, e.line_range, e.ref_sha,
              a.symbol_id, a.lang, a.kind, a.def_start_line, a.def_end_line, a.span_sha256
         FROM evidence e
         LEFT JOIN evidence_anchors a ON a.evidence_id = e.id
        WHERE e.file_path = ?
        ORDER BY e.id`,
    )
    .all(filePath) as CitedRow[];
  // The file's definitions are read once, and only when a row is anchored.
  let found: Definitions | { unavailable: string } | undefined;
  const definitions = (): Definitions | { unavailable: string } => {
    if (found !== undefined) return found;
    const index = codeIndexEnabled() ? indexOrUnavailable(ctx) : null;
    if (target === null) found = { unavailable: "no-revision" };
    else if (!index) found = { unavailable: "index-off" };
    else if ("unavailable" in index) found = index;
    else found = readDefinitions(ctx, index, target, filePath);
    return found;
  };
  return rows.map((row) => {
    const cited = {
      evidence_id: row.evidence_id,
      symbol: row.symbol,
      line_range: row.line_range,
      ref_sha: row.ref_sha,
    };
    if (row.symbol_id === null) return { ...cited, anchor_state: "unanchored", target_lines: [] };
    const defs = definitions();
    if ("unavailable" in defs) {
      return { ...cited, anchor_state: "unavailable", target_lines: [], reason: defs.unavailable };
    }
    if (defs.lang !== row.lang) {
      return { ...cited, anchor_state: "unavailable", target_lines: [], reason: "language" };
    }
    return { ...cited, ...anchorState(row as Anchor, defs) };
  });
}

/** The workspace HEAD, or null when no workspace is bound or HEAD names no commit. */
function workspaceHead(ctx: ServerContext): string | null {
  try {
    return resolveWorkspaceCommit(ctx, "HEAD");
  } catch {
    return null;
  }
}

/** Ledger rows of the stale backlog, hottest subsystem first. */
export function staleLedgerRows(ctx: ServerContext, limit: number | null): StaleRow[] {
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
    .all(limit ?? -1) as StaleRow[];
}

export interface StaleRow {
  subsystem_id: string;
  source_path: string;
  ref_sha: string | null;
  classification: string | null;
  stale_since: string | null;
  stale_reason: string | null;
  heat: number;
  access_count: number;
}

/** Stale ledger rows, each with the refresh hint of the evidence citing its file at `target`. */
export function withAnchorHints(
  ctx: ServerContext,
  rows: StaleRow[],
  target: string | null,
): Array<StaleRow & { anchors_at: string | null; evidence: AnchorHint[] }> {
  const byPath = new Map<string, AnchorHint[]>();
  return rows.map((row) => {
    let evidence = byPath.get(row.source_path);
    if (evidence === undefined) {
      evidence = anchorHints(ctx, target, row.source_path);
      byPath.set(row.source_path, evidence);
    }
    return { ...row, anchors_at: target, evidence };
  });
}

export const staleTools: ToolDefinition[] = [
  {
    name: "get_stale_backlog",
    description:
      "Return stale scoped files prioritized by their subsystem's access heat (hottest first). limit defaults to 10. Each row names the subsystem, the file, the commit it was examined at, and why it is stale ('git-drift' or 'absent'). Each row's evidence lists every evidence row citing the file with its anchor_state at anchors_at, the workspace HEAD: same-text, moved, changed (documentation edits included), gone (the file parsed and no definition has the symbol_id; renames are not followed), ambiguous (several definitions have it), unavailable (absence cannot be shown; reason says why) or unanchored (no anchor), with target_lines, the definition's lines there. It says what happened to the cited text, nothing more: same-text can still behave differently because something it calls or reads changed, so it is a place to look at the diff around, not a verdict. Nothing is cleared; clear_staleness clears a whole file.",
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
      const rows = staleLedgerRows(ctx, limit);
      if (rows.length === 0) return rows;
      return withAnchorHints(ctx, rows, workspaceHead(ctx));
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
