#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = join(root, "dev", "activation-evidence");
const receipts = readdirSync(evidenceRoot)
  .filter((name) => name.endsWith(".json"))
  .sort();

assert(receipts.length > 0, "activation evidence denominator is zero");
const initiatives = new Set();

for (const name of receipts) {
  const path = join(evidenceRoot, name);
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(receipt.schemaVersion, 1, `${name}: schema version drifted`);
  assert.match(receipt.initiative, /^A(?:19|2[0-6])$/, `${name}: initiative is out of program scope`);
  assert(!initiatives.has(receipt.initiative), `${name}: duplicate ${receipt.initiative} receipt`);
  initiatives.add(receipt.initiative);
  assert.equal(receipt.result, "passed", `${name}: receipt is not passing`);
  assert.match(receipt.source?.baselineCommit ?? "", /^[a-f0-9]{40}$/, `${name}: source baseline is absent`);
  const implementationCommit = receipt.source?.implementationCommit;
  if (implementationCommit !== undefined) {
    assert.match(
      implementationCommit,
      /^[a-f0-9]{40}$/,
      `${name}: implementation commit is malformed`,
    );
    execFileSync("git", ["cat-file", "-e", `${implementationCommit}^{commit}`], {
      cwd: root,
      stdio: "ignore",
    });
  }

  const sourceFiles = receipt.source?.files ?? [];
  assert(sourceFiles.length > 0, `${name}: source file denominator is zero`);
  for (const source of sourceFiles) {
    assert(!isAbsolute(source.path), `${name}: source path must be repository-relative`);
    const sourcePath = resolve(root, source.path);
    assert(
      relative(root, sourcePath) !== ".." && !relative(root, sourcePath).startsWith("../"),
      `${name}: source path escapes the repository`,
    );
    assert(statSync(sourcePath).isFile(), `${name}: source file is absent: ${source.path}`);
    const bytes = implementationCommit
      ? execFileSync("git", ["show", `${implementationCommit}:${source.path}`], {
          cwd: root,
          maxBuffer: 16 * 1024 * 1024,
        })
      : readFileSync(sourcePath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.equal(digest, source.sha256, `${name}: source digest drifted: ${source.path}`);
  }

  assert.notEqual(receipt.redGate?.preRepair?.exitCode, 0, `${name}: red gate never exited red`);
  assert.equal(receipt.redGate?.postRepair?.exitCode, 0, `${name}: repaired gate is not green`);
  assert(
    (receipt.greenChecks?.length ?? 0) > 0,
    `${name}: green-check denominator is zero`,
  );

  if (receipt.identityWitness) {
    const canonicalRoot = receipt.identityWitness.canonicalRoot;
    const storagePath = receipt.identityWitness.storagePath;
    assert(isAbsolute(canonicalRoot), `${name}: canonical root is not absolute`);
    assert.equal(
      storagePath,
      join(canonicalRoot, ".amanuensis"),
      `${name}: storage path is not bound to the canonical root`,
    );
  }
}

console.log(
  `activation evidence valid; ${receipts.length} receipt(s), ${initiatives.size} initiative(s)`,
);
