#!/usr/bin/env node
// GATE D1 (design/survey-depth/spec.md §8.5) — the gate *for* the depth gate.
//
// `dev/test-survey-depth.mjs` (GATE D0, §7.1) is the lane's acceptance
// instrument: it compares a candidate store against the frozen baseline of §1.3
// and evaluates the six per-record predicates B1–B6 of §7.3. An instrument that
// reports green on a store that fails one of those predicates is worse than no
// instrument, because the rebuild packets are graded by it. So D0 is itself put
// on a stand here and made to fire.
//
// Every fault is seeded **in the data D0 executes over** — a tracked path with
// no ledger row, a reclassified ledger, a disposition with nothing attached, a
// subsystem that neither defined a term nor declined one, a carried record
// nobody decided — never by a flag D0 reads about itself. VP4 v2.15: a gate that
// turns red because the test told it to has proved that the test can talk to it,
// not that the assertion can fire. Each seeded store is built from scratch with
// exactly one fault, so a red that fires for two reasons at once cannot be
// mistaken for selectivity, and each arm requires the red to **name its own
// predicate**: a D0 that went red on everything would pass a check that only
// asked for a nonzero exit.
//
// Turns red when:
//   - D0 fails to turn red on any of B1–B6 seeded independently, or turns red
//     without naming the predicate that was seeded;
//   - D0 turns red on the must-stay-green control store, or on a control whose
//     *reported* axes are at the floor — §1.6 makes those axes non-blocking, and
//     a gate that quietly blocks on them has reintroduced the quota
//     `decisions.md` §3 forbids;
//   - D0 reports green with an absent or unreadable baseline fixture (§1.5);
//   - D0 reports green with neither a live store nor a committed acceptance
//     receipt, rather than exiting 2 `cannot run` (§7.1) — and equally when it
//     offers that third state as a red, which §8.0 clause 3 forbids;
//   - D0 reports a blocking verdict read from the receipt's recorded `verdict`
//     field rather than recomputed from §7.5's row-level witnesses — seeded as a
//     receipt whose every verdict says green over witnesses that do not;
//   - D0 fails to assert agreement when a live store and a receipt are both
//     present and disagree;
//   - D0 prints a fraction without its denominator, or treats a zero
//     denominator as a pass (VP4(e));
//   - D2's obligation-bearing denominator exempts `deferred-with-reason`, which
//     `mcp-server/contracts/conspectus-vocabulary.json` marks obligation-bearing
//     (D9/codex, §1.2);
//   - `dev/record-survey-depth-baseline.mjs --check` exits 0 with the archived
//     store unreadable rather than exiting 2 (§7.2);
//   - either gate is absent from `.github/workflows/test.yml`.
//
// False greens it cannot exclude. The **reported** axes are not asserted here at
// all, by design: field notes, evidence rows, vocabulary counts and open
// questions are printed with their deltas and turn nothing red, so a rebuild
// that meets B1–B6 while recording a sixth of the baseline's field notes is
// green through this gate and through D0 (§8.5, `decisions.md` §3). B2 cannot
// distinguish a file that was read from a file marked `examined`; the
// classification is an assertion and what is checked is its coverage, not its
// honesty. And the seeded stores are synthetic: they exercise D0's predicates
// over a tree of twenty-one paths and two subsystems, not over the shape of a
// real rebuild, so a predicate that is right here and wrong at scale would pass.
// The whole-archive arm — `--check` against the frozen store — is machine-local
// and reports itself unevaluated rather than passing where the archive is absent.
//
// Output protocol: exactly one status line, last, on stdout. Every message,
// including everything captured from a spawned process, is scrubbed of the
// launcher's crash signatures, so an absent deliverable reads as a failed
// assertion rather than as a gate that never ran.
//
// That line is addressed to two readers at once, which is why it names two
// gates. §8.0 clauses 1 and 2 bind the launcher to the *packet* id — it looks
// for `GATE P5 RED: <reason>` or `GATE P5 GREEN` and knows nothing of this
// specification's own gate names — while §8.5 and `plan.json`'s
// `gate.red_expect`, which quotes the first line of the reason, both name this
// gate D1. So the packet marker leads and D1's verdict is the reason it
// carries: `GATE P5 RED: GATE D1 RED: …`, `GATE P5 GREEN — GATE D1 GREEN`. A
// line that satisfied only §8.5 was refused by the launcher at attempt 1 with
// "gate failed at red without printing 'GATE P5 RED: <reason>'".

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DEPTH_GATE_REL = "dev/test-survey-depth.mjs";
const RECORDER_REL = "dev/record-survey-depth-baseline.mjs";
const BASELINE_REL = "dev/survey-depth-baseline.json";
const RECEIPT_REL = "design/survey-depth/acceptance-receipt.json";
const SCHEMA_REL = "mcp-server/src/schema.sql";
const VOCABULARY_REL = "mcp-server/contracts/conspectus-vocabulary.json";
const CI_REL = ".github/workflows/test.yml";

const DEPTH_GATE_COMMAND = "node dev/test-survey-depth.mjs";
const GATE_COMMAND = "node dev/test-survey-depth-red-gates.mjs";

// The archived store D0's fixture is measured from (§7.2). Machine-local and
// outside the repository, which is the whole reason `--check` has a third state.
const ARCHIVE_PATH =
  process.env.AMANUENSIS_BASELINE_STORE ??
  join(
    process.env.HOME ?? "",
    ".claude/automations/amanuensis-clean-slate/archive/store-7c1c1a9/memory.db",
  );

// ---------------------------------------------------------------------------
// Output funnel. Nothing reaches stdout except through emit(), and everything
// is scrubbed of the launcher's crash signatures so that a genuine assertion
// failure is never mistaken for a gate that never ran.
// ---------------------------------------------------------------------------
const SCRUB = [
  [/MODULE_NOT_FOUND/g, "module-absent"],
  [/ModuleNotFoundError/g, "python-module-absent"],
  [/Cannot find module/g, "cannot load module"],
  [/No such file or directory/g, "path is absent"],
  [/No such file/g, "path is absent"],
  [/can't open file/g, "cannot open path"],
  [/SyntaxError/g, "syntax-error"],
  [/ImportError/g, "python-import-error"],
  [/ReferenceError/g, "reference-error"],
  [/TypeError/g, "type-error"],
  [/ENOENT/g, "PATH-ABSENT"],
  [/is not defined/g, "is undeclared"],
  [/is not a function/g, "is not callable"],
  [/command not found/g, "executable is absent"],
];

function scrub(text) {
  let out = String(text ?? "");
  for (const [pattern, replacement] of SCRUB) out = out.replace(pattern, replacement);
  return out;
}

function emit(line) {
  process.stdout.write(`${scrub(line)}\n`);
}

const failures = [];
function check(label, fn) {
  let reason = null;
  try {
    reason = fn();
  } catch (e) {
    reason = `threw while checking — ${e && e.message ? e.message : e}`;
  }
  if (reason) {
    failures.push(`${label}: ${reason}`);
    emit(`  FAIL ${label}: ${reason}`);
  } else {
    emit(`  ok   ${label}`);
  }
}

/** Recorded, never counted as a pass: an arm whose subject this machine lacks. */
const unevaluated = [];
function note(line) {
  unevaluated.push(line);
  emit(`  note ${line}`);
}

function finish(summary) {
  emit("");
  for (const line of unevaluated) emit(`unevaluated here: ${line}`);
  if (failures.length) {
    emit(
      `GATE P5 RED: GATE D1 RED: the depth gate did not turn red on a seeded fault, did not stay ` +
        `green on its control, or accepted an input it must refuse — ${failures.length} failed ` +
        `assertion(s) over ${summary}; first: ${failures[0]}`,
    );
    process.exit(1);
  }
  emit("GATE P5 GREEN — GATE D1 GREEN");
  process.exit(0);
}

// node:sqlite is experimental and warns on import; this gate's stdout is its
// verdict and a runtime warning in the middle of it is noise.
process.removeAllListeners("warning");
process.on("warning", () => {});

// ---------------------------------------------------------------------------
// The scratch repository builder. One git workspace and one store per case, so
// a fault seeded for B3 cannot leak into the store B5 is read from.
// ---------------------------------------------------------------------------
const scratch = mkdtempSync(join(tmpdir(), "amanuensis-d1-"));
process.on("exit", () => {
  // `AMANUENSIS_D1_KEEP_SCRATCH` leaves the seeded workspaces behind so a
  // reviewer can run the depth gate against one by hand and read its output.
  if (process.env.AMANUENSIS_D1_KEEP_SCRATCH) {
    // stderr, not stdout: the status line is the last thing on stdout, and a
    // debugging convenience does not get to come after it.
    process.stderr.write(`scratch kept at ${scratch}\n`);
    return;
  }
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* a leftover scratch directory changes no verdict */
  }
});

function git(cwd, ...args) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitCommit(cwd, message) {
  return spawnSync(
    "git",
    [
      "-c",
      "user.email=d1@localhost",
      "-c",
      "user.name=survey-depth-d1",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "--no-verify",
      "-m",
      message,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

const NUL = "\u0000";
/**
 * §3.2's digest formula, restated rather than imported.
 *
 * The server computes it in `mcp-server/src/invariants.ts` and D0 recomputes it
 * in its own file; a fixture that built its digest with the same code the gate
 * verifies it with would compare a value with itself (GP24).
 */
function digestOf(parts) {
  return createHash("sha256")
    .update([...parts].sort().join(NUL))
    .digest("hex");
}

/** The tracked path set of a revision's tree, as `listTrackedPaths` reads it. */
function trackedPathsAt(root, revision) {
  const result = git(root, "ls-tree", "-r", "--name-only", "-z", revision);
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? "")
    .split(NUL)
    .filter((path) => path.length > 0);
}

// The synthetic repository, and the ledger over it. Twenty-one tracked paths,
// four of them exempt under the contract's `obligation_bearing = false`
// classifications, so the obligation-bearing denominator is seventeen and the
// examined fraction is 12/17 = 70.59% — above the frozen baseline's 59.57%.
//
// Three paths are `deferred-with-reason`, which the contract marks
// obligation-bearing (§1.2, D9/codex). If D0 exempted them the denominator would
// be fourteen and the fraction 85.71%; the arm below asserts seventeen, so the
// two readings cannot be confused.
const LEDGER = [
  ...Array.from({ length: 12 }, (_, i) => [
    `src/a${String(i + 1).padStart(2, "0")}.js`,
    "examined",
  ]),
  ["src/b01.js", "candidate"],
  ["src/b02.js", "candidate"],
  ["defer/d01.js", "deferred-with-reason"],
  ["defer/d02.js", "deferred-with-reason"],
  ["defer/d03.js", "deferred-with-reason"],
  ["gen/out1.js", "generated-ignore"],
  ["gen/out2.js", "generated-ignore"],
  ["vendor/v1.js", "vendor-ignore"],
  ["notes/misc.md", "irrelevant"],
];
const OBLIGATION_BEARING_PATHS = 17;
const EXAMINED_PATHS = 12;

const SCHEMA_SQL = existsSync(join(REPO, SCHEMA_REL))
  ? readFileSync(join(REPO, SCHEMA_REL), "utf8")
  : null;

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}

/**
 * One case: a git workspace at a commit, a store beside it, and exactly one
 * seeded fault.
 *
 * Returns `{ root, store, sha }`, or `{ error }` when the machine cannot build
 * one — which is a failed assertion here, never a pass.
 */
function buildCase(name, options = {}) {
  const {
    seed = null,
    carriedIds = [],
    archivedStoreId = "store-legacy-d1fixture000",
    archivedAnchor = "0".repeat(40),
    withStore = true,
  } = options;

  const root = join(scratch, name);
  mkdirSync(root, { recursive: true });
  if (git(root, "init", "-q", "-b", "main").status !== 0) {
    return { error: `git init failed in ${root}` };
  }
  git(root, "config", "user.email", "d1@localhost");
  git(root, "config", "user.name", "survey-depth-d1");
  git(root, "config", "commit.gpgsign", "false");

  for (const [path] of LEDGER) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `// ${path}\nexport const marker = ${JSON.stringify(path)};\n`);
  }
  git(root, "add", "-A");
  gitCommit(root, "the synthetic tree D0 is measured over");
  let sha = git(root, "rev-parse", "HEAD").stdout?.trim();
  if (!/^[0-9a-f]{40}$/.test(String(sha))) return { error: `no commit in ${root}` };

  // B1's seed: a tracked path nobody assigned or excluded. The reconciliation
  // below records it **honestly** — `unledgered = 1`, matching the tree — which
  // is exactly the state an earlier draft of B1 accepted and ADR-0001 clause 1
  // does not (C29/codex).
  if (seed === "B1") {
    writeFileSync(join(root, "src/unassigned.js"), "// nobody assigned or excluded this\n");
    git(root, "add", "-A");
    gitCommit(root, "a tracked path with no ledger row");
    sha = git(root, "rev-parse", "HEAD").stdout?.trim();
  }

  if (!withStore) return { root, store: null, sha };
  if (!DatabaseSync) return { error: "this runtime carries no node:sqlite" };
  if (SCHEMA_SQL === null) return { error: `${SCHEMA_REL} is absent, so no store can be built` };

  const storeDir = join(root, ".amanuensis");
  mkdirSync(storeDir, { recursive: true });
  const store = join(storeDir, "memory.db");
  const db = new DatabaseSync(store);
  try {
    db.exec(SCHEMA_SQL);

    db.prepare(
      "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha, last_checked_sha) VALUES ('default','main',?,?)",
    ).run(sha, sha);
    db.prepare("INSERT INTO store_identity (id, store_generation) VALUES (1, ?)").run(
      randomBytes(16).toString("hex"),
    );
    db.prepare(
      "INSERT INTO sessions (session_id, intent) VALUES ('d1-session','the synthetic survey D0 reads')",
    ).run();

    db.prepare("INSERT INTO subsystems (id, name, status) VALUES (?,?,?)").run(
      "S-01",
      "the mapped subsystem",
      "mapped",
    );
    db.prepare("INSERT INTO subsystems (id, name, status) VALUES (?,?,?)").run(
      "S-02",
      "the structural subsystem",
      "structural",
    );
    // B4's seed: a subsystem past `structural` that neither coined a term nor
    // said out loud that it coins none (§4.4).
    if (seed === "B4") {
      db.prepare("INSERT INTO subsystems (id, name, status) VALUES (?,?,?)").run(
        "S-03",
        "the silent subsystem",
        "structural",
      );
    }

    // The ledger. B2's seed reclassifies five examined rows down to `candidate`,
    // which drops the examined fraction to 7/17 = 41.18% — below the frozen
    // 59.57% and nothing else. `B2-zero` classifies every tracked path exempt,
    // which leaves the fraction with no denominator at all: 0/0 is out of band,
    // not a pass (VP4(e), §1.4), and a gate that treated it as one would report
    // a store nobody read as fully covered.
    const demoted = seed === "B2" ? 5 : 0;
    let seenExamined = 0;
    const insertLedger = db.prepare(
      "INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at) VALUES (?,?,?,?,?,datetime('now'))",
    );
    for (const [path, classification] of LEDGER) {
      let actual = classification;
      if (classification === "examined") {
        seenExamined += 1;
        if (seenExamined <= demoted) actual = "candidate";
      }
      if (seed === "B2-zero") actual = "generated-ignore";
      insertLedger.run(
        path.startsWith("defer/") ? "S-02" : "S-01",
        path,
        "in the synthetic scope",
        actual,
        actual === "examined" ? sha : null,
      );
    }

    // The standing reconciliation (§3.3). Its counts are re-derived from the
    // tree here, so a seeded store never records a count the tree contradicts —
    // the point of the B1 seed is a count that is *correct* and nonzero.
    const tracked = trackedPathsAt(root, sha) ?? [];
    const ledgerRows = db.prepare("SELECT file_path, classification FROM file_ledger").all();
    const ledgerPaths = new Set(ledgerRows.map((row) => row.file_path));
    const exemptSet = new Set(["generated-ignore", "vendor-ignore", "irrelevant"]);
    const unledgered = tracked.filter((path) => !ledgerPaths.has(path)).length;
    const absent = [...ledgerPaths].filter((path) => !tracked.includes(path)).length;
    const exempt = ledgerRows.filter(
      (row) => tracked.includes(row.file_path) && exemptSet.has(row.classification ?? ""),
    ).length;
    db.prepare(
      `INSERT INTO scope_reconciliations
         (detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows,
          unledgered, absent, exempt, session_id)
       VALUES (?,?,?,?,?,?,?,?, 'd1-session')`,
    ).run(
      sha,
      digestOf(tracked),
      digestOf(ledgerRows.map((row) => `${row.file_path}${NUL}${row.classification ?? ""}`)),
      tracked.length,
      ledgerPaths.size,
      unledgered,
      absent,
      exempt,
    );

    // B1's other seed: the ledger moves *after* the reading was taken, so the
    // recorded reconciliation no longer describes the ledger it claims to
    // (§3.3 condition 5). The row above stays; this row is what invalidates it.
    if (seed === "B1-stale") {
      insertLedger.run(
        "S-02",
        "src/a01.js",
        "a second owner, added after the reading",
        "candidate",
        null,
      );
    }

    // Evidence, dispositions, and the attachments B3 reads.
    const insertEvidence = db.prepare(
      "INSERT INTO evidence (file_path, symbol, line_range, ref_sha, kind, excerpt, session_id) VALUES (?,?,?,?,?,?, 'd1-session')",
    );
    const evidenceId = (path, refSha) =>
      Number(
        insertEvidence.run(path, "marker", "1-2", refSha, "code-verified", "export const marker")
          .lastInsertRowid,
      );

    const insertConcern = db.prepare(
      "INSERT INTO concerns (code, category, origin, discovered_in, status, notes) VALUES (?, 'data-integrity', 'seeded', 'd1-session', 'active', ?)",
    );
    insertConcern.run("CC-1", "the first concern on the synthetic checklist");
    insertConcern.run("EV-1", "the second concern on the synthetic checklist");
    const insertDisposition = db.prepare(
      `INSERT INTO dispositions
         (subsystem_id, concern_code, classification, evidence, evidence_quality, rationale, ref_sha, session_id, pass_type)
       VALUES (?,?,?,?,?,?,?, 'd1-session', 'survey')`,
    );
    const attach = db.prepare(
      "INSERT INTO disposition_evidence (subsystem_id, concern_code, evidence_id, role) VALUES (?,?,?, 'supports')",
    );
    for (const code of ["CC-1", "EV-1"]) {
      insertDisposition.run(
        "S-01",
        code,
        "confirmed-acceptable",
        `src/a01.js:marker@${sha}`,
        "code-verified",
        "read and answered",
        sha,
      );
      attach.run("S-01", code, evidenceId("src/a01.js", sha));
    }

    // B3's seeds. The first is a disposition in a `mapped` subsystem with
    // nothing attached at all; the second attaches a row whose revision this
    // workspace cannot resolve, which §2.3 refuses for the same reason.
    if (seed === "B3") {
      insertConcern.run("ZD-1", "the unbacked concern");
      insertDisposition.run(
        "S-01",
        "ZD-1",
        "ruled-out",
        "a sentence nobody attached",
        "doc-asserted",
        "asserted and not attached",
        sha,
      );
    }
    if (seed === "B3-unresolvable") {
      insertConcern.run("ZD-1", "the unreachable concern");
      const dangling = "9".repeat(40);
      insertDisposition.run(
        "S-01",
        "ZD-1",
        "ruled-out",
        `src/a02.js:marker@${dangling}`,
        "code-verified",
        "attached at a revision nothing here carries",
        sha,
      );
      attach.run("S-01", "ZD-1", evidenceId("src/a02.js", dangling));
    }

    // §4.4's discharge: S-01 anchors a term, S-02 declines out loud.
    if (seed !== "no-vocabulary") {
      db.prepare(
        "INSERT INTO vocabulary (term, gloss, subsystem_id, first_seen, ref_sha) VALUES (?,?,?,?,?)",
      ).run("marker", "the synthetic domain term", "S-01", `src/a01.js:marker@${sha}`, sha);
      db.prepare("INSERT INTO vocabulary_scopes (term, subsystem_id) VALUES (?,?)").run(
        "marker",
        "S-01",
      );
      db.prepare(
        "INSERT INTO vocabulary_declinations (subsystem_id, reason, session_id, ref_sha) VALUES (?,?, 'd1-session', ?)",
      ).run("S-02", "this subsystem coins nothing of its own", sha);
    }

    // The reported axes. `minimal-reported` leaves every one of them at the
    // floor: §1.6 makes them non-blocking, so the store must still be green.
    if (seed !== "minimal-reported") {
      db.prepare(
        "INSERT INTO field_notes (category, observation, location, ref_sha, session_id) VALUES ('pattern', ?, 'src/a01.js', ?, 'd1-session')",
      ).run("the synthetic field note", sha);
      db.prepare(
        "INSERT INTO open_questions (category, subsystem_id, question, session_id, ref_sha, resolution) VALUES ('scope-judgment','S-01',?, 'd1-session', ?, 'open')",
      ).run("what else is in scope?", sha);
      db.prepare(
        "INSERT INTO claims (claim_key, subject_type, subject_id, statement, epistemic_kind, asserted_at_sha, valid_from_sha, session_id) VALUES ('S-01/c1','subsystem','S-01',?, 'observation', ?, ?, 'd1-session')",
      ).run("the synthetic claim", sha, sha);
    }

    // The carried accounting B5 and B6 read.
    const carryRunId = Number(
      db
        .prepare(
          `INSERT INTO carry_runs (source_kind, source_path, archived_store_id, archived_anchor, reason, expected_count, imported_count, session_id)
           VALUES ('store', '/d1/fixture/memory.db', ?, ?, 'the synthetic carry', ?, ?, 'd1-session')`,
        )
        .run(archivedStoreId, archivedAnchor, carriedIds.length, carriedIds.length).lastInsertRowid,
    );
    const insertCarried = db.prepare(
      `INSERT INTO carried_findings
         (archived_finding_id, archived_store_id, archived_anchor_sha, subsystem_id, severity,
          symptom, root_cause, carry_run_id, archived_resolution, archived_ref_sha, carried_by_session)
       VALUES (?,?,?, 'S-01', 'MEDIUM', 'carried symptom', 'carried root cause', ?, 'open', ?, 'd1-session')`,
    );
    const insertOutcome = db.prepare(
      `INSERT INTO carried_finding_outcomes (carried_id, outcome, successor_id, repaired_sha, rationale, session_id, ref_sha)
       VALUES (?,?,?,?,?, 'd1-session', ?)`,
    );
    // B5's seeds: one id is simply not carried, or every id is carried under a
    // different store's name — which C24 makes a non-match rather than a match.
    const omitted = seed === "B5" ? carriedIds[0] : null;
    const storeIdForRows =
      seed === "B5-otherstore" ? "store-legacy-someotherstore" : archivedStoreId;
    for (const id of carriedIds) {
      if (id === omitted) continue;
      const carriedId = Number(
        insertCarried.run(id, storeIdForRows, archivedAnchor, carryRunId, sha).lastInsertRowid,
      );
      insertOutcome.run(
        carriedId,
        "ruled-out",
        null,
        null,
        "re-read at this revision and not reproduced",
        sha,
      );
    }
    // B6's seed: a carried record nobody decided. It is deliberately **not** one
    // of the baseline's open thirteen — §5.8 carries every archived finding,
    // whatever its archived state, and leaving one of the thirteen undecided
    // would fire B5 too, so a red on that store would prove nothing about B6.
    if (seed === "B6") {
      insertCarried.run("B02-9", storeIdForRows, archivedAnchor, carryRunId, sha);
    }
  } catch (error) {
    try {
      db.close();
    } catch {
      /* the failure is already the answer */
    }
    return {
      error: `building the ${name} store failed — ${error?.message ?? error}`,
    };
  }
  db.close();
  return { root, store, sha };
}

// ---------------------------------------------------------------------------
// Driving D0. Its stdout and stderr are captured, never inherited, so a crash
// inside it reaches this gate's output only through scrub().
// ---------------------------------------------------------------------------
function runDepthGate({ root = null, baseline = null, extraEnv = {} } = {}) {
  const env = { ...process.env, NODE_NO_WARNINGS: "1", ...extraEnv };
  if (root) env.AMANUENSIS_DEPTH_WORKSPACE = root;
  else delete env.AMANUENSIS_DEPTH_WORKSPACE;
  if (baseline !== null) env.AMANUENSIS_DEPTH_BASELINE = baseline;
  else delete env.AMANUENSIS_DEPTH_BASELINE;
  const result = spawnSync("node", [join(REPO, DEPTH_GATE_REL)], {
    cwd: REPO,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  const last = lines.length ? lines[lines.length - 1] : "";
  return {
    status: result.status,
    stdout,
    stderr,
    last,
    output: `${stdout}\n${stderr}`,
  };
}

/** The one-line summary of a D0 run, for a failure message that names it. */
function describe(run) {
  if (!run.last) {
    return `it printed no GATE D0 status line (exit ${run.status})`;
  }
  return `it exited ${run.status} printing ${JSON.stringify(run.last.slice(0, 200))}`;
}

/** D0 turned red, on its own predicate, without dying on the way there. */
function expectRed(run, predicate) {
  if (run.status === 0) return `it exited 0 — ${describe(run)}`;
  if (run.status === 2) {
    return `it exited 2 (cannot run), which §8.0 clause 3 forbids as a red — ${describe(run)}`;
  }
  if (!run.last.startsWith("GATE D0 RED: ")) return describe(run);
  if (predicate && !run.last.includes(predicate)) {
    return `it went red without naming ${predicate}, so the red cannot be attributed to the seeded fault — ${describe(run)}`;
  }
  return null;
}

function expectGreen(run) {
  if (run.status !== 0) return describe(run);
  if (run.last !== "GATE D0 GREEN") return describe(run);
  return null;
}

function expectCannotRun(run) {
  if (run.status === 0) return `it exited 0 — ${describe(run)}`;
  if (run.status !== 2) return `it exited ${run.status}, not 2 — ${describe(run)}`;
  if (!run.last.startsWith("GATE D0 CANNOT RUN: ")) return describe(run);
  return null;
}

// ---------------------------------------------------------------------------
// The fixture, and the thirteen ids the control store must account for.
// ---------------------------------------------------------------------------
emit("the frozen baseline fixture, as committed");

let baseline = null;
let baselineError = null;
if (!existsSync(join(REPO, BASELINE_REL))) {
  baselineError = `${BASELINE_REL} is absent, so the depth gate has no baseline to compare against`;
} else {
  try {
    baseline = JSON.parse(readFileSync(join(REPO, BASELINE_REL), "utf8"));
  } catch (error) {
    baselineError = `${BASELINE_REL} is not valid JSON — ${error?.message ?? error}`;
  }
}

const carriedIds = Array.isArray(baseline?.blocking?.open_findings)
  ? baseline.blocking.open_findings
  : [];
const archivedStoreId =
  typeof baseline?.archived_store_id === "string" ? baseline.archived_store_id : "store-absent";
const archivedAnchor =
  typeof baseline?.checked_sha === "string" ? baseline.checked_sha : "0".repeat(40);

check("the committed fixture reads as JSON and declares the baseline contract", () => {
  if (baselineError) return baselineError;
  if (baseline?.contract !== "amanuensis-survey-depth/baseline/v1") {
    return `it declares contract ${JSON.stringify(baseline?.contract ?? null)}`;
  }
  return null;
});

check("the fixture names the archived store and the revision it was measured at", () => {
  if (baselineError) return baselineError;
  if (!/^store-(legacy-)?[0-9a-f]{16}$/.test(String(baseline?.archived_store_id ?? ""))) {
    return `archived_store_id is ${JSON.stringify(baseline?.archived_store_id ?? null)}, which is not §5.3's shape`;
  }
  if (!/^[0-9a-f]{40}$/.test(String(baseline?.checked_sha ?? ""))) {
    return `checked_sha is ${JSON.stringify(baseline?.checked_sha ?? null)}, not a resolved 40-hex revision`;
  }
  return null;
});

check("the fixture carries the D1–D12 SQL verbatim and the thirteen baseline open findings", () => {
  if (baselineError) return baselineError;
  const queries = baseline?.queries ?? {};
  const missing = [
    "D1",
    "D2",
    "D3",
    "D4",
    "D5",
    "D6",
    "D7",
    "D8",
    "D9",
    "D10",
    "D11",
    "D12",
  ].filter((key) => !(key in queries));
  if (missing.length) return `queries carries no ${missing.join(", ")}`;
  const withSql = Object.values(queries).filter((value) =>
    (Array.isArray(value) ? value.join(" ") : String(value ?? "")).toUpperCase().includes("SELECT"),
  ).length;
  if (withSql < 10) return `only ${withSql} of the twelve query entries carry a SELECT`;
  if (carriedIds.length !== 13) {
    return `blocking.open_findings names ${carriedIds.length} finding(s); §1.3 measured thirteen`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// The must-stay-green control. Everything below is measured against it: a
// seeded red means nothing unless the same store without the seed is green.
// ---------------------------------------------------------------------------
emit("");
emit("the must-stay-green control store, and the reported axes that must not block");

const control = buildCase("control", {
  carriedIds,
  archivedStoreId,
  archivedAnchor,
});
const controlRun = control.error ? null : runDepthGate({ root: control.root });

check("the control store, which satisfies B1–B6, is green", () => {
  if (control.error) return control.error;
  return expectGreen(controlRun);
});

check("a control whose reported axes are all at the floor is still green", () => {
  const floor = buildCase("reported-floor", {
    seed: "minimal-reported",
    carriedIds,
    archivedStoreId,
    archivedAnchor,
  });
  if (floor.error) return floor.error;
  const run = runDepthGate({ root: floor.root });
  const wrong = expectGreen(run);
  if (wrong) {
    return `no field note, no open question and no claim turned the gate red, which is the quota decisions.md §3 forbids — ${wrong}`;
  }
  return null;
});

check("every reported axis is printed with its baseline and a signed delta", () => {
  if (control.error) return control.error;
  const missing = ["D1", "D4", "D5", "D6", "D7%", "D8", "D9", "D10", "D11"].filter(
    (axis) => !controlRun.stdout.includes(axis),
  );
  if (missing.length) return `the output names no ${missing.join(", ")} row`;
  if (!/[+−-]\d/.test(controlRun.stdout)) return "no signed delta is printed beside any axis";
  if (!/histogram/i.test(controlRun.stdout)) return "neither classification histogram is printed";
  return null;
});

check("every printed fraction carries its denominator", () => {
  if (control.error) return control.error;
  // A run that printed nothing has no fraction without a denominator and no
  // fraction with one. Reporting that as a pass is the zero-denominator green
  // this arm is about, one level up.
  if (!controlRun.last.startsWith("GATE D0 ")) {
    return `the control run printed no GATE D0 status line, so there are no fractions to read — ${describe(controlRun)}`;
  }
  // A rendered percentage always carries two decimals; an axis label like `D7%`
  // does not, so the two cannot be confused.
  const offenders = [];
  let rendered = 0;
  for (const line of controlRun.stdout.split("\n")) {
    for (const match of line.matchAll(/\d+\.\d+%/g)) {
      rendered += 1;
      const tail = line.slice(match.index + match[0].length);
      if (!/^\s*\(\d+\/\d+\)/.test(tail)) offenders.push(line.trim());
    }
  }
  if (offenders.length) {
    return `${offenders.length} percentage(s) print without an (n/d) denominator; first: ${JSON.stringify(offenders[0].slice(0, 160))}`;
  }
  if (rendered === 0) return "the gate printed no percentage at all, so nothing was compared";
  return null;
});

check("the obligation-bearing denominator counts deferred-with-reason paths", () => {
  if (control.error) return control.error;
  let contract = null;
  try {
    contract = JSON.parse(readFileSync(join(REPO, VOCABULARY_REL), "utf8"));
  } catch (error) {
    return `${VOCABULARY_REL} could not be read — ${error?.message ?? error}`;
  }
  const values = contract?.enums?.file_classification?.values ?? [];
  const deferred = values.find((value) => value?.value === "deferred-with-reason");
  if (!deferred) return `${VOCABULARY_REL} declares no deferred-with-reason classification`;
  if (deferred.obligation_bearing !== true) {
    return "the contract marks deferred-with-reason exempt, so §1.2's derivation has moved under this gate";
  }
  // Seventeen counts the three deferred paths; fourteen would exempt them.
  if (!controlRun.stdout.includes(`/${OBLIGATION_BEARING_PATHS})`)) {
    return `the gate printed no /${OBLIGATION_BEARING_PATHS}) denominator over a tree whose three deferred-with-reason paths the contract marks obligation-bearing`;
  }
  if (controlRun.stdout.includes(`/${OBLIGATION_BEARING_PATHS - 3})`)) {
    return `the gate printed a /${OBLIGATION_BEARING_PATHS - 3}) denominator, which exempts the three deferred-with-reason paths (D9/codex)`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// B1–B6, each seeded alone, each required to name itself.
// ---------------------------------------------------------------------------
emit("");
emit("the six blocking predicates, seeded one at a time into the store D0 executes over");

const SEEDS = [
  ["B1", "B1", "a tracked path with no ledger row, recorded honestly as unledgered = 1"],
  [
    "B1",
    "B1-stale",
    "a ledger edited after the reading, so the recorded reconciliation no longer stands",
  ],
  ["B2", "B2", "five examined paths reclassified, dropping the fraction below the baseline"],
  ["B2", "B2-zero", "every tracked path classified exempt, so the fraction has no denominator"],
  ["B3", "B3", "a disposition in a mapped subsystem with nothing attached"],
  ["B3", "B3-unresolvable", "an attachment whose revision this workspace cannot resolve"],
  ["B4", "B4", "a subsystem past structural with neither an anchored term nor a declination"],
  ["B5", "B5", "one of the baseline's open findings carried by nobody"],
  ["B5", "B5-otherstore", "every carried record named under a different archived store"],
  ["B6", "B6", "a carried record nobody decided"],
];

for (const [predicate, seed, what] of SEEDS) {
  check(`${predicate} — ${what}`, () => {
    const seeded = buildCase(`seed-${seed}`, {
      seed,
      carriedIds,
      archivedStoreId,
      archivedAnchor,
    });
    if (seeded.error) return seeded.error;
    const run = runDepthGate({ root: seeded.root });
    const wrong = expectRed(run, predicate);
    return wrong
      ? `the depth gate did not turn red on a seeded ${predicate} fault — ${wrong}`
      : null;
  });
}

// ---------------------------------------------------------------------------
// The gate's own inputs: an absent baseline, and no candidate at all.
// ---------------------------------------------------------------------------
emit("");
emit("the gate's own inputs — an absent denominator is not a pass (VP4(e))");

check("an absent baseline fixture is red, never green", () => {
  if (control.error) return control.error;
  const run = runDepthGate({
    root: control.root,
    baseline: join(scratch, "no-such-baseline.json"),
  });
  if (run.status === 0) return `the gate exited 0 with no baseline — ${describe(run)}`;
  if (run.status === 2)
    return `the gate reported cannot run for an absent committed fixture — ${describe(run)}`;
  if (!run.last.startsWith("GATE D0 RED: ")) return describe(run);
  return null;
});

check("an unreadable baseline fixture is red, never green", () => {
  if (control.error) return control.error;
  const broken = join(scratch, "broken-baseline.json");
  writeFileSync(broken, "{ this is not JSON\n");
  const run = runDepthGate({ root: control.root, baseline: broken });
  if (run.status === 0) return `the gate exited 0 over an unparseable fixture — ${describe(run)}`;
  if (!run.last.startsWith("GATE D0 RED: ")) return describe(run);
  return null;
});

check("a fixture bound to a different archived store is red", () => {
  if (control.error) return control.error;
  if (baselineError) return baselineError;
  const rebound = join(scratch, "rebound-baseline.json");
  writeFileSync(
    rebound,
    JSON.stringify({ ...baseline, archived_store_id: "store-legacy-0000000000000000" }, null, 2),
  );
  const run = runDepthGate({ root: control.root, baseline: rebound });
  const wrong = expectRed(run, "B5");
  return wrong
    ? `a baseline naming a store the carried records do not name was accepted — ${wrong}`
    : null;
});

check(
  "neither a live store nor a committed receipt is cannot run — not green, and not a red proof",
  () => {
    const bare = buildCase("no-candidate", { withStore: false });
    if (bare.error) return bare.error;
    const run = runDepthGate({ root: bare.root });
    const wrong = expectCannotRun(run);
    if (wrong) return `the gate did not reach §7.1's third state — ${wrong}`;
    if (!/no live store and no committed acceptance receipt/i.test(run.stdout)) {
      return `the cannot-run line does not name the two absent inputs: ${JSON.stringify(run.last.slice(0, 160))}`;
    }
    return null;
  },
);

// ---------------------------------------------------------------------------
// The receipt arm. §7.5's witnesses are recomputed; a recorded verdict is not
// evidence about the store it reports on (§8.8's forged green, one level down).
// ---------------------------------------------------------------------------
emit("");
emit("the receipt arm — every blocking verdict recomputed from row-level witnesses, never read");

/** A §7.5 receipt over a store this gate built, written from the store itself. */
function receiptFor(built, { forge = null } = {}) {
  if (!DatabaseSync) return { error: "this runtime carries no node:sqlite" };
  const db = new DatabaseSync(built.store, { readOnly: true });
  let receipt;
  try {
    const all = (sql, ...params) => db.prepare(sql).all(...params);
    const reconciliation = all("SELECT * FROM scope_reconciliations ORDER BY id DESC LIMIT 1")[0];
    const ledger = all("SELECT file_path, classification FROM file_ledger");
    const exemptSet = new Set(["generated-ignore", "vendor-ignore", "irrelevant"]);
    const tracked = new Set(trackedPathsAt(built.root, built.sha) ?? []);
    const obligationBearing = [...tracked].filter(
      (path) =>
        !ledger.some((row) => row.file_path === path && exemptSet.has(row.classification ?? "")),
    ).length;
    const examined = [...tracked].filter((path) =>
      ledger.some((row) => row.file_path === path && row.classification === "examined"),
    ).length;
    const statusById = new Map(
      all("SELECT id, status FROM subsystems").map((r) => [r.id, r.status]),
    );
    const evidenceById = new Map(
      all("SELECT id, ref_sha FROM evidence").map((r) => [r.id, r.ref_sha]),
    );
    const attachments = all(
      "SELECT subsystem_id, concern_code, evidence_id FROM disposition_evidence",
    );
    receipt = {
      contract: "amanuensis-survey-depth/acceptance-receipt/v1",
      repository_sha: built.sha,
      store: { store_id: "store-d1synthetic00", checked_sha: built.sha },
      baseline: {
        archived_store_id: archivedStoreId,
        checked_sha: archivedAnchor,
      },
      blocking: {
        B1: {
          verdict: "green",
          witness: {
            detected_sha: reconciliation.detected_sha,
            tree_digest: reconciliation.tree_digest,
            ledger_digest: reconciliation.ledger_digest,
            tracked_paths: reconciliation.tracked_paths,
            ledger_rows: reconciliation.ledger_rows,
            unledgered: reconciliation.unledgered,
            absent: reconciliation.absent,
            exempt: reconciliation.exempt,
          },
        },
        B2: {
          verdict: "green",
          examined,
          obligation_bearing: obligationBearing,
        },
        B3: {
          verdict: "green",
          dispositions: all("SELECT subsystem_id, concern_code FROM dispositions").map((row) => ({
            subsystem_id: row.subsystem_id,
            concern_code: row.concern_code,
            subsystem_status: statusById.get(row.subsystem_id) ?? "unmapped",
            attachments: attachments
              .filter(
                (a) => a.subsystem_id === row.subsystem_id && a.concern_code === row.concern_code,
              )
              .map((a) => ({
                evidence_id: a.evidence_id,
                ref_sha: evidenceById.get(a.evidence_id) ?? null,
                resolved: true,
              })),
          })),
        },
        B4: {
          verdict: "green",
          subsystems: all("SELECT id, status FROM subsystems").map((row) => ({
            id: row.id,
            status: row.status,
            terms: all(
              "SELECT v.term, v.first_seen FROM vocabulary v JOIN vocabulary_scopes s ON s.term = v.term WHERE s.subsystem_id = ?",
              row.id,
            ),
            declination:
              all(
                "SELECT id, ref_sha, session_id FROM vocabulary_declinations WHERE subsystem_id = ? ORDER BY id DESC LIMIT 1",
                row.id,
              )[0] ?? null,
          })),
        },
        B5: {
          verdict: "green",
          carried: all(
            `SELECT c.archived_store_id, c.archived_finding_id, o.outcome, o.repaired_sha
               FROM carried_findings c LEFT JOIN carried_finding_outcomes o ON o.carried_id = c.carried_id`,
          ).map((row) => ({ ...row, evidence_revisions: [] })),
        },
        B6: { verdict: "green" },
      },
      reported: {
        ledger_rows: ledger.length,
        evidence: all("SELECT COUNT(*) n FROM evidence")[0].n,
        dispositions: all("SELECT COUNT(*) n FROM dispositions")[0].n,
        attached_dispositions: new Set(
          attachments.map((a) => `${a.subsystem_id}/${a.concern_code}`),
        ).size,
        field_notes: all("SELECT COUNT(*) n FROM field_notes")[0].n,
        open_questions_all: all("SELECT COUNT(*) n FROM open_questions")[0].n,
        open_questions_open: all("SELECT COUNT(*) n FROM open_questions WHERE resolution='open'")[0]
          .n,
        anchored_terms: all(
          "SELECT COUNT(*) n FROM vocabulary WHERE first_seen IS NOT NULL AND TRIM(first_seen) <> ''",
        )[0].n,
        open_findings: all("SELECT COUNT(*) n FROM findings WHERE status='confirmed-bug'")[0].n,
        classification_histogram: Object.fromEntries(
          all(
            "SELECT COALESCE(classification,'(null)') k, COUNT(*) n FROM file_ledger GROUP BY 1 ORDER BY 1",
          ).map((row) => [row.k, row.n]),
        ),
      },
    };
  } finally {
    db.close();
  }
  if (forge) forge(receipt);
  return { receipt };
}

/**
 * A case whose candidate is a committed receipt: one workspace, its own store,
 * the receipt written from that store, and then — unless the arm is about both
 * arms at once — the store removed, so what D0 reads is the receipt alone.
 *
 * The receipt is written **inside** the workspace it was measured over, because
 * §7.5's witnesses are revisions: `git ls-tree` at the recorded `detected_sha`
 * has to answer, and it answers only where that commit lives.
 */
function receiptCase(name, { forge = null, keepStore = false } = {}) {
  const built = buildCase(name, {
    carriedIds,
    archivedStoreId,
    archivedAnchor,
  });
  if (built.error) return { error: built.error };
  const made = receiptFor(built, { forge });
  if (made.error) return { error: made.error };
  mkdirSync(join(built.root, "design/survey-depth"), { recursive: true });
  writeFileSync(join(built.root, RECEIPT_REL), `${JSON.stringify(made.receipt, null, 2)}\n`);
  if (!keepStore) {
    rmSync(join(built.root, ".amanuensis"), { recursive: true, force: true });
  }
  return { root: built.root };
}

check("a receipt whose witnesses satisfy B1–B6, with no live store, is green", () => {
  if (control.error) return control.error;
  const made = receiptCase("receipt-valid");
  if (made.error) return made.error;
  return expectGreen(runDepthGate({ root: made.root }));
});

check("a forged-green receipt — every verdict green, B3's witnesses unbacked — is red", () => {
  if (control.error) return control.error;
  const made = receiptCase("receipt-forged-b3", {
    forge: (receipt) => {
      for (const row of receipt.blocking.B3.dispositions) row.attachments = [];
    },
  });
  if (made.error) return made.error;
  const wrong = expectRed(runDepthGate({ root: made.root }), "B3");
  return wrong
    ? `the gate read "verdict": "green" instead of recomputing B3 from §7.5's witnesses — ${wrong}`
    : null;
});

check("a forged-green receipt whose B1 witness records 501 unledgered is red", () => {
  if (control.error) return control.error;
  const made = receiptCase("receipt-forged-b1", {
    forge: (receipt) => {
      receipt.blocking.B1.witness.unledgered = 501;
    },
  });
  if (made.error) return made.error;
  const wrong = expectRed(runDepthGate({ root: made.root }), "B1");
  return wrong ? `a recorded 501 unledgered passed as green — ${wrong}` : null;
});

check("a receipt bound to no revision of this repository is red", () => {
  if (control.error) return control.error;
  const made = receiptCase("receipt-unbound", {
    forge: (receipt) => {
      receipt.repository_sha = "0".repeat(40);
    },
  });
  if (made.error) return made.error;
  const run = runDepthGate({ root: made.root });
  if (run.status === 0) {
    return `the gate exited 0 over a receipt whose repository_sha is forty zeroes — ${describe(run)}`;
  }
  if (!run.last.startsWith("GATE D0 RED: ")) return describe(run);
  return null;
});

check("a forged-green receipt whose B3 witness cites an unreachable revision is red", () => {
  if (control.error) return control.error;
  const made = receiptCase("receipt-forged-b3-sha", {
    forge: (receipt) => {
      for (const row of receipt.blocking.B3.dispositions) {
        for (const attachment of row.attachments) attachment.ref_sha = "9".repeat(40);
      }
    },
  });
  if (made.error) return made.error;
  const wrong = expectRed(runDepthGate({ root: made.root }), "B3");
  return wrong
    ? `the recorded "resolved": true was taken on trust rather than re-resolved — ${wrong}`
    : null;
});

check("a receipt that disagrees with the live store beside it is red", () => {
  if (control.error) return control.error;
  const made = receiptCase("receipt-disagrees", {
    keepStore: true,
    forge: (receipt) => {
      receipt.blocking.B2.examined = receipt.blocking.B2.examined + 5;
    },
  });
  if (made.error) return made.error;
  const run = runDepthGate({ root: made.root });
  if (run.status === 0) {
    return `both arms ran and the gate exited 0 over a receipt that reports five more examined paths than the store holds — ${describe(run)}`;
  }
  if (!run.last.startsWith("GATE D0 RED: ")) return describe(run);
  return null;
});

// ---------------------------------------------------------------------------
// The recorder's third state (§7.2). The archive is machine-local, so the
// exit-2 path is the one every checkout can exercise — and the one that must
// never be a silent green.
// ---------------------------------------------------------------------------
emit("");
emit("the baseline recorder — a --check that cannot read its source says so");

function runRecorder(args, extraEnv = {}) {
  const result = spawnSync("node", [join(REPO, RECORDER_REL), ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status,
    output: `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`,
  };
}

check("--check exits 2, never 0, when the archived store is unreadable", () => {
  const run = runRecorder(["--check"], {
    AMANUENSIS_BASELINE_STORE: join(scratch, "no-such-archive/memory.db"),
  });
  if (run.status === 0) {
    return `it exited 0 with the archive absent, which is the zero-denominator green §7.2 refuses`;
  }
  if (run.status !== 2) {
    return `it exited ${run.status}, not 2 — ${JSON.stringify(scrub(run.output).trim().slice(-200))}`;
  }
  if (!/cannot run/i.test(run.output)) {
    return `it exited 2 without saying it cannot run — ${JSON.stringify(scrub(run.output).trim().slice(-200))}`;
  }
  return null;
});

check("--check exits 2 when the archive path names a file that is not a store", () => {
  const notAStore = join(scratch, "not-a-store.db");
  writeFileSync(notAStore, "this is not a SQLite database\n");
  const run = runRecorder(["--check"], {
    AMANUENSIS_BASELINE_STORE: notAStore,
  });
  if (run.status === 0) return "it exited 0 over a file that is not a store";
  if (run.status !== 2) {
    return `it exited ${run.status}, not 2 — ${JSON.stringify(scrub(run.output).trim().slice(-200))}`;
  }
  return null;
});

if (existsSync(ARCHIVE_PATH)) {
  check("--check exits 0 against the archived store the fixture was measured from", () => {
    const run = runRecorder(["--check"]);
    if (run.status !== 0) {
      return `it exited ${run.status} against the archive at ${ARCHIVE_PATH} — ${JSON.stringify(scrub(run.output).trim().slice(-400))}`;
    }
    return null;
  });
} else {
  note(
    `the archived store is not at ${ARCHIVE_PATH} on this machine, so the fixture could not be ` +
      "regenerated and compared here; the exit-2 arms above are what a clean checkout can prove " +
      "(§7.2, §8.0 clause 3)",
  );
}

// ---------------------------------------------------------------------------
// CI
// ---------------------------------------------------------------------------
emit("");
check("both gates run in CI", () => {
  const ci = existsSync(join(REPO, CI_REL)) ? readFileSync(join(REPO, CI_REL), "utf8") : null;
  if (ci === null) return `${CI_REL} is absent`;
  const missing = [DEPTH_GATE_COMMAND, GATE_COMMAND].filter((command) => !ci.includes(command));
  if (missing.length) return `${CI_REL} does not run ${missing.join(" or ")}`;
  return null;
});

finish(
  "the six blocking predicates seeded independently, the must-stay-green control, the gate's own " +
    "absent inputs, the receipt arm's recomputation, and the recorder's third state",
);
