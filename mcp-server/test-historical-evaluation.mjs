#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  DETECTOR_VERSION,
  loadCorpus,
  prepareCase,
  qualifyCorpus,
  rebaselineCorpus,
  scanParticipantSurface,
  scoreCase,
} from "./scripts/historical-evaluation.mjs";

const scratch = mkdtempSync(resolve(tmpdir(), "amanuensis-historical-evaluation-test-"));
const repository = resolve(scratch, "repository");
const custody = resolve(scratch, "custody");
const manifestPath = resolve(custody, "manifest.json");
const taskPath = resolve(custody, "task.md");
const oraclePath = resolve(custody, "oracle.patch");
const canary = "EVALUATOR_CANARY_DO_NOT_SURFACE";
const testDirectory = dirname(fileURLToPath(import.meta.url));
const runnerPath = resolve(testDirectory, "scripts/historical-evaluation.mjs");

function git(args) {
  return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
}

function commit(message) {
  git(["add", "."]);
  git(["commit", "-m", message]);
  return git(["rev-parse", "HEAD"]);
}

function writeManifest(targetCommit, fixCommit, overrides = {}) {
  const corpus = {
    schemaVersion: "1.1.0",
    detectorVersion: DETECTOR_VERSION,
    programId: "synthetic-natural-history",
    created: "2026-08-14",
    cases: [
      {
        caseId: "synthetic-off-by-one",
        repository: { root: repository, targetCommit, fixCommit },
        participant: { taskFile: "task.md" },
        oracle: {
          patchFile: "oracle.patch",
          command: ["node", "--test", "hidden.test.mjs"],
          timeoutMs: 30_000,
          workingDirectory: ".",
        },
        leakage: {
          forbiddenFragments: [fixCommit, "hidden.test.mjs"],
          canaries: [canary],
        },
        classification: {
          language: "JavaScript",
          repositoryShape: "single-package",
          changeClass: "correctness",
          truthStrength: "executable-regression",
        },
      },
    ],
    ...overrides,
  };
  writeFileSync(manifestPath, `${JSON.stringify(corpus, null, 2)}\n`);
}

try {
  mkdirSync(repository, { recursive: true });
  mkdirSync(custody, { recursive: true });
  git(["init"]);
  git(["config", "user.name", "Amanuensis Test"]);
  git(["config", "user.email", "amanuensis-test@example.invalid"]);
  writeFileSync(resolve(repository, "value.mjs"), "export const answer = 1;\n");
  const targetCommit = commit("target");
  writeFileSync(resolve(repository, "value.mjs"), "export const answer = 2;\n");
  const fixCommit = commit("fix");

  writeFileSync(taskPath, "Make the exported answer satisfy the documented contract.\n");
  writeFileSync(
    oraclePath,
    [
      "diff --git a/hidden.test.mjs b/hidden.test.mjs",
      "new file mode 100644",
      "index 0000000..1bbf3e3",
      "--- /dev/null",
      "+++ b/hidden.test.mjs",
      "@@ -0,0 +1,5 @@",
      '+import test from "node:test";',
      '+import assert from "node:assert/strict";',
      '+import { answer } from "./value.mjs";',
      "+",
      '+test("answer", () => assert.equal(answer, 2));',
      "",
    ].join("\n"),
  );
  writeManifest(targetCommit, fixCommit);

  const schema = JSON.parse(
    readFileSync(
      resolve(testDirectory, "contracts/historical-evaluation-corpus.schema.json"),
      "utf8",
    ),
  );
  const validateSchema = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
  assert.equal(validateSchema(JSON.parse(readFileSync(manifestPath, "utf8"))), true);

  const corpus = loadCorpus(manifestPath);
  const qualification = qualifyCorpus(corpus);
  assert.equal(qualification.caseCount, 1);
  assert.equal(qualification.detectorVersion, DETECTOR_VERSION);
  assert.equal(qualification.cases[0].targetOracle.outcome, "fail");
  assert.equal(qualification.cases[0].fixOracle.outcome, "pass");
  assert.equal(qualification.cases[0].qualified, true);

  const packet = resolve(scratch, "packet");
  const prepared = prepareCase(corpus, "synthetic-off-by-one", packet);
  assert.equal(prepared.historyAbsent, true);
  assert.equal(existsSync(resolve(packet, ".git")), false);
  assert.equal(readFileSync(resolve(packet, "value.mjs"), "utf8"), "export const answer = 1;\n");
  assert.equal(existsSync(resolve(packet, "hidden.test.mjs")), false);

  mkdirSync(resolve(packet, ".git"));
  assert.throws(
    () => scanParticipantSurface(corpus.cases[0], [packet]),
    /participant surface contains Git metadata/,
  );
  rmSync(resolve(packet, ".git"), { recursive: true });

  writeFileSync(resolve(packet, "value.mjs"), "export const answer = 2;\n");
  const score = scoreCase(corpus, "synthetic-off-by-one", packet);
  assert.equal(score.outcome, "pass");
  assert.equal(existsSync(resolve(packet, "hidden.test.mjs")), false);
  assert.equal(readFileSync(resolve(packet, "value.mjs"), "utf8"), "export const answer = 2;\n");
  const missingCommandCorpus = structuredClone(corpus);
  missingCommandCorpus.cases[0].oracle.command = ["amanuensis-command-that-does-not-exist"];
  assert.throws(
    () => scoreCase(missingCommandCorpus, "synthetic-off-by-one", packet),
    /oracle could not execute/,
  );
  assert.throws(
    () => prepareCase(corpus, "synthetic-off-by-one", packet),
    /output directory is not empty/,
  );

  writeFileSync(resolve(packet, "notes.txt"), `${canary}\n`);
  assert.throws(
    () => scanParticipantSurface(corpus.cases[0], [packet]),
    /participant-surface leakage detected/,
  );

  writeManifest(targetCommit, fixCommit, {
    cases: [
      {
        ...JSON.parse(readFileSync(manifestPath, "utf8")).cases[0],
        repository: { root: repository, targetCommit, fixCommit: targetCommit },
      },
    ],
  });
  assert.throws(() => loadCorpus(manifestPath), /targetCommit and fixCommit must differ/);

  writeManifest(targetCommit, fixCommit, { detectorVersion: "0.9.0" });
  assert.throws(
    () => loadCorpus(manifestPath),
    /out-of-band measurement-definition change, not a repository regression/,
  );
  const rebaselineManifest = resolve(custody, "manifest-detector-1.0.0.json");
  const rebaselineReceipt = resolve(custody, "receipt-detector-1.0.0.json");
  const rebaseline = rebaselineCorpus(manifestPath, rebaselineManifest, rebaselineReceipt);
  assert.equal(rebaseline.measurementCorrection, true);
  assert.equal(rebaseline.comparisonDisposition, "out-of-band-not-regression");
  assert.equal(rebaseline.sourceDetectorVersion, "0.9.0");
  assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).detectorVersion, "0.9.0");
  assert.equal(loadCorpus(rebaselineManifest).detectorVersion, DETECTOR_VERSION);
  assert.equal(JSON.parse(readFileSync(rebaselineReceipt, "utf8")).operation, "rebaseline-corpus");
  assert.throws(
    () => rebaselineCorpus(manifestPath, rebaselineManifest, rebaselineReceipt),
    /rebaseline output already exists/,
  );

  const orphanManifest = resolve(custody, "must-not-survive.json");
  const occupiedReceipt = resolve(custody, "occupied-receipt.json");
  writeFileSync(occupiedReceipt, "historical receipt must survive\n");
  assert.throws(
    () => rebaselineCorpus(manifestPath, orphanManifest, occupiedReceipt),
    /rebaseline receipt already exists/,
  );
  assert.equal(existsSync(orphanManifest), false);
  assert.equal(readFileSync(occupiedReceipt, "utf8"), "historical receipt must survive\n");

  writeManifest(targetCommit, fixCommit);
  const existingReceipt = resolve(custody, "existing-receipt.json");
  writeFileSync(existingReceipt, "historical receipt must survive\n");
  const overwriteAttempt = spawnSync(
    process.execPath,
    [runnerPath, "qualify", manifestPath, "--receipt", existingReceipt],
    { encoding: "utf8" },
  );
  assert.notEqual(overwriteAttempt.status, 0);
  assert.match(overwriteAttempt.stderr, /EEXIST|file already exists/);
  assert.equal(readFileSync(existingReceipt, "utf8"), "historical receipt must survive\n");

  console.log(
    "historical evaluation verified: sealed contract, versioned detector, explicit rebaseline, red/green kill witness, history-free packet, hidden scoring, and leakage canary",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
