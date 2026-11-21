#!/usr/bin/env node
// Acceptance of the store-only migration and import on real stores
// (design/store-only/PLAN.md §5.3, §8 "Gates are hermetic", D6, D16).
//
// Not a gate and not a CI step: the owner runs it, once per store, before the
// real import. It never writes to the store it is given. For each storage
// directory named on the command line it:
//
//   1. snapshots the database with `sqlite3 -readonly <db> "VACUUM INTO '<tmp>'"`
//      (a consistent snapshot, unlike copying the database and its WAL apart);
//   2. copies the storage directory's other files beside the snapshot, leaving
//      out the database files and any storage-git directory;
//   3. opens the snapshot with this tree's server, which migrates it, and runs
//      `import_artifact_bodies` over the copy, then runs it again;
//   4. prints a report: what was registered and imported, which files no longer
//      match their registered hash, what was reported and not imported, the
//      thesis, name and runtime rows extracted, and whether every imported body
//      equals the original file's bytes, no claim, concern or narrative was
//      created, the second run imported nothing and no original file changed.
//
//   node accept-store-only-real-stores.mjs <storage-dir> [<storage-dir> ...] [--keep]
//
// The two stores PLAN §5.3 measured are this repository's `.amanuensis/` and
// AxiomDB's `~/repos/axiomdb/.amanuensis/`. Exit 0 when every check held for
// every store, 1 when one did not, 2 on a usage error. --keep leaves the
// snapshots in place and prints where they are.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const stores = args.filter((a) => a !== "--keep").map((a) => resolve(a));
if (stores.length === 0) {
  console.error("usage: node accept-store-only-real-stores.mjs <storage-dir> [<storage-dir> ...] [--keep]");
  process.exit(2);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const DB_FILE = /^memory\.db(-wal|-shm|-journal)?$/;
const UNTOUCHED = ["claims", "concerns", "narratives", "evidence", "dispositions", "findings", "field_notes"];

/** Every file under `root` with its digest, the database files and any storage-git directory left out. */
function digests(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === ".git") continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (!DB_FILE.test(name)) out.set(relative(root, full), sha256(readFileSync(full)));
    }
  };
  walk(root);
  return out;
}

const counts = (db, tables) =>
  Object.fromEntries(
    tables.map((t) => [
      t,
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)
        ? db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n
        : null,
    ]),
  );

const built = ensureBuilt();
if (!built.ok) {
  console.error(`the server does not build: ${built.detail}`);
  process.exit(1);
}
const { openDatabase } = await import("./dist/db.js");
const { projectTools } = await import("./dist/tools/project.js");
const { importTools } = await import("./dist/tools/import.js");
const tools = new Map([...projectTools, ...importTools].map((t) => [t.name, t]));
const call = (name, a, ctx) => tools.get(name).handler(a, ctx);

let failed = 0;
for (const storage of stores) {
  console.log(`\n## ${storage}`);
  const checks = [];
  const check = (label, ok, detail = "") => {
    checks.push(ok);
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  };
  const source = join(storage, "memory.db");
  if (!existsSync(source)) {
    check("a database is in the storage directory", false, `${source} is absent`);
    failed++;
    continue;
  }
  const scratch = mkdtempSync(join(tmpdir(), `amanuensis-accept-${basename(storage)}-`));
  const copy = join(scratch, "storage");
  try {
    const originals = digests(storage);
    cpSync(storage, copy, {
      recursive: true,
      filter: (src) => basename(src) !== ".git" && !DB_FILE.test(basename(src)),
    });
    const snapshot = join(copy, "memory.db");
    const vacuum = spawnSync("sqlite3", ["-readonly", source, `VACUUM INTO '${snapshot.replaceAll("'", "''")}'`], {
      encoding: "utf8",
    });
    if (vacuum.status !== 0) {
      check("the database snapshots", false, vacuum.stderr.trim() || `exit ${vacuum.status}`);
      failed++;
      continue;
    }

    const db = openDatabase(snapshot);
    try {
      const ctx = {
        project: {
          workspacePath: join(scratch, "no-workspace"),
          projectKey: `accept-${basename(storage)}`,
          storagePath: copy,
          dbPath: snapshot,
          storageGitReady: false,
        },
        db,
        sessionId: null,
      };
      check("the new server opens and migrates the snapshot", true);
      const registered = db
        .prepare("SELECT kind, COUNT(*) AS n, SUM(bytes) AS bytes FROM artifacts WHERE kind <> 'other' GROUP BY kind ORDER BY kind")
        .all();
      console.log(`  registered: ${registered.map((r) => `${r.kind} ${r.n}`).join(", ") || "nothing"}`);
      const before = counts(db, UNTOUCHED);
      call("start_session", { intent: "store-only acceptance" }, ctx);
      const first = call("import_artifact_bodies", {}, ctx);
      const imported = first.imported ?? [];
      const total = imported.reduce((sum, r) => sum + r.bytes, 0);
      console.log(`  imported: ${imported.length} file(s), ${total} bytes; ${first.already_imported} already imported`);
      for (const r of imported.filter((r) => r.hash_matches === 0)) {
        console.log(`  edited after it was registered: ${r.path}`);
      }
      for (const r of first.not_imported ?? []) console.log(`  not imported: ${r.path} (${r.kind}) — ${r.reason}`);
      console.log(`  extraction: ${first.extraction?.ran ? "ran" : `not run — ${first.extraction?.reason}`}`);
      console.log(`  thesis: ${JSON.stringify(first.thesis)}`);
      console.log(`  project name: ${JSON.stringify(first.project_name)}`);
      console.log(`  runtime boundaries: ${JSON.stringify(first.runtime_boundaries)}`);

      const rows = db.prepare("SELECT path, body, body_sha256 FROM imported_artifacts").all();
      const unequal = rows.filter((r) => {
        const path = join(storage, r.path);
        return !existsSync(path) || !Buffer.from(r.body, "utf8").equals(readFileSync(path)) || r.body_sha256 !== sha256(readFileSync(path));
      });
      check("every imported body equals the original file's bytes", unequal.length === 0, unequal.map((r) => r.path).join(", "));
      const after = counts(db, UNTOUCHED);
      const moved = UNTOUCHED.filter((t) => before[t] !== after[t]);
      check("no claim, concern, narrative or other record is created", moved.length === 0, moved.join(", "));
      const again = call("import_artifact_bodies", {}, ctx);
      check("a second run imports nothing", (again.imported ?? []).length === 0, `${(again.imported ?? []).length} imported`);
      const now = digests(storage);
      const changed = [...originals].filter(([p, d]) => now.get(p) !== d).map(([p]) => p);
      check("no original file changed", changed.length === 0 && now.size === originals.size, changed.join(", "));
    } finally {
      db.close();
    }
  } catch (error) {
    check("the acceptance ran to the end", false, error?.message ?? String(error));
  } finally {
    if (keep) console.log(`  snapshot kept at ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
  }
  if (checks.includes(false)) failed++;
}

console.log(failed ? `\n${failed} store(s) failed acceptance.` : "\nEvery store passed acceptance.");
process.exit(failed ? 1 : 0);
