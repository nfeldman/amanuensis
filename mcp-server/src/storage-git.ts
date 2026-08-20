// Git operations over the storage directory.
//
// The default storage directory (<project>/.amanuensis/) is initialized as an
// independent nested git repo on first open. Callers can commit phase gates,
// session boundaries, or arbitrary markers via commitStorage(). All commits
// are scoped to the storage directory — the surveyed workspace repo is never
// staged or committed.
//
// If git is unavailable (no binary in PATH, init failure, commit failure),
// these operations degrade silently: init becomes a no-op, commit returns
// { ok: false, reason }. Callers should surface that to the caller but
// never crash the server.
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface GitResult {
  ok: boolean;
  reason?: string;
  commit_sha?: string;
  stdout?: string;
}

const GITIGNORE_CONTENTS = [
  "# Automatically managed by amanuensis-memory. Do not edit.",
  "memory.db-journal",
  "memory.db-wal",
  "memory.db-shm",
  "*.tmp",
  ".materializer-lock",
  "",
].join("\n");
const STORAGE_MODE_FILE = ".storage-mode";
const INDEPENDENT_MODE = "independent\n";

// Per-invocation config overrides applied to every amanuensis git call.
// These are passed as `-c key=value` pairs so they don't mutate the
// user's own config in the storage dir. Amanuensis uses a synthetic
// identity and cannot produce signed commits, so we must always disable
// signing — otherwise a user with global commit.gpgsign=true would see
// every amanuensis commit fail.
const AMANUENSIS_GIT_OVERRIDES = [
  "-c",
  "commit.gpgsign=false",
  "-c",
  "tag.gpgsign=false",
  "-c",
  "user.name=amanuensis",
  "-c",
  "user.email=amanuensis@localhost",
];

function runGit(cwd: string, args: string[], input?: string): SpawnSyncReturns<string> {
  // Run git with GIT_TERMINAL_PROMPT=0 so we never hang on credential
  // prompts, and with GIT_OPTIONAL_LOCKS=0 to avoid gc background work.
  // Read-only operations (version, log, rev-parse, diff) don't need the
  // identity overrides but they're cheap to pass unconditionally.
  return spawnSync("git", [...AMANUENSIS_GIT_OVERRIDES, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
    },
    // Don't let git do anything interactive; fail fast.
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// Detect whether a `.git` directory is healthy enough to commit into —
// i.e. HEAD resolves to a commit or to an unborn branch we can commit
// onto. Returns:
//   'ready'          — storage dir IS a git repo and has ≥1 commit
//   'unborn'         — storage dir IS a git repo but no commits yet
//   'nested-ready'   — storage dir is INSIDE an outer git repo with
//                      commits (cloud-mode: a conspectus repo holds
//                      many per-project subdirs under its own .git)
//   'nested-unborn'  — storage dir is inside an outer repo with no
//                      commits yet
//   'broken'         — .git exists but can't even resolve the branch
//   'not-a-repo'     — neither the storage dir nor any ancestor is a
//                      git repo
type RepoState = "ready" | "unborn" | "nested-ready" | "nested-unborn" | "broken" | "not-a-repo";

function repoState(storagePath: string): RepoState {
  if (existsSync(join(storagePath, ".git"))) {
    const head = runGit(storagePath, ["rev-parse", "--verify", "HEAD"]);
    if (head.status === 0) return "ready";
    const symref = runGit(storagePath, ["symbolic-ref", "HEAD"]);
    if (symref.status === 0) return "unborn";
    return "broken";
  }
  // A project-local store must never fall through to its enclosing source
  // repository if nested git initialization was interrupted or failed.
  if (existsSync(join(storagePath, STORAGE_MODE_FILE))) return "not-a-repo";
  // No .git here — are we inside somebody else's repo?
  const inside = runGit(storagePath, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.status === 0 && inside.stdout.trim() === "true") {
    const head = runGit(storagePath, ["rev-parse", "--verify", "HEAD"]);
    return head.status === 0 ? "nested-ready" : "nested-unborn";
  }
  return "not-a-repo";
}

/**
 * True if the storage path is, or is nested inside, a git repo — i.e.
 * commitStorage can operate on it.
 */
export function isGitRepo(storagePath: string): boolean {
  if (existsSync(join(storagePath, ".git"))) return true;
  if (existsSync(join(storagePath, STORAGE_MODE_FILE))) return false;
  const inside = runGit(storagePath, ["rev-parse", "--is-inside-work-tree"]);
  return inside.status === 0 && inside.stdout.trim() === "true";
}

/**
 * Initialize the storage directory as a git repo if it isn't already.
 * Writes a `.gitignore` covering the SQLite WAL/journal files.
 * Idempotent and safe to call on every server start.
 *
 * Handles six starting states. Project-local stores write an independent-mode
 * marker so an interrupted nested initialization can never fall through to
 * the surveyed repository:
 *   - not-a-repo     : run git init + write .gitignore + initial commit
 *   - unborn         : .git exists but no commits. Complete it.
 *   - ready          : .git exists with commits. Ensure .gitignore is
 *                      present. Do not touch the user's config.
 *   - nested-ready   : the storage dir is INSIDE a caller-managed git
 *                      repo with commits (cloud mode: a conspectus
 *                      repo holds many per-project subdirs). Do NOT
 *                      run `git init` here. Commits operate on the outer
 *                      shared-storage repo. (Project-local storage is the
 *                      intentional independent nested-repo exception.)
 *   - nested-unborn  : inside an outer repo with no commits yet. Treat
 *                      like ready; the outer repo's first commit will
 *                      cover our files.
 *   - broken         : .git exists but is malformed. Bail out.
 */
export function ensureStorageRepo(
  storagePath: string,
  options: { independent?: boolean } = {},
): GitResult {
  if (options.independent && !existsSync(join(storagePath, STORAGE_MODE_FILE))) {
    writeFileSync(join(storagePath, STORAGE_MODE_FILE), INDEPENDENT_MODE, "utf8");
  }
  const state = repoState(storagePath);

  if (state === "broken") {
    return { ok: false, reason: "storage .git dir is malformed" };
  }

  // Nested inside an outer repo (cloud-mode conspectus host). The outer
  // repo owns commit history; we stay out of its way. Still write a
  // .gitignore inside the per-project subdir so WAL files never get
  // tracked.
  if (state === "nested-ready" || state === "nested-unborn") {
    writeGitignoreIfMissing(storagePath);
    return {
      ok: true,
      reason: state === "nested-ready" ? "nested in outer repo" : "nested in unborn outer repo",
    };
  }

  if (state === "ready") {
    // Storage dir is its own git repo. Respect the user's config; per-
    // invocation overrides (user.name/email/gpgsign) come from
    // AMANUENSIS_GIT_OVERRIDES so commits always land.
    writeGitignoreIfMissing(storagePath);
    return { ok: true, reason: "already initialized" };
  }

  // Either not-a-repo or unborn — we need to do work.

  // Probe for git presence before trying anything.
  const probe = runGit(storagePath, ["--version"]);
  if (probe.error || probe.status !== 0) {
    return { ok: false, reason: "git binary not available" };
  }

  if (state === "not-a-repo") {
    const init = runGit(storagePath, ["init", "--quiet", "--initial-branch=main"]);
    if (init.status !== 0) {
      // Older git versions don't support --initial-branch; fall back.
      const init2 = runGit(storagePath, ["init", "--quiet"]);
      if (init2.status !== 0) {
        return {
          ok: false,
          reason: `git init failed: ${init2.stderr.trim() || "unknown error"}`,
        };
      }
    }
  }

  writeGitignoreIfMissing(storagePath);

  // Initial commit so subsequent commits have a parent. We reach this
  // block for both fresh init and unborn recovery — both need a root
  // commit. Use --allow-empty in case .gitignore was already tracked
  // somehow (shouldn't happen, but belt-and-suspenders).
  const initialFiles = existsSync(join(storagePath, STORAGE_MODE_FILE))
    ? [".gitignore", STORAGE_MODE_FILE]
    : [".gitignore"];
  runGit(storagePath, ["add", ...initialFiles]);
  const firstCommit = runGit(storagePath, [
    "commit",
    "--quiet",
    "--no-verify",
    "--allow-empty",
    "-m",
    "amanuensis: initialize storage",
  ]);
  if (firstCommit.status !== 0) {
    return {
      ok: false,
      reason: `initial commit failed: ${firstCommit.stderr.trim() || "unknown"}`,
    };
  }
  return { ok: true, reason: state === "unborn" ? "recovered from unborn" : "initialized" };
}

function writeGitignoreIfMissing(storagePath: string): void {
  const p = join(storagePath, ".gitignore");
  if (existsSync(p)) return;
  writeFileSync(p, GITIGNORE_CONTENTS, "utf8");
}

/**
 * Stage all changes under the storage directory and create a commit with
 * the given label. Returns the short SHA on success, or a reason string
 * on failure. Safe to call with no changes (returns ok: true, reason
 * "no changes").
 *
 * The label is passed via stdin using `git commit -F -`, so callers
 * cannot inject extra arguments via message content.
 */
export function commitStorage(storagePath: string, label: string): GitResult {
  if (!isGitRepo(storagePath)) {
    // Caller called commit before init. Treat as a no-op rather than an
    // error — init is best-effort and may have failed for benign reasons.
    return { ok: false, reason: "storage is not a git repo" };
  }
  // Guardrail: label must be a single line, at most 500 chars. This is
  // not about injection (we use -F -) — it's about keeping commit log
  // readable and preventing accidentally-huge messages.
  const trimmed = (label ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "empty commit label" };
  }
  if (trimmed.length > 500) {
    return { ok: false, reason: "commit label exceeds 500 chars" };
  }
  if (trimmed.includes("\n")) {
    return { ok: false, reason: "commit label must be single-line" };
  }

  // Stage everything under this storage dir only. The `.` pathspec
  // scopes the add to cwd and its children — critical in nested mode
  // (cloud-mode shared conspectus repo), where two concurrent surveys
  // of different projects share one outer repo and must not entangle
  // each other's changes.
  const add = runGit(storagePath, ["add", "-A", "."]);
  if (add.status !== 0) {
    return { ok: false, reason: `git add failed: ${add.stderr.trim()}` };
  }

  // Check if there's anything to commit under this storage dir.
  // `git diff --cached --quiet .` exits 0 if no changes, 1 if changes,
  // >1 if error. Scoped to cwd for the same reason as the add.
  const diff = runGit(storagePath, ["diff", "--cached", "--quiet", "."]);
  if (diff.status === 0) {
    return { ok: true, reason: "no changes" };
  }
  if (diff.status !== 1) {
    return { ok: false, reason: `git diff failed: ${diff.stderr.trim()}` };
  }

  // Pass the message via stdin so special characters in the label are
  // never interpreted as args. `-- .` limits the commit to staged
  // changes under cwd; any unrelated staging in the outer repo (e.g.
  // another amanuensis session running concurrently on a different
  // subdir) will remain staged and unaffected.
  const commit = runGit(
    storagePath,
    ["commit", "--quiet", "--no-verify", "-F", "-", "--", "."],
    `${trimmed}\n`,
  );
  if (commit.status !== 0) {
    return {
      ok: false,
      reason: `git commit failed: ${commit.stderr.trim() || "unknown"}`,
    };
  }
  const sha = runGit(storagePath, ["rev-parse", "--short", "HEAD"]);
  return {
    ok: true,
    reason: "committed",
    commit_sha: sha.status === 0 ? sha.stdout.trim() : undefined,
  };
}

/**
 * Return recent storage-dir commits (short SHA, ISO date, first line of
 * the message). Used for history inspection from the agents.
 */
export function getStorageLog(
  storagePath: string,
  limit: number,
): Array<{ sha: string; date: string; message: string }> {
  if (!isGitRepo(storagePath)) return [];
  // Scope to commits that touched this storage dir. In nested mode
  // (shared conspectus repo), this keeps project A's log from showing
  // project B's commits.
  const log = runGit(storagePath, [
    "log",
    `-n${Math.max(1, Math.min(limit, 500))}`,
    "--pretty=format:%h\t%aI\t%s",
    "--",
    ".",
  ]);
  if (log.status !== 0) return [];
  return log.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      // Format is "%h\t%aI\t%s"; the last field can itself contain tabs.
      // We split, then explicitly guard against undefined under
      // noUncheckedIndexedAccess — git always emits at least one tab
      // per line here, but the type system doesn't know that.
      const [sha, date, ...msg] = line.split("\t");
      return {
        sha: sha ?? "",
        date: date ?? "",
        message: msg.join("\t"),
      };
    });
}
