#!/usr/bin/env node
// Measure what a default `describe_locus` call serves (explanation spec.md §3.8,
// claims C36–C37).
//
// The lane does not change `describe_locus` (owner decision 5), so it measures
// it. For each locus given, this copies the workspace's store to a temporary
// directory, spawns the built server against the copy, calls `describe_locus`
// with no `sections`, and reports:
//
//   wire_bytes     the whole result the host receives — the compact text block
//                  and the `structuredContent` that duplicates it — as
//                  `dev/record-dogfood-receipt.mjs` measures it
//   payload_bytes  the compact payload alone
//   floor_bytes    the same response with every item removed (each section's
//                  `items` and the standing `unknown` list), re-serialized in the
//                  envelope the server emits. The census, the omission ledger as
//                  received and the trace stay: this is what an item-free
//                  response costs, not what a response that had dropped everything
//                  would cost, whose ledger would name more ids.
//   budget_bytes   the byte budget the response declares in `trace`
//   items          per section: the census, the items served and the items
//                  omitted (and by which reason)
//
// The server is spawned against a copy because a read can still write — an
// access log, a WAL checkpoint — and the store this measures is a real one. The
// original is only ever read as files; nothing opens it as a database.
//
//   node dev/measure-locus-default.mjs --workspace <dir> --locus <path> [--locus <path> ...] [--kind file]
//   node dev/measure-locus-default.mjs --record [--workspace <dir>] [--receipt <file>] [--out <file>]
//
// `--record` measures the loci the dogfood receipt names and writes
// `design/explanation/locus-default-measure.json`. `--workspace` defaults to
// this worktree.

import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(REPO, "mcp-server", "dist", "index.js");
const RECEIPT_REL = "design/reader-lenses/dogfood-receipt.json";
const OUT_REL = "design/explanation/locus-default-measure.json";
const CONTRACT = "amanuensis-explanation/locus-default-measure/v1";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { workspace: REPO, loci: [], kind: null, record: false, receipt: null, out: null };
  const value = (index, flag) => {
    if (index + 1 >= argv.length) fail(`${flag} needs a value`);
    return argv[index + 1];
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--workspace") options.workspace = resolve(value(index++, flag));
    else if (flag === "--locus") options.loci.push({ locus: value(index++, flag), kind: null });
    else if (flag === "--kind") options.kind = value(index++, flag);
    else if (flag === "--receipt") options.receipt = resolve(value(index++, flag));
    else if (flag === "--out") options.out = resolve(value(index++, flag));
    else if (flag === "--record") options.record = true;
    else fail(`unknown argument ${flag}`);
  }
  if (options.record) {
    if (options.loci.length > 0) fail("--record measures the loci the dogfood receipt names; drop --locus");
    const receiptPath = options.receipt ?? join(REPO, RECEIPT_REL);
    if (!existsSync(receiptPath)) fail(`no dogfood receipt at ${receiptPath}`);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    options.loci = (receipt.loci ?? []).map((entry) => ({
      locus: String(entry.locus),
      kind: entry.kind ?? null,
    }));
    if (options.loci.length === 0) fail(`the dogfood receipt ${receiptPath} names no locus`);
    options.out = options.out ?? join(REPO, OUT_REL);
  } else {
    if (options.loci.length === 0) fail("at least one --locus is required");
    if (options.receipt || options.out) fail("--receipt and --out apply to --record only");
  }
  return options;
}

let projectKeyOf = null;

function git(cwd, ...args) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  return run.status === 0 ? String(run.stdout).trim() : null;
}

/**
 * A workspace to bind the server to, holding a copy of the store. A git
 * workspace is cloned (sharing objects) so the server sees the same revisions;
 * the clone takes the original's `origin` so a remote-identified store keeps its
 * identity, and a store identified by its path gets the copy's path instead.
 * The original store is copied as files and never opened.
 */
function copyStore(workspace) {
  const source = join(workspace, ".amanuensis");
  if (!existsSync(join(source, "memory.db"))) fail(`no store at ${source}: there is nothing to measure`);
  const root = mkdtempSync(join(tmpdir(), "amanuensis-locus-default-"));
  const copy = join(root, "workspace");
  if (git(workspace, "rev-parse", "--git-dir") !== null) {
    const clone = spawnSync("git", ["clone", "-q", "--shared", workspace, copy], { encoding: "utf8" });
    if (clone.status !== 0) {
      rmSync(root, { recursive: true, force: true });
      fail(`could not clone the workspace: ${String(clone.stderr).trim().slice(0, 200)}`);
    }
    const origin = git(workspace, "remote", "get-url", "origin");
    if (origin) git(copy, "remote", "set-url", "origin", origin);
    else git(copy, "remote", "remove", "origin");
  } else {
    mkdirSync(copy, { recursive: true });
  }
  const destination = join(copy, ".amanuensis");
  cpSync(source, destination, { recursive: true });
  const identityPath = join(destination, "project_identity");
  const identity = existsSync(identityPath) ? readFileSync(identityPath, "utf8").trim() : "";
  if (identity.startsWith("local:")) {
    const real = realpathSync(copy);
    writeFileSync(identityPath, `local:${real}\n`);
    writeFileSync(join(destination, "workspace_path"), `${real}\n`);
    const markerPath = join(destination, "initialization.json");
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    marker.projectIdentity = `local:${real}`;
    marker.projectKey = projectKeyOf(real);
    marker.canonicalRoot = real;
    writeFileSync(markerPath, `${JSON.stringify(marker)}\n`);
  }
  return { root, copy };
}

function client(workspace) {
  const env = { ...process.env };
  delete env.AMANUENSIS_STORAGE_ROOT;
  const child = spawn(process.execPath, [SERVER, "--workspace", workspace], {
    cwd: workspace,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.on("exit", () => {
    for (const [id, waiter] of pending) {
      pending.delete(id);
      waiter.reject(new Error(`the server exited; stderr=${stderr.slice(-400)}`));
    }
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith("{")) {
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
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error(`timed out waiting for ${method}; stderr=${stderr.slice(-400)}`));
      }, 60_000);
      pending.set(id, {
        resolve(result) {
          clearTimeout(timer);
          res(result);
        },
        reject(error) {
          clearTimeout(timer);
          rej(error);
        },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };
  return {
    async handshake() {
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "ex13-locus-default-measure", version: "1" },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    },
    async call(name, args) {
      const result = await request("tools/call", { name, arguments: args });
      if (result.isError === true) {
        throw new Error(`${name} returned an error: ${result.content?.[0]?.text ?? "(no text)"}`);
      }
      return {
        payload: JSON.parse(result.content?.[0]?.text ?? "null"),
        wire_bytes: Buffer.byteLength(JSON.stringify(result), "utf8"),
      };
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      await new Promise((res) => child.once("exit", res));
    },
  };
}

const bytes = (text) => Buffer.byteLength(text, "utf8");

/** The envelope the server emits for a compact tool result. */
const envelope = (payload) =>
  JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  });

function withoutItems(payload) {
  const copy = JSON.parse(JSON.stringify(payload));
  for (const view of Object.values(copy.sections ?? {})) {
    if (Array.isArray(view.items)) view.items = [];
  }
  if (Array.isArray(copy.standing?.unknown)) copy.standing.unknown = [];
  return copy;
}

function sectionRows(payload) {
  const rows = {};
  for (const [name, census] of Object.entries(payload.census?.by_section ?? {})) {
    const served =
      name === "unknown" ? (payload.standing?.unknown?.length ?? 0) : (payload.sections?.[name]?.items?.length ?? 0);
    const dropped = (payload.omitted ?? []).filter((entry) => entry.section === name);
    const byReason = (reason) =>
      dropped.filter((entry) => entry.reason === reason).reduce((total, entry) => total + entry.count, 0);
    rows[name] = {
      census,
      served,
      omitted: dropped.reduce((total, entry) => total + entry.count, 0),
      omitted_by_policy: byReason("policy"),
      omitted_by_budget: byReason("budget"),
    };
  }
  return rows;
}

function measure(locus, kind, payload, wireBytes) {
  const items = sectionRows(payload);
  const rows = Object.values(items);
  return {
    locus: locus,
    kind: payload.locus?.kind ?? kind,
    sections_requested: [],
    budget_bytes: payload.trace?.budget_bytes ?? null,
    wire_bytes: wireBytes,
    payload_bytes: bytes(JSON.stringify(payload)),
    floor_bytes: bytes(envelope(withoutItems(payload))),
    within_budget: payload.trace?.within_budget ?? null,
    envelope_reproduces_wire: bytes(envelope(payload)) === wireBytes,
    items,
    census_total: payload.census?.total ?? null,
    served_total: rows.reduce((total, row) => total + row.served, 0),
    omitted_total: rows.reduce((total, row) => total + row.omitted, 0),
    response: payload,
  };
}

const options = parseArgs(process.argv.slice(2));
if (!existsSync(SERVER)) fail(`no built server at ${SERVER}: run 'npm run build' in mcp-server/ first`);
// A store identified by its path carries that path in its completion marker; the
// key the server derives from a path is the server's to say.
const { resolveProjectKey } = await import(pathToFileURL(join(REPO, "mcp-server", "dist", "project.js")).href);
projectKeyOf = resolveProjectKey;

const { root, copy } = copyStore(options.workspace);
const server = client(copy);
const loci = [];
try {
  await server.handshake();
  for (const { locus, kind } of options.loci) {
    const asked = kind ?? options.kind;
    const args = asked ? { locus, kind: asked } : { locus };
    const { payload, wire_bytes } = await server.call("describe_locus", args);
    loci.push(measure(locus, asked, payload, wire_bytes));
  }
} finally {
  await server.stop().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}

const report = {
  contract: CONTRACT,
  produced_by: "dev/measure-locus-default.mjs",
  measured_at: new Date().toISOString(),
  workspace: options.workspace,
  repository_sha: git(options.workspace, "rev-parse", "HEAD"),
  call: { tool: "describe_locus", sections: null },
  copy_location: copy,
  copy_removed: !existsSync(root),
  floor_basis:
    "the response with every item removed, re-serialized in the compact envelope; the census, the omission ledger as received and the trace are kept",
  loci,
};

if (options.record) {
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  const shown = isAbsolute(options.out) ? options.out : resolve(options.out);
  process.stdout.write(`wrote ${shown}: ${loci.length} locus measure(s)\n`);
} else {
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
