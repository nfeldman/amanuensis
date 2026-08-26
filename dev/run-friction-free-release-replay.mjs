#!/usr/bin/env node
// Execute the A26 pre-publication replay under the already-pinned Node process.
// The replay composes, without pooling, the exact package artifact gate,
// source/packed parity, interruption recovery, isolated rollback rehearsal,
// documentation read-back, and the committed A25 real-Codex evidence checker.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = resolve(root, "dev/activation-evidence/a26-clean-replay.json");

function parseArgs(argv) {
  let output = defaultOutput;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") output = resolve(argv[++index]);
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return { output };
}

function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileReference(path) {
  const absolute = resolve(root, path);
  assert(isWithin(root, absolute), `evidence reference escapes repository: ${path}`);
  assert(existsSync(absolute), `evidence reference is missing: ${path}`);
  return { path: relative(root, absolute), sha256: sha256(readFileSync(absolute)) };
}

function execute(id, displayCommand, args, options = {}) {
  const startedAt = new Date().toISOString();
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  assert.equal(
    result.status,
    0,
    `${displayCommand} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
  );
  return {
    id,
    command: displayCommand,
    exitCode: result.status,
    startedAt,
    durationMs: Math.round(durationMs),
    stdout: result.stdout.trim(),
    stdoutSha256: sha256(result.stdout),
    stderrSha256: sha256(result.stderr),
  };
}

function documentReadBack() {
  const documents = {
    root: { path: "README.md", text: readFileSync(resolve(root, "README.md"), "utf8") },
    server: {
      path: "mcp-server/README.md",
      text: readFileSync(resolve(root, "mcp-server/README.md"), "utf8"),
    },
    adr: {
      path: "dev/adr/0021-friction-free-codex-activation.md",
      text: readFileSync(resolve(root, "dev/adr/0021-friction-free-codex-activation.md"), "utf8"),
    },
  };
  const checks = [
    {
      checkId: "one-user-installation",
      document: "root",
      pattern: /one managed MCP registration under/,
    },
    {
      checkId: "one-installation-restart",
      document: "root",
      pattern: /Restart Codex once after that installation/,
    },
    {
      checkId: "zero-new-repository-ceremony",
      document: "root",
      pattern:
        /New trusted\s+Git repositories then need no Amanuensis command, repository-local config,\s+skill copy, or restart/,
    },
    {
      checkId: "cwd-relative-launch",
      document: "server",
      pattern: /cwd-relative\s+stdio registration/,
    },
    {
      checkId: "binding-not-os-sandbox",
      document: "server",
      pattern: /Repository binding is not an OS sandbox/,
    },
    {
      checkId: "rollback-procedure",
      document: "root",
      pattern:
        /To roll back a package version, install the desired\s+version and run that version's `amanuensis upgrade`/,
    },
    {
      checkId: "source-packed-parity",
      document: "server",
      pattern:
        /pre-publication parity gate compares this source checkout with a clean\s+installation of its exact packed tarball/,
    },
    {
      checkId: "publication-held-separate",
      document: "server",
      pattern: /presence does not claim that the current source has been published/,
    },
    {
      checkId: "trust-prerequisite",
      document: "adr",
      pattern: /trusted Git\s+repository/,
    },
  ].map(({ checkId, document, pattern }) => {
    assert(pattern.test(documents[document].text), `documentation read-back failed: ${checkId}`);
    return { checkId, document: documents[document].path, status: "passed" };
  });
  return {
    status: "passed",
    checkCount: checks.length,
    passedCheckCount: checks.length,
    documents: Object.values(documents).map(({ path }) => fileReference(path)),
    checks,
  };
}

const { output } = parseArgs(process.argv.slice(2));
assert(isWithin(root, output), "A26 replay output must remain inside the repository");

const commands = [];
commands.push(
  execute("package-artifact", "mise exec -- node mcp-server/test-package-artifact.mjs", [
    resolve(root, "mcp-server/test-package-artifact.mjs"),
  ]),
);
const parityExecution = execute(
  "source-packed-parity",
  "mise exec -- node mcp-server/test-package-activation-parity.mjs --json",
  [resolve(root, "mcp-server/test-package-activation-parity.mjs"), "--json"],
);
commands.push(parityExecution);
const parityReceipt = JSON.parse(parityExecution.stdout);
assert.equal(parityReceipt.result, "passed", "source/packed parity receipt is not passed");

commands.push(
  execute("first-use-interruption", "mise exec -- node mcp-server/test-first-use-recovery.mjs", [
    resolve(root, "mcp-server/test-first-use-recovery.mjs"),
  ]),
);
const rollbackExecution = execute(
  "rollback-rehearsal",
  "mise exec -- node mcp-server/test-release-rollback.mjs --json",
  [resolve(root, "mcp-server/test-release-rollback.mjs"), "--json"],
);
commands.push(rollbackExecution);
const rollbackReceipt = JSON.parse(rollbackExecution.stdout);
assert.equal(rollbackReceipt.result, "passed", "rollback rehearsal receipt is not passed");

commands.push(
  execute(
    "real-host-envelope-check",
    "mise exec -- node dev/check-activation-operating-envelope.mjs --receipt dev/activation-evidence/a25-activation-operating-envelope.json",
    [
      resolve(root, "dev/check-activation-operating-envelope.mjs"),
      "--receipt",
      resolve(root, "dev/activation-evidence/a25-activation-operating-envelope.json"),
    ],
  ),
);

const a25Path = "dev/activation-evidence/a25-activation-operating-envelope.json";
const a25 = JSON.parse(readFileSync(resolve(root, a25Path), "utf8"));
assert.equal(a25.result, "passed", "A25 real-host evidence is not passed");
assert.equal(a25.evidenceMode, "real-host", "A25 evidence is not real-host");
assert.equal(a25.runMatrix.logicalRepositoryCount, 5, "A25 logical repository denominator drifted");
assert.equal(a25.runMatrix.workspaceCount, 6, "A25 workspace denominator drifted");
assert.equal(a25.runs.length, 6, "A25 run denominator drifted");
assert(
  a25.runs.every((run) => run.status === "passed"),
  "A25 contains a failed run",
);

const documentationReadBack = documentReadBack();
const packageJson = JSON.parse(readFileSync(resolve(root, "mcp-server/package.json"), "utf8"));
const gitHead = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
assert.equal(gitHead.status, 0, gitHead.stderr);

const receipt = {
  schemaVersion: 1,
  contractVersion: "amanuensis-friction-free-clean-replay/v1",
  initiative: "A26",
  recordedAt: new Date().toISOString(),
  result: "passed",
  source: {
    repositoryRoot: realpathSync(root),
    baselineCommit: gitHead.stdout.trim(),
    packageVersion: packageJson.version,
    packageJson: fileReference("mcp-server/package.json"),
    practiceCatalog: { version: "2.10", stamp: "f9a5c0c9dbde" },
  },
  toolchain: {
    nodeVersion: process.version,
    pinnedInvocation: "mise exec --",
  },
  isolation: {
    temporaryPackagePrefixes: true,
    temporaryCodexHomes: true,
    temporaryRepositories: true,
    liveUserConfigurationRead: false,
    liveUserConfigurationWritten: false,
    publicationAttempted: false,
  },
  commands,
  cleanReplay: {
    status: "passed",
    sourceCheckout: "passed",
    packedPackage: "passed",
    configurationMigration: "passed",
    interruption: "passed",
    upgrade: "passed",
    rollback: "passed",
    uninstall: "passed",
    documentationReadBack: "passed",
  },
  parity: {
    fixtureId: parityReceipt.fixtureId,
    result: parityReceipt.result,
    sourceRepositoryCount: parityReceipt.source.repositories.length,
    packedRepositoryCount: parityReceipt.packed.repositories.length,
    parityFieldCount: parityReceipt.parityPaths.length,
    matchingParityFieldCount: parityReceipt.parityPaths.length,
    source: parityReceipt.source,
    packed: parityReceipt.packed,
  },
  rollbackRehearsal: rollbackReceipt,
  realHostEvidence: {
    ...fileReference(a25Path),
    campaignId: a25.campaignId,
    surface: a25.host.surface,
    logicalRepositoryCount: a25.runMatrix.logicalRepositoryCount,
    workspaceCount: a25.runMatrix.workspaceCount,
    independentRunCount: a25.runs.length,
    concurrentRunCount: a25.runs.filter((run) => run.concurrentWave !== null).length,
    failedRunCount: a25.runs.filter((run) => run.status !== "passed").length,
    aggregation: "none",
  },
  documentationReadBack,
  unsupportedStrata: [
    "Codex desktop UI",
    "non-Codex MCP clients",
    "Windows",
    "published npm registry installation for this source commit",
  ],
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(
  `A26 clean replay passed: source + packed, ${receipt.realHostEvidence.logicalRepositoryCount} real-host repositories, rollback + uninstall; wrote ${relative(root, output)}`,
);
