#!/usr/bin/env node
// GATE EX14 (design/explanation/spec.md §5; claims C38, C16, C39, C45) — the
// explain pass is published.
//
//   exit 0  `GATE EX14 GREEN`          — every assertion held
//   exit 1  `GATE EX14 RED: <reason>`  — an assertion fired
//
// It reads tracked files as HEAD commits them, because a receipt binds to what is
// committed and not to what is on disk, and it asserts in the order §5 lists:
//
//   1. every subsystem page has `## Purpose`, or shows a status nothing may be
//      recorded for;
//   2. every page with `## Purpose` also has `## How it works` or the
//      account-declination sentence;
//   3. the census names the commit the receipts were recorded at and holds no
//      explanation slot;
//   4. the architecture page opens with the project's account, and its provenance
//      line, and not the no-account or the declined sentence;
//   5. no page carries a refused-explanation sentence;
//   6. the four gates of §0.3 exit 0, then EX8's gate (the packet's last acceptance
//      line), each as a subprocess with one summary line and no child output;
//   7. reader-measure.json has an `explained` entry and its last entry is the
//      measure of the committed docs, bound to the committed contract.
//
// The checks over page text and the census are pure functions, and a control runs
// each over fixtures of its own before any real file is read: a check that cannot
// fail on a fixture says nothing about the tree.
//
// It does not judge whether an explanation is true or useful (§8).
//
// What a reviewer should sabotage, and what must go red:
//   withdraw or never record a purpose, and republish       → the Purpose check
//   drop the account section from the renderer              → the account check
//   drop an explain-progress subject, or mark it blocked    → the progress check
//   leave a subsystem-account row in unfilled-slots.json    → the census check
//   move the census's commit off the receipts' commit       → the census check
//   decline the project account and republish               → the architecture check
//   seed status vocabulary in a recorded purpose            → the publish itself, and
//                                                             the refused-sentence check
//   revert docs/ or a receipt                               → the sub-gate it binds
//   drop or rename the `explained` entry                    → the measure check
//   edit a figure in the last measure entry                 → the measure check
//   drop this gate's workflow step                          → the last assertion

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "dev/test-explanations-published.mjs";
const WORKFLOW = ".github/workflows/test.yml";
const VOCABULARY = "mcp-server/contracts/conspectus-vocabulary.json";
const CENSUS = "design/explanation/unfilled-slots.json";
const PROGRESS = "design/explanation/explain-progress.json";
const MEASURE = "design/explanation/reader-measure.json";
const DOGFOOD_RECEIPT = "design/reader-lenses/dogfood-receipt.json";
const DEPTH_RECEIPT = "design/survey-depth/acceptance-receipt.json";

// spec.md §0.3, in its order, then EX8's gate.
const SUB_GATES = [
  { id: "P18", path: "dev/test-reader-lenses-dogfood.mjs" },
  { id: "P10 / D0", path: "dev/test-survey-depth.mjs" },
  { id: "P11 / A1", path: "dev/test-survey-depth-acceptance.mjs" },
  { id: "carried references", path: "dev/test-carried-finding-references.mjs" },
  { id: "EX8", path: "dev/test-receipt-gates-restored.mjs" },
];

const EXPLANATION_SLOTS = ["subsystem-purpose", "subsystem-account", "project-account"];
const NO_PROJECT_ACCOUNT = "No account of how the parts fit together is recorded.";
const FIT_HEADING = "How the parts fit together";
// Every slot's refusal, whichever slot and subject it stands in for.
const REFUSED_SENTENCE = /The recorded [a-z]+ carries survey-status vocabulary and was not published/;

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

function committedPaths(directory) {
  const run = spawnSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "--", directory], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return run.status === 0 ? run.stdout.split("\n").filter(Boolean) : [];
}

/** The status vocabulary and the declined word, from their one source. */
function vocabulary() {
  const enums = committedJson(VOCABULARY)?.enums;
  const statuses = enums?.subsystem_status?.values ?? [];
  const ineligible = statuses.filter((entry) => entry?.explanation_eligible === false).map((entry) => entry.value);
  const declined = enums?.explanation_discharge?.values?.find((entry) => entry?.value === "declined")?.label;
  if (!ineligible.length || statuses.length === ineligible.length) {
    red(`${VOCABULARY} does not say which subsystem statuses are explanation-eligible`);
  }
  if (typeof declined !== "string" || !declined) red(`${VOCABULARY} has no label for a declined explanation`);
  return {
    statuses: statuses.map((entry) => entry.value),
    ineligible,
    accountDeclined: `A survey session ${declined.toLowerCase()} to write an account of how this subsystem works at \``,
    projectDeclined: `A survey session ${declined.toLowerCase()} to write an account of how the parts fit together at \``,
  };
}

/** The word on a page's status line, or null when the page has none it can read. */
function pageStatus(text, statuses) {
  const line = text.split("\n").find((candidate) => candidate.startsWith("**Status**:"));
  if (!line) return null;
  const words = line.replace("**Status**:", "").trim().split(/\s+/);
  const word = words[words.length - 1];
  return statuses.includes(word) ? word : null;
}

/** The text of a level-two section, or null when the page has no such heading. */
function section(text, heading) {
  const lines = text.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^#{1,2} /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

function purposeProblem(page, text, vocab) {
  const status = pageStatus(text, vocab.statuses);
  if (status === null) return `${page} has no readable status line`;
  const purpose = section(text, "Purpose");
  if (purpose) return null;
  if (vocab.ineligible.includes(status)) return null;
  return `a surveyed subsystem page has no Purpose section: ${page} is '${status}'`;
}

function accountProblem(page, text, vocab) {
  if (section(text, "Purpose") === null) return null;
  if (section(text, "How it works")) return null;
  if (text.includes(vocab.accountDeclined)) return null;
  return `${page} has a Purpose and neither a How it works section nor the account-declination sentence`;
}

function censusProblem(census, receiptCommits) {
  if (!/^[0-9a-f]{40}$/.test(String(census?.commit))) return `${CENSUS} names no commit`;
  for (const [path, commit] of receiptCommits) {
    if (commit !== census.commit) {
      return `${CENSUS} names ${census.commit} and ${path} was recorded at ${commit}`;
    }
  }
  if (!Array.isArray(census?.unfilled_slots)) return `${CENSUS} carries no census`;
  const owed = census.unfilled_slots.filter((row) => EXPLANATION_SLOTS.includes(row?.slot));
  if (owed.length) {
    return `${CENSUS} still lists an explanation slot: ${owed.map((row) => `${row.slot} ${row.subject}`).join(", ")}`;
  }
  return null;
}

function architectureProblem(text, vocab) {
  const body = section(text, FIT_HEADING);
  if (body === null) return `docs/architecture.md has no '${FIT_HEADING}' section`;
  if (text.includes(NO_PROJECT_ACCOUNT)) return "docs/architecture.md carries the no-account sentence";
  if (text.includes(vocab.projectDeclined)) return "docs/architecture.md carries a declined project account";
  if (!/^\*Written by a survey session at `[0-9a-f]{8}` from \d+ evidence row\(s\)\./m.test(body)) {
    return `docs/architecture.md's '${FIT_HEADING}' section has no account with a provenance line`;
  }
  return null;
}

function progressProblem(progress, owed) {
  if (progress?.status === "blocked") return `${PROGRESS} is blocked: ${progress.reason ?? "no reason given"}`;
  const subjects = Array.isArray(progress?.subjects) ? progress.subjects : [];
  if (progress?.subjects_done !== subjects.length) {
    return `${PROGRESS} records ${progress?.subjects_done} subject(s) done and lists ${subjects.length}`;
  }
  const missing = owed.filter((subject) => !subjects.includes(subject));
  if (missing.length) return `${PROGRESS} does not account for ${missing.join(", ")}`;
  return null;
}

// Each check over a fixture it must refuse and one it must pass. Reds name what
// the check failed to do, so a broken control cannot read as a broken tree.
function runControls(vocab) {
  const page = (status, ...sections) =>
    [`# **B-99** — Fixture`, "", `**Status**: 🟡 ${status}  `, "", ...sections].join("\n");
  const purpose = "## Purpose\n\nWhat it is for.\n\n*Written by a survey session at `abcdef12` from 2 evidence row(s).*\n";
  const account = "## How it works\n\nHow it does it.\n";
  const refuse = (problem, what) => {
    if (problem === null) red(`the control ${what} was not refused, so that check cannot fail`);
  };
  const pass = (problem, what) => {
    if (problem !== null) red(`the control ${what} was refused: ${problem}`);
  };

  refuse(purposeProblem("x", page("structural", "## Scope\n\nA scope.\n"), vocab), "structural page with no Purpose");
  refuse(purposeProblem("x", page("structural", "## Purpose\n\n## Scope\n\nA scope.\n"), vocab), "empty Purpose");
  refuse(purposeProblem("x", "# A page\n\n## Scope\n", vocab), "page with no status line");
  refuse(purposeProblem("x", page("Purpose", "## Purpose\n\nA purpose.\n"), vocab), "unknown status");
  pass(purposeProblem("x", page("unmapped", "## Scope\n\nA scope.\n"), vocab), "unmapped page with no Purpose");
  pass(purposeProblem("x", page("structural", purpose), vocab), "structural page with a Purpose");

  refuse(accountProblem("x", page("structural", purpose), vocab), "page with a Purpose and neither account");
  refuse(accountProblem("x", page("structural", purpose, "## How it works\n\n## Structure\n"), vocab), "empty account");
  pass(accountProblem("x", page("structural", purpose, account), vocab), "page with a Purpose and an account");
  pass(
    accountProblem("x", page("structural", purpose, `## Survey record\n\n${vocab.accountDeclined}abcdef12\`. A reason.\n`), vocab),
    "page with a Purpose and a declined account",
  );
  pass(accountProblem("x", page("unmapped", "## Scope\n"), vocab), "page with no Purpose");

  const sha = "a".repeat(40);
  const receipts = [["receipt", sha]];
  refuse(censusProblem({ commit: null, unfilled_slots: [] }, receipts), "census with no commit");
  refuse(censusProblem({ commit: sha, unfilled_slots: [] }, [["receipt", "b".repeat(40)]]), "census off the receipts' commit");
  refuse(censusProblem({ commit: sha }, receipts), "census with no rows");
  for (const slot of EXPLANATION_SLOTS) {
    refuse(censusProblem({ commit: sha, unfilled_slots: [{ slot, subject: "B-99" }] }, receipts), `census with a ${slot} row`);
  }
  pass(censusProblem({ commit: sha, unfilled_slots: [{ slot: "subsystem-vocabulary", subject: "B-99" }] }, receipts), "census with another slot");

  const provenance = "*Written by a survey session at `abcdef12` from 2 evidence row(s). None changed.*";
  refuse(architectureProblem("# A\n\n## Other\n", vocab), "architecture page with no section");
  refuse(architectureProblem(`## ${FIT_HEADING}\n\n${NO_PROJECT_ACCOUNT}\n`, vocab), "architecture page with the no-account sentence");
  refuse(architectureProblem(`## ${FIT_HEADING}\n\n${vocab.projectDeclined}abcdef12\`. A reason.\n`, vocab), "architecture page with a declined account");
  refuse(architectureProblem(`## ${FIT_HEADING}\n\n**B-01 — x**: Not recorded\n`, vocab), "architecture page with only per-subsystem lines");
  pass(architectureProblem(`## ${FIT_HEADING}\n\nThe account.\n\n${provenance}\n`, vocab), "architecture page with an account");

  refuse(progressProblem({ subjects_done: 1, subjects: [] }, []), "progress count off its list");
  refuse(progressProblem({ subjects_done: 1, subjects: ["B-01"], status: "blocked" }, ["B-01"]), "blocked progress");
  refuse(progressProblem({ subjects_done: 1, subjects: ["B-01"] }, ["B-01", "project"]), "progress missing a subject");
  pass(progressProblem({ subjects_done: 2, subjects: ["B-01", "project"] }, ["B-01", "project"]), "complete progress");

  if (!REFUSED_SENTENCE.test("The recorded purpose carries survey-status vocabulary and was not published; record a corrected version.")) {
    red("the control refused-explanation sentence does not match its pattern");
  }
}

function checkPages(vocab) {
  const pages = committedPaths("docs/subsystems").filter((path) => path.endsWith(".md"));
  if (!pages.length) red("a surveyed subsystem page has no Purpose section: docs/subsystems has no page at all");
  const texts = pages.map((path) => [path, committedOrRed(path)]);
  for (const [path, text] of texts) {
    const problem = purposeProblem(path, text, vocab);
    if (problem) red(problem);
  }
  for (const [path, text] of texts) {
    const problem = accountProblem(path, text, vocab);
    if (problem) red(problem);
  }
  return texts;
}

function checkCensus() {
  const receipts = [DOGFOOD_RECEIPT, DEPTH_RECEIPT].map((path) => [path, committedJson(path)?.repository_sha]);
  const problem = censusProblem(committedJson(CENSUS), receipts);
  if (problem) red(problem);
}

function checkArchitecture(vocab) {
  const problem = architectureProblem(committedOrRed("docs/architecture.md"), vocab);
  if (problem) red(problem);
}

function checkRefusals() {
  for (const path of committedPaths("docs")) {
    if (!/\.(md|html)$/.test(path)) continue;
    if (REFUSED_SENTENCE.test(committedOrRed(path))) red(`${path} carries a refused-explanation sentence`);
  }
}

function checkProgress(texts, vocab) {
  const eligible = texts
    .filter(([, text]) => !vocab.ineligible.includes(pageStatus(text, vocab.statuses)))
    .map(([path]) => path.match(/\/b(\d+)-/)?.[1])
    .map((digits) => `B-${digits}`);
  const problem = progressProblem(committedJson(PROGRESS), [...eligible, "project"]);
  if (problem) red(problem);
}

function runSubGates() {
  for (const gate of SUB_GATES) {
    const run = spawnSync(process.execPath, [join(REPO, gate.path)], { cwd: REPO, stdio: "ignore" });
    if (run.status !== 0) {
      const how = run.status === null ? `signal ${run.signal}` : `exit ${run.status}`;
      console.log(`  red    ${gate.id}: ${gate.path} (${how})`);
      red(`${gate.path} is red (${how})`);
    }
    console.log(`  green  ${gate.id}: ${gate.path}`);
  }
}

function checkMeasure() {
  const entries = committedJson(MEASURE)?.entries;
  if (!Array.isArray(entries) || !entries.length) red(`${MEASURE} has no entries`);
  if (!entries.some((entry) => entry?.label === "explained")) red(`${MEASURE} has no 'explained' entry`);
  const hashes = new Set(entries.map((entry) => entry?.placeholder_list_sha256));
  if (hashes.size !== 1 || !/^[0-9a-f]{64}$/.test([...hashes][0] ?? "")) {
    red(`${MEASURE}'s entries do not share one placeholder list hash`);
  }
  const contract = createHash("sha256").update(committedOrRed("docs/.projection-contract.json")).digest("hex");
  const last = entries[entries.length - 1];
  if (last?.contract_sha256 !== contract) {
    red(`${MEASURE}'s last entry ('${last?.label}') is not bound to the committed docs contract`);
  }
  const scratch = mkdtempSync(join(tmpdir(), "ex14-measure-"));
  try {
    const archive = spawnSync("git", ["archive", "--format=tar", "-o", join(scratch, "docs.tar"), "HEAD", "docs"], { cwd: REPO, encoding: "utf8" });
    if (archive.status !== 0) red("the committed docs tree could not be archived");
    const untar = spawnSync("tar", ["-xf", join(scratch, "docs.tar"), "-C", scratch], { encoding: "utf8" });
    if (untar.status !== 0) red("the committed docs tree could not be unpacked");
    const measure = spawnSync(process.execPath, [join(REPO, "dev/measure-reader-prose.mjs"), join(scratch, "docs")], { cwd: REPO, encoding: "utf8" });
    if (measure.status !== 0) red("dev/measure-reader-prose.mjs did not measure the committed docs tree");
    if (JSON.stringify(JSON.parse(measure.stdout).totals) !== JSON.stringify(last?.totals)) {
      red(`${MEASURE}'s last entry ('${last?.label}') is not the measure of the committed docs`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function checkListed() {
  if (!committedOrRed(WORKFLOW).includes(`run: node ${SELF}`)) red(`${SELF} is not listed in ${WORKFLOW}`);
}

function main() {
  const vocab = vocabulary();
  runControls(vocab);
  const texts = checkPages(vocab);
  checkProgress(texts, vocab);
  checkCensus();
  checkArchitecture(vocab);
  checkRefusals();
  runSubGates();
  checkMeasure();
  checkListed();
}

try {
  main();
  console.log("GATE EX14 GREEN");
} catch (error) {
  if (!(error instanceof Red)) throw error;
  console.log(`GATE EX14 RED: ${error.message}`);
  process.exitCode = 1;
}
