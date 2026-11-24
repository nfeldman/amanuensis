#!/usr/bin/env node
// GATE SC10 (design/scope/PLAN.md §3 SC10; §2.6, first table) — the write guard
// for paths and new evidence. An excluded path gets no new durable record:
// "excluded means not included", and meta is "not included in any work".
//
// One fixture repository, one store in sorted mode. Three paths are excluded,
// one per source: `design/spec.md` by an owner rule over `design/` (user),
// `notes/log.md` by a meta sorting row over `notes/` (meta), and the
// force-added `build/out.js`, which the repository's own `.gitignore` matches
// (gitignore). A fourth, `design/my spec.md`, is excluded by the same owner
// rule and has a space in its name, which a citation may carry. `src/core.ts` is in the survey set and is every route's
// positive control. Records on the excluded paths that predate the exclusion
// (ledger rows, an evidence row, a claim and a change-impact prediction) are
// made first, as a store surveyed before its rules would hold them (§2.6a).
//
// Turns red when:
//   1. any route of §2.6's first table writes a record on an excluded path, or
//      refuses one without naming its source, its rule (the owner rule or
//      sorting row and its pattern; the ignore files for gitignore) and the
//      remedy, "an owner include rule" (W1–W13, one per route, each over all
//      three sources and the spaced name); or the same route refuses, or fails
//      to write, the in-survey control path (W0). The routes include a
//      finding's `fix_location`, at creation and at a status update, and a
//      decision revision's `code_changes[].path` and `code` premise;
//   2. `land_review_pass` writes an evidence row for `new_evidence` on an
//      excluded path, or does not refuse it as (1) says (L1); or lands the
//      in-survey control's new evidence wrongly (L0); or links a judgment to an
//      existing evidence row on an excluded path through
//      `judgments[].evidence_ids`, or lands the pass (L2);
//   3. change impact writes an evidence row, or invalidates a claim, for a
//      change on an excluded path predicted before the rule (I1); or the
//      control's prediction does not apply (I0);
//   4. `retire_ledger_file` refuses an excluded path, or leaves its row (X1);
//   5. `record_scope_sorting` refuses an inventory that cites an excluded path,
//      by the owner's rule or by an earlier meta row (X2); or `log_dispatch` or
//      `add_field_note` refuses a path the tree does not carry, such as a store
//      path the ignore files happen to match (X3);
//   6. a read refuses an excluded path: `describe_locus`, `outline_file`,
//      `read_symbol` and `get_evidence` must return a result (R1–R4);
//   7. a tool §2.6's first table names is not registered (T1);
//   8. the refusal is not registered in contracts/refusal-parity.json with its
//      sentence in references/records.md (P1);
//   9. this gate is not registered in CI (CI1);
//  10. on a second fixture whose `.gitignore` differs at each of three
//      commits, a write is decided at some revision other than the last
//      reconciled one: at the revision it cites, or at HEAD (G1–G3); or an
//      owner include rule over one path under an excluded prefix, or over one
//      gitignored path, does not let a write and only that path through (G4).
//
// Every fixture is a temporary git repository and a store under a temporary
// AMANUENSIS_STORAGE_ROOT; no git configuration but the fixture's own is read,
// and nothing here reads a real store or the network.
//
//   exit 0  `GATE SC10 GREEN`
//   exit 1  `GATE SC10 RED: <reason>`

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stableClaimKey } from "./fixtures/claim-key.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SUBSYSTEM = "S-01";
const CORE = "src/core.ts";
const SPEC = "design/spec.md";
const PROTO = "design/proto.ts";
const LOG = "notes/log.md";
const BUILT = "build/out.js";
const SPACED = "design/my spec.md";
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
    "-c", "user.email=sc10@localhost",
    "-c", "user.name=scope-sc10",
    "-c", "commit.gpgsign=false",
    "commit", "-q", "--no-verify", "-m", message,
  );
  return git(cwd, "rev-parse", "HEAD");
}

async function main(mods) {
  const { openDatabase, resolveProject, ensureProjectStorage, toolArrays } = mods;
  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  const call = (name, args, ctx) => {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    return td.handler(args, ctx);
  };

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-sc10-"));
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
  write(PROTO, "export function proto(): number {\n  return 1;\n}\n");
  write(LOG, "# Log\n\nRead the code first.\n");
  write(BUILT, "export const built = 1;\n");
  write(SPACED, "# My spec\n");
  git(ws, "add", "-A");
  git(ws, "add", "-f", BUILT);
  const c0 = commit(ws, "seed");
  // c1 changes only the spec, c2 only the code: one change-impact run each.
  write(SPEC, "# Spec\n\nThe value is two.\n");
  git(ws, "add", "-A");
  const c1 = commit(ws, "change the spec");
  write(CORE, "export const value = 2;\n");
  git(ws, "add", "-A");
  const c2 = commit(ws, "change the code");

  const project = resolveProject(ws, { selectionSource: "sc10" });
  ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
  const ctx = { project, db: openDatabase(project.dbPath), sessionId: null };
  const db = ctx.db;
  try {
    ctx.sessionId = call("start_session", { intent: "sc10 write guard" }, ctx).session_id;
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
    // Ledger rows on the three excluded paths, as a store surveyed before its
    // rules holds them (§2.6a). Written directly: the guard rightly refuses a
    // new row on a gitignored path.
    for (const path of [SPEC, LOG, BUILT, SPACED]) {
      db.prepare(
        `INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha)
         VALUES (?, ?, 'recorded before the exclusion', 'candidate', ?)`,
      ).run(SUBSYSTEM, path, c0);
    }

    // Records before the rule: evidence and a claim on the spec and on the
    // code, and a change-impact prediction for each.
    const claimOn = (path, claimId) => {
      const evidenceId = call(
        "add_evidence",
        { file_path: path, line_range: "1", ref_sha: c0, kind: "code-verified" },
        ctx,
      ).id;
      call(
        "add_claim",
        {
          claim_id: claimId,
          claim_key: stableClaimKey(SUBSYSTEM, claimId, path),
          subject_type: "symbol",
          subject_id: `${path}:value`,
          statement: `The fixture's ${path} says what the value is.`,
          epistemic_kind: "observation",
          ref_sha: c0,
          evidence_ids: [evidenceId],
        },
        ctx,
      );
      return evidenceId;
    };
    const specEvidence = claimOn(SPEC, "SC10-CL-SPEC");
    claimOn(CORE, "SC10-CL-CORE");

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
    call("predict_change_impact", { base_sha: c0, head_sha: c1, run_id: "sc10-impact-spec" }, ctx);
    call("predict_change_impact", { base_sha: c1, head_sha: c2, run_id: "sc10-impact-core" }, ctx);
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
      // define_term's first_seen is one citation token, so its grammar refuses
      // the space before the guard is reached; that refusal writes nothing too.
      {
        path: SPACED,
        source: "user",
        rule: [`owner rule ${ownerRule}`, "design/"],
        grammar: { define_term: "is not a citation token" },
      },
    ];

    // add_finding needs the subsystem at 'concerns' (the knowledge-depth
    // contract); the ladder is not under test here.
    db.prepare("UPDATE subsystems SET status = 'concerns' WHERE id = ?").run(SUBSYSTEM);
    call(
      "add_finding",
      {
        finding_id: "S01-FIX",
        subsystem_id: SUBSYSTEM,
        symptom: "a fixture symptom",
        root_cause: "a fixture cause",
        severity: "LOW",
        status: "confirmed-bug",
        primary_files: [`${CORE}:value@${c0}`],
        ref_sha: c0,
        pass_type: "survey",
      },
      ctx,
    );
    const decisionDraft = (premises, codeChanges) => {
      const decisionId = `decision-sc10-${++n}`;
      return call(
        "draft_decision_revision",
        {
          decision_id: decisionId,
          revision_id: `${decisionId}:r1`,
          title: "Fixture decision",
          desire_sources: [
            { desire_id: "d1", statement: "The fixture needs one.", source_kind: "direct-user", source_ref: "user:sc10" },
          ],
          accepted_option: { option_key: "a", summary: "Keep the value." },
          alternatives: [
            { option_key: "b", summary: "Drop it.", disposition: "rejected", evidence_ref: "amanuensis://claim/SC10-CL-CORE" },
          ],
          constraints: [{ constraint_id: "c1", statement: "Stay small.", source_ref: "user:sc10" }],
          consequences: [{ consequence_id: "q1", statement: "One more value.", direction: "cost" }],
          falsifiers: [{ falsifier_id: "f1", condition: "The value moves.", destination: "SC10" }],
          premises,
          code_changes: codeChanges,
          rationale: "A fixture rationale.",
          authored_by_kind: "model",
          authored_by: "fixture-model",
        },
        ctx,
      );
    };
    const claimPremise = [{ premise_id: "p1", kind: "claim", ref: "SC10-CL-CORE", statement: "The value is read." }];

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

    /** What a refusal of `tool` on `excluded` must say; the missing parts, or null. */
    const refusalMisses = (tool, message, excluded) => {
      const missing = [];
      for (const part of [
        `${tool} refuses:`,
        excluded.path,
        `source ${excluded.source}`,
        ...excluded.rule,
        INCLUDE_REMEDY,
      ]) {
        if (!message.includes(part)) missing.push(show(part));
      }
      return missing.length ? `the refusal lacks ${missing.join(", ")}: ${message}` : null;
    };

    // One entry per route of §2.6's first table: the call on a path, and the
    // table whose rows the call writes.
    let n = 0;
    const runId = (() => {
      const id = Number(
        call(
          "begin_carry_run",
          {
            source_kind: "store",
            source_path: "/sc10/fixture/archive/memory.db",
            archived_store_id: "store-sc10fixture",
            archived_anchor: c0,
            reason: "a carry for the write guard",
            expected_count: 20,
            imported_count: 20,
          },
          ctx,
        ).carry_run_id,
      );
      return id;
    })();
    const ROUTES = [
      {
        id: "W1",
        tool: "add_files_to_scope",
        table: "file_ledger",
        call: (path) =>
          call(
            "add_files_to_scope",
            {
              subsystem_id: SUBSYSTEM,
              ref_sha: c0,
              files: [{ file_path: path, why_in_scope: `scoped again ${++n}`, classification: "examined" }],
            },
            ctx,
          ),
      },
      {
        id: "W2",
        tool: "update_file_classification",
        table: "file_ledger",
        call: (path) => {
          const current = db
            .prepare("SELECT classification FROM file_ledger WHERE subsystem_id = ? AND file_path = ?")
            .get(SUBSYSTEM, path)?.classification;
          return call(
            "update_file_classification",
            {
              subsystem_id: SUBSYSTEM,
              file_path: path,
              classification: current === "examined" ? "candidate" : "examined",
            },
            ctx,
          );
        },
      },
      {
        id: "W3",
        tool: "clear_staleness",
        table: "staleness_clears",
        call: (path) =>
          call(
            "clear_staleness",
            { subsystem_id: SUBSYSTEM, file_path: path, ref_sha: c0, reason: "re-read at c0" },
            ctx,
          ),
      },
      {
        id: "W4",
        tool: "add_evidence",
        table: "evidence",
        call: (path) =>
          call("add_evidence", { file_path: path, line_range: "1", ref_sha: c0, kind: "code-verified" }, ctx),
      },
      {
        id: "W5",
        tool: "define_term",
        table: "vocabulary",
        call: (path) =>
          call(
            "define_term",
            { term: `term-${++n}`, gloss: "a fixture term", first_seen: `${path}:value@${c0}` },
            ctx,
          ),
      },
      {
        id: "W6",
        tool: "add_field_note",
        table: "field_notes",
        call: (path) =>
          call(
            "add_field_note",
            { category: "pattern", observation: `note ${++n}`, location: `${path}:1`, ref_sha: c0 },
            ctx,
          ),
      },
      {
        id: "W7",
        tool: "add_finding",
        table: "findings",
        call: (path) =>
          call(
            "add_finding",
            {
              finding_id: `S01-${++n}`,
              subsystem_id: SUBSYSTEM,
              symptom: "a fixture symptom",
              root_cause: "a fixture cause",
              severity: "LOW",
              status: "confirmed-bug",
              primary_files: [`${path}:value@${c0}`],
              ref_sha: c0,
              pass_type: "survey",
            },
            ctx,
          ),
      },
      {
        id: "W8",
        tool: "carry_finding",
        table: "carried_findings",
        call: (path) =>
          call(
            "carry_finding",
            {
              carry_run_id: runId,
              archived_finding_id: `A-${++n}`,
              subsystem_id: SUBSYSTEM,
              severity: "LOW",
              symptom: "an archived symptom",
              root_cause: "an archived cause",
              archived_resolution: "open",
              primary_files: [`${path}:value@${c0}`],
            },
            ctx,
          ),
      },
      {
        id: "W9",
        tool: "log_dispatch",
        table: "subagent_log",
        call: (path) =>
          call(
            "log_dispatch",
            { session_id: ctx.sessionId, seq: ++n, role: "explore", file_path: path },
            ctx,
          ),
      },
      {
        id: "W10",
        tool: "add_finding",
        table: "findings",
        // fix_location alone, with no primary_files to be guarded in its stead.
        call: (path) =>
          call(
            "add_finding",
            {
              finding_id: `S01-${++n}`,
              subsystem_id: SUBSYSTEM,
              symptom: "a fixture symptom",
              root_cause: "a fixture cause",
              severity: "LOW",
              status: "confirmed-bug",
              fix_location: `${path}:value`,
              ref_sha: c0,
              pass_type: "survey",
            },
            ctx,
          ),
      },
      {
        id: "W11",
        tool: "update_finding_status",
        table: "findings",
        call: (path) =>
          call(
            "update_finding_status",
            { finding_id: "S01-FIX", status: "confirmed-bug", fix_location: `${path}:value` },
            ctx,
          ),
      },
      {
        id: "W12",
        tool: "draft_decision_revision",
        table: "decision_revisions",
        call: (path) => decisionDraft(claimPremise, [{ path, relationship: "constrains" }]),
      },
      {
        id: "W13",
        tool: "draft_decision_revision",
        table: "decision_revisions",
        call: (path) =>
          decisionDraft([{ premise_id: "p1", kind: "code", ref: path, statement: "The value is read." }], []),
      },
    ];

    for (const route of ROUTES) {
      await check(`W0 control: ${route.tool} writes a record on the in-survey ${CORE}`, async () => {
        const before = fingerprint(route.table);
        const { refused } = await attempt(() => route.call(CORE));
        if (refused) return `refused: ${refused}`;
        return fingerprint(route.table) === before ? `${route.table} is unchanged` : null;
      });
      for (const excluded of EXCLUDED) {
        await check(`${route.id} ${route.tool} refuses ${excluded.path} (${excluded.source})`, async () => {
          const before = fingerprint(route.table);
          const { refused } = await attempt(() => route.call(excluded.path));
          const wrote = fingerprint(route.table) !== before;
          if (!refused) return `accepted${wrote ? `, and wrote to ${route.table}` : ""}`;
          if (wrote) return `refused, but wrote to ${route.table} first`;
          const grammar = excluded.grammar?.[route.tool];
          if (grammar && refused.includes(grammar)) return null;
          return refusalMisses(route.tool, refused, excluded);
        });
      }
    }

    // ------------------------------------------------------ land_review_pass
    // A dispatched generator pass per attempt, written directly: the run's
    // planning machinery is not under test, only where new evidence lands.
    db.prepare(
      `INSERT INTO review_analysis_runs
         (run_id, impact_run_id, reviewed_sha, replicate_id, condition, orchestrator_model_family,
          provider_allowlist, allowed_source_prefixes, max_total_tokens, max_total_cost_microusd,
          expected_generator_count, expected_refuter_count, expected_verifier_count,
          blind_assignment_id, sealed_truth_hash, status, manifest_json, manifest_hash, session_id)
       VALUES ('sc10-review', 'sc10-impact-core', ?, 'r1', 'same-context', 'orchestrator-family',
               '["fixture-provider"]', '["src","design","notes","build"]', 1000, 0, 20, 2, 2,
               'sc10-assignment', 'sealed', 'generating', '{}', 'manifest', ?)`,
    ).run(c2, ctx.sessionId);
    let ordinal = 0;
    const landNewEvidence = (path) => {
      const passId = `sc10-review:g${++ordinal}`;
      db.prepare(
        `INSERT INTO review_passes
           (pass_id, run_id, ordinal, role, replicate_id, context_profile, analytical_frame,
            provider, model, model_family, runtime, planned_tokens, planned_cost_microusd, status,
            runtime_input_json, dispatched_at)
         VALUES (?, 'sc10-review', ?, 'generator', ?, 'diff-scoped', 'contract-risk',
                 'fixture-provider', 'fixture-model', 'family-a', 'fixture-runtime', 10, 0,
                 'dispatched', '{}', datetime('now'))`,
      ).run(passId, ordinal, `g${ordinal}`);
      return call(
        "land_review_pass",
        {
          run_id: "sc10-review",
          pass_id: passId,
          judgments: [],
          no_findings_reason: "No candidate survived.",
          coverage: { areas_checked: ["the fixture"] },
          new_evidence: [
            { local_key: "read", file_path: path, ref_sha: c0, kind: "code-verified", line_range: "1" },
          ],
          actual_tokens: 1,
          actual_cost_microusd: 0,
        },
        ctx,
      );
    };
    await check(`L0 control: land_review_pass lands new evidence on the in-survey ${CORE}`, async () => {
      const before = db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE file_path = ?").get(CORE).n;
      const { refused } = await attempt(() => landNewEvidence(CORE));
      if (refused) return `refused: ${refused}`;
      const after = db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE file_path = ?").get(CORE).n;
      return after === before + 1 ? null : `evidence rows on ${CORE} went from ${before} to ${after}`;
    });
    for (const excluded of EXCLUDED) {
      await check(`L1 land_review_pass refuses new_evidence on ${excluded.path} (${excluded.source})`, async () => {
        const before = fingerprint("evidence");
        const { refused } = await attempt(() => landNewEvidence(excluded.path));
        const wrote = fingerprint("evidence") !== before;
        if (!refused) return `accepted${wrote ? ", and wrote an evidence row" : ""}`;
        if (wrote) return "refused, but wrote an evidence row first";
        return refusalMisses("land_review_pass", refused, excluded);
      });
    }

    // An existing evidence row, attached to a judgment by id: one per path,
    // written directly because they predate the rules, and dispatched to the
    // generator pass in its evidence catalog.
    const priorEvidence = Object.fromEntries(
      [CORE, ...EXCLUDED.map((excluded) => excluded.path)].map((path) => [
        path,
        Number(
          db
            .prepare(
              `INSERT INTO evidence (file_path, symbol, line_range, ref_sha, kind, excerpt, session_id)
               VALUES (?, 'value', '1', ?, 'code-verified', 'x', ?)`,
            )
            .run(path, c0, ctx.sessionId).lastInsertRowid,
        ),
      ]),
    );
    const landJudgment = (path) => {
      const passId = `sc10-review:g${++ordinal}`;
      db.prepare(
        `INSERT INTO review_passes
           (pass_id, run_id, ordinal, role, replicate_id, context_profile, analytical_frame,
            provider, model, model_family, runtime, planned_tokens, planned_cost_microusd, status,
            runtime_input_json, dispatched_at)
         VALUES (?, 'sc10-review', ?, 'generator', ?, 'diff-scoped', 'contract-risk',
                 'fixture-provider', 'fixture-model', 'family-a', 'fixture-runtime', 10, 0,
                 'dispatched', ?, datetime('now'))`,
      ).run(passId, ordinal, `g${ordinal}`, JSON.stringify({ evidence_catalog: [{ id: priorEvidence[path] }] }));
      const landed = () =>
        db.prepare("SELECT status FROM review_passes WHERE pass_id = ?").get(passId)?.status === "landed";
      return {
        landed,
        run: () =>
          call(
            "land_review_pass",
            {
              run_id: "sc10-review",
              pass_id: passId,
              judgments: [
                {
                  finding_key: `sc10-key-${ordinal}`,
                  claim: "A fixture candidate.",
                  severity: "LOW",
                  scope: "the fixture",
                  rationale: "read there",
                  evidence_ids: [priorEvidence[path]],
                },
              ],
              actual_tokens: 1,
              actual_cost_microusd: 0,
            },
            ctx,
          ),
      };
    };
    await check(`L2 control: land_review_pass links a judgment to the existing evidence on ${CORE}`, async () => {
      const before = fingerprint("review_judgment_evidence");
      const pass = landJudgment(CORE);
      const { refused } = await attempt(pass.run);
      if (refused) return `refused: ${refused}`;
      if (!pass.landed()) return "the pass did not land";
      return fingerprint("review_judgment_evidence") === before ? "no judgment evidence was linked" : null;
    });
    for (const excluded of EXCLUDED) {
      await check(`L2 land_review_pass refuses judgments[].evidence_ids on ${excluded.path} (${excluded.source})`, async () => {
        const before = fingerprint("review_judgment_evidence");
        const pass = landJudgment(excluded.path);
        const { refused } = await attempt(pass.run);
        const wrote = fingerprint("review_judgment_evidence") !== before || pass.landed();
        if (!refused) return `accepted${wrote ? ", and linked the evidence or landed the pass" : ""}`;
        if (wrote) return "refused, but linked the evidence or landed the pass first";
        const miss = refusalMisses("land_review_pass", refused, excluded);
        if (miss) return miss;
        return refused.includes(`evidence ${priorEvidence[excluded.path]}`) ? null : `the refusal does not name the evidence row: ${refused}`;
      });
    }

    // ---------------------------------------------------------- change impact
    const claimOpen = (claimId) =>
      db.prepare("SELECT valid_until_sha FROM claims WHERE claim_id = ?").get(claimId)?.valid_until_sha ?? null;
    await check("I0 control: change impact applies the in-survey prediction with its evidence", async () => {
      const before = db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE file_path = ?").get(CORE).n;
      const { refused, result } = await attempt(() => call("apply_change_impact", { run_id: "sc10-impact-core" }, ctx));
      if (refused) return `refused: ${refused}`;
      const after = db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE file_path = ?").get(CORE).n;
      const wrong = [];
      if (result?.invalidated_claims !== 1) wrong.push(`invalidated_claims ${show(result?.invalidated_claims)}`);
      if (after !== before + 1) wrong.push(`evidence rows on ${CORE} went from ${before} to ${after}`);
      if (claimOpen("SC10-CL-CORE") !== c2) wrong.push(`the claim's valid_until_sha is ${show(claimOpen("SC10-CL-CORE"))}`);
      return wrong.length ? wrong.join("; ") : null;
    });
    await check("I1 change impact writes no evidence row for a change on an excluded path", async () => {
      const before = fingerprint("evidence");
      const { refused } = await attempt(() => call("apply_change_impact", { run_id: "sc10-impact-spec" }, ctx));
      const wrong = [];
      if (fingerprint("evidence") !== before) wrong.push("an evidence row was written");
      if (claimOpen("SC10-CL-SPEC") !== null) wrong.push("the claim on the excluded path was invalidated");
      if (!refused) wrong.push("the apply was accepted");
      else {
        const miss = refusalMisses("apply_change_impact", refused, EXCLUDED[0]);
        if (miss) wrong.push(miss);
      }
      return wrong.length ? wrong.join("; ") : null;
    });

    // ------------------------------------------------------------- exceptions
    await check("X1 retire_ledger_file accepts an excluded path and removes its row", async () => {
      const { refused } = await attempt(() =>
        call("retire_ledger_file", { subsystem_id: SUBSYSTEM, file_path: BUILT }, ctx),
      );
      if (refused) return `refused: ${refused}`;
      const row = db.prepare("SELECT 1 FROM file_ledger WHERE subsystem_id = ? AND file_path = ?").get(SUBSYSTEM, BUILT);
      return row ? "the row is still there" : null;
    });
    await check("X2 record_scope_sorting's inventory may cite paths already excluded", async () => {
      const wrong = [];
      for (const [pattern, file, excerpt] of [
        ["notes/", LOG, "# Log"],
        ["design/", SPEC, "# Spec"],
      ]) {
        const { refused } = await attempt(() =>
          call(
            "record_scope_sorting",
            {
              pattern,
              category: "meta",
              description: `re-sorted ${pattern}`,
              inventory: [{ file_path: file, line_range: "1", excerpt }],
            },
            ctx,
          ),
        );
        if (refused) wrong.push(`${pattern}: ${refused}`);
      }
      return wrong.length ? wrong.join("; ") : null;
    });

    // A dispatch record usually lies in the store, and a field note's location
    // is free text: neither names a source file unless the tree carries it, so
    // a path the ignore files would match is not refused when it is no file.
    await check("X3 log_dispatch and add_field_note accept a path the tree does not carry", async () => {
      const wrong = [];
      for (const [tool, args] of [
        ["log_dispatch", { session_id: ctx.sessionId, seq: 900, role: "explore", file_path: "build/prompts/p.md" }],
        ["add_field_note", { category: "pattern", observation: "free text", location: "build/later.md:1" }],
      ]) {
        const { refused } = await attempt(() => call(tool, args, ctx));
        if (refused) wrong.push(`${tool}: ${refused}`);
      }
      return wrong.length ? wrong.join("; ") : null;
    });

    // ------------------------------------------------------------------ reads
    const answers = async (label, fn) => {
      const { refused, result } = await attempt(fn);
      if (refused) return `${label} refused: ${refused}`;
      return result == null ? `${label} returned nothing` : null;
    };
    await check(`R1 describe_locus answers for the excluded ${SPEC}`, () =>
      answers("describe_locus", () => call("describe_locus", { locus: SPEC, kind: "file" }, ctx)),
    );
    await check(`R2 outline_file answers for the excluded ${PROTO}`, () =>
      answers("outline_file", () => call("outline_file", { path: PROTO, ref_sha: c0 }, ctx)),
    );
    await check(`R3 read_symbol answers for the excluded ${PROTO}`, () =>
      answers("read_symbol", () => call("read_symbol", { path: PROTO, symbol: "proto", ref_sha: c0 }, ctx)),
    );
    await check(`R4 get_evidence answers for the excluded ${SPEC}`, async () => {
      const { refused, result } = await attempt(() => call("get_evidence", { file_path: SPEC }, ctx));
      if (refused) return `refused: ${refused}`;
      const rows = Array.isArray(result) ? result : (result?.evidence ?? result?.rows ?? []);
      return rows.some((row) => row.id === specEvidence) ? null : `the spec's evidence row is missing: ${show(result)}`;
    });
  } finally {
    try {
      db.close();
    } catch {
      /* already reported */
    }
    rmSync(scratch, { recursive: true, force: true });
  }

  await check("T1 every tool §2.6's first table names is registered", () => {
    const named = [
      "add_files_to_scope",
      "update_file_classification",
      "clear_staleness",
      "retire_ledger_file",
      "add_evidence",
      "land_review_pass",
      "apply_change_impact",
      "define_term",
      "add_field_note",
      "add_finding",
      "update_finding_status",
      "draft_decision_revision",
      "carry_finding",
      "log_dispatch",
    ];
    const index = readFileSync(join(here, "src", "index.ts"), "utf8");
    const missing = named.filter((tool) => !allTools.has(tool));
    for (const array of ["fileTools", "staleTools", "evidenceTools", "reviewAnalysisTools", "impactTools",
      "vocabularyTools", "fieldNoteTools", "findingTools", "carriedTools", "dispatchTools"]) {
      if (!index.includes(array)) missing.push(`${array} in src/index.ts`);
    }
    return missing.length ? `not registered: ${missing.join(", ")}` : null;
  });
}

// A second fixture, for the revision a write is decided at. `.gitignore`
// ignores `old/` at c0, `gen/` at c1 and nothing at c2, which is HEAD; the
// store reconciles at c1. So `gen/out.js` is excluded and `old/x.js` is not,
// at every revision a write may cite, and only c1's ignore files say so. The
// same store carries an owner exclude over `docs/` with an include of
// `docs/kept.md`, and an include of the gitignored `gen/kept.js`.
async function revisionFixture(mods) {
  const { openDatabase, resolveProject, ensureProjectStorage, toolArrays } = mods;
  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  const call = (name, args, ctx) => allTools.get(name).handler(args, ctx);
  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-sc10-rev-"));
  const ws = join(scratch, "ws");
  const write = (name, body) => {
    mkdirSync(dirname(join(ws, name)), { recursive: true });
    writeFileSync(join(ws, name), body);
  };
  mkdirSync(ws, { recursive: true });
  git(ws, "init", "-q", "--template=");
  write("src/a.ts", "export const a = 1;\n");
  for (const path of ["gen/out.js", "gen/kept.js", "old/x.js"]) write(path, `export const v = "${path}";\n`);
  write("docs/kept.md", "# Kept\n");
  write("docs/other.md", "# Other\n");
  write(".gitignore", "old/\n");
  git(ws, "add", "-A");
  git(ws, "add", "-f", "gen/out.js", "gen/kept.js", "old/x.js");
  const c0 = commit(ws, "ignore old/");
  write(".gitignore", "gen/\n");
  git(ws, "add", ".gitignore");
  const c1 = commit(ws, "ignore gen/");
  write(".gitignore", "# nothing\n");
  git(ws, "add", ".gitignore");
  const c2 = commit(ws, "ignore nothing");

  const project = resolveProject(ws, { selectionSource: "sc10-revision" });
  ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
  const ctx = { project, db: openDatabase(project.dbPath), sessionId: null };
  const evidence = (path, ref) =>
    call("add_evidence", { file_path: path, line_range: "1", ref_sha: ref, kind: "code-verified" }, ctx);
  const outcome = async (path, ref) => {
    try {
      const result = await evidence(path, ref);
      return result && result.ok === false ? `refused: ${result.error}` : "accepted";
    } catch (error) {
      return `refused: ${error?.message ?? error}`;
    }
  };
  try {
    ctx.sessionId = call("start_session", { intent: "sc10 write revision" }, ctx).session_id;
    call("set_git_state", { canonical_branch: "main", onboarding_sha: c0 }, ctx);
    call("detect_changes", { current_sha: c1 }, ctx);
    const short = { [c0]: "c0", [c1]: "c1", [c2]: "c2 (HEAD)" };
    await check("G1 a write citing an earlier or later commit is decided at the reconciled c1: gen/out.js is refused", async () => {
      const wrong = [];
      for (const ref of [c0, c1, c2]) {
        const result = await outcome("gen/out.js", ref);
        if (!result.startsWith("refused:")) wrong.push(`at ${short[ref]}: ${result}`);
        else if (!result.includes("source gitignore") || !result.includes(INCLUDE_REMEDY)) {
          wrong.push(`at ${short[ref]}: ${result}`);
        }
      }
      return wrong.length ? wrong.join("; ") : null;
    });
    await check("G2 a path ignored only at the cited c0 is in the survey set at c1, so the write is accepted", async () => {
      const result = await outcome("old/x.js", c0);
      return result === "accepted" ? null : `old/x.js at c0: ${result}`;
    });
    await check("G3 the decision reads c1's ignore files, not HEAD's", async () => {
      const result = await outcome("gen/out.js", c2);
      return result.includes(`at ${c1.slice(0, 12)}`) ? null : `gen/out.js at c2: ${result}`;
    });
    const exclude = call(
      "set_scope_rule",
      { pattern: "docs/", action: "exclude", reason: "notes", owner_words: "don't survey docs/" },
      ctx,
    ).id;
    for (const pattern of ["docs/kept.md", "gen/kept.js"]) {
      call(
        "set_scope_rule",
        { pattern, action: "include", reason: "the owner wants it", owner_words: `survey ${pattern}` },
        ctx,
      );
    }
    await check("G4 an owner include lets a write through on its path only, under an exclude and over gitignore", async () => {
      const wrong = [];
      for (const path of ["docs/kept.md", "gen/kept.js"]) {
        const result = await outcome(path, c1);
        if (result !== "accepted") wrong.push(`${path}: ${result}`);
      }
      const sibling = await outcome("docs/other.md", c1);
      if (!sibling.includes(`owner rule ${exclude}`)) wrong.push(`docs/other.md: ${sibling}`);
      const ignored = await outcome("gen/out.js", c1);
      if (!ignored.includes("source gitignore")) wrong.push(`gen/out.js: ${ignored}`);
      return wrong.length ? wrong.join("; ") : null;
    });
  } finally {
    try {
      ctx.db.close();
    } catch {
      /* already reported */
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}

function registered() {
  const register = join(here, "contracts", "refusal-parity.json");
  if (!existsSync(register)) return "contracts/refusal-parity.json is absent";
  const entry = JSON.parse(readFileSync(register, "utf8")).refusals.find(
    (candidate) => candidate.id === "scope-excluded-write",
  );
  if (!entry) return "contracts/refusal-parity.json has no scope-excluded-write entry";
  const wrong = [];
  if (entry.server?.file !== "src/helpers.ts") wrong.push(`its server file is ${show(entry.server?.file)}`);
  const refs = (entry.references ?? []).map((ref) => ref.file);
  if (!refs.includes("../.claude/skills/amanuensis/references/records.md")) {
    wrong.push(`its references are ${show(refs)}`);
  }
  for (const tool of ["add_evidence", "apply_change_impact", "define_term", "clear_staleness", "carry_finding"]) {
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
  try {
    ({ openDatabase: mods.openDatabase } = await import("./dist/db.js"));
    ({ resolveProject: mods.resolveProject, ensureProjectStorage: mods.ensureProjectStorage } =
      await import("./dist/project.js"));
    const names = [
      ["carried", "carriedTools"],
      ["claims", "claimTools"],
      ["code-index", "codeIndexTools"],
      ["decisions", "decisionTools"],
      ["dispatch", "dispatchTools"],
      ["evidence", "evidenceTools"],
      ["field-notes", "fieldNoteTools"],
      ["files", "fileTools"],
      ["findings", "findingTools"],
      ["git", "gitTools"],
      ["impact", "impactTools"],
      ["locus", "locusTools"],
      ["project", "projectTools"],
      ["review-analysis", "reviewAnalysisTools"],
      ["scope", "scopeTools"],
      ["stale", "staleTools"],
      ["subsystems", "subsystemTools"],
      ["vocabulary", "vocabularyTools"],
    ];
    mods.toolArrays = await Promise.all(
      names.map(async ([file, name]) => (await import(`./dist/tools/${file}.js`))[name]),
    );
  } catch (error) {
    failures.push(`L the server build could not be loaded: ${scrub(error?.message ?? error)}`);
  }
  if (failures.length === 0) {
    if (mods.toolArrays.some((tools) => !Array.isArray(tools))) {
      failures.push("L a tool array could not be read from dist/tools");
    } else {
      await main(mods);
      await revisionFixture(mods);
    }
  }
  await check("P1 the refusal is registered, with its sentence in references/records.md", registered);
  await check("CI1 this gate runs in CI, in the mcp-server job", () => {
    const workflow = join(here, "..", ".github", "workflows", "test.yml");
    if (!existsSync(workflow)) return ".github/workflows/test.yml is absent";
    return readFileSync(workflow, "utf8").includes("node test-scope-write-guard.mjs")
      ? null
      : "the workflow does not run this gate";
  });
} catch (error) {
  failures.push(`X the gate did not finish: ${scrub(error?.message ?? error)}`);
}

console.log(`  ran  ${checked} assertion(s) against ${join(here, "dist")}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`GATE SC10 RED: ${failures.length} of ${checked} assertion(s) failed; first: ${failures[0]}`);
  process.exit(1);
}
console.log("GATE SC10 GREEN");
process.exit(0);
