#!/usr/bin/env node
// Correctness probes for the subsystem-priority feature:
//
//   - Schema migration adds `priority` to a pre-migration DB without
//     losing data.
//   - priority accepts null and positive integers; CHECK rejects <=0.
//   - upsert_subsystem COALESCEs omitted priority (preserves existing).
//   - set_subsystem_priority round-trips and clears.
//   - list_subsystems sorts by (null-last, priority, layer, id).
//   - compare_conspectuses reports Kendall τ and top-K agreement
//     correctly on a variety of rankings.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openDatabase } from "./dist/db.js";
import { resolveProject } from "./dist/project.js";
import { subsystemTools } from "./dist/tools/subsystems.js";
import { compareTools } from "./dist/tools/compare.js";

const toolMap = new Map([...subsystemTools, ...compareTools].map((td) => [td.name, td]));
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

function freshCtx() {
  const ws = mkdtempSync(join(tmpdir(), "prio-"));
  spawnSync("git", ["init", "-q"], { cwd: ws });
  const project = resolveProject(ws);
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  return {
    ctx,
    cleanup: () => {
      db.close();
      rmSync(ws, { recursive: true, force: true });
      rmSync(project.storagePath, { recursive: true, force: true });
    },
  };
}

// ---- Migration: pre-priority DB gets column added on open ----
t("migration adds priority column to a pre-priority DB without data loss", () => {
  const ws = mkdtempSync(join(tmpdir(), "prio-mig-"));
  spawnSync("git", ["init", "-q"], { cwd: ws });
  const project = resolveProject(ws);
  // Simulate a pre-migration DB by explicitly dropping the column (via
  // a raw connection, bypassing openDatabase's migrations).
  //
  // SQLite supports DROP COLUMN since 3.35. The runtime we ship with
  // better-sqlite3 is modern enough for that.
  const db = openDatabase(project.dbPath);
  db.prepare("INSERT INTO subsystems (id, name) VALUES ('B-01', 'Legacy')").run();
  db.close();
  const raw = new Database(project.dbPath);
  // better-sqlite3 ships SQLite 3.35+ where ALTER TABLE DROP COLUMN is
  // supported. If that ever regresses, this assertion will fire before
  // the test proceeds and the fix is to bump the shipped SQLite.
  // SQLite refuses DROP COLUMN when an index references that column,
  // so drop the index first. In production the migration hook
  // recreates the index on next open, so this order doesn't matter
  // there — it's just the test shortcut for building a pre-priority
  // DB from a fresh one.
  raw.exec("DROP INDEX IF EXISTS idx_subsystems_priority");
  raw.exec("ALTER TABLE subsystems DROP COLUMN priority");
  // Verify the column really is gone.
  const cols = raw.prepare("SELECT name FROM pragma_table_info('subsystems')").all();
  assert(
    !cols.some((c) => c.name === "priority"),
    "precondition failed: priority should be absent",
  );
  raw.close();
  // Now reopen via openDatabase — the migration should add the column.
  const db2 = openDatabase(project.dbPath);
  try {
    const cols2 = db2
      .prepare("SELECT name FROM pragma_table_info('subsystems')")
      .all();
    assert(
      cols2.some((c) => c.name === "priority"),
      "migration did not add priority column",
    );
    const row = db2.prepare("SELECT id, name, priority FROM subsystems WHERE id='B-01'").get();
    assert(row.id === "B-01" && row.name === "Legacy");
    assert(row.priority === null, "existing rows should have null priority");
    // Index also added.
    const idx = db2
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_subsystems_priority'")
      .get();
    assert(idx, "idx_subsystems_priority missing after migration");
  } finally {
    db2.close();
    rmSync(ws, { recursive: true, force: true });
    rmSync(project.storagePath, { recursive: true, force: true });
  }
});

// ---- CHECK constraint: priority > 0 ----
t("CHECK constraint rejects priority <= 0", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    call("upsert_subsystem", { id: "B-01", name: "ok", priority: 3 }, ctx);
    const bad = call(
      "upsert_subsystem",
      { id: "B-02", name: "bad", priority: 0 },
      ctx,
    );
    // The handler's own guard catches zero before hitting SQLite.
    assert(bad.ok === false, "priority=0 should be rejected by handler");
    // Negative — also rejected by the handler.
    const neg = call(
      "upsert_subsystem",
      { id: "B-03", name: "neg", priority: -5 },
      ctx,
    );
    assert(neg.ok === false, "priority=-5 should be rejected");
    // Verify neither was written.
    const rows = ctx.db.prepare("SELECT id FROM subsystems ORDER BY id").all();
    assert(rows.length === 1 && rows[0].id === "B-01");
  } finally { cleanup(); }
});

// ---- upsert COALESCE semantics ----
t("upsert preserves prior priority when the field is omitted", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    call("upsert_subsystem", { id: "B-01", name: "First", priority: 2 }, ctx);
    call("upsert_subsystem", { id: "B-01", name: "Renamed" }, ctx); // no priority
    const row = ctx.db.prepare("SELECT name, priority FROM subsystems WHERE id = ?").get("B-01");
    assert(row.name === "Renamed", `name should update, got: ${row.name}`);
    assert(row.priority === 2, `priority should be preserved, got: ${row.priority}`);
  } finally { cleanup(); }
});

// ---- set_subsystem_priority ----
t("set_subsystem_priority round-trips and reports previous", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    call("upsert_subsystem", { id: "B-01", name: "x" }, ctx);
    const r1 = call("set_subsystem_priority", { id: "B-01", priority: 3 }, ctx);
    assert(r1.ok);
    assert(r1.previous_priority === null && r1.new_priority === 3);
    const r2 = call("set_subsystem_priority", { id: "B-01", priority: 1 }, ctx);
    assert(r2.previous_priority === 3 && r2.new_priority === 1);
    const r3 = call("set_subsystem_priority", { id: "B-01", priority: null }, ctx);
    assert(r3.previous_priority === 1 && r3.new_priority === null);
  } finally { cleanup(); }
});

t("set_subsystem_priority rejects invalid values", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    call("upsert_subsystem", { id: "B-01", name: "x" }, ctx);
    const r1 = call("set_subsystem_priority", { id: "B-01", priority: 0 }, ctx);
    assert(!r1.ok);
    const r2 = call("set_subsystem_priority", { id: "B-01", priority: 1.5 }, ctx);
    assert(!r2.ok);
    // unknown subsystem
    const r3 = call("set_subsystem_priority", { id: "NONE", priority: 1 }, ctx);
    assert(!r3.ok && r3.error.includes("unknown"));
  } finally { cleanup(); }
});

// ---- list_subsystems sort order ----
t("list_subsystems sorts by priority ASC then layer then id, nulls last", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    call("upsert_subsystem", { id: "B-X", name: "x", layer: "z", priority: 3 }, ctx);
    call("upsert_subsystem", { id: "B-A", name: "a", layer: "a" }, ctx); // no priority
    call("upsert_subsystem", { id: "B-B", name: "b", layer: "a", priority: 1 }, ctx);
    call("upsert_subsystem", { id: "B-C", name: "c", layer: "a", priority: 2 }, ctx);
    const rows = call("list_subsystems", {}, ctx);
    const ids = rows.map((r) => r.id);
    // B-B (pri 1) → B-C (pri 2) → B-X (pri 3) → B-A (null, last).
    assert(
      JSON.stringify(ids) === JSON.stringify(["B-B", "B-C", "B-X", "B-A"]),
      `unexpected order: ${JSON.stringify(ids)}`,
    );
  } finally { cleanup(); }
});

// ---- compare_conspectuses: Kendall tau + top-K ----
t("compare reports Kendall τ of 1 for identical rankings", () => {
  const { ctx: a, cleanup: ca } = freshCtx();
  const { ctx: b, cleanup: cb } = freshCtx();
  try {
    for (const ctx of [a, b]) {
      call("upsert_subsystem", { id: "B-01", name: "x", priority: 1 }, ctx);
      call("upsert_subsystem", { id: "B-02", name: "y", priority: 2 }, ctx);
      call("upsert_subsystem", { id: "B-03", name: "z", priority: 3 }, ctx);
    }
    const r = call(
      "compare_conspectuses",
      { path_a: a.project.dbPath, path_b: b.project.dbPath },
      {},
    );
    assert(r.ok);
    assert(r.priorities.kendall_tau === 1, `tau: ${r.priorities.kendall_tau}`);
    assert(r.priorities.top1_agreement === 1);
    assert(r.priorities.top3_agreement === 1);
  } finally { ca(); cb(); }
});

t("compare reports Kendall τ of -1 for reversed rankings", () => {
  const { ctx: a, cleanup: ca } = freshCtx();
  const { ctx: b, cleanup: cb } = freshCtx();
  try {
    call("upsert_subsystem", { id: "B-01", name: "x", priority: 1 }, a);
    call("upsert_subsystem", { id: "B-02", name: "y", priority: 2 }, a);
    call("upsert_subsystem", { id: "B-03", name: "z", priority: 3 }, a);
    call("upsert_subsystem", { id: "B-01", name: "x", priority: 3 }, b);
    call("upsert_subsystem", { id: "B-02", name: "y", priority: 2 }, b);
    call("upsert_subsystem", { id: "B-03", name: "z", priority: 1 }, b);
    const r = call(
      "compare_conspectuses",
      { path_a: a.project.dbPath, path_b: b.project.dbPath },
      {},
    );
    assert(r.priorities.kendall_tau === -1, `tau: ${r.priorities.kendall_tau}`);
    // top-1 disagrees; B-01 vs B-03.
    assert(r.priorities.top1_agreement === 0);
  } finally { ca(); cb(); }
});

t("compare top-3 agreement: partial overlap of top sets", () => {
  const { ctx: a, cleanup: ca } = freshCtx();
  const { ctx: b, cleanup: cb } = freshCtx();
  try {
    // A's top 3 are B-01, B-02, B-03; B's top 3 are B-01, B-02, B-04.
    // Intersection size = 2, so top3_agreement should be 2/3.
    for (const [id, pA, pB] of [
      ["B-01", 1, 1],
      ["B-02", 2, 2],
      ["B-03", 3, 4],
      ["B-04", 4, 3],
    ]) {
      call("upsert_subsystem", { id, name: id, priority: pA }, a);
      call("upsert_subsystem", { id, name: id, priority: pB }, b);
    }
    const r = call(
      "compare_conspectuses",
      { path_a: a.project.dbPath, path_b: b.project.dbPath },
      {},
    );
    // Floating-point safe comparison to 2/3.
    const diff = Math.abs((r.priorities.top3_agreement ?? 0) - 2 / 3);
    assert(diff < 1e-9, `expected ~2/3, got ${r.priorities.top3_agreement}`);
    assert(r.priorities.top1_agreement === 1);
  } finally { ca(); cb(); }
});

t("compare handles one side with no priorities: shared_ranked=0, tau null", () => {
  const { ctx: a, cleanup: ca } = freshCtx();
  const { ctx: b, cleanup: cb } = freshCtx();
  try {
    call("upsert_subsystem", { id: "B-01", name: "x", priority: 1 }, a);
    call("upsert_subsystem", { id: "B-01", name: "x" }, b); // no priority
    const r = call(
      "compare_conspectuses",
      { path_a: a.project.dbPath, path_b: b.project.dbPath },
      {},
    );
    assert(r.priorities.ranked_a === 1);
    assert(r.priorities.ranked_b === 0);
    assert(r.priorities.shared_ranked === 0);
    assert(r.priorities.kendall_tau === null);
    assert(r.priorities.top1_agreement === null);
  } finally { ca(); cb(); }
});

// ---- Pre-priority DB still usable by compare ----
t("compare against a pre-migration DB reports ranked_a=0 gracefully", () => {
  const { ctx: a, cleanup: ca } = freshCtx();
  const { ctx: b, cleanup: cb } = freshCtx();
  try {
    call("upsert_subsystem", { id: "B-01", name: "x", priority: 1 }, a);
    // Strip the priority column from B to simulate a pre-migration DB.
    b.db.close();
    const raw = new Database(b.project.dbPath);
    // SQLite refuses DROP COLUMN when an index references that column,
  // so drop the index first. In production the migration hook
  // recreates the index on next open, so this order doesn't matter
  // there — it's just the test shortcut for building a pre-priority
  // DB from a fresh one.
  raw.exec("DROP INDEX IF EXISTS idx_subsystems_priority");
  raw.exec("ALTER TABLE subsystems DROP COLUMN priority");
    raw.close();
    // Re-open b's db with a raw connection (no migrations) so the
    // column stays absent when compare_conspectuses reads.
    b.db = new Database(b.project.dbPath, { readonly: false });
    const r = call(
      "compare_conspectuses",
      { path_a: a.project.dbPath, path_b: b.project.dbPath },
      {},
    );
    assert(r.ok);
    assert(r.priorities.ranked_b === 0, "pre-migration side should report 0 ranked");
    assert(r.priorities.shared_ranked === 0);
  } finally { ca(); cb(); }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
