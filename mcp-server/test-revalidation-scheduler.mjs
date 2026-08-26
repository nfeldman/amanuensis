#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./dist/db.js";
import { ensureProjectStorage, resolveProject } from "./dist/project.js";
import { claimTools } from "./dist/tools/claims.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { impactTools } from "./dist/tools/impact.js";
import { projectTools } from "./dist/tools/project.js";
import { revalidationTools } from "./dist/tools/revalidation.js";

const tools = new Map(
  [
    ...projectTools,
    ...evidenceTools,
    ...claimTools,
    ...impactTools,
    ...revalidationTools,
  ].map((tool) => [tool.name, tool]),
);
const ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "fixtures/revalidation/manifest.json"), "utf8"),
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function call(name, args, ctx) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`unknown test tool: ${name}`);
  return tool.handler(args, ctx);
}

function freshContext(claimCount = 1) {
  const root = mkdtempSync(join(tmpdir(), "revalidation-"));
  const workspace = join(root, "workspace");
  const storage = join(root, "storage");
  mkdirSync(join(workspace, "src"), { recursive: true });
  git(workspace, "init", "-q");
  git(workspace, "config", "user.email", "test@example.com");
  git(workspace, "config", "user.name", "Revalidation Test");
  writeFileSync(join(workspace, "src/a.ts"), "export const value = 'before';\n");
  git(workspace, "add", "src/a.ts");
  git(workspace, "commit", "-q", "-m", "base");
  const base = git(workspace, "rev-parse", "HEAD");
  writeFileSync(join(workspace, "src/a.ts"), "export const value = 'after';\n");
  git(workspace, "add", "src/a.ts");
  git(workspace, "commit", "-q", "-m", "change");
  const head = git(workspace, "rev-parse", "HEAD");

  process.env.AMANUENSIS_STORAGE_ROOT = storage;
  const project = resolveProject(workspace);
  ensureProjectStorage(project, (databasePath) => {
    const database = openDatabase(databasePath);
    database.close();
  });
  const ctx = { project, db: openDatabase(project.dbPath), sessionId: null };
  const session = call("start_session", { intent: "revalidation-test" }, ctx);
  ctx.sessionId = session.session_id;
  const evidence = call(
    "add_evidence",
    { file_path: "src/a.ts", ref_sha: base, kind: "code-verified" },
    ctx,
  );
  for (let index = 1; index <= claimCount; index++) {
    const subsystem = `S-${index}`;
    ctx.db
      .prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, 'mapped')")
      .run(subsystem, `Subsystem ${index}`);
    ctx.db
      .prepare(
        `INSERT INTO file_ledger
           (subsystem_id, file_path, why_in_scope, classification, ref_sha)
         VALUES (?, 'src/a.ts', 'fixture', 'examined', ?)`,
      )
      .run(subsystem, base);
    call(
      "add_claim",
      {
        claim_id: `claim-${index}`,
        claim_key: `fixture.claim-${index}`,
        subject_type: "subsystem",
        subject_id: subsystem,
        statement: `Claim ${index} is invalidated by the fixture change.`,
        epistemic_kind: "observation",
        ref_sha: base,
        evidence_ids: [evidence.id],
      },
      ctx,
    );
  }
  call(
    "predict_change_impact",
    { base_sha: base, head_sha: head, run_id: "impact-fixture" },
    ctx,
  );
  call("apply_change_impact", { run_id: "impact-fixture" }, ctx);

  return {
    ctx,
    project,
    base,
    head,
    root,
    cleanup: () => {
      ctx.db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function plan(ctx, overrides = {}) {
  return call(
    "plan_revalidation_run",
    {
      run_id: "revalidation-run",
      impact_run_id: "impact-fixture",
      allowed_sources: ["src/"],
      provider_allowlist: ["fixture-provider"],
      authority_mode: "observe-only",
      max_concurrency: 8,
      max_attempts_per_obligation: 2,
      max_tokens_per_attempt: 1000,
      max_total_tokens: 10000,
      max_total_cost_microusd: 100000,
      ...overrides,
    },
    ctx,
  );
}

function obligationIds(ctx) {
  return ctx.db
    .prepare(
      "SELECT obligation_id FROM revalidation_obligations ORDER BY destination_id",
    )
    .all()
    .map((row) => row.obligation_id);
}

function dispatch(ctx, obligationId, attemptId, overrides = {}) {
  return call(
    "dispatch_revalidation_attempt",
    {
      run_id: "revalidation-run",
      obligation_id: obligationId,
      attempt_id: attemptId,
      replicate_id: "replicate-1",
      attempt_number: 1,
      worker_id: `worker-${attemptId}`,
      provider: "fixture-provider",
      model: "fixture-model",
      planned_tokens: 100,
      planned_cost_microusd: 1000,
      ...overrides,
    },
    ctx,
  );
}

function land(ctx, attemptId, overrides = {}) {
  return call(
    "land_revalidation_result",
    {
      run_id: "revalidation-run",
      attempt_id: attemptId,
      result: { conclusion: "fixture result" },
      actual_tokens: 80,
      actual_cost_microusd: 800,
      ...overrides,
    },
    ctx,
  );
}

test("impact application creates one owned destination per invalidated claim", () => {
  const { ctx, cleanup } = freshContext(3);
  try {
    const obligations = ctx.db
      .prepare(
        `SELECT destination_id, owner, state, blocking
           FROM revalidation_obligations ORDER BY destination_id`,
      )
      .all();
    assertEqual(
      obligations,
      [1, 2, 3].map((index) => ({
        destination_id: `claim-${index}`,
        owner: "amanuensis:revalidation",
        state: "ready",
        blocking: 1,
      })),
      "automatic obligation custody",
    );
  } finally {
    cleanup();
  }
});

test("historical sweep repairs an applied invalidation missing its later trigger", () => {
  const fixture = freshContext(1);
  try {
    const obligationId = obligationIds(fixture.ctx)[0];
    fixture.ctx.db.prepare("DROP TRIGGER impact_application_creates_obligation").run();
    fixture.ctx.db.prepare("DELETE FROM revalidation_obligations WHERE obligation_id=?").run(obligationId);
    fixture.ctx.db.close();
    fixture.ctx.db = openDatabase(fixture.project.dbPath);
    assertEqual(obligationIds(fixture.ctx), [obligationId], "historical obligation sweep");
  } finally {
    fixture.cleanup();
  }
});

test("planner compiles evidence neighborhoods and blocks out-of-scope sources", () => {
  const { ctx, cleanup } = freshContext(1);
  try {
    const planned = plan(ctx);
    assertEqual(planned.expected_obligations, 1, "planned denominator");
    assertEqual(planned.dispatchable, 1, "dispatchable denominator");
    const packet = JSON.parse(
      ctx.db.prepare("SELECT work_packet FROM revalidation_run_obligations").get().work_packet,
    );
    assertEqual(packet.included_evidence.length, 2, "included original and impact evidence");
    assert(packet.impact_reason_path.length > 0, "impact reason path missing");
    assert(packet.impacted_neighborhood.length > 0, "impact neighborhood missing");
    const runColumns = new Set(
      ctx.db.prepare("PRAGMA table_info(revalidation_runs)").all().map((row) => row.name),
    );
    for (const bound of MANIFEST.hardBounds) {
      assert(runColumns.has(bound), `run snapshot missing hard bound ${bound}`);
    }
  } finally {
    cleanup();
  }

  const blockedFixture = freshContext(1);
  try {
    const planned = plan(blockedFixture.ctx, {
      run_id: "blocked-run",
      allowed_sources: ["docs/"],
    });
    assertEqual(planned.blocked, 1, "source-blocked denominator");
    const obligation = obligationIds(blockedFixture.ctx)[0];
    assertThrows(
      () =>
        call(
          "dispatch_revalidation_attempt",
          {
            run_id: "blocked-run",
            obligation_id: obligation,
            attempt_id: "blocked-attempt",
            replicate_id: "replicate-1",
            attempt_number: 1,
            worker_id: "worker",
            provider: "fixture-provider",
            model: "fixture-model",
            planned_tokens: 10,
            planned_cost_microusd: 0,
          },
          blockedFixture.ctx,
        ),
      "not dispatchable",
    );
  } finally {
    blockedFixture.cleanup();
  }
});

test("dropped, duplicate, timed-out, and unscored results remain separately red", () => {
  const { ctx, cleanup } = freshContext(4);
  try {
    plan(ctx);
    const [drop, duplicate, timeout, unscored] = obligationIds(ctx);
    dispatch(ctx, drop, "attempt-drop");
    dispatch(ctx, duplicate, "attempt-duplicate");
    dispatch(ctx, timeout, "attempt-timeout");
    dispatch(ctx, unscored, "attempt-unscored");
    land(ctx, "attempt-duplicate");
    const duplicateLanding = land(ctx, "attempt-duplicate");
    assertEqual(duplicateLanding.violation, "duplicate-landing", "duplicate protocol record");
    call(
      "fail_revalidation_attempt",
      {
        run_id: "revalidation-run",
        attempt_id: "attempt-timeout",
        status: "timed-out",
        reason: "fixture timeout",
      },
      ctx,
    );
    land(ctx, "attempt-unscored");

    const result = call("reconcile_revalidation_run", { run_id: "revalidation-run" }, ctx);
    assert(!result.complete, "broken fan-in completed");
    assertEqual(result.diagnostics.missing_landings, ["attempt-drop"], "dropped diagnosis");
    assertEqual(result.diagnostics.duplicates, ["attempt-duplicate"], "duplicate diagnosis");
    assertEqual(result.diagnostics.timed_out, ["attempt-timeout"], "timeout diagnosis");
    assertEqual(
      result.diagnostics.unscored,
      ["attempt-duplicate", "attempt-unscored"],
      "unscored diagnosis",
    );
    for (const arm of MANIFEST.faultArms) {
      assert(
        result.diagnostics[arm.expectedDiagnostic].length > 0,
        `${arm.name} arm did not turn ${arm.expectedDiagnostic} red`,
      );
    }
    assertEqual(result.expected_obligations, 4, "expected fan-in denominator");
    assertEqual(result.actual_obligations, 4, "actual fan-in denominator");
  } finally {
    cleanup();
  }
});

test("retry identity is append-only and a recovered timeout can complete", () => {
  const { ctx, head, cleanup } = freshContext(1);
  try {
    plan(ctx);
    const obligation = obligationIds(ctx)[0];
    dispatch(ctx, obligation, "attempt-1");
    call(
      "fail_revalidation_attempt",
      {
        run_id: "revalidation-run",
        attempt_id: "attempt-1",
        status: "timed-out",
        reason: "first attempt timed out",
      },
      ctx,
    );
    assertThrows(
      () => dispatch(ctx, obligation, "attempt-reused-number"),
      "must be 2",
    );
    assertThrows(
      () =>
        dispatch(ctx, obligation, "attempt-1", {
          attempt_number: 2,
        }),
      "attempt identity already exists",
    );
    dispatch(ctx, obligation, "attempt-2", { attempt_number: 2 });
    land(ctx, "attempt-2");
    const resolutionEvidence = call(
      "add_evidence",
      {
        file_path: "src/a.ts",
        ref_sha: head,
        kind: "test-observed",
        note: "revalidation result",
      },
      ctx,
    );
    call(
      "score_revalidation_result",
      {
        run_id: "revalidation-run",
        attempt_id: "attempt-2",
        verdict: "accepted",
        resolution_outcome: "retired",
        rationale: "the historical claim remains retired after direct reinspection",
        resolution_evidence_id: resolutionEvidence.id,
      },
      ctx,
    );
    const reconciled = call(
      "reconcile_revalidation_run",
      { run_id: "revalidation-run" },
      ctx,
    );
    assert(reconciled.complete, "recovered retry did not complete");
    assertEqual(reconciled.exact_fan_in, true, "retry fan-in");
    assertEqual(
      ctx.db.prepare("SELECT COUNT(*) AS n FROM revalidation_attempts").get().n,
      2,
      "attempt history was overwritten",
    );
    assertEqual(
      ctx.db.prepare("SELECT COUNT(*) AS n FROM revalidation_attempt_events").get().n,
      5,
      "attempt transition history",
    );
    const identityColumns = new Set([
      ...ctx.db.prepare("PRAGMA table_info(revalidation_runs)").all().map((row) => row.name),
      ...ctx.db
        .prepare("PRAGMA table_info(revalidation_obligations)")
        .all()
        .map((row) => row.name),
      ...ctx.db.prepare("PRAGMA table_info(revalidation_attempts)").all().map((row) => row.name),
    ]);
    for (const axis of MANIFEST.identityAxes) {
      assert(identityColumns.has(axis), `missing identity axis ${axis}`);
    }
    const dashboard = call("get_revalidation_dashboard", { run_id: "revalidation-run" }, ctx);
    assertEqual(dashboard.summary.retried, 1, "retried dashboard count");
    assertEqual(dashboard.summary.open, 0, "closed dashboard count");
  } finally {
    cleanup();
  }
});

test("provider, concurrency, budget, and authority boundaries halt or stay red", () => {
  const { ctx, cleanup } = freshContext(1);
  try {
    plan(ctx, {
      max_concurrency: 1,
      max_tokens_per_attempt: 100,
      max_total_tokens: 100,
      max_total_cost_microusd: 1000,
    });
    const obligation = obligationIds(ctx)[0];
    assertThrows(
      () => dispatch(ctx, obligation, "denied-provider", { provider: "outside" }),
      "outside the run provider_allowlist",
    );
    assertThrows(
      () => dispatch(ctx, obligation, "over-budget-plan", { planned_tokens: 101 }),
      "exceeds max_tokens_per_attempt",
    );
    dispatch(ctx, obligation, "bounded-attempt", {
      planned_tokens: 90,
      planned_cost_microusd: 900,
    });
    const landed = land(ctx, "bounded-attempt", {
      artifacts_written: ["outside.md"],
      actual_tokens: 95,
      actual_cost_microusd: 950,
    });
    assertEqual(landed.budget_violation, true, "budget overrun telemetry");
    assertEqual(landed.boundary_violation, true, "authority boundary telemetry");
    assertThrows(
      () =>
        call(
          "score_revalidation_result",
          {
            run_id: "revalidation-run",
            attempt_id: "bounded-attempt",
            verdict: "accepted",
            resolution_outcome: "retired",
            rationale: "must not accept boundary violation",
            resolution_evidence_id: 1,
          },
          ctx,
        ),
      "cannot be accepted",
    );
    const reconciled = call(
      "reconcile_revalidation_run",
      { run_id: "revalidation-run" },
      ctx,
    );
    assertEqual(reconciled.status, "failed", "hard boundary run status");
    assert(
      reconciled.diagnostics.protocol_violations.some(
        (row) => row.violation_type === "budget-overrun",
      ),
      "budget violation missing",
    );
    assert(
      reconciled.diagnostics.protocol_violations.some(
        (row) => row.violation_type === "authority-boundary",
      ),
      "authority violation missing",
    );
  } finally {
    cleanup();
  }
});

console.log(`\nrevalidation scheduler: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
