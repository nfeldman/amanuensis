#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { PROJECT_INITIALIZATION_BOUNDARIES } from "./dist/project.js";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const worker = join(moduleDir, "fixtures/activation/first-use-worker.mjs");
const fixture = JSON.parse(
  readFileSync(join(moduleDir, "fixtures/activation/first-use-interruption.json"), "utf8"),
);
assert.deepEqual(
  fixture.initializationMutationBoundaries,
  PROJECT_INITIALIZATION_BOUNDARIES,
  "first-use boundary fixture drifted from the implementation",
);

function initRepository(path) {
  mkdirSync(path, { recursive: true });
  const result = spawnSync("git", ["init", "--quiet", "--initial-branch=main"], {
    cwd: path,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(path, "README.md"), "# interruption recovery\n");
}

function runWorker(repository, boundary, env) {
  return spawnSync(process.execPath, [worker, repository, boundary], {
    cwd: repository,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function expectedLocalIdentity(repository) {
  return `local:${realpathSync(repository)}`;
}

function seedRecoveryBoundary(boundary, repository, storageRoot) {
  if (boundary === "abandoned-stage-cleanup") {
    const target = join(realpathSync(repository), ".amanuensis");
    const stage = join(repository, `.amanuensis.initializing-999999-${randomUUID()}`);
    mkdirSync(stage);
    writeFileSync(
      join(stage, ".amanuensis-initializer.json"),
      `${JSON.stringify({
        contractVersion: "amanuensis-storage-initialization/v1",
        pid: 999999,
        targetStoragePath: target,
        projectIdentity: expectedLocalIdentity(repository),
      })}\n`,
    );
  } else if (boundary === "incomplete-store-rollback") {
    const store = join(repository, ".amanuensis");
    mkdirSync(store);
    writeFileSync(join(store, "project_identity"), expectedLocalIdentity(repository));
    writeFileSync(join(store, "workspace_path"), realpathSync(repository));
  } else if (boundary === "storage-parent") {
    assert(!existsSync(storageRoot), "shared storage root unexpectedly exists before first use");
  }
}

const suiteRoot = mkdtempSync(join(tmpdir(), "amanuensis-a23-recovery-"));
const results = [];

try {
  for (const boundary of fixture.initializationMutationBoundaries) {
    const caseRoot = join(suiteRoot, boundary);
    const repository = join(caseRoot, "repository");
    const sharedRoot = join(caseRoot, "shared-storage");
    initRepository(repository);
    seedRecoveryBoundary(boundary, repository, sharedRoot);
    const env = boundary === "storage-parent" ? { AMANUENSIS_STORAGE_ROOT: sharedRoot } : {};

    const interrupted = runWorker(repository, boundary, env);
    assert.equal(
      interrupted.status,
      86,
      `${boundary}: fault arm did not exit 86\nstdout=${interrupted.stdout}\nstderr=${interrupted.stderr}`,
    );
    assert(
      interrupted.stderr.includes(`A23_INTERRUPT boundary=${boundary}`),
      `${boundary}: fault identity was not reported`,
    );

    const recovered = runWorker(repository, "none", env);
    assert.equal(
      recovered.status,
      0,
      `${boundary}: recovery failed\nstdout=${recovered.stdout}\nstderr=${recovered.stderr}`,
    );
    const receipt = JSON.parse(recovered.stdout);
    const store = receipt.storagePath;
    const markerPath = join(store, "initialization.json");
    assert(existsSync(markerPath), `${boundary}: recovery accepted a store without its marker`);
    assert(existsSync(join(store, "memory.db")), `${boundary}: recovery lost the database`);
    assert(
      !existsSync(join(store, ".amanuensis-initializer.json")),
      `${boundary}: initializer ownership was not retired after recovery`,
    );
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    assert.equal(marker.projectIdentity, receipt.projectIdentity, `${boundary}: identity drifted`);
    assert.equal(marker.projectKey, receipt.projectKey, `${boundary}: project key drifted`);
    const db = new Database(join(store, "memory.db"), { readonly: true });
    try {
      assert.equal(db.pragma("quick_check", { simple: true }), "ok", `${boundary}: DB is corrupt`);
      assert(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='entries'").get(),
        `${boundary}: schema is incomplete`,
      );
    } finally {
      db.close();
    }
    const stagingParent = dirname(store);
    const stagingPrefix = `${store.split("/").at(-1)}.initializing-`;
    assert.equal(
      readdirSync(stagingParent).filter((name) => name.startsWith(stagingPrefix)).length,
      0,
      `${boundary}: abandoned staging survived recovery`,
    );
    results.push({ boundary, interruptedExit: interrupted.status, storagePath: store });
  }

  console.log(
    `A23 first-use recovery: ${results.length}/${fixture.initializationMutationBoundaries.length} boundaries interrupted and recovered`,
  );
} finally {
  rmSync(suiteRoot, { recursive: true, force: true });
}
