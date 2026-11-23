// Prototype: content-addressed tree-sitter symbol index over a git revision.
// usage: node index.mjs <repo> <rev> <out.json>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Parser, Language, Query } from "web-tree-sitter";

const require = createRequire(import.meta.url);
const [repo, rev, out] = process.argv.slice(2);
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { maxBuffer: 1 << 30 });

const LANGS = {
  ts: { wasm: "tree-sitter-typescript/tree-sitter-typescript.wasm", q: ["tree-sitter-javascript/queries/tags.scm", "tree-sitter-typescript/queries/tags.scm"] },
  tsx: { wasm: "tree-sitter-typescript/tree-sitter-tsx.wasm", q: ["tree-sitter-javascript/queries/tags.scm", "tree-sitter-typescript/queries/tags.scm"] },
  js: { wasm: "tree-sitter-javascript/tree-sitter-javascript.wasm", q: ["tree-sitter-javascript/queries/tags.scm"] },
  py: { wasm: "tree-sitter-python/tree-sitter-python.wasm", q: ["tree-sitter-python/queries/tags.scm"] },
  go: { wasm: "tree-sitter-go/tree-sitter-go.wasm", q: ["tree-sitter-go/queries/tags.scm"] },
  rs: { wasm: "tree-sitter-rust/tree-sitter-rust.wasm", q: ["tree-sitter-rust/queries/tags.scm"] },
  java: { wasm: "tree-sitter-java/tree-sitter-java.wasm", q: ["tree-sitter-java/queries/tags.scm"] },
  c: { wasm: "tree-sitter-c/tree-sitter-c.wasm", q: ["tree-sitter-c/queries/tags.scm"] },
  cpp: { wasm: "tree-sitter-cpp/tree-sitter-cpp.wasm", q: ["tree-sitter-cpp/queries/tags.scm"] },
};
const EXT = { ts: "ts", mts: "ts", cts: "ts", tsx: "tsx", js: "js", mjs: "js", cjs: "js", jsx: "js", py: "py", go: "go", rs: "rs", java: "java", c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp" };

const t0 = performance.now();
await Parser.init();
const parser = new Parser();
const loaded = {};
async function lang(k) {
  if (loaded[k]) return loaded[k];
  const L = await Language.load(require.resolve(LANGS[k].wasm));
  const src = LANGS[k].q.map((p) => readFileSync(require.resolve(p), "utf8")).join("\n");
  let q;
  try { q = new Query(L, src); } catch (e) { q = new Query(L, readFileSync(require.resolve(LANGS[k].q.at(-1)), "utf8")); }
  loaded[k] = { L, q };
  return loaded[k];
}
const tInit = performance.now() - t0;

const tree = git("ls-tree", "-r", "-l", rev).toString().trim().split("\n").map((l) => {
  const [meta, path] = l.split("\t");
  const [, , sha, size] = meta.split(/\s+/);
  return { path, sha, size: Number(size) };
});
const files = tree.filter((f) => EXT[f.path.split(".").pop()] && f.size < 1_000_000);
const blobs = new Map();
const result = { rev, files: [], timing: {} };
let parseMs = 0, nDefs = 0, nRefs = 0, bytes = 0, errors = 0;
for (const f of files) {
  const k = EXT[f.path.split(".").pop()];
  const { L, q } = await lang(k);
  parser.setLanguage(L);
  const text = git("cat-file", "blob", f.sha).toString("utf8");
  bytes += Buffer.byteLength(text);
  const s = performance.now();
  const t = parser.parse(text);
  const defs = [], refs = [];
  for (const m of q.matches(t.rootNode)) {
    const name = m.captures.find((c) => c.name === "name");
    const outer = m.captures.find((c) => c.name !== "name" && !c.name.startsWith("doc"));
    if (!name || !outer) continue;
    const [role, kind] = outer.name.split(".");
    const node = outer.node;
    // container chain: enclosing named defs
    const rec = { name: name.node.text, kind, start: node.startPosition.row + 1, end: node.endPosition.row + 1, sb: node.startIndex, eb: node.endIndex };
    if (role === "definition") defs.push(rec); else refs.push({ name: rec.name, kind, line: rec.start });
  }
  if (t.rootNode.hasError) errors++;
  parseMs += performance.now() - s;
  // qualify: parent def whose span contains this def
  defs.sort((a, b) => a.sb - b.sb || b.eb - a.eb);
  for (const d of defs) {
    const parent = defs.filter((p) => p !== d && p.sb <= d.sb && p.eb >= d.eb && (p.eb - p.sb) > (d.eb - d.sb)).sort((a, b) => (a.eb - a.sb) - (b.eb - b.sb))[0];
    d.qname = parent ? `${parent.qname ?? parent.name}.${d.name}` : d.name;
  }
  nDefs += defs.length; nRefs += refs.length;
  result.files.push({ path: f.path, blob: f.sha, lang: k, bytes: Buffer.byteLength(text), lines: text.split("\n").length, defs, nrefs: refs.length, refs: refs.slice(0, 2000) });
  t.delete();
}
result.timing = { initMs: Math.round(tInit), parseMs: Math.round(parseMs), totalMs: Math.round(performance.now() - t0), files: files.length, bytes, defs: nDefs, refs: nRefs, filesWithErrors: errors };
writeFileSync(out, JSON.stringify(result));
console.log(JSON.stringify(result.timing));
