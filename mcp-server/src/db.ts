import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { SQL_CONSTRAINED_VOCABULARIES, VOCABULARY_SQL_BINDINGS } from "./vocabulary.js";

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

let schemaTextCache: { key: string; text: string } | null = null;

/**
 * `schema.sql`, read once per open rather than once per reader.
 *
 * Three readers want it now — the apply, the vocabulary rebuild, and the
 * post-apply check — and re-reading 2,600 lines three times on every open is
 * paid by every tool call that opens a store. Keyed on size and mtime so an
 * edit during a long-lived process is still picked up.
 */
function readSchemaText(): string {
  const path = findSchemaPath();
  const stats = statSync(path);
  const key = `${path}:${stats.size}:${stats.mtimeMs}`;
  if (schemaTextCache?.key === key) return schemaTextCache.text;
  const text = readFileSync(path, "utf8");
  schemaTextCache = { key, text };
  return text;
}

export type DB = Database.Database;

export interface WalCheckpoint {
  busy: number;
  log: number;
  checkpointed: number;
}

/**
 * Views the reader surfaces read and that no other process creates.
 *
 * The materializer opens the store `mode=ro` and applies no schema, so these
 * exist only because `initializeSchema` below ran. Naming them here, and
 * asserting them on every open, is what makes the materializer's probe
 * (`materializer/amanuensis_materializer/db.py`) a statement about the store's
 * age rather than about a schema that silently stopped defining them.
 */
export const REQUIRED_VIEWS = ["file_standing", "finding_state_current"] as const;

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
  mintStoreIdentity(db);
  requireSchemaObjects(db);
  requireViews(db);
  return db;
}

/**
 * Give this store the identity a carried record names it by (§5.3).
 *
 * Minted once and never recomputed, because there is nothing to recompute:
 * identity is a fact the store carries, not a function of its mutable state.
 * The alternative an earlier draft took — a digest over
 * `<repo_id|canonical_branch|onboarding_sha|last_checked_sha>` — fails in both
 * directions. `set_git_state` may update `last_checked_sha` at any time, so a
 * live store's identity would move every time it reconciled and an id written
 * into a successor last week could not be recomputed from the source today;
 * and two clean-slate rebuilds of the same repository at the same revision
 * yield the same tuple, so they would collide.
 *
 * It is written here rather than as a column default because SQLite has no
 * random default a `CREATE TABLE` can carry. `INSERT OR IGNORE` makes the mint
 * happen on the open that creates the table and never again — including on an
 * existing populated store, which gains its identity the first time it is
 * opened after this schema lands, and keeps it thereafter. The immutability
 * trigger is on UPDATE and DELETE, so a second open is a silent no-op rather
 * than a refusal.
 */
function mintStoreIdentity(db: DB): void {
  db.prepare("INSERT OR IGNORE INTO store_identity (id, store_generation) VALUES (1, ?)").run(
    randomBytes(16).toString("hex"),
  );
}

/**
 * One object `schema.sql` declares, as `sqlite_master` records it.
 */
interface DeclaredObject {
  type: "table" | "view" | "index" | "trigger";
  name: string;
}

let declaredCache: { text: string; objects: DeclaredObject[] } | null = null;

/**
 * Every table, view, index and trigger `schema.sql` declares at statement
 * level.
 *
 * Exported so a gate can check the store against the schema's own
 * declarations rather than against a second list that would drift from it.
 */
export function declaredSchemaObjects(schemaSql: string): DeclaredObject[] {
  if (declaredCache?.text === schemaSql) return declaredCache.objects;
  const pattern =
    /^CREATE\s+(?:UNIQUE\s+)?(TABLE|VIEW|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gim;
  const objects: DeclaredObject[] = [];
  for (const match of schemaSql.matchAll(pattern)) {
    const kind = match[1];
    const name = match[2];
    if (kind === undefined || name === undefined) continue;
    objects.push({ type: kind.toLowerCase() as DeclaredObject["type"], name });
  }
  declaredCache = { text: schemaSql, objects };
  return objects;
}

/**
 * Fail the open when schema application did not leave every declared object in
 * place, as the declared kind.
 *
 * `initializeSchema` applies `schema.sql` on every open and reports nothing
 * about what arrived. That is usually harmless and once is not: `CREATE TABLE
 * IF NOT EXISTS t` is a silent no-op when the name `t` is already held by an
 * object of another kind, so an open can return a store missing a declared
 * table and report success. Every later read of that table then fails
 * somewhere else, with the store blamed for a schema defect — the same silent
 * loss `requireViews` was added to stop for the two views the materializer
 * reads, unguarded for the other 515 objects.
 *
 * This matters here rather than in the abstract because the survey-depth lane
 * adds tables to stores that already exist and are already populated, with no
 * grace path (`decisions.md` §1, `README.md` §4): a table that does not arrive
 * has to be a refused open, not a silence. Reading the declarations out of
 * `schema.sql` keeps the check from becoming a second list to maintain — a
 * table declared there is covered the moment it is declared.
 */
function requireSchemaObjects(db: DB): void {
  const declared = declaredSchemaObjects(readSchemaText());
  const live = new Map<string, string>();
  for (const row of db.prepare("SELECT type, name FROM sqlite_master").all() as {
    type: string;
    name: string;
  }[]) {
    live.set(row.name, row.type);
  }
  const wrong: string[] = [];
  for (const object of declared) {
    const actual = live.get(object.name);
    if (actual === undefined) wrong.push(`${object.type} ${object.name} (absent)`);
    else if (actual !== object.type)
      wrong.push(`${object.type} ${object.name} (present as ${actual})`);
  }
  if (wrong.length > 0) {
    db.close();
    throw new Error(
      `amanuensis-memory: applying schema.sql left ${wrong.length} of ${declared.length} declared ` +
        `object(s) absent or of the wrong kind: ${wrong.slice(0, 8).join(", ")}` +
        `${wrong.length > 8 ? `, and ${wrong.length - 8} more` : ""}`,
    );
  }
}

/**
 * Fail the open when the applied schema did not leave every required view in
 * place. Without this the loss is silent here and surfaces downstream as a
 * refused publish, blaming the store for a schema defect.
 */
function requireViews(db: DB): void {
  const placeholders = REQUIRED_VIEWS.map(() => "?").join(",");
  const present = new Set(
    (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='view' AND name IN (${placeholders})`)
        .all(...REQUIRED_VIEWS) as { name: string }[]
    ).map((row) => row.name),
  );
  const absent = REQUIRED_VIEWS.filter((name) => !present.has(name));
  if (absent.length > 0) {
    db.close();
    throw new Error(
      `amanuensis-memory: applying schema.sql left required view(s) absent: ${absent.join(", ")}`,
    );
  }
}

function initializeSchema(db: DB): void {
  // The schema is written with CREATE ... IF NOT EXISTS throughout, so we
  // can run it on every open — both fresh init and existing DBs are handled.
  db.exec(readSchemaText());
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
  // 3b. finding_resolution_events.effective_sha — the revision each event was
  // read at, added so §3.3's replay stops cutting a verification at the repair
  // SHA it confirms. Backfilled from `fix_sha`, which is what the replay used
  // before the column existed: no historical reading changes.
  if (
    hasTable(db, "finding_resolution_events") &&
    !hasColumn(db, "finding_resolution_events", "effective_sha")
  ) {
    db.exec("ALTER TABLE finding_resolution_events ADD COLUMN effective_sha TEXT");
    db.exec(
      "UPDATE finding_resolution_events SET effective_sha = fix_sha WHERE fix_sha IS NOT NULL",
    );
  }
  // The CREATE INDEX ... IF NOT EXISTS and CREATE TABLE ... IF NOT EXISTS in
  // schema.sql handle the new index, scope_gaps and scope_reconciliations on
  // the next initializeSchema pass — no explicit add here. A new *table* needs
  // no migration entry and no REQUIRED_VIEWS entry: `initializeSchema` re-execs
  // schema.sql on every open (:84-89) and `requireSchemaObjects` then refuses
  // the open if the table did not arrive, so an existing populated store gains
  // scope_reconciliations the next time it is opened with no domain row
  // rewritten. REQUIRED_VIEWS (:44, :61-82) stays as it is because the
  // survey-depth lane's §3 adds no view.
  //
  // 4. CHECK-constrained vocabularies — a widened enum reaches an existing
  // store only through a table rebuild.
  migrateVocabularyChecks(db);
}

/**
 * Bring every CHECK-constrained vocabulary column forward to the canonical
 * schema (claim C48).
 *
 * `CREATE TABLE IF NOT EXISTS` does not rewrite an existing table and SQLite
 * cannot alter a CHECK in place, so widening an enum in schema.sql reaches new
 * databases only. An existing store keeps enforcing the vocabulary it was
 * created with: the AxiomDB store admits five `evidence_quality` values where
 * the source declares nine, and rejects `test-observed` outright. A single
 * enum source that only governs fresh databases is not a single source.
 *
 * Which columns to check is read from the contract's own `sql` mappings, so a
 * vocabulary added there is migrated without a second list to maintain.
 */
function migrateVocabularyChecks(db: DB): void {
  const schemaText = readSchemaText();
  for (const [table, column, canonical] of vocabularySqlBindings()) {
    if (!hasTable(db, table)) continue;
    const live = liveCreateSql(db, table);
    const present = checkValues(live, column);
    // No CHECK on that column here (an older shape, or one this migration has
    // no canonical text for): leave it. Narrowing is what is repaired.
    if (present === null) continue;
    const missing = canonical.filter((value) => !present.includes(value));
    if (missing.length === 0) continue;
    // Only widen. A live value the source no longer declares is drift this
    // migration must not destroy silently — the rebuild's INSERT would abort
    // on it anyway. CI's `gen-vocabulary.mjs --check-sql` is where that is
    // caught, with the data still intact.
    if (present.some((value) => !canonical.includes(value))) continue;
    const canonicalCreate = canonicalCreateSql(schemaText, table);
    if (!canonicalCreate) continue;
    rebuildTable(db, table, canonicalCreate);
  }
}

/** `[table, column, values]` for every CHECK-constrained enum in the contract. */
function vocabularySqlBindings(): [string, string, readonly string[]][] {
  const out: [string, string, readonly string[]][] = [];
  for (const [name, values] of Object.entries(SQL_CONSTRAINED_VOCABULARIES)) {
    for (const binding of VOCABULARY_SQL_BINDINGS[name] ?? []) {
      out.push([binding.table, binding.column, values]);
    }
  }
  return out;
}

function liveCreateSql(db: DB, table: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { sql: string | null } | undefined;
  return row?.sql ?? "";
}

/**
 * The values a `CHECK (<column> IN ('a','b'))` term admits, or null when the
 * column carries no such term. Reads the stored DDL as text, which is what
 * SQLite exposes; there is no pragma for a CHECK.
 */
function checkValues(createSql: string, column: string): string[] | null {
  const re = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, "s");
  const match = re.exec(createSql);
  const body = match?.[1];
  if (body === undefined) return null;
  return [...body.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? "");
}

/** The canonical `CREATE TABLE` statement for one table, out of schema.sql. */
function canonicalCreateSql(schemaText: string, table: string): string | null {
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, "i");
  const start = re.exec(schemaText);
  if (!start) return null;
  // Balance parentheses from the opening one so a CHECK's own parentheses do
  // not end the statement early.
  let depth = 0;
  for (let i = start.index + start[0].length - 1; i < schemaText.length; i++) {
    const ch = schemaText[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return schemaText.slice(start.index, i + 1);
    }
  }
  return null;
}

/**
 * SQLite's documented table-rebuild procedure, transactionally.
 *
 * `legacy_alter_table` is required: dropping the table leaves the views that
 * select from it dangling, and a modern `ALTER TABLE ... RENAME` reparses
 * every schema object and would fail on them. Under the legacy form the rename
 * touches nothing else, and the views resolve again the moment the canonical
 * name is back. Foreign keys are disabled for the swap — the child rows point
 * at a name, and the name is restored before they are checked again — and
 * `foreign_key_check` runs before the transaction commits.
 */
function rebuildTable(db: DB, table: string, canonicalCreate: string): void {
  const scratch = `${table}__vocab_rebuild`;
  const rebuilt = canonicalCreate.replace(
    new RegExp(`^CREATE TABLE IF NOT EXISTS ${table}`, "i"),
    `CREATE TABLE ${scratch}`,
  );
  const objects = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE tbl_name=? AND sql IS NOT NULL AND type IN ('index','trigger')",
    )
    .all(table) as { sql: string }[];
  const foreignKeys = db.pragma("foreign_keys", { simple: true });
  const legacyAlter = db.pragma("legacy_alter_table", { simple: true });
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");
  try {
    db.transaction(() => {
      db.exec(`DROP TABLE IF EXISTS "${scratch}"`);
      db.exec(rebuilt);
      const columnsOf = (name: string) =>
        (db.prepare("SELECT name FROM pragma_table_info(?)").all(name) as { name: string }[]).map(
          (r) => r.name,
        );
      const target = new Set(columnsOf(scratch));
      // Columns the live table has and the canonical one does not are dropped;
      // columns only the canonical one has take their declared default. A
      // column list on both sides is what keeps positional drift out.
      const shared = columnsOf(table).filter((name) => target.has(name));
      const quoted = shared.map((name) => `"${name}"`).join(", ");
      db.exec(`INSERT INTO "${scratch}" (${quoted}) SELECT ${quoted} FROM "${table}"`);
      db.exec(`DROP TABLE "${table}"`);
      db.exec(`ALTER TABLE "${scratch}" RENAME TO "${table}"`);
      for (const object of objects) db.exec(object.sql);
      const violations = db.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(
          `amanuensis-memory: rebuilding ${table} for the vocabulary source left ${violations.length} foreign-key violation(s); the store is unchanged`,
        );
      }
    })();
  } finally {
    db.pragma(`legacy_alter_table = ${legacyAlter ? "ON" : "OFF"}`);
    db.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
  }
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
