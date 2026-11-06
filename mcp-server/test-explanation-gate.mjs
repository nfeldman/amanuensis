#!/usr/bin/env node
// GATE EX10 (design/explanation/spec.md §3.4, §3.5) — the `mapped` gate, its
// refusal parity, and the authoring instructions that discharge it.
//
// A subsystem could reach `mapped` with nothing recorded about what it is for or
// how it works. EX9 gave the store a place to hold that and EX15 a way to read it
// back; this packet makes the answer owed. Every transition into `mapped`, through
// either status writer and from any status including `deferred`, is refused unless
// the effective purpose and the effective account are each recorded or declined.
//
// The gate asserts behaviour, not presence. It drives the built tool handlers over
// temporary git workspaces and stores that it creates. The skill text is read too,
// because a refusal whose repair no reference teaches is a dead end.
//
//   exit 0  `GATE EX10 GREEN`          — every assertion held
//   exit 1  `GATE EX10 RED: <reason>`  — the first assertion that failed
//
// The first assertion (G1) carries the packet's red_expect phrase. On a tree
// without the check the advance succeeds, G1 reports that, and the red run reaches
// an assertion and never a stack trace.
//
// Must-stay-green controls:
//   C1  a write that leaves a `mapped` subsystem `mapped` is not checked
//   C2  an advance to `concerns` or `adversarial`, or out of `deferred`, is not gated
//   C3  a refused write changes neither the status nor the ladder
//   C4  another subsystem's rows, or the project's, discharge nothing
//
// What a reviewer should sabotage, and what must go red:
//   drop the call from either writer                                   → G1, G4, G5
//   call it only inside `case "mapped"`                                → G5, G6
//   read eligibility at the current status, so `deferred` never passes → G6
//   check one slot, or accept a row of any disposition                 → G2, G8
//   accept only `recorded`, or only `declined`                         → G3
//   check a mapped-to-mapped write                                     → C1
//   gate another status                                                → C2
//   treat a slot with no row as discharged without a workspace         → G7
//   omit the no-workspace report, or refuse a row without a workspace  → G7
//   ignore ref_sha resolution, or stop naming the unreachable row      → G9
//   drop the entry from the register or the quote from the reference   → P1, P2
//   set a length floor, or lose a phase row of §3.5                    → S1-S9

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const skillDir = join(repo, ".claude", "skills", "amanuensis");

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

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return String(result.stdout ?? "").trim();
}
function gitCommit(cwd, message) {
  spawnSync(
    "git",
    [
      "-c", "user.email=ex10@localhost",
      "-c", "user.name=explanation-ex10",
      "-c", "commit.gpgsign=false",
      "commit", "-q", "--no-verify", "-m", message,
    ],
    { cwd, encoding: "utf8" },
  );
}
const normalize = (text) => String(text).replace(/\s+/g, " ");

// --------------------------------------------------------------- the refusal, §3.4

const REPAIR =
  "for this subsystem. Either record_explanation with the evidence it was written from, or " +
  "decline_explanation with the reason none is written. There is no length floor, and declining " +
  "is a real answer that has to be said out loud.";
const NO_PURPOSE = "no purpose is recorded or declined";
const NO_ACCOUNT = "no account is recorded or declined";
const refusalFor = (id, missing) => `cannot advance ${id} to 'mapped': ${missing} ${REPAIR}`;

/** A well-formed 40-hex object name no repository here carries. */
const UNREACHABLE_SHA = "b0a7e5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c";

// --------------------------------------------------------------- the store body

async function main(mods) {
  const { openDatabase, resolveProject, ensureProjectStorage, toolArrays, invariants } = mods;
  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  function call(name, args, ctx) {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    return td.handler(args, ctx);
  }

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-ex10-"));
  const storageRoot = join(scratch, "storage");
  mkdirSync(storageRoot, { recursive: true });
  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;

  const ws = join(scratch, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  git(ws, "init", "-q");
  writeFileSync(join(ws, "src", "a.ts"), "export const a = 1;\n");
  git(ws, "add", "-A");
  gitCommit(ws, "seed");
  const head = git(ws, "rev-parse", "HEAD");

  const project = resolveProject(ws, { selectionSource: "ex10-gate" });
  ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  ctx.sessionId = call("start_session", { intent: "ex10-gate" }, ctx).session_id;
  call("set_git_state", { canonical_branch: "main", onboarding_sha: head }, ctx);
  // The same store, with nothing to resolve a revision against.
  const unbound = { ...ctx, project: { ...project, workspacePath: null } };

  const WRITERS = {
    update_subsystem_status: (id, status, onCtx = ctx) =>
      call("update_subsystem_status", { id, status }, onCtx),
    upsert_subsystem: (id, status, onCtx = ctx) =>
      call("upsert_subsystem", { id, name: `${id} fixture`, status }, onCtx),
  };
  const writerNames = Object.keys(WRITERS);
  let next = 0;
  /** One subsystem per case and writer, seeded straight at the status the case starts from. */
  function seed(status) {
    next++;
    const id = `S-${next}`;
    db.prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, ?)").run(id, `${id} fixture`, status);
    db.prepare(
      `INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha)
       VALUES (?, 'src/a.ts', 'fixture', 'examined', ?)`,
    ).run(id, head);
    return id;
  }
  const reconcile = () => call("detect_changes", { current_sha: head }, ctx);
  const statusOf = (id) => db.prepare("SELECT status FROM subsystems WHERE id = ?").get(id)?.status ?? null;
  const ladderSize = (id) =>
    db.prepare("SELECT COUNT(*) AS n FROM subsystem_status_transitions WHERE subsystem_id = ?").get(id).n;
  const evidence = () =>
    call(
      "add_evidence",
      { file_path: "src/a.ts", symbol: "a", line_range: "1-1", ref_sha: head, kind: "code-verified" },
      ctx,
    ).id;
  const record = (id, slot) =>
    call(
      "record_explanation",
      {
        subject_type: "subsystem",
        subject_id: id,
        slot,
        body: `The ${slot} of ${id}.`,
        evidence_ids: [evidence()],
        ref_sha: head,
      },
      ctx,
    );
  const decline = (id, slot) =>
    call(
      "decline_explanation",
      {
        subject_type: "subsystem",
        subject_id: id,
        slot,
        reason: `Nothing true and specific to say about the ${slot} of ${id}.`,
        ref_sha: head,
      },
      ctx,
    );
  /** A row the writers cannot make: its revision does not resolve. */
  const rawRow = (subjectType, subjectId, slot, disposition, refSha) =>
    db
      .prepare(
        `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
         VALUES (?, ?, ?, ?, 'a raw fixture row', ?, ?)`,
      )
      .run(subjectType, subjectId, slot, disposition, refSha, ctx.sessionId);
  /** The refusal text of a write, or null when it went through. */
  function attempt(writer, id, status, onCtx = ctx) {
    reconcile();
    try {
      const result = WRITERS[writer](id, status, onCtx);
      if (result && result.ok === false) return { refused: String(result.error), result };
      return { refused: null, result };
    } catch (error) {
      return { refused: String(error?.message ?? error), result: null };
    }
  }
  /** Assert a refusal carrying the exact §3.4 sentence, and that the write left nothing. */
  function expectRefused(writer, id, missing, what, onCtx = ctx) {
    const before = { status: statusOf(id), ladder: ladderSize(id) };
    const { refused } = attempt(writer, id, "mapped", onCtx);
    if (refused === null) return `${what} reached mapped through ${writer}`;
    const want = refusalFor(id, missing);
    if (!normalize(refused).startsWith(want)) {
      return `${writer} refused in other words: ${refused}`;
    }
    if (statusOf(id) !== before.status) return `${writer} refused and still moved the status`;
    if (ladderSize(id) !== before.ladder) return `${writer} refused and still appended a ladder rung`;
    return null;
  }
  function expectAllowed(writer, id, what, onCtx = ctx) {
    const { refused, result } = attempt(writer, id, "mapped", onCtx);
    if (refused !== null) return `${what} was refused through ${writer}: ${refused}`;
    if (statusOf(id) !== "mapped") return `${what}: ${writer} returned and the status is ${statusOf(id)}`;
    return { result };
  }
  /** Run one case once per writer; the first detail wins. */
  function perWriter(fn) {
    for (const writer of writerNames) {
      const detail = fn(writer);
      if (detail) return detail;
    }
    return null;
  }

  // ------------------------------------------------------------ into mapped

  check("a subsystem reached mapped with neither a purpose nor a declination (G1)", () =>
    perWriter((writer) =>
      expectRefused(writer, seed("adversarial"), `${NO_PURPOSE} and ${NO_ACCOUNT}`, "a subsystem with neither slot"),
    ),
  );

  check("G2 a subsystem with only one slot answered is refused, naming the other", () =>
    perWriter((writer) => {
      const onlyPurpose = seed("adversarial");
      record(onlyPurpose, "purpose");
      const first = expectRefused(writer, onlyPurpose, NO_ACCOUNT, "a subsystem with only a purpose");
      if (first) return first;
      const onlyDeclinedAccount = seed("adversarial");
      decline(onlyDeclinedAccount, "account");
      return expectRefused(writer, onlyDeclinedAccount, NO_PURPOSE, "a subsystem with only a declined account");
    }),
  );

  check("G3 two records, two declinations, or one of each advance, with nothing to report", () =>
    perWriter((writer) => {
      const arrangements = [
        ["two records", record, record],
        ["two declinations", decline, decline],
        ["a recorded purpose and a declined account", record, decline],
        ["a declined purpose and a recorded account", decline, record],
      ];
      for (const [what, purpose, account] of arrangements) {
        const id = seed("adversarial");
        purpose(id, "purpose");
        account(id, "account");
        const before = ladderSize(id);
        const outcome = expectAllowed(writer, id, what);
        if (typeof outcome === "string") return outcome;
        if (outcome.result?.reported !== undefined) {
          return `${what} reported ${JSON.stringify(outcome.result.reported)} with a workspace bound`;
        }
        if (ladderSize(id) !== before + 1) return `${what} did not append its rung to the ladder`;
      }
      return null;
    }),
  );

  check("G4 a fresh insert straight at mapped answers for the same two slots", () => {
    const id = "S-fresh";
    const { refused } = attempt("upsert_subsystem", id, "mapped");
    if (refused === null) return "upsert_subsystem inserted a subsystem at mapped with neither slot";
    return statusOf(id) === null ? null : "the refused insert left a row behind";
  });

  check("G5 from deferred with neither slot is refused, through each writer", () =>
    perWriter((writer) =>
      expectRefused(writer, seed("deferred"), `${NO_PURPOSE} and ${NO_ACCOUNT}`, "a deferred subsystem with neither slot"),
    ),
  );

  check("G6 from deferred with both slots answered advances, through each writer", () =>
    perWriter((writer) => {
      for (const [what, purpose, account] of [
        ["two records", record, record],
        ["two declinations", decline, decline],
      ]) {
        const id = seed("adversarial");
        purpose(id, "purpose");
        account(id, "account");
        call("update_subsystem_status", { id, status: "deferred" }, ctx);
        if (statusOf(id) !== "deferred") return `the fixture did not park ${id}`;
        const outcome = expectAllowed(writer, id, `a deferred subsystem with ${what}`);
        if (typeof outcome === "string") return outcome;
      }
      const onlyOne = seed("adversarial");
      record(onlyOne, "purpose");
      call("update_subsystem_status", { id: onlyOne, status: "deferred" }, ctx);
      return expectRefused(writer, onlyOne, NO_ACCOUNT, "a deferred subsystem with only a purpose");
    }),
  );

  // ------------------------------------------------------------ without a workspace

  check("G7 without a workspace a slot with a row proceeds and says so; a slot with no row is refused", () =>
    perWriter((writer) => {
      const neither = seed("adversarial");
      const refusedNeither = expectRefused(
        writer,
        neither,
        `${NO_PURPOSE} and ${NO_ACCOUNT}`,
        "an unbound subsystem with neither slot",
        unbound,
      );
      if (refusedNeither) return refusedNeither;

      const oneRow = seed("adversarial");
      record(oneRow, "account");
      const refusedOne = expectRefused(writer, oneRow, NO_PURPOSE, "an unbound subsystem with one slot", unbound);
      if (refusedOne) return refusedOne;

      const both = seed("adversarial");
      record(both, "purpose");
      rawRow("subsystem", both, "account", "declined", UNREACHABLE_SHA);
      const outcome = expectAllowed(writer, both, "an unbound subsystem with a row in each slot", unbound);
      if (typeof outcome === "string") return outcome;
      const lines = (outcome.result?.reported ?? []).filter(
        (line) => /without a bound workspace/.test(line) && /purpose/.test(line) && /account/.test(line) && /not resolved/.test(line),
      );
      if (lines.length !== 1 || !lines[0].includes(both)) {
        return `the advance did not report once that its revisions were not resolved: ${JSON.stringify(outcome.result?.reported)}`;
      }

      const withdrawn = seed("adversarial");
      record(withdrawn, "purpose");
      record(withdrawn, "account");
      rawRow("subsystem", withdrawn, "account", "withdrawn", head);
      return expectRefused(writer, withdrawn, NO_ACCOUNT, "an unbound subsystem whose account was withdrawn", unbound);
    }),
  );

  // ------------------------------------------------------------ which row counts

  check("G8 a reset withdraws the discharge, and a new row restores it", () =>
    perWriter((writer) => {
      const id = seed("adversarial");
      record(id, "purpose");
      decline(id, "account");
      call("reset_subsystem", { id, to_status: "adversarial", reason: "fixture resurvey" }, ctx);
      const refused = expectRefused(writer, id, `${NO_PURPOSE} and ${NO_ACCOUNT}`, "a reset subsystem");
      if (refused) return refused;
      record(id, "purpose");
      record(id, "account");
      const outcome = expectAllowed(writer, id, "a reset subsystem with new rows");
      return typeof outcome === "string" ? outcome : null;
    }),
  );

  check("G9 a row whose revision no longer resolves discharges nothing and is named", () =>
    perWriter((writer) => {
      const id = seed("adversarial");
      record(id, "purpose");
      rawRow("subsystem", id, "account", "recorded", UNREACHABLE_SHA);
      const refused = expectRefused(writer, id, NO_ACCOUNT, "a subsystem whose account does not resolve");
      if (refused) return refused;
      const { refused: text } = attempt(writer, id, "mapped");
      if (!text.includes(UNREACHABLE_SHA.slice(0, 7)) || !/account/.test(text.slice(refusalFor(id, NO_ACCOUNT).length))) {
        return `the refusal does not name the unreachable row: ${text}`;
      }

      // The newest row is passed over, and the older one that resolves still answers.
      const older = seed("adversarial");
      record(older, "purpose");
      record(older, "account");
      rawRow("subsystem", older, "account", "recorded", UNREACHABLE_SHA);
      const outcome = expectAllowed(writer, older, "a subsystem with an older account that resolves");
      return typeof outcome === "string" ? outcome : null;
    }),
  );

  check("G10 the check is requireExplanationDischarge, and it binds both directions directly", () => {
    const fn = invariants.requireExplanationDischarge;
    if (typeof fn !== "function") return "invariants.ts does not export requireExplanationDischarge";
    const id = seed("adversarial");
    let thrown = null;
    try {
      fn(db, id, "adversarial", "mapped", ws);
    } catch (error) {
      thrown = String(error?.message ?? error);
    }
    if (thrown === null) return "it let a subsystem with neither slot through";
    if (!normalize(thrown).startsWith(refusalFor(id, `${NO_PURPOSE} and ${NO_ACCOUNT}`))) {
      return `it refused in other words: ${thrown}`;
    }
    const noOp = fn(db, id, "mapped", "mapped", ws);
    if (!Array.isArray(noOp) || noOp.length !== 0) return "a mapped-to-mapped write returned something to report";
    return null;
  });

  // ------------------------------------------------------------ controls

  check("C1 a write that leaves a mapped subsystem mapped is not checked", () =>
    perWriter((writer) => {
      const id = seed("mapped");
      const { refused } = attempt(writer, id, "mapped");
      if (refused !== null) return `${writer} checked a mapped-to-mapped write: ${refused}`;
      return statusOf(id) === "mapped" ? null : "the write moved the subsystem off mapped";
    }),
  );

  check("C2 no other advance is gated", () =>
    perWriter((writer) => {
      const toConcerns = seed("structural");
      call(
        "register_artifact",
        { path: `${toConcerns}-survey.md`, kind: "subsystem-survey", subsystem_id: toConcerns },
        ctx,
      );
      const concerns = attempt(writer, toConcerns, "concerns");
      if (concerns.refused !== null) return `concerns was refused: ${concerns.refused}`;

      const toAdversarial = seed("concerns");
      call("add_concern", { code: "EX10-1", category: "cache", origin: "seeded" }, ctx);
      call(
        "set_disposition",
        {
          subsystem_id: toAdversarial,
          concern_code: "EX10-1",
          classification: "ruled-out",
          evidence: `src/a.ts:a@${head.slice(0, 7)}`,
          evidence_ids: [evidence()],
          evidence_quality: "code-verified",
          linchpin_dependent: false,
          rationale: "fixture disposition",
          ref_sha: head,
          pass_type: "survey",
        },
        ctx,
      );
      const adversarial = attempt(writer, toAdversarial, "adversarial");
      if (adversarial.refused !== null) return `adversarial was refused: ${adversarial.refused}`;
      if (statusOf(toAdversarial) !== "adversarial") return "the advance to adversarial did not land";

      const unparked = seed("deferred");
      const out = attempt(writer, unparked, "adversarial");
      if (out.refused !== null) return `an advance out of deferred was refused: ${out.refused}`;
      const parked = seed("adversarial");
      const into = attempt(writer, parked, "deferred");
      if (into.refused !== null) return `parking was refused: ${into.refused}`;
      return null;
    }),
  );

  check("C4 another subsystem's rows, and the project's, discharge nothing", () =>
    perWriter((writer) => {
      const neighbour = seed("adversarial");
      record(neighbour, "purpose");
      record(neighbour, "account");
      call(
        "record_explanation",
        { subject_type: "project", slot: "account", body: "The project.", evidence_ids: [evidence()], ref_sha: head },
        ctx,
      );
      return expectRefused(writer, seed("adversarial"), `${NO_PURPOSE} and ${NO_ACCOUNT}`, "a subsystem with a neighbour's rows");
    }),
  );

  // ------------------------------------------------------------ the shared fixture helper

  await (async () => {
    let helper = null;
    try {
      helper = await import("./fixtures/explanation-discharge.mjs");
    } catch {
      helper = null;
    }
    check("H1 the shared fixture helper declines both slots, once, and the advance then lands", () => {
      const fn = helper?.dischargeExplanations;
      if (typeof fn !== "function") return "fixtures/explanation-discharge.mjs exports no dischargeExplanations";
      const id = seed("adversarial");
      fn(call, ctx, id, head);
      fn(call, ctx, id, head);
      const rows = db
        .prepare("SELECT slot, disposition FROM explanations WHERE subject_id = ? ORDER BY id")
        .all(id);
      if (rows.length !== 2 || rows.some((row) => row.disposition !== "declined")) {
        return `the helper wrote ${JSON.stringify(rows)}, not one declination per slot`;
      }
      const outcome = expectAllowed("update_subsystem_status", id, "a subsystem discharged by the helper");
      return typeof outcome === "string" ? outcome : null;
    });
  })();

  db.close();
  rmSync(project.storagePath, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
}

// --------------------------------------------------------------- the register and the skill

function readSkill(name) {
  const path = join(skillDir, name);
  return existsSync(path) ? normalize(readFileSync(path, "utf8")) : "";
}
/** The section of a normalized reference from one heading to the next of its level. */
function section(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const after = text.slice(start + heading.length);
  const end = after.search(/ #{1,3} /);
  return end < 0 ? after : after.slice(0, end);
}
function inOrder(text, phrases) {
  let at = 0;
  for (const phrase of phrases) {
    const found = text.indexOf(phrase, at);
    if (found < 0) return `"${phrase}" is missing or out of order`;
    at = found + phrase.length;
  }
  return null;
}
function requirePhrases(text, phrases, where) {
  for (const phrase of phrases) {
    if (!text.includes(phrase)) return `${where} does not say "${phrase}"`;
  }
  return null;
}
const FULL_REFUSAL_TAIL = REPAIR;

function contractChecks() {
  check("P1 the refusal is registered for both status writers, with its repair tools", () => {
    const register = JSON.parse(readFileSync(join(here, "contracts", "refusal-parity.json"), "utf8"));
    const entry = register.refusals.find(
      (row) => row.server?.file === "src/invariants.ts" && normalize(REPAIR).includes(normalize(row.server?.phrase ?? "\0")),
    );
    if (!entry) return "no register entry carries the §3.4 sentence";
    for (const tool of ["update_subsystem_status", "upsert_subsystem"]) {
      if (!entry.refuses.includes(tool)) return `the entry does not name ${tool} in refuses`;
    }
    for (const tool of ["record_explanation", "decline_explanation"]) {
      if (!entry.instructs.includes(tool)) return `the entry does not name ${tool} in instructs`;
    }
    if (!entry.references.some((row) => row.file.endsWith("references/phase-5-packaging.md"))) {
      return "the entry does not name references/phase-5-packaging.md";
    }
    const run = spawnSync(process.execPath, [join(here, "scripts", "check-refusal-parity.mjs")], {
      cwd: here,
      encoding: "utf8",
    });
    return run.status === 0 ? null : `check-refusal-parity.mjs does not pass: ${run.stderr}`;
  });

  check("P2 phase-5-packaging.md quotes the refusal whole", () => {
    const text = readSkill("references/phase-5-packaging.md");
    if (!text.includes("cannot advance <sid> to 'mapped'")) return "it does not open the quote with the refusal's first words";
    return text.includes(FULL_REFUSAL_TAIL) ? null : "it does not carry the sentence through 'said out loud'";
  });

  check("S1 explanations.md states what a purpose contains", () => {
    const text = section(readSkill("references/explanations.md"), "## What to write");
    if (!text) return "references/explanations.md has no section headed 'What to write'";
    return requirePhrases(
      text,
      ["**Purpose**", "one paragraph", "what the rest of the system or its users get from it", "Not a file list", "not a restatement of scope"],
      "the brief",
    );
  });

  check("S2 explanations.md gives the subsystem account its five parts in order", () => {
    const text = section(readSkill("references/explanations.md"), "## What to write");
    return inOrder(text, [
      "**Account** (subsystem)",
      "1. the moving parts and how control or data passes through them",
      "2. the rules it enforces and where each is enforced",
      "3. what it depends on and what depends on it",
      "4. what a newcomer is likely to get wrong",
      "5. where to start reading",
    ]);
  });

  check("S3 explanations.md gives the project account, its concepts as vocabulary terms", () => {
    const text = section(readSkill("references/explanations.md"), "## What to write");
    return (
      inOrder(text, [
        "**Account** (project)",
        "what the system does and for whom",
        "the main parts and how one request or record passes through them end to end",
        "the rules that hold everywhere",
        "the concepts a reader has to hold",
      ]) ??
      requirePhrases(
        text,
        ["vocabulary term with an expansion", "its scope is not changed", "`define_term`", "without `subsystem_id`"],
        "the project account",
      )
    );
  });

  check("S4 explanations.md gives the rules for all three, sets no floor, and accepts a declination", () => {
    const text = section(readSkill("references/explanations.md"), "## What to write");
    const missing = requirePhrases(
      text,
      [
        "experienced practitioner new to this codebase",
        "the codebase's own vocabulary",
        "no survey-status or coverage language",
        "every non-trivial statement traceable to attached evidence",
        "declines with the reason",
        "no length floor",
        "Declining with a reason is a complete answer",
      ],
      "the rules",
    );
    if (missing) return missing;
    const floor = /\bat least (?:\d+|two|three|four|five|a few|several) (?:words?|sentences?|paragraphs?|lines?|bytes?)\b|\bminimum of \d+\b/i;
    for (const name of [
      "SKILL.md",
      "references/explanations.md",
      "references/phase-2-structural.md",
      "references/phase-4-adversarial.md",
      "references/phase-5-packaging.md",
      "references/onboarding.md",
      "references/refresh.md",
    ]) {
      const found = readSkill(name).match(floor);
      if (found) return `${name} sets a length floor: "${found[0]}"`;
    }
    return null;
  });

  check("S5 SKILL.md lists the reference in its map", () =>
    section(readSkill("SKILL.md"), "## Reference map").includes("`references/explanations.md`")
      ? null
      : "the reference map does not list references/explanations.md",
  );

  check("S6 phase 2 records or declines both slots after the advance to structural", () => {
    const text = readSkill("references/phase-2-structural.md");
    const advance = text.lastIndexOf("advances status to `structural`");
    const step = text.indexOf("record_explanation");
    if (step < 0) return "phase-2-structural.md does not name record_explanation";
    if (advance < 0 || step < advance) return "the step does not follow the advance to structural";
    return requirePhrases(text.slice(advance), ["purpose", "draft account", "decline_explanation", "references/explanations.md"], "the step");
  });

  check("S7 phase 4 reads both as targets with get_explanations and files a contradicted sentence", () => {
    const text = readSkill("references/phase-4-adversarial.md");
    const targets = section(text, "### 1. Pull the targets");
    if (!targets.includes("get_explanations")) return "Pull the targets does not read them with get_explanations";
    if (!/purpose/.test(targets) || !/account/.test(targets)) return "Pull the targets does not name the purpose and the account";
    const at = text.indexOf("sentence the code contradicts");
    if (at < 0) return "it does not ask for a field note naming a sentence the code contradicts";
    return /add_field_note/.test(text.slice(Math.max(0, at - 400), at + 400))
      ? null
      : "the contradicted sentence is not recorded through add_field_note";
  });

  check("S8 phase 5 reads the account, revises or confirms it, then reads the census", () => {
    const text = readSkill("references/phase-5-packaging.md");
    return (
      inOrder(text, ["get_explanations", "record_explanation", "unfilled_slots"]) ??
      requirePhrases(text, ["confirm"], "phase 5")
    );
  });

  check("S9 onboarding, the template and refresh carry their rows of the phase table", () => {
    const onboarding = readSkill("references/onboarding.md");
    const phase7 = section(onboarding, "## Phase 7 · Produce the conspectus");
    const problem = requirePhrases(
      phase7,
      ["`## What is this codebase?`", "project account", "first subsystem reaches `structural`", "record_explanation", "packaging"],
      "onboarding Phase 7",
    );
    if (problem) return problem;
    const templates = readSkill("references/artifact-templates.md");
    if (templates.includes("## Tier 1 summary")) return "artifact-templates.md still carries the Tier 1 summary section";
    if (!/recorded account/.test(templates) || !templates.includes("get_explanations")) {
      return "artifact-templates.md does not point at the recorded account";
    }
    const refresh = readSkill("references/refresh.md");
    const at = refresh.indexOf("get_explanations");
    if (at < 0) return "refresh.md does not read the explanation with get_explanations";
    const around = refresh.slice(Math.max(0, at - 400), at + 400);
    if (!/cites? changed files/.test(around) || !/revises? or confirms?/.test(around)) {
      return "refresh.md does not say an explanation citing changed files is revised or confirmed";
    }
    return null;
  });

  check("L1 the gate is listed in the workflow beside its neighbours", () => {
    const workflow = readFileSync(join(repo, ".github", "workflows", "test.yml"), "utf8");
    const own = workflow.split("\n").filter((line) => /run:\s*node test-explanation-gate\.mjs\s*$/.test(line));
    if (own.length !== 1) return `test.yml lists test-explanation-gate.mjs ${own.length} time(s), expected 1`;
    return workflow.includes("run: node test-explanation-read.mjs") ? null : "test.yml does not list test-explanation-read.mjs, its neighbour";
  });
}

// ------------------------------------------------------------------------ run

let exitCode = 0;
try {
  const mods = { toolArrays: [] };
  let loadError = null;
  try {
    const project = await import("./dist/project.js");
    const db = await import("./dist/db.js");
    mods.resolveProject = project.resolveProject;
    mods.ensureProjectStorage = project.ensureProjectStorage;
    mods.openDatabase = db.openDatabase;
    mods.invariants = await import("./dist/invariants.js");
    const toolModules = await Promise.all([
      import("./dist/tools/artifacts.js"),
      import("./dist/tools/concerns.js"),
      import("./dist/tools/dispositions.js"),
      import("./dist/tools/evidence.js"),
      import("./dist/tools/explanations.js"),
      import("./dist/tools/git.js"),
      import("./dist/tools/project.js"),
      import("./dist/tools/subsystems.js"),
    ]);
    mods.toolArrays = toolModules.flatMap((module) =>
      Object.entries(module)
        .filter(([name, value]) => name.endsWith("Tools") && Array.isArray(value))
        .map(([, value]) => value),
    );
  } catch (error) {
    loadError = `the server build could not be loaded: ${scrub(error?.message ?? error)}`;
  }
  if (loadError) {
    checked++;
    failures.push(`a subsystem reached mapped with neither a purpose nor a declination (G1) — ${loadError}`);
  } else {
    await main(mods);
  }
  contractChecks();
} catch (error) {
  failures.push(`X1 the gate did not finish: ${scrub(error?.message ?? error)}`);
}

console.log(`  ran  ${checked} assertion(s) against ${join(here, "dist")}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`GATE EX10 RED: ${failures[0]}`);
  exitCode = 1;
} else {
  console.log("GATE EX10 GREEN");
}
process.exit(exitCode);
