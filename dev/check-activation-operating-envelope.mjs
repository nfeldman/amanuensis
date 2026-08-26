#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  let receiptPath;
  let caseId;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--receipt") receiptPath = resolve(argv[++index]);
    else if (argv[index] === "--case") caseId = argv[++index];
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!receiptPath)
    throw new Error("usage: check-activation-operating-envelope.mjs --receipt PATH [--case ID]");
  return { receiptPath, caseId };
}

function replacePointer(target, pointer, value) {
  const segments = pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let cursor = target;
  for (const segment of segments.slice(0, -1)) cursor = cursor[segment];
  cursor[segments.at(-1)] = value;
}

function loadReceipt(path, caseId) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!caseId) return parsed;
  if (parsed.fixtureId !== "a25-activation-operating-envelope-red-matrix") {
    throw new Error("--case requires the A25 operating-envelope red fixture");
  }
  const selected = parsed.cases.find((candidate) => candidate.caseId === caseId);
  if (!selected) throw new Error(`unknown A25 red case: ${caseId}`);
  const receipt = structuredClone(parsed.baseReceipt);
  for (const mutation of selected.mutations) {
    replacePointer(receipt, mutation.pointer, mutation.value);
  }
  return receipt;
}

function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function validateLog(reference, label, errors) {
  if (!reference?.path || !reference?.sha256) {
    errors.push(`[${label}] raw host log custody is absent`);
    return null;
  }
  const path = resolve(root, reference.path);
  const rel = relative(root, path);
  if (isAbsolute(reference.path) || rel === ".." || rel.startsWith(`..${sep}`)) {
    errors.push(`[${label}] raw host log escapes the repository`);
    return null;
  }
  if (!existsSync(path)) {
    errors.push(`[${label}] raw host log is absent`);
    return null;
  }
  const bytes = readFileSync(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== reference.sha256) errors.push(`[${label}] raw host log digest drifted`);
  return { path, raw: bytes.toString("utf8") };
}

function jsonLines(raw, label, errors) {
  try {
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().startsWith("{"))
      .map((line) => JSON.parse(line));
  } catch (error) {
    errors.push(`[${label}] JSONL is invalid: ${error.message}`);
    return [];
  }
}

function completedMcpCalls(events) {
  return events
    .filter(
      (event) =>
        event.type === "item.completed" &&
        event.item?.type === "mcp_tool_call" &&
        event.item?.server === "amanuensis-memory" &&
        event.item?.status === "completed" &&
        !event.item?.error,
    )
    .map((event) => event.item);
}

function validateSourceCustody(receipt, errors) {
  for (const reference of receipt.source?.files ?? []) {
    if (!reference.path || !reference.sha256 || isAbsolute(reference.path)) {
      errors.push("source custody reference is malformed");
      continue;
    }
    const path = resolve(root, reference.path);
    if (!isWithin(root, path) || !existsSync(path)) {
      errors.push(`source custody path is absent or external: ${reference.path}`);
      continue;
    }
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (digest !== reference.sha256)
      errors.push(`source custody digest drifted: ${reference.path}`);
  }
}

function validate(receipt) {
  const errors = [];
  if (receipt.schemaVersion !== 1) errors.push("schema version drifted");
  if (receipt.initiative !== "A25") errors.push("receipt is not bound to A25");
  if (receipt.host?.surface !== "codex-cli-exec") errors.push("host surface is not codex-cli-exec");
  if (receipt.host?.managedInstallationCount !== 1)
    errors.push("managed installation count is not one");
  if (!(receipt.host?.installationRestartCount <= 1))
    errors.push("installation restart count exceeds one");
  if (receipt.host?.perRepositoryRestartCount !== 0)
    errors.push("host per-repository restart count is nonzero");
  if (
    receipt.host?.configBytesChanged !== 0 ||
    receipt.host?.configSha256Before !== receipt.host?.configSha256After
  ) {
    errors.push("real-host run changed user configuration bytes");
  }
  validateSourceCustody(receipt, errors);

  const expectedRuns = receipt.runMatrix?.expectedRuns ?? [];
  const runs = receipt.runs ?? [];
  const logicalRepositories = new Set(expectedRuns.map((run) => run.logicalRepositoryId));
  if (
    logicalRepositories.size < 5 ||
    receipt.runMatrix?.logicalRepositoryCount !== logicalRepositories.size
  ) {
    errors.push("logical repository denominator is below five or misreported");
  }
  if (
    receipt.runMatrix?.workspaceCount !== expectedRuns.length ||
    runs.length !== expectedRuns.length
  ) {
    errors.push(`run fan-in mismatch: landed ${runs.length}, expected ${expectedRuns.length}`);
  }
  if (receipt.runMatrix?.preregisteredBeforeExecution !== true) {
    errors.push("run matrix was not preregistered before execution");
  }
  const requiredShapes = new Set(receipt.runMatrix?.requiredShapes ?? []);
  for (const expectedShape of ["repository-root", "nested-launch", "worktree", "parent-cd"]) {
    if (!requiredShapes.has(expectedShape))
      errors.push(`required repository shape is absent: ${expectedShape}`);
    if (!expectedRuns.some((run) => run.shape === expectedShape)) {
      errors.push(`required repository shape has no expected run: ${expectedShape}`);
    }
  }

  const runIds = new Set();
  const expectedRunIds = new Set();
  for (const expected of expectedRuns) {
    if (expectedRunIds.has(expected.runId))
      errors.push(`[${expected.runId}] expected run ID was reused`);
    expectedRunIds.add(expected.runId);
    if (receipt.campaignId && !expected.runId.startsWith(`${receipt.campaignId}-`)) {
      errors.push(`[${expected.runId}] run ID is not campaign-bound`);
    }
  }
  const threadIds = new Set();
  const serverInstanceIds = new Set();
  const expectedById = new Map(expectedRuns.map((run) => [run.runId, run]));
  for (const run of runs) {
    if (runIds.has(run.runId)) errors.push(`[${run.runId}] run ID was reused`);
    runIds.add(run.runId);
    const expected = expectedById.get(run.runId);
    if (!expected) {
      errors.push(`[${run.runId}] undeclared run landed`);
      continue;
    }
    if (run.status !== "passed") {
      errors.push(`[${run.runId}] failed run cannot be pooled into a passed report`);
    }
    if (typeof run.userInterventionCount !== "number") {
      errors.push(`[${run.runId}] user intervention count is absent`);
    } else if (run.userInterventionCount !== 0) {
      errors.push(`[${run.runId}] user intervention count is nonzero`);
    }
    if (run.amanuensisSetupCommandCount !== 0)
      errors.push(`[${run.runId}] setup command count is nonzero`);
    if (run.perRepositoryRestartCount !== 0)
      errors.push(`[${run.runId}] per-repository restart count is nonzero`);
    if (run.diagnosisDurationMs !== 0)
      errors.push(`[${run.runId}] successful run reported diagnosis time`);
    if (!run.threadId || threadIds.has(run.threadId))
      errors.push(`[${run.runId}] thread identity is absent or reused`);
    else threadIds.add(run.threadId);
    if (!run.serverInstanceId || serverInstanceIds.has(run.serverInstanceId)) {
      errors.push(`[${run.runId}] server instance identity is absent or reused`);
    } else serverInstanceIds.add(run.serverInstanceId);
    const binding = run.bindingReceipt ?? {};
    if (binding.canonicalRoot !== expected.canonicalRoot)
      errors.push(`[${run.runId}] canonical root mismatch`);
    if (binding.storagePath !== expected.storagePath)
      errors.push(`[${run.runId}] storage path mismatch`);
    for (const write of run.writes ?? []) {
      if (!isWithin(expected.storagePath, write.path))
        errors.push(`[${run.runId}] cross-repository write: ${write.path}`);
    }
    const expectedIntent = `A25_RUN_${run.runId}`;
    if (JSON.stringify(run.observedSessionIntents) !== JSON.stringify([expectedIntent])) {
      errors.push(`[${run.runId}] session intent custody is not exact`);
    }
    if (receipt.evidenceMode === "real-host") {
      const eventLog = validateLog(run.rawEventLog, run.runId, errors);
      validateLog(run.stderrLog, `${run.runId}-stderr`, errors);
      const storeLog = validateLog(run.storeCustody, `${run.runId}-store`, errors);
      if (eventLog) {
        const events = jsonLines(eventLog.raw, run.runId, errors);
        const started = events.find((event) => event.type === "thread.started");
        if (started?.thread_id !== run.threadId)
          errors.push(`[${run.runId}] thread ID is not log-bound`);
        if (
          events.some((event) => ["command_execution", "file_change"].includes(event.item?.type))
        ) {
          errors.push(`[${run.runId}] positive run used a non-MCP mutation surface`);
        }
        const calls = completedMcpCalls(events);
        if (
          JSON.stringify(calls.map((call) => call.tool)) !==
          JSON.stringify(["get_project_info", "start_session", "get_session"])
        ) {
          errors.push(`[${run.runId}] MCP call sequence is not exact`);
        }
        const observedBinding = calls[0]?.result?.structured_content?.binding_receipt;
        if (JSON.stringify(observedBinding) !== JSON.stringify(run.bindingReceipt)) {
          errors.push(`[${run.runId}] binding receipt is not raw-log-bound`);
        }
        if (calls[1]?.arguments?.intent !== expectedIntent) {
          errors.push(`[${run.runId}] session intent is not raw-log-bound`);
        }
      }
      if (storeLog) {
        try {
          const custody = JSON.parse(storeLog.raw);
          if (
            custody.runId !== run.runId ||
            custody.threadId !== run.threadId ||
            custody.serverInstanceId !== run.serverInstanceId ||
            custody.bindingId !== run.bindingReceipt?.bindingId ||
            custody.canonicalRoot !== expected.canonicalRoot ||
            custody.storagePath !== expected.storagePath
          ) {
            errors.push(`[${run.runId}] store custody identity drifted`);
          }
          if (JSON.stringify(custody.observedSessionIntents) !== JSON.stringify([expectedIntent])) {
            errors.push(`[${run.runId}] store custody session intent drifted`);
          }
          const custodyWrites = (custody.files ?? []).map(({ path }) => ({ path }));
          if (JSON.stringify(custodyWrites) !== JSON.stringify(run.writes ?? [])) {
            errors.push(`[${run.runId}] write inventory is not store-custody-bound`);
          }
          if (
            !(custody.files ?? []).some(
              (file) => file.path === `${expected.storagePath}${sep}memory.db`,
            )
          ) {
            errors.push(`[${run.runId}] store custody omits memory.db`);
          }
          for (const file of custody.files ?? []) {
            if (!isWithin(expected.storagePath, file.path)) {
              errors.push(`[${run.runId}] store custody contains cross-repository path`);
            }
          }
        } catch (error) {
          errors.push(`[${run.runId}] store custody is invalid JSON: ${error.message}`);
        }
      }
    }
  }
  for (const expected of expectedRuns) {
    if (!runIds.has(expected.runId)) errors.push(`[${expected.runId}] expected run did not land`);
  }

  const waves = new Map();
  for (const expected of expectedRuns) {
    if (!expected.concurrentWave) continue;
    const run = runs.find((candidate) => candidate.runId === expected.runId);
    if (run)
      waves.set(expected.concurrentWave, [...(waves.get(expected.concurrentWave) ?? []), run]);
  }
  for (const [wave, waveRuns] of waves) {
    if (waveRuns.length < 3) errors.push(`[${wave}] concurrent wave has fewer than three runs`);
    const latestStart = Math.max(...waveRuns.map((run) => Date.parse(run.startedAt)));
    const earliestEnd = Math.min(...waveRuns.map((run) => Date.parse(run.endedAt)));
    if (!(latestStart < earliestEnd)) errors.push(`[${wave}] run intervals did not overlap`);
  }

  for (const negative of receipt.negativeRuns ?? []) {
    if (negative.status !== "passed")
      errors.push(`[${negative.runId}] negative control is not cleared`);
    if (!negative.configurationDeliveryCleared)
      errors.push(`[${negative.runId}] configuration delivery was not cleared`);
    if (!negative.hostLaunchCleared) errors.push(`[${negative.runId}] host launch was not cleared`);
    if (!negative.detectorOperationCleared)
      errors.push(`[${negative.runId}] detector operation was not cleared`);
    if (!(negative.diagnosisDurationMs <= negative.diagnosisTargetMs))
      errors.push(`[${negative.runId}] diagnosis exceeded target`);
    if (typeof negative.userInterventionCount !== "number")
      errors.push(`[${negative.runId}] user intervention count is absent`);
    if (!negative.boundedRemediation)
      errors.push(`[${negative.runId}] bounded remediation is absent`);
    if (receipt.evidenceMode === "real-host") {
      const rawEvent = validateLog(negative.rawEventLog, negative.runId, errors);
      validateLog(negative.stderrLog, `${negative.runId}-stderr`, errors);
      const launchAudit = validateLog(negative.launchAuditLog, `${negative.runId}-launch`, errors);
      if (rawEvent) {
        const calls = completedMcpCalls(jsonLines(rawEvent.raw, negative.runId, errors));
        if (calls.some((call) => call.tool === "get_project_info")) {
          errors.push(`[${negative.runId}] negative control completed get_project_info`);
        }
      }
      if (launchAudit) {
        const events = jsonLines(launchAudit.raw, `${negative.runId}-launch`, errors);
        const launch = events.find((event) => event.type === "launch");
        const stderr = events
          .filter((event) => event.type === "server-stderr")
          .map((event) => event.text)
          .join("");
        const workspaceIndex = launch?.args?.indexOf("--workspace") ?? -1;
        if (
          workspaceIndex < 0 ||
          launch.args[workspaceIndex + 1] !== negative.expectedSelectedWorkspace
        ) {
          errors.push(`[${negative.runId}] configuration delivery is not launch-audit-bound`);
        }
        if (launch?.cwd !== negative.observedLaunchCwd) {
          errors.push(`[${negative.runId}] host launch cwd is not audit-bound`);
        }
        if (!negative.detectorWitness || !stderr.includes(negative.detectorWitness)) {
          errors.push(`[${negative.runId}] detector operation is not stderr-bound`);
        }
      }
    }
  }

  const report = receipt.report ?? {};
  if (report.status === "passed" && runs.some((run) => run.status !== "passed")) {
    errors.push("failed run cannot be pooled into a passed report");
  }
  if (report.aggregation !== "none") errors.push("operating evidence was pooled");
  if (report.setupCommandCount !== 0) errors.push("report setup command count is nonzero");
  if (report.perRepositoryRestartCount !== 0)
    errors.push("report per-repository restart count is nonzero");
  if (report.userInterventionCount !== 0) errors.push("report user intervention count is nonzero");
  if (report.crossRepositoryWriteCount !== 0)
    errors.push("cross-repository write count is nonzero");
  const byRun = new Map((report.byRun ?? []).map((run) => [run.runId, run.status]));
  for (const run of runs) {
    if (byRun.get(run.runId) !== run.status)
      errors.push(`[${run.runId}] per-run report status drifted`);
  }
  if (!Array.isArray(report.unsupportedStrata)) errors.push("unsupported strata are absent");
  return errors;
}

const { receiptPath, caseId } = parseArgs(process.argv.slice(2));
const receipt = loadReceipt(receiptPath, caseId);
const errors = validate(receipt);
if (errors.length > 0) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}
console.log(
  `A25 activation operating envelope valid: ${receipt.runs.length}/${receipt.runMatrix.expectedRuns.length} independent runs`,
);
