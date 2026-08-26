#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const test = join(root, "mcp-server", "test-package-activation-parity.mjs");
const cases = {
  "packed-cwd": "canonicalRoot",
  "packed-skill-version": "skillDigest",
};

for (const [name, witness] of Object.entries(cases)) {
  const result = spawnSync(process.execPath, [test, "--case", name], {
    cwd: join(root, "mcp-server"),
    env: process.env,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0, `${name}: sabotaged package received a green parity result`);
  assert(
    `${result.stdout}\n${result.stderr}`.includes(witness),
    `${name}: parity failure did not identify ${witness}\n${result.stdout}\n${result.stderr}`,
  );
}

console.log("A24 package parity red gates passed: packed cwd and skill-version drift both halted");
