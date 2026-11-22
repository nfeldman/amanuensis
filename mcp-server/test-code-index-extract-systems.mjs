#!/usr/bin/env node
// GATE SI3 — Rust, C, C++ and C# definitions (design/semantic-index/PLAN.md §4.2, §8 SI3).
//
// Turns red when:
//   - dist/code-index/extract.js is missing, does not export extract and languageForPath, or
//     does not map .rs, .c, .h, .cc, .cpp, .cxx, .hpp, .hh and .cs to rust, c, cpp and csharp;
//   - the golden tables for Rust, C, C++ and C# do not match row for row (kind, name, qname,
//     symbol_id, start_line, end_line, doc_start_line, occurrence), or they fail to cover
//     every row of §4.2's table for those languages;
//   - a definition comes from a grammar's tags.scm rather than queries/<lang>.scm, or a
//     missing query file is not refused;
//   - span_sha256 is not the sha256 of the citeable span, or the span does not run from the
//     leading comments, attributes and template lines to the end of the declaration;
//   - a body edit does not change span_sha256 in each language (C and C++ function, struct
//     and member bodies included), or a leading-comment or attribute edit does not, or an
//     edit changes the span_sha256 of a definition it did not touch;
//   - Rust: an `impl` item and a trait-impl item of one name share an id, the impl block's
//     items are not `T.<name>` and `<T as Trait>.<name>`, or a method appears more than once;
//   - C++: a qualified declarator is not relative to its lexical namespace chain, a `::`
//     declarator is not global, a prototype or member declaration is not kind `declaration`
//     sharing the definition's symbol_id as a second occurrence, or overloads that differ only
//     by `const`, by ref-qualifier or by template arity share an id; an out-of-class
//     operator definition is not kind `operator`, or a definition qualified by a namespace
//     the file declares is kind `method` rather than `function`;
//   - C#: a conversion operator (implicit or explicit) is missing;
//   - C#: block and file-scoped namespaces are not segments, a partial class split across two
//     files does not read as two `partial` fragments with one symbol_id, a partial method's
//     halves are not a `declaration` and a `method` with one symbol_id (in two files and in
//     one), properties, events, indexers or records are missing, a local function is a
//     definition, or overloads that differ by generic arity or by `ref`/`out` share an id;
//   - a parameter's name, attribute or default value enters a C++ or C# discriminator;
//   - any symbol_id changes when its file's definitions are reordered;
//   - output differs across two runs, or CRLF line endings change a golden row.
//
// Hermetic: fixture sources are committed under fixtures/code-index/; package-root copies are
// built in a temporary directory. No network.
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
// Replace `from` with `to`, where `from` must occur exactly once.
function once(text, from, to, label) {
  if (text.split(from).length !== 2) fail(`${label}: the fixture does not contain ${JSON.stringify(from.slice(0, 60))} exactly once`);
  return text.replace(from, () => to);
}

// ---------------------------------------------------------------------------------------
// Golden tables: [kind, name, qname, symbol_id, start_line, end_line, doc_start_line,
// occurrence], in file order. Written from the fixtures by hand, not from extractor output.

const GOLDEN = {
  "rows.rs": {
    lang: "rust",
    rows: [
      ["const", "LIMIT", "LIMIT", "LIMIT", 5, 5, 4, 1],
      ["static", "COUNTER", "COUNTER", "COUNTER", 6, 6, 6, 1],
      ["struct", "Stack", "Stack", "Stack", 10, 12, 8, 1],
      ["enum", "Shape", "Shape", "Shape", 14, 17, 14, 1],
      ["union", "Bits", "Bits", "Bits", 19, 22, 19, 1],
      ["type", "Pair", "Pair", "Pair", 24, 24, 24, 1],
      ["trait", "Container", "Container", "Container", 27, 34, 26, 1],
      ["type", "Item", "Container.Item", "Container.Item", 28, 28, 28, 1],
      ["const", "EMPTY", "Container.EMPTY", "Container.EMPTY", 29, 29, 29, 1],
      ["method", "len", "Container.len", "Container.len", 30, 30, 30, 1],
      ["method", "is_empty", "Container.is_empty", "Container.is_empty", 31, 33, 31, 1],
      ["impl", "impl Stack", "impl Stack", "impl Stack", 36, 48, 36, 1],
      ["const", "DEPTH", "Stack.DEPTH", "Stack.DEPTH", 37, 37, 37, 1],
      ["type", "Out", "Stack.Out", "Stack.Out", 38, 38, 38, 1],
      ["method", "push", "Stack.push", "Stack.push", 41, 43, 40, 1],
      ["method", "len", "Stack.len", "Stack.len", 45, 47, 45, 1],
      ["impl", "impl Container for Stack", "impl Container for Stack", "impl Container for Stack", 50, 56, 50, 1],
      ["type", "Item", "<Stack as Container>.Item", "<Stack as Container>.Item", 51, 51, 51, 1],
      ["method", "len", "<Stack as Container>.len", "<Stack as Container>.len", 53, 55, 53, 1],
      ["impl", "impl fmt::Display for Stack", "impl fmt::Display for Stack", "impl fmt::Display for Stack", 58, 62, 58, 1],
      ["method", "fmt", "<Stack as fmt::Display>.fmt", "<Stack as fmt::Display>.fmt", 59, 61, 59, 1],
      ["function", "area", "area", "area", 64, 69, 64, 1],
      ["module", "geometry", "geometry", "geometry", 71, 81, 71, 1],
      ["struct", "Point", "geometry.Point", "geometry.Point", 72, 74, 72, 1],
      ["impl", "impl Point", "geometry.impl Point", "geometry.impl Point", 76, 80, 76, 1],
      ["method", "origin", "geometry.Point.origin", "geometry.Point.origin", 77, 79, 77, 1],
      ["macro", "square", "square", "square", 84, 88, 83, 1],
    ],
  },
  "rows.c": {
    lang: "c",
    rows: [
      ["macro", "LIMIT", "LIMIT", "LIMIT", 6, 6, 5, 1],
      ["macro", "SQUARE", "SQUARE", "SQUARE", 7, 7, 7, 1],
      ["variable", "counter", "counter", "counter", 9, 9, 9, 1],
      ["variable", "greeting", "greeting", "greeting", 10, 10, 10, 1],
      ["variable", "farewell", "farewell", "farewell", 10, 10, 10, 1],
      ["struct", "point", "point", "point", 16, 19, 15, 1],
      ["union", "bits", "bits", "bits", 21, 24, 21, 1],
      ["enum", "color", "color", "color", 26, 26, 26, 1],
      ["typedef", "size_type", "size_type", "size_type", 28, 28, 28, 1],
      ["typedef", "node_t", "node_t", "node_t", 29, 31, 29, 1],
      ["typedef", "node_ptr", "node_ptr", "node_ptr", 29, 31, 29, 1],
      ["struct", "node", "node", "node", 29, 31, 29, 1],
      ["typedef", "compare_fn", "compare_fn", "compare_fn", 32, 32, 32, 1],
      ["variable", "verbose", "verbose", "verbose", 35, 35, 35, 1],
      ["function", "add", "add", "add", 39, 42, 38, 1],
      ["function", "name_of", "name_of", "name_of", 44, 50, 44, 1],
      ["struct", "local", "name_of.local", "name_of.local", 47, 47, 47, 1],
      ["function", "main", "main", "main", 52, 56, 52, 1],
    ],
  },
  "rows.cpp": {
    lang: "cpp",
    rows: [
      ["macro", "CHECK", "CHECK", "CHECK", 5, 5, 5, 1],
      ["declaration", "run", "run", "run()", 7, 7, 7, 1],
      ["variable", "total", "total", "total", 8, 8, 8, 1],
      ["namespace", "geo", "geo", "geo", 10, 67, 10, 1],
      ["class", "Buf", "geo.Buf", "geo.Buf", 14, 40, 12, 1],
      ["declaration", "Buf", "geo.Buf.Buf", "geo.Buf.Buf()", 16, 16, 16, 1],
      ["declaration", "Buf", "geo.Buf.Buf", "geo.Buf.Buf(std::size_t)", 17, 17, 17, 1],
      ["declaration", "~Buf", "geo.Buf.~Buf", "geo.Buf.~Buf()", 18, 18, 18, 1],
      ["declaration", "get", "geo.Buf.get", "geo.Buf.get() &", 20, 20, 20, 1],
      ["declaration", "get", "geo.Buf.get", "geo.Buf.get() &&", 21, 21, 21, 1],
      ["declaration", "get", "geo.Buf.get", "geo.Buf.get() const", 22, 22, 22, 1],
      ["declaration", "get", "geo.Buf.get", "geo.Buf.get(int)", 23, 23, 23, 1],
      ["declaration", "operator==", "geo.Buf.operator==", "geo.Buf.operator==(const Buf&) const", 25, 25, 25, 1],
      ["declaration", "operator=", "geo.Buf.operator=", "geo.Buf.operator=(Buf&&)", 26, 26, 26, 1],
      ["method", "size", "geo.Buf.size", "geo.Buf.size() const", 28, 28, 28, 1],
      ["declaration", "reset", "geo.Buf.reset", "geo.Buf.reset()", 29, 29, 29, 1],
      ["field", "kDepth", "geo.Buf.kDepth", "geo.Buf.kDepth", 31, 31, 31, 1],
      ["field", "size_", "geo.Buf.size_", "geo.Buf.size_", 34, 34, 34, 1],
      ["field", "data_", "geo.Buf.data_", "geo.Buf.data_", 35, 35, 35, 1],
      ["struct", "Cursor", "geo.Buf.Cursor", "geo.Buf.Cursor", 37, 39, 37, 1],
      ["field", "at", "geo.Buf.Cursor.at", "geo.Buf.Cursor.at", 38, 38, 38, 1],
      ["struct", "Point", "geo.Point", "geo.Point", 42, 44, 42, 1],
      ["field", "x", "geo.Point.x", "geo.Point.x", 43, 43, 43, 1],
      ["field", "y", "geo.Point.y", "geo.Point.y", 43, 43, 43, 1],
      ["enum", "Color", "geo.Color", "geo.Color", 46, 46, 46, 1],
      ["type", "Index", "geo.Index", "geo.Index", 48, 48, 48, 1],
      ["typedef", "byte", "geo.byte", "geo.byte", 49, 49, 49, 1],
      ["concept", "Small", "geo.Small", "geo.Small", 52, 52, 51, 1],
      ["variable", "kPi", "geo.kPi", "geo.kPi", 54, 54, 54, 1],
      ["declaration", "make", "geo.make", "geo.make<1>(int)", 58, 58, 56, 1],
      ["function", "make", "geo.make", "geo.make<2>(int)", 61, 63, 60, 1],
      ["method", "helper", "geo.Buf.helper", "geo.Buf.helper()", 65, 65, 65, 1],
      ["namespace", "geo.detail", "geo.detail", "geo.detail", 69, 71, 69, 1],
      ["function", "twice", "geo.detail.twice", "geo.detail.twice(int)", 70, 70, 70, 1],
      ["namespace", "outer", "outer", "outer", 73, 80, 73, 1],
      ["method", "shift", "outer.geo.Point.shift", "outer.geo.Point.shift(double)", 74, 76, 74, 1],
      ["method", "scale", "geo.Point.scale", "geo.Point.scale(double)", 77, 79, 77, 1],
      ["constructor", "Buf", "geo.Buf.Buf", "geo.Buf.Buf()", 83, 83, 82, 2],
      ["destructor", "~Buf", "geo.Buf.~Buf", "geo.Buf.~Buf()", 86, 88, 85, 2],
      ["method", "get", "geo.Buf.get", "geo.Buf.get() const", 91, 93, 90, 2],
      ["function", "run", "run", "run()", 95, 97, 95, 2],
      ["union", "Word", "Word", "Word", 99, 102, 99, 1],
      ["field", "i", "Word.i", "Word.i", 100, 100, 100, 1],
      ["field", "f", "Word.f", "Word.f", 101, 101, 101, 1],
      ["enum", "Level", "Level", "Level", 104, 104, 104, 1],
      ["operator", "operator==", "geo.Buf.operator==", "geo.Buf.operator==(const Buf&) const", 107, 109, 106, 2],
      ["namespace", "geo.detail", "geo.detail", "geo.detail", 111, 113, 111, 2],
      ["declaration", "half", "geo.detail.half", "geo.detail.half(int)", 112, 112, 112, 1],
      ["function", "half", "geo.detail.half", "geo.detail.half(int)", 115, 117, 115, 2],
    ],
  },
  "Rows.cs": {
    lang: "csharp",
    rows: [
      ["namespace", "Acme.Tools", "Acme.Tools", "Acme.Tools", 5, 81, 5, 1],
      ["class", "Cache", "Acme.Tools.Cache", "Acme.Tools.Cache`1", 9, 59, 7, 1],
      ["const", "Limit", "Acme.Tools.Cache.Limit", "Acme.Tools.Cache`1.Limit", 11, 11, 11, 1],
      ["field", "items", "Acme.Tools.Cache.items", "Acme.Tools.Cache`1.items", 12, 12, 12, 1],
      ["field", "spare", "Acme.Tools.Cache.spare", "Acme.Tools.Cache`1.spare", 12, 12, 12, 1],
      ["constructor", "Cache", "Acme.Tools.Cache.Cache", "Acme.Tools.Cache`1.Cache()", 14, 14, 14, 1],
      ["destructor", "~Cache", "Acme.Tools.Cache.~Cache", "Acme.Tools.Cache`1.~Cache()", 16, 16, 16, 1],
      ["property", "Count", "Acme.Tools.Cache.Count", "Acme.Tools.Cache`1.Count", 18, 18, 18, 1],
      ["indexer", "this", "Acme.Tools.Cache.this", "Acme.Tools.Cache`1.this[string]", 20, 24, 20, 1],
      ["event", "Changed", "Acme.Tools.Cache.Changed", "Acme.Tools.Cache`1.Changed", 26, 26, 26, 1],
      ["event", "Cleared", "Acme.Tools.Cache.Cleared", "Acme.Tools.Cache`1.Cleared", 28, 32, 28, 1],
      ["method", "Get", "Acme.Tools.Cache.Get", "Acme.Tools.Cache`1.Get(ref int,out string)", 34, 38, 34, 1],
      ["method", "Get", "Acme.Tools.Cache.Get", "Acme.Tools.Cache`1.Get`1(ref int,out string)", 40, 44, 40, 1],
      ["method", "Get", "Acme.Tools.Cache.Get", "Acme.Tools.Cache`1.Get(int,out string)", 46, 51, 46, 1],
      ["operator", "operator+", "Acme.Tools.Cache.operator+", "Acme.Tools.Cache`1.operator+(Cache<T>,Cache<T>)", 53, 53, 53, 1],
      ["class", "Entry", "Acme.Tools.Cache.Entry", "Acme.Tools.Cache`1.Entry", 55, 58, 55, 1],
      ["property", "Key", "Acme.Tools.Cache.Entry.Key", "Acme.Tools.Cache`1.Entry.Key", 57, 57, 57, 1],
      ["interface", "IStore", "Acme.Tools.IStore", "Acme.Tools.IStore", 61, 64, 61, 1],
      ["method", "Put", "Acme.Tools.IStore.Put", "Acme.Tools.IStore.Put(string)", 63, 63, 63, 1],
      ["struct", "Slot", "Acme.Tools.Slot", "Acme.Tools.Slot", 66, 69, 66, 1],
      ["field", "Index", "Acme.Tools.Slot.Index", "Acme.Tools.Slot.Index", 68, 68, 68, 1],
      ["record", "Point", "Acme.Tools.Point", "Acme.Tools.Point", 71, 71, 71, 1],
      ["enum", "Mode", "Acme.Tools.Mode", "Acme.Tools.Mode", 73, 73, 73, 1],
      ["delegate", "Handler", "Acme.Tools.Handler", "Acme.Tools.Handler`1", 75, 75, 75, 1],
      ["namespace", "Inner", "Acme.Tools.Inner", "Acme.Tools.Inner", 77, 80, 77, 1],
      ["class", "Helper", "Acme.Tools.Inner.Helper", "Acme.Tools.Inner.Helper", 79, 79, 79, 1],
      ["namespace", "Acme.Money", "Acme.Money", "Acme.Money", 83, 90, 83, 1],
      ["struct", "Cents", "Acme.Money.Cents", "Acme.Money.Cents", 85, 89, 85, 1],
      ["operator", "operator long", "Acme.Money.Cents.operator long", "Acme.Money.Cents.operator long(Cents)", 87, 87, 87, 1],
      ["operator", "operator Cents", "Acme.Money.Cents.operator Cents", "Acme.Money.Cents.operator Cents(long)", 88, 88, 88, 1],
    ],
  },
  "Widget.A.cs": {
    lang: "csharp",
    rows: [
      ["namespace", "Acme.Parts", "Acme.Parts", "Acme.Parts", 2, 2, 1, 1],
      ["class", "Widget", "Acme.Parts.Widget", "Acme.Parts.Widget`1", 5, 12, 4, 1],
      ["property", "Size", "Acme.Parts.Widget.Size", "Acme.Parts.Widget`1.Size", 7, 7, 7, 1],
      ["declaration", "OnChanged", "Acme.Parts.Widget.OnChanged", "Acme.Parts.Widget`1.OnChanged(int)", 9, 9, 9, 1],
      ["declaration", "OnReset", "Acme.Parts.Widget.OnReset", "Acme.Parts.Widget`1.OnReset()", 11, 11, 11, 1],
      ["class", "Extensions", "Acme.Parts.Extensions", "Acme.Parts.Extensions", 14, 17, 14, 1],
      ["method", "Twice", "Acme.Parts.Extensions.Twice", "Acme.Parts.Extensions.Twice(this int)", 16, 16, 16, 1],
    ],
  },
  "Widget.B.cs": {
    lang: "csharp",
    rows: [
      ["namespace", "Acme.Parts", "Acme.Parts", "Acme.Parts", 2, 13, 1, 1],
      ["class", "Widget", "Acme.Parts.Widget", "Acme.Parts.Widget`1", 4, 12, 4, 1],
      ["method", "OnChanged", "Acme.Parts.Widget.OnChanged", "Acme.Parts.Widget`1.OnChanged(int)", 6, 9, 6, 1],
      ["method", "Render", "Acme.Parts.Widget.Render", "Acme.Parts.Widget`1.Render()", 11, 11, 11, 1],
    ],
  },
};

// The rows that are partial-type fragments; every other row must carry no `partial` key.
const PARTIAL = {
  "Widget.A.cs": ["Acme.Parts.Widget`1"],
  "Widget.B.cs": ["Acme.Parts.Widget`1"],
};

// §4.2's table, item by item, for this packet's languages: [file, kind, symbol_id].
const COVERAGE = {
  rust: {
    function: ["rows.rs", "function", "area"],
    "impl block": ["rows.rs", "impl", "impl Stack"],
    "trait impl block": ["rows.rs", "impl", "impl Container for Stack"],
    "impl function": ["rows.rs", "method", "Stack.push"],
    "impl const": ["rows.rs", "const", "Stack.DEPTH"],
    "impl type": ["rows.rs", "type", "Stack.Out"],
    struct: ["rows.rs", "struct", "Stack"],
    enum: ["rows.rs", "enum", "Shape"],
    union: ["rows.rs", "union", "Bits"],
    trait: ["rows.rs", "trait", "Container"],
    "trait method signature": ["rows.rs", "method", "Container.len"],
    "trait method with a body": ["rows.rs", "method", "Container.is_empty"],
    "trait const": ["rows.rs", "const", "Container.EMPTY"],
    "trait type": ["rows.rs", "type", "Container.Item"],
    "type alias": ["rows.rs", "type", "Pair"],
    const: ["rows.rs", "const", "LIMIT"],
    static: ["rows.rs", "static", "COUNTER"],
    module: ["rows.rs", "module", "geometry"],
    "macro_rules!": ["rows.rs", "macro", "square"],
  },
  c: {
    "function definition": ["rows.c", "function", "add"],
    "struct with a body": ["rows.c", "struct", "point"],
    "union with a body": ["rows.c", "union", "bits"],
    "enum with a body": ["rows.c", "enum", "color"],
    typedef: ["rows.c", "typedef", "size_type"],
    "top-level declaration with an initializer": ["rows.c", "variable", "counter"],
    "#define macro": ["rows.c", "macro", "LIMIT"],
    "#define function-like macro": ["rows.c", "macro", "SQUARE"],
  },
  cpp: {
    "function definition": ["rows.cpp", "function", "run()"],
    "struct with a body": ["rows.cpp", "struct", "geo.Point"],
    "union with a body": ["rows.cpp", "union", "Word"],
    "enum with a body": ["rows.cpp", "enum", "Level"],
    typedef: ["rows.cpp", "typedef", "geo.byte"],
    "top-level declaration with an initializer": ["rows.cpp", "variable", "total"],
    "#define macro": ["rows.cpp", "macro", "CHECK"],
    namespace: ["rows.cpp", "namespace", "geo"],
    "nested namespace": ["rows.cpp", "namespace", "geo.detail"],
    class: ["rows.cpp", "class", "geo.Buf"],
    "class member": ["rows.cpp", "field", "geo.Buf.size_"],
    "struct member": ["rows.cpp", "field", "geo.Point.x"],
    "function defined in a class": ["rows.cpp", "method", "geo.Buf.size() const"],
    "function defined out of class": ["rows.cpp", "method", "geo.Point.scale(double)"],
    constructor: ["rows.cpp", "constructor", "geo.Buf.Buf()"],
    destructor: ["rows.cpp", "destructor", "geo.Buf.~Buf()"],
    operator: ["rows.cpp", "operator", "geo.Buf.operator==(const Buf&) const"],
    "namespace-qualified function defined out of its namespace": ["rows.cpp", "function", "geo.detail.half(int)"],
    "member declaration": ["rows.cpp", "declaration", "geo.Buf.get(int)"],
    "namespace-level prototype": ["rows.cpp", "declaration", "run()"],
    "type alias (using)": ["rows.cpp", "type", "geo.Index"],
    "enum class": ["rows.cpp", "enum", "geo.Color"],
    concept: ["rows.cpp", "concept", "geo.Small"],
  },
  csharp: {
    "block namespace": ["Rows.cs", "namespace", "Acme.Tools"],
    "file-scoped namespace": ["Widget.A.cs", "namespace", "Acme.Parts"],
    class: ["Rows.cs", "class", "Acme.Tools.Cache`1"],
    struct: ["Rows.cs", "struct", "Acme.Tools.Slot"],
    interface: ["Rows.cs", "interface", "Acme.Tools.IStore"],
    record: ["Rows.cs", "record", "Acme.Tools.Point"],
    enum: ["Rows.cs", "enum", "Acme.Tools.Mode"],
    delegate: ["Rows.cs", "delegate", "Acme.Tools.Handler`1"],
    method: ["Rows.cs", "method", "Acme.Tools.Cache`1.Get(int,out string)"],
    constructor: ["Rows.cs", "constructor", "Acme.Tools.Cache`1.Cache()"],
    destructor: ["Rows.cs", "destructor", "Acme.Tools.Cache`1.~Cache()"],
    operator: ["Rows.cs", "operator", "Acme.Tools.Cache`1.operator+(Cache<T>,Cache<T>)"],
    "conversion operator": ["Rows.cs", "operator", "Acme.Money.Cents.operator long(Cents)"],
    indexer: ["Rows.cs", "indexer", "Acme.Tools.Cache`1.this[string]"],
    property: ["Rows.cs", "property", "Acme.Tools.Cache`1.Count"],
    "event with accessors": ["Rows.cs", "event", "Acme.Tools.Cache`1.Cleared"],
    "event field": ["Rows.cs", "event", "Acme.Tools.Cache`1.Changed"],
    field: ["Rows.cs", "field", "Acme.Tools.Cache`1.items"],
    constant: ["Rows.cs", "const", "Acme.Tools.Cache`1.Limit"],
    "partial method declaration": ["Widget.A.cs", "declaration", "Acme.Parts.Widget`1.OnChanged(int)"],
    "partial method implementation": ["Widget.B.cs", "method", "Acme.Parts.Widget`1.OnChanged(int)"],
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
  return symbols.map((s) => [s.kind, s.name, s.qname, s.symbol_id, s.start_line, s.end_line, s.doc_start_line, s.occurrence]);
}

function compareRows(label, got, want) {
  const g = got.map((row) => JSON.stringify(row));
  const w = want.map((row) => JSON.stringify(row));
  for (let i = 0; i < Math.max(g.length, w.length); i++) {
    if (g[i] !== w[i]) fail(`${label} row ${i + 1}: got ${g[i] ?? "nothing"}, expected ${w[i] ?? "nothing"}`);
  }
}

function checkInvariants(label, text, result, lang) {
  const buffer = Buffer.from(text, "utf8");
  check(result && typeof result === "object", `${label}: extract returned nothing`);
  check(result.lang === lang, `${label}: lang is ${result.lang}, expected ${lang}`);
  check(result.status !== "unsupported-language", `${label}: ${lang} is reported unsupported`);
  check(result.bytes === buffer.length, `${label}: bytes ${result.bytes}, expected ${buffer.length}`);
  check(result.lines === countLines(text), `${label}: lines ${result.lines}, expected ${countLines(text)}`);
  check(Array.isArray(result.symbols), `${label}: symbols is not a list`);
  const seen = new Map();
  result.symbols.forEach((s, index) => {
    const at = `${label} ${s.symbol_id}`;
    const keys = Object.keys(s).filter((key) => key !== "partial").sort();
    check(JSON.stringify(keys) === JSON.stringify([...ROW_KEYS].sort()), `${at}: row keys are ${Object.keys(s).join(",")}`);
    check(!("partial" in s) || s.partial === true, `${at}: partial is ${JSON.stringify(s.partial)}; a row carries it only as true`);
    check(s.ordinal === index + 1, `${at}: ordinal ${s.ordinal}, expected ${index + 1}`);
    const occurrence = (seen.get(s.symbol_id) ?? 0) + 1;
    seen.set(s.symbol_id, occurrence);
    check(s.occurrence === occurrence, `${at}: occurrence ${s.occurrence}, expected ${occurrence}`);
    check(s.doc_start_line >= 1 && s.doc_start_line <= s.start_line && s.start_line <= s.end_line, `${at}: lines ${s.doc_start_line}/${s.start_line}-${s.end_line} are out of order`);
    check(Number.isInteger(s.start_byte) && s.start_byte >= 0 && s.end_byte > s.start_byte && s.end_byte <= buffer.length, `${at}: bytes ${s.start_byte}-${s.end_byte} are out of range`);
    const span = buffer.subarray(s.start_byte, s.end_byte);
    check(lineOfByte(buffer, s.start_byte) === s.doc_start_line, `${at}: start_byte is not on doc_start_line`);
    check(lineOfByte(buffer, s.end_byte - 1) === s.end_line, `${at}: end_byte is not on end_line`);
    check(!/[\r\n]$/.test(span.toString("utf8")), `${at}: the span ends with a line break`);
    check(s.span_sha256 === sha256(span), `${at}: span_sha256 is not the sha256 of the citeable span`);
    check(typeof s.signature === "string" && Buffer.byteLength(s.signature) <= 200, `${at}: signature over 200 bytes`);
    check(typeof s.doc === "string" && Buffer.byteLength(s.doc) <= 2000, `${at}: doc over 2,000 bytes`);
  });
}

async function extractText(mod, label, text, lang, options) {
  let result;
  try {
    result = await mod.extract(text, lang, options);
  } catch (error) {
    fail(`extract(${label}, ${lang}) threw: ${String(error?.message ?? error).slice(0, 200)}`);
  }
  checkInvariants(label, text, result, lang);
  return result;
}

function extractFixture(mod, name, text = fixture(name)) {
  return extractText(mod, name, text, GOLDEN[name].lang);
}

function spanText(text, s) {
  return Buffer.from(text, "utf8").subarray(s.start_byte, s.end_byte).toString("utf8");
}

// The innermost definition whose citeable span holds `needle`.
function bySpanText(text, result, needle, label) {
  const hits = result.symbols.filter((s) => spanText(text, s).includes(needle));
  hits.sort((a, b) => a.end_byte - a.start_byte - (b.end_byte - b.start_byte));
  if (hits.length === 0) fail(`${label}: no definition contains ${JSON.stringify(needle)}`);
  return hits[0];
}

function idList(result) {
  return result.symbols.map((s) => `${s.symbol_id}#${s.kind}`).sort();
}

// ---------------------------------------------------------------------------------------

function checkLanguages(mod) {
  const table = [
    ["src/lib.rs", "rust"],
    ["src/main.c", "c"],
    ["include/buf.h", "cpp"],
    ["src/buf.cc", "cpp"],
    ["src/buf.cpp", "cpp"],
    ["src/buf.cxx", "cpp"],
    ["include/buf.hpp", "cpp"],
    ["include/buf.hh", "cpp"],
    ["include/buf.hxx", "cpp"],
    ["Acme/Rows.cs", "csharp"],
    ["src/a.ts", "typescript"],
    ["notes.rst", null],
    ["a.csproj", null],
  ];
  for (const [path, want] of table) {
    const got = mod.languageForPath(path);
    check(got === want, `languageForPath(${path}) is ${got}, expected ${want}`);
  }
}

async function checkGolden(mod) {
  const results = {};
  for (const [name, spec] of Object.entries(GOLDEN)) {
    const result = await extractFixture(mod, name);
    check(result.status === "ok", `${name}: status ${result.status}, expected ok`);
    check(result.parse_errors === 0, `${name}: parse_errors ${result.parse_errors}`);
    compareRows(name, golden(result.symbols), spec.rows);
    const partial = result.symbols.filter((s) => s.partial === true).map((s) => s.symbol_id);
    check(JSON.stringify(partial) === JSON.stringify(PARTIAL[name] ?? []), `${name}: partial fragments are ${JSON.stringify(partial)}, expected ${JSON.stringify(PARTIAL[name] ?? [])}`);
    results[name] = result;
  }
  for (const [lang, items] of Object.entries(COVERAGE)) {
    for (const [item, [name, kind, symbolId]] of Object.entries(items)) {
      check(GOLDEN[name].lang === lang, `coverage of ${lang} names ${name}, a ${GOLDEN[name].lang} fixture`);
      check(
        GOLDEN[name].rows.some((row) => row[0] === kind && row[3] === symbolId),
        `${lang}: the golden table does not cover §4.2's "${item}"`,
      );
    }
  }
  return results;
}

function checkDetails(results) {
  const find = (name, symbolId, occurrence = 1) => {
    const hit = results[name].symbols.find((s) => s.symbol_id === symbolId && s.occurrence === occurrence);
    if (!hit) fail(`${name}: no ${symbolId} occurrence ${occurrence}`);
    return hit;
  };
  const expectSpan = (name, symbolId, prefix, suffix, occurrence = 1) => {
    const got = spanText(fixture(name), find(name, symbolId, occurrence));
    check(got.startsWith(prefix), `${name} ${symbolId}: the span starts ${JSON.stringify(got.slice(0, 70))}, expected ${JSON.stringify(prefix.slice(0, 70))}`);
    check(got.endsWith(suffix), `${name} ${symbolId}: the span ends ${JSON.stringify(got.slice(-50))}, expected ${JSON.stringify(suffix)}`);
  };
  const expectField = (name, symbolId, field, want, occurrence = 1) => {
    const got = find(name, symbolId, occurrence)[field];
    check(got === want, `${name} ${symbolId}.${field} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  };

  // Citeable spans: leading comments, attributes and template lines, through the body's end.
  expectSpan("rows.rs", "Stack", "/// A stack of items.\n#[derive(Debug, Clone)]\npub struct Stack<T> {", "items: Vec<T>,\n}");
  expectSpan("rows.rs", "square", "#[macro_export]\nmacro_rules! square {", "    };\n}");
  expectSpan("rows.rs", "impl Stack", "impl<T> Stack<T> {", "self.items.len()\n    }\n}");
  expectSpan("rows.c", "LIMIT", "/* The largest buffer. */\n#define LIMIT 64", "#define LIMIT 64");
  expectSpan("rows.c", "add", "/* Adds two numbers. */\nstatic int add(int a, int b)\n{", "return a + b;\n}");
  expectSpan("rows.c", "point", "/* A point in the plane. */\nstruct point {", "int y;\n}");
  expectSpan("rows.cpp", "geo.Buf", "/// A buffer of values.\ntemplate <typename T>\nclass Buf {", "int at;\n    };\n}");
  expectSpan("rows.cpp", "geo.make<2>(int)", "template <typename T, typename U>\nT make(int seed) {", "return T(seed);\n}");
  expectSpan("rows.cpp", "geo.Buf.get() const", "template <typename T>\nconst T& geo::Buf<T>::get() const {", "return data_[0];\n}", 2);
  expectSpan("rows.cpp", "geo.Buf.get() const", "const T& get() const;", "const T& get() const;");
  expectSpan("rows.cpp", "geo.Buf.Cursor", "struct Cursor {", "int at;\n    };");
  expectSpan("Rows.cs", "Acme.Tools.Cache`1", "/// <summary>A cache of values.</summary>\n    [Serializable]\n    public class Cache<T>", "Key { get; set; }\n        }\n    }");
  expectSpan("Rows.cs", "Acme.Tools.Cache`1.this[string]", "public T this[string key]", "set { items[key] = value; }\n        }");
  expectSpan("Rows.cs", "Acme.Tools.Cache`1.Cleared", "public event EventHandler Cleared", "remove { Changed -= value; }\n        }");

  expectField("rows.rs", "Stack.push", "doc", "/// Pushes one item.");
  expectField("rows.rs", "Stack", "doc", "/// A stack of items.");
  expectField("rows.rs", "Stack.push", "signature", "pub fn push(&mut self, item: T) {");
  expectField("rows.c", "add", "doc", "/* Adds two numbers. */");
  expectField("rows.c", "add", "signature", "static int add(int a, int b)");
  expectField("rows.cpp", "geo.Buf", "doc", "/// A buffer of values.");
  expectField("rows.cpp", "geo.Buf", "signature", "class Buf {");
  expectField("rows.cpp", "geo.make<1>(int)", "doc", "// Makes one value.");
  expectField("Rows.cs", "Acme.Tools.Cache`1", "doc", "/// <summary>A cache of values.</summary>");
  expectField("Rows.cs", "Acme.Tools.Cache`1", "signature", "public class Cache<T>");

  // Rust: inherent and trait-impl items of one name are two ids; every fn appears once.
  const rust = results["rows.rs"];
  const lens = rust.symbols.filter((s) => s.name === "len").map((s) => s.symbol_id);
  check(JSON.stringify(lens) === JSON.stringify(["Container.len", "Stack.len", "<Stack as Container>.len"]), `rows.rs: the len definitions are ${lens.join(", ")}`);
  const fns = (fixture("rows.rs").match(/\bfn \w+/g) ?? []).length;
  const fnRows = rust.symbols.filter((s) => s.kind === "method" || s.kind === "function").length;
  check(fnRows === fns, `rows.rs: ${fnRows} function and method rows for ${fns} fn items; a method appears more or less than once`);
  const extents = rust.symbols.map((s) => `${s.start_byte}-${s.end_byte}`);
  check(new Set(extents).size === extents.length, "rows.rs: two rows share one declaration (a duplicate capture did not collapse)");
  const refs = rust.refs.map((r) => `${r.name}:${r.kind}:${r.line}`);
  check(refs.includes("push:call:42"), `rows.rs: references lack push:call:42 (${refs.slice(0, 6).join(" ")})`);

  // C: prototypes, extern declarations and locals are not definitions.
  const c = results["rows.c"].symbols.map((s) => s.name);
  for (const name of ["scale", "shared", "calls", "seen", "x", "next"]) check(!c.includes(name), `rows.c: ${name} is reported as a definition`);

  // C++: overloads by const, ref-qualifier and template arity are distinct ids; a prototype
  // and its definition share one.
  const cpp = results["rows.cpp"].symbols;
  const gets = cpp.filter((s) => s.qname === "geo.Buf.get" && s.occurrence === 1).map((s) => s.symbol_id);
  check(new Set(gets).size === 4, `rows.cpp: the get overloads have ${new Set(gets).size} distinct ids, expected 4`);
  for (const [id, kinds] of [
    ["run()", ["declaration", "function"]],
    ["geo.Buf.get() const", ["declaration", "method"]],
    ["geo.Buf.Buf()", ["declaration", "constructor"]],
    ["geo.Buf.~Buf()", ["declaration", "destructor"]],
  ]) {
    const got = cpp.filter((s) => s.symbol_id === id).map((s) => s.kind);
    check(JSON.stringify(got) === JSON.stringify(kinds), `rows.cpp: ${id} is ${got.join(", ")}, expected ${kinds.join(", ")}`);
  }

  // C#: a local function is not a definition.
  check(!results["Rows.cs"].symbols.some((s) => s.name === "Local"), "Rows.cs: the local function Local is reported as a definition");
}

async function checkPartials(mod, results) {
  const a = results["Widget.A.cs"].symbols;
  const b = results["Widget.B.cs"].symbols;
  const widgetA = a.find((s) => s.symbol_id === "Acme.Parts.Widget`1");
  const widgetB = b.find((s) => s.symbol_id === "Acme.Parts.Widget`1");
  check(widgetA?.partial === true && widgetB?.partial === true, "Widget.A.cs and Widget.B.cs: the partial class halves are not both marked partial");
  check(widgetA.span_sha256 !== widgetB.span_sha256, "the two partial class fragments have one span");
  check(spanText(fixture("Widget.A.cs"), widgetA).includes("partial void OnChanged(int value);"), "Widget.A.cs: the fragment does not hold its own members");
  check(!spanText(fixture("Widget.A.cs"), widgetA).includes("Render"), "Widget.A.cs: the fragment holds the other file's members");
  const declared = a.find((s) => s.name === "OnChanged");
  const implemented = b.find((s) => s.name === "OnChanged");
  check(declared?.kind === "declaration" && implemented?.kind === "method", "the partial method's halves are not a declaration and a method");
  check(declared.symbol_id === implemented.symbol_id, `the partial method's halves have ids ${declared.symbol_id} and ${implemented.symbol_id}`);

  // Both halves in one file: two occurrences of the class and of the method.
  const one = [
    "namespace Acme.Parts;",
    "",
    "public partial class Widget<T>",
    "{",
    "    partial void OnChanged(int value);",
    "}",
    "",
    "public partial class Widget<T>",
    "{",
    "    partial void OnChanged(int value)",
    "    {",
    "    }",
    "}",
    "",
  ].join("\n");
  const result = await extractText(mod, "one-file partial", one, "csharp");
  compareRows("one-file partial", golden(result.symbols), [
    ["namespace", "Acme.Parts", "Acme.Parts", "Acme.Parts", 1, 1, 1, 1],
    ["class", "Widget", "Acme.Parts.Widget", "Acme.Parts.Widget`1", 3, 6, 3, 1],
    ["declaration", "OnChanged", "Acme.Parts.Widget.OnChanged", "Acme.Parts.Widget`1.OnChanged(int)", 5, 5, 5, 1],
    ["class", "Widget", "Acme.Parts.Widget", "Acme.Parts.Widget`1", 8, 13, 8, 2],
    ["method", "OnChanged", "Acme.Parts.Widget.OnChanged", "Acme.Parts.Widget`1.OnChanged(int)", 10, 12, 10, 2],
  ]);
}

async function checkDefaults(mod) {
  const cs = await extractText(mod, "C# defaults", "class D {\n  void M([In] ref int a, string b = \"x,y\", params int[] rest) { }\n}\n", "csharp");
  const m = cs.symbols.find((s) => s.name === "M");
  check(m?.symbol_id === "D.M(ref int,string,params int[])", `C# defaults: M's id is ${m?.symbol_id}, expected D.M(ref int,string,params int[])`);
  const cpp = await extractText(mod, "C++ defaults", "struct D {\n  void m(const char* s = \"a,b\", int (*cb)(int) = nullptr) const;\n};\n", "cpp");
  const mm = cpp.symbols.find((s) => s.name === "m");
  check(mm?.symbol_id === "D.m(const char*,int(*)(int)) const", `C++ defaults: m's id is ${mm?.symbol_id}, expected D.m(const char*,int(*)(int)) const`);
}

async function checkHashEdits(mod) {
  // [file, target symbol_id, occurrence, from, to, what]
  const cases = [
    ["rows.rs", "Stack.push", 1, "self.items.push(item);", "self.items.insert(0, item);", "body"],
    ["rows.rs", "area", 1, "3.14 * r * r", "3.1416 * r * r", "body"],
    ["rows.rs", "Stack.push", 1, "/// Pushes one item.", "/// Pushes an item.", "leading comment"],
    ["rows.rs", "Stack", 1, "#[derive(Debug, Clone)]", "#[derive(Debug)]", "attribute"],
    ["rows.c", "add", 1, "return a + b;", "return a - b;", "body"],
    ["rows.c", "point", 1, "    int y;", "    long y;", "body"],
    ["rows.c", "main", 1, "return 0;", "return 1;", "body"],
    ["rows.c", "add", 1, "/* Adds two numbers. */", "/* Adds two integers. */", "leading comment"],
    ["rows.c", "LIMIT", 1, "#define LIMIT 64", "#define LIMIT 65", "body"],
    ["rows.cpp", "geo.make<2>(int)", 1, "return T(seed);", "return T(seed + 1);", "body"],
    ["rows.cpp", "geo.Buf.~Buf()", 2, "delete[] data_;", "delete data_;", "body"],
    ["rows.cpp", "geo.Buf.size() const", 1, "return size_; }", "return size_ + 0; }", "body"],
    ["rows.cpp", "geo.Point.scale(double)", 1, "x *= k;", "x *= 2 * k;", "body"],
    ["rows.cpp", "geo.Buf", 1, "/// A buffer of values.", "/// A buffer of items.", "leading comment"],
    ["rows.cpp", "run()", 2, "twice(total)", "twice(total + 1)", "body"],
    ["Rows.cs", "Acme.Tools.Cache`1.Get(ref int,out string)", 1, "return true;", "return !false;", "body"],
    ["Rows.cs", "Acme.Tools.Cache`1.this[string]", 1, "get { return items[key]; }", "get { return items[key + \"\"]; }", "accessor"],
    ["Rows.cs", "Acme.Tools.Cache`1.Cleared", 1, "remove { Changed -= value; }", "remove { }", "accessor"],
    ["Rows.cs", "Acme.Tools.Cache`1", 1, "/// <summary>A cache of values.</summary>", "/// <summary>A cache.</summary>", "leading comment"],
    ["Widget.B.cs", "Acme.Parts.Widget`1.OnChanged(int)", 1, "Size = value;", "Size = value + 1;", "body"],
  ];
  for (const [name, target, occurrence, from, to, what] of cases) {
    const text = fixture(name);
    const before = await extractFixture(mod, name);
    const after = await extractFixture(mod, name, once(text, from, to, name));
    const key = (s) => `${s.symbol_id}#${s.occurrence}`;
    const touched = new Set(before.symbols.filter((s) => spanText(text, s).includes(from)).map(key));
    check(touched.has(`${target}#${occurrence}`), `${name}: ${target}'s span does not hold the ${what}`);
    for (const s of before.symbols) {
      const other = after.symbols.find((a) => key(a) === key(s));
      check(other, `${name}: ${key(s)} vanished after a ${what} edit`);
      if (touched.has(key(s))) {
        check(other.span_sha256 !== s.span_sha256, `${name}: a ${what} edit did not change ${key(s)}'s span_sha256`);
      } else {
        check(other.span_sha256 === s.span_sha256, `${name}: a ${what} edit to ${target} changed ${key(s)}'s span_sha256`);
      }
    }
  }
}

async function checkReordering(mod) {
  // [file, reorderings as [from, to] pairs applied in turn, needle → [symbol_id, kind]]
  const rs = fixture("rows.rs");
  const inherent = rs.slice(rs.indexOf("impl<T> Stack<T> {"), rs.indexOf("impl<T> Container for Stack<T> {"));
  const traitImpl = rs.slice(rs.indexOf("impl<T> Container for Stack<T> {"), rs.indexOf("impl<T: fmt::Debug>"));
  const push = "    /// Pushes one item.\n    pub fn push(&mut self, item: T) {\n        self.items.push(item);\n    }\n\n";
  const len = "    pub fn len(&self) -> usize {\n        self.items.len()\n    }\n";
  const cpp = fixture("rows.cpp");
  const gets = "    T& get() &;\n    T&& get() &&;\n    const T& get() const;\n    T& get(int index);\n";
  const makeDecl = "// Makes one value.\ntemplate <typename T>\nT make(int seed);\n";
  const makeDef = "template <typename T, typename U>\nT make(int seed) {\n    return T(seed);\n}\n";
  const cs = fixture("Rows.cs");
  const get1 = cs.slice(cs.indexOf("        public bool Get(ref int index"), cs.indexOf("        public bool Get<TKey>"));
  const get2 = cs.slice(cs.indexOf("        public bool Get<TKey>"), cs.indexOf("        public bool Get(int index"));
  const get3 = cs.slice(cs.indexOf("        public bool Get(int index"), cs.indexOf("        public static Cache<T> operator"));
  const c = fixture("rows.c");
  const add = c.slice(c.indexOf("/* Adds two numbers. */"), c.indexOf("char *name_of"));
  const cases = [
    [
      "rows.rs",
      [
        [inherent + traitImpl, traitImpl + inherent],
        [push + len, `${len}\n${push}`],
      ],
      [
        ["self.items.push(item)", "Stack.push", "method"],
        ["pub fn len(&self) -> usize {\n        self.items.len()\n", "Stack.len", "method"],
        ["self.items.len() + 0", "<Stack as Container>.len", "method"],
        ["type Item = T;", "<Stack as Container>.Item", "type"],
        ["pub const DEPTH", "Stack.DEPTH", "const"],
      ],
    ],
    [
      "rows.c",
      [[add, ""], ["int main(void)", `${add}int main(void)`]],
      [
        ["return a + b;", "add", "function"],
        ["calls += seen.n;", "name_of", "function"],
      ],
    ],
    [
      "rows.cpp",
      [
        [gets, "    T& get(int index);\n    const T& get() const;\n    T&& get() &&;\n    T& get() &;\n"],
        [`${makeDecl}\n${makeDef}`, `${makeDef}\n${makeDecl}`],
      ],
      [
        ["T& get() &;", "geo.Buf.get() &", "declaration"],
        ["T&& get() &&;", "geo.Buf.get() &&", "declaration"],
        ["const T& get() const;", "geo.Buf.get() const", "declaration"],
        ["T& get(int index);", "geo.Buf.get(int)", "declaration"],
        ["return T(seed);", "geo.make<2>(int)", "function"],
        ["T make(int seed);", "geo.make<1>(int)", "declaration"],
        ["return data_[0];", "geo.Buf.get() const", "method"],
      ],
    ],
    [
      "Rows.cs",
      [[get1 + get2 + get3, get3 + get1 + get2]],
      [
        ["return true;", "Acme.Tools.Cache`1.Get(ref int,out string)", "method"],
        ["return false;", "Acme.Tools.Cache`1.Get`1(ref int,out string)", "method"],
        ["index.ToString()", "Acme.Tools.Cache`1.Get(int,out string)", "method"],
      ],
    ],
  ];
  for (const [name, swaps, needles] of cases) {
    const base = await extractFixture(mod, name);
    let text = fixture(name);
    for (const [from, to] of swaps) text = once(text, from, to, `${name} reordering`);
    check(text !== fixture(name) && text.length === fixture(name).length + swaps.reduce((n, [f, t]) => n + t.length - f.length, 0), `${name}: the reordering did not apply`);
    const result = await extractFixture(mod, name, text);
    check(JSON.stringify(idList(result)) === JSON.stringify(idList(base)), `${name} reordered: the symbol_ids changed (${idList(result).filter((id) => !idList(base).includes(id)).join(", ")})`);
    for (const [needle, id, kind] of needles) {
      const s = bySpanText(text, result, needle, `${name} reordered`);
      check(s.symbol_id === id && s.kind === kind, `${name} reordered: the definition holding ${JSON.stringify(needle)} is ${s.symbol_id} (${s.kind}), expected ${id} (${kind})`);
    }
  }
}

async function checkCrlfAndDeterminism(mod) {
  for (const [name, spec] of Object.entries(GOLDEN)) {
    const lf = await extractFixture(mod, name);
    const again = await extractFixture(mod, name);
    check(JSON.stringify(again) === JSON.stringify(lf), `${name}: a second run gave different output`);
    const crlf = await extractFixture(mod, name, fixture(name).replace(/\n/g, "\r\n"));
    compareRows(`${name} CRLF`, golden(crlf.symbols), spec.rows);
  }
}

async function checkPackageRoot(mod) {
  for (const lang of ["rust", "c", "cpp", "csharp"]) {
    check(existsSync(join(here, "queries", `${lang}.scm`)), `queries/${lang}.scm is missing`);
  }
  const roots = [];
  const copyRoot = (change) => {
    const root = mkdtempSync(join(tmpdir(), "amanuensis-si3-root-"));
    roots.push(root);
    cpSync(join(here, "queries"), join(root, "queries"), { recursive: true });
    cpSync(join(here, "grammars"), join(root, "grammars"), { recursive: true });
    change?.(root);
    return root;
  };
  try {
    // Definitions come from queries/<lang>.scm, never from the grammar's tags.scm.
    for (const [lang, name] of [
      ["rust", "rows.rs"],
      ["csharp", "Rows.cs"],
      ["cpp", "rows.cpp"],
      ["c", "rows.c"],
    ]) {
      const empty = copyRoot((root) => writeFileSync(join(root, "queries", `${lang}.scm`), ""));
      const result = await mod.extract(fixture(name), lang, { packageRoot: empty });
      check(result.symbols.length === 0, `an empty queries/${lang}.scm still yields definitions (they come from elsewhere)`);
      const missing = copyRoot((root) => rmSync(join(root, "queries", `${lang}.scm`)));
      let refused = null;
      try {
        await mod.extract(fixture(name), lang, { packageRoot: missing });
      } catch (error) {
        refused = String(error?.message ?? error);
      }
      check(refused !== null && refused.includes(`${lang}.scm`), `a missing queries/${lang}.scm was not refused by name`);
    }
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
}

const CRASH = /Cannot find module|MODULE_NOT_FOUND|ModuleNotFoundError|SyntaxError|No such file or directory|ENOENT|ImportError|ReferenceError|is not defined|command not found|Traceback/g;

async function main() {
  const mod = await loadExtractor();
  checkLanguages(mod);
  const results = await checkGolden(mod);
  checkDetails(results);
  await checkPartials(mod, results);
  await checkDefaults(mod);
  await checkHashEdits(mod);
  await checkReordering(mod);
  await checkCrlfAndDeterminism(mod);
  await checkPackageRoot(mod);
}

try {
  await main();
  console.log("GATE SI3 GREEN");
} catch (error) {
  const reason = error instanceof GateFailure ? error.message : `unexpected error: ${String(error?.message ?? error)}`;
  console.log(`GATE SI3 RED: ${reason.replace(/\s+/g, " ").replace(CRASH, "[error]").slice(0, 400)}`);
  process.exit(1);
}
