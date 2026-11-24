#!/usr/bin/env node
// GATE SC9 (design/scope/PLAN.md §3 SC9; §0-§2 as revised in §6).
//
// Reads the docs the packet changes and checks what they say against the code and the plan, not
// that a heading is present. It touches no store and no network.
//
// Turns red when:
//   - README.md's "Trust is part of the architecture" section does not carry exactly one new
//     sentence (a pure insertion into the section, against the section at the packet's start
//     commit) that says a survey leaves out the paths the repository's ignore files match, the
//     paths the owner excluded and the paths sorted as meta; that an excluded path gets no
//     ledger row and no evidence; that it shows on the overview only as a count; and that an
//     owner include brings a path back. A line added outside that section names the survey
//     set or a scope tool. The rest of README.md is not this packet's, so later edits to it pass;
//   - INSTALLATION.md names the survey set, Phase 0b or a scope tool (no command changed, so it
//     gets nothing);
//   - HISTORY.md's introduction differs from its start, or the entry directly above the
//     0.2.0-beta.7 release is not `## [Unreleased]` (or the release cut from it), or that entry
//     is missing any of: the survey set (the tree minus gitignore,
//     owner and meta paths), the owner's include winning, the three tools by name (each
//     registered in src/tools/scope.ts), excluded paths having no ledger row or evidence and
//     showing only as an overview count, `describe_locus` answering `excluded` with its source,
//     the unsorted-path refusal that names up to 20 paths (the constant in invariants.ts), the
//     legacy store changing only by gitignore matches leaving the set, and onboarding's
//     Phase 0b; or an older release entry is changed;
//   - a start-commit copy in dev/fixtures/scope-docs/start/ is missing or is not the start
//     commit's bytes (its sha256 is pinned), so the gate needs no Git history;
//   - mcp-server/DEVELOPMENT.md has no `## The survey set` section before the generated tool
//     inventory, or the section: names a `scope_*` table that schema.sql does not create or
//     omits one of the five new tables or `scope_reconciliations`; names a source file, helper
//     or digest that does not exist; omits the precedence (owner rules, then gitignore, then
//     sorting, in that order), the two modes `sorted` and `legacy`, `scope_digest`,
//     `exclusion_digest`, the write guard, the readers or the migration; states a cap different
//     from the code's; or does not list every gate in design/scope/plan.json, each present
//     in the CI workflow;
//   - .github/workflows/test.yml has no step that runs `node dev/test-scope-docs.mjs`, placed
//     after SC8's step, under a comment naming GATE SC9.
// Prints exactly one last line: `GATE SC9 GREEN` (exit 0) or `GATE SC9 RED: <reason>` (exit 1).

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const START_SHA = "45a0cf5b4d4ad75ae3c912e46743cfa2dcaf644f";
// Committed copies of each doc at START_SHA, so the gate needs no Git history; each is pinned to
// the sha256 of the start revision's blob, so a copy edited to match the tree turns red.
const START_COPIES = join(root, "dev", "fixtures", "scope-docs", "start");
const START_SHA256 = {
  "README.md": "7403573f776376b83bece84d8ab1fda2ef16db1b12537cb5b494645a953df995",
  "HISTORY.md": "2106cff658ea5c7aad4ee628e05bcd26ba3d2ae6520149848338ddbe9d527c37",
};

// A quoted failure can carry a crash signature, which would make a red run look like a crash.
const CRASH_SIGNATURES = [
  "MODULE_NOT_FOUND",
  "Cannot find module",
  "ModuleNotFoundError",
  "SyntaxError",
  "No such file or directory",
  "command not found",
  "ImportError",
  "ENOENT",
  "ReferenceError",
  "is not defined",
  "Traceback (most recent call last)",
];
function scrub(text) {
  let out = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  for (const signature of CRASH_SIGNATURES) {
    const cut = Math.ceil(signature.length / 2);
    out = out.split(signature).join(`${signature.slice(0, cut)}…${signature.slice(cut)}`);
  }
  return out.length > 400 ? `${out.slice(0, 400)}…` : out;
}

const failures = [];
function check(label, fn) {
  try {
    const problem = fn();
    if (problem) failures.push(`${label}: ${problem}`);
  } catch (error) {
    failures.push(`${label}: ${scrub(error?.message ?? error)}`);
  }
}

function readText(rel) {
  try {
    return readFileSync(join(root, rel), "utf8");
  } catch {
    return null;
  }
}

/** The committed copy of a doc at the packet's start commit; null when absent or not that revision's bytes. */
function baseline(rel) {
  let bytes;
  try {
    bytes = readFileSync(join(START_COPIES, rel));
  } catch {
    return null;
  }
  if (createHash("sha256").update(bytes).digest("hex") !== START_SHA256[rel]) return null;
  return bytes.toString("utf8");
}
const NO_BASELINE = (rel) =>
  `the start revision ${START_SHA.slice(0, 7)} of ${rel} is not at dev/fixtures/scope-docs/start/${rel} with its pinned sha256`;

// What only this packet's docs name: a line elsewhere naming one of these was added for the survey set.
const SCOPE_WORDS = /\bsurvey set\b|\bset_scope_rule\b|\brecord_scope_sorting\b|\bget_scope\b|\bPhase 0b\b/i;

const squash = (text) => text.replace(/\s+/g, " ").trim();
const plain = (text) => squash(text.toLowerCase().replace(/[`*]/g, ""));

/** The text between the first heading line equal to `heading` and the next heading of that level. */
function section(md, heading) {
  const level = heading.match(/^#+/)[0];
  const lines = md.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (new RegExp(`^${level}\\s`).test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

/** What `after` added to `before`, when that is one contiguous insertion; otherwise null. */
function insertion(before, after) {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (
    s < before.length - p &&
    s < after.length - p &&
    before[before.length - 1 - s] === after[after.length - 1 - s]
  )
    s++;
  if (before.length - p - s !== 0) return null;
  return { text: after.slice(p, after.length - s), at: p };
}

const sentences = (text) =>
  squash(text)
    .split(/(?<=[.!?])\s+(?=[A-Z“"`(])/)
    .filter((s) => s.length > 0);

const needAll = (haystack, patterns) => {
  for (const [label, pattern] of patterns) {
    if (!pattern.test(haystack)) return `does not say ${label}`;
  }
  return null;
};

// ---- the code the docs describe -------------------------------------------------------------

const scopeTools = readText("mcp-server/src/tools/scope.ts");
const schemaSql = readText("mcp-server/src/schema.sql");
const invariants = readText("mcp-server/src/invariants.ts");

const TOOLS = ["set_scope_rule", "record_scope_sorting", "get_scope"];
const NEW_TABLES = [
  "scope_rules",
  "scope_sorting",
  "scope_inventory",
  "scope_exclusions",
  "scope_mode_changes",
];

let namedUnsorted = null;
check("the code the docs name", () => {
  if (scopeTools === null) return "mcp-server/src/tools/scope.ts is missing";
  if (schemaSql === null) return "mcp-server/src/schema.sql is missing";
  if (invariants === null) return "mcp-server/src/invariants.ts is missing";
  for (const tool of TOOLS) {
    if (!new RegExp(`name:\\s*"${tool}"`).test(scopeTools)) return `${tool} is not registered`;
  }
  const cap = invariants.match(/const NAMED_UNSORTED = (\d+);/);
  if (!cap) return "invariants.ts has no NAMED_UNSORTED constant";
  namedUnsorted = Number(cap[1]);
  return null;
});

// ---- README.md ------------------------------------------------------------------------------

check("README.md", () => {
  const now = readText("README.md");
  if (now === null) return "README.md is missing";
  const trust = section(now, "## Trust is part of the architecture");
  if (trust === null) return "has no 'Trust is part of the architecture' section";
  const before = baseline("README.md");
  if (before === null) return NO_BASELINE("README.md");
  const trustBefore = section(before, "## Trust is part of the architecture");
  if (trustBefore === null) return "the start copy has no 'Trust is part of the architecture' section";
  const added = insertion(trustBefore, trust);
  if (added === null) return "the Trust section differs from its start in more than one added passage";
  if (added.text.trim() === "") return "adds no sentence to the section";
  // The one sentence is the section's; a line added elsewhere about the survey set is a second.
  const startLines = new Set(before.split("\n"));
  const outside = now.replace(trust, "").split("\n").find((line) => !startLines.has(line) && SCOPE_WORDS.test(line));
  if (outside !== undefined) return `a line outside the Trust section speaks of the survey set: "${scrub(outside)}"`;
  const sentenceList = sentences(added.text);
  if (sentenceList.length !== 1)
    return `adds ${sentenceList.length} sentences where the plan gives it one`;
  const said = plain(sentenceList[0]);
  const missing = needAll(said, [
    ["that a survey leaves out paths", /\bsurvey\b[^.]*\bleaves? out\b|\bleaves? out\b[^.]*\bsurvey\b/],
    ["the paths the repository's ignore files match", /ignore[sd]?\b[^.]*\bgit\b|\bgit\b[^.]*\bignore|\bignore files?\b|gitignore/],
    ["the paths the owner excluded", /\bowner\b[^.]*\bexclu/],
    ["the paths sorted as meta", /\bmeta\b/],
    ["that an excluded path gets no ledger row", /\bno ledger row\b|\bledger row\b[^.]*\bnone\b|\bwithout (?:a )?ledger row/],
    ["that it gets no evidence", /\bevidence\b/],
    ["that it shows only as a count on the overview", /\bcount\b[^.]*\boverview\b|\boverview\b[^.]*\bcount\b/],
    ["that an owner include brings a path back", /\binclude\b[^.]*\b(?:back|returns?|restores?)\b|\b(?:back|returns?|restores?)\b[^.]*\binclude\b/],
  ]);
  if (missing) return `the added sentence ${missing}: "${scrub(sentenceList[0])}"`;
  // Its claims are the plan's: nothing may say excluded paths are listed or labelled.
  if (/\b(?:lists?|labels?|prints?|shows?) (?:each |every )?excluded paths?\b/.test(said))
    return "the sentence says excluded paths are listed, which the owner ruled out";
  return null;
});

check("INSTALLATION.md", () => {
  const now = readText("INSTALLATION.md");
  if (now === null) return "INSTALLATION.md is missing";
  const line = now.split("\n").find((l) => SCOPE_WORDS.test(l));
  return line === undefined ? null : `speaks of the survey set, though no command changed (PLAN §3 SC9): "${scrub(line)}"`;
});

// ---- HISTORY.md -----------------------------------------------------------------------------

check("HISTORY.md", () => {
  const now = readText("HISTORY.md");
  if (now === null) return "HISTORY.md is missing";
  const lines = now.split("\n");
  const headings = lines.map((line, i) => [line, i]).filter(([line]) => /^## /.test(line));
  // The entry sits directly above 0.2.0-beta.7: `[Unreleased]` until a release is cut from it.
  const beta7 = headings.findIndex(([line]) => /^## \[0\.2\.0-beta\.7\]/.test(line));
  if (beta7 < 0) return "has no 0.2.0-beta.7 entry";
  if (beta7 === 0) return "has no entry above the 0.2.0-beta.7 release";
  const [heading, from] = headings[beta7 - 1];
  if (!/^## \[(?:Unreleased|\d+\.\d+\.\d+[^\]]*)\]/.test(heading))
    return `the entry above 0.2.0-beta.7 is '${scrub(heading)}', not '## [Unreleased]' or a release`;
  const entry = lines.slice(from + 1, headings[beta7][1]).join("\n");
  // A bullet wraps onto indented lines; each is read as one string.
  const bullets = entry
    .split(/\n(?=- )/)
    .filter((b) => b.startsWith("- "))
    .map(squash);
  if (bullets.length < 3) return "the Unreleased entry has fewer than three bullets";
  const said = plain(entry);
  const missing = needAll(said, [
    ["the survey set", /\bsurvey set\b/],
    ["that gitignore matches leave the set", /\bignore files?\b|\bgitignore\b|\bignored by git\b/],
    ["that owner rules leave paths out", /\bowner\b[^.]*\b(?:exclu|rule)/],
    ["that onboarding sorts paths as meta", /\bmeta\b/],
    ["that an owner include wins", /\binclude\b[^.]*\b(?:win|wins|beat|beats|override|overrides|restores?|back)\b/],
    ["that an excluded path has no ledger row", /\bno ledger row\b|\bledger row\b[^.]*\b(?:no|none|never)\b|\bwithout (?:a )?ledger row/],
    ["that an excluded path has no evidence", /\bevidence\b/],
    ["that the overview carries a count", /\boverview\b[^.]*\bcount\b|\bcount\b[^.]*\boverview\b/],
    ["that describe_locus answers excluded", /describe_locus[^.]*\bexcluded\b|\bexcluded\b[^.]*describe_locus/],
    ["that the answer names its source", /\bsource\b/],
    ["that publication is refused while paths are unsorted", /\bunsorted\b/],
    ["onboarding's Phase 0b", /\bphase 0b\b/],
    ["that an existing store keeps working", /\bexisting (?:store|stores)\b|\blegacy\b|\bolder stores?\b/],
  ]);
  if (missing) return `the Unreleased entry ${missing}`;
  for (const tool of TOOLS) {
    if (!entry.includes(`\`${tool}\``)) return `the Unreleased entry does not name \`${tool}\``;
  }
  if (!new RegExp(`\\b${namedUnsorted}\\b[^.]*\\b(?:unsorted|paths?)\\b|\\b(?:unsorted|paths?)\\b[^.]*\\b${namedUnsorted}\\b`).test(said))
    return `the Unreleased entry does not give the ${namedUnsorted} paths the unsorted refusal names`;
  // A store that already had rows changes in one way only: gitignore matches leave its set.
  const legacy = bullets.find((b) => /\b(?:existing|legacy|older)\b/i.test(b));
  if (!legacy) return "no bullet says what happens to an existing store";
  if (!/\bgitignore\b|\bignore files?\b|\bignored by git\b/i.test(legacy))
    return "the bullet on existing stores does not say gitignore matches are what leave the set";
  if (!/\b(?:only|nothing else|no other)\b/i.test(legacy))
    return "the bullet on existing stores does not say that is the only change";
  // Older entries are left as they were.
  const before = baseline("HISTORY.md");
  if (before === null) return NO_BASELINE("HISTORY.md");
  const oldFrom = before.indexOf("## [0.2.0-beta.7]");
  if (oldFrom < 0) return "the start commit's HISTORY.md has no 0.2.0-beta.7 entry";
  const nowFrom = now.indexOf("## [0.2.0-beta.7]");
  if (now.slice(nowFrom) !== before.slice(oldFrom)) return "an older release entry was changed";
  if (now.slice(0, now.indexOf("\n## ") + 1) !== before.slice(0, oldFrom))
    return "the introduction changed";
  return null;
});

// ---- mcp-server/DEVELOPMENT.md ---------------------------------------------------------------

/** Every backticked token of the text. */
const spans = (text) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);

function gatePaths() {
  const plan = JSON.parse(readText("design/scope/plan.json") ?? "null");
  if (!plan || !Array.isArray(plan.packets)) throw new Error("design/scope/plan.json has no packets");
  return plan.packets.map((p) => [p.id, p.gate?.test_path]).filter(([, path]) => path);
}

function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(join(root, d))) {
      const rel = `${d}/${name}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (/\.(?:ts|mjs|py|sql)$/.test(name)) out.push(rel);
    }
  };
  walk(dir);
  return out;
}

check("mcp-server/DEVELOPMENT.md", () => {
  const dev = readText("mcp-server/DEVELOPMENT.md");
  if (dev === null) return "mcp-server/DEVELOPMENT.md is missing";
  const marker = dev.indexOf("<!-- TOOL-INVENTORY-START -->");
  const heading = dev.indexOf("\n## The survey set\n");
  if (heading < 0) return "has no '## The survey set' section";
  if (marker < 0) return "has lost the tool inventory markers";
  if (heading > marker) return "the survey-set section is inside or after the generated tool inventory";
  // The generated inventory follows with no level-2 heading of its own; the section ends at its marker.
  const body = section(dev, "## The survey set").split("<!-- TOOL-INVENTORY-START -->")[0];
  const prose = squash(body);
  const said = plain(body);

  // Names of tables: every scope_* span is a table schema.sql creates, and the new ones are named.
  const created = new Set([...schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]));
  const named = spans(body);
  for (const span of named) {
    if (/^scope_\w+$/.test(span) && !created.has(span) && !/_digest$|^scope_mode$/.test(span))
      return `names \`${span}\`, which schema.sql does not create`;
  }
  for (const table of [...NEW_TABLES, "scope_reconciliations"]) {
    if (!named.includes(table)) return `does not name the table \`${table}\``;
    if (!created.has(table)) return `\`${table}\` is not created by schema.sql`;
  }

  // Names of files and symbols exist.
  const sources = sourceFiles("mcp-server/src").concat(sourceFiles("materializer/amanuensis_materializer"));
  const corpus = sources.map((rel) => readText(rel) ?? "").join("\n");
  for (const span of named) {
    if (/^[\w./-]+\.(?:ts|mjs|py|sql|json|md)$/.test(span) && !span.includes(" ")) {
      const candidates = [span, `mcp-server/${span}`, `mcp-server/src/${span}`, `dev/${span}`];
      if (!candidates.some((c) => existsSync(join(root, c))))
        return `names \`${span}\`, which is not a file of the repository`;
    }
    if (/^[a-z]+(?:[A-Z][a-z0-9]+)+\(?\)?$/.test(span)) {
      const symbol = span.replace(/\(\)$/, "");
      if (!new RegExp(`\\b${symbol}\\b`).test(corpus)) return `names \`${span}\`, which no source defines`;
    }
    if (/^[a-z]+(?:_[a-z]+)+$/.test(span) && TOOLS.includes(span) === false && /^(?:set|get|record)_/.test(span)) {
      if (!new RegExp(`name:\\s*"${span}"`).test(corpus)) return `names the tool \`${span}\`, which is not registered`;
    }
  }
  for (const tool of TOOLS) if (!named.includes(tool)) return `does not name the tool \`${tool}\``;

  // What the section says.
  const missing = needAll(said, [
    ["what the survey set is", /\bsurvey set\b[^.]*\btree\b|\btree\b[^.]*\bsurvey set\b/],
    ["that every consumer of the whole tree uses it", /\b(?:every|each|all)\b[^.]*\b(?:reader|consumer)s?\b|\bdenominator\b/],
    ["the three sources of exclusion", /\bgitignore\b[^.]*\bowner\b[^.]*\bmeta\b|\bgitignore\b[^.]*\buser\b[^.]*\bmeta\b/],
    ["the mode `sorted`", /\bsorted\b/],
    ["the mode `legacy`", /\blegacy\b/],
    ["the ignore files being read at the revision", /\bat (?:that |the )?revision\b|\bat a revision\b/],
    ["the git check-ignore resolution", /check-ignore/],
    ["the write guard", /\bwrite guard\b|requiresurveyscopeforwrite/],
    ["that reads are never refused", /\breads? (?:is|are) never refused\b|\bnever refus\w+ a read\b|\breads? (?:keep|still) work/],
    ["the unsorted publication refusal", /\bunsorted\b[^.]*\b(?:refus|publication)\b|\b(?:refus|publication)\w*\b[^.]*\bunsorted\b/],
    ["the migration of existing stores", /\bmigrat\w+\b/],
    ["the code index's query-time filter", /\bcode index\b[^.]*\bquery\b|\bquery time\b/],
    ["the pages' omission of excluded paths", /\bpages?\b[^.]*\b(?:omit|absent|leave out|never print)\w*\b|\b(?:omit|absent)\w*\b[^.]*\bpages?\b/],
  ]);
  if (missing) return `the section ${missing}`;
  if (!/`scope_digest`/.test(body) || !/`exclusion_digest`/.test(body))
    return "does not name both witness digests, `scope_digest` and `exclusion_digest`";
  if (!/`sorted`/.test(body) || !/`legacy`/.test(body)) return "does not give the modes `sorted` and `legacy` as code";

  // Precedence, in order, as a list: owner rules, then gitignore, then sorting.
  // A numbered step wraps onto the lines after it; each step is read as one string.
  const steps = body
    .split(/\n(?=\d\.\s)/)
    .filter((step) => /^\d\.\s/.test(step))
    .map((step) => squash(step).toLowerCase());
  const at = (re) => steps.findIndex((step) => re.test(step));
  const owner = at(/owner/);
  const ignore = at(/gitignore/);
  const sorting = at(/sorting/);
  if (owner < 0 || ignore < 0 || sorting < 0)
    return "does not list the precedence as numbered steps naming the owner's rules, gitignore and sorting";
  if (!(owner < ignore && ignore < sorting))
    return "lists the precedence out of order: owner's rules, then gitignore, then sorting";
  if (!/\binclude\b/.test(steps[owner]) || !/\bspecific/.test(steps[owner]))
    return "the owner's step does not say an include returns a path and that the more specific rule decides";

  // Numbers: the cap on named unsorted paths is the code's.
  const named20 = prose.match(/\bup to (\d+)\b[^.]*\bunsorted\b|\bunsorted\b[^.]*\bup to (\d+)\b/);
  if (!named20) return "does not say how many unsorted paths the publication refusal names";
  const stated = Number(named20[1] ?? named20[2]);
  if (stated !== namedUnsorted) return `says the refusal names up to ${stated} unsorted paths; the code names ${namedUnsorted}`;

  // The gate list: every plan.json gate, once each, and each in the CI workflow.
  const workflow = readText(".github/workflows/test.yml") ?? "";
  const runs = workflow
    .split("\n")
    .filter((line) => /^\s*run:/.test(line))
    .join("\n");
  for (const [id, path] of gatePaths()) {
    if (!named.includes(path)) return `the gate list does not name ${id}'s gate \`${path}\``;
    if (named.filter((s) => s === path).length !== 1) return `the gate list names \`${path}\` more than once`;
    const base = path.replace(/^(?:mcp-server|materializer)\//, "");
    if (!runs.includes(base)) return `${id}'s gate \`${path}\` does not run in .github/workflows/test.yml`;
    if (!existsSync(join(root, path))) return `${id}'s gate \`${path}\` is not a file`;
  }
  return null;
});

// ---- the workflow ---------------------------------------------------------------------------

check(".github/workflows/test.yml", () => {
  const yml = readText(".github/workflows/test.yml");
  if (yml === null) return "is missing";
  const lines = yml.split("\n");
  const sc8 = lines.findIndex((line) => /^\s*run:\s*node dev\/test-skill-scope\.mjs\s*$/.test(line));
  if (sc8 < 0) return "lost SC8's step";
  const sc9 = lines.findIndex((line) => /^\s*run:\s*node dev\/test-scope-docs\.mjs\s*$/.test(line));
  if (sc9 < 0) return "has no step that runs `node dev/test-scope-docs.mjs`";
  if (sc9 <= sc8) return "SC9's step is not after SC8's";
  if (lines.filter((line) => /test-scope-docs\.mjs/.test(line) && /^\s*run:/.test(line)).length !== 1)
    return "runs the SC9 gate more than once";
  const above = lines.slice(Math.max(0, sc9 - 8), sc9).join("\n");
  if (!/GATE SC9\b/.test(above)) return "the step has no comment naming GATE SC9 above it";
  if (!/^\s*- name: .+$/.test(lines[sc9 - 1])) return "the run line does not belong to a named step";
  return null;
});

if (failures.length > 0) {
  for (const failure of failures.slice(1, 6)) console.log(`also failed: ${scrub(failure)}`);
  // The status line goes last, so the launcher reads it as the verdict.
  console.log(`GATE SC9 RED: ${scrub(failures[0])}`);
  process.exit(1);
}
console.log("GATE SC9 GREEN");
