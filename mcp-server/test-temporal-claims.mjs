#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { openDatabase } from "./dist/db.js";
import { ensureProjectStorage, resolveProject } from "./dist/project.js";
import { claimTools } from "./dist/tools/claims.js";
import { concernTools } from "./dist/tools/concerns.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { projectTools } from "./dist/tools/project.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const tools = new Map(
  [...projectTools, ...concernTools, ...evidenceTools, ...claimTools].map((tool) => [
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
  if (actual !== expected) {
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

function freshContext() {
  const root = mkdtempSync(join(tmpdir(), "temporal-claims-"));
  const workspace = join(root, "workspace");
  const storage = join(root, "storage");
  mkdirSync(workspace);
  git(workspace, "init", "-q");
  git(workspace, "config", "user.email", "test@example.com");
  git(workspace, "config", "user.name", "Temporal Claims Test");

  const commits = [];
  for (const value of ["A", "B", "C", "D"]) {
    writeFileSync(join(workspace, "fixture.txt"), `${value}\n`);
    git(workspace, "add", "fixture.txt");
    git(workspace, "commit", "-q", "-m", `fixture ${value}`);
    commits.push(git(workspace, "rev-parse", "HEAD"));
  }

  process.env.AMANUENSIS_STORAGE_ROOT = storage;
  const project = resolveProject(workspace);
  ensureProjectStorage(project, (databasePath) => {
    const database = openDatabase(databasePath);
    database.close();
  });
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  const session = call("start_session", { intent: "temporal-claims-test" }, ctx);
  ctx.sessionId = session.session_id;

  const evidence = commits.map((sha, index) =>
    call(
      "add_evidence",
      {
        file_path: "fixture.txt",
        line_range: "1-1",
        ref_sha: sha,
        kind: "test-observed",
        note: `fixture ${index}`,
      },
      ctx,
    ).id,
  );

  return {
    ctx,
    commits,
    evidence,
    cleanup: () => {
      if (ctx.db.open) ctx.db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function addClaim(ctx, overrides = {}) {
  return call(
    "add_claim",
    {
      claim_id: "claim-1",
      claim_key: "fixture.behavior",
      subject_type: "subsystem",
      subject_id: "B-01",
      statement: "The fixture behaves as observed.",
      epistemic_kind: "observation",
      ref_sha: overrides.ref_sha,
      evidence_ids: overrides.evidence_ids,
      ...overrides,
    },
    ctx,
  );
}

test("write gates reject untyped, unsupported, unknown, and competing authority transactionally", () => {
  const { ctx, commits, evidence, cleanup } = freshContext();
  try {
    assertThrows(
      () => addClaim(ctx, { ref_sha: commits[0], evidence_ids: [] }),
      "evidence_ids must contain at least one",
    );
    assertThrows(
      () =>
        addClaim(ctx, {
          ref_sha: commits[0],
          evidence_ids: [evidence[0]],
          epistemic_kind: "fact",
        }),
      "epistemic_kind must be one of",
    );
    assertThrows(
      () => addClaim(ctx, { ref_sha: "not-a-commit", evidence_ids: [evidence[0]] }),
      "unknown git commit",
    );
    assertThrows(
      () => addClaim(ctx, { ref_sha: commits[0], evidence_ids: [evidence[1]] }),
      "is not reachable at authority commit",
    );
    assertThrows(
      () =>
        addClaim(ctx, {
          ref_sha: commits[0],
          valid_from_sha: commits[1],
          evidence_ids: [evidence[0]],
        }),
      "is not an ancestor of asserted_at_sha",
    );
    assertEqual(ctx.db.prepare("SELECT COUNT(*) AS n FROM claims").get().n, 0, "rejected writes leaked");

    addClaim(ctx, { ref_sha: commits[0], evidence_ids: [evidence[0]] });
    assertThrows(
      () =>
        addClaim(ctx, {
          claim_id: "claim-2",
          ref_sha: commits[0],
          evidence_ids: [evidence[0]],
        }),
      "already has current authority",
    );
    assertEqual(ctx.db.prepare("SELECT COUNT(*) AS n FROM claims").get().n, 1, "conflict leaked");
  } finally {
    cleanup();
  }
});

test("bounded exhaustive exclusive intervals agree with every query position", () => {
  const { ctx, commits, evidence, cleanup } = freshContext();
  try {
    let intervals = 0;
    for (let from = 0; from < commits.length - 1; from++) {
      for (let until = from + 1; until < commits.length; until++) {
        const claimId = `interval-${from}-${until}`;
        addClaim(ctx, {
          claim_id: claimId,
          claim_key: claimId,
          ref_sha: commits[from],
          evidence_ids: [evidence[from]],
        });
        call(
          "invalidate_claim",
          {
            claim_id: claimId,
            at_sha: commits[until],
            reason: "bounded interval fixture",
            evidence_ids: [evidence[until]],
          },
          ctx,
        );
        for (let query = 0; query < commits.length; query++) {
          const rows = call("get_claims", { claim_id: claimId, query_sha: commits[query] }, ctx);
          const expected = query >= from && query < until ? 1 : 0;
          assertEqual(rows.length, expected, `${claimId} at query ${query}`);
        }
        intervals++;
      }
    }
    assertEqual(intervals, 6, "unexpected bounded interval count");
  } finally {
    cleanup();
  }
});

test("every epistemic kind survives storage and retrieval without coercion", () => {
  const { ctx, commits, evidence, cleanup } = freshContext();
  try {
    const kinds = [
      "observation",
      "inference",
      "hypothesis",
      "open-question",
      "direct-intent",
      "inferred-intent",
      "decision",
    ];
    for (const kind of kinds) {
      addClaim(ctx, {
        claim_id: `kind-${kind}`,
        claim_key: `kind.${kind}`,
        epistemic_kind: kind,
        ref_sha: commits[0],
        evidence_ids: [evidence[0]],
      });
    }
    const rows = call("get_claims", {}, ctx);
    assertEqual(rows.length, kinds.length, "epistemic kind row count");
    assertEqual(
      rows.map((row) => row.epistemic_kind).sort().join(","),
      [...kinds].sort().join(","),
      "epistemic kinds were coerced",
    );
  } finally {
    cleanup();
  }
});

test("invalid boundaries and reused evidence leave the current claim untouched", () => {
  const { ctx, commits, evidence, cleanup } = freshContext();
  try {
    addClaim(ctx, { ref_sha: commits[1], evidence_ids: [evidence[1]] });
    assertThrows(
      () =>
        call(
          "invalidate_claim",
          {
            claim_id: "claim-1",
            at_sha: commits[0],
            reason: "a boundary before the claim opened",
            evidence_ids: [evidence[0]],
          },
          ctx,
        ),
      "or a descendant of it",
    );
    assertThrows(
      () =>
        call(
          "invalidate_claim",
          {
            claim_id: "claim-1",
            at_sha: commits[2],
            reason: "reused evidence fixture",
            evidence_ids: [evidence[1]],
          },
          ctx,
        ),
      "requires new evidence",
    );
    const row = ctx.db.prepare("SELECT valid_until_sha FROM claims WHERE claim_id='claim-1'").get();
    assertEqual(row.valid_until_sha, null, "rejected invalidation changed the interval");
  } finally {
    cleanup();
  }
});

test("supersession is continuous, evidenced, historical, and cycle-safe", () => {
  const { ctx, commits, evidence, cleanup } = freshContext();
  try {
    addClaim(ctx, { ref_sha: commits[0], evidence_ids: [evidence[0]] });
    assertThrows(
      () =>
        call(
          "supersede_claim",
          {
            predecessor_claim_id: "claim-1",
            successor_claim_id: "claim-2",
            statement: "Replacement",
            epistemic_kind: "inference",
            at_sha: commits[1],
            rationale: "fixture replacement",
            evidence_ids: [evidence[0]],
          },
          ctx,
        ),
      "requires new evidence",
    );
    assertEqual(ctx.db.prepare("SELECT COUNT(*) AS n FROM claims").get().n, 1, "failed edge leaked");

    call(
      "supersede_claim",
      {
        predecessor_claim_id: "claim-1",
        successor_claim_id: "claim-2",
        statement: "The fixture now supports a narrower inference.",
        epistemic_kind: "inference",
        at_sha: commits[1],
        rationale: "new fixture evidence changed the claim",
        evidence_ids: [evidence[1]],
      },
      ctx,
    );
    assertEqual(call("get_claims", { query_sha: commits[0] }, ctx)[0].claim_id, "claim-1", "A view");
    assertEqual(call("get_claims", { query_sha: commits[1] }, ctx)[0].claim_id, "claim-2", "B view");

    const history = call("get_claim_history", { claim_key: "fixture.behavior" }, ctx);
    assertEqual(history.claims.length, 2, "history versions");
    assertEqual(history.edges.length, 1, "history edges");
    assertEqual(history.events.length, 3, "history events");
    assertEqual(history.claims[0].valid_until_sha, history.claims[1].valid_from_sha, "validity gap");

    assertThrows(
      () =>
        call(
          "supersede_claim",
          {
            predecessor_claim_id: "claim-2",
            successor_claim_id: "claim-1",
            statement: "Cycle",
            epistemic_kind: "observation",
            at_sha: commits[2],
            rationale: "cycle fixture",
            evidence_ids: [evidence[2]],
          },
          ctx,
        ),
      "supersession cycle",
    );
    assertThrows(
      () =>
        ctx.db
          .prepare(
            `INSERT INTO claim_supersessions
               (predecessor_claim_id, successor_claim_id, at_sha, evidence_id, rationale, session_id)
             VALUES ('claim-2', 'claim-1', ?, ?, 'direct cycle fixture', ?)`,
          )
          .run(commits[2], evidence[2], ctx.sessionId),
      "claim supersession cycle",
    );
  } finally {
    cleanup();
  }
});

test("invalidation and supersession return the event a challenge outcome cites", () => {
  const { ctx, commits, evidence, cleanup } = freshContext();
  try {
    const challenge =
      "Looked for a second writer of fixture.txt across the history and found the value changed.";
    addClaim(ctx, { ref_sha: commits[0], evidence_ids: [evidence[0]] });
    const superseded = call(
      "supersede_claim",
      {
        predecessor_claim_id: "claim-1",
        successor_claim_id: "claim-2",
        statement: "The fixture now reads B.",
        epistemic_kind: "observation",
        at_sha: commits[1],
        rationale: "the value moved on",
        evidence_ids: [evidence[1]],
      },
      ctx,
    );
    const event = (id) =>
      ctx.db.prepare("SELECT claim_id, event_type FROM claim_validity_events WHERE id = ?").get(id);
    assertEqual(event(superseded.validity_event_id)?.event_type, "superseded", "supersede event id");
    call(
      "record_claim_challenge",
      {
        claim_id: "claim-1",
        outcome: "superseded",
        challenge,
        ref_sha: commits[1],
        validity_event_id: superseded.validity_event_id,
      },
      ctx,
    );

    const invalidated = call(
      "invalidate_claim",
      { claim_id: "claim-2", at_sha: commits[2], reason: "contradicted", evidence_ids: [evidence[2]] },
      ctx,
    );
    assertEqual(event(invalidated.validity_event_id)?.event_type, "invalidated", "invalidate event id");
    call(
      "record_claim_challenge",
      {
        claim_id: "claim-2",
        outcome: "overturned",
        challenge,
        ref_sha: commits[2],
        validity_event_id: invalidated.validity_event_id,
      },
      ctx,
    );
    assertEqual(
      ctx.db.prepare("SELECT COUNT(*) AS n FROM claim_challenge_outcomes").get().n,
      2,
      "both outcomes recorded",
    );
  } finally {
    cleanup();
  }
});

function addEvidenceAt(ctx, sha, note) {
  return call(
    "add_evidence",
    { file_path: "fixture.txt", line_range: "1-1", ref_sha: sha, kind: "test-observed", note },
    ctx,
  ).id;
}

const CHALLENGE =
  "Looked for every reader of fixture.txt at the recorded commit and found one the claim leaves out.";

test("a claim wrong at the commit it was recorded at is overturned there and never held (B04-R6)", () => {
  const { ctx, commits, evidence, cleanup } = freshContext();
  try {
    addClaim(ctx, { ref_sha: commits[1], evidence_ids: [evidence[1]] });
    const disproof = addEvidenceAt(ctx, commits[1], "the reader the claim missed");
    const closed = call(
      "invalidate_claim",
      { claim_id: "claim-1", at_sha: commits[1], reason: "wrong when recorded", evidence_ids: [disproof] },
      ctx,
    );
    assertEqual(closed.valid_until_sha, commits[1], "closed at its own valid_from_sha");
    for (const sha of commits) {
      assertEqual(call("get_claims", { query_sha: sha }, ctx).length, 0, `never held, yet current at ${sha}`);
    }
    call(
      "record_claim_challenge",
      {
        claim_id: "claim-1",
        outcome: "overturned",
        challenge: CHALLENGE,
        ref_sha: commits[1],
        validity_event_id: closed.validity_event_id,
      },
      ctx,
    );
    const outcome = ctx.db.prepare("SELECT outcome FROM claim_challenge_outcomes").get();
    assertEqual(outcome?.outcome, "overturned", "the negative outcome is recorded");
  } finally {
    cleanup();
  }
});

test("an imprecise claim is corrected at the commit it was recorded at (B04-R6)", () => {
  const { ctx, commits, evidence, cleanup } = freshContext();
  try {
    addClaim(ctx, { ref_sha: commits[1], evidence_ids: [evidence[1]] });
    const reader = addEvidenceAt(ctx, commits[1], "the second reader");
    const corrected = call(
      "supersede_claim",
      {
        predecessor_claim_id: "claim-1",
        successor_claim_id: "claim-2",
        statement: "The fixture has two readers; the search path is not one of them.",
        epistemic_kind: "observation",
        at_sha: commits[1],
        rationale: "the recorded statement overstated its scope",
        evidence_ids: [reader],
      },
      ctx,
    );
    assertEqual(corrected.boundary_sha, commits[1], "corrected at the recording commit");
    for (const sha of commits.slice(1)) {
      const current = call("get_claims", { query_sha: sha }, ctx).map((c) => c.claim_id);
      assertEqual(JSON.stringify(current), JSON.stringify(["claim-2"]), `as of ${sha}`);
    }
    assertEqual(call("get_claims", { query_sha: commits[0] }, ctx).length, 0, "before either opened");
    call(
      "record_claim_challenge",
      {
        claim_id: "claim-1",
        outcome: "superseded",
        challenge: CHALLENGE,
        ref_sha: commits[1],
        validity_event_id: corrected.validity_event_id,
      },
      ctx,
    );
  } finally {
    cleanup();
  }
});

test("a store created with the never-held CHECK is rebuilt without it, rows and triggers intact", () => {
  const { ctx, commits, evidence, cleanup } = freshContext();
  try {
    const db = ctx.db;
    // Put the claims table back in the shape every store before B04-R6 has.
    const live = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='claims'").get().sql;
    const old = live.replace(
      /CHECK \(length\(statement\) > 0\)/,
      "CHECK (length(statement) > 0),\n    CHECK (valid_until_sha IS NULL OR valid_until_sha != valid_from_sha)",
    );
    assert(old !== live, "could not build the old claims DDL");
    const objects = db
      .prepare("SELECT sql FROM sqlite_master WHERE tbl_name='claims' AND sql IS NOT NULL AND type IN ('index','trigger')")
      .all();
    db.pragma("foreign_keys = OFF");
    db.pragma("legacy_alter_table = ON");
    db.exec("DROP TABLE claims");
    db.exec(old);
    for (const object of objects) db.exec(object.sql);
    db.pragma("legacy_alter_table = OFF");
    db.pragma("foreign_keys = ON");
    addClaim(ctx, { ref_sha: commits[1], evidence_ids: [evidence[1]] });
    assertThrows(
      () => db.prepare("UPDATE claims SET valid_until_sha = valid_from_sha").run(),
      "CHECK constraint failed",
    );

    const dbPath = ctx.project.dbPath;
    db.close();
    ctx.db = openDatabase(dbPath);
    const rebuilt = ctx.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='claims'").get().sql;
    assert(!rebuilt.includes("valid_until_sha != valid_from_sha"), "the CHECK survived the reopen");
    assertEqual(ctx.db.prepare("SELECT statement FROM claims").get()?.statement, "The fixture behaves as observed.", "row kept");
    for (const name of ["claims_versions_are_immutable", "idx_claims_current_key"]) {
      assert(ctx.db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name), `${name} lost in the rebuild`);
    }
    const disproof = addEvidenceAt(ctx, commits[1], "after the rebuild");
    const closed = call(
      "invalidate_claim",
      { claim_id: "claim-1", at_sha: commits[1], reason: "wrong when recorded", evidence_ids: [disproof] },
      ctx,
    );
    assertEqual(closed.valid_until_sha, commits[1], "closes at its own commit after the rebuild");
  } finally {
    cleanup();
  }
});

test("legacy projection is typed without mutating its source rows", () => {
  const { ctx, commits, evidence, cleanup } = freshContext();
  try {
    ctx.db
      .prepare(
        `INSERT INTO entries (id, tier, source_path, ref_sha, confidence)
         VALUES ('legacy-entry', 1, 'legacy.md', ?, 'inferred')`,
      )
      .run(commits[0]);
    call("add_concern", { code: "LEGACY", origin: "seeded" }, ctx);
    ctx.db
      .prepare(
        `INSERT INTO dispositions
           (subsystem_id, concern_code, classification, evidence, rationale, ref_sha)
         VALUES ('B-01', 'LEGACY', 'ruled-out', 'fixture.txt:1@sha', 'legacy rationale', ?)`,
      )
      .run(commits[0]);
    for (const id of ["F-1", "F-2"]) {
      ctx.db
        .prepare(
          `INSERT INTO findings
             (finding_id, subsystem_id, symptom, root_cause, severity, status, ref_sha)
           VALUES (?, 'B-01', ?, ?, 'LOW', 'ruled-out', ?)`,
        )
        .run(id, `${id} symptom`, `${id} cause`, commits[0]);
    }
    ctx.db
      .prepare(
        `INSERT INTO contradictions
           (finding_a, finding_b, conflict_type, resolution)
         VALUES ('F-1', 'F-2', 'fixture-conflict', 'unresolved')`,
      )
      .run();

    const rows = call("get_legacy_claim_projection", {}, ctx);
    const sources = new Set(rows.map((row) => row.legacy_source));
    for (const source of ["entries", "evidence", "dispositions", "findings", "contradictions"]) {
      assert(sources.has(source), `projection omitted ${source}`);
    }
    const rootCause = rows.find((row) => row.claim_id === "legacy:finding:F-1:root-cause");
    assertEqual(rootCause.epistemic_kind, "inference", "root-cause kind");
    assertEqual(
      ctx.db.prepare("SELECT rationale FROM dispositions WHERE concern_code='LEGACY'").get().rationale,
      "legacy rationale",
      "projection mutated legacy row",
    );
    assert(rows.some((row) => row.claim_id === `legacy:evidence:${evidence[0]}`), "evidence missing");
  } finally {
    cleanup();
  }
});

test("opening a pre-A1 database adds claim storage without changing legacy content", () => {
  const root = mkdtempSync(join(tmpdir(), "temporal-claims-migration-"));
  const dbPath = join(root, "memory.db");
  const artifactPath = join(root, "legacy-artifact.md");
  try {
    const schema = readFileSync(join(ROOT, "src/schema.sql"), "utf8");
    const legacySchema = schema.replace(
      /-{70}\n-- TEMPORAL CLAIMS:[\s\S]*?(?=-{70}\n-- DIAGNOSTICITY MATRIX:)/,
      "",
    );
    const legacyDb = new Database(dbPath);
    legacyDb.exec(legacySchema);
    legacyDb
      .prepare(
        "INSERT INTO entries (id, tier, source_path, confidence) VALUES ('before-a1', 0, 'legacy-artifact.md', 'unverified')",
      )
      .run();
    legacyDb.close();
    writeFileSync(artifactPath, "legacy bytes remain readable\n");

    const migrated = openDatabase(dbPath);
    assertEqual(
      migrated.prepare("SELECT source_path FROM entries WHERE id='before-a1'").get().source_path,
      "legacy-artifact.md",
      "legacy row changed",
    );
    assert(
      migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='claims'").get(),
      "claims table not added",
    );
    assertEqual(readFileSync(artifactPath, "utf8"), "legacy bytes remain readable\n", "artifact changed");
    migrated.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\ntemporal claims: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
