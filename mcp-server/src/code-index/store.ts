// The code index's sidecar (PLAN §4.1): a cache of the extractor's tables keyed by content.
//
// Where it lives. `<storage>/code-index/<extractor_id>/index.db`, beside `memory.db`, created
// on first use. `code-index/` carries a `.gitignore` of `*` and `commitStorage` excludes it by
// pathspec, as it does the call log. Nothing in `memory.db` refers to a row here, so deleting
// the directory is always safe. `storageManifest` is not touched: it serves only migration
// from a pre-0.3 location, and a sidecar is only ever created at the current one (D6).
//
// Keys. A parse is keyed by (blob_sha, lang) inside one generation, so the same bytes under
// `.ts` and `.js` are two entries; the language comes from the tree entry's path. Each
// extractor_id has its own directory, so two server versions sharing a storage directory
// never rebuild each other's cache. A process touches its generation's `last_opened` when it
// opens it and at least hourly while it runs; opening collects other generations untouched
// for 30 days.
//
// Several processes. WAL, busy_timeout 5 s. A blob is parsed outside any transaction and
// published in one transaction that inserts its symbols, refs and imports and, last, its
// `blobs` row; a reader treats a blob as indexed only when that row exists. Inserts are
// INSERT OR IGNORE, so two processes parsing one blob converge (the extractor is
// deterministic). A whole-tree index writes `trees` rows and, last, `trees_complete`, which
// it withholds while a supported blob is missing; a `trees` row is updated when its entry's
// state changes, so an object that arrives later completes the same revision.
//
// Recovery is for corruption only. SQLITE_BUSY, SQLITE_LOCKED, a permission error or any
// other SQLite or filesystem failure (EACCES, EPERM, EROFS, ENOSPC) leaves the index
// `unavailable` for that call; opening never throws for them. Only SQLITE_CORRUPT,
// SQLITE_NOTADB or a failed `PRAGMA quick_check` sets the database aside, renaming
// index.db-wal, index.db-shm and, last, index.db to `*.corrupt-<time>`. A recoverer holds
// `index.db.recovering` (created exclusively) while it rechecks the inode and renames, and no
// process opens the database while that marker exists, so two recoverers cannot both rename
// and an opener cannot pair a new database with the old WAL; a marker a minute old was left
// by a process that died and is broken. Every request checks the database file's inode and
// reopens when it has changed, so a process that had the old file open moves to the new one;
// its in-flight writes to the old file are lost, which a cache can afford.
//
// Disk. The generation's budget is bytes on disk, the database and its WAL. The database is
// created with incremental auto-vacuum, and eviction vacuums and truncates the WAL, so what
// it deletes leaves the disk; when kept trees alone exceed the budget, the result says so.
//
// AMANUENSIS_CODE_INDEX=off: the code-index tools are not registered, and nothing under
// `code-index/` is created or collected.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { type CodeLanguage, type Extraction, extract, extractorId } from "./extract.js";
import {
  BlobReader,
  blobSizes,
  decodeBlob,
  entryAt,
  listTree,
  resolveCommit,
  type SkipReason,
  type TreeEntry,
} from "./git-blobs.js";

export const CODE_INDEX_DIRECTORY = "code-index";
export const CODE_INDEX_DATABASE = "index.db";
export const CODE_INDEX_TOOLS: readonly string[] = [
  "outline_file",
  "read_symbol",
  "find_symbol",
  "search_records",
];
const CODE_INDEX_IGNORE = "*\n";
const LAST_OPENED = "last_opened";
const SCHEMA_VERSION = "1";

const HOUR_MS = 3_600_000;
/** A generation untouched this long is collected. */
const COLLECT_AFTER_MS = 30 * 24 * HOUR_MS;
const BUSY_TIMEOUT_MS = 5_000;
/** Revisions whose trees are kept, and whose blobs the disk budget never evicts. */
const KEPT_TREES = 8;
const TREE_BATCH = 1_000;
const EVICT_BATCH = 100;
const RECOVERY_MARKER = ".recovering";
/** A recovery marker older than this was left by a process that died mid-recovery. */
const STALE_RECOVERY_MS = 60_000;

export interface Budgets {
  /** Per file: larger blobs are recorded `too-large` and not parsed. */
  maxFileBytes: number;
  /** Per whole-tree call: files parsed (AMANUENSIS_CODE_INDEX_MAX_FILES). */
  maxFiles: number;
  /** Per whole-tree call: source bytes parsed. */
  maxSourceBytes: number;
  /** Per whole-tree call: elapsed time. */
  maxMillis: number;
  /** Per generation on disk. */
  maxGenerationBytes: number;
}

export const DEFAULT_BUDGETS: Budgets = {
  maxFileBytes: 2 * 1024 * 1024,
  maxFiles: 20_000,
  maxSourceBytes: 200 * 1024 * 1024,
  maxMillis: 30_000,
  maxGenerationBytes: 1024 * 1024 * 1024,
};

export function codeIndexEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.AMANUENSIS_CODE_INDEX?.trim().toLowerCase();
  return !(raw === "off" || raw === "0" || raw === "false" || raw === "no");
}

/** The tools to register: without the code-index tools when the index is off. */
export function withCodeIndexSwitch<T extends { name: string }>(
  tools: T[],
  env: NodeJS.ProcessEnv = process.env,
): T[] {
  if (codeIndexEnabled(env)) return tools;
  return tools.filter((tool) => !CODE_INDEX_TOOLS.includes(tool.name));
}

/**
 * Words for full-text search: the text, and its identifiers split on punctuation and case
 * (`parseHTTPRequest` → `parse HTTP Request`).
 */
export function searchWords(text: string): string {
  const words = text
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((part) =>
      part
        .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
        .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
        .split(" "),
    )
    .filter(Boolean);
  return [text, ...words].join(" ");
}

// ---------------------------------------------------------------------------------------
// Generations

function generationRoot(storagePath: string): string {
  return join(storagePath, CODE_INDEX_DIRECTORY);
}

function ensureRoot(storagePath: string): string {
  const root = generationRoot(storagePath);
  mkdirSync(root, { recursive: true });
  const ignore = join(root, ".gitignore");
  if (!existsSync(ignore) || readFileSync(ignore, "utf8") !== CODE_INDEX_IGNORE) {
    writeFileSync(ignore, CODE_INDEX_IGNORE, "utf8");
  }
  return root;
}

export interface CollectOptions {
  /** The generation in use; never collected. */
  keep?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

/**
 * Delete generations whose `last_opened` (or, without one, whose directory) is more than
 * 30 days old. Creates nothing; with the index off, does nothing.
 */
export function collectGenerations(
  storagePath: string,
  options: CollectOptions = {},
): { collected: string[]; kept: string[] } {
  const result = { collected: [] as string[], kept: [] as string[] };
  if (!codeIndexEnabled(options.env)) return result;
  const root = generationRoot(storagePath);
  if (!existsSync(root)) return result;
  const now = (options.now ?? Date.now)();
  for (const name of readdirSync(root)) {
    if (name.startsWith(".")) continue;
    const dir = join(root, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      if (name === options.keep) {
        result.kept.push(name);
        continue;
      }
      const marker = join(dir, LAST_OPENED);
      const touched = existsSync(marker) ? statSync(marker).mtimeMs : statSync(dir).mtimeMs;
      if (now - touched > COLLECT_AFTER_MS) {
        rmSync(dir, { recursive: true, force: true });
        result.collected.push(name);
      } else {
        result.kept.push(name);
      }
    } catch {
      // Another process may be collecting or creating it; leave it.
    }
  }
  return result;
}

/**
 * At server start: collect stale generations other than this build's. Never throws, and
 * does nothing with the index off.
 */
export function collectStaleGenerations(
  storagePath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!codeIndexEnabled(env)) return;
  let keep: string | undefined;
  try {
    keep = extractorId();
  } catch {
    // Without grammars this build has no generation of its own to keep.
  }
  try {
    collectGenerations(storagePath, { keep, env });
  } catch {
    // Collection is housekeeping; a failure costs disk, not a call.
  }
}

export interface CodeIndexOptions {
  env?: NodeJS.ProcessEnv;
  /** The directory holding grammars/ and queries/; defaults to this package's root. */
  packageRoot?: string;
  budgets?: Partial<Budgets>;
  busyTimeoutMs?: number;
  /** The clock for touching and collecting generations. */
  now?: () => number;
  /** How often an open index touches its generation unprompted; an hour by default. */
  touchEveryMs?: number;
}

/**
 * The code index for a storage directory, or null when AMANUENSIS_CODE_INDEX is off.
 * Creates the generation's directory, touches it and collects stale generations; the
 * database itself opens on the first request.
 */
export function openCodeIndex(
  storagePath: string,
  options: CodeIndexOptions = {},
): CodeIndex | null {
  if (!codeIndexEnabled(options.env)) return null;
  return new CodeIndex(storagePath, options);
}

// ---------------------------------------------------------------------------------------
// The database

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blobs (
    blob_sha      TEXT    NOT NULL,
    lang          TEXT    NOT NULL,
    bytes         INTEGER NOT NULL,
    lines         INTEGER,
    parse_errors  INTEGER NOT NULL,
    status        TEXT    NOT NULL CHECK (status IN ('ok','parse-partial','too-large','not-utf8')),
    indexed_at    TEXT    NOT NULL,
    PRIMARY KEY (blob_sha, lang)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS symbols (
    id              INTEGER PRIMARY KEY,
    blob_sha        TEXT    NOT NULL,
    lang            TEXT    NOT NULL,
    ordinal         INTEGER NOT NULL,
    symbol_id       TEXT    NOT NULL,
    name            TEXT    NOT NULL,
    qname           TEXT    NOT NULL,
    kind            TEXT    NOT NULL,
    start_line      INTEGER NOT NULL,
    end_line        INTEGER NOT NULL,
    occurrence      INTEGER NOT NULL,
    doc_start_line  INTEGER NOT NULL,
    start_byte      INTEGER NOT NULL,
    end_byte        INTEGER NOT NULL,
    signature       TEXT    NOT NULL,
    doc             TEXT    NOT NULL,
    span_sha256     TEXT    NOT NULL,
    partial         INTEGER NOT NULL DEFAULT 0,
    UNIQUE (blob_sha, lang, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_symbol_id ON symbols(symbol_id);
CREATE TABLE IF NOT EXISTS refs (
    blob_sha  TEXT    NOT NULL,
    lang      TEXT    NOT NULL,
    ordinal   INTEGER NOT NULL,
    name      TEXT    NOT NULL,
    kind      TEXT    NOT NULL,
    line      INTEGER NOT NULL,
    PRIMARY KEY (blob_sha, lang, ordinal)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_refs_name ON refs(name);
CREATE TABLE IF NOT EXISTS imports (
    blob_sha   TEXT    NOT NULL,
    lang       TEXT    NOT NULL,
    ordinal    INTEGER NOT NULL,
    specifier  TEXT    NOT NULL,
    line       INTEGER NOT NULL,
    PRIMARY KEY (blob_sha, lang, ordinal)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS trees (
    rev          TEXT NOT NULL,
    path         TEXT NOT NULL,
    mode         TEXT NOT NULL,
    blob_sha     TEXT NOT NULL,
    lang         TEXT,
    skip_reason  TEXT,
    PRIMARY KEY (rev, path)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_trees_blob ON trees(blob_sha);
CREATE TABLE IF NOT EXISTS trees_complete (
    rev           TEXT PRIMARY KEY,
    files         INTEGER NOT NULL,
    skipped       INTEGER NOT NULL,
    completed_at  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS tree_revs (
    rev         TEXT PRIMARY KEY,
    touched_at  TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
    name, qname, signature, doc,
    content='symbols', content_rowid='id', tokenize='porter unicode61'
);
`;

export interface BlobRow {
  blob_sha: string;
  lang: string;
  bytes: number;
  lines: number | null;
  parse_errors: number;
  status: "ok" | "parse-partial" | "too-large" | "not-utf8";
  indexed_at: string;
}

export interface IndexedSymbol {
  ordinal: number;
  symbol_id: string;
  name: string;
  qname: string;
  kind: string;
  start_line: number;
  end_line: number;
  occurrence: number;
  doc_start_line: number;
  start_byte: number;
  end_byte: number;
  signature: string;
  doc: string;
  span_sha256: string;
  partial?: true;
}

export interface Unavailable {
  state: "unavailable";
  reason: string;
}

export type BlobLookup =
  | Unavailable
  | { state: "ok"; indexed: false }
  | {
      state: "ok";
      indexed: true;
      blob: BlobRow;
      symbols: IndexedSymbol[];
      refs: { name: string; kind: string; line: number }[];
      imports: { specifier: string; line: number }[];
    };

export interface TreeResult {
  state: "ok" | "partial" | "unavailable";
  reason?: string;
  rev: string;
  partial: boolean;
  /** Entries in the tree. */
  files: number;
  /** Blobs parsed (or recorded too-large or not-utf8) by this call. */
  indexed: number;
  /** Blobs already in the cache. */
  cached: number;
  skipped: Partial<Record<SkipReason, number>>;
  /** Entries whose object is missing. */
  unavailable: number;
  /** The budget that stopped this call, if one did. */
  budget: { limit: "files" | "source-bytes" | "time"; value: number } | null;
  /** Blobs deleted by the generation's disk budget. */
  evicted: number;
  /** The disk budget, when kept trees alone leave the generation over it. */
  disk_over_budget: { bytes: number; limit: number } | null;
}

export type FileResult =
  | (Unavailable & { path: string; rev: string | null })
  | { state: "not-found" | "unsupported-language"; path: string; rev: string }
  | {
      state: "skipped";
      path: string;
      rev: string;
      mode: string;
      blob_sha: string;
      skip_reason: SkipReason;
    }
  | {
      state: "ok";
      path: string;
      rev: string;
      mode: string;
      blob_sha: string;
      lang: CodeLanguage;
      status: BlobRow["status"];
      bytes: number;
      lines: number | null;
      parse_errors: number;
      evicted: number;
    };

class CorruptDatabase extends Error {
  readonly code = "SQLITE_CORRUPT";
}

class RecoveryInProgress extends Error {
  readonly code = "SQLITE_BUSY";
}

type Failure = "corrupt" | "unavailable";

function classify(error: unknown): Failure | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return null;
  if (code.startsWith("SQLITE_CORRUPT") || code === "SQLITE_NOTADB") return "corrupt";
  if (code.startsWith("SQLITE_") || ["EACCES", "EPERM", "EROFS", "ENOSPC"].includes(code)) {
    return "unavailable";
  }
  return null;
}

function reasonOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return "busy";
  if (code === "SQLITE_CANTOPEN" || code === "SQLITE_PERM" || code === "SQLITE_READONLY") {
    return "unreadable";
  }
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "unreadable";
  return typeof code === "string" ? code : "error";
}

/**
 * Switch to WAL. SQLite answers a concurrent switch with SQLITE_BUSY at once, without its
 * busy handler, so two processes opening a new sidecar together retry here within the
 * same timeout.
 */
function enterWal(db: Database.Database, busyTimeoutMs: number): void {
  const deadline = Date.now() + busyTimeoutMs;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      if (db.pragma("journal_mode", { simple: true }) === "wal") return;
      db.pragma("journal_mode = WAL");
      return;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== "SQLITE_BUSY" || Date.now() >= deadline) throw error;
      Atomics.wait(pause, 0, 0, 20);
    }
  }
}

function pauseFor(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Wait for another process's recovery marker to go, up to `deadline`; a stale marker is
 * removed. True when no marker remains.
 */
function recoveryFinished(marker: string, deadline: number): boolean {
  for (;;) {
    let modified: number;
    try {
      modified = statSync(marker).mtimeMs;
    } catch {
      return true;
    }
    if (Date.now() - modified > STALE_RECOVERY_MS) {
      rmSync(marker, { force: true });
      continue;
    }
    if (Date.now() >= deadline) return false;
    pauseFor(20);
  }
}

function inodeOf(path: string): number | null {
  try {
    return statSync(path).ino;
  } catch {
    return null;
  }
}

function toSymbol(row: Record<string, unknown>): IndexedSymbol {
  const symbol: IndexedSymbol = {
    ordinal: row.ordinal as number,
    symbol_id: row.symbol_id as string,
    name: row.name as string,
    qname: row.qname as string,
    kind: row.kind as string,
    start_line: row.start_line as number,
    end_line: row.end_line as number,
    occurrence: row.occurrence as number,
    doc_start_line: row.doc_start_line as number,
    start_byte: row.start_byte as number,
    end_byte: row.end_byte as number,
    signature: row.signature as string,
    doc: row.doc as string,
    span_sha256: row.span_sha256 as string,
  };
  if (row.partial === 1) symbol.partial = true;
  return symbol;
}

interface Parsed {
  blob: BlobRow;
  extraction: Extraction | null;
}

export class CodeIndex {
  readonly extractorId: string;
  readonly directory: string;
  readonly databasePath: string;
  private readonly budgets: Budgets;
  private readonly now: () => number;
  private db: Database.Database | null = null;
  /** The inode of the file `db` has open. */
  private inode: number | null = null;
  /** The inode found at the path when the last open was attempted. */
  private attempted: number | null = null;
  private lastTouched = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly storagePath: string,
    private readonly options: CodeIndexOptions,
  ) {
    this.extractorId = extractorId({ packageRoot: options.packageRoot });
    this.directory = join(generationRoot(storagePath), this.extractorId);
    this.databasePath = join(this.directory, CODE_INDEX_DATABASE);
    this.budgets = { ...DEFAULT_BUDGETS, ...options.budgets };
    this.now = options.now ?? Date.now;
    try {
      this.ensureDirectory();
    } catch {
      // An unwritable storage directory: each request reports `unavailable` when it retries.
    }
    this.touch();
    collectGenerations(storagePath, { keep: this.extractorId, env: options.env, now: this.now });
    this.timer = setInterval(() => this.touch(), options.touchEveryMs ?? HOUR_MS);
    this.timer.unref();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.db?.close();
    } catch {
      // The handle is being discarded either way.
    }
    this.db = null;
    this.inode = null;
  }

  // -------------------------------------------------------------------------------------
  // Reads

  /** The cached entry for (blob_sha, lang); indexed only when its `blobs` row exists. */
  blob(blobSha: string, lang: string): BlobLookup {
    return this.run((db) =>
      db.transaction((): BlobLookup => {
        const blob = db
          .prepare("SELECT * FROM blobs WHERE blob_sha = ? AND lang = ?")
          .get(blobSha, lang) as BlobRow | undefined;
        if (!blob) return { state: "ok", indexed: false };
        const symbols = (
          db
            .prepare("SELECT * FROM symbols WHERE blob_sha = ? AND lang = ? ORDER BY ordinal")
            .all(blobSha, lang) as Record<string, unknown>[]
        ).map(toSymbol);
        const refs = db
          .prepare(
            "SELECT name, kind, line FROM refs WHERE blob_sha = ? AND lang = ? ORDER BY ordinal",
          )
          .all(blobSha, lang) as { name: string; kind: string; line: number }[];
        const imports = db
          .prepare(
            "SELECT specifier, line FROM imports WHERE blob_sha = ? AND lang = ? ORDER BY ordinal",
          )
          .all(blobSha, lang) as { specifier: string; line: number }[];
        return { state: "ok", indexed: true, blob, symbols, refs, imports };
      })(),
    );
  }

  /** Whether the tree at `rev` (a commit sha) is completely indexed. */
  treeStatus(
    rev: string,
  ): Unavailable | { state: "ok"; complete: boolean; files: number; skipped: number } {
    return this.run((db) => {
      const row = db.prepare("SELECT files, skipped FROM trees_complete WHERE rev = ?").get(rev) as
        | { files: number; skipped: number }
        | undefined;
      if (row) return { state: "ok" as const, complete: true, ...row };
      const counted = db
        .prepare("SELECT COUNT(*) AS files, COUNT(skip_reason) AS skipped FROM trees WHERE rev = ?")
        .get(rev) as { files: number; skipped: number };
      return { state: "ok" as const, complete: false, ...counted };
    });
  }

  // -------------------------------------------------------------------------------------
  // Indexing

  /** Index one path at a revision: the entry, its blob, and the blob's tables. */
  async indexFile(workspace: string, rev: string, path: string): Promise<FileResult> {
    const commit = resolveCommit(workspace, rev);
    if (!commit) return { state: "unavailable", reason: "revision", path, rev: null };
    const entry = entryAt(workspace, commit, path);
    if (entry === null) return { state: "unavailable", reason: "tree", path, rev: commit };
    if (entry === undefined) return { state: "not-found", path, rev: commit };
    if (entry.skip_reason && entry.skip_reason !== "unsupported-language") {
      return {
        state: "skipped",
        path,
        rev: commit,
        mode: entry.mode,
        blob_sha: entry.blob_sha,
        skip_reason: entry.skip_reason,
      };
    }
    if (!entry.lang) return { state: "unsupported-language", path, rev: commit };
    const lang = entry.lang;
    const found = this.run(
      (db) =>
        (db
          .prepare("SELECT * FROM blobs WHERE blob_sha = ? AND lang = ?")
          .get(entry.blob_sha, lang) as BlobRow | undefined) ?? null,
    );
    if (found && "state" in found) return { ...found, path, rev: commit };
    let blob = found;
    let evicted = 0;
    if (!blob) {
      const sizes = blobSizes(workspace, [entry.blob_sha]);
      const size = sizes?.get(entry.blob_sha);
      if (size === undefined || size === null) {
        return { state: "unavailable", reason: "missing-object", path, rev: commit };
      }
      const reader = new BlobReader(workspace);
      try {
        const parsed = await this.parse(reader, entry.blob_sha, lang, size);
        if (!parsed) return { state: "unavailable", reason: "missing-object", path, rev: commit };
        const published = this.publish(parsed);
        if (published !== true) return { ...published, path, rev: commit };
        blob = parsed.blob;
      } finally {
        reader.close();
      }
      const swept = this.evict();
      evicted = "state" in swept ? 0 : swept.evicted;
    }
    return {
      state: "ok",
      path,
      rev: commit,
      mode: entry.mode,
      blob_sha: entry.blob_sha,
      lang,
      status: blob.status,
      bytes: blob.bytes,
      lines: blob.lines,
      parse_errors: blob.parse_errors,
      evicted,
    };
  }

  /**
   * Index every supported file in the tree at `rev`. Stops at a budget with
   * `partial: true`; the next call resumes from what was published.
   */
  async indexTree(
    workspace: string,
    rev: string,
    options: {
      onProgress?: (progress: { indexed: number; cached: number; files: number }) => void;
    } = {},
  ): Promise<TreeResult> {
    const started = Date.now();
    const result: TreeResult = {
      state: "ok",
      rev,
      partial: false,
      files: 0,
      indexed: 0,
      cached: 0,
      skipped: {},
      unavailable: 0,
      budget: null,
      evicted: 0,
      disk_over_budget: null,
    };
    const unavailable = (reason: string): TreeResult => ({
      ...result,
      state: "unavailable",
      reason,
    });
    const commit = resolveCommit(workspace, rev);
    if (!commit) return unavailable("revision");
    result.rev = commit;
    const entries = listTree(workspace, commit);
    if (!entries) return unavailable("tree");
    result.files = entries.length;

    const cachedKeys = this.run((db) => {
      const known = new Set<string>();
      const lookup = db.prepare("SELECT 1 FROM blobs WHERE blob_sha = ? AND lang = ?");
      for (const e of entries) {
        if (e.lang && !e.skip_reason && lookup.get(e.blob_sha, e.lang)) {
          known.add(`${e.blob_sha}\0${e.lang}`);
        }
      }
      return known;
    });
    if (!(cachedKeys instanceof Set)) return unavailable(cachedKeys.reason);

    const candidates: TreeEntry[] = [];
    const queued = new Set<string>();
    for (const e of entries) {
      if (!e.lang || e.skip_reason) continue;
      const key = `${e.blob_sha}\0${e.lang}`;
      if (queued.has(key)) continue;
      queued.add(key);
      if (cachedKeys.has(key)) result.cached++;
      else candidates.push(e);
    }
    const sizes = blobSizes(
      workspace,
      candidates.map((e) => e.blob_sha),
    );
    if (!sizes) return unavailable("objects");
    for (const e of entries) {
      if (e.lang && !e.skip_reason && sizes.has(e.blob_sha) && sizes.get(e.blob_sha) === null) {
        e.skip_reason = "unavailable";
        result.unavailable++;
      }
      if (e.skip_reason) result.skipped[e.skip_reason] = (result.skipped[e.skip_reason] ?? 0) + 1;
    }

    const recorded = this.recordTree(commit, entries);
    if (recorded !== true) return unavailable(recorded.reason);

    const maxFiles = this.maxFiles();
    let sourceBytes = 0;
    const reader = new BlobReader(workspace);
    try {
      for (const e of candidates) {
        if (e.skip_reason || !e.lang) continue;
        const size = sizes.get(e.blob_sha) as number;
        const parses = size <= this.budgets.maxFileBytes;
        if (result.indexed >= maxFiles) {
          result.budget = { limit: "files", value: maxFiles };
        } else if (result.indexed >= 1 && Date.now() - started >= this.budgets.maxMillis) {
          result.budget = { limit: "time", value: this.budgets.maxMillis };
        } else if (
          result.indexed >= 1 &&
          parses &&
          sourceBytes + size > this.budgets.maxSourceBytes
        ) {
          result.budget = { limit: "source-bytes", value: this.budgets.maxSourceBytes };
        }
        if (result.budget) break;
        const parsed = await this.parse(reader, e.blob_sha, e.lang, size);
        if (!parsed) {
          result.unavailable++;
          continue;
        }
        const published = this.publish(parsed);
        if (published !== true) return unavailable(published.reason);
        if (parses) sourceBytes += size;
        result.indexed++;
        options.onProgress?.({
          indexed: result.indexed,
          cached: result.cached,
          files: result.files,
        });
      }
    } finally {
      reader.close();
    }

    if (result.budget || result.unavailable > 0) {
      // A missing blob leaves absence unprovable: the tree stays incomplete until it arrives.
      result.partial = true;
      result.state = "partial";
    } else {
      const skipped = entries.filter((e) => e.skip_reason).length;
      const completed = this.run((db) => {
        db.prepare(
          "INSERT OR IGNORE INTO trees_complete (rev, files, skipped, completed_at) VALUES (?, ?, ?, ?)",
        ).run(commit, entries.length, skipped, new Date().toISOString());
        return true as const;
      });
      if (completed !== true) return unavailable(completed.reason);
    }
    const evicted = this.evict();
    if ("state" in evicted) return unavailable(evicted.reason);
    result.evicted = evicted.evicted;
    result.disk_over_budget = evicted.over;
    return result;
  }

  // -------------------------------------------------------------------------------------
  // Internals

  private maxFiles(): number {
    const raw = Number((this.options.env ?? process.env).AMANUENSIS_CODE_INDEX_MAX_FILES);
    return Number.isInteger(raw) && raw > 0 ? raw : this.budgets.maxFiles;
  }

  /** Fetch, decode and extract one blob, outside any transaction; null when it is missing. */
  private async parse(
    reader: BlobReader,
    blobSha: string,
    lang: CodeLanguage,
    size: number,
  ): Promise<Parsed | null> {
    const row = (status: BlobRow["status"], lines: number | null, parseErrors = 0): BlobRow => ({
      blob_sha: blobSha,
      lang,
      bytes: size,
      lines,
      parse_errors: parseErrors,
      status,
      indexed_at: new Date().toISOString(),
    });
    if (size > this.budgets.maxFileBytes) return { blob: row("too-large", null), extraction: null };
    const bytes = await reader.read(blobSha);
    if (!bytes) return null;
    const decoded = decodeBlob(bytes);
    if (decoded.status === "not-utf8") {
      let lines = 0;
      for (const b of bytes) if (b === 0x0a) lines++;
      if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) lines++;
      return { blob: { ...row("not-utf8", lines), bytes: bytes.length }, extraction: null };
    }
    const extraction = await extract(decoded.text, lang, { packageRoot: this.options.packageRoot });
    const status = extraction.status === "parse-partial" ? "parse-partial" : "ok";
    return {
      blob: { ...row(status, extraction.lines, extraction.parse_errors), bytes: bytes.length },
      extraction,
    };
  }

  /** Publish one blob in one transaction, its `blobs` row last. */
  private publish(parsed: Parsed): true | Unavailable {
    const { blob, extraction } = parsed;
    return this.run((db) => {
      const write = db.transaction(() => {
        const exists = db
          .prepare("SELECT 1 FROM blobs WHERE blob_sha = ? AND lang = ?")
          .get(blob.blob_sha, blob.lang);
        if (exists) return;
        if (extraction) {
          const symbol = db.prepare(
            `INSERT OR IGNORE INTO symbols
               (blob_sha, lang, ordinal, symbol_id, name, qname, kind, start_line, end_line,
                occurrence, doc_start_line, start_byte, end_byte, signature, doc, span_sha256,
                partial)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          const fts = db.prepare(
            "INSERT INTO symbols_fts (rowid, name, qname, signature, doc) VALUES (?, ?, ?, ?, ?)",
          );
          for (const s of extraction.symbols) {
            const info = symbol.run(
              blob.blob_sha,
              blob.lang,
              s.ordinal,
              s.symbol_id,
              s.name,
              s.qname,
              s.kind,
              s.start_line,
              s.end_line,
              s.occurrence,
              s.doc_start_line,
              s.start_byte,
              s.end_byte,
              s.signature,
              s.doc,
              s.span_sha256,
              s.partial ? 1 : 0,
            );
            if (info.changes > 0) {
              fts.run(
                info.lastInsertRowid,
                searchWords(s.name),
                searchWords(s.qname),
                s.signature,
                s.doc,
              );
            }
          }
          const ref = db.prepare(
            "INSERT OR IGNORE INTO refs (blob_sha, lang, ordinal, name, kind, line) VALUES (?, ?, ?, ?, ?, ?)",
          );
          extraction.refs.forEach((r, i) => {
            ref.run(blob.blob_sha, blob.lang, i, r.name, r.kind, r.line);
          });
          const imp = db.prepare(
            "INSERT OR IGNORE INTO imports (blob_sha, lang, ordinal, specifier, line) VALUES (?, ?, ?, ?, ?)",
          );
          extraction.imports.forEach((r, i) => {
            imp.run(blob.blob_sha, blob.lang, i, r.specifier, r.line);
          });
        }
        db.prepare(
          `INSERT OR IGNORE INTO blobs (blob_sha, lang, bytes, lines, parse_errors, status, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          blob.blob_sha,
          blob.lang,
          blob.bytes,
          blob.lines,
          blob.parse_errors,
          blob.status,
          blob.indexed_at,
        );
      });
      write.immediate();
      return true as const;
    });
  }

  /**
   * The tree's rows, in batches; the revision is touched and old revisions pruned. An entry's
   * skip_reason is updated, since `unavailable` lasts only until its object arrives.
   */
  private recordTree(commit: string, entries: TreeEntry[]): true | Unavailable {
    return this.run((db) => {
      const insert = db.prepare(
        `INSERT INTO trees (rev, path, mode, blob_sha, lang, skip_reason) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (rev, path) DO UPDATE SET skip_reason = excluded.skip_reason
         WHERE skip_reason IS NOT excluded.skip_reason`,
      );
      for (let i = 0; i < entries.length; i += TREE_BATCH) {
        db.transaction(() => {
          for (const e of entries.slice(i, i + TREE_BATCH)) {
            insert.run(commit, e.path, e.mode, e.blob_sha, e.lang, e.skip_reason);
          }
        }).immediate();
      }
      db.transaction(() => {
        db.prepare(
          "INSERT INTO tree_revs (rev, touched_at) VALUES (?, ?) ON CONFLICT(rev) DO UPDATE SET touched_at = excluded.touched_at",
        ).run(commit, new Date().toISOString());
        const old = db
          .prepare("SELECT rev FROM tree_revs ORDER BY touched_at DESC, rev LIMIT -1 OFFSET ?")
          .all(KEPT_TREES) as { rev: string }[];
        for (const { rev } of old) {
          db.prepare("DELETE FROM trees_complete WHERE rev = ?").run(rev);
          db.prepare("DELETE FROM trees WHERE rev = ?").run(rev);
          db.prepare("DELETE FROM tree_revs WHERE rev = ?").run(rev);
        }
      }).immediate();
      return true as const;
    });
  }

  /**
   * Past the generation's disk budget, delete blobs not in the newest trees, oldest first,
   * each in one transaction that removes its `blobs` row first, then vacuum the freed pages
   * and truncate the WAL. Returns how many went, and the budget if it is still exceeded.
   */
  private evict():
    | { evicted: number; over: { bytes: number; limit: number } | null }
    | Unavailable {
    const limit = this.budgets.maxGenerationBytes;
    return this.run((db) => {
      const fileSize = (path: string) => {
        try {
          return statSync(path).size;
        } catch {
          return 0;
        }
      };
      // On disk: the database's pages, free ones included, and the WAL.
      const used = () => {
        const pages = db.pragma("page_count", { simple: true }) as number;
        const size = db.pragma("page_size", { simple: true }) as number;
        return pages * size + fileSize(`${this.databasePath}-wal`);
      };
      const reclaim = () => {
        db.pragma("incremental_vacuum");
        db.pragma("wal_checkpoint(TRUNCATE)");
      };
      const outcome = (evicted: number) => {
        const bytes = used();
        return { evicted, over: bytes > limit ? { bytes, limit } : null };
      };
      if (used() <= limit) return { evicted: 0, over: null };
      reclaim();
      if (used() <= limit) return outcome(0);
      const victims = db
        .prepare(
          `SELECT blob_sha, lang FROM blobs
            WHERE blob_sha NOT IN (
              SELECT t.blob_sha FROM trees t
               WHERE t.rev IN (SELECT rev FROM tree_revs ORDER BY touched_at DESC, rev LIMIT ?))
            ORDER BY indexed_at, blob_sha, lang`,
        )
        .all(KEPT_TREES) as { blob_sha: string; lang: string }[];
      const symbols = db.prepare(
        "SELECT id, name, qname, signature, doc FROM symbols WHERE blob_sha = ? AND lang = ?",
      );
      const ftsDelete = db.prepare(
        "INSERT INTO symbols_fts (symbols_fts, rowid, name, qname, signature, doc) VALUES ('delete', ?, ?, ?, ?, ?)",
      );
      const remove = db.transaction((batch: { blob_sha: string; lang: string }[]) => {
        for (const v of batch) {
          db.prepare("DELETE FROM blobs WHERE blob_sha = ? AND lang = ?").run(v.blob_sha, v.lang);
          for (const s of symbols.all(v.blob_sha, v.lang) as {
            id: number;
            name: string;
            qname: string;
            signature: string;
            doc: string;
          }[]) {
            ftsDelete.run(s.id, searchWords(s.name), searchWords(s.qname), s.signature, s.doc);
          }
          for (const table of ["symbols", "refs", "imports"]) {
            db.prepare(`DELETE FROM ${table} WHERE blob_sha = ? AND lang = ?`).run(
              v.blob_sha,
              v.lang,
            );
          }
        }
      });
      let evicted = 0;
      for (let i = 0; i < victims.length; i += EVICT_BATCH) {
        const batch = victims.slice(i, i + EVICT_BATCH);
        remove.immediate(batch);
        evicted += batch.length;
        reclaim();
        if (used() <= limit) break;
      }
      return outcome(evicted);
    });
  }

  private ensureDirectory(): void {
    ensureRoot(this.storagePath);
    mkdirSync(this.directory, { recursive: true });
  }

  /** Touch `last_opened`: on open, and at least hourly while in use. */
  private touch(): void {
    try {
      this.ensureDirectory();
      const marker = join(this.directory, LAST_OPENED);
      if (!existsSync(marker)) writeFileSync(marker, "", "utf8");
      const at = this.now();
      utimesSync(marker, at / 1000, at / 1000);
      this.lastTouched = at;
    } catch {
      // A touch that fails risks collection of a cache, nothing more.
    }
  }

  /** The open database for this request: reopened when the file's inode has changed. */
  private connection(): Database.Database {
    if (this.now() - this.lastTouched >= HOUR_MS) this.touch();
    if (this.db && inodeOf(this.databasePath) !== this.inode) {
      try {
        this.db.close();
      } catch {
        // Moving to the new file either way.
      }
      this.db = null;
      this.inode = null;
    }
    if (this.db) return this.db;
    this.ensureDirectory();
    const busyTimeout = this.options.busyTimeoutMs ?? BUSY_TIMEOUT_MS;
    if (!recoveryFinished(this.marker(), Date.now() + busyTimeout)) {
      throw new RecoveryInProgress("another process is recovering the code index");
    }
    this.attempted = inodeOf(this.databasePath);
    const db = new Database(this.databasePath);
    try {
      db.pragma(`busy_timeout = ${busyTimeout}`);
      // Takes effect only in a new database, before its first table.
      db.pragma("auto_vacuum = INCREMENTAL");
      enterWal(db, busyTimeout);
      db.exec(DDL);
      db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)").run(
        SCHEMA_VERSION,
      );
      const check = db.pragma("quick_check", { simple: true });
      if (check !== "ok") throw new CorruptDatabase(`quick_check: ${String(check)}`);
    } catch (error) {
      db.close();
      throw error;
    }
    const inode = inodeOf(this.databasePath);
    if (this.attempted !== null && inode !== this.attempted) {
      // A recovery moved the file while it was opening; the next request opens the new one.
      db.close();
      throw new RecoveryInProgress("the code index was replaced while opening");
    }
    this.db = db;
    this.inode = inode;
    return db;
  }

  private marker(): string {
    return `${this.databasePath}${RECOVERY_MARKER}`;
  }

  /** Create the recovery marker exclusively, waiting out another process's; false if it stays. */
  private claimRecovery(): boolean {
    const deadline = Date.now() + (this.options.busyTimeoutMs ?? BUSY_TIMEOUT_MS);
    for (;;) {
      try {
        closeSync(openSync(this.marker(), "wx"));
        return true;
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code !== "EEXIST") return false;
      }
      if (!recoveryFinished(this.marker(), deadline)) return false;
    }
  }

  /** Set the database aside with its WAL and SHM files, unless another process already has. */
  private recover(): void {
    const known = this.inode ?? this.attempted;
    try {
      this.db?.close();
    } catch {
      // Being set aside either way.
    }
    this.db = null;
    this.inode = null;
    if (known === null || !this.claimRecovery()) return;
    try {
      // Under the marker: another recoverer may have replaced the file already.
      if (inodeOf(this.databasePath) !== known) return;
      const stamp = new Date().toISOString().replace(/[-:.]/g, "");
      // The database last, so an opener never finds a new database beside the old WAL.
      for (const suffix of ["-wal", "-shm", ""]) {
        const from = `${this.databasePath}${suffix}`;
        if (!existsSync(from)) continue;
        try {
          renameSync(from, `${from}.corrupt-${stamp}`);
        } catch {
          // A file another process already moved.
        }
      }
    } finally {
      rmSync(this.marker(), { force: true });
    }
  }

  /** Run one request against the database; corruption is recovered once, all else unavailable. */
  private run<T>(fn: (db: Database.Database) => T): T | Unavailable {
    for (let attempt = 0; ; attempt++) {
      try {
        return fn(this.connection());
      } catch (error) {
        const failure = classify(error);
        if (failure === "corrupt" && attempt === 0) {
          this.recover();
          continue;
        }
        if (failure === null) throw error;
        return {
          state: "unavailable",
          reason: failure === "corrupt" ? "corrupt" : reasonOf(error),
        };
      }
    }
  }
}
