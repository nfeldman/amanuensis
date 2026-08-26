#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checker = join(root, "dev", "check-activation-operating-envelope.mjs");
const fixture = join(
  root,
  "mcp-server",
  "fixtures",
  "activation",
  "operating-envelope-red-matrix.json",
);
const expected = new Map([
  ["pooled-failure", "failed run cannot be pooled into a passed report"],
  ["omitted-intervention", "user intervention count is absent"],
  ["reused-run-id", "run ID was reused"],
]);

for (const [caseId, witness] of expected) {
  const result = spawnSync(process.execPath, [checker, "--receipt", fixture, "--case", caseId], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0, `${caseId}: red gate exited green`);
  assert(
    result.stderr.includes(witness),
    `${caseId}: expected witness was absent\n${result.stdout}\n${result.stderr}`,
  );
}

console.log(
  `A25 activation operating-envelope red gates: ${expected.size}/${expected.size} exited nonzero`,
);
