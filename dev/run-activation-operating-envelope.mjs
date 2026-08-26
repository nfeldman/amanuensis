#!/usr/bin/env node
import assert from "node:assert/strict";
// A25 real-host operating-envelope harness. Every positive stratum receives a
// distinct Codex thread and Amanuensis server process. Results remain by-run;
// a failed or missing run aborts instead of being pooled into an aggregate.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../mcp-server/dist/db.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = join(root, "dev", "activation-evidence", "a25-host-runs");
const approvalOverride = [
  "--config",
  'mcp_servers.amanuensis-memory.default_tools_approval_mode="approve"',
];

function parseArgs(argv) {
  let execute = false;
  let outputDir = defaultOutput;
  let reuseScratch;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--execute") execute = true;
    else if (argv[index] === "--output-dir") outputDir = resolve(argv[++index]);
    else if (argv[index] === "--reuse-scratch") reuseScratch = realpathSync(resolve(argv[++index]));
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return { execute, outputDir, reuseScratch };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert(
    result.status === 0,
    `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout.trim();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourceFile(path) {
  return { path, sha256: sha256(readFileSync(join(root, path))) };
}

function initRepository(path, logicalRepositoryId) {
  mkdirSync(path, { recursive: true });
  run("git", ["init", "--quiet", "--initial-branch=main"], { cwd: path });
  writeFileSync(join(path, "README.md"), `# ${logicalRepositoryId}\n`, "utf8");
  run("git", ["add", "README.md"], { cwd: path });
  run(
    "git",
    [
      "-c",
      "user.name=Amanuensis A25 Harness",
      "-c",
      "user.email=a25-harness@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      "fixture",
    ],
    { cwd: path },
  );
  run(
    "git",
    ["remote", "add", "origin", `https://github.com/amanuensis-a25/${logicalRepositoryId}.git`],
    { cwd: path },
  );
}

function eventLines(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line));
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

function launchCodex({ cwd, prompt, extraArgs = [] }) {
  const args = [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--dangerously-bypass-hook-trust",
    "--ephemeral",
    ...extraArgs,
    prompt,
  ];
  const startedAt = new Date().toISOString();
  return new Promise((resolvePromise, reject) => {
    const child = spawn("codex", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let threadId = null;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex host run timed out in ${cwd}\n${stderr}`));
    }, 300_000);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      lineBuffer += text;
      let newline = lineBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = lineBuffer.slice(0, newline).trim();
        lineBuffer = lineBuffer.slice(newline + 1);
        if (line.startsWith("{")) {
          const event = JSON.parse(line);
          if (event.type === "thread.started") threadId = event.thread_id;
        }
        newline = lineBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolvePromise({
        args,
        code,
        signal,
        stdout,
        stderr,
        threadId,
        startedAt,
        endedAt: new Date().toISOString(),
        events: eventLines(stdout),
      });
    });
  });
}

function writeLog(outputDir, runId, suffix, bytes) {
  const name = `${runId}.${suffix}`;
  const path = join(outputDir, name);
  writeFileSync(path, bytes, "utf8");
  return { path: relative(root, path), sha256: sha256(bytes) };
}

function writeRunLogs(outputDir, runId, run) {
  return {
    rawEventLog: writeLog(outputDir, runId, "jsonl", run.stdout),
    stderrLog: writeLog(outputDir, runId, "stderr.log", run.stderr),
  };
}

function storageFiles(storagePath) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const bytes = readFileSync(path);
        files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
      } else {
        throw new Error(`unexpected non-file in store: ${path}`);
      }
    }
  };
  visit(storagePath);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function sessionIntents(storagePath) {
  const database = openDatabase(join(storagePath, "memory.db"));
  try {
    return database
      .prepare("SELECT intent FROM sessions ORDER BY started_at, session_id")
      .all()
      .map((row) => row.intent);
  } finally {
    database.close();
  }
}

function writeStoreCustody(outputDir, runId, expected, bindingReceipt, threadId) {
  const observedSessionIntents = sessionIntents(expected.storagePath);
  const files = storageFiles(expected.storagePath);
  const custody = {
    schemaVersion: 1,
    runId,
    threadId,
    serverInstanceId: bindingReceipt.serverInstanceId,
    bindingId: bindingReceipt.bindingId,
    canonicalRoot: expected.canonicalRoot,
    storagePath: expected.storagePath,
    observedSessionIntents,
    files,
  };
  const bytes = `${JSON.stringify(custody, null, 2)}\n`;
  return {
    reference: writeLog(outputDir, runId, "store-custody.json", bytes),
    custody,
  };
}

function requirePositiveRun(run, expected) {
  assert(
    run.code === 0,
    `${expected.runId}: Codex exited ${run.code ?? run.signal}\n${run.stderr}`,
  );
  assert(run.threadId, `${expected.runId}: Codex emitted no thread identity`);
  const commandEvents = run.events.filter(
    (event) => event.item?.type === "command_execution" || event.item?.type === "file_change",
  );
  assert(commandEvents.length === 0, `${expected.runId}: host used a forbidden non-MCP tool`);
  const info = completedMcpCall(run.events, "get_project_info");
  const start = completedMcpCall(run.events, "start_session");
  const current = completedMcpCall(run.events, "get_session");
  assert(info && start && current, `${expected.runId}: required MCP sequence did not complete`);
  const bindingReceipt = info.result?.structured_content?.binding_receipt;
  assert(bindingReceipt, `${expected.runId}: get_project_info omitted its binding receipt`);
  assert.equal(bindingReceipt.canonicalRoot, expected.canonicalRoot);
  assert.equal(bindingReceipt.storagePath, expected.storagePath);
  assert.equal(bindingReceipt.selectionSource, expected.selectionSource);
  assert.equal(start.arguments?.intent, `A25_RUN_${expected.runId}`);
  return bindingReceipt;
}

function findAmanuensisStores(scratch) {
  const stores = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === ".git") continue;
      if (entry.name === ".amanuensis") stores.push(realpathSync(path));
      else visit(path);
    }
  };
  visit(scratch);
  return stores.sort();
}

const { execute, outputDir, reuseScratch } = parseArgs(process.argv.slice(2));
if (!execute) {
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        hostSurface: "codex-cli-exec",
        logicalRepositories: 5,
        workspaces: 6,
        requiredShapes: ["repository-root", "nested-launch", "worktree", "parent-cd"],
        concurrentWaveSize: 3,
        liveUserConfigMutation: false,
        reuseScratch: reuseScratch ?? null,
        outputDir,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const scratch = reuseScratch ?? mkdtempSync(join(tmpdir(), "amanuensis-a25-operating-"));
assert(
  /^\/private\/var\/folders\/[^/]+\/[^/]+\/T\/amanuensis-a25-operating-[^/]+$/.test(
    realpathSync(scratch),
  ),
  `refusing non-A25 scratch root: ${scratch}`,
);
const campaignId = `a25-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const repositories = Object.fromEntries(
  ["repo-a", "repo-b", "repo-c", "repo-d", "repo-e"].map((name) => [name, join(scratch, name)]),
);
const worktreeD = join(scratch, "repo-d-worktree");
const nestedC = join(repositories["repo-c"], "packages", "service");
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
let completed = false;

try {
  if (reuseScratch) {
    for (const path of [...Object.values(repositories), worktreeD]) {
      assert(existsSync(path), `reused A25 workspace is absent: ${path}`);
      rmSync(join(path, ".amanuensis"), { recursive: true, force: true });
    }
  } else {
    for (const [logicalRepositoryId, path] of Object.entries(repositories)) {
      initRepository(path, logicalRepositoryId);
    }
    mkdirSync(nestedC, { recursive: true });
    run("git", ["worktree", "add", "--quiet", "-b", "a25-worktree", worktreeD], {
      cwd: repositories["repo-d"],
    });
  }

  const configPath = join(
    process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"),
    "config.toml",
  );
  const configBefore = readFileSync(configPath);
  const configText = configBefore.toString("utf8");
  const managedInstallationCount = (
    configText.match(/^\[mcp_servers\.amanuensis-memory\]$/gm) ?? []
  ).length;
  assert(
    managedInstallationCount === 1,
    `expected one Amanuensis registration, found ${managedInstallationCount}`,
  );
  assert(configText.includes('cwd = "."'), "live Amanuensis registration is not cwd-relative");
  assert(!/^args = .*--workspace/m.test(configText), "live user registration pins a repository");

  const ids = Object.fromEntries(
    [
      "repo-a-root",
      "repo-b-root",
      "repo-c-nested",
      "repo-d-root",
      "repo-d-worktree",
      "repo-e-parent-cd",
    ].map((name) => [name, `${campaignId}-${name}`]),
  );
  const expectedRuns = [
    {
      runId: ids["repo-a-root"],
      logicalRepositoryId: "repo-a",
      shape: "repository-root",
      launchCwd: repositories["repo-a"],
      canonicalRoot: realpathSync(repositories["repo-a"]),
      storagePath: join(realpathSync(repositories["repo-a"]), ".amanuensis"),
      selectionSource: "process-cwd-git-root",
      concurrentWave: `${campaignId}-wave-1`,
    },
    {
      runId: ids["repo-b-root"],
      logicalRepositoryId: "repo-b",
      shape: "repository-root",
      launchCwd: repositories["repo-b"],
      canonicalRoot: realpathSync(repositories["repo-b"]),
      storagePath: join(realpathSync(repositories["repo-b"]), ".amanuensis"),
      selectionSource: "process-cwd-git-root",
      concurrentWave: `${campaignId}-wave-1`,
    },
    {
      runId: ids["repo-c-nested"],
      logicalRepositoryId: "repo-c",
      shape: "nested-launch",
      launchCwd: nestedC,
      canonicalRoot: realpathSync(repositories["repo-c"]),
      storagePath: join(realpathSync(repositories["repo-c"]), ".amanuensis"),
      selectionSource: "process-cwd-git-root",
      concurrentWave: null,
    },
    {
      runId: ids["repo-d-root"],
      logicalRepositoryId: "repo-d",
      shape: "repository-root",
      launchCwd: repositories["repo-d"],
      canonicalRoot: realpathSync(repositories["repo-d"]),
      storagePath: join(realpathSync(repositories["repo-d"]), ".amanuensis"),
      selectionSource: "process-cwd-git-root",
      concurrentWave: null,
    },
    {
      runId: ids["repo-d-worktree"],
      logicalRepositoryId: "repo-d",
      shape: "worktree",
      launchCwd: worktreeD,
      canonicalRoot: realpathSync(worktreeD),
      storagePath: join(realpathSync(worktreeD), ".amanuensis"),
      selectionSource: "process-cwd-git-root",
      concurrentWave: `${campaignId}-wave-1`,
    },
    {
      runId: ids["repo-e-parent-cd"],
      logicalRepositoryId: "repo-e",
      shape: "parent-cd",
      launchCwd: root,
      targetCwd: repositories["repo-e"],
      canonicalRoot: realpathSync(repositories["repo-e"]),
      storagePath: join(realpathSync(repositories["repo-e"]), ".amanuensis"),
      selectionSource: "parent-codex-cli-cd-git-root",
      concurrentWave: null,
    },
  ];
  const promptFor = (runId) =>
    `A25 host evidence run ${runId}. Do not use shell tools or edit files. Call only the Amanuensis MCP tools, in this order: get_project_info; start_session with intent exactly A25_RUN_${runId}; get_session. Finish only after all three calls complete.`;
  const launchExpected = (expected) =>
    launchCodex({
      cwd: expected.launchCwd,
      prompt: promptFor(expected.runId),
      extraArgs: [...(expected.targetCwd ? ["--cd", expected.targetCwd] : []), ...approvalOverride],
    });

  const concurrentIds = new Set([ids["repo-a-root"], ids["repo-b-root"], ids["repo-d-worktree"]]);
  const concurrent = await Promise.all(
    expectedRuns
      .filter((expected) => concurrentIds.has(expected.runId))
      .map(async (expected) => [expected.runId, await launchExpected(expected)]),
  );
  const rawRuns = new Map(concurrent);
  for (const expected of expectedRuns.filter((candidate) => !concurrentIds.has(candidate.runId))) {
    rawRuns.set(expected.runId, await launchExpected(expected));
  }

  const runReceipts = [];
  for (const expected of expectedRuns) {
    const raw = rawRuns.get(expected.runId);
    const bindingReceipt = requirePositiveRun(raw, expected);
    const logs = writeRunLogs(outputDir, expected.runId, raw);
    const store = writeStoreCustody(
      outputDir,
      expected.runId,
      expected,
      bindingReceipt,
      raw.threadId,
    );
    assert.deepEqual(store.custody.observedSessionIntents, [`A25_RUN_${expected.runId}`]);
    runReceipts.push({
      runId: expected.runId,
      status: "passed",
      threadId: raw.threadId,
      serverInstanceId: bindingReceipt.serverInstanceId,
      startedAt: raw.startedAt,
      endedAt: raw.endedAt,
      amanuensisSetupCommandCount: 0,
      perRepositoryRestartCount: 0,
      userInterventionCount: 0,
      diagnosisDurationMs: 0,
      recovery: "not-required",
      bindingReceipt,
      writes: store.custody.files.map(({ path }) => ({ path })),
      observedSessionIntents: store.custody.observedSessionIntents,
      storeCustody: store.reference,
      ...logs,
    });
  }

  const expectedStores = expectedRuns.map((run) => run.storagePath).sort();
  assert.deepEqual(
    findAmanuensisStores(scratch),
    expectedStores,
    "unexpected Amanuensis store location",
  );
  assert(!existsSync(join(nestedC, ".amanuensis")), "nested launch created nested state");
  assert(
    new Set(runReceipts.map((run) => run.threadId)).size === runReceipts.length,
    "thread ID reused",
  );
  assert(
    new Set(runReceipts.map((run) => run.serverInstanceId)).size === runReceipts.length,
    "server instance ID reused",
  );

  const negativeRunId = `${campaignId}-negative-config`;
  const launchAuditPath = join(outputDir, `${negativeRunId}.launch-audit.jsonl`);
  const serverEntry = join(root, "mcp-server", "dist", "index.js");
  const launchWitness = join(root, "dev", "capture-activation-launch.mjs");
  const negativeStarted = Date.now();
  const negative = await launchCodex({
    cwd: repositories["repo-b"],
    prompt:
      "Call Amanuensis get_project_info exactly once. If it is unavailable, report that startup failed. Do not call another tool.",
    extraArgs: [
      "--config",
      `mcp_servers.amanuensis-memory.command=${JSON.stringify(process.execPath)}`,
      "--config",
      `mcp_servers.amanuensis-memory.args=[${[
        launchWitness,
        launchAuditPath,
        process.execPath,
        serverEntry,
        "--workspace",
        repositories["repo-a"],
      ]
        .map((value) => JSON.stringify(value))
        .join(",")}]`,
      ...approvalOverride,
    ],
  });
  const diagnosisDurationMs = Date.now() - negativeStarted;
  const negativeLogs = writeRunLogs(outputDir, negativeRunId, negative);
  assert(
    !completedMcpCall(negative.events, "get_project_info"),
    "negative control completed MCP call",
  );
  assert(existsSync(launchAuditPath), "Codex did not launch the configured witness");
  const launchAudit = readFileSync(launchAuditPath, "utf8");
  const launchEvents = eventLines(launchAudit);
  const launchEvent = launchEvents.find((event) => event.type === "launch");
  const detectorText = launchEvents
    .filter((event) => event.type === "server-stderr")
    .map((event) => event.text)
    .join("");
  assert(launchEvent, "launch witness did not record server launch");
  assert.equal(launchEvent.cwd, realpathSync(repositories["repo-b"]));
  assert.deepEqual(launchEvent.args, [serverEntry, "--workspace", repositories["repo-a"]]);
  assert(detectorText.includes("workspace mismatch before state initialization"), detectorText);
  assert(detectorText.includes(realpathSync(repositories["repo-a"])), detectorText);
  assert(detectorText.includes(realpathSync(repositories["repo-b"])), detectorText);
  const launchAuditLog = { path: relative(root, launchAuditPath), sha256: sha256(launchAudit) };

  const configAfter = readFileSync(configPath);
  assert(
    Buffer.compare(configBefore, configAfter) === 0,
    "host matrix changed user configuration bytes",
  );
  const latestStart = Math.max(
    ...runReceipts
      .filter((run) => concurrentIds.has(run.runId))
      .map((run) => Date.parse(run.startedAt)),
  );
  const earliestEnd = Math.min(
    ...runReceipts
      .filter((run) => concurrentIds.has(run.runId))
      .map((run) => Date.parse(run.endedAt)),
  );
  assert(latestStart < earliestEnd, "concurrent host intervals did not overlap");

  const receipt = {
    schemaVersion: 1,
    initiative: "A25",
    pecIndex: "pc-15a4",
    campaignId,
    recordedAt: new Date().toISOString(),
    result: "passed",
    evidenceMode: "real-host",
    source: {
      baselineCommit: "5732b678ededd40eaa2a0e0ada633f43d0bb789c",
      implementationCommit: run("git", ["rev-parse", "HEAD"], { cwd: root }),
      practiceCatalog: { version: "2.10", stamp: "f9a5c0c9dbde" },
      files: [
        sourceFile("mcp-server/src/index.ts"),
        sourceFile("mcp-server/src/project.ts"),
        sourceFile("mcp-server/test-nested-activation-binding.mjs"),
        sourceFile("dev/check-activation-operating-envelope.mjs"),
        sourceFile("dev/test-activation-operating-envelope-red-gates.mjs"),
        sourceFile("dev/run-activation-operating-envelope.mjs"),
        sourceFile("dev/capture-activation-launch.mjs"),
        sourceFile("dev/cleanup-activation-operating-trust.mjs"),
        sourceFile("dev/test-activation-operating-trust-cleanup.mjs"),
        sourceFile("mcp-server/fixtures/activation/operating-envelope-red-matrix.json"),
      ],
    },
    host: {
      surface: "codex-cli-exec",
      codexVersion: run("codex", ["--version"]),
      configPath,
      configSha256Before: sha256(configBefore),
      configSha256After: sha256(configAfter),
      configBytesChanged: 0,
      managedInstallationCount,
      installationRestartCount: 0,
      perRepositoryRestartCount: 0,
      sourceCheckoutServer: serverEntry,
      approvalOverride: "approve (harness process only; user configuration unchanged)",
    },
    runMatrix: {
      preregisteredBeforeExecution: true,
      logicalRepositoryCount: 5,
      workspaceCount: expectedRuns.length,
      requiredShapes: ["repository-root", "nested-launch", "worktree", "parent-cd"],
      expectedRuns,
    },
    runs: runReceipts,
    negativeRuns: [
      {
        runId: negativeRunId,
        status: "passed",
        threadId: negative.threadId,
        configurationDeliveryCleared: true,
        hostLaunchCleared: true,
        detectorOperationCleared: true,
        diagnosisDurationMs,
        diagnosisTargetMs: 30_000,
        userInterventionCount: 0,
        boundedRemediation:
          "Remove the per-run hard-coded args override; the unchanged managed user registration then resumes cwd-relative launch.",
        expectedSelectedWorkspace: realpathSync(repositories["repo-a"]),
        observedLaunchCwd: launchEvent.cwd,
        detectorWitness: "workspace mismatch before state initialization",
        launchAuditLog,
        ...negativeLogs,
      },
    ],
    report: {
      status: "passed",
      aggregation: "none",
      setupCommandCount: 0,
      perRepositoryRestartCount: 0,
      userInterventionCount: 0,
      crossRepositoryWriteCount: 0,
      byRun: runReceipts.map((run) => ({ runId: run.runId, status: run.status })),
      unsupportedStrata: [
        "Codex desktop task UI (this campaign measured the Codex CLI exec host surface)",
        "non-Codex MCP clients",
        "Windows hosts",
        "published npm registry installation (publication was not authorized)",
      ],
      exclusions: [
        "No failed positive runs were excluded or pooled.",
        "The negative control is reported separately and does not contribute to the positive denominator.",
      ],
    },
    redGate: {
      command: "mise exec -- node dev/test-activation-operating-envelope-red-gates.mjs",
      preImplementation: {
        exitCode: 0,
        casesObservedExitingNonzero: 3,
        cases: ["pooled-failure", "omitted-intervention", "reused-run-id"],
      },
      landed: { independentRuns: runReceipts.length, pooledRuns: 0 },
    },
    greenChecks: [
      "mise exec -- node dev/check-activation-operating-envelope.mjs --receipt dev/activation-evidence/a25-activation-operating-envelope.json",
      "mise exec -- node mcp-server/test-nested-activation-binding.mjs",
    ],
  };
  writeFileSync(
    join(root, "dev", "activation-evidence", "a25-activation-operating-envelope.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `A25 real Codex operating envelope landed: ${runReceipts.length}/${expectedRuns.length} independent runs, 5 logical repositories`,
  );
  completed = true;
} finally {
  if (completed && !reuseScratch) rmSync(scratch, { recursive: true, force: true });
  else if (completed)
    process.stderr.write(`A25 reused scratch retained for trust cleanup: ${scratch}\n`);
  else process.stderr.write(`A25 harness scratch preserved for diagnosis: ${scratch}\n`);
}
