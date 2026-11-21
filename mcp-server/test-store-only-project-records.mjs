#!/usr/bin/env node
// GATE SO4 (design/store-only/PLAN.md §2.2, §8 SO4) — the project records.
//
// The project's thesis, name, runtime boundary map and concern calibration used
// to live in hand-written Markdown. §2.2 gives each a record: the project's
// purpose is an explanation (`record_explanation(project, purpose)`, accepted
// before any subsystem is structural, over evidence, in one paragraph of at most
// 400 bytes), the name is `project_profile`, the runtime boundary map is
// `runtime_boundaries`, and `concerns` carry a territory and a probe beside
// `territory_dispositions`.
//
// Turns red when (PLAN §8 SO4):
//   - `record_explanation(project, purpose)` is refused with valid input before
//     any subsystem is structural, or accepted without evidence, over 400 bytes
//     or in more than one paragraph;
//   - `get_explanations(project)` does not return the purpose, or the Python
//     reader (`effective_explanations`) does not — including an `imported`
//     purpose, which reads as a recorded one for the project's purpose only;
//   - any refusal, tool description or served vocabulary text still names
//     `entry-point.md`;
//   - `record_project_profile`'s effective name is not the newest;
//   - `record_runtime_boundary` accepts a `recorded` row without evidence, a
//     newer row for an edge does not replace the older one, or a withdrawn edge
//     stays effective;
//   - `add_concern` drops `territory` or `probe`;
//   - `record_territory_disposition` accepts `disqualified` without a condition,
//     or the newest disposition for a territory is not the effective one;
//   - a refusal does not start with its tool's name, or leaves a row behind.
// Controls (a handler that refuses everything must be red): a purpose of exactly
// 400 bytes, a profile, a boundary, a withdrawal, a re-record, a concern with a
// territory and a probe, and both dispositions are accepted and read back.
//
// The gate drives the built handlers over fixtures it creates itself, as
// `test-explanations.mjs` does, reads the Python side through the materializer's
// own reader, and reads `tools/list` from the built server.
//
//   exit 0  `GATE SO4 GREEN`          — every assertion held
//   exit 1  `GATE SO4 RED: <reason>`  — the first assertion that failed

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const materializerDir = join(here, "..", "materializer");

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

const RECORD = "record_explanation";
const DECLINE = "decline_explanation";
const GET = "get_explanations";
const PROFILE = "record_project_profile";
const BOUNDARY = "record_runtime_boundary";
const WITHDRAW = "withdraw_runtime_boundary";
const BOUNDARIES = "get_runtime_boundaries";
const TERRITORY = "record_territory_disposition";
const NEW_TOOLS = [PROFILE, BOUNDARY, WITHDRAW, BOUNDARIES, TERRITORY];

const PURPOSE = "It lets a reader find what each file in a codebase is for, from a record kept beside the code.";

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
        clientInfo: { name: "so4", version: "0" },
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
      "-c", "user.email=so4@localhost",
      "-c", "user.name=project-records-so4",
      "-c", "commit.gpgsign=false",
      "commit", "-q", "--no-verify", "-m", message,
    ],
    { cwd, encoding: "utf8" },
  );
}

/** The materializer's own reading of the project's explanations, as JSON. */
function pythonReading(ctx) {
  const script = `
import json, sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(materializerDir)})
from amanuensis_materializer import readback
from amanuensis_materializer.db import open_ro
storage = Path(${JSON.stringify(ctx.project.storagePath)})
readback.BOUND_WORKSPACE.set(Path(${JSON.stringify(ctx.project.workspacePath)}))
conn = open_ro(Path(${JSON.stringify(ctx.project.dbPath)}))
out = {}
for (kind, sid, slot), reading in readback.effective_explanations(conn, storage).items():
    if kind != "project":
        continue
    out[slot] = {
        "state": reading.state,
        "id": reading.row["id"] if reading.row else None,
        "disposition": reading.row["disposition"] if reading.row else None,
        "body": reading.row["body"] if reading.row else None,
    }
print("READING " + json.dumps(out))
`;
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8", timeout: 60_000 });
  const line = String(result.stdout ?? "")
    .split("\n")
    .find((candidate) => candidate.startsWith("READING "));
  if (!line) return { error: `the Python reader printed no reading: ${String(result.stderr ?? "").slice(-300)}` };
  return JSON.parse(line.slice("READING ".length));
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

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-so4-"));
  const cleanups = [];

  /** A fresh workspace, store and open session. Every assertion that writes gets its own. */
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
    const project = resolveProject(ws, { selectionSource: "so4-project-records" });
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
    if (session) ctx.sessionId = call("start_session", { intent: `so4-${label}` }, ctx).session_id;
    return ctx;
  }
  const headSha = (ctx) => git(ctx.project.workspacePath, "rev-parse", "HEAD");
  const count = (ctx, table) => ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

  function seedSubsystem(ctx, id, status) {
    ctx.db.prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, ?)").run(id, `${id} fixture`, status);
    ctx.db
      .prepare(
        `INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha)
         VALUES (?, 'src/a.ts', 'fixture', 'examined', ?)`,
      )
      .run(id, headSha(ctx));
  }
  function evidence(ctx, file = "src/a.ts", kind = "code-verified") {
    return call(
      "add_evidence",
      { file_path: file, symbol: "Unit", line_range: "1-1", ref_sha: headSha(ctx), kind },
      ctx,
    ).id;
  }

  const purpose = (ctx, over = {}) =>
    call(
      RECORD,
      {
        subject_type: "project",
        subject_id: "project",
        slot: "purpose",
        body: PURPOSE,
        evidence_ids: [over.evidenceId ?? evidence(ctx)],
        ref_sha: headSha(ctx),
        ...over.args,
      },
      ctx,
    );
  const readProject = (ctx) => call(GET, { subject_type: "project" }, ctx);
  const slotOf = (reading, slot) => reading.slots?.find((entry) => entry.slot === slot);
  const stems = (tool, said) => said.startsWith(`${tool} refuses:`);
  /** The session refusal is `<tool> requires an active session`; it still opens with the tool's name. */
  const named = (tool, said) => said.startsWith(tool);

  // ------------------------------------------- V: the tools are served, built and listed

  check("V1 the five new tools are served by the built handlers", () => absent(...NEW_TOOLS));
  const listingWs = world("listing", { session: false }).project.workspacePath;
  const listing = await listTools(listingWs);
  check("V2 the built server lists the new tools, each with a description and a schema", () => {
    if (listing.error) return listing.error;
    const wrong = [];
    for (const name of NEW_TOOLS) {
      const tool = listing.tools.find((entry) => entry.name === name);
      if (!tool) wrong.push(`${name} is not listed`);
      else if (!tool.description || tool.inputSchema?.type !== "object") wrong.push(`${name} lacks a description or schema`);
    }
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  // ------------------------------------------- P: the project's purpose

  check("P1 a purpose is accepted before any subsystem exists, persisted and read back", () => {
    const ctx = world("p1");
    const receipt = purpose(ctx);
    if (receipt.ok !== true || receipt.slot !== "purpose" || receipt.disposition !== "recorded") {
      return `the receipt was ${JSON.stringify(receipt)}`;
    }
    const row = ctx.db.prepare("SELECT * FROM explanations WHERE id = ?").get(receipt.id);
    if (!row || row.subject_type !== "project" || row.slot !== "purpose" || row.body !== PURPOSE) {
      return `the stored row was ${JSON.stringify(row)}`;
    }
    const links = ctx.db.prepare("SELECT COUNT(*) AS n FROM explanation_evidence WHERE explanation_id = ?").get(receipt.id);
    return links.n === 1 ? null : `${links.n} evidence rows were linked`;
  });

  check("P2 a purpose is accepted while the only subsystem is unmapped", () => {
    const ctx = world("p2");
    seedSubsystem(ctx, "S-01", "unmapped");
    const said = refusal(() => purpose(ctx));
    return said ? `refused: ${said.slice(0, 160)}` : null;
  });

  check("P3 a purpose of exactly 400 bytes is accepted, one of 401 is refused with the tool's name", () => {
    const ctx = world("p3");
    const pad = (n) => `${"a".repeat(n - 1)}.`;
    const edge = refusal(() => purpose(ctx, { args: { body: pad(400) } }));
    if (edge) return `400 bytes was refused: ${edge.slice(0, 120)}`;
    const before = count(ctx, "explanations");
    const said = refusal(() => purpose(ctx, { args: { body: pad(401) } }));
    if (!said) return "401 bytes was accepted";
    if (!stems(RECORD, said)) return `refused with "${said.slice(0, 120)}"`;
    return count(ctx, "explanations") === before ? null : "the refusal left a row";
  });

  check("P4 a purpose with no evidence, or evidence that does not exist, is refused with the tool's name", () => {
    const ctx = world("p4");
    const before = count(ctx, "explanations");
    const wrong = [];
    for (const [label, ids] of [["none", []], ["a missing row", [999999]]]) {
      const said = refusal(() => purpose(ctx, { args: { evidence_ids: ids } }));
      if (!said) wrong.push(`${label} was accepted`);
      else if (!stems(RECORD, said)) wrong.push(`${label} was refused with "${said.slice(0, 100)}"`);
    }
    const names = evidence(ctx, "src/a.ts", "name-inferred");
    const only = refusal(() => purpose(ctx, { args: { evidence_ids: [names] } }));
    if (!only) wrong.push("evidence resting only on a name was accepted");
    if (count(ctx, "explanations") !== before) wrong.push("a refusal left a row");
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  check("P5 a purpose that is more than one paragraph or carries a heading is refused", () => {
    const ctx = world("p5");
    const wrong = [];
    for (const [label, body] of [
      ["two paragraphs", `${PURPOSE}\n\nIt also does more.`],
      ["a heading", `# What it is\n${PURPOSE}`],
    ]) {
      const said = refusal(() => purpose(ctx, { args: { body } }));
      if (!said) wrong.push(`${label} was accepted`);
      else if (!stems(RECORD, said)) wrong.push(`${label}: "${said.slice(0, 100)}"`);
    }
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  check("P6 recording a purpose needs an active session", () => {
    const ctx = world("p6", { session: false });
    const evidenceCtx = world("p6e");
    const said = refusal(() =>
      call(
        RECORD,
        {
          subject_type: "project",
          slot: "purpose",
          body: PURPOSE,
          evidence_ids: [evidence(evidenceCtx)],
          ref_sha: headSha(ctx),
        },
        ctx,
      ),
    );
    if (!said) return "a purpose was recorded with no session";
    return named(RECORD, said) ? null : `refused with "${said.slice(0, 120)}"`;
  });

  check("P7 declining a project's purpose is refused in the tool's own words, and the account still waits for a structural subsystem", () => {
    const ctx = world("p7");
    const decline = (slot) =>
      refusal(() =>
        call(
          DECLINE,
          { subject_type: "project", slot, reason: "Nothing to say yet.", ref_sha: headSha(ctx) },
          ctx,
        ),
      );
    const purposeSaid = decline("purpose");
    if (!purposeSaid) return "a project purpose was declined";
    if (!stems(DECLINE, purposeSaid)) return `refused with "${purposeSaid.slice(0, 120)}"`;
    const accountSaid = refusal(() =>
      call(
        RECORD,
        {
          subject_type: "project",
          slot: "account",
          body: "It reads a store.",
          evidence_ids: [evidence(ctx)],
          ref_sha: headSha(ctx),
        },
        ctx,
      ),
    );
    if (!accountSaid) return "a project account was recorded before any subsystem is structural";
    return accountSaid.includes("structural") ? null : `the account refusal said "${accountSaid.slice(0, 120)}"`;
  });

  check("P8 get_explanations(project) returns the purpose beside the account, before any subsystem is structural", () => {
    const ctx = world("p8");
    const empty = readProject(ctx);
    const emptyPurpose = slotOf(empty, "purpose");
    if (!emptyPurpose) return `the slots served were ${JSON.stringify(empty.slots?.map((s) => s.slot))}`;
    if (emptyPurpose.state !== "not-recorded") return `an empty purpose read ${emptyPurpose.state}`;
    if (!slotOf(empty, "account")) return "the account slot is no longer served";
    const receipt = purpose(ctx);
    const reading = readProject(ctx);
    const got = slotOf(reading, "purpose");
    if (got?.state !== "recorded") return `the purpose read ${got?.state}`;
    if (got.row?.body !== PURPOSE || got.row?.id !== receipt.id || got.row?.evidence_ids?.length !== 1) {
      return `the row was ${JSON.stringify(got.row)}`;
    }
    const account = slotOf(reading, "account");
    return account?.state === "not-recorded" ? null : `the account read ${account?.state}`;
  });

  check("P9 the newest purpose is the effective one", () => {
    const ctx = world("p9");
    purpose(ctx, { args: { body: "It first said this." } });
    const second = purpose(ctx, { args: { body: "It then said this." } });
    const got = slotOf(readProject(ctx), "purpose");
    if (got?.row?.id !== second.id || got.row.body !== "It then said this.") {
      return `the effective row was ${JSON.stringify(got?.row)}`;
    }
    return got.earlier_rows === 1 ? null : `${got.earlier_rows} earlier rows were kept`;
  });

  // ------------------------------------------- Q: the Python reader, and `imported`

  check("Q1 the Python reader returns a purpose recorded before any subsystem is structural", () => {
    const ctx = world("q1");
    const receipt = purpose(ctx);
    const reading = pythonReading(ctx);
    if (reading.error) return reading.error;
    const got = reading.purpose;
    if (!got || got.state !== "recorded" || got.id !== receipt.id || got.body !== PURPOSE) {
      return `the Python reading was ${JSON.stringify(got)}`;
    }
    return reading.account ? `an account was read: ${JSON.stringify(reading.account)}` : null;
  });

  check("Q2 an imported purpose reads as a recorded one in TypeScript and in Python", () => {
    const ctx = world("q2");
    const body = "It is a thesis copied in from an earlier version.";
    const id = ctx.db
      .prepare(
        `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
         VALUES ('project', 'project', 'purpose', 'imported', ?, ?, ?)`,
      )
      .run(body, headSha(ctx), ctx.sessionId).lastInsertRowid;
    const got = slotOf(readProject(ctx), "purpose");
    if (got?.state !== "recorded" || got.row?.id !== Number(id) || got.row?.body !== body) {
      return `TypeScript read ${JSON.stringify(got)}`;
    }
    const reading = pythonReading(ctx);
    if (reading.error) return reading.error;
    const py = reading.purpose;
    if (!py || py.state !== "recorded" || py.id !== Number(id) || py.body !== body) {
      return `Python read ${JSON.stringify(py)}`;
    }
    // A recorded purpose is newer than the import and replaces it.
    const next = purpose(ctx, { args: { body: "It is now written from the code." } });
    const after = slotOf(readProject(ctx), "purpose");
    return after?.row?.id === next.id ? null : `the newer purpose was not effective: ${JSON.stringify(after?.row)}`;
  });

  // §2.2: a purpose recorded at onboarding "must be readable and must render";
  // §3.3 and D2 put it on the overview, an imported one labelled. Reading it in
  // Python is not enough: the read-back owed it on architecture.md, which no
  // renderer filled, so a store with a purpose could not publish (F1/codex,
  // slice-S1).
  check("Q4 a recorded and an imported purpose render on the overview, and the read-back holds them there", () => {
    const LABEL = "imported from the entry point, not tied to evidence";
    const cases = [
      ["recorded", "It records which file does what, read from the code itself.", (ctx, body) => purpose(ctx, { args: { body } })],
      [
        "imported",
        "It records which file does what, as an earlier version wrote it.",
        (ctx, body) =>
          ctx.db
            .prepare(
              `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
               VALUES ('project', 'project', 'purpose', 'imported', ?, ?, ?)`,
            )
            .run(body, headSha(ctx), ctx.sessionId),
      ],
    ];
    for (const [kind, body, write] of cases) {
      const ctx = world(`q4-${kind}`);
      write(ctx, body);
      const out = join(ctx.project.storagePath, "docs");
      const run = (...extra) =>
        spawnSync(
          "python3",
          [
            join(materializerDir, "materialize.py"),
            "--storage", ctx.project.storagePath,
            "--workspace", ctx.project.workspacePath,
            "--output", out,
            ...extra,
          ],
          { encoding: "utf8", timeout: 120_000 },
        );
      const published = run();
      if (published.status !== 0) {
        const said = String(published.stdout ?? "").trim().split("\n").at(-1) ?? "";
        let mismatches = said.slice(-400);
        try {
          const summary = JSON.parse(said);
          mismatches = JSON.stringify(summary.readback?.mismatches ?? summary.mismatches ?? []).slice(0, 600);
        } catch {
          /* not a summary line: the tail is the evidence */
        }
        return `the ${kind} purpose's store did not publish (exit ${published.status}): ${mismatches}`;
      }
      for (const page of ["index.md", "index.html"]) {
        const text = existsSync(join(out, page)) ? readFileSync(join(out, page), "utf8") : "";
        if (!text.includes(body)) return `the ${kind} purpose is not on ${page}`;
        if ((kind === "imported") !== text.includes(LABEL)) {
          return `${page} ${kind === "imported" ? "lacks" : "carries"} the imported label for a ${kind} purpose`;
        }
      }
      // The census must look for it there: remove it from the overview and the
      // read-back's state axis turns red on the purpose.
      const html = join(out, "index.html");
      const original = readFileSync(html, "utf8");
      writeFileSync(html, original.split(body).join(""));
      const verdict = run("--readback-only");
      writeFileSync(html, original);
      if (verdict.status === 0) return `the read-back passed with the ${kind} purpose removed from index.html`;
      if (!String(verdict.stdout ?? "").includes("project:purpose")) {
        return `the read-back did not name the purpose: ${String(verdict.stdout ?? "").slice(-300)}`;
      }
      if (kind === "imported") {
        writeFileSync(html, original.split(LABEL).join(""));
        const unlabelled = run("--readback-only");
        writeFileSync(html, original);
        if (unlabelled.status === 0) return "the read-back passed with the imported label removed from index.html";
      }
    }
    return null;
  });

  check("Q3 an imported row is not admitted where the schema forbids it", () => {
    const ctx = world("q3");
    seedSubsystem(ctx, "S-01", "structural");
    let stored = true;
    try {
      ctx.db
        .prepare(
          `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
           VALUES ('subsystem', 'S-01', 'purpose', 'imported', 'x', ?, ?)`,
        )
        .run(headSha(ctx), ctx.sessionId);
    } catch {
      stored = false;
    }
    return stored ? "an imported subsystem purpose was stored" : null;
  });

  // ------------------------------------------- N: nothing names entry-point.md

  check("N1 no refusal, tool description or served vocabulary text names entry-point.md", () => {
    const ctx = world("n1");
    const said = [];
    const grab = (label, fn) => {
      const text = refusal(fn);
      if (text) said.push([label, text]);
    };
    grab("decline purpose", () =>
      call(DECLINE, { subject_type: "project", slot: "purpose", reason: "None.", ref_sha: headSha(ctx) }, ctx),
    );
    grab("record account", () =>
      call(RECORD, { subject_type: "project", slot: "account", body: "x", evidence_ids: [evidence(ctx)], ref_sha: headSha(ctx) }, ctx),
    );
    grab("record purpose, no evidence", () => purpose(ctx, { args: { evidence_ids: [] } }));
    grab("record purpose, long", () => purpose(ctx, { args: { body: "a".repeat(500) } }));
    grab("record purpose, two paragraphs", () => purpose(ctx, { args: { body: "a.\n\nb." } }));
    grab("decline account", () =>
      call(DECLINE, { subject_type: "project", slot: "account", reason: "None.", ref_sha: headSha(ctx) }, ctx),
    );
    const hits = said.filter(([, text]) => text.includes("entry-point.md")).map(([label]) => label);
    if (hits.length > 0) return `refusals naming entry-point.md: ${hits.join(", ")}`;
    if (said.length < 5) return `only ${said.length} of the six refusals were produced`;
    for (const name of [RECORD, DECLINE, GET]) {
      const description = allTools.get(name)?.description ?? "";
      if (description.includes("entry-point.md")) return `${name}'s description names entry-point.md`;
    }
    const source = join(here, "src", "tools", "explanations.ts");
    if (existsSync(source) && readFileSync(source, "utf8").includes("entry-point.md")) {
      return "src/tools/explanations.ts still names entry-point.md";
    }
    const register = join(here, "contracts", "refusal-parity.json");
    const entries = JSON.parse(readFileSync(register, "utf8")).refusals ?? [];
    const stale = entries.filter((entry) => String(entry.server?.phrase ?? "").includes("entry-point.md"));
    if (stale.length > 0) return `the register still expects: ${stale.map((entry) => entry.id).join(", ")}`;
    const subjects = mods.vocabulary?.enums?.explanation_subject?.values ?? [];
    const project = subjects.find((entry) => entry.value === "project");
    return JSON.stringify(project ?? {}).includes("entry-point.md")
      ? "the contract's project subject still says the purpose is the thesis in entry-point.md"
      : null;
  });

  // ------------------------------------------- R: the project's name

  check("R1 the profile's effective name is the newest, and a correction keeps the earlier row", () => {
    const ctx = world("r1");
    const first = call(PROFILE, { name: "Alpha", ref_sha: headSha(ctx) }, ctx);
    if (first.ok !== true) return `the receipt was ${JSON.stringify(first)}`;
    const second = call(PROFILE, { name: "Beta", ref_sha: headSha(ctx) }, ctx);
    const effective = mods.readProjectProfile?.(ctx.db);
    if (!effective) return "readProjectProfile is not exported or returned nothing";
    if (effective.name !== "Beta" || effective.id !== second.id) return `the effective profile was ${JSON.stringify(effective)}`;
    if (count(ctx, "project_profile") !== 2) return "the earlier row was not kept";
    const third = call(PROFILE, { name: "Alpha", ref_sha: headSha(ctx) }, ctx);
    return mods.readProjectProfile(ctx.db)?.id === third.id ? null : "a name recorded again after another was not effective";
  });

  check("R2 a profile with no name, a blank name, a name over a line or an unresolvable revision is refused", () => {
    const ctx = world("r2");
    const before = count(ctx, "project_profile");
    const wrong = [];
    for (const [label, args] of [
      ["no name", { ref_sha: headSha(ctx) }],
      ["a blank name", { name: "   ", ref_sha: headSha(ctx) }],
      ["a two-line name", { name: "Alpha\nBeta", ref_sha: headSha(ctx) }],
      ["a name over 120 characters", { name: "n".repeat(121), ref_sha: headSha(ctx) }],
      ["a revision that does not resolve", { name: "Alpha", ref_sha: "b0a7e5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c" }],
    ]) {
      const said = refusal(() => call(PROFILE, args, ctx));
      if (!said) wrong.push(`${label} was accepted`);
    }
    const sessionless = world("r2s", { session: false });
    const said = refusal(() => call(PROFILE, { name: "Alpha", ref_sha: headSha(sessionless) }, sessionless));
    if (!said) wrong.push("a profile was recorded with no session");
    else if (!named(PROFILE, said)) wrong.push(`refused with "${said.slice(0, 100)}"`);
    if (count(ctx, "project_profile") !== before) wrong.push("a refusal left a row");
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  // ------------------------------------------- B: the runtime boundary map

  const edge = { from_runtime: "node", from_language: "TypeScript", to_runtime: "python3", mechanism: "child process over stdio" };
  const boundary = (ctx, over = {}, evidenceIds) =>
    call(
      BOUNDARY,
      { ...edge, notes: "The server shells out for the orientation lint.", evidence_ids: evidenceIds ?? [evidence(ctx)], ref_sha: headSha(ctx), ...over },
      ctx,
    );
  const effectiveEdges = (ctx) => call(BOUNDARIES, {}, ctx).boundaries ?? [];

  check("B1 a recorded boundary is persisted with its evidence and read back by get_runtime_boundaries", () => {
    const ctx = world("b1");
    const ev = evidence(ctx);
    const receipt = boundary(ctx, {}, [ev]);
    if (receipt.ok !== true) return `the receipt was ${JSON.stringify(receipt)}`;
    const row = ctx.db.prepare("SELECT * FROM runtime_boundaries WHERE id = ?").get(receipt.id);
    if (!row || row.origin !== "recorded" || row.withdrawn !== 0 || row.from_runtime !== "node") {
      return `the stored row was ${JSON.stringify(row)}`;
    }
    const link = ctx.db.prepare("SELECT evidence_id FROM runtime_boundary_evidence WHERE boundary_id = ?").all(receipt.id);
    if (link.length !== 1 || link[0].evidence_id !== ev) return `the evidence links were ${JSON.stringify(link)}`;
    const served = effectiveEdges(ctx);
    if (served.length !== 1) return `${served.length} edges were served`;
    const got = served[0];
    const same =
      got.from_runtime === "node" && got.from_language === "TypeScript" && got.to_runtime === "python3" &&
      got.mechanism === edge.mechanism && got.origin === "recorded" && JSON.stringify(got.evidence_ids) === JSON.stringify([ev]);
    return same ? null : `the edge served was ${JSON.stringify(got)}`;
  });

  check("B2 a recorded boundary with no evidence, or evidence that does not exist, is refused with the tool's name", () => {
    const ctx = world("b2");
    const before = count(ctx, "runtime_boundaries");
    const wrong = [];
    for (const [label, ids] of [["none", []], ["a missing row", [999999]]]) {
      const said = refusal(() => boundary(ctx, {}, ids));
      if (!said) wrong.push(`${label} was accepted`);
      else if (!stems(BOUNDARY, said)) wrong.push(`${label} was refused with "${said.slice(0, 100)}"`);
    }
    const noEvidenceArg = refusal(() =>
      call(BOUNDARY, { ...edge, ref_sha: headSha(ctx) }, ctx),
    );
    if (!noEvidenceArg) wrong.push("a boundary with no evidence_ids argument was accepted");
    for (const [label, over] of [["no mechanism", { mechanism: "" }], ["no to_runtime", { to_runtime: " " }]]) {
      if (!refusal(() => boundary(ctx, over))) wrong.push(`${label} was accepted`);
    }
    if (count(ctx, "runtime_boundaries") !== before) wrong.push("a refusal left a row");
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  check("B3 the newest row per edge is effective, and another edge is kept beside it", () => {
    const ctx = world("b3");
    boundary(ctx, { notes: "First reading." });
    boundary(ctx, { to_runtime: "sqlite", mechanism: "in-process library call", notes: "Another edge." });
    const second = boundary(ctx, { notes: "Second reading." });
    const served = effectiveEdges(ctx);
    if (served.length !== 2) return `${served.length} edges were served`;
    const python = served.find((entry) => entry.to_runtime === "python3");
    if (python?.id !== second.id || python.notes !== "Second reading.") return `the python edge was ${JSON.stringify(python)}`;
    const effective = mods.readRuntimeBoundaries?.(ctx.db);
    if (!effective) return "readRuntimeBoundaries is not exported";
    return effective.rows?.length === 2 ? null : `readRuntimeBoundaries returned ${effective.rows?.length} rows`;
  });

  check("B4 a withdrawn edge is not effective, withdrawing needs an edge that stands, and re-recording restores it", () => {
    const ctx = world("b4");
    if (absent(WITHDRAW)) return absent(WITHDRAW);
    boundary(ctx);
    boundary(ctx, { to_runtime: "sqlite", mechanism: "in-process library call" });
    const withdraw = (over = {}) =>
      call(WITHDRAW, { from_runtime: edge.from_runtime, to_runtime: edge.to_runtime, mechanism: edge.mechanism, ref_sha: headSha(ctx), ...over }, ctx);
    const receipt = withdraw({ reason: "The lint is called in process now." });
    if (receipt.ok !== true) return `the receipt was ${JSON.stringify(receipt)}`;
    const row = ctx.db.prepare("SELECT * FROM runtime_boundaries WHERE id = ?").get(receipt.id);
    if (!row || row.withdrawn !== 1) return `the withdrawal row was ${JSON.stringify(row)}`;
    let served = effectiveEdges(ctx);
    if (served.length !== 1 || served[0].to_runtime !== "sqlite") {
      return `the edges served after the withdrawal were ${JSON.stringify(served.map((entry) => entry.to_runtime))}`;
    }
    const again = refusal(() => withdraw());
    if (!again) return "an edge that was already withdrawn was withdrawn again";
    if (!stems(WITHDRAW, again)) return `refused with "${again.slice(0, 100)}"`;
    const unknown = refusal(() => withdraw({ mechanism: "carrier pigeon" }));
    if (!unknown) return "an edge that was never recorded was withdrawn";
    if (!stems(WITHDRAW, unknown)) return `refused with "${unknown.slice(0, 100)}"`;
    if (count(ctx, "runtime_boundaries") !== 3) return "a refused withdrawal left a row";
    const effective = mods.readRuntimeBoundaries?.(ctx.db);
    if (!effective || effective.rows.length !== 1 || effective.withdrawn !== 1) {
      return `readRuntimeBoundaries returned ${JSON.stringify(effective && { rows: effective.rows.length, withdrawn: effective.withdrawn })}`;
    }
    boundary(ctx, { notes: "Back again." });
    served = effectiveEdges(ctx);
    return served.length === 2 ? null : `${served.length} edges were served after the edge was recorded again`;
  });

  // ------------------------------------------- C: concern calibration

  const TERRITORY_ID = "T7";
  const PROBE = "Inspect every multi-table mutation for one transaction covering the invariant it claims.";

  check("C1 add_concern keeps territory and probe, and list_concerns returns them", () => {
    const ctx = world("c1", { session: false });
    const receipt = call(
      "add_concern",
      { code: "AT-1", category: "atomicity", origin: "seeded", territory: TERRITORY_ID, probe: PROBE, notes: "Seeded." },
      ctx,
    );
    if (receipt.ok !== true) return `the receipt was ${JSON.stringify(receipt)}`;
    const row = ctx.db.prepare("SELECT territory, probe, category, notes FROM concerns WHERE code = 'AT-1'").get();
    if (row?.territory !== TERRITORY_ID || row?.probe !== PROBE) return `the stored row was ${JSON.stringify(row)}`;
    const listed = call("list_concerns", {}, ctx).find((entry) => entry.code === "AT-1");
    if (listed?.territory !== TERRITORY_ID || listed?.probe !== PROBE) return `list_concerns returned ${JSON.stringify(listed)}`;
    call("add_concern", { code: "AT-1", origin: "seeded", territory: "T2", probe: "A new probe." }, ctx);
    const again = ctx.db.prepare("SELECT territory, probe FROM concerns WHERE code = 'AT-1'").get();
    if (again?.territory !== "T2" || again?.probe !== "A new probe.") return `a second add_concern left ${JSON.stringify(again)}`;
    call("add_concern", { code: "CC-1", origin: "discovered" }, ctx);
    const bare = ctx.db.prepare("SELECT territory, probe FROM concerns WHERE code = 'CC-1'").get();
    return bare?.territory === null && bare?.probe === null ? null : `a concern with neither held ${JSON.stringify(bare)}`;
  });

  check("C2 a territory that is not a territory id is refused, and leaves no concern behind", () => {
    const ctx = world("c2", { session: false });
    const said = refusal(() => call("add_concern", { code: "AT-9", origin: "seeded", territory: "atomicity", probe: PROBE }, ctx));
    if (!said) return "a territory named in words was accepted";
    if (!stems("add_concern", said)) return `refused with "${said.slice(0, 120)}"`;
    return ctx.db.prepare("SELECT COUNT(*) AS n FROM concerns WHERE code = 'AT-9'").get().n === 0 ? null : "the refusal left a concern";
  });

  const disposition = (ctx, over = {}) =>
    call(TERRITORY, { territory: "T3", disposition: "applies", ref_sha: headSha(ctx), ...over }, ctx);

  check("C3 a territory disposition of each kind is accepted, persisted and effective", () => {
    const ctx = world("c3");
    const applies = disposition(ctx);
    if (applies.ok !== true) return `the receipt was ${JSON.stringify(applies)}`;
    const q = ctx.db.prepare("INSERT INTO open_questions (category, question) VALUES ('other', 'Is T4 absent?')").run();
    const disqualified = disposition(ctx, {
      territory: "T4",
      disposition: "disqualified",
      condition: "The project has no exceptional paths of its own.",
      open_question_id: Number(q.lastInsertRowid),
    });
    const rows = mods.readTerritoryDispositions?.(ctx.db);
    if (!rows) return "readTerritoryDispositions is not exported";
    const t3 = rows.find((row) => row.territory === "T3");
    const t4 = rows.find((row) => row.territory === "T4");
    if (t3?.disposition !== "applies" || t3.id !== applies.id) return `T3 read ${JSON.stringify(t3)}`;
    if (t4?.disposition !== "disqualified" || t4.id !== disqualified.id || !t4.condition || t4.open_question_id !== Number(q.lastInsertRowid)) {
      return `T4 read ${JSON.stringify(t4)}`;
    }
    return rows.length === 2 ? null : `${rows.length} territories were effective`;
  });

  check("C4 a disqualified territory with no condition is refused, and an unknown open question is refused", () => {
    const ctx = world("c4");
    const before = count(ctx, "territory_dispositions");
    const wrong = [];
    for (const [label, over] of [
      ["no condition", { disposition: "disqualified" }],
      ["a blank condition", { disposition: "disqualified", condition: "   " }],
      ["an unknown open question", { disposition: "disqualified", condition: "None applies.", open_question_id: 999999 }],
      ["a territory named in words", { territory: "atomicity" }],
      ["a disposition outside the contract", { disposition: "maybe" }],
    ]) {
      const said = refusal(() => disposition(ctx, over));
      if (!said) wrong.push(`${label} was accepted`);
      else if (!stems(TERRITORY, said) && label !== "a disposition outside the contract") wrong.push(`${label} was refused with "${said.slice(0, 100)}"`);
    }
    const sessionless = world("c4s", { session: false });
    if (!refusal(() => disposition(sessionless))) wrong.push("a disposition was recorded with no session");
    if (count(ctx, "territory_dispositions") !== before) wrong.push("a refusal left a row");
    return wrong.length === 0 ? null : wrong.join("; ");
  });

  check("C5 the newest disposition per territory is the effective one", () => {
    const ctx = world("c5");
    disposition(ctx, { disposition: "disqualified", condition: "No caches." });
    const later = disposition(ctx, { disposition: "applies" });
    const rows = mods.readTerritoryDispositions?.(ctx.db) ?? [];
    const t3 = rows.filter((row) => row.territory === "T3");
    if (t3.length !== 1 || t3[0].id !== later.id || t3[0].disposition !== "applies") return `T3 read ${JSON.stringify(t3)}`;
    return count(ctx, "territory_dispositions") === 2 ? null : "the earlier row was not kept";
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
    const [concerns, evidence, explanations, project, subsystems] = await Promise.all([
      import("./dist/tools/concerns.js"),
      import("./dist/tools/evidence.js"),
      import("./dist/tools/explanations.js"),
      import("./dist/tools/project.js"),
      import("./dist/tools/subsystems.js"),
    ]);
    mods.toolArrays = [
      concerns.concernTools,
      evidence.evidenceTools,
      explanations.explanationTools,
      project.projectTools,
      subsystems.subsystemTools,
    ];
    const invariants = await import("./dist/invariants.js");
    mods.readProjectProfile = invariants.readProjectProfile;
    mods.readRuntimeBoundaries = invariants.readRuntimeBoundaries;
    mods.readTerritoryDispositions = invariants.readTerritoryDispositions;
  } catch (error) {
    loadError = `the server build could not be loaded: ${scrub(error?.message ?? error)}`;
  }
  if (!loadError) {
    try {
      const records = await import("./dist/tools/project-records.js");
      mods.toolArrays.push(records.projectRecordTools ?? []);
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
    failures.push(`V1 the project record tools are not served — ${loadError}`);
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
  console.log(`GATE SO4 RED: ${failures[0]}`);
  exitCode = 1;
} else {
  console.log("GATE SO4 GREEN");
}
process.exit(exitCode);
