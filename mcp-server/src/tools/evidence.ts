import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { languageForPath } from "../code-index/extract.js";
import { entryAt } from "../code-index/git-blobs.js";
import { type CodeIndex, codeIndexEnabled, type IndexedSymbol } from "../code-index/store.js";
import type { DB } from "../db.js";
import {
  excerptMiss,
  lineSpans,
  ok,
  optInt,
  optString,
  requireEnum,
  requireEvidenceCitation,
  requireInt,
  requireString,
  requireWorkspaceSourcePath,
  resolveWorkspaceCommit,
  type ServerContext,
  shownExcerpt,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession, requireEvidenceAnchor } from "../invariants.js";
import { spawnSync } from "../subprocess.js";
import { EVIDENCE_KINDS } from "../vocabulary.js";
import { indexFor, lineRangeOf, matching, nearestIds } from "./code-index.js";

// ---------------------------------------------------------------------------------------
// Evidence anchors (semantic-index PLAN §4.4)
//
// With the code index on and a file in a language it parses, a `symbol` is resolved against
// the definitions at `ref_sha`: by symbol_id, then qname, then a unique bare name. The row
// stores the canonical symbol_id and an `evidence_anchors` row is written in the same
// transaction. Every cited span must lie within the definition's citeable span, an excerpt
// must come from the definition's own bytes within those spans, and an omitted line_range is
// filled with the citeable span. No symbol, another language, a file the index cannot read
// or the index off write the row as before, with no anchor: citing a whole file or a region
// that is no definition stays open that way.

export interface EvidenceAnchor {
  blob_sha: string;
  lang: string;
  symbol_id: string;
  kind: string;
  def_start_line: number;
  def_end_line: number;
  span_sha256: string;
  extractor_id: string;
  range_source: "cited" | "filled";
}

/** An evidence row's location after resolution, ready to write. */
export interface ResolvedCitation {
  symbol: string | null;
  lineRange: string | null;
  anchor: EvidenceAnchor | null;
}

/** Whether a citation is resolved against the code index before it is written. */
export function anchorsCitation(filePath: string, symbol: string | null): boolean {
  return symbol !== null && codeIndexEnabled() && languageForPath(filePath) !== null;
}

const short = (commit: string): string => commit.slice(0, 12);

const linesOf = (s: IndexedSymbol): string => `${s.symbol_id} lines ${lineRangeOf(s)}`;

function symbolNotFound(symbol: string, path: string, commit: string, nearest: string[]) {
  return new ToolError(
    `add_evidence refuses: ${symbol} names no definition in ${path} at ${short(commit)}; ` +
      (nearest.length > 0
        ? `nearest symbol_ids: ${nearest.join(", ")}. Pass one of them as symbol`
        : "the file has no definitions the index lists") +
      ", or omit symbol: a free-text label belongs in note",
    "evidence.symbol-not-found",
  );
}

function symbolAmbiguous(symbol: string, path: string, commit: string, named: IndexedSymbol[]) {
  return new ToolError(
    `add_evidence refuses: ${symbol} names ${named.length} definitions in ${path} at ${short(commit)} ` +
      `(${named.map(linesOf).join("; ")}) and line_range does not fall within exactly one of ` +
      "them; give line_range inside the one to cite",
    "evidence.symbol-ambiguous",
  );
}

function rangeOutside(lineRange: string, def: IndexedSymbol, path: string, commit: string) {
  return new ToolError(
    `add_evidence refuses: line_range ${lineRange} reaches outside ${def.symbol_id}, which spans ` +
      `lines ${lineRangeOf(def)} of ${path} at ${short(commit)}; cite lines inside the ` +
      "definition, or omit symbol to cite lines no definition holds",
    "evidence.range-outside-symbol",
  );
}

function excerptOutside(
  missing: string,
  def: IndexedSymbol,
  lineRange: string | null,
  path: string,
  commit: string,
) {
  const where = lineRange === null ? `lines ${lineRangeOf(def)}` : `lines ${lineRange}`;
  return new ToolError(
    `add_evidence refuses: the excerpt is not inside ${def.symbol_id} within ${where} of ${path} ` +
      `at ${short(commit)}: ${JSON.stringify(shownExcerpt(missing))}. Quote that definition's ` +
      "own text; text from a neighbouring definition, even on the same line, is not part of it",
    "evidence.excerpt-outside-symbol",
  );
}

/** Byte offsets of each line's start in `bytes`, lines counted by `\n`. */
function lineStarts(bytes: Buffer): number[] {
  const starts = [0];
  for (let i = bytes.indexOf(0x0a); i >= 0; i = bytes.indexOf(0x0a, i + 1)) starts.push(i + 1);
  return starts;
}

/**
 * The text of `def`'s own bytes on each span: the definition's byte extent intersected with
 * the span's lines, so a neighbour sharing a line contributes nothing.
 */
function definitionSegments(
  bytes: Buffer,
  def: IndexedSymbol,
  spans: Array<[number, number]>,
): string[] {
  const starts = lineStarts(bytes);
  return spans.map(([from, to]) => {
    const lineStart = starts[from - 1] ?? bytes.length;
    const next = starts[to];
    const lineEnd = next === undefined ? bytes.length : next - 1;
    const start = Math.max(lineStart, def.start_byte);
    const end = Math.min(lineEnd, def.end_byte);
    return end > start ? bytes.subarray(start, end).toString("utf8") : "";
  });
}

const INDEX_FILE_SCRIPT = fileURLToPath(new URL("../code-index/index-file.js", import.meta.url));
/** A parse in the child is bounded well inside the subprocess default. */
const INDEX_FILE_TIMEOUT_MS = 60_000;
const MAX_BLOB_BYTES = 256 * 1024 * 1024;

/**
 * The file's definitions at `commit` from the sidecar, or null when the index cannot speak
 * for the file. Synchronous, because add_evidence runs inside callers' transactions: a blob
 * not yet in the sidecar is parsed by `code-index/index-file.js` in a child process, and its
 * rows are read back here.
 */
function definitionsAt(
  ctx: ServerContext,
  index: CodeIndex,
  commit: string,
  filePath: string,
): { blobSha: string; lang: string; partial: boolean; symbols: IndexedSymbol[] } | null {
  const workspace = ctx.project.workspacePath as string;
  const entry = entryAt(workspace, commit, filePath);
  if (!entry || entry.skip_reason || !entry.lang) return null;
  let lookup = index.blob(entry.blob_sha, entry.lang);
  if (lookup.state === "ok" && !lookup.indexed) {
    const child = spawnSync(
      process.execPath,
      [INDEX_FILE_SCRIPT, ctx.project.storagePath, workspace, commit, filePath],
      { stdio: "ignore", timeout: INDEX_FILE_TIMEOUT_MS, killSignal: "SIGKILL" },
    );
    if (child.status !== 0) return null;
    lookup = index.blob(entry.blob_sha, entry.lang);
  }
  if (lookup.state !== "ok" || !lookup.indexed) return null;
  if (lookup.blob.status !== "ok" && lookup.blob.status !== "parse-partial") return null;
  return {
    blobSha: entry.blob_sha,
    lang: entry.lang,
    partial: lookup.blob.status === "parse-partial",
    symbols: lookup.symbols,
  };
}

/**
 * Resolve a citation's `symbol` against the code index (PLAN §4.4), or return it unanchored
 * when the index cannot speak for the file. `lineRange` is the normal form
 * `requireEvidenceCitation` returned. Refusals are thrown.
 */
export function resolveEvidenceAnchor(
  ctx: ServerContext,
  commit: string,
  filePath: string,
  symbol: string | null,
  lineRange: string | null,
  excerpt: string | null,
): ResolvedCitation {
  const unanchored: ResolvedCitation = { symbol, lineRange, anchor: null };
  if (symbol === null || !anchorsCitation(filePath, symbol)) return unanchored;
  const index = indexFor(ctx);
  if (!index) return unanchored;
  const found = definitionsAt(ctx, index, commit, filePath);
  if (!found) return unanchored;

  const spans = lineRange === null ? null : lineSpans(lineRange);
  const within = (s: IndexedSymbol) =>
    spans === null || spans.every(([from, to]) => from >= s.doc_start_line && to <= s.end_line);
  const named = matching(found.symbols, symbol);
  if (named.length === 0) {
    // A definition whose declaration holds a syntax error is not listed, so a miss in a
    // file that parsed partially proves nothing: the row is written unanchored.
    if (found.partial) return unanchored;
    throw symbolNotFound(symbol, filePath, commit, nearestIds(found.symbols, symbol));
  }
  let def: IndexedSymbol;
  if (named.length === 1) {
    def = named[0] as IndexedSymbol;
    if (!within(def)) throw rangeOutside(lineRange as string, def, filePath, commit);
  } else {
    const inside = spans === null ? [] : named.filter(within);
    if (inside.length !== 1) throw symbolAmbiguous(symbol, filePath, commit, named);
    def = inside[0] as IndexedSymbol;
  }

  const blob = spawnSync("git", ["cat-file", "blob", found.blobSha], {
    cwd: ctx.project.workspacePath,
    maxBuffer: MAX_BLOB_BYTES,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (blob.error || blob.status !== 0) return unanchored;
  const bytes = blob.stdout as Buffer;
  const span = bytes.subarray(def.start_byte, def.end_byte);
  if (createHash("sha256").update(span).digest("hex") !== def.span_sha256) return unanchored;
  if (excerpt !== null) {
    const cited = spans ?? [[def.doc_start_line, def.end_line] as [number, number]];
    const missing = excerptMiss(definitionSegments(bytes, def, cited), excerpt);
    if (missing !== null) throw excerptOutside(missing, def, lineRange, filePath, commit);
  }
  return {
    symbol: def.symbol_id,
    lineRange: lineRange ?? lineRangeOf(def),
    anchor: {
      blob_sha: found.blobSha,
      lang: found.lang,
      symbol_id: def.symbol_id,
      kind: def.kind,
      def_start_line: def.doc_start_line,
      def_end_line: def.end_line,
      span_sha256: def.span_sha256,
      extractor_id: index.extractorId,
      range_source: lineRange === null ? "filled" : "cited",
    },
  };
}

/** Write an evidence row's anchor; the caller holds the transaction that wrote the row. */
export function insertEvidenceAnchor(db: DB, evidenceId: number, anchor: EvidenceAnchor): void {
  db.prepare(
    `INSERT INTO evidence_anchors
       (evidence_id, blob_sha, lang, symbol_id, kind, def_start_line, def_end_line,
        span_sha256, extractor_id, range_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    evidenceId,
    anchor.blob_sha,
    anchor.lang,
    anchor.symbol_id,
    anchor.kind,
    anchor.def_start_line,
    anchor.def_end_line,
    anchor.span_sha256,
    anchor.extractor_id,
    anchor.range_source,
  );
  requireEvidenceAnchor(db, evidenceId);
}

const DISP_ROLES = ["supports", "contradicts", "linchpin", "compensating"] as const;
const FIND_ROLES = [
  "symptom",
  "root-cause",
  "fix-anchor",
  "fix-verification",
  "compensating",
] as const;

export const evidenceTools: ToolDefinition[] = [
  {
    name: "add_evidence",
    description:
      "Record a structured code citation. file_path + symbol + line_range + ref_sha uniquely anchor a piece of observed behavior; kind captures how solid the observation is. ref_sha must resolve to a commit in the bound workspace and is stored resolved, because every reader reports a recorded citation as revision-bound. file_path must exist at ref_sha. line_range is N, N-M or a comma-separated list, inside the file at ref_sha. excerpt must appear in those lines (whitespace ignored; '...' marks an elision). With the code index on and a file in a language it parses, symbol must name a definition at ref_sha (a symbol_id, a qualified name, or a bare name naming one definition; read_symbol's evidence_args gives the location fields): the row stores the canonical symbol_id and is anchored to the definition, every span of line_range must lie inside the definition's citeable span, excerpt must be the definition's own text, and an omitted line_range is filled with the span. A symbol naming several definitions needs a line_range inside exactly one; a symbol naming none is refused with the nearest symbol_ids, and a free-text label belongs in note. Without a symbol, in another language, or with the index off, the row is written unanchored. Returns the evidence id to be attached to dispositions/findings/diagnosticity cells.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        symbol: { type: "string" },
        line_range: { type: "string" },
        ref_sha: { type: "string" },
        kind: { type: "string" },
        excerpt: { type: "string" },
        note: { type: "string" },
        session_id: { type: "string" },
      },
      required: ["file_path", "ref_sha", "kind"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "add_evidence");
      const filePath = requireWorkspaceSourcePath(args.file_path);
      // The revision is resolved in the bound workspace and the resolved
      // commit is what is stored: every read surface reports a non-null
      // ref_sha as revision-bound, so an unresolvable one would publish a
      // binding the record cannot support (F6/codex).
      const refSha = resolveWorkspaceCommit(ctx, requireString(args, "ref_sha"));
      const kind = requireEnum(args, "kind", EVIDENCE_KINDS);
      const symbol = optString(args, "symbol");
      const excerpt = optString(args, "excerpt");
      const lineRange = requireEvidenceCitation(
        ctx.project.workspacePath as string,
        refSha,
        filePath,
        optString(args, "line_range"),
        excerpt,
      );
      const note = optString(args, "note");
      const sessionId = optString(args, "session_id") ?? ctx.sessionId;
      const insert = (resolved: ResolvedCitation) =>
        ctx.db.transaction(() => {
          const info = ctx.db
            .prepare(
              `INSERT INTO evidence (file_path, symbol, line_range, ref_sha, kind, excerpt, note, session_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              filePath,
              resolved.symbol,
              resolved.lineRange,
              refSha,
              kind,
              excerpt,
              note,
              sessionId,
            );
          const id = Number(info.lastInsertRowid);
          if (!resolved.anchor) return ok({ id });
          insertEvidenceAnchor(ctx.db, id, resolved.anchor);
          return ok({
            id,
            symbol: resolved.symbol,
            line_range: resolved.lineRange,
            anchored: true,
            range_source: resolved.anchor.range_source,
          });
        })();
      return insert(resolveEvidenceAnchor(ctx, refSha, filePath, symbol, lineRange, excerpt));
    },
  },
  {
    name: "attach_evidence_to_disposition",
    description:
      "Link an evidence row to a disposition with a role (supports / contradicts / linchpin / compensating). Idempotent — repeated calls just update the role.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        concern_code: { type: "string" },
        evidence_id: { type: "integer" },
        role: { type: "string" },
      },
      required: ["subsystem_id", "concern_code", "evidence_id", "role"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "attach_evidence_to_disposition");
      const subsystemId = requireString(args, "subsystem_id");
      const concernCode = requireString(args, "concern_code");
      const evidenceId = requireInt(args, "evidence_id");
      const role = requireEnum(args, "role", DISP_ROLES);
      const disp = ctx.db
        .prepare("SELECT 1 FROM dispositions WHERE subsystem_id = ? AND concern_code = ?")
        .get(subsystemId, concernCode);
      if (!disp) return { ok: false, error: `no disposition for ${subsystemId}/${concernCode}` };
      const ev = ctx.db.prepare("SELECT 1 FROM evidence WHERE id = ?").get(evidenceId);
      if (!ev) return { ok: false, error: `no evidence ${evidenceId}` };
      ctx.db
        .prepare(
          `INSERT INTO disposition_evidence (subsystem_id, concern_code, evidence_id, role)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(subsystem_id, concern_code, evidence_id) DO UPDATE SET role = excluded.role`,
        )
        .run(subsystemId, concernCode, evidenceId, role);
      return ok();
    },
  },
  {
    name: "attach_evidence_to_finding",
    description:
      "Link an evidence row to a finding with a role (symptom / root-cause / fix-anchor / fix-verification / compensating). verify_finding_fix requires fix-verification.",
    inputSchema: {
      type: "object",
      properties: {
        finding_id: { type: "string" },
        evidence_id: { type: "integer" },
        role: { type: "string" },
      },
      required: ["finding_id", "evidence_id", "role"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "attach_evidence_to_finding");
      const findingId = requireString(args, "finding_id");
      const evidenceId = requireInt(args, "evidence_id");
      const role = requireEnum(args, "role", FIND_ROLES);
      const f = ctx.db.prepare("SELECT 1 FROM findings WHERE finding_id = ?").get(findingId);
      if (!f) return { ok: false, error: `no finding ${findingId}` };
      const ev = ctx.db.prepare("SELECT 1 FROM evidence WHERE id = ?").get(evidenceId);
      if (!ev) return { ok: false, error: `no evidence ${evidenceId}` };
      ctx.db
        .prepare(
          `INSERT INTO finding_evidence (finding_id, evidence_id, role)
           VALUES (?, ?, ?)
           ON CONFLICT(finding_id, evidence_id) DO UPDATE SET role = excluded.role`,
        )
        .run(findingId, evidenceId, role);
      return ok();
    },
  },
  {
    name: "get_evidence",
    description:
      "Fetch evidence rows. Filter by id, file_path, kind, ref_sha, or any combination. Returns the full row with collected_at timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        file_path: { type: "string" },
        kind: { type: "string" },
        ref_sha: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const id = optInt(args, "id");
      if (id != null) {
        return ctx.db.prepare("SELECT * FROM evidence WHERE id = ?").get(id) ?? null;
      }
      const filePath = optString(args, "file_path");
      const kind = optString(args, "kind");
      const refSha = optString(args, "ref_sha");
      const clauses: string[] = [];
      const params: string[] = [];
      if (filePath) {
        clauses.push("file_path = ?");
        params.push(filePath);
      }
      if (kind) {
        clauses.push("kind = ?");
        params.push(kind);
      }
      if (refSha) {
        clauses.push("ref_sha = ?");
        params.push(refSha);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return ctx.db
        .prepare(`SELECT * FROM evidence ${where} ORDER BY collected_at DESC`)
        .all(...params);
    },
  },
  {
    name: "get_disposition_evidence",
    description: "Return all evidence rows attached to a disposition, including role.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        concern_code: { type: "string" },
      },
      required: ["subsystem_id", "concern_code"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = requireString(args, "subsystem_id");
      const concernCode = requireString(args, "concern_code");
      return ctx.db
        .prepare(
          `SELECT e.*, de.role
             FROM disposition_evidence de JOIN evidence e ON e.id = de.evidence_id
             WHERE de.subsystem_id = ? AND de.concern_code = ?
             ORDER BY de.role, e.collected_at`,
        )
        .all(subsystemId, concernCode);
    },
  },
  {
    name: "get_finding_evidence",
    description: "Return all evidence rows attached to a finding, including role.",
    inputSchema: {
      type: "object",
      properties: { finding_id: { type: "string" } },
      required: ["finding_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const findingId = requireString(args, "finding_id");
      return ctx.db
        .prepare(
          `SELECT e.*, fe.role
             FROM finding_evidence fe JOIN evidence e ON e.id = fe.evidence_id
             WHERE fe.finding_id = ?
             ORDER BY fe.role, e.collected_at`,
        )
        .all(findingId);
    },
  },
];
