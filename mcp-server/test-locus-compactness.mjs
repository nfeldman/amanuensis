#!/usr/bin/env node
// Gate for reader-lenses packet P7 — response budgets and the omission ledger
// (spec.md §4.1–§4.4, §5.1; claims C14, C18, C19, C20, C55, C63).
//
// Turns red when:
//   - `jsonResult` has no compact option, or the compact path drops
//     `structuredContent`, the `isError` signal, or the default pretty text
//     block every other tool already emits;
//   - `describe_locus` does not declare the compact path, another tool does,
//     or the live server emits a pretty text block for `describe_locus` or a
//     compact one for a tool that is not a locus tool;
//   - the whole wire response — compact text block plus the duplicated
//     `structuredContent` — exceeds 8192 bytes on the pathological fixture,
//     or the standing block exceeds 3072, or a requested optional section
//     exceeds 4096, or an every-section request exceeds the 32768 ceiling;
//   - the census the same fixture holds would fit inside the budget without
//     truncation, which would leave assertion 1 green by triviality (VP4);
//   - `trace.response_bytes` or `trace.payload_bytes` disagrees with a
//     measurement taken outside the tool, so a response could report a size it
//     does not have;
//   - a section does not reconcile `selected + omitted == census` against
//     `omitted[].count`, an omitted id repeats, or an omitted id names
//     something the census does not hold;
//   - an omission carries a reason other than `policy` or `budget`, or a
//     section with census 0 reports `recorded: true` or contributes an
//     omission row;
//   - the aggregated ledger's `ids` exceed the 1024-byte per-entry sub-budget,
//     or a truncated id list does not set `ids_truncated`, or a `count` is not
//     exact on a 150-item census;
//   - `owners[]` loses an owner under budget pressure, or a response that
//     cannot reach its budget after every truncatable item is gone fails to
//     declare it;
//   - the truncation order is not the declared code constant: a terminal
//     defect is served while a non-terminal one is dropped, or a claim with
//     weaker evidence is served while a stronger one is dropped;
//   - the gate does not run in CI.
//
// False greens it cannot exclude. The budget *numbers* are this file's own
// constants read against §4.1's table; a consistent change to both the spec
// table and the implementation would pass, which is what §13's static
// assertion is for. It measures three fixtures, so it cannot exclude a
// truncation order that is right for these sections and wrong for a section no
// fixture here fills — `reviews` and `history_pointer` are exercised only for
// their policy omissions. It cannot exclude a wire measurement that is right
// in-process and wrong under a host that re-serializes the envelope, though
// the live-server check narrows that to hosts which rewrite the text block.
// And it says nothing about whether 8192 is the right budget: that is decision
// 5's, not this gate's.
//
// Output protocol: exactly one status line, last, on stdout. Every subprocess
// is captured and never echoed, and every message is scrubbed, so a missing
// deliverable reports as an assertion failure rather than as a crash.
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MCP = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(MCP, "..");

const CONTRACT_REL = "mcp-server/contracts/locus-account.schema.json";
const CI_REL = ".github/workflows/test.yml";

// §4.1's table, written out rather than read from the implementation so that
// changing a budget in the code cannot also change what this gate expects.
const WIRE_BUDGET = 8192;
const STANDING_BUDGET = 3072;
const OPTIONAL_SECTION_BUDGET = 4096;
const WIRE_CEILING = 32768;
// §4.3's per-entry id sub-budget.
const OMITTED_IDS_BUDGET = 1024;
// §4.2: the five sections on by default; `unknown` and standing are also on.
const DEFAULT_SECTIONS = ["purpose", "structure", "defects", "boundaries", "terms"];
const OPT_IN_SECTIONS = ["reviews", "leads", "history_pointer"];
const SECTIONS = [...DEFAULT_SECTIONS, ...OPT_IN_SECTIONS].sort();
// §4.3's two reasons, and no third.
const REASONS = ["policy", "budget"];
// §3.1's defects partition, split the way §4.3's truncation order splits it.
const TERMINAL_PARTITIONS = ["verified-fixed", "ruled-out", "accepted"];
const NON_TERMINAL_PARTITIONS = ["open", "awaiting-verification"];
// The evidence ladder, strongest first, as §4.3's structure rule ranks it.
const EVIDENCE_LADDER = [
  "code-verified",
  "test-observed",
  "doc-asserted",
  "pattern-matched",
  "name-inferred",
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
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value) ?? "", "utf8");
}

// ---------------------------------------------------------------------------
// Deliverables, loaded defensively: an absent or unbuilt deliverable must read
// as an assertion failure, not as a crashed gate.
// ---------------------------------------------------------------------------
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

const contract = readJson(join(REPO, CONTRACT_REL));
let validateAccount = null;
if (contract && Ajv2020) {
  try {
    validateAccount = new Ajv2020({ strict: true }).compile(contract);
  } catch {
    validateAccount = null;
  }
}

/**
 * The wire response, measured the way §4.1 says the budget is enforced: the
 * whole envelope the host receives, text block plus the duplicated
 * `structuredContent`. Measured here rather than read from `trace`, so a
 * response that reports a size it does not have turns this gate red.
 */
function wireBytes(payload) {
  const emitted = mods.helpers.jsonResult(payload, { compact: true });
  return bytes(JSON.stringify(emitted));
}

function prettyWireBytes(payload) {
  return bytes(JSON.stringify(mods.helpers.jsonResult(payload)));
}

// ---------------------------------------------------------------------------
// Fixture: one workspace and one store carrying five loci, each built to put a
// different budget under pressure.
//
//   src/hot.ts      §4.4's pathological locus — 40 findings, 120 evidence
//                   rows, 60 claims, 30 open leads on the one path.
//   src/wide.ts     a 150-item census in a single section, so the aggregated
//                   ledger's id sub-budget is what gives way rather than the
//                   count.
//   src/owned.ts    six agreeing owners, so `owners[]` is bigger than the
//                   standing budget and cannot be truncated to reach it.
//   src/crowded.ts  sixteen owners, so the whole response is past the 32768
//                   ceiling that §4.1 says is an error rather than a
//                   truncation.
//   src/quiet.ts    a ledgered file with nothing else recorded, so every empty
//                   section has to declare census 0 rather than omit.
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
let fixtureError = loadError ? `the locus tools could not be loaded — ${loadError}` : null;

function buildFixture() {
  const root = tempRoot("amanuensis-locus-compactness-");
  const workspace = join(root, "workspace");
  const storageRoot = join(root, "storage-root");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  git(workspace, "init", "-q", "-b", "main");
  git(workspace, "config", "user.email", "test@localhost");
  git(workspace, "config", "user.name", "Locus Compactness Test");
  git(workspace, "config", "commit.gpgsign", "false");
  for (const name of ["hot", "wide", "owned", "crowded", "quiet"]) {
    writeFileSync(join(workspace, "src", `${name}.ts`), `export const ${name} = 1;\n`);
  }
  git(workspace, "add", "src");
  git(workspace, "commit", "-q", "--no-verify", "-m", "fixture");
  const head = git(workspace, "rev-parse", "HEAD");

  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
  const project = mods.project.resolveProject(workspace, {
    selectionSource: "test-locus-compactness",
    serverVersion: "test",
  });
  mods.project.ensureProjectStorage(project, (dbPath) => mods.db.openDatabase(dbPath).close());
  const db = mods.db.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };

  db.prepare("INSERT INTO sessions (session_id, intent) VALUES ('p7', 'p7-gate')").run();
  const subsystem = db.prepare(
    "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading) VALUES (?, ?, ?, 'core', ?, ?)",
  );
  const ledger = db.prepare(
    `INSERT INTO file_ledger
       (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at, stale, stale_reason)
     VALUES (?, ?, 'compactness fixture', 'examined', ?, '2026-09-01 12:00:00', 0, NULL)`,
  );
  subsystem.run("B-01", "Hot path", "concerns", "src/hot.ts and the readers it owns", "src/hot.ts");
  subsystem.run("B-02", "Wide", "concerns", "src/wide.ts", "src/wide.ts");
  subsystem.run("B-03", "Quiet", "concerns", "src/quiet.ts", "src/quiet.ts");
  ledger.run("B-01", "src/hot.ts", head);
  ledger.run("B-02", "src/wide.ts", head);
  ledger.run("B-03", "src/quiet.ts", head);
  // Six owners that agree, so the file's standing state stays `examined` and
  // the only thing over budget is the owner list itself.
  const ownerIds = [];
  for (let i = 1; i <= 6; i += 1) {
    const id = `O-0${i}`;
    ownerIds.push(id);
    subsystem.run(id, `Owner ${i}`, "concerns", "src/owned.ts", "src/owned.ts");
    ledger.run(id, "src/owned.ts", head);
  }
  const crowdedIds = [];
  for (let i = 1; i <= 16; i += 1) {
    const id = `C-${String(i).padStart(2, "0")}`;
    crowdedIds.push(id);
    subsystem.run(id, `Crowd ${i}`, "concerns", "src/crowded.ts", "src/crowded.ts");
    ledger.run(id, "src/crowded.ts", head);
  }

  // 120 evidence rows on the pathological path, cycling the ladder so that the
  // strongest-evidence claims are neither the first nor the last by id.
  const evidence = db.prepare(
    `INSERT INTO evidence (id, file_path, symbol, ref_sha, kind, note, session_id)
     VALUES (?, 'src/hot.ts', ?, ?, ?, ?, 'p7')`,
  );
  for (let i = 1; i <= 120; i += 1) {
    evidence.run(
      i,
      `readRow${i}`,
      head,
      EVIDENCE_LADDER[i % EVIDENCE_LADDER.length],
      `the ${i}th bounded read was observed on the retry path`,
    );
  }

  // 60 claims about the path, each bound to exactly one evidence row, so a
  // claim's evidence kind is known here and can be read against what survives.
  const claim = db.prepare(
    `INSERT INTO claims
       (claim_id, claim_key, subject_type, subject_id, statement, epistemic_kind,
        asserted_at_sha, valid_from_sha, valid_until_sha, session_id)
     VALUES (?, ?, 'file', ?, ?, 'observation', ?, ?, NULL, 'p7')`,
  );
  const claimEvidence = db.prepare(
    "INSERT INTO claim_evidence (claim_id, evidence_id, role) VALUES (?, ?, 'supports')",
  );
  const claimKinds = new Map();
  for (let i = 1; i <= 60; i += 1) {
    const id = `CL-${String(i).padStart(2, "0")}`;
    claim.run(
      id,
      `hot/row/${i}`,
      "src/hot.ts",
      `the reader retries the ${i}th bounded read under a ceiling`,
      head,
      head,
    );
    claimEvidence.run(id, i);
    claimKinds.set(id, EVIDENCE_LADDER[i % EVIDENCE_LADDER.length]);
  }
  // 150 claims on the second path: one section, one census, one aggregated
  // ledger entry whose id list cannot fit its sub-budget.
  const wideIds = [];
  for (let i = 1; i <= 150; i += 1) {
    const id = `WD-${String(i).padStart(3, "0")}`;
    wideIds.push(id);
    claim.run(id, `wide/row/${i}`, "src/wide.ts", `the wide reader holds invariant ${i}`, head, head);
  }

  // 40 findings, the partitions deliberately interleaved so that dropping by
  // id order and dropping terminal-first give different answers.
  const finding = db.prepare(
    `INSERT INTO findings
       (finding_id, subsystem_id, symptom, root_cause, severity, status, primary_files, ref_sha, session_id)
     VALUES (?, 'B-01', ?, 'compactness fixture', ?, ?, ?, ?, 'p7')`,
  );
  const findingEvidence = db.prepare(
    "INSERT INTO finding_evidence (finding_id, evidence_id, role) VALUES (?, ?, 'symptom')",
  );
  const primary = JSON.stringify([`src/hot.ts:readRow1@${head}`]);
  const severities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const statuses = ["confirmed-bug", "ruled-out", "confirmed-acceptable"];
  const findingPartitions = new Map();
  for (let i = 1; i <= 40; i += 1) {
    const id = `B01-${String(i).padStart(2, "0")}`;
    const status = statuses[i % statuses.length];
    finding.run(
      id,
      `the reader mishandles the ${i}th retry of a bounded read`,
      severities[i % severities.length],
      status,
      primary,
      head,
    );
    findingEvidence.run(id, i);
    findingPartitions.set(
      id,
      status === "confirmed-bug" ? "open" : status === "ruled-out" ? "ruled-out" : "accepted",
    );
  }
  // Four repairs awaiting verification: a non-terminal partition that is not
  // `open`, so "terminal before non-terminal" has two survivors to separate.
  const resolution = db.prepare(
    `INSERT INTO finding_resolution_events
       (finding_id, resolution_state, fix_location, fix_sha, rationale, session_id)
     VALUES (?, 'fixed-pending-verification', 'src/hot.ts:readRow1', ?, 'the retry path now closes the handle', 'p7')`,
  );
  for (const id of ["B01-03", "B01-06", "B01-09", "B01-12"]) {
    resolution.run(id, head);
    db.prepare("UPDATE findings SET status = 'fixed' WHERE finding_id = ?").run(id);
    findingPartitions.set(id, "awaiting-verification");
  }

  // 30 open leads on the one path: §2.4.6's unknown[] and §3.1's leads share
  // them, so both the standing budget and an optional section's own budget
  // have something to give way.
  const note = db.prepare(
    `INSERT INTO field_notes (id, category, observation, location, ref_sha, follow_up, session_id)
     VALUES (?, 'anomaly', ?, 'src/hot.ts', ?, 'open', 'p7')`,
  );
  for (let i = 1; i <= 30; i += 1) {
    note.run(i, `the ${i}th retry path is untested and may not be reachable`, head);
  }
  // One dispositioned concern, so `reviews` has a census to omit by policy.
  db.prepare(
    "INSERT INTO concerns (code, category, origin, notes, status) VALUES ('CC-1', 'concurrency', 'seeded', 'can two readers interleave?', 'active')",
  ).run();
  db.prepare(
    `INSERT INTO dispositions (subsystem_id, concern_code, classification, evidence, evidence_quality, rationale)
     VALUES ('B-01', 'CC-1', 'ruled-out', ?, 'code-verified', 'the reader holds the lock across the retry')`,
  ).run(`src/hot.ts:readRow1@${head}`);
  db.prepare(
    "INSERT INTO disposition_evidence (subsystem_id, concern_code, evidence_id, role) VALUES ('B-01','CC-1',1,'supports')",
  ).run();
  // Two terms and two boundary rows, so the round-robin retention has more
  // than two sections to spread across.
  const vocab = db.prepare(
    "INSERT INTO vocabulary (term, gloss, subsystem_id, first_seen, ref_sha) VALUES (?, ?, 'B-01', ?, ?)",
  );
  vocab.run("row cursor", "the position a reader resumes from", `src/hot.ts:readRow1@${head}`, head);
  vocab.run("retry ceiling", "the bound a reader retries under", null, null);
  db.prepare(
    `INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b, a_writes, b_reads)
     VALUES ('SM-01', 'ledger rows', 'table', 'B-01', 'B-02', 'appends rows', 'reads rows')`,
  ).run();
  db.prepare(
    "INSERT INTO xrefs (from_id, to_id, relationship, strength, context) VALUES ('B-01','B-02','data-flow','observed','the wide reader reads what the hot path writes')",
  ).run();

  db.prepare(
    `INSERT INTO git_state (repo_id, canonical_branch, last_checked_sha, last_checked_at, onboarding_sha)
     VALUES ('default', 'main', ?, '2026-09-11 02:15:00', ?)`,
  ).run(head, head);

  return {
    root,
    workspace,
    storageRoot,
    head,
    project,
    db,
    ctx,
    claimKinds,
    findingPartitions,
    wideIds,
    ownerIds,
    crowdedIds,
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

function describeLocusTool() {
  const tools = mods?.locus?.locusTools;
  if (!Array.isArray(tools)) return null;
  return tools.find((tool) => tool?.name === "describe_locus") ?? null;
}

function describeLocus(args) {
  const tool = describeLocusTool();
  if (!tool) throw new Error("describe_locus is not exported from src/tools/locus.ts");
  return tool.handler(args, fixture.ctx);
}

function sectionOf(payload, name) {
  return payload?.sections?.[name] ?? null;
}

function ledgerFor(payload, section, reason) {
  return (payload?.omitted ?? []).filter(
    (entry) => entry.section === section && (reason === undefined || entry.reason === reason),
  );
}

/** The ids an aggregated entry carries, with its section prefix stripped. */
function omittedIds(payload, section, reason) {
  const out = [];
  for (const entry of ledgerFor(payload, section, reason)) {
    for (const id of entry.ids ?? []) out.push(id);
  }
  return out;
}

emit("reader-lenses P7 — response budgets and the omission ledger");
emit("");

// ---------------------------------------------------------------------------
// 1. The compact serialization (C18, §4.1)
// ---------------------------------------------------------------------------
emit("compact serialization");

const SAMPLE = { ok: true, rows: [{ id: 1, note: 'a "quoted" note' }], nested: { a: [1, 2, 3] } };

await check("jsonResult's default path still emits the indented text block", () => {
  if (!mods?.helpers?.jsonResult) return "jsonResult is not exported from src/helpers.ts";
  const result = mods.helpers.jsonResult(SAMPLE);
  const text = result?.content?.[0]?.text;
  if (text !== JSON.stringify(SAMPLE, null, 2))
    return "the default text block is no longer JSON.stringify(data, null, 2)";
  if (JSON.stringify(result.structuredContent) !== JSON.stringify(SAMPLE))
    return "the default path lost structuredContent";
  const failed = mods.helpers.jsonResult({ ok: false, error: "no" });
  return failed.isError === true ? null : "the default path lost the isError signal";
});

await check("jsonResult gains a compact option that drops the indentation only", () => {
  if (!mods?.helpers?.jsonResult) return "jsonResult is not exported from src/helpers.ts";
  const result = mods.helpers.jsonResult(SAMPLE, { compact: true });
  const text = result?.content?.[0]?.text;
  if (text === JSON.stringify(SAMPLE, null, 2))
    return "the compact option is ignored: the text block is still indented";
  if (text !== JSON.stringify(SAMPLE))
    return `the compact text block is not JSON.stringify(data): ${String(text).slice(0, 60)}`;
  // §4.1: structuredContent is counted, not dropped — hosts depend on it.
  if (JSON.stringify(result.structuredContent) !== JSON.stringify(SAMPLE))
    return "the compact path dropped structuredContent";
  const failed = mods.helpers.jsonResult({ ok: false, error: "no" }, { compact: true });
  return failed.isError === true ? null : "the compact path lost the isError signal";
});

await check("describe_locus declares the compact path and no other tool does", async () => {
  const tool = describeLocusTool();
  if (!tool) return "describe_locus is not exported from src/tools/locus.ts";
  if (tool.compact !== true)
    return "describe_locus does not declare the compact path, so the dispatcher cannot honor it";
  // The flag is what the dispatcher reads, so a second tool carrying it would
  // change a response this packet promised not to touch.
  const locusNames = new Set((mods.locus.locusTools ?? []).map((entry) => entry.name));
  const foreign = [];
  let files = [];
  try {
    files = readdirSync(join(MCP, "dist", "tools")).filter((name) => name.endsWith(".js"));
  } catch {
    return "dist/tools could not be read";
  }
  for (const file of files) {
    let module;
    try {
      module = await import(`./dist/tools/${file}`);
    } catch {
      continue;
    }
    for (const value of Object.values(module)) {
      if (!Array.isArray(value)) continue;
      for (const entry of value) {
        if (!entry || typeof entry !== "object" || typeof entry.name !== "string") continue;
        if (entry.compact === true && !locusNames.has(entry.name)) foreign.push(entry.name);
      }
    }
  }
  return foreign.length ? `a tool outside the locus module declares compact: ${foreign.join(", ")}` : null;
});

// ---------------------------------------------------------------------------
// 2. The wire budget, measured on the bytes a host receives (C18, §4.1, §4.4.1)
// ---------------------------------------------------------------------------
emit("");
emit("wire budget");

let hot = null;
let hotExpanded = null;
if (!needFixture()) {
  try {
    hot = describeLocus({ locus: "src/hot.ts" });
    hotExpanded = describeLocus({ locus: "src/hot.ts", sections: SECTIONS });
  } catch (e) {
    fixtureError = `describe_locus did not answer on the pathological fixture — ${e && e.message ? e.message : e}`;
  }
}

if (hot) {
  // §4.4.2: the indentation and the duplicated structuredContent the budget
  // accounts for are measured and printed, not assumed.
  emit(
    `  measured  default response: compact wire ${wireBytes(hot)} B (budget ${WIRE_BUDGET}), ` +
      `pretty wire ${prettyWireBytes(hot)} B, compact payload ${bytes(hot)} B, ` +
      `standing ${bytes(hot.standing)} B (budget ${STANDING_BUDGET})`,
  );
  emit(
    `  measured  every-section response: compact wire ${wireBytes(hotExpanded)} B ` +
      `(budget ${hotExpanded?.trace?.budget_bytes}, ceiling ${WIRE_CEILING}), ` +
      `pretty wire ${prettyWireBytes(hotExpanded)} B`,
  );
}

await check("the default wire response fits 8192 bytes on the pathological fixture", () => {
  const reason = needFixture();
  if (reason) return reason;
  if (!hot) return fixtureError ?? "the pathological response is absent";
  const measured = wireBytes(hot);
  return measured <= WIRE_BUDGET
    ? null
    : `the wire response is ${measured} B, over the ${WIRE_BUDGET} B budget`;
});

await check("the same fixture is over budget before truncation, so the budget bites (VP4)", () => {
  const reason = needFixture();
  if (reason) return reason;
  if (!hot) return fixtureError ?? "the pathological response is absent";
  // (a) An independent measurement: the census rows as the store holds them,
  // serialized at their smallest — no section wrapper, no standing, no trace.
  // If even this exceeds the budget, no untruncated response could fit.
  const rows = fixture.db
    .prepare(
      `SELECT claim_id, statement FROM claims WHERE subject_id = 'src/hot.ts'
        UNION ALL
       SELECT finding_id, symptom FROM findings WHERE subsystem_id = 'B-01'`,
    )
    .all();
  const rawBytes = bytes(rows);
  if (rawBytes <= WIRE_BUDGET)
    return `the fixture's own census serializes to ${rawBytes} B, inside the budget: it cannot prove truncation is load-bearing`;
  // (b) The same response with every section refilled to its census from its
  // own served items. An untruncated response would also carry no ledger, so
  // this under-counts rather than over-counts what truncation saved.
  const inflated = JSON.parse(JSON.stringify(hotExpanded));
  for (const section of Object.values(inflated.sections ?? {})) {
    const served = [...(section.items ?? [])];
    if (served.length === 0) continue;
    let index = 0;
    while (section.items.length < section.census) {
      section.items.push(served[index % served.length]);
      index += 1;
    }
  }
  const inflatedBytes = wireBytes(inflated);
  if (inflatedBytes <= WIRE_BUDGET)
    return `the census refilled from its own items measures ${inflatedBytes} B, inside the budget`;
  emit(
    `  measured  untruncated: census rows alone ${rawBytes} B, response refilled to its census ${inflatedBytes} B`,
  );
  return inflatedBytes > (hotExpanded?.trace?.budget_bytes ?? WIRE_BUDGET)
    ? null
    : `the refilled response measures ${inflatedBytes} B, inside the expanded budget`;
});

await check("the standing block fits its own 3072-byte budget", () => {
  const reason = needFixture();
  if (reason) return reason;
  if (!hot) return fixtureError ?? "the pathological response is absent";
  const measured = bytes(hot.standing);
  if (measured > STANDING_BUDGET)
    return `standing is ${measured} B, over the ${STANDING_BUDGET} B budget`;
  // §4.1: unknown[]'s per-kind sample lists are what gives way first, so on a
  // fixture with 30 open leads the block must have dropped some of them.
  const unknown = hot.standing.unknown ?? hot.standing.file?.unknown ?? [];
  const census = hot.census?.by_section?.unknown ?? null;
  if (census === null) return "the census does not report unknown[]'s candidate count";
  if (census <= unknown.length)
    return `unknown[] carries ${unknown.length} of a census of ${census}: the sample list was not truncated first`;
  return null;
});

await check("each requested optional section fits its own 4096-byte budget", () => {
  const reason = needFixture();
  if (reason) return reason;
  if (!hotExpanded) return fixtureError ?? "the expanded response is absent";
  for (const name of OPT_IN_SECTIONS) {
    const section = sectionOf(hotExpanded, name);
    if (!section) return `${name} is absent from an every-section request`;
    const measured = bytes(section);
    if (measured > OPTIONAL_SECTION_BUDGET)
      return `${name} is ${measured} B, over the ${OPTIONAL_SECTION_BUDGET} B section budget`;
  }
  // leads holds the same 30 open leads as unknown[], so the section budget has
  // to have bitten: a green here with 30 served would be green by triviality.
  const leads = sectionOf(hotExpanded, "leads");
  return leads.census > leads.items.length
    ? null
    : `leads serves its whole census of ${leads.census}, so no budget was applied`;
});

await check("an every-section request stays under the 32768-byte ceiling", () => {
  const reason = needFixture();
  if (reason) return reason;
  if (!hotExpanded) return fixtureError ?? "the expanded response is absent";
  const measured = wireBytes(hotExpanded);
  if (measured > WIRE_CEILING) return `the expanded wire response is ${measured} B, over the ceiling`;
  const budget = hotExpanded?.trace?.budget_bytes;
  if (typeof budget !== "number") return "the trace reports no budget";
  if (budget > WIRE_CEILING) return `the reported budget ${budget} exceeds the ceiling`;
  return measured <= budget ? null : `the response is ${measured} B against its own budget of ${budget} B`;
});

await check("a response that cannot reach the ceiling is an error, not a truncation", () => {
  const reason = needFixture();
  if (reason) return reason;
  // §4.1: sixteen owners put the untruncatable part of the response past the
  // hard ceiling. Exceeding it must raise rather than serve a smaller answer.
  let raised = null;
  try {
    const payload = describeLocus({ locus: "src/crowded.ts" });
    return `the response was served at ${wireBytes(payload)} B rather than refused`;
  } catch (e) {
    raised = e;
  }
  if (!(raised instanceof mods.helpers.ToolError))
    return `the refusal is not a ToolError: ${raised && raised.message ? raised.message : raised}`;
  return /ceiling|32768/.test(String(raised.message))
    ? null
    : `the refusal does not name the ceiling: ${raised.message}`;
});

// ---------------------------------------------------------------------------
// 3. The trace reports the size it actually has (C18, §4.1)
// ---------------------------------------------------------------------------
emit("");
emit("trace");

await check("response_bytes and payload_bytes match a measurement taken outside the tool", () => {
  const reason = needFixture();
  if (reason) return reason;
  if (!hot) return fixtureError ?? "the pathological response is absent";
  for (const [label, payload] of [
    ["default", hot],
    ["every-section", hotExpanded],
  ]) {
    const trace = payload?.trace ?? {};
    if (trace.model_calls !== 0) return `${label}: the trace reports ${trace.model_calls} model calls`;
    const wire = wireBytes(payload);
    if (trace.response_bytes !== wire)
      return `${label}: response_bytes is ${JSON.stringify(trace.response_bytes)}, measured ${wire}`;
    const compact = bytes(payload);
    if (trace.payload_bytes !== compact)
      return `${label}: payload_bytes is ${JSON.stringify(trace.payload_bytes)}, measured ${compact}`;
    if (trace.response_bytes <= trace.payload_bytes)
      return `${label}: the wire measurement does not exceed the payload it duplicates`;
  }
  return null;
});

await check("the response validates against the shipped contract", () => {
  const reason = needFixture();
  if (reason) return reason;
  if (!validateAccount) return `${CONTRACT_REL} is absent, does not compile, or the validator is absent`;
  for (const [label, payload] of [
    ["default", hot],
    ["every-section", hotExpanded],
  ]) {
    if (!validateAccount(payload)) {
      const first = validateAccount.errors?.[0];
      return `${label}: ${first?.instancePath || "/"} ${first?.message}`;
    }
  }
  return null;
});

// ---------------------------------------------------------------------------
// 4. The omission ledger (C20, §4.3)
// ---------------------------------------------------------------------------
emit("");
emit("omission ledger");

await check("selected + omitted == census for every section, reconciled against count", () => {
  const reason = needFixture();
  if (reason) return reason;
  for (const [label, payload] of [
    ["default", hot],
    ["every-section", hotExpanded],
    ["wide", describeLocus({ locus: "src/wide.ts" })],
    ["quiet", describeLocus({ locus: "src/quiet.ts" })],
  ]) {
    const bySection = payload?.census?.by_section ?? {};
    if (Object.keys(bySection).length === 0) return `${label}: the census reports no section`;
    for (const [name, census] of Object.entries(bySection)) {
      const served =
        name === "unknown"
          ? (payload.standing.unknown ?? payload.standing.file?.unknown ?? []).length
          : (sectionOf(payload, name)?.items ?? []).length;
      const dropped = ledgerFor(payload, name).reduce((total, entry) => total + entry.count, 0);
      if (served + dropped !== census)
        return `${label}/${name}: ${served} selected + ${dropped} omitted != ${census}`;
    }
    const total = Object.values(bySection).reduce((sum, count) => sum + count, 0);
    if (payload.census.total !== total)
      return `${label}: census.total is ${payload.census.total}, not the ${total} its sections hold`;
  }
  return null;
});

await check("every omission carries policy or budget, aggregated once per pair", () => {
  const reason = needFixture();
  if (reason) return reason;
  for (const [label, payload] of [
    ["default", hot],
    ["every-section", hotExpanded],
  ]) {
    const seen = new Set();
    for (const entry of payload?.omitted ?? []) {
      if (!REASONS.includes(entry.reason))
        return `${label}: an omission carries the reason ${JSON.stringify(entry.reason)}`;
      if (!Number.isInteger(entry.count) || entry.count <= 0)
        return `${label}/${entry.section}: the count is ${JSON.stringify(entry.count)}`;
      if (typeof entry.ids_truncated !== "boolean")
        return `${label}/${entry.section}: ids_truncated is not declared`;
      if (bytes(entry.ids) > OMITTED_IDS_BUDGET)
        return `${label}/${entry.section}/${entry.reason}: ids are ${bytes(entry.ids)} B, over the ${OMITTED_IDS_BUDGET} B sub-budget`;
      if (entry.ids.length < entry.count && entry.ids_truncated !== true)
        return `${label}/${entry.section}: ${entry.ids.length} of ${entry.count} ids are carried without declaring the truncation`;
      if (entry.ids.length > entry.count)
        return `${label}/${entry.section}: more ids than the count it reconciles against`;
      const key = `${entry.section}/${entry.reason}`;
      if (seen.has(key)) return `${label}: the ledger holds two entries for ${key} rather than one aggregate`;
      seen.add(key);
    }
    const ids = (payload?.omitted ?? []).flatMap((entry) => entry.ids ?? []);
    if (new Set(ids).size !== ids.length) return `${label}: an omitted id repeats`;
  }
  return null;
});

await check("an unrecorded source declares census 0 and recorded false, and omits nothing", () => {
  const reason = needFixture();
  if (reason) return reason;
  const quiet = describeLocus({ locus: "src/quiet.ts" });
  let empty = 0;
  for (const name of SECTIONS) {
    const section = sectionOf(quiet, name);
    if (!section) return `${name} is absent from the quiet locus`;
    if (section.census !== 0) continue;
    empty += 1;
    if (section.recorded !== false)
      return `${name} has census 0 but reports recorded ${JSON.stringify(section.recorded)}`;
    if (ledgerFor(quiet, name).length !== 0) return `${name} omits from an empty census`;
  }
  if (empty === 0) return "no section on the quiet locus has an empty census to declare";
  // And the reverse: a section that does hold rows must not claim it does not.
  const structure = sectionOf(hot, "structure");
  return structure.census > 0 && structure.recorded === true
    ? null
    : "a section with a census of its own reports recorded false";
});

await check("an omitted id names a member of the census it reconciles", () => {
  const reason = needFixture();
  if (reason) return reason;
  const wide = describeLocus({ locus: "src/wide.ts" });
  const ids = omittedIds(wide, "structure", "budget");
  if (ids.length === 0) return "the wide census omits nothing under reason budget";
  const seeded = new Set(fixture.wideIds);
  const served = new Set((sectionOf(wide, "structure")?.items ?? []).map((item) => item.claim_id));
  for (const id of ids) {
    const named = fixture.wideIds.filter((candidate) => id.includes(candidate));
    if (named.length !== 1) return `the omitted id ${JSON.stringify(id)} names no single census member`;
    if (!seeded.has(named[0])) return `the omitted id ${JSON.stringify(id)} is not a census member`;
    if (served.has(named[0])) return `${named[0]} is reported both served and omitted`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// 5. The aggregated ledger on a 150-item census (C20, §4.3)
// ---------------------------------------------------------------------------
emit("");
emit("aggregated ledger");

await check("a 150-item census aggregates to one entry with an exact count", () => {
  const reason = needFixture();
  if (reason) return reason;
  const wide = describeLocus({ locus: "src/wide.ts" });
  const structure = sectionOf(wide, "structure");
  if (structure?.census !== 150) return `the structure census is ${structure?.census}, not the 150 seeded`;
  const entries = ledgerFor(wide, "structure", "budget");
  if (entries.length !== 1)
    return `the ledger holds ${entries.length} budget entries for a single section's 150 candidates`;
  const entry = entries[0];
  const expected = 150 - structure.items.length;
  if (entry.count !== expected)
    return `the count is ${entry.count}, not the ${expected} the census leaves unserved`;
  if (bytes(entry.ids) > OMITTED_IDS_BUDGET)
    return `the id list is ${bytes(entry.ids)} B, over its ${OMITTED_IDS_BUDGET} B sub-budget`;
  if (entry.ids_truncated !== true)
    return `${entry.ids.length} of ${entry.count} ids are carried without ids_truncated`;
  if (entry.ids.length >= entry.count)
    return "the sub-budget carried every id, so a truncated list was never exercised";
  emit(
    `  measured  wide census 150: served ${structure.items.length}, omitted ${entry.count}, ` +
      `ids ${entry.ids.length} in ${bytes(entry.ids)} B, wire ${wireBytes(wide)} B`,
  );
  return wireBytes(wide) <= WIRE_BUDGET ? null : `the wide response is ${wireBytes(wide)} B`;
});

// ---------------------------------------------------------------------------
// 6. owners[] is never truncated (C18, §4.1)
// ---------------------------------------------------------------------------
emit("");
emit("owners");

await check("owners[] keeps every owner, and the residue is declared rather than dropped", () => {
  const reason = needFixture();
  if (reason) return reason;
  const owned = describeLocus({ locus: "src/owned.ts" });
  const owners = owned?.standing?.owners ?? [];
  const ids = owners.map((owner) => owner.subsystem_id).sort();
  if (JSON.stringify(ids) !== JSON.stringify([...fixture.ownerIds].sort()))
    return `owners lists ${JSON.stringify(ids)}, not the ${fixture.ownerIds.length} ledger rows`;
  const standingBytes = bytes(owned.standing);
  if (standingBytes <= STANDING_BUDGET)
    return `standing is ${standingBytes} B, inside its budget: the fixture puts no pressure on owners[]`;
  const wire = wireBytes(owned);
  if (wire <= WIRE_BUDGET)
    return `the response is ${wire} B, inside the budget: nothing forced the untruncatable case`;
  if (owned.trace?.within_budget !== false)
    return `the response is ${wire} B over its budget and does not declare it`;
  if (!owned.trace?.over_budget_reason)
    return "the response exceeds its budget without stating why it could not be truncated further";
  // Every truncatable part must actually be gone before the residue is blamed
  // on the part that is not truncatable.
  const unknown = owned.standing.unknown ?? [];
  const served = SECTIONS.reduce((total, name) => total + (sectionOf(owned, name)?.items ?? []).length, 0);
  if (unknown.length !== 0 || served !== 0)
    return `the residue is declared while ${served} item(s) and ${unknown.length} unknown entr(ies) are still served`;
  emit(`  measured  six owners: standing ${standingBytes} B, wire ${wire} B, declared over budget`);
  return null;
});

// ---------------------------------------------------------------------------
// 7. The truncation order is a code constant (C14, C20, §4.3)
// ---------------------------------------------------------------------------
emit("");
emit("truncation order");

function retentionRankedFindings() {
  const partitionOrder = [...NON_TERMINAL_PARTITIONS, ...TERMINAL_PARTITIONS];
  const severities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const rows = fixture.db
    .prepare("SELECT finding_id, severity FROM findings WHERE subsystem_id = 'B-01'")
    .all();
  return rows
    .map((row) => ({
      id: row.finding_id,
      partition: fixture.findingPartitions.get(row.finding_id),
      severity: severities.indexOf(row.severity),
    }))
    .sort(
      (a, b) =>
        partitionOrder.indexOf(a.partition) - partitionOrder.indexOf(b.partition) ||
        a.severity - b.severity ||
        a.id.localeCompare(b.id),
    )
    .map((row) => row.id);
}

await check("defects drops the terminal partitions before the non-terminal ones", () => {
  const reason = needFixture();
  if (reason) return reason;
  const defects = sectionOf(hotExpanded, "defects");
  const served = (defects?.items ?? []).map((item) => item.finding_id);
  if (served.length === 0) return "the expanded response serves no defect to order";
  if (served.length >= defects.census)
    return `defects serves its whole census of ${defects.census}: no order was exercised`;
  const expected = retentionRankedFindings().slice(0, served.length);
  if (JSON.stringify([...served].sort()) !== JSON.stringify([...expected].sort()))
    return `defects serves ${JSON.stringify(served)}, not the highest-consequence ${JSON.stringify(expected)}`;
  for (const item of defects.items) {
    if (TERMINAL_PARTITIONS.includes(item.partition))
      return `a terminal ${item.partition} finding is served while a non-terminal one is dropped`;
  }
  return null;
});

await check("structure drops the weakest evidence first", () => {
  const reason = needFixture();
  if (reason) return reason;
  const structure = sectionOf(hotExpanded, "structure");
  const served = (structure?.items ?? []).map((item) => item.claim_id);
  if (served.length === 0) return "the expanded response serves no structural claim to order";
  if (served.length >= structure.census)
    return `structure serves its whole census of ${structure.census}: no order was exercised`;
  const rank = (id) => EVIDENCE_LADDER.indexOf(fixture.claimKinds.get(id) ?? "");
  const dropped = [...fixture.claimKinds.keys()].filter((id) => !served.includes(id));
  const weakestServed = Math.max(...served.map(rank));
  const strongestDropped = Math.min(...dropped.map(rank));
  if (weakestServed > strongestDropped)
    return `a claim with ${EVIDENCE_LADDER[strongestDropped]} evidence was dropped while one with ${EVIDENCE_LADDER[weakestServed]} was served`;
  for (const item of structure.items) {
    if (rank(item.claim_id) !== EVIDENCE_LADDER.indexOf(item.evidence_kind))
      return `${item.claim_id} reports evidence_kind ${JSON.stringify(item.evidence_kind)}`;
  }
  return null;
});

await check("every section that holds candidates is represented before any is served twice", () => {
  const reason = needFixture();
  if (reason) return reason;
  // §4.3 fixes the order inside a section; across sections the retention is
  // round-robin, so a truncated response samples every section that has
  // something rather than emptying the lowest-ranked ones.
  const truncated = (hotExpanded?.omitted ?? []).some((entry) => entry.reason === "budget");
  if (!truncated) return "the expanded response was not truncated, so no order was exercised";
  const starved = [];
  for (const name of SECTIONS) {
    const section = sectionOf(hotExpanded, name);
    if ((section?.census ?? 0) > 0 && (section?.items ?? []).length === 0) starved.push(name);
  }
  return starved.length
    ? `a truncated response serves nothing from ${starved.join(", ")} while other sections serve more than one`
    : null;
});

await check("the truncation order is declared in the trace as a code constant", () => {
  const reason = needFixture();
  if (reason) return reason;
  const declared = hot?.trace?.truncation_order;
  if (typeof declared !== "string" || declared.length === 0)
    return "the trace does not name the truncation order it applied";
  const source = readText(join(MCP, "src", "tools", "locus.ts"));
  if (source === null) return "mcp-server/src/tools/locus.ts is absent";
  return source.includes(declared) ? null : `the order ${JSON.stringify(declared)} is not a constant in locus.ts`;
});

// ---------------------------------------------------------------------------
// 8. The bytes a host actually receives (C18, §4.1)
// ---------------------------------------------------------------------------
emit("");
emit("emitted response");

/**
 * The budget is enforced on the emitted wire response, so the emission is read
 * from a live server over stdio rather than inferred from the handler's return
 * value. A tool that measures compactly and emits an indented text block is
 * exactly the failure §4.1 was written against.
 */
async function callTools(calls) {
  if (needFixture()) return { error: needFixture() };
  return await new Promise((resolveFn) => {
    let settled = false;
    const results = new Map();
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
    // Launched from inside the workspace rather than with --workspace: the
    // server refuses a workspace argument that disagrees with its launch
    // directory, which is the binding guard and not this gate's business.
    const server = spawn(process.execPath, [join(MCP, "dist", "index.js")], {
      cwd: fixture.workspace,
      env: { ...process.env, AMANUENSIS_STORAGE_ROOT: fixture.storageRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    server.on("error", (e) => done({ error: e && e.message ? e.message : String(e) }));
    server.stdout.on("data", (chunk) => {
      out += chunk.toString();
      const lines = out.split("\n");
      out = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim().startsWith("{")) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        const call = calls.find((entry) => entry.id === message.id);
        if (call) results.set(call.name, message.result ?? { error: message.error });
        if (results.size === calls.length) done({ results });
      }
    });
    server.stderr.on("data", () => {});
    const timer = setTimeout(
      () => done({ error: "the server did not answer tools/call in time" }),
      45_000,
    );
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
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "p7", version: "0" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    for (const call of calls) {
      send({
        jsonrpc: "2.0",
        id: call.id,
        method: "tools/call",
        params: { name: call.name, arguments: call.args },
      });
    }
  });
}

const emitted = await callTools([
  { id: 10, name: "describe_locus", args: { locus: "src/hot.ts" } },
  { id: 11, name: "get_project_info", args: {} },
]);

await check("the server emits describe_locus compactly, inside the budget", () => {
  if (emitted.error) return `the emitted response could not be read — ${emitted.error}`;
  const result = emitted.results.get("describe_locus");
  if (!result || result.error) return `describe_locus did not answer: ${JSON.stringify(result?.error)}`;
  const text = result.content?.[0]?.text;
  if (typeof text !== "string") return "the response carries no text block";
  if (!result.structuredContent) return "the emitted response dropped structuredContent";
  if (text !== JSON.stringify(result.structuredContent))
    return "the emitted text block is not the compact serialization of structuredContent";
  const measured = bytes(JSON.stringify(result));
  emit(`  measured  emitted over stdio: ${measured} B (budget ${WIRE_BUDGET})`);
  return measured <= WIRE_BUDGET ? null : `the emitted response is ${measured} B, over the budget`;
});

await check("every other tool's emitted response is unchanged", () => {
  if (emitted.error) return `the emitted response could not be read — ${emitted.error}`;
  const result = emitted.results.get("get_project_info");
  if (!result || result.error) return `get_project_info did not answer: ${JSON.stringify(result?.error)}`;
  const text = result.content?.[0]?.text;
  if (typeof text !== "string") return "the response carries no text block";
  if (!result.structuredContent) return "the response dropped structuredContent";
  return text === JSON.stringify(result.structuredContent, null, 2)
    ? null
    : "a tool outside the locus module no longer emits the indented text block";
});

// ---------------------------------------------------------------------------
// 9. Custody (C55, C63)
// ---------------------------------------------------------------------------
emit("");
emit("custody");

await check("the packet's gate runs in CI", () => {
  const ci = readText(join(REPO, CI_REL));
  if (ci === null) return `${CI_REL} is absent`;
  return ci.includes("node test-locus-compactness.mjs") ? null : "the gate is not run in CI";
});

await check("the contract declares the wire measurement and the budget declaration", () => {
  if (contract === null) return `${CONTRACT_REL} is absent or is not JSON`;
  const trace = contract.properties?.trace;
  if (!trace) return "the contract declares no trace object";
  const required = new Set(trace.required ?? []);
  for (const field of ["budget_bytes", "payload_bytes", "response_bytes", "within_budget", "truncation_order"]) {
    if (!required.has(field)) return `the contract does not require trace.${field}`;
  }
  const shape = trace.properties?.response_bytes ?? {};
  const type = Array.isArray(shape.type) ? shape.type : [shape.type];
  if (type.includes("null"))
    return "the contract still admits a null response_bytes, so an unmeasured response validates";
  const reasons = contract.properties?.omitted?.items?.properties?.reason?.enum ?? [];
  return JSON.stringify([...reasons].sort()) === JSON.stringify([...REASONS].sort())
    ? null
    : `the contract admits the omission reasons ${JSON.stringify(reasons)}`;
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
    `GATE P7 RED: the response budget and the omission ledger's census do not hold — ${failures.length} assertion(s) failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("");
emit("GATE P7 GREEN");
