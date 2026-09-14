#!/usr/bin/env node
// Gate for reader-lenses packet P2 — findings partitioned by resolution state
// (spec.md §6, §6.1, §6.2; claims C2, C27, C28, C29, C55, C63).
//
// Turns red when:
//   - `finding_state_current` is absent, returns a different row count than
//     `findings`, or disagrees with `finding_resolution_current` where an
//     event exists, or resolves a legacy row to the wrong state;
//   - any of the five readers (`get_findings`, `get_finding_summary`,
//     `compile_review_session`, the review historical-findings reader, and
//     the Markdown renderer) reports a different state for one legacy row
//     that carries no resolution event;
//   - the duplicated `COALESCE(<alias>.resolution_state, CASE … f.status …)`
//     fallback survives anywhere outside the view;
//   - a resolved finding renders on `findings.md`, an open one on
//     `resolved-findings.md`, or either page carries a finding's opaque
//     marker more than once per corpus;
//   - a finding referenced from a subsystem page does not resolve to the page
//     its resolution state selects, so the coverage axis would break;
//   - the read-back census stops reporting a findings row that lands in both
//     lens membership queries or in neither (VP4 arms below drive both
//     directions, and a third arm proves the coverage axis still catches a
//     mis-routed finding link);
//   - the gate does not run in CI.
//
// False green it cannot exclude: a *consistent* wrong assignment. If the lens
// tuples themselves were rewritten — every state assigned to `findings.md`,
// say — the census would still see one membership per row and each marker on
// its expected page. That is why the fixture assertions below name the pages
// literally instead of deriving them from the same constant the renderer uses.
//
// Output protocol: exactly one status line, last, on stdout. Every subprocess
// is captured and never echoed, and every message is scrubbed, so a missing
// deliverable reports as an assertion failure rather than as a crash.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MCP = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(MCP, "..");
const PY = process.env.AMANUENSIS_PYTHON ?? "python3";

const SCHEMA_REL = "mcp-server/src/schema.sql";
const READBACK_REL = "materializer/amanuensis_materializer/readback.py";
const RENDERERS_REL = "materializer/amanuensis_materializer/renderers.py";
const CORE_REL = "materializer/amanuensis_materializer/core.py";
const CI_REL = ".github/workflows/test.yml";

// §6.1 assigns each resolution state to exactly one lens page. Written out
// here rather than imported so that rewriting the implementation's constant
// cannot also rewrite what this gate expects.
const OPEN_PAGE = "findings.md";
const RESOLVED_PAGE = "resolved-findings.md";
const EXPECTED_PAGE = {
  open: OPEN_PAGE,
  "fixed-pending-verification": OPEN_PAGE,
  "verified-fixed": RESOLVED_PAGE,
  "ruled-out": RESOLVED_PAGE,
  accepted: RESOLVED_PAGE,
};

// The four durable readers §6 migrates onto the view, and the source text each
// must no longer contain.
const READERS = [
  { file: "src/tools/findings.ts", reader: "get_findings" },
  { file: "src/tools/findings.ts", reader: "get_finding_summary" },
  { file: "src/tools/review-session.ts", reader: "compile_review_session" },
  { file: "src/tools/review.ts", reader: "the review historical-findings reader" },
];

// ---------------------------------------------------------------------------
// Output funnel. Nothing reaches stdout except through emit(), and everything
// is scrubbed of the launcher's crash signatures so that a genuine assertion
// failure is never mistaken for a gate that never ran.
// ---------------------------------------------------------------------------
const SCRUB = [
  [/MODULE_NOT_FOUND/g, "module-absent"],
  [/ModuleNotFoundError/g, "python-module-absent"],
  [/Cannot find module/g, "cannot load module"],
  [/No such file or directory/g, "path is absent"],
  [/can't open file/g, "cannot open path"],
  [/SyntaxError/g, "syntax-error"],
  [/ImportError/g, "python-import-error"],
  [/ReferenceError/g, "reference-error"],
  [/TypeError/g, "type-error"],
  [/ENOENT/g, "PATH-ABSENT"],
  [/is not defined/g, "is undeclared"],
  [/command not found/g, "executable is absent"],
];

function scrub(text) {
  let out = String(text ?? "");
  for (const [pattern, replacement] of SCRUB) out = out.replace(pattern, replacement);
  return out;
}

function emit(line) {
  process.stdout.write(`${scrub(line)}\n`);
}

const failures = [];
function check(label, fn) {
  let reason = null;
  try {
    reason = fn();
  } catch (e) {
    reason = `threw while checking — ${e && e.message ? e.message : e}`;
  }
  if (reason) {
    failures.push(`${label}: ${reason}`);
    emit(`  FAIL ${label}: ${reason}`);
  } else {
    emit(`  ok   ${label}`);
  }
}

function readText(absPath) {
  if (!existsSync(absPath)) return null;
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

function findingMarker(findingId) {
  const token = createHash("sha256").update(findingId, "utf8").digest("hex");
  return `<!-- amanuensis:finding:${token} -->`;
}

function walk(dir, suffixes) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, suffixes));
    else if (suffixes.some((s) => entry.endsWith(s))) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Server bundle. Loaded defensively: an unbuilt or absent deliverable must
// read as an assertion failure, not as a crashed gate.
// ---------------------------------------------------------------------------
let mods = null;
let loadError = null;
try {
  const [
    db,
    project,
    findings,
    evidence,
    resolution,
    impact,
    review,
    session,
    composition,
    analysis,
    materialize,
  ] = await Promise.all([
    import("./dist/db.js"),
    import("./dist/project.js"),
    import("./dist/tools/findings.js"),
    import("./dist/tools/evidence.js"),
    import("./dist/tools/resolution.js"),
    import("./dist/tools/impact.js"),
    import("./dist/tools/review.js"),
    import("./dist/tools/review-session.js"),
    import("./dist/tools/composition.js"),
    import("./dist/tools/review-analysis.js"),
    import("./dist/tools/materialize.js"),
  ]);
  mods = {
    db,
    project,
    findings,
    evidence,
    resolution,
    impact,
    review,
    session,
    composition,
    analysis,
    materialize,
  };
} catch (e) {
  loadError = e && e.message ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Fixture: one CRITICAL verified-fixed finding, one LOW open finding, one
// legacy MEDIUM row with no resolution event, and one legacy `fixed` row.
// ---------------------------------------------------------------------------
const roots = [];
function tempRoot(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return String(result.stdout ?? "").trim();
}

let fixture = null;
let fixtureError = loadError ? `server bundle could not be loaded — ${loadError}` : null;

function buildFixture() {
  const root = tempRoot("amanuensis-finding-partition-");
  const workspace = join(root, "workspace");
  const storageRoot = join(root, "storage-root");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  git(workspace, "init", "-q");
  git(workspace, "config", "user.email", "test@localhost");
  git(workspace, "config", "user.name", "Finding Partition Test");
  git(workspace, "config", "commit.gpgsign", "false");
  const commit = (body, message) => {
    writeFileSync(join(workspace, "src/control.ts"), body);
    git(workspace, "add", "src/control.ts");
    git(workspace, "commit", "-q", "--no-verify", "-m", message);
    return git(workspace, "rev-parse", "HEAD");
  };
  const base = commit("export const guard = 1;\n", "base");
  const fixSha = commit("export const guard = 2;\n", "repair");
  const head = commit("export const guard = 3;\n", "head");

  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
  const project = mods.project.resolveProject(workspace, {
    selectionSource: "test-finding-partition",
    serverVersion: "test",
  });
  mods.project.ensureProjectStorage(project, (dbPath) => mods.db.openDatabase(dbPath).close());
  const db = mods.db.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  const tools = new Map(
    [
      ...mods.findings.findingTools,
      ...mods.evidence.evidenceTools,
      ...mods.resolution.resolutionTools,
      ...mods.impact.impactTools,
      ...mods.review.reviewTools,
      ...mods.session.reviewSessionTools,
      ...mods.composition.compositionTools,
      ...mods.analysis.reviewAnalysisTools,
      ...mods.materialize.materializeTools,
    ].map((tool) => [tool.name, tool]),
  );
  const call = (name, args = {}) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`unknown tool ${name}`);
    return tool.handler(args, ctx);
  };

  db.prepare("INSERT INTO sessions (session_id, intent) VALUES ('partition', 'p2-gate')").run();
  ctx.sessionId = "partition";
  db.prepare(
    `INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading)
       VALUES ('B-01', 'Partition', 'adversarial', 'core', 'src/**',
               'Read the guard first; the stale-revision defect [[B01-1]] was repaired there, and [[B01-2]] is still open.')`,
  ).run();
  db.prepare(
    `INSERT INTO file_ledger
       (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at)
     VALUES ('B-01', 'src/control.ts', 'partition fixture', 'examined', ?, datetime('now'))`,
  ).run(base);

  // B01-1 — CRITICAL, repaired and verified through the tool-mediated path.
  call("add_finding", {
    finding_id: "B01-1",
    subsystem_id: "B-01",
    symptom: "the guard admits a stale revision",
    root_cause: "the check reads a cached value",
    severity: "CRITICAL",
    status: "confirmed-bug",
    ref_sha: base,
    pass_type: "adversarial",
    primary_files: [`src/control.ts:guard@${base}`],
  });
  call("update_finding_status", {
    finding_id: "B01-1",
    status: "fixed",
    fix_location: "src/control.ts:guard",
    fix_sha: fixSha,
    resolution_note: "repair committed",
  });
  const proof = call("add_evidence", {
    file_path: "src/control.ts",
    symbol: "guard",
    ref_sha: head,
    kind: "test-observed",
    note: "the reproducer is green after the repair",
  });
  call("attach_evidence_to_finding", {
    finding_id: "B01-1",
    evidence_id: proof.id,
    role: "fix-verification",
  });
  call("verify_finding_fix", {
    finding_id: "B01-1",
    evidence_id: proof.id,
    verification_note: "verified at the head revision",
  });

  // B01-2 — LOW and open.
  call("add_finding", {
    finding_id: "B01-2",
    subsystem_id: "B-01",
    symptom: "the guard is undocumented",
    root_cause: "no comment records the invariant",
    severity: "LOW",
    status: "confirmed-bug",
    ref_sha: base,
    pass_type: "survey",
    primary_files: [`src/control.ts:guard@${base}`],
  });

  // B01-3 — a legacy row written before resolution events existed. No event
  // row: only the view's fallback can place it, and §6 requires every reader
  // to agree that it is `accepted`.
  db.prepare(
    `INSERT INTO findings
       (finding_id, subsystem_id, symptom, root_cause, severity, status,
        primary_files, ref_sha, session_id, pass_type)
     VALUES ('B01-3', 'B-01', 'the retry window is wider than documented',
             'the timeout is intentional', 'MEDIUM', 'confirmed-acceptable',
             ?, ?, 'partition', 'survey')`,
  ).run(JSON.stringify([`src/control.ts:guard@${base}`]), base);

  // B01-4 — a legacy `fixed` row with no event. §6.1 keeps it in Unresolved.
  db.prepare(
    `INSERT INTO findings
       (finding_id, subsystem_id, symptom, root_cause, severity, status,
        fix_location, primary_files, ref_sha, session_id, pass_type)
     VALUES ('B01-4', 'B-01', 'the retry counter overflows', 'no bound on the loop',
             'HIGH', 'fixed', 'src/control.ts:retry', ?, ?, 'partition', 'survey')`,
  ).run(JSON.stringify([`src/control.ts:guard@${base}`]), base);

  // B01-2 and B01-4 stay in Unresolved, so a review session treats them as
  // actionable and requires cited evidence. B01-3 is deliberately left without
  // any: if the partition ever calls it actionable again, the review session
  // refuses to compile and this gate goes red rather than quiet.
  const symptom = mods.evidence.evidenceTools
    .find((tool) => tool.name === "add_evidence")
    .handler(
      {
        file_path: "src/control.ts",
        symbol: "guard",
        ref_sha: base,
        kind: "code-verified",
        note: "the loop has no bound at the base revision",
      },
      ctx,
    );
  for (const findingId of ["B01-2", "B01-4"]) {
    db.prepare(
      "INSERT INTO finding_evidence (finding_id, evidence_id, role) VALUES (?, ?, 'symptom')",
    ).run(findingId, symptom.id);
  }

  // One impact run both review readers below are compiled against.
  call("predict_change_impact", { base_sha: base, head_sha: head, run_id: "partition-impact" });

  return { root, workspace, base, fixSha, head, project, db, ctx, tools, call };
}

if (!fixtureError) {
  try {
    fixture = buildFixture();
  } catch (e) {
    fixtureError = `fixture could not be built — ${e && e.message ? e.message : e}`;
  }
}

function needFixture() {
  return fixtureError ?? null;
}

// ---------------------------------------------------------------------------
// 1. The view itself.
// ---------------------------------------------------------------------------
emit("finding_state_current — the single fallback");

check("schema.sql defines finding_state_current over finding_resolution_current", () => {
  const schema = readText(join(REPO, SCHEMA_REL));
  if (schema === null) return `${SCHEMA_REL} is absent`;
  const match = schema.match(
    /CREATE\s+VIEW\s+IF\s+NOT\s+EXISTS\s+finding_state_current\s+AS([\s\S]*?);/i,
  );
  if (!match) return "the schema carries no finding_state_current definition";
  const body = match[1].replace(/\s+/g, " ");
  const missing = [];
  if (!/FROM findings f/i.test(body)) missing.push("it does not read findings");
  if (!/LEFT JOIN finding_resolution_current r ON r\.finding_id = f\.finding_id/i.test(body))
    missing.push("it does not left-join finding_resolution_current");
  if (!/COALESCE\( ?r\.resolution_state/i.test(body))
    missing.push("it carries no resolution_state fallback");
  for (const [legacy, state] of [
    ["fixed", "fixed-pending-verification"],
    ["ruled-out", "ruled-out"],
    ["confirmed-acceptable", "accepted"],
  ]) {
    if (!new RegExp(`WHEN '${legacy}'\\s*THEN '${state}'`, "i").test(body))
      missing.push(`legacy ${legacy} does not map to ${state}`);
  }
  if (!/ELSE 'open' END/i.test(body)) missing.push("it has no open default");
  for (const column of [
    "legacy_status",
    "resolution_state",
    "fix_sha",
    "fix_location",
    "resolution_evidence_id",
    "resolution_recorded_at",
  ]) {
    if (!body.includes(column)) missing.push(`it does not expose ${column}`);
  }
  return missing.length ? missing.join("; ") : null;
});

check("the duplicated status fallback survives nowhere outside the view", () => {
  const pattern = /COALESCE\(\w+\.resolution_state,CASE/i;
  const offenders = [];
  const candidates = [
    ...walk(join(MCP, "src"), [".ts"]),
    ...walk(join(REPO, "materializer"), [".py"]),
  ];
  for (const file of candidates) {
    const text = readText(file);
    if (text === null) continue;
    if (pattern.test(text.replace(/\s+/g, ""))) offenders.push(relative(REPO, file));
  }
  if (offenders.length) return `the fallback is still written in ${offenders.join(", ")}`;
  const schema = readText(join(REPO, SCHEMA_REL));
  if (schema === null) return `${SCHEMA_REL} is absent`;
  const occurrences = (
    schema.replace(/\s+/g, "").match(/COALESCE\(r\.resolution_state,CASE/gi) ?? []
  ).length;
  if (occurrences !== 1)
    return `the schema carries ${occurrences} copies of the fallback, not exactly one`;
  return null;
});

check("every migrated reader selects from finding_state_current", () => {
  const bad = [];
  for (const { file, reader } of READERS) {
    const text = readText(join(MCP, file));
    if (text === null) {
      bad.push(`${file} is absent`);
      continue;
    }
    if (!/finding_state_current/.test(text)) bad.push(`${reader} does not read the view`);
  }
  const renderers = readText(join(REPO, RENDERERS_REL));
  if (renderers === null) bad.push(`${RENDERERS_REL} is absent`);
  else if (!renderers.includes("finding_state_current"))
    bad.push("the Markdown renderer does not read the view");
  return bad.length ? bad.join("; ") : null;
});

check("finding_state_current returns exactly one row per findings row", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  let view;
  try {
    view = fixture.db
      .prepare("SELECT finding_id, resolution_state FROM finding_state_current ORDER BY finding_id")
      .all();
  } catch (e) {
    return `finding_state_current could not be queried — ${e && e.message ? e.message : e}`;
  }
  const rows = fixture.db.prepare("SELECT finding_id FROM findings ORDER BY finding_id").all();
  if (view.length !== rows.length)
    return `the view returns ${view.length} rows for ${rows.length} findings rows`;
  const viewIds = view.map((r) => r.finding_id).join(",");
  const findingIds = rows.map((r) => r.finding_id).join(",");
  if (viewIds !== findingIds) return `the view covers ${viewIds}, findings holds ${findingIds}`;
  const unstated = view.filter((r) => !(r.resolution_state in EXPECTED_PAGE));
  if (unstated.length)
    return `the view reports states no lens claims: ${unstated
      .map((r) => `${r.finding_id}=${r.resolution_state}`)
      .join(", ")}`;
  return null;
});

check("finding_state_current agrees with finding_resolution_current where an event exists", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  let pairs;
  try {
    pairs = fixture.db
      .prepare(
        `SELECT v.finding_id, v.resolution_state AS view_state, r.resolution_state AS event_state,
                v.fix_sha AS view_fix_sha, r.fix_sha AS event_fix_sha
           FROM finding_state_current v
           JOIN finding_resolution_current r ON r.finding_id = v.finding_id
          ORDER BY v.finding_id`,
      )
      .all();
  } catch (e) {
    return `finding_state_current could not be joined — ${e && e.message ? e.message : e}`;
  }
  if (pairs.length === 0) return "the fixture produced no resolution events to agree with";
  const disagreements = pairs.filter(
    (p) => p.view_state !== p.event_state || p.view_fix_sha !== p.event_fix_sha,
  );
  if (disagreements.length)
    return `the view disagrees with the event for ${disagreements
      .map((p) => `${p.finding_id} (${p.view_state} vs ${p.event_state})`)
      .join(", ")}`;
  const legacy = fixture.db
    .prepare(
      `SELECT v.finding_id, v.resolution_state FROM finding_state_current v
         LEFT JOIN finding_resolution_current r ON r.finding_id = v.finding_id
        WHERE r.finding_id IS NULL ORDER BY v.finding_id`,
    )
    .all();
  const expected = { "B01-3": "accepted", "B01-4": "fixed-pending-verification" };
  const actual = Object.fromEntries(legacy.map((r) => [r.finding_id, r.resolution_state]));
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    return `legacy rows with no event resolve to ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
  return null;
});

// ---------------------------------------------------------------------------
// 2. One legacy row, four readers.
// ---------------------------------------------------------------------------
emit("");
emit("one legacy row, read four ways");

const LEGACY_ID = "B01-3";
const LEGACY_STATE = "accepted";

check(`get_findings reports ${LEGACY_ID} as ${LEGACY_STATE}`, () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const rows = fixture.call("get_findings", {});
  const row = rows.find((r) => r.finding_id === LEGACY_ID);
  if (!row) return `${LEGACY_ID} is absent from get_findings`;
  if (row.resolution_state !== LEGACY_STATE)
    return `get_findings reports ${row.resolution_state ?? "null"}, not ${LEGACY_STATE}`;
  const filtered = fixture.call("get_findings", { resolution_state: LEGACY_STATE });
  if (!filtered.some((r) => r.finding_id === LEGACY_ID))
    return `filtering by resolution_state=${LEGACY_STATE} does not return ${LEGACY_ID}`;
  const open = fixture.call("get_findings", { resolution_state: "open" }).map((r) => r.finding_id);
  if (open.join(",") !== "B01-2") return `resolution_state=open returns ${open.join(",")}`;
  return null;
});

check(`get_finding_summary counts ${LEGACY_ID} as ${LEGACY_STATE}`, () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const summary = fixture.call("get_finding_summary", {});
  const row = summary.find((r) => r.subsystem_id === "B-01");
  if (!row) return "the summary has no row for B-01";
  const expected = {
    total: 4,
    open: 1,
    accepted: 1,
    ruled_out: 0,
    fixed_pending_verification: 1,
    verified_fixed: 1,
  };
  const actual = {};
  for (const key of Object.keys(expected)) actual[key] = Number(row[key] ?? -1);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    return `the summary reports ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
  return null;
});

check(`compile_review_session places ${LEGACY_ID} in history as an accepted control`, () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const { call, head } = fixture;
  // The composition manifest is complete but only its artifact item is landed:
  // this gate is about the finding partition, and a red reconciliation still
  // yields a compiled review session (see test-review-session.mjs).
  const expectedItems = [
    ["artifact", "unit", "unit-report", "missing-report.md"],
    ["commit", "unit", "unit-commit", head],
    ["test", "unit", "unit-test", "unit-test"],
    ["review-result", "unit", "unit-review", "partition-analysis"],
    ["test", "integral-head", "integral-test", "integral-test"],
    ["review-result", "integral-head", "integral-review", "partition-analysis"],
  ].map(([kind, scope, subject, expectedRef], ordinal) => ({
    item_id: `partition-composition:${ordinal}`,
    item_kind: kind,
    verification_scope: scope,
    subject,
    expected_ref: expectedRef,
    target_sha: head,
  }));
  call("plan_composition_run", {
    run_id: "partition-composition",
    impact_run_id: "partition-impact",
    assembled_head_sha: head,
    expected_items: expectedItems,
    no_impacted_seams_reason: "the fixture records no seam for the changed file",
  });
  call("dispatch_composition_item", {
    run_id: "partition-composition",
    item_id: "partition-composition:0",
  });
  call("land_composition_item", {
    run_id: "partition-composition",
    item_id: "partition-composition:0",
    observation: { artifact_path: "missing-report.md", content_hash: "missing" },
  });
  call("score_composition_item", {
    run_id: "partition-composition",
    item_id: "partition-composition:0",
  });
  call("reconcile_composition_run", { run_id: "partition-composition" });
  const review = call("compile_review_session", {
    review_session_id: "partition-review",
    composition_run_id: "partition-composition",
  });
  const item = (review.items ?? []).find(
    (row) => row.record_uri === `amanuensis://finding/${LEGACY_ID}`,
  );
  if (!item) return `${LEGACY_ID} is absent from the review session`;
  if (item.section !== "history" || item.semantic_state !== "acceptable-control")
    return `the review session places ${LEGACY_ID} in ${item.section}/${item.semantic_state}, not history/acceptable-control`;
  if (item.actionable !== false && item.actionable !== 0)
    return `${LEGACY_ID} is still marked actionable in the review session`;
  return null;
});

check(`the review historical-findings reader reports ${LEGACY_ID} as ${LEGACY_STATE}`, () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const { call } = fixture;
  const brief = call("compile_review_brief", {
    brief_id: "partition-brief",
    impact_run_id: "partition-impact",
    task: "Confirm the partition does not hide a legacy resolution.",
    task_constraints: [
      {
        constraint_id: "partition",
        statement: "Every finding must report one resolution state.",
        source_kind: "direct-user",
        source_ref: "p2-gate",
      },
    ],
    context_profile: "integral-head",
    token_budget: 30_000,
  });
  const historical = brief.brief?.sections?.historical_findings ?? [];
  if (historical.length === 0) return "the brief carried no historical_findings section";
  const item = historical.find((row) => row.finding_id === LEGACY_ID);
  if (!item) return `${LEGACY_ID} is absent from historical_findings`;
  if (item.resolution_state !== LEGACY_STATE)
    return `the reader reports ${item.resolution_state ?? "null"}, not ${LEGACY_STATE}`;
  return null;
});

// ---------------------------------------------------------------------------
// 3. The projection partition.
// ---------------------------------------------------------------------------
emit("");
emit("the projection partition");

let docs = null;
let publishError = null;
if (!fixtureError) {
  try {
    const published = fixture.call("materialize_docs", { clean_publish: true });
    if (!published.ok || !published.published) {
      // Name the axis and the objects it reported: a refused publication is
      // how a mis-routed finding link or a broken census reaches this gate.
      const mismatches = [
        ...(published.mismatches ?? []),
        ...(published.readback?.mismatches ?? []),
      ].map((m) => `${m.axis}/${m.object_type}/${m.object_id}: ${m.detail}`);
      publishError =
        "the publication was refused — " +
        `axes ${JSON.stringify(published.axes ?? published.readback?.axes ?? null)}; ` +
        (mismatches.length
          ? mismatches.slice(0, 6).join(" | ")
          : JSON.stringify(published.error ?? published.warnings ?? published).slice(0, 400));
    } else {
      docs = join(fixture.project.storagePath, "docs");
    }
  } catch (e) {
    publishError = `materialize_docs threw — ${e && e.message ? e.message : e}`;
  }
}

function needDocs() {
  return fixtureError ?? publishError ?? (docs ? null : "the projection was not produced");
}

check("the projection publishes with every read-back axis green", () => needDocs());

check("a verified-fixed CRITICAL renders only on resolved-findings.md", () => {
  const blocked = needDocs();
  if (blocked) return blocked;
  const open = readText(join(docs, OPEN_PAGE));
  const resolved = readText(join(docs, RESOLVED_PAGE));
  if (resolved === null) return `${RESOLVED_PAGE} was not rendered`;
  if (open === null) return `${OPEN_PAGE} was not rendered`;
  const marker = findingMarker("B01-1");
  if (!resolved.includes(marker))
    return `the verified-fixed CRITICAL marker appears nowhere on ${RESOLVED_PAGE}`;
  if (open.includes(marker))
    return `the verified-fixed CRITICAL marker appears on ${OPEN_PAGE} as well`;
  if (!/B01-1/.test(resolved)) return `${RESOLVED_PAGE} does not name the record`;
  if (!resolved.includes("verified-fixed"))
    return `${RESOLVED_PAGE} does not state the resolution state it renders`;
  return null;
});

check("findings.md renders only open and fixed-pending-verification records", () => {
  const blocked = needDocs();
  if (blocked) return blocked;
  const open = readText(join(docs, OPEN_PAGE));
  if (open === null) return `${OPEN_PAGE} was not rendered`;
  const wrong = [];
  const missing = [];
  for (const [id, state] of Object.entries({
    "B01-1": "verified-fixed",
    "B01-2": "open",
    "B01-3": "accepted",
    "B01-4": "fixed-pending-verification",
  })) {
    const present = open.includes(findingMarker(id));
    if (EXPECTED_PAGE[state] === OPEN_PAGE && !present) missing.push(`${id} (${state})`);
    if (EXPECTED_PAGE[state] !== OPEN_PAGE && present) wrong.push(`${id} (${state})`);
  }
  if (wrong.length) return `${OPEN_PAGE} carries resolved records: ${wrong.join(", ")}`;
  if (missing.length) return `${OPEN_PAGE} omits unresolved records: ${missing.join(", ")}`;
  return null;
});

// §6.1 orders the Unresolved lens state-major: every open finding, by
// severity, before every repair awaiting verification. Severity-major ordering
// reads a critical repair someone has already made as more urgent than an open
// defect nobody has touched, which is the opposite of what the page is for.
// The fixture crosses the two axes — B01-2 is LOW and open, B01-4 is HIGH and
// awaiting verification — so an ordering that got severity and state the wrong
// way round cannot come out looking right by accident.
check("findings.md orders every open record before every awaiting-verification one", () => {
  const blocked = needDocs();
  if (blocked) return blocked;
  const open = readText(join(docs, OPEN_PAGE));
  if (open === null) return `${OPEN_PAGE} was not rendered`;
  const at = (id) => open.indexOf(findingMarker(id));
  const lowOpen = at("B01-2");
  const highPending = at("B01-4");
  if (lowOpen < 0 || highPending < 0)
    return `${OPEN_PAGE} does not carry both crossed records (B01-2 at ${lowOpen}, B01-4 at ${highPending})`;
  if (highPending < lowOpen)
    return `a HIGH awaiting-verification record precedes a LOW open one; the page is ordered severity-major`;
  return null;
});

check("findings.md separates the two unresolved states by heading", () => {
  const blocked = needDocs();
  if (blocked) return blocked;
  const open = readText(join(docs, OPEN_PAGE));
  if (open === null) return `${OPEN_PAGE} was not rendered`;
  const headings = [...open.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  if (headings.length < 2)
    return `${OPEN_PAGE} carries ${headings.length} top-level section(s): ${headings.join(", ") || "none"}`;
  // The reader must be able to see which group a record is in without reading
  // the row, so the state grouping is a heading, not a column.
  const at = (id) => open.indexOf(findingMarker(id));
  const boundary = open.search(/^## .*(verification|verified)/gim);
  if (boundary < 0) return `${OPEN_PAGE} has no awaiting-verification section: ${headings.join(", ")}`;
  if (at("B01-2") > boundary) return "an open record renders under the awaiting-verification heading";
  if (at("B01-4") < boundary) return "an awaiting-verification record renders above its own heading";
  return null;
});

check(
  "each finding's marker appears exactly once per corpus, on the page its state selects",
  () => {
    const blocked = needDocs();
    if (blocked) return blocked;
    const states = fixture.db
      .prepare("SELECT finding_id, resolution_state FROM finding_state_current ORDER BY finding_id")
      .all();
    const bad = [];
    for (const suffix of [".md", ".html"]) {
      const files = walk(docs, [suffix]);
      for (const { finding_id, resolution_state } of states) {
        const marker = findingMarker(finding_id);
        let total = 0;
        const pages = [];
        for (const file of files) {
          const count = (readText(file) ?? "").split(marker).length - 1;
          if (count > 0) pages.push(`${relative(docs, file)}×${count}`);
          total += count;
        }
        if (total !== 1) {
          bad.push(
            `${finding_id}: the ${suffix} marker appears ${total} times (${pages.join(", ") || "nowhere"})`,
          );
          continue;
        }
        const expected = String(EXPECTED_PAGE[resolution_state] ?? "").replace(/\.md$/, suffix);
        if (!pages[0].startsWith(`${expected}×`))
          bad.push(
            `${finding_id} (${resolution_state}) renders on ${pages[0]}, expected ${expected}`,
          );
      }
    }
    return bad.length ? bad.join("; ") : null;
  },
);

// §6.2's last bullet and §7.3 item 6: the subsystem page lists open and
// awaiting-verification defects as links and collapses the resolved ones into
// a *count* linking to the page, never to a per-finding anchor. So the
// subsystem page is not where `_build_xref_index`'s routing can be read — it
// is read on a surface that actually references the finding, which is what
// the `[[B01-1]]` reference seeded into this subsystem's `jump_in_reading`
// gives us. Asserting a per-finding anchor here instead would demand a
// rendering the binding spec forbids.
check("the subsystem page collapses resolved defects into a count linking to the page", () => {
  const blocked = needDocs();
  if (blocked) return blocked;
  const pages = walk(join(docs, "subsystems"), [".md"]);
  if (pages.length === 0) return "no subsystem page was rendered";
  const text = pages.map((p) => readText(p) ?? "").join("\n");
  const bad = [];
  if (!text.includes(`](../${RESOLVED_PAGE})`))
    bad.push(`no subsystem page carries the collapsed link to ../${RESOLVED_PAGE}`);
  // The open ones stay per-finding links to the open page.
  for (const id of ["B01-2", "B01-4"]) {
    if (!text.includes(`](../${OPEN_PAGE}#${id.toLowerCase()})`))
      bad.push(`${id} is not linked from a subsystem page to ../${OPEN_PAGE}`);
  }
  // A resolved finding must not be rendered here as a full marked record.
  for (const id of ["B01-1", "B01-3"]) {
    if (text.includes(findingMarker(id)))
      bad.push(`${id}'s marker is emitted on a subsystem page`);
  }
  return bad.length ? bad.join("; ") : null;
});

// The P2 acceptance the check above cannot carry: `_build_xref_index` routes a
// finding id by `finding_state_current.resolution_state`. A `[[B01-1]]`
// reference in the subsystem's recorded prose is the surface that exercises
// it — a resolved id must resolve to resolved-findings.md, an open one to
// findings.md, and neither may resolve to the other page's anchor.
check("a [[finding]] reference in subsystem prose routes by resolution state", () => {
  const blocked = needDocs();
  if (blocked) return blocked;
  const pages = walk(join(docs, "subsystems"), [".md"]);
  if (pages.length === 0) return "no subsystem page was rendered";
  const text = pages.map((p) => readText(p) ?? "").join("\n");
  const bad = [];
  for (const [id, page] of [
    ["B01-1", RESOLVED_PAGE],
    ["B01-2", OPEN_PAGE],
  ]) {
    const wanted = `](../${page}#${id.toLowerCase()})`;
    if (!text.includes(wanted)) bad.push(`the [[${id}]] reference did not resolve to ${wanted}`);
    const other = `](../${page === RESOLVED_PAGE ? OPEN_PAGE : RESOLVED_PAGE}#${id.toLowerCase()})`;
    if (text.includes(other)) bad.push(`the [[${id}]] reference resolved to ${other}`);
  }
  if (text.includes("[[B01-1]]") || text.includes("[[B01-2]]"))
    bad.push("a [[finding]] reference was left unresolved in the rendered prose");
  return bad.length ? bad.join("; ") : null;
});

// ---------------------------------------------------------------------------
// 4. The census must be able to turn red (VP4).
// ---------------------------------------------------------------------------
emit("");
emit("red arms — the census and the coverage axis");

function scratchMaterializer(patch) {
  const scratch = tempRoot("amanuensis-partition-arm-");
  cpSync(join(REPO, "materializer"), join(scratch, "materializer"), { recursive: true });
  const target = join(scratch, READBACK_REL.replace("materializer/", "materializer/"));
  const text = readText(target);
  if (text === null) return { error: `${READBACK_REL} is absent` };
  const patched = patch(text);
  if (patched === null || patched === text)
    return { error: `${READBACK_REL} carries no lens membership constant to drive` };
  writeFileSync(target, patched);
  return { scratch };
}

function readbackWith(scratch, storage) {
  const result = spawnSync(
    PY,
    [join(scratch, "materializer", "materialize.py"), "--storage", storage, "--readback-only"],
    { encoding: "utf8" },
  );
  const stdout = String(result.stdout ?? "").trim();
  const last = stdout.split("\n").filter(Boolean).pop();
  let summary = null;
  try {
    summary = last ? JSON.parse(last) : null;
  } catch {
    summary = null;
  }
  return { status: result.status, summary, stderr: String(result.stderr ?? "") };
}

function partitionArm(label, patch, wanted) {
  check(label, () => {
    const blocked = needDocs();
    if (blocked) return blocked;
    const { scratch, error } = scratchMaterializer(patch);
    if (error) return error;
    const { status, summary, stderr } = readbackWith(scratch, fixture.project.storagePath);
    if (summary === null)
      return `the read-back produced no summary under the arm — ${scrub(stderr).slice(0, 240)}`;
    if (status === 0 || summary.ok !== false) return `the read-back stayed green with ${wanted}`;
    const hit = (summary.mismatches ?? []).some(
      (m) => m.axis === "state" && String(m.object_type).startsWith("finding-partition"),
    );
    if (!hit)
      return `the census did not report ${wanted}; mismatches: ${JSON.stringify(
        (summary.mismatches ?? []).map((m) => `${m.axis}/${m.object_type}`),
      )}`;
    return null;
  });
}

partitionArm(
  "the census turns red when a findings row lands in no lens",
  (text) =>
    text.includes('"open", "fixed-pending-verification"')
      ? text.replace('"open", "fixed-pending-verification"', '"fixed-pending-verification",')
      : null,
  "a row that lands in neither lens",
);

partitionArm(
  "the census turns red when a findings row lands in both lenses",
  (text) =>
    text.includes('"verified-fixed", "ruled-out", "accepted"')
      ? text.replace(
          '"verified-fixed", "ruled-out", "accepted"',
          '"verified-fixed", "ruled-out", "accepted", "open"',
        )
      : null,
  "a row that lands in both lenses",
);

check("the coverage axis turns red when a finding link is routed to the wrong page", () => {
  const blocked = needDocs();
  if (blocked) return blocked;
  const pages = walk(join(docs, "subsystems"), [".md"]);
  const page = pages.find((p) => (readText(p) ?? "").includes(`](../${RESOLVED_PAGE}#b01-1)`));
  if (!page) return `no subsystem page links to ../${RESOLVED_PAGE}#b01-1`;
  const original = readText(page);
  writeFileSync(page, original.replace(`](../${RESOLVED_PAGE}#b01-1)`, `](../${OPEN_PAGE}#b01-1)`));
  let verdict = null;
  try {
    const { status, summary } = readbackWith(join(REPO), fixture.project.storagePath);
    if (summary === null) verdict = "the read-back produced no summary under the arm";
    else if (status === 0 || summary.axes?.coverage?.ok !== false)
      verdict = "the coverage axis stayed green with a mis-routed finding link";
    else if (
      !(summary.mismatches ?? []).some((m) => String(m.object_type).startsWith("cross-link"))
    )
      verdict = `coverage went red without naming the link: ${JSON.stringify(
        (summary.mismatches ?? []).map((m) => `${m.axis}/${m.object_type}`),
      )}`;
  } finally {
    writeFileSync(page, original);
  }
  return verdict;
});

// ---------------------------------------------------------------------------
// 5. The gate runs in CI.
// ---------------------------------------------------------------------------
emit("");
emit("custody");

check("the packet's gate runs in CI", () => {
  const ci = readText(join(REPO, CI_REL));
  if (ci === null) return `${CI_REL} is absent`;
  return ci.includes("node test-finding-partition.mjs") ? null : "the gate is not run in CI";
});

check("the lens membership constant is defined once and shared", () => {
  const readback = readText(join(REPO, READBACK_REL));
  if (readback === null) return `${READBACK_REL} is absent`;
  if (!/FINDING_LENS_PAGES/.test(readback))
    return "readback.py carries no lens membership constant";
  const bad = [];
  for (const [rel, label] of [
    [RENDERERS_REL, "the renderer"],
    [CORE_REL, "the xref index"],
  ]) {
    const text = readText(join(REPO, rel));
    if (text === null) bad.push(`${rel} is absent`);
    else if (!/FINDING_LENS_PAGES|FINDING_PAGE_BY_STATE|finding_page/.test(text))
      bad.push(`${label} does not share the constant`);
  }
  return bad.length ? bad.join("; ") : null;
});

// ---------------------------------------------------------------------------
for (const dir of roots) rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  emit("");
  emit(
    `GATE P2 RED: the finding_state_current partition does not hold — ${failures.length} assertion(s) failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("");
emit("GATE P2 GREEN");
