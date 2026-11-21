#!/usr/bin/env node
// GATE EX8 (design/explanation/spec.md §4.3, §4.4; claims C15, C16, C17) — the
// receipt-bound gates are restored and the first republish holds.
//
//   exit 0  `GATE EX8 GREEN`          — every assertion held
//   exit 1  `GATE EX8 RED: <reason>`  — an assertion fired
//
// It runs the four gates of §0.3 as subprocesses, in the order §0.3 lists them, and
// prints one line of its own for each. A child's output is captured and dropped,
// since it can carry a crash signature this gate's red run must not show. The first
// red child ends the run. The other assertions read tracked files as HEAD commits
// them, because a receipt binds to what is committed and not to what is on disk.
//
// What a reviewer should sabotage, and what must go red:
//   revert docs/ or a receipt                             → the sub-gate it binds
//   decide a carried record by editing the receipt        → P10 / D0 or P11 / A1
//   restore the old thesis heading and republish          → the thesis check
//   edit the thesis text                                  → the thesis check
//   drop the runtime boundary table and republish         → the architecture check
//   drop the Why it matters field                         → the findings check
//   rerun the measure over other docs, or drop `recovered` → the measure check
//   leave a carried record unaccounted for in the progress
//     record, or mark it blocked                          → the progress check

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordFieldsOf, runtimeDetailsOf, sectionOf, sectionText, textOf } from "./read-html-page.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "dev/test-receipt-gates-restored.mjs";
const WORKFLOW = ".github/workflows/test.yml";
const CARRIED_GATE = "dev/test-carried-finding-references.mjs";

// spec.md §0.3, in its order.
const SUB_GATES = [
  { id: "P18", path: "dev/test-reader-lenses-dogfood.mjs" },
  { id: "P10 / D0", path: "dev/test-survey-depth.mjs" },
  { id: "P11 / A1", path: "dev/test-survey-depth-acceptance.mjs" },
  { id: "carried references", path: CARRIED_GATE },
];

const THESIS_PLACEHOLDERS = [
  "No thesis section is recorded",
  "The recorded thesis carries status vocabulary and was not published",
  "The recorded thesis presents a composite index of the record and was not published",
];
const RUNTIME_PLACEHOLDER = "No structured runtime boundary map is recorded yet";

// spec.md §4.4 renames the heading and leaves this text as the store recorded it.
// The page is HTML, which prints the reader's word for one phrase in it: the
// materializer rewrites "concern dispositions" to "concern review"
// (`amanuensis_materializer/prose.py`), so that is the word compared here.
const THESIS_TEXT =
  "Amanuensis turns reading a codebase into a durable, evidence-backed record. An MCP server holds a " +
  "SQLite store per workspace; a survey writes observations, evidence, claims, concern review and " +
  "findings into it through tools that refuse a write the record does not support; a Python " +
  "materializer projects the store into Markdown and self-contained HTML a person reads. The record " +
  "survives across sessions and agent boundaries, which is the point: the survey is the deliverable, " +
  "not the session.";

const RUNTIME_COLUMNS = ["runtime / process", "language", "communicates with", "mechanism", "notes"];

const CARRIED_TO_DECIDE = 14;

class Red extends Error {}
const red = (reason) => {
  throw new Red(reason);
};

/** A file as HEAD commits it, or null when HEAD does not carry it. */
function committed(path) {
  const run = spawnSync("git", ["show", `HEAD:${path}`], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return run.status === 0 ? run.stdout : null;
}

function committedOrRed(path) {
  const text = committed(path);
  if (text === null) red(`${path} is not committed at HEAD`);
  return text;
}

function committedJson(path) {
  const text = committedOrRed(path);
  try {
    return JSON.parse(text);
  } catch {
    return red(`${path} does not parse as JSON`);
  }
}

function runSubGates() {
  for (const gate of SUB_GATES) {
    const run = spawnSync(process.execPath, [join(REPO, gate.path)], {
      cwd: REPO,
      stdio: "ignore",
    });
    if (run.status !== 0) {
      const how = run.status === null ? `signal ${run.signal}` : `exit ${run.status}`;
      console.log(`  red    ${gate.id}: ${gate.path} (${how})`);
      red(`${gate.path} is red (${how})`);
    }
    console.log(`  green  ${gate.id}: ${gate.path}`);
  }
}

function checkThesis() {
  const page = committedOrRed("docs/index.html");
  const text = textOf(page);
  for (const sentence of THESIS_PLACEHOLDERS) {
    if (text.includes(sentence)) red(`docs/index.html carries the placeholder "${sentence}"`);
  }
  const body = sectionText(page, "What is this codebase?");
  if (body === null) red("docs/index.html has no 'What is this codebase?' section");
  if (body.replace(/\s+/g, " ").trim() !== THESIS_TEXT) {
    red("docs/index.html's thesis is not the text entry-point recorded");
  }
}

function checkRuntimeBoundary() {
  const page = committedOrRed("docs/architecture.html");
  if (textOf(page).includes(RUNTIME_PLACEHOLDER)) red("docs/architecture.html carries the runtime-boundary placeholder");
  const body = sectionOf(page, "Runtime boundary map");
  if (body === null) red("docs/architecture.html has no runtime boundary map section");
  const rows = runtimeDetailsOf(body);
  if (rows.length < 1) red("docs/architecture.html's runtime boundary map has no row");
  // The columns the map was a table of, as each entry prints them: the runtime
  // and its language in the entry's head, the rest as labelled values.
  const labels = ["Communicates with", "Mechanism", "Recorded note"];
  if (rows.some((row) => labels.some((label) => !(label in row.fields)))) {
    red("docs/architecture.html's runtime boundary map does not carry the five columns");
  }
  if (rows.some((row) => !row.runtime || !row.language || labels.some((label) => !row.fields[label]))) {
    red("docs/architecture.html's runtime boundary map has a row with an empty or missing cell");
  }
}

// The field is printed under its label on each finding's record, so its
// presence is the label and a value after it. A label over an empty value would
// not tell a reader why anything matters.
function checkFindings() {
  const filled = recordFieldsOf(committedOrRed("docs/findings.html"), "Why it matters").filter((value) => value.length > 1);
  if (!filled.length) red("docs/findings.html carries no filled Why it matters field");
}

function checkMeasure() {
  const entries = committedJson("design/explanation/reader-measure.json")?.entries;
  if (!Array.isArray(entries) || !entries.length) red("reader-measure.json has no entries");
  for (const label of ["before", "recovered"]) {
    if (!entries.some((entry) => entry?.label === label)) red(`reader-measure.json has no '${label}' entry`);
  }
  const hashes = new Set(entries.map((entry) => entry?.placeholder_list_sha256));
  if (hashes.size !== 1 || !/^[0-9a-f]{64}$/.test([...hashes][0] ?? "")) {
    red("reader-measure.json's entries do not share one placeholder list hash");
  }
  const contract = createHash("sha256")
    .update(committedOrRed("docs/.projection-contract.json"))
    .digest("hex");
  const last = entries[entries.length - 1];
  if (last?.contract_sha256 !== contract) {
    red(`reader-measure.json's last entry ('${last?.label}') is not bound to the committed docs contract`);
  }
  // Each figure is what the measure reports over the tree it names, so a changed
  // definition cannot leave a stale record behind it.
  const before = entries.find((entry) => entry?.label === "before");
  checkMeasuredTotals(before, before?.commit);
  checkMeasuredTotals(last, "HEAD");
}

function checkMeasuredTotals(entry, revision) {
  const scratch = mkdtempSync(join(tmpdir(), "ex8-measure-"));
  try {
    const archive = spawnSync("git", ["archive", "--format=tar", "-o", join(scratch, "docs.tar"), String(revision), "docs"], { cwd: REPO, encoding: "utf8" });
    if (archive.status !== 0) red(`reader-measure.json's '${entry?.label}' entry names a revision with no docs tree`);
    const untar = spawnSync("tar", ["-xf", join(scratch, "docs.tar"), "-C", scratch], { encoding: "utf8" });
    if (untar.status !== 0) red(`the docs tree of reader-measure.json's '${entry?.label}' entry could not be read`);
    // An entry with no basis was measured before the output was HTML only.
    const basis = entry?.basis ?? "markdown";
    const measure = spawnSync(process.execPath, [join(REPO, "dev/measure-reader-prose.mjs"), join(scratch, "docs"), "--basis", basis], { cwd: REPO, encoding: "utf8" });
    if (measure.status !== 0) red("dev/measure-reader-prose.mjs did not measure a committed docs tree");
    const { totals } = JSON.parse(measure.stdout);
    if (JSON.stringify(totals) !== JSON.stringify(entry?.totals)) {
      red(`reader-measure.json's '${entry?.label}' totals are not the measure of the docs tree they name`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function checkCensus() {
  const census = committedJson("design/explanation/unfilled-slots.json");
  if (!/^[0-9a-f]{40}$/.test(String(census?.commit))) red("unfilled-slots.json records no publish commit");
  if (!Array.isArray(census?.unfilled_slots)) red("unfilled-slots.json carries no census");
  for (const slot of ["thesis", "runtime-boundary-map"]) {
    if (census.unfilled_slots.some((row) => row?.slot === slot)) {
      red(`unfilled-slots.json still lists the ${slot} slot as unfilled`);
    }
  }
}

function checkProgress() {
  const progress = committedJson("design/explanation/restore-progress.json");
  if (progress?.status === "blocked") red(`restore-progress.json is blocked: ${progress.reason ?? "no reason given"}`);
  if (progress?.carried_decided !== CARRIED_TO_DECIDE) {
    red(`restore-progress.json records ${progress?.carried_decided} of ${CARRIED_TO_DECIDE} carried decisions`);
  }
  const records = Array.isArray(progress?.records) ? progress.records : [];
  const ids = new Set(records.map((record) => record?.id));
  if (ids.size !== CARRIED_TO_DECIDE || records.length !== CARRIED_TO_DECIDE) {
    red(`restore-progress.json names ${ids.size} distinct record(s) and carried_decided says ${CARRIED_TO_DECIDE}`);
  }
  const outcomes = ["successor-finding", "repaired", "ruled-out"];
  const bad = records.filter((record) => !outcomes.includes(record?.outcome)).map((record) => record?.id);
  if (bad.length) red(`restore-progress.json gives no terminal outcome for ${bad.join(", ")}`);
}


function main() {
  runSubGates();
  // checkWorkflow and checkListed asserted the CI workflow's contents. Not run
  // in CI: CI covers product and packaging only (owner decision 2026-11-06,
  // 6c6d789).
  checkThesis();
  checkRuntimeBoundary();
  checkFindings();
  checkMeasure();
  checkCensus();
  checkProgress();
}

try {
  main();
  console.log("GATE EX8 GREEN");
} catch (error) {
  if (!(error instanceof Red)) throw error;
  console.log(`GATE EX8 RED: ${error.message}`);
  process.exitCode = 1;
}
