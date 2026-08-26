#!/usr/bin/env node
// A23 process-level red gate: merely starting and negotiating with the real
// stdio server must not create repository state. The first stateful tool call
// owns initialization; get_project_info is deliberately state-independent.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(moduleDir, "fixtures/activation/first-use-interruption.json"), "utf8"),
);

function initRepository(path) {
  mkdirSync(path, { recursive: true });
  const initialized = spawnSync("git", ["init", "--quiet", "--initial-branch=main"], {
    cwd: path,
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  writeFileSync(join(path, "README.md"), "# lazy first use\n");
}

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

function launchServer(cwd) {
  const state = { buffer: "", stderr: "", nextId: 1, pending: new Map() };
  const server = spawn(process.execPath, [join(moduleDir, "dist/index.js")], {
    cwd,
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
  return { server, state };
}

const root = mkdtempSync(join(tmpdir(), "amanuensis-a23-lazy-"));
const repository = join(root, "repository");
initRepository(repository);
const store = join(repository, ".amanuensis");
const { server, state } = launchServer(repository);

try {
  await request(server, state, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "amanuensis-a23-lazy", version: "1" },
  });
  server.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
  );
  await request(server, state, "tools/list");
  assert.equal(
    existsSync(store),
    false,
    `${fixture.fixtureId}: server startup or tools/list created ${store} before first use`,
  );
  const info = await request(server, state, "tools/call", {
    name: "get_project_info",
    arguments: {},
  });
  assert.equal(
    info.structuredContent?.db_exists,
    false,
    "fresh project reported an initialized DB",
  );
  assert.equal(existsSync(store), false, `${fixture.fixtureId}: get_project_info created ${store}`);

  const firstStateful = await request(server, state, "tools/call", {
    name: "get_session",
    arguments: {},
  });
  assert.equal(
    firstStateful.structuredContent?.session_id,
    null,
    "first stateful query returned an unexpected session",
  );
  assert(existsSync(join(store, "memory.db")), "first stateful call did not create the database");
  const canonicalRoot = realpathSync(repository);
  assert.equal(
    readFileSync(join(store, "project_identity"), "utf8"),
    `local:${canonicalRoot}`,
    "first-use store is not bound to the repository identity",
  );
  const marker = JSON.parse(readFileSync(join(store, "initialization.json"), "utf8"));
  assert.equal(marker.canonicalRoot, canonicalRoot, "completion marker root drifted");
  assert.equal(
    marker.projectIdentity,
    `local:${canonicalRoot}`,
    "completion marker identity drifted",
  );
  assert.deepEqual(
    readdirSync(repository)
      .filter((entry) => entry.startsWith(".amanuensis"))
      .sort(),
    [".amanuensis"],
    "first use left more than one store or an initialization stage",
  );
  console.log("A23 lazy first-use gate passed: startup and binding inspection wrote no state");
} finally {
  server.kill("SIGTERM");
  rmSync(root, { recursive: true, force: true });
}
