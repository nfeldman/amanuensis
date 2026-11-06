#!/usr/bin/env node
// GATE EX15 (design/explanation/spec.md §3.1 Reset, §3.3) — the read tool for
// explanations, and the reset that withdraws them.
//
// EX9 gave the store a place to hold an explanation and two writers, and no
// way for the authoring phases to read one back: `describe_locus` serves
// `purpose: null` and carries no account, and decisions.md §5 keeps it so. This
// packet adds `get_explanations`, which returns for a subject each slot's
// effective row through `readExplanation`, and teaches `reset_subsystem` that an
// explanation written before a reset is no longer current: it appends a
// `withdrawn` row for each slot that has any row, so a resurveyed subsystem owes
// a new one.
//
// The gate asserts behaviour, not presence. It seeds fixtures through the built
// tool handlers (temporary git workspaces and stores that it creates), then reads
// them back through the built server over stdio, because the response on the
// wire is the thing under test. It digests every table before and after the
// reads: a read tool writes nothing and needs no session.
//
//   exit 0  `GATE EX15 GREEN`          — every assertion held
//   exit 1  `GATE EX15 RED: <reason>`  — the first assertion that failed
//
// The first assertion (E1) carries the packet's red_expect phrase. On a tree
// without the tool the server answers "unknown tool", E1 reports that, and the
// red run reaches an assertion and never a stack trace.
//
// Must-stay-green controls:
//   C1  a project subject accepts 'project' or no id and has the account slot only
//   C2  a reset of one subsystem leaves another subsystem's slots effective
//   C3  a reset appends a row only for a slot that has one
//
// What a reviewer should sabotage, and what must go red:
//   return the first or oldest row instead of the effective one       → E3
//   ignore ref_sha resolution                                          → E5
//   serve rows for a subsystem that is not explanation-eligible        → E6
//   write a row, or require a session, in the read tool                → W1, W2
//   omit earlier_rows, model_calls, authored, checked or evidence_ids  → E2, E3
//   leave reset_subsystem as it was                                    → R1, R2
//   append a withdrawn row for every slot, or for another subsystem    → R3, C3, C2
//   resolve a revision with no workspace bound                         → U1, U3
//   withdraw only at the slot's newest revision when HEAD cannot resolve → U2
//   read the project account without asking whether a subsystem is eligible → P1
//   lift or move the evidence cap                                      → N1, N2
//   delete the earlier rows at reset                                   → R1
//   forget the gate in test.yml or the tool in the inventory           → L1, L2

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

// A crash signature in this gate's output means the run never reached its
// assertion, so the launcher rejects it as a red proof. Assertion detail is
// quoted from live errors, so it is scrubbed rather than trusted.
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
const notes = [];
let checked = 0;
async function check(label, fn) {
  checked++;
  try {
    const detail = await fn();
    if (detail) failures.push(`${label}: ${scrub(detail)}`);
  } catch (error) {
    failures.push(`${label}: threw — ${scrub(error?.message ?? error)}`);
  }
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return String(result.stdout ?? "").trim();
}
function gitCommit(cwd, message) {
  spawnSync(
    "git",
    [
      "-c", "user.email=ex15@localhost",
      "-c", "user.name=explanation-ex15",
      "-c", "commit.gpgsign=false",
      "commit", "-q", "--no-verify", "-m", message,
    ],
    { cwd, encoding: "utf8" },
  );
}

// ------------------------------------------------------- the built server, over stdio

/**
 * Start the built server on a workspace and return a client. Every request
 * resolves to `{ payload, text, isError, error }`; a server that dies rejects
 * the pending request with the reason.
 */
function startServer(workspace, storageRoot) {
  const server = spawn(process.execPath, [join(here, "dist", "index.js"), "--workspace", workspace], {
    cwd: workspace,
    env: { ...process.env, AMANUENSIS_STORAGE_ROOT: storageRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });
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
      waiter.resolve(message);
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
        resolve: (message) => {
          clearTimeout(timer);
          resolveFn(message);
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
    clientInfo: { name: "ex15", version: "0" },
  }).then(() => send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }));
  return {
    async listTools() {
      await ready;
      return (await request("tools/list", {})).result?.tools ?? [];
    },
    async call(name, args) {
      await ready;
      const message = await request("tools/call", { name, arguments: args });
      const text = String(message.result?.content?.[0]?.text ?? "");
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      const isError = message.result?.isError === true || Boolean(message.error);
      return {
        payload,
        text,
        wire: Buffer.byteLength(JSON.stringify(message.result ?? null), "utf8"),
        isError,
        error: isError ? (payload?.error ?? (text || JSON.stringify(message.error))) : null,
      };
    },
    close() {
      try {
        server.kill("SIGTERM");
      } catch {
        /* the server is being torn down; a kill failure changes no verdict */
      }
    },
  };
}

// --------------------------------------------------------------- the gate body

const ROW_KEYS = ["body", "disposition", "evidence_ids", "id", "recorded_at", "ref_sha", "session_id"];
const SLOT_KEYS = ["authored", "checked", "earlier_rows", "row", "slot", "state"];
/** A well-formed 40-hex object name no repository here carries. */
const UNREACHABLE_SHA = "b0a7e5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c";
const PURPOSE_CAP = 400;
const ACCOUNT_CAP = 4096;
const EVIDENCE_CAP = 64;
/** What references/explanations.md promises a whole `get_explanations` envelope stays under. */
const WIRE_BOUND = 70_000;

async function main(mods) {
  const { openDatabase, resolveProject, ensureProjectStorage, toolArrays } = mods;
  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  function call(name, args, ctx) {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    return td.handler(args, ctx);
  }

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-ex15-"));
  const storageRoot = join(scratch, "storage");
  mkdirSync(storageRoot, { recursive: true });
  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
  const cleanups = [];

  /** A fresh workspace, store, open session and a server bound to it. */
  function world(label) {
    const ws = join(scratch, `ws-${label}`);
    mkdirSync(ws, { recursive: true });
    git(ws, "init", "-q");
    for (const name of ["src/a.ts", "src/b.ts"]) {
      mkdirSync(dirname(join(ws, name)), { recursive: true });
      writeFileSync(join(ws, name), `export const ${name.slice(4, 5)} = 1;\n`);
    }
    git(ws, "add", "-A");
    gitCommit(ws, "seed");
    const project = resolveProject(ws, { selectionSource: "ex15-read" });
    ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
    const db = openDatabase(project.dbPath);
    const ctx = { project, db, sessionId: null };
    ctx.sessionId = call("start_session", { intent: `ex15-${label}` }, ctx).session_id;
    let server = null;
    ctx.server = () => {
      if (!server) server = startServer(ws, storageRoot);
      return server;
    };
    cleanups.push(() => {
      server?.close();
      try {
        db.close();
      } catch {
        /* the assertion already reported whatever broke */
      }
      rmSync(project.storagePath, { recursive: true, force: true });
    });
    return ctx;
  }
  const headSha = (ctx) => git(ctx.project.workspacePath, "rev-parse", "HEAD");

  function seedSubsystem(ctx, id, status, ledgerFiles = ["src/a.ts"]) {
    ctx.db
      .prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, ?)")
      .run(id, `${id} fixture`, status);
    for (const file of ledgerFiles) {
      ctx.db
        .prepare(
          `INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha)
           VALUES (?, ?, 'fixture', 'examined', ?)`,
        )
        .run(id, file, headSha(ctx));
    }
    return id;
  }
  function evidence(ctx, file = "src/a.ts") {
    return call(
      "add_evidence",
      { file_path: file, symbol: "Unit", line_range: "1-1", ref_sha: headSha(ctx), kind: "code-verified" },
      ctx,
    ).id;
  }
  const record = (ctx, subjectId, slot, body, evidenceIds) =>
    call(
      "record_explanation",
      {
        subject_type: subjectId === "project" ? "project" : "subsystem",
        ...(subjectId === "project" ? {} : { subject_id: subjectId }),
        slot,
        body,
        evidence_ids: evidenceIds ?? [evidence(ctx)],
        ref_sha: headSha(ctx),
      },
      ctx,
    );
  const decline = (ctx, subjectId, slot, reason) =>
    call(
      "decline_explanation",
      {
        subject_type: subjectId === "project" ? "project" : "subsystem",
        ...(subjectId === "project" ? {} : { subject_id: subjectId }),
        slot,
        reason,
        ref_sha: headSha(ctx),
      },
      ctx,
    );
  /** A row written around the tools, for the states the writers refuse to produce. */
  function rawRow(ctx, subjectType, subjectId, slot, disposition, body, refSha) {
    return Number(
      ctx.db
        .prepare(
          `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(subjectType, subjectId, slot, disposition, body, refSha, ctx.sessionId).lastInsertRowid,
    );
  }
  const explanationRows = (ctx, subjectId) =>
    ctx.db
      .prepare("SELECT * FROM explanations WHERE subject_id = ? ORDER BY id")
      .all(subjectId);

  /** Every table's rows, hashed: the whole store, so a stray write anywhere is seen. */
  function digest(ctx) {
    const hash = createHash("sha256");
    const tables = ctx.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    for (const { name } of tables) {
      hash.update(`${name}\n${JSON.stringify(ctx.db.prepare(`SELECT * FROM "${name}"`).all())}\n`);
    }
    return hash.digest("hex");
  }

  /** `get_explanations` on the wire; the message when it was refused or absent. */
  async function read(ctx, args) {
    const response = await ctx.server().call("get_explanations", args);
    if (response.isError || !response.payload || response.payload.ok === false) {
      return { failed: response.error ?? response.text.slice(0, 200) ?? "no response", response };
    }
    return { payload: response.payload, response };
  }
  const slotOf = (payload, slot) => payload.slots?.find((s) => s.slot === slot);

  /** The first difference between a slot reading and what it should be, or null. */
  function slotDiff(actual, want, label) {
    if (!actual) return `${label}: no reading for the slot`;
    const keys = Object.keys(actual).sort();
    if (keys.join() !== SLOT_KEYS.join()) {
      return `${label}: slot keys are [${keys.join(",")}], expected [${SLOT_KEYS.join(",")}]`;
    }
    if (actual.authored !== "model") return `${label}: authored is ${JSON.stringify(actual.authored)}`;
    if (actual.state !== want.state) return `${label}: state is ${actual.state}, expected ${want.state}`;
    if (actual.checked !== (want.checked ?? true)) return `${label}: checked is ${actual.checked}`;
    if (actual.earlier_rows !== want.earlier_rows) {
      return `${label}: earlier_rows is ${actual.earlier_rows}, expected ${want.earlier_rows}`;
    }
    if (want.row === null) {
      return actual.row === null ? null : `${label}: row is ${JSON.stringify(actual.row).slice(0, 120)}, expected null`;
    }
    const row = actual.row;
    if (!row || typeof row !== "object") return `${label}: row is ${JSON.stringify(row)}, expected a row`;
    const rowKeys = Object.keys(row).sort();
    if (rowKeys.join() !== ROW_KEYS.join()) {
      return `${label}: row keys are [${rowKeys.join(",")}], expected [${ROW_KEYS.join(",")}]`;
    }
    for (const field of ["id", "disposition", "body", "ref_sha"]) {
      if (row[field] !== want.row[field]) {
        return `${label}: row.${field} is ${JSON.stringify(row[field])?.slice(0, 80)}, expected ${JSON.stringify(want.row[field])?.slice(0, 80)}`;
      }
    }
    if (row.session_id !== want.row.session_id) return `${label}: row.session_id is ${row.session_id}`;
    if (typeof row.recorded_at !== "string" || row.recorded_at === "") return `${label}: row.recorded_at is empty`;
    if (JSON.stringify(row.evidence_ids) !== JSON.stringify(want.row.evidence_ids)) {
      return `${label}: row.evidence_ids is ${JSON.stringify(row.evidence_ids)}, expected ${JSON.stringify(want.row.evidence_ids)}`;
    }
    return null;
  }
  const expectedRow = (ctx, id, disposition, body, ref, evidenceIds) => ({
    id,
    disposition,
    body,
    ref_sha: ref,
    session_id: ctx.sessionId,
    evidence_ids: evidenceIds,
  });

  // ------------------------------------------------- E: what the tool returns

  {
    const ctx = world("read");
    seedSubsystem(ctx, "S-01", "structural");
    seedSubsystem(ctx, "S-02", "structural");
    seedSubsystem(ctx, "S-03", "structural");
    seedSubsystem(ctx, "S-04", "structural");
    seedSubsystem(ctx, "S-05", "scoping");
    const head = headSha(ctx);

    // S-01: a recorded purpose, then a correction, then a declined account.
    const e1 = evidence(ctx);
    const e2 = evidence(ctx, "src/b.ts");
    const first = record(ctx, "S-01", "purpose", "It first said this.", [e1]).id;
    const purposeBody = "It lets a reader find what each file is for.";
    const corrected = record(ctx, "S-01", "purpose", purposeBody, [e2, e1]).id;
    const declinedReason = "The code does not say what this part is for.";
    const declined = decline(ctx, "S-01", "account", declinedReason).id;
    // S-03: a recorded purpose at a revision, then a row at one the workspace does not reach.
    const s3Good = record(ctx, "S-03", "purpose", "It keeps the good row.", [e1]).id;
    rawRow(ctx, "subsystem", "S-03", "purpose", "recorded", "It was written at a lost commit.", UNREACHABLE_SHA);
    // S-04: only an unreachable row.
    rawRow(ctx, "subsystem", "S-04", "purpose", "recorded", "Only at a lost commit.", UNREACHABLE_SHA);
    // S-05: rows around the writers, for a subsystem nobody has read.
    rawRow(ctx, "subsystem", "S-05", "purpose", "recorded", "Written before it was reset.", head);
    rawRow(ctx, "subsystem", "S-05", "account", "declined", "Written before it was reset.", head);

    const before = digest(ctx);

    await check("get_explanations does not return the effective row (E1)", async () => {
      // The red_expect assertion. On a tree without the tool the failure says so.
      const nothing = await read(ctx, { subject_type: "subsystem", subject_id: "S-02" });
      if (nothing.failed) return `the tool answered "${String(nothing.failed).slice(0, 140)}" for a subsystem with nothing recorded`;
      const diff =
        slotDiff(slotOf(nothing.payload, "purpose"), { state: "not-recorded", earlier_rows: 0, row: null }, "purpose") ??
        slotDiff(slotOf(nothing.payload, "account"), { state: "not-recorded", earlier_rows: 0, row: null }, "account");
      return diff ? `nothing recorded — ${diff}` : null;
    });

    await check("E2 the response names the subject, both slots in order, and model_calls 0", async () => {
      const { payload, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-02" });
      if (failed) return failed;
      if (payload.ok !== true) return `ok is ${payload.ok}`;
      if (payload.model_calls !== 0) return `model_calls is ${JSON.stringify(payload.model_calls)}, expected 0`;
      if (payload.subject_type !== "subsystem" || payload.subject_id !== "S-02") {
        return `the subject is ${payload.subject_type}/${payload.subject_id}, expected subsystem/S-02`;
      }
      const order = (payload.slots ?? []).map((s) => s.slot).join();
      return order === "purpose,account" ? null : `the slots are [${order}], expected [purpose,account]`;
    });

    await check("E3 a recorded purpose, and a correction, return the newer row and count the older one (E3)", async () => {
      const { payload, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-01" });
      if (failed) return failed;
      return slotDiff(
        slotOf(payload, "purpose"),
        {
          state: "recorded",
          earlier_rows: 1,
          row: expectedRow(ctx, corrected, "recorded", purposeBody, head, [e1, e2]),
        },
        `correction (row ${first} then ${corrected})`,
      );
    });

    await check("E4 a declination returns the reason as the body, with no evidence", async () => {
      const { payload, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-01" });
      if (failed) return failed;
      return slotDiff(
        slotOf(payload, "account"),
        {
          state: "declined",
          earlier_rows: 0,
          row: expectedRow(ctx, declined, "declined", declinedReason, head, []),
        },
        "declination",
      );
    });

    await check("E5 a row whose ref_sha does not resolve is passed over for the older row that does", async () => {
      const { payload, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-03" });
      if (failed) return failed;
      const diff = slotDiff(
        slotOf(payload, "purpose"),
        {
          state: "recorded",
          earlier_rows: 0,
          row: expectedRow(ctx, s3Good, "recorded", "It keeps the good row.", head, [e1]),
        },
        "the older resolvable row",
      );
      if (diff) return diff;
      const only = await read(ctx, { subject_type: "subsystem", subject_id: "S-04" });
      if (only.failed) return only.failed;
      return slotDiff(
        slotOf(only.payload, "purpose"),
        { state: "not-recorded", earlier_rows: 1, row: null },
        "a slot whose only row is unreachable",
      );
    });

    await check("E6 a subsystem that is not explanation-eligible reads not-recorded whatever rows exist", async () => {
      const { payload, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-05" });
      if (failed) return failed;
      return (
        slotDiff(slotOf(payload, "purpose"), { state: "not-recorded", earlier_rows: 1, row: null }, "purpose") ??
        slotDiff(slotOf(payload, "account"), { state: "not-recorded", earlier_rows: 1, row: null }, "account")
      );
    });

    await check("E7 a subject that cannot be read is refused rather than answered empty", async () => {
      const wrong = [];
      for (const [label, args] of [
        ["an unknown subsystem", { subject_type: "subsystem", subject_id: "S-404" }],
        ["a subsystem with no id", { subject_type: "subsystem" }],
        ["a subject type that does not exist", { subject_type: "file", subject_id: "src/a.ts" }],
        ["a project subject with another id", { subject_type: "project", subject_id: "S-01" }],
      ]) {
        const result = await read(ctx, args);
        if (!result.failed) wrong.push(`${label} was answered`);
      }
      return wrong.length === 0 ? null : wrong.join("; ");
    });

    await check("W1 reading writes nothing anywhere in the store", async () => {
      const after = digest(ctx);
      return after === before ? null : "the store's digest changed across the reads";
    });

    await check("W2 reading needs no session", async () => {
      // The server's own process never called start_session: every read above
      // succeeded without one, and a fresh server that has not either must too.
      const fresh = startServer(ctx.project.workspacePath, storageRoot);
      try {
        const response = await fresh.call("get_explanations", { subject_type: "subsystem", subject_id: "S-01" });
        if (response.isError) return `refused: ${String(response.error).slice(0, 160)}`;
        return /session/i.test(response.text) && response.payload?.ok !== true
          ? `answered about a session: ${response.text.slice(0, 120)}`
          : null;
      } finally {
        fresh.close();
      }
    });

    await check("L1 the tool is advertised as a read tool with a closed input schema", async () => {
      const tools = await ctx.server().listTools();
      const tool = tools.find((t) => t.name === "get_explanations");
      if (!tool) return "get_explanations is absent from tools/list";
      if (tool.annotations?.readOnlyHint !== true) return "readOnlyHint is not true";
      if (tool.annotations?.destructiveHint !== false) return "destructiveHint is not false";
      const schema = tool.inputSchema ?? {};
      if (schema.additionalProperties !== false) return "the input schema is not closed";
      if (JSON.stringify([...(schema.required ?? [])].sort()) !== JSON.stringify(["subject_type"])) {
        return `required is [${(schema.required ?? []).join(",")}], expected [subject_type]`;
      }
      const keys = Object.keys(schema.properties ?? {}).sort().join();
      return keys === "subject_id,subject_type" ? null : `properties are [${keys}], expected [subject_id,subject_type]`;
    });
  }

  // ------------------------------------------------------- C1: the project subject

  {
    const ctx = world("project");
    await check("C1 the project subject reads its account only, with or without an id", async () => {
      // Nothing is read to 'structural' yet, so nothing can be recorded; it still reads.
      const empty = await read(ctx, { subject_type: "project" });
      if (empty.failed) return `project with no subsystem read: ${empty.failed}`;
      const slots = (empty.payload.slots ?? []).map((s) => s.slot).join();
      if (slots !== "account") return `the project's slots are [${slots}], expected [account]`;
      const emptyDiff = slotDiff(slotOf(empty.payload, "account"), { state: "not-recorded", earlier_rows: 0, row: null }, "empty project");
      if (emptyDiff) return emptyDiff;

      seedSubsystem(ctx, "S-01", "structural");
      const ev = evidence(ctx);
      const body = "It is a conspectus, kept beside the code and read by agents.";
      const id = record(ctx, "project", "account", body, [ev]).id;
      for (const args of [{ subject_type: "project" }, { subject_type: "project", subject_id: "project" }]) {
        const result = await read(ctx, args);
        if (result.failed) return result.failed;
        const diff = slotDiff(
          slotOf(result.payload, "account"),
          { state: "recorded", earlier_rows: 0, row: expectedRow(ctx, id, "recorded", body, headSha(ctx), [ev]) },
          `project ${JSON.stringify(args)}`,
        );
        if (diff) return diff;
        if (result.payload.slots.length !== 1) return "the project subject returned more than one slot";
      }
      return null;
    });
  }

  // ------------------------------------------- M: the largest possible response

  {
    const ctx = world("largest");
    seedSubsystem(ctx, "S-01", "structural");
    const evidenceIds = [evidence(ctx), evidence(ctx, "src/b.ts"), evidence(ctx), evidence(ctx, "src/b.ts")];
    // Both slots at their caps, in UTF-8 bytes. ASCII is the widest the JSON can be
    // without escapes, so it is the largest response a well-formed body produces.
    const purpose = "p".repeat(PURPOSE_CAP);
    const lines = [];
    let size = 0;
    while (size + 81 <= ACCOUNT_CAP) {
      lines.push(`- ${"a".repeat(78)}`);
      size += 81;
    }
    const account = `${lines.join("\n")}\n${"b".repeat(ACCOUNT_CAP - Buffer.byteLength(`${lines.join("\n")}\n`))}`;
    await check("M1 both slots at their caps are served whole, and the response is measured", async () => {
      if (Buffer.byteLength(account) !== ACCOUNT_CAP) return `the fixture account is ${Buffer.byteLength(account)} bytes`;
      record(ctx, "S-01", "purpose", purpose, evidenceIds);
      record(ctx, "S-01", "account", account, evidenceIds);
      const { payload, response, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-01" });
      if (failed) return failed;
      if (slotOf(payload, "purpose")?.row?.body !== purpose) return "the purpose at its cap was not served whole";
      if (slotOf(payload, "account")?.row?.body !== account) return "the account at its cap was not served whole";
      const bytes = Buffer.byteLength(response.text, "utf8");
      notes.push(`largest response (both slots at their caps, ${evidenceIds.length} evidence rows each): ${bytes} bytes`);
      const bound = PURPOSE_CAP + ACCOUNT_CAP + 1536;
      return bytes <= bound ? null : `the response is ${bytes} bytes, over the ${bound} the two caps and their fields allow`;
    });
  }

  // ---------------------------------------- N: the bound holds on the whole envelope

  // M1 seeds four evidence ids and measures the text block. A ten-byte purpose
  // citing 10,000 rows was accepted and read back at 219,104 bytes on the wire
  // (slice-S2, F6/codex), so the count is capped and the envelope is what is measured.
  {
    const ctx = world("evidence-bound");
    seedSubsystem(ctx, "S-01", "structural");
    seedSubsystem(ctx, "S-02", "structural");
    const insertEvidence = ctx.db.prepare(
      `INSERT INTO evidence (id, file_path, symbol, line_range, ref_sha, kind, session_id)
       VALUES (?, 'src/a.ts', 'Unit', '1-1', ?, 'code-verified', ?)`,
    );
    // The widest ids a JSON number carries exactly, so the measurement is the worst one.
    const seedEvidence = (count, top) =>
      ctx.db.transaction(() => {
        const ids = [];
        for (let i = 0; i < count; i++) {
          insertEvidence.run(top - i, headSha(ctx), ctx.sessionId);
          ids.push(top - i);
        }
        return ids;
      })();
    const widest = seedEvidence(EVIDENCE_CAP, Number.MAX_SAFE_INTEGER);
    const tooMany = seedEvidence(10_000, 1_000_000);
    const refusal = (fn) => {
      try {
        const result = fn();
        return result?.ok === false ? String(result.error) : null;
      } catch (error) {
        return String(error?.message ?? error);
      }
    };

    await check("N1 record_explanation refuses more evidence rows than a response can carry", async () => {
      const before = explanationRows(ctx, "S-02").length;
      const stem = `record_explanation refuses: an explanation cites at most ${EVIDENCE_CAP} evidence rows`;
      for (const ids of [tooMany, tooMany.slice(0, EVIDENCE_CAP + 1)]) {
        const said = refusal(() => record(ctx, "S-02", "purpose", "ten bytes.", ids));
        if (said === null) return `a purpose citing ${ids.length} evidence rows was accepted`;
        if (!said.startsWith(stem)) return `the refusal reads ${said.slice(0, 120)}`;
      }
      return explanationRows(ctx, "S-02").length === before ? null : "a refused write stored a row";
    });

    await check("N2 a set at the evidence cap is accepted and served whole", async () => {
      const said = refusal(() => record(ctx, "S-02", "purpose", "ten bytes.", tooMany.slice(0, EVIDENCE_CAP)));
      if (said) return `a set at the cap was refused: ${said.slice(0, 120)}`;
      const { payload, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-02" });
      if (failed) return failed;
      const served = slotOf(payload, "purpose")?.row?.evidence_ids ?? [];
      return served.length === EVIDENCE_CAP ? null : `${served.length} of ${EVIDENCE_CAP} ids were served`;
    });

    await check("N3 the whole envelope stays under its bound at every cap, in prose and in escapes", async () => {
      // A control character is the widest a byte can become: six bytes in
      // structuredContent and seven in the escaped text block.
      for (const [label, unit] of [["prose", "a"], ["escapes", "\u0001"]]) {
        record(ctx, "S-01", "purpose", unit.repeat(PURPOSE_CAP), widest);
        record(ctx, "S-01", "account", unit.repeat(ACCOUNT_CAP), widest);
        const { payload, response, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-01" });
        if (failed) return `${label}: ${failed}`;
        if (slotOf(payload, "account")?.row?.evidence_ids?.length !== EVIDENCE_CAP) return `${label}: the fixture did not reach the evidence cap`;
        if (slotOf(payload, "account")?.row?.body?.length !== ACCOUNT_CAP) return `${label}: the account was not served whole`;
        notes.push(`whole envelope at every cap (${label}): ${response.wire} bytes`);
        if (response.wire > WIRE_BOUND) return `${label}: the envelope is ${response.wire} bytes, over ${WIRE_BOUND}`;
      }
      return null;
    });
  }

  // ------------------------------------------------------------- R: the reset rule

  {
    const ctx = world("reset");
    seedSubsystem(ctx, "S-01", "concerns");
    seedSubsystem(ctx, "S-02", "concerns");
    seedSubsystem(ctx, "S-03", "concerns");
    const ev = evidence(ctx);
    const purposeBody = "It lets a reader find what each file is for.";
    const accountBody = "It reads the ledger and writes one page for each subsystem.\n- The ledger comes first.";
    const purposeId = record(ctx, "S-01", "purpose", purposeBody, [ev]).id;
    const accountId = record(ctx, "S-01", "account", accountBody, [ev]).id;
    const otherId = record(ctx, "S-02", "purpose", "It is the other subsystem's purpose.", [ev]).id;
    // S-03 has a purpose only, so a reset withdraws one slot and not two.
    const lonely = record(ctx, "S-03", "purpose", "It has only a purpose.", [ev]).id;
    const originals = explanationRows(ctx, "S-01").map((r) => ({ ...r }));
    const reason = "the subsystem is resurveyed from the start";

    const dbReset = () => call("reset_subsystem", { id: "S-01", to_status: "structural", reason }, ctx);

    await check("R1 a reset keeps the earlier rows and appends one withdrawn row per slot that has any", async () => {
      const result = dbReset();
      if (result?.ok === false) return `the reset was refused: ${result.error}`;
      const rows = explanationRows(ctx, "S-01");
      const kept = originals.every((o) => JSON.stringify(rows.find((r) => r.id === o.id)) === JSON.stringify(o));
      if (!kept) return "an earlier row was changed or deleted by the reset";
      const added = rows.filter((r) => !originals.some((o) => o.id === r.id));
      if (added.length !== 2) return `the reset appended ${added.length} row(s) for S-01, expected 2 (a purpose and an account)`;
      const wrong = [];
      for (const slot of ["purpose", "account"]) {
        const row = added.find((r) => r.slot === slot);
        if (!row) wrong.push(`no withdrawn row for ${slot}`);
        else {
          if (row.disposition !== "withdrawn") wrong.push(`${slot} row is ${row.disposition}`);
          if (row.body !== reason) wrong.push(`${slot} body is ${JSON.stringify(row.body)}, not the reset's reason`);
          if (row.subject_type !== "subsystem") wrong.push(`${slot} subject_type is ${row.subject_type}`);
          if (row.id <= Math.max(purposeId, accountId)) wrong.push(`${slot} row does not follow the rows it withdraws`);
          if (git(ctx.project.workspacePath, "cat-file", "-t", row.ref_sha) !== "commit") {
            wrong.push(`${slot} ref_sha ${row.ref_sha} does not resolve in the workspace`);
          }
        }
      }
      return wrong.length === 0 ? null : wrong.join("; ");
    });

    await check("R2 after the reset both slots read not-recorded, with the earlier rows counted", async () => {
      const { payload, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-01" });
      if (failed) return failed;
      if (ctx.db.prepare("SELECT status FROM subsystems WHERE id='S-01'").get().status !== "structural") {
        return "the subsystem is not back at 'structural'";
      }
      return (
        slotDiff(slotOf(payload, "purpose"), { state: "not-recorded", earlier_rows: 1, row: null }, "purpose after reset") ??
        slotDiff(slotOf(payload, "account"), { state: "not-recorded", earlier_rows: 1, row: null }, "account after reset")
      );
    });

    await check("R3 record_explanation then makes a new row effective", async () => {
      const newBody = "After the resurvey it still finds what each file is for.";
      const newId = record(ctx, "S-01", "purpose", newBody, [ev]).id;
      const { payload, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-01" });
      if (failed) return failed;
      return (
        slotDiff(
          slotOf(payload, "purpose"),
          {
            state: "recorded",
            earlier_rows: 2,
            row: expectedRow(ctx, newId, "recorded", newBody, headSha(ctx), [ev]),
          },
          "purpose after the new row",
        ) ?? slotDiff(slotOf(payload, "account"), { state: "not-recorded", earlier_rows: 1, row: null }, "account, still unanswered")
      );
    });

    await check("C2 a reset of one subsystem leaves another subsystem's slots effective", async () => {
      const { payload, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-02" });
      if (failed) return failed;
      const rows = explanationRows(ctx, "S-02");
      if (rows.length !== 1) return `S-02 holds ${rows.length} row(s), expected the one it was given`;
      return slotDiff(
        slotOf(payload, "purpose"),
        {
          state: "recorded",
          earlier_rows: 0,
          row: expectedRow(ctx, otherId, "recorded", "It is the other subsystem's purpose.", headSha(ctx), [ev]),
        },
        "the other subsystem",
      );
    });

    await check("C3 a reset appends a row only for a slot that has one", async () => {
      const before = explanationRows(ctx, "S-03").length;
      const result = call("reset_subsystem", { id: "S-03", to_status: "structural", reason }, ctx);
      if (result?.ok === false) return `the reset was refused: ${result.error}`;
      const rows = explanationRows(ctx, "S-03");
      const added = rows.slice(before);
      if (added.length !== 1) return `the reset appended ${added.length} row(s), expected 1 for the one slot`;
      if (added[0].slot !== "purpose" || added[0].disposition !== "withdrawn") {
        return `the appended row is ${added[0].slot}/${added[0].disposition}`;
      }
      const { payload, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-03" });
      if (failed) return failed;
      return (
        slotDiff(slotOf(payload, "purpose"), { state: "not-recorded", earlier_rows: 1, row: null }, "withdrawn purpose") ??
        slotDiff(slotOf(payload, "account"), { state: "not-recorded", earlier_rows: 0, row: null }, "account that never had a row") ??
        (lonely ? null : "unreachable")
      );
    });
  }

  // -------------------------------- U: a reset with no workspace to resolve against

  // With no workspace bound, `git rev-parse HEAD` answered from the server's own
  // directory, so the withdrawn row named a commit of some other repository. Once
  // the workspace was bound again the reader skipped that row and the withdrawn
  // purpose came back as recorded (slice-S2, F3/codex).
  {
    const ctx = world("reset-unbound");
    const unbound = { ...ctx, project: { ...ctx.project, workspacePath: null } };
    const reason = "the subsystem is resurveyed from the start";
    const elsewhere = git(here, "rev-parse", "HEAD");
    seedSubsystem(ctx, "S-01", "concerns");
    seedSubsystem(ctx, "S-02", "concerns");
    const ev = evidence(ctx);
    const purposeId = record(ctx, "S-01", "purpose", "It is withdrawn with no workspace bound.", [ev]).id;
    const reachable = record(ctx, "S-02", "purpose", "An older row the workspace still reaches.", [ev]).id;
    // S-02's newest row names a revision the workspace cannot reach, so a withdrawal
    // written only at that revision would be skipped along with it.
    rawRow(ctx, "subsystem", "S-02", "purpose", "recorded", "A newer row at a lost revision.", UNREACHABLE_SHA);

    await check("U1 a reset with no workspace stays withdrawn once the workspace is bound again", async () => {
      const result = call("reset_subsystem", { id: "S-01", to_status: "structural", reason }, unbound);
      if (result?.ok === false) return `the reset was refused: ${result.error}`;
      const added = explanationRows(ctx, "S-01").filter((r) => r.id > purposeId);
      if (added.length !== 1 || added[0].disposition !== "withdrawn") {
        return `the reset appended ${JSON.stringify(added.map((r) => r.disposition))}, expected one withdrawn row`;
      }
      if (added[0].ref_sha === elsewhere) return "the withdrawn row names the server directory's HEAD";
      if (added[0].ref_sha !== headSha(ctx)) return `the withdrawn row names ${added[0].ref_sha}, not the slot's revision`;
      const { payload, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-01" });
      if (failed) return failed;
      return slotDiff(slotOf(payload, "purpose"), { state: "not-recorded", earlier_rows: 1, row: null }, "after rebinding");
    });

    await check("U2 it stays withdrawn when the slot's newest revision is the one that is lost", async () => {
      const result = call("reset_subsystem", { id: "S-02", to_status: "structural", reason }, unbound);
      if (result?.ok === false) return `the reset was refused: ${result.error}`;
      const { payload, failed } = await read(ctx, { subject_type: "subsystem", subject_id: "S-02" });
      if (failed) return failed;
      const purpose = slotOf(payload, "purpose");
      if (purpose?.state !== "not-recorded") {
        return `the purpose reads ${purpose?.state} from row ${purpose?.row?.id} (the older row is ${reachable})`;
      }
      return purpose.row === null ? null : "a withdrawn slot served a row";
    });

    await check("U3 a writer with no workspace does not resolve a revision in the server's directory", async () => {
      let accepted = null;
      try {
        accepted = call(
          "record_explanation",
          { subject_type: "subsystem", subject_id: "S-01", slot: "purpose", body: "It names another repository.", evidence_ids: [ev], ref_sha: elsewhere },
          unbound,
        );
      } catch {
        return null;
      }
      return accepted?.ok === false ? null : `record_explanation stored row ${accepted?.id} at the server directory's HEAD`;
    });
  }

  // ------------------------------------- P: the project account follows its subsystems

  // The materializer printed "No account of how the parts fit together is recorded"
  // while this tool served the account as recorded (slice-S2, F5/codex).
  {
    const ctx = world("project-parked");
    seedSubsystem(ctx, "S-01", "structural");
    const body = "The parts pass one record from the reader to the writer.";
    const id = record(ctx, "project", "account", body, [evidence(ctx)]).id;

    await check("P1 parking the sole eligible subsystem reads the project account as not-recorded", async () => {
      const parked = call("update_subsystem_status", { id: "S-01", status: "deferred", defer_reason: "parked for the fixture" }, ctx);
      if (parked?.ok === false) return `the fixture could not park S-01: ${parked.error}`;
      const { payload, failed } = await read(ctx, { subject_type: "project" });
      if (failed) return failed;
      return slotDiff(slotOf(payload, "account"), { state: "not-recorded", earlier_rows: 1, row: null }, "parked project");
    });

    await check("P2 the account stands again once a subsystem is eligible", async () => {
      ctx.db.prepare("UPDATE subsystems SET status = 'structural' WHERE id = 'S-01'").run();
      const { payload, failed } = await read(ctx, { subject_type: "project" });
      if (failed) return failed;
      const account = slotOf(payload, "account");
      return account?.state === "recorded" && account.row?.id === id ? null : `the account reads ${account?.state}`;
    });
  }

  // ---------------------------------------------------- L: the gate is wired in

  await check("L2 the gate is listed in the workflow beside its neighbours", async () => {
    const workflow = readFileSync(join(repo, ".github", "workflows", "test.yml"), "utf8");
    const own = workflow.split("\n").filter((line) => /run:\s*node test-explanation-read\.mjs\s*$/.test(line));
    if (own.length !== 1) return `test.yml lists test-explanation-read.mjs ${own.length} time(s), expected 1`;
    return workflow.includes("run: node test-explanations.mjs") ? null : "test.yml does not list test-explanations.mjs, its neighbour";
  });

  for (const cleanup of cleanups) cleanup();
  rmSync(scratch, { recursive: true, force: true });
}

// ------------------------------------------------------------------------ run

let exitCode = 0;
try {
  // `dist/` is a build artifact, so a gate that imports it without compiling
  // certifies whatever was last built rather than the source under review: the
  // explanation lane's slice-S2 review inverted this subject's source and the
  // gate stayed green until a rebuild (F1/codex). A compile failure is this
  // gate's red line, not a pass against stale bytes.
  const built = ensureBuilt();
  const mods = { toolArrays: [] };
  let loadError = null;
  try {
    if (!built.ok) throw new Error(built.detail);
    const project = await import("./dist/project.js");
    const db = await import("./dist/db.js");
    mods.resolveProject = project.resolveProject;
    mods.ensureProjectStorage = project.ensureProjectStorage;
    mods.openDatabase = db.openDatabase;
    const [evidence, project_, subsystems] = await Promise.all([
      import("./dist/tools/evidence.js"),
      import("./dist/tools/project.js"),
      import("./dist/tools/subsystems.js"),
    ]);
    mods.toolArrays = [evidence.evidenceTools, project_.projectTools, subsystems.subsystemTools];
    try {
      const explanations = await import("./dist/tools/explanations.js");
      mods.toolArrays.push(explanations.explanationTools ?? []);
    } catch {
      /* the writers are absent; the seeding says so */
    }
  } catch (error) {
    loadError = `the server build could not be loaded: ${scrub(error?.message ?? error)}`;
  }
  if (loadError) {
    checked++;
    failures.push(`get_explanations does not return the effective row (E1) — ${loadError}`);
  } else {
    await main(mods);
  }
} catch (error) {
  failures.push(`X1 the gate did not finish: ${scrub(error?.message ?? error)}`);
}

for (const note of notes) console.log(`  note ${note}`);
console.log(`  ran  ${checked} assertion(s) against ${join(here, "dist")}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`GATE EX15 RED: ${failures[0]}`);
  exitCode = 1;
} else {
  console.log("GATE EX15 GREEN");
}
process.exit(exitCode);
