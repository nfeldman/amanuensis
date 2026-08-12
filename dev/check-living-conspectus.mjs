#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, "..");
const VALID_DISPOSITIONS = new Set([
  "confirmed-bug",
  "confirmed-acceptable",
  "ruled-out",
  "out-of-scope",
  "unresolved-competition",
]);
const REQUIRED_CONTROL_CLASSES = [
  "unchanged",
  "marker",
  "benign-refactor",
  "historical-defect",
  "direct-invalidation",
  "cross-seam",
  "incoherent-request",
  "export-fan-in",
];

function parseArgs(argv) {
  const options = { mode: "check" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--print-report") {
      options.mode = "print-report";
      continue;
    }
    if (["--root", "--fixture", "--report", "--export", "--read-back"].includes(argument)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      options[argument.slice(2).replace("-", "_")] = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${argument}`);
  }
  if (options.export && options.read_back) {
    throw new Error("--export and --read-back are separate operations");
  }
  return options;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function sameSet(left, right) {
  const a = sortedUnique(left);
  const b = sortedUnique(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function addObligation(state, id, satisfied, detail) {
  state.required.push(id);
  if (satisfied) state.satisfied.push(id);
  else state.missing.push({ id, detail });
}

function addStructuralError(state, id, detail) {
  state.errors.push({ id, detail });
}

export function runControl(control, manifest) {
  const input = control?.input ?? {};
  switch (control?.class) {
    case "unchanged": {
      const runs = (manifest.runs ?? []).filter(({ condition }) => condition === "unchanged-baseline");
      return {
        replicatesRemainSeparate:
          new Set(runs.map(({ runId }) => runId)).size === runs.length &&
          new Set(runs.map(({ replicateId }) => replicateId)).size === runs.length,
        criticalStatusAgreement:
          runs.length >= 2 &&
          runs.every(
            (run) =>
              sameSet(run.dispatched ?? [], runs[0].dispatched ?? []) &&
              sameSet(run.landed ?? [], runs[0].landed ?? []) &&
              sameSet(run.scored ?? [], runs[0].scored ?? []),
          ),
      };
    }
    case "marker": {
      const score = (payload) => sha256(stableJson(payload));
      return {
        surfaceMatched: stableJson(input.cleanPayload) === stableJson(input.markedPayload),
        markerDirectionalEffect: score(input.cleanPayload) !== score(input.markedPayload),
      };
    }
    case "benign-refactor": {
      const behaviorStable = input.before?.behaviorHash === input.after?.behaviorHash;
      return {
        repairedEvidenceLocations: behaviorStable ? [input.after?.evidenceLocation].filter(Boolean) : [],
        unrelatedInvalidations: behaviorStable ? [] : input.dependentClaimIds ?? [],
      };
    }
    case "historical-defect": {
      const hasRepairEvidence = (input.repairRevisionEvidenceIds ?? []).length > 0;
      return {
        originalRevision: input.originalRevision,
        repairedRevision: input.repairedRevision,
        originalFindingStatus: input.originalFindingStatus,
        repairedFindingStatus: hasRepairEvidence ? "verified-fixed" : "fixed-pending-verification",
        repairRevisionEvidenceIds: input.repairRevisionEvidenceIds ?? [],
      };
    }
    case "direct-invalidation": {
      const currentAuthority = input.evidenceAnchorPresent === true;
      return {
        currentAuthority,
        revalidationObligationId: currentAuthority ? null : input.revalidationObligationId,
      };
    }
    case "cross-seam":
      return {
        localChecksGreen: input.localChecksGreen === true,
        integralStatus:
          input.localChecksGreen === true && input.crossSeamDefect === true ? "blocked" : "passed",
        seamId: input.seamId,
      };
    case "incoherent-request": {
      const underdetermined = input.goalsConflict === true && input.priority == null;
      return {
        status: underdetermined ? "underdetermined" : "determined",
        humanDecisionRequired: underdetermined,
        selectedOption: underdetermined ? null : input.priority,
      };
    }
    case "export-fan-in": {
      const expected = input.expectedWork ?? [];
      return {
        stateCorruptionRejected: input.stateHash !== input.expectedStateHash,
        coverageCorruptionRejected: input.coverageHash !== input.expectedCoverageHash,
        contentCorruptionRejected: input.contentHash !== input.expectedContentHash,
        missingLandedRejected: !sameSet(input.landed ?? [], expected),
        missingScoredRejected: !sameSet(input.scored ?? [], expected),
      };
    }
    default:
      return null;
  }
}

function authoritativeObjectIds(manifest) {
  const ids = [];
  for (const subsystem of manifest.subsystems ?? []) ids.push(`subsystem:${subsystem.id}`);
  for (const path of manifest.inventory?.paths ?? []) ids.push(`file:${path}`);
  for (const coverage of manifest.concernCoverage ?? []) {
    for (const code of Object.keys(coverage.dispositions ?? {})) {
      ids.push(`disposition:${coverage.subsystemId}/${code}`);
    }
  }
  for (const seam of manifest.seams ?? []) ids.push(`seam:${seam.id}`);
  return sortedUnique(ids);
}

export function expectedProjection(manifest) {
  const subsystemIds = sortedUnique((manifest.subsystems ?? []).map(({ id }) => id));
  const concernIds = sortedUnique(manifest.concerns?.active ?? []);
  const seamIds = sortedUnique((manifest.seams ?? []).map(({ id }) => id));
  const runIds = sortedUnique((manifest.runs ?? []).map(({ runId }) => runId));
  const filePaths = sortedUnique(manifest.inventory?.paths ?? []);
  const dispositionIds = sortedUnique(
    (manifest.concernCoverage ?? []).flatMap((coverage) =>
      Object.keys(coverage.dispositions ?? {}).map(
        (code) => `${coverage.subsystemId}/${code}`,
      ),
    ),
  );
  const expectedWork = sortedUnique(manifest.runContract?.expectedWork ?? []);
  const state = {
    fixtureId: manifest.fixtureId,
    revision: manifest.revision,
    subsystemIds,
    concernIds,
    seamIds,
    runIds,
  };
  const coverage = {
    filePaths,
    dispositionIds,
    seamEndpointCount: (manifest.seams ?? []).length * 2,
    expectedWork,
  };
  const content = { authoritativeObjectIds: authoritativeObjectIds(manifest) };
  return {
    schemaVersion: 1,
    state,
    coverage,
    content,
    hashes: {
      state: sha256(stableJson(state)),
      coverage: sha256(stableJson(coverage)),
      content: sha256(stableJson(content)),
    },
  };
}

export function evaluateConspectus(manifest) {
  const state = { required: [], satisfied: [], missing: [], errors: [] };
  const paths = manifest.inventory?.paths ?? [];
  const uniquePaths = sortedUnique(paths);
  if (paths.length !== uniquePaths.length) {
    addStructuralError(state, "inventory:unique-paths", "inventory contains duplicate paths");
  }
  if (manifest.inventory?.fileCount !== uniquePaths.length) {
    addStructuralError(
      state,
      "inventory:file-count",
      `declared ${manifest.inventory?.fileCount}, observed ${uniquePaths.length}`,
    );
  }
  const inventoryHash = sha256(`${uniquePaths.join("\n")}\n`);
  if (manifest.inventory?.pathsSha256 !== inventoryHash) {
    addStructuralError(
      state,
      "inventory:paths-sha256",
      `declared ${manifest.inventory?.pathsSha256}, observed ${inventoryHash}`,
    );
  }

  const assignments = new Map();
  for (const group of manifest.inventory?.assignments ?? []) {
    for (const path of group.files ?? []) {
      if (!assignments.has(path)) assignments.set(path, []);
      assignments.get(path).push(`subsystem:${group.subsystemId}`);
    }
  }
  for (const exclusion of manifest.inventory?.exclusions ?? []) {
    if (!assignments.has(exclusion.path)) assignments.set(exclusion.path, []);
    assignments.get(exclusion.path).push(`exclusion:${exclusion.owner ?? ""}`);
    addObligation(
      state,
      `file:${exclusion.path}:exclusion-reason`,
      Boolean(exclusion.owner && exclusion.reason),
      "explicit exclusions require an owner and reason",
    );
  }
  for (const path of uniquePaths) {
    const destinations = assignments.get(path) ?? [];
    addObligation(
      state,
      `file:${path}:assignment`,
      destinations.length === 1,
      destinations.length === 0
        ? "tracked file has no subsystem assignment or explicit exclusion"
        : `tracked file has ${destinations.length} destinations: ${destinations.join(", ")}`,
    );
  }
  for (const path of assignments.keys()) {
    if (!uniquePaths.includes(path)) {
      addStructuralError(state, `file:${path}:unknown`, "assignment names a path outside inventory");
    }
  }

  const subsystemIds = new Set((manifest.subsystems ?? []).map(({ id }) => id));
  for (const subsystem of manifest.subsystems ?? []) {
    addObligation(
      state,
      `subsystem:${subsystem.id}:phase-sequence`,
      subsystem.status === "mapped" && sameSet(subsystem.completedPhases ?? [], [
        "scope",
        "structural",
        "concerns",
        "adversarial",
        "packaging",
      ]),
      `expected mapped with scope, structural, concerns, adversarial, packaging; observed ${subsystem.status}`,
    );
  }
  for (const group of manifest.inventory?.assignments ?? []) {
    if (!subsystemIds.has(group.subsystemId)) {
      addStructuralError(
        state,
        `subsystem:${group.subsystemId}:unknown`,
        "inventory assignment refers to unknown subsystem",
      );
    }
  }

  const activeConcerns = sortedUnique(manifest.concerns?.active ?? []);
  const coverageBySubsystem = new Map(
    (manifest.concernCoverage ?? []).map((coverage) => [coverage.subsystemId, coverage]),
  );
  for (const subsystemId of subsystemIds) {
    const coverage = coverageBySubsystem.get(subsystemId);
    for (const concernCode of activeConcerns) {
      const disposition = coverage?.dispositions?.[concernCode];
      addObligation(
        state,
        `concern:${subsystemId}/${concernCode}:disposition`,
        Boolean(
          coverage?.evidence?.length && disposition && VALID_DISPOSITIONS.has(disposition),
        ),
        disposition
          ? `invalid or ungrounded disposition ${disposition}`
          : "active concern has no terminal evidence-backed disposition",
      );
    }
    for (const concernCode of Object.keys(coverage?.dispositions ?? {})) {
      if (!activeConcerns.includes(concernCode)) {
        addStructuralError(
          state,
          `concern:${subsystemId}/${concernCode}:unknown`,
          "disposition names a concern outside the active checklist",
        );
      }
    }
  }

  for (const seam of manifest.seams ?? []) {
    for (const endpoint of [seam.partyA, seam.partyB]) {
      const subsystem = (manifest.subsystems ?? []).find(({ id }) => id === endpoint);
      addObligation(
        state,
        `seam:${seam.id}:endpoint:${endpoint ?? "missing"}`,
        Boolean(subsystem && subsystem.status === "mapped"),
        "seam endpoint must name a mapped subsystem",
      );
    }
    addObligation(
      state,
      `seam:${seam.id}:integral-assessment`,
      Boolean(seam.assessment?.status === "passed" && seam.assessment?.evidence?.length),
      "seam requires a passed integral assessment with evidence",
    );
  }

  const expectedWork = sortedUnique(manifest.runContract?.expectedWork ?? []);
  const runIds = new Set();
  const replicateIds = new Set();
  for (const run of manifest.runs ?? []) {
    if (runIds.has(run.runId)) addStructuralError(state, `run:${run.runId}:unique`, "duplicate run id");
    if (replicateIds.has(run.replicateId)) {
      addStructuralError(state, `replicate:${run.replicateId}:unique`, "duplicate replicate id");
    }
    runIds.add(run.runId);
    replicateIds.add(run.replicateId);
    for (const workId of expectedWork) {
      addObligation(
        state,
        `run:${run.runId}:dispatched:${workId}`,
        (run.dispatched ?? []).includes(workId),
        "expected work was not dispatched",
      );
      addObligation(
        state,
        `run:${run.runId}:landed:${workId}`,
        (run.landed ?? []).includes(workId),
        "dispatched work did not land durably",
      );
      addObligation(
        state,
        `run:${run.runId}:scored:${workId}`,
        (run.scored ?? []).includes(workId),
        "landed work was not scored",
      );
    }
    for (const field of ["dispatched", "landed", "scored"]) {
      const extras = sortedUnique(run[field] ?? []).filter((workId) => !expectedWork.includes(workId));
      if (extras.length) {
        addStructuralError(
          state,
          `run:${run.runId}:${field}:unknown`,
          `unexpected work: ${extras.join(", ")}`,
        );
      }
    }
  }
  addObligation(
    state,
    "run:unchanged-replicates:minimum-two",
    (manifest.runs ?? []).filter(({ condition }) => condition === "unchanged-baseline").length >= 2,
    "test-retest requires at least two separately identified unchanged-baseline runs",
  );

  const actualControlClasses = new Set((manifest.controls ?? []).map(({ class: value }) => value));
  for (const controlClass of REQUIRED_CONTROL_CLASSES) {
    const control = (manifest.controls ?? []).find(({ class: value }) => value === controlClass);
    addObligation(
      state,
      `control:${controlClass}:specified`,
      Boolean(control?.id && control?.expectedRedProof),
      "required control class needs an id and expected red proof",
    );
    addObligation(
      state,
      `control:${controlClass}:behavior`,
      Boolean(
        control?.expectedObservation &&
          stableJson(runControl(control, manifest)) === stableJson(control.expectedObservation),
      ),
      "control observation does not match its pre-registered expected behavior",
    );
  }
  for (const controlClass of actualControlClasses) {
    if (!REQUIRED_CONTROL_CLASSES.includes(controlClass)) {
      addStructuralError(state, `control:${controlClass}:unknown`, "unknown control class");
    }
  }

  const projection = expectedProjection(manifest);
  for (const axis of ["state", "coverage", "content"]) {
    addObligation(
      state,
      `export:${axis}:read-back`,
      manifest.export?.readBackHashes?.[axis] === projection.hashes[axis],
      `expected ${projection.hashes[axis]}, observed ${manifest.export?.readBackHashes?.[axis] ?? "missing"}`,
    );
  }

  return {
    complete: state.missing.length === 0 && state.errors.length === 0,
    fixtureId: manifest.fixtureId,
    required: state.required.length,
    satisfied: state.satisfied.length,
    missing: state.missing,
    errors: state.errors,
    authoritativeObjectIds: authoritativeObjectIds(manifest),
    projection,
  };
}

function reconciledObligationIds(manifest) {
  const expectedWork = manifest.runContract?.expectedWork ?? [];
  return (manifest.runs ?? []).flatMap((run) =>
    ["dispatched", "landed", "scored"].flatMap((stage) =>
      expectedWork.map((workId) => `run:${run.runId}:${stage}:${workId}`),
    ),
  );
}

export function buildBaselineReport(manifest, result = evaluateConspectus(manifest)) {
  const reconciliationIds = reconciledObligationIds(manifest);
  const expectedWork = manifest.runContract?.expectedWork ?? [];
  const reconciliationSatisfied = (manifest.runs ?? []).reduce(
    (total, run) =>
      total +
      ["dispatched", "landed", "scored"].reduce(
        (stageTotal, stage) =>
          stageTotal + expectedWork.filter((workId) => (run[stage] ?? []).includes(workId)).length,
        0,
      ),
    0,
  );
  const m1Step = result.required > 0 ? 1 / result.required : null;
  const m11Step = result.authoritativeObjectIds.length > 0
    ? 1 / result.authoritativeObjectIds.length
    : null;
  const m12Step = reconciliationIds.length > 0 ? 1 / reconciliationIds.length : null;
  const replicates = (manifest.runs ?? [])
    .filter(({ condition }) => condition === "unchanged-baseline")
    .map((run) => {
      const blockingObligationIds = ["dispatched", "landed", "scored"].flatMap((stage) =>
        expectedWork
          .filter((workId) => !(run[stage] ?? []).includes(workId))
          .map((workId) => `run:${run.runId}:${stage}:${workId}`),
      );
      return {
        runId: run.runId,
        replicateId: run.replicateId,
        condition: run.condition,
        criticalStatus: blockingObligationIds.length === 0 ? "complete" : "incomplete",
        blockingObligationIds,
        authoritativeObjectCount: result.authoritativeObjectIds.length,
        authoritativeObjectSetHash: sha256(`${result.authoritativeObjectIds.join("\n")}\n`),
      };
    });
  const criticalStatuses = new Set(replicates.map(({ criticalStatus }) => criticalStatus));
  const blockingSets = new Set(
    replicates.map(({ blockingObligationIds }) => stableJson(blockingObligationIds)),
  );
  return {
    schemaVersion: 1,
    fixtureId: manifest.fixtureId,
    revision: manifest.revision,
    tree: manifest.tree,
    practiceCatalog: manifest.practiceCatalog,
    runtimeConfiguration: manifest.runtimeConfiguration,
    denominators: {
      trackedFiles: manifest.inventory?.fileCount ?? 0,
      explicitExclusions: manifest.inventory?.exclusions?.length ?? 0,
      subsystems: manifest.subsystems?.length ?? 0,
      activeConcerns: manifest.concerns?.active?.length ?? 0,
      concernDispositions: (manifest.concernCoverage ?? []).reduce(
        (sum, coverage) => sum + Object.keys(coverage.dispositions ?? {}).length,
        0,
      ),
      seams: manifest.seams?.length ?? 0,
      seamEndpoints: (manifest.seams?.length ?? 0) * 2,
      runs: manifest.runs?.length ?? 0,
      workPerRun: manifest.runContract?.expectedWork?.length ?? 0,
      completionObligations: result.required,
      authoritativeObjects: result.authoritativeObjectIds.length,
      reconciliationObligations: reconciliationIds.length,
      controls: manifest.controls?.length ?? 0,
    },
    exclusions: manifest.inventory?.exclusions ?? [],
    metrics: {
      M1: {
        value: result.required ? result.satisfied / result.required : 0,
        numerator: result.satisfied,
        denominator: result.required,
        stepSize: m1Step,
      },
      M11: {
        criticalStatusAgreement: replicates.length >= 2 && criticalStatuses.size === 1,
        blockingObligationIdAgreement: replicates.length >= 2 && blockingSets.size === 1,
        authoritativeObjectJaccard: replicates.length >= 2 ? 1 : null,
        jaccardStepSize: m11Step,
        replicates,
      },
      M12: {
        value: reconciliationIds.length ? reconciliationSatisfied / reconciliationIds.length : 0,
        numerator: reconciliationSatisfied,
        denominator: reconciliationIds.length,
        stepSize: m12Step,
      },
    },
    minimumDetectableEffects: {
      M1: m1Step,
      M11Jaccard: m11Step,
      M12: m12Step,
      statisticalMde: "not estimable from n=2; report discrete one-obligation step sizes only",
    },
    controlIds: (manifest.controls ?? []).map(({ id }) => id),
    result: {
      complete: result.complete,
      missing: result.missing,
      errors: result.errors,
    },
  };
}

function compareReport(expected, actual) {
  return stableJson(expected) === stableJson(actual);
}

function verifyPinnedRepository(root, manifest) {
  if (!existsSync(resolve(root, ".git"))) return [];
  const failures = [];
  const runGit = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const tree = runGit(["rev-parse", `${manifest.revision}^{tree}`]);
  if (tree.status !== 0) {
    return [{ id: "fixture:revision:resolves", detail: tree.stderr.trim() || "pinned revision is unavailable" }];
  }
  if (tree.stdout.trim() !== manifest.tree) {
    failures.push({
      id: "fixture:tree:matches",
      detail: `expected ${manifest.tree}, observed ${tree.stdout.trim()}`,
    });
  }
  const listing = runGit(["ls-tree", "-r", "--name-only", manifest.revision]);
  if (listing.status !== 0) {
    failures.push({ id: "fixture:inventory:readable", detail: listing.stderr.trim() });
    return failures;
  }
  const observed = listing.stdout.split("\n").filter(Boolean).sort();
  const expected = sortedUnique(manifest.inventory?.paths ?? []);
  if (!sameSet(observed, expected)) {
    const missing = expected.filter((path) => !observed.includes(path));
    const extra = observed.filter((path) => !expected.includes(path));
    failures.push({
      id: "fixture:inventory:matches-pinned-tree",
      detail: `missing from tree: ${missing.join(", ") || "none"}; unmanifested in tree: ${extra.join(", ") || "none"}`,
    });
  }
  return failures;
}

function writeProjection(outputDir, projection) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "conspectus-summary.json"), `${JSON.stringify(projection, null, 2)}\n`);
}

function readBackProjection(outputDir, expected) {
  const path = resolve(outputDir, "conspectus-summary.json");
  let actual;
  try {
    actual = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return [{ id: "export:projection:readable", detail: error.message }];
  }
  const failures = [];
  for (const axis of ["state", "coverage", "content"]) {
    if (actual.hashes?.[axis] !== expected.hashes[axis]) {
      failures.push({ id: `export:${axis}:read-back`, expected: expected.hashes[axis], actual: actual.hashes?.[axis] });
    }
    if (sha256(stableJson(actual[axis])) !== expected.hashes[axis]) {
      failures.push({ id: `export:${axis}:content`, detail: "content does not match its expected durable hash" });
    }
  }
  return failures;
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const root = resolve(cli.root ?? DEFAULT_ROOT);
  const fixturePath = resolve(root, cli.fixture ?? "dev/conspectus/self-baseline.json");
  const reportPath = resolve(root, cli.report ?? "dev/conspectus/baseline-report.json");
  const manifest = JSON.parse(readFileSync(fixturePath, "utf8"));
  const result = evaluateConspectus(manifest);
  result.errors.push(...verifyPinnedRepository(root, manifest));
  result.complete = result.complete && result.errors.length === 0;
  const generatedReport = buildBaselineReport(manifest, result);

  if (cli.mode === "print-report") {
    process.stdout.write(`${JSON.stringify(generatedReport, null, 2)}\n`);
    return;
  }

  if (cli.export) {
    writeProjection(resolve(cli.export), result.projection);
  }
  let readBackFailures = [];
  if (cli.read_back) {
    readBackFailures = readBackProjection(resolve(cli.read_back), result.projection);
  }

  let reportMatches = true;
  try {
    const checkedInReport = JSON.parse(readFileSync(reportPath, "utf8"));
    reportMatches = compareReport(checkedInReport, generatedReport);
  } catch (error) {
    reportMatches = false;
    result.errors.push({ id: "baseline-report:readable", detail: error.message });
  }
  if (!reportMatches) {
    result.errors.push({ id: "baseline-report:derived", detail: "checked-in report differs from the manifest-derived report" });
  }
  result.errors.push(...readBackFailures);
  result.complete = result.complete && reportMatches && readBackFailures.length === 0;

  if (cli.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (result.complete) {
    process.stdout.write(
      `living conspectus complete: ${result.satisfied}/${result.required} obligations; ${result.authoritativeObjectIds.length} authoritative objects\n`,
    );
  } else {
    for (const failure of [...result.missing, ...result.errors]) {
      process.stderr.write(`RED ${failure.id}: ${failure.detail ?? "unsatisfied"}\n`);
    }
  }
  process.exitCode = result.complete ? 0 : 1;
}

if (process.argv[1] && basename(process.argv[1]) === "check-living-conspectus.mjs") main();
