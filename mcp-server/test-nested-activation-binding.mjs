#!/usr/bin/env node
// Deterministic substrate check for the nested-launch stratum exercised by
// A25's real Codex host matrix. The server must bind the Git worktree root,
// remain lazy through discovery, and create state only at that root on first
// database-backed use.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function request(server, state, method, params = {}) {
  const id = state.nextId++;
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error(`timed out waiting for ${method}; stderr=${state.stderr}`));
    }, 10_000);
    state.pending.set(id, {
      resolve(value) {
        clearTimeout(timer);
        resolve(value);
      },
      reject(error) {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return response;
}

async function stop(server) {
  if (server.exitCode !== null) return;
  await new Promise((resolve) => {
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

const scratch = mkdtempSync(join(tmpdir(), "amanuensis-a25-nested-"));
const repository = join(scratch, "repository");
const nested = join(repository, "packages", "service");
mkdirSync(nested, { recursive: true });
assert.equal(
  spawnSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repository }).status,
  0,
);
writeFileSync(join(repository, "README.md"), "# nested activation fixture\n");

const state = { buffer: "", stderr: "", nextId: 1, pending: new Map() };
const server = spawn(process.execPath, [join(moduleDir, "dist", "index.js")], {
  cwd: nested,
  env: { ...process.env, AMANUENSIS_AUTOPROGRESS: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});
server.stderr.on("data", (chunk) => {
  state.stderr += chunk.toString("utf8");
});
server.stdout.on("data", (chunk) => {
  state.buffer += chunk.toString("utf8");
  let newline = state.buffer.indexOf("\n");
  while (newline >= 0) {
    const line = state.buffer.slice(0, newline).trim();
    state.buffer = state.buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      const waiter = state.pending.get(message.id);
      if (waiter) {
        state.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
      }
    }
    newline = state.buffer.indexOf("\n");
  }
});

try {
  await request(server, state, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "amanuensis-a25-nested-binding", version: "1" },
  });
  server.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
  );
  await request(server, state, "tools/list");
  const before = await request(server, state, "tools/call", {
    name: "get_project_info",
    arguments: {},
  });
  const root = realpathSync(repository);
  assert.equal(before.structuredContent?.binding_receipt?.canonicalRoot, root);
  assert.equal(before.structuredContent?.binding_receipt?.selectionSource, "process-cwd-git-root");
  assert.equal(before.structuredContent?.db_exists, false);
  assert(!existsSync(join(repository, ".amanuensis")), "discovery eagerly created root state");
  assert(!existsSync(join(nested, ".amanuensis")), "discovery created nested state");

  await request(server, state, "tools/call", { name: "get_session", arguments: {} });
  assert(existsSync(join(repository, ".amanuensis", "memory.db")), "first use missed root store");
  assert(!existsSync(join(nested, ".amanuensis")), "first use created nested store");
  console.log("A25 nested activation binding passed: Git root selected lazily from nested cwd");
} finally {
  await stop(server);
  rmSync(scratch, { recursive: true, force: true });
}
