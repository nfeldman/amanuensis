#!/usr/bin/env node
// A17: versioned Chorusmith adapters, direct/orchestrated parity, invariant bypass, and restart recovery.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { openDatabase } from "./dist/db.js";
import { chorusmithAdapterTools } from "./dist/tools/chorusmith-adapter.js";
import { claimTools } from "./dist/tools/claims.js";
import { decisionTools } from "./dist/tools/decisions.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { projectTools } from "./dist/tools/project.js";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const CONTRACT_ROOT = join(TEST_ROOT, "contracts", "chorusmith");
const artifactSchema = JSON.parse(
  readFileSync(join(CONTRACT_ROOT, "artifact-input.schema.json"), "utf8"),
);
const runSchema = JSON.parse(readFileSync(join(CONTRACT_ROOT, "run-manifest.schema.json"), "utf8"));
const projectType = JSON.parse(readFileSync(join(CONTRACT_ROOT, "project-type.json"), "utf8"));
const custodyMatrix = JSON.parse(readFileSync(join(CONTRACT_ROOT, "custody-matrix.json"), "utf8"));
const extractionLedger = JSON.parse(
  readFileSync(join(CONTRACT_ROOT, "extraction-parity-ledger.json"), "utf8"),
);
const ajv = new Ajv2020({ strict: true });
const validateArtifact = ajv.compile(artifactSchema);
const validateRun = ajv.compile(runSchema);

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
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}
function contentHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(normalize(value)))
    .digest("hex");
}

const root = mkdtempSync(join(tmpdir(), "amanuensis-chorusmith-"));
mkdirSync(join(root, "src"));
git(root, "init", "-q");
git(root, "config", "user.email", "test@localhost");
git(root, "config", "user.name", "Chorusmith Adapter Test");
git(root, "config", "commit.gpgsign", "false");
writeFileSync(join(root, "src", "boundary.ts"), "export const authority = 'amanuensis';\n");
git(root, "add", "src/boundary.ts");
git(root, "commit", "-q", "--no-verify", "-m", "adapter fixture");
const sha = git(root, "rev-parse", "HEAD");

function context(name) {
  const project = {
    workspacePath: root,
    projectKey: `test/chorusmith-${name}`,
    storagePath: root,
    dbPath: join(root, `${name}.db`),
    storageGitReady: false,
  };
  return { project, db: openDatabase(project.dbPath), sessionId: null };
}

const allTools = new Map(
  [
    ...projectTools,
    ...evidenceTools,
    ...claimTools,
    ...decisionTools,
    ...chorusmithAdapterTools,
  ].map((tool) => [tool.name, tool]),
);
function call(ctx, name, args) {
  const tool = allTools.get(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.handler(args, ctx);
}

const evidenceArgs = {
  file_path: "src/boundary.ts",
  line_range: "1-1",
  ref_sha: sha,
  kind: "code-verified",
  excerpt: "export const authority = 'amanuensis';",
  note: "Amanuensis retains domain authority at the adapter boundary.",
};
const claimArgs = {
  claim_id: "claim-adapter-authority",
  claim_key: "adapter.authority",
  subject_type: "subsystem",
  subject_id: "chorusmith-adapter",
  statement: "Amanuensis remains authoritative for domain invariants.",
  epistemic_kind: "observation",
  ref_sha: sha,
  evidence_ids: [1],
};
const draftArgs = {
  decision_id: "decision-adapter-boundary",
  revision_id: "decision-adapter-boundary:r1",
  title: "Adapter authority boundary",
  desire_sources: [
    {
      desire_id: "direct-use",
      statement: "Amanuensis must remain independently usable.",
      source_kind: "direct-user",
      source_ref: "user:a17",
    },
  ],
  accepted_option: {
    option_key: "projection-invocation",
    summary: "Give Chorusmith projection and invocation, not domain-table authority.",
  },
  alternatives: [
    {
      option_key: "transfer",
      summary: "Move the workflow into Chorusmith immediately.",
      disposition: "rejected",
      evidence_ref: "amanuensis://claim/claim-adapter-authority",
    },
  ],
  constraints: [
    {
      constraint_id: "independent",
      statement: "Direct MCP operation remains available.",
      source_ref: "user:a17",
    },
  ],
  consequences: [
    {
      consequence_id: "duplicate-surface",
      statement: "The adapter contract exists beside the direct interface during parity work.",
      direction: "cost",
    },
  ],
  falsifiers: [
    {
      falsifier_id: "bypass",
      condition: "The adapter can bypass a domain invariant.",
      destination: "A17 red gate",
    },
  ],
  premises: [
    {
      premise_id: "authority",
      kind: "claim",
      ref: "claim-adapter-authority",
      statement: "Amanuensis owns domain invariants.",
    },
  ],
  code_changes: [{ path: "src/boundary.ts", relationship: "constrains" }],
  rationale: "Preserve one authoritative domain path while exposing typed orchestration.",
  authored_by_kind: "model",
  authored_by: "fixture-model",
};
const acceptArgs = {
  revision_id: "decision-adapter-boundary:r1",
  actor_kind: "human",
  actor_id: "fixture-human",
  authority_scope: "decision-adapter-boundary",
  authority_source: "user:a17",
  reason: "Fixture acceptance exercises the authority gate.",
};
const invalidateArgs = {
  revision_id: "decision-adapter-boundary:r1",
  evidence_id: 1,
  reason: "Fixture invalidation creates a durable review obligation.",
};
const obligationId = "decision-impact:evidence-1:decision-adapter-boundary:r1";
const parityScope = {
  claim_ids: ["claim-adapter-authority"],
  decision_ids: ["decision-adapter-boundary"],
  obligation_ids: [obligationId],
  evidence_ids: [1],
};

function runDirectScenario(ctx) {
  call(ctx, "start_session", { intent: "direct parity path" });
  call(ctx, "add_evidence", evidenceArgs);
  call(ctx, "add_claim", claimArgs);
  call(ctx, "draft_decision_revision", draftArgs);
  call(ctx, "accept_decision_revision", acceptArgs);
  call(ctx, "invalidate_decision_revision", invalidateArgs);
  return call(ctx, "capture_chorusmith_parity_snapshot", { parity_scope: parityScope });
}

const directCtx = context("direct");
let direct;
test("direct path produces the frozen authoritative parity baseline", () => {
  direct = runDirectScenario(directCtx);
  assertEqual(direct.snapshot.verification_surface.authoritative_claim_count, 1, "claims");
  assertEqual(direct.snapshot.verification_surface.obligation_count, 1, "obligations");
  assertEqual(direct.snapshot.evidence.records[0].id, 1, "evidence identity");
});

let orchestratedCtx = context("orchestrated");
call(orchestratedCtx, "start_session", { intent: "plan orchestrated parity path" });
const steps = [
  {
    step_id: "adapter-step-1",
    adapter_kind: "CodebaseBrief",
    tool_name: "add_evidence",
    args: evidenceArgs,
    expected_output_keys: ["id"],
  },
  {
    step_id: "adapter-step-2",
    adapter_kind: "CodebaseBrief",
    tool_name: "add_claim",
    args: claimArgs,
    expected_output_keys: ["ok", "claim_id"],
  },
  {
    step_id: "adapter-step-3",
    adapter_kind: "Decision",
    tool_name: "draft_decision_revision",
    args: draftArgs,
    expected_output_keys: ["revision_id", "status"],
  },
  {
    step_id: "adapter-step-4",
    adapter_kind: "Decision",
    tool_name: "accept_decision_revision",
    args: acceptArgs,
    expected_output_keys: ["revision_id", "status"],
  },
  {
    step_id: "adapter-step-5",
    adapter_kind: "Obligation",
    tool_name: "invalidate_decision_revision",
    args: invalidateArgs,
    expected_output_keys: ["revision_id", "status"],
  },
];

test("catalog and checked-in contract expose exactly six versioned adapters", () => {
  const catalog = call(orchestratedCtx, "get_chorusmith_adapter_catalog", {});
  assertEqual(catalog.adapters.length, 6, "adapter count");
  assertEqual(
    catalog.adapters.map((adapter) => ({
      kind: adapter.kind,
      artifactKind: adapter.artifact_kind,
      schemaRef: adapter.schema_ref,
      outputSlot: adapter.output_slot,
    })),
    projectType.adapters,
    "project-type adapter registry",
  );
  assertEqual(projectType.upstreamCompatibility.commit.length, 40, "pinned Chorusmith commit");
  assertEqual(catalog.custody_matrix, custodyMatrix, "custody matrix read-back");
  for (const adapter of projectType.adapters) {
    const fixture = {
      kind: "AmanuensisChorusmithArtifactEnvelope",
      schemaVersion: "1.0.0",
      sourceRef: `amanuensis://${adapter.kind}/fixture`,
      sourcePayloadHash: `sha256:${"0".repeat(64)}`,
      authority: {
        owner: "amanuensis",
        transfer: "projection-only",
        externalWriteAuthority: false,
      },
      artifactInput: {
        runKey: null,
        artifactKind: adapter.artifactKind,
        schemaRef: adapter.schemaRef,
        schemaVersion: "1.0.0",
        producedByStageId: "amanuensis-adapter",
        attemptIndex: 0,
        outputSlot: adapter.outputSlot,
        payload: {},
      },
    };
    assert(
      validateArtifact(fixture),
      `${adapter.kind}: ${ajv.errorsText(validateArtifact.errors)}`,
    );
  }
  assert(
    extractionLedger.features.every((feature) => feature.extraction_status === "retained-direct"),
    "workflow must not move before feature parity",
  );
});

test("run manifest freezes an allowlisted exact-commit replay", () => {
  call(orchestratedCtx, "plan_chorusmith_adapter_run", {
    run_id: "chorusmith-parity-run",
    external_run_ref: "chorusmith://run/a17-parity",
    source_commit: sha,
    expected_direct: direct,
    parity_policy: {
      recovery_probe_required: true,
      max_verification_overhead_us: 200000,
    },
    steps,
  });
  const stored = call(orchestratedCtx, "get_chorusmith_adapter_run", {
    run_id: "chorusmith-parity-run",
  });
  assert(validateRun(stored.manifest), ajv.errorsText(validateRun.errors));
  assertEqual(stored.manifest.source_commit, sha, "exact source commit");
  assertEqual(stored.steps.length, 5, "frozen step fan-out");
  assertThrows(
    () =>
      orchestratedCtx.db
        .prepare("UPDATE chorusmith_adapter_runs SET recovery_count=1 WHERE run_id=?")
        .run("chorusmith-parity-run"),
    "chorusmith recovery count requires one reconciled receipt",
  );
  assertThrows(
    () =>
      orchestratedCtx.db
        .prepare(
          `INSERT INTO chorusmith_adapter_steps
             (step_id,run_id,ordinal,adapter_kind,tool_name,args_json,args_hash,
              expected_output_keys_json)
           VALUES ('extra-step','chorusmith-parity-run',6,'Decision',
                   'draft_decision_revision','{}','forged','["revision_id"]')`,
        )
        .run(),
    "chorusmith adapter step count exceeds frozen manifest",
  );
});

test("execution halts when the checked-out source commit drifts", () => {
  writeFileSync(join(root, "src", "boundary.ts"), "export const authority = 'drifted';\n");
  git(root, "add", "src/boundary.ts");
  git(root, "commit", "-q", "--no-verify", "-m", "source drift probe");
  assertThrows(
    () =>
      call(orchestratedCtx, "execute_chorusmith_adapter_step", {
        run_id: "chorusmith-parity-run",
        step_id: "adapter-step-1",
      }),
    "adapter source commit drift",
  );
  git(root, "checkout", "-q", sha);
});

test("adapter rejects cross-contract tool smuggling before execution", () => {
  assertThrows(
    () =>
      call(orchestratedCtx, "plan_chorusmith_adapter_run", {
        run_id: "smuggled-tool-run",
        external_run_ref: "chorusmith://run/smuggled",
        source_commit: sha,
        expected_direct: direct,
        parity_policy: {
          recovery_probe_required: false,
          max_verification_overhead_us: 200000,
        },
        steps: [
          {
            step_id: "smuggled",
            adapter_kind: "Decision",
            tool_name: "add_claim",
            args: claimArgs,
            expected_output_keys: ["claim_id"],
          },
        ],
      }),
    "add_claim is not authorized by the Decision@1.0.0 adapter",
  );
});

test("orchestrated steps execute in order through authoritative Amanuensis handlers", () => {
  assertThrows(
    () =>
      call(orchestratedCtx, "execute_chorusmith_adapter_step", {
        run_id: "chorusmith-parity-run",
        step_id: "adapter-step-2",
      }),
    "out-of-order adapter step",
  );
  call(orchestratedCtx, "execute_chorusmith_adapter_step", {
    run_id: "chorusmith-parity-run",
    step_id: "adapter-step-1",
  });
  assertThrows(
    () =>
      orchestratedCtx.db
        .prepare("UPDATE chorusmith_adapter_steps SET output_hash='forged' WHERE step_id=?")
        .run("adapter-step-1"),
    "chorusmith adapter step output is immutable after landing",
  );
  call(orchestratedCtx, "execute_chorusmith_adapter_step", {
    run_id: "chorusmith-parity-run",
    step_id: "adapter-step-2",
  });
});

test("removing Chorusmith mid-run resumes from durable custody without source mutation", () => {
  const dbPath = orchestratedCtx.project.dbPath;
  orchestratedCtx.db.close();
  orchestratedCtx = {
    project: orchestratedCtx.project,
    db: openDatabase(dbPath),
    sessionId: null,
  };
  call(orchestratedCtx, "start_session", { intent: "resume after orchestrator removal" });
  const resumed = call(orchestratedCtx, "resume_chorusmith_adapter_run", {
    run_id: "chorusmith-parity-run",
  });
  assertEqual(resumed.landed_step_count, 2, "landed prefix");
  assertEqual(resumed.next_step_id, "adapter-step-3", "next step");
  assertEqual(resumed.source_state_mutated_by_recovery, false, "recovery mutation");
});

test("resumed run lands exact fan-in and matches direct behavior, evidence, and verification surface", () => {
  for (const stepId of ["adapter-step-3", "adapter-step-4", "adapter-step-5"]) {
    call(orchestratedCtx, "execute_chorusmith_adapter_step", {
      run_id: "chorusmith-parity-run",
      step_id: stepId,
    });
  }
  const report = call(orchestratedCtx, "verify_chorusmith_adapter_parity", {
    run_id: "chorusmith-parity-run",
  });
  assert(report.axes.behavior.ok, "behavior parity");
  assert(report.axes.evidence.ok, "evidence parity");
  assert(report.axes.recovery.ok, "recovery parity");
  assert(report.axes.verification_time.ok, "verification-time parity");
  assert(report.ok, "four-axis parity");
  const cleanExport = call(orchestratedCtx, "capture_chorusmith_parity_snapshot", {
    parity_scope: parityScope,
  });
  assertEqual(cleanExport.snapshot_hash, direct.snapshot_hash, "deterministic clean parity export");
  const stored = call(orchestratedCtx, "get_chorusmith_adapter_run", {
    run_id: "chorusmith-parity-run",
  });
  assertEqual(stored.status, "verified", "verified state");
  assertEqual(stored.steps.filter((step) => step.status === "landed").length, 5, "exact fan-in");
});

test("versioned custody envelopes project Chorusmith input fields without transferring authority", () => {
  for (const [adapterKind, sourceId] of [
    ["Decision", "decision-adapter-boundary"],
    ["Obligation", obligationId],
    ["RunManifest", "chorusmith-parity-run"],
  ]) {
    const exported = call(orchestratedCtx, "export_chorusmith_adapter_artifact", {
      export_id: `export-${adapterKind}`,
      adapter_kind: adapterKind,
      source_id: sourceId,
      run_id: "chorusmith-parity-run",
    });
    assert(validateArtifact(exported.envelope), ajv.errorsText(validateArtifact.errors));
    assertEqual(exported.envelope.authority.externalWriteAuthority, false, "write authority");
    assertEqual(exported.envelope.artifactInput.runKey, "chorusmith://run/a17-parity", "run key");
  }
});

test("adapter invocation cannot bypass human decision authority", () => {
  const badDraft = structuredClone(draftArgs);
  badDraft.decision_id = "decision-bypass-probe";
  badDraft.revision_id = "decision-bypass-probe:r1";
  badDraft.title = "Bypass probe";
  call(orchestratedCtx, "plan_chorusmith_adapter_run", {
    run_id: "authority-bypass-run",
    external_run_ref: "chorusmith://run/authority-bypass",
    source_commit: sha,
    expected_direct: call(orchestratedCtx, "capture_chorusmith_parity_snapshot", {
      parity_scope: parityScope,
    }),
    parity_policy: {
      recovery_probe_required: false,
      max_verification_overhead_us: 200000,
    },
    steps: [
      {
        step_id: "bypass-draft",
        adapter_kind: "Decision",
        tool_name: "draft_decision_revision",
        args: badDraft,
        expected_output_keys: ["revision_id", "status"],
      },
      {
        step_id: "bypass-accept",
        adapter_kind: "Decision",
        tool_name: "accept_decision_revision",
        args: {
          revision_id: "decision-bypass-probe:r1",
          actor_kind: "model",
          actor_id: "chorusmith",
          authority_scope: "decision-bypass-probe",
          authority_source: "adapter-self-assertion",
          reason: "Attempted adapter authority escalation.",
        },
        expected_output_keys: ["revision_id", "status"],
      },
    ],
  });
  call(orchestratedCtx, "execute_chorusmith_adapter_step", {
    run_id: "authority-bypass-run",
    step_id: "bypass-draft",
  });
  assertThrows(
    () =>
      call(orchestratedCtx, "execute_chorusmith_adapter_step", {
        run_id: "authority-bypass-run",
        step_id: "bypass-accept",
      }),
    "actor_kind must be one of",
  );
  const decision = call(orchestratedCtx, "get_decision", {
    decision_id: "decision-bypass-probe",
  });
  assertEqual(decision.revisions[0].status, "draft", "bypass must retain draft status");
  const run = call(orchestratedCtx, "get_chorusmith_adapter_run", {
    run_id: "authority-bypass-run",
  });
  assertEqual(run.steps[1].status, "planned", "rejected step remains pending");
});

const redCtx = context("parity-red");
test("a behavior mismatch keeps extraction blocked and the run unverified", () => {
  call(redCtx, "start_session", { intent: "prove parity can turn red" });
  const damagedDirect = structuredClone(direct);
  damagedDirect.snapshot.behavior.claims[0].statement = "A different baseline claim.";
  damagedDirect.snapshot_hash = contentHash(damagedDirect.snapshot);
  call(redCtx, "plan_chorusmith_adapter_run", {
    run_id: "parity-red-run",
    external_run_ref: "chorusmith://run/parity-red",
    source_commit: sha,
    expected_direct: damagedDirect,
    parity_policy: {
      recovery_probe_required: false,
      max_verification_overhead_us: 200000,
    },
    steps,
  });
  for (const step of steps) {
    call(redCtx, "execute_chorusmith_adapter_step", {
      run_id: "parity-red-run",
      step_id: step.step_id,
    });
  }
  const report = call(redCtx, "verify_chorusmith_adapter_parity", {
    run_id: "parity-red-run",
  });
  assert(!report.axes.behavior.ok, "behavior mismatch should turn red");
  assert(!report.ok, "parity report should block");
  assertEqual(report.extraction_status, "blocked", "extraction state");
  assertEqual(
    call(redCtx, "get_chorusmith_adapter_run", { run_id: "parity-red-run" }).status,
    "ready",
    "red run must not verify",
  );
});

directCtx.db.close();
orchestratedCtx.db.close();
redCtx.db.close();
rmSync(root, { recursive: true, force: true });
console.log(`\nchorusmith-adapter: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
