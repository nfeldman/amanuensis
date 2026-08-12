#!/usr/bin/env node
// A15: typed session distillation, scored promotion, supersession, and runtime read-back.

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
import { learningTools } from "./dist/tools/learning.js";
import { loggingTools } from "./dist/tools/logging.js";
import { projectTools } from "./dist/tools/project.js";
import { researchTools } from "./dist/tools/research.js";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const QUALIFICATION_ARTIFACT = join(TEST_ROOT, "fixtures", "learning", "method-qualification.json");
const RESEARCH_WORKSPACE = join(
  TEST_ROOT,
  "fixtures",
  "research",
  "scholiast",
  "version-semantics",
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

const root = mkdtempSync(join(tmpdir(), "amanuensis-learning-"));
mkdirSync(join(root, "src"));
git(root, "init", "-q");
git(root, "config", "user.email", "test@localhost");
git(root, "config", "user.name", "Learning Test");
git(root, "config", "commit.gpgsign", "false");
writeFileSync(join(root, "src", "context.ts"), "export const retention = 'dense';\n");
git(root, "add", "src/context.ts");
git(root, "commit", "-q", "--no-verify", "-m", "initial fixture");
const sha1 = git(root, "rev-parse", "HEAD");
const project = {
  workspacePath: root,
  projectKey: "test/learning",
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
    ...loggingTools,
    ...decisionTools,
    ...researchTools,
    ...crosswalkTools,
    ...learningTools,
  ].map((tool) => [tool.name, tool]),
);
function call(name, args) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.handler(args, ctx);
}

const sourceSession = call("start_session", { intent: "completed review/design work" }).session_id;
ctx.sessionId = sourceSession;
const evidence1 = call("add_evidence", {
  file_path: "src/context.ts",
  line_range: "1-1",
  ref_sha: sha1,
  kind: "code-verified",
  excerpt: "export const retention = 'dense';",
}).id;
call("add_claim", {
  claim_id: "claim-retention-v1",
  claim_key: "context.retention",
  subject_type: "subsystem",
  subject_id: "memory",
  statement: "Context retention is dense.",
  epistemic_kind: "observation",
  ref_sha: sha1,
  evidence_ids: [evidence1],
});
writeFileSync(join(root, "src", "context.ts"), "export const retention = 'selective';\n");
git(root, "add", "src/context.ts");
git(root, "commit", "-q", "--no-verify", "-m", "make retention selective");
const sha2 = git(root, "rev-parse", "HEAD");
const evidence2 = call("add_evidence", {
  file_path: "src/context.ts",
  line_range: "1-1",
  ref_sha: sha2,
  kind: "code-verified",
  excerpt: "export const retention = 'selective';",
}).id;
call("supersede_claim", {
  predecessor_claim_id: "claim-retention-v1",
  successor_claim_id: "claim-retention-v2",
  statement: "Context retention is selective.",
  epistemic_kind: "observation",
  at_sha: sha2,
  evidence_ids: [evidence2],
  rationale: "The implementation changed and the old observation is no longer current.",
});
call("log_query", {
  question: "Which fields should the compact context retain?",
  fields_hit: ["what", "how"],
  tier_reached: 2,
  session_id: sourceSession,
});
const queryId = db.prepare("SELECT MAX(id) AS id FROM query_log").get().id;

call("draft_decision_revision", {
  decision_id: "research-policy",
  revision_id: "research-policy:r1",
  title: "Research policy",
  desire_sources: [
    {
      desire_id: "bounded",
      statement: "Research should change a named decision or remain explicitly exploratory.",
      source_kind: "direct-user",
      source_ref: "user:test",
    },
  ],
  accepted_option: { option_key: "bounded", summary: "Bind research to decisions." },
  alternatives: [
    {
      option_key: "unbounded",
      summary: "Collect every interesting topic.",
      disposition: "rejected",
      evidence_ref: "amanuensis://claim/claim-retention-v2",
    },
  ],
  constraints: [
    {
      constraint_id: "typed",
      statement: "External claims remain distinct from code observations.",
      source_ref: "user:test",
    },
  ],
  consequences: [
    {
      consequence_id: "queue-cost",
      statement: "Admission has coordination cost.",
      direction: "cost",
    },
  ],
  falsifiers: [
    {
      falsifier_id: "yield",
      condition: "Bounded requests never change decisions.",
      destination: "research policy review",
    },
  ],
  premises: [
    {
      premise_id: "current-retention",
      kind: "claim",
      ref: "claim-retention-v2",
      statement: "Context retention is selective.",
    },
  ],
  code_changes: [{ path: "src/context.ts", relationship: "constrains" }],
  rationale: "Research learning needs a bounded destination.",
  authored_by_kind: "model",
  authored_by: "fixture-model",
});
call("propose_research_request", {
  request_id: "rq-learning",
  question: "What property should a research-learning ledger preserve?",
  uncertainty: "Whether provenance or output volume predicts later decision value.",
  decision_destination: {
    decision_id: "research-policy",
    revision_id: "research-policy:r1",
    field: "premise",
    ref: "current-retention",
  },
  current_evidence: [
    {
      kind: "code-claim",
      ref: "claim-retention-v2",
      statement: "Context retention is selective.",
    },
  ],
  needed_source_classes: ["primary evaluation"],
  disconfirmers: ["Output volume predicts decision yield better than provenance."],
  budget: { max_sources: 3, max_minutes: 45 },
  local_evidence_search: {
    outcome: "exhausted",
    queries: ["research learning", "decision yield"],
    locations: ["src/context.ts", "repository docs"],
    unresolved_reason: "Repository state cannot establish external evaluation behavior.",
  },
  expected_information_value: { decision_sensitivity: 4, uncertainty_reducibility: 4 },
});
call("dispatch_research_request", {
  request_id: "rq-learning",
  dispatch_id: "dispatch-learning",
  workspace_path: RESEARCH_WORKSPACE,
  ruled_out: ["Output count is not a value metric."],
});
call("land_research_result", {
  request_id: "rq-learning",
  result_id: "result-learning",
  artifact_paths: [join(RESEARCH_WORKSPACE, "claims.md")],
  summary: "Decision-relevant provenance survives as the useful learning boundary.",
  sources: [
    {
      source_id: "learning-evaluation",
      title: "Learning Evaluation",
      locator: "urn:fixture:learning-evaluation",
      source_class: "primary evaluation",
      access_status: "directly-read",
      held_excerpt: "Decision relevance and provenance are evaluated separately from output count.",
      limitation: "Fixture source demonstrates custody, not an external population estimate.",
    },
  ],
  claims: [
    {
      external_claim_id: "external-learning-provenance",
      statement: "A learning record should retain provenance and named decision relevance.",
      classification: "established",
      confidence: "single-source",
      source_ids: ["learning-evaluation"],
      target_kind: "decision-premise",
      target_ref: "current-retention",
    },
  ],
});

call("stage_crosswalk_entity", {
  entity_id: "method-distill-selective",
  entity_kind: "method",
  source_kind: "direct-user",
  source_ref: "user:selective-distillation",
  label: "Selective distillation",
  definition: "A bounded method that extracts only provenance-bearing candidate lessons.",
  negative_criteria: ["Not direct policy mutation from a session summary."],
  provenance: [
    {
      kind: "direct-user",
      ref: "user:selective-distillation",
      statement: "Test one bounded distillation method.",
    },
  ],
});
const controls = [
  ["baseline", "baseline", "accept"],
  ["positive", "positive", "reject"],
  ["negative", "negative", "accept"],
  ["scramble", "scramble", "reject"],
  ["inconclusive", "inconclusive", "inconclusive"],
].map(([control_id, type, expected_outcome]) => ({
  control_id,
  type,
  expected_outcome,
  definition: `${type} qualification control`,
  negative_criteria: ["A schema-shaped response is not a semantic result."],
}));
const redGates = [
  {
    gate_id: "policy-bypass",
    fault: "write an unqualified method into policy",
    expected_failure: "unqualified method cannot enter unattended policy",
  },
];
call("plan_method_qualification", {
  qualification_id: "qualification-learning-method",
  method_entity_id: "method-distill-selective",
  collatio_contract: {
    program_version: "v2-adapter-fixture",
    design_ref: "collatio/v2/DESIGN.md",
    qualification_scope: "one bounded selective-distillation method",
    authorization_status: "authorized",
  },
  prediction: {
    metric: "supported-candidate-milli",
    baseline_value_milli: 700,
    expected_direction: "increase",
    minimum_effect_milli: 100,
    falsifier: "The method improves supported-candidate retention by less than 100 milli-units.",
  },
  controls,
  red_gates: redGates,
  custody: {
    expected_artifacts: ["method-qualification.json"],
    expected_result_count: 1,
    result_schema_version: "1.0.0",
  },
  target_policy_key: "method-distillation",
});
call("land_method_qualification", {
  qualification_id: "qualification-learning-method",
  result_id: "result-learning-method",
  artifact_path: QUALIFICATION_ARTIFACT,
  observed_value_milli: 900,
  control_results: controls.map(({ control_id, expected_outcome }) => ({
    control_id,
    observed_outcome: expected_outcome,
  })),
  red_gate_results: redGates.map(({ gate_id, expected_failure }) => ({
    gate_id,
    fired: true,
    observed_failure: expected_failure,
  })),
  custody_counts: { planned: 1, landed: 1, schema_valid: 1 },
  limitations: [
    "Fixture demonstrates A15 composition with A14; it is not a general efficacy claim.",
  ],
});
call("score_method_qualification", {
  qualification_id: "qualification-learning-method",
  score_id: "score-learning-method",
});
call("activate_qualified_method", {
  qualification_id: "qualification-learning-method",
  policy_key: "method-distillation",
  configuration: { mode: "selective", max_candidates: 6 },
});

call("end_session", { session_id: sourceSession, outcome: "completed with measured outcomes" });
const distillSession = call("start_session", { intent: "distill completed session" }).session_id;
ctx.sessionId = distillSession;

const artifacts = [
  {
    artifact_id: "artifact-code-old",
    artifact_kind: "code-claim",
    source_ref: "claim-retention-v1",
    statement: "Dense retention was planned, produced, accepted, then invalidated by code change.",
    states: ["planned", "produced", "accepted", "later-invalidated"],
    provenance: {
      source_kind: "repository",
      source_ref: "claim-retention-v1",
      statement: "The temporal claim retains its exclusive validity boundary.",
    },
  },
  {
    artifact_id: "artifact-code-current",
    artifact_kind: "code-claim",
    source_ref: "claim-retention-v2",
    statement: "Selective retention is current repository behavior.",
    states: ["planned", "produced", "accepted"],
    provenance: {
      source_kind: "repository",
      source_ref: "claim-retention-v2",
      statement: "The current claim is backed by code evidence.",
    },
  },
  {
    artifact_id: "artifact-query",
    artifact_kind: "query-log",
    source_ref: String(queryId),
    statement: "The session needed what/how fields at Tier 2.",
    states: ["planned", "produced", "accepted"],
    provenance: {
      source_kind: "session",
      source_ref: sourceSession,
      statement: "The query log records actual retrieval demand.",
    },
  },
  {
    artifact_id: "artifact-method",
    artifact_kind: "method-qualification",
    source_ref: "qualification-learning-method",
    statement: "Selective distillation passed the bounded A14 adapter qualification.",
    states: ["planned", "produced", "accepted"],
    provenance: {
      source_kind: "qualification",
      source_ref: "qualification-learning-method",
      statement: "Prediction, controls, red gate, custody, and read-back passed.",
    },
  },
  {
    artifact_id: "artifact-research",
    artifact_kind: "external-claim",
    source_ref: "external-learning-provenance",
    statement: "Provenance and decision relevance should survive distillation.",
    states: ["planned", "produced", "accepted"],
    provenance: {
      source_kind: "research",
      source_ref: "external-learning-provenance",
      statement: "The claim remains external testimony with source limitations.",
    },
  },
  {
    artifact_id: "artifact-preference",
    artifact_kind: "human-statement",
    source_ref: "user:concise-review",
    statement: "Keep review summaries concise unless I ask to expand.",
    states: ["planned", "produced", "accepted"],
    provenance: {
      source_kind: "human",
      source_ref: "user:concise-review",
      statement: "The user directly stated a scoped presentation preference.",
      actor_id: "noah",
    },
  },
];

test("outcome extraction reconciles planned, produced, accepted, and later-invalidated artifacts", () => {
  const extracted = call("extract_learning_outcome", {
    extraction_id: "extraction-a15",
    source_kind: "agent-session",
    source_ref: sourceSession,
    artifacts,
  });
  assertEqual(
    extracted.outcome.counts,
    { planned: 6, produced: 6, accepted: 6, later_invalidated: 1 },
    "outcome counts drifted",
  );
});

const scopeByChannel = {
  corpus: { repository: "test/learning", subsystem: "memory" },
  retrieval: { mode: "review", field: "how" },
  method: { workflow: "distillation", provider: "fixture" },
  research: { destination: "decision-premise" },
  "user-preference": { surface: "review-summary", audience: "noah" },
};
const targetByChannel = {
  corpus: "corpus-retention",
  retrieval: "retrieval-field-priority",
  method: "method-distillation",
  research: "research-learning-filter",
  "user-preference": "preference-review-density",
};
const evidenceByChannel = {
  corpus: ["artifact-code-current"],
  retrieval: ["artifact-query"],
  method: ["artifact-method"],
  research: ["artifact-research"],
  "user-preference": ["artifact-preference"],
};
const epistemicByChannel = {
  corpus: "observation",
  retrieval: "inference",
  method: "inference",
  research: "external-claim",
  "user-preference": "direct-intent",
};
function rollback(channel, knownRunIds = []) {
  return {
    trigger: `The ${channel} lesson fails its next-run audit or causes a measured regression.`,
    action: "Activate a qualified successor restoring the prior configuration.",
    preserves: ["candidate", "evaluation", "policy history", "counterevidence"],
    affected_future_runs: {
      selection_rule: `Future ${channel} runs reading this policy key`,
      known_run_ids: knownRunIds,
    },
  };
}
function propose(channel, extra = {}) {
  return call("propose_learning_lesson", {
    lesson_id: `lesson-${channel}`,
    extraction_id: "extraction-a15",
    channel,
    epistemic_kind: epistemicByChannel[channel],
    proposition: `${channel} learning remains typed and revisable.`,
    scope: scopeByChannel[channel],
    target_policy_key: targetByChannel[channel],
    configuration: { channel, enabled: true },
    evidence_artifact_ids: evidenceByChannel[channel],
    rollback_plan: rollback(channel),
    ...extra,
  });
}

test("five learning channels remain epistemically separate", () => {
  for (const channel of Object.keys(scopeByChannel)) {
    const extra =
      channel === "user-preference"
        ? {
            human_source: {
              actor_id: "noah",
              source_ref: "user:concise-review",
              statement: "Keep review summaries concise unless I ask to expand.",
              scope: scopeByChannel[channel],
            },
          }
        : {};
    assertEqual(propose(channel, extra).status, "candidate", `${channel} did not remain candidate`);
  }
  assertThrows(
    () =>
      call("propose_learning_lesson", {
        lesson_id: "lesson-preference-masquerade",
        extraction_id: "extraction-a15",
        channel: "user-preference",
        epistemic_kind: "observation",
        proposition: "A preference is a code fact.",
        scope: scopeByChannel["user-preference"],
        target_policy_key: "bad-preference",
        configuration: { enabled: true },
        evidence_artifact_ids: ["artifact-code-current"],
        rollback_plan: rollback("user-preference"),
      }),
    "requires epistemic_kind direct-intent",
  );
});

test("an attractive unscored summary cannot enter active policy", () => {
  assertThrows(
    () =>
      db
        .prepare(
          `INSERT INTO learning_policy_versions
             (policy_version_id,policy_key,revision_number,lesson_id,channel,
              configuration_json,configuration_hash,affected_future_runs_json,status,staged_by,
              activated_at)
           VALUES ('forged-policy','corpus-retention',1,'lesson-corpus','corpus',
                   '{"summary":"looks useful"}','forged','{}','active',?,datetime('now'))`,
        )
        .run(distillSession),
    "requires qualified lesson",
  );
  assertThrows(
    () =>
      call("stage_learning_policy", {
        policy_version_id: "unscored-stage",
        lesson_id: "lesson-corpus",
        configuration: { channel: "corpus", enabled: true },
      }),
    "qualified lesson",
  );
});

function qualify(channel) {
  const args = {
    evaluation_id: `evaluation-${channel}`,
    lesson_id: `lesson-${channel}`,
    evaluation_kind:
      channel === "method"
        ? "ablation"
        : channel === "user-preference"
          ? "human-confirmation"
          : "provenance-audit",
    metric: `${channel}-value-milli`,
    baseline_value_milli: 500,
    observed_value_milli: 800,
    expected_direction: "increase",
    minimum_effect_milli: 200,
    evidence_artifact_ids: evidenceByChannel[channel],
    limitations: [`One fixture establishes ${channel} mechanics, not a population claim.`],
  };
  if (channel === "method") args.method_qualification_id = "qualification-learning-method";
  if (channel === "user-preference") {
    args.confirmed_by_kind = "human";
    args.confirmed_by = "noah";
  }
  return call("qualify_learning_lesson", args);
}

test("every channel requires a scored qualification before activation", () => {
  for (const channel of Object.keys(scopeByChannel)) {
    const qualified = qualify(channel);
    assertEqual(qualified.status, "qualified", `${channel} qualification did not pass`);
  }
});

test("the runtime consumer hides an active row without post-activation read-back", () => {
  call("propose_learning_lesson", {
    lesson_id: "lesson-forged-readback",
    extraction_id: "extraction-a15",
    channel: "corpus",
    epistemic_kind: "observation",
    proposition: "A status label without consumer read-back is not active policy.",
    scope: scopeByChannel.corpus,
    target_policy_key: "forged-readback",
    configuration: { channel: "corpus", enabled: true },
    evidence_artifact_ids: evidenceByChannel.corpus,
    rollback_plan: rollback("corpus"),
  });
  call("qualify_learning_lesson", {
    evaluation_id: "evaluation-forged-readback",
    lesson_id: "lesson-forged-readback",
    evaluation_kind: "provenance-audit",
    metric: "custody-milli",
    baseline_value_milli: 0,
    observed_value_milli: 1000,
    expected_direction: "increase",
    minimum_effect_milli: 1000,
    evidence_artifact_ids: evidenceByChannel.corpus,
    limitations: ["This evaluates runtime custody, not product quality."],
  });
  db.transaction(() => {
    db.prepare(
      `INSERT INTO learning_policy_versions
         (policy_version_id,policy_key,revision_number,lesson_id,channel,
          configuration_json,configuration_hash,affected_future_runs_json,staged_by)
       VALUES ('policy-forged-readback:r1','forged-readback',1,'lesson-forged-readback',
               'corpus','{"channel":"corpus","enabled":true}','forged','{}',?)`,
    ).run(distillSession);
    db.prepare(
      `INSERT INTO learning_policy_readbacks
         (policy_version_id,phase,state_ok,coverage_ok,content_ok,ok,report_json,audited_by)
       VALUES ('policy-forged-readback:r1','preactivation',1,1,1,1,
               '{"axes":{"state":{"ok":true},"coverage":{"ok":true},"content":{"ok":true}},"ok":true}',?)`,
    ).run(distillSession);
    db.prepare(
      `INSERT INTO learning_events (lesson_id,event_type,actor_kind,actor_id,detail_json)
       VALUES ('lesson-forged-readback','activated','amanuensis',?,'{}')`,
    ).run(distillSession);
    db.prepare(
      "UPDATE learning_lessons SET status='active',activated_at=datetime('now') WHERE lesson_id='lesson-forged-readback'",
    ).run();
    db.prepare(
      "UPDATE learning_policy_versions SET status='active',activated_at=datetime('now') WHERE policy_version_id='policy-forged-readback:r1'",
    ).run();
  })();
  assertEqual(
    call("get_learning_policy", { policy_key: "forged-readback" }),
    null,
    "runtime consumer trusted active status without post-activation read-back",
  );
});

test("qualified policies activate only after next-run representation read-back", () => {
  for (const channel of Object.keys(scopeByChannel)) {
    const staged = call("stage_learning_policy", {
      policy_version_id: `policy-${channel}:r1`,
      lesson_id: `lesson-${channel}`,
      configuration: { channel, enabled: true },
    });
    assertEqual(staged.status, "staged", `${channel} policy did not stage`);
    const active = call("verify_learning_policy", {
      policy_version_id: `policy-${channel}:r1`,
    });
    assertEqual(active.status, "active", `${channel} policy did not activate`);
    assertEqual(
      call("get_learning_policy", { policy_key: targetByChannel[channel] }).configuration,
      { channel, enabled: true },
      `${channel} next-run reader drifted`,
    );
  }
});

test("supersession preserves history and names affected future runs", () => {
  const successor = call("propose_learning_lesson", {
    lesson_id: "lesson-retrieval-v2",
    predecessor_lesson_id: "lesson-retrieval",
    extraction_id: "extraction-a15",
    channel: "retrieval",
    epistemic_kind: "inference",
    proposition: "What/how retrieval should receive a bounded priority boost.",
    scope: scopeByChannel.retrieval,
    target_policy_key: targetByChannel.retrieval,
    configuration: { channel: "retrieval", enabled: true, boost: 2 },
    evidence_artifact_ids: evidenceByChannel.retrieval,
    rollback_plan: rollback("retrieval", ["future-review-17"]),
  });
  assertEqual(successor.status, "candidate", "successor did not start candidate");
  call("qualify_learning_lesson", {
    evaluation_id: "evaluation-retrieval-v2",
    lesson_id: "lesson-retrieval-v2",
    evaluation_kind: "ablation",
    metric: "retrieval-value-milli",
    baseline_value_milli: 500,
    observed_value_milli: 900,
    expected_direction: "increase",
    minimum_effect_milli: 200,
    evidence_artifact_ids: evidenceByChannel.retrieval,
    limitations: ["One same-session ablation remains a bounded result."],
  });
  call("stage_learning_policy", {
    policy_version_id: "policy-retrieval:r2",
    lesson_id: "lesson-retrieval-v2",
    configuration: { channel: "retrieval", enabled: true, boost: 2 },
  });
  call("verify_learning_policy", { policy_version_id: "policy-retrieval:r2" });
  const oldLesson = call("get_learning_ledger", { lesson_id: "lesson-retrieval" });
  assertEqual(oldLesson.status, "superseded", "prior lesson lost historical status");
  const oldPolicy = db
    .prepare(
      "SELECT status,superseded_by FROM learning_policy_versions WHERE policy_version_id='policy-retrieval:r1'",
    )
    .get();
  assertEqual(
    oldPolicy,
    { status: "superseded", superseded_by: "policy-retrieval:r2" },
    "prior policy history did not link its successor",
  );
  assertEqual(
    call("get_learning_policy", { policy_key: targetByChannel.retrieval }).affected_future_runs
      .known_run_ids,
    ["future-review-17"],
    "affected future run was not retained",
  );
});

test("read-back audit turns red on semantic drift without mutating policy", () => {
  const actual = call("get_learning_policy", { policy_key: targetByChannel.retrieval });
  const damaged = structuredClone(actual);
  damaged.configuration.boost = 99;
  assertEqual(
    call("audit_learning_policy", {
      policy_key: targetByChannel.retrieval,
      observed_policy: damaged,
    }).ok,
    false,
    "damaged next-run configuration stayed green",
  );
  assertEqual(
    call("audit_learning_policy", { policy_key: targetByChannel.retrieval }).ok,
    true,
    "durable policy did not survive fault injection",
  );
});

db.close();
rmSync(root, { recursive: true, force: true });
console.log(`\n${passed}/${passed + failed} learning-ledger checks passed.`);
if (failed > 0) process.exit(1);
