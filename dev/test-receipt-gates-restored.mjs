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
//   drop the server build from the roadmap job, or move it
//     after the carried-references step                   → the workflow check
//   restore the old thesis heading and republish          → the thesis check
//   edit the thesis text                                  → the thesis check
//   drop the runtime boundary table and republish         → the architecture check
//   drop the Why it matters field                         → the findings check
//   rerun the measure over other docs, or drop `recovered` → the measure check
//   leave a carried record unaccounted for in the progress
//     record, or mark it blocked                          → the progress check
//   drop this gate's workflow step                        → the last assertion

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const THESIS_TEXT =
  "Amanuensis turns reading a codebase into a durable, evidence-backed record. An MCP server holds a " +
  "SQLite store per workspace; a survey writes observations, evidence, claims, concern dispositions and " +
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

/** Each job's steps, as the text of each step, in the order the workflow runs them. */
function workflowJobs(text) {
  const jobs = new Map();
  let job = null;
  let inJobs = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      inJobs = /^jobs:/.test(line);
      job = null;
      continue;
    }
    if (!inJobs) continue;
    const jobHeader = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jobHeader) {
      job = [];
      jobs.set(jobHeader[1], job);
      continue;
    }
    if (!job || /^\s*#/.test(line)) continue;
    if (/^ {6}- /.test(line)) job.push(line);
    else if (job.length) job[job.length - 1] += `\n${line}`;
  }
  return jobs;
}

function checkWorkflow(text) {
  const jobs = [...workflowJobs(text)];
  const owner = jobs.find(([, steps]) => steps.some((step) => step.includes(`node ${CARRIED_GATE}`)));
  if (!owner) red(`no job in ${WORKFLOW} runs ${CARRIED_GATE}`);
  const [jobName, steps] = owner;
  const at = steps.findIndex((step) => step.includes(`node ${CARRIED_GATE}`));
  const before = steps.slice(0, at);
  const inServer = (step) =>
    /working-directory:\s*mcp-server\b/.test(step) || /cd mcp-server\b/.test(step);
  const ran = (command) => before.some((step) => inServer(step) && new RegExp(`\\brun:.*\\b${command}\\b`).test(step));
  if (!ran("npm ci")) {
    red(`job ${jobName} runs ${CARRIED_GATE} with no earlier npm ci step in mcp-server`);
  }
  if (!ran("npm run build")) {
    red(`job ${jobName} runs ${CARRIED_GATE} with no earlier npm run build step in mcp-server`);
  }
}

/** The body of a level-two section, up to the next heading of that level or higher. */
function section(text, heading) {
  const lines = text.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^#{1,2} /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

function checkThesis() {
  const page = committedOrRed("docs/index.md");
  for (const sentence of THESIS_PLACEHOLDERS) {
    if (page.includes(sentence)) red(`docs/index.md carries the placeholder "${sentence}"`);
  }
  const body = section(page, "What is this codebase?");
  if (body === null) red("docs/index.md has no 'What is this codebase?' section");
  if (body.replace(/\s+/g, " ").trim() !== THESIS_TEXT) {
    red("docs/index.md's thesis is not the text entry-point.md recorded");
  }
}

function checkRuntimeBoundary() {
  const page = committedOrRed("docs/architecture.md");
  if (page.includes(RUNTIME_PLACEHOLDER)) red("docs/architecture.md carries the runtime-boundary placeholder");
  const body = section(page, "Runtime boundary map");
  if (body === null) red("docs/architecture.md has no runtime boundary map section");
  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
  const rows = body.split("\n").filter((line) => line.trim().startsWith("|"));
  if (rows.length < 3) red("docs/architecture.md's runtime boundary map has no table row");
  if (cells(rows[0]).map((cell) => cell.toLowerCase()).join("|") !== RUNTIME_COLUMNS.join("|")) {
    red("docs/architecture.md's runtime boundary map does not carry the five columns");
  }
  if (rows.slice(2).some((row) => cells(row).length !== RUNTIME_COLUMNS.length || cells(row).some((cell) => !cell))) {
    red("docs/architecture.md's runtime boundary map has a row with an empty or missing cell");
  }
}

// The field is a column of the page's tables, so its presence is a header and a
// value under it. A header over empty cells would not tell a reader why anything
// matters.
function checkFindings() {
  const lines = committedOrRed("docs/findings.md").split("\n");
  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
  let column = -1;
  let filled = 0;
  for (const line of lines) {
    // The renderer puts a finding's anchor comment between its table's rows.
    if (line.startsWith("<!--")) continue;
    if (!line.trim().startsWith("|")) {
      column = -1;
      continue;
    }
    const row = cells(line);
    if (row.includes("Why it matters")) {
      column = row.indexOf("Why it matters");
    } else if (column >= 0 && !/^:?-{3,}:?$/.test(row[0]) && (row[column] ?? "").length > 1) {
      filled += 1;
    }
  }
  if (!filled) red("docs/findings.md carries no filled Why it matters field");
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
    const measure = spawnSync(process.execPath, [join(REPO, "dev/measure-reader-prose.mjs"), join(scratch, "docs")], { cwd: REPO, encoding: "utf8" });
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

function checkListed(workflow) {
  if (!workflow.includes(`run: node ${SELF}`)) red(`${SELF} is not listed in ${WORKFLOW}`);
}

function main() {
  runSubGates();
  const workflow = committedOrRed(WORKFLOW);
  checkWorkflow(workflow);
  checkThesis();
  checkRuntimeBoundary();
  checkFindings();
  checkMeasure();
  checkCensus();
  checkProgress();
  checkListed(workflow);
}

try {
  main();
  console.log("GATE EX8 GREEN");
} catch (error) {
  if (!(error instanceof Red)) throw error;
  console.log(`GATE EX8 RED: ${error.message}`);
  process.exitCode = 1;
}
