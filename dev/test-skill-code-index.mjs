#!/usr/bin/env node
// GATE SI9 (design/semantic-index/PLAN.md §5, §8 SI9).
//
// Turns red when:
//   - a skill file SI9 owns (SKILL.md and references/code-index.md, phase-1-scope.md,
//     phase-2-structural.md, phase-3-concerns.md, phase-4-adversarial.md, refresh.md, notes.md)
//     has no index guidance between `<!-- code-index:begin -->` and `<!-- code-index:end -->`, or
//     its markers do not pair;
//   - the guidance does not name the tools at the steps §5 lists: SKILL.md the store first
//     (`describe_locus`, `search_records`), `find_symbol` for a definition, `outline_file` for a
//     file's shape, `read_symbol` for a definition and `evidence_args` for a citation, the whole
//     file read whenever context helps; code-index.md the same four tools and the whole-file
//     sentence; phase 1 `find_symbol` for definitions and name-matched references, `outline_file`
//     for imports, `rg` for strings, comments, config and other languages; phase 2 `outline_file`
//     for a subsystem's types and flow steps cited through `evidence_args`; phases 3 and 4 a claim
//     verified from its cited definition and the surrounding code it depends on; refresh.md
//     the file's diff, `anchor_state` and every evidence row, claim and disposition accounted for
//     before `clear_staleness`; notes.md `search_records` when `describe_locus` has nothing;
//   - a code span in the guidance names a tool, or a tool's argument, the built server does not
//     define, or one of the four index tools is missing from the built server;
//   - the guidance says whole files may not, or should not first, be read: any sentence that
//     forbids, defers, rations or gates reading a file ("only after", "only when", "sparingly"),
//     or sends the agent to the index instead or ahead of the file;
//   - the guidance does not say whole files may be read, in SKILL.md and in code-index.md;
//   - phase 1's guidance says whole files may be read (phase 1 reads no method bodies); notes.md
//     reports an empty `search_records` as the store holding nothing rather than as no current
//     record matching; a guidance block sits between a colon and what it introduces; `unanchored`
//     is described as anything but an evidence row with no anchor;
//   - a `find_symbol` reference is not described as matched by name and a lead to confirm
//     (SKILL.md, phase 1, phase 3, phase 4);
//   - refresh.md gives a route to clearing staleness on `anchor_state` alone: a sentence that names
//     a state and has a clause clearing with no negation before the clearing word, or one that says
//     a `same-text` row needs no reading or is done;
//   - text outside the markers changed: a line of a skill file at the start revision (other than
//     the navigation sentences SI9 replaces, and of a line that held one, only that sentence) is
//     gone, for example phase 1's "No method bodies yet" or phase 4's `add_files_to_scope` advice;
//   - the old navigation rule ("semantic language-intelligence tools first … shell grep last")
//     is still in SKILL.md, phase 1, phase 3 or phase 4;
//   - the checks above cannot tell good from bad: each detector is run on bad and good sentences
//     first, and a detector that misses a bad one turns the gate red.
// Reads the skill, its committed start-revision copies in dev/fixtures/skill-code-index/start/ and
// the built server's tool definitions; it needs no Git history, writes nothing and touches no store.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { restricts, sentences } from "./reading-guidance.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, ".claude", "skills", "amanuensis");
const START_SHA = "984f09b9e75378e8d48e97cc2141e98cfbe3f07b";
// Committed copies of each skill file at START_SHA, so the gate needs no Git history; each is
// pinned to the sha256 of the start revision's blob, so a copy edited to match the tree turns red.
const START_COPIES = join(root, "dev", "fixtures", "skill-code-index", "start");
const START_SHA256 = {
  "SKILL.md": "02797e51918aeaf3f53f6fdf1cbc52bb5a696bc4c51584d683d1c6c66051e51d",
  "references/code-index.md": "8e7ee86371501c0fdb69066a4775717262e06003beccc21472e6ab87962f58e0",
  "references/phase-1-scope.md": "f308411ae29185888b3df6844f7f05358aa22b899a7013adf3118dc545cc2222",
  "references/phase-2-structural.md": "fabc6fda3157351d90f4f36efa7f6b413e8e96313c94bae90b9713276cec4261",
  "references/phase-3-concerns.md": "5aa1b601e2498fc123700a678026a0e0191e070aee6013534cd44ca4bd63668e",
  "references/phase-4-adversarial.md": "31c1a800657767b5fc553e208d14117aa41f72f3ad4f16fb5eaa2883dc57c8d4",
  "references/refresh.md": "f2d8085704bdad018183ee086a09c5e55b974154e0ac72f10dbf95e3670993cb",
  "references/notes.md": "f2a76c8f285b8d7662d917e17a195ab0483355ca3bbe32eb76d1b1827fe32168",
};
const BEGIN = "<!-- code-index:begin -->";
const END = "<!-- code-index:end -->";

const failures = [];
const fail = (message) => failures.push(message);

function finish() {
  if (failures.length > 0) {
    for (const message of failures) console.log(`  - ${message}`);
    console.log(`GATE SI9 RED: ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ""}`);
    process.exit(1);
  }
  console.log("GATE SI9 GREEN");
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// --- text helpers -------------------------------------------------------------------------

/** The text between each marker pair; null with a reason when the markers do not pair. */
function markedPassages(text) {
  const passages = [];
  let at = 0;
  for (;;) {
    const begin = text.indexOf(BEGIN, at);
    const stray = text.indexOf(END, at);
    if (begin === -1) {
      if (stray !== -1) return { error: "an end marker has no begin marker" };
      return { passages };
    }
    if (stray !== -1 && stray < begin) return { error: "an end marker comes before its begin marker" };
    const end = text.indexOf(END, begin + BEGIN.length);
    if (end === -1) return { error: "a begin marker has no end marker" };
    const body = text.slice(begin + BEGIN.length, end);
    if (body.includes(BEGIN)) return { error: "markers nest" };
    passages.push(body);
    at = end + END.length;
  }
}

const has = (sentenceList, ...patterns) =>
  sentenceList.some((s) => patterns.every((p) => p.test(s)));

// --- detectors, each exercised on bad and good sentences before it is trusted -------------


// A negation counts only when it comes before the clearing word in the same clause: "does not
// decide `clear_staleness`" denies, "can be cleared without reading" and "no changes need
// inspection; run `clear_staleness`" do not.
const NEGATION = /\b(not|never|no|nor|cannot|can't|neither)\b/i;
const STATE_NAME = /\b(anchor_state|same-text|moved|unchanged|gone|ambiguous)\b/i;
const CLEARING = /\bclear(s|ed|ing)?\b|\bclear_staleness\b/i;
const LICENSES =
  /\bno (further|more|other) (reading|look|re-?examination|checking)\b|\bneed not (read|re-?examine|look)\b|\bskip(ping)? (the )?(read|re-?examin)|\bsafe to clear\b|\benough to clear\b|\bsuffic\w* to clear\b|\bclear (it|them|these|the file|those) (on|from|by|when|if|once)\b|\bautomatically\b/i;
// With a state named, a sentence that calls the row finished or says nothing needs looking at.
const STATE_LICENSES =
  /\b(is|are) (done|finished|settled|resolved|complete)\b|\bneeds? no\b|\bno\b[^.;]*\bneeds? (inspection|reading|review|re-?examination|checking|a look)\b/i;
const clauses = (s) => s.split(/[;:]|,\s*(?=(?:then|so|and then)\b)/);
const deniedClear = (clause) => NEGATION.test(clause.slice(0, clause.search(CLEARING)));
/** True when a sentence of refresh guidance makes anchor_state a ground for clearing. */
const clearsOnAnchor = (s) =>
  (STATE_NAME.test(s) && (STATE_LICENSES.test(s) || clauses(s).some((c) => CLEARING.test(c) && !deniedClear(c)))) ||
  LICENSES.test(s);

const NAME_MATCH_OK = (s) => /\b(confirm|lead|leads)\b/i.test(s);

function selfTest() {
  const badRestrictions = [
    "Do not read whole files; use `read_symbol` instead.",
    "Use `read_symbol` rather than reading the whole file.",
    "Prefer `outline_file` over reading the file.",
    "Call `outline_file` before you read the file.",
    "Read a file only through `read_symbol`.",
    "Whole files are expensive, so avoid them.",
    "You must call `find_symbol` first.",
    "Reading the whole file is a last resort.",
    "Never open a whole file when `outline_file` answers it.",
    "Keep reads small to ration the context.",
    "Using `read_symbol` saves tokens.",
    "Whole files may be read only after `find_symbol` returns no matches.",
    "Read whole files sparingly.",
    "Open a whole file only when `read_symbol` is not enough.",
    "Reach for the index ahead of the file itself.",
  ];
  for (const s of badRestrictions) if (!restricts(s)) fail(`self-test: the restriction detector missed "${s}"`);
  const goodRestrictions = [
    "Whole files may be read whenever context helps; the index is there to find and cite.",
    "Read a definition with `read_symbol`, or the whole file when its surroundings matter.",
    "A `find_symbol` reference is matched by name: confirm it before calling it a call site.",
    "Whole files may be read at any point: the index is there to find and cite.",
    "If the code index cannot read a path, read the file directly.",
  ];
  for (const s of goodRestrictions) if (restricts(s)) fail(`self-test: the restriction detector flagged "${s}"`);

  const badClears = [
    "When `anchor_state` is `same-text`, call `clear_staleness`.",
    "A `same-text` row needs no further reading.",
    "Rows whose cited definition is `moved` can be cleared.",
    "If every row is `same-text`, it is safe to clear the file.",
    "`clear_staleness` follows from `anchor_state` automatically.",
    "With `anchor_state` set to `same-text`, no code changes need inspection; run `clear_staleness`.",
    "A `same-text` row can be cleared without reading the diff.",
    "Without reading the diff, a `same-text` row can be cleared.",
    "Rows marked `same-text` are done.",
  ];
  for (const s of badClears) if (!clearsOnAnchor(s)) fail(`self-test: the refresh detector missed "${s}"`);
  const goodClears = [
    "`anchor_state` does not decide `clear_staleness`; read the file's diff first.",
    "Account for every evidence row, claim and disposition on the file, anchored or not, before `clear_staleness`.",
    "`same-text` is a place to look at the diff around, not a verdict.",
    "`anchor_state` does not decide `clear_staleness`, which clears the whole file.",
    "A `same-text` row cannot be cleared without reading the diff.",
  ];
  for (const s of goodClears) if (clearsOnAnchor(s)) fail(`self-test: the refresh detector flagged "${s}"`);
}

// --- the built server's tools -------------------------------------------------------------

async function loadTools() {
  const tools = new Map();
  let files;
  try {
    files = readdirSync(join(root, "mcp-server", "dist", "tools")).filter((n) => n.endsWith(".js")).sort();
  } catch {
    return null;
  }
  for (const file of files) {
    let mod;
    try {
      mod = await import(pathToFileURL(join(root, "mcp-server", "dist", "tools", file)).href);
    } catch {
      continue;
    }
    for (const value of Object.values(mod)) {
      if (!Array.isArray(value)) continue;
      for (const td of value) {
        if (td && typeof td.name === "string" && td.inputSchema) tools.set(td.name, td);
      }
    }
  }
  return tools;
}

// Response fields and arguments the guidance may name in a code span without being a tool.
const RESPONSE_FIELDS = new Set([
  "evidence_args",
  "anchor_state",
  "symbol_id",
  "blob_sha",
  "target_lines",
  "partial_reason",
  "clear_staleness",
]);

// --- what each file's guidance must say ---------------------------------------------------

const FILES = {
  "SKILL.md": (s) => {
    const need = [
      ["asks the store first with `describe_locus` and `search_records`", [/\bstore\b/i, /`describe_locus\b/, /`search_records\b/]],
      ["uses `find_symbol` to find a definition", [/`find_symbol\b/, /\bdefinitions?\b/i]],
      ["uses `outline_file` to see a file's shape", [/`outline_file\b/, /\bshape\b/i]],
      ["reads a definition with `read_symbol`", [/`read_symbol\b/, /\bread\b/i]],
      ["cites with `evidence_args`, narrowing `line_range` inside the definition", [/`evidence_args\b/, /`line_range\b/, /\bnarrow/i]],
      ["points at references/code-index.md", [/code-index\.md/]],
    ];
    return need;
  },
  "references/code-index.md": () => [
    ["names `outline_file`", [/`outline_file\b/]],
    ["names `read_symbol`", [/`read_symbol\b/]],
    ["names `find_symbol`", [/`find_symbol\b/]],
    ["names `search_records`", [/`search_records\b/]],
    ["says where each tool fits the work and names `evidence_args`", [/`evidence_args\b/, /\bcite\b/i]],
  ],
  "references/phase-1-scope.md": () => [
    ["`find_symbol` for definitions and name-matched references", [/`find_symbol\b/, /\bdefinitions?\b/i, /\breferences?\b/i]],
    ["`outline_file` for imports", [/`outline_file\b/, /\bimports?\b/i]],
    ["`rg` for strings, comments and config", [/`rg\b/, /\bstrings?\b/i, /\bcomments?\b/i, /\bconfig/i]],
    ["`rg` for other languages", [/`rg\b/, /\b(other|unsupported) languages?\b/i]],
  ],
  "references/phase-2-structural.md": () => [
    ["`outline_file` lists a subsystem's types", [/`outline_file\b/, /\btypes?\b/i]],
    ["flow steps cited through `evidence_args`", [/`evidence_args\b/, /\bflow\b/i]],
  ],
  "references/phase-3-concerns.md": () => [
    ["verifies from the cited definition", [/\bcited definition\b/i, /\bverif/i]],
    ["and the surrounding code the claim depends on", [/\b(surrounding|around)\b/i, /\bdepends?\b/i]],
    ["names `read_symbol`", [/`read_symbol\b/]],
    ["names `find_symbol`", [/`find_symbol\b/]],
  ],
  "references/phase-4-adversarial.md": () => [
    ["verifies from the cited definition", [/\bcited definition\b/i, /\bverif/i]],
    ["and the surrounding code the claim depends on", [/\b(surrounding|around)\b/i, /\bdepends?\b/i]],
    ["names `read_symbol`", [/`read_symbol\b/]],
    ["names `find_symbol`", [/`find_symbol\b/]],
  ],
  "references/refresh.md": () => [
    ["reads the file's diff", [/\bdiff\b/i, /\bread\b/i]],
    ["uses `anchor_state` to see which cited definitions moved or changed", [/`anchor_state\b/, /\bmoved\b/i, /\bchanged\b/i]],
    ["says `anchor_state` does not decide the clear", [/`anchor_state\b/, /\b(not|never|cannot)\b/i, /\b(clear|clears|clearing)\b|`clear_staleness`/i]],
    [
      "accounts for every evidence row, claim and disposition on the file, anchored or not, before `clear_staleness`",
      [/\bevery evidence row\b/i, /\bclaim/i, /\bdisposition/i, /\banchored or not\b/i, /`clear_staleness\b/],
    ],
  ],
  "references/notes.md": () => [
    ["answers with `search_records` when `describe_locus` has nothing", [/`search_records\b/, /`describe_locus\b/, /\bnothing\b/i]],
    [
      "reports an empty search as no current record matching, not as the store holding nothing",
      [/\b(finds|returns|has) nothing\b|\bno (hits|matches)\b/i, /\bcurrent\b/i, /\bmatch/i],
    ],
  ],
};

// What an empty `search_records` cannot show: it searches current records of some kinds by words.
const ABSENCE = /\bstore (holds|has|knows|contains|says) nothing\b|\bnothing (is )?(recorded|known) (on|about)\b/i;
// Phase 1 reads no method bodies, so its guidance licenses no whole-file reading.
const WHOLE_FILE_LICENSE = (s) =>
  /\bwhole files?\b/i.test(s) && /\b(may|can)\b[^.]*\bread\b|\bread\b[^.]*\b(whenever|when|at any point)\b/i.test(s);

// Every skill file that must say whole files may be read.
const WHOLE_FILE = ["SKILL.md", "references/code-index.md"];
// Files where a `find_symbol` reference must be a name-matched lead.
const NAME_MATCHED = ["SKILL.md", "references/phase-1-scope.md", "references/phase-3-concerns.md", "references/phase-4-adversarial.md"];

// Navigation sentences SI9 replaces: the only lines of the start revision allowed to go. A pair
// names a line that held a replaced sentence and what of it must stay: the rest of the line.
const REPLACED = {
  "SKILL.md": [
    "- **Use the highest-capability navigation tool available.** Semantic",
    "language-intelligence tools first; project-wide search second; shell",
    "grep last.",
  ],
  "references/phase-1-scope.md": ["- Callers and callees of key symbols (semantic tools first; grep", "last)."],
  "references/phase-3-concerns.md": ["Semantic tools first (find-references, call-hierarchy,", "find-implementations). Grep last."],
  "references/phase-4-adversarial.md": [
    "Semantic tools to find call sites, implementations, type",
    ["constraints. Walk out from the finding's location in both", "Walk out from the finding's location in both"],
  ],
};
const OLD_NAVIGATION = [
  /semantic language-intelligence tools first/i,
  /semantic tools first/i,
  /\bgrep last\b/i,
  /shell\s+grep\s+last/i,
];

/** The committed copy of a skill file at the start revision; null when absent or not that revision's bytes. */
function startRevision(path) {
  let bytes;
  try {
    bytes = readFileSync(join(START_COPIES, path));
  } catch {
    return null;
  }
  if (createHash("sha256").update(bytes).digest("hex") !== START_SHA256[path]) return null;
  return bytes.toString("utf8");
}

const trimmedLines = (text) => text.split("\n").map((l) => l.trim()).filter((l) => l !== "");

// --- run ----------------------------------------------------------------------------------

selfTest();

const tools = await loadTools();
if (tools === null || tools.size === 0) {
  fail("the built server's tools cannot be loaded; run `npm run build` in mcp-server");
} else {
  for (const name of ["outline_file", "read_symbol", "find_symbol", "search_records"]) {
    if (!tools.has(name)) fail(`the built server defines no tool ${name}`);
  }
}
const toolNames = tools ? new Set(tools.keys()) : new Set();
const schemaProperties = new Set();
for (const td of tools?.values() ?? []) {
  for (const key of Object.keys(td.inputSchema?.properties ?? {})) schemaProperties.add(key);
}

let refreshText = "";
for (const [file, needs] of Object.entries(FILES)) {
  const text = read(join(skill, file));
  if (text === null) {
    fail(`${file} cannot be read`);
    continue;
  }
  if (file === "references/refresh.md") refreshText = text;
  const marked = markedPassages(text);
  if (marked.error) {
    fail(`${file}: ${marked.error}`);
    continue;
  }
  if (marked.passages.length === 0) {
    fail(`${file} has no index guidance between ${BEGIN} and ${END}`);
    continue;
  }
  const joined = marked.passages.join("\n\n");
  const list = sentences(joined);

  for (const [what, patterns] of needs()) {
    if (!has(list, ...patterns)) fail(`${file}: the guidance does not say it ${what}`);
  }

  if (WHOLE_FILE.includes(file)) {
    const says = list.some((s) => /\bwhole files?\b/i.test(s) && /\b(may|can)\b[^.]*\bread\b|\bread\b[^.]*\b(whenever|when)\b/i.test(s));
    if (!says) fail(`${file}: the guidance does not say whole files may be read`);
  }
  if (file === "references/phase-1-scope.md") {
    const license = list.find(WHOLE_FILE_LICENSE);
    if (license) fail(`${file}: the guidance licenses whole files against phase 1's "Do not read method bodies": "${license.slice(0, 110)}"`);
  }
  for (const s of list) {
    if (ABSENCE.test(s)) fail(`${file}: an empty search is reported as the store holding nothing: "${s.slice(0, 110)}"`);
  }
  // A guidance block does not cut into the sentence or list a colon opens.
  for (const m of text.matchAll(/<!-- code-index:begin -->/g)) {
    const lead = text.slice(0, m.index).trimEnd().split("\n").pop();
    if (/:$/.test(lead)) fail(`${file}: the index guidance sits between "${lead.slice(-60)}" and what it introduces`);
  }
  // `unanchored` is a state of the evidence row, which has no anchor; the other states are the cited definition's.
  for (const s of list) {
    if (/`unanchored`/.test(s) && !/\b(no|without an?) anchor\b/i.test(s)) {
      fail(`${file}: \`unanchored\` is not described as an evidence row with no anchor: "${s.slice(0, 110)}"`);
    }
  }
  if (NAME_MATCHED.includes(file)) {
    const ok = list.some((s) => /`find_symbol`|\breferences?\b/i.test(s) && /\b(matched by name|name-matched|by name)\b/i.test(s) && NAME_MATCH_OK(s));
    if (!ok) fail(`${file}: the guidance does not describe a name-matched reference as a lead to confirm`);
  }
  for (const s of list) {
    if (restricts(s)) fail(`${file}: the guidance restricts reading: "${s.slice(0, 110)}"`);
    if (/\b(a|the) reference\b[^.]*\bcall sites?\b/i.test(s) && !NAME_MATCH_OK(s)) {
      fail(`${file}: a reference is called a call site without a lead to confirm: "${s.slice(0, 110)}"`);
    }
  }

  // Every tool and argument a code span in the guidance names exists.
  for (const match of joined.matchAll(/`([^`\n]+)`/g)) {
    const span = match[1];
    const call = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\((.*)\)$/s.exec(span);
    if (call) {
      if (!toolNames.has(call[1])) {
        fail(`${file}: \`${call[1]}\` is named as a tool and the server does not define it`);
        continue;
      }
      const props = new Set(Object.keys(tools.get(call[1]).inputSchema.properties ?? {}));
      for (const arg of call[2].split(",")) {
        const name = /^\s*([a-z_][a-z0-9_]*)\??\s*(?:=|:|$)/i.exec(arg)?.[1];
        if (name && !props.has(name) && !/^<|^\.\.\./.test(arg.trim())) {
          fail(`${file}: \`${call[1]}\` has no argument ${name}`);
        }
      }
    } else if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(span)) {
      if (!toolNames.has(span) && !schemaProperties.has(span) && !RESPONSE_FIELDS.has(span)) {
        fail(`${file}: \`${span}\` is named in the guidance and is neither a tool nor a field of one`);
      }
    }
  }
}

// The old navigation rule is gone from the files that carried it.
for (const file of ["SKILL.md", "references/phase-1-scope.md", "references/phase-3-concerns.md", "references/phase-4-adversarial.md"]) {
  const text = read(join(skill, file));
  if (text === null) continue;
  const flat = text.replace(/\s+/g, " ");
  for (const re of OLD_NAVIGATION) {
    if (re.test(flat)) fail(`${file} still carries the old navigation rule (${re.source})`);
  }
}

// Text outside the markers is as it was: every line of the start revision survives, but the
// navigation sentences SI9 replaces.
for (const file of Object.keys(FILES)) {
  const before = startRevision(file);
  const now = read(join(skill, file));
  if (now === null) continue;
  if (before === null) {
    fail(`the start revision ${START_SHA.slice(0, 7)} of ${file} is not at dev/fixtures/skill-code-index/start/${file} with its pinned sha256`);
    continue;
  }
  const replaced = new Map((REPLACED[file] ?? []).map((l) => (Array.isArray(l) ? [l[0].trim(), l[1].trim()] : [l.trim(), ""])));
  const present = new Set(trimmedLines(now));
  for (const line of trimmedLines(before)) {
    const rest = replaced.has(line) ? replaced.get(line) : line;
    if (rest === "") continue;
    if (!present.has(rest)) {
      fail(`${file}: a line outside the index guidance changed or went: "${line.slice(0, 90)}"`);
      break;
    }
  }
}

// Phase 1's "no method bodies yet" and the survey's other non-index rules stay.
const phase1Text = read(join(skill, "references/phase-1-scope.md")) ?? "";
if (!/No method bodies yet/.test(phase1Text.replace(/\s+/g, " "))) {
  fail('phase-1-scope.md lost "No method bodies yet"');
}
if (!/Do not read method bodies/.test(phase1Text.replace(/\s+/g, " "))) {
  fail('phase-1-scope.md lost "Do not read method bodies"');
}

// refresh.md gives no route to clearing staleness on anchor_state alone, anywhere in the file.
if (refreshText) {
  for (const s of sentences(refreshText)) {
    if (clearsOnAnchor(s)) fail(`refresh.md: a route to clearing on anchor_state alone: "${s.slice(0, 110)}"`);
  }
}

finish();
