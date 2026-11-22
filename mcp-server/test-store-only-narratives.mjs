#!/usr/bin/env node
// GATE SO3 (design/store-only/PLAN.md §2.1, §8 SO3) — the narrative tools.
//
// A survey's prose used to live in Markdown files the agent wrote and registered
// by hand. §2.1 gives it a record: an append-only `narratives` table bound to a
// revision, and three tools over it, `record_narrative`, `decline_narrative` and
// `get_narratives`; `reset_subsystem` withdraws a subsystem's narratives and its
// imported survey bodies instead of deleting them.
//
// Turns red when (PLAN §8 SO3):
//   - a valid narrative of any of the nine sections is refused, or is not
//     returned by `get_narratives` with its body, topic, revision and evidence;
//   - a structure narrative is accepted on an `unmapped` subsystem, a
//     concern-reasoning narrative below `concerns`, a challenge below
//     `adversarial` (and the same rungs hold for a declination);
//   - a body with a heading or table line, a body over 8192 UTF-8 bytes, or a
//     body failing the orientation lint is accepted;
//   - required evidence is missing, does not exist, or cites no file in the
//     subsystem's ledger, and the narrative is accepted anyway;
//   - the effective row is not the newest per (subject, section, topic);
//   - a reset leaves an effective subsystem narrative or an imported survey body
//     of that subsystem unwithdrawn, or touches another subsystem's;
//   - a refusal does not start with the tool's name, or leaves a row behind.
// Controls (a handler that refuses everything must be red): a body of exactly
// 8192 bytes and a topic of exactly 120 characters are accepted, a structure
// narrative is accepted at `scoping`, and `survey-plan` needs no evidence.
//
// The gate drives the built handlers over fixtures it creates itself, as
// `test-explanations.mjs` does, and reads `tools/list` from the built server.
//
//   exit 0  `GATE SO3 GREEN`          — every assertion held
//   exit 1  `GATE SO3 RED: <reason>`  — the first assertion that failed

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const TOOLS = ["record_narrative", "decline_narrative", "get_narratives"];
const RECORD = "record_narrative";
const DECLINE = "decline_narrative";
const GET = "get_narratives";

const SUBSYSTEM_SECTIONS = ["structure", "concern-reasoning", "challenge"];
const PROJECT_SECTIONS = [
  "repository-shape",
  "runtime",
  "stateful-entities",
  "concern-calibration",
  "start-here",
  "survey-plan",
];
const RUNG = { structure: "scoping", "concern-reasoning": "concerns", challenge: "adversarial" };
const LADDER = ["unmapped", "scoping", "structural", "concerns", "adversarial", "mapped"];
const BODY_CAP = 8192;

function bodyFor(section, n = 0) {
  return `The ${section} reading ${n}: a request enters through the dispatcher, which hands it to one handler and returns that handler's answer.`;
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
        clientInfo: { name: "so3", version: "0" },
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
      "-c", "user.email=so3@localhost",
      "-c", "user.name=narratives-so3",
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
  const absent = TOOLS.filter((name) => !allTools.has(name));

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-so3-"));
  const cleanups = [];

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
    const project = resolveProject(ws, { selectionSource: "so3-narratives" });
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
    ctx.sessionId = call("start_session", { intent: `so3-${label}` }, ctx).session_id;
    return ctx;
  }
  const headSha = (ctx) => git(ctx.project.workspacePath, "rev-parse", "HEAD");

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
  const narrativeCount = (ctx) => ctx.db.prepare("SELECT COUNT(*) AS n FROM narratives").get().n;

  const record = (ctx, over = {}) =>
    call(
      RECORD,
      {
        subject_type: "subsystem",
        subject_id: "S-01",
        section: "structure",
        body: bodyFor(over.section ?? "structure"),
        evidence_ids: [evidence(ctx)],
        ref_sha: headSha(ctx),
        ...over,
      },
      ctx,
    );
  const decline = (ctx, over = {}) =>
    call(
      DECLINE,
      {
        subject_type: "subsystem",
        subject_id: "S-01",
        section: "structure",
        reason: "The code does not say how this part is built beyond its file names.",
        ref_sha: headSha(ctx),
        ...over,
      },
      ctx,
    );
  const projectArgs = (section, extra = {}) => ({
    subject_type: "project",
    section,
    ...extra,
  });
  const get = (ctx, args) => call(GET, args, ctx);
  const effective = (ctx, args) => get(ctx, args).narratives ?? [];

  /** Assert a refusal begins with the tool's name, and that it stored nothing. */
  function refusesWith(ctx, tool, run, label) {
    const before = narrativeCount(ctx);
    const said = refusal(run);
    if (!said) return `${label} was accepted; expected a refusal beginning "${tool} refuses"`;
    if (!said.startsWith(`${tool} refuses`)) {
      return `${label} was refused with "${said.slice(0, 160)}", not a message beginning "${tool} refuses"`;
    }
    if (narrativeCount(ctx) !== before) return `${label} was refused and a row was stored anyway`;
    return null;
  }

  // ------------------------------------------------- V: the surface

  check("V1 record_narrative, decline_narrative and get_narratives are all served", () =>
    absent.length > 0 ? `${absent.join(", ")} absent from the server's tool surface` : null);

  if (absent.length > 0) {
    cleanups.forEach((cleanup) => cleanup());
    rmSync(scratch, { recursive: true, force: true });
    return;
  }

  await (async () => {
    const ctx = world("surface");
    const listed = await listTools(ctx.project.workspacePath);
    checked++;
    if (listed.error) {
      failures.push(`V2 tools/list failed: ${scrub(listed.error)}`);
      return;
    }
    const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
    const missing = TOOLS.filter((name) => !byName.has(name));
    if (missing.length > 0) {
      failures.push(`V2 tools/list does not advertise ${missing.join(", ")}`);
      return;
    }
    const writers = [RECORD, DECLINE].filter(
      (name) => byName.get(name).annotations?.destructiveHint !== false,
    );
    const reader = byName.get(GET).annotations?.readOnlyHint === true;
    if (writers.length > 0) failures.push(`V3 ${writers.join(", ")} is not hinted additive`);
    if (!reader) failures.push("V4 get_narratives is not hinted read-only");
  })();

  // ------------------------------------------------- A: a valid narrative of each section

  check("A1 a valid narrative of each subsystem section is accepted and returned whole", () => {
    const ctx = world("a1");
    seedSubsystem(ctx, "S-01", "adversarial");
    const evidenceId = evidence(ctx);
    for (const section of SUBSYSTEM_SECTIONS) {
      const body = bodyFor(section);
      const refused = refusal(() =>
        call(
          RECORD,
          {
            subject_type: "subsystem",
            subject_id: "S-01",
            section,
            topic: "on_write_commit dispatch",
            body,
            evidence_ids: [evidenceId],
            ref_sha: headSha(ctx),
          },
          ctx,
        ),
      );
      if (refused) return `${section} was refused: ${refused}`;
    }
    const rows = effective(ctx, { subject_type: "subsystem", subject_id: "S-01" });
    if (rows.length !== 3) return `get_narratives returned ${rows.length} rows, expected 3`;
    for (const section of SUBSYSTEM_SECTIONS) {
      const row = rows.find((candidate) => candidate.section === section);
      if (!row) return `get_narratives did not return ${section}`;
      if (row.body !== bodyFor(section)) return `${section} body came back as "${row.body}"`;
      if (row.topic !== "on_write_commit dispatch") return `${section} topic came back as "${row.topic}"`;
      if (row.disposition !== "recorded") return `${section} came back as ${row.disposition}`;
      if (row.ref_sha !== headSha(ctx)) return `${section} ref_sha came back as ${row.ref_sha}`;
      if (JSON.stringify(row.evidence_ids) !== JSON.stringify([evidenceId])) {
        return `${section} evidence came back as ${JSON.stringify(row.evidence_ids)}`;
      }
    }
    const stored = ctx.db.prepare("SELECT COUNT(*) AS n FROM narrative_evidence").get().n;
    return stored === 3 ? null : `narrative_evidence holds ${stored} links, expected 3`;
  });

  check("A2 a valid narrative of each project section is accepted and returned whole", () => {
    const ctx = world("a2");
    seedSubsystem(ctx, "S-01", "unmapped");
    const evidenceId = evidence(ctx);
    for (const section of PROJECT_SECTIONS) {
      const refused = refusal(() =>
        call(
          RECORD,
          {
            ...projectArgs(section),
            body: bodyFor(section),
            evidence_ids: [evidenceId],
            ref_sha: headSha(ctx),
          },
          ctx,
        ),
      );
      if (refused) return `${section} was refused: ${refused}`;
    }
    const rows = effective(ctx, { subject_type: "project" });
    if (rows.length !== 6) return `get_narratives returned ${rows.length} rows, expected 6`;
    for (const section of PROJECT_SECTIONS) {
      const row = rows.find((candidate) => candidate.section === section);
      if (!row) return `get_narratives did not return ${section}`;
      if (row.body !== bodyFor(section)) return `${section} body came back as "${row.body}"`;
      if (row.topic !== "") return `${section} topic came back as "${row.topic}"`;
      if (JSON.stringify(row.evidence_ids) !== JSON.stringify([evidenceId])) {
        return `${section} evidence came back as ${JSON.stringify(row.evidence_ids)}`;
      }
    }
    const one = effective(ctx, { subject_type: "project", section: "runtime" });
    return one.length === 1 && one[0].section === "runtime"
      ? null
      : `a section filter returned ${one.map((row) => row.section).join(", ") || "nothing"}`;
  });

  check("A3 survey-plan needs no evidence; every other project section does", () => {
    const ctx = world("a3");
    const plan = refusal(() =>
      call(RECORD, { ...projectArgs("survey-plan"), body: "Read the dispatcher first.", evidence_ids: [], ref_sha: headSha(ctx) }, ctx),
    );
    if (plan) return `survey-plan without evidence was refused: ${plan}`;
    const planAgain = refusal(() =>
      call(RECORD, { ...projectArgs("survey-plan"), topic: "second", body: "Then the store.", ref_sha: headSha(ctx) }, ctx),
    );
    if (planAgain) return `survey-plan with no evidence_ids field was refused: ${planAgain}`;
    for (const section of PROJECT_SECTIONS.filter((name) => name !== "survey-plan")) {
      const said = refusesWith(
        ctx,
        RECORD,
        () => call(RECORD, { ...projectArgs(section), body: bodyFor(section), evidence_ids: [], ref_sha: headSha(ctx) }, ctx),
        `${section} without evidence`,
      );
      if (said) return said;
    }
    return null;
  });

  check("A4 a declination of a subsystem section and a project section is returned as declined", () => {
    const ctx = world("a4");
    seedSubsystem(ctx, "S-01", "structural");
    const reason = "The code does not say how this part is built beyond its file names.";
    const refusedS = refusal(() => decline(ctx));
    if (refusedS) return `the subsystem declination was refused: ${refusedS}`;
    const refusedP = refusal(() =>
      call(DECLINE, { ...projectArgs("runtime"), reason: "Nothing in the code runs outside one process.", ref_sha: headSha(ctx) }, ctx),
    );
    if (refusedP) return `the project declination was refused: ${refusedP}`;
    const s = effective(ctx, { subject_type: "subsystem", subject_id: "S-01" });
    if (s.length !== 1 || s[0].disposition !== "declined" || s[0].body !== reason) {
      return `the subsystem read back as ${JSON.stringify(s)}`;
    }
    const p = effective(ctx, { subject_type: "project" });
    return p.length === 1 && p[0].disposition === "declined" && p[0].section === "runtime"
      ? null
      : `the project read back as ${JSON.stringify(p)}`;
  });

  // ------------------------------------------------- R: the status rungs

  check("R1 a structure narrative is refused on an unmapped subsystem and accepted at scoping", () => {
    const ctx = world("r1");
    seedSubsystem(ctx, "S-01", "unmapped");
    const said = refusesWith(ctx, RECORD, () => record(ctx), "structure on unmapped");
    if (said) return said;
    const sameDecline = refusesWith(ctx, DECLINE, () => decline(ctx), "a structure declination on unmapped");
    if (sameDecline) return sameDecline;
    ctx.db.prepare("UPDATE subsystems SET status = 'scoping' WHERE id = 'S-01'").run();
    const refused = refusal(() => record(ctx));
    return refused && `structure on scoping was refused: ${refused}`;
  });

  check("R2 each subsystem section is accepted at its rung and refused one below", () => {
    for (const section of SUBSYSTEM_SECTIONS) {
      const rung = LADDER.indexOf(RUNG[section]);
      for (const status of LADDER) {
        const ctx = world(`r2-${section}-${status}`);
        seedSubsystem(ctx, "S-01", status);
        const run = () => record(ctx, { section });
        if (LADDER.indexOf(status) < rung) {
          const said = refusesWith(ctx, RECORD, run, `${section} on ${status}`);
          if (said) return said;
          const declined = refusesWith(
            ctx,
            DECLINE,
            () => decline(ctx, { section }),
            `a ${section} declination on ${status}`,
          );
          if (declined) return declined;
        } else {
          const refused = refusal(run);
          if (refused) return `${section} on ${status} was refused: ${refused}`;
          const declinedRefused = refusal(() => decline(ctx, { section }));
          if (declinedRefused) return `a ${section} declination on ${status} was refused: ${declinedRefused}`;
        }
      }
    }
    return null;
  });

  check("R3 a subject and a section of different kinds are refused", () => {
    const ctx = world("r3");
    seedSubsystem(ctx, "S-01", "mapped");
    const evidenceId = evidence(ctx);
    const said = refusesWith(
      ctx,
      RECORD,
      () => record(ctx, { section: "runtime" }),
      "a project section on a subsystem",
    );
    if (said) return said;
    const reverse = refusesWith(
      ctx,
      RECORD,
      () => call(RECORD, { ...projectArgs("structure"), body: bodyFor("structure"), evidence_ids: [evidenceId], ref_sha: headSha(ctx) }, ctx),
      "a subsystem section on the project",
    );
    if (reverse) return reverse;
    return refusesWith(
      ctx,
      RECORD,
      () => record(ctx, { subject_id: "S-99" }),
      "a subsystem that does not exist",
    );
  });

  check("R4 a deferred subsystem is refused, and a missing session is refused", () => {
    const ctx = world("r4");
    seedSubsystem(ctx, "S-01", "deferred");
    const said = refusesWith(ctx, RECORD, () => record(ctx), "a deferred subsystem");
    if (said) return said;
    ctx.db.prepare("UPDATE subsystems SET status = 'mapped' WHERE id = 'S-01'").run();
    const evidenceId = evidence(ctx);
    ctx.sessionId = null;
    const noSession = refusal(() =>
      call(RECORD, { subject_type: "subsystem", subject_id: "S-01", section: "structure", body: bodyFor("structure"), evidence_ids: [evidenceId], ref_sha: headSha(ctx) }, ctx),
    );
    if (!noSession?.startsWith(RECORD)) return `without a session: ${JSON.stringify(noSession)}`;
    const noSessionDecline = refusal(() => decline(ctx));
    return noSessionDecline?.startsWith(DECLINE) ? null : `declining without a session: ${JSON.stringify(noSessionDecline)}`;
  });

  // ------------------------------------------------- B: the body

  check("B1 a heading line or a table line is refused, in either tool", () => {
    const ctx = world("b1");
    seedSubsystem(ctx, "S-01", "mapped");
    const cases = [
      ["a heading", "The parser reads one record.\n\n## Parts\n\nIt has three."],
      ["a heading behind spaces", "Intro.\n   # Parts"],
      ["a table", "The store holds:\n\n| table | role |\n|---|---|\n| a | b |"],
      ["a heading behind a vertical tab", "Intro.\u000b# Parts"],
      ["a heading behind U+2028", "Intro. # Parts"],
    ];
    for (const [label, body] of cases) {
      const said = refusesWith(ctx, RECORD, () => record(ctx, { body }), `a body with ${label}`);
      if (said) return said;
    }
    const reason = refusesWith(
      ctx,
      DECLINE,
      () => decline(ctx, { reason: "Not written.\n\n# Why" }),
      "a reason with a heading",
    );
    if (reason) return reason;
    const refused = refusal(() =>
      record(ctx, { body: "Paragraph one.\n\n- a list item\n- another one\n\n1. numbered\n\nUses `code` and *emphasis*." }),
    );
    return refused && `prose with lists and code spans was refused: ${refused}`;
  });

  check("B2 a body over 8192 UTF-8 bytes is refused, and one of exactly 8192 is accepted", () => {
    const ctx = world("b2");
    seedSubsystem(ctx, "S-01", "mapped");
    const prose = (bytes, unit = "a") => `${unit.repeat(bytes)}`;
    const said = refusesWith(ctx, RECORD, () => record(ctx, { body: prose(BODY_CAP + 1) }), "8193 bytes");
    if (said) return said;
    // 4097 two-byte characters are 8194 bytes in 4097 characters: a character count lets it through.
    const wide = refusesWith(ctx, RECORD, () => record(ctx, { body: prose(4097, "é") }), "4097 two-byte characters");
    if (wide) return wide;
    const exact = refusal(() => record(ctx, { body: prose(BODY_CAP) }));
    if (exact) return `exactly 8192 bytes was refused: ${exact}`;
    const wideExact = refusal(() => record(ctx, { topic: "wide", body: prose(4096, "é") }));
    return wideExact && `4096 two-byte characters (8192 bytes) was refused: ${wideExact}`;
  });

  check("B3 a body failing the orientation lint is refused; a clean one is not", () => {
    const ctx = world("b3");
    seedSubsystem(ctx, "S-01", "mapped");
    const said = refusesWith(
      ctx,
      RECORD,
      () => record(ctx, { body: "12/35 subsystems are mapped." }),
      "a count fraction",
    );
    if (said) return said;
    const status = refusesWith(
      ctx,
      RECORD,
      () => record(ctx, { body: "The conspectus is fully surveyed." }),
      "survey-status language",
    );
    if (status) return status;
    const reason = refusesWith(
      ctx,
      DECLINE,
      () => decline(ctx, { reason: "Only 3/9 callers were read." }),
      "a declination reason with a count fraction",
    );
    if (reason) return reason;
    const refused = refusal(() => record(ctx, { body: "The command exits with codes 0/1/3 for clean, failed and refused runs." }));
    return refused && `codes 0/1/3 was refused: ${refused}`;
  });

  // A topic prints as a subheading, so the lint the pages run reads it too. No
  // assertion supplied a forbidden topic: removing record_narrative's topic lint
  // stayed green, and decline_narrative never linted its topic (F11/codex,
  // slice-S1).
  check("B3b a topic failing the orientation lint is refused, in either tool; a clean one is not", () => {
    const ctx = world("b3b");
    seedSubsystem(ctx, "S-01", "mapped");
    for (const [label, topic] of [
      ["a count fraction", "12/35 callers"],
      ["survey-status language", "The conspectus is fully surveyed"],
    ]) {
      const recorded = refusesWith(ctx, RECORD, () => record(ctx, { topic }), `a topic with ${label}`);
      if (recorded) return recorded;
      const declined = refusesWith(ctx, DECLINE, () => decline(ctx, { topic }), `a declined topic with ${label}`);
      if (declined) return declined;
    }
    const clean = refusal(() => record(ctx, { topic: "dispatch" })) ?? refusal(() => decline(ctx, { topic: "storage" }));
    return clean && `a clean topic was refused: ${clean}`;
  });

  check("B4 an empty body, an over-long reason and a multi-paragraph reason are refused", () => {
    const ctx = world("b4");
    seedSubsystem(ctx, "S-01", "mapped");
    const empty = refusal(() => record(ctx, { body: "   " }));
    if (!empty) return "a blank body was accepted";
    const long = refusesWith(ctx, DECLINE, () => decline(ctx, { reason: "x".repeat(401) }), "a 401-byte reason");
    if (long) return long;
    const wide = refusesWith(ctx, DECLINE, () => decline(ctx, { reason: "é".repeat(201) }), "a 402-byte reason");
    if (wide) return wide;
    const paragraphs = refusesWith(
      ctx,
      DECLINE,
      () => decline(ctx, { reason: "One paragraph.\n\nAnd another." }),
      "a two-paragraph reason",
    );
    if (paragraphs) return paragraphs;
    const exact = refusal(() => decline(ctx, { reason: "x".repeat(400) }));
    return exact && `a 400-byte reason was refused: ${exact}`;
  });

  check("B5 a topic over 120 characters or spanning lines is refused; one of 120 is accepted", () => {
    const ctx = world("b5");
    seedSubsystem(ctx, "S-01", "mapped");
    const long = refusesWith(ctx, RECORD, () => record(ctx, { topic: "t".repeat(121) }), "a 121-character topic");
    if (long) return long;
    const lines = refusesWith(ctx, RECORD, () => record(ctx, { topic: "one\ntwo" }), "a two-line topic");
    if (lines) return lines;
    const exact = refusal(() => record(ctx, { topic: "t".repeat(120) }));
    return exact && `a 120-character topic was refused: ${exact}`;
  });

  // §3.4's grammar: fenced code is permitted, raw HTML and images are not. A
  // line-prefix check refused a fenced `# comment` and passed `<div>` and
  // `![x](y)` (F5/codex, slice-S1).
  check("B6 the stored-prose grammar: fenced code is accepted, raw HTML and images are refused", () => {
    const ctx = world("b6");
    seedSubsystem(ctx, "S-01", "mapped");
    const permitted = [
      ["a fenced Python comment", "The loader is short:\n\n```python\n# read the header first\nheader = f.read(8)\n```\n\nIt stops there."],
      ["a tilde fence with a table-like line", "Shape:\n\n~~~\n| not | a table |\n~~~"],
      ["HTML in a code span", "It emits `<div class=\"x\">` for each row."],
      ["HTML and an image inside a fence", "```html\n<img src=\"a.png\">\n![x](y.png)\n```"],
      ["a comparison", "It keeps a < b and c > d apart."],
      ["a link", "See [the parser](src/a.ts) for the rest."],
    ];
    for (const [label, body] of permitted) {
      const said = refusal(() => record(ctx, { body }));
      if (said) return `${label} was refused: ${said}`;
    }
    const forbidden = [
      ["raw HTML", "It renders <div>one row</div> per record."],
      ["an HTML comment", "Prose <!-- hidden --> here."],
      ["a self-closing tag", "A break<br/>here."],
      ["an image", "The shape:\n\n![diagram](shape.png)"],
      ["a heading after a closed fence", "```\ncode\n```\n# Parts"],
      ["a heading behind an unclosed shorter fence", "````\ncode\n```\n````\n## Parts"],
    ];
    for (const [label, body] of forbidden) {
      const said = refusesWith(ctx, RECORD, () => record(ctx, { body }), `a body with ${label}`);
      if (said) return said;
    }
    return null;
  });

  // ------------------------------------------------- E: the evidence

  check("E1 missing, absent and out-of-ledger evidence is refused", () => {
    const ctx = world("e1");
    seedSubsystem(ctx, "S-01", "mapped", ["src/a.ts"]);
    const outside = evidence(ctx, "src/b.ts");
    const cases = [
      ["no evidence_ids", { evidence_ids: [] }],
      ["an evidence row that does not exist", { evidence_ids: [987654] }],
      ["evidence outside the ledger", { evidence_ids: [outside] }],
      ["65 evidence ids", { evidence_ids: Array.from({ length: 65 }, (_, i) => i + 1) }],
    ];
    for (const [label, args] of cases) {
      const said = refusesWith(ctx, RECORD, () => record(ctx, args), label);
      if (said) return said;
    }
    const absentField = refusesWith(
      ctx,
      RECORD,
      () =>
        call(RECORD, { subject_type: "subsystem", subject_id: "S-01", section: "structure", body: bodyFor("structure"), ref_sha: headSha(ctx) }, ctx),
      "no evidence_ids field",
    );
    if (absentField) return absentField;
    const mixed = refusal(() => record(ctx, { evidence_ids: [outside, evidence(ctx, "src/a.ts")] }));
    return mixed && `a ledger file beside an outside one was refused: ${mixed}`;
  });

  check("E2 a ref_sha that does not resolve is refused", () => {
    const ctx = world("e2");
    seedSubsystem(ctx, "S-01", "mapped");
    const said = refusesWith(
      ctx,
      RECORD,
      () => record(ctx, { ref_sha: "b0a7e5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c" }),
      "an unreachable revision",
    );
    if (said) return said;
    return refusesWith(
      ctx,
      DECLINE,
      () => decline(ctx, { ref_sha: "b0a7e5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c" }),
      "an unreachable revision on a declination",
    );
  });

  // ------------------------------------------------- S: the effective row

  check("S1 the effective row is the newest per (subject, section, topic)", () => {
    const ctx = world("s1");
    seedSubsystem(ctx, "S-01", "mapped");
    const ev = evidence(ctx);
    const write = (topic, n) => {
      const refused = refusal(() => record(ctx, { evidence_ids: [ev], topic, body: bodyFor("structure", n) }));
      if (refused) throw new Error(`recording ${topic}/${n} was refused: ${refused}`);
    };
    write("alpha", 1);
    write("beta", 1);
    write("alpha", 2);
    const rows = effective(ctx, { subject_type: "subsystem", subject_id: "S-01", section: "structure" });
    if (rows.length !== 2) return `${rows.length} effective rows for two topics`;
    const alpha = rows.find((row) => row.topic === "alpha");
    const beta = rows.find((row) => row.topic === "beta");
    if (alpha?.body !== bodyFor("structure", 2)) return `alpha is "${alpha?.body}", not the second reading`;
    if (beta?.body !== bodyFor("structure", 1)) return `beta is "${beta?.body}"`;
    const declined = refusal(() => decline(ctx, { topic: "alpha", reason: "Superseded; nothing further to say." }));
    if (declined) return `declining a topic was refused: ${declined}`;
    const afterDecline = effective(ctx, { subject_type: "subsystem", subject_id: "S-01", section: "structure" });
    const alphaNow = afterDecline.find((row) => row.topic === "alpha");
    if (alphaNow?.disposition !== "declined") return `a later declination left alpha ${alphaNow?.disposition}`;
    write("alpha", 3);
    const afterRecord = effective(ctx, { subject_type: "subsystem", subject_id: "S-01", section: "structure" });
    const alphaLast = afterRecord.find((row) => row.topic === "alpha");
    if (alphaLast?.disposition !== "recorded" || alphaLast.body !== bodyFor("structure", 3)) {
      return `a later recording did not become effective: ${JSON.stringify(alphaLast)}`;
    }
    const history = get(ctx, { subject_type: "subsystem", subject_id: "S-01", section: "structure", history: true });
    const earlier = history.history ?? [];
    if (earlier.length !== 3) return `the history holds ${earlier.length} earlier rows, expected 3`;
    return afterRecord.length === 2 ? null : `${afterRecord.length} effective rows after three corrections`;
  });

  // The contract states the rule the reader applies. readNarratives takes the
  // newest row per (subject, section, topic) and does not resolve its revision
  // again on read; the contract said "the newest row that resolves" (F8/codex,
  // slice-S1). A newest row whose revision no longer resolves stays effective.
  check("S4 the effective rule the contract states is the one readNarratives applies", () => {
    const ctx = world("s4-contract-rule");
    seedSubsystem(ctx, "S-01", "mapped");
    const ev = evidence(ctx);
    const first = refusal(() => record(ctx, { evidence_ids: [ev], body: bodyFor("structure", 1) }));
    if (first) return `recording was refused: ${first}`;
    const second = refusal(() => record(ctx, { evidence_ids: [ev], body: bodyFor("structure", 2) }));
    if (second) return `recording was refused: ${second}`;
    ctx.db.exec("DROP TRIGGER IF EXISTS narrative_is_immutable");
    ctx.db.prepare("UPDATE narratives SET ref_sha = ? WHERE id = (SELECT MAX(id) FROM narratives)").run("f".repeat(40));
    const rows = effective(ctx, { subject_type: "subsystem", subject_id: "S-01", section: "structure" });
    if (rows.length !== 1 || rows[0].body !== bodyFor("structure", 2)) {
      return `the newest row with an unresolvable revision is not effective: ${JSON.stringify(rows.map((r) => r.body))}`;
    }
    const note = String(mods.vocabulary?.enums?.narrative_disposition?.note ?? "");
    if (!note) return "the contract's narrative_disposition carries no note";
    if (/newest row that resolves/.test(note)) return `the contract says "${note}", which readNarratives does not apply`;
    return /newest row per subject, section and topic/.test(note)
      ? null
      : `the contract's note does not state the per-topic rule: "${note}"`;
  });

  check("S2 narratives of one subject do not leak into another", () => {
    const ctx = world("s2");
    seedSubsystem(ctx, "S-01", "mapped");
    seedSubsystem(ctx, "S-02", "mapped");
    const refused = refusal(() => record(ctx, { body: bodyFor("structure", 7) }));
    if (refused) return `recording was refused: ${refused}`;
    const other = effective(ctx, { subject_type: "subsystem", subject_id: "S-02" });
    if (other.length !== 0) return `S-02 reads ${other.length} rows of S-01's`;
    const project = effective(ctx, { subject_type: "project" });
    if (project.length !== 0) return `the project reads ${project.length} rows of S-01's`;
    const unknown = refusal(() => get(ctx, { subject_type: "subsystem", subject_id: "S-99" }));
    return unknown ? null : "reading a subsystem that does not exist was not refused";
  });

  check("S3 get_narratives needs no session and writes nothing", () => {
    const ctx = world("s3");
    seedSubsystem(ctx, "S-01", "mapped");
    record(ctx);
    const before = narrativeCount(ctx);
    ctx.sessionId = null;
    const rows = effective(ctx, { subject_type: "subsystem", subject_id: "S-01" });
    if (rows.length !== 1) return `read ${rows.length} rows without a session`;
    return narrativeCount(ctx) === before ? null : "a read changed the table";
  });

  // ------------------------------------------------- X: reset

  check("X1 a reset withdraws every effective narrative of the subsystem and no other", () => {
    const ctx = world("x1");
    seedSubsystem(ctx, "S-01", "adversarial");
    seedSubsystem(ctx, "S-02", "adversarial");
    const ev = evidence(ctx);
    for (const section of SUBSYSTEM_SECTIONS) {
      record(ctx, { evidence_ids: [ev], section, topic: "one" });
      record(ctx, { evidence_ids: [ev], section, topic: "two" });
    }
    decline(ctx, { section: "structure", topic: "three" });
    record(ctx, { evidence_ids: [ev], subject_id: "S-02" });
    const before = effective(ctx, { subject_type: "subsystem", subject_id: "S-01" }).length;
    if (before !== 7) return `${before} effective narratives before the reset, expected 7`;
    const rowsBefore = narrativeCount(ctx);
    const result = call(
      "reset_subsystem",
      { id: "S-01", to_status: "structural", reason: "the structure was read wrongly" },
      ctx,
    );
    if (result.ok === false) return `the reset was refused: ${result.error}`;
    const after = effective(ctx, { subject_type: "subsystem", subject_id: "S-01" });
    if (after.length !== 0) return `${after.length} narratives of S-01 stay effective after the reset`;
    const written = narrativeCount(ctx) - rowsBefore;
    if (written !== 7) return `the reset wrote ${written} rows, expected one withdrawal per effective narrative (7)`;
    const withdrawn = ctx.db
      .prepare("SELECT body, session_id FROM narratives WHERE subject_id = 'S-01' AND disposition = 'withdrawn'")
      .all();
    if (withdrawn.length !== 7) return `${withdrawn.length} withdrawn rows for S-01`;
    if (!withdrawn.every((row) => row.body === "the structure was read wrongly" && row.session_id === ctx.sessionId)) {
      return `a withdrawn row does not carry the reason and the session: ${JSON.stringify(withdrawn[0])}`;
    }
    const kept = effective(ctx, { subject_type: "subsystem", subject_id: "S-02" });
    if (kept.length !== 1) return `the other subsystem's narrative was withdrawn: ${kept.length} effective`;
    const oldRows = ctx.db
      .prepare("SELECT COUNT(*) AS n FROM narratives WHERE subject_id = 'S-01' AND disposition <> 'withdrawn'")
      .get().n;
    if (oldRows !== 7) return `the reset deleted or altered earlier rows: ${oldRows} remain`;
    const history = get(ctx, { subject_type: "subsystem", subject_id: "S-01", history: true });
    if ((history.history ?? []).length < 7) return "the history lost the withdrawn narratives";
    if (typeof result.withdrawn_narratives !== "number" || result.withdrawn_narratives !== 7) {
      return `the reset reported withdrawn_narratives ${JSON.stringify(result.withdrawn_narratives)}`;
    }
    // After a withdrawal the section can be written again, and that row is effective.
    const again = refusal(() => record(ctx, { evidence_ids: [ev], topic: "one" }));
    if (again) return `a narrative recorded after the reset was refused: ${again}`;
    const reread = effective(ctx, { subject_type: "subsystem", subject_id: "S-01" });
    return reread.length === 1 && reread[0].topic === "one" ? null : `after re-recording: ${JSON.stringify(reread.map((r) => r.topic))}`;
  });

  check("X2 a reset withdraws an imported survey body of the subsystem and no other", () => {
    const ctx = world("x2");
    seedSubsystem(ctx, "S-01", "concerns");
    seedSubsystem(ctx, "S-02", "concerns");
    const importBody = (path, kind, subsystem) =>
      ctx.db
        .prepare(
          `INSERT INTO imported_artifacts (path, kind, subsystem_id, body, body_sha256, registered_hash, hash_matches, session_id)
           VALUES (?, ?, ?, ?, ?, 'h', 1, ?)`,
        )
        .run(path, kind, subsystem, "# Survey\n\nWritten earlier.\n", "a".repeat(64), ctx.sessionId);
    importBody("subsystems/S-01-survey.md", "subsystem-survey", "S-01");
    importBody("subsystems/S-02-survey.md", "subsystem-survey", "S-02");
    importBody("entry-point.md", "entry-point", null);
    const result = call(
      "reset_subsystem",
      { id: "S-01", to_status: "scoping", reason: "the survey is being redone" },
      ctx,
    );
    if (result.ok === false) return `the reset was refused: ${result.error}`;
    const withdrawals = ctx.db
      .prepare("SELECT path, reason, session_id FROM imported_artifact_withdrawals ORDER BY id")
      .all();
    if (withdrawals.length !== 1 || withdrawals[0].path !== "subsystems/S-01-survey.md") {
      return `withdrawals after the reset: ${JSON.stringify(withdrawals)}`;
    }
    if (withdrawals[0].reason !== "the survey is being redone" || withdrawals[0].session_id !== ctx.sessionId) {
      return `the withdrawal does not carry the reason and the session: ${JSON.stringify(withdrawals[0])}`;
    }
    const imported = ctx.db.prepare("SELECT COUNT(*) AS n FROM imported_artifacts").get().n;
    if (imported !== 3) return `the reset deleted an imported body: ${imported} remain`;
    if (result.withdrawn_imported_surveys !== 1) {
      return `the reset reported withdrawn_imported_surveys ${JSON.stringify(result.withdrawn_imported_surveys)}`;
    }
    // A second reset does not withdraw the same body twice.
    const second = call(
      "reset_subsystem",
      { id: "S-01", to_status: "scoping", reason: "the survey is being redone again" },
      ctx,
    );
    if (second.ok === false) return `the second reset was refused: ${second.error}`;
    const total = ctx.db.prepare("SELECT COUNT(*) AS n FROM imported_artifact_withdrawals").get().n;
    return total === 1 ? null : `a second reset wrote ${total - 1} more withdrawals of a body already withdrawn`;
  });

  check("X3 a reset with something to withdraw and no session is refused whole", () => {
    const ctx = world("x3");
    seedSubsystem(ctx, "S-01", "structural");
    record(ctx);
    const rows = narrativeCount(ctx);
    ctx.sessionId = null;
    const said = refusal(() =>
      call("reset_subsystem", { id: "S-01", to_status: "scoping", reason: "read it again from the start" }, ctx),
    );
    if (!said) return "a reset with a narrative to withdraw and no session was accepted";
    const status = ctx.db.prepare("SELECT status FROM subsystems WHERE id = 'S-01'").get().status;
    if (status !== "structural") return `the refused reset still moved the subsystem to ${status}`;
    return narrativeCount(ctx) === rows ? null : "the refused reset wrote rows";
  });

  // ------------------------------------------------- M: the sections come from the contract

  check("M1 the nine sections served are the contract's, with its rungs and evidence rule", () => {
    const section = mods.vocabulary?.enums?.narrative_section?.values;
    if (!Array.isArray(section)) return "the contract carries no narrative_section values";
    const names = section.map((entry) => entry.value).sort().join(",");
    const expected = [...SUBSYSTEM_SECTIONS, ...PROJECT_SECTIONS].sort().join(",");
    if (names !== expected) return `the contract's sections are ${names}`;
    for (const entry of section) {
      if (entry.subject_type === "subsystem" && entry.min_status !== RUNG[entry.value]) {
        return `${entry.value} rung is ${entry.min_status} in the contract`;
      }
      const wantsEvidence = entry.value !== "survey-plan";
      if ((entry.evidence === "required") !== wantsEvidence) return `${entry.value} evidence is ${entry.evidence}`;
    }
    return null;
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
      const narratives = await import("./dist/tools/narratives.js");
      mods.toolArrays.push(narratives.narrativeTools ?? []);
    } catch {
      /* the tools are absent; V1 says so */
    }
  }
  try {
    mods.vocabulary = JSON.parse(readFileSync(join(here, "contracts", "conspectus-vocabulary.json"), "utf8"));
  } catch {
    mods.vocabulary = null;
  }

  if (loadError) {
    checked++;
    failures.push(`V1 record_narrative, decline_narrative and get_narratives are not served — ${loadError}`);
  } else {
    await main(mods);
  }
} catch (error) {
  failures.push(`X9 the gate did not finish: ${scrub(error?.message ?? error)}`);
}

for (const note of notes) console.log(`  note ${note}`);
console.log(`  ran  ${checked} assertion(s) against ${join(here, "dist")}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`GATE SO3 RED: ${failures[0]}`);
  exitCode = 1;
} else {
  console.log("GATE SO3 GREEN");
}
process.exit(exitCode);
