#!/usr/bin/env node
// GATE EX1 (design/explanation/spec.md §1) — the reader-prose measure.
//
//   exit 0  `GATE EX1 GREEN`          — every assertion held
//   exit 1  `GATE EX1 RED: <reason>`  — an assertion fired
//
// The measure is `dev/measure-reader-prose.mjs`. It is loaded by subprocess and
// by guarded dynamic import, so its absence prints the RED line and not a
// stack trace. A child's raw output is never echoed.
//
// The fixture is three pages whose counts are worked out here by hand. A
// character count is the length of a trimmed line; a table line counts the
// lengths of its trimmed cells, so the `|` delimiters and the padding around
// them are not text.
//
//   a-table.md                 every line is a table line
//       | Name  | Value |      "Name"4 + "Value"5            = 9
//       | ----- | ----- |      separator row                 = 0
//       | alpha | 12345 |      "alpha"5 + "12345"5           = 10
//       | be    | 7     |      "be"2 + "7"1                  = 3
//     table 22, prose 0, share 1, placeholders 0
//
//   b-fence.md                 a fenced block holding `|` characters
//       "# Title"                                heading      = 0
//       "Some prose here."                       prose        = 16
//       fenced block, `| not | a table |` inside              = 0 (neither)
//       "| a | b |"                              table        = 2
//       "|:-:|--:|"                              separator    = 0
//       "| xx | yyy |"                           table        = 5
//       "  | z | w |"   (indented)               table        = 2
//       "Trailing prose line."                   prose        = 20
//     table 9, prose 36, share 9/45 = 0.2, placeholders 0
//
//   subsystems/c-placeholders.md   two placeholder sentences
//       "No purpose statement is recorded for this subsystem."   = 52
//       "No structured runtime boundary map is recorded yet."    = 51
//     table 0, prose 103, share 0, placeholders 2
//
//   totals: 3 pages, table 22 + 9 = 31, prose 0 + 36 + 103 = 139,
//           share 31/170 = 0.1824, placeholders 2
//
// What a reviewer should sabotage, and what must go red:
//   count `|` delimiters or padding as table text        → table counts
//   count fenced lines as table or prose                 → page B
//   count the separator row                              → pages A, B
//   count headings as prose                              → pages B, C
//   return zeros                                         → every count
//   change a placeholder string, or add a seventh        → the pinned list
//   average the page shares for the totals               → totals
//   --record appends a duplicate instead of replacing    → record arm
//   --record leaves a replaced entry in its old position → record arm
//   drop the workflow step                               → the last assertion

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..");
const SCRIPT_REL = "dev/measure-reader-prose.mjs";
const SCRIPT = join(REPO, SCRIPT_REL);
const RECORD_REL = "design/explanation/reader-measure.json";
const WORKFLOW_REL = ".github/workflows/test.yml";
const COUNTS_PHRASE = "the reader-prose measure does not report the fixture's known counts";

const PLACEHOLDER_LITERALS = [
  "No thesis section is recorded",
  "The recorded thesis carries status vocabulary and was not published",
  "The recorded thesis presents a composite index of the record and was not published",
  "No purpose statement is recorded for this subsystem",
  "No structured runtime boundary map is recorded yet",
  "**Domain vocabulary** — not recorded",
];
const PLACEHOLDER_SHA256 = "39147504427621a97bd9ee212cf3fb08c96134c55a5aeb9a1cf05f2ece9898b2";

const FIXTURE = {
  "a-table.md": [
    "| Name  | Value |",
    "| ----- | ----- |",
    "| alpha | 12345 |",
    "| be    | 7     |",
    "",
  ].join("\n"),
  "b-fence.md": [
    "# Title",
    "",
    "Some prose here.",
    "",
    "```text",
    "| not | a table |",
    "plain fenced text",
    "```",
    "",
    "| a | b |",
    "|:-:|--:|",
    "| xx | yyy |",
    "  | z | w |",
    "",
    "Trailing prose line.",
    "",
  ].join("\n"),
  "subsystems/c-placeholders.md": [
    "# Subsystem",
    "",
    "No purpose statement is recorded for this subsystem.",
    "No structured runtime boundary map is recorded yet.",
    "",
  ].join("\n"),
  // Neither of these is a page.
  ".hidden.md": "| h | i |\nHidden prose that must not be counted.\n",
  "notes.txt": "| t | x |\nPlain text that must not be counted.\n",
};

const EXPECTED = {
  pages: [
    { page: "a-table.md", table_chars: 22, prose_chars: 0, table_share: 1, placeholders: 0 },
    { page: "b-fence.md", table_chars: 9, prose_chars: 36, table_share: 0.2, placeholders: 0 },
    {
      page: "subsystems/c-placeholders.md",
      table_chars: 0,
      prose_chars: 103,
      table_share: 0,
      placeholders: 2,
    },
  ],
  totals: { pages: 3, table_chars: 31, prose_chars: 139, table_share: 0.1824, placeholders: 2 },
};

const scratch = mkdtempSync(join(tmpdir(), "ex1-reader-measure-"));
process.on("exit", () => {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

function red(reason) {
  console.log(`GATE EX1 RED: ${reason}`);
  process.exit(1);
}

function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}

function runScript(args, cwd = REPO) {
  const run = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

// Returns the first difference between a report and the hand-worked counts,
// or null when every figure matches.
function compareReport(report) {
  if (!report || typeof report !== "object") return "no report";
  if (!Array.isArray(report.pages)) return "report has no pages array";
  if (report.pages.length !== EXPECTED.pages.length) {
    return `expected ${EXPECTED.pages.length} pages, got ${report.pages.length}`;
  }
  for (let i = 0; i < EXPECTED.pages.length; i += 1) {
    const want = EXPECTED.pages[i];
    const got = report.pages[i] ?? {};
    for (const key of Object.keys(want)) {
      if (got[key] !== want[key]) {
        return `page ${want.page}: ${key} is ${JSON.stringify(got[key])}, expected ${JSON.stringify(want[key])}`;
      }
    }
  }
  const totals = report.totals ?? {};
  for (const key of Object.keys(EXPECTED.totals)) {
    if (totals[key] !== EXPECTED.totals[key]) {
      return `totals: ${key} is ${JSON.stringify(totals[key])}, expected ${JSON.stringify(EXPECTED.totals[key])}`;
    }
  }
  return null;
}

// 1. The measure reports the fixture's known counts.
if (!existsSync(SCRIPT)) red(`${COUNTS_PHRASE}: ${SCRIPT_REL} is missing`);
const docs = join(scratch, "docs");
writeTree(docs, FIXTURE);
const measured = runScript([docs]);
if (measured.status !== 0) red(`${COUNTS_PHRASE}: the script exited ${measured.status} on the fixture`);
let report;
try {
  report = JSON.parse(measured.stdout);
} catch {
  red(`${COUNTS_PHRASE}: the script did not print JSON`);
}
const difference = compareReport(report);
if (difference) red(`${COUNTS_PHRASE}: ${difference}`);

// A stub that reports zeros must not satisfy the comparison.
const zeroStub = {
  pages: EXPECTED.pages.map((p) => ({
    page: p.page,
    table_chars: 0,
    prose_chars: 0,
    table_share: 0,
    placeholders: 0,
  })),
  totals: { pages: 3, table_chars: 0, prose_chars: 0, table_share: 0, placeholders: 0 },
};
if (compareReport(zeroStub) === null) red("a stub reporting zeros is accepted by the comparison");
if (compareReport({}) === null) red("an empty report is accepted by the comparison");

// 2. The placeholder list is the fixed six, defined once in the script.
let exported;
try {
  exported = (await import(pathToFileURL(SCRIPT).href)).MEASURE_PLACEHOLDERS;
} catch {
  exported = undefined;
}
if (!Array.isArray(exported)) red("MEASURE_PLACEHOLDERS is not exported by the script");
if (JSON.stringify(exported) !== JSON.stringify(PLACEHOLDER_LITERALS)) {
  red("MEASURE_PLACEHOLDERS is not the six strings of spec.md §1, in order");
}
const literalsSha = createHash("sha256").update(PLACEHOLDER_LITERALS.join("\n")).digest("hex");
if (literalsSha !== PLACEHOLDER_SHA256) red("the pinned placeholder hash does not match the pinned literals");
const scriptText = readFileSync(SCRIPT, "utf8");
for (const literal of PLACEHOLDER_LITERALS) {
  if (scriptText.split(literal).length !== 2) {
    red(`the placeholder "${literal}" is not defined exactly once in the script`);
  }
}

// 3. --record appends, replaces and moves.
const contractFile = join(scratch, "contract.json");
const contractText = '{"version":"2","pages":[]}\n';
writeFileSync(contractFile, contractText);
const contractSha = createHash("sha256").update(contractText).digest("hex");
const recordFile = join(scratch, "record", "reader-measure.json");
const record = (label) =>
  runScript(["--record", label, docs, "--file", recordFile, "--contract", contractFile]);
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
const readEntries = () => {
  try {
    return JSON.parse(readFileSync(recordFile, "utf8")).entries;
  } catch {
    return null;
  }
};

for (const label of ["one", "two"]) {
  if (record(label).status !== 0) red(`--record ${label} exited non-zero`);
}
let entries = readEntries();
if (!Array.isArray(entries) || entries.map((e) => e.label).join() !== "one,two") {
  red("--record did not append entries in order");
}
const first = entries[0];
if (JSON.stringify(Object.keys(first)) !== JSON.stringify(["label", "commit", "contract_sha256", "placeholder_list_sha256", "totals"])) {
  red(`a recorded entry has keys ${Object.keys(first).join(",")}`);
}
if (first.commit !== head) red("a recorded entry does not carry the repository HEAD");
if (first.contract_sha256 !== contractSha) red("a recorded entry does not carry the contract file's sha256");
if (first.placeholder_list_sha256 !== PLACEHOLDER_SHA256) red("a recorded entry carries the wrong placeholder hash");
if (JSON.stringify(first.totals) !== JSON.stringify(EXPECTED.totals)) red("a recorded entry's totals are not the measure's totals");

if (record("one").status !== 0) red("--record one a second time exited non-zero");
entries = readEntries();
if (!Array.isArray(entries) || entries.map((e) => e.label).join() !== "two,one") {
  red("--record did not replace an existing label and move it to the end");
}

// 4. The gate is listed in the workflow beside the other dev gates.
const workflow = existsSync(join(REPO, WORKFLOW_REL)) ? readFileSync(join(REPO, WORKFLOW_REL), "utf8") : "";
const steps = workflow.split("\n").filter((line) => /^\s+run:\s/.test(line));
const listed = steps.filter((line) => line.includes("node dev/test-reader-measure.mjs"));
if (listed.length !== 1) red(`${WORKFLOW_REL} lists the gate ${listed.length} times, expected once`);
const neighbours = steps.filter((line) => line.includes("node dev/test-carried-finding-references.mjs"));
if (neighbours.length !== 1) red(`${WORKFLOW_REL} no longer lists its neighbouring dev gate`);

// 5. The recorded "before" entry exists and is shaped by this packet.
let recorded = null;
try {
  recorded = JSON.parse(readFileSync(join(REPO, RECORD_REL), "utf8"));
} catch {
  recorded = null;
}
const before = Array.isArray(recorded?.entries) ? recorded.entries.find((e) => e.label === "before") : null;
if (!before) red(`${RECORD_REL} has no "before" entry`);
if (before.placeholder_list_sha256 !== PLACEHOLDER_SHA256) red('the "before" entry carries the wrong placeholder hash');
if (!/^[0-9a-f]{40}$/.test(before.commit ?? "")) red('the "before" entry carries no commit');
if (!/^[0-9a-f]{64}$/.test(before.contract_sha256 ?? "")) red('the "before" entry carries no contract hash');
const t = before.totals ?? {};
if (!Number.isInteger(t.pages) || t.pages < 1 || !Number.isInteger(t.table_chars) || !Number.isInteger(t.prose_chars) || !Number.isInteger(t.placeholders) || typeof t.table_share !== "number") {
  red('the "before" entry carries no measured totals');
}

console.log("GATE EX1 GREEN");
