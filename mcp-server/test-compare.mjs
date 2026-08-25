#!/usr/bin/env node
// Correctness probes for compare_conspectuses. Builds two minimal DBs
// with known structural overlap, runs the compare, asserts on the
// overlap/divergence counts.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./dist/db.js";
import { resolveProject } from "./dist/project.js";
import { compareTools } from "./dist/tools/compare.js";

const call = (name, args) => {
  const td = compareTools.find((t) => t.name === name);
  if (!td) throw new Error(name);
  return td.handler(args, {});
};

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

function seedDb(dbPath, spec) {
  const db = openDatabase(dbPath);
  // spec: { subsystems: [ids], findings: [{subsystem, symptom, rootCause, severity}], dispositions: [{ss, code, cls}], evidence: [{file, kind}] }
  for (const id of spec.subsystems) {
    db.prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, ?)").run(
      id,
      `Subsystem ${id}`,
      "concerns",
    );
  }
  for (const code of new Set((spec.dispositions ?? []).map((d) => d.code))) {
    db.prepare(
      "INSERT INTO concerns (code, category, origin, status) VALUES (?, ?, 'seeded', 'active')",
    ).run(code, "cache");
  }
  for (const d of spec.dispositions ?? []) {
    db.prepare(
      `INSERT INTO dispositions (subsystem_id, concern_code, classification, evidence, evidence_quality, rationale, ref_sha, pass_type)
       VALUES (?, ?, ?, 'x', 'code-verified', 'r', 'abc', 'survey')`,
    ).run(d.ss, d.code, d.cls);
  }
  for (const [i, f] of (spec.findings ?? []).entries()) {
    db.prepare(
      `INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status, ref_sha, pass_type)
       VALUES (?, ?, ?, ?, ?, 'confirmed-bug', 'abc', 'survey')`,
    ).run(`F-${i}`, f.subsystem, f.symptom, f.rootCause, f.severity);
  }
  for (const e of spec.evidence ?? []) {
    db.prepare("INSERT INTO evidence (file_path, ref_sha, kind) VALUES (?, 'abc', ?)").run(
      e.file,
      e.kind,
    );
  }
  db.close();
}

function freshDb(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `cmp-${prefix}-`));
  return { dir, path: join(dir, "memory.db") };
}

// ---- 1. Identical conspectuses score 100% overlap ----
t("identical DBs: 100% Jaccard on subsystems and findings", () => {
  const a = freshDb("a");
  const b = freshDb("b");
  try {
    const spec = {
      subsystems: ["B-01", "B-02"],
      dispositions: [
        { ss: "B-01", code: "CC-1", cls: "ruled-out" },
        { ss: "B-02", code: "CC-1", cls: "confirmed-bug" },
      ],
      findings: [{ subsystem: "B-02", symptom: "stale", rootCause: "race", severity: "HIGH" }],
      evidence: [{ file: "a.ts", kind: "code-verified" }],
    };
    seedDb(a.path, spec);
    seedDb(b.path, spec);
    const r = call("compare_conspectuses", {
      path_a: a.path,
      path_b: b.path,
      label_a: "local",
      label_b: "cloud",
    });
    assert(r.ok);
    assert(r.subsystems.jaccard === 1, `subsystems jaccard: ${r.subsystems.jaccard}`);
    assert(r.findings.jaccard === 1, `findings jaccard: ${r.findings.jaccard}`);
    assert(r.concerns_coverage.same_verdict === 2);
    assert(r.concerns_coverage.diverged_verdict === 0);
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

// ---- 2. Disjoint subsystems: 0% overlap ----
t("disjoint DBs: 0% subsystem Jaccard", () => {
  const a = freshDb("a");
  const b = freshDb("b");
  try {
    seedDb(a.path, { subsystems: ["A-1", "A-2"] });
    seedDb(b.path, { subsystems: ["B-1", "B-2"] });
    const r = call("compare_conspectuses", { path_a: a.path, path_b: b.path });
    assert(r.ok);
    assert(r.subsystems.jaccard === 0);
    assert(r.subsystems.both.length === 0);
    assert(r.subsystems.only_a.length === 2);
    assert(r.subsystems.only_b.length === 2);
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

// ---- 3. Diverged verdicts detected ----
t("same (subsystem, concern) cells with different verdicts count as diverged", () => {
  const a = freshDb("a");
  const b = freshDb("b");
  try {
    seedDb(a.path, {
      subsystems: ["B-01"],
      dispositions: [{ ss: "B-01", code: "CC-1", cls: "ruled-out" }],
    });
    seedDb(b.path, {
      subsystems: ["B-01"],
      dispositions: [{ ss: "B-01", code: "CC-1", cls: "confirmed-bug" }],
    });
    const r = call("compare_conspectuses", { path_a: a.path, path_b: b.path });
    assert(r.ok);
    assert(r.concerns_coverage.cells_both === 1);
    assert(r.concerns_coverage.same_verdict === 0);
    assert(r.concerns_coverage.diverged_verdict === 1);
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

// ---- 4. Finding signatures ignore the synthetic ID ----
t("findings with different IDs but same signature are counted as shared", () => {
  const a = freshDb("a");
  const b = freshDb("b");
  try {
    seedDb(a.path, {
      subsystems: ["B-01"],
      findings: [
        { subsystem: "B-01", symptom: "race", rootCause: "lock released", severity: "HIGH" },
      ],
    });
    // Different IDs, same structural signature.
    seedDb(b.path, {
      subsystems: ["B-01"],
      findings: [
        { subsystem: "B-01", symptom: "race", rootCause: "lock released", severity: "HIGH" },
        { subsystem: "B-01", symptom: "other", rootCause: "else", severity: "LOW" },
      ],
    });
    const r = call("compare_conspectuses", { path_a: a.path, path_b: b.path });
    assert(r.findings.shared_signatures === 1);
    assert(r.findings.only_a_signatures === 0);
    assert(r.findings.only_b_signatures === 1);
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

// ---- 5. Missing DB paths return a clear error ----
t("missing DB path errors cleanly (no crash)", () => {
  const a = freshDb("a");
  try {
    seedDb(a.path, { subsystems: ["B-01"] });
    let threw = false;
    try {
      call("compare_conspectuses", {
        path_a: a.path,
        path_b: "/nonexistent/memory.db",
      });
    } catch (e) {
      threw = true;
      assert(/no memory.db/.test(e.message), e.message);
    }
    assert(threw, "should have thrown");
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
  }
});

// ---- 6. write_to produces a markdown report ----
t("write_to renders a markdown report to disk", () => {
  const a = freshDb("a");
  const b = freshDb("b");
  const out = mkdtempSync(join(tmpdir(), "cmp-out-"));
  try {
    const project = resolveProject(out, {
      selectionSource: "test-compare",
      serverVersion: "test",
    });
    const outFile = join(project.storagePath, "comparison.md");
    seedDb(a.path, { subsystems: ["B-01"] });
    seedDb(b.path, { subsystems: ["B-01", "B-02"] });
    compareTools
      .find((candidate) => candidate.name === "compare_conspectuses")
      .handler(
        {
          path_a: a.path,
          path_b: b.path,
          label_a: "local",
          label_b: "cloud",
          write_to: outFile,
        },
        { project },
      );
    assert(existsSync(outFile), "markdown file not written");
    const md = readFileSync(outFile, "utf8");
    assert(md.includes("# Conspectus comparison"), "missing title");
    assert(md.includes("local"), "missing label a");
    assert(md.includes("cloud"), "missing label b");
    assert(md.includes("B-02"), "missing unique-to-b subsystem");
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

// ---- 7. Tolerates a DB without the open_questions table (schema drift) ----
t("compares a DB missing the open_questions table without crashing", () => {
  const a = freshDb("a");
  const b = freshDb("b");
  try {
    seedDb(a.path, { subsystems: ["B-01"] });
    seedDb(b.path, { subsystems: ["B-01"] });
    // Drop the open_questions table from one side to simulate an old
    // conspectus. compare_conspectuses should silently count it as 0.
    const raw = openDatabase(a.path);
    raw.prepare("DROP TABLE IF EXISTS open_questions").run();
    raw.close();
    const r = call("compare_conspectuses", { path_a: a.path, path_b: b.path });
    assert(r.ok);
    assert(r.counts.a.open_questions === 0);
    assert(r.counts.b.open_questions === 0);
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
