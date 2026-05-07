#!/usr/bin/env node
// Coarse performance ceilings for CI.
//
// Philosophy: catch *catastrophic* regressions (≥10× slowdown) without
// flaking on shared-runner jitter. Each ceiling is ~10-30× the measured
// per-call cost from a quiet local run; git-subprocess paths use a
// higher floor (seconds) because shared runners can stall on IO.
//
// A regression that falls between 2-3× and 10× of the baseline will not
// fire the ceiling; those are caught by the measurement-only script
// (test-perf-tier2.mjs) run manually during review. The goal here is to
// prevent order-of-magnitude degradations from shipping.
//
// If a ceiling is tripped, diagnose by running test-perf-tier2.mjs
// locally — the numbers there will show which operation slowed and by
// how much.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./dist/db.js";
import { resolveProject } from "./dist/project.js";
import { projectTools } from "./dist/tools/project.js";
import { subsystemTools } from "./dist/tools/subsystems.js";
import { concernTools } from "./dist/tools/concerns.js";
import { dispositionTools } from "./dist/tools/dispositions.js";
import { findingTools } from "./dist/tools/findings.js";
import { fieldNoteTools } from "./dist/tools/field-notes.js";
import { dashboardTools } from "./dist/tools/dashboard.js";
import { storageHistoryTools } from "./dist/tools/storage-history.js";
import { ensureStorageRepo, commitStorage } from "./dist/storage-git.js";
import { fileTools } from "./dist/tools/files.js";
import { artifactTools } from "./dist/tools/artifacts.js";

const allTools = new Map(
  [
    ...projectTools,
    ...subsystemTools,
    ...concernTools,
    ...dispositionTools,
    ...findingTools,
    ...fieldNoteTools,
    ...dashboardTools,
    ...storageHistoryTools,
    ...fileTools,
    ...artifactTools,
  ].map((td) => [td.name, td]),
);
function call(name, args, ctx) {
  const td = allTools.get(name);
  if (!td) throw new Error(`no such tool: ${name}`);
  return td.handler(args, ctx);
}

// Measure by median of N iterations (after warmup). Median is more
// robust than mean to CI noise spikes.
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function measureMs(fn, { warmup = 3, iters = 10 } = {}) {
  for (let i = 0; i < warmup; i++) fn();
  const samples = [];
  for (let i = 0; i < iters; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return median(samples);
}

let passed = 0;
let failed = 0;
function ceiling(label, ceilingMs, fn) {
  const actual = measureMs(fn);
  const withinLimit = actual <= ceilingMs;
  const marker = withinLimit ? "ok  " : "FAIL";
  const pct = ((actual / ceilingMs) * 100).toFixed(0);
  console.log(
    `  ${marker} ${label.padEnd(50)} median=${actual.toFixed(2)}ms  ceiling=${ceilingMs}ms  (${pct}%)`,
  );
  if (withinLimit) passed++;
  else failed++;
}

// ---- fixture ----
// A populated workspace, large enough to exercise the query paths but
// quick enough to build in under a second. Larger scales are left to
// the measurement-only scripts.
const ws = mkdtempSync(join(tmpdir(), "perf-ceil-"));
spawnSync("git", ["init", "-q"], { cwd: ws });
const project = resolveProject(ws);
const db = openDatabase(project.dbPath);
const ctx = { project, db, sessionId: null };

const sess = call("start_session", { intent: "ceilings" }, ctx);
ctx.sessionId = sess.session_id;

for (let i = 0; i < 20; i++) {
  const id = `B-${String(i).padStart(2, "0")}`;
  call("upsert_subsystem", { id, name: `Subsystem ${i}` }, ctx);
  call("update_subsystem_status", { id, status: "scoping" }, ctx);
  call("add_files_to_scope", { subsystem_id: id, ref_sha: "ceil-ref", files: [{ file_path: `src/${id}/index.ts`, why_in_scope: "ceiling fixture" }] }, ctx);
  call("update_subsystem_status", { id, status: "structural" }, ctx);
  call("register_artifact", { path: `${id}-survey.md`, kind: "subsystem-survey", subsystem_id: id }, ctx);
  call("update_subsystem_status", { id, status: "concerns" }, ctx);
}
for (let c = 0; c < 25; c++) {
  call("add_concern", { code: `CC-${c}`, category: "cache", origin: "seeded" }, ctx);
}
// Pre-populate access_log so hot_subsystems has work to do.
const logStmt = db.prepare(
  "INSERT INTO access_log (entry_id, entry_tier, accessed_at) VALUES (?, ?, datetime('now','-'||?||' seconds'))",
);
db.transaction(() => {
  for (let i = 0; i < 5000; i++) {
    logStmt.run(`B-${String(i % 20).padStart(2, "0")}`, 0, i);
  }
})();

console.log("SQLite write / read ceilings:");

let setDispCounter = 0;
ceiling("set_disposition", 10, () => {
  const i = setDispCounter++;
  call(
    "set_disposition",
    {
      subsystem_id: `B-${String(i % 20).padStart(2, "0")}`,
      concern_code: `CC-${i % 25}`,
      classification: "ruled-out",
      evidence: "x",
      evidence_quality: "code-verified",
      rationale: "r",
      ref_sha: "abc",
      pass_type: "survey",
    },
    ctx,
  );
});

let findingCounter = 0;
ceiling("add_finding", 10, () => {
  const n = findingCounter++;
  call(
    "add_finding",
    {
      finding_id: `F-${n}`,
      subsystem_id: `B-${String(n % 20).padStart(2, "0")}`,
      symptom: "s",
      root_cause: "r",
      severity: "LOW",
      status: "confirmed-bug",
      ref_sha: "abc",
      pass_type: "survey",
    },
    ctx,
  );
});

let noteCounter = 0;
ceiling("add_field_note", 5, () => {
  call("add_field_note", { category: "anomaly", observation: `n${noteCounter++}` }, ctx);
});

let updCounter = 0;
ceiling("update_subsystem_status (no-op transition)", 5, () => {
  // Re-write the same status — exercises the guard's SELECT path.
  const id = `B-${String(updCounter++ % 20).padStart(2, "0")}`;
  call("update_subsystem_status", { id, status: "concerns" }, ctx);
});

ceiling("get_dashboard", 10, () => call("get_dashboard", {}, ctx));

ceiling("get_concern_coverage (20 subsystems × 25 concerns)", 100, () =>
  call("get_concern_coverage", {}, ctx),
);

ceiling("get_hot_subsystems (5k access_log rows)", 100, () =>
  call("get_hot_subsystems", {}, ctx),
);

ceiling("get_finding_summary (all subsystems)", 50, () =>
  call("get_finding_summary", {}, ctx),
);

console.log("\nGit-subprocess ceilings (higher floor — subprocess IO is noisy):");

// A second storage dir for measuring cold init without interfering with
// the already-initialized `project.storagePath`.
const coldSp = mkdtempSync(join(tmpdir(), "perf-ceil-cold-"));
ceiling("ensureStorageRepo (cold init)", 3000, () => {
  // We can only cold-init once per storage dir; use a fresh tempdir
  // each iteration. Accept the mkdir cost in the measurement — it's
  // inherent to the operation.
  const fresh = mkdtempSync(join(tmpdir(), "perf-ceil-col-"));
  ensureStorageRepo(fresh);
  rmSync(fresh, { recursive: true, force: true });
});
rmSync(coldSp, { recursive: true, force: true });

ceiling("ensureStorageRepo (warm — already initialized)", 500, () =>
  ensureStorageRepo(project.storagePath),
);

let commitCounter = 0;
ceiling("commitStorage (small change)", 2000, () => {
  // Touch the DB so there's something to commit.
  db.prepare("INSERT INTO field_notes(category, observation) VALUES ('pattern', ?)").run(
    `perf-${commitCounter++}`,
  );
  commitStorage(project.storagePath, `perf ${commitCounter}`);
});

ceiling("commitStorage (no-op — nothing changed)", 1500, () => {
  commitStorage(project.storagePath, "no-op perf");
});

ceiling("commit_phase_gate via MCP tool", 2000, () => {
  db.prepare("INSERT INTO field_notes(category, observation) VALUES ('pattern', ?)").run(
    `mcp-${commitCounter++}`,
  );
  call("commit_phase_gate", { label: `perf mcp ${commitCounter}` }, ctx);
});

ceiling("get_storage_history (limit 20)", 500, () =>
  call("get_storage_history", { limit: 20 }, ctx),
);

// ---- cleanup ----
db.close();
rmSync(ws, { recursive: true, force: true });
rmSync(project.storagePath, { recursive: true, force: true });

console.log(`\n${passed} within ceiling, ${failed} over.`);
if (failed > 0) {
  console.error(
    "\nCeiling tripped. Run `node test-perf-tier2.mjs` locally for detailed\n" +
      "per-operation numbers. A trip means an operation is ≥10× slower than\n" +
      "the quiet-local baseline, which almost always indicates a real\n" +
      "regression (missing index, accidental N+1, unsupervised loop).",
  );
}
process.exit(failed ? 1 : 0);
