#!/usr/bin/env node
// A14: identity-before-enrichment, typed relations, counterevidence, and method qualification.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./dist/db.js";
import { claimTools } from "./dist/tools/claims.js";
import { crosswalkTools } from "./dist/tools/crosswalk.js";
import { decisionTools } from "./dist/tools/decisions.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { projectTools } from "./dist/tools/project.js";
import { researchTools } from "./dist/tools/research.js";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const RESEARCH_WORKSPACE = join(
  TEST_ROOT,
  "fixtures",
  "research",
  "scholiast",
  "version-semantics",
);
const QUALIFICATION_ARTIFACT = join(
  TEST_ROOT,
  "fixtures",
  "crosswalk",
  "qualification-result.json",
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
function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const root = mkdtempSync(join(tmpdir(), "amanuensis-crosswalk-"));
mkdirSync(join(root, "src"));
git(root, "init", "-q");
git(root, "config", "user.email", "test@localhost");
git(root, "config", "user.name", "Crosswalk Test");
git(root, "config", "commit.gpgsign", "false");
writeFileSync(join(root, "src", "cache.ts"), "export const cacheKind = 'reviewed-code-facts';\n");
git(root, "add", "src/cache.ts");
git(root, "commit", "-q", "--no-verify", "-m", "fixture");
const sha = git(root, "rev-parse", "HEAD");
const project = {
  workspacePath: root,
  projectKey: "test/crosswalk",
  storagePath: root,
  dbPath: join(root, "memory.db"),
  storageGitReady: false,
};
const db = openDatabase(project.dbPath);
const ctx = { project, db, sessionId: null };
const tools = new Map(
  [
    ...projectTools,
    ...evidenceTools,
    ...claimTools,
    ...decisionTools,
    ...researchTools,
    ...crosswalkTools,
  ].map((tool) => [tool.name, tool]),
);
function call(name, args) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.handler(args, ctx);
}
ctx.sessionId = call("start_session", { intent: "crosswalk-red-gate" }).session_id;

const evidenceId = call("add_evidence", {
  file_path: "src/cache.ts",
  line_range: "1-1",
  ref_sha: sha,
  kind: "code-verified",
  excerpt: "export const cacheKind = 'reviewed-code-facts';",
}).id;
call("add_claim", {
  claim_id: "code-context-cache",
  claim_key: "cache.kind",
  subject_type: "subsystem",
  subject_id: "memory",
  statement: "The context cache stores reviewed code facts.",
  epistemic_kind: "observation",
  ref_sha: sha,
  evidence_ids: [evidenceId],
});
call("draft_decision_revision", {
  decision_id: "cache-policy",
  revision_id: "cache-policy:r1",
  title: "Context cache policy",
  desire_sources: [
    {
      desire_id: "density",
      statement: "Keep decision context dense and useful.",
      source_kind: "direct-user",
      source_ref: "user:test",
    },
  ],
  accepted_option: { option_key: "reviewed-facts", summary: "Cache reviewed code facts." },
  alternatives: [
    {
      option_key: "attention-cache",
      summary: "Reuse model attention state.",
      disposition: "rejected",
      evidence_ref: "amanuensis://claim/code-context-cache",
    },
  ],
  constraints: [
    {
      constraint_id: "traceable",
      statement: "Cached facts remain traceable.",
      source_ref: "user:test",
    },
  ],
  consequences: [
    { consequence_id: "review-cost", statement: "Review adds custody cost.", direction: "cost" },
  ],
  falsifiers: [
    {
      falsifier_id: "cache-analogy",
      condition: "The attention-cache analogy transfers without semantic loss.",
      destination: "cache-policy premise review",
    },
  ],
  premises: [
    {
      premise_id: "reviewed-fact-cache",
      kind: "claim",
      ref: "code-context-cache",
      statement: "The context cache stores reviewed code facts.",
    },
  ],
  code_changes: [{ path: "src/cache.ts", relationship: "implements" }],
  rationale: "Repository behavior and model-runtime analogy must remain distinguishable.",
  authored_by_kind: "model",
  authored_by: "fixture-model",
});

const directUser = (statement) => [{ kind: "direct-user", ref: "user:test", statement }];
const codeProvenance = (statement) => [
  { kind: "code-claim", ref: "code-context-cache", statement },
];

let codeEntity;
let methodEntity;
test("surface-similar concepts stay pending and cannot inherit properties", () => {
  assertThrows(
    () =>
      db
        .prepare(
          `INSERT INTO crosswalk_entities
             (entity_id,entity_kind,source_kind,source_ref,label,normalized_label,
              definition,negative_criteria_json,provenance_json,identity_state,
              canonical_entity_id,created_by)
           VALUES ('forged-identity','method','direct-user','user:forged','Forged',
                   'forged','Bypass','["not legitimate"]','[]','distinct',
                   'forged-identity',?)`,
        )
        .run(ctx.sessionId),
    "identity must begin pending",
  );
  codeEntity = call("stage_crosswalk_entity", {
    entity_id: "entity-code-cache",
    entity_kind: "code-claim",
    source_kind: "code-claim",
    source_ref: "code-context-cache",
    label: "Context Cache",
    definition: "A durable selection of reviewed codebase facts with repository evidence.",
    negative_criteria: ["Not a model runtime key/value attention cache."],
    provenance: codeProvenance("The source is a current code observation."),
  });
  assertEqual(codeEntity.identity_state, "distinct", "first identity did not resolve uniquely");
  methodEntity = call("stage_crosswalk_entity", {
    entity_id: "entity-attention-cache",
    entity_kind: "method",
    source_kind: "direct-user",
    source_ref: "user:attention-cache-proposal",
    label: "context-cache",
    definition: "A model-runtime method that reuses attention key/value state.",
    negative_criteria: ["Not a durable record of reviewed repository claims."],
    provenance: directUser("A method candidate proposed for bounded qualification."),
  });
  assertEqual(methodEntity.identity_state, "pending", "surface similarity auto-merged identity");
  assertThrows(
    () =>
      call("add_crosswalk_property", {
        property_id: "pending-property",
        entity_id: "entity-attention-cache",
        property_key: "retention",
        value: "durable",
        source_entity_id: "entity-code-cache",
        provenance: directUser("Attempted inheritance red gate."),
      }),
    "requires resolved identity",
  );
});

test("explicit distinct resolution preserves definitions and blocks inheritance", () => {
  const resolved = call("resolve_crosswalk_identity", {
    entity_id: "entity-attention-cache",
    candidate_entity_id: "entity-code-cache",
    resolution: "distinct",
    evidence: directUser("The terms share a label but have different persistence and referents."),
    rationale: "One is durable epistemic memory; the other is runtime tensor reuse.",
  });
  assertEqual(resolved.resolution, "distinct", "distinct identity resolution failed");
  assertThrows(
    () =>
      call("add_crosswalk_property", {
        property_id: "forbidden-inheritance",
        entity_id: "entity-attention-cache",
        property_key: "retention",
        value: "durable",
        source_entity_id: "entity-code-cache",
        provenance: directUser("Attempted cross-identity inheritance."),
      }),
    "requires resolved identity",
  );
  call("add_crosswalk_property", {
    property_id: "method-runtime-scope",
    entity_id: "entity-attention-cache",
    property_key: "scope",
    value: "single model runtime",
    provenance: directUser("The method is explicitly scoped to runtime state."),
  });
});

let analogy;
test("typed analogy carries positive/negative criteria without implying identity", () => {
  analogy = call("add_crosswalk_relation", {
    relation_id: "relation-cache-analogy:r1",
    source_entity_id: "entity-attention-cache",
    target_entity_id: "entity-code-cache",
    relation_type: "analogous-to",
    statement: "Both reduce repeated context assembly work.",
    positive_criteria: ["Both reuse selected prior context."],
    negative_criteria: [
      "Runtime state is not durable evidence and cannot inherit code-fact authority.",
    ],
    provenance: directUser("The analogy is a hypothesis, not identity."),
    valid_from: "fixture:r1",
  });
  assertEqual(analogy.status, "current", "analogy relation did not become current");
  const method = call("get_crosswalk", { entity_id: "entity-attention-cache" });
  assertEqual(method.identity_state, "distinct", "analogy collapsed identity");
});

// Produce a real A13 external claim so A14 counterevidence crosses the actual boundary.
call("propose_research_request", {
  request_id: "rq-cache-analogy",
  question:
    "Does attention-cache reuse transfer the epistemic properties of a reviewed fact cache?",
  uncertainty: "Whether the shared efficiency mechanism supports semantic property transfer.",
  decision_destination: {
    decision_id: "cache-policy",
    revision_id: "cache-policy:r1",
    field: "premise",
    ref: "reviewed-fact-cache",
  },
  current_evidence: [
    {
      kind: "code-claim",
      ref: "code-context-cache",
      statement: "The context cache stores reviewed code facts.",
    },
  ],
  needed_source_classes: ["primary systems paper"],
  disconfirmers: ["A source demonstrates durable evidence custody in attention state."],
  budget: { max_sources: 4, max_minutes: 60 },
  local_evidence_search: {
    outcome: "exhausted",
    queries: ["cacheKind", "attention cache"],
    locations: ["src/cache.ts", "repository docs"],
    unresolved_reason: "The repository cannot establish external model-runtime semantics.",
  },
  expected_information_value: { decision_sensitivity: 4, uncertainty_reducibility: 4 },
});
call("dispatch_research_request", {
  request_id: "rq-cache-analogy",
  dispatch_id: "dispatch-cache-analogy",
  workspace_path: RESEARCH_WORKSPACE,
  ruled_out: ["Name similarity does not establish identity."],
});
call("land_research_result", {
  request_id: "rq-cache-analogy",
  result_id: "result-cache-analogy",
  artifact_paths: [join(RESEARCH_WORKSPACE, "claims.md")],
  summary:
    "Runtime attention state lacks the durable provenance properties of reviewed code facts.",
  sources: [
    {
      source_id: "attention-paper",
      title: "Attention Cache Semantics",
      locator: "urn:fixture:attention-cache",
      source_class: "primary systems paper",
      access_status: "directly-read",
      held_excerpt: "Cached key/value tensors are transient inference state.",
      limitation: "The source does not evaluate Amanuensis's durable record.",
    },
  ],
  claims: [
    {
      external_claim_id: "external-attention-transient",
      statement:
        "Attention key/value cache state is transient runtime state, not durable evidence custody.",
      classification: "established",
      confidence: "single-source",
      source_ids: ["attention-paper"],
      target_kind: "decision-premise",
      target_ref: "reviewed-fact-cache",
    },
  ],
});

test("external counterevidence remains attached through relation supersession", () => {
  call("add_crosswalk_counterevidence", {
    counterevidence_id: "counterevidence-transience",
    relation_id: "relation-cache-analogy:r1",
    statement: "The shared efficiency pattern does not transfer durability or provenance.",
    provenance: [
      {
        kind: "external-claim",
        ref: "external-attention-transient",
        statement: "A landed external claim establishes transient runtime scope.",
      },
    ],
  });
  call("supersede_crosswalk_relation", {
    predecessor_relation_id: "relation-cache-analogy:r1",
    relation_id: "relation-cache-analogy:r2",
    source_entity_id: "entity-attention-cache",
    target_entity_id: "entity-code-cache",
    relation_type: "analogous-to",
    statement: "The analogy is limited to reducing repeated context assembly.",
    positive_criteria: ["Both reuse selected prior context."],
    negative_criteria: ["No identity, durability, provenance, or authority property transfers."],
    provenance: [
      {
        kind: "external-claim",
        ref: "external-attention-transient",
        statement: "New evidence narrows the analogy.",
      },
    ],
    valid_from: "fixture:r2",
  });
  const old = db
    .prepare("SELECT status FROM crosswalk_relations WHERE relation_id='relation-cache-analogy:r1'")
    .get();
  assertEqual(old.status, "superseded", "predecessor relation remained current");
  assertEqual(
    db.prepare("SELECT COUNT(*) AS n FROM crosswalk_counterevidence").get().n,
    1,
    "counterevidence was smoothed away",
  );
});

const controls = [
  {
    control_id: "control-baseline",
    type: "baseline",
    expected_outcome: "accept",
    definition: "Qualified existing behavior remains accepted.",
    negative_criteria: ["A baseline defect is not a treatment effect."],
  },
  {
    control_id: "control-positive",
    type: "positive",
    expected_outcome: "reject",
    definition: "A known semantic transfer defect is rejected.",
    negative_criteria: ["Silence is not detection."],
  },
  {
    control_id: "control-negative",
    type: "negative",
    expected_outcome: "accept",
    definition: "A surface-similar but valid nonidentity mapping is accepted.",
    negative_criteria: ["Finding nothing is not required."],
  },
  {
    control_id: "control-scramble",
    type: "scramble",
    expected_outcome: "reject",
    definition: "Incoherent relation components are rejected.",
    negative_criteria: ["Schema shape alone cannot pass."],
  },
  {
    control_id: "control-inconclusive",
    type: "inconclusive",
    expected_outcome: "inconclusive",
    definition: "Unreadable evidence remains inconclusive.",
    negative_criteria: ["Unreadable is not false."],
  },
];
const redGates = [
  {
    gate_id: "identity-before-enrichment",
    fault: "inherit a property across distinct entities",
    expected_failure: "crosswalk enrichment requires resolved identity",
  },
  {
    gate_id: "qualification-before-policy",
    fault: "write method into unattended policy before scoring",
    expected_failure: "requires passed qualification and read-back",
  },
];

test("Collatio adapter freezes prediction, graded controls, red gates, and custody", () => {
  assertThrows(
    () =>
      call("plan_method_qualification", {
        qualification_id: "qualification-unauthorized",
        method_entity_id: "entity-attention-cache",
        collatio_contract: {
          program_version: "v2",
          design_ref: "collatio/v2/DESIGN.md",
          qualification_scope: "cache selection",
          authorization_status: "not-authorized",
        },
        prediction: {
          metric: "unknown-retention-milli",
          baseline_value_milli: 700,
          expected_direction: "increase",
          minimum_effect_milli: 100,
          falsifier: "No improvement over the qualified baseline.",
        },
        controls,
        red_gates: redGates,
        custody: {
          expected_artifacts: ["qualification-result.json"],
          expected_result_count: 1,
          result_schema_version: "1.0.0",
        },
        target_policy_key: "context-cache-selection",
      }),
    "authorization_status must be one of",
  );
  const planned = call("plan_method_qualification", {
    qualification_id: "qualification-cache-method",
    method_entity_id: "entity-attention-cache",
    collatio_contract: {
      program_version: "v2-adapter-fixture",
      design_ref: "collatio/v2/DESIGN.md",
      qualification_scope: "one bounded cache-selection method",
      authorization_status: "authorized",
    },
    prediction: {
      metric: "unknown-retention-milli",
      baseline_value_milli: 700,
      expected_direction: "increase",
      minimum_effect_milli: 100,
      falsifier: "The method improves retention by less than 100 milli-units.",
    },
    controls,
    red_gates: redGates,
    custody: {
      expected_artifacts: ["qualification-result.json"],
      expected_result_count: 1,
      result_schema_version: "1.0.0",
    },
    target_policy_key: "context-cache-selection",
  });
  assertEqual(planned.status, "planned", "qualification plan was not frozen");
  assertThrows(
    () =>
      db
        .prepare(
          `INSERT INTO unattended_method_policy
             (policy_key,method_entity_id,qualification_id,configuration_json,activated_by)
           VALUES ('context-cache-selection','entity-attention-cache',
                   'qualification-cache-method','{}',?)`,
        )
        .run(ctx.sessionId),
    "requires passed qualification and read-back",
  );
});

const qualificationResult = {
  qualification_id: "qualification-cache-method",
  result_id: "qualification-result-cache",
  artifact_path: QUALIFICATION_ARTIFACT,
  observed_value_milli: 850,
  control_results: controls.map((control) => ({
    control_id: control.control_id,
    observed_outcome: control.expected_outcome,
  })),
  red_gate_results: redGates.map((gate) => ({
    gate_id: gate.gate_id,
    fired: true,
    observed_failure: gate.expected_failure,
  })),
  custody_counts: { planned: 1, landed: 1, schema_valid: 1 },
  limitations: [
    "Fixture qualification demonstrates the adapter, not population-level method efficacy.",
  ],
};

test("qualification custody rejects a receipt that disagrees with the landed result", () => {
  assertThrows(
    () =>
      call("land_method_qualification", {
        ...qualificationResult,
        observed_value_milli: 851,
      }),
    "artifact content does not match",
  );
});

test("only a fully reconciled qualification activates unattended policy", () => {
  call("land_method_qualification", qualificationResult);
  const scored = call("score_method_qualification", {
    qualification_id: "qualification-cache-method",
    score_id: "score-cache-method",
  });
  assertEqual(scored.passed, true, "complete qualification did not pass");
  const active = call("activate_qualified_method", {
    qualification_id: "qualification-cache-method",
    policy_key: "context-cache-selection",
    configuration: { mode: "bounded", max_items: 12 },
  });
  assertEqual(active.policy_key, "context-cache-selection", "qualified method did not activate");
});

test("projection reproduces endpoints, relation types, and unresolved contradictions", () => {
  const projected = call("project_crosswalk", { projection_id: "crosswalk-projection-a14" });
  assertEqual(projected.projection.counts.entities, 2, "projection endpoint count drifted");
  assertEqual(projected.projection.counts.relations, 2, "projection relation count drifted");
  assertEqual(
    projected.projection.counts.unresolved_contradictions,
    1,
    "projection erased unresolved counterevidence",
  );
  assertEqual(
    call("verify_crosswalk_projection", { projection_id: "crosswalk-projection-a14" }).ok,
    true,
    "stored projection failed read-back",
  );
  const damaged = structuredClone(projected.projection);
  damaged.counterevidence = [];
  const red = call("verify_crosswalk_projection", {
    projection_id: "crosswalk-projection-a14",
    projection: damaged,
  });
  assertEqual(red.ok, false, "counterevidence loss did not turn projection read-back red");
});

db.close();
rmSync(root, { recursive: true, force: true });
console.log(`\n${passed}/${passed + failed} crosswalk/qualification checks passed.`);
if (failed > 0) process.exit(1);
