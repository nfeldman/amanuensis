import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { ensureStorageRepo } from "./storage-git.js";

export interface ProjectContext {
  workspacePath: string;
  projectKey: string;
  storagePath: string;
  dbPath: string;
  storageGitReady: boolean;
}

function safeGitOrigin(workspace: string): string | null {
  try {
    const out = execSync("git remote get-url origin", {
      cwd: workspace,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

function parseOriginUrl(url: string): string | null {
  // Accepts git@github.com:owner/repo(.git)?, https://github.com/owner/repo(.git)?,
  // ssh://git@host/owner/repo(.git)?, and similar patterns. Returns owner/repo.
  const cleaned = url.replace(/\.git$/, "").trim();
  const scpPath = cleaned.match(/^[^@]+@[^:]+:(.+)$/)?.[1];
  if (scpPath) {
    const parts = scpPath.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
  }
  const urlPath = cleaned.match(/^[a-z]+:\/\/[^/]+\/(.+)$/i)?.[1];
  if (urlPath) {
    const parts = urlPath.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
  }
  return null;
}

export function resolveProjectKey(workspace: string): string {
  const origin = safeGitOrigin(workspace);
  if (origin) {
    const parsed = parseOriginUrl(origin);
    if (parsed) return parsed;
  }
  const abs = resolve(workspace);
  const parent = basename(dirname(abs)) || "local";
  const self = basename(abs);
  return `${sanitizeProjectKeySegment(parent)}/${sanitizeProjectKeySegment(self)}`;
}

// Guard: project-key segments become directory names under ~/.amanuensis/
// workspaces/. Refuse anything that could escape via '..', nul bytes, or
// absolute-path prefixes. If a segment contains disallowed characters we
// substitute them with '_' rather than failing — the key still identifies
// the project uniquely enough for storage.
function sanitizeProjectKeySegment(s: string): string {
  if (!s || s === "." || s === "..") return "_";
  // Strip leading slashes, nulls, and drive letters; replace path
  // separators and shell metacharacters with underscores.
  const cleaned = s
    .replace(/\0/g, "")
    .replace(/^[\\/]+/, "")
    .replace(/[\\/]/g, "_")
    .replace(/[\s`$"']/g, "_")
    .replace(/\.\.+/g, "_");
  return cleaned || "_";
}

/**
 * Compute the storage root. Defaults to `~/.amanuensis/workspaces` but
 * can be overridden by the `AMANUENSIS_STORAGE_ROOT` environment
 * variable. The override exists so cloud deployments (e.g. a GitHub
 * Actions workflow surveying a target repo into a shared "conspectus"
 * repo) can write all project storage under a single git-tracked
 * directory instead of the per-user home.
 *
 * If the resolved root is inside an existing git repo (which it will be
 * in the cloud case), `ensureStorageRepo` detects that and skips the
 * per-workspace `git init` — see storage-git.ts.
 */
function resolveStorageRoot(): string {
  const override = process.env.AMANUENSIS_STORAGE_ROOT?.trim();
  if (override) return resolve(override);
  return join(homedir(), ".amanuensis", "workspaces");
}

export function resolveProject(workspace: string): ProjectContext {
  const absWorkspace = resolve(workspace);
  const projectKey = resolveProjectKey(absWorkspace);
  const storagePath = join(resolveStorageRoot(), projectKey);
  mkdirSync(storagePath, { recursive: true });

  // Track the workspace path for collision detection.
  const wsRecord = join(storagePath, "workspace_path");
  if (existsSync(wsRecord)) {
    const prior = readFileSync(wsRecord, "utf8").trim();
    if (prior && prior !== absWorkspace) {
      process.stderr.write(
        `[amanuensis-memory] warning: project key ${projectKey} was previously associated with ${prior}, now opening from ${absWorkspace}. Survey state may not match.\n`,
      );
    }
  }
  writeFileSync(wsRecord, absWorkspace, "utf8");

  // Initialize the storage dir as a git repo on first open. Failures are
  // logged to stderr but do not prevent the server from starting — git
  // is a nice-to-have for history, not load-bearing for DB operations.
  const gitInit = ensureStorageRepo(storagePath);
  if (!gitInit.ok) {
    process.stderr.write(`[amanuensis-memory] storage git init deferred: ${gitInit.reason}\n`);
  }

  return {
    workspacePath: absWorkspace,
    projectKey,
    storagePath,
    dbPath: join(storagePath, "memory.db"),
    storageGitReady: gitInit.ok,
  };
}
