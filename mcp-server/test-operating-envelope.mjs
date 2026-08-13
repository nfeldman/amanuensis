#!/usr/bin/env node
// A16: stratified preregistration, instrument clearance, no-pooling, and operating-envelope read-back.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./dist/db.js";
import { evaluationTools } from "./dist/tools/evaluation.js";
import { projectTools } from "./dist/tools/project.js";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(TEST_ROOT, "fixtures", "evaluation", "program.json"), "utf8"),
);

let passed = 0;
let failed = 0;
function test(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL ${label}\n       ${error.message}`);
    failed++;
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
  let error;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  if (!error?.message.includes(expected)) {
    throw new Error(`expected ${expected}, got ${error?.message}`);
  }
}

const root = mkdtempSync(join(tmpdir(), "amanuensis-evaluation-"));
const project = {
  workspacePath: root,
  projectKey: "test/evaluation",
  storagePath: root,
  dbPath: join(root, "memory.db"),
  storageGitReady: false,
};
const db = openDatabase(project.dbPath);
const ctx = { project, db, sessionId: null };
const tools = new Map(
  [...projectTools, ...evaluationTools].map((tool) => [tool.name, tool]),
);
function call(name, args) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.handler(args, ctx);
}

ctx.sessionId = call("start_session", { intent: "A16 operating-envelope evaluation" }).session_id;

test("null-arm surface identity is structural and red-capable", () => {
  const damaged = structuredClone(manifest);
  damaged.conditions.find((condition) => condition.role === "null").surface_identity.dimensions = [
    "shape",
    "identifiers",
  ];
  assertThrows(
    () =>
      call("plan_evaluation_program", {
        program_id: "damaged-null",
        manifest: damaged,
      }),
    "null must control shape, length-distribution, identifiers, and cross-references",
  );
});

let plan;
test("preregistration generates unique repository-stratified replicates", () => {
  plan = call("plan_evaluation_program", {
    program_id: "envelope-fixture-v1",
    manifest,
  });
  assertEqual(plan.expected_case_count, 48, "case fan-out");
  assertEqual(new Set(plan.cases.map((item) => item.replicate_id)).size, 48, "replicate IDs");
  const stored = call("get_evaluation_program", { program_id: "envelope-fixture-v1" });
  assertEqual(stored.manifest.repositories.length, 3, "repository corpus");
  assertEqual(stored.manifest.strata.length, 3, "stratum corpus");
});

test("incomplete fan-in cannot publish", () => {
  assertThrows(
    () =>
      call("publish_operating_envelope", {
        report_id: "too-early",
        program_id: "envelope-fixture-v1",
        claims: [],
      }),
    "evaluation program is planned",
  );
});

const valueByStratumAndRole = {
  "typescript-review-codex": {
    baseline: 600,
    null: 500,
    "stronger-control": 900,
    treatment: 800,
    ablation: 550,
    "test-retest": 810,
    "sensitivity-add": 850,
    "sensitivity-remove": 650,
  },
  "python-design-claude": {
    baseline: 650,
    null: 500,
    "stronger-control": 900,
    treatment: 680,
    ablation: 620,
    "test-retest": 670,
    "sensitivity-add": 720,
    "sensitivity-remove": 630,
  },
  "go-review-local": {
    baseline: 50,
    null: 20,
    "stronger-control": 100,
    treatment: 70,
    ablation: 40,
    "test-retest": 60,
    "sensitivity-add": 90,
    "sensitivity-remove": 50,
  },
};

function resultArgs(item, overrides = {}) {
  const value = valueByStratumAndRole[item.stratum_id][item.condition_role];
  return {
    result_id: `result:${item.replicate_id}`,
    case_id: item.case_id,
    metrics: manifest.metrics.map((metric) => ({
      metric_id: metric.metric_id,
      numerator: value,
      denominator: 1000,
      excluded_count: 1,
      value_milli: value,
    })),
    delivery: {
      observed_input_hash: item.expected_input_hash,
      delivery_verified: true,
      determinism_setting: "seed",
      observed_determinism_value: item.replicate_id,
      determinism_changed_operation: true,
      baseline_verified: true,
      observed_condition_id: item.condition_id,
      manipulation_observed: true,
      headroom: {
        floor_milli: 0,
        ceiling_milli: 1000,
        baseline_milli: item.stratum_id === "go-review-local" ? 50 : 500,
      },
    },
    rubric_counts: { detected: 1, missed: 0, unknown: 1 },
    unused_category_checks: [
      {
        category: "missed",
        operational_frame_present: true,
        instrument_exposure_count: 1,
      },
    ],
    excluded_observations: [
      {
        observation_id: `excluded:${item.replicate_id}`,
        reason: "Fixture observation retained outside the scored denominator.",
        reported_separately: true,
      },
    ],
    agreement: {
      raw_agreement_milli: 800,
      chance_agreement_milli: 500,
      chance_corrected_agreement_milli: 600,
    },
    limitations: ["Synthetic known-outcome fixture; no population claim is authorized."],
    ...overrides,
  };
}

test("unused rubric categories require an operational-framing exposure check", () => {
  const first = plan.cases[0];
  assertThrows(
    () =>
      call(
        "land_evaluation_result",
        resultArgs(first, { unused_category_checks: [] }),
      ),
    "unused rubric category missed lacks operational-framing check",
  );
});

test("exact preregistered fan-in lands per-replicate metrics and instrument state", () => {
  for (const item of plan.cases) {
    const landed = call("land_evaluation_result", resultArgs(item));
    const expectedStatus =
      item.stratum_id === "go-review-local" ? "undetermined-no-headroom" : "valid";
    assertEqual(landed.instrument_status, expectedStatus, `instrument ${item.case_id}`);
  }
  const stored = call("get_evaluation_program", { program_id: "envelope-fixture-v1" });
  assertEqual(stored.status, "ready", "program state after exact fan-in");
  assertEqual(stored.cases.filter((item) => item.status === "landed").length, 48, "landed cases");
});

test("positive treatment replicates receive independent alternative-explanation review", () => {
  const treatmentCases = plan.cases.filter(
    (item) =>
      item.stratum_id === "typescript-review-codex" && item.condition_role === "treatment",
  );
  for (const item of treatmentCases) {
    call("review_evaluation_alternatives", {
      review_id: `alternative:${item.replicate_id}`,
      case_id: item.case_id,
      alternatives: [
        {
          explanation: "The apparent lift comes only from the context volume.",
          disposition: "ruled-out",
          rationale: "The two-sided context sensitivity arms preserve the direction ordering.",
        },
      ],
      evidence: [`case://${item.case_id}`, "fixture://typescript/fan-in"],
      outcome: "survived",
      limitation: "The fixture does not establish general repository efficacy.",
    });
  }
  const invalidTreatment = plan.cases.find(
    (item) => item.stratum_id === "go-review-local" && item.condition_role === "treatment",
  );
  assertThrows(
    () =>
      call("review_evaluation_alternatives", {
        review_id: "invalid-treatment-review",
        case_id: invalidTreatment.case_id,
        alternatives: [{ explanation: "x", disposition: "unresolved", rationale: "x" }],
        evidence: ["fixture://go/no-headroom"],
        outcome: "underdetermined",
        limitation: "No headroom.",
      }),
    "alternative review requires a valid landed treatment case",
  );
});

const exactAssignments = plan.cases.map((item) => item.replicate_id).sort();
const claims = [
  {
    scope_kind: "stratum",
    stratum_id: "typescript-review-codex",
    verdict: "supported",
    statement: "The fixture supports this repository, mode, context, model, and runtime stratum only.",
  },
  {
    scope_kind: "stratum",
    stratum_id: "python-design-claude",
    verdict: "unsupported",
    statement: "The observed treatment effect is below the preregistered MDE in this stratum.",
  },
  {
    scope_kind: "stratum",
    stratum_id: "go-review-local",
    verdict: "undetermined-instrument",
    statement: "The metric lacks enough floor headroom to adjudicate this stratum.",
  },
];

test("report generator rejects replicate reuse and pooled or overridden efficacy", () => {
  assertThrows(
    () =>
      call("publish_operating_envelope", {
        report_id: "duplicate-replicate",
        program_id: "envelope-fixture-v1",
        replicate_assignments: [...exactAssignments.slice(0, -1), exactAssignments[0]],
        claims,
      }),
    "replicate ID reuse is forbidden",
  );
  assertThrows(
    () =>
      call("publish_operating_envelope", {
        report_id: "pooled-positive",
        program_id: "envelope-fixture-v1",
        claims: [
          {
            scope_kind: "program",
            stratum_id: "typescript-review-codex",
            verdict: "supported",
            statement: "A pooled positive would conceal the weak subgroup.",
          },
          ...claims.slice(1),
        ],
      }),
    "pooled program-level efficacy claims are forbidden",
  );
  const overridden = structuredClone(claims);
  overridden.find((claim) => claim.stratum_id === "python-design-claude").verdict = "supported";
  assertThrows(
    () =>
      call("publish_operating_envelope", {
        report_id: "hidden-weak-subgroup",
        program_id: "envelope-fixture-v1",
        claims: overridden,
      }),
    "conflicts with its unpooled verdict",
  );
});

let published;
test("operating envelope retains every subgroup, exclusion, agreement component, and unsupported condition", () => {
  published = call("publish_operating_envelope", {
    report_id: "operating-envelope-v1",
    program_id: "envelope-fixture-v1",
    replicate_assignments: exactAssignments,
    claims,
  });
  const report = published.report;
  assertEqual(report.pooled_efficacy_metric, null, "pooled metric");
  assertEqual(report.operating_envelope.supported_strata, ["typescript-review-codex"], "supported");
  assertEqual(report.operating_envelope.unsupported_strata, ["python-design-claude"], "unsupported");
  assertEqual(report.operating_envelope.undetermined_strata, ["go-review-local"], "undetermined");
  assert(report.operating_envelope.unsupported_conditions.languages.includes("Rust"), "unsupported language");
  for (const stratum of report.strata) {
    for (const replicate of stratum.replicate_results) {
      assertEqual(replicate.excluded_observations.length, 1, "excluded observation custody");
      assertEqual(
        Object.keys(replicate.agreement).sort(),
        ["chance_agreement_milli", "chance_corrected_agreement_milli", "raw_agreement_milli"],
        "agreement components",
      );
      assert(replicate.metrics.every((metric) => metric.excluded_count === 1), "metric exclusions");
    }
  }
});

test("state, coverage, and content read-back can all turn red", () => {
  const clean = call("verify_operating_envelope", { report_id: "operating-envelope-v1" });
  assert(clean.ok, "stored report should verify");
  const damaged = structuredClone(published.report);
  damaged.strata.pop();
  const red = call("verify_operating_envelope", {
    report_id: "operating-envelope-v1",
    report: damaged,
  });
  assert(!red.axes.coverage.ok, "coverage axis should turn red");
  assert(!red.axes.content.ok, "content axis should turn red");
  assert(!red.ok, "damaged report should fail");
});

db.close();
rmSync(root, { recursive: true, force: true });
console.log(`\noperating-envelope: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
