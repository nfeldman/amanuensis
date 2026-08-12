#!/usr/bin/env node
// A12: explicit acceptance authority, immutable decision history, impact obligations, and projection read-back.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { openDatabase } from "./dist/db.js";
import { decisionTools } from "./dist/tools/decisions.js";
import { projectTools } from "./dist/tools/project.js";

let passed = 0;
let failed = 0;
const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const DECISION_SCHEMA = JSON.parse(
  readFileSync(join(TEST_ROOT, "contracts/codebase-decision.schema.json"), "utf8"),
);
const validateDecisionSchema = new Ajv2020({ strict: true }).compile(DECISION_SCHEMA);
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
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}
function assertThrows(fn, text) {
  let error;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  if (!error?.message.includes(text)) throw new Error(`expected ${text}, got ${error?.message}`);
}
function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "amanuensis-decisions-"));
  mkdirSync(join(root, "src"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@localhost");
  git(root, "config", "user.name", "Decision Test");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "src/events.ts"), "export const version = 1;\n");
  git(root, "add", "src/events.ts");
  git(root, "commit", "-q", "--no-verify", "-m", "base");
  const base = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "src/events.ts"), "export const version = 2;\n");
  git(root, "add", "src/events.ts");
  git(root, "commit", "-q", "--no-verify", "-m", "change");
  const head = git(root, "rev-parse", "HEAD");
  const project = {
    workspacePath: root,
    projectKey: "test/decisions",
    storagePath: root,
    dbPath: join(root, "memory.db"),
    storageGitReady: false,
  };
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  const tools = new Map([...projectTools, ...decisionTools].map((tool) => [tool.name, tool]));
  ctx.sessionId = tools
    .get("start_session")
    .handler({ intent: "decision-controls" }, ctx).session_id;
  return { root, base, head, db, ctx, tools };
}
function call(f, name, args) {
  return f.tools.get(name).handler(args, f.ctx);
}
function draftArgs(decisionId, revisionId, predecessor = undefined) {
  return {
    decision_id: decisionId,
    revision_id: revisionId,
    title: "Event compatibility policy",
    ...(predecessor ? { predecessor_revision_id: predecessor } : {}),
    desire_sources: [
      {
        desire_id: "compatibility",
        statement: "Keep existing consumers working.",
        source_kind: "direct-user",
        source_ref: "user:test",
      },
    ],
    accepted_option: {
      option_key: revisionId.includes("2") ? "dual-read-v2" : "dual-read",
      summary: "Accept both versions during rollout.",
    },
    alternatives: [
      {
        option_key: "cutover",
        summary: "Switch atomically.",
        disposition: "rejected",
        evidence_ref: "amanuensis://finding/compat",
      },
    ],
    constraints: [
      {
        constraint_id: "compat",
        statement: "Version 1 consumers remain valid.",
        source_ref: "user:test",
      },
    ],
    consequences: [
      {
        consequence_id: "complexity",
        statement: "Adapter complexity rises temporarily.",
        direction: "cost",
      },
    ],
    falsifiers: [
      {
        falsifier_id: "compat-test",
        condition: "Version 1 fixture fails.",
        destination: "decision review",
      },
    ],
    premises: [
      {
        premise_id: "event-path",
        kind: "code",
        ref: "src/events.ts",
        statement: "Events carry a version field.",
      },
    ],
    code_changes: [{ path: "src/events.ts", relationship: "implements" }],
    rationale: "Preserves the direct compatibility desire while keeping rollback possible.",
    authored_by_kind: "model",
    authored_by: "fixture-model",
  };
}
const human = {
  actor_kind: "human",
  actor_id: "user:test",
  authority_scope: "event-policy",
  authority_source: "interactive acceptance",
  reason: "Compatibility outranks short-term simplicity.",
};

const f = fixture();
let revision;
test("model-authored recommendation remains draft and model acceptance is rejected", () => {
  revision = call(f, "draft_decision_revision", draftArgs("event-policy", "event-policy:r1"));
  assertEqual(revision.status, "draft", "generated proposal became policy");
  assertThrows(
    () =>
      call(f, "accept_decision_revision", {
        revision_id: revision.revision_id,
        actor_kind: "model",
        actor_id: "fixture-model",
        authority_scope: "event-policy",
        authority_source: "self",
        reason: "model chose it",
      }),
    "actor_kind must be one of",
  );
  assertThrows(
    () =>
      f.db
        .prepare(
          `INSERT INTO decision_events (revision_id,event_type,actor_kind,actor_id,authority_scope,reason) VALUES (?,'accepted','model','fixture','event-policy','forged')`,
        )
        .run(revision.revision_id),
    "explicit human or owning-system authority",
  );
  assertThrows(
    () =>
      f.db
        .prepare(
          "UPDATE decision_revisions SET status='accepted', terminal_at=datetime('now') WHERE revision_id=?",
        )
        .run(revision.revision_id),
    "acceptance transition lacks authorized event",
  );
});

test("authorized acceptance names actor, source, and scope", () => {
  const accepted = call(f, "accept_decision_revision", {
    revision_id: revision.revision_id,
    ...human,
  });
  assertEqual(accepted.status, "accepted", "authorized acceptance failed");
  const event = f.db
    .prepare("SELECT * FROM decision_events WHERE revision_id=? AND event_type='accepted'")
    .get(revision.revision_id);
  assertEqual(
    [event.actor_kind, event.actor_id, event.authority_scope],
    ["human", "user:test", "event-policy"],
    "acceptance authority was not preserved",
  );
});

test("accepted premise is immutable and impact creates a visible blocking obligation", () => {
  assertThrows(
    () =>
      f.db
        .prepare("UPDATE decision_revisions SET premises_json='[]' WHERE revision_id=?")
        .run(revision.revision_id),
    "payload is immutable",
  );
  f.db
    .prepare(
      `INSERT INTO change_impact_runs (run_id,base_sha,head_sha,relation_discovery_mode,max_depth,explicit_gap_count,status,artifact_json,session_id,applied_at) VALUES ('impact-decision',?,?,'explicit-only',1,0,'applied','{}',?,datetime('now'))`,
    )
    .run(f.base, f.head, f.ctx.sessionId);
  f.db
    .prepare(
      `INSERT INTO change_impact_files (run_id,ordinal,change_type,path_before,path_after) VALUES ('impact-decision',0,'modified','src/events.ts','src/events.ts')`,
    )
    .run();
  const result = call(f, "detect_decision_impacts", { impact_run_id: "impact-decision" });
  assertEqual(result.impacted_decision_count, 1, "changed premise did not impact the decision");
  const after = call(f, "get_decision", { decision_id: "event-policy" });
  assertEqual(after.revisions[0].status, "accepted", "impact silently rewrote accepted history");
  assertEqual(after.open_obligations[0].blocking, 1, "decision-review obligation was not blocking");
});

test("successor acceptance supersedes history and evidence-backed invalidation removes authority", () => {
  const successor = call(
    f,
    "draft_decision_revision",
    draftArgs("event-policy", "event-policy:r2", revision.revision_id),
  );
  call(f, "accept_decision_revision", { revision_id: successor.revision_id, ...human });
  let record = call(f, "get_decision", { decision_id: "event-policy" });
  assertEqual(
    record.revisions.map((row) => row.status),
    ["superseded", "accepted"],
    "successor did not supersede predecessor",
  );
  call(f, "invalidate_decision_revision", {
    revision_id: successor.revision_id,
    impact_run_id: "impact-decision",
    reason: "The event premise changed again.",
  });
  record = call(f, "get_decision", { decision_id: "event-policy" });
  assertEqual(record.current_revision_id, null, "invalidated decision retained current authority");
  assertEqual(record.revisions[1].status, "invalidated", "invalidated history was lost");
});

test("rejected option stays queryable and reconsideration requires a new revision", () => {
  const rejected = call(f, "draft_decision_revision", draftArgs("rejected-policy", "rejected:r1"));
  call(f, "reject_decision_revision", {
    revision_id: rejected.revision_id,
    actor_kind: "human",
    actor_id: "user:test",
    authority_scope: "rejected-policy",
    authority_source: "interactive rejection",
    reason: "Migration cost is premature.",
  });
  assertThrows(
    () =>
      call(f, "accept_decision_revision", {
        revision_id: rejected.revision_id,
        actor_kind: "human",
        actor_id: "user:test",
        authority_scope: "rejected-policy",
        authority_source: "retry",
        reason: "changed mind",
      }),
    "decision revision is rejected",
  );
  const reconsidered = call(
    f,
    "draft_decision_revision",
    draftArgs("rejected-policy", "rejected:r2", rejected.revision_id),
  );
  const record = call(f, "get_decision", { decision_id: "rejected-policy" });
  assertEqual(
    record.revisions.map((row) => row.status),
    ["rejected", "draft"],
    "rejected history was rewritten",
  );
  assertEqual(reconsidered.revision_number, 2, "reconsideration was not a new revision");
});

test("portable projection preserves custody and semantic read-back catches omissions", () => {
  const projected = call(f, "project_decision_revision", {
    projection_id: "projection:r1",
    revision_id: revision.revision_id,
  });
  assert(
    validateDecisionSchema(projected.projection),
    `portable projection failed schema: ${JSON.stringify(validateDecisionSchema.errors)}`,
  );
  const green = call(f, "verify_decision_projection", { projection_id: "projection:r1" });
  assert(green.ok, `canonical projection failed read-back: ${JSON.stringify(green)}`);
  const corrupted = structuredClone(projected.projection);
  delete corrupted.revision.desire_sources;
  corrupted.revision.alternatives = [];
  delete corrupted.revision.falsifiers;
  corrupted.events = corrupted.events.filter((event) => event.event_type !== "accepted");
  const red = call(f, "verify_decision_projection", {
    projection_id: "projection:r1",
    projection: corrupted,
  });
  assert(
    !red.ok && !red.axes.coverage.ok && !red.axes.content.ok,
    "custody omissions passed read-back",
  );
});

f.db.close();
rmSync(f.root, { recursive: true, force: true });
console.log(`\ndecisions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
