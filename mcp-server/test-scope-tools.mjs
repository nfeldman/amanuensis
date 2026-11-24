#!/usr/bin/env node
// GATE SC3 (design/scope/PLAN.md §3 SC3; §2.4).
//
// The three survey-scope tools in src/tools/scope.ts: `set_scope_rule` records
// an owner rule, `record_scope_sorting` records onboarding's sorting of a
// prefix with a cheap cited inventory, and `get_scope` reads back the mode,
// the active rows, the counts and what decides one path. Every fixture is a
// temporary git repository and store this gate builds itself.
//
// Turns red when:
//   - dist/tools/scope.js is absent, or does not export scopeTools carrying
//     set_scope_rule, record_scope_sorting and get_scope;
//   - a rule without owner_words (absent, empty or blank) is accepted, or the
//     refused call leaves a scope_rules row behind; a recorded rule does not
//     keep owner_words verbatim, its session, its action and its normalized
//     pattern; a pattern with `..` is accepted by either writer; a write
//     without an active session is accepted;
//   - set_scope_rule and record_scope_sorting do not return the paths the row
//     now decides at the last reconciled revision (the exact count and list,
//     the revision named), or do not remind the caller to run detect_changes;
//   - a `meta` sorting row is accepted without an inventory (absent or
//     empty), with a citation outside its pattern, or with a citation that
//     lacks a line_range or an excerpt; or a refused call leaves a
//     scope_sorting or scope_inventory row behind;
//   - an inventory excerpt that is not at its lines, a range past the end of
//     the file, or a file absent at the revision is accepted;
//   - an accepted inventory is not written to scope_inventory row for row
//     (sorting id, path, normalized range, excerpt, the reconciled revision),
//     or any inventory row appears in `evidence`;
//   - an inventory on a prefix the owner already excluded is refused;
//   - `supersedes` does not withdraw a rule or a sorting row from get_scope's
//     active rows and from the decision for a path, or a supersedes naming no
//     row, or a row already withdrawn, is accepted;
//   - get_scope does not name the deciding rule or source for a path: an exact
//     owner exclude inside an included prefix, the included prefix itself,
//     gitignore, a meta sorting row, and nothing at all (unsorted in sorted
//     mode); or its counts by source and its unsorted list are not exact;
//   - in a legacy store, the first sorting row does not append exactly one
//     `sorted` scope_mode_changes row and say so, set_scope_rule changes the
//     mode, or a second sorting row appends another; or a sorted store gains
//     a mode row from a sorting row;
//   - test-refusal-parity.mjs does not pass, the register has no entry for
//     the new refusals with onboarding.md as a reference, or
//     scripts/gen-tool-inventory.mjs --check is not clean, or DEVELOPMENT.md's
//     inventory does not list the three tools.
//   - a fixture git command reads the machine's configuration: with a planted
//     global hooks path and template directory, a hook runs (HN1).
//
// Prints exactly one last line: `GATE SC3 GREEN` (exit 0) or
// `GATE SC3 RED: <reason>` (exit 1).

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { citedSource } from "./fixtures/cited-source.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// A crash signature in a red run means the gate never reached its assertion,
// so quoted errors are scrubbed (as test-scope-schema.mjs does).
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
  "TypeError",
  "is not a function",
  "Traceback (most recent call last)",
];
function elide(signature) {
  const cut = Math.ceil(signature.length / 2);
  return `${signature.slice(0, cut)}…${signature.slice(cut)}`;
}
function scrub(text) {
  let out = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  for (const signature of CRASH_SIGNATURES) out = out.split(signature).join(elide(signature));
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

function finish() {
  console.log(`  ran  ${checked} assertion(s)`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  FAIL ${failure}`);
    console.log(
      `GATE SC3 RED: ${failures.length} of ${checked} assertion(s) failed; first: ${failures[0]}`,
    );
    process.exit(1);
  }
  console.log("GATE SC3 GREEN");
  process.exit(0);
}

/** The refusal message of `fn`, or null when it did not refuse. */
function refusal(fn) {
  try {
    const value = fn();
    if (value && typeof value === "object" && value.ok === false) return String(value.error ?? "refused");
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}

// ------------------------------------------------------------------ loading

const mods = {};
try {
  ({ openDatabase: mods.openDatabase } = await import(pathToFileURL(join(here, "dist", "db.js")).href));
  ({ resolveProject: mods.resolveProject, ensureProjectStorage: mods.ensureProjectStorage } =
    await import(pathToFileURL(join(here, "dist", "project.js")).href));
  mods.gitTools = (await import(pathToFileURL(join(here, "dist", "tools", "git.js")).href)).gitTools;
  mods.projectTools = (await import(pathToFileURL(join(here, "dist", "tools", "project.js")).href)).projectTools;
} catch (error) {
  checked++;
  failures.push(`L1 the server build could not be loaded (run npm run build): ${scrub(error?.message)}`);
  finish();
}
try {
  mods.scopeTools = (await import(pathToFileURL(join(here, "dist", "tools", "scope.js")).href)).scopeTools;
} catch {
  checked++;
  failures.push("L2 dist/tools/scope.js is absent: the scope tools are not built");
  finish();
}
check("L3 scopeTools carries set_scope_rule, record_scope_sorting and get_scope", () => {
  if (!Array.isArray(mods.scopeTools)) return "dist/tools/scope.js exports no scopeTools array";
  const names = mods.scopeTools.map((tool) => tool.name).sort();
  const want = ["get_scope", "record_scope_sorting", "set_scope_rule"];
  return JSON.stringify(names) === JSON.stringify(want) ? null : `it carries ${JSON.stringify(names)}`;
});
if (failures.length > 0) finish();

const tools = new Map(
  [...mods.gitTools, ...mods.projectTools, ...mods.scopeTools].map((tool) => [tool.name, tool]),
);
const call = (ctx, name, args) => tools.get(name).handler(args, ctx);

// ------------------------------------------------------------------ fixtures

const scratch = mkdtempSync(join(tmpdir(), "amanuensis-sc3-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
// The fixture's git must not read the machine's configuration: a global
// hooks path or template directory would run something outside this gate.
// A hostile global configuration is planted here, so a fixture command that
// inherits it fails the gate (HN1).
const hostile = join(scratch, "hostile");
for (const dir of [join(hostile, "hooks"), join(hostile, "template", "hooks")]) {
  mkdirSync(dir, { recursive: true });
  for (const hook of ["pre-commit", "commit-msg", "post-commit"]) {
    writeFileSync(join(dir, hook), `#!/bin/sh\necho "${hook} ran" >> '${join(hostile, "ran.log")}'\nexit 1\n`);
    chmodSync(join(dir, hook), 0o755);
  }
}
writeFileSync(
  join(hostile, "gitconfig"),
  `[core]\n\thooksPath = ${join(hostile, "hooks")}\n[init]\n\ttemplateDir = ${join(hostile, "template")}\n`,
);
process.env.GIT_CONFIG_GLOBAL = join(hostile, "gitconfig");
// Every git this gate runs, its fixtures' and the server's own (the store's
// storage commits run in this process), reads no configuration but its
// repository's: no global or system file. HN1 turns red without this.
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";

function git(cwd, ...args) {
  const result = spawnSync(
    "git",
    [
      "-c", "core.hooksPath=/dev/null",
      "-c", "user.email=sc3@localhost", "-c", "user.name=scope-sc3", "-c", "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return String(result.stdout ?? "").trim();
}

const NOTE_LINES = (title) =>
  `${[`# ${title}`, "", `The ${title} records a decision taken in review.`, `Owner: ${title} author.`, "End."].join("\n")}\n`;

const FILES = {
  ".gitignore": "build/\n",
  "src/app.ts": citedSource("app"),
  "src/util.ts": citedSource("util"),
  "notes/plan.md": NOTE_LINES("plan"),
  "notes/review.md": NOTE_LINES("review"),
  "docs/guide.md": NOTE_LINES("guide"),
  "docs/other.md": NOTE_LINES("other"),
};

let worlds = 0;
/** A fresh workspace with one commit (build/out.js force-added under an ignored prefix), a store and a session. */
function world({ reconcile = true, legacy = false } = {}) {
  const ws = join(scratch, `ws-${++worlds}`);
  mkdirSync(ws, { recursive: true });
  git(ws, "init", "-q", "--template=", "-b", "main");
  for (const [path, body] of Object.entries(FILES)) {
    mkdirSync(dirname(join(ws, path)), { recursive: true });
    writeFileSync(join(ws, path), body);
  }
  mkdirSync(join(ws, "build"), { recursive: true });
  writeFileSync(join(ws, "build", "out.js"), "module.exports = 1;\n");
  git(ws, "add", "-A");
  git(ws, "add", "-f", "build/out.js");
  git(ws, "commit", "-q", "--no-verify", "-m", "seed");
  const head = git(ws, "rev-parse", "HEAD");
  const project = mods.resolveProject(ws, { selectionSource: "sc3-scope-tools" });
  mods.ensureProjectStorage(project, (path) => mods.openDatabase(path).close());
  const db = mods.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  process.on("exit", () => {
    try {
      db.close();
    } catch {}
    rmSync(project.storagePath, { recursive: true, force: true });
  });
  if (legacy) {
    db.prepare("INSERT INTO scope_mode_changes (mode, reason) VALUES ('legacy', 'sc3 fixture: surveyed before sorting')").run();
  }
  ctx.sessionId = call(ctx, "start_session", { intent: "sc3" }).session_id;
  if (reconcile) {
    call(ctx, "set_git_state", { canonical_branch: "main", onboarding_sha: head });
    call(ctx, "detect_changes", { current_sha: head });
  }
  return { ctx, ws, head, db };
}

const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOTES_INVENTORY = [
  { file_path: "notes/plan.md", line_range: "3", excerpt: "The plan records a decision taken in review." },
  { file_path: "notes/review.md", line_range: "1-4", excerpt: "# review ... Owner: review author." },
];
const RULE = (extra = {}) => ({
  pattern: "docs/",
  action: "exclude",
  reason: "the owner says the docs are out of date",
  owner_words: "don't survey docs/, it's stale",
  ...extra,
});

// ------------------------------------------------------------------ set_scope_rule

{
  const { ctx, db, head } = world();

  check("R1 a rule without owner_words is refused, and nothing is written", () => {
    const problems = [];
    for (const [label, args] of [
      ["absent", (({ owner_words, ...rest }) => rest)(RULE())],
      ["empty", RULE({ owner_words: "" })],
      ["blank", RULE({ owner_words: "   \n " })],
    ]) {
      const said = refusal(() => call(ctx, "set_scope_rule", args));
      if (said === null) problems.push(`${label} owner_words was accepted`);
      else if (!/owner_words/.test(said)) problems.push(`${label}: the refusal does not name owner_words: ${said}`);
    }
    if (count(db, "scope_rules") !== 0) problems.push(`${count(db, "scope_rules")} scope_rules row(s) were written`);
    return problems.join("; ") || null;
  });

  check("R2 a pattern with .. is refused by both writers", () => {
    const rule = refusal(() => call(ctx, "set_scope_rule", RULE({ pattern: "docs/../src/" })));
    const sorting = refusal(() =>
      call(ctx, "record_scope_sorting", { pattern: "../x/", category: "product", description: "x" }),
    );
    if (rule === null) return "set_scope_rule accepted docs/../src/";
    if (sorting === null) return "record_scope_sorting accepted ../x/";
    return count(db, "scope_rules") + count(db, "scope_sorting") === 0 ? null : "a refused pattern left a row";
  });

  check("R3 a write without an active session is refused", () => {
    const sessionless = { ...ctx, sessionId: null };
    const rule = refusal(() => call(sessionless, "set_scope_rule", RULE()));
    const sorting = refusal(() =>
      call(sessionless, "record_scope_sorting", { pattern: "src/", category: "product", description: "code" }),
    );
    if (rule === null || sorting === null) return `rule: ${rule}; sorting: ${sorting}`;
    return count(db, "scope_rules") + count(db, "scope_sorting") === 0 ? null : "a sessionless write left a row";
  });

  let ruleResponse = null;
  check("R4 a rule is recorded with owner_words verbatim, its session, its action and its normalized pattern", () => {
    ruleResponse = call(ctx, "set_scope_rule", RULE({ pattern: "./docs/" }));
    if (ruleResponse?.ok !== true) return `not recorded: ${JSON.stringify(ruleResponse)}`;
    const row = db.prepare("SELECT * FROM scope_rules").get();
    const want = {
      pattern: "docs/",
      action: "exclude",
      reason: "the owner says the docs are out of date",
      owner_words: "don't survey docs/, it's stale",
      supersedes: null,
      session_id: ctx.sessionId,
    };
    const got = Object.fromEntries(Object.keys(want).map((key) => [key, row?.[key]]));
    if (!same(got, want)) return `row ${JSON.stringify(got)}`;
    return ruleResponse.id === row.id ? null : `the response names id ${ruleResponse.id}, the row is ${row.id}`;
  });

  check("R5 set_scope_rule returns the paths the rule now decides at the reconciled revision, and names detect_changes", () => {
    const covers = ruleResponse?.covers;
    const want = { revision: head, count: 2, paths: ["docs/guide.md", "docs/other.md"] };
    const got = { revision: covers?.revision, count: covers?.count, paths: covers?.paths };
    if (!same(got, want)) return `covers ${JSON.stringify(covers)}`;
    return /detect_changes/.test(JSON.stringify(ruleResponse)) ? null : "the response does not name detect_changes";
  });

  check("R6 an exact exclude inside an included prefix covers only its one path", () => {
    const include = call(ctx, "set_scope_rule", RULE({ pattern: "notes/", action: "include", owner_words: "keep notes/" }));
    const exact = call(ctx, "set_scope_rule", RULE({ pattern: "notes/review.md", owner_words: "but not the review" }));
    const want = [["notes/plan.md", "notes/review.md"], ["notes/review.md"]];
    const got = [include?.covers?.paths, exact?.covers?.paths];
    return same(got, want) ? null : `covers ${JSON.stringify(got)}`;
  });
}

// ------------------------------------------------------------------ record_scope_sorting

{
  const { ctx, db, head } = world();
  const nothingWritten = () =>
    count(db, "scope_sorting") + count(db, "scope_inventory") === 0
      ? null
      : `${count(db, "scope_sorting")} sorting and ${count(db, "scope_inventory")} inventory row(s) were written`;
  const meta = (inventory) => ({
    pattern: "notes/",
    category: "meta",
    description: "plans and reviews of past work",
    ...(inventory === undefined ? {} : { inventory }),
  });

  check("S1 a meta row without an inventory is refused (absent or empty)", () => {
    for (const inventory of [undefined, []]) {
      const said = refusal(() => call(ctx, "record_scope_sorting", meta(inventory)));
      if (said === null) return `accepted with inventory ${JSON.stringify(inventory)}`;
      if (!/inventory/.test(said)) return `the refusal does not name the inventory: ${said}`;
    }
    return nothingWritten();
  });

  check("S2 a meta row citing a file outside its pattern is refused, naming the file", () => {
    const said = refusal(() =>
      call(ctx, "record_scope_sorting", meta([...NOTES_INVENTORY, { file_path: "docs/guide.md", line_range: "1", excerpt: "# guide" }])),
    );
    if (said === null) return "accepted a citation of docs/guide.md under notes/";
    if (!/docs\/guide\.md/.test(said)) return `the refusal does not name docs/guide.md: ${said}`;
    return nothingWritten();
  });

  check("S3 a citation without a line_range or without an excerpt is refused", () => {
    for (const item of [
      { file_path: "notes/plan.md", excerpt: "# plan" },
      { file_path: "notes/plan.md", line_range: "1" },
      { file_path: "notes/plan.md", line_range: "", excerpt: "# plan" },
    ]) {
      const said = refusal(() => call(ctx, "record_scope_sorting", meta([item])));
      if (said === null) return `accepted ${JSON.stringify(item)}`;
    }
    return nothingWritten();
  });

  check("S4 an excerpt not at its lines, a range past the end, or an absent file is refused", () => {
    for (const item of [
      { file_path: "notes/plan.md", line_range: "1", excerpt: "The plan records a decision taken in review." },
      { file_path: "notes/plan.md", line_range: "4-9", excerpt: "Owner: plan author." },
      { file_path: "notes/absent.md", line_range: "1", excerpt: "# absent" },
    ]) {
      const said = refusal(() => call(ctx, "record_scope_sorting", meta([item])));
      if (said === null) return `accepted ${JSON.stringify(item)}`;
    }
    return nothingWritten();
  });

  let accepted = null;
  check("S5 an accepted inventory is written row for row at the reconciled revision", () => {
    accepted = call(ctx, "record_scope_sorting", meta(NOTES_INVENTORY));
    if (accepted?.ok !== true) return `refused: ${JSON.stringify(accepted)}`;
    const sorting = db.prepare("SELECT id, pattern, category, description, supersedes, session_id FROM scope_sorting").all();
    const wantSorting = [
      { id: accepted.id, pattern: "notes/", category: "meta", description: "plans and reviews of past work", supersedes: null, session_id: ctx.sessionId },
    ];
    if (!same(sorting, wantSorting)) return `scope_sorting ${JSON.stringify(sorting)}`;
    const inventory = db
      .prepare("SELECT sorting_id, file_path, line_range, excerpt, ref_sha FROM scope_inventory ORDER BY rowid")
      .all();
    const wantInventory = NOTES_INVENTORY.map((item) => ({
      sorting_id: accepted.id,
      file_path: item.file_path,
      line_range: item.line_range,
      excerpt: item.excerpt,
      ref_sha: head,
    }));
    return same(inventory, wantInventory) ? null : `scope_inventory ${JSON.stringify(inventory)}`;
  });

  check("S6 no inventory row appears in evidence", () => {
    const rows = db.prepare("SELECT file_path, excerpt FROM evidence").all();
    return rows.length === 0 ? null : `evidence holds ${JSON.stringify(rows)}`;
  });

  check("S7 record_scope_sorting returns the paths the row now decides and names detect_changes", () => {
    const want = { revision: head, count: 2, paths: ["notes/plan.md", "notes/review.md"] };
    const covers = accepted?.covers;
    const got = { revision: covers?.revision, count: covers?.count, paths: covers?.paths };
    if (!same(got, want)) return `covers ${JSON.stringify(covers)}`;
    return /detect_changes/.test(JSON.stringify(accepted)) ? null : "the response does not name detect_changes";
  });

  check("S8 a sorted store gains no mode row from a sorting row", () => {
    const modes = db.prepare("SELECT mode FROM scope_mode_changes ORDER BY id").all().map((row) => row.mode);
    return same(modes, ["sorted"]) && !accepted?.mode_change ? null : `modes ${JSON.stringify(modes)}, mode_change ${JSON.stringify(accepted?.mode_change)}`;
  });
}

{
  const { ctx, db } = world();
  check("S9 an inventory on a prefix the owner already excluded is accepted", () => {
    const rule = call(ctx, "set_scope_rule", RULE({ pattern: "notes/", owner_words: "skip notes/" }));
    if (rule?.ok !== true) return `the rule was refused: ${JSON.stringify(rule)}`;
    const sorting = call(ctx, "record_scope_sorting", {
      pattern: "notes/",
      category: "meta",
      description: "plans and reviews",
      inventory: NOTES_INVENTORY,
    });
    if (sorting?.ok !== true) return `refused: ${JSON.stringify(sorting)}`;
    return count(db, "scope_inventory") === 2 ? null : `${count(db, "scope_inventory")} inventory rows`;
  });
}

// ------------------------------------------------------------------ supersedes and get_scope

{
  const { ctx, db, head } = world();
  const scopeOf = (path) => call(ctx, "get_scope", path === undefined ? {} : { path });

  check("U1 supersedes withdraws a rule from the active rows and from the decision for a path", () => {
    const first = call(ctx, "set_scope_rule", RULE());
    const second = call(ctx, "set_scope_rule", RULE({ action: "include", owner_words: "survey docs/ after all", supersedes: first.id }));
    if (second?.ok !== true) return `refused: ${JSON.stringify(second)}`;
    const scope = scopeOf("docs/guide.md");
    const active = (scope?.rules ?? []).map((rule) => rule.id);
    if (!same(active, [second.id])) return `active rules ${JSON.stringify(active)}`;
    const decided = scope?.path?.decided_by;
    if (decided?.kind !== "rule" || decided?.id !== second.id || decided?.action !== "include")
      return `docs/guide.md decided by ${JSON.stringify(decided)}`;
    return scope.path.in_survey === true ? null : `docs/guide.md in_survey ${scope.path.in_survey}`;
  });

  check("U2 supersedes naming no row, or a row already withdrawn, is refused", () => {
    const missing = refusal(() => call(ctx, "set_scope_rule", RULE({ supersedes: 999 })));
    if (missing === null) return "a supersedes naming no rule was accepted";
    const rules = db.prepare("SELECT id FROM scope_rules ORDER BY id").all();
    const withdrawn = refusal(() => call(ctx, "set_scope_rule", RULE({ supersedes: rules[0].id })));
    if (withdrawn === null) return "a rule already withdrawn was superseded a second time";
    const sorting = refusal(() =>
      call(ctx, "record_scope_sorting", { pattern: "src/", category: "product", description: "code", supersedes: 999 }),
    );
    if (sorting === null) return "a sorting supersedes naming no row was accepted";
    return count(db, "scope_rules") === 2 && count(db, "scope_sorting") === 0 ? null : "a refused supersedes left a row";
  });

  check("U3 supersedes withdraws a sorting row", () => {
    const first = call(ctx, "record_scope_sorting", { pattern: "notes/", category: "meta", description: "notes", inventory: NOTES_INVENTORY });
    const second = call(ctx, "record_scope_sorting", { pattern: "notes/", category: "product", description: "notes ship", supersedes: first.id });
    if (second?.ok !== true) return `refused: ${JSON.stringify(second)}`;
    const scope = scopeOf("notes/plan.md");
    const active = (scope?.sorting ?? []).map((row) => row.id);
    if (!same(active, [second.id])) return `active sorting ${JSON.stringify(active)}`;
    const decided = scope?.path?.decided_by;
    return decided?.kind === "sorting" && decided?.id === second.id && decided?.category === "product"
      ? null
      : `notes/plan.md decided by ${JSON.stringify(decided)}`;
  });

  check("G1 get_scope names what decides each kind of path", () => {
    const include = call(ctx, "set_scope_rule", RULE({ pattern: "src/", action: "include", owner_words: "survey src/" }));
    const exact = call(ctx, "set_scope_rule", RULE({ pattern: "src/util.ts", owner_words: "skip util" }));
    const meta = call(ctx, "record_scope_sorting", {
      pattern: "notes/review.md",
      category: "meta",
      description: "a review",
      inventory: [NOTES_INVENTORY[1]],
    });
    const problems = [];
    const expect = (path, want) => {
      const got = scopeOf(path)?.path;
      const slim = {
        in_survey: got?.in_survey,
        source: got?.source ?? null,
        unsorted: got?.unsorted,
        kind: got?.decided_by?.kind ?? null,
        id: got?.decided_by?.id ?? null,
        pattern: got?.decided_by?.pattern ?? null,
      };
      if (!same(slim, want)) problems.push(`${path}: ${JSON.stringify(slim)}`);
    };
    expect("src/util.ts", { in_survey: false, source: "user", unsorted: false, kind: "rule", id: exact.id, pattern: "src/util.ts" });
    expect("src/app.ts", { in_survey: true, source: null, unsorted: true, kind: "rule", id: include.id, pattern: "src/" });
    expect("build/out.js", { in_survey: false, source: "gitignore", unsorted: false, kind: "gitignore", id: null, pattern: null });
    expect("notes/review.md", { in_survey: false, source: "meta", unsorted: false, kind: "sorting", id: meta.id, pattern: "notes/review.md" });
    expect(".gitignore", { in_survey: true, source: null, unsorted: true, kind: null, id: null, pattern: null });
    return problems.join("; ") || null;
  });

  check("G2 get_scope's mode, counts by source and unsorted list are exact", () => {
    const scope = scopeOf();
    const got = {
      mode: scope?.mode,
      revision: scope?.scope?.revision,
      survey_paths: scope?.scope?.survey_paths,
      excluded: scope?.scope?.excluded,
      unsorted: scope?.scope?.unsorted,
      unsorted_paths: scope?.scope?.unsorted_paths,
    };
    const want = {
      mode: "sorted",
      revision: head,
      survey_paths: 5,
      excluded: { gitignore: 1, user: 1, meta: 1 },
      unsorted: 4,
      unsorted_paths: [".gitignore", "docs/guide.md", "docs/other.md", "src/app.ts"],
    };
    return same(got, want) ? null : `got ${JSON.stringify(got)}`;
  });

  check("G3 get_scope writes nothing", () => {
    const before = ["scope_rules", "scope_sorting", "scope_inventory", "scope_mode_changes", "scope_reconciliations"].map((t) => count(db, t));
    scopeOf("src/app.ts");
    const after = ["scope_rules", "scope_sorting", "scope_inventory", "scope_mode_changes", "scope_reconciliations"].map((t) => count(db, t));
    return same(before, after) ? null : `${JSON.stringify(before)} became ${JSON.stringify(after)}`;
  });
}

// ------------------------------------------------------------------ legacy → sorted

{
  const { ctx, db } = world({ legacy: true });
  const modes = () => db.prepare("SELECT mode FROM scope_mode_changes ORDER BY id").all().map((row) => row.mode);

  check("M1 set_scope_rule leaves a legacy store legacy", () => {
    const rule = call(ctx, "set_scope_rule", RULE());
    if (rule?.ok !== true) return `refused: ${JSON.stringify(rule)}`;
    return same(modes(), ["sorted", "legacy"]) && !rule.mode_change ? null : `modes ${JSON.stringify(modes())}`;
  });

  check("M2 the first sorting row moves a legacy store to sorted, appends one mode row and says so", () => {
    const sorting = call(ctx, "record_scope_sorting", { pattern: "src/", category: "product", description: "the product code" });
    if (sorting?.ok !== true) return `refused: ${JSON.stringify(sorting)}`;
    if (!same(modes(), ["sorted", "legacy", "sorted"])) return `modes ${JSON.stringify(modes())}`;
    const change = sorting.mode_change;
    if (change?.from !== "legacy" || change?.to !== "sorted") return `mode_change ${JSON.stringify(change)}`;
    if (!/legacy/.test(String(change?.message ?? "")) || !/sorted/.test(String(change?.message ?? "")))
      return `the response does not say so: ${JSON.stringify(change)}`;
    return call(ctx, "get_scope", {})?.mode === "sorted" ? null : "get_scope does not report sorted";
  });

  check("M3 a second sorting row appends no mode row", () => {
    const sorting = call(ctx, "record_scope_sorting", { pattern: "docs/", category: "product", description: "user docs" });
    if (sorting?.ok !== true) return `refused: ${JSON.stringify(sorting)}`;
    return same(modes(), ["sorted", "legacy", "sorted"]) && !sorting.mode_change ? null : `modes ${JSON.stringify(modes())}`;
  });
}

// ------------------------------------------------------------------ register, parity and inventory

check("P1 the register names the new refusals at both writers, with onboarding.md as a reference", () => {
  const register = JSON.parse(readFileSync(join(here, "contracts", "refusal-parity.json"), "utf8"));
  const entries = register.refusals.filter((entry) => entry.server?.file === "src/tools/scope.ts");
  const problems = [];
  for (const tool of ["set_scope_rule", "record_scope_sorting"]) {
    const mine = entries.filter((entry) => entry.refuses?.includes(tool));
    if (mine.length === 0) problems.push(`no entry refuses ${tool}`);
    for (const entry of mine) {
      if (!entry.references?.some((ref) => /references\/onboarding\.md$/.test(ref.file)))
        problems.push(`${entry.id} does not name onboarding.md`);
    }
  }
  if (!entries.some((entry) => /owner/.test(entry.server.phrase))) problems.push("no entry carries the owner_words refusal");
  if (!entries.some((entry) => /inventory/.test(entry.server.phrase))) problems.push("no entry carries the inventory refusal");
  return problems.join("; ") || null;
});

check("P2 test-refusal-parity.mjs passes", () => {
  const result = spawnSync(process.execPath, ["test-refusal-parity.mjs"], { cwd: here, encoding: "utf8" });
  const last = String(result.stdout ?? "").trim().split("\n").pop();
  return result.status === 0 && /GREEN/.test(last ?? "") ? null : `it ended ${result.status}: ${last}`;
});

check("P3 the tool inventory regenerates with --check clean and lists the three tools", () => {
  const result = spawnSync(process.execPath, ["scripts/gen-tool-inventory.mjs", "--check"], { cwd: here, encoding: "utf8" });
  if (result.status !== 0) return `--check ended ${result.status}: ${String(result.stderr || result.stdout).trim().split("\n").pop()}`;
  const text = readFileSync(join(here, "DEVELOPMENT.md"), "utf8");
  const missing = ["set_scope_rule", "record_scope_sorting", "get_scope"].filter((name) => !text.includes(`| \`${name}\` |`));
  return missing.length === 0 ? null : `DEVELOPMENT.md does not list ${missing.join(", ")}`;
});

check("HN1 no hook from the machine's git configuration ran in a fixture", () => {
  const log = join(hostile, "ran.log");
  return existsSync(log) ? `hooks ran: ${readFileSync(log, "utf8").trim().split("\n").join(", ")}` : null;
});

finish();
