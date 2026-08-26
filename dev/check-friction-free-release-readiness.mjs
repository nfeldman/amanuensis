#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredInitiatives = ["A19", "A20", "A21", "A22", "A23", "A24", "A25"];
const fixtureAcceptanceCounts = new Map(
  requiredInitiatives.map((id) => [id, id === "A19" ? 4 : 3]),
);
const requiredMigrations = [
  "hard-coded-global",
  "conflicting-user-project",
  "upgrade",
  "rollback",
  "uninstall",
];
const requiredRestarts = [
  ["initial-installation", 1],
  ["per-repository", 0],
  ["ordinary-first-use", 0],
  ["upgrade", 1],
  ["rollback", 1],
  ["uninstall", 1],
];

function parseArgs(argv) {
  let reportPath;
  let caseId;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--report") reportPath = resolve(argv[++index]);
    else if (argv[index] === "--case") caseId = argv[++index];
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!reportPath) {
    throw new Error("usage: check-friction-free-release-readiness.mjs --report PATH [--case ID]");
  }
  return { reportPath, caseId };
}

function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function pointerParent(target, pointer) {
  const segments = pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let parent = target;
  for (const segment of segments.slice(0, -1)) parent = parent[segment];
  return { parent, key: segments.at(-1) };
}

function applyOperation(target, operation) {
  const { parent, key } = pointerParent(target, operation.pointer);
  if (operation.operation !== "remove")
    throw new Error(`unknown operation: ${operation.operation}`);
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else delete parent[key];
}

function loadReport(path, caseId) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!caseId) return parsed.baseReport ?? parsed;
  if (parsed.fixtureId !== "a26-friction-free-release-readiness-red-matrix") {
    throw new Error("--case requires the A26 release-readiness red fixture");
  }
  const selected = parsed.cases.find((candidate) => candidate.caseId === caseId);
  if (!selected) throw new Error(`unknown A26 red case: ${caseId}`);
  const report = structuredClone(parsed.baseReport);
  for (const operation of selected.operations) applyOperation(report, operation);
  return report;
}

function validateReference(reference, label, errors) {
  if (!reference?.path || !reference?.sha256) {
    errors.push(`[${label}] evidence reference is missing`);
    return null;
  }
  if (isAbsolute(reference.path)) {
    errors.push(`[${label}] evidence path is absolute`);
    return null;
  }
  const path = resolve(root, reference.path);
  if (!isWithin(root, path) || !existsSync(path)) {
    errors.push(`[${label}] evidence path is absent or external`);
    return null;
  }
  const bytes = readFileSync(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== reference.sha256) errors.push(`[${label}] evidence digest drifted`);
  return bytes;
}

function referenceJson(reference, label, errors) {
  const bytes = validateReference(reference, label, errors);
  if (!bytes) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    errors.push(`[${label}] evidence is not JSON: ${error.message}`);
    return null;
  }
}

function initiativeMap() {
  const roadmap = JSON.parse(readFileSync(resolve(root, "dev/roadmap.json"), "utf8"));
  return new Map(
    roadmap.stages.flatMap((stage) => stage.initiatives).map((item) => [item.id, item]),
  );
}

function historicalRedGateHalted(receipt) {
  if (receipt?.initiative === "A25") {
    return (
      receipt.redGate?.preImplementation?.casesObservedExitingNonzero >= 3 &&
      receipt.redGate?.landed?.pooledRuns === 0
    );
  }
  return (
    receipt?.redGate?.preRepair?.exitCode !== 0 && receipt?.redGate?.postRepair?.exitCode === 0
  );
}

function validateCandidateSuite(report, errors) {
  const suite = referenceJson(report.candidateSuite?.evidence, "candidate-suite", errors);
  if (!suite) return;
  if (
    suite.contractVersion !== "amanuensis-friction-free-candidate-suite/v1" ||
    suite.result !== "passed"
  ) {
    errors.push("candidate suite is not a passed current-candidate receipt");
  }
  if (
    suite.aggregation !== "none" ||
    suite.commandCount < 19 ||
    suite.passedCommandCount !== suite.commandCount ||
    suite.results?.length !== suite.commandCount ||
    suite.results.some(({ exitCode }) => exitCode !== 0)
  ) {
    errors.push("candidate suite command denominator is not independently green");
  }
  if (
    report.candidateSuite?.status !== suite.result ||
    report.candidateSuite?.commandCount !== suite.commandCount ||
    report.candidateSuite?.passedCommandCount !== suite.passedCommandCount ||
    report.candidateSuite?.aggregation !== suite.aggregation
  ) {
    errors.push("candidate suite projection drifted");
  }
  for (const [index, reference] of (suite.candidateFileManifest ?? []).entries()) {
    validateReference(reference, `candidate-file:${index}`, errors);
  }
}

function validateCleanReplay(report, errors) {
  const replay = referenceJson(report.cleanReplay?.evidence, "clean-replay", errors);
  if (!replay) return null;
  if (
    replay.contractVersion !== "amanuensis-friction-free-clean-replay/v1" ||
    replay.result !== "passed" ||
    replay.commands?.some(({ exitCode }) => exitCode !== 0)
  ) {
    errors.push("clean replay is not independently green");
  }
  for (const field of [
    "sourceCheckout",
    "packedPackage",
    "configurationMigration",
    "interruption",
    "upgrade",
    "rollback",
    "uninstall",
    "documentationReadBack",
  ]) {
    if (replay.cleanReplay?.[field] !== "passed" || report.cleanReplay?.[field] !== "passed") {
      errors.push(`[clean-replay:${field}] result is not passed`);
    }
  }
  const rehearsal = replay.rollbackRehearsal;
  if (
    rehearsal?.result !== "passed" ||
    rehearsal?.isolation?.logicalRepositoryCount !== 5 ||
    rehearsal?.candidate?.installedVersionAfterRollback !== rehearsal?.candidate?.packageVersion ||
    rehearsal?.lifecycle?.rollback?.exactCandidateTarballReinstalled !== true ||
    rehearsal?.lifecycle?.rollback?.restoredSkillDigest !== rehearsal?.candidate?.skillDigest ||
    rehearsal?.lostConspectusCount !== 0 ||
    rehearsal?.skillArchiveCount !== 0 ||
    rehearsal?.storeCustody?.length !== 5 ||
    rehearsal.storeCustody.some(
      ({ preserved, digestBefore, digestAfter }) => !preserved || digestBefore !== digestAfter,
    )
  ) {
    errors.push("clean rollback/store-custody rehearsal drifted");
  }
  if (
    replay.realHostEvidence?.logicalRepositoryCount !== 5 ||
    replay.realHostEvidence?.workspaceCount !== 6 ||
    replay.realHostEvidence?.independentRunCount !== 6 ||
    replay.realHostEvidence?.failedRunCount !== 0 ||
    replay.realHostEvidence?.aggregation !== "none"
  ) {
    errors.push("clean replay's real-host evidence reference drifted");
  }
  validateReference(replay.realHostEvidence, "clean-replay-real-host", errors);
  if (
    replay.documentationReadBack?.status !== "passed" ||
    replay.documentationReadBack?.passedCheckCount !== replay.documentationReadBack?.checkCount
  ) {
    errors.push("documentation read-back denominator drifted");
  }
  for (const reference of replay.documentationReadBack?.documents ?? []) {
    validateReference(reference, "documentation-read-back", errors);
  }
  return replay;
}

function validate(report) {
  const errors = [];
  const fixtureMode = report.evidenceMode === "fixture-red";
  if (report.schemaVersion !== 1) errors.push("schema version drifted");
  if (report.contractVersion !== "amanuensis-friction-free-release-readiness/v1") {
    errors.push("release-readiness contract version drifted");
  }
  if (report.initiative !== "A26" || report.result !== "passed") {
    errors.push("report is not a passed A26 result");
  }
  if (
    report.candidate?.publicationAuthorized !== false ||
    report.candidate?.publicationStatus !== "not-published"
  ) {
    errors.push("candidate publication state is not separately held");
  }
  if (report.candidate?.productProofStatus !== "unestablished") {
    errors.push("candidate overstates product proof");
  }

  const roadmap = fixtureMode ? null : initiativeMap();
  if (!fixtureMode) {
    for (const [index, reference] of (report.source?.files ?? []).entries()) {
      validateReference(reference, `release-source:${index}`, errors);
    }
  }
  const checklist = new Map((report.checklist ?? []).map((item) => [item.initiativeId, item]));
  for (const initiativeId of requiredInitiatives) {
    const item = checklist.get(initiativeId);
    if (!item) {
      errors.push(`[${initiativeId}] checklist item is missing`);
      continue;
    }
    if (item.status !== "passed") errors.push(`[${initiativeId}] checklist item is not passed`);
    const expectedAcceptanceCount = fixtureMode
      ? fixtureAcceptanceCounts.get(initiativeId)
      : roadmap.get(initiativeId)?.acceptance?.length;
    if (item.acceptanceEvidenceCount !== expectedAcceptanceCount) {
      errors.push(
        `[${initiativeId}] acceptance evidence fan-in is not ${expectedAcceptanceCount}/${expectedAcceptanceCount}`,
      );
    }
    if (!item.redGateReceipt) errors.push(`[${initiativeId}] red-gate receipt is missing`);
    if (!fixtureMode) {
      const initiative = roadmap.get(initiativeId);
      if (!initiative || initiative.status !== "done")
        errors.push(`[${initiativeId}] roadmap is not done`);
      if (item.title !== initiative?.title || item.redGate !== initiative?.redGate) {
        errors.push(`[${initiativeId}] roadmap criterion projection drifted`);
      }
      if (
        item.acceptanceEvidence?.length !== initiative?.acceptance?.length ||
        item.acceptanceEvidence?.some(
          (acceptance, index) => acceptance.criterion !== initiative.acceptance[index],
        )
      ) {
        errors.push(`[${initiativeId}] acceptance criteria drifted from roadmap`);
      } else {
        for (const [acceptanceIndex, acceptance] of item.acceptanceEvidence.entries()) {
          if (!Array.isArray(acceptance.evidence) || acceptance.evidence.length < 2) {
            errors.push(
              `[${initiativeId}:${acceptanceIndex}] current evidence fan-in is incomplete`,
            );
          }
          for (const [evidenceIndex, reference] of (acceptance.evidence ?? []).entries()) {
            validateReference(
              reference,
              `${initiativeId}:acceptance:${acceptanceIndex}:${evidenceIndex}`,
              errors,
            );
          }
        }
      }
      const receipt = referenceJson(item.redGateReceipt, `${initiativeId}:red-gate`, errors);
      if (
        receipt &&
        (receipt.initiative !== initiativeId ||
          receipt.result !== "passed" ||
          !historicalRedGateHalted(receipt))
      ) {
        errors.push(`[${initiativeId}] red-gate receipt does not prove a halt`);
      }
    }
  }
  if (checklist.size !== requiredInitiatives.length)
    errors.push("initiative checklist denominator drifted");

  const repositories = report.repositoryResults ?? [];
  const repositoryById = new Map(repositories.map((item) => [item.runId, item]));
  const expectedRepositoryIds = fixtureMode
    ? ["run-a", "run-b", "run-c", "run-d-main", "run-d-worktree", "run-e"]
    : (report.expectedRepositoryRunIds ?? []);
  for (const runId of expectedRepositoryIds) {
    const result = repositoryById.get(runId);
    if (!result) errors.push(`[repository:${runId}] repository result is missing`);
    else if (result.status !== "passed")
      errors.push(`[repository:${runId}] repository result is not passed`);
  }
  if (repositories.length !== expectedRepositoryIds.length)
    errors.push("repository result fan-in drifted");
  if (new Set(repositories.map((item) => item.logicalRepositoryId)).size < 5) {
    errors.push("logical repository denominator is below five");
  }

  let a25 = null;
  if (!fixtureMode) {
    a25 = referenceJson(report.repositoryEvidence, "repository-evidence", errors);
    if (a25) {
      const expected = new Map(a25.runMatrix?.expectedRuns?.map((item) => [item.runId, item]));
      const runs = new Map(a25.runs?.map((item) => [item.runId, item]));
      if (
        a25.evidenceMode !== "real-host" ||
        a25.result !== "passed" ||
        a25.report?.aggregation !== "none" ||
        a25.report?.crossRepositoryWriteCount !== 0
      ) {
        errors.push("repository evidence is not the passed unpooled real-host envelope");
      }
      if (
        JSON.stringify(expectedRepositoryIds) !==
        JSON.stringify(a25.runMatrix.expectedRuns.map(({ runId }) => runId))
      ) {
        errors.push("expected repository run IDs drifted from A25 preregistration");
      }
      for (const projected of repositories) {
        const run = runs.get(projected.runId);
        const preregistered = expected.get(projected.runId);
        if (
          !run ||
          !preregistered ||
          projected.status !== run.status ||
          projected.logicalRepositoryId !== preregistered.logicalRepositoryId ||
          projected.threadId !== run.threadId ||
          projected.serverInstanceId !== run.serverInstanceId ||
          projected.bindingId !== run.bindingReceipt.bindingId ||
          projected.canonicalRoot !== run.bindingReceipt.canonicalRoot ||
          projected.storagePath !== run.bindingReceipt.storagePath ||
          projected.setupCommandCount !== 0 ||
          projected.perRepositoryRestartCount !== 0 ||
          projected.userInterventionCount !== 0
        ) {
          errors.push(`[repository:${projected.runId}] identity-bound projection drifted`);
        }
      }
    }
  }

  const replay = fixtureMode ? null : validateCleanReplay(report, errors);
  if (!fixtureMode) validateCandidateSuite(report, errors);

  const migrations = new Map((report.migrationCases ?? []).map((item) => [item.caseId, item]));
  for (const caseId of requiredMigrations) {
    const migration = migrations.get(caseId);
    if (!migration) errors.push(`[migration:${caseId}] migration case is missing`);
    else if (migration.status !== "passed")
      errors.push(`[migration:${caseId}] migration case is not passed`);
    else if (!fixtureMode) {
      const evidence = referenceJson(migration.evidence, `migration:${caseId}`, errors);
      if (caseId === "hard-coded-global" && evidence?.initiative !== "A19") {
        errors.push(`[migration:${caseId}] evidence identity drifted`);
      } else if (caseId === "conflicting-user-project" && evidence?.initiative !== "A20") {
        errors.push(`[migration:${caseId}] evidence identity drifted`);
      } else if (
        ["upgrade", "rollback", "uninstall"].includes(caseId) &&
        evidence?.initiative !== "A26"
      ) {
        errors.push(`[migration:${caseId}] clean replay identity drifted`);
      }
    }
  }

  const restarts = new Map(
    (report.restartObservations ?? []).map((item) => [item.observationId, item]),
  );
  for (const [observationId, count] of requiredRestarts) {
    const observation = restarts.get(observationId);
    if (!observation) errors.push(`[restart:${observationId}] restart observation is missing`);
    else if (observation.status !== "passed" || observation.count !== count) {
      errors.push(`[restart:${observationId}] restart observation drifted`);
    } else if (!fixtureMode)
      validateReference(observation.evidence, `restart:${observationId}`, errors);
  }
  if (replay) {
    const observed = replay.rollbackRehearsal.restartObservations;
    const expected = {
      "initial-installation": observed.initialInstallation,
      "per-repository": a25?.report?.perRepositoryRestartCount,
      "ordinary-first-use": observed.ordinaryFirstUse,
      upgrade: observed.upgrade,
      rollback: observed.rollback,
      uninstall: observed.uninstall,
    };
    for (const [observationId, count] of requiredRestarts) {
      if (expected[observationId] !== count)
        errors.push(`[restart:${observationId}] source evidence drifted`);
    }
  }

  if (!fixtureMode) {
    const red = referenceJson(report.redGate?.evidence, "A26-red-gate", errors);
    if (
      red?.initiative !== "A26" ||
      red?.result !== "passed" ||
      red?.sabotageCaseCount !== 4 ||
      red?.haltedCaseCount !== 4 ||
      red?.cases?.some(({ exitCode, halted }) => exitCode === 0 || !halted) ||
      report.redGate?.caseCount !== 4 ||
      report.redGate?.haltedCaseCount !== 4
    ) {
      errors.push("A26 release-readiness red-gate denominator drifted");
    }
    const denominator = report.denominators ?? {};
    if (
      denominator.sourceCheckoutCount !== 1 ||
      denominator.packedTarballCount !== 1 ||
      denominator.supportedHostSurfaceCount !== 1 ||
      denominator.logicalRepositoryCount !== 5 ||
      denominator.workspaceCount !== 6 ||
      denominator.independentRunCount !== 6 ||
      denominator.concurrentRunCount !== 3 ||
      denominator.failedPositiveRunCount !== 0 ||
      denominator.pooledRunCount !== 0
    ) {
      errors.push("artifact/host/repository/run denominators drifted");
    }
    if (
      report.candidate?.packageVersion !== replay?.source?.packageVersion ||
      report.candidate?.exactTarballSha256 !== replay?.rollbackRehearsal?.candidate?.tarballSha256
    ) {
      errors.push("candidate artifact identity drifted from clean replay");
    }
  } else {
    for (const field of [
      "sourceCheckout",
      "packedPackage",
      "configurationMigration",
      "rollback",
      "documentationReadBack",
    ]) {
      if (report.cleanReplay?.[field] !== "passed")
        errors.push(`[clean-replay:${field}] result is not passed`);
    }
  }

  const decision = report.decision ?? {};
  if (decision.releaseReady !== true) errors.push("release decision is not ready");
  if (decision.publicationAuthorized !== false || decision.publicationStatus !== "not-published") {
    errors.push("release decision conflates readiness with publication");
  }
  if (decision.productProofStatus !== "unestablished")
    errors.push("release decision overstates product proof");
  if (decision.aggregation !== "none") errors.push("release decision pools evidence");
  if (!Array.isArray(decision.unsupportedStrata) || decision.unsupportedStrata.length === 0) {
    errors.push("release decision omits unsupported strata");
  }
  return errors;
}

const { reportPath, caseId } = parseArgs(process.argv.slice(2));
const report = loadReport(reportPath, caseId);
const errors = validate(report);
if (errors.length > 0) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}
console.log(
  `A26 friction-free release readiness valid: ${report.checklist.length}/7 initiatives, ${report.repositoryResults.length} repository results`,
);
