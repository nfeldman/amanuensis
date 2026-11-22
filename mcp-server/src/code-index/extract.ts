// The code index's extractor (PLAN §4.2): blob text and a language in, a deterministic
// definition table out.
//
// Definitions come from the index's own queries, queries/<lang>.scm, which `tsc` does not
// copy and which ship through package.json `files`; they are read relative to the package
// root, as grammars/ is. A grammar's tags.scm serves references only. Every grammar file is
// checked against grammars/manifest.json when it is loaded, and one whose bytes differ is
// refused.
//
// Identity: `qname` is the chain of enclosing definitions; a Go method is
// `<Receiver>.<name>`. `symbol_id` is the qname plus, for a Java method or constructor, its
// parameter types as written, so overloads differ. It has no positional part: two
// definitions in one file that share a symbol_id are occurrences 1, 2, … in file order.
//
// Spans: start_line and end_line are the declaration node's. The citeable span starts
// earlier, at `doc_start_line`, over contiguous leading comments and through wrappers
// (`export`, `declare`, Python decorators); start_byte and end_byte bound it in UTF-8 bytes
// and span_sha256 hashes exactly those bytes, so a comment edit is a change. Lines are
// counted by `\n`, as requireEvidenceCitation counts them, so a CRLF file numbers its lines
// as git does.
//
// A file with a syntax error is `parse-partial`: a definition whose declaration holds an
// error is left out, and every intact one is reported as if the file had parsed.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, type Node, Parser, Query } from "web-tree-sitter";

/** Bump when a change to this file changes any extraction. */
export const EXTRACTOR_VERSION = "1";

export type CodeLanguage = "typescript" | "tsx" | "javascript" | "python" | "go" | "java";

export type ExtractionStatus = "ok" | "parse-partial" | "unsupported-language";

export interface SymbolRow {
  ordinal: number;
  symbol_id: string;
  name: string;
  qname: string;
  kind: string;
  start_line: number;
  end_line: number;
  occurrence: number;
  doc_start_line: number;
  start_byte: number;
  end_byte: number;
  signature: string;
  doc: string;
  span_sha256: string;
}

export interface RefRow {
  name: string;
  kind: string;
  line: number;
}

export interface ImportRow {
  specifier: string;
  line: number;
}

export interface Extraction {
  extractor_id: string;
  lang: string;
  status: ExtractionStatus;
  bytes: number;
  lines: number;
  parse_errors: number;
  symbols: SymbolRow[];
  refs: RefRow[];
  imports: ImportRow[];
}

export interface ExtractOptions {
  /** The directory holding grammars/ and queries/; defaults to this package's root. */
  packageRoot?: string;
}

const SIGNATURE_BYTES = 200;
const DOC_BYTES = 2000;
const GRAMMAR_FILES = ["grammar.wasm", "tags.scm", "LICENSE"];

interface LanguageSpec {
  /** The definition query under queries/. */
  query: string;
  /** Grammars whose tags.scm give references, concatenated. */
  tags: string[];
  /** Node types whose text is a comment. */
  comments: string[];
  /** The wrapper a definition's citeable span extends through, if any. */
  wrapper(node: Node): Node | null;
  /** The node a definition spans, from the node its query captured. */
  span(node: Node): Node;
  /** The qualifier that replaces the enclosing chain (a Go receiver), if any. */
  receiver(node: Node): string | null;
  /** The overload discriminator appended to the qname, if any. */
  discriminator(node: Node, kind: string): string;
  /** A docstring inside the definition, preferred to leading comments. */
  docstring(node: Node): string | null;
  /** An import capture's specifier. */
  specifier(node: Node): string;
}

const none = () => null;
const self = (node: Node) => node;
const empty = () => "";
const text = (node: Node) => node.text;

function parentIf(node: Node, types: string[]): Node | null {
  const parent = node.parent;
  return parent && types.includes(parent.type) ? parent : null;
}

const ecmascript = {
  comments: ["comment"],
  wrapper: (node: Node) =>
    parentIf(node, ["export_statement", "ambient_declaration"]) ??
    (node.type === "internal_module" ? parentIf(node, ["expression_statement"]) : null),
  span: self,
  receiver: none,
  discriminator: empty,
  docstring: none,
  specifier: text,
};

// Go: a spec in an unparenthesized declaration is cited as the whole declaration.
function goSpan(node: Node): Node {
  const parent = node.parent;
  if (
    parent &&
    ["type_declaration", "const_declaration", "var_declaration"].includes(parent.type) &&
    !parent.children.some((child) => child?.type === "(")
  ) {
    return parent;
  }
  return node;
}

// Go: `func (s *List[T]) Push` is List.Push.
function goReceiver(node: Node): string | null {
  if (node.type !== "method_declaration") return null;
  const parameter = node
    .childForFieldName("receiver")
    ?.namedChildren.find((child) => child?.type === "parameter_declaration");
  const type = parameter?.childForFieldName("type")?.text ?? "";
  const name = type.replace(/[\s()*]/g, "").replace(/\[.*$/, "");
  return name || null;
}

// Java: parameter types as written, whitespace removed: `parse(Map<String,T>,String...)`.
function javaDiscriminator(node: Node, kind: string): string {
  if (kind !== "method" && kind !== "constructor") return "";
  let parameters = node.childForFieldName("parameters");
  if (node.type === "compact_constructor_declaration") {
    parameters = node.parent?.parent?.childForFieldName("parameters") ?? null;
  }
  const types: string[] = [];
  for (const parameter of parameters?.namedChildren ?? []) {
    if (!parameter) continue;
    if (parameter.type === "formal_parameter") {
      const type = parameter.childForFieldName("type")?.text ?? "";
      const dimensions = parameter.childForFieldName("dimensions")?.text ?? "";
      types.push(`${type}${dimensions}`);
    } else if (parameter.type === "spread_parameter") {
      types.push(
        parameter.children
          .filter((child) => child && !["modifiers", "variable_declarator"].includes(child.type))
          .map((child) => child?.text ?? "")
          .join(""),
      );
    }
  }
  return `(${types.map((type) => type.replace(/\s+/g, "")).join(",")})`;
}

// Python: the first statement of a function's or class's body, when it is a string.
function pythonDocstring(node: Node): string | null {
  const first = node.childForFieldName("body")?.namedChildren[0];
  const string = first?.type === "expression_statement" ? first.namedChildren[0] : null;
  if (!string || string.type !== "string") return null;
  const start = string.children.find((child) => child?.type === "string_start");
  const end = string.children.find((child) => child?.type === "string_end");
  if (!start || !end) return null;
  return string.text.slice(start.endIndex - string.startIndex, end.startIndex - string.startIndex);
}

const LANGUAGES: Record<CodeLanguage, LanguageSpec> = {
  typescript: { query: "typescript.scm", tags: ["javascript", "typescript"], ...ecmascript },
  tsx: { query: "typescript.scm", tags: ["javascript", "tsx"], ...ecmascript },
  javascript: { query: "javascript.scm", tags: ["javascript"], ...ecmascript },
  python: {
    query: "python.scm",
    tags: ["python"],
    comments: ["comment"],
    wrapper: (node) => parentIf(node, ["decorated_definition", "expression_statement"]),
    span: self,
    receiver: none,
    discriminator: empty,
    docstring: (node) =>
      node.type === "function_definition" || node.type === "class_definition"
        ? pythonDocstring(node)
        : null,
    specifier: text,
  },
  go: {
    query: "go.scm",
    tags: ["go"],
    comments: ["comment"],
    wrapper: none,
    span: goSpan,
    receiver: goReceiver,
    discriminator: empty,
    docstring: none,
    specifier: text,
  },
  java: {
    query: "java.scm",
    tags: ["java"],
    comments: ["line_comment", "block_comment"],
    wrapper: none,
    span: self,
    receiver: none,
    discriminator: javaDiscriminator,
    docstring: none,
    specifier: (node) =>
      node.text
        .replace(/^import\s+(static\s+)?/, "")
        .replace(/;\s*$/, "")
        .replace(/\s+/g, ""),
  },
};

const EXTENSIONS: Record<string, CodeLanguage> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".java": "java",
};

/** The language a tree entry's path is parsed as, or null when it is not supported. */
export function languageForPath(path: string): CodeLanguage | null {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  return EXTENSIONS[base.slice(dot).toLowerCase()] ?? null;
}

function isCodeLanguage(lang: string): lang is CodeLanguage {
  return Object.hasOwn(LANGUAGES, lang);
}

// ---------------------------------------------------------------------------------------
// Package root, manifest and generation

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface Manifest {
  grammars: Record<string, { files?: Record<string, { sha256: string; size: number }> }>;
}

interface Loaded {
  parser: Parser;
  definitions: Query;
  references: Query;
}

interface Generation {
  root: string;
  extractorId: string;
  manifest: Manifest;
  languages: Map<CodeLanguage, Promise<Loaded>>;
}

const generations = new Map<string, Generation>();

function generation(options?: ExtractOptions): Generation {
  const root = resolve(options?.packageRoot ?? defaultRoot);
  const known = generations.get(root);
  if (known) return known;
  const manifestPath = join(root, "grammars", "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `grammar manifest grammars/manifest.json is missing from ${root}; run scripts/vendor-grammars.mjs`,
    );
  }
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Manifest;
  if (!manifest || typeof manifest.grammars !== "object" || manifest.grammars === null) {
    throw new Error(`grammar manifest under ${root} is unreadable`);
  }
  const queriesDir = join(root, "queries");
  if (!existsSync(queriesDir))
    throw new Error(`definition queries queries/ are missing from ${root}`);
  // The generation: this extractor's version, every definition query, and the manifest,
  // which carries the sha256 of every grammar and tags.scm.
  const hash = createHash("sha256").update(`amanuensis-code-index\0${EXTRACTOR_VERSION}\0`);
  for (const name of readdirSync(queriesDir)
    .filter((n) => n.endsWith(".scm"))
    .sort()) {
    hash
      .update(`queries/${name}\0`)
      .update(readFileSync(join(queriesDir, name)))
      .update("\0");
  }
  hash.update("grammars/manifest.json\0").update(manifestBytes);
  const made: Generation = {
    root,
    extractorId: hash.digest("hex"),
    manifest,
    languages: new Map(),
  };
  generations.set(root, made);
  return made;
}

/**
 * The extractor generation: sha256 of the extractor version, the definition queries and
 * the grammar manifest. Read once per package root and process.
 */
export function extractorId(options?: ExtractOptions): string {
  return generation(options).extractorId;
}

// The bytes of grammars/<language>/<file>, only if they match the manifest.
function verifiedGrammarFile(gen: Generation, language: string, file: string): Buffer {
  const entry = Object.hasOwn(gen.manifest.grammars, language)
    ? gen.manifest.grammars[language]
    : undefined;
  const want = entry && GRAMMAR_FILES.includes(file) ? entry.files?.[file] : undefined;
  if (!want) throw new Error(`grammar ${language}/${file} is not in the manifest`);
  const path = join(gen.root, "grammars", language, file);
  if (!existsSync(path)) throw new Error(`grammar file grammars/${language}/${file} is missing`);
  const bytes = readFileSync(path);
  if (bytes.length !== want.size) {
    throw new Error(
      `grammar ${language}/${file} is ${bytes.length} bytes; the manifest records size ${want.size}`,
    );
  }
  const got = sha256(bytes);
  if (got !== want.sha256) {
    throw new Error(
      `grammar ${language}/${file} sha256 ${got} differs from the manifest's ${want.sha256}`,
    );
  }
  return bytes;
}

let runtime: Promise<void> | null = null;

async function loadLanguage(gen: Generation, lang: CodeLanguage): Promise<Loaded> {
  const spec = LANGUAGES[lang];
  const queryPath = join(gen.root, "queries", spec.query);
  if (!existsSync(queryPath)) {
    throw new Error(`definition query queries/${spec.query} is missing from ${gen.root}`);
  }
  const querySource = readFileSync(queryPath, "utf8");
  const wasm = verifiedGrammarFile(gen, lang, "grammar.wasm");
  const tags = spec.tags.map((name) => verifiedGrammarFile(gen, name, "tags.scm").toString("utf8"));
  runtime ??= Parser.init();
  await runtime;
  const language = await Language.load(new Uint8Array(wasm));
  const parser = new Parser();
  parser.setLanguage(language);
  return {
    parser,
    definitions: new Query(language, querySource),
    references: new Query(language, tags.join("\n")),
  };
}

function loaded(gen: Generation, lang: CodeLanguage): Promise<Loaded> {
  let pending = gen.languages.get(lang);
  if (!pending) {
    pending = loadLanguage(gen, lang);
    // A failed load is not cached, so a repaired file is read again.
    pending.catch(() => gen.languages.delete(lang));
    gen.languages.set(lang, pending);
  }
  return pending;
}

// ---------------------------------------------------------------------------------------
// Offsets and lines

interface Positions {
  /** UTF-8 byte offset of a UTF-16 index. */
  byte(index: number): number;
  /** 1-based line of a UTF-16 index, counted by `\n`. */
  line(index: number): number;
  /** The text of a 1-based line, without its `\n`. */
  lineText(line: number): string;
}

function positions(source: string): Positions {
  const newlines: number[] = [];
  for (let i = source.indexOf("\n"); i >= 0; i = source.indexOf("\n", i + 1)) newlines.push(i);
  let bytes: Uint32Array | null = null;
  if (Buffer.byteLength(source) !== source.length) {
    bytes = new Uint32Array(source.length + 1);
    let offset = 0;
    for (let i = 0; i < source.length; i++) {
      bytes[i] = offset;
      const code = source.charCodeAt(i);
      if (code < 0x80) offset += 1;
      else if (code < 0x800) offset += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < source.length) {
        // A surrogate pair is one four-byte character.
        offset += 4;
        bytes[++i] = offset;
      } else offset += 3;
    }
    bytes[source.length] = offset;
  }
  const line = (index: number) => {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((newlines[mid] as number) < index) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  return {
    byte: (index) => (bytes ? (bytes[index] as number) : index),
    line,
    lineText: (n) => {
      const start = n === 1 ? 0 : (newlines[n - 2] as number) + 1;
      const end = n - 1 < newlines.length ? (newlines[n - 1] as number) : source.length;
      return source.slice(start, end);
    },
  };
}

/** Lines as requireEvidenceCitation counts them: split on `\n`; a final `\n` ends a line. */
function countLines(source: string): number {
  if (source === "") return 0;
  const parts = source.split("\n").length;
  return source.endsWith("\n") ? parts - 1 : parts;
}

/** At most `max` UTF-8 bytes of `value`, never splitting a character. */
function cut(value: string, max: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= max) return value;
  let end = max;
  while (end > 0 && ((buffer[end] as number) & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString("utf8");
}

// ---------------------------------------------------------------------------------------
// Extraction

interface Candidate {
  node: Node;
  span: Node;
  name: string;
  nameStart: number;
  kind: string;
  citeStart: number;
  doc: string;
  broken: boolean;
}

function countErrors(node: Node): number {
  if (!node.hasError && !node.isMissing) return 0;
  let count = node.isError || node.isMissing ? 1 : 0;
  for (const child of node.children) if (child) count += countErrors(child);
  return count;
}

// The citeable start: through wrappers, then over contiguous leading comments that are not
// a trailing comment of the code before them.
function citeableStart(spec: LanguageSpec, span: Node): { start: Node; comments: Node[] } {
  let outer = span;
  for (let wrapper = spec.wrapper(outer); wrapper; wrapper = spec.wrapper(outer)) outer = wrapper;
  const comments: Node[] = [];
  let first = outer;
  for (let prev = outer.previousSibling; prev && spec.comments.includes(prev.type); ) {
    if (prev.endPosition.row < first.startPosition.row - 1) break;
    const before = prev.previousSibling;
    if (
      before &&
      !spec.comments.includes(before.type) &&
      before.endPosition.row === prev.startPosition.row
    ) {
      break;
    }
    comments.unshift(prev);
    first = prev;
    prev = before;
  }
  return { start: first, comments };
}

function unsupported(source: string, lang: string, extractor: string): Extraction {
  return {
    extractor_id: extractor,
    lang,
    status: "unsupported-language",
    bytes: Buffer.byteLength(source),
    lines: countLines(source),
    parse_errors: 0,
    symbols: [],
    refs: [],
    imports: [],
  };
}

/**
 * Extract the definition table, references and imports of one blob in one language.
 * Deterministic for a given text, language and extractor generation.
 */
export async function extract(
  source: string,
  lang: string,
  options?: ExtractOptions,
): Promise<Extraction> {
  const gen = generation(options);
  if (!isCodeLanguage(lang)) return unsupported(source, lang, gen.extractorId);
  const spec = LANGUAGES[lang];
  const { parser, definitions, references } = await loaded(gen, lang);
  const tree = parser.parse(source);
  if (!tree) throw new Error(`the ${lang} parser returned no tree`);
  try {
    const root = tree.rootNode;
    const at = positions(source);

    // Definitions: one per (declaration, name) pair; the earliest pattern names the kind.
    const chosen = new Map<
      string,
      { pattern: number; kind: string; node: Node; name: Node | null }
    >();
    const imports = new Map<string, ImportRow>();
    for (const match of definitions.matches(root)) {
      const outer = match.captures.find((capture) => capture.name.startsWith("definition."));
      const imported = match.captures.find((capture) => capture.name === "import");
      if (imported) {
        const row = {
          specifier: spec.specifier(imported.node),
          line: at.line(imported.node.startIndex),
        };
        imports.set(`${row.line}\0${row.specifier}`, row);
      }
      if (!outer) continue;
      const captured = match.captures.find((capture) => capture.name === "name")?.node ?? null;
      // A query match captures one name; a node with several (Go's `const A, B = 1, 2`)
      // defines each of them.
      const siblings = captured
        ? outer.node.childrenForFieldName("name").filter((node) => node?.isNamed)
        : [];
      const names = siblings.some((node) => node?.id === captured?.id) ? siblings : [captured];
      for (const name of names) {
        const key = `${outer.node.id}:${name?.id ?? ""}`;
        const known = chosen.get(key);
        if (!known || match.patternIndex < known.pattern) {
          chosen.set(key, {
            pattern: match.patternIndex,
            kind: outer.name.slice("definition.".length),
            node: outer.node,
            name,
          });
        }
      }
    }

    const candidates: Candidate[] = [];
    for (const { kind, node, name } of chosen.values()) {
      const span = spec.span(node);
      const { start, comments } = citeableStart(spec, span);
      const docstring = spec.docstring(node);
      candidates.push({
        node,
        span,
        name: name?.text ?? kind,
        nameStart: name?.startIndex ?? node.startIndex,
        kind,
        citeStart: start.startIndex,
        doc: docstring ?? comments.map((comment) => comment.text.trim()).join("\n"),
        broken: span.hasError,
      });
    }
    candidates.sort(
      (a, b) =>
        a.citeStart - b.citeStart ||
        b.span.endIndex - a.span.endIndex ||
        a.nameStart - b.nameStart ||
        (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
    );

    // Enclosing chains, by strict containment of declaration spans.
    const qnames = new Map<Candidate, string>();
    const stack: Candidate[] = [];
    for (const candidate of candidates) {
      const contains = (outer: Candidate) =>
        outer.span.startIndex <= candidate.span.startIndex &&
        candidate.span.endIndex <= outer.span.endIndex &&
        (outer.span.startIndex < candidate.span.startIndex ||
          candidate.span.endIndex < outer.span.endIndex);
      while (stack.length > 0 && !contains(stack[stack.length - 1] as Candidate)) stack.pop();
      const parent = stack[stack.length - 1];
      const receiver = spec.receiver(candidate.node);
      const prefix = receiver ?? (parent ? qnames.get(parent) : undefined);
      qnames.set(candidate, prefix ? `${prefix}.${candidate.name}` : candidate.name);
      stack.push(candidate);
    }

    const occurrences = new Map<string, number>();
    const symbols: SymbolRow[] = [];
    for (const candidate of candidates) {
      if (candidate.broken) continue;
      const qname = qnames.get(candidate) as string;
      const symbolId = qname + spec.discriminator(candidate.node, candidate.kind);
      const occurrence = (occurrences.get(symbolId) ?? 0) + 1;
      occurrences.set(symbolId, occurrence);
      const startByte = at.byte(candidate.citeStart);
      const endByte = at.byte(candidate.span.endIndex);
      const startLine = at.line(candidate.span.startIndex);
      symbols.push({
        ordinal: symbols.length + 1,
        symbol_id: symbolId,
        name: candidate.name,
        qname,
        kind: candidate.kind,
        start_line: startLine,
        end_line: at.line(Math.max(candidate.span.startIndex, candidate.span.endIndex - 1)),
        occurrence,
        doc_start_line: at.line(candidate.citeStart),
        start_byte: startByte,
        end_byte: endByte,
        signature: cut(at.lineText(startLine).trim(), SIGNATURE_BYTES),
        doc: cut(candidate.doc.trim(), DOC_BYTES),
        span_sha256: sha256(
          Buffer.from(source.slice(candidate.citeStart, candidate.span.endIndex), "utf8"),
        ),
      });
    }

    // References: tags.scm's @reference.* captures, unresolved, by name; one row per name,
    // kind and line.
    const refs = new Map<string, RefRow & { column: number }>();
    for (const match of references.matches(root)) {
      const ref = match.captures.find((capture) => capture.name.startsWith("reference."));
      const name = match.captures.find((capture) => capture.name === "name");
      if (!ref || !name) continue;
      const row = {
        name: name.node.text,
        kind: ref.name.slice("reference.".length),
        line: at.line(name.node.startIndex),
        column: name.node.startIndex,
      };
      const key = `${row.line}\0${row.kind}\0${row.name}`;
      const known = refs.get(key);
      if (!known || row.column < known.column) refs.set(key, row);
    }

    const parseErrors = countErrors(root);
    return {
      extractor_id: gen.extractorId,
      lang,
      status: root.hasError ? "parse-partial" : "ok",
      bytes: Buffer.byteLength(source),
      lines: countLines(source),
      parse_errors: root.hasError ? Math.max(parseErrors, 1) : 0,
      symbols,
      refs: [...refs.values()]
        .sort((a, b) => a.column - b.column || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
        .map(({ name, kind, line }) => ({ name, kind, line })),
      imports: [...imports.values()].sort(
        (a, b) =>
          a.line - b.line || (a.specifier < b.specifier ? -1 : a.specifier > b.specifier ? 1 : 0),
      ),
    };
  } finally {
    tree.delete();
  }
}
