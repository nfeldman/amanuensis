#!/usr/bin/env node
// GATE SC2 (design/scope/PLAN.md §3 SC2; §2.2, §2.3).
//
// Resolution of the survey set, in src/scope.ts: the pattern matcher, the
// precedence between the owner's rules, gitignore and sorting, and gitignore
// read from the commit rather than the working tree. Every fixture is a
// temporary git repository this gate builds itself; it opens no store.
//
// Turns red when:
//   - dist/scope.js is absent or lacks normalizePattern, matchesPattern,
//     decidePath, resolveScope, listTreeEntries, gitignoredPaths,
//     resolveScopeAtRevision or clearGitignoreCache;
//   - a row of the pattern table (more than 30 rows: exact paths, prefixes
//     ending in `/`, `*` within a segment, `**` across segments, whether a
//     whole segment or inside one) matches when it should not or misses when
//     it should;
//   - a pattern containing `..`, a leading `/`, `.amanuensis/` (or the bare
//     `.amanuensis`), an empty segment or `.` segment is accepted, or a
//     leading `./` is not normalized away;
//   - precedence, compared row for row over a golden table:
//       an owner include does not beat gitignore and meta;
//       between owner rules the more specific does not win (an exact exclude
//       recorded before an included prefix must stay excluded, and so must
//       one against a later glob with as many literal characters; a longer
//       prefix beats a shorter one; a glob with more literal characters
//       beats a prefix with fewer, and a prefix with more literal characters
//       beats a longer, later glob with fewer);
//       the later rule does not win a tie;
//       the same rules do not hold among sorting rows (most specific, then
//       later; meta excludes, product keeps);
//       gitignore does not beat sorting;
//       a superseded row still decides;
//       a survey path no sorting row covers, whether an owner include or
//       nothing decides it, is not `unsorted` in sorted mode, or is
//       `unsorted` in legacy mode;
//       resolveScope disagrees with decidePath, or its exclusions are not
//       sorted by path with the source and rule id of their decider;
//   - gitignore at a revision, each compared as the exact ignored set:
//       a negated pattern, a nested .gitignore or a directory pattern is
//       misapplied;
//       an ignore file changed between two commits gives the same set;
//       a commit that adds a tracked path the existing rules ignore, ignore
//       files unchanged, gives the same set (the cache key misses the path set);
//       an identical .gitignore moved to another directory, or two swapped
//       between directories (same paths, same blobs), gives the same set;
//       a working-tree edit to .gitignore, a pattern in .git/info/exclude or a
//       global core.excludesFile changes the set;
//       a tracked path starting with `:` is read as pathspec magic (missed,
//       or the resolution fails);
//       a path that turns from a file into a submodule, or back, keeps the
//       other's set (the cache key misses the entry's kind), or a submodule
//       is not a directory to a `dir/` pattern;
//       ignore files in directories that differ only in case are merged
//       rather than refused;
//       a pattern matches regardless of case;
//       a symlinked .gitignore is read;
//   - a repeat resolution with the same key runs any git command, or a new key
//     runs none;
//   - a git failure (an unknown revision; check-ignore exiting 128) returns a
//     set instead of throwing, or the error does not name the command;
//   - src/scope.ts reaches node:child_process in any form (a named,
//     namespace or default import, a dynamic import, a require) rather than
//     ./subprocess.js, or a stalled git is not cut off by
//     AMANUENSIS_SUBPROCESS_TIMEOUT_MS, or test-subprocess-timeouts.mjs fails.
//
// Prints exactly one last line: `GATE SC2 GREEN` (exit 0) or
// `GATE SC2 RED: <reason>` (exit 1).

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// A crash signature in a red run means the gate never reached its assertion,
// so quoted errors are scrubbed (as test-scope-schema.mjs does).
const CRASH_SIGNATURES = [
  "MODULE_NOT_FOUND",
  "Cannot find module",
  "ModuleNotFoundError",
  "ENOENT",
  "No such file or directory",
  "SyntaxError",
  "ReferenceError",
  "is not defined",
  "ImportError",
  "command not found",
  "Traceback (most recent call last)",
];
function scrub(text) {
  let out = String(text ?? "").replace(/\s+/g, " ").trim();
  for (const signature of CRASH_SIGNATURES) {
    out = out.split(signature).join(`<${signature.replace(/[^A-Za-z]/g, "-")} elided>`);
  }
  return out;
}

const failures = [];
let checked = 0;
function check(label, fn) {
  checked++;
  try {
    const detail = fn();
    if (detail) failures.push(`${label}: ${scrub(detail)}`);
    else console.log(`  ok   ${label}`);
  } catch (error) {
    failures.push(`${label}: threw — ${scrub(error?.message ?? error)}`);
  }
}

function finish(extra) {
  if (extra) failures.unshift(scrub(extra));
  if (failures.length > 0) {
    for (const failure of failures) console.log(`FAIL ${failure}`);
    console.log(`GATE SC2 RED: ${failures.length} of ${Math.max(checked, 1)} check(s) failed; first: ${failures[0].slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`${checked} check(s) held`);
  console.log("GATE SC2 GREEN");
  process.exit(0);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortedList = (set) => [...set].sort();

// --------------------------------------------------------------- loading

const SCOPE_PATH = join(here, "dist", "scope.js");
const EXPORTS = [
  "normalizePattern",
  "matchesPattern",
  "decidePath",
  "resolveScope",
  "listTreeEntries",
  "gitignoredPaths",
  "resolveScopeAtRevision",
  "clearGitignoreCache",
];
let scope;
if (!existsSync(SCOPE_PATH)) finish("dist/scope.js is absent: src/scope.ts has not been written or built");
try {
  scope = await import(pathToFileURL(SCOPE_PATH).href);
} catch (error) {
  finish(`dist/scope.js does not load: ${error?.message ?? error}`);
}
{
  const missing = EXPORTS.filter((name) => typeof scope[name] !== "function");
  if (missing.length) finish(`dist/scope.js lacks ${missing.join(", ")}`);
}

// --------------------------------------------------------------- §2.2 patterns

const MATCHES = [
  // exact paths
  ["src/a.ts", "src/a.ts", true],
  ["src/a.ts", "src/a.tsx", false],
  ["src/a.ts", "src/a.ts/b", false],
  ["src", "src/a.ts", false],
  ["a.b", "axb", false],
  // directory prefixes
  ["design/", "design/spec.md", true],
  ["design/", "design/a/b/c.md", true],
  ["design/", "design", false],
  ["design/", "designs/x.md", false],
  ["design/", "x/design/y", false],
  ["a/b/", "a/b/c", true],
  ["a/b/", "a/bc/d", false],
  ["a+b/", "a+b/c", true],
  // `*` within one segment
  ["*.md", "README.md", true],
  ["*.md", "docs/README.md", false],
  ["docs/*.md", "docs/a.md", true],
  ["docs/*.md", "docs/sub/a.md", false],
  ["docs/*", "docs/a", true],
  ["docs/*", "docs/a/b", false],
  ["*/x.ts", "a/x.ts", true],
  ["*/x.ts", "a/b/x.ts", false],
  ["src/*.test.ts", "src/a.test.ts", true],
  ["src/*.test.ts", "src/a.ts", false],
  ["(x)/*", "(x)/y", true],
  ["*.md", "README.mdx", false],
  // `**` across segments
  ["**/*.md", "README.md", true],
  ["**/*.md", "a/b/c.md", true],
  ["**/*.md", "a/b/c.mdx", false],
  ["docs/**", "docs/a", true],
  ["docs/**", "docs/a/b/c", true],
  ["docs/**", "docs", false],
  ["docs/**", "docsx/a", false],
  ["a/**/b.txt", "a/b.txt", true],
  ["a/**/b.txt", "a/x/y/b.txt", true],
  ["a/**/b.txt", "c/a/x/b.txt", false],
  ["**/fixtures/", "test/fixtures/a.json", true],
  ["**/fixtures/", "fixtures/a.json", true],
  ["**/fixtures/", "test/fixtures", false],
  ["**", "anything/at/all", true],
  // `**` inside a segment still matches across segments (§2.2)
  ["docs/**.md", "docs/nested/spec.md", true],
  ["docs/**.md", "docs/a.md", true],
  ["docs/**.md", "docs/a.mdx", false],
  ["docs/**.md", "other/a.md", false],
  ["a**z", "a/b/z", true],
  ["a**z", "b/a/z", false],
  // A path may carry a newline, which Git tracks; `**` and a directory glob
  // match across it as across any other character (final review, F9/codex).
  ["docs/**.md", "docs/a\nb.md", true],
  ["docs/**", "docs/a\nb", true],
  ["**/*.md", "a\nb/c.md", true],
  ["**/fixtures/", "fixtures/a\nb.json", true],
  ["a**z", "a\n/z", true],
  ["docs/**.md", "docs/a\nb.mdx", false],
];
check(`P1 the pattern table (${MATCHES.length} rows) matches row for row`, () => {
  const wrong = [];
  for (const [pattern, path, expected] of MATCHES) {
    let got;
    try {
      got = scope.matchesPattern(scope.normalizePattern(pattern), path);
    } catch (error) {
      got = `threw ${error?.message ?? error}`;
    }
    if (got !== expected) wrong.push(`${pattern} ~ ${path}: expected ${expected}, got ${got}`);
  }
  return wrong.length ? wrong.join("; ") : null;
});

const REFUSED = [
  "..",
  "../x",
  "a/../b",
  "a/..",
  "/abs",
  "/",
  "",
  ".amanuensis/",
  ".amanuensis/memory.db",
  ".amanuensis",
  ".amanuensis/**",
  "./.amanuensis/x",
  "a//b",
  "a/./b",
];
check(`P2 ${REFUSED.length} malformed patterns are refused`, () => {
  const accepted = [];
  for (const pattern of REFUSED) {
    try {
      const normalized = scope.normalizePattern(pattern);
      accepted.push(`${JSON.stringify(pattern)} → ${JSON.stringify(normalized)}`);
    } catch {
      /* refused, as it should be */
    }
  }
  return accepted.length ? `accepted ${accepted.join(", ")}` : null;
});
check("P3 normalization strips a leading ./ and keeps a well-formed pattern unchanged", () => {
  const cases = [
    ["./src/", "src/"],
    ["././src/a.ts", "src/a.ts"],
    ["src/", "src/"],
    ["**/*.md", "**/*.md"],
  ];
  const wrong = cases
    .map(([raw, want]) => [raw, want, scope.normalizePattern(raw)])
    .filter(([, want, got]) => got !== want)
    .map(([raw, want, got]) => `${raw}: expected ${want}, got ${got}`);
  return wrong.length ? wrong.join("; ") : null;
});

// --------------------------------------------------------------- §2.2 precedence

const RULES = [
  { id: 1, pattern: "design/spec.md", action: "exclude", supersedes: null },
  { id: 2, pattern: "design/", action: "include", supersedes: null },
  { id: 3, pattern: "vendor/ours/", action: "include", supersedes: null },
  { id: 4, pattern: "vendor/", action: "exclude", supersedes: null },
  { id: 5, pattern: "tmp/", action: "exclude", supersedes: null },
  { id: 6, pattern: "tmp/", action: "include", supersedes: null },
  { id: 7, pattern: "notes/", action: "exclude", supersedes: null },
  { id: 8, pattern: "notes/**/*.keep.md", action: "include", supersedes: null },
  { id: 9, pattern: "old/", action: "exclude", supersedes: null },
  { id: 10, pattern: "old/", action: "include", supersedes: 9 },
  { id: 11, pattern: "gone/", action: "exclude", supersedes: null },
  { id: 12, pattern: "never.txt", action: "exclude", supersedes: 11 },
  { id: 13, pattern: "cfg/a.md", action: "exclude", supersedes: null },
  { id: 14, pattern: "cfg/a.md*", action: "include", supersedes: null },
  { id: 15, pattern: "a/bcd/", action: "exclude", supersedes: null },
  { id: 16, pattern: "a/**/*.x", action: "include", supersedes: null },
];
const SORTING = [
  { id: 1, pattern: "design/", category: "meta", supersedes: null },
  { id: 2, pattern: "docs/", category: "meta", supersedes: null },
  { id: 3, pattern: "docs/api/", category: "product", supersedes: null },
  { id: 4, pattern: "bench/", category: "product", supersedes: null },
  { id: 5, pattern: "bench/", category: "meta", supersedes: null },
  { id: 6, pattern: "src/", category: "product", supersedes: null },
  { id: 7, pattern: "build/", category: "product", supersedes: null },
  { id: 8, pattern: "vendor/", category: "product", supersedes: null },
  { id: 9, pattern: "plans/", category: "meta", supersedes: null },
  { id: 10, pattern: "plans/", category: "product", supersedes: 9 },
];
const IGNORED = new Set(["design/gen.txt", "build/out.js", "src/gen.ts", "loose.log"]);

// [path, in_survey, source, rule_id, decided_by kind, unsorted (sorted mode)]
//
// A survey path no sorting row covers is unsorted (§2.2 step 4), even when an
// owner include is what keeps it in: the include decides membership, not
// sorting.
const GOLDEN = [
  ["design/notes.md", true, null, null, "rule", false], // include beats meta
  ["design/gen.txt", true, null, null, "rule", false], // include beats gitignore
  ["design/spec.md", false, "user", 1, "rule", false], // exact beats prefix, though earlier
  ["vendor/ours/a.c", true, null, null, "rule", false], // longer prefix, though earlier
  ["vendor/theirs/b.c", false, "user", 4, "rule", false], // owner exclude beats product
  ["tmp/x", true, null, null, "rule", true], // tie: the later rule; no sorting row covers it
  ["notes/a/b.keep.md", true, null, null, "rule", true], // glob with more literals beats prefix
  ["notes/a/b.md", false, "user", 7, "rule", false],
  ["cfg/a.md", false, "user", 13, "rule", false], // exact beats a later glob with as many literals
  ["a/bcd/f.x", false, "user", 15, "rule", false], // 6 literal characters beat 5, though the glob is longer and later
  ["old/thing", true, null, null, "rule", true], // superseded exclude no longer decides
  ["gone/thing", true, null, null, "none", true], // superseded rule, nothing else covers it
  ["build/out.js", false, "gitignore", null, "gitignore", false], // gitignore beats product
  ["src/gen.ts", false, "gitignore", null, "gitignore", false],
  ["loose.log", false, "gitignore", null, "gitignore", false],
  ["docs/guide.md", false, "meta", 2, "sorting", false],
  ["docs/api/ref.md", true, null, null, "sorting", false], // longer sorting prefix
  ["bench/run.sh", false, "meta", 5, "sorting", false], // sorting tie: the later row
  ["plans/p.md", true, null, null, "sorting", false], // superseded meta row
  ["src/a.ts", true, null, null, "sorting", false],
  ["README.md", true, null, null, "none", true], // unsorted
  ["Makefile", true, null, null, "none", true],
];
const decisionRow = (path, decision) => [
  path,
  decision.in_survey,
  decision.source,
  decision.rule_id,
  decision.decided_by?.kind ?? "none",
  decision.unsorted,
];
check(`R1 precedence in sorted mode matches the golden table row for row (${GOLDEN.length} rows)`, () => {
  const wrong = [];
  for (const expected of GOLDEN) {
    const [path] = expected;
    const decision = scope.decidePath(path, {
      ignored: IGNORED.has(path),
      rules: RULES,
      sorting: SORTING,
      mode: "sorted",
    });
    const got = decisionRow(path, decision);
    if (!same(got, expected)) wrong.push(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  }
  return wrong.length ? wrong.join("; ") : null;
});
check("R2 the deciding rule or row is named by id", () => {
  const wrong = [];
  const probe = (path, kind, id) => {
    const decision = scope.decidePath(path, { ignored: IGNORED.has(path), rules: RULES, sorting: SORTING, mode: "sorted" });
    if (decision.decided_by?.kind !== kind || decision.decided_by?.id !== id) {
      wrong.push(`${path}: expected ${kind} ${id}, got ${JSON.stringify(decision.decided_by)}`);
    }
  };
  probe("design/notes.md", "rule", 2);
  probe("design/spec.md", "rule", 1);
  probe("cfg/a.md", "rule", 13);
  probe("tmp/x", "rule", 6);
  probe("notes/a/b.keep.md", "rule", 8);
  probe("old/thing", "rule", 10);
  probe("docs/api/ref.md", "sorting", 3);
  probe("bench/run.sh", "sorting", 5);
  probe("plans/p.md", "sorting", 10);
  return wrong.length ? wrong.join("; ") : null;
});
check("R3 in legacy mode nothing is unsorted and every other decision is unchanged", () => {
  const wrong = [];
  for (const expected of GOLDEN) {
    const [path] = expected;
    const decision = scope.decidePath(path, { ignored: IGNORED.has(path), rules: RULES, sorting: SORTING, mode: "legacy" });
    const want = [...expected.slice(0, 5), false];
    const got = decisionRow(path, decision);
    if (!same(got, want)) wrong.push(`expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  return wrong.length ? wrong.join("; ") : null;
});
check("R4 resolveScope agrees with decidePath: survey set, exclusions by path with their decider, unsorted", () => {
  const paths = GOLDEN.map(([path]) => path).reverse();
  const result = scope.resolveScope({ paths, ignored: IGNORED, rules: RULES, sorting: SORTING, mode: "sorted" });
  const wantSurvey = GOLDEN.filter((row) => row[1]).map((row) => row[0]).sort();
  const wantExclusions = GOLDEN.filter((row) => !row[1])
    .map(([file_path, , source, rule_id]) => ({ file_path, source, rule_id }))
    .sort((a, b) => (a.file_path < b.file_path ? -1 : a.file_path > b.file_path ? 1 : 0));
  const wantUnsorted = GOLDEN.filter((row) => row[5]).map((row) => row[0]).sort();
  const wantCounts = { gitignore: 3, user: 5, meta: 2 };
  const wrong = [];
  if (!same(result.survey, wantSurvey)) wrong.push(`survey ${JSON.stringify(result.survey)}`);
  if (!same(result.exclusions, wantExclusions)) wrong.push(`exclusions ${JSON.stringify(result.exclusions)}`);
  if (!same(result.unsorted, wantUnsorted)) wrong.push(`unsorted ${JSON.stringify(result.unsorted)}`);
  if (!same(result.counts, wantCounts)) wrong.push(`counts ${JSON.stringify(result.counts)}`);
  return wrong.length ? wrong.join("; ") : null;
});
check("R5 a malformed pattern in a rule is an error, not a silent miss", () => {
  try {
    scope.decidePath("a/b", {
      ignored: false,
      rules: [{ id: 1, pattern: "../a/", action: "exclude", supersedes: null }],
      sorting: [],
      mode: "sorted",
    });
  } catch {
    return null;
  }
  return "a rule with pattern ../a/ was applied without complaint";
});

// --------------------------------------------------------------- §2.3 gitignore at a revision

const REAL_GIT = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
const scratch = mkdtempSync(join(tmpdir(), "amanuensis-scope-resolve-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

function git(cwd, ...args) {
  const result = spawnSync(
    REAL_GIT,
    ["-c", "user.email=t@localhost", "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return String(result.stdout).trim();
}
function put(ws, path, content) {
  mkdirSync(dirname(join(ws, path)), { recursive: true });
  writeFileSync(join(ws, path), content);
}
function commit(ws, message) {
  git(ws, "add", "-A", "-f");
  git(ws, "commit", "-q", "--no-verify", "--allow-empty", "-m", message);
  return git(ws, "rev-parse", "HEAD");
}
function ignoredAt(ws, sha) {
  return sortedList(scope.gitignoredPaths(ws, scope.listTreeEntries(ws, sha)));
}

// A global excludes file the server must not read: every test below runs with
// it in place.
const globalConfig = join(scratch, "gitconfig");
const globalExcludes = join(scratch, "global-excludes");
writeFileSync(globalExcludes, "src/\nREADME.md\n");
writeFileSync(globalConfig, `[core]\n\texcludesFile = ${globalExcludes}\n`);
process.env.GIT_CONFIG_GLOBAL = globalConfig;

const ws = join(scratch, "ws");
mkdirSync(ws);
git(ws, "init", "-q");
put(ws, ".gitignore", "build/\n*.log\n!keep.log\n");
put(ws, "sub/.gitignore", "secret.txt\n/anchored\n");
for (const path of [
  "README.md",
  "src/a.ts",
  "build/out.js",
  "build/deep/x.js",
  "docs/build",
  "a.log",
  "keep.log",
  "sub/x.log",
  "sub/keep.log",
  "sub/secret.txt",
  "secret.txt",
  "sub/anchored",
  "sub/deeper/anchored",
  "anchored",
]) {
  put(ws, path, `${path}\n`);
}
const c1 = commit(ws, "c1");
const C1_IGNORED = ["a.log", "build/deep/x.js", "build/out.js", "sub/anchored", "sub/secret.txt", "sub/x.log"];

put(ws, ".gitignore", "build/\n*.log\n!keep.log\nsrc/\n");
const c2 = commit(ws, "c2: the root .gitignore also ignores src/");
const C2_IGNORED = [...C1_IGNORED, "src/a.ts"].sort();

put(ws, ".gitignore", "build/\n*.log\n!keep.log\n");
const c3base = commit(ws, "c3 base: back to c1's ignore files");
put(ws, "debug.log", "debug\n");
const c3 = commit(ws, "c3: a tracked path the existing rules ignore");

scope.clearGitignoreCache();
check("G1 negation, a nested .gitignore, an anchored pattern and a directory pattern give git's own set", () => {
  const got = ignoredAt(ws, c1);
  return same(got, C1_IGNORED) ? null : `at c1 expected ${JSON.stringify(C1_IGNORED)}, got ${JSON.stringify(got)}`;
});
check("G2 an ignore file changed between two commits gives two different sets", () => {
  const got = ignoredAt(ws, c2);
  return same(got, C2_IGNORED) ? null : `at c2 expected ${JSON.stringify(C2_IGNORED)}, got ${JSON.stringify(got)}`;
});
check("G3 a commit that adds a tracked path the existing rules ignore gives a different set", () => {
  const base = ignoredAt(ws, c3base);
  const added = ignoredAt(ws, c3);
  const wantAdded = [...C1_IGNORED, "debug.log"].sort();
  const wrong = [];
  if (!same(base, C1_IGNORED)) wrong.push(`at c3 base expected ${JSON.stringify(C1_IGNORED)}, got ${JSON.stringify(base)}`);
  if (!same(added, wantAdded)) wrong.push(`at c3 expected ${JSON.stringify(wantAdded)}, got ${JSON.stringify(added)}`);
  return wrong.length ? wrong.join("; ") : null;
});

// Moves: one .gitignore moved, then two swapped (same path set, same blobs).
const mv = join(scratch, "mv");
mkdirSync(mv);
git(mv, "init", "-q");
put(mv, "one/.gitignore", "*.a\n");
put(mv, "two/.gitignore", "*.b\n");
for (const path of ["one/x.a", "one/x.b", "two/x.a", "two/x.b", "three/x.a"]) put(mv, path, `${path}\n`);
const m1 = commit(mv, "m1");
git(mv, "mv", "one/.gitignore", "three/.gitignore");
const m2 = commit(mv, "m2: one/.gitignore moved to three/");
git(mv, "mv", "three/.gitignore", "one/.gitignore");
commit(mv, "m3: moved back");
put(mv, "one/.gitignore", "*.b\n");
put(mv, "two/.gitignore", "*.a\n");
const m4 = commit(mv, "m4: the two ignore files swapped");
check("G4 an identical .gitignore moved to another directory gives a different set", () => {
  const before = ignoredAt(mv, m1);
  const after = ignoredAt(mv, m2);
  const wrong = [];
  if (!same(before, ["one/x.a", "two/x.b"])) wrong.push(`at m1 got ${JSON.stringify(before)}`);
  if (!same(after, ["three/x.a", "two/x.b"])) wrong.push(`at m2 got ${JSON.stringify(after)}`);
  return wrong.length ? wrong.join("; ") : null;
});
check("G5 two ignore files swapped between directories, same paths and same blobs, give a different set", () => {
  const got = ignoredAt(mv, m4);
  return same(got, ["one/x.b", "two/x.a"]) ? null : `at m4 got ${JSON.stringify(got)}`;
});

check("G6 a working-tree edit to .gitignore, .git/info/exclude and a global excludes file change nothing", () => {
  put(ws, ".gitignore", "*\n");
  put(ws, "sub/.gitignore", "");
  writeFileSync(join(ws, ".git", "info", "exclude"), "src/\nREADME.md\nkeep.log\n");
  scope.clearGitignoreCache();
  const wrong = [];
  const atC1 = ignoredAt(ws, c1);
  if (!same(atC1, C1_IGNORED)) wrong.push(`at c1 expected ${JSON.stringify(C1_IGNORED)}, got ${JSON.stringify(atC1)}`);
  const atC2 = ignoredAt(ws, c2);
  if (!same(atC2, C2_IGNORED)) wrong.push(`at c2 expected ${JSON.stringify(C2_IGNORED)}, got ${JSON.stringify(atC2)}`);
  git(ws, "checkout", "-q", "--", ".gitignore", "sub/.gitignore");
  return wrong.length ? wrong.join("; ") : null;
});

check("G7 resolveScopeAtRevision takes gitignore from the revision and the rules from its caller", () => {
  const result = scope.resolveScopeAtRevision(ws, c2, {
    rules: [{ id: 1, pattern: "src/a.ts", action: "include", supersedes: null }],
    sorting: [{ id: 1, pattern: "sub/", category: "meta", supersedes: null }],
    mode: "sorted",
  });
  const wantExclusions = [
    { file_path: "a.log", source: "gitignore", rule_id: null },
    { file_path: "build/deep/x.js", source: "gitignore", rule_id: null },
    { file_path: "build/out.js", source: "gitignore", rule_id: null },
    { file_path: "sub/.gitignore", source: "meta", rule_id: 1 },
    { file_path: "sub/anchored", source: "gitignore", rule_id: null },
    { file_path: "sub/deeper/anchored", source: "meta", rule_id: 1 },
    { file_path: "sub/keep.log", source: "meta", rule_id: 1 },
    { file_path: "sub/secret.txt", source: "gitignore", rule_id: null },
    { file_path: "sub/x.log", source: "gitignore", rule_id: null },
  ];
  // src/a.ts is in by the owner's include, and no sorting row covers it.
  const wantUnsorted = [".gitignore", "README.md", "anchored", "docs/build", "keep.log", "secret.txt", "src/a.ts"];
  const wantSurvey = wantUnsorted;
  const wrong = [];
  if (!same(result.exclusions, wantExclusions)) wrong.push(`exclusions ${JSON.stringify(result.exclusions)}`);
  if (!same(result.unsorted, wantUnsorted)) wrong.push(`unsorted ${JSON.stringify(result.unsorted)}`);
  if (!same(result.survey, wantSurvey)) wrong.push(`survey ${JSON.stringify(result.survey)}`);
  const tree = git(ws, "ls-tree", "-r", "--name-only", c2).split("\n").sort();
  if (!same([...(result.paths ?? [])].sort(), tree)) wrong.push(`paths ${JSON.stringify(result.paths)} are not the tree at c2`);
  return wrong.length ? wrong.join("; ") : null;
});

// Fixtures built through the index, so a path the filesystem cannot hold (a
// gitlink, a symlink, two names differing only in case) is still committed.
function blob(cwd, text) {
  const result = spawnSync(REAL_GIT, ["hash-object", "-w", "--stdin"], { cwd, input: text, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git hash-object: ${result.stderr}`);
  return result.stdout.trim();
}
function commitIndex(cwd, entries, parent) {
  git(cwd, "read-tree", "--empty");
  for (const [mode, object, path] of entries) git(cwd, "update-index", "--add", "--cacheinfo", `${mode},${object},${path}`);
  const tree = git(cwd, "write-tree");
  return git(cwd, "commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", "fixture");
}
const idx = join(scratch, "idx");
mkdirSync(idx);
git(idx, "init", "-q");

check("G8 a tracked path starting with : is checked as a path, not as pathspec magic", () => {
  const lines = blob(idx, "x\n");
  const sha = commitIndex(idx, [
    ["100644", blob(idx, "/:x\n*.q\n"), ".gitignore"],
    ["100644", lines, ":x"],
    ["100644", lines, "x"],
    ["100644", lines, ":(glob)q"],
    ["100644", lines, ":(glob)a.q"],
  ]);
  scope.clearGitignoreCache();
  const got = ignoredAt(idx, sha);
  const want = [":(glob)a.q", ":x"];
  return same(got, want) ? null : `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`;
});

check("G9 a path that turns from a file into a submodule, or back, changes the set under a directory pattern", () => {
  const ignore = blob(idx, "deps/\n");
  const file = commitIndex(idx, [
    ["100644", ignore, ".gitignore"],
    ["100644", blob(idx, "file\n"), "deps"],
  ]);
  const link = commitIndex(idx, [
    ["100644", ignore, ".gitignore"],
    ["160000", file, "deps"],
  ]);
  const wrong = [];
  for (const order of [
    [file, link],
    [link, file],
  ]) {
    scope.clearGitignoreCache();
    for (const sha of order) {
      const got = ignoredAt(idx, sha);
      const want = sha === link ? ["deps"] : [];
      if (!same(got, want)) wrong.push(`${sha === link ? "submodule" : "file"} after ${order[0] === sha ? "nothing" : "the other"}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }
  return wrong.length ? wrong.join("; ") : null;
});

check("G10 ignore files whose directories differ only in case are refused, never merged", () => {
  const lines = blob(idx, "x\n");
  const cases = {
    "two ignore files": [
      ["100644", blob(idx, "*.a\n"), "A/.gitignore"],
      ["100644", blob(idx, "*.b\n"), "a/.gitignore"],
      ["100644", lines, "A/x.a"],
      ["100644", lines, "a/x.a"],
    ],
    "one ignore file and a directory spelled otherwise": [
      ["100644", blob(idx, "*.a\n"), "A/.gitignore"],
      ["100644", lines, "A/x.a"],
      ["100644", lines, "a/x.a"],
    ],
  };
  const wrong = [];
  for (const [what, entries] of Object.entries(cases)) {
    const sha = commitIndex(idx, entries);
    scope.clearGitignoreCache();
    try {
      const got = ignoredAt(idx, sha);
      wrong.push(`${what}: returned ${JSON.stringify(got)}`);
    } catch (error) {
      const message = String(error?.message ?? error);
      if (!message.includes('"A/"') || !message.includes('"a/"') || !/case/.test(message)) wrong.push(`${what}: the refusal does not name both directories and the case: ${message}`);
    }
  }
  return wrong.length ? wrong.join("; ") : null;
});

check("G11 ignore patterns match case-sensitively, whatever the filesystem", () => {
  const lines = blob(idx, "x\n");
  const sha = commitIndex(idx, [
    ["100644", blob(idx, "*.LOG\n"), ".gitignore"],
    ["100644", lines, "a.log"],
    ["100644", lines, "b.LOG"],
  ]);
  scope.clearGitignoreCache();
  const got = ignoredAt(idx, sha);
  return same(got, ["b.LOG"]) ? null : `expected ["b.LOG"], got ${JSON.stringify(got)}`;
});

check("G12 a symlinked .gitignore is not read, as git does not read it", () => {
  const lines = blob(idx, "x\n");
  const sha = commitIndex(idx, [
    ["120000", blob(idx, "secret.dat"), "lnk/.gitignore"],
    ["100644", lines, "lnk/secret.dat"],
    ["100644", lines, "secret.dat"],
  ]);
  scope.clearGitignoreCache();
  const got = ignoredAt(idx, sha);
  return same(got, []) ? null : `expected [], got ${JSON.stringify(got)}`;
});

// --------------------------------------------------------------- the cache and failures

const bin = join(scratch, "bin");
mkdirSync(bin);
const gitLog = join(scratch, "git-calls.log");
const savedPath = process.env.PATH;
function withShim(body, fn) {
  writeFileSync(join(bin, "git"), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, "git"), 0o755);
  process.env.PATH = `${bin}:${savedPath}`;
  try {
    return fn();
  } finally {
    process.env.PATH = savedPath;
  }
}
const logging = `echo "$*" >> '${gitLog}'\nexec '${REAL_GIT}' "$@"`;
const calls = () => (existsSync(gitLog) ? readFileSync(gitLog, "utf8").split("\n").filter(Boolean) : []);

check("C1 a repeat resolution with the same key runs no git command; a new key runs git", () =>
  withShim(logging, () => {
    scope.clearGitignoreCache();
    const e1 = scope.listTreeEntries(ws, c1);
    const e2 = scope.listTreeEntries(ws, c2);
    const wrong = [];
    const before = calls().length;
    if (before === 0) wrong.push("listTreeEntries ran no git through PATH, so the count below proves nothing");
    const first = sortedList(scope.gitignoredPaths(ws, e1));
    const afterFirst = calls().length;
    if (afterFirst === before) wrong.push("the first resolution ran no git command");
    const second = sortedList(scope.gitignoredPaths(ws, e1));
    const afterSecond = calls().length;
    if (afterSecond !== afterFirst) {
      wrong.push(`the repeat resolution ran ${afterSecond - afterFirst} git command(s): ${calls().slice(afterFirst).join(" | ")}`);
    }
    if (!same(first, second) || !same(first, C1_IGNORED)) wrong.push(`repeat gave ${JSON.stringify(second)}`);
    const third = sortedList(scope.gitignoredPaths(ws, e2));
    if (calls().length === afterSecond) wrong.push("a different key ran no git command");
    if (!same(third, C2_IGNORED)) wrong.push(`the different key gave ${JSON.stringify(third)}`);
    const mutated = scope.gitignoredPaths(ws, e1);
    mutated.add("not/ignored");
    if (scope.gitignoredPaths(ws, e1).has("not/ignored")) wrong.push("a caller's change to the returned set reached the cache");
    return wrong.length ? wrong.join("; ") : null;
  }),
);

check("F1 an unknown revision is an error that names the command", () => {
  try {
    const result = scope.resolveScopeAtRevision(ws, "0123456789012345678901234567890123456789", {
      rules: [],
      sorting: [],
      mode: "sorted",
    });
    return `returned ${JSON.stringify(result).slice(0, 120)}`;
  } catch (error) {
    const message = String(error?.message ?? error);
    return /git ls-tree/.test(message) ? null : `the error does not name git ls-tree: ${message}`;
  }
});
check("F2 check-ignore failing is an error that names the command, never an empty set", () =>
  withShim(
    `case "$*" in *check-ignore*) echo "fatal: simulated" >&2; exit 128;; esac\nexec '${REAL_GIT}' "$@"`,
    () => {
      scope.clearGitignoreCache();
      const entries = scope.listTreeEntries(ws, c1);
      try {
        const result = scope.gitignoredPaths(ws, entries);
        return `returned a set of ${result.size}: ${JSON.stringify(sortedList(result))}`;
      } catch (error) {
        const message = String(error?.message ?? error);
        return /check-ignore/.test(message) ? null : `the error does not name git check-ignore: ${message}`;
      }
    },
  ),
);
check("F3 a failure is not cached: the next resolution with the same key runs git and succeeds", () => {
  const got = ignoredAt(ws, c1);
  return same(got, C1_IGNORED) ? null : `got ${JSON.stringify(got)}`;
});
check("F4 reading the ignore blobs failing is an error that names the command", () =>
  withShim(`case "$*" in *cat-file*) echo "fatal: simulated" >&2; exit 128;; esac\nexec '${REAL_GIT}' "$@"`, () => {
    scope.clearGitignoreCache();
    const entries = scope.listTreeEntries(ws, c1);
    try {
      const result = scope.gitignoredPaths(ws, entries);
      return `returned a set of ${result.size}`;
    } catch (error) {
      const message = String(error?.message ?? error);
      return /git cat-file/.test(message) ? null : `the error does not name git cat-file: ${message}`;
    }
  }),
);

// --------------------------------------------------------------- subprocesses

check("S1 src/scope.ts starts subprocesses through src/subprocess.ts", () => {
  const text = readFileSync(join(here, "src", "scope.ts"), "utf8");
  // Any reach for child_process: named, namespace or default import, a
  // dynamic import or a require.
  const direct = text.match(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`](?:node:)?child_process["'`]/g) ?? [];
  if (direct.length) return `it reaches child_process directly: ${direct.join("; ")}`;
  if (!/from\s*"\.\/subprocess\.js"/.test(text)) return "it does not import ./subprocess.js";
  return null;
});
check("S2 a stalled git is cut off by AMANUENSIS_SUBPROCESS_TIMEOUT_MS", () =>
  withShim(`case "$*" in *check-ignore*) exec sleep 30;; esac\nexec '${REAL_GIT}' "$@"`, () => {
    scope.clearGitignoreCache();
    const entries = scope.listTreeEntries(ws, c1);
    process.env.AMANUENSIS_SUBPROCESS_TIMEOUT_MS = "1500";
    const started = Date.now();
    let outcome = "returned";
    try {
      scope.gitignoredPaths(ws, entries);
    } catch {
      outcome = "threw";
    } finally {
      delete process.env.AMANUENSIS_SUBPROCESS_TIMEOUT_MS;
    }
    const took = Date.now() - started;
    if (took > 10_000) return `took ${took} ms against a 1500 ms bound`;
    return outcome === "threw" ? null : "a killed check-ignore returned a set";
  }),
);
check("S3 the existing subprocess gate still passes", () => {
  const env = { ...process.env };
  delete env.GIT_CONFIG_GLOBAL;
  const result = spawnSync(process.execPath, ["test-subprocess-timeouts.mjs"], { cwd: here, encoding: "utf8", env });
  const last = String(result.stdout ?? "").trim().split("\n").pop();
  return result.status === 0 && /SUBPROCESS TIMEOUTS GREEN/.test(last ?? "") ? null : `it ended ${result.status}: ${last}`;
});

finish();
