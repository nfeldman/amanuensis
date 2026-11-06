#!/usr/bin/env node
// Measures what a reader sees on the generated Markdown pages
// (design/explanation/spec.md §1).
//
//   node dev/measure-reader-prose.mjs <docs-dir>
//   node dev/measure-reader-prose.mjs --record <label> [<docs-dir>]
//
// Prints JSON: per page and in totals, the characters on table lines, the
// characters of prose, the table share, and the placeholder count. It is a
// measurement; nothing compares it with a threshold.
//
// Definitions, fixed so that every recorded label counts the same thing:
//   - A table line starts, after any indentation, with `|`. Its characters are
//     the lengths of its trimmed cells, so delimiters and padding are not text.
//     A separator row (every cell is dashes with optional colons) counts nothing.
//   - Prose is every other non-blank line that is not a heading and not inside
//     a fenced block. Its characters are the length of the trimmed line.
//   - Lines inside a fenced block are neither table nor prose.
//   - A placeholder is one occurrence of a MEASURE_PLACEHOLDERS string anywhere
//     in the page, fenced or not.
//
// `--record` appends {label, commit, contract_sha256, placeholder_list_sha256,
// totals} to the `entries` array of design/explanation/reader-measure.json. A
// label that already exists is replaced and moved to the end. `--file` and
// `--contract` override the record and the contract file, for the gate.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Set once, in EX1, and never changed by a later packet: every recorded label
// carries this list's hash, and EX6's gate asserts each string against the
// renderer. Do not add, reword or reorder.
export const MEASURE_PLACEHOLDERS = [
  "No thesis section is recorded",
  "The recorded thesis carries status vocabulary and was not published",
  "The recorded thesis presents a composite index of the record and was not published",
  "No purpose statement is recorded for this subsystem",
  "No structured runtime boundary map is recorded yet",
  "**Domain vocabulary** — not recorded",
];

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..");
const DEFAULT_RECORD = join(REPO, "design/explanation/reader-measure.json");
const DEFAULT_CONTRACT = join(REPO, "docs/.projection-contract.json");

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const round4 = (n) => Math.round(n * 10000) / 10000;
const share = (table, prose) => (table + prose === 0 ? 0 : round4(table / (table + prose)));

function markdownFiles(root, relDir = "") {
  const found = [];
  for (const entry of readdirSync(join(root, relDir), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...markdownFiles(root, rel));
    else if (entry.isFile() && entry.name.endsWith(".md")) found.push(rel);
  }
  return found;
}

function tableCells(line) {
  const body = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

export function measurePage(text) {
  let table = 0;
  let prose = 0;
  let fence = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const opener = /^(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (opener && opener[1][0] === fence.char && opener[1].length >= fence.length && line === opener[1]) {
        fence = null;
      }
      continue;
    }
    if (opener) {
      fence = { char: opener[1][0], length: opener[1].length };
      continue;
    }
    if (line === "" || /^#{1,6}(\s|$)/.test(line)) continue;
    if (line.startsWith("|")) {
      const cells = tableCells(line);
      if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
      table += cells.reduce((sum, cell) => sum + cell.length, 0);
    } else {
      prose += line.length;
    }
  }
  const placeholders = MEASURE_PLACEHOLDERS.reduce(
    (sum, needle) => sum + text.split(needle).length - 1,
    0,
  );
  return { table_chars: table, prose_chars: prose, table_share: share(table, prose), placeholders };
}

export function measureDirectory(root) {
  const pages = markdownFiles(root)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((page) => ({ page, ...measurePage(readFileSync(join(root, page), "utf8")) }));
  const sum = (key) => pages.reduce((total, page) => total + page[key], 0);
  const table = sum("table_chars");
  const prose = sum("prose_chars");
  return {
    pages,
    totals: {
      pages: pages.length,
      table_chars: table,
      prose_chars: prose,
      table_share: share(table, prose),
      placeholders: sum("placeholders"),
    },
  };
}

function record(label, report, recordFile, contractFile) {
  let entries = [];
  try {
    entries = JSON.parse(readFileSync(recordFile, "utf8")).entries ?? [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" });
  if (head.status !== 0) throw new Error("cannot read the repository HEAD");
  const entry = {
    label,
    commit: head.stdout.trim(),
    contract_sha256: sha256(readFileSync(contractFile)),
    placeholder_list_sha256: sha256(MEASURE_PLACEHOLDERS.join("\n")),
    totals: report.totals,
  };
  entries = [...entries.filter((existing) => existing.label !== label), entry];
  mkdirSync(dirname(recordFile), { recursive: true });
  writeFileSync(recordFile, `${JSON.stringify({ entries }, null, 2)}\n`);
  return entry;
}

function main(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--record" || arg === "--file" || arg === "--contract") {
      options[arg.slice(2)] = argv[(i += 1)];
      if (options[arg.slice(2)] === undefined) throw new Error(`${arg} needs a value`);
    } else {
      positional.push(arg);
    }
  }
  const docs = positional[0] ?? (options.record !== undefined ? join(REPO, "docs") : undefined);
  if (!docs) throw new Error("usage: measure-reader-prose.mjs <docs-dir> | --record <label> [<docs-dir>]");
  const report = measureDirectory(docs);
  if (options.record !== undefined) {
    const entry = record(
      options.record,
      report,
      options.file ?? DEFAULT_RECORD,
      options.contract ?? DEFAULT_CONTRACT,
    );
    console.log(JSON.stringify(entry, null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`measure-reader-prose: ${error.message}`);
    process.exit(1);
  }
}
