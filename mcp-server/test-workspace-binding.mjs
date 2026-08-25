#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./dist/db.js";
import { resolveProject } from "./dist/project.js";
import { compareTools } from "./dist/tools/compare.js";
import { materializeTools } from "./dist/tools/materialize.js";

function initRepository(path, remote) {
  mkdirSync(path, { recursive: true });
  assert.equal(
    spawnSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: path }).status,
    0,
  );
  writeFileSync(join(path, "README.md"), `# ${path.split("/").at(-1)}\n`);
  spawnSync("git", ["add", "README.md"], { cwd: path });
  spawnSync(
    "git",
    [
      "-c",
      "user.name=Amanuensis Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      "fixture",
    ],
    { cwd: path },
  );
  if (remote) spawnSync("git", ["remote", "add", "origin", remote], { cwd: path });
}

function tool(tools, name) {
  const found = tools.find((candidate) => candidate.name === name);
  assert(found, `missing tool ${name}`);
  return found;
}

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(moduleDir, "fixtures", "activation", "storage-symlink-escape.json"), "utf8"),
);
assert.equal(fixture.schemaVersion, 1);
assert.equal(fixture.fixtureId, "storage-root-symlink-escape");
assert.equal(fixture.expectedFailure, "containment-before-first-mutation");

const root = mkdtempSync(join(tmpdir(), "amanuensis-a21-red-"));
const repositoryA = join(root, "repository-a");
const repositoryB = join(root, "repository-b");
initRepository(repositoryA, "https://github.com/acme/fixture.git");
initRepository(repositoryB, "https://github.com/acme/other-fixture.git");

try {
  const repositoryBBefore = readdirSync(repositoryB).sort();
  assert.equal(
    fixture.redirectTarget.replace("__REPOSITORY_B__", repositoryB),
    repositoryB,
    "fixture redirect target drifted",
  );
  symlinkSync(repositoryB, join(root, "redirect"), "dir");
  process.env.AMANUENSIS_STORAGE_ROOT = fixture.configuredStorageRoot.replace(
    "__FIXTURE_ROOT__",
    root,
  );
  let symlinkFailure = "";
  try {
    resolveProject(repositoryA);
  } catch (error) {
    symlinkFailure = error.message;
  }
  assert.match(symlinkFailure, /symbolic link|symlink/);
  assert.deepEqual(
    readdirSync(repositoryB).sort(),
    repositoryBBefore,
    "configured storage root mutated the other repository",
  );
  for (const forbidden of fixture.forbiddenWrites) {
    const forbiddenPath = forbidden
      .replace("__REPOSITORY_B__", repositoryB)
      .replace("__FIXTURE_ROOT__", root);
    assert(!existsSync(forbiddenPath), `configured storage root wrote ${forbiddenPath}`);
  }
  delete process.env.AMANUENSIS_STORAGE_ROOT;

  const repositoryC = join(root, "repository-c");
  initRepository(repositoryC, "https://github.com/acme/exclude-fixture.git");
  const outsideExclude = join(repositoryB, "outside-exclude");
  writeFileSync(outsideExclude, "preserve\n");
  const excludePath = join(repositoryC, ".git", "info", "exclude");
  unlinkSync(excludePath);
  symlinkSync(outsideExclude, excludePath);
  assert.throws(() => resolveProject(repositoryC), /symbolic link/);
  assert.equal(readFileSync(outsideExclude, "utf8"), "preserve\n");
  assert(!existsSync(join(repositoryC, ".amanuensis")), "Git-exclude escape created storage");

  const project = resolveProject(repositoryA, {
    selectionSource: "process-cwd-git-root",
    serverVersion: "test",
  });
  assert(Object.isFrozen(project), "project binding remains mutable");
  assert(Object.isFrozen(project.bindingReceipt), "startup receipt remains mutable");
  assert.equal(project.bindingReceipt.canonicalRoot, project.workspacePath);
  assert.equal(project.bindingReceipt.storagePath, project.storagePath);
  assert.equal(project.bindingReceipt.projectKey, project.projectKey);
  assert.equal(project.bindingReceipt.selectionSource, "process-cwd-git-root");

  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  const outsideMaterialization = join(repositoryB, "materialized");
  assert.throws(
    () =>
      tool(materializeTools, "materialize_docs").handler(
        { output_dir: outsideMaterialization },
        ctx,
      ),
    /escapes its configured root|outside.*storage/,
  );
  assert(!existsSync(outsideMaterialization), "materializer wrote outside bound storage");

  const outsideComparison = join(repositoryB, "comparison.md");
  assert.throws(
    () =>
      tool(compareTools, "compare_conspectuses").handler(
        { path_a: project.dbPath, path_b: project.dbPath, write_to: outsideComparison },
        ctx,
      ),
    /escapes its configured root|outside.*storage/,
  );
  assert(!existsSync(outsideComparison), "comparison wrote outside bound storage");
  db.close();

  const worktree = join(root, "fixture-worktree");
  assert.equal(
    spawnSync("git", ["worktree", "add", "--quiet", "-b", "fixture-worktree", worktree], {
      cwd: repositoryA,
    }).status,
    0,
  );
  const mainBinding = resolveProject(repositoryA, {
    selectionSource: "test-main",
    serverVersion: "test",
  });
  const worktreeBinding = resolveProject(worktree, {
    selectionSource: "test-worktree",
    serverVersion: "test",
  });
  assert.equal(
    mainBinding.bindingReceipt.projectIdentity,
    worktreeBinding.bindingReceipt.projectIdentity,
  );
  assert.notEqual(
    mainBinding.bindingReceipt.workspaceInstanceId,
    worktreeBinding.bindingReceipt.workspaceInstanceId,
  );
  assert.equal(mainBinding.bindingReceipt.storagePolicy, "worktree-local");
  assert.equal(worktreeBinding.bindingReceipt.storagePolicy, "worktree-local");
  assert.notEqual(mainBinding.storagePath, worktreeBinding.storagePath);

  console.log(
    "A21 red gate verified: symlink escape halted before mutation and repository/worktree bindings stayed isolated",
  );
} finally {
  delete process.env.AMANUENSIS_STORAGE_ROOT;
  rmSync(root, { recursive: true, force: true });
}
