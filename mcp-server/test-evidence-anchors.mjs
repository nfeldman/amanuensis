#!/usr/bin/env node
// GATE SI7 — evidence_anchors and anchored add_evidence (design/semantic-index/PLAN.md §4.4,
// §8 SI7).
//
// Turns red when:
//   - dist/tools/evidence.js, dist/tools/code-index.js, dist/tools/locus.js or
//     dist/invariants.js is missing, or invariants.js exports no evidenceAnchorViolations;
//   - the store has no evidence_anchors table with exactly §4.4's columns, row for row, its
//     foreign key to evidence(id) ON DELETE RESTRICT, its two triggers, or its row in
//     contracts/append-only-tables.txt (with the file's table count kept true);
//   - add_evidence's input schema is not exactly what it was before this packet;
//   - read_symbol's evidence_args plus a kind does not write the evidence row and its anchor
//     together, the anchor row differs from the definition (blob, language, symbol_id, kind,
//     citeable lines, span_sha256, extractor generation, range_source), or a failed anchor
//     insert leaves an evidence row behind;
//   - the stored `symbol` is not the canonical symbol_id (a Java overload named by its qname
//     and narrowed by line_range is stored as `Parser.parse(String,int)`);
//   - an omitted line_range is not filled with the citeable span (range_source `filled`);
//   - a line_range span (a comma list included) outside the definition is accepted, or the
//     refusal does not name both ranges;
//   - an excerpt from a neighbouring definition is accepted, whether it is elsewhere in the file
//     with no line_range or on the very line the cited definition shares with its neighbour;
//   - of two occurrences of one symbol_id, line_range does not select the one it lies in, or
//     its absence (or a range covering both) is not refused with both listed;
//   - an unknown symbol is not refused with its nearest symbol_ids and the pointer to `note`;
//   - no symbol, an unsupported language, a file the index cannot read (not UTF-8) or
//     AMANUENSIS_CODE_INDEX=off does not write the evidence row as before, with no anchor;
//   - an UPDATE or DELETE on an anchor, or a DELETE of its evidence row, succeeds;
//   - evidenceAnchorViolations reports a violation on a sound store, or misses an anchor whose
//     evidence row is gone, whose evidence symbol differs from its symbol_id, whose
//     line_range leaves its definition, or whose filled line_range is not the definition's;
//   - a refusal of add_evidence is not registered in contracts/refusal-parity.json against
//     add_evidence, or the skill reference it names does not state it;
//   - the whole describe_locus result — standing and the account's structure section — does
//     not find an anchored row by bare name, by qname and by symbol_id; finds anything by a
//     bare name that names two symbol_ids instead of saying so on both surfaces, naming both
//     in standing and in every section that reads evidence (structure, defects, reviews);
//     stops finding an unanchored row by its exact free text; or stops matching the
//     contract in contracts/locus-account.schema.json;
//   - land_review_pass's new_evidence does not do what add_evidence does: a symbol naming a
//     definition stores its symbol_id, a filled range and an anchor row equal to the
//     definition's; an unknown symbol is refused with its candidates and the pass writes
//     nothing; a failed anchor insert leaves no evidence row and no judgment behind.
//
// Hermetic: the fixture repository and the store are built in a temporary directory, the
// tools run in this process from dist/, and nothing reaches the network.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "amanuensis-si7-"));

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
  if (a !== b) fail(`${label}: got ${a.slice(0, 600)}; want ${b.slice(0, 600)}`);
}
const SIGNATURES =
  /Cannot find module|MODULE_NOT_FOUND|ModuleNotFoundError|SyntaxError|No such file or directory|ENOENT|ImportError|ReferenceError|is not defined|command not found/g;
function oneLine(text) {
  return String(text).replace(SIGNATURES, "[error]").split("\n")[0].slice(0, 400);
}
function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) fail(`git ${args.join(" ")} failed: ${oneLine(r.stderr)}`);
  return r.stdout;
}
function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}
/** Lines `from`..`to` (1-based) of `path` at `rev`, as git holds them. */
function gitLines(workspace, rev, path, from, to) {
  const text = git(workspace, ["show", `${rev}:${path}`]);
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines.slice(from - 1, to).join("\n");
}

// ---------------------------------------------------------------------------------------
// Golden tables

/** §4.4's table, as PRAGMA table_info reports it: cid, name, type, notnull, default, pk. */
const ANCHOR_COLUMNS = [
  [0, "evidence_id", "INTEGER", 0, null, 1],
  [1, "blob_sha", "TEXT", 1, null, 0],
  [2, "lang", "TEXT", 1, null, 0],
  [3, "symbol_id", "TEXT", 1, null, 0],
  [4, "kind", "TEXT", 1, null, 0],
  [5, "def_start_line", "INTEGER", 1, null, 0],
  [6, "def_end_line", "INTEGER", 1, null, 0],
  [7, "span_sha256", "TEXT", 1, null, 0],
  [8, "extractor_id", "TEXT", 1, null, 0],
  [9, "range_source", "TEXT", 1, null, 0],
  [10, "anchored_at", "TEXT", 1, "datetime('now')", 0],
];
const ANCHOR_TRIGGERS = ["evidence_anchor_cannot_be_deleted", "evidence_anchor_is_immutable"];
const CONTRACT_ROW = "evidence_anchors evidence_anchor_is_immutable evidence_anchor_cannot_be_deleted";

/** add_evidence's input schema as it stood before this packet; §4.4 leaves it unchanged. */
const ADD_EVIDENCE_SCHEMA = {
  type: "object",
  properties: {
    file_path: { type: "string" },
    symbol: { type: "string" },
    line_range: { type: "string" },
    ref_sha: { type: "string" },
    kind: { type: "string" },
    excerpt: { type: "string" },
    note: { type: "string" },
    session_id: { type: "string" },
  },
  required: ["file_path", "ref_sha", "kind"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------------------

async function loadModules() {
  const load = async (path, source) => {
    check(existsSync(join(here, path)), `${path} is missing (${source} is not built)`);
    try {
      return await import(pathToFileURL(join(here, path)).href);
    } catch (e) {
      fail(`${path} did not load: ${oneLine(e?.message ?? e)}`);
    }
  };
  const mods = {
    project: await load("dist/project.js", "src/project.ts"),
    db: await load("dist/db.js", "src/db.ts"),
    invariants: await load("dist/invariants.js", "src/invariants.ts"),
    tools: [],
  };
  for (const [path, name] of [
    ["dist/tools/evidence.js", "evidenceTools"],
    ["dist/tools/project.js", "projectTools"],
    ["dist/tools/claims.js", "claimTools"],
    ["dist/tools/code-index.js", "codeIndexTools"],
    ["dist/tools/locus.js", "locusTools"],
    ["dist/tools/impact.js", "impactTools"],
    ["dist/tools/review.js", "reviewTools"],
    ["dist/tools/review-analysis.js", "reviewAnalysisTools"],
  ]) {
    const mod = await load(path, path.replace(/^dist/, "src").replace(/\.js$/, ".ts"));
    check(Array.isArray(mod[name]), `${path} does not export ${name}`);
    mods.tools.push(...mod[name]);
  }
  check(
    typeof mods.invariants.evidenceAnchorViolations === "function",
    "dist/invariants.js exports no evidenceAnchorViolations (PLAN §4.4's invariants)",
  );
  return mods;
}

async function main() {
  const mods = await loadModules();
  const byName = new Map(mods.tools.map((t) => [t.name, t]));
  const { buildEvidenceAnchorsRepo } = await import(
    pathToFileURL(join(here, "fixtures", "evidence-anchors-repo.mjs")).href
  );

  // -------------------------------------------------------------------------------------
  // The append-only contract and the input schema, before anything is written.

  const contract = readFileSync(join(here, "contracts", "append-only-tables.txt"), "utf8");
  const contractRows = contract.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  check(
    contractRows.includes(CONTRACT_ROW),
    `contracts/append-only-tables.txt has no row "${CONTRACT_ROW}"`,
  );
  const declared = /^# (\d+) tables\.$/m.exec(contract);
  check(
    declared && Number(declared[1]) === contractRows.length,
    `contracts/append-only-tables.txt says ${declared?.[1]} tables and lists ${contractRows.length}`,
  );
  same("add_evidence's input schema", byName.get("add_evidence")?.inputSchema, ADD_EVIDENCE_SCHEMA);

  const storageRoot = join(scratch, "storage");
  mkdirSync(storageRoot, { recursive: true });
  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
  process.env.AMANUENSIS_CALL_LOG = "off";
  delete process.env.AMANUENSIS_CODE_INDEX;

  const { workspace, commit } = buildEvidenceAnchorsRepo(join(scratch, "workspace"));
  const project = mods.project.resolveProject(workspace, { selectionSource: "si7-gate" });
  mods.project.ensureProjectStorage(project, (p) => mods.db.openDatabase(p).close());
  const db = mods.db.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };

  const call = async (name, args) => {
    const tool = byName.get(name);
    if (!tool) fail(`no tool ${name}`);
    return await tool.handler(args, ctx);
  };
  /** A call's answer, or { ok: false, error, rule } for a refusal thrown as a ToolError. */
  const attempt = async (name, args) => {
    try {
      return await call(name, args);
    } catch (e) {
      if (e instanceof GateFailure) throw e;
      return { ok: false, error: String(e?.message ?? e), rule: e?.rule ?? null, thrown: true };
    }
  };
  const must = async (name, args) => {
    const r = await attempt(name, args);
    if (r?.ok === false) fail(`${name} ${canonical(args).slice(0, 240)} was refused: ${oneLine(r.error)}`);
    return r;
  };

  ctx.sessionId = (await must("start_session", { intent: "si7-gate" })).session_id;

  // -------------------------------------------------------------------------------------
  // The table, its foreign key and its triggers.

  same(
    "evidence_anchors columns",
    db
      .prepare("PRAGMA table_info(evidence_anchors)")
      .all()
      .map((c) => [c.cid, c.name, c.type, c.notnull, c.dflt_value, c.pk]),
    ANCHOR_COLUMNS,
  );
  same(
    "evidence_anchors foreign keys",
    db
      .prepare("PRAGMA foreign_key_list(evidence_anchors)")
      .all()
      .map((k) => [k.table, k.from, k.to, k.on_delete]),
    [["evidence", "evidence_id", "id", "RESTRICT"]],
  );
  same(
    "evidence_anchors triggers",
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'evidence_anchors' ORDER BY name",
      )
      .all()
      .map((r) => r.name),
    ANCHOR_TRIGGERS,
  );

  const evidenceCount = () => db.prepare("SELECT COUNT(*) AS n FROM evidence").get().n;
  const anchorCount = () => db.prepare("SELECT COUNT(*) AS n FROM evidence_anchors").get().n;
  const evidenceRow = (id) =>
    db.prepare("SELECT file_path, symbol, line_range, ref_sha, kind, excerpt, note FROM evidence WHERE id = ?").get(id);
  const anchorRow = (id) => {
    const row = db.prepare("SELECT * FROM evidence_anchors WHERE evidence_id = ?").get(id);
    if (!row) return null;
    check(
      typeof row.anchored_at === "string" && row.anchored_at.length > 0,
      `anchor ${id} carries no anchored_at`,
    );
    const { anchored_at: _at, ...rest } = row;
    return rest;
  };

  const blobOf = (path) => git(workspace, ["rev-parse", `${commit}:${path}`]).trim();
  const readOut = await must("read_symbol", { path: "src/shapes.ts", symbol: "add" });
  const extractorId = readOut.extractor_id;
  check(typeof extractorId === "string" && extractorId.length === 64, "read_symbol carries no extractor_id");
  /** The anchor a definition must produce: lines are the citeable span's. */
  const anchorFor = (id, path, lang, symbolId, kind, from, to, rangeSource) => ({
    evidence_id: id,
    blob_sha: blobOf(path),
    lang,
    symbol_id: symbolId,
    kind,
    def_start_line: from,
    def_end_line: to,
    // The citeable span starts at its first token, not at the start of the line.
    span_sha256: sha256(gitLines(workspace, commit, path, from, to).replace(/^[ \t]+/, "")),
    extractor_id: extractorId,
    range_source: rangeSource,
  });

  /** Every refusal of add_evidence, checked against the register at the end. */
  const refusals = [];
  /** add_evidence must refuse, saying each of `says`, and write nothing. */
  const refused = async (label, args, says) => {
    const before = [evidenceCount(), anchorCount()];
    const r = await attempt("add_evidence", { ref_sha: commit, kind: "code-verified", ...args });
    check(r?.ok === false, `add_evidence accepted ${label}: ${canonical(r).slice(0, 300)}`);
    for (const words of says) {
      check(String(r.error).includes(words), `add_evidence's refusal of ${label} does not say "${words}": ${oneLine(r.error)}`);
    }
    same(`evidence and anchor rows after refusing ${label}`, [evidenceCount(), anchorCount()], before);
    refusals.push({ label, error: String(r.error) });
    return r;
  };
  /** add_evidence must write one evidence row; returns its id. */
  const written = async (label, args) => {
    const before = evidenceCount();
    const r = await attempt("add_evidence", { ref_sha: commit, kind: "code-verified", ...args });
    check(r?.ok !== false && r?.id != null, `add_evidence refused ${label}: ${oneLine(r?.error)}`);
    check(evidenceCount() === before + 1, `add_evidence ${label} wrote ${evidenceCount() - before} evidence rows`);
    return Number(r.id);
  };

  // -------------------------------------------------------------------------------------
  // evidence_args plus kind: evidence and anchor together.

  const args = readOut.evidence_args;
  same("read_symbol add's evidence_args", args, {
    file_path: "src/shapes.ts",
    symbol: "add",
    ref_sha: commit,
    line_range: "1-5",
  });
  const cited = await written("evidence_args plus kind", { ...args, kind: "code-verified" });
  same("the evidence row for evidence_args", evidenceRow(cited), {
    file_path: "src/shapes.ts",
    symbol: "add",
    line_range: "1-5",
    ref_sha: commit,
    kind: "code-verified",
    excerpt: null,
    note: null,
  });
  same("the anchor for evidence_args", anchorRow(cited), anchorFor(cited, "src/shapes.ts", "typescript", "add", "function", 1, 5, "cited"));

  // A filled range: the citeable span, documentation included; a name for ref_sha is stored resolved.
  const filled = await written("add with no line_range", { file_path: "src/shapes.ts", symbol: "add", ref_sha: "HEAD" });
  same("the filled evidence row", evidenceRow(filled).line_range, "1-5");
  same("the filled evidence row's ref_sha", evidenceRow(filled).ref_sha, commit);
  same("the filled anchor", anchorRow(filled), anchorFor(filled, "src/shapes.ts", "typescript", "add", "function", 1, 5, "filled"));

  // The canonical symbol_id is stored: a Java overload named by its qname, picked by line_range.
  const overload = await written("Parser.parse narrowed to the second overload", {
    file_path: "src/Parser.java",
    symbol: "Parser.parse",
    line_range: "9-10",
    excerpt: "return base;",
  });
  same("the overload's evidence row", evidenceRow(overload), {
    file_path: "src/Parser.java",
    symbol: "Parser.parse(String,int)",
    line_range: "9-10",
    ref_sha: commit,
    kind: "code-verified",
    excerpt: "return base;",
    note: null,
  });
  same(
    "the overload's anchor",
    anchorRow(overload),
    anchorFor(overload, "src/Parser.java", "java", "Parser.parse(String,int)", "method", 8, 11, "cited"),
  );
  await refused(
    "Parser.parse with no line_range",
    { file_path: "src/Parser.java", symbol: "Parser.parse" },
    ["Parser.parse(String)", "Parser.parse(String,int)", "3-6", "8-11"],
  );

  // A unique bare name resolves to its symbol_id; a bare name shared by two classes is picked by range.
  const button = await written("render inside Button", { file_path: "src/shapes.ts", symbol: "render", line_range: "17" });
  same("bare render in Button's lines", evidenceRow(button).symbol, "Button.render");
  same("bare render's anchor", anchorRow(button), anchorFor(button, "src/shapes.ts", "typescript", "Button.render", "method", 16, 18, "cited"));
  await refused("render with no line_range", { file_path: "src/shapes.ts", symbol: "render" }, [
    "Label.render",
    "Button.render",
    "10-12",
    "16-18",
  ]);
  const label = await written("Label.render", { file_path: "src/shapes.ts", symbol: "Label.render" });
  same("Label.render's anchor", anchorRow(label), anchorFor(label, "src/shapes.ts", "typescript", "Label.render", "method", 10, 12, "filled"));

  // -------------------------------------------------------------------------------------
  // Ranges: every span inside the definition.

  const comma = await written("add 2,4", { file_path: "src/shapes.ts", symbol: "add", line_range: "2, 4" });
  same("add 2,4's line_range", evidenceRow(comma).line_range, "2,4");
  same("add 2,4's anchor", anchorRow(comma), anchorFor(comma, "src/shapes.ts", "typescript", "add", "function", 1, 5, "cited"));
  await refused("add 2,8 (one span outside)", { file_path: "src/shapes.ts", symbol: "add", line_range: "2,8" }, ["2,8", "1-5"]);
  await refused("add 4-7 (a span across the end)", { file_path: "src/shapes.ts", symbol: "add", line_range: "4-7" }, ["4-7", "1-5"]);

  // -------------------------------------------------------------------------------------
  // Excerpts: inside the definition's bytes, intersected with the cited spans.

  const quoted = await written("add quoting its own body", {
    file_path: "src/shapes.ts",
    symbol: "add",
    excerpt: "const sum = a + b;",
  });
  same("add's quoted evidence", evidenceRow(quoted).excerpt, "const sum = a + b;");
  await refused(
    "add quoting Label's body (no line_range)",
    { file_path: "src/shapes.ts", symbol: "add", excerpt: 'return "label";' },
    ["add"],
  );
  await refused(
    "one quoting two on their shared line",
    { file_path: "src/shapes.ts", symbol: "one", line_range: "7", excerpt: 'return "beta";' },
    ["one"],
  );
  await refused(
    "two quoting one on their shared line",
    { file_path: "src/shapes.ts", symbol: "two", line_range: "7", excerpt: 'return "alpha";' },
    ["two"],
  );
  await refused(
    "one quoting across into two with an elision",
    { file_path: "src/shapes.ts", symbol: "one", line_range: "7", excerpt: 'return "alpha"; ... function two' },
    ["one"],
  );
  const two = await written("two quoting itself on the shared line", {
    file_path: "src/shapes.ts",
    symbol: "two",
    line_range: "7",
    excerpt: 'return "beta";',
  });
  same("two's anchor", anchorRow(two), {
    ...anchorFor(two, "src/shapes.ts", "typescript", "two", "function", 7, 7, "cited"),
    span_sha256: sha256('export function two() { return "beta"; }'),
  });
  await written("one quoting itself on the shared line", {
    file_path: "src/shapes.ts",
    symbol: "one",
    line_range: "7",
    excerpt: 'return "alpha";',
  });

  // -------------------------------------------------------------------------------------
  // Occurrences of one symbol_id.

  await refused("sep with no line_range", { file_path: "lib/dup.py", symbol: "sep" }, ["sep", "4-5", "7-8"]);
  await refused("sep over both occurrences", { file_path: "lib/dup.py", symbol: "sep", line_range: "4-8" }, ["4-5", "7-8"]);
  const second = await written("sep in its second occurrence", { file_path: "lib/dup.py", symbol: "sep", line_range: "8" });
  same("sep's second occurrence", anchorRow(second), anchorFor(second, "lib/dup.py", "python", "sep", "function", 7, 8, "cited"));
  const first = await written("sep in its first occurrence", { file_path: "lib/dup.py", symbol: "sep", line_range: "4-5" });
  same("sep's first occurrence", anchorRow(first), anchorFor(first, "lib/dup.py", "python", "sep", "function", 4, 5, "cited"));

  // -------------------------------------------------------------------------------------
  // Unknown symbols: refused with candidates, and the label's place.

  await refused("an unknown symbol", { file_path: "src/shapes.ts", symbol: "ad", line_range: "2" }, ["ad", "add", "note"]);
  await refused("an unknown overload", { file_path: "src/Parser.java", symbol: "Parser.parse(int)" }, [
    "Parser.parse(String)",
    "note",
  ]);

  // -------------------------------------------------------------------------------------
  // No anchor, and the write proceeds as it did.

  const noAnchor = async (label, extra, symbol) => {
    const id = await written(label, extra);
    check(anchorRow(id) === null, `${label} wrote an anchor`);
    same(`${label}'s stored symbol`, evidenceRow(id).symbol, symbol);
    return id;
  };
  await noAnchor("no symbol", { file_path: "src/shapes.ts", line_range: "2-3" }, null);
  const notes = await noAnchor("an unsupported language", { file_path: "docs/notes.txt", symbol: "Notes", line_range: "1" }, "Notes");
  await noAnchor("a file that is not UTF-8", { file_path: "src/latin1.ts", symbol: "caf" }, "caf");
  process.env.AMANUENSIS_CODE_INDEX = "off";
  try {
    await noAnchor("the index off, a real symbol", { file_path: "src/shapes.ts", symbol: "add", line_range: "2" }, "add");
    await noAnchor("the index off, an unknown symbol", { file_path: "src/shapes.ts", symbol: "nothing here" }, "nothing here");
  } finally {
    delete process.env.AMANUENSIS_CODE_INDEX;
  }

  // -------------------------------------------------------------------------------------
  // A failed anchor leaves no evidence row: the two are one transaction.

  db.exec(
    "CREATE TRIGGER si7_gate_refuse_anchor BEFORE INSERT ON evidence_anchors BEGIN SELECT RAISE(ABORT, 'si7 gate refuses the anchor'); END;",
  );
  try {
    const before = [evidenceCount(), anchorCount()];
    const r = await attempt("add_evidence", { file_path: "src/shapes.ts", symbol: "add", ref_sha: commit, kind: "code-verified" });
    check(r?.ok === false, "add_evidence succeeded although its anchor could not be written");
    same("evidence and anchor rows after a failed anchor", [evidenceCount(), anchorCount()], before);
  } finally {
    db.exec("DROP TRIGGER si7_gate_refuse_anchor");
  }

  // -------------------------------------------------------------------------------------
  // Append-only.

  for (const [label, sql] of [
    ["an UPDATE of an anchor", `UPDATE evidence_anchors SET def_end_line = 99 WHERE evidence_id = ${cited}`],
    ["a DELETE of an anchor", `DELETE FROM evidence_anchors WHERE evidence_id = ${cited}`],
    ["a DELETE of an anchored evidence row", `DELETE FROM evidence WHERE id = ${cited}`],
  ]) {
    let aborted = false;
    try {
      db.exec(sql);
    } catch {
      aborted = true;
    }
    check(aborted, `${label} succeeded`);
  }
  same("the anchor after the refused writes", anchorRow(cited), anchorFor(cited, "src/shapes.ts", "typescript", "add", "function", 1, 5, "cited"));

  // -------------------------------------------------------------------------------------
  // Invariants: sound now, and each break is reported. Each break is rolled back.

  const violations = () => mods.invariants.evidenceAnchorViolations(db);
  same("evidenceAnchorViolations on a sound store", violations(), []);
  const broken = (label, sql, evidenceId) => {
    db.exec("SAVEPOINT si7_break");
    try {
      db.exec(sql);
      const found = violations();
      check(
        Array.isArray(found) && found.some((v) => Number(v.evidence_id) === evidenceId),
        `evidenceAnchorViolations missed ${label}: ${canonical(found).slice(0, 300)}`,
      );
      check(
        found.every((v) => Number(v.evidence_id) === evidenceId),
        `evidenceAnchorViolations reported more than ${label}: ${canonical(found).slice(0, 300)}`,
      );
    } finally {
      db.exec("ROLLBACK TO si7_break");
      db.exec("RELEASE si7_break");
    }
  };
  broken("a symbol that differs from the anchor's symbol_id", `UPDATE evidence SET symbol = 'Label' WHERE id = ${cited}`, cited);
  broken("a line_range that leaves the definition", `UPDATE evidence SET line_range = '2,6' WHERE id = ${comma}`, comma);
  broken("a filled line_range that is not the definition's", `UPDATE evidence SET line_range = '2-5' WHERE id = ${filled}`, filled);
  db.pragma("foreign_keys = OFF");
  try {
    broken(
      "an anchor whose evidence row is gone",
      "INSERT INTO evidence_anchors (evidence_id, blob_sha, lang, symbol_id, kind, def_start_line, def_end_line, span_sha256, extractor_id, range_source) " +
        "VALUES (424242, 'b', 'typescript', 'add', 'function', 1, 5, 's', 'x', 'filled')",
      424242,
    );
  } finally {
    db.pragma("foreign_keys = ON");
  }
  same("evidenceAnchorViolations after every break was rolled back", violations(), []);

  // -------------------------------------------------------------------------------------
  // The register: every add_evidence refusal is registered and its reference states it.

  const register = JSON.parse(readFileSync(join(here, "contracts", "refusal-parity.json"), "utf8"));
  const evidenceEntries = register.refusals.filter(
    (e) => e.server?.file === "src/tools/evidence.ts" && (e.refuses ?? []).includes("add_evidence"),
  );
  for (const { label, error } of refusals) {
    const entry = evidenceEntries.find((e) => error.replace(/\s+/g, " ").includes(e.server.phrase));
    check(entry, `the refusal of ${label} is not registered against add_evidence: ${oneLine(error)}`);
    for (const reference of entry.references ?? []) {
      const text = readFileSync(join(here, reference.file), "utf8").replace(/\s+/g, " ");
      const wanted = reference.phrase ?? entry.server.phrase;
      check(text.includes(wanted), `${reference.file} does not state "${wanted}" (${entry.id})`);
    }
    check((entry.references ?? []).length > 0, `${entry.id} names no skill reference`);
  }

  // -------------------------------------------------------------------------------------
  // describe_locus, the whole result: standing and the account agree.

  let validate = null;
  try {
    const Ajv2020 = (await import("ajv/dist/2020.js")).default;
    const schema = JSON.parse(readFileSync(join(here, "contracts", "locus-account.schema.json"), "utf8"));
    validate = new Ajv2020({ strict: true }).compile(schema);
  } catch (e) {
    fail(`contracts/locus-account.schema.json did not compile: ${oneLine(e?.message ?? e)}`);
  }
  let claimNumber = 0;
  const claimOn = async (evidenceId) => {
    claimNumber += 1;
    const claimId = `si7-claim-${claimNumber}`;
    await must("add_claim", {
      claim_id: claimId,
      claim_key: `si7/claim/${claimNumber}`,
      subject_type: "symbol",
      subject_id: `elsewhere-${claimNumber}`,
      statement: `Fixture claim ${claimNumber} rests on evidence ${evidenceId}.`,
      epistemic_kind: "observation",
      ref_sha: commit,
      evidence_ids: [evidenceId],
    });
    return claimId;
  };
  const overloadClaim = await claimOn(overload);
  const labelClaim = await claimOn(label);
  const buttonClaim = await claimOn(button);
  const notesClaim = await claimOn(notes);

  const describe = async (locus) => {
    const r = await must("describe_locus", { locus, sections: ["structure"] });
    check(validate(r), `describe_locus ${locus} breaks the locus-account contract: ${canonical(validate.errors).slice(0, 300)}`);
    same(`describe_locus ${locus}: kind`, r.locus.kind, "symbol");
    return r;
  };
  /** The claim ids the structure section counts: served, or withheld while the file is unexamined. */
  const structureClaims = (r) => {
    const s = r.sections.structure;
    const served = (s.items ?? []).map((i) => i.claim_id ?? i.id);
    return { served, counted: served.length + (s.withheld_unauthorized ?? 0) };
  };
  const evidenceRows = (r) => r.standing.citing_evidence.map((e) => e.id);

  for (const locus of [
    "src/Parser.java:parse",
    "src/Parser.java:Parser.parse",
    "src/Parser.java:Parser.parse(String,int)",
  ]) {
    const r = await describe(locus);
    same(`describe_locus ${locus}: standing cites`, evidenceRows(r), [overload]);
    same(`describe_locus ${locus}: symbol_cited`, r.standing.symbol_cited, true);
    same(`describe_locus ${locus}: prefix matches`, r.standing.symbol_prefix_matches, []);
    check(r.standing.symbol_standing === undefined, `describe_locus ${locus} reports symbol_standing ${r.standing.symbol_standing}`);
    const claims = structureClaims(r);
    check(claims.counted === 1, `describe_locus ${locus}: the structure section counts ${claims.counted} claims, not the one on evidence ${overload}`);
    check(
      claims.served.length === 0 || canonical(claims.served) === canonical([overloadClaim]),
      `describe_locus ${locus}: the structure section serves ${canonical(claims.served)}`,
    );
  }

  {
    const locus = "src/shapes.ts:render";
    const r = await describe(locus);
    same(`describe_locus ${locus}: standing cites`, evidenceRows(r), []);
    same(`describe_locus ${locus}: symbol_cited`, r.standing.symbol_cited, false);
    same(`describe_locus ${locus}: symbol_standing`, r.standing.symbol_standing, "ambiguous");
    for (const id of ["Label.render", "Button.render"]) {
      check(String(r.standing.note).includes(id), `describe_locus ${locus}: the standing note does not name ${id}: ${oneLine(r.standing.note)}`);
      check(
        String(r.sections.structure.statement).includes(id),
        `describe_locus ${locus}: the structure section does not name ${id}: ${oneLine(r.sections.structure.statement)}`,
      );
    }
    same(`describe_locus ${locus}: structure claims counted`, structureClaims(r).counted, 0);
    // Every section that reads the locus's evidence says so too, not only structure.
    const all = await must("describe_locus", {
      locus,
      sections: ["purpose", "structure", "defects", "reviews", "boundaries", "terms", "leads", "history_pointer"],
    });
    check(validate(all), `describe_locus ${locus} (every section) breaks the locus-account contract: ${canonical(validate.errors).slice(0, 300)}`);
    for (const section of ["structure", "defects", "reviews"]) {
      for (const id of ["Label.render", "Button.render"]) {
        check(
          String(all.sections?.[section]?.statement).includes(id),
          `describe_locus ${locus}: the ${section} section does not name ${id}: ${oneLine(all.sections?.[section]?.statement)}`,
        );
      }
    }
  }
  for (const [locus, evidence, claim] of [
    ["src/shapes.ts:Label.render", label, labelClaim],
    ["src/shapes.ts:Button.render", button, buttonClaim],
    ["docs/notes.txt:Notes", notes, notesClaim],
  ]) {
    const r = await describe(locus);
    same(`describe_locus ${locus}: standing cites`, evidenceRows(r), [evidence]);
    const claims = structureClaims(r);
    check(claims.counted === 1, `describe_locus ${locus}: the structure section counts ${claims.counted} claims, not ${claim}`);
  }
  {
    // Every anchored row on `add` is found by its bare name and nothing else is.
    const r = await describe("src/shapes.ts:add");
    const want = db
      .prepare("SELECT id FROM evidence WHERE file_path = 'src/shapes.ts' AND symbol = 'add' ORDER BY id")
      .all()
      .map((row) => row.id);
    same("describe_locus src/shapes.ts:add: standing cites", evidenceRows(r), want);
  }

  // -------------------------------------------------------------------------------------
  // land_review_pass: new_evidence is resolved and anchored as add_evidence anchors it.

  write(workspace, "src/extra.ts", "export const extra = 1;\n");
  git(workspace, ["add", "src/extra.ts"]);
  git(workspace, ["-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-verify", "-m", "review head"]);
  const reviewHead = git(workspace, ["rev-parse", "HEAD"]).trim();
  await must("predict_change_impact", { base_sha: commit, head_sha: reviewHead, run_id: "si7-impact" });
  await must("compile_review_brief", {
    brief_id: "si7-brief",
    impact_run_id: "si7-impact",
    task: "Review the shapes module.",
    task_constraints: [
      { constraint_id: "c1", statement: "Keep add pure.", source_kind: "direct-user", source_ref: "si7" },
    ],
    context_profile: "diff-scoped",
    token_budget: 20_000,
  });
  await must("publish_review_brief", { brief_id: "si7-brief" });
  const passSpec = (role, n) => ({
    pass_id: `si7-run:${role}${n}`,
    role,
    replicate_id: `${role}${n}`,
    context_profile: "diff-scoped",
    analytical_frame: role === "generator" ? "contract-risk" : role === "refuter" ? "fair-refutation" : "evidence-verification",
    provider: "fixture-provider",
    model: `${role}-model`,
    model_family: `${role}-family`,
    runtime: "fixture-runtime",
    planned_tokens: 10,
    planned_cost_microusd: 0,
  });
  await must("plan_review_analysis", {
    run_id: "si7-run",
    replicate_id: "r1",
    condition: "same-context",
    orchestrator_model_family: "orchestrator-family",
    provider_allowlist: ["fixture-provider"],
    allowed_source_prefixes: ["src"],
    max_total_tokens: 100,
    max_total_cost_microusd: 0,
    blind_assignment_id: "si7-run:assignment",
    sealed_truth_hash: sha256("si7 sealed truth"),
    brief_ids: ["si7-brief"],
    pass_specs: ["generator", "refuter", "verifier"].flatMap((role) => [passSpec(role, 1), passSpec(role, 2)]),
  });
  await must("dispatch_review_pass", { run_id: "si7-run", pass_id: "si7-run:generator1" });
  const judgmentCount = () => db.prepare("SELECT COUNT(*) AS n FROM review_judgments").get().n;
  const land = (newEvidence) =>
    attempt("land_review_pass", {
      run_id: "si7-run",
      pass_id: "si7-run:generator1",
      judgments: [
        {
          finding_key: "si7-finding",
          claim: "add returns the sum.",
          severity: "LOW",
          scope: "shapes",
          rationale: "Read from the definition.",
          new_evidence_keys: newEvidence.map((row) => row.local_key),
        },
      ],
      new_evidence: newEvidence,
      actual_tokens: 1,
      actual_cost_microusd: 0,
    });
  const landRows = () => [evidenceCount(), anchorCount(), judgmentCount()];
  {
    const before = landRows();
    const r = await land([
      { local_key: "unknown", file_path: "src/shapes.ts", symbol: "ad", ref_sha: commit, kind: "code-verified" },
    ]);
    check(r?.ok === false, `land_review_pass accepted an unknown symbol: ${canonical(r).slice(0, 300)}`);
    for (const words of ["ad", "add", "note"]) {
      check(String(r.error).includes(words), `land_review_pass's refusal of an unknown symbol does not say "${words}": ${oneLine(r.error)}`);
    }
    same("evidence, anchor and judgment rows after refusing an unknown symbol", landRows(), before);
  }
  db.exec(
    "CREATE TRIGGER si7_gate_refuse_anchor BEFORE INSERT ON evidence_anchors BEGIN SELECT RAISE(ABORT, 'si7 gate refuses the anchor'); END;",
  );
  try {
    const before = landRows();
    const r = await land([
      { local_key: "blocked", file_path: "src/shapes.ts", symbol: "add", ref_sha: commit, kind: "code-verified" },
    ]);
    check(r?.ok === false, "land_review_pass succeeded although its anchor could not be written");
    same("evidence, anchor and judgment rows after a failed review-pass anchor", landRows(), before);
  } finally {
    db.exec("DROP TRIGGER si7_gate_refuse_anchor");
  }
  {
    // A bare name narrowed by line_range is stored as its symbol_id; an omitted range is filled.
    const before = evidenceCount();
    const r = await land([
      { local_key: "bare", file_path: "src/shapes.ts", symbol: "render", line_range: "17", ref_sha: commit, kind: "code-verified" },
      { local_key: "filled", file_path: "src/shapes.ts", symbol: "Label.render", ref_sha: "HEAD~1", kind: "code-verified" },
    ]);
    check(r?.ok !== false, `land_review_pass refused render and Label.render: ${oneLine(r?.error)}`);
    check(evidenceCount() === before + 2, `land_review_pass wrote ${evidenceCount() - before} evidence rows, not 2`);
    const [bare, filledRow] = db.prepare("SELECT id FROM evidence ORDER BY id DESC LIMIT 2").all().map((row) => row.id).reverse();
    const row = (symbol, lineRange) => ({
      file_path: "src/shapes.ts",
      symbol,
      line_range: lineRange,
      ref_sha: commit,
      kind: "code-verified",
      excerpt: null,
      note: null,
    });
    same("the review pass's bare-name evidence row", evidenceRow(bare), row("Button.render", "17"));
    same("the review pass's bare-name anchor", anchorRow(bare), anchorFor(bare, "src/shapes.ts", "typescript", "Button.render", "method", 16, 18, "cited"));
    same("the review pass's filled evidence row", evidenceRow(filledRow), row("Label.render", "10-12"));
    same("the review pass's filled anchor", anchorRow(filledRow), anchorFor(filledRow, "src/shapes.ts", "typescript", "Label.render", "method", 10, 12, "filled"));
  }

}

let status;
try {
  await main();
  status = "GATE SI7 GREEN";
} catch (e) {
  status = `GATE SI7 RED: ${oneLine(e instanceof GateFailure ? e.message : `the gate stopped: ${e?.message ?? e}`)}`;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(status);
process.exit(status.endsWith("GREEN") ? 0 : 1);
