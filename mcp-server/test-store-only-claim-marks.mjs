#!/usr/bin/env node
// GATE SO5 (design/store-only/PLAN.md §7.2, §8 SO5) — flow marks.
//
// A flow-step claim (`<sid>/flow/<slug>/<nn>`) can carry marks: a commit point,
// a crash point, an exit, a seam crossing, or (on step 00) the flow's trigger.
// `record_claim_mark` writes one over an evidence row citing the claim
// subject's file, `withdraw_claim_mark` retracts a mistaken one without closing
// its claim, `decline_claim_marks` says a flow has none to record, and
// `get_claims` returns each claim's current, unwithdrawn marks and its flow's
// newest declination.
//
// Turns red when (PLAN §8 SO5):
//   - a valid mark of any kind is refused, is not persisted with its fields, or
//     is not returned by `get_claims` on its claim;
//   - a mark is accepted on a non-flow claim, on a closed claim, with
//     `trigger` off step 00, with `crosses-seam` naming a seam the subsystem is
//     not party to (or no seam, or an unknown one), with `exit` naming a step
//     of another flow (or one that does not exist), with a label or target the
//     kind requires missing, or with evidence that does not cite the subject's
//     file in a strong kind;
//   - a closed claim's mark, or a withdrawn mark, is returned as current, or a
//     successor claim inherits its predecessor's marks;
//   - a withdrawal is accepted twice, for an unknown mark, with no reason, or
//     deletes the mark;
//   - a declination is missing from `get_claims`, is accepted for a key that is
//     not a flow with current steps, or an older declination is returned in
//     place of the newest;
//   - a refusal does not start with its tool's name, or leaves a row behind;
//   - resetting the subsystem below `structural` after a mark (current or
//     withdrawn) was recorded on one of its claims fails, deletes a mark or a
//     withdrawal, or leaves the marked claim or its marks current (final
//     review F1/codex).
// Controls (a handler that refuses everything must be red): one mark of each
// kind, a withdrawal, a re-record after it, a successor's own mark and a
// declination are all accepted and read back.
//
// The gate drives the built handlers over fixtures it creates itself, as
// `test-store-only-project-records.mjs` does, and reads `tools/list` from the
// built server.
//
//   exit 0  `GATE SO5 GREEN`          — every assertion held
//   exit 1  `GATE SO5 RED: <reason>`  — the first assertion that failed

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// A crash signature in this gate's output means the run never reached its
// assertion. Assertion detail is quoted from live errors, so it is scrubbed.
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
let checked = 0;
function check(label, fn) {
  checked++;
  try {
    const detail = fn();
    if (detail) failures.push(`${label}: ${scrub(detail)}`);
  } catch (error) {
    failures.push(`${label}: threw — ${scrub(error?.message ?? error)}`);
  }
}

/** Run `fn`, returning its refusal message, or null when it did not refuse. */
function refusal(fn) {
  try {
    const value = fn();
    if (value && typeof value === "object" && value.ok === false && value.error) {
      return String(value.error);
    }
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}

const MARK = "record_claim_mark";
const WITHDRAW = "withdraw_claim_mark";
const DECLINE = "decline_claim_marks";
const NEW_TOOLS = [MARK, WITHDRAW, DECLINE];

// ---------------------------------------------------------- the advertised surface

async function listTools(workspace) {
  return await new Promise((resolveFn) => {
    let settled = false;
    let server = null;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        server?.kill("SIGTERM");
      } catch {
        /* the server is being torn down; a kill failure changes no verdict */
      }
      resolveFn(value);
    };
    const timer = setTimeout(
      () => done({ error: "the server did not answer tools/list within 60s" }),
      60_000,
    );
    try {
      server = spawn(process.execPath, [join(here, "dist", "index.js"), "--workspace", workspace], {
        cwd: workspace,
        env: { ...process.env, AMANUENSIS_STORAGE_ROOT: join(workspace, "storage") },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      done({ error: String(error?.message ?? error) });
      return;
    }
    let out = "";
    server.on("error", (error) => done({ error: String(error?.message ?? error) }));
    server.stdout.on("data", (chunk) => {
      out += chunk.toString();
      for (const line of out.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === 2) done({ tools: message.result?.tools ?? [] });
        } catch {
          /* a partial line; the next chunk completes it */
        }
      }
    });
    let stderr = "";
    server.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    server.on("exit", (code) => done({ error: `the server exited ${code}: ${stderr.slice(0, 400)}` }));
    const send = (message) => {
      try {
        server.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        done({ error: String(error?.message ?? error) });
      }
    };
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "so5", version: "0" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return String(result.stdout ?? "").trim();
}
function gitCommit(cwd, message) {
  spawnSync(
    "git",
    [
      "-c", "user.email=so5@localhost",
      "-c", "user.name=claim-marks-so5",
      "-c", "commit.gpgsign=false",
      "commit", "-q", "--no-verify", "-m", message,
    ],
    { cwd, encoding: "utf8" },
  );
}

// --------------------------------------------------------------- the gate body

async function main(mods) {
  const { openDatabase, resolveProject, ensureProjectStorage, toolArrays } = mods;
  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  function call(name, args, ctx) {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    return td.handler(args, ctx);
  }
  const absent = (...names) => {
    const missing = names.filter((name) => !allTools.has(name));
    return missing.length ? `${missing.join(", ")} not served` : null;
  };

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-so5-"));
  const cleanups = [];

  /**
   * A fresh workspace, store and open session, with the subsystems, seams,
   * evidence and flow-step claims every assertion below reads. Each assertion
   * that writes gets its own.
   */
  function world(label, { session = true } = {}) {
    const ws = join(scratch, `ws-${label}`);
    mkdirSync(ws, { recursive: true });
    git(ws, "init", "-q");
    for (const name of ["src/a.ts", "src/b.ts"]) {
      mkdirSync(dirname(join(ws, name)), { recursive: true });
      writeFileSync(join(ws, name), `export const ${name.slice(4, 5)} = 1;\n`);
    }
    git(ws, "add", "-A");
    gitCommit(ws, "seed");
    const project = resolveProject(ws, { selectionSource: "so5-claim-marks" });
    ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
    const db = openDatabase(project.dbPath);
    const ctx = { project, db, sessionId: null };
    cleanups.push(() => {
      try {
        ctx.db.close();
      } catch {
        /* the assertion already reported whatever broke */
      }
      rmSync(project.storagePath, { recursive: true, force: true });
    });
    ctx.sessionId = call("start_session", { intent: `so5-${label}` }, ctx).session_id;
    for (const id of ["S1", "S2", "S3"]) {
      db.prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, 'scoping')").run(id, `${id} fixture`);
    }
    const seam = db.prepare("INSERT INTO seams (id, shared_object, party_a, party_b) VALUES (?, ?, ?, ?)");
    seam.run("SM-01", "queue", "S1", "S2"); // S1 is party A
    seam.run("SM-02", "table", "S2", "S3"); // S1 is not a party
    seam.run("SM-03", "cache", "S2", "S1"); // S1 is party B
    const head = git(ws, "rev-parse", "HEAD");
    const ev = (file, kind, symbol, line = "1-1") =>
      call("add_evidence", { file_path: file, symbol, line_range: line, ref_sha: head, kind }, ctx).id;
    const evidence = {
      a: ev("src/a.ts", "code-verified", "Unit"),
      aContract: ev("src/a.ts", "contract-stated", "Contract"),
      aNamed: ev("src/a.ts", "name-inferred", "Named"),
      b: ev("src/b.ts", "code-verified", "Other"),
    };
    const claim = (key, subjectId, over = {}) =>
      call(
        "add_claim",
        {
          claim_id: over.id ?? key.replace(/[^A-Za-z0-9]+/g, "-"),
          claim_key: key,
          subject_type: "symbol",
          subject_id: subjectId,
          statement: over.statement ?? `${subjectId} does its part.`,
          epistemic_kind: "observation",
          ref_sha: head,
          evidence_ids: over.evidence ?? [evidence.a],
        },
        ctx,
      );
    // Flow `boot`: four steps. Flow `other`: steps 00, 01 and 05, so step 05 is
    // a step of another flow that `boot` does not have.
    for (const step of ["00", "01", "02", "03"]) claim(`S1/flow/boot/${step}`, `src/a.ts:boot${step}`);
    for (const step of ["00", "01", "05"]) claim(`S1/flow/other/${step}`, `src/a.ts:other${step}`);
    claim("S1/key-type/src-a-ts-cfg", "src/a.ts:Cfg");
    claim("S3/flow/far/00", "src/a.ts:far00");
    claim("S1/flow/quiet/00", "src/a.ts:quiet00");
    claim("S1/flow/quiet/01", "src/a.ts:quiet01");
    // A flow whose steps are closed: its marks are not current.
    claim("S1/flow/old/00", "src/a.ts:old00");
    claim("S1/flow/old/01", "src/a.ts:old01");
    return { ctx, head, evidence, claim };
  }

  const count = (ctx, table) => ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const idOf = (key) => key.replace(/[^A-Za-z0-9]+/g, "-");
  const stems = (tool, said) => said.startsWith(`${tool} refuses:`);
  /** The session refusal is `<tool> requires an active session`; it still opens with the tool's name. */
  const named = (tool, said) => said.startsWith(tool);

  const mark = (w, claimKey, kind, over = {}) =>
    call(
      MARK,
      {
        claim_id: idOf(claimKey),
        kind,
        evidence_id: w.evidence.a,
        ref_sha: w.head,
        ...over,
      },
      w.ctx,
    );
  const claimsOf = (w, args) => call("get_claims", args, w.ctx);
  const marksOf = (w, claimKey) => {
    const rows = claimsOf(w, { claim_key: claimKey });
    return rows.length === 1 && Array.isArray(rows[0].marks) ? rows[0].marks : null;
  };
  const NO_ROW = "a refusal left a row behind";

  // ------------------------------------------- V: the tools are served, built and listed

  check("V1 the three flow-mark tools are served by the built handlers", () => absent(...NEW_TOOLS));
  const listing = await listTools(world("listing").ctx.project.workspacePath);
  check("V2 the built server lists the tools, each with a description and a schema", () => {
    if (listing.error) return listing.error;
    const wrong = [];
    for (const name of NEW_TOOLS) {
      const tool = listing.tools.find((entry) => entry.name === name);
      if (!tool) wrong.push(`${name} is not listed`);
      else if (!tool.description || tool.inputSchema?.type !== "object") wrong.push(`${name} lacks a description or schema`);
    }
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  // ------------------------------------------- M: a valid mark of each kind

  const VALID = [
    ["commit-point", "S1/flow/boot/02", {}],
    ["crash-point", "S1/flow/boot/01", { label: "index half written" }],
    ["exit", "S1/flow/boot/01", { label: "config missing", target: "leaves-flow" }],
    ["exit", "S1/flow/boot/03", { label: "retry", target: "01" }],
    ["crosses-seam", "S1/flow/boot/01", { target: "SM-01" }],
    ["crosses-seam", "S1/flow/boot/03", { target: "SM-03" }],
    ["trigger", "S1/flow/boot/00", {}],
  ];
  check("M1 a valid mark of each kind is accepted, persisted with its fields and returned by get_claims", () => {
    const w = world("m1");
    const wrong = [];
    for (const [kind, key, over] of VALID) {
      const said = refusal(() => mark(w, key, kind, over));
      if (said) wrong.push(`${kind} on ${key} was refused: ${said.slice(0, 140)}`);
    }
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  check("M2 each mark's receipt names its row, and the row holds the kind, label, target, evidence, revision and session", () => {
    const w = world("m2");
    const wrong = [];
    for (const [kind, key, over] of VALID) {
      const before = count(w.ctx, "claim_marks");
      const receipt = mark(w, key, kind, over);
      if (receipt.ok !== true || !Number.isInteger(receipt.id)) {
        wrong.push(`${kind}: the receipt was ${JSON.stringify(receipt)}`);
        continue;
      }
      const row = w.ctx.db.prepare("SELECT * FROM claim_marks WHERE id = ?").get(receipt.id);
      if (!row) wrong.push(`${kind}: no row ${receipt.id}`);
      else if (
        row.claim_id !== idOf(key) ||
        row.kind !== kind ||
        (row.label ?? null) !== (over.label ?? null) ||
        (row.target ?? null) !== (over.target ?? null) ||
        row.evidence_id !== w.evidence.a ||
        row.ref_sha !== w.head ||
        row.session_id !== w.ctx.sessionId
      ) {
        wrong.push(`${kind}: the stored row was ${JSON.stringify(row)}`);
      }
      if (count(w.ctx, "claim_marks") !== before + 1) wrong.push(`${kind}: ${count(w.ctx, "claim_marks") - before} rows were written`);
    }
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  check("M3 get_claims returns every recorded mark on its claim, with its fields, and an empty list on a claim with none", () => {
    const w = world("m3");
    const ids = new Map();
    for (const [kind, key, over] of VALID) ids.set(`${kind}|${key}|${over.target ?? ""}`, mark(w, key, kind, over).id);
    const wrong = [];
    for (const [kind, key, over] of VALID) {
      const marks = marksOf(w, key);
      if (marks === null) {
        wrong.push(`${key} returned no marks array`);
        continue;
      }
      const wanted = ids.get(`${kind}|${key}|${over.target ?? ""}`);
      const found = marks.find((entry) => entry.id === wanted);
      if (!found) {
        wrong.push(`${kind} on ${key} was not returned`);
        continue;
      }
      if (
        found.kind !== kind ||
        (found.label ?? null) !== (over.label ?? null) ||
        (found.target ?? null) !== (over.target ?? null) ||
        found.evidence_id !== w.evidence.a ||
        found.ref_sha !== w.head
      ) {
        wrong.push(`${kind} on ${key} read back as ${JSON.stringify(found)}`);
      }
    }
    const boot01 = marksOf(w, "S1/flow/boot/01")?.map((entry) => entry.kind).sort().join(",");
    if (boot01 !== "crash-point,crosses-seam,exit") wrong.push(`step 01 returned ${boot01}`);
    const bare = marksOf(w, "S1/flow/other/00");
    if (!Array.isArray(bare) || bare.length !== 0) wrong.push(`a claim with no marks returned ${JSON.stringify(bare)}`);
    const keyType = marksOf(w, "S1/key-type/src-a-ts-cfg");
    if (!Array.isArray(keyType) || keyType.length !== 0) wrong.push(`a non-flow claim returned ${JSON.stringify(keyType)}`);
    const bySubsystem = claimsOf(w, { subsystem_id: "S1" }).find((row) => row.claim_key === "S1/flow/boot/02");
    if (!bySubsystem?.marks?.some((entry) => entry.kind === "commit-point")) wrong.push("a read by subsystem_id lost the mark");
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  check("M4 a contract-stated evidence row on the subject's file is enough", () => {
    const w = world("m4");
    const said = refusal(() => mark(w, "S1/flow/boot/02", "commit-point", { evidence_id: w.evidence.aContract }));
    return said ? `refused: ${said.slice(0, 140)}` : null;
  });

  check("M5 recording the same mark again while it stands is refused; a different label is a different mark", () => {
    const w = world("m5");
    mark(w, "S1/flow/boot/01", "crash-point", { label: "index half written" });
    const before = count(w.ctx, "claim_marks");
    const said = refusal(() => mark(w, "S1/flow/boot/01", "crash-point", { label: "index half written" }));
    if (!said) return "an identical mark was accepted twice";
    if (!stems(MARK, said)) return `refused with "${said.slice(0, 120)}"`;
    if (count(w.ctx, "claim_marks") !== before) return NO_ROW;
    const other = refusal(() => mark(w, "S1/flow/boot/01", "crash-point", { label: "lock left held" }));
    return other ? `a second crash point with its own label was refused: ${other.slice(0, 120)}` : null;
  });

  // ------------------------------------------- R: what is refused

  /** Every case is refused with the tool's name, and none leaves a row. */
  function refusedCases(label, cases) {
    check(label, () => {
      const w = world(label.split(" ")[0].toLowerCase());
      const wrong = [];
      for (const [what, run] of cases(w)) {
        const before = count(w.ctx, "claim_marks");
        const said = refusal(() => run());
        if (!said) wrong.push(`${what} was accepted`);
        else if (!stems(MARK, said)) wrong.push(`${what}: refused with "${said.slice(0, 110)}"`);
        if (count(w.ctx, "claim_marks") !== before) wrong.push(`${what}: ${NO_ROW}`);
      }
      return wrong.length === 0 ? null : wrong.join("; ");
    });
  }

  refusedCases("R1 a mark on a claim that is not a flow step, or not a claim, is refused", (w) => [
    ["a mark on a key-type claim", () => mark(w, "S1/key-type/src-a-ts-cfg", "commit-point")],
    ["a mark on an unknown claim", () => call(MARK, { claim_id: "no-such-claim", kind: "commit-point", evidence_id: w.evidence.a, ref_sha: w.head }, w.ctx)],
  ]);

  check("R2 a mark on a closed claim is refused", () => {
    const w = world("r2");
    call("invalidate_claim", { claim_id: idOf("S1/flow/old/01"), at_sha: w.head, reason: "the step was misread", evidence_ids: [w.evidence.b] }, w.ctx);
    const before = count(w.ctx, "claim_marks");
    const said = refusal(() => mark(w, "S1/flow/old/01", "commit-point"));
    if (!said) return "a mark on a closed claim was accepted";
    if (!stems(MARK, said)) return `refused with "${said.slice(0, 120)}"`;
    return count(w.ctx, "claim_marks") === before ? null : NO_ROW;
  });

  refusedCases("R3 a trigger anywhere but step 00 is refused", (w) => [
    ["trigger on step 01", () => mark(w, "S1/flow/boot/01", "trigger")],
    ["trigger on step 03", () => mark(w, "S1/flow/boot/03", "trigger")],
  ]);

  refusedCases("R4 a seam crossing naming no seam, an unknown seam, or one the subsystem is not party to is refused", (w) => [
    ["crosses-seam with no target", () => mark(w, "S1/flow/boot/01", "crosses-seam")],
    ["crosses-seam naming an unknown seam", () => mark(w, "S1/flow/boot/01", "crosses-seam", { target: "SM-99" })],
    ["crosses-seam naming a seam between other subsystems", () => mark(w, "S1/flow/boot/01", "crosses-seam", { target: "SM-02" })],
    ["crosses-seam on S3's flow naming a seam S3 is not party to", () => mark(w, "S3/flow/far/00", "crosses-seam", { target: "SM-01" })],
  ]);

  refusedCases("R5 an exit naming a step of another flow, a step that does not exist, or nothing is refused", (w) => [
    ["exit to a step only another flow has", () => mark(w, "S1/flow/boot/01", "exit", { label: "gives up", target: "05" })],
    ["exit to a step that exists nowhere", () => mark(w, "S1/flow/boot/01", "exit", { label: "gives up", target: "99" })],
    ["exit to another flow's step by its claim key", () => mark(w, "S1/flow/boot/01", "exit", { label: "gives up", target: "S1/flow/other/01" })],
    ["exit with no target", () => mark(w, "S1/flow/boot/01", "exit", { label: "gives up" })],
    ["exit with no label", () => mark(w, "S1/flow/boot/01", "exit", { target: "leaves-flow" })],
  ]);

  refusedCases("R6 a crash point with no label, and a field the kind does not use, are refused", (w) => [
    ["crash-point with no label", () => mark(w, "S1/flow/boot/01", "crash-point")],
    ["crash-point with a blank label", () => mark(w, "S1/flow/boot/01", "crash-point", { label: "   " })],
    ["crash-point with a two-line label", () => mark(w, "S1/flow/boot/01", "crash-point", { label: "half\nwritten" })],
    ["crash-point with a target", () => mark(w, "S1/flow/boot/01", "crash-point", { label: "half written", target: "leaves-flow" })],
    ["commit-point with a label", () => mark(w, "S1/flow/boot/02", "commit-point", { label: "kept" })],
    ["a kind the contract does not list", () => mark(w, "S1/flow/boot/02", "checkpoint")],
  ]);

  refusedCases("R7 evidence that does not cite the subject's file in a strong kind is refused", (w) => [
    ["evidence on another file", () => mark(w, "S1/flow/boot/02", "commit-point", { evidence_id: w.evidence.b })],
    ["evidence on the file resting only on a name", () => mark(w, "S1/flow/boot/02", "commit-point", { evidence_id: w.evidence.aNamed })],
    ["evidence that does not exist", () => mark(w, "S1/flow/boot/02", "commit-point", { evidence_id: 999999 })],
  ]);

  refusedCases("R8 a revision the workspace does not reach is refused", (w) => [
    ["an unknown ref_sha", () => mark(w, "S1/flow/boot/02", "commit-point", { ref_sha: "0000000000000000000000000000000000000000" })],
  ]);

  // A mark's revision resolves, but its evidence was read at a commit that is
  // not that revision or an ancestor of it. R8's unresolvable revision cannot
  // tell the ancestry refusal from the resolution one: deleting the ancestry
  // refusal stayed green (F13/codex, slice-S1).
  check("R8b evidence read at a descendant or a sibling of the mark's revision is refused", () => {
    const w = world("r8b");
    const ws = w.ctx.project.workspacePath;
    const commit = (file, message) => {
      writeFileSync(join(ws, file), `${message}\n`);
      git(ws, "add", file);
      gitCommit(ws, message);
      return git(ws, "rev-parse", "HEAD");
    };
    const readAt = (sha) =>
      call("add_evidence", { file_path: "src/a.ts", symbol: "Unit", line_range: "1-1", ref_sha: sha, kind: "code-verified" }, w.ctx).id;
    const later = commit("later.txt", "later");
    git(ws, "checkout", "-q", "-b", "side", w.head);
    const side = commit("side.txt", "side");
    if (!later || !side || later === side || later === w.head) return "the fixture could not make two commits";
    const wrong = [];
    // Each case marks its own step, so no refusal can be a duplicate's.
    for (const [what, step, evidenceAt, markAt] of [
      ["evidence at a descendant of the mark's revision", "S1/flow/boot/01", later, w.head],
      ["evidence on a sibling branch of the mark's revision", "S1/flow/boot/02", side, later],
    ]) {
      const evidenceId = readAt(evidenceAt);
      const before = count(w.ctx, "claim_marks");
      const said = refusal(() => mark(w, step, "commit-point", { evidence_id: evidenceId, ref_sha: markAt }));
      if (!said) wrong.push(`${what} was accepted`);
      else if (!stems(MARK, said) || !said.includes(markAt)) wrong.push(`${what}: refused with "${said.slice(0, 160)}"`);
      if (count(w.ctx, "claim_marks") !== before) wrong.push(`${what}: ${NO_ROW}`);
    }
    // Control: evidence at an ancestor of the mark's revision is accepted.
    const ancestor = refusal(() => mark(w, "S1/flow/boot/03", "commit-point", { evidence_id: w.evidence.a, ref_sha: side }));
    if (ancestor) wrong.push(`evidence at an ancestor was refused: ${ancestor.slice(0, 110)}`);
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  check("R9 each tool needs an active session", () => {
    const w = world("r9");
    const none = { ...w.ctx, sessionId: null };
    const wrong = [];
    const cases = [
      [MARK, { claim_id: idOf("S1/flow/boot/02"), kind: "commit-point", evidence_id: w.evidence.a, ref_sha: w.head }],
      [DECLINE, { flow: "S1/flow/quiet", reason: "It has no commit point.", ref_sha: w.head }],
    ];
    const recorded = mark(w, "S1/flow/boot/02", "commit-point");
    cases.push([WITHDRAW, { mark_id: recorded.id, reason: "Recorded on the wrong step." }]);
    for (const [tool, args] of cases) {
      const before = ["claim_marks", "claim_mark_withdrawals", "claim_mark_declinations"].map((t) => count(w.ctx, t));
      const said = refusal(() => call(tool, args, none));
      if (!said) wrong.push(`${tool} ran with no session`);
      else if (!named(tool, said)) wrong.push(`${tool}: "${said.slice(0, 100)}"`);
      const after = ["claim_marks", "claim_mark_withdrawals", "claim_mark_declinations"].map((t) => count(w.ctx, t));
      if (before.join() !== after.join()) wrong.push(`${tool}: ${NO_ROW}`);
    }
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  // ------------------------------------------- W: withdrawal

  check("W1 a withdrawn mark is no longer returned, its row is kept, and it can be recorded again", () => {
    const w = world("w1");
    const keep = mark(w, "S1/flow/boot/01", "crash-point", { label: "index half written" });
    const drop = mark(w, "S1/flow/boot/01", "exit", { label: "config missing", target: "leaves-flow" });
    const before = count(w.ctx, "claim_marks");
    const receipt = call(WITHDRAW, { mark_id: drop.id, reason: "The exit is on the next step." }, w.ctx);
    if (receipt.ok !== true) return `the receipt was ${JSON.stringify(receipt)}`;
    const wrong = [];
    const row = w.ctx.db.prepare("SELECT * FROM claim_mark_withdrawals WHERE mark_id = ?").get(drop.id);
    if (!row || row.reason !== "The exit is on the next step." || row.session_id !== w.ctx.sessionId) {
      wrong.push(`the withdrawal row was ${JSON.stringify(row)}`);
    }
    if (count(w.ctx, "claim_marks") !== before) wrong.push("the withdrawal removed or added a mark row");
    const claim = claimsOf(w, { claim_key: "S1/flow/boot/01" })[0];
    if (claim.valid_until_sha !== null) wrong.push("the withdrawal closed the claim");
    const returned = (marksOf(w, "S1/flow/boot/01") ?? []).map((entry) => entry.id);
    if (returned.includes(drop.id)) wrong.push("a withdrawn mark is still returned as current");
    if (!returned.includes(keep.id)) wrong.push("the mark that stands was lost");
    const again = refusal(() => mark(w, "S1/flow/boot/01", "exit", { label: "config missing", target: "leaves-flow" }));
    if (again) wrong.push(`recording the exit again after its withdrawal was refused: ${again.slice(0, 120)}`);
    else if (marksOf(w, "S1/flow/boot/01")?.filter((entry) => entry.kind === "exit").length !== 1) {
      wrong.push("the re-recorded exit is not returned exactly once");
    }
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  check("W2 a withdrawal for an unknown mark, with no reason, or for a mark already withdrawn is refused", () => {
    const w = world("w2");
    const target = mark(w, "S1/flow/boot/02", "commit-point");
    const wrong = [];
    for (const [what, args] of [
      ["an unknown mark", { mark_id: 999999, reason: "Not there." }],
      ["no reason", { mark_id: target.id }],
      ["a blank reason", { mark_id: target.id, reason: "   " }],
      ["a two-paragraph reason", { mark_id: target.id, reason: "One.\n\nTwo." }],
    ]) {
      const before = count(w.ctx, "claim_mark_withdrawals");
      const said = refusal(() => call(WITHDRAW, args, w.ctx));
      if (!said) wrong.push(`${what} was accepted`);
      else if (!stems(WITHDRAW, said)) wrong.push(`${what}: refused with "${said.slice(0, 100)}"`);
      if (count(w.ctx, "claim_mark_withdrawals") !== before) wrong.push(`${what}: ${NO_ROW}`);
    }
    call(WITHDRAW, { mark_id: target.id, reason: "Wrong step." }, w.ctx);
    const before = count(w.ctx, "claim_mark_withdrawals");
    const twice = refusal(() => call(WITHDRAW, { mark_id: target.id, reason: "Wrong step." }, w.ctx));
    if (!twice) wrong.push("a mark was withdrawn twice");
    else if (!stems(WITHDRAW, twice)) wrong.push(`twice: refused with "${twice.slice(0, 100)}"`);
    if (count(w.ctx, "claim_mark_withdrawals") !== before) wrong.push(`twice: ${NO_ROW}`);
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  // ------------------------------------------- C: a closed claim's marks are not current

  check("C1 a closed claim's marks are not returned as current, and its successor starts with none and records its own", () => {
    const w = world("c1");
    const old = mark(w, "S1/flow/old/01", "commit-point");
    const stays = mark(w, "S1/flow/boot/02", "commit-point");
    const wrong = [];
    if (!(marksOf(w, "S1/flow/old/01") ?? []).some((entry) => entry.id === old.id)) {
      return "the mark was not returned while its claim was current";
    }
    // The successor needs evidence the predecessor does not carry, on the same file.
    const fresh = call(
      "add_evidence",
      { file_path: "src/a.ts", symbol: "Fresh", line_range: "1-1", ref_sha: w.head, kind: "code-verified" },
      w.ctx,
    ).id;
    call(
      "supersede_claim",
      {
        predecessor_claim_id: idOf("S1/flow/old/01"),
        successor_claim_id: "S1-flow-old-01-v2",
        statement: "old01 now does its part differently.",
        epistemic_kind: "observation",
        at_sha: w.head,
        rationale: "The step was reread.",
        evidence_ids: [fresh],
      },
      w.ctx,
    );
    const history = claimsOf(w, { claim_key: "S1/flow/old/01", include_historical: true });
    const closed = history.find((row) => row.claim_id === idOf("S1/flow/old/01"));
    const successor = history.find((row) => row.claim_id === "S1-flow-old-01-v2");
    if (!closed || !successor) return `the history held ${history.map((row) => row.claim_id).join(", ")}`;
    if (!Array.isArray(closed.marks) || closed.marks.length !== 0) {
      wrong.push(`the closed claim returned ${JSON.stringify(closed.marks)} as current`);
    }
    if (!Array.isArray(successor.marks) || successor.marks.length !== 0) {
      wrong.push(`the successor inherited ${JSON.stringify(successor.marks)}`);
    }
    if (!w.ctx.db.prepare("SELECT 1 FROM claim_marks WHERE id = ?").get(old.id)) wrong.push("the closed claim's mark row was lost");
    const own = refusal(() =>
      call(MARK, { claim_id: "S1-flow-old-01-v2", kind: "commit-point", evidence_id: fresh, ref_sha: w.head }, w.ctx),
    );
    if (own) wrong.push(`the successor's own mark was refused: ${own.slice(0, 120)}`);
    else {
      const now = claimsOf(w, { claim_key: "S1/flow/old/01" });
      if (now.length !== 1 || now[0].claim_id !== "S1-flow-old-01-v2" || now[0].marks?.length !== 1) {
        wrong.push(`the current reading was ${JSON.stringify(now.map((row) => [row.claim_id, row.marks?.length]))}`);
      }
    }
    if (!(marksOf(w, "S1/flow/boot/02") ?? []).some((entry) => entry.id === stays.id)) wrong.push("an unrelated claim lost its mark");
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  check("C2 an invalidated claim's marks are not returned as current", () => {
    const w = world("c2");
    mark(w, "S1/flow/old/00", "trigger");
    call("invalidate_claim", { claim_id: idOf("S1/flow/old/00"), at_sha: w.head, reason: "It was never a start.", evidence_ids: [w.evidence.b] }, w.ctx);
    const closed = claimsOf(w, { claim_key: "S1/flow/old/00", include_historical: true });
    if (closed.length !== 1) return `${closed.length} rows were returned`;
    return Array.isArray(closed[0].marks) && closed[0].marks.length === 0
      ? null
      : `the closed claim returned ${JSON.stringify(closed[0].marks)}`;
  });

  // ------------------------------------------- D: declinations

  check("D1 a declination is accepted, persisted, and returned by get_claims on every step of its flow", () => {
    const w = world("d1");
    const reason = "The flow has no commit point: it writes nothing.";
    const receipt = call(DECLINE, { flow: "S1/flow/quiet", reason, ref_sha: w.head }, w.ctx);
    if (receipt.ok !== true || !Number.isInteger(receipt.id)) return `the receipt was ${JSON.stringify(receipt)}`;
    const row = w.ctx.db.prepare("SELECT * FROM claim_mark_declinations WHERE id = ?").get(receipt.id);
    if (!row || row.flow_key !== "S1/flow/quiet" || row.reason !== reason || row.ref_sha !== w.head || row.session_id !== w.ctx.sessionId) {
      return `the stored row was ${JSON.stringify(row)}`;
    }
    const wrong = [];
    for (const key of ["S1/flow/quiet/00", "S1/flow/quiet/01"]) {
      const claim = claimsOf(w, { claim_key: key })[0];
      const said = claim?.mark_declination;
      if (!said || said.reason !== reason || said.ref_sha !== w.head || said.id !== receipt.id) {
        wrong.push(`${key} returned ${JSON.stringify(said)}`);
      }
    }
    const boot = claimsOf(w, { claim_key: "S1/flow/boot/00" })[0];
    if (boot?.mark_declination) wrong.push(`another flow returned ${JSON.stringify(boot.mark_declination)}`);
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  check("D2 the newest declination for a flow is the one returned, and the earlier row is kept", () => {
    const w = world("d2");
    call(DECLINE, { flow: "S1/flow/quiet", reason: "It has no commit point.", ref_sha: w.head }, w.ctx);
    const later = call(DECLINE, { flow: "S1/flow/quiet", reason: "It has no commit point and no exit.", ref_sha: w.head }, w.ctx);
    const said = claimsOf(w, { claim_key: "S1/flow/quiet/00" })[0]?.mark_declination;
    if (!said || said.id !== later.id || said.reason !== "It has no commit point and no exit.") {
      return `returned ${JSON.stringify(said)}`;
    }
    return count(w.ctx, "claim_mark_declinations") === 2 ? null : "the earlier row was not kept";
  });

  check("D3 a declination for something that is not a flow with current steps, with no reason, or at an unknown revision is refused", () => {
    const w = world("d3");
    const wrong = [];
    for (const [what, args] of [
      ["a flow with no steps", { flow: "S1/flow/nowhere", reason: "None.", ref_sha: w.head }],
      ["a step key", { flow: "S1/flow/boot/00", reason: "None.", ref_sha: w.head }],
      ["a key-type key", { flow: "S1/key-type/src-a-ts-cfg", reason: "None.", ref_sha: w.head }],
      ["a bare subsystem", { flow: "S1", reason: "None.", ref_sha: w.head }],
      ["no reason", { flow: "S1/flow/quiet", ref_sha: w.head }],
      ["a blank reason", { flow: "S1/flow/quiet", reason: "  ", ref_sha: w.head }],
      ["an unknown revision", { flow: "S1/flow/quiet", reason: "None.", ref_sha: "0000000000000000000000000000000000000000" }],
    ]) {
      const before = count(w.ctx, "claim_mark_declinations");
      const said = refusal(() => call(DECLINE, args, w.ctx));
      if (!said) wrong.push(`${what} was accepted`);
      else if (!stems(DECLINE, said)) wrong.push(`${what}: refused with "${said.slice(0, 100)}"`);
      if (count(w.ctx, "claim_mark_declinations") !== before) wrong.push(`${what}: ${NO_ROW}`);
    }
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  check("D4 a flow whose steps are all closed cannot be declined", () => {
    const w = world("d4");
    for (const step of ["00", "01"]) {
      call("invalidate_claim", { claim_id: idOf(`S1/flow/old/${step}`), at_sha: w.head, reason: "Misread.", evidence_ids: [w.evidence.b] }, w.ctx);
    }
    const said = refusal(() => call(DECLINE, { flow: "S1/flow/old", reason: "None.", ref_sha: w.head }, w.ctx));
    if (!said) return "a flow with no current step was declined";
    return stems(DECLINE, said) ? null : `refused with "${said.slice(0, 100)}"`;
  });

  // ------------------------------------------- X: a reset retires marked claims

  check("X1 a reset below structural after a current and a withdrawn mark succeeds, keeps every mark row and leaves none current", () => {
    const w = world("x1");
    mark(w, "S1/flow/boot/01", "commit-point");
    const dropped = mark(w, "S1/flow/boot/02", "crash-point", { label: "half written" });
    call(WITHDRAW, { mark_id: dropped.id, reason: "The crash is on the next step." }, w.ctx);
    const marks = count(w.ctx, "claim_marks");
    const withdrawals = count(w.ctx, "claim_mark_withdrawals");
    let receipt;
    try {
      receipt = call("reset_subsystem", { id: "S1", to_status: "scoping", reason: "Re-scope the boot flow." }, w.ctx);
    } catch (error) {
      return `the reset threw: ${String(error?.message ?? error).slice(0, 160)}`;
    }
    if (!receipt || receipt.ok === false) return `the reset was refused: ${JSON.stringify(receipt).slice(0, 200)}`;
    const wrong = [];
    if (count(w.ctx, "claim_marks") !== marks) wrong.push("the reset removed a mark row");
    if (count(w.ctx, "claim_mark_withdrawals") !== withdrawals) wrong.push("the reset removed a withdrawal row");
    const current = claimsOf(w, { subsystem_id: "S1" }).map((row) => row.claim_key);
    if (current.length > 0) wrong.push(`claims under S1/ are still current after the reset: ${current.join(", ")}`);
    for (const key of ["S1/flow/boot/01", "S1/flow/boot/02"]) {
      const row = w.ctx.db.prepare("SELECT valid_until_sha FROM claims WHERE claim_key = ?").get(key);
      if (!row) wrong.push(`the marked claim ${key} was deleted from under its marks`);
      else if (row.valid_until_sha === null) wrong.push(`the marked claim ${key} is still current`);
    }
    if (w.ctx.db.prepare("SELECT 1 FROM claims WHERE claim_key = 'S1/flow/boot/03'").get()) {
      wrong.push("an unmarked claim under S1/ survived the reset");
    }
    // The key is free again: the re-surveyed step can be recorded and marked.
    const again = refusal(() => w.claim("S1/flow/boot/01", "src/a.ts:boot01", { id: "S1-flow-boot-01-v2" }));
    if (again) wrong.push(`re-recording the reset step was refused: ${again.slice(0, 120)}`);
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  for (const cleanup of cleanups) cleanup();
  rmSync(scratch, { recursive: true, force: true });
}

// ------------------------------------------------------------------- the driver

let exitCode = 0;
try {
  // Load the subject defensively: an absent build or module must produce this
  // gate's red line, not a stack trace. `dist/` is a build artifact, so the
  // gate compiles it first; a compile failure is this gate's red line.
  const built = ensureBuilt();
  const mods = {};
  let loadError = null;
  try {
    if (!built.ok) throw new Error(built.detail);
    ({ openDatabase: mods.openDatabase } = await import("./dist/db.js"));
    ({ resolveProject: mods.resolveProject, ensureProjectStorage: mods.ensureProjectStorage } =
      await import("./dist/project.js"));
    const [claims, evidence, project, subsystems] = await Promise.all([
      import("./dist/tools/claims.js"),
      import("./dist/tools/evidence.js"),
      import("./dist/tools/project.js"),
      import("./dist/tools/subsystems.js"),
    ]);
    mods.toolArrays = [claims.claimTools, evidence.evidenceTools, project.projectTools, subsystems.subsystemTools];
  } catch (error) {
    loadError = `the server build could not be loaded: ${scrub(error?.message ?? error)}`;
  }
  if (!loadError) {
    try {
      const marks = await import("./dist/tools/claim-marks.js");
      mods.toolArrays.push(marks.claimMarkTools ?? []);
    } catch {
      /* the tools are absent; V1 says so */
    }
  }

  if (loadError) {
    checked++;
    failures.push(`V1 the flow-mark tools are not served — ${loadError}`);
  } else {
    await main(mods);
  }
} catch (error) {
  failures.push(`X9 the gate did not finish: ${scrub(error?.message ?? error)}`);
}

console.log(`  ran  ${checked} assertion(s) against ${join(here, "dist")}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`GATE SO5 RED: ${failures[0]}`);
  exitCode = 1;
} else {
  console.log("GATE SO5 GREEN");
}
process.exit(exitCode);
