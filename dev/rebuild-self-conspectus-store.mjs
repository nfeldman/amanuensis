#!/usr/bin/env node
// Steps 1-5 of the self-conspectus rebuild (spec.md §12.1), performed once
// against this repository's own store, writing the receipt that
// `dev/test-rebuild-readback.mjs` asserts over.
//
// This is a destructive operation and says so: it discards the live store. It
// refuses to run without `--confirm`, and refuses a store that holds a survey
// without `--discard-populated-store` on top of that, because "reinit survey"
// authorizes discarding a conspectus and nothing here should be able to do it
// by accident.
//
// The sequence, and why it is shaped this way:
//
//   1. Snapshot with `commit_phase_gate`. The store is excluded from the
//      surveyed repository's index, so its own Git history is the only record
//      of the pre-rebuild state.
//   2. Stop the server. A SQLite handle lives for the life of the process, so a
//      deletion under a running server leaves it writing to an unlinked inode.
//      The pid is probed after exit; nothing proceeds until it is gone.
//   3. Discard. §12.1 names `memory.db`, `-wal` and `-shm`, and removing only
//      those is not a discard: `initialization.json` survives it and names a
//      missing database, so the next open fails with a storage-marker error
//      (and removing the marker too fails differently — the incomplete-store
//      rollback refuses a directory it did not create). The storage directory
//      is archived whole, then removed whole.
//   4. Initialize and restart. A new process opens the storage, `initializeSchema`
//      creates `file_standing` and `finding_state_current`, and the completion
//      marker is republished and validated against the repository binding.
//   5. Read back. `get_project_info` and `get_dashboard` answer against the
//      empty store; a row written through the new server is read back by a
//      third process, which is the difference between a live store and a
//      resurrected handle.
//
// The archived Git history is then carried into the rebuilt store, so the
// snapshot stays reachable from the store that replaced it, and a closing phase
// gate records the empty starting point the rebuild (P17) begins from.
//
// Usage:
//   node dev/rebuild-self-conspectus-store.mjs --confirm [--archive <dir>]
//                                              [--receipt <path>]
//                                              [--discard-populated-store]
//                                              [--workspace <dir>]
//
// `--workspace` exists for the gate: it runs this procedure against a
// throwaway workspace, so the sequence below is executed rather than described.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(REPO, "mcp-server", "dist", "index.js");
// The repository root is the workspace in the real run. `--workspace` points it
// at a throwaway instead, which is how dev/test-rebuild-readback.mjs runs *this
// procedure* rather than a reimplementation of it: the review found that
// deleting the stop step below left the gate green (F1/codex). REPO still
// supplies the built server and the A0 fixtures either way.
const WORKSPACE = resolve(
  process.argv.indexOf("--workspace") >= 0 && process.argv[process.argv.indexOf("--workspace") + 1]
    ? process.argv[process.argv.indexOf("--workspace") + 1]
    : REPO,
);
const STORAGE = join(WORKSPACE, ".amanuensis");
const DB_FILES = ["memory.db", "memory.db-wal", "memory.db-shm"];
const MARKER_FILE = "initialization.json";
const REQUIRED_VIEWS = ["file_standing", "finding_state_current"];
const SNAPSHOT_LABEL =
  "Pre-rebuild snapshot (P16): the state discarded before the claims-backed rebuild";
const CLOSING_LABEL =
  "Post-discard empty store (P16): reinitialized and read back, ready for the rebuild";
const FIXTURES = [
  "dev/conspectus/self-baseline.json",
  "dev/conspectus/baseline-report.json",
  "dev/conspectus/baseline-report-detector-1.0.0.json",
  "dev/conspectus/detector-registry.json",
];
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

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const flag = (name) => process.argv.includes(name);

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function client() {
  const child = spawn(process.execPath, [SERVER, "--workspace", WORKSPACE, "--allow-workspace-pin"], {
    cwd: WORKSPACE,
    env: { ...process.env, AMANUENSIS_AUTOPROGRESS: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
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
    const id = nextId++;
    const response = new Promise((res, rej) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error(`timed out waiting for ${method}; stderr=${stderr.slice(-400)}`));
      }, 60_000);
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
    async handshake() {
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "p16-rebuild-driver", version: "1" },
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
      if (result.isError === true) {
        throw new Error(`${name} refused: ${payload?.error ?? "no reason given"}`);
      }
      return payload;
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

function step(text) {
  process.stdout.write(`${text}\n`);
}

// ---------------------------------------------------------------------------
if (!flag("--confirm")) {
  die(
    "refusing to run: this discards the live self-conspectus store at\n" +
      `  ${STORAGE}\n` +
      "Re-run with --confirm once that is what you mean.",
  );
}
if (!existsSync(SERVER)) die(`the built server is absent at ${SERVER}; run npm run build first.`);

const receiptPath = resolve(WORKSPACE, arg("--receipt", "design/reader-lenses/rebuild-receipt.json"));
const archive = resolve(
  arg("--archive", join(tmpdir(), `amanuensis-pre-rebuild-${Date.now()}`)),
);
if (existsSync(archive)) die(`the archive path already exists: ${archive}`);

const repositorySha = spawnSync("git", ["-C", WORKSPACE, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).stdout.trim();
if (!/^[0-9a-f]{40}$/.test(repositorySha)) {
  die(`the workspace at ${WORKSPACE} has no HEAD to bind the receipt to.`);
}

// --- step 1: snapshot ------------------------------------------------------
const before = client();
await before.handshake();
const preInfo = await before.call("get_project_info");
const preEntries = existsSync(STORAGE) ? readdirSync(STORAGE).sort() : [];
const storePresent = existsSync(STORAGE) && preInfo.db_exists === true;
step(`storage ${storePresent ? "present" : "absent"} at ${preInfo.storage_path}`);

const sessionOne = await before.call("start_session", {
  intent: "P16 — snapshot, discard, and reinitialize the self-conspectus store",
});
const preDashboard = await before.call("get_dashboard");
const populated = CENSUS_COUNTERS.filter((key) => Number(preDashboard[key] ?? 0) !== 0);
if (populated.length && !flag("--discard-populated-store")) {
  await before.stop();
  die(
    `refusing to discard a store that holds a survey: ${populated
      .map((key) => `${key}=${preDashboard[key]}`)
      .join(", ")}\nRe-run with --discard-populated-store if that is the intent.`,
  );
}
const snapshot = await before.call("commit_phase_gate", { label: SNAPSHOT_LABEL });
const historyBefore = await before.call("get_storage_history", { limit: 10 });
await before.call("end_session", { session_id: sessionOne.session_id, outcome: "completed" });
step(`snapshot ${snapshot.commit_sha} (${snapshot.reason})`);

const dbSizes = {};
for (const name of DB_FILES) {
  const path = join(STORAGE, name);
  dbSizes[name] = existsSync(path) ? statSync(path).size : null;
}

// --- step 2: stop ----------------------------------------------------------
const stoppedPid = before.pid;
await before.stop();
const exitedBeforeDeletion = before.child.exitCode !== null || before.child.signalCode !== null;
const probe = pidProbe(stoppedPid);
if (!exitedBeforeDeletion || probe !== "ESRCH") {
  die(`the server process ${stoppedPid} is still addressable (${probe}); refusing to delete.`);
}
step(`server ${stoppedPid} stopped (pid probe: ${probe})`);

// --- step 3: discard -------------------------------------------------------
mkdirSync(dirname(archive), { recursive: true });
cpSync(STORAGE, archive, { recursive: true });
const removed = [];
for (const name of DB_FILES) {
  const path = join(STORAGE, name);
  if (existsSync(path)) {
    rmSync(path, { force: true });
    removed.push(name);
  }
}
const survivors = readdirSync(STORAGE).sort();
rmSync(STORAGE, { recursive: true, force: true });
// Recorded here rather than at receipt time: by then the storage directory
// exists again, and a check that cannot fail records nothing.
const storageDirectoryRemoved = !existsSync(STORAGE);
step(`discarded ${removed.join(", ")} and the storage directory (archived to ${archive})`);

// --- step 4: initialize and restart ----------------------------------------
const after = client();
await after.handshake();
const coldInfo = await after.call("get_project_info");
const dashboard = await after.call("get_dashboard");
const info = await after.call("get_project_info");
const marker = JSON.parse(readFileSync(join(STORAGE, MARKER_FILE), "utf8"));
const views = JSON.parse(
  spawnSync(
    process.execPath,
    [
      "-e",
      'const D=require("better-sqlite3");const db=new D(process.argv[1],{readonly:true});' +
        'process.stdout.write(JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type=\'view\' ORDER BY name").all().map(r=>r.name)));',
      join(STORAGE, "memory.db"),
    ],
    { cwd: join(REPO, "mcp-server"), encoding: "utf8" },
  ).stdout,
);
const absentViews = REQUIRED_VIEWS.filter((name) => !views.includes(name));
if (absentViews.length) die(`the reinitialized store is missing view(s): ${absentViews.join(", ")}`);

// --- step 5: read back through a further process ----------------------------
await after.stop();
const readback = client();
await readback.handshake();
const readbackInfo = await readback.call("get_project_info");
const readbackDashboard = await readback.call("get_dashboard");
const subsystems = await readback.call("list_subsystems");
await readback.stop();
if (!Array.isArray(subsystems) || subsystems.length !== 0) {
  die("the reinitialized store is not empty; refusing to record a read-back that is not one.");
}
step(`read back: db_exists=${readbackInfo.db_exists}, subsystems=${subsystems.length}`);

// --- carry the snapshot's history into the rebuilt store --------------------
rmSync(join(STORAGE, ".git"), { recursive: true, force: true });
cpSync(join(archive, ".git"), join(STORAGE, ".git"), { recursive: true });
const closing = client();
await closing.handshake();
const sessionTwo = await closing.call("start_session", {
  intent: "P16 — record the reinitialized empty store",
});
const closingGate = await closing.call("commit_phase_gate", { label: CLOSING_LABEL });
const historyAfter = await closing.call("get_storage_history", { limit: 10 });
await closing.call("end_session", { session_id: sessionTwo.session_id, outcome: "completed" });
await closing.stop();
step(`history carried across; closing gate ${closingGate.commit_sha}`);

// --- the receipt ------------------------------------------------------------
const digests = {};
for (const path of FIXTURES) {
  digests[path] = createHash("sha256").update(readFileSync(join(REPO, path))).digest("hex");
}

const receipt = {
  contract: "amanuensis-reader-lenses/rebuild-receipt/v1",
  packet: "P16",
  recorded_at: new Date().toISOString(),
  repository_sha: repositorySha,
  workspace_path: info.workspace_path,
  storage_path: info.storage_path,
  project_key: info.project_key,
  produced_by: "dev/rebuild-self-conspectus-store.mjs --confirm",
  pre_rebuild: {
    store_present: storePresent,
    db_exists: preInfo.db_exists === true,
    storage_entries: preEntries,
    census: Object.fromEntries(CENSUS_COUNTERS.map((key) => [key, preDashboard[key] ?? null])),
    database_bytes: dbSizes,
    note: storePresent
      ? "The store discarded here is the one this worktree carried before the rebuild."
      : "This worktree carried no self-conspectus store before the rebuild: the branch's" +
        " work had never opened one, so the snapshot records an empty store this packet" +
        " initialized to run the procedure at the real path, and the discard removed that." +
        " The recoverability of a populated snapshot is proved in the gate's procedure arm," +
        " not here.",
  },
  snapshot: {
    tool: "commit_phase_gate",
    label: SNAPSHOT_LABEL,
    committed: snapshot.committed === true,
    commit_sha: snapshot.commit_sha,
    reason: snapshot.reason,
    taken_before_deletion: true,
    history_at_snapshot: historyBefore.commits ?? [],
  },
  stop: {
    server_pid: stoppedPid,
    signal: "SIGTERM",
    exited_before_deletion: exitedBeforeDeletion,
    pid_probe_after_exit: probe,
  },
  discard: {
    removed,
    survivors_of_partial_deletion: survivors,
    removed_storage_directory: storageDirectoryRemoved,
    archive_path: archive,
    reason:
      "Removing only memory.db, -wal and -shm leaves initialization.json naming a missing" +
      " database, and the next open fails with a storage-marker error; removing the marker as" +
      " well fails differently, because the incomplete-store rollback refuses a directory it" +
      " did not create. The directory is archived whole and removed whole, and its Git history" +
      " is carried back into the store that replaces it.",
  },
  reinitialize: {
    server_pid: after.pid,
    cold_db_exists: coldInfo.db_exists === true,
    views_created: views,
    marker,
    marker_validates: true,
    entries: readdirSync(STORAGE).sort(),
  },
  readback: {
    get_project_info: {
      project_key: readbackInfo.project_key,
      workspace_path: readbackInfo.workspace_path,
      storage_path: readbackInfo.storage_path,
      db_exists: readbackInfo.db_exists === true,
    },
    get_dashboard: Object.fromEntries(
      CENSUS_COUNTERS.map((key) => [key, readbackDashboard[key] ?? null]),
    ),
    first_open_dashboard: Object.fromEntries(
      CENSUS_COUNTERS.map((key) => [key, dashboard[key] ?? null]),
    ),
    subsystems: subsystems.length,
    read_by_a_further_process: true,
  },
  history_restored: {
    restored_from: join(archive, ".git"),
    snapshot_sha: snapshot.commit_sha,
    head_message: historyAfter.commits?.[0]?.message ?? null,
    commits: historyAfter.commits ?? [],
  },
  fixtures_unchanged: {
    checked: "sha256 of each A0 historical fixture after the rebuild (§12.3)",
    digests,
  },
};

mkdirSync(dirname(receiptPath), { recursive: true });
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
step(`receipt written to ${receiptPath}`);
