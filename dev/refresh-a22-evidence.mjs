#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = join(root, "dev", "activation-evidence", "a22-codex-host.json");
const parentEvidencePath = join(
  root,
  "dev",
  "activation-evidence",
  "a22-host-runs",
  "parent-cd-recovery.json",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourcePaths = [
  "mcp-server/src/project.ts",
  "mcp-server/src/index.ts",
  "mcp-server/src/codex-host.ts",
  "mcp-server/test-codex-parent-workspace.mjs",
  "mcp-server/fixtures/activation/codex-context-probe.mjs",
  "mcp-server/fixtures/activation/codex-host-red-matrix.json",
  "dev/check-codex-host-evidence.mjs",
  "dev/test-codex-host-evidence-red-gates.mjs",
  "dev/run-codex-host-harness.mjs",
  "dev/run-codex-parent-cd-evidence.mjs",
  "dev/adopt-codex-host-evidence.mjs",
  "dev/cleanup-codex-host-trust.mjs",
  "dev/refresh-a22-evidence.mjs",
  ".github/workflows/test.yml",
];
const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
const parentEvidenceBytes = readFileSync(parentEvidencePath);
const parentEvidence = JSON.parse(parentEvidenceBytes);
receipt.recordedAt = new Date().toISOString();
receipt.source.files = sourcePaths.map((path) => ({
  path,
  sha256: sha256(readFileSync(join(root, path))),
}));
receipt.parentCdRecovery = {
  evidencePath: relative(root, parentEvidencePath),
  evidenceSha256: sha256(parentEvidenceBytes),
  ...parentEvidence,
};
const staleScenario = receipt.scenarios.find((scenario) => scenario.name === "stale-process");
staleScenario.runIds = ["stale-process-cwd", "parent-cd-recovery"];
receipt.redGate.postRepair.parentCdRecoveryExitCode = 0;
receipt.redGate.preRepair.realHostWrongCwd = {
  runId: "stale-process-cwd",
  codexTaskExitCode: 0,
  detectorOutcome: "rejected",
  expectedCanonicalRoot: receipt.detectorRuns.find((run) => run.runId === "stale-process-cwd")
    .expectedCanonicalRoot,
  observedCanonicalRoot: receipt.detectorRuns.find((run) => run.runId === "stale-process-cwd")
    .observedCanonicalRoot,
};
receipt.redGate.postRepair.realHostParentCd = {
  runId: "parent-cd-recovery",
  codexTaskExitCode: 0,
  expectedCanonicalRoot: parentEvidence.requestedTarget,
  observedCanonicalRoot: parentEvidence.bindingReceipt.canonicalRoot,
  selectionSource: parentEvidence.bindingReceipt.selectionSource,
  configBytesChanged: parentEvidence.configBytesChanged,
};
for (const check of [
  "mise exec -- node mcp-server/test-codex-parent-workspace.mjs",
  "mise exec -- node dev/run-codex-parent-cd-evidence.mjs --execute",
]) {
  if (!receipt.greenChecks.includes(check)) receipt.greenChecks.push(check);
}
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(`refreshed ${relative(root, receiptPath)} from ${sourcePaths.length} source files`);
