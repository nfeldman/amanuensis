// The call log (design/self-observability/README.md §4, layer A).
//
// One row per tool call, written by the dispatcher rather than by the model:
// the voluntary `log_access` / `log_query` tools were called zero times in
// 14,580 recorded calls, so a signal that depends on the model's cooperation
// is a signal that does not exist.
//
// Where it lives, and why there. The rows go to a sidecar SQLite file under
// `<storage>/call-log/`, never into `memory.db`:
//   - the record is pinned by digest (efficacy trial §6) and published from;
//     a read must not change it, and every call is a write here;
//   - the storage directory is a Git repository committed at phase gates.
//     The sidecar is kept out of that history three ways: the directory
//     carries a `.gitignore` of `*` (rewritten if it says anything else),
//     `commitStorage` excludes the directory by pathspec, and recording is
//     refused for a store whose history already tracks it;
//   - storage migration compares stores without it (`storageManifest`).
// It is not part of the record, so a procedure that discards or archives a
// store (dev/rebuild-store.mjs) takes the call history with it.
//
// What it never stores: argument values, response text, or refusal and
// exception messages, which echo arguments. A refusal is identified by its
// declared rule id and, when it was thrown, by the source line that threw it
// (`site`, relative to the server's own build), which carries no value.
//
// What it never does. It never fails or delays a call: rows are queued and
// written after the response is returned, the sidecar itself is opened in that
// same deferred flush, a busy database is not waited for (the batch stays
// queued, bounded, for the next attempt; only the final flush at exit waits
// briefly), and an open or write error is reported on stderr once. It never
// creates the storage
// directory: it attaches only after the dispatcher has opened the record, and
// calls made before that (the first `get_project_info`) wait in the queue.
//
// AMANUENSIS_CALL_LOG=off (or 0, false, no) disables it entirely.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

export const CALL_LOG_DIRECTORY = "call-log";
export const CALL_LOG_DATABASE = "calls.db";
export const CALL_LOG_SCHEMA_VERSION = 1;
const CALL_LOG_IGNORE = "*\n";

/** Rows waiting for the sidecar to open or to stop being busy. */
const QUEUE_LIMIT = 256;
/** Writes during a call never wait for another process's lock. */
const BUSY_TIMEOUT_MS = 0;
/** At exit, one last flush may wait this long. */
const EXIT_BUSY_TIMEOUT_MS = 200;

/** The directory this module was loaded from: the server's own build. */
const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));

export type CallOutcome = "ok" | "validation" | "refusal" | "exception";

export interface CallRecord {
  tool: string;
  outcome: CallOutcome;
  /** Stable refusal rule id, when the refusing site declares one. */
  rule: string | null;
  /** `file:line` of the throw, relative to the server build; never a message. */
  site: string | null;
  sessionId: string | null;
  startedAt: string;
  latencyMs: number;
  argsBytes: number;
  argsSha256: string;
  responseBytes: number;
}

const CALL_LOG_DDL = `
CREATE TABLE IF NOT EXISTS call_log_meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS call_log_connections (
    connection_id   TEXT    PRIMARY KEY,
    started_at      TEXT    NOT NULL,
    server_version  TEXT    NOT NULL,
    client_name     TEXT,
    client_version  TEXT,
    pid             INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS call_log (
    id                INTEGER PRIMARY KEY,
    connection_id     TEXT    NOT NULL REFERENCES call_log_connections(connection_id),
    seq               INTEGER NOT NULL,
    started_at        TEXT    NOT NULL,
    session_id        TEXT,
    tool              TEXT    NOT NULL,
    outcome           TEXT    NOT NULL CHECK (outcome IN ('ok','validation','refusal','exception')),
    rule              TEXT,
    site              TEXT,
    latency_ms        REAL    NOT NULL,
    args_bytes        INTEGER NOT NULL,
    args_sha256       TEXT    NOT NULL,
    response_bytes    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_call_log_tool ON call_log(tool, outcome);
CREATE INDEX IF NOT EXISTS idx_call_log_rule ON call_log(rule) WHERE rule IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_log_time ON call_log(started_at);
`;

export function callLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.AMANUENSIS_CALL_LOG?.trim().toLowerCase();
  return !(raw === "off" || raw === "0" || raw === "false" || raw === "no");
}

/** JSON with object keys sorted, so equal arguments hash equally. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function digestArguments(args: unknown): { bytes: number; sha256: string } {
  const text = canonicalJson(args ?? {});
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

/**
 * The first stack frame inside the server's own build, as `file:line`
 * relative to it (for example `tools/project.js:93`). It names the code that
 * refused, so unlabelled refusals still group, and it cannot carry an argument
 * value. Null when the error has no such frame.
 */
export function throwSite(error: unknown, root: string = MODULE_ROOT): string | null {
  const stack = error instanceof Error ? error.stack : undefined;
  if (!stack) return null;
  for (const line of stack.split("\n").slice(1)) {
    const m = line.match(/\(?((?:file:\/\/)?[^\s()]+):(\d+):\d+\)?\s*$/);
    if (!m?.[1] || !m[2]) continue;
    let file = m[1];
    if (file.startsWith("file://")) {
      try {
        file = fileURLToPath(file);
      } catch {
        continue;
      }
    }
    const rel = relative(root, file);
    if (rel.startsWith("..") || rel.startsWith(sep) || rel === "") continue;
    if (rel.split(sep).includes("node_modules")) continue;
    return `${rel.split(sep).join("/")}:${m[2]}`;
  }
  return null;
}

export interface CallLogOptions {
  serverVersion: string;
  enabled?: boolean;
  /** The MCP client's declared identity, read when the sidecar attaches. */
  clientInfo?: () => { name?: string; version?: string } | undefined;
  /**
   * Whether the storage repository's history already tracks the call log
   * directory. Recording is refused if it does: a tracked file is committed
   * whatever `.gitignore` says.
   */
  isTrackedInStorage?: (storagePath: string, relPath: string) => boolean;
  /** stderr sink; injectable for tests. */
  warn?: (line: string) => void;
  /** Deferral; injectable for tests. Defaults to setImmediate. */
  defer?: (fn: () => void) => void;
}

type OpenResult = "open" | "busy" | "failed";

function isBusy(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED";
}

export class CallLog {
  readonly connectionId = randomUUID();
  readonly enabled: boolean;
  private db: Database.Database | null = null;
  private writeBatch: ((rows: CallRecord[]) => void) | null = null;
  private storagePath: string | null = null;
  private trackedChecked = false;
  private failed = false;
  private warned = false;
  private flushScheduled = false;
  private seq = 0;
  private queue: CallRecord[] = [];
  private droppedCount = 0;

  constructor(private readonly options: CallLogOptions) {
    this.enabled = options.enabled ?? callLogEnabled();
  }

  get dropped(): number {
    return this.droppedCount;
  }

  /** Path of the sidecar for a storage directory. */
  static databasePath(storagePath: string): string {
    return join(storagePath, CALL_LOG_DIRECTORY, CALL_LOG_DATABASE);
  }

  /**
   * Name the storage directory the sidecar belongs to. Cheap: nothing is
   * opened here; the sidecar opens in the deferred flush. Must only be
   * called once the record itself is open. A server process binds one
   * workspace, so the first call wins.
   */
  attach(storagePath: string): void {
    if (!this.enabled || this.failed || this.storagePath) return;
    this.storagePath = storagePath;
    this.scheduleFlush();
  }

  /** Queue a row. Never blocks; the write happens after the response. */
  record(record: CallRecord): void {
    if (!this.enabled || this.failed) return;
    if (this.queue.length >= QUEUE_LIMIT) {
      this.droppedCount++;
      return;
    }
    this.queue.push(record);
    this.scheduleFlush();
  }

  /**
   * Open the sidecar if needed and write what is queued. A busy database is
   * not waited for: the rows stay queued for the next flush.
   */
  flush(busyTimeoutMs = BUSY_TIMEOUT_MS): void {
    if (!this.enabled || this.failed || !this.storagePath) return;
    if (!this.writeBatch && this.open(this.storagePath, busyTimeoutMs) !== "open") return;
    if (this.queue.length === 0) return;
    const rows = this.queue;
    this.queue = [];
    try {
      this.db?.pragma(`busy_timeout = ${busyTimeoutMs}`);
      this.writeBatch?.(rows);
    } catch (e) {
      if (isBusy(e)) {
        // Another process holds the write lock. Keep the rows for the next
        // flush rather than wait; overflow is counted as dropped.
        const room = Math.max(0, QUEUE_LIMIT - this.queue.length);
        this.droppedCount += Math.max(0, rows.length - room);
        this.queue = [...rows.slice(0, room), ...this.queue];
        return;
      }
      this.droppedCount += rows.length;
      this.warnOnce(`call log write failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** At exit: one last flush that may wait briefly, then close. */
  close(): void {
    try {
      if (this.queue.length > 0) this.flush(EXIT_BUSY_TIMEOUT_MS);
      this.db?.close();
    } catch {
      // Closing is best-effort; the process is exiting.
    }
    this.db = null;
    this.writeBatch = null;
  }

  private open(storagePath: string, busyTimeoutMs: number): OpenResult {
    let db: Database.Database | null = null;
    try {
      if (!this.trackedChecked) {
        if (this.options.isTrackedInStorage?.(storagePath, CALL_LOG_DIRECTORY)) {
          throw new Error(
            `${CALL_LOG_DIRECTORY}/ is tracked by the storage repository; refusing to record into history`,
          );
        }
        this.trackedChecked = true;
      }
      const directory = join(storagePath, CALL_LOG_DIRECTORY);
      mkdirSync(directory, { recursive: true });
      const ignore = join(directory, ".gitignore");
      if (!existsSync(ignore) || readFileSync(ignore, "utf8") !== CALL_LOG_IGNORE) {
        writeFileSync(ignore, CALL_LOG_IGNORE, "utf8");
      }
      db = new Database(join(directory, CALL_LOG_DATABASE));
      db.pragma(`busy_timeout = ${busyTimeoutMs}`);
      db.pragma("journal_mode = WAL");
      db.exec(CALL_LOG_DDL);
      const client = this.options.clientInfo?.();
      const meta = db.prepare(
        "INSERT OR IGNORE INTO call_log_meta (key, value) VALUES ('schema_version', ?)",
      );
      const connection = db.prepare(
        `INSERT OR IGNORE INTO call_log_connections
           (connection_id, started_at, server_version, client_name, client_version, pid)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      db.transaction(() => {
        meta.run(String(CALL_LOG_SCHEMA_VERSION));
        connection.run(
          this.connectionId,
          new Date().toISOString(),
          this.options.serverVersion,
          client?.name ?? null,
          client?.version ?? null,
          process.pid,
        );
      })();
      const insert = db.prepare(
        `INSERT INTO call_log
           (connection_id, seq, started_at, session_id, tool, outcome, rule, site,
            latency_ms, args_bytes, args_sha256, response_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      this.writeBatch = db.transaction((rows: CallRecord[]) => {
        let seq = this.seq;
        for (const r of rows) {
          seq += 1;
          insert.run(
            this.connectionId,
            seq,
            r.startedAt,
            r.sessionId,
            r.tool,
            r.outcome,
            r.rule,
            r.site,
            r.latencyMs,
            r.argsBytes,
            r.argsSha256,
            r.responseBytes,
          );
        }
        this.seq = seq;
      });
      this.db = db;
      return "open";
    } catch (e) {
      try {
        db?.close();
      } catch {
        // The handle is being discarded either way.
      }
      if (isBusy(e)) return "busy";
      this.failed = true;
      this.droppedCount += this.queue.length;
      this.queue = [];
      this.warnOnce(`call log disabled: ${e instanceof Error ? e.message : String(e)}`);
      return "failed";
    }
  }

  private scheduleFlush(): void {
    if (this.flushScheduled || !this.storagePath) return;
    this.flushScheduled = true;
    (this.options.defer ?? setImmediate)(() => {
      this.flushScheduled = false;
      this.flush();
    });
  }

  private warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    (this.options.warn ?? ((line) => process.stderr.write(line)))(
      `[amanuensis-memory] ${message}; further call log errors are not reported\n`,
    );
  }
}
