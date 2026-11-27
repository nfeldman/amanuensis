#!/usr/bin/env node
// GATE SI11 (design/semantic-index/PLAN.md §4.8, §8 SI11): the install documents, the CI
// registration and the installed-artifact job agree with the code.
//
// Turns red when:
//   - INSTALLATION.md has no "Code index" section, or mcp-server/README.md has no code-index
//     paragraph that names the ten languages, the four tools, `AMANUENSIS_CODE_INDEX=off` and
//     links the section;
//   - the section's language table differs, row for row, from grammars/manifest.json and the
//     extension table in src/code-index/extract.ts: a language missing, added or renamed, an
//     extension missing or extra, a grammar package or version that is not the manifest's, a
//     grammar size that is not the manifest's grammar.wasm size in MB;
//   - the documented weight (the grammars' total unpacked size, and the package test's packed and
//     installed ceilings) differs from the manifest's sum and from test-package-artifact.mjs;
//   - the documented location is not `<storage>/code-index/<extractor_id>/index.db`, or the
//     switches (`AMANUENSIS_CODE_INDEX` with the values the code reads as off, its default of
//     on, `AMANUENSIS_CODE_INDEX_MAX_FILES`) or the default budgets (file size, files, source
//     bytes, seconds, generation size, days before collection) differ from store.ts, or the
//     four tool names differ from CODE_INDEX_TOOLS;
//   - the section does not point at THIRD_PARTY_NOTICES.md, or package.json `files` lacks
//     grammars/, queries/ or THIRD_PARTY_NOTICES.md, or web-tree-sitter is not the exact version
//     the section names, or the Node floor differs from package.json `engines`;
//   - the section does not say the index adds to reading whole files and that a name-matched
//     reference is a lead, or it mentions a benchmark, a threshold or a quality risk, or a
//     sentence of it or of the README paragraph restricts reading (SI9's detector,
//     dev/reading-guidance.mjs);
//   - a gate in design/semantic-index/plan.json is not a step of .github/workflows/test.yml with
//     the working directory its command names, or runs after nothing that builds or vendors what
//     its command builds or vendors, or is conditional or allowed to fail;
//   - no job runs scripts/check-installed-package.mjs on each of Node 20 and 22 on each of Linux
//     and macOS (matrix not exactly those four, runs-on not the matrix, setup-node not the matrix
//     version, an exclude or include, allowed to fail, or no `npm ci` before it);
//   - that script does not pack, install the tarball into an empty directory, and call
//     outline_file and read_symbol over the stdio server for every language: its FIXTURES is not
//     each manifest language once with a file of that language, its loop does not run
//     checkFixture over all of FIXTURES, or checkFixture, run on canned responses, accepts a
//     refused, mislabelled, not-ok or probe-less outline or a read_symbol without source or
//     evidence_args for the file; or
//     fixtures/installed-artifact/ lacks exactly one file per manifest language, a file's
//     extension maps to another language, or a file does not define `installedProbe`.
//   - an absent grammars/manifest.json is not reported as absent, or the gate runs anything (the
//     vendoring script fetches from the registry) to make one.
// Reads files, and imports the installed-artifact script for its FIXTURES and checkFixture; it runs
// nothing. When the generated grammars/manifest.json is absent (a fresh checkout) it turns red and
// names `node scripts/vendor-grammars.mjs`, the step CI and prepack take.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { restricts, sentences } from "./reading-guidance.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "mcp-server");

class Red extends Error {}
function fail(reason) {
  throw new Red(reason);
}
function check(condition, reason) {
  if (!condition) fail(reason);
}
function read(path, what) {
  const full = join(root, path);
  if (!existsSync(full)) fail(`${what ?? path} is missing`);
  try {
    return readFileSync(full, "utf8");
  } catch {
    return fail(`${what ?? path} is unreadable`);
  }
}
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const sorted = (xs) => [...xs].sort().join(" ");

const NAMES = {
  typescript: "TypeScript",
  tsx: "TSX",
  javascript: "JavaScript",
  python: "Python",
  rust: "Rust",
  go: "Go",
  java: "Java",
  c: "C",
  cpp: "C++",
  csharp: "C#",
};

// ---------------------------------------------------------------------------------------
// The facts, read from the code

/** `{ language: [".ext", ...] }` from the extension table in extract.ts. */
function extensionsOfCode() {
  const text = read("mcp-server/src/code-index/extract.ts");
  const block = text.match(/const EXTENSIONS[^{]*\{([\s\S]*?)\n\};/);
  check(block, "the extension table in src/code-index/extract.ts cannot be read");
  const out = {};
  for (const [, ext, lang] of block[1].matchAll(/"(\.[^"]+)":\s*"([a-z]+)"/g)) {
    (out[lang] ??= []).push(ext);
  }
  return out;
}

function arithmetic(expression, what) {
  check(/^[\d_ *]+$/.test(expression), `${what} is not plain arithmetic: ${expression}`);
  return Function(`"use strict"; return (${expression.replaceAll("_", "")});`)();
}

/** The default budgets, the collection age, the off values and the tool names, from store.ts. */
function storeFacts() {
  const text = read("mcp-server/src/code-index/store.ts");
  const budgets = text.match(/DEFAULT_BUDGETS: Budgets = \{([\s\S]*?)\n\};/);
  check(budgets, "DEFAULT_BUDGETS in src/code-index/store.ts cannot be read");
  const budget = {};
  for (const [, key, expr] of budgets[1].matchAll(/(\w+):\s*([\d_ *]+),/g)) {
    budget[key] = arithmetic(expr.trim(), `budget ${key}`);
  }
  for (const key of ["maxFileBytes", "maxFiles", "maxSourceBytes", "maxMillis", "maxGenerationBytes"]) {
    check(Number.isFinite(budget[key]), `budget ${key} is missing from DEFAULT_BUDGETS`);
  }
  const collect = text.match(/COLLECT_AFTER_MS = (\d+) \* 24 \* HOUR_MS/);
  check(collect, "COLLECT_AFTER_MS in src/code-index/store.ts cannot be read");
  const enabled = text.match(/function codeIndexEnabled[\s\S]*?\n\}/);
  check(enabled, "codeIndexEnabled in src/code-index/store.ts cannot be read");
  check(
    /return !\(raw === /.test(enabled[0]),
    "codeIndexEnabled no longer returns true unless the value is an off word",
  );
  const offWords = [...enabled[0].matchAll(/raw === "([^"]+)"/g)].map((m) => m[1]);
  check(offWords.includes("off"), "codeIndexEnabled does not read `off` as off");
  const tools = text.match(/CODE_INDEX_TOOLS: readonly string\[\] = \[([\s\S]*?)\]/);
  check(tools, "CODE_INDEX_TOOLS in src/code-index/store.ts cannot be read");
  const toolNames = [...tools[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  check(text.includes('CODE_INDEX_DIRECTORY = "code-index"'), "the sidecar directory is not code-index");
  check(text.includes('CODE_INDEX_DATABASE = "index.db"'), "the sidecar database is not index.db");
  check(
    text.includes("AMANUENSIS_CODE_INDEX_MAX_FILES"),
    "the code no longer reads AMANUENSIS_CODE_INDEX_MAX_FILES",
  );
  return { budget, collectDays: Number(collect[1]), offWords, toolNames };
}

function ceilings() {
  const text = read("mcp-server/test-package-artifact.mjs");
  const packed = text.match(/PACKED_CEILING_BYTES = ([\d_]+)/);
  const unpacked = text.match(/UNPACKED_CEILING_BYTES = ([\d_]+)/);
  check(packed && unpacked, "the size ceilings in test-package-artifact.mjs cannot be read");
  return {
    packed: Number(packed[1].replaceAll("_", "")),
    unpacked: Number(unpacked[1].replaceAll("_", "")),
  };
}

function manifest(path = join(server, "grammars", "manifest.json")) {
  check(
    existsSync(path),
    "grammars/manifest.json is absent; run `node scripts/vendor-grammars.mjs` in mcp-server, as CI and prepack do (the gate does not, since it fetches from the registry)",
  );
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  check(parsed?.grammars && Object.keys(parsed.grammars).length > 0, "grammars/manifest.json lists no grammar");
  return parsed.grammars;
}

/** An absent manifest is reported as absent, with nothing run to make one: vendoring fetches from the registry. */
function checkAbsentManifest() {
  const path = process.env.PATH;
  // No PATH while the probe runs, so a gate that did reach for npm fails here instead of fetching.
  process.env.PATH = "";
  let reason = null;
  try {
    manifest(join(server, "grammars", "absent-for-the-gate", "manifest.json"));
  } catch (error) {
    if (!(error instanceof Red)) throw error;
    reason = error.message;
  } finally {
    process.env.PATH = path;
  }
  check(
    reason !== null && /\babsent\b/.test(reason) && !/vendor\w* did not/.test(reason),
    `an absent grammars/manifest.json is not reported as absent without running anything (${reason ?? "accepted"})`,
  );
}

// ---------------------------------------------------------------------------------------
// The documents

function section(text, heading, what) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `## ${heading}`);
  check(start >= 0, `${what} has no "${heading}" section`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

function documentedRows(body) {
  const rows = {};
  for (const line of body.split("\n")) {
    if (!/^\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 4 || /^-+$/.test(cells[0]) || cells[0] === "Language") continue;
    if (Object.hasOwn(rows, cells[0])) fail(`the language table lists ${cells[0]} twice`);
    rows[cells[0]] = {
      extensions: [...cells[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]),
      grammar: cells[2].match(/`([^`]+)`/)?.[1] ?? "",
      size: cells[3],
    };
  }
  return rows;
}

function bytesText(n) {
  if (n % 1024 ** 3 === 0) return `${n / 1024 ** 3} GiB`;
  if (n % 1024 ** 2 === 0) return `${n / 1024 ** 2} MiB`;
  return fail(`budget ${n} is not a whole number of MiB`);
}

function checkSection(section, grammars, facts) {
  const rows = documentedRows(section);
  // Prose is checked on one line, so a sentence wrapped in the document still reads as one.
  const body = section.replace(/\s+/g, " ");
  const want = Object.keys(grammars).map((l) => NAMES[l] ?? fail(`manifest language ${l} has no documented name`));
  check(
    sameSet(Object.keys(rows), want),
    `the language table lists [${Object.keys(rows).sort().join(", ")}]; the manifest has [${[...want].sort().join(", ")}]`,
  );
  const extensions = extensionsOfCode();
  for (const [lang, entry] of Object.entries(grammars)) {
    const row = rows[NAMES[lang]];
    check(
      sameSet(row.extensions, extensions[lang] ?? []),
      `${NAMES[lang]} extensions are [${sorted(row.extensions)}]; the code maps [${sorted(extensions[lang] ?? [])}]`,
    );
    check(
      row.grammar === `${entry.package}@${entry.version}`,
      `${NAMES[lang]} grammar is ${row.grammar}; the manifest pins ${entry.package}@${entry.version}`,
    );
    const mb = (entry.files["grammar.wasm"].size / 1e6).toFixed(2);
    check(row.size === `${mb} MB`, `${NAMES[lang]} size is "${row.size}"; the manifest's grammar.wasm is ${mb} MB`);
  }
  for (const lang of Object.keys(extensions)) {
    check(lang in grammars, `the code maps extensions to ${lang}, which the manifest does not vendor`);
  }

  const total = Object.values(grammars).reduce(
    (sum, g) => sum + Object.values(g.files).reduce((s, f) => s + f.size, 0),
    0,
  );
  const stated = body.match(/grammars take (\d+\.\d) MB unpacked/);
  check(stated, 'the section does not state "grammars take N.N MB unpacked"');
  check(
    stated[1] === (total / 1e6).toFixed(1),
    `the section says the grammars take ${stated[1]} MB; the manifest sums to ${(total / 1e6).toFixed(1)} MB`,
  );
  const limits = ceilings();
  const stateLimits = body.match(/above (\d+(?:\.\d)?) MB packed or (\d+(?:\.\d)?) MB installed/);
  check(stateLimits, 'the section does not state "above N MB packed or N MB installed"');
  check(
    Number(stateLimits[1]) === limits.packed / 1e6 && Number(stateLimits[2]) === limits.unpacked / 1e6,
    `the section's ceilings are ${stateLimits[1]} MB and ${stateLimits[2]} MB; test-package-artifact.mjs holds ${limits.packed / 1e6} MB and ${limits.unpacked / 1e6} MB`,
  );

  check(
    body.includes("`<storage>/code-index/<extractor_id>/index.db`"),
    "the section does not give the location `<storage>/code-index/<extractor_id>/index.db`",
  );
  check(/never `?memory\.db`?|not in `memory\.db`|outside `memory\.db`/.test(body), "the section does not say the index is outside memory.db");
  check(/on by default/i.test(body), "the section does not say the index is on by default");
  check(body.includes("`AMANUENSIS_CODE_INDEX=off`"), "the section does not name `AMANUENSIS_CODE_INDEX=off`");
  for (const word of facts.offWords) {
    check(body.includes(`\`${word}\``), `the section does not list \`${word}\` among the values that turn the index off`);
  }
  check(body.includes("`AMANUENSIS_CODE_INDEX_MAX_FILES`"), "the section does not name `AMANUENSIS_CODE_INDEX_MAX_FILES`");
  const b = facts.budget;
  for (const text of [
    bytesText(b.maxFileBytes),
    b.maxFiles.toLocaleString("en-US"),
    bytesText(b.maxSourceBytes),
    `${b.maxMillis / 1000} seconds`,
    bytesText(b.maxGenerationBytes),
    `${facts.collectDays} days`,
  ]) {
    check(body.includes(text), `the section does not state the default budget "${text}"`);
  }
  for (const tool of facts.toolNames) {
    check(body.includes(`\`${tool}\``), `the section does not name the tool \`${tool}\``);
  }
  check(body.includes("THIRD_PARTY_NOTICES.md"), "the section does not point at THIRD_PARTY_NOTICES.md");
  check(/\bMIT\b/.test(body), "the section does not state the grammars' license");
  check(body.includes("0.3.0-beta.1"), "the section does not say which release brought the index");

  const pkg = JSON.parse(read("mcp-server/package.json"));
  for (const entry of ["grammars/", "queries/", "THIRD_PARTY_NOTICES.md"]) {
    check(pkg.files?.includes(entry), `package.json files lacks ${entry}`);
  }
  const runtime = pkg.dependencies?.["web-tree-sitter"];
  check(/^\d+\.\d+\.\d+$/.test(runtime ?? ""), `web-tree-sitter is not pinned exactly: ${runtime}`);
  check(body.includes(`web-tree-sitter@${runtime}`), `the section does not name web-tree-sitter@${runtime}`);
  check(/Node(\.js)? 20/.test(body) && pkg.engines?.node === ">=20", "the Node floor is not 20 in both the section and package.json");

  check(/adds to (reading|file reading)|alongside reading/i.test(body), "the section does not say the index adds to reading files");
  check(/whole files? (may|can) (still )?be read|read (a |the )?whole files?/i.test(body), "the section does not say whole files may be read");
  check(/name-matched/i.test(body) && /\blead\b/i.test(body), "the section does not say a name-matched reference is a lead");
  for (const banned of [/benchmark/i, /threshold/i, /quality risk/i, /discourag/i]) {
    check(!banned.test(body), `the section mentions ${banned}`);
  }
  checkNoRestriction(body, "INSTALLATION.md's Code index section");
}

/** SI9's restriction detector over install text: it adds to reading and takes nothing away. */
function checkNoRestriction(text, where) {
  for (const s of sentences(text)) {
    check(!restricts(s), `${where} restricts reading: "${s.slice(0, 110)}"`);
  }
}

function checkReadme(grammars, facts) {
  const text = read("mcp-server/README.md");
  const body = section(text, "Code index", "mcp-server/README.md").replace(/\s+/g, " ");
  for (const lang of Object.keys(grammars)) {
    check(body.includes(NAMES[lang]), `README's code-index paragraph does not name ${NAMES[lang]}`);
  }
  for (const tool of facts.toolNames) {
    check(body.includes(`\`${tool}\``), `README's code-index paragraph does not name \`${tool}\``);
  }
  check(body.includes("`AMANUENSIS_CODE_INDEX=off`"), "README's code-index paragraph does not name `AMANUENSIS_CODE_INDEX=off`");
  check(/INSTALLATION\.md#code-index/.test(body), "README's code-index paragraph does not link INSTALLATION.md#code-index");
  checkNoRestriction(section(text, "Code index", "mcp-server/README.md"), "README's code-index paragraph");
  for (const extra of ["Kotlin", "Ruby", "PHP", "Swift", "Scala", "Lua", "Haskell"]) {
    check(!body.includes(extra), `README's code-index paragraph names ${extra}, which is not vendored`);
  }
  check(/adds to (reading|file reading)|alongside reading/i.test(body), "README's code-index paragraph does not say the index adds to reading");
}

// ---------------------------------------------------------------------------------------
// The workflow

/** Jobs of a workflow file: matrix lists and steps with their single-line keys and run text. */
function parseWorkflow(text) {
  const jobs = [];
  let job = null;
  let step = null;
  let inJobs = false;
  let inMatrix = false;
  let block = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const indent = line.length - line.trimStart().length;
    if (block && (line === "" || indent > block.indent)) {
      block.step.run = `${block.step.run}\n${line.trim()}`;
      continue;
    }
    block = null;
    if (line === "" || line.trimStart().startsWith("#")) continue;
    if (indent === 0) {
      inJobs = line === "jobs:";
      continue;
    }
    if (!inJobs) continue;
    if (indent === 2 && /^\s+[\w-]+:$/.test(line)) {
      job = { id: line.trim().slice(0, -1), matrix: {}, matrixKeys: [], steps: [], keys: {} };
      jobs.push(job);
      step = null;
      inMatrix = false;
      continue;
    }
    if (!job) continue;
    if (indent === 4) {
      const m = line.trim().match(/^([\w-]+):\s*(.*)$/);
      if (m) job.keys[m[1]] = m[2];
      inMatrix = false;
      if (m && m[1] === "steps") step = null;
      continue;
    }
    if (indent === 6 && line.trim() === "matrix:") {
      inMatrix = true;
      continue;
    }
    if (inMatrix && indent === 8) {
      const m = line.trim().match(/^([\w-]+):\s*(.*)$/);
      if (m) {
        job.matrixKeys.push(m[1]);
        const items = m[2].match(/^\[(.*)\]$/);
        job.matrix[m[1]] = items ? items[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")) : [m[2]];
      }
      continue;
    }
    if (indent === 6 && line.trim().startsWith("- ")) {
      inMatrix = false;
      step = { keys: {}, with: {}, run: "" };
      job.steps.push(step);
      const m = line.trim().slice(2).match(/^([\w-]+):\s*(.*)$/);
      if (m) step.keys[m[1]] = m[2];
      continue;
    }
    if (step && indent === 8) {
      const m = line.trim().match(/^([\w-]+):\s*(.*)$/);
      if (!m) continue;
      if (m[1] === "run") {
        step.run = /^[|>]/.test(m[2]) ? "" : m[2];
        if (/^[|>]/.test(m[2])) block = { step, indent: 8 };
      } else step.keys[m[1]] = m[2];
      continue;
    }
    if (step && indent === 10) {
      const m = line.trim().match(/^([\w-]+):\s*(.*)$/);
      if (m) step.with[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return jobs;
}

const wd = (step) => step.keys["working-directory"] ?? "";
const runs = (step) => step.run.split("\n").map((l) => l.trim());

/** Steps of a job that run `command` as a whole line in `directory`. */
function stepsRunning(job, directory, command) {
  return job.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => wd(step) === directory && runs(step).includes(command));
}

function checkRegistration(workflow) {
  const plan = JSON.parse(read("design/semantic-index/plan.json"));
  const jobs = parseWorkflow(workflow);
  check(jobs.length > 0, "test.yml has no jobs");
  for (const packet of plan.packets) {
    const { command, marker } = packet.gate;
    const parts = command.split("&&").map((s) => s.trim());
    let directory = "";
    if (parts[0].startsWith("cd ")) directory = parts.shift().slice(3).trim();
    const gate = parts.pop();
    check(/^node \S+$/.test(gate), `${marker}: the command's last part "${gate}" is not "node <script>"`);
    const where = directory ? `in ${directory}` : "at the repository root";
    const found = jobs.flatMap((job) => stepsRunning(job, directory, gate).map((s) => ({ job, ...s })));
    check(found.length > 0, `${marker} (${gate}) is not a step of test.yml ${where}`);
    const registered = found.find(({ job, step, index }) =>
      parts.every((before) => stepsRunning(job, directory, before).some((s) => s.index < index)) &&
      !("if" in step.keys) &&
      !("continue-on-error" in step.keys),
    );
    check(
      registered,
      `${marker} (${gate}) is in test.yml, but conditional, allowed to fail, or after no step running ${parts.join(" and ") || "its prerequisites"}`,
    );
  }
}

function checkInstalledJob(workflow) {
  const jobs = parseWorkflow(workflow);
  const script = "node scripts/check-installed-package.mjs";
  const job = jobs.find((j) => stepsRunning(j, "mcp-server", script).length > 0);
  check(job, `no job of test.yml runs "${script}" in mcp-server`);
  check(
    sameSet(job.matrix[job.matrixKeys.find((k) => job.matrix[k].includes("ubuntu-latest"))] ?? [], ["ubuntu-latest", "macos-latest"]),
    "the installed-artifact job's matrix does not list exactly ubuntu-latest and macos-latest",
  );
  const nodeKey = job.matrixKeys.find((k) => job.matrix[k].includes("20"));
  check(nodeKey && sameSet(job.matrix[nodeKey], ["20", "22"]), "the installed-artifact job's matrix does not list exactly Node 20 and 22");
  const osKey = job.matrixKeys.find((k) => job.matrix[k].includes("ubuntu-latest"));
  check(job.matrixKeys.length === 2, `the installed-artifact job's matrix has keys [${job.matrixKeys.join(", ")}]; it needs exactly os and node`);
  check(job.keys["runs-on"] === `\${{ matrix.${osKey} }}`, "the installed-artifact job does not run on the matrix's os");
  check(!("continue-on-error" in job.keys), "the installed-artifact job is allowed to fail");
  check(!("if" in job.keys), "the installed-artifact job is conditional");
  const setup = job.steps.find((s) => (s.keys.uses ?? "").startsWith("actions/setup-node"));
  check(setup && setup.with["node-version"] === `\${{ matrix.${nodeKey} }}`, "the installed-artifact job's setup-node does not use the matrix's Node version");
  const run = stepsRunning(job, "mcp-server", script)[0];
  check(!("if" in run.step.keys) && !("continue-on-error" in run.step.keys), "the installed-artifact step is conditional or allowed to fail");
  check(
    stepsRunning(job, "mcp-server", "npm ci").some((s) => s.index < run.index) &&
      job.steps.indexOf(setup) < run.index,
    "the installed-artifact job does not set up Node and run `npm ci` before its check",
  );
  check(!/\b(exclude|include):/.test(workflow.slice(workflow.indexOf(`  ${job.id}:`))), "the installed-artifact job's matrix has an exclude or include");
}

// ---------------------------------------------------------------------------------------
// The installed-artifact check and its fixture

async function checkScript(grammars) {
  const text = read("mcp-server/scripts/check-installed-package.mjs");
  for (const [needle, what] of [
    ['"pack"', "npm pack"],
    ['"install"', "npm install of the tarball"],
    ["mkdtemp", "an empty directory"],
    ["StdioClientTransport", "the stdio server"],
    ["amanuensis-memory", "the installed server shim"],
    ['call("outline_file"', "a call to outline_file"],
    ['call("read_symbol"', "a call to read_symbol"],
    ["fixtures/installed-artifact", "the fixture directory"],
    ["installedProbe", "the probe symbol"],
    ["process.exit", "a failing exit"],
  ]) {
    check(text.includes(needle), `scripts/check-installed-package.mjs does not use ${what}`);
  }
  check(/for \(const .* of .*(FIXTURES|fixtures|files)/.test(text), "scripts/check-installed-package.mjs does not loop over the fixture files");
  check(
    /for \(const (\w+) of FIXTURES\) await checkFixture\(call, \1\);/.test(text),
    "scripts/check-installed-package.mjs does not run checkFixture over every entry of FIXTURES",
  );

  // What the script exercises: FIXTURES holds each manifest language once, and checkFixture
  // turns down each way a language can fail to load, on canned responses.
  let script;
  try {
    script = await import(pathToFileURL(join(server, "scripts", "check-installed-package.mjs")).href);
  } catch (error) {
    fail(`scripts/check-installed-package.mjs cannot be imported: ${String(error?.message ?? error).split("\n")[0]}`);
  }
  check(Array.isArray(script.FIXTURES) && typeof script.checkFixture === "function", "scripts/check-installed-package.mjs does not export FIXTURES and checkFixture");
  const listed = script.FIXTURES.map((f) => f.language).sort();
  check(
    JSON.stringify(listed) === JSON.stringify(Object.keys(grammars).sort()),
    `the installed-artifact check exercises ${listed.join(", ")}, not each manifest language once (${Object.keys(grammars).sort().join(", ")})`,
  );
  const fixtureExtensions = extensionsOfCode();
  for (const f of script.FIXTURES) {
    check(existsSync(join(server, "fixtures", "installed-artifact", f.file)), `the installed-artifact check names ${f.file}, which fixtures/installed-artifact/ lacks`);
    check(fixtureExtensions[f.language]?.includes(extname(f.file).toLowerCase()), `the installed-artifact check gives ${f.language} the file ${f.file}, whose extension is not that language's`);
  }
  await checkFixtureVerdicts(script);

  const dir = join(server, "fixtures", "installed-artifact");
  check(existsSync(dir), "mcp-server/fixtures/installed-artifact/ is missing");
  const extensions = extensionsOfCode();
  const owner = {};
  for (const [lang, list] of Object.entries(extensions)) for (const e of list) owner[e] = lang;
  const byLanguage = {};
  for (const name of readdirSync(dir)) {
    const lang = owner[extname(name).toLowerCase()];
    check(lang, `fixtures/installed-artifact/${name} has an extension no language owns`);
    (byLanguage[lang] ??= []).push(name);
    check(
      /\binstalledProbe\b/.test(readFileSync(join(dir, name), "utf8")),
      `fixtures/installed-artifact/${name} does not define installedProbe`,
    );
  }
  for (const lang of Object.keys(grammars)) {
    check(
      byLanguage[lang]?.length === 1,
      `fixtures/installed-artifact/ has ${byLanguage[lang]?.length ?? 0} files for ${NAMES[lang]}; it needs one`,
    );
  }
}

/** checkFixture accepts a good response and refuses each way a grammar or query fails to show. */
async function checkFixtureVerdicts(script) {
  const fixture = script.FIXTURES[0];
  const good = {
    outline_file: { ok: true, lang: fixture.language, status: "ok", symbols: [{ symbol_id: "x", children: [{ symbol_id: "installedProbe" }] }] },
    read_symbol: { ok: true, source: "function installedProbe() {}", evidence_args: { file_path: fixture.file, symbol: "installedProbe" } },
  };
  const verdict = async (tool, patch) => {
    const responses = { ...good, [tool]: patch === null ? good[tool] : { ...good[tool], ...patch } };
    try {
      await script.checkFixture(async (name) => responses[name], fixture);
      return "accepted";
    } catch (error) {
      return error instanceof script.CheckFailure ? "refused" : `threw ${String(error?.message ?? error).split("\n")[0]}`;
    }
  };
  check((await verdict("outline_file", null)) === "accepted", "checkFixture refuses a good outline and read");
  for (const [tool, patch, what] of [
    ["outline_file", { ok: false }, "a refused outline"],
    ["outline_file", { lang: "plaintext" }, "an outline in another language"],
    ["outline_file", { status: "partial" }, "an outline whose status is not ok"],
    ["outline_file", { status: "unavailable" }, "an outline whose grammar did not load"],
    ["outline_file", { symbols: [{ symbol_id: "other" }] }, "an outline without the probe"],
    ["read_symbol", { ok: false }, "a refused read_symbol"],
    ["read_symbol", { source: undefined }, "a read_symbol without source"],
    ["read_symbol", { evidence_args: undefined }, "a read_symbol without evidence_args"],
    ["read_symbol", { evidence_args: { file_path: "elsewhere.ts", symbol: "installedProbe" } }, "evidence_args for another file"],
  ]) {
    const got = await verdict(tool, patch);
    check(got === "refused", `checkFixture does not refuse ${what} (${got})`);
  }
}

try {
  const installation = read("INSTALLATION.md");
  const body = section(installation, "Code index", "INSTALLATION.md");
  const facts = storeFacts();
  checkAbsentManifest();
  const grammars = manifest();
  checkSection(body, grammars, facts);
  checkReadme(grammars, facts);
  const workflow = read(".github/workflows/test.yml");
  checkRegistration(workflow);
  checkInstalledJob(workflow);
  await checkScript(grammars);
  console.log("GATE SI11 GREEN");
} catch (error) {
  if (!(error instanceof Red)) {
    console.log(`GATE SI11 RED: the gate failed on an unexpected error: ${String(error?.message ?? error).split("\n")[0]}`);
    process.exit(1);
  }
  console.log(`GATE SI11 RED: ${error.message}`);
  process.exit(1);
}
