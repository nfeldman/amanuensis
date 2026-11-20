#!/usr/bin/env node
// GATE SO2 (design/store-only/PLAN.md §8 SO2; §2, §5.1, §7.2).
//
// The store-only records arrive by schema work alone: new append-only tables,
// two `concerns` columns, and an `explanations` rebuild that admits a project
// purpose and an `imported` row. This gate runs that work on a fresh store and
// on copies of both committed legacy fixtures (fixtures/legacy-stores/, built
// on the lane's start commit by fixtures/build-legacy-stores.mjs). It reads no
// real store.
//
// Turns red when:
//   - a new table of §2.1–2.4 or §7.2 (with claim_mark_withdrawals and
//     claim_mark_declinations) or a column of it is missing, on any of the three
//     stores, or `concerns` lacks `territory` or `probe` after the migration;
//   - a new table's `_is_immutable` / `_cannot_be_deleted` trigger is missing,
//     or contracts/append-only-tables.txt lacks its row;
//   - an UPDATE or DELETE on a new append-only table succeeds;
//   - a valid row of any new table, or of any value of the new enums, is
//     refused or does not read back; or a value outside them is accepted;
//   - the rebuilt `explanations` drops a row, a column, an index or a trigger,
//     or still carries the CHECK that forbids a project purpose;
//   - a project purpose, or an `imported` project purpose, is refused by the
//     schema (or an `imported` subsystem row is accepted);
//   - any existing table's row count, or any existing row, changes on the open;
//   - the contract lacks a `sql` binding for a new enum, or
//     `explanation_disposition` lacks `imported`;
//   - a legacy fixture loses the shape later packets rely on (AxiomDB-shaped:
//     no claims, seams, survey bodies with tables and fences, an entry point
//     whose bytes differ from its registered hash; self-shaped: survey bodies
//     under subsystems/), or is not on the base tree's schema;
//   - the base tree's server (built from the packet's start commit into a temp
//     directory) fails to open and smoke-read a store the new server migrated,
//     or the new server cannot reopen it afterwards with its rows intact.
//
// Prints exactly one last line: `GATE SO2 GREEN` (exit 0) or
// `GATE SO2 RED: <reason>` (exit 1).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "fixtures", "legacy-stores");
const APPEND_ONLY_PATH = join(here, "contracts", "append-only-tables.txt");
const CONTRACT_PATH = join(here, "contracts", "conspectus-vocabulary.json");
// The packet's start commit (plan.json SO2 start_sha). Its server is the one
// already deployed when the lane merges (§5.1, D16).
const BASE_SHA = process.env.AMANUENSIS_SO2_BASE_SHA ?? "adc060c663e0b93ce395d146c9830f721ba6f59a";

// Held here, not read from schema.sql: the gate's denominator must not shrink
// with the thing it checks (GP24).
const NEW_TABLES = {
  narratives: {
    columns: ["id", "subject_type", "subject_id", "section", "topic", "disposition", "body", "ref_sha", "session_id", "recorded_at"],
    triggers: ["narrative_is_immutable", "narrative_cannot_be_deleted"],
  },
  narrative_evidence: {
    columns: ["narrative_id", "evidence_id"],
    triggers: ["narrative_evidence_is_immutable", "narrative_evidence_cannot_be_deleted"],
  },
  project_profile: {
    columns: ["id", "name", "ref_sha", "session_id", "recorded_at"],
    triggers: ["project_profile_is_immutable", "project_profile_cannot_be_deleted"],
  },
  runtime_boundaries: {
    columns: ["id", "from_runtime", "from_language", "to_runtime", "mechanism", "notes", "origin", "withdrawn", "ref_sha", "session_id", "recorded_at"],
    triggers: ["runtime_boundary_is_immutable", "runtime_boundary_cannot_be_deleted"],
  },
  runtime_boundary_evidence: {
    columns: ["boundary_id", "evidence_id"],
    triggers: ["runtime_boundary_evidence_is_immutable", "runtime_boundary_evidence_cannot_be_deleted"],
  },
  territory_dispositions: {
    columns: ["id", "territory", "disposition", "condition", "open_question_id", "ref_sha", "session_id", "recorded_at"],
    triggers: ["territory_disposition_is_immutable", "territory_disposition_cannot_be_deleted"],
  },
  imported_artifacts: {
    columns: ["id", "path", "kind", "subsystem_id", "body", "body_sha256", "registered_hash", "hash_matches", "registered_ref_sha", "written_at", "imported_at", "session_id"],
    triggers: ["imported_artifact_is_immutable", "imported_artifact_cannot_be_deleted"],
  },
  imported_artifact_withdrawals: {
    columns: ["id", "path", "reason", "session_id", "at"],
    triggers: ["imported_artifact_withdrawal_is_immutable", "imported_artifact_withdrawal_cannot_be_deleted"],
  },
  claim_marks: {
    columns: ["id", "claim_id", "kind", "label", "target", "evidence_id", "ref_sha", "session_id", "recorded_at"],
    triggers: ["claim_mark_is_immutable", "claim_mark_cannot_be_deleted"],
  },
  claim_mark_withdrawals: {
    columns: ["id", "mark_id", "reason", "session_id", "recorded_at"],
    triggers: ["claim_mark_withdrawal_is_immutable", "claim_mark_withdrawal_cannot_be_deleted"],
  },
  claim_mark_declinations: {
    columns: ["id", "flow_key", "reason", "ref_sha", "session_id", "recorded_at"],
    triggers: ["claim_mark_declination_is_immutable", "claim_mark_declination_cannot_be_deleted"],
  },
};

// The enums SO1 added without a binding, and where SO2 binds them.
const BINDINGS = {
  narrative_section: ["narratives", "section"],
  narrative_disposition: ["narratives", "disposition"],
  claim_mark_kind: ["claim_marks", "kind"],
  territory_disposition: ["territory_dispositions", "disposition"],
  runtime_boundary_origin: ["runtime_boundaries", "origin"],
  explanation_disposition: ["explanations", "disposition"],
};

const LEGACY = ["axiomdb-shaped", "self-shaped"];

// A crash signature in a red run means the gate never reached its assertion,
// so quoted errors are scrubbed (as test-existing-store-migration.mjs does).
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
    console.log(`GATE SO2 RED: ${failures.length} of ${Math.max(checked, 1)} check(s) failed; first: ${failures[0].slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`${checked} check(s) held`);
  console.log("GATE SO2 GREEN");
  process.exit(0);
}

// --------------------------------------------------------------- loading

let Database;
let openDatabase;
try {
  Database = (await import("better-sqlite3")).default;
} catch (error) {
  finish(`better-sqlite3 cannot be loaded (run npm ci): ${error?.message ?? error}`);
}
if (!existsSync(join(here, "dist", "db.js"))) finish("dist/db.js is absent; run npm run build");
try {
  ({ openDatabase } = await import(pathToFileURL(join(here, "dist", "db.js")).href));
} catch (error) {
  finish(`dist/db.js cannot be loaded: ${error?.message ?? error}`);
}

const scratch = mkdtempSync(join(tmpdir(), "amanuensis-so2-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

// ------------------------------------------------------------- utilities

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function columnsOf(db, table) {
  return db.prepare("SELECT name FROM pragma_table_info(?)").all(table).map((r) => r.name);
}
function objectsOn(db, table) {
  return db
    .prepare("SELECT type, name FROM sqlite_master WHERE tbl_name = ? AND type IN ('index','trigger') ORDER BY type, name")
    .all(table)
    .map((r) => `${r.type}:${r.name}`);
}
function tablesOf(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}
function createSql(db, table) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql ?? "";
}

/** Every row of every table, over the given columns, order-free. */
function snapshot(db) {
  const out = {};
  for (const table of tablesOf(db)) {
    const columns = columnsOf(db, table);
    const quoted = columns.map((c) => `"${c}"`).join(", ");
    const rows = db.prepare(`SELECT ${quoted} FROM "${table}"`).raw().all();
    out[table] = {
      columns,
      count: rows.length,
      digest: sha256(rows.map((r) => JSON.stringify(r)).sort().join("\n")),
    };
  }
  return out;
}
function digestOver(db, table, columns) {
  const quoted = columns.map((c) => `"${c}"`).join(", ");
  const rows = db.prepare(`SELECT ${quoted} FROM "${table}"`).raw().all();
  return sha256(rows.map((r) => JSON.stringify(r)).sort().join("\n"));
}

/** A fixture's database, loaded from its committed dump into a scratch file. */
function loadFixture(name, label) {
  const dump = join(FIXTURES, name, "memory.sql");
  if (!existsSync(dump)) return { error: `fixtures/legacy-stores/${name}/memory.sql is absent` };
  const path = join(scratch, `${name}-${label}.db`);
  const db = new Database(path);
  try {
    db.exec(readFileSync(dump, "utf8"));
  } finally {
    db.close();
  }
  return { path };
}

function raises(db, sql, params = []) {
  try {
    db.prepare(sql).run(...params);
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}

const contract = (() => {
  try {
    return JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
  } catch {
    return null;
  }
})();
const enumValues = (name) => (contract?.enums?.[name]?.values ?? []).map((v) => v.value);

/**
 * Seed one valid row in every new table, and the rows they point at. Returns
 * the ids, or throws with the refusal: a schema that refuses valid input is red.
 */
function seedValid(db, tag) {
  const session = `so2-${tag}`;
  db.prepare("INSERT INTO sessions (session_id, intent) VALUES (?, 'GATE SO2 seed')").run(session);
  db.prepare("INSERT OR IGNORE INTO subsystems (id, name, status) VALUES ('SO2-A', 'Gate subsystem', 'structural')").run();
  const evidence = Number(
    db
      .prepare(
        "INSERT INTO evidence (file_path, ref_sha, kind, session_id) VALUES ('src/gate.ts', 'abc1234', 'code-verified', ?)",
      )
      .run(session).lastInsertRowid,
  );
  const claim = `SO2-A/flow/gate-${tag}/00`;
  db.prepare(
    `INSERT INTO claims (claim_id, claim_key, subject_type, subject_id, statement, epistemic_kind,
                         asserted_at_sha, valid_from_sha, session_id)
     VALUES (?, ?, 'file', 'src/gate.ts', 'The gate step starts the flow.', 'observation', 'abc1234', 'abc1234', ?)`,
  ).run(claim, claim, session);
  const narrative = Number(
    db
      .prepare(
        `INSERT INTO narratives (subject_type, subject_id, section, topic, disposition, body, ref_sha, session_id)
         VALUES ('subsystem', 'SO2-A', 'structure', 'gate dispatch', 'recorded', 'The gate dispatches one step.', 'abc1234', ?)`,
      )
      .run(session).lastInsertRowid,
  );
  db.prepare("INSERT INTO narrative_evidence (narrative_id, evidence_id) VALUES (?, ?)").run(narrative, evidence);
  const profile = Number(
    db
      .prepare("INSERT INTO project_profile (name, ref_sha, session_id) VALUES ('Gate project', 'abc1234', ?)")
      .run(session).lastInsertRowid,
  );
  const boundary = Number(
    db
      .prepare(
        `INSERT INTO runtime_boundaries (from_runtime, from_language, to_runtime, mechanism, notes, origin, ref_sha, session_id)
         VALUES ('server', 'TypeScript', 'materializer', 'subprocess', 'spawned per publish', 'recorded', 'abc1234', ?)`,
      )
      .run(session).lastInsertRowid,
  );
  db.prepare("INSERT INTO runtime_boundary_evidence (boundary_id, evidence_id) VALUES (?, ?)").run(boundary, evidence);
  const territory = Number(
    db
      .prepare(
        `INSERT INTO territory_dispositions (territory, disposition, condition, ref_sha, session_id)
         VALUES ('T07', 'disqualified', 'The project runs in one process.', 'abc1234', ?)`,
      )
      .run(session).lastInsertRowid,
  );
  const body = "# Gate survey\n\n| a | b |\n|---|---|\n";
  const imported = Number(
    db
      .prepare(
        `INSERT INTO imported_artifacts (path, kind, subsystem_id, body, body_sha256, registered_hash, hash_matches,
                                         registered_ref_sha, written_at, session_id)
         VALUES (?, 'subsystem-survey', 'SO2-A', ?, ?, ?, 1, 'abc1234', '2026-11-01 00:00:00', ?)`,
      )
      .run(`subsystems/SO2-A-${tag}.md`, body, sha256(body), sha256(body), session).lastInsertRowid,
  );
  const withdrawal = Number(
    db
      .prepare("INSERT INTO imported_artifact_withdrawals (path, reason, session_id) VALUES (?, 'reset by the gate', ?)")
      .run(`subsystems/SO2-A-${tag}.md`, session).lastInsertRowid,
  );
  const mark = Number(
    db
      .prepare(
        `INSERT INTO claim_marks (claim_id, kind, label, target, evidence_id, ref_sha, session_id)
         VALUES (?, 'trigger', NULL, NULL, ?, 'abc1234', ?)`,
      )
      .run(claim, evidence, session).lastInsertRowid,
  );
  const markWithdrawal = Number(
    db
      .prepare("INSERT INTO claim_mark_withdrawals (mark_id, reason, session_id) VALUES (?, 'recorded on the wrong step', ?)")
      .run(mark, session).lastInsertRowid,
  );
  const declination = Number(
    db
      .prepare(
        "INSERT INTO claim_mark_declinations (flow_key, reason, ref_sha, session_id) VALUES (?, 'This flow has no commit point.', 'abc1234', ?)",
      )
      .run(`SO2-A/flow/gate-${tag}`, session).lastInsertRowid,
  );
  return {
    session,
    evidence,
    claim,
    rows: {
      narratives: ["id", narrative],
      narrative_evidence: ["narrative_id", narrative],
      project_profile: ["id", profile],
      runtime_boundaries: ["id", boundary],
      runtime_boundary_evidence: ["boundary_id", boundary],
      territory_dispositions: ["id", territory],
      imported_artifacts: ["id", imported],
      imported_artifact_withdrawals: ["id", withdrawal],
      claim_marks: ["id", mark],
      claim_mark_withdrawals: ["id", markWithdrawal],
      claim_mark_declinations: ["id", declination],
    },
  };
}

// ------------------------------------------------------- per-store checks

/** The checks every migrated or fresh store must pass. `label` names the store. */
function storeChecks(label, path) {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  try {
    check(`${label}: every new table carries its columns`, () => {
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
      for (const column of ["territory", "probe"]) {
        if (!columnsOf(db, "concerns").includes(column)) wrong.push(`concerns lacks ${column}`);
      }
      return wrong.length ? wrong.join("; ") : null;
    });

    check(`${label}: every new table carries its trigger pair`, () => {
      const wrong = [];
      for (const [table, spec] of Object.entries(NEW_TABLES)) {
        const present = objectsOn(db, table);
        for (const trigger of spec.triggers) {
          if (!present.includes(`trigger:${trigger}`)) wrong.push(`${table} lacks ${trigger}`);
        }
      }
      return wrong.length ? wrong.join("; ") : null;
    });

    let seeded = null;
    check(`${label}: a valid row of every new table is accepted and reads back`, () => {
      seeded = seedValid(db, label.replace(/[^a-z0-9]+/gi, "-"));
      const wrong = [];
      for (const [table, [column, id]] of Object.entries(seeded.rows)) {
        const n = db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" = ?`).get(id).n;
        if (n !== 1) wrong.push(`${table} holds ${n} row(s) for ${column} = ${id}`);
      }
      const narrative = db.prepare("SELECT section, topic, disposition, body FROM narratives WHERE id = ?").get(seeded.rows.narratives[1]);
      if (narrative?.topic !== "gate dispatch" || narrative?.section !== "structure") {
        wrong.push(`the narrative reads back as ${JSON.stringify(narrative)}`);
      }
      const boundary = db.prepare("SELECT origin, withdrawn FROM runtime_boundaries WHERE id = ?").get(seeded.rows.runtime_boundaries[1]);
      if (boundary?.origin !== "recorded" || boundary?.withdrawn !== 0) {
        wrong.push(`the runtime boundary reads back as ${JSON.stringify(boundary)}; withdrawn must default to 0`);
      }
      return wrong.length ? wrong.join("; ") : null;
    });

    check(`${label}: an UPDATE and a DELETE raise on every new append-only table`, () => {
      if (!seeded) return "skipped: no row could be seeded";
      const wrong = [];
      for (const [table, [column, id]] of Object.entries(seeded.rows)) {
        const before = db.prepare(`SELECT * FROM "${table}" WHERE "${column}" = ?`).raw().all(id);
        const firstColumn = columnsOf(db, table).find((c) => c !== column) ?? column;
        const update = raises(db, `UPDATE "${table}" SET "${firstColumn}" = "${firstColumn}" WHERE "${column}" = ?`, [id]);
        const del = raises(db, `DELETE FROM "${table}" WHERE "${column}" = ?`, [id]);
        if (update === null || !/immutable/i.test(update)) wrong.push(`${table}: UPDATE ${update === null ? "succeeded" : `raised '${update}'`}`);
        if (del === null || !/cannot be deleted/i.test(del)) wrong.push(`${table}: DELETE ${del === null ? "succeeded" : `raised '${del}'`}`);
        const after = db.prepare(`SELECT * FROM "${table}" WHERE "${column}" = ?`).raw().all(id);
        if (JSON.stringify(before) !== JSON.stringify(after)) wrong.push(`${table}: the row changed`);
      }
      return wrong.length ? wrong.join("; ") : null;
    });

    check(`${label}: every value of each new enum is accepted, and an outside value refused`, () => {
      if (!seeded) return "skipped: no row could be seeded";
      const s = seeded.session;
      const wrong = [];
      const attempts = {
        narrative_section: (v) =>
          raises(db, `INSERT INTO narratives (subject_type, subject_id, section, disposition, body, ref_sha, session_id)
                      VALUES ('project', 'project', ?, 'recorded', 'Body.', 'abc1234', ?)`, [v, s]),
        narrative_disposition: (v) =>
          raises(db, `INSERT INTO narratives (subject_type, subject_id, section, disposition, body, ref_sha, session_id)
                      VALUES ('subsystem', 'SO2-A', 'structure', ?, 'Body.', 'abc1234', ?)`, [v, s]),
        claim_mark_kind: (v) =>
          raises(db, `INSERT INTO claim_marks (claim_id, kind, label, target, evidence_id, ref_sha, session_id)
                      VALUES (?, ?, 'a label', 'leaves-flow', ?, 'abc1234', ?)`, [seeded.claim, v, seeded.evidence, s]),
        territory_disposition: (v) =>
          raises(db, `INSERT INTO territory_dispositions (territory, disposition, condition, ref_sha, session_id)
                      VALUES ('T01', ?, 'A condition.', 'abc1234', ?)`, [v, s]),
        runtime_boundary_origin: (v) =>
          raises(db, `INSERT INTO runtime_boundaries (from_runtime, to_runtime, mechanism, origin, ref_sha, session_id)
                      VALUES ('a', 'b', 'pipe', ?, 'abc1234', ?)`, [v, s]),
      };
      for (const [name, attempt] of Object.entries(attempts)) {
        const values = enumValues(name);
        if (values.length === 0) {
          wrong.push(`the contract carries no ${name} values`);
          continue;
        }
        for (const value of values) {
          const refused = attempt(value);
          if (refused) wrong.push(`${name} '${value}' refused: ${refused}`);
        }
        if (attempt("not-a-value") === null) wrong.push(`${name} accepted 'not-a-value'`);
      }
      const nullSection = raises(
        db,
        `INSERT INTO narratives (subject_type, subject_id, section, disposition, body, ref_sha, session_id)
         VALUES ('subsystem', 'SO2-A', 'structure', 'recorded', '', 'abc1234', ?)`,
        [s],
      );
      if (nullSection === null) wrong.push("a narrative with an empty body was accepted");
      const longTopic = raises(
        db,
        `INSERT INTO narratives (subject_type, subject_id, section, topic, disposition, body, ref_sha, session_id)
         VALUES ('subsystem', 'SO2-A', 'structure', ?, 'recorded', 'Body.', 'abc1234', ?)`,
        ["t".repeat(121), s],
      );
      if (longTopic === null) wrong.push("a narrative topic of 121 characters was accepted");
      const noCondition = raises(
        db,
        `INSERT INTO territory_dispositions (territory, disposition, ref_sha, session_id)
         VALUES ('T02', 'disqualified', 'abc1234', ?)`,
        [s],
      );
      if (noCondition === null) wrong.push("a disqualified territory without a condition was accepted");
      const badMatch = raises(
        db,
        `INSERT INTO imported_artifacts (path, kind, body, body_sha256, hash_matches, session_id)
         VALUES ('x.md', 'field-notes', 'x', ?, 2, ?)`,
        [sha256("x"), s],
      );
      if (badMatch === null) wrong.push("an imported artifact with hash_matches = 2 was accepted");
      const otherKind = raises(
        db,
        `INSERT INTO imported_artifacts (path, kind, body, body_sha256, hash_matches, session_id)
         VALUES ('y.md', 'other', 'y', ?, 1, ?)`,
        [sha256("y"), s],
      );
      if (otherKind === null) wrong.push("an imported artifact of kind 'other' (a server export) was accepted");
      const badWithdrawn = raises(
        db,
        `INSERT INTO runtime_boundaries (from_runtime, to_runtime, mechanism, origin, withdrawn, ref_sha, session_id)
         VALUES ('a', 'b', 'pipe', 'recorded', 2, 'abc1234', ?)`,
        [s],
      );
      if (badWithdrawn === null) wrong.push("a runtime boundary with withdrawn = 2 was accepted");
      return wrong.length ? wrong.join("; ") : null;
    });

    check(`${label}: the schema accepts a project purpose and an imported one, and refuses an imported subsystem row`, () => {
      if (!seeded) return "skipped: no row could be seeded";
      const s = seeded.session;
      const wrong = [];
      const insert = (subjectType, subjectId, slot, disposition) =>
        raises(
          db,
          `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
           VALUES (?, ?, ?, ?, 'The project stores a survey of a codebase.', 'abc1234', ?)`,
          [subjectType, subjectId, slot, disposition, s],
        );
      for (const [args, want] of [
        [["project", "project", "purpose", "recorded"], "accepted"],
        [["project", "project", "purpose", "imported"], "accepted"],
        [["project", "project", "account", "recorded"], "accepted"],
        [["subsystem", "SO2-A", "purpose", "recorded"], "accepted"],
        [["subsystem", "SO2-A", "purpose", "imported"], "refused"],
        [["project", "project", "account", "imported"], "refused"],
        [["project", "SO2-A", "purpose", "recorded"], "refused"],
      ]) {
        const refused = insert(...args);
        if (want === "accepted" && refused) wrong.push(`${args.join("/")} refused: ${refused}`);
        if (want === "refused" && refused === null) wrong.push(`${args.join("/")} accepted`);
      }
      const read = db
        .prepare("SELECT disposition FROM explanations WHERE subject_type='project' AND slot='purpose' ORDER BY id")
        .all()
        .map((r) => r.disposition)
        .join(",");
      if (!read.endsWith("recorded,imported")) wrong.push(`project purposes read back as [${read}]`);
      return wrong.length ? wrong.join("; ") : null;
    });

    return seeded;
  } finally {
    db.close();
  }
}

// ------------------------------------------------------------ the gate body

check("the contract binds each new enum to its column and carries `imported`", () => {
  if (!contract) return "contracts/conspectus-vocabulary.json is unreadable";
  const wrong = [];
  for (const [name, [table, column]] of Object.entries(BINDINGS)) {
    const decl = contract.enums?.[name];
    if (!decl) {
      wrong.push(`${name} is absent`);
      continue;
    }
    if (!(decl.sql ?? []).some((b) => b.table === table && b.column === column)) {
      wrong.push(`${name} has no sql binding to ${table}.${column}`);
    }
  }
  const disposition = enumValues("explanation_disposition");
  if (JSON.stringify(disposition) !== JSON.stringify(["recorded", "declined", "withdrawn", "imported"])) {
    wrong.push(`explanation_disposition is [${disposition.join(", ")}], not recorded, declined, withdrawn, imported`);
  }
  const imported = contract.enums?.explanation_disposition?.values?.find((v) => v.value === "imported");
  for (const field of ["label", "meaning", "cannot_justify"]) {
    if (imported && !(typeof imported[field] === "string" && imported[field].trim())) wrong.push(`imported carries no ${field}`);
  }
  return wrong.length ? wrong.join("; ") : null;
});

check("contracts/append-only-tables.txt lists every new table with its trigger pair", () => {
  const rows = new Map();
  for (const line of readFileSync(APPEND_ONLY_PATH, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [table, immutable, undeletable] = trimmed.split(/\s+/);
    rows.set(table, `${immutable} ${undeletable}`);
  }
  const wrong = [];
  for (const [table, spec] of Object.entries(NEW_TABLES)) {
    const want = spec.triggers.join(" ");
    if (rows.get(table) !== want) wrong.push(`${table}: ${rows.has(table) ? `lists '${rows.get(table)}'` : "absent"}`);
  }
  const header = /^# (\d+) tables\.$/m.exec(readFileSync(APPEND_ONLY_PATH, "utf8"));
  if (!header || Number(header[1]) !== rows.size) wrong.push(`the header says ${header?.[1] ?? "nothing"} tables and the file lists ${rows.size}`);
  return wrong.length ? wrong.join("; ") : null;
});

// The fresh store.
const freshPath = join(scratch, "fresh.db");
let freshOpened = false;
check("a fresh store opens", () => {
  openDatabase(freshPath).close();
  freshOpened = true;
  return null;
});
if (freshOpened) storeChecks("fresh store", freshPath);

// The legacy fixtures.
const migrated = {};
for (const name of LEGACY) {
  const loaded = loadFixture(name, "copy");
  if (loaded.error) {
    check(`${name}: the fixture loads`, () => loaded.error);
    continue;
  }
  const path = loaded.path;

  // An index and a trigger schema.sql does not declare. `initializeSchema`
  // re-creates the declared ones after any rebuild, so without these a rebuild
  // that dropped every object of the table would pass unnoticed (as GATE XS1's
  // M4 found for `dispositions`).
  {
    const db = new Database(path);
    try {
      db.exec("CREATE INDEX idx_so2_explanations_probe ON explanations(ref_sha)");
      db.exec(
        "CREATE TRIGGER so2_explanations_probe BEFORE INSERT ON explanations FOR EACH ROW " +
          "WHEN NEW.body = 'so2 probe: refuse me' BEGIN SELECT RAISE(ABORT, 'so2 probe'); END",
      );
    } finally {
      db.close();
    }
  }

  // Shape and age, on the unmigrated copy.
  let before = null;
  let explanationsBefore = null;
  {
    const db = new Database(path, { readonly: true });
    try {
      check(`${name}: the fixture is on the base tree's schema`, () => {
        const wrong = [];
        if (columnsOf(db, "narratives").length > 0) wrong.push("it already holds narratives");
        if (columnsOf(db, "concerns").includes("territory")) wrong.push("concerns already carries territory");
        if (!/slot\s*=\s*'account'/.test(createSql(db, "explanations"))) {
          wrong.push("its explanations table does not carry the CHECK that forbids a project purpose");
        }
        if (db.prepare("SELECT COUNT(*) AS n FROM explanations").get().n === 0) wrong.push("it holds no explanations to carry through the rebuild");
        const objects = objectsOn(db, "explanations");
        for (const object of ["index:idx_explanations_subject", "index:idx_so2_explanations_probe", "trigger:explanation_is_immutable", "trigger:explanation_cannot_be_deleted", "trigger:so2_explanations_probe"]) {
          if (!objects.includes(object)) wrong.push(`its explanations table lacks ${object}`);
        }
        return wrong.length ? wrong.join("; ") : null;
      });
      check(`${name}: the fixture keeps the shape later packets rely on`, () => fixtureShape(name, db));
      before = snapshot(db);
      explanationsBefore = {
        columns: columnsOf(db, "explanations"),
        objects: objectsOn(db, "explanations"),
        digest: digestOver(db, "explanations", columnsOf(db, "explanations")),
        evidence: digestOver(db, "explanation_evidence", columnsOf(db, "explanation_evidence")),
      };
    } finally {
      db.close();
    }
  }

  let opened = false;
  check(`${name}: the new server opens the fixture, twice`, () => {
    openDatabase(path).close();
    openDatabase(path).close();
    opened = true;
    return null;
  });
  if (!opened) continue;

  {
    const db = new Database(path, { readonly: true });
    try {
      check(`${name}: no existing table loses or changes a row`, () => {
        const wrong = [];
        for (const [table, was] of Object.entries(before)) {
          const columns = columnsOf(db, table);
          if (columns.length === 0) {
            wrong.push(`${table} is gone`);
            continue;
          }
          const count = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
          if (count !== was.count) wrong.push(`${table} went from ${was.count} to ${count} row(s)`);
          else if (digestOver(db, table, was.columns.filter((c) => columns.includes(c))) !== was.digest) {
            wrong.push(`${table}'s ${count} row(s) changed`);
          }
          const lost = was.columns.filter((c) => !columns.includes(c));
          if (lost.length) wrong.push(`${table} lost column(s) ${lost.join(", ")}`);
        }
        return wrong.length ? wrong.join("; ") : null;
      });
      check(`${name}: the rebuilt explanations keeps every row, column, index and trigger`, () => {
        const wrong = [];
        const columns = columnsOf(db, "explanations");
        if (columns.join(",") !== explanationsBefore.columns.join(",")) wrong.push(`columns are ${columns.join(",")}`);
        const objects = objectsOn(db, "explanations");
        const lost = explanationsBefore.objects.filter((o) => !objects.includes(o));
        if (lost.length) wrong.push(`lost ${lost.join(", ")}`);
        if (digestOver(db, "explanations", columns) !== explanationsBefore.digest) wrong.push("its rows changed");
        if (digestOver(db, "explanation_evidence", columnsOf(db, "explanation_evidence")) !== explanationsBefore.evidence) {
          wrong.push("explanation_evidence changed");
        }
        if (/slot\s*=\s*'account'/.test(createSql(db, "explanations"))) wrong.push("it still forbids a project purpose");
        if (db.pragma("foreign_key_check").length > 0) wrong.push("the store has foreign-key violations");
        return wrong.length ? wrong.join("; ") : null;
      });
    } finally {
      db.close();
    }
  }
  const seeded = storeChecks(name, path);
  migrated[name] = { path, seeded };
}

/** The shape §8 says each fixture has, read from its rows and files. */
function fixtureShape(name, db) {
  const storage = join(FIXTURES, name, "storage");
  const wrong = [];
  const artifacts = db.prepare("SELECT path, kind, content_hash, bytes FROM artifacts ORDER BY path").all();
  const surveys = artifacts.filter((a) => a.kind === "subsystem-survey");
  if (surveys.length < 2) wrong.push(`${surveys.length} survey bodies`);
  const mismatched = [];
  for (const artifact of artifacts) {
    const file = join(storage, artifact.path);
    if (!existsSync(file)) {
      wrong.push(`${artifact.path} has no committed file`);
      continue;
    }
    if (sha256(readFileSync(file)) !== artifact.content_hash) mismatched.push(artifact.path);
  }
  const claims = db.prepare("SELECT COUNT(*) AS n FROM claims").get().n;
  if (name === "axiomdb-shaped") {
    if (claims !== 0) wrong.push(`${claims} claims, not 0`);
    if (db.prepare("SELECT COUNT(*) AS n FROM seams").get().n === 0) wrong.push("no seams");
    if (JSON.stringify(mismatched) !== JSON.stringify(["entry-point.md"])) {
      wrong.push(`files differing from their registered hash: [${mismatched.join(", ")}], not [entry-point.md]`);
    }
    const kinds = new Set(artifacts.map((a) => a.kind));
    for (const kind of ["onboarding-report", "entry-point", "master-plan", "findings-index", "concern-checklist", "field-notes"]) {
      if (!kinds.has(kind)) wrong.push(`no ${kind} artifact`);
    }
    const shaped = surveys.filter((a) => {
      const text = readFileSync(join(storage, a.path), "utf8");
      return /^\|.*\|\s*$/m.test(text) && /^```/m.test(text);
    });
    if (shaped.length === 0) wrong.push("no survey body carries both a table and a fence");
  } else {
    if (claims === 0) wrong.push("no claims");
    if (mismatched.length) wrong.push(`files differing from their registered hash: ${mismatched.join(", ")}`);
    const outside = surveys.filter((a) => !a.path.startsWith("subsystems/"));
    if (outside.length) wrong.push(`survey bodies outside subsystems/: ${outside.map((a) => a.path).join(", ")}`);
  }
  return wrong.length ? wrong.join("; ") : null;
}

// The base tree's server, on stores the new server migrated (§5.1, D16).
const smokeTargets = [["fresh store", freshPath], ...Object.entries(migrated).map(([n, m]) => [n, m.path])].filter(
  ([, p]) => existsSync(p),
);
let base = null;
{
  const helperPath = join(here, "fixtures", "base-tree-server.mjs");
  if (existsSync(helperPath)) {
    try {
      const { buildBaseTreeServer } = await import(pathToFileURL(helperPath).href);
      base = buildBaseTreeServer(BASE_SHA);
    } catch (error) {
      base = { ok: false, reason: `fixtures/base-tree-server.mjs cannot be loaded: ${error?.message ?? error}` };
    }
  } else {
    base = { ok: false, reason: "fixtures/base-tree-server.mjs is absent" };
  }
}
if (base?.ok) process.on("exit", () => base.cleanup());
check("the base tree's server builds from the packet's start commit", () => (base?.ok ? null : base?.reason));

check("the base tree predates the store-only schema", () => {
  if (!base?.ok) return base?.reason ?? "no base tree";
  const schema = readFileSync(join(base.root, "src", "schema.sql"), "utf8");
  if (/CREATE TABLE IF NOT EXISTS narratives\b/.test(schema)) return `${BASE_SHA.slice(0, 12)} already declares narratives`;
  return null;
});

const SMOKE = `
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const [root, dbPath] = process.argv.slice(2);
const load = (p) => import(pathToFileURL(join(root, "dist", p)).href);
const { openDatabase } = await load("db.js");
const tools = [
  ...(await load("tools/subsystems.js")).subsystemTools,
  ...(await load("tools/artifacts.js")).artifactTools,
  ...(await load("tools/seams.js")).seamTools,
  ...(await load("tools/dashboard.js")).dashboardTools,
  ...(await load("tools/explanations.js")).explanationTools,
];
const db = openDatabase(dbPath);
const ctx = { project: { workspacePath: null, projectKey: "so2/base", storagePath: root, dbPath, storageGitReady: false }, db, sessionId: null };
const call = (name, args = {}) => tools.find((t) => t.name === name).handler(args, ctx);
const unwrap = (r) => (r && typeof r === "object" && "structuredContent" in r ? r.structuredContent : r);
const out = {
  subsystems: unwrap(call("list_subsystems")),
  artifacts: unwrap(call("list_artifacts")),
  seams: unwrap(call("list_seams")),
  dashboard: unwrap(call("get_dashboard")),
  project: unwrap(call("get_explanations", { subject_type: "project" })),
};
db.close();
process.stdout.write(JSON.stringify(out));
`;
const smokePath = join(scratch, "base-smoke.mjs");
writeFileSync(smokePath, SMOKE);

const countOf = (value) =>
  Array.isArray(value) ? value.length : Array.isArray(value?.items) ? value.items.length : Array.isArray(value?.rows) ? value.rows.length : null;

for (const [label, path] of smokeTargets) {
  check(`${label}: the base tree's server opens and reads the migrated store`, () => {
    if (!base?.ok) return base?.reason ?? "no base tree";
    const want = (() => {
      const db = new Database(path, { readonly: true });
      try {
        return {
          subsystems: db.prepare("SELECT COUNT(*) AS n FROM subsystems").get().n,
          artifacts: db.prepare("SELECT COUNT(*) AS n FROM artifacts").get().n,
          seams: db.prepare("SELECT COUNT(*) AS n FROM seams").get().n,
          tables: Object.fromEntries(
            Object.keys(NEW_TABLES).map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]),
          ),
          explanations: db.prepare("SELECT COUNT(*) AS n FROM explanations").get().n,
          subsystemIds: db.prepare("SELECT id FROM subsystems ORDER BY id").all().map((r) => r.id).join(","),
          projectAccount:
            db.prepare("SELECT MAX(id) AS id FROM explanations WHERE subject_type = 'project' AND slot = 'account'").get().id ?? null,
        };
      } finally {
        db.close();
      }
    })();
    const run = spawnSync(process.execPath, [smokePath, base.root, path], { encoding: "utf8", cwd: base.root });
    if (run.status !== 0) return `it exited ${run.status}: ${`${run.stderr}`.trim().split("\n").slice(0, 3).join(" | ")}`;
    let out;
    try {
      out = JSON.parse(run.stdout);
    } catch {
      return `it printed no reading: ${run.stdout.slice(0, 200)}`;
    }
    const wrong = [];
    if (countOf(out.subsystems) !== want.subsystems) wrong.push(`list_subsystems read ${countOf(out.subsystems)}, the store holds ${want.subsystems}`);
    if (countOf(out.artifacts) !== want.artifacts) wrong.push(`list_artifacts read ${countOf(out.artifacts)}, the store holds ${want.artifacts}`);
    if (countOf(out.seams) !== want.seams) wrong.push(`list_seams read ${countOf(out.seams)}, the store holds ${want.seams}`);
    if (out.dashboard?.subsystem_count !== want.subsystems) wrong.push(`get_dashboard counted ${out.dashboard?.subsystem_count} subsystems`);
    const ids = Array.isArray(out.subsystems) ? out.subsystems.map((r) => r.id).sort().join(",") : null;
    if (ids !== want.subsystemIds) wrong.push(`list_subsystems read [${ids}], the store holds [${want.subsystemIds}]`);
    const account = Array.isArray(out.project?.slots) ? out.project.slots.find((slot) => slot.slot === "account") : null;
    if (!account) wrong.push(`get_explanations(project) read ${JSON.stringify(out.project).slice(0, 120)}`);
    else if (want.projectAccount === null) wrong.push("the store holds no project account for the base server to read");
    else if (account.state !== "recorded" || account.row?.id !== want.projectAccount) {
      wrong.push(`get_explanations(project) read the account as ${account.state}, row ${account.row?.id}; the newest is ${want.projectAccount}`);
    }
    // The new server reopens what the old one opened, with the new rows intact.
    try {
      openDatabase(path).close();
    } catch (error) {
      wrong.push(`the new server cannot reopen it: ${error?.message ?? error}`);
      return wrong.join("; ");
    }
    const db = new Database(path, { readonly: true });
    try {
      for (const [table, n] of Object.entries(want.tables)) {
        const now = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
        if (now !== n) wrong.push(`${table} went from ${n} to ${now} row(s) across the base open`);
      }
      const explanations = db.prepare("SELECT COUNT(*) AS n FROM explanations").get().n;
      if (explanations !== want.explanations) wrong.push(`explanations went from ${want.explanations} to ${explanations}`);
      if (/slot\s*=\s*'account'/.test(createSql(db, "explanations"))) wrong.push("the base open narrowed explanations again");
    } finally {
      db.close();
    }
    return wrong.length ? wrong.join("; ") : null;
  });
}
if (smokeTargets.length < 3) {
  check("the base tree's server is checked against all three stores", () => `only ${smokeTargets.length} store(s) reached the check`);
}

finish();
