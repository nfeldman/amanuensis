#!/usr/bin/env node
// Gate for reader-lenses packet P16 — snapshot, discard, and reinitialize the
// self-conspectus store (spec.md §12.1 steps 1–5, §12.3; claims C52, C55, C63).
//
// Two arms, because the subject has two halves. The *procedure* is behaviour and
// is executed here for real against throwaway server processes, so CI runs it on
// every push. The *live run over this repository's own store* is a past event; it
// is recorded in a committed receipt, because the store is untracked
// (`git ls-files .amanuensis` → 0) and a gate that read it would be green by
// absence anywhere else — the zero-denominator failure this repository has
// already recorded three times (VP4).
//
// Turns red when:
//   - `commit_phase_gate` does not commit the storage directory before anything
//     is deleted, or the commit it makes is a label rather than a record: the
//     snapshot's `memory.db` blob must be a SQLite file carrying a row written
//     before the snapshot, which is what the pre-commit WAL checkpoint is for;
//   - the server process is not gone before the database files are removed —
//     the gate requires an observed exit *and* an ESRCH probe on the pid, since
//     a handle held across the deletion is what §12.1 exists to prevent;
//   - removing only `memory.db`, `-wal` and `-shm` is treated as a discard: the
//     completion marker survives that and names a missing database, so the next
//     open must fail rather than quietly serve a half-store;
//   - a new server process over the discarded storage does not reinitialize it:
//     `initialization.json` republished and matching the binding, both required
//     views created, `get_project_info` reporting the store live at the
//     worktree-local path;
//   - the read-back is not against an empty store: any dashboard census counter
//     is non-zero, or the pre-rebuild row survives the rebuild;
//   - the reinitialized store is a stale handle rather than a live one — a row
//     written through the new server is not visible to a third process opening
//     the same path;
//   - the snapshot stops being reachable from the rebuilt store after its git
//     history is carried across;
//   - `design/reader-lenses/rebuild-receipt.json` does not record the live run,
//     or records it inconsistently: a snapshot not taken before the deletion, a
//     process not stopped before it, a marker that does not name `memory.db`, a
//     dashboard census that is not empty, a storage path that is not
//     workspace-local;
//   - an A0 fixture under `dev/conspectus/` no longer hashes to what the live
//     run recorded (§12.3: the rebuild changes the live store and `docs/`, never
//     the historical baseline);
//   - the gate does not run in `.github/workflows/test.yml`.
//
// False greens it cannot exclude. The procedure arm runs against a throwaway
// workspace whose project identity is a local path, not this repository's
// remote; it proves the sequence is sound, not that it was followed here. That
// is what the receipt is for, and a receipt proves what was true when it was
// written — it cannot show that the live store has not been replaced since. Nor
// does an empty store prove a *good* rebuild: everything about whether the
// conspectus that follows is worth having belongs to P17 and P18. And the
// history-continuity assertion shows the snapshot is reachable, not that anyone
// could restore service from it under load.
//
// Output protocol: exactly one status line, last, on stdout. Every message is
// scrubbed of the launcher's crash signatures, so an absent deliverable reads as
// a failed assertion rather than as a gate that never ran.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SERVER_REL = "mcp-server/dist/index.js";
const DB_SOURCE_REL = "mcp-server/src/db.ts";
const RECEIPT_REL = "design/reader-lenses/rebuild-receipt.json";
const CI_REL = ".github/workflows/test.yml";

const RECEIPT_CONTRACT = "amanuensis-reader-lenses/rebuild-receipt/v1";
const MARKER_CONTRACT = "amanuensis-storage-initialization/v1";
// §12.1 step 3 names exactly these three; they are written out rather than read
// from the implementation so that dropping one from the discard cannot also
// drop it from what this gate expects to see removed.
const DB_FILES = ["memory.db", "memory.db-wal", "memory.db-shm"];
const MARKER_FILE = "initialization.json";
// §12.1 step 4's two views, named literally for the same reason.
const REQUIRED_VIEWS = ["file_standing", "finding_state_current"];
const SNAPSHOT_PREFIX = "Pre-rebuild snapshot";
// §12.3's immutable A0 historical fixture. The rebuild touches the live store
// and `docs/`; these are never rewritten.
const FIXTURES = [
  "dev/conspectus/self-baseline.json",
  "dev/conspectus/baseline-report.json",
  "dev/conspectus/baseline-report-detector-1.0.0.json",
  "dev/conspectus/detector-registry.json",
];
// The census `get_dashboard` reports. "Empty" is every one of them at zero, not
// merely the two a reader would think to look at.
const CENSUS_COUNTERS = [
  "subsystem_count",
  "mapped_count",
  "total_findings",
  "open_bugs",
  "stale_entries",
  "scoped_files",
  "open_field_notes",
  "unresolved_contradictions",
];

const PRE_CANARY = "P16-PRE-REBUILD-CANARY";
const POST_CANARY = "P16-POST-REBUILD-CANARY";

// ---------------------------------------------------------------------------
// Output funnel. Nothing reaches stdout except through emit(), and everything is
// scrubbed of the launcher's crash signatures so that a genuine assertion
// failure is never mistaken for a gate that never ran.
// ---------------------------------------------------------------------------
const SCRUB = [
  [/MODULE_NOT_FOUND/g, "module-absent"],
  [/ModuleNotFoundError/g, "python-module-absent"],
  [/Cannot find module/g, "cannot load module"],
  [/No such file or directory/g, "path is absent"],
  [/No such file/g, "path is absent"],
  [/can't open file/g, "cannot open path"],
  [/SyntaxError/g, "syntax-error"],
  [/ImportError/g, "python-import-error"],
  [/ReferenceError/g, "reference-error"],
  [/TypeError/g, "type-error"],
  [/ENOENT/g, "PATH-ABSENT"],
  [/is not defined/g, "is undeclared"],
  [/is not a function/g, "is not callable"],
  [/command not found/g, "executable is absent"],
];

function scrub(text) {
  let out = String(text ?? "");
  for (const [pattern, replacement] of SCRUB) out = out.replace(pattern, replacement);
  return out;
}

function emit(line) {
  process.stdout.write(`${scrub(line)}\n`);
}

const failures = [];
async function check(label, fn) {
  let reason = null;
  try {
    reason = await fn();
  } catch (e) {
    reason = `threw while checking — ${e && e.message ? e.message : e}`;
  }
  if (reason) {
    failures.push(`${label}: ${reason}`);
    emit(`  FAIL ${label}: ${reason}`);
  } else {
    emit(`  ok   ${label}`);
  }
}

function readText(absPath) {
  if (!existsSync(absPath)) return null;
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

const scratchDirs = [];
function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

function sha256(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

// `get_storage_history` abbreviates; `commit_phase_gate` returns the short sha.
// Compare on the shorter of the two so a full sha and its abbreviation match.
function sameCommit(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (!/^[0-9a-f]{7,40}$/.test(left) || !/^[0-9a-f]{7,40}$/.test(right)) return false;
  const length = Math.min(left.length, right.length);
  return left.slice(0, length) === right.slice(0, length);
}

// ---------------------------------------------------------------------------
// A minimal MCP stdio client. The procedure arm has to cross real process
// boundaries — that is the whole point of §12.1 — so it drives spawned server
// processes over the protocol rather than importing handlers.
// ---------------------------------------------------------------------------
function client(workspace) {
  const child = spawn(
    process.execPath,
    [join(REPO, SERVER_REL), "--workspace", workspace, "--allow-workspace-pin"],
    {
      cwd: REPO,
      env: { ...process.env, AMANUENSIS_AUTOPROGRESS: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let buffer = "";
  let stderr = "";
  let spawnError = null;
  let nextId = 1;
  const pending = new Map();
  const failAll = (error) => {
    for (const [id, waiter] of pending) {
      pending.delete(id);
      waiter.reject(error);
    }
  };
  child.on("error", (error) => {
    spawnError = error;
    failAll(error);
  });
  child.on("exit", () =>
    failAll(new Error(`the server process exited; stderr=${stderr.slice(-400)}`)),
  );
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.stdout.on("data", (chunk) => {
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
    if (spawnError) return Promise.reject(spawnError);
    const id = nextId++;
    const response = new Promise((res, rej) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error(`timed out waiting for ${method}; stderr=${stderr.slice(-400)}`));
      }, 30_000);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          res(value);
        },
        reject(error) {
          clearTimeout(timer);
          rej(error);
        },
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return response;
  };

  return {
    child,
    pid: child.pid,
    request,
    stderr: () => stderr,
    async handshake() {
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "p16-rebuild-readback", version: "1" },
      });
      const initialized = { jsonrpc: "2.0", method: "notifications/initialized" };
      child.stdin.write(`${JSON.stringify(initialized)}\n`);
    },
    async call(name, args = {}) {
      const result = await request("tools/call", { name, arguments: args });
      let payload = null;
      try {
        payload = JSON.parse(result.content?.[0]?.text ?? "null");
      } catch {
        payload = null;
      }
      return { isError: result.isError === true, payload };
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      await new Promise((res) => child.once("exit", res));
    },
  };
}

function pidProbe(pid) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return error.code ?? "unknown";
  }
}

// ---------------------------------------------------------------------------
// Arm 1 — the procedure, executed. Steps 1–5 of §12.1 against a throwaway
// workspace, with the negative control the implementation forced into the
// design: a partial deletion is not a discard.
// ---------------------------------------------------------------------------
async function runProcedure() {
  const trace = { ran: false };
  if (!existsSync(join(REPO, SERVER_REL))) {
    trace.blocked = `the built server is absent at ${SERVER_REL}; run \`npm run build\` in mcp-server/`;
    return trace;
  }
  const root = scratch("p16-rebuild-");
  const workspace = join(root, "workspace");
  const storage = join(workspace, ".amanuensis");
  const archive = join(root, "archive");
  const init = spawnSync("git", ["init", "-q", workspace], { encoding: "utf8" });
  if (init.status !== 0) {
    trace.blocked = `could not create a throwaway git workspace: ${scrub(init.stderr ?? "").trim()}`;
    return trace;
  }

  // --- step 1: a populated store, then the snapshot ------------------------
  const a = client(workspace);
  try {
    await a.handshake();
    await a.call("start_session", { intent: "P16 rebuild read-back gate" });
    await a.call("upsert_subsystem", { id: "P16-PRE", name: PRE_CANARY });
    const snapshot = await a.call("commit_phase_gate", { label: `${SNAPSHOT_PREFIX} (gate)` });
    trace.snapshot = snapshot.payload;
    trace.snapshotErrored = snapshot.isError;
    const history = await a.call("get_storage_history", { limit: 5 });
    trace.history = history.payload;
    trace.entriesBeforeDiscard = existsSync(storage) ? readdirSync(storage).sort() : [];
    trace.dbBytesBeforeDiscard = existsSync(join(storage, "memory.db"))
      ? statSync(join(storage, "memory.db")).size
      : 0;
  } catch (error) {
    trace.blocked = `the first server could not populate and snapshot the store — ${scrub(error.message)}`;
    await a.stop();
    return trace;
  }

  // --- step 2: stop, and prove the process is gone -------------------------
  const pid = a.pid;
  await a.stop();
  trace.serverExited = a.child.exitCode !== null || a.child.signalCode !== null;
  trace.pidProbeAfterExit = pidProbe(pid);
  trace.filesPresentAtStop = DB_FILES.filter((name) => existsSync(join(storage, name)));

  // The snapshot as a record rather than a label: the committed blob must be a
  // SQLite file carrying a row written before the commit.
  const sha = trace.snapshot?.commit_sha;
  if (sha) {
    const show = spawnSync("git", ["-C", storage, "show", `${sha}:memory.db`], {
      encoding: "buffer",
      maxBuffer: 256 * 1024 * 1024,
    });
    trace.snapshotBlobBytes = show.status === 0 ? show.stdout.length : 0;
    trace.snapshotBlobIsSqlite =
      show.status === 0 && show.stdout.subarray(0, 15).toString("utf8") === "SQLite format 3";
    trace.snapshotCarriesCanary = show.status === 0 && show.stdout.includes(Buffer.from(PRE_CANARY));
  }
  cpSync(storage, archive, { recursive: true });

  // --- step 3a: the negative control — a partial deletion is not a discard --
  for (const name of DB_FILES) rmSync(join(storage, name), { force: true });
  trace.partial = { removed: [...DB_FILES], survivors: readdirSync(storage).sort() };
  const p = client(workspace);
  try {
    await p.handshake();
    const info = await p.call("get_project_info");
    trace.partial.projectInfoErrored = info.isError;
    trace.partial.projectInfoError = info.payload?.error ?? null;
    const dashboard = await p.call("get_dashboard");
    trace.partial.dashboardErrored = dashboard.isError;
    trace.partial.dashboardError = dashboard.payload?.error ?? null;
  } catch (error) {
    trace.partial.threw = scrub(error.message);
  }
  await p.stop();

  // --- step 3b: the discard, and step 4: a new process reinitializes --------
  rmSync(storage, { recursive: true, force: true });
  trace.storageRemoved = !existsSync(storage);
  const b = client(workspace);
  try {
    await b.handshake();
    const cold = await b.call("get_project_info");
    trace.coldProjectInfo = cold.payload;
    const dashboard = await b.call("get_dashboard");
    trace.dashboardErrored = dashboard.isError;
    trace.dashboard = dashboard.payload;
    const warm = await b.call("get_project_info");
    trace.projectInfo = warm.payload;
    const subsystems = await b.call("list_subsystems");
    trace.subsystemsAfterRebuild = Array.isArray(subsystems.payload) ? subsystems.payload : null;
    trace.marker = JSON.parse(readText(join(storage, MARKER_FILE)) ?? "null");
    trace.entriesAfterRebuild = readdirSync(storage).sort();
    // A write through the new server, read back by a third process: this is the
    // difference between a live store and a handle onto an unlinked inode.
    await b.call("start_session", { intent: "P16 post-rebuild read-back" });
    await b.call("upsert_subsystem", { id: "P16-POST", name: POST_CANARY });
  } catch (error) {
    trace.blocked = `the reinitialized store did not answer — ${scrub(error.message)}`;
    await b.stop();
    return trace;
  }
  await b.stop();

  // --- step 5: read back from a third process ------------------------------
  const c = client(workspace);
  try {
    await c.handshake();
    const subsystems = await c.call("list_subsystems");
    trace.thirdProcessSubsystems = Array.isArray(subsystems.payload) ? subsystems.payload : null;
  } catch (error) {
    trace.blocked = `a third server could not read the reinitialized store — ${scrub(error.message)}`;
    await c.stop();
    return trace;
  }
  await c.stop();

  // --- the snapshot stays reachable from the rebuilt store ------------------
  rmSync(join(storage, ".git"), { recursive: true, force: true });
  cpSync(join(archive, ".git"), join(storage, ".git"), { recursive: true });
  const d = client(workspace);
  try {
    await d.handshake();
    const history = await d.call("get_storage_history", { limit: 5 });
    trace.historyAfterRestore = history.payload;
  } catch (error) {
    trace.historyRestoreError = scrub(error.message);
  }
  await d.stop();
  if (sha) {
    const show = spawnSync("git", ["-C", storage, "show", `${sha}:memory.db`], {
      encoding: "buffer",
      maxBuffer: 256 * 1024 * 1024,
    });
    trace.restoredSnapshotCarriesCanary =
      show.status === 0 && show.stdout.includes(Buffer.from(PRE_CANARY));
  }

  // The views the reader surfaces read, in the store the rebuild produced.
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      'const D=require("better-sqlite3");const db=new D(process.argv[1],{readonly:true});' +
        'process.stdout.write(JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type=\'view\' ORDER BY name").all().map(r=>r.name)));',
      join(storage, "memory.db"),
    ],
    { cwd: join(REPO, "mcp-server"), encoding: "utf8" },
  );
  try {
    trace.views = probe.status === 0 ? JSON.parse(probe.stdout) : null;
  } catch {
    trace.views = null;
  }
  if (trace.views === null) trace.viewProbeError = scrub((probe.stderr ?? "").trim().slice(-300));

  trace.ran = true;
  return trace;
}

emit("P16 — snapshot, discard, and reinitialize the self-conspectus store");
emit("");
emit("§12.1 steps 1–5, executed against throwaway server processes");

const trace = await runProcedure();

await check("the storage directory is snapshotted before anything is deleted", () => {
  if (trace.blocked) return trace.blocked;
  if (trace.snapshotErrored) {
    return `commit_phase_gate refused: ${trace.snapshot?.error ?? "no reason given"}`;
  }
  if (trace.snapshot?.committed !== true) return "commit_phase_gate reported no commit";
  if (!/^[0-9a-f]{7,40}$/.test(trace.snapshot?.commit_sha ?? "")) {
    return `the snapshot has no commit sha: ${JSON.stringify(trace.snapshot?.commit_sha ?? null)}`;
  }
  const newest = trace.history?.commits?.[0];
  if (!newest || !String(newest.message ?? "").startsWith(SNAPSHOT_PREFIX)) {
    return `the storage history's newest commit is ${JSON.stringify(newest?.message ?? null)}, not the snapshot`;
  }
  if (!trace.filesPresentAtStop?.includes("memory.db")) {
    return "the database was already gone when the server stopped, so the snapshot did not precede the deletion";
  }
  return null;
});

await check("the snapshot is a recoverable record, not a label", () => {
  if (trace.blocked) return trace.blocked;
  if (!trace.snapshotBlobIsSqlite) {
    return `the snapshot's memory.db is not a SQLite file (${trace.snapshotBlobBytes ?? 0} bytes committed)`;
  }
  if (trace.snapshotCarriesCanary !== true) {
    return "the snapshot's memory.db does not carry the row written before it — the write-ahead log was not checkpointed into the committed file";
  }
  return null;
});

await check("the server process is stopped before the database files are removed", () => {
  if (trace.blocked) return trace.blocked;
  if (trace.serverExited !== true) return "the server process was still running when the deletion began";
  if (trace.pidProbeAfterExit !== "ESRCH") {
    return `the stopped server's pid is still addressable (${trace.pidProbeAfterExit}), so a handle may outlive the deletion`;
  }
  return null;
});

await check("removing only the database files is refused as a discard", () => {
  if (trace.blocked) return trace.blocked;
  if (trace.partial?.threw) return trace.partial.threw;
  if (!trace.partial?.survivors?.includes(MARKER_FILE)) {
    return `${MARKER_FILE} did not survive the partial deletion, so this control measures nothing`;
  }
  if (trace.partial.projectInfoErrored !== true || trace.partial.dashboardErrored !== true) {
    return "a storage whose completion marker names a missing database still answered get_project_info or get_dashboard";
  }
  const message = `${trace.partial.projectInfoError ?? ""} ${trace.partial.dashboardError ?? ""}`;
  if (!/completion marker/.test(message)) {
    return `the refusal does not name the storage marker: ${message.trim().slice(0, 160)}`;
  }
  return null;
});

await check("a new process reinitializes the discarded storage", () => {
  if (trace.blocked) return trace.blocked;
  if (trace.storageRemoved !== true) return "the storage directory survived the discard";
  if (trace.coldProjectInfo?.db_exists !== false) {
    return "get_project_info reported a database before the discarded storage had been reinitialized";
  }
  if (trace.projectInfo?.db_exists !== true) {
    return "get_project_info does not report a live database after the reinitialization";
  }
  const entries = trace.entriesAfterRebuild ?? [];
  if (!entries.includes("memory.db") || !entries.includes(MARKER_FILE)) {
    return `the reinitialized storage holds ${JSON.stringify(entries)}`;
  }
  return null;
});

await check("the reinitialized store's marker matches the repository binding", () => {
  if (trace.blocked) return trace.blocked;
  const marker = trace.marker;
  if (!marker || typeof marker !== "object") return `${MARKER_FILE} is not a JSON object`;
  if (marker.contractVersion !== MARKER_CONTRACT) {
    return `the storage marker declares ${JSON.stringify(marker.contractVersion)}, not ${MARKER_CONTRACT}`;
  }
  if (marker.database !== "memory.db") {
    return `the storage marker names ${JSON.stringify(marker.database)} as its database`;
  }
  if (marker.storagePolicy !== "worktree-local") {
    return `the storage marker declares policy ${JSON.stringify(marker.storagePolicy)}`;
  }
  if (marker.projectKey !== trace.projectInfo?.project_key) {
    return "the storage marker's project key disagrees with the store the server reports";
  }
  return null;
});

await check("initializeSchema leaves both reader views in the new store", () => {
  if (trace.blocked) return trace.blocked;
  if (trace.views === null) {
    return `the rebuilt store could not be read for its views: ${trace.viewProbeError ?? "no diagnostic"}`;
  }
  const absent = REQUIRED_VIEWS.filter((name) => !trace.views.includes(name));
  if (absent.length) return `the reinitialized store is missing view(s): ${absent.join(", ")}`;
  const source = readText(join(REPO, DB_SOURCE_REL)) ?? "";
  const unnamed = REQUIRED_VIEWS.filter((name) => !source.includes(`"${name}"`));
  if (unnamed.length) {
    return `${DB_SOURCE_REL} no longer requires view(s) on open: ${unnamed.join(", ")}`;
  }
  return null;
});

await check("get_project_info and get_dashboard answer against an empty store", () => {
  if (trace.blocked) return trace.blocked;
  if (trace.dashboardErrored) {
    return `get_dashboard refused: ${trace.dashboard?.error ?? "no reason given"}`;
  }
  const dashboard = trace.dashboard ?? {};
  const populated = CENSUS_COUNTERS.filter((key) => Number(dashboard[key] ?? 0) !== 0);
  if (populated.length) {
    return `the store is not empty: ${populated.map((k) => `${k}=${dashboard[k]}`).join(", ")}`;
  }
  if (trace.subsystemsAfterRebuild === null) return "list_subsystems did not answer with a list";
  if (trace.subsystemsAfterRebuild.some((row) => row.name === PRE_CANARY)) {
    return "the pre-rebuild row survived the discard, so the store was never emptied";
  }
  return null;
});

await check("the reinitialized store is live, not a stale handle", () => {
  if (trace.blocked) return trace.blocked;
  const rows = trace.thirdProcessSubsystems;
  if (rows === null) return "a third server process did not answer list_subsystems with a list";
  if (!rows.some((row) => row.name === POST_CANARY)) {
    return "a row written through the reinitialized store is invisible to another process opening the same path";
  }
  if (rows.some((row) => row.name === PRE_CANARY)) {
    return "the discarded store's rows are still being served";
  }
  return null;
});

await check("the snapshot stays reachable from the rebuilt store", () => {
  if (trace.blocked) return trace.blocked;
  if (trace.historyRestoreError) return trace.historyRestoreError;
  const commits = trace.historyAfterRestore?.commits ?? [];
  const reached = commits.find((commit) => sameCommit(commit.sha, trace.snapshot?.commit_sha));
  if (!reached || !String(reached.message ?? "").startsWith(SNAPSHOT_PREFIX)) {
    return `the rebuilt store's history does not reach the snapshot: ${JSON.stringify(commits.map((c) => c.message))}`;
  }
  if (trace.restoredSnapshotCarriesCanary !== true) {
    return "the snapshot commit no longer yields the pre-rebuild database";
  }
  return null;
});

// ---------------------------------------------------------------------------
// Arm 2 — the live run over this repository's own store, as recorded.
// ---------------------------------------------------------------------------
emit("");
emit("the live run over this repository's store, as recorded in the receipt");

const receiptText = readText(join(REPO, RECEIPT_REL));
let receipt = null;
if (receiptText !== null) {
  try {
    receipt = JSON.parse(receiptText);
  } catch {
    receipt = null;
  }
}

function requireReceipt() {
  if (receiptText === null) {
    return `${RECEIPT_REL} is absent: the live snapshot, discard and reinitialized read-back are unrecorded`;
  }
  if (receipt === null) return `${RECEIPT_REL} is not valid JSON`;
  return null;
}

await check("the receipt declares its contract and the packet that wrote it", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  if (receipt.contract !== RECEIPT_CONTRACT) {
    return `the receipt declares ${JSON.stringify(receipt.contract)}, not ${RECEIPT_CONTRACT}`;
  }
  if (receipt.packet !== "P16") return `the receipt names packet ${JSON.stringify(receipt.packet)}`;
  if (!/^[0-9a-f]{7,40}$/.test(receipt.repository_sha ?? "")) {
    return "the receipt does not bind itself to a repository revision";
  }
  if (typeof receipt.storage_path !== "string" || !receipt.storage_path.endsWith("/.amanuensis")) {
    return `the receipt's storage path is not a workspace-local store: ${JSON.stringify(receipt.storage_path ?? null)}`;
  }
  const inside =
    typeof receipt.workspace_path === "string" &&
    receipt.storage_path.startsWith(`${receipt.workspace_path}/`);
  if (!inside) {
    return "the receipt's storage path does not sit inside the workspace it names";
  }
  return null;
});

await check("the receipt states what the store held before the rebuild", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const pre = receipt.pre_rebuild;
  if (!pre || typeof pre.store_present !== "boolean" || typeof pre.db_exists !== "boolean") {
    return "the receipt does not say whether a store was present before the rebuild";
  }
  if (!Array.isArray(pre.storage_entries)) {
    return "the receipt does not list what the storage directory held before the rebuild";
  }
  if (pre.store_present === false && !String(pre.note ?? "").trim()) {
    return "the receipt reports no pre-rebuild store and does not say so in words";
  }
  return null;
});

await check("the receipt's snapshot precedes its deletion", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const snapshot = receipt.snapshot ?? {};
  if (snapshot.tool !== "commit_phase_gate") {
    return `the snapshot was taken with ${JSON.stringify(snapshot.tool ?? null)}, not commit_phase_gate`;
  }
  if (!String(snapshot.label ?? "").startsWith(SNAPSHOT_PREFIX)) {
    return `the snapshot's label is ${JSON.stringify(snapshot.label ?? null)}`;
  }
  if (snapshot.committed !== true || !/^[0-9a-f]{7,40}$/.test(snapshot.commit_sha ?? "")) {
    return "the recorded snapshot did not commit";
  }
  if (snapshot.taken_before_deletion !== true) {
    return "the receipt does not record the snapshot as preceding the deletion";
  }
  return null;
});

await check("the receipt's server was stopped before the store was removed", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const stop = receipt.stop ?? {};
  if (!Number.isInteger(stop.server_pid)) return "the receipt does not identify the stopped server process";
  if (stop.exited_before_deletion !== true) {
    return "the receipt does not record the server as stopped before the deletion";
  }
  if (stop.pid_probe_after_exit !== "ESRCH") {
    return `the stopped server's pid probe recorded ${JSON.stringify(stop.pid_probe_after_exit ?? null)}, not ESRCH`;
  }
  return null;
});

await check("the receipt's discard removed the database files and the marker with them", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const discard = receipt.discard ?? {};
  if (!Array.isArray(discard.removed)) return "the receipt does not list what was removed";
  const unremoved = DB_FILES.filter((name) => !discard.removed.includes(name));
  if (unremoved.length) return `the receipt does not record removing ${unremoved.join(", ")}`;
  if (discard.removed_storage_directory !== true) {
    return "the receipt records a partial deletion, which leaves the storage marker naming a missing database";
  }
  if (!String(discard.reason ?? "").trim()) return "the receipt does not say why the whole directory went";
  return null;
});

await check("the receipt's reinitialized store carries both views and a valid marker", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const reinit = receipt.reinitialize ?? {};
  const views = Array.isArray(reinit.views_created) ? reinit.views_created : [];
  const absent = REQUIRED_VIEWS.filter((name) => !views.includes(name));
  if (absent.length) return `the reinitialized store is recorded without view(s): ${absent.join(", ")}`;
  const marker = reinit.marker ?? {};
  if (marker.contractVersion !== MARKER_CONTRACT || marker.database !== "memory.db") {
    return "the recorded storage marker does not match the initialization contract";
  }
  if (marker.storagePolicy !== "worktree-local" || marker.canonicalRoot !== receipt.workspace_path) {
    return "the recorded storage marker is not bound to the workspace the receipt names";
  }
  if (reinit.marker_validates !== true) return "the receipt does not record the storage marker as validated";
  return null;
});

await check("the receipt's read-back answered against an empty store", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const readback = receipt.readback ?? {};
  const info = readback.get_project_info ?? {};
  if (info.db_exists !== true) return "the recorded get_project_info does not report a live database";
  if (info.storage_path !== receipt.storage_path) {
    return "the recorded get_project_info answered about a different store";
  }
  const dashboard = readback.get_dashboard ?? {};
  const absent = CENSUS_COUNTERS.filter((key) => typeof dashboard[key] !== "number");
  if (absent.length) return `the recorded get_dashboard omits ${absent.join(", ")}`;
  const populated = CENSUS_COUNTERS.filter((key) => dashboard[key] !== 0);
  if (populated.length) {
    return `the recorded read-back is not against an empty store: ${populated.map((k) => `${k}=${dashboard[k]}`).join(", ")}`;
  }
  return null;
});

await check("the receipt's storage history still reaches the snapshot", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const restored = receipt.history_restored ?? {};
  if (!sameCommit(restored.snapshot_sha, receipt.snapshot?.commit_sha)) {
    return "the recorded history names a different snapshot than the one the receipt took";
  }
  const commits = Array.isArray(restored.commits) ? restored.commits : [];
  const reached = commits.find((commit) => sameCommit(commit.sha, restored.snapshot_sha));
  if (!reached || !String(reached.message ?? "").startsWith(SNAPSHOT_PREFIX)) {
    return `the rebuilt store's recorded history does not reach the snapshot: ${JSON.stringify(
      commits.map((commit) => commit.message),
    )}`;
  }
  return null;
});

await check("the A0 fixture under dev/conspectus/ is unchanged (§12.3)", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const recorded = receipt.fixtures_unchanged?.digests;
  if (!recorded || typeof recorded !== "object") {
    return "the receipt records no digest for the historical A0 fixture";
  }
  const unrecorded = FIXTURES.filter((path) => !/^[0-9a-f]{64}$/.test(recorded[path] ?? ""));
  if (unrecorded.length) return `the receipt records no sha256 for ${unrecorded.join(", ")}`;
  const drifted = [];
  for (const path of FIXTURES) {
    const abs = join(REPO, path);
    if (!existsSync(abs)) {
      drifted.push(`${path} is gone`);
      continue;
    }
    if (sha256(abs) !== recorded[path]) drifted.push(`${path} was rewritten`);
  }
  return drifted.length ? drifted.join("; ") : null;
});

await check("the gate runs in CI", () => {
  const ci = readText(join(REPO, CI_REL));
  if (ci === null) return `${CI_REL} is absent`;
  return ci.includes("node dev/test-rebuild-readback.mjs") ? null : "the gate is not run in CI";
});

// ---------------------------------------------------------------------------
for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });

emit("");
if (failures.length) {
  emit(
    `GATE P16 RED: the self-conspectus store was not snapshotted, discarded and reinitialized as §12.1 requires — ${failures.length} failed assertion(s) across the procedure, the storage marker, the empty store read-back and the reinitialized store's receipt; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("GATE P16 GREEN");
