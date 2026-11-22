#!/usr/bin/env node
// Measures what a reader sees on the generated pages
// (design/explanation/spec.md §1).
//
//   node dev/measure-reader-prose.mjs <docs-dir> [--basis html|markdown]
//   node dev/measure-reader-prose.mjs --record <label> [<docs-dir>] [--basis html|markdown]
//
// A publication is HTML only (store-only PLAN §3.2 step 3), so the measure reads
// the `.html` pages. A directory holding no `.html` page is a publication from
// before that change and is measured over its `.md` pages, as it always was; the
// basis is chosen from the directory unless `--basis` names it. Entries recorded
// over HTML carry `"basis": "html"`; an entry without one was measured over
// Markdown, and is checked with `--basis markdown`. The two bases are not
// comparable figure for figure: the definitions below differ in what a line is.
//
// Prints JSON: per page and in totals, the characters on table lines, the
// characters of prose, the table share, and the placeholder count. It is a
// measurement; nothing compares it with a threshold.
//
// Definitions, fixed so that every recorded label counts the same thing:
//   - A table line starts, after any indentation, with `|`. Its characters are
//     the line's, less its unescaped `|` delimiters, so padding is counted.
//     A separator row (every cell is dashes with optional colons) counts nothing.
//   - Prose is every other non-blank line that is not a heading and not inside
//     a fenced block. Its characters are the line's.
//   - Lines inside a fenced block are neither table nor prose.
//   - A placeholder is one occurrence of a MEASURE_PLACEHOLDERS string anywhere
//     in the page, fenced or not.
//
// The same two figures over HTML, from each page's `<article class="content …">`
// (the rail, the page header and footers are not the page):
//   - Table characters are the characters of each table cell's text, whitespace
//     collapsed and trimmed, over every `<table>` row in the header or the body.
//     A caption counts nothing.
//   - Prose is the characters of every other line of text, where a line is what
//     lies between block boundaries (paragraphs, list items, definitions, figure
//     captions, `<br>`, details and the like). Headings, `<pre>` blocks, `<svg>`
//     drawings, scripts and styles count nothing. Inline marks (`<code>`,
//     `<em>`, `<strong>`, links) add their text and no marker characters.
//   - A placeholder is one occurrence of a MEASURE_PLACEHOLDERS string in the
//     page's text with its Markdown emphasis marks removed, anywhere in the
//     article, `<pre>` included.
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
import { articleOf, decodeEntities } from "./read-html-page.mjs";

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

function pageFiles(root, suffix, relDir = "") {
  const found = [];
  for (const entry of readdirSync(join(root, relDir), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...pageFiles(root, suffix, rel));
    else if (entry.isFile() && entry.name.endsWith(suffix)) found.push(rel);
  }
  return found;
}

const UNESCAPED_DELIMITER = /(?<!\\)\|/g;

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
      table += raw.length - (raw.match(UNESCAPED_DELIMITER) ?? []).length;
    } else {
      prose += raw.length;
    }
  }
  const placeholders = MEASURE_PLACEHOLDERS.reduce(
    (sum, needle) => sum + text.split(needle).length - 1,
    0,
  );
  return { table_chars: table, prose_chars: prose, table_share: share(table, prose), placeholders };
}

const HTML_BLOCK = /<\/?(?:p|li|ul|ol|dl|dt|dd|div|section|article|header|footer|blockquote|details|summary|figure|figcaption|tr|br|hr)\b[^>]*>/gi;

/** The characters of a fragment's text, whitespace collapsed: tags gone, entities decoded. */
function collapsedText(fragment) {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

export function measureHtmlPage(html) {
  const article = articleOf(html) ?? html;
  const withoutNoise = article
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  let table = 0;
  const outsideTables = withoutNoise.replace(/<table\b[\s\S]*?<\/table>/gi, (whole) => {
    for (const cell of whole.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)) {
      table += collapsedText(cell[1]).length;
    }
    return "\n";
  });
  const placeholderText = decodeEntities(withoutNoise.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const prose = outsideTables
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, "\n")
    .replace(/<h[1-6]\b[\s\S]*?<\/h[1-6]>/gi, "\n")
    .replace(HTML_BLOCK, "\n")
    .split("\n")
    .map(collapsedText)
    .reduce((sum, line) => sum + line.length, 0);
  const placeholders = MEASURE_PLACEHOLDERS.reduce((sum, needle) => {
    const plain = needle.replaceAll("**", "");
    return sum + placeholderText.split(plain).length - 1;
  }, 0);
  return { table_chars: table, prose_chars: prose, table_share: share(table, prose), placeholders };
}

/** `html` when the directory holds a page of that suffix, else the Markdown of a publication before HTML was the only view. */
function basisOf(root, requested) {
  if (requested === "html" || requested === "markdown") return requested;
  if (requested !== undefined) throw new Error(`--basis is html or markdown, not ${requested}`);
  return pageFiles(root, ".html").length ? "html" : "markdown";
}

export function measureDirectory(root, requestedBasis) {
  const basis = basisOf(root, requestedBasis);
  const pages = pageFiles(root, basis === "html" ? ".html" : ".md")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((page) => {
      const text = readFileSync(join(root, page), "utf8");
      return { page, ...(basis === "html" ? measureHtmlPage(text) : measurePage(text)) };
    });
  const sum = (key) => pages.reduce((total, page) => total + page[key], 0);
  const table = sum("table_chars");
  const prose = sum("prose_chars");
  return {
    basis,
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
    ...(report.basis === "html" ? { basis: "html" } : {}),
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
    if (arg === "--record" || arg === "--file" || arg === "--contract" || arg === "--basis") {
      options[arg.slice(2)] = argv[(i += 1)];
      if (options[arg.slice(2)] === undefined) throw new Error(`${arg} needs a value`);
    } else {
      positional.push(arg);
    }
  }
  const docs = positional[0] ?? (options.record !== undefined ? join(REPO, "docs") : undefined);
  if (!docs) throw new Error("usage: measure-reader-prose.mjs <docs-dir> | --record <label> [<docs-dir>]");
  const report = measureDirectory(docs, options.basis);
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
