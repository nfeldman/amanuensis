#!/usr/bin/env node
// GATE SO7 (design/store-only/PLAN.md §5.2, §5.3, §8 SO7) — every artifact's
// bytes are imported into the store.
//
// An earlier version had the survey write its prose as Markdown files under
// storage and register each one. `import_artifact_bodies` copies every
// registered hand-written file into `imported_artifacts` as written, with its
// hash and whether that still matches the registered one, and extracts three
// things with the materializer's own functions: the thesis (`read_thesis`) as
// an `imported` project purpose, the project name (the `**Codebase**:` line) as
// a `project_profile` row, and the runtime boundary table
// (`_runtime_boundary_table`) as `imported` runtime boundaries. Nothing else is
// parsed, and no file is written, moved or deleted.
//
// Turns red when (PLAN §8 SO7), on copies of both committed legacy fixtures:
//   - any imported body differs from its file's bytes, or its sha256 from theirs,
//     or a registered hand-written artifact is not imported;
//   - `hash_matches` is wrong: the AxiomDB-shaped entry point 0, every other row
//     1; or the registered hash, revision or date is not the `artifacts` row's;
//   - the imported thesis differs from what `read_thesis` returns on the same
//     storage, is not the effective project purpose, or is imported twice;
//   - the imported runtime rows differ from `_runtime_boundary_table`'s rows;
//   - the project name differs from the `**Codebase**:` line;
//   - any claim, concern or narrative row is created (or any evidence,
//     disposition, finding or field note);
//   - a second run imports anything;
//   - any artifact file under storage changes, or a file appears (the database
//     and WAL files are expected to change);
//   - a missing file, or a path that escapes storage, stops the rest, is
//     imported, or is not reported;
//   - a dry run writes anything or does not report what it would import;
//   - a recorded purpose or name is overwritten by an imported one.
// Controls (an import that refuses everything must be red): both fixtures
// import every registered file, and the import refuses without a session.
//
// The gate loads each fixture's committed dump into a scratch database inside a
// copy of its storage directory, in a temporary directory, and drives the built
// handlers. It reads no real store.
//
//   exit 0  `GATE SO7 GREEN`          — every assertion held
//   exit 1  `GATE SO7 RED: <reason>`  — the first assertion that failed

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "fixtures", "legacy-stores");
const MATERIALIZER = join(here, "..", "materializer");
const TOOL = "import_artifact_bodies";

// A crash signature in this gate's output means the run never reached its
// assertion. Assertion detail is quoted from live errors, so it is scrubbed.
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
  "Traceback (most recent call last)",
  "NameError",
  "AttributeError",
  "No such file or directory",
  "is not defined",
];
function elide(signature) {
  const cut = Math.ceil(signature.length / 2);
  return `${signature.slice(0, cut)}…${signature.slice(cut)}`;
}
function scrub(text) {
  let out = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  for (const signature of CRASH_SIGNATURES) out = out.split(signature).join(elide(signature));
  return out.length > 400 ? `${out.slice(0, 400)}…` : out;
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

/** Run `fn`, returning its refusal message, or null when it did not refuse. */
function refusal(fn) {
  try {
    const value = fn();
    if (value && typeof value === "object" && value.ok === false && value.error) {
      return String(value.error);
    }
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const HAND_WRITTEN = [
  "onboarding-report",
  "entry-point",
  "master-plan",
  "findings-index",
  "concern-checklist",
  "field-notes",
  "subsystem-survey",
  "seam-assessment",
  "dispatch-prompt",
];

/** Tables the import must not write to (PLAN §5.2 step 2: nothing else is parsed). */
const UNTOUCHED_TABLES = [
  "claims",
  "claim_evidence",
  "concerns",
  "narratives",
  "narrative_evidence",
  "evidence",
  "dispositions",
  "findings",
  "field_notes",
  "explanation_evidence",
  "runtime_boundary_evidence",
  "territory_dispositions",
  "imported_artifact_withdrawals",
];

/** Tables the import writes; a second run must leave every count where it was. */
const IMPORT_TABLES = ["imported_artifacts", "explanations", "project_profile", "runtime_boundaries"];

/** Every file under `root` with its bytes, the database files and any storage-git directory left out. */
function storageFiles(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === ".git") continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (!/^memory\.db(-wal|-shm|-journal)?$/.test(name)) out.set(relative(root, full), sha256(readFileSync(full)));
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}
function sameFiles(before, after) {
  for (const [path, digest] of before) {
    if (!after.has(path)) return `${path} is gone`;
    if (after.get(path) !== digest) return `${path} changed`;
  }
  for (const path of after.keys()) if (!before.has(path)) return `${path} appeared`;
  return null;
}

function counts(db, tables) {
  const out = {};
  for (const table of tables) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    out[table] = exists ? db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n : null;
  }
  return out;
}
function countDiff(before, after) {
  const moved = Object.keys(before).filter((t) => before[t] !== after[t]);
  return moved.length ? moved.map((t) => `${t} ${before[t]}→${after[t]}`).join(", ") : null;
}

/**
 * What the materializer's own functions read from a storage directory: the
 * thesis `read_thesis` returns, and the runtime boundary table
 * `_runtime_boundary_table` extracts from the onboarding report. The gate asks
 * them directly, so the import is compared with the rule and not with a copy.
 */
function materializerReading(storage) {
  const python = process.env.AMANUENSIS_PYTHON ?? "python3";
  const result = spawnSync(
    python,
    [
      "-I",
      "-c",
      [
        "import json, sys",
        "from pathlib import Path",
        "sys.path.insert(0, sys.argv[1])",
        "from amanuensis_materializer.renderers import read_thesis",
        "from amanuensis_materializer.diagrams import _runtime_boundary_table",
        "storage = Path(sys.argv[2])",
        "thesis = read_thesis(storage)",
        "report = storage / 'onboarding-report.md'",
        "table = _runtime_boundary_table(report.read_text() if report.is_file() else '')",
        "print(json.dumps({'state': thesis.state, 'text': thesis.text, 'table': table}))",
      ].join("\n"),
      MATERIALIZER,
      storage,
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`the materializer could not be read: ${result.error?.message ?? result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

/** The rows of a Markdown table as `_table_cells` splits them, header and separator dropped. */
function tableRows(table) {
  return table
    .split("\n")
    .slice(2)
    .map((line) =>
      line
        .trim()
        .replace(/^\|+|\|+$/g, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
}

/** The project name the `**Codebase**:` line carries, as `project_name` reads it. */
function codebaseLine(storage) {
  const report = join(storage, "onboarding-report.md");
  if (!existsSync(report)) return null;
  for (const line of readFileSync(report, "utf8").split("\n")) {
    if (line.startsWith("**Codebase**:")) {
      const value = line.slice(line.indexOf(":") + 1).trim().split(" — ")[0].trim();
      return value || null;
    }
  }
  return null;
}

// --------------------------------------------------------------- the gate body

async function main(mods) {
  const { openDatabase, Database, toolArrays } = mods;
  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  const call = (name, args, ctx) => {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    return td.handler(args, ctx);
  };

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-so7-"));
  const opened = [];

  /**
   * A copy of one legacy fixture: its storage directory, and its committed dump
   * loaded into `memory.db` inside that copy (where a real store keeps it), then
   * opened by the new server, which migrates it. `shape` edits the copy first.
   */
  function world(name, label, shape) {
    const root = join(scratch, `${name}-${label}`);
    const storage = join(root, "storage");
    mkdirSync(root, { recursive: true });
    cpSync(join(FIXTURES, name, "storage"), storage, { recursive: true });
    const dbPath = join(storage, "memory.db");
    const raw = new Database(dbPath);
    try {
      raw.exec(readFileSync(join(FIXTURES, name, "memory.sql"), "utf8"));
      shape?.(raw, storage, root);
    } finally {
      raw.close();
    }
    const db = openDatabase(dbPath);
    opened.push(db);
    const project = {
      workspacePath: join(root, "workspace"),
      projectKey: `so7-${name}-${label}`,
      storagePath: storage,
      dbPath,
      storageGitReady: false,
    };
    const ctx = { project, db, sessionId: null };
    return { ctx, storage, db, root };
  }
  const session = (ctx, label) => call("start_session", { intent: `so7-${label}` }, ctx).session_id;

  const registered = (db) =>
    db
      .prepare(
        `SELECT path, kind, subsystem_id, content_hash, ref_sha, written_at FROM artifacts
          WHERE kind IN (${HAND_WRITTEN.map(() => "?").join(", ")}) ORDER BY path`,
      )
      .all(...HAND_WRITTEN);
  const importedRows = (db) =>
    db.prepare("SELECT * FROM imported_artifacts ORDER BY path").all();

  // ------------------------------------------------------- both fixtures, whole

  for (const name of ["axiomdb-shaped", "self-shaped"]) {
    const tag = name === "axiomdb-shaped" ? "A" : "S";
    const { ctx, storage, db } = world(name, "whole");
    const filesBefore = storageFiles(storage);
    const reading = materializerReading(storage);
    const expectedName = codebaseLine(storage);
    const rows = registered(db);

    check(`${tag}0 ${name}: the fixture registers hand-written files`, () =>
      rows.length >= 8 ? null : `only ${rows.length} registered row(s)`,
    );

    check(`${tag}1 ${name}: the import refuses without an active session`, () => {
      const message = refusal(() => call(TOOL, {}, ctx));
      if (message === null) return "it was accepted with no session";
      if (!message.startsWith(TOOL)) return `the refusal does not start with the tool's name: ${message}`;
      return importedRows(db).length === 0 ? null : "a refused run wrote imported rows";
    });

    const sessionId = session(ctx, name);
    const untouchedBefore = counts(db, UNTOUCHED_TABLES);
    const importBefore = counts(db, IMPORT_TABLES);

    let dry = null;
    check(`${tag}2 ${name}: a dry run reports every file and writes nothing`, () => {
      dry = call(TOOL, { dry_run: true }, ctx);
      const after = counts(db, IMPORT_TABLES);
      const moved = countDiff(importBefore, after);
      if (moved) return `the dry run wrote: ${moved}`;
      const would = (dry?.imported ?? []).map((r) => r.path).sort();
      const want = rows.map((r) => r.path).sort();
      if (JSON.stringify(would) !== JSON.stringify(want)) {
        return `it reports ${JSON.stringify(would)}, expected ${JSON.stringify(want)}`;
      }
      return dry?.dry_run === true ? null : "the response does not say it was a dry run";
    });

    let first = null;
    check(`${tag}3 ${name}: the import runs`, () => {
      first = call(TOOL, {}, ctx);
      return first?.ok === true ? null : `it answered ${JSON.stringify(first)}`;
    });

    const imported = importedRows(db);
    const byPath = new Map(imported.map((r) => [r.path, r]));

    check(`${tag}4 ${name}: every registered file is imported with its bytes`, () => {
      if (imported.length !== rows.length) return `${imported.length} imported row(s) for ${rows.length} registered`;
      for (const reg of rows) {
        const row = byPath.get(reg.path);
        if (!row) return `${reg.path} was not imported`;
        const bytes = readFileSync(join(storage, reg.path));
        if (!Buffer.from(row.body, "utf8").equals(bytes)) return `${reg.path}: the imported body differs from the file's bytes`;
        if (row.body_sha256 !== sha256(bytes)) return `${reg.path}: body_sha256 is not the file's sha256`;
        if (row.kind !== reg.kind) return `${reg.path}: kind ${row.kind}, registered ${reg.kind}`;
        if ((row.subsystem_id ?? null) !== (reg.subsystem_id ?? null)) return `${reg.path}: subsystem ${row.subsystem_id}`;
        if (row.session_id !== sessionId) return `${reg.path}: session ${row.session_id}, not the import's`;
      }
      return null;
    });

    check(`${tag}5 ${name}: hash_matches and the registered provenance are the artifacts row's`, () => {
      for (const reg of rows) {
        const row = byPath.get(reg.path);
        if (!row) return `${reg.path} was not imported`;
        const want = name === "axiomdb-shaped" && reg.kind === "entry-point" ? 0 : 1;
        if (row.hash_matches !== want) return `${reg.path}: hash_matches ${row.hash_matches}, expected ${want}`;
        if (row.hash_matches !== (row.registered_hash === row.body_sha256 ? 1 : 0)) {
          return `${reg.path}: hash_matches disagrees with the two hashes`;
        }
        if (row.registered_hash !== reg.content_hash) return `${reg.path}: registered_hash is not artifacts.content_hash`;
        if (row.registered_ref_sha !== reg.ref_sha) return `${reg.path}: registered_ref_sha is not artifacts.ref_sha`;
        if (row.written_at !== reg.written_at) return `${reg.path}: written_at is not artifacts.written_at`;
      }
      const reported = (first?.imported ?? []).find((r) => r.kind === "entry-point");
      if (name === "axiomdb-shaped" && reported?.hash_matches !== 0) {
        return "the response does not report the entry point's mismatch";
      }
      return null;
    });

    check(`${tag}6 ${name}: the thesis is what read_thesis returns, as the project's imported purpose`, () => {
      if (reading.state !== "filled") return `the fixture's thesis reads ${reading.state}`;
      const purposes = db
        .prepare("SELECT * FROM explanations WHERE subject_type = 'project' AND slot = 'purpose' ORDER BY id")
        .all();
      if (purposes.length !== 1) return `${purposes.length} project purpose row(s)`;
      const [row] = purposes;
      if (row.disposition !== "imported") return `the purpose's disposition is ${row.disposition}`;
      if (row.body !== reading.text) return `the imported thesis ${JSON.stringify(row.body)} is not read_thesis's ${JSON.stringify(reading.text)}`;
      const entry = rows.find((r) => r.kind === "entry-point");
      if (row.ref_sha !== entry.ref_sha) return `the purpose's revision ${row.ref_sha} is not the entry point's ${entry.ref_sha}`;
      if (row.session_id !== sessionId) return "the purpose is not the import session's";
      const read = call("get_explanations", { subject_type: "project" }, ctx);
      const slot = (read?.slots ?? []).find((s) => s.slot === "purpose");
      if (slot?.state !== "recorded" || slot?.row?.id !== row.id) {
        return `get_explanations reads the purpose as ${slot?.state} (row ${slot?.row?.id})`;
      }
      return null;
    });

    check(`${tag}7 ${name}: the thesis is the whole section, not its first line`, () => {
      const row = db.prepare("SELECT body FROM explanations WHERE disposition = 'imported'").get();
      const want = name === "axiomdb-shaped" ? "Two ideas explain most of the design" : "Scribe records what a survey";
      return row?.body?.includes(want) ? null : `the imported thesis does not carry "${want}"`;
    });

    check(`${tag}8 ${name}: the runtime rows are _runtime_boundary_table's`, () => {
      if (!reading.table) return "the fixture's onboarding report has no runtime table";
      const want = tableRows(reading.table).map(([from, language, to, mechanism, notes]) => ({
        from_runtime: from,
        from_language: language || null,
        to_runtime: to,
        mechanism,
        notes: notes || null,
      }));
      const got = db
        .prepare(
          "SELECT from_runtime, from_language, to_runtime, mechanism, notes, origin, withdrawn, session_id, ref_sha FROM runtime_boundaries ORDER BY id",
        )
        .all();
      if (got.length !== want.length) return `${got.length} runtime row(s), the table has ${want.length}`;
      const report = rows.find((r) => r.kind === "onboarding-report");
      for (let i = 0; i < want.length; i++) {
        const g = got[i];
        for (const key of Object.keys(want[i])) {
          if (g[key] !== want[i][key]) return `row ${i + 1} ${key}: ${JSON.stringify(g[key])}, the table says ${JSON.stringify(want[i][key])}`;
        }
        if (g.origin !== "imported" || g.withdrawn !== 0) return `row ${i + 1} is ${g.origin}, withdrawn ${g.withdrawn}`;
        if (g.session_id !== sessionId) return `row ${i + 1} is not the import session's`;
        if (g.ref_sha !== report.ref_sha) return `row ${i + 1} revision ${g.ref_sha} is not the onboarding report's`;
      }
      const map = call("get_runtime_boundaries", {}, ctx);
      const effective = map?.rows ?? map?.boundaries ?? [];
      return effective.length === want.length ? null : `get_runtime_boundaries lists ${effective.length} edge(s)`;
    });

    check(`${tag}9 ${name}: the project name is the codebase line's`, () => {
      const want = name === "axiomdb-shaped" ? "Quadstore" : "Scribe";
      if (expectedName !== want) return `the gate read ${expectedName} from the fixture`;
      const profile = db.prepare("SELECT name, ref_sha, session_id FROM project_profile").all();
      if (profile.length !== 1) return `${profile.length} project_profile row(s)`;
      if (profile[0].name !== want) return `the imported name is ${JSON.stringify(profile[0].name)}, the line says ${want}`;
      const report = rows.find((r) => r.kind === "onboarding-report");
      if (profile[0].ref_sha !== report.ref_sha) return "the name's revision is not the onboarding report's";
      return profile[0].session_id === sessionId ? null : "the name is not the import session's";
    });

    check(`${tag}10 ${name}: no claim, concern or narrative is created`, () =>
      countDiff(untouchedBefore, counts(db, UNTOUCHED_TABLES)),
    );

    check(`${tag}11 ${name}: a second run imports nothing`, () => {
      const before = counts(db, IMPORT_TABLES);
      const again = call(TOOL, {}, ctx);
      const moved = countDiff(before, counts(db, IMPORT_TABLES));
      if (moved) return `the second run wrote: ${moved}`;
      if ((again?.imported ?? []).length !== 0) return `the second run reports ${again.imported.length} import(s)`;
      return again?.ok === true ? null : `the second run answered ${JSON.stringify(again)}`;
    });

    check(`${tag}12 ${name}: no artifact file under storage changes`, () => {
      db.pragma("wal_checkpoint(TRUNCATE)");
      return sameFiles(filesBefore, storageFiles(storage));
    });
  }

  // ------------------------------------------- a missing file and an escaping path

  {
    const outside = (root) => join(root, "outside.md");
    const { ctx, storage, db, root } = world("axiomdb-shaped", "missing", (raw, storagePath, rootPath) => {
      unlinkSync(join(storagePath, "S-01-storage-substrate.md"));
      writeFileSync(outside(rootPath), "# Outside storage\n\nNot the store's to read.\n");
      raw
        .prepare(
          "INSERT INTO artifacts (path, kind, subsystem_id, content_hash, ref_sha, session_id, written_at, bytes) VALUES ('../outside.md', 'field-notes', NULL, NULL, NULL, 'survey-1', '2026-08-21 00:00:00', NULL)",
        )
        .run();
    });
    const rows = registered(db);
    session(ctx, "missing");
    let result = null;
    check("M1 a missing file and an escaping path do not stop the rest", () => {
      result = call(TOOL, {}, ctx);
      if (result?.ok !== true) return `it answered ${JSON.stringify(result)}`;
      const paths = importedRows(db).map((r) => r.path);
      const want = rows.map((r) => r.path).filter((p) => p !== "S-01-storage-substrate.md" && p !== "../outside.md");
      if (JSON.stringify(paths) !== JSON.stringify(want.sort())) return `imported ${JSON.stringify(paths)}`;
      return null;
    });
    check("M2 the missing file and the escaping path are reported, not imported", () => {
      const reported = new Map((result?.not_imported ?? []).map((r) => [r.path, r.reason]));
      for (const path of ["S-01-storage-substrate.md", "../outside.md"]) {
        if (!reported.has(path)) return `${path} is not reported`;
        if (!reported.get(path)) return `${path} is reported with no reason`;
      }
      return reported.size === 2 ? null : `${reported.size} path(s) reported`;
    });
    check("M3 the extraction runs although a survey body is missing", () => {
      const purpose = db.prepare("SELECT COUNT(*) AS n FROM explanations WHERE disposition = 'imported'").get().n;
      const name = db.prepare("SELECT COUNT(*) AS n FROM project_profile").get().n;
      const edges = db.prepare("SELECT COUNT(*) AS n FROM runtime_boundaries").get().n;
      return purpose === 1 && name === 1 && edges === 3 ? null : `purpose ${purpose}, name ${name}, edges ${edges}`;
    });
    check("M4 the file outside storage is untouched", () =>
      readFileSync(outside(root), "utf8") === "# Outside storage\n\nNot the store's to read.\n" ? null : "it changed",
    );
    check("M5 a second run over the missing file imports nothing", () => {
      const before = counts(db, IMPORT_TABLES);
      const again = call(TOOL, {}, ctx);
      const moved = countDiff(before, counts(db, IMPORT_TABLES));
      if (moved) return `the second run wrote: ${moved}`;
      const reported = (again?.not_imported ?? []).map((r) => r.path).sort();
      return reported.includes("S-01-storage-substrate.md") ? null : "the second run no longer reports the missing file";
    });
    void storage;
  }

  // --------------------------------------------- a recorded purpose and name stay

  {
    const { ctx, db } = world("self-shaped", "recorded", (raw) => {
      raw
        .prepare(
          "INSERT INTO sessions (session_id, intent, started_at, ended_at, outcome) VALUES ('author-1', 'author', '2026-11-01 00:00:00', '2026-11-01 00:00:00', 'completed')",
        )
        .run();
    });
    // The new server's tables exist only once the store is opened.
    db.prepare(
      "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id) VALUES ('project', 'project', 'purpose', 'recorded', 'Scribe keeps a survey of a codebase in one database.', 'd395c4d5a9e1f0b2c3d4e5f60718293a4b5c6d7e', 'author-1')",
    ).run();
    db.prepare("INSERT INTO project_profile (name, ref_sha, session_id) VALUES ('Scribe (recorded)', 'd395c4d5a9e1f0b2c3d4e5f60718293a4b5c6d7e', 'author-1')").run();
    session(ctx, "recorded");
    check("R1 a recorded purpose and name are not replaced by imported ones", () => {
      const result = call(TOOL, {}, ctx);
      if (result?.ok !== true) return `it answered ${JSON.stringify(result)}`;
      const imported = db.prepare("SELECT COUNT(*) AS n FROM explanations WHERE disposition = 'imported'").get().n;
      if (imported !== 0) return `${imported} imported purpose(s) written over a recorded one`;
      const names = db.prepare("SELECT name FROM project_profile ORDER BY id").all().map((r) => r.name);
      if (names.length !== 1) return `the profile holds ${JSON.stringify(names)}`;
      const bodies = importedRows(db).length;
      return bodies === registered(db).length ? null : `${bodies} file(s) imported`;
    });
  }

  for (const db of opened) {
    try {
      db.close();
    } catch {
      /* the assertion already reported whatever broke */
    }
  }
  rmSync(scratch, { recursive: true, force: true });
}

// ------------------------------------------------------------------- the driver

let exitCode = 0;
try {
  // Load the subject defensively: an absent build or module must produce this
  // gate's red line, not a stack trace. `dist/` is a build artifact, so the
  // gate compiles it first; a compile failure is this gate's red line.
  const built = ensureBuilt();
  const mods = {};
  let loadError = null;
  try {
    if (!built.ok) throw new Error(built.detail);
    for (const name of ["axiomdb-shaped", "self-shaped"]) {
      if (!existsSync(join(FIXTURES, name, "memory.sql"))) throw new Error(`fixtures/legacy-stores/${name} is absent`);
    }
    ({ openDatabase: mods.openDatabase } = await import("./dist/db.js"));
    mods.Database = (await import("better-sqlite3")).default;
    const [explanations, project, projectRecords] = await Promise.all([
      import("./dist/tools/explanations.js"),
      import("./dist/tools/project.js"),
      import("./dist/tools/project-records.js"),
    ]);
    const importPath = join(here, "dist", "tools", "import.js");
    if (!existsSync(importPath)) throw new Error("dist/tools/import.js is not built: src/tools/import.ts is absent");
    const imports = await import("./dist/tools/import.js");
    if (!Array.isArray(imports.importTools)) throw new Error("dist/tools/import.js exports no importTools");
    mods.toolArrays = [
      explanations.explanationTools,
      project.projectTools,
      projectRecords.projectRecordTools,
      imports.importTools,
    ];
  } catch (error) {
    loadError = `the server build could not be loaded: ${scrub(error?.message ?? error)}`;
  }

  if (loadError) {
    checked++;
    failures.push(`X1 ${loadError}`);
  } else {
    await main(mods);
  }
} catch (error) {
  failures.push(`X9 the gate did not finish: ${scrub(error?.message ?? error)}`);
}

console.log(`  ran  ${checked} assertion(s) against ${join(here, "dist")}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`GATE SO7 RED: ${failures[0]}`);
  exitCode = 1;
} else {
  console.log("GATE SO7 GREEN");
}
process.exit(exitCode);
