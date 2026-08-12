#!/usr/bin/env node
// A11: independent dialectical design lenses, preserved disagreement, and underdetermination.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileBrief, finalizeCandidate, finalizeSource } from "./dist/codebase-brief-contract.js";
import { openDatabase } from "./dist/db.js";
import { designSessionTools } from "./dist/tools/design-session.js";
import { projectTools } from "./dist/tools/project.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const INPUT = JSON.parse(
  readFileSync(join(ROOT, "fixtures/codebase-brief/source-input.json"), "utf8"),
);
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
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}
function assertThrows(fn, text) {
  let error = null;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  if (!error || !error.message.includes(text))
    throw new Error(`expected error containing ${text}, got ${error?.message}`);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "amanuensis-design-session-"));
  const project = {
    workspacePath: root,
    projectKey: "test/design",
    storagePath: root,
    dbPath: join(root, "memory.db"),
    storageGitReady: false,
  };
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  const tools = new Map([...projectTools, ...designSessionTools].map((tool) => [tool.name, tool]));
  ctx.sessionId = tools
    .get("start_session")
    .handler({ intent: "design-session-controls" }, ctx).session_id;
  const source = finalizeSource({ ...INPUT, candidates: INPUT.candidates.map(finalizeCandidate) });
  const briefs = Object.fromEntries(
    ["review", "design", "generative"].map((mode) => [
      mode,
      compileBrief(source, { brief_id: `brief-${mode}`, mode, item_limit: 20, lexical_query: "" }),
    ]),
  );
  db.pragma("foreign_keys = OFF");
  db.prepare(
    `INSERT INTO codebase_brief_sources (source_id, review_session_id, reviewed_sha, schema_version, candidate_count, source_json, source_hash, prepared_by) VALUES (?, ?, ?, '1.0.0', ?, ?, ?, ?)`,
  ).run(
    source.source_id,
    source.review_session_id,
    source.reviewed_sha,
    source.candidates.length,
    JSON.stringify(source),
    source.source_hash,
    ctx.sessionId,
  );
  for (const brief of Object.values(briefs))
    db.prepare(
      `INSERT INTO codebase_briefs (brief_id, source_id, mode, schema_version, item_limit, included_count, omitted_count, brief_json, brief_hash, compiled_by) VALUES (?, ?, ?, '1.0.0', ?, ?, ?, ?, 'fixture', ?)`,
    ).run(
      brief.brief_id,
      source.source_id,
      brief.mode,
      brief.budget.item_limit,
      brief.budget.selected_count,
      brief.budget.omitted_count,
      JSON.stringify(brief),
      ctx.sessionId,
    );
  db.pragma("foreign_keys = ON");
  return { root, db, ctx, tools };
}
function call(f, name, args) {
  return f.tools.get(name).handler(args, f.ctx);
}
function lensSpecs() {
  return [
    {
      lens: "immanent",
      brief_id: "brief-review",
      provider: "fixture",
      model: "model-a",
      model_family: "family-a",
    },
    {
      lens: "adversarial",
      brief_id: "brief-design",
      provider: "fixture",
      model: "model-b",
      model_family: "family-b",
    },
    {
      lens: "speculative",
      brief_id: "brief-generative",
      provider: "fixture",
      model: "model-c",
      model_family: "family-c",
    },
  ];
}
function desires(conflicted = false) {
  return conflicted
    ? [
        {
          desire_id: "stability",
          statement: "Never run two versions.",
          exclusive_group: "rollout",
          source_kind: "direct-user",
          source_ref: "fixture",
        },
        {
          desire_id: "availability",
          statement: "Never interrupt the rollout.",
          exclusive_group: "rollout",
          source_kind: "direct-user",
          source_ref: "fixture",
        },
      ]
    : [
        {
          desire_id: "compatibility",
          statement: "Preserve existing consumers.",
          priority: 5,
          source_kind: "direct-user",
          source_ref: "fixture",
        },
        {
          desire_id: "reversibility",
          statement: "Keep rollback possible.",
          priority: 4,
          source_kind: "direct-user",
          source_ref: "fixture",
        },
      ];
}
function option(key, preserves, evidence, variant) {
  return {
    option_key: key,
    summary: variant,
    preserves,
    rejects: [],
    enables: [key === "adapter" ? "gradual rollout" : "simple cutover"],
    forecloses: [key === "adapter" ? "single-version purity" : "mixed-version availability"],
    migration_cost: { level: key === "adapter" ? "medium" : "low", rationale: `${variant} cost` },
    reversibility: {
      level: key === "adapter" ? "reversible" : "partially-reversible",
      conditions: `${variant} rollback`,
    },
    evidence_item_ids: [evidence],
    evidence_gaps: ["production rate unknown"],
    falsifiers: ["compatibility test fails"],
    research_needs: ["measure rollout overlap"],
  };
}
function runSession(f, id, conflicted = false) {
  call(f, "plan_design_session", {
    design_session_id: id,
    desires: desires(conflicted),
    lens_specs: lensSpecs(),
    orchestrator_model_family: "orchestrator-family",
  });
  const packets = {};
  for (const lens of ["immanent", "adversarial", "speculative"])
    packets[lens] = call(f, "dispatch_design_lens", { design_session_id: id, lens }).runtime_input;
  for (const lens of ["immanent", "adversarial", "speculative"]) {
    const evidence = Object.values(packets[lens].context).flat()[0].candidate_id;
    const preserve = conflicted
      ? [lens === "speculative" ? "availability" : "stability"]
      : ["compatibility", "reversibility"];
    const variant = {
      immanent: "incremental",
      adversarial: "stress-tested",
      speculative: "adjacent",
    }[lens];
    call(f, "land_design_lens", {
      design_session_id: id,
      lens,
      options: [
        option("adapter", preserve, evidence, `${variant} adapter`),
        option("cutover", [], evidence, `${variant} cutover`),
      ],
      preferred_option_key: lens === "speculative" ? "cutover" : "adapter",
      analysis: `${lens} independent analysis`,
      detected_contradictions: conflicted ? [{ desires: ["stability", "availability"] }] : [],
    });
  }
  return call(f, "aggregate_design_session", { design_session_id: id });
}

const f = fixture();
test("three controlled packets dispatch before any output can land", () => {
  call(f, "plan_design_session", {
    design_session_id: "custody",
    desires: desires(),
    lens_specs: lensSpecs(),
    orchestrator_model_family: "orchestrator-family",
  });
  const first = call(f, "dispatch_design_lens", { design_session_id: "custody", lens: "immanent" });
  const evidence = Object.values(first.runtime_input.context).flat()[0].candidate_id;
  assertThrows(
    () =>
      call(f, "land_design_lens", {
        design_session_id: "custody",
        lens: "immanent",
        options: [
          option("adapter", ["compatibility"], evidence, "a"),
          option("cutover", [], evidence, "b"),
        ],
        preferred_option_key: "adapter",
        analysis: "premature",
        detected_contradictions: [],
      }),
    "all three independent lens packets",
  );
  assert(
    !JSON.stringify(first.runtime_input).includes("preferred_option_key"),
    "packet leaked another lane output",
  );
});

let qualified;
test("mechanical aggregation preserves disagreement and furnishes advice, not a decision", () => {
  qualified = runSession(f, "qualified");
  assertEqual(qualified.status, "qualified", "majority did not qualify a lean");
  assertEqual(qualified.lean.option_key, "adapter", "wrong majority lean");
  assert(
    qualified.matrix.disagreements.some((row) => row.kind === "preferred-option"),
    "meaningful preference disagreement was smoothed away",
  );
  assertEqual(qualified.lean.decision_status, "unaccepted", "advice became a decision");
  assertEqual(qualified.authority.accepted_decision, false, "aggregation claimed acceptance");
});

test("constraint ablation measurably worsens preservation", () => {
  const rows = f.db
    .prepare(
      "SELECT lens, option_key, constraint_preservation FROM design_options WHERE design_session_id='qualified'",
    )
    .all();
  const adapter = rows
    .filter((row) => row.option_key === "adapter")
    .map((row) => row.constraint_preservation);
  const cutover = rows
    .filter((row) => row.option_key === "cutover")
    .map((row) => row.constraint_preservation);
  assert(
    Math.min(...adapter) > Math.max(...cutover),
    "restoring constraints did not improve preservation score",
  );
});

let nullResult;
test("mutually exclusive unprioritized desires force underdetermination", () => {
  nullResult = runSession(f, "null-design", true);
  assertEqual(
    nullResult.status,
    "underdetermined",
    "conflicted desires produced a confident architecture",
  );
  assertEqual(nullResult.lean, null, "underdetermined session furnished a lean");
  assert(
    nullResult.missing_desires.some((row) => row.missing_desire),
    "missing user desire was not named",
  );
});

test("clean, marker, treated, and null evaluation packets are content-blind", () => {
  for (const [condition, session] of [
    ["clean", "qualified"],
    ["marker-only", "qualified"],
    ["treated", "qualified"],
    ["null", "null-design"],
  ]) {
    const result = call(f, "prepare_design_evaluation_packet", {
      packet_id: `eval-${condition}`,
      design_session_id: session,
      condition,
      replicate_id: "r1",
      blind_label: `blind-${condition}`,
      content_canary_terms: [
        `condition-canary-${condition}`,
        "immanent",
        "adversarial",
        "speculative",
        "family-a",
        "family-b",
        "family-c",
      ],
    });
    const payload = JSON.stringify(result.evaluation_input);
    assert(!("condition" in result.evaluation_input), `${condition} leaked its condition field`);
    assert(!payload.includes(`condition-canary-${condition}`), `${condition} leaked its marker`);
    assert(!payload.includes("immanent"), `${condition} leaked lens identity`);
  }
});

test("landing cannot smuggle decision acceptance fields", () => {
  assertThrows(
    () =>
      call(f, "land_design_lens", {
        design_session_id: "qualified",
        lens: "immanent",
        accepted_decision: true,
      }),
    "forbidden fields",
  );
});

f.db.close();
rmSync(f.root, { recursive: true, force: true });
console.log(`\ndesign session: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
