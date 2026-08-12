#!/usr/bin/env node
// A6: impact-shaped ReviewBrief compilation, expansion, and publication controls.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./dist/db.js";
import { claimTools } from "./dist/tools/claims.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { impactTools } from "./dist/tools/impact.js";
import { projectTools } from "./dist/tools/project.js";
import { reviewTools } from "./dist/tools/review.js";

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${label}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${label}\n       ${error.message}`);
  }
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
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
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function call(tools, ctx, name, args = {}) {
  const tool = tools.get(name);
  assert(tool, `unknown test tool: ${name}`);
  return tool.handler(args, ctx);
}

function ids(items, key) {
  return items.map((item) => item[key]).sort();
}

function freshFixture() {
  const root = mkdtempSync(join(tmpdir(), "amanuensis-review-brief-"));
  const workspace = join(root, "workspace");
  const storage = join(root, "storage");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(join(workspace, "extra"), { recursive: true });
  mkdirSync(storage, { recursive: true });
  git(workspace, "init", "-q");
  git(workspace, "config", "user.email", "test@localhost");
  git(workspace, "config", "user.name", "Review Brief Test");
  git(workspace, "config", "commit.gpgsign", "false");

  writeFileSync(join(workspace, "src/a.ts"), "export const eventVersion = 1;\n");
  writeFileSync(join(workspace, "src/benign-old.ts"), "export const stable = true;\n");
  writeFileSync(join(workspace, "src/control.ts"), "export const acceptsVersion = 1;\n");
  writeFileSync(join(workspace, "src/candidate.ts"), "export const unknown = true;\n");
  writeFileSync(join(workspace, "extra/unmapped.txt"), "before\n");
  git(workspace, "add", "src", "extra");
  git(workspace, "commit", "-q", "--no-verify", "-m", "base fixture");
  const base = git(workspace, "rev-parse", "HEAD");

  git(workspace, "mv", "src/benign-old.ts", "src/benign-new.ts");
  git(workspace, "commit", "-q", "--no-verify", "-m", "exact rename");
  const rename = git(workspace, "rev-parse", "HEAD");

  writeFileSync(join(workspace, "src/a.ts"), "export const eventVersion = 2;\n");
  writeFileSync(join(workspace, "extra/unmapped.txt"), "after\n");
  git(workspace, "add", "src/a.ts", "extra/unmapped.txt");
  git(workspace, "commit", "-q", "--no-verify", "-m", "behavior change");
  const head = git(workspace, "rev-parse", "HEAD");

  const project = {
    workspacePath: workspace,
    projectKey: "test/review-brief",
    storagePath: storage,
    dbPath: join(storage, "memory.db"),
    storageGitReady: false,
  };
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  const tools = new Map(
    [...projectTools, ...evidenceTools, ...claimTools, ...impactTools, ...reviewTools].map(
      (tool) => [tool.name, tool],
    ),
  );
  const session = call(tools, ctx, "start_session", { intent: "review-brief-controls" });
  ctx.sessionId = session.session_id;

  for (const [id, name] of [
    ["A", "event producer"],
    ["B", "event adapter"],
    ["C", "event consumer"],
    ["D", "unrelated control"],
    ["E", "rename-only"],
  ]) {
    db.prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, 'mapped')").run(id, name);
  }
  for (const [subsystem, path, classification] of [
    ["A", "src/a.ts", "examined"],
    ["C", "src/control.ts", "examined"],
    ["C", "src/candidate.ts", "candidate"],
    ["D", "src/control.ts", "examined"],
    ["E", "src/benign-old.ts", "examined"],
  ]) {
    db.prepare(
      `INSERT INTO file_ledger
         (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at)
       VALUES (?, ?, 'review fixture', ?, ?, datetime('now'))`,
    ).run(subsystem, path, classification, base);
  }
  db.prepare(
    `INSERT INTO xrefs (from_id, to_id, relationship, strength, context)
     VALUES ('A', 'B', 'dependency', 'structural', 'B adapts events from A')`,
  ).run();
  db.prepare(
    `INSERT INTO seams
       (id, shared_object, shared_object_kind, party_a, party_b, a_writes, b_reads,
        ordering_assumption, cardinality, staleness_tolerance, schema_owner, notes)
     VALUES ('S-BC', 'versioned-events', 'event-bus', 'B', 'C', 'event v2', 'event v1',
             'causal', 'fan-out', 'bounded:5s', 'B', 'Compatibility must be preserved')`,
  ).run();

  const evidenceByPath = new Map();
  for (const path of ["src/a.ts", "src/benign-old.ts", "src/control.ts"]) {
    const evidence = call(tools, ctx, "add_evidence", {
      file_path: path,
      ref_sha: base,
      kind: "code-verified",
      excerpt: `${path} fixture evidence`,
      note: "review-context positive control",
    });
    evidenceByPath.set(path, evidence.id);
  }
  for (const [claimId, subjectId, path] of [
    ["claim-a", "A", "src/a.ts"],
    ["claim-b", "B", "src/control.ts"],
    ["claim-c", "C", "src/control.ts"],
    ["claim-control", "D", "src/control.ts"],
    ["claim-benign", "E", "src/benign-old.ts"],
  ]) {
    call(tools, ctx, "add_claim", {
      claim_id: claimId,
      claim_key: `fixture.${claimId}`,
      subject_type: "subsystem",
      subject_id: subjectId,
      statement: `${claimId} remains authoritative until its impact path changes.`,
      epistemic_kind: "observation",
      ref_sha: base,
      evidence_ids: [evidenceByPath.get(path)],
    });
  }

  for (const finding of [
    {
      id: "finding-c",
      symptom: "the consumer rejects the new event version",
      root: "the seam contract is not backward compatible",
      severity: "HIGH",
      status: "confirmed-bug",
      resolution: "accepted",
    },
    {
      id: "finding-ruled",
      symptom: "causal delivery appeared unordered",
      root: "the observation omitted the consumer checkpoint",
      severity: "MEDIUM",
      status: "ruled-out",
      resolution: "ruled-out",
    },
  ]) {
    db.prepare(
      `INSERT INTO findings
         (finding_id, subsystem_id, symptom, root_cause, severity, status,
          primary_files, ref_sha, session_id, pass_type)
       VALUES (?, 'C', ?, ?, ?, ?, ?, ?, ?, 'adversarial')`,
    ).run(
      finding.id,
      finding.symptom,
      finding.root,
      finding.severity,
      finding.status,
      JSON.stringify([`src/control.ts@${base}`]),
      base,
      ctx.sessionId,
    );
    db.prepare("INSERT INTO finding_evidence (finding_id, evidence_id, role) VALUES (?, ?, ?)").run(
      finding.id,
      evidenceByPath.get("src/control.ts"),
      finding.status === "ruled-out" ? "compensating" : "root-cause",
    );
    db.prepare(
      `INSERT INTO finding_resolution_events
         (finding_id, resolution_state, evidence_id, rationale, session_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      finding.id,
      finding.resolution,
      finding.status === "ruled-out" ? evidenceByPath.get("src/control.ts") : null,
      `${finding.id} historical resolution`,
      ctx.sessionId,
    );
  }
  const contradiction = db
    .prepare(
      `INSERT INTO contradictions
       (finding_a, finding_b, shared_location, conflict_type, resolution, session_id)
     VALUES ('finding-c', 'finding-ruled', ?, 'classification-conflict', 'unresolved', ?)
     RETURNING id`,
    )
    .get(`src/control.ts@${base}`, ctx.sessionId);
  db.prepare(
    `INSERT INTO contradiction_resolution_events
       (contradiction_id, resolution, rationale, session_id)
     VALUES (?, 'unresolved', 'The event-version and ordering scopes still overlap.', ?)`,
  ).run(contradiction.id, ctx.sessionId);

  db.prepare(
    `INSERT INTO concerns (code, category, origin, discovered_in, status, notes)
     VALUES ('SC-1', 'integration-seam', 'discovered', 'C', 'active', 'event compatibility')`,
  ).run();
  db.prepare(
    `INSERT INTO dispositions
       (subsystem_id, concern_code, classification, rationale, ref_sha, session_id, pass_type)
     VALUES ('C', 'SC-1', 'confirmed-acceptable',
             'A version shim is effective when the old event shape is retained.', ?, ?, 'adversarial')`,
  ).run(base, ctx.sessionId);
  db.prepare(
    `INSERT INTO disposition_evidence (subsystem_id, concern_code, evidence_id, role)
     VALUES ('C', 'SC-1', ?, 'compensating')`,
  ).run(evidenceByPath.get("src/control.ts"));
  db.prepare(
    `INSERT INTO open_questions
       (category, subsystem_id, phase, question, what_blocked, what_assumed,
        session_id, ref_sha, resolution)
     VALUES ('ambiguous-evidence', 'C', 'review',
             'Does every deployed consumer accept both event versions?',
             'complete compatibility proof', 'the legacy consumer is still deployed', ?, ?, 'open')`,
  ).run(ctx.sessionId, base);
  db.prepare(
    `INSERT INTO entries
       (id, tier, subsystem_id, content_hash, source_path, ref_sha, confidence,
        stale, stale_since, stale_reason)
     VALUES ('C-summary', 1, 'C', 'fixture', 'conspectus/C.md', ?, 'verified',
             1, datetime('now'), 'git-drift')`,
  ).run(base);

  call(tools, ctx, "predict_change_impact", {
    base_sha: rename,
    head_sha: head,
    run_id: "review-impact",
  });
  call(tools, ctx, "predict_change_impact", {
    base_sha: base,
    head_sha: rename,
    run_id: "benign-impact",
  });

  return {
    root,
    workspace,
    base,
    rename,
    head,
    db,
    ctx,
    tools,
    cleanup: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function compileArgs(briefId, overrides = {}) {
  return {
    brief_id: briefId,
    impact_run_id: "review-impact",
    task: "Review the behavior change without changing the published event contract.",
    task_constraints: [
      {
        constraint_id: "preserve-event-contract",
        statement: "Preserve backward compatibility of the events seam.",
        source_kind: "direct-user",
        source_ref: "request:A6",
      },
    ],
    context_profile: "diff-scoped",
    token_budget: 20_000,
    ...overrides,
  };
}

test("known seam defect compiles into a complete impact-first brief", () => {
  const fixture = freshFixture();
  try {
    const result = call(fixture.tools, fixture.ctx, "compile_review_brief", compileArgs("full"));
    assertEqual(result.status, "publishable", "full brief status");
    assertEqual(result.control_score, 1, "full structural control score");
    assertEqual(
      ids(result.brief.sections.impacted_seams, "seam_id"),
      ["S-BC"],
      "impacted seam context",
    );
    assertEqual(
      ids(result.brief.sections.historical_findings, "finding_id"),
      ["finding-c", "finding-ruled"],
      "confirmed and ruled-out history",
    );
    assertEqual(result.brief.sections.compensating_controls.length, 1, "compensating control");
    assertEqual(
      ids(result.brief.sections.stale_claims, "claim_id"),
      ["claim-a", "claim-b", "claim-c"],
      "impacted claim context",
    );
    assert(result.brief.sections.contradictions.length === 1, "contradiction was omitted");
    assert(
      result.brief.sections.unknowns.length >= 2,
      "unknown and unverified context was omitted",
    );
    assertEqual(
      ids(result.brief.sections.uncovered_files, "gap_id"),
      ["unmapped-file:extra/unmapped.txt"],
      "uncovered changed file",
    );
    const gapTrace = result.trace.find((trace) => trace.section === "uncovered_files");
    assert(gapTrace?.obligation_id, "uncovered file has no custody destination");
    assert(
      result.obligations.some(
        (obligation) =>
          obligation.obligation_id === gapTrace.obligation_id &&
          obligation.state === "deferred" &&
          obligation.blocking === 0,
      ),
      "uncovered file obligation was not durably deferred",
    );
    assert(
      result.trace
        .filter((trace) => trace.action === "included")
        .every((trace) => Object.keys(trace.provenance).length > 0),
      "included trace lost provenance",
    );
    assertEqual(
      fixture.db
        .prepare("SELECT COUNT(*) AS n FROM query_log WHERE question LIKE 'review brief full:%'")
        .get().n,
      1,
      "task-scoped retrieval log",
    );
  } finally {
    fixture.cleanup();
  }
});

test("compact stale claim expands to typed evidence valid at the reviewed commit", () => {
  const fixture = freshFixture();
  try {
    const brief = call(fixture.tools, fixture.ctx, "compile_review_brief", compileArgs("expand"));
    const trace = brief.trace.find(
      (item) => item.section === "stale_claims" && item.object_id === "claim-c",
    );
    assert(trace, "claim-c trace missing");
    for (const included of brief.trace.filter((item) => item.action === "included")) {
      const item = call(fixture.tools, fixture.ctx, "expand_review_brief_item", {
        brief_id: "expand",
        trace_id: included.trace_id,
      });
      assertEqual(item.reviewed_sha, fixture.head, `${included.trace_id} reviewed state`);
      assert(item.source && typeof item.source === "object", `${included.trace_id} typed source`);
      assert(item.expansion_hash, `${included.trace_id} expansion hash`);
    }
    const expanded = call(fixture.tools, fixture.ctx, "expand_review_brief_item", {
      brief_id: "expand",
      trace_id: trace.trace_id,
    });
    assertEqual(expanded.reviewed_sha, fixture.head, "reviewed repository state");
    assertEqual(expanded.source.type, "claim", "expanded source type");
    assertEqual(expanded.source.authority_at_reviewed_sha, false, "stale claim authority");
    assertEqual(expanded.repository_validity.reviewed_sha_resolves, true, "reviewed SHA validity");
    assert(
      expanded.repository_validity.evidence.length > 0 &&
        expanded.repository_validity.evidence.every((item) => item.reachable_at_reviewed_sha),
      "evidence is not reachable at the reviewed commit",
    );
  } finally {
    fixture.cleanup();
  }
});

test("publication independently reconciles seams and seals payload plus trace", () => {
  const fixture = freshFixture();
  try {
    call(fixture.tools, fixture.ctx, "compile_review_brief", compileArgs("publish"));
    assertThrows(
      () =>
        fixture.db
          .prepare(
            "UPDATE review_briefs SET status='published', published_at=datetime('now') WHERE brief_id='publish'",
          )
          .run(),
      "requires a reconciled publication receipt",
    );
    assertThrows(
      () =>
        fixture.db
          .prepare(
            `INSERT INTO review_brief_publications
               (brief_id, brief_hash, reviewed_sha, control_score,
                included_trace_count, seam_count, session_id)
             SELECT brief_id, brief_hash, reviewed_sha, control_score, 0, 0, ?
               FROM review_briefs WHERE brief_id='publish'`,
          )
          .run(fixture.ctx.sessionId),
      "trace count does not reconcile",
    );
    const published = call(fixture.tools, fixture.ctx, "publish_review_brief", {
      brief_id: "publish",
    });
    assertEqual(published.status, "published", "publication status");
    assertEqual(published.publication.seam_count, 1, "published seam denominator");
    assertEqual(published.publication.brief_hash, published.brief_hash, "publication payload hash");
    const repeated = call(fixture.tools, fixture.ctx, "publish_review_brief", {
      brief_id: "publish",
    });
    assertEqual(
      repeated.publication.publication_id,
      published.publication.publication_id,
      "idempotent publication",
    );
    assertThrows(
      () =>
        fixture.db
          .prepare("UPDATE review_briefs SET task='tampered' WHERE brief_id='publish'")
          .run(),
      "immutable",
    );
    assertThrows(
      () => fixture.db.prepare("DELETE FROM review_brief_trace WHERE brief_id='publish'").run(),
      "cannot be deleted",
    );
    assertThrows(
      () =>
        fixture.db
          .prepare("UPDATE review_brief_publications SET seam_count=0 WHERE brief_id='publish'")
          .run(),
      "publication is immutable",
    );
  } finally {
    fixture.cleanup();
  }
});

test("same-cycle constraint, seam, and stale-claim ablations lower their predicted controls", () => {
  const fixture = freshFixture();
  try {
    const full = call(
      fixture.tools,
      fixture.ctx,
      "compile_review_brief",
      compileArgs("control-full"),
    );
    const arms = [
      ["task-constraints", "task_constraint_coverage"],
      ["impacted-seams", "impacted_seam_coverage"],
      ["stale-claims", "stale_claim_coverage"],
    ];
    for (const [ablation, component] of arms) {
      const briefId = `without-${ablation}`;
      const ablated = call(
        fixture.tools,
        fixture.ctx,
        "compile_review_brief",
        compileArgs(briefId, { validation_ablate: [ablation] }),
      );
      assertEqual(ablated.status, "blocked", `${ablation} publication state`);
      assert(
        ablated.control_score < full.control_score,
        `${ablation} did not lower total control score`,
      );
      assertEqual(
        ablated.brief.control_components[component],
        0,
        `${ablation} component direction`,
      );
      assertThrows(
        () => call(fixture.tools, fixture.ctx, "publish_review_brief", { brief_id: briefId }),
        "not publishable",
      );
      assert(
        ablated.trace
          .filter((trace) => trace.action === "blocked")
          .every((trace) => trace.obligation_id),
        `${ablation} blocking trace has no obligation`,
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test("benign rename does not inherit unrelated defects or seam history", () => {
  const fixture = freshFixture();
  try {
    const result = call(
      fixture.tools,
      fixture.ctx,
      "compile_review_brief",
      compileArgs("benign", {
        impact_run_id: "benign-impact",
        task: "Review the exact rename without changing behavior.",
      }),
    );
    assertEqual(result.status, "publishable", "benign brief status");
    assertEqual(result.brief.sections.historical_findings, [], "unrelated finding leakage");
    assertEqual(result.brief.sections.impacted_seams, [], "unrelated seam leakage");
    assertEqual(result.brief.sections.stale_claims, [], "unrelated stale-claim leakage");
    assert(
      result.brief.sections.changed_files.some(
        (item) => item.change_type === "renamed" && item.path_after === "src/benign-new.ts",
      ),
      "rename diff context missing",
    );
    const published = call(fixture.tools, fixture.ctx, "publish_review_brief", {
      brief_id: "benign",
    });
    assertEqual(published.publication.seam_count, 0, "benign seam denominator");
  } finally {
    fixture.cleanup();
  }
});

test("context profiles produce distinct declared context sets", () => {
  const fixture = freshFixture();
  try {
    const scoped = call(fixture.tools, fixture.ctx, "compile_review_brief", compileArgs("scoped"));
    const wide = call(
      fixture.tools,
      fixture.ctx,
      "compile_review_brief",
      compileArgs("wide", { context_profile: "control-wide" }),
    );
    assertEqual(scoped.brief.sections.unaffected_controls, [], "diff-scoped control inclusion");
    assert(wide.brief.sections.unaffected_controls.length === 2, "control-wide controls missing");
    assert(
      scoped.trace.some(
        (trace) =>
          trace.section === "unaffected_controls" &&
          trace.action === "omitted" &&
          trace.reason.startsWith("declared drop:"),
      ),
      "diff-scoped exclusions were not declared",
    );
    assert(wide.estimated_tokens > scoped.estimated_tokens, "context sets are not distinguishable");
  } finally {
    fixture.cleanup();
  }
});

test("repeat compilation cannot retrieve obligations created by an earlier brief", () => {
  const fixture = freshFixture();
  try {
    const first = call(fixture.tools, fixture.ctx, "compile_review_brief", compileArgs("repeat-a"));
    const second = call(
      fixture.tools,
      fixture.ctx,
      "compile_review_brief",
      compileArgs("repeat-b"),
    );
    const canonicalTrace = (brief) =>
      brief.trace.map((trace) => ({
        section: trace.section,
        action: trace.action,
        object_type: trace.object_type,
        object_id: trace.object_id,
        reason: trace.reason,
        provenance: trace.provenance,
      }));
    assertEqual(canonicalTrace(second), canonicalTrace(first), "repeat compilation context drift");
    assertEqual(
      ids(second.brief.sections.obligations, "obligation_id"),
      ids(first.brief.sections.obligations, "obligation_id"),
      "compiler-owned obligation feedback",
    );
  } finally {
    fixture.cleanup();
  }
});

test("budget exhaustion declares every loss and blocks publication", () => {
  const fixture = freshFixture();
  try {
    const result = call(
      fixture.tools,
      fixture.ctx,
      "compile_review_brief",
      compileArgs("budget", { token_budget: 64, context_profile: "control-wide" }),
    );
    assertEqual(result.status, "blocked", "budget status");
    assert(result.brief.budget_truncation.length > 0, "budget loss was not declared");
    assert(
      result.brief.budget_truncation.every((item) => item.obligation_id),
      "budget loss has no obligation destination",
    );
    assert(
      result.trace
        .filter((trace) => trace.action === "blocked" || trace.action === "truncated")
        .every((trace) => trace.obligation_id),
      "blocked or truncated trace lost custody",
    );
    assertThrows(
      () => call(fixture.tools, fixture.ctx, "publish_review_brief", { brief_id: "budget" }),
      "not publishable",
    );
  } finally {
    fixture.cleanup();
  }
});

test("evidence newer than the reviewed commit is blocked with durable custody", () => {
  const fixture = freshFixture();
  try {
    writeFileSync(join(fixture.workspace, "src/control.ts"), "export const acceptsVersion = 2;\n");
    git(fixture.workspace, "add", "src/control.ts");
    git(fixture.workspace, "commit", "-q", "--no-verify", "-m", "future evidence");
    const futureSha = git(fixture.workspace, "rev-parse", "HEAD");
    const futureEvidence = call(fixture.tools, fixture.ctx, "add_evidence", {
      file_path: "src/control.ts",
      ref_sha: futureSha,
      kind: "code-verified",
      note: "not valid at the earlier reviewed commit",
    });
    fixture.db
      .prepare(
        "INSERT INTO finding_evidence (finding_id, evidence_id, role) VALUES ('finding-c', ?, 'root-cause')",
      )
      .run(futureEvidence.id);

    const result = call(
      fixture.tools,
      fixture.ctx,
      "compile_review_brief",
      compileArgs("future-evidence"),
    );
    assertEqual(result.status, "blocked", "future evidence status");
    const blocked = result.trace.find(
      (trace) => trace.object_id === "finding-c" && trace.action === "blocked",
    );
    assert(blocked?.reason.includes("not reachable"), "future evidence reason missing");
    assert(blocked.obligation_id, "future evidence has no obligation destination");
    assertThrows(
      () =>
        call(fixture.tools, fixture.ctx, "publish_review_brief", {
          brief_id: "future-evidence",
        }),
      "not publishable",
    );
  } finally {
    fixture.cleanup();
  }
});

console.log(`\nreview brief: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
