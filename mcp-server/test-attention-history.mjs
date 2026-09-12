#!/usr/bin/env node
// Gate for reader-lenses packet P14 — `get_attention` and `get_history`
// (spec.md §5.2, §5.3, §6.1, §4.1–§4.3; claims C23, C24, C55, C63).
//
// Turns red when:
//   - `get_attention` or `get_history` is not registered, or either answers
//     with something other than the payload its contract declares;
//   - a per-label fixture reads back under the wrong label: an open finding
//     with a prior `verified-fixed` event that is not `regression`; an open
//     `candidate-concern` note that is not `unverified-suspicion`; an open
//     question that is not `unknown`; a claim interval closed at or before the
//     checked head that is not `stale-knowledge` with `source: "claim"`; a
//     `fixed-pending-verification` row that is not `awaiting-verification`; an
//     unresolved contradiction, an `open` or `unresolved-competition` matrix,
//     or an `unresolved-competition` disposition that is not `undiscriminated`;
//   - a finding with no prior verified repair is labelled anything but `open`,
//     so ADR-0010's `latent-defect` has been re-based rather than dropped;
//   - `latent-defect`, `contested`, `ruled-out-historical`, or any label
//     outside the seven the vocabulary source carries appears anywhere in
//     either response;
//   - claim-derived and ledger-derived stale knowledge are pooled into one
//     count, or a stale item carries neither `source`, or a drifted file that
//     nobody has read is labelled `stale-knowledge`;
//   - the selected `open` and `awaiting_verification` finding ids unioned with
//     the ids `omitted[]` records under reason `budget` are not exactly the
//     `finding_state_current` query's ids, or `omitted[].count` does not
//     reconcile `selected + omitted == census` in any section, or the union is
//     satisfied by an empty or truncated id list;
//   - `get_history` drops resolution events, claim supersessions, claim
//     validity events, contradiction resolutions, closed questions, resolved
//     leads, or sessions, or serves any of them oldest-first;
//   - `get_history` accepts neither subject or both at once;
//   - either wire response — the compact text block plus the duplicated
//     `structuredContent` — exceeds its §4.1 budget, or carries no omission
//     ledger, or reports a size it does not have;
//   - a `scope` argument does not restrict what the response serves;
//   - either tool is not advertised read-only, is absent from the generated
//     inventory, or the gate does not run in CI.
//
// False greens it cannot exclude. An exactly reconciled list can still be a
// list of wrong findings: every assertion here is about the partition and the
// labelling, and none of them is about whether a recorded defect is real. The
// label *meanings* are read from `contracts/conspectus-vocabulary.json`, which
// is one source this gate shares with the implementation, so a change made in
// both places at once would pass — §13's `test-vocabulary-source.mjs` is what
// reads that source against SKILL.md independently. The seven labels
// themselves are written out below rather than imported, so widening the enum
// in the code cannot widen what this gate accepts. Ordering is asserted over
// one seeded store, so it cannot exclude an ordering that is right for these
// rows and wrong for a family no fixture here fills.
//
// Output protocol: exactly one status line, last, on stdout. Every message is
// scrubbed of the launcher's crash signatures, so an absent deliverable reads
// as a failed assertion rather than as a gate that never ran.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const MCP = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(MCP, "..");

const ATTENTION_CONTRACT_REL = "mcp-server/contracts/attention.schema.json";
const HISTORY_CONTRACT_REL = "mcp-server/contracts/locus-history.schema.json";
const VOCABULARY_REL = "mcp-server/contracts/conspectus-vocabulary.json";
const INVENTORY_REL = "mcp-server/DEVELOPMENT.md";
const CI_REL = ".github/workflows/test.yml";

// §4.1's table for the two new tools, written out rather than read from the
// implementation so that changing a budget in the code cannot also change what
// this gate expects.
const ATTENTION_BUDGET = 12288;
const HISTORY_BUDGET = 8192;

// §5.2's seven labels: ADR-0010's four reused verbatim, the two `get_attention`
// adds, and `open`, which is `finding_state_current.resolution_state`'s own
// value and not a label this tool invents.
const LABELS = [
  "open",
  "regression",
  "unverified-suspicion",
  "unknown",
  "stale-knowledge",
  "awaiting-verification",
  "undiscriminated",
];
// The three ADR-0010 labels §5.2 refuses, each for a stated reason. None of
// them may appear anywhere in either response, under any key.
const REFUSED = ["latent-defect", "contested", "ruled-out-historical"];

const ATTENTION_SECTIONS = [
  "open",
  "awaiting_verification",
  "undiscriminated",
  "decisions",
  "leads",
  "stale",
  "hot_spots",
];
const HISTORY_SECTIONS = [
  "resolutions",
  "claims",
  "contradictions",
  "questions",
  "leads",
  "sessions",
];
const REASONS = ["policy", "budget"];

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
async function check(label, fn) {
  let reason = null;
  try {
    reason = await fn();
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

function bytes(value) {
  return Buffer.byteLength(typeof value === "string" ? value : (JSON.stringify(value) ?? ""), "utf8");
}

// ---------------------------------------------------------------------------
// Deliverables, loaded defensively. `dist/` is a build artifact, so a gate that
// imports it without compiling certifies whatever was last built rather than
// the source under review (F1-F3/codex): compile first, and let a compile
// failure poison the fixture rather than passing quietly against stale bytes.
// ---------------------------------------------------------------------------
const built = ensureBuilt();

let mods = null;
let loadError = null;
try {
  const [db, project, locus, helpers] = await Promise.all([
    import("./dist/db.js"),
    import("./dist/project.js"),
    import("./dist/tools/locus.js"),
    import("./dist/helpers.js"),
  ]);
  mods = { db, project, locus, helpers };
} catch (e) {
  loadError = e && e.message ? e.message : String(e);
}

let Ajv2020 = null;
try {
  Ajv2020 = (await import("ajv/dist/2020.js")).default;
} catch {
  Ajv2020 = null;
}

function compileContract(rel) {
  const schema = readJson(join(REPO, rel));
  if (!schema || !Ajv2020) return { schema, validate: null };
  try {
    return { schema, validate: new Ajv2020({ strict: true }).compile(schema) };
  } catch {
    return { schema, validate: null };
  }
}

const attentionContract = compileContract(ATTENTION_CONTRACT_REL);
const historyContract = compileContract(HISTORY_CONTRACT_REL);

/** The bytes a host receives: compact text block plus the repeated structuredContent. */
function wireBytes(payload) {
  return bytes(JSON.stringify(mods.helpers.jsonResult(payload, { compact: true })));
}

function prettyWireBytes(payload) {
  return bytes(JSON.stringify(mods.helpers.jsonResult(payload)));
}

// ---------------------------------------------------------------------------
// Fixture. One workspace at two commits and one store carrying a row of every
// family §5.2 and §5.3 name, each seeded so that exactly one reading of it is
// correct and a stub cannot satisfy the assertion by returning a shape.
//
//   B-01  the labelled families: one regression (open, with a prior
//         verified-fixed event), one plain open finding, one awaiting
//         verification, one verified-fixed, an open candidate-concern lead and
//         an open tension lead, an open question and an answered one, an
//         unresolved contradiction and a resolved one, an `unresolved-
//         competition` matrix and a disposition, a claim closed at the checked
//         head and a current one, an examined file the repository changed
//         under and a candidate file that also drifted.
//   B-02  forty open findings, so the byte budget truncates and the omission
//         ledger's ids are what the equality assertion reconciles against.
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
  : loadError
    ? `the locus tools could not be loaded — ${loadError}`
    : null;

function buildFixture() {
  const root = tempRoot("amanuensis-attention-history-");
  const workspace = join(root, "workspace");
  const storageRoot = join(root, "storage-root");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(join(workspace, "lib"), { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  git(workspace, "init", "-q", "-b", "main");
  git(workspace, "config", "user.email", "test@localhost");
  git(workspace, "config", "user.name", "Attention History Test");
  git(workspace, "config", "commit.gpgsign", "false");
  for (const name of ["ingest", "drifted", "unread"]) {
    writeFileSync(join(workspace, "src", `${name}.ts`), `export const ${name} = 1;\n`);
  }
  writeFileSync(join(workspace, "lib", "store.ts"), "export const store = 1;\n");
  git(workspace, "add", "src", "lib");
  git(workspace, "commit", "-q", "--no-verify", "-m", "base");
  const base = git(workspace, "rev-parse", "HEAD");
  writeFileSync(join(workspace, "src", "drifted.ts"), "export const drifted = 2;\n");
  git(workspace, "add", "src");
  git(workspace, "commit", "-q", "--no-verify", "-m", "drift");
  const head = git(workspace, "rev-parse", "HEAD");

  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
  const project = mods.project.resolveProject(workspace, {
    selectionSource: "test-attention-history",
    serverVersion: "test",
  });
  mods.project.ensureProjectStorage(project, (dbPath) => mods.db.openDatabase(dbPath).close());
  const db = mods.db.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };

  db.prepare(
    `INSERT INTO git_state (repo_id, canonical_branch, last_checked_sha, last_checked_at, onboarding_sha)
     VALUES ('default','main',?, '2026-09-02 09:00:00', ?)`,
  ).run(head, base);

  const session = db.prepare(
    "INSERT INTO sessions (session_id, intent, started_at, ended_at, outcome) VALUES (?,?,?,?,?)",
  );
  session.run("s-1", "survey B-01", "2026-09-01 09:00:00", "2026-09-01 11:00:00", "completed");
  session.run("s-2", "adversarial B-01", "2026-09-02 09:00:00", null, null);

  db.prepare(
    "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading) VALUES (?,?,?,?,?,?)",
  ).run("B-01", "Ingest", "concerns", "core", "src/", "src/ingest.ts");
  db.prepare(
    "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading) VALUES (?,?,?,?,?,?)",
  ).run("B-02", "Store", "concerns", "core", "lib/", "lib/store.ts");

  const ledger = db.prepare(
    `INSERT INTO file_ledger
       (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at, stale, stale_since, stale_reason)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  ledger.run("B-01", "src/ingest.ts", "the entry point", "examined", head, "2026-09-01 10:00:00", 0, null, null);
  // The examined reading the repository has moved under: `stale-knowledge`.
  ledger.run("B-01", "src/drifted.ts", "read at the base", "examined", base, "2026-09-01 10:05:00", 1, "2026-09-02 09:00:00", "git-drift");
  // Scoped, never read, and changed since: obligation-bearing and drifted, and
  // §6.1 refuses to call it stale knowledge.
  ledger.run("B-01", "src/unread.ts", "in scope", "candidate", base, null, 1, "2026-09-02 09:00:00", "git-drift");
  ledger.run("B-02", "lib/store.ts", "the store", "examined", head, "2026-09-01 10:10:00", 0, null, null);

  const evidence = db.prepare(
    "INSERT INTO evidence (file_path, symbol, ref_sha, kind, note, session_id) VALUES (?,?,?,?,?,?)",
  );
  const eIngest = Number(evidence.run("src/ingest.ts", "read", head, "code-verified", "read", "s-1").lastInsertRowid);
  const eFix = Number(evidence.run("src/ingest.ts", "read", head, "test-observed", "verified", "s-1").lastInsertRowid);
  const eClaim = Number(evidence.run("src/ingest.ts", "read", head, "code-verified", "claim", "s-1").lastInsertRowid);
  const eStore = Number(evidence.run("lib/store.ts", "put", head, "code-verified", "store", "s-2").lastInsertRowid);

  const finding = db.prepare(
    `INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status,
                           fix_location, primary_files, ref_sha, session_id, pass_type)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  // The regression: currently open, with a prior verified-fixed event.
  finding.run("B01-1", "B-01", "reopened after a verified repair", "the guard was reverted", "HIGH",
    "confirmed-bug", "src/ingest.ts:read", '["src/ingest.ts:read"]', head, "s-1", "survey");
  // A plain open finding with no prior repair: ADR-0010 would have called this
  // one a latent defect and §5.2 drops that label rather than re-basing it.
  finding.run("B01-2", "B-01", "unbounded read", "no ceiling", "CRITICAL",
    "confirmed-bug", null, '["src/ingest.ts:read"]', base, "s-1", "survey");
  finding.run("B01-3", "B-01", "repair not yet verified", "fix landed without proof", "MEDIUM",
    "fixed", "src/ingest.ts:read", '["src/ingest.ts:read"]', head, "s-1", "survey");
  finding.run("B01-4", "B-01", "a defect with a proven repair", "off-by-one", "LOW",
    "fixed", "src/ingest.ts:read", '["src/ingest.ts:read"]', head, "s-1", "survey");
  const findingEvidence = db.prepare(
    "INSERT INTO finding_evidence (finding_id, evidence_id, role) VALUES (?,?,?)",
  );
  findingEvidence.run("B01-1", eIngest, "symptom");
  findingEvidence.run("B01-1", eFix, "fix-verification");
  findingEvidence.run("B01-2", eIngest, "symptom");
  findingEvidence.run("B01-3", eIngest, "symptom");
  findingEvidence.run("B01-4", eFix, "fix-verification");

  const event = db.prepare(
    `INSERT INTO finding_resolution_events
       (finding_id, resolution_state, fix_location, fix_sha, evidence_id, rationale, session_id, recorded_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  event.run("B01-1", "fixed-pending-verification", "src/ingest.ts:read", base, null, "repair landed", "s-1", "2026-09-01 10:20:00");
  event.run("B01-1", "verified-fixed", "src/ingest.ts:read", base, eFix, "verified at the base", "s-1", "2026-09-01 10:30:00");
  event.run("B01-1", "open", null, null, null, "the guard was reverted", "s-2", "2026-09-02 10:00:00");
  event.run("B01-3", "fixed-pending-verification", "src/ingest.ts:read", head, null, "repair landed", "s-1", "2026-09-01 10:40:00");
  event.run("B01-4", "fixed-pending-verification", "src/ingest.ts:read", head, null, "repair landed", "s-1", "2026-09-01 10:50:00");
  event.run("B01-4", "verified-fixed", "src/ingest.ts:read", head, eFix, "verified at the head", "s-1", "2026-09-01 11:00:00");

  // Forty open findings on B-02, so the byte budget truncates `open` and the
  // ledger's ids are what the equality assertion reconciles against.
  for (let index = 1; index <= 40; index += 1) {
    const id = `B02-${index}`;
    finding.run(id, "B-02", `open defect ${index}`, "seeded", index % 2 === 0 ? "HIGH" : "LOW",
      "confirmed-bug", null, '["lib/store.ts:put"]', head, "s-2", "survey");
    findingEvidence.run(id, eStore, "symptom");
  }

  const note = db.prepare(
    "INSERT INTO field_notes (id, category, observation, location, ref_sha, follow_up, session_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
  );
  note.run(1, "candidate-concern", "the read path may not bound its buffer", "src/ingest.ts", head, "open", "s-1", "2026-09-01 10:00:00");
  note.run(2, "tension", "two modules disagree about who owns the buffer", "src/ingest.ts", head, "open", "s-1", "2026-09-01 10:01:00");
  note.run(3, "anomaly", "a counter resets without a writer", "src/ingest.ts", head, "B01-2", "s-1", "2026-09-01 10:02:00");
  note.run(4, "pattern", "every reader takes the lock twice", "src/ingest.ts", head, "dismissed", "s-1", "2026-09-01 10:03:00");

  const question = db.prepare(
    `INSERT INTO open_questions (id, category, subsystem_id, phase, question, session_id, ref_sha, resolution, answer, created_at, resolved_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  question.run(1, "domain-knowledge", "B-01", "structural", "is a partial read ever legitimate?", "s-1", head, "open", null, "2026-09-01 10:00:00", null);
  question.run(2, "scope-judgment", "B-01", "scoping", "does the parser belong to this subsystem?", "s-1", head, "answered", "yes", "2026-09-01 10:01:00", "2026-09-02 08:00:00");
  question.run(3, "tooling-limit", "B-01", "scoping", "can the lock be traced?", "s-1", head, "dismissed", null, "2026-09-01 10:02:00", "2026-09-03 08:00:00");

  db.prepare(
    `INSERT INTO contradictions (id, finding_a, finding_b, shared_location, conflict_type, resolution, resolved_at, session_id)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(1, "B01-1", "B01-2", "src/ingest.ts:read", "severity-conflict", "unresolved", null, null);
  db.prepare(
    `INSERT INTO contradictions (id, finding_a, finding_b, shared_location, conflict_type, resolution, resolved_at, session_id)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(2, "B01-3", "B01-4", "src/ingest.ts:read", "classification-conflict", "a-supersedes-b", "2026-09-02 08:30:00", "s-2");
  db.prepare(
    `INSERT INTO contradiction_resolution_events (contradiction_id, resolution, evidence_id, rationale, session_id, recorded_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(2, "a-supersedes-b", eIngest, "the later reading supersedes", "s-2", "2026-09-02 08:30:00");

  const concern = db.prepare(
    "INSERT INTO concerns (code, category, origin, discovered_in) VALUES (?,?,?,?)",
  );
  concern.run("CC-1", "concurrency", "seeded", "B-01");
  concern.run("CC-2", "data-integrity", "seeded", "B-01");
  const disposition = db.prepare(
    `INSERT INTO dispositions (subsystem_id, concern_code, classification, evidence, evidence_quality, rationale)
     VALUES (?,?,?,?,?,?)`,
  );
  disposition.run("B-01", "CC-1", "unresolved-competition", `src/ingest.ts:read@${head}`, "code-verified", "two accounts stand");
  disposition.run("B-01", "CC-2", "confirmed-bug", `src/ingest.ts:read@${head}`, "name-inferred", "the weakest reading");

  const matrix = db.prepare(
    `INSERT INTO diagnosticity_sessions (id, subsystem_id, symptom, shared_location, outcome, session_id, created_at, resolved_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  matrix.run(1, "B-01", "the counter resets", "src/ingest.ts:read", "unresolved-competition", "s-2", "2026-09-02 08:00:00", "2026-09-02 08:40:00");
  matrix.run(2, "B-01", "the lock is taken twice", "src/ingest.ts:read", "resolved", "s-2", "2026-09-02 08:10:00", "2026-09-02 08:50:00");

  const claim = db.prepare(
    `INSERT INTO claims (claim_id, claim_key, subject_type, subject_id, statement, epistemic_kind,
                         asserted_at_sha, valid_from_sha, valid_until_sha, session_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  claim.run("C-1", "B-01/key-type", "subsystem", "B-01", "the ingest path is a pull loop", "observation", base, base, head, "s-1");
  claim.run("C-2", "B-01/flow", "subsystem", "B-01", "reads flow through one queue", "observation", head, head, null, "s-1");
  // The successor shares C-1's claim_key and its validity boundary, which is
  // what `claim_supersession_integrity` requires of a real supersession.
  claim.run("C-3", "B-01/key-type", "subsystem", "B-01", "the ingest path is a push loop", "observation", head, head, null, "s-1");
  const claimEvidence = db.prepare(
    "INSERT INTO claim_evidence (claim_id, evidence_id, role) VALUES (?,?,'supports')",
  );
  for (const id of ["C-1", "C-2", "C-3"]) claimEvidence.run(id, eClaim);
  db.prepare(
    `INSERT INTO claim_validity_events (claim_id, event_type, at_sha, reason, evidence_id, session_id, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run("C-1", "asserted", base, "first reading", eClaim, "s-1", "2026-09-01 10:00:00");
  db.prepare(
    `INSERT INTO claim_validity_events (claim_id, event_type, at_sha, reason, evidence_id, session_id, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run("C-1", "superseded", head, "replaced by C-3", eClaim, "s-1", "2026-09-02 10:00:00");
  db.prepare(
    `INSERT INTO claim_supersessions (predecessor_claim_id, successor_claim_id, at_sha, evidence_id, rationale, session_id, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run("C-1", "C-3", head, eClaim, "the queue reading replaces the loop reading", "s-1", "2026-09-02 10:00:00");

  return { root, workspace, storageRoot, project, db, ctx, base, head };
}

if (!fixtureError) {
  try {
    fixture = buildFixture();
  } catch (e) {
    fixtureError = `the fixture could not be built — ${e && e.message ? e.message : e}`;
  }
}

function toolNamed(name) {
  const tools = mods?.locus?.locusTools;
  return Array.isArray(tools) ? (tools.find((entry) => entry.name === name) ?? null) : null;
}

function call(name, args) {
  const tool = toolNamed(name);
  if (!tool) throw new Error(`${name} is not registered in locusTools`);
  if (typeof tool.handler !== "function") throw new Error(`${name} carries no handler`);
  return tool.handler(args, fixture.ctx);
}

function sectionOf(payload, name) {
  return payload?.sections?.[name] ?? null;
}

function itemsOf(payload, name) {
  const section = sectionOf(payload, name);
  return Array.isArray(section?.items) ? section.items : [];
}

/**
 * Every id the section's census holds: the ones it served plus the ones its
 * ledger records. A byte budget decides how many rows fit; it never decides
 * what the census holds, so membership is asserted here and selection is
 * asserted separately.
 */
function censusIds(payload, section, servedId) {
  const served = itemsOf(payload, section).map(servedId);
  const ledger = (payload?.omitted ?? []).filter((entry) => entry.section === section);
  for (const entry of ledger) {
    if (entry.ids_truncated) return { ids: null, truncated: true };
  }
  return { ids: new Set([...served, ...ledger.flatMap((entry) => entry.ids ?? [])]), truncated: false };
}

function omittedIds(payload, section, reason) {
  const entries = Array.isArray(payload?.omitted) ? payload.omitted : [];
  const out = [];
  for (const entry of entries) {
    if (entry?.section !== section) continue;
    if (reason && entry?.reason !== reason) continue;
    for (const id of entry.ids ?? []) out.push(id);
  }
  return out;
}

let attention = null;
let attentionError = fixtureError;
let history = null;
let historyError = fixtureError;
if (!fixtureError) {
  try {
    attention = call("get_attention", {});
  } catch (e) {
    attentionError = `get_attention did not answer — ${e && e.message ? e.message : e}`;
  }
  try {
    history = call("get_history", { locus: "src/ingest.ts" });
  } catch (e) {
    historyError = `get_history did not answer — ${e && e.message ? e.message : e}`;
  }
}

// ---------------------------------------------------------------------------
emit("fixture");
emit(`  store: ${fixtureError ? "not built" : "built"}${fixtureError ? ` (${fixtureError})` : ""}`);
if (attention) {
  emit(`  get_attention: wire ${wireBytes(attention)} B (pretty ${prettyWireBytes(attention)} B), budget ${ATTENTION_BUDGET} B`);
}
if (history) {
  emit(`  get_history:   wire ${wireBytes(history)} B (pretty ${prettyWireBytes(history)} B), budget ${HISTORY_BUDGET} B`);
}

// ---------------------------------------------------------------------------
// 1. The tools answer at all (C23, C24)
// ---------------------------------------------------------------------------
emit("");
emit("tools");

await check("get_attention is registered and answers with sections, census, omitted and trace", () => {
  if (attentionError) return attentionError;
  if (!attention || typeof attention !== "object") return "get_attention returned no payload";
  for (const name of ATTENTION_SECTIONS) {
    if (!sectionOf(attention, name)) return `the response carries no ${name} section`;
  }
  const extra = Object.keys(attention.sections ?? {}).filter((name) => !ATTENTION_SECTIONS.includes(name));
  if (extra.length) return `the response carries sections §5.2 does not name: ${extra.join(", ")}`;
  if (!Array.isArray(attention.omitted)) return "the response carries no omission ledger";
  if (!attention.trace || attention.trace.model_calls !== 0) return "the trace does not report model_calls: 0";
  return null;
});

await check("get_history is registered and answers with every family §5.3 names", () => {
  if (historyError) return historyError;
  if (!history || typeof history !== "object") return "get_history returned no payload";
  for (const name of HISTORY_SECTIONS) {
    if (!sectionOf(history, name)) return `the response carries no ${name} section`;
  }
  if (!Array.isArray(history.omitted)) return "the response carries no omission ledger";
  if (!history.trace || history.trace.model_calls !== 0) return "the trace does not report model_calls: 0";
  return null;
});

await check("get_history requires exactly one of locus or finding_id", () => {
  if (fixtureError) return fixtureError;
  // An absent tool refuses every call, so the refusals below would read as
  // compliance. Check the tool exists before reading its refusals as answers.
  if (!toolNamed("get_history")) return "get_history is not registered in locusTools";
  let neither = null;
  try {
    call("get_history", {});
    neither = "a call with neither subject was accepted";
  } catch {
    /* refused, as §5.3 requires */
  }
  if (neither) return neither;
  try {
    call("get_history", { locus: "src/ingest.ts", finding_id: "B01-1" });
    return "a call naming both a locus and a finding was accepted";
  } catch {
    return null;
  }
});

// ---------------------------------------------------------------------------
// 2. Per-label fixture assertions (C23)
// ---------------------------------------------------------------------------
emit("");
emit("labels");

function labelOfFinding(id) {
  for (const name of ["open", "awaiting_verification"]) {
    for (const item of itemsOf(attention, name)) {
      if (item.finding_id === id) return { label: item.label, section: name };
    }
  }
  return null;
}

await check("a finding with a prior verified-fixed event is regression", () => {
  if (attentionError) return attentionError;
  const found = labelOfFinding("B01-1");
  if (!found) return "B01-1 is not served in open or awaiting_verification at all";
  if (found.section !== "open") return `B01-1 is served in ${found.section}, not open`;
  return found.label === "regression" ? null : `B01-1 carries the label ${JSON.stringify(found.label)}`;
});

await check("an open finding with no prior repair is open, not a re-based latent-defect", () => {
  if (attentionError) return attentionError;
  const found = labelOfFinding("B01-2");
  if (!found) return "B01-2 is not served in open or awaiting_verification at all";
  return found.label === "open" ? null : `B01-2 carries the label ${JSON.stringify(found.label)}`;
});

await check("a fixed-pending-verification row is awaiting-verification", () => {
  if (attentionError) return attentionError;
  const found = labelOfFinding("B01-3");
  if (!found) return "B01-3 is not served in open or awaiting_verification at all";
  if (found.section !== "awaiting_verification") return `B01-3 is served in ${found.section}`;
  return found.label === "awaiting-verification"
    ? null
    : `B01-3 carries the label ${JSON.stringify(found.label)}`;
});

await check("a verified-fixed finding is not in the attention response at all", () => {
  if (attentionError) return attentionError;
  return labelOfFinding("B01-4") === null ? null : "B01-4 is resolved and is served as unresolved";
});

await check("an open candidate-concern note is unverified-suspicion", () => {
  if (attentionError) return attentionError;
  const items = itemsOf(attention, "leads");
  const note = items.find((item) => item.note_id === 1);
  if (!note) return "the open candidate-concern note is not served in leads";
  if (note.label !== "unverified-suspicion") return `it carries the label ${JSON.stringify(note.label)}`;
  const other = items.find((item) => item.note_id === 2);
  if (other && other.label === "unverified-suspicion")
    return "an open `tension` note is labelled unverified-suspicion, which ADR-0010 defines over candidate-concern alone";
  const closed = items.find((item) => item.note_id === 3 || item.note_id === 4);
  return closed ? `a closed lead (${closed.note_id}) is served as unresolved` : null;
});

await check("an open question is unknown, and a resolved one is not served", () => {
  if (attentionError) return attentionError;
  const items = itemsOf(attention, "decisions");
  const open = items.find((item) => item.question_id === 1);
  if (!open) return "the open question is not served in decisions";
  if (open.label !== "unknown") return `it carries the label ${JSON.stringify(open.label)}`;
  const resolved = items.find((item) => item.question_id === 2 || item.question_id === 3);
  return resolved ? `a resolved question (${resolved.question_id}) is served as unresolved` : null;
});

await check("a seeded unresolved-competition matrix is undiscriminated, with its two siblings", () => {
  if (attentionError) return attentionError;
  const { ids, truncated } = censusIds(attention, "undiscriminated", (item) =>
    item.kind === "contradiction"
      ? `contradiction:${item.contradiction_id}`
      : item.kind === "diagnosticity-matrix"
        ? `matrix:${item.matrix_id}`
        : `disposition:${item.subsystem_id}/${item.concern_code}`,
  );
  if (truncated) return "the undiscriminated ledger truncated its ids, so membership cannot be read";
  for (const expected of ["matrix:1", "contradiction:1", "disposition:B-01/CC-1"]) {
    if (!ids.has(expected)) return `${expected} is neither served nor in the ledger`;
  }
  for (const refused of ["matrix:2", "contradiction:2", "disposition:B-01/CC-2"]) {
    if (ids.has(refused)) return `${refused} is resolved and is in the undiscriminated census`;
  }
  if (ids.size !== 3) return `the census holds ${ids.size} members for three seeded rows`;
  const counts = sectionOf(attention, "undiscriminated")?.counts ?? {};
  if (counts.contradictions !== 1 || counts.matrices !== 1 || counts.dispositions !== 1)
    return `the per-source counts read ${JSON.stringify(counts)}`;
  for (const item of itemsOf(attention, "undiscriminated")) {
    if (item.label !== "undiscriminated") return `a served item carries ${JSON.stringify(item.label)}`;
  }
  const matrix = itemsOf(attention, "undiscriminated").find((item) => item.kind === "diagnosticity-matrix");
  if (!matrix) return "no matrix is served, so the label cannot be read off one";
  return matrix.matrix_id === 1 ? null : `the matrix served is ${matrix.matrix_id}`;
});

await check("every served label is one of §5.2's seven, and no refused label appears anywhere", () => {
  if (attentionError || historyError) return attentionError ?? historyError;
  for (const name of ATTENTION_SECTIONS) {
    for (const item of itemsOf(attention, name)) {
      if (name === "hot_spots") {
        if ("label" in item) return `a hot_spots row carries a label: ${JSON.stringify(item.label)}`;
        continue;
      }
      if (!LABELS.includes(item.label)) {
        return `a ${name} item carries the label ${JSON.stringify(item.label)}, which §5.2 does not define`;
      }
    }
  }
  for (const [name, payload] of [["get_attention", attention], ["get_history", history]]) {
    const serialized = JSON.stringify(payload);
    for (const refused of REFUSED) {
      if (serialized.includes(refused)) return `${name}'s response carries the refused label ${refused}`;
    }
  }
  return null;
});

await check("the contract's label enum is exactly the vocabulary source's attention_label", () => {
  const source = readJson(join(REPO, VOCABULARY_REL));
  const values = source?.enums?.attention_label?.values;
  if (!Array.isArray(values)) return `${VOCABULARY_REL} carries no attention_label enum`;
  const fromSource = values.map((value) => value.value).sort();
  if (JSON.stringify(fromSource) !== JSON.stringify([...LABELS].sort()))
    return `the vocabulary source carries ${JSON.stringify(fromSource)}`;
  const schema = attentionContract.schema;
  if (!schema) return `${ATTENTION_CONTRACT_REL} is absent or is not JSON`;
  const declared = schema.$defs?.label?.enum;
  if (!Array.isArray(declared)) return "the contract declares no label enum";
  return JSON.stringify([...declared].sort()) === JSON.stringify([...LABELS].sort())
    ? null
    : `the contract declares ${JSON.stringify(declared)}`;
});

// ---------------------------------------------------------------------------
// 3. Stale knowledge is never pooled (C23, VP6)
// ---------------------------------------------------------------------------
emit("");
emit("stale knowledge");

await check("every stale-knowledge item declares source claim or source ledger", () => {
  if (attentionError) return attentionError;
  const items = itemsOf(attention, "stale");
  if (items.length === 0) return "the stale section serves nothing on a store seeded with both sources";
  for (const item of items) {
    if (item.label !== "stale-knowledge") return `a stale item carries ${JSON.stringify(item.label)}`;
    if (item.source !== "claim" && item.source !== "ledger")
      return `a stale item declares the source ${JSON.stringify(item.source)}`;
  }
  const { ids, truncated } = censusIds(attention, "stale", (item) =>
    item.source === "claim" ? `claim:${item.claim_id}` : `ledger:${item.subsystem_id}/${item.file_path}`,
  );
  if (truncated) return "the stale ledger truncated its ids, so membership cannot be read";
  if (!ids.has("claim:C-1")) return "the claim closed at the checked head is not in the stale census";
  for (const current of ["claim:C-2", "claim:C-3"]) {
    if (ids.has(current)) return `${current} is current and is in the stale census`;
  }
  if (!ids.has("ledger:B-01/src/drifted.ts"))
    return "the examined file the repository changed under is not in the stale census";
  return null;
});

await check("a drifted file nobody has read is not labelled stale-knowledge", () => {
  if (attentionError) return attentionError;
  for (const item of itemsOf(attention, "stale")) {
    if (item.file_path === "src/unread.ts")
      return "a `candidate` ledger row is served as stale knowledge, which asserts a reading nobody took";
  }
  const underBudget = omittedIds(attention, "stale", "budget");
  if (underBudget.includes("ledger:B-01/src/unread.ts"))
    return "the unread row is omitted under budget, so it was eligible to carry the label";
  const underPolicy = omittedIds(attention, "stale", "policy");
  if (!underPolicy.includes("ledger:B-01/src/unread.ts"))
    return "the drifted unread row is neither served nor recorded under policy, so it vanished";
  const counts = sectionOf(attention, "stale")?.counts ?? {};
  return typeof counts.drifted_unread === "number" && counts.drifted_unread >= 1
    ? null
    : `the drifted unread row is not counted: ${JSON.stringify(counts)}`;
});

await check("the two stale sources are counted apart and never summed", () => {
  if (attentionError) return attentionError;
  const section = sectionOf(attention, "stale");
  const counts = section?.counts ?? {};
  if (typeof counts.claim !== "number" || typeof counts.ledger !== "number")
    return `the stale section reports ${JSON.stringify(counts)} rather than a per-source breakdown`;
  if (counts.claim < 1 || counts.ledger < 1)
    return `the fixture seeds both sources but the counts read ${JSON.stringify(counts)}`;
  const pooled = counts.claim + counts.ledger;
  for (const [key, value] of Object.entries(counts)) {
    if (key === "claim" || key === "ledger") continue;
    if (value === pooled) return `counts.${key} is the pooled sum of the two sources (${pooled})`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// 4. The census reconciles exactly against finding_state_current (C54, §4.3)
// ---------------------------------------------------------------------------
emit("");
emit("census");

await check("open and awaiting-verification ids, with the budget-omitted ids, are the query exactly", () => {
  if (attentionError) return attentionError;
  const expected = new Set(
    fixture.db
      .prepare(
        "SELECT finding_id FROM finding_state_current WHERE resolution_state IN ('open','fixed-pending-verification')",
      )
      .all()
      .map((row) => row.finding_id),
  );
  if (expected.size < 10) return `the fixture seeds only ${expected.size} unresolved findings, too few to force truncation`;
  const served = [];
  for (const name of ["open", "awaiting_verification"]) {
    for (const item of itemsOf(attention, name)) served.push(item.finding_id);
  }
  const omittedEntries = (attention.omitted ?? []).filter(
    (entry) => ["open", "awaiting_verification"].includes(entry.section) && entry.reason === "budget",
  );
  for (const entry of omittedEntries) {
    if (entry.ids_truncated) return `the ${entry.section} ledger truncated its ids, so the union cannot be checked`;
    if ((entry.ids ?? []).length !== entry.count)
      return `the ${entry.section} ledger carries ${(entry.ids ?? []).length} ids for a count of ${entry.count}`;
  }
  const omitted = omittedEntries.flatMap((entry) => entry.ids ?? []).map((id) => String(id).replace(/^finding:/, ""));
  const union = new Set([...served, ...omitted]);
  if (union.size !== served.length + omitted.length) return "an id is served and omitted at once";
  const missing = [...expected].filter((id) => !union.has(id));
  const extra = [...union].filter((id) => !expected.has(id));
  if (missing.length) return `the union misses ${missing.length} id(s), first ${missing[0]}`;
  if (extra.length) return `the union carries ${extra.length} id(s) the query does not, first ${extra[0]}`;
  if (served.length === 0) return "no unresolved finding is served at all, so the equality holds vacuously";
  return null;
});

await check("every section reconciles selected + omitted == census in both responses", () => {
  if (attentionError || historyError) return attentionError ?? historyError;
  for (const [name, payload, sections] of [
    ["get_attention", attention, ATTENTION_SECTIONS],
    ["get_history", history, HISTORY_SECTIONS],
  ]) {
    for (const section of sections) {
      const view = sectionOf(payload, section);
      const selected = (view?.items ?? []).length;
      const dropped = (payload.omitted ?? [])
        .filter((entry) => entry.section === section)
        .reduce((total, entry) => total + (entry.count ?? 0), 0);
      if (selected + dropped !== view?.census)
        return `${name}'s ${section}: ${selected} selected + ${dropped} omitted != census ${view?.census}`;
      if (view?.census === 0 && view?.recorded !== false)
        return `${name}'s ${section} has census 0 and does not report recorded: false`;
      if (view?.census === 0 && dropped !== 0)
        return `${name}'s ${section} has census 0 and still emits an omission row`;
    }
    for (const entry of payload.omitted ?? []) {
      if (!REASONS.includes(entry.reason)) return `${name} omits under the reason ${JSON.stringify(entry.reason)}`;
    }
    const ids = (payload.omitted ?? []).flatMap((entry) => entry.ids ?? []);
    if (new Set(ids).size !== ids.length) return `${name} repeats an omitted id`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// 5. History: every family, newest first (C24)
// ---------------------------------------------------------------------------
emit("");
emit("history");

await check("get_history serves resolution events newest first", () => {
  if (historyError) return historyError;
  const view = sectionOf(history, "resolutions");
  if (view?.census !== 6) return `the resolutions census is ${view?.census} on a store holding six events`;
  const items = view.items ?? [];
  const ids = items.map((item) => item.event_id);
  if (ids.length === 0) return "no resolution event is served";
  const sorted = [...ids].sort((a, b) => b - a);
  if (JSON.stringify(ids) !== JSON.stringify(sorted)) return `the events are served ${JSON.stringify(ids)}`;
  if (ids[0] !== 6) return `the newest event is ${ids[0]}, so the page is not newest-first`;
  const census = censusIds(history, "resolutions", (item) => `event:${item.event_id}`);
  if (census.truncated) return "the resolutions ledger truncated its ids";
  for (let id = 1; id <= 6; id += 1) {
    if (!census.ids.has(`event:${id}`)) return `event:${id} is neither served nor in the ledger`;
  }
  return null;
});

await check("get_history serves claim supersessions and validity events", () => {
  if (historyError) return historyError;
  const view = sectionOf(history, "claims");
  if (view?.census !== 3) return `the claims census is ${view?.census} for one supersession and two validity events`;
  const { ids, truncated } = censusIds(history, "claims", (item) =>
    item.kind === "supersession" ? `supersession:${item.predecessor_claim_id}` : `claim-event:${item.event_id}`,
  );
  if (truncated) return "the claims ledger truncated its ids, so membership cannot be read";
  for (const expected of ["supersession:C-1", "claim-event:1", "claim-event:2"]) {
    if (!ids.has(expected)) return `${expected} is neither served nor in the ledger`;
  }
  const supersession = (view.items ?? []).find((item) => item.kind === "supersession");
  if (!supersession) return "the supersession is not the first thing served, so a reader sees no conclusion";
  if (supersession.predecessor_claim_id !== "C-1" || supersession.successor_claim_id !== "C-3")
    return `the supersession reads ${JSON.stringify([supersession.predecessor_claim_id, supersession.successor_claim_id])}`;
  const events = (view.items ?? []).filter((item) => item.kind === "validity-event").map((item) => item.event_id);
  const sorted = [...events].sort((a, b) => b - a);
  return JSON.stringify(events) === JSON.stringify(sorted) ? null : `the events are served ${JSON.stringify(events)}`;
});

await check("get_history serves contradiction resolutions, and only resolved ones", () => {
  if (historyError) return historyError;
  const items = itemsOf(history, "contradictions");
  if (!items.some((item) => item.contradiction_id === 2)) return "the resolved contradiction is not served";
  if (items.some((item) => item.contradiction_id === 1))
    return "the unresolved contradiction is served as history";
  return null;
});

await check("get_history serves closed questions and resolved leads, newest first by their own basis", () => {
  if (historyError) return historyError;
  const questions = censusIds(history, "questions", (item) => `question:${item.question_id}`);
  if (questions.truncated) return "the questions ledger truncated its ids";
  for (const expected of ["question:2", "question:3"]) {
    if (!questions.ids.has(expected)) return `${expected} is neither served nor in the ledger`;
  }
  if (questions.ids.has("question:1")) return "the open question is in the history census";
  const servedQuestions = itemsOf(history, "questions").map((item) => item.question_id);
  if (servedQuestions[0] !== 3)
    return `the newest closed question by resolved_at is not served first: ${JSON.stringify(servedQuestions)}`;
  if (!String(sectionOf(history, "questions")?.statement ?? "").includes("how it did is not"))
    return "the questions section does not carry §1.1's sentence about what the store does not record";

  const leads = censusIds(history, "leads", (item) => `lead:${item.note_id}`);
  if (leads.truncated) return "the leads ledger truncated its ids";
  for (const expected of ["lead:3", "lead:4"]) {
    if (!leads.ids.has(expected)) return `${expected} is neither served nor in the ledger`;
  }
  for (const open of ["lead:1", "lead:2"]) {
    if (leads.ids.has(open)) return `${open} is open and is in the history census`;
  }
  const servedLeads = itemsOf(history, "leads").map((item) => item.note_id);
  if (servedLeads[0] !== 4) return `the leads are not in descending id order: ${JSON.stringify(servedLeads)}`;
  const statement = String(sectionOf(history, "leads")?.statement ?? "");
  return statement.includes("the order below is the order the leads were opened")
    ? null
    : "the leads section does not carry §1.1's sentence about what the store does not record";
});

await check("get_history serves the sessions attributed to the locus by citation, newest first", () => {
  if (historyError) return historyError;
  const view = sectionOf(history, "sessions");
  const { ids, truncated } = censusIds(history, "sessions", (item) => `session:${item.session_id}`);
  if (truncated) return "the sessions ledger truncated its ids";
  for (const expected of ["session:s-1", "session:s-2"]) {
    if (!ids.has(expected)) return `${expected} is neither served nor in the ledger`;
  }
  const served = (view?.items ?? []).map((item) => item.session_id);
  if (served[0] !== "s-2") return `the sessions are not newest-first by started_at: ${JSON.stringify(served)}`;
  for (const item of view?.items ?? []) {
    for (const field of ["intent", "started_at", "ended_at", "outcome"]) {
      if (!(field in item)) return `a session row carries no ${field}`;
    }
  }
  return view?.session_attribution === "by-citation"
    ? null
    : `the section declares the attribution ${JSON.stringify(view?.session_attribution)}`;
});

await check("get_history by finding_id answers about that finding alone", () => {
  if (historyError) return historyError;
  let payload = null;
  try {
    payload = call("get_history", { finding_id: "B01-4" });
  } catch (e) {
    return `get_history(finding_id) did not answer — ${e && e.message ? e.message : e}`;
  }
  const items = payload?.sections?.resolutions?.items ?? [];
  if (items.length === 0) return "no resolution event is served for a finding that has two";
  const wrong = items.filter((item) => item.finding_id !== "B01-4");
  return wrong.length ? `${wrong.length} event(s) belong to another finding` : null;
});

// ---------------------------------------------------------------------------
// 6. Budgets and the ledger (§4.1, §4.3)
// ---------------------------------------------------------------------------
emit("");
emit("budgets");

await check("get_attention's wire response is within 12288 bytes and reports the size it has", () => {
  if (attentionError) return attentionError;
  const measured = wireBytes(attention);
  if (measured > ATTENTION_BUDGET) return `the wire response measures ${measured} bytes`;
  if (attention.trace?.response_bytes !== measured)
    return `the trace reports ${attention.trace?.response_bytes} bytes for a ${measured}-byte response`;
  if (attention.trace?.budget_bytes !== ATTENTION_BUDGET)
    return `the trace declares the budget ${attention.trace?.budget_bytes}`;
  return null;
});

await check("get_history's wire response is within 8192 bytes and reports the size it has", () => {
  if (historyError) return historyError;
  const measured = wireBytes(history);
  if (measured > HISTORY_BUDGET) return `the wire response measures ${measured} bytes`;
  if (history.trace?.response_bytes !== measured)
    return `the trace reports ${history.trace?.response_bytes} bytes for a ${measured}-byte response`;
  return null;
});

await check("the fixture would exceed the attention budget untruncated, so the budget is not trivially met", () => {
  if (attentionError) return attentionError;
  const truncated = (attention.omitted ?? []).some((entry) => entry.reason === "budget");
  if (!truncated) return "nothing was dropped under budget, so the 40-finding fixture never reached its ceiling";
  return attention.trace?.truncated === true ? null : "the trace does not declare that it truncated";
});

await check("both responses validate against their contracts", () => {
  if (attentionError || historyError) return attentionError ?? historyError;
  if (!Ajv2020) return "ajv is not installed, so the contracts cannot be compiled";
  if (!attentionContract.schema) return `${ATTENTION_CONTRACT_REL} is absent or is not JSON`;
  if (!historyContract.schema) return `${HISTORY_CONTRACT_REL} is absent or is not JSON`;
  if (!attentionContract.validate) return `${ATTENTION_CONTRACT_REL} does not compile as a strict JSON Schema`;
  if (!historyContract.validate) return `${HISTORY_CONTRACT_REL} does not compile as a strict JSON Schema`;
  if (!attentionContract.validate(attention))
    return `the attention response does not validate: ${JSON.stringify(attentionContract.validate.errors?.[0])}`;
  if (!historyContract.validate(history))
    return `the history response does not validate: ${JSON.stringify(historyContract.validate.errors?.[0])}`;
  return null;
});

await check("a scope argument restricts what get_attention serves", () => {
  if (fixtureError) return fixtureError;
  if (attentionError) return attentionError;
  let scoped = null;
  try {
    scoped = call("get_attention", { scope: "B-01" });
  } catch (e) {
    return `get_attention(scope) did not answer — ${e && e.message ? e.message : e}`;
  }
  const ids = itemsOf(scoped, "open").map((item) => item.finding_id);
  if (ids.length === 0) return "the scoped response serves no open finding of B-01";
  const foreign = ids.filter((id) => !String(id).startsWith("B01-"));
  if (foreign.length) return `the B-01 scope serves ${foreign.length} finding(s) of another subsystem`;
  const census = sectionOf(scoped, "open")?.census ?? 0;
  const unscoped = sectionOf(attention, "open")?.census ?? 0;
  if (census >= unscoped) return `the scoped census (${census}) is not smaller than the unscoped one (${unscoped})`;
  let prefixed = null;
  try {
    prefixed = call("get_attention", { scope: "lib/" });
  } catch (e) {
    return `get_attention(path prefix) did not answer — ${e && e.message ? e.message : e}`;
  }
  if (prefixed?.scope?.kind !== "path-prefix") return `a path prefix resolved as ${JSON.stringify(prefixed?.scope?.kind)}`;
  const prefixIds = itemsOf(prefixed, "open").map((item) => String(item.finding_id));
  const strays = prefixIds.filter((id) => !id.startsWith("B02-"));
  return strays.length ? `the lib/ prefix serves ${strays.length} finding(s) from outside it` : null;
});

// ---------------------------------------------------------------------------
// 7. Custody (C55, C63)
// ---------------------------------------------------------------------------
emit("");
emit("custody");

await check("both tools are advertised read-only and generate no text", () => {
  if (fixtureError) return fixtureError;
  for (const name of ["get_attention", "get_history"]) {
    const tool = toolNamed(name);
    if (!tool) return `${name} is not registered in locusTools`;
    if (tool.compact !== true) return `${name} does not declare the compact serialization §4.1 requires`;
    const schema = tool.inputSchema ?? {};
    if (schema.additionalProperties !== false) return `${name}'s input schema admits extra properties`;
  }
  const source = readText(join(MCP, "src", "index.ts"));
  if (source === null) return "src/index.ts is absent";
  return /name\.startsWith\("get_"\)/.test(source)
    ? null
    : "index.ts no longer derives readOnlyHint from the get_ prefix, so the two tools are unannotated";
});

await check("both tools appear in the generated tool inventory", () => {
  const inventory = readText(join(REPO, INVENTORY_REL));
  if (inventory === null) return `${INVENTORY_REL} is absent`;
  for (const name of ["get_attention", "get_history"]) {
    if (!inventory.includes(name)) return `${name} is not in the generated inventory`;
  }
  return null;
});

await check("the packet's gate runs in CI", () => {
  const ci = readText(join(REPO, CI_REL));
  if (ci === null) return `${CI_REL} is absent`;
  return ci.includes("node test-attention-history.mjs") ? null : "the gate is not run in CI";
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
    `GATE P14 RED: get_attention and get_history do not label, reconcile, or bound what §5.2 and §5.3 require — ${failures.length} assertion(s) failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("");
emit("GATE P14 GREEN");
