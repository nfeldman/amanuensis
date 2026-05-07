#!/usr/bin/env node
// Adversarial perf review — populate a DB and measure hot paths.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openDatabase } from "./dist/db.js";

const ws = mkdtempSync(join(tmpdir(), "aman-perf-"));
spawnSync("git", ["init", "-q"], { cwd: ws });
const dbPath = join(ws, "memory.db");
const db = openDatabase(dbPath);

// Populate realistic scale: 40 subsystems, 50 concerns, 2000 dispositions,
// 1000 findings, 5000 file-ledger rows, 500 field notes, 100 seams,
// 3000 xrefs, 2000 evidence rows, 20k access_log rows.
console.log("Populating scale fixture …");
const t0 = Date.now();

db.exec("BEGIN");
db.prepare("INSERT INTO git_state(repo_id,canonical_branch,onboarding_sha) VALUES('default','main','abc')").run();
for (let i = 0; i < 40; i++) {
  const id = `B-${String(i).padStart(2,"0")}`;
  db.prepare("INSERT INTO subsystems(id,name,status,layer,scope,jump_in_reading,notes) VALUES(?,?,?,?,?,?,?)").run(id,`Subsystem ${i}`,"concerns","app","scope","read.md","note");
  for (let t = 0; t < 3; t++) {
    db.prepare("INSERT INTO entries(id,tier,subsystem_id,updated_at) VALUES(?,?,?,datetime('now'))").run(id,t,id);
  }
  for (let f = 0; f < 125; f++) {
    db.prepare("INSERT INTO file_ledger(subsystem_id,file_path,classification,ref_sha) VALUES(?,?,?,?)").run(id,`src/s${i}/f${f}.ts`,"examined","sha");
  }
}
for (let c = 0; c < 50; c++) {
  db.prepare("INSERT INTO concerns(code,category,origin,notes,status) VALUES(?,?,?,?,'active')").run(`CC-${c}`,"cache","seeded","probe");
}
for (let d = 0; d < 2000; d++) {
  const ss = `B-${String(d % 40).padStart(2,"0")}`;
  const cc = `CC-${d % 50}`;
  db.prepare("INSERT OR REPLACE INTO dispositions(subsystem_id,concern_code,classification,evidence_quality,rationale) VALUES(?,?,?,?,?)").run(ss,cc,"ruled-out","code-verified","rationale");
}
for (let f = 0; f < 1000; f++) {
  const ss = `B-${String(f % 40).padStart(2,"0")}`;
  db.prepare("INSERT INTO findings(finding_id,subsystem_id,symptom,root_cause,severity,status,primary_files,session_id) VALUES(?,?,?,?,?,?,?,?)").run(`F-${f}`,ss,"symptom","root cause",f%4===0?"CRITICAL":"MEDIUM","confirmed-bug","a.ts","s1");
}
for (let n = 0; n < 500; n++) {
  db.prepare("INSERT INTO field_notes(category,observation,session_id,follow_up) VALUES(?,?,?,?)").run("anomaly",`note ${n}`,"s1",n%3===0?"open":"closed");
}
for (let e = 0; e < 2000; e++) {
  db.prepare("INSERT INTO evidence(kind,file_path,symbol,line_range,ref_sha,note) VALUES(?,?,?,?,?,?)").run("code-verified",`src/f${e}.ts`,`sym${e}`,"1-20","sha","note");
}
for (let x = 0; x < 3000; x++) {
  const from = `B-${String(x%40).padStart(2,"0")}`, to = `B-${String((x+1)%40).padStart(2,"0")}`;
  if (from===to) continue;
  try { db.prepare("INSERT INTO xrefs(from_id,to_id,relationship) VALUES(?,?,?)").run(from,to,`rel-${x%10}`); } catch {}
}
for (let a = 0; a < 20000; a++) {
  db.prepare("INSERT INTO access_log(entry_id,entry_tier,accessed_at) VALUES(?,?,datetime('now','-'||?||' seconds'))").run(`B-${String(a%40).padStart(2,"0")}`,0,a);
}
db.exec("COMMIT");
console.log(`Populated in ${Date.now()-t0}ms`);

// Measure hot-path queries.
function measure(label, fn, iters=50) {
  // warmup
  for (let i = 0; i < 3; i++) fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const elapsedNs = Number(process.hrtime.bigint() - start);
  const perCall = elapsedNs / iters / 1e6;
  console.log(`  ${label}: ${perCall.toFixed(3)}ms × ${iters} iters`);
  return perCall;
}

console.log("\nHot-path latencies:");
measure("get_dashboard (6 queries)", () => {
  db.prepare("SELECT canonical_branch,onboarding_sha,last_checked_sha FROM git_state WHERE repo_id='default'").get();
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='subsystems'").get();
  db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='mapped' THEN 1 ELSE 0 END) AS mapped FROM subsystems").get();
  db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='confirmed-bug' THEN 1 ELSE 0 END) AS open_bugs FROM findings").get();
  db.prepare("SELECT COUNT(*) AS n FROM entries WHERE stale=1").get();
  db.prepare("SELECT COUNT(*) AS n FROM field_notes WHERE follow_up='open'").get();
  db.prepare("SELECT COUNT(*) AS n FROM contradictions WHERE resolution='unresolved'").get();
});
measure("list_subsystems", () => {
  db.prepare("SELECT id,name,status,layer FROM subsystems ORDER BY id").all();
});
measure("list_concerns (all 50)", () => {
  db.prepare("SELECT code,category,status FROM concerns WHERE status='active' ORDER BY code").all();
});
measure("get_findings(subsystem=B-00)", () => {
  db.prepare("SELECT * FROM findings WHERE subsystem_id=? ORDER BY severity,finding_id").all("B-00");
});
measure("get_concern_coverage view", () => {
  db.prepare("SELECT * FROM concern_coverage").all();
});
measure("hot_subsystems view (20k access_log)", () => {
  db.prepare("SELECT entry_id,access_count,last_accessed,heat FROM hot_subsystems LIMIT 5").all();
});
measure("finding_summary view (all subsystems)", () => {
  db.prepare("SELECT * FROM finding_summary").all();
});
measure("add_field_note (write)", () => {
  db.prepare("INSERT INTO field_notes(category,observation,session_id,follow_up) VALUES('anomaly','x','s1','open')").run();
}, 100);

// EXPLAIN QUERY PLAN on the most complex view
console.log("\nQuery plan for concern_coverage:");
const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM concern_coverage").all();
for (const row of plan) console.log("  " + JSON.stringify(row));

console.log("\nQuery plan for hot_subsystems:");
const plan2 = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM hot_subsystems LIMIT 5").all();
for (const row of plan2) console.log("  " + JSON.stringify(row));

// DB file size
const size = db.prepare("SELECT page_count*page_size AS bytes FROM pragma_page_count(), pragma_page_size()").get();
console.log(`\nDB size: ${(size.bytes/1024/1024).toFixed(1)} MB`);

db.close();
rmSync(ws, { recursive: true, force: true });
