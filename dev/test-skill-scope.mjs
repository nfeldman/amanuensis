#!/usr/bin/env node
// GATE SC8 (design/scope/PLAN.md §3 SC8; §2.11).
//
// Two halves. The text half reads the skill in .claude/skills/amanuensis. The control half drives the
// built server over stdio in a scratch git repository, in the order the skill's Phase 0b names.
//
// Turns red when:
//   - references/onboarding.md has no `## Phase 0b` heading between Phase 0 and Phase 1, or Phase 0b
//     does not hold a numbered list of exactly seven steps, in this order:
//       1. `set_git_state`, with the reason that `detect_changes` refuses without it;
//       2. `set_scope_rule` for any owner rule the request states, with the owner's words quoted;
//       3. `detect_changes`, to see the gitignore matches;
//       4. sorting every unsorted path by prefix where a prefix is uniform and by single path where
//          it isn't, code included (the code's prefix gets a `product` row too), with product
//          (code, tests, fixtures, build, CI, configuration, documentation that ships or describes
//          use) and meta (plans, specs, reviews of past work, research, recorded evidence, notes)
//          each defined;
//       5. each meta prefix listed, the first lines of a sample opened (every file up to 5,
//          otherwise 5 spread across the listing) and cited;
//       6. `record_scope_sorting`, a meta row with its inventory;
//       7. `detect_changes` again, confirming `unsorted` is 0;
//     or the Phase 0b text lacks the when-in-doubt rule (sort as product, because a wrong product
//     costs reading time while a wrong meta hides code, and log the doubt with
//     `record_open_question`);
//   - Phase 7 still calls `set_git_state` as its first bullet, or at all in call form;
//   - the tools Phase 0b names are not in the order set_git_state, set_scope_rule, detect_changes,
//     record_scope_sorting, detect_changes, or one of them is absent from the built server;
//   - SKILL.md's routing table has no row for "ignore X" / "don't survey X" that calls
//     `set_scope_rule` with `exclude` and quotes the owner's words, or none for "survey X after
//     all" that calls it with `include`;
//   - phase-1-scope.md does not say a path outside the survey set gets no ledger row,
//     notes.md does not say what `excluded` with a source (gitignore, user, meta) means when
//     answering about a locus, or refresh.md does not say a new path under a meta prefix
//     inherits its category while a new path under no rule is unsorted and needs sorting before
//     publication;
//   - a refusal sentence an earlier packet added is gone: onboarding.md's Phase 0b writer
//     refusals, phase-5-packaging.md's "survey path(s) that no sorting row covers", records.md's
//     excluded-path refusals, or test-refusal-parity.mjs does not pass;
//   - the executable fresh-store control, run against the built server over stdio in a scratch git
//     repository (a tracked ignored file, a vendored prefix the owner excludes, product code, tests,
//     seven design files and two notes files):
//       - run in the skill's order, it does not end with `unsorted` 0, with the golden unsorted list
//         before sorting (exact paths), the golden excluded counts by source (gitignore, user, meta)
//         and the golden survey-set size;
//       - the code prefix has no `product` row, or a meta row has no inventory of the sampled files;
//       - the negative arm, which leaves out `set_git_state`, is not refused by `detect_changes`, or
//         the refusal does not name `set_git_state`. This is what lets the control turn red.
// Prints exactly one last line: `GATE SC8 GREEN` (exit 0) or `GATE SC8 RED: <reason>` (exit 1).

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "mcp-server");
const skill = join(root, ".claude", "skills", "amanuensis");

// A crash signature in a red run means the gate never reached its assertion, so quoted errors are
// scrubbed: each signature is split by an ellipsis.
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
let checked = 0;
function check(label, fn) {
  checked++;
  try {
    const detail = fn();
    if (detail) failures.push(`${label}: ${scrub(detail)}`);
  } catch (error) {
    failures.push(`${label}: threw — ${scrub(error?.message ?? error)}`);
  }
}
async function checkAsync(label, fn) {
  checked++;
  try {
    const detail = await fn();
    if (detail) failures.push(`${label}: ${scrub(detail)}`);
  } catch (error) {
    failures.push(`${label}: threw — ${scrub(error?.message ?? error)}`);
  }
}

function finish() {
  console.log(`  ran  ${checked} assertion(s)`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  FAIL ${failure}`);
    console.log(`GATE SC8 RED: ${failures.length} of ${checked} assertion(s) failed; first: ${failures[0]}`);
    process.exit(1);
  }
  console.log("GATE SC8 GREEN");
  process.exit(0);
}

function readText(relative) {
  try {
    return readFileSync(join(skill, relative), "utf8");
  } catch {
    return null;
  }
}

/** The text of a `## ` section of a Markdown file, from its heading to the next `## ` heading. */
function section(text, headingStart) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## ${headingStart}`));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** Collapse whitespace so a sentence wrapped across lines matches as one line. */
const flat = (text) => text.replace(/\s+/g, " ").trim();

/** The numbered items of a list (lines starting `N. `), each with its wrapped continuation lines. */
function numberedItems(text) {
  const items = [];
  let current = null;
  for (const line of text.split("\n")) {
    const start = /^(\d+)\.\s+(.*)$/.exec(line);
    if (start) {
      current = { number: Number(start[1]), text: start[2] };
      items.push(current);
    } else if (current && (/^\s{2,}\S/.test(line) || line.trim() === "")) {
      if (line.trim() !== "") current.text += ` ${line.trim()}`;
      else if (current.text && items.length) current.closed = true;
      if (current.closed && line.trim() !== "") current.closed = false;
    } else if (current && !/^\s/.test(line) && line.trim() !== "") {
      current = null;
    }
  }
  return items.map((item) => ({ number: item.number, text: flat(item.text) }));
}

const toolNames = (text) =>
  [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)(?:\([^`]*\))?`/g)].map((match) => match[1]);

// ---------------------------------------------------------------------------------------- text half

const onboarding = readText("references/onboarding.md");
const skillMd = readText("SKILL.md");
let steps = [];
let phase0b = null;

check("T1 onboarding.md is present, with Phase 0b between Phase 0 and Phase 1", () => {
  if (onboarding === null) return "references/onboarding.md is absent";
  const at = (heading) => onboarding.split("\n").findIndex((line) => line.startsWith(heading));
  const [p0, p0b, p1] = [at("## Phase 0 "), at("## Phase 0b "), at("## Phase 1 ")];
  if (p0b === -1) return "there is no `## Phase 0b` heading";
  if (!(p0 !== -1 && p0 < p0b && p0b < p1)) return `Phase 0b is not between Phase 0 and Phase 1 (lines ${p0}, ${p0b}, ${p1})`;
  if (!/^## Phase 0b · What the survey leaves out$/m.test(onboarding)) return "Phase 0b is not headed 'What the survey leaves out'";
  phase0b = section(onboarding, "Phase 0b ");
  return null;
});

check("T2 Phase 0b holds seven numbered steps, numbered 1 to 7", () => {
  if (phase0b === null) return "no Phase 0b to read";
  steps = numberedItems(phase0b);
  const numbers = steps.map((step) => step.number).join(",");
  return numbers === "1,2,3,4,5,6,7" ? null : `its numbered steps are ${numbers || "absent"}`;
});

const STEP_RULES = [
  [
    "1 set_git_state first, because detect_changes refuses without it",
    (s) => /`set_git_state/.test(s) && /`detect_changes`/.test(s) && /refus/i.test(s),
  ],
  [
    "2 an owner rule, with `set_scope_rule` and the owner's words quoted",
    (s) => /`set_scope_rule/.test(s) && /owner/i.test(s) && /\bquot/i.test(s) && /\bwords\b/i.test(s),
  ],
  [
    "3 detect_changes, for the gitignore matches",
    (s) => /`detect_changes/.test(s) && /gitignore/i.test(s),
  ],
  [
    "4 every path sorted by prefix or single path, code included with a `product` row, product and meta defined",
    (s) =>
      /\bevery\b/i.test(s) &&
      /\bprefix\b/i.test(s) &&
      /single path|one path|each path/i.test(s) &&
      /code (?:included|too|as well)|including (?:the )?code|code (?:gets|also gets|is sorted)/i.test(s) &&
      /`product` row/.test(s) &&
      /`meta`|\bmeta\b/.test(s) &&
      /\bunsorted\b/i.test(s) &&
      /\btests?\b/i.test(s) &&
      /\bfixtures?\b/i.test(s) &&
      /\bbuild\b/i.test(s) &&
      /\bCI\b/.test(s) &&
      /\bconfiguration\b/i.test(s) &&
      /\bplans?\b/i.test(s) &&
      /\bspecs?\b/i.test(s) &&
      /\breviews?\b/i.test(s) &&
      /\bresearch\b/i.test(s) &&
      /recorded evidence/i.test(s) &&
      /\bnotes\b/i.test(s),
  ],
  [
    "5 each meta prefix listed, the first lines of a sample opened (every file up to 5, else 5 spread across the listing), cited",
    (s) =>
      /\bmeta\b/.test(s) &&
      /\blists?\b/i.test(s) &&
      /first lines/i.test(s) &&
      /every file up to 5/i.test(s) &&
      /5 spread across the listing/i.test(s) &&
      /\bcite/i.test(s),
  ],
  [
    "6 record_scope_sorting, a meta row with its inventory",
    (s) => /`record_scope_sorting/.test(s) && /\binventory\b/i.test(s),
  ],
  [
    "7 detect_changes again, confirming `unsorted` is 0",
    (s) => /`detect_changes/.test(s) && /\bagain\b/i.test(s) && /`unsorted`/.test(s) && /\b0\b/.test(s),
  ],
];

check("T3 each of the seven steps says what the plan's step says, in order", () => {
  if (steps.length !== 7) return "Phase 0b has no seven steps to read";
  const problems = [];
  for (const [index, [label, matches]] of STEP_RULES.entries()) {
    if (!matches(steps[index].text)) problems.push(`step ${label}: step ${index + 1} reads "${steps[index].text.slice(0, 120)}"`);
  }
  return problems.length ? problems.join("; ") : null;
});

check("T4 step 1 is the only step that calls set_git_state, and it comes before every other tool", () => {
  if (steps.length !== 7) return "Phase 0b has no seven steps to read";
  const order = steps.flatMap((step) => toolNames(step.text).slice(0, 1));
  const want = ["set_git_state", "set_scope_rule", "detect_changes", "record_scope_sorting", "detect_changes"];
  if (JSON.stringify(order) !== JSON.stringify(want)) return `the first tool of each step is ${JSON.stringify(order)}`;
  const later = steps.slice(1).filter((step) => toolNames(step.text).includes("set_git_state"));
  return later.length === 0 ? null : `step ${later[0].number} names set_git_state again`;
});

check("T5 Phase 0b carries the when-in-doubt rule", () => {
  if (phase0b === null) return "no Phase 0b to read";
  const text = flat(phase0b);
  const sentences = text.split(/(?<=[.!?])\s+/);
  const inDoubt = sentences.find((s) => /\bin doubt\b/i.test(s));
  if (!inDoubt) return "no sentence says what to do in doubt";
  const ok =
    /\bproduct\b/.test(inDoubt) &&
    /wrong product costs reading time/.test(inDoubt) &&
    /wrong meta hides code/.test(inDoubt);
  if (!ok) return `the in-doubt sentence reads "${inDoubt.slice(0, 160)}"`;
  const logged = sentences.find((s) => /`record_open_question`/.test(s) && /\bdoubt\b/i.test(s));
  return logged ? null : "no sentence logs the doubt with `record_open_question`";
});

check("T6 Phase 7 no longer calls set_git_state, first or at all", () => {
  if (onboarding === null) return "onboarding.md is absent";
  const phase7 = section(onboarding, "Phase 7 · Produce the conspectus");
  if (phase7 === null) return "no Phase 7 section";
  const firstBullet = phase7.split("\n").find((line) => /^- /.test(line)) ?? "";
  if (/set_git_state/.test(firstBullet)) return `Phase 7's first bullet is "${firstBullet.slice(0, 100)}"`;
  const call = /\b[Cc]all\s+`set_git_state\(/.test(flat(phase7)) || /`set_git_state\(/.test(phase7);
  return call ? "Phase 7 still holds a set_git_state call" : null;
});

check("T7 the two routing rows are in SKILL.md's table", () => {
  if (skillMd === null) return "SKILL.md is absent";
  const rows = skillMd.split("\n").filter((line) => /^\|/.test(line));
  const cells = (row) => row.split("|").slice(1, -1).map((c) => c.trim());
  const exclude = rows.find((row) => /ignore X/i.test(cells(row)[0] ?? "") && /don't survey X/i.test(cells(row)[0] ?? ""));
  const include = rows.find((row) => /survey X after all/i.test(cells(row)[0] ?? ""));
  const problems = [];
  if (!exclude) problems.push("no row for \"ignore X\" / \"don't survey X\"");
  else {
    const action = cells(exclude)[1] ?? "";
    if (!(/`set_scope_rule/.test(action) && /`exclude`/.test(action))) problems.push(`the exclude row calls "${action.slice(0, 100)}"`);
    if (!/owner'?s? (own )?words|owner_words/i.test(action)) problems.push("the exclude row does not quote the owner's words");
  }
  if (!include) problems.push("no row for \"survey X after all\"");
  else {
    const action = cells(include)[1] ?? "";
    if (!(/`set_scope_rule/.test(action) && /`include`/.test(action))) problems.push(`the include row calls "${action.slice(0, 100)}"`);
    if (/`exclude`/.test(action)) problems.push("the include row names exclude");
  }
  return problems.length ? problems.join("; ") : null;
});

check("T8 phase-1-scope.md says a path outside the survey set gets no ledger row", () => {
  const text = readText("references/phase-1-scope.md");
  if (text === null) return "phase-1-scope.md is absent";
  const sentence = flat(text)
    .split(/(?<=[.!?])\s+/)
    .find((s) => /survey set/i.test(s) && /no ledger row/i.test(s));
  if (!sentence) return "no sentence has a path outside the survey set getting no ledger row";
  if (!/\boutside the survey set\b/i.test(sentence)) return `the sentence reads "${sentence.slice(0, 140)}"`;
  return /`add_files_to_scope`/.test(flat(text).split(/(?<=[.!?])\s+/).filter((s) => /survey set/i.test(s)).join(" "))
    ? null
    : "no sentence about the survey set names add_files_to_scope, which refuses the path";
});

check("T9 notes.md says what `excluded` with a source means when answering about a locus", () => {
  const text = readText("references/notes.md");
  if (text === null) return "notes.md is absent";
  const sentences = flat(text).split(/(?<=[.!?])\s+/);
  const about = sentences.filter((s) => /`excluded`/.test(s) && /`source`|\bsource\b/.test(s));
  const joined = about.join(" ");
  const problems = [];
  if (about.length === 0) return "no sentence gives `excluded` with a source a meaning";
  for (const source of ["gitignore", "user", "meta"]) if (!joined.includes(source)) problems.push(`${source} is not named`);
  if (!/survey set/i.test(joined)) problems.push("the survey set is not named");
  if (!/no (?:record|ledger row)|not (?:been )?survey|no survey/i.test(joined)) problems.push("it does not say the path holds no record");
  if (!/ledger/.test(joined)) problems.push("it does not set the ledger source (a ledger classification) apart");
  return problems.length ? problems.join("; ") : null;
});

check("T10 refresh.md says new paths under a meta prefix inherit and new paths under no rule are unsorted", () => {
  const text = readText("references/refresh.md");
  if (text === null) return "refresh.md is absent";
  const sentences = flat(text).split(/(?<=[.!?])\s+/);
  const inherit = sentences.find((s) => /\bmeta prefix\b/i.test(s) && /\binherit/i.test(s));
  if (!inherit) return "no sentence says a new path under a meta prefix inherits";
  const unsorted = sentences.find((s) => /under no rule/i.test(s) && /\bunsorted\b/.test(s));
  if (!unsorted) return "no sentence says a new path under no rule is unsorted";
  const joined = `${inherit} ${unsorted} ${sentences.filter((s) => /\bunsorted\b/.test(s)).join(" ")}`;
  if (!/`record_scope_sorting`/.test(joined)) return "the unsorted guidance does not name record_scope_sorting";
  return /before (?:publication|`materialize_docs`|publishing)/i.test(joined)
    ? null
    : "the unsorted guidance does not say sorting comes before publication";
});

check("T11 every refusal sentence an earlier packet added is still there", () => {
  const needles = [
    ["references/onboarding.md", "Both writers refuse a pattern that is not one a scope row can hold"],
    ["references/onboarding.md", "A `supersedes` that names no row is refused"],
    ["references/onboarding.md", "A rule without `owner_words` is refused"],
    ["references/onboarding.md", "the server refuses one which is outside the pattern"],
    ["references/phase-5-packaging.md", "survey path(s) that no sorting row covers"],
    ["references/records.md", "These writers refuse it with its source and its rule"],
    ["references/records.md", "A record may not rest on an excluded path's evidence either"],
  ];
  const problems = [];
  for (const [file, needle] of needles) {
    const text = readText(file);
    if (text === null) problems.push(`${file} is absent`);
    else if (!flat(text).includes(needle)) problems.push(`${file} lost "${needle}"`);
  }
  return problems.length ? problems.join("; ") : null;
});

check("T12 test-refusal-parity.mjs passes", () => {
  const result = spawnSync(process.execPath, ["test-refusal-parity.mjs"], {
    cwd: server,
    encoding: "utf8",
    timeout: 300_000,
  });
  if (result.status === 0) return null;
  const tail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().split("\n").slice(-3).join(" | ");
  return `exit ${result.status}: ${tail}`;
});

// ------------------------------------------------------------------------------ the fresh-store control

function git(cwd, ...args) {
  const result = spawnSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "user.email=sc8@localhost", "-c", "user.name=scope-sc8", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return String(result.stdout ?? "").trim();
}

const lines = (title) =>
  `${[`# ${title}`, "", `The ${title} records a decision taken in review.`, `Owner: ${title} author.`, "End."].join("\n")}\n`;
const code = (name) => {
  const out = ["export interface Unit {", `  label: "${name}";`, "  line: number;", "}"];
  for (let n = 5; n <= 12; n++) out.push(`export const ${name}${n} = ${n};`);
  return `${out.join("\n")}\n`;
};
const DESIGN = ["a", "b", "c", "d", "e", "f", "g"].map((x) => `design/${x}.md`);
const NOTES = ["notes/plan.md", "notes/review.md"];
const FILES = {
  ".gitignore": "build/\n",
  "package.json": '{ "name": "fixture" }\n',
  "src/app.ts": code("app"),
  "src/util.ts": code("util"),
  "tests/app.test.ts": code("appTest"),
  "vendor/lib/index.js": "module.exports = 1;\n",
  "vendor/lib/other.js": "module.exports = 2;\n",
  ...Object.fromEntries([...DESIGN, ...NOTES].map((path) => [path, lines(path.replace(/\..*$/, "").replace("/", " "))])),
};
const IGNORED_BUT_TRACKED = "build/out.js";

function fixtureRepo(parent, name) {
  const ws = join(parent, name);
  mkdirSync(ws, { recursive: true });
  git(ws, "init", "-q", "--template=", "-b", "main");
  for (const [path, body] of Object.entries(FILES)) {
    mkdirSync(dirname(join(ws, path)), { recursive: true });
    writeFileSync(join(ws, path), body);
  }
  mkdirSync(join(ws, "build"), { recursive: true });
  writeFileSync(join(ws, IGNORED_BUT_TRACKED), "module.exports = 0;\n");
  git(ws, "add", "-A");
  git(ws, "add", "-f", IGNORED_BUT_TRACKED);
  git(ws, "commit", "-q", "--no-verify", "-m", "seed");
  return { ws, head: git(ws, "rev-parse", "HEAD") };
}

/** A server over stdio, bound to one workspace; `call(name, args)` resolves to the parsed tool result. */
function startServer(workspace) {
  const child = spawn(process.execPath, [join(server, "dist", "index.js"), "--workspace", workspace], {
    cwd: workspace,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  let exited = null;
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const rows = buffer.split("\n");
    buffer = rows.pop() ?? "";
    for (const row of rows) {
      if (!row.trim().startsWith("{")) continue;
      let message;
      try {
        message = JSON.parse(row);
      } catch {
        continue;
      }
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        waiter(message);
      }
    }
  });
  child.on("exit", (status) => {
    exited = `the server exited ${status}: ${stderr.slice(0, 300)}`;
    for (const [id, waiter] of pending) waiter({ id, error: { message: exited } });
    pending.clear();
  });
  const rpc = (method, params) =>
    new Promise((resolveRpc) => {
      if (exited) return resolveRpc({ error: { message: exited } });
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolveRpc({ error: { message: `${method} did not answer within 120s` } });
      }, 120_000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolveRpc(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return {
    async open() {
      const init = await rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "sc8", version: "0" },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
      return init.error ? init.error.message : null;
    },
    async tools() {
      const message = await rpc("tools/list", {});
      return (message.result?.tools ?? []).map((tool) => tool.name);
    },
    async call(name, args) {
      const message = await rpc("tools/call", { name, arguments: args });
      if (message.error) return { ok: false, error: String(message.error.message ?? JSON.stringify(message.error)) };
      const text = message.result?.content?.[0]?.text ?? "null";
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { ok: false, error: text };
      }
      if (message.result?.isError && !(payload && payload.ok === false)) return { ok: false, error: text };
      return payload;
    },
    close() {
      try {
        child.kill("SIGTERM");
      } catch {}
    },
  };
}

/** Group the unsorted paths by their first directory; a loose root file is its own pattern. */
function prefixes(paths) {
  const groups = new Map();
  for (const path of paths) {
    const slash = path.indexOf("/");
    const key = slash === -1 ? path : `${path.slice(0, slash)}/`;
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  return groups;
}
/** Every file up to 5, otherwise 5 spread across the listing. */
function sample(files) {
  if (files.length <= 5) return files;
  return [0, 1, 2, 3, 4].map((i) => files[Math.floor((i * (files.length - 1)) / 4)]);
}
const CATEGORY = { "src/": "product", "tests/": "product", ".gitignore": "product", "package.json": "product", "design/": "meta", "notes/": "meta" };

/** Phase 0b's calls, in the order the skill names them. Returns what each step saw. */
async function runPhase0b(srv, order, head, seen) {
  let detects = 0;
  for (const name of order) {
    if (name === "set_git_state") {
      seen.git = await srv.call("set_git_state", { canonical_branch: "main", onboarding_sha: head });
    } else if (name === "set_scope_rule") {
      seen.rule = await srv.call("set_scope_rule", {
        pattern: "vendor/",
        action: "exclude",
        reason: "the owner says vendored code is not theirs",
        owner_words: "don't survey vendor/, it isn't ours",
      });
    } else if (name === "detect_changes") {
      const result = await srv.call("detect_changes", { current_sha: head });
      seen.detects.push(result);
      detects++;
      if (result?.ok === false) return;
    } else if (name === "record_scope_sorting") {
      const unsorted = seen.detects.at(-1)?.scope?.unsorted_paths ?? [];
      for (const [pattern, paths] of prefixes(unsorted)) {
        const category = CATEGORY[pattern];
        const args = { pattern, category, description: `${pattern} sorted as ${category} in Phase 0b` };
        if (category === "meta") {
          const listing = FILES_UNDER(pattern);
          args.inventory = sample(listing).map((file_path) => ({
            file_path,
            line_range: "1-3",
            excerpt: FILES[file_path].split("\n")[2],
          }));
        }
        const result = await srv.call("record_scope_sorting", args);
        seen.sortings.push({ pattern, category, paths, result });
      }
    }
  }
}
const FILES_UNDER = (prefix) => Object.keys(FILES).filter((path) => path.startsWith(prefix)).sort();

const scratch = mkdtempSync(join(tmpdir(), "amanuensis-sc8-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

if (!existsSync(join(server, "dist", "index.js"))) {
  checked++;
  failures.push("C0 the server build is absent (mcp-server/dist/index.js): run npm run build");
  finish();
}

// The tool order the control runs in is the one the skill names; with no Phase 0b it is the plan's.
const PLAN_ORDER = ["set_git_state", "set_scope_rule", "detect_changes", "record_scope_sorting", "detect_changes"];
const skillOrder = steps.length === 7 ? steps.flatMap((step) => toolNames(step.text).slice(0, 1)) : [];
const order = skillOrder.length === PLAN_ORDER.length ? skillOrder : PLAN_ORDER;

const sessions = [];
process.on("exit", () => {
  for (const srv of sessions) srv.close();
});

async function arm(name, calls) {
  const { ws, head } = fixtureRepo(scratch, name);
  const srv = startServer(ws);
  sessions.push(srv);
  const seen = { detects: [], sortings: [], git: null, rule: null };
  const opened = await srv.open();
  if (opened) return { error: `the server did not open: ${opened}` };
  const names = await srv.tools();
  const started = await srv.call("start_session", { intent: "sc8" });
  if (!started?.session_id) return { error: `start_session: ${JSON.stringify(started).slice(0, 200)}` };
  await runPhase0b(srv, calls, head, seen);
  const scope = await srv.call("get_scope", {});
  return { srv, seen, names, scope, ws, head };
}

let full = null;
await checkAsync("C1 the built server offers the tools Phase 0b names", async () => {
  full = await arm("full", order);
  if (full.error) return full.error;
  const missing = order.filter((tool) => !full.names.includes(tool));
  return missing.length ? `the built server lacks ${missing.join(", ")}` : null;
});

// Everything in the fixture's tree: the ignored file, vendor/, code, tests, design/ and notes/.
const TREE = [...Object.keys(FILES), IGNORED_BUT_TRACKED].sort();
const GOLDEN_UNSORTED = TREE.filter((p) => !p.startsWith("vendor/") && p !== IGNORED_BUT_TRACKED).sort();

check("C2 the first detect_changes shows the gitignore match and the owner's rule, with the golden unsorted list", () => {
  if (!full || full.error) return full?.error ?? "no control run";
  const first = full.seen.detects[0];
  if (first?.ok === false || !first?.scope) return `detect_changes: ${JSON.stringify(first).slice(0, 200)}`;
  const { scope } = first;
  const problems = [];
  if (scope.mode !== "sorted") problems.push(`mode ${scope.mode}`);
  if (!same(scope.excluded, { gitignore: 1, user: 2, meta: 0 })) problems.push(`excluded ${JSON.stringify(scope.excluded)}`);
  if (scope.survey_paths !== GOLDEN_UNSORTED.length) problems.push(`survey_paths ${scope.survey_paths}, want ${GOLDEN_UNSORTED.length}`);
  if (scope.unsorted !== GOLDEN_UNSORTED.length) problems.push(`unsorted ${scope.unsorted}, want ${GOLDEN_UNSORTED.length}`);
  if (!same([...(scope.unsorted_paths ?? [])].sort(), GOLDEN_UNSORTED)) problems.push(`unsorted_paths ${JSON.stringify(scope.unsorted_paths)}`);
  return problems.join("; ") || null;
});

check("C3 every prefix is sorted, the code prefix as `product` and each meta prefix with its sampled inventory", () => {
  if (!full || full.error) return full?.error ?? "no control run";
  const problems = [];
  const sorted = full.seen.sortings;
  const want = ["design/", "notes/", "src/", "tests/", ".gitignore", "package.json"].sort();
  if (!same(sorted.map((s) => s.pattern).sort(), want)) problems.push(`sorted patterns ${JSON.stringify(sorted.map((s) => s.pattern))}`);
  for (const row of sorted) if (row.result?.ok !== true) problems.push(`${row.pattern}: ${JSON.stringify(row.result).slice(0, 160)}`);
  const src = sorted.find((s) => s.pattern === "src/");
  if (src?.category !== "product") problems.push("src/ was not sorted as product");
  const rows = full.scope?.sorting;
  if (!Array.isArray(rows)) return `get_scope returned no sorting rows: ${JSON.stringify(full.scope).slice(0, 160)}`;
  const row = (pattern) => rows.find((r) => r.pattern === pattern);
  if (row("src/")?.category !== "product") problems.push("get_scope has no product row for src/");
  if (row("tests/")?.category !== "product") problems.push("get_scope has no product row for tests/");
  if (row("design/")?.category !== "meta" || row("design/")?.inventory !== 5) {
    problems.push(`design/ (7 files) wants a meta row with 5 inventory citations: ${JSON.stringify(row("design/"))}`);
  }
  if (row("notes/")?.category !== "meta" || row("notes/")?.inventory !== 2) {
    problems.push(`notes/ (2 files) wants a meta row with 2 inventory citations: ${JSON.stringify(row("notes/"))}`);
  }
  const rule = (full.scope?.rules ?? []).find((r) => r.pattern === "vendor/");
  if (rule?.action !== "exclude" || rule?.owner_words !== "don't survey vendor/, it isn't ours") {
    problems.push(`the owner's rule is not kept with their words: ${JSON.stringify(rule)}`);
  }
  return problems.join("; ") || null;
});

check("C4 the second detect_changes ends with `unsorted` 0 and the golden counts by source", () => {
  if (!full || full.error) return full?.error ?? "no control run";
  const last = full.seen.detects.at(-1);
  if (full.seen.detects.length !== 2) return `${full.seen.detects.length} detect_changes calls ran, want 2`;
  if (last?.ok === false || !last?.scope) return `detect_changes: ${JSON.stringify(last).slice(0, 200)}`;
  const { scope } = last;
  const problems = [];
  if (scope.unsorted !== 0) problems.push(`unsorted ${scope.unsorted}`);
  if (scope.unsorted_paths?.length) problems.push(`unsorted_paths ${JSON.stringify(scope.unsorted_paths)}`);
  if (!same(scope.excluded, { gitignore: 1, user: 2, meta: DESIGN.length + NOTES.length })) problems.push(`excluded ${JSON.stringify(scope.excluded)}`);
  const surveyed = ["src/app.ts", "src/util.ts", "tests/app.test.ts", ".gitignore", "package.json"];
  if (scope.survey_paths !== surveyed.length) problems.push(`survey_paths ${scope.survey_paths}, want ${surveyed.length}`);
  return problems.join("; ") || null;
});

await checkAsync("C5 the negative arm, with no set_git_state, is refused by detect_changes naming set_git_state", async () => {
  const without = order.filter((tool) => tool !== "set_git_state");
  const bad = await arm("negative", without);
  if (bad.error) return bad.error;
  const first = bad.seen.detects[0];
  if (first?.ok !== false) return `detect_changes was not refused: ${JSON.stringify(first).slice(0, 160)}`;
  if (!/set_git_state/.test(String(first.error))) return `the refusal does not name set_git_state: ${first.error}`;
  const last = bad.seen.detects.at(-1);
  return last?.ok === false ? null : "a later detect_changes was not refused either";
});

for (const srv of sessions) srv.close();
finish();
