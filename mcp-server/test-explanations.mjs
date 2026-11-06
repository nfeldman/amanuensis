#!/usr/bin/env node
// GATE EX9 (design/explanation/spec.md §3.1-§3.3) — the explanation record.
//
// A subsystem page can say what the survey measured and cannot say what the
// subsystem is *for*, because nothing the survey writes holds the sentence. §3
// adds the place: an append-only `explanations` table, an effective-row reader
// that skips a revision the workspace can no longer reach, and the two writers
// `record_explanation` and `decline_explanation`. `get_explanations` and the
// reset rule are EX15's and are not asserted here.
//
// The gate asserts behaviour, not presence. It drives the built tool handlers
// over fixtures it creates itself (temporary git workspaces and stores), reads
// `tools/list` from the built server over stdio, and runs the selection
// function over the shared case file. It never creates the two tables or their
// triggers: a store whose schema does not ship them fails the assertions that
// read them, which is the point.
//
//   exit 0  `GATE EX9 GREEN`          — every assertion held
//   exit 1  `GATE EX9 RED: <reason>`  — the first assertion that failed
//
// The first assertion (E1) is the packet's red_expect: the writer is refused for
// a subsystem that is not explanation-eligible. On a tree with no writer, the
// tool is absent and E1 reports exactly that, so the red run reaches an
// assertion and never a stack trace. The launcher matches red_expect from the
// start of the status line's reason, so E1's label opens with the phrase and
// carries its id at the end, unlike every other label here.
//
// Must-stay-green controls (a kill proves a gate can fire, never that it fires
// selectively):
//   G1  a ten-byte purpose with one evidence row is accepted — no floor
//   G2  a mixed set of ledger and outside files is accepted (R7)
//   G3  a set of one code-verified row beside a name-inferred one is accepted (R6)
//   G4  an account may carry list lines; a purpose may not (§3.3)
//   G5  decline_explanation is accepted over an already-recorded explanation
//
// What a reviewer should sabotage, and what must go red:
//   let an ineligible subsystem be recorded                        → E1, E2
//   drop any of R1-R8 or the decline conditions                    → R*, X*
//   count characters instead of UTF-8 bytes                        → B3
//   move a cap by one byte                                         → B1, B2, B4
//   echo the body or the evidence rows in the receipt              → W2
//   drop either trigger of either table                            → A1-A4
//   take the greatest id without resolving ref_sha                 → S3
//   treat a withdrawn or ineligible subject as recorded            → S4, S5
//   require two evidence rows or a minimum length                  → G1
//   require every cited file to be in the ledger                   → G2
//   declare the tools without serving or advertising them          → V1

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

// A crash signature in this gate's output means the run never reached its
// assertion, so the launcher rejects it as a red proof. Assertion detail is
// quoted from live errors, so it is scrubbed rather than trusted. The elided
// form breaks the token in the middle so the marker does not keep the signature.
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
        clientInfo: { name: "ex9", version: "0" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

// --------------------------------------------------------------- the gate body

const RECORD = "record_explanation";
const DECLINE = "decline_explanation";
const ELIGIBLE_STATUSES = ["structural", "concerns", "adversarial", "mapped"];
const INELIGIBLE_STATUSES = ["unmapped", "scoping", "deferred"];
const NAME_ONLY = ["name-inferred", "pattern-matched"];

async function main(mods) {
  const { openDatabase, resolveProject, ensureProjectStorage, toolArrays } = mods;

  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  function call(name, args, ctx) {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    return td.handler(args, ctx);
  }
  const absent = (name) =>
    allTools.has(name) ? null : `${name} is absent from the server's tool surface`;

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-ex9-"));
  const cleanups = [];

  function git(cwd, ...args) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return String(result.stdout ?? "").trim();
  }
  function gitCommit(cwd, message) {
    spawnSync(
      "git",
      [
        "-c", "user.email=ex9@localhost",
        "-c", "user.name=explanation-ex9",
        "-c", "commit.gpgsign=false",
        "commit", "-q", "--no-verify", "-m", message,
      ],
      { cwd, encoding: "utf8" },
    );
  }

  /** A fresh workspace, store and open session. Every assertion that writes gets its own. */
  function world(label) {
    const ws = join(scratch, `ws-${label}`);
    mkdirSync(ws, { recursive: true });
    git(ws, "init", "-q");
    for (const name of ["src/a.ts", "src/b.ts", "src/c.ts"]) {
      mkdirSync(dirname(join(ws, name)), { recursive: true });
      writeFileSync(join(ws, name), `export const ${name.slice(4, 5)} = 1;\n`);
    }
    git(ws, "add", "-A");
    gitCommit(ws, "seed");
    const project = resolveProject(ws, { selectionSource: "ex9-explanations" });
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
    ctx.sessionId = call("start_session", { intent: `ex9-${label}` }, ctx).session_id;
    return ctx;
  }
  const headSha = (ctx) => git(ctx.project.workspacePath, "rev-parse", "HEAD");
  /** A well-formed 40-hex object name no repository here carries. */
  const UNREACHABLE_SHA = "b0a7e5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c";

  /** A subsystem at a status, seeded around the ladder: the writers read the status, not the climb. */
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
  function evidence(ctx, file = "src/a.ts", kind = "code-verified") {
    return call(
      "add_evidence",
      { file_path: file, symbol: "Unit", line_range: "1-1", ref_sha: headSha(ctx), kind },
      ctx,
    ).id;
  }
  const rowsOf = (ctx, table = "explanations") =>
    ctx.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
  const countRows = (ctx) => rowsOf(ctx).length;

  const record = (ctx, over = {}) =>
    call(
      RECORD,
      {
        subject_type: "subsystem",
        subject_id: "S-01",
        slot: "purpose",
        body: "It lets a reader find what a file is for.",
        evidence_ids: [over.evidenceId ?? evidence(ctx)],
        ref_sha: headSha(ctx),
        ...over.args,
      },
      ctx,
    );
  const decline = (ctx, over = {}) =>
    call(
      DECLINE,
      {
        subject_type: "subsystem",
        subject_id: "S-01",
        slot: "purpose",
        reason: "The code does not say what this part is for.",
        ref_sha: headSha(ctx),
        ...over,
      },
      ctx,
    );

  /** Assert a refusal begins with a stem, and that it stored nothing. */
  function refusesWith(ctx, run, stem, label) {
    const before = mods.explanationsTable ? countRows(ctx) : 0;
    const said = refusal(run);
    if (!said) return `${label} was accepted; expected a refusal beginning "${stem}"`;
    if (!said.startsWith(stem)) {
      return `${label} was refused with "${said.slice(0, 160)}", not a message beginning "${stem}"`;
    }
    if (mods.explanationsTable && countRows(ctx) !== before) {
      return `${label} was refused and a row was stored anyway`;
    }
    return null;
  }

  // ------------------------------------------------- E: the eligibility refusals

  {
    const ctx = world("eligibility");
    const stemR2 = (tool, id, status) =>
      `${tool} refuses: ${id} is '${status}'. An explanation is written by a pass that has read the subsystem`;

    check("record_explanation is not refused for a subsystem that is not explanation-eligible (E1)", () => {
      // The red_expect assertion. On a tree without the tool the failure says so.
      const missing = absent(RECORD);
      if (missing) {
        return `${missing}, so nothing refuses an explanation for a subsystem nobody has read (R2)`;
      }
      if (!mods.explanationsTable) {
        return "the store has no explanations table, so the refusal has nowhere to hold a row";
      }
      const evidenceId = evidence(ctx);
      const wrong = [];
      for (const status of INELIGIBLE_STATUSES) {
        const id = seedSubsystem(ctx, `E-${status}`, status);
        const said = refusal(() =>
          record(ctx, { evidenceId, args: { subject_id: id } }),
        );
        if (!said) wrong.push(`${status} was accepted`);
        else if (!said.startsWith(stemR2(RECORD, id, status))) {
          wrong.push(`${status} was refused with "${said.slice(0, 120)}"`);
        }
      }
      if (countRows(ctx) !== 0) wrong.push("a refused write stored a row");
      return wrong.length === 0
        ? null
        : `${wrong.join("; ")} — an explanation is written by a pass that has read the subsystem`;
    });

    check("E2 every eligible status accepts a write", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const wrong = [];
      for (const status of ELIGIBLE_STATUSES) {
        const id = seedSubsystem(ctx, `E-ok-${status}`, status);
        const said = refusal(() => record(ctx, { args: { subject_id: id } }));
        if (said) wrong.push(`${status} was refused: ${said.slice(0, 120)}`);
      }
      return wrong.length === 0 ? null : wrong.join("; ");
    });

    check("E3 decline_explanation applies the same eligibility condition with its own stem", () => {
      const missing = absent(DECLINE);
      if (missing) return missing;
      const wrong = [];
      for (const status of INELIGIBLE_STATUSES) {
        const id = `E-${status}`;
        const said = refusal(() => decline(ctx, { subject_id: id }));
        if (!said) wrong.push(`${status} was accepted`);
        else if (!said.startsWith(stemR2(DECLINE, id, status))) {
          wrong.push(`${status} was refused with "${said.slice(0, 120)}"`);
        }
      }
      const eligible = refusal(() => decline(ctx, { subject_id: "E-ok-structural" }));
      if (eligible) wrong.push(`an eligible subsystem was refused: ${eligible.slice(0, 120)}`);
      return wrong.length === 0 ? null : wrong.join("; ");
    });
  }

  // ----------------------------------------------- R: the other refusals, by stem

  {
    const ctx = world("refusals");
    seedSubsystem(ctx, "S-01", "structural", ["src/a.ts"]);
    const ev = evidence(ctx, "src/a.ts");
    const outside = evidence(ctx, "src/b.ts");
    const nameOnly = evidence(ctx, "src/a.ts", "name-inferred");
    const patternOnly = evidence(ctx, "src/a.ts", "pattern-matched");
    const T = (tool) => `${tool} refuses:`;

    for (const tool of [RECORD, DECLINE]) {
      const run = (over) => (tool === RECORD ? record(ctx, { evidenceId: ev, args: over }) : decline(ctx, over));
      check(`R1 ${tool} refuses a subsystem that does not exist`, () => {
        const missing = absent(tool);
        if (missing) return missing;
        return refusesWith(
          ctx,
          () => run({ subject_id: "S-404" }),
          `${T(tool)} no subsystem S-404`,
          "a missing subsystem",
        );
      });
      check(`R4 ${tool} refuses the project's purpose`, () => {
        const missing = absent(tool);
        if (missing) return missing;
        return refusesWith(
          ctx,
          () => run({ subject_type: "project", subject_id: "project", slot: "purpose" }),
          `${T(tool)} the project's purpose is the thesis in entry-point.md`,
          "a project purpose",
        );
      });
    }

    check("R3 record_explanation refuses a project account while no subsystem has reached structural", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const empty = world("r3");
      seedSubsystem(empty, "S-09", "scoping");
      const wrong = [];
      for (const tool of [RECORD, DECLINE]) {
        const said = refusal(() =>
          tool === RECORD
            ? record(empty, { args: { subject_type: "project", subject_id: "project", slot: "account" } })
            : decline(empty, { subject_type: "project", subject_id: "project", slot: "account" }),
        );
        const stem = `${tool} refuses: no subsystem has been read to 'structural'`;
        if (!said || !said.startsWith(stem)) {
          wrong.push(`${tool} gave ${said ? `"${said.slice(0, 100)}"` : "no refusal"}`);
        }
      }
      // The project account is accepted once one subsystem is eligible.
      const accepted = refusal(() =>
        record(ctx, { evidenceId: ev, args: { subject_type: "project", subject_id: "project", slot: "account" } }),
      );
      if (accepted) wrong.push(`the project account was refused with a structural subsystem: ${accepted.slice(0, 100)}`);
      return wrong.length === 0 ? null : wrong.join("; ");
    });

    check("R5 record_explanation refuses an empty or unknown evidence list", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const stem = `${T(RECORD)} an explanation cites the evidence it was written from`;
      return (
        refusesWith(ctx, () => record(ctx, { args: { evidence_ids: [] } }), stem, "an empty evidence list") ??
        refusesWith(ctx, () => record(ctx, { args: { evidence_ids: [987654] } }), stem, "an unknown evidence id") ??
        refusesWith(ctx, () => record(ctx, { args: { evidence_ids: [ev, 987654] } }), stem, "a list naming one unknown id")
      );
    });

    check("R6 record_explanation refuses evidence that rests only on names and patterns", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const stem = `${T(RECORD)} an explanation resting only on names and patterns`;
      const one = refusesWith(ctx, () => record(ctx, { args: { evidence_ids: [nameOnly] } }), stem, "one name-inferred row");
      if (one) return one;
      const both = refusesWith(
        ctx,
        () => record(ctx, { args: { evidence_ids: [nameOnly, patternOnly] } }),
        stem,
        "name-inferred and pattern-matched rows",
      );
      if (both) return both;
      const mixed = refusal(() => record(ctx, { args: { evidence_ids: [nameOnly, ev] } }));
      return mixed ? `G3 a set with one code-verified row was refused: ${mixed.slice(0, 120)}` : null;
    });

    check("R7 record_explanation refuses a set none of whose files is in the subsystem's ledger", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const stem = `${T(RECORD)} none of the cited evidence is in S-01's ledger`;
      const refused = refusesWith(ctx, () => record(ctx, { args: { evidence_ids: [outside] } }), stem, "an outside file");
      if (refused) return refused;
      const mixed = refusal(() => record(ctx, { args: { evidence_ids: [outside, ev] } }));
      return mixed ? `G2 a set mixing a ledger file with an outside file was refused: ${mixed.slice(0, 120)}` : null;
    });

    check("R7b the project account is not held to any subsystem's ledger", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const said = refusal(() =>
        record(ctx, {
          args: { subject_type: "project", subject_id: "project", slot: "account", evidence_ids: [outside] },
        }),
      );
      return said ? `a project account citing a file in no ledger was refused: ${said.slice(0, 120)}` : null;
    });

    check("R0 an unresolvable ref_sha and a missing session are refused", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const wrong = [];
      for (const tool of [RECORD, DECLINE]) {
        const said = refusal(() =>
          tool === RECORD
            ? record(ctx, { evidenceId: ev, args: { ref_sha: UNREACHABLE_SHA } })
            : decline(ctx, { ref_sha: UNREACHABLE_SHA }),
        );
        if (!said) wrong.push(`${tool} accepted a ref_sha the workspace cannot reach`);
        const sessionless = { ...ctx, sessionId: null };
        const noSession = refusal(() =>
          tool === RECORD ? record(sessionless, { evidenceId: ev }) : decline(sessionless),
        );
        if (!noSession || !/active session/.test(noSession)) {
          wrong.push(`${tool} was not refused for want of an active session`);
        }
      }
      return wrong.length === 0 ? null : wrong.join("; ");
    });
  }

  // -------------------------------------------------------- B: the byte caps

  {
    const ctx = world("caps");
    seedSubsystem(ctx, "S-01", "structural");
    const ev = evidence(ctx);
    const rec = (over) => record(ctx, { evidenceId: ev, args: over });
    const stem = (slot, n) => `${RECORD} refuses: ${slot} is limited to ${n} bytes`;
    const bytes = (text) => Buffer.byteLength(text, "utf8");

    check("B1 a purpose is capped at 400 UTF-8 bytes: 400 accepted, 401 refused", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const atCap = "a".repeat(400);
      const over = "a".repeat(401);
      const accepted = refusal(() => rec({ body: atCap }));
      if (accepted) return `a 400-byte purpose was refused: ${accepted.slice(0, 120)}`;
      return refusesWith(ctx, () => rec({ body: over }), stem("purpose", 400), "a 401-byte purpose");
    });

    check("B2 an account is capped at 4096 bytes: 4096 accepted, 4097 refused", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const accepted = refusal(() => rec({ slot: "account", body: "a".repeat(4096) }));
      if (accepted) return `a 4096-byte account was refused: ${accepted.slice(0, 120)}`;
      return refusesWith(
        ctx,
        () => rec({ slot: "account", body: "a".repeat(4097) }),
        stem("account", 4096),
        "a 4097-byte account",
      );
    });

    check("B3 the cap counts bytes, not characters", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const twoByte = "é".repeat(200); // 200 characters, 400 bytes
      if (bytes(twoByte) !== 400) return "the fixture is not 400 bytes";
      const accepted = refusal(() => rec({ body: twoByte }));
      if (accepted) return `200 two-byte characters (400 bytes) were refused: ${accepted.slice(0, 120)}`;
      return refusesWith(
        ctx,
        () => rec({ body: `${"é".repeat(200)}a` }),
        stem("purpose", 400),
        "400 bytes plus one",
      );
    });

    check("B4 decline_explanation limits the reason to 400 bytes and one paragraph", () => {
      const missing = absent(DECLINE);
      if (missing) return missing;
      const stemD = `${DECLINE} refuses: a reason is limited to 400 bytes`;
      const accepted = refusal(() => decline(ctx, { reason: "a".repeat(400) }));
      if (accepted) return `a 400-byte reason was refused: ${accepted.slice(0, 120)}`;
      return (
        refusesWith(ctx, () => decline(ctx, { reason: "a".repeat(401) }), stemD, "a 401-byte reason") ??
        refusesWith(
          ctx,
          () => decline(ctx, { reason: "First paragraph.\n\nSecond paragraph." }),
          `${DECLINE} refuses: a reason is one paragraph`,
          "a two-paragraph reason",
        ) ??
        refusesWith(
          ctx,
          () => decline(ctx, { slot: "account", reason: "x".repeat(401) }),
          stemD,
          "a 401-byte account reason (the reason cap is 400 for either slot)",
        ) ??
        refusesWith(
          ctx,
          () => decline(ctx, { reason: "First paragraph.\r\rSecond paragraph." }),
          `${DECLINE} refuses: a reason is one paragraph`,
          "a reason whose blank line is written in carriage returns",
        ) ??
        refusesWith(
          ctx,
          () => decline(ctx, { reason: "It has no account.\r# Sneaked" }),
          `${DECLINE} refuses: a reason is one paragraph`,
          "a reason that opens a heading after a carriage return",
        )
      );
    });

    check("B5 a purpose is one paragraph: no blank line, no #, -, * or | line", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const stemP = `${RECORD} refuses: a purpose is one paragraph`;
      for (const [label, body] of [
        ["a blank line", "First sentence.\n\nSecond sentence."],
        ["a heading line", "First sentence.\n# Heading"],
        ["a dash list line", "- one item"],
        ["a star list line", "First sentence.\n* one item"],
        ["a table line", "| a | b |"],
        // The page splits lines on every separator Python's splitlines() knows, so
        // a heading behind any of them is a heading to the reader (F2/claude, final).
        ["a carriage-return heading", "First sentence.\r## Sneaked"],
        ["a blank line in carriage returns", "First sentence.\r\rSecond sentence."],
        ["a blank line in CRLF", "First sentence.\r\n\r\nSecond sentence."],
        ["a heading behind a line separator", "First sentence.\u2028# Sneaked"],
        ["a list behind a paragraph separator", "First sentence.\u2029- one item"],
        ["a list behind a form feed", "First sentence.\f- one item"],
        ["a table behind a vertical tab", "First sentence.\v| a | b |"],
        ["a heading behind a next line", "First sentence.\u0085# Sneaked"],
        ["a heading behind a file separator", "First sentence.\u001c# Sneaked"],
      ]) {
        const wrong = refusesWith(ctx, () => rec({ body }), stemP, label);
        if (wrong) return wrong;
      }
      return null;
    });

    check("G4 an account is prose and lists: list lines pass, # and | lines do not", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const listy = "It has three parts.\n\n- the reader\n* the writer\n1. the gate\n\nControl passes through each in turn.";
      const accepted = refusal(() => rec({ slot: "account", body: listy }));
      if (accepted) return `an account with list lines and a blank line was refused: ${accepted.slice(0, 120)}`;
      const crlf = "It has three parts.\r\n\r\n- the reader\r\n- the writer\r\n";
      const acceptedCrlf = refusal(() => rec({ slot: "account", body: crlf }));
      if (acceptedCrlf) return `an account with CRLF line ends was refused: ${acceptedCrlf.slice(0, 120)}`;
      for (const [label, body] of [
        ["a heading line", "Intro.\n## How it works"],
        ["a table line", "Intro.\n| a | b |"],
        ["a carriage-return heading", "Intro.\r## How it works"],
        ["a CRLF heading", "Intro.\r\n# Sneaked"],
        ["a heading behind a line separator", "Intro.\u2028## Sneaked"],
        ["a heading behind a form feed", "Intro.\f# Sneaked"],
        ["a table behind a vertical tab", "Intro.\v| a | b |"],
      ]) {
        const said = refusal(() => rec({ slot: "account", body }));
        if (!said) return `an account with ${label} was accepted; it could introduce structure above H3`;
        if (!said.startsWith(`${RECORD} refuses:`)) return `${label} was refused without the stem: "${said.slice(0, 100)}"`;
      }
      return null;
    });
  }

  // -------------------------------------------------- W: the receipt and the floor

  {
    const ctx = world("receipt");
    seedSubsystem(ctx, "S-01", "structural");
    const ev = evidence(ctx);
    const KEYS = ["disposition", "id", "ref_sha", "slot", "subject_id", "subject_type"];

    check("W1 a valid purpose and account are accepted and stored with their evidence", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      if (!mods.explanationsTable) return "the store has no explanations table";
      const purpose = record(ctx, { evidenceId: ev });
      const account = record(ctx, {
        evidenceId: ev,
        args: { slot: "account", body: "Control passes from the reader to the writer.\n\n- reader\n- writer" },
      });
      const rows = rowsOf(ctx);
      if (rows.length !== 2) return `${rows.length} rows stored for two writes`;
      const first = rows[0];
      if (first.disposition !== "recorded" || first.slot !== "purpose" || first.subject_type !== "subsystem") {
        return `the purpose row is ${JSON.stringify({ d: first.disposition, s: first.slot })}`;
      }
      if (first.session_id !== ctx.sessionId) return "the row is not attributed to the active session";
      if (first.ref_sha !== headSha(ctx)) return "the row does not carry the resolved ref_sha";
      const joined = rowsOf(ctx, "explanation_evidence");
      if (joined.length !== 2 || joined.some((r) => r.evidence_id !== ev)) {
        return `explanation_evidence holds ${JSON.stringify(joined)} for two writes citing evidence ${ev}`;
      }
      if (purpose.id !== first.id || account.id === purpose.id) return "the receipt ids do not match the rows";
      return null;
    });

    check("W2 a successful write returns only the six-field receipt, never the body or the evidence", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const body = "Receipt body that must not be echoed.";
      const receipt = record(ctx, { evidenceId: ev, args: { body } });
      const keys = Object.keys(receipt).filter((k) => k !== "ok").sort();
      if (JSON.stringify(keys) !== JSON.stringify(KEYS)) return `the receipt carries ${JSON.stringify(keys)}`;
      if (JSON.stringify(receipt).includes(body)) return "the receipt echoes the body";
      const declined = decline(ctx, { reason: "Reason that must not be echoed." });
      const dkeys = Object.keys(declined).filter((k) => k !== "ok").sort();
      if (JSON.stringify(dkeys) !== JSON.stringify(KEYS)) return `the declination receipt carries ${JSON.stringify(dkeys)}`;
      if (declined.disposition !== "declined" || receipt.disposition !== "recorded") {
        return `dispositions are ${receipt.disposition} and ${declined.disposition}`;
      }
      return JSON.stringify(declined).includes("Reason that must not") ? "the declination receipt echoes the reason" : null;
    });

    check("W3 the response is the same size for a ten-byte body and a body at the cap", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const fresh = world("receipt-size");
      seedSubsystem(fresh, "S-01", "structural");
      const e = evidence(fresh);
      const small = record(fresh, { evidenceId: e, args: { slot: "account", body: "ten bytes!" } });
      const big = record(fresh, { evidenceId: e, args: { slot: "account", body: "b".repeat(4096) } });
      const a = JSON.stringify(small).length;
      const b = JSON.stringify(big).length;
      return a === b ? null : `a ten-byte body answered with ${a} bytes and a 4096-byte body with ${b}`;
    });

    check("G1 a ten-byte purpose with one evidence row is accepted: no floor", () => {
      const missing = absent(RECORD);
      if (missing) return missing;
      const fresh = world("floor");
      seedSubsystem(fresh, "S-01", "structural");
      const said = refusal(() => record(fresh, { args: { body: "tenbytes!!" } }));
      return said ? `a ten-byte purpose with one evidence row was refused: ${said.slice(0, 160)}` : null;
    });

    check("G5 decline_explanation is accepted over an already-recorded explanation", () => {
      const missing = absent(DECLINE);
      if (missing) return missing;
      const fresh = world("decline-over");
      seedSubsystem(fresh, "S-01", "structural");
      record(fresh, {});
      const said = refusal(() => decline(fresh));
      if (said) return `a declination over a recorded purpose was refused: ${said.slice(0, 160)}`;
      const reading = mods.readExplanation?.(fresh.db, fresh.project.workspacePath, "subsystem", "S-01", "purpose");
      return reading?.state === "declined" ? null : `the newest row did not become effective: state ${reading?.state}`;
    });
  }

  // --------------------------------------------------------- A: append-only

  {
    const ctx = world("appendonly");
    seedSubsystem(ctx, "S-01", "structural");
    const first = absent(RECORD) ? null : record(ctx, {});
    const evidenceId = first ? rowsOf(ctx, "explanation_evidence")[0]?.evidence_id : null;
    const mutate = (sql, ...params) => refusal(() => ctx.db.prepare(sql).run(...params));

    check("A1 an explanations row cannot be updated", () => {
      if (!first) return `${RECORD} did not write the row this assertion mutates`;
      const said = mutate("UPDATE explanations SET body = ? WHERE id = ?", "rewritten", first.id);
      if (!said) return "an UPDATE on explanations succeeded; an explanation edited after the fact is not a record of what was concluded and when";
      const row = rowsOf(ctx)[0];
      return row?.body === "rewritten" ? "the UPDATE was refused and the row changed anyway" : null;
    });
    check("A2 an explanations row cannot be deleted", () => {
      if (!first) return `${RECORD} did not write the row this assertion mutates`;
      const said = mutate("DELETE FROM explanations WHERE id = ?", first.id);
      if (!said) return "a DELETE on explanations succeeded; an earlier explanation is kept and never rendered as current (GP18)";
      return countRows(ctx) === 1 ? null : "the DELETE was refused and the row went anyway";
    });
    check("A3 an explanation_evidence row cannot be updated", () => {
      if (!first) return `${RECORD} did not write the row this assertion mutates`;
      const said = mutate(
        "UPDATE explanation_evidence SET evidence_id = ? WHERE explanation_id = ?",
        evidenceId,
        first.id,
      );
      return said ? null : "an UPDATE on explanation_evidence succeeded; the evidence an explanation cites is part of the record";
    });
    check("A4 an explanation_evidence row cannot be deleted", () => {
      if (!first) return `${RECORD} did not write the row this assertion mutates`;
      const said = mutate("DELETE FROM explanation_evidence WHERE explanation_id = ?", first.id);
      if (!said) return "a DELETE on explanation_evidence succeeded";
      return rowsOf(ctx, "explanation_evidence").length === 1 ? null : "the DELETE was refused and the row went anyway";
    });
    check("A5 the schema enforces the project-account and slot rules itself", () => {
      if (!first) return `${RECORD} did not write the row this assertion reads`;
      const insert = (type, id, slot, disposition, body = "x") =>
        refusal(() =>
          ctx.db
            .prepare(
              `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(type, id, slot, disposition, body, headSha(ctx), ctx.sessionId),
        );
      const wrong = [];
      if (!insert("project", "project", "purpose", "recorded")) wrong.push("a project purpose row was stored");
      if (!insert("project", "S-01", "account", "recorded")) wrong.push("a project row with a subsystem id was stored");
      if (!insert("subsystem", "S-01", "summary", "recorded")) wrong.push("an unknown slot was stored");
      if (!insert("subsystem", "S-01", "purpose", "superseded")) wrong.push("an unknown disposition was stored");
      if (!insert("subsystem", "S-01", "purpose", "recorded", "")) wrong.push("an empty body was stored");
      if (insert("subsystem", "S-01", "purpose", "withdrawn", "reset")) wrong.push("a withdrawn row was refused");
      return wrong.length === 0 ? null : wrong.join("; ");
    });
  }

  // ----------------------------------------------- S: the effective explanation

  {
    const cases = mods.cases;
    check("S1 the shared case file carries the six cases §3.2 lists", () => {
      if (!cases) return "mcp-server/contracts/explanation-effective-cases.json is absent or unreadable";
      if (!Array.isArray(cases.cases) || cases.cases.length < 6) return "the case file holds fewer than six cases";
      const kinds = new Set(cases.cases.map((c) => c.kind));
      const want = ["superseded", "declined", "withdrawn", "unreachable", "no-workspace", "ineligible"];
      const missing = want.filter((k) => !kinds.has(k));
      if (missing.length) return `no case of kind ${missing.join(", ")}`;
      const bad = cases.cases.filter(
        (c) => typeof c.id !== "string" || !c.expect || typeof c.expect.state !== "string" || !("row_id" in c.expect),
      );
      return bad.length === 0 ? null : `a case carries no expected state and row id: ${JSON.stringify(bad[0]).slice(0, 120)}`;
    });

    check("S2 the pure selection function gives every shared case its expected state and row id", () => {
      if (typeof mods.selectExplanation !== "function") {
        return "dist/invariants.js exports no selectExplanation, so the shared cases have nothing to run over";
      }
      if (!cases?.cases) return "the shared case file is unavailable";
      const wrong = [];
      for (const c of cases.cases) {
        const resolvable = c.workspace === false ? null : new Set(c.resolvable ?? []);
        const got = mods.selectExplanation(c.rows, resolvable, c.eligible !== false);
        const gotId = got?.row ? got.row.id : null;
        if (got?.state !== c.expect.state || gotId !== c.expect.row_id) {
          wrong.push(`${c.id}: got ${got?.state}/${gotId}, expected ${c.expect.state}/${c.expect.row_id}`);
        }
        if (c.expect.checked !== undefined && got?.checked !== c.expect.checked) {
          wrong.push(`${c.id}: checked ${got?.checked}, expected ${c.expect.checked}`);
        }
      }
      return wrong.length === 0 ? null : wrong.join("; ");
    });

    // Python read the project's eligibility from its subsystems and this reader
    // did not, so one store answered two ways (slice-S2, F5/codex).
    check("S6 the shared subject-eligibility cases hold", () => {
      if (typeof mods.isSubjectExplanationEligible !== "function") {
        return "dist/invariants.js exports no isSubjectExplanationEligible";
      }
      const eligibility = cases?.subject_eligibility;
      if (!Array.isArray(eligibility) || eligibility.length < 5) return "the case file holds no subject_eligibility cases";
      const wrong = eligibility
        .filter((c) => mods.isSubjectExplanationEligible(c.subject_type, c.status, c.all_statuses) !== c.eligible)
        .map((c) => c.id);
      return wrong.length === 0 ? null : `wrong for ${wrong.join(", ")}`;
    });

    check("S3 readExplanation takes the newest row whose ref_sha resolves, and a same-commit correction wins", () => {
      if (typeof mods.readExplanation !== "function") return "dist/invariants.js exports no readExplanation";
      const missing = absent(RECORD);
      if (missing) return missing;
      const ctx = world("effective");
      seedSubsystem(ctx, "S-01", "structural");
      const ev = evidence(ctx);
      const read = () => mods.readExplanation(ctx.db, ctx.project.workspacePath, "subsystem", "S-01", "purpose");
      const one = record(ctx, { evidenceId: ev, args: { body: "The first account." } });
      const two = record(ctx, { evidenceId: ev, args: { body: "The corrected account at the same commit." } });
      let reading = read();
      if (reading.state !== "recorded" || reading.row?.id !== two.id) {
        return `a second row at the same commit is not effective: got ${reading.state}/${reading.row?.id}, wanted recorded/${two.id}`;
      }
      if (reading.checked !== true) return "a bound workspace did not produce a checked reading";
      // A newer row at a revision the workspace cannot reach is skipped.
      ctx.db
        .prepare(
          `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
           VALUES ('subsystem','S-01','purpose','recorded','written at a collected revision',?,?)`,
        )
        .run(UNREACHABLE_SHA, ctx.sessionId);
      reading = read();
      if (reading.row?.id !== two.id) {
        return `a row with an unreachable ref_sha was not skipped: the effective row is ${reading.row?.id}, wanted ${two.id} (${one.id} is older)`;
      }
      if (reading.earlierRows === undefined) return "the reading does not count earlier rows";
      return null;
    });

    check("S4 a withdrawn effective row reads as not-recorded; a declined row as declined", () => {
      if (typeof mods.readExplanation !== "function") return "dist/invariants.js exports no readExplanation";
      const ctx = world("withdrawn");
      seedSubsystem(ctx, "S-01", "structural");
      const head = headSha(ctx);
      const insert = (slot, disposition, body) =>
        ctx.db
          .prepare(
            `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
             VALUES ('subsystem','S-01',?,?,?,?,?)`,
          )
          .run(slot, disposition, body, head, ctx.sessionId).lastInsertRowid;
      insert("purpose", "recorded", "was recorded");
      insert("purpose", "withdrawn", "withdrawn by a reset");
      insert("account", "declined", "nothing true to say");
      const read = (slot) => mods.readExplanation(ctx.db, ctx.project.workspacePath, "subsystem", "S-01", slot);
      const purpose = read("purpose");
      const account = read("account");
      const wrong = [];
      if (purpose.state !== "not-recorded") wrong.push(`a withdrawn effective row read as ${purpose.state}`);
      if (account.state !== "declined") wrong.push(`a declined row read as ${account.state}`);
      return wrong.length === 0 ? null : wrong.join("; ");
    });

    check("S5 an ineligible subsystem reads as not-recorded whatever rows exist, and no workspace reads unchecked", () => {
      if (typeof mods.readExplanation !== "function") return "dist/invariants.js exports no readExplanation";
      const ctx = world("ineligible");
      seedSubsystem(ctx, "S-01", "scoping");
      ctx.db
        .prepare(
          `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
           VALUES ('subsystem','S-01','purpose','recorded','a row written before a reset',?,?)`,
        )
        .run(headSha(ctx), ctx.sessionId);
      const wrong = [];
      const ineligible = mods.readExplanation(ctx.db, ctx.project.workspacePath, "subsystem", "S-01", "purpose");
      if (ineligible.state !== "not-recorded") wrong.push(`a scoping subsystem read as ${ineligible.state}`);
      ctx.db.prepare("UPDATE subsystems SET status = 'structural' WHERE id = 'S-01'").run();
      const unbound = mods.readExplanation(ctx.db, null, "subsystem", "S-01", "purpose");
      if (unbound.state !== "recorded" || unbound.checked !== false) {
        wrong.push(`without a workspace: ${unbound.state}, checked ${unbound.checked}; wanted recorded, unchecked`);
      }
      const none = mods.readExplanation(ctx.db, ctx.project.workspacePath, "subsystem", "S-01", "account");
      if (none.state !== "not-recorded" || none.row !== null) wrong.push("an empty slot did not read as not-recorded with no row");
      return wrong.length === 0 ? null : wrong.join("; ");
    });
  }

  // ----------------------------------------------------- V: the vocabulary contract

  {
    const contract = mods.vocabulary;
    const enumsWanted = {
      explanation_subject: { values: ["subsystem", "project"], column: "subject_type", constName: "EXPLANATION_SUBJECTS" },
      explanation_slot: { values: ["purpose", "account"], column: "slot", constName: "EXPLANATION_SLOTS" },
      explanation_disposition: {
        values: ["recorded", "declined", "withdrawn"],
        column: "disposition",
        constName: "EXPLANATION_DISPOSITIONS",
      },
    };
    check("C1 the contract carries the three stored enums, each bound to its explanations column", () => {
      if (!contract) return "contracts/conspectus-vocabulary.json is unreadable";
      const wrong = [];
      for (const [name, want] of Object.entries(enumsWanted)) {
        const decl = contract.enums?.[name];
        if (!decl) {
          wrong.push(`${name} is absent`);
          continue;
        }
        if (JSON.stringify(decl.values.map((v) => v.value)) !== JSON.stringify(want.values)) {
          wrong.push(`${name} values are ${JSON.stringify(decl.values.map((v) => v.value))}`);
        }
        const binding = (decl.sql ?? []).find((b) => b.table === "explanations" && b.column === want.column);
        if (!binding) wrong.push(`${name} has no sql binding to explanations.${want.column}`);
        for (const v of decl.values) {
          for (const field of ["label", "meaning", "cannot_justify"]) {
            if (typeof v[field] !== "string" || v[field].trim() === "") wrong.push(`${name}.${v.value} carries no ${field}`);
          }
        }
      }
      return wrong.length === 0 ? null : wrong.join("; ");
    });

    check("C2 explanation_discharge is computed: three values, no sql binding, and recorded says it is not truth", () => {
      if (!contract) return "contracts/conspectus-vocabulary.json is unreadable";
      const decl = contract.enums?.explanation_discharge;
      if (!decl) return "explanation_discharge is absent";
      if (JSON.stringify(decl.values.map((v) => v.value)) !== JSON.stringify(["recorded", "declined", "not-recorded"])) {
        return `values are ${JSON.stringify(decl.values.map((v) => v.value))}`;
      }
      if ((decl.sql ?? []).length !== 0) return "it carries a sql binding, but it is never stored";
      const recorded = decl.values.find((v) => v.value === "recorded");
      if (!/who wrote/i.test(recorded.cannot_justify) || !/not that it is true/i.test(recorded.cannot_justify)) {
        return "cannot_justify for recorded does not say the record establishes who wrote it, at which revision and over which evidence, and not that it is true";
      }
      for (const v of decl.values) {
        for (const field of ["label", "meaning", "cannot_justify"]) {
          if (typeof v[field] !== "string" || v[field].trim() === "") return `${v.value} carries no ${field}`;
        }
      }
      return null;
    });

    check("C3 subsystem_status carries explanation_eligible: true for the four read statuses, false otherwise", () => {
      if (!contract) return "contracts/conspectus-vocabulary.json is unreadable";
      const values = contract.enums?.subsystem_status?.values ?? [];
      const wrong = [];
      for (const v of values) {
        const want = ELIGIBLE_STATUSES.includes(v.value);
        if (v.explanation_eligible !== want) wrong.push(`${v.value}: ${JSON.stringify(v.explanation_eligible)}, wanted ${want}`);
      }
      return wrong.length === 0 && values.length === 7 ? null : wrong.join("; ") || "subsystem_status does not carry seven values";
    });

    check("C4 both generated modules carry the enums and the eligibility field, and the generator agrees", () => {
      const wrong = [];
      for (const [name, want] of Object.entries(enumsWanted)) {
        const got = mods.generated?.[want.constName];
        if (!Array.isArray(got) || JSON.stringify([...got]) !== JSON.stringify(want.values)) {
          wrong.push(`dist/vocabulary.js ${want.constName} is ${JSON.stringify(got ?? null)}`);
        }
        void name;
      }
      const discharges = mods.generated?.EXPLANATION_DISCHARGES;
      if (!Array.isArray(discharges) || discharges.join() !== "recorded,declined,not-recorded") {
        wrong.push(`dist/vocabulary.js EXPLANATION_DISCHARGES is ${JSON.stringify(discharges ?? null)}`);
      }
      const ts = mods.generated?.VOCABULARY?.subsystem_status?.values ?? [];
      for (const v of ts) {
        if (v.explanation_eligible !== ELIGIBLE_STATUSES.includes(v.value)) {
          wrong.push(`dist/vocabulary.js ${v.value} eligibility is ${JSON.stringify(v.explanation_eligible)}`);
        }
      }
      const py = mods.pythonVocabulary;
      if (py === null) wrong.push("materializer/amanuensis_materializer/vocabulary.py is unreadable");
      else {
        for (const want of ["EXPLANATION_SUBJECTS", "EXPLANATION_SLOTS", "EXPLANATION_DISPOSITIONS", "EXPLANATION_DISCHARGES", '"explanation_eligible"']) {
          if (!py.includes(want)) wrong.push(`vocabulary.py does not carry ${want}`);
        }
      }
      const gen = spawnSync(process.execPath, [join(here, "scripts", "gen-vocabulary.mjs"), "--check"], { encoding: "utf8" });
      if (gen.status !== 0) wrong.push("gen-vocabulary.mjs --check fails: the generated modules differ from the contract");
      const sql = spawnSync(process.execPath, [join(here, "scripts", "gen-vocabulary.mjs"), "--check-sql"], { encoding: "utf8" });
      if (sql.status !== 0) wrong.push("gen-vocabulary.mjs --check-sql fails: a CHECK list in schema.sql disagrees with the contract");
      return wrong.length === 0 ? null : wrong.join("; ");
    });
  }

  // ------------------------------------------------ T: registers and the reference

  check("T1 both tables are registered as append-only with triggers the schema ships", () => {
    const registry = readIfPresent(join(here, "contracts", "append-only-tables.txt"));
    const schema = readIfPresent(join(here, "src", "schema.sql"));
    if (registry === null || schema === null) return "append-only-tables.txt or schema.sql is unreadable";
    const rows = registry
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => l.trim().split(/\s+/));
    const wrong = [];
    for (const table of ["explanations", "explanation_evidence"]) {
      const row = rows.find((r) => r[0] === table);
      if (!row || row.length !== 3) {
        wrong.push(`${table} has no three-column row in append-only-tables.txt`);
        continue;
      }
      for (const trigger of row.slice(1)) {
        if (!new RegExp(`CREATE TRIGGER IF NOT EXISTS ${trigger}\\s`).test(schema)) {
          wrong.push(`${table}'s trigger ${trigger} is not in schema.sql`);
        }
      }
    }
    const header = /# (\d+) tables\./.exec(registry);
    if (header && Number(header[1]) !== rows.length) wrong.push(`the header says ${header[1]} tables and the file lists ${rows.length}`);
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  check("T2 every refusal of both tools is registered against references/explanations.md and the parity check passes", () => {
    const register = readIfPresent(join(here, "contracts", "refusal-parity.json"));
    if (register === null) return "contracts/refusal-parity.json is unreadable";
    const entries = JSON.parse(register).refusals ?? [];
    const reference = "references/explanations.md";
    const covers = (tool) =>
      entries.filter(
        (e) => [...(e.refuses ?? []), ...(e.instructs ?? [])].includes(tool) && (e.references ?? []).some((r) => r.file.endsWith(reference)),
      );
    const wrong = [];
    // R1-R8 for the record tool; R1-R4 and the two reason rules for the decline tool.
    if (covers(RECORD).length < 8) wrong.push(`${covers(RECORD).length} register entries cover ${RECORD}, wanted at least 8`);
    if (covers(DECLINE).length < 6) wrong.push(`${covers(DECLINE).length} register entries cover ${DECLINE}, wanted at least 6`);
    const text = readIfPresent(join(repo, ".claude", "skills", "amanuensis", "references", "explanations.md"));
    if (text === null) wrong.push("references/explanations.md is absent");
    else if (!/^## Tools\s*$/m.test(text)) wrong.push("references/explanations.md has no 'Tools' section");
    const parity = spawnSync(process.execPath, [join(here, "scripts", "check-refusal-parity.mjs")], { encoding: "utf8" });
    if (parity.status !== 0) wrong.push("scripts/check-refusal-parity.mjs fails");
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  // §0.2: the rule this encodes changed state at EX11, which renders the body.
  // Before it the field is allowlisted as 'rendered by EX11'; after it the field
  // is one of the retention gate's RENDERED_FIELDS and is not allowlisted. The
  // must-fail case stays: a gate that seeds the body and accounts for it in
  // neither list is red.
  check("T3 the retention gate seeds explanations.body and accounts for it: allowlisted until EX11, rendered after", () => {
    const text = readIfPresent(join(repo, "materializer", "test-prose-retention.py"));
    if (text === null) return "materializer/test-prose-retention.py is unreadable";
    if (!text.includes('"explanations.body"')) return "test-prose-retention.py does not seed explanations.body";
    if (text.includes("rendered by EX11")) return null;
    const rendered = /RENDERED_FIELDS[^=]*=\s*\(([^)]*)\)/s.exec(text);
    const accounted = rendered !== null && rendered[1].includes('"explanations.body"');
    const allowlisted = /ALLOWLIST\[\s*"explanations\.body"\s*\]/.test(text);
    if (allowlisted) return "explanations.body is allowlisted without the 'rendered by EX11' reason";
    return accounted ? null : "explanations.body is neither a rendered field nor allowlisted with 'rendered by EX11'";
  });

  // ------------------------------------------------------ V1: the served surface

  {
    const ws = join(scratch, "ws-surface");
    mkdirSync(ws, { recursive: true });
    git(ws, "init", "-q");
    writeFileSync(join(ws, "a.ts"), "export const a = 1;\n");
    git(ws, "add", "-A");
    gitCommit(ws, "seed");
    const advertised = await listTools(ws);
    check("V1 tools/list advertises both writers as additive, with the schemas §3.3 gives them", () => {
      if (advertised.error) return `the tool list could not be read — ${scrub(advertised.error)}`;
      const byName = new Map((advertised.tools ?? []).map((t) => [t.name, t]));
      const wrong = [];
      const want = {
        [RECORD]: ["subject_type", "slot", "body", "evidence_ids", "ref_sha"],
        [DECLINE]: ["subject_type", "slot", "reason", "ref_sha"],
      };
      for (const [name, required] of Object.entries(want)) {
        const tool = byName.get(name);
        if (!tool) {
          wrong.push(`${name} is not advertised`);
          continue;
        }
        if (tool.annotations?.readOnlyHint !== false) wrong.push(`${name} is advertised as read-only`);
        if (tool.annotations?.destructiveHint !== false) wrong.push(`${name} is advertised as destructive; the table is append-only`);
        const missing = required.filter((k) => !(tool.inputSchema?.required ?? []).includes(k));
        if (missing.length) wrong.push(`${name}'s schema does not require ${missing.join(", ")}`);
        if ((tool.inputSchema?.required ?? []).includes("subject_id")) wrong.push(`${name} requires subject_id; it is optional for a project`);
        if (!tool.inputSchema?.properties?.subject_id) wrong.push(`${name}'s schema has no subject_id`);
      }
      return wrong.length === 0 ? null : wrong.join("; ");
    });
    rmSync(join(ws, "storage"), { recursive: true, force: true });
  }

  // -------------------------------------------------------------- CI1 and L1

  check("CI1 this gate runs in CI (spec.md §0.1)", () => {
    const workflow = readIfPresent(join(repo, ".github", "workflows", "test.yml"));
    if (workflow === null) return ".github/workflows/test.yml is absent";
    return workflow.includes("node test-explanations.mjs")
      ? null
      : "the workflow does not run this gate, so a break lands on a branch no run reports";
  });

  for (const cleanup of cleanups) cleanup();
  rmSync(scratch, { recursive: true, force: true });
}

function readIfPresent(path) {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- the driver

let exitCode = 0;
try {
  // Load the subject defensively: an absent build, an absent module or an absent
  // table must produce this gate's red line, not a stack trace (spec.md §0.1).
  // `dist/` is a build artifact, so a gate that imports it without compiling
  // certifies whatever was last built rather than the source under review: the
  // explanation lane's slice-S2 review inverted this subject's source and the
  // gate stayed green until a rebuild (F1/codex). A compile failure is this
  // gate's red line, not a pass against stale bytes.
  const built = ensureBuilt();
  const mods = { explanationsTable: false };
  let loadError = null;
  try {
    if (!built.ok) throw new Error(built.detail);
    ({ openDatabase: mods.openDatabase } = await import("./dist/db.js"));
    ({ resolveProject: mods.resolveProject, ensureProjectStorage: mods.ensureProjectStorage } =
      await import("./dist/project.js"));
    const [claims, evidence, files, project, subsystems] = await Promise.all([
      import("./dist/tools/claims.js"),
      import("./dist/tools/evidence.js"),
      import("./dist/tools/files.js"),
      import("./dist/tools/project.js"),
      import("./dist/tools/subsystems.js"),
    ]);
    mods.toolArrays = [
      claims.claimTools,
      evidence.evidenceTools,
      files.fileTools,
      project.projectTools,
      subsystems.subsystemTools,
    ];
  } catch (error) {
    loadError = `the server build could not be loaded: ${scrub(error?.message ?? error)}`;
  }
  if (!loadError) {
    try {
      const explanations = await import("./dist/tools/explanations.js");
      mods.toolArrays.push(explanations.explanationTools ?? []);
    } catch {
      /* the writers are absent; E1 says so */
    }
    try {
      const invariants = await import("./dist/invariants.js");
      mods.readExplanation = invariants.readExplanation;
      mods.selectExplanation = invariants.selectExplanation;
      mods.isSubjectExplanationEligible = invariants.isSubjectExplanationEligible;
    } catch {
      /* the reader is absent; S2 and S3 say so */
    }
    try {
      mods.generated = await import("./dist/vocabulary.js");
    } catch {
      mods.generated = null;
    }
  }
  try {
    mods.vocabulary = JSON.parse(readFileSync(join(here, "contracts", "conspectus-vocabulary.json"), "utf8"));
  } catch {
    mods.vocabulary = null;
  }
  try {
    mods.cases = JSON.parse(readFileSync(join(here, "contracts", "explanation-effective-cases.json"), "utf8"));
  } catch {
    mods.cases = null;
  }
  mods.pythonVocabulary = readIfPresent(
    join(repo, "materializer", "amanuensis_materializer", "vocabulary.py"),
  );

  if (loadError) {
    // No store can be opened. Every assertion that needs one is the first to
    // fail and says so; E1 carries the red_expect phrase.
    checked++;
    failures.push(
      `record_explanation is not refused for a subsystem that is not explanation-eligible (E1) — ${loadError}`,
    );
  } else {
    // Probe the table on a throwaway store, so the assertions can tell a missing
    // table from a missing refusal without ever creating one.
    const probe = mkdtempSync(join(tmpdir(), "amanuensis-ex9-probe-"));
    try {
      git(probe, "init", "-q");
      writeFileSync(join(probe, "p.ts"), "export const p = 1;\n");
      git(probe, "add", "-A");
      gitCommit(probe, "seed");
      const project = mods.resolveProject(probe, { selectionSource: "ex9-probe" });
      mods.ensureProjectStorage(project, (databasePath) => mods.openDatabase(databasePath).close());
      const db = mods.openDatabase(project.dbPath);
      mods.explanationsTable = Boolean(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='explanations'").get(),
      );
      db.close();
      rmSync(project.storagePath, { recursive: true, force: true });
    } catch (error) {
      notes.push(`the table probe failed: ${scrub(error?.message ?? error)}`);
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
    await main(mods);
  }
} catch (error) {
  failures.push(`X1 the gate did not finish: ${scrub(error?.message ?? error)}`);
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return String(result.stdout ?? "").trim();
}
function gitCommit(cwd, message) {
  spawnSync(
    "git",
    ["-c", "user.email=ex9@localhost", "-c", "user.name=explanation-ex9", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", message],
    { cwd, encoding: "utf8" },
  );
}

for (const note of notes) console.log(`  note ${note}`);
console.log(`  ran  ${checked} assertion(s) against ${join(here, "dist")}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`GATE EX9 RED: ${failures[0]}`);
  exitCode = 1;
} else {
  console.log("GATE EX9 GREEN");
}
process.exit(exitCode);
