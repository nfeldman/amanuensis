#!/usr/bin/env node
// Protocol-level compatibility probe. This exercises the actual stdio surface
// rather than importing handlers directly, so it catches regressions in the
// initialization contract, tool annotations, structured results, and errors.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = mkdtempSync(join(tmpdir(), "amanuensis-mcp-compat-"));
const workspace = join(root, "workspace");
const storage = join(root, "storage");
mkdirSync(workspace, { recursive: true });
mkdirSync(storage, { recursive: true });
const serverEntry = process.env.AMANUENSIS_SERVER_ENTRY ?? "dist/index.js";
const serverCommand = process.env.AMANUENSIS_SERVER_COMMAND ?? process.execPath;
const serverArgs = process.env.AMANUENSIS_SERVER_COMMAND
  ? ["--workspace", workspace, "--allow-workspace-pin"]
  : [serverEntry, "--workspace", workspace, "--allow-workspace-pin"];
const server = spawn(serverCommand, serverArgs, {
  env: { ...process.env, AMANUENSIS_STORAGE_ROOT: storage, AMANUENSIS_AUTOPROGRESS: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});

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

function request(method, params = {}) {
  const id = nextId++;
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timed out waiting for ${method}; stderr=${stderr}`));
    }, 20_000);
    pending.set(id, {
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

function notify(method, params = {}) {
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

try {
  const initialized = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "amanuensis-compatibility-test", version: "1" },
  });
  assert(
    initialized.instructions?.includes("evidence-backed codebase conspectus"),
    "initialization instructions missing or uninformative",
  );
  notify("notifications/initialized");

  const listed = await request("tools/list");
  assert(listed.tools.length > 100, `unexpectedly small tool surface: ${listed.tools.length}`);
  for (const tool of listed.tools) {
    assert(tool.annotations, `${tool.name}: annotations missing`);
    for (const field of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      assert(typeof tool.annotations[field] === "boolean", `${tool.name}: ${field} is not boolean`);
    }
  }
  const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
  assert(byName.get("get_project_info")?.annotations.readOnlyHint === true, "query not read-only");
  assert(byName.get("add_claim")?.annotations.readOnlyHint === false, "mutation marked read-only");
  assert(
    byName.get("add_claim")?.annotations.destructiveHint === false,
    "append-only claim creation marked destructive",
  );
  assert(
    byName.get("record_open_question")?.annotations.destructiveHint === false,
    "append-only question recording marked destructive",
  );
  assert(
    byName.get("rebaseline_operating_envelope")?.annotations.destructiveHint === false,
    "immutable successor creation marked destructive",
  );
  assert(
    byName.get("update_subsystem_status")?.annotations.destructiveHint === true,
    "durable update is not conservatively annotated",
  );
  assert(
    byName.get("cancel_refresh_run")?.annotations.destructiveHint === true,
    "state-changing cancellation is not conservatively annotated",
  );
  assert(
    byName.get("reset_subsystem")?.annotations.destructiveHint === true,
    "destructive reset is not annotated",
  );

  const success = await request("tools/call", { name: "get_project_info", arguments: {} });
  assert(success.structuredContent?.project_key, "success lacks structuredContent");
  assert(success.isError !== true, "successful call marked as error");
  const serialized = JSON.parse(success.content[0].text);
  assert(
    serialized.project_key === success.structuredContent.project_key,
    "text and structured result disagree",
  );

  const failure = await request("tools/call", { name: "__missing_tool__", arguments: {} });
  assert(failure.isError === true, "tool failure lacks protocol-level isError");
  assert(failure.structuredContent?.ok === false, "tool failure lacks structured error body");

  const invalid = await request("tools/call", {
    name: "get_project_info",
    arguments: { unexpected: true },
  });
  assert(invalid.isError === true, "schema-invalid call was not rejected");
  assert(
    invalid.structuredContent?.error?.includes("invalid arguments for get_project_info"),
    "schema-invalid call lacks an actionable diagnostic",
  );

  console.log(`OK — ${listed.tools.length} tools expose portable MCP metadata and results.`);
} finally {
  server.kill("SIGTERM");
  rmSync(root, { recursive: true, force: true });
}
