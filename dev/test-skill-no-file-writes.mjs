#!/usr/bin/env node
// GATE SO10 (design/store-only/PLAN.md §4, §8 SO10, §7.2).
//
// Turns red when:
//   - any skill file (SKILL.md, references/*.md) names `register_artifact`, `rehash_artifact`,
//     `artifact-templates`, a hand-written file (`onboarding-report.md`, `entry-point.md`,
//     `master-plan.md`, `findings-index.md`, `concern-checklist.md`, `field-notes.md`,
//     `<id>-<slug>.md`, `_meta/prompts`), tells the agent to write, append or update a `.md`
//     file, named in a code span or in plain prose, or still talks of "prose artifacts";
//   - `references/artifact-templates.md` still exists, or `references/records.md` is missing, does
//     not have a section for each record family naming the tools that hold it, or does not say
//     what each of the contract's `narrative_section` values contains;
//   - a reference does not call its record tool at the step §4 names, with every argument the
//     tool requires: onboarding Phase 7 (`record_project_profile`,
//     `record_explanation(subject_type="project", slot="purpose")`, `record_runtime_boundary`,
//     `record_narrative` for repository-shape, runtime, stateful-entities, concern-calibration,
//     start-here and survey-plan, `add_concern` with territory and probe, `record_territory_disposition`);
//     Phase 2 step 3 (`record_claim_mark` or `decline_claim_marks`) and its narrative step
//     (`record_narrative` for `structure` with a topic, or `decline_narrative`), and no promise that
//     a page shows a flow's marks before SO25 draws them; Phase 3 (`record_narrative` for
//     `concern-reasoning`, `get_narratives` instead of reading a file, and
//     `get_imported_artifacts` for an imported survey body);
//     Phase 4 (`record_narrative` for `challenge` with a topic); Phase 5 ("Settle the narratives"
//     with `get_narratives(history=true)`, `record_narrative` and a `decline_narrative` that keeps
//     the topic, after "Settle the explanations"); the survey
//     loop (a lock on the subsystem id, not a path); the memory audit (`get_narratives`, no
//     `list_artifacts`); explanations.md and onboarding.md (the thesis is a recorded project
//     purpose, not a `## What is this codebase?` section);
//   - a call a reference teaches names a tool or an argument the server does not define
//     (checked against the built server, as check-reference-calls.mjs does);
//   - a file the skill lists does not exist, or a reference is listed in no skill file;
//   - (final review) a sentence, read whole across its wrapped lines, tells the agent to save,
//     create, put or store a file, a "Markdown file" or one under the storage directory, or to
//     use the Write tool (F10/claude); a sentence promises a Markdown companion or a portable
//     Markdown projection, or says a page renders under a `.md` name (F8/codex, F5/claude,
//     F6/claude); the skill waits on a store-only packet that has landed (F9/codex); or a
//     refusal the skill quotes is not one the server emits (F16/claude).
// Reads the skill and the contract; it touches no store.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mcp = join(root, "mcp-server");
const skill = join(root, ".claude", "skills", "amanuensis");
const refs = join(skill, "references");

const failures = [];
const fail = (message) => failures.push(message);

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The skill file's text, or a failure and the empty string. */
function load(relative) {
  const text = read(join(skill, relative));
  if (text === null) {
    fail(`${relative} is missing`);
    return "";
  }
  return text;
}

/** The text under the first heading matching `heading`, to the next heading of the same or a higher level. */
function section(text, heading) {
  const lines = text.split("\n");
  let from = -1;
  let level = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^```/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!match) continue;
    if (from < 0) {
      if (heading.test(match[2])) {
        from = i;
        level = match[1].length;
      }
    } else if (match[1].length <= level) {
      return lines.slice(from, i).join("\n");
    }
  }
  return from < 0 ? "" : lines.slice(from).join("\n");
}

// ---------------------------------------------------------------- call reading

/** Split on commas that are not nested in brackets or quotes. */
function topLevel(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if ("([{<".includes(ch)) depth += 1;
    else if (")]}>".includes(ch)) depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** `{ name: value | null }` for the arguments one call writes: `k=v`, `k: v`, or a bare `k`. */
function argumentsOf(inner) {
  const named = {};
  const trimmed = inner.trim();
  const body = trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : trimmed;
  for (const part of topLevel(body)) {
    const pair = /^([a-z_][a-z0-9_]*)\??\s*[=:]\s*([\s\S]*)$/i.exec(part);
    if (pair) {
      named[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, "");
      continue;
    }
    const bare = /^([a-z_][a-z0-9_]*)\??$/i.exec(part);
    if (bare) named[bare[1]] = null;
  }
  return named;
}

const CALL = /(?<![A-Za-z0-9_])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\(/g;

/** Every `name(…)` in the text, with its arguments read to the matching parenthesis. */
function callsIn(text) {
  const calls = [];
  for (const match of text.matchAll(CALL)) {
    const open = match.index + match[0].length;
    let depth = 1;
    let quote = null;
    let i = open;
    for (; i < text.length && depth > 0; i += 1) {
      const ch = text[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
    }
    if (depth === 0) calls.push({ name: match[1], args: argumentsOf(text.slice(open, i - 1)) });
  }
  return calls;
}

/** The calls written inside code (fenced or inline) in a text. */
function codeCalls(text) {
  const bodies = [];
  let masked = text;
  for (const match of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    bodies.push(match[1]);
    masked = masked.replace(match[0], " ".repeat(match[0].length));
  }
  for (const match of masked.matchAll(/`((?:[^`\n]|\n(?![ \t]*\n))+)`/g)) bodies.push(match[1]);
  return bodies.flatMap(callsIn);
}

// ----------------------------------------------------------- server and contract

async function loadTools() {
  const dir = join(mcp, "dist", "tools");
  const tools = new Map();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".js")).sort()) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    for (const value of Object.values(mod)) {
      if (!Array.isArray(value)) continue;
      for (const td of value) {
        if (td && typeof td.name === "string" && td.inputSchema && typeof td.handler === "function") {
          tools.set(td.name, td);
        }
      }
    }
  }
  return tools;
}

let tools = null;
try {
  const built = await import(pathToFileURL(join(mcp, "scripts", "ensure-built.mjs")).href);
  const result = built.ensureBuilt();
  if (!result.ok) fail("the server could not be built, so the skill's tool calls cannot be checked against it");
  else tools = await loadTools();
} catch {
  fail("the server could not be loaded, so the skill's tool calls cannot be checked against it");
}

let sections = [];
let sectionMeanings = [];
try {
  const contract = JSON.parse(read(join(mcp, "contracts", "conspectus-vocabulary.json")) ?? "");
  sectionMeanings = contract.enums.narrative_section.values.map((row) => ({ value: row.value, meaning: row.meaning }));
  sections = sectionMeanings.map((row) => row.value);
} catch {
  fail("the contract's narrative_section values could not be read");
}
if (sections.length === 0) fail("the contract lists no narrative sections");

/**
 * One call of `tool` in `text` that names every argument the tool requires and only arguments
 * it defines, and whose named arguments satisfy `match`. Returns the matching calls.
 */
function requireCalls(where, text, tool, match = () => true) {
  const all = codeCalls(text).filter((call) => call.name === tool);
  const required = tools?.get(tool)?.inputSchema?.required ?? [];
  const properties = Object.keys(tools?.get(tool)?.inputSchema?.properties ?? {});
  const good = all.filter((call) => {
    const names = Object.keys(call.args);
    if (!required.every((arg) => names.includes(arg))) return false;
    if (properties.length > 0 && !names.every((arg) => properties.includes(arg))) return false;
    return match(call.args);
  });
  if (good.length === 0) {
    fail(
      `${where} has no call of ${tool} that names ${required.join(", ") || "its arguments"}${
        all.length ? " (the calls it has differ)" : ""
      }`,
    );
  }
  return good;
}

// -------------------------------------------------------------- every skill file

const files = ["SKILL.md"];
if (existsSync(refs)) {
  for (const name of readdirSync(refs).sort()) if (name.endsWith(".md")) files.push(`references/${name}`);
}
const texts = new Map(files.map((file) => [file, read(join(skill, file)) ?? ""]));

const FORBIDDEN = [
  [/register_artifact/, "`register_artifact`"],
  [/rehash_artifact/, "`rehash_artifact`"],
  [/artifact-templates/, "`artifact-templates`"],
  [/\b(?:onboarding-report|entry-point|master-plan|findings-index|concern-checklist|field-notes)\.md\b/, "a hand-written `.md` file"],
  [/<id>-<slug>/, "`<id>-<slug>`"],
  [/_meta\/prompts/, "`_meta/prompts`"],
  [/\bprose artifacts?\b/i, "\"prose artifacts\""],
  [/## What is this codebase\?/, "the `## What is this codebase?` heading"],
  // The publication is HTML only (SO13, SO19): no sentence promises a Markdown view of it
  // (final review F8/codex, F5/claude, F6/claude).
  [/\bMarkdown companions?\b/i, "a Markdown companion to the HTML"],
  [/\bportable (?:schema )?projection\b/i, "a Markdown \"portable projection\""],
  // Every store-only packet has landed: the skill describes what ships, not a packet to wait
  // for (final review F9/codex).
  [/\bstore-only packet SO\d+/i, "a store-only packet still to come"],
  [/\bNo page draws a flow's marks\b/i, "\"No page draws a flow's marks\" (SO25 draws them)"],
];
// A sentence that says a page renders under a `.md` name names a page the run no longer writes.
const RENDERED_MD = /\brender(?:s|ed|ing)?\b[^.]*?(?<![\w/-])((?:[\w<>-]+\/)*[\w<>-]+\.md)\b|(?<![\w/-])((?:[\w<>-]+\/)*[\w<>-]+\.md)`?\s+renders?\b/i;

// An instruction to write a file: a verb of writing on a line that names a `.md` file, in a code
// span or in ordinary prose (F12/codex, slice S2), that is not one of the skill's own references or
// a design document.
const WRITE_VERB =
  /\b(?:writ(?:e|es|ing|ten)|append(?:s|ed|ing)?|updat(?:e|es|ing)|edit(?:s|ing)?|sav(?:e|es|ing)|creat(?:e|es|ing)|puts?|putting|stor(?:e|es|ing))\b/i;
// A file the agent is told to write may go unnamed: "a Markdown file", or a file put "under the
// storage directory" / "next to the database" (F10/claude).
const UNNAMED_FILE = /\bMarkdown files?\b|\b(?:in|into|under|to) the storage directory\b|\bnext to the database\b|\bthe Write tool\b/i;
const MD_NAME = /(?<![\w.\/-])((?:[\w.<>-]+\/)*[\w.<>-]+\.md)(?![\w-])/g;
/** The `.md` files a line tells the agent to write: none unless it has a verb of writing. */
// A sentence that says nothing is written is the rule, not a breach of it.
const NEGATED = /\b(?:nothing|never|not|no)\b/i;
function writtenFiles(text) {
  const found = [];
  for (const sentence of text.split(/(?<=[.!?])\s+(?=[A-Z`(\[])/)) {
    if (!WRITE_VERB.test(sentence)) continue;
    found.push(
      ...[...sentence.matchAll(MD_NAME)]
        .map((match) => match[1])
        .filter(
          (name) =>
            !/^(?:references\/|\.\.\/|design\/|docs\/)/.test(name) &&
            !/^(?:SKILL|AGENTS|CLAUDE)\.md$/.test(name),
        ),
    );
    const unnamed = UNNAMED_FILE.exec(sentence);
    if (unnamed && !NEGATED.test(sentence)) found.push(unnamed[0]);
  }
  return found;
}
/** Each paragraph or list item as one line, so an instruction wrapped across lines is read whole. */
function paragraphs(text) {
  const out = [];
  let current = null;
  text.split("\n").forEach((line, index) => {
    const opens = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|```)/.test(line);
    if (!line.trim() || opens) {
      if (current) out.push(current);
      current = line.trim() ? { line: index + 1, text: line } : null;
      return;
    }
    if (current) current.text += ` ${line.trim()}`;
    else current = { line: index + 1, text: line };
  });
  if (current) out.push(current);
  return out;
}
// The detector's own cases: a write in a code span and one in plain prose are both caught; a
// reference to the skill's own file is not.
for (const [line, want] of [
  ["Write `.amanuensis/review-notes.md`.", ".amanuensis/review-notes.md"],
  ["Write .amanuensis/review-notes.md.", ".amanuensis/review-notes.md"],
  ["Then append the result to notes.md and stop.", "notes.md"],
  ["Read references/records.md before you write.", null],
  ["Save the survey as survey-notes.md next to the database.", "survey-notes.md"],
  ["Write the survey to a Markdown file under the storage directory.", "Markdown file"],
  ["Use the Write tool to put the survey under the storage directory.", "the Write tool"],
]) {
  const found = writtenFiles(line);
  if (want === null ? found.length > 0 : !found.includes(want)) {
    fail(`the write detector reads ${JSON.stringify(line)} as ${JSON.stringify(found)}`);
  }
}
for (const [file, text] of texts) {
  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(text)) fail(`${file} names ${label}`);
  }
  for (const { line, text: joined } of paragraphs(text)) {
    for (const name of writtenFiles(joined)) fail(`${file}:${line} tells the agent to write ${name}`);
    const rendered = RENDERED_MD.exec(joined);
    if (rendered) fail(`${file}:${line} says a page renders as ${rendered[1] ?? rendered[2]}; pages are .html`);
  }
}

// Every refusal the skill quotes is one the server emits: each literal run between its
// <placeholders> appears in mcp-server/src (F16/claude). The server assembles some refusals
// from parts (a tool name, a cap, a quoted value), so a run holding a digit or a quote mark is
// not compared, and the `<tool> refuses: ` prefix is read apart from the sentence.
const serverText = readdirSync(join(root, "mcp-server", "src", "tools"))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => read(join(root, "mcp-server", "src", "tools", name)) ?? "")
  .join("\n");
for (const [file, text] of texts) {
  for (const quoted of text.matchAll(/`([a-z_]+ refuses: [^`]+)`/g)) {
    const flat = quoted[1].replace(/\s+/g, " ");
    for (const piece of flat.replace(/^[a-z_]+ refuses: /, "").split(/<[^>]+>/)) {
      const words = piece.trim();
      if (words.length >= 8 && !/[\d'"|]/.test(words) && !serverText.includes(words)) {
        fail(`${file} quotes the refusal "${flat}", and the server emits no "${words}"`);
      }
    }
  }
}

// ------------------------------------------------- the file list and records.md

if (existsSync(join(refs, "artifact-templates.md"))) fail("references/artifact-templates.md still exists");
const skillText = texts.get("SKILL.md") ?? "";
for (const [file, text] of texts) {
  for (const match of text.matchAll(/`references\/([a-z0-9-]+\.md)`/g)) {
    if (!existsSync(join(refs, match[1]))) fail(`${file} names references/${match[1]}, which does not exist`);
  }
}
for (const file of files) {
  if (file === "SKILL.md") continue;
  if (!skillText.includes(`\`${file}\``)) fail(`SKILL.md lists no ${file}`);
}

const records = load("references/records.md");
const FAMILIES = [
  [/^Project profile/i, ["record_project_profile"]],
  [/^Purposes? and accounts?/i, ["record_explanation", "decline_explanation", "get_explanations"]],
  [/^Runtime boundaries/i, ["record_runtime_boundary", "withdraw_runtime_boundary", "get_runtime_boundaries"]],
  [/^Narratives/i, ["record_narrative", "decline_narrative", "get_narratives"]],
  [/^Concern calibration/i, ["add_concern", "record_territory_disposition"]],
  [/^Flow marks/i, ["record_claim_mark", "withdraw_claim_mark", "decline_claim_marks"]],
];
for (const [heading, wanted] of FAMILIES) {
  const body = section(records, heading);
  if (body === "") {
    fail(`records.md has no section headed ${heading.source.replace("^", "")}`);
    continue;
  }
  for (const tool of wanted) {
    if (!body.includes(tool)) fail(`records.md's ${heading.source.replace("^", "")} section does not name ${tool}`);
  }
}
const narratives = section(records, /^Narratives/i).replace(/\s+/g, " ").toLowerCase();
for (const row of sectionMeanings) {
  // Each section is said in the contract's own words: "`value` holds <meaning>".
  const meaning = row.meaning.replace(/\.$/, "").replace(/\s+/g, " ");
  const said = `\`${row.value}\` holds ${meaning.charAt(0).toLowerCase()}${meaning.slice(1)}`.toLowerCase();
  if (!narratives.includes(said)) fail(`records.md's narratives section does not say what \`${row.value}\` contains: "${meaning}"`);
}
// A mark on a claim that is not a flow step is refused as the writer says it (F16/claude).
if (!/`record_claim_mark refuses: <key> is not a flow step`/.test(section(records, /^Flow marks/i))) {
  fail("records.md's flow marks section does not quote `record_claim_mark refuses: <key> is not a flow step`");
}
if (/dispatch/i.test(records) && /prompt/i.test(records) && /template/i.test(records)) {
  fail("records.md still carries a dispatch-prompt template (D8)");
}

// ------------------------------------------------------------------ the steps

const hasSection = (args, want) => args.section === want;
// The server refuses a narrative that cites no evidence, except a survey plan.
const cites = (args) => "evidence_ids" in args;
const hasValue = (args, key, pattern) => typeof args[key] === "string" && pattern.test(args[key]);

// Onboarding Phase 7: the record calls replace the files.
const onboarding = load("references/onboarding.md");
const phase7 = section(onboarding, /^Phase 7 · /);
if (phase7 === "") fail("onboarding.md has no Phase 7 section");
else {
  if (/write the prose/i.test(phase7)) fail("onboarding.md Phase 7 still says to write the prose artifacts");
  requireCalls("onboarding.md Phase 7", phase7, "record_project_profile");
  requireCalls(
    "onboarding.md Phase 7",
    phase7,
    "record_explanation",
    (args) => hasValue(args, "subject_type", /^project$/) && hasValue(args, "slot", /^purpose$/),
  );
  requireCalls("onboarding.md Phase 7", phase7, "record_runtime_boundary");
  // All six project sections are written at onboarding, runtime among them (F7/codex, slice S2).
  for (const wanted of ["repository-shape", "runtime", "stateful-entities", "concern-calibration", "start-here", "survey-plan"]) {
    requireCalls(
      `onboarding.md Phase 7 (${wanted})`,
      phase7,
      "record_narrative",
      (args) =>
        hasValue(args, "subject_type", /^project$/) && hasSection(args, wanted) && (wanted === "survey-plan" || cites(args)),
    );
  }
  requireCalls("onboarding.md Phase 7", phase7, "add_concern", (args) => "territory" in args && "probe" in args);
  requireCalls("onboarding.md Phase 7", phase7, "record_territory_disposition");
  // The acceptance check moves from the file to the recorded body.
  requireCalls("onboarding.md Phase 7", phase7, "get_explanations", (args) => hasValue(args, "subject_type", /^project$/));
  for (const question of ["what does this system do", "what do i map first", "bug report", "feature request"]) {
    if (!phase7.replace(/\s+/g, " ").toLowerCase().includes(question)) {
      fail(`onboarding.md Phase 7 lost the acceptance question about "${question}"`);
    }
  }
}
const phase2 = section(onboarding, /^Phase 2 · /);
if (/exact heading|## Runtime boundary map/i.test(phase2)) {
  fail("onboarding.md Phase 2 still asks for the runtime table under an exact heading");
}
if (!/record_runtime_boundary/.test(phase2 + phase7)) fail("onboarding.md never has the runtime boundary recorded");
if (/Concern Calibration section/i.test(onboarding)) fail("onboarding.md still records a disqualified territory in a report section");

// Phase 2 of a survey.
const structural = load("references/phase-2-structural.md");
const flows = section(structural, /^3\. Primary data flows/);
if (flows === "") fail("phase-2-structural.md has no step 3 on primary data flows");
else {
  requireCalls("phase-2-structural.md step 3", flows, "record_claim_mark", (args) => "kind" in args);
  requireCalls("phase-2-structural.md step 3", flows, "decline_claim_marks");
}
if (/^## Output artifact/m.test(structural)) fail("phase-2-structural.md still ends in an output artifact");
// No page draws claim marks until the flow strip lands (SO25), so the skill may not promise one
// shows them (F9/codex, slice S2).
if (!existsSync(join(root, "materializer", "test-store-only-flow-strip.py")) && /on its page|the page shows/i.test(flows) && !/SO25|not yet/i.test(flows)) {
  fail("phase-2-structural.md step 3 says a page shows a flow's marks, which no page draws before SO25");
}
const structure = section(structural, /^Record the narrative/);
if (structure === "") fail("phase-2-structural.md has no \"Record the narrative\" section");
else {
  requireCalls(
    "phase-2-structural.md narrative step",
    structure,
    "record_narrative",
    (args) =>
      hasValue(args, "subject_type", /^subsystem$/) && hasSection(args, "structure") && "topic" in args && cites(args),
  );
  requireCalls(
    "phase-2-structural.md narrative step",
    structure,
    "decline_narrative",
    (args) => hasSection(args, "structure"),
  );
}

// Phase 3.
const concerns = load("references/phase-3-concerns.md");
requireCalls(
  "phase-3-concerns.md",
  concerns,
  "record_narrative",
  (args) => hasValue(args, "subject_type", /^subsystem$/) && hasSection(args, "concern-reasoning") && cites(args),
);
requireCalls("phase-3-concerns.md inputs", section(concerns, /^Inputs/), "get_narratives", (args) =>
  hasValue(args, "subject_type", /^subsystem$/),
);
if (/survey artifact/i.test(concerns)) fail("phase-3-concerns.md still reads a survey artifact");
// The server's prerequisite also accepts an unwithdrawn imported survey body (PLAN §2.5), so the
// inputs read it before stopping (F3/codex, slice S2).
requireCalls("phase-3-concerns.md inputs", section(concerns, /^Inputs/), "get_imported_artifacts", (args) =>
  hasValue(args, "kind", /^subsystem-survey$/) && "subsystem_id" in args,
);

// Phase 4.
const adversarial = load("references/phase-4-adversarial.md");
requireCalls(
  "phase-4-adversarial.md",
  adversarial,
  "record_narrative",
  (args) =>
    hasValue(args, "subject_type", /^subsystem$/) && hasSection(args, "challenge") && "topic" in args && cites(args),
);
if (/survey artifact|"Adversarial review" section/i.test(adversarial)) {
  fail("phase-4-adversarial.md still writes the adversarial review into a survey artifact");
}

// Phase 5: steps 1-4 are gone; the narratives are settled after the explanations.
const packaging = load("references/phase-5-packaging.md");
const settleExplanations = packaging.search(/^### Settle the explanations/m);
const settleNarratives = packaging.search(/^### Settle the narratives/m);
if (settleExplanations < 0) fail("phase-5-packaging.md lost \"Settle the explanations\"");
if (settleNarratives < 0) fail("phase-5-packaging.md has no \"Settle the narratives\"");
if (settleExplanations >= 0 && settleNarratives >= 0 && settleNarratives < settleExplanations) {
  fail("phase-5-packaging.md settles the narratives before the explanations");
}
const settled = section(packaging, /^Settle the narratives/);
requireCalls("phase-5-packaging.md Settle the narratives", settled, "get_narratives", (args) =>
  hasValue(args, "subject_type", /^subsystem$/),
);
requireCalls("phase-5-packaging.md Settle the narratives", settled, "record_narrative");
// A withdrawn key is discharged at its own topic, which history names (F5/codex, slice S2).
requireCalls("phase-5-packaging.md Settle the narratives", settled, "decline_narrative", (args) => "topic" in args);
requireCalls("phase-5-packaging.md Settle the narratives", settled, "get_narratives", (args) =>
  hasValue(args, "history", /^true$/),
);
if (/^### \d+\. (?:Update|Register)/m.test(packaging)) fail("phase-5-packaging.md still has the file-update steps");
if (/materializer reads to decide whether to re-render/.test(packaging)) {
  fail("phase-5-packaging.md still says rehashing is what the materializer reads to re-render");
}

// The survey loop.
const survey = load("references/subsystem-survey.md");
requireCalls(
  "subsystem-survey.md session setup",
  section(survey, /^Session setup/),
  "acquire_lock",
  (args) => hasValue(args, "artifact_path", /^<id>$|^<subsystem_id>$|^\$\{subsystem_id\}$/) && "holder_id" in args,
);
const phase5Summary = section(survey, /^Phase 5 · /);
if (!/get_narratives|narratives/i.test(phase5Summary)) {
  fail("subsystem-survey.md's Phase 5 list does not settle the narratives");
}
if (/subsystem-survey` artifact/.test(survey)) fail("subsystem-survey.md still names a `subsystem-survey` artifact");

// The memory audit.
const audit = load("references/memory-audit.md");
requireCalls("memory-audit.md", audit, "get_narratives");
if (codeCalls(audit).some((call) => call.name === "list_artifacts")) fail("memory-audit.md still audits the artifact registry");
if (/re-?hash/i.test(audit)) fail("memory-audit.md still re-hashes artifacts");

// explanations.md and SKILL.md: the thesis is a recorded project purpose.
const explanations = load("references/explanations.md");
if (!/project's purpose is its thesis/i.test(explanations)) fail("explanations.md no longer says the project's purpose is its thesis");
requireCalls(
  "explanations.md",
  explanations,
  "record_explanation",
  (args) => hasValue(args, "subject_type", /^project$/) && hasValue(args, "slot", /^purpose$/),
);
if (!/references\/records\.md/.test(skillText)) fail("SKILL.md does not point at references/records.md");

// ---------------------------------------------------------- the calls themselves

if (tools) {
  for (const [file, text] of texts) {
    for (const call of codeCalls(text)) {
      const td = tools.get(call.name);
      if (!td) {
        fail(`${file}: \`${call.name}(…)\` is not a tool the server defines`);
        continue;
      }
      const properties = Object.keys(td.inputSchema.properties ?? {});
      for (const arg of Object.keys(call.args)) {
        if (!properties.includes(arg)) fail(`${file}: \`${call.name}\` takes no argument \`${arg}\``);
      }
    }
  }
  // Every value written for a narrative section is one the contract defines.
  for (const [file, text] of texts) {
    for (const call of codeCalls(text)) {
      if (call.name !== "record_narrative" && call.name !== "decline_narrative" && call.name !== "get_narratives") continue;
      const value = call.args.section;
      if (typeof value === "string" && sections.length > 0 && !sections.includes(value)) {
        fail(`${file}: ${call.name} names section "${value}", which the contract does not define`);
      }
    }
  }
}

// -------------------------------------------------------------------- the verdict

for (const message of failures) console.log(`  FAIL ${message}`);
if (failures.length > 0) {
  console.log(`GATE SO10 RED: ${failures.length} check(s) failed; first: ${failures[0]}`);
  process.exit(1);
}
console.log("GATE SO10 GREEN");
