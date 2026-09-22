#!/usr/bin/env node
// GATE XS1 (spec.md §8.0a) — packet P0 of the survey-depth lane.
//
// The lane binds an existing populated store with no grace path (decisions.md
// §1, README §4). Every table it adds therefore arrives on that store the next
// time it is opened, through `runMigrations` and `initializeSchema`
// (src/db.ts:46-58, :84-89). Asserting that against a fresh fixture would test
// the one store shape that cannot fail, so this gate takes a copy of a real
// populated store — `~/repos/axiomdb/.amanuensis/memory.db`, 295 ledger rows
// over 187 distinct paths, 1718 scope gaps, 54 unattached dispositions — and
// runs the migration on the copy.
//
// The source is opened read-only and never written (decisions.md §6): the copy
// is taken with `copyFileSync`, the source's bytes are digested before and
// after, and nothing in this file opens the source for writing.
//
// Two names appear below. `GATE XS1` is what spec.md §8.0a calls this gate;
// `GATE P0` is the packet id the launcher greps for. The status line carries
// both so neither reader has to translate.
//
// Three states, not two (spec.md §8.0 clause 3, claim C42):
//   exit 0  `GATE P0 GREEN`             — every assertion held
//   exit 1  `GATE P0 RED: <reason>`     — an assertion fired
//   exit 2  `GATE P0 CANNOT RUN: …`     — the source store is unreadable here
// A `cannot run` is never this gate's red proof. It asserts nothing, and a gate
// that asserted nothing has not measured the thing it is named for (VP4(e)).
// The red proof is taken on a machine that holds the store; a packet whose red
// needs an input the machine does not have is blocked, not waived.
//
// What a reviewer should sabotage, and what must go red:
//   drop `requireSchemaObjects` from `openDatabase`        → S1
//   let `rebuildTable` drop a row, a column or a trigger   → M2, M4
//   copy a bare `CREATE` into schema.sql                   → S2, M3
//   delete an `_is_immutable` / `_cannot_be_deleted` pair  → T0, T1, T2
//   drop a row from contracts/append-only-tables.txt      → T0
//   make `clean_publish` promote a red run                 → P1
//   let the gate report green with no store                → C1

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(here, "src", "schema.sql");
const REQUIRED_APPEND_ONLY_PATH = join(here, "contracts", "append-only-tables.txt");
const DEFAULT_SOURCE = join(homedir(), "repos", "axiomdb", ".amanuensis", "memory.db");
const SOURCE = process.env.AMANUENSIS_XS1_SOURCE_STORE ?? DEFAULT_SOURCE;

// The five tables §8.0a names: no row of any of them may be rewritten,
// deleted or re-derived by an open.
const DOMAIN_TABLES = ["dispositions", "evidence", "disposition_evidence", "file_ledger", "vocabulary"];

// A crash signature in this gate's output means the run never reached its
// assertion, so the launcher rejects it as a red proof (spec.md §8.0 clause 1).
// Assertion detail is quoted from live errors, so it is scrubbed rather than
// trusted: a genuine red must never be mistaken for a crash, and a genuine
// crash must never be dressed up as a red — which is why the scrub replaces
// the token with a named marker instead of deleting it.
const CRASH_SIGNATURES = [
  "MODULE_NOT_FOUND",
  "Cannot find module",
  "ENOENT",
  "SyntaxError",
  "ReferenceError",
  "TypeError",
  "is not a function",
  "command not found",
  "ModuleNotFoundError",
  "ImportError",
];
function scrub(text) {
  let out = String(text ?? "").replace(/\s+/g, " ").trim();
  for (const signature of CRASH_SIGNATURES) {
    out = out.split(signature).join(`<${signature.replace(/[^A-Za-z]/g, "-")} elided>`);
  }
  return out;
}

const failures = [];
const notes = [];
let checked = 0;
function check(label, fn) {
  checked++;
  try {
    const detail = fn();
    if (detail) failures.push(`${label}: ${scrub(detail)}`);
  } catch (error) {
    failures.push(`${label}: threw — ${scrub(error?.message ?? error)}`);
  }
}

function cannotRun(reason) {
  console.log(`GATE P0 CANNOT RUN: ${scrub(reason)}`);
  console.log(
    "GATE XS1 asserts nothing without a readable populated store; cannot run is not this gate's red proof (spec.md §8.0 clause 3).",
  );
  process.exit(2);
}

// ---------------------------------------------------------------- utilities

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Every file beside the store, with its size and digest. */
function sidecarCensus(storePath) {
  const dir = dirname(storePath);
  const base = storePath.slice(dir.length + 1);
  const out = {};
  for (const name of readdirSync(dir)) {
    if (name !== base && !name.startsWith(`${base}-`)) continue;
    const full = join(dir, name);
    out[name] = `${statSync(full).size}:${sha256File(full)}`;
  }
  return out;
}

/**
 * Objects `schema.sql` declares, read the way `initializeSchema` applies them.
 *
 * This is the gate's own parse, deliberately independent of the server's:
 * a numerator and a denominator that are read from the same implementation
 * shrink together and prove nothing (GP24).
 */
function declaredObjects() {
  const text = readFileSync(SCHEMA_PATH, "utf8");
  const re =
    /^CREATE\s+(?:UNIQUE\s+)?(TABLE|VIEW|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gim;
  return [...text.matchAll(re)].map((m) => ({ type: m[1].toLowerCase(), name: m[2] }));
}

/** `^CREATE` statements with no `IF NOT EXISTS` and no preceding `DROP … IF EXISTS`. */
function bareCreateStatements() {
  const lines = readFileSync(SCHEMA_PATH, "utf8").split("\n");
  const bare = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^CREATE\s/i.test(line)) continue;
    if (/IF\s+NOT\s+EXISTS/i.test(line)) continue;
    const match = /^CREATE\s+(?:UNIQUE\s+)?(TABLE|VIEW|INDEX|TRIGGER)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i.exec(
      line,
    );
    const name = match?.[2];
    const guarded = lines
      .slice(Math.max(0, i - 3), i)
      .some((prior) => name && new RegExp(`^DROP\\s+\\w+\\s+IF\\s+EXISTS\\s+"?${name}"?`, "i").test(prior));
    if (!guarded) bare.push(`${i + 1}: ${line.trim().slice(0, 80)}`);
  }
  return bare;
}

/**
 * The tables that must be append-only, read from `contracts/append-only-tables.txt`.
 *
 * This list is the gate's denominator and it is **not** derived from the
 * triggers the gate is checking. It used to be: `appendOnlyTables()` parsed
 * schema.sql's trigger declarations and kept only the tables carrying both, so
 * deleting a table's pair deleted the table from the set being probed and the
 * gate reported `46 of 81` instead of `46 of 82` and exited 0 (GP24 — a
 * numerator and a denominator read from the same implementation shrink
 * together and prove nothing). The row stays here when the trigger leaves
 * schema.sql, and T0 says so.
 */
function requiredAppendOnlyTables() {
  const rows = [];
  const text = readFileSync(REQUIRED_APPEND_ONLY_PATH, "utf8");
  for (const [index, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length !== 3) {
      rows.push({ line: index + 1, malformed: trimmed });
      continue;
    }
    rows.push({ table: parts[0], immutable: parts[1], undeletable: parts[2], line: index + 1 });
  }
  return rows;
}

/**
 * Tables `schema.sql` declares append-only with the `<name>_is_immutable` /
 * `<name>_cannot_be_deleted` pair, with each trigger's guarded columns and its
 * own `RAISE(ABORT, …)` message.
 *
 * The message matters: a `CHECK` that happens to refuse the probe's new value
 * is not the trigger firing, and counting it would let a table lose its
 * immutability trigger while this gate stayed green.
 *
 * This is now the *observed* side of T0, never the required side: what the
 * schema happens to declare, laid against what the manifest requires.
 */
function appendOnlyTables() {
  const text = readFileSync(SCHEMA_PATH, "utf8");
  const bodies = [
    ...text.matchAll(
      /CREATE TRIGGER IF NOT EXISTS (\w+)\s+BEFORE (UPDATE|DELETE) ON (\w+)[\s\S]*?END;/gi,
    ),
  ];
  const pairs = new Map();
  for (const match of bodies) {
    const [body, trigger, event, table] = match;
    const abort = /RAISE\s*\(\s*ABORT\s*,\s*'([^']*)'/i.exec(body)?.[1] ?? null;
    if (abort === null) continue;
    const guarded = [...body.matchAll(/OLD\.(\w+)\s*!=\s*NEW\.\1\b/gi)].map((m) => m[1]);
    const unconditional = !/\bWHEN\b/i.test(body.slice(0, body.indexOf("BEGIN")));
    const entry = pairs.get(table) ?? { table, immutable: null, undeletable: null };
    if (event.toUpperCase() === "UPDATE" && /_is_immutable$/.test(trigger)) {
      entry.immutable = { trigger, abort, guarded, unconditional };
    } else if (event.toUpperCase() === "DELETE" && /_cannot_be_deleted$/.test(trigger)) {
      entry.undeletable = { trigger, abort };
    }
    pairs.set(table, entry);
  }
  return [...pairs.values()]
    .filter((p) => p.immutable || p.undeletable)
    .sort((a, b) => a.table.localeCompare(b.table));
}

/** The values a `CHECK (<column> IN (…))` term admits, or null when absent. */
function checkValues(createSql, column) {
  const match = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, "s").exec(createSql);
  if (!match) return null;
  return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

// ------------------------------------------------------------ the gate body

function main(Database, openDatabase, materializeTools, resolveProject, ensureProjectStorage) {
  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-xs1-"));
  const sourceBefore = { sha: sha256File(SOURCE), sidecars: sidecarCensus(SOURCE) };

  /** A fresh copy of the source store, never the source itself. */
  function copyStore(label) {
    const path = join(scratch, `${label}.db`);
    copyFileSync(SOURCE, path);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${SOURCE}${suffix}`;
      if (suffix === "-wal" && existsSync(sidecar) && statSync(sidecar).size > 0) {
        copyFileSync(sidecar, `${path}${suffix}`);
      }
    }
    return path;
  }

  function readOnly(path) {
    return new Database(path, { readonly: true, fileMustExist: true });
  }

  /**
   * A row-level digest of the five domain tables: rowid, every column, every
   * value, in rowid order. A rewrite that preserves the visible columns but
   * renumbers the rows still changes it, which is the point — §2.4's promise is
   * that the rows are not re-derived, not that they merely still add up.
   */
  function domainDigest(path) {
    const db = readOnly(path);
    try {
      const out = {};
      for (const table of DOMAIN_TABLES) {
        const columns = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((r) => r.name);
        const rows = db.prepare(`SELECT rowid AS __rowid, * FROM "${table}" ORDER BY rowid`).all();
        const hash = createHash("sha256");
        for (const row of rows) hash.update(`${JSON.stringify(row)}\n`);
        out[table] = { columns: columns.join(","), count: rows.length, sha: hash.digest("hex") };
      }
      out.__unattached = db
        .prepare(
          `SELECT COUNT(*) AS n FROM dispositions d
            WHERE NOT EXISTS (SELECT 1 FROM disposition_evidence de
                               WHERE de.subsystem_id = d.subsystem_id
                                 AND de.concern_code = d.concern_code)`,
        )
        .get().n;
      return out;
    } finally {
      db.close();
    }
  }

  function compareDigests(label, before, after) {
    const problems = [];
    for (const table of DOMAIN_TABLES) {
      if (before[table].count !== after[table].count) {
        problems.push(`${table} went from ${before[table].count} to ${after[table].count} row(s)`);
      } else if (before[table].columns !== after[table].columns) {
        problems.push(`${table}'s columns changed to ${after[table].columns}`);
      } else if (before[table].sha !== after[table].sha) {
        problems.push(`${table}'s ${after[table].count} row(s) digest differently`);
      }
    }
    if (before.__unattached !== after.__unattached) {
      problems.push(
        `unattached dispositions went from ${before.__unattached} to ${after.__unattached}`,
      );
    }
    return problems.length === 0 ? null : `${label} — ${problems.join("; ")}`;
  }

  function objectCensus(path) {
    const db = readOnly(path);
    try {
      const out = new Map();
      for (const row of db.prepare("SELECT type, name FROM sqlite_master").all()) {
        out.set(row.name, row.type);
      }
      return out;
    } finally {
      db.close();
    }
  }

  const declared = declaredObjects();
  const observed = new Map(appendOnlyTables().map((p) => [p.table, p]));
  const required = requiredAppendOnlyTables();
  const halfDeclared = [...observed.values()].filter((p) => !(p.immutable && p.undeletable));
  notes.push(
    `source ${SOURCE}; schema.sql declares ${declared.length} object(s); ` +
      `contracts/append-only-tables.txt requires ${required.length} append-only table(s); ` +
      `schema.sql declares a complete pair for ${[...observed.values()].length - halfDeclared.length}`,
  );
  if (halfDeclared.length > 0) {
    // Pre-existing shapes from earlier lanes: one guard, not two. Named rather
    // than dropped, so nobody has to re-derive which tables they are.
    notes.push(
      `${halfDeclared.length} table(s) carry one guard of the pair and are not append-only tables: ` +
        halfDeclared.map((p) => `${p.table} (${p.immutable?.trigger ?? p.undeletable?.trigger})`).join("; "),
    );
  }

  // The populated copy every non-seeded assertion runs against.
  const plain = copyStore("plain");
  const before = domainDigest(plain);
  notes.push(
    `copy carries ${before.dispositions.count} disposition(s), ${before.__unattached} of them unattached, ` +
      `${before.file_ledger.count} ledger row(s), ${before.vocabulary.count} vocabulary row(s)`,
  );

  // --- M1: the open runs at all, on a real populated store.
  let firstOpenError = null;
  check("M1 opening a populated copy succeeds", () => {
    try {
      openDatabase(plain).close();
    } catch (error) {
      firstOpenError = scrub(error?.message ?? error);
      return `openDatabase refused the copy — ${firstOpenError}`;
    }
    return null;
  });
  const afterFirst = firstOpenError ? before : domainDigest(plain);

  // --- M2: no domain row is rewritten, deleted or re-derived (§2.4, §8.0a).
  check("M2 the open rewrites no existing row", () =>
    firstOpenError ? "skipped: the first open failed" : compareDigests("first open", before, afterFirst),
  );

  // --- M3: the second open succeeds and is equally inert (§3.2's IF NOT EXISTS).
  check("M3 a second open of the same copy succeeds and rewrites nothing", () => {
    try {
      openDatabase(plain).close();
    } catch (error) {
      return `the second open threw — ${scrub(error?.message ?? error)}`;
    }
    return compareDigests("second open", afterFirst, domainDigest(plain));
  });

  // --- S1: every object schema.sql declares is present, as the declared type.
  //
  // This is the assertion §8.0a names "any table this lane adds is absent after
  // the open", stated over the whole schema rather than over a hand-kept list:
  // the lane's tables are covered the moment they are declared, and the check
  // cannot go vacuous, because its denominator is schema.sql's own 517
  // declarations.
  const census = objectCensus(plain);
  check("S1 the open leaves every declared object present, as its declared type", () => {
    const wrong = [];
    for (const object of declared) {
      const actual = census.get(object.name);
      if (actual === undefined) wrong.push(`${object.type} ${object.name} absent`);
      else if (actual !== object.type) wrong.push(`${object.type} ${object.name} present as ${actual}`);
    }
    return wrong.length === 0
      ? null
      : `${wrong.length} of ${declared.length} declared object(s) did not survive the open: ${wrong.slice(0, 6).join("; ")}`;
  });

  // --- S2: the open detects the loss instead of returning a store missing it.
  //
  // `CREATE TABLE IF NOT EXISTS t` is a silent no-op when the name `t` is
  // already held by an object of another type, so schema application can leave
  // a declared table absent and report success. `requireViews` (src/db.ts:61-82)
  // already refuses that for the two views the materializer reads; nothing
  // refuses it for a table. The seed below reproduces the shape on the real
  // store — the rows are preserved under a shadowed name, exactly as a
  // half-finished hand repair would leave them — and requires the open to
  // refuse, naming what is missing.
  check("S2 the open refuses a store where a declared table's name is held by a view", () => {
    const shadowed = copyStore("shadowed");
    const victim = "scope_gaps";
    {
      const db = new Database(shadowed);
      db.pragma("legacy_alter_table = ON");
      db.pragma("foreign_keys = OFF");
      db.exec(`ALTER TABLE "${victim}" RENAME TO "${victim}__xs1_shadowed"`);
      db.exec(`CREATE VIEW "${victim}" AS SELECT * FROM "${victim}__xs1_shadowed"`);
      db.close();
    }
    let refused = null;
    try {
      openDatabase(shadowed).close();
    } catch (error) {
      refused = scrub(error?.message ?? error);
    }
    const after = objectCensus(shadowed);
    if (refused === null) {
      return (
        `opening a populated store rewrote an existing row — no: it left the declared table ${victim} ` +
        `absent and reported success. sqlite_master holds ${victim} as a ${after.get(victim)}, and every ` +
        `read of that table now fails downstream with the store blamed for a schema defect`
      );
    }
    if (!refused.includes(victim)) {
      return `the open refused, but did not name ${victim}: ${refused}`;
    }
    return null;
  });

  // --- M4: the one path in `openDatabase` that does rewrite a domain table.
  //
  // `migrateVocabularyChecks` rebuilds a CHECK-constrained table when the
  // contract widens an enum (src/db.ts:154-192), and three of §8.0a's five
  // tables are CHECK-constrained. The AxiomDB store's own recorded shape is the
  // seed: it admitted five `evidence_quality` values where the source declares
  // nine. The rebuild must widen the constraint and leave every row, every
  // rowid, every index and every trigger exactly as it found them.
  check("M4 the vocabulary rebuild widens the CHECK and rewrites no row", () => {
    const narrowed = copyStore("narrowed");
    const narrowValues = [
      "code-verified",
      "runtime-observed",
      "contract-stated",
      "config-asserted",
      "doc-asserted",
    ];
    let liveBefore;
    let objectsBefore;
    {
      const db = new Database(narrowed);
      liveBefore = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='dispositions'")
        .get().sql;
      const canonical = checkValues(liveBefore, "evidence_quality");
      if (!canonical || canonical.length <= narrowValues.length) {
        db.close();
        return `the copy's dispositions.evidence_quality CHECK admits ${canonical?.length ?? "no"} value(s); the seed needs the wider canonical shape to narrow`;
      }
      const columns = db
        .prepare("SELECT name FROM pragma_table_info('dispositions')")
        .all()
        .map((r) => `"${r.name}"`)
        .join(", ");
      const narrowedCreate = liveBefore
        .replace(/CREATE TABLE "?dispositions"?/i, "CREATE TABLE dispositions__xs1_narrow")
        .replace(
          /CHECK\s*\(\s*evidence_quality\s+IN\s*\([^)]*\)\s*\)/s,
          `CHECK (evidence_quality IN (${narrowValues.map((v) => `'${v}'`).join(",")}))`,
        );
      db.pragma("legacy_alter_table = ON");
      db.pragma("foreign_keys = OFF");
      db.exec("BEGIN");
      db.exec(narrowedCreate);
      db.exec(`INSERT INTO dispositions__xs1_narrow (${columns}) SELECT ${columns} FROM "dispositions"`);
      db.exec('DROP TABLE "dispositions"');
      db.exec('ALTER TABLE dispositions__xs1_narrow RENAME TO "dispositions"');
      db.exec("COMMIT");
      // An index and a trigger the canonical CREATE cannot put back. Without
      // them the "indexes and triggers survive" half of this assertion is
      // vacuous on `dispositions`, whose only other object is the autoindex
      // the CREATE recreates by itself — and a rebuild that dropped every
      // trigger would pass unnoticed.
      db.exec("CREATE INDEX idx_xs1_dispositions_probe ON dispositions(concern_code)");
      db.exec(
        "CREATE TRIGGER xs1_dispositions_probe BEFORE DELETE ON dispositions " +
          "FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'xs1 probe'); END",
      );
      objectsBefore = db
        .prepare("SELECT type, name FROM sqlite_master WHERE tbl_name='dispositions' ORDER BY type, name")
        .all()
        .map((r) => `${r.type}:${r.name}`)
        .join(",");
      db.close();
    }
    const seeded = domainDigest(narrowed);
    openDatabase(narrowed).close();
    const migrated = domainDigest(narrowed);
    const drift = compareDigests("the vocabulary rebuild", seeded, migrated);
    if (drift) return drift;
    const db = readOnly(narrowed);
    try {
      const liveAfter = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='dispositions'")
        .get().sql;
      const widened = checkValues(liveAfter, "evidence_quality") ?? [];
      const missing = checkValues(liveBefore, "evidence_quality").filter((v) => !widened.includes(v));
      if (missing.length > 0) {
        return `the rebuild left evidence_quality narrowed: ${missing.join(", ")} still refused`;
      }
      const objectsAfter = db
        .prepare("SELECT type, name FROM sqlite_master WHERE tbl_name='dispositions' ORDER BY type, name")
        .all()
        .map((r) => `${r.type}:${r.name}`)
        .join(",");
      if (objectsAfter !== objectsBefore) {
        return `the rebuild changed dispositions' indexes and triggers: ${objectsBefore} became ${objectsAfter}`;
      }
      return null;
    } finally {
      db.close();
    }
  });

  // --- M5: the 54 unattached dispositions do not vanish (§2.4).
  check("M5 the copy's unattached dispositions survive the migration", () => {
    if (before.__unattached === 0) {
      return "the copy holds no unattached disposition, so this assertion would measure nothing";
    }
    const now = domainDigest(plain).__unattached;
    return now === before.__unattached
      ? null
      : `${before.__unattached} unattached disposition(s) became ${now}`;
  });

  // --- M3b: no bare DDL in schema.sql. A bare `CREATE` throws on the second
  // open of any store, which is the failure M3 would catch only for the
  // statements a copy happens to reach.
  check("M3b every CREATE in schema.sql carries IF NOT EXISTS or a preceding DROP IF EXISTS", () => {
    const bare = bareCreateStatements();
    return bare.length === 0 ? null : `${bare.length} bare CREATE statement(s): ${bare.join("; ")}`;
  });

  // --- T0: the required list and schema.sql agree, in both directions.
  //
  // This is the assertion the reviewer's sabotage walked past. Deleting a
  // table's trigger pair from schema.sql used to delete the table from the set
  // T1 and T2 iterate; now the requirement outlives the declaration and this
  // check names what went missing. The second direction keeps the file from
  // falling behind: an append-only table added to schema.sql with no row here
  // is red too, so the list cannot quietly stop covering the schema.
  check("T0 contracts/append-only-tables.txt and schema.sql declare the same pairs", () => {
    const problems = [];
    for (const row of required) {
      if (row.malformed !== undefined) {
        problems.push(`line ${row.line} is not '<table> <immutable> <undeletable>': ${row.malformed}`);
      }
    }
    const declaredTables = new Set(declared.filter((o) => o.type === "table").map((o) => o.name));
    const declaredTriggers = new Set(declared.filter((o) => o.type === "trigger").map((o) => o.name));
    for (const row of required) {
      if (row.malformed !== undefined) continue;
      if (!declaredTables.has(row.table)) {
        problems.push(`${row.table} is required append-only but schema.sql declares no such table`);
        continue;
      }
      const pair = observed.get(row.table);
      if (!declaredTriggers.has(row.immutable) || pair?.immutable?.trigger !== row.immutable) {
        problems.push(`${row.table}: schema.sql does not declare ${row.immutable} BEFORE UPDATE on it`);
      }
      if (!declaredTriggers.has(row.undeletable) || pair?.undeletable?.trigger !== row.undeletable) {
        problems.push(`${row.table}: schema.sql does not declare ${row.undeletable} BEFORE DELETE on it`);
      }
    }
    const requiredTables = new Set(required.map((row) => row.table));
    for (const pair of observed.values()) {
      if (pair.immutable && pair.undeletable && !requiredTables.has(pair.table)) {
        problems.push(
          `${pair.table} carries an append-only trigger pair in schema.sql and no row in ` +
            `contracts/append-only-tables.txt — add it, so the probe below has to cover it`,
        );
      }
    }
    return problems.length === 0
      ? null
      : `${problems.length} disagreement(s) between the required list and schema.sql: ${problems.slice(0, 6).join("; ")}`;
  });

  // --- T1/T2: the trigger, not the prose, is what makes a table append-only.
  const pairs = required
    .filter((row) => row.malformed === undefined)
    .map((row) => ({
      table: row.table,
      immutable: observed.get(row.table)?.immutable ?? null,
      undeletable: observed.get(row.table)?.undeletable ?? null,
      requiredImmutable: row.immutable,
      requiredUndeletable: row.undeletable,
    }));
  const triggerCensus = objectCensus(plain);
  check("T1 every append-only table's trigger pair is present after the open", () => {
    if (pairs.length === 0) return "the required list names no append-only table, so this measures nothing";
    const absent = [];
    for (const pair of pairs) {
      if (triggerCensus.get(pair.requiredImmutable) !== "trigger") absent.push(pair.requiredImmutable);
      if (triggerCensus.get(pair.requiredUndeletable) !== "trigger") absent.push(pair.requiredUndeletable);
    }
    return absent.length === 0
      ? null
      : `${absent.length} required trigger(s) absent after the open: ${absent.slice(0, 6).join(", ")}`;
  });

  check("T2 an UPDATE and a DELETE both raise on every append-only table a row can be seeded in", () => {
    const seeded = copyStore("append-only");
    // Through `openDatabase`, not `new Database`: the seeded copy used to be a
    // raw copy of the source, which carries none of the tables this lane adds,
    // so every one of them landed in `unprovable` with `near ")": syntax error`
    // — the empty column list of a table that was not there. The probe reported
    // 46 of 82 and named the lane's own tables as unseedable.
    openDatabase(seeded).close();
    const db = new Database(seeded);
    try {
      db.pragma("foreign_keys = OFF");
      const proven = [];
      const mutable = [];
      const unprovable = [];
      for (const pair of pairs) {
        if (!pair.immutable || !pair.undeletable) {
          // Required append-only, and schema.sql declares no such pair. T0 says
          // so already; this counts it as a mutation admitted rather than as a
          // table the probe merely could not seed, because a table with no
          // trigger is exactly what this assertion exists to refuse.
          mutable.push(
            `${pair.table}: no ${pair.immutable ? pair.requiredUndeletable : pair.requiredImmutable} declared in schema.sql`,
          );
          continue;
        }
        const create =
          db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(pair.table)?.sql ?? "";
        const columns = db.prepare(`SELECT * FROM pragma_table_info('${pair.table}')`).all();
        const single = columns.filter((c) => c.pk).length === 1;
        const names = [];
        const values = [];
        for (const column of columns) {
          if (single && column.pk === 1 && /INT/i.test(column.type)) continue;
          if (column.notnull === 0 && column.dflt_value === null && column.pk === 0) continue;
          const admitted = checkValues(create, column.name);
          const fixed = new RegExp(`CHECK\\s*\\(\\s*${column.name}\\s*=\\s*'([^']*)'`, "s").exec(create);
          let value;
          if (admitted?.length) value = admitted[0];
          else if (fixed) value = fixed[1];
          else if (new RegExp(`json_valid\\s*\\(\\s*${column.name}\\s*\\)`, "i").test(create)) value = "{}";
          else if (/INT/i.test(column.type)) value = 1;
          else if (/REAL|FLOA|DOUB/i.test(column.type)) value = 1.0;
          else value = "xs1-probe";
          names.push(`"${column.name}"`);
          values.push(value);
        }
        try {
          db.prepare(
            `INSERT INTO "${pair.table}" (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
          ).run(...values);
        } catch (error) {
          // Another invariant refused the row — a cross-row trigger, a
          // constraint this generic seed cannot satisfy. Not this gate's
          // subject; the table is reported below rather than counted.
          unprovable.push(`${pair.table} (${scrub(error?.message ?? error).slice(0, 60)})`);
          continue;
        }
        const rowid = db.prepare(`SELECT MAX(rowid) AS id FROM "${pair.table}"`).get().id;
        // Mutate a column the trigger actually guards, to a value the column's
        // own CHECK still admits — otherwise a CHECK failure would be counted
        // as the trigger firing and a table could lose its trigger unnoticed.
        const candidates = pair.immutable.unconditional
          ? columns.filter((c) => c.pk === 0).map((c) => c.name)
          : pair.immutable.guarded;
        let target = null;
        for (const name of candidates) {
          const column = columns.find((c) => c.name === name);
          if (!column) continue;
          if (new RegExp(`CHECK\\s*\\(\\s*${name}\\s*=\\s*'`, "s").test(create)) continue;
          const admitted = checkValues(create, name);
          const current = db.prepare(`SELECT "${name}" AS v FROM "${pair.table}" WHERE rowid = ?`).get(rowid).v;
          let next;
          if (admitted?.length) next = admitted.find((v) => v !== current) ?? null;
          else if (new RegExp(`json_valid\\s*\\(\\s*${name}\\s*\\)`, "i").test(create)) next = '{"xs1":1}';
          else if (/INT/i.test(column.type)) next = (Number(current) || 0) + 4242;
          else if (/REAL|FLOA|DOUB/i.test(column.type)) next = (Number(current) || 0) + 1.5;
          else next = `${current ?? ""}-xs1-mutated`;
          if (next === null || next === current) continue;
          target = { name, next };
          break;
        }
        if (target === null) {
          unprovable.push(`${pair.table} (no guarded column this probe can legally change)`);
          continue;
        }
        let updateRaised = null;
        let deleteRaised = null;
        try {
          db.prepare(`UPDATE "${pair.table}" SET "${target.name}" = ? WHERE rowid = ?`).run(target.next, rowid);
        } catch (error) {
          updateRaised = String(error?.message ?? error);
        }
        try {
          db.prepare(`DELETE FROM "${pair.table}" WHERE rowid = ?`).run(rowid);
        } catch (error) {
          deleteRaised = String(error?.message ?? error);
        }
        const problems = [];
        if (updateRaised === null) problems.push(`UPDATE of ${target.name} succeeded`);
        else if (!updateRaised.includes(pair.immutable.abort))
          problems.push(`UPDATE raised "${scrub(updateRaised)}", not ${pair.immutable.trigger}`);
        if (deleteRaised === null) problems.push("DELETE succeeded");
        else if (!deleteRaised.includes(pair.undeletable.abort))
          problems.push(`DELETE raised "${scrub(deleteRaised)}", not ${pair.undeletable.trigger}`);
        if (problems.length === 0) proven.push(pair.table);
        else mutable.push(`${pair.table}: ${problems.join(", ")}`);
      }
      notes.push(
        `append-only behaviour proved on ${proven.length} of ${pairs.length} declared table(s); ` +
          `${unprovable.length} could not be seeded by this probe (${unprovable.slice(0, 3).join("; ")}${unprovable.length > 3 ? "; …" : ""})`,
      );
      if (mutable.length > 0) {
        return `${mutable.length} append-only table(s) admitted a mutation: ${mutable.slice(0, 6).join("; ")}`;
      }
      if (proven.length === 0) {
        return "no append-only table could be seeded, so the trigger pair was never exercised";
      }
      return null;
    } finally {
      db.close();
    }
  });

  // --- P1: a refused clean publish leaves the previous output untouched
  // (ADR-0005). §2.4 rests on it: the AxiomDB store gets the lane's obligations
  // with no grace path, and a refused publish must lose nothing.
  check("P1 a refused clean_publish leaves the previous output byte-identical", () => {
    const workspace = join(scratch, "publish-workspace");
    mkdirSync(workspace, { recursive: true });
    const git = (...args) => spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(workspace, "fixture.ts"), "export const fixture = true;\n");
    git("add", "fixture.ts");
    git(
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=amanuensis-xs1",
      "-c",
      "user.email=test@localhost",
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      "fixture",
    );
    const project = resolveProject(workspace, { selectionSource: "xs1-existing-store-migration" });
    ensureProjectStorage(project, (dbPath) => openDatabase(dbPath).close());
    // The populated store, in the place the publisher reads it from.
    copyFileSync(SOURCE, project.dbPath);
    const db = openDatabase(project.dbPath);
    try {
      const outputDir = join(project.storagePath, "docs");
      mkdirSync(outputDir, { recursive: true });
      // An unmanaged file in the output is a state the publisher already
      // refuses (materializer/materialize.py:128-141). It is the cheapest red
      // run that reaches the promotion decision.
      writeFileSync(join(outputDir, "HAND-WRITTEN.md"), "a reader's note the publisher did not write\n");
      const priorState = readdirSync(outputDir)
        .sort()
        .map((name) => `${name}:${sha256File(join(outputDir, name))}`)
        .join(",");
      const tool = materializeTools.find((t) => t.name === "materialize_docs");
      if (!tool) return "materialize_docs is absent from materializeTools";
      const summary = tool.handler(
        { output_dir: "docs", clean_publish: true },
        { project, db, sessionId: "xs1-session" },
      );
      if (summary?.ok === true) return `the refused publish reported ok: ${scrub(JSON.stringify(summary))}`;
      if (summary?.published === true) return "the refused publish promoted its staging directory";
      const nowState = readdirSync(outputDir)
        .sort()
        .map((name) => `${name}:${sha256File(join(outputDir, name))}`)
        .join(",");
      if (nowState !== priorState) return `the refused publish altered the previous output: ${priorState} became ${nowState}`;
      if (!String(summary?.error ?? "").includes("unmanaged")) {
        notes.push(`clean_publish refused before reaching the renderer: ${scrub(summary?.error)}`);
      }
      return null;
    } finally {
      db.close();
    }
  });

  // --- C1: the gate's third state, proved by running the gate (claim C42).
  check("C1 an unreadable source store reports cannot run, never green", () => {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      encoding: "utf8",
      env: {
        ...process.env,
        AMANUENSIS_XS1_SOURCE_STORE: join(scratch, "no-such-store.db"),
        AMANUENSIS_XS1_CHILD: "1",
      },
    });
    const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
    if (child.status !== 2) return `the gate exited ${child.status} with no store, not 2`;
    if (!/^GATE P0 CANNOT RUN: /m.test(output)) return "the gate did not print a cannot-run line";
    if (/^GATE P0 GREEN/m.test(output)) return "the gate reported green with no store";
    if (/^GATE P0 RED: /m.test(output)) return "the gate offered a cannot run as its red proof";
    return null;
  });

  // --- A1: the source was opened read-only and never written (decisions.md §6).
  check("A1 the source store and its sidecars are byte-identical after the run", () => {
    const now = { sha: sha256File(SOURCE), sidecars: sidecarCensus(SOURCE) };
    if (now.sha !== sourceBefore.sha) return `${SOURCE} changed during the run`;
    const drifted = [];
    for (const name of new Set([...Object.keys(sourceBefore.sidecars), ...Object.keys(now.sidecars)])) {
      if (sourceBefore.sidecars[name] !== now.sidecars[name]) drifted.push(name);
    }
    return drifted.length === 0 ? null : `sidecar(s) beside the source changed: ${drifted.join(", ")}`;
  });

  rmSync(scratch, { recursive: true, force: true });
}

// ---------------------------------------------------------------- the driver

let exitCode = 0;
try {
  if (!existsSync(SOURCE) || !statSync(SOURCE).isFile()) {
    cannotRun(
      `no populated store at ${SOURCE}. Set AMANUENSIS_XS1_SOURCE_STORE to a copy of one, or run this gate on a machine that holds it (spec.md §8.0a).`,
    );
  }
  try {
    readFileSync(SOURCE).subarray(0, 16);
  } catch (error) {
    cannotRun(`the store at ${SOURCE} is not readable — ${scrub(error?.message ?? error)}`);
  }
  if (!existsSync(SCHEMA_PATH)) {
    cannotRun(`schema.sql is not beside this gate at ${SCHEMA_PATH}`);
  }

  // Load the subject defensively: an absent build must produce this gate's red
  // line, not a stack trace (spec.md §8.0 clause 1).
  let Database;
  let openDatabase;
  let materializeTools;
  let resolveProject;
  let ensureProjectStorage;
  try {
    ({ default: Database } = await import("better-sqlite3"));
    ({ openDatabase } = await import("./dist/db.js"));
    ({ materializeTools } = await import("./dist/tools/materialize.js"));
    ({ resolveProject, ensureProjectStorage } = await import("./dist/project.js"));
  } catch (error) {
    failures.push(`L1 the server build could not be loaded: ${scrub(error?.message ?? error)}`);
  }

  if (failures.length === 0) {
    if (typeof openDatabase !== "function") {
      failures.push("L1 dist/db.js does not export openDatabase");
    } else {
      main(Database, openDatabase, materializeTools, resolveProject, ensureProjectStorage);
    }
  }
} catch (error) {
  failures.push(`X1 the gate did not finish: ${scrub(error?.message ?? error)}`);
}

for (const note of notes) console.log(`  note ${note}`);
console.log(`  ran  ${checked} assertion(s) against ${SOURCE}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(
    `GATE P0 RED: GATE XS1 RED: opening a populated store rewrote an existing row, left a declared ` +
      `object absent, or left an append-only table mutable — ${failures.length} of ${checked} assertion(s) ` +
      `failed; first: ${failures[0]}`,
  );
  exitCode = 1;
} else {
  console.log("GATE P0 GREEN");
}
process.exit(exitCode);
