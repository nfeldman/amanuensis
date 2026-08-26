#!/usr/bin/env node
// Targeted tests for storage-dir git integration.
// Verifies: idempotent init, gitignore present, commit, no-op commit,
// log, auto-commit on end_session, rejected multi-line labels, rejected
// oversized labels.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openDatabase } from "./dist/db.js";
import { ensureProjectStorage, resolveProject } from "./dist/project.js";
import { storageHistoryTools } from "./dist/tools/storage-history.js";
import {
  ensureStorageRepo,
  commitStorage,
  getStorageLog,
  isGitRepo,
} from "./dist/storage-git.js";

let passed = 0, failed = 0;
function t(label, fn) {
  try { fn(); console.log(`  ok   ${label}`); passed++; }
  catch (e) { console.log(`  FAIL ${label}\n       ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Each test gets a fresh workspace + storage dir.
function freshProject() {
  const ws = mkdtempSync(join(tmpdir(), "agit-ws-"));
  spawnSync("git", ["init", "-q"], { cwd: ws });
  const project = resolveProject(ws);
  ensureProjectStorage(project, (databasePath) => {
    const database = openDatabase(databasePath);
    database.close();
  });
  return { ws, project };
}

// --- init ---
t("ensureStorageRepo creates .git and .gitignore", () => {
  const { ws, project } = freshProject();
  assert(isGitRepo(project.storagePath), "storage should be git repo after resolveProject");
  assert(existsSync(join(project.storagePath, ".gitignore")), ".gitignore present");
  const gi = readFileSync(join(project.storagePath, ".gitignore"), "utf8");
  assert(gi.includes("memory.db-wal"), ".gitignore covers WAL file");
  rmSync(ws, { recursive: true, force: true });
  rmSync(project.storagePath, { recursive: true, force: true });
});

t("ensureStorageRepo is idempotent on re-open", () => {
  const { ws, project } = freshProject();
  const second = ensureStorageRepo(project.storagePath);
  assert(second.ok, `second init should succeed: ${second.reason}`);
  assert(second.reason === "already initialized", `reason should reflect idempotence, got: ${second.reason}`);
  rmSync(ws, { recursive: true, force: true });
  rmSync(project.storagePath, { recursive: true, force: true });
});

t("ensureStorageRepo with pre-existing .git dir is non-destructive", () => {
  // Simulate a user who ran `git init` in the storage dir manually.
  const { ws, project } = freshProject();
  // Storage is already a repo. Call ensure again — should be a no-op.
  const r = ensureStorageRepo(project.storagePath);
  assert(r.ok, "should succeed on pre-existing repo");
  // Probe that we didn't re-init: check HEAD still exists.
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: project.storagePath, encoding: "utf8" });
  assert(head.status === 0, "HEAD should still resolve");
  rmSync(ws, { recursive: true, force: true });
  rmSync(project.storagePath, { recursive: true, force: true });
});

// --- commit ---
t("commitStorage commits a DB change", () => {
  const { ws, project } = freshProject();
  const db = openDatabase(project.dbPath);
  db.prepare("INSERT INTO git_state(repo_id,canonical_branch,onboarding_sha) VALUES('default','main','abc')").run();
  db.close();
  const r = commitStorage(project.storagePath, "test commit");
  assert(r.ok, `commit ok: ${r.reason}`);
  assert(r.reason === "committed", `reason should be 'committed', got: ${r.reason}`);
  assert(r.commit_sha && r.commit_sha.length >= 7, `short SHA returned: ${r.commit_sha}`);
  rmSync(ws, { recursive: true, force: true });
  rmSync(project.storagePath, { recursive: true, force: true });
});

t("commit_phase_gate checkpoints live WAL state into the committed database", () => {
  const { ws, project } = freshProject();
  const db = openDatabase(project.dbPath);
  db.prepare("INSERT INTO sessions(session_id,intent) VALUES('live-session','checkpoint test')").run();
  db.prepare("INSERT INTO git_state(repo_id,canonical_branch,onboarding_sha) VALUES('default','main','live-wal')").run();
  const ctx = { project, db, sessionId: "live-session" };
  const tool = storageHistoryTools.find(({ name }) => name === "commit_phase_gate");
  assert(tool, "commit_phase_gate tool should exist");
  const result = tool.handler({ label: "checkpoint live WAL" }, ctx);
  assert(result.committed, `phase gate should commit: ${JSON.stringify(result)}`);

  // Keep the source connection open: closing it would auto-checkpoint and
  // make this control unable to distinguish the fixed path from the defect.
  const shown = spawnSync("git", ["show", `${result.commit_sha}:memory.db`], {
    cwd: project.storagePath,
    encoding: null,
    // The canonical schema grows with each roadmap initiative. Keep the
    // proof-test buffer above the default 1 MiB so a larger valid database is
    // not mistaken for a missing Git object.
    maxBuffer: 16 * 1024 * 1024,
  });
  assert(shown.status === 0, `git show should recover memory.db: ${shown.stderr?.toString()}`);
  const snapshotPath = join(ws, "committed-memory.db");
  writeFileSync(snapshotPath, shown.stdout);
  const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  const row = snapshot.prepare("SELECT onboarding_sha FROM git_state WHERE repo_id='default'").get();
  assert(row?.onboarding_sha === "live-wal", "committed DB should contain the live WAL mutation");
  snapshot.close();
  db.close();
  rmSync(ws, { recursive: true, force: true });
  rmSync(project.storagePath, { recursive: true, force: true });
});

t("commitStorage reports no-op when nothing changed", () => {
  const { ws, project } = freshProject();
  const db = openDatabase(project.dbPath);
  db.prepare("INSERT INTO git_state(repo_id,canonical_branch,onboarding_sha) VALUES('default','main','abc')").run();
  db.close();
  commitStorage(project.storagePath, "first");
  const r = commitStorage(project.storagePath, "second");
  assert(r.ok, "should still report ok");
  assert(r.reason === "no changes", `reason should be 'no changes', got: ${r.reason}`);
  assert(!r.commit_sha, "no new commit SHA when nothing changed");
  rmSync(ws, { recursive: true, force: true });
  rmSync(project.storagePath, { recursive: true, force: true });
});

t("commitStorage rejects multi-line labels", () => {
  const { ws, project } = freshProject();
  const r = commitStorage(project.storagePath, "line one\nline two");
  assert(!r.ok, "should reject");
  assert(r.reason.includes("single-line"), `reason should mention single-line, got: ${r.reason}`);
  rmSync(ws, { recursive: true, force: true });
  rmSync(project.storagePath, { recursive: true, force: true });
});

t("commitStorage rejects oversized labels", () => {
  const { ws, project } = freshProject();
  const r = commitStorage(project.storagePath, "x".repeat(501));
  assert(!r.ok, "should reject");
  assert(r.reason.includes("500"), `reason should mention 500, got: ${r.reason}`);
  rmSync(ws, { recursive: true, force: true });
  rmSync(project.storagePath, { recursive: true, force: true });
});

t("commitStorage rejects empty labels", () => {
  const { ws, project } = freshProject();
  const r = commitStorage(project.storagePath, "  ");
  assert(!r.ok, "should reject empty-after-trim");
  assert(r.reason.includes("empty"), `reason should mention empty, got: ${r.reason}`);
  rmSync(ws, { recursive: true, force: true });
  rmSync(project.storagePath, { recursive: true, force: true });
});

t("commitStorage handles shell-metachar labels safely", () => {
  // Label contains quotes, backticks, dollars, semicolons. If we were using
  // string concat into a shell command, this would break. With spawnSync +
  // -F - stdin, it's safe.
  const { ws, project } = freshProject();
  writeFileSync(join(project.storagePath, "junk.txt"), "x");
  const tricky = `rm -rf $(pwd); echo "pwned" \`whoami\``;
  const r = commitStorage(project.storagePath, tricky);
  assert(r.ok && r.reason === "committed", `should commit safely: ${r.reason}`);
  // Verify the commit message landed exactly as-is.
  const show = spawnSync("git", ["log", "-1", "--pretty=format:%s"], { cwd: project.storagePath, encoding: "utf8" });
  assert(show.stdout === tricky, `commit subject should equal input, got: ${show.stdout}`);
  rmSync(ws, { recursive: true, force: true });
  rmSync(project.storagePath, { recursive: true, force: true });
});

// --- log ---
t("getStorageLog returns commits newest-first", () => {
  const { ws, project } = freshProject();
  const db = openDatabase(project.dbPath);
  db.prepare("INSERT INTO git_state(repo_id,canonical_branch,onboarding_sha) VALUES('default','main','abc')").run();
  db.close();
  commitStorage(project.storagePath, "first change");
  writeFileSync(join(project.storagePath, "a.txt"), "x");
  commitStorage(project.storagePath, "second change");
  const log = getStorageLog(project.storagePath, 10);
  assert(log.length >= 3, `log should have ≥3 entries (init + 2), got ${log.length}`);
  assert(log[0].message === "second change", `newest first: ${log[0].message}`);
  assert(log[1].message === "first change");
  rmSync(ws, { recursive: true, force: true });
  rmSync(project.storagePath, { recursive: true, force: true });
});

// --- WAL file isn't committed ---
t("memory.db-wal/-shm not committed", () => {
  const { ws, project } = freshProject();
  const db = openDatabase(project.dbPath);
  // Force WAL mode + a write so -wal/-shm exist.
  db.prepare("INSERT INTO git_state(repo_id,canonical_branch,onboarding_sha) VALUES('default','main','abc')").run();
  db.close();
  commitStorage(project.storagePath, "commit with WAL present");
  const tree = spawnSync("git", ["ls-files"], { cwd: project.storagePath, encoding: "utf8" });
  assert(!tree.stdout.includes("memory.db-wal"), "WAL file should not be tracked");
  assert(!tree.stdout.includes("memory.db-shm"), "SHM file should not be tracked");
  rmSync(ws, { recursive: true, force: true });
  rmSync(project.storagePath, { recursive: true, force: true });
});

// --- project key sanitization ---
t("project key sanitization blocks path traversal", async () => {
  const { resolveProjectKey } = await import("./dist/project.js");
  // A workspace whose basename is `..` should not produce `../../`.
  const key = resolveProjectKey("/tmp");
  assert(!key.includes(".."), `key should not contain '..', got: ${key}`);
  assert(!key.startsWith("/"), `key should not start with /, got: ${key}`);
});

// Cleanup tmp.
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
