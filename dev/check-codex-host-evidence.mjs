#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  let receiptPath;
  let caseId;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--receipt") receiptPath = argv[++index];
    else if (argv[index] === "--case") caseId = argv[++index];
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!receiptPath)
    throw new Error("usage: check-codex-host-evidence.mjs --receipt PATH [--case ID]");
  return { receiptPath: resolve(receiptPath), caseId };
}

function replacePointer(target, pointer, value) {
  const segments = pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (segments.length === 0) throw new Error("fixture mutation cannot replace the document root");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    if (cursor?.[segment] === undefined) throw new Error(`fixture pointer is absent: ${pointer}`);
    cursor = cursor[segment];
  }
  cursor[segments.at(-1)] = value;
}

function loadReceipt(path, caseId) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!caseId) return { receipt: parsed, expectedError: null };
  if (parsed.fixtureId !== "codex-host-red-matrix") {
    throw new Error("--case requires the codex-host-red-matrix fixture");
  }
  const fixtureCase = parsed.cases?.find((candidate) => candidate.caseId === caseId);
  if (!fixtureCase) throw new Error(`unknown fixture case: ${caseId}`);
  const receipt = structuredClone(parsed.baseReceipt);
  for (const mutation of fixtureCase.mutations ?? []) {
    replacePointer(receipt, mutation.pointer, mutation.value);
  }
  return { receipt, expectedError: fixtureCase.expectedError };
}

function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function readRawEvents(logPath, runId, errors) {
  const events = [];
  for (const [index, line] of readFileSync(logPath, "utf8").split(/\r?\n/).entries()) {
    if (!line.trim().startsWith("{")) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      errors.push(`[${runId}] raw Codex event log line ${index + 1} is invalid JSON`);
    }
  }
  return events;
}

function completedMcpCall(events, tool) {
  return events.find(
    (event) =>
      event.type === "item.completed" &&
      event.item?.type === "mcp_tool_call" &&
      event.item?.server === "amanuensis-memory" &&
      event.item?.tool === tool &&
      event.item?.status === "completed" &&
      !event.item?.error,
  )?.item;
}

function validateLogReference(reference, label, errors, options = { parseEvents: true }) {
  if (!reference?.path || !reference?.sha256) {
    errors.push(`[${label}] log custody is absent`);
    return { path: null, events: [], bytes: null };
  }
  const path = resolve(root, reference.path);
  const rel = relative(root, path);
  if (isAbsolute(reference.path) || rel === ".." || rel.startsWith(`..${sep}`)) {
    errors.push(`[${label}] log escapes the repository`);
    return { path: null, events: [], bytes: null };
  }
  if (!existsSync(path)) {
    errors.push(`[${label}] log is absent`);
    return { path: null, events: [], bytes: null };
  }
  const bytes = readFileSync(path);
  if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256) {
    errors.push(`[${label}] log digest drifted`);
  }
  return {
    path,
    events: options.parseEvents ? readRawEvents(path, label, errors) : [],
    bytes,
  };
}

function validate(receipt) {
  const errors = [];
  if (receipt.schemaVersion !== 1) errors.push("receipt schema version drifted");
  if (receipt.initiative !== "A22") errors.push("receipt is not bound to A22");
  if (receipt.host?.surface !== "codex-cli-exec") {
    errors.push("host surface is not codex-cli-exec");
  }

  const expectedRuns = receipt.expectedRuns ?? [];
  const runs = receipt.runs ?? [];
  if (expectedRuns.length === 0) errors.push("expected-run denominator is zero");
  if (runs.length !== expectedRuns.length) {
    errors.push(`run fan-in mismatch: landed ${runs.length}, expected ${expectedRuns.length}`);
  }
  const expectedIds = new Set(expectedRuns.map((run) => run.runId));
  const landedIds = new Set(runs.map((run) => run.runId));
  for (const runId of expectedIds) {
    if (!landedIds.has(runId)) errors.push(`[${runId}] expected run did not land`);
  }
  for (const runId of landedIds) {
    if (!expectedIds.has(runId)) errors.push(`[${runId}] undeclared run landed`);
  }

  const instances = new Map();
  for (const expected of expectedRuns) {
    const run = runs.find((candidate) => candidate.runId === expected.runId);
    if (!run) continue;
    if (run.status !== "passed") errors.push(`[${run.runId}] status is ${run.status ?? "absent"}`);
    if (!run.mcpCallObserved) errors.push(`[${run.runId}] no Amanuensis MCP call was observed`);
    const binding = run.bindingReceipt ?? {};
    if (binding.canonicalRoot !== expected.canonicalRoot) {
      errors.push(
        `[${run.runId}] canonical root ${binding.canonicalRoot ?? "absent"} != ${expected.canonicalRoot}`,
      );
    }
    if (binding.storagePath !== expected.storagePath) {
      errors.push(
        `[${run.runId}] storage path ${binding.storagePath ?? "absent"} != ${expected.storagePath}`,
      );
    }
    if (!run.serverInstanceId) errors.push(`[${run.runId}] server instance ID is absent`);
    else {
      const prior = instances.get(run.serverInstanceId);
      if (prior && prior.canonicalRoot !== expected.canonicalRoot) {
        errors.push(
          `server instance ${run.serverInstanceId} crossed repository roots: ${prior.runId} → ${run.runId}`,
        );
      } else instances.set(run.serverInstanceId, expected);
    }
    for (const write of run.writes ?? []) {
      if (!isWithin(expected.storagePath, write.path)) {
        errors.push(
          `[${run.runId}] cross-repository write outside ${expected.storagePath}: ${write.path}`,
        );
      }
    }

    if (receipt.evidenceMode === "real-host") {
      const rawLog = validateLogReference(run.rawEventLog, run.runId, errors);
      if (rawLog.path) {
        const infoCall = completedMcpCall(rawLog.events, "get_project_info");
        const observed = infoCall?.result?.structured_content?.binding_receipt;
        if (!observed)
          errors.push(`[${run.runId}] raw log has no completed get_project_info result`);
        else {
          if (JSON.stringify(observed) !== JSON.stringify(run.bindingReceipt)) {
            errors.push(`[${run.runId}] receipt does not match the raw MCP tool result`);
          }
          if (observed.serverInstanceId !== run.serverInstanceId) {
            errors.push(`[${run.runId}] server instance does not match the raw MCP tool result`);
          }
        }
        for (const requiredTool of run.requiredTools ?? []) {
          if (!completedMcpCall(rawLog.events, requiredTool)) {
            errors.push(`[${run.runId}] raw log lacks completed MCP tool ${requiredTool}`);
          }
        }
      }
    }
  }

  const changedAt = Date.parse(receipt.lifecycle?.configChangedAt ?? "");
  const processStartedAt = Date.parse(receipt.lifecycle?.processStartedAt ?? "");
  if (
    Number.isFinite(changedAt) &&
    Number.isFinite(processStartedAt) &&
    processStartedAt < changedAt &&
    !receipt.lifecycle?.restartObserved
  ) {
    errors.push("running Codex process predates managed configuration and no restart was observed");
  }

  if (receipt.evidenceMode === "real-host") {
    const requiredScenarios = new Set([
      "fresh-start",
      "configuration-conflict",
      "restart",
      "resume",
      "concurrent-task",
      "stale-process",
    ]);
    for (const scenario of receipt.scenarios ?? []) {
      if (scenario.status === "passed") requiredScenarios.delete(scenario.name);
    }
    for (const scenario of requiredScenarios) errors.push(`scenario did not pass: ${scenario}`);
    const noPooling = new Map(
      (receipt.noPooling ?? []).map((entry) => [entry.runId, entry.status]),
    );
    for (const expected of expectedRuns) {
      if (noPooling.get(expected.runId) !== "passed") {
        errors.push(`[${expected.runId}] no-pooling result is not independently green`);
      }
    }

    const interruption = receipt.interruption;
    const interruptedLog = validateLogReference(
      interruption?.rawEventLog,
      interruption?.runId ?? "interruption",
      errors,
    );
    if (interruptedLog.path) {
      for (const tool of interruption.completedTools ?? []) {
        if (!completedMcpCall(interruptedLog.events, tool)) {
          errors.push(`[${interruption.runId}] interruption log lacks completed MCP tool ${tool}`);
        }
      }
      if (interruptedLog.events.some((event) => event.type === "turn.completed")) {
        errors.push(`[${interruption.runId}] interruption arm completed normally`);
      }
      const resumed = runs.find((run) => run.runId === "repository-a-resume");
      if (!resumed || resumed.threadId !== interruption.threadId) {
        errors.push("resume did not retain the interrupted Codex thread identity");
      }
    }

    const conflict = (receipt.detectorRuns ?? []).find(
      (run) => run.runId === "configuration-conflict",
    );
    const conflictEvents = validateLogReference(
      conflict?.rawEventLog,
      "configuration-conflict",
      errors,
    );
    const conflictStderr = validateLogReference(
      conflict?.stderrLog,
      "configuration-conflict-stderr",
      errors,
    );
    if (completedMcpCall(conflictEvents.events, "get_project_info")) {
      errors.push("configuration-conflict detector initialized Amanuensis");
    }
    if (
      conflictStderr.bytes &&
      !conflictStderr.bytes.toString("utf8").includes("MCP startup failed")
    ) {
      errors.push("configuration-conflict detector lacks the Codex MCP startup failure");
    }

    const stale = (receipt.detectorRuns ?? []).find((run) => run.runId === "stale-process-cwd");
    const staleEvents = validateLogReference(stale?.rawEventLog, "stale-process-cwd", errors);
    if (!stale?.rawEventLog?.sanitized || !(stale.rawEventLog.removedEventCount > 0)) {
      errors.push("stale-process log did not declare its required sanitization");
    }
    if (staleEvents.events.some((event) => event.item?.type === "command_execution")) {
      errors.push("stale-process evidence retained a shell event");
    }
    const sanitization = validateLogReference(
      {
        path: stale?.rawEventLog?.sanitizationPath,
        sha256: stale?.rawEventLog?.sanitizationSha256,
      },
      "stale-process-sanitization",
      errors,
      { parseEvents: false },
    );
    if (sanitization.bytes) {
      const custody = JSON.parse(sanitization.bytes.toString("utf8"));
      if (
        custody.originalSha256 !== stale.rawEventLog.originalSha256 ||
        custody.removedEventCount !== stale.rawEventLog.removedEventCount
      ) {
        errors.push("stale-process sanitization custody drifted");
      }
    }
    const staleObserved = completedMcpCall(staleEvents.events, "get_project_info")?.result
      ?.structured_content?.binding_receipt?.canonicalRoot;
    if (!staleObserved || staleObserved !== stale?.observedCanonicalRoot) {
      errors.push("stale-process detector receipt does not match its raw MCP result");
    }
    if (staleObserved === stale?.expectedCanonicalRoot) {
      errors.push("stale-process detector did not observe a wrong repository");
    }

    const parentRecovery = receipt.parentCdRecovery;
    const parentEvidence = validateLogReference(
      {
        path: parentRecovery?.evidencePath,
        sha256: parentRecovery?.evidenceSha256,
      },
      "parent-cd-recovery-evidence",
      errors,
      { parseEvents: false },
    );
    const parentEvents = validateLogReference(
      parentRecovery?.rawEventLog,
      "parent-cd-recovery",
      errors,
    );
    validateLogReference(parentRecovery?.stderrLog, "parent-cd-recovery-stderr", errors, {
      parseEvents: false,
    });
    if (parentEvents.events.some((event) => event.item?.type === "command_execution")) {
      errors.push("parent-cd recovery retained an undeclared shell event");
    }
    const recoveredBinding = completedMcpCall(parentEvents.events, "get_project_info")?.result
      ?.structured_content?.binding_receipt;
    if (
      !recoveredBinding ||
      JSON.stringify(recoveredBinding) !== JSON.stringify(parentRecovery?.bindingReceipt) ||
      recoveredBinding.canonicalRoot !== parentRecovery?.requestedTarget ||
      recoveredBinding.selectionSource !== "parent-codex-cli-cd-git-root"
    ) {
      errors.push("parent-cd recovery does not match its raw MCP binding result");
    }
    if (parentRecovery?.launcherCwd === parentRecovery?.requestedTarget) {
      errors.push("parent-cd recovery did not use distinct launcher and task roots");
    }
    if (
      parentRecovery?.configSha256Before !== parentRecovery?.configSha256After ||
      parentRecovery?.configBytesChanged !== 0
    ) {
      errors.push("parent-cd recovery changed user configuration bytes");
    }
    if (parentEvidence.bytes) {
      const compact = JSON.parse(parentEvidence.bytes.toString("utf8"));
      if (JSON.stringify(compact.bindingReceipt) !== JSON.stringify(recoveredBinding)) {
        errors.push("parent-cd compact evidence drifted from the MCP result");
      }
    }

    const readback = validateLogReference(receipt.storageReadback, "storage-readback", errors, {
      parseEvents: false,
    });
    if (readback.bytes) {
      const parsed = JSON.parse(readback.bytes.toString("utf8"));
      const intents = new Map(
        (parsed.storageReadback ?? []).map((entry) => [entry.repository, entry.intents]),
      );
      const expectedIntents = new Map([
        ["repository-a", ["A22_RUN_interrupted-a", "A22_RUN_repository-a"]],
        ["repository-b", ["A22_RUN_repository-b"]],
        ["worktree-a", ["A22_RUN_worktree-a"]],
      ]);
      for (const [repository, expected] of expectedIntents) {
        if (JSON.stringify(intents.get(repository)) !== JSON.stringify(expected)) {
          errors.push(`[${repository}] durable session read-back crossed or lost a run`);
        }
      }
    }

    if (
      receipt.host?.configSha256Before !== receipt.host?.configSha256After ||
      receipt.host?.configBytesChangedAfterCleanup !== 0 ||
      receipt.configurationCustody?.unrelatedMutationCount !== 0
    ) {
      errors.push("live Codex configuration was not restored byte-for-byte");
    }
    if (existsSync(receipt.host?.configPath ?? "")) {
      const currentConfigHash = createHash("sha256")
        .update(readFileSync(receipt.host.configPath))
        .digest("hex");
      if (currentConfigHash !== receipt.host.configSha256After) {
        errors.push("live Codex configuration drifted after host evidence");
      }
    }
    if (existsSync(receipt.configurationCustody?.cleanupBackup ?? "")) {
      const backupHash = createHash("sha256")
        .update(readFileSync(receipt.configurationCustody.cleanupBackup))
        .digest("hex");
      if (backupHash !== receipt.configurationCustody.cleanupBackupSha256) {
        errors.push("host trust cleanup backup digest drifted");
      }
    }
  }

  return errors;
}

const { receiptPath, caseId } = parseArgs(process.argv.slice(2));
const { receipt, expectedError } = loadReceipt(receiptPath, caseId);
const errors = validate(receipt);
if (expectedError && !errors.some((error) => error.includes(expectedError))) {
  errors.unshift(`fixture ${caseId} did not trigger expected error: ${expectedError}`);
}
if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
  process.exitCode = 1;
} else {
  console.log(
    `Codex host evidence valid; ${receipt.runs.length}/${receipt.expectedRuns.length} runs`,
  );
}
