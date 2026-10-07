#!/usr/bin/env node
// Reproduce the desktop launch boundary: global registration, cwd=/, no --cd
// parent, and no MCP roots capability. Exercise the public stdio dispatcher.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveProject } from "./dist/project.js";

const scratch = mkdtempSync(join(tmpdir(), "amanuensis-codex-app-"));
const entry =
  process.env.AMANUENSIS_SERVER_ENTRY ?? fileURLToPath(new URL("dist/index.js", import.meta.url));
const clients = [];
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) =>
      typeof value === "string" && !key.startsWith("AMANUENSIS_") && key !== "CLAUDE_PROJECT_DIR",
  ),
);
env.AMANUENSIS_ACTIVATION_CONTRACT = "codex-user-cwd-v1";
env.AMANUENSIS_AUTOPROGRESS = "1";

async function launch(cwd = "/", args = [], envOverride = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, ...args],
    cwd,
    env: { ...env, ...envOverride },
    stderr: "pipe",
  });
  transport.stderr?.on("data", () => {});
  const client = new Client(
    { name: "codex-app-workspace-regression", version: "1" },
    { capabilities: {} },
  );
  clients.push(client);
  await client.connect(transport);
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

function noStores(...roots) {
  for (const root of roots)
    assert(!existsSync(join(root, ".amanuensis")), `unexpected state at ${root}`);
}

try {
  const a = join(scratch, "repository a");
  const b = join(scratch, "repository-b");
  const nested = join(a, "src");
  mkdirSync(nested, { recursive: true });
  mkdirSync(b);
  for (const root of [a, b]) {
    execFileSync("git", ["init", "-q"], { cwd: root });
    // Same logical repository identity still requires separate physical bindings.
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/fixture.git"], {
      cwd: root,
    });
  }
  const canonicalA = realpathSync(a);
  const canonicalB = realpathSync(b);
  const first = await launch();
  const listed = await first.listTools();
  const unbound = await call(first, "get_project_info");
  assert.equal(unbound.binding_status, "unbound", "desktop cwd=/ was treated as a project");
  assert.equal(unbound.workspace_path, null);
  assert.equal(unbound.storage_path, null);
  assert(!Object.hasOwn(unbound, "db_exists"), "unbound was advertised as a cold start");
  assert.equal(unbound.binding_receipt, null);
  assert(listed.tools.find((t) => t.name === "get_project_info").inputSchema.properties.workspace);
  console.log("PASS root launch stays reachable and unbound through discovery");

  for (const name of ["get_dashboard", "start_session", "describe_locus"]) {
    const args =
      name === "start_session"
        ? { intent: "must not initialize" }
        : name === "describe_locus"
          ? { locus: "README.md" }
          : {};
    const refused = await call(first, name, args);
    assert.equal(refused.ok, false);
    assert.match(refused.error, /workspace is unbound/);
  }
  noStores(a, b, nested);
  console.log("PASS reader and writer tools refuse unbound state");

  for (const workspace of [".", "", "/", join(scratch, "missing")]) {
    assert.equal((await call(first, "get_project_info", { workspace })).ok, false);
    assert.equal((await call(first, "get_project_info")).binding_status, "unbound");
  }
  assert.throws(() => resolveProject("/"), /filesystem root is not a project workspace/);
  const rootPin = spawnSync(
    process.execPath,
    [entry, "--workspace", "/", "--allow-workspace-pin"],
    {
      env,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.equal(rootPin.status, 1);
  assert.match(rootPin.stderr, /filesystem root is not a project workspace/);
  console.log("PASS invalid handshakes and filesystem root cannot select storage");

  const info = await call(first, "get_project_info", { workspace: nested });
  assert.equal(info.workspace_path, canonicalA);
  assert.equal(info.storage_path, join(canonicalA, ".amanuensis"));
  assert.equal(info.binding_receipt.selectionSource, "tool-workspace-handshake");
  assert.equal(info.db_exists, false);
  const bindingId = info.binding_receipt.bindingId;
  noStores(a, b, nested);
  assert.equal(
    (await call(first, "get_project_info", { workspace: a })).binding_receipt.bindingId,
    bindingId,
  );
  console.log("PASS chat workspace normalizes to Git root and binds once without creating state");

  const second = await launch();
  const infoB = await call(second, "get_project_info", { workspace: b });
  assert.equal(infoB.workspace_path, canonicalB);
  assert.equal(infoB.project_key, info.project_key);
  assert.notEqual(
    infoB.binding_receipt.workspaceInstanceId,
    info.binding_receipt.workspaceInstanceId,
  );
  const mismatch = await call(first, "get_project_info", { workspace: b });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error, /workspace mismatch/);
  noStores(a, b, nested);
  console.log("PASS simultaneous chats stay isolated even for clones of the same repository");

  const sessionA = await call(first, "start_session", { intent: "chat A" });
  const sessionB = await call(second, "start_session", { intent: "chat B" });
  assert(sessionA.session_id);
  assert(sessionB.session_id);
  assert.equal((await call(first, "get_session")).intent, "chat A");
  assert.equal((await call(second, "get_session")).intent, "chat B");
  assert.equal((await call(first, "get_project_info", { workspace: b })).ok, false);
  assert.equal((await call(first, "get_session")).session_id, sessionA.session_id);
  assert(existsSync(join(a, ".amanuensis", "memory.db")));
  assert(existsSync(join(b, ".amanuensis", "memory.db")));
  noStores(nested);
  console.log(
    "PASS first stateful use writes only to each chat's project; rebinding leaves its session intact",
  );

  const restarted = await launch();
  assert.equal((await call(restarted, "get_project_info")).binding_status, "unbound");
  assert.equal((await call(restarted, "get_project_info", { workspace: a })).db_exists, true);
  assert.equal((await call(restarted, "get_session")).intent, "chat A");
  console.log(
    "PASS a fresh app connection recovers the existing project store through the handshake",
  );

  const pinned = await launch("/", ["--workspace", b, "--allow-workspace-pin"]);
  assert.equal((await call(pinned, "get_project_info", { workspace: a })).ok, false);
  assert.equal(
    (await call(pinned, "get_project_info", { workspace: b })).workspace_path,
    canonicalB,
  );
  console.log("PASS the handshake verifies explicit registrations instead of overriding them");

  const fakeBin = join(scratch, "bin");
  mkdirSync(fakeBin);
  const ps = join(fakeBin, "ps");
  writeFileSync(
    ps,
    "#!/bin/sh\nprintf '%s\\n' 'codex -c features.code_mode_host=true app-server --analytics-default-enabled'\n",
  );
  chmodSync(ps, 0o755);
  const desktopFromGit = await launch(a, [], { PATH: `${fakeBin}:${env.PATH}` });
  assert.equal((await call(desktopFromGit, "get_project_info")).binding_status, "unbound");
  assert.equal(
    (await call(desktopFromGit, "get_project_info", { workspace: b })).workspace_path,
    canonicalB,
  );
  assert.equal((await call(desktopFromGit, "get_session")).intent, "chat B");
  console.log(
    "PASS desktop app-server ignores an incidental Git cwd and selects the chat's workspace",
  );

  writeFileSync(ps, `#!/bin/sh\nprintf '%s\\n' 'codex exec --cd ${b} prompt'\n`);
  const cliFromGit = await launch(a, [], { PATH: `${fakeBin}:${env.PATH}` });
  const cliInfo = await call(cliFromGit, "get_project_info", { workspace: b });
  assert.equal(cliInfo.workspace_path, canonicalB);
  assert.equal(cliInfo.binding_receipt.selectionSource, "parent-codex-cli-cd-git-root");
  console.log("PASS CLI --cd still selects its task workspace independently of launch cwd");
} finally {
  await Promise.allSettled(clients.map((client) => client.close()));
  rmSync(scratch, { recursive: true, force: true });
}
