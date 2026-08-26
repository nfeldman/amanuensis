#!/usr/bin/env node
// Current-candidate A19–A26 activation suite. Each command remains a separate
// result with its own exit status and output digests; a failure halts the run
// and cannot be pooled away by later successes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = resolve(root, "dev/activation-evidence/a26-candidate-suite.json");

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
  assert(isWithin(root, absolute), `candidate file escapes repository: ${path}`);
  assert(existsSync(absolute), `candidate file is missing: ${path}`);
  return { path: relative(root, absolute), sha256: sha256(readFileSync(absolute)) };
}

function execute({ id, command, args, cwd = root }) {
  const startedAt = new Date().toISOString();
  const started = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const observation = {
    id,
    command: `${command} ${args.join(" ")}`,
    exitCode: result.status,
    startedAt,
    durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1_000_000),
    stdoutSha256: sha256(result.stdout ?? ""),
    stderrSha256: sha256(result.stderr ?? ""),
    summary: (result.stdout ?? "").trim().split("\n").at(-1) ?? "",
  };
  assert.equal(
    result.status,
    0,
    `${observation.command} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
  );
  return observation;
}

const node = process.execPath;
const mcp = resolve(root, "mcp-server");
const receipt = (path) => resolve(root, path);
const specifications = [
  {
    id: "build",
    command: "npm",
    args: ["run", "build"],
    cwd: mcp,
  },
  { id: "installer", command: node, args: [resolve(mcp, "test-installer.mjs")] },
  {
    id: "activation-contract",
    command: node,
    args: [resolve(mcp, "test-activation-contract.mjs")],
  },
  { id: "activation-doctor", command: node, args: [resolve(mcp, "test-activation-doctor.mjs")] },
  { id: "workspace-binding", command: node, args: [resolve(mcp, "test-workspace-binding.mjs")] },
  {
    id: "codex-parent-workspace",
    command: node,
    args: [resolve(mcp, "test-codex-parent-workspace.mjs")],
  },
  {
    id: "nested-activation-binding",
    command: node,
    args: [resolve(mcp, "test-nested-activation-binding.mjs")],
  },
  { id: "first-use-laziness", command: node, args: [resolve(mcp, "test-first-use-laziness.mjs")] },
  { id: "first-use-recovery", command: node, args: [resolve(mcp, "test-first-use-recovery.mjs")] },
  {
    id: "a22-real-host-evidence",
    command: node,
    args: [
      resolve(root, "dev/check-codex-host-evidence.mjs"),
      "--receipt",
      receipt("dev/activation-evidence/a22-codex-host.json"),
    ],
  },
  {
    id: "a22-red-gates",
    command: node,
    args: [resolve(root, "dev/test-codex-host-evidence-red-gates.mjs")],
  },
  { id: "package-artifact", command: node, args: [resolve(mcp, "test-package-artifact.mjs")] },
  {
    id: "package-activation-parity",
    command: node,
    args: [resolve(mcp, "test-package-activation-parity.mjs")],
  },
  {
    id: "package-parity-red-gates",
    command: node,
    args: [resolve(root, "dev/test-package-activation-parity-red-gates.mjs")],
  },
  {
    id: "a25-real-host-envelope",
    command: node,
    args: [
      resolve(root, "dev/check-activation-operating-envelope.mjs"),
      "--receipt",
      receipt("dev/activation-evidence/a25-activation-operating-envelope.json"),
    ],
  },
  {
    id: "a25-red-gates",
    command: node,
    args: [resolve(root, "dev/test-activation-operating-envelope-red-gates.mjs")],
  },
  {
    id: "a25-trust-cleanup",
    command: node,
    args: [resolve(root, "dev/test-activation-operating-trust-cleanup.mjs")],
  },
  { id: "release-rollback", command: node, args: [resolve(mcp, "test-release-rollback.mjs")] },
  {
    id: "a26-red-gates",
    command: node,
    args: [resolve(root, "dev/test-friction-free-release-readiness-red-gates.mjs")],
  },
];

const { output } = parseArgs(process.argv.slice(2));
assert(isWithin(root, output), "candidate-suite output must remain inside the repository");
const results = specifications.map(execute);
const packageJson = JSON.parse(readFileSync(resolve(mcp, "package.json"), "utf8"));
const gitHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
assert.equal(gitHead.status, 0, gitHead.stderr);

const candidateFiles = [
  "mcp-server/package.json",
  "mcp-server/src/cli.ts",
  "mcp-server/src/index.ts",
  "mcp-server/src/project.ts",
  "mcp-server/test-activation-contract.mjs",
  "mcp-server/test-activation-doctor.mjs",
  "mcp-server/test-workspace-binding.mjs",
  "mcp-server/test-first-use-laziness.mjs",
  "mcp-server/test-first-use-recovery.mjs",
  "mcp-server/test-package-activation-parity.mjs",
  "mcp-server/test-release-rollback.mjs",
  "dev/run-friction-free-release-replay.mjs",
  "dev/check-friction-free-release-readiness.mjs",
  "dev/test-friction-free-release-readiness-red-gates.mjs",
  "mcp-server/fixtures/activation/release-readiness-red-matrix.json",
  "dev/activation-evidence/a26-clean-replay.json",
  "dev/activation-evidence/a26-release-readiness-red-gates.json",
  "README.md",
  "INSTALLATION.md",
  "mcp-server/README.md",
  "dev/adr/0021-friction-free-codex-activation.md",
];

const report = {
  schemaVersion: 1,
  contractVersion: "amanuensis-friction-free-candidate-suite/v1",
  initiative: "A26",
  recordedAt: new Date().toISOString(),
  result: "passed",
  candidate: {
    baselineCommit: gitHead.stdout.trim(),
    packageVersion: packageJson.version,
    publicationAttempted: false,
  },
  toolchain: { nodeVersion: process.version, pinnedInvocation: "mise exec --" },
  commandCount: results.length,
  passedCommandCount: results.filter(({ exitCode }) => exitCode === 0).length,
  aggregation: "none",
  results,
  candidateFileManifest: candidateFiles.map(fileReference),
};
assert.equal(report.passedCommandCount, report.commandCount);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `A26 candidate suite passed: ${report.passedCommandCount}/${report.commandCount} independent commands; wrote ${relative(root, output)}`,
);
