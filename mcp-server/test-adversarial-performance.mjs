#!/usr/bin/env node
// Performance probes for the storage-git integration. Measures the cost
// amanuensis imposes on the operations that happen often — mostly commit,
// since init runs once per project — and verifies that the "no changes"
// short-circuit is fast (this is what end_session hits when session had
// no DB writes).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStorageRepo, commitStorage, getStorageLog } from "./dist/storage-git.js";
import { openDatabase } from "./dist/db.js";
import { resolveProject } from "./dist/project.js";

function freshProject() {
  const ws = mkdtempSync(join(tmpdir(), "agit-perf-"));
  spawnSync("git", ["init", "-q"], { cwd: ws });
  return { ws, project: resolveProject(ws) };
}

function measure(label, fn, iters = 10) {
  for (let i = 0; i < 2; i++) fn(); // warmup
  const start = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const elapsedNs = Number(process.hrtime.bigint() - start);
  const perCall = elapsedNs / iters / 1e6;
  console.log(`  ${label.padEnd(50)} ${perCall.toFixed(2)}ms × ${iters}`);
  return perCall;
}

// 1. Cold init cost. Runs once per project; acceptable up to ~200ms.
console.log("\nCold init cost (one-time, per project):");
{
  const timings = [];
  for (let i = 0; i < 5; i++) {
    const sp = mkdtempSync(join(tmpdir(), "agit-ci-"));
    const start = process.hrtime.bigint();
    ensureStorageRepo(sp);
    timings.push(Number(process.hrtime.bigint() - start) / 1e6);
    rmSync(sp, { recursive: true, force: true });
  }
  const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
  console.log(`  avg over 5 cold inits: ${avg.toFixed(1)}ms (range ${Math.min(...timings).toFixed(1)}-${Math.max(...timings).toFixed(1)})`);
  if (avg > 500) console.log("  WARN: cold init > 500ms");
}

// 2. Warm ensure (existing repo — what every server start incurs).
console.log("\nWarm ensure (every server start):");
{
  const { ws, project } = freshProject();
  measure("ensureStorageRepo on already-initialized repo", () => {
    ensureStorageRepo(project.storagePath);
  }, 20);
  rmSync(ws, { recursive: true, force: true });
}

// 3. Commit with small change (the common case — one DB row touched).
console.log("\nCommit with small changes:");
{
  const { ws, project } = freshProject();
  const db = openDatabase(project.dbPath);
  db.prepare("INSERT INTO git_state(repo_id,canonical_branch,onboarding_sha) VALUES('default','main','abc')").run();
  let counter = 0;
  measure("commit after single-row write", () => {
    db.prepare("INSERT INTO field_notes(category,observation,session_id,follow_up) VALUES('anomaly',?,'s','open')").run(`note ${counter++}`);
    commitStorage(project.storagePath, `perf ${counter}`);
  }, 10);
  db.close();
  rmSync(ws, { recursive: true, force: true });
}

// 4. No-op commit (this is what end_session hits when nothing was written).
console.log("\nNo-op commit (common at end_session):");
{
  const { ws, project } = freshProject();
  const db = openDatabase(project.dbPath);
  db.prepare("INSERT INTO git_state(repo_id,canonical_branch,onboarding_sha) VALUES('default','main','abc')").run();
  db.close();
  // First commit to establish a state.
  commitStorage(project.storagePath, "baseline");
  measure("commit with no changes (short-circuit)", () => {
    commitStorage(project.storagePath, "no-op perf");
  }, 20);
  rmSync(ws, { recursive: true, force: true });
}

// 5. Commit after materializer-scale change (~20 files touched).
console.log("\nCommit after materializer-scale change (20 files):");
{
  const { ws, project } = freshProject();
  // Seed — one initial commit so later commits aren't against empty tree.
  writeFileSync(join(project.storagePath, "seed.txt"), "x");
  commitStorage(project.storagePath, "seed");
  measure("commit after touching 20 files", () => {
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(project.storagePath, `page${i}.md`), `# page ${i}\n${Math.random()}`);
    }
    commitStorage(project.storagePath, "perf many-files");
  }, 5);
  rmSync(ws, { recursive: true, force: true });
}

// 6. getStorageLog with 100 commits.
console.log("\nLog query on populated history (100 commits):");
{
  const { ws, project } = freshProject();
  for (let i = 0; i < 100; i++) {
    writeFileSync(join(project.storagePath, `c${i}.txt`), `${i}`);
    commitStorage(project.storagePath, `commit ${i}`);
  }
  measure("getStorageLog(limit=20)", () => getStorageLog(project.storagePath, 20), 20);
  measure("getStorageLog(limit=100)", () => getStorageLog(project.storagePath, 100), 20);
  rmSync(ws, { recursive: true, force: true });
}

console.log("\nPerf notes:");
console.log("  - Cold init runs ONCE per project, not per session.");
console.log("  - No-op commit is the hot path at end_session and should dominate.");
console.log("  - Small-change commit is the hot path at phase gates.");
console.log("  - Materializer-scale commit is rare but bounds worst case.");
