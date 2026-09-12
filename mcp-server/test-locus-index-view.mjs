#!/usr/bin/env node
// Gate for reader-lenses packet P5 — the file_standing view, deterministic
// locus resolution, and the standing block it feeds
// (spec.md §2.1–§2.5, §10.1; claims C4, C5, C6, C8–C13, C55, C56, C57, C63).
//
// Turns red when:
//   - `file_standing` is absent from src/schema.sql, or does not return
//     exactly one row per `file_ledger` row;
//   - any declared (classification, stale, stale_reason) case resolves to a
//     standing_state other than the one this file names literally, or the
//     declared table stops covering all seven states of the `standing_state`
//     enum in contracts/conspectus-vocabulary.json;
//   - locus kind inference departs from §2.1's six-step order on any of its
//     six documented cases, or stops echoing the deciding step and the
//     split point;
//   - a resolvable non-ancestor ref_sha does not downgrade to examined-stale
//     with stale_reason `unreachable-ref`, an unresolvable one does not
//     downgrade with `unverifiable-ref`, or an unavailable git changes the
//     state instead of serving the examined-stale authorization text;
//   - `owners[]` omits a file_standing row, the headline state is one owner's
//     state rather than `mixed`, or the mandated field order is broken;
//   - the authority ceiling ranks a deferred owner, drops it from
//     `deferred_owners[]`, or loses the `mapped` caveat;
//   - `measured.ledger_reconciled` is non-null on a path with owner rows, or
//     the reconciliation receipt is not served in its place;
//   - any of the five `unknown[]` sources returns other than the exact rows
//     its SQL selects on a fixture seeded with partial coverage — in
//     particular a (owner, concern) pair whose concern is dispositioned in a
//     sibling subsystem, and a seam side with no SC-% disposition whose other
//     side holds one. A predicate quantified over "any owner" or "either
//     party" reports nothing on that fixture and turns this gate red (VP4);
//   - the materializer renders against a store that lacks `file_standing` or
//     `finding_state_current` instead of turning the publish red by name;
//   - the gate does not run in CI.
//
// False green it cannot exclude: the view's `COALESCE(classification,
// 'candidate')='candidate'` arm and its `ELSE` arm are interchangeable over
// the CHECK-constrained classification domain — every value that reaches
// `ELSE` is null, and both arms return `scoped-unread` for it — so rewriting
// one into the other is a no-op no assertion here can see, and none should.
// Beyond that: a *consistent* relabelling. If the
// standing_state literals were renamed in the view, in the enum source, and
// in this file together, every assertion below would still pass — the
// fixture table is the only independent statement of what each ledger shape
// means, and it is maintained by hand. It also cannot exclude a reachability
// rule that is right on this fixture's four revisions and wrong on a
// repository with grafted or shallow history, because the probe is only ever
// run here against a repository this file built.
//
// Output protocol: exactly one status line, last, on stdout. Every subprocess
// is captured and never echoed, and every message is scrubbed, so a missing
// deliverable reports as an assertion failure rather than as a crash.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MCP = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(MCP, "..");
const PY = process.env.AMANUENSIS_PYTHON ?? "python3";

const SCHEMA_REL = "mcp-server/src/schema.sql";
const CONTRACT_REL = "mcp-server/contracts/conspectus-vocabulary.json";
const MATERIALIZER_CORE_REL = "materializer/amanuensis_materializer/core.py";
const MATERIALIZER_DB_REL = "materializer/amanuensis_materializer/db.py";
const CI_REL = ".github/workflows/test.yml";

// §2.4.1's mandated owner field order and §2.4's mandated block order. Written
// out rather than derived so that reordering the implementation cannot also
// reorder what this gate expects.
const OWNER_FIELDS = [
  "subsystem_id",
  "subsystem_name",
  "classification",
  "standing_state",
  "authority_ceiling",
  "ref_sha",
  "examined_at",
  "stale",
  "stale_reason",
];
const BLOCK_FIELDS = ["owners", "state", "authority_ceiling", "revision", "measured", "unknown"];

// §2.4.3: the caveat the ceiling carries verbatim.
const CEILING_CAVEAT =
  "mapped is a workflow completion mark and is not itself proof that every finding survived challenge";

// §2.4.6: the per-party-proxy limitation every unassessed-seam entry states.
const SEAM_BINDING = "per-party-proxy; no seam-bound disposition is recorded";

// §2.2: the named cause the materializer refuses with.
const VIEW_ABSENT_CAUSE =
  "the store predates the reader-lens views; open it once with the current MCP server to create them";

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

function readText(absPath) {
  if (!existsSync(absPath)) return null;
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

function jsonEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// §2.2's state table, stated independently of the view's own CASE.
//
// Each case declares the ledger rows a path carries and the standing_state
// that follows. Single-row cases are asserted against `file_standing` itself;
// the zero-row and two-row cases are asserted against the headline state,
// which no single view row can produce. Together they cover all seven values
// of the `standing_state` enum, and the coverage is itself asserted against
// the enum source rather than against this list.
// ---------------------------------------------------------------------------
const STATE_CASES = [
  { path: "src/case/a.ts", rows: [["examined", 0, null]], expect: "examined" },
  { path: "src/case/b.ts", rows: [["examined", 1, "git-drift"]], expect: "examined-stale" },
  { path: "src/case/c.ts", rows: [["examined", 1, "unverifiable-ref"]], expect: "examined-stale" },
  { path: "src/case/d.ts", rows: [["examined", 1, "absent"]], expect: "absent" },
  { path: "src/case/e.ts", rows: [["examined", 0, "absent"]], expect: "absent" },
  { path: "src/case/f.ts", rows: [["candidate", 0, null]], expect: "scoped-unread" },
  { path: "src/case/g.ts", rows: [["candidate", 1, "git-drift"]], expect: "scoped-unread" },
  { path: "src/case/h.ts", rows: [[null, 0, null]], expect: "scoped-unread" },
  { path: "src/case/i.ts", rows: [[null, 1, "git-drift"]], expect: "scoped-unread" },
  { path: "src/case/j.ts", rows: [["generated-ignore", 0, null]], expect: "excluded" },
  { path: "src/case/k.ts", rows: [["vendor-ignore", 0, null]], expect: "excluded" },
  { path: "src/case/l.ts", rows: [["irrelevant", 0, null]], expect: "excluded" },
  { path: "src/case/m.ts", rows: [["deferred-with-reason", 1, "git-drift"]], expect: "excluded" },
  { path: "src/case/n.ts", rows: [["deferred-with-reason", 1, "absent"]], expect: "absent" },
  // Zero owner rows and no reconciliation record at all.
  { path: "src/case/o.ts", rows: [], expect: "unledgered" },
  // Zero owner rows, recorded absent by a reconciliation.
  { path: "src/case/p.ts", rows: [], gap: "absent", expect: "absent" },
  // Zero owner rows, recorded unledgered by a reconciliation. §2.2 reads
  // ledger_reconciled off this row and off no other.
  { path: "src/case/r.ts", rows: [], gap: "unledgered", expect: "unledgered" },
  // Two owners that disagree. §2.4.2 forbids presenting either as the file's.
  {
    path: "src/case/q.ts",
    rows: [["examined", 0, null], ["candidate", 0, null]],
    expect: "mixed",
  },
];

// ---------------------------------------------------------------------------
// Server bundle. Loaded defensively: an unbuilt or absent deliverable must
// read as an assertion failure, not as a crashed gate.
// ---------------------------------------------------------------------------
let betterSqlite = null;
try {
  betterSqlite = (await import("better-sqlite3")).default;
} catch {
  betterSqlite = null;
}

// A second copy of the built server whose schema.sql this gate controls.
// `findSchemaPath` resolves `dist/db.js` against `../src/schema.sql`, so a
// scratch tree of `dist/` beside a trimmed `src/schema.sql` is what lets the
// open-time view guard be exercised rather than merely read. The tree lives
// under mcp-server/ so that `better-sqlite3` still resolves.
const scratchRoots = [];
let trimmedDb = null;
let trimmedError = null;
try {
  const scratch = mkdtempSync(join(MCP, ".locus-standing-scratch-"));
  scratchRoots.push(scratch);
  cpSync(join(MCP, "dist"), join(scratch, "dist"), { recursive: true });
  mkdirSync(join(scratch, "src"), { recursive: true });
  const schema = readFileSync(join(REPO, SCHEMA_REL), "utf8");
  const trimmed = schema.replace(
    /CREATE VIEW IF NOT EXISTS file_standing AS[\s\S]*?;\n/,
    "-- file_standing removed by the P5 gate\n",
  );
  if (trimmed === schema) trimmedError = "the file_standing view could not be removed";
  writeFileSync(join(scratch, "src", "schema.sql"), trimmed);
  trimmedDb = await import(pathToFileURL(join(scratch, "dist", "db.js")).href);
} catch (e) {
  trimmedError = `the scratch server copy could not be built — ${e && e.message ? e.message : e}`;
}

let mods = null;
let loadError = null;
try {
  const [db, project, standing] = await Promise.all([
    import("./dist/db.js"),
    import("./dist/project.js"),
    import("./dist/standing.js"),
  ]);
  mods = { db, project, standing };
} catch (e) {
  loadError = e && e.message ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const roots = [];
function tempRoot(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} did not succeed`);
  return String(result.stdout ?? "").trim();
}

let fixture = null;
let fixtureError = loadError ? `the standing module could not be loaded — ${loadError}` : null;

function buildFixture() {
  const root = tempRoot("amanuensis-locus-standing-");
  const workspace = join(root, "workspace");
  const storageRoot = join(root, "storage-root");
  const bare = join(root, "not-a-repository");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  mkdirSync(bare, { recursive: true });
  git(workspace, "init", "-q", "-b", "main");
  git(workspace, "config", "user.email", "test@localhost");
  git(workspace, "config", "user.name", "Locus Standing Test");
  git(workspace, "config", "commit.gpgsign", "false");
  const commit = (body, message) => {
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(join(workspace, "src", "ledger.ts"), body);
    git(workspace, "add", "src/ledger.ts");
    git(workspace, "commit", "-q", "--no-verify", "-m", message);
    return git(workspace, "rev-parse", "HEAD");
  };
  const base = commit("export const row = 1;\n", "base");
  // A commit on a branch that is never merged: it resolves, and it is not an
  // ancestor of HEAD. §2.2's `unreachable-ref` row exists for exactly this.
  git(workspace, "checkout", "-q", "-b", "aside");
  const aside = commit("export const row = 99;\n", "aside");
  git(workspace, "checkout", "-q", "main");
  const head = commit("export const row = 2;\n", "head");

  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
  const project = mods.project.resolveProject(workspace, {
    selectionSource: "test-locus-index-view",
    serverVersion: "test",
  });
  mods.project.ensureProjectStorage(project, (dbPath) => mods.db.openDatabase(dbPath).close());
  const db = mods.db.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  const noGitCtx = { ...ctx, project: { ...project, workspacePath: bare } };

  db.prepare("INSERT INTO sessions (session_id, intent) VALUES ('standing', 'p5-gate')").run();
  ctx.sessionId = "standing";

  const subsystem = db.prepare(
    "INSERT INTO subsystems (id, name, status, layer, scope, notes) VALUES (?, ?, ?, 'core', 'src/**', ?)",
  );
  subsystem.run("B-01", "Ledger", "concerns", null);
  subsystem.run("B-02", "Index", "mapped", null);
  subsystem.run("B-03", "Archive", "deferred", "set aside until the rewrite lands");
  subsystem.run("B-04", "Seams", "mapped", null);
  subsystem.run("B-05", "Elsewhere", "scoping", null);
  subsystem.run("B-09", "Cases", "mapped", null);

  const ledger = db.prepare(
    `INSERT INTO file_ledger
       (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at, stale, stale_reason)
     VALUES (?, ?, 'standing fixture', ?, ?, ?, ?, ?)`,
  );
  const examinedAt = "2026-09-01 12:00:00";

  // The declared state table.
  for (const testCase of STATE_CASES) {
    for (const [index, [classification, stale, reason]] of testCase.rows.entries()) {
      ledger.run(
        index === 0 ? "B-09" : "B-05",
        testCase.path,
        classification,
        classification === "examined" ? base : null,
        classification === "examined" ? examinedAt : null,
        stale,
        reason,
      );
    }
    if (testCase.gap) {
      db.prepare(
        "INSERT INTO scope_gaps (file_path, kind, subsystem_id, detected_sha) VALUES (?, ?, ?, ?)",
      ).run(testCase.path, testCase.gap, testCase.gap === "absent" ? "B-09" : null, base);
    }
  }

  // The locus under most of the assertions below: two owners that disagree.
  ledger.run("B-01", "src/ledger.ts", "examined", base, examinedAt, 0, null);
  ledger.run("B-02", "src/ledger.ts", "candidate", null, null, 0, null);
  // Candidate siblings, one in each owner subsystem.
  ledger.run("B-01", "src/pending-a.ts", "candidate", null, null, 0, null);
  ledger.run("B-02", "src/pending-b.ts", "candidate", null, null, 0, null);
  // A candidate outside both owner subsystems: never a sibling of the locus.
  ledger.run("B-05", "src/pending-c.ts", "candidate", null, null, 0, null);
  // Single-owner paths for the reachability arms.
  ledger.run("B-02", "src/only.ts", "examined", base, examinedAt, 0, null);
  ledger.run("B-02", "src/unreachable.ts", "examined", aside, examinedAt, 0, null);
  ledger.run("B-02", "src/unverifiable.ts", "examined", "0".repeat(40), examinedAt, 0, null);
  // Ceiling arms: one deferred owner beside a ranked one, and all-deferred.
  ledger.run("B-01", "src/archive.ts", "examined", base, examinedAt, 0, null);
  ledger.run("B-03", "src/archive.ts", "examined", base, examinedAt, 0, null);
  ledger.run("B-03", "src/set-aside.ts", "examined", base, examinedAt, 0, null);

  const concern = db.prepare(
    "INSERT INTO concerns (code, category, origin, status) VALUES (?, 'data-integrity', 'seeded', ?)",
  );
  concern.run("CC-1", "active");
  concern.run("CC-2", "active");
  concern.run("SC-1", "active");
  concern.run("CC-9", "retired");

  const disposition = db.prepare(
    `INSERT INTO dispositions (subsystem_id, concern_code, classification, rationale, ref_sha)
     VALUES (?, ?, ?, 'standing fixture', ?)`,
  );
  disposition.run("B-01", "CC-1", "confirmed-acceptable", base);
  disposition.run("B-02", "CC-1", "ruled-out", base);
  // CC-2 is dispositioned in B-02 only. A predicate quantified over "any
  // owner" would therefore report no gap for B-01, which is the zero
  // denominator §2.4.6 re-bases onto the pair.
  disposition.run("B-02", "CC-2", "confirmed-acceptable", base);
  // The only SC-% disposition in the fixture, and it is on B-04.
  disposition.run("B-04", "SC-1", "confirmed-acceptable", base);
  // A disposition on a retired concern: never an unknown.
  disposition.run("B-01", "CC-9", "ruled-out", base);

  const seam = db.prepare(
    `INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b)
     VALUES (?, ?, 'table', ?, ?)`,
  );
  // Both parties mapped, so assessable = 1; B-04 holds SC-1 and B-02 does not.
  seam.run("SM-01", "ledger rows", "B-02", "B-04");
  // B-01 is not mapped, so this seam is not assessable on either side.
  seam.run("SM-02", "index cursor", "B-01", "B-02");
  // A seam neither party of which owns the locus.
  seam.run("SM-03", "elsewhere", "B-04", "B-05");

  const question = db.prepare(
    `INSERT INTO open_questions (id, category, subsystem_id, question, resolution)
     VALUES (?, 'scope-judgment', ?, ?, ?)`,
  );
  question.run(1, "B-01", "does the ledger own its own compaction?", "open");
  question.run(2, "B-05", "is the elsewhere module in scope?", "open");
  question.run(3, "B-01", "which branch is canonical?", "answered");

  const note = db.prepare(
    `INSERT INTO field_notes (id, category, observation, location, follow_up)
     VALUES (?, 'anomaly', ?, ?, ?)`,
  );
  note.run(1, "the row writer retries without a bound", "src/ledger.ts", "open");
  note.run(2, "the guard is asserted in a comment", `src/ledger.ts:row@${base}`, "open");
  note.run(3, "two directories share a writer", "src/, docs/", "open");
  note.run(4, "the subsystem has no owner of record", "B-01", "open");
  note.run(5, "an unrelated path", "src/other.ts", "open");
  note.run(6, "already followed up", "src/ledger.ts", "dismissed");

  db.prepare(
    `INSERT INTO evidence (id, file_path, symbol, ref_sha, kind, note)
     VALUES (?, ?, ?, ?, ?, 'standing fixture')`,
  ).run(1, "src/ledger.ts", "writeRow", base, "code-verified");
  db.prepare(
    `INSERT INTO evidence (id, file_path, symbol, ref_sha, kind, note)
     VALUES (?, ?, ?, ?, ?, 'standing fixture')`,
  ).run(2, "src/ledger.ts", "writeRow (retry fence re-check)", base, "contract-stated");
  db.prepare(
    `INSERT INTO evidence (id, file_path, symbol, ref_sha, kind, note)
     VALUES (?, ?, ?, ?, ?, 'standing fixture')`,
  ).run(3, "src/ledger.ts", "Ledger::writeRow", base, "code-verified");
  // A qualified symbol with no exact row anywhere: §2.5 reports it under
  // `match: "prefix"` and never as a citation of `compact` itself.
  db.prepare(
    `INSERT INTO evidence (id, file_path, symbol, ref_sha, kind, note)
     VALUES (?, ?, ?, ?, ?, 'standing fixture')`,
  ).run(4, "src/ledger.ts", "compact (bounded retry)", base, "comment-asserted");
  // Evidence on another path, so `measured.evidence_rows` has a denominator
  // it can get wrong: a count taken over the whole table reads 5 here.
  db.prepare(
    `INSERT INTO evidence (id, file_path, symbol, ref_sha, kind, note)
     VALUES (?, ?, ?, ?, ?, 'standing fixture')`,
  ).run(5, "src/only.ts", "readRow", base, "code-verified");

  // One current claim and one superseded claim, both bound to the locus
  // through the same evidence row. `measured.claims_recorded` counts the
  // current one only: a superseded claim is a historical reading, and
  // counting it would report authority the store has already withdrawn.
  const claim = db.prepare(
    `INSERT INTO claims
       (claim_id, claim_key, subject_type, subject_id, statement, epistemic_kind,
        asserted_at_sha, valid_from_sha, valid_until_sha, session_id)
     VALUES (?, ?, 'symbol', ?, ?, 'observation', ?, ?, ?, 'standing')`,
  );
  claim.run("CL-1", "ledger/writeRow/bound", "src/ledger.ts:writeRow",
    "the row writer retries under a bound", base, base, null);
  claim.run("CL-0", "ledger/writeRow/unbounded", "src/ledger.ts:writeRow",
    "the row writer retries without a bound", base, base, head);
  for (const claimId of ["CL-1", "CL-0"]) {
    db.prepare("INSERT INTO claim_evidence (claim_id, evidence_id, role) VALUES (?, 1, 'supports')").run(
      claimId,
    );
  }

  db.prepare(
    `INSERT INTO vocabulary (term, gloss, subsystem_id, first_seen, ref_sha)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("Severity (sh:Violation / sh:Warning / sh:Info)", "the shape severity ladder", "B-01", null, base);
  for (const [term, gloss] of [
    ["compaction", "folding the ledger into one revision"],
    ["compaction-window", "the interval a compaction may span"],
    ["comparator", "the ordering the ledger sorts rows by"],
    ["cursor", "the position a reader resumes from"],
    ["custody", "which session may write a page"],
    ["collation", "systematic comparison of witnesses"],
  ]) {
    db.prepare("INSERT INTO vocabulary (term, gloss, ref_sha) VALUES (?, ?, ?)").run(
      term,
      gloss,
      base,
    );
  }

  db.prepare(
    `INSERT INTO git_state (repo_id, canonical_branch, last_checked_sha, last_checked_at, onboarding_sha)
     VALUES ('default', 'main', ?, '2026-09-11 01:30:50', ?)`,
  ).run(base, base);

  const clone = join(root, "tracking-clone");
  const cloned = spawnSync("git", ["clone", "-q", "--origin", "upstream", workspace, clone], {
    encoding: "utf8",
  });
  const upstreamCtx =
    cloned.status === 0 ? { ...ctx, project: { ...project, workspacePath: clone } } : null;

  // A clone with the conventional `origin` remote whose branch records no
  // upstream at all: only the refs/remotes/origin/<branch> fallback can
  // resolve a head here.
  const conventional = join(root, "conventional-clone");
  const clonedConventional = spawnSync("git", ["clone", "-q", workspace, conventional], {
    encoding: "utf8",
  });
  let conventionalCtx = null;
  if (clonedConventional.status === 0) {
    spawnSync("git", ["-C", conventional, "config", "--unset", "branch.main.remote"]);
    spawnSync("git", ["-C", conventional, "config", "--unset", "branch.main.merge"]);
    conventionalCtx = { ...ctx, project: { ...project, workspacePath: conventional } };
  }

  return {
    root,
    workspace,
    bare,
    clone,
    storageRoot,
    base,
    aside,
    head,
    project,
    db,
    ctx,
    noGitCtx,
    upstreamCtx,
    conventionalCtx,
  };
}

if (!fixtureError) {
  try {
    fixture = buildFixture();
  } catch (e) {
    fixtureError = `the fixture could not be built — ${e && e.message ? e.message : e}`;
  }
}

function needFixture() {
  return fixtureError ?? null;
}

function standingOf(path, ctx = fixture.ctx) {
  return mods.standing.describeLocusStanding(ctx, path);
}

// ---------------------------------------------------------------------------
// 1. The view
// ---------------------------------------------------------------------------
emit("file_standing — the per-owner predicate");

check("schema.sql defines the file_standing view", () => {
  const schema = readText(join(REPO, SCHEMA_REL));
  if (schema === null) return `${SCHEMA_REL} is absent`;
  if (!/CREATE\s+VIEW\s+IF\s+NOT\s+EXISTS\s+file_standing\b/i.test(schema))
    return "schema.sql does not create the file_standing view";
  if (!/FROM\s+file_ledger\s+l/i.test(schema))
    return "the file_standing view does not select from file_ledger";
  return null;
});

check("file_standing returns exactly one row per file_ledger row", () => {
  const gap = needFixture();
  if (gap) return gap;
  const ledgerRows = fixture.db.prepare("SELECT COUNT(*) AS n FROM file_ledger").get().n;
  const standingRows = fixture.db.prepare("SELECT COUNT(*) AS n FROM file_standing").get().n;
  if (ledgerRows !== standingRows)
    return `file_ledger has ${ledgerRows} row(s) and file_standing ${standingRows}`;
  const orphans = fixture.db
    .prepare(
      `SELECT COUNT(*) AS n FROM file_ledger l
         WHERE NOT EXISTS (SELECT 1 FROM file_standing s
                            WHERE s.subsystem_id = l.subsystem_id AND s.file_path = l.file_path)`,
    )
    .get().n;
  return orphans === 0 ? null : `${orphans} ledger row(s) have no file_standing row`;
});

check("the declared table covers every standing_state the enum source names", () => {
  const contract = readText(join(REPO, CONTRACT_REL));
  if (contract === null) return `${CONTRACT_REL} is absent`;
  let declared;
  try {
    declared = JSON.parse(contract).enums?.standing_state?.values?.map((v) => v.value) ?? [];
  } catch (e) {
    return `the enum source could not be parsed — ${e && e.message ? e.message : e}`;
  }
  const covered = new Set(STATE_CASES.map((c) => c.expect));
  const missing = declared.filter((value) => !covered.has(value));
  const extra = [...covered].filter((value) => !declared.includes(value));
  if (declared.length !== 7)
    return `the enum source names ${declared.length} standing states, not seven`;
  if (missing.length) return `the declared table covers no case for: ${missing.join(", ")}`;
  if (extra.length) return `the declared table expects states the enum source omits: ${extra.join(", ")}`;
  return null;
});

for (const testCase of STATE_CASES.filter((c) => c.rows.length === 1)) {
  const [classification, stale, reason] = testCase.rows[0];
  const shape = `classification=${classification ?? "NULL"} stale=${stale} stale_reason=${reason ?? "NULL"}`;
  check(`${shape} is ${testCase.expect}`, () => {
    const gap = needFixture();
    if (gap) return gap;
    const row = fixture.db
      .prepare("SELECT standing_state FROM file_standing WHERE file_path = ?")
      .get(testCase.path);
    if (!row) return `file_standing has no row for ${testCase.path}`;
    return row.standing_state === testCase.expect
      ? null
      : `expected standing_state ${testCase.expect}, the view returned ${row.standing_state}`;
  });
}

for (const testCase of STATE_CASES) {
  check(`the headline state for ${testCase.path} is ${testCase.expect}`, () => {
    const gap = needFixture();
    if (gap) return gap;
    const { standing } = standingOf(testCase.path);
    return standing.state === testCase.expect
      ? null
      : `expected standing_state ${testCase.expect} as the headline, read ${standing.state}`;
  });
}

// ---------------------------------------------------------------------------
// 2. Locus kind inference, §2.1's six steps in order
// ---------------------------------------------------------------------------
emit("");
emit("locus kind inference — the six-step order");

const INFERENCE_CASES = [
  {
    label: "an exact subsystem id resolves at step 1",
    value: "B-01",
    kind: "subsystem",
    step: "subsystem-id",
  },
  {
    label: "a vocabulary term containing a colon resolves at step 2, not as a symbol",
    value: "Severity (sh:Violation / sh:Warning / sh:Info)",
    kind: "term",
    step: "vocabulary-term",
  },
  {
    label: "a Rust Type::method citation splits at the first colon at step 3",
    value: "src/ledger.ts:Ledger::writeRow",
    kind: "symbol",
    step: "colon-split",
    path: "src/ledger.ts",
    symbol: "Ledger::writeRow",
    split_at: 13,
  },
  {
    label: "a path a table names resolves at step 4",
    value: "src/ledger.ts",
    kind: "file",
    step: "ledgered-path",
    path: "src/ledger.ts",
  },
  {
    label: "a path-shaped string no table names resolves at step 5, unledgered",
    value: "src/never-reconciled.ts",
    kind: "file",
    step: "path-shaped",
    path: "src/never-reconciled.ts",
    state: "unledgered",
  },
  {
    label: "a bare term resolves at step 6, not-defined",
    value: "quiescence",
    kind: "term",
    step: "bare-term",
    state: "not-defined",
  },
];

for (const inference of INFERENCE_CASES) {
  check(inference.label, () => {
    const gap = needFixture();
    if (gap) return gap;
    const { locus, standing } = standingOf(inference.value);
    const problems = [];
    if (locus.kind !== inference.kind)
      problems.push(`kind ${locus.kind}, expected ${inference.kind}`);
    if (locus.kind_inferred_by !== inference.step)
      problems.push(`kind_inferred_by ${locus.kind_inferred_by}, expected ${inference.step}`);
    if (inference.path !== undefined && locus.path !== inference.path)
      problems.push(`path ${locus.path}, expected ${inference.path}`);
    if (inference.symbol !== undefined && locus.symbol !== inference.symbol)
      problems.push(`symbol ${locus.symbol}, expected ${inference.symbol}`);
    if (inference.split_at !== undefined && locus.split_at !== inference.split_at)
      problems.push(`split_at ${locus.split_at}, expected ${inference.split_at}`);
    if (inference.state !== undefined && standing.state !== inference.state)
      problems.push(`state ${standing.state}, expected ${inference.state}`);
    return problems.length ? problems.join("; ") : null;
  });
}

check("the six inference steps are declared in §2.1's order", () => {
  const gap = needFixture();
  if (gap) return gap;
  const order = mods.standing.LOCUS_INFERENCE_ORDER;
  const expected = [
    "subsystem-id",
    "vocabulary-term",
    "colon-split",
    "ledgered-path",
    "path-shaped",
    "bare-term",
  ];
  return jsonEq([...(order ?? [])], expected)
    ? null
    : `the declared order is ${JSON.stringify(order)}`;
});

check("a caller-supplied kind overrides inference and says so, for every kind", () => {
  const gap = needFixture();
  if (gap) return gap;
  const problems = [];
  for (const [value, forced] of [
    ["B-01", "term"],
    ["B-01", "file"],
    ["src/ledger.ts", "subsystem"],
    ["src/ledger.ts:writeRow", "symbol"],
    ["compaction", "file"],
  ]) {
    const { locus } = mods.standing.describeLocusStanding(fixture.ctx, value, forced);
    if (locus.kind !== forced) problems.push(`${value} as ${forced} kinded ${locus.kind}`);
    if (locus.kind_inferred_by !== "caller-supplied")
      problems.push(`${value} as ${forced} reports step ${locus.kind_inferred_by}`);
  }
  return problems.length ? problems.join("; ") : null;
});

// ---------------------------------------------------------------------------
// 3. Reachability, decided in code after the view returns `examined`
// ---------------------------------------------------------------------------
emit("");
emit("reachability — three outcomes, two reasons");

check("a resolvable ancestor keeps examined and records the check", () => {
  const gap = needFixture();
  if (gap) return gap;
  const { standing } = standingOf("src/only.ts");
  if (standing.state !== "examined") return `state ${standing.state}, expected examined`;
  if (standing.reachability_checked !== true) return "reachability_checked is not true";
  if (standing.authorization_downgraded != null)
    return `authorization was downgraded to ${standing.authorization_downgraded}`;
  return null;
});

check("a resolvable non-ancestor downgrades with unreachable-ref", () => {
  const gap = needFixture();
  if (gap) return gap;
  const { standing } = standingOf("src/unreachable.ts");
  const owner = standing.owners?.[0] ?? {};
  if (standing.state !== "examined-stale") return `state ${standing.state}`;
  if (owner.stale_reason !== "unreachable-ref") return `stale_reason ${owner.stale_reason}`;
  return null;
});

check("an unresolvable revision downgrades with unverifiable-ref", () => {
  const gap = needFixture();
  if (gap) return gap;
  const { standing } = standingOf("src/unverifiable.ts");
  const owner = standing.owners?.[0] ?? {};
  if (standing.state !== "examined-stale") return `state ${standing.state}`;
  if (owner.stale_reason !== "unverifiable-ref") return `stale_reason ${owner.stale_reason}`;
  return null;
});

check("with git unavailable the state stays examined and the authorization does not", () => {
  const gap = needFixture();
  if (gap) return gap;
  const contract = readText(join(REPO, CONTRACT_REL));
  if (contract === null) return `${CONTRACT_REL} is absent`;
  const values = JSON.parse(contract).enums?.standing_state?.values ?? [];
  const stale = values.find((v) => v.value === "examined-stale") ?? {};
  const { standing } = standingOf("src/only.ts", fixture.noGitCtx);
  const problems = [];
  if (standing.state !== "examined") problems.push(`state ${standing.state}, expected examined`);
  if (standing.reachability_checked !== false) problems.push("reachability_checked is not false");
  if (standing.authorization_downgraded !== "reachability-unchecked")
    problems.push(`authorization_downgraded ${standing.authorization_downgraded}`);
  if (standing.authorizes !== stale.authorizes)
    problems.push("authorizes is not the examined-stale text");
  if (standing.cannot_justify !== stale.cannot_justify)
    problems.push("cannot_justify is not the examined-stale text");
  return problems.length ? problems.join("; ") : null;
});

// ---------------------------------------------------------------------------
// 4. owners[], the headline, and the authority ceiling
// ---------------------------------------------------------------------------
emit("");
emit("owners, headline, ceiling");

check("owners[] lists every file_standing row in the mandated field order", () => {
  const gap = needFixture();
  if (gap) return gap;
  const { standing } = standingOf("src/ledger.ts");
  const rows = fixture.db
    .prepare("SELECT subsystem_id FROM file_standing WHERE file_path = ? ORDER BY subsystem_id")
    .all("src/ledger.ts")
    .map((r) => r.subsystem_id);
  const listed = (standing.owners ?? []).map((o) => o.subsystem_id);
  if (!jsonEq(listed, rows)) return `owners ${JSON.stringify(listed)} against rows ${JSON.stringify(rows)}`;
  for (const owner of standing.owners) {
    const keys = Object.keys(owner).slice(0, OWNER_FIELDS.length);
    if (!jsonEq(keys, OWNER_FIELDS)) return `owner field order is ${JSON.stringify(keys)}`;
  }
  const names = (standing.owners ?? []).map((o) => `${o.subsystem_id}=${o.subsystem_name}`);
  if (!jsonEq(names, ["B-01=Ledger", "B-02=Index"]))
    return `owner names are ${JSON.stringify(names)}`;
  const blockKeys = Object.keys(standing).slice(0, BLOCK_FIELDS.length);
  return jsonEq(blockKeys, BLOCK_FIELDS) ? null : `block field order is ${JSON.stringify(blockKeys)}`;
});

check("disagreeing owners make the headline mixed, not either owner's state", () => {
  const gap = needFixture();
  if (gap) return gap;
  const { standing } = standingOf("src/ledger.ts");
  const states = (standing.owners ?? []).map((o) => o.standing_state).sort();
  if (!jsonEq(states, ["examined", "scoped-unread"]))
    return `owner states ${JSON.stringify(states)}`;
  if (standing.state !== "mixed") return `expected standing_state mixed, read ${standing.state}`;
  // §2.3: mixed authorizes only what the weakest owner authorizes.
  const contract = JSON.parse(readText(join(REPO, CONTRACT_REL)) ?? "{}");
  const weakest = (contract.enums?.standing_state?.values ?? []).find(
    (v) => v.value === "scoped-unread",
  );
  return standing.authorizes === weakest?.authorizes
    ? null
    : "mixed does not authorize what the weakest owner authorizes";
});

check("a deferred owner is excluded from the ceiling rank and listed separately", () => {
  const gap = needFixture();
  if (gap) return gap;
  const { standing } = standingOf("src/archive.ts");
  const ceiling = standing.authority_ceiling ?? {};
  const problems = [];
  if (ceiling.value !== "concerns") problems.push(`ceiling value ${ceiling.value}`);
  const deferred = (ceiling.deferred_owners ?? []).map((d) => d.subsystem_id);
  if (!jsonEq(deferred, ["B-03"])) problems.push(`deferred_owners ${JSON.stringify(deferred)}`);
  if ((ceiling.deferred_owners ?? [])[0]?.reason !== "set aside until the rewrite lands")
    problems.push("the deferred owner carries no recorded reason");
  if (
    String(ceiling.deferred_note ?? "") !==
    "1 owning subsystem(s) are deferred; nothing was surveyed there."
  )
    problems.push(`the ceiling deferral note is ${JSON.stringify(ceiling.deferred_note)}`);
  if (!String(ceiling.caveat ?? "").includes(CEILING_CAVEAT))
    problems.push("the ceiling drops the mapped caveat");
  return problems.length ? problems.join("; ") : null;
});

check("an all-deferred file has ceiling deferred and authorizes nothing", () => {
  const gap = needFixture();
  if (gap) return gap;
  const ceiling = standingOf("src/set-aside.ts").standing.authority_ceiling ?? {};
  if (ceiling.value !== "deferred") return `ceiling value ${ceiling.value}`;
  if (ceiling.authorizes !== "nothing") return `ceiling authorizes ${ceiling.authorizes}`;
  if (!String(ceiling.deferred_note ?? "").includes("nothing was surveyed there"))
    return "the all-deferred ceiling carries no deferral note";
  return String(ceiling.cannot_justify ?? "").includes("content or behavior")
    ? null
    : "the all-deferred ceiling does not refuse claims about content or behavior";
});

// ---------------------------------------------------------------------------
// 5. revision and measured
// ---------------------------------------------------------------------------
emit("");
emit("revision and measured");

check("revision reports the checked revision, the head, and their disagreement", () => {
  const gap = needFixture();
  if (gap) return gap;
  const revision = standingOf("src/ledger.ts").standing.revision ?? {};
  const problems = [];
  if (revision.checked_sha !== fixture.base) problems.push(`checked_sha ${revision.checked_sha}`);
  if (revision.checked_at !== "2026-09-11 01:30:50") problems.push(`checked_at ${revision.checked_at}`);
  if (revision.repository_head !== fixture.head)
    problems.push(`repository_head ${revision.repository_head}`);
  if (revision.origin_head !== null) problems.push(`origin_head ${revision.origin_head}`);
  if (revision.agrees !== false) problems.push(`agrees ${revision.agrees}`);
  if (revision.unchecked_since !== fixture.base)
    problems.push(`unchecked_since ${revision.unchecked_since}`);
  return problems.length ? problems.join("; ") : null;
});

check("origin_head resolves the ref the branch tracks, whatever the remote is named", () => {
  const gap = needFixture();
  if (gap) return gap;
  if (!fixture.upstreamCtx) return "the tracking clone could not be created";
  // The clone's only remote is `upstream`, so a reader that looks up
  // refs/remotes/origin/<branch> finds nothing and reports no upstream at all.
  const tracking = standingOf("src/only.ts", fixture.upstreamCtx).standing.revision ?? {};
  if (tracking.origin_head !== fixture.head)
    return `origin_head ${tracking.origin_head}, expected ${fixture.head}`;
  if (!fixture.conventionalCtx) return "the conventional clone could not be created";
  // A clone that records no upstream but does carry refs/remotes/origin/main:
  // the fallback is the only thing that can resolve a head here.
  const fallback = standingOf("src/only.ts", fixture.conventionalCtx).standing.revision ?? {};
  if (fallback.origin_head !== fixture.head)
    return `the origin/<branch> fallback reported ${fallback.origin_head}`;
  // And the primary workspace, which has no remote at all, still reports null.
  const untracked = standingOf("src/only.ts").standing.revision ?? {};
  return untracked.origin_head === null
    ? null
    : `a workspace with no upstream reports ${untracked.origin_head}`;
});

check("measured.ledger_reconciled is null where the path has owners, with a receipt instead", () => {
  const gap = needFixture();
  if (gap) return gap;
  const measured = standingOf("src/ledger.ts").standing.measured ?? {};
  const problems = [];
  if (measured.ledger_rows !== 2) problems.push(`ledger_rows ${measured.ledger_rows}`);
  if (measured.ledger_reconciled !== null)
    problems.push(`ledger_reconciled ${measured.ledger_reconciled}`);
  if (measured.reconciliation_receipt?.last_checked_sha !== fixture.base)
    problems.push("the reconciliation receipt does not carry git_state's checked revision");
  if (measured.reconciliation_receipt?.last_checked_at !== "2026-09-11 01:30:50")
    problems.push("the reconciliation receipt does not carry git_state's checked time");
  if (measured.staleness_measured !== true) problems.push("staleness_measured is not true");
  if (measured.evidence_rows !== 4) problems.push(`evidence_rows ${measured.evidence_rows}`);
  // Two claims cite this path; one has been superseded.
  if (measured.claims_recorded !== 1) problems.push(`claims_recorded ${measured.claims_recorded}`);
  return problems.length ? problems.join("; ") : null;
});

check("measured.ledger_reconciled is a boolean only where the path has no owners", () => {
  const gap = needFixture();
  if (gap) return gap;
  const never = standingOf("src/case/o.ts").standing.measured ?? {};
  const recorded = standingOf("src/case/r.ts").standing.measured ?? {};
  const problems = [];
  if (never.ledger_rows !== 0) problems.push(`unledgered ledger_rows ${never.ledger_rows}`);
  if (never.ledger_reconciled !== false)
    problems.push(`never reconciled reports ${never.ledger_reconciled}`);
  if (never.staleness_measured !== false) problems.push("staleness_measured is true with no rows");
  if (recorded.ledger_reconciled !== true)
    problems.push(`a recorded gap reports ${recorded.ledger_reconciled}`);
  if (never.reconciliation_receipt !== null)
    problems.push("a zero-owner path carries a reconciliation receipt as well");
  return problems.length ? problems.join("; ") : null;
});

// ---------------------------------------------------------------------------
// 6. unknown[] — the five sources, quantified over the pair
// ---------------------------------------------------------------------------
emit("");
emit("unknown[] — five sources, no others");

function unknownOf(path) {
  return standingOf(path).standing.unknown ?? [];
}

check("concern-without-disposition is the (owner, concern) pair, not the concern", () => {
  const gap = needFixture();
  if (gap) return gap;
  const pairs = unknownOf("src/ledger.ts")
    .filter((u) => u.kind === "concern-without-disposition")
    .map((u) => `${u.subsystem_id}/${u.concern_code}`)
    .sort();
  // CC-2 is dispositioned in B-02 and missing in B-01; SC-1 is dispositioned
  // in B-04, which owns nothing here. The retired CC-9 never appears.
  return jsonEq(pairs, ["B-01/CC-2", "B-01/SC-1", "B-02/SC-1"])
    ? null
    : `the pairs are ${JSON.stringify(pairs)}`;
});

check("candidate-sibling counts the candidates in the owning subsystems", () => {
  const gap = needFixture();
  if (gap) return gap;
  const entries = unknownOf("src/ledger.ts").filter((u) => u.kind === "candidate-sibling");
  if (entries.length !== 1) return `${entries.length} candidate-sibling entries`;
  const entry = entries[0];
  if (entry.count !== 2) return `count ${entry.count}`;
  return jsonEq(entry.paths, ["src/pending-a.ts", "src/pending-b.ts"])
    ? null
    : `paths ${JSON.stringify(entry.paths)}`;
});

check("open-question is owner-scoped and declares that it is subsystem-scoped", () => {
  const gap = needFixture();
  if (gap) return gap;
  const entries = unknownOf("src/ledger.ts").filter((u) => u.kind === "open-question");
  const ids = entries.map((u) => u.question_id).sort();
  if (!jsonEq(ids, [1])) return `open questions ${JSON.stringify(ids)}`;
  return entries.every((u) => u.scope === "subsystem") ? null : "an entry omits scope: subsystem";
});

check("open-lead matches the path, a citation, a comma-split directory, and an owner id", () => {
  const gap = needFixture();
  if (gap) return gap;
  const entries = unknownOf("src/ledger.ts")
    .filter((u) => u.kind === "open-lead")
    .map((u) => `${u.note_id}:${u.location_match}`)
    .sort();
  return jsonEq(entries, ["1:exact", "2:exact", "3:prefix", "4:owner"])
    ? null
    : `open leads ${JSON.stringify(entries)}`;
});

check("unassessed-seam is the (seam, side) pair and carries the per-party-proxy limit", () => {
  const gap = needFixture();
  if (gap) return gap;
  const entries = unknownOf("src/ledger.ts").filter((u) => u.kind === "unassessed-seam");
  const pairs = entries.map((u) => `${u.seam_id}/${u.subsystem_id}/${u.reason}`).sort();
  // SM-01 is assessable and B-04 holds the only SC-% disposition, so an
  // "either party" predicate reports nothing at all for it. SM-03 touches no
  // owner of this path.
  const expected = [
    "SM-01/B-02/no-seam-concern-disposition",
    "SM-02/B-01/not-assessable",
    "SM-02/B-02/not-assessable",
  ];
  if (!jsonEq(pairs, expected)) return `the pairs are ${JSON.stringify(pairs)}`;
  return entries.every((u) => u.binding === SEAM_BINDING)
    ? null
    : "an entry omits the per-party-proxy binding";
});

check("unknown[] is mandatory and draws from no sixth source", () => {
  const gap = needFixture();
  if (gap) return gap;
  const kinds = new Set(unknownOf("src/ledger.ts").map((u) => u.kind));
  const allowed = [
    "concern-without-disposition",
    "candidate-sibling",
    "open-question",
    "open-lead",
    "unassessed-seam",
  ];
  const extra = [...kinds].filter((k) => !allowed.includes(k));
  if (extra.length) return `unknown[] carries ${extra.join(", ")}`;
  const empty = standingOf("src/case/o.ts").standing.unknown;
  return Array.isArray(empty) ? null : "unknown[] is absent on an unledgered path";
});

// ---------------------------------------------------------------------------
// 7. The other locus kinds
// ---------------------------------------------------------------------------
emit("");
emit("subsystem, symbol, and term standing");

check("a subsystem locus reports its own ladder status and its ledger counts", () => {
  const gap = needFixture();
  if (gap) return gap;
  const { standing } = standingOf("B-01");
  const problems = [];
  if (standing.state !== "concerns") problems.push(`state ${standing.state}`);
  if (standing.ledger?.examined !== 2) problems.push(`examined ${standing.ledger?.examined}`);
  if (standing.ledger?.candidate !== 1) problems.push(`candidate ${standing.ledger?.candidate}`);
  if (standing.concerns?.applicable !== 3)
    problems.push(`applicable concerns ${standing.concerns?.applicable}`);
  if (standing.concerns?.covered !== 1) problems.push(`covered concerns ${standing.concerns?.covered}`);
  if (!Array.isArray(standing.unknown)) problems.push("a subsystem locus carries no unknown[]");
  return problems.length ? problems.join("; ") : null;
});

check("a symbol locus separates an exact citation from a prefix match", () => {
  const gap = needFixture();
  if (gap) return gap;
  const { standing } = standingOf("src/ledger.ts:writeRow");
  const problems = [];
  if (standing.symbol_cited !== true) problems.push("symbol_cited is not true");
  if (!jsonEq((standing.citing_evidence ?? []).map((e) => e.id), [1]))
    problems.push(`citing evidence ${JSON.stringify(standing.citing_evidence)}`);
  if (!jsonEq((standing.symbol_prefix_matches ?? []).map((e) => e.id), [2]))
    problems.push(`prefix matches ${JSON.stringify(standing.symbol_prefix_matches)}`);
  if (standing.file?.state !== "mixed")
    problems.push(`the file block is not carried verbatim (state ${standing.file?.state})`);
  return problems.length ? problems.join("; ") : null;
});

check("a prefix match alone is never a citation of the symbol", () => {
  const gap = needFixture();
  if (gap) return gap;
  const { standing } = standingOf("src/ledger.ts:compact");
  // Evidence id 4 is `compact (bounded retry)` and nothing cites `compact`
  // exactly, so this is the arm where merging the two would show.
  if (!jsonEq((standing.symbol_prefix_matches ?? []).map((e) => e.id), [4]))
    return `prefix matches ${JSON.stringify(standing.symbol_prefix_matches)}`;
  if (standing.symbol_cited !== false) return "a prefix match was counted as a citation";
  if (standing.symbol_standing !== "not-individually-cited")
    return `symbol_standing ${standing.symbol_standing}`;
  return String(standing.note ?? "").includes("does not extend to this symbol")
    ? null
    : "the response does not say the file's state does not extend to the symbol";
});

check("a not-defined term offers up to five nearest terms, prefix then lexicographic", () => {
  const gap = needFixture();
  if (gap) return gap;
  const { standing } = standingOf("comp");
  if (standing.state !== "not-defined") return `state ${standing.state}`;
  const nearest = standing.nearest_terms ?? [];
  if (nearest.length > 5) return `${nearest.length} nearest terms`;
  return jsonEq(nearest.slice(0, 2), ["compaction", "compaction-window"])
    ? null
    : `nearest terms ${JSON.stringify(nearest)}`;
});

check("a defined term returns its vocabulary row", () => {
  const gap = needFixture();
  if (gap) return gap;
  const { standing } = standingOf("collation");
  if (standing.state !== "defined") return `state ${standing.state}`;
  return standing.gloss === "systematic comparison of witnesses"
    ? null
    : `gloss ${standing.gloss}`;
});

// ---------------------------------------------------------------------------
// 8. The materializer refuses a store that predates the views
// ---------------------------------------------------------------------------
emit("");
emit("the materializer probes for both views");

function materializeAgainst(storage, output) {
  const result = spawnSync(
    PY,
    [join(REPO, "materializer", "materialize.py"), "--storage", storage, "--output", output],
    { encoding: "utf8", cwd: join(REPO, "materializer") },
  );
  const lines = String(result.stdout ?? "").trim().split("\n");
  let summary = null;
  try {
    summary = JSON.parse(lines[lines.length - 1] ?? "");
  } catch {
    summary = null;
  }
  return { status: result.status, summary, stderr: String(result.stderr ?? "") };
}

function storeWithout(views) {
  const dir = tempRoot("amanuensis-locus-store-");
  // Fold the WAL back into memory.db first: the copy below is a file copy,
  // and a store whose rows are still only in the sidecar would make every
  // assertion about it a statement about the copy, not about the fixture.
  fixture.db.pragma("wal_checkpoint(TRUNCATE)");
  cpSync(fixture.project.storagePath, dir, { recursive: true });
  const db = mods.db.openDatabase(join(dir, "memory.db"));
  db.close();
  const plain = new betterSqlite(join(dir, "memory.db"));
  for (const view of views) plain.exec(`DROP VIEW IF EXISTS ${view}`);
  plain.close();
  return dir;
}

for (const view of ["file_standing", "finding_state_current"]) {
  check(`a store without ${view} turns the publish red by name`, () => {
    const gap = needFixture();
    if (gap) return gap;
    if (!betterSqlite) return "the sqlite driver could not be loaded";
    const storage = storeWithout([view]);
    const run = materializeAgainst(storage, join(storage, "docs"));
    if (run.status === 0) return "the publish succeeded against a store that predates the views";
    if (!run.summary) return "the publish produced no JSON summary";
    if (run.summary.ok !== false) return "the summary reports ok";
    const text = JSON.stringify(run.summary);
    if (!text.includes(view)) return `the refusal does not name ${view}`;
    return text.includes(VIEW_ABSENT_CAUSE) ? null : "the refusal does not carry the named cause";
  });
}

check("the probe passes on a store the current server has opened", () => {
  const gap = needFixture();
  if (gap) return gap;
  if (!betterSqlite) return "the sqlite driver could not be loaded";
  const storage = storeWithout([]);
  const run = materializeAgainst(storage, join(storage, "docs"));
  if (!run.summary) return "the publish produced no JSON summary";
  const text = JSON.stringify(run.summary);
  return text.includes(VIEW_ABSENT_CAUSE)
    ? "the probe refused a store that carries both views"
    : null;
});

check("opening a store whose schema omits a required view fails by name", () => {
  if (trimmedError) return trimmedError;
  if (!trimmedDb?.openDatabase) return "the scratch server copy exposes no openDatabase";
  if (!jsonEq([...(trimmedDb.REQUIRED_VIEWS ?? [])], ["file_standing", "finding_state_current"]))
    return `REQUIRED_VIEWS is ${JSON.stringify(trimmedDb.REQUIRED_VIEWS)}`;
  const dir = tempRoot("amanuensis-locus-trimmed-");
  let message = null;
  try {
    trimmedDb.openDatabase(join(dir, "memory.db")).close();
  } catch (e) {
    message = e && e.message ? e.message : String(e);
  }
  if (message === null) return "the open succeeded with file_standing absent from the schema";
  return message.includes("file_standing")
    ? null
    : `the failure does not name the view: ${message}`;
});

check("the materializer reads the probe from a shared helper, not an inline copy", () => {
  const core = readText(join(REPO, MATERIALIZER_CORE_REL));
  const db = readText(join(REPO, MATERIALIZER_DB_REL));
  if (core === null) return `${MATERIALIZER_CORE_REL} is absent`;
  if (db === null) return `${MATERIALIZER_DB_REL} is absent`;
  if (!/missing_views|REQUIRED_VIEWS/.test(db))
    return "db.py carries no view probe for the renderer to share";
  if (!/missing_views|REQUIRED_VIEWS/.test(core))
    return "core.py does not call the shared view probe";
  // §2.2 refuses an inline fallback copy of the predicate.
  return /CASE\s+WHEN\s+.*stale_reason/is.test(core)
    ? "core.py carries an inline copy of the standing predicate"
    : null;
});

// ---------------------------------------------------------------------------
// 9. Custody
// ---------------------------------------------------------------------------
emit("");
emit("custody");

check("the packet's gate runs in CI", () => {
  const ci = readText(join(REPO, CI_REL));
  if (ci === null) return `${CI_REL} is absent`;
  return ci.includes("node test-locus-index-view.mjs") ? null : "the gate is not run in CI";
});

check("the standing_state and stale_reason enums come from the contract, not a literal", () => {
  const standingSrc = readText(join(MCP, "src", "standing.ts"));
  if (standingSrc === null) return "mcp-server/src/standing.ts is absent";
  if (!/from "\.\/vocabulary\.js"/.test(standingSrc))
    return "standing.ts does not read the enum source";
  const inline = /const\s+\w*STANDING_STATES\w*\s*=\s*\[/.test(standingSrc);
  return inline ? "standing.ts redeclares the standing_state values" : null;
});

// ---------------------------------------------------------------------------
if (fixture?.db) {
  try {
    fixture.db.close();
  } catch {
    /* the fixture is being torn down; a close failure changes no verdict */
  }
}
for (const dir of [...roots, ...scratchRoots]) rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  emit("");
  emit(
    `GATE P5 RED: file_standing and deterministic locus standing do not hold — ${failures.length} assertion(s) failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("");
emit("GATE P5 GREEN");
