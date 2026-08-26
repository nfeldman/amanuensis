#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checker = join(root, "dev", "check-friction-free-release-readiness.mjs");
const fixture = join(
  root,
  "mcp-server",
  "fixtures",
  "activation",
  "release-readiness-red-matrix.json",
);
const expected = new Map([
  ["missing-repository-result", "[repository:run-e] repository result is missing"],
  ["missing-migration-case", "[migration:rollback] migration case is missing"],
  ["missing-red-gate-receipt", "[A22] red-gate receipt is missing"],
  ["missing-restart-observation", "[restart:initial-installation] restart observation is missing"],
]);

function parseOutput(argv) {
  const index = argv.indexOf("--output");
  if (index < 0) return undefined;
  assert(
    argv.length === index + 2,
    "usage: test-friction-free-release-readiness-red-gates.mjs [--output PATH]",
  );
  return resolve(argv[index + 1]);
}

const output = parseOutput(process.argv.slice(2));

const control = spawnSync(process.execPath, [checker, "--report", fixture], {
  cwd: root,
  encoding: "utf8",
});
assert.equal(
  control.status,
  0,
  `unsabotaged A26 control is red\n${control.stdout}\n${control.stderr}`,
);

const cases = [];
for (const [caseId, witness] of expected) {
  const result = spawnSync(process.execPath, [checker, "--report", fixture, "--case", caseId], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0, `${caseId}: release-readiness red gate exited green`);
  assert(
    result.stderr.includes(witness),
    `${caseId}: expected witness was absent\n${result.stdout}\n${result.stderr}`,
  );
  cases.push({
    caseId,
    exitCode: result.status,
    expectedError: witness,
    observedError: result.stderr.trim().split("\n")[0],
    halted: true,
  });
}

const summary = `A26 release-readiness red gates: control green; ${expected.size}/${expected.size} sabotages exited nonzero`;
if (output) {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        initiative: "A26",
        fixtureId: "a26-friction-free-release-readiness-red-matrix",
        result: "passed",
        command: "mise exec -- node dev/test-friction-free-release-readiness-red-gates.mjs",
        controlExitCode: control.status,
        sabotageCaseCount: expected.size,
        haltedCaseCount: cases.filter(({ halted }) => halted).length,
        cases,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`${summary}; wrote ${relative(root, output)}`);
} else console.log(summary);
