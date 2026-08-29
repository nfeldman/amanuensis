import { execFileSync, execSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  type appendFileSync,
  closeSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { STARTUP_PROBE_TIMEOUT_MS } from "./codex-host.js";
import { ensureStorageRepo, isGitRepo } from "./storage-git.js";

export interface ProjectContext {
  readonly workspacePath: string;
  readonly projectKey: string;
  readonly storagePath: string;
  readonly dbPath: string;
  readonly storageGitReady: boolean;
  readonly bindingReceipt: Readonly<ProjectBindingReceipt>;
}

export interface ProjectBindingReceipt {
  contractVersion: "amanuensis-repository-binding/v1";
  bindingId: string;
  serverInstanceId: string;
  canonicalRoot: string;
  workspaceInstanceId: string;
  projectIdentity: string;
  projectKey: string;
  storageRoot: string;
  storagePath: string;
  storagePolicy: "worktree-local" | "shared-repository-identity";
  selectionSource: string;
  serverVersion: string;
}

export const PROJECT_INITIALIZATION_BOUNDARIES = [
  "parent-git-exclude",
  "storage-parent",
  "abandoned-stage-cleanup",
  "incomplete-store-rollback",
  "staging-directory",
  "project-identity",
  "workspace-path",
  "database-schema",
  "storage-git",
  "completion-marker",
  "atomic-publish",
  "initializer-owner-retirement",
] as const;

export type ProjectInitializationBoundary = (typeof PROJECT_INITIALIZATION_BOUNDARIES)[number];

export interface ProjectInitializationOptions {
  afterMutation?: (boundary: ProjectInitializationBoundary, path: string) => void;
}

export interface ProjectInitializationResult {
  created: boolean;
  recoveredStages: number;
  storageGitReady: boolean;
}

const STORAGE_INITIALIZATION_CONTRACT = "amanuensis-storage-initialization/v1";
const STORAGE_INITIALIZATION_MARKER = "initialization.json";
const STAGING_OWNER_FILE = ".amanuensis-initializer.json";

function safeGitOrigin(workspace: string): string | null {
  try {
    const out = execSync("git remote get-url origin", {
      cwd: workspace,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: STARTUP_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

type ProjectDescriptor = {
  identity: string;
  key: string;
  legacyKey: string;
};

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function parseOriginUrl(url: string): { host: string; path: string[] } | null {
  // Normalize the repository independently of transport and credentials, while
  // retaining the host and complete namespace. This makes ssh/https clones of
  // one repository agree without aliasing github.com/acme/x with gitlab.com/acme/x.
  const cleaned = url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const scp = cleaned.includes("://") ? null : cleaned.match(/^(?:[^@/:]+@)?([^/:]+):(.+)$/);
  if (scp) {
    const path = scp[2]?.split("/").filter(Boolean) ?? [];
    return path.length > 0 && scp[1] ? { host: scp[1].toLowerCase(), path } : null;
  }
  try {
    const parsed = new URL(cleaned);
    if (!parsed.host) return null;
    const path = parsed.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean);
    return path.length > 0 ? { host: parsed.host.toLowerCase(), path } : null;
  } catch {
    return null;
  }
}

function describeProject(workspace: string): ProjectDescriptor {
  const abs = resolve(workspace);
  const origin = safeGitOrigin(abs);
  const parsed = origin ? parseOriginUrl(origin) : null;
  if (parsed) {
    const identity = `remote:${parsed.host}/${parsed.path.join("/")}`;
    const key = [parsed.host, ...parsed.path].map(sanitizeProjectKeySegment).join("/");
    const legacyParts = parsed.path.slice(-2);
    return {
      identity,
      key,
      legacyKey: legacyParts.map(legacySanitizeProjectKeySegment).join("/"),
    };
  }
  const canonical = existsSync(abs) ? realpathSync(abs) : abs;
  const parent = basename(dirname(canonical)) || "local";
  const self = basename(canonical) || "project";
  return {
    identity: `local:${canonical}`,
    key: `local/${sanitizeProjectKeySegment(self)}-${shortHash(canonical)}`,
    legacyKey: `${legacySanitizeProjectKeySegment(parent)}/${legacySanitizeProjectKeySegment(self)}`,
  };
}

export function resolveProjectKey(workspace: string): string {
  return describeProject(workspace).key;
}

// Guard: project-key segments become directory names under an explicit shared
// storage override. Refuse anything that could escape via '..', nul bytes, or
// absolute-path prefixes. If a segment contains disallowed characters we
function sanitizeProjectKeySegment(s: string): string {
  if (!s || s === "." || s === "..") return `_${shortHash(s)}`;
  // Replace path separators, control characters, Windows-reserved path
  // characters, and shell metacharacters with underscores.
  const withoutControls = [...s]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? "_" : character;
    })
    .join("");
  const cleaned = withoutControls.replace(/[\\/:*?"<>|\s`$']/g, "_").replace(/\.\.+/g, "_");
  if (!cleaned) return `_${shortHash(s)}`;
  return cleaned === s ? cleaned : `${cleaned}-${shortHash(s)}`;
}

// v1/v2-preview home and shared stores used only the last two origin segments
// (or parent/basename) and a lossy sanitizer. Keep that algorithm solely for a
// verified one-time migration; never use it to identify a new store.
function legacySanitizeProjectKeySegment(s: string): string {
  if (!s || s === "." || s === "..") return "_";
  const withoutControls = [...s]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? "_" : character;
    })
    .join("");
  return withoutControls.replace(/[\\/:*?"<>|\s`$']/g, "_").replace(/\.\.+/g, "_") || "_";
}

function storagePathUnder(base: string, projectKey: string): string {
  const root = resolve(base);
  const candidate = resolve(root, ...projectKey.split("/"));
  if (candidate === root || !isWithin(root, candidate)) {
    throw new Error(`resolved Amanuensis project key escapes storage root: ${projectKey}`);
  }
  return candidate;
}

function assertNoSymlinkTree(root: string, label: string): void {
  if (!existsSync(root)) return;
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${root}`);
  if (!rootStat.isDirectory()) throw new Error(`${label} is not a directory: ${root}`);
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const child = join(dir, entry);
      const stat = lstatSync(child);
      if (stat.isSymbolicLink()) {
        throw new Error(`${label} contains a symbolic link: ${child}`);
      }
      if (stat.isDirectory()) visit(child);
    }
  };
  visit(root);
}

function normalizeKnownPlatformAlias(path: string): string {
  for (const alias of ["/var", "/tmp", "/etc"]) {
    if (
      (path === alias || path.startsWith(`${alias}${sep}`)) &&
      existsSync(alias) &&
      realpathSync(alias) === `/private${alias}`
    ) {
      return `/private${path}`;
    }
  }
  return path;
}

function canonicalManagedRoot(path: string, label: string): string {
  const lexical = resolve(path);
  const missing: string[] = [];
  let existing = lexical;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    missing.unshift(basename(existing));
    existing = parent;
  }
  if (!existsSync(existing))
    throw new Error(`${label} has no existing filesystem ancestor: ${path}`);
  if (lstatSync(existing).isSymbolicLink()) {
    throw new Error(`${label} traverses a symbolic link: ${existing}`);
  }
  const canonicalExisting = realpathSync(existing);
  if (canonicalExisting !== normalizeKnownPlatformAlias(existing)) {
    throw new Error(`${label} traverses a symbolic link: ${existing} → ${canonicalExisting}`);
  }
  return resolve(canonicalExisting, ...missing);
}

export function assertContainedPath(root: string, target: string, label: string): string {
  const resolvedRoot = canonicalManagedRoot(root, `${label} root`);
  const resolvedTarget = resolve(target);
  if (resolvedTarget === resolvedRoot || !isWithin(resolvedRoot, resolvedTarget)) {
    throw new Error(`${label} escapes its configured root: ${target}`);
  }
  let cursor = resolvedRoot;
  const rel = relative(resolvedRoot, resolvedTarget);
  for (const segment of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) break;
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`${label} traverses a symbolic link: ${cursor}`);
    if (cursor !== resolvedTarget && !stat.isDirectory()) {
      throw new Error(`${label} traverses a non-directory: ${cursor}`);
    }
    if (!isWithin(resolvedRoot, realpathSync(cursor))) {
      throw new Error(`${label} escapes its canonical root: ${cursor}`);
    }
  }
  return resolvedTarget;
}

function writeTextNoFollow(path: string, value: string): void {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, value, "utf8");
  } finally {
    closeSync(fd);
  }
}

function appendTextNoFollow(path: string, value: string): void {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, value, "utf8");
  } finally {
    closeSync(fd);
  }
}

function storageManifest(root: string, relPath = ""): string[] {
  const rows: string[] = [];
  for (const entry of readdirSync(join(root, relPath)).sort()) {
    const childRel = relPath ? join(relPath, entry) : entry;
    const path = join(root, childRel);
    const stat = lstatSync(path);
    if (stat.isDirectory()) rows.push(...storageManifest(root, childRel));
    else if (stat.isSymbolicLink()) rows.push(`L ${childRel} ${readlinkSync(path)}`);
    else if (stat.isFile()) {
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      rows.push(`F ${childRel} ${stat.size} ${digest}`);
    }
  }
  return rows;
}

export function migrateLegacyStorage(
  legacyPath: string,
  localPath: string,
  operations: {
    renameLegacy?: typeof renameSync;
    beforeStageCopy?: () => void;
    afterStageCopy?: (stagedPath: string) => void;
    beforeSourceManifest?: () => void;
    beforeReconcileManifest?: (candidatePath: string) => void;
  } = {},
): "none" | "moved" | "conflict" {
  assertNoSymlinkTree(legacyPath, "legacy Amanuensis storage");
  assertNoSymlinkTree(localPath, "destination Amanuensis storage");
  const retireLegacy = () => {
    try {
      rmSync(legacyPath, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(
        `[amanuensis-memory] migrated legacy storage but could not remove ${legacyPath}: ${(error as Error).message}\n`,
      );
    }
  };
  const reconcileExisting = (candidatePath: string): "moved" | "conflict" => {
    try {
      operations.beforeReconcileManifest?.(candidatePath);
      if (
        JSON.stringify(storageManifest(candidatePath)) !==
        JSON.stringify(storageManifest(localPath))
      ) {
        return "conflict";
      }
    } catch (error) {
      if (!existsSync(candidatePath) && existsSync(localPath)) {
        assertNoSymlinkTree(localPath, "destination Amanuensis storage");
        return "moved";
      }
      throw error;
    }
    retireLegacy();
    return "moved";
  };

  if (!existsSync(legacyPath)) return "none";
  if (existsSync(localPath)) return reconcileExisting(legacyPath);
  try {
    (operations.renameLegacy ?? renameSync)(legacyPath, localPath);
  } catch {
    // A concurrent process may have completed the move after our initial
    // checks. Treat that as success without touching the destination.
    if (!existsSync(legacyPath) && existsSync(localPath)) return "moved";
    if (existsSync(localPath)) return reconcileExisting(legacyPath);
    const migrationRoot = mkdtempSync(join(dirname(localPath), ".amanuensis-migration-"));
    const stagedPath = join(migrationRoot, "store");
    try {
      // Cross-filesystem moves cannot use rename(2). Copy to a sibling staging
      // directory, read every file back by content hash, then atomically rename
      // the verified copy into place. A failed copy never touches localPath.
      operations.beforeStageCopy?.();
      cpSync(legacyPath, stagedPath, { recursive: true, errorOnExist: true });
      operations.afterStageCopy?.(stagedPath);
      if (!existsSync(legacyPath) && existsSync(localPath)) {
        // Another starter atomically completed the migration while this copy
        // was staging. Its destination is now authoritative; adopt it.
        return "moved";
      }
      let source: string[];
      try {
        operations.beforeSourceManifest?.();
        source = storageManifest(legacyPath);
      } catch (error) {
        // The source can disappear between the preceding existence check and
        // manifest traversal when another process completes the cutover.
        if (!existsSync(legacyPath) && existsSync(localPath)) return "moved";
        throw error;
      }
      const destination = storageManifest(stagedPath);
      if (JSON.stringify(source) !== JSON.stringify(destination)) {
        throw new Error("copied storage failed content read-back");
      }
      if (existsSync(localPath)) {
        return reconcileExisting(stagedPath);
      }
      try {
        renameSync(stagedPath, localPath);
      } catch (error) {
        if (existsSync(localPath)) return reconcileExisting(stagedPath);
        throw error;
      }
      retireLegacy();
    } catch (error) {
      if (!existsSync(legacyPath) && existsSync(localPath)) {
        assertNoSymlinkTree(localPath, "destination Amanuensis storage");
        return "moved";
      }
      throw new Error(
        `could not migrate legacy Amanuensis storage from ${legacyPath}: ${(error as Error).message}`,
      );
    } finally {
      rmSync(migrationRoot, { recursive: true, force: true });
    }
  }
  return "moved";
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function excludeLocalStorageFromWorkspaceGit(
  workspace: string,
  storagePath: string,
  operations: { append?: typeof appendFileSync; preflightOnly?: boolean } = {},
): void {
  let gitRoot: string;
  try {
    gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: STARTUP_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    }).trim();
  } catch {
    // A non-Git project has no parent index to protect.
    return;
  }
  try {
    if (!gitRoot) return;
    // Git canonicalizes paths (notably /var → /private/var on macOS), while
    // Node preserves the caller's spelling. Compare real paths so an alias
    // cannot make an in-repository store look external.
    const canonicalGitRoot = realpathSync(gitRoot);
    const canonicalWorkspace = realpathSync(workspace);
    const canonicalStoragePath = resolve(
      canonicalWorkspace,
      relative(resolve(workspace), storagePath),
    );
    if (!isWithin(canonicalGitRoot, canonicalStoragePath)) return;
    const rawExclude = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: STARTUP_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    }).trim();
    if (!rawExclude) return;
    const excludePath = isAbsolute(rawExclude) ? rawExclude : resolve(workspace, rawExclude);
    const rawCommonRoot = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: STARTUP_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    }).trim();
    if (!rawCommonRoot) throw new Error("Git returned no common metadata directory");
    const commonRoot = realpathSync(
      isAbsolute(rawCommonRoot) ? rawCommonRoot : resolve(workspace, rawCommonRoot),
    );
    assertContainedPath(commonRoot, excludePath, "parent Git exclude");
    const relativeStorage = relative(canonicalGitRoot, canonicalStoragePath).split(sep).join("/");
    const pattern = `/${relativeStorage}`;
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", relativeStorage], {
      cwd: canonicalGitRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: STARTUP_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    if (tracked.status === 0) {
      throw new Error(`${relativeStorage} is already tracked by the surveyed repository`);
    }
    if (tracked.status !== 1) {
      throw new Error(`could not inspect the parent Git index: ${tracked.stderr.trim()}`);
    }
    if (operations.preflightOnly) return;
    mkdirSync(dirname(excludePath), { recursive: true });
    assertContainedPath(commonRoot, excludePath, "parent Git exclude");
    const prior = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
    if (!prior.split(/\r?\n/).includes(pattern)) {
      const separator = prior.length === 0 || prior.endsWith("\n") ? "" : "\n";
      if (operations.append) {
        operations.append(excludePath, `${separator}${pattern}\n`, "utf8");
      } else {
        appendTextNoFollow(excludePath, `${separator}${pattern}\n`);
      }
    }
    const ignored = spawnSync(
      "git",
      ["check-ignore", "--quiet", "--no-index", "--", relativeStorage],
      {
        cwd: canonicalGitRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: STARTUP_PROBE_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
    );
    if (ignored.status !== 0) {
      throw new Error(`parent Git exclude did not take effect: ${ignored.stderr.trim()}`);
    }
  } catch (error) {
    throw new Error(
      `cannot isolate project-local .amanuensis from the surveyed repository: ${(error as Error).message}`,
    );
  }
}

function readOptionalRecord(path: string): string | null {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Amanuensis control record must be a regular file: ${path}`);
  }
  return readFileSync(path, "utf8").trim() || null;
}

function workspaceProvesIdentity(path: string, workspace: string, identity: string): boolean {
  if (resolve(path) === workspace) return true;
  try {
    return (
      lstatSync(path).isDirectory() && describeProject(realpathSync(path)).identity === identity
    );
  } catch {
    return false;
  }
}

function storageProvesIdentity(storagePath: string, workspace: string, identity: string): boolean {
  assertNoSymlinkTree(storagePath, "Amanuensis storage");
  const recordedIdentity = readOptionalRecord(join(storagePath, "project_identity"));
  if (recordedIdentity) return recordedIdentity === identity;
  const recordedWorkspace = readOptionalRecord(join(storagePath, "workspace_path"));
  return (
    recordedWorkspace !== null && workspaceProvesIdentity(recordedWorkspace, workspace, identity)
  );
}

function assertStorageIdentity(
  storagePath: string,
  workspace: string,
  identity: string,
  shared: boolean,
): void {
  if (!existsSync(storagePath)) return;
  assertNoSymlinkTree(storagePath, "Amanuensis storage");
  const identityPath = join(storagePath, "project_identity");
  const workspacePath = join(storagePath, "workspace_path");
  const recordedIdentity = readOptionalRecord(identityPath);
  const recordedWorkspace = readOptionalRecord(workspacePath);
  if (recordedIdentity && recordedIdentity !== identity) {
    throw new Error(
      `Amanuensis storage identity collision at ${storagePath}: expected ${identity}, found ${recordedIdentity}`,
    );
  }
  if (
    !recordedIdentity &&
    recordedWorkspace &&
    !workspaceProvesIdentity(recordedWorkspace, workspace, identity)
  ) {
    throw new Error(
      `Amanuensis storage at ${storagePath} belongs to an unverified workspace: ${recordedWorkspace}`,
    );
  }
  if (!recordedIdentity && !recordedWorkspace && readdirSync(storagePath).length > 0) {
    throw new Error(
      `${shared ? "shared " : ""}Amanuensis storage at ${storagePath} has no verifiable project identity`,
    );
  }
}

function migrateVerifiedStore(
  legacyPath: string,
  destination: string,
  workspace: string,
  identity: string,
): "none" | "moved" | "conflict" | "unverified" {
  if (!existsSync(legacyPath)) return "none";
  if (!storageProvesIdentity(legacyPath, workspace, identity)) return "unverified";
  return migrateLegacyStorage(legacyPath, destination);
}

export function resolveProject(
  workspace: string,
  options: { selectionSource?: string; serverVersion?: string } = {},
): ProjectContext {
  const requestedWorkspace = resolve(workspace);
  if (!existsSync(requestedWorkspace) || !lstatSync(requestedWorkspace).isDirectory()) {
    throw new Error(`workspace is not a directory: ${requestedWorkspace}`);
  }
  const absWorkspace = realpathSync(requestedWorkspace);
  const descriptor = describeProject(absWorkspace);
  const projectKey = descriptor.key;
  const override = process.env.AMANUENSIS_STORAGE_ROOT?.trim();
  const storageRoot = override
    ? canonicalManagedRoot(resolve(override), "configured Amanuensis storage root")
    : absWorkspace;
  const storagePath = override
    ? storagePathUnder(storageRoot, projectKey)
    : join(absWorkspace, ".amanuensis");
  const independentStorage = isWithin(absWorkspace, storagePath);
  assertContainedPath(storageRoot, storagePath, "Amanuensis storage");
  assertNoSymlinkTree(storagePath, "Amanuensis storage");
  if (independentStorage && existsSync(storagePath)) {
    excludeLocalStorageFromWorkspaceGit(absWorkspace, storagePath, { preflightOnly: true });
  }
  assertStorageIdentity(storagePath, absWorkspace, descriptor.identity, Boolean(override));

  const receiptFields = {
    contractVersion: "amanuensis-repository-binding/v1" as const,
    canonicalRoot: absWorkspace,
    workspaceInstanceId: shortHash(absWorkspace),
    projectIdentity: descriptor.identity,
    projectKey,
    storageRoot,
    storagePath,
    storagePolicy: override ? ("shared-repository-identity" as const) : ("worktree-local" as const),
    selectionSource: options.selectionSource ?? "direct-api",
    serverVersion: options.serverVersion ?? "unknown",
  };
  const bindingReceipt = Object.freeze({
    ...receiptFields,
    bindingId: createHash("sha256").update(JSON.stringify(receiptFields)).digest("hex"),
    serverInstanceId: randomUUID(),
  });
  return Object.freeze({
    workspacePath: absWorkspace,
    projectKey,
    storagePath,
    dbPath: join(storagePath, "memory.db"),
    storageGitReady: existsSync(storagePath) && isGitRepo(storagePath),
    bindingReceipt,
  });
}

type InitializeDatabase = (dbPath: string) => void;

type StorageInitializationMarker = {
  contractVersion: typeof STORAGE_INITIALIZATION_CONTRACT;
  projectIdentity: string;
  projectKey: string;
  storagePolicy: ProjectBindingReceipt["storagePolicy"];
  canonicalRoot: string | null;
  workspaceInstanceId: string | null;
  database: "memory.db";
};

function expectedStorageMarker(project: ProjectContext): StorageInitializationMarker {
  const local = project.bindingReceipt.storagePolicy === "worktree-local";
  return {
    contractVersion: STORAGE_INITIALIZATION_CONTRACT,
    projectIdentity: project.bindingReceipt.projectIdentity,
    projectKey: project.projectKey,
    storagePolicy: project.bindingReceipt.storagePolicy,
    canonicalRoot: local ? project.workspacePath : null,
    workspaceInstanceId: local ? project.bindingReceipt.workspaceInstanceId : null,
    database: "memory.db",
  };
}

function readJsonRecord(path: string, label: string): Record<string, unknown> {
  if (!existsSync(path)) throw new Error(`${label} is absent: ${path}`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular file: ${path}`);
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("top level is not an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${(error as Error).message}`);
  }
}

function initializationMarkerPath(storagePath: string): string {
  return join(storagePath, STORAGE_INITIALIZATION_MARKER);
}

function validateStorageMarker(project: ProjectContext, storagePath = project.storagePath): void {
  const marker = readJsonRecord(
    initializationMarkerPath(storagePath),
    "Amanuensis storage completion marker",
  );
  const expected = expectedStorageMarker(project);
  const expectedKeys = Object.keys(expected).sort();
  const markerKeys = Object.keys(marker).sort();
  const matches =
    markerKeys.length === expectedKeys.length &&
    markerKeys.every((key, index) => key === expectedKeys[index]) &&
    expectedKeys.every((key) => marker[key] === expected[key as keyof StorageInitializationMarker]);
  if (!matches) {
    throw new Error(
      `Amanuensis storage completion marker does not match the immutable repository binding: ${storagePath}`,
    );
  }
  const databasePath = join(storagePath, expected.database);
  if (!existsSync(databasePath) || !lstatSync(databasePath).isFile()) {
    throw new Error(
      `Amanuensis storage completion marker names a missing database: ${databasePath}`,
    );
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    writeTextNoFollow(temporary, `${JSON.stringify(value)}\n`);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function cleanupAbandonedStages(
  project: ProjectContext,
  afterMutation?: ProjectInitializationOptions["afterMutation"],
): number {
  const parent = dirname(project.storagePath);
  if (!existsSync(parent)) return 0;
  const prefix = `${basename(project.storagePath)}.initializing-`;
  let recovered = 0;
  for (const name of readdirSync(parent)
    .filter((entry) => entry.startsWith(prefix))
    .sort()) {
    const stagePath = join(parent, name);
    const ownerPath = join(stagePath, STAGING_OWNER_FILE);
    let owner: Record<string, unknown>;
    try {
      assertContainedPath(project.bindingReceipt.storageRoot, stagePath, "initialization staging");
      assertNoSymlinkTree(stagePath, "Amanuensis initialization staging");
      owner = readJsonRecord(ownerPath, "Amanuensis initialization owner");
    } catch {
      // Unknown or attacker-controlled siblings are never adopted or deleted.
      continue;
    }
    if (
      owner.contractVersion !== STORAGE_INITIALIZATION_CONTRACT ||
      owner.targetStoragePath !== project.storagePath ||
      owner.projectIdentity !== project.bindingReceipt.projectIdentity ||
      typeof owner.pid !== "number" ||
      processIsAlive(owner.pid)
    ) {
      continue;
    }
    rmSync(stagePath, { recursive: true, force: true });
    recovered++;
    afterMutation?.("abandoned-stage-cleanup", stagePath);
  }
  return recovered;
}

function incompleteStoreCanRollBack(project: ProjectContext): boolean {
  if (!existsSync(project.storagePath)) return false;
  const allowed = new Set(["project_identity", "workspace_path"]);
  return readdirSync(project.storagePath).every((name) => allowed.has(name));
}

function ensureExistingProjectStorage(
  project: ProjectContext,
  initializeDatabase: InitializeDatabase,
  recoveredStages: number,
  afterMutation?: ProjectInitializationOptions["afterMutation"],
): ProjectInitializationResult | null {
  if (!existsSync(project.storagePath)) return null;
  assertStorageIdentity(
    project.storagePath,
    project.workspacePath,
    project.bindingReceipt.projectIdentity,
    project.bindingReceipt.storagePolicy === "shared-repository-identity",
  );
  const markerPath = initializationMarkerPath(project.storagePath);
  if (existsSync(markerPath)) {
    validateStorageMarker(project);
    const initializerOwner = join(project.storagePath, STAGING_OWNER_FILE);
    if (existsSync(initializerOwner)) {
      rmSync(initializerOwner);
      afterMutation?.("initializer-owner-retirement", initializerOwner);
    }
  } else if (!existsSync(project.dbPath)) {
    if (!incompleteStoreCanRollBack(project)) {
      throw new Error(
        `incomplete Amanuensis storage has no database; preserving it for diagnosis: ${project.storagePath}`,
      );
    }
    rmSync(project.storagePath, { recursive: true, force: true });
    afterMutation?.("incomplete-store-rollback", project.storagePath);
    return null;
  }

  if (existsSync(project.storagePath)) {
    // Existing v2 stores predate the completion marker. Run the idempotent
    // schema initializer and publish the marker only after read-back succeeds.
    initializeDatabase(project.dbPath);
    if (!existsSync(markerPath)) {
      writeJsonAtomic(markerPath, expectedStorageMarker(project));
      afterMutation?.("completion-marker", markerPath);
    }
    validateStorageMarker(project);
    const gitInit = ensureStorageRepo(project.storagePath, {
      independent: project.bindingReceipt.storagePolicy === "worktree-local",
    });
    if (!gitInit.ok) {
      process.stderr.write(`[amanuensis-memory] storage git init deferred: ${gitInit.reason}\n`);
    }
    return { created: false, recoveredStages, storageGitReady: gitInit.ok };
  }
  return null;
}

export function isProjectStorageInitialized(project: ProjectContext): boolean {
  assertProjectBinding(project);
  if (!existsSync(project.storagePath) || !existsSync(project.dbPath)) return false;
  const marker = initializationMarkerPath(project.storagePath);
  if (existsSync(marker)) validateStorageMarker(project);
  return true;
}

export function ensureProjectStorage(
  project: ProjectContext,
  initializeDatabase: InitializeDatabase,
  options: ProjectInitializationOptions = {},
): ProjectInitializationResult {
  assertProjectBinding(project);
  const { afterMutation } = options;
  const independent = project.bindingReceipt.storagePolicy === "worktree-local";
  if (independent) {
    excludeLocalStorageFromWorkspaceGit(project.workspacePath, project.storagePath);
    afterMutation?.("parent-git-exclude", project.storagePath);
  }

  const storageParent = dirname(project.storagePath);
  if (!existsSync(storageParent)) {
    mkdirSync(storageParent, { recursive: true });
    afterMutation?.("storage-parent", storageParent);
  }
  const recoveredStages = cleanupAbandonedStages(project, afterMutation);

  const descriptor = describeProject(project.workspacePath);
  const legacyRoot =
    project.bindingReceipt.storagePolicy === "shared-repository-identity"
      ? project.bindingReceipt.storageRoot
      : join(homedir(), ".amanuensis", "workspaces");
  const legacyPath = storagePathUnder(legacyRoot, descriptor.legacyKey);
  if (legacyPath !== project.storagePath && existsSync(legacyPath)) {
    assertContainedPath(legacyRoot, legacyPath, "legacy Amanuensis storage");
    const migration = migrateVerifiedStore(
      legacyPath,
      project.storagePath,
      project.workspacePath,
      project.bindingReceipt.projectIdentity,
    );
    if (migration === "moved") {
      process.stderr.write(
        `[amanuensis-memory] migrated legacy storage ${legacyPath} → ${project.storagePath}\n`,
      );
    } else if (migration === "conflict") {
      process.stderr.write(
        `[amanuensis-memory] warning: both ${legacyPath} and ${project.storagePath} contain different storage; preserving both and using the configured destination\n`,
      );
    } else if (migration === "unverified") {
      process.stderr.write(
        `[amanuensis-memory] warning: legacy storage ${legacyPath} does not prove identity ${project.bindingReceipt.projectIdentity}; preserving it without migration\n`,
      );
    }
  }

  const existing = ensureExistingProjectStorage(
    project,
    initializeDatabase,
    recoveredStages,
    afterMutation,
  );
  if (existing) return existing;

  const stagePath = join(
    storageParent,
    `${basename(project.storagePath)}.initializing-${process.pid}-${randomUUID()}`,
  );
  assertContainedPath(project.bindingReceipt.storageRoot, stagePath, "initialization staging");
  let published = false;
  try {
    mkdirSync(stagePath);
    writeTextNoFollow(
      join(stagePath, STAGING_OWNER_FILE),
      `${JSON.stringify({
        contractVersion: STORAGE_INITIALIZATION_CONTRACT,
        pid: process.pid,
        targetStoragePath: project.storagePath,
        projectIdentity: project.bindingReceipt.projectIdentity,
      })}\n`,
    );
    afterMutation?.("staging-directory", stagePath);

    writeTextNoFollow(join(stagePath, "project_identity"), project.bindingReceipt.projectIdentity);
    afterMutation?.("project-identity", join(stagePath, "project_identity"));
    writeTextNoFollow(join(stagePath, "workspace_path"), project.workspacePath);
    afterMutation?.("workspace-path", join(stagePath, "workspace_path"));

    initializeDatabase(join(stagePath, "memory.db"));
    afterMutation?.("database-schema", join(stagePath, "memory.db"));

    const gitInit = ensureStorageRepo(stagePath, { independent });
    if (!gitInit.ok) {
      process.stderr.write(`[amanuensis-memory] storage git init deferred: ${gitInit.reason}\n`);
    }
    afterMutation?.("storage-git", stagePath);

    writeJsonAtomic(initializationMarkerPath(stagePath), expectedStorageMarker(project));
    afterMutation?.("completion-marker", initializationMarkerPath(stagePath));

    try {
      renameSync(stagePath, project.storagePath);
      published = true;
    } catch (error) {
      if (!existsSync(project.storagePath)) throw error;
      const concurrent = ensureExistingProjectStorage(
        project,
        initializeDatabase,
        recoveredStages,
        afterMutation,
      );
      if (!concurrent) throw error;
      return concurrent;
    }
    afterMutation?.("atomic-publish", project.storagePath);
    validateStorageMarker(project);
    const initializerOwner = join(project.storagePath, STAGING_OWNER_FILE);
    rmSync(initializerOwner);
    afterMutation?.("initializer-owner-retirement", initializerOwner);
    return { created: true, recoveredStages, storageGitReady: gitInit.ok };
  } finally {
    if (!published && existsSync(stagePath)) {
      rmSync(stagePath, { recursive: true, force: true });
    }
  }
}

export function assertProjectBinding(project: ProjectContext): void {
  const receipt = project.bindingReceipt;
  if (
    project.workspacePath !== receipt.canonicalRoot ||
    project.projectKey !== receipt.projectKey ||
    project.storagePath !== receipt.storagePath ||
    project.dbPath !== join(receipt.storagePath, "memory.db")
  ) {
    throw new Error("Amanuensis process repository binding was mutated after startup");
  }
  if (realpathSync(project.workspacePath) !== receipt.canonicalRoot) {
    throw new Error(`bound workspace identity changed after startup: ${project.workspacePath}`);
  }
  const currentDescriptor = describeProject(receipt.canonicalRoot);
  if (
    currentDescriptor.identity !== receipt.projectIdentity ||
    currentDescriptor.key !== receipt.projectKey
  ) {
    throw new Error("bound repository identity changed after startup");
  }
  assertContainedPath(receipt.storageRoot, receipt.storagePath, "bound Amanuensis storage");
  assertNoSymlinkTree(receipt.storagePath, "bound Amanuensis storage");
  assertStorageIdentity(
    receipt.storagePath,
    receipt.canonicalRoot,
    receipt.projectIdentity,
    receipt.storagePolicy === "shared-repository-identity",
  );
  if (existsSync(initializationMarkerPath(receipt.storagePath))) {
    validateStorageMarker(project);
  }
}

export function resolveStorageOutputPath(
  project: ProjectContext,
  requestedPath: string,
  label: string,
): string {
  assertProjectBinding(project);
  const absolute = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(project.storagePath, requestedPath);
  return assertContainedPath(project.storagePath, absolute, label);
}
