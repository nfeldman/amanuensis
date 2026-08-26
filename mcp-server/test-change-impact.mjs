#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./dist/db.js";
import { ensureProjectStorage, resolveProject } from "./dist/project.js";
import { claimTools } from "./dist/tools/claims.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { impactTools } from "./dist/tools/impact.js";
import { projectTools } from "./dist/tools/project.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const tools = new Map(
  [...projectTools, ...evidenceTools, ...claimTools, ...impactTools].map((tool) => [
    tool.name,
    tool,
  ]),
);

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL ${label}\n       ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn, expected) {
  let error = null;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  if (!error) throw new Error(`expected error containing ${JSON.stringify(expected)}`);
  if (!error.message.includes(expected)) {
    throw new Error(`expected error containing ${JSON.stringify(expected)}, got ${error.message}`);
  }
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function call(name, args, ctx) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`unknown test tool: ${name}`);
  return tool.handler(args, ctx);
}

function sorted(values) {
  return [...values].sort();
}

function predictionClaims(prediction) {
  return sorted(prediction.invalidated_claims.map((claim) => claim.object_id));
}

function controlClaims(prediction) {
  return sorted(prediction.unaffected_controls.map((claim) => claim.object_id));
}

function loadExpectedAfterPrediction(ctx, runId) {
  const durable = ctx.db
    .prepare("SELECT artifact_json FROM change_impact_runs WHERE run_id = ?")
    .get(runId);
  assert(durable?.artifact_json, "prediction was compared before its artifact was durably recorded");
  return JSON.parse(
    readFileSync(join(ROOT, "fixtures/change-impact/manifest.json"), "utf8"),
  );
}

function freshContext() {
  const root = mkdtempSync(join(tmpdir(), "change-impact-"));
  const workspace = join(root, "workspace");
  const storage = join(root, "storage");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(join(workspace, "extra"), { recursive: true });
  git(workspace, "init", "-q");
  git(workspace, "config", "user.email", "test@example.com");
  git(workspace, "config", "user.name", "Change Impact Test");

  writeFileSync(join(workspace, "src/a.ts"), "export const value = 'A';\n");
  writeFileSync(join(workspace, "src/benign-old.ts"), "export const stable = true;\n");
  writeFileSync(join(workspace, "src/control.ts"), "export const control = true;\n");
  writeFileSync(join(workspace, "extra/unmapped.txt"), "before\n");
  git(workspace, "add", "src", "extra");
  git(workspace, "commit", "-q", "-m", "base fixture");
  const base = git(workspace, "rev-parse", "HEAD");

  git(workspace, "mv", "src/benign-old.ts", "src/benign-new.ts");
  git(workspace, "commit", "-q", "-m", "exact rename");
  const rename = git(workspace, "rev-parse", "HEAD");

  writeFileSync(join(workspace, "src/a.ts"), "export const value = 'B';\n");
  writeFileSync(join(workspace, "extra/unmapped.txt"), "after\n");
  git(workspace, "add", "src/a.ts", "extra/unmapped.txt");
  git(workspace, "commit", "-q", "-m", "behavior change");
  const head = git(workspace, "rev-parse", "HEAD");

  process.env.AMANUENSIS_STORAGE_ROOT = storage;
  const project = resolveProject(workspace);
  ensureProjectStorage(project, (databasePath) => {
    const database = openDatabase(databasePath);
    database.close();
  });
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  const session = call("start_session", { intent: "change-impact-test" }, ctx);
  ctx.sessionId = session.session_id;

  for (const [id, name] of [
    ["A", "source"],
    ["B", "xref consumer"],
    ["C", "seam consumer"],
    ["D", "control"],
    ["E", "rename-only"],
  ]) {
    db.prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, 'mapped')").run(id, name);
  }
  for (const [subsystem, path] of [
    ["A", "src/a.ts"],
    ["D", "src/control.ts"],
    ["E", "src/benign-old.ts"],
  ]) {
    db.prepare(
      `INSERT INTO file_ledger
         (subsystem_id, file_path, why_in_scope, classification, ref_sha)
       VALUES (?, ?, 'fixture', 'examined', ?)`,
    ).run(subsystem, path, base);
  }
  db.prepare(
    `INSERT INTO xrefs (from_id, to_id, relationship, strength, context)
     VALUES ('A', 'B', 'dependency', 'structural', 'B consumes A')`,
  ).run();
  db.prepare(
    `INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b)
     VALUES ('S-BC', 'events', 'event-bus', 'B', 'C')`,
  ).run();
  db.prepare(
    `INSERT INTO findings
       (finding_id, subsystem_id, symptom, root_cause, severity, status, primary_files, ref_sha, session_id)
     VALUES ('finding-c', 'C', 'downstream behavior', 'seam contract', 'HIGH',
             'confirmed-bug', ?, ?, ?)`,
  ).run(JSON.stringify([`src/control.ts:control@${base}`]), base, ctx.sessionId);
  db.prepare(
    `INSERT INTO open_questions
       (category, subsystem_id, phase, question, resolution, session_id, ref_sha)
     VALUES ('ambiguous-evidence', 'C', 'impact', 'Does the seam contract still hold?',
             'open', ?, ?)`,
  ).run(ctx.sessionId, base);

  const evidenceByPath = new Map();
  for (const path of ["src/a.ts", "src/benign-old.ts", "src/control.ts"]) {
    const evidence = call(
      "add_evidence",
      { file_path: path, ref_sha: base, kind: "code-verified", note: "fixture evidence" },
      ctx,
    );
    evidenceByPath.set(path, evidence.id);
  }
  for (const [id, subject, path] of [
    ["claim-a", "A", "src/a.ts"],
    ["claim-b", "B", "src/control.ts"],
    ["claim-c", "C", "src/control.ts"],
    ["claim-control", "D", "src/control.ts"],
    ["claim-benign", "E", "src/benign-old.ts"],
  ]) {
    call(
      "add_claim",
      {
        claim_id: id,
        claim_key: `fixture.${id}`,
        subject_type: "subsystem",
        subject_id: subject,
        statement: `${id} remains authoritative until impacted.`,
        epistemic_kind: "observation",
        ref_sha: base,
        evidence_ids: [evidenceByPath.get(path)],
      },
      ctx,
    );
  }

  return {
    ctx,
    workspace,
    base,
    rename,
    head,
    cleanup: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("predicted artifact is durable before expected comparison and matches known impact", () => {
  const { ctx, rename, head, cleanup } = freshContext();
  try {
    const prediction = call(
      "predict_change_impact",
      {
        base_sha: rename,
        head_sha: head,
        run_id: "known-impact",
        relation_discovery: "request-if-gap",
      },
      ctx,
    );
    const manifest = loadExpectedAfterPrediction(ctx, prediction.run_id);
    const expected = manifest.knownInvalidation;
    assertEqual(predictionClaims(prediction), sorted(expected.invalidatedClaims), "claim recall");
    assertEqual(controlClaims(prediction), sorted(expected.unaffectedClaims), "unaffected controls");
    const objectIds = new Set(
      prediction.mapped_objects.map((object) => `${object.object_type}:${object.object_id}`),
    );
    for (const object of expected.requiredObjects) {
      assert(objectIds.has(object), `missing required impacted object ${object}`);
    }
    const relationClasses = new Set(
      prediction.traversed_relations.map((relation) => relation.relation_class),
    );
    for (const relation of expected.requiredRelationClasses) {
      assert(relationClasses.has(relation), `missing relation class ${relation}`);
    }
    assertEqual(
      prediction.gaps.map((gap) => gap.object_id),
      expected.requiredGaps,
      "explicit gaps",
    );
    assertEqual(
      prediction.relation_discovery.request?.status,
      "not-executed",
      "gap escalation must remain a request",
    );
    assertEqual(prediction.counts.invalidated_claims, 3, "invalidated denominator");
    assertEqual(prediction.counts.unaffected_controls, 2, "control denominator");
  } finally {
    cleanup();
  }
});

test("an empty commit range reports a zero denominator out of band", () => {
  const { ctx, workspace, head, cleanup } = freshContext();
  try {
    git(workspace, "commit", "--allow-empty", "-q", "-m", "empty control");
    const emptyHead = git(workspace, "rev-parse", "HEAD");
    const prediction = call(
      "predict_change_impact",
      { base_sha: head, head_sha: emptyHead, run_id: "empty-denominator" },
      ctx,
    );
    assertEqual(prediction.counts.changed_files, 0, "empty changed-file denominator");
    assertEqual(
      prediction.counts.denominator_status,
      "out-of-band-zero",
      "zero denominator verdict",
    );
  } finally {
    cleanup();
  }
});

test("exact rename is observed but does not invalidate content claims", () => {
  const { ctx, base, rename, cleanup } = freshContext();
  try {
    const prediction = call(
      "predict_change_impact",
      { base_sha: base, head_sha: rename, run_id: "benign-rename" },
      ctx,
    );
    const expected = loadExpectedAfterPrediction(ctx, prediction.run_id).benignRename;
    assertEqual(predictionClaims(prediction), expected.invalidatedClaims, "benign invalidations");
    assertEqual(controlClaims(prediction), sorted(expected.unaffectedClaims), "benign controls");
    assertEqual(
      prediction.changed_files.map((change) => change.change_type),
      expected.changeTypes,
      "rename classification",
    );
    assertEqual(prediction.counts.content_changes, expected.contentChanges, "content denominator");
    assertEqual(prediction.counts.explicit_gaps, expected.explicitGaps, "rename mapping gaps");
  } finally {
    cleanup();
  }
});

test("xref and seam relation classes pass two-sided add/remove sensitivity", () => {
  const { ctx, rename, head, cleanup } = freshContext();
  try {
    // The expected relation lattice is intentionally loaded only after the first prediction lands.
    const full = call(
      "predict_change_impact",
      { base_sha: rename, head_sha: head, run_id: "relations-full" },
      ctx,
    );
    const arms = loadExpectedAfterPrediction(ctx, full.run_id).relationArms;
    assertEqual(predictionClaims(full), sorted(arms.xrefAndSeam), "full relation arm");

    ctx.db.prepare("DELETE FROM xrefs").run();
    const seamOnly = call(
      "predict_change_impact",
      { base_sha: rename, head_sha: head, run_id: "relations-seam-only" },
      ctx,
    );
    assertEqual(predictionClaims(seamOnly), sorted(arms.seamOnly), "xref removal arm");

    ctx.db.prepare(
      `INSERT INTO xrefs (from_id, to_id, relationship, strength)
       VALUES ('A', 'B', 'dependency', 'structural')`,
    ).run();
    ctx.db.prepare("DELETE FROM seams").run();
    const xrefOnly = call(
      "predict_change_impact",
      { base_sha: rename, head_sha: head, run_id: "relations-xref-only" },
      ctx,
    );
    assertEqual(predictionClaims(xrefOnly), sorted(arms.xrefOnly), "seam removal arm");

    ctx.db.prepare("DELETE FROM xrefs").run();
    const none = call(
      "predict_change_impact",
      { base_sha: rename, head_sha: head, run_id: "relations-none" },
      ctx,
    );
    assertEqual(predictionClaims(none), sorted(arms.none), "explicit relation ablation");

    ctx.db.prepare(
      `INSERT INTO xrefs (from_id, to_id, relationship, strength)
       VALUES ('A', 'B', 'dependency', 'structural')`,
    ).run();
    ctx.db.prepare(
      `INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b)
       VALUES ('S-BC', 'events', 'event-bus', 'B', 'C')`,
    ).run();
    const restored = call(
      "predict_change_impact",
      { base_sha: rename, head_sha: head, run_id: "relations-restored" },
      ctx,
    );
    assertEqual(predictionClaims(restored), sorted(arms.xrefAndSeam), "edge addition arm");
  } finally {
    cleanup();
  }
});

test("bounded exhaustive relation subsets agree with reachability model", () => {
  const { ctx, rename, head, cleanup } = freshContext();
  try {
    const first = call(
      "predict_change_impact",
      { base_sha: rename, head_sha: head, run_id: "subset-seed" },
      ctx,
    );
    const arms = loadExpectedAfterPrediction(ctx, first.run_id).relationArms;
    for (const xref of [false, true]) {
      for (const seam of [false, true]) {
        ctx.db.prepare("DELETE FROM xrefs").run();
        ctx.db.prepare("DELETE FROM seams").run();
        if (xref) {
          ctx.db.prepare(
            `INSERT INTO xrefs (from_id, to_id, relationship, strength)
             VALUES ('A', 'B', 'dependency', 'structural')`,
          ).run();
        }
        if (seam) {
          ctx.db.prepare(
            `INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b)
             VALUES ('S-BC', 'events', 'event-bus', 'B', 'C')`,
          ).run();
        }
        const key = xref ? (seam ? "xrefAndSeam" : "xrefOnly") : (seam ? "seamOnly" : "none");
        const prediction = call(
          "predict_change_impact",
          { base_sha: rename, head_sha: head, run_id: `subset-${Number(xref)}-${Number(seam)}` },
          ctx,
        );
        assertEqual(predictionClaims(prediction), sorted(arms[key]), `subset ${key}`);
      }
    }
  } finally {
    cleanup();
  }
});

test("explanation API returns the exact traversable reason path", () => {
  const { ctx, rename, head, cleanup } = freshContext();
  try {
    call(
      "predict_change_impact",
      { base_sha: rename, head_sha: head, run_id: "explanation" },
      ctx,
    );
    const explanation = call(
      "get_change_impact",
      { run_id: "explanation", object_type: "claim", object_id: "claim-c" },
      ctx,
    );
    assertEqual(
      explanation.object.reason_path.map((step) => step.kind),
      ["git-change", "file-ledger", "subsystem", "xref", "subsystem", "seam", "subsystem", "claim"],
      "reason path kinds",
    );
    assert(explanation.object.invalidates, "claim explanation lost invalidation verdict");
  } finally {
    cleanup();
  }
});

test("application is atomic and writes durable claim validity events", () => {
  const { ctx, rename, head, cleanup } = freshContext();
  try {
    call(
      "predict_change_impact",
      { base_sha: rename, head_sha: head, run_id: "apply-impact" },
      ctx,
    );
    const applied = call(
      "apply_change_impact",
      { run_id: "apply-impact", reason: "fixture change invalidates reached claims" },
      ctx,
    );
    assertEqual(applied.invalidated_claims, 3, "applied invalidation count");
    const closed = ctx.db
      .prepare("SELECT claim_id FROM claims WHERE valid_until_sha = ? ORDER BY claim_id")
      .all(head)
      .map((row) => row.claim_id);
    assertEqual(closed, ["claim-a", "claim-b", "claim-c"], "closed claims");
    assertEqual(
      ctx.db.prepare("SELECT COUNT(*) AS n FROM claim_validity_events WHERE event_type='invalidated'").get().n,
      3,
      "durable validity events",
    );
    const changeEvidence = ctx.db
      .prepare("SELECT file_path, ref_sha, kind FROM evidence WHERE id = ?")
      .get(applied.evidence_id);
    assertEqual(changeEvidence.kind, "runtime-observed", "structured change evidence kind");
    assertEqual(changeEvidence.file_path, "src/a.ts", "change evidence path");
    assertEqual(changeEvidence.ref_sha, head, "change evidence revision");
    const readBack = call("get_change_impact", { run_id: "apply-impact" }, ctx);
    assertEqual(readBack.execution.status, "applied", "application read-back");
    assertEqual(
      sorted(readBack.execution.invalidations.map((row) => row.state)),
      ["applied", "applied", "applied"],
      "invalidation read-back",
    );
    assertThrows(() => call("apply_change_impact", { run_id: "apply-impact" }, ctx), "is applied");
  } finally {
    cleanup();
  }
});

test("post-prediction claim drift prevents every application write", () => {
  const { ctx, rename, head, cleanup } = freshContext();
  try {
    call(
      "predict_change_impact",
      { base_sha: rename, head_sha: head, run_id: "drifted-impact" },
      ctx,
    );
    ctx.db.prepare("UPDATE claims SET valid_until_sha = ? WHERE claim_id = 'claim-b'").run(head);
    assertThrows(
      () => call("apply_change_impact", { run_id: "drifted-impact" }, ctx),
      "changed after prediction",
    );
    assertEqual(
      ctx.db
        .prepare("SELECT COUNT(*) AS n FROM evidence WHERE note LIKE '%Git range%'")
        .get().n,
      0,
      "failed application leaked evidence",
    );
    assertEqual(
      ctx.db.prepare("SELECT valid_until_sha FROM claims WHERE claim_id='claim-a'").get().valid_until_sha,
      null,
      "failed application partially closed another claim",
    );
  } finally {
    cleanup();
  }
});

console.log(`\nchange impact: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
