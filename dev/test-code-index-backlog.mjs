#!/usr/bin/env node
// GATE SI0 (design/semantic-index/PLAN.md §8 SI0).
//
// Turns red when:
//   - BACKLOG.md is absent or unreadable, or has no code-index item
//     ("Code index: find and cite code exactly, alongside reading it.");
//   - that item has no Markdown link whose target is design/semantic-index/PLAN.md, or the
//     target file does not exist;
//   - the item does not state the hybrid scope in one paragraph (§0): it adds to file reading,
//     never discourages, forbids or gates whole-file reads, has no benchmark, no threshold and
//     waits on no measurement, names 0.3.0-beta.2, and says plainly that a name-matched
//     reference is a lead, not proof (the one real risk, stated and not hidden);
//   - the item lacks any of D1–D6, D10 and D12 as its own one-line list entry, repeats an id,
//     lists any other decision as decided, or leaves an entry without a description;
//   - any D entry is not marked decided on 2026-11-22, or does not carry its outcome
//     (a keyword from PLAN §9 for that decision);
//   - the item lacks one entry naming the removed benchmark decisions D7, D8, D9, D11 and D13
//     as removed with the benchmark, or presents any of them as decided;
//   - the item frames the index itself as a quality risk or carries old-store work (D6).
// Reads only BACKLOG.md and PLAN.md; it touches no store.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function red(reason) {
  console.log(`GATE SI0 RED: ${reason}`);
  process.exit(1);
}

// What each decision's entry must carry, from PLAN §9 (matched case-insensitively).
const OUTCOME = {
  1: [/0\.3\.0-beta\.1/, /0\.3\.0-beta\.2/],
  2: [/typescript/, /tsx/, /javascript/, /python/, /rust/, /\bgo\b/, /\bjava\b(?!script)/, /\bc\b(?![+#])/, /c\+\+/, /c#/],
  3: [/sidecar/, /code-index/, /never `?memory\.db`?/],
  4: [/refuse/, /candidates/, /`?note`?/],
  5: [/fill/, /omitted/],
  6: [/no backward compatibility/, /no backfill/, /no census/, /no migration/],
  10: [/>=20/, /keep/],
  12: [/\bon\b/, /AMANUENSIS_CODE_INDEX=off/],
};
const REMOVED = [7, 8, 9, 11, 13];

function check() {
  const path = join(root, "BACKLOG.md");
  if (!existsSync(path)) return "BACKLOG.md is missing";
  let lines;
  try {
    lines = readFileSync(path, "utf8").split("\n");
  } catch (error) {
    return `BACKLOG.md is unreadable (${error.code ?? "error"})`;
  }

  const start = lines.findIndex((line) => /^-\s+\*\*Code index: find and cite code exactly, alongside reading it\.\*\*/.test(line));
  if (start < 0) return "BACKLOG.md has no code-index item";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^-\s/.test(lines[i]) || /^#{1,6}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const item = lines.slice(start, end);
  const text = item.join("\n");

  const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  if (!links.some((target) => target.replace(/^\.\//, "") === "design/semantic-index/PLAN.md")) {
    return "the code-index item does not link design/semantic-index/PLAN.md";
  }
  const planPath = join(root, "design", "semantic-index", "PLAN.md");
  if (!existsSync(planPath)) return "the linked design/semantic-index/PLAN.md does not exist";
  const plan = readFileSync(planPath, "utf8");

  // The hybrid scope: the item's opening paragraph, before its first blank line.
  const firstBreak = item.findIndex((line, i) => i > 0 && !/\S/.test(line));
  const scope = item.slice(0, firstBreak < 0 ? item.length : firstBreak).join(" ").replace(/\s+/g, " ");
  const scopeNeeds = [
    [/hybrid/i, "the word hybrid"],
    [/\badds? to (?:file )?reading\b/i, "that the index adds to file reading"],
    [/never (?:discourages?|forbids?|gates?)[^.]*whole-file reads?/i, "that it never discourages, forbids or gates whole-file reads"],
    [/no benchmark/i, "that there is no benchmark"],
    [/no threshold/i, "that there is no threshold"],
    [/nothing waits on a measurement/i, "that nothing waits on a measurement"],
    [/0\.3\.0-beta\.2/, "the release 0.3.0-beta\\.2"],
    [/name-matched references?[^.]*lead,? not proof/i, "that a name-matched reference is a lead, not proof"],
    [/token report/i, "the descriptive token report"],
  ];
  for (const [re, what] of scopeNeeds) {
    if (!re.test(scope)) return `the code-index scope paragraph does not state ${what}`;
  }
  if (/\b(?:quality|accuracy) (?:risk|regression)\b/i.test(text)) {
    return "the code-index item frames the index itself as a quality risk";
  }
  if (/\b(?:backfill|census|migrat\w+|legacy)\b/i.test(text.replace(/no backfill|no census|no migration/gi, ""))) {
    return "the code-index item carries old-store work, which D6 removes";
  }

  const opensBlock = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}(?:\s|$)|>|```)/;
  const seen = new Map();
  let removedEntry = null;
  for (let i = 0; i < item.length; i += 1) {
    const removed = item[i].match(/^\s+[-*]\s+(?:\*\*)?Removed\b.*$/);
    if (removed) {
      if (removedEntry) return "the removed benchmark decisions are listed twice";
      removedEntry = item[i];
    }
    const m = item[i].match(/^\s+[-*]\s+(?:\*\*)?D(\d+)\b(?:\*\*)?[.:)\s—–-]*(.*)$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (!(n in OUTCOME)) return `D${n} is not a decision to list (PLAN §9 lists D1–D6, D10 and D12 as decided)`;
    if (seen.has(n)) return `D${n} is listed twice`;
    seen.set(n, item[i]);
    if (m[2].replace(/\*\*/g, "").trim().length < 20) return `D${n} has no description`;
    const next = item[i + 1];
    if (next !== undefined && /\S/.test(next) && !opensBlock.test(next)) return `D${n} runs past one line`;
  }
  for (const n of Object.keys(OUTCOME).map(Number)) {
    const entry = seen.get(n);
    if (!entry) return `the code-index item lacks an entry for D${n}`;
    if (!new RegExp(`\\|\\s*D${n}\\s*\\|`).test(plan)) return `PLAN §9 has no row for D${n}`;
    if (!/\bdecided\b/i.test(entry) || !/2026-11-22/.test(entry)) {
      return `D${n} is not marked decided on 2026-11-22`;
    }
    for (const word of OUTCOME[n]) {
      if (!word.test(entry) && !word.test(entry.toLowerCase())) {
        return `D${n} does not carry its outcome (${word.source})`;
      }
    }
  }

  if (!removedEntry) return "the code-index item does not list the removed benchmark decisions";
  for (const n of REMOVED) {
    if (!new RegExp(`\\bD${n}\\b`).test(removedEntry)) return `the removed entry does not name D${n}`;
  }
  if (!/\bremoved\b/i.test(removedEntry) || !/benchmark/i.test(removedEntry)) {
    return "the removed entry does not say the decisions were removed with the benchmark";
  }
  if (/\bdecided\b/i.test(removedEntry)) return "the removed entry presents a removed decision as decided";
  return null;
}

const reason = check();
if (reason) red(reason);
console.log("GATE SI0 GREEN");
