#!/usr/bin/env node
// Gate for reader-lenses packet P11 — structure from claims, with a labelled
// narrative fallback (spec.md §3.1, §3.4, §7.3, §9.1; claims C42, C44, C55,
// C63).
//
// Turns red when:
//   - `add_claim`'s input schema stops constraining `subject_type` to the
//     `claim_subject_type` enum the vocabulary contract owns, or the handler
//     accepts a value outside it;
//   - a `<sid>/key-type/`, `<sid>/state-container/` or `<sid>/flow/` claim is
//     accepted although every attached evidence row's kind is outside
//     {code-verified, contract-stated}, or although no attached row of one of
//     those kinds cites the file named in `subject_id`;
//   - the refusal is a bare rejection that does not name the kinds it found;
//   - a `<sid>/concurrency` or `<sid>/seam/` claim is refused for carrying the
//     weaker evidence §9.1 licenses it to carry, or a structural claim that
//     does satisfy the rule is refused;
//   - `describe_locus`'s structure section does not serve a subsystem's current
//     claims, or serves a claim whose validity interval `apply_change_impact`
//     closed, or drops that claim from a historical reading at the base commit;
//   - a subsystem with zero claims does not carry §9.1's literal
//     "Structural inventory not recorded as claims", or carries a narrative
//     that is not labelled `revision_bound: false`, omits the artifact's
//     `content_hash`, or is attached beside claims;
//   - the structure section of a `scoped-unread` locus carries an item, a
//     narrative, or the zero-claims sentence, when a claim cites that file and
//     its subsystem carries claims;
//   - the subsystem page renders a closed claim, drops a current one, loses the
//     grouping by claim kind, or renders the zero-claims heading without the
//     artifact's content hash and revision;
//   - the response no longer validates against the locus-account contract;
//   - the gate does not run in CI.
//
// False greens it cannot exclude. The narrative's *prose* is asserted on the
// page and only by pointer in the tool, so a tool that served the whole
// artifact body would pass here and fail P7's byte budget instead — the two
// gates are deliberately not duplicated. The claim-kind grouping is asserted
// over the five kinds §9.1's table names; a sixth kind added later would fall
// into the "other" group without this gate noticing, because the group map is
// read from this file's own constants rather than from the implementation, and
// only the five that exist are seeded. It says nothing about whether Phase 2
// actually writes these claims (P12's subject) or about claim truth, which is
// the adversarial pass's obligation and not a property of any renderer. And the
// `apply_change_impact` arm proves that a *closed* claim disappears; it cannot
// prove that a claim closed by some other writer would, because closure is
// observed through one writer only.
//
// Output protocol: exactly one status line, last, on stdout. Every subprocess
// is captured and never echoed, and every message is scrubbed, so a missing
// deliverable reports as an assertion failure rather than as a crash.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const MCP = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(MCP, "..");
const PY = process.env.AMANUENSIS_PYTHON ?? "python3";

const CONTRACT_REL = "mcp-server/contracts/locus-account.schema.json";
const VOCABULARY_REL = "mcp-server/contracts/conspectus-vocabulary.json";
const RENDERERS_REL = "materializer/amanuensis_materializer/renderers.py";
const CI_REL = ".github/workflows/test.yml";

// §9.1's literal, and §3.4's label. Written out here rather than imported so
// that rewording the implementation cannot also reword what this gate expects.
const NO_CLAIMS_SENTENCE = "Structural inventory not recorded as claims";
const NARRATIVE_LABEL = "Narrative from the survey artifact; not individually bound to a revision";

// §9.1's five structural categories, as the `claim_key` segment that names each
// and the heading the subsystem page groups it under.
const CLAIM_KIND_HEADINGS = [
  ["key-type", "Key types"],
  ["state-container", "State containers"],
  ["flow", "Flow steps"],
  ["concurrency", "Concurrency invariants"],
  ["seam", "Seam contracts"],
];

// §9.1's two accepted evidence kinds for the three file-anchored categories.
const STRUCTURAL_EVIDENCE_KINDS = ["code-verified", "contract-stated"];

// §3.1's eight sections. Every call below asks for all of them: §4.1's default
// budget is measured on the doubled envelope, so a default call on this fixture
// serves at most one or two items and an item-level assertion on it would be
// about P7's truncation rather than about this packet's selection.
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
  [/SyntaxError/g, "parse-failure"],
  [/syntax error/gi, "malformed statement"],
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
// Deliverables, loaded defensively. `dist/` is a build artifact, so compile
// first and let a compile failure poison the fixture rather than certify bytes
// that are not under review (slice-S2, F1–F3/codex).
// ---------------------------------------------------------------------------
const built = ensureBuilt();

let mods = null;
let loadError = null;
try {
  const [db, project, locus, claims, evidence, impact, projectTools] = await Promise.all([
    import("./dist/db.js"),
    import("./dist/project.js"),
    import("./dist/tools/locus.js"),
    import("./dist/tools/claims.js"),
    import("./dist/tools/evidence.js"),
    import("./dist/tools/impact.js"),
    import("./dist/tools/project.js"),
  ]);
  mods = { db, project, locus, claims, evidence, impact, projectTools };
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
if (contract && Ajv2020) {
  try {
    validateAccount = new Ajv2020({ strict: true }).compile(contract);
  } catch {
    validateAccount = null;
  }
}

function toolNamed(name) {
  const groups = [
    mods?.locus?.locusTools,
    mods?.claims?.claimTools,
    mods?.evidence?.evidenceTools,
    mods?.impact?.impactTools,
    mods?.projectTools?.projectTools,
  ];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    const found = group.find((tool) => tool?.name === name);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fixture. One workspace, three commits; a store whose claims are written
// through `add_claim` so the substrate checks are exercised on the way in.
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
    ? `the locus and claim tools could not be loaded — ${loadError}`
    : null;

function call(name, args, ctx) {
  const tool = toolNamed(name);
  if (!tool) throw new Error(`${name} is not exported by the built tools`);
  return tool.handler(args, ctx);
}

function refusal(name, args, ctx) {
  try {
    call(name, args, ctx);
    return null;
  } catch (e) {
    return e && e.message ? String(e.message) : String(e);
  }
}

function buildFixture() {
  const root = tempRoot("amanuensis-structural-claims-");
  const workspace = join(root, "workspace");
  const storageRoot = join(root, "storage-root");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  git(workspace, "init", "-q", "-b", "main");
  git(workspace, "config", "user.email", "test@localhost");
  git(workspace, "config", "user.name", "Structural Claims Test");
  git(workspace, "config", "commit.gpgsign", "false");

  const write = (rel, body) => writeFileSync(join(workspace, rel), body);
  write("src/ledger.ts", "export const row = 1;\n");
  write("src/candidate.ts", "export const parsed = 1;\n");
  write("src/other.ts", "export const other = 1;\n");
  // No ledger row anywhere names this file, so evidence citing it reaches no
  // subsystem through §3.1's evidence arm.
  write("src/external.ts", "export const external = 1;\n");
  git(workspace, "add", "src");
  git(workspace, "commit", "-q", "--no-verify", "-m", "base");
  const base = git(workspace, "rev-parse", "HEAD");

  write("src/ledger.ts", "export const row = 2;\n");
  git(workspace, "add", "src/ledger.ts");
  git(workspace, "commit", "-q", "--no-verify", "-m", "head");
  const head = git(workspace, "rev-parse", "HEAD");

  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
  const project = mods.project.resolveProject(workspace, {
    selectionSource: "test-structural-claims",
    serverVersion: "test",
  });
  mods.project.ensureProjectStorage(project, (dbPath) => mods.db.openDatabase(dbPath).close());
  const db = mods.db.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  const session = call("start_session", { intent: "structural-claims-gate" }, ctx);
  ctx.sessionId = session.session_id;

  const subsystem = db.prepare(
    "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  subsystem.run("B-01", "Ledger", "structural", "core", "src/ledger.ts", null, null);
  subsystem.run("B-02", "Index", "structural", "core", "src/index.ts", null, null);
  subsystem.run("B-03", "Archive", "scoping", "core", "src/archive.ts", null, null);

  const ledger = db.prepare(
    `INSERT INTO file_ledger
       (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at, stale, stale_reason)
     VALUES (?, ?, 'structural fixture', ?, ?, ?, 0, NULL)`,
  );
  ledger.run("B-01", "src/ledger.ts", "examined", head, "2026-09-01 12:00:00");
  ledger.run("B-01", "src/other.ts", "examined", head, "2026-09-01 12:00:00");
  // §2.3: a `candidate` row authorizes no claim about content. A claim cites
  // this file all the same, so the withholding has something to withhold.
  ledger.run("B-01", "src/candidate.ts", "candidate", null, null);

  db.prepare(
    `INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b)
     VALUES ('S-01', 'the ledger row', 'table', 'B-01', 'B-02')`,
  ).run();

  // B-02 carries a survey artifact and no claim: the narrative fallback's
  // subject. B-03 carries neither, so the fallback has to say that too.
  const narrativePath = "B-02-index.md";
  const narrativeBody =
    "# B-02 — Index\n\nThe index keeps one row per key, rebuilt from the ledger.\n";
  writeFileSync(join(project.storagePath, narrativePath), narrativeBody);
  db.prepare(
    `INSERT INTO artifacts (path, kind, subsystem_id, content_hash, ref_sha, session_id, bytes)
     VALUES (?, 'subsystem-survey', 'B-02', ?, ?, ?, ?)`,
  ).run(
    narrativePath,
    createHash("sha256").update(narrativeBody).digest("hex"),
    head,
    ctx.sessionId,
    Buffer.byteLength(narrativeBody),
  );

  const evidenceId = (path, kind, symbol, sha) =>
    call(
      "add_evidence",
      { file_path: path, symbol, ref_sha: sha ?? head, kind, note: "structural fixture" },
      ctx,
    ).id;

  const ev = {
    ledgerCode: evidenceId("src/ledger.ts", "code-verified", "Row", base),
    ledgerContract: evidenceId("src/ledger.ts", "contract-stated", "writeRow", base),
    ledgerNamed: evidenceId("src/ledger.ts", "name-inferred", "Cache", base),
    otherCode: evidenceId("src/other.ts", "code-verified", "Cache", base),
    otherNamed: evidenceId("src/other.ts", "name-inferred", "lock", base),
    externalDoc: evidenceId("src/external.ts", "doc-asserted", "contract", base),
    candidateCode: evidenceId("src/candidate.ts", "code-verified", "parseRow", base),
  };

  const addClaim = (overrides) =>
    call(
      "add_claim",
      {
        epistemic_kind: "observation",
        ref_sha: base,
        ...overrides,
      },
      ctx,
    );

  return {
    root,
    workspace,
    storageRoot,
    project,
    db,
    ctx,
    base,
    head,
    ev,
    addClaim,
    call: (name, args) => call(name, args, ctx),
    refuse: (name, args) => refusal(name, args, ctx),
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
  return fixture ? null : (fixtureError ?? "the fixture is absent");
}

// ---------------------------------------------------------------------------
// §9.1: `add_claim`'s two subtractive checks
// ---------------------------------------------------------------------------

check("add_claim's schema constrains subject_type to the vocabulary contract's enum", () => {
  if (vocabulary === null) return `${VOCABULARY_REL} is absent`;
  const source = (vocabulary.enums?.claim_subject_type?.values ?? []).map((v) => v.value);
  if (source.length === 0) return "the vocabulary contract carries no claim_subject_type values";
  const tool = toolNamed("add_claim");
  if (!tool) return "add_claim is not exported by the built tools";
  const declared = tool.inputSchema?.properties?.subject_type?.enum;
  if (!Array.isArray(declared)) return "subject_type carries no enum in the input schema";
  const missing = source.filter((value) => !declared.includes(value));
  const extra = declared.filter((value) => !source.includes(value));
  if (missing.length) return `the subject_type enum omits ${missing.join(", ")}`;
  if (extra.length) return `the subject_type enum admits ${extra.join(", ")}`;
  return null;
});

check("add_claim refuses a subject_type outside {symbol, subsystem, seam}", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const message = fixture.refuse("add_claim", {
    claim_id: "reject-subject-type",
    claim_key: "B-01/key-type/file-subject",
    subject_type: "file",
    subject_id: "src/ledger.ts",
    statement: "a file is not a claim subject.",
    epistemic_kind: "observation",
    ref_sha: fixture.base,
    evidence_ids: [fixture.ev.ledgerCode],
  });
  if (message === null) return "a subject_type of `file` was accepted";
  if (!/subject_type/.test(message)) return `the refusal does not name subject_type — ${message}`;
  const row = fixture.db
    .prepare("SELECT claim_id FROM claims WHERE claim_id = 'reject-subject-type'")
    .get();
  return row ? "the refused claim was written anyway" : null;
});

check("add_claim accepts each of the three subject types the enum names", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const accepted = [
    {
      claim_id: "b01-key-type-row",
      claim_key: "B-01/key-type/row",
      subject_type: "symbol",
      subject_id: "src/ledger.ts:Row",
      statement: "Row is the ledger's unit of storage.",
      evidence_ids: [fixture.ev.ledgerCode],
    },
    {
      claim_id: "b01-concurrency",
      claim_key: "B-01/concurrency",
      subject_type: "subsystem",
      subject_id: "B-01",
      statement: "No two writers hold the ledger lock at once.",
      epistemic_kind: "inference",
      // §9.1: the weaker requirement, deliberately — a derived invariant that
      // cites neither the subject's file nor a code-verified row.
      evidence_ids: [fixture.ev.otherNamed],
    },
    {
      claim_id: "b01-seam-s01",
      claim_key: "B-01/seam/S-01",
      subject_type: "seam",
      subject_id: "S-01",
      statement: "The ledger row crosses to B-02 without a version tag.",
      // Neither §3.1 arm reaches this claim: its subject is the seam, not the
      // subsystem, and its evidence cites a file no ledger row names. Only
      // §9.1's `<sid>/` namespace selects it, on either surface.
      evidence_ids: [fixture.ev.externalDoc],
    },
  ];
  for (const claim of accepted) {
    try {
      fixture.addClaim(claim);
    } catch (e) {
      return `${claim.claim_key} was refused — ${e && e.message ? e.message : e}`;
    }
  }
  const count = fixture.db
    .prepare("SELECT COUNT(*) AS n FROM claims WHERE claim_id IN ('b01-key-type-row','b01-concurrency','b01-seam-s01')")
    .get();
  return count?.n === 3 ? null : `only ${count?.n ?? 0} of the three claims were written`;
});

check("a structural claim whose evidence kinds are all outside the two is refused", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const message = fixture.refuse("add_claim", {
    claim_id: "reject-weak-kind",
    claim_key: "B-01/state-container/weak",
    subject_type: "symbol",
    subject_id: "src/ledger.ts:Cache",
    statement: "Cache holds the pending rows.",
    epistemic_kind: "observation",
    ref_sha: fixture.base,
    // The right file, the wrong kind.
    evidence_ids: [fixture.ev.ledgerNamed],
  });
  if (message === null) return "a state-container claim backed only by name-inferred evidence was accepted";
  if (!message.includes("name-inferred")) {
    return `the refusal does not name the kinds it found — ${message}`;
  }
  for (const kind of STRUCTURAL_EVIDENCE_KINDS) {
    if (!message.includes(kind)) return `the refusal does not name ${kind} as what it requires`;
  }
  const row = fixture.db.prepare("SELECT claim_id FROM claims WHERE claim_id = 'reject-weak-kind'").get();
  return row ? "the refused claim was written anyway" : null;
});

check("a structural claim whose evidence cites another file is refused", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const message = fixture.refuse("add_claim", {
    claim_id: "reject-wrong-file",
    claim_key: "B-01/state-container/elsewhere",
    subject_type: "symbol",
    subject_id: "src/ledger.ts:Cache",
    statement: "Cache holds the pending rows.",
    epistemic_kind: "observation",
    ref_sha: fixture.base,
    // The right kind, the wrong file.
    evidence_ids: [fixture.ev.otherCode],
  });
  if (message === null) return "a state-container claim whose only strong evidence cites src/other.ts was accepted";
  if (!message.includes("src/ledger.ts")) {
    return `the refusal does not name the file subject_id points at — ${message}`;
  }
  const row = fixture.db.prepare("SELECT claim_id FROM claims WHERE claim_id = 'reject-wrong-file'").get();
  return row ? "the refused claim was written anyway" : null;
});

check("a structural claim that satisfies both halves on one row is accepted", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  try {
    fixture.addClaim({
      claim_id: "b01-state-container-cache",
      claim_key: "B-01/state-container/cache",
      subject_type: "symbol",
      subject_id: "src/ledger.ts:Cache",
      statement: "Cache holds the pending rows until the writer drains it.",
      // One row that is both strong enough and on the right file, beside two
      // that are each only half of the rule.
      evidence_ids: [fixture.ev.otherCode, fixture.ev.ledgerNamed, fixture.ev.ledgerCode],
    });
    fixture.addClaim({
      claim_id: "b01-flow-write-01",
      claim_key: "B-01/flow/write/01",
      subject_type: "symbol",
      subject_id: "src/ledger.ts:writeRow",
      statement: "writeRow appends the row before it releases the lock.",
      evidence_ids: [fixture.ev.ledgerContract],
    });
    // A claim about a file whose ledger row is `candidate`. The subsystem
    // carries it; the file locus may not serve it (§2.3).
    fixture.addClaim({
      claim_id: "b01-flow-read-01",
      claim_key: "B-01/flow/read/01",
      subject_type: "symbol",
      subject_id: "src/candidate.ts:parseRow",
      statement: "parseRow decodes the row before the reader sees it.",
      evidence_ids: [fixture.ev.candidateCode],
    });
  } catch (e) {
    return `an accepted case was refused — ${e && e.message ? e.message : e}`;
  }
  return null;
});

check("the rule reads one row at a time, not the union of two half-satisfying rows", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const message = fixture.refuse("add_claim", {
    claim_id: "reject-split-halves",
    claim_key: "B-01/key-type/split",
    subject_type: "symbol",
    subject_id: "src/ledger.ts:Split",
    statement: "Split is a key type.",
    epistemic_kind: "observation",
    ref_sha: fixture.base,
    // Strong kind on the wrong file, plus the right file at a weak kind.
    evidence_ids: [fixture.ev.otherCode, fixture.ev.ledgerNamed],
  });
  if (message === null) {
    return "two rows that each satisfy half the rule were read as satisfying it together";
  }
  const row = fixture.db.prepare("SELECT claim_id FROM claims WHERE claim_id = 'reject-split-halves'").get();
  return row ? "the refused claim was written anyway" : null;
});

// ---------------------------------------------------------------------------
// §3.1, §3.4: the structure section
// ---------------------------------------------------------------------------

function describeLocus(args) {
  return call("describe_locus", args, fixture.ctx);
}

function structureOf(args) {
  const payload = describeLocus(args);
  return { payload, section: payload?.sections?.structure ?? null };
}

check("the structure section serves a subsystem's current claims", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const { section } = structureOf({ locus: "B-01", sections: SECTIONS });
  if (!section) return "the response carries no structure section";
  const keys = (section.items ?? []).map((item) => item.claim_key).sort();
  const expected = [
    "B-01/concurrency",
    "B-01/flow/read/01",
    "B-01/flow/write/01",
    "B-01/key-type/row",
    "B-01/seam/S-01",
    "B-01/state-container/cache",
  ];
  const missing = expected.filter((key) => !keys.includes(key));
  if (missing.length) return `the section does not serve ${missing.join(", ")}`;
  if (section.census !== expected.length) {
    return `the census is ${section.census}, not ${expected.length}`;
  }
  const unbound = (section.items ?? []).filter((item) => item.revision_bound !== true);
  if (unbound.length) return `${unbound.length} served claim(s) are not revision-bound`;
  const unstated = (section.items ?? []).filter(
    (item) => typeof item.statement !== "string" || item.statement.length === 0,
  );
  if (unstated.length) return `${unstated.length} served claim(s) carry no statement`;
  // Each of the three arms carries at least one claim no other arm reaches, so
  // dropping any one of them turns this assertion red rather than leaving the
  // other two to cover for it.
  return null;
});

check("a subsystem carrying claims carries neither the zero-claims sentence nor a narrative", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const { section } = structureOf({ locus: "B-01", sections: SECTIONS });
  if (!section) return "the response carries no structure section";
  if (section.narrative !== undefined) return "a narrative is attached beside recorded claims";
  return String(section.statement ?? "").includes(NO_CLAIMS_SENTENCE)
    ? "the zero-claims sentence is served for a subsystem that has claims"
    : null;
});

check("a subsystem with zero claims carries §9.1's literal and the labelled narrative", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const { section } = structureOf({ locus: "B-02", sections: SECTIONS });
  if (!section) return "the response carries no structure section";
  if ((section.items ?? []).length !== 0) return "the section is not empty for a subsystem with no claims";
  if (String(section.statement ?? "") !== NO_CLAIMS_SENTENCE) {
    return `the statement is ${JSON.stringify(section.statement ?? null)}, not the literal §9.1 fixes`;
  }
  const narrative = section.narrative;
  if (!narrative) return "no narrative is attached although a subsystem-survey artifact is recorded";
  if (narrative.revision_bound !== false) return "the narrative is not marked revision_bound: false";
  if (narrative.label !== NARRATIVE_LABEL) {
    return `the narrative label is ${JSON.stringify(narrative.label ?? null)}`;
  }
  if (narrative.artifact_path !== "B-02-index.md") {
    return `the narrative points at ${JSON.stringify(narrative.artifact_path ?? null)}`;
  }
  const stored = fixture.db
    .prepare("SELECT content_hash FROM artifacts WHERE path = 'B-02-index.md'")
    .get();
  if (!stored?.content_hash) return "the fixture artifact carries no content_hash";
  return narrative.content_hash === stored.content_hash
    ? null
    : `the narrative's content_hash is ${JSON.stringify(narrative.content_hash ?? null)}, not the artifact's`;
});

check("a subsystem with zero claims and no artifact carries the literal and no narrative", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const { section } = structureOf({ locus: "B-03", sections: SECTIONS });
  if (!section) return "the response carries no structure section";
  if (String(section.statement ?? "") !== NO_CLAIMS_SENTENCE) {
    return `the statement is ${JSON.stringify(section.statement ?? null)}, not the literal §9.1 fixes`;
  }
  return section.narrative === undefined
    ? null
    : "a narrative is attached although no subsystem-survey artifact is recorded";
});

check("the structure section is empty for a scoped-unread locus regardless of subsystem claims", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const { section } = structureOf({ locus: "src/candidate.ts", sections: SECTIONS });
  if (!section) return "the response carries no structure section";
  if ((section.items ?? []).length !== 0) {
    return `${section.items.length} claim(s) are served at a candidate row`;
  }
  if (section.authorized !== false) return "the section does not declare the withholding";
  if ((section.withheld_unauthorized ?? 0) < 1) {
    return "nothing is reported as withheld, so the fixture proves nothing";
  }
  if (section.narrative !== undefined) return "a narrative is attached at an unauthorized locus";
  return String(section.statement ?? "").includes(NO_CLAIMS_SENTENCE)
    ? "the zero-claims sentence is served where the claims are withheld, not absent"
    : null;
});

check("the account validates against the locus-account contract with the narrative attached", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  if (contract === null) return `${CONTRACT_REL} is absent`;
  if (validateAccount === null) return "the contract could not be compiled by the bundled validator";
  for (const locus of ["B-01", "B-02", "B-03", "src/candidate.ts"]) {
    const payload = describeLocus({ locus, sections: SECTIONS });
    if (!validateAccount(payload)) {
      const first = validateAccount.errors?.[0];
      return `${locus} does not validate — ${first?.instancePath ?? ""} ${first?.message ?? "unknown"}`;
    }
  }
  return null;
});

// ---------------------------------------------------------------------------
// §7.3: the subsystem page
// ---------------------------------------------------------------------------

const RENDER_DRIVER = `
import json, sqlite3, sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from amanuensis_materializer.db import rows
from amanuensis_materializer.renderers import render_subsystem

conn = sqlite3.connect(f"file:{sys.argv[2]}?mode=ro", uri=True)
storage = Path(sys.argv[3])
out = {}
for s in rows(conn, "SELECT id, name, status, layer, scope, jump_in_reading, notes FROM subsystems ORDER BY id"):
    text, sources = render_subsystem(conn, storage, s)
    out[s["id"]] = {"text": text, "sources": sorted(sources)}
sys.stdout.write(json.dumps(out))
`;

function renderPages() {
  const driver = join(fixture.root, "render-subsystem.py");
  writeFileSync(driver, RENDER_DRIVER);
  const result = spawnSync(
    PY,
    [driver, join(REPO, "materializer"), fixture.project.dbPath, fixture.project.storagePath],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    return { error: scrub(String(result.stderr ?? "")).trim().split("\n").slice(-3).join(" / ") };
  }
  try {
    return { pages: JSON.parse(String(result.stdout ?? "")) };
  } catch {
    return { error: "the renderer produced no readable page" };
  }
}

// The store is written to between renders — `apply_change_impact` closes a
// claim below — so a render is memoized per named point in that history rather
// than once for the run. A single memo would have shown the post-impact page to
// a check written about the page before it.
const rendered = new Map();
function pages(at) {
  if (!rendered.has(at)) rendered.set(at, renderPages());
  return rendered.get(at);
}

function structureSection(text) {
  const match = String(text ?? "").match(/\n## Structure\n([\s\S]*?)(?=\n## |\s*$)/);
  return match ? match[1] : null;
}

check("the subsystem page renders current claims, grouped by claim kind", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const { pages: all, error } = pages("before-impact");
  if (error) return `the subsystem page could not be rendered — ${error}`;
  const section = structureSection(all?.["B-01"]?.text);
  if (section === null) return "B-01's page carries no Structure section";
  if (section.includes(NO_CLAIMS_SENTENCE)) {
    return "the page renders the zero-claims heading for a subsystem that has claims";
  }
  const wanted = [
    ["state-container", "Cache holds the pending rows until the writer drains it."],
    ["flow", "writeRow appends the row before it releases the lock."],
    ["concurrency", "No two writers hold the ledger lock at once."],
    ["seam", "The ledger row crosses to B-02 without a version tag."],
  ];
  for (const [kind, statement] of wanted) {
    if (!section.includes(statement)) return `the page does not render the ${kind} claim's statement`;
  }
  const headings = CLAIM_KIND_HEADINGS.filter(([kind]) => kind !== "key-type").map(([, h]) => h);
  const absent = headings.filter((heading) => !section.includes(heading));
  if (absent.length) return `the page does not group the claims under ${absent.join(", ")}`;
  return null;
});

check("a subsystem with zero claims renders the literal and the labelled narrative", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const { pages: all, error } = pages("before-impact");
  if (error) return `the subsystem page could not be rendered — ${error}`;
  const section = structureSection(all?.["B-02"]?.text);
  if (section === null) return "B-02's page carries no Structure section";
  if (!section.includes(NO_CLAIMS_SENTENCE)) return "the page does not carry §9.1's literal";
  if (!section.includes("The index keeps one row per key, rebuilt from the ledger.")) {
    return "the page does not render the survey artifact's narrative under the fallback";
  }
  const stored = fixture.db
    .prepare("SELECT content_hash, ref_sha FROM artifacts WHERE path = 'B-02-index.md'")
    .get();
  if (!section.includes(String(stored?.content_hash ?? "").slice(0, 12))) {
    return "the fallback does not carry the artifact's content hash";
  }
  if (!section.includes(String(stored?.ref_sha ?? "").slice(0, 7))) {
    return "the fallback does not carry the artifact's recorded revision";
  }
  return /not .*bound to a revision|not individually bound/.test(section)
    ? null
    : "the narrative is not labelled as unbound to a revision";
});

check("a subsystem with neither claims nor an artifact says so", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const { pages: all, error } = pages("before-impact");
  if (error) return `the subsystem page could not be rendered — ${error}`;
  const section = structureSection(all?.["B-03"]?.text);
  if (section === null) return "B-03's page carries no Structure section";
  if (!section.includes(NO_CLAIMS_SENTENCE)) return "the page does not carry §9.1's literal";
  return /no narrative/i.test(section)
    ? null
    : "the page does not say that no narrative was left in the claims' place";
});

check("the tool and the page select the same current claims for a subsystem", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const { pages: all, error } = pages("before-impact");
  if (error) return `the subsystem page could not be rendered — ${error}`;
  const section = structureSection(all?.["B-01"]?.text);
  if (section === null) return "B-01's page carries no Structure section";
  const served = ((structureOf({ locus: "B-01", sections: SECTIONS }).section?.items) ?? []).map(
    (item) => item.claim_key,
  );
  if (served.length === 0) return "the tool serves no claim, so the comparison is vacuous";
  const absent = served.filter((key) => !section.includes(key));
  if (absent.length) return `the page does not carry ${absent.join(", ")}, which the tool serves`;
  // The other direction: every `B-01/` claim key the page names must be one the
  // tool serves, so the two surfaces cannot drift apart in either direction.
  const onPage = [...section.matchAll(/B-01\/[A-Za-z0-9/_.-]+/g)].map((m) => m[0]);
  const extra = [...new Set(onPage)].filter((key) => !served.includes(key));
  return extra.length ? `the page carries ${extra.join(", ")}, which the tool does not serve` : null;
});

check("the page's claims are under read-back custody", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const { pages: all, error } = pages("before-impact");
  if (error) return `the subsystem page could not be rendered — ${error}`;
  const sources = all?.["B-01"]?.sources ?? [];
  return sources.some((name) => /claim/.test(name))
    ? null
    : "no claims source is recorded for the page, so a changed claim would not re-render it";
});

// ---------------------------------------------------------------------------
// C42's closing arm: a claim closed by apply_change_impact
// ---------------------------------------------------------------------------

check("apply_change_impact closes a claim and the structure section stops serving it", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const before = structureOf({ locus: "B-01", sections: SECTIONS }).section;
  if (!(before?.items ?? []).some((item) => item.claim_key === "B-01/key-type/row")) {
    return "the claim to be closed is not served before the run, so closing it proves nothing";
  }
  let run;
  try {
    run = fixture.call("predict_change_impact", {
      base_sha: fixture.base,
      head_sha: fixture.head,
      run_id: "p11-impact",
    });
  } catch (e) {
    return `the prediction failed — ${e && e.message ? e.message : e}`;
  }
  const predicted = (run?.invalidated_claims ?? []).map((claim) => claim.object_id);
  if (!predicted.includes("b01-key-type-row")) {
    return `the prediction does not reach the claim — it reached ${predicted.join(", ") || "nothing"}`;
  }
  try {
    fixture.call("apply_change_impact", { run_id: "p11-impact", reason: "the row changed" });
  } catch (e) {
    return `the application failed — ${e && e.message ? e.message : e}`;
  }
  const closed = fixture.db
    .prepare("SELECT valid_until_sha FROM claims WHERE claim_id = 'b01-key-type-row'")
    .get();
  if (!closed?.valid_until_sha) return "the claim was not closed by the application";
  const after = structureOf({ locus: "B-01", sections: SECTIONS }).section;
  const keys = (after?.items ?? []).map((item) => item.claim_key);
  if (keys.includes("B-01/key-type/row")) return "a closed claim is still served as current";
  const historical = structureOf({
    locus: "B-01",
    sections: SECTIONS,
    as_of_sha: fixture.base,
  }).section;
  const historicalKeys = (historical?.items ?? []).map((item) => item.claim_key);
  return historicalKeys.includes("B-01/key-type/row")
    ? null
    : "the closed claim vanished from a historical reading at the commit it was current at";
});

check("the subsystem page drops the claim apply_change_impact closed", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const before = pages("before-impact");
  if (before.error) return `the subsystem page could not be rendered — ${before.error}`;
  const wasThere = structureSection(before.pages?.["B-01"]?.text) ?? "";
  if (!wasThere.includes("Row is the ledger's unit of storage.")) {
    return "the page did not carry the claim before it was closed, so closing it proves nothing";
  }
  const after = pages("after-impact");
  if (after.error) return `the subsystem page could not be re-rendered — ${after.error}`;
  const section = structureSection(after.pages?.["B-01"]?.text);
  if (section === null) return "B-01's page carries no Structure section";
  if (section.includes("Row is the ledger's unit of storage.")) {
    return "a claim closed by apply_change_impact is still rendered as current";
  }
  return section.includes("Key types")
    ? "the closed claim's group is still rendered, so the page reads a superseded claim as current"
    : null;
});

// ---------------------------------------------------------------------------
// The deliverables this packet is recorded against, and CI
// ---------------------------------------------------------------------------

check("the renderer reads claims rather than deciding the fallback from prose alone", () => {
  const source = readText(join(REPO, RENDERERS_REL));
  if (source === null) return `${RENDERERS_REL} is absent`;
  return /FROM claims/.test(source)
    ? null
    : "renderers.py never reads the claims table, so the Structure section cannot be claim-backed";
});

check("this gate runs in CI", () => {
  const ci = readText(join(REPO, CI_REL));
  if (ci === null) return `${CI_REL} is absent`;
  return ci.includes("node test-structural-claims.mjs") ? null : "the gate is not run in CI";
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
    `GATE P11 RED: the structure section's claims, its labelled narrative, and add_claim's structural checks do not hold — ${failures.length} assertion(s) failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("");
emit("GATE P11 GREEN");
