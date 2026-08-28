#!/usr/bin/env node
// B03-3: the evidence-quality vocabulary is published in three places and was
// allowed to diverge. set_disposition accepted five values while add_evidence
// accepted nine and the methodology contract documented an eight-rung ladder,
// so an agent whose strongest evidence was `test-observed` could not record it
// and had to overstate or understate instead.
//
// The methodology names overstating evidence quality as its most common failure
// mode, so the vocabulary that expresses it cannot be left to convention.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(ROOT, "..");

function listFromSource(file, constName) {
  const source = readFileSync(resolve(ROOT, file), "utf8");
  const match = source.match(new RegExp(`const ${constName} = \\[([^\\]]*)\\]`, "s"));
  if (!match) throw new Error(`${file}: could not find ${constName}`);
  return match[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

const kinds = listFromSource("src/tools/evidence.ts", "KINDS");
const quality = listFromSource("src/tools/dispositions.ts", "EVIDENCE_QUALITY");

const errors = [];

const missingFromQuality = kinds.filter((kind) => !quality.includes(kind));
if (missingFromQuality.length) {
  errors.push(
    `set_disposition cannot record evidence kinds add_evidence accepts: ${missingFromQuality.join(", ")}. ` +
      `An agent holding one of these as its strongest evidence must over- or understate it.`,
  );
}
const extraInQuality = quality.filter((value) => !kinds.includes(value));
if (extraInQuality.length) {
  errors.push(`EVIDENCE_QUALITY accepts values no evidence row can carry: ${extraInQuality.join(", ")}`);
}

// The skill publishes the ladder as prose and calls it the evidence-quality
// scale, so it is a third copy of the same vocabulary and drifts the same way.
const skill = readFileSync(resolve(REPO, ".claude/skills/amanuensis/SKILL.md"), "utf8");
const ladderMatch = skill.match(/kind ladder \(([^)]*)\)/s);
if (!ladderMatch) {
  errors.push("SKILL.md: could not find the documented kind ladder");
} else {
  const documented = ladderMatch[1]
    .split(">")
    .map((entry) => entry.trim().replace(/`/g, "").replace(/\s+/g, " "))
    .filter(Boolean);
  const undocumented = kinds.filter((kind) => !documented.includes(kind));
  const unimplemented = documented.filter((value) => !kinds.includes(value));
  if (undocumented.length) {
    errors.push(`SKILL.md ladder omits accepted evidence kinds: ${undocumented.join(", ")}`);
  }
  if (unimplemented.length) {
    errors.push(`SKILL.md ladder documents kinds no tool accepts: ${unimplemented.join(", ")}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`  ${error}`);
  console.error(`\nevidence vocabulary drift: ${errors.length} finding(s)`);
  process.exit(1);
}
console.log(`OK — evidence vocabulary agrees across add_evidence, set_disposition, and SKILL.md (${kinds.length} kinds).`);
