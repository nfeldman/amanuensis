import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const moduleDir = dirname(fileURLToPath(import.meta.url));

// The schema file ships alongside src/ and dist/. In built output we need to
// look one level up (dist/ → ../src/schema.sql) or allow an override. Resolve
// by searching a small set of candidate locations so the server works in both
// `node src/index.ts` (via tsx) and `node dist/index.js` layouts.
function findSchemaPath(): string {
  const candidates = [
    join(moduleDir, "schema.sql"),
    join(moduleDir, "..", "src", "schema.sql"),
    join(moduleDir, "..", "..", "src", "schema.sql"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `amanuensis-memory: cannot locate schema.sql. Searched: ${candidates.join(", ")}`,
  );
}

export type DB = Database.Database;

export interface WalCheckpoint {
  busy: number;
  log: number;
  checkpointed: number;
}

export function openDatabase(dbPath: string): DB {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Run migrations BEFORE initializeSchema so that additive column
  // changes happen before schema.sql's index-creation statements
  // reference the new columns. Migrations are a no-op on fresh DBs
  // (their `hasTable` guards skip everything), so there's no wasted
  // work in the common case.
  runMigrations(db);
  initializeSchema(db);
  return db;
}

function initializeSchema(db: DB): void {
  // The schema is written with CREATE ... IF NOT EXISTS throughout, so we
  // can run it on every open — both fresh init and existing DBs are handled.
  const schemaSql = readFileSync(findSchemaPath(), "utf8");
  db.exec(schemaSql);
}

/**
 * Lightweight additive migrations for pre-existing databases that miss
 * columns or indexes added after their initial creation. SQLite's
 * `CREATE TABLE IF NOT EXISTS` only creates the table if it is absent,
 * so new columns in the canonical schema have to be applied separately.
 *
 * Each migration probes `pragma_table_info` / `sqlite_master` to check
 * whether the change is already present, making them idempotent and
 * safe to run on every open. Add new entries here when the schema
 * gains columns/indexes.
 */
function runMigrations(db: DB): void {
  // Migrations only apply to databases that already exist. On a fresh
  // DB, the tables aren't there yet and initializeSchema will create
  // them with the current canonical shape, so there's nothing to
  // migrate.
  //
  // 1. subsystems.priority — survey-priority ranking, added post-v0.1.
  if (hasTable(db, "subsystems") && !hasColumn(db, "subsystems", "priority")) {
    db.exec(
      "ALTER TABLE subsystems ADD COLUMN priority INTEGER CHECK (priority IS NULL OR priority > 0)",
    );
  }
  // 2. revalidation_attempts.consulted_sources — provider read-boundary
  // telemetry, added with the unattended refresh envelope.
  if (
    hasTable(db, "revalidation_attempts") &&
    !hasColumn(db, "revalidation_attempts", "consulted_sources")
  ) {
    db.exec(
      "ALTER TABLE revalidation_attempts ADD COLUMN consulted_sources TEXT CHECK (consulted_sources IS NULL OR json_valid(consulted_sources))",
    );
  }
  // 3. file_ledger staleness — A1 moved staleness off the never-written
  // `entries` table onto the ledger, which the survey always populates.
  if (hasTable(db, "file_ledger")) {
    if (!hasColumn(db, "file_ledger", "stale")) {
      db.exec("ALTER TABLE file_ledger ADD COLUMN stale INTEGER NOT NULL DEFAULT 0");
    }
    if (!hasColumn(db, "file_ledger", "stale_since")) {
      db.exec("ALTER TABLE file_ledger ADD COLUMN stale_since TEXT");
    }
    if (!hasColumn(db, "file_ledger", "stale_reason")) {
      db.exec("ALTER TABLE file_ledger ADD COLUMN stale_reason TEXT");
    }
  }
  // The CREATE INDEX ... IF NOT EXISTS and CREATE TABLE ... IF NOT EXISTS in
  // schema.sql handle the new index and scope_gaps on the next
  // initializeSchema pass — no explicit add here.
}

function hasTable(db: DB, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table);
  return !!row;
}

function hasColumn(db: DB, table: string, column: string): boolean {
  const info = db
    .prepare(`SELECT name FROM pragma_table_info(?) WHERE name = ?`)
    .get(table, column);
  return !!info;
}

export function withTransaction<T>(db: DB, fn: () => T): T {
  const txn = db.transaction(fn);
  return txn();
}

/**
 * Move every committed WAL frame into memory.db before storage Git stages it.
 *
 * The storage repository intentionally ignores memory.db-wal/-shm. Without an
 * explicit checkpoint, a phase commit can therefore contain prose produced by
 * a survey phase while omitting the database rows that phase wrote. TRUNCATE
 * both checkpoints the frames and resets the sidecar after success. A busy or
 * partial checkpoint is a hard failure: a recoverability gate must not publish
 * a commit it already knows is incomplete.
 */
export function checkpointDatabaseForStorageCommit(db: DB): WalCheckpoint {
  const rows = db.pragma("wal_checkpoint(TRUNCATE)") as WalCheckpoint[];
  const result = rows[0];
  if (!result) throw new Error("SQLite WAL checkpoint returned no result");
  if (result.busy !== 0 || result.log !== result.checkpointed) {
    throw new Error(
      `SQLite WAL checkpoint incomplete: busy=${result.busy}, ` +
        `log=${result.log}, checkpointed=${result.checkpointed}`,
    );
  }
  return result;
}
