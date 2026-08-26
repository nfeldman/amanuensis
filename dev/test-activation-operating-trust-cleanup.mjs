#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "dev", "cleanup-activation-operating-trust.mjs");
const scratch = mkdtempSync(join(tmpdir(), "amanuensis-a25-operating-"));
const codexHome = mkdtempSync(join(tmpdir(), "amanuensis-a25-cleanup-home-"));
const configPath = join(codexHome, "config.toml");
const canonicalScratch = realpathSync(scratch);
const unrelatedPrefix = 'model = "preserve-me"\n\n';
const unrelatedSuffix = '\n[mcp_servers.other]\ncommand = "preserve-me-too"\n';
const managedTrust = ["repo-a", "repo-b"]
  .map((name) => `\n[projects."${canonicalScratch}/${name}"]\ntrust_level = "trusted"\n`)
  .join("");
const before = `${unrelatedPrefix}${managedTrust}${unrelatedSuffix}`;
writeFileSync(configPath, before, "utf8");

function invoke(args) {
  const result = spawnSync(process.execPath, [script, "--scratch-root", scratch, ...args], {
    cwd: root,
    env: { ...process.env, CODEX_HOME: codexHome },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

try {
  const dryRun = invoke([]);
  assert.equal(dryRun.mode, "dry-run");
  assert.equal(dryRun.removedCount, 2);
  assert.equal(readFileSync(configPath, "utf8"), before, "dry run changed config bytes");

  const applied = invoke(["--apply"]);
  assert.equal(applied.mode, "apply");
  assert.equal(applied.removedCount, 2);
  assert(existsSync(applied.backupPath), "cleanup omitted timestamped backup");
  assert.equal(readFileSync(applied.backupPath, "utf8"), before, "backup bytes drifted");
  assert.equal(
    readFileSync(configPath, "utf8"),
    `${unrelatedPrefix}${unrelatedSuffix}`,
    "cleanup changed unrelated config bytes",
  );
  assert.equal(
    readdirSync(codexHome).filter((name) => name.startsWith("config.toml.bak.a25-host-trust."))
      .length,
    1,
  );
  console.log(
    "A25 host-trust cleanup passed: dry run, timestamped backup, and exact bounded removal",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(codexHome, { recursive: true, force: true });
}
