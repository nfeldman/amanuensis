#!/usr/bin/env node
// Adversarial correctness probes for cloud-mode storage: the
// AMANUENSIS_STORAGE_ROOT override that redirects project storage
// somewhere other than ~/.amanuensis/workspaces, and the nested-repo
// detection that keeps a shared conspectus repo from getting nested
// `.git` directories.
//
// The shared-conspectus-repo pattern works like this:
//
//   conspectus-repo/         <- outer git repo (checked out in CI)
//   ├── .git/
//   ├── workspaces/          <- AMANUENSIS_STORAGE_ROOT points here
//   │   ├── owner/projectA/  <- per-project storage, no nested .git
//   │   │   ├── memory.db
//   │   │   └── docs/
//   │   └── owner/projectB/
//   └── README.md
//
// Each survey invocation sets AMANUENSIS_STORAGE_ROOT to the outer
// repo's `workspaces/` dir and points --workspace at whatever target
// repo is being surveyed. The MCP server sees the storage dir is
// already inside a git worktree, skips its own `git init`, and
// commits against the outer repo — scoped to the project subdir so
// two concurrent surveys never entangle.
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

async function loadModules() {
  // The modules cache process.env at import time for things we don't
  // care about, but resolveStorageRoot reads AMANUENSIS_STORAGE_ROOT
  // fresh on every call. So we can set it per-test and still share the
  // same import.
  return await import("./dist/project.js");
}

function makeConspectusRepo() {
  const root = mkdtempSync(join(tmpdir(), "conspectus-"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  spawnSync("git", ["config", "user.email", "t@t"], { cwd: root });
  spawnSync("git", ["config", "user.name", "t"], { cwd: root });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# conspectus\n");
  spawnSync("git", ["add", "."], { cwd: root });
  spawnSync("git", ["commit", "-q", "--no-verify", "-m", "seed"], { cwd: root });
  return root;
}

function makeTargetRepo() {
  const ws = mkdtempSync(join(tmpdir(), "target-"));
  spawnSync("git", ["init", "-q"], { cwd: ws });
  writeFileSync(join(ws, "main.ts"), "export const x = 1;\n");
  spawnSync("git", ["add", "."], { cwd: ws });
  spawnSync("git", ["config", "user.email", "t@t"], { cwd: ws });
  spawnSync("git", ["config", "user.name", "t"], { cwd: ws });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: ws });
  spawnSync("git", ["commit", "-q", "--no-verify", "-m", "seed"], { cwd: ws });
  return ws;
}

const { resolveProject } = await loadModules();
const { openDatabase } = await import("./dist/db.js");
const { commitStorage, isGitRepo, getStorageLog } = await import("./dist/storage-git.js");

// ---- 1. Storage-root override ----
t("AMANUENSIS_STORAGE_ROOT redirects storage out of ~/.amanuensis", () => {
  const conspectus = makeConspectusRepo();
  const target = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const project = resolveProject(target);
    assert(
      project.storagePath.startsWith(join(conspectus, "workspaces")),
      `storagePath should live under conspectus/workspaces, got: ${project.storagePath}`,
    );
    assert(
      !project.storagePath.includes("/.amanuensis/"),
      "storagePath should NOT be in ~/.amanuensis",
    );
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- 2. Nested storage dir: no nested .git ----
t("storage inside a conspectus repo gets NO nested .git", () => {
  const conspectus = makeConspectusRepo();
  const target = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const project = resolveProject(target);
    assert(
      !existsSync(join(project.storagePath, ".git")),
      "nested .git was created — outer repo would become confused",
    );
    // The storage dir is still recognized as "in a git repo" for
    // commit purposes.
    assert(isGitRepo(project.storagePath), "isGitRepo should return true for nested dirs");
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- 3. Commits land in the OUTER repo ----
t("commitStorage on nested dir lands in the conspectus repo", () => {
  const conspectus = makeConspectusRepo();
  const target = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const project = resolveProject(target);
    const db = openDatabase(project.dbPath);
    db.prepare("INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha) VALUES ('default','main','abc')").run();
    db.close();
    const r = commitStorage(project.storagePath, "cloud-mode phase-gate test");
    assert(r.ok, `commit should succeed: ${r.reason}`);
    assert(r.reason === "committed", `expected committed, got: ${r.reason}`);
    // Verify the commit is on the outer repo's log.
    const log = spawnSync("git", ["log", "--oneline", "-n", "5"], {
      cwd: conspectus,
      encoding: "utf8",
    }).stdout;
    assert(log.includes("cloud-mode phase-gate test"), `commit not on outer log: ${log}`);
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- 4. Two concurrent surveys don't entangle ----
t("two surveys on different projects commit independently", () => {
  const conspectus = makeConspectusRepo();
  const targetA = makeTargetRepo();
  const targetB = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const projA = resolveProject(targetA);
    const projB = resolveProject(targetB);
    // Touch A, touch B, commit A — B's staged change should not be
    // pulled into A's commit.
    writeFileSync(join(projA.storagePath, "a-only.txt"), "A");
    writeFileSync(join(projB.storagePath, "b-only.txt"), "B");
    const rA = commitStorage(projA.storagePath, "commit A only");
    assert(rA.ok && rA.reason === "committed", `A should commit: ${rA.reason}`);
    // Inspect that commit's tree to confirm b-only.txt is NOT in it.
    const show = spawnSync(
      "git",
      ["show", "--name-only", "--pretty=format:", "HEAD"],
      { cwd: conspectus, encoding: "utf8" },
    ).stdout;
    assert(show.includes("a-only.txt"), `A's file should be in commit: ${show}`);
    assert(!show.includes("b-only.txt"), `B's file leaked into A's commit: ${show}`);
    // Now commit B.
    const rB = commitStorage(projB.storagePath, "commit B only");
    assert(rB.ok && rB.reason === "committed", `B should commit: ${rB.reason}`);
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(targetA, { recursive: true, force: true });
    rmSync(targetB, { recursive: true, force: true });
  }
});

// ---- 5. get_storage_history is scoped to the project subdir ----
t("getStorageLog shows only commits that touched the project subdir", () => {
  const conspectus = makeConspectusRepo();
  const targetA = makeTargetRepo();
  const targetB = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const projA = resolveProject(targetA);
    const projB = resolveProject(targetB);
    writeFileSync(join(projA.storagePath, "a.txt"), "A");
    commitStorage(projA.storagePath, "touched A");
    writeFileSync(join(projB.storagePath, "b.txt"), "B");
    commitStorage(projB.storagePath, "touched B");
    const logA = getStorageLog(projA.storagePath, 10);
    const msgsA = logA.map((c) => c.message);
    assert(msgsA.some((m) => m.includes("touched A")), `A's log missing its own commit: ${msgsA}`);
    assert(
      !msgsA.some((m) => m.includes("touched B")),
      `A's log leaked B's commit: ${msgsA}`,
    );
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(targetA, { recursive: true, force: true });
    rmSync(targetB, { recursive: true, force: true });
  }
});

// ---- 6. Default behavior (no env var) still works ----
t("without AMANUENSIS_STORAGE_ROOT, storage defaults to ~/.amanuensis", () => {
  const target = makeTargetRepo();
  try {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    const project = resolveProject(target);
    assert(project.storagePath.includes("/.amanuensis/workspaces/"));
    rmSync(project.storagePath, { recursive: true, force: true });
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- 7. Nested mode writes .gitignore inside the project subdir ----
t("nested storage still gets .gitignore covering WAL files", () => {
  const conspectus = makeConspectusRepo();
  const target = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const project = resolveProject(target);
    const gi = join(project.storagePath, ".gitignore");
    assert(existsSync(gi), ".gitignore missing");
    const body = readFileSync(gi, "utf8");
    assert(body.includes("memory.db-wal"), ".gitignore does not cover WAL");
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- 8. Nested mode rejects an empty commit label (guardrails hold) ----
t("nested mode still validates commit labels", () => {
  const conspectus = makeConspectusRepo();
  const target = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const project = resolveProject(target);
    writeFileSync(join(project.storagePath, "x.txt"), "x");
    const r = commitStorage(project.storagePath, "");
    assert(!r.ok);
    assert(r.reason.includes("empty"));
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- 9. Outer repo on unborn branch is handled ----
t("nested storage inside an unborn outer repo doesn't crash", () => {
  // An outer repo that's been `git init`-ed but has no commits yet.
  const conspectus = mkdtempSync(join(tmpdir(), "conspectus-unborn-"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: conspectus });
  const target = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const project = resolveProject(target);
    assert(!existsSync(join(project.storagePath, ".git")), "created nested .git on unborn outer");
    // Storage is in a repo, commit should succeed (outer repo accepts
    // the root commit).
    writeFileSync(join(project.storagePath, "x.txt"), "x");
    // Give the outer repo an identity so commit-from-unborn lands.
    spawnSync("git", ["config", "user.email", "t@t"], { cwd: conspectus });
    spawnSync("git", ["config", "user.name", "t"], { cwd: conspectus });
    spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: conspectus });
    const r = commitStorage(project.storagePath, "first on unborn outer");
    assert(r.ok, `should succeed: ${r.reason}`);
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
