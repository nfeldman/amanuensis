#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SHA_40 = /^[a-f0-9]{40}$/;
const ID = /^[a-z0-9][a-z0-9._-]{2,79}$/;
export const CORPUS_SCHEMA_VERSION = "1.1.0";
export const RECEIPT_SCHEMA_VERSION = "1.1.0";
export const DETECTOR_VERSION = "1.0.0";
const VALID_TRUTH_STRENGTH = new Set([
  "executable-regression",
  "reproduction-plus-fix",
  "adjudicated-review",
]);
const RUNNER_PATH = fileURLToPath(import.meta.url);
const CONTRACT_PATH = resolve(
  dirname(RUNNER_PATH),
  "../contracts/historical-evaluation-corpus.schema.json",
);

function fail(message) {
  throw new Error(message);
}

function requireText(value, field, minimum = 1) {
  if (typeof value !== "string" || value.length < minimum) fail(`${field} must be text`);
  return value;
}

function requireExactKeys(value, field, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${field} keys must be exactly ${expected.join(", ")}; got ${actual.join(", ")}`);
  }
}

function requireStringArray(value, field, minimumLength = 1) {
  if (!Array.isArray(value) || value.length === 0) fail(`${field} must be a non-empty array`);
  value.forEach((item, index) => {
    requireText(item, `${field}[${index}]`, minimumLength);
  });
}

function requireDate(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) fail(`${field} must be YYYY-MM-DD`);
  const [year, month, day] = value.split("-").map(Number);
  const observed = new Date(Date.UTC(year, month - 1, day));
  if (
    observed.getUTCFullYear() !== year ||
    observed.getUTCMonth() !== month - 1 ||
    observed.getUTCDate() !== day
  ) {
    fail(`${field} must be a real calendar date`);
  }
}

function resolveCustodyPath(manifestDirectory, value, field) {
  requireText(value, field);
  if (isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    fail(`${field} must remain inside the manifest directory`);
  }
  const resolved = resolve(manifestDirectory, value);
  const rel = relative(manifestDirectory, resolved);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    fail(`${field} must name a file below the manifest directory`);
  }
  return resolved;
}

export function loadCorpus(manifestPath) {
  const absoluteManifest = resolve(manifestPath);
  const manifestDirectory = dirname(absoluteManifest);
  const corpus = JSON.parse(readFileSync(absoluteManifest, "utf8"));
  requireExactKeys(corpus, "corpus", [
    "schemaVersion",
    "detectorVersion",
    "programId",
    "created",
    "cases",
  ]);
  if (corpus.schemaVersion !== CORPUS_SCHEMA_VERSION) {
    fail(`schemaVersion must be ${CORPUS_SCHEMA_VERSION}`);
  }
  if (corpus.detectorVersion !== DETECTOR_VERSION) {
    fail(
      `detectorVersion ${corpus.detectorVersion ?? "missing"} does not match runner detector ` +
        `${DETECTOR_VERSION}; this is an out-of-band measurement-definition change, not a ` +
        "repository regression. Run the explicit rebaseline operation before comparing results.",
    );
  }
  if (!ID.test(corpus.programId ?? "")) fail("programId is invalid");
  requireDate(corpus.created, "created");
  if (!Array.isArray(corpus.cases) || corpus.cases.length === 0) {
    fail("cases must be a non-empty array");
  }

  const caseIds = new Set();
  const normalizedCases = corpus.cases.map((entry, index) => {
    const field = `cases[${index}]`;
    requireExactKeys(entry, field, [
      "caseId",
      "repository",
      "participant",
      "oracle",
      "leakage",
      "classification",
    ]);
    if (!ID.test(entry.caseId ?? "")) fail(`${field}.caseId is invalid`);
    if (caseIds.has(entry.caseId)) fail(`duplicate caseId ${entry.caseId}`);
    caseIds.add(entry.caseId);

    requireExactKeys(entry.repository, `${field}.repository`, [
      "root",
      "targetCommit",
      "fixCommit",
    ]);
    const repositoryRoot = resolve(requireText(entry.repository.root, `${field}.repository.root`));
    if (!SHA_40.test(entry.repository.targetCommit ?? "")) {
      fail(`${field}.repository.targetCommit must be a full lowercase commit SHA`);
    }
    if (!SHA_40.test(entry.repository.fixCommit ?? "")) {
      fail(`${field}.repository.fixCommit must be a full lowercase commit SHA`);
    }
    if (entry.repository.targetCommit === entry.repository.fixCommit) {
      fail(`${field} targetCommit and fixCommit must differ`);
    }

    requireExactKeys(entry.participant, `${field}.participant`, ["taskFile"]);
    const taskPath = resolveCustodyPath(
      manifestDirectory,
      entry.participant.taskFile,
      `${field}.participant.taskFile`,
    );
    requireExactKeys(entry.oracle, `${field}.oracle`, [
      "patchFile",
      "command",
      "timeoutMs",
      "workingDirectory",
    ]);
    const patchPath = resolveCustodyPath(
      manifestDirectory,
      entry.oracle.patchFile,
      `${field}.oracle.patchFile`,
    );
    requireStringArray(entry.oracle.command, `${field}.oracle.command`);
    if (
      !Number.isInteger(entry.oracle.timeoutMs) ||
      entry.oracle.timeoutMs < 1000 ||
      entry.oracle.timeoutMs > 3_600_000
    ) {
      fail(`${field}.oracle.timeoutMs must be an integer from 1000 to 3600000`);
    }
    const workingDirectory = entry.oracle.workingDirectory;
    requireText(workingDirectory, `${field}.oracle.workingDirectory`);
    if (isAbsolute(workingDirectory) || workingDirectory.split(/[\\/]/).includes("..")) {
      fail(`${field}.oracle.workingDirectory must remain inside the exported repository`);
    }

    requireExactKeys(entry.leakage, `${field}.leakage`, ["forbiddenFragments", "canaries"]);
    requireStringArray(entry.leakage.forbiddenFragments, `${field}.leakage.forbiddenFragments`, 8);
    requireStringArray(entry.leakage.canaries, `${field}.leakage.canaries`, 8);
    const fragments = [...entry.leakage.forbiddenFragments, ...entry.leakage.canaries];
    if (new Set(fragments).size !== fragments.length)
      fail(`${field}.leakage entries must be unique`);
    if (!entry.leakage.forbiddenFragments.includes(entry.repository.fixCommit)) {
      fail(`${field}.leakage.forbiddenFragments must include fixCommit`);
    }

    requireExactKeys(entry.classification, `${field}.classification`, [
      "language",
      "repositoryShape",
      "changeClass",
      "truthStrength",
    ]);
    for (const key of ["language", "repositoryShape", "changeClass"]) {
      requireText(entry.classification[key], `${field}.classification.${key}`);
    }
    if (!VALID_TRUTH_STRENGTH.has(entry.classification.truthStrength)) {
      fail(`${field}.classification.truthStrength is invalid`);
    }

    for (const [path, name] of [
      [repositoryRoot, `${field}.repository.root`],
      [taskPath, `${field}.participant.taskFile`],
      [patchPath, `${field}.oracle.patchFile`],
    ]) {
      if (!existsSync(path)) fail(`${name} does not exist: ${path}`);
    }

    return {
      ...entry,
      repository: { ...entry.repository, root: repositoryRoot },
      participant: { ...entry.participant, taskPath },
      oracle: { ...entry.oracle, patchPath },
    };
  });

  return {
    ...corpus,
    manifestPath: absoluteManifest,
    manifestDirectory,
    cases: normalizedCases,
  };
}

function run(command, options = {}) {
  const [executable, ...args] = command;
  const started = process.hrtime.bigint();
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...options.env },
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs: Math.round(durationMs),
  };
}

function mustRun(command, options, purpose) {
  const result = run(command, options);
  if (result.status !== 0) {
    fail(`${purpose} failed (${command.join(" ")})\n${result.stdout}\n${result.stderr}`.trim());
  }
  return result;
}

function git(repositoryRoot, args, purpose) {
  return mustRun(["git", "-C", repositoryRoot, ...args], {}, purpose);
}

function resolveCommit(caseRecord, field) {
  const requested = caseRecord.repository[field];
  const result = git(
    caseRecord.repository.root,
    ["rev-parse", "--verify", `${requested}^{commit}`],
    `resolve ${caseRecord.caseId} ${field}`,
  );
  const observed = result.stdout.trim();
  if (observed !== requested) fail(`${caseRecord.caseId} ${field} did not resolve exactly`);
  return observed;
}

function verifyAncestry(caseRecord) {
  const result = run([
    "git",
    "-C",
    caseRecord.repository.root,
    "merge-base",
    "--is-ancestor",
    caseRecord.repository.targetCommit,
    caseRecord.repository.fixCommit,
  ]);
  if (result.status !== 0) {
    fail(`${caseRecord.caseId} fixCommit must descend from targetCommit`);
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function digestFile(path) {
  return digest(readFileSync(path));
}

function walk(root, visit, current = root) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name);
    const rel = relative(root, path);
    if (entry.isDirectory()) {
      if (visit(path, rel, "directory") !== false) walk(root, visit, path);
    } else if (entry.isSymbolicLink()) {
      visit(path, rel, "symlink");
    } else if (entry.isFile()) {
      visit(path, rel, "file");
    }
  }
}

function leakageFragments(caseRecord) {
  return [...caseRecord.leakage.forbiddenFragments, ...caseRecord.leakage.canaries];
}

export function scanParticipantSurface(caseRecord, roots) {
  const fragments = leakageFragments(caseRecord);
  const violations = [];
  for (const root of roots.map((value) => resolve(value))) {
    if (!existsSync(root)) fail(`participant surface does not exist: ${root}`);
    const inspect = (path, rel, kind) => {
      if (rel.split(sep).includes(".git")) {
        violations.push(`${path}: participant surface contains Git metadata`);
        return false;
      }
      const names = [basename(path), rel];
      if (kind === "symlink") {
        const target = readlinkSync(path);
        names.push(target);
        const resolvedTarget = resolve(dirname(path), target);
        const targetRel = relative(root, resolvedTarget);
        if (isAbsolute(target) || targetRel === ".." || targetRel.startsWith(`..${sep}`)) {
          violations.push(`${path}: symlink escapes the participant surface`);
        }
      }
      for (const fragment of fragments) {
        if (names.some((value) => value.includes(fragment))) {
          violations.push(`${path}: leaked fragment in path or link target`);
        }
      }
      if (kind !== "file") return;
      const bytes = readFileSync(path);
      for (const fragment of fragments) {
        if (bytes.includes(Buffer.from(fragment))) {
          violations.push(`${path}: leaked forbidden fragment`);
        }
      }
    };
    if (lstatSync(root).isDirectory()) walk(root, inspect);
    else inspect(root, basename(root), lstatSync(root).isSymbolicLink() ? "symlink" : "file");
  }
  if (violations.length > 0)
    fail(`participant-surface leakage detected:\n${violations.join("\n")}`);
  return { checkedRoots: roots.length, forbiddenCount: fragments.length };
}

function exportCommit(caseRecord, commit, destination) {
  mkdirSync(destination, { recursive: true });
  const archive = resolve(dirname(destination), `${basename(destination)}.tar`);
  mustRun(
    ["git", "-C", caseRecord.repository.root, "archive", "--format=tar", "-o", archive, commit],
    {},
    `export ${caseRecord.caseId} ${commit}`,
  );
  mustRun(["tar", "-xf", archive, "-C", destination], {}, `extract ${caseRecord.caseId}`);
  rmSync(archive, { force: true });
  if (existsSync(resolve(destination, ".git"))) fail("clean export unexpectedly contains .git");
}

function treeDigest(root) {
  const entries = [];
  walk(root, (path, rel, kind) => {
    if (kind === "file") entries.push(`${rel}\0${digestFile(path)}`);
    else if (kind === "symlink") entries.push(`${rel}\0link:${readlinkSync(path)}`);
  });
  return digest(entries.sort().join("\n"));
}

function applyOracle(caseRecord, workspace) {
  mustRun(
    ["git", "apply", "--whitespace=nowarn", caseRecord.oracle.patchPath],
    { cwd: workspace },
    `apply hidden oracle for ${caseRecord.caseId}`,
  );
}

function executeOracle(caseRecord, workspace) {
  const cwd = resolve(workspace, caseRecord.oracle.workingDirectory);
  const rel = relative(workspace, cwd);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail(`${caseRecord.caseId} oracle working directory escaped the workspace`);
  }
  if (!existsSync(cwd) || !lstatSync(cwd).isDirectory()) {
    fail(`${caseRecord.caseId} oracle working directory does not exist`);
  }
  const result = run(caseRecord.oracle.command, {
    cwd,
    timeoutMs: caseRecord.oracle.timeoutMs,
    env: { AMANUENSIS_EVALUATION_CASE: caseRecord.caseId },
  });
  if (result.error?.code === "ETIMEDOUT") fail(`${caseRecord.caseId} oracle timed out`);
  if (result.error) {
    fail(
      `${caseRecord.caseId} oracle could not execute: ${result.error.code ?? result.error.message}`,
    );
  }
  if (result.status === null) fail(`${caseRecord.caseId} oracle ended without an exit status`);
  return {
    outcome: result.status === 0 ? "pass" : "fail",
    exitCode: result.status,
    signal: result.signal,
    durationMs: result.durationMs,
    outputDigest: digest(`${result.stdout}\n${result.stderr}`),
  };
}

function receiptBase(corpus, caseRecord) {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    detectorVersion: DETECTOR_VERSION,
    programId: corpus.programId,
    caseId: caseRecord.caseId,
    runnerDigest: digestFile(RUNNER_PATH),
    contractDigest: digestFile(CONTRACT_PATH),
    manifestDigest: digestFile(corpus.manifestPath),
    taskDigest: digestFile(caseRecord.participant.taskPath),
    oracleDigest: digestFile(caseRecord.oracle.patchPath),
    oracleCommandDigest: digest(JSON.stringify(caseRecord.oracle.command)),
  };
}

function selectCase(corpus, caseId) {
  const selected = corpus.cases.find((entry) => entry.caseId === caseId);
  if (!selected) fail(`unknown caseId ${caseId}`);
  return selected;
}

export function prepareCase(corpus, caseId, outputDirectory) {
  const caseRecord = selectCase(corpus, caseId);
  resolveCommit(caseRecord, "targetCommit");
  resolveCommit(caseRecord, "fixCommit");
  verifyAncestry(caseRecord);
  const output = resolve(outputDirectory);
  if (existsSync(output)) {
    if (!lstatSync(output).isDirectory() || readdirSync(output).length > 0) {
      fail(`output directory is not empty: ${output}`);
    }
  }
  mkdirSync(output, { recursive: true });
  exportCommit(caseRecord, caseRecord.repository.targetCommit, output);
  cpSync(caseRecord.participant.taskPath, resolve(output, "AMANUENSIS_TASK.md"));
  scanParticipantSurface(caseRecord, [output]);
  return {
    ...receiptBase(corpus, caseRecord),
    operation: "prepare",
    targetCommit: caseRecord.repository.targetCommit,
    participantTreeDigest: treeDigest(output),
    historyAbsent: !existsSync(resolve(output, ".git")),
    leakageChecked: true,
  };
}

function scoreWorkspace(caseRecord, sourceWorkspace) {
  if (!existsSync(sourceWorkspace) || !lstatSync(sourceWorkspace).isDirectory()) {
    fail(`participant workspace must be a directory: ${sourceWorkspace}`);
  }
  const scratch = mkdtempSync(resolve(tmpdir(), `amanuensis-score-${caseRecord.caseId}-`));
  const workspace = resolve(scratch, "workspace");
  try {
    scanParticipantSurface(caseRecord, [sourceWorkspace]);
    cpSync(resolve(sourceWorkspace), workspace, { recursive: true, verbatimSymlinks: true });
    if (existsSync(resolve(workspace, ".git")))
      fail("participant workspace contains forbidden .git history");
    applyOracle(caseRecord, workspace);
    return executeOracle(caseRecord, workspace);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function scoreCase(corpus, caseId, sourceWorkspace) {
  const caseRecord = selectCase(corpus, caseId);
  const result = scoreWorkspace(caseRecord, resolve(sourceWorkspace));
  return {
    ...receiptBase(corpus, caseRecord),
    operation: "score",
    participantTreeDigest: treeDigest(resolve(sourceWorkspace)),
    leakageChecked: true,
    ...result,
  };
}

function qualifyOne(corpus, caseRecord) {
  resolveCommit(caseRecord, "targetCommit");
  resolveCommit(caseRecord, "fixCommit");
  verifyAncestry(caseRecord);
  scanParticipantSurface(caseRecord, [caseRecord.participant.taskPath]);
  const scratch = mkdtempSync(resolve(tmpdir(), `amanuensis-qualify-${caseRecord.caseId}-`));
  try {
    const target = resolve(scratch, "target");
    const fix = resolve(scratch, "fix");
    exportCommit(caseRecord, caseRecord.repository.targetCommit, target);
    exportCommit(caseRecord, caseRecord.repository.fixCommit, fix);
    scanParticipantSurface(caseRecord, [target, caseRecord.participant.taskPath]);
    scanParticipantSurface(caseRecord, [fix, caseRecord.participant.taskPath]);
    const targetTreeDigest = treeDigest(target);
    const fixTreeDigest = treeDigest(fix);
    applyOracle(caseRecord, target);
    applyOracle(caseRecord, fix);
    const targetOracle = executeOracle(caseRecord, target);
    const fixOracle = executeOracle(caseRecord, fix);
    const qualified = targetOracle.outcome === "fail" && fixOracle.outcome === "pass";
    if (!qualified) {
      fail(
        `${caseRecord.caseId} kill witness failed: expected target=fail and fix=pass; ` +
          `observed target=${targetOracle.outcome}, fix=${fixOracle.outcome}`,
      );
    }
    return {
      ...receiptBase(corpus, caseRecord),
      operation: "qualify",
      targetCommit: caseRecord.repository.targetCommit,
      fixCommit: caseRecord.repository.fixCommit,
      targetTreeDigest,
      fixTreeDigest,
      targetOracle,
      fixOracle,
      historyAbsent: true,
      leakageChecked: true,
      qualified: true,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function qualifyCorpus(corpus, caseId) {
  const cases = caseId ? [selectCase(corpus, caseId)] : corpus.cases;
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    detectorVersion: DETECTOR_VERSION,
    programId: corpus.programId,
    operation: "qualify-corpus",
    caseCount: cases.length,
    cases: cases.map((entry) => qualifyOne(corpus, entry)),
  };
}

export function rebaselineCorpus(manifestPath, outputManifestPath, outputReceiptPath) {
  const absoluteManifest = resolve(manifestPath);
  const absoluteOutput = resolve(outputManifestPath);
  if (!outputReceiptPath) fail("rebaseline requires a new receipt path");
  const absoluteReceipt = resolve(outputReceiptPath);
  if (absoluteOutput === absoluteManifest) {
    fail("rebaseline must create a new manifest; the historical manifest is immutable");
  }
  if (absoluteReceipt === absoluteManifest || absoluteReceipt === absoluteOutput) {
    fail("rebaseline manifest and receipt paths must be distinct new identities");
  }
  if (dirname(absoluteOutput) !== dirname(absoluteManifest)) {
    fail("rebaseline output must remain beside the source manifest so custody paths do not move");
  }
  if (existsSync(absoluteOutput)) fail(`rebaseline output already exists: ${absoluteOutput}`);
  if (existsSync(absoluteReceipt)) fail(`rebaseline receipt already exists: ${absoluteReceipt}`);
  const original = JSON.parse(readFileSync(absoluteManifest, "utf8"));
  if (!original || typeof original !== "object" || Array.isArray(original)) {
    fail("corpus must be an object");
  }
  if (original.schemaVersion !== "1.0.0" && original.schemaVersion !== CORPUS_SCHEMA_VERSION) {
    fail(`rebaseline supports corpus schema 1.0.0 or ${CORPUS_SCHEMA_VERSION}`);
  }
  const sourceSchemaVersion = original.schemaVersion;
  const sourceDetectorVersion = original.detectorVersion ?? null;
  const rebased = {
    ...original,
    schemaVersion: CORPUS_SCHEMA_VERSION,
    detectorVersion: DETECTOR_VERSION,
  };
  const serialized = `${JSON.stringify(rebased, null, 2)}\n`;
  const temporaryManifest = resolve(
    dirname(absoluteManifest),
    `.${basename(absoluteManifest)}.rebaseline-${process.pid}`,
  );
  try {
    writeFileSync(temporaryManifest, serialized);
    const qualification = qualifyCorpus(loadCorpus(temporaryManifest));
    const receipt = {
      ...qualification,
      operation: "rebaseline-corpus",
      sourceSchemaVersion,
      sourceDetectorVersion,
      measurementCorrection: true,
      comparisonDisposition: "out-of-band-not-regression",
    };
    let manifestCreated = false;
    let receiptCreated = false;
    try {
      writeFileSync(absoluteOutput, serialized, { flag: "wx" });
      manifestCreated = true;
      writeFileSync(absoluteReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
      receiptCreated = true;
    } catch (error) {
      if (receiptCreated) rmSync(absoluteReceipt, { force: true });
      if (manifestCreated) rmSync(absoluteOutput, { force: true });
      throw error;
    }
    return receipt;
  } finally {
    rmSync(temporaryManifest, { force: true });
  }
}

function usage() {
  return [
    "usage:",
    "  historical-evaluation.mjs qualify <manifest.json> [case-id] [--receipt path]",
    "  historical-evaluation.mjs rebaseline <manifest.json> <new-manifest.json> --receipt <new-receipt.json>",
    "  historical-evaluation.mjs prepare <manifest.json> <case-id> <output-dir> [--receipt path]",
    "  historical-evaluation.mjs score <manifest.json> <case-id> <workspace> [--receipt path]",
  ].join("\n");
}

function parseCli(args) {
  const receiptIndex = args.indexOf("--receipt");
  let receiptPath;
  let positional = args;
  if (receiptIndex !== -1) {
    receiptPath = args[receiptIndex + 1];
    if (!receiptPath) fail("--receipt requires a path");
    positional = [...args.slice(0, receiptIndex), ...args.slice(receiptIndex + 2)];
  }
  return { args: positional, receiptPath };
}

function main(argv) {
  const { args, receiptPath } = parseCli(argv);
  const [operation, manifestPath, caseId, path] = args;
  if (!operation || !manifestPath) fail(usage());
  let receipt;
  if (operation === "rebaseline" && caseId && args.length === 3) {
    if (!receiptPath) fail("rebaseline requires a new --receipt path");
    receipt = rebaselineCorpus(manifestPath, caseId, receiptPath);
  } else {
    const corpus = loadCorpus(manifestPath);
    if (operation === "qualify" && args.length <= 3) receipt = qualifyCorpus(corpus, caseId);
    else if (operation === "prepare" && caseId && path && args.length === 4) {
      receipt = prepareCase(corpus, caseId, path);
    } else if (operation === "score" && caseId && path && args.length === 4) {
      receipt = scoreCase(corpus, caseId, path);
    } else fail(usage());
  }
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (receiptPath && operation !== "rebaseline") {
    writeFileSync(resolve(receiptPath), serialized, { flag: "wx" });
  }
  process.stdout.write(serialized);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
