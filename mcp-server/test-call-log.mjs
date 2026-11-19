#!/usr/bin/env node
// GATE CL1 (design/self-observability/README.md §4, layer A): the dispatcher
// records every tool call without the model's cooperation.
//
// Red before layer A (no sidecar exists); green when:
//   1. every call, of every exercised outcome class, yields exactly one row,
//      in call order, with the expected outcome, rule id and throw site;
//   2. calls made before the record opens are queued and written, not lost;
//   3. no argument value is stored: a distinctive string appears nowhere in
//      the sidecar, even when a refusal echoes it back in its message, and the
//      stored digest is the canonical one;
//   4. each row carries the session in force across the call, including the
//      session that end_session closes;
//   5. the sidecar never reaches the storage repository's history: not with
//      its own ignore file, not with that file blanked (the commit pathspec
//      holds), and recording is refused when history already tracks it;
//   6. the record (`memory.db`) gains no call-log table;
//   7. rows queued while another process holds the sidecar's write lock are
//      kept and written once the lock is released;
//   8. AMANUENSIS_CALL_LOG=off records nothing.
//
// The `exception` class is not exercised: no tool can be made to throw a
// non-ToolError on demand without a test hook in the product. Storage
// migration's exclusion of the sidecar (`storageManifest`) is not exercised
// here either; test-workspace-binding.mjs covers migration itself.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const root = mkdtempSync(join(tmpdir(), "amanuensis-call-log-"));
const workspace = join(root, "workspace");
const storage = join(root, "storage");
mkdirSync(workspace, { recursive: true });
mkdirSync(storage, { recursive: true });
spawnSync("git", ["init", "-q", workspace]);

let failures = 0;
function check(name, fn) {
  let problem;
  try {
    problem = fn();
  } catch (e) {
    problem = `threw: ${e?.stack || e}`;
  }
  if (problem) {
    failures++;
    console.log(`  FAIL ${name}: ${problem}`);
  } else {
    console.log(`  ok   ${name}`);
  }
}

function startServer(extraEnv = {}) {
  const env = { ...process.env, AMANUENSIS_STORAGE_ROOT: storage, ...extraEnv };
  // The host's own workspace variables must not leak into the subject.
  delete env.CLAUDE_PROJECT_DIR;
  delete env.AMANUENSIS_WORKSPACE;
  if (!("AMANUENSIS_CALL_LOG" in extraEnv)) delete env.AMANUENSIS_CALL_LOG;
  const child = spawn(
    process.execPath,
    ["dist/index.js", "--workspace", workspace, "--allow-workspace-pin"],
    { env, stdio: ["pipe", "pipe", "pipe"] },
  );
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
          if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error)));
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
        reject(new Error(`timed out on ${method}; stderr=${stderr}`));
      }, 20_000);
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
  const call = async (name, args) => {
    const result = await request("tools/call", { name, arguments: args });
    return JSON.parse(result.content[0].text);
  };
  const init = async () => {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "amanuensis-call-log-gate", version: "7" },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
  };
  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      child.stdin.end();
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    });
  return { init, call, stop, stderr: () => stderr };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function readSidecar(path, sql, params = []) {
  const db = new Database(path, { readonly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

function storageTracked(storagePath) {
  const listed = spawnSync("git", ["ls-files"], { cwd: storagePath, encoding: "utf8" });
  if (listed.status !== 0) throw new Error(`ls-files failed: ${listed.stderr}`);
  return listed.stdout
    .split("\n")
    .filter((line) => line.startsWith("call-log"))
    .join(", ");
}

const MARKER = "call-log-gate-marker-0b7c";
const LONG_LABEL = `${MARKER} ${"x".repeat(600)}`;
// A thrown refusal is located by file and line in the build; nothing else.
const SITE = /^[\w./-]+\.js:\d+$/;

try {
  console.log("GATE CL1: the call log");
  const server = startServer();
  await server.init();

  // Each entry: the call, then the row it must produce. The first two run
  // before anything opens the record, so they exercise the queue. `site` is
  // true where the refusal was thrown and so must carry a site.
  const plan = [
    { tool: "no_such_tool", args: {}, outcome: "validation", rule: "protocol.unknown-tool" },
    { tool: "add_evidence", args: { marker: MARKER }, outcome: "validation", rule: /^schema\./ },
    {
      tool: "commit_phase_gate",
      args: { label: MARKER },
      outcome: "refusal",
      rule: "session.required",
      site: true,
    },
    { tool: "list_subsystems", args: {}, outcome: "ok", rule: null },
    { tool: "start_session", args: { intent: "call log gate" }, outcome: "ok", rule: null },
    {
      tool: "commit_phase_gate",
      args: { label: LONG_LABEL },
      outcome: "refusal",
      rule: "storage-commit.label",
      site: true,
    },
    { tool: "commit_phase_gate", args: { label: "ct1 gate" }, outcome: "ok", rule: null },
    { tool: "end_session", args: { outcome: "completed" }, outcome: "ok", rule: null },
    // A returned refusal that echoes its argument: "unknown session: <marker>".
    {
      tool: "end_session",
      args: { session_id: MARKER, outcome: "completed" },
      outcome: "refusal",
      rule: null,
    },
  ];
  const responses = [];
  for (const step of plan) responses.push(await server.call(step.tool, step.args));
  const info = await server.call("get_project_info", { workspace });
  plan.push({ tool: "get_project_info", args: { workspace }, outcome: "ok", rule: null });
  responses.push(info);
  await server.stop();

  const storagePath = info.storage_path;
  const callLogDir = join(storagePath, "call-log");
  const sidecar = join(callLogDir, "calls.db");
  const sessionId = responses[4]?.session_id;

  check("the sidecar exists under the storage directory", () =>
    existsSync(sidecar) ? null : `no ${sidecar}; stderr=${server.stderr()}`,
  );
  check("the plan's calls behaved as the plan assumes", () => {
    if (typeof sessionId !== "string")
      return `start_session returned ${JSON.stringify(responses[4])}`;
    if (responses[6]?.ok === false) return `commit_phase_gate: ${JSON.stringify(responses[6])}`;
    if (responses[7]?.ok !== true) return `end_session: ${JSON.stringify(responses[7])}`;
    if (!String(responses[8]?.error ?? "").includes(MARKER)) {
      return `the echoing refusal did not echo: ${JSON.stringify(responses[8])}`;
    }
    return null;
  });

  const rows = readSidecar(sidecar, "SELECT * FROM call_log ORDER BY seq");
  const connections = readSidecar(sidecar, "SELECT * FROM call_log_connections");

  check("one row per call, in call order", () => {
    if (rows.length !== plan.length) return `${rows.length} rows for ${plan.length} calls`;
    const tools = rows.map((r) => r.tool).join(",");
    const expected = plan.map((p) => p.tool).join(",");
    return tools === expected ? null : `order ${tools} != ${expected}`;
  });
  check("each row carries the expected outcome and rule id", () => {
    const bad = [];
    plan.forEach((p, i) => {
      const r = rows[i];
      if (!r) return;
      const ruleOk = p.rule instanceof RegExp ? p.rule.test(r.rule ?? "") : r.rule === p.rule;
      if (r.outcome !== p.outcome || !ruleOk) {
        bad.push(`${i}:${p.tool} got ${r.outcome}/${r.rule}, want ${p.outcome}/${p.rule}`);
      }
    });
    return bad.length ? bad.join("; ") : null;
  });
  check("thrown refusals carry a value-free site; other rows carry none", () => {
    const bad = [];
    plan.forEach((p, i) => {
      const site = rows[i]?.site ?? null;
      if (p.site ? !SITE.test(site ?? "") : site !== null) bad.push(`${i}:${p.tool} site=${site}`);
    });
    return bad.length ? bad.join("; ") : null;
  });
  check("the label refusal is sited in the commit gate, not in Git prose", () => {
    const site = rows[5]?.site ?? "";
    return site.startsWith("tools/storage-history.js:") ? null : `site ${site}`;
  });
  check("calls before the record opened were queued and written", () =>
    rows[0]?.tool === "no_such_tool" && rows[1]?.tool === "add_evidence"
      ? null
      : "first rows missing",
  );
  check("each row carries the session in force across the call", () => {
    const want = plan.map((_, i) => (i >= 4 && i <= 7 ? sessionId : null));
    const got = rows.map((r) => r.session_id);
    return JSON.stringify(got) === JSON.stringify(want)
      ? null
      : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`;
  });
  check("argument digests are canonical SHA-256 and sizes are recorded", () => {
    const bad = [];
    plan.forEach((p, i) => {
      const text = canonical(p.args);
      const sha = createHash("sha256").update(text).digest("hex");
      if (rows[i]?.args_sha256 !== sha) bad.push(`${i} digest`);
      if (rows[i]?.args_bytes !== Buffer.byteLength(text)) bad.push(`${i} bytes`);
    });
    return bad.length ? bad.join(", ") : null;
  });
  check("latency and response size are recorded", () => {
    const bad = rows.filter((r) => !(r.latency_ms >= 0) || !(r.response_bytes > 0));
    return bad.length ? `rows ${bad.map((r) => r.seq).join(",")}` : null;
  });
  check("no argument value is stored, even one a refusal echoed", () => {
    const files = ["calls.db", "calls.db-wal"].map((f) => join(callLogDir, f));
    const hit = files.filter((f) => existsSync(f) && readFileSync(f).includes(MARKER));
    return hit.length ? `marker found in ${hit.join(", ")}` : null;
  });
  check("the connection records the client and server identity", () => {
    if (connections.length !== 1) return `${connections.length} connections`;
    const c = connections[0];
    if (c.client_name !== "amanuensis-call-log-gate" || c.client_version !== "7") {
      return `client ${c.client_name}@${c.client_version}`;
    }
    return c.server_version ? null : "no server version";
  });
  check("the sidecar is ignored and untracked by the storage repository", () => {
    const ignore = readFileSync(join(callLogDir, ".gitignore"), "utf8");
    if (ignore !== "*\n") return `.gitignore is ${JSON.stringify(ignore)}`;
    const tracked = storageTracked(storagePath);
    return tracked ? `tracked: ${tracked}` : null;
  });
  check("the record itself gains no call-log table", () => {
    const names = readSidecar(
      join(storagePath, "memory.db"),
      "SELECT name FROM sqlite_master WHERE name LIKE 'call_log%'",
    ).map((r) => r.name);
    return names.length ? names.join(", ") : null;
  });

  // 8 and 5: with the call log off and the sidecar's ignore file blanked, a
  // storage commit must still leave the sidecar out of history (pathspec),
  // and nothing is recorded.
  const countCalls = () => readSidecar(sidecar, "SELECT COUNT(*) AS n FROM call_log")[0].n;
  const countConnections = () =>
    readSidecar(sidecar, "SELECT COUNT(*) AS n FROM call_log_connections")[0].n;
  const callsBefore = countCalls();
  writeFileSync(join(callLogDir, ".gitignore"), "", "utf8");
  const quiet = startServer({ AMANUENSIS_CALL_LOG: "off" });
  await quiet.init();
  await quiet.call("start_session", { intent: "quiet" });
  const quietCommit = await quiet.call("commit_phase_gate", { label: "quiet gate" });
  await quiet.call("no_such_tool", {});
  await quiet.stop();
  check("a storage commit leaves the sidecar out even with its ignore file blank", () => {
    if (quietCommit?.ok === false) return `commit refused: ${JSON.stringify(quietCommit)}`;
    const tracked = storageTracked(storagePath);
    return tracked ? `tracked: ${tracked}` : null;
  });
  check("AMANUENSIS_CALL_LOG=off records nothing", () => {
    const calls = countCalls();
    const conns = countConnections();
    return calls === callsBefore && conns === 1 ? null : `${calls} calls, ${conns} connections`;
  });

  // 7: hold the write lock from this process, first before the server has
  // opened the sidecar (a busy open) and then after (a busy write). The server
  // must not wait for it, and must write what it queued once it is released.
  const locker = new Database(sidecar);
  const busy = startServer();
  await busy.init();
  let lockedMs = 0;
  const underLock = async (calls) => {
    locker.exec("BEGIN IMMEDIATE");
    const at = Date.now();
    for (let i = 0; i < calls; i++) await busy.call("list_subsystems", {});
    lockedMs = Math.max(lockedMs, Date.now() - at);
    locker.exec("COMMIT");
  };
  await underLock(2); // busy open
  await busy.call("list_subsystems", {}); // opens; writes 3
  await underLock(3); // busy write
  await busy.call("list_subsystems", {}); // writes 4
  locker.close();
  await busy.stop();
  check("a locked sidecar neither fails the calls nor loses their rows", () => {
    const conn = readSidecar(
      sidecar,
      "SELECT connection_id FROM call_log_connections ORDER BY started_at DESC LIMIT 1",
    )[0]?.connection_id;
    const n = readSidecar(
      sidecar,
      "SELECT COUNT(*) AS n FROM call_log WHERE connection_id = ?",
      [conn],
    )[0].n;
    if (countConnections() !== 2)
      return `${countConnections()} connections; stderr=${busy.stderr()}`;
    return n === 7 ? null : `${n} of 7 rows written; stderr=${busy.stderr()}`;
  });
  check("calls under a held lock are not slowed by it", () =>
    // Three calls; a 250 ms wait per call would put this near a second.
    lockedMs < 600 ? null : `three calls took ${lockedMs} ms`,
  );
  check("a server with the call log on restores the sidecar's ignore file", () => {
    const ignore = readFileSync(join(callLogDir, ".gitignore"), "utf8");
    return ignore === "*\n" ? null : `.gitignore is ${JSON.stringify(ignore)}`;
  });

  // 5: once history tracks the sidecar, recording is refused.
  spawnSync("git", ["add", "-f", "call-log/calls.db"], { cwd: storagePath });
  spawnSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "track",
    ],
    { cwd: storagePath },
  );
  const trackedBefore = countCalls();
  const refused = startServer();
  await refused.init();
  await refused.call("list_subsystems", {});
  await refused.stop();
  check("recording is refused when history already tracks the sidecar", () => {
    if (!storageTracked(storagePath)) return "setup: the sidecar did not become tracked";
    if (countCalls() !== trackedBefore) return `${countCalls() - trackedBefore} rows written`;
    return /tracked by the storage repository/.test(refused.stderr())
      ? null
      : `no refusal on stderr: ${refused.stderr()}`;
  });
} catch (e) {
  failures++;
  console.log(`  FAIL harness: ${e?.stack || e}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures) {
  console.log(`GATE CL1 RED: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("GATE CL1 GREEN");
