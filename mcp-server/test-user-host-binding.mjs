#!/usr/bin/env node
// The user-level registration `amanuensis install` writes for Claude Code and
// Copilot (AMANUENSIS_ACTIVATION_CONTRACT=user-cwd-v1) serves every session on
// the machine. Claude Code starts it with CLAUDE_PROJECT_DIR set to the
// directory the session began in, which may be a subdirectory; Copilot may
// start it anywhere, including the home directory. The server must bind the
// repository root in the first case and claim nothing outside a repository.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const SERVER = join(moduleDir, "dist", "index.js");

function baseEnv() {
  const env = { ...process.env, AMANUENSIS_AUTOPROGRESS: "1" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("AMANUENSIS_") && key !== "AMANUENSIS_AUTOPROGRESS") delete env[key];
  }
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

async function projectInfo(cwd, env) {
  const server = spawn(process.execPath, [SERVER], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  server.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
          else waiter.resolve(message.result);
        }
      }
      newline = buffer.indexOf("\n");
    }
  });
  const request = (method, params = {}) => {
    const id = nextId++;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timed out waiting for ${method}; stderr=${stderr}`));
      }, 10_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return response;
  };
  try {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "amanuensis-user-host-binding", version: "1" },
    });
    server.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
    );
    const result = await request("tools/call", { name: "get_project_info", arguments: {} });
    return result.structuredContent ?? {};
  } finally {
    await new Promise((resolve) => {
      if (server.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        server.kill("SIGKILL");
        resolve();
      }, 3_000);
      server.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      server.kill("SIGTERM");
    });
  }
}

const scratch = mkdtempSync(join(tmpdir(), "amanuensis-user-host-"));
const repository = join(scratch, "repository");
const nested = join(repository, "packages", "service");
const outside = join(scratch, "home");
mkdirSync(nested, { recursive: true });
mkdirSync(outside, { recursive: true });
assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: repository }).status, 0);
let failed = 0;

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${label}\n       ${error.message}`);
  }
}

try {
  await check("a Claude session started in a subdirectory binds the repository root", async () => {
    const env = { ...baseEnv(), AMANUENSIS_ACTIVATION_CONTRACT: "user-cwd-v1" };
    env.CLAUDE_PROJECT_DIR = nested;
    const info = await projectInfo(nested, env);
    assert.equal(info.binding_receipt?.canonicalRoot, realpathSync(repository));
    assert.equal(info.binding_receipt?.selectionSource, "environment:CLAUDE_PROJECT_DIR-git-root");
    assert(!existsSync(join(nested, ".amanuensis")), "discovery created a nested store");
  });

  await check("a Claude session outside any repository stays unbound", async () => {
    const env = { ...baseEnv(), AMANUENSIS_ACTIVATION_CONTRACT: "user-cwd-v1" };
    env.CLAUDE_PROJECT_DIR = outside;
    const info = await projectInfo(outside, env);
    assert.equal(info.binding_status, "unbound", JSON.stringify(info));
    assert(!existsSync(join(outside, ".amanuensis")), "an unbound server created state");
  });

  await check("a Copilot launch from a non-Git directory stays unbound", async () => {
    const env = { ...baseEnv(), AMANUENSIS_ACTIVATION_CONTRACT: "user-cwd-v1" };
    const info = await projectInfo(outside, env);
    assert.equal(info.binding_status, "unbound", JSON.stringify(info));
    assert(!existsSync(join(outside, ".amanuensis")), "an unbound server created state");
  });

  await check("a Copilot launch inside a repository binds its root", async () => {
    const env = { ...baseEnv(), AMANUENSIS_ACTIVATION_CONTRACT: "user-cwd-v1" };
    const info = await projectInfo(nested, env);
    assert.equal(info.binding_receipt?.canonicalRoot, realpathSync(repository));
    assert.equal(info.binding_receipt?.selectionSource, "process-cwd-git-root");
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failed) {
  console.log(`\n${failed} user-host binding check(s) failed`);
  process.exit(1);
}
console.log("\nUser-host binding passed: repository roots bound, nothing claimed outside a repository");
