#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = "/Users/nfeldman/repos/scholiast";
const outputRoot = join(root, "dev", "activation-evidence", "a22-host-runs");
const execute = process.argv.slice(2).includes("--execute");
for (const argument of process.argv.slice(2)) {
  if (argument !== "--execute") throw new Error(`unknown argument: ${argument}`);
}

if (!execute) {
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        launcherCwd: root,
        target,
        expectedSelectionSource: "parent-codex-cli-cd-git-root",
        userConfigMutation: "forbidden",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const configPath = join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "config.toml");
const configBefore = readFileSync(configPath);
const args = [
  "exec",
  "--ephemeral",
  "--json",
  "--sandbox",
  "read-only",
  "--dangerously-bypass-hook-trust",
  "--cd",
  target,
  "Call the Amanuensis get_project_info MCP tool exactly once. Do not call any other tool. Return only its binding receipt.",
];
const result = await new Promise((resolvePromise, reject) => {
  const child = spawn("codex", args, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.on("error", reject);
  child.on("close", (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
});
if (result.code !== 0) {
  throw new Error(`Codex parent-cd run exited ${result.code ?? result.signal}\n${result.stderr}`);
}
const events = result.stdout
  .split(/\r?\n/)
  .filter((line) => line.trim().startsWith("{"))
  .map((line) => JSON.parse(line));
if (events.some((event) => event.item?.type === "command_execution")) {
  throw new Error("Codex parent-cd run used an undeclared shell tool; refusing to retain its log");
}
const call = events.find(
  (event) =>
    event.type === "item.completed" &&
    event.item?.type === "mcp_tool_call" &&
    event.item?.server === "amanuensis-memory" &&
    event.item?.tool === "get_project_info" &&
    event.item?.status === "completed" &&
    !event.item?.error,
)?.item;
const binding = call?.result?.structured_content?.binding_receipt;
if (!binding) throw new Error("Codex parent-cd run has no completed get_project_info receipt");
const canonicalTarget = realpathSync(target);
if (
  binding.canonicalRoot !== canonicalTarget ||
  binding.storagePath !== join(canonicalTarget, ".amanuensis") ||
  binding.selectionSource !== "parent-codex-cli-cd-git-root"
) {
  throw new Error(`Codex parent-cd binding drifted: ${JSON.stringify(binding)}`);
}
const configAfter = readFileSync(configPath);
if (Buffer.compare(configBefore, configAfter) !== 0) {
  throw new Error("Codex parent-cd evidence changed user configuration bytes");
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stdoutPath = join(outputRoot, "parent-cd-recovery.jsonl");
const stderrPath = join(outputRoot, "parent-cd-recovery.stderr.log");
writeFileSync(stdoutPath, result.stdout, "utf8");
writeFileSync(stderrPath, result.stderr, "utf8");
const evidence = {
  schemaVersion: 1,
  runId: "parent-cd-recovery",
  status: "passed",
  launcherCwd: root,
  requestedTarget: canonicalTarget,
  bindingReceipt: binding,
  rawEventLog: { path: relative(root, stdoutPath), sha256: sha256(result.stdout) },
  stderrLog: { path: relative(root, stderrPath), sha256: sha256(result.stderr) },
  configSha256Before: sha256(configBefore),
  configSha256After: sha256(configAfter),
  configBytesChanged: 0,
  codexVersion: spawnSync("codex", ["--version"], { encoding: "utf8" }).stdout.trim(),
};
writeFileSync(
  join(outputRoot, "parent-cd-recovery.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
  "utf8",
);
console.log(
  `Codex parent --cd recovery passed: ${binding.canonicalRoot} (${binding.selectionSource})`,
);
