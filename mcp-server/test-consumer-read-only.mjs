#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Database from "better-sqlite3";
import { openDatabase, openExistingReadOnlyDatabase } from "./dist/db.js";
import { ensureProjectStorage, resolveProject } from "./dist/project.js";

const root = mkdtempSync(join(tmpdir(), "amanuensis-consumer-"));
const server = fileURLToPath(new URL("./dist/index.js", import.meta.url));
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

async function connect() {
  const client = new Client({ name: "consumer-test", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [server, "--consumer-read-only"],
      cwd: root,
      env: { ...process.env, AMANUENSIS_CALL_LOG: "on", AMANUENSIS_CODE_INDEX: "on" },
      stderr: "pipe",
    }),
  );
  return client;
}

try {
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  writeFileSync(join(root, "README.md"), "# Fixture\n");
  assert.equal(spawnSync("git", ["add", "README.md"], { cwd: root }).status, 0);
  assert.equal(
    spawnSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-q",
        "--no-verify",
        "-m",
        "fixture",
      ],
      { cwd: root },
    ).status,
    0,
  );
  const other = join(root, "other");
  mkdirSync(other);
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: other }).status, 0);
  const project = resolveProject(root);
  let client = await connect();
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.deepEqual(names.sort(), ["describe_locus", "get_project_info", "search_records"]);
    const missing = await client.callTool({
      name: "describe_locus",
      arguments: { locus: "README.md" },
    });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /no existing Amanuensis store/);
    const denied = await client.callTool({ name: "start_session", arguments: {} });
    assert.equal(denied.isError, true);
    assert.equal(existsSync(project.storagePath), false);
  } finally {
    await client.close();
  }

  ensureProjectStorage(project, (path) => openDatabase(path).close());
  const before = digest(project.dbPath);
  const readOnly = openExistingReadOnlyDatabase(project.dbPath);
  assert.throws(() => readOnly.exec("DELETE FROM entries"), /readonly/i);
  readOnly.close();
  client = await connect();
  try {
    const info = await client.callTool({
      name: "get_project_info",
      arguments: { workspace: root },
    });
    assert.equal(info.isError, undefined);
    assert.equal(info.structuredContent.workspace_path, project.workspacePath);
    const mismatch = await client.callTool({
      name: "get_project_info",
      arguments: { workspace: other },
    });
    assert.equal(mismatch.isError, true);
    assert.match(mismatch.content[0].text, /workspace mismatch/);
    assert.equal(existsSync(join(other, ".amanuensis")), false);
    const locus = await client.callTool({
      name: "describe_locus",
      arguments: { locus: "README.md" },
    });
    assert.equal(locus.isError, undefined);
    const search = await client.callTool({
      name: "search_records",
      arguments: { query: "fixture" },
    });
    assert.equal(search.isError, undefined);
    const denied = await client.callTool({ name: "start_session", arguments: {} });
    assert.equal(denied.isError, true);
  } finally {
    await client.close();
  }
  assert.equal(digest(project.dbPath), before);
  assert.equal(existsSync(join(project.storagePath, "call-log")), false);

  const old = join(root, "old.db");
  copyFileSync(project.dbPath, old);
  const oldDb = new Database(old);
  oldDb.exec("ALTER TABLE revalidation_attempts DROP COLUMN consulted_sources");
  oldDb.close();
  const oldBefore = digest(old);
  assert.throws(
    () => openExistingReadOnlyDatabase(old),
    /read-only store is incompatible.*consulted_sources/,
  );
  assert.equal(digest(old), oldBefore);
  const absent = join(root, "absent.db");
  assert.throws(() => openExistingReadOnlyDatabase(absent));
  assert.equal(existsSync(absent), false);
  // The server itself must open the store read-only: an older schema is refused
  // through MCP and left as it was, never migrated.
  const live = new Database(project.dbPath);
  live.exec("ALTER TABLE revalidation_attempts DROP COLUMN consulted_sources");
  live.pragma("wal_checkpoint(TRUNCATE)");
  live.close();
  const liveBefore = digest(project.dbPath);
  client = await connect();
  try {
    const refused = await client.callTool({
      name: "describe_locus",
      arguments: { locus: "README.md" },
    });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /read-only store is incompatible.*consulted_sources/);
  } finally {
    await client.close();
  }
  assert.equal(digest(project.dbPath), liveBefore);
  const wal = `${project.dbPath}-wal`;
  assert.ok(!existsSync(wal) || readFileSync(wal).length === 0, "the consumer wrote to the WAL");

  // A flag in the workspace value's place is a missing value, not a mode.
  const misplaced = spawnSync(process.execPath, [server, "--workspace", "--consumer-read-only"], {
    cwd: root,
    input: "",
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.notEqual(misplaced.status, 0);
  assert.match(misplaced.stderr, /--workspace needs a directory/);
  console.log("Consumer read-only checks passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
