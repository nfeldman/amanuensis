#!/usr/bin/env node
// A7: independent generation, blind refutation, verification, and evaluation.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./dist/db.js";
import { claimTools } from "./dist/tools/claims.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { impactTools } from "./dist/tools/impact.js";
import { projectTools } from "./dist/tools/project.js";
import { reviewTools } from "./dist/tools/review.js";
import { reviewAnalysisTools } from "./dist/tools/review-analysis.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "fixtures/review-analysis/manifest.json"), "utf8"),
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

function sealTruth(salt, truth) {
  return hash(`${salt}\u0000${stableJson(truth)}`);
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function call(fixture, name, args = {}) {
  const tool = fixture.tools.get(name);
  assert(tool, `unknown test tool: ${name}`);
  return tool.handler(args, fixture.ctx);
}

function allKeys(value, destination = []) {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, destination);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      destination.push(key);
      allKeys(item, destination);
    }
  }
  return destination;
}

function freshFixture() {
  const root = mkdtempSync(join(tmpdir(), "amanuensis-review-analysis-"));
  const workspace = join(root, "workspace");
  const storage = join(root, "storage");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(storage, { recursive: true });
  git(workspace, "init", "-q");
  git(workspace, "config", "user.email", "test@localhost");
  git(workspace, "config", "user.name", "Review Analysis Test");
  git(workspace, "config", "commit.gpgsign", "false");

  writeFileSync(join(workspace, "src/service.ts"), "export const eventVersion = 1;\n");
  writeFileSync(join(workspace, "src/consumer.ts"), "export const accepted = [1];\n");
  writeFileSync(join(workspace, "src/unrelated.ts"), "export const unrelated = true;\n");
  git(workspace, "add", "src");
  git(workspace, "commit", "-q", "--no-verify", "-m", "base");
  const base = git(workspace, "rev-parse", "HEAD");
  const armSources = {
    clean: "export const eventVersion = 1 as const;\n",
    "marker-only": "// review-control: compatibility\nexport const eventVersion = 1 as const;\n",
    treated: "// review-control: compatibility\nexport const eventVersion = 2;\n",
    null: "export const eventVersion = 1 satisfies number;\n",
  };
  const armHeads = {};
  for (const [arm, source] of Object.entries(armSources)) {
    git(workspace, "switch", "-q", "-c", `fixture-${arm}`, base);
    writeFileSync(join(workspace, "src/service.ts"), source);
    git(workspace, "add", "src/service.ts");
    git(workspace, "commit", "-q", "--no-verify", "-m", `${arm} arm`);
    armHeads[arm] = git(workspace, "rev-parse", "HEAD");
  }
  git(workspace, "switch", "-q", "fixture-treated");
  const head = armHeads.treated;

  const project = {
    workspacePath: workspace,
    projectKey: "test/review-analysis",
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
    ].map((tool) => [tool.name, tool]),
  );
  const fixture = { root, workspace, storage, base, head, db, ctx, tools };
  const session = call(fixture, "start_session", { intent: "review-analysis-controls" });
  ctx.sessionId = session.session_id;

  for (const [id, name] of [
    ["A", "producer"],
    ["B", "adapter"],
    ["C", "consumer"],
    ["D", "unrelated control"],
  ]) {
    db.prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, 'mapped')").run(id, name);
  }
  for (const [subsystem, path] of [
    ["A", "src/service.ts"],
    ["C", "src/consumer.ts"],
    ["D", "src/unrelated.ts"],
  ]) {
    db.prepare(
      `INSERT INTO file_ledger
         (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at)
       VALUES (?, ?, 'A7 fixture', 'examined', ?, datetime('now'))`,
    ).run(subsystem, path, base);
  }
  db.prepare(
    `INSERT INTO xrefs (from_id, to_id, relationship, strength, context)
     VALUES ('A', 'B', 'dependency', 'structural', 'B adapts A events')`,
  ).run();
  db.prepare(
    `INSERT INTO seams
       (id, shared_object, shared_object_kind, party_a, party_b,
        ordering_assumption, staleness_tolerance)
     VALUES ('S-BC', 'events', 'event-bus', 'B', 'C', 'causal', 'bounded:5s')`,
  ).run();

  const serviceEvidence = call(fixture, "add_evidence", {
    file_path: "src/service.ts",
    ref_sha: base,
    kind: "code-verified",
    excerpt: "eventVersion = 1",
    note: "producer contract",
  }).id;
  const consumerEvidence = call(fixture, "add_evidence", {
    file_path: "src/consumer.ts",
    ref_sha: base,
    kind: "code-verified",
    excerpt: "accepted = [1]",
    note: "consumer contract",
  }).id;
  const unrelatedEvidence = call(fixture, "add_evidence", {
    file_path: "src/unrelated.ts",
    ref_sha: base,
    kind: "code-verified",
    note: "valid but never assigned to the review packet",
  }).id;
  for (const [claimId, subjectId, evidenceId] of [
    ["claim-a", "A", serviceEvidence],
    ["claim-b", "B", consumerEvidence],
    ["claim-c", "C", consumerEvidence],
    ["claim-control", "D", unrelatedEvidence],
  ]) {
    call(fixture, "add_claim", {
      claim_id: claimId,
      claim_key: `fixture.${claimId}`,
      subject_type: "subsystem",
      subject_id: subjectId,
      statement: `${claimId} remains compatible.`,
      epistemic_kind: "observation",
      ref_sha: base,
      evidence_ids: [evidenceId],
    });
  }
  const briefIdsByArm = {};
  for (const [arm, armHead] of Object.entries(armHeads)) {
    const impactRunId = `a7-impact-${arm}`;
    call(fixture, "predict_change_impact", {
      base_sha: base,
      head_sha: armHead,
      run_id: impactRunId,
    });
    briefIdsByArm[arm] = {};
    const constraints =
      arm === "null"
        ? [
            {
              constraint_id: "require-v1",
              statement: "The only valid event version is exactly 1.",
              source_kind: "direct-user",
              source_ref: "null:left",
            },
            {
              constraint_id: "require-v2",
              statement: "The only valid event version is exactly 2.",
              source_kind: "direct-user",
              source_ref: "null:right",
            },
          ]
        : [
            {
              constraint_id: "preserve-contract",
              statement: "Preserve backward event compatibility.",
              source_kind: "direct-user",
              source_ref: "request:A7",
            },
          ];
    for (const profile of ["diff-scoped", "control-wide", "integral-head"]) {
      const briefId = `a7-brief-${arm}-${profile}`;
      call(fixture, "compile_review_brief", {
        brief_id: briefId,
        impact_run_id: impactRunId,
        task:
          arm === "null"
            ? "Produce one unconditional event-version recommendation."
            : "Review event-version compatibility without changing the public contract.",
        task_constraints: constraints,
        context_profile: profile,
        token_budget: 20_000,
      });
      call(fixture, "publish_review_brief", { brief_id: briefId });
      briefIdsByArm[arm][profile] = briefId;
    }
  }
  return {
    ...fixture,
    serviceEvidence,
    consumerEvidence,
    unrelatedEvidence,
    armHeads,
    briefIdsByArm,
    briefIds: briefIdsByArm.treated,
    cleanup: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function truthFor(runId, condition, arm, replicate) {
  const armSpec = MANIFEST.arms.find((candidate) => candidate.armType === arm);
  const replicateId = `r${replicate}`;
  return {
    assignment_id: `${runId}:assignment`,
    arm_type: arm,
    pair_id: `${condition}:${replicateId}`,
    replicate_id: replicateId,
    surface_contract_hash: hash(stableJson(MANIFEST.surfaceContract)),
    expected_finding_keys: armSpec.expectedFindingKeys,
    leak_canary: `${runId}:sealed-canary`,
  };
}

function passSpecs(runId, condition) {
  const generators = [0, 1].map((index) => {
    let profile = "diff-scoped";
    let frame = "contract-risk";
    let family = "family-a";
    if (condition === "varied-context" && index === 1) {
      profile = "control-wide";
      frame = "historical-counterexample";
    }
    if (condition === "heterogeneous-runtime" && index === 1) family = "family-b";
    return {
      pass_id: `${runId}:g${index + 1}`,
      role: "generator",
      replicate_id: `g${index + 1}`,
      context_profile: profile,
      analytical_frame: frame,
      provider: "fixture-provider",
      model: `${family}-model`,
      model_family: family,
      runtime: "fixture-runtime",
      planned_tokens: 10,
      planned_cost_microusd: 0,
    };
  });
  const challenges = ["refuter", "verifier"].flatMap((role) =>
    [0, 1].map((index) => ({
      pass_id: `${runId}:${role[0]}${index + 1}`,
      role,
      replicate_id: `${role[0]}${index + 1}`,
      context_profile: "diff-scoped",
      analytical_frame: role === "refuter" ? "fair-refutation" : "evidence-verification",
      provider: "fixture-provider",
      model: `${role}-model`,
      model_family: `${role}-family`,
      runtime: "fixture-runtime",
      planned_tokens: 10,
      planned_cost_microusd: 0,
    })),
  );
  return [...generators, ...challenges];
}

function planRun(fixture, runId, condition, truth, salt, overrides = {}) {
  return call(fixture, "plan_review_analysis", {
    run_id: runId,
    replicate_id: truth.replicate_id,
    condition,
    orchestrator_model_family: "orchestrator-family",
    provider_allowlist: ["fixture-provider"],
    allowed_source_prefixes: ["src"],
    max_total_tokens: 100,
    max_total_cost_microusd: 0,
    blind_assignment_id: truth.assignment_id,
    sealed_truth_hash: sealTruth(salt, truth),
    brief_ids: Object.values(fixture.briefIdsByArm[truth.arm_type]),
    pass_specs: passSpecs(runId, condition),
    ...overrides,
  });
}

function generatorCandidate(fixture, findingKey) {
  return {
    finding_key: findingKey,
    claim:
      findingKey === "known-defect"
        ? "The consumer rejects the changed event version."
        : "The marker comment changes runtime compatibility.",
    severity: "HIGH",
    scope: "event delivery",
    rationale: `generator rationale for ${findingKey}`,
    evidence_ids: [fixture.serviceEvidence],
  };
}

function landGenerator(fixture, passId, findings) {
  const args = {
    run_id: passId.split(":g")[0],
    pass_id: passId,
    judgments: findings.map((key) => generatorCandidate(fixture, key)),
    actual_tokens: 1,
    actual_cost_microusd: 0,
  };
  if (findings.length === 0) {
    args.no_findings_reason = "No evidence-backed candidate survived the assigned frame.";
    args.coverage = { areas_checked: ["changed files", "impacted seams"] };
  }
  return call(fixture, "land_review_pass", args);
}

function hypotheses(fixture, runId) {
  return fixture.db
    .prepare(
      "SELECT hypothesis_id, finding_key, challenge_packet_json FROM review_hypotheses WHERE run_id=? ORDER BY ordinal",
    )
    .all(runId)
    .map((row) => ({ ...row, packet: JSON.parse(row.challenge_packet_json) }));
}

function completeCalibrationRun(fixture, runId, condition, arm, replicate) {
  const truth = truthFor(runId, condition, arm, replicate);
  const salt = `${runId}:salt`;
  planRun(fixture, runId, condition, truth, salt);
  const generatorPasses = passSpecs(runId, condition).filter((pass) => pass.role === "generator");
  const generated = arm === "treated" ? ["known-defect"] : [];
  for (const pass of generatorPasses) {
    call(fixture, "dispatch_review_pass", { run_id: runId, pass_id: pass.pass_id });
    landGenerator(fixture, pass.pass_id, generated);
  }
  call(fixture, "freeze_review_hypotheses", { run_id: runId });
  const frozen = hypotheses(fixture, runId);
  const refuters = passSpecs(runId, condition).filter((pass) => pass.role === "refuter");
  for (const pass of refuters) {
    call(fixture, "dispatch_review_pass", { run_id: runId, pass_id: pass.pass_id });
  }
  for (const pass of refuters) {
    call(fixture, "land_review_pass", {
      run_id: runId,
      pass_id: pass.pass_id,
      judgments: frozen.map((hypothesis) => ({
        hypothesis_id: hypothesis.hypothesis_id,
        verdict: "upheld",
        rationale: "The compatibility defect survives refutation.",
        evidence_ids: [fixture.serviceEvidence],
      })),
      actual_tokens: 1,
      actual_cost_microusd: 0,
    });
  }
  const verifiers = passSpecs(runId, condition).filter((pass) => pass.role === "verifier");
  for (const pass of verifiers) {
    call(fixture, "dispatch_review_pass", { run_id: runId, pass_id: pass.pass_id });
  }
  for (const pass of verifiers) {
    call(fixture, "land_review_pass", {
      run_id: runId,
      pass_id: pass.pass_id,
      judgments: frozen.map((hypothesis) => ({
        hypothesis_id: hypothesis.hypothesis_id,
        verdict: "upheld",
        rationale: "The structured evidence independently supports the claim.",
        evidence_ids: [fixture.serviceEvidence],
      })),
      actual_tokens: 1,
      actual_cost_microusd: 0,
    });
  }
  call(fixture, "aggregate_review_analysis", { run_id: runId });
  call(fixture, "reveal_review_analysis_truth", { run_id: runId, salt, truth });
  return runId;
}

const fixture = freshFixture();

test("condition policies vary exactly the intended generator axis", () => {
  const truth = truthFor("invalid-condition", "same-context", "clean", 1);
  const specs = passSpecs("invalid-condition", "same-context");
  specs[1].context_profile = "control-wide";
  assertThrows(
    () =>
      planRun(fixture, "invalid-condition", "same-context", truth, "salt", {
        pass_specs: specs,
      }),
    "same-context must hold profile, frame, provider, model, and runtime fixed",
  );
  const challengeTruth = truthFor("invalid-challenge", "same-context", "clean", 1);
  const challengeSpecs = passSpecs("invalid-challenge", "same-context");
  challengeSpecs.find((pass) => pass.pass_id.endsWith(":r2")).model = "different-refuter";
  assertThrows(
    () =>
      planRun(fixture, "invalid-challenge", "same-context", challengeTruth, "salt", {
        pass_specs: challengeSpecs,
      }),
    "refuter replicates must hold model fixed",
  );
});

test("independent passes stay blind and a false positive needs new verified disproof", () => {
  const runId = "independent-main";
  const truth = {
    ...truthFor(runId, "same-context", "treated", 1),
    expected_finding_keys: ["real-defect"],
  };
  const salt = "independent-main:salt";
  planRun(fixture, runId, "same-context", truth, salt);
  const generators = passSpecs(runId, "same-context").filter((pass) => pass.role === "generator");
  const firstDispatch = call(fixture, "dispatch_review_pass", {
    run_id: runId,
    pass_id: generators[0].pass_id,
  });
  assert(
    firstDispatch.runtime_input.evidence_catalog.some(
      (evidence) => evidence.id === fixture.serviceEvidence,
    ),
    "assigned generator evidence missing",
  );
  assert(
    !firstDispatch.runtime_input.evidence_catalog.some(
      (evidence) => evidence.id === fixture.unrelatedEvidence,
    ),
    "unrelated evidence leaked into generator packet",
  );
  assertThrows(
    () =>
      call(fixture, "land_review_pass", {
        run_id: runId,
        pass_id: generators[0].pass_id,
        judgments: [
          {
            ...generatorCandidate(fixture, "real-defect"),
            evidence_ids: [fixture.unrelatedEvidence],
          },
        ],
        actual_tokens: 1,
        actual_cost_microusd: 0,
      }),
    "evidence not assigned",
  );
  landGenerator(fixture, generators[0].pass_id, ["false-positive", "real-defect"]);
  assertThrows(
    () => call(fixture, "freeze_review_hypotheses", { run_id: runId }),
    "generator passes have not landed",
  );
  call(fixture, "dispatch_review_pass", { run_id: runId, pass_id: generators[1].pass_id });
  landGenerator(fixture, generators[1].pass_id, ["false-positive", "real-defect"]);
  const preFreeze = call(fixture, "get_review_analysis", { run_id: runId });
  assert(
    preFreeze.passes.every((pass) => !("runtime_input_json" in pass) && !("result_json" in pass)),
    "pre-aggregation read leaked private pass payloads",
  );
  call(fixture, "freeze_review_hypotheses", { run_id: runId });
  const frozen = hypotheses(fixture, runId);
  assertEqual(
    frozen.map((item) => item.finding_key).sort(),
    ["false-positive", "real-defect"],
    "frozen hypothesis set",
  );
  for (const hypothesis of frozen) {
    const keys = allKeys(hypothesis.packet);
    for (const forbidden of MANIFEST.surfaceContract.forbiddenChallengeKeys) {
      assert(!keys.includes(forbidden), `challenge packet leaked ${forbidden}`);
    }
  }

  const refuters = passSpecs(runId, "same-context").filter((pass) => pass.role === "refuter");
  const refuterPackets = refuters.map((pass) =>
    call(fixture, "dispatch_review_pass", { run_id: runId, pass_id: pass.pass_id }),
  );
  assertEqual(
    refuterPackets[0].runtime_input.hypotheses,
    refuterPackets[1].runtime_input.hypotheses,
    "refuters did not receive the same frozen pre-judgment packet",
  );
  const falseHypothesis = frozen.find((item) => item.finding_key === "false-positive");
  const realHypothesis = frozen.find((item) => item.finding_key === "real-defect");
  assertThrows(
    () =>
      call(fixture, "land_review_pass", {
        run_id: runId,
        pass_id: refuters[0].pass_id,
        judgments: [
          {
            hypothesis_id: falseHypothesis.hypothesis_id,
            verdict: "overturned",
            rationale: "Existing evidence is not enough.",
            evidence_ids: [fixture.serviceEvidence],
          },
          {
            hypothesis_id: realHypothesis.hypothesis_id,
            verdict: "upheld",
            rationale: "The defect remains.",
            evidence_ids: [fixture.serviceEvidence],
          },
        ],
        actual_tokens: 1,
        actual_cost_microusd: 0,
      }),
    "newly discovered evidence",
  );
  assertThrows(
    () =>
      call(fixture, "land_review_pass", {
        run_id: runId,
        pass_id: refuters[0].pass_id,
        judgments: [
          {
            hypothesis_id: falseHypothesis.hypothesis_id,
            verdict: "overturned",
            rationale: "A nonexistent source cannot disprove the claim.",
            new_evidence_keys: ["missing-disproof"],
          },
          {
            hypothesis_id: realHypothesis.hypothesis_id,
            verdict: "upheld",
            rationale: "The defect remains.",
            evidence_ids: [fixture.serviceEvidence],
          },
        ],
        new_evidence: [
          {
            local_key: "missing-disproof",
            file_path: "src/does-not-exist.ts",
            ref_sha: fixture.head,
            kind: "code-verified",
            note: "invalid fixture evidence",
          },
        ],
        actual_tokens: 1,
        actual_cost_microusd: 0,
      }),
    "evidence source does not exist at ref_sha",
  );
  call(fixture, "land_review_pass", {
    run_id: runId,
    pass_id: refuters[0].pass_id,
    judgments: [
      {
        hypothesis_id: falseHypothesis.hypothesis_id,
        verdict: "overturned",
        rationale: "Comments do not affect runtime behavior.",
        new_evidence_keys: ["disproof"],
      },
      {
        hypothesis_id: realHypothesis.hypothesis_id,
        verdict: "upheld",
        rationale: "No compensating compatibility path exists.",
        evidence_ids: [fixture.serviceEvidence],
      },
    ],
    new_evidence: [
      {
        local_key: "disproof",
        file_path: "src/consumer.ts",
        ref_sha: fixture.head,
        kind: "code-verified",
        excerpt: "accepted = [1]",
        note: "new refuter evidence",
      },
    ],
    actual_tokens: 1,
    actual_cost_microusd: 0,
  });
  call(fixture, "land_review_pass", {
    run_id: runId,
    pass_id: refuters[1].pass_id,
    judgments: [
      {
        hypothesis_id: falseHypothesis.hypothesis_id,
        verdict: "upheld",
        rationale: "This refuter did not locate the compensating mechanism.",
        evidence_ids: [fixture.serviceEvidence],
      },
      {
        hypothesis_id: realHypothesis.hypothesis_id,
        verdict: "upheld",
        rationale: "The version mismatch remains visible.",
        evidence_ids: [fixture.serviceEvidence],
      },
    ],
    actual_tokens: 1,
    actual_cost_microusd: 0,
  });
  const disproofId = fixture.db
    .prepare("SELECT id FROM evidence WHERE note='new refuter evidence'")
    .get().id;

  const verifiers = passSpecs(runId, "same-context").filter((pass) => pass.role === "verifier");
  const verifierPackets = verifiers.map((pass) =>
    call(fixture, "dispatch_review_pass", { run_id: runId, pass_id: pass.pass_id }),
  );
  for (const packet of verifierPackets) {
    const keys = allKeys(packet.runtime_input.hypotheses);
    assert(
      !keys.includes("verdict") && !keys.includes("rationale"),
      "verifier saw a prior verdict",
    );
    assert(
      packet.runtime_input.hypotheses.some((hypothesis) =>
        hypothesis.evidence.some((evidence) => evidence.id === disproofId),
      ),
      "verifier did not receive newly discovered evidence",
    );
    assert(
      !stableJson(packet.runtime_input).includes("Comments do not affect runtime behavior."),
      "verifier saw refuter rationale content under a renamed field",
    );
  }
  for (const pass of verifiers) {
    call(fixture, "land_review_pass", {
      run_id: runId,
      pass_id: pass.pass_id,
      judgments: [
        {
          hypothesis_id: falseHypothesis.hypothesis_id,
          verdict: "overturned",
          rationale: "The new evidence independently disproves runtime effect.",
          evidence_ids: [disproofId],
        },
        {
          hypothesis_id: realHypothesis.hypothesis_id,
          verdict: "upheld",
          rationale: "The version mismatch is evidence-backed.",
          evidence_ids: [fixture.serviceEvidence],
        },
      ],
      actual_tokens: 1,
      actual_cost_microusd: 0,
    });
  }
  const aggregated = call(fixture, "aggregate_review_analysis", { run_id: runId });
  const results = aggregated.aggregation.result.hypotheses;
  assertEqual(
    results.map((item) => [item.finding_key, item.final_status]),
    [
      ["false-positive", "defeated"],
      ["real-defect", "survived"],
    ],
    "mechanical aggregation",
  );
  assertEqual(aggregated.aggregation.result.disagreements.length, 1, "retained disagreement");
  assertEqual(
    aggregated.aggregation.result.defeated_hypotheses[0].evidence_that_moved_status,
    [disproofId],
    "evidence that moved status",
  );
  call(fixture, "reveal_review_analysis_truth", { run_id: runId, salt, truth });
  assertThrows(
    () =>
      fixture.db
        .prepare("UPDATE review_passes SET model='tampered' WHERE pass_id=?")
        .run(generators[0].pass_id),
    "identity and plan are immutable",
  );
  assertThrows(
    () =>
      fixture.db
        .prepare(
          `INSERT INTO review_judgments
             (judgment_id, pass_id, hypothesis_id, finding_key, claim, verdict,
              rationale, payload_json, payload_hash)
           VALUES ('late-judgment', ?, NULL, 'late', 'late', 'proposed',
                   'late', '{}', 'late')`,
        )
        .run(generators[0].pass_id),
    "only for a dispatched pass",
  );
});

const contaminatedRunIds = [];
test("blind truth and prior-verdict leak controls contaminate before provider judgment", () => {
  for (const injection of ["blind-truth-field", "prior-verdict-field"]) {
    const runId = `leak-${injection}`;
    const truth = truthFor(runId, "same-context", "clean", 1);
    const salt = `${runId}:salt`;
    planRun(fixture, runId, "same-context", truth, salt, {
      validation_inject_leak: injection,
    });
    const specs = passSpecs(runId, "same-context");
    if (injection === "prior-verdict-field") {
      for (const pass of specs.filter((candidate) => candidate.role === "generator")) {
        call(fixture, "dispatch_review_pass", { run_id: runId, pass_id: pass.pass_id });
        landGenerator(fixture, pass.pass_id, []);
      }
      call(fixture, "freeze_review_hypotheses", { run_id: runId });
      assertThrows(
        () =>
          call(fixture, "dispatch_review_pass", {
            run_id: runId,
            pass_id: specs.find((pass) => pass.role === "refuter").pass_id,
          }),
        "prior-verdict-field",
      );
    } else {
      assertThrows(
        () =>
          call(fixture, "dispatch_review_pass", {
            run_id: runId,
            pass_id: specs.find((pass) => pass.role === "generator").pass_id,
          }),
        "blind-truth-field",
      );
    }
    const revealed = call(fixture, "reveal_review_analysis_truth", {
      run_id: runId,
      salt,
      truth,
    });
    assertEqual(revealed.status, "contaminated", `${injection} run status`);
    assertEqual(revealed.reveal.contaminated, 1, `${injection} reveal status`);
    assertThrows(
      () => fixture.db.prepare("DELETE FROM review_contamination_events WHERE run_id=?").run(runId),
      "review contamination event cannot be deleted",
    );
    assertThrows(
      () => fixture.db.prepare("DELETE FROM review_blind_reveals WHERE run_id=?").run(runId),
      "review blind reveal cannot be deleted",
    );
    contaminatedRunIds.push(runId);
  }
});

test("surface-identical blind ladder reports conditions separately with test-retest stability", () => {
  const runIds = [];
  for (const condition of MANIFEST.conditions) {
    for (const arm of MANIFEST.arms.map((item) => item.armType)) {
      for (let replicate = 1; replicate <= MANIFEST.replicatesPerCell; replicate++) {
        const runId = `cal-${condition}-${arm}-${replicate}`;
        runIds.push(completeCalibrationRun(fixture, runId, condition, arm, replicate));
      }
    }
  }
  const report = call(fixture, "score_review_evaluation", {
    evaluation_id: "a7-blind-ladder",
    run_ids: [...runIds, ...contaminatedRunIds],
  });
  assertEqual(report.status, "valid", "blind ladder status");
  assertEqual(report.included_runs.length, 24, "included blind runs");
  assertEqual(report.excluded_contaminated_runs.length, 2, "contaminated exclusions");
  assertEqual(report.declared_surface_contract_hashes.length, 1, "surface contract count");
  for (const condition of MANIFEST.conditions) {
    assertEqual(
      report.observed_surface_hashes[condition].length,
      1,
      `${condition} observed surface count`,
    );
  }
  const mismatchedClean = completeCalibrationRun(
    fixture,
    "cal-same-context-clean-3",
    "same-context",
    "clean",
    3,
  );
  const mismatched = call(fixture, "score_review_evaluation", {
    evaluation_id: "a7-mismatched-pairs",
    run_ids: [...runIds.filter((runId) => runId !== "cal-same-context-clean-1"), mismatchedClean],
  });
  assertEqual(mismatched.status, "red", "mismatched marker/control pairs must fail");
  assert(
    mismatched.red_reasons.some((reason) => reason.includes("requires exactly 1")),
    "mismatched pair failure was not explained",
  );
  const cleanSource = git(fixture.workspace, "show", `${fixture.armHeads.clean}:src/service.ts`);
  const markerSource = git(
    fixture.workspace,
    "show",
    `${fixture.armHeads["marker-only"]}:src/service.ts`,
  );
  const treatedSource = git(
    fixture.workspace,
    "show",
    `${fixture.armHeads.treated}:src/service.ts`,
  );
  assert(!cleanSource.includes("review-control"), "clean arm carries the treatment marker");
  assert(markerSource.includes("review-control"), "marker-only arm lacks the treatment marker");
  assert(treatedSource.includes("review-control"), "treated arm lacks the matched marker");
  const nullPacket = JSON.parse(
    fixture.db
      .prepare(
        "SELECT runtime_input_json FROM review_passes WHERE pass_id='cal-same-context-null-1:g1'",
      )
      .get().runtime_input_json,
  );
  const cleanPacket = JSON.parse(
    fixture.db
      .prepare(
        "SELECT runtime_input_json FROM review_passes WHERE pass_id='cal-same-context-clean-1:g1'",
      )
      .get().runtime_input_json,
  );
  assertEqual(
    Object.keys(nullPacket).sort(),
    Object.keys(cleanPacket).sort(),
    "null packet surface",
  );
  assertEqual(
    nullPacket.review_brief.task.constraints.length,
    2,
    "null manipulation reached generator",
  );
  assertEqual(cleanPacket.review_brief.task.constraints.length, 1, "clean constraint denominator");
  for (const condition of MANIFEST.conditions) {
    const conditionReport = report.conditions[condition];
    assertEqual(conditionReport.pooled_summary, null, `${condition} pooling`);
    assert(
      conditionReport.pooling_policy.includes("no cross-condition"),
      `${condition} pooling policy missing`,
    );
    for (const arm of MANIFEST.arms.map((item) => item.armType)) {
      assertEqual(
        conditionReport.arms[arm].test_retest_jaccard,
        1,
        `${condition}/${arm} stability`,
      );
      assertEqual(conditionReport.arms[arm].runs.length, 2, `${condition}/${arm} replicates`);
      assert(
        conditionReport.arms[arm].runs.every((run) => run.step_size > 0),
        `${condition}/${arm} step size`,
      );
    }
    assert(
      conditionReport.marker_treated_vs_untreated.every((pair) => pair.extra.length === 0),
      `${condition} directional marker contamination`,
    );
  }
});

fixture.cleanup();
console.log(`\nreview analysis: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
