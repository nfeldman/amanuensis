#!/usr/bin/env node
// GATE O0 (design/orientation/PLAN.md §4 O0).
//
// Turns red when:
//   - BACKLOG.md is absent or unreadable;
//   - BACKLOG.md has no "Reader orientation" section inside "Publishing and rendering"
//     (a heading line, before the next "## " heading);
//   - that section has no Markdown link whose target is design/orientation/PLAN.md, or the
//     target file does not exist;
//   - the section lacks any of W1–W9 as its own list item, or an item runs past one line
//     (an indented continuation, an unindented lazy one, or an indented paragraph after a
//     blank line),
//     or an item repeats another's id, or an item has no text after its id;
//   - the W6 item does not say it is decided and cite D4.
// Reads only BACKLOG.md and PLAN.md; it touches no store.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function red(reason) {
  console.log(`GATE O0 RED: ${reason}`);
  process.exit(1);
}

function check() {
  const path = join(root, "BACKLOG.md");
  if (!existsSync(path)) return "BACKLOG.md is missing";
  let lines;
  try {
    lines = readFileSync(path, "utf8").split("\n");
  } catch (error) {
    return `BACKLOG.md is unreadable (${error.code ?? "error"})`;
  }

  const parent = lines.findIndex((line) => /^##\s+Publishing and rendering\s*$/.test(line));
  if (parent < 0) return 'BACKLOG.md has no "Publishing and rendering" section';
  let parentEnd = lines.length;
  for (let i = parent + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      parentEnd = i;
      break;
    }
  }

  const heading = lines.findIndex(
    (line, i) => i > parent && i < parentEnd && /^#{3,6}\s+Reader orientation\s*$/.test(line),
  );
  if (heading < 0) return 'no "Reader orientation" heading under "Publishing and rendering"';
  const level = lines[heading].match(/^#+/)[0].length;
  let end = parentEnd;
  for (let i = heading + 1; i < parentEnd; i += 1) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  const section = lines.slice(heading + 1, end);
  const text = section.join("\n");

  const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  const planLink = links.find((target) => target.replace(/^\.\//, "") === "design/orientation/PLAN.md");
  if (!planLink) return "the section does not link design/orientation/PLAN.md";
  if (!existsSync(join(root, "design", "orientation", "PLAN.md"))) {
    return "the linked design/orientation/PLAN.md does not exist";
  }

  const seen = new Map();
  for (const line of section) {
    const m = line.match(/^[-*]\s+(?:\*\*)?(W[1-9])\b(?:\*\*)?[.:)\s—–-]*(.*)$/);
    if (!m) continue;
    if (seen.has(m[1])) return `${m[1]} is listed twice`;
    seen.set(m[1], line);
    if (m[2].replace(/\*\*/g, "").trim().length < 10) return `${m[1]} has no description`;
  }
  for (let n = 1; n <= 9; n += 1) {
    if (!seen.has(`W${n}`)) return `the section lacks an item for W${n}`;
  }
  // One line each: a list item's continuation line is a second line. That is an indented
  // non-item line, or an unindented one Markdown folds into the item as a lazy continuation:
  // any non-blank line that does not open a new block (list item, heading, quote, fence, rule).
  const opensBlock = /^\s{0,3}(?:[-*+]\s|\d+[.)]\s|#{1,6}(?:\s|$)|>|```|~~~|(?:[-*_]\s*){3,}$)/;
  for (let i = 0; i < section.length; i += 1) {
    if (!seen.has((section[i].match(/(W[1-9])\b/) ?? [])[1]) || !/^[-*]\s/.test(section[i])) continue;
    const next = section[i + 1];
    if (next !== undefined && /\S/.test(next) && (/^\s+\S/.test(next) ? !/^\s*[-*]\s/.test(next) : !opensBlock.test(next))) {
      return `an item is longer than one line: ${section[i].slice(0, 40)}`;
    }
    // Past blank lines, an indented line still belongs to the item: a continuation paragraph
    // or a nested block. Only an unindented line ends it.
    let j = i + 1;
    while (j < section.length && !/\S/.test(section[j])) j += 1;
    if (j > i + 1 && j < section.length && /^\s+\S/.test(section[j])) {
      return `an item continues past a blank line: ${section[i].slice(0, 40)}`;
    }
  }

  const w6 = seen.get("W6");
  if (!/\bdecided\b/i.test(w6) || !/\bD4\b/.test(w6)) return "the W6 item does not say it is decided (D4)";
  for (let n = 1; n <= 9; n += 1) {
    if (n !== 6 && /\bdecided\b/i.test(seen.get(`W${n}`))) {
      return `W${n} is marked decided; only W6 is (D4)`;
    }
  }
  return null;
}

const reason = check();
if (reason) red(reason);
console.log("GATE O0 GREEN");
