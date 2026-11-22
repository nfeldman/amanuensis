// The code index's extractor (PLAN §4.2): blob text and a language in, a deterministic
// definition table out.
//
// Definitions come from the index's own queries, queries/<lang>.scm, which `tsc` does not
// copy and which ship through package.json `files`; they are read relative to the package
// root, as grammars/ is. A grammar's tags.scm serves references only. Every grammar file is
// checked against grammars/manifest.json when it is loaded, and one whose bytes differ is
// refused.
//
// Identity: `qname` is the chain of enclosing definitions, with each language's rules: a Go
// method is `<Receiver>.<name>`; inside a Rust `impl T` an item is `T.<name>` and inside
// `impl Trait for T` it is `<T as Trait>.<name>`; a C++ qualified declarator is relative to
// its lexical namespace chain unless it starts with `::`, and defines a method unless it
// names a namespace the file declares; a C# file-scoped namespace qualifies everything
// after it. `symbol_id` is the qname plus a syntactic discriminator
// where a language has overloads: Java parameter types; C++ template arity, parameter types
// and cv/ref qualifiers; C# generic arity on every type and method segment, and parameter
// types with their modifiers. It has no positional part: two definitions in one file that
// share a symbol_id (a C++ prototype and its definition, a C# partial method's halves) are
// occurrences 1, 2, … in file order. A C# partial type's declaration is a file-local
// fragment and carries `partial: true`.
//
// Spans: start_line and end_line are the declaration's (past attributes inside a C#
// declaration). The citeable span starts earlier, at `doc_start_line`, over contiguous
// leading comments and through wrappers and attributes (`export`, `declare`, Python
// decorators, C++ `template` lines, Rust attributes); start_byte and end_byte bound it in
// UTF-8 bytes, without a trailing line break, and span_sha256 hashes exactly those bytes, so
// a comment edit is a change. Lines are counted by `\n`, as requireEvidenceCitation counts
// them, so a CRLF file numbers its lines as git does.
//
// A file with a syntax error is `parse-partial`: a definition whose declaration holds an
// error is left out, and every intact one is reported as if the file had parsed.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, type Node, Parser, Query } from "web-tree-sitter";

/** Bump when a change to this file changes any extraction. */
export const EXTRACTOR_VERSION = "3";

export type CodeLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "python"
  | "go"
  | "java"
  | "rust"
  | "c"
  | "cpp"
  | "csharp";

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
  /** Present, and true, only on a C# partial type's declaration: a file-local fragment. */
  partial?: true;
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
  /** Sibling node types before a definition that join its citeable span (Rust attributes). */
  leading?: string[];
  /** Where the declaration proper starts, past attributes inside it; defaults to its start. */
  head?(node: Node): number;
  /** Name, kind and identity where the query alone cannot give them; null drops the match. */
  identify?(context: IdentifyContext): Identity | null;
}

interface IdentifyContext {
  node: Node;
  /** The node the query captured as @name, if any. */
  name: Node | null;
  /** The kind the query named. */
  kind: string;
  /** The enclosing definition whose qname qualifies this one. */
  parent: { name: string; kind: string } | null;
  source: string;
}

interface Identity {
  name: string;
  kind: string;
  /** Qualifying segments written in the declaration itself (`Foo::bar`, a Go receiver). */
  qualifier?: string[];
  /** The qualifier is global and replaces the enclosing chain. */
  global?: boolean;
  /** This definition's segment of a symbol_id, when it differs from its name (C# arity). */
  segment?: string;
  /** Appended to the symbol_id to tell overloads apart. */
  discriminator?: string;
  /** The segment the definition's members are qualified by, when not its own name. */
  childScope?: string;
  /** False when the definition qualifies nothing inside it (a C typedef or struct). */
  scopes?: boolean;
  /** Qualifies every later definition outside any other (a C# file-scoped namespace). */
  fileScope?: boolean;
  partial?: boolean;
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

// Rust: an impl block is named for its type and trait, generic arguments stripped from the
// type; its items are qualified by `T` or `<T as Trait>`.
function rustIdentify({ node, name, kind }: IdentifyContext): Identity {
  if (node.type !== "impl_item") return { name: name?.text ?? kind, kind };
  const selfType = node.childForFieldName("type");
  const type =
    (selfType?.type === "generic_type" ? selfType.childForFieldName("type") : selfType)?.text ?? "";
  const trait = node.childForFieldName("trait")?.text;
  const plain = (text: string) => text.replace(/\s+/g, " ").trim();
  if (!trait) return { name: `impl ${plain(type)}`, kind, childScope: plain(type) };
  return {
    name: `impl ${plain(trait)} for ${plain(type)}`,
    kind,
    childScope: `<${plain(type)} as ${plain(trait)}>`,
  };
}

// C and C++: the node types a declarator's name can be.
const C_NAMES = new Set([
  "identifier",
  "field_identifier",
  "type_identifier",
  "qualified_identifier",
  "operator_name",
  "destructor_name",
  "template_function",
  "operator_cast",
]);

// The name inside a declarator, through pointer, reference, array and init declarators, and
// the function declarator whose own declarator is that name (so `int (*fp)(int)` is not a
// function).
function declaratorName(node: Node | null): { name: Node | null; fn: Node | null } {
  let fn: Node | null = null;
  for (let n = node; n; ) {
    if (C_NAMES.has(n.type)) return { name: n, fn };
    const inner: Node | null =
      n.childForFieldName("declarator") ??
      n.namedChildren.find(
        (child) => !!child && (child.type.endsWith("declarator") || C_NAMES.has(child.type)),
      ) ??
      null;
    if (n.type === "function_declarator" && inner && C_NAMES.has(inner.type)) fn = n;
    n = inner;
  }
  return { name: null, fn: null };
}

// `geo::Buf<T>::get` is segments geo and Buf, one of them templated, and the name get; a
// leading `::` makes it global.
function qualifiedName(name: Node): {
  segments: string[];
  templated: number;
  last: Node;
  global: boolean;
} {
  const segments: string[] = [];
  let templated = 0;
  let global = false;
  let n = name;
  while (n.type === "qualified_identifier") {
    const scope = n.childForFieldName("scope");
    if (!scope) global = segments.length === 0;
    else if (scope.type === "template_type") {
      segments.push(scope.childForFieldName("name")?.text ?? scope.text);
      templated++;
    } else segments.push(scope.text.replace(/\s+/g, ""));
    const next = n.childForFieldName("name");
    if (!next) break;
    n = next;
  }
  return { segments, templated, last: n, global };
}

function cNameText(node: Node): string {
  if (node.type === "template_function") return node.childForFieldName("name")?.text ?? node.text;
  return node.text.replace(/\s+/g, node.type === "operator_cast" ? " " : "");
}

// Collapse whitespace, then drop it beside punctuation: `const Buf &` is `const Buf&`.
function tight(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s*([*&,()<>[\]:?.])\s*/g, "$1")
    .trim();
}

// C++: parameter types as written (names and default values removed), then cv- and
// ref-qualifiers.
function cppParameters(source: string, fn: Node): string {
  const types: string[] = [];
  for (const parameter of fn.childForFieldName("parameters")?.children ?? []) {
    if (!parameter) continue;
    if (parameter.type === "...") types.push("...");
    if (!parameter.isNamed || parameter.type === "comment") continue;
    if (parameter.type === "variadic_parameter") {
      types.push("...");
      continue;
    }
    let end = parameter.endIndex;
    const equals = parameter.children.find((child) => child?.type === "=");
    if (equals) end = equals.startIndex;
    const { name } = declaratorName(parameter.childForFieldName("declarator"));
    let text = source.slice(parameter.startIndex, end);
    if (name && name.type === "identifier" && name.endIndex <= end) {
      text = source.slice(parameter.startIndex, name.startIndex) + source.slice(name.endIndex, end);
    }
    types.push(tight(text));
  }
  const qualifiers = fn.children
    .filter((child) => child && (child.type === "type_qualifier" || child.type === "ref_qualifier"))
    .map((child) => child?.text ?? "");
  return `(${types.join(",")})${qualifiers.length > 0 ? ` ${qualifiers.join(" ")}` : ""}`;
}

const C_SCOPE = new Set([
  "translation_unit",
  "declaration_list",
  "namespace_definition",
  "linkage_specification",
  "template_declaration",
  "preproc_if",
  "preproc_ifdef",
  "preproc_else",
  "preproc_elif",
  "preproc_elifdef",
]);

// At file or namespace scope: no enclosing function, class or block.
function atFileScope(node: Node): boolean {
  for (let n = node.parent; n; n = n.parent) {
    if (n.type === "translation_unit") return true;
    if (!C_SCOPE.has(n.type)) return false;
  }
  return false;
}

// Directly in a class body, through `template` and preprocessor wrappers.
function inClassBody(node: Node): boolean {
  for (let n = node.parent; n; n = n.parent) {
    if (n.type === "field_declaration_list") return true;
    if (n.type !== "template_declaration" && !n.type.startsWith("preproc_")) return false;
  }
  return false;
}

const C_RECORDS = ["class", "struct", "union"];

function cIdentify(cpp: boolean) {
  return ({ node, name, kind, parent, source }: IdentifyContext): Identity | null => {
    if (!name) return null;
    switch (kind) {
      case "namespace":
        return { name: name.text.replace(/\s+/g, "").replace(/::/g, "."), kind };
      case "class":
      case "struct":
      case "union":
      case "enum": {
        const { segments, last, global } = qualifiedName(name);
        return { name: last.text, kind, qualifier: segments, global, scopes: cpp };
      }
      case "type":
      case "concept":
      case "macro":
        return { name: name.text, kind, scopes: false };
      case "typedef":
      case "variable": {
        if (kind === "variable" && !atFileScope(node)) return null;
        const found = declaratorName(name).name;
        return found ? { name: cNameText(found), kind, scopes: false } : null;
      }
    }
    // Functions, member declarations and prototypes.
    const { name: found, fn } = declaratorName(name);
    if (!found) return null;
    if (kind === "field" && !fn) return { name: cNameText(found), kind, scopes: false };
    if (kind !== "function" && !fn) return null;
    if (kind === "declaration" && !atFileScope(node) && !inClassBody(node)) return null;
    const { segments, templated, last, global } = qualifiedName(found);
    const text = cNameText(last);
    let refined = kind === "function" ? "function" : "declaration";
    if (cpp && refined === "function") {
      const classScope = parent && C_RECORDS.includes(parent.kind);
      if (text.startsWith("~")) refined = "destructor";
      else if (/^operator\b/.test(text)) refined = "operator";
      else if (
        segments.length > 0
          ? text === segments[segments.length - 1]
          : classScope && text === parent?.name
      ) {
        refined = "constructor";
      } else if (segments.length > 0 || classScope) refined = "method";
    }
    if (!cpp) return { name: text, kind: refined };
    // A template's own parameter count: the template lists left once each templated
    // qualifier (`Buf<T>::`) has taken its own.
    const wrappers: Node[] = [];
    let outer = node;
    while (outer.parent?.type === "template_declaration") {
      wrappers.push(outer.parent);
      outer = outer.parent;
    }
    const own = wrappers.length > templated ? wrappers[0] : undefined;
    const arity =
      own?.childForFieldName("parameters")?.namedChildren.filter((p) => p && p.type !== "comment")
        .length ?? 0;
    return {
      name: text,
      kind: refined,
      qualifier: segments,
      global,
      discriminator: `${arity > 0 ? `<${arity}>` : ""}${fn ? cppParameters(source, fn) : "()"}`,
    };
  };
}

// C and C++: a specifier with no declarator of its own (`struct S {…};` in a class) is cited
// as its whole declaration.
function cSpan(node: Node): Node {
  const parent = node.parent;
  if (
    parent &&
    (parent.type === "field_declaration" || parent.type === "declaration") &&
    parent.childForFieldName("type")?.id === node.id &&
    !parent.childForFieldName("declarator")
  ) {
    return parent;
  }
  return node;
}

// C#: parameter types as written with their modifiers (`ref int`), names, attributes and
// default values removed. A `params` parameter's parts sit directly in the list, so
// parameters are read as the runs of children between commas.
function csharpParameters(list: Node | null): string {
  if (!list) return "";
  type Part = { node: Node; field: string | null };
  const groups: Part[][] = [[]];
  for (let i = 0; i < list.childCount; i++) {
    const child = list.child(i);
    if (
      !child ||
      child.type === "(" ||
      child.type === ")" ||
      child.type === "[" ||
      child.type === "]"
    ) {
      continue;
    }
    if (child.type === ",") groups.push([]);
    else
      (groups[groups.length - 1] as Part[]).push({ node: child, field: list.fieldNameForChild(i) });
  }
  const types: string[] = [];
  for (const group of groups) {
    let parts = group;
    const only = group.length === 1 ? group[0] : undefined;
    if (only?.node.type === "parameter") {
      parts = [];
      for (let i = 0; i < only.node.childCount; i++) {
        const child = only.node.child(i);
        if (child) parts.push({ node: child, field: only.node.fieldNameForChild(i) });
      }
    }
    const kept: string[] = [];
    for (const { node, field } of parts) {
      if (node.type === "=") break;
      if (field === "name" || node.type === "attribute_list" || node.type === "comment") continue;
      kept.push(node.text);
    }
    const type = tight(kept.join(" "));
    if (type) types.push(type);
  }
  return types.join(",");
}

const CSHARP_TYPES = ["class", "struct", "interface", "record"];
const CSHARP_CALLABLE = ["method", "constructor", "destructor", "operator"];

function csharpIdentify({ node, name, kind }: IdentifyContext): Identity {
  let text = name?.text ?? kind;
  if (kind === "namespace") text = text.replace(/\s+/g, "");
  else if (node.type === "destructor_declaration") text = `~${text}`;
  else if (node.type === "indexer_declaration") text = "this";
  else if (node.type === "operator_declaration") {
    const children = node.children;
    const at = children.findIndex((child) => child?.type === "operator");
    text = `operator${children[at + 1]?.text ?? ""}`;
  } else if (node.type === "conversion_operator_declaration") {
    text = `operator ${node.childForFieldName("type")?.text.replace(/\s+/g, "") ?? ""}`;
  }
  const typeParameters =
    node.childForFieldName("type_parameters") ??
    node.namedChildren.find((child) => child?.type === "type_parameter_list") ??
    null;
  const arity = typeParameters?.namedChildren.filter((p) => p?.type === "type_parameter").length;
  const partial = node.namedChildren.some(
    (child) => child?.type === "modifier" && child.text === "partial",
  );
  let refined = kind;
  if (kind === "method" && partial && !node.childForFieldName("body")) refined = "declaration";
  let discriminator = "";
  if (CSHARP_CALLABLE.includes(kind)) {
    discriminator = `(${csharpParameters(node.childForFieldName("parameters"))})`;
  } else if (kind === "indexer") {
    discriminator = `[${csharpParameters(node.childForFieldName("parameters"))}]`;
  }
  return {
    name: text,
    kind: refined,
    segment: arity ? `${text}\`${arity}` : text,
    discriminator,
    fileScope: node.type === "file_scoped_namespace_declaration",
    partial: partial && CSHARP_TYPES.includes(kind),
  };
}

// C#: a declaration's head starts after its attribute lists.
function csharpHead(node: Node): number {
  const first = node.children.find(
    (child) => child && child.type !== "attribute_list" && child.type !== "comment",
  );
  return first?.startIndex ?? node.startIndex;
}

const cFamily = {
  comments: ["comment"],
  wrapper: (node: Node) => parentIf(node, ["template_declaration"]),
  span: cSpan,
  receiver: none,
  discriminator: empty,
  docstring: none,
  specifier: (node: Node) => node.text.replace(/^["<]|[">]$/g, ""),
};

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
  rust: {
    query: "rust.scm",
    tags: ["rust"],
    comments: ["line_comment", "block_comment"],
    leading: ["attribute_item"],
    wrapper: none,
    span: self,
    receiver: none,
    discriminator: empty,
    docstring: none,
    specifier: text,
    identify: rustIdentify,
  },
  c: { query: "c.scm", tags: ["c"], ...cFamily, identify: cIdentify(false) },
  cpp: { query: "cpp.scm", tags: ["cpp"], ...cFamily, identify: cIdentify(true) },
  csharp: {
    query: "csharp.scm",
    tags: ["csharp"],
    comments: ["comment"],
    wrapper: none,
    span: self,
    receiver: none,
    discriminator: empty,
    docstring: none,
    specifier: text,
    head: csharpHead,
    identify: csharpIdentify,
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
  ".rs": "rust",
  ".c": "c",
  ".h": "cpp",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".c++": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".h++": "cpp",
  ".cs": "csharp",
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
      `grammar manifest grammars/manifest.json is missing from ${root}; reinstall the package, or in a source checkout run \`node scripts/vendor-grammars.mjs\` in mcp-server`,
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
  /** What the definition encloses: its span, or its own declarator when it shares one. */
  owner: { start: number; end: number };
  nameNode: Node | null;
  name: string;
  nameStart: number;
  kind: string;
  citeStart: number;
  /** The span's end, without a trailing line break. */
  end: number;
  doc: string;
  broken: boolean;
}

// The last row a node's text is on: a node that ends with its line break (a Rust `///`
// comment, a `#define`) ends on the row before its end position.
function lastRow(node: Node): number {
  const end = node.endPosition;
  return end.column === 0 && end.row > node.startPosition.row ? end.row - 1 : end.row;
}

function countErrors(node: Node): number {
  if (!node.hasError && !node.isMissing) return 0;
  let count = node.isError || node.isMissing ? 1 : 0;
  for (const child of node.children) if (child) count += countErrors(child);
  return count;
}

// The citeable start: through wrappers, then over contiguous leading comments (and leading
// attributes) that are not a trailing comment of the code before them.
function citeableStart(spec: LanguageSpec, span: Node): { start: Node; comments: Node[] } {
  let outer = span;
  for (let wrapper = spec.wrapper(outer); wrapper; wrapper = spec.wrapper(outer)) outer = wrapper;
  const absorbed = (node: Node) =>
    spec.comments.includes(node.type) || (spec.leading?.includes(node.type) ?? false);
  const comments: Node[] = [];
  let first = outer;
  for (let prev = outer.previousSibling; prev && absorbed(prev); ) {
    if (lastRow(prev) < first.startPosition.row - 1) break;
    const before = prev.previousSibling;
    if (before && !absorbed(before) && lastRow(before) === prev.startPosition.row) break;
    if (spec.comments.includes(prev.type)) comments.unshift(prev);
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

    // Definitions sharing one declaration (`const a = …, b = …`) each own only their part of
    // it, so a definition nested in one declarator is never qualified by a sibling.
    const sharing = new Map<number, number>();
    for (const { node } of chosen.values()) sharing.set(node.id, (sharing.get(node.id) ?? 0) + 1);
    const ownPart = (node: Node, name: Node | null): Node => {
      if (!name || (sharing.get(node.id) ?? 0) < 2) return node;
      let part = name;
      while (part.parent && part.parent.id !== node.id) part = part.parent;
      return part.parent ? part : node;
    };
    const candidates: Candidate[] = [];
    for (const { kind, node, name } of chosen.values()) {
      const span = spec.span(node);
      const { start, comments } = citeableStart(spec, span);
      const docstring = spec.docstring(node);
      let end = span.endIndex;
      while (end > span.startIndex && (source[end - 1] === "\n" || source[end - 1] === "\r")) end--;
      const part = ownPart(node, name);
      candidates.push({
        node,
        span,
        owner:
          part === node
            ? { start: span.startIndex, end: span.endIndex }
            : { start: part.startIndex, end: part.endIndex },
        nameNode: name,
        name: name?.text ?? kind,
        nameStart: name?.startIndex ?? node.startIndex,
        kind,
        citeStart: start.startIndex,
        end,
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

    // Enclosing chains, by strict containment in what each definition owns. A definition is
    // qualified by the nearest enclosing one that scopes, else by a file-scoped namespace
    // before it.
    interface Scope {
      candidate: Candidate;
      name: string;
      kind: string;
      childQ: string;
      childId: string;
      scopes: boolean;
    }
    interface Named {
      qname: string;
      symbolId: string;
      name: string;
      kind: string;
      partial: boolean;
    }
    const join = (prefix: string, segment: string) =>
      prefix && segment ? `${prefix}.${segment}` : prefix || segment;
    const named = new Map<Candidate, Named>();
    const stack: Scope[] = [];
    let fileScope: Scope | null = null;
    for (const candidate of candidates) {
      // Siblings share a span, so the stack keeps whatever spans the candidate, and the
      // scope is the nearest entry whose own part strictly contains it.
      const spans = (outer: Candidate) =>
        outer.span.startIndex <= candidate.span.startIndex &&
        candidate.span.endIndex <= outer.span.endIndex;
      const owns = (outer: Candidate) =>
        outer.owner.start <= candidate.span.startIndex &&
        candidate.span.endIndex <= outer.owner.end &&
        (outer.owner.start < candidate.span.startIndex ||
          candidate.span.endIndex < outer.owner.end);
      while (stack.length > 0 && !spans((stack[stack.length - 1] as Scope).candidate)) {
        stack.pop();
      }
      let scope: Scope | null = null;
      for (let i = stack.length - 1; i >= 0 && !scope; i--) {
        const entry = stack[i] as Scope;
        if (entry.scopes && owns(entry.candidate)) scope = entry;
      }
      if (!scope && fileScope && fileScope.candidate.span.endIndex <= candidate.span.startIndex) {
        scope = fileScope;
      }
      let identity: Identity | null;
      if (spec.identify) {
        identity = spec.identify({
          node: candidate.node,
          name: candidate.nameNode,
          kind: candidate.kind,
          parent: scope ? { name: scope.name, kind: scope.kind } : null,
          source,
        });
      } else {
        const receiver = spec.receiver(candidate.node);
        identity = {
          name: candidate.name,
          kind: candidate.kind,
          qualifier: receiver ? [receiver] : [],
          global: receiver !== null,
          discriminator: spec.discriminator(candidate.node, candidate.kind),
        };
      }
      if (!identity) continue;
      const qualifier = (identity.qualifier ?? []).join(".");
      const qPrefix = identity.global ? qualifier : join(scope?.childQ ?? "", qualifier);
      const idPrefix = identity.global ? qualifier : join(scope?.childId ?? "", qualifier);
      const qname = join(qPrefix, identity.name);
      const idBase = join(idPrefix, identity.segment ?? identity.name);
      named.set(candidate, {
        qname,
        symbolId: idBase + (identity.discriminator ?? ""),
        name: identity.name,
        kind: identity.kind,
        partial: identity.partial === true,
      });
      const entry: Scope = {
        candidate,
        name: identity.name,
        kind: identity.kind,
        childQ: identity.childScope !== undefined ? join(qPrefix, identity.childScope) : qname,
        childId: identity.childScope !== undefined ? join(idPrefix, identity.childScope) : idBase,
        scopes: identity.scopes ?? true,
      };
      if (identity.fileScope) fileScope = entry;
      stack.push(entry);
    }

    // C++: `n::f() {}` defines a member only when n is not a namespace. A qualified
    // definition whose owner is a namespace this file declares, and no record, is a function.
    if (lang === "cpp") {
      const namespaces = new Set<string>();
      const records = new Set<string>();
      for (const entry of named.values()) {
        if (entry.kind === "namespace") namespaces.add(entry.qname);
        else if (C_RECORDS.includes(entry.kind)) records.add(entry.qname);
      }
      for (const entry of named.values()) {
        if (entry.kind !== "method") continue;
        const owner = entry.qname.slice(0, entry.qname.lastIndexOf("."));
        if (namespaces.has(owner) && !records.has(owner)) entry.kind = "function";
      }
    }

    const occurrences = new Map<string, number>();
    const symbols: SymbolRow[] = [];
    for (const candidate of candidates) {
      const identity = named.get(candidate);
      if (candidate.broken || !identity) continue;
      const symbolId = identity.symbolId;
      const occurrence = (occurrences.get(symbolId) ?? 0) + 1;
      occurrences.set(symbolId, occurrence);
      const startByte = at.byte(candidate.citeStart);
      const endByte = at.byte(candidate.end);
      const startLine = at.line(spec.head?.(candidate.span) ?? candidate.span.startIndex);
      const row: SymbolRow = {
        ordinal: symbols.length + 1,
        symbol_id: symbolId,
        name: identity.name,
        qname: identity.qname,
        kind: identity.kind,
        start_line: startLine,
        end_line: at.line(Math.max(candidate.span.startIndex, candidate.end - 1)),
        occurrence,
        doc_start_line: at.line(candidate.citeStart),
        start_byte: startByte,
        end_byte: endByte,
        signature: cut(at.lineText(startLine).trim(), SIGNATURE_BYTES),
        doc: cut(candidate.doc.trim(), DOC_BYTES),
        span_sha256: sha256(Buffer.from(source.slice(candidate.citeStart, candidate.end), "utf8")),
      };
      if (identity.partial) row.partial = true;
      symbols.push(row);
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
