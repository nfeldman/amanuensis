#!/usr/bin/env node
// End-to-end adversarial probe for the cloud stack: simulate the
// shape of a GitHub Actions workflow run (shared conspectus repo,
// storage root override, autoprogress flag, survey + compare), and
// verify every piece plays together correctly.
//
// The actual workflow depends on Claude Code CLI + the Anthropic API,
// which can't be wired up in CI. This probe simulates the *harness*
// (the server-side machinery the workflow relies on): it makes the
// same series of tool calls the workflow would, using the same
// env-var signalling, and checks the resulting storage structure,
// commit layout, and comparison output.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./dist/db.js";
import { resolveProject } from "./dist/project.js";
import { projectTools } from "./dist/tools/project.js";
import { subsystemTools } from "./dist/tools/subsystems.js";
import { concernTools } from "./dist/tools/concerns.js";
import { dispositionTools } from "./dist/tools/dispositions.js";
import { findingTools } from "./dist/tools/findings.js";
import { openQuestionTools } from "./dist/tools/open-questions.js";
import { storageHistoryTools } from "./dist/tools/storage-history.js";
import { compareTools } from "./dist/tools/compare.js";
import { fileTools } from "./dist/tools/files.js";
import { artifactTools } from "./dist/tools/artifacts.js";

const allTools = new Map(
  [
    ...projectTools,
    ...subsystemTools,
    ...concernTools,
    ...dispositionTools,
    ...findingTools,
    ...openQuestionTools,
    ...storageHistoryTools,
    ...compareTools,
    ...fileTools,
    ...artifactTools,
  ].map((td) => [td.name, td]),
);
function call(name, args, ctx) {
  const td = allTools.get(name);
  if (!td) throw new Error(name);
  return td.handler(args, ctx);
}

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

function makeConspectusRepo() {
  const root = mkdtempSync(join(tmpdir(), "cloud-conspectus-"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  spawnSync("git", ["config", "user.email", "t@t"], { cwd: root });
  spawnSync("git", ["config", "user.name", "t"], { cwd: root });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# conspectus\n");
  spawnSync("git", ["add", "."], { cwd: root });
  spawnSync("git", ["commit", "-q", "--no-verify", "-m", "seed"], { cwd: root });
  return root;
}

function makeTargetRepo(label) {
  const ws = mkdtempSync(join(tmpdir(), `cloud-target-${label}-`));
  spawnSync("git", ["init", "-q"], { cwd: ws });
  writeFileSync(join(ws, "main.ts"), "export const x = 1;\n");
  spawnSync("git", ["add", "."], { cwd: ws });
  spawnSync("git", ["config", "user.email", "t@t"], { cwd: ws });
  spawnSync("git", ["config", "user.name", "t"], { cwd: ws });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: ws });
  spawnSync("git", ["commit", "-q", "--no-verify", "-m", "seed"], { cwd: ws });
  // Give the workspace a git-origin-equivalent so project-key
  // resolution produces a deterministic owner/repo key.
  spawnSync("git", ["remote", "add", "origin", `https://github.com/cloud-e2e/${label}.git`], {
    cwd: ws,
  });
  return ws;
}

// ---- Simulate one full workflow run ----
t("workflow-shape: cloud run produces the expected conspectus layout", () => {
  const conspectus = makeConspectusRepo();
  const target = makeTargetRepo("alpha");
  try {
    // What the workflow does:
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    process.env.AMANUENSIS_AUTOPROGRESS = "1";

    const project = resolveProject(target);
    const db = openDatabase(project.dbPath);
    const ctx = { project, db, sessionId: null };

    // 1. autoprogress self-check.
    const mode = call("get_autoprogress_mode", {}, ctx);
    assert(mode.autoprogress === true, "autoprogress flag not detected");

    // 2. Start a session (auto agent's first step).
    const sess = call("start_session", { intent: "autoprogress survey of cloud-e2e/alpha" }, ctx);
    ctx.sessionId = sess.session_id;

    // 3. Onboarding: register subsystem + advance + concerns.
    call("upsert_subsystem", { id: "B-01", name: "Main" }, ctx);
    call("update_subsystem_status", { id: "B-01", status: "scoping" }, ctx);
    call("add_files_to_scope", { subsystem_id: "B-01", ref_sha: "abc", files: [{ file_path: "main.ts", why_in_scope: "entry" }] }, ctx);
    call("update_subsystem_status", { id: "B-01", status: "structural" }, ctx);
    call("register_artifact", { path: "B-01-survey.md", kind: "subsystem-survey", subsystem_id: "B-01" }, ctx);
    call("update_subsystem_status", { id: "B-01", status: "concerns" }, ctx);
    call("add_concern", { code: "CC-1", category: "cache", origin: "seeded" }, ctx);

    // 4. Record an open question — the autoprogress path for
    //    uncertainty.
    call(
      "record_open_question",
      {
        category: "domain-knowledge",
        question: "Is the cache explicitly sized, or unbounded by design?",
        subsystem_id: "B-01",
        phase: "concerns",
        what_blocked: "cannot classify CC-1 without knowing intent",
        what_assumed: "treating as unbounded (name-inferred from symbol)",
      },
      ctx,
    );

    // 5. Write a disposition.
    call(
      "set_disposition",
      {
        subsystem_id: "B-01",
        concern_code: "CC-1",
        classification: "confirmed-acceptable",
        evidence: "main.ts:root@abc",
        evidence_quality: "name-inferred",
        rationale: "name suggests bounded; verified by reviewer's answer to OQ",
        ref_sha: "abc",
        pass_type: "survey",
      },
      ctx,
    );

    // 6. Phase-gate commit.
    const commit = call(
      "commit_phase_gate",
      { label: "Phase 3 complete · B-01 concerns pass" },
      ctx,
    );
    assert(commit.committed === true, `commit did not happen: ${JSON.stringify(commit)}`);
    assert(
      typeof commit.commit_sha === "string" && commit.commit_sha.length >= 7,
      "no commit SHA",
    );

    // 7. End the session (auto-commits).
    db.close();
    const db2 = openDatabase(project.dbPath);
    ctx.db = db2;
    ctx.sessionId = sess.session_id;
    const end = call("end_session", { outcome: "completed" }, ctx);
    assert(end.ok === true);
    db2.close();

    // Verify the conspectus repo's layout:
    //   conspectus-repo/
    //   └── workspaces/
    //       └── cloud-e2e/alpha/
    //           ├── memory.db
    //           └── .gitignore
    const storagePath = project.storagePath;
    assert(
      storagePath.startsWith(join(conspectus, "workspaces")),
      `storagePath under conspectus: ${storagePath}`,
    );
    assert(existsSync(join(storagePath, "memory.db")), "memory.db not written");
    assert(existsSync(join(storagePath, ".gitignore")), ".gitignore missing");
    // And NO nested .git — the outer repo owns history.
    assert(!existsSync(join(storagePath, ".git")), "nested .git was created");

    // Verify the conspectus repo's git log includes our phase gate +
    // session-end commits.
    const log = spawnSync("git", ["log", "--pretty=format:%s"], {
      cwd: conspectus,
      encoding: "utf8",
    }).stdout;
    assert(
      log.includes("Phase 3 complete · B-01 concerns pass"),
      `phase-gate commit missing from outer log: ${log}`,
    );
    assert(
      log.includes(`session ${sess.session_id} ended`),
      `end_session auto-commit missing: ${log}`,
    );
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    delete process.env.AMANUENSIS_AUTOPROGRESS;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- Two surveys in the same conspectus repo, then compare ----
t("workflow-shape: compare_conspectuses works on two cloud runs in the same conspectus repo", () => {
  const conspectus = makeConspectusRepo();
  const targetA = makeTargetRepo("same-a");
  const targetB = makeTargetRepo("same-b");
  try {
    // Drive two minimal surveys into the same conspectus repo, then
    // compare their memory.db files. This simulates the comparison
    // experiment the cloud version was built for (local vs. cloud,
    // same target), using two different target workspaces so we get
    // two distinct project keys.
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");

    const drive = (ws) => {
      const project = resolveProject(ws);
      const db = openDatabase(project.dbPath);
      const ctx = { project, db, sessionId: null };
      ctx.sessionId = call("start_session", { intent: "e2e" }, ctx).session_id;
      call("upsert_subsystem", { id: "B-01", name: "Main" }, ctx);
      call("update_subsystem_status", { id: "B-01", status: "scoping" }, ctx);
      call("add_files_to_scope", { subsystem_id: "B-01", ref_sha: "abc", files: [{ file_path: "main.ts", why_in_scope: "entry" }] }, ctx);
      call("update_subsystem_status", { id: "B-01", status: "structural" }, ctx);
      call("register_artifact", { path: "B-01-survey.md", kind: "subsystem-survey", subsystem_id: "B-01" }, ctx);
      call("update_subsystem_status", { id: "B-01", status: "concerns" }, ctx);
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
      db.close();
      return project;
    };

    const pA = drive(targetA);
    const pB = drive(targetB);

    const r = call(
      "compare_conspectuses",
      {
        path_a: pA.dbPath,
        path_b: pB.dbPath,
        label_a: "run-a",
        label_b: "run-b",
      },
      {},
    );
    assert(r.ok);
    assert(r.counts.a.subsystems === 1);
    assert(r.counts.b.subsystems === 1);
    // Same (subsystem, concern) cell, same verdict → perfect agreement.
    assert(r.concerns_coverage.same_verdict === 1);
    assert(r.concerns_coverage.diverged_verdict === 0);
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(targetA, { recursive: true, force: true });
    rmSync(targetB, { recursive: true, force: true });
  }
});

// ---- Gracefully handle a bad AMANUENSIS_STORAGE_ROOT ----
t("non-writable AMANUENSIS_STORAGE_ROOT fails with a clear error", () => {
  const target = makeTargetRepo("badroot");
  try {
    // Point to a path we cannot create (a file where we'd need a dir).
    const blocker = mkdtempSync(join(tmpdir(), "cloud-blocker-"));
    const bogus = join(blocker, "im-a-file");
    writeFileSync(bogus, "x");
    process.env.AMANUENSIS_STORAGE_ROOT = bogus;
    let threw = false;
    try {
      resolveProject(target);
    } catch (e) {
      threw = true;
      // mkdirSync on a path whose parent is a regular file throws
      // ENOTDIR. We surface the error as-is rather than masking it;
      // the workflow's log will make it obvious what went wrong.
      assert(
        /ENOTDIR|not a directory|EEXIST|EACCES|EPERM/.test(e.message ?? String(e)),
        `unexpected error: ${e.message}`,
      );
    }
    assert(threw, "should have thrown");
    rmSync(blocker, { recursive: true, force: true });
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- autonomous behavior is part of the portable workflow ----
t("portable skill specifies autonomous progress", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const skill = resolve(here, "..", ".claude", "skills", "amanuensis", "SKILL.md");
  assert(existsSync(skill), "portable Amanuensis skill missing");
  const body = readFileSync(skill, "utf8");
  assert(body.includes("run autonomously by default"), "autonomous default missing from skill");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
