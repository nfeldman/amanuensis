// Smoke test: initialize a fresh DB via the server's openDatabase, then
// hit each tool group with a representative call. This exercises:
//   - schema.sql loading + init idempotency (re-open)
//   - session supplementary table
//   - subsystems companion table
//   - every handler's SQL compiles against the real schema
//
// This is NOT a full MCP integration test; it drives tools directly to
// catch regressions without needing a live transport. Run with:
//   node test-smoke.mjs
import { rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./dist/db.js";
import { projectTools } from "./dist/tools/project.js";
import { gitTools } from "./dist/tools/git.js";
import { subsystemTools } from "./dist/tools/subsystems.js";
import { concernTools } from "./dist/tools/concerns.js";
import { fileTools } from "./dist/tools/files.js";
import { dispositionTools } from "./dist/tools/dispositions.js";
import { findingTools } from "./dist/tools/findings.js";
import { fieldNoteTools } from "./dist/tools/field-notes.js";
import { vocabularyTools } from "./dist/tools/vocabulary.js";
import { xrefTools } from "./dist/tools/xrefs.js";
import { contradictionTools } from "./dist/tools/contradictions.js";
import { loggingTools } from "./dist/tools/logging.js";
import { lockTools } from "./dist/tools/locks.js";
import { staleTools } from "./dist/tools/stale.js";
import { dispatchTools } from "./dist/tools/dispatch.js";
import { dashboardTools } from "./dist/tools/dashboard.js";
import { seamTools } from "./dist/tools/seams.js";
import { artifactTools } from "./dist/tools/artifacts.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { diagnosticityTools } from "./dist/tools/diagnosticity.js";
import { storageHistoryTools } from "./dist/tools/storage-history.js";
import { ensureStorageRepo } from "./dist/storage-git.js";

const TMP = join(tmpdir(), `amanuensis-smoke-${process.pid}`);
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
// Init the smoke TMP as a git repo so commit_phase_gate / get_storage_history
// exercise their real code paths against a real repo.
ensureStorageRepo(TMP);

const project = {
  workspacePath: TMP,
  projectKey: "test/smoke",
  storagePath: TMP,
  dbPath: join(TMP, "memory.db"),
  storageGitReady: true,
};
const db = openDatabase(project.dbPath);
const ctx = { project, db, sessionId: null };

const allTools = new Map(
  [
    ...projectTools, ...gitTools, ...subsystemTools, ...concernTools, ...fileTools,
    ...dispositionTools, ...findingTools, ...fieldNoteTools, ...vocabularyTools,
    ...xrefTools, ...contradictionTools, ...loggingTools, ...lockTools,
    ...staleTools, ...dispatchTools, ...dashboardTools,
    ...seamTools, ...artifactTools, ...evidenceTools, ...diagnosticityTools,
    ...storageHistoryTools,
  ].map((t) => [t.name, t]),
);

let passed = 0;
let failed = 0;
function run(name, args, predicate) {
  const t = allTools.get(name);
  if (!t) {
    console.error(`MISSING ${name}`);
    failed++;
    return null;
  }
  let result;
  try {
    result = t.handler(args, ctx);
  } catch (e) {
    console.error(`THREW ${name}: ${e.message}`);
    failed++;
    return null;
  }
  if (predicate && !predicate(result)) {
    console.error(`FAIL   ${name}: ${JSON.stringify(result).slice(0, 200)}`);
    failed++;
    return null;
  }
  passed++;
  console.log(`  ok   ${name}`);
  return result;
}

// 1. Project + session
run("get_project_info", {}, (r) => r.project_key === "test/smoke" && r.db_exists === true);
const session = run("start_session", { intent: "smoke-test" }, (r) => r.ok && r.session_id);
ctx.sessionId = session.session_id;
run("get_session", {}, (r) => r.intent === "smoke-test");

// 2. Git state
run("set_git_state", {
  canonical_branch: "main",
  onboarding_sha: "deadbeef",
  branch_convention: "trunk-based",
  detected_branches: ["main", "feature/x"],
}, (r) => r.ok);
run("get_git_state", {}, (r) => r.canonical_branch === "main" && Array.isArray(r.detected_branches));

// 3. Subsystems
run("upsert_subsystem", {
  id: "B-01",
  name: "Job Scheduler",
  status: "unmapped",
  scope: "scheduler/**",
  jump_in_reading: "scheduler/main.ts",
  notes: "initial",
}, (r) => r.ok);
run("upsert_subsystem", { id: "B-02", name: "Auth", status: "unmapped" }, (r) => r.ok);
run("list_subsystems", {}, (r) => Array.isArray(r) && r.length === 2);
run("update_subsystem_status", { id: "B-01", status: "scoping" }, (r) => r.previous_status === "unmapped");
// B-02 stays at scoping to exercise gate rejection (see end of file).
run("update_subsystem_status", { id: "B-02", status: "scoping" }, (r) => r.previous_status === "unmapped");

// 4. Concerns
run("add_concern", { code: "CC-1", category: "cache", origin: "seeded", notes: "cache coherence" }, (r) => r.ok);
run("add_concern", { code: "CB-1", category: "concurrency", origin: "seeded" }, (r) => r.ok);
run("list_concerns", { status_filter: "active" }, (r) => Array.isArray(r) && r.length === 2);

// 5. Files — must come before advancing B-01 to 'structural' (phase prerequisite).
run("add_files_to_scope", {
  subsystem_id: "B-01",
  ref_sha: "deadbeef",
  files: [
    { file_path: "scheduler/main.ts", why_in_scope: "entry", classification: "examined" },
    { file_path: "scheduler/queue.ts", why_in_scope: "state", classification: "candidate" },
  ],
}, (r) => r.ok && r.added === 2);
run("update_file_classification", {
  subsystem_id: "B-01", file_path: "scheduler/queue.ts", classification: "examined", ref_sha: "deadbeef",
}, (r) => r.ok);
run("get_subsystem_files", { subsystem_id: "B-01", classification_filter: "examined" }, (r) => r.length === 2);

// Advance B-01 through the survey pipeline. File ledger must exist before
// 'structural', and the subsystem-survey artifact must be registered before
// 'concerns' — both are now enforced server-side.
run("update_subsystem_status", { id: "B-01", status: "structural" }, (r) => r.previous_status === "scoping");
run("register_artifact", {
  path: "B-01-survey.md", kind: "subsystem-survey", subsystem_id: "B-01",
}, (r) => r.ok);
run("update_subsystem_status", { id: "B-01", status: "concerns" }, (r) => r.previous_status === "structural");

// 6. Dispositions
run("set_disposition", {
  subsystem_id: "B-01",
  concern_code: "CC-1",
  classification: "ruled-out",
  evidence: "scheduler/main.ts:runJob@deadbeef",
  evidence_quality: "code-verified",
  linchpin_dependent: false,
  rationale: "no cache in this subsystem",
  ref_sha: "deadbeef",
  pass_type: "survey",
}, (r) => r.ok);
run("get_dispositions", { subsystem_id: "B-01" }, (r) => r.length === 1);
run("get_concern_coverage", {}, (r) => Array.isArray(r) && r.length === 4); // 2 concerns × 2 subsystems

// 7. Findings
run("add_finding", {
  finding_id: "B01-1",
  subsystem_id: "B-01",
  symptom: "job leaks",
  root_cause: "goroutine abandoned on error path",
  severity: "HIGH",
  status: "confirmed-bug",
  primary_files: ["scheduler/main.ts:runJob@deadbeef"],
  business_context: "affects throughput under failure",
  ref_sha: "deadbeef",
  pass_type: "survey",
}, (r) => r.ok);
run("update_finding_status", { finding_id: "B01-1", status: "fixed", fix_location: "scheduler/main.ts:runJob@cafef00d" }, (r) => r.previous_status === "confirmed-bug");
run("get_findings", {}, (r) => r.length === 1);
run("get_finding_summary", {}, (r) => r.length === 1 && r[0].fixed === 1);

// 8. Field notes
const fn = run("add_field_note", {
  category: "anomaly",
  observation: "queue.ts has stale TODO markers",
  location: "scheduler/queue.ts@deadbeef",
}, (r) => r.ok && typeof r.id === "number");
run("get_field_notes", { category: "anomaly" }, (r) => r.length === 1);
run("resolve_field_note", { id: fn.id, follow_up: "dismissed" }, (r) => r.ok);

// 9. Vocabulary
run("define_term", { term: "runJob", gloss: "the scheduler's per-job entry point", subsystem_id: "B-01" }, (r) => r.ok && r.action === "inserted");
run("define_term", { term: "runJob", gloss: "refined gloss", subsystem_id: "B-01" }, (r) => r.action === "updated");
run("lookup_term", { term: "runJob" }, (r) => r !== null && r.gloss === "refined gloss");
run("list_vocabulary", { subsystem_id: "B-01" }, (r) => r.length === 1);

// 10. Xrefs
run("add_xref", { from_id: "B-01", to_id: "B-02", relationship: "data-flow", strength: "observed" }, (r) => r.ok);
run("get_xrefs", { subsystem_id: "B-01" }, (r) => r.length === 1);

// 11. Contradictions — need a second finding to contradict with
// This finding comes from an adversarial pass, so B-01 must advance to
// `adversarial` status before the server accepts the write.
run("update_subsystem_status", { id: "B-01", status: "adversarial" }, (r) => r.previous_status === "concerns");
run("add_finding", {
  finding_id: "B01-2",
  subsystem_id: "B-01",
  symptom: "same code path",
  root_cause: "distinct analysis",
  severity: "LOW",
  status: "confirmed-acceptable",
  ref_sha: "deadbeef",
  pass_type: "adversarial",
}, (r) => r.ok);
const contra = run("add_contradiction", {
  finding_a: "B01-1",
  finding_b: "B01-2",
  conflict_type: "classification-conflict",
  shared_location: "scheduler/main.ts:runJob@deadbeef",
}, (r) => r.ok && typeof r.id === "number");
run("resolve_contradiction", { id: contra.id, resolution: "scope-distinction", scope_note: "different code paths" }, (r) => r.ok);
run("get_contradictions", { resolution_filter: "scope-distinction" }, (r) => r.length === 1);

// 12. Logging
run("log_access", { entry_id: "B-01", entry_tier: 1, trigger: "smoke" }, (r) => r.ok);
run("log_query", { question: "what runs scheduler?", fields_hit: ["what", "how"], tier_reached: 1 }, (r) => r.ok);
run("get_field_demand", {}, (r) => Array.isArray(r));

// 13. Locks
run("acquire_lock", { artifact_path: "master-plan.md", holder_id: "A" }, (r) => r.ok);
run("acquire_lock", { artifact_path: "master-plan.md", holder_id: "B" }, (r) => r.ok === false && r.held_by === "A");
run("release_lock", { artifact_path: "master-plan.md", holder_id: "A" }, (r) => r.ok);
run("get_active_locks", {}, (r) => Array.isArray(r) && r.length === 0);

// 14. Stale
run("get_stale_backlog", {}, (r) => Array.isArray(r));

// 15. Dispatch
run("log_dispatch", { session_id: ctx.sessionId, seq: 1, role: "explore", file_path: "_meta/prompts/smoke.md" }, (r) => r.ok);
run("complete_dispatch", { session_id: ctx.sessionId, seq: 1, artifacts_written: ["docs/foo.md"] }, (r) => r.ok);
run("get_dispatch_history", {}, (r) => r.length === 1);

// 16. Dashboard
run("get_dashboard", {}, (r) => r.project_key === "test/smoke" && r.subsystem_count === 2);
run("get_hot_subsystems", {}, (r) => Array.isArray(r));

// 17. Seams
run("upsert_seam", {
  id: "SM-01",
  shared_object: "jobs_queue",
  shared_object_kind: "queue",
  party_a: "B-01",
  party_b: "B-02",
  a_writes: "enqueue job",
  b_reads: "dequeue",
  ordering_assumption: "fifo",
  cardinality: "single-consumer",
  staleness_tolerance: "strong-consistent",
}, (r) => r.ok);
run("list_seams", {}, (r) => r.length === 1);
run("list_seams", { subsystem_id: "B-01" }, (r) => r.length === 1);
run("get_seam_assessability", {}, (r) => Array.isArray(r) && r.length === 1 && r[0].assessable === 0);

// 18. Artifacts — register without file, then rehash after writing one
{
  const path = "entry-point.md";
  run("register_artifact", { path, kind: "entry-point" }, (r) => r.ok && r.content_hash === null);
  writeFileSync(`${TMP}/${path}`, "# Entry Point\n");
  run("rehash_artifact", { path, ref_sha: "deadbeef" }, (r) => r.ok && typeof r.content_hash === "string");
  run("list_artifacts", { kind: "entry-point" }, (r) => r.length === 1 && r[0].bytes > 0);
}

// 19. Evidence
const ev1 = run("add_evidence", {
  file_path: "scheduler/main.ts",
  symbol: "runJob",
  line_range: "10-42",
  ref_sha: "deadbeef",
  kind: "code-verified",
  note: "defer release covers exception path",
}, (r) => r.ok && typeof r.id === "number");
const ev2 = run("add_evidence", {
  file_path: "scheduler/main.ts",
  symbol: "runJob",
  ref_sha: "deadbeef",
  kind: "comment-asserted",
  note: "claim in docstring",
}, (r) => r.ok);
run("attach_evidence_to_disposition", {
  subsystem_id: "B-01", concern_code: "CC-1", evidence_id: ev1.id, role: "supports",
}, (r) => r.ok);
run("attach_evidence_to_finding", {
  finding_id: "B01-1", evidence_id: ev1.id, role: "root-cause",
}, (r) => r.ok);
run("get_disposition_evidence", { subsystem_id: "B-01", concern_code: "CC-1" }, (r) => r.length === 1 && r[0].role === "supports");
run("get_finding_evidence", { finding_id: "B01-1" }, (r) => r.length === 1);
run("get_evidence", { file_path: "scheduler/main.ts" }, (r) => r.length === 2);

// 20. Diagnosticity matrix
const mtx = run("open_diagnosticity_matrix", {
  subsystem_id: "B-01",
  symptom: "stale read after write",
  shared_location: "scheduler/main.ts:runJob@deadbeef",
  concern_codes: ["CC-1", "CB-1"],
  evidence_ids: [ev1.id, ev2.id],
}, (r) => r.ok && typeof r.matrix_id === "number");
run("record_diagnosticity_verdict", {
  matrix_id: mtx.matrix_id, concern_code: "CC-1", evidence_id: ev1.id, verdict: "contradicts",
}, (r) => r.ok);
run("record_diagnosticity_verdict", {
  matrix_id: mtx.matrix_id, concern_code: "CB-1", evidence_id: ev1.id, verdict: "consistent",
}, (r) => r.ok);
run("resolve_diagnosticity_matrix", {
  matrix_id: mtx.matrix_id, outcome: "resolved", leading_concern: "CB-1",
  linchpin_note: "depends on docstring remaining accurate",
}, (r) => r.ok);
run("get_diagnosticity_matrix", { matrix_id: mtx.matrix_id }, (r) => r.session.outcome === "resolved" && r.cells.length === 2);
run("list_diagnosticity_matrices", { outcome: "resolved" }, (r) => r.length === 1);

// 21. Storage-dir git history — covers commit_phase_gate + get_storage_history
//     Requires ensureStorageRepo() was called above to init TMP as a git repo.
run("commit_phase_gate", { label: "smoke: mid-session" }, (r) => typeof r.committed === "boolean");
run("get_storage_history", { limit: 5 }, (r) => r.is_git_repo === true && Array.isArray(r.commits) && r.commits.length >= 1);

// 22. Session lifecycle — end_session auto-commits, so the history should grow.
run("list_sessions", { state: "active" }, (r) => r.length === 1);
run("end_session", { session_id: ctx.sessionId, outcome: "completed" }, (r) => r.ok);
run("list_sessions", { state: "ended" }, (r) => r.length === 1 && r[0].outcome === "completed");
run("get_storage_history", { limit: 20 }, (r) => r.commits.some((c) => c.message.includes("session")));

// Re-open DB to verify init is idempotent
db.close();
const db2 = openDatabase(project.dbPath);
const row = db2.prepare("SELECT COUNT(*) AS n FROM findings").get();
if (row.n !== 2) { console.error("FAIL idempotent reopen: findings lost"); failed++; }
else { console.log("  ok   reopen idempotent"); passed++; }
db2.close();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
