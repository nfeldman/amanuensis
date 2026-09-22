#!/usr/bin/env node
// GATE CF2 (spec.md §8.9) — shipped and proved in packet P4, run as a
// regression command from P8 onward.
//
// Every red condition below is a property of `dev/pecia-resolve-finding.mjs`,
// which P4 delivers. A gate asserting P4's behaviour cannot prove P9's: by the
// time P9 starts the resolver has shipped and this gate is green on its first
// run, with no red commit available to it. It therefore belongs to P4, whose
// red it does prove. P9 keeps `GATE PA1` (§8.9b), which is P9's own deliverable
// and its own claim. This is the one gate this specification declares that is
// not a packet gate, and §8.0 records that as a weaker proof than every other
// gate here receives rather than leaving it to be discovered.
//
//   exit 0  `GATE CF2 GREEN`          — every assertion held
//   exit 1  `GATE CF2 RED: <reason>`  — an assertion fired
//
// The gate has no third state. It copies the resolver into a throwaway
// repository root and builds the store it reads, so its inputs are ones any
// machine that can run the server can produce. Copying rather than pointing is
// deliberate: the resolver derives its store path from its own location
// (`dirname(import.meta.url)/..`), and a gate that made it take a `--store`
// argument would be testing a resolver Pecia does not invoke.
//
// Must-stay-green controls (VP4(f)):
//   K1  an id with a live `verified-fixed` finding still exits 0
//   K2  an unknown id still exits 1
//   K3  an id whose live finding is open still exits 1 — the carried lookup is
//       a fallback, never an override
//
// False green it cannot exclude: `pecia audit` reports only *closed* Pecia
// records whose reference stopped resolving. An open Pecia record pointing at a
// destroyed finding is still invisible to the audit; this gate makes the
// resolver honest, and the remaining gap is candidate finding B03-R2, which the
// acceptance rebuild carries forward rather than closes.
//
// What a reviewer should sabotage, and what must go red:
//   drop the carried lookup entirely                      → R1, R2, R3
//   exit 0 for an undecided carried record                → R1
//   exit 1 for a ruled-out or repaired carried record     → R2
//   answer `successor-finding` without following it       → R3
//   pick one row when two archives carry the same id      → R4
//   echo the argument into stdout or stderr               → R5
//   exit 3, or 255, on an unexpected state                → R6

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..");
const RESOLVER_REL = "dev/pecia-resolve-finding.mjs";

const CRASH_SIGNATURES = [
  "MODULE_NOT_FOUND",
  "Cannot find module",
  "ModuleNotFoundError",
  "SyntaxError",
  "No such file or directory",
  "command not found",
  "ImportError",
  "ENOENT",
  "ReferenceError",
  "is not defined",
  "TypeError",
  "is not a function",
];
function elide(signature) {
  const cut = Math.ceil(signature.length / 2);
  return `${signature.slice(0, cut)}…${signature.slice(cut)}`;
}
function scrub(text) {
  let out = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  for (const signature of CRASH_SIGNATURES) {
    out = out.split(signature).join(elide(signature));
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

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-cf2-"));
  const root = join(scratch, "repo");
  mkdirSync(join(root, "dev"), { recursive: true });
  mkdirSync(join(root, ".amanuensis"), { recursive: true });

  if (!existsSync(join(REPO, RESOLVER_REL))) {
    failures.push(`L1 ${RESOLVER_REL} is absent`);
    return;
  }
  cpSync(join(REPO, RESOLVER_REL), join(root, "dev", "pecia-resolve-finding.mjs"));

  // The resolver reads a real store, so the store is built by the server's own
  // schema rather than by a hand-written subset that could drift from it.
  let openDatabase = null;
  try {
    ({ openDatabase } = await import(join(REPO, "mcp-server", "dist", "db.js")));
  } catch (error) {
    failures.push(
      `L2 the built server could not be loaded, so no store could be built: ${scrub(error?.message ?? error)}`,
    );
    return;
  }

  const dbPath = join(root, ".amanuensis", "memory.db");
  const db = openDatabase(dbPath);

  // A live finding in each terminal state the resolver already answers about.
  const finding = (id, status) =>
    db
      .prepare(
        `INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status,
                               ref_sha, session_id, pass_type)
         VALUES (?, 'B03', 'a symptom', 'a cause', 'HIGH', ?, '0000000', 'cf2', 'survey')`,
      )
      .run(id, status);
  // `verified-fixed` carries a trigger of its own: the event's evidence must be
  // attached to the finding in the `fix-verification` role. The fixture
  // satisfies it rather than working around it, so the control below is a real
  // verified-fixed row and not a state nothing would accept.
  const resolutionEvent = (id, state) => {
    const evidenceId = Number(
      db
        .prepare(
          `INSERT INTO evidence (file_path, symbol, line_range, ref_sha, kind, session_id)
           VALUES ('src/a.ts', 'a', '1-1', '0000000', 'code-verified', 'cf2')`,
        )
        .run().lastInsertRowid,
    );
    db.prepare(
      "INSERT INTO finding_evidence (finding_id, evidence_id, role) VALUES (?, ?, 'fix-verification')",
    ).run(id, evidenceId);
    db.prepare(
      `INSERT INTO finding_resolution_events (finding_id, resolution_state, fix_location, fix_sha,
                                              evidence_id, rationale, session_id)
       VALUES (?, ?, 'src/a.ts', '0000000', ?, 'cf2 fixture', 'cf2')`,
    ).run(id, state, evidenceId);
  };

  finding("CF2-LIVE-FIXED", "fixed");
  resolutionEvent("CF2-LIVE-FIXED", "verified-fixed");
  finding("CF2-LIVE-OPEN", "confirmed-bug");
  finding("CF2-SUCCESSOR-OPEN", "confirmed-bug");
  finding("CF2-SUCCESSOR-FIXED", "fixed");
  resolutionEvent("CF2-SUCCESSOR-FIXED", "verified-fixed");

  // §5.2's tables, created by the fixture when the store does not carry them,
  // so every assertion below is about the resolver's *behaviour* rather than
  // about which commit is checked out (spec.md §8.0).
  db.exec(`CREATE TABLE IF NOT EXISTS carry_runs (
      id                INTEGER PRIMARY KEY,
      source_kind       TEXT    NOT NULL,
      source_path       TEXT,
      archived_store_id TEXT,
      archived_anchor   TEXT,
      reason            TEXT    NOT NULL,
      expected_count    INTEGER NOT NULL,
      imported_count    INTEGER NOT NULL,
      session_id        TEXT,
      ran_at            TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS carried_findings (
      carried_id           INTEGER PRIMARY KEY,
      archived_finding_id  TEXT    NOT NULL,
      archived_store_id    TEXT    NOT NULL,
      archived_anchor_sha  TEXT    NOT NULL,
      subsystem_id         TEXT    NOT NULL,
      severity             TEXT    NOT NULL,
      symptom              TEXT    NOT NULL,
      root_cause           TEXT    NOT NULL,
      carry_run_id         INTEGER NOT NULL REFERENCES carry_runs(id) ON DELETE RESTRICT,
      archived_resolution  TEXT    NOT NULL,
      archived_ref_sha     TEXT,
      primary_files        TEXT,
      carried_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      carried_by_session   TEXT,
      UNIQUE (archived_store_id, archived_finding_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS carried_finding_outcomes (
      id            INTEGER PRIMARY KEY,
      carried_id    INTEGER NOT NULL REFERENCES carried_findings(carried_id) ON DELETE RESTRICT,
      outcome       TEXT    NOT NULL,
      successor_id  TEXT,
      repaired_sha  TEXT,
      rationale     TEXT    NOT NULL,
      session_id    TEXT    NOT NULL,
      ref_sha       TEXT    NOT NULL,
      recorded_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);

  const ARCHIVE_A = "store-legacyaaaaaaaa";
  const ARCHIVE_B = "store-legacybbbbbbbb";
  const runId = Number(
    db
      .prepare(
        `INSERT INTO carry_runs (source_kind, source_path, archived_store_id, archived_anchor,
                                 reason, expected_count, imported_count)
         VALUES ('store', '/cf2/archive/memory.db', ?, '0000000', 'cf2 fixture', 7, 7)`,
      )
      .run(ARCHIVE_A).lastInsertRowid,
  );
  function carried(archivedId, storeId = ARCHIVE_A, archivedResolution = "open") {
    return Number(
      db
        .prepare(
          `INSERT INTO carried_findings (archived_finding_id, archived_store_id, archived_anchor_sha,
                                         subsystem_id, severity, symptom, root_cause, carry_run_id,
                                         archived_resolution)
           VALUES (?, ?, '0000000', 'B03', 'HIGH', 'the archived symptom', 'the archived cause', ?, ?)`,
        )
        .run(archivedId, storeId, runId, archivedResolution).lastInsertRowid,
    );
  }
  function outcome(carriedId, kind, extra = {}) {
    db.prepare(
      `INSERT INTO carried_finding_outcomes (carried_id, outcome, successor_id, repaired_sha,
                                             rationale, session_id, ref_sha)
       VALUES (?, ?, ?, ?, 'cf2 fixture', 'cf2', '0000000')`,
    ).run(carriedId, kind, extra.successor_id ?? null, extra.repaired_sha ?? null);
  }

  carried("B03-6"); // undecided
  outcome(carried("B03-7"), "ruled-out");
  outcome(carried("B03-8"), "repaired", { repaired_sha: "0000000" });
  outcome(carried("B04-5"), "archived-terminal");
  outcome(carried("B07-1"), "successor-finding", { successor_id: "CF2-SUCCESSOR-FIXED" });
  outcome(carried("B02-3"), "successor-finding", { successor_id: "CF2-SUCCESSOR-OPEN" });
  // The same id from two archives: §5.7 refuses rather than choosing.
  carried("B03-DUP", ARCHIVE_A);
  carried("B03-DUP", ARCHIVE_B);

  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();

  function resolve(target) {
    const run = spawnSync(
      process.execPath,
      [join(root, "dev", "pecia-resolve-finding.mjs"), target],
      { cwd: root, encoding: "utf8", timeout: 60_000 },
    );
    return {
      status: run.status,
      stdout: String(run.stdout ?? ""),
      stderr: String(run.stderr ?? ""),
    };
  }

  // -------------------------------------------------- the carried lookup order

  check("R1 an undecided carried record does not resolve", () => {
    const run = resolve("B03-6");
    if (run.status === 0) {
      return "an inherited, undecided defect resolved; that is the point of carrying it — pecia audit must report the closed Pecia record as unresolvable so the owner sees it";
    }
    if (run.status !== 1) return `it exited ${run.status}, not 1`;
    return /no terminal outcome/.test(run.stderr)
      ? null
      : `its stderr does not say the carried record has no terminal outcome: ${scrub(run.stderr) || "(silent)"}`;
  });

  check("R2 a ruled-out or repaired carried record resolves", () => {
    const said = [];
    for (const [id, kind] of [
      ["B03-7", "ruled-out"],
      ["B03-8", "repaired"],
      ["B04-5", "archived-terminal"],
    ]) {
      const run = resolve(id);
      if (run.status !== 0) {
        said.push(`${id} (${kind}) exited ${run.status}: ${scrub(run.stderr) || "(silent)"}`);
      }
    }
    return said.length === 0
      ? null
      : `a carried record with a terminal outcome did not resolve — ${said.join("; ")}`;
  });

  check("R3 successor-finding is followed into the successor and answered with its state", () => {
    const closed = resolve("B07-1");
    if (closed.status !== 0) {
      return `a carried record whose successor is verified-fixed exited ${closed.status}; the reference follows the finding into its successor`;
    }
    const open = resolve("B02-3");
    if (open.status === 0) {
      return "a carried record whose successor is still open resolved; answering with the successor's state means answering with *its* state, not with the fact that a successor exists";
    }
    return open.status === 1
      ? null
      : `the open successor's answer was exit ${open.status}, not 1`;
  });

  check("R4 an id carried from two archives is a refusal, not a choice", () => {
    const run = resolve("B03-DUP");
    if (run.status !== 2) {
      return `two archives carry B03-DUP and the resolver exited ${run.status}; picking the newest, or the first, would let one archive's decision answer for another's defect`;
    }
    if (!/qualify/.test(run.stderr)) {
      return `it refused without asking for the store-qualified form: ${scrub(run.stderr) || "(silent)"}`;
    }
    const qualified = resolve(`${ARCHIVE_A}:B03-DUP`);
    return qualified.status === 1
      ? null
      : `the qualified form ${ARCHIVE_A}:B03-DUP exited ${qualified.status}, not 1; §5.7 says the resolver accepts it`;
  });

  check("R5 the resolver never prints its argument", () => {
    const leaked = [];
    for (const target of [
      "B03-6",
      "B03-7",
      "B03-8",
      "B07-1",
      "B03-DUP",
      "CF2-LIVE-FIXED",
      "CF2-LIVE-OPEN",
      "CF2-NO-SUCH-FINDING",
      `${ARCHIVE_A}:B03-DUP`,
    ]) {
      const run = resolve(target);
      if (run.stdout.includes(target) || run.stderr.includes(target)) {
        leaked.push(`${target} (exit ${run.status})`);
      }
    }
    return leaked.length === 0
      ? null
      : `the resolver echoed its argument for ${leaked.join(", ")}; the command is repo-local but the argument is ledger content, and a resolver that echoes it launders ledger text into an agent's context (pecia decision pc-cdb8)`;
  });

  check("R6 every answer is one of the three declared exit codes", () => {
    const outside = [];
    for (const target of [
      "B03-6",
      "B03-7",
      "B03-8",
      "B04-5",
      "B07-1",
      "B02-3",
      "B03-DUP",
      "CF2-LIVE-FIXED",
      "CF2-LIVE-OPEN",
      "CF2-NO-SUCH-FINDING",
      `${ARCHIVE_A}:B03-DUP`,
      "a-id-with-no-record",
    ]) {
      const run = resolve(target);
      if (![0, 1, 2].includes(run.status)) outside.push(`exit ${run.status}`);
    }
    return outside.length === 0
      ? null
      : `the resolver returned ${outside.join(", ")}; Pecia reads only the exit code, so a fourth value is an answer nothing can read`;
  });

  // --------------------------------------------------------------- the controls

  check("K1 a live verified-fixed finding still resolves", () => {
    const run = resolve("CF2-LIVE-FIXED");
    return run.status === 0
      ? null
      : `it exited ${run.status}: ${scrub(run.stderr) || "(silent)"} — step 1 of §5.7 is unchanged`;
  });

  check("K2 an unknown id still does not resolve", () => {
    const run = resolve("CF2-NO-SUCH-FINDING");
    if (run.status !== 1) return `it exited ${run.status}, not 1`;
    return /no such finding/.test(run.stderr)
      ? null
      : `its stderr no longer says the id names no finding: ${scrub(run.stderr) || "(silent)"}`;
  });

  check("K3 a live open finding still does not resolve", () => {
    const run = resolve("CF2-LIVE-OPEN");
    return run.status === 1
      ? null
      : `it exited ${run.status}; the carried lookup is a fallback for an id the findings table does not hold, never an override of a live answer`;
  });

  check("CI1 this gate runs in CI (spec.md §8)", () => {
    const workflow = join(REPO, ".github", "workflows", "test.yml");
    if (!existsSync(workflow)) return ".github/workflows/test.yml is absent";
    return readFileSync(workflow, "utf8").includes("dev/test-carried-finding-references.mjs")
      ? null
      : "the workflow does not run this gate, so a break lands on a branch no run reports";
  });

  rmSync(scratch, { recursive: true, force: true });
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  failures.push(`X1 the gate did not finish: ${scrub(error?.message ?? error)}`);
}

console.log(`  ran  ${checked} assertion(s) against ${RESOLVER_REL}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(
    "GATE CF2 RED: a destroyed referent and a reopened one are reported identically — the " +
      "resolver answers about `findings` alone, so an inherited undecided defect resolves, a " +
      `decided carried one does not, and an ambiguous id is answered rather than refused — ${failures.length} of ${checked} ` +
      `assertion(s) failed; first: ${failures[0]}`,
  );
  exitCode = 1;
} else {
  console.log("GATE CF2 GREEN");
}
process.exit(exitCode);
