/**
 * Survey scope: which paths of a revision's tree the survey has to account for
 * (design/scope/PLAN.md §2.2, §2.3).
 *
 * The survey set is the tree minus three kinds of excluded path: those the
 * repository's own ignore files match at the revision (`gitignore`), those the
 * owner excluded (`user`), and those onboarding sorted as about the project
 * (`meta`). The owner's rules win over the other two. Everything here is a
 * pure function of its arguments and the revision's objects: the rules and
 * sorting rows come from the caller, and the ignore files come from the commit,
 * never from the working tree, so the survey set is a property of the commit
 * the way the tree digest is.
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ScopeMode } from "./db.js";
import { spawnSync } from "./subprocess.js";

export type ScopeSource = "gitignore" | "user" | "meta";

export type ScopeRuleRow = {
  id: number;
  pattern: string;
  action: "exclude" | "include";
  supersedes?: number | null;
};

export type ScopeSortingRow = {
  id: number;
  pattern: string;
  category: "product" | "meta";
  supersedes?: number | null;
};

/** A pattern §2.2 refuses: `..`, a leading `/`, `.amanuensis/`, an empty or `.` segment. */
export class ScopePatternError extends Error {}

/**
 * §2.2's normal form. A leading `./` is dropped, since it names the same
 * paths; anything else outside the form is refused rather than rewritten, so
 * the pattern recorded is the pattern the owner can read back.
 */
export function normalizePattern(raw: string): string {
  let pattern = raw;
  while (pattern.startsWith("./")) pattern = pattern.slice(2);
  if (pattern.length === 0) throw new ScopePatternError("a scope pattern cannot be empty");
  if (pattern.includes("\u0000"))
    throw new ScopePatternError("a scope pattern cannot contain a NUL byte");
  if (pattern.startsWith("/")) {
    throw new ScopePatternError(`${raw} starts with /; write it relative to the repository root`);
  }
  const segments = (pattern.endsWith("/") ? pattern.slice(0, -1) : pattern).split("/");
  for (const segment of segments) {
    if (segment === "") throw new ScopePatternError(`${raw} has an empty path segment`);
    if (segment === ".") throw new ScopePatternError(`${raw} has a . segment`);
    if (segment === "..") throw new ScopePatternError(`${raw} has a .. segment`);
  }
  if (segments[0] === ".amanuensis") {
    throw new ScopePatternError(
      `${raw} names the store's own directory, which is never part of a survey`,
    );
  }
  return pattern;
}

type CompiledPattern = {
  kind: "exact" | "prefix" | "glob";
  pattern: string;
  regex: RegExp | null;
  /** §2.2's specificity: exact first, then the count of literal characters. */
  rank: [number, number];
};

const compiledPatterns = new Map<string, CompiledPattern>();

function escapeRegex(text: string): string {
  return text.replace(/[\\^$.|?+()[\]{}]/g, "\\$&");
}

/**
 * `*` matches within one segment and `**` across segments, as in gitignore:
 * a `**` segment between two others stands for zero or more segments, a
 * trailing `**` matches everything under the directory but not the directory
 * itself, and a `*` run inside a segment is one `*`. A glob ending in `/`
 * covers everything under what it matches.
 */
function globSource(body: string): string {
  const segments = body.split("/");
  let source = "";
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === "**") {
      source += last ? ".+" : "(?:[^/]+/)*";
      return;
    }
    source += segment.split(/\*+/).map(escapeRegex).join("[^/]*");
    if (!last) source += "/";
  });
  return source;
}

function compilePattern(raw: string): CompiledPattern {
  const known = compiledPatterns.get(raw);
  if (known) return known;
  const pattern = normalizePattern(raw);
  let compiled: CompiledPattern;
  if (pattern.includes("*")) {
    const directory = pattern.endsWith("/");
    const body = directory ? pattern.slice(0, -1) : pattern;
    compiled = {
      kind: "glob",
      pattern,
      regex: new RegExp(`^${globSource(body)}${directory ? "/.+" : ""}$`, "s"),
      rank: [1, pattern.replace(/\*/g, "").length],
    };
  } else if (pattern.endsWith("/")) {
    compiled = { kind: "prefix", pattern, regex: null, rank: [1, pattern.length] };
  } else {
    compiled = { kind: "exact", pattern, regex: null, rank: [2, pattern.length] };
  }
  compiledPatterns.set(raw, compiled);
  return compiled;
}

function matchesCompiled(compiled: CompiledPattern, path: string): boolean {
  switch (compiled.kind) {
    case "exact":
      return path === compiled.pattern;
    case "prefix":
      return path.startsWith(compiled.pattern);
    case "glob":
      return compiled.regex?.test(path) ?? false;
  }
}

/** Whether `pattern` covers `path`. A malformed pattern throws ScopePatternError. */
export function matchesPattern(pattern: string, path: string): boolean {
  return matchesCompiled(compilePattern(pattern), path);
}

/** A rule or sorting row is withdrawn by a later row that supersedes it (§2.1). */
export function activeRows<T extends { id: number; supersedes?: number | null }>(
  rows: readonly T[],
): T[] {
  const superseded = new Set(
    rows.map((row) => row.supersedes).filter((id): id is number => id != null),
  );
  return rows.filter((row) => !superseded.has(row.id));
}

type Prepared<T> = Array<{ row: T; compiled: CompiledPattern }>;

function prepare<T extends { id: number; pattern: string; supersedes?: number | null }>(
  rows: readonly T[],
): Prepared<T> {
  return activeRows(rows).map((row) => ({ row, compiled: compilePattern(row.pattern) }));
}

/** The most specific matching row; between equals, the later one (§2.2). */
function decider<T extends { id: number }>(prepared: Prepared<T>, path: string): T | null {
  let best: Prepared<T>[number] | null = null;
  for (const entry of prepared) {
    if (!matchesCompiled(entry.compiled, path)) continue;
    if (
      best === null ||
      entry.compiled.rank[0] > best.compiled.rank[0] ||
      (entry.compiled.rank[0] === best.compiled.rank[0] &&
        (entry.compiled.rank[1] > best.compiled.rank[1] ||
          (entry.compiled.rank[1] === best.compiled.rank[1] && entry.row.id > best.row.id)))
    ) {
      best = entry;
    }
  }
  return best?.row ?? null;
}

export type ScopeDecider =
  | { kind: "rule"; id: number; action: ScopeRuleRow["action"] }
  | { kind: "gitignore" }
  | { kind: "sorting"; id: number; category: ScopeSortingRow["category"] };

export type PathDecision = {
  in_survey: boolean;
  /** Why the path left the survey set; null while it is in it. */
  source: ScopeSource | null;
  /** The `scope_exclusions.rule_id`: a rule for `user`, a sorting row for `meta`, null otherwise. */
  rule_id: number | null;
  /** What decided the path, or null when nothing covers it. */
  decided_by: ScopeDecider | null;
  /** In `sorted` mode, a path nothing decides: still in the survey set, and still owed a sorting row. */
  unsorted: boolean;
};

export type ScopeInputs = {
  rules: readonly ScopeRuleRow[];
  sorting: readonly ScopeSortingRow[];
  mode: ScopeMode;
};

function decide(
  path: string,
  ignored: boolean,
  rules: Prepared<ScopeRuleRow>,
  sorting: Prepared<ScopeSortingRow>,
  mode: ScopeMode,
): PathDecision {
  const rule = decider(rules, path);
  if (rule) {
    const decided_by: ScopeDecider = { kind: "rule", id: rule.id, action: rule.action };
    return rule.action === "include"
      ? { in_survey: true, source: null, rule_id: null, decided_by, unsorted: false }
      : { in_survey: false, source: "user", rule_id: rule.id, decided_by, unsorted: false };
  }
  if (ignored) {
    return {
      in_survey: false,
      source: "gitignore",
      rule_id: null,
      decided_by: { kind: "gitignore" },
      unsorted: false,
    };
  }
  const row = decider(sorting, path);
  if (row) {
    const decided_by: ScopeDecider = { kind: "sorting", id: row.id, category: row.category };
    return row.category === "meta"
      ? { in_survey: false, source: "meta", rule_id: row.id, decided_by, unsorted: false }
      : { in_survey: true, source: null, rule_id: null, decided_by, unsorted: false };
  }
  return {
    in_survey: true,
    source: null,
    rule_id: null,
    decided_by: null,
    unsorted: mode === "sorted",
  };
}

/**
 * §2.2's precedence for one path: the owner's rules, then gitignore, then
 * sorting. A path an owner rule includes is decided by that rule, so it is not
 * unsorted even when no sorting row covers it.
 */
export function decidePath(path: string, inputs: ScopeInputs & { ignored: boolean }): PathDecision {
  return decide(path, inputs.ignored, prepare(inputs.rules), prepare(inputs.sorting), inputs.mode);
}

export type ScopeExclusion = { file_path: string; source: ScopeSource; rule_id: number | null };

export type ScopeResolution = {
  /** The survey set, sorted. */
  survey: string[];
  /** One row per excluded path, sorted by path: the `scope_exclusions` rows. */
  exclusions: ScopeExclusion[];
  /** Survey paths nothing decides, sorted; empty in `legacy` mode. */
  unsorted: string[];
  counts: Record<ScopeSource, number>;
};

/** The survey set of `paths`, given which of them the revision's ignore files match. */
export function resolveScope(
  inputs: ScopeInputs & { paths: readonly string[]; ignored: ReadonlySet<string> },
): ScopeResolution {
  const rules = prepare(inputs.rules);
  const sorting = prepare(inputs.sorting);
  const resolution: ScopeResolution = {
    survey: [],
    exclusions: [],
    unsorted: [],
    counts: { gitignore: 0, user: 0, meta: 0 },
  };
  for (const path of [...inputs.paths].sort()) {
    const decision = decide(path, inputs.ignored.has(path), rules, sorting, inputs.mode);
    if (decision.source) {
      resolution.exclusions.push({
        file_path: path,
        source: decision.source,
        rule_id: decision.rule_id,
      });
      resolution.counts[decision.source]++;
      continue;
    }
    resolution.survey.push(path);
    if (decision.unsorted) resolution.unsorted.push(path);
  }
  return resolution;
}

// ------------------------------------------------------------------ gitignore at a revision

export type TreeEntry = { mode: string; type: string; object: string; path: string };

/** A git failure: the reconciliation fails and names the command (§2.3), never "nothing ignored". */
export class ScopeGitError extends Error {}

const MAX_GIT_OUTPUT = 256 * 1024 * 1024;

function failure(
  args: readonly string[],
  result: ReturnType<typeof spawnSync>,
  where: string,
): ScopeGitError {
  const detail = result.error
    ? result.error.message
    : String(result.stderr ?? "")
        .trim()
        .split("\n")[0] || `exit status ${result.status}`;
  return new ScopeGitError(`git ${args.join(" ")} failed ${where}: ${detail}`);
}

/** Every entry of the tree at `revision`, from one `git ls-tree -r -z`. */
export function listTreeEntries(workspacePath: string, revision: string): TreeEntry[] {
  const args = ["ls-tree", "-r", "-z", revision];
  const result = spawnSync("git", args, {
    cwd: workspacePath,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw failure(args, result, "in the workspace");
  const entries: TreeEntry[] = [];
  for (const record of String(result.stdout ?? "").split("\u0000")) {
    if (record.length === 0) continue;
    const entry = /^(\S+) (\S+) (\S+)\t(.*)$/s.exec(record);
    if (!entry)
      throw new ScopeGitError(`git ${args.join(" ")} printed an entry it cannot parse: ${record}`);
    const [, mode = "", type = "", object = "", path = ""] = entry;
    entries.push({ mode, type, object, path });
  }
  return entries;
}

function isIgnoreFile(entry: TreeEntry): boolean {
  // Git does not follow a symlinked .gitignore, so neither does this.
  return (
    entry.type === "blob" &&
    entry.mode !== "120000" &&
    (entry.path === ".gitignore" || entry.path.endsWith("/.gitignore"))
  );
}

/**
 * §2.3's cache key: every ignore file's path with its blob id, so a moved or
 * swapped file changes it, and the digest of the tree's path set, so a commit
 * that adds a path the unchanged rules ignore changes it too.
 */
function gitignoreCacheKey(
  entries: readonly TreeEntry[],
  ignoreFiles: readonly TreeEntry[],
): string {
  const pathSet = createHash("sha256")
    .update(
      entries
        .map((entry) => entry.path)
        .sort()
        .join("\u0000"),
    )
    .digest("hex");
  return createHash("sha256")
    .update(ignoreFiles.map((entry) => `${entry.path}\u0000${entry.object}`).join("\n"))
    .update("\u0000\u0000")
    .update(pathSet)
    .digest("hex");
}

const GITIGNORE_CACHE_LIMIT = 16;
const gitignoreCache = new Map<string, readonly string[]>();

/** Forget every cached gitignore resolution. */
export function clearGitignoreCache(): void {
  gitignoreCache.clear();
}

/** The contents of `ids`, in order, from one `git cat-file --batch`. */
function readBlobs(workspacePath: string, ids: readonly string[]): Buffer[] {
  const args = ["cat-file", "--batch"];
  const result = spawnSync("git", args, {
    cwd: workspacePath,
    input: `${ids.join("\n")}\n`,
    maxBuffer: MAX_GIT_OUTPUT,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw failure(args, result, "in the workspace");
  const out = result.stdout as Buffer;
  const blobs: Buffer[] = [];
  let offset = 0;
  for (const id of ids) {
    const newline = out.indexOf(0x0a, offset);
    const header = newline < 0 ? "" : out.subarray(offset, newline).toString("utf8");
    const [, type, size] = header.split(" ");
    if (type !== "blob" || !/^\d+$/.test(size ?? "")) {
      throw new ScopeGitError(
        `git ${args.join(" ")} failed in the workspace: ${id} answered ${header || "nothing"}`,
      );
    }
    const start = newline + 1;
    blobs.push(out.subarray(start, start + Number(size)));
    offset = start + Number(size) + 1;
  }
  return blobs;
}

/** Git's environment without the variables that would point it at another repository. */
function scratchEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
  ]) {
    delete env[name];
  }
  return env;
}

/**
 * The paths of `entries` the tree's own ignore files match, by git's own
 * semantics (negation, anchoring, directory patterns, nested files).
 *
 * The ignore blobs are written into a fresh scratch repository and
 * `git check-ignore --no-index` runs there, so the workspace's working-tree
 * ignore files, its `.git/info/exclude` and any global excludes file play no
 * part: none of them belongs to the commit. `core.ignoreCase` is pinned off so
 * the answer does not depend on the filesystem of the machine that asks. A
 * repeat call with the same key answers from the cache and runs no git; a
 * failure is never cached.
 */
export function gitignoredPaths(workspacePath: string, entries: readonly TreeEntry[]): Set<string> {
  const ignoreFiles = entries
    .filter(isIgnoreFile)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const key = gitignoreCacheKey(entries, ignoreFiles);
  const cached = gitignoreCache.get(key);
  if (cached) return new Set(cached);

  let ignored: string[] = [];
  if (ignoreFiles.length > 0 && entries.length > 0) {
    const blobs = readBlobs(
      workspacePath,
      ignoreFiles.map((entry) => entry.object),
    );
    const scratch = mkdtempSync(join(tmpdir(), "amanuensis-gitignore-"));
    try {
      const env = scratchEnv();
      const initArgs = ["init", "-q", "--template=", scratch];
      const init = spawnSync("git", initArgs, {
        cwd: scratch,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (init.error || init.status !== 0) throw failure(initArgs, init, "in a scratch directory");
      mkdirSync(join(scratch, ".git", "info"), { recursive: true });
      writeFileSync(join(scratch, ".git", "info", "exclude"), "");
      ignoreFiles.forEach((entry, index) => {
        mkdirSync(dirname(join(scratch, entry.path)), { recursive: true });
        writeFileSync(join(scratch, entry.path), blobs[index] ?? "");
      });
      // A submodule is a directory to git; without one on disk a `dir/`
      // pattern would not match it.
      for (const entry of entries) {
        if (entry.type === "commit") mkdirSync(join(scratch, entry.path), { recursive: true });
      }
      const args = [
        "-c",
        "core.excludesFile=/dev/null",
        "-c",
        "core.ignoreCase=false",
        `--git-dir=${join(scratch, ".git")}`,
        `--work-tree=${scratch}`,
        "check-ignore",
        "--no-index",
        "--stdin",
        "-z",
      ];
      const result = spawnSync("git", args, {
        cwd: scratch,
        env,
        input: `${entries.map((entry) => entry.path).join("\u0000")}\u0000`,
        encoding: "utf8",
        maxBuffer: MAX_GIT_OUTPUT,
        stdio: ["pipe", "pipe", "pipe"],
      });
      // check-ignore exits 1 when it matched nothing; anything else is a failure.
      if (result.error || (result.status !== 0 && result.status !== 1)) {
        throw failure(
          ["check-ignore", "--no-index", "--stdin", "-z"],
          result,
          "in a scratch repository",
        );
      }
      ignored = String(result.stdout ?? "")
        .split("\u0000")
        .filter((path) => path.length > 0)
        .sort();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  if (gitignoreCache.size >= GITIGNORE_CACHE_LIMIT) {
    const oldest = gitignoreCache.keys().next().value;
    if (oldest !== undefined) gitignoreCache.delete(oldest);
  }
  gitignoreCache.set(key, ignored);
  return new Set(ignored);
}

/** The survey set at `revision`: its tree, its own ignore files, and the caller's rules and sorting rows. */
export function resolveScopeAtRevision(
  workspacePath: string,
  revision: string,
  inputs: ScopeInputs,
): ScopeResolution & { paths: string[] } {
  const entries = listTreeEntries(workspacePath, revision);
  const paths = entries.map((entry) => entry.path);
  const ignored = gitignoredPaths(workspacePath, entries);
  return { paths, ...resolveScope({ ...inputs, paths, ignored }) };
}
