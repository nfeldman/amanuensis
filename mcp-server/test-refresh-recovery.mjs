#!/usr/bin/env node
// A5: unattended refresh authority, crash adoption, deterministic runtime route,
// exact reconciliation, cancellation, and final projection read-back.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { openDatabase } from "./dist/db.js";
import { claimTools } from "./dist/tools/claims.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { projectTools } from "./dist/tools/project.js";
import { refreshTools } from "./dist/tools/refresh.js";

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

function fixture(label, determinismMode = "seeded", changeTrackedFile = true) {
  const root = mkdtempSync(join(tmpdir(), `amanuensis-refresh-${label}-`));
  const workspace = join(root, "workspace");
  const storage = join(root, "storage");
  mkdirSync(workspace);
  mkdirSync(storage);
  mkdirSync(join(workspace, "src"));
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  function commit(value, filePath) {
    const absolute = join(workspace, filePath);
    mkdirSync(dirname(absolute), { recursive: true });
    const content =
      filePath === "src/core.ts"
        ? `export const value = ${JSON.stringify(value)};\n`
        : `${value}\n`;
    writeFileSync(absolute, content);
    execFileSync("git", ["add", filePath], { cwd: workspace });
    execFileSync(
      "git",
      [
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=amanuensis-refresh-test",
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
  const baseSha = commit("before", "src/core.ts");
  const headSha = commit("after", changeTrackedFile ? "src/core.ts" : "docs/note.md");
  const project = {
    workspacePath: workspace,
    projectKey: `test/refresh-${label}`,
    storagePath: storage,
    dbPath: join(storage, "memory.db"),
    storageGitReady: false,
  };
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  const tools = new Map(
    [...projectTools, ...evidenceTools, ...claimTools, ...refreshTools].map((tool) => [
      tool.name,
      tool,
    ]),
  );
  const call = (name, args = {}) => {
    const tool = tools.get(name);
    assert(tool, `missing tool ${name}`);
    return tool.handler(args, ctx);
  };
  const session = call("start_session", { intent: `refresh fixture ${label}` });
  ctx.sessionId = session.session_id;
  db.prepare("INSERT INTO subsystems (id, name, status) VALUES ('B-01', 'Core', 'concerns')").run();
  db.prepare(
    `INSERT INTO file_ledger
       (subsystem_id, file_path, why_in_scope, classification, ref_sha)
     VALUES ('B-01', 'src/core.ts', 'fixture', 'examined', ?)`,
  ).run(baseSha);
  const initialEvidence = call("add_evidence", {
    file_path: "src/core.ts",
    symbol: "value",
    line_range: "1-1",
    ref_sha: baseSha,
    kind: "code-verified",
    note: "original value",
  });
  call("add_claim", {
    claim_id: `${label}-claim-before`,
    claim_key: `${label}.core.value`,
    subject_type: "subsystem",
    subject_id: "B-01",
    statement: "core exposes the original value",
    epistemic_kind: "observation",
    ref_sha: baseSha,
    evidence_ids: [initialEvidence.id],
  });
  const runId = `refresh-${label}`;
  const planArgs = {
    run_id: runId,
    replicate_id: `replicate-${label}`,
    base_sha: baseSha,
    head_sha: headSha,
    allowed_sources: ["src"],
    provider_allowlist: ["fixture-provider"],
    selected_provider: "fixture-provider",
    model: "fixture-model",
    runtime: "fixture-runtime",
    determinism_mode: determinismMode,
    ...(determinismMode === "seeded" ? { determinism_seed: 42 } : {}),
    relation_discovery: "explicit-only",
    max_depth: 4,
    authority_mode: "conspectus-write",
    allowed_write_prefixes: ["docs"],
    allowed_side_effects: ["analysis-api-call", "conspectus-write"],
    auto_dispatch: true,
    max_concurrency: 1,
    max_attempts_per_obligation: 2,
    max_tokens_per_attempt: 1000,
    max_total_tokens: 3000,
    max_total_cost_microusd: 3000,
    planned_tokens_per_attempt: 500,
    planned_cost_microusd: 500,
    output_dir: join(storage, "docs"),
  };
  return {
    root,
    db,
    ctx,
    call,
    baseSha,
    headSha,
    runId,
    planArgs,
    cleanup() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const main = fixture("main", "seeded");
try {
  test("planned manifest pins preauthorized provider, replicate, budgets, and seeded route", () => {
    const plan = main.call("plan_refresh_run", main.planArgs);
    assert(plan.status === "planned", JSON.stringify(plan));
    assert(plan.manifest.authority.approval_policy === "preauthorized-envelope");
    assert(plan.manifest.authority.decision_policy === "human-only");
    assert(plan.manifest.determinism.runtime_input.request_options.seed === 42);
    assert(plan.manifest_hash.length === 64);
  });

  test("crash after dispatch is adopted exactly once on resume", () => {
    assertThrows(
      () =>
        main.call("execute_refresh_run", {
          run_id: main.runId,
          simulation_crash_after: "after-dispatch",
        }),
      "simulated refresh crash",
    );
    const attemptsBefore = main.db
      .prepare("SELECT COUNT(*) AS n FROM revalidation_attempts WHERE run_id=?")
      .get(`${main.runId}:revalidation`).n;
    const outboxBefore = main.db
      .prepare("SELECT COUNT(*) AS n FROM refresh_dispatches WHERE run_id=?")
      .get(main.runId).n;
    assert(attemptsBefore === 1 && outboxBefore === 0, `${attemptsBefore}/${outboxBefore}`);
    const resumed = main.call("resume_refresh_run", { run_id: main.runId });
    assert(resumed.status === "executing", JSON.stringify(resumed));
    assert(resumed.dispatches.length === 1, JSON.stringify(resumed.dispatches));
    const attemptsAfter = main.db
      .prepare("SELECT COUNT(*) AS n FROM revalidation_attempts WHERE run_id=?")
      .get(`${main.runId}:revalidation`).n;
    assert(attemptsAfter === 1, `resume duplicated attempt: ${attemptsAfter}`);
    assert(resumed.completion_basis === null, "worker dispatch was treated as completion");
  });

  const running = main.call("get_refresh_run", { run_id: main.runId });
  const attemptId = running.dispatches[0].attempt_id;
  const postEvidence = main.call("add_evidence", {
    file_path: "src/core.ts",
    symbol: "value",
    line_range: "1-1",
    ref_sha: main.headSha,
    kind: "test-observed",
    note: "post-change revalidation",
  });
  const replacementId = "main-claim-after";
  main.call("add_claim", {
    claim_id: replacementId,
    claim_key: "main.core.value",
    subject_type: "subsystem",
    subject_id: "B-01",
    statement: "core exposes the revised value",
    epistemic_kind: "observation",
    ref_sha: main.headSha,
    evidence_ids: [postEvidence.id],
  });
  main.call("land_refresh_result", {
    run_id: main.runId,
    attempt_id: attemptId,
    result: { conclusion: "replacement claim is current" },
    actual_tokens: 400,
    actual_cost_microusd: 400,
    consulted_sources: ["src/core.ts"],
  });
  main.call("score_refresh_result", {
    run_id: main.runId,
    attempt_id: attemptId,
    verdict: "accepted",
    resolution_outcome: "revalidated",
    rationale: "post-change evidence supports replacement authority",
    resolution_evidence_id: postEvidence.id,
    resolution_claim_id: replacementId,
  });

  test("crash after read-back resumes from one durable projection and completes", () => {
    assertThrows(
      () =>
        main.call("execute_refresh_run", {
          run_id: main.runId,
          simulation_crash_after: "after-readback",
        }),
      "simulated refresh crash",
    );
    const projectionId = `projection:${main.runId}:final`;
    assert(
      main.db
        .prepare("SELECT COUNT(*) AS n FROM projection_verification_runs WHERE run_id=?")
        .get(projectionId).n === 1,
      "read-back proof missing after crash",
    );
    const completed = main.call("resume_refresh_run", { run_id: main.runId });
    assert(completed.status === "completed", JSON.stringify(completed));
    assert(completed.completion_basis === "durable-reconciliation-and-readback");
    assert(completed.projection.ok === 1 && completed.revalidation.status === "complete");
    assert(
      main.db
        .prepare("SELECT COUNT(*) AS n FROM projection_verification_runs WHERE run_id=?")
        .get(projectionId).n === 1,
      "resume duplicated projection proof",
    );
  });

  test("out-of-envelope provider and irreversible effects block before impact or dispatch", () => {
    const blocked = main.call("plan_refresh_run", {
      ...main.planArgs,
      run_id: "refresh-blocked",
      replicate_id: "replicate-blocked",
      selected_provider: "outside-provider",
      allowed_side_effects: [
        "analysis-api-call",
        "conspectus-write",
        "deploy",
        "decision-acceptance",
      ],
      output_dir: join(main.ctx.project.storagePath, "blocked-docs"),
    });
    assert(
      blocked.status === "blocked" && blocked.blocking_reasons.length === 3,
      JSON.stringify(blocked),
    );
    assertThrows(
      () => main.call("execute_refresh_run", { run_id: "refresh-blocked" }),
      "is blocked",
    );
    assert(
      main.db
        .prepare("SELECT COUNT(*) AS n FROM change_impact_runs WHERE run_id=?")
        .get("refresh-blocked:impact").n === 0,
      "blocked authority reached impact stage",
    );
    assert(
      main.db
        .prepare("SELECT COUNT(*) AS n FROM refresh_dispatches WHERE run_id=?")
        .get("refresh-blocked").n === 0,
    );
  });

  test("manifest mutation and output paths outside storage are rejected in the substrate", () => {
    assertThrows(
      () =>
        main.db.prepare("UPDATE refresh_runs SET model='mutated' WHERE run_id=?").run(main.runId),
      "refresh execution manifest is immutable",
    );
    const blocked = main.call("plan_refresh_run", {
      ...main.planArgs,
      run_id: "refresh-output-boundary",
      replicate_id: "replicate-output-boundary",
      output_dir: join(main.root, "outside-storage"),
    });
    assert(blocked.status === "blocked", JSON.stringify(blocked));
    assert(
      blocked.blocking_reasons.includes("output_dir is outside the project storage boundary"),
      JSON.stringify(blocked.blocking_reasons),
    );
    const outside = join(main.root, "symlink-target");
    mkdirSync(outside);
    symlinkSync(outside, join(main.ctx.project.storagePath, "escape"), "dir");
    const symlinkBlocked = main.call("plan_refresh_run", {
      ...main.planArgs,
      run_id: "refresh-symlink-boundary",
      replicate_id: "replicate-symlink-boundary",
      output_dir: join(main.ctx.project.storagePath, "escape", "docs"),
    });
    assert(symlinkBlocked.status === "blocked", JSON.stringify(symlinkBlocked));
    assert(
      symlinkBlocked.blocking_reasons.includes(
        "output_dir is outside the project storage boundary",
      ),
      JSON.stringify(symlinkBlocked.blocking_reasons),
    );
    const relative = main.call("plan_refresh_run", {
      ...main.planArgs,
      run_id: "refresh-relative-output",
      replicate_id: "replicate-relative-output",
      output_dir: "relative-docs",
    });
    assert(relative.status === "planned", JSON.stringify(relative));
    assert(
      relative.manifest.output_dir === join(main.ctx.project.storagePath, "relative-docs"),
      JSON.stringify(relative.manifest.output_dir),
    );
    main.call("cancel_refresh_run", {
      run_id: "refresh-relative-output",
      reason: "relative output resolution proved",
    });
  });

  test("cancellation preserves unfinished obligation truth", () => {
    const cancelPlan = main.call("plan_refresh_run", {
      ...main.planArgs,
      run_id: "refresh-cancel",
      replicate_id: "replicate-cancel",
      output_dir: join(main.ctx.project.storagePath, "cancel-docs"),
    });
    assert(cancelPlan.status === "planned");
    const cancelled = main.call("cancel_refresh_run", {
      run_id: "refresh-cancel",
      reason: "operator stop test",
    });
    assert(cancelled.status === "cancelled" && cancelled.projection === null);
  });
} finally {
  main.cleanup();
}

test("determinism control changes the observed provider runtime input", () => {
  const seeded = fixture("route-seeded", "seeded");
  const defaulted = fixture("route-default", "provider-default");
  try {
    seeded.call("plan_refresh_run", seeded.planArgs);
    defaulted.call("plan_refresh_run", defaulted.planArgs);
    assertThrows(
      () =>
        seeded.call("execute_refresh_run", {
          run_id: seeded.runId,
          simulation_crash_after: "after-dispatch",
        }),
      "simulated refresh crash",
    );
    assertThrows(
      () =>
        defaulted.call("execute_refresh_run", {
          run_id: defaulted.runId,
          simulation_crash_after: "after-dispatch",
        }),
      "simulated refresh crash",
    );
    seeded.call("resume_refresh_run", { run_id: seeded.runId });
    defaulted.call("resume_refresh_run", { run_id: defaulted.runId });
    const seededInput = seeded.call("get_refresh_run", { run_id: seeded.runId }).dispatches[0]
      .runtime_input;
    const defaultInput = defaulted.call("get_refresh_run", { run_id: defaulted.runId })
      .dispatches[0].runtime_input;
    assert(seededInput.route.endsWith("provider-seeded"), JSON.stringify(seededInput));
    assert(seededInput.request_options.seed === 42, JSON.stringify(seededInput));
    assert(defaultInput.route.endsWith("provider-default"), JSON.stringify(defaultInput));
    assert(Object.keys(defaultInput.request_options).length === 0, JSON.stringify(defaultInput));
  } finally {
    seeded.cleanup();
    defaulted.cleanup();
  }
});

test("a refresh whose target is not checked-out HEAD blocks before impact", () => {
  const fx = fixture("non-head", "seeded");
  try {
    writeFileSync(
      join(fx.ctx.project.workspacePath, "after-head.ts"),
      "export const later = true;\n",
    );
    execFileSync("git", ["add", "after-head.ts"], { cwd: fx.ctx.project.workspacePath });
    execFileSync(
      "git",
      [
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=amanuensis-refresh-test",
        "-c",
        "user.email=test@localhost",
        "commit",
        "--quiet",
        "--no-verify",
        "-m",
        "later head",
      ],
      { cwd: fx.ctx.project.workspacePath },
    );
    const blocked = fx.call("plan_refresh_run", fx.planArgs);
    assert(blocked.status === "blocked", JSON.stringify(blocked));
    assert(
      blocked.blocking_reasons.includes(
        "head_sha must match checked-out HEAD for final projection proof",
      ),
      JSON.stringify(blocked.blocking_reasons),
    );
    assert(
      fx.db.prepare("SELECT COUNT(*) AS n FROM change_impact_runs").get().n === 0,
      "non-HEAD plan reached impact",
    );
  } finally {
    fx.cleanup();
  }
});

test("cancellation seals provider ingress while preserving dispatched and landed truth", () => {
  const dispatchedFx = fixture("cancel-dispatched", "seeded");
  const landedFx = fixture("cancel-landed", "seeded");
  try {
    dispatchedFx.call("plan_refresh_run", dispatchedFx.planArgs);
    assertThrows(
      () =>
        dispatchedFx.call("execute_refresh_run", {
          run_id: dispatchedFx.runId,
          simulation_crash_after: "after-dispatch",
        }),
      "simulated refresh crash",
    );
    const cancelled = dispatchedFx.call("cancel_refresh_run", {
      run_id: dispatchedFx.runId,
      reason: "stop dispatched work",
    });
    const cancelledAttempt = dispatchedFx.db
      .prepare(
        `SELECT a.attempt_id, a.status, a.result_json, o.state AS obligation_state,
                rd.status AS dispatch_status
           FROM revalidation_attempts a
           JOIN revalidation_obligations o ON o.obligation_id=a.obligation_id
           JOIN refresh_dispatches rd ON rd.attempt_id=a.attempt_id
          WHERE a.run_id=?`,
      )
      .get(`${dispatchedFx.runId}:revalidation`);
    assert(cancelled.status === "cancelled", JSON.stringify(cancelled));
    assert(cancelledAttempt.status === "failed", JSON.stringify(cancelledAttempt));
    assert(cancelledAttempt.obligation_state === "ready", JSON.stringify(cancelledAttempt));
    assert(cancelledAttempt.dispatch_status === "failed", JSON.stringify(cancelledAttempt));
    assert(
      JSON.parse(cancelledAttempt.result_json).reason.includes("refresh cancelled"),
      cancelledAttempt.result_json,
    );
    assertThrows(
      () =>
        dispatchedFx.call("land_refresh_result", {
          run_id: dispatchedFx.runId,
          attempt_id: cancelledAttempt.attempt_id,
          result: {},
          actual_tokens: 0,
          actual_cost_microusd: 0,
        }),
      "does not accept provider results while cancelled",
    );

    landedFx.call("plan_refresh_run", landedFx.planArgs);
    assertThrows(
      () =>
        landedFx.call("execute_refresh_run", {
          run_id: landedFx.runId,
          simulation_crash_after: "after-dispatch",
        }),
      "simulated refresh crash",
    );
    const active = landedFx.call("resume_refresh_run", { run_id: landedFx.runId });
    const landedAttemptId = active.dispatches[0].attempt_id;
    landedFx.call("land_refresh_result", {
      run_id: landedFx.runId,
      attempt_id: landedAttemptId,
      result: { conclusion: "landed before cancellation" },
      actual_tokens: 100,
      actual_cost_microusd: 100,
      consulted_sources: ["src/core.ts"],
    });
    landedFx.call("cancel_refresh_run", {
      run_id: landedFx.runId,
      reason: "stop before scoring",
    });
    const landedState = landedFx.db
      .prepare(
        `SELECT a.status, o.state AS obligation_state
           FROM revalidation_attempts a
           JOIN revalidation_obligations o ON o.obligation_id=a.obligation_id
          WHERE a.attempt_id=?`,
      )
      .get(landedAttemptId);
    assert(landedState.status === "landed", JSON.stringify(landedState));
    assert(landedState.obligation_state === "landed", JSON.stringify(landedState));
    assertThrows(
      () =>
        landedFx.call("score_refresh_result", {
          run_id: landedFx.runId,
          attempt_id: landedAttemptId,
          verdict: "accepted",
          resolution_outcome: "retired",
          rationale: "must not score after cancellation",
          resolution_evidence_id: 1,
        }),
      "does not accept provider results while cancelled",
    );
  } finally {
    dispatchedFx.cleanup();
    landedFx.cleanup();
  }
});

test("failed provider attempts retain identity and resume with the next bounded retry", () => {
  const fx = fixture("retry", "seeded");
  try {
    fx.call("plan_refresh_run", fx.planArgs);
    assertThrows(
      () =>
        fx.call("execute_refresh_run", {
          run_id: fx.runId,
          simulation_crash_after: "after-dispatch",
        }),
      "simulated refresh crash",
    );
    const first = fx.call("resume_refresh_run", { run_id: fx.runId }).dispatches[0];
    const failed = fx.call("fail_refresh_result", {
      run_id: fx.runId,
      attempt_id: first.attempt_id,
      status: "timed-out",
      reason: "fault-injected provider timeout",
    });
    assert(failed.obligation_state === "ready", JSON.stringify(failed));
    const resumed = fx.call("resume_refresh_run", { run_id: fx.runId });
    assert(resumed.dispatches.length === 2, JSON.stringify(resumed.dispatches));
    assert(resumed.dispatches[0].status === "timed-out", JSON.stringify(resumed.dispatches));
    assert(resumed.dispatches[1].attempt_number === 2, JSON.stringify(resumed.dispatches));
    assert(resumed.status === "executing", JSON.stringify(resumed));
  } finally {
    fx.cleanup();
  }
});

test("a zero-impact refresh completes from projection read-back without invented obligations", () => {
  const fx = fixture("zero-impact", "seeded", false);
  try {
    fx.call("plan_refresh_run", fx.planArgs);
    const completed = fx.call("execute_refresh_run", { run_id: fx.runId });
    assert(completed.status === "completed", JSON.stringify(completed));
    assert(completed.revalidation === null, "zero-impact refresh invented a revalidation run");
    assert(completed.dispatches.length === 0, "zero-impact refresh invented provider work");
    assert(completed.projection.ok === 1, JSON.stringify(completed.projection));
  } finally {
    fx.cleanup();
  }
});

test("provider read-boundary violations land as telemetry and cannot be accepted", () => {
  const fx = fixture("read-boundary", "seeded");
  try {
    fx.call("plan_refresh_run", fx.planArgs);
    assertThrows(
      () =>
        fx.call("execute_refresh_run", {
          run_id: fx.runId,
          simulation_crash_after: "after-dispatch",
        }),
      "simulated refresh crash",
    );
    const resumed = fx.call("resume_refresh_run", { run_id: fx.runId });
    const attemptId = resumed.dispatches[0].attempt_id;
    const landed = fx.call("land_refresh_result", {
      run_id: fx.runId,
      attempt_id: attemptId,
      result: { conclusion: "consulted an unauthorized source" },
      actual_tokens: 100,
      actual_cost_microusd: 100,
      consulted_sources: ["private/secret.ts"],
    });
    assert(landed.boundary_violation === true, JSON.stringify(landed));
    const attempt = fx.db
      .prepare(
        "SELECT boundary_violation, consulted_sources FROM revalidation_attempts WHERE attempt_id=?",
      )
      .get(attemptId);
    assert(attempt.boundary_violation === 1, JSON.stringify(attempt));
    assert(JSON.parse(attempt.consulted_sources)[0] === "private/secret.ts");
    assertThrows(
      () =>
        fx.call("score_refresh_result", {
          run_id: fx.runId,
          attempt_id: attemptId,
          verdict: "accepted",
          resolution_outcome: "retired",
          rationale: "must not accept out-of-envelope reads",
          resolution_evidence_id: 1,
        }),
      "violating result cannot be accepted",
    );
  } finally {
    fx.cleanup();
  }
});

for (const crashPoint of [
  "after-impact-predict",
  "after-impact-apply",
  "after-revalidation-plan",
]) {
  test(`${crashPoint} resumes without duplicate child custody`, () => {
    const fx = fixture(crashPoint, "seeded");
    try {
      fx.call("plan_refresh_run", fx.planArgs);
      assertThrows(
        () =>
          fx.call("execute_refresh_run", {
            run_id: fx.runId,
            simulation_crash_after: crashPoint,
          }),
        "simulated refresh crash",
      );
      const resumed = fx.call("resume_refresh_run", { run_id: fx.runId });
      assert(
        ["revalidation-planned", "executing"].includes(resumed.status),
        JSON.stringify(resumed),
      );
      assert(
        fx.db
          .prepare("SELECT COUNT(*) AS n FROM change_impact_runs WHERE run_id=?")
          .get(`${fx.runId}:impact`).n === 1,
        "impact child duplicated",
      );
      assert(
        fx.db
          .prepare("SELECT COUNT(*) AS n FROM revalidation_runs WHERE run_id=?")
          .get(`${fx.runId}:revalidation`).n === 1,
        "revalidation child duplicated",
      );
      assert(
        fx.db
          .prepare("SELECT COUNT(*) AS n FROM revalidation_attempts WHERE run_id=?")
          .get(`${fx.runId}:revalidation`).n === 1,
        "attempt duplicated",
      );
    } finally {
      fx.cleanup();
    }
  });
}

test("existing A3 databases gain consulted-source custody without losing durable rows", () => {
  const fx = fixture("consulted-source-migration", "seeded");
  const dbPath = fx.ctx.project.dbPath;
  let migrated;
  try {
    fx.db.close();
    const raw = new Database(dbPath);
    raw.exec("ALTER TABLE revalidation_attempts DROP COLUMN consulted_sources");
    raw.close();
    migrated = openDatabase(dbPath);
    const columns = migrated
      .prepare("PRAGMA table_info(revalidation_attempts)")
      .all()
      .map((row) => row.name);
    assert(columns.includes("consulted_sources"), JSON.stringify(columns));
    assert(
      migrated
        .prepare("SELECT COUNT(*) AS n FROM claims WHERE claim_id=?")
        .get("consulted-source-migration-claim-before").n === 1,
      "migration lost durable rows",
    );
  } finally {
    migrated?.close();
    rmSync(fx.root, { recursive: true, force: true });
  }
});

console.log(`\n${passed} refresh-recovery checks passed`);
