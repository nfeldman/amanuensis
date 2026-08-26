#!/usr/bin/env node
// A9: compact review surface, one-hop expansion, and semantic export read-back.

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./dist/db.js";
import { ensureProjectStorage, resolveProject } from "./dist/project.js";
import { claimTools } from "./dist/tools/claims.js";
import { compositionTools } from "./dist/tools/composition.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { fieldNoteTools } from "./dist/tools/field-notes.js";
import { findingTools } from "./dist/tools/findings.js";
import { impactTools } from "./dist/tools/impact.js";
import { openQuestionTools } from "./dist/tools/open-questions.js";
import { projectTools } from "./dist/tools/project.js";
import { reviewTools } from "./dist/tools/review.js";
import { reviewAnalysisTools } from "./dist/tools/review-analysis.js";
import { reviewSessionTools } from "./dist/tools/review-session.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFINITIONS = JSON.parse(
  readFileSync(join(ROOT, "fixtures/review-session/semantic-states.json"), "utf8"),
);
let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${label}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${label}\n       ${error.message}`);
  }
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function call(fixture, name, args = {}) {
  const tool = fixture.tools.get(name);
  assert(tool, `unknown test tool: ${name}`);
  return tool.handler(args, fixture.ctx);
}

function passSpecs(runId) {
  return [
    ...[1, 2].map((number) => ({
      pass_id: `${runId}:g${number}`,
      role: "generator",
      replicate_id: `g${number}`,
      context_profile: "integral-head",
      analytical_frame: "compatibility",
      provider: "fixture",
      model: "generator",
      model_family: "generator-family",
      runtime: "fixture",
      planned_tokens: 10,
      planned_cost_microusd: 0,
    })),
    ...["refuter", "verifier"].flatMap((role) =>
      [1, 2].map((number) => ({
        pass_id: `${runId}:${role[0]}${number}`,
        role,
        replicate_id: `${role[0]}${number}`,
        context_profile: "integral-head",
        analytical_frame: role,
        provider: "fixture",
        model: role,
        model_family: `${role}-family`,
        runtime: "fixture",
        planned_tokens: 10,
        planned_cost_microusd: 0,
      })),
    ),
  ];
}

function createChallengedReview(fixture, impactRunId) {
  call(fixture, "compile_review_brief", {
    brief_id: "a9-brief",
    impact_run_id: impactRunId,
    task: "Furnish the event compatibility review.",
    task_constraints: [
      {
        constraint_id: "compatibility",
        statement: "Consumer must accept producer event versions.",
        source_kind: "direct-user",
        source_ref: "a9-fixture",
      },
    ],
    context_profile: "integral-head",
    token_budget: 30_000,
  });
  call(fixture, "publish_review_brief", { brief_id: "a9-brief" });
  const runId = "a9-analysis";
  const specs = passSpecs(runId);
  call(fixture, "plan_review_analysis", {
    run_id: runId,
    replicate_id: "r1",
    condition: "same-context",
    orchestrator_model_family: "orchestrator",
    provider_allowlist: ["fixture"],
    allowed_source_prefixes: ["src"],
    max_total_tokens: 100,
    max_total_cost_microusd: 0,
    blind_assignment_id: "a9-blind",
    sealed_truth_hash: "a9-seal",
    brief_ids: ["a9-brief"],
    pass_specs: specs,
  });
  let candidateEvidence = null;
  for (const pass of specs.filter((row) => row.role === "generator")) {
    const packet = call(fixture, "dispatch_review_pass", { run_id: runId, pass_id: pass.pass_id });
    candidateEvidence ??= packet.runtime_input.evidence_catalog[0]?.id;
    assert(candidateEvidence, "generator ReviewBrief carried no evidence");
    call(fixture, "land_review_pass", {
      run_id: runId,
      pass_id: pass.pass_id,
      judgments: [
        {
          finding_key: "survived-contract-risk",
          claim: "The assembled event contract needs an explicit compatibility decision.",
          severity: "HIGH",
          scope: "producer-consumer seam",
          rationale: "The version boundary is consequential.",
          evidence_ids: [candidateEvidence],
        },
      ],
      actual_tokens: 1,
      actual_cost_microusd: 0,
    });
  }
  call(fixture, "freeze_review_hypotheses", { run_id: runId });
  const hypothesis = fixture.db
    .prepare("SELECT hypothesis_id FROM review_hypotheses WHERE run_id=?")
    .get(runId).hypothesis_id;
  for (const role of ["refuter", "verifier"]) {
    const roleSpecs = specs.filter((row) => row.role === role);
    for (const pass of roleSpecs) {
      call(fixture, "dispatch_review_pass", { run_id: runId, pass_id: pass.pass_id });
    }
    for (const pass of roleSpecs) {
      call(fixture, "land_review_pass", {
        run_id: runId,
        pass_id: pass.pass_id,
        judgments: [
          {
            hypothesis_id: hypothesis,
            verdict: "upheld",
            rationale: "The evidence supports retaining the compatibility risk.",
            evidence_ids: [candidateEvidence],
          },
        ],
        actual_tokens: 1,
        actual_cost_microusd: 0,
      });
    }
  }
  call(fixture, "aggregate_review_analysis", { run_id: runId });
  return runId;
}

function freshFixture() {
  const root = mkdtempSync(join(tmpdir(), "amanuensis-review-session-"));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  git(workspace, "init", "-q");
  git(workspace, "config", "user.email", "test@localhost");
  git(workspace, "config", "user.name", "Review Session Test");
  git(workspace, "config", "commit.gpgsign", "false");
  writeFileSync(join(workspace, "src/producer.ts"), "export const version = 1;\n");
  writeFileSync(join(workspace, "src/consumer.ts"), "export const accepted = [1];\n");
  git(workspace, "add", "src");
  git(workspace, "commit", "-q", "--no-verify", "-m", "base");
  const base = git(workspace, "rev-parse", "HEAD");
  writeFileSync(join(workspace, "src/producer.ts"), "export const version = 2;\n");
  git(workspace, "add", "src/producer.ts");
  git(workspace, "commit", "-q", "--no-verify", "-m", "change producer version");
  const head = git(workspace, "rev-parse", "HEAD");
  const project = resolveProject(workspace, {
    selectionSource: "test-review-session",
    serverVersion: "test",
  });
  ensureProjectStorage(project, (databasePath) => {
    const database = openDatabase(databasePath);
    database.close();
  });
  const storage = project.storagePath;
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  const tools = new Map(
    [
      ...projectTools,
      ...evidenceTools,
      ...claimTools,
      ...findingTools,
      ...fieldNoteTools,
      ...openQuestionTools,
      ...impactTools,
      ...reviewTools,
      ...reviewAnalysisTools,
      ...compositionTools,
      ...reviewSessionTools,
    ].map((tool) => [tool.name, tool]),
  );
  const fixture = { root, workspace, storage, base, head, db, ctx, tools };
  const session = call(fixture, "start_session", { intent: "review-session-controls" });
  ctx.sessionId = session.session_id;
  for (const [id, name] of [
    ["P", "producer"],
    ["C", "consumer"],
  ]) {
    db.prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, 'mapped')").run(id, name);
  }
  for (const [subsystem, path] of [
    ["P", "src/producer.ts"],
    ["C", "src/consumer.ts"],
  ]) {
    db.prepare(
      `INSERT INTO file_ledger
         (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at)
       VALUES (?, ?, 'review fixture', 'examined', ?, datetime('now'))`,
    ).run(subsystem, path, base);
  }
  db.prepare(
    `INSERT INTO seams
       (id, shared_object, shared_object_kind, party_a, party_b)
     VALUES ('S-PC', 'event version', 'event-bus', 'P', 'C')`,
  ).run();
  db.prepare(
    `INSERT INTO concerns (code, category, origin, status)
     VALUES ('SC-1', 'compatibility', 'seeded', 'active')`,
  ).run();
  const producerEvidence = call(fixture, "add_evidence", {
    file_path: "src/producer.ts",
    ref_sha: head,
    kind: "code-verified",
    excerpt: "version = 2",
  }).id;
  const consumerEvidence = call(fixture, "add_evidence", {
    file_path: "src/consumer.ts",
    ref_sha: base,
    kind: "code-verified",
    excerpt: "accepted = [1]",
  }).id;
  for (const [findingId, symptom, refSha, evidenceId] of [
    ["REG-1", "A repaired version mismatch has returned.", head, producerEvidence],
    ["LAT-1", "A pre-existing retry hole remains reachable.", base, consumerEvidence],
    ["HIST-1", "A suspected duplicate delivery was disproved.", base, consumerEvidence],
  ]) {
    call(fixture, "add_finding", {
      finding_id: findingId,
      subsystem_id: findingId === "LAT-1" ? "C" : "P",
      symptom,
      root_cause: "fixture root cause",
      severity: findingId === "REG-1" ? "HIGH" : "MEDIUM",
      status: "confirmed-bug",
      ref_sha: refSha,
      pass_type: "adversarial",
    });
    call(fixture, "attach_evidence_to_finding", {
      finding_id: findingId,
      evidence_id: evidenceId,
      role: "symptom",
    });
  }
  call(fixture, "attach_evidence_to_finding", {
    finding_id: "REG-1",
    evidence_id: producerEvidence,
    role: "fix-verification",
  });
  db.prepare(
    `INSERT INTO finding_resolution_events
       (finding_id, resolution_state, fix_location, fix_sha, evidence_id, rationale, session_id)
     VALUES ('REG-1', 'verified-fixed', 'src/producer.ts', ?, ?, 'prior repair verified', ?)`,
  ).run(base, producerEvidence, ctx.sessionId);
  db.prepare(
    `INSERT INTO finding_resolution_events
       (finding_id, resolution_state, rationale, session_id)
     VALUES ('REG-1', 'open', 'new evidence reopens the finding', ?)`,
  ).run(ctx.sessionId);
  db.prepare(
    `INSERT INTO finding_resolution_events
       (finding_id, resolution_state, evidence_id, rationale, session_id)
     VALUES ('HIST-1', 'ruled-out', ?, 'counterevidence ruled it out', ?)`,
  ).run(consumerEvidence, ctx.sessionId);
  call(fixture, "add_claim", {
    claim_id: "stale-claim",
    claim_key: "consumer.accepts-current-version",
    subject_type: "subsystem",
    subject_id: "C",
    statement: "The consumer accepts the producer's current event version.",
    epistemic_kind: "observation",
    ref_sha: base,
    evidence_ids: [consumerEvidence],
  });
  call(fixture, "invalidate_claim", {
    claim_id: "stale-claim",
    at_sha: head,
    evidence_ids: [producerEvidence],
    reason: "Producer version changed.",
  });
  call(fixture, "add_field_note", {
    category: "candidate-concern",
    observation: "Clock skew may widen the compatibility window, but this is unverified.",
    location: "S-PC",
    ref_sha: head,
  });
  call(fixture, "record_open_question", {
    category: "domain-knowledge",
    question: "May the consumer intentionally reject one transitional version?",
    subsystem_id: "C",
    phase: "review",
    what_assumed: "No; compatibility remains blocking.",
    ref_sha: head,
  });
  const impact = call(fixture, "predict_change_impact", {
    base_sha: base,
    head_sha: head,
    run_id: "a9-impact",
  });
  assert(
    impact.mapped_objects.some((row) => row.object_id === "S-PC"),
    "seam not impacted",
  );
  db.prepare(
    `INSERT INTO revalidation_obligations
       (obligation_id, trigger_type, trigger_id, destination_type, destination_id,
        source_impact_run_id, blocking, owner, priority, state)
     VALUES ('a9-open-obligation', 'manual', 'a9', 'seam', 'S-PC', 'a9-impact',
             1, 'fixture', 1, 'open')`,
  ).run();
  const analysisRunId = createChallengedReview(fixture, "a9-impact");
  const expectedItems = [
    ["artifact", "unit", "unit-report", "missing-report.md"],
    ["commit", "unit", "unit-commit", head],
    ["test", "unit", "unit-test", "unit-test"],
    ["review-result", "unit", "unit-review", analysisRunId],
    ["test", "integral-head", "integral-test", "integral-test"],
    ["review-result", "integral-head", "integral-review", analysisRunId],
  ].map(([kind, scope, subject, expected], ordinal) => ({
    item_id: `a9-composition:${ordinal}`,
    item_kind: kind,
    verification_scope: scope,
    subject,
    expected_ref: expected,
    target_sha: head,
  }));
  call(fixture, "plan_composition_run", {
    run_id: "a9-composition",
    impact_run_id: "a9-impact",
    assembled_head_sha: head,
    expected_items: expectedItems,
    seam_concerns: [
      { seam_id: "S-PC", concern_code: "SC-1", rationale: "Review the version boundary." },
    ],
  });
  call(fixture, "dispatch_composition_item", {
    run_id: "a9-composition",
    item_id: "a9-composition:0",
  });
  call(fixture, "land_composition_item", {
    run_id: "a9-composition",
    item_id: "a9-composition:0",
    observation: { artifact_path: "missing-report.md", content_hash: "missing" },
  });
  call(fixture, "score_composition_item", {
    run_id: "a9-composition",
    item_id: "a9-composition:0",
  });
  const reconciliation = call(fixture, "reconcile_composition_run", {
    run_id: "a9-composition",
  });
  assertEqual(reconciliation.status, "red", "fixture composition status");
  return {
    ...fixture,
    producerEvidence,
    consumerEvidence,
    cleanup: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const fixture = freshFixture();
const review = call(fixture, "compile_review_session", {
  review_session_id: "decision-surface",
  composition_run_id: "a9-composition",
});

test("operational labels keep regression, latent defect, history, and suspicion distinct", () => {
  assertEqual(Object.keys(DEFINITIONS.states).length, 5, "definition denominator");
  const states = new Set(review.items.map((item) => item.semantic_state));
  for (const state of Object.keys(DEFINITIONS.states)) {
    assert(states.has(state), `missing semantic state ${state}`);
  }
  const regression = review.items.find((item) => item.semantic_state === "regression");
  const latent = review.items.find((item) => item.semantic_state === "latent-defect");
  assert(regression.statement.includes("REG-1"), "regression source misclassified");
  assert(latent.statement.includes("LAT-1"), "latent source misclassified");
  assert(
    review.items.some((item) => item.semantic_state === "challenge-survived"),
    "survived challenge missing",
  );
});

test("every actionable compact claim reaches its source and evidence in one expansion", () => {
  const actionable = review.items.filter((item) => item.actionable);
  assert(actionable.length > 0, "no actionable denominator");
  for (const item of actionable) {
    assertEqual(item.expansion.tool, "expand_review_session_item", "expansion tool");
    const expanded = call(fixture, item.expansion.tool, {
      review_session_id: "decision-surface",
      item_id: item.item_id,
    });
    assert(expanded.source_record, `${item.semantic_state} has no durable source record`);
    if (
      ["regression", "latent-defect", "stale-claim", "challenge-survived"].includes(
        item.semantic_state,
      )
    ) {
      assert(expanded.evidence.length > 0, `${item.semantic_state} has no cited evidence`);
    }
    assertEqual(expanded.back_link.review_session_id, "decision-surface", "expansion backlink");
  }
});

const adviceIds = review.items.map((item) => item.item_id);
const regressionId = review.items.find((item) => item.semantic_state === "regression").item_id;
const completed = call(fixture, "complete_review_session", {
  review_session_id: "decision-surface",
  advice_item_ids: adviceIds,
  decisions: [
    {
      item_id: regressionId,
      disposition: "accepted",
      rationale: "Repair the regression before release.",
    },
  ],
  completion_note: "Advice furnished; one decision accepted explicitly.",
});

test("completion separates advice furnished from decisions accepted", () => {
  assertEqual(completed.status, "furnished", "review status");
  assertEqual(completed.completion.advice_count, adviceIds.length, "advice count");
  assertEqual(completed.completion.decision_count, 1, "decision count");
  assertEqual(completed.completion.accepted_count, 1, "accepted count");
  assert(
    completed.completion.advice_count > completed.completion.accepted_count,
    "advice became acceptance",
  );
});

test("export refuses a symlinked parent outside project storage", () => {
  const outside = join(fixture.root, "outside-storage");
  mkdirSync(outside);
  symlinkSync(outside, join(fixture.storage, "reviews"));
  let error = null;
  try {
    call(fixture, "export_review_session", {
      review_session_id: "decision-surface",
      export_id: "escape-attempt",
    });
  } catch (caught) {
    error = caught;
  }
  unlinkSync(join(fixture.storage, "reviews"));
  assert(error?.message.includes("symbolic link"), "symlinked export parent was not rejected");
});

const exported = call(fixture, "export_review_session", {
  review_session_id: "decision-surface",
  export_id: "decision-surface-export",
});

test("canonical JSON and Markdown read back on state, coverage, and content", () => {
  const report = call(fixture, "verify_review_export", { export_id: exported.export_id });
  assertEqual(report.ok, true, "clean export verification");
  assertEqual(Object.keys(report.axes), DEFINITIONS.readbackAxes, "read-back axes");
  assertEqual(report.axes.coverage.expected_items, review.item_count, "export item denominator");
  const json = JSON.parse(readFileSync(join(fixture.storage, exported.json_path), "utf8"));
  assertEqual(
    json.items.map((item) => item.item_id),
    completed.items.map((item) => item.item_id),
    "stable ids",
  );
  const markdown = readFileSync(join(fixture.storage, exported.markdown_path), "utf8");
  assert(markdown.includes("amanuensis://finding/REG-1"), "Markdown lacks durable record link");
});

test("semantic read-back catches a label swap and a removed unknown", () => {
  const jsonPath = join(fixture.storage, exported.json_path);
  const corrupted = JSON.parse(readFileSync(jsonPath, "utf8"));
  const regression = corrupted.items.find((item) => item.semantic_state === "regression");
  const latent = corrupted.items.find((item) => item.semantic_state === "latent-defect");
  regression.semantic_state = "latent-defect";
  latent.semantic_state = "regression";
  corrupted.items = corrupted.items.filter((item) => item.semantic_state !== "unknown");
  writeFileSync(jsonPath, `${JSON.stringify(corrupted, null, 2)}\n`);
  const report = call(fixture, "verify_review_export", { export_id: exported.export_id });
  assertEqual(report.ok, false, "corrupted export status");
  assertEqual(report.axes.coverage.ok, false, "missing unknown coverage axis");
  assertEqual(report.axes.content.ok, false, "label swap content axis");
  assert(report.mismatch_count >= 2, "semantic corruptions were not independently visible");
});

test("user evaluation requires task metrics, with satisfaction only optional context", () => {
  const evaluation = call(fixture, "record_review_session_evaluation", {
    evaluation_id: "a9-user-test-1",
    review_session_id: "decision-surface",
    verification_minutes: 7.5,
    constraint_denominator: 4,
    missed_constraint_count: 1,
    expansion_count: 3,
    satisfaction_score: 4,
  });
  assertEqual(
    DEFINITIONS.usabilityMeasures.every((field) => field in evaluation),
    true,
    "required usability measures",
  );
  assertEqual(evaluation.missed_constraint_count, 1, "missed constraint metric");
});

fixture.cleanup();
console.log(`\nreview session: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
