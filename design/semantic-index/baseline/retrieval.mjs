// Offline retrieval benchmark: does BM25 over (a) symbols+docs or (b) whole files find the files a
// record's evidence cites, given the record's own words as the query?
// usage: node retrieval.mjs <repo> <rev> <store.db>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Parser, Language, Query } from "web-tree-sitter";
const require = createRequire(import.meta.url);
const Database = require(process.env.BETTER_SQLITE3 ?? "better-sqlite3");
const [repo, rev, storePath] = process.argv.slice(2);
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { maxBuffer: 1 << 30 });
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
const words = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:#]/g, " ");
const db = new Database(":memory:");
db.exec("create virtual table sym using fts5(path unindexed, name, sig, doc, tokenize='porter unicode61'); create virtual table file using fts5(path unindexed, body, tokenize='porter unicode61');");
const insS = db.prepare("insert into sym values (?,?,?,?)");
const insF = db.prepare("insert into file values (?,?)");
const tree = git("ls-tree", "-r", rev).toString().trim().split("\n").map((l) => { const [m, p] = l.split("\t"); return { path: p, sha: m.split(/\s+/)[2] }; });
let symBytes = 0, fileBytes = 0;
for (const f of tree) {
  const text = (() => { try { return git("cat-file", "blob", f.sha).toString("utf8"); } catch { return ""; } })();
  if (text.length > 2_000_000 || text.includes("\0")) continue;
  insF.run(f.path, words(f.path) + "\n" + text); fileBytes += text.length;
  const k = EXT[f.path.split(".").pop()];
  if (!k) { insS.run(f.path, words(f.path), "", ""); continue; } // non-code file: path only
  const { lang, q } = await L(k); parser.setLanguage(lang);
  const t = parser.parse(text);
  for (const m of q.matches(t.rootNode)) {
    const n = m.captures.find((c) => c.name === "name"); const o = m.captures.find((c) => c.name.startsWith("definition"));
    if (!n || !o) continue;
    let doc = ""; let p = o.node.previousNamedSibling;
    // walk up through export wrappers
    let host = o.node; while (!p && host.parent && host.parent.type.includes("export")) { host = host.parent; p = host.previousNamedSibling; }
    while (p && p.type === "comment") { doc = p.text + "\n" + doc; p = p.previousNamedSibling; }
    if (!doc && k === "py") { const b = o.node.childForFieldName("body"); const s0 = b?.namedChild(0); if (s0?.type === "expression_statement" && s0.namedChild(0)?.type === "string") doc = s0.text; }
    const sig = text.slice(o.node.startIndex, Math.min(o.node.endIndex, o.node.startIndex + 200)).split("\n")[0];
    insS.run(f.path, words(f.path) + " " + words(n.node.text), sig, doc.slice(0, 2000)); symBytes += sig.length + doc.length;
  }
  t.delete();
}
const store = new Database(storePath, { readonly: true });
const qs = [];
for (const r of store.prepare("select f.finding_id id, f.symptom || ' ' || coalesce(f.root_cause,'') q, group_concat(distinct e.file_path) files from findings f join finding_evidence fe using(finding_id) join evidence e on e.id = fe.evidence_id group by f.finding_id").all()) qs.push({ kind: "finding", ...r });
for (const r of store.prepare("select c.claim_id id, c.statement q, group_concat(distinct e.file_path) files from claims c join claim_evidence ce using(claim_id) join evidence e on e.id = ce.evidence_id group by c.claim_id").all()) qs.push({ kind: "claim", ...r });
for (const r of store.prepare("select d.subsystem_id||'/'||d.concern_code id, coalesce(d.rationale,'') || ' ' || coalesce(d.evidence,'') q, group_concat(distinct e.file_path) files from dispositions d join disposition_evidence de using(subsystem_id, concern_code) join evidence e on e.id = de.evidence_id group by 1").all()) qs.push({ kind: "disposition", ...r });
const ftsq = (s) => { const toks = [...new Set(words(s).toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [])].filter((w) => !STOP.has(w)).slice(0, 24); return toks.map((t) => `"${t}"`).join(" OR "); };
const STOP = new Set("the and for that this with from are not but was has have its into when which what will been only does each than then they them their there other also can any all one two who how why our out use used uses using should would could".split(" "));
const at = (table, q, k) => { const seen = []; for (const r of db.prepare(`select path from ${table} where ${table} match ? order by bm25(${table}) limit 200`).all(q)) { if (!seen.includes(r.path)) seen.push(r.path); if (seen.length >= k) break; } return seen; };
const res = { n: 0, sym5: 0, sym10: 0, file5: 0, file10: 0 };
for (const q of qs) {
  const qq = ftsq(q.q); if (!qq) continue;
  const targets = q.files.split(","); res.n++;
  const s = at("sym", qq, 10), f = at("file", qq, 10);
  const hit = (list, k) => list.slice(0, k).some((p) => targets.includes(p));
  if (hit(s, 5)) res.sym5++; if (hit(s, 10)) res.sym10++; if (hit(f, 5)) res.file5++; if (hit(f, 10)) res.file10++;
}
console.log(JSON.stringify({ ...res, indexBytes: { symbolsAndDocs: symBytes, wholeFiles: fileBytes }, kinds: qs.reduce((a, q) => ((a[q.kind] = (a[q.kind] || 0) + 1), a), {}) }));
