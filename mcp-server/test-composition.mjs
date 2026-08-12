#!/usr/bin/env node
// A8: exact composition fan-in and a clean integral verification lane.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./dist/db.js";
import { artifactTools } from "./dist/tools/artifacts.js";
import { claimTools } from "./dist/tools/claims.js";
import { compositionTools } from "./dist/tools/composition.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { impactTools } from "./dist/tools/impact.js";
import { projectTools } from "./dist/tools/project.js";
import { reviewAnalysisTools } from "./dist/tools/review-analysis.js";
import { reviewTools } from "./dist/tools/review.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "fixtures/composition/manifest.json"), "utf8"));
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

function assertThrows(fn, expected) {
  let error = null;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  if (!error) throw new Error(`expected error containing ${JSON.stringify(expected)}`);
  if (!error.message.includes(expected)) {
    throw new Error(`expected error containing ${JSON.stringify(expected)}, got ${error.message}`);
  }
}

function normalizedJson(value) {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizedJson(item)]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(normalizedJson(value));
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function call(fixture, name, args = {}) {
  const tool = fixture.tools.get(name);
  assert(tool, `unknown test tool: ${name}`);
  return tool.handler(args, fixture.ctx);
}

function writeCorpus(workspace, producerVersion, acceptedVersions) {
  writeFileSync(
    join(workspace, "src/producer.mjs"),
    `export const version = ${producerVersion};\n`,
  );
  writeFileSync(
    join(workspace, "src/consumer.mjs"),
    `export const accepted = ${JSON.stringify(acceptedVersions)};\n`,
  );
  writeFileSync(
    join(workspace, "test/unit-producer.mjs"),
    'import { version } from "../src/producer.mjs";\nif (!Number.isInteger(version)) process.exit(1);\n',
  );
  writeFileSync(
    join(workspace, "test/unit-consumer.mjs"),
    'import { accepted } from "../src/consumer.mjs";\nif (!Array.isArray(accepted) || accepted.length === 0) process.exit(1);\n',
  );
  writeFileSync(
    join(workspace, "test/integral.mjs"),
    'import { version } from "../src/producer.mjs";\nimport { accepted } from "../src/consumer.mjs";\nif (!accepted.includes(version)) { console.error(`version ${version} is rejected`); process.exit(17); }\n',
  );
}

function runScript(workspace, path) {
  const result = spawnSync(process.execPath, [path], { cwd: workspace, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { exit_code: result.status, output_hash: hash(output || "empty-output") };
}

function freshFixture() {
  const root = mkdtempSync(join(tmpdir(), "amanuensis-composition-"));
  const workspace = join(root, "workspace");
  const storage = join(root, "storage");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(join(workspace, "test"), { recursive: true });
  mkdirSync(storage, { recursive: true });
  git(workspace, "init", "-q");
  git(workspace, "config", "user.email", "test@localhost");
  git(workspace, "config", "user.name", "Composition Test");
  git(workspace, "config", "commit.gpgsign", "false");
  writeCorpus(workspace, 1, [1]);
  git(workspace, "add", "src", "test");
  git(workspace, "commit", "-q", "--no-verify", "-m", "compatible base");
  const base = git(workspace, "rev-parse", "HEAD");
  writeCorpus(workspace, 2, [1]);
  git(workspace, "add", "src/producer.mjs");
  git(workspace, "commit", "-q", "--no-verify", "-m", "producer v2 seam defect");
  const defect = git(workspace, "rev-parse", "HEAD");
  const project = {
    workspacePath: workspace,
    projectKey: "test/composition",
    storagePath: storage,
    dbPath: join(storage, "memory.db"),
    storageGitReady: false,
  };
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  const tools = new Map(
    [
      ...projectTools,
      ...evidenceTools,
      ...claimTools,
      ...impactTools,
      ...reviewTools,
      ...reviewAnalysisTools,
      ...artifactTools,
      ...compositionTools,
    ].map((tool) => [tool.name, tool]),
  );
  const fixture = { root, workspace, storage, base, defect, db, ctx, tools };
  const session = call(fixture, "start_session", { intent: "composition-controls" });
  ctx.sessionId = session.session_id;
  for (const [id, name] of [
    ["P", "producer"],
    ["C", "consumer"],
  ]) {
    db.prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, 'mapped')").run(id, name);
  }
  for (const [subsystem, path] of [
    ["P", "src/producer.mjs"],
    ["C", "src/consumer.mjs"],
  ]) {
    db.prepare(
      `INSERT INTO file_ledger
         (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at)
       VALUES (?, ?, 'composition fixture', 'examined', ?, datetime('now'))`,
    ).run(subsystem, path, base);
  }
  db.prepare(
    `INSERT INTO seams
       (id, shared_object, shared_object_kind, party_a, party_b,
        ordering_assumption, schema_owner)
     VALUES ('S-PC', 'event version', 'event-bus', 'P', 'C', 'producer before consumer', 'P')`,
  ).run();
  db.prepare(
    `INSERT INTO concerns (code, category, origin, status, notes)
     VALUES ('SC-1', 'seam-contract', 'seeded', 'active', 'Version compatibility')`,
  ).run();
  return {
    ...fixture,
    cleanup: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function passSpecs(runId, profile) {
  return [
    ...[1, 2].map((n) => ({
      pass_id: `${runId}:g${n}`,
      role: "generator",
      replicate_id: `g${n}`,
      context_profile: profile,
      analytical_frame: "composition",
      provider: "fixture",
      model: "fixture-generator",
      model_family: "fixture-generator-family",
      runtime: "fixture-runtime",
      planned_tokens: 10,
      planned_cost_microusd: 0,
    })),
    ...["refuter", "verifier"].flatMap((role) =>
      [1, 2].map((n) => ({
        pass_id: `${runId}:${role[0]}${n}`,
        role,
        replicate_id: `${role[0]}${n}`,
        context_profile: profile,
        analytical_frame: role,
        provider: "fixture",
        model: `fixture-${role}`,
        model_family: `fixture-${role}-family`,
        runtime: "fixture-runtime",
        planned_tokens: 10,
        planned_cost_microusd: 0,
      })),
    ),
  ];
}

function createReview(fixture, impactRunId, targetSha, runId, profile) {
  const briefId = `${runId}:brief`;
  call(fixture, "compile_review_brief", {
    brief_id: briefId,
    impact_run_id: impactRunId,
    task: "Verify the assembled event-version contract.",
    task_constraints: [
      {
        constraint_id: "compatibility",
        statement: "The consumer must accept every emitted producer version.",
        source_kind: "direct-user",
        source_ref: "composition-fixture",
      },
    ],
    context_profile: profile,
    token_budget: 20_000,
  });
  call(fixture, "publish_review_brief", { brief_id: briefId });
  const specs = passSpecs(runId, profile);
  call(fixture, "plan_review_analysis", {
    run_id: runId,
    replicate_id: "r1",
    condition: "same-context",
    orchestrator_model_family: "orchestrator",
    provider_allowlist: ["fixture"],
    allowed_source_prefixes: ["src", "test"],
    max_total_tokens: 100,
    max_total_cost_microusd: 0,
    blind_assignment_id: `${runId}:blind`,
    sealed_truth_hash: hash(`${runId}:unused-seal`),
    brief_ids: [briefId],
    pass_specs: specs,
  });
  for (const pass of specs.filter((pass) => pass.role === "generator")) {
    call(fixture, "dispatch_review_pass", { run_id: runId, pass_id: pass.pass_id });
    call(fixture, "land_review_pass", {
      run_id: runId,
      pass_id: pass.pass_id,
      judgments: [],
      no_findings_reason: "No candidate emitted in the composition custody fixture.",
      coverage: { areas_checked: ["version contract"] },
      actual_tokens: 1,
      actual_cost_microusd: 0,
    });
  }
  call(fixture, "freeze_review_hypotheses", { run_id: runId });
  for (const role of ["refuter", "verifier"]) {
    const roleSpecs = specs.filter((pass) => pass.role === role);
    for (const pass of roleSpecs) {
      call(fixture, "dispatch_review_pass", { run_id: runId, pass_id: pass.pass_id });
    }
    for (const pass of roleSpecs) {
      call(fixture, "land_review_pass", {
        run_id: runId,
        pass_id: pass.pass_id,
        judgments: [],
        actual_tokens: 1,
        actual_cost_microusd: 0,
      });
    }
  }
  const result = call(fixture, "aggregate_review_analysis", { run_id: runId });
  assertEqual(result.reviewed_sha, targetSha, `${profile} review target`);
  return runId;
}

function prepareTarget(fixture, baseSha, targetSha, label) {
  const impactRunId = `${label}:impact`;
  const impact = call(fixture, "predict_change_impact", {
    base_sha: baseSha,
    head_sha: targetSha,
    run_id: impactRunId,
  });
  assert(
    impact.mapped_objects.some(
      (object) => object.object_type === "seam" && object.object_id === "S-PC",
    ),
    "fixture impact did not reach the producer-consumer seam",
  );
  const unitReview = createReview(
    fixture,
    impactRunId,
    targetSha,
    `${label}:unit-review`,
    "diff-scoped",
  );
  const integralReview = createReview(
    fixture,
    impactRunId,
    targetSha,
    `${label}:integral-review`,
    "integral-head",
  );
  const artifactPath = `${label}-unit-report.md`;
  const artifactContent = `# ${label}\n\nUnit verification at ${targetSha}.\n`;
  writeFileSync(join(fixture.storage, artifactPath), artifactContent);
  call(fixture, "register_artifact", {
    path: artifactPath,
    kind: "other",
    ref_sha: targetSha,
  });
  return {
    impactRunId,
    unitReview,
    integralReview,
    artifactPath,
    artifactHash: hash(artifactContent),
  };
}

function itemSpecs(label, targetSha, target) {
  return [
    {
      item_id: `${label}:artifact`,
      item_kind: "artifact",
      verification_scope: "unit",
      subject: "producer artifact",
      expected_ref: target.artifactPath,
      target_sha: targetSha,
    },
    {
      item_id: `${label}:commit`,
      item_kind: "commit",
      verification_scope: "unit",
      subject: "producer commit",
      expected_ref: targetSha,
      target_sha: targetSha,
    },
    {
      item_id: `${label}:unit-test`,
      item_kind: "test",
      verification_scope: "unit",
      subject: "producer unit test",
      expected_ref: "test/unit-producer.mjs",
      target_sha: targetSha,
    },
    {
      item_id: `${label}:unit-review`,
      item_kind: "review-result",
      verification_scope: "unit",
      subject: "unit review",
      expected_ref: target.unitReview,
      target_sha: targetSha,
    },
    {
      item_id: `${label}:integral-test`,
      item_kind: "test",
      verification_scope: "integral-head",
      subject: "producer-consumer contract",
      expected_ref: "test/integral.mjs",
      target_sha: targetSha,
    },
    {
      item_id: `${label}:integral-review-item`,
      item_kind: "review-result",
      verification_scope: "integral-head",
      subject: "integral review",
      expected_ref: target.integralReview,
      target_sha: targetSha,
    },
  ];
}

function planComposition(fixture, label, targetSha, target, overrides = {}) {
  return call(fixture, "plan_composition_run", {
    run_id: label,
    impact_run_id: target.impactRunId,
    assembled_head_sha: targetSha,
    expected_items: itemSpecs(label, targetSha, target),
    seam_concerns: [
      {
        seam_id: "S-PC",
        concern_code: "SC-1",
        rationale: "Producer output must remain inside the consumer acceptance set.",
      },
    ],
    ...overrides,
  });
}

function landAndScore(fixture, runId, itemId, observation) {
  call(fixture, "dispatch_composition_item", { run_id: runId, item_id: itemId });
  call(fixture, "land_composition_item", { run_id: runId, item_id: itemId, observation });
  return call(fixture, "score_composition_item", { run_id: runId, item_id: itemId });
}

function passUnitFanIn(fixture, runId, targetSha, target) {
  const unitResult = runScript(fixture.workspace, "test/unit-producer.mjs");
  assertEqual(unitResult.exit_code, 0, "producer local test");
  const consumerResult = runScript(fixture.workspace, "test/unit-consumer.mjs");
  assertEqual(consumerResult.exit_code, 0, "consumer local test");
  for (const [suffix, observation] of [
    ["artifact", { artifact_path: target.artifactPath, content_hash: target.artifactHash }],
    ["commit", { commit_sha: targetSha }],
    [
      "unit-test",
      {
        test_id: "test/unit-producer.mjs",
        tested_sha: targetSha,
        exit_code: unitResult.exit_code,
        output_hash: unitResult.output_hash,
      },
    ],
    ["unit-review", { review_run_id: target.unitReview }],
  ]) {
    const score = landAndScore(fixture, runId, `${runId}:${suffix}`, observation);
    assertEqual(score.verdict, "pass", `${suffix} score`);
  }
}

function passIntegralCheckout(fixture, runId, targetSha) {
  const lane = call(fixture, "dispatch_integral_verification", { run_id: runId });
  assertEqual(lane.verification_object, "integral-head", "integral verification object");
  assertEqual(lane.seam_concerns.length, 1, "integral seam concern count");
  const dirtyPaths = git(fixture.workspace, "status", "--porcelain").split("\n").filter(Boolean);
  call(fixture, "land_integral_verification", {
    run_id: runId,
    checkout_head_sha: targetSha,
    checkout_tree_sha: git(fixture.workspace, "rev-parse", `${targetSha}^{tree}`),
    checkout_mode: "clean-worktree",
    dirty_paths: dirtyPaths,
    execution_report_hash: hash(`${runId}:clean-checkout`),
  });
  const score = call(fixture, "score_integral_verification", { run_id: runId });
  assertEqual(score.verdict, "pass", "integral checkout score");
}

const fixture = freshFixture();
const defectTarget = prepareTarget(fixture, fixture.base, fixture.defect, "defect");

test("fixture declares both sides of the composition control ladder", () => {
  assertEqual(MANIFEST.unitKinds, ["artifact", "commit", "test", "review-result"], "unit kinds");
  assertEqual(MANIFEST.integralKinds, ["test", "review-result"], "integral kinds");
  assertEqual(MANIFEST.redGates.length, 5, "red-gate denominator");
});

test("worker success without its expected artifact keeps fan-in red", () => {
  const label = "missing-artifact";
  const target = { ...defectTarget, artifactPath: "not-created.md", artifactHash: hash("missing") };
  planComposition(fixture, label, fixture.defect, target);
  const score = landAndScore(fixture, label, `${label}:artifact`, {
    artifact_path: "not-created.md",
    content_hash: target.artifactHash,
    worker_status: "success",
  });
  assertEqual(score.verdict, "fail", "missing artifact score");
  const reconciliation = call(fixture, "reconcile_composition_run", { run_id: label });
  assertEqual(reconciliation.status, "red", "missing artifact reconciliation");
  assertEqual(reconciliation.fan_in.expected, 6, "expected fan-in denominator");
  assert(reconciliation.fan_in.passed < 6, "missing artifact manufactured exact fan-in");
  assertThrows(
    () =>
      fixture.db
        .prepare("UPDATE composition_items SET status='scored-pass' WHERE item_id=?")
        .run(`${label}:commit`),
    "invalid composition item status transition",
  );
});

test("subsystem-local checks pass while the seeded seam defect blocks integral HEAD", () => {
  const label = "seam-defect";
  planComposition(fixture, label, fixture.defect, defectTarget);
  passUnitFanIn(fixture, label, fixture.defect, defectTarget);
  passIntegralCheckout(fixture, label, fixture.defect);
  const integral = runScript(fixture.workspace, "test/integral.mjs");
  assertEqual(integral.exit_code, 17, "seeded seam-only defect exit");
  const testScore = landAndScore(fixture, label, `${label}:integral-test`, {
    test_id: "test/integral.mjs",
    tested_sha: fixture.defect,
    exit_code: integral.exit_code,
    output_hash: integral.output_hash,
  });
  assertEqual(testScore.verdict, "fail", "integral seam test score");
  const reviewScore = landAndScore(fixture, label, `${label}:integral-review-item`, {
    review_run_id: defectTarget.integralReview,
  });
  assertEqual(reviewScore.verdict, "pass", "integral review custody score");
  const result = call(fixture, "reconcile_composition_run", { run_id: label });
  assertEqual(result.status, "red", "seam defect final status");
  assertEqual(
    result.fan_in,
    {
      expected: 6,
      dispatched: 6,
      landed: 6,
      scored: 6,
      passed: 5,
      failed: 1,
      deferred: 0,
    },
    "seam defect fan-in",
  );
  assertThrows(
    () =>
      fixture.db
        .prepare("DELETE FROM composition_items WHERE item_id=?")
        .run(`${label}:integral-test`),
    "composition item cannot be deleted",
  );
});

test("a deferred composition concern remains a named RED obligation", () => {
  const label = "deferred";
  planComposition(fixture, label, fixture.defect, defectTarget);
  fixture.db
    .prepare(
      `INSERT INTO revalidation_obligations
         (obligation_id, trigger_type, trigger_id, destination_type, destination_id,
          source_impact_run_id, blocking, owner, priority, state)
       VALUES ('deferred:obligation', 'manual', 'composition-test', 'seam', 'S-PC',
               ?, 1, 'fixture', 1, 'deferred')`,
    )
    .run(defectTarget.impactRunId);
  call(fixture, "record_composition_deferral", {
    run_id: label,
    deferral_id: "deferred:one",
    concern: "Compatibility proof must be rerun against the downstream client.",
    obligation_id: "deferred:obligation",
  });
  const result = call(fixture, "reconcile_composition_run", { run_id: label });
  assertEqual(result.status, "red", "deferred composition status");
  assertEqual(result.fan_in.deferred, 1, "deferred denominator");
  assertEqual(result.deferrals[0].obligation_id, "deferred:obligation", "deferral destination");
});

test("integral results are bound to exact HEAD and a clean checkout", () => {
  assertThrows(
    () =>
      call(fixture, "plan_composition_run", {
        run_id: "old-head",
        impact_run_id: defectTarget.impactRunId,
        assembled_head_sha: fixture.base,
        expected_items: itemSpecs("old-head", fixture.base, defectTarget),
        seam_concerns: [{ seam_id: "S-PC", concern_code: "SC-1", rationale: "old head control" }],
      }),
    "currently checked-out HEAD",
  );
});

test("the repaired composition reaches green only after exact integral fan-in", () => {
  writeCorpus(fixture.workspace, 2, [1, 2]);
  git(fixture.workspace, "add", "src/consumer.mjs");
  git(fixture.workspace, "commit", "-q", "--no-verify", "-m", "accept producer v2");
  const fixed = git(fixture.workspace, "rev-parse", "HEAD");
  const target = prepareTarget(fixture, fixture.defect, fixed, "fixed");
  const label = "fixed-composition";
  planComposition(fixture, label, fixed, target);
  passUnitFanIn(fixture, label, fixed, target);
  const pre = call(fixture, "reconcile_composition_run", { run_id: label });
  assertEqual(pre.status, "red", "pre-integral fan-in must be red");
  passIntegralCheckout(fixture, label, fixed);
  assertThrows(
    () =>
      fixture.db.prepare("UPDATE composition_runs SET status='complete' WHERE run_id=?").run(label),
    "invalid composition status transition",
  );
  const integral = runScript(fixture.workspace, "test/integral.mjs");
  assertEqual(integral.exit_code, 0, "repaired integral test");
  landAndScore(fixture, label, `${label}:integral-test`, {
    test_id: "test/integral.mjs",
    tested_sha: fixed,
    exit_code: integral.exit_code,
    output_hash: integral.output_hash,
  });
  landAndScore(fixture, label, `${label}:integral-review-item`, {
    review_run_id: target.integralReview,
  });
  const result = call(fixture, "reconcile_composition_run", { run_id: label });
  assertEqual(result.status, "green", "repaired composition final status");
  assertEqual(result.fan_in.passed, result.fan_in.expected, "repaired exact fan-in");
  const stored = call(fixture, "get_composition_run", { run_id: label });
  assertEqual(stored.status, "complete", "repaired run status");
  assertEqual(
    stored.reconciliations.map((row) => row.status),
    ["red", "green"],
    "reconciliation history",
  );
});

fixture.cleanup();
console.log(`\ncomposition verification: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
