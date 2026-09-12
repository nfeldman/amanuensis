#!/usr/bin/env node
// B03-3: the evidence-quality vocabulary was published in three places and was
// allowed to diverge. set_disposition accepted five values while add_evidence
// accepted nine and the methodology contract documented an eight-rung ladder,
// so an agent whose strongest evidence was `test-observed` could not record it
// and had to overstate or understate instead.
//
// The methodology names overstating evidence quality as its most common failure
// mode, so the vocabulary that expresses it cannot be left to convention.
//
// This check compares FOUR parties, each read independently as text:
//
//   1. contracts/conspectus-vocabulary.json   the source
//   2. src/vocabulary.ts                      generated for the server
//   3. materializer/…/vocabulary.py           generated for the projection
//   4. .claude/skills/amanuensis/SKILL.md     hand-written prose
//
// It does not follow an import to reach any of them. The earlier version
// recovered its lists by regex from `const KINDS = [` in src/tools/evidence.ts;
// once those tools import the generated arrays that literal is gone and the
// check would die on its own error path, and following the import instead would
// compare one array with itself — a comparison that cannot turn red. Reading
// each party as text is what keeps the comparison able to fail.
//
// SKILL.md is the only hand-written party and is the one the check exists to
// catch. Every vocabulary its prose publishes is compared — the evidence-kind
// ladder, the disposition verdicts, the phase ladder, and the authorized-claims
// table — as a set, not in order: the ladder publishes the kinds
// strongest-first, which is a claim about strength, not about the order any
// validator stores them in. A surface may legitimately publish a subset, and
// each says which values it omits and why.
//
// Usage:
//   node scripts/check-evidence-vocabulary.mjs
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(ROOT, "..");

const PARTIES = {
  json: "conspectus-vocabulary.json",
  ts: "vocabulary.ts",
  py: "vocabulary.py",
  skill: "SKILL.md",
};

const errors = [];
function report(party, message) {
  errors.push(`${PARTIES[party]}: ${message}`);
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// ---- party 1: the source -------------------------------------------------
const sourceText = read(resolve(ROOT, "contracts/conspectus-vocabulary.json"));
let source = null;
if (sourceText === null) report("json", "the enum source could not be read");
else {
  try {
    source = JSON.parse(sourceText);
  } catch {
    report("json", "the enum source is not parseable JSON");
  }
}

/** value lists from the source, keyed by the generated const name. */
const sourceLists = new Map();
if (source?.enums) {
  for (const [name, decl] of Object.entries(source.enums)) {
    if (!decl?.const_name || !Array.isArray(decl.values)) {
      report("json", `${name} carries no const_name or no values`);
      continue;
    }
    sourceLists.set(decl.const_name, decl.values.map((value) => value.value));
  }
  if (sourceLists.size === 0) report("json", "the enum source declares no vocabularies");
} else if (source) {
  report("json", "the enum source declares no enums");
}

// ---- parties 2 and 3: the generated files, read as text ------------------
// The generator owns these shapes; reading them back by pattern is what makes
// the comparison independent of the module system.
function parseLists(text, pattern) {
  const found = new Map();
  let match;
  while ((match = pattern.exec(text)) !== null) {
    found.set(
      match[1],
      match[2]
        .split(",")
        .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean),
    );
  }
  return found;
}

const tsText = read(resolve(ROOT, "src/vocabulary.ts"));
const tsLists =
  tsText === null
    ? null
    : parseLists(tsText, /export const ([A-Z0-9_]+) = \[([^\]]*)\] as const;/g);
if (tsText === null) report("ts", "the generated server module could not be read");
else if (tsLists.size === 0) report("ts", "no generated enum arrays were found in it");

const pyText = read(resolve(REPO, "materializer/amanuensis_materializer/vocabulary.py"));
const pyLists =
  pyText === null
    ? null
    : parseLists(pyText, /^([A-Z0-9_]+): tuple\[str, \.\.\.\] = \(([^)]*)\)/gm);
if (pyText === null) report("py", "the generated projection module could not be read");
else if (pyLists.size === 0) report("py", "no generated enum tuples were found in it");

// Compare every vocabulary the source carries against both generated copies.
for (const [constName, want] of sourceLists) {
  for (const [party, lists] of [
    ["ts", tsLists],
    ["py", pyLists],
  ]) {
    if (!lists) continue;
    const got = lists.get(constName);
    if (!got) {
      report(party, `${constName} is absent`);
      continue;
    }
    const missing = want.filter((value) => !got.includes(value));
    const extra = got.filter((value) => !want.includes(value));
    if (missing.length) report(party, `${constName} omits: ${missing.join(", ")}`);
    if (extra.length) report(party, `${constName} carries values the source does not: ${extra.join(", ")}`);
    if (!missing.length && !extra.length && want.join(" ") !== got.join(" "))
      report(party, `${constName} lists the same values in a different order`);
  }
}

// The B03-3 invariant itself: a disposition names the strongest evidence row
// attached to it, so the two vocabularies must be the same vocabulary.
const kinds = sourceLists.get("EVIDENCE_KINDS") ?? [];
const quality = sourceLists.get("EVIDENCE_QUALITIES") ?? [];
if (kinds.length && quality.length) {
  const unrecordable = kinds.filter((kind) => !quality.includes(kind));
  if (unrecordable.length)
    report(
      "json",
      `set_disposition could not record evidence kinds add_evidence accepts: ${unrecordable.join(", ")}. ` +
        "An agent holding one of these as its strongest evidence would have to over- or understate it.",
    );
  const unbacked = quality.filter((value) => !kinds.includes(value));
  if (unbacked.length)
    report("json", `evidence_quality carries values no evidence row can carry: ${unbacked.join(", ")}`);
}

// ---- party 4: the hand-written prose ------------------------------------
// SKILL.md is the only hand-written party and the one this check exists to
// catch. Every vocabulary it publishes is compared, not just the two the
// original B03-3 check knew about: changing the phase ladder's `concerns` to
// `concerns-broken` left this check and P1 green (F2/codex). Each surface
// declares its own extractor and its own documented omissions, because a
// prose ladder legitimately publishes a subset — `deferred` is an orthogonal
// do-not-survey flag with no rank, so the status ladder does not carry it.
const clean = (entry) => entry.trim().replace(/`/g, "").replace(/\s+/g, " ");

const SKILL_SURFACES = [
  {
    constName: "EVIDENCE_KINDS",
    what: "the kind ladder",
    extract: (text) => {
      const match = text.match(/kind ladder \(([^)]*)\)/s);
      return match ? match[1].split(">").map(clean).filter(Boolean) : null;
    },
  },
  {
    constName: "DISPOSITION_CLASSIFICATIONS",
    what: "the disposition verdicts",
    extract: (text) => {
      const match = text.match(/`set_disposition` writes\s+one of `([^`]*)`/s);
      return match ? match[1].split("|").map(clean).filter(Boolean) : null;
    },
  },
  {
    constName: "SUBSYSTEM_STATUSES",
    what: "the phase ladder",
    omits: ["deferred"],
    extract: (text) => {
      const match = text.match(/\n(unmapped(?:[ \t]*→[ \t]*[a-z-]+)+)[ \t]*\n/);
      return match ? match[1].split("→").map(clean).filter(Boolean) : null;
    },
  },
  {
    constName: "SUBSYSTEM_STATUSES",
    what: "the authorized-claims table",
    omits: ["deferred"],
    extract: (text) => {
      const at = text.indexOf("| Status | Authorized claims |");
      if (at === -1) return null;
      const found = [];
      for (const line of text.slice(at).split("\n").slice(2)) {
        if (!line.startsWith("|")) break;
        const match = line.match(/^\|\s*`([^`]+)`\s*\|/);
        if (match) found.push(clean(match[1]));
      }
      return found.length ? found : null;
    },
  },
];

const skillText = read(resolve(REPO, ".claude/skills/amanuensis/SKILL.md"));
let skillSurfaces = 0;
if (skillText === null) report("skill", "the skill contract could not be read");
else {
  for (const surface of SKILL_SURFACES) {
    const want = sourceLists.get(surface.constName);
    if (!want) {
      report("json", `${surface.what} names ${surface.constName}, which the source does not carry`);
      continue;
    }
    const expected = want.filter((value) => !(surface.omits ?? []).includes(value));
    const documented = surface.extract(skillText);
    if (documented === null) {
      report("skill", `${surface.what} could not be found`);
      continue;
    }
    skillSurfaces += 1;
    const undocumented = expected.filter((value) => !documented.includes(value));
    const unimplemented = documented.filter((value) => !expected.includes(value));
    if (undocumented.length)
      report("skill", `${surface.what} omits accepted values: ${undocumented.join(", ")}`);
    if (unimplemented.length)
      report("skill", `${surface.what} documents values no tool accepts: ${unimplemented.join(", ")}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`  ${error}`);
  console.error(`\nevidence vocabulary drift: ${errors.length} finding(s)`);
  process.exit(1);
}
console.log(
  `OK — ${PARTIES.json}, ${PARTIES.ts}, ${PARTIES.py}, and ${PARTIES.skill} agree ` +
    `(${sourceLists.size} vocabularies; ${skillSurfaces} of them published in prose).`,
);
