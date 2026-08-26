#!/usr/bin/env node
// Correctness probes for the autoprogress infrastructure:
// record_open_question / get_open_questions / resolve_open_question /
// get_autoprogress_mode and the AMANUENSIS_AUTOPROGRESS env var.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./dist/db.js";
import { ensureProjectStorage, resolveProject } from "./dist/project.js";
import { projectTools } from "./dist/tools/project.js";
import { subsystemTools } from "./dist/tools/subsystems.js";
import { openQuestionTools } from "./dist/tools/open-questions.js";

const allTools = new Map(
  [...projectTools, ...subsystemTools, ...openQuestionTools].map((td) => [td.name, td]),
);
function call(name, args, ctx) {
  const td = allTools.get(name);
  if (!td) throw new Error(`no such tool: ${name}`);
  return td.handler(args, ctx);
}
function freshCtx() {
  const ws = mkdtempSync(join(tmpdir(), "aq-"));
  spawnSync("git", ["init", "-q"], { cwd: ws });
  const project = resolveProject(ws);
  ensureProjectStorage(project, (databasePath) => {
    const database = openDatabase(databasePath);
    database.close();
  });
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

// ---- get_autoprogress_mode ----
t("get_autoprogress_mode returns false when env unset", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    delete process.env.AMANUENSIS_AUTOPROGRESS;
    const r = call("get_autoprogress_mode", {}, ctx);
    assert(r.autoprogress === false, "should be false when env unset");
    assert(r.env_raw === null, `env_raw should be null, got: ${r.env_raw}`);
  } finally { cleanup(); }
});

t("get_autoprogress_mode recognizes '1', 'true', 'yes', 'on'", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    for (const val of ["1", "true", "yes", "on", "TRUE", "  true  "]) {
      process.env.AMANUENSIS_AUTOPROGRESS = val;
      const r = call("get_autoprogress_mode", {}, ctx);
      assert(r.autoprogress === true, `expected true for "${val}", got: ${r.autoprogress}`);
    }
  } finally {
    delete process.env.AMANUENSIS_AUTOPROGRESS;
    cleanup();
  }
});

t("get_autoprogress_mode rejects ambiguous values", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    for (const val of ["0", "false", "no", "off", "nope", ""]) {
      process.env.AMANUENSIS_AUTOPROGRESS = val;
      const r = call("get_autoprogress_mode", {}, ctx);
      assert(
        r.autoprogress === false,
        `expected false for "${val}", got: ${r.autoprogress}`,
      );
    }
  } finally {
    delete process.env.AMANUENSIS_AUTOPROGRESS;
    cleanup();
  }
});

// ---- record_open_question ----
t("record_open_question requires active session", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    let threw = false;
    try {
      call(
        "record_open_question",
        { category: "domain-knowledge", question: "?" },
        ctx,
      );
    } catch (e) {
      threw = true;
      assert(/requires an active session/.test(e.message), e.message);
    }
    assert(threw, "should reject without active session");
  } finally { cleanup(); }
});

t("record_open_question stores all fields", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    const sess = call("start_session", { intent: "test" }, ctx);
    ctx.sessionId = sess.session_id;
    const r = call(
      "record_open_question",
      {
        category: "domain-knowledge",
        question: "Is field X the canonical owner of Y?",
        subsystem_id: "B-01",
        phase: "concerns",
        what_blocked: "cannot disambiguate CC-1 classification",
        what_assumed: "X is canonical (name-inferred)",
        ref_sha: "abc",
      },
      ctx,
    );
    assert(r.ok);
    assert(typeof r.id === "number" || typeof r.id === "bigint", "id returned");
    const all = call("get_open_questions", {}, ctx);
    assert(all.length === 1);
    const q = all[0];
    assert(q.question === "Is field X the canonical owner of Y?");
    assert(q.subsystem_id === "B-01");
    assert(q.phase === "concerns");
    assert(q.what_blocked.includes("disambiguate"));
    assert(q.what_assumed.includes("canonical"));
    assert(q.resolution === "open");
  } finally { cleanup(); }
});

t("record_open_question rejects invalid category", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    ctx.sessionId = call("start_session", { intent: "test" }, ctx).session_id;
    let threw = false;
    try {
      call(
        "record_open_question",
        { category: "not-a-real-category", question: "?" },
        ctx,
      );
    } catch (e) {
      threw = true;
    }
    assert(threw, "should reject invalid category");
  } finally { cleanup(); }
});

// ---- get_open_questions filtering ----
t("get_open_questions filters by resolution and category", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    ctx.sessionId = call("start_session", { intent: "test" }, ctx).session_id;
    call("record_open_question", { category: "domain-knowledge", question: "q1" }, ctx);
    call("record_open_question", { category: "scope-judgment", question: "q2" }, ctx);
    const q3 = call(
      "record_open_question",
      { category: "domain-knowledge", question: "q3" },
      ctx,
    );
    call("resolve_open_question", { id: Number(q3.id), resolution: "dismissed" }, ctx);

    const openOnly = call("get_open_questions", {}, ctx);
    assert(openOnly.length === 2, `expected 2 open, got ${openOnly.length}`);

    const allOf = call("get_open_questions", { resolution_filter: "all" }, ctx);
    assert(allOf.length === 3, `expected 3 total, got ${allOf.length}`);

    const domOnly = call(
      "get_open_questions",
      { category: "domain-knowledge" },
      ctx,
    );
    assert(domOnly.length === 1, `expected 1 open domain, got ${domOnly.length}`);
    assert(domOnly[0].question === "q1");
  } finally { cleanup(); }
});

// ---- resolve_open_question ----
t("resolve_open_question 'answered' requires an answer", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    ctx.sessionId = call("start_session", { intent: "test" }, ctx).session_id;
    const q = call(
      "record_open_question",
      { category: "domain-knowledge", question: "?" },
      ctx,
    );
    const r = call(
      "resolve_open_question",
      { id: Number(q.id), resolution: "answered" },
      ctx,
    );
    assert(!r.ok);
    assert(/requires an `answer`/.test(r.error));
    // Try again with an answer — should succeed.
    const r2 = call(
      "resolve_open_question",
      { id: Number(q.id), resolution: "answered", answer: "yes" },
      ctx,
    );
    assert(r2.ok);
  } finally { cleanup(); }
});

t("resolve_open_question on unknown id fails cleanly", () => {
  const { ctx, cleanup } = freshCtx();
  try {
    ctx.sessionId = call("start_session", { intent: "test" }, ctx).session_id;
    const r = call(
      "resolve_open_question",
      { id: 99999, resolution: "dismissed" },
      ctx,
    );
    assert(!r.ok);
    assert(r.error.includes("unknown"));
  } finally { cleanup(); }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
