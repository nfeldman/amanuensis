#!/usr/bin/env node
// GATE SO21 (design/store-only/PLAN.md §6, §8 SO21, D10, D15) — the publication
// chain and its copies are HTML-only.
//
//   exit 0  `GATE SO21 GREEN`          — every assertion held
//   exit 1  `GATE SO21 RED: <reason>`  — the first assertion that did not
//
// Turns red when:
//   - a clean publish of a seeded fixture store does not write the content-free
//     `README.md` (D10), or writes any other `.md`, or the README differs between
//     two stores that hold different survey content, or names anything a survey
//     recorded (the project, a subsystem title, a sentinel sentence), or does not
//     point at `index.html`; or the receipt and the manifest do not claim it, so a
//     second clean publish or a copy would treat it as somebody else's file;
//   - the read-back accepts a README that was edited, or one that was deleted;
//   - `dev/promote-docs.mjs` over a temp copy of that publication does not carry
//     the same file set (HTML, `search-index.js`, both receipt files, README, and
//     no other `.md`); does not run the read-back at the destination, or does not
//     stop on a red one and restore what was there; promotes a source that holds
//     a Markdown page the contract names, or no README; or does not refuse a
//     destination holding a file no manifest claims (a `.txt` and a `.md`);
//   - any of the six `dev/` readers of `docs/` still opens a `.md` page (a
//     `docs/…​.md` path, an `.md` filter, or a bare page name ending `.md`);
//   - the republish chain's promote step (`dev/republish-docs.mjs`) stops on the
//     generated README, or lets a new page beside it through: EX7's check of that
//     step (`dev/test-republish-chain.mjs`) is absent, not run, or not ok;
//   - `dev/read-html-page.mjs`'s `articleOf` stops at the close of a record
//     article inside the page's own, or reads past the page's article;
//   - `dev/measure-reader-prose.mjs` counts a `.md` beside the HTML pages it is
//     given, counts the rail or a figure's drawing, or reports other than the
//     hand-worked counts of the HTML fixture below.
//
// The fixture is the store `materializer/test-store-only-html-only.py` seeds,
// built here by the same helpers. Nothing touches a real store: every path is
// under one temporary directory, and the read-back the chain runs is the
// materializer's own `--readback-only`.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "..");
const MATERIALIZER_DIR = join(REPO, "materializer");
const PYTHON = process.env.AMANUENSIS_PYTHON ?? "python3";
const CONTRACT = ".projection-contract.json";
const MANIFEST = ".manifest.json";
const README = "README.md";
const SENTINEL = "ZEBRA-SENTINEL-4471";

const READERS = [
  "dev/test-reader-lenses-dogfood.mjs",
  "dev/test-rebuild-readback.mjs",
  "dev/test-explanations-published.mjs",
  "dev/test-republish-chain.mjs",
  "dev/test-receipt-gates-restored.mjs",
];
// What a reader of a published page must not open any more.
const MARKDOWN_PAGE_USES = [
  { what: "a docs/ path ending .md", pattern: /docs(?:-not)?\/(?!README\.md\b)[^\s"'`)]*\.md\b/ },
  { what: "an .md filter", pattern: /endsWith\(\s*["']\.md["']\s*\)|\\\.md\$|\(md\|html\)/ },
  {
    what: "a bare page name ending .md",
    pattern: /["'`/](?:index|architecture|findings|keep|master-plan|entry-point|new-page|brand-new-page|renamed)\.md\b/,
  },
];

class Red extends Error {}
const red = (reason) => {
  throw new Red(reason);
};
const failures = [];
function check(label, fn) {
  try {
    const reason = fn();
    if (reason) failures.push(`${label}: ${reason}`);
  } catch (error) {
    failures.push(`${label}: raised while checking — ${error instanceof Error ? error.message : String(error)}`);
  }
}

const scratch = mkdtempSync(join(tmpdir(), "so21-chain-"));
process.on("exit", () => {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function walk(root, prefix = "") {
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(root, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: REPO, encoding: "utf8", timeout: 240_000, maxBuffer: 64 * 1024 * 1024, ...options });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

function lastJson(text) {
  const last = text.trim().split("\n").filter(Boolean).pop();
  try {
    return last ? JSON.parse(last) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Seeding: the same store the HTML-only gate publishes, plus an optional extra
// sentence in the entry point so a second store holds different survey content.
// ---------------------------------------------------------------------------
const SEED = `
import importlib.util, sqlite3, sys
from pathlib import Path

root, storage, extra = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
sys.path.insert(0, str(root))

def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), root / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

golden = load("make-golden")
fixture = load("test-materializer")
from store_only_seed import import_onboarding

storage.mkdir(parents=True, exist_ok=True)
(storage / "workspace_path").write_text("/example/FictionalProject\\n")
db = sqlite3.connect(storage / "memory.db")
fixture.seed(db)
import_onboarding(
    db,
    session_id="s1",
    entry_point=golden.MATERIALIZER_ENTRY_POINT + (("\\n\\n" + extra + "\\n") if extra else ""),
    onboarding_report=golden.MATERIALIZER_ONBOARDING,
    concern_checklist=golden.MATERIALIZER_CHECKLIST,
    ref_sha="deadbeef",
)
db.commit()
db.close()
`;

function seed(name, extra = "") {
  const storage = join(scratch, name);
  const result = run(PYTHON, ["-c", SEED, MATERIALIZER_DIR, storage, extra]);
  if (result.status !== 0) red(`the fixture store ${name} could not be seeded (exit ${result.status})`);
  return storage;
}

function publish(storage) {
  const result = run(PYTHON, [join(MATERIALIZER_DIR, "materialize.py"), "--storage", storage, "--clean-publish"], { cwd: MATERIALIZER_DIR });
  return { ...result, summary: lastJson(result.stdout) };
}

function readback(storage, directory, python = PYTHON) {
  const result = run(python, [join(MATERIALIZER_DIR, "materialize.py"), "--storage", storage, "--output", directory, "--readback-only"], { cwd: MATERIALIZER_DIR });
  return { ...result, summary: lastJson(result.stdout) };
}

function promote(source, destination, storage, extra = [], env = {}) {
  const result = run(process.execPath, [join(REPO, "dev/promote-docs.mjs"), "--source", source, "--destination", destination, "--storage", storage, ...extra], {
    env: { ...process.env, ...env },
  });
  return { ...result, summary: lastJson(result.stdout) };
}

/** Rewrites a directory's contract so it claims exactly the pages given, hashed from disk. */
function reseal(directory, pages) {
  const contract = JSON.parse(readFileSync(join(directory, CONTRACT), "utf8"));
  contract.pages = pages.map((path) => ({ path, content_hash: sha256(readFileSync(join(directory, path))) }));
  writeFileSync(join(directory, CONTRACT), `${JSON.stringify(contract, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// The publication
// ---------------------------------------------------------------------------
let storageA = null;
let storageB = null;
let docsA = null;
let docsB = null;

try {
  storageA = seed("store-a");
  storageB = seed("store-b", `The ${SENTINEL} sentence the survey wrote.`);
} catch (error) {
  if (!(error instanceof Red)) throw error;
  console.log(`GATE SO21 RED: ${error.message}`);
  process.exit(1);
}

const publicationA = publish(storageA);
const publicationB = publish(storageB);
docsA = join(storageA, "docs");
docsB = join(storageB, "docs");
const published = publicationA.status === 0 && publicationA.summary?.ok === true && publicationB.status === 0 && publicationB.summary?.ok === true;

check("a clean publish of the fixture stores succeeds", () =>
  published ? null : `the clean publish exited ${publicationA.status}/${publicationB.status} (${JSON.stringify(publicationA.summary ?? {}).slice(0, 200)})`,
);

const filesA = published ? walk(docsA) : [];
const AUXILIARY = new Set([CONTRACT, MANIFEST, "search-index.js", README]);

check("the publication holds HTML pages, the index, the two receipt files and the README, and no other .md", () => {
  if (!published) return "no publication";
  if (!filesA.includes(README)) return `the publication has no ${README} (D10): GitHub's directory view would show a bare list of .html source`;
  const stray = filesA.filter((rel) => !rel.endsWith(".html") && !AUXILIARY.has(rel));
  if (stray.length) return `the publication holds ${stray.length} file(s) that are neither a page nor a named auxiliary: ${stray.slice(0, 4).join(", ")}`;
  const markdown = filesA.filter((rel) => rel.endsWith(".md") && rel !== README);
  if (markdown.length) return `the publication holds ${markdown.length} .md page(s): ${markdown.slice(0, 4).join(", ")}`;
  return filesA.filter((rel) => rel.endsWith(".html")).length >= 10 ? null : "the publication holds fewer than ten HTML pages";
});

check("the README is the same bytes for two stores holding different survey content, and points at index.html", () => {
  if (!published) return "no publication";
  if (!existsSync(join(docsA, README)) || !existsSync(join(docsB, README))) return `${README} is missing from a publication`;
  const a = readFileSync(join(docsA, README), "utf8");
  const b = readFileSync(join(docsB, README), "utf8");
  if (a !== b) return "the README of one store differs from the other's: it carries something the survey recorded";
  if (!a.includes("index.html")) return "the README does not point at index.html";
  if (a.length > 1200) return `the README is ${a.length} characters: it is a pointer, not a document`;
  return null;
});

check("the README carries no survey content: not the project, a subsystem title, a finding id or the sentinel", () => {
  if (!published || !existsSync(join(docsA, README))) return "no README";
  const readme = readFileSync(join(docsA, README), "utf8");
  const titles = new Set(["FictionalProject", SENTINEL]);
  for (const rel of filesA.filter((path) => path.startsWith("subsystems/") && path.endsWith(".html"))) {
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(readFileSync(join(docsA, rel), "utf8"));
    if (h1) titles.add(h1[1].replace(/<[^>]+>/g, "").trim());
  }
  for (const title of titles) {
    if (title.length > 3 && readme.toLowerCase().includes(title.toLowerCase())) return `the README names ${JSON.stringify(title)}`;
  }
  if (/\b(?:B-\d\d|[A-Z]\d\d-\d+)\b/.test(readme)) return "the README names a subsystem or finding id";
  return null;
});

check("the receipt and the manifest both claim the README, with the bytes on disk", () => {
  if (!published || !existsSync(join(docsA, README))) return "no README";
  const contract = JSON.parse(readFileSync(join(docsA, CONTRACT), "utf8"));
  const page = (contract.pages ?? []).find((entry) => entry.path === README);
  if (!page) return `the receipt does not list ${README}`;
  if (page.content_hash !== sha256(readFileSync(join(docsA, README)))) return `the receipt's hash for ${README} is not the file's`;
  const manifest = JSON.parse(readFileSync(join(docsA, MANIFEST), "utf8"));
  if (!(manifest.projection_files ?? []).some((entry) => entry.path === README)) return `the manifest's projection files do not list ${README}`;
  return null;
});

check("a second clean publish over the first is not refused for the README", () => {
  if (!published) return "no publication";
  const again = publish(storageA);
  if (again.status !== 0 || again.summary?.ok !== true) {
    return `the second clean publish exited ${again.status}: ${String(again.summary?.error ?? again.stderr).slice(0, 200)}`;
  }
  return existsSync(join(docsA, README)) ? null : "the second publish dropped the README";
});

check("the read-back is green on an untouched copy and red on an edited or a deleted README", () => {
  if (!published) return "no publication";
  const copy = join(scratch, "readback-copy");
  cpSync(docsA, copy, { recursive: true });
  const green = readback(storageA, copy);
  if (green.status !== 0 || green.summary?.ok !== true) return `the read-back of an untouched copy is not green: ${JSON.stringify(green.summary ?? {}).slice(0, 200)}`;
  writeFileSync(join(copy, README), `${readFileSync(join(copy, README), "utf8")}\nThe survey found B-01 is mapped.\n`);
  const edited = readback(storageA, copy);
  if (edited.status === 0 || edited.summary?.ok === true) return "the read-back accepted a README that carries survey content";
  writeFileSync(join(copy, README), readFileSync(join(docsA, README), "utf8"));
  rmSync(join(copy, README));
  const deleted = readback(storageA, copy);
  if (deleted.status === 0 || deleted.summary?.ok === true) return "the read-back accepted a publication whose README was deleted";
  return null;
});

// ---------------------------------------------------------------------------
// promote-docs over a temp copy
// ---------------------------------------------------------------------------
check("promote carries exactly the publication's files to a new destination, and reads back there", () => {
  if (!published) return "no publication";
  const source = join(scratch, "source-copy");
  cpSync(docsA, source, { recursive: true });
  const destination = join(scratch, "promoted");
  const receipt = join(scratch, "promotion.json");
  const result = promote(source, destination, storageA, ["--receipt", receipt]);
  if (result.status !== 0) return `promote exited ${result.status}: ${(result.stderr || JSON.stringify(result.summary)).slice(0, 240)}`;
  const want = walk(source);
  const got = walk(destination);
  if (JSON.stringify(want) !== JSON.stringify(got)) {
    const missing = want.filter((rel) => !got.includes(rel));
    const extra = got.filter((rel) => !want.includes(rel));
    return `the copy's files differ from the publication's (missing ${missing.slice(0, 3).join(", ") || "none"}; extra ${extra.slice(0, 3).join(", ") || "none"})`;
  }
  for (const rel of want) {
    if (!readFileSync(join(source, rel)).equals(readFileSync(join(destination, rel)))) return `${rel} differs between the publication and its copy`;
  }
  const markdown = got.filter((rel) => rel.endsWith(".md") && rel !== README);
  if (markdown.length) return `the copy carries .md page(s): ${markdown.join(", ")}`;
  if (!got.includes(README)) return "the copy has no README";
  const summary = JSON.parse(readFileSync(receipt, "utf8"));
  if (summary.readback?.ok !== true) return "the promotion receipt does not record a green read-back";
  if (!summary.readback?.output_dir || realpathSync(summary.readback.output_dir) !== realpathSync(destination)) return `the recorded read-back ran at ${summary.readback?.output_dir}, not at the destination`;
  // A second promotion replaces a destination the first one wrote.
  const again = promote(source, destination, storageA);
  return again.status === 0 ? null : `promoting over a managed destination exited ${again.status}: ${(again.stderr || "").slice(0, 200)}`;
});

function stubPython(name, log, redDestination) {
  const stub = join(scratch, name);
  const lines = ["#!/bin/sh", `echo "$@" >> "${log}"`];
  if (redDestination) {
    lines.push(
      `case "$*" in *"--output ${redDestination} "*|*"--output ${redDestination}") echo '{"ok": false, "axes": {"state": {"ok": true}, "coverage": {"ok": false}, "content": {"ok": true}}, "mismatch_count": 2, "mode": "readback"}'; exit 1;; esac`,
    );
  }
  lines.push(`exec ${PYTHON} "$@"`, "");
  writeFileSync(stub, lines.join("\n"));
  chmodSync(stub, 0o755);
  return stub;
}

check("promote runs the read-back at the source and again at the destination", () => {
  if (!published) return "no publication";
  const source = join(scratch, "ran-source");
  cpSync(docsA, source, { recursive: true });
  const destination = join(scratch, "ran-destination");
  const log = join(scratch, "ran.log");
  const stub = stubPython("ran-stub.sh", log, null);
  const result = promote(source, destination, storageA, [], { AMANUENSIS_PYTHON: stub });
  if (result.status !== 0) return `promote exited ${result.status}: ${(result.stderr || "").slice(0, 200)}`;
  const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  const readbacks = calls.filter((call) => call.includes("--readback-only"));
  if (readbacks.length < 2) return `the read-back ran ${readbacks.length} time(s); it must run at the source and at the destination`;
  if (!readbacks.some((call) => call.includes(`--output ${resolve(destination)}`))) return "no read-back ran with the destination as its output";
  return null;
});

check("a red read-back at the destination stops the promotion, exits non-zero and restores the previous contents", () => {
  if (!published) return "no publication";
  const source = join(scratch, "red-source");
  cpSync(docsA, source, { recursive: true });
  const destination = join(scratch, "red-destination");
  const first = promote(source, destination, storageA);
  if (first.status !== 0) return `the setup promotion exited ${first.status}`;
  const before = walk(destination).map((rel) => [rel, sha256(readFileSync(join(destination, rel)))]);
  writeFileSync(join(source, "index.html"), `${readFileSync(join(source, "index.html"), "utf8")}<!-- changed -->\n`);
  reseal(source, JSON.parse(readFileSync(join(source, CONTRACT), "utf8")).pages.map((page) => page.path));
  const log = join(scratch, "red.log");
  const stub = stubPython("red-stub.sh", log, resolve(destination));
  const result = promote(source, destination, storageA, [], { AMANUENSIS_PYTHON: stub });
  if (result.status === 0) return "promote exited 0 after the read-back at the destination came back red";
  const after = walk(destination).map((rel) => [rel, sha256(readFileSync(join(destination, rel)))]);
  if (JSON.stringify(before) !== JSON.stringify(after)) return "the red promotion left the destination different from what was there";
  const beside = readdirSync(scratch).filter((name) => name.startsWith(".red-destination."));
  return beside.length ? `the red promotion left ${beside.join(", ")} beside the destination` : null;
});

check("promote refuses a source whose contract names a Markdown page, and leaves the destination alone", () => {
  if (!published) return "no publication";
  const source = join(scratch, "md-source");
  cpSync(docsA, source, { recursive: true });
  writeFileSync(join(source, "notes.md"), "# Notes\n\nA page nobody planned.\n");
  const pages = JSON.parse(readFileSync(join(source, CONTRACT), "utf8")).pages.map((page) => page.path);
  reseal(source, [...pages, "notes.md"]);
  const destination = join(scratch, "md-destination");
  mkdirSync(destination);
  writeFileSync(join(destination, "keep.txt"), "previous\n");
  const result = promote(source, destination, storageA);
  if (result.status === 0) return "promote carried a source whose contract names notes.md";
  if (!/\.md|markdown/i.test(`${result.stderr}${result.stdout}`)) return "the refusal does not name the Markdown page";
  return JSON.stringify(walk(destination)) === JSON.stringify(["keep.txt"]) ? null : "the refused promotion changed the destination";
});

check("promote refuses a publication with no README", () => {
  if (!published) return "no publication";
  const source = join(scratch, "no-readme-source");
  cpSync(docsA, source, { recursive: true });
  rmSync(join(source, README));
  reseal(source, JSON.parse(readFileSync(join(source, CONTRACT), "utf8")).pages.map((page) => page.path).filter((path) => path !== README));
  const manifest = JSON.parse(readFileSync(join(source, MANIFEST), "utf8"));
  manifest.projection_files = (manifest.projection_files ?? []).filter((entry) => entry.path !== README);
  writeFileSync(join(source, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  const destination = join(scratch, "no-readme-destination");
  const result = promote(source, destination, storageA);
  if (result.status === 0) return "promote carried a publication that has no README";
  if (!/readme/i.test(`${result.stderr}${result.stdout}`)) return "the refusal does not name the README";
  return existsSync(destination) ? "the refused promotion created the destination" : null;
});

for (const stray of ["stray.txt", "stray.md"]) {
  check(`promote refuses a destination holding a file no manifest claims (${stray})`, () => {
    if (!published) return "no publication";
    const source = join(scratch, `stray-source-${stray}`);
    cpSync(docsA, source, { recursive: true });
    const destination = join(scratch, `stray-destination-${stray}`);
    const first = promote(source, destination, storageA);
    if (first.status !== 0) return `the setup promotion exited ${first.status}`;
    writeFileSync(join(destination, stray), "somebody else's file\n");
    const before = walk(destination);
    const result = promote(source, destination, storageA);
    if (result.status === 0) return `promote replaced a destination holding ${stray}`;
    if (!result.stderr.includes(stray) && !JSON.stringify(result.summary).includes(stray)) return `the refusal does not name ${stray}`;
    return JSON.stringify(walk(destination)) === JSON.stringify(before) ? null : "the refusal changed the destination";
  });
}

// ---------------------------------------------------------------------------
// The readers
// ---------------------------------------------------------------------------
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .map((line) => line.replace(/\s\/\/\s.*$/, ""))
    .join("\n");
}

for (const reader of READERS) {
  check(`${reader} reads no .md page`, () => {
    const path = join(REPO, reader);
    if (!existsSync(path)) return "the reader is absent";
    const code = codeOnly(readFileSync(path, "utf8"));
    for (const { what, pattern } of MARKDOWN_PAGE_USES) {
      const found = pattern.exec(code);
      if (found) return `it still uses ${what}: ${JSON.stringify(found[0])}`;
    }
    return null;
  });
}

// The republish chain's promote step accepts the generated README and nothing beside it
// (D10). EX7 drives that step through its stubbed world; SO21 requires its check to pass.
const README_CHECK = "a promotion that adds only the generated README does not stop the run, and a page beside it still does";
check("the republish chain's promote step accepts the generated README and still stops on a new page beside it", () => {
  const chainTest = join(REPO, "dev/test-republish-chain.mjs");
  if (!existsSync(chainTest)) return "dev/test-republish-chain.mjs is absent";
  if (!readFileSync(chainTest, "utf8").includes(README_CHECK)) return "dev/test-republish-chain.mjs no longer checks the README promotion";
  const result = run(process.execPath, [chainTest]);
  const lines = result.stdout.split("\n").map((line) => line.trim());
  if (lines.includes(`ok      ${README_CHECK}`)) return null;
  return lines.includes(`not ok  ${README_CHECK}`)
    ? `the README promotion check failed: ${result.stdout.split("\n").filter((line) => line.startsWith("GATE ")).pop() ?? "(no gate line)"}`
    : "the README promotion check did not run";
});

// A page's article holds record articles of its own (findings, dispositions, runtime
// boundaries); the reader must return the outer article whole, not stop at the first close.
const NESTED_ARTICLE = [
  '<main><article class="content content-fixture">',
  "<p>Before the records.</p>",
  '<article class="record" data-record="finding:F-1"><p>The first record.</p></article>',
  '<article class="record" data-record="finding:F-2"><p>The second record.</p></article>',
  "<p>No purpose statement is recorded for this subsystem.</p>",
  "</article></main><footer><article><p>Not the page.</p></article></footer>",
].join("\n");
let pageReader = null;
try {
  pageReader = await import(join(REPO, "dev/read-html-page.mjs"));
} catch (error) {
  pageReader = { error: error instanceof Error ? error.message : String(error) };
}
check("the page reader returns an article holding record articles whole, and nothing after it", () => {
  if (typeof pageReader?.articleOf !== "function") return `dev/read-html-page.mjs gives no articleOf (${pageReader?.error ?? "not exported"})`;
  const article = pageReader.articleOf(NESTED_ARTICLE);
  if (article === null) return "articleOf found no article";
  const text = pageReader.textOf(article);
  for (const line of ["Before the records.", "The first record.", "The second record.", "No purpose statement is recorded for this subsystem."]) {
    if (!text.includes(line)) return `the article read back without ${JSON.stringify(line)}: ${JSON.stringify(text)}`;
  }
  return text.includes("Not the page.") ? "the article read on past its own close into the footer" : null;
});

const HTML_FIXTURE = [
  '<!doctype html><html><body><nav class="rail"><p>Rail text that is not the page.</p></nav><main>',
  '<article class="content content-fixture">',
  '<h2 id="a">A heading that is not prose</h2>',
  "<p>Alpha beta.</p>",
  "<ul><li>One item</li><li>Two <code>x</code> here</li></ul>",
  '<div class="table-wrap"><table><caption>A caption</caption><thead><tr><th>Name</th><th>Value</th></tr></thead>',
  "<tbody><tr><td>alpha</td><td>12345</td></tr><tr><td>be</td><td>7</td></tr></tbody></table></div>",
  "<pre>fenced | text that is neither</pre>",
  '<figure data-diagram><svg role="img"><title>The drawing</title><desc>Its description</desc></svg><figcaption>Readable account.</figcaption></figure>',
  "<p>No purpose statement is recorded for this subsystem.</p>",
  "<p><strong>Domain vocabulary</strong> — not recorded</p>",
  "</article></main></body></html>",
  "",
].join("\n");
// Prose: 11 + 8 + 10 + 17 + 52 + 32 = 130. Table cells: 4+5 + 5+5 + 2+1 = 22.
const HTML_EXPECTED = { table_chars: 22, prose_chars: 130, table_share: 0.1447, placeholders: 2 };

check("the reader-prose measure reads the HTML pages and only those, and reports the fixture's hand-worked counts", () => {
  const script = join(REPO, "dev/measure-reader-prose.mjs");
  if (!existsSync(script)) return "dev/measure-reader-prose.mjs is absent";
  const docs = join(scratch, "measure-docs");
  mkdirSync(join(docs, "subsystems"), { recursive: true });
  writeFileSync(join(docs, "a.html"), HTML_FIXTURE);
  writeFileSync(join(docs, "a.md"), "A Markdown page beside the HTML that must not be counted at all.\n| t | x |\n");
  writeFileSync(join(docs, README), "A README that is not a page.\n");
  writeFileSync(join(docs, "search-index.js"), "window.x = 1;\n");
  const result = run(process.execPath, [script, docs]);
  if (result.status !== 0) return `the measure exited ${result.status} over an HTML publication`;
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    return "the measure did not print JSON";
  }
  const pages = (report.pages ?? []).map((page) => page.page);
  if (JSON.stringify(pages) !== JSON.stringify(["a.html"])) return `the measure counted ${JSON.stringify(pages)}, not only a.html`;
  for (const [key, want] of Object.entries(HTML_EXPECTED)) {
    if (report.pages[0][key] !== want) return `a.html: ${key} is ${JSON.stringify(report.pages[0][key])}, expected ${want}`;
  }
  if (report.totals?.pages !== 1 || report.totals?.prose_chars !== 130 || report.totals?.table_chars !== 22) {
    return `the totals are ${JSON.stringify(report.totals)}`;
  }
  const markdownOnly = join(scratch, "measure-md-only");
  mkdirSync(markdownOnly);
  writeFileSync(join(markdownOnly, "a.md"), "Prose.\n");
  const forced = run(process.execPath, [script, markdownOnly, "--basis", "html"]);
  const forcedReport = forced.status === 0 ? JSON.parse(forced.stdout) : null;
  if (!forcedReport || forcedReport.totals?.pages !== 0) return "the measure over HTML counted a Markdown-only directory's page";
  return null;
});

// ---------------------------------------------------------------------------
// A captured message can quote a tool's own error text; the gate's line never carries a crash signature.
const CRASH = /Cannot find module|MODULE_NOT_FOUND|ModuleNotFoundError|SyntaxError|No such file or directory|ENOENT|ImportError|ReferenceError|is not defined|command not found|Traceback \(most recent call last\)/g;
if (failures.length) {
  console.log(`GATE SO21 RED: ${failures.length} assertion(s) failed; first: ${failures[0].replace(CRASH, "(tool error)")}`);
  process.exit(1);
}
console.log("GATE SO21 GREEN");
