#!/usr/bin/env node
// Gate for reader-lenses packet P12 — Phase 2 writes structural claims, and
// the status gate that requires one (spec.md §9.1; claims C42, C43, C55, C63).
//
// Turns red when:
//   - a subsystem with a populated file ledger and no current claim under its
//     own `<sid>/` prefix is advanced to `structural` without refusal, or the
//     refusal does not name what is missing (the subsystem, `claim_key`, the
//     `<sid>/` prefix, and `add_claim`);
//   - the rule is not reachable through `enforcePhasePrerequisites` itself, so
//     a second status writer could bypass it;
//   - the scoping prerequisite stops firing first: a subsystem with neither a
//     ledger row nor a claim must still be refused for the empty ledger, and a
//     phase skip (scoping → concerns) must be blocked at `structural`;
//   - one claim is not sufficient — a single `<sid>/concurrency` claim must
//     admit the advance, because a per-category quota over a generative field
//     invites fabrication to order (BP4, GP8's v2 scope note);
//   - an explicit negative claim (`<sid>/state-container`, subject the
//     subsystem, statement that the category is empty) is refused;
//   - another subsystem's claim satisfies the gate — including the two shapes
//     a `LIKE '<sid>/%'` predicate would wrongly admit, an id carrying `_` and
//     an id carrying `%`;
//   - a claim whose validity interval has been closed still satisfies the
//     gate, so a superseded reading would keep a subsystem at `structural`;
//   - a no-op write of the same status, or a `deferred` toggle, is refused —
//     the rule must bind genuine forward transitions only;
//   - `reset_subsystem` can no longer regress a subsystem to `structural`;
//   - `phase-2-structural.md` does not carry the claim-writing step between
//     the seam-contract step and the file-classification step, or does not
//     document all five claim kinds with their `claim_key` shapes and the
//     evidence each requires;
//   - `phase-4-adversarial.md` does not pull every current `<sid>/` claim as a
//     target, or does not record each challenge outcome before `mapped`;
//   - the three fixtures that advance a subsystem to `structural` against a
//     commit-less workspace are not seeded with a commit, an evidence row and
//     a claim;
//   - the gate does not run in CI.
//
// False greens it cannot exclude. It says nothing about claim *truth* — that is
// the adversarial pass's obligation, and §9.5's subject, not a property any
// write path can check. It cannot tell a Phase 2 that writes five honest claims
// from one that writes a single throwaway to clear the gate; §9.1 accepts that
// deliberately, and the adversarial pass is what makes the single claim
// expensive to fake. The three seeded fixtures are asserted here at the source
// level only — that each one commits, records evidence, and calls `add_claim`;
// whether they still pass is established by running them, which the packet's
// regression list does. And the two reference documents are asserted on the
// instructions they carry, not on whether an agent follows them.
//
// Output protocol: exactly one status line, last, on stdout. Every message is
// scrubbed, so a missing deliverable reports as an assertion failure rather
// than as a crash.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const MCP = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(MCP, "..");

const PHASE_2_REL = ".claude/skills/amanuensis/references/phase-2-structural.md";
const PHASE_4_REL = ".claude/skills/amanuensis/references/phase-4-adversarial.md";
const CI_REL = ".github/workflows/test.yml";

// The three fixtures §9.1's prerequisite breaks: each advances a subsystem to
// `structural`, and two of them do it in a workspace `git init` left with no
// commit at all, where `add_claim` cannot resolve a `ref_sha`.
const SEEDED_FIXTURES = ["test-perf-ceilings.mjs", "test-perf-tier2.mjs", "test-cloud-e2e.mjs"];

// §9.1's five structural categories, as the `claim_key` segment naming each.
const CLAIM_KIND_SEGMENTS = ["key-type", "state-container", "flow", "concurrency", "seam"];

// §9.1's two accepted evidence kinds for the three file-anchored categories.
const FILE_ANCHORED_EVIDENCE = ["code-verified", "contract-stated"];

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

// ---------------------------------------------------------------------------
// Deliverables, loaded defensively. `dist/` is a build artifact, so compile
// first and let a compile failure poison the fixture rather than certify bytes
// that are not under review (slice-S2, F1–F3/codex).
// ---------------------------------------------------------------------------
const built = ensureBuilt();

let mods = null;
let loadError = null;
try {
  const [db, project, invariants, subsystems, files, artifacts, claims, evidence, projectTools] =
    await Promise.all([
      import("./dist/db.js"),
      import("./dist/project.js"),
      import("./dist/invariants.js"),
      import("./dist/tools/subsystems.js"),
      import("./dist/tools/files.js"),
      import("./dist/tools/artifacts.js"),
      import("./dist/tools/claims.js"),
      import("./dist/tools/evidence.js"),
      import("./dist/tools/project.js"),
    ]);
  mods = { db, project, invariants, subsystems, files, artifacts, claims, evidence, projectTools };
} catch (e) {
  loadError = e && e.message ? e.message : String(e);
}

function toolNamed(name) {
  const groups = [
    mods?.subsystems?.subsystemTools,
    mods?.files?.fileTools,
    mods?.artifacts?.artifactTools,
    mods?.claims?.claimTools,
    mods?.evidence?.evidenceTools,
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
// Fixture. One workspace with two commits, one store, and a scoped subsystem
// per scenario: the rule is exercised through the real write path, so a check
// installed anywhere but the write path fails here.
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
    ? `the subsystem, claim and evidence tools could not be loaded — ${loadError}`
    : null;

function call(name, args, ctx) {
  const tool = toolNamed(name);
  if (!tool) throw new Error(`${name} is not exported by the built tools`);
  return tool.handler(args, ctx);
}

/** Run a call that is expected to be refused; return the refusal, or null. */
function refusal(name, args, ctx) {
  try {
    call(name, args, ctx);
    return null;
  } catch (e) {
    return e && e.message ? String(e.message) : String(e);
  }
}

function buildFixture() {
  const root = tempRoot("amanuensis-phase2-claims-");
  const workspace = join(root, "workspace");
  const storageRoot = join(root, "storage-root");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  git(workspace, "init", "-q", "-b", "main");
  git(workspace, "config", "user.email", "test@localhost");
  git(workspace, "config", "user.name", "Phase 2 Claims Gate");
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
    selectionSource: "test-phase2-claims-gate",
    serverVersion: "test",
  });
  mods.project.ensureProjectStorage(project, (dbPath) => mods.db.openDatabase(dbPath).close());
  const db = mods.db.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  ctx.sessionId = call("start_session", { intent: "phase-2-claims-gate" }, ctx).session_id;
  return { project, db, ctx, base, head };
}

try {
  if (!fixtureError) fixture = buildFixture();
} catch (e) {
  fixtureError = `the workspace and store could not be prepared — ${e && e.message ? e.message : e}`;
}

function needFixture() {
  return fixture ? null : fixtureError;
}

let evidenceSeq = 0;

/** Record one evidence row against the base commit and return its id. */
function seedEvidence(filePath, kind = "code-verified") {
  evidenceSeq += 1;
  const result = call(
    "add_evidence",
    {
      file_path: filePath,
      symbol: `sym${evidenceSeq}`,
      line_range: "1-4",
      ref_sha: fixture.base,
      kind,
      note: "phase-2 claims gate fixture",
    },
    fixture.ctx,
  );
  return result.id;
}

/** Scope a subsystem so only §9.1's new prerequisite can still refuse it. */
function scopedSubsystem(id) {
  call("upsert_subsystem", { id, name: `Subsystem ${id}`, status: "unmapped" }, fixture.ctx);
  call("update_subsystem_status", { id, status: "scoping" }, fixture.ctx);
  call(
    "add_files_to_scope",
    {
      subsystem_id: id,
      ref_sha: fixture.base,
      files: [
        {
          file_path: `src/${id.replace(/[^A-Za-z0-9._-]/g, "-")}.ts`,
          why_in_scope: "gate fixture",
        },
      ],
    },
    fixture.ctx,
  );
}

let claimSeq = 0;

/**
 * Write one claim through `add_claim` so P11's substrate checks are exercised
 * on the way in — a fixture that inserted rows directly could seed a claim the
 * real Phase 2 could never write.
 */
function seedClaim({ claimKey, subjectType, subjectId, statement, evidenceId, epistemicKind }) {
  claimSeq += 1;
  const claimId = `CL-${String(claimSeq).padStart(3, "0")}`;
  call(
    "add_claim",
    {
      claim_id: claimId,
      claim_key: claimKey,
      subject_type: subjectType,
      subject_id: subjectId,
      statement,
      epistemic_kind: epistemicKind ?? "observation",
      ref_sha: fixture.base,
      evidence_ids: [evidenceId],
    },
    fixture.ctx,
  );
  return claimId;
}

function statusOf(id) {
  const row = fixture.db.prepare("SELECT status FROM subsystems WHERE id = ?").get(id);
  return row ? row.status : null;
}

// ---------------------------------------------------------------------------
// §9.1's prerequisite: at least one current claim under the subsystem's prefix
// ---------------------------------------------------------------------------

check("advancing to structural with no claim is refused, naming what is missing", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  scopedSubsystem("B-01");
  const message = refusal(
    "update_subsystem_status",
    { id: "B-01", status: "structural" },
    fixture.ctx,
  );
  if (message === null) {
    return "a subsystem with a populated ledger and no claim advanced to structural";
  }
  const missing = [
    ["the subsystem id", message.includes("B-01")],
    ["the word structural", /structural/.test(message)],
    ["the field claim_key", message.includes("claim_key")],
    ["the required prefix B-01/", message.includes("B-01/")],
    ["the tool that records one, add_claim", message.includes("add_claim")],
  ]
    .filter(([, present]) => !present)
    .map(([name]) => name);
  if (missing.length) {
    return `the refusal does not name ${missing.join(", ")} — it reads: ${message}`;
  }
  return statusOf("B-01") === "scoping"
    ? null
    : `the refusal did not hold the write back: B-01 is now '${statusOf("B-01")}'`;
});

check("the rule is enforced by enforcePhasePrerequisites, not only by the tool", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const enforce = mods?.invariants?.enforcePhasePrerequisites;
  if (typeof enforce !== "function") {
    return "invariants.js does not export enforcePhasePrerequisites";
  }
  let message = null;
  try {
    enforce(fixture.db, "B-01", "structural");
  } catch (e) {
    message = e && e.message ? String(e.message) : String(e);
  }
  if (message === null) {
    return "enforcePhasePrerequisites accepts a claimless subsystem, so the rule lives in the tool and any second status writer bypasses it";
  }
  return message.includes("claim_key")
    ? null
    : `enforcePhasePrerequisites refused for some other reason: ${message}`;
});

check("the scoping prerequisite still fires first when the ledger is empty too", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  call("upsert_subsystem", { id: "B-02", name: "Unscoped", status: "unmapped" }, fixture.ctx);
  call("update_subsystem_status", { id: "B-02", status: "scoping" }, fixture.ctx);
  const message = refusal(
    "update_subsystem_status",
    { id: "B-02", status: "structural" },
    fixture.ctx,
  );
  if (message === null) return "a subsystem with an empty file ledger advanced to structural";
  return message.includes("file ledger is empty")
    ? null
    : `the empty-ledger refusal was replaced rather than kept: ${message}`;
});

check("a phase skip is still blocked at structural, now for the claim as well", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  scopedSubsystem("B-03");
  const message = refusal(
    "update_subsystem_status",
    { id: "B-03", status: "concerns" },
    fixture.ctx,
  );
  if (message === null) return "scoping jumped straight to concerns with no claim recorded";
  if (!message.includes("claim_key")) {
    return `the skip was blocked for some other reason, so the intermediate structural check did not run: ${message}`;
  }
  return statusOf("B-03") === "scoping"
    ? null
    : `the refusal did not hold the write back: B-03 is now '${statusOf("B-03")}'`;
});

check("one claim is sufficient — no per-category quota", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  scopedSubsystem("B-04");
  // A single concurrency claim: none of the other four categories is present,
  // so a quota over the five would refuse this advance.
  seedClaim({
    claimKey: "B-04/concurrency",
    subjectType: "subsystem",
    subjectId: "B-04",
    statement: "B-04 runs on one event loop; no state crosses a thread boundary.",
    epistemicKind: "inference",
    evidenceId: seedEvidence("src/B-04.ts", "doc-asserted"),
  });
  const message = refusal(
    "update_subsystem_status",
    { id: "B-04", status: "structural" },
    fixture.ctx,
  );
  if (message !== null) return `one claim was refused: ${message}`;
  return statusOf("B-04") === "structural"
    ? null
    : `the advance did not take: B-04 is '${statusOf("B-04")}'`;
});

check("an explicit negative claim satisfies the gate", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  scopedSubsystem("B-05");
  seedClaim({
    claimKey: "B-05/state-container",
    subjectType: "subsystem",
    subjectId: "B-05",
    statement:
      "B-05 holds no mutable state container: every value it computes is returned, not retained.",
    evidenceId: seedEvidence("src/B-05.ts"),
  });
  const message = refusal(
    "update_subsystem_status",
    { id: "B-05", status: "structural" },
    fixture.ctx,
  );
  if (message !== null) return `an explicit negative claim was refused: ${message}`;
  return statusOf("B-05") === "structural"
    ? null
    : `the advance did not take: B-05 is '${statusOf("B-05")}'`;
});

check("a file-anchored claim also satisfies the gate", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  scopedSubsystem("B-06");
  seedClaim({
    claimKey: "B-06/key-type/record",
    subjectType: "symbol",
    subjectId: "src/B-06.ts:Record",
    statement: "Record is the unit B-06 stores and returns.",
    evidenceId: seedEvidence("src/B-06.ts", "contract-stated"),
  });
  const message = refusal(
    "update_subsystem_status",
    { id: "B-06", status: "structural" },
    fixture.ctx,
  );
  if (message !== null) return `a key-type claim was refused: ${message}`;
  return statusOf("B-06") === "structural"
    ? null
    : `the advance did not take: B-06 is '${statusOf("B-06")}'`;
});

check("another subsystem's claim does not satisfy the gate", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  scopedSubsystem("B-07");
  // B-04, B-05 and B-06 all carry claims by now; B-07 carries none.
  const message = refusal(
    "update_subsystem_status",
    { id: "B-07", status: "structural" },
    fixture.ctx,
  );
  return message === null
    ? "a claim recorded under another subsystem's prefix admitted B-07 to structural"
    : null;
});

check("the prefix is matched literally, not as a LIKE pattern", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  // `_` and `%` are SQL LIKE wildcards. An unescaped `claim_key LIKE '<sid>/%'`
  // would let B-08's claim admit `B_08`, and any claim at all admit `B%`.
  scopedSubsystem("B-08");
  seedClaim({
    claimKey: "B-08/key-type/token",
    subjectType: "symbol",
    subjectId: "src/B-08.ts:Token",
    statement: "Token is the unit B-08 parses.",
    evidenceId: seedEvidence("src/B-08.ts"),
  });
  const wrong = [];
  for (const id of ["B_08", "B%"]) {
    scopedSubsystem(id);
    const message = refusal("update_subsystem_status", { id, status: "structural" }, fixture.ctx);
    if (message === null) {
      wrong.push(`${id} advanced on a claim belonging to B-08`);
    } else if (!message.includes("claim_key")) {
      wrong.push(`${id} was refused, but for some other reason: ${message}`);
    }
  }
  return wrong.length
    ? `${wrong.join("; ")} — the prefix is read as a LIKE pattern rather than a literal`
    : null;
});

check("a claim whose validity interval was closed no longer satisfies the gate", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  scopedSubsystem("B-09");
  const claimId = seedClaim({
    claimKey: "B-09/flow/ingest/01",
    subjectType: "symbol",
    subjectId: "src/B-09.ts:ingest",
    statement: "ingest is the first step of B-09's primary flow.",
    evidenceId: seedEvidence("src/B-09.ts"),
  });
  const contradicting = call(
    "add_evidence",
    {
      file_path: "src/B-09.ts",
      symbol: "ingest",
      line_range: "1-4",
      ref_sha: fixture.head,
      kind: "code-verified",
      note: "the step was removed",
    },
    fixture.ctx,
  ).id;
  call(
    "invalidate_claim",
    {
      claim_id: claimId,
      at_sha: fixture.head,
      reason: "the ingest step was removed at head",
      evidence_ids: [contradicting],
    },
    fixture.ctx,
  );
  const message = refusal(
    "update_subsystem_status",
    { id: "B-09", status: "structural" },
    fixture.ctx,
  );
  return message === null
    ? "a claim closed by invalidate_claim still admits its subsystem to structural, so the gate reads history as current authority"
    : null;
});

check("a no-op write and a deferred toggle are exempt", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  scopedSubsystem("B-10");
  // Reached `structural` before the rule existed: the store carries subsystems
  // advanced by earlier runs, and re-writing their status must not re-litigate
  // a prerequisite they were never asked for.
  fixture.db.prepare("UPDATE subsystems SET status = 'structural' WHERE id = ?").run("B-10");
  const noop = refusal(
    "update_subsystem_status",
    { id: "B-10", status: "structural" },
    fixture.ctx,
  );
  if (noop !== null) return `re-writing the same status was refused: ${noop}`;
  const park = refusal("update_subsystem_status", { id: "B-10", status: "deferred" }, fixture.ctx);
  if (park !== null) return `parking a subsystem was refused: ${park}`;
  const unpark = refusal(
    "update_subsystem_status",
    { id: "B-10", status: "structural" },
    fixture.ctx,
  );
  return unpark === null ? null : `unparking a subsystem was refused: ${unpark}`;
});

check("reset_subsystem can still regress a claimless subsystem to structural", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  scopedSubsystem("B-11");
  seedClaim({
    claimKey: "B-11/concurrency",
    subjectType: "subsystem",
    subjectId: "B-11",
    statement: "B-11 is single-threaded.",
    evidenceId: seedEvidence("src/B-11.ts"),
  });
  call("update_subsystem_status", { id: "B-11", status: "structural" }, fixture.ctx);
  call(
    "register_artifact",
    { path: "B-11-survey.md", kind: "subsystem-survey", subsystem_id: "B-11" },
    fixture.ctx,
  );
  call("update_subsystem_status", { id: "B-11", status: "concerns" }, fixture.ctx);
  fixture.db.prepare("DELETE FROM claim_evidence WHERE claim_id LIKE 'CL-%'").run();
  fixture.db.prepare("DELETE FROM claims WHERE claim_key = ?").run("B-11/concurrency");
  const result = call(
    "reset_subsystem",
    { id: "B-11", to_status: "structural", reason: "redo the structural pass" },
    fixture.ctx,
  );
  if (result && result.ok === false) return `reset_subsystem was refused: ${result.error}`;
  return statusOf("B-11") === "structural"
    ? null
    : `reset_subsystem left B-11 at '${statusOf("B-11")}'`;
});

check("upsert_subsystem cannot carry a subsystem to structural without a claim", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  // F3/codex. `upsert_subsystem` writes `status` directly and calls only
  // `enforceMonotonicTransition`, so it is a second forward status writer.
  // C43 binds the *status*, not one tool: a rule that one door honours and
  // another ignores is not enforced. Both doors are exercised — a fresh insert
  // that opens at `structural`, and an update over an already-scoped row.
  scopedSubsystem("B-20");
  const updated = refusal(
    "upsert_subsystem",
    { id: "B-20", name: "Upserted", status: "structural" },
    fixture.ctx,
  );
  if (updated === null) {
    return `upsert_subsystem advanced a claimless B-20 to '${statusOf("B-20")}' without refusal`;
  }
  if (!updated.includes("claim_key")) {
    return `the refusal on the update path does not name claim_key — ${updated}`;
  }
  if (statusOf("B-20") === "structural") return "the refused upsert was written anyway";

  const fresh = refusal(
    "upsert_subsystem",
    { id: "B-21", name: "Fresh at structural", status: "structural" },
    fixture.ctx,
  );
  if (fresh === null) {
    return `upsert_subsystem created B-21 straight at '${statusOf("B-21")}' with no ledger and no claim`;
  }
  return statusOf("B-21") === "structural" ? "the refused insert was written anyway" : null;
});

check("a claim satisfies upsert_subsystem's prerequisite exactly as it does the status tool", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  // The other half of F3/codex: the guard must admit the legitimate advance,
  // or it is a blanket refusal rather than a prerequisite (VP4 — a gate that
  // cannot go green measures nothing either).
  scopedSubsystem("B-22");
  seedClaim({
    claimKey: "B-22/concurrency",
    subjectType: "subsystem",
    subjectId: "B-22",
    statement: "B-22 runs on one thread.",
    evidenceId: seedEvidence("src/B-22.ts"),
  });
  const message = refusal(
    "upsert_subsystem",
    { id: "B-22", name: "Upserted with a claim", status: "structural" },
    fixture.ctx,
  );
  if (message !== null) return `a claimed subsystem was refused anyway — ${message}`;
  return statusOf("B-22") === "structural"
    ? null
    : `B-22 is at '${statusOf("B-22")}' after an accepted upsert`;
});

check("resetting below structural discards the claims that satisfied the gate", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  // F6/codex. `reset_subsystem` discards the survey output of every phase it
  // regresses past — dispositions, findings, artifacts, and the ledger when it
  // drops to `scoping`. Structural claims are that phase's output too, so a
  // reset below `structural` that leaves them current lets the re-advance be
  // satisfied by the reading the reset just discarded, and C43's "requires at
  // least one current claim" stops meaning the phase ran.
  scopedSubsystem("B-23");
  seedClaim({
    claimKey: "B-23/key-type/row",
    subjectType: "symbol",
    subjectId: "src/unit.ts:Row",
    statement: "Row is B-23's unit of storage.",
    evidenceId: seedEvidence("src/unit.ts"),
  });
  call("update_subsystem_status", { id: "B-23", status: "structural" }, fixture.ctx);
  const result = call(
    "reset_subsystem",
    { id: "B-23", to_status: "scoping", reason: "redo the structural pass from scratch" },
    fixture.ctx,
  );
  if (result && result.ok === false) return `reset_subsystem was refused: ${result.error}`;
  const live = fixture.db
    .prepare(
      "SELECT COUNT(*) AS n FROM claims WHERE valid_until_sha IS NULL AND substr(claim_key, 1, 5) = 'B-23/'",
    )
    .get();
  if ((live?.n ?? 0) !== 0) {
    return `${live.n} current B-23/ claim(s) survived a reset to scoping, so the discarded reading still satisfies the gate`;
  }
  if (typeof result?.deleted?.claims !== "number") {
    return "reset_subsystem does not report how many claims it discarded, so the loss is silent";
  }
  const message = refusal(
    "update_subsystem_status",
    { id: "B-23", status: "structural" },
    fixture.ctx,
  );
  if (message === null) {
    return "B-23 re-advanced to structural with no claim recorded since the reset";
  }
  return message.includes("claim_key")
    ? null
    : `the re-advance was refused for some other reason — ${message}`;
});

check("a reset that stops at structural keeps the claims it did not regress past", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  // The bound on F6/codex's fix. `reset_subsystem` to `structural` discards the
  // concerns pass, not the structural one, so its claims must survive — exactly
  // as the file ledger survives a reset that stops above `scoping`. A fix that
  // cleared claims on every reset would break the legitimate re-run.
  scopedSubsystem("B-24");
  seedClaim({
    claimKey: "B-24/concurrency",
    subjectType: "subsystem",
    subjectId: "B-24",
    statement: "B-24 holds no lock.",
    evidenceId: seedEvidence("src/B-24.ts"),
  });
  call("update_subsystem_status", { id: "B-24", status: "structural" }, fixture.ctx);
  call(
    "register_artifact",
    { path: "B-24-survey.md", kind: "subsystem-survey", subsystem_id: "B-24" },
    fixture.ctx,
  );
  call("update_subsystem_status", { id: "B-24", status: "concerns" }, fixture.ctx);
  const result = call(
    "reset_subsystem",
    { id: "B-24", to_status: "structural", reason: "redo the concerns pass only" },
    fixture.ctx,
  );
  if (result && result.ok === false) return `reset_subsystem was refused: ${result.error}`;
  const live = fixture.db
    .prepare(
      "SELECT COUNT(*) AS n FROM claims WHERE valid_until_sha IS NULL AND substr(claim_key, 1, 5) = 'B-24/'",
    )
    .get();
  return (live?.n ?? 0) === 1
    ? null
    : `a reset to structural left ${live?.n ?? 0} current B-24/ claim(s), not the one it never regressed past`;
});

// ---------------------------------------------------------------------------
// §9.1's Phase 2 step and §9.1's Phase 4 obligation
// ---------------------------------------------------------------------------

/** Return the body of the numbered `### N. …` step whose heading matches. */
function stepBody(document, pattern) {
  const sections = document.split(/\n(?=### )/);
  const found = sections.find((section) => pattern.test(section.split("\n")[0] ?? ""));
  return found ?? null;
}

check(
  "phase-2-structural.md records claims between the seam step and the classification step",
  () => {
    const text = readText(join(REPO, PHASE_2_REL));
    if (text === null) return `${PHASE_2_REL} is absent`;
    const headings = [...text.matchAll(/^### (\d+)\. (.+)$/gm)].map((m) => m[2]);
    const seam = headings.findIndex((h) => /seam contract/i.test(h));
    const claims = headings.findIndex((h) => /claim/i.test(h));
    const classification = headings.findIndex((h) => /classification/i.test(h));
    if (claims < 0) return "no numbered step records the structural inventory as claims";
    if (seam < 0 || classification < 0) {
      return "the seam-contract step or the file-classification step is no longer a numbered step, so the new step's position cannot be read";
    }
    if (!(seam < claims && claims < classification)) {
      return `the claim step is at position ${claims + 1}, not between the seam step (${seam + 1}) and the classification step (${classification + 1})`;
    }
    return null;
  },
);

check("phase-2-structural.md documents the five claim kinds and their claim_key shapes", () => {
  const text = readText(join(REPO, PHASE_2_REL));
  if (text === null) return `${PHASE_2_REL} is absent`;
  const body = stepBody(text, /claim/i);
  if (body === null) return "no numbered step records the structural inventory as claims";
  if (!body.includes("add_claim")) return "the claim step never names add_claim";
  const missing = CLAIM_KIND_SEGMENTS.filter((segment) => !body.includes(`<sid>/${segment}`));
  if (missing.length) {
    return `the claim step gives no claim_key shape for ${missing.join(", ")}`;
  }
  const subjects = ["symbol", "subsystem", "seam"].filter((s) => !body.includes(s));
  if (subjects.length) {
    return `the claim step never names the subject_type ${subjects.join(", ")}`;
  }
  return /stable/i.test(body)
    ? null
    : "the claim step does not say claim_key must be stable across re-surveys, so a re-survey would duplicate rather than supersede";
});

check("phase-2-structural.md states the evidence each claim kind requires", () => {
  const text = readText(join(REPO, PHASE_2_REL));
  if (text === null) return `${PHASE_2_REL} is absent`;
  const body = stepBody(text, /claim/i);
  if (body === null) return "no numbered step records the structural inventory as claims";
  const missingKinds = FILE_ANCHORED_EVIDENCE.filter((kind) => !body.includes(kind));
  if (missingKinds.length) {
    return `the claim step never names the evidence kind ${missingKinds.join(", ")} the three file-anchored categories require`;
  }
  if (!/observation/.test(body) || !/inference/.test(body)) {
    return "the claim step does not say which epistemic_kind each category carries";
  }
  return /refus|reject|must cite|cite that|same file/i.test(body)
    ? null
    : "the claim step never says the server refuses a file-anchored claim whose evidence cites another file";
});

check("phase-2-structural.md states the status prerequisite the coordinator must satisfy", () => {
  const text = readText(join(REPO, PHASE_2_REL));
  if (text === null) return `${PHASE_2_REL} is absent`;
  if (!/structural/.test(text)) return "the document never mentions the structural status";
  const prerequisite =
    /at least one|one current claim|no claim/i.test(text) && /`<sid>\/`|<sid>\//.test(text);
  if (!prerequisite) {
    return "the document does not tell the writer that the advance to structural is refused without a current `<sid>/` claim";
  }
  return /negative/i.test(text)
    ? null
    : "the document does not say how to record a category that is genuinely empty, so a writer with no state container has no honest way past the gate";
});

check("phase-4-adversarial.md pulls every current <sid>/ claim as a target", () => {
  const text = readText(join(REPO, PHASE_4_REL));
  if (text === null) return `${PHASE_4_REL} is absent`;
  const body = stepBody(text, /pull the targets/i);
  if (body === null) return "the document has no numbered 'Pull the targets' step";
  if (!body.includes("get_claims")) return "the target list never calls get_claims";
  return /<sid>\/|claim_key/.test(body)
    ? null
    : "the target list does not restrict the claims to the subsystem's own `<sid>/` prefix";
});

check("phase-4-adversarial.md records each claim's challenge outcome before mapped", () => {
  const text = readText(join(REPO, PHASE_4_REL));
  if (text === null) return `${PHASE_4_REL} is absent`;
  if (!text.includes("claim_validity_event")) {
    return "the document never names claim_validity_events as where an overturned claim's outcome is recorded";
  }
  const recordsOutcome = /invalidate_claim|supersede_claim/.test(text);
  if (!recordsOutcome) {
    return "the document names no tool that closes or supersedes a claim the pass overturned";
  }
  const survived = /survive/i.test(text);
  if (!survived) {
    return "the document does not say how a claim that survives the challenge is recorded, so an unchallenged claim is indistinguishable from an upheld one";
  }
  // The clause is prose, and §9.1 puts it here rather than in
  // `enforcePhasePrerequisites` on purpose: `claim_validity_events.event_type`
  // (schema.sql:1060) has no `survived` value, so no query can tell a claim
  // that survived its challenge from one nobody challenged, and a substrate
  // gate would have to refuse the legitimate all-survived result. A prose
  // obligation is what there is to assert — so assert its *direction*, not
  // merely that the word `mapped` appears somewhere in the file. The prior
  // form ended in a bare `|mapped/i`, which the document's own two other
  // mentions satisfied no matter what the clause said.
  const sentences = text
    .replace(/\n+/g, " ")
    .split(/(?<=\.)\s+/)
    .filter((sentence) => /\bmapped\b/.test(sentence) && /claim|outcome/i.test(sentence));
  if (sentences.length === 0) {
    return "no sentence ties a claim's recorded outcome to the advance to mapped";
  }
  // Permission-shaped: the inverted clause says mapping may proceed anyway.
  const permissive = sentences.find((sentence) =>
    /whether or not|need not|optional|not required|may be deferred|without .{0,30}outcome/i.test(
      sentence,
    ),
  );
  if (permissive) {
    return `the document permits mapped without a recorded outcome — "${permissive.trim().slice(0, 120)}"`;
  }
  // Obligation-shaped: the requirement has to be stated as one.
  const obligation = sentences.find((sentence) =>
    /\bmust\b|\bmay not\b|\bcannot\b|\bbefore\b.{0,80}\bmapped\b/i.test(sentence),
  );
  return obligation
    ? null
    : "the document mentions claims and mapped together but never states the outcome as a requirement, so it reads as advice rather than a precondition";
});

// ---------------------------------------------------------------------------
// The fixtures §9.1's prerequisite breaks, and CI
// ---------------------------------------------------------------------------

for (const fixtureName of SEEDED_FIXTURES) {
  check(`${fixtureName} seeds a commit, an evidence row and a claim`, () => {
    const text = readText(join(MCP, fixtureName));
    if (text === null) return `${fixtureName} is absent`;
    const missing = [
      ["a commit in the workspace", /"commit"/.test(text)],
      ["an evidence row", /add_evidence/.test(text)],
      ["a claim", /add_claim/.test(text)],
      ["the claim tools", /claimTools/.test(text)],
      ["the evidence tools", /evidenceTools/.test(text)],
    ]
      .filter(([, present]) => !present)
      .map(([name]) => name);
    return missing.length
      ? `${fixtureName} does not seed ${missing.join(", ")}, so its advance to structural cannot satisfy the claim prerequisite`
      : null;
  });
}

check("this gate runs in CI", () => {
  const ci = readText(join(REPO, CI_REL));
  if (ci === null) return `${CI_REL} is absent`;
  return ci.includes("node test-phase2-claims-gate.mjs") ? null : "the gate is not run in CI";
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
    `GATE P12 RED: Phase 2's structural claims and the claim_key prerequisite on 'structural' do not hold — ${failures.length} assertion(s) failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("");
emit("GATE P12 GREEN");
