#!/usr/bin/env node
// A4: evidence-gated repair, append-only resolution history, and cross-domain audit.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./dist/db.js";
import { claimTools } from "./dist/tools/claims.js";
import { contradictionTools } from "./dist/tools/contradictions.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { findingTools } from "./dist/tools/findings.js";
import { projectTools } from "./dist/tools/project.js";
import { resolutionTools } from "./dist/tools/resolution.js";

let passed = 0;
function assert(value, message) {
  if (!value) throw new Error(message);
}
function test(label, fn) {
  fn();
  passed++;
  console.log(`  ok   ${label}`);
}
function assertThrows(fn, text) {
  try {
    fn();
  } catch (error) {
    assert(error.message.includes(text), `expected ${JSON.stringify(text)}, got ${error.message}`);
    return;
  }
  throw new Error(`expected throw containing ${JSON.stringify(text)}`);
}

const root = mkdtempSync(join(tmpdir(), "amanuensis-resolution-"));
const workspace = join(root, "workspace");
const storage = join(root, "storage");
mkdirSync(workspace);
mkdirSync(storage);
execFileSync("git", ["init", "-q"], { cwd: workspace });
function commit(value) {
  writeFileSync(join(workspace, "fixture.ts"), `export const value = ${JSON.stringify(value)};\n`);
  execFileSync("git", ["add", "fixture.ts"], { cwd: workspace });
  execFileSync(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=amanuensis-test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      value,
    ],
    { cwd: workspace },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
}
const beforeSha = commit("before");
const fixSha = commit("fix");
const afterSha = commit("after");

const project = {
  workspacePath: workspace,
  projectKey: "test/resolution",
  storagePath: storage,
  dbPath: join(storage, "memory.db"),
  storageGitReady: false,
};
const db = openDatabase(project.dbPath);
const ctx = { project, db, sessionId: null };
const tools = new Map(
  [
    ...projectTools,
    ...findingTools,
    ...evidenceTools,
    ...contradictionTools,
    ...claimTools,
    ...resolutionTools,
  ].map((tool) => [tool.name, tool]),
);
function call(name, args = {}) {
  const tool = tools.get(name);
  assert(tool, `missing tool ${name}`);
  return tool.handler(args, ctx);
}

try {
  const session = call("start_session", { intent: "resolution-proof" });
  ctx.sessionId = session.session_id;
  db.prepare(
    "INSERT INTO subsystems (id, name, status) VALUES ('B-01', 'Fixture', 'concerns')",
  ).run();

  call("add_finding", {
    finding_id: "B01-1",
    subsystem_id: "B-01",
    symptom: "old behavior remains visible",
    root_cause: "missing repair",
    severity: "HIGH",
    status: "confirmed-bug",
    ref_sha: beforeSha,
    pass_type: "survey",
  });

  test("fix-location-only cannot create a fixed or verified state", () => {
    assertThrows(
      () =>
        call("update_finding_status", {
          finding_id: "B01-1",
          status: "fixed",
          fix_location: "fixture.ts:value",
        }),
      "fix_sha",
    );
    const row = call("get_findings", {})[0];
    assert(row.status === "confirmed-bug" && row.resolution_state === "open", JSON.stringify(row));
  });

  test("a repository-bound fix becomes pending, never verified", () => {
    const result = call("update_finding_status", {
      finding_id: "B01-1",
      status: "fixed",
      fix_location: "fixture.ts:value",
      fix_sha: fixSha,
      resolution_note: "repair committed",
    });
    assert(result.resolution_state === "fixed-pending-verification", JSON.stringify(result));
    assert(call("get_finding_summary", {})[0].verified_fixed === 0, "pending counted as verified");
  });

  const preEvidence = call("add_evidence", {
    file_path: "fixture.ts",
    symbol: "value",
    ref_sha: beforeSha,
    kind: "test-observed",
    note: "observation before repair",
  });
  call("attach_evidence_to_finding", {
    finding_id: "B01-1",
    evidence_id: preEvidence.id,
    role: "fix-verification",
  });
  test("pre-fix evidence cannot verify repaired behavior", () => {
    assertThrows(
      () =>
        call("verify_finding_fix", {
          finding_id: "B01-1",
          evidence_id: preEvidence.id,
          verification_note: "should fail",
        }),
      "predates or is outside",
    );
  });

  const postEvidence = call("add_evidence", {
    file_path: "fixture.ts",
    symbol: "value",
    ref_sha: afterSha,
    kind: "test-observed",
    note: "post-repair regression passes",
  });
  call("attach_evidence_to_finding", {
    finding_id: "B01-1",
    evidence_id: postEvidence.id,
    role: "fix-verification",
  });
  test("post-fix evidence creates verified-fixed and remains auditable after reopen", () => {
    const verified = call("verify_finding_fix", {
      finding_id: "B01-1",
      evidence_id: postEvidence.id,
      verification_note: "regression reproducer is now green",
    });
    assert(verified.resolution_state === "verified-fixed", JSON.stringify(verified));
    call("update_finding_status", {
      finding_id: "B01-1",
      status: "confirmed-bug",
      resolution_note: "later regression reopened the issue",
    });
    const history = call("get_finding_resolution_history", { finding_id: "B01-1" });
    assert(
      history.map((row) => row.resolution_state).join(",") ===
        "open,fixed-pending-verification,verified-fixed,open",
      JSON.stringify(history),
    );
    assert(
      history.find((row) => row.resolution_state === "verified-fixed").evidence_id ===
        postEvidence.id,
    );
  });

  call("add_finding", {
    finding_id: "B01-2",
    subsystem_id: "B-01",
    symptom: "same behavior is acceptable",
    root_cause: "different scope",
    severity: "LOW",
    status: "confirmed-acceptable",
    ref_sha: afterSha,
    pass_type: "survey",
  });
  const contradiction = call("add_contradiction", {
    finding_a: "B01-1",
    finding_b: "B01-2",
    conflict_type: "classification-conflict",
    shared_location: "fixture.ts:value",
  });
  const unrelatedEvidence = call("add_evidence", {
    file_path: "unrelated.ts",
    ref_sha: afterSha,
    kind: "code-verified",
    note: "current but unrelated evidence",
  });
  test("contradiction resolution requires current-session evidence", () => {
    const bare = call("resolve_contradiction", {
      id: Number(contradiction.id),
      resolution: "scope-distinction",
      scope_note: "different callers",
      rationale: "scope separates the observations",
    });
    assert(bare.ok === false && bare.error.includes("evidence_id"), JSON.stringify(bare));
    const unrelated = call("resolve_contradiction", {
      id: Number(contradiction.id),
      resolution: "scope-distinction",
      scope_note: "different callers",
      evidence_id: unrelatedEvidence.id,
      rationale: "unrelated evidence must not qualify",
    });
    assert(
      unrelated.ok === false && unrelated.error.includes("attached to one of its findings"),
      JSON.stringify(unrelated),
    );
    const resolved = call("resolve_contradiction", {
      id: Number(contradiction.id),
      resolution: "scope-distinction",
      scope_note: "different callers",
      evidence_id: postEvidence.id,
      rationale: "call-site evidence distinguishes the scopes",
    });
    assert(resolved.ok, JSON.stringify(resolved));
  });

  const claimBefore = call("add_evidence", {
    file_path: "fixture.ts",
    symbol: "value",
    ref_sha: beforeSha,
    kind: "code-verified",
  });
  const claimAfter = call("add_evidence", {
    file_path: "fixture.ts",
    symbol: "value",
    ref_sha: fixSha,
    kind: "code-verified",
  });
  call("add_claim", {
    claim_id: "claim-before",
    claim_key: "fixture.value",
    subject_type: "subsystem",
    subject_id: "B-01",
    statement: "fixture has its original value",
    epistemic_kind: "observation",
    ref_sha: beforeSha,
    evidence_ids: [claimBefore.id],
  });
  call("supersede_claim", {
    predecessor_claim_id: "claim-before",
    successor_claim_id: "claim-after",
    statement: "fixture has its repaired value",
    epistemic_kind: "observation",
    at_sha: fixSha,
    rationale: "repair changed the value",
    evidence_ids: [claimAfter.id],
  });

  test("cross-domain resolution audit accepts evidenced histories", () => {
    const audit = call("audit_resolution_invariants");
    assert(audit.ok, JSON.stringify(audit));
    const history = call("get_claim_history", { claim_key: "fixture.value" });
    assert(history.claims.length === 2, JSON.stringify(history));
    assert(
      history.claims.find((claim) => claim.claim_id === "claim-before").valid_until_sha === fixSha,
      JSON.stringify(history),
    );
  });

  test("database constraints reject invented verified-fixed state", () => {
    assertThrows(
      () =>
        db
          .prepare(
            `INSERT INTO finding_resolution_events
           (finding_id, resolution_state, fix_location, fix_sha, rationale, session_id)
         VALUES ('B01-1', 'verified-fixed', 'fixture.ts:value', ?, 'forged', ?)`,
          )
          .run(afterSha, ctx.sessionId),
      "verified-fixed evidence must be attached",
    );
  });
} finally {
  db.close();
  rmSync(root, { recursive: true, force: true });
}

// Historical sweep: a database that acquired a legacy fixed row before the
// new schema pass must import it as pending, never as verified.
const legacyRoot = mkdtempSync(join(tmpdir(), "amanuensis-resolution-legacy-"));
try {
  const legacyPath = join(legacyRoot, "memory.db");
  let legacyDb = openDatabase(legacyPath);
  legacyDb
    .prepare(
      `INSERT INTO findings
       (finding_id, subsystem_id, symptom, root_cause, severity, status, ref_sha)
     VALUES ('LEG-1', 'B-LEG', 'legacy', 'legacy', 'LOW', 'fixed', 'old-sha')`,
    )
    .run();
  legacyDb.close();
  legacyDb = openDatabase(legacyPath);
  test("legacy fixed labels sweep to pending without invented proof", () => {
    const row = legacyDb
      .prepare(
        "SELECT resolution_state, evidence_id FROM finding_resolution_current WHERE finding_id='LEG-1'",
      )
      .get();
    assert(row.resolution_state === "fixed-pending-verification", JSON.stringify(row));
    assert(row.evidence_id === null, JSON.stringify(row));
  });
  legacyDb.close();
} finally {
  rmSync(legacyRoot, { recursive: true, force: true });
}

console.log(`\n${passed} resolution-proof checks passed`);
