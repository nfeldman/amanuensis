#!/usr/bin/env node
// A19 executable contract: reproduce the observed stale user registration by
// starting the real stdio server in repository B with `--workspace A`.
// Success requires a process-level halt before MCP initialization and before
// either repository receives Amanuensis state.
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(moduleDir, "fixtures/activation/hard-coded-global-project-local.json"), "utf8"),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function initRepository(path) {
  mkdirSync(path, { recursive: true });
  const initialized = spawnSync("git", ["init", "--quiet", "--initial-branch=main"], {
    cwd: path,
    encoding: "utf8",
  });
  assert(initialized.status === 0, initialized.stderr || `could not initialize ${path}`);
  writeFileSync(join(path, "README.md"), `# ${path.split("/").at(-1)}\n`);
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

function launchServer(command, args, cwd, env = {}) {
  const state = { buffer: "", stderr: "", nextId: 1, pending: new Map(), exit: null };
  const server = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
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
  server.on("exit", (code, signal) => {
    state.exit = { code, signal };
    for (const waiter of state.pending.values()) {
      waiter.reject(new Error(`server exited ${code ?? signal}; stderr=${state.stderr}`));
    }
    state.pending.clear();
  });
  return { server, state };
}

const root = mkdtempSync(join(tmpdir(), "amanuensis-a19-red-"));
const repositoryA = join(root, "repository-a");
const repositoryB = join(root, "repository-b");
initRepository(repositoryA);
initRepository(repositoryB);

const serverEntry = join(moduleDir, "dist/index.js");
const args = fixture.effectiveRegistration.args.map((value) =>
  value.replace("__SERVER__", serverEntry).replace("__REPOSITORY_A__", repositoryA),
);
const redLaunch = launchServer(process.execPath, args, repositoryB, {
  AMANUENSIS_AUTOPROGRESS: "1",
});
const { server, state } = redLaunch;

let initialized = false;
try {
  try {
    await request(server, state, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "amanuensis-a19-red-gate", version: "1" },
    });
    initialized = true;
  } catch {
    // The desired red-gate behavior is a process-level startup rejection.
  }

  assert(!initialized, "wrong-workspace server initialized successfully for repository A");
  assert(state.exit?.code !== 0, "wrong-workspace launch did not exit non-zero");
  assert(
    state.stderr.includes("workspace mismatch"),
    `wrong-workspace halt was not actionable: ${state.stderr}`,
  );
  assert(!existsSync(join(repositoryA, ".amanuensis")), "wrong-workspace launch wrote under A");
  assert(!existsSync(join(repositoryB, ".amanuensis")), "wrong-workspace launch wrote under B");
  console.log(`A19 red gate verified: ${fixture.fixtureId} halted before state for ${repositoryB}`);

  const codexHome = join(root, "codex-home");
  mkdirSync(codexHome, { recursive: true });
  const installed = spawnSync(
    process.execPath,
    [
      join(moduleDir, "dist/cli.js"),
      "init",
      "--client",
      "codex",
      "--scope",
      "user",
      "--dir",
      repositoryB,
    ],
    {
      cwd: repositoryB,
      env: { ...process.env, CODEX_HOME: codexHome },
      encoding: "utf8",
    },
  );
  assert(installed.status === 0, installed.stderr);
  assert(!existsSync(join(repositoryB, ".codex")), "user install wrote project Codex config");
  assert(!existsSync(join(repositoryB, ".agents")), "user install copied a project skill");
  assert(!existsSync(join(repositoryB, ".amanuensis")), "user install created survey state");

  const rawConfig = readFileSync(join(codexHome, "config.toml"), "utf8");
  const entry = parseToml(rawConfig).mcp_servers?.["amanuensis-memory"];
  assert(entry?.cwd === ".", "user registration does not launch cwd-relative");
  assert(!rawConfig.includes(repositoryB), "user registration hard-coded repository B");
  assert(!entry?.args?.includes("--workspace"), "user registration retained --workspace");

  const greenLaunch = launchServer(entry.command, entry.args ?? [], repositoryB, entry.env ?? {});
  try {
    await request(greenLaunch.server, greenLaunch.state, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "amanuensis-a19-green", version: "1" },
    });
    greenLaunch.server.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
    );
    const info = await request(greenLaunch.server, greenLaunch.state, "tools/call", {
      name: "get_project_info",
      arguments: {},
    });
    const canonicalRepositoryB = realpathSync(repositoryB);
    assert(
      info.structuredContent?.workspace_path === canonicalRepositoryB,
      `cwd-relative launch bound ${info.structuredContent?.workspace_path}, expected ${canonicalRepositoryB}`,
    );
    assert(
      info.structuredContent?.storage_path === join(canonicalRepositoryB, ".amanuensis"),
      "cwd-relative launch selected the wrong storage path",
    );
    const receipt = info.structuredContent?.binding_receipt;
    assert(receipt?.canonicalRoot === canonicalRepositoryB, "binding receipt root drifted");
    assert(
      receipt?.storagePath === join(canonicalRepositoryB, ".amanuensis"),
      "binding receipt storage drifted",
    );
    assert(receipt?.selectionSource === "process-cwd-git-root", "binding selection source drifted");
    assert(receipt?.storagePolicy === "worktree-local", "binding storage policy drifted");
    assert(/^[a-f0-9]{64}$/.test(receipt?.bindingId ?? ""), "binding receipt ID is malformed");
    assert(!existsSync(join(repositoryA, ".amanuensis")), "green launch wrote under repository A");
    console.log(
      `A19 user activation verified: ${info.structuredContent.project_key} -> ${info.structuredContent.workspace_path}`,
    );
  } finally {
    greenLaunch.server.kill("SIGTERM");
  }
} finally {
  server.kill("SIGTERM");
  rmSync(root, { recursive: true, force: true });
}
