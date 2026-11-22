#!/usr/bin/env node
// GATE SI2 — the extractor and the first six languages (design/semantic-index/PLAN.md §4.2,
// §8 SI2).
//
// Turns red when:
//   - dist/code-index/extract.js is missing or does not export extract, extractorId and
//     languageForPath;
//   - the golden tables do not match row for row for TypeScript, TSX, JavaScript, Python, Go
//     and Java (kind, name, qname, symbol_id, start_line, end_line, doc_start_line,
//     occurrence), or the tables fail to cover every row of §4.2's table for those languages;
//   - a definition comes from a grammar's tags.scm rather than the index's own queries, or the
//     queries are not read from queries/ under the package root, or a missing query file is
//     not refused, or a grammar whose bytes differ from the manifest is loaded;
//   - span_sha256 is not the sha256 of the citeable span's UTF-8 bytes, or start_byte and
//     end_byte do not bound the citeable span from doc_start_line to end_line;
//   - a body edit or a leading-comment edit does not change span_sha256, or changes the
//     span_sha256 of a definition it did not touch;
//   - Go methods on different receivers or Java overloads do not get distinct symbol_ids, or
//     an id changes when other definitions are reordered, inserted or deleted;
//   - duplicate Python definitions do not share a symbol_id as occurrences 1 and 2;
//   - a non-ASCII fixture's byte offsets do not slice the exact definition;
//   - lines in a CRLF file are not counted as requireEvidenceCitation counts them, or a
//     definition's citeable span is refused by requireEvidenceCitation;
//   - output differs across two runs or between two processes;
//   - a syntax error loses an intact definition, changes one's span, keeps the broken one,
//     or is not reported as parse-partial;
//   - references, imports, signature or doc differ from their golden values, or signature
//     and doc exceed 200 and 2,000 bytes or split a UTF-8 character;
//   - an unsupported language returns anything but unsupported-language.
//
// Hermetic: fixture sources are committed under fixtures/code-index/; git repositories and
// package-root copies are built in a temporary directory. No network.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "code-index");

class GateFailure extends Error {}
function fail(message) {
  throw new GateFailure(message);
}
function check(condition, message) {
  if (!condition) fail(message);
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function fixture(name) {
  const path = join(fixtures, name);
  if (!existsSync(path)) fail(`fixtures/code-index/${name} is missing`);
  return readFileSync(path, "utf8");
}
// Lines as requireEvidenceCitation counts them: split on \n, a final \n ends the last line.
function countLines(text) {
  if (text === "") return 0;
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines.length;
}
function lineOfByte(buffer, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (buffer[i] === 0x0a) line++;
  return line;
}

// ---------------------------------------------------------------------------------------
// Golden tables: [kind, name, qname, symbol_id, start_line, end_line, doc_start_line,
// occurrence], in file order. Written from the fixtures by hand, not from extractor output.

const GOLDEN = {
  "rows.ts": {
    lang: "typescript",
    rows: [
      ["function", "add", "add", "add", 6, 8, 5, 1],
      ["function", "counter", "counter", "counter", 10, 12, 10, 1],
      ["interface", "Widget", "Widget", "Widget", 15, 18, 14, 1],
      ["type", "WidgetName", "WidgetName", "WidgetName", 20, 20, 20, 1],
      ["enum", "Color", "Color", "Color", 22, 25, 22, 1],
      ["class", "Label", "Label", "Label", 31, 55, 27, 1],
      ["field", "name", "Label.name", "Label.name", 32, 32, 32, 1],
      ["field", "count", "Label.count", "Label.count", 33, 33, 33, 1],
      ["field", "#secret", "Label.#secret", "Label.#secret", 34, 34, 34, 1],
      ["constructor", "constructor", "Label.constructor", "Label.constructor", 36, 38, 36, 1],
      ["getter", "text", "Label.text", "Label.text", 41, 43, 40, 1],
      ["setter", "text", "Label.text", "Label.text", 45, 47, 45, 2],
      ["method", "render", "Label.render", "Label.render", 49, 54, 49, 1],
      ["function", "pad", "Label.render.pad", "Label.render.pad", 50, 52, 50, 1],
      ["namespace", "Shapes", "Shapes", "Shapes", 57, 62, 57, 1],
      ["variable", "sides", "Shapes.sides", "Shapes.sides", 58, 58, 58, 1],
      ["function", "area", "Shapes.area", "Shapes.area", 59, 61, 59, 1],
      ["variable", "double", "double", "double", 64, 64, 64, 1],
      ["variable", "settings", "settings", "settings", 66, 66, 66, 1],
      ["variable", "legacy", "legacy", "legacy", 68, 68, 68, 1],
      ["variable", "alsoLegacy", "alsoLegacy", "alsoLegacy", 68, 68, 68, 1],
      ["default", "default", "default", "default", 72, 74, 72, 1],
    ],
    imports: [
      ["node:fs", 2],
      ["node:fs", 3],
    ],
  },
  "rows.tsx": {
    lang: "tsx",
    rows: [
      ["interface", "ButtonProps", "ButtonProps", "ButtonProps", 4, 6, 4, 1],
      ["type", "Size", "Size", "Size", 8, 8, 8, 1],
      ["enum", "Tone", "Tone", "Tone", 10, 12, 10, 1],
      ["function", "Button", "Button", "Button", 15, 17, 14, 1],
      ["function", "frames", "frames", "frames", 19, 21, 19, 1],
      ["class", "Panel", "Panel", "Panel", 23, 41, 23, 1],
      ["field", "state", "Panel.state", "Panel.state", 24, 24, 24, 1],
      ["constructor", "constructor", "Panel.constructor", "Panel.constructor", 26, 28, 26, 1],
      ["getter", "open", "Panel.open", "Panel.open", 30, 32, 30, 1],
      ["setter", "open", "Panel.open", "Panel.open", 34, 36, 34, 2],
      ["method", "render", "Panel.render", "Panel.render", 38, 40, 38, 1],
      ["namespace", "Layout", "Layout", "Layout", 43, 45, 43, 1],
      ["variable", "gap", "Layout.gap", "Layout.gap", 44, 44, 44, 1],
      ["variable", "Icon", "Icon", "Icon", 47, 47, 47, 1],
      ["variable", "theme", "theme", "theme", 49, 49, 49, 1],
      ["default", "default", "default", "default", 51, 51, 51, 1],
    ],
    imports: [["react", 2]],
  },
  "rows.js": {
    lang: "javascript",
    rows: [
      ["variable", "fs", "fs", "fs", 3, 3, 3, 1],
      ["function", "joinAll", "joinAll", "joinAll", 6, 8, 5, 1],
      ["function", "walk", "walk", "walk", 10, 12, 10, 1],
      ["class", "Store", "Store", "Store", 14, 34, 14, 1],
      ["field", "items", "Store.items", "Store.items", 15, 15, 15, 1],
      ["field", "#instances", "Store.#instances", "Store.#instances", 16, 16, 16, 1],
      ["constructor", "constructor", "Store.constructor", "Store.constructor", 18, 20, 18, 1],
      ["getter", "size", "Store.size", "Store.size", 22, 24, 22, 1],
      ["setter", "size", "Store.size", "Store.size", 26, 28, 26, 2],
      ["method", "add", "Store.add", "Store.add", 31, 33, 30, 1],
      ["variable", "handler", "handler", "handler", 36, 38, 36, 1],
      ["variable", "options", "options", "options", 40, 40, 40, 1],
      ["variable", "counter", "counter", "counter", 42, 42, 42, 1],
      ["default", "default", "default", "default", 44, 47, 44, 1],
    ],
    imports: [
      ["node:path", 2],
      ["node:fs", 3],
    ],
  },
  "rows.py": {
    lang: "python",
    rows: [
      ["variable", "LIMIT", "LIMIT", "LIMIT", 5, 5, 5, 1],
      ["variable", "ratio", "ratio", "ratio", 6, 6, 6, 1],
      ["function", "greet", "greet", "greet", 11, 15, 10, 1],
      ["function", "shout", "greet.shout", "greet.shout", 13, 14, 13, 1],
      ["function", "fetch", "fetch", "fetch", 18, 19, 18, 1],
      ["class", "Point", "Point", "Point", 23, 36, 22, 1],
      ["method", "norm", "Point.norm", "Point.norm", 28, 29, 28, 1],
      ["method", "double", "Point.double", "Point.double", 32, 33, 31, 1],
      ["method", "refresh", "Point.refresh", "Point.refresh", 35, 36, 35, 1],
      ["function", "sep", "sep", "sep", 40, 41, 40, 1],
      ["function", "sep", "sep", "sep", 43, 44, 43, 2],
    ],
    imports: [
      ["os", 2],
      [".util", 3],
    ],
  },
  "rows.go": {
    lang: "go",
    rows: [
      ["const", "Pi", "Pi", "Pi", 10, 10, 9, 1],
      ["const", "Small", "Small", "Small", 13, 13, 13, 1],
      ["const", "Large", "Large", "Large", 13, 13, 13, 1],
      ["var", "registry", "registry", "registry", 16, 16, 16, 1],
      ["type", "Shape", "Shape", "Shape", 19, 21, 18, 1],
      ["type", "Square", "Square", "Square", 25, 25, 24, 1],
      ["type", "Meters", "Meters", "Meters", 26, 26, 26, 1],
      ["type", "List", "List", "List", 29, 29, 29, 1],
      ["function", "NewSquare", "NewSquare", "NewSquare", 32, 34, 31, 1],
      ["method", "Area", "Square.Area", "Square.Area", 37, 39, 36, 1],
      ["method", "String", "Square.String", "Square.String", 41, 43, 41, 1],
      ["method", "Push", "List.Push", "List.Push", 45, 47, 45, 1],
      ["method", "Area", "Circle.Area", "Circle.Area", 49, 51, 49, 1],
      ["type", "Circle", "Circle", "Circle", 53, 53, 53, 1],
    ],
    imports: [
      ["fmt", 5],
      ["math", 6],
    ],
  },
  "Parser.java": {
    lang: "java",
    rows: [
      ["class", "Parser", "Parser", "Parser", 7, 54, 6, 1],
      ["field", "depth", "Parser.depth", "Parser.depth", 9, 9, 9, 1],
      ["field", "width", "Parser.width", "Parser.width", 9, 9, 9, 1],
      ["field", "NAME", "Parser.NAME", "Parser.NAME", 10, 10, 10, 1],
      ["constructor", "Parser", "Parser.Parser", "Parser.Parser()", 12, 12, 12, 1],
      ["constructor", "Parser", "Parser.Parser", "Parser.Parser(String)", 14, 16, 14, 1],
      ["method", "parse", "Parser.parse", "Parser.parse(String)", 19, 21, 18, 1],
      ["method", "parse", "Parser.parse", "Parser.parse(String,int)", 23, 25, 23, 1],
      [
        "method",
        "parse",
        "Parser.parse",
        "Parser.parse(Map<String,T>,String...)",
        27,
        29,
        27,
        1,
      ],
      ["interface", "Visitor", "Parser.Visitor", "Parser.Visitor", 31, 34, 31, 1],
      ["field", "LIMIT", "Parser.Visitor.LIMIT", "Parser.Visitor.LIMIT", 32, 32, 32, 1],
      [
        "method",
        "visit",
        "Parser.Visitor.visit",
        "Parser.Visitor.visit(String)",
        33,
        33,
        33,
        1,
      ],
      ["enum", "Mode", "Parser.Mode", "Parser.Mode", 36, 43, 36, 1],
      ["method", "strict", "Parser.Mode.strict", "Parser.Mode.strict()", 40, 42, 40, 1],
      ["record", "Span", "Parser.Span", "Parser.Span", 45, 49, 45, 1],
      ["constructor", "Span", "Parser.Span.Span", "Parser.Span.Span(int,int)", 46, 48, 46, 1],
      ["annotation", "Marker", "Parser.Marker", "Parser.Marker", 51, 53, 51, 1],
    ],
    imports: [
      ["java.util.List", 3],
      ["java.util.Map", 4],
    ],
  },
  "unicode.ts": {
    lang: "typescript",
    rows: [
      ["variable", "名前", "名前", "名前", 2, 2, 1, 1],
      ["function", "grüße", "grüße", "grüße", 5, 7, 4, 1],
      ["variable", "after", "after", "after", 9, 9, 9, 1],
    ],
    imports: [],
  },
  "unicode.py": {
    lang: "python",
    rows: [
      ["variable", "café", "café", "café", 2, 2, 1, 1],
      ["function", "größe", "größe", "größe", 5, 7, 5, 1],
      ["function", "danach", "danach", "danach", 10, 11, 10, 1],
    ],
    imports: [],
  },
};

// §4.2's table, row by row, for the six languages of this packet: each item must appear in
// that language's golden table with the kind named here.
const COVERAGE = {
  typescript: {
    "function declaration": ["function", "add"],
    "generator declaration": ["function", "counter"],
    class: ["class", "Label"],
    method: ["method", "Label.render"],
    getter: ["getter", "Label.text"],
    setter: ["setter", "Label.text"],
    constructor: ["constructor", "Label.constructor"],
    field: ["field", "Label.name"],
    interface: ["interface", "Widget"],
    "type alias": ["type", "WidgetName"],
    enum: ["enum", "Color"],
    namespace: ["namespace", "Shapes"],
    "top-level const (arrow function)": ["variable", "double"],
    "top-level let (object literal)": ["variable", "settings"],
    "top-level var": ["variable", "legacy"],
    "default export": ["default", "default"],
  },
  tsx: {
    "function declaration": ["function", "Button"],
    "generator declaration": ["function", "frames"],
    class: ["class", "Panel"],
    method: ["method", "Panel.render"],
    getter: ["getter", "Panel.open"],
    setter: ["setter", "Panel.open"],
    constructor: ["constructor", "Panel.constructor"],
    field: ["field", "Panel.state"],
    interface: ["interface", "ButtonProps"],
    "type alias": ["type", "Size"],
    enum: ["enum", "Tone"],
    namespace: ["namespace", "Layout"],
    "top-level const (arrow function)": ["variable", "Icon"],
    "top-level const (object literal)": ["variable", "theme"],
    "default export": ["default", "default"],
  },
  javascript: {
    "function declaration": ["function", "joinAll"],
    "generator declaration": ["function", "walk"],
    class: ["class", "Store"],
    method: ["method", "Store.add"],
    getter: ["getter", "Store.size"],
    setter: ["setter", "Store.size"],
    constructor: ["constructor", "Store.constructor"],
    field: ["field", "Store.items"],
    "top-level const (arrow function)": ["variable", "handler"],
    "top-level let (object literal)": ["variable", "options"],
    "top-level var": ["variable", "counter"],
    "default export": ["default", "default"],
  },
  python: {
    function: ["function", "greet"],
    "async function": ["function", "fetch"],
    class: ["class", "Point"],
    method: ["method", "Point.norm"],
    "decorated method": ["method", "Point.double"],
    "module-level single-name assignment": ["variable", "LIMIT"],
    "annotated module-level assignment": ["variable", "ratio"],
  },
  go: {
    function: ["function", "NewSquare"],
    method: ["method", "Square.Area"],
    "type spec": ["type", "Shape"],
    "type alias spec": ["type", "Meters"],
    "top-level const": ["const", "Pi"],
    "top-level var": ["var", "registry"],
  },
  java: {
    class: ["class", "Parser"],
    interface: ["interface", "Parser.Visitor"],
    enum: ["enum", "Parser.Mode"],
    record: ["record", "Parser.Span"],
    "annotation type": ["annotation", "Parser.Marker"],
    method: ["method", "Parser.parse"],
    constructor: ["constructor", "Parser.Parser"],
    field: ["field", "Parser.depth"],
  },
};

// ---------------------------------------------------------------------------------------

async function loadExtractor() {
  const path = join(here, "dist", "code-index", "extract.js");
  if (!existsSync(path)) fail("dist/code-index/extract.js is missing (src/code-index/extract.ts, npm run build)");
  let mod;
  try {
    mod = await import(pathToFileURL(path).href);
  } catch (error) {
    fail(`dist/code-index/extract.js does not load: ${String(error?.message ?? error).slice(0, 160)}`);
  }
  for (const name of ["extract", "extractorId", "languageForPath"]) {
    check(typeof mod[name] === "function", `dist/code-index/extract.js does not export ${name}`);
  }
  return mod;
}

const ROW_KEYS = [
  "ordinal",
  "symbol_id",
  "name",
  "qname",
  "kind",
  "start_line",
  "end_line",
  "occurrence",
  "doc_start_line",
  "start_byte",
  "end_byte",
  "signature",
  "doc",
  "span_sha256",
];

function golden(symbols) {
  return symbols.map((s) => [
    s.kind,
    s.name,
    s.qname,
    s.symbol_id,
    s.start_line,
    s.end_line,
    s.doc_start_line,
    s.occurrence,
  ]);
}

function compareRows(label, got, want) {
  const g = got.map((row) => JSON.stringify(row));
  const w = want.map((row) => JSON.stringify(row));
  for (let i = 0; i < Math.max(g.length, w.length); i++) {
    if (g[i] !== w[i]) {
      fail(`${label} row ${i + 1}: got ${g[i] ?? "nothing"}, expected ${w[i] ?? "nothing"}`);
    }
  }
}

// Shape and invariants every extraction must satisfy, whatever its golden table says.
function checkInvariants(label, text, result, lang) {
  const buffer = Buffer.from(text, "utf8");
  check(result && typeof result === "object", `${label}: extract returned nothing`);
  check(result.lang === lang, `${label}: lang is ${result.lang}, expected ${lang}`);
  check(/^[0-9a-f]{64}$/.test(result.extractor_id ?? ""), `${label}: extractor_id is not a sha256`);
  check(result.bytes === buffer.length, `${label}: bytes ${result.bytes}, expected ${buffer.length}`);
  check(
    result.lines === countLines(text),
    `${label}: lines ${result.lines}, expected ${countLines(text)} counted by \\n`,
  );
  check(Array.isArray(result.symbols), `${label}: symbols is not a list`);
  check(Array.isArray(result.refs) && Array.isArray(result.imports), `${label}: refs or imports missing`);
  const seen = new Map();
  result.symbols.forEach((s, index) => {
    const at = `${label} ${s.symbol_id}`;
    check(
      JSON.stringify(Object.keys(s).sort()) === JSON.stringify([...ROW_KEYS].sort()),
      `${at}: row keys are ${Object.keys(s).join(",")}`,
    );
    check(s.ordinal === index + 1, `${at}: ordinal ${s.ordinal}, expected ${index + 1}`);
    const occurrence = (seen.get(s.symbol_id) ?? 0) + 1;
    seen.set(s.symbol_id, occurrence);
    check(s.occurrence === occurrence, `${at}: occurrence ${s.occurrence}, expected ${occurrence}`);
    check(
      s.doc_start_line >= 1 && s.doc_start_line <= s.start_line && s.start_line <= s.end_line,
      `${at}: lines ${s.doc_start_line}/${s.start_line}-${s.end_line} are out of order`,
    );
    check(
      Number.isInteger(s.start_byte) && s.start_byte >= 0 && s.end_byte > s.start_byte && s.end_byte <= buffer.length,
      `${at}: bytes ${s.start_byte}-${s.end_byte} are out of range`,
    );
    const span = buffer.subarray(s.start_byte, s.end_byte);
    check(span.toString("utf8").length > 0 && Buffer.from(span.toString("utf8")).equals(span), `${at}: span splits a character`);
    check(lineOfByte(buffer, s.start_byte) === s.doc_start_line, `${at}: start_byte is not on doc_start_line`);
    check(lineOfByte(buffer, s.end_byte - 1) === s.end_line, `${at}: end_byte is not on end_line`);
    check(s.span_sha256 === sha256(span), `${at}: span_sha256 is not the sha256 of the citeable span`);
    const sig = Buffer.from(s.signature ?? "", "utf8");
    check(typeof s.signature === "string" && sig.length <= 200, `${at}: signature over 200 bytes`);
    check(typeof s.doc === "string" && Buffer.byteLength(s.doc) <= 2000, `${at}: doc over 2,000 bytes`);
    check(!s.signature.includes("�") && !s.doc.includes("�"), `${at}: signature or doc splits a character`);
  });
}

async function extractFixture(mod, name, text = fixture(name), lang = GOLDEN[name].lang, options) {
  let result;
  try {
    result = await mod.extract(text, lang, options);
  } catch (error) {
    fail(`extract(${name}, ${lang}) threw: ${String(error?.message ?? error).slice(0, 200)}`);
  }
  checkInvariants(name, text, result, lang);
  return result;
}

function bySpanText(text, result, needle) {
  const buffer = Buffer.from(text, "utf8");
  const hits = result.symbols.filter((s) =>
    buffer.subarray(s.start_byte, s.end_byte).toString("utf8").includes(needle),
  );
  // The innermost definition containing the needle.
  hits.sort((a, b) => a.end_byte - a.start_byte - (b.end_byte - b.start_byte));
  if (hits.length === 0) fail(`no definition contains ${JSON.stringify(needle)}`);
  return hits[0];
}

function idSet(result) {
  return [...new Set(result.symbols.map((s) => s.symbol_id))].sort();
}

// ---------------------------------------------------------------------------------------

async function checkGolden(mod) {
  const results = {};
  for (const [name, spec] of Object.entries(GOLDEN)) {
    const result = await extractFixture(mod, name);
    check(result.status === "ok", `${name}: status ${result.status}, expected ok`);
    check(result.parse_errors === 0, `${name}: parse_errors ${result.parse_errors}`);
    compareRows(name, golden(result.symbols), spec.rows);
    compareRows(
      `${name} imports`,
      result.imports.map((i) => [i.specifier, i.line]),
      spec.imports,
    );
    results[name] = result;
  }
  const FILES = { typescript: "rows.ts", tsx: "rows.tsx", javascript: "rows.js", python: "rows.py", go: "rows.go", java: "Parser.java" };
  for (const [lang, items] of Object.entries(COVERAGE)) {
    const name = FILES[lang];
    const rows = GOLDEN[name].rows;
    for (const [item, [kind, qname]] of Object.entries(items)) {
      check(
        rows.some((row) => row[0] === kind && row[2] === qname),
        `${lang}: the golden table does not cover §4.2's "${item}"`,
      );
    }
  }
  return results;
}

function checkDetails(results) {
  const find = (name, symbolId, kind) => {
    const hit = results[name].symbols.find((s) => s.symbol_id === symbolId && (!kind || s.kind === kind));
    if (!hit) fail(`${name}: no ${symbolId}`);
    return hit;
  };
  const expectField = (name, symbolId, field, want, kind) => {
    const got = find(name, symbolId, kind)[field];
    check(got === want, `${name} ${symbolId}.${field} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  };
  expectField("rows.ts", "add", "signature", "export function add(a: number, b: number): number {");
  expectField("rows.ts", "add", "doc", "/** Adds two numbers. */");
  expectField("rows.ts", "Label", "doc", "/**\n * A labelled widget.\n */");
  expectField("rows.ts", "Label", "signature", "export class Label implements Widget {");
  expectField("rows.ts", "Label.text", "doc", "// Read the text.", "getter");
  expectField("rows.ts", "Label.text", "doc", "", "setter");
  expectField("rows.py", "greet", "doc", "Say hello.");
  expectField("rows.py", "Point", "doc", "A point.");
  expectField("rows.py", "Point.double", "signature", "def double(self):");
  expectField("rows.go", "Square.Area", "signature", "func (s *Square) Area() float64 {");
  expectField("rows.go", "Square.Area", "doc", "// Area of a square.");
  expectField("rows.go", "Square", "doc", "// Square has a side.");
  expectField("Parser.java", "Parser.parse(String,int)", "signature", "public List<String> parse(String text, int limit) {");
  expectField("Parser.java", "Parser.parse(String)", "doc", "// Parse a whole string.");
  expectField("Parser.java", "Parser", "doc", "/** Parses things. */");
  expectField("unicode.py", "größe", "doc", "Gibt die Größe zurück — 📏.");

  // The citeable span covers the leading comment, decorators and the export wrapper.
  const ts = Buffer.from(fixture("rows.ts"), "utf8");
  const label = find("rows.ts", "Label");
  const labelText = ts.subarray(label.start_byte, label.end_byte).toString("utf8");
  check(labelText.startsWith("/**\n * A labelled widget.\n */\n@sealed\nexport class Label"), "rows.ts Label's span does not start at its doc comment");
  check(labelText.endsWith("return pad(this.name);\n  }\n}"), "rows.ts Label's span does not end at its closing brace");
  const point = find("rows.py", "Point");
  const py = Buffer.from(fixture("rows.py"), "utf8");
  check(py.subarray(point.start_byte, point.end_byte).toString("utf8").startsWith("@dataclass\nclass Point:"), "rows.py Point's span does not include its decorator");

  // References come from tags.scm, unresolved, by name.
  const refs = (name) => results[name].refs.map((r) => `${r.name}:${r.kind}:${r.line}`);
  for (const [name, want] of [
    ["rows.ts", ["pad:call:53", "counter:call:70"]],
    ["rows.js", ["join:call:7", "push:call:32"]],
    ["rows.py", ["shout:call:15", "h:call:19"]],
    ["rows.go", ["Sprint:call:42", "append:call:46"]],
    ["Parser.java", ["parse:call:24", "subList:call:24"]],
  ]) {
    for (const ref of want) check(refs(name).includes(ref), `${name}: references lack ${ref}`);
    const sorted = [...results[name].refs].map((r) => JSON.stringify([r.line, r.name, r.kind]));
    check(new Set(sorted).size === sorted.length, `${name}: references repeat a row`);
  }
  // tags.scm definitions are not the index's: an arrow function in an object literal is not
  // a definition, nor is a for-loop's let.
  check(!results["rows.ts"].symbols.some((s) => s.name === "describe" || s.name === "i"), "rows.ts: a tags.scm-style definition (describe, i) leaked into the table");
}

async function checkUnicode(mod) {
  const cases = [
    [
      "unicode.ts",
      "名前",
      '// Ünïcödé fixture: offsets are UTF-8 bytes, not UTF-16 code units.\nexport const 名前 = "東京";',
    ],
    [
      "unicode.ts",
      "grüße",
      "/** Grüße — returns a greeting with an emoji 😀. */\nexport function grüße(wer: string): string {\n  return `Hallo, ${wer} 👋`;\n}",
    ],
    ["unicode.ts", "after", 'export const after = "ß";'],
    [
      "unicode.py",
      "café",
      '# Ünïcödé fixture: offsets are UTF-8 bytes, not UTF-16 code units.\ncafé = "☕"',
    ],
    ["unicode.py", "größe", 'def größe(wert):\n    """Gibt die Größe zurück — 📏."""\n    return len(wert)'],
    ["unicode.py", "danach", 'def danach():\n    return "ß"'],
  ];
  for (const [name, symbolId, want] of cases) {
    const text = fixture(name);
    const result = await extractFixture(mod, name);
    const s = result.symbols.find((row) => row.symbol_id === symbolId);
    check(s, `${name}: no ${symbolId}`);
    const buffer = Buffer.from(text, "utf8");
    const got = buffer.subarray(s.start_byte, s.end_byte).toString("utf8");
    check(got === want, `${name} ${symbolId}: bytes ${s.start_byte}-${s.end_byte} slice ${JSON.stringify(got.slice(0, 60))}, not the definition`);
    check(s.start_byte === buffer.indexOf(Buffer.from(want, "utf8")), `${name} ${symbolId}: start_byte is not a UTF-8 offset`);
  }
  // A long doc is cut at 2,000 bytes on a character boundary.
  const long = `/** ${"é".repeat(1500)} */\nexport function long() {}\n`;
  const result = await mod.extract(long, "typescript");
  const s = result.symbols.find((row) => row.symbol_id === "long");
  check(s, "a function with a 3,000-byte doc comment is missing");
  check(Buffer.byteLength(s.doc) <= 2000 && Buffer.byteLength(s.doc) >= 1990, `a 3,000-byte doc was cut to ${Buffer.byteLength(s.doc)} bytes`);
  check(long.startsWith(s.doc), "a cut doc is not a prefix of the comment");
  const longSig = `export function wide(${"a".repeat(300)}: number) {}\n`;
  const wide = (await mod.extract(longSig, "typescript")).symbols.find((row) => row.symbol_id === "wide");
  check(wide && Buffer.byteLength(wide.signature) <= 200 && longSig.startsWith(wide.signature), "a 330-byte first line was not cut to a 200-byte signature prefix");
}

async function checkHashEdits(mod) {
  const cases = [
    ["rows.ts", "add", "return a + b;", "return a - b;", "body"],
    ["rows.ts", "add", "/** Adds two numbers. */", "/** Adds two numbers, quickly. */", "leading comment"],
    ["rows.ts", "Label", " * A labelled widget.", " * A widget with a label.", "leading comment"],
    ["rows.py", "greet", "# Greets someone.", "# Greets anyone.", "leading comment"],
    ["rows.py", "greet", '"""Say hello."""', '"""Say hi."""', "docstring"],
    ["rows.go", "Circle.Area", "return m.Pi * c.R * c.R", "return m.Pi * c.R * c.R * 1", "body"],
    ["rows.go", "Square.Area", "// Area of a square.", "// Area of the square.", "leading comment"],
    ["Parser.java", "Parser.parse(String,int)", "subList(0, limit)", "subList(1, limit)", "body"],
    ["Parser.java", "Parser.parse(String)", "// Parse a whole string.", "// Parse one whole string.", "leading comment"],
  ];
  for (const [name, target, from, to, what] of cases) {
    const text = fixture(name);
    check(text.split(from).length === 2, `fixture ${name} does not contain ${from} exactly once`);
    const before = await extractFixture(mod, name);
    const after = await extractFixture(mod, name, text.replace(from, to));
    // Definitions whose span holds the edit: the target and whatever encloses it.
    const touched = new Set(
      before.symbols
        .filter((s) => Buffer.from(text).subarray(s.start_byte, s.end_byte).includes(Buffer.from(from)))
        .map((s) => `${s.symbol_id}#${s.occurrence}`),
    );
    check(touched.has(`${target}#1`), `${name}: ${target}'s span does not hold the ${what}`);
    for (const s of before.symbols) {
      const key = `${s.symbol_id}#${s.occurrence}`;
      const other = after.symbols.find((a) => `${a.symbol_id}#${a.occurrence}` === key);
      check(other, `${name}: ${key} vanished after a ${what} edit`);
      if (touched.has(key)) {
        check(other.span_sha256 !== s.span_sha256, `${name}: a ${what} edit did not change ${key}'s span_sha256`);
      } else {
        check(other.span_sha256 === s.span_sha256, `${name}: a ${what} edit to ${target} changed ${key}'s span_sha256`);
      }
    }
  }
}

async function checkStableIds(mod) {
  // Go: the same receiver methods under reordering, insertion and deletion.
  const go = fixture("rows.go");
  const circle = "func (c Circle) Area() float64 {\n\treturn m.Pi * c.R * c.R\n}\n";
  const square = "// Area of a square.\nfunc (s *Square) Area() float64 {\n\treturn s.Side * s.Side\n}\n";
  const stringer = "func (s Square) String() string {\n\treturn fmt.Sprint(s.Side)\n}\n";
  const newSquare = "// NewSquare makes one.\nfunc NewSquare(side float64) *Square {\n\treturn &Square{Side: side}\n}\n";
  for (const part of [circle, square, stringer, newSquare]) check(go.includes(part), "rows.go changed under the gate");
  const goBase = idSet(await extractFixture(mod, "rows.go"));
  const goVariants = [
    ["reordered", go.replace(circle, "").replace(square, `${circle}\n${square}`), goBase],
    [
      "inserted",
      go.replace(newSquare, `func helper() {}\n\nfunc (s *Square) Scale(k float64) { s.Side *= k }\n\n${newSquare}`),
      [...goBase, "helper", "Square.Scale"].sort(),
    ],
    [
      "deleted",
      go.replace(stringer, "").replace(newSquare, ""),
      goBase.filter((id) => id !== "Square.String" && id !== "NewSquare"),
    ],
  ];
  for (const [what, text, ids] of goVariants) {
    const result = await extractFixture(mod, "rows.go", text);
    check(JSON.stringify(idSet(result)) === JSON.stringify(ids), `rows.go ${what}: symbol_ids ${idSet(result).join(" ")}`);
    for (const [needle, id] of [
      ["return s.Side * s.Side", "Square.Area"],
      ["return m.Pi * c.R * c.R", "Circle.Area"],
      ["l.items = append", "List.Push"],
    ]) {
      const s = bySpanText(text, result, needle);
      check(s.symbol_id === id, `rows.go ${what}: the definition holding ${needle} is ${s.symbol_id}, expected ${id}`);
    }
  }

  // Java: overloads under reordering, insertion and deletion.
  const java = fixture("Parser.java");
  const one = "  // Parse a whole string.\n  public List<String> parse(String text) {\n    return List.of(text);\n  }\n";
  const two = "  public List<String> parse(String text, int limit) {\n    return parse(text).subList(0, limit);\n  }\n";
  const generic = "  <T> T parse(Map<String, T> table, String... keys) {\n    return null;\n  }\n";
  const noArg = "  public Parser() {}\n";
  for (const part of [one, two, generic, noArg]) check(java.includes(part), "Parser.java changed under the gate");
  const javaBase = idSet(await extractFixture(mod, "Parser.java"));
  const javaVariants = [
    ["reordered", java.replace(one, "").replace(two, "").replace(generic, `${generic}\n${two}\n${one}`), javaBase],
    [
      "inserted",
      java.replace(one, `  Parser parse(int depth) {\n    return this;\n  }\n\n  long stamp;\n\n${one}`),
      [...javaBase, "Parser.parse(int)", "Parser.stamp"].sort(),
    ],
    ["deleted", java.replace(noArg, "").replace(two, ""), javaBase.filter((id) => id !== "Parser.Parser()" && id !== "Parser.parse(String,int)")],
  ];
  for (const [what, text, ids] of javaVariants) {
    const result = await extractFixture(mod, "Parser.java", text, "java");
    check(JSON.stringify(idSet(result)) === JSON.stringify(ids), `Parser.java ${what}: symbol_ids ${idSet(result).join(" ")}`);
    const pairs = [
      ["return List.of(text)", "Parser.parse(String)"],
      ["return null;", "Parser.parse(Map<String,T>,String...)"],
      ["this.depth = source.length()", "Parser.Parser(String)"],
    ];
    if (what !== "deleted") pairs.push(["subList(0, limit)", "Parser.parse(String,int)"]);
    for (const [needle, id] of pairs) {
      const s = bySpanText(text, result, needle);
      check(s.symbol_id === id, `Parser.java ${what}: the definition holding ${needle} is ${s.symbol_id}, expected ${id}`);
    }
  }

  // Python: two definitions of one name are occurrences of one id, before and after an
  // insertion above them.
  const py = fixture("rows.py");
  for (const [what, text] of [
    ["as committed", py],
    ["with a definition inserted above", py.replace("\n\nif os.name", "\n\ndef extra():\n    return 0\n\n\nif os.name")],
  ]) {
    const result = await extractFixture(mod, "rows.py", text);
    const seps = result.symbols.filter((s) => s.name === "sep");
    check(seps.length === 2, `rows.py ${what}: ${seps.length} sep definitions, expected 2`);
    check(seps.every((s) => s.symbol_id === "sep" && s.kind === "function"), `rows.py ${what}: the two seps do not share symbol_id sep`);
    check(seps[0].occurrence === 1 && seps[1].occurrence === 2, `rows.py ${what}: the seps are not occurrences 1 and 2`);
    check(seps[0].start_line < seps[1].start_line && seps[0].span_sha256 !== seps[1].span_sha256, `rows.py ${what}: the seps are not two distinct spans`);
  }
}

async function checkCrlf(mod) {
  let helpers;
  const helpersPath = join(here, "dist", "helpers.js");
  if (!existsSync(helpersPath)) fail("dist/helpers.js is missing (npm run build)");
  try {
    helpers = await import(pathToFileURL(helpersPath).href);
  } catch (error) {
    fail(`dist/helpers.js does not load: ${String(error?.message ?? error).slice(0, 120)}`);
  }
  const workspace = mkdtempSync(join(tmpdir(), "amanuensis-si2-crlf-"));
  try {
    const git = (...args) => {
      const out = spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
      check(out.status === 0, `git ${args[0]} failed in the CRLF fixture repository`);
      return out.stdout.trim();
    };
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    git("config", "user.email", "gate@example.invalid");
    git("config", "user.name", "Gate");
    const files = ["rows.ts", "rows.py", "rows.go", "Parser.java"];
    for (const name of files) writeFileSync(join(workspace, name), fixture(name).replace(/\n/g, "\r\n"));
    git("add", ".");
    git("commit", "-q", "-m", "crlf");
    const rev = git("rev-parse", "HEAD");
    for (const name of files) {
      const lf = fixture(name);
      const crlf = lf.replace(/\n/g, "\r\n");
      const plain = await extractFixture(mod, name);
      const result = await extractFixture(mod, name, crlf);
      check(result.lines === plain.lines, `${name} CRLF: lines ${result.lines}, the LF file has ${plain.lines}`);
      compareRows(`${name} CRLF`, golden(result.symbols), GOLDEN[name].rows);
      const crlfBytes = Buffer.from(crlf, "utf8");
      const lfBytes = Buffer.from(lf, "utf8");
      result.symbols.forEach((s, i) => {
        const p = plain.symbols[i];
        const span = crlfBytes.subarray(s.start_byte, s.end_byte).toString("utf8");
        const want = lfBytes.subarray(p.start_byte, p.end_byte).toString("utf8").replace(/\n/g, "\r\n");
        check(span === want, `${name} CRLF ${s.symbol_id}: the span is not the LF span with CRLF endings`);
        check(s.start_byte === p.start_byte + s.doc_start_line - 1, `${name} CRLF ${s.symbol_id}: start_byte does not count the CRs before it`);
        const excerptLine = span.split("\r\n").find((line) => line.trim().length > 3) ?? span;
        try {
          helpers.requireEvidenceCitation(workspace, rev, name, `${s.doc_start_line}-${s.end_line}`, excerptLine.trim());
        } catch (error) {
          fail(`${name} CRLF ${s.symbol_id}: requireEvidenceCitation refused its span: ${String(error?.message ?? error).slice(0, 160)}`);
        }
      });
      let refused = false;
      try {
        helpers.requireEvidenceCitation(workspace, rev, name, `${result.lines}-${result.lines + 1}`, null);
      } catch {
        refused = true;
      }
      check(refused, `${name} CRLF: requireEvidenceCitation accepts a line past the extractor's line count`);
      helpers.requireEvidenceCitation(workspace, rev, name, `${result.lines}`, null);
    }
    // A lone CR is not a line break, for requireEvidenceCitation or the extractor.
    const cr = "const s = `a\rb`;\nexport function after() {}\n";
    const crResult = await mod.extract(cr, "typescript");
    const after = crResult.symbols.find((s) => s.symbol_id === "after");
    check(crResult.lines === 2 && after?.start_line === 2, "a lone CR was counted as a line break");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function checkDeterminism(mod) {
  const names = Object.keys(GOLDEN);
  const first = [];
  for (const name of names) first.push(JSON.stringify(await mod.extract(fixture(name), GOLDEN[name].lang)));
  for (const [i, name] of names.entries()) {
    const again = JSON.stringify(await mod.extract(fixture(name), GOLDEN[name].lang));
    check(again === first[i], `${name}: a second run in one process gave different output`);
  }
  const script = [
    `const m = await import(${JSON.stringify(pathToFileURL(join(here, "dist", "code-index", "extract.js")).href)});`,
    "const fs = await import('node:fs');",
    `const names = ${JSON.stringify(names.map((n) => [join(fixtures, n), GOLDEN[n].lang]))};`,
    "const out = [];",
    "for (const [p, l] of names) out.push(JSON.stringify(await m.extract(fs.readFileSync(p, 'utf8'), l)));",
    "process.stdout.write(JSON.stringify(out));",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: tmpdir() });
  check(child.status === 0, `a second process could not extract: ${String(child.stderr).split("\n")[0].slice(0, 120)}`);
  let other;
  try {
    other = JSON.parse(child.stdout);
  } catch {
    fail("a second process printed no extraction");
  }
  for (const [i, name] of names.entries()) {
    check(other[i] === first[i], `${name}: a second process gave different output`);
  }
}

async function checkPartial(mod) {
  const cases = [
    ["rows.ts", "  for (let i = 0; i < limit; i++) yield i;", "  for (let i = 0; i < limit; i++) yield i +* ;", ["counter"]],
    ["rows.py", "    return await h(url)\n", "    return await h(url) +\n", ["fetch"]],
    ["rows.go", "\treturn &Square{Side: side}\n", "\treturn &Square{Side: := side}\n", ["NewSquare"]],
    ["Parser.java", "    return List.of(text);\n", "    return List.of(text;\n", ["Parser.parse(String)"]],
  ];
  for (const [name, from, to, broken] of cases) {
    const text = fixture(name);
    check(text.includes(from), `fixture ${name} lacks ${from.trim()}`);
    const clean = await extractFixture(mod, name);
    const result = await extractFixture(mod, name, text.replace(from, to));
    check(result.status === "parse-partial", `${name} with a syntax error: status ${result.status}, expected parse-partial`);
    check(result.parse_errors >= 1, `${name} with a syntax error: parse_errors ${result.parse_errors}`);
    const got = new Map(result.symbols.map((s) => [`${s.symbol_id}#${s.occurrence}`, s]));
    const lost = [];
    for (const s of clean.symbols) {
      const key = `${s.symbol_id}#${s.occurrence}`;
      const span = Buffer.from(text).subarray(s.start_byte, s.end_byte);
      const holdsError = span.includes(Buffer.from(from));
      if (broken.includes(s.symbol_id)) {
        check(!got.has(key), `${name}: the broken definition ${s.symbol_id} is reported as if it parsed`);
        continue;
      }
      if (holdsError) continue; // an enclosing definition holds the error
      const after = got.get(key);
      if (!after) {
        lost.push(key);
        continue;
      }
      check(
        after.start_line === s.start_line && after.end_line === s.end_line && after.doc_start_line === s.doc_start_line,
        `${name}: the intact definition ${key} moved after a syntax error elsewhere`,
      );
      check(after.span_sha256 === s.span_sha256, `${name}: the intact definition ${key} changed after a syntax error elsewhere`);
    }
    check(lost.length === 0, `${name}: a syntax error lost the intact definitions ${lost.join(", ")}`);
  }
  const clean = await mod.extract(fixture("rows.ts"), "typescript");
  check(clean.status === "ok" && clean.parse_errors === 0, "rows.ts without an error is not status ok");
}

async function checkPackageRoot(mod) {
  // The default generation is the package's: queries/ and grammars/ beside dist/.
  const id = mod.extractorId();
  check(/^[0-9a-f]{64}$/.test(id ?? ""), "extractorId() is not a sha256");
  check(mod.extractorId() === id, "extractorId() is not stable");
  for (const lang of ["typescript", "javascript", "python", "go", "java"]) {
    check(existsSync(join(here, "queries", `${lang}.scm`)), `queries/${lang}.scm is missing`);
  }
  const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
  check(pkg.files.includes("queries/"), "package.json files omits queries/");
  // A generation's files are fixed while a process uses it, so each change below gets a
  // fresh copy of the package root.
  const roots = [];
  const copyRoot = (change) => {
    const root = mkdtempSync(join(tmpdir(), "amanuensis-si2-root-"));
    roots.push(root);
    cpSync(join(here, "queries"), join(root, "queries"), { recursive: true });
    cpSync(join(here, "grammars"), join(root, "grammars"), { recursive: true });
    change?.(root);
    return root;
  };
  const refusal = async (text, lang, root) => {
    try {
      await mod.extract(text, lang, { packageRoot: root });
    } catch (error) {
      return String(error?.message ?? error);
    }
    return null;
  };
  try {
    const same = copyRoot();
    check(mod.extractorId({ packageRoot: same }) === id, "an identical package root gives a different extractor_id");
    const text = fixture("rows.go");
    const base = await mod.extract(text, "go");
    const copied = await mod.extract(text, "go", { packageRoot: same });
    check(JSON.stringify(copied) === JSON.stringify(base), "an identical package root extracts differently");

    // A changed query file is a new generation, and its patterns are what define symbols.
    const goQuery = join("queries", "go.scm");
    const changedRoot = copyRoot((root) => writeFileSync(join(root, goQuery), `${readFileSync(join(root, goQuery), "utf8")}\n; changed\n`));
    const changed = mod.extractorId({ packageRoot: changedRoot });
    check(changed !== id, "a changed queries/go.scm leaves extractor_id unchanged");
    const moved = await mod.extract(text, "go", { packageRoot: changedRoot });
    check(moved.extractor_id === changed, "an extraction is not labelled with its generation's extractor_id");
    check(JSON.stringify(golden(moved.symbols)) === JSON.stringify(golden(base.symbols)), "a comment in queries/go.scm changed the definitions");
    const emptyRoot = copyRoot((root) => writeFileSync(join(root, goQuery), ""));
    const empty = await mod.extract(text, "go", { packageRoot: emptyRoot });
    check(empty.symbols.length === 0, "an empty queries/go.scm still yields definitions (they come from elsewhere)");
    check(empty.refs.length > 0, "an empty queries/go.scm also removed the tags.scm references");
    const manifestRoot = copyRoot((root) => {
      const path = join(root, "grammars", "manifest.json");
      writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
    });
    check(mod.extractorId({ packageRoot: manifestRoot }) !== id, "a changed grammar manifest leaves extractor_id unchanged");

    // A missing query file is refused, not replaced by tags.scm.
    const missingRoot = copyRoot((root) => rmSync(join(root, "queries", "python.scm")));
    const missing = await refusal(fixture("rows.py"), "python", missingRoot);
    check(missing !== null, "a missing queries/python.scm was not refused");
    check(/python\.scm/.test(missing), `a missing query was refused without naming it: ${missing.slice(0, 120)}`);

    // A grammar whose bytes differ from the manifest is refused at load.
    const tamperedRoot = copyRoot((root) => {
      const wasm = join(root, "grammars", "java", "grammar.wasm");
      const bytes = readFileSync(wasm);
      bytes[Math.floor(bytes.length / 2)] ^= 0x01;
      writeFileSync(wasm, bytes);
    });
    const tampered = await refusal(fixture("Parser.java"), "java", tamperedRoot);
    check(tampered !== null, "a grammar whose bytes differ from the manifest was loaded");
    check(/sha256/.test(tampered), `a tampered grammar was refused without naming the hash: ${tampered.slice(0, 120)}`);
    const tagsRoot = copyRoot((root) => {
      const tags = join(root, "grammars", "go", "tags.scm");
      writeFileSync(tags, `${readFileSync(tags, "utf8")} `);
    });
    const tags = await refusal(text, "go", tagsRoot);
    check(tags !== null && /size|sha256/.test(tags), "a tags.scm whose bytes differ from the manifest was loaded");
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
}

async function checkLanguages(mod) {
  const table = [
    ["src/a.ts", "typescript"],
    ["src/a.mts", "typescript"],
    ["src/a.cts", "typescript"],
    ["types/a.d.ts", "typescript"],
    ["src/A.tsx", "tsx"],
    ["a.js", "javascript"],
    ["a.mjs", "javascript"],
    ["a.cjs", "javascript"],
    ["a.jsx", "javascript"],
    ["pkg/a.py", "python"],
    ["pkg/a.pyi", "python"],
    ["cmd/main.go", "go"],
    ["src/main/java/A.java", "java"],
    ["README.md", null],
    ["Makefile", null],
    ["a.ts.orig", null],
    ["notes.txt", null],
  ];
  for (const [path, want] of table) {
    const got = mod.languageForPath(path);
    check(got === want, `languageForPath(${path}) is ${got}, expected ${want}`);
  }
  const result = await mod.extract("IDENTIFICATION DIVISION.\n", "cobol");
  check(result.status === "unsupported-language", `an unsupported language gives status ${result.status}`);
  check(Array.isArray(result.symbols) && result.symbols.length === 0, "an unsupported language gives definitions");
}

const CRASH = /Cannot find module|MODULE_NOT_FOUND|ModuleNotFoundError|SyntaxError|No such file or directory|ENOENT|ImportError|ReferenceError|is not defined|command not found|Traceback/g;

async function main() {
  const mod = await loadExtractor();
  await checkLanguages(mod);
  const results = await checkGolden(mod);
  checkDetails(results);
  await checkUnicode(mod);
  await checkHashEdits(mod);
  await checkStableIds(mod);
  await checkCrlf(mod);
  await checkPartial(mod);
  await checkDeterminism(mod);
  await checkPackageRoot(mod);
}

try {
  await main();
  console.log("GATE SI2 GREEN");
} catch (error) {
  const reason =
    error instanceof GateFailure
      ? error.message
      : `unexpected error: ${String(error?.message ?? error)}`;
  console.log(`GATE SI2 RED: ${reason.replace(/\s+/g, " ").replace(CRASH, "[error]").slice(0, 400)}`);
  process.exit(1);
}
