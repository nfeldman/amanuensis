#!/usr/bin/env node
// GATE SC12 (design/scope/PLAN.md §3 SC12; §2.6, second table and census) — the
// write guard for evidence attachments, and the census of every argument that
// names a path or carries evidence. A record may not rest on an evidence row
// whose file the survey set excludes: "excluded means not included".
//
// One fixture repository, one store in sorted mode. Three paths are excluded,
// one per source: `design/spec.md` by an owner rule over `design/` (user),
// `notes/log.md` by a meta sorting row over `notes/` (meta), and the
// force-added `build/out.js`, which the repository's own `.gitignore` matches
// (gitignore). `src/core.ts` is in the survey set and is every route's
// positive control. An evidence row exists for each of the four, written before
// the rules (and directly, for the ignored path): the state a store surveyed
// before its rules holds (§2.6a), which is exactly what a later attachment must
// be refused for.
//
// Turns red when:
//   1. any route of §2.6's second table attaches an evidence row on an excluded
//      path, or refuses one without naming the evidence row, the argument that
//      carried it, its path, its source, its rule (the owner rule or sorting row
//      and its pattern; the ignore files for gitignore) and the remedy, "an
//      owner include rule" (A1–A24, one per route, each over all three
//      sources); or the same route refuses, or fails to write, the in-survey
//      control (A0);
//   2. a route refuses an evidence row only when it arrives as `evidence_id`,
//      or only as `evidence_ids`: both argument shapes have a route here;
//   3. the census, built at run time from every registered tool's input
//      schema, finds a tool with one of §2.6's argument names (`file_path`,
//      `location`, `first_seen`, `path`, `paths`, `files`, `primary_files`,
//      `evidence_id`, `evidence_ids`, `new_evidence`, `evidence`, at any
//      depth) that is neither guarded nor exempt with its reason (C1); lists a
//      tool that is not registered (C2); lists a guarded tool this gate has no
//      route for (C3); or does not turn red when a dummy tool with an
//      `evidence_ids` argument is added to its input (C4);
//   4. a tool the second table names is not registered (T1);
//   5. the refusal is not registered in contracts/refusal-parity.json with its
//      sentence in references/records.md (P1);
//   6. this gate is not registered in CI (CI1).
//
// Every fixture is a temporary git repository and a store under a temporary
// AMANUENSIS_STORAGE_ROOT; no git configuration but the fixture's own is read,
// and nothing here reads a real store or the network.
//
//   exit 0  `GATE SC12 GREEN`
//   exit 1  `GATE SC12 RED: <reason>`

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stableClaimKey } from "./fixtures/claim-key.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SUBSYSTEM = "S-01";
const CORE = "src/core.ts";
const SPEC = "design/spec.md";
const LOG = "notes/log.md";
const BUILT = "build/out.js";
const INCLUDE_REMEDY = "an owner include rule";

// A crash signature in this gate's output means the run never reached its
// assertion, so the launcher rejects it as a red proof. Detail quoted from a
// live error is scrubbed rather than trusted.
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
  "Traceback (most recent call last)",
];
function scrub(text) {
  let out = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  for (const signature of CRASH_SIGNATURES) {
    const cut = Math.ceil(signature.length / 2);
    out = out.split(signature).join(`${signature.slice(0, cut)}…${signature.slice(cut)}`);
  }
  return out;
}

const failures = [];
let checked = 0;
async function check(label, fn) {
  checked++;
  try {
    const detail = await fn();
    if (detail) failures.push(`${label}: ${scrub(detail)}`);
  } catch (error) {
    failures.push(`${label}: threw — ${scrub(error?.message ?? error)}`);
  }
}

const show = (value) => JSON.stringify(value);

// ------------------------------------------------------------------ census
// §2.6: every property with one of these names, at any depth of a tool's input
// schema, belongs to a tool the tables list.
const CENSUS_NAMES = new Set([
  "file_path",
  "location",
  "first_seen",
  "path",
  "paths",
  "files",
  "primary_files",
  "evidence_id",
  "evidence_ids",
  "new_evidence",
  "evidence",
]);

/** Where each of a tool's input properties with a census name sits: `a.b[].c`. */
function censusHits(schema) {
  const hits = [];
  const walk = (node, prefix) => {
    if (!node || typeof node !== "object") return;
    for (const [name, child] of Object.entries(node.properties ?? {})) {
      if (CENSUS_NAMES.has(name)) hits.push(`${prefix}${name}`);
      walk(child, `${prefix}${name}.`);
    }
    if (node.items) walk(node.items, `${prefix}[].`);
    for (const key of ["oneOf", "anyOf", "allOf"]) {
      for (const branch of node[key] ?? []) walk(branch, prefix);
    }
  };
  walk(schema, "");
  return hits;
}

/** Tool name → the census-named properties of its input, for tools that have one. */
function census(tools) {
  const found = new Map();
  for (const tool of tools) {
    const hits = censusHits(tool.inputSchema);
    if (hits.length > 0) found.set(tool.name, hits);
  }
  return found;
}

// What the tables list. `first` is §2.6's first table (SC10's gate), `second` the
// second table (this gate), `exempt` a tool whose argument needs no guard, with
// the reason the census table carries.
const LISTED = {
  // first table
  add_files_to_scope: { table: "first" },
  update_file_classification: { table: "first" },
  add_evidence: { table: "first" },
  land_review_pass: { table: "first" },
  define_term: { table: "first" },
  add_field_note: { table: "first" },
  add_finding: { table: "first" },
  carry_finding: { table: "first" },
  log_dispatch: { table: "first" },
  // second table
  clear_staleness: { table: "second" },
  add_claim: { table: "second" },
  invalidate_claim: { table: "second" },
  supersede_claim: { table: "second" },
  attach_evidence_to_disposition: { table: "second" },
  attach_evidence_to_finding: { table: "second" },
  set_disposition: { table: "second" },
  verify_finding_fix: { table: "second" },
  record_explanation: { table: "second" },
  record_narrative: { table: "second" },
  record_runtime_boundary: { table: "second" },
  open_diagnosticity_matrix: { table: "second" },
  record_diagnosticity_verdict: { table: "second" },
  invalidate_decision_revision: { table: "second" },
  resolve_contradiction: { table: "second" },
  record_claim_mark: { table: "second" },
  attach_carried_evidence: { table: "second" },
  capture_chorusmith_parity_snapshot: { table: "second" },
  resolve_crosswalk_identity: { table: "second" },
  // the exception among writes, and the exempt tools
  retire_ledger_file: { table: "exempt", reason: "the one write an excluded path accepts: it clears excluded_with_rows" },
  register_artifact: { table: "exempt", reason: "path names a store artifact, not a source path" },
  rehash_artifact: { table: "exempt", reason: "path names a store artifact, not a source path" },
  get_imported_artifacts: { table: "exempt", reason: "path names a store archive" },
  outline_file: { table: "exempt", reason: "path is a read" },
  read_symbol: { table: "exempt", reason: "path is a read" },
  get_evidence: { table: "exempt", reason: "file_path is a read" },
  get_scope: { table: "exempt", reason: "path is a read" },
  record_scope_sorting: {
    table: "exempt",
    reason: "inventory[].file_path writes only scope_inventory, never evidence, and has to reach excluded prefixes",
  },
  review_evaluation_alternatives: {
    table: "exempt",
    reason: "evidence is free text naming no evidence row and no path",
  },
};

/** The names the census finds that no table lists; the gate is red when it is not empty. */
function unlisted(tools) {
  return [...census(tools).keys()].filter((name) => !(name in LISTED)).sort();
}

// ---------------------------------------------------------------- fixtures

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";

function git(cwd, ...args) {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${result.status}: ${String(result.stderr).trim()}`);
  }
  return String(result.stdout ?? "").trim();
}
function commit(cwd, message) {
  git(
    cwd,
    "-c", "user.email=sc12@localhost",
    "-c", "user.name=scope-sc12",
    "-c", "commit.gpgsign=false",
    "commit", "-q", "--no-verify", "-m", message,
  );
  return git(cwd, "rev-parse", "HEAD");
}

const normalize = (value) => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
};
const contentHash = (value) => createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");

async function main(mods, tools) {
  const { openDatabase, resolveProject, ensureProjectStorage } = mods;
  const allTools = new Map(tools.map((td) => [td.name, td]));
  const call = (name, args, ctx) => {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    return td.handler(args, ctx);
  };

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-sc12-"));
  process.env.AMANUENSIS_STORAGE_ROOT = join(scratch, "storage");
  const ws = join(scratch, "ws");
  const write = (name, body) => {
    mkdirSync(dirname(join(ws, name)), { recursive: true });
    writeFileSync(join(ws, name), body);
  };
  mkdirSync(ws, { recursive: true });
  git(ws, "init", "-q", "--template=");
  write(".gitignore", "build/\n");
  write("README.md", "# Fixture\n");
  write(CORE, "export const value = 1;\n");
  write(SPEC, "# Spec\n\nThe value is one.\n");
  write(LOG, "# Log\n\nRead the code first.\n");
  write(BUILT, "export const built = 1;\n");
  git(ws, "add", "-A");
  git(ws, "add", "-f", BUILT);
  const c0 = commit(ws, "seed");
  write(SPEC, "# Spec\n\nThe value is two.\n");
  git(ws, "add", "-A");
  const c1 = commit(ws, "change the spec");
  write(CORE, "export const value = 2;\n");
  git(ws, "add", "-A");
  const c2 = commit(ws, "change the code");
  write("README.md", "# Fixture\n\nAfter the fix.\n");
  git(ws, "add", "-A");
  const c3 = commit(ws, "after the fix");

  const project = resolveProject(ws, { selectionSource: "sc12" });
  ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
  const ctx = { project, db: openDatabase(project.dbPath), sessionId: null };
  const db = ctx.db;
  try {
    ctx.sessionId = call("start_session", { intent: "sc12 attach guard" }, ctx).session_id;
    call("upsert_subsystem", { id: SUBSYSTEM, name: "Core", status: "unmapped" }, ctx);
    call("update_subsystem_status", { id: SUBSYSTEM, status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      {
        subsystem_id: SUBSYSTEM,
        ref_sha: c0,
        files: [{ file_path: CORE, why_in_scope: "the code", classification: "candidate" }],
      },
      ctx,
    );
    for (const path of [SPEC, LOG, BUILT]) {
      db.prepare(
        `INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha)
         VALUES (?, ?, 'recorded before the exclusion', 'candidate', ?)`,
      ).run(SUBSYSTEM, path, c0);
    }
    db.prepare("UPDATE subsystems SET status = 'adversarial' WHERE id = ?").run(SUBSYSTEM);

    // An evidence row on a path, written directly: the guard rightly refuses a
    // new one on an excluded path, and these predate the rules.
    const mkEvidence = (path, ref = c0, kind = "code-verified") =>
      Number(
        db
          .prepare(
            `INSERT INTO evidence (file_path, symbol, line_range, ref_sha, kind, excerpt, session_id)
             VALUES (?, 'value', '1', ?, ?, 'x', ?)`,
          )
          .run(path, ref, kind, ctx.sessionId).lastInsertRowid,
      );
    const PATHS = [CORE, SPEC, LOG, BUILT];
    const EV = Object.fromEntries(PATHS.map((path) => [path, mkEvidence(path)]));

    let n = 0;
    const fresh = (stem) => `${stem}-${++n}`;
    const newClaim = (evidenceIds = [EV[CORE]]) => {
      const claimId = fresh("SC12-CL");
      call(
        "add_claim",
        {
          claim_id: claimId,
          claim_key: stableClaimKey(SUBSYSTEM, claimId, CORE),
          subject_type: "symbol",
          subject_id: `${CORE}:value${n}`,
          statement: `The fixture's ${CORE} says what the value is (${n}).`,
          epistemic_kind: "observation",
          ref_sha: c0,
          evidence_ids: evidenceIds,
        },
        ctx,
      );
      return claimId;
    };
    const newFinding = (status = "confirmed-bug") => {
      const findingId = `S01-${++n}`;
      call(
        "add_finding",
        {
          finding_id: findingId,
          subsystem_id: SUBSYSTEM,
          symptom: "a fixture symptom",
          root_cause: "a fixture cause",
          severity: "LOW",
          status,
          primary_files: [`${CORE}:value@${c0}`],
          ref_sha: c0,
          pass_type: "survey",
        },
        ctx,
      );
      return findingId;
    };
    const DECISION_DRAFT = (decisionId, claimId) => ({
      decision_id: decisionId,
      revision_id: `${decisionId}:r1`,
      title: "Fixture decision",
      desire_sources: [
        { desire_id: "d1", statement: "The fixture needs one.", source_kind: "direct-user", source_ref: "user:sc12" },
      ],
      accepted_option: { option_key: "a", summary: "Keep the value." },
      alternatives: [
        { option_key: "b", summary: "Drop it.", disposition: "rejected", evidence_ref: `amanuensis://claim/${claimId}` },
      ],
      constraints: [{ constraint_id: "c1", statement: "Stay small.", source_ref: "user:sc12" }],
      consequences: [{ consequence_id: "q1", statement: "One more value.", direction: "cost" }],
      falsifiers: [{ falsifier_id: "f1", condition: "The value moves.", destination: "SC12" }],
      premises: [{ premise_id: "p1", kind: "claim", ref: claimId, statement: "The value is read." }],
      code_changes: [{ path: CORE, relationship: "constrains" }],
      rationale: "A fixture rationale.",
      authored_by_kind: "model",
      authored_by: "fixture-model",
    });
    const acceptedRevision = (claimId) => {
      const decisionId = fresh("decision-sc12");
      call("draft_decision_revision", DECISION_DRAFT(decisionId, claimId), ctx);
      call(
        "accept_decision_revision",
        {
          revision_id: `${decisionId}:r1`,
          actor_kind: "human",
          actor_id: "fixture-human",
          authority_scope: decisionId,
          authority_source: "user:sc12",
          reason: "Fixture acceptance exercises the authority gate.",
        },
        ctx,
      );
      return { decisionId, revisionId: `${decisionId}:r1` };
    };

    // ---- state the routes need, made before the rules
    call("add_concern", { code: "SC-1", origin: "seeded" }, ctx);
    call("add_concern", { code: "SC-2", origin: "seeded" }, ctx);
    const auxEvidence = mkEvidence(CORE);
    const disposition = (code, evidenceIds, citation = `${CORE}:value@${c0}`) =>
      call(
        "set_disposition",
        {
          subsystem_id: SUBSYSTEM,
          concern_code: code,
          classification: "confirmed-acceptable",
          evidence: citation,
          evidence_ids: evidenceIds,
          evidence_quality: "code-verified",
          rationale: "a fixture rationale",
          ref_sha: c0,
          pass_type: "survey",
        },
        ctx,
      );
    disposition("SC-1", [auxEvidence]);
    const attachFinding = newFinding();
    const matrixClaim = newClaim();
    const carryRun = Number(
      call(
        "begin_carry_run",
        {
          source_kind: "store",
          source_path: "/sc12/fixture/archive/memory.db",
          archived_store_id: "store-sc12fixture",
          archived_anchor: c0,
          reason: "a carry for the attach guard",
          expected_count: 2,
          imported_count: 2,
        },
        ctx,
      ).carry_run_id,
    );
    const carried = Number(
      call(
        "carry_finding",
        {
          carry_run_id: carryRun,
          archived_finding_id: "A-1",
          subsystem_id: SUBSYSTEM,
          severity: "LOW",
          symptom: "an archived symptom",
          root_cause: "an archived cause",
          archived_resolution: "open",
          primary_files: [`${CORE}:value@${c0}`],
        },
        ctx,
      ).carried_id,
    );

    // Chorusmith's scope: a claim, a decision, the obligation its invalidation
    // opened, and the evidence the claim cites.
    const scopeClaim = newClaim();
    const scopeDecision = acceptedRevision(scopeClaim);
    call(
      "invalidate_decision_revision",
      { revision_id: scopeDecision.revisionId, evidence_id: EV[CORE], reason: "a fixture invalidation" },
      ctx,
    );
    const scopeFor = (evidenceIds) => ({
      claim_ids: [scopeClaim],
      decision_ids: [scopeDecision.decisionId],
      obligation_ids: [`decision-impact:evidence-${EV[CORE]}:${scopeDecision.revisionId}`],
      evidence_ids: evidenceIds,
    });

    for (const pattern of ["src/", "design/", "README.md", ".gitignore"]) {
      call("record_scope_sorting", { pattern, category: "product", description: `fixture ${pattern}` }, ctx);
    }
    const metaRow = call(
      "record_scope_sorting",
      {
        pattern: "notes/",
        category: "meta",
        description: "working notes",
        inventory: [{ file_path: LOG, line_range: "1", excerpt: "# Log" }],
      },
      ctx,
    ).id;
    call("set_git_state", { canonical_branch: "main", onboarding_sha: c0 }, ctx);
    call("detect_changes", { current_sha: c0 }, ctx);
    const ownerRule = call(
      "set_scope_rule",
      {
        pattern: "design/",
        action: "exclude",
        reason: "plans, not code",
        owner_words: "don't survey design/",
      },
      ctx,
    ).id;
    call("detect_changes", { current_sha: c0 }, ctx);

    const EXCLUDED = [
      { path: SPEC, source: "user", rule: [`owner rule ${ownerRule}`, "design/"] },
      { path: LOG, source: "meta", rule: [`sorting row ${metaRow}`, "notes/"] },
      { path: BUILT, source: "gitignore", rule: ["ignore files"] },
    ];

    const fingerprint = (table) =>
      show(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());

    /** Run `fn`; the thrown refusal's message, or the returned `{ok:false}` error, or null. */
    const attempt = async (fn) => {
      try {
        const result = await fn();
        if (result && typeof result === "object" && result.ok === false) {
          return { refused: String(result.error ?? show(result)), result };
        }
        return { refused: null, result };
      } catch (error) {
        return { refused: String(error?.message ?? error), result: null };
      }
    };

    // ------------------------------------------------------------ the routes
    // One per route of §2.6's second table. `setup(path)` makes what the call
    // needs and returns it; `run(state, path)` is the call under test, which
    // carries the evidence row on `path`; `table` is what the call writes. An
    // `evidence_id` route and an `evidence_ids` route are each present, and a
    // route that carries the evidence as a citation says so with `cites`.
    const ev = (path) => EV[path];
    const ROUTES = [
      {
        id: "A1", tool: "add_claim", label: "evidence_ids", table: "claim_evidence",
        run: (_s, path) => newClaim([ev(path)]),
      },
      {
        id: "A2", tool: "invalidate_claim", label: "evidence_ids", table: "claim_validity_events",
        setup: () => newClaim([auxEvidence]),
        run: (claimId, path) =>
          call("invalidate_claim", { claim_id: claimId, at_sha: c1, reason: "a fixture reason", evidence_ids: [ev(path)] }, ctx),
      },
      {
        id: "A3", tool: "supersede_claim", label: "evidence_ids", table: "claims",
        setup: () => newClaim([auxEvidence]),
        run: (claimId, path) =>
          call(
            "supersede_claim",
            {
              predecessor_claim_id: claimId,
              successor_claim_id: fresh("SC12-SUCC"),
              statement: "The fixture's value is read again.",
              epistemic_kind: "observation",
              at_sha: c1,
              rationale: "a fixture rationale",
              evidence_ids: [ev(path)],
            },
            ctx,
          ),
      },
      {
        id: "A4", tool: "attach_evidence_to_disposition", label: "evidence_id", table: "disposition_evidence",
        run: (_s, path) =>
          call(
            "attach_evidence_to_disposition",
            { subsystem_id: SUBSYSTEM, concern_code: "SC-1", evidence_id: ev(path), role: "linchpin" },
            ctx,
          ),
      },
      {
        id: "A5", tool: "attach_evidence_to_finding", label: "evidence_id", table: "finding_evidence",
        run: (_s, path) =>
          call("attach_evidence_to_finding", { finding_id: attachFinding, evidence_id: ev(path), role: "symptom" }, ctx),
      },
      {
        id: "A6", tool: "set_disposition", label: "evidence_ids", table: "disposition_evidence",
        setup: () => {
          const code = fresh("SC-D");
          call("add_concern", { code, origin: "seeded" }, ctx);
          return code;
        },
        run: (code, path) => disposition(code, [ev(path)]),
      },
      {
        id: "A7", tool: "set_disposition", label: "evidence", cites: true, table: "dispositions",
        setup: () => {
          const code = fresh("SC-C");
          call("add_concern", { code, origin: "seeded" }, ctx);
          return code;
        },
        run: (code, path) => disposition(code, [ev(CORE)], `${path}:value@${c0}`),
      },
      {
        id: "A8", tool: "verify_finding_fix", label: "evidence_id", table: "finding_resolution_events",
        setup: (path) => {
          const findingId = newFinding();
          call(
            "update_finding_status",
            { finding_id: findingId, status: "fixed", fix_location: `${CORE}:value`, fix_sha: c2, resolution_note: "repaired" },
            ctx,
          );
          const evidenceId = mkEvidence(path, c3, "test-observed");
          db.prepare("INSERT INTO finding_evidence (finding_id, evidence_id, role) VALUES (?, ?, 'fix-verification')").run(
            findingId,
            evidenceId,
          );
          return { findingId, evidenceId };
        },
        evidenceOf: (state) => state.evidenceId,
        run: (state) =>
          call("verify_finding_fix", { finding_id: state.findingId, evidence_id: state.evidenceId, verification_note: "green" }, ctx),
      },
      {
        id: "A9", tool: "clear_staleness", label: "evidence_id", table: "staleness_clears",
        // The file named is in the survey set; only the evidence row is not.
        run: (_s, path) =>
          call("clear_staleness", { subsystem_id: SUBSYSTEM, file_path: CORE, ref_sha: c0, evidence_id: ev(path) }, ctx),
      },
      {
        id: "A10", tool: "record_explanation", label: "evidence_ids", table: "explanations",
        run: (_s, path) =>
          call(
            "record_explanation",
            {
              subject_type: "subsystem",
              subject_id: SUBSYSTEM,
              slot: "purpose",
              body: "The fixture holds one constant that the rest of the code reads.",
              evidence_ids: [ev(path)],
              ref_sha: c0,
            },
            ctx,
          ),
      },
      {
        id: "A11", tool: "record_narrative", label: "evidence_ids", table: "narratives",
        run: (_s, path) =>
          call(
            "record_narrative",
            {
              subject_type: "subsystem",
              subject_id: SUBSYSTEM,
              section: "structure",
              body: "The fixture holds one constant that the rest of the code reads.",
              evidence_ids: [ev(path)],
              ref_sha: c0,
            },
            ctx,
          ),
      },
      {
        id: "A12", tool: "record_runtime_boundary", label: "evidence_ids", table: "runtime_boundaries",
        run: (_s, path) =>
          call(
            "record_runtime_boundary",
            { from_runtime: `rt-a-${++n}`, to_runtime: "rt-b", mechanism: "a call", evidence_ids: [ev(path)], ref_sha: c0 },
            ctx,
          ),
      },
      {
        id: "A13", tool: "open_diagnosticity_matrix", label: "evidence_ids", table: "diagnosticity_evidence",
        run: (_s, path) =>
          call(
            "open_diagnosticity_matrix",
            { subsystem_id: SUBSYSTEM, symptom: "a symptom", concern_codes: ["SC-1", "SC-2"], evidence_ids: [ev(path)] },
            ctx,
          ),
      },
      {
        id: "A14", tool: "record_diagnosticity_verdict", label: "evidence_id", table: "diagnosticity_cells",
        // The matrix holds the row already, as one opened before the rules would.
        setup: (path) => {
          const matrixId = call(
            "open_diagnosticity_matrix",
            { subsystem_id: SUBSYSTEM, symptom: "a symptom", concern_codes: ["SC-1", "SC-2"], evidence_ids: [ev(CORE)] },
            ctx,
          ).matrix_id;
          if (path !== CORE) {
            db.prepare("INSERT INTO diagnosticity_evidence (matrix_id, evidence_id, row_order) VALUES (?, ?, 2)").run(
              matrixId,
              ev(path),
            );
          }
          return matrixId;
        },
        run: (matrixId, path) =>
          call(
            "record_diagnosticity_verdict",
            { matrix_id: matrixId, concern_code: "SC-1", evidence_id: ev(path), verdict: "consistent" },
            ctx,
          ),
      },
      {
        id: "A15", tool: "invalidate_decision_revision", label: "evidence_id", table: "decision_events",
        setup: () => acceptedRevision(newClaim()).revisionId,
        run: (revisionId, path) =>
          call("invalidate_decision_revision", { revision_id: revisionId, evidence_id: ev(path), reason: "a fixture invalidation" }, ctx),
      },
      {
        id: "A16", tool: "resolve_contradiction", label: "evidence_id", table: "contradiction_resolution_events",
        setup: (path) => {
          const a = newFinding();
          const b = newFinding("confirmed-acceptable");
          const id = Number(
            db
              .prepare(
                `INSERT INTO contradictions (finding_a, finding_b, shared_location, conflict_type)
                 VALUES (?, ?, ?, 'classification-conflict')`,
              )
              .run(a, b, `${CORE}:value`).lastInsertRowid,
          );
          db.prepare("INSERT INTO finding_evidence (finding_id, evidence_id, role) VALUES (?, ?, 'symptom')").run(a, ev(path));
          return id;
        },
        run: (id, path) =>
          call(
            "resolve_contradiction",
            { id, resolution: "scope-distinction", scope_note: "different callers", evidence_id: ev(path), rationale: "scopes differ" },
            ctx,
          ),
      },
      {
        id: "A17", tool: "record_claim_mark", label: "evidence_id", table: "claim_marks",
        // A flow-step claim about the path the evidence row cites.
        setup: (path) => {
          const claimId = fresh("SC12-FLOW");
          db.prepare(
            `INSERT INTO claims (claim_id, claim_key, subject_type, subject_id, statement,
                                 epistemic_kind, asserted_at_sha, valid_from_sha, session_id)
             VALUES (?, ?, 'symbol', ?, 'A flow step.', 'observation', ?, ?, ?)`,
          ).run(claimId, `${SUBSYSTEM}/flow/sc12-${n}/01`, `${path}:value`, c0, c0, ctx.sessionId);
          return claimId;
        },
        run: (claimId, path) =>
          call("record_claim_mark", { claim_id: claimId, kind: "commit-point", evidence_id: ev(path), ref_sha: c0 }, ctx),
      },
      {
        id: "A18", tool: "attach_carried_evidence", label: "evidence_id", table: "carried_finding_evidence",
        run: (_s, path) => call("attach_carried_evidence", { carried_id: carried, evidence_id: ev(path) }, ctx),
      },
      {
        id: "A19", tool: "capture_chorusmith_parity_snapshot", label: "parity_scope.evidence_ids", table: null,
        run: (_s, path) =>
          call(
            "capture_chorusmith_parity_snapshot",
            { parity_scope: scopeFor([...new Set([EV[CORE], ev(path)])].sort((x, y) => x - y)) },
            ctx,
          ),
        controlReturns: (result) => (result?.snapshot?.evidence?.records?.length === 1 ? null : "the snapshot lacks the control's evidence row"),
      },
      {
        id: "A20", tool: "plan_chorusmith_adapter_run", label: "parity_scope.evidence_ids", table: "chorusmith_adapter_runs",
        run: (_s, path) => {
          const captured = call("capture_chorusmith_parity_snapshot", { parity_scope: scopeFor([EV[CORE]]) }, ctx);
          const snapshot = captured.snapshot;
          if (path !== CORE) {
            snapshot.scope = { ...snapshot.scope, evidence_ids: [EV[CORE], ev(path)].sort((x, y) => x - y) };
          }
          return call(
            "plan_chorusmith_adapter_run",
            {
              run_id: fresh("sc12-run"),
              external_run_ref: `chorusmith://run/sc12-${++n}`,
              source_commit: c0,
              expected_direct: {
                snapshot,
                snapshot_hash: path === CORE ? captured.snapshot_hash : contentHash(snapshot),
                verification_time_us: captured.verification_time_us,
              },
              parity_policy: { recovery_probe_required: false, max_verification_overhead_us: 1000000 },
              steps: [
                {
                  step_id: fresh("adapter-step"),
                  adapter_kind: "CodebaseBrief",
                  tool_name: "add_evidence",
                  args: { file_path: CORE, line_range: "1", ref_sha: c0, kind: "code-verified" },
                  expected_output_keys: ["id"],
                },
              ],
            },
            ctx,
          );
        },
      },
      {
        // The crosswalk's provenance cites an evidence row by id; every tool that
        // takes provenance (resolve_crosswalk_identity's `evidence` among them)
        // reads it through one function.
        id: "A21", tool: "stage_crosswalk_entity", label: "provenance", table: "crosswalk_entities",
        run: (_s, path) =>
          call(
            "stage_crosswalk_entity",
            {
              entity_id: fresh("sc12-entity"),
              entity_kind: "method",
              source_kind: "direct-user",
              source_ref: `user:sc12-${++n}`,
              label: `method ${n}`,
              definition: "A fixture method.",
              negative_criteria: ["is not a fixture"],
              provenance: [{ kind: "repository-evidence", ref: String(ev(path)), statement: "read there" }],
            },
            ctx,
          ),
      },
    ];

    /** What a refusal of `route` on `excluded` must say; the missing parts, or null. */
    const refusalMisses = (route, message, excluded, evidenceId) => {
      const missing = [];
      for (const part of [
        `${route.tool} refuses:`,
        route.label,
        excluded.path,
        `source ${excluded.source}`,
        ...excluded.rule,
        INCLUDE_REMEDY,
        ...(route.cites ? [] : [`evidence ${evidenceId}`]),
      ]) {
        if (!message.includes(part)) missing.push(show(part));
      }
      return missing.length ? `the refusal lacks ${missing.join(", ")}: ${message}` : null;
    };

    for (const route of ROUTES) {
      await check(`A0 control: ${route.id} ${route.tool} attaches the in-survey evidence on ${CORE}`, async () => {
        const state = route.setup?.(CORE);
        const before = route.table && fingerprint(route.table);
        const { refused, result } = await attempt(() => route.run(state, CORE));
        if (refused) return `refused: ${refused}`;
        if (route.controlReturns) {
          const wrong = route.controlReturns(result);
          if (wrong) return wrong;
        }
        return route.table && fingerprint(route.table) === before ? `${route.table} is unchanged` : null;
      });
      for (const excluded of EXCLUDED) {
        await check(`${route.id} ${route.tool} (${route.label}) refuses the evidence on ${excluded.path} (${excluded.source})`, async () => {
          const state = route.setup?.(excluded.path);
          const before = route.table && fingerprint(route.table);
          const { refused } = await attempt(() => route.run(state, excluded.path));
          const wrote = route.table ? fingerprint(route.table) !== before : false;
          if (!refused) return `accepted${wrote ? `, and wrote to ${route.table}` : ""}`;
          if (wrote) return `refused, but wrote to ${route.table} first`;
          return refusalMisses(route, refused, excluded, route.evidenceOf ? route.evidenceOf(state) : ev(excluded.path));
        });
      }
    }

    // Both argument shapes are routes: at least one refusal over `evidence_id`
    // and one over `evidence_ids`, so a guard that reads only one is caught.
    await check("A25 the routes carry both evidence_id and evidence_ids", () => {
      const labels = new Set(ROUTES.map((route) => route.label));
      return labels.has("evidence_id") && labels.has("evidence_ids") ? null : `labels: ${show([...labels])}`;
    });

    // An evidence row on an included path is attached next to an excluded one's
    // refusal: a call that carries both is refused whole, and writes nothing.
    await check("A26 a call carrying one included and one excluded evidence row is refused whole", async () => {
      const claimId = newClaim([auxEvidence]);
      const before = `${fingerprint("claim_validity_events")}${fingerprint("claim_evidence")}`;
      const { refused } = await attempt(() =>
        call(
          "invalidate_claim",
          { claim_id: claimId, at_sha: c1, reason: "a fixture reason", evidence_ids: [EV[CORE], EV[SPEC]] },
          ctx,
        ),
      );
      const after = `${fingerprint("claim_validity_events")}${fingerprint("claim_evidence")}`;
      if (!refused) return "accepted";
      if (before !== after) return "refused, but wrote first";
      return refused.includes(SPEC) ? null : `the refusal does not name ${SPEC}: ${refused}`;
    });
  } finally {
    try {
      db.close();
    } catch {
      /* already reported */
    }
    rmSync(scratch, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------- the census
  await check("C1 every registered tool with one of §2.6's argument names is guarded or exempt with its reason", () => {
    const missing = unlisted(tools);
    return missing.length ? `not in either table: ${missing.join(", ")}` : null;
  });
  await check("C2 every tool the tables list is registered", () => {
    const registered = new Set(tools.map((tool) => tool.name));
    const gone = Object.keys(LISTED).filter((name) => !registered.has(name));
    return gone.length ? `listed but not registered: ${gone.join(", ")}` : null;
  });
  await check("C3 every tool listed as exempt names a reason, and every census hit it lists is still a hit", () => {
    const found = census(tools);
    const wrong = [];
    for (const [name, entry] of Object.entries(LISTED)) {
      if (entry.table === "exempt" && !entry.reason) wrong.push(`${name} has no reason`);
      if (entry.table !== "first" && allTools.has(name) && !found.has(name)) {
        // A listed tool the census no longer finds is a stale entry, not an error
        // in the tool; say so rather than let the table drift.
        wrong.push(`${name} is listed, but no property of its input has a census name`);
      }
    }
    return wrong.length ? wrong.join("; ") : null;
  });
  await check("C4 a dummy tool with an evidence_ids argument turns the census red", () => {
    const dummy = {
      name: "dummy_attach_evidence",
      inputSchema: {
        type: "object",
        properties: { rows: { type: "array", items: { type: "object", properties: { evidence_ids: { type: "array" } } } } },
      },
    };
    const before = unlisted(tools);
    const after = unlisted([...tools, dummy]);
    if (before.includes(dummy.name)) return "the dummy is already reported without being added";
    return after.includes(dummy.name) ? null : `the census did not report the dummy (it reports ${show(after)})`;
  });
  await check("C5 the census reads nested arguments: parity_scope.evidence_ids and inventory[].file_path", () => {
    const found = census(tools);
    const wrong = [];
    if (!(found.get("capture_chorusmith_parity_snapshot") ?? []).includes("parity_scope.evidence_ids")) {
      wrong.push("capture_chorusmith_parity_snapshot's parity_scope.evidence_ids");
    }
    if (!(found.get("record_scope_sorting") ?? []).includes("inventory.[].file_path")) {
      wrong.push("record_scope_sorting's inventory[].file_path");
    }
    return wrong.length ? `the census misses ${wrong.join(", ")}` : null;
  });
  await check("T1 every tool §2.6's second table names is registered", () => {
    const registered = new Set(tools.map((tool) => tool.name));
    const missing = Object.entries(LISTED)
      .filter(([, entry]) => entry.table === "second")
      .map(([name]) => name)
      .filter((name) => !registered.has(name));
    return missing.length ? `not registered: ${missing.join(", ")}` : null;
  });
}

function registered() {
  const register = join(here, "contracts", "refusal-parity.json");
  if (!existsSync(register)) return "contracts/refusal-parity.json is absent";
  const entry = JSON.parse(readFileSync(register, "utf8")).refusals.find(
    (candidate) => candidate.id === "scope-excluded-attach",
  );
  if (!entry) return "contracts/refusal-parity.json has no scope-excluded-attach entry";
  const wrong = [];
  if (entry.server?.file !== "src/helpers.ts") wrong.push(`its server file is ${show(entry.server?.file)}`);
  const refs = (entry.references ?? []).map((ref) => ref.file);
  if (!refs.includes("../.claude/skills/amanuensis/references/records.md")) {
    wrong.push(`its references are ${show(refs)}`);
  }
  for (const tool of ["record_explanation", "record_narrative", "record_runtime_boundary", "attach_carried_evidence"]) {
    if (!(entry.refuses ?? []).includes(tool)) wrong.push(`refuses omits ${tool}`);
  }
  const records = join(here, "..", ".claude", "skills", "amanuensis", "references", "records.md");
  const text = existsSync(records) ? readFileSync(records, "utf8").replace(/\s+/g, " ") : "";
  if (!text.includes(String(entry.server?.phrase ?? "\u0000").replace(/\s+/g, " "))) {
    wrong.push("references/records.md does not carry the server's phrase");
  }
  if (!text.includes(INCLUDE_REMEDY)) wrong.push(`references/records.md does not name ${show(INCLUDE_REMEDY)}`);
  return wrong.length ? wrong.join("; ") : null;
}

// --------------------------------------------------------------- the driver

try {
  const mods = {};
  let tools = [];
  try {
    ({ openDatabase: mods.openDatabase } = await import("./dist/db.js"));
    ({ resolveProject: mods.resolveProject, ensureProjectStorage: mods.ensureProjectStorage } =
      await import("./dist/project.js"));
    // Every tool array the build exports, so the census sees what is registered
    // and not a list this gate keeps; each array must be one src/index.ts spreads.
    const index = readFileSync(join(here, "src", "index.ts"), "utf8");
    for (const file of readdirSync(join(here, "dist", "tools")).filter((name) => name.endsWith(".js"))) {
      const module = await import(`./dist/tools/${file}`);
      for (const [name, value] of Object.entries(module)) {
        const isTools =
          Array.isArray(value) && value.length > 0 && value.every((td) => td && td.name && td.inputSchema && td.handler);
        if (!isTools) continue;
        if (!index.includes(`...${name}`)) {
          failures.push(`C0 ${file} exports ${name}, which src/index.ts does not register`);
          continue;
        }
        tools.push(...value);
      }
    }
  } catch (error) {
    failures.push(`L the server build could not be loaded: ${scrub(error?.message ?? error)}`);
  }
  if (!failures.some((failure) => failure.startsWith("L "))) {
    tools = [...new Map(tools.map((td) => [td.name, td])).values()];
    await main(mods, tools);
  }
  await check("P1 the refusal is registered, with its sentence in references/records.md", registered);
  await check("CI1 this gate runs in CI, in the mcp-server job", () => {
    const workflow = join(here, "..", ".github", "workflows", "test.yml");
    if (!existsSync(workflow)) return ".github/workflows/test.yml is absent";
    return readFileSync(workflow, "utf8").includes("node test-scope-attach-guard.mjs")
      ? null
      : "the workflow does not run this gate";
  });
} catch (error) {
  failures.push(`X the gate did not finish: ${scrub(error?.message ?? error)}`);
}

console.log(`  ran  ${checked} assertion(s) against ${join(here, "dist")}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`GATE SC12 RED: ${failures.length} of ${checked} assertion(s) failed; first: ${failures[0]}`);
  process.exit(1);
}
console.log("GATE SC12 GREEN");
process.exit(0);
