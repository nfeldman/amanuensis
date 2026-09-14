#!/usr/bin/env node
// Gate for reader-lenses packet P20 — the regeneration pass that carries the
// three slice-S6 findings the fix session verified and could not repair:
// F6 (challenge outcomes and status transitions are not durable, and `mapped`
// has no prerequisite), F7 (cross-subsystem dependencies visible in
// `mcp-server/src/index.ts` have no recorded edge), and F9 (the promoted
// `docs/` take their identity from the worktree basename).
// (spec.md §9.1 Phase prerequisite, §9.2, §7.2 item 1, §12.1–§12.4;
// claims C43, C52, C54, C55, C63.)
//
// Three arms, because the three findings live in three different places.
//
//   1. **Behaviour**, against a throwaway workspace and store, through the
//      real write path. F6 is a claim about what the server *refuses*, and a
//      refusal is only established by attempting the write. This arm compiles
//      `src/` first (`ensure-built.mjs`), so a sabotaged source cannot be
//      certified by a stale `dist/`.
//   2. **The committed receipts**, because the self-conspectus store is
//      untracked — `git ls-files .amanuensis` returns 0 — so a gate that only
//      read the store would be green by absence in CI and in the launcher's
//      verification worktree (VP4; concern ZD-1 in this survey).
//   3. **The live store**, wherever one exists, so that a receipt nobody can
//      contradict is not the only witness.
//
// Turns red when:
//   - `claim_challenge_outcomes` or `subsystem_status_transitions` is not in
//     the schema, is not append-only in the substrate, or carries no outcome
//     enum;
//   - a subsystem holding a current `<sid>/` claim with no challenge outcome
//     is advanced to `mapped` without refusal, or the refusal does not name
//     the claim and the tool that records the outcome — the store would then
//     publish a structural account nothing challenged;
//   - another subsystem's outcome satisfies the gate (the two shapes a
//     `LIKE '<sid>/%'` predicate would wrongly admit, an id carrying `_` and
//     an id carrying `%`);
//   - `record_claim_challenge` accepts a historical claim, an outcome outside
//     the enum, a challenge with no substance, an `overturned` or
//     `superseded` outcome with no claim validity event behind it, or an
//     event belonging to another claim or naming another event type;
//   - a rung of the survey ladder is climbed and no transition row records
//     it, or a row is written for a write that changed nothing;
//   - the depth receipt carries a ladder rung that names neither a recorded
//     transition nor the storage checkpoint that witnesses it — a synthesized
//     ladder rung is the zero-denominator green slice-S6 F6 found;
//   - `record-rebuild-depth.mjs` still hardcodes the writing tool, or does
//     not read the two record tables at all;
//   - a claim target's outcome is not backed by a `claim_challenge_outcome`
//     row;
//   - a cross-subsystem import visible in `mcp-server/src/index.ts` has no
//     recorded edge between the two owning subsystems — a missing edge in the
//     coverage denominator;
//   - the coverage receipt's recorded registry ownership disagrees with the
//     live file ledger;
//   - the project's name is the worktree basename, the storage directory, or
//     anything but the name its binding metadata carries; or a promoted page
//     title carries the worktree basename;
//   - `renderers.py` still falls back to a directory name for the project
//     name;
//   - the gate does not run in `.github/workflows/test.yml`.
//
// False greens it cannot exclude. A recorded challenge outcome does not make
// the challenge a real one: `survived` on every claim is a legitimate result
// and unfalsifiable from outside, so what is established is that every current
// claim has a durable outcome written by the pass and that an overturning one
// carries the validity event that overturned it. A recorded edge does not
// prove the crossing is real — symbol reachability is deliberately unchecked
// (§9.2) — and the import denominator is what `index.ts` makes visible, not
// every crossing in the tree: a dependency reached through a string, a
// registry lookup, or a file this gate does not parse is a crossing it cannot
// miss. A canonical project name that matches its binding metadata can still
// be the wrong name for the project. And a receipt proves what was true when
// it was written; the live arm narrows that window only where a store exists.
//
// Output protocol: exactly one status line, last, on stdout. Every message is
// scrubbed of the launcher's crash signatures, so an absent deliverable reads
// as a failed assertion rather than as a gate that never ran.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SCHEMA_REL = "mcp-server/src/schema.sql";
const INVARIANTS_REL = "mcp-server/src/invariants.ts";
const INDEX_REL = "mcp-server/src/index.ts";
const RENDERERS_REL = "materializer/amanuensis_materializer/renderers.py";
const DEPTH_RECORDER_REL = "dev/record-rebuild-depth.mjs";
const COVERAGE_RECORDER_REL = "dev/record-rebuild-coverage.mjs";
const DEPTH_REL = "design/reader-lenses/rebuild-depth-receipt.json";
const COVERAGE_REL = "design/reader-lenses/rebuild-coverage-receipt.json";
const DOGFOOD_REL = "design/reader-lenses/dogfood-receipt.json";
const DOCS_INDEX_REL = "docs/index.md";
const CI_REL = ".github/workflows/test.yml";
const STORE_REL = ".amanuensis/memory.db";
const GATE_COMMAND = "node dev/test-rebuild-regeneration.mjs";

// The two record tables this packet adds, and the enum the first one carries.
const OUTCOME_TABLE = "claim_challenge_outcomes";
const TRANSITION_TABLE = "subsystem_status_transitions";
const CLAIM_OUTCOMES = ["survived", "overturned", "superseded"];
const STATUS_ORDER = ["unmapped", "scoping", "structural", "concerns", "adversarial", "mapped"];

// The tools permitted to write `subsystems.status`, which are therefore the
// only tools a recorded transition may name.
const STATUS_WRITERS = ["upsert_subsystem", "update_subsystem_status", "reset_subsystem"];

// §12.1's ladder is recorded, not reconstructed. A rung may cite the
// transition row that wrote it, or — for a rung climbed before the table
// existed — the storage checkpoint whose committed `memory.db` witnesses it.
// Anything else is synthesis.
const LADDER_SOURCES = ["subsystem_status_transitions", "storage-checkpoint"];

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
  [/syntax error/gi, "malformed statement"],
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

function readText(relPath) {
  const abs = join(REPO, relPath);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function readJson(relPath) {
  const text = readText(relPath);
  if (text === null) return { text: null, value: null };
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    return { text, value: null };
  }
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isHex(value, min, max) {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${min},${max}}$`).test(value);
}

/** The declaration body of one `CREATE TABLE` in schema.sql, or null. */
function tableBody(schema, table) {
  const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  if (start < 0) return null;
  const end = schema.indexOf("\n);", start);
  return end < 0 ? null : schema.slice(start, end);
}

// ---------------------------------------------------------------------------
// 1. The two durable records exist in the substrate and are append-only there.
// ---------------------------------------------------------------------------
emit("the durable records: per-claim challenge outcomes and subsystem status transitions");

const schemaText = readText(SCHEMA_REL);

check("the schema declares an append-only claim challenge outcome record", () => {
  if (schemaText === null) return `${SCHEMA_REL} is absent, so no claim carries a challenge outcome`;
  const body = tableBody(schemaText, OUTCOME_TABLE);
  if (body === null) return `the schema declares no ${OUTCOME_TABLE} table: no challenge outcome is durable`;
  for (const column of ["claim_id", "claim_key", "outcome", "challenge", "at_sha", "session_id"]) {
    if (!new RegExp(`\\n\\s+${column}\\s`).test(body)) {
      return `${OUTCOME_TABLE} declares no ${column} column`;
    }
  }
  const missing = CLAIM_OUTCOMES.filter((value) => !body.includes(`'${value}'`));
  if (missing.length) return `${OUTCOME_TABLE}.outcome admits no ${missing.join(", ")}`;
  if (!/CHECK\s*\(\s*outcome\s+IN\s*\(/.test(body)) {
    return `${OUTCOME_TABLE}.outcome carries no CHECK, so any string is an outcome`;
  }
  for (const verb of ["UPDATE", "DELETE"]) {
    const trigger = new RegExp(`BEFORE ${verb} ON ${OUTCOME_TABLE}\\b`);
    if (!trigger.test(schemaText)) {
      return `${OUTCOME_TABLE} has no BEFORE ${verb} trigger, so the record is not append-only in the substrate`;
    }
  }
  return null;
});

check("the schema declares an append-only subsystem status transition record", () => {
  if (schemaText === null) return `${SCHEMA_REL} is absent, so no status transition is recorded`;
  const body = tableBody(schemaText, TRANSITION_TABLE);
  if (body === null) {
    return `the schema declares no ${TRANSITION_TABLE} table, so every ladder rung is a synthesized ladder rung`;
  }
  for (const column of ["subsystem_id", "from_status", "to_status", "tool", "session_id", "ref_sha"]) {
    if (!new RegExp(`\\n\\s+${column}\\s`).test(body)) {
      return `${TRANSITION_TABLE} declares no ${column} column`;
    }
  }
  const missingWriters = STATUS_WRITERS.filter((name) => !body.includes(`'${name}'`));
  if (missingWriters.length) return `${TRANSITION_TABLE}.tool admits no ${missingWriters.join(", ")}`;
  const missingStatuses = STATUS_ORDER.filter((value) => !body.includes(`'${value}'`));
  if (missingStatuses.length) return `${TRANSITION_TABLE} admits no ${missingStatuses.join(", ")} status`;
  for (const verb of ["UPDATE", "DELETE"]) {
    const trigger = new RegExp(`BEFORE ${verb} ON ${TRANSITION_TABLE}\\b`);
    if (!trigger.test(schemaText)) {
      return `${TRANSITION_TABLE} has no BEFORE ${verb} trigger, so the ladder can be rewritten after the fact`;
    }
  }
  return null;
});

check("the mapped prerequisite lives in enforcePhasePrerequisites, not beside it", () => {
  const source = readText(INVARIANTS_REL);
  if (source === null) return `${INVARIANTS_REL} is absent`;
  const start = source.indexOf("export function enforcePhasePrerequisites");
  if (start < 0) return "enforcePhasePrerequisites is not exported, so no status writer shares one gate";
  const body = source.slice(start);
  const mapped = body.indexOf('case "mapped"');
  if (mapped < 0) {
    return `enforcePhasePrerequisites has no 'mapped' case: a subsystem reaches mapped without a challenge outcome on any claim`;
  }
  if (!source.includes(OUTCOME_TABLE)) {
    return `${INVARIANTS_REL} never reads ${OUTCOME_TABLE}, so mapped without a recorded outcome is still permitted`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// 2. Behaviour, through the real write path, against a throwaway store.
// ---------------------------------------------------------------------------
emit("");
emit("the refusal, exercised through the real write path");

let built = { ok: false, detail: "ensure-built.mjs was not reached" };
let mods = null;
let loadError = null;
try {
  const ensure = await import("../mcp-server/scripts/ensure-built.mjs");
  built = ensure.ensureBuilt();
} catch (e) {
  built = { ok: false, detail: `the compiler wrapper could not be loaded — ${e && e.message ? e.message : e}` };
}
if (built.ok) {
  try {
    const [db, project, subsystems, files, artifacts, claims, evidence, projectTools, dispositions, concerns, gitTools] =
      await Promise.all([
        import("../mcp-server/dist/db.js"),
        import("../mcp-server/dist/project.js"),
        import("../mcp-server/dist/tools/subsystems.js"),
        import("../mcp-server/dist/tools/files.js"),
        import("../mcp-server/dist/tools/artifacts.js"),
        import("../mcp-server/dist/tools/claims.js"),
        import("../mcp-server/dist/tools/evidence.js"),
        import("../mcp-server/dist/tools/project.js"),
        import("../mcp-server/dist/tools/dispositions.js"),
        import("../mcp-server/dist/tools/concerns.js"),
        import("../mcp-server/dist/tools/git.js"),
      ]);
    mods = { db, project, subsystems, files, artifacts, claims, evidence, projectTools, dispositions, concerns, gitTools };
  } catch (e) {
    loadError = e && e.message ? e.message : String(e);
  }
}

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

function toolNamed(name) {
  const groups = [
    mods?.subsystems?.subsystemTools,
    mods?.files?.fileTools,
    mods?.artifacts?.artifactTools,
    mods?.claims?.claimTools,
    mods?.evidence?.evidenceTools,
    mods?.projectTools?.projectTools,
    mods?.dispositions?.dispositionTools,
    mods?.concerns?.concernTools,
    mods?.gitTools?.gitTools,
  ];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    const found = group.find((tool) => tool?.name === name);
    if (found) return found;
  }
  return null;
}

function call(name, args, ctx) {
  const tool = toolNamed(name);
  if (!tool) throw new Error(`${name} is not exported by the built tools`);
  return tool.handler(args, ctx);
}

/** Run a call expected to be refused; return the refusal text, or null. */
function refusal(name, args, ctx) {
  try {
    call(name, args, ctx);
    return null;
  } catch (e) {
    return e && e.message ? String(e.message) : String(e);
  }
}

let fixture = null;
let fixtureError = !built.ok
  ? `src/ was not compiled before this gate read dist/ — ${built.detail}`
  : loadError
    ? `the subsystem, claim and evidence tools could not be loaded — ${loadError}`
    : null;

function buildFixture() {
  const root = tempRoot("amanuensis-p20-regeneration-");
  const workspace = join(root, "workspace");
  const storageRoot = join(root, "storage-root");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  git(workspace, "init", "-q", "-b", "main");
  git(workspace, "config", "user.email", "test@localhost");
  git(workspace, "config", "user.name", "P20 Regeneration Gate");
  git(workspace, "config", "commit.gpgsign", "false");
  writeFileSync(join(workspace, "src", "unit.ts"), "export const unit = 1;\n");
  git(workspace, "add", "src");
  git(workspace, "commit", "-q", "--no-verify", "-m", "base");
  const base = git(workspace, "rev-parse", "HEAD");
  writeFileSync(join(workspace, "src", "unit.ts"), "export const unit = 2;\n");
  git(workspace, "add", "src");
  git(workspace, "commit", "-q", "--no-verify", "-m", "head");
  const head = git(workspace, "rev-parse", "HEAD");

  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
  const project = mods.project.resolveProject(workspace, {
    selectionSource: "test-rebuild-regeneration",
    serverVersion: "test",
  });
  mods.project.ensureProjectStorage(project, (dbPath) => mods.db.openDatabase(dbPath).close());
  const db = mods.db.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  ctx.sessionId = call("start_session", { intent: "p20-regeneration-gate" }, ctx).session_id;
  call(
    "set_git_state",
    { canonical_branch: "main", onboarding_sha: base, last_checked_sha: head },
    ctx,
  );
  call("add_concern", { code: "FIXTURE-1", category: "cache", origin: "seeded" }, ctx);
  return { project, db, ctx, base, head, workspace };
}

try {
  if (!fixtureError) fixture = buildFixture();
} catch (e) {
  fixtureError = `the workspace and store could not be prepared — ${e && e.message ? e.message : e}`;
}

function needFixture() {
  return fixture ? null : fixtureError;
}

/**
 * A refusal is only evidence when the tool exists to refuse. Without this,
 * every "the tool rejects X" check below would pass on a tree where the tool
 * was never written — the shape of a zero-denominator green (VP4).
 */
function needTool(name) {
  const missing = needFixture();
  if (missing) return missing;
  return toolNamed(name)
    ? null
    : `${name} is not exported by the built tools, so no challenge outcome can be recorded at all`;
}

let seq = 0;

/** Carry one subsystem from `unmapped` to `adversarial`, with one claim. */
function subsystemAtAdversarial(id, { claimKey } = {}) {
  seq += 1;
  const slug = `u${seq}`;
  const filePath = "src/unit.ts";
  const ctx = fixture.ctx;
  call("upsert_subsystem", { id, name: `Subsystem ${id}`, status: "unmapped" }, ctx);
  call("update_subsystem_status", { id, status: "scoping" }, ctx);
  call(
    "add_files_to_scope",
    { subsystem_id: id, ref_sha: fixture.base, files: [{ file_path: filePath, why_in_scope: "gate fixture" }] },
    ctx,
  );
  const evidenceId = call(
    "add_evidence",
    {
      file_path: filePath,
      symbol: `Unit${slug}`,
      line_range: "1-1",
      ref_sha: fixture.base,
      kind: "code-verified",
      note: "p20 regeneration gate fixture",
    },
    ctx,
  ).id;
  const key = claimKey ?? `${id}/key-type/unit-${slug}`;
  const claimId = `CL-${slug}`;
  call(
    "add_claim",
    {
      claim_id: claimId,
      claim_key: key,
      subject_type: "symbol",
      subject_id: `${filePath}:Unit${slug}`,
      statement: `Unit${slug} is the type ${id} is built around.`,
      epistemic_kind: "observation",
      ref_sha: fixture.base,
      evidence_ids: [evidenceId],
    },
    ctx,
  );
  call("update_subsystem_status", { id, status: "structural" }, ctx);
  call("register_artifact", { path: `${slug}-survey.md`, kind: "subsystem-survey", subsystem_id: id }, ctx);
  call("update_subsystem_status", { id, status: "concerns" }, ctx);
  call(
    "set_disposition",
    {
      subsystem_id: id,
      concern_code: "FIXTURE-1",
      classification: "ruled-out",
      evidence: `${filePath}:Unit${slug}@${fixture.base}`,
      evidence_ids: [evidenceId],
      evidence_quality: "code-verified",
      linchpin_dependent: false,
      rationale: "gate fixture disposition",
      ref_sha: fixture.base,
      pass_type: "survey",
    },
    ctx,
  );
  call("update_subsystem_status", { id, status: "adversarial" }, ctx);
  return { id, claimId, claimKey: key, evidenceId };
}

const CHALLENGE =
  "Read the declaration and both call sites at the asserted revision looking for a second writer; none exists.";

check("a subsystem whose current claim has no challenge outcome is refused at mapped", () => {
  const missing = needFixture();
  if (missing) return missing;
  const unit = subsystemAtAdversarial("B-R1");
  const denied = refusal("update_subsystem_status", { id: "B-R1", status: "mapped" }, fixture.ctx);
  if (denied === null) {
    return "B-R1 advanced to mapped without a recorded challenge outcome on its only current claim";
  }
  for (const fragment of [unit.claimKey, "record_claim_challenge"]) {
    if (!denied.includes(fragment)) {
      return `the refusal does not name ${JSON.stringify(fragment)}: ${denied}`;
    }
  }
  return null;
});

check("upsert_subsystem cannot reach mapped around the prerequisite either", () => {
  const missing = needFixture();
  if (missing) return missing;
  const denied = refusal(
    "upsert_subsystem",
    { id: "B-R1", name: "Subsystem B-R1", status: "mapped" },
    fixture.ctx,
  );
  if (denied === null) {
    return "B-R1 reached mapped without a challenge outcome through upsert_subsystem: the prerequisite sits on one writer, not on the shared path";
  }
  if (!denied.includes("record_claim_challenge")) {
    return `the second door's refusal does not name the tool that records the outcome: ${denied}`;
  }
  return null;
});

check("recording the outcome admits the advance, and the transition is recorded", () => {
  const missing = needTool("record_claim_challenge");
  if (missing) return missing;
  const before = fixture.db
    .prepare(`SELECT COUNT(*) AS n FROM ${TRANSITION_TABLE} WHERE subsystem_id = 'B-R1'`)
    .get().n;
  const written = call(
    "record_claim_challenge",
    { claim_id: "CL-u1", outcome: "survived", challenge: CHALLENGE, ref_sha: fixture.base },
    fixture.ctx,
  );
  if (!written || typeof written.id !== "number") {
    return `record_claim_challenge returned ${JSON.stringify(written ?? null)} rather than the id of the row it wrote`;
  }
  const denied = refusal("update_subsystem_status", { id: "B-R1", status: "mapped" }, fixture.ctx);
  if (denied !== null) return `the advance was still refused after the outcome was recorded: ${denied}`;
  const rows = fixture.db
    .prepare(
      `SELECT from_status, to_status, tool, session_id, ref_sha FROM ${TRANSITION_TABLE}
        WHERE subsystem_id = 'B-R1' ORDER BY id`,
    )
    .all();
  if (rows.length !== before + 1) {
    return `the advance to mapped wrote ${rows.length - before} transition row(s), not exactly one`;
  }
  const last = rows[rows.length - 1];
  if (last.from_status !== "adversarial" || last.to_status !== "mapped") {
    return `the recorded rung is ${JSON.stringify(last.from_status)} → ${JSON.stringify(last.to_status)}`;
  }
  if (last.tool !== "update_subsystem_status") {
    return `the rung names ${JSON.stringify(last.tool)} as its writer`;
  }
  if (last.session_id !== fixture.ctx.sessionId) {
    return `the recorded rung is attributed to ${JSON.stringify(last.session_id)}, not the session that climbed it`;
  }
  if (last.ref_sha !== fixture.head) {
    return `the recorded rung is bound to ${JSON.stringify(last.ref_sha)}, not the revision the store was last checked at`;
  }
  return null;
});

check("the whole ladder is recorded, one row per rung, and no row for a write that changed nothing", () => {
  const missing = needFixture();
  if (missing) return missing;
  const rows = fixture.db
    .prepare(`SELECT from_status, to_status, tool FROM ${TRANSITION_TABLE} WHERE subsystem_id = 'B-R1' ORDER BY id`)
    .all();
  const climbed = rows.map((row) => `${row.from_status ?? "∅"}→${row.to_status}`).join(", ");
  const expected = [
    "∅→unmapped",
    "unmapped→scoping",
    "scoping→structural",
    "structural→concerns",
    "concerns→adversarial",
    "adversarial→mapped",
  ].join(", ");
  if (climbed !== expected) return `B-R1's recorded ladder is [${climbed}], not [${expected}]`;
  if (rows.some((row) => !STATUS_WRITERS.includes(row.tool))) {
    return `a rung names a writer outside ${STATUS_WRITERS.join(", ")}`;
  }
  const before = rows.length;
  call("update_subsystem_status", { id: "B-R1", status: "mapped" }, fixture.ctx);
  call("upsert_subsystem", { id: "B-R1", name: "Subsystem B-R1", status: "mapped" }, fixture.ctx);
  const after = fixture.db
    .prepare(`SELECT COUNT(*) AS n FROM ${TRANSITION_TABLE} WHERE subsystem_id = 'B-R1'`)
    .get().n;
  if (after !== before) {
    return `a no-op status write recorded ${after - before} transition row(s); the ladder would then count rungs nobody climbed`;
  }
  return null;
});

check("upsert_subsystem's status write is recorded too, so the second door is not a hole", () => {
  const missing = needFixture();
  if (missing) return missing;
  call("upsert_subsystem", { id: "B-R2", name: "Subsystem B-R2", status: "unmapped" }, fixture.ctx);
  call("upsert_subsystem", { id: "B-R2", name: "Subsystem B-R2", status: "scoping" }, fixture.ctx);
  const rows = fixture.db
    .prepare(`SELECT from_status, to_status, tool FROM ${TRANSITION_TABLE} WHERE subsystem_id = 'B-R2' ORDER BY id`)
    .all();
  if (rows.length !== 2) return `upsert_subsystem recorded ${rows.length} rung(s) for B-R2, not 2`;
  if (rows.some((row) => row.tool !== "upsert_subsystem")) {
    return `a rung B-R2 climbed through upsert_subsystem names ${JSON.stringify(rows.find((r) => r.tool !== "upsert_subsystem")?.tool ?? null)}`;
  }
  return null;
});

check("another subsystem's challenge outcome does not satisfy the gate", () => {
  const missing = needTool("record_claim_challenge");
  if (missing) return missing;
  // The two shapes an unescaped `LIKE '<sid>/%'` predicate would wrongly
  // admit: `_` matches any character and `%` matches any run of them.
  for (const [gated, neighbour] of [
    ["S_1", "SX1"],
    ["P%1", "PZ1"],
  ]) {
    subsystemAtAdversarial(neighbour);
    const neighbourClaim = fixture.db
      .prepare("SELECT claim_id FROM claims WHERE substr(claim_key, 1, length(?)) = ? AND valid_until_sha IS NULL")
      .get(`${neighbour}/`, `${neighbour}/`);
    call(
      "record_claim_challenge",
      { claim_id: neighbourClaim.claim_id, outcome: "survived", challenge: CHALLENGE, ref_sha: fixture.base },
      fixture.ctx,
    );
    subsystemAtAdversarial(gated);
    const denied = refusal("update_subsystem_status", { id: gated, status: "mapped" }, fixture.ctx);
    if (denied === null) {
      return `${gated} reached mapped without a challenge outcome: ${neighbour}'s outcome satisfied its gate`;
    }
  }
  return null;
});

check("record_claim_challenge refuses what cannot be an honest outcome", () => {
  const missing = needTool("record_claim_challenge");
  if (missing) return missing;
  const unit = subsystemAtAdversarial("B-R3");
  const cases = [
    ["an unknown claim", { claim_id: "CL-absent", outcome: "survived", challenge: CHALLENGE, ref_sha: fixture.base }],
    ["a challenge with no substance", { claim_id: unit.claimId, outcome: "survived", challenge: "looked", ref_sha: fixture.base }],
    [
      "an overturned outcome with no validity event",
      { claim_id: unit.claimId, outcome: "overturned", challenge: CHALLENGE, ref_sha: fixture.base },
    ],
    [
      "a superseded outcome with no validity event",
      { claim_id: unit.claimId, outcome: "superseded", challenge: CHALLENGE, ref_sha: fixture.base },
    ],
    [
      "an unresolvable revision",
      { claim_id: unit.claimId, outcome: "survived", challenge: CHALLENGE, ref_sha: "0".repeat(40) },
    ],
    [
      "an outcome outside the enum",
      { claim_id: unit.claimId, outcome: "dismissed", challenge: CHALLENGE, ref_sha: fixture.base },
    ],
  ];
  for (const [label, args] of cases) {
    if (refusal("record_claim_challenge", args, fixture.ctx) === null) {
      return `record_claim_challenge accepted ${label}`;
    }
  }
  // A closed claim is not a current authority, so it cannot take an outcome.
  const closingEvidence = call(
    "add_evidence",
    { file_path: "src/unit.ts", symbol: "Unit", line_range: "1-1", ref_sha: fixture.head, kind: "code-verified" },
    fixture.ctx,
  ).id;
  call(
    "invalidate_claim",
    { claim_id: unit.claimId, at_sha: fixture.head, reason: "the fixture moved on", evidence_ids: [closingEvidence] },
    fixture.ctx,
  );
  if (
    refusal(
      "record_claim_challenge",
      { claim_id: unit.claimId, outcome: "survived", challenge: CHALLENGE, ref_sha: fixture.base },
      fixture.ctx,
    ) === null
  ) {
    return "record_claim_challenge accepted a historical claim, which no current account rests on";
  }
  return null;
});

check("an overturning outcome must carry the validity event that overturned it", () => {
  const missing = needTool("record_claim_challenge");
  if (missing) return missing;
  const unit = subsystemAtAdversarial("B-R4");
  const other = subsystemAtAdversarial("B-R5");
  const otherEvidence = call(
    "add_evidence",
    { file_path: "src/unit.ts", symbol: "Other", line_range: "1-1", ref_sha: fixture.head, kind: "code-verified" },
    fixture.ctx,
  ).id;
  call(
    "invalidate_claim",
    { claim_id: other.claimId, at_sha: fixture.head, reason: "the other claim fell", evidence_ids: [otherEvidence] },
    fixture.ctx,
  );
  const otherEvent = fixture.db
    .prepare("SELECT id FROM claim_validity_events WHERE claim_id = ? AND event_type = 'invalidated'")
    .get(other.claimId);
  if (!otherEvent) return "the fixture could not produce a claim validity event to point at";
  const borrowed = refusal(
    "record_claim_challenge",
    {
      claim_id: unit.claimId,
      outcome: "overturned",
      challenge: CHALLENGE,
      ref_sha: fixture.base,
      validity_event_id: otherEvent.id,
    },
    fixture.ctx,
  );
  if (borrowed === null) {
    return "an overturned outcome was accepted against another claim's validity event";
  }
  // …and the event's own type must be the one the outcome names.
  const ownEvidence = call(
    "add_evidence",
    { file_path: "src/unit.ts", symbol: "Own", line_range: "1-1", ref_sha: fixture.head, kind: "code-verified" },
    fixture.ctx,
  ).id;
  call(
    "invalidate_claim",
    { claim_id: unit.claimId, at_sha: fixture.head, reason: "this claim fell too", evidence_ids: [ownEvidence] },
    fixture.ctx,
  );
  const ownEvent = fixture.db
    .prepare("SELECT id FROM claim_validity_events WHERE claim_id = ? AND event_type = 'invalidated'")
    .get(unit.claimId);
  const mismatched = refusal(
    "record_claim_challenge",
    {
      claim_id: unit.claimId,
      outcome: "superseded",
      challenge: CHALLENGE,
      ref_sha: fixture.base,
      validity_event_id: ownEvent.id,
    },
    fixture.ctx,
  );
  if (mismatched === null) {
    return "a superseded outcome was accepted against an invalidated claim validity event";
  }
  return null;
});

check("an overturned outcome is accepted on the claim its cited event closed", () => {
  const missing = needTool("record_claim_challenge");
  if (missing) return missing;
  // The positive control. Every case above establishes a refusal; a check
  // that can only refuse is a check that has never accepted, and this is the
  // one path an adversarial pass that overturns something has to take.
  const unit = subsystemAtAdversarial("B-R7");
  const closing = call(
    "add_evidence",
    { file_path: "src/unit.ts", symbol: "Overturn", line_range: "1-1", ref_sha: fixture.head, kind: "code-verified" },
    fixture.ctx,
  ).id;
  call(
    "invalidate_claim",
    {
      claim_id: unit.claimId,
      at_sha: fixture.head,
      reason: "the probe found the shape it records is not the shape the code declares",
      evidence_ids: [closing],
    },
    fixture.ctx,
  );
  const event = fixture.db
    .prepare("SELECT id FROM claim_validity_events WHERE claim_id = ? AND event_type = 'invalidated'")
    .get(unit.claimId);
  if (!event) return "invalidate_claim recorded no validity event to cite";
  let written = null;
  try {
    written = call(
      "record_claim_challenge",
      {
        claim_id: unit.claimId,
        outcome: "overturned",
        challenge: CHALLENGE,
        ref_sha: fixture.head,
        validity_event_id: event.id,
      },
      fixture.ctx,
    );
  } catch (e) {
    return `an overturning outcome could not be recorded at all — ${e && e.message ? e.message : e}`;
  }
  const row = fixture.db
    .prepare(`SELECT outcome, validity_event_id FROM ${OUTCOME_TABLE} WHERE id = ?`)
    .get(written?.id);
  if (!row || row.outcome !== "overturned" || row.validity_event_id !== event.id) {
    return `the recorded row is ${JSON.stringify(row ?? null)}`;
  }
  return null;
});

check("both records are append-only in the substrate, not merely by convention", () => {
  const missing = needFixture();
  if (missing) return missing;
  const outcome = fixture.db.prepare(`SELECT id FROM ${OUTCOME_TABLE} ORDER BY id LIMIT 1`).get();
  const transition = fixture.db.prepare(`SELECT id FROM ${TRANSITION_TABLE} ORDER BY id LIMIT 1`).get();
  if (!outcome || !transition) return "the fixture wrote no row to one of the two records";
  const attempts = [
    [`${OUTCOME_TABLE} UPDATE`, `UPDATE ${OUTCOME_TABLE} SET outcome = 'survived' WHERE id = ${outcome.id}`],
    [`${OUTCOME_TABLE} DELETE`, `DELETE FROM ${OUTCOME_TABLE} WHERE id = ${outcome.id}`],
    [`${TRANSITION_TABLE} UPDATE`, `UPDATE ${TRANSITION_TABLE} SET to_status = 'mapped' WHERE id = ${transition.id}`],
    [`${TRANSITION_TABLE} DELETE`, `DELETE FROM ${TRANSITION_TABLE} WHERE id = ${transition.id}`],
  ];
  for (const [label, sql] of attempts) {
    let refused = false;
    try {
      fixture.db.exec(sql);
    } catch {
      refused = true;
    }
    if (!refused) return `${label} succeeded: the record is not append-only`;
  }
  return null;
});

check("a second outcome for one claim appends rather than replacing the first", () => {
  const missing = needTool("record_claim_challenge");
  if (missing) return missing;
  const unit = subsystemAtAdversarial("B-R6");
  const first = call(
    "record_claim_challenge",
    { claim_id: unit.claimId, outcome: "survived", challenge: CHALLENGE, ref_sha: fixture.base },
    fixture.ctx,
  );
  const second = call(
    "record_claim_challenge",
    {
      claim_id: unit.claimId,
      outcome: "survived",
      challenge: `${CHALLENGE} A second pass read the same sites again and reached the same reading.`,
      ref_sha: fixture.base,
    },
    fixture.ctx,
  );
  const rows = fixture.db
    .prepare(`SELECT id FROM ${OUTCOME_TABLE} WHERE claim_id = ? ORDER BY id`)
    .all(unit.claimId);
  if (rows.length !== 2) return `two recorded outcomes left ${rows.length} row(s) on the claim`;
  if (rows[0].id !== first.id || rows[1].id !== second.id) {
    return "the second outcome did not append after the first";
  }
  return null;
});

// The behavioural arm is finished with its store; everything below reads
// committed files.
try {
  fixture?.db?.close?.();
} catch {
  /* the fixture store is disposable */
}
for (const dir of roots) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a leftover temp dir is not a finding */
  }
}

// ---------------------------------------------------------------------------
// 3. The committed receipts read those records rather than reconstructing them.
// ---------------------------------------------------------------------------
emit("");
emit("the regenerated receipts, read against the records they are built from");

const { text: depthText, value: depth } = readJson(DEPTH_REL);
const { text: coverageText, value: coverage } = readJson(COVERAGE_REL);

function requireDepth() {
  if (depthText === null) return `${DEPTH_REL} is absent, so no ladder and no challenge outcome is recorded`;
  if (depth === null) return `${DEPTH_REL} is not valid JSON`;
  return null;
}

function requireCoverage() {
  if (coverageText === null) return `${COVERAGE_REL} is absent, so no edge denominator is recorded`;
  if (coverage === null) return `${COVERAGE_REL} is not valid JSON`;
  return null;
}

const depthRows = () => (Array.isArray(depth?.subsystems) ? depth.subsystems : []);
const mappedRows = () => depthRows().filter((row) => row?.status === "mapped");

check("the depth recorder reads the two record tables and hardcodes no writer", () => {
  const source = readText(DEPTH_RECORDER_REL);
  if (source === null) return `${DEPTH_RECORDER_REL} is absent`;
  for (const table of [TRANSITION_TABLE, OUTCOME_TABLE]) {
    if (!source.includes(table)) {
      return `${DEPTH_RECORDER_REL} never reads ${table}, so what it writes is a synthesized ladder rung, not a record`;
    }
  }
  // The exact shape slice-S6 F6 found: `tool: "update_subsystem_status"` typed
  // into the recorder rather than read off the row that wrote the rung.
  if (/tool:\s*["'`]update_subsystem_status["'`]/.test(source)) {
    return `${DEPTH_RECORDER_REL} still hardcodes its writing tool, so every rung is a synthesized ladder rung`;
  }
  return null;
});

check("every ladder rung names the record that witnesses it", () => {
  const missing = requireDepth();
  if (missing) return missing;
  const rows = mappedRows();
  if (rows.length < 3) return `the depth receipt records ${rows.length} mapped subsystem(s); the ladder denominator is not credible`;
  const history = new Set(
    (Array.isArray(depth?.storage_history) ? depth.storage_history : []).map((entry) => entry?.sha),
  );
  for (const row of rows) {
    const ladder = Array.isArray(row?.status_ladder) ? row.status_ladder : [];
    if (!ladder.length) return `${row.id} records no status ladder at all`;
    for (const rung of ladder) {
      const source = rung?.source;
      if (!LADDER_SOURCES.includes(source)) {
        return `${row.id}'s rung to ${JSON.stringify(rung?.to ?? null)} declares source ${JSON.stringify(source ?? null)}: a synthesized ladder rung names no record`;
      }
      if (source === "subsystem_status_transitions") {
        if (!Number.isInteger(rung?.transition_id)) {
          return `${row.id}'s rung to ${JSON.stringify(rung?.to ?? null)} claims the transition record and names no row in it`;
        }
        if (!STATUS_WRITERS.includes(rung?.tool)) {
          return `${row.id}'s recorded rung names writer ${JSON.stringify(rung?.tool ?? null)}`;
        }
        if (!nonEmpty(rung?.session_id)) return `${row.id}'s recorded rung is attributed to no session`;
      } else {
        if (!isHex(rung?.storage_commit, 7, 40)) {
          return `${row.id}'s rung to ${JSON.stringify(rung?.to ?? null)} witnesses itself with ${JSON.stringify(rung?.storage_commit ?? null)}`;
        }
        if (!history.has(rung.storage_commit)) {
          return `${row.id}'s rung cites storage commit ${rung.storage_commit}, which the receipt's own storage history does not carry`;
        }
        // A checkpoint rung must say what it could not recover, rather than
        // quietly presenting a null as a recorded value.
        if (rung.tool !== null || rung.session_id !== null) {
          return `${row.id}'s checkpoint rung reports a tool or session the checkpoint cannot witness`;
        }
      }
    }
  }
  return null;
});

check("every claim target's outcome is backed by a challenge outcome row", () => {
  const missing = requireDepth();
  if (missing) return missing;
  let targets = 0;
  for (const row of mappedRows()) {
    const list = Array.isArray(row?.adversarial?.claim_targets) ? row.adversarial.claim_targets : [];
    if (!list.length) return `${row.id} is mapped and records no claim target: mapped without a challenged account`;
    for (const target of list) {
      targets += 1;
      if (!CLAIM_OUTCOMES.includes(target?.outcome)) {
        return `claim ${target?.claim_key} records outcome ${JSON.stringify(target?.outcome ?? null)}`;
      }
      if (!/^claim-challenge-outcome:\d+$/.test(String(target?.record ?? ""))) {
        return `claim ${target?.claim_key} carries no challenge outcome row: its record is ${JSON.stringify(target?.record ?? null)}`;
      }
      if (!nonEmpty(target?.challenge)) {
        return `claim ${target?.claim_key} records no challenge, so nothing says what was looked for`;
      }
      if (target.outcome !== "survived" && !/^claim-validity-event:\d+$/.test(String(target?.validity_event ?? ""))) {
        return `claim ${target?.claim_key} was ${target.outcome} and names no claim validity event`;
      }
    }
  }
  if (targets < 20) return `the depth receipt records ${targets} claim target(s) across every mapped subsystem`;
  return null;
});

// ---------------------------------------------------------------------------
// 4. The edges `index.ts` makes visible, re-derived from the tracked source.
// ---------------------------------------------------------------------------
emit("");
emit("the cross-subsystem edges the server's own registry makes visible");

/** Every relative module `mcp-server/src/index.ts` imports, as a repo path. */
function registryImports() {
  const source = readText(INDEX_REL);
  if (source === null) return null;
  const found = new Set();
  const pattern = /^\s*import\s[^;]*?from\s+"(\.\/[^"]+)"/gm;
  let match = pattern.exec(source);
  while (match !== null) {
    const spec = String(match[1]).replace(/^\.\//, "").replace(/\.js$/, "");
    found.add(`mcp-server/src/${spec}.ts`);
    match = pattern.exec(source);
  }
  return [...found].sort();
}

const ownershipOf = () =>
  coverage && typeof coverage.registry_ownership === "object" && coverage.registry_ownership !== null
    ? coverage.registry_ownership
    : null;

check("the coverage receipt records who owns each module the registry imports", () => {
  const missing = requireCoverage();
  if (missing) return missing;
  const imports = registryImports();
  if (imports === null) return `${INDEX_REL} is absent, so the registry's imports cannot be re-derived`;
  if (imports.length < 30) return `${INDEX_REL} yielded ${imports.length} relative imports; the denominator is not credible`;
  const ownership = ownershipOf();
  if (ownership === null) return "the coverage receipt records no registry_ownership, so no import has a known owner";
  const unrecorded = imports.filter((path) => !(path in ownership));
  if (unrecorded.length) {
    return `module(s) ${unrecorded.slice(0, 3).join(", ")} are imported by the registry and absent from registry_ownership`;
  }
  // The registry module itself is a key, because its own owner is the `from`
  // side of every crossing; everything else must be something it imports.
  if (!(INDEX_REL in ownership)) return `registry_ownership does not record who owns ${INDEX_REL}`;
  const stale = Object.keys(ownership).filter((path) => path !== INDEX_REL && !imports.includes(path));
  if (stale.length) {
    return `registry_ownership names ${stale.slice(0, 3).join(", ")}, which ${INDEX_REL} does not import`;
  }
  const owners = new Set(Object.values(ownership).flatMap((value) => (Array.isArray(value) ? value : [])));
  if (owners.size < 5) {
    return `registry_ownership resolves ${owners.size} owning subsystem(s); a denominator that names one subsystem cannot show a missing edge`;
  }
  return null;
});

check("every cross-subsystem import the registry makes has a recorded edge", () => {
  const missing = requireCoverage();
  if (missing) return missing;
  const ownership = ownershipOf();
  if (ownership === null) return "the coverage receipt records no registry_ownership";
  const importerOwners = ownership[INDEX_REL];
  if (!Array.isArray(importerOwners) || !importerOwners.length) {
    return `${INDEX_REL} is owned by no subsystem in the receipt, so its imports cross nothing`;
  }
  const edges = new Set(
    (Array.isArray(coverage?.xrefs) ? coverage.xrefs : []).map((edge) => `${edge?.from_id}→${edge?.to_id}`),
  );
  const crossings = new Set();
  for (const [path, owners] of Object.entries(ownership)) {
    if (path === INDEX_REL || !Array.isArray(owners)) continue;
    for (const importer of importerOwners) {
      for (const owner of owners) {
        if (owner !== importer) crossings.add(`${importer}→${owner}`);
      }
    }
  }
  if (!crossings.size) return "the registry's imports resolve to no crossing at all";
  const uncovered = [...crossings].filter((pair) => !edges.has(pair));
  if (uncovered.length) {
    return `the registry imports across ${uncovered.join(", ")} with no recorded edge: a missing edge in the topology`;
  }
  // The receipt must also declare the denominator it was counted against, so a
  // shrinking numerator cannot take its denominator with it (GP24).
  const declared = Array.isArray(coverage?.registry_crossings) ? coverage.registry_crossings : null;
  if (declared === null) return "the coverage receipt declares no registry_crossings denominator";
  const declaredPairs = new Set(declared.map((entry) => `${entry?.from_id}→${entry?.to_id}`));
  const dropped = [...crossings].filter((pair) => !declaredPairs.has(pair));
  if (dropped.length) {
    return `crossing(s) ${dropped.join(", ")} are visible in ${INDEX_REL} and absent from the declared denominator`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// 5. The project's canonical name, and the titles that carry it.
// ---------------------------------------------------------------------------
emit("");
emit("the project's canonical name, taken from binding metadata and never from a directory");

/** The name binding metadata carries: the last segment of the project key. */
function boundName() {
  const key = coverage?.project_key;
  if (typeof key !== "string" || !key.trim()) return null;
  const segments = key
    .trim()
    .split("/")
    .filter((segment) => segment.length > 0);
  return segments.length ? segments[segments.length - 1] : null;
}

/** The two directory names the identity must never be taken from. */
function forbiddenNames() {
  const names = new Set();
  for (const value of [coverage?.workspace_path, coverage?.storage_path, depth?.workspace_path, depth?.storage_path]) {
    if (typeof value === "string" && value.trim()) names.add(basename(value.trim()));
  }
  return names;
}

check("the coverage receipt records a canonical name derived from the binding, not a directory", () => {
  const missing = requireCoverage();
  if (missing) return missing;
  const recorded = coverage?.project_name;
  if (!nonEmpty(recorded)) {
    return "the coverage receipt records no project name, so the projection has nothing but a directory to fall back on";
  }
  const bound = boundName();
  if (bound === null) return "the coverage receipt records no project_key to derive a name from";
  if (recorded !== bound) {
    return `the recorded project name is ${JSON.stringify(recorded)}; its binding metadata carries ${JSON.stringify(bound)}`;
  }
  const forbidden = forbiddenNames();
  if (forbidden.has(recorded) && recorded !== bound) {
    return `the project name is the worktree basename ${JSON.stringify(recorded)}`;
  }
  if (!nonEmpty(coverage?.project_name_source)) {
    return "the coverage receipt does not say where the project name came from";
  }
  return null;
});

check("the promoted docs/ take their identity from that name and not from the worktree basename", () => {
  const missing = requireCoverage();
  if (missing) return missing;
  const bound = boundName();
  if (bound === null) return "the coverage receipt records no project_key to derive a name from";
  const index = readText(DOCS_INDEX_REL);
  if (index === null) return `${DOCS_INDEX_REL} is absent, so nothing was promoted to check`;
  const heading = index.split("\n").find((line) => line.startsWith("# "));
  if (!nonEmpty(heading)) return `${DOCS_INDEX_REL} carries no top-level heading`;
  const title = heading.replace(/^#\s+/, "").trim();
  const forbidden = forbiddenNames();
  for (const name of forbidden) {
    if (name !== bound && title.includes(name)) {
      return `the overview is titled ${JSON.stringify(title)}, which carries the worktree basename ${JSON.stringify(name)}`;
    }
  }
  if (!title.includes(bound)) {
    return `the overview is titled ${JSON.stringify(title)} and does not carry the project name ${JSON.stringify(bound)}`;
  }
  const html = readText("docs/index.html");
  if (html === null) return "docs/index.html is absent, so no page title could be read";
  const tag = /<title>([^<]*)<\/title>/.exec(html);
  if (!tag) return "docs/index.html carries no title element";
  for (const name of forbidden) {
    if (name !== bound && tag[1].includes(name)) {
      return `the page title is ${JSON.stringify(tag[1])}, which carries the worktree basename ${JSON.stringify(name)}`;
    }
  }
  if (!tag[1].includes(bound)) {
    return `the page title is ${JSON.stringify(tag[1])} and does not carry the project name ${JSON.stringify(bound)}`;
  }
  return null;
});

check("the renderer never falls back to a directory for the project name", () => {
  const source = readText(RENDERERS_REL);
  if (source === null) return `${RENDERERS_REL} is absent`;
  const start = source.indexOf("def project_name(");
  if (start < 0) return `${RENDERERS_REL} declares no project_name`;
  const end = source.indexOf("\ndef ", start + 1);
  const body = source.slice(start, end < 0 ? source.length : end);
  if (/resolve_workspace\([^)]*\)\.name|storage\.name|\.parent\.name/.test(body)) {
    return "project_name still derives the project name from a directory, so a worktree basename becomes the identity";
  }
  // Exercised, not merely read: a storage directory whose own basename is
  // distinctive must not become the answer.
  const root = mkdtempSync(join(tmpdir(), "amanuensis-p20-name-"));
  try {
    const storage = join(root, "some-worktree-basename", ".amanuensis");
    mkdirSync(storage, { recursive: true });
    writeFileSync(
      join(storage, "initialization.json"),
      `${JSON.stringify({ projectIdentity: "remote:github.com/example/widget-store", projectKey: "github.com/example/widget-store" })}\n`,
    );
    writeFileSync(join(storage, "workspace_path"), `${join(root, "some-worktree-basename")}\n`);
    const probe = spawnSync(
      "python3",
      [
        "-c",
        [
          "import sys",
          `sys.path.insert(0, ${JSON.stringify(join(REPO, "materializer"))})`,
          "from pathlib import Path",
          "from amanuensis_materializer import renderers",
          `print(renderers.project_name(Path(${JSON.stringify(storage)})))`,
        ].join("\n"),
      ],
      { encoding: "utf8", cwd: REPO },
    );
    if (probe.status !== 0) {
      return `project_name could not be exercised — ${String(probe.stderr ?? "").trim().split("\n").slice(-1)[0]}`;
    }
    const answer = String(probe.stdout ?? "").trim();
    if (answer === "some-worktree-basename" || answer === ".amanuensis") {
      return `project_name answered ${JSON.stringify(answer)}: the identity is the worktree basename`;
    }
    if (answer !== "widget-store") {
      return `project_name answered ${JSON.stringify(answer)} for a store bound to github.com/example/widget-store`;
    }
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* a leftover temp dir is not a finding */
    }
  }
  return null;
});

check("the dogfood receipt was regenerated alongside the docs it certifies", () => {
  const { text, value } = readJson(DOGFOOD_REL);
  if (text === null) return `${DOGFOOD_REL} is absent`;
  if (value === null) return `${DOGFOOD_REL} is not valid JSON`;
  const missing = requireDepth() ?? requireCoverage();
  if (missing) return missing;
  const shas = new Set([value?.store?.last_checked_sha, depth?.store?.last_checked_sha]);
  if (shas.size !== 1 || !isHex(value?.store?.last_checked_sha, 40, 40)) {
    return `the dogfood receipt reads the store at ${JSON.stringify(value?.store?.last_checked_sha ?? null)} and the depth receipt at ${JSON.stringify(depth?.store?.last_checked_sha ?? null)}`;
  }
  if (!isHex(value?.repository_sha, 7, 40)) {
    return "the dogfood receipt binds itself to no repository revision";
  }
  return null;
});

// ---------------------------------------------------------------------------
// 6. The live store, wherever one exists.
// ---------------------------------------------------------------------------
const storePath = join(REPO, STORE_REL);
if (existsSync(storePath)) {
  emit("");
  emit("the live store, read read-only");
  let live = null;
  let liveError = null;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(storePath, { readOnly: true });
    const all = (sql, ...params) => db.prepare(sql).all(...params);
    live = {
      subsystems: all("SELECT id, status FROM subsystems"),
      claims: all("SELECT claim_id, claim_key FROM claims WHERE valid_until_sha IS NULL"),
      outcomes: all(`SELECT id, claim_id, claim_key, outcome, challenge FROM ${OUTCOME_TABLE}`),
      xrefs: all("SELECT from_id, to_id FROM xrefs"),
      ledger: all("SELECT subsystem_id, file_path FROM file_ledger"),
    };
    db.close();
  } catch (e) {
    liveError = e && e.message ? e.message : String(e);
  }

  check("every current claim in a mapped subsystem carries a durable challenge outcome", () => {
    if (!live) return `the live store could not be read — ${liveError}`;
    const mapped = new Set(live.subsystems.filter((row) => row.status === "mapped").map((row) => row.id));
    const byClaim = new Set(live.outcomes.map((row) => row.claim_id));
    for (const claim of live.claims) {
      const sid = String(claim.claim_key).split("/")[0];
      if (!mapped.has(sid)) continue;
      if (!byClaim.has(claim.claim_id)) {
        return `live claim ${claim.claim_key} is current in a mapped subsystem with no challenge outcome recorded against it`;
      }
    }
    if (!live.outcomes.length) return "the live store holds no challenge outcome at all";
    const thin = live.outcomes.filter((row) => String(row.challenge ?? "").trim().length < 24);
    if (thin.length) return `${thin.length} live outcome(s) record a challenge with no substance`;
    return null;
  });

  check("the receipt's registry ownership is what the live file ledger says", () => {
    if (!live) return `the live store could not be read — ${liveError}`;
    const missing = requireCoverage();
    if (missing) return missing;
    const ownership = ownershipOf();
    if (ownership === null) return "the coverage receipt records no registry_ownership";
    const byPath = new Map();
    for (const row of live.ledger) {
      if (!byPath.has(row.file_path)) byPath.set(row.file_path, new Set());
      byPath.get(row.file_path).add(row.subsystem_id);
    }
    for (const [path, owners] of Object.entries(ownership)) {
      const liveOwners = [...(byPath.get(path) ?? [])].sort();
      const recorded = [...(Array.isArray(owners) ? owners : [])].sort();
      if (liveOwners.join(",") !== recorded.join(",")) {
        return `${path} is owned by [${liveOwners.join(", ")}] in the live ledger and [${recorded.join(", ")}] in the receipt`;
      }
    }
    return null;
  });

  check("every crossing the live registry makes has a live edge", () => {
    if (!live) return `the live store could not be read — ${liveError}`;
    const imports = registryImports();
    if (imports === null) return `${INDEX_REL} is absent`;
    const byPath = new Map();
    for (const row of live.ledger) {
      if (!byPath.has(row.file_path)) byPath.set(row.file_path, new Set());
      byPath.get(row.file_path).add(row.subsystem_id);
    }
    const importerOwners = [...(byPath.get(INDEX_REL) ?? [])];
    if (!importerOwners.length) return `${INDEX_REL} is in no subsystem's ledger`;
    const edges = new Set(live.xrefs.map((edge) => `${edge.from_id}→${edge.to_id}`));
    const uncovered = [];
    for (const path of imports) {
      for (const owner of byPath.get(path) ?? []) {
        for (const importer of importerOwners) {
          if (owner !== importer && !edges.has(`${importer}→${owner}`)) uncovered.push(`${importer}→${owner}`);
        }
      }
    }
    if (uncovered.length) {
      return `the live store has a missing edge for ${[...new Set(uncovered)].join(", ")}`;
    }
    return null;
  });
}

emit("");
check("the gate runs in CI", () => {
  const ci = readText(CI_REL);
  if (ci === null) return `${CI_REL} is absent`;
  return ci.includes(GATE_COMMAND) ? null : "the gate is not run in CI";
});

emit("");
if (failures.length) {
  emit(
    `GATE P20 RED: the regeneration pass did not land — ${failures.length} failed assertion(s) over the challenge-outcome record (a current claim with no challenge outcome, or a subsystem reaching mapped without one), the recorded status ladder (a synthesized ladder rung in place of a recorded transition), the registry's cross-subsystem edges (a missing edge), and the project name (an identity taken from the worktree basename); first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("GATE P20 GREEN");
