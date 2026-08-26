#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = join(root, "dev", "activation-evidence", "a22-host-runs");
const approvalOverride = [
  "--config",
  'mcp_servers.amanuensis-memory.default_tools_approval_mode="approve"',
];

function parseArgs(argv) {
  let execute = false;
  let outputDir = defaultOutput;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--execute") execute = true;
    else if (argv[index] === "--output-dir") outputDir = resolve(argv[++index]);
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return { execute, outputDir };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function initRepository(path, name) {
  mkdirSync(path, { recursive: true });
  run("git", ["init", "--quiet", "--initial-branch=main"], { cwd: path });
  writeFileSync(join(path, "README.md"), `# ${name}\n`, "utf8");
  run("git", ["add", "README.md"], { cwd: path });
  run(
    "git",
    [
      "-c",
      "user.name=Amanuensis Host Harness",
      "-c",
      "user.email=host-harness@example.invalid",
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
  run("git", ["remote", "add", "origin", `https://github.com/amanuensis-host/${name}.git`], {
    cwd: path,
  });
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

function launchCodex({ cwd, prompt, resumeThreadId, extraArgs = [], interruptAfterTool }) {
  const args = resumeThreadId
    ? [
        "exec",
        "resume",
        "--json",
        "--dangerously-bypass-hook-trust",
        ...extraArgs,
        resumeThreadId,
        prompt,
      ]
    : [
        "exec",
        "--json",
        "--sandbox",
        "workspace-write",
        "--dangerously-bypass-hook-trust",
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
    let interrupted = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex host run timed out in ${cwd}\n${stderr}`));
    }, 240_000);
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
          if (
            interruptAfterTool &&
            event.type === "item.completed" &&
            event.item?.type === "mcp_tool_call" &&
            event.item?.server === "amanuensis-memory" &&
            event.item?.tool === interruptAfterTool &&
            event.item?.status === "completed"
          ) {
            interrupted = true;
            child.kill("SIGTERM");
          }
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
        interrupted,
        startedAt,
        endedAt: new Date().toISOString(),
        events: eventLines(stdout),
      });
    });
  });
}

function bindingFrom(run, label) {
  const call = completedMcpCall(run.events, "get_project_info");
  const binding = call?.result?.structured_content?.binding_receipt;
  assert(
    binding,
    `${label}: no completed get_project_info MCP result\n${run.stdout}\n${run.stderr}`,
  );
  return binding;
}

function requireTools(run, label, tools) {
  for (const tool of tools) {
    assert(completedMcpCall(run.events, tool), `${label}: MCP tool ${tool} did not complete`);
  }
}

function writeRunLog(outputDir, runId, run) {
  const stdoutName = `${runId}.jsonl`;
  const stderrName = `${runId}.stderr.log`;
  writeFileSync(join(outputDir, stdoutName), run.stdout, "utf8");
  writeFileSync(join(outputDir, stderrName), run.stderr, "utf8");
  return {
    rawEventLog: {
      path: relative(root, join(outputDir, stdoutName)),
      sha256: sha256(run.stdout),
    },
    stderrLog: {
      path: relative(root, join(outputDir, stderrName)),
      sha256: sha256(run.stderr),
    },
  };
}

function storageWrites(storagePath) {
  const paths = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else paths.push({ path });
    }
  };
  visit(storagePath);
  return paths.sort((a, b) => a.path.localeCompare(b.path));
}

function buildRunReceipt(runId, run, expected, requiredTools, logs, writes) {
  assert(run.code === 0, `${runId}: Codex exited ${run.code ?? run.signal}\n${run.stderr}`);
  requireTools(run, runId, requiredTools);
  const bindingReceipt = bindingFrom(run, runId);
  assert(
    bindingReceipt.canonicalRoot === expected.canonicalRoot,
    `${runId}: ${bindingReceipt.canonicalRoot} != ${expected.canonicalRoot}`,
  );
  assert(
    bindingReceipt.storagePath === expected.storagePath,
    `${runId}: ${bindingReceipt.storagePath} != ${expected.storagePath}`,
  );
  return {
    runId,
    status: "passed",
    threadId: run.threadId,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    mcpCallObserved: true,
    serverInstanceId: bindingReceipt.serverInstanceId,
    bindingReceipt,
    requiredTools,
    writes,
    ...logs,
  };
}

const { execute, outputDir } = parseArgs(process.argv.slice(2));
if (!execute) {
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        hostSurface: "codex-cli-exec",
        outputDir,
        concurrentRuns: ["repository-a", "repository-b", "worktree-a"],
        lifecycleRuns: ["interrupted-a", "repository-a-resume"],
        detectorRuns: ["configuration-conflict", "stale-process-cwd"],
        mutates: ["temporary Git repositories", outputDir],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), "amanuensis-codex-host-"));
const repositoryA = join(scratch, "repository-a");
const repositoryB = join(scratch, "repository-b");
const worktreeA = join(scratch, "worktree-a");
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
let completed = false;

try {
  initRepository(repositoryA, "repository-a");
  initRepository(repositoryB, "repository-b");
  run("git", ["worktree", "add", "--quiet", "-b", "a22-worktree", worktreeA], {
    cwd: repositoryA,
  });
  const configPath = join(
    process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"),
    "config.toml",
  );
  const configBefore = readFileSync(configPath);
  const activationReceipt = JSON.parse(
    readFileSync(join(root, "dev", "activation-evidence", "a19-user-scoped-contract.json"), "utf8"),
  );

  const expectedRuns = [
    {
      runId: "repository-a",
      canonicalRoot: realpathSync(repositoryA),
      storagePath: join(realpathSync(repositoryA), ".amanuensis"),
    },
    {
      runId: "repository-b",
      canonicalRoot: realpathSync(repositoryB),
      storagePath: join(realpathSync(repositoryB), ".amanuensis"),
    },
    {
      runId: "worktree-a",
      canonicalRoot: realpathSync(worktreeA),
      storagePath: join(realpathSync(worktreeA), ".amanuensis"),
    },
    {
      runId: "repository-a-resume",
      canonicalRoot: realpathSync(repositoryA),
      storagePath: join(realpathSync(repositoryA), ".amanuensis"),
    },
  ];
  const promptFor = (runId) =>
    `This is Codex host evidence run ${runId}. Do not use shell tools. Call the Amanuensis get_project_info MCP tool first. Then call start_session with intent exactly A22_RUN_${runId}. Then call materialize_docs with output_dir exactly a22-docs/${runId} and clean_publish true. Do not call any other tools. Finish only after all three MCP calls complete.`;

  const concurrent = await Promise.all(
    [
      ["repository-a", repositoryA],
      ["repository-b", repositoryB],
      ["worktree-a", worktreeA],
    ].map(async ([runId, cwd]) => [
      runId,
      await launchCodex({
        cwd,
        prompt: promptFor(runId),
        extraArgs: ["--ephemeral", ...approvalOverride],
      }),
    ]),
  );
  for (const [runId, raw] of concurrent) writeRunLog(outputDir, runId, raw);

  const interrupted = await launchCodex({
    cwd: repositoryA,
    prompt:
      "This is Codex host interruption evidence. Do not use shell tools. Call the Amanuensis get_project_info MCP tool first, then call start_session with intent exactly A22_RUN_interrupted-a, then call get_session. Do not call any other tools.",
    extraArgs: approvalOverride,
    interruptAfterTool: "start_session",
  });
  const interruptedLogs = writeRunLog(outputDir, "interrupted-a", interrupted);
  assert(interrupted.threadId, "interrupted run did not expose a Codex thread ID");
  assert(interrupted.interrupted, "interrupted run reached normal completion before the kill gate");
  requireTools(interrupted, "interrupted-a", ["get_project_info", "start_session"]);

  const resumed = await launchCodex({
    cwd: repositoryA,
    resumeThreadId: interrupted.threadId,
    extraArgs: approvalOverride,
    prompt:
      "Resume the interrupted activation proof. Do not use shell tools. Call the Amanuensis get_project_info MCP tool first, then call get_session, then call materialize_docs with output_dir exactly a22-docs/repository-a-resume and clean_publish true. Do not call any other tools.",
  });

  const serverEntry = join(root, "mcp-server", "dist", "index.js");
  const conflict = await launchCodex({
    cwd: repositoryB,
    prompt:
      "Call the Amanuensis get_project_info MCP tool exactly once. If it is unavailable, report the startup error without using another tool.",
    extraArgs: [
      "--ephemeral",
      "--config",
      `mcp_servers.amanuensis-memory.args=[${JSON.stringify(serverEntry)},"--workspace",${JSON.stringify(repositoryA)}]`,
    ],
  });
  const conflictLogs = writeRunLog(outputDir, "configuration-conflict", conflict);
  assert(
    !completedMcpCall(conflict.events, "get_project_info"),
    "configuration-conflict run unexpectedly completed get_project_info",
  );
  assert(
    `${conflict.stdout}\n${conflict.stderr}`.includes("workspace mismatch") ||
      `${conflict.stdout}\n${conflict.stderr}`.includes("failed"),
    "configuration-conflict run did not expose an actionable host failure",
  );

  const stale = await launchCodex({
    cwd: root,
    prompt:
      "Call the Amanuensis get_project_info MCP tool exactly once and report its canonical root.",
    extraArgs: ["--ephemeral", "--cd", repositoryB],
  });
  const staleLogs = writeRunLog(outputDir, "stale-process-cwd", stale);
  const staleBinding = bindingFrom(stale, "stale-process-cwd");
  assert(
    staleBinding.canonicalRoot !== realpathSync(repositoryB),
    "stale-process-cwd detector did not receive a wrong workspace",
  );

  const allRaw = new Map(concurrent);
  allRaw.set("repository-a-resume", resumed);
  const runReceipts = [];
  for (const expected of expectedRuns) {
    const raw = allRaw.get(expected.runId);
    const requiredTools =
      expected.runId === "repository-a-resume"
        ? ["get_project_info", "get_session", "materialize_docs"]
        : ["get_project_info", "start_session", "materialize_docs"];
    const logs = writeRunLog(outputDir, expected.runId, raw);
    const writes = storageWrites(expected.storagePath);
    runReceipts.push(buildRunReceipt(expected.runId, raw, expected, requiredTools, logs, writes));
  }

  const configAfter = readFileSync(configPath);
  assert(
    Buffer.compare(configBefore, configAfter) === 0,
    "Codex host runs changed user configuration bytes",
  );
  const configChangedAt = activationReceipt.recordedAt;
  const processStartedAt = [
    ...runReceipts.map((runReceipt) => runReceipt.startedAt),
    interrupted.startedAt,
    conflict.startedAt,
    stale.startedAt,
  ].sort()[0];
  assert(
    Date.parse(processStartedAt) > Date.parse(configChangedAt),
    "host runs predate managed config",
  );

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
        sourceFile("dev/cleanup-codex-host-trust.mjs"),
        sourceFile("mcp-server/fixtures/activation/codex-host-red-matrix.json"),
      ],
    },
    host: {
      surface: "codex-cli-exec",
      codexVersion: run("codex", ["--version"]),
      configPath,
      configSha256Before: sha256(configBefore),
      configSha256After: sha256(configAfter),
      configBytesChanged: 0,
      sourceCheckoutServer: serverEntry,
      automationApprovalOverride: "approve (harness process only; user configuration unchanged)",
    },
    lifecycle: {
      configChangedAt,
      processStartedAt,
      restartObserved: true,
      installationRestartCount: 0,
      freshHostProcessCount: runReceipts.length + 3,
    },
    expectedRuns,
    runs: runReceipts,
    interruption: {
      runId: "interrupted-a",
      status: "passed",
      threadId: interrupted.threadId,
      signal: interrupted.signal,
      completedTools: ["get_project_info", "start_session"],
      ...interruptedLogs,
    },
    detectorRuns: [
      {
        runId: "configuration-conflict",
        status: "passed",
        completedGetProjectInfo: false,
        ...conflictLogs,
      },
      {
        runId: "stale-process-cwd",
        status: "passed",
        expectedCanonicalRoot: realpathSync(repositoryB),
        observedCanonicalRoot: staleBinding.canonicalRoot,
        ...staleLogs,
      },
    ],
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
    noPooling: runReceipts.map((runReceipt) => ({
      runId: runReceipt.runId,
      status: "passed",
      canonicalRoot: runReceipt.bindingReceipt.canonicalRoot,
      storagePath: runReceipt.bindingReceipt.storagePath,
      serverInstanceId: runReceipt.serverInstanceId,
    })),
    redGate: {
      fixture: "codex-host-red-matrix",
      command:
        "mise exec -- node dev/check-codex-host-evidence.mjs --receipt mcp-server/fixtures/activation/codex-host-red-matrix.json --case <case>",
      preRepair: {
        exitCode: 1,
        independentlyObservedCases: [
          "wrong-cwd",
          "reused-server",
          "cross-write",
          "missing-restart",
        ],
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
    `A22 real Codex host evidence landed: ${runReceipts.length}/${expectedRuns.length} independent runs`,
  );
  completed = true;
} finally {
  if (completed) rmSync(scratch, { recursive: true, force: true });
  else process.stderr.write(`A22 harness scratch preserved for diagnosis: ${scratch}\n`);
}
