#!/usr/bin/env node
// A13: decision-bounded research admission, Scholiast custody, and external/code separation.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { openDatabase } from "./dist/db.js";
import { claimTools } from "./dist/tools/claims.js";
import { decisionTools } from "./dist/tools/decisions.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { projectTools } from "./dist/tools/project.js";
import { researchTools } from "./dist/tools/research.js";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const SCHOLIAST_WORKSPACE = join(
  TEST_ROOT,
  "fixtures",
  "research",
  "scholiast",
  "version-semantics",
);
const REQUEST_SCHEMA = JSON.parse(
  readFileSync(join(TEST_ROOT, "contracts", "research-request.schema.json"), "utf8"),
);
const validateRequest = new Ajv2020({ strict: true }).compile(REQUEST_SCHEMA);

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

const root = mkdtempSync(join(tmpdir(), "amanuensis-research-broker-"));
mkdirSync(join(root, "src"));
git(root, "init", "-q");
git(root, "config", "user.email", "test@localhost");
git(root, "config", "user.name", "Research Broker Test");
git(root, "config", "commit.gpgsign", "false");
writeFileSync(join(root, "src", "events.ts"), "export const supportedVersion = 1;\n");
git(root, "add", "src/events.ts");
git(root, "commit", "-q", "--no-verify", "-m", "fixture");
const sha = git(root, "rev-parse", "HEAD");
const project = {
  workspacePath: root,
  projectKey: "test/research-broker",
  storagePath: root,
  dbPath: join(root, "memory.db"),
  storageGitReady: false,
};
const db = openDatabase(project.dbPath);
const ctx = { project, db, sessionId: null };
const tools = new Map(
  [...projectTools, ...evidenceTools, ...claimTools, ...decisionTools, ...researchTools].map(
    (tool) => [tool.name, tool],
  ),
);
function call(name, args) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.handler(args, ctx);
}
ctx.sessionId = call("start_session", { intent: "research-broker-red-gate" }).session_id;
const evidenceId = call("add_evidence", {
  file_path: "src/events.ts",
  line_range: "1-1",
  ref_sha: sha,
  kind: "code-verified",
  excerpt: "export const supportedVersion = 1;",
}).id;
call("add_claim", {
  claim_id: "code-version-v1",
  claim_key: "events.supported-version",
  subject_type: "subsystem",
  subject_id: "events",
  statement: "The implementation supports event version 1.",
  epistemic_kind: "observation",
  ref_sha: sha,
  evidence_ids: [evidenceId],
});
call("draft_decision_revision", {
  decision_id: "event-version-policy",
  revision_id: "event-version-policy:r1",
  title: "Event version compatibility",
  desire_sources: [
    {
      desire_id: "compatibility",
      statement: "Keep current consumers working.",
      source_kind: "direct-user",
      source_ref: "user:test",
    },
  ],
  accepted_option: {
    option_key: "retain-v1",
    summary: "Retain version 1 while evidence is gathered.",
  },
  alternatives: [
    {
      option_key: "adopt-v2",
      summary: "Adopt version 2.",
      disposition: "rejected",
      evidence_ref: "amanuensis://claim/code-version-v1",
    },
  ],
  constraints: [
    {
      constraint_id: "compat",
      statement: "Current consumers remain valid.",
      source_ref: "user:test",
    },
  ],
  consequences: [
    { consequence_id: "adapter", statement: "An adapter may be required.", direction: "cost" },
  ],
  falsifiers: [
    {
      falsifier_id: "standard-v2-only",
      condition: "Authoritative standards require version 2 only.",
      destination: "event-version-policy premise review",
    },
  ],
  premises: [
    {
      premise_id: "implemented-v1",
      kind: "claim",
      ref: "code-version-v1",
      statement: "The current implementation supports version 1.",
    },
  ],
  code_changes: [{ path: "src/events.ts", relationship: "implements" }],
  rationale: "Keep repository behavior authoritative while external semantics are investigated.",
  authored_by_kind: "model",
  authored_by: "fixture-model",
});

const baseRequest = {
  uncertainty: "Whether external interoperability norms make the version-1 premise unsafe.",
  decision_destination: {
    decision_id: "event-version-policy",
    revision_id: "event-version-policy:r1",
    field: "premise",
    ref: "implemented-v1",
  },
  current_evidence: [
    {
      kind: "code-claim",
      ref: "code-version-v1",
      statement: "The implementation supports event version 1.",
    },
  ],
  needed_source_classes: ["primary standards", "protocol specifications"],
  disconfirmers: ["A primary specification explicitly permits version 1 interoperability."],
  budget: { max_sources: 6, max_minutes: 90 },
  local_evidence_search: {
    outcome: "exhausted",
    queries: ["supportedVersion", "event version compatibility"],
    locations: ["src/events.ts", "repository documentation"],
    unresolved_reason:
      "The repository establishes behavior but not external protocol requirements.",
  },
  expected_information_value: { decision_sensitivity: 4, uncertainty_reducibility: 4 },
};

test("curiosity-only work is retained as rejected and nonblocking", () => {
  const result = call("propose_research_request", {
    ...baseRequest,
    request_id: "rq-curiosity",
    question: "What is the history of event version numbers?",
    decision_destination: undefined,
    current_evidence: [],
    local_evidence_search: {
      outcome: "not-run",
      queries: [],
      locations: [],
      unresolved_reason: "",
    },
  });
  assertEqual(result.status, "rejected", "curiosity-only request entered the queue");
  assertEqual(result.blocking, false, "curiosity-only request became blocking");
  assert(
    validateRequest(result.contract),
    `rejected contract failed schema: ${JSON.stringify(validateRequest.errors)}`,
  );
});

test("unexhausted or low-value work is deferred and can expire without disappearing", () => {
  const result = call("propose_research_request", {
    ...baseRequest,
    request_id: "rq-deferred",
    question: "Does the broader ecosystem prefer version 2?",
    current_evidence: [
      {
        kind: "code-claim",
        ref: "code-version-v1",
        statement: "A convenient paraphrase that is not the durable claim.",
      },
    ],
    local_evidence_search: {
      outcome: "not-run",
      queries: [],
      locations: [],
      unresolved_reason: "",
    },
    expected_information_value: { decision_sensitivity: 2, uncertainty_reducibility: 2 },
  });
  assertEqual(result.status, "deferred", "low-value request was admitted");
  assert(
    result.contract.admission.reasons.some((reason) => reason.includes("does not match")),
    "mismatched local-evidence prose was not detected",
  );
  assertThrows(
    () =>
      db
        .prepare("UPDATE research_requests SET status='expired' WHERE request_id='rq-deferred'")
        .run(),
    "transition lacks event",
  );
  const expired = call("expire_research_request", {
    request_id: "rq-deferred",
    reason: "Decision proceeds under explicit uncertainty.",
  });
  assertEqual(expired.status, "expired", "deferred request did not reach durable expiry");
  assertEqual(
    call("list_research_requests", { status: "expired" }).length,
    1,
    "expiry disappeared",
  );
});

let admitted;
test("admission is contract-valid and queue transitions require durable events", () => {
  admitted = call("propose_research_request", {
    ...baseRequest,
    request_id: "rq-version-policy",
    question: "Do primary protocol standards require event version 2 for interoperability?",
  });
  assertEqual(admitted.status, "admitted", "decision-relevant request was not admitted");
  assert(
    validateRequest(admitted.contract),
    `admitted contract failed schema: ${JSON.stringify(validateRequest.errors)}`,
  );
  assertThrows(
    () =>
      db
        .prepare(
          "UPDATE research_requests SET status='dispatched' WHERE request_id='rq-version-policy'",
        )
        .run(),
    "transition lacks durable custody object",
  );
});

test("duplicates link prior work unless an actual changed premise is named", () => {
  const duplicate = call("propose_research_request", {
    ...baseRequest,
    request_id: "rq-version-policy-duplicate",
    question: "Do primary protocol standards require event version 2 for interoperability?",
  });
  assertEqual(duplicate.status, "rejected", "duplicate was dispatched as fresh work");
  assertEqual(duplicate.duplicate_of, "rq-version-policy", "duplicate did not link prior work");
  const changed = call("propose_research_request", {
    ...baseRequest,
    request_id: "rq-version-policy-changed",
    question: "Do primary protocol standards require event version 2 for interoperability?",
    changed_premise_refs: ["implemented-v1"],
  });
  assertEqual(changed.status, "admitted", "named changed premise did not permit reconsideration");
  call("expire_research_request", {
    request_id: "rq-version-policy-changed",
    reason: "Duplicate-change escape tested; no dispatch required.",
  });
});

test("Scholiast dispatch refuses temp custody and furnishes a complete handoff", () => {
  assertThrows(
    () =>
      call("dispatch_research_request", {
        request_id: "rq-version-policy",
        dispatch_id: "dispatch-temp",
        workspace_path: root,
        ruled_out: [],
      }),
    "cannot be temporary",
  );
  const dispatched = call("dispatch_research_request", {
    request_id: "rq-version-policy",
    dispatch_id: "dispatch-version-policy",
    workspace_path: SCHOLIAST_WORKSPACE,
    ruled_out: ["Repository inspection cannot establish external protocol norms."],
  });
  assertEqual(dispatched.handoff.workspace_path, SCHOLIAST_WORKSPACE, "workspace custody drifted");
  assert(dispatched.handoff.held_evidence.length === 1, "held evidence did not cross the boundary");
  assert(
    dispatched.handoff.access_status_rule.includes("unread hop"),
    "access degradation rule missing",
  );
});

test("well-cited contradiction lands externally and cannot rewrite code observation", () => {
  const before = db.prepare("SELECT * FROM claims WHERE claim_id='code-version-v1'").get();
  assertThrows(
    () =>
      call("land_research_result", {
        request_id: "rq-version-policy",
        result_id: "result-misdirected",
        artifact_paths: [join(SCHOLIAST_WORKSPACE, "claims.md")],
        summary: "Misdirected fixture.",
        sources: [
          {
            source_id: "misdirected-source",
            title: "Misdirected source",
            locator: "urn:example:misdirected",
            source_class: "primary standard",
            access_status: "directly-read",
            held_excerpt: "A directly read passage.",
            limitation: "Test fixture only.",
          },
        ],
        claims: [
          {
            external_claim_id: "misdirected-claim",
            statement: "A result should not be able to redirect itself.",
            classification: "inferred",
            confidence: "single-source",
            source_ids: ["misdirected-source"],
            target_kind: "option",
            target_ref: "adopt-v2",
          },
        ],
      }),
    "destination does not match",
  );
  const landed = call("land_research_result", {
    request_id: "rq-version-policy",
    result_id: "result-version-policy",
    artifact_paths: [
      join(SCHOLIAST_WORKSPACE, "claims.md"),
      join(SCHOLIAST_WORKSPACE, "sources.md"),
    ],
    summary:
      "External standards sources assert version 2 while repository behavior remains version 1.",
    sources: [
      {
        source_id: "spec-a",
        title: "Protocol Standard A",
        locator: "doi:10.0000/example-a",
        source_class: "primary standard",
        access_status: "directly-read",
        held_excerpt: "Conformant messages use protocol version 2.",
        limitation: "Specifies wire interoperability, not this repository's implementation.",
      },
      {
        source_id: "spec-b",
        title: "Protocol Standard B",
        locator: "urn:example:standard-b",
        source_class: "primary standard",
        access_status: "directly-read",
        held_excerpt: "Version 2 is required at the current conformance level.",
        limitation: "Does not establish deployed consumer capabilities.",
      },
    ],
    claims: [
      {
        external_claim_id: "external-v2-required",
        statement: "Current external protocol conformance requires event version 2.",
        classification: "contested",
        confidence: "corroborated",
        source_ids: ["spec-a", "spec-b"],
        target_kind: "decision-premise",
        target_ref: "implemented-v1",
        contradicts_code_claim_ids: ["code-version-v1"],
      },
    ],
  });
  assert(
    landed.result.artifact_manifest.every((item) => item.sha256.length === 64),
    "artifact read-back missing",
  );
  const after = db.prepare("SELECT * FROM claims WHERE claim_id='code-version-v1'").get();
  assertEqual(after, before, "external testimony rewrote the code observation");
  assertEqual(
    db.prepare("SELECT COUNT(*) AS n FROM research_external_claims").get().n,
    1,
    "external claim missing",
  );
  assertEqual(
    db.prepare("SELECT COUNT(*) AS n FROM research_code_contradictions WHERE status='open'").get()
      .n,
    1,
    "contradiction was smoothed away",
  );
  assertThrows(
    () =>
      db
        .prepare(
          "UPDATE research_external_claims SET statement='smoothed' WHERE external_claim_id='external-v2-required'",
        )
        .run(),
    "external claim is immutable",
  );
  assertThrows(
    () =>
      db
        .prepare(
          "UPDATE research_code_contradictions SET status='resolved', resolution_note='smoothed'",
        )
        .run(),
    "contradiction is immutable",
  );
});

test("consumption records the exact changed field and preserves decision history", () => {
  const decisionBefore = db
    .prepare(
      "SELECT premises_json FROM decision_revisions WHERE revision_id='event-version-policy:r1'",
    )
    .get();
  assertThrows(
    () =>
      call("consume_research_result", {
        request_id: "rq-version-policy",
        consumption_id: "consume-without-reason",
        effect_kind: "no-change",
      }),
    "no-change consumption requires only no_change_reason",
  );
  const consumed = call("consume_research_result", {
    request_id: "rq-version-policy",
    consumption_id: "consume-version-policy",
    effect_kind: "decision-premise",
    external_claim_id: "external-v2-required",
    target_ref: "implemented-v1",
    effect_statement: "The premise now requires an explicit interoperability qualification.",
  });
  assertEqual(consumed.changed, true, "consumption lost its decision effect");
  assertEqual(consumed.target_ref, "implemented-v1", "consumption lost the changed field");
  const decisionAfter = db
    .prepare(
      "SELECT premises_json FROM decision_revisions WHERE revision_id='event-version-policy:r1'",
    )
    .get();
  assertEqual(decisionAfter, decisionBefore, "research silently edited immutable decision history");
  const record = call("get_research_request", { request_id: "rq-version-policy" });
  assertEqual(record.status, "consumed", "queue did not reach consumed");
  assertEqual(
    record.consumption.effect_kind,
    "decision-premise",
    "consumption read-back lost effect",
  );
  assertEqual(
    record.result.contradictions[0].code_claim_id,
    "code-version-v1",
    "contradiction read-back missing",
  );
});

db.close();
rmSync(root, { recursive: true, force: true });
console.log(`\n${passed}/${passed + failed} research-broker checks passed.`);
if (failed > 0) process.exit(1);
