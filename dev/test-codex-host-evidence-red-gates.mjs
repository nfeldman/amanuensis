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
  // B08-1: the live-configuration gate used to pin the whole file by sha256, so
  // it turned red for any unrelated local change and had no coverage at all —
  // the fixture carried no configPath, so the branch never executed. These
  // check the properties the host evidence actually rests on.
  ["config-shadowed-registration", "exactly one managed Amanuensis registration"],
  ["config-workspace-pinned", "pins a repository"],
  ["config-residual-harness-trust", "harness trust"],
]);

for (const [caseId, error] of expected) {
  const result = spawnSync(process.execPath, [checker, "--receipt", fixture, "--case", caseId], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0, `${caseId}: red gate exited green`);
  // The checker reports an unmet expectation as "did not trigger expected
  // error: <text>", which contains the text itself — so a plain includes()
  // passes whether or not the check actually fired. Require the real message
  // and reject the harness echo.
  assert(
    !result.stderr.includes(`did not trigger expected error: ${error}`),
    `${caseId}: the check never fired; the harness only echoed the expectation\n${result.stderr}`,
  );
  assert(
    result.stderr.includes(error),
    `${caseId}: expected error was absent\n${result.stdout}\n${result.stderr}`,
  );
}

// Control arm: a healthy configuration that also carries an unrelated MCP
// server and an ordinary project trust entry must pass. Without this the gate
// could satisfy every sabotage above by simply rejecting everything.
const control = spawnSync(process.execPath, [checker, "--receipt", fixture, "--case", "control-healthy-config"], {
  cwd: root,
  encoding: "utf8",
});
assert(
  !control.stderr.includes("live Codex configuration"),
  `healthy configuration was rejected by the live-configuration gate\n${control.stderr}`,
);

console.log(
  `Codex host evidence red gates: ${expected.size}/${expected.size} exited nonzero; unrelated local configuration tolerated`,
);
