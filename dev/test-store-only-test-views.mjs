#!/usr/bin/env node
// GATE SO12 (design/store-only/PLAN.md §8 SO12, §3.2 step 2, §11).
//
// Turns red when:
//   - a listed test file is absent or unreadable;
//   - a listed test names a generated Markdown page: any string literal, or any bare regular
//     expression, that contains `.md` and is not covered by an entry in ALLOWED below (the
//     exceptions are imported inputs and negative assertions, each with its reason; the same
//     list goes in the commit message);
//   - an ALLOWED entry no longer matches anything (a stale exception hides a regression), or
//     matches more literals than its stated count;
//   - a test that read a generated page at the packet's start no longer names an HTML page
//     literal more often than it did then (the assertions were deleted, not moved);
//   - a listed test has fewer assertion lines than it had at the packet's start, beyond the
//     number its NO_HTML_EQUIVALENT entries name (a Markdown-only assertion with no HTML
//     equivalent is listed here and in the commit message, with its reason, never dropped);
//   - the moved suites do not pass when run (a fast sample is run here; the full suites are the
//     packet's regression list);
//   - the gate is not a step in .github/workflows/test.yml.
// The scan reads test source only. It cannot tell a moved assertion from a weakened one that
// still names an HTML page; the regression suites and review do that.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function red(reason) {
  console.log(`GATE SO12 RED: ${reason}`);
  process.exit(1);
}

const PY_TESTS = [
  "test-claim-register",
  "test-explanation-orientation",
  "test-explanation-pages",
  "test-history-and-disagreements",
  "test-ledger-freshness",
  "test-ledger-grouping",
  "test-lens-pages",
  "test-materializer",
  "test-narrative-placement",
  "test-orientation-cli-render",
  "test-orientation-diagram",
  "test-orientation-guide",
  "test-orientation-ids",
  "test-orientation-index",
  "test-orientation-map",
  "test-orientation-overview",
  "test-orientation-readback-label",
  "test-orientation-survey-notes",
  "test-orientation-terms",
  "test-orientation-views",
  "test-orientation-workflow",
  "test-overview-truthfulness",
  "test-placeholder-census",
  "test-prose-retention",
  "test-readback",
  "test-search-index",
  "test-severity-history",
  "test-unmeasured-coverage",
  "test-xref-moved-target",
].map((name) => `materializer/${name}.py`);

const MJS_TESTS = [
  "test-finding-partition",
  "test-projection-custody",
  "test-edge-contract",
  "test-structural-claims",
  "test-residual-hardening",
  "test-invariants",
].map((name) => `mcp-server/${name}.mjs`);

const TESTS = [...PY_TESTS, ...MJS_TESTS];

// Per file at the packet's start (91f2688): assertion lines, literals naming an .html page.
// Only files that named a generated .md page then are held to the second figure.
const BASE = {
  "materializer/test-claim-register.py": { assertions: 11, htmlCount: 0, readMd: false },
  "materializer/test-explanation-orientation.py": { assertions: 20, htmlCount: 9, readMd: true },
  "materializer/test-explanation-pages.py": { assertions: 27, htmlCount: 4, readMd: true },
  "materializer/test-history-and-disagreements.py": { assertions: 30, htmlCount: 4, readMd: true },
  "materializer/test-ledger-freshness.py": { assertions: 24, htmlCount: 9, readMd: true },
  "materializer/test-ledger-grouping.py": { assertions: 13, htmlCount: 0, readMd: true },
  "materializer/test-lens-pages.py": { assertions: 36, htmlCount: 7, readMd: true },
  "materializer/test-materializer.py": { assertions: 207, htmlCount: 22, readMd: true },
  "materializer/test-narrative-placement.py": { assertions: 8, htmlCount: 0, readMd: true },
  "materializer/test-orientation-cli-render.py": { assertions: 24, htmlCount: 8, readMd: true },
  "materializer/test-orientation-diagram.py": { assertions: 17, htmlCount: 3, readMd: true },
  "materializer/test-orientation-guide.py": { assertions: 31, htmlCount: 5, readMd: true },
  "materializer/test-orientation-ids.py": { assertions: 21, htmlCount: 5, readMd: true },
  "materializer/test-orientation-index.py": { assertions: 16, htmlCount: 6, readMd: true },
  "materializer/test-orientation-map.py": { assertions: 19, htmlCount: 9, readMd: true },
  "materializer/test-orientation-overview.py": { assertions: 13, htmlCount: 12, readMd: true },
  "materializer/test-orientation-readback-label.py": { assertions: 12, htmlCount: 5, readMd: true },
  "materializer/test-orientation-survey-notes.py": { assertions: 10, htmlCount: 0, readMd: true },
  "materializer/test-orientation-terms.py": { assertions: 15, htmlCount: 4, readMd: true },
  "materializer/test-orientation-views.py": { assertions: 13, htmlCount: 12, readMd: true },
  "materializer/test-orientation-workflow.py": { assertions: 23, htmlCount: 8, readMd: true },
  "materializer/test-overview-truthfulness.py": { assertions: 36, htmlCount: 1, readMd: true },
  "materializer/test-placeholder-census.py": { assertions: 41, htmlCount: 0, readMd: true },
  "materializer/test-prose-retention.py": { assertions: 23, htmlCount: 14, readMd: true },
  "materializer/test-readback.py": { assertions: 26, htmlCount: 4, readMd: true },
  "materializer/test-search-index.py": { assertions: 40, htmlCount: 17, readMd: false },
  "materializer/test-severity-history.py": { assertions: 8, htmlCount: 0, readMd: true },
  "materializer/test-unmeasured-coverage.py": { assertions: 37, htmlCount: 1, readMd: true },
  "materializer/test-xref-moved-target.py": { assertions: 6, htmlCount: 5, readMd: true },
  "mcp-server/test-finding-partition.mjs": { assertions: 23, htmlCount: 1, readMd: true },
  "mcp-server/test-projection-custody.mjs": { assertions: 18, htmlCount: 0, readMd: true },
  "mcp-server/test-edge-contract.mjs": { assertions: 30, htmlCount: 0, readMd: false },
  "mcp-server/test-structural-claims.mjs": { assertions: 27, htmlCount: 0, readMd: false },
  "mcp-server/test-residual-hardening.mjs": { assertions: 30, htmlCount: 0, readMd: false },
  "mcp-server/test-invariants.mjs": { assertions: 69, htmlCount: 0, readMd: false },
};

// Literals that may keep `.md`: `{ file, re, count, why }`. `re` is tested on the literal's
// text; `count` is how many literals it must cover exactly.
const ALLOWED = [
  // mcp-server: the composition run's artifact reference is an input the test registers, never a page.
  { file: "mcp-server/test-finding-partition.mjs", re: /^missing-report\.md$/, count: 2, why: "composition artifact path, an input" },
  // The legacy survey file and its registry row: the test seeds what an earlier server wrote.
  { file: "mcp-server/test-structural-claims.mjs", re: /^B-02-index\.md$/, count: 1, why: "imported survey file name, an input" },
  { file: "mcp-server/test-structural-claims.mjs", re: /imported_artifacts WHERE path = 'B-02-index\.md'/, count: 1, why: "the import registry row of that file" },
  { file: "mcp-server/test-structural-claims.mjs", re: /^\.md$/, count: 1, why: "negative: the narrative pointer names no file path" },
  { file: "mcp-server/test-invariants.mjs", re: /\.amanuensis\/docs\/index\.md/, count: 2, why: "reserved-path inputs the guard must refuse" },
  { file: "mcp-server/test-edge-contract.mjs", re: /phase-2-structural\.md/, count: 2, why: "a skill reference document, not a generated page" },
  // Imported inputs: names the import helpers and seeded registry rows are given.
  { file: "materializer/test-explanation-pages.py", re: /survey\.md$/, count: 1, why: "imported survey file name, an input" },
  { file: "materializer/test-narrative-placement.py", re: /survey\.md$/, count: 1, why: "imported survey file name, an input" },
  { file: "materializer/test-orientation-survey-notes.py", re: /survey\.md$/, count: 2, why: "imported survey file names, inputs" },
  { file: "materializer/test-prose-retention.py", re: /^B-01-read-path\.md$/, count: 1, why: "imported survey file name, an input" },
  { file: "materializer/test-materializer.py", re: /^(entry-point|onboarding-report|entry-point-updated)\.md$/, count: 4, why: "seeded artifact paths and imported file names, inputs" },
  { file: "materializer/test-ledger-freshness.py", re: /'survey\.md'/, count: 1, why: "seeded imported_artifacts path in a SQL insert" },
  { file: "materializer/test-overview-truthfulness.py", re: /'survey\.md'/, count: 1, why: "seeded entries.source_path in a SQL insert" },
  { file: "materializer/test-lens-pages.py", re: /^(README|docs\/guide)\.md$/, count: 2, why: "tracked repository paths in the fixture ledger" },
  { file: "materializer/test-search-index.py", re: /^(README|docs\/guide)\.md$/, count: 2, why: "seeded scope_gaps repository paths" },
  { file: "materializer/test-unmeasured-coverage.py", re: /^docs\/guide\.md$/, count: 3, why: "a tracked repository path in the fixture ledger" },
  // Source documents the tests read: repository design documents and the skill's references.
  { file: "materializer/test-ledger-grouping.py", re: /reporting-style\.md/, count: 2, why: "the skill's reporting-style reference" },
  { file: "materializer/test-prose-retention.py", re: /reporting-style\.md/, count: 2, why: "the skill's reporting-style reference" },
  { file: "materializer/test-orientation-guide.py", re: /spec\.md|PLAN\.md/, count: 4, why: "design documents the guide must point to" },
  { file: "materializer/test-placeholder-census.py", re: /^(onboarding|phase-5-packaging)\.md|^\*\.md$|^(onboarding|phase-5-packaging)\.md /, count: 14, why: "the skill's onboarding and packaging references" },
];

// Markdown-only assertions deleted because the HTML view has no equivalent:
// `{ file, count, why }`; each lowers that file's assertion floor by `count`.
const NO_HTML_EQUIVALENT = [];

// A test rewritten after this packet for a deliberate page change. Its page literals no longer
// measure this packet's migration, so only its assertion count is held to the start's figure.
const REWRITTEN = {
  "materializer/test-orientation-overview.py":
    "O9 rewritten 2026-11-26 for the two-part overview; the figures it read moved to about.html",
};

// ---------------------------------------------------------------------------
// Literal scanner: string literals (not comments), plus bare `.md` in code (regex literals).
// ---------------------------------------------------------------------------

function scan(source, python) {
  const out = []; // { text, line, kind }
  const n = source.length;
  let i = 0;
  let line = 1;
  let lastSignificant = ""; // last non-space, non-comment character before i
  const bump = (c) => {
    if (c === "\n") line += 1;
  };
  while (i < n) {
    const c = source[i];
    if (python && c === "#") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (!python && c === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (!python && c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      for (; i < stop; i += 1) bump(source[i]);
      continue;
    }
    if (c === '"' || c === "'" || (!python && c === "`")) {
      const triple = python && source.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      const startLine = line;
      let j = i + quote.length;
      let text = "";
      while (j < n) {
        if (source[j] === "\\") {
          text += source[j] + (source[j + 1] ?? "");
          bump(source[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (source.startsWith(quote, j)) break;
        if (!triple && !(c === "`") && source[j] === "\n") break;
        bump(source[j]);
        text += source[j];
        j += 1;
      }
      const docstring = triple && (lastSignificant === "" || lastSignificant === ":");
      if (!docstring) out.push({ text, line: startLine, kind: "literal" });
      i = j + quote.length;
      lastSignificant = quote[0];
      continue;
    }
    if (c === "\n") {
      line += 1;
    } else if (!/\s/.test(c)) {
      lastSignificant = c;
      if (c === "." && /^\.md\b/.test(source.slice(i, i + 5))) {
        out.push({ text: source.slice(i, i + 12), line, kind: "code" });
      }
      if (c === "\\" && /^\\\.md\b/.test(source.slice(i, i + 6))) {
        out.push({ text: source.slice(i, i + 12), line, kind: "code" });
      }
    }
    i += 1;
  }
  return out;
}

const MD = /\.md\b/;
const HTML = /\.html\b/;
const ASSERTION =
  /^\s*assert\b|\bassert\w*\(|\bcheck\w*\(|\bexpect\w*\(|^\s*(?:failures|FAILURES|problems|fails)\.append/;

function load(path) {
  const full = join(root, path);
  if (!existsSync(full)) red(`${path} is absent`);
  try {
    return readFileSync(full, "utf8");
  } catch {
    red(`${path} is unreadable`);
  }
  return "";
}

const problems = [];
const stats = {};
for (const path of TESTS) {
  const source = load(path);
  const items = scan(source, path.endsWith(".py"));
  const mdItems = items.filter((item) => MD.test(item.text) || item.kind === "code");
  const htmlCount = items.filter((item) => HTML.test(item.text)).length;
  const assertions = source.split("\n").filter((l) => ASSERTION.test(l)).length;
  stats[path] = { mdItems, htmlCount, assertions };
}

// 1. Every literal that names `.md` is a declared exception.
const used = ALLOWED.map(() => 0);
for (const path of TESTS) {
  for (const item of stats[path].mdItems) {
    const hit = ALLOWED.findIndex((a) => a.file === path && a.re.test(item.text));
    if (hit === -1) {
      problems.push(`${path}:${item.line} reads a generated .md page (${item.text.trim().slice(0, 60)})`);
    } else {
      used[hit] += 1;
    }
  }
}
ALLOWED.forEach((a, k) => {
  if (used[k] !== a.count) {
    problems.push(`allowed exception for ${a.file} (${a.re}) covers ${used[k]} literal(s), not ${a.count}`);
  }
});

// 2. The assertions moved; they were not deleted.
for (const path of TESTS) {
  const base = BASE[path];
  if (!base) {
    problems.push(`${path} has no recorded starting figures`);
    continue;
  }
  const dropped = NO_HTML_EQUIVALENT.filter((e) => e.file === path).reduce((sum, e) => sum + e.count, 0);
  if (stats[path].assertions < base.assertions - dropped) {
    problems.push(
      `${path} has ${stats[path].assertions} assertion lines, fewer than the ${base.assertions} it started with (${dropped} declared dropped)`,
    );
  }
  if (base.readMd && !REWRITTEN[path] && stats[path].htmlCount <= base.htmlCount) {
    problems.push(`${path} read .md pages at the start but names no more .html pages than before`);
  }
}

if (problems.length > 0) {
  red(`${problems.length} problem(s); first: ${problems[0]}`);
}

// 3. A sample of the moved suites passes.
const SAMPLE = ["materializer/test-xref-moved-target.py", "materializer/test-readback.py", "mcp-server/test-projection-custody.mjs"];
for (const path of SAMPLE) {
  const cwd = join(root, dirname(path));
  const file = path.split("/").pop();
  const run = path.endsWith(".py")
    ? spawnSync("python3", [file], { cwd, encoding: "utf8", timeout: 300000 })
    : spawnSync("node", [file], { cwd, encoding: "utf8", timeout: 300000 });
  if (run.status !== 0) red(`${path} does not pass (exit ${run.status})`);
}

// 4. CI runs this gate.
const ci = load(".github/workflows/test.yml");
if (!/node dev\/test-store-only-test-views\.mjs/.test(ci)) red("the gate is not a step in .github/workflows/test.yml");

console.log("GATE SO12 GREEN");
