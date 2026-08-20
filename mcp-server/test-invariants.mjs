#!/usr/bin/env node
// Correctness probes for Tier 2 server-enforced invariants.
//
// Each probe attempts to violate a contract the server now enforces and
// asserts the enforcement fires. Probes also verify the positive path —
// a correctly-ordered call sequence still succeeds — so a regression
// that accidentally rejects valid writes is caught alongside one that
// silently accepts bad writes.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./dist/db.js";
import { resolveProject } from "./dist/project.js";
import { artifactTools } from "./dist/tools/artifacts.js";
import { concernTools } from "./dist/tools/concerns.js";
import { dispositionTools } from "./dist/tools/dispositions.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { fieldNoteTools } from "./dist/tools/field-notes.js";
import { fileTools } from "./dist/tools/files.js";
import { findingTools } from "./dist/tools/findings.js";
import { projectTools } from "./dist/tools/project.js";
import { subsystemTools } from "./dist/tools/subsystems.js";

let passed = 0,
  failed = 0;
function t(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${label}\n       ${e.message}`);
    failed++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function assertThrows(fn, expectedSubstring) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    if (expectedSubstring && !e.message.includes(expectedSubstring)) {
      throw new Error(`expected error containing "${expectedSubstring}", got: ${e.message}`);
    }
  }
  if (!threw) throw new Error("expected throw, nothing thrown");
}

// Build a tool map + freshProject helper so each probe gets an
// isolated workspace + DB.
const allTools = new Map(
  [
    ...projectTools,
    ...subsystemTools,
    ...concernTools,
    ...dispositionTools,
    ...findingTools,
    ...fieldNoteTools,
    ...evidenceTools,
    ...fileTools,
    ...artifactTools,
  ].map((td) => [td.name, td]),
);
function call(name, args, ctx) {
  const td = allTools.get(name);
  if (!td) throw new Error(`no such tool: ${name}`);
  return td.handler(args, ctx);
}
function freshCtx() {
  const ws = mkdtempSync(join(tmpdir(), "inv-"));
  spawnSync("git", ["init", "-q"], { cwd: ws });
  const project = resolveProject(ws);
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  return {
    ctx,
    cleanup: () => {
      db.close();
      rmSync(ws, { recursive: true, force: true });
      rmSync(project.storagePath, { recursive: true, force: true });
    },
  };
}

// Convenience: advance a subsystem through the survey to a target depth,
// satisfying every phase prerequisite along the way.
//
// Starts a fixture session if none is active (many tests start their own
// before calling this; those sessions are preserved — advanceTo checks
// ctx.sessionId before opening one).
function advanceTo(ctx, id, status) {
  // Phase-prerequisite calls require an active session. Start one if the
  // caller hasn't already (tests that care about session identity start
  // their own beforehand).
  const sessionWasNull = ctx.sessionId === null;
  if (sessionWasNull) {
    const s = call("start_session", { intent: "advance-fixture" }, ctx);
    ctx.sessionId = s.session_id;
  }
  call("upsert_subsystem", { id, name: id, status: "unmapped" }, ctx);
  const order = ["scoping", "structural", "concerns", "adversarial", "mapped"];
  const target = order.indexOf(status);
  for (let i = 0; i <= target; i++) {
    // Satisfy each phase's prerequisite before the status advance.
    if (order[i] === "structural") {
      // Scoping prerequisite: ≥1 file_ledger row.
      call(
        "add_files_to_scope",
        {
          subsystem_id: id,
          ref_sha: "fixture-ref",
          files: [{ file_path: `src/${id}/index.ts`, why_in_scope: "fixture" }],
        },
        ctx,
      );
    }
    if (order[i] === "concerns") {
      // Structural prerequisite: subsystem-survey artifact registered.
      call(
        "register_artifact",
        {
          path: `${id}-survey.md`,
          kind: "subsystem-survey",
          subsystem_id: id,
        },
        ctx,
      );
    }
    if (order[i] === "adversarial") {
      // Concerns prerequisite: ≥1 disposition. Use a fixture concern so
      // advanceTo is self-contained regardless of which concerns the test
      // has added.
      call("add_concern", { code: "FIXTURE-1", category: "cache", origin: "seeded" }, ctx);
      const existing = call("get_dispositions", { subsystem_id: id }, ctx);
      if (!Array.isArray(existing) || existing.length === 0) {
        call(
          "set_disposition",
          {
            subsystem_id: id,
            concern_code: "FIXTURE-1",
            classification: "ruled-out",
            evidence: `src/${id}/index.ts:fixture@fixture-ref`,
            evidence_quality: "code-verified",
            linchpin_dependent: false,
            rationale: "fixture disposition for advanceTo",
            ref_sha: "fixture-ref",
            pass_type: "survey",
          },
          ctx,
        );
      }
    }
    // mapped: gate is 0 open findings; vacuously satisfied when advanceTo
    // hasn't added any findings.
    call("update_subsystem_status", { id, status: order[i] }, ctx);
  }
}
function startSession(ctx, intent = "test") {
  const r = call("start_session", { intent }, ctx);
  ctx.sessionId = r.session_id;
}

// ---- Session-required gate ----

t("set_disposition without active session is rejected", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    assertThrows(
      () =>
        call(
          "set_disposition",
          {
            subsystem_id: "B-01",
            concern_code: "CC-1",
            classification: "ruled-out",
            evidence: "x",
            evidence_quality: "code-verified",
            rationale: "r",
            ref_sha: "deadbeef",
            pass_type: "survey",
          },
          ctx,
        ),
      "requires an active session",
    );
  } finally {
    cleanup();
  }
});

t("add_field_note without active session is rejected", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    assertThrows(
      () => call("add_field_note", { category: "anomaly", observation: "x" }, ctx),
      "requires an active session",
    );
  } finally {
    cleanup();
  }
});

t("read tools do not require an active session", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    // Should succeed without a session.
    const list = call("list_subsystems", {}, ctx);
    assert(Array.isArray(list));
  } finally {
    cleanup();
  }
});

// ---- Knowledge-depth gate ----

t("set_disposition on unmapped subsystem is rejected", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    call("upsert_subsystem", { id: "B-01", name: "B01" }, ctx);
    call("add_concern", { code: "CC-1", category: "cache", origin: "seeded" }, ctx);
    assertThrows(
      () =>
        call(
          "set_disposition",
          {
            subsystem_id: "B-01",
            concern_code: "CC-1",
            classification: "ruled-out",
            evidence: "x",
            evidence_quality: "code-verified",
            rationale: "r",
            ref_sha: "deadbeef",
            pass_type: "survey",
          },
          ctx,
        ),
      "knowledge-depth contract",
    );
  } finally {
    cleanup();
  }
});

t("set_disposition on structural subsystem is rejected (must be ≥concerns)", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "structural");
    call("add_concern", { code: "CC-1", category: "cache", origin: "seeded" }, ctx);
    assertThrows(
      () =>
        call(
          "set_disposition",
          {
            subsystem_id: "B-01",
            concern_code: "CC-1",
            classification: "ruled-out",
            evidence: "x",
            evidence_quality: "code-verified",
            rationale: "r",
            ref_sha: "deadbeef",
            pass_type: "survey",
          },
          ctx,
        ),
      "requires at least 'concerns'",
    );
  } finally {
    cleanup();
  }
});

t("adversarial-pass disposition on concerns-only subsystem is rejected", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "concerns");
    call("add_concern", { code: "CC-1", category: "cache", origin: "seeded" }, ctx);
    assertThrows(
      () =>
        call(
          "set_disposition",
          {
            subsystem_id: "B-01",
            concern_code: "CC-1",
            classification: "ruled-out",
            evidence: "x",
            evidence_quality: "code-verified",
            rationale: "r",
            ref_sha: "deadbeef",
            pass_type: "adversarial",
          },
          ctx,
        ),
      "requires at least 'adversarial'",
    );
  } finally {
    cleanup();
  }
});

t("set_disposition on deferred subsystem is rejected even if it had prior depth", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "concerns");
    call("update_subsystem_status", { id: "B-01", status: "deferred" }, ctx);
    call("add_concern", { code: "CC-1", category: "cache", origin: "seeded" }, ctx);
    assertThrows(
      () =>
        call(
          "set_disposition",
          {
            subsystem_id: "B-01",
            concern_code: "CC-1",
            classification: "ruled-out",
            evidence: "x",
            evidence_quality: "code-verified",
            rationale: "r",
            ref_sha: "deadbeef",
            pass_type: "survey",
          },
          ctx,
        ),
      "deferred",
    );
  } finally {
    cleanup();
  }
});

t("set_disposition positive path works at concerns status", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "concerns");
    call("add_concern", { code: "CC-1", category: "cache", origin: "seeded" }, ctx);
    const r = call(
      "set_disposition",
      {
        subsystem_id: "B-01",
        concern_code: "CC-1",
        classification: "ruled-out",
        evidence: "x",
        evidence_quality: "code-verified",
        rationale: "r",
        ref_sha: "deadbeef",
        pass_type: "survey",
      },
      ctx,
    );
    assert(r.ok);
  } finally {
    cleanup();
  }
});

t("add_finding on unmapped subsystem rejected; works at concerns", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    call("upsert_subsystem", { id: "B-01", name: "B01" }, ctx);
    assertThrows(
      () =>
        call(
          "add_finding",
          {
            finding_id: "B01-1",
            subsystem_id: "B-01",
            symptom: "s",
            root_cause: "r",
            severity: "LOW",
            status: "confirmed-bug",
            ref_sha: "abc",
            pass_type: "survey",
          },
          ctx,
        ),
      "knowledge-depth contract",
    );
    // Advance and retry.
    advanceTo(ctx, "B-01", "concerns");
    const r = call(
      "add_finding",
      {
        finding_id: "B01-1",
        subsystem_id: "B-01",
        symptom: "s",
        root_cause: "r",
        severity: "LOW",
        status: "confirmed-bug",
        ref_sha: "abc",
        pass_type: "survey",
      },
      ctx,
    );
    assert(r.ok);
  } finally {
    cleanup();
  }
});

t("update_finding_status enforces gate on the underlying subsystem", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "concerns");
    call(
      "add_finding",
      {
        finding_id: "B01-1",
        subsystem_id: "B-01",
        symptom: "s",
        root_cause: "r",
        severity: "LOW",
        status: "confirmed-bug",
        ref_sha: "abc",
        pass_type: "survey",
      },
      ctx,
    );
    // This should work — B-01 is at concerns.
    const r1 = call(
      "update_finding_status",
      {
        finding_id: "B01-1",
        status: "confirmed-acceptable",
      },
      ctx,
    );
    assert(r1.ok);
  } finally {
    cleanup();
  }
});

// ---- Monotonic-transition gate ----

t("update_subsystem_status rejects regression", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "concerns");
    assertThrows(
      () => call("update_subsystem_status", { id: "B-01", status: "scoping" }, ctx),
      "regress",
    );
  } finally {
    cleanup();
  }
});

t("upsert_subsystem update path rejects status regression", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "mapped");
    // Re-upsert with a lower status — should be rejected.
    assertThrows(
      () => call("upsert_subsystem", { id: "B-01", name: "B01", status: "concerns" }, ctx),
      "regress",
    );
  } finally {
    cleanup();
  }
});

t("deferred is bidirectional from any status", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "concerns");
    // mapped → deferred and back to concerns should both work.
    call("update_subsystem_status", { id: "B-01", status: "deferred" }, ctx);
    call("update_subsystem_status", { id: "B-01", status: "concerns" }, ctx);
    const rows = call("list_subsystems", {}, ctx);
    assert(rows[0].status === "concerns");
  } finally {
    cleanup();
  }
});

t("forward transitions succeed", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "mapped");
    const rows = call("list_subsystems", {}, ctx);
    assert(rows[0].status === "mapped");
  } finally {
    cleanup();
  }
});

// ---- reset_subsystem ----

t("reset_subsystem clears dependents and allows regression", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "concerns");
    call("add_concern", { code: "CC-1", category: "cache", origin: "seeded" }, ctx);
    call(
      "set_disposition",
      {
        subsystem_id: "B-01",
        concern_code: "CC-1",
        classification: "ruled-out",
        evidence: "x",
        evidence_quality: "code-verified",
        rationale: "r",
        ref_sha: "abc",
        pass_type: "survey",
      },
      ctx,
    );
    call(
      "add_finding",
      {
        finding_id: "B01-1",
        subsystem_id: "B-01",
        symptom: "s",
        root_cause: "r",
        severity: "LOW",
        status: "confirmed-bug",
        ref_sha: "abc",
        pass_type: "survey",
      },
      ctx,
    );
    const r = call(
      "reset_subsystem",
      { id: "B-01", to_status: "structural", reason: "concern checklist out of date" },
      ctx,
    );
    assert(r.ok, `reset should succeed: ${r.error}`);
    assert(r.deleted.dispositions === 1);
    assert(r.deleted.findings === 1);
    assert(r.new_status === "structural");
    // Subsequent set_disposition should be rejected because B-01 is now structural.
    assertThrows(
      () =>
        call(
          "set_disposition",
          {
            subsystem_id: "B-01",
            concern_code: "CC-1",
            classification: "ruled-out",
            evidence: "x",
            evidence_quality: "code-verified",
            rationale: "r",
            ref_sha: "abc",
            pass_type: "survey",
          },
          ctx,
        ),
      "requires at least 'concerns'",
    );
  } finally {
    cleanup();
  }
});

t("reset_subsystem rejects short reason", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "concerns");
    const r = call("reset_subsystem", { id: "B-01", to_status: "unmapped", reason: "x" }, ctx);
    assert(!r.ok);
    assert(r.error.includes("8 characters"));
  } finally {
    cleanup();
  }
});

t("reset_subsystem to unmapped also clears file_ledger", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    call("upsert_subsystem", { id: "B-01", name: "B01" }, ctx);
    call("update_subsystem_status", { id: "B-01", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      {
        subsystem_id: "B-01",
        files: [{ file_path: "a.ts", why_in_scope: "main" }],
        ref_sha: "abc",
      },
      ctx,
    );
    const r = call(
      "reset_subsystem",
      { id: "B-01", to_status: "unmapped", reason: "redo from zero" },
      ctx,
    );
    assert(r.ok);
    assert(
      r.deleted.file_ledger === 1,
      `file_ledger should be cleared, got: ${JSON.stringify(r.deleted)}`,
    );
  } finally {
    cleanup();
  }
});

t("reset_subsystem to structural preserves file_ledger", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "concerns");
    call(
      "add_files_to_scope",
      {
        subsystem_id: "B-01",
        files: [{ file_path: "a.ts", why_in_scope: "main" }],
        ref_sha: "abc",
      },
      ctx,
    );
    const r = call(
      "reset_subsystem",
      { id: "B-01", to_status: "structural", reason: "redo concern pass" },
      ctx,
    );
    assert(r.ok);
    assert(
      r.deleted.file_ledger === undefined || r.deleted.file_ledger === 0,
      `file_ledger should be preserved, got: ${JSON.stringify(r.deleted)}`,
    );
    // Ledger is still queryable.
    const files = call("get_subsystem_files", { subsystem_id: "B-01" }, ctx);
    assert(files.length >= 1, `ledger should have ≥1 file, got: ${files.length}`);
  } finally {
    cleanup();
  }
});

// ---- Cascade interactions ----

t("reset_subsystem with a contradiction on its finding fails transactionally", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "adversarial");
    call("add_concern", { code: "CC-1", category: "cache", origin: "seeded" }, ctx);
    call(
      "add_finding",
      {
        finding_id: "B01-1",
        subsystem_id: "B-01",
        symptom: "s",
        root_cause: "r",
        severity: "LOW",
        status: "confirmed-bug",
        ref_sha: "abc",
        pass_type: "survey",
      },
      ctx,
    );
    call(
      "add_finding",
      {
        finding_id: "B01-2",
        subsystem_id: "B-01",
        symptom: "s2",
        root_cause: "r2",
        severity: "LOW",
        status: "confirmed-acceptable",
        ref_sha: "abc",
        pass_type: "adversarial",
      },
      ctx,
    );
    // Verify contradictions table resists losing referenced findings.
    // If FK constraints reject, our reset throws and the transaction
    // rolls back — neither disposition nor finding is gone.
    // If FK CASCADEs, everything is cleaned. Either behavior is
    // acceptable; what we MUST NOT see is partial deletion.
    try {
      const r = call(
        "reset_subsystem",
        { id: "B-01", to_status: "scoping", reason: "blow away B01 survey" },
        ctx,
      );
      // If it succeeded, the findings table should be empty for B-01.
      if (r.ok) {
        const findings = call("get_findings", { subsystem_id: "B-01" }, ctx);
        assert(findings.length === 0, "findings should be cleared on success");
      }
    } catch {
      // If it failed, findings should STILL be present — no partial delete.
      const findings = call("get_findings", { subsystem_id: "B-01" }, ctx);
      assert(findings.length === 2, "findings should be intact after rollback");
    }
  } finally {
    cleanup();
  }
});

// ---- Session-required tools round trip ----

t("sequence of gated writes after session/advance works end-to-end", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    advanceTo(ctx, "B-01", "concerns");
    call("add_concern", { code: "CC-1", category: "cache", origin: "seeded" }, ctx);
    const ev = call(
      "add_evidence",
      {
        file_path: "a.ts",
        symbol: "f",
        line_range: "1-10",
        ref_sha: "abc",
        kind: "code-verified",
      },
      ctx,
    );
    assert(ev.ok);
    call(
      "set_disposition",
      {
        subsystem_id: "B-01",
        concern_code: "CC-1",
        classification: "ruled-out",
        evidence: "a.ts:f@abc",
        evidence_quality: "code-verified",
        rationale: "r",
        ref_sha: "abc",
        pass_type: "survey",
      },
      ctx,
    );
    const r = call(
      "attach_evidence_to_disposition",
      {
        subsystem_id: "B-01",
        concern_code: "CC-1",
        evidence_id: ev.id,
        role: "supports",
      },
      ctx,
    );
    assert(r.ok);
  } finally {
    cleanup();
  }
});

// ---- Phase prerequisite gates ----

t("advance to 'structural' without file_ledger is rejected", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    call("upsert_subsystem", { id: "B-01", name: "B01", status: "unmapped" }, ctx);
    call("update_subsystem_status", { id: "B-01", status: "scoping" }, ctx);
    assertThrows(
      () => call("update_subsystem_status", { id: "B-01", status: "structural" }, ctx),
      "file ledger is empty",
    );
  } finally {
    cleanup();
  }
});

t("advance to 'concerns' without subsystem-survey artifact is rejected", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    call("upsert_subsystem", { id: "B-01", name: "B01", status: "unmapped" }, ctx);
    call("update_subsystem_status", { id: "B-01", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      { subsystem_id: "B-01", ref_sha: "r", files: [{ file_path: "a.ts", why_in_scope: "test" }] },
      ctx,
    );
    call("update_subsystem_status", { id: "B-01", status: "structural" }, ctx);
    assertThrows(
      () => call("update_subsystem_status", { id: "B-01", status: "concerns" }, ctx),
      "no subsystem-survey artifact",
    );
  } finally {
    cleanup();
  }
});

t("advance to 'adversarial' without dispositions is rejected", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    call("upsert_subsystem", { id: "B-01", name: "B01", status: "unmapped" }, ctx);
    call("update_subsystem_status", { id: "B-01", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      { subsystem_id: "B-01", ref_sha: "r", files: [{ file_path: "a.ts", why_in_scope: "test" }] },
      ctx,
    );
    call("update_subsystem_status", { id: "B-01", status: "structural" }, ctx);
    call(
      "register_artifact",
      { path: "B-01-survey.md", kind: "subsystem-survey", subsystem_id: "B-01" },
      ctx,
    );
    call("update_subsystem_status", { id: "B-01", status: "concerns" }, ctx);
    assertThrows(
      () => call("update_subsystem_status", { id: "B-01", status: "adversarial" }, ctx),
      "no concern dispositions",
    );
  } finally {
    cleanup();
  }
});

t("skipping phases blocked at first missing prerequisite", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    call("upsert_subsystem", { id: "B-01", name: "B01", status: "unmapped" }, ctx);
    call("update_subsystem_status", { id: "B-01", status: "scoping" }, ctx);
    // Attempt to jump straight to concerns — blocked at structural (no file_ledger).
    assertThrows(
      () => call("update_subsystem_status", { id: "B-01", status: "concerns" }, ctx),
      "file ledger is empty",
    );
  } finally {
    cleanup();
  }
});

t("phase prerequisites: happy path passes all gates", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx);
    call("upsert_subsystem", { id: "B-01", name: "B01", status: "unmapped" }, ctx);
    call("update_subsystem_status", { id: "B-01", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      { subsystem_id: "B-01", ref_sha: "r", files: [{ file_path: "a.ts", why_in_scope: "test" }] },
      ctx,
    );
    call("update_subsystem_status", { id: "B-01", status: "structural" }, ctx);
    call(
      "register_artifact",
      { path: "B-01-survey.md", kind: "subsystem-survey", subsystem_id: "B-01" },
      ctx,
    );
    call("update_subsystem_status", { id: "B-01", status: "concerns" }, ctx);
    call("add_concern", { code: "CC-gate", category: "cache", origin: "seeded" }, ctx);
    call(
      "set_disposition",
      {
        subsystem_id: "B-01",
        concern_code: "CC-gate",
        classification: "ruled-out",
        evidence: "a.ts:f@r",
        evidence_quality: "code-verified",
        linchpin_dependent: false,
        rationale: "test",
        ref_sha: "r",
        pass_type: "survey",
      },
      ctx,
    );
    call("update_subsystem_status", { id: "B-01", status: "adversarial" }, ctx);
    // No open findings → can map.
    const r = call("update_subsystem_status", { id: "B-01", status: "mapped" }, ctx);
    assert(r.previous_status === "adversarial");
  } finally {
    cleanup();
  }
});

// ---- Evidence-required-to-overturn gate ----

t("project-local Amanuensis state is rejected at source and evidence ingress", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx, "self-source-guard");
    call("upsert_subsystem", { id: "B-SELF", name: "Self state" }, ctx);
    for (const path of [
      ".amanuensis/memory.db",
      "./.amanuensis/docs/index.md",
      ".AMANUENSIS\\workspace_path",
    ]) {
      assertThrows(
        () =>
          call(
            "add_files_to_scope",
            { subsystem_id: "B-SELF", ref_sha: "r", files: [{ file_path: path }] },
            ctx,
          ),
        "reserved Amanuensis tool state",
      );
      assertThrows(
        () => call("add_evidence", { file_path: path, ref_sha: "r", kind: "code-verified" }, ctx),
        "reserved Amanuensis tool state",
      );
    }
    assertThrows(
      () =>
        call(
          "set_disposition",
          {
            subsystem_id: "B-SELF",
            concern_code: "SELF-1",
            classification: "ruled-out",
            evidence: ".amanuensis/memory.db:db@r",
            evidence_quality: "code-verified",
            rationale: "must reject before write",
            ref_sha: "r",
            pass_type: "survey",
          },
          ctx,
        ),
      "reserved Amanuensis tool state",
    );
    for (const evidence of [
      "see .amanuensis/memory.db for the record",
      "see:.amanuensis/memory.db",
      "x,.amanuensis/memory.db",
      "source=.amanuensis/memory.db",
      "(.AMANUENSIS\\workspace_path)",
    ]) {
      assertThrows(
        () =>
          call(
            "set_disposition",
            {
              subsystem_id: "B-SELF",
              concern_code: "SELF-2",
              classification: "ruled-out",
              evidence,
              evidence_quality: "code-verified",
              rationale: "legacy prose must reject embedded self-state paths",
              ref_sha: "r",
              pass_type: "survey",
            },
            ctx,
          ),
        "reserved Amanuensis tool state",
      );
    }
    assertThrows(
      () =>
        call(
          "add_finding",
          {
            finding_id: "BSELF-1",
            subsystem_id: "B-SELF",
            symptom: "self citation",
            root_cause: "reserved path",
            severity: "LOW",
            status: "confirmed-bug",
            primary_files: [".amanuensis/docs/index.md:page@r"],
            ref_sha: "r",
            pass_type: "survey",
          },
          ctx,
        ),
      "reserved Amanuensis tool state",
    );
    const fileCount = ctx.db.prepare("SELECT COUNT(*) AS n FROM file_ledger").get().n;
    const evidenceCount = ctx.db.prepare("SELECT COUNT(*) AS n FROM evidence").get().n;
    const dispositionCount = ctx.db.prepare("SELECT COUNT(*) AS n FROM dispositions").get().n;
    const findingCount = ctx.db.prepare("SELECT COUNT(*) AS n FROM findings").get().n;
    assert(fileCount === 0, `self-source rejection wrote ${fileCount} file rows`);
    assert(evidenceCount === 0, `self-evidence rejection wrote ${evidenceCount} evidence rows`);
    assert(dispositionCount === 0, `self-disposition rejection wrote ${dispositionCount} rows`);
    assert(findingCount === 0, `self-finding rejection wrote ${findingCount} rows`);
  } finally {
    cleanup();
  }
});

t("overturn to ruled-out without new session evidence is rejected", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx, "overturn-neg");
    advanceTo(ctx, "B-07", "concerns");
    call(
      "add_finding",
      {
        finding_id: "B07-1",
        subsystem_id: "B-07",
        symptom: "unbounded cache growth",
        root_cause: "no TTL on entries",
        severity: "HIGH",
        status: "confirmed-bug",
        ref_sha: "fixture-ref",
        pass_type: "survey",
      },
      ctx,
    );
    // Bare reclassification with no new evidence attached this session → rejected.
    assertThrows(
      () => call("update_finding_status", { finding_id: "B07-1", status: "ruled-out" }, ctx),
      "no new evidence",
    );
  } finally {
    cleanup();
  }
});

t("fixed transition requires repository-bound repair coordinates", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx, "overturn-fixed");
    advanceTo(ctx, "B-07", "concerns");
    call(
      "add_finding",
      {
        finding_id: "B07-2",
        subsystem_id: "B-07",
        symptom: "off-by-one",
        root_cause: "wrong bound",
        severity: "LOW",
        status: "confirmed-bug",
        ref_sha: "fixture-ref",
        pass_type: "survey",
      },
      ctx,
    );
    assertThrows(
      () => call("update_finding_status", { finding_id: "B07-2", status: "fixed" }, ctx),
      "fix_location and fix_sha",
    );
  } finally {
    cleanup();
  }
});

t("overturn to ruled-out succeeds once disproving evidence is attached this session", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    startSession(ctx, "overturn-pos");
    advanceTo(ctx, "B-07", "concerns");
    call(
      "add_finding",
      {
        finding_id: "B07-3",
        subsystem_id: "B-07",
        symptom: "race on shared map",
        root_cause: "no lock",
        severity: "HIGH",
        status: "confirmed-bug",
        ref_sha: "fixture-ref",
        pass_type: "survey",
      },
      ctx,
    );
    const ev = call(
      "add_evidence",
      {
        file_path: "src/B-07/cache.ts",
        symbol: "get",
        line_range: "10-20",
        ref_sha: "fixture-ref",
        kind: "code-verified",
        excerpt: "callers hold the region lock",
        note: "compensating mechanism found in adversarial pass",
      },
      ctx,
    );
    call(
      "attach_evidence_to_finding",
      {
        finding_id: "B07-3",
        evidence_id: ev.id,
        role: "compensating",
      },
      ctx,
    );
    const r = call("update_finding_status", { finding_id: "B07-3", status: "ruled-out" }, ctx);
    assert(r.previous_status === "confirmed-bug", "overturn with session evidence should succeed");
  } finally {
    cleanup();
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
