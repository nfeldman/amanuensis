#!/usr/bin/env node
// GATE SI5 — outline_file and read_symbol (design/semantic-index/PLAN.md §4.3, §8 SI5).
//
// Turns red when:
//   - dist/tools/code-index.js is missing, or the server does not advertise outline_file and
//     read_symbol, or advertises them with the index switched off;
//   - outline_file does not return, row for row, the golden outline of each fixture file at the
//     revision asked for: symbol_ids, kinds, nested children, declaration and citeable lines,
//     signatures, first doc lines, occurrences of a repeated symbol_id, imports, bytes, lines,
//     blob_sha, status and the extractor generation; or any of it carries source text;
//   - read_symbol does not return exactly the citeable span's bytes (doc comment included,
//     non-ASCII text included) for a symbol_id, a qname and a bare name, or its source differs
//     from what git holds at that revision;
//   - evidence_args is not exactly { file_path, symbol: <symbol_id>, ref_sha: <resolved commit>,
//     line_range: <the full citeable span> }, carries a field add_evidence's schema lacks, carries
//     `kind`, or is refused by add_evidence once the agent adds kind;
//   - an ambiguous name (two symbols, or two occurrences of one symbol_id) returns source,
//     evidence_args or anything but its candidates with their lines; line_range does not select
//     one occurrence;
//   - a miss does not refuse with the nearest symbol_ids, in order, and no source;
//   - a definition of 500 lines does not return its first 400 lines, truncated: true, its nested
//     definitions' outline and no evidence_args; or a nested definition does not read whole with
//     evidence_args;
//   - context_lines changes the source or the evidence_args instead of adding lines beside it;
//   - a file in an unsupported language does not say `unsupported-language`, a missing path,
//     an unresolvable revision or a traversing path is not refused, or a refusal's rule id and
//     sentence are not the register's and the skill reference's;
//   - ref_sha does not select the older body (and no `subtract`), or the default is not HEAD;
//   - a read writes to the workspace, or creates no sidecar under the storage directory.
//
// Hermetic: the fixture repository and the storage are built in a temporary directory; the
// server runs from dist/. No network.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), "amanuensis-si5-"));

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
function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) fail(`git ${args.join(" ")} failed: ${String(r.stderr).split("\n")[0]}`);
  return r.stdout;
}
/** The text of lines `from`..`to` (1-based, inclusive) of `path` at `rev`, as git holds it. */
function gitLines(workspace, rev, path, from, to) {
  const text = git(workspace, ["show", `${rev}:${path}`]);
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines.slice(from - 1, to).join("\n");
}
/**
 * The citeable span over lines `from`..`to`: the same lines with the first one's indentation
 * dropped, because the span starts at its first token (or at the comment before it) and not at
 * the start of the line.
 */
function spanLines(workspace, rev, path, from, to) {
  return gitLines(workspace, rev, path, from, to).replace(/^[ \t]+/, "");
}
function gitLineCount(workspace, rev, path) {
  const text = git(workspace, ["show", `${rev}:${path}`]);
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines.length;
}
function hasKey(value, key) {
  if (Array.isArray(value)) return value.some((v) => hasKey(v, key));
  if (value && typeof value === "object") {
    return Object.keys(value).some((k) => k === key || hasKey(value[k], key));
  }
  return false;
}
const SIGNATURES = /Cannot find module|MODULE_NOT_FOUND|ModuleNotFoundError|SyntaxError|No such file or directory|ENOENT|ImportError|ReferenceError|is not defined|command not found/g;
function oneLine(text) {
  return String(text).replace(SIGNATURES, "[error]").split("\n")[0].slice(0, 400);
}

// ---------------------------------------------------------------------------------------
// The MCP server.

function startServer(workspace, storageRoot, extraEnv = {}) {
  const env = { ...process.env, AMANUENSIS_STORAGE_ROOT: storageRoot, AMANUENSIS_CALL_LOG: "off", ...extraEnv };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.AMANUENSIS_WORKSPACE;
  const child = spawn(process.execPath, [join(here, "dist", "index.js"), "--workspace", workspace, "--allow-workspace-pin"], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  child.stderr.on("data", (c) => {
    stderr += c.toString("utf8");
  });
  child.stdout.on("data", (c) => {
    buffer += c.toString("utf8");
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        const msg = JSON.parse(line);
        const waiter = pending.get(msg.id);
        if (waiter) {
          pending.delete(msg.id);
          if (msg.error) waiter.reject(new GateFailure(`server error ${JSON.stringify(msg.error)}`));
          else waiter.resolve(msg.result);
        }
      }
      nl = buffer.indexOf("\n");
    }
  });
  const request = (method, params = {}) => {
    const id = nextId++;
    const p = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new GateFailure(`server timed out on ${method}; stderr=${oneLine(stderr)}`));
      }, 60_000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return p;
  };
  const init = async () => {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "amanuensis-si5-gate", version: "1" },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  };
  const call = async (name, args) => {
    const result = await request("tools/call", { name, arguments: args });
    return JSON.parse(result.content[0].text);
  };
  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      child.stdin.end();
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    });
  return { init, request, call, stop };
}

// ---------------------------------------------------------------------------------------
// Golden tables: what the fixture's outlines must say, written out by hand from the source
// in fixtures/code-index-repo.mjs.

const item = (symbol_id, kind, start_line, end_line, signature, extra = {}) => ({
  symbol_id,
  kind,
  start_line,
  end_line,
  signature,
  ...extra,
});

function shapesOutline(revision) {
  const rows = [
    item("add", "function", 5, 7, "export function add(a: number, b: number): number {", {
      doc_start_line: 4,
      doc: "Adds two numbers.",
    }),
    item("Label", "class", 12, 19, "export class Label {", {
      doc_start_line: 9,
      doc: "A label widget.",
      children: [
        item("Label.name", "field", 13, 13, 'name = "label";'),
        item("Label.render", "method", 16, 18, "render(): string {", {
          doc_start_line: 15,
          doc: "Renders the label.",
        }),
      ],
    }),
    item("Button", "class", 21, 25, "export class Button {", {
      children: [item("Button.render", "method", 22, 24, "render(): string {")],
    }),
    item("limit", "variable", 27, 27, "export const limit = 10;"),
  ];
  if (revision === 2) {
    rows.push(
      item("subtract", "function", 30, 32, "export function subtract(a: number, b: number): number {", {
        doc_start_line: 29,
        doc: "Subtracts the second number from the first.",
      }),
    );
  }
  return rows;
}
const SHAPES_IMPORTS = [
  { specifier: "node:fs", line: 1 },
  { specifier: "node:fs", line: 2 },
];
const BIG_OUTLINE = [
  item("bigFunction", "function", 2, 500, "export function bigFunction(seed: number): number {", {
    doc_start_line: 1,
    doc: "A function far longer than a reader should be handed whole.",
    children: [
      item("bigFunction.inner", "function", 4, 6, "function inner(x: number): number {"),
      item("bigFunction.late", "function", 450, 452, "function late(x: number): number {"),
    ],
  }),
];
const UNICODE_OUTLINE = [
  item("名前", "variable", 2, 2, 'export const 名前 = "東京";', {
    doc_start_line: 1,
    doc: "Ünïcödé fixture: offsets are UTF-8 bytes, not UTF-16 code units.",
  }),
  item("grüße", "function", 5, 7, "export function grüße(wer: string): string {", {
    doc_start_line: 4,
    doc: "Grüße — returns a greeting with an emoji 😀.",
  }),
  item("after", "variable", 9, 9, 'export const after = "ß";'),
];
const DUP_OUTLINE = [
  item("sep", "function", 6, 7, "def sep():", { occurrence: 1 }),
  item("sep", "function", 9, 10, "def sep():", { occurrence: 2 }),
];
const DUP_IMPORTS = [
  { specifier: "os", line: 2 },
  { specifier: "sys", line: 3 },
];

// ---------------------------------------------------------------------------------------

async function main() {
  const toolPath = join(here, "dist", "tools", "code-index.js");
  check(existsSync(toolPath), "dist/tools/code-index.js is missing (src/tools/code-index.ts is not built)");
  try {
    await import(pathToFileURL(toolPath).href);
  } catch (e) {
    fail(`dist/tools/code-index.js did not load: ${oneLine(e?.message ?? e)}`);
  }
  const { buildCodeIndexRepo, bigSource } = await import(
    pathToFileURL(join(here, "fixtures", "code-index-repo.mjs")).href
  );

  const { workspace, first, second } = buildCodeIndexRepo(join(root, "workspace"));
  const storageRoot = join(root, "storage");
  mkdirSync(storageRoot, { recursive: true });
  const server = startServer(workspace, storageRoot);
  try {
    await server.init();
    const info = await server.call("get_project_info", { workspace });
    check(info.storage_path, "get_project_info reported no storage_path");
    const tools = new Map((await server.request("tools/list")).tools.map((t) => [t.name, t]));
    for (const name of ["outline_file", "read_symbol"]) {
      check(tools.has(name), `the server does not advertise ${name}`);
    }
    const evidenceProperties = Object.keys(tools.get("add_evidence").inputSchema.properties);
    const readSchema = tools.get("read_symbol").inputSchema;
    check(
      readSchema.required.includes("path") && readSchema.required.includes("symbol"),
      "read_symbol's schema does not require path and symbol",
    );

    const outline = (path, extra = {}) => server.call("outline_file", { path, ...extra });
    const read = (path, symbol, extra = {}) => server.call("read_symbol", { path, symbol, ...extra });

    // -------------------------------------------------------------------------------------
    // outline_file

    const refusals = []; // { tool, response }, checked against the register at the end

    for (const [label, rev, revision, path, golden, imports] of [
      ["shapes at the second revision", undefined, 2, "src/shapes.ts", shapesOutline(2), SHAPES_IMPORTS],
      ["shapes at the first revision", first, 1, "src/shapes.ts", shapesOutline(1), SHAPES_IMPORTS],
      ["big", undefined, 2, "src/big.ts", BIG_OUTLINE, []],
      ["unicode", undefined, 2, "src/unicode.ts", UNICODE_OUTLINE, []],
      ["duplicate python definitions", undefined, 2, "lib/dup.py", DUP_OUTLINE, DUP_IMPORTS],
    ]) {
      const commit = revision === 1 ? first : second;
      const out = await outline(path, rev ? { ref_sha: rev } : {});
      check(out.ok === true, `outline_file ${label} was refused: ${oneLine(out.error)}`);
      same(`outline_file ${label}: definitions`, out.symbols, golden);
      same(`outline_file ${label}: imports`, out.imports, imports);
      check(out.path === path, `outline_file ${label}: path is ${out.path}`);
      check(out.ref_sha === commit, `outline_file ${label}: ref_sha is ${out.ref_sha}, not the resolved ${commit}`);
      check(out.blob_sha === git(workspace, ["rev-parse", `${commit}:${path}`]).trim(), `outline_file ${label}: blob_sha is not git's`);
      check(out.status === "ok", `outline_file ${label}: status is ${out.status}`);
      check(out.lines === gitLineCount(workspace, commit, path), `outline_file ${label}: lines is ${out.lines}`);
      check(
        out.bytes === Buffer.byteLength(git(workspace, ["show", `${commit}:${path}`])),
        `outline_file ${label}: bytes is ${out.bytes}, not the blob's UTF-8 length`,
      );
      check(out.lang === (path.endsWith(".py") ? "python" : "typescript"), `outline_file ${label}: lang is ${out.lang}`);
      check(/^[0-9a-f]{64}$/.test(out.extractor_id ?? ""), `outline_file ${label}: extractor_id is ${out.extractor_id}`);
      for (const key of ["source", "body", "text", "lines_of_source"]) {
        check(!hasKey(out.symbols, key), `outline_file ${label} carries a ${key} field: it returns no source`);
      }
    }
    // The default revision is HEAD: `add`'s older body appears only at the first revision.
    const bodyDefault = await outline("src/shapes.ts");
    check(JSON.stringify(bodyDefault).includes("subtract"), "outline_file without ref_sha is not at HEAD");
    const bodyFirst = await outline("src/shapes.ts", { ref_sha: first });
    check(!JSON.stringify(bodyFirst).includes("subtract"), "outline_file at the first revision lists subtract");
    const viaName = await outline("src/shapes.ts", { ref_sha: "HEAD~1" });
    check(viaName.ref_sha === first, "outline_file does not resolve HEAD~1 to the first commit");
    check(!JSON.stringify(await outline("src/shapes.ts")).includes("return b + a"), "outline_file returned a function body");

    // -------------------------------------------------------------------------------------
    // read_symbol: the citeable span's exact bytes

    const ADD_SECOND = '/** Adds two numbers. */\nexport function add(a: number, b: number): number {\n  return b + a;\n}';
    const ADD_FIRST = ADD_SECOND.replace("b + a", "a + b");
    for (const [label, args, want, commit, lines] of [
      ["a bare name", { path: "src/shapes.ts", symbol: "add" }, ADD_SECOND, second, "4-7"],
      ["the first revision", { path: "src/shapes.ts", symbol: "add", ref_sha: first }, ADD_FIRST, first, "4-7"],
      ["HEAD~1", { path: "src/shapes.ts", symbol: "add", ref_sha: "HEAD~1" }, ADD_FIRST, first, "4-7"],
    ]) {
      const r = await read(args.path, args.symbol, args.ref_sha ? { ref_sha: args.ref_sha } : {});
      check(r.ok === true, `read_symbol ${label} was refused: ${oneLine(r.error)}`);
      check(r.source === want, `read_symbol ${label}: source is ${JSON.stringify(r.source)}, not the citeable span`);
      check(r.source === gitLines(workspace, commit, "src/shapes.ts", 4, 7), `read_symbol ${label}: source is not what git holds at lines 4-7`);
      check(r.start_line === 4 && r.end_line === 7, `read_symbol ${label}: lines are ${r.start_line}-${r.end_line}`);
      check(r.symbol_id === "add" && r.kind === "function", `read_symbol ${label}: symbol_id ${r.symbol_id} kind ${r.kind}`);
      check(r.span_sha256 === sha256(want), `read_symbol ${label}: span_sha256 is not the sha256 of the source`);
      check(r.truncated === undefined || r.truncated === false, `read_symbol ${label}: truncated`);
      same(`read_symbol ${label}: evidence_args`, r.evidence_args, {
        file_path: "src/shapes.ts",
        symbol: "add",
        ref_sha: commit,
        line_range: lines,
      });
    }
    // symbol_id, qname and bare name reach one definition; a nested one is qualified.
    for (const symbol of ["Label.render"]) {
      const r = await read("src/shapes.ts", symbol);
      check(r.ok === true, `read_symbol ${symbol} was refused: ${oneLine(r.error)}`);
      check(
        r.source === spanLines(workspace, second, "src/shapes.ts", 15, 18) && r.start_line === 15 && r.end_line === 18,
        `read_symbol ${symbol}: not lines 15-18 with the doc comment`,
      );
      check(r.evidence_args.symbol === "Label.render" && r.evidence_args.line_range === "15-18", `read_symbol ${symbol}: evidence_args ${canonical(r.evidence_args)}`);
    }
    {
      const r = await read("src/shapes.ts", "limit");
      check(r.ok === true && r.source === "export const limit = 10;" && r.evidence_args.line_range === "27", `read_symbol limit: ${canonical(r)}`);
    }
    // A class with no doc comment, nested members not included in its name match.
    {
      const r = await read("src/shapes.ts", "Button");
      check(r.ok === true && r.source === gitLines(workspace, second, "src/shapes.ts", 21, 25), "read_symbol Button is not lines 21-25");
    }
    // Non-ASCII: offsets are UTF-8 bytes; the span is the exact definition.
    {
      const r = await read("src/unicode.ts", "grüße");
      check(r.ok === true, `read_symbol grüße was refused: ${oneLine(r.error)}`);
      check(r.source === gitLines(workspace, second, "src/unicode.ts", 4, 7), `read_symbol grüße: source is ${JSON.stringify(r.source)}`);
      check(r.source.startsWith("/** Grüße") && r.source.endsWith("}"), "read_symbol grüße: the span does not run from its comment to its brace");
      const first1 = await read("src/unicode.ts", "名前");
      check(first1.source === gitLines(workspace, second, "src/unicode.ts", 1, 2), "read_symbol 名前: the leading comment is not in the span");
      const last = await read("src/unicode.ts", "after");
      check(last.source === 'export const after = "ß";', `read_symbol after: ${JSON.stringify(last.source)}`);
    }

    // evidence_args is a subset of add_evidence's schema, has no kind, and add_evidence takes it
    // with a kind the agent chooses.
    {
      const r = await read("src/shapes.ts", "add", { ref_sha: first });
      for (const field of Object.keys(r.evidence_args)) {
        check(evidenceProperties.includes(field), `evidence_args carries ${field}, which add_evidence's schema lacks`);
      }
      check(!("kind" in r.evidence_args), "evidence_args carries kind, which only the agent can choose");
      check(!("excerpt" in r.evidence_args) && !("note" in r.evidence_args), "evidence_args carries excerpt or note");
      const session = await server.call("start_session", { intent: "si5-gate" });
      check(session.ok === true, `start_session was refused: ${oneLine(session.error)}`);
      const added = await server.call("add_evidence", { ...r.evidence_args, kind: "code-verified" });
      check(added.ok === true, `add_evidence refused evidence_args plus kind: ${oneLine(added.error)}`);
    }

    // context_lines adds lines beside the span and changes neither it nor the citation.
    {
      const r = await read("src/shapes.ts", "add", { context_lines: 2 });
      check(r.source === ADD_SECOND, "context_lines changed the source");
      same("context_lines: evidence_args", r.evidence_args, {
        file_path: "src/shapes.ts",
        symbol: "add",
        ref_sha: second,
        line_range: "4-7",
      });
      same("context_lines: lines before", r.context_before, {
        start_line: 2,
        text: gitLines(workspace, second, "src/shapes.ts", 2, 3),
      });
      same("context_lines: lines after", r.context_after, {
        start_line: 8,
        text: gitLines(workspace, second, "src/shapes.ts", 8, 9),
      });
      const plain = await read("src/shapes.ts", "add");
      check(!("context_before" in plain) && !("context_after" in plain), "read_symbol without context_lines returned context");
      const bad = await read("src/shapes.ts", "add", { context_lines: -1 });
      check(bad.ok === false, "read_symbol accepted context_lines -1");
      const tooMany = await read("src/shapes.ts", "add", { context_lines: 1000 });
      check(tooMany.ok === false, "read_symbol accepted context_lines 1000");
    }

    // -------------------------------------------------------------------------------------
    // Ambiguity: candidates with lines, no source, no evidence_args.

    {
      const r = await read("src/shapes.ts", "render");
      check(r.ok === true && r.ambiguous === true, `read_symbol render is not reported ambiguous: ${canonical(r).slice(0, 300)}`);
      check(!("source" in r) && !("evidence_args" in r), "an ambiguous read_symbol returned source or evidence_args");
      same("candidates for render", r.candidates, [
        item("Label.render", "method", 16, 18, "render(): string {", { doc_start_line: 15, doc: "Renders the label." }),
        item("Button.render", "method", 22, 24, "render(): string {"),
      ]);
    }
    {
      const r = await read("lib/dup.py", "sep");
      check(r.ok === true && r.ambiguous === true, "two occurrences of one symbol_id are not reported ambiguous");
      check(!("source" in r) && !("evidence_args" in r), "an ambiguous occurrence read returned source or evidence_args");
      same("candidates for sep", r.candidates, DUP_OUTLINE);
      const picked = await read("lib/dup.py", "sep", { line_range: "9-10" });
      check(picked.ok === true && !picked.ambiguous, `line_range 9-10 did not select an occurrence: ${canonical(picked).slice(0, 300)}`);
      check(picked.source === spanLines(workspace, second, "lib/dup.py", 9, 10), `line_range 9-10 read ${JSON.stringify(picked.source)}`);
      check(picked.occurrence === 2, `the second occurrence is labelled ${picked.occurrence}`);
      same("the occurrence's evidence_args", picked.evidence_args, {
        file_path: "lib/dup.py",
        symbol: "sep",
        ref_sha: second,
        line_range: "9-10",
      });
      const none = await read("lib/dup.py", "sep", { line_range: "7-8" });
      check(none.ok === false, "a line_range that starts no occurrence did not refuse");
      refusals.push({ tool: "read_symbol", response: none });
    }

    // -------------------------------------------------------------------------------------
    // A miss lists the nearest symbol_ids.

    {
      const r = await read("src/shapes.ts", "rendr");
      check(r.ok === false, "read_symbol rendr did not refuse");
      check(!("source" in r) && !("evidence_args" in r), "a missed read_symbol returned source or evidence_args");
      check(Array.isArray(r.nearest) && r.nearest.length >= 2 && r.nearest.length <= 5, `nearest is ${canonical(r.nearest)}`);
      same("nearest to rendr", r.nearest.slice(0, 2), ["Button.render", "Label.render"]);
      check(r.nearest.every((id) => r.error.includes(id)), "the miss's sentence does not name its nearest symbol_ids");
      refusals.push({ tool: "read_symbol", response: r });
      const q = await read("src/shapes.ts", "Lable.render");
      same("nearest to Lable.render", q.nearest.slice(0, 1), ["Label.render"]);
      const old = await read("src/shapes.ts", "subtract", { ref_sha: first });
      check(old.ok === false && old.nearest.length > 0, "subtract at the first revision was not a miss with nearest ids");
      const there = await read("src/shapes.ts", "subtract");
      check(there.ok === true && there.source.includes("a - b"), "subtract at HEAD was not read");
      const empty = await read("src/shapes.ts", "");
      check(empty.ok === false, "read_symbol accepted an empty symbol");
    }

    // -------------------------------------------------------------------------------------
    // A definition over 400 lines.

    {
      const r = await read("src/big.ts", "bigFunction");
      check(r.ok === true, `read_symbol bigFunction was refused: ${oneLine(r.error)}`);
      check(r.truncated === true, "a 500-line definition is not marked truncated");
      check(!("evidence_args" in r), "a truncated read_symbol returned evidence_args");
      const shown = r.source.split("\n");
      check(shown.length === 400, `a 500-line definition returned ${shown.length} lines, not 400`);
      check(r.source === gitLines(workspace, second, "src/big.ts", 1, 400), "the truncated source is not lines 1-400");
      check(r.start_line === 1 && r.end_line === 400, `the truncated read says lines ${r.start_line}-${r.end_line}`);
      check(r.definition_end_line === 500, `definition_end_line is ${r.definition_end_line}, not 500`);
      same("the truncated read's nested outline", r.nested, BIG_OUTLINE[0].children);
      check(r.source === bigSource().split("\n").slice(0, 400).join("\n"), "the truncated source differs from the fixture's first 400 lines");
      const inner = await read("src/big.ts", "bigFunction.inner");
      check(inner.ok === true && !inner.truncated, "a nested definition did not read whole");
      same("the nested definition's evidence_args", inner.evidence_args, {
        file_path: "src/big.ts",
        symbol: "bigFunction.inner",
        ref_sha: second,
        line_range: "4-6",
      });
      const late = await read("src/big.ts", "bigFunction.late");
      check(late.source === spanLines(workspace, second, "src/big.ts", 450, 452), "a nested definition past line 400 was not read");
    }

    // -------------------------------------------------------------------------------------
    // Refusals.

    for (const tool of ["outline_file", "read_symbol"]) {
      const call = (path, extra = {}) => (tool === "outline_file" ? outline(path, extra) : read(path, "x", extra));
      const unsupported = await call("docs/notes.txt");
      check(unsupported.ok === false, `${tool} did not refuse an unsupported file`);
      check(String(unsupported.error).includes("unsupported-language"), `${tool} does not say unsupported-language: ${oneLine(unsupported.error)}`);
      check(unsupported.rule === "code-index.unsupported-language", `${tool}'s rule for an unsupported file is ${unsupported.rule}`);
      refusals.push({ tool, response: unsupported });
      const missing = await call("src/nothing.ts");
      check(missing.ok === false && missing.rule === "code-index.path-not-found", `${tool} on a missing path: ${canonical(missing).slice(0, 200)}`);
      refusals.push({ tool, response: missing });
      const outside = await call("../shapes.ts");
      check(outside.ok === false, `${tool} accepted a traversing path`);
      const unknown = await call("src/shapes.ts", { ref_sha: "0123456789abcdef0123456789abcdef01234567" });
      check(unknown.ok === false, `${tool} accepted a revision the workspace lacks`);
      const early = await call("src/shapes.ts", { ref_sha: "HEAD~5" });
      check(early.ok === false, `${tool} accepted HEAD~5 in a two-commit repository`);
    }

    // Refusal parity: each refusal's rule id and sentence are the register's, and the skill
    // reference carries the sentence.
    const register = JSON.parse(readFileSync(join(here, "contracts", "refusal-parity.json"), "utf8"));
    for (const { tool, response } of refusals) {
      const id = String(response.rule).replace(/^code-index\./, "code-index-");
      const entry = register.refusals.find((e) => e.id === id);
      check(entry, `refusal rule ${response.rule} has no entry ${id} in contracts/refusal-parity.json`);
      check(entry.refuses.includes(tool), `register entry ${id} does not list ${tool} under refuses`);
      check(
        response.error.replace(/\s+/g, " ").includes(entry.server.phrase),
        `${tool}'s ${response.rule} sentence lacks the register's phrase "${entry.server.phrase}"`,
      );
      check(entry.server.file === "src/tools/code-index.ts", `register entry ${id} names ${entry.server.file}`);
      const reference = readFileSync(join(here, "..", ".claude", "skills", "amanuensis", "references", "code-index.md"), "utf8");
      check(
        reference.replace(/\s+/g, " ").includes(entry.server.phrase),
        `references/code-index.md does not state "${entry.server.phrase}"`,
      );
    }
    const parity = spawnSync(process.execPath, [join(here, "scripts", "check-refusal-parity.mjs")], { encoding: "utf8" });
    check(parity.status === 0, `check-refusal-parity.mjs found drift: ${oneLine(parity.stderr || parity.stdout)}`);

    // -------------------------------------------------------------------------------------
    // Side effects: the workspace is untouched and the sidecar is under the storage directory.

    check(git(workspace, ["status", "--porcelain", "--untracked-files=all"]).trim() === "", "a read changed the workspace");
    const sidecar = join(info.storage_path, "code-index");
    check(existsSync(sidecar) && readdirSync(sidecar).some((n) => !n.startsWith(".")), "no sidecar generation exists under storage/code-index");
    check(!existsSync(join(workspace, "code-index")), "a code-index directory was created in the workspace");
  } finally {
    await server.stop();
  }

  // The off switch registers neither tool.
  const off = startServer(workspace, join(root, "storage-off"), { AMANUENSIS_CODE_INDEX: "off" });
  try {
    await off.init();
    const listed = (await off.request("tools/list")).tools.map((t) => t.name);
    check(!listed.includes("outline_file") && !listed.includes("read_symbol"), "with the index off the server registers outline_file or read_symbol");
  } finally {
    await off.stop();
  }
}

try {
  await main();
  console.log("GATE SI5 GREEN");
  process.exit(0);
} catch (e) {
  console.log(`GATE SI5 RED: ${oneLine(e?.message ?? e)}`);
  process.exit(1);
}
