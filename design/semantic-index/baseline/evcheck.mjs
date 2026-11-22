// For each evidence row: does its symbol resolve to a tree-sitter definition at its ref_sha,
// does its excerpt appear at the cited lines / inside the symbol / anywhere, and how many bytes
// would reading the symbol cost against reading the whole file.
// usage: node evcheck.mjs <repo> <rows.json>   (rows from sqlite3 -json)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Parser, Language, Query } from "web-tree-sitter";
const require = createRequire(import.meta.url);
const [repo, rowsPath] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(rowsPath, "utf8"));
const EXT = { ts: "ts", mts: "ts", tsx: "tsx", js: "js", mjs: "js", cjs: "js", py: "py" };
const LANGS = {
  ts: ["tree-sitter-typescript/tree-sitter-typescript.wasm", ["tree-sitter-javascript/queries/tags.scm", "tree-sitter-typescript/queries/tags.scm"]],
  tsx: ["tree-sitter-typescript/tree-sitter-tsx.wasm", ["tree-sitter-javascript/queries/tags.scm", "tree-sitter-typescript/queries/tags.scm"]],
  js: ["tree-sitter-javascript/tree-sitter-javascript.wasm", ["tree-sitter-javascript/queries/tags.scm"]],
  py: ["tree-sitter-python/tree-sitter-python.wasm", ["tree-sitter-python/queries/tags.scm"]],
};
await Parser.init();
const parser = new Parser();
const cache = {};
async function L(k) {
  if (cache[k]) return cache[k];
  const lang = await Language.load(require.resolve(LANGS[k][0]));
  const q = new Query(lang, LANGS[k][1].map((p) => readFileSync(require.resolve(p), "utf8")).join("\n"));
  return (cache[k] = { lang, q });
}
const norm = (s) => s.replace(/\.\.\.|…/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const contains = (hay, ex) => {
  const h = norm(hay);
  // excerpt elisions: every fragment must appear in order
  const parts = ex.split(/\.\.\.|…/).map(norm).filter((p) => p.length >= 8);
  if (!parts.length) return h.includes(norm(ex));
  let i = 0;
  for (const p of parts) { const j = h.indexOf(p, i); if (j < 0) return false; i = j + p.length; }
  return true;
};
const stats = { rows: 0, code: 0, withSymbol: 0, symResolves: 0, rangeKnown: 0, rangePastEnd: 0, excerpted: 0, exAtRange: 0, exInSymbol: 0, exAnywhere: 0, exRecoverable: 0, fileBytes: 0, symBytes: 0, rangeBytes: 0, symRows: 0, missingBlob: 0 };
const detail = [];
for (const r of rows) {
  stats.rows++;
  const k = EXT[r.file_path.split(".").pop()];
  let text;
  try { text = execFileSync("git", ["-C", repo, "show", `${r.ref_sha}:${r.file_path}`], { stdio: ["ignore", "pipe", "ignore"] }).toString("utf8"); } catch { stats.missingBlob++; continue; }
  const lines = text.split("\n");
  let range = null;
  if (r.line_range && /^\d+(-\d+)?$/.test(r.line_range)) { const [a, b] = r.line_range.split("-").map(Number); range = [a, b ?? a]; stats.rangeKnown++; if (range[1] > lines.length) stats.rangePastEnd++; }
  let sym = null;
  if (k) {
    stats.code++;
    const { lang, q } = await L(k);
    parser.setLanguage(lang);
    const t = parser.parse(text);
    const defs = [];
    for (const m of q.matches(t.rootNode)) {
      const n = m.captures.find((c) => c.name === "name"); const o = m.captures.find((c) => c.name.startsWith("definition"));
      if (n && o) defs.push({ name: n.node.text, s: o.node.startPosition.row + 1, e: o.node.endPosition.row + 1, sb: o.node.startIndex, eb: o.node.endIndex });
    }
    t.delete();
    if (r.symbol) {
      stats.withSymbol++;
      const want = r.symbol.replace(/\(.*$/, "").split(/[.#:]/).pop().trim();
      const cands = defs.filter((d) => d.name === want);
      if (cands.length) {
        stats.symResolves++;
        // prefer the candidate overlapping the cited range
        sym = (range && cands.find((d) => d.s <= range[1] && d.e >= range[0])) || cands[0];
        stats.symRows++; stats.fileBytes += Buffer.byteLength(text); stats.symBytes += sym.eb - sym.sb;
        if (range) stats.rangeBytes += Buffer.byteLength(lines.slice(range[0] - 1, range[1]).join("\n"));
      }
    }
  }
  if (r.excerpt && r.excerpt.trim().length >= 8) {
    stats.excerpted++;
    const atRange = range ? contains(lines.slice(Math.max(0, range[0] - 1), range[1]).join("\n"), r.excerpt) : false;
    const inSym = sym ? contains(text.slice(sym.sb, sym.eb), r.excerpt) : false;
    const any = contains(text, r.excerpt);
    if (atRange) stats.exAtRange++;
    if (inSym) stats.exInSymbol++;
    if (any) stats.exAnywhere++;
    if (!atRange && (inSym || any)) stats.exRecoverable++;
    detail.push({ id: r.id, f: r.file_path, sym: r.symbol, range: r.line_range, atRange, inSym, any });
  }
}
console.log(JSON.stringify(stats, null, 1));
if (process.env.DETAIL) console.log(JSON.stringify(detail.filter((d) => !d.atRange)));
