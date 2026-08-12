#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateConspectus } from "./check-living-conspectus.mjs";

const DEV_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(DEV_DIR, "..");
const FIXTURE_PATH = resolve(DEV_DIR, "conspectus/self-baseline.json");
const REPORT_PATH = resolve(DEV_DIR, "conspectus/baseline-report.json");
const CHECKER_PATH = resolve(DEV_DIR, "check-living-conspectus.mjs");
const BASELINE = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

function clone() {
  return structuredClone(BASELINE);
}

function failureIds(result) {
  return [...result.missing, ...result.errors].map(({ id }) => id);
}

function assertRed(name, mutate, expectedId) {
  const value = clone();
  mutate(value);
  const result = evaluateConspectus(value);
  if (result.complete) throw new Error(`${name}: expected RED, observed complete`);
  const ids = failureIds(result);
  if (!ids.includes(expectedId)) {
    throw new Error(`${name}: expected ${expectedId}; observed ${ids.join(", ")}`);
  }
}

function runChecker(checker, args, expectedStatus, expectedText) {
  const result = spawnSync(process.execPath, [checker, ...args], { encoding: "utf8" });
  const combined = `${result.stdout}\n${result.stderr}`;
  if (result.status !== expectedStatus) {
    throw new Error(`checker ${args.join(" ")} exited ${result.status}, expected ${expectedStatus}\n${combined}`);
  }
  if (expectedText && !combined.includes(expectedText)) {
    throw new Error(`checker ${args.join(" ")} did not report ${expectedText}\n${combined}`);
  }
}

const green = evaluateConspectus(BASELINE);
if (!green.complete) {
  throw new Error(`canonical fixture is not complete: ${JSON.stringify([...green.missing, ...green.errors])}`);
}

const firstFile = BASELINE.inventory.assignments[0].files[0];
assertRed(
  "missing file assignment",
  (value) => value.inventory.assignments[0].files.splice(0, 1),
  `file:${firstFile}:assignment`,
);
assertRed(
  "missing concern disposition",
  (value) => delete value.concernCoverage.find(({ subsystemId }) => subsystemId === "B-02").dispositions["AT-2"],
  "concern:B-02/AT-2:disposition",
);
assertRed(
  "missing seam endpoint",
  (value) => { value.seams[0].partyB = null; },
  "seam:SM-01:endpoint:missing",
);
assertRed(
  "missing seam assessment",
  (value) => { value.seams[0].assessment = null; },
  "seam:SM-01:integral-assessment",
);
assertRed(
  "missing phase",
  (value) => value.subsystems[0].completedPhases.splice(3, 1),
  "subsystem:B-01:phase-sequence",
);
assertRed(
  "missing landed result",
  (value) => value.runs[0].landed.splice(0, 1),
  `run:a0-unchanged-run-01:landed:${BASELINE.runContract.expectedWork[0]}`,
);
assertRed(
  "missing scored result",
  (value) => value.runs[0].scored.splice(0, 1),
  `run:a0-unchanged-run-01:scored:${BASELINE.runContract.expectedWork[0]}`,
);
assertRed(
  "missing unchanged replicate",
  (value) => value.runs.splice(1, 1),
  "run:unchanged-replicates:minimum-two",
);
for (const axis of ["state", "coverage", "content"]) {
  assertRed(
    `corrupt ${axis} read-back`,
    (value) => { value.export.readBackHashes[axis] = "corrupt"; },
    `export:${axis}:read-back`,
  );
}

const controlMutations = {
  unchanged: (control) => { control.expectedObservation.replicatesRemainSeparate = false; },
  marker: (control) => { control.input.markedPayload.claim = "different semantic content"; },
  "benign-refactor": (control) => { control.input.after.behaviorHash = "changed-behavior"; },
  "historical-defect": (control) => control.input.repairRevisionEvidenceIds.push("repair-evidence"),
  "direct-invalidation": (control) => { control.input.evidenceAnchorPresent = true; },
  "cross-seam": (control) => { control.input.crossSeamDefect = false; },
  "incoherent-request": (control) => { control.input.priority = "goal-a"; },
  "export-fan-in": (control) => { control.input.scored.push("work-2"); },
};
for (const [controlClass, mutate] of Object.entries(controlMutations)) {
  assertRed(
    `control ${controlClass}`,
    (value) => mutate(value.controls.find(({ class: valueClass }) => valueClass === controlClass)),
    `control:${controlClass}:behavior`,
  );
}

const scratch = mkdtempSync(resolve(tmpdir(), "amanuensis-a0-clean-export-"));
try {
  const cleanRoot = resolve(scratch, "source");
  const cleanDev = resolve(cleanRoot, "dev");
  const cleanConspectus = resolve(cleanDev, "conspectus");
  mkdirSync(cleanConspectus, { recursive: true });
  cpSync(CHECKER_PATH, resolve(cleanDev, "check-living-conspectus.mjs"), { recursive: false });
  cpSync(FIXTURE_PATH, resolve(cleanConspectus, "self-baseline.json"), { recursive: false });
  cpSync(REPORT_PATH, resolve(cleanConspectus, "baseline-report.json"), { recursive: false });
  const exportDir = resolve(scratch, "export");
  const cleanChecker = resolve(cleanDev, "check-living-conspectus.mjs");
  runChecker(cleanChecker, ["--root", cleanRoot, "--export", exportDir], 0, "living conspectus complete");
  runChecker(cleanChecker, ["--root", cleanRoot, "--read-back", exportDir], 0, "living conspectus complete");

  const summaryPath = resolve(exportDir, "conspectus-summary.json");
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  summary.state.fixtureId = "corrupt";
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  runChecker(cleanChecker, ["--root", cleanRoot, "--read-back", exportDir], 1, "export:state:content");
  writeFileSync(summaryPath, "{not-json\n");
  runChecker(cleanChecker, ["--root", cleanRoot, "--read-back", exportDir], 1, "export:projection:readable");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(
  "A0 red gates verified: file, concern, seam endpoint/assessment, phase, landed, scored, replication, all control classes, and clean-export state/coverage/content read-back",
);
