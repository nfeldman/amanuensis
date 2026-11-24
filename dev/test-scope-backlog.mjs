#!/usr/bin/env node
// GATE SC0 (design/scope/PLAN.md §3 SC0).
//
// Turns red when:
//   - BACKLOG.md is absent or unreadable, or has no survey-scope item
//     ("Survey scope: ..."), or has more than one;
//   - that item has no Markdown link whose target is design/scope/PLAN.md, or the target
//     file does not exist;
//   - its opening paragraph does not state the survey set (§0): the tree at a revision minus
//     gitignore, user and meta paths; that an owner include wins over gitignore and meta and,
//     between owner rules, the more specific pattern decides (§2.2, §6.2 finding 9); that
//     everything which used the whole tree as its denominator uses the survey set; that
//     excluded means not included (no ledger row, no evidence, no vocabulary anchor, a count
//     on the overview only); that ledger-exempt classifications inside the set keep today's
//     behaviour; that a legacy store's only change is gitignore matches leaving the set
//     (§2.9); that no tracked `.amanuensisignore` file is built (§5);
//   - the item does not quote the owner's rule as a blockquote that equals the blockquote in
//     PLAN §1, word for word;
//   - the item states a packet count or id range that disagrees with design/scope/plan.json;
//   - the item lacks any of F1–F3 as its own one-line list entry, repeats an id, lists any
//     other F id, leaves an entry without a description, does not mark one decided on
//     2026-11-23, or lacks its outcome: every sentence of that decision in PLAN §1, compared
//     after case, punctuation and contractions are set aside, or states a reversal of it
//     (the rules in a tracked file or not in the store; the pages omitting nothing or the
//     overview carrying no count);
//   - the item leaves any decision open (waiting, undecided, to be decided).
// Reads only BACKLOG.md, PLAN.md and plan.json; it touches no store.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function red(reason) {
  console.log(`GATE SC0 RED: ${reason}`);
  process.exit(1);
}

// What each decision's entry must carry, from PLAN §1 (matched case-insensitively).
const OUTCOME = {
  1: [/\bstore\b/, /\btools?\b/],
  2: [/pages omit/, /overview/, /\bcount/],
  3: [/prefix/, /single path/, /inherit/],
};
// Wording that reverses a decision while keeping its keywords.
const REVERSAL = {
  1: [/tracked file/, /\bnot (?:in )?the store\b/],
  2: [/omit nothing/, /\bno count\b/, /\b(?:list|print|show)s? excluded/],
  3: [],
};

// A statement as compared: lower case, contractions spelled out, punctuation and
// emphasis dropped, whitespace collapsed.
const plain = (text) =>
  squash(
    text
      .toLowerCase()
      .replace(/n't\b/g, " not")
      .replace(/[.,;:()`*"]/g, " "),
  );

// The sentences of decision Fn as PLAN §1 states it.
function planDecision(plan, n) {
  const m = plan.match(new RegExp(`^- \\*\\*F${n}:\\*\\*([\\s\\S]*?)(?=\\n- \\*\\*F|\\n\\s*\\n)`, "m"));
  if (!m) return null;
  return squash(m[1])
    .split(/(?<=\.)\s+/)
    .map(plain)
    .filter((sentence) => sentence.length > 0);
}

const squash = (text) => text.replace(/\s+/g, " ").trim();

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    return null;
  }
}

// The blockquote under one heading: its lines, `>` removed, whitespace collapsed.
function blockquote(lines) {
  return squash(
    lines
      .filter((line) => /^\s*>/.test(line))
      .map((line) => line.replace(/^\s*>\s?/, ""))
      .join(" "),
  );
}

function check() {
  const path = join(root, "BACKLOG.md");
  if (!existsSync(path)) return "BACKLOG.md is missing";
  const backlog = readText(path);
  if (backlog === null) return "BACKLOG.md is unreadable";
  const lines = backlog.split("\n");

  const starts = lines
    .map((line, i) => (/^-\s+\*\*Survey scope:[^*]+\*\*/.test(line) ? i : -1))
    .filter((i) => i >= 0);
  if (starts.length === 0) return "BACKLOG.md has no survey-scope item";
  if (starts.length > 1) return "BACKLOG.md has more than one survey-scope item";
  const start = starts[0];
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
  if (!links.some((target) => target.replace(/^\.\//, "") === "design/scope/PLAN.md")) {
    return "the survey-scope item does not link design/scope/PLAN.md";
  }
  const planPath = join(root, "design", "scope", "PLAN.md");
  if (!existsSync(planPath)) return "the linked design/scope/PLAN.md does not exist";
  const plan = readText(planPath);
  if (plan === null) return "design/scope/PLAN.md is unreadable";

  // The scope paragraph: the item's opening paragraph, before its first blank line.
  const firstBreak = item.findIndex((line, i) => i > 0 && !/\S/.test(line));
  const scope = squash(item.slice(0, firstBreak < 0 ? item.length : firstBreak).join(" "));
  const scopeNeeds = [
    [/\bplanned 2026-11-23\b/i, "that it was planned on 2026-11-23"],
    [/\*\*survey set\*\*/i, "the term survey set in bold"],
    [/tree at a revision/i, "that the survey set is the tree at a revision"],
    [/\bgitignore\b[\s\S]*\buser\b[\s\S]*\bmeta\b/i, "the three excluded kinds in order: gitignore, user and meta"],
    [/include rules? win over gitignore and meta/i, "that the owner's include rules win over gitignore and meta"],
    [/between (?:two )?owner rules,? the more specific/i, "that between owner rules the more specific pattern decides"],
    [/whole tree as (?:its|their) denominator[^.]*survey set/i, "that every consumer of the whole tree as a denominator uses the survey set"],
    [/excluded means not included/i, "that excluded means not included"],
    [/no ledger row/i, "that an excluded path gets no ledger row"],
    [/no evidence/i, "that an excluded path gets no evidence"],
    [/no vocabulary anchor/i, "that an excluded path gets no vocabulary anchor"],
    [/count on the overview/i, "that an excluded path shows only as a count on the overview"],
    [/ledger-exempt classifications?[^.]*keep/i, "that ledger-exempt classifications inside the survey set keep their behaviour"],
    [/`legacy`[^.]*gitignore[^.]*leave/i, "that a legacy store's only change is gitignore matches leaving the survey set"],
    [/`excluded_with_rows`/, "that ledgered excluded paths are reported as excluded_with_rows"],
    [/no tracked `\.amanuensisignore`/i, "that no tracked .amanuensisignore file is built"],
  ];
  for (const [re, what] of scopeNeeds) {
    if (!re.test(scope)) return `the survey-scope opening paragraph does not state ${what}`;
  }

  // The owner's rule, word for word from PLAN §1.
  const rulesAt = plan.indexOf("## 1. The owner's rule");
  const rulesEnd = plan.indexOf("\n## 2.", rulesAt);
  if (rulesAt < 0 || rulesEnd < 0) return "PLAN has no section 1 for the owner's rule";
  const planRule = blockquote(plan.slice(rulesAt, rulesEnd).split("\n"));
  if (planRule.length < 200) return "PLAN section 1 has no owner's rule blockquote";
  const itemRule = blockquote(item);
  if (itemRule !== planRule) return "the survey-scope item does not quote the owner's rule word for word from PLAN section 1";

  // The packet count and range, from plan.json.
  const planJsonText = readText(join(root, "design", "scope", "plan.json"));
  if (planJsonText === null) return "design/scope/plan.json is missing or unreadable";
  let packets;
  let slices;
  try {
    const json = JSON.parse(planJsonText);
    packets = json.packets.map((p) => p.id);
    slices = new Set(json.packets.map((p) => p.slice)).size;
  } catch (error) {
    return "design/scope/plan.json does not parse";
  }
  const numbers = packets.map((id) => Number(id.replace(/^SC/, "")));
  if (numbers.some((n) => !Number.isInteger(n))) return "plan.json has a packet id that is not SC<number>";
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const sliceWord = words[slices] ?? String(slices);
  const body = squash(text);
  if (!new RegExp(`\\b${packets.length} packets\\b`).test(body)) {
    return `the survey-scope item does not say there are ${packets.length} packets`;
  }
  if (!new RegExp(`\\bSC${low} to SC${high}\\b`).test(body)) {
    return `the survey-scope item does not give the packet range SC${low} to SC${high}`;
  }
  if (!new RegExp(`\\b(?:${slices}|${sliceWord}) slices\\b`, "i").test(body)) {
    return `the survey-scope item does not say there are ${slices} slices`;
  }

  // F1-F3: each its own one-line entry.
  const opensBlock = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}(?:\s|$)|>|```)/;
  const seen = new Map();
  for (let i = 0; i < item.length; i += 1) {
    const m = item[i].match(/^\s+[-*]\s+(?:\*\*)?F(\d+)\b(?:\*\*)?[.:)\s—–-]*(.*)$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (!(n in OUTCOME)) return `F${n} is not a decision to list (PLAN section 1 has F1 to F3)`;
    if (seen.has(n)) return `F${n} is listed twice`;
    seen.set(n, item[i]);
    if (m[2].replace(/\*\*/g, "").trim().length < 20) return `F${n} has no description`;
    const next = item[i + 1];
    if (next !== undefined && /\S/.test(next) && !opensBlock.test(next)) return `F${n} runs past one line`;
  }
  for (const n of Object.keys(OUTCOME).map(Number)) {
    const entry = seen.get(n);
    if (!entry) return `the survey-scope item lacks an entry for F${n}`;
    if (!new RegExp(`\\*\\*F${n}:\\*\\*`).test(plan)) return `PLAN section 1 has no F${n}`;
    if (!/\bdecided\b/i.test(entry) || !/2026-11-23/.test(entry)) {
      return `F${n} is not marked decided on 2026-11-23`;
    }
    const lower = entry.toLowerCase();
    for (const word of OUTCOME[n]) {
      if (!word.test(lower)) return `F${n} does not carry its outcome (${word.source})`;
    }
    const sentences = planDecision(plan, n);
    if (!sentences?.length) return `PLAN section 1 states no decision for F${n}`;
    const said = plain(entry);
    for (const sentence of sentences) {
      if (!said.includes(sentence)) return `F${n} does not state PLAN's decision "${sentence}"`;
    }
    for (const word of REVERSAL[n]) {
      if (word.test(lower)) return `F${n} reverses its decision (${word.source})`;
    }
  }

  if (/\b(?:undecided|to be decided|decision pending|waiting on the owner|open question)\b/i.test(text)) {
    return "the survey-scope item leaves a decision open, and the owner approved F1 to F3";
  }
  return null;
}

const reason = check();
if (reason) red(reason);
console.log("GATE SC0 GREEN");
