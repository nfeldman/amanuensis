#!/usr/bin/env node
// GATE SI6 — find_symbol and search_records (design/semantic-index/PLAN.md §4.3, §4.6, §8 SI6).
//
// Turns red when:
//   - dist/tools/code-index.js or dist/code-index/records.js is missing, or find_symbol and
//     search_records are not among the code-index tools;
//   - a definition is not found by a camel-case fragment of its name (`Request`, `HTTP` in
//     `parseHTTPRequest`) or by a word of its doc comment (`frobnication`), or the rows are not,
//     row for row, the golden definitions (path, symbol_id, kind, lines, signature), or a row
//     carries a body; kind and path_prefix do not narrow them;
//   - a reference row does not carry match: "name", or the reference rows are not the golden
//     name-matched rows (a same-named Python function's call included), or ref_sha does not
//     select the older revision's references;
//   - an incomplete tree index does not report partial, or a completed one still does;
//   - a claim written after the first search is not found by the next;
//   - a vocabulary update adding a new word is not found by it;
//   - a low-sorting text key (a claim id `0-low` written after `zz-first`, a term `Aardwolf`
//     after `Zymurgy`) is not found;
//   - a superseded claim, a claim inapplicable at HEAD, a replaced narrative, a withdrawn
//     narrative key, an explanation whose revision the workspace does not reach and one below
//     its phase are present by default, or absent with include_history, or carry the wrong
//     status; or an effective narrative or explanation is not found by default;
//   - kinds or subject do not narrow the hits, or a snippet is over 240 bytes or lacks the word;
//   - the source list in code-index/records.ts does not match schema.sql: a table, key or text
//     column it names is not in the schema, an append-only source is not cursored by rowid or a
//     table updated in place is not reconciled by content digest;
//   - with the index off, the tools are not refused as the register and references/code-index.md
//     state, or the refusal register's check finds drift.
//
// Hermetic: fixture git repositories and stores are built in a temporary directory, and the
// built tool handlers are called in-process, as test-explanation-read.mjs does. No network.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "amanuensis-si6-"));

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
const SIGNATURES = /Cannot find module|MODULE_NOT_FOUND|ModuleNotFoundError|SyntaxError|No such file or directory|ENOENT|ImportError|ReferenceError|is not defined|command not found|Traceback \(most recent call last\)/g;
function oneLine(text) {
  return String(text).replace(SIGNATURES, "[error]").split("\n")[0].slice(0, 400);
}
function git(cwd, args) {
  const r = spawnSync(
    "git",
    ["-c", "user.email=si6@localhost", "-c", "user.name=si6", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  );
  if (r.status !== 0) fail(`git ${args.join(" ")} failed: ${oneLine(r.stderr)}`);
  return r.stdout.trim();
}
function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

// ---------------------------------------------------------------------------------------
// The fixture repository: two revisions. The second adds a call to parseHTTPRequest.

const HTTP_TS = `/** Parses an incoming request line into its parts. */
export function parseHTTPRequest(line: string): string[] {
  return line.split(" ");
}

/** Computes the frobnication checksum of a block. */
export function digestBlock(block: string): number {
  return block.length;
}
`;
const useTs = (revision) => `import { parseHTTPRequest } from "./http";
export function handle(line: string) {
  const r = parseHTTPRequest(line);
${revision === 1 ? "  return r;" : "  return parseHTTPRequest(r[0]);"}
}
`;
const OTHER_PY = `def parseHTTPRequest(x):
    return x

parseHTTPRequest(1)
`;

function buildRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  write(dir, "src/http.ts", HTTP_TS);
  write(dir, "src/use.ts", useTs(1));
  write(dir, "lib/other.py", OTHER_PY);
  write(dir, "docs/readme.txt", "Not code.\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--no-verify", "-m", "first"]);
  const first = git(dir, ["rev-parse", "HEAD"]);
  write(dir, "src/use.ts", useTs(2));
  git(dir, ["commit", "-q", "--no-verify", "-am", "second"]);
  const second = git(dir, ["rev-parse", "HEAD"]);
  // A commit HEAD does not reach, for a claim inapplicable at HEAD.
  git(dir, ["checkout", "-q", "-b", "side", first]);
  write(dir, "src/side.ts", "export const side = 1;\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--no-verify", "-m", "side"]);
  const side = git(dir, ["rev-parse", "HEAD"]);
  git(dir, ["checkout", "-q", "main"]);
  return { first, second, side };
}

/** A well-formed object name no repository here carries. */
const UNREACHABLE_SHA = "b0a7e5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c";

// ---------------------------------------------------------------------------------------

async function loadModules() {
  const need = [
    ["dist/tools/code-index.js", "src/tools/code-index.ts"],
    ["dist/code-index/records.js", "src/code-index/records.ts"],
    ["dist/code-index/search.js", "src/code-index/search.ts"],
  ];
  for (const [built, source] of need) {
    check(existsSync(join(here, built)), `${built} is missing (${source} is not built)`);
  }
  const load = async (path) => {
    try {
      return await import(pathToFileURL(join(here, path)).href);
    } catch (e) {
      fail(`${path} did not load: ${oneLine(e?.message ?? e)}`);
    }
  };
  const mods = {
    codeIndex: await load("dist/tools/code-index.js"),
    records: await load("dist/code-index/records.js"),
    project: await load("dist/project.js"),
    db: await load("dist/db.js"),
  };
  mods.tools = [];
  for (const [path, name] of [
    ["dist/tools/evidence.js", "evidenceTools"],
    ["dist/tools/project.js", "projectTools"],
    ["dist/tools/claims.js", "claimTools"],
    ["dist/tools/narratives.js", "narrativeTools"],
    ["dist/tools/explanations.js", "explanationTools"],
    ["dist/tools/vocabulary.js", "vocabularyTools"],
    ["dist/tools/code-index.js", "codeIndexTools"],
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
  for (const name of ["find_symbol", "search_records"]) {
    check(
      mods.codeIndex.codeIndexTools.some((t) => t.name === name),
      `codeIndexTools has no ${name}`,
    );
  }
  const call = async (ctx, name, args) => {
    const tool = byName.get(name);
    if (!tool) fail(`no tool ${name}`);
    return await tool.handler(args, ctx);
  };
  const tryCall = async (ctx, name, args) => {
    try {
      return await call(ctx, name, args);
    } catch (e) {
      fail(`${name} ${canonical(args).slice(0, 200)} threw: ${oneLine(e?.message ?? e)}`);
    }
  };

  const storageRoot = join(scratch, "storage");
  mkdirSync(storageRoot, { recursive: true });
  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
  process.env.AMANUENSIS_CALL_LOG = "off";
  delete process.env.AMANUENSIS_CODE_INDEX;
  delete process.env.AMANUENSIS_CODE_INDEX_MAX_FILES;

  async function world(label) {
    const ws = join(scratch, `ws-${label}`);
    const revs = buildRepo(ws);
    const project = mods.project.resolveProject(ws, { selectionSource: "si6-gate" });
    mods.project.ensureProjectStorage(project, (p) => mods.db.openDatabase(p).close());
    const db = mods.db.openDatabase(project.dbPath);
    const ctx = { project, db, sessionId: null };
    ctx.sessionId = (await tryCall(ctx, "start_session", { intent: `si6-${label}` })).session_id;
    return { ws, ctx, ...revs };
  }

  // -------------------------------------------------------------------------------------
  // find_symbol: an incomplete tree index reports partial, then completes.
  {
    const w = await world("partial");
    process.env.AMANUENSIS_CODE_INDEX_MAX_FILES = "1";
    let r;
    try {
      r = await tryCall(w.ctx, "find_symbol", { query: "Request" });
    } finally {
      delete process.env.AMANUENSIS_CODE_INDEX_MAX_FILES;
    }
    check(r?.ok === true, `find_symbol under a one-file budget was refused: ${oneLine(r?.error)}`);
    check(r.partial === true, `find_symbol with an incomplete tree index reports partial ${r.partial}`);
    const again = await tryCall(w.ctx, "find_symbol", { query: "Request" });
    check(again.ok === true, `find_symbol was refused: ${oneLine(again.error)}`);
    check(again.partial === false, `find_symbol over a complete tree index reports partial ${again.partial}`);
    check(again.results.length === 2, `find_symbol Request after completing found ${again.results.length} rows, not 2`);
  }

  const w = await world("main");
  const { ctx, ws, first, second, side } = w;

  // -------------------------------------------------------------------------------------
  // find_symbol: definitions

  const TS_PARSE = {
    path: "src/http.ts",
    symbol_id: "parseHTTPRequest",
    kind: "function",
    start_line: 2,
    end_line: 4,
    doc_start_line: 1,
    signature: "export function parseHTTPRequest(line: string): string[] {",
  };
  const PY_PARSE = {
    path: "lib/other.py",
    symbol_id: "parseHTTPRequest",
    kind: "function",
    start_line: 1,
    end_line: 2,
    signature: "def parseHTTPRequest(x):",
  };
  const DIGEST = {
    path: "src/http.ts",
    symbol_id: "digestBlock",
    kind: "function",
    start_line: 7,
    end_line: 9,
    doc_start_line: 6,
    signature: "export function digestBlock(block: string): number {",
  };
  const rowsOf = (r) =>
    [...r.results].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.start_line - b.start_line));
  const definition = (row) => ({
    path: row.path,
    symbol_id: row.symbol_id,
    kind: row.kind,
    start_line: row.start_line,
    end_line: row.end_line,
    doc_start_line: row.doc_start_line,
    signature: row.signature,
  });
  for (const [label, args, want] of [
    ["the camel-case fragment Request", { query: "Request" }, [PY_PARSE, TS_PARSE]],
    ["the camel-case fragment HTTP", { query: "HTTP" }, [PY_PARSE, TS_PARSE]],
    ["the doc-comment word frobnication", { query: "frobnication" }, [DIGEST]],
    ["Request under src/", { query: "Request", path_prefix: "src/" }, [TS_PARSE]],
    ["Request as a class", { query: "Request", kind: "class" }, []],
    ["a word nothing holds", { query: "xylophone" }, []],
  ]) {
    const r = await tryCall(ctx, "find_symbol", args);
    check(r.ok === true, `find_symbol ${label} was refused: ${oneLine(r.error)}`);
    check(r.mode === "definitions", `find_symbol ${label}: mode is ${r.mode}, not definitions`);
    check(r.partial === false, `find_symbol ${label}: partial is ${r.partial} over a complete tree`);
    check(r.ref_sha === second, `find_symbol ${label}: ref_sha ${r.ref_sha} is not HEAD`);
    same(`find_symbol ${label}`, rowsOf(r).map(definition), want);
    for (const row of r.results) {
      for (const key of ["source", "body", "text"]) {
        check(!(key in row), `find_symbol ${label} carries a ${key}: it returns no bodies`);
      }
      check(!JSON.stringify(row).includes("line.split"), `find_symbol ${label} carries a body`);
    }
  }

  // find_symbol: references, matched by name only.
  const REFS_SECOND = [
    { path: "lib/other.py", name: "parseHTTPRequest", kind: "call", line: 4, match: "name" },
    { path: "src/use.ts", name: "parseHTTPRequest", kind: "call", line: 3, match: "name" },
    { path: "src/use.ts", name: "parseHTTPRequest", kind: "call", line: 4, match: "name" },
  ];
  const refRows = (r) =>
    [...r.results]
      .map((x) => ({ path: x.path, name: x.name, kind: x.kind, line: x.line, match: x.match }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
  {
    const r = await tryCall(ctx, "find_symbol", { query: "parseHTTPRequest", mode: "references" });
    check(r.ok === true, `find_symbol references was refused: ${oneLine(r.error)}`);
    check(r.mode === "references", `find_symbol references: mode is ${r.mode}`);
    for (const row of r.results) {
      check(row.match === "name", `a reference row carries match ${JSON.stringify(row.match)}, not "name"`);
    }
    same("find_symbol references at HEAD", refRows(r), REFS_SECOND);
    const older = await tryCall(ctx, "find_symbol", { query: "parseHTTPRequest", mode: "references", ref_sha: first });
    check(older.ok === true && older.ref_sha === first, `find_symbol references at the first revision: ${oneLine(older.error ?? older.ref_sha)}`);
    same(
      "find_symbol references at the first revision",
      refRows(older),
      REFS_SECOND.filter((x) => !(x.path === "src/use.ts" && x.line === 4)),
    );
    const typed = await tryCall(ctx, "find_symbol", { query: "parseHTTPRequest", mode: "references", path_prefix: "lib/" });
    same("find_symbol references under lib/", refRows(typed), REFS_SECOND.slice(0, 1));
  }

  // -------------------------------------------------------------------------------------
  // search_records

  const head = second;
  const store = ctx.db;
  store.prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, ?)").run("S-01", "S-01 fixture", "structural");
  store.prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, ?)").run("S-02", "S-02 fixture", "scoping");
  for (const sid of ["S-01", "S-02"]) {
    store
      .prepare(
        `INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha)
         VALUES (?, 'src/http.ts', 'fixture', 'examined', ?)`,
      )
      .run(sid, head);
  }
  const evidence = async (ref = head) =>
    (await tryCall(ctx, "add_evidence", { file_path: "src/http.ts", line_range: "2-4", ref_sha: ref, kind: "code-verified" })).id;
  const addClaim = async (id, key, statement, ref = head) => {
    const ev = await evidence(ref);
    const r = await tryCall(ctx, "add_claim", {
      claim_id: id,
      claim_key: key,
      subject_type: "subsystem",
      subject_id: "S-01",
      statement,
      epistemic_kind: "observation",
      ref_sha: ref,
      evidence_ids: [ev],
    });
    check(r?.ok !== false, `add_claim ${id} was refused: ${oneLine(r?.error)}`);
  };
  const search = async (query, extra = {}) => {
    const r = await tryCall(ctx, "search_records", { query, ...extra });
    check(r.ok === true, `search_records ${query} was refused: ${oneLine(r.error)}`);
    for (const hit of r.results) {
      check(Buffer.byteLength(hit.snippet ?? "", "utf8") <= 240, `search_records ${query}: a snippet is over 240 bytes`);
      for (const key of ["id", "kind", "status", "snippet"]) {
        check(hit[key] !== undefined && hit[key] !== null, `search_records ${query}: a hit has no ${key}`);
      }
      check("subject" in hit, `search_records ${query}: a hit has no subject`);
    }
    return r;
  };
  const hits = (r) =>
    r.results
      .map((h) => ({ kind: h.kind, id: String(h.id), status: h.status }))
      .sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const sorted = (rows) => [...rows].sort((a, b) => canonical(a).localeCompare(canonical(b)));

  // A claim written after the first search is found by the next.
  same("search_records zebrafish before any claim", hits(await search("zebrafish")), []);
  await addClaim("zz-first", "S-01/behaviour/zebrafish", "The zebrafish cache evicts its oldest entries.");
  {
    const r = await search("zebrafish");
    same("search_records zebrafish after the claim", hits(r), [{ kind: "claim", id: "zz-first", status: "current" }]);
    check(/zebrafish/i.test(r.results[0].snippet), "the zebrafish hit's snippet lacks the word");
    check(r.results[0].subject === "S-01", `the zebrafish hit's subject is ${r.results[0].subject}`);
  }
  // A low-sorting text key written after a higher one is found.
  await addClaim("0-low", "S-01/behaviour/quetzal", "The quetzal buffer is flushed on close.");
  same("search_records quetzal (a low-sorting claim id)", hits(await search("quetzal")), [
    { kind: "claim", id: "0-low", status: "current" },
  ]);

  // Vocabulary: an update adding a new word is found by it; a low-sorting term is found.
  const define = async (args) => {
    const r = await tryCall(ctx, "define_term", { ref_sha: head, first_seen: `src/http.ts:parseHTTPRequest@${head}`, ...args });
    check(r?.ok !== false, `define_term ${args.term} was refused: ${oneLine(r?.error)}`);
  };
  await define({ term: "Zymurgy", gloss: "The fermentation stage of the zymurgy pipeline." });
  same("search_records zymurgy", hits(await search("zymurgy")), [{ kind: "vocabulary", id: "Zymurgy", status: "current" }]);
  await define({ term: "Quokka", gloss: "The quokka scheduler that hands out work." });
  same("search_records wombat before the update", hits(await search("wombat")), []);
  await define({ term: "Quokka", gloss: "The quokka scheduler that hands out work.", expansion: "It hands each batch to the wombat pool." });
  same("search_records wombat after the update", hits(await search("wombat")), [{ kind: "vocabulary", id: "Quokka", status: "current" }]);
  await define({ term: "Aardwolf", gloss: "The aardwolf sweeper collects stale handles." });
  same("search_records aardwolf (a low-sorting term)", hits(await search("aardwolf")), [{ kind: "vocabulary", id: "Aardwolf", status: "current" }]);

  // A superseded claim: absent by default, present with include_history.
  await addClaim("pel-1", "S-01/behaviour/pelican", "The pelican queue is unbounded.");
  await search("pelican");
  {
    const ev = await evidence();
    const r = await tryCall(ctx, "supersede_claim", {
      predecessor_claim_id: "pel-1",
      successor_claim_id: "pel-2",
      statement: "The pelican queue is bounded at sixty-four entries.",
      epistemic_kind: "observation",
      at_sha: head,
      rationale: "The bound was read wrong.",
      evidence_ids: [ev],
    });
    check(r?.ok !== false, `supersede_claim was refused: ${oneLine(r?.error)}`);
  }
  same("search_records pelican by default", hits(await search("pelican")), [{ kind: "claim", id: "pel-2", status: "current" }]);
  same(
    "search_records pelican with include_history",
    hits(await search("pelican", { include_history: true })),
    sorted([
      { kind: "claim", id: "pel-1", status: "superseded" },
      { kind: "claim", id: "pel-2", status: "current" },
    ]),
  );

  // A claim inapplicable at HEAD: asserted on a commit HEAD does not reach.
  await addClaim("nar-1", "S-01/behaviour/narwhal", "The narwhal index is rebuilt nightly.", side);
  same("search_records narwhal by default", hits(await search("narwhal")), []);
  same("search_records narwhal with include_history", hits(await search("narwhal", { include_history: true })), [
    { kind: "claim", id: "nar-1", status: "inapplicable" },
  ]);

  // Narratives: a replaced one, and a withdrawn key.
  const narrate = async (topic, body) => {
    const r = await tryCall(ctx, "record_narrative", {
      subject_type: "subsystem",
      subject_id: "S-01",
      section: "structure",
      ...(topic ? { topic } : {}),
      body,
      evidence_ids: [await evidence()],
      ref_sha: head,
    });
    check(r?.ok !== false, `record_narrative was refused: ${oneLine(r?.error)}`);
    return Number(r.id ?? r.narrative_id);
  };
  const oldOcelot = await narrate("", "The ocelot layer parses requests first.");
  const newOcelot = await narrate("", "The ocelot layer validates requests before it parses them.");
  same("search_records ocelot by default", hits(await search("ocelot")), [
    { kind: "narrative", id: String(newOcelot), status: "recorded" },
  ]);
  same(
    "search_records ocelot with include_history",
    hits(await search("ocelot", { include_history: true })),
    sorted([
      { kind: "narrative", id: String(oldOcelot), status: "replaced" },
      { kind: "narrative", id: String(newOcelot), status: "recorded" },
    ]),
  );
  const capybara = await narrate("Write retries", "The capybara path retries each write once.");
  await search("capybara");
  store
    .prepare(
      `INSERT INTO narratives (subject_type, subject_id, section, topic, disposition, body, ref_sha, session_id)
       VALUES ('subsystem', 'S-01', 'structure', 'Write retries', 'withdrawn', 'Withdrawn by a reset.', ?, ?)`,
    )
    .run(head, ctx.sessionId);
  same("search_records capybara by default", hits(await search("capybara")), []);
  same("search_records capybara with include_history", hits(await search("capybara", { include_history: true })), [
    { kind: "narrative", id: String(capybara), status: "withdrawn" },
  ]);

  // Explanations: an effective one, one at a revision the workspace does not reach, and one
  // below its phase.
  {
    const r = await tryCall(ctx, "record_explanation", {
      subject_type: "subsystem",
      subject_id: "S-01",
      slot: "purpose",
      body: "It turns lemur request lines into parts.",
      evidence_ids: [await evidence()],
      ref_sha: head,
    });
    check(r?.ok !== false, `record_explanation was refused: ${oneLine(r?.error)}`);
    const lemur = Number(r.id ?? r.explanation_id);
    same("search_records lemur by default", hits(await search("lemur")), [
      { kind: "explanation", id: String(lemur), status: "recorded" },
    ]);
  }
  const rawExplanation = (subjectId, slot, body, refSha) =>
    Number(
      store
        .prepare(
          `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
           VALUES ('subsystem', ?, ?, 'recorded', ?, ?, ?)`,
        )
        .run(subjectId, slot, body, refSha, ctx.sessionId).lastInsertRowid,
    );
  const axolotl = rawExplanation("S-01", "account", "The axolotl account was written at a lost commit.", UNREACHABLE_SHA);
  const pangolin = rawExplanation("S-02", "purpose", "The pangolin purpose sits below its phase.", head);
  same("search_records axolotl by default", hits(await search("axolotl")), []);
  same("search_records axolotl with include_history", hits(await search("axolotl", { include_history: true })), [
    { kind: "explanation", id: String(axolotl), status: "unreachable" },
  ]);
  same("search_records pangolin by default", hits(await search("pangolin")), []);
  same("search_records pangolin with include_history", hits(await search("pangolin", { include_history: true })), [
    { kind: "explanation", id: String(pangolin), status: "not-eligible" },
  ]);

  // kinds and subject narrow the hits.
  same("search_records pelican in vocabulary only", hits(await search("pelican", { kinds: ["vocabulary"] })), []);
  same("search_records ocelot for S-02", hits(await search("ocelot", { subject: "S-02" })), []);
  same("search_records ocelot for S-01", hits(await search("ocelot", { subject: "S-01" })), [
    { kind: "narrative", id: String(newOcelot), status: "recorded" },
  ]);

  // -------------------------------------------------------------------------------------
  // The source list matches schema.sql.
  {
    const sources = mods.records.RECORD_SOURCES;
    check(Array.isArray(sources), "code-index/records.ts exports no RECORD_SOURCES");
    same(
      "RECORD_SOURCES",
      sources.map((s) => ({ kind: s.kind, table: s.table, key: s.key, sync: s.sync })),
      [
        { kind: "claim", table: "claims", key: "claim_id", sync: "rowid" },
        { kind: "narrative", table: "narratives", key: "id", sync: "rowid" },
        { kind: "explanation", table: "explanations", key: "id", sync: "rowid" },
        { kind: "finding", table: "findings", key: "finding_id", sync: "digest" },
        { kind: "field-note", table: "field_notes", key: "id", sync: "digest" },
        { kind: "open-question", table: "open_questions", key: "id", sync: "digest" },
        { kind: "vocabulary", table: "vocabulary", key: "term", sync: "digest" },
      ],
    );
    const REQUIRED_TEXT = {
      claim: ["statement"],
      narrative: ["body"],
      explanation: ["body"],
      finding: ["symptom", "root_cause"],
      "field-note": ["observation"],
      "open-question": ["question"],
      vocabulary: ["gloss", "expansion"],
    };
    const schema = readFileSync(join(here, "src", "schema.sql"), "utf8");
    for (const s of sources) {
      const table = new RegExp(`CREATE TABLE IF NOT EXISTS ${s.table} \\(([\\s\\S]*?)\\n\\);`).exec(schema);
      check(table, `schema.sql has no table ${s.table}`);
      const columns = new Set(
        table[1]
          .split("\n")
          .map((line) => /^\s{4}([a-z_]+)\s+[A-Z]/.exec(line)?.[1])
          .filter(Boolean),
      );
      for (const column of [s.key, ...s.columns]) {
        check(columns.has(column), `RECORD_SOURCES ${s.kind}: ${s.table}.${column} is not in schema.sql`);
      }
      for (const column of REQUIRED_TEXT[s.kind]) {
        check(s.columns.includes(column), `RECORD_SOURCES ${s.kind} does not index ${column}`);
      }
      // Append-only text: a BEFORE UPDATE trigger that aborts, unconditionally or on every
      // indexed column. Text updated in place has no such trigger.
      const triggers = [
        ...schema.matchAll(
          new RegExp(`BEFORE UPDATE ON ${s.table}\\b([\\s\\S]*?)END;`, "g"),
        ),
      ].map((m) => m[1]);
      const guards = (column) =>
        triggers.some(
          (body) =>
            /RAISE\(ABORT/.test(body) &&
            (!/\bWHEN\b/.test(body) || new RegExp(`OLD\\.${column}\\s*!=\\s*NEW\\.${column}`).test(body)),
        );
      const immutable = s.columns.every(guards);
      if (s.sync === "rowid") {
        check(immutable, `RECORD_SOURCES ${s.kind} is cursored by rowid, but schema.sql lets ${s.table}'s indexed text change`);
      } else {
        check(!immutable, `RECORD_SOURCES ${s.kind} is reconciled by digest, but ${s.table}'s text is append-only in schema.sql`);
      }
    }
  }

  // -------------------------------------------------------------------------------------
  // With the index off, both tools are refused, and the refusal is registered and stated.
  {
    process.env.AMANUENSIS_CODE_INDEX = "off";
    let found;
    let records;
    try {
      const off = await world("off");
      found = await tryCall(off.ctx, "find_symbol", { query: "Request" });
      records = await tryCall(off.ctx, "search_records", { query: "zebrafish" });
      check(!existsSync(join(off.ctx.project.storagePath, "code-index")), "with the index off a code-index directory was created");
    } finally {
      delete process.env.AMANUENSIS_CODE_INDEX;
    }
    const register = JSON.parse(readFileSync(join(here, "contracts", "refusal-parity.json"), "utf8"));
    const reference = readFileSync(join(here, "..", ".claude", "skills", "amanuensis", "references", "code-index.md"), "utf8");
    for (const [tool, response] of [["find_symbol", found], ["search_records", records]]) {
      check(response?.ok === false, `${tool} with the index off was not refused`);
      check(response.rule === "code-index.unavailable", `${tool} with the index off: rule ${response.rule}`);
      const entry = register.refusals.find((e) => e.id === "code-index-unavailable");
      check(entry, "contracts/refusal-parity.json has no code-index-unavailable");
      check(entry.refuses.includes(tool), `code-index-unavailable does not name ${tool} in refuses`);
      check(response.error.includes(entry.server.phrase), `${tool}'s refusal does not say "${entry.server.phrase}"`);
      check(reference.includes(`\`${tool}\``), `references/code-index.md does not name ${tool}`);
    }
    for (const phrase of ["match: \"name\"", "partial", "include_history"]) {
      check(reference.includes(phrase), `references/code-index.md does not state ${phrase}`);
    }
    const parity = spawnSync(process.execPath, [join(here, "scripts", "check-refusal-parity.mjs")], { encoding: "utf8" });
    check(parity.status === 0, `check-refusal-parity.mjs found drift: ${oneLine(parity.stderr || parity.stdout)}`);
  }
  check(git(ws, ["rev-parse", "HEAD"]) === second, "the workspace HEAD moved");
}

let code = 0;
try {
  await main();
  console.log("GATE SI6 GREEN");
} catch (e) {
  const reason = e instanceof GateFailure ? e.message : `the gate did not finish: ${e?.message ?? e}`;
  console.log(`GATE SI6 RED: ${oneLine(reason)}`);
  code = 1;
}
process.exit(code);
