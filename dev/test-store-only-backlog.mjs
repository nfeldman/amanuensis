#!/usr/bin/env node
// GATE SO0 (design/store-only/PLAN.md §8 SO0).
//
// Turns red when:
//   - BACKLOG.md is absent or unreadable, or has no store-only item
//     ("The database holds everything; HTML is the only published projection.");
//   - that item has no Markdown link whose target is design/store-only/PLAN.md, or the target
//     file does not exist;
//   - the item still says the read-back compares the two views, or lacks the §0 correction
//     (the read-back censuses both views against store rows);
//   - the item lacks any of D1–D16 as its own list item, repeats an id, runs an entry past one
//     line, or leaves an entry without a description;
//   - any D entry is not marked decided on 2026-11-20, or does not carry its outcome
//     (a keyword from PLAN §9 for that decision);
//   - the D16 entry does not say it was amended (legacy data needs no protecting).
// Reads only BACKLOG.md and PLAN.md; it touches no store.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function red(reason) {
  console.log(`GATE SO0 RED: ${reason}`);
  process.exit(1);
}

// What each decision's entry must carry, from PLAN §9 (all matched case-insensitively).
const OUTCOME = {
  1: [/render/, /hold/],
  2: [/imported/, /purpose/],
  // The outcome, not a keyword: "typed tables per mark kind (not claim_marks)" names
  // claim_marks too (F13/claude, final review).
  3: [/generic `?claim_marks`?/, /per-kind contract rules/, /relations deferred/],
  4: [/never refuse/],
  5: [/contract/],
  6: [/import/, /lane/],
  7: [/register_artifact/, /SO6/],
  8: [/subagent_log/],
  9: [/out of scope/],
  10: [/README\.md/, /index\.html/],
  11: [/untouched/],
  12: [/0\.3\.0/],
  13: [/grammar/],
  14: [/illustration/, /overview/],
  15: [/after the lane lands/],
  // D16's backup is a consistent snapshot (`VACUUM INTO`, PLAN §8 and §9), not a
  // copy of the database beside its WAL, taken just before `dist` is rebuilt,
  // while the lanes run on: "amended" and "backup" alone held for `cp memory.db`
  // (F9/codex, slice-S1).
  16: [/amended/, /backup/, /VACUUM INTO/, /before `?dist`? is rebuilt/, /not paused/],
};

function check() {
  const path = join(root, "BACKLOG.md");
  if (!existsSync(path)) return "BACKLOG.md is missing";
  let lines;
  try {
    lines = readFileSync(path, "utf8").split("\n");
  } catch (error) {
    return `BACKLOG.md is unreadable (${error.code ?? "error"})`;
  }

  const start = lines.findIndex((line) => /^-\s+\*\*The database holds everything; HTML is the only published projection\.\*\*/.test(line));
  if (start < 0) return "BACKLOG.md has no store-only item";
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
  if (!links.some((target) => target.replace(/^\.\//, "") === "design/store-only/PLAN.md")) {
    return "the store-only item does not link design/store-only/PLAN.md";
  }
  if (!existsSync(join(root, "design", "store-only", "PLAN.md"))) {
    return "the linked design/store-only/PLAN.md does not exist";
  }

  const flat = text.replace(/\s+/g, " ");
  if (/compares the two/i.test(flat)) return "the store-only item still says the read-back compares the two views";
  if (!/read-back[^.]*censuses both views[^.]*store rows/i.test(flat)) {
    return "the store-only item lacks the §0 correction (the read-back censuses both views against store rows)";
  }

  const seen = new Map();
  const opensBlock = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}(?:\s|$)|>|```)/;
  for (let i = 0; i < item.length; i += 1) {
    const m = item[i].match(/^\s+[-*]\s+(?:\*\*)?D(\d+)\b(?:\*\*)?[.:)\s—–-]*(.*)$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < 1 || n > 16) return `D${n} is not a decision in PLAN §9`;
    if (seen.has(n)) return `D${n} is listed twice`;
    seen.set(n, item[i]);
    if (m[2].replace(/\*\*/g, "").trim().length < 20) return `D${n} has no description`;
    const next = item[i + 1];
    if (next !== undefined && /\S/.test(next) && !opensBlock.test(next)) {
      return `D${n} runs past one line`;
    }
    let j = i + 1;
    while (j < item.length && !/\S/.test(item[j])) j += 1;
    if (j > i + 1 && j < item.length && /^\s{4,}\S/.test(item[j]) && !opensBlock.test(item[j])) {
      return `D${n} continues past a blank line`;
    }
  }
  for (let n = 1; n <= 16; n += 1) {
    const entry = seen.get(n);
    if (!entry) return `the store-only item lacks an entry for D${n}`;
    if (!/\bdecided\b/i.test(entry) || !/2026-11-20/.test(entry)) {
      return `D${n} is not marked decided on 2026-11-20`;
    }
    for (const word of OUTCOME[n]) {
      if (!word.test(entry.toLowerCase().replace(/\*\*/g, "")) && !word.test(entry)) {
        return `D${n} does not carry its outcome (${word.source})`;
      }
    }
  }
  return null;
}

const reason = check();
if (reason) red(reason);
console.log("GATE SO0 GREEN");
