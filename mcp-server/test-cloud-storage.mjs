#!/usr/bin/env node
// Adversarial correctness probes for cloud-mode storage: the
// AMANUENSIS_STORAGE_ROOT override that redirects project-local storage
// into a shared conspectus root, and the nested-repo
// detection that keeps a shared conspectus repo from getting nested
// `.git` directories.
//
// The shared-conspectus-repo pattern works like this:
//
//   conspectus-repo/         <- outer git repo (checked out in CI)
//   ├── .git/
//   ├── workspaces/          <- AMANUENSIS_STORAGE_ROOT points here
//   │   ├── host/owner/projectA/  <- collision-resistant repository identity
//   │   │   ├── memory.db
//   │   │   └── docs/
//   │   └── host/owner/projectB/
//   └── README.md
//
// Each survey invocation sets AMANUENSIS_STORAGE_ROOT to the outer
// repo's `workspaces/` dir and points --workspace at whatever target
// repo is being surveyed. The MCP server sees the storage dir is
// already inside a git worktree, skips its own `git init`, and
// commits against the outer repo — scoped to the project subdir so
// two concurrent surveys never entangle.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
let failed = 0;
function t(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${label}\n       ${e.message}`);
    failed++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function loadModules() {
  // The modules cache process.env at import time for things we don't
  // care about, but resolveStorageRoot reads AMANUENSIS_STORAGE_ROOT
  // fresh on every call. So we can set it per-test and still share the
  // same import.
  return await import("./dist/project.js");
}

function makeConspectusRepo() {
  const root = mkdtempSync(join(tmpdir(), "conspectus-"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  spawnSync("git", ["config", "user.email", "t@t"], { cwd: root });
  spawnSync("git", ["config", "user.name", "t"], { cwd: root });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# conspectus\n");
  spawnSync("git", ["add", "."], { cwd: root });
  spawnSync("git", ["commit", "-q", "--no-verify", "-m", "seed"], { cwd: root });
  return root;
}

function makeTargetRepo() {
  const ws = mkdtempSync(join(tmpdir(), "target-"));
  spawnSync("git", ["init", "-q"], { cwd: ws });
  writeFileSync(join(ws, "main.ts"), "export const x = 1;\n");
  spawnSync("git", ["add", "."], { cwd: ws });
  spawnSync("git", ["config", "user.email", "t@t"], { cwd: ws });
  spawnSync("git", ["config", "user.name", "t"], { cwd: ws });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: ws });
  spawnSync("git", ["commit", "-q", "--no-verify", "-m", "seed"], { cwd: ws });
  return ws;
}

const {
  ensureProjectStorage,
  excludeLocalStorageFromWorkspaceGit,
  migrateLegacyStorage,
  resolveProject: resolveProjectBinding,
  resolveProjectKey,
} = await loadModules();
const { openDatabase } = await import("./dist/db.js");
const { commitStorage, isGitRepo, getStorageLog } = await import("./dist/storage-git.js");

function resolveProject(workspace) {
  const project = resolveProjectBinding(workspace);
  ensureProjectStorage(project, (databasePath) => {
    const database = openDatabase(databasePath);
    database.close();
  });
  return project;
}

// ---- 1. Storage-root override ----
t("AMANUENSIS_STORAGE_ROOT redirects storage out of the project", () => {
  const conspectus = makeConspectusRepo();
  const target = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const project = resolveProject(target);
    assert(
      project.storagePath.startsWith(join(realpathSync(conspectus), "workspaces")),
      `storagePath should live under conspectus/workspaces, got: ${project.storagePath}`,
    );
    assert(
      !project.storagePath.includes("/.amanuensis/"),
      "explicit shared storage should not use project-local .amanuensis",
    );
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- 2. Nested storage dir: no nested .git ----
t("storage inside a conspectus repo gets NO nested .git", () => {
  const conspectus = makeConspectusRepo();
  const target = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const project = resolveProject(target);
    assert(
      !existsSync(join(project.storagePath, ".git")),
      "nested .git was created — outer repo would become confused",
    );
    // The storage dir is still recognized as "in a git repo" for
    // commit purposes.
    assert(isGitRepo(project.storagePath), "isGitRepo should return true for nested dirs");
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- 3. Commits land in the OUTER repo ----
t("commitStorage on nested dir lands in the conspectus repo", () => {
  const conspectus = makeConspectusRepo();
  const target = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const project = resolveProject(target);
    const db = openDatabase(project.dbPath);
    db.prepare(
      "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha) VALUES ('default','main','abc')",
    ).run();
    db.close();
    const r = commitStorage(project.storagePath, "cloud-mode phase-gate test");
    assert(r.ok, `commit should succeed: ${r.reason}`);
    assert(r.reason === "committed", `expected committed, got: ${r.reason}`);
    // Verify the commit is on the outer repo's log.
    const log = spawnSync("git", ["log", "--oneline", "-n", "5"], {
      cwd: conspectus,
      encoding: "utf8",
    }).stdout;
    assert(log.includes("cloud-mode phase-gate test"), `commit not on outer log: ${log}`);
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- 4. Two concurrent surveys don't entangle ----
t("two surveys on different projects commit independently", () => {
  const conspectus = makeConspectusRepo();
  const targetA = makeTargetRepo();
  const targetB = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const projA = resolveProject(targetA);
    const projB = resolveProject(targetB);
    // Touch A, touch B, commit A — B's staged change should not be
    // pulled into A's commit.
    writeFileSync(join(projA.storagePath, "a-only.txt"), "A");
    writeFileSync(join(projB.storagePath, "b-only.txt"), "B");
    const rA = commitStorage(projA.storagePath, "commit A only");
    assert(rA.ok && rA.reason === "committed", `A should commit: ${rA.reason}`);
    // Inspect that commit's tree to confirm b-only.txt is NOT in it.
    const show = spawnSync("git", ["show", "--name-only", "--pretty=format:", "HEAD"], {
      cwd: conspectus,
      encoding: "utf8",
    }).stdout;
    assert(show.includes("a-only.txt"), `A's file should be in commit: ${show}`);
    assert(!show.includes("b-only.txt"), `B's file leaked into A's commit: ${show}`);
    // Now commit B.
    const rB = commitStorage(projB.storagePath, "commit B only");
    assert(rB.ok && rB.reason === "committed", `B should commit: ${rB.reason}`);
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(targetA, { recursive: true, force: true });
    rmSync(targetB, { recursive: true, force: true });
  }
});

// ---- 5. get_storage_history is scoped to the project subdir ----
t("getStorageLog shows only commits that touched the project subdir", () => {
  const conspectus = makeConspectusRepo();
  const targetA = makeTargetRepo();
  const targetB = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const projA = resolveProject(targetA);
    const projB = resolveProject(targetB);
    writeFileSync(join(projA.storagePath, "a.txt"), "A");
    commitStorage(projA.storagePath, "touched A");
    writeFileSync(join(projB.storagePath, "b.txt"), "B");
    commitStorage(projB.storagePath, "touched B");
    const logA = getStorageLog(projA.storagePath, 10);
    const msgsA = logA.map((c) => c.message);
    assert(
      msgsA.some((m) => m.includes("touched A")),
      `A's log missing its own commit: ${msgsA}`,
    );
    assert(!msgsA.some((m) => m.includes("touched B")), `A's log leaked B's commit: ${msgsA}`);
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(targetA, { recursive: true, force: true });
    rmSync(targetB, { recursive: true, force: true });
  }
});

// ---- 6. Default behavior is project-local and isolated from source git ----
t("without AMANUENSIS_STORAGE_ROOT, storage is <project>/.amanuensis", () => {
  const target = makeTargetRepo();
  try {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    const before = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: target,
      encoding: "utf8",
    }).stdout.trim();
    const project = resolveProject(target);
    assert(project.storagePath === join(realpathSync(target), ".amanuensis"));
    assert(existsSync(join(project.storagePath, ".git")), "local storage lacks independent git");
    const excludePath = spawnSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd: target,
      encoding: "utf8",
    }).stdout.trim();
    const excludeBody = readFileSync(
      excludePath.startsWith("/") ? excludePath : join(target, excludePath),
      "utf8",
    );
    assert(
      excludeBody.split(/\r?\n/).includes("/.amanuensis"),
      `local exclude missing: ${excludeBody}`,
    );
    writeFileSync(join(project.storagePath, "local.txt"), "local");
    const committed = commitStorage(project.storagePath, "project-local checkpoint");
    assert(committed.ok, `local checkpoint failed: ${committed.reason}`);
    const after = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: target,
      encoding: "utf8",
    }).stdout.trim();
    assert(after === before, "storage checkpoint committed the surveyed repository");
    const status = spawnSync("git", ["status", "--porcelain"], {
      cwd: target,
      encoding: "utf8",
    }).stdout;
    assert(status === "", `project-local storage polluted source git status: ${status}`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- 7. Legacy home storage migration is content-preserving ----
t("legacy storage moves into the project without losing nested content", () => {
  const root = mkdtempSync(join(tmpdir(), "storage-migration-"));
  const legacy = join(root, "legacy", "owner", "project");
  const local = join(root, "workspace", ".amanuensis");
  try {
    mkdirSync(join(legacy, "docs"), { recursive: true });
    mkdirSync(join(root, "workspace"), { recursive: true });
    writeFileSync(join(legacy, "memory.db"), "database-bytes");
    writeFileSync(join(legacy, "docs", "index.md"), "# retained\n");
    assert(migrateLegacyStorage(legacy, local) === "moved", "migration did not run");
    assert(!existsSync(legacy), "legacy storage still exists after migration");
    assert(readFileSync(join(local, "memory.db"), "utf8") === "database-bytes");
    assert(readFileSync(join(local, "docs", "index.md"), "utf8") === "# retained\n");
    assert(migrateLegacyStorage(legacy, local) === "none", "migration was not idempotent");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

t("cross-filesystem migration verifies a staged copy before cutover", () => {
  const root = mkdtempSync(join(tmpdir(), "storage-copy-migration-"));
  const legacy = join(root, "legacy");
  const local = join(root, "workspace", ".amanuensis");
  let renameAttempted = false;
  try {
    mkdirSync(join(legacy, "nested"), { recursive: true });
    mkdirSync(join(root, "workspace"), { recursive: true });
    writeFileSync(join(legacy, "memory.db"), "copied-database");
    writeFileSync(join(legacy, "nested", "note.md"), "copied-note");
    const result = migrateLegacyStorage(legacy, local, {
      renameLegacy() {
        renameAttempted = true;
        throw new Error("simulated EXDEV");
      },
    });
    assert(renameAttempted, "test did not exercise the copy fallback");
    assert(result === "moved", "copy migration did not complete");
    assert(!existsSync(legacy), "verified source was not retired");
    assert(readFileSync(join(local, "memory.db"), "utf8") === "copied-database");
    assert(readFileSync(join(local, "nested", "note.md"), "utf8") === "copied-note");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

t("copy read-back turns red before cutover and preserves legacy bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "storage-corrupt-migration-"));
  const legacy = join(root, "legacy");
  const local = join(root, "workspace", ".amanuensis");
  try {
    mkdirSync(legacy, { recursive: true });
    mkdirSync(join(root, "workspace"), { recursive: true });
    writeFileSync(join(legacy, "memory.db"), "authoritative-bytes");
    let message = "";
    try {
      migrateLegacyStorage(legacy, local, {
        renameLegacy() {
          throw new Error("simulated EXDEV");
        },
        afterStageCopy(stagedPath) {
          writeFileSync(join(stagedPath, "memory.db"), "corrupted-copy");
        },
      });
    } catch (error) {
      message = error.message;
    }
    assert(message.includes("failed content read-back"), `mismatch gate stayed green: ${message}`);
    assert(!existsSync(local), "corrupt staged copy reached the project-local path");
    assert(readFileSync(join(legacy, "memory.db"), "utf8") === "authoritative-bytes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

t("divergent dual stores are both preserved and reported as a conflict", () => {
  const root = mkdtempSync(join(tmpdir(), "storage-collision-"));
  const legacy = join(root, "legacy");
  const local = join(root, "workspace", ".amanuensis");
  try {
    mkdirSync(legacy, { recursive: true });
    mkdirSync(local, { recursive: true });
    writeFileSync(join(legacy, "memory.db"), "legacy-state");
    writeFileSync(join(local, "memory.db"), "local-state");
    assert(migrateLegacyStorage(legacy, local) === "conflict", "divergence was not surfaced");
    assert(readFileSync(join(legacy, "memory.db"), "utf8") === "legacy-state");
    assert(readFileSync(join(local, "memory.db"), "utf8") === "local-state");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

t("dual-store reconciliation adopts a local store when another starter retires legacy", () => {
  const root = mkdtempSync(join(tmpdir(), "storage-reconcile-race-"));
  const legacy = join(root, "legacy");
  const local = join(root, "workspace", ".amanuensis");
  try {
    mkdirSync(legacy, { recursive: true });
    mkdirSync(local, { recursive: true });
    writeFileSync(join(legacy, "memory.db"), "shared-state");
    writeFileSync(join(local, "memory.db"), "shared-state");
    const result = migrateLegacyStorage(legacy, local, {
      beforeReconcileManifest(candidatePath) {
        if (candidatePath === legacy) rmSync(legacy, { recursive: true, force: true });
      },
    });
    assert(result === "moved", `reconciliation race was not adopted: ${result}`);
    assert(readFileSync(join(local, "memory.db"), "utf8") === "shared-state");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

t("a concurrent identical cutover is adopted without split state", () => {
  const root = mkdtempSync(join(tmpdir(), "storage-race-"));
  const legacy = join(root, "legacy");
  const local = join(root, "workspace", ".amanuensis");
  try {
    mkdirSync(legacy, { recursive: true });
    mkdirSync(join(root, "workspace"), { recursive: true });
    writeFileSync(join(legacy, "memory.db"), "shared-state");
    const result = migrateLegacyStorage(legacy, local, {
      renameLegacy() {
        throw new Error("simulated EXDEV");
      },
      afterStageCopy() {
        renameSync(legacy, local);
      },
    });
    assert(result === "moved", `concurrent identical cutover was not adopted: ${result}`);
    assert(!existsSync(legacy), "identical legacy copy was not retired");
    assert(readFileSync(join(local, "memory.db"), "utf8") === "shared-state");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

t("a source disappearance during manifest traversal adopts the concurrent cutover", () => {
  const root = mkdtempSync(join(tmpdir(), "storage-manifest-race-"));
  const legacy = join(root, "legacy");
  const local = join(root, "workspace", ".amanuensis");
  try {
    mkdirSync(legacy, { recursive: true });
    mkdirSync(join(root, "workspace"), { recursive: true });
    writeFileSync(join(legacy, "memory.db"), "shared-state");
    const result = migrateLegacyStorage(legacy, local, {
      renameLegacy() {
        throw new Error("simulated EXDEV");
      },
      beforeSourceManifest() {
        renameSync(legacy, local);
      },
    });
    assert(result === "moved", `manifest race was not adopted: ${result}`);
    assert(readFileSync(join(local, "memory.db"), "utf8") === "shared-state");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

t("a source disappearance during cross-filesystem copy adopts the concurrent cutover", () => {
  const root = mkdtempSync(join(tmpdir(), "storage-copy-race-"));
  const legacy = join(root, "legacy");
  const local = join(root, "workspace", ".amanuensis");
  try {
    mkdirSync(legacy, { recursive: true });
    mkdirSync(join(root, "workspace"), { recursive: true });
    writeFileSync(join(legacy, "memory.db"), "shared-state");
    const result = migrateLegacyStorage(legacy, local, {
      renameLegacy() {
        throw new Error("simulated EXDEV");
      },
      beforeStageCopy() {
        renameSync(legacy, local);
      },
    });
    assert(result === "moved", `copy race was not adopted: ${result}`);
    assert(readFileSync(join(local, "memory.db"), "utf8") === "shared-state");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

t("project-local storage refuses a symlink escape without touching its target", () => {
  const target = makeTargetRepo();
  const outside = mkdtempSync(join(tmpdir(), "amanuensis-storage-escape-"));
  try {
    symlinkSync(outside, join(target, ".amanuensis"), "dir");
    let message = "";
    try {
      resolveProject(target);
    } catch (error) {
      message = error.message;
    }
    assert(message.includes("symbolic link"), `symlink escape was not rejected: ${message}`);
    assert(readdirSync(outside).length === 0, "storage wrote through the project symlink");
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

t("legacy migration refuses symlinked storage trees", () => {
  const root = mkdtempSync(join(tmpdir(), "amanuensis-legacy-symlink-"));
  const legacy = join(root, "legacy");
  const local = join(root, "workspace", ".amanuensis");
  const outside = join(root, "outside");
  try {
    mkdirSync(legacy, { recursive: true });
    mkdirSync(join(root, "workspace"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "memory.db"), "outside");
    symlinkSync(join(outside, "memory.db"), join(legacy, "memory.db"));
    let message = "";
    try {
      migrateLegacyStorage(legacy, local);
    } catch (error) {
      message = error.message;
    }
    assert(message.includes("symbolic link"), `legacy symlink was not rejected: ${message}`);
    assert(!existsSync(local), "symlinked legacy storage reached the destination");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

t("repository keys include host and full namespace without lossy aliases", () => {
  const roots = [];
  const makeWithOrigin = (origin) => {
    const workspace = makeTargetRepo();
    roots.push(workspace);
    spawnSync("git", ["remote", "add", "origin", origin], { cwd: workspace });
    return workspace;
  };
  try {
    const github = makeWithOrigin("https://github.com/acme/platform/widget.git");
    const gitlab = makeWithOrigin("git@gitlab.com:acme/platform/widget.git");
    const sshClone = makeWithOrigin("git@github.com:acme/platform/widget.git");
    const lossyA = makeWithOrigin("git@example.test:owner a/widget.git");
    const lossyB = makeWithOrigin("git@example.test:owner_a/widget.git");
    assert(resolveProjectKey(github) !== resolveProjectKey(gitlab), "different hosts aliased");
    assert(resolveProjectKey(github) === resolveProjectKey(sshClone), "transports disagreed");
    assert(resolveProjectKey(lossyA) !== resolveProjectKey(lossyB), "lossy names aliased");
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});

t("shared storage permits verified clones and rejects incompatible identity", () => {
  const shared = mkdtempSync(join(tmpdir(), "amanuensis-shared-identity-"));
  const first = makeTargetRepo();
  const clone = makeTargetRepo();
  try {
    for (const workspace of [first, clone]) {
      spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/widget.git"], {
        cwd: workspace,
      });
    }
    process.env.AMANUENSIS_STORAGE_ROOT = shared;
    const original = resolveProject(first);
    const reopened = resolveProject(clone);
    assert(
      reopened.storagePath === original.storagePath,
      "same-repository clones did not converge",
    );
    writeFileSync(join(original.storagePath, "project_identity"), "remote:gitlab.com/acme/widget");
    const priorWorkspace = readFileSync(join(original.storagePath, "workspace_path"), "utf8");
    let message = "";
    try {
      resolveProject(first);
    } catch (error) {
      message = error.message;
    }
    assert(message.includes("identity collision"), `identity collision stayed open: ${message}`);
    assert(
      readFileSync(join(original.storagePath, "workspace_path"), "utf8") === priorWorkspace,
      "collision rewrote workspace custody",
    );
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(shared, { recursive: true, force: true });
    rmSync(first, { recursive: true, force: true });
    rmSync(clone, { recursive: true, force: true });
  }
});

t("a verified preview-era shared key migrates to the host-qualified key", () => {
  const shared = mkdtempSync(join(tmpdir(), "amanuensis-shared-migration-"));
  const target = makeTargetRepo();
  const legacy = join(shared, "acme", "widget");
  try {
    spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/widget.git"], {
      cwd: target,
    });
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "workspace_path"), target);
    writeFileSync(join(legacy, "retained.txt"), "preview-state");
    const legacyDatabase = openDatabase(join(legacy, "memory.db"));
    legacyDatabase.close();
    process.env.AMANUENSIS_STORAGE_ROOT = shared;
    const project = resolveProject(target);
    assert(project.storagePath === join(realpathSync(shared), "github.com", "acme", "widget"));
    assert(!existsSync(legacy), "verified legacy key was not retired");
    assert(readFileSync(join(project.storagePath, "retained.txt"), "utf8") === "preview-state");
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(shared, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

t("shared storage refuses a symlinked key ancestor", () => {
  const shared = mkdtempSync(join(tmpdir(), "amanuensis-shared-symlink-"));
  const outside = mkdtempSync(join(tmpdir(), "amanuensis-shared-outside-"));
  const target = makeTargetRepo();
  try {
    spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/widget.git"], {
      cwd: target,
    });
    symlinkSync(outside, join(shared, "github.com"), "dir");
    process.env.AMANUENSIS_STORAGE_ROOT = shared;
    let message = "";
    try {
      resolveProject(target);
    } catch (error) {
      message = error.message;
    }
    assert(message.includes("symbolic link"), `shared symlink was not rejected: ${message}`);
    assert(readdirSync(outside).length === 0, "shared storage wrote through a symlink");
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(shared, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

t("parent Git exclusion failure is closed before storage creation", () => {
  const target = makeTargetRepo();
  const storage = join(target, ".amanuensis");
  try {
    let message = "";
    try {
      excludeLocalStorageFromWorkspaceGit(target, storage, {
        append() {
          throw new Error("simulated unwritable Git metadata");
        },
      });
    } catch (error) {
      message = error.message;
    }
    assert(message.includes("cannot isolate project-local .amanuensis"), message);
    assert(!existsSync(storage), "storage was created after exclusion failure");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

t("a source-tracked .amanuensis directory is rejected", () => {
  const target = makeTargetRepo();
  try {
    mkdirSync(join(target, ".amanuensis"), { recursive: true });
    writeFileSync(join(target, ".amanuensis", "owned.txt"), "source-owned");
    spawnSync("git", ["add", "-f", ".amanuensis/owned.txt"], { cwd: target });
    spawnSync("git", ["commit", "-q", "--no-verify", "-m", "track reserved path"], {
      cwd: target,
    });
    let message = "";
    try {
      resolveProject(target);
    } catch (error) {
      message = error.message;
    }
    assert(
      message.includes("already tracked"),
      `tracked collision did not fail closed: ${message}`,
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

t("a nonempty unowned .amanuensis directory is preserved and rejected", () => {
  const target = makeTargetRepo();
  const storage = join(target, ".amanuensis");
  try {
    const excludePath = spawnSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd: target,
      encoding: "utf8",
    }).stdout.trim();
    const absoluteExclude = excludePath.startsWith("/") ? excludePath : join(target, excludePath);
    const priorExclude = readFileSync(absoluteExclude, "utf8");
    mkdirSync(storage, { recursive: true });
    writeFileSync(join(storage, "user-owned.txt"), "preserve-me");
    let message = "";
    try {
      resolveProject(target);
    } catch (error) {
      message = error.message;
    }
    assert(message.includes("no verifiable project identity"), `collision was adopted: ${message}`);
    assert(readFileSync(join(storage, "user-owned.txt"), "utf8") === "preserve-me");
    assert(!existsSync(join(storage, "project_identity")), "collision gained identity custody");
    assert(!existsSync(join(storage, ".git")), "collision was initialized as tool storage");
    assert(
      readFileSync(absoluteExclude, "utf8") === priorExclude,
      "collision changed Git excludes",
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- 14. Nested mode writes .gitignore inside the project subdir ----
t("nested storage still gets .gitignore covering WAL files", () => {
  const conspectus = makeConspectusRepo();
  const target = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const project = resolveProject(target);
    const gi = join(project.storagePath, ".gitignore");
    assert(existsSync(gi), ".gitignore missing");
    const body = readFileSync(gi, "utf8");
    assert(body.includes("memory.db-wal"), ".gitignore does not cover WAL");
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- 15. Nested mode rejects an empty commit label (guardrails hold) ----
t("nested mode still validates commit labels", () => {
  const conspectus = makeConspectusRepo();
  const target = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const project = resolveProject(target);
    writeFileSync(join(project.storagePath, "x.txt"), "x");
    const r = commitStorage(project.storagePath, "");
    assert(!r.ok);
    assert(r.reason.includes("empty"));
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

// ---- 16. Outer repo on unborn branch is handled ----
t("nested storage inside an unborn outer repo doesn't crash", () => {
  // An outer repo that's been `git init`-ed but has no commits yet.
  const conspectus = mkdtempSync(join(tmpdir(), "conspectus-unborn-"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: conspectus });
  const target = makeTargetRepo();
  try {
    process.env.AMANUENSIS_STORAGE_ROOT = join(conspectus, "workspaces");
    const project = resolveProject(target);
    assert(!existsSync(join(project.storagePath, ".git")), "created nested .git on unborn outer");
    // Storage is in a repo, commit should succeed (outer repo accepts
    // the root commit).
    writeFileSync(join(project.storagePath, "x.txt"), "x");
    // Give the outer repo an identity so commit-from-unborn lands.
    spawnSync("git", ["config", "user.email", "t@t"], { cwd: conspectus });
    spawnSync("git", ["config", "user.name", "t"], { cwd: conspectus });
    spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: conspectus });
    const r = commitStorage(project.storagePath, "first on unborn outer");
    assert(r.ok, `should succeed: ${r.reason}`);
  } finally {
    delete process.env.AMANUENSIS_STORAGE_ROOT;
    rmSync(conspectus, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
