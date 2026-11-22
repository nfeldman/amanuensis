#!/usr/bin/env node
// GATE SI8 — the refresh hint (design/semantic-index/PLAN.md §4.5, §8 SI8).
//
// Turns red when:
//   - dist/tools/stale.js or dist/tools/refresh.js is missing or does not load;
//   - on a fixture whose second commit moves, edits, deletes, keeps and duplicates one
//     definition each, get_stale_backlog does not give each evidence row on a stale ledger
//     file, at the target revision, the anchor_state of PLAN §4.5, compared row for row with
//     a golden table:
//       - `moved` for the definition that moved with its leading comment;
//       - `changed` for the edited definition, and for the one whose leading comment alone
//         was edited;
//       - `gone` for the deleted definition, beside a survivor, in a file that parses;
//       - `same-text` for the kept definition, and for a kept function whose constant changed
//         value (the constant itself is `changed`);
//       - `ambiguous` for the definition that is now defined twice, with both spans;
//       - for one symbol_id under two kinds (a C++ prototype and its definition), each anchor
//         read against its own kind: the kept prototype `same-text`, the edited definition
//         `changed`, neither `ambiguous`;
//       - `unavailable`, never `gone`, for a cited definition whose syntax broke, while the
//         intact definition beside it keeps its own state; for a file that became unreadable
//         (not UTF-8); for a file that was deleted; and for every anchored row with
//         AMANUENSIS_CODE_INDEX=off;
//       - `unanchored` for evidence with no anchor (no symbol; a language the index does not
//         parse);
//   - reordering the file's other definitions changes any row's state or lines;
//   - file-level staleness changes: a stale file stops being listed because its cited text is
//     unchanged, a fresh file is listed, a row's ledger fields differ from the ledger, the
//     backlog's limit is not applied, or get_stale_backlog's or clear_staleness's input schema
//     differs from what it was before this packet;
//   - reading the backlog clears or otherwise writes anything (the ledger, staleness_clears,
//     evidence and anchors are byte-for-byte as before), or clear_staleness stops clearing one
//     whole ledger file with a recorded basis;
//   - a refresh run built from the backlog (get_refresh_run) does not carry the same hints at
//     its own head revision.
//
// Hermetic: the fixture repository and the store are built in a temporary directory, the
// tools run in this process from dist/, and nothing reaches the network.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "amanuensis-si8-"));

class GateFailure extends Error {}
function fail(message) {
  throw new GateFailure(message);
}
function check(condition, message) {
  if (!condition) fail(message);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function same(label, got, want) {
  const a = canonical(got);
  const b = canonical(want);
  if (a !== b) fail(`${label}: got ${a.slice(0, 700)}; want ${b.slice(0, 700)}`);
}
const SIGNATURES =
  /Cannot find module|MODULE_NOT_FOUND|ModuleNotFoundError|SyntaxError|No such file or directory|ENOENT|ImportError|ReferenceError|is not defined|command not found/g;
function oneLine(text) {
  return String(text).replace(SIGNATURES, "[error]").split("\n")[0].slice(0, 500);
}

/** get_stale_backlog's and clear_staleness's input schemas before this packet. */
const BACKLOG_SCHEMA = {
  type: "object",
  properties: { limit: { type: "integer" } },
  additionalProperties: false,
};
const CLEAR_SCHEMA = {
  type: "object",
  properties: {
    subsystem_id: { type: "string" },
    file_path: { type: "string" },
    ref_sha: { type: "string" },
    evidence_id: { type: "integer" },
    reason: { type: "string" },
  },
  required: ["subsystem_id", "file_path", "ref_sha"],
  additionalProperties: false,
};
/** The ledger columns every backlog row carried before this packet. */
const LEDGER_FIELDS = [
  "subsystem_id",
  "source_path",
  "ref_sha",
  "classification",
  "stale_since",
  "stale_reason",
  "heat",
  "access_count",
];

async function loadModules() {
  const load = async (path) => {
    const source = path.replace(/^dist/, "src").replace(/\.js$/, ".ts");
    check(existsSync(join(here, path)), `${path} is missing (${source} is not built)`);
    try {
      return await import(pathToFileURL(join(here, path)).href);
    } catch (e) {
      fail(`${path} did not load: ${oneLine(e?.message ?? e)}`);
    }
  };
  const mods = {
    project: await load("dist/project.js"),
    db: await load("dist/db.js"),
    tools: [],
  };
  for (const [path, name] of [
    ["dist/tools/stale.js", "staleTools"],
    ["dist/tools/refresh.js", "refreshTools"],
    ["dist/tools/evidence.js", "evidenceTools"],
    ["dist/tools/project.js", "projectTools"],
    ["dist/tools/files.js", "fileTools"],
    ["dist/tools/git.js", "gitTools"],
    ["dist/tools/subsystems.js", "subsystemTools"],
  ]) {
    const mod = await load(path);
    check(Array.isArray(mod[name]), `${path} does not export ${name}`);
    mods.tools.push(...mod[name]);
  }
  return mods;
}

async function main() {
  const mods = await loadModules();
  const byName = new Map(mods.tools.map((t) => [t.name, t]));
  const { buildRefreshRepo, FILES } = await import(
    pathToFileURL(join(here, "fixtures", "code-index-refresh-repo.mjs")).href
  );

  same("get_stale_backlog's input schema", byName.get("get_stale_backlog")?.inputSchema, BACKLOG_SCHEMA);
  same("clear_staleness's input schema", byName.get("clear_staleness")?.inputSchema, CLEAR_SCHEMA);

  const storageRoot = join(scratch, "storage");
  mkdirSync(storageRoot, { recursive: true });
  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
  process.env.AMANUENSIS_CALL_LOG = "off";
  delete process.env.AMANUENSIS_CODE_INDEX;

  const { workspace, base, target, reorder } = buildRefreshRepo(join(scratch, "workspace"));
  const project = mods.project.resolveProject(workspace, { selectionSource: "si8-gate" });
  mods.project.ensureProjectStorage(project, (p) => mods.db.openDatabase(p).close());
  const db = mods.db.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };

  const call = async (name, args) => {
    const tool = byName.get(name);
    if (!tool) fail(`no tool ${name}`);
    return await tool.handler(args, ctx);
  };
  const must = async (name, args) => {
    let r;
    try {
      r = await call(name, args);
    } catch (e) {
      if (e instanceof GateFailure) throw e;
      fail(`${name} ${canonical(args).slice(0, 200)} threw: ${oneLine(e?.message ?? e)}`);
    }
    if (r?.ok === false) fail(`${name} ${canonical(args).slice(0, 200)} was refused: ${oneLine(r.error)}`);
    return r;
  };

  ctx.sessionId = (await must("start_session", { intent: "si8-gate" })).session_id;
  await must("set_git_state", { canonical_branch: "main", onboarding_sha: base });
  await must("upsert_subsystem", { id: "B-01", name: "Fixture", status: "scoping" });
  await must("add_files_to_scope", {
    subsystem_id: "B-01",
    ref_sha: base,
    files: FILES.map((file_path) => ({ file_path, classification: "examined" })),
  });

  // Evidence at the base revision. Anchored rows name a definition and let the server fill
  // the range; unanchored rows cite lines with no symbol, or a file in no parsed language.
  const cite = async (file_path, symbol, line_range) => {
    const args = { file_path, ref_sha: base, kind: "code-verified" };
    if (symbol !== null) args.symbol = symbol;
    if (line_range !== null) args.line_range = line_range;
    const r = await must("add_evidence", args);
    check(Number.isInteger(r?.id), `add_evidence ${file_path} ${symbol} returned no id`);
    const row = db.prepare("SELECT symbol, line_range FROM evidence WHERE id = ?").get(r.id);
    const anchored = db.prepare("SELECT COUNT(*) AS n FROM evidence_anchors WHERE evidence_id = ?").get(r.id).n;
    same(`evidence ${file_path} ${symbol} anchored`, anchored, symbol === null ? 0 : 1);
    return { id: r.id, symbol: row.symbol, line_range: row.line_range };
  };
  const ev = {
    notes: await cite("docs/notes.txt", null, "1"),
    twin: await cite("lib/dups.py", "twin", null),
    sturdy: await cite("src/broken.ts", "sturdy", null),
    fragile: await cite("src/broken.ts", "fragile", null),
    editor: await cite("src/edits.ts", "editor", null),
    documented: await cite("src/edits.ts", "documented", null),
    doomed: await cite("src/gone.ts", "doomed", null),
    limit: await cite("src/kept.ts", "LIMIT", null),
    keeper: await cite("src/kept.ts", "keeper", null),
    reader: await cite("src/kept.ts", "reader", null),
    keptLines: await cite("src/kept.ts", null, "3-5"),
    legible: await cite("src/latin1.ts", "legible", null),
    mover: await cite("src/moves.ts", "mover", null),
    declared: await cite("src/proto.cpp", "twice", "1"),
    defined: await cite("src/proto.cpp", "twice", "3-5"),
    orphan: await cite("src/removed.ts", "orphan", null),
    hush: await cite("src/quiet.ts", "hush", null),
  };
  same(
    "base-revision ranges filled from the citeable spans",
    Object.fromEntries(Object.entries(ev).map(([k, v]) => [k, v.line_range])),
    {
      notes: "1",
      twin: "1-2",
      sturdy: "1-3",
      fragile: "5-7",
      editor: "1-3",
      documented: "5-8",
      doomed: "1-3",
      limit: "1",
      keeper: "3-5",
      reader: "15-17",
      keptLines: "3-5",
      legible: "1-3",
      mover: "1-4",
      declared: "1",
      defined: "3-5",
      orphan: "1-3",
      hush: "1-3",
    },
  );

  const detected = await must("detect_changes", { current_sha: target });
  check(detected && typeof detected === "object", "detect_changes returned nothing");

  /** One evidence row's expected hint. */
  const hint = (e, anchor_state, target_lines, reason) => ({
    evidence_id: e.id,
    symbol: e.symbol,
    line_range: e.line_range,
    ref_sha: base,
    anchor_state,
    target_lines,
    reason,
  });
  const expectedRows = (at) => [
    { path: "docs/notes.txt", reason: "git-drift", at, evidence: [hint(ev.notes, "unanchored", [])] },
    { path: "lib/dups.py", reason: "git-drift", at, evidence: [hint(ev.twin, "ambiguous", ["4-5", "7-8"])] },
    {
      path: "src/broken.ts",
      reason: "git-drift",
      at,
      evidence: [
        hint(ev.sturdy, "same-text", ["1-3"]),
        hint(ev.fragile, "unavailable", [], "parse-partial"),
      ],
    },
    {
      path: "src/edits.ts",
      reason: "git-drift",
      at,
      evidence: [hint(ev.editor, "changed", ["1-3"]), hint(ev.documented, "changed", ["5-8"])],
    },
    { path: "src/gone.ts", reason: "git-drift", at, evidence: [hint(ev.doomed, "gone", [])] },
    {
      path: "src/kept.ts",
      reason: "git-drift",
      at,
      evidence: [
        hint(ev.limit, "changed", ["1"]),
        hint(ev.keeper, "same-text", ["3-5"]),
        hint(ev.reader, "same-text", ["15-17"]),
        hint(ev.keptLines, "unanchored", []),
      ],
    },
    {
      path: "src/latin1.ts",
      reason: "git-drift",
      at,
      evidence: [hint(ev.legible, "unavailable", [], "not-utf8")],
    },
    { path: "src/moves.ts", reason: "git-drift", at, evidence: [hint(ev.mover, "moved", ["5-8"])] },
    {
      path: "src/proto.cpp",
      reason: "git-drift",
      at,
      evidence: [hint(ev.declared, "same-text", ["1"]), hint(ev.defined, "changed", ["3-5"])],
    },
    {
      path: "src/removed.ts",
      reason: "absent",
      at,
      evidence: [hint(ev.orphan, "unavailable", [], "file-absent")],
    },
  ];
  const offRows = (at) =>
    expectedRows(at).map((row) => ({
      ...row,
      evidence: row.evidence.map((h) =>
        h.anchor_state === "unanchored"
          ? h
          : { ...h, anchor_state: "unavailable", target_lines: [], reason: "index-off" },
      ),
    }));

  const ledger = () =>
    db
      .prepare(
        `SELECT subsystem_id, file_path, ref_sha, classification, stale, stale_since, stale_reason
           FROM file_ledger ORDER BY subsystem_id, file_path`,
      )
      .all();
  const snapshot = () => ({
    ledger: ledger(),
    clears: db.prepare("SELECT * FROM staleness_clears ORDER BY rowid").all(),
    evidence: db.prepare("SELECT * FROM evidence ORDER BY id").all(),
    anchors: db.prepare("SELECT * FROM evidence_anchors ORDER BY evidence_id").all(),
  });

  /** The backlog, checked against the ledger, reduced to what the golden table compares. */
  const backlog = async (args = { limit: 50 }) => {
    const rows = await must("get_stale_backlog", args);
    check(Array.isArray(rows), `get_stale_backlog returned ${canonical(rows).slice(0, 200)}, not a list`);
    const byPath = new Map(ledger().map((r) => [`${r.subsystem_id}\0${r.file_path}`, r]));
    for (const row of rows) {
      const l = byPath.get(`${row.subsystem_id}\0${row.source_path}`);
      check(l, `get_stale_backlog lists ${row.source_path}, which has no ledger row`);
      same(
        `get_stale_backlog ${row.source_path}: ledger fields`,
        LEDGER_FIELDS.map((f) => row[f]),
        [l.subsystem_id, l.file_path, l.ref_sha, l.classification, l.stale_since, l.stale_reason, 0, 0],
      );
      check(l.stale === 1, `get_stale_backlog lists ${row.source_path}, which the ledger holds fresh`);
    }
    return rows.map((row) => ({
      path: row.source_path,
      reason: row.stale_reason,
      at: row.anchors_at,
      evidence: row.evidence,
    }));
  };

  // -------------------------------------------------------------------------------------
  // The target revision: every state, row for row.

  const before = canonical(snapshot());
  same("stale ledger files", ledger().filter((r) => r.stale === 1).map((r) => r.file_path), FILES.filter((f) => f !== "src/quiet.ts"));
  same("get_stale_backlog at the target revision", await backlog(), expectedRows(target));
  // A second read is served from the index's cache and must say the same.
  same("get_stale_backlog read again", await backlog(), expectedRows(target));
  same("get_stale_backlog with limit 3", await backlog({ limit: 3 }), expectedRows(target).slice(0, 3));
  same("the default limit of 10 rows", (await backlog({})).length, 10);
  same("the store after reading the backlog (nothing cleared or written)", canonical(snapshot()), before);

  // The off switch: absence cannot be shown, so nothing reads as gone or same-text.
  process.env.AMANUENSIS_CODE_INDEX = "off";
  try {
    same("get_stale_backlog with AMANUENSIS_CODE_INDEX=off", await backlog(), offRows(target));
  } finally {
    delete process.env.AMANUENSIS_CODE_INDEX;
  }
  same("get_stale_backlog with the index back on", await backlog(), expectedRows(target));

  // A refresh run built over the same range carries the same hints at its head revision.
  const plan = await must("plan_refresh_run", {
    run_id: "si8-refresh",
    replicate_id: "si8-replicate",
    base_sha: base,
    head_sha: target,
    allowed_sources: ["src"],
    provider_allowlist: ["fixture-provider"],
    selected_provider: "fixture-provider",
    model: "fixture-model",
    runtime: "fixture-runtime",
    determinism_mode: "seeded",
    determinism_seed: 42,
    relation_discovery: "explicit-only",
    max_depth: 4,
    authority_mode: "conspectus-write",
    allowed_write_prefixes: ["docs"],
    allowed_side_effects: ["analysis-api-call", "conspectus-write"],
    auto_dispatch: true,
    max_concurrency: 1,
    max_attempts_per_obligation: 2,
    max_tokens_per_attempt: 1000,
    max_total_tokens: 3000,
    max_total_cost_microusd: 3000,
    planned_tokens_per_attempt: 500,
    planned_cost_microusd: 500,
    output_dir: join(project.storagePath, "docs"),
  });
  const runHints = (run) =>
    Array.isArray(run?.anchor_hints)
      ? run.anchor_hints.map((row) => ({
          path: row.source_path,
          reason: row.stale_reason,
          at: row.anchors_at,
          evidence: row.evidence,
        }))
      : run?.anchor_hints;
  same("plan_refresh_run's anchor_hints", runHints(plan), expectedRows(target));

  // -------------------------------------------------------------------------------------
  // Reordering definitions no evidence cites changes no state and no lines.

  const reordered = reorder();
  same("get_stale_backlog after reordering alpha and beta", await backlog(), expectedRows(reordered));
  same(
    "get_refresh_run's anchor_hints stay at the run's head revision",
    runHints(await must("get_refresh_run", { run_id: "si8-refresh" })),
    expectedRows(target),
  );

  // -------------------------------------------------------------------------------------
  // clear_staleness still clears one whole ledger file, and only when asked.

  const cleared = await must("clear_staleness", {
    subsystem_id: "B-01",
    file_path: "src/kept.ts",
    ref_sha: reordered,
    reason: "re-read keeper and reader against the new LIMIT",
  });
  check(Number.isInteger(cleared?.clear_id), `clear_staleness returned ${canonical(cleared).slice(0, 200)}`);
  same(
    "get_stale_backlog after clearing src/kept.ts",
    await backlog(),
    expectedRows(reordered).filter((row) => row.path !== "src/kept.ts"),
  );
  same(
    "the ledger row clear_staleness wrote",
    db
      .prepare("SELECT stale, stale_since, stale_reason, ref_sha FROM file_ledger WHERE file_path = 'src/kept.ts'")
      .get(),
    { stale: 0, stale_since: null, stale_reason: null, ref_sha: reordered },
  );
  same(
    "staleness_clears rows",
    db.prepare("SELECT file_path, prior_ref_sha, prior_stale_reason FROM staleness_clears ORDER BY rowid").all(),
    [{ file_path: "src/kept.ts", prior_ref_sha: base, prior_stale_reason: "git-drift" }],
  );
  db.close();
}

let status;
try {
  await main();
  status = "GATE SI8 GREEN";
} catch (e) {
  status = `GATE SI8 RED: ${oneLine(e instanceof GateFailure ? e.message : `the gate stopped: ${e?.message ?? e}`)}`;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(status);
process.exit(status.endsWith("GREEN") ? 0 : 1);
