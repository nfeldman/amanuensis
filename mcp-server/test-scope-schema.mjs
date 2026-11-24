#!/usr/bin/env node
// GATE SC1 (design/scope/PLAN.md §3 SC1; §2.1, §2.9).
//
// The survey-scope records arrive by schema work alone: five append-only
// tables, six nullable columns on `scope_reconciliations` (probe 8), and a
// post-schema step that seeds the store's mode. This gate runs that work on a
// fresh store, on a store built from the pre-upgrade schema, and on copies of
// the committed AxiomDB-shaped and self-shaped stores. It reads no real store.
//
// Turns red when:
//   - scope_rules, scope_sorting, scope_inventory, scope_exclusions or
//     scope_mode_changes is absent or lacks a column of §2.1, on a fresh or a
//     migrated store;
//   - a valid row of any of them is refused, or a row outside §2.1's values
//     (an action, a category, a source, a mode; an empty owner_words; a
//     gitignore exclusion carrying a rule id, or a user or meta one without) is
//     accepted;
//   - an UPDATE or DELETE on any of the five succeeds, or changes the row;
//   - contracts/append-only-tables.txt lacks a three-column row for one of
//     them, names a trigger schema.sql does not declare on that table, or its
//     header count disagrees with its rows;
//   - the effective mode (readScopeMode) is not the latest scope_mode_changes
//     row by id;
//   - the six columns (scope_digest, exclusion_digest, excluded, unsorted,
//     survey_paths, scope_mode) are not added to an existing store, or the
//     open changes any row of any table that existed before it;
//   - a store with ledger rows, or with only reconciliation rows, does not open
//     as `legacy`, or an empty one does not open as `sorted`;
//   - a second open adds a second mode row, or changes any row;
//   - the AxiomDB-shaped or self-shaped golden memory.sql stores
//     (fixtures/legacy-stores/ and materializer/fixtures/store-only-golden/)
//     do not open as `legacy` with their rows unchanged;
//   - the positive standing fixture: a reconciliation written into a store
//     on the pre-upgrade schema (6a6dc43), with the restated tree_digest and
//     ledger_digest, does not stand under the pre-upgrade rules, or does not
//     stand (readReconciliationStanding, the same row) after this server opens
//     the store.
//
// Prints exactly one last line: `GATE SC1 GREEN` (exit 0) or
// `GATE SC1 RED: <reason>` (exit 1).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const APPEND_ONLY_PATH = join(here, "contracts", "append-only-tables.txt");
const SCHEMA_PATH = join(here, "src", "schema.sql");
// main after the old self-survey was removed; the plan's packets were written
// against it, and its schema is the one every store in use was created on.
const PRE_UPGRADE_SHA = "6a6dc43";

// Held here, not read from schema.sql: the gate's denominator must not shrink
// with the thing it checks (GP24).
const NEW_TABLES = {
  scope_rules: {
    columns: ["id", "pattern", "action", "reason", "owner_words", "supersedes", "session_id", "recorded_at"],
    triggers: ["scope_rule_is_immutable", "scope_rule_cannot_be_deleted"],
  },
  scope_sorting: {
    columns: ["id", "pattern", "category", "description", "supersedes", "session_id", "recorded_at"],
    triggers: ["scope_sorting_is_immutable", "scope_sorting_cannot_be_deleted"],
  },
  scope_inventory: {
    columns: ["sorting_id", "file_path", "line_range", "excerpt", "ref_sha"],
    triggers: ["scope_inventory_is_immutable", "scope_inventory_cannot_be_deleted"],
  },
  scope_exclusions: {
    columns: ["reconciliation_id", "file_path", "source", "rule_id"],
    triggers: ["scope_exclusion_is_immutable", "scope_exclusion_cannot_be_deleted"],
  },
  scope_mode_changes: {
    columns: ["id", "mode", "reason", "recorded_at"],
    triggers: ["scope_mode_change_is_immutable", "scope_mode_change_cannot_be_deleted"],
  },
};
const NEW_COLUMNS = ["scope_digest", "exclusion_digest", "excluded", "unsorted", "survey_paths", "scope_mode"];

const GOLDEN = [
  ["legacy-stores/axiomdb-shaped", join(here, "fixtures", "legacy-stores", "axiomdb-shaped", "memory.sql")],
  ["legacy-stores/self-shaped", join(here, "fixtures", "legacy-stores", "self-shaped", "memory.sql")],
  ["store-only-golden/axiomdb-shaped", join(here, "..", "materializer", "fixtures", "store-only-golden", "axiomdb-shaped", "memory.sql")],
  ["store-only-golden/self-shaped", join(here, "..", "materializer", "fixtures", "store-only-golden", "self-shaped", "memory.sql")],
];

// A crash signature in a red run means the gate never reached its assertion,
// so quoted errors are scrubbed (as test-store-only-schema.mjs does).
const CRASH_SIGNATURES = [
  "MODULE_NOT_FOUND",
  "Cannot find module",
  "ModuleNotFoundError",
  "ENOENT",
  "No such file or directory",
  "SyntaxError",
  "ReferenceError",
  "is not defined",
  "ImportError",
  "command not found",
  "Traceback (most recent call last)",
];
function scrub(text) {
  let out = String(text ?? "").replace(/\s+/g, " ").trim();
  for (const signature of CRASH_SIGNATURES) {
    out = out.split(signature).join(`<${signature.replace(/[^A-Za-z]/g, "-")} elided>`);
  }
  return out;
}

const failures = [];
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

function finish(extra) {
  if (extra) failures.unshift(scrub(extra));
  if (failures.length > 0) {
    for (const failure of failures) console.log(`FAIL ${failure}`);
    console.log(`GATE SC1 RED: ${failures.length} of ${Math.max(checked, 1)} check(s) failed; first: ${failures[0].slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`${checked} check(s) held`);
  console.log("GATE SC1 GREEN");
  process.exit(0);
}

// --------------------------------------------------------------- loading

let Database;
let openDatabase;
let readScopeMode;
let readReconciliationStanding;
try {
  Database = (await import("better-sqlite3")).default;
} catch (error) {
  finish(`better-sqlite3 cannot be loaded (run npm ci): ${error?.message ?? error}`);
}
// `dist/` is a build artifact: compile first so a sabotaged src/db.ts is what
// the gate reads, not the previous build.
const built = ensureBuilt();
if (!built.ok) finish(`src/ does not compile into dist/: ${built.detail}`);
if (!existsSync(join(here, "dist", "db.js"))) finish("dist/db.js is absent; run npm run build");
try {
  ({ openDatabase, readScopeMode } = await import(pathToFileURL(join(here, "dist", "db.js")).href));
  ({ readReconciliationStanding } = await import(pathToFileURL(join(here, "dist", "invariants.js")).href));
} catch (error) {
  finish(`dist/db.js or dist/invariants.js cannot be loaded: ${error?.message ?? error}`);
}
if (typeof openDatabase !== "function") finish("dist/db.js exports no openDatabase");
if (typeof readReconciliationStanding !== "function") finish("dist/invariants.js exports no readReconciliationStanding");
if (typeof readScopeMode !== "function") {
  finish("dist/db.js exports no readScopeMode, the reader of the store's effective mode (§2.1)");
}

const scratch = mkdtempSync(join(tmpdir(), "amanuensis-sc1-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

// ------------------------------------------------------------- utilities

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const NUL = "\u0000";

function columnsOf(db, table) {
  return db.prepare("SELECT name FROM pragma_table_info(?)").all(table).map((r) => r.name);
}
function tablesOf(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}
function triggersOn(db, table) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name = ? ORDER BY name")
    .all(table)
    .map((r) => r.name);
}
function raises(db, sql, params = []) {
  try {
    db.prepare(sql).run(...params);
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}

/** Every row of every table, over the columns it had, order-free and in full. */
function snapshot(db) {
  const out = {};
  for (const table of tablesOf(db)) {
    const columns = columnsOf(db, table);
    const quoted = columns.map((c) => `"${c}"`).join(", ");
    const rows = db.prepare(`SELECT ${quoted} FROM "${table}"`).raw().all();
    out[table] = { columns, rows: rows.map((r) => JSON.stringify(r)).sort() };
  }
  return out;
}

/** Compare every row of every table `before` had, over `before`'s columns. */
function rowsUnchanged(db, before) {
  const wrong = [];
  for (const [table, { columns, rows }] of Object.entries(before)) {
    const have = columnsOf(db, table);
    if (have.length === 0) {
      wrong.push(`${table} is gone`);
      continue;
    }
    const missing = columns.filter((c) => !have.includes(c));
    if (missing.length) {
      wrong.push(`${table} lost ${missing.join(", ")}`);
      continue;
    }
    const quoted = columns.map((c) => `"${c}"`).join(", ");
    const after = db
      .prepare(`SELECT ${quoted} FROM "${table}"`)
      .raw()
      .all()
      .map((r) => JSON.stringify(r))
      .sort();
    if (after.length !== rows.length) {
      wrong.push(`${table} held ${rows.length} row(s) and now holds ${after.length}`);
      continue;
    }
    for (let i = 0; i < rows.length; i++) {
      if (after[i] !== rows[i]) {
        wrong.push(`${table} row changed: ${rows[i].slice(0, 120)} became ${after[i].slice(0, 120)}`);
        break;
      }
    }
  }
  return wrong;
}

function modeRows(db) {
  return db.prepare("SELECT id, mode, reason FROM scope_mode_changes ORDER BY id").all();
}

function git(cwd, args, input) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", input });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/** The pre-upgrade schema text, out of this repository's history. */
function preUpgradeSchema() {
  const result = spawnSync("git", ["show", `${PRE_UPGRADE_SHA}:mcp-server/src/schema.sql`], {
    cwd: here,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout) return null;
  return result.stdout;
}

/** A store whose schema is `schemaText`, applied raw, with `seed` run over it. */
function rawStore(name, schemaText, seed) {
  const path = join(scratch, `${name}.db`);
  const db = new Database(path);
  try {
    db.exec(schemaText);
    if (seed) seed(db);
  } finally {
    db.close();
  }
  return path;
}

function withDb(path, fn) {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Open through this server, closing at once; returns the open's error, if any. */
function serverOpen(path) {
  const db = openDatabase(path);
  db.close();
}

// The restated formulas (invariants.ts trackedPathDigest and ledgerDigest),
// deliberately not imported: a fixture written by the code under test proves
// only that the code agrees with itself.
const treeDigestOf = (paths) => sha256([...paths].sort().join(NUL));
const ledgerDigestOf = (rows) =>
  sha256(rows.map((r) => `${r.file_path}${NUL}${r.classification ?? ""}`).sort().join(NUL));

// --------------------------------------------------------- 1. fresh store

const freshPath = join(scratch, "fresh.db");
let freshOpened = false;
check("F0 a fresh store opens through this server", () => {
  serverOpen(freshPath);
  freshOpened = true;
  return null;
});

/** The table, column, value and trigger checks every opened store must pass. */
function tableChecks(label, path) {
  withDb(path, (db) => {
    check(`${label}: the five scope tables carry §2.1's columns`, () => {
      const wrong = [];
      for (const [table, spec] of Object.entries(NEW_TABLES)) {
        const have = columnsOf(db, table);
        if (have.length === 0) {
          wrong.push(`${table} is absent`);
          continue;
        }
        const missing = spec.columns.filter((c) => !have.includes(c));
        if (missing.length) wrong.push(`${table} lacks ${missing.join(", ")}`);
      }
      return wrong.length ? wrong.join("; ") : null;
    });

    check(`${label}: scope_reconciliations carries the six new columns`, () => {
      const have = columnsOf(db, "scope_reconciliations");
      const missing = NEW_COLUMNS.filter((c) => !have.includes(c));
      return missing.length ? `scope_reconciliations lacks ${missing.join(", ")}` : null;
    });

    check(`${label}: each scope table carries its trigger pair`, () => {
      const wrong = [];
      for (const [table, spec] of Object.entries(NEW_TABLES)) {
        const present = triggersOn(db, table);
        for (const trigger of spec.triggers) {
          if (!present.includes(trigger)) wrong.push(`${table} lacks ${trigger}`);
        }
      }
      return wrong.length ? wrong.join("; ") : null;
    });
  });
}

/**
 * Valid rows accepted and read back; rows outside §2.1 refused; every update
 * and delete refused with the row intact. Writes into the store at `path`.
 */
function valueChecks(label, path) {
  withDb(path, (db) => {
    let ids = null;
    check(`${label}: a valid row of every scope table is accepted and reads back`, () => {
      db.prepare("INSERT OR IGNORE INTO sessions (session_id, intent) VALUES ('sc1', 'GATE SC1 seed')").run();
      const rule = Number(
        db
          .prepare(
            `INSERT INTO scope_rules (pattern, action, reason, owner_words, session_id)
             VALUES ('design/', 'exclude', 'plans are not the product', '"skip design/"', 'sc1')`,
          )
          .run().lastInsertRowid,
      );
      const rule2 = Number(
        db
          .prepare(
            `INSERT INTO scope_rules (pattern, action, reason, owner_words, supersedes, session_id)
             VALUES ('design/', 'include', 'the owner changed their mind', '"survey design/ after all"', ?, 'sc1')`,
          )
          .run(rule).lastInsertRowid,
      );
      const sorting = Number(
        db
          .prepare(
            `INSERT INTO scope_sorting (pattern, category, description, session_id)
             VALUES ('scholiast/', 'meta', 'research surveys about other projects', 'sc1')`,
          )
          .run().lastInsertRowid,
      );
      const sorting2 = Number(
        db
          .prepare(
            `INSERT INTO scope_sorting (pattern, category, description, supersedes, session_id)
             VALUES ('scholiast/', 'product', 'it ships after all', ?, 'sc1')`,
          )
          .run(sorting).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO scope_inventory (sorting_id, file_path, line_range, excerpt, ref_sha)
         VALUES (?, 'scholiast/README.md', '1-2', '# Scholiast', 'abc1234')`,
      ).run(sorting);
      const recon = Number(
        db
          .prepare(
            `INSERT INTO scope_reconciliations
               (detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows, unledgered, absent, exempt,
                scope_digest, exclusion_digest, excluded, unsorted, survey_paths, scope_mode)
             VALUES ('${"a".repeat(40)}', 't', 'l', 3, 0, 1, 0, 0, 's', 'e', 2, 1, 1, 'sorted')`,
          )
          .run().lastInsertRowid,
      );
      for (const [file, source, ruleId] of [
        ["dist/out.js", "gitignore", null],
        ["design/spec.md", "user", rule],
        ["scholiast/README.md", "meta", sorting],
      ]) {
        db.prepare("INSERT INTO scope_exclusions (reconciliation_id, file_path, source, rule_id) VALUES (?, ?, ?, ?)").run(
          recon,
          file,
          source,
          ruleId,
        );
      }
      const mode = Number(
        db
          .prepare("INSERT INTO scope_mode_changes (mode, reason) VALUES ('legacy', 'GATE SC1 seed')")
          .run().lastInsertRowid,
      );
      ids = { rule, rule2, sorting, sorting2, recon, mode };
      const wrong = [];
      const r = db.prepare("SELECT pattern, action, owner_words, supersedes, recorded_at FROM scope_rules WHERE id = ?").get(rule2);
      if (r?.action !== "include" || r?.supersedes !== rule || !r?.recorded_at) wrong.push(`scope_rules reads back as ${JSON.stringify(r)}`);
      const s = db.prepare("SELECT category, description, supersedes, recorded_at FROM scope_sorting WHERE id = ?").get(sorting2);
      if (s?.category !== "product" || s?.supersedes !== sorting || !s?.recorded_at) wrong.push(`scope_sorting reads back as ${JSON.stringify(s)}`);
      const inv = db.prepare("SELECT file_path, line_range, excerpt, ref_sha FROM scope_inventory WHERE sorting_id = ?").all(sorting);
      if (inv.length !== 1 || inv[0].excerpt !== "# Scholiast" || inv[0].line_range !== "1-2") wrong.push(`scope_inventory reads back as ${JSON.stringify(inv)}`);
      const ex = db
        .prepare("SELECT file_path, source, rule_id FROM scope_exclusions WHERE reconciliation_id = ? ORDER BY file_path")
        .all(recon)
        .map((e) => `${e.file_path}|${e.source}|${e.rule_id}`);
      const wantEx = [`design/spec.md|user|${rule}`, "dist/out.js|gitignore|null", `scholiast/README.md|meta|${sorting}`];
      if (JSON.stringify(ex) !== JSON.stringify(wantEx)) wrong.push(`scope_exclusions reads back as ${JSON.stringify(ex)}`);
      const rc = db
        .prepare(`SELECT ${NEW_COLUMNS.join(", ")} FROM scope_reconciliations WHERE id = ?`)
        .get(recon);
      const wantRc = { scope_digest: "s", exclusion_digest: "e", excluded: 2, unsorted: 1, survey_paths: 1, scope_mode: "sorted" };
      if (JSON.stringify(rc) !== JSON.stringify(wantRc)) wrong.push(`the new reconciliation columns read back as ${JSON.stringify(rc)}`);
      return wrong.length ? wrong.join("; ") : null;
    });

    check(`${label}: rows outside §2.1's values are refused`, () => {
      if (!ids) return "no valid rows were seeded";
      const accepted = [];
      const attempts = [
        ["an action other than exclude or include", "INSERT INTO scope_rules (pattern, action, reason, owner_words) VALUES ('x/', 'drop', 'r', 'w')"],
        ["a rule without owner_words", "INSERT INTO scope_rules (pattern, action, reason) VALUES ('x/', 'exclude', 'r')"],
        ["a rule with empty owner_words", "INSERT INTO scope_rules (pattern, action, reason, owner_words) VALUES ('x/', 'exclude', 'r', '  ')"],
        ["a rule without a pattern", "INSERT INTO scope_rules (action, reason, owner_words) VALUES ('exclude', 'r', 'w')"],
        ["a rule superseding no rule", "INSERT INTO scope_rules (pattern, action, reason, owner_words, supersedes) VALUES ('x/', 'exclude', 'r', 'w', 99999)"],
        ["a category other than product or meta", "INSERT INTO scope_sorting (pattern, category, description) VALUES ('x/', 'other', 'd')"],
        ["a sorting row without a description", "INSERT INTO scope_sorting (pattern, category) VALUES ('x/', 'meta')"],
        ["an inventory row for no sorting row", "INSERT INTO scope_inventory (sorting_id, file_path, line_range, excerpt, ref_sha) VALUES (99999, 'a', '1-1', 'e', 'abc1234')"],
        ["an inventory row without an excerpt", `INSERT INTO scope_inventory (sorting_id, file_path, line_range, ref_sha) VALUES (${ids.sorting}, 'a', '1-1', 'abc1234')`],
        ["an inventory row without a line range", `INSERT INTO scope_inventory (sorting_id, file_path, excerpt, ref_sha) VALUES (${ids.sorting}, 'a', 'e', 'abc1234')`],
        ["a source other than gitignore, user or meta", `INSERT INTO scope_exclusions (reconciliation_id, file_path, source, rule_id) VALUES (${ids.recon}, 'q', 'git', NULL)`],
        ["a gitignore exclusion carrying a rule id", `INSERT INTO scope_exclusions (reconciliation_id, file_path, source, rule_id) VALUES (${ids.recon}, 'q', 'gitignore', ${ids.rule})`],
        ["a user exclusion without a rule id", `INSERT INTO scope_exclusions (reconciliation_id, file_path, source, rule_id) VALUES (${ids.recon}, 'q', 'user', NULL)`],
        ["a meta exclusion without a rule id", `INSERT INTO scope_exclusions (reconciliation_id, file_path, source, rule_id) VALUES (${ids.recon}, 'q', 'meta', NULL)`],
        ["an exclusion for no reconciliation", "INSERT INTO scope_exclusions (reconciliation_id, file_path, source, rule_id) VALUES (99999, 'q', 'gitignore', NULL)"],
        ["a second exclusion of one path in one reconciliation", `INSERT INTO scope_exclusions (reconciliation_id, file_path, source, rule_id) VALUES (${ids.recon}, 'dist/out.js', 'user', ${ids.rule})`],
        ["a mode other than sorted or legacy", "INSERT INTO scope_mode_changes (mode, reason) VALUES ('open', 'r')"],
        ["a mode change without a reason", "INSERT INTO scope_mode_changes (mode) VALUES ('sorted')"],
        ["a reconciliation scope_mode other than sorted or legacy", `INSERT INTO scope_reconciliations (detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows, unledgered, absent, exempt, scope_mode) VALUES ('${"b".repeat(40)}', 't', 'l', 0, 0, 0, 0, 0, 'open')`],
      ];
      for (const [what, sql] of attempts) {
        if (raises(db, sql) === null) accepted.push(what);
      }
      return accepted.length ? `accepted ${accepted.join("; ")}` : null;
    });

    check(`${label}: every update and delete on a scope table is refused and leaves the row`, () => {
      if (!ids) return "no valid rows were seeded";
      const before = snapshot(db);
      const allowed = [];
      const attempts = [
        ["UPDATE scope_rules SET pattern = 'y/' WHERE id = ?", ids.rule],
        ["UPDATE scope_rules SET supersedes = NULL WHERE id = ?", ids.rule2],
        ["DELETE FROM scope_rules WHERE id = ?", ids.rule2],
        ["UPDATE scope_sorting SET category = 'product' WHERE id = ?", ids.sorting],
        ["DELETE FROM scope_sorting WHERE id = ?", ids.sorting2],
        ["UPDATE scope_inventory SET excerpt = 'forged' WHERE sorting_id = ?", ids.sorting],
        ["DELETE FROM scope_inventory WHERE sorting_id = ?", ids.sorting],
        ["UPDATE scope_exclusions SET source = 'gitignore', rule_id = NULL WHERE reconciliation_id = ? AND source = 'user'", ids.recon],
        ["DELETE FROM scope_exclusions WHERE reconciliation_id = ?", ids.recon],
        ["UPDATE scope_mode_changes SET mode = 'sorted' WHERE id = ?", ids.mode],
        ["DELETE FROM scope_mode_changes WHERE id = ?", ids.mode],
        ["UPDATE scope_reconciliations SET scope_digest = 'forged' WHERE id = ?", ids.recon],
      ];
      for (const [sql, id] of attempts) {
        if (raises(db, sql, [id]) === null) allowed.push(sql.split(" WHERE")[0]);
      }
      const changed = rowsUnchanged(db, before);
      const wrong = [];
      if (allowed.length) wrong.push(`allowed ${allowed.join("; ")}`);
      if (changed.length) wrong.push(changed.join("; "));
      return wrong.length ? wrong.join("; ") : null;
    });
  });
}

if (freshOpened) {
  tableChecks("fresh", freshPath);

  check("fresh: an empty store opens as sorted, with one mode row", () => {
    return withDb(freshPath, (db) => {
      const rows = modeRows(db);
      if (rows.length !== 1 || rows[0].mode !== "sorted") return `scope_mode_changes holds ${JSON.stringify(rows)}`;
      if (!rows[0].reason?.trim()) return "the seeded mode row carries no reason";
      return null;
    });
  });

  check("fresh: a second open adds no mode row and changes nothing", () => {
    const before = withDb(freshPath, snapshot);
    serverOpen(freshPath);
    serverOpen(freshPath);
    return withDb(freshPath, (db) => {
      const wrong = rowsUnchanged(db, before);
      const rows = modeRows(db);
      if (rows.length !== 1) wrong.push(`${rows.length} mode rows after three opens`);
      return wrong.length ? wrong.join("; ") : null;
    });
  });

  // ------------------------------------------- 2. the effective mode
  check("mode: the effective mode is the latest scope_mode_changes row by id", () => {
    const path = join(scratch, "mode.db");
    serverOpen(path);
    const db = openDatabase(path);
    try {
      const seen = [readScopeMode(db)];
      for (const mode of ["legacy", "sorted", "legacy"]) {
        db.prepare("INSERT INTO scope_mode_changes (mode, reason) VALUES (?, 'GATE SC1 mode step')").run(mode);
        seen.push(readScopeMode(db));
      }
      const want = ["sorted", "legacy", "sorted", "legacy"];
      return JSON.stringify(seen) === JSON.stringify(want) ? null : `readScopeMode gave ${JSON.stringify(seen)}, wanted ${JSON.stringify(want)}`;
    } finally {
      db.close();
    }
  });

  check("mode: an older row with a later recorded_at does not decide the mode", () => {
    const path = join(scratch, "mode-clock.db");
    serverOpen(path);
    const db = openDatabase(path);
    try {
      db.prepare("INSERT INTO scope_mode_changes (mode, reason, recorded_at) VALUES ('legacy', 'clock skew', '2999-01-01 00:00:00')").run();
      db.prepare("INSERT INTO scope_mode_changes (mode, reason, recorded_at) VALUES ('sorted', 'latest by id', '2000-01-01 00:00:00')").run();
      const mode = readScopeMode(db);
      return mode === "sorted" ? null : `readScopeMode gave ${mode}; the latest row by id is sorted`;
    } finally {
      db.close();
    }
  });

  valueChecks("fresh", freshPath);
}

// ------------------------------------------- 3. the registry, two-sided

check("registry: append-only-tables.txt names each scope table's pair, and schema.sql declares it on that table", () => {
  let registry;
  let schema;
  try {
    registry = readFileSync(APPEND_ONLY_PATH, "utf8");
    schema = readFileSync(SCHEMA_PATH, "utf8");
  } catch {
    return "append-only-tables.txt or schema.sql is unreadable";
  }
  const rows = registry
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => l.trim().split(/\s+/));
  const wrong = [];
  for (const [table, spec] of Object.entries(NEW_TABLES)) {
    const row = rows.find((r) => r[0] === table);
    if (!row || row.length !== 3) {
      wrong.push(`${table} has no three-column row`);
      continue;
    }
    if (row[1] !== spec.triggers[0] || row[2] !== spec.triggers[1]) wrong.push(`${table}'s row names ${row.slice(1).join(" ")}`);
    for (const [trigger, verb] of [
      [row[1], "UPDATE"],
      [row[2], "DELETE"],
    ]) {
      const re = new RegExp(`CREATE TRIGGER IF NOT EXISTS ${trigger}\\s+BEFORE ${verb} ON ${table}\\s+FOR EACH ROW\\s+BEGIN SELECT RAISE\\(ABORT`);
      if (!re.test(schema)) wrong.push(`schema.sql does not declare ${trigger} as an unconditional BEFORE ${verb} ON ${table}`);
    }
  }
  // The other side: a scope_* table schema.sql makes append-only and the
  // registry does not list.
  for (const match of schema.matchAll(/CREATE TRIGGER IF NOT EXISTS \w+\s+BEFORE (?:UPDATE|DELETE) ON (scope_\w+)/g)) {
    if (!rows.some((r) => r[0] === match[1])) wrong.push(`${match[1]} is append-only in schema.sql and unlisted`);
  }
  const header = /# (\d+) tables\./.exec(registry);
  if (!header) wrong.push("the header count is missing");
  else if (Number(header[1]) !== rows.length) wrong.push(`the header says ${header[1]} tables and the file lists ${rows.length}`);
  return wrong.length ? [...new Set(wrong)].join("; ") : null;
});

// ---------------------------- 4. a pre-upgrade store, and its standing

const oldSchema = preUpgradeSchema();
check(`pre-upgrade: the schema at ${PRE_UPGRADE_SHA} is readable from this repository's history`, () =>
  oldSchema ? null : `git show ${PRE_UPGRADE_SHA}:mcp-server/src/schema.sql gave nothing (a shallow clone needs fetch-depth: 0)`,
);

if (oldSchema && freshOpened) {
  check("pre-upgrade: an empty pre-upgrade store opens as sorted", () => {
    const path = rawStore("old-empty", oldSchema);
    serverOpen(path);
    return withDb(path, (db) => {
      const rows = modeRows(db);
      return rows.length === 1 && rows[0].mode === "sorted" ? null : `scope_mode_changes holds ${JSON.stringify(rows)}`;
    });
  });

  check("pre-upgrade: a store with ledger rows and no reconciliation opens as legacy", () => {
    const path = rawStore("old-ledger", oldSchema, (db) => {
      db.prepare("INSERT INTO subsystems (id, name, status) VALUES ('B-01', 'Core', 'scoping')").run();
      db.prepare("INSERT INTO file_ledger (subsystem_id, file_path, classification) VALUES ('B-01', 'src/a.ts', 'candidate')").run();
    });
    serverOpen(path);
    return withDb(path, (db) => {
      const rows = modeRows(db);
      return rows.length === 1 && rows[0].mode === "legacy" ? null : `scope_mode_changes holds ${JSON.stringify(rows)}`;
    });
  });

  check("pre-upgrade: a store with a reconciliation and no ledger rows opens as legacy", () => {
    const path = rawStore("old-recon", oldSchema, (db) => {
      db.prepare(
        `INSERT INTO scope_reconciliations (detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows, unledgered, absent, exempt)
         VALUES ('${"c".repeat(40)}', 't', 'l', 1, 0, 1, 0, 0)`,
      ).run();
    });
    serverOpen(path);
    return withDb(path, (db) => {
      const rows = modeRows(db);
      return rows.length === 1 && rows[0].mode === "legacy" ? null : `scope_mode_changes holds ${JSON.stringify(rows)}`;
    });
  });

  // The positive standing fixture: a scratch repository with two commits, a
  // store on the pre-upgrade schema, and a reconciliation that stands there.
  const repo = join(scratch, "repo");
  let head = null;
  let standingPath = null;
  let reconId = null;
  let before = null;
  check("standing: the scratch repository and pre-upgrade store are built", () => {
    git(scratch, ["init", "-q", "-b", "main", repo]);
    git(repo, ["config", "user.email", "gate@example.invalid"]);
    git(repo, ["config", "user.name", "GATE SC1"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    writeFileSync(join(repo, "README.md"), "# Fixture\n");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "first"]);
    writeFileSync(join(repo, "b.ts"), "export const b = 2;\n");
    writeFileSync(join(repo, ".gitignore"), "dist/\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "second"]);
    head = git(repo, ["rev-parse", "HEAD"]).trim();
    const tracked = git(repo, ["ls-tree", "-r", "--name-only", "-z", head])
      .split(NUL)
      .filter((p) => p.length > 0);
    if (tracked.length !== 4) return `the fixture tree has ${tracked.length} paths, wanted 4`;
    standingPath = rawStore("old-standing", oldSchema, (db) => {
      db.prepare("INSERT INTO sessions (session_id, intent) VALUES ('sc1-old', 'pre-upgrade survey')").run();
      db.prepare("INSERT INTO subsystems (id, name, status) VALUES ('B-01', 'Core', 'structural')").run();
      const ledger = [
        ["README.md", "irrelevant"],
        ["a.ts", "examined"],
        ["b.ts", "candidate"],
        [".gitignore", "generated-ignore"],
      ];
      for (const [file, classification] of ledger) {
        db.prepare("INSERT INTO file_ledger (subsystem_id, file_path, classification, ref_sha) VALUES ('B-01', ?, ?, ?)").run(
          file,
          classification,
          head,
        );
      }
      db.prepare(
        "INSERT INTO git_state (repo_id, canonical_branch, last_checked_sha, onboarding_sha) VALUES ('default', 'main', ?, ?)",
      ).run(head, head);
      const rows = db.prepare("SELECT file_path, classification FROM file_ledger").all();
      reconId = Number(
        db
          .prepare(
            `INSERT INTO scope_reconciliations
               (detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows, unledgered, absent, exempt, session_id)
             VALUES (?, ?, ?, ?, ?, 0, 0, 2, 'sc1-old')`,
          )
          .run(head, treeDigestOf(tracked), ledgerDigestOf(rows), tracked.length, rows.length).lastInsertRowid,
      );
    });
    return null;
  });

  /** §3.3 as the pre-upgrade server read it, restated over the raw store. */
  function standsUnderPreUpgradeRules(db) {
    const tracked = git(repo, ["ls-tree", "-r", "--name-only", "-z", head])
      .split(NUL)
      .filter((p) => p.length > 0);
    const last = db.prepare("SELECT last_checked_sha FROM git_state WHERE repo_id = 'default'").get()?.last_checked_sha;
    if (last !== head) return `git_state.last_checked_sha is ${last}`;
    const ledger = db.prepare("SELECT file_path, classification FROM file_ledger").all();
    const row = db
      .prepare(
        "SELECT id FROM scope_reconciliations WHERE detected_sha = ? AND tree_digest = ? AND ledger_digest = ? ORDER BY id DESC LIMIT 1",
      )
      .get(head, treeDigestOf(tracked), ledgerDigestOf(ledger));
    if (!row) return "no reconciliation row matches the restated digests";
    if (row.id !== reconId) return `the standing row is ${row.id}, not the fixture's ${reconId}`;
    return null;
  }

  check("standing: the reconciliation stands under the pre-upgrade rules before the upgrade", () => {
    if (!standingPath) return "the fixture was not built";
    return withDb(standingPath, (db) => {
      if (columnsOf(db, "scope_reconciliations").includes("scope_digest")) {
        return "the pre-upgrade schema already carries scope_digest; the fixture is not pre-upgrade";
      }
      if (tablesOf(db).includes("scope_mode_changes")) return "the pre-upgrade schema already carries scope_mode_changes";
      before = snapshot(db);
      return standsUnderPreUpgradeRules(db);
    });
  });

  let upgraded = false;
  check("standing: this server opens the pre-upgrade store", () => {
    if (!standingPath) return "the fixture was not built";
    serverOpen(standingPath);
    upgraded = true;
    return null;
  });

  if (upgraded && before) {
    tableChecks("upgraded", standingPath);

    check("upgraded: the open changed no row of any table that existed before it", () =>
      withDb(standingPath, (db) => {
        const wrong = rowsUnchanged(db, before);
        return wrong.length ? wrong.join("; ") : null;
      }),
    );

    check("upgraded: the legacy reconciliation carries null in all six new columns", () =>
      withDb(standingPath, (db) => {
        const row = db.prepare(`SELECT ${NEW_COLUMNS.join(", ")} FROM scope_reconciliations WHERE id = ?`).get(reconId);
        if (!row) return `reconciliation ${reconId} is gone`;
        const set = NEW_COLUMNS.filter((c) => row[c] !== null);
        return set.length ? `${set.join(", ")} carry values on a legacy row: ${JSON.stringify(row)}` : null;
      }),
    );

    check("upgraded: a store with ledger and reconciliation rows opens as legacy", () =>
      withDb(standingPath, (db) => {
        const rows = modeRows(db);
        return rows.length === 1 && rows[0].mode === "legacy" ? null : `scope_mode_changes holds ${JSON.stringify(rows)}`;
      }),
    );

    check("upgraded: the reconciliation still stands, under the restated rules and readReconciliationStanding", () => {
      const restated = withDb(standingPath, standsUnderPreUpgradeRules);
      if (restated) return `restated: ${restated}`;
      const db = openDatabase(standingPath);
      try {
        const result = readReconciliationStanding(db, repo, head);
        if (!result.standing) return `readReconciliationStanding says it does not stand: ${result.why}`;
        if (result.standing.id !== reconId) return `the standing row is ${result.standing.id}, not the fixture's ${reconId}`;
        return null;
      } finally {
        db.close();
      }
    });

    check("upgraded: a second open adds no mode row, changes nothing, and the reconciliation stands", () => {
      const snap = withDb(standingPath, snapshot);
      serverOpen(standingPath);
      return withDb(standingPath, (db) => {
        const wrong = rowsUnchanged(db, snap);
        const rows = modeRows(db);
        if (rows.length !== 1) wrong.push(`${rows.length} mode rows after the second open`);
        const restated = standsUnderPreUpgradeRules(db);
        if (restated) wrong.push(restated);
        return wrong.length ? wrong.join("; ") : null;
      });
    });

    valueChecks("upgraded", standingPath);
  }
}

// ----------------------------------------------- 5. the golden stores

for (const [name, dump] of GOLDEN) {
  if (!freshOpened) break;
  check(`golden ${name}: opens as legacy with every row unchanged and the six columns added`, () => {
    if (!existsSync(dump)) return `${name}/memory.sql is absent`;
    const path = rawStore(`golden-${name.replace(/\W+/g, "-")}`, readFileSync(dump, "utf8"));
    const snap = withDb(path, (db) => {
      if (tablesOf(db).includes("scope_mode_changes")) return null;
      const ledger = db.prepare("SELECT COUNT(*) AS n FROM file_ledger").get().n;
      return ledger > 0 ? snapshot(db) : null;
    });
    if (!snap) return "the fixture is not a pre-scope store with ledger rows";
    serverOpen(path);
    serverOpen(path);
    return withDb(path, (db) => {
      const wrong = rowsUnchanged(db, snap);
      const rows = modeRows(db);
      if (rows.length !== 1 || rows[0].mode !== "legacy") wrong.push(`scope_mode_changes holds ${JSON.stringify(rows)}`);
      const missing = NEW_COLUMNS.filter((c) => !columnsOf(db, "scope_reconciliations").includes(c));
      if (missing.length) wrong.push(`scope_reconciliations lacks ${missing.join(", ")}`);
      else {
        const filled = db
          .prepare(`SELECT COUNT(*) AS n FROM scope_reconciliations WHERE ${NEW_COLUMNS.map((c) => `${c} IS NOT NULL`).join(" OR ")}`)
          .get().n;
        if (filled) wrong.push(`${filled} legacy reconciliation(s) carry a value in a new column`);
      }
      for (const table of Object.keys(NEW_TABLES)) {
        if (columnsOf(db, table).length === 0) wrong.push(`${table} is absent`);
      }
      return wrong.length ? wrong.join("; ") : null;
    });
  });
}

finish();
