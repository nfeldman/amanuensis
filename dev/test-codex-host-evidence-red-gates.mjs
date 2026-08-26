#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checker = join(root, "dev", "check-codex-host-evidence.mjs");
const fixture = join(root, "mcp-server", "fixtures", "activation", "codex-host-red-matrix.json");
const expected = new Map([
  ["wrong-cwd", "[repository-b] canonical root"],
  ["reused-server", "server instance instance-a crossed repository roots"],
  ["cross-write", "[repository-a] cross-repository write"],
  ["missing-restart", "running Codex process predates managed configuration"],
]);

for (const [caseId, error] of expected) {
  const result = spawnSync(process.execPath, [checker, "--receipt", fixture, "--case", caseId], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0, `${caseId}: red gate exited green`);
  assert(
    result.stderr.includes(error),
    `${caseId}: expected error was absent\n${result.stdout}\n${result.stderr}`,
  );
}

console.log(`Codex host evidence red gates: ${expected.size}/${expected.size} exited nonzero`);
