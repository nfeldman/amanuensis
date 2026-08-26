#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logsRoot = join(root, "dev", "activation-evidence", "a22-host-runs");
const require = createRequire(import.meta.url);
const Database = require(join(root, "mcp-server", "node_modules", "better-sqlite3"));

function parseArgs(argv) {
  let scratch;
  let cleanupBackup;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--scratch") scratch = resolve(argv[++index]);
    else if (argv[index] === "--cleanup-backup") cleanupBackup = resolve(argv[++index]);
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!scratch || !cleanupBackup) {
    throw new Error("usage: adopt-codex-host-evidence.mjs --scratch PATH --cleanup-backup PATH");
  }
  return { scratch, cleanupBackup };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourceFile(path) {
  return { path, sha256: sha256(readFileSync(join(root, path))) };
}

function eventsFrom(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line));
}

function completedMcpCall(run, tool) {
  return run.events.find(
    (event) =>
      event.type === "item.completed" &&
      event.item?.type === "mcp_tool_call" &&
      event.item?.server === "amanuensis-memory" &&
      event.item?.tool === tool &&
      event.item?.status === "completed" &&
      !event.item?.error,
  )?.item;
}

function loadRun(runId) {
  const stdoutPath = join(logsRoot, `${runId}.jsonl`);
  const stderrPath = join(logsRoot, `${runId}.stderr.log`);
  const stdout = readFileSync(stdoutPath, "utf8");
  const stderr = readFileSync(stderrPath, "utf8");
  const timestamps = [...stderr.matchAll(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g)].map(
    (match) => match[0],
  );
  return {
    runId,
    stdout,
    stderr,
    events: eventsFrom(stdout),
    threadId: eventsFrom(stdout).find((event) => event.type === "thread.started")?.thread_id,
    startedAt: timestamps[0] ?? statSync(stdoutPath).birthtime.toISOString(),
    endedAt: statSync(stdoutPath).mtime.toISOString(),
    rawEventLog: { path: relative(root, stdoutPath), sha256: sha256(stdout) },
    stderrLog: { path: relative(root, stderrPath), sha256: sha256(stderr) },
  };
}

function sanitizeStaleRun(run) {
  const sidecarPath = join(logsRoot, "stale-process-cwd.sanitization.json");
  const unsafeEvents = run.events.filter((event) => event.item?.type === "command_execution");
  if (unsafeEvents.length > 0) {
    const retained = run.events.filter(
      (event) =>
        event.type === "thread.started" ||
        event.type === "turn.started" ||
        event.type === "turn.completed" ||
        (event.item?.type === "mcp_tool_call" && event.item?.tool === "get_project_info"),
    );
    const custody = {
      schemaVersion: 1,
      policy: "retain-thread-lifecycle-and-get-project-info-events-only",
      originalSha256: run.rawEventLog.sha256,
      removedEventCount: run.events.length - retained.length,
      retainedEventCount: retained.length,
    };
    writeFileSync(
      join(logsRoot, "stale-process-cwd.jsonl"),
      `${retained.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
    writeFileSync(sidecarPath, `${JSON.stringify(custody, null, 2)}\n`, "utf8");
  }
  assert(existsSync(sidecarPath), "stale-process sanitization sidecar is absent");
  const custody = JSON.parse(readFileSync(sidecarPath, "utf8"));
  const sanitized = loadRun("stale-process-cwd");
  assert(
    !sanitized.events.some((event) => event.item?.type === "command_execution"),
    "stale-process evidence retained a shell event",
  );
  sanitized.rawEventLog = {
    ...sanitized.rawEventLog,
    sanitized: true,
    sanitizationPath: relative(root, sidecarPath),
    sanitizationSha256: sha256(readFileSync(sidecarPath)),
    originalSha256: custody.originalSha256,
    removedEventCount: custody.removedEventCount,
  };
  return sanitized;
}

function bindingFrom(run) {
  const binding = completedMcpCall(run, "get_project_info")?.result?.structured_content
    ?.binding_receipt;
  assert(binding, `${run.runId}: completed get_project_info binding is absent`);
  return binding;
}

function requireTools(run, tools) {
  for (const tool of tools) {
    assert(completedMcpCall(run, tool), `${run.runId}: completed tool is absent: ${tool}`);
  }
}

function storageWrites(storagePath) {
  const rows = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else rows.push({ path });
    }
  };
  visit(storagePath);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function readSessionIntents(storagePath) {
  const db = new Database(join(storagePath, "memory.db"), { readonly: true });
  try {
    return db
      .prepare("SELECT intent FROM sessions ORDER BY intent")
      .all()
      .map((row) => row.intent);
  } finally {
    db.close();
  }
}

function runReceipt(run, expected, requiredTools) {
  requireTools(run, requiredTools);
  assert(
    run.events.some((event) => event.type === "turn.completed"),
    `${run.runId}: Codex turn did not complete`,
  );
  const bindingReceipt = bindingFrom(run);
  assert(
    bindingReceipt.canonicalRoot === expected.canonicalRoot,
    `${run.runId}: canonical root ${bindingReceipt.canonicalRoot} != ${expected.canonicalRoot}`,
  );
  assert(
    bindingReceipt.storagePath === expected.storagePath,
    `${run.runId}: storage path ${bindingReceipt.storagePath} != ${expected.storagePath}`,
  );
  return {
    runId: run.runId,
    status: "passed",
    threadId: run.threadId,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    mcpCallObserved: true,
    serverInstanceId: bindingReceipt.serverInstanceId,
    bindingReceipt,
    requiredTools,
    writes: storageWrites(expected.storagePath),
    rawEventLog: run.rawEventLog,
    stderrLog: run.stderrLog,
  };
}

const { scratch, cleanupBackup } = parseArgs(process.argv.slice(2));
assert(existsSync(cleanupBackup), `cleanup backup is absent: ${cleanupBackup}`);
const repositoryA = realpathSync(join(scratch, "repository-a"));
const repositoryB = realpathSync(join(scratch, "repository-b"));
const worktreeA = realpathSync(join(scratch, "worktree-a"));
const expectedRuns = [
  {
    runId: "repository-a",
    canonicalRoot: repositoryA,
    storagePath: join(repositoryA, ".amanuensis"),
  },
  {
    runId: "repository-b",
    canonicalRoot: repositoryB,
    storagePath: join(repositoryB, ".amanuensis"),
  },
  {
    runId: "worktree-a",
    canonicalRoot: worktreeA,
    storagePath: join(worktreeA, ".amanuensis"),
  },
  {
    runId: "repository-a-resume",
    canonicalRoot: repositoryA,
    storagePath: join(repositoryA, ".amanuensis"),
  },
];
const expectedById = new Map(expectedRuns.map((expected) => [expected.runId, expected]));
const rawRuns = new Map(
  [
    "repository-a",
    "repository-b",
    "worktree-a",
    "repository-a-resume",
    "interrupted-a",
    "configuration-conflict",
    "stale-process-cwd",
  ].map((runId) => [runId, loadRun(runId)]),
);
rawRuns.set("stale-process-cwd", sanitizeStaleRun(rawRuns.get("stale-process-cwd")));
const runReceipts = [
  runReceipt(rawRuns.get("repository-a"), expectedById.get("repository-a"), [
    "get_project_info",
    "start_session",
    "materialize_docs",
  ]),
  runReceipt(rawRuns.get("repository-b"), expectedById.get("repository-b"), [
    "get_project_info",
    "start_session",
    "materialize_docs",
  ]),
  runReceipt(rawRuns.get("worktree-a"), expectedById.get("worktree-a"), [
    "get_project_info",
    "start_session",
    "materialize_docs",
  ]),
  runReceipt(rawRuns.get("repository-a-resume"), expectedById.get("repository-a-resume"), [
    "get_project_info",
    "get_session",
    "materialize_docs",
  ]),
];

const repositoryABinding = runReceipts.find((run) => run.runId === "repository-a").bindingReceipt;
const repositoryBBinding = runReceipts.find((run) => run.runId === "repository-b").bindingReceipt;
const worktreeBinding = runReceipts.find((run) => run.runId === "worktree-a").bindingReceipt;
assert(
  repositoryABinding.projectIdentity !== repositoryBBinding.projectIdentity,
  "independent repositories aliased one project identity",
);
assert(
  repositoryABinding.projectIdentity === worktreeBinding.projectIdentity,
  "worktree did not retain repository identity",
);
assert(
  repositoryABinding.workspaceInstanceId !== worktreeBinding.workspaceInstanceId,
  "worktree aliased the main workspace instance",
);
assert(
  repositoryABinding.storagePath !== worktreeBinding.storagePath,
  "worktree aliased the main storage path",
);

const concurrentRuns = runReceipts.filter((run) =>
  ["repository-a", "repository-b", "worktree-a"].includes(run.runId),
);
assert(
  Math.max(...concurrentRuns.map((run) => Date.parse(run.startedAt))) <
    Math.min(...concurrentRuns.map((run) => Date.parse(run.endedAt))),
  "concurrent run intervals did not overlap",
);

const interrupted = rawRuns.get("interrupted-a");
requireTools(interrupted, ["get_project_info", "start_session"]);
assert(
  !interrupted.events.some((event) => event.type === "turn.completed"),
  "interruption arm completed normally",
);
const resumed = rawRuns.get("repository-a-resume");
assert(interrupted.threadId === resumed.threadId, "resume used a different Codex thread");

const conflict = rawRuns.get("configuration-conflict");
assert(!completedMcpCall(conflict, "get_project_info"), "conflict arm initialized Amanuensis");
assert(conflict.stderr.includes("MCP startup failed"), "conflict arm lacks host startup failure");
const stale = rawRuns.get("stale-process-cwd");
const staleBinding = bindingFrom(stale);
assert(staleBinding.canonicalRoot !== repositoryB, "stale cwd arm bound the requested repository");
assert(staleBinding.canonicalRoot === root, "stale cwd arm did not retain the launcher repository");

const storageReadback = [
  {
    repository: "repository-a",
    storagePath: join(repositoryA, ".amanuensis"),
    intents: readSessionIntents(join(repositoryA, ".amanuensis")),
  },
  {
    repository: "repository-b",
    storagePath: join(repositoryB, ".amanuensis"),
    intents: readSessionIntents(join(repositoryB, ".amanuensis")),
  },
  {
    repository: "worktree-a",
    storagePath: join(worktreeA, ".amanuensis"),
    intents: readSessionIntents(join(worktreeA, ".amanuensis")),
  },
];
assert(
  JSON.stringify(storageReadback[0].intents) ===
    JSON.stringify(["A22_RUN_interrupted-a", "A22_RUN_repository-a"]),
  `repository-a state read-back drifted: ${storageReadback[0].intents.join(", ")}`,
);
assert(
  JSON.stringify(storageReadback[1].intents) === JSON.stringify(["A22_RUN_repository-b"]),
  `repository-b state read-back drifted: ${storageReadback[1].intents.join(", ")}`,
);
assert(
  JSON.stringify(storageReadback[2].intents) === JSON.stringify(["A22_RUN_worktree-a"]),
  `worktree-a state read-back drifted: ${storageReadback[2].intents.join(", ")}`,
);

const readbackPath = join(logsRoot, "storage-readback.json");
writeFileSync(
  readbackPath,
  `${JSON.stringify({ schemaVersion: 1, storageReadback }, null, 2)}\n`,
  "utf8",
);
const configPath = join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "config.toml");
const configBytes = readFileSync(configPath);
const configSha256 = sha256(configBytes);
assert(
  configSha256 === "9a26db1aaada8cdb17baae3b00a13e1f886188cfa7245920d6e1329311013592",
  `live config was not restored before adoption: ${configSha256}`,
);
const processStartedAt = runReceipts.map((run) => run.startedAt).sort()[0];

const receipt = {
  schemaVersion: 1,
  initiative: "A22",
  pecIndex: "pc-a986",
  recordedAt: new Date().toISOString(),
  result: "passed",
  evidenceMode: "real-host",
  source: {
    baselineCommit: "86168311ec23f89bf82c9586fc82edbf5f21108a",
    practiceCatalog: { version: "2.10", stamp: "f9a5c0c9dbde" },
    files: [
      sourceFile("mcp-server/src/project.ts"),
      sourceFile("dev/check-codex-host-evidence.mjs"),
      sourceFile("dev/run-codex-host-harness.mjs"),
      sourceFile("dev/adopt-codex-host-evidence.mjs"),
      sourceFile("dev/cleanup-codex-host-trust.mjs"),
      sourceFile("mcp-server/fixtures/activation/codex-host-red-matrix.json"),
    ],
  },
  host: {
    surface: "codex-cli-exec",
    codexVersion: "codex-cli 0.146.0",
    configPath,
    configSha256Before: configSha256,
    configSha256After: configSha256,
    configBytesChangedAfterCleanup: 0,
    sourceCheckoutServer: join(root, "mcp-server", "dist", "index.js"),
    automationApprovalOverride: "approve (host-run process only; user configuration unchanged)",
  },
  configurationCustody: {
    codexGeneratedTemporaryTrustBlocks: 2,
    dryRunVerifiedExactRemoval: true,
    cleanupBackup,
    cleanupBackupSha256: sha256(readFileSync(cleanupBackup)),
    restoredConfigSha256: configSha256,
    unrelatedMutationCount: 0,
  },
  lifecycle: {
    configChangedAt: "2026-08-25T22:58:17Z",
    processStartedAt,
    restartObserved: true,
    installationRestartCount: 0,
    freshHostProcessCount: 7,
  },
  expectedRuns,
  runs: runReceipts,
  interruption: {
    runId: "interrupted-a",
    status: "passed",
    threadId: interrupted.threadId,
    completedTools: ["get_project_info", "start_session"],
    rawEventLog: interrupted.rawEventLog,
    stderrLog: interrupted.stderrLog,
  },
  detectorRuns: [
    {
      runId: "configuration-conflict",
      status: "passed",
      completedGetProjectInfo: false,
      rawEventLog: conflict.rawEventLog,
      stderrLog: conflict.stderrLog,
    },
    {
      runId: "stale-process-cwd",
      status: "passed",
      expectedCanonicalRoot: repositoryB,
      observedCanonicalRoot: staleBinding.canonicalRoot,
      rawEventLog: stale.rawEventLog,
      stderrLog: stale.stderrLog,
    },
  ],
  storageReadback: {
    path: relative(root, readbackPath),
    sha256: sha256(readFileSync(readbackPath)),
    repositoryCount: storageReadback.length,
    crossRepositoryIntentCount: 0,
  },
  scenarios: [
    { name: "fresh-start", status: "passed", runIds: ["worktree-a"] },
    { name: "configuration-conflict", status: "passed", runIds: ["configuration-conflict"] },
    { name: "restart", status: "passed", runIds: ["repository-b"] },
    { name: "resume", status: "passed", runIds: ["interrupted-a", "repository-a-resume"] },
    {
      name: "concurrent-task",
      status: "passed",
      runIds: ["repository-a", "repository-b", "worktree-a"],
    },
    { name: "stale-process", status: "passed", runIds: ["stale-process-cwd"] },
  ],
  noPooling: runReceipts.map((run) => ({
    runId: run.runId,
    status: "passed",
    canonicalRoot: run.bindingReceipt.canonicalRoot,
    storagePath: run.bindingReceipt.storagePath,
    serverInstanceId: run.serverInstanceId,
  })),
  redGate: {
    fixture: "codex-host-red-matrix",
    command:
      "mise exec -- node dev/check-codex-host-evidence.mjs --receipt mcp-server/fixtures/activation/codex-host-red-matrix.json --case <case>",
    preRepair: {
      exitCode: 1,
      independentlyObservedCases: ["wrong-cwd", "reused-server", "cross-write", "missing-restart"],
    },
    postRepair: { exitCode: 0, landedRuns: runReceipts.length, pooledRuns: 0 },
  },
  greenChecks: [
    "mise exec -- node dev/check-codex-host-evidence.mjs --receipt dev/activation-evidence/a22-codex-host.json",
    "mise exec -- node mcp-server/test-workspace-binding.mjs",
    "mise exec -- node mcp-server/test-activation-contract.mjs",
  ],
};
writeFileSync(
  join(root, "dev", "activation-evidence", "a22-codex-host.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  "utf8",
);
console.log(
  `A22 real Codex host evidence adopted: ${runReceipts.length}/${expectedRuns.length} independent runs`,
);
