#!/usr/bin/env node
// GATE SI4 — the code index's sidecar, git reader and off switch
// (design/semantic-index/PLAN.md §4.1, §8 SI4).
//
// Turns red when:
//   - dist/code-index/store.js or dist/code-index/git-blobs.js is missing or lacks its API;
//   - a storage checkpoint (commitStorage) leaves anything under code-index/ in the storage
//     repository's history, with the directory's `.gitignore` of `*` and with it blanked;
//   - one blob under a `.ts` and a `.js` path does not give two entries keyed (blob_sha, lang),
//     each equal row for row to the extractor's table for that language;
//   - two processes indexing one tree concurrently do not converge on exactly one copy of the
//     extractor's rows, or a third process ever sees a blob whose `blobs` row exists before all
//     its symbols, or a reader treats symbol rows without a `blobs` row as indexed;
//   - an interrupted index (a budget, or a killed process) does not report `partial`, or the
//     next call does not resume from what was published and complete the tree;
//   - two extractor_ids do not coexist in their own directories;
//   - a corrupt sidecar is not set aside with its WAL and SHM files while a second process holds
//     it open, or that process does not move to the new file on its next request; a holder
//     does not move when the files are replaced without a damaged byte (the inode check); a
//     database failing only `PRAGMA quick_check` is not set aside;
//   - a request renames or opens the sidecar while another process's recovery marker is
//     present, or a stale marker blocks recovery for ever;
//   - a locked or unreadable sidecar is not `unavailable`, or is set aside; a short lock is not
//     waited out (busy_timeout); an unwritable storage directory makes opening throw rather
//     than each request `unavailable`;
//   - a generation touched within 30 days is collected, a stale one is not, or a process in use
//     does not touch its generation after an hour, by request or, idle, by its timer;
//   - symlinks and gitlinks are not skipped with a reason, or an executable file is not parsed;
//   - a missing object is not `unavailable`, or a missing revision is not; a tree with a missing
//     object is recorded complete, or stays incomplete once the object arrives;
//   - invalid UTF-8 is not `not-utf8`, a file over 2 MB is not `too-large`, or a byte-order mark
//     moves byte offsets off the blob's bytes;
//   - the file, source-byte and time budgets do not report `partial` and resume, or the
//     generation's disk budget does not evict blobs outside the newest trees and say so, does
//     not bring the database and its WAL on disk within it, or does not report a budget that
//     kept trees prevent it from meeting;
//   - AMANUENSIS_CODE_INDEX=off registers a code-index tool, creates any directory, or lets a
//     server collect a generation; or a server with the index on does not collect a stale one;
//     or src/index.ts does not list and dispatch tools from withCodeIndexSwitch's output.
//
// Hermetic: fixture repositories and stores are built in a temporary directory; worker
// processes are written there too. No network.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  closeSync,
  utimesSync,
  writeFileSync,
  writeSync,
  cpSync,
  appendFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Hermetic: the caller's code-index switches and git configuration (hooks, templates) never
// reach the gate, its git fixtures or the servers it starts.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("AMANUENSIS_CODE_INDEX")) delete process.env[key];
}
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), "amanuensis-si4-"));
const DAY = 86_400_000;

class GateFailure extends Error {}
function fail(message) {
  throw new GateFailure(message);
}
function check(condition, message) {
  if (!condition) fail(message);
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function git(cwd, args, input) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", input });
  if (r.status !== 0) fail(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}
function newRepo(name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "gate@localhost"]);
  git(dir, ["config", "user.name", "gate"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}
function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}
function commit(dir, message) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--no-verify", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}
function blobSha(dir, rev, path) {
  return git(dir, ["rev-parse", `${rev}:${path}`]).trim();
}
function newStorage(name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function functions(prefix, count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push(`/** ${prefix} number ${i}. */`);
    lines.push(`export function ${prefix}_${i}(a: number): number {`);
    lines.push(`  return a + ${i};`);
    lines.push("}");
  }
  return `${lines.join("\n")}\n`;
}
const SYMBOL_FIELDS = [
  "ordinal",
  "symbol_id",
  "name",
  "qname",
  "kind",
  "start_line",
  "end_line",
  "occurrence",
  "doc_start_line",
  "start_byte",
  "end_byte",
  "signature",
  "doc",
  "span_sha256",
  "partial",
];
function symbolTable(rows) {
  return rows.map((r) => canonical(Object.fromEntries(SYMBOL_FIELDS.map((f) => [f, r[f]]))));
}
function sameTable(label, got, want) {
  const a = symbolTable(got);
  const b = symbolTable(want);
  if (a.length !== b.length) fail(`${label}: ${a.length} symbol rows, the extractor gives ${b.length}`);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) fail(`${label}: row ${i} is ${a[i]}; the extractor gives ${b[i]}`);
  }
}
function generationDirs(storage) {
  const dir = join(storage, "code-index");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !n.startsWith("."))
    .sort();
}
function corruptLeftovers(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.includes(".corrupt-")) : [];
}

// ---------------------------------------------------------------------------------------
// Load the deliverables defensively.

let store;
let gitBlobs;
let extractor;
let storageGit;
async function load() {
  const storePath = join(here, "dist", "code-index", "store.js");
  const blobsPath = join(here, "dist", "code-index", "git-blobs.js");
  if (!existsSync(storePath)) fail("dist/code-index/store.js is missing (src/code-index/store.ts not built)");
  if (!existsSync(blobsPath)) fail("dist/code-index/git-blobs.js is missing (src/code-index/git-blobs.ts not built)");
  try {
    store = await import(pathToFileURL(storePath).href);
    gitBlobs = await import(pathToFileURL(blobsPath).href);
    extractor = await import(pathToFileURL(join(here, "dist", "code-index", "extract.js")).href);
    storageGit = await import(pathToFileURL(join(here, "dist", "storage-git.js")).href);
  } catch (e) {
    fail(`the code index modules did not load: ${String(e?.message ?? e).split("\n")[0]}`);
  }
  for (const name of [
    "openCodeIndex",
    "collectGenerations",
    "codeIndexEnabled",
    "withCodeIndexSwitch",
    "CODE_INDEX_TOOLS",
  ]) {
    check(name in store, `store.js does not export ${name}`);
  }
  for (const name of ["listTree", "resolveCommit", "BlobReader", "decodeBlob"]) {
    check(name in gitBlobs, `git-blobs.js does not export ${name}`);
  }
}

// A worker process: the second (and third) process of the multi-process checks.
const workerPath = join(root, "worker.mjs");
function writeWorker() {
  const storeUrl = pathToFileURL(join(here, "dist", "code-index", "store.js")).href;
  const sqlitePath = require.resolve("better-sqlite3");
  writeFileSync(
    workerPath,
    `import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
const require = createRequire(import.meta.url);
const Database = require(${JSON.stringify(sqlitePath)});
const store = await import(${JSON.stringify(storeUrl)});
const [mode, ...args] = process.argv.slice(2);
const say = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
if (mode === "index") {
  const [storage, workspace, rev, progress] = args;
  const index = store.openCodeIndex(storage);
  const result = await index.indexTree(workspace, rev, {
    onProgress: progress ? (p) => say({ progress: p }) : undefined,
  });
  say({ result });
  index.close();
} else if (mode === "hold") {
  const [storage, workspace, rev] = args;
  const index = store.openCodeIndex(storage);
  say({ ready: await index.indexTree(workspace, rev) });
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    const [cmd, a, b, c] = line.split(" ");
    if (cmd === "blob") say({ blob: index.blob(a, b) });
    else if (cmd === "file") say({ file: await index.indexFile(workspace, a, b) });
    else if (cmd === "exit") break;
  }
  index.close();
  process.exit(0);
} else if (mode === "watch") {
  const [dbPath, stopFile] = args;
  const seen = {};
  let polls = 0;
  while (!existsSync(stopFile)) {
    if (!existsSync(dbPath)) continue;
    let db;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      db.pragma("busy_timeout = 2000");
      const rows = db
        .prepare(
          "SELECT b.blob_sha || ' ' || b.lang AS k, (SELECT COUNT(*) FROM symbols s WHERE s.blob_sha = b.blob_sha AND s.lang = b.lang) AS n FROM blobs b",
        )
        .all();
      polls++;
      for (const r of rows) (seen[r.k] ??= new Set()).add(r.n);
    } catch {
      // The schema may not exist yet.
    } finally {
      db?.close();
    }
  }
  say({ polls, seen: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v]])) });
} else if (mode === "lock") {
  const [dbPath, ms] = args;
  const db = new Database(dbPath);
  db.pragma("locking_mode = EXCLUSIVE");
  db.exec("BEGIN EXCLUSIVE");
  say({ locked: true });
  setTimeout(() => {
    db.exec("COMMIT");
    db.close();
    say({ released: true });
  }, Number(ms));
}
`,
  );
}

function startWorker(args, env = {}) {
  const child = spawn(process.execPath, [workerPath, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  let buffer = "";
  let stderr = "";
  const messages = [];
  const waiters = [];
  child.stderr.on("data", (c) => {
    stderr += c.toString("utf8");
  });
  child.stdout.on("data", (c) => {
    buffer += c.toString("utf8");
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim()) {
        const msg = JSON.parse(line);
        messages.push(msg);
        for (const w of [...waiters]) {
          if (w.match(msg)) {
            waiters.splice(waiters.indexOf(w), 1);
            w.resolve(msg);
          }
        }
      }
      nl = buffer.indexOf("\n");
    }
  });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const next = (match, ms = 60_000) =>
    new Promise((resolve, reject) => {
      const found = messages.find(match);
      if (found) {
        messages.splice(messages.indexOf(found), 1);
        return resolve(found);
      }
      const timer = setTimeout(() => reject(new GateFailure(`worker ${args[0]} timed out; stderr=${stderr.slice(0, 400)}`)), ms);
      waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          messages.splice(messages.indexOf(m), 1);
          resolve(m);
        },
      });
      exited.then(({ code }) => {
        setTimeout(() => reject(new GateFailure(`worker ${args[0]} exited ${code} before answering; stderr=${stderr.slice(0, 400)}`)), 50);
      });
    });
  const send = (line) => child.stdin.write(`${line}\n`);
  return { child, next, send, exited, stderr: () => stderr };
}

// ---------------------------------------------------------------------------------------
// The MCP server, for the off switch's registration and startup collection.

function startServer(workspace, storageRoot, extraEnv) {
  const env = { ...process.env, AMANUENSIS_STORAGE_ROOT: storageRoot, AMANUENSIS_CALL_LOG: "off", ...extraEnv };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.AMANUENSIS_WORKSPACE;
  const child = spawn(process.execPath, [join(here, "dist", "index.js"), "--workspace", workspace, "--allow-workspace-pin"], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  child.stderr.on("data", (c) => {
    stderr += c.toString("utf8");
  });
  child.stdout.on("data", (c) => {
    buffer += c.toString("utf8");
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        const msg = JSON.parse(line);
        const waiter = pending.get(msg.id);
        if (waiter) {
          pending.delete(msg.id);
          if (msg.error) waiter.reject(new GateFailure(`server error ${JSON.stringify(msg.error)}`));
          else waiter.resolve(msg.result);
        }
      }
      nl = buffer.indexOf("\n");
    }
  });
  const request = (method, params = {}) => {
    const id = nextId++;
    const p = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new GateFailure(`server timed out on ${method}; stderr=${stderr.slice(0, 400)}`));
      }, 30_000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return p;
  };
  const init = async () => {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "amanuensis-si4-gate", version: "1" },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  };
  const call = async (name, args) => {
    const result = await request("tools/call", { name, arguments: args });
    return JSON.parse(result.content[0].text);
  };
  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      child.stdin.end();
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    });
  return { init, request, call, stop };
}

// ---------------------------------------------------------------------------------------
// The checks.

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (e) {
    const message = e instanceof GateFailure ? e.message : `threw: ${String(e?.message ?? e).split("\n")[0]}`;
    results.push({ name, ok: false, message });
    console.log(`  FAIL ${name}: ${message}`);
  }
}

async function extracted(text, lang) {
  return (await extractor.extract(text, lang)).symbols;
}

async function main() {
  console.log("GATE SI4: the code index's sidecar, git reader and off switch");
  await load();
  writeWorker();
  const extractorId = extractor.extractorId();

  // A shared fixture repository.
  const repo = newRepo("repo");
  const shared = functions("shared", 3);
  write(repo, "src/a.ts", shared);
  write(repo, "src/a.js", shared.replace(/: number/g, ""));
  write(repo, "src/same.ts", "export function same(): number {\n  return 1;\n}\n");
  write(repo, "src/same.js", "export function same(): number {\n  return 1;\n}\n");
  write(repo, "README.md", "# fixture\n");
  write(repo, "bin/run.py", "def main():\n    return 0\n");
  chmodSync(join(repo, "bin/run.py"), 0o755);
  write(repo, "src/bad.ts", Buffer.concat([Buffer.from("export const a = 1;\n"), Buffer.from([0xff, 0xfe, 0x80]), Buffer.from("\n")]));
  write(repo, "src/bom.ts", `﻿/** Café. */\nexport function café(): string {\n  return "é";\n}\n`);
  write(repo, "src/huge.ts", `${"// filler line for a file past the per-file budget\n".repeat(42_000)}export const big = 1;\n`);
  symlinkSync("a.ts", join(repo, "src/link.ts"));
  const rev1 = commit(repo, "first");
  // A gitlink: a submodule entry pointing at a commit, without a .gitmodules.
  git(repo, ["update-index", "--add", "--cacheinfo", `160000,${rev1},vendor/sub`]);
  git(repo, ["commit", "-q", "--no-verify", "-m", "gitlink"]);
  const rev2 = git(repo, ["rev-parse", "HEAD"]).trim();

  await step("the off switch registers no tool and creates no directory", async () => {
    const off = { AMANUENSIS_CODE_INDEX: "off" };
    for (const value of ["off", "0", "false", "no", "OFF"]) {
      check(store.codeIndexEnabled({ AMANUENSIS_CODE_INDEX: value }) === false, `AMANUENSIS_CODE_INDEX=${value} leaves the index on`);
    }
    check(store.codeIndexEnabled({}) === true, "the index is off by default; D12 says on");
    check(store.codeIndexEnabled({ AMANUENSIS_CODE_INDEX: "on" }) === true, "AMANUENSIS_CODE_INDEX=on turns the index off");
    const names = [...store.CODE_INDEX_TOOLS].sort().join(",");
    check(names === "find_symbol,outline_file,read_symbol,search_records", `CODE_INDEX_TOOLS is ${names}`);
    const tools = ["get_project_info", "outline_file", "read_symbol", "find_symbol", "search_records", "add_evidence"].map((name) => ({ name }));
    const kept = store.withCodeIndexSwitch(tools, off).map((t) => t.name).join(",");
    check(kept === "get_project_info,add_evidence", `with the index off the registered tools are ${kept}`);
    const all = store.withCodeIndexSwitch(tools, {}).map((t) => t.name).join(",");
    check(all === tools.map((t) => t.name).join(","), `with the index on the registered tools are ${all}`);

    const storage = newStorage("off-storage");
    const opened = store.openCodeIndex(storage, { env: off });
    check(opened === null, "openCodeIndex returns an index with AMANUENSIS_CODE_INDEX=off");
    check(!existsSync(join(storage, "code-index")), "AMANUENSIS_CODE_INDEX=off created code-index/");
    mkdirSync(join(storage, "code-index", "stale-generation"), { recursive: true });
    writeFileSync(join(storage, "code-index", "stale-generation", "last_opened"), "");
    const old = new Date(Date.now() - 40 * DAY);
    utimesSync(join(storage, "code-index", "stale-generation", "last_opened"), old, old);
    store.collectGenerations(storage, { env: off });
    check(existsSync(join(storage, "code-index", "stale-generation")), "collectGenerations collected with the index off");

    // Until a code-index tool is registered (SI5), the server's lists below cannot show the
    // switch working, so the registered list itself must be the switch's output.
    const serverSource = readFileSync(join(here, "src", "index.ts"), "utf8");
    const wrapped = /const (\w+): ToolDefinition\[\] = withCodeIndexSwitch\(\[/.exec(serverSource)?.[1];
    check(wrapped !== undefined, "src/index.ts does not build its tool list with withCodeIndexSwitch");
    check(
      new RegExp(`tools: ${wrapped}\\.map\\(`).test(serverSource) && new RegExp(`new Map\\(${wrapped}\\.map\\(`).test(serverSource),
      `src/index.ts does not list and dispatch from ${wrapped}, the switched tool list`,
    );

    // The server: off registers none of the four and leaves storage alone; on collects.
    const serverRoot = newStorage("server-storage");
    const workspace = newRepo("server-workspace");
    write(workspace, "x.ts", "export const x = 1;\n");
    commit(workspace, "x");
    const first = startServer(workspace, serverRoot, off);
    await first.init();
    const listed = (await first.request("tools/list")).tools.map((t) => t.name);
    const info = await first.call("get_project_info", { workspace });
    await first.call("list_subsystems", {});
    await first.stop();
    const leaked = listed.filter((n) => store.CODE_INDEX_TOOLS.includes(n));
    check(leaked.length === 0, `with the index off the server registers ${leaked.join(", ")}`);
    const storagePath = info.storage_path;
    check(typeof storagePath === "string" && existsSync(storagePath), `get_project_info gave no storage path: ${JSON.stringify(info).slice(0, 200)}`);
    check(!existsSync(join(storagePath, "code-index")), "a server with the index off created code-index/");
    const stale = join(storagePath, "code-index", "stale-generation");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "last_opened"), "");
    utimesSync(join(stale, "last_opened"), old, old);
    const second = startServer(workspace, serverRoot, off);
    await second.init();
    await second.call("get_project_info", { workspace });
    await second.call("list_subsystems", {});
    await second.stop();
    check(existsSync(stale), "a server with the index off collected a generation");
    const third = startServer(workspace, serverRoot, { AMANUENSIS_CODE_INDEX: "on" });
    await third.init();
    await third.call("get_project_info", { workspace });
    await third.call("list_subsystems", {});
    await third.stop();
    check(!existsSync(stale), "a server with the index on did not collect a generation untouched for 40 days");
  });

  await step("nothing under code-index/ reaches the storage history after a checkpoint", async () => {
    const storage = newStorage("checkpoint-storage");
    const init = storageGit.ensureStorageRepo(storage);
    check(init.ok, `ensureStorageRepo failed: ${init.reason}`);
    writeFileSync(join(storage, "memory.db"), "record\n");
    const index = store.openCodeIndex(storage);
    const result = await index.indexTree(repo, rev2);
    check(result.state === "ok", `indexTree: ${canonical(result)}`);
    index.close();
    const ignore = join(storage, "code-index", ".gitignore");
    check(existsSync(ignore) && readFileSync(ignore, "utf8") === "*\n", "code-index/.gitignore is not `*`");
    check(existsSync(join(storage, "code-index", extractorId, "index.db")), `no code-index/${extractorId}/index.db`);
    const tracked = () =>
      git(storage, ["ls-files"])
        .split("\n")
        .filter((l) => l.startsWith("code-index"));
    let r = storageGit.commitStorage(storage, "checkpoint one");
    check(r.ok, `commitStorage failed: ${r.reason}`);
    check(tracked().length === 0, `tracked after a checkpoint: ${tracked().join(", ")}`);
    writeFileSync(ignore, "");
    writeFileSync(join(storage, "memory.db"), "record two\n");
    r = storageGit.commitStorage(storage, "checkpoint two");
    check(r.ok, `commitStorage failed: ${r.reason}`);
    check(tracked().length === 0, `tracked with the ignore file blank: ${tracked().join(", ")}`);
    const history = git(storage, ["log", "--all", "--name-only", "--format="]).split("\n").filter((l) => l.startsWith("code-index"));
    check(history.length === 0, `in history: ${history.join(", ")}`);
  });

  await step("one blob under .ts and .js gives two entries, each the extractor's table", async () => {
    const storage = newStorage("two-entries");
    const index = store.openCodeIndex(storage);
    const result = await index.indexTree(repo, rev2);
    check(result.state === "ok" && result.partial === false, `indexTree: ${canonical(result)}`);
    const sha = blobSha(repo, rev2, "src/same.ts");
    check(sha === blobSha(repo, rev2, "src/same.js"), "fixture: same.ts and same.js differ");
    const ts = index.blob(sha, "typescript");
    const js = index.blob(sha, "javascript");
    check(ts.state === "ok" && ts.indexed === true, `(blob, typescript) not indexed: ${canonical(ts).slice(0, 200)}`);
    check(js.state === "ok" && js.indexed === true, `(blob, javascript) not indexed: ${canonical(js).slice(0, 200)}`);
    const text = readFileSync(join(repo, "src/same.ts"), "utf8");
    sameTable("same.ts as typescript", ts.symbols, await extracted(text, "typescript"));
    sameTable("same.js as javascript", js.symbols, await extracted(text, "javascript"));
    check(ts.blob.lang === "typescript" && js.blob.lang === "javascript", "entries carry the wrong lang");
    const db = new (require("better-sqlite3"))(join(storage, "code-index", extractorId, "index.db"), { readonly: true });
    const rows = db.prepare("SELECT lang FROM blobs WHERE blob_sha = ? ORDER BY lang").all(sha).map((r) => r.lang);
    const trees = db.prepare("SELECT path, lang, skip_reason, mode FROM trees WHERE rev = ? ORDER BY path").all(result.rev);
    db.close();
    check(rows.join(",") === "javascript,typescript", `blobs rows for the shared blob: ${rows.join(",")}`);
    const byPath = Object.fromEntries(trees.map((t) => [t.path, t]));
    check(byPath["src/same.ts"]?.lang === "typescript" && byPath["src/same.js"]?.lang === "javascript", "trees rows take lang from the path");
    // Every other entry is the extractor's table too, and offsets slice the blob's own bytes.
    for (const path of ["src/a.ts", "src/a.js", "bin/run.py", "src/bom.ts"]) {
      const lang = extractor.languageForPath(path);
      const entry = index.blob(blobSha(repo, rev2, path), lang);
      const bytes = readFileSync(join(repo, path));
      check(entry.indexed === true, `${path} not indexed`);
      sameTable(path, entry.symbols, await extracted(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes), lang));
      for (const s of entry.symbols) {
        check(sha256(bytes.subarray(s.start_byte, s.end_byte)) === s.span_sha256, `${path} ${s.symbol_id}: bytes ${s.start_byte}-${s.end_byte} do not hash to span_sha256`);
      }
      check(entry.blob.status === "ok" && entry.blob.bytes === bytes.length, `${path}: blob row ${canonical(entry.blob)}`);
    }
    const bom = index.blob(blobSha(repo, rev2, "src/bom.ts"), "typescript");
    check(bom.symbols.some((s) => s.name === "café" && s.start_byte === 3), `a byte-order mark moved offsets: ${canonical(bom.symbols.map((s) => [s.name, s.start_byte]))}`);
    // Readers trust only the blobs row.
    const probe = new (require("better-sqlite3"))(join(storage, "code-index", extractorId, "index.db"));
    const half = "f".repeat(40);
    const template = probe.prepare("SELECT * FROM symbols LIMIT 1").get();
    const cols = Object.keys(template).filter((c) => c !== "id");
    probe
      .prepare(`INSERT INTO symbols (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
      .run(...cols.map((c) => (c === "blob_sha" ? half : template[c])));
    probe.close();
    const unpublished = index.blob(half, template.lang);
    check(unpublished.state === "ok" && unpublished.indexed === false, `symbols without a blobs row read as indexed: ${canonical(unpublished).slice(0, 200)}`);
    index.close();
  });

  await step("symlinks and gitlinks are skipped with a reason; an executable file is parsed", async () => {
    const storage = newStorage("modes");
    const index = store.openCodeIndex(storage);
    const result = await index.indexTree(repo, rev2);
    const db = new (require("better-sqlite3"))(join(storage, "code-index", extractorId, "index.db"), { readonly: true });
    const trees = Object.fromEntries(db.prepare("SELECT * FROM trees WHERE rev = ?").all(result.rev).map((t) => [t.path, t]));
    const complete = db.prepare("SELECT * FROM trees_complete WHERE rev = ?").get(result.rev);
    db.close();
    check(trees["src/link.ts"]?.mode === "120000" && trees["src/link.ts"]?.skip_reason === "symlink", `link.ts: ${canonical(trees["src/link.ts"])}`);
    check(trees["vendor/sub"]?.mode === "160000" && trees["vendor/sub"]?.skip_reason === "gitlink", `vendor/sub: ${canonical(trees["vendor/sub"])}`);
    check(trees["bin/run.py"]?.mode === "100755" && trees["bin/run.py"]?.skip_reason === null, `bin/run.py: ${canonical(trees["bin/run.py"])}`);
    check(trees["README.md"]?.skip_reason === "unsupported-language", `README.md: ${canonical(trees["README.md"])}`);
    const linkBlob = trees["src/link.ts"].blob_sha;
    check(index.blob(linkBlob, "typescript").indexed === false, "the symlink's target text was parsed as typescript");
    check(result.skipped?.symlink === 1 && result.skipped?.gitlink === 1, `skipped: ${canonical(result.skipped)}`);
    check(complete && complete.files === Object.keys(trees).length, `trees_complete: ${canonical(complete)}`);
    const skippedCount = Object.values(trees).filter((t) => t.skip_reason !== null).length;
    check(complete.skipped === skippedCount, `trees_complete.skipped ${complete.skipped}, ${skippedCount} skipped rows`);
    const link = await index.indexFile(repo, rev2, "src/link.ts");
    check(link.state === "skipped" && link.skip_reason === "symlink", `indexFile on a symlink: ${canonical(link)}`);
    const sub = await index.indexFile(repo, rev2, "vendor/sub");
    check(sub.state === "skipped" && sub.skip_reason === "gitlink", `indexFile on a gitlink: ${canonical(sub)}`);
    const status = index.treeStatus(rev2);
    check(status.state === "ok" && status.complete === true, `treeStatus: ${canonical(status)}`);
    index.close();
  });

  await step("invalid UTF-8 is not-utf8 and a file over 2 MB is too-large", async () => {
    const storage = newStorage("statuses");
    const index = store.openCodeIndex(storage);
    await index.indexTree(repo, rev2);
    const bad = index.blob(blobSha(repo, rev2, "src/bad.ts"), "typescript");
    check(bad.indexed === true && bad.blob.status === "not-utf8" && bad.symbols.length === 0, `bad.ts: ${canonical(bad).slice(0, 300)}`);
    const huge = index.blob(blobSha(repo, rev2, "src/huge.ts"), "typescript");
    const size = statSync(join(repo, "src/huge.ts")).size;
    check(size > 2 * 1024 * 1024, "fixture: huge.ts is not over 2 MB");
    check(huge.indexed === true && huge.blob.status === "too-large" && huge.blob.bytes === size && huge.symbols.length === 0, `huge.ts: ${canonical(huge.blob)}`);
    check(gitBlobs.decodeBlob(Buffer.from([0x61, 0xff])).status === "not-utf8", "decodeBlob accepts invalid UTF-8");
    const crlf = gitBlobs.decodeBlob(Buffer.from("﻿a\r\nb\n"));
    check(crlf.text === "﻿a\r\nb\n", "decodeBlob dropped a byte-order mark or a carriage return");
    const file = await index.indexFile(repo, rev2, "src/bad.ts");
    check(file.state === "ok" && file.status === "not-utf8", `indexFile on bad.ts: ${canonical(file)}`);
    index.close();
  });

  await step("a missing object or revision is unavailable, never gone", async () => {
    const r = newRepo("missing");
    write(r, "keep.ts", "export function keep() {}\n");
    write(r, "lost.ts", "export function lost() { return 'lost-object-marker'; }\n");
    const rev = commit(r, "one");
    const sha = blobSha(r, rev, "lost.ts");
    const objectPath = join(r, ".git", "objects", sha.slice(0, 2), sha.slice(2));
    const objectBytes = readFileSync(objectPath);
    rmSync(objectPath);
    const storage = newStorage("missing-storage");
    const index = store.openCodeIndex(storage);
    const result = await index.indexTree(r, rev);
    check(result.unavailable === 1, `indexTree with a missing object: ${canonical(result)}`);
    // Absence cannot be shown while a supported blob is missing, so the tree is not complete.
    check(result.partial === true && result.state === "partial", `a tree with a missing object was reported complete: ${canonical(result)}`);
    const status = index.treeStatus(rev);
    check(status.state === "ok" && status.complete === false, `a tree with a missing object was recorded complete: ${canonical(status)}`);
    check(index.blob(blobSha(r, rev, "keep.ts"), "typescript").indexed === true, "the intact file was not indexed");
    const lost = await index.indexFile(r, rev, "lost.ts");
    check(lost.state === "unavailable", `indexFile on a missing object: ${canonical(lost)}`);
    const gone = await index.indexTree(r, "0123456789abcdef0123456789abcdef01234567");
    check(gone.state === "unavailable", `indexTree on a missing revision: ${canonical(gone)}`);
    check(gitBlobs.resolveCommit(r, "no-such-branch") === null, "resolveCommit resolved a missing revision");
    // The object arrives (a fetch, an unshallow): the same revision completes, and its entry
    // no longer records the transient failure.
    writeFileSync(objectPath, objectBytes);
    const again = await index.indexTree(r, rev);
    check(again.state === "ok" && again.partial === false && again.unavailable === 0 && again.indexed === 1, `indexTree after the object arrived: ${canonical(again)}`);
    check(index.treeStatus(rev).complete === true, `the tree was not completed once its object arrived: ${canonical(index.treeStatus(rev))}`);
    const Database = require("better-sqlite3");
    const raw = new Database(join(storage, "code-index", extractorId, "index.db"), { readonly: true });
    const entry = raw.prepare("SELECT skip_reason FROM trees WHERE rev = ? AND path = 'lost.ts'").get(rev);
    raw.close();
    check(entry && entry.skip_reason === null, `the arrived object's tree entry still reads ${canonical(entry)}`);
    index.close();
  });

  // A tree large enough that publication takes measurable time.
  const big = newRepo("big");
  for (let f = 0; f < 30; f++) write(big, `src/m${f}.ts`, functions(`m${f}`, 120));
  const bigRev = commit(big, "big");

  await step("two processes indexing one tree converge, and no half-written blob is visible", async () => {
    const storage = newStorage("concurrent");
    const dbPath = join(storage, "code-index", extractorId, "index.db");
    const stopFile = join(root, "watch-stop");
    const watcher = startWorker(["watch", dbPath, stopFile]);
    const a = startWorker(["index", storage, big, bigRev]);
    const b = startWorker(["index", storage, big, bigRev]);
    const ra = (await a.next((m) => m.result, 120_000)).result;
    const rb = (await b.next((m) => m.result, 120_000)).result;
    writeFileSync(stopFile, "");
    const seen = await watcher.next((m) => m.seen, 30_000);
    check(ra.state === "ok" && rb.state === "ok", `results: ${canonical(ra)} / ${canonical(rb)}`);
    const db = new (require("better-sqlite3"))(dbPath, { readonly: true });
    const blobs = db.prepare("SELECT blob_sha, lang FROM blobs").all();
    const completes = db.prepare("SELECT COUNT(*) AS n FROM trees_complete WHERE rev = ?").get(bigRev).n;
    const refs = db.prepare("SELECT blob_sha, COUNT(*) AS n FROM refs GROUP BY blob_sha").all();
    db.close();
    check(blobs.length === 30, `${blobs.length} blobs rows for 30 files`);
    check(completes === 1, `${completes} trees_complete rows`);
    const index = store.openCodeIndex(storage);
    const refCounts = Object.fromEntries(refs.map((r) => [r.blob_sha, r.n]));
    const finalCount = {};
    for (let f = 0; f < 30; f++) {
      const sha = blobSha(big, bigRev, `src/m${f}.ts`);
      const entry = index.blob(sha, "typescript");
      const want = await extractor.extract(readFileSync(join(big, `src/m${f}.ts`), "utf8"), "typescript");
      sameTable(`m${f}.ts after two writers`, entry.symbols, want.symbols);
      check((refCounts[sha] ?? 0) === want.refs.length, `m${f}.ts: ${refCounts[sha]} refs rows, the extractor gives ${want.refs.length}`);
      finalCount[`${sha} typescript`] = want.symbols.length;
    }
    index.close();
    check(seen.polls > 0, "the watcher never read the sidecar");
    for (const [key, counts] of Object.entries(seen.seen)) {
      const bad = counts.filter((n) => n !== finalCount[key]);
      check(bad.length === 0, `a blob was visible with ${bad.join(",")} symbols; complete it has ${finalCount[key]}`);
    }
    await Promise.all([a.exited, b.exited, watcher.exited]);
  });

  await step("an interrupted index reports partial and the next call resumes", async () => {
    // By the file budget.
    const storage = newStorage("budget-files");
    const limited = store.openCodeIndex(storage, { env: { AMANUENSIS_CODE_INDEX_MAX_FILES: "4" } });
    const first = await limited.indexTree(big, bigRev);
    check(first.state === "partial" && first.partial === true, `with 4 files allowed: ${canonical(first)}`);
    check(first.indexed === 4 && first.budget?.limit === "files" && first.budget?.value === 4, `the file budget was not reported: ${canonical(first)}`);
    const half = limited.treeStatus(bigRev);
    check(half.complete === false, `treeStatus after a partial call: ${canonical(half)}`);
    limited.close();
    const index = store.openCodeIndex(storage);
    const second = await index.indexTree(big, bigRev);
    check(second.state === "ok" && second.partial === false && second.cached === 4 && second.indexed === 26, `resumed: ${canonical(second)}`);
    check(index.treeStatus(bigRev).complete === true, "the resumed tree is not complete");
    index.close();

    // By a killed process.
    const killed = newStorage("killed");
    const w = startWorker(["index", killed, big, bigRev, "progress"]);
    await w.next((m) => m.progress && m.progress.indexed >= 2, 60_000);
    w.child.kill("SIGKILL");
    await w.exited;
    const after = store.openCodeIndex(killed);
    const status = after.treeStatus(bigRev);
    check(status.complete === false, `treeStatus after a kill: ${canonical(status)}`);
    const resumed = await after.indexTree(big, bigRev);
    check(resumed.state === "ok" && resumed.cached >= 2 && resumed.cached + resumed.indexed === 30, `resumed after a kill: ${canonical(resumed)}`);
    for (let f = 0; f < 30; f++) {
      const entry = after.blob(blobSha(big, bigRev, `src/m${f}.ts`), "typescript");
      check(entry.indexed && entry.symbols.length === 120, `m${f}.ts after a kill has ${entry.symbols?.length} symbols`);
    }
    after.close();
  });

  await step("a directory is not a file: indexFile answers not-found", async () => {
    const index = store.openCodeIndex(newStorage("directory"));
    const dir = await index.indexFile(repo, rev2, "src");
    check(dir.state === "not-found", `indexFile on the directory src: ${canonical(dir)}`);
    index.close();
  });

  await step("a tree pruned while it is indexed is not recorded complete", async () => {
    const storage = newStorage("pruned-mid-index");
    const index = store.openCodeIndex(storage);
    let pruned = false;
    const result = await index.indexTree(big, bigRev, {
      onProgress: () => {
        if (pruned) return;
        pruned = true;
        // Another request records eight newer revisions, which prunes this one's rows.
        for (let i = 0; i < 8; i++) index.recordTree(`${"0".repeat(39)}${i}`, []);
      },
    });
    check(result.partial === true && result.state !== "ok", `a pruned tree reported: ${canonical(result)}`);
    check(index.treeStatus(bigRev).complete === false, "a tree with no rows left is recorded complete");
    const again = await index.indexTree(big, bigRev);
    check(again.state === "ok" && index.treeStatus(bigRev).complete === true, `the next call does not complete it: ${canonical(again)}`);
    index.close();
  });

  await step("source-byte, time and disk budgets report partial, resume and evict", async () => {
    const storage = newStorage("budget-bytes");
    const bytes = store.openCodeIndex(storage, { budgets: { maxSourceBytes: 20_000 } });
    const one = await bytes.indexTree(big, bigRev);
    check(one.partial === true && one.budget?.limit === "source-bytes" && one.indexed >= 1 && one.indexed < 30, `source-byte budget: ${canonical(one)}`);
    const two = await bytes.indexTree(big, bigRev);
    check(two.partial === true && two.cached === one.indexed && two.indexed >= 1, `source-byte budget, second call: ${canonical(two)}`);
    bytes.close();
    const timed = store.openCodeIndex(newStorage("budget-time"), { budgets: { maxMillis: 0 } });
    const t1 = await timed.indexTree(big, bigRev);
    check(t1.partial === true && t1.budget?.limit === "time" && t1.indexed === 1, `time budget: ${canonical(t1)}`);
    const t2 = await timed.indexTree(big, bigRev);
    check(t2.partial === true && t2.cached === 1 && t2.indexed === 1, `time budget, second call: ${canonical(t2)}`);
    timed.close();

    // Disk: a blob read outside any tree is evicted first; the tree's blobs stay.
    const r = newRepo("evict");
    write(r, "old.ts", functions("old", 40));
    const old = commit(r, "old");
    write(r, "old.ts", functions("fresh", 40));
    write(r, "kept.ts", functions("kept", 40));
    const fresh = commit(r, "fresh");
    const disk = newStorage("budget-disk");
    const loose = store.openCodeIndex(disk);
    const file = await loose.indexFile(r, old, "old.ts");
    check(file.state === "ok", `indexFile at the old revision: ${canonical(file)}`);
    loose.close();
    const tight = store.openCodeIndex(disk, { budgets: { maxGenerationBytes: 1 } });
    const result = await tight.indexTree(r, fresh);
    check(result.evicted >= 1, `the disk budget evicted nothing: ${canonical(result)}`);
    check(tight.blob(blobSha(r, old, "old.ts"), "typescript").indexed === false, "a blob outside every kept tree was not evicted");
    check(tight.blob(blobSha(r, fresh, "kept.ts"), "typescript").indexed === true, "a blob in the newest tree was evicted");
    check(tight.blob(blobSha(r, fresh, "old.ts"), "typescript").indexed === true, "a blob in the newest tree was evicted");
    // Kept trees hold more than one byte: the budget cannot be met, and the result says so.
    check(result.disk_over_budget?.limit === 1 && result.disk_over_budget.bytes > 1, `an unmet disk budget was not reported: ${canonical(result)}`);
    tight.close();

    // The budget is bytes on disk, the database and its WAL: eviction reclaims what it frees.
    const p = newRepo("evict-physical");
    write(p, "big.ts", functions("big", 600));
    const before = commit(p, "big");
    rmSync(join(p, "big.ts"));
    write(p, "small.ts", functions("small", 3));
    const after = commit(p, "small");
    const physicalStorage = newStorage("budget-physical");
    const onDisk = () => {
      const db = join(physicalStorage, "code-index", extractorId, "index.db");
      return ["", "-wal"].reduce((total, suffix) => total + (existsSync(db + suffix) ? statSync(db + suffix).size : 0), 0);
    };
    const first = store.openCodeIndex(physicalStorage);
    check((await first.indexFile(p, before, "big.ts")).state === "ok", "fixture: the large blob was not indexed");
    first.close();
    const grown = onDisk();
    const limit = Math.floor(grown * 0.6);
    const second = store.openCodeIndex(physicalStorage, { budgets: { maxGenerationBytes: limit } });
    const reclaimed = await second.indexTree(p, after);
    check(reclaimed.evicted === 1, `the large blob outside the newest tree was not evicted: ${canonical(reclaimed)}`);
    check(onDisk() <= limit, `after eviction the generation is ${onDisk()} bytes on disk (from ${grown}), over its ${limit}-byte budget: ${canonical(reclaimed)}`);
    check(reclaimed.disk_over_budget === null, `a met disk budget was reported unmet: ${canonical(reclaimed)}`);
    second.close();
  });

  await step("two extractor_ids coexist", async () => {
    const alt = join(root, "alt-package");
    mkdirSync(alt);
    symlinkSync(join(here, "grammars"), join(alt, "grammars"));
    cpSync(join(here, "queries"), join(alt, "queries"), { recursive: true });
    appendFileSync(join(alt, "queries", "typescript.scm"), "\n; a different generation\n");
    const altId = extractor.extractorId({ packageRoot: alt });
    check(altId !== extractorId, "fixture: the alternate package root has the same extractor_id");
    const storage = newStorage("generations");
    const mine = store.openCodeIndex(storage);
    const theirs = store.openCodeIndex(storage, { packageRoot: alt });
    check(mine.extractorId === extractorId && theirs.extractorId === altId, "openCodeIndex took the wrong extractor_id");
    await mine.indexTree(repo, rev2);
    await theirs.indexFile(repo, rev2, "src/a.ts");
    const dirs = generationDirs(storage);
    check(dirs.join(",") === [extractorId, altId].sort().join(","), `generations on disk: ${dirs.join(",")}`);
    const sha = blobSha(repo, rev2, "src/same.ts");
    check(mine.blob(sha, "typescript").indexed === true, "the first generation lost its blob");
    check(theirs.blob(sha, "typescript").indexed === false, "the second generation shares the first's rows");
    check(theirs.blob(blobSha(repo, rev2, "src/a.ts"), "typescript").indexed === true, "the second generation did not index its blob");
    check(existsSync(join(storage, "code-index", altId, "index.db")), "the second generation has no index.db of its own");
    mine.close();
    theirs.close();
    check(generationDirs(storage).length === 2, "reopening collected a fresh generation");
  });

  await step("a recently touched generation is not collected, a stale one is, and use touches", async () => {
    const storage = newStorage("collect");
    const gen = (name, ageDays) => {
      const dir = join(storage, "code-index", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.db"), "");
      writeFileSync(join(dir, "last_opened"), "");
      const t = new Date(Date.now() - ageDays * DAY);
      utimesSync(join(dir, "last_opened"), t, t);
    };
    gen("stale", 31);
    gen("recent", 29);
    let clock = Date.now();
    const index = store.openCodeIndex(storage, { now: () => clock });
    const dirs = generationDirs(storage);
    check(!dirs.includes("stale"), "a generation untouched for 31 days was not collected");
    check(dirs.includes("recent"), "a generation touched 29 days ago was collected");
    check(dirs.includes(extractorId), "the generation in use is missing");
    const lastOpened = join(storage, "code-index", extractorId, "last_opened");
    check(existsSync(lastOpened) && Math.abs(statSync(lastOpened).mtimeMs - clock) < 2000, "opening did not touch last_opened");
    const longAgo = new Date(clock - 40 * DAY);
    utimesSync(lastOpened, longAgo, longAgo);
    clock += 61 * 60_000;
    await index.indexFile(repo, rev2, "src/same.ts");
    check(Math.abs(statSync(lastOpened).mtimeMs - clock) < 2000, "a request an hour after opening did not touch last_opened");
    // A second process starting now does not collect the generation in use.
    const result = store.collectGenerations(storage, { now: () => clock });
    check(!result.collected.includes(extractorId) && existsSync(lastOpened), "a generation in use was collected");
    index.close();
    // Idle: an open index touches on its own timer, with no request to do it.
    const idle = store.openCodeIndex(storage, { now: () => clock, touchEveryMs: 25 });
    utimesSync(lastOpened, longAgo, longAgo);
    clock += 61 * 60_000;
    await new Promise((resolve) => setTimeout(resolve, 300));
    check(Math.abs(statSync(lastOpened).mtimeMs - clock) < 2000, "an idle open index did not touch last_opened on its timer");
    idle.close();
  });

  await step("a corrupt sidecar is set aside while a second process holds it, which then moves", async () => {
    const storage = newStorage("corrupt");
    const dir = join(storage, "code-index", extractorId);
    const dbPath = join(dir, "index.db");
    const holder = startWorker(["hold", storage, repo, rev1]);
    const ready = (await holder.next((m) => m.ready, 60_000)).ready;
    check(ready.state === "ok", `holder: ${canonical(ready)}`);
    const Database = require("better-sqlite3");
    const ck = new Database(dbPath);
    ck.pragma("wal_checkpoint(TRUNCATE)");
    ck.close();
    check(existsSync(`${dbPath}-wal`) && existsSync(`${dbPath}-shm`), "fixture: the holder has no WAL and SHM files open");
    const oldInode = statSync(dbPath).ino;
    const fd = openSync(dbPath, "r+");
    writeSync(fd, Buffer.alloc(100, 0x41), 0, 100, 0);
    closeSync(fd);

    const index = store.openCodeIndex(storage);
    const y = await index.indexFile(repo, rev2, "src/same.ts");
    check(y.state === "ok", `indexing after corruption: ${canonical(y)}`);
    const leftovers = corruptLeftovers(dir).sort();
    const stamp = leftovers[0]?.replace(/^index\.db(-wal|-shm)?\.corrupt-/, "");
    check(
      leftovers.length === 3 &&
        leftovers.includes(`index.db.corrupt-${stamp}`) &&
        leftovers.includes(`index.db-wal.corrupt-${stamp}`) &&
        leftovers.includes(`index.db-shm.corrupt-${stamp}`),
      `set aside: ${leftovers.join(", ") || "nothing"}`,
    );
    check(statSync(dbPath).ino !== oldInode, "index.db is the corrupt file still");
    const ySha = blobSha(repo, rev2, "src/same.ts");
    holder.send(`blob ${ySha} typescript`);
    const seen = (await holder.next((m) => "blob" in m)).blob;
    check(seen.state === "ok" && seen.indexed === true, `the holder did not move to the new file: ${canonical(seen).slice(0, 200)}`);
    holder.send(`file ${rev2} src/a.js`);
    const z = (await holder.next((m) => "file" in m)).file;
    check(z.state === "ok", `the holder's next write: ${canonical(z)}`);
    const zSha = blobSha(repo, rev2, "src/a.js");
    check(index.blob(zSha, "javascript").indexed === true, "the holder's write did not reach the new file");
    holder.send("exit");
    await holder.exited;
    index.close();
  });

  await step("a sidecar replaced without a byte changed moves its holder on its next request", async () => {
    const storage = newStorage("replaced");
    const dbPath = join(storage, "code-index", extractorId, "index.db");
    const holder = startWorker(["hold", storage, repo, rev1]);
    const ready = (await holder.next((m) => m.ready, 60_000)).ready;
    check(ready.state === "ok", `holder: ${canonical(ready)}`);
    // Another process's recovery: the files move; nothing the holder reads is damaged, so
    // only the per-request inode check can send the holder to the new file.
    const oldInode = statSync(dbPath).ino;
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, `${dbPath}${suffix}.corrupt-elsewhere`);
    }
    const r = newRepo("replaced-repo");
    write(r, "moved.ts", "export function moved(): number {\n  return 7;\n}\n");
    const rev = commit(r, "one");
    const index = store.openCodeIndex(storage);
    const y = await index.indexFile(r, rev, "moved.ts");
    check(y.state === "ok" && statSync(dbPath).ino !== oldInode, `indexing into the replacement: ${canonical(y)}`);
    holder.send(`blob ${blobSha(r, rev, "moved.ts")} typescript`);
    const seen = (await holder.next((m) => "blob" in m)).blob;
    check(seen.state === "ok" && seen.indexed === true, `the holder kept reading the replaced file: ${canonical(seen).slice(0, 200)}`);
    // src/a.js is in the old file (the holder indexed rev1), not the new one.
    holder.send(`file ${rev2} src/a.js`);
    const z = (await holder.next((m) => "file" in m)).file;
    check(z.state === "ok", `the holder's next write: ${canonical(z)}`);
    check(index.blob(blobSha(repo, rev2, "src/a.js"), "javascript").indexed === true, "the holder's write did not reach the replacement");
    holder.send("exit");
    await holder.exited;
    index.close();
  });

  await step("a sidecar that fails only quick_check is set aside", async () => {
    const storage = newStorage("quick-check");
    const dir = join(storage, "code-index", extractorId);
    const dbPath = join(dir, "index.db");
    const seed = store.openCodeIndex(storage);
    await seed.indexFile(repo, rev2, "src/same.ts");
    seed.close();
    // Damage an interior page of a table no request reads; the header stays intact.
    const Database = require("better-sqlite3");
    const raw = new Database(dbPath);
    raw.exec("CREATE TABLE pad (x BLOB)");
    const pad = raw.prepare("INSERT INTO pad VALUES (randomblob(3000))");
    for (let i = 0; i < 40; i++) pad.run();
    const { rootpage } = raw.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'pad'").get();
    const pageSize = raw.pragma("page_size", { simple: true });
    raw.pragma("wal_checkpoint(TRUNCATE)");
    raw.close();
    const fd = openSync(dbPath, "r+");
    writeSync(fd, Buffer.alloc(pageSize, 0x41), 0, pageSize, (rootpage - 1) * pageSize);
    closeSync(fd);
    const oldInode = statSync(dbPath).ino;
    const index = store.openCodeIndex(storage);
    const y = await index.indexFile(repo, rev2, "src/a.ts");
    check(y.state === "ok", `indexing after a quick_check failure: ${canonical(y)}`);
    check(corruptLeftovers(dir).some((n) => n.startsWith("index.db.corrupt-")), `a database failing quick_check was not set aside: ${corruptLeftovers(dir).join(", ") || "nothing"}`);
    check(statSync(dbPath).ino !== oldInode, "index.db is the database that failed quick_check still");
    index.close();
  });

  await step("recovery and opening wait while another process recovers", async () => {
    const storage = newStorage("recovering");
    const dir = join(storage, "code-index", extractorId);
    const dbPath = join(dir, "index.db");
    const marker = `${dbPath}.recovering`;
    const seed = store.openCodeIndex(storage);
    await seed.indexFile(repo, rev2, "src/same.ts");
    seed.close();
    const damage = () => {
      const fd = openSync(dbPath, "r+");
      writeSync(fd, Buffer.alloc(100, 0x41), 0, 100, 0);
      closeSync(fd);
    };
    damage();
    // Another process is mid-recovery: a second recoverer neither renames nor opens.
    writeFileSync(marker, "");
    const waiting = store.openCodeIndex(storage, { busyTimeoutMs: 200 });
    const during = await waiting.indexFile(repo, rev2, "src/a.ts");
    check(during.state === "unavailable", `a request during another process's recovery: ${canonical(during)}`);
    check(corruptLeftovers(dir).length === 0, `a second recoverer set files aside during another's recovery: ${corruptLeftovers(dir).join(", ")}`);
    rmSync(marker);
    const afterwards = await waiting.indexFile(repo, rev2, "src/a.ts");
    check(afterwards.state === "ok" && corruptLeftovers(dir).length >= 1, `recovery once the other finished: ${canonical(afterwards)}`);
    waiting.close();
    // An opener does not open a healthy file while a recovery is in progress.
    writeFileSync(marker, "");
    const opener = store.openCodeIndex(storage, { busyTimeoutMs: 200 });
    const read = opener.blob(blobSha(repo, rev2, "src/a.ts"), "typescript");
    check(read.state === "unavailable", `a request opened the sidecar during a recovery: ${canonical(read).slice(0, 200)}`);
    rmSync(marker);
    check(opener.blob(blobSha(repo, rev2, "src/a.ts"), "typescript").indexed === true, "the recovered sidecar lost its rows");
    opener.close();
    // A process already holding the database finds it corrupt during another's recovery: it
    // reaches recovery without opening, and must still not rename.
    const holding = store.openCodeIndex(storage, { busyTimeoutMs: 200 });
    check(holding.blob(blobSha(repo, rev2, "src/a.ts"), "typescript").indexed === true, "fixture: the holder cannot read");
    const settle = new (require("better-sqlite3"))(dbPath);
    settle.pragma("wal_checkpoint(TRUNCATE)");
    settle.close();
    const held = corruptLeftovers(dir).length;
    writeFileSync(marker, "");
    damage();
    const found = holding.blob(blobSha(repo, rev2, "src/a.ts"), "typescript");
    check(found.state === "unavailable", `a holder finding corruption during another's recovery: ${canonical(found).slice(0, 200)}`);
    check(corruptLeftovers(dir).length === held, `a holder set files aside during another's recovery: ${corruptLeftovers(dir).join(", ")}`);
    rmSync(marker);
    holding.close();
    // A marker left by a process that died long ago does not block recovery for ever.
    const before = corruptLeftovers(dir).length;
    damage();
    writeFileSync(marker, "");
    const stale = new Date(Date.now() - DAY);
    utimesSync(marker, stale, stale);
    const late = store.openCodeIndex(storage, { busyTimeoutMs: 200 });
    const recovered = await late.indexFile(repo, rev2, "src/same.ts");
    check(recovered.state === "ok" && corruptLeftovers(dir).length > before, `a stale recovery marker blocked recovery: ${canonical(recovered)}`);
    check(!existsSync(marker), "the stale recovery marker was left behind");
    late.close();
  });

  await step("a locked or unreadable sidecar is unavailable and not set aside", async () => {
    const storage = newStorage("locked");
    const dir = join(storage, "code-index", extractorId);
    const dbPath = join(dir, "index.db");
    const seed = store.openCodeIndex(storage);
    await seed.indexFile(repo, rev2, "src/same.ts");
    seed.close();
    const inode = statSync(dbPath).ino;

    // A short lock is waited out.
    const brief = startWorker(["lock", dbPath, "400"]);
    await brief.next((m) => m.locked);
    const patient = store.openCodeIndex(storage);
    const waited = await patient.indexFile(repo, rev2, "src/a.ts");
    check(waited.state === "ok", `a 400 ms lock was not waited out: ${canonical(waited)}`);
    patient.close();
    await brief.exited;

    // A long one leaves the index unavailable.
    const long = startWorker(["lock", dbPath, "4000"]);
    await long.next((m) => m.locked);
    const impatient = store.openCodeIndex(storage, { busyTimeoutMs: 200 });
    const tree = await impatient.indexTree(repo, rev2);
    check(tree.state === "unavailable", `indexTree under a lock: ${canonical(tree)}`);
    const file = await impatient.indexFile(repo, rev2, "bin/run.py");
    check(file.state === "unavailable", `indexFile under a lock: ${canonical(file)}`);
    const read = impatient.blob(blobSha(repo, rev2, "src/same.ts"), "typescript");
    check(read.state === "unavailable", `blob under a lock: ${canonical(read).slice(0, 200)}`);
    check(corruptLeftovers(dir).length === 0, `a locked sidecar was set aside: ${corruptLeftovers(dir).join(", ")}`);
    check(statSync(dbPath).ino === inode, "a locked sidecar was replaced");
    impatient.close();
    await long.exited;

    // A file this process may not read.
    if (process.getuid?.() !== 0) {
      chmodSync(dbPath, 0o000);
      const denied = store.openCodeIndex(storage);
      const r = await denied.indexFile(repo, rev2, "src/same.ts");
      chmodSync(dbPath, 0o644);
      check(r.state === "unavailable", `an unreadable sidecar: ${canonical(r)}`);
      check(corruptLeftovers(dir).length === 0, `an unreadable sidecar was set aside: ${corruptLeftovers(dir).join(", ")}`);
      check(statSync(dbPath).ino === inode, "an unreadable sidecar was replaced");
      denied.close();
    }
    const after = store.openCodeIndex(storage);
    check(after.blob(blobSha(repo, rev2, "src/same.ts"), "typescript").indexed === true, "the sidecar lost its rows");
    after.close();

    // A storage directory this process may not write: opening does not throw, and each
    // request is unavailable.
    if (process.getuid?.() !== 0) {
      const readOnly = newStorage("read-only");
      chmodSync(readOnly, 0o555);
      let opened;
      let threw = null;
      try {
        opened = store.openCodeIndex(readOnly);
      } catch (e) {
        threw = e;
      }
      const r = opened ? await opened.indexFile(repo, rev2, "src/same.ts") : null;
      opened?.close();
      chmodSync(readOnly, 0o755);
      check(threw === null, `opening an index in an unwritable storage directory threw ${threw?.code ?? threw}`);
      check(r?.state === "unavailable", `a request in an unwritable storage directory: ${canonical(r)}`);
    }
  });
}

let status;
try {
  await main();
  const failed = results.filter((r) => !r.ok);
  if (results.length === 0) status = "GATE SI4 RED: no check ran";
  else if (failed.length) status = `GATE SI4 RED: ${failed.length} of ${results.length} checks failed; first: ${failed[0].name}: ${failed[0].message}`;
  else status = "GATE SI4 GREEN";
} catch (e) {
  const message = e instanceof GateFailure ? e.message : `the gate stopped: ${String(e?.message ?? e).split("\n")[0]}`;
  status = `GATE SI4 RED: ${message}`;
} finally {
  try {
    for (const p of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (p.isFile() && p.name === "index.db") chmodSync(join(p.parentPath ?? p.path, p.name), 0o644);
    }
  } catch {}
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // A worker still exiting; the temporary directory is left for the OS.
  }
}
console.log(status.replace(/\s+/g, " ").slice(0, 600));
process.exit(status === "GATE SI4 GREEN" ? 0 : 1);
