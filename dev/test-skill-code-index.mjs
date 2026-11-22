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
//     forbids, defers, rations or gates reading a file, or sends the agent to the index instead;
//   - the guidance does not say whole files may be read, in SKILL.md and in code-index.md;
//   - a `find_symbol` reference is not described as matched by name and a lead to confirm
//     (SKILL.md, phase 1, phase 3, phase 4);
//   - refresh.md gives a route to clearing staleness on `anchor_state` alone: a sentence that ties
//     `clear_staleness` to a state without a negation, or one that says a `same-text` row needs
//     no reading;
//   - text outside the markers changed: a line of a skill file at the start revision (other than
//     the navigation sentences SI9 replaces) is gone, for example phase 1's "No method bodies yet";
//   - the old navigation rule ("semantic language-intelligence tools first … shell grep last")
//     is still in SKILL.md, phase 1, phase 3 or phase 4;
//   - the checks above cannot tell good from bad: each detector is run on bad and good sentences
//     first, and a detector that misses a bad one turns the gate red.
// Reads the skill and the built server's tool definitions; it writes nothing and touches no store.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, ".claude", "skills", "amanuensis");
const START_SHA = "984f09b9e75378e8d48e97cc2141e98cfbe3f07b";
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

/** Sentences of a text, read whole across wrapped lines. */
function sentences(text) {
  const out = [];
  for (const block of text.split(/\n\s*\n/)) {
    const flat = block.replace(/\n\s*(?:[-*]|\d+\.)\s+/g, "\n").replace(/\s+/g, " ").trim();
    for (const part of flat.split(/(?<=[.?!])\s+(?=[A-Z`*"(])|\s+-\s+(?=[A-Z`])/)) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

const has = (sentenceList, ...patterns) =>
  sentenceList.some((s) => patterns.every((p) => p.test(s)));

// --- detectors, each exercised on bad and good sentences before it is trusted -------------

const RESTRICTIONS = [
  /\b(do not|don't|never|avoid|must not|should not|shouldn't|refrain from|stop)\b[^.]*\b(read|reads|reading|open|opening)\b[^.]*\b(files?|source|whole|entire|full)\b/i,
  /\b(instead of|rather than|in place of)\b[^.]*\b(read|reading|whole files?|file reads?)\b/i,
  /\bprefer\b[^.]*\bover\b[^.]*\b(read|reading|whole files?)\b/i,
  /\b(before|until|unless|only after|first)\b[^.]*\b(read|reading|open|opening)\b[^.]*\b(files?|whole)\b/i,
  /\b(only|just)\b[^.]*\b(use|via|through|with)\b[^.]*\b(outline_file|read_symbol|find_symbol)\b/i,
  /\b(must|required to|always|need to|have to)\b[^.]*\b(outline_file|read_symbol|find_symbol)\b[^.]*\b(before|first|prior)\b/i,
  /\b(before|first|prior to)\b[^.]*\b(whole|entire|full) files?\b/i,
  /\b(whole|entire|full)[- ]files?\b[^.]*\b(discourag|expensive|wasteful|costly|too large|last resort|fall ?back|budget)/i,
  /\b(last resort|fall ?back)\b[^.]*\b(read|reading|whole file)/i,
  /\bration/i,
  /\b(saves?|cheaper|fewer tokens|reduces? reading|expensive)\b/i,
];
const restricts = (s) => RESTRICTIONS.some((re) => re.test(s));

const NEGATION = /\b(not|never|no|nor|cannot|can't|without|neither)\b/i;
const STATE_NAME = /\b(anchor_state|same-text|moved|unchanged|gone|ambiguous)\b/i;
const CLEARING = /\bclear(s|ed|ing)?\b|\bclear_staleness\b/i;
const LICENSES =
  /\bno (further|more|other) (reading|look|re-?examination|checking)\b|\bneed not (read|re-?examine|look)\b|\bskip(ping)? (the )?(read|re-?examin)|\bsafe to clear\b|\benough to clear\b|\bsuffic\w* to clear\b|\bclear (it|them|these|the file|those) (on|from|by|when|if|once)\b|\bautomatically\b/i;
/** True when a sentence of refresh guidance makes anchor_state a ground for clearing. */
const clearsOnAnchor = (s) =>
  (STATE_NAME.test(s) && CLEARING.test(s) && !NEGATION.test(s)) || LICENSES.test(s);

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
  ];
  for (const s of badRestrictions) if (!restricts(s)) fail(`self-test: the restriction detector missed "${s}"`);
  const goodRestrictions = [
    "Whole files may be read whenever context helps; the index is there to find and cite.",
    "Read a definition with `read_symbol`, or the whole file when its surroundings matter.",
    "A `find_symbol` reference is matched by name: confirm it before calling it a call site.",
  ];
  for (const s of goodRestrictions) if (restricts(s)) fail(`self-test: the restriction detector flagged "${s}"`);

  const badClears = [
    "When `anchor_state` is `same-text`, call `clear_staleness`.",
    "A `same-text` row needs no further reading.",
    "Rows whose cited definition is `moved` can be cleared.",
    "If every row is `same-text`, it is safe to clear the file.",
    "`clear_staleness` follows from `anchor_state` automatically.",
  ];
  for (const s of badClears) if (!clearsOnAnchor(s)) fail(`self-test: the refresh detector missed "${s}"`);
  const goodClears = [
    "`anchor_state` does not decide `clear_staleness`; read the file's diff first.",
    "Account for every evidence row, claim and disposition on the file, anchored or not, before `clear_staleness`.",
    "`same-text` is a place to look at the diff around, not a verdict.",
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
      ["asks the store first with `describe_locus` and `search_records`", [/\bstore\b/i, /`describe_locus`/, /`search_records`/]],
      ["uses `find_symbol` to find a definition", [/`find_symbol`/, /\bdefinitions?\b/i]],
      ["uses `outline_file` to see a file's shape", [/`outline_file`/, /\bshape\b/i]],
      ["reads a definition with `read_symbol`", [/`read_symbol`/, /\bread\b/i]],
      ["cites with `evidence_args`, narrowing `line_range` inside the definition", [/`evidence_args`/, /`line_range`/, /\bnarrow/i]],
      ["points at references/code-index.md", [/code-index\.md/]],
    ];
    return need;
  },
  "references/code-index.md": () => [
    ["names `outline_file`", [/`outline_file`/]],
    ["names `read_symbol`", [/`read_symbol`/]],
    ["names `find_symbol`", [/`find_symbol`/]],
    ["names `search_records`", [/`search_records`/]],
    ["says where each tool fits the work and names `evidence_args`", [/`evidence_args`/, /\bcite\b/i]],
  ],
  "references/phase-1-scope.md": () => [
    ["`find_symbol` for definitions and name-matched references", [/`find_symbol`/, /\bdefinitions?\b/i, /\breferences?\b/i]],
    ["`outline_file` for imports", [/`outline_file`/, /\bimports?\b/i]],
    ["`rg` for strings, comments and config", [/`rg`/, /\bstrings?\b/i, /\bcomments?\b/i, /\bconfig/i]],
    ["`rg` for other languages", [/`rg`/, /\b(other|unsupported) languages?\b/i]],
  ],
  "references/phase-2-structural.md": () => [
    ["`outline_file` lists a subsystem's types", [/`outline_file`/, /\btypes?\b/i]],
    ["flow steps cited through `evidence_args`", [/`evidence_args`/, /\bflow\b/i]],
  ],
  "references/phase-3-concerns.md": () => [
    ["verifies from the cited definition", [/\bcited definition\b/i, /\bverif/i]],
    ["and the surrounding code the claim depends on", [/\b(surrounding|around)\b/i, /\bdepends?\b/i]],
    ["names `read_symbol`", [/`read_symbol`/]],
    ["names `find_symbol`", [/`find_symbol`/]],
  ],
  "references/phase-4-adversarial.md": () => [
    ["verifies from the cited definition", [/\bcited definition\b/i, /\bverif/i]],
    ["and the surrounding code the claim depends on", [/\b(surrounding|around)\b/i, /\bdepends?\b/i]],
    ["names `read_symbol`", [/`read_symbol`/]],
    ["names `find_symbol`", [/`find_symbol`/]],
  ],
  "references/refresh.md": () => [
    ["reads the file's diff", [/\bdiff\b/i, /\bread\b/i]],
    ["uses `anchor_state` to see which cited definitions moved or changed", [/`anchor_state`/, /\bmoved\b/i, /\bchanged\b/i]],
    ["says `anchor_state` does not decide the clear", [/`anchor_state`/, /\b(not|never|cannot)\b/i, /\b(clear|clears|clearing)\b|`clear_staleness`/i]],
    [
      "accounts for every evidence row, claim and disposition on the file, anchored or not, before `clear_staleness`",
      [/\bevery evidence row\b/i, /\bclaim/i, /\bdisposition/i, /\banchored or not\b/i, /`clear_staleness`/],
    ],
  ],
  "references/notes.md": () => [
    ["answers with `search_records` when `describe_locus` has nothing", [/`search_records`/, /`describe_locus`/, /\bnothing\b/i]],
  ],
};

// Every skill file that must say whole files may be read.
const WHOLE_FILE = ["SKILL.md", "references/code-index.md"];
// Files where a `find_symbol` reference must be a name-matched lead.
const NAME_MATCHED = ["SKILL.md", "references/phase-1-scope.md", "references/phase-3-concerns.md", "references/phase-4-adversarial.md"];

// Navigation sentences SI9 replaces: the only lines of the start revision allowed to go.
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
    "constraints. Walk out from the finding's location in both",
    "directions. Do not limit yourself to the ledger if the answer might",
    "live outside — add files via `add_files_to_scope` with",
    "`why_in_scope=\"adversarial probe for ${finding_id}\"`.",
  ],
};
const OLD_NAVIGATION = [
  /semantic language-intelligence tools first/i,
  /semantic tools first/i,
  /\bgrep last\b/i,
  /shell\s+grep\s+last/i,
];

function startRevision(path) {
  try {
    return execFileSync("git", ["show", `${START_SHA}:.claude/skills/amanuensis/${path}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
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
    fail(`the start revision ${START_SHA.slice(0, 7)} cannot be read for ${file}`);
    continue;
  }
  const replaced = new Set((REPLACED[file] ?? []).map((l) => l.trim()));
  const present = new Set(trimmedLines(now));
  for (const line of trimmedLines(before)) {
    if (replaced.has(line)) continue;
    if (!present.has(line)) {
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
