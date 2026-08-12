#!/usr/bin/env node
// A10: storage-independent CodebaseBrief contract, deterministic selection, and omission custody.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  compileBrief,
  finalizeCandidate,
  finalizeSource,
  validateCodebaseBrief,
  validateSource,
} from "./dist/codebase-brief-contract.js";
import { openDatabase } from "./dist/db.js";
import { codebaseBriefTools } from "./dist/tools/codebase-brief.js";
import { projectTools } from "./dist/tools/project.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SOURCE_INPUT = JSON.parse(
  readFileSync(join(ROOT, "fixtures/codebase-brief/source-input.json"), "utf8"),
);
const SCHEMA = JSON.parse(readFileSync(join(ROOT, "contracts/codebase-brief.schema.json"), "utf8"));
const validateSchema = new Ajv2020({ strict: true }).compile(SCHEMA);
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

function sourceFixture() {
  return finalizeSource({
    ...SOURCE_INPUT,
    candidates: SOURCE_INPUT.candidates.map((candidate) => finalizeCandidate(candidate)),
  });
}

function flatten(brief) {
  return Object.values(brief.sections).flat();
}

function projection(source, mode, overrides = {}) {
  return compileBrief(source, {
    brief_id: `fixture-${mode}-${overrides.suffix ?? "default"}`,
    mode,
    item_limit: overrides.item_limit ?? 20,
    registry_ids: overrides.registry_ids ?? [],
    lexical_query: overrides.lexical_query ?? "",
  });
}

test("contract fixture validates without any SQLite implementation", () => {
  const source = sourceFixture();
  assertEqual(validateSource(source), [], "source contract validation failed");
  for (const mode of ["review", "design", "generative"]) {
    const brief = projection(source, mode);
    assert(
      validateSchema(brief),
      `${mode} failed JSON Schema: ${JSON.stringify(validateSchema.errors)}`,
    );
    assert(validateCodebaseBrief(brief).ok, `${mode} failed semantic validation`);
  }
});

test("one immutable source produces materially different mode projections", () => {
  const source = sourceFixture();
  const review = projection(source, "review");
  const design = projection(source, "design");
  const generative = projection(source, "generative");
  assertEqual(
    [review.source.source_hash, design.source.source_hash, generative.source.source_hash],
    [source.source_hash, source.source_hash, source.source_hash],
    "mode projections changed source truth",
  );
  assert(
    flatten(review).some((item) => item.candidate_id === "fact:historical-v0"),
    "review lost history",
  );
  assert(
    !flatten(generative).some((item) => item.candidate_id === "fact:historical-v0"),
    "generative mode included review-only history",
  );
  assert(
    flatten(design).some((item) => item.candidate_id === "option:adapter"),
    "design lost options",
  );
  assert(
    !flatten(review).some((item) => item.candidate_id === "option:adapter"),
    "review included a design-only option",
  );
});

test("serialization preserves observation, direct intent, inferred intent, and recommendation", () => {
  const roundTrip = JSON.parse(JSON.stringify(projection(sourceFixture(), "design")));
  const kinds = new Set(flatten(roundTrip).map((item) => item.epistemic_kind));
  for (const kind of ["observed-behavior", "direct-intent", "inferred-intent", "recommendation"]) {
    assert(kinds.has(kind), `round trip lost ${kind}`);
  }
});

test("exact registry identity wins before lexical selection with zero model calls", () => {
  const brief = projection(sourceFixture(), "generative", {
    suffix: "registry",
    item_limit: 3,
    lexical_query: "nothing matches this query",
    registry_ids: ["fact:producer-v2"],
  });
  const selected = flatten(brief).find((item) => item.candidate_id === "fact:producer-v2");
  assertEqual(selected.selection_basis, "registry-exact", "registry identity was not preserved");
  assertEqual(brief.selection.model_calls, 0, "registry route invoked a model");
});

test("every exclusion is explicit as policy, irrelevance, or budget", () => {
  const brief = projection(sourceFixture(), "review", {
    suffix: "omissions",
    item_limit: 4,
    lexical_query: "event compatibility migration",
  });
  assertEqual(
    brief.source_manifest.length,
    brief.budget.selected_count + brief.budget.omitted_count,
    "source census did not reconcile",
  );
  assertEqual(
    [...new Set(brief.omissions.map((item) => item.reason))].sort(),
    ["budget", "irrelevant", "policy"],
    "omission reasons did not exercise all declared cases",
  );
});

test("red gate rejects erased epistemic kind and silent omission", () => {
  const original = projection(sourceFixture(), "review", {
    suffix: "red",
    item_limit: 4,
    lexical_query: "event compatibility migration",
  });
  const erasedKind = structuredClone(original);
  delete flatten(erasedKind)[0].epistemic_kind;
  assert(!validateSchema(erasedKind), "JSON Schema accepted a missing epistemic kind");
  assert(
    !validateCodebaseBrief(erasedKind).ok,
    "semantic validation accepted a missing epistemic kind",
  );
  const silent = structuredClone(original);
  silent.omissions.pop();
  silent.budget.omitted_count--;
  const report = validateCodebaseBrief(silent);
  assert(!report.ok, "semantic validation accepted silent truncation");
  assert(
    report.errors.some((error) => error.includes("source manifest")),
    `silent truncation failed for the wrong reason: ${report.errors.join("; ")}`,
  );
});

function toolFixture() {
  const root = mkdtempSync(join(tmpdir(), "amanuensis-codebase-brief-"));
  const project = {
    workspacePath: root,
    projectKey: "test/codebase-brief",
    storagePath: root,
    dbPath: join(root, "memory.db"),
    storageGitReady: false,
  };
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  const tools = new Map([...projectTools, ...codebaseBriefTools].map((tool) => [tool.name, tool]));
  const session = tools.get("start_session").handler({ intent: "codebase-brief-contract" }, ctx);
  ctx.sessionId = session.session_id;
  db.pragma("foreign_keys = OFF");
  db.prepare(
    `INSERT INTO review_sessions
       (review_session_id, composition_run_id, impact_run_id, reviewed_sha,
        item_count, actionable_count, summary_json, summary_hash, prepared_by)
     VALUES ('tool-review', 'fixture-composition', 'fixture-impact', ?, 2, 1, '{}', 'summary', ?)`,
  ).run(SOURCE_INPUT.reviewed_sha, ctx.sessionId);
  for (const [ordinal, item] of [
    {
      id: "review-item:change",
      section: "situation",
      state: "changed",
      kind: "observation",
      statement: "The event version changed from 1 to 2.",
      sourceType: "change-file",
    },
    {
      id: "review-item:unknown",
      section: "unknowns",
      state: "unknown",
      kind: "open-question",
      statement: "The rollout order remains unknown.",
      sourceType: "open-question",
    },
  ].entries()) {
    db.prepare(
      `INSERT INTO review_session_items
         (review_session_id, item_id, ordinal, section, semantic_state, epistemic_kind,
          actionable, statement, source_type, source_id, record_uri, compact_json, compact_hash)
       VALUES ('tool-review', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 'compact')`,
    ).run(
      item.id,
      ordinal,
      item.section,
      item.state,
      item.kind,
      item.state === "changed" ? 1 : 0,
      item.statement,
      item.sourceType,
      item.id,
      `amanuensis://${item.sourceType}/${item.id}`,
    );
  }
  db.pragma("foreign_keys = ON");
  return { root, db, ctx, tools };
}

function call(fixture, name, args) {
  const tool = fixture.tools.get(name);
  assert(tool, `unknown tool: ${name}`);
  return tool.handler(args, fixture.ctx);
}

test("MCP source, compilation, lookup, and validation preserve contract custody", () => {
  const fixture = toolFixture();
  try {
    const source = call(fixture, "prepare_codebase_brief_source", {
      source_id: "tool-source",
      review_session_id: "tool-review",
      objective: "Design the event migration.",
      constraints: [
        {
          constraint_id: "compatibility",
          statement: "Keep existing consumers compatible.",
          source_kind: "direct-user",
          source_ref: "fixture-user",
        },
      ],
      inferred_intents: [
        {
          id: "adapter-owner",
          statement: "The adapter appears intended to own compatibility.",
          source_item_ids: ["review-item:change"],
          relevance_terms: ["event", "adapter"],
        },
      ],
      options: [
        {
          id: "dual-read",
          statement: "Accept both event versions during rollout.",
          source_item_ids: ["review-item:change", "review-item:unknown"],
          relevance_terms: ["event", "rollout"],
        },
      ],
    });
    assertEqual(validateSource(source), [], "prepared source did not validate");
    const compiled = call(fixture, "compile_codebase_brief", {
      brief_id: "tool-design",
      source_id: "tool-source",
      mode: "design",
      item_limit: 6,
      lexical_query: "event rollout compatibility",
    });
    assert(
      validateSchema(compiled.brief),
      `tool brief failed schema: ${JSON.stringify(validateSchema.errors)}`,
    );
    const lookup = call(fixture, "lookup_codebase_brief_objects", {
      source_id: "tool-source",
      candidate_ids: ["review-item:change"],
    });
    assertEqual(lookup.lookup_route, "registry-exact", "tool lookup did not use registry route");
    assertEqual(lookup.model_calls, 0, "tool lookup invoked a model");
    assertEqual(lookup.candidates[0].candidate_id, "review-item:change", "lookup changed identity");
    const validation = call(fixture, "validate_codebase_brief", { brief_id: "tool-design" });
    assert(validation.ok, `stored brief did not validate: ${validation.errors.join("; ")}`);
  } finally {
    fixture.db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

console.log(`\nCodebaseBrief: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
