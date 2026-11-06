#!/usr/bin/env node
// GATE EX13 (design/explanation/spec.md §3.8) — what a default `describe_locus`
// call serves, measured over the wire.
//
// `describe_locus` is not changed by this lane (owner decision 5), so the lane
// does not argue about what a default call returns; it measures it.
// `dev/measure-locus-default.mjs` copies a store to a temporary directory,
// spawns the built server against the copy, calls `describe_locus` with no
// `sections`, and reports wire bytes, payload bytes, the floor, the budget and
// the items served and omitted per section.
//
// This gate builds a small store through the built server (a workspace with one
// subsystem, a file it owns, and enough claims on that file to put the default
// budget under pressure, plus a second file that fits), runs the script over it,
// and compares every figure the script reports with a measurement taken here by
// other means:
//
//   - the response is read from a second server, bound to a second copy of the
//     store, and its size is the bytes of the `result` member of the raw
//     JSON-RPC line, sliced out of the line rather than re-serialized;
//   - the floor is the same response with every item removed and re-serialized
//     in the envelope the server emits;
//   - served plus omitted is compared with the census the response declares, per
//     section, and with the omission ledger.
//
// It then proves the checker can fail: a stub report of zeros, and the real
// report with each figure bent in turn, must all be refused. The original store
// is digested before and after, because the script's whole premise is that it
// reads a copy.
//
//   exit 0  `GATE EX13 GREEN`          — every assertion held
//   exit 1  `GATE EX13 RED: <reason>`  — the first assertion that failed
//
// The first assertion (M1) carries the packet's red_expect phrase. With the
// script absent it reports that, so the red run reaches an assertion and never a
// stack trace.
//
// What a reviewer should sabotage, and what must go red:
//   report the payload bytes, or the text block alone, as the wire bytes   → M2
//   report a fixed or zero wire figure                                     → M2, S1
//   compute the floor from the payload without removing items              → M4
//   leave the ledger as the floor's basis but drop the unknown entries      → M4
//   count served or omitted from the wrong place                           → M5
//   call describe_locus with sections                                      → M3
//   measure the original store, or write to it                             → O1, O2
//   leave the copy behind                                                  → O3
//   write the record somewhere else, or for other loci                     → R1, R2
//   edit locus.ts or the locus contract                                    → F1
//   forget the gate in test.yml                                            → L1
//
// A false green this gate cannot exclude: the three loci the dogfood receipt
// names are unrepresentative of what an agent asks about.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const SCRIPT_REL = "dev/measure-locus-default.mjs";
const RECORD_REL = "design/explanation/locus-default-measure.json";
const RECEIPT_REL = "design/reader-lenses/dogfood-receipt.json";
const CI_REL = ".github/workflows/test.yml";
const GATE_REL = "dev/test-locus-default-measure.mjs";
const PROTECTED = ["mcp-server/src/tools/locus.ts", "mcp-server/contracts/locus-account.schema.json"];
const WIRE_BUDGET = 8192;
const RED_EXPECT = "the reported wire bytes differ from the response measured";

// A crash signature in this gate's output means the run never reached its
// assertion, so the launcher rejects it as a red proof. Assertion detail is
// quoted from live errors and file names, so it is scrubbed rather than trusted.
const CRASH_SIGNATURES = [
  "MODULE_NOT_FOUND",
  "Cannot find module",
  "ENOENT",
  "SyntaxError",
  "ReferenceError",
  "TypeError",
  "is not a function",
  "command not found",
  "ModuleNotFoundError",
  "ImportError",
  "Traceback (most recent call last)",
  "NameError",
  "AttributeError",
  "No such file or directory",
  "is not defined",
];
function elide(signature) {
  const cut = Math.ceil(signature.length / 2);
  return `${signature.slice(0, cut)}…${signature.slice(cut)}`;
}
function scrub(text) {
  let out = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  for (const signature of CRASH_SIGNATURES) out = out.split(signature).join(elide(signature));
  return out;
}

const failures = [];
async function check(label, fn) {
  try {
    const detail = await fn();
    if (detail) failures.push({ label, detail: scrub(detail) });
  } catch (error) {
    failures.push({ label, detail: `threw — ${scrub(error?.message ?? error)}` });
  }
}

function finish() {
  if (failures.length === 0) {
    process.stdout.write("GATE EX13 GREEN\n");
    process.exit(0);
  }
  const first = failures[0];
  const rest = failures.slice(1, 6).map((f) => `${f.label}: ${f.detail}`);
  for (const line of rest) process.stdout.write(`  also failed — ${line}\n`);
  const lead = first.label === "M1" ? "" : `${RED_EXPECT} — `;
  process.stdout.write(`GATE EX13 RED: ${lead}${first.label}: ${first.detail}\n`);
  process.exit(1);
}

const scratchRoots = [];
function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchRoots.push(dir);
  return dir;
}
function cleanup() {
  for (const dir of scratchRoots) rmSync(dir, { recursive: true, force: true });
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return String(result.stdout ?? "").trim();
}
function gitCommit(cwd, message) {
  spawnSync(
    "git",
    [
      "-c", "user.email=ex13@localhost",
      "-c", "user.name=explanation-ex13",
      "-c", "commit.gpgsign=false",
      "commit", "-q", "--no-verify", "-m", message,
    ],
    { cwd, encoding: "utf8" },
  );
}

const bytes = (text) => Buffer.byteLength(text, "utf8");

/** Every file under a directory, by relative path and content, as one digest. */
function digestTree(root) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = full.slice(root.length);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        hash.update(`d:${rel}\n`);
        walk(full);
      } else {
        hash.update(`f:${rel}:${stat.size}\n`);
        hash.update(readFileSync(full));
      }
    }
  };
  if (existsSync(root)) walk(root);
  return hash.digest("hex");
}

// ------------------------------------------------------- the built server, over stdio

/**
 * Start the built server on a workspace and return a client. `call` resolves to
 * the parsed payload, the raw `result` text exactly as the server wrote it, and
 * the error flag.
 */
function startServer(workspace) {
  const env = { ...process.env };
  delete env.AMANUENSIS_STORAGE_ROOT;
  const server = spawn(
    process.execPath,
    [join(repo, "mcp-server", "dist", "index.js"), "--workspace", workspace],
    { cwd: workspace, env, stdio: ["pipe", "pipe", "pipe"] },
  );
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  let stderr = "";
  let dead = null;
  const failAll = (reason) => {
    dead = dead ?? reason;
    for (const [, waiter] of pending) waiter.reject(new Error(dead));
    pending.clear();
  };
  server.on("error", (error) => failAll(String(error?.message ?? error)));
  server.on("exit", (code) => failAll(`the server exited ${code}: ${stderr.slice(0, 300)}`));
  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  server.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim().startsWith("{")) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      waiter.resolve({ message, line });
    }
  });
  const send = (message) => {
    try {
      server.stdin.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      failAll(String(error?.message ?? error));
    }
  };
  const request = (method, params) =>
    new Promise((resolveFn, rejectFn) => {
      if (dead) {
        rejectFn(new Error(dead));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectFn(new Error(`${method} was not answered within 60s`));
      }, 60_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveFn(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectFn(error);
        },
      });
      send({ jsonrpc: "2.0", id, method, params });
    });
  const ready = request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "ex13", version: "0" },
  }).then(() => send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }));
  return {
    async call(name, args) {
      await ready;
      const { message, line } = await request("tools/call", { name, arguments: args });
      const text = String(message.result?.content?.[0]?.text ?? "");
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      const marker = '"result":';
      const at = line.indexOf(marker);
      // The raw member, sliced out of the line the server wrote; the closing
      // brace of the JSON-RPC object is the last character.
      const rawResult = at >= 0 ? line.slice(at + marker.length, line.lastIndexOf("}")) : "";
      return {
        payload,
        rawResult,
        isError: message.result?.isError === true || Boolean(message.error),
        error: message.error ? JSON.stringify(message.error) : null,
      };
    },
    async close() {
      if (server.exitCode !== null || server.signalCode !== null) return;
      await new Promise((done) => {
        server.once("exit", done);
        try {
          server.kill("SIGTERM");
        } catch {
          done();
        }
      });
    },
  };
}

// ------------------------------------------------------------------- the fixture

const HOT = "src/hot.ts";
const QUIET = "src/quiet.ts";

/** A workspace with a store carrying a loaded file and a quiet one, built through the server. */
async function buildFixture() {
  const root = scratch("amanuensis-ex13-");
  const ws = join(root, "fixture");
  mkdirSync(join(ws, "src"), { recursive: true });
  git(ws, "init", "-q");
  writeFileSync(join(ws, HOT), "export const hot = 1;\n");
  writeFileSync(join(ws, QUIET), "export const quiet = 1;\n");
  git(ws, "add", "-A");
  gitCommit(ws, "seed");
  const sha = git(ws, "rev-parse", "HEAD");

  const server = startServer(ws);
  const must = async (name, args) => {
    const result = await server.call(name, args);
    if (result.isError || result.payload?.ok === false) {
      throw new Error(`${name} did not succeed: ${result.error ?? result.payload?.error ?? "no payload"}`);
    }
    return result.payload;
  };
  try {
    await must("start_session", { intent: "ex13-fixture" });
    await must("upsert_subsystem", { id: "B-01", name: "Hot path", scope: HOT, layer: "core" });
    await must("upsert_subsystem", { id: "B-02", name: "Quiet path", scope: QUIET, layer: "core" });
    await must("add_files_to_scope", {
      subsystem_id: "B-01",
      ref_sha: sha,
      files: [{ file_path: HOT, why_in_scope: "the loaded file", classification: "examined" }],
    });
    await must("add_files_to_scope", {
      subsystem_id: "B-02",
      ref_sha: sha,
      files: [{ file_path: QUIET, why_in_scope: "the quiet file", classification: "examined" }],
    });
    const hotEvidence = (await must("add_evidence", { file_path: HOT, symbol: "hot", line_range: "1-1", ref_sha: sha, kind: "code-verified" })).id;
    const quietEvidence = (await must("add_evidence", { file_path: QUIET, symbol: "quiet", line_range: "1-1", ref_sha: sha, kind: "code-verified" })).id;
    // Enough prose on the loaded file that a default call cannot serve it all
    // inside 8192 bytes: the floor leaves room for nought to two items, so any
    // count above that proves truncation without leaning on a particular size.
    for (let i = 1; i <= 24; i += 1) {
      await must("add_claim", {
        claim_id: `HOT-${String(i).padStart(2, "0")}`,
        claim_key: `hot/row/${i}`,
        subject_type: "subsystem",
        subject_id: "B-01",
        statement: `The reader retries the ${i}th bounded read under a ceiling, backs off between attempts, and reports the attempt count to the caller so that a stalled read is distinguishable from a slow one.`,
        epistemic_kind: "observation",
        ref_sha: sha,
        evidence_ids: [hotEvidence],
      });
    }
    await must("add_claim", {
      claim_id: "QUIET-01",
      claim_key: "quiet/row/1",
      subject_type: "subsystem",
      subject_id: "B-02",
      statement: "The quiet file exports one constant.",
      epistemic_kind: "observation",
      ref_sha: sha,
      evidence_ids: [quietEvidence],
    });
  } finally {
    await server.close();
  }
  return { root, ws, sha };
}

/** A second, independent copy of the fixture, bound to its own path. */
function duplicate(fixture, label) {
  const dest = join(scratch("amanuensis-ex13-copy-"), label);
  cpSync(fixture.ws, dest, { recursive: true });
  const real = realpathSync(dest);
  writeFileSync(join(dest, ".amanuensis", "project_identity"), `local:${real}\n`);
  writeFileSync(join(dest, ".amanuensis", "workspace_path"), `${real}\n`);
  return dest;
}

// ----------------------------------------------------- what an honest report must hold

/** The envelope the server emits for a compact tool result. */
const envelope = (payload) =>
  JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  });

/** The response with every item removed: sections' items and the standing unknown list. */
function withoutItems(payload) {
  const copy = JSON.parse(JSON.stringify(payload));
  for (const view of Object.values(copy.sections ?? {})) {
    if (Array.isArray(view.items)) view.items = [];
  }
  if (Array.isArray(copy.standing?.unknown)) copy.standing.unknown = [];
  return copy;
}

function servedIn(payload, name) {
  if (name === "unknown") return payload.standing?.unknown?.length ?? 0;
  return payload.sections?.[name]?.items?.length ?? 0;
}
function omittedIn(payload, name) {
  return (payload.omitted ?? [])
    .filter((entry) => entry.section === name)
    .reduce((total, entry) => total + entry.count, 0);
}

/**
 * Judge one locus entry of a report against a response taken another way.
 * `measured` is `{ payload, rawResult }` from this gate's own server, or, for a
 * committed record, null — then the entry's own embedded response stands in and
 * only internal consistency is asserted. Returns a reason, or null.
 */
function judgeEntry(entry, measured) {
  if (!entry || typeof entry !== "object") return "the entry is not an object";
  const response = entry.response;
  if (!response || typeof response !== "object") return `${entry.locus}: the entry carries no response`;
  const ownWire = measured ? bytes(measured.rawResult) : bytes(envelope(response));
  if (!Number.isInteger(entry.wire_bytes) || entry.wire_bytes <= 0) {
    return `${entry.locus}: wire_bytes is ${JSON.stringify(entry.wire_bytes)}, not a positive integer`;
  }
  if (entry.wire_bytes !== ownWire) {
    return `${entry.locus}: the report says ${entry.wire_bytes} wire bytes and the response measured ${ownWire}`;
  }
  if (measured && JSON.stringify(response) !== JSON.stringify(measured.payload)) {
    return `${entry.locus}: the response the script reports is not the response a second server returned`;
  }
  if (entry.payload_bytes !== bytes(JSON.stringify(response))) {
    return `${entry.locus}: payload_bytes ${entry.payload_bytes} differs from the compact payload ${bytes(JSON.stringify(response))}`;
  }
  if (entry.wire_bytes <= entry.payload_bytes) {
    return `${entry.locus}: the wire figure ${entry.wire_bytes} is not larger than the payload ${entry.payload_bytes}; the envelope carries the payload twice`;
  }
  const floor = bytes(envelope(withoutItems(response)));
  if (entry.floor_bytes !== floor) {
    return `${entry.locus}: floor_bytes ${entry.floor_bytes} differs from the response with every item removed, ${floor}`;
  }
  if (!(entry.floor_bytes <= entry.wire_bytes)) return `${entry.locus}: the floor exceeds the response`;
  if (entry.budget_bytes !== response.trace?.budget_bytes) {
    return `${entry.locus}: budget_bytes ${entry.budget_bytes} differs from the response's trace ${response.trace?.budget_bytes}`;
  }
  if (!Array.isArray(entry.sections_requested) || entry.sections_requested.length !== 0) {
    return `${entry.locus}: a default call names no sections, the report says ${JSON.stringify(entry.sections_requested)}`;
  }
  if (entry.budget_bytes !== WIRE_BUDGET) {
    return `${entry.locus}: the budget is ${entry.budget_bytes}, the default call's is ${WIRE_BUDGET}`;
  }
  const declared = response.census?.by_section ?? {};
  const names = Object.keys(declared);
  if (names.length === 0) return `${entry.locus}: the response declares no census`;
  const reported = entry.items ?? {};
  if (JSON.stringify(Object.keys(reported).sort()) !== JSON.stringify([...names].sort())) {
    return `${entry.locus}: the report's sections ${Object.keys(reported).sort().join(",")} differ from the census's ${[...names].sort().join(",")}`;
  }
  let servedTotal = 0;
  let omittedTotal = 0;
  for (const name of names) {
    const served = servedIn(response, name);
    const omitted = omittedIn(response, name);
    const row = reported[name];
    if (row?.served !== served || row?.omitted !== omitted || row?.census !== declared[name]) {
      return `${entry.locus}: section ${name} is reported ${JSON.stringify(row)} where the response holds served ${served}, omitted ${omitted}, census ${declared[name]}`;
    }
    if (served + omitted !== declared[name]) {
      return `${entry.locus}: section ${name} serves ${served} and omits ${omitted}, and the response declares ${declared[name]}`;
    }
    servedTotal += served;
    omittedTotal += omitted;
  }
  if (entry.served_total !== servedTotal || entry.omitted_total !== omittedTotal) {
    return `${entry.locus}: the totals ${entry.served_total}/${entry.omitted_total} differ from ${servedTotal}/${omittedTotal}`;
  }
  if (servedTotal + omittedTotal !== response.census?.total) {
    return `${entry.locus}: served plus omitted is ${servedTotal + omittedTotal}, the response declares a total of ${response.census?.total}`;
  }
  return null;
}

/** Run the script and parse its stdout as one JSON document. */
function runScript(args, options = {}) {
  const env = { ...process.env };
  delete env.AMANUENSIS_STORAGE_ROOT;
  const run = spawnSync(process.execPath, [join(repo, SCRIPT_REL), ...args], {
    cwd: options.cwd ?? repo,
    encoding: "utf8",
    env,
    timeout: 240_000,
  });
  let report = null;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    report = null;
  }
  return { status: run.status, report, stdout: run.stdout, stderr: String(run.stderr ?? "") };
}

// -------------------------------------------------------------------- the gate body

async function main() {
  // M1 — the script exists and runs over a fixture. Placed first so the red
  // commit, which has no script, fails here with the packet's phrase.
  if (!existsSync(join(repo, SCRIPT_REL))) {
    failures.push({
      label: "M1",
      detail: `${RED_EXPECT}: ${SCRIPT_REL} is absent, so no figure is reported at all`,
    });
    return;
  }

  let built = { ok: true, detail: null };
  try {
    const mod = await import(pathToUrl(join(repo, "mcp-server", "scripts", "ensure-built.mjs")));
    built = mod.ensureBuilt();
  } catch (error) {
    built = { ok: false, detail: scrub(error?.message ?? error) };
  }
  if (!built.ok) {
    failures.push({ label: "M1", detail: `${RED_EXPECT}: the server was not built — ${built.detail}` });
    return;
  }

  let fixture;
  try {
    fixture = await buildFixture();
  } catch (error) {
    failures.push({ label: "M1", detail: `${RED_EXPECT}: the fixture store could not be built — ${scrub(error?.message ?? error)}` });
    return;
  }
  const storeRoot = join(fixture.ws, ".amanuensis");
  const before = digestTree(storeRoot);

  const first = runScript(["--workspace", fixture.ws, "--locus", HOT, "--locus", QUIET, "--kind", "file"]);
  if (first.status !== 0 || !first.report || !Array.isArray(first.report.loci)) {
    failures.push({
      label: "M1",
      detail: `${RED_EXPECT}: the script exited ${first.status} and printed no report — ${scrub(first.stderr.slice(-300) || first.stdout.slice(0, 200))}`,
    });
    return;
  }
  const report = first.report;

  // The independent measurement: a second copy, a second server, the raw line.
  const reference = new Map();
  const second = duplicate(fixture, "reference");
  const server = startServer(second);
  try {
    for (const locus of [HOT, QUIET]) {
      reference.set(locus, await server.call("describe_locus", { locus, kind: "file" }));
    }
  } finally {
    await server.close();
  }

  await check("M2", () => {
    if (report.loci.length !== 2) return `the report holds ${report.loci.length} loci, two were asked for`;
    for (const locus of [HOT, QUIET]) {
      const entry = report.loci.find((candidate) => candidate.locus === locus);
      if (!entry) return `${locus} is not in the report`;
      const measured = reference.get(locus);
      if (!measured?.payload) return `${locus}: the reference server returned no payload`;
      const reason = judgeEntry(entry, measured);
      if (reason) return reason;
    }
    return null;
  });

  await check("M3", () => {
    // A default call names no sections: the server answers at its own default
    // budget and the five default sections are the ones requested.
    for (const entry of report.loci) {
      const requested = Object.entries(entry.response?.sections ?? {})
        .filter(([, view]) => view.requested === true)
        .map(([name]) => name)
        .sort();
      if (JSON.stringify(requested) !== JSON.stringify(["boundaries", "defects", "purpose", "structure", "terms"])) {
        return `${entry.locus}: the response was asked for ${requested.join(",")}, not the default sections`;
      }
    }
    return null;
  });

  await check("M4", () => {
    const hot = report.loci.find((entry) => entry.locus === HOT);
    const quiet = report.loci.find((entry) => entry.locus === QUIET);
    // The fixture must put the budget under pressure on one locus and not the
    // other, or the omitted column and the floor are measured on nothing.
    if (!hot || hot.omitted_total <= 0) return `${HOT}: nothing was omitted, so the fixture exercises no truncation`;
    if (!hot.response.omitted.some((entry) => entry.section === "structure" && entry.reason === "budget")) {
      return `${HOT}: no structure item was omitted by budget`;
    }
    if (hot.floor_bytes >= hot.wire_bytes) return `${HOT}: the floor ${hot.floor_bytes} is not below the response ${hot.wire_bytes}`;
    if (!quiet || quiet.floor_bytes >= quiet.wire_bytes) return `${QUIET}: the floor is not below the response`;
    const structure = quiet.items?.structure;
    if (structure?.served !== 1 || structure?.omitted !== 0) {
      return `${QUIET}: the one claim should be served and none omitted, the report says ${JSON.stringify(structure)}`;
    }
    return null;
  });

  await check("S1", () => {
    // The checker can fail. A stub that reports zero, and the real entry bent
    // one figure at a time, must each be refused.
    const entry = report.loci.find((candidate) => candidate.locus === HOT);
    const measured = reference.get(HOT);
    const stub = {
      locus: HOT,
      wire_bytes: 0,
      payload_bytes: 0,
      floor_bytes: 0,
      budget_bytes: 0,
      sections_requested: [],
      items: {},
      served_total: 0,
      omitted_total: 0,
      response: entry.response,
    };
    if (judgeEntry(stub, measured) === null) return "an entry reporting zero for every figure was accepted";
    const bends = {
      wire_bytes: (e) => ({ ...e, wire_bytes: e.wire_bytes - 1 }),
      payload_bytes: (e) => ({ ...e, payload_bytes: e.wire_bytes }),
      floor_bytes: (e) => ({ ...e, floor_bytes: e.payload_bytes }),
      budget_bytes: (e) => ({ ...e, budget_bytes: 20480 }),
      served: (e) => ({ ...e, items: { ...e.items, structure: { ...e.items.structure, served: e.items.structure.served + 1 } } }),
      omitted: (e) => ({ ...e, items: { ...e.items, structure: { ...e.items.structure, omitted: e.items.structure.omitted - 1 } } }),
      totals: (e) => ({ ...e, omitted_total: e.omitted_total + 1 }),
      sections: (e) => ({ ...e, sections_requested: ["reviews"] }),
    };
    for (const [name, bend] of Object.entries(bends)) {
      if (judgeEntry(bend(entry), measured) === null) return `an entry with ${name} bent was accepted`;
    }
    if (judgeEntry(entry, measured) !== null) return "the unbent entry was refused by the control";
    return null;
  });

  // The original store was not written by the script, nor by the build of the
  // second server (which only ever saw a copy).
  await check("O1", () => {
    const after = digestTree(storeRoot);
    return after === before ? null : "the original store changed while the script measured it";
  });

  await check("O2", () => {
    const stored = report.copy_removed;
    if (stored !== true) return "the report does not say the temporary copy was removed";
    const location = report.copy_location;
    if (typeof location !== "string" || location.length === 0) return "the report does not name where the copy was";
    if (resolve(location).startsWith(resolve(fixture.ws))) return "the copy was made inside the original workspace";
    return null;
  });

  await check("O3", () => {
    if (existsSync(report.copy_location)) return `the temporary copy ${report.copy_location} was left behind`;
    return null;
  });

  // --record: loci come from a dogfood receipt, the output path can be moved.
  await check("R1", () => {
    const receiptDir = scratch("amanuensis-ex13-receipt-");
    const receiptPath = join(receiptDir, "receipt.json");
    const outPath = join(receiptDir, "record.json");
    writeFileSync(
      receiptPath,
      JSON.stringify({ loci: [{ locus: QUIET, kind: "file" }, { locus: HOT, kind: "file" }] }),
    );
    const run = runScript(["--workspace", fixture.ws, "--record", "--receipt", receiptPath, "--out", outPath]);
    if (run.status !== 0) return `--record exited ${run.status}: ${run.stderr.slice(-200)}`;
    if (!existsSync(outPath)) return "--record wrote nothing to the path it was given";
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    const loci = (written.loci ?? []).map((entry) => entry.locus);
    if (JSON.stringify(loci) !== JSON.stringify([QUIET, HOT])) {
      return `the record holds ${JSON.stringify(loci)}, the receipt named ${JSON.stringify([QUIET, HOT])}`;
    }
    for (const entry of written.loci) {
      const reason = judgeEntry(entry, reference.get(entry.locus));
      if (reason) return reason;
    }
    return null;
  });

  await check("R2", () => {
    const receipt = JSON.parse(readFileSync(join(repo, RECEIPT_REL), "utf8"));
    const named = (receipt.loci ?? []).map((entry) => entry.locus);
    if (named.length !== 3) return `the dogfood receipt names ${named.length} loci, not three`;
    const path = join(repo, RECORD_REL);
    if (!existsSync(path)) return `${RECORD_REL} is not committed`;
    const record = JSON.parse(readFileSync(path, "utf8"));
    const loci = (record.loci ?? []).map((entry) => entry.locus);
    if (JSON.stringify(loci) !== JSON.stringify(named)) {
      return `${RECORD_REL} holds ${JSON.stringify(loci)}, the dogfood receipt names ${JSON.stringify(named)}`;
    }
    for (const entry of record.loci) {
      const reason = judgeEntry(entry, null);
      if (reason) return `${RECORD_REL}: ${reason}`;
    }
    return null;
  });

  await check("F1", () => {
    const plan = JSON.parse(readFileSync(join(repo, "design/explanation/plan.json"), "utf8"));
    const packet = (plan.packets ?? plan).find?.((candidate) => candidate.id === "EX13");
    const start = packet?.start_sha;
    if (!start) return null;
    const known = spawnSync("git", ["cat-file", "-e", `${start}^{commit}`], { cwd: repo });
    if (known.status !== 0) return null;
    const diff = spawnSync("git", ["diff", "--name-only", start, "--", ...PROTECTED], { cwd: repo, encoding: "utf8" });
    const touched = String(diff.stdout ?? "").trim();
    return touched ? `the lane does not modify these, and ${touched} changed` : null;
  });

  await check("L1", () => {
    const ci = readFileSync(join(repo, CI_REL), "utf8");
    return ci.includes(`node ${GATE_REL}`) ? null : `${CI_REL} does not run ${GATE_REL}`;
  });
}

function pathToUrl(path) {
  return new URL(`file://${path}`).href;
}

try {
  await main();
} catch (error) {
  failures.unshift({ label: "M1", detail: `${RED_EXPECT}: the gate threw — ${scrub(error?.message ?? error)}` });
} finally {
  cleanup();
}
finish();
