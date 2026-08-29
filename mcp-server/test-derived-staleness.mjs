#!/usr/bin/env node
// Red gates for A1 (staleness adoption) and A2 (scope reconciliation).
//
// These reproduce findings B03-1 and B03-2. Before the repair, staleness lived
// only on `entries`, which no server path ever wrote, so every signal derived
// from it reported health regardless of state — a zero-denominator green. The
// file ledger is the right home because the survey always populates it: a
// subsystem cannot pass the scoping gate without rows there, so the denominator
// cannot silently be empty.
//
//   A1 — drift over a surveyed subsystem must be reported by the dashboard and
//        the backlog and must name the affected subsystem. A conspectus with no
//        ledgered files must report absence of measurement, never freshness.
//   A2 — reconciliation must name paths added to the tree but absent from the
//        ledger, and ledger rows whose file is gone. A clean reconciliation must
//        prove it actually measured something.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { openDatabase } from "./dist/db.js";
import { ensureProjectStorage, resolveProject } from "./dist/project.js";
import { fileTools } from "./dist/tools/files.js";
import { gitTools } from "./dist/tools/git.js";
import { staleTools } from "./dist/tools/stale.js";
import { dashboardTools } from "./dist/tools/dashboard.js";
import { subsystemTools } from "./dist/tools/subsystems.js";

const toolMap = new Map(
  [...fileTools, ...gitTools, ...staleTools, ...dashboardTools, ...subsystemTools].map((td) => [
    td.name,
    td,
  ]),
);
const call = (name, args, ctx) => toolMap.get(name).handler(args, ctx);

let passed = 0;
let failed = 0;
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

function git(ws, ...args) {
  const r = spawnSync("git", args, { cwd: ws, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function writeAndCommit(ws, path, body, message) {
  const full = join(ws, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  git(ws, "add", "-A");
  git(ws, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message);
  return git(ws, "rev-parse", "HEAD");
}

function freshCtx() {
  const ws = mkdtempSync(join(tmpdir(), "stale-"));
  git(ws, "init", "-q");
  const project = resolveProject(ws);
  ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: "s-test" };
  db.prepare("INSERT INTO sessions (session_id, intent) VALUES ('s-test', 'red gate')").run();
  return {
    ws,
    ctx,
    cleanup: () => {
      db.close();
      rmSync(ws, { recursive: true, force: true });
      rmSync(project.storagePath, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------- A1 ----

t("A1: drift over a surveyed file is reported and names its subsystem", () => {
  const { ws, ctx, cleanup } = freshCtx();
  try {
    const base = writeAndCommit(ws, "src/core.ts", "export const a = 1;\n", "base");
    call("set_git_state", { canonical_branch: "main", onboarding_sha: base }, ctx);
    call("upsert_subsystem", { id: "B-01", name: "Core", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      {
        subsystem_id: "B-01",
        ref_sha: base,
        files: [{ file_path: "src/core.ts", classification: "examined" }],
      },
      ctx,
    );

    const head = writeAndCommit(ws, "src/core.ts", "export const a = 2;\n", "drift");
    const detected = call("detect_changes", { current_sha: head }, ctx);
    assert(detected.stale_count === 1, `expected 1 stale subsystem, got ${detected.stale_count}`);

    const backlog = call("get_stale_backlog", {}, ctx);
    assert(backlog.length > 0, "stale backlog is empty after real drift");
    assert(
      backlog.some((r) => r.subsystem_id === "B-01" && r.source_path === "src/core.ts"),
      `backlog does not name the drifted file: ${JSON.stringify(backlog)}`,
    );

    const dash = call("get_dashboard", {}, ctx);
    assert(
      dash.stale_entries >= 1,
      `dashboard reports ${dash.stale_entries} stale after drift over a surveyed file`,
    );
  } finally {
    cleanup();
  }
});

t("A1: a conspectus with no ledgered files reports absence, not freshness", () => {
  const { ws, ctx, cleanup } = freshCtx();
  try {
    const base = writeAndCommit(ws, "src/core.ts", "x\n", "base");
    call("set_git_state", { canonical_branch: "main", onboarding_sha: base }, ctx);
    const dash = call("get_dashboard", {}, ctx);
    assert(
      dash.staleness_measured === false,
      "an unpopulated ledger must report staleness as unmeasured rather than clean",
    );
  } finally {
    cleanup();
  }
});

t("A1: clearing staleness after re-examination returns the file to fresh", () => {
  const { ws, ctx, cleanup } = freshCtx();
  try {
    const base = writeAndCommit(ws, "src/core.ts", "1\n", "base");
    call("set_git_state", { canonical_branch: "main", onboarding_sha: base }, ctx);
    call("upsert_subsystem", { id: "B-01", name: "Core", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      {
        subsystem_id: "B-01",
        ref_sha: base,
        files: [{ file_path: "src/core.ts", classification: "examined" }],
      },
      ctx,
    );
    const head = writeAndCommit(ws, "src/core.ts", "2\n", "drift");
    call("detect_changes", { current_sha: head }, ctx);
    assert(call("get_dashboard", {}, ctx).stale_entries === 1, "precondition: one stale file");

    call(
      "clear_staleness",
      { subsystem_id: "B-01", file_path: "src/core.ts", ref_sha: head },
      ctx,
    );
    const dash = call("get_dashboard", {}, ctx);
    assert(dash.stale_entries === 0, `expected 0 stale after clearing, got ${dash.stale_entries}`);
    assert(dash.staleness_measured === true, "measurement must remain established after clearing");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------- A2 ----

t("A2: reconciliation names a tracked path absent from the ledger", () => {
  const { ws, ctx, cleanup } = freshCtx();
  try {
    const base = writeAndCommit(ws, "src/core.ts", "1\n", "base");
    call("set_git_state", { canonical_branch: "main", onboarding_sha: base }, ctx);
    call("upsert_subsystem", { id: "B-01", name: "Core", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      {
        subsystem_id: "B-01",
        ref_sha: base,
        files: [{ file_path: "src/core.ts", classification: "examined" }],
      },
      ctx,
    );
    const head = writeAndCommit(ws, "src/added.ts", "new\n", "add a file nobody scoped");

    const detected = call("detect_changes", { current_sha: head }, ctx);
    assert(
      detected.unledgered_paths?.includes("src/added.ts"),
      `reconciliation did not report the unledgered path: ${JSON.stringify(detected.unledgered_paths)}`,
    );
    assert(
      call("get_dashboard", {}, ctx).unclassified_paths === 1,
      "dashboard must count paths the ledger does not cover",
    );
  } finally {
    cleanup();
  }
});

t("A2: reconciliation names a ledger row whose file is gone", () => {
  const { ws, ctx, cleanup } = freshCtx();
  try {
    const base = writeAndCommit(ws, "src/core.ts", "1\n", "base");
    writeAndCommit(ws, "src/doomed.ts", "bye\n", "second file");
    call("set_git_state", { canonical_branch: "main", onboarding_sha: base }, ctx);
    call("upsert_subsystem", { id: "B-01", name: "Core", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      {
        subsystem_id: "B-01",
        ref_sha: base,
        files: [
          { file_path: "src/core.ts", classification: "examined" },
          { file_path: "src/doomed.ts", classification: "examined" },
        ],
      },
      ctx,
    );
    unlinkSync(join(ws, "src/doomed.ts"));
    git(ws, "add", "-A");
    git(ws, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "delete");
    const head = git(ws, "rev-parse", "HEAD");

    const detected = call("detect_changes", { current_sha: head }, ctx);
    assert(
      detected.absent_ledger_paths?.some((r) => r.file_path === "src/doomed.ts"),
      `reconciliation did not report the absent ledger row: ${JSON.stringify(detected.absent_ledger_paths)}`,
    );
    assert(
      call("get_dashboard", {}, ctx).absent_files === 1,
      "dashboard must count ledger rows whose file no longer exists",
    );
  } finally {
    cleanup();
  }
});

t("A2: a clean reconciliation proves it measured something", () => {
  const { ws, ctx, cleanup } = freshCtx();
  try {
    const base = writeAndCommit(ws, "src/core.ts", "1\n", "base");
    call("set_git_state", { canonical_branch: "main", onboarding_sha: base }, ctx);
    call("upsert_subsystem", { id: "B-01", name: "Core", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      {
        subsystem_id: "B-01",
        ref_sha: base,
        files: [{ file_path: "src/core.ts", classification: "examined" }],
      },
      ctx,
    );
    const detected = call("detect_changes", { current_sha: base }, ctx);
    assert(detected.unledgered_paths.length === 0, "expected no unledgered paths");
    assert(detected.absent_ledger_paths.length === 0, "expected no absent rows");
    // Non-vacuity: a zero result is only meaningful alongside what was examined.
    assert(
      detected.reconciled_tracked_paths === 1 && detected.reconciled_ledger_rows === 1,
      `clean reconciliation must report its denominators, got tracked=${detected.reconciled_tracked_paths} rows=${detected.reconciled_ledger_rows}`,
    );
  } finally {
    cleanup();
  }
});


// ---------------------------------------------------------- exemption ----

// A staleness count is an obligation count. Rows whose classification already
// exempts them from survey — generated output, vendored code, files ruled
// irrelevant — carry no obligation, so counting their drift dilutes the very
// signal B03-2 and B04-1 repaired. The checked-in docs/ projection is the acute
// case: it changes on every publish, so republishing the report would make the
// conspectus report itself as staler.
t("stale generated output does not move the obligation count", () => {
  const { ws, ctx, cleanup } = freshCtx();
  try {
    const base = writeAndCommit(ws, "src/core.ts", "1\n", "base");
    writeAndCommit(ws, "docs/report.html", "<p>1</p>\n", "publish");
    call("set_git_state", { canonical_branch: "main", onboarding_sha: base }, ctx);
    call("upsert_subsystem", { id: "B-01", name: "Core", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      {
        subsystem_id: "B-01",
        ref_sha: base,
        files: [
          { file_path: "src/core.ts", classification: "examined" },
          { file_path: "docs/report.html", classification: "generated-ignore" },
        ],
      },
      ctx,
    );

    // Drift both in one commit: one is survey subject matter, one is not.
    writeAndCommit(ws, "src/core.ts", "2\n", "source drift");
    const head = writeAndCommit(ws, "docs/report.html", "<p>2</p>\n", "republish");
    call("detect_changes", { current_sha: head }, ctx);

    const dash = call("get_dashboard", {}, ctx);
    assert(
      dash.stale_entries === 1,
      `obligation count must exclude exempt classifications, got ${dash.stale_entries}`,
    );
    // Non-vacuity: the exempt row really did drift, so a count of 1 is a
    // filter working rather than nothing having changed.
    assert(
      dash.stale_exempt === 1,
      `exempt drift must still be visible separately, got ${dash.stale_exempt}`,
    );

    const backlog = call("get_stale_backlog", {}, ctx);
    assert(
      backlog.length === 1 && backlog[0].source_path === "src/core.ts",
      `backlog must offer only files carrying an obligation: ${JSON.stringify(backlog.map((r) => r.source_path))}`,
    );
  } finally {
    cleanup();
  }
});


// ------------------------------------------------------- content drift ----

// Staleness is a claim about content, not about paths. A file touched and
// reverted is byte-identical to what was examined, so the examination still
// holds; flagging it inflates the obligation count with churn, and nothing
// un-marks a row except clear_staleness, so the inflation is permanent.
t("a file touched and reverted is not stale", () => {
  const { ws, ctx, cleanup } = freshCtx();
  try {
    const base = writeAndCommit(ws, "src/core.ts", "1\n", "base");
    call("set_git_state", { canonical_branch: "main", onboarding_sha: base }, ctx);
    call("upsert_subsystem", { id: "B-01", name: "Core", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      {
        subsystem_id: "B-01",
        ref_sha: base,
        files: [{ file_path: "src/core.ts", classification: "examined" }],
      },
      ctx,
    );
    writeAndCommit(ws, "src/core.ts", "2\n", "churn");
    const head = writeAndCommit(ws, "src/core.ts", "1\n", "revert");

    const detected = call("detect_changes", { current_sha: head }, ctx);
    // Non-vacuity: the path really is in the range diff, so a count of zero
    // means the predicate compared content rather than skipping the file.
    assert(
      detected.reconciled_ledger_rows === 1,
      "precondition: the file is scoped",
    );
    assert(
      call("get_dashboard", {}, ctx).stale_entries === 0,
      `content identical to ref_sha must not be stale, got ${call("get_dashboard", {}, ctx).stale_entries}`,
    );
  } finally {
    cleanup();
  }
});

t("a genuine content change is still stale", () => {
  const { ws, ctx, cleanup } = freshCtx();
  try {
    const base = writeAndCommit(ws, "src/core.ts", "1\n", "base");
    call("set_git_state", { canonical_branch: "main", onboarding_sha: base }, ctx);
    call("upsert_subsystem", { id: "B-01", name: "Core", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      {
        subsystem_id: "B-01",
        ref_sha: base,
        files: [{ file_path: "src/core.ts", classification: "examined" }],
      },
      ctx,
    );
    const head = writeAndCommit(ws, "src/core.ts", "2\n", "real drift");
    call("detect_changes", { current_sha: head }, ctx);
    assert(call("get_dashboard", {}, ctx).stale_entries === 1, "genuine drift must stale");
  } finally {
    cleanup();
  }
});

t("a row that becomes provably fresh again is un-marked", () => {
  const { ws, ctx, cleanup } = freshCtx();
  try {
    const base = writeAndCommit(ws, "src/core.ts", "1\n", "base");
    call("set_git_state", { canonical_branch: "main", onboarding_sha: base }, ctx);
    call("upsert_subsystem", { id: "B-01", name: "Core", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      {
        subsystem_id: "B-01",
        ref_sha: base,
        files: [{ file_path: "src/core.ts", classification: "examined" }],
      },
      ctx,
    );
    const drifted = writeAndCommit(ws, "src/core.ts", "2\n", "drift");
    call("detect_changes", { current_sha: drifted }, ctx);
    assert(call("get_dashboard", {}, ctx).stale_entries === 1, "precondition: stale");

    // Restoring the examined content makes the original examination valid again.
    const restored = writeAndCommit(ws, "src/core.ts", "1\n", "restore");
    call("detect_changes", { current_sha: restored }, ctx);
    assert(
      call("get_dashboard", {}, ctx).stale_entries === 0,
      "a row whose content matches its ref_sha again must not stay stale",
    );
  } finally {
    cleanup();
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
