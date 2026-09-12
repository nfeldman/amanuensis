#!/usr/bin/env node
// Gate for reader-lenses packet P6 — describe_locus, its output contract, and
// the read-only annotations it is advertised with
// (spec.md §2.3, §3.1–§3.4, §5.1, §5.5; claims C7, C15, C16, C17, C21, C22,
// C26, C55, C59, C63).
//
// Turns red when:
//   - `describe_locus` is not exported from src/tools/locus.ts, is not the
//     first tool the server advertises, or does not appear as a `locus` group
//     in the generated tool inventory;
//   - its input schema drops `additionalProperties: false`, stops requiring a
//     non-empty `locus`, or stops constraining `sections` and `kind` to their
//     enums;
//   - a response does not validate against
//     contracts/locus-account.schema.json, or reports anything but
//     `model_calls: 0` and the registry-exact selection;
//   - an unledgered path raises instead of returning the `unledgered` standing
//     with an empty account, or an unresolvable `as_of_sha` does *not* raise;
//   - a `candidate` row serves a structural claim, or the withholding is not
//     declared with the state's own `cannot_justify` sentence;
//   - any response says "no findings" or "no open findings" at a state §2.3
//     forbids it at, or an examined locus with no recorded finding fails to
//     say so;
//   - a multi-owner file with disagreeing owners reports one owner's state
//     rather than `mixed`, or drops an owner;
//   - any account item loses `ref_sha`, `revision_bound`, or `authored`, or
//     marks a row with no revision as revision-bound;
//   - `as_of_sha` is served as a whole-account snapshot: the three supported
//     sections must be marked supported and the other five served at current
//     with `as_of_supported: false` and a sentence saying so;
//   - `history_pointer` declares `as_of_supported: true` and then serves
//     events and counts from HEAD without the ancestry cut;
//   - a claim opened at a strict ancestor and still open is dropped from a
//     historical reading, or a claim invalidated at the requested commit is
//     served by it (the SQL pre-filter the review overturned);
//   - a zero `measured` field is served without its denominator, or
//     `staleness_measured` reports health on an empty ledger;
//   - an origin head that disagrees with the workspace head is reconciled,
//     dropped, or written over the workspace head;
//   - the gate does not run in CI.
//
// Eight item-level checks below request their sections explicitly rather than
// taking the default set. P7's byte budget (§4.1) leaves a default response on
// this fixture with standing, every census, and no item at all, so an item-level
// assertion on a default call would be vacuous; the same rows are read at the
// every-section budget and the census reconciliation still reads the default
// call. What this gate no longer witnesses is item *selection* in the default
// mode, which is P7's gate's subject.
//
// False greens it cannot exclude. The account's *labels* are asserted against
// this file's own constants, so a consistent rename of a section key here and
// in the implementation would pass — the enum source and the spec table are
// the independent statements, and only the section names are cross-read. It
// cannot exclude a defects partition that is right for the five resolution
// states this fixture seeds and wrong for a sixth the schema might later add,
// because the partition map is read from the vocabulary contract but its
// *assignment* is exercised only on seeded rows. It cannot exclude an
// authorization gate that is right for `scoped-unread` and wrong for a state
// no fixture here reaches at the structure section. And it says nothing about
// response size: the byte budgets are P7's gate, and asserting a bound here
// would duplicate a control without measuring it.
//
// One guard is deliberately out of reach. The handler refuses a response whose
// sections cannot reconcile `selected + omitted == census`; deleting that
// refusal leaves every response below reconciling anyway, so this gate stays
// green under it. Turning it red needs a store that forces a drop, which is
// the over-budget fixture P7's compactness gate builds. What is asserted here
// is the weaker, independent property: the response as served reconciles, and
// an omission carries an exact count and one of the two declared reasons.
//
// Output protocol: exactly one status line, last, on stdout. Every subprocess
// is captured and never echoed, and every message is scrubbed, so a missing
// deliverable reports as an assertion failure rather than as a crash.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const MCP = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(MCP, "..");

const CONTRACT_REL = "mcp-server/contracts/locus-account.schema.json";
const INVENTORY_REL = "mcp-server/DEVELOPMENT.md";
const INDEX_REL = "mcp-server/src/index.ts";
const CI_REL = ".github/workflows/test.yml";
const VOCABULARY_REL = "mcp-server/contracts/conspectus-vocabulary.json";

// §3.1's eight sections, in the order the table fixes. Written out rather than
// read from the implementation so that reordering the implementation cannot
// also reorder what this gate expects.
const SECTIONS = [
  "purpose",
  "structure",
  "defects",
  "reviews",
  "boundaries",
  "terms",
  "leads",
  "history_pointer",
];
// §4.2: on by default, and opt-in. `history_pointer` is always present as
// counts; only its detail is opt-in.
const DEFAULT_SECTIONS = ["purpose", "structure", "defects", "boundaries", "terms"];
const OPT_IN_SECTIONS = ["reviews", "leads"];
// §3.1: the defects partition, in order.
const DEFECT_PARTITIONS = ["open", "awaiting-verification", "verified-fixed", "ruled-out", "accepted"];
// §3.3: the three sections a historical reading can be sourced for.
const AS_OF_SUPPORTED = ["structure", "defects", "history_pointer"];
// §5.1's output contract version.
const CONTRACT_VERSION = "1.0.0";
// §2.4.5's fields, in order. A zero in any of them is read against the others.
const MEASURED_FIELDS = [
  "ledger_rows",
  "ledger_reconciled",
  "reconciliation_receipt",
  "staleness_measured",
  "evidence_rows",
  "claims_recorded",
];
// §2.3's sentence for `scoped-unread`, carried from the enum source.
const SCOPED_UNREAD_CANNOT = "any claim about content, behavior, or the absence of defects";
// §3.3's sentence for a section that cannot be read historically.
const AS_OF_UNSUPPORTED_SENTENCE = "This section has no recorded history";

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

function readJson(absPath) {
  const text = readText(absPath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Deliverables, loaded defensively: an absent or unbuilt deliverable must read
// as an assertion failure, not as a crashed gate.
// ---------------------------------------------------------------------------
// `dist/` is a build artifact, so a gate that imports it without compiling
// certifies whatever was last built rather than the source under review: the
// slice-S2 review inverted three source branches and all three gates stayed
// green until `npm run build` ran by hand (F1-F3/codex). Compile first, and
// let a compile failure poison the fixture below rather than passing quietly
// against stale bytes.
const built = ensureBuilt();

let mods = null;
let loadError = null;
try {
  const [db, project, locus] = await Promise.all([
    import("./dist/db.js"),
    import("./dist/project.js"),
    import("./dist/tools/locus.js"),
  ]);
  mods = { db, project, locus };
} catch (e) {
  loadError = e && e.message ? e.message : String(e);
}

let Ajv2020 = null;
try {
  Ajv2020 = (await import("ajv/dist/2020.js")).default;
} catch {
  Ajv2020 = null;
}

const contract = readJson(join(REPO, CONTRACT_REL));
const vocabulary = readJson(join(REPO, VOCABULARY_REL));
let validateAccount = null;
let validatorError = null;
if (contract && Ajv2020) {
  try {
    validateAccount = new Ajv2020({ strict: true }).compile(contract);
  } catch (e) {
    validatorError = e && e.message ? e.message : String(e);
  }
}

function describeLocusTool() {
  const tools = mods?.locus?.locusTools;
  if (!Array.isArray(tools)) return null;
  return tools.find((tool) => tool?.name === "describe_locus") ?? null;
}

// ---------------------------------------------------------------------------
// Fixture: one workspace with three commits, a clone whose origin disagrees
// with its own head, and a store seeded so that every branch below has both a
// positive and a negative row to separate.
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
let fixtureError = !built.ok
  ? `src/ was not compiled before this gate read dist/ — ${built.detail}`
  : loadError ? `the locus tools could not be loaded — ${loadError}` : null;

function buildFixture() {
  const root = tempRoot("amanuensis-locus-account-");
  const workspace = join(root, "workspace");
  const storageRoot = join(root, "storage-root");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  git(workspace, "init", "-q", "-b", "main");
  git(workspace, "config", "user.email", "test@localhost");
  git(workspace, "config", "user.name", "Locus Account Test");
  git(workspace, "config", "commit.gpgsign", "false");
  const commit = (body, message) => {
    writeFileSync(join(workspace, "src", "ledger.ts"), body);
    git(workspace, "add", "src/ledger.ts");
    git(workspace, "commit", "-q", "--no-verify", "-m", message);
    return git(workspace, "rev-parse", "HEAD");
  };
  const base = commit("export const row = 1;\n", "base");
  const mid = commit("export const row = 2;\n", "mid");
  const head = commit("export const row = 3;\n", "head");
  // A fourth commit. The repair lands at `head`; the verification is only
  // collected at `verified`, a strict descendant. §3.3's replay has to place
  // the verification event at the revision the *verification* was read at, so
  // a cut at `head` must still report the finding awaiting verification.
  const verified = commit("export const row = 3; // verified\n", "verified");

  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
  const project = mods.project.resolveProject(workspace, {
    selectionSource: "test-locus-standing",
    serverVersion: "test",
  });
  mods.project.ensureProjectStorage(project, (dbPath) => mods.db.openDatabase(dbPath).close());
  const db = mods.db.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };

  db.prepare("INSERT INTO sessions (session_id, intent) VALUES ('p6', 'p6-gate')").run();

  const subsystem = db.prepare(
    "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  subsystem.run("B-01", "Ledger", "concerns", "core", "src/ledger.ts and the row writer", "src/examined.ts", null);
  subsystem.run("B-02", "Index", "mapped", "core", null, null, null);
  subsystem.run("B-03", "Archive", "deferred", "core", null, null, "set aside until the rewrite lands");

  const ledger = db.prepare(
    `INSERT INTO file_ledger
       (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at, stale, stale_reason)
     VALUES (?, ?, 'account fixture', ?, ?, ?, 0, NULL)`,
  );
  const examinedAt = "2026-09-01 12:00:00";
  ledger.run("B-01", "src/examined.ts", "examined", head, examinedAt);
  ledger.run("B-01", "src/clean.ts", "examined", head, examinedAt);
  ledger.run("B-01", "src/candidate.ts", "candidate", null, null);
  ledger.run("B-01", "src/mixed.ts", "examined", head, examinedAt);
  ledger.run("B-02", "src/mixed.ts", "candidate", null, null);
  // A vendored path carrying an `@`. `requireWorkspaceSourcePath` accepts it,
  // so the store holds it and every read surface has to parse a citation to it
  // the way ingress did — last `@`, not first.
  ledger.run("B-01", "src/pkg@v1/file.ts", "examined", head, examinedAt);
  ledger.run("B-01", "src/pkg", "examined", head, examinedAt);

  const evidence = db.prepare(
    `INSERT INTO evidence (id, file_path, symbol, ref_sha, kind, note, session_id)
     VALUES (?, ?, ?, ?, ?, 'account fixture', 'p6')`,
  );
  evidence.run(1, "src/examined.ts", "readLedger", head, "code-verified");
  evidence.run(2, "src/candidate.ts", "parseRow", head, "name-inferred");
  evidence.run(3, "src/examined.ts", "readLedger", base, "doc-asserted");
  evidence.run(4, "src/examined.ts", "readLedger", head, "test-observed");
  evidence.run(5, "src/examined.ts", "readLedger", head, "pattern-matched");
  // Same file, a different symbol. A symbol locus must not inherit it, and the
  // file locus must (§2.5, §3.1's evidence arm).
  evidence.run(6, "src/examined.ts", "writeLedger", head, "code-verified");
  evidence.run(7, "src/pkg@v1/file.ts", "loadVendored", head, "code-verified");

  const claim = db.prepare(
    `INSERT INTO claims
       (claim_id, claim_key, subject_type, subject_id, statement, epistemic_kind,
        asserted_at_sha, valid_from_sha, valid_until_sha, session_id)
     VALUES (?, ?, 'symbol', ?, ?, 'observation', ?, ?, ?, 'p6')`,
  );
  // Current, opened at a strict ancestor of every query commit: the reading at
  // `mid` must carry it. The pre-filter the round-1 review overturned dropped
  // exactly this row.
  claim.run("CL-1", "ledger/readLedger/bound", "src/examined.ts:readLedger",
    "the ledger reader retries under a bound", base, base, null);
  // Invalidated at `mid`: current reads must drop it, a reading at `base` must
  // carry it, and a reading at `mid` must not.
  claim.run("CL-0", "ledger/readLedger/unbounded", "src/examined.ts:readLedger",
    "the ledger reader retries without a bound", base, base, mid);
  claim.run("CL-W", "ledger/writeLedger/fsyncs", "src/examined.ts:writeLedger",
    "the ledger writer fsyncs before it acknowledges", base, base, null);
  // A content claim at a path the ledger classifies `candidate`. §2.3 forbids
  // serving it there; the store holds it all the same.
  claim.run("CL-C", "candidate/parseRow/validates", "src/candidate.ts:parseRow",
    "the candidate parser validates every row", base, base, null);
  const claimEvidence = db.prepare(
    "INSERT INTO claim_evidence (claim_id, evidence_id, role) VALUES (?, ?, 'supports')",
  );
  // CL-1 carries three rows whose strongest is neither the lowest nor the
  // highest evidence id: doc-asserted (3), test-observed (4), pattern-matched
  // (5). Reporting the first, the last, or the lowest id all give a different
  // answer than reporting the strongest.
  claimEvidence.run("CL-1", 3);
  claimEvidence.run("CL-1", 5);
  claimEvidence.run("CL-1", 4);
  claimEvidence.run("CL-0", 3);
  claimEvidence.run("CL-C", 2);
  claimEvidence.run("CL-W", 6);

  const finding = db.prepare(
    `INSERT INTO findings
       (finding_id, subsystem_id, symptom, root_cause, severity, status, primary_files, ref_sha, session_id)
     VALUES (?, 'B-01', ?, 'account fixture', ?, ?, ?, ?, 'p6')`,
  );
  const primary = JSON.stringify([`src/examined.ts:readLedger@${head}`]);
  // The seeded severities deliberately disagree with id order: B01-0 is the
  // lowest id and the lowest severity, so sorting by id alone produces a
  // different sequence and the ordering assertion below can fail.
  finding.run("B01-0", "the reader drops the last row", "MEDIUM", "confirmed-bug", primary, head);
  finding.run("B01-1", "the reader double-counts a retry", "HIGH", "confirmed-bug", primary, head);
  finding.run("B01-4", "the reader logs the wrong cursor", "HIGH", "confirmed-bug", primary, head);
  // Legacy row: no resolution event at all, so `finding_state_current`'s
  // fallback is what places it.
  finding.run("B01-3", "the reader was thought to deadlock", "CRITICAL", "ruled-out", primary, head);
  // Repaired at `head`: the event names a revision, so a reading at `mid`
  // cannot carry it and must report the finding open there.
  finding.run("B01-2", "the reader leaked a handle", "LOW", "confirmed-bug", primary, head);
  // A citation whose *path* carries an `@`. `requireWorkspaceCitation` accepts
  // it (first colon, last `@`), so a store can hold it; every read surface has
  // to parse it the same way.
  finding.run(
    "B01-5",
    "the vendored copy shadows the workspace module",
    "MEDIUM",
    "confirmed-bug",
    JSON.stringify([`src/pkg@v1/file.ts:loadVendored@${head}`]),
    head,
  );
  const findingEvidence = db.prepare(
    "INSERT INTO finding_evidence (finding_id, evidence_id, role) VALUES (?, ?, 'symptom')",
  );
  for (const id of ["B01-0", "B01-1", "B01-2", "B01-3", "B01-4"]) findingEvidence.run(id, 1);
  // B01-5 hangs off no evidence row at `src/examined.ts`: the `primary_files`
  // arm is the only thing that can place it, which is what this fixture is
  // measuring.
  findingEvidence.run("B01-5", 7);
  db.prepare(
    `INSERT INTO finding_resolution_events
       (finding_id, resolution_state, fix_location, fix_sha, rationale, session_id)
     VALUES ('B01-2', 'fixed-pending-verification', 'src/examined.ts:readLedger', ?, 'handle closed on the error path', 'p6')`,
  ).run(head);
  // B01-6: repaired at `head` and *verified* at `verified`, one commit later.
  // §3.3's replay must place each event at the revision it was read at, so a
  // cut at `head` reports fixed-pending-verification and only a cut at
  // `verified` reports verified-fixed. Without a verification event in the
  // fixture, a replay that drops every verified-fixed event is invisible here
  // — the review's sabotage at locus.ts:724 left this gate green (F3/codex).
  finding.run(
    "B01-6",
    "the compactor rewrites a live segment",
    "HIGH",
    "confirmed-bug",
    primary,
    base,
  );
  evidence.run(8, "src/examined.ts", "readLedger", verified, "code-verified");
  db.prepare(
    "INSERT INTO finding_evidence (finding_id, evidence_id, role) VALUES ('B01-6', 8, 'fix-verification')",
  ).run();
  db.prepare(
    `INSERT INTO finding_resolution_events
       (finding_id, resolution_state, fix_location, fix_sha, effective_sha, rationale, session_id)
     VALUES ('B01-6', 'fixed-pending-verification', 'src/examined.ts:readLedger', ?, ?, 'segment copied before rewrite', 'p6')`,
  ).run(head, head);
  db.prepare(
    `INSERT INTO finding_resolution_events
       (finding_id, resolution_state, fix_location, fix_sha, effective_sha, evidence_id, rationale, session_id)
     VALUES ('B01-6', 'verified-fixed', 'src/examined.ts:readLedger', ?, ?, 8, 'the compaction test covers the live segment', 'p6')`,
  ).run(head, verified);

  const concern = db.prepare(
    "INSERT INTO concerns (code, category, origin, notes, status) VALUES (?, ?, 'seeded', ?, 'active')",
  );
  concern.run("CC-1", "concurrency", "can two writers interleave?");
  concern.run("SC-1", "seam", "is the seam contract written down?");
  db.prepare(
    `INSERT INTO dispositions (subsystem_id, concern_code, classification, evidence, evidence_quality, rationale)
     VALUES ('B-01', 'CC-1', 'ruled-out', ?, 'code-verified', 'the writer holds the lock across the retry')`,
  ).run(`src/examined.ts:readLedger@${head}`);
  db.prepare(
    "INSERT INTO disposition_evidence (subsystem_id, concern_code, evidence_id, role) VALUES ('B-01','CC-1',1,'supports')",
  ).run();

  db.prepare(
    `INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b, a_writes, b_reads, notes)
     VALUES ('SM-01', 'ledger rows', 'table', 'B-01', 'B-02', 'appends rows', 'reads rows', 'the index trails the ledger')`,
  ).run();
  // The edge carries a citation in its prose, because §9.2's xref write path
  // refuses one that does not. A context with no citation token cannot exercise
  // §3.2's rule here at all: `xrefs` has no `ref_sha` column, so the assertion
  // below is only load-bearing against a row the current write path could
  // actually have produced (slice-S4 F5/codex).
  db.prepare(
    "INSERT INTO xrefs (from_id, to_id, relationship, strength, context) VALUES ('B-01','B-02','data-flow','observed',?)",
  ).run(`the index reads what the ledger writes at src/examined.ts:readLedger@${head}`);

  const vocab = db.prepare(
    "INSERT INTO vocabulary (term, gloss, expansion, subsystem_id, first_seen, ref_sha) VALUES (?, ?, ?, ?, ?, ?)",
  );
  vocab.run("row cursor", "the position a reader resumes from", null, "B-01", `src/examined.ts:readLedger@${head}`, head);
  // A term with no recorded revision: §3.2's `revision_bound: false` case.
  vocab.run("compaction", "folding the ledger into one revision", null, "B-01", null, null);

  db.prepare(
    `INSERT INTO field_notes (id, category, observation, location, ref_sha, follow_up, session_id)
     VALUES (7, 'anomaly', 'the retry path is untested', ?, ?, 'open', 'p6')`,
  ).run("src/examined.ts:readLedger", head);
  db.prepare(
    `INSERT INTO open_questions (id, category, subsystem_id, question, resolution, ref_sha)
     VALUES (3, 'scope-judgment', 'B-01', 'does the ledger own the index schema?', 'open', ?)`,
  ).run(head);

  db.prepare(
    `INSERT INTO git_state (repo_id, canonical_branch, last_checked_sha, last_checked_at, onboarding_sha)
     VALUES ('default', 'main', ?, '2026-09-11 02:15:00', ?)`,
  ).run(head, base);

  // A clone whose recorded upstream is the workspace's head while its own HEAD
  // has moved on. §2.4.4 reports both; it never reconciles them.
  const divergent = join(root, "divergent-clone");
  let divergentCtx = null;
  const cloned = spawnSync("git", ["clone", "-q", workspace, divergent], { encoding: "utf8" });
  if (cloned.status === 0) {
    git(divergent, "config", "user.email", "test@localhost");
    git(divergent, "config", "user.name", "Locus Account Test");
    git(divergent, "config", "commit.gpgsign", "false");
    writeFileSync(join(divergent, "src", "ledger.ts"), "export const row = 5;\n");
    git(divergent, "add", "src/ledger.ts");
    git(divergent, "commit", "-q", "--no-verify", "-m", "ahead of origin");
    divergentCtx = {
      ...ctx,
      project: { ...project, workspacePath: divergent },
      divergentHead: git(divergent, "rev-parse", "HEAD"),
    };
  }

  return { root, workspace, storageRoot, base, mid, head, verified, project, db, ctx, divergent, divergentCtx };
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

function describeLocus(args, ctx = fixture.ctx) {
  const tool = describeLocusTool();
  if (!tool) throw new Error("describe_locus is not exported from the locus tools");
  return tool.handler(args, ctx);
}

function sectionOf(payload, name) {
  return payload?.sections?.[name] ?? null;
}

function allItems(payload) {
  const out = [];
  for (const name of SECTIONS) {
    const section = sectionOf(payload, name);
    if (!section || !Array.isArray(section.items)) continue;
    for (const item of section.items) out.push([name, item]);
  }
  return out;
}

emit("build custody");

check("src/ was compiled into dist/ before this gate read it", () => built.detail);

emit("");

// ---------------------------------------------------------------------------
// 1. The output contract
// ---------------------------------------------------------------------------
emit("contract");

check("contracts/locus-account.schema.json ships version 1.0.0 and is a compiled schema", () => {
  if (contract === null) return `${CONTRACT_REL} is absent or is not JSON`;
  if (Ajv2020 === null) return "the draft 2020-12 validator could not be loaded";
  if (validatorError) return `the contract does not compile: ${validatorError}`;
  if (!validateAccount) return "the contract did not compile";
  if (contract.additionalProperties !== false)
    return "the contract admits properties it does not declare";
  const version = contract.properties?.contract_version?.const;
  if (version !== CONTRACT_VERSION) return `contract_version is ${JSON.stringify(version)}`;
  const required = new Set(contract.required ?? []);
  const missing = [
    "contract_version",
    "locus",
    "standing",
    "sections",
    "census",
    "omitted",
    "trace",
    "current",
  ].filter((key) => !required.has(key));
  return missing.length ? `the contract does not require ${missing.join(", ")}` : null;
});

check("the contract constrains the section set to §3.1's eight", () => {
  if (contract === null) return `${CONTRACT_REL} is absent`;
  const properties = contract.properties?.sections?.properties;
  if (!properties) return "the contract does not declare the sections object";
  const declared = Object.keys(properties);
  const missing = SECTIONS.filter((name) => !declared.includes(name));
  const extra = declared.filter((name) => !SECTIONS.includes(name));
  if (missing.length) return `the contract omits ${missing.join(", ")}`;
  if (extra.length) return `the contract declares unknown sections ${extra.join(", ")}`;
  return contract.properties?.sections?.additionalProperties === false
    ? null
    : "the sections object admits sections the contract does not declare";
});

// ---------------------------------------------------------------------------
// 2. Tool surface (C21, C22, C26)
// ---------------------------------------------------------------------------
emit("");
emit("tool surface");

check("describe_locus is the first tool src/tools/locus.ts exports", () => {
  if (loadError) return `the locus tools could not be loaded — ${loadError}`;
  const tools = mods.locus.locusTools;
  if (!Array.isArray(tools) || tools.length === 0) return "locusTools is absent or empty";
  if (tools[0]?.name !== "describe_locus")
    return `the first exported tool is ${JSON.stringify(tools[0]?.name)}`;
  return typeof tools[0]?.handler === "function" ? null : "describe_locus carries no handler";
});

check("its input schema is closed and constrains locus, kind, and sections", () => {
  const tool = describeLocusTool();
  if (!tool) return "describe_locus is not exported";
  const schema = tool.inputSchema ?? {};
  if (schema.additionalProperties !== false) return "the input schema is open";
  if (!Array.isArray(schema.required) || !schema.required.includes("locus"))
    return "locus is not required";
  const locus = schema.properties?.locus ?? {};
  if (locus.type !== "string" || (locus.minLength ?? 0) < 1)
    return "locus is not a non-empty string";
  const kind = schema.properties?.kind?.enum;
  if (!Array.isArray(kind) || ["file", "symbol", "subsystem", "term"].some((k) => !kind.includes(k)))
    return `kind is not constrained to the four locus kinds: ${JSON.stringify(kind)}`;
  const sections = schema.properties?.sections?.items?.enum;
  if (!Array.isArray(sections)) return "sections items carry no enum";
  const missing = SECTIONS.filter((name) => !sections.includes(name));
  const extra = sections.filter((name) => !SECTIONS.includes(name));
  if (missing.length) return `the sections enum omits ${missing.join(", ")}`;
  if (extra.length) return `the sections enum admits ${extra.join(", ")}`;
  return schema.properties?.as_of_sha?.type === "string" ? null : "as_of_sha is not a string";
});

check("index.ts registers the locus tools first and carries an explicit read-only set", () => {
  const source = readText(join(REPO, INDEX_REL));
  if (source === null) return `${INDEX_REL} is absent`;
  if (!/READ_ONLY_TOOLS/.test(source)) return "index.ts declares no READ_ONLY_TOOLS set";
  if (!/READ_ONLY_TOOLS[\s\S]{0,200}describe_locus/.test(source))
    return "describe_locus is not in READ_ONLY_TOOLS";
  const composition = source.match(/const allTools: ToolDefinition\[\] = \[([\s\S]*?)\];/);
  if (!composition) return "allTools could not be read from index.ts";
  const first = composition[1]
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("//"));
  return first === "...locusTools," ? null : `allTools opens with ${JSON.stringify(first)}`;
});

// ---------------------------------------------------------------------------
// 3. Advertised annotations, read from a live server (C22, C26)
// ---------------------------------------------------------------------------
emit("");
emit("advertised surface");

async function listTools() {
  const workspace = tempRoot("amanuensis-locus-list-");
  return await new Promise((resolveFn) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        server.kill("SIGTERM");
      } catch {
        /* the server is being torn down; a kill failure changes no verdict */
      }
      resolveFn(value);
    };
    const server = spawn(process.execPath, [join(MCP, "dist", "index.js"), "--workspace", workspace], {
      env: { ...process.env, AMANUENSIS_STORAGE_ROOT: join(workspace, "storage") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    server.on("error", (e) => done({ error: e && e.message ? e.message : String(e) }));
    server.stdout.on("data", (chunk) => {
      out += chunk.toString();
      for (const line of out.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === 2) done({ tools: message.result?.tools ?? [] });
        } catch {
          /* a partial line; the next chunk completes it */
        }
      }
    });
    server.stderr.on("data", () => {});
    const timer = setTimeout(() => done({ error: "the server did not answer tools/list in time" }), 30_000);
    const send = (message) => {
      try {
        server.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (e) {
        done({ error: e && e.message ? e.message : String(e) });
      }
    };
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "p6", version: "0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

const advertised = await listTools();

check("tools/list advertises describe_locus first", () => {
  if (advertised.error) return `the tool list could not be read — ${advertised.error}`;
  const names = advertised.tools.map((tool) => tool.name);
  if (!names.includes("describe_locus")) return "describe_locus is not advertised";
  return names[0] === "describe_locus" ? null : `the list opens with ${names[0]}`;
});

check("describe_locus advertises readOnlyHint true and destructiveHint false", () => {
  if (advertised.error) return `the tool list could not be read — ${advertised.error}`;
  const tool = advertised.tools.find((entry) => entry.name === "describe_locus");
  if (!tool) return "describe_locus is not advertised";
  const expected = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (tool.annotations?.[field] !== value)
      return `${field} is ${JSON.stringify(tool.annotations?.[field])}, not ${value}`;
  }
  // The carve-out must not widen: a write tool stays destructive.
  const write = advertised.tools.find((entry) => entry.name === "update_subsystem_status");
  if (!write) return "update_subsystem_status is not advertised";
  return write.annotations?.readOnlyHint === false && write.annotations?.destructiveHint === true
    ? null
    : "the read-only carve-out reaches a write tool";
});

check("the generated tool inventory carries the locus group", () => {
  const inventory = readText(join(REPO, INVENTORY_REL));
  if (inventory === null) return `${INVENTORY_REL} is absent`;
  if (!/\blocus\b/.test(inventory)) return "DEVELOPMENT.md names no locus group";
  if (!inventory.includes("describe_locus")) return "DEVELOPMENT.md does not list describe_locus";
  const regenerated = spawnSync(process.execPath, [join(MCP, "scripts", "gen-tool-inventory.mjs"), "--check"], {
    cwd: MCP,
    encoding: "utf8",
  });
  return regenerated.status === 0
    ? null
    : `gen-tool-inventory.mjs --check does not pass: ${scrub(String(regenerated.stdout ?? "") + String(regenerated.stderr ?? "")).trim().split("\n").slice(-1)[0]}`;
});

// ---------------------------------------------------------------------------
// 4. An unknown locus is an answer, not an error (C21)
// ---------------------------------------------------------------------------
emit("");
emit("unknown locus");

check("an unledgered path returns the unledgered standing and an empty account", () => {
  const reason = needFixture();
  if (reason) return reason;
  let payload;
  try {
    payload = describeLocus({ locus: "src/unledgered.ts" });
  } catch (e) {
    return `describe_locus raised on an unledgered path — ${e && e.message ? e.message : e}`;
  }
  if (payload?.ok === false) return `describe_locus returned an error: ${payload.error}`;
  if (payload?.standing?.state !== "unledgered")
    return `state is ${JSON.stringify(payload?.standing?.state)}`;
  if (!Array.isArray(payload?.standing?.owners) || payload.standing.owners.length !== 0)
    return "the unledgered standing carries owners";
  if (!Array.isArray(payload?.standing?.unknown)) return "unknown[] is absent";
  const populated = SECTIONS.filter((name) => (sectionOf(payload, name)?.items ?? []).length > 0);
  return populated.length ? `the account is not empty: ${populated.join(", ")}` : null;
});

check("an unresolvable as_of_sha is an error", () => {
  const reason = needFixture();
  if (reason) return reason;
  try {
    const payload = describeLocus({ locus: "src/examined.ts", as_of_sha: "0".repeat(40) });
    return payload?.ok === false
      ? null
      : "an unresolvable as_of_sha returned a reading instead of an error";
  } catch {
    return null;
  }
});

check("a term no vocabulary row names returns not-defined, not an error", () => {
  const reason = needFixture();
  if (reason) return reason;
  let payload;
  try {
    payload = describeLocus({ locus: "quiescence" });
  } catch (e) {
    return `describe_locus raised on an unknown term — ${e && e.message ? e.message : e}`;
  }
  if (payload?.locus?.kind !== "term") return `the locus kinded ${payload?.locus?.kind}`;
  return payload?.standing?.state === "not-defined"
    ? null
    : `state is ${JSON.stringify(payload?.standing?.state)}`;
});

// ---------------------------------------------------------------------------
// 5. §2.3's authorization, carried into the account (C7)
// ---------------------------------------------------------------------------
emit("");
emit("authorization");

check("a candidate row serves no structural claim and says why", () => {
  const reason = needFixture();
  if (reason) return reason;
  const payload = describeLocus({ locus: "src/candidate.ts" });
  if (payload?.standing?.state !== "scoped-unread")
    return `state is ${JSON.stringify(payload?.standing?.state)}`;
  const structure = sectionOf(payload, "structure");
  if (!structure) return "the structure section is absent";
  if ((structure.items ?? []).length !== 0)
    return `the structure section serves ${structure.items.length} item(s)`;
  const serialized = JSON.stringify(payload);
  if (serialized.includes("the candidate parser validates every row"))
    return "a content claim reached the response";
  if (structure.authorized !== false) return "the withholding is not declared";
  if (structure.withheld_unauthorized !== 1)
    return `withheld_unauthorized is ${JSON.stringify(structure.withheld_unauthorized)}, not 1`;
  if (structure.recorded !== true)
    return "the section reports nothing recorded while the store holds a row";
  if (!String(structure.statement ?? "").toLowerCase().includes("not examined"))
    return `the statement does not say "not examined": ${JSON.stringify(structure.statement)}`;
  return String(structure.cannot_justify ?? "").includes(SCOPED_UNREAD_CANNOT)
    ? null
    : `the section does not carry §2.3's sentence: ${JSON.stringify(structure.cannot_justify)}`;
});

check("'no findings' is never said at a state §2.3 forbids it at", () => {
  const reason = needFixture();
  if (reason) return reason;
  // The sentences the tool itself authors, not the whole payload: §2.3's own
  // `cannot_justify` text quotes the forbidden phrase in order to forbid it,
  // and a reader of the serialized blob cannot tell an assertion from a
  // prohibition. Section statements are where the tool speaks in its own voice.
  for (const locus of ["src/candidate.ts", "src/unledgered.ts"]) {
    const payload = describeLocus({ locus });
    const statements = SECTIONS.map((name) => String(sectionOf(payload, name)?.statement ?? ""))
      .join(" ")
      .toLowerCase();
    if (/\bno (open )?findings\b/.test(statements))
      return `${locus} reports an absence of findings: ${statements}`;
    if (!statements.includes("not examined")) return `${locus} does not say "not examined"`;
  }
  return null;
});

check("'no open findings' is said at an examined locus that has none", () => {
  const reason = needFixture();
  if (reason) return reason;
  const payload = describeLocus({ locus: "src/clean.ts" });
  if (payload?.standing?.state !== "examined")
    return `state is ${JSON.stringify(payload?.standing?.state)}`;
  const defects = sectionOf(payload, "defects");
  if (!defects) return "the defects section is absent";
  if (defects.census !== 0) return `census is ${defects.census}`;
  if (defects.recorded !== false) return "an empty source is not declared as unrecorded";
  return String(defects.statement ?? "").toLowerCase().includes("no open findings")
    ? null
    : `the statement is ${JSON.stringify(defects.statement)}`;
});

// ---------------------------------------------------------------------------
// 6. The account (C14's order, C15's binding, C59's authorship)
// ---------------------------------------------------------------------------
emit("");
emit("account");

check("the eight sections are present in §3.1's order", () => {
  const reason = needFixture();
  if (reason) return reason;
  const payload = describeLocus({ locus: "src/examined.ts", sections: SECTIONS });
  const keys = Object.keys(payload?.sections ?? {});
  return JSON.stringify(keys) === JSON.stringify(SECTIONS)
    ? null
    : `the sections are ${JSON.stringify(keys)}`;
});

check("the default call carries the on-by-default sections and no opt-in section", () => {
  const reason = needFixture();
  if (reason) return reason;
  const payload = describeLocus({ locus: "src/examined.ts" });
  for (const name of DEFAULT_SECTIONS) {
    const section = sectionOf(payload, name);
    if (!section) return `${name} is absent from a default call`;
    if (section.requested === false) return `${name} is not requested by default`;
  }
  for (const name of OPT_IN_SECTIONS) {
    const section = sectionOf(payload, name);
    if (!section) return `${name} is absent from a default call`;
    if ((section.items ?? []).length !== 0) return `${name} is served without being requested`;
    if (section.requested !== false) return `${name} does not declare that it was not requested`;
  }
  const omitted = payload?.omitted ?? [];
  const policy = omitted.filter((entry) => entry.reason === "policy").map((entry) => entry.section);
  const uncounted = OPT_IN_SECTIONS.filter(
    (name) => (payload?.census?.by_section?.[name] ?? 0) > 0 && !policy.includes(name),
  );
  return uncounted.length
    ? `an unrequested section with candidates records no policy omission: ${uncounted.join(", ")}`
    : null;
});

check("every section reconciles its own census against the omission ledger", () => {
  const reason = needFixture();
  if (reason) return reason;
  // A default call, so the two opt-in sections are dropped by policy and the
  // ledger has something to reconcile.
  const payload = describeLocus({ locus: "src/examined.ts" });
  const ledger = payload?.omitted ?? [];
  for (const entry of ledger) {
    if (entry.reason !== "policy" && entry.reason !== "budget")
      return `an omission carries the reason ${JSON.stringify(entry.reason)}`;
    if (typeof entry.count !== "number") return `${entry.section} omits without an exact count`;
  }
  for (const name of SECTIONS) {
    const section = sectionOf(payload, name);
    if (!section) return `${name} is absent`;
    const dropped = ledger
      .filter((entry) => entry.section === name)
      .reduce((total, entry) => total + entry.count, 0);
    if ((section.items ?? []).length + dropped !== section.census)
      return `${name}: ${(section.items ?? []).length} selected + ${dropped} omitted != ${section.census}`;
    // §4.3: an unrecorded source is declared as census 0, never as an omission.
    if (section.census === 0 && dropped > 0) return `${name} omits from an empty census`;
  }
  return null;
});

check("an opt-in section is served when it is requested", () => {
  const reason = needFixture();
  if (reason) return reason;
  const payload = describeLocus({ locus: "src/examined.ts", sections: ["reviews", "leads"] });
  const reviews = sectionOf(payload, "reviews");
  const leads = sectionOf(payload, "leads");
  if ((reviews?.items ?? []).length !== 1)
    return `reviews serves ${(reviews?.items ?? []).length} item(s), not the one disposition whose evidence cites the file`;
  if (reviews.items[0].concern_code !== "CC-1")
    return `the review item is ${JSON.stringify(reviews.items[0].concern_code)}`;
  if ((leads?.items ?? []).length !== 2)
    return `leads serves ${(leads?.items ?? []).length} item(s), not the open lead and the open question`;
  // A section the call did not ask for is not served by asking for another.
  return (sectionOf(payload, "purpose")?.items ?? []).length === 0
    ? null
    : "an explicit section list still served purpose";
});

check("structure serves the current claims, with the strongest evidence kind", () => {
  const reason = needFixture();
  if (reason) return reason;
  // P7's budget: on this fixture a default call fits standing and the census
  // and no item at all (§4.1), so the sections are requested explicitly and the
  // assertion reads the same rows at the expanded budget. What the default call
  // does instead — declare every unserved row in omitted[] — is asserted by the
  // census reconciliation above.
  const payload = describeLocus({ locus: "src/examined.ts", sections: SECTIONS });
  const items = sectionOf(payload, "structure")?.items ?? [];
  const ids = items.map((entry) => entry.claim_id);
  // CL-1 by subject, CL-W only through evidence citing the file; CL-0 is
  // superseded and CL-C belongs to another path.
  if (JSON.stringify(ids) !== JSON.stringify(["CL-1", "CL-W"]))
    return `structure serves ${JSON.stringify(ids)}`;
  const item = items[0];
  if (item.claim_id !== "CL-1") return `the item is ${JSON.stringify(item.claim_id)}`;
  if (item.statement !== "the ledger reader retries under a bound")
    return "the statement is not the stored one";
  if (item.ref_sha !== fixture.base) return `ref_sha is ${JSON.stringify(item.ref_sha)}`;
  if (item.evidence_kind !== "test-observed")
    return `evidence_kind is ${JSON.stringify(item.evidence_kind)}, not the strongest attached`;
  if (item.revision_bound !== true) return "a revision-bound claim is not marked bound";
  return item.authored === "model" ? null : `authored is ${JSON.stringify(item.authored)}`;
});

check("a symbol locus does not inherit the file's other citations", () => {
  const reason = needFixture();
  if (reason) return reason;
  const payload = describeLocus({ locus: "src/examined.ts:readLedger", sections: SECTIONS });
  if (payload?.locus?.kind !== "symbol") return `the locus kinded ${payload?.locus?.kind}`;
  const ids = (sectionOf(payload, "structure")?.items ?? []).map((item) => item.claim_id);
  // The file carries a claim about a second symbol, cited by its own evidence
  // row. Widening the symbol's evidence arm to the whole file pulls it in.
  if (ids.includes("CL-W")) return `the symbol served a claim about another symbol: ${JSON.stringify(ids)}`;
  return JSON.stringify(ids) === JSON.stringify(["CL-1"])
    ? null
    : `the symbol serves ${JSON.stringify(ids)}`;
});

check("defects partition and order follow §3.1", () => {
  const reason = needFixture();
  if (reason) return reason;
  const defects = sectionOf(describeLocus({ locus: "src/examined.ts", sections: SECTIONS }), "defects");
  const items = defects?.items ?? [];
  if (items.length !== 6) return `defects serves ${items.length} item(s), not the six seeded`;
  const partitions = [...new Set(items.map((item) => item.partition))];
  const ordered = DEFECT_PARTITIONS.filter((name) => partitions.includes(name));
  if (JSON.stringify(partitions) !== JSON.stringify(ordered))
    return `the partitions appear as ${JSON.stringify(partitions)}`;
  const byPartition = (name) => items.filter((item) => item.partition === name).map((i) => i.finding_id);
  if (JSON.stringify(byPartition("open")) !== JSON.stringify(["B01-1", "B01-4", "B01-0"]))
    return `the open partition is ${JSON.stringify(byPartition("open"))}, not severity then id`;
  if (JSON.stringify(byPartition("awaiting-verification")) !== JSON.stringify(["B01-2"]))
    return `awaiting-verification holds ${JSON.stringify(byPartition("awaiting-verification"))}`;
  if (JSON.stringify(byPartition("ruled-out")) !== JSON.stringify(["B01-3"]))
    return `ruled-out holds ${JSON.stringify(byPartition("ruled-out"))}`;
  if (JSON.stringify(byPartition("verified-fixed")) !== JSON.stringify(["B01-6"]))
    return `verified-fixed holds ${JSON.stringify(byPartition("verified-fixed"))}`;
  return null;
});

// §9.2's citation grammar is `path:symbol@revision`, parsed at ingress with
// the *first* colon and the *last* `@` (`helpers.ts:requireWorkspaceCitation`).
// A path may legitimately carry an `@` — `src/pkg@v1/file.ts` — so a read
// surface that splits on the *first* `@` reduces that citation to `src/pkg`
// and the finding is served at a path nobody cited while vanishing from the
// path that was. The read must parse what the write accepted.
check("a citation whose path carries an @ is read at the path, not at its prefix", () => {
  const reason = needFixture();
  if (reason) return reason;
  const atPath =
    sectionOf(describeLocus({ locus: "src/pkg@v1/file.ts", sections: SECTIONS }), "defects")
      ?.items ?? [];
  if (!atPath.some((item) => item.finding_id === "B01-5"))
    return `src/pkg@v1/file.ts does not carry B01-5; it served ${JSON.stringify(atPath.map((i) => i.finding_id))}`;
  const atPrefix =
    sectionOf(describeLocus({ locus: "src/pkg", sections: SECTIONS }), "defects")?.items ?? [];
  if (atPrefix.some((item) => item.finding_id === "B01-5"))
    return "src/pkg carries B01-5, a finding cited to src/pkg@v1/file.ts";
  return null;
});

check("an uncited symbol inherits no defect cited to a sibling symbol", () => {
  const reason = needFixture();
  if (reason) return reason;
  // Every seeded finding cites `src/examined.ts:readLedger` in primary_files
  // and hangs off evidence row 1. `writeLedger` is a real symbol of the same
  // file with its own evidence row and no finding at all, so C13's "never
  // inherits the file's state silently" makes its defects section empty. The
  // evidence arm already narrows on symbol; the primary_files arm is what
  // decides this.
  const payload = describeLocus({ locus: "src/examined.ts:writeLedger", sections: SECTIONS });
  if (payload?.locus?.kind !== "symbol") return `the locus kinded ${payload?.locus?.kind}`;
  const ids = (sectionOf(payload, "defects")?.items ?? []).map((item) => item.finding_id);
  if (ids.length)
    return `an uncited symbol inherited ${ids.length} defect(s) cited to another symbol: ${JSON.stringify(ids)}`;
  // And the cited sibling still gets all six, so the narrowing is not a
  // blanket refusal to serve symbol loci.
  const cited = describeLocus({ locus: "src/examined.ts:readLedger", sections: SECTIONS });
  const citedIds = (sectionOf(cited, "defects")?.items ?? []).map((item) => item.finding_id);
  return citedIds.length === 6
    ? null
    : `the cited symbol serves ${citedIds.length} defect(s), not the six seeded`;
});

check("purpose renders scope separately and says no purpose statement is recorded", () => {
  const reason = needFixture();
  if (reason) return reason;
  const purpose = sectionOf(
    describeLocus({ locus: "src/examined.ts", sections: SECTIONS }),
    "purpose",
  );
  const items = purpose?.items ?? [];
  if (items.length !== 1) return `purpose serves ${items.length} item(s)`;
  const item = items[0];
  if (item.subsystem_id !== "B-01") return `the owner is ${JSON.stringify(item.subsystem_id)}`;
  if (item.scope !== "src/ledger.ts and the row writer")
    return "scope is not the stored text";
  if (Object.keys(item).includes("purpose") && item.purpose !== null)
    return "a purpose sentence was invented";
  return String(purpose.statement ?? "").includes("No purpose statement is recorded")
    ? null
    : `the statement is ${JSON.stringify(purpose.statement)}`;
});

check("boundaries and terms carry unbound rows as revision_bound false", () => {
  const reason = needFixture();
  if (reason) return reason;
  const payload = describeLocus({ locus: "src/examined.ts", sections: SECTIONS });
  const boundaries = sectionOf(payload, "boundaries")?.items ?? [];
  if (boundaries.length !== 2)
    return `boundaries serves ${boundaries.length} item(s), not the seam and the xref`;
  for (const item of boundaries) {
    if (item.ref_sha !== null) return `a seam or xref carries a ref_sha it has no column for`;
    if (item.revision_bound !== false) return "an unbound boundary row is marked revision-bound";
  }
  const terms = sectionOf(payload, "terms")?.items ?? [];
  const unbound = terms.find((item) => item.term === "compaction");
  const bound = terms.find((item) => item.term === "row cursor");
  if (!unbound || !bound) return `terms serves ${JSON.stringify(terms.map((t) => t.term))}`;
  if (unbound.revision_bound !== false) return "a term with no ref_sha is marked revision-bound";
  return bound.revision_bound === true && bound.ref_sha === fixture.head
    ? null
    : "a term recorded at a revision is not bound to it";
});

check("every item carries authored and a revision binding that matches its ref_sha", () => {
  const reason = needFixture();
  if (reason) return reason;
  const payload = describeLocus({ locus: "src/examined.ts", sections: SECTIONS });
  const items = allItems(payload);
  if (items.length === 0) return "the account served no item to check";
  for (const [section, item] of items) {
    if (item.authored !== "model" && item.authored !== "code")
      return `${section} item carries authored ${JSON.stringify(item.authored)}`;
    if (!Object.prototype.hasOwnProperty.call(item, "ref_sha"))
      return `${section} item carries no ref_sha field`;
    if (typeof item.revision_bound !== "boolean")
      return `${section} item carries no revision_bound flag`;
    if (item.ref_sha === null && item.revision_bound !== false)
      return `${section} item claims a revision binding it has no revision for`;
    if (item.ref_sha !== null && item.revision_bound !== true)
      return `${section} item hides the revision it is bound to`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// 7. Mixed ownership (C7's weakest-owner rule reaching the account)
// ---------------------------------------------------------------------------
emit("");
emit("mixed ownership");

check("a file whose owners disagree reports mixed and lists every owner", () => {
  const reason = needFixture();
  if (reason) return reason;
  const payload = describeLocus({ locus: "src/mixed.ts" });
  if (payload?.standing?.state !== "mixed")
    return `state is ${JSON.stringify(payload?.standing?.state)}`;
  const owners = payload.standing.owners ?? [];
  if (owners.length !== 2) return `owners lists ${owners.length} of the 2 ledger rows`;
  const ids = owners.map((owner) => owner.subsystem_id).sort();
  if (JSON.stringify(ids) !== JSON.stringify(["B-01", "B-02"]))
    return `owners lists ${JSON.stringify(ids)}`;
  // §2.3: mixed authorizes only what the weakest owner authorizes, so the
  // structure section is withheld exactly as it is at scoped-unread.
  const structure = sectionOf(payload, "structure");
  return structure?.authorized === false
    ? null
    : "mixed served the strongest owner's authorization";
});

// ---------------------------------------------------------------------------
// 8. Historical readings (C16)
// ---------------------------------------------------------------------------
emit("");
emit("as_of_sha");

check("only the three sourceable sections support a historical reading", () => {
  const reason = needFixture();
  if (reason) return reason;
  const payload = describeLocus({ locus: "src/examined.ts", sections: SECTIONS, as_of_sha: fixture.mid });
  if (payload?.current !== false) return "a historical reading is reported as current";
  if (payload?.as_of_sha !== fixture.mid) return "the response does not echo as_of_sha";
  for (const name of SECTIONS) {
    const section = sectionOf(payload, name);
    const expected = AS_OF_SUPPORTED.includes(name);
    if (section?.as_of_supported !== expected)
      return `${name} reports as_of_supported ${JSON.stringify(section?.as_of_supported)}`;
    if (!expected && !String(section?.statement ?? "").includes(AS_OF_UNSUPPORTED_SENTENCE))
      return `${name} is served historically without saying it has no recorded history`;
  }
  return null;
});

check("a claim opened at a strict ancestor and still open survives the cut", () => {
  const reason = needFixture();
  if (reason) return reason;
  const atMid = describeLocus({
    locus: "src/examined.ts",
    sections: SECTIONS,
    as_of_sha: fixture.mid,
  });
  const ids = (sectionOf(atMid, "structure")?.items ?? []).map((item) => item.claim_id);
  if (!ids.includes("CL-1"))
    return `the reading at mid dropped the open claim: ${JSON.stringify(ids)}`;
  if (ids.includes("CL-0")) return "a claim invalidated at mid was served by the reading at mid";
  const atBase = describeLocus({
    locus: "src/examined.ts",
    sections: SECTIONS,
    as_of_sha: fixture.base,
  });
  const baseIds = (sectionOf(atBase, "structure")?.items ?? []).map((item) => item.claim_id);
  return baseIds.includes("CL-0")
    ? null
    : `the reading at base dropped the claim that was current there: ${JSON.stringify(baseIds)}`;
});

check("a resolution event at a later commit is not replayed into an earlier reading", () => {
  const reason = needFixture();
  if (reason) return reason;
  const now =
    sectionOf(describeLocus({ locus: "src/examined.ts", sections: SECTIONS }), "defects")?.items ??
    [];
  const then =
    sectionOf(
      describeLocus({ locus: "src/examined.ts", sections: SECTIONS, as_of_sha: fixture.mid }),
      "defects",
    )?.items ?? [];
  const stateOf = (items, id) => items.find((item) => item.finding_id === id)?.resolution_state;
  if (stateOf(now, "B01-2") !== "fixed-pending-verification")
    return `at head B01-2 reads ${JSON.stringify(stateOf(now, "B01-2"))}`;
  return stateOf(then, "B01-2") === "open"
    ? null
    : `at mid B01-2 reads ${JSON.stringify(stateOf(then, "B01-2"))}, replaying a repair recorded at head`;
});

// §3.3's replay, read at four cuts around one finding's whole life. A
// verification is a *later* reading than the repair it confirms — the evidence
// is collected at a descendant commit — so an event placed at the repair SHA
// back-dates the verification to a commit at which nobody had verified
// anything. `effective_sha` is the revision each event was read at; the replay
// cuts by it.
check("a verification is replayed at the revision it was collected at, not at the repair", () => {
  const reason = needFixture();
  if (reason) return reason;
  const stateAt = (sha) => {
    const items =
      sectionOf(
        describeLocus({
          locus: "src/examined.ts",
          sections: SECTIONS,
          ...(sha ? { as_of_sha: sha } : {}),
        }),
        "defects",
      )?.items ?? [];
    return items.find((item) => item.finding_id === "B01-6")?.resolution_state;
  };
  const want = [
    [fixture.base, "open", "before the repair"],
    [fixture.mid, "open", "between the report and the repair"],
    [fixture.head, "fixed-pending-verification", "at the repair, before verification"],
    [fixture.verified, "verified-fixed", "at the verification"],
    [null, "verified-fixed", "at head"],
  ];
  const bad = [];
  for (const [sha, expected, where] of want) {
    const got = stateAt(sha);
    if (got !== expected) bad.push(`${where}: ${JSON.stringify(got)}, expected ${expected}`);
  }
  return bad.length ? bad.join("; ") : null;
});

// The same cut, read through the section that publishes the events themselves.
// A replay that drops verified-fixed events entirely (the review's sabotage)
// leaves the state assertions above satisfiable from the repair event alone;
// this one counts the event.
check("history_pointer carries the verification event only at or after its revision", () => {
  const reason = needFixture();
  if (reason) return reason;
  const eventsAt = (sha) =>
    (
      sectionOf(
        describeLocus({
          locus: "src/examined.ts",
          sections: SECTIONS,
          ...(sha ? { as_of_sha: sha } : {}),
        }),
        "history_pointer",
      )?.items ?? []
    ).filter((item) => item.kind === "resolution-event" && item.finding_id === "B01-6");
  const atRepair = eventsAt(fixture.head);
  const atVerified = eventsAt(fixture.verified);
  const bad = [];
  if (atRepair.some((item) => item.resolution_state === "verified-fixed"))
    bad.push("the reading at the repair commit already carries the verification event");
  if (atRepair.length !== 1) bad.push(`the reading at the repair carries ${atRepair.length} event(s), not the repair alone`);
  if (!atVerified.some((item) => item.resolution_state === "verified-fixed"))
    bad.push("the reading at the verification commit does not carry the verification event");
  return bad.length ? bad.join("; ") : null;
});

check("history_pointer applies the same ancestry cut it declares support for", () => {
  const reason = needFixture();
  if (reason) return reason;
  const at = (sha) =>
    sectionOf(
      describeLocus({
        locus: "src/examined.ts",
        sections: SECTIONS,
        ...(sha ? { as_of_sha: sha } : {}),
      }),
      "history_pointer",
    );
  const now = at(null);
  const nowEvents = (now?.items ?? []).filter((item) => item.kind === "resolution-event");
  if (!nowEvents.some((item) => item.finding_id === "B01-2"))
    return "the current reading does not carry B01-2's resolution event at all";
  const then = at(fixture.mid);
  // The section declares as_of_supported: true, so it owes the reading the
  // same cut defects takes. B01-2's only event names `head`, which is not an
  // ancestor of `mid`.
  if (then?.as_of_supported !== true)
    return `history_pointer reports as_of_supported ${JSON.stringify(then?.as_of_supported)}`;
  const thenEvents = (then?.items ?? []).filter((item) => item.kind === "resolution-event");
  const leaked = thenEvents.filter((item) => item.finding_id === "B01-2");
  if (leaked.length)
    return `the reading at mid replayed a resolution event recorded at head: ${JSON.stringify(leaked.map((i) => i.event_id))}`;
  // The counts are part of the reading, not decoration.
  if (then?.counts?.finding_resolution_events !== thenEvents.length)
    return `counts.finding_resolution_events is ${JSON.stringify(then?.counts?.finding_resolution_events)} against ${thenEvents.length} served`;
  return null;
});

// ---------------------------------------------------------------------------
// 9. Determinism and the trace (C17)
// ---------------------------------------------------------------------------
emit("");
emit("determinism");

check("the response reports model_calls 0 and registry-exact selection", () => {
  const reason = needFixture();
  if (reason) return reason;
  const payload = describeLocus({ locus: "src/examined.ts" });
  if (payload?.trace?.model_calls !== 0)
    return `model_calls is ${JSON.stringify(payload?.trace?.model_calls)}`;
  if (payload?.trace?.selection !== "registry-exact-v1")
    return `selection is ${JSON.stringify(payload?.trace?.selection)}`;
  if (payload?.contract_version !== CONTRACT_VERSION)
    return `contract_version is ${JSON.stringify(payload?.contract_version)}`;
  return typeof payload?.trace?.payload_bytes === "number" ? null : "the trace reports no size";
});

check("the same store and head produce byte-identical output", () => {
  const reason = needFixture();
  if (reason) return reason;
  const first = JSON.stringify(describeLocus({ locus: "src/examined.ts", sections: SECTIONS }));
  const second = JSON.stringify(describeLocus({ locus: "src/examined.ts", sections: SECTIONS }));
  return first === second ? null : "two identical calls disagreed";
});

check("every response validates against the shipped contract", () => {
  const reason = needFixture();
  if (reason) return reason;
  if (!validateAccount) return "the contract did not compile";
  const cases = [
    { locus: "src/examined.ts", sections: SECTIONS },
    { locus: "src/unledgered.ts" },
    { locus: "src/candidate.ts" },
    { locus: "src/mixed.ts" },
    { locus: "B-01" },
    { locus: "src/examined.ts:readLedger" },
    { locus: "row cursor" },
    { locus: "quiescence" },
    { locus: "src/examined.ts", as_of_sha: fixture.mid },
  ];
  for (const args of cases) {
    const payload = describeLocus(args);
    if (!validateAccount(payload)) {
      const error = (validateAccount.errors ?? [])[0];
      return `${args.locus} does not validate: ${error?.instancePath || "/"} ${error?.message}`;
    }
  }
  return null;
});

// ---------------------------------------------------------------------------
// 10. Measured fields keep their denominators (C7, VP4)
// ---------------------------------------------------------------------------
emit("");
emit("measured");

check("a zero measured field is served with its denominator, never as health", () => {
  const reason = needFixture();
  if (reason) return reason;
  const unledgered = describeLocus({ locus: "src/unledgered.ts" }).standing.measured ?? {};
  const keys = Object.keys(unledgered);
  if (JSON.stringify(keys) !== JSON.stringify(MEASURED_FIELDS))
    return `measured carries ${JSON.stringify(keys)}`;
  if (unledgered.ledger_rows !== 0) return `ledger_rows is ${unledgered.ledger_rows}`;
  if (unledgered.staleness_measured !== false)
    return "an empty ledger reports that staleness was measured";
  if (unledgered.ledger_reconciled === null)
    return "a path with no owner row does not report whether a reconciliation recorded it";
  const examined = describeLocus({ locus: "src/examined.ts" }).standing.measured ?? {};
  if (examined.staleness_measured !== true)
    return "a ledgered path reports that staleness was not measured";
  if (examined.ledger_reconciled !== null)
    return "a ledgered path reports a reconciliation the scope_gaps table cannot witness";
  return examined.reconciliation_receipt?.last_checked_sha === fixture.head
    ? null
    : "the reconciliation receipt does not carry git_state's checked revision";
});

// ---------------------------------------------------------------------------
// 11. The origin head is reported, not reconciled (§2.4.4)
// ---------------------------------------------------------------------------
emit("");
emit("revision");

check("an origin head that disagrees with the workspace head is reported", () => {
  const reason = needFixture();
  if (reason) return reason;
  if (!fixture.divergentCtx) return "the divergent clone could not be built";
  const revision = describeLocus({ locus: "src/examined.ts" }, fixture.divergentCtx).standing.revision;
  if (revision.repository_head !== fixture.divergentCtx.divergentHead)
    return "repository_head is not the workspace head";
  if (revision.origin_head !== fixture.verified)
    return `origin_head is ${JSON.stringify(revision.origin_head)}, not the recorded upstream head`;
  if (revision.origin_head === revision.repository_head)
    return "the two heads were reconciled into one";
  return revision.checked_sha === fixture.head ? null : "checked_sha was rewritten by the probe";
});

// ---------------------------------------------------------------------------
// 12. Custody
// ---------------------------------------------------------------------------
emit("");
emit("custody");

check("the packet's gate runs in CI", () => {
  const ci = readText(join(REPO, CI_REL));
  if (ci === null) return `${CI_REL} is absent`;
  return ci.includes("node test-locus-standing.mjs") ? null : "the gate is not run in CI";
});

check("the account reads its section and partition names from the enum source", () => {
  if (vocabulary === null) return `${VOCABULARY_REL} is absent`;
  const states = (vocabulary.enums?.finding_resolution_state?.values ?? []).map((v) => v.value);
  const missing = ["open", "accepted", "ruled-out", "fixed-pending-verification", "verified-fixed"].filter(
    (state) => !states.includes(state),
  );
  if (missing.length) return `the enum source lost ${missing.join(", ")}`;
  const source = readText(join(MCP, "src", "tools", "locus.ts"));
  if (source === null) return "mcp-server/src/tools/locus.ts is absent";
  if (!/from "\.\.\/vocabulary\.js"/.test(source))
    return "locus.ts does not read the generated enum module";
  return /const\s+\w*(SEVERIT|EVIDENCE_KINDS)\w*\s*=\s*\[/.test(source)
    ? "locus.ts redeclares an enum the vocabulary source owns"
    : null;
});

// ---------------------------------------------------------------------------
if (fixture?.db) {
  try {
    fixture.db.close();
  } catch {
    /* the fixture is being torn down; a close failure changes no verdict */
  }
}
for (const dir of roots) rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  emit("");
  emit(
    `GATE P6 RED: the describe_locus account, its standing block, and its unknown[] sources do not hold — ${failures.length} assertion(s) failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("");
emit("GATE P6 GREEN");
