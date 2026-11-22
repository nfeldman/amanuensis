// The code index's read tools (PLAN §4.3): `outline_file`, `read_symbol`, `find_symbol` and
// `search_records`.
//
// The first two read a file at one revision through the sidecar (src/code-index/store.ts),
// which parses the blob on first use and keeps the rows by content. `outline_file` returns the
// definitions and imports with no source. `read_symbol` returns exactly the citeable span's
// bytes and the location fields of `add_evidence`. `find_symbol` searches the tree at a
// revision (src/code-index/search.ts) and `search_records` the store's records through their
// own readers (src/code-index/records.ts). The index adds to reading a file: no tool is a way
// to ration it, and each refusal states its own way on, reading the file being always open.
import { createHash } from "node:crypto";
import { BlobReader } from "../code-index/git-blobs.js";
import { RECORD_KINDS, type RecordKind, searchRecords } from "../code-index/records.js";
import { FIND_MODES, findSymbols } from "../code-index/search.js";
import {
  type CodeIndex,
  DEFAULT_BUDGETS,
  type IndexedSymbol,
  openCodeIndex,
} from "../code-index/store.js";
import {
  optBool,
  optEnum,
  optInt,
  optString,
  optStringArray,
  requireString,
  requireWorkspaceSourcePath,
  resolveWorkspaceCommit,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";

/** A definition over this many lines of its citeable span is returned cut at this many. */
const MAX_SOURCE_LINES = 400;
const MAX_CONTEXT_LINES = 50;
const NEAREST_SYMBOLS = 5;
const DOC_LINE_BYTES = 160;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

const indexes = new Map<string, CodeIndex | null>();

/** One index per storage directory for the life of the server. */
export function indexFor(ctx: ServerContext): CodeIndex | null {
  const key = ctx.project.storagePath;
  if (!indexes.has(key)) indexes.set(key, openCodeIndex(key));
  return indexes.get(key) ?? null;
}

interface Refusal {
  ok: false;
  error: string;
  rule: string;
  [field: string]: unknown;
}

function refuse(rule: string, error: string, extra: Record<string, unknown> = {}): Refusal {
  return { ok: false, error, rule: `code-index.${rule}`, ...extra };
}

const short = (commit: string): string => commit.slice(0, 12);

// ---------------------------------------------------------------------------------------
// Refusals. Each sentence is registered in contracts/refusal-parity.json and stated in
// references/code-index.md.

function unsupportedLanguage(path: string): Refusal {
  return refuse(
    "unsupported-language",
    `${path} is not in a language the code index parses (unsupported-language); read the file itself`,
    { status: "unsupported-language", path },
  );
}

function pathNotFound(path: string, commit: string): Refusal {
  return refuse(
    "path-not-found",
    `${path} is not in the tree at ${short(commit)}; name a file that revision contains`,
    { path, ref_sha: commit },
  );
}

function notFollowed(path: string, commit: string, reason: string): Refusal {
  return refuse(
    "not-followed",
    `${path} is a ${reason} at ${short(commit)} and the code index does not follow it; read the path it points to`,
    { path, ref_sha: commit, status: reason },
  );
}

const UNAVAILABLE_REASONS: Record<string, string> = {
  revision: "the revision does not resolve",
  tree: "git cannot list the revision's tree",
  "missing-object": "the revision's file is missing from this clone",
  busy: "the index database is busy",
  unreadable: "the index database is unreadable",
  "not-indexed": "the file's entry is not in the index yet",
  "stale-entry": "the index entry does not match the file's bytes",
  off: "AMANUENSIS_CODE_INDEX is off",
};

function unavailable(path: string, commit: string | null, reason: string): Refusal {
  const why = UNAVAILABLE_REASONS[reason] ?? `the index reported ${reason}`;
  return refuse(
    "unavailable",
    `the code index cannot read ${path}${commit ? ` at ${short(commit)}` : ""}: ${why}; read the file itself`,
    { path, ref_sha: commit, status: "unavailable", reason },
  );
}

function treeUnavailable(commit: string, reason: string): Refusal {
  const why = UNAVAILABLE_REASONS[reason] ?? `the index reported ${reason}`;
  return refuse(
    "unavailable",
    `the code index cannot read the tree at ${short(commit)}: ${why}; search the files with rg and read them`,
    { ref_sha: commit, status: "unavailable", reason },
  );
}

function recordsUnavailable(reason: string): Refusal {
  const why = UNAVAILABLE_REASONS[reason] ?? `the index reported ${reason}`;
  return refuse(
    "unavailable",
    `the code index cannot read the store's records: ${why}; read them with get_claims, get_narratives, get_explanations, get_findings, get_field_notes, get_open_questions or lookup_term`,
    { status: "unavailable", reason },
  );
}

function notParsed(
  path: string,
  commit: string,
  status: "too-large" | "not-utf8",
  bytes: number,
): Refusal {
  const why =
    status === "too-large"
      ? `it is ${bytes} bytes and the limit is ${DEFAULT_BUDGETS.maxFileBytes}`
      : "it is not valid UTF-8";
  return refuse(
    "not-parsed",
    `the code index did not parse ${path} at ${short(commit)}: ${why}; read the file itself`,
    { path, ref_sha: commit, status, bytes },
  );
}

function symbolNotFound(
  symbol: string,
  path: string,
  commit: string,
  symbols: IndexedSymbol[],
  lineRange: string | null,
  named: IndexedSymbol[],
): Refusal {
  const repeated = repeatedIds(symbols);
  if (named.length > 0) {
    return refuse(
      "symbol-not-found",
      `${symbol} names no definition in ${path} at ${short(commit)} that starts at lines ${lineRange}; ` +
        `its definitions start at ${named.map((m) => `${m.doc_start_line}-${m.end_line}`).join(" and ")}`,
      { path, ref_sha: commit, candidates: named.map((m) => entry(m, repeated)) },
    );
  }
  const nearest = nearestIds(symbols, symbol);
  return refuse(
    "symbol-not-found",
    `${symbol} names no definition in ${path} at ${short(commit)}; ` +
      (nearest.length > 0
        ? `nearest symbol_ids: ${nearest.join(", ")}`
        : "the file has no definitions the index lists"),
    { path, ref_sha: commit, nearest },
  );
}

// ---------------------------------------------------------------------------------------
// Rows to responses

/** The `symbol_id`s that name more than one definition in the file: its occurrences. */
function repeatedIds(symbols: IndexedSymbol[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const s of symbols) {
    if (seen.has(s.symbol_id)) repeated.add(s.symbol_id);
    seen.add(s.symbol_id);
  }
  return repeated;
}

/** The first line of a documentation comment, without its comment markers. */
function firstDocLine(doc: string): string {
  for (const raw of doc.split("\n")) {
    const text = raw
      .trim()
      .replace(/\s*(\*\/|"""|''')$/, "")
      .replace(/^(\/\*+|\/\/[/!]?|#+|\*+|"""|''')\s*/, "")
      .trim();
    if (text) return Buffer.from(text, "utf8").subarray(0, DOC_LINE_BYTES).toString("utf8");
  }
  return "";
}

type Entry = Record<string, unknown> & { children?: Entry[] };

/** One definition as listed in an outline or among candidates. */
function entry(s: IndexedSymbol, repeated: Set<string>): Entry {
  const out: Entry = {
    symbol_id: s.symbol_id,
    kind: s.kind,
    start_line: s.start_line,
    end_line: s.end_line,
  };
  if (s.doc_start_line !== s.start_line) out.doc_start_line = s.doc_start_line;
  if (repeated.has(s.symbol_id)) out.occurrence = s.occurrence;
  if (s.partial) out.partial = true;
  out.signature = s.signature;
  const doc = firstDocLine(s.doc);
  if (doc) out.doc = doc;
  return out;
}

/** Whether `outer`'s citeable span strictly contains `inner`'s. */
function contains(outer: IndexedSymbol, inner: IndexedSymbol): boolean {
  return (
    inner.start_byte >= outer.start_byte &&
    inner.end_byte <= outer.end_byte &&
    !(inner.start_byte === outer.start_byte && inner.end_byte === outer.end_byte)
  );
}

/** Definitions, in file order, as a list nested by containment. */
function nest(rows: IndexedSymbol[], repeated: Set<string>): Entry[] {
  const roots: Entry[] = [];
  const open: { row: IndexedSymbol; item: Entry }[] = [];
  for (const row of rows) {
    while (open.length > 0 && !contains(open[open.length - 1]?.row as IndexedSymbol, row)) {
      open.pop();
    }
    const item = entry(row, repeated);
    const parent = open[open.length - 1];
    if (parent) {
      parent.item.children = [...(parent.item.children ?? []), item];
    } else {
      roots.push(item);
    }
    open.push({ row, item });
  }
  return roots;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(
        Math.min(
          (previous[j] as number) + 1,
          (row[j - 1] as number) + 1,
          (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
        ),
      );
    }
    previous = row;
  }
  return previous[b.length] as number;
}

/** The file's `symbol_id`s nearest to `query`: names containing it first, then by edit distance. */
export function nearestIds(symbols: IndexedSymbol[], query: string): string[] {
  const wanted = query.toLowerCase();
  const ranked = new Map<string, [number, number]>();
  for (const s of symbols) {
    if (ranked.has(s.symbol_id)) continue;
    const forms = [s.symbol_id, s.qname, s.name].map((f) => f.toLowerCase());
    const contained = forms.some(
      (f) => f.includes(wanted) || (f.length >= 3 && wanted.includes(f)),
    );
    ranked.set(s.symbol_id, [
      contained ? 0 : 1,
      Math.min(...forms.map((f) => editDistance(wanted, f))),
    ]);
  }
  return [...ranked.entries()]
    .sort(
      ([ai, [ac, ad]], [bi, [bc, bd]]) => ac - bc || ad - bd || (ai < bi ? -1 : ai > bi ? 1 : 0),
    )
    .slice(0, NEAREST_SYMBOLS)
    .map(([id]) => id);
}

/** The definitions a `symbol` names: by `symbol_id`, else by qname, else by bare name. */
export function matching(symbols: IndexedSymbol[], symbol: string): IndexedSymbol[] {
  for (const key of ["symbol_id", "qname", "name"] as const) {
    const found = symbols.filter((s) => s[key] === symbol);
    if (found.length > 0) return found;
  }
  return [];
}

/** The `N` or `N-M` a caller read off a candidate: the lines its span or its declaration starts at. */
function parseLineRange(value: string | null): [number, number | null] | null {
  if (value === null) return null;
  const parsed = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(value);
  if (!parsed) {
    throw new ToolError(
      `line_range ${JSON.stringify(value)} is not N or N-M: give the lines a candidate lists`,
      "code-index.line-range",
    );
  }
  return [Number(parsed[1]), parsed[2] === undefined ? null : Number(parsed[2])];
}

function startsAt(s: IndexedSymbol, range: [number, number | null]): boolean {
  const [from, to] = range;
  return (s.doc_start_line === from || s.start_line === from) && (to === null || s.end_line === to);
}

export const lineRangeOf = (s: IndexedSymbol): string =>
  s.end_line > s.doc_start_line ? `${s.doc_start_line}-${s.end_line}` : `${s.doc_start_line}`;

// ---------------------------------------------------------------------------------------
// Locating a file at a revision

interface Located {
  index: CodeIndex;
  path: string;
  commit: string;
  blobSha: string;
  lang: string;
  status: "ok" | "parse-partial";
  parseErrors: number;
  bytes: number;
  lines: number | null;
  symbols: IndexedSymbol[];
  imports: { specifier: string; line: number }[];
}

/** The file's rows at `ref_sha` (default HEAD), or the refusal that says why there are none. */
async function locate(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Promise<Located | Refusal> {
  const path = requireWorkspaceSourcePath(args.path, "path");
  const commit = resolveWorkspaceCommit(ctx, optString(args, "ref_sha") ?? "HEAD");
  const index = indexFor(ctx);
  if (!index) return unavailable(path, commit, "off");
  const file = await index.indexFile(ctx.project.workspacePath, commit, path);
  if (file.state === "unavailable") return unavailable(path, file.rev, file.reason);
  if (file.state === "not-found") return pathNotFound(path, commit);
  if (file.state === "unsupported-language") return unsupportedLanguage(path);
  if (file.state === "skipped") return notFollowed(path, commit, file.skip_reason);
  if (file.state !== "ok") return unavailable(path, commit, "error");
  if (file.status === "too-large" || file.status === "not-utf8") {
    return notParsed(path, commit, file.status, file.bytes);
  }
  const lookup = index.blob(file.blob_sha, file.lang);
  if (lookup.state === "unavailable") return unavailable(path, commit, lookup.reason);
  if (!lookup.indexed) return unavailable(path, commit, "not-indexed");
  return {
    index,
    path,
    commit,
    blobSha: file.blob_sha,
    lang: file.lang,
    status: file.status,
    parseErrors: file.parse_errors,
    bytes: file.bytes,
    lines: file.lines,
    symbols: lookup.symbols,
    imports: lookup.imports,
  };
}

function isRefusal(value: Located | Refusal): value is Refusal {
  return "ok" in value;
}

/** Fields every response carries about the file, labelled with the extractor generation. */
function fileFields(located: Located): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    path: located.path,
    ref_sha: located.commit,
    blob_sha: located.blobSha,
    lang: located.lang,
    status: located.status,
    extractor_id: located.index.extractorId,
  };
  if (located.parseErrors > 0) fields.parse_errors = located.parseErrors;
  return fields;
}

// ---------------------------------------------------------------------------------------
// The tools

/** The row's citeable span from the blob's bytes, or null when the entry does not match them. */
function readSource(row: IndexedSymbol, bytes: Buffer, context: number) {
  const span = bytes.subarray(row.start_byte, row.end_byte);
  if (createHash("sha256").update(span).digest("hex") !== row.span_sha256) return null;
  const all = span.toString("utf8").split("\n");
  const truncated = all.length > MAX_SOURCE_LINES;
  const shown = truncated ? all.slice(0, MAX_SOURCE_LINES) : all;
  const out: Record<string, unknown> = {
    start_line: row.doc_start_line,
    end_line: row.doc_start_line + shown.length - 1,
    source: shown.join("\n"),
  };
  if (truncated) {
    out.definition_end_line = row.end_line;
    return out;
  }
  if (context > 0) {
    const file = bytes.toString("utf8").split("\n");
    if (file[file.length - 1] === "") file.pop();
    const before = Math.max(1, row.doc_start_line - context);
    if (before < row.doc_start_line) {
      out.context_before = {
        start_line: before,
        text: file.slice(before - 1, row.doc_start_line - 1).join("\n"),
      };
    }
    const after = Math.min(file.length, row.end_line + context);
    if (after > row.end_line) {
      out.context_after = {
        start_line: row.end_line + 1,
        text: file.slice(row.end_line, after).join("\n"),
      };
    }
  }
  return out;
}

export const codeIndexTools: ToolDefinition[] = [
  {
    name: "outline_file",
    description:
      "The shape of one source file at a revision, from the code index: its definitions as a nested list (symbol_id, kind, lines, signature, first documentation line), its imports, bytes, lines, blob_sha and parse status. No source is returned. Read a definition with read_symbol, or read the whole file; the index adds to reading and never replaces it. ref_sha defaults to the workspace HEAD and is returned resolved. Languages: TypeScript, TSX, JavaScript, Python, Rust, Go, Java, C, C++ and C#; any other file is refused as unsupported-language.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        ref_sha: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    compact: true,
    handler: async (args, ctx) => {
      const located = await locate(args, ctx);
      if (isRefusal(located)) return located;
      const repeated = repeatedIds(located.symbols);
      return {
        ok: true,
        ...fileFields(located),
        bytes: located.bytes,
        lines: located.lines,
        symbols: nest(located.symbols, repeated),
        imports: located.imports,
        ...(located.status === "parse-partial"
          ? { note: "a definition whose declaration holds a syntax error is not listed" }
          : {}),
      };
    },
  },
  {
    name: "read_symbol",
    description:
      "One definition's source at a revision, from the code index. symbol is a symbol_id, a qualified name or a bare name. One match returns exactly the citeable span's text (leading documentation included) with start_line and end_line, and evidence_args: the location fields of add_evidence (file_path, symbol, ref_sha, line_range). The agent adds kind, which only it can choose; excerpt and note are optional. Several matches return their candidates with lines and no source; line_range (a candidate's lines, N or N-M) picks one occurrence. No match is refused with the nearest symbol_ids. A definition over 400 lines returns its first 400, its nested definitions, truncated: true and no evidence_args: read the whole file or a nested definition to go on. context_lines adds lines before and after the span without changing the citation. ref_sha defaults to the workspace HEAD.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        symbol: { type: "string" },
        ref_sha: { type: "string" },
        line_range: { type: "string" },
        context_lines: { type: "integer", minimum: 0, maximum: MAX_CONTEXT_LINES },
      },
      required: ["path", "symbol"],
      additionalProperties: false,
    },
    compact: true,
    handler: async (args, ctx) => {
      const symbol = requireString(args, "symbol");
      const lineRange = optString(args, "line_range");
      const range = parseLineRange(lineRange);
      const context = optInt(args, "context_lines", 0) ?? 0;
      if (context < 0 || context > MAX_CONTEXT_LINES) {
        throw new ToolError(`context_lines must be from 0 to ${MAX_CONTEXT_LINES}`, "arg.range");
      }
      const located = await locate(args, ctx);
      if (isRefusal(located)) return located;
      const repeated = repeatedIds(located.symbols);
      const named = matching(located.symbols, symbol);
      const matches = range ? named.filter((s) => startsAt(s, range)) : named;
      if (matches.length === 0) {
        return symbolNotFound(
          symbol,
          located.path,
          located.commit,
          located.symbols,
          lineRange,
          named,
        );
      }
      if (matches.length > 1) {
        return {
          ok: true,
          ambiguous: true,
          ...fileFields(located),
          candidates: matches.map((m) => entry(m, repeated)),
        };
      }
      const row = matches[0] as IndexedSymbol;
      const reader = new BlobReader(ctx.project.workspacePath);
      let bytes: Buffer | null;
      try {
        bytes = await reader.read(located.blobSha);
      } finally {
        reader.close();
      }
      if (!bytes) return unavailable(located.path, located.commit, "missing-object");
      const read = readSource(row, bytes, context);
      if (!read) return unavailable(located.path, located.commit, "stale-entry");
      const truncated = read.definition_end_line !== undefined;
      return {
        ok: true,
        ...fileFields(located),
        symbol_id: row.symbol_id,
        kind: row.kind,
        ...(repeated.has(row.symbol_id) ? { occurrence: row.occurrence } : {}),
        ...(row.partial ? { partial: true } : {}),
        ...read,
        ...(truncated
          ? {
              truncated: true,
              nested: nest(
                located.symbols.filter((s) => s !== row && contains(row, s)),
                repeated,
              ),
            }
          : {
              span_sha256: row.span_sha256,
              evidence_args: {
                file_path: located.path,
                symbol: row.symbol_id,
                ref_sha: located.commit,
                line_range: lineRangeOf(row),
              },
            }),
      };
    },
  },
  {
    name: "find_symbol",
    description:
      'Search the code index at a revision. mode definitions (the default) ranks definitions by BM25 over their names split on case and punctuation, qualified names, signatures and doc comments, so a fragment such as Request finds parseHTTPRequest and a word from a doc comment finds its definition. mode references returns the places where query appears as an identifier: they are matched by name only, never resolved, so a row may be a different thing with the same name, and every row carries match: "name". Rows never carry bodies. A definition row carries path, symbol_id, kind, lines and signature: read it with read_symbol, or read the file; a reference row carries path, name, kind, line and match, and no symbol_id: read the file at that line. kind and path_prefix narrow the rows; when every file under path_prefix is in a language the index does not parse, the empty answer carries status: "unsupported-language". limit defaults to 20. The revision\'s tree is indexed on first use, and partial: true says the index of that tree is incomplete, so a missing row proves nothing; the next call resumes it. ref_sha defaults to the workspace HEAD.',
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        mode: { type: "string", enum: [...FIND_MODES] },
        kind: { type: "string" },
        path_prefix: { type: "string" },
        ref_sha: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["query"],
      additionalProperties: false,
    },
    compact: true,
    handler: async (args, ctx) => {
      const query = requireString(args, "query");
      const mode = optEnum(args, "mode", FIND_MODES) ?? "definitions";
      const limit = optInt(args, "limit", DEFAULT_LIMIT) ?? DEFAULT_LIMIT;
      if (limit < 1 || limit > MAX_LIMIT) {
        throw new ToolError(`limit must be from 1 to ${MAX_LIMIT}`, "arg.range");
      }
      const commit = resolveWorkspaceCommit(ctx, optString(args, "ref_sha") ?? "HEAD");
      const index = indexFor(ctx);
      if (!index) return treeUnavailable(commit, "off");
      const found = await findSymbols(index, ctx.project.workspacePath as string, commit, query, {
        mode,
        kind: optString(args, "kind"),
        pathPrefix: optString(args, "path_prefix"),
        limit,
      });
      if (found.state === "unavailable") return treeUnavailable(commit, found.reason);
      return {
        ok: true,
        mode,
        query,
        ref_sha: commit,
        extractor_id: index.extractorId,
        partial: found.partial,
        ...(found.partial_reason ? { partial_reason: found.partial_reason } : {}),
        ...(found.status ? { status: found.status } : {}),
        results: found.results,
        ...(found.more ? { more: true } : {}),
      };
    },
  },
  {
    name: "search_records",
    description:
      "Full-text search (BM25) over the store's records: claims, narratives, explanations, findings, field notes, open questions and vocabulary. Each hit carries kind, id, subject, status and a snippet of at most 240 bytes; open the record with its own reader. A hit is returned only as that reader returns it: claims as get_claims at the workspace HEAD, so superseded, invalidated and inapplicable claims drop out; narratives as get_narratives, the effective row per section and topic, withdrawn keys excluded; explanations as get_explanations, the newest row whose revision the workspace reaches, below its phase not at all; open questions as get_open_questions, open ones; findings, field notes and vocabulary with their status. include_history: true adds the rows those readers leave out, each with the status that says why. kinds and subject (a subsystem id, or a claim_key prefix) narrow the hits; limit defaults to 20. The index is brought up to date with the store on every call.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        kinds: { type: "array", items: { type: "string", enum: [...RECORD_KINDS] } },
        subject: { type: "string" },
        include_history: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["query"],
      additionalProperties: false,
    },
    compact: true,
    handler: async (args, ctx) => {
      const query = requireString(args, "query");
      const kinds = optStringArray(args, "kinds");
      for (const kind of kinds ?? []) {
        if (!RECORD_KINDS.includes(kind as RecordKind)) {
          throw new ToolError(`kinds must be among: ${RECORD_KINDS.join(", ")}`, "arg.enum");
        }
      }
      const limit = optInt(args, "limit", DEFAULT_LIMIT) ?? DEFAULT_LIMIT;
      if (limit < 1 || limit > MAX_LIMIT) {
        throw new ToolError(`limit must be from 1 to ${MAX_LIMIT}`, "arg.range");
      }
      const includeHistory = optBool(args, "include_history");
      const head = resolveWorkspaceCommit(ctx, "HEAD");
      const index = indexFor(ctx);
      if (!index) return recordsUnavailable("off");
      const found = await searchRecords(index, ctx, head, {
        query,
        kinds: kinds as RecordKind[] | null,
        subject: optString(args, "subject"),
        includeHistory,
        limit,
      });
      if (found.state === "unavailable") return recordsUnavailable(found.reason);
      return {
        ok: true,
        query,
        ref_sha: head,
        include_history: includeHistory,
        results: found.results,
        ...(found.more ? { more: true } : {}),
      };
    },
  },
];
