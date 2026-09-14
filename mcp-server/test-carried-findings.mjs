#!/usr/bin/env node
// GATE CF1 (spec.md §8.4) — packet P4 of the survey-depth lane.
//
// A reinitialization discards a conspectus. Today nothing carries a prior
// finding into the successor: `dev/rebuild-self-conspectus-store.mjs` snapshots,
// stops, deletes and reinitializes, and the six baseline open findings B03-5,
// B03-6, B03-7, B03-8, B04-5 and B07-1 survive only as text in an archive
// nobody re-reads. `pecia audit` flags closed records whose reference stopped
// resolving; an *open* finding's destruction is invisible to it.
//
// §5.2 gives the carried record its own tables, outside the findings namespace.
// §5.3 gives the store it came from a minted identity. §5.4 says who may write
// each terminal outcome and on what evidence. §5.5 makes an undecided carried
// finding block *fully surveyed*. This gate reads all four.
//
// Two names appear below. `GATE CF1` is what spec.md §8.4 calls this gate;
// `GATE P4` is the packet id the launcher greps for. The status line carries
// both so neither reader has to translate.
//
//   exit 0  `GATE P4 GREEN`          — every assertion held
//   exit 1  `GATE P4 RED: <reason>`  — an assertion fired
//
// This gate has no third state. Its inputs are temporary git workspaces and
// stores it creates itself, including the *archives* it carries from: the
// frozen store at ~/.claude/automations/amanuensis-clean-slate/archive is never
// read here, because a gate whose red proof needs a machine-local file cannot
// be proved on a clean checkout (spec.md §8.0 clause 3). `GATE CR1` (§8.9a) is
// the gate that reads that archive, and it declares a `cannot run`.
//
// The four tables this packet creates are created by the gate's own fixture
// when the store does not carry them, so every assertion is about *behaviour* —
// a call that should have been refused and was not, a row that should have been
// unwritable and was written — rather than about schema arrival (spec.md §8.0).
// The gate never creates the triggers: a store whose schema does not ship them
// fails the T-arms, which is the point. Where an assertion needs a tool this
// packet adds, it reports the tool absent from the server's own surface, which
// is an assertion the gate can make and print.
//
// Must-stay-green controls (VP4(f) — a kill proves a gate can fire, never that
// it fires selectively):
//   G1  a store whose carried records all carry terminal outcomes is fully
//       surveyed on clause 7
//   G2  a store whose only outcomes are `archived-terminal` is too — the carry's
//       own pre-record is terminal, not a second undecided state
//   G3  clause 7 does not bind at `mapped`: a subsystem still advances while a
//       carried finding is undecided, because a rebuild progresses subsystem by
//       subsystem (README §4)
//   G4  each authority rule accepts the call that satisfies it — `ruled-out`
//       with current-session evidence, `repaired` with a post-repair reading,
//       `successor-finding` naming a finding filed here
//   G5  an export that *does* carry `archived_store_id` is accepted as a carry
//       source; the refusal is about the missing field, not about exports
//
// False greens it cannot exclude:
//   - Whether a `ruled-out` carried finding was really ruled out, or a
//     `successor-finding` really names the same defect. The substrate can
//     require evidence collected here, a finding filed here, and a commit that
//     resolves; it cannot read the judgement.
//   - Whether the carry read *every* finding the archive holds. This gate
//     compares a carry against the counts the source declares; `GATE CR1`
//     (§8.9a) compares the receipt against the real archive, id by id.
//   - Ancestry is re-derived from the workspace at every read, so a gate run
//     and a later read can disagree if history is rewritten between them. That
//     is the intended reading: a rewritten repair does not stay discharged.
//
// What a reviewer should sabotage, and what must go red:
//   drop --carry-from from the rebuild driver                    → C1
//   accept --carry-from none with no reason                      → C2
//   write no carry_runs row for an empty carry                   → C3
//   accept an export with no archived_store_id                   → C4
//   let a carry finish with imported_count != expected_count     → C6, C7
//   pre-record an archived closed finding as `repaired`          → C9
//   let record_carried_outcome write `archived-terminal`         → D5
//   drop the current-session evidence rule from `ruled-out`      → D1, D2
//   stop resolving repaired_sha                                  → D3
//   drop the merge-base ancestry test from `repaired`            → D4
//   accept a successor_id that names no findings row             → D6
//   drop idx_carried_outcome_one                                 → D8
//   drop record_carried_outcome's standing-outcome check          → (nothing:
//       idx_carried_outcome_one still refuses the write, so the property D7
//       names still holds. It takes both guards going for a record to reach
//       two outcomes, which is why D7 and D8 read one guard each.)
//   derive the store id from git_state instead of minting it     → B2, B3
//   drop the legacy fallback for a store with no identity row    → B4
//   put carried rows in `findings`                               → A5
//   drop UNIQUE (archived_store_id, archived_finding_id)         → A6
//   drop any immutability or no-delete trigger                   → T1..T8
//   drop clause 7 from the store-scoped predicate                → E1
//   enforce clause 7 at `mapped`                                 → G3
//   declare a carried tool without advertising it                → F1
//   serve every carried record in one envelope                   → F2
//   drop carried_finding_outcome from the vocabulary contract    → V1, V2

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..");

// A crash signature in this gate's output means the run never reached its
// assertion, so the launcher rejects it as a red proof (spec.md §8.0 clause 1).
// Assertion detail is quoted from live errors and from subprocess output, so it
// is scrubbed rather than trusted. The elided form breaks the token in the
// middle: `<TypeError elided>` still contains `TypeError`, so a marker that
// merely wraps the word would leave the signature in the output it removes.
const CRASH_SIGNATURES = [
  "MODULE_NOT_FOUND",
  "Cannot find module",
  "ModuleNotFoundError",
  "SyntaxError",
  "No such file or directory",
  "command not found",
  "ImportError",
  "ENOENT",
  "ReferenceError",
  "is not defined",
  "TypeError",
  "is not a function",
];
function elide(signature) {
  const cut = Math.ceil(signature.length / 2);
  return `${signature.slice(0, cut)}…${signature.slice(cut)}`;
}
function scrub(text) {
  let out = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  for (const signature of CRASH_SIGNATURES) {
    out = out.split(signature).join(elide(signature));
  }
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
async function checkAsync(label, fn) {
  checked++;
  try {
    const detail = await fn();
    if (detail) failures.push(`${label}: ${scrub(detail)}`);
  } catch (error) {
    failures.push(`${label}: threw — ${scrub(error?.message ?? error)}`);
  }
}

/** Run `fn`, returning its refusal message, or null when it did not refuse. */
function refusal(fn) {
  try {
    const value = fn();
    // A tool may refuse by returning `{ok:false,error}` rather than throwing.
    if (value && typeof value === "object" && value.ok === false && value.error) {
      return String(value.error);
    }
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}

// -------------------------------------------------------- a server subprocess

/**
 * Drive the built server over stdio: `tools/list`, then each call in order.
 *
 * Two arms need a *different process* than the one that wrote the rows. A tool
 * declared in `src/tools/` and never spread into the server's array is declared
 * and not offered — the shape `gen-tool-inventory.mjs`'s reconcile() reports,
 * and one no in-process import can see, because importing the array proves the
 * array and not the surface. And §7.4 step 6 asks that the carried count be
 * read back by a process that did not write it.
 */
async function serverSession(workspace, calls = []) {
  return await new Promise((resolveFn) => {
    let settled = false;
    let server = null;
    const results = [];
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
      () => done({ error: "the server did not answer within 120s" }),
      120_000,
    );
    try {
      // `cwd` is the workspace, not this directory: the server refuses a
      // `--workspace` that disagrees with the directory it was launched from
      // (`assertWorkspaceMatchesLaunch`).
      server = spawn(process.execPath, [join(here, "dist", "index.js"), "--workspace", workspace], {
        cwd: workspace,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      done({ error: String(error?.message ?? error) });
      return;
    }
    let out = "";
    let tools = null;
    let stderr = "";
    server.on("error", (error) => done({ error: String(error?.message ?? error) }));
    server.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const send = (message) => {
      try {
        server.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        done({ error: String(error?.message ?? error) });
      }
    };
    server.stdout.on("data", (chunk) => {
      out += chunk.toString();
      const lines = out.split("\n");
      out = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim().startsWith("{")) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 2) {
          tools = message.result?.tools ?? [];
          if (calls.length === 0) done({ tools, results });
          else send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: calls[0] });
          continue;
        }
        if (typeof message.id === "number" && message.id >= 3) {
          const index = message.id - 3;
          let payload = null;
          try {
            payload = JSON.parse(message.result?.content?.[0]?.text ?? "null");
          } catch {
            payload = null;
          }
          results[index] = {
            payload,
            bytes:
              String(message.result?.content?.[0]?.text ?? "").length +
              JSON.stringify(message.result?.structuredContent ?? null).length,
            isError: message.result?.isError === true,
            error: message.error ? JSON.stringify(message.error) : null,
          };
          if (index + 1 < calls.length) {
            send({ jsonrpc: "2.0", id: 4 + index, method: "tools/call", params: calls[index + 1] });
          } else {
            done({ tools, results });
          }
        }
      }
    });
    server.on("exit", (code) => done({ error: `the server exited ${code}: ${stderr.slice(0, 400)}` }));
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "cf1", version: "0" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
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
  /** Null when the tool exists; the sentence to report when it does not. */
  function absent(name, obligation) {
    return allTools.has(name)
      ? null
      : `${name} is absent from the server's tool surface, so ${obligation} is carried by nothing`;
  }

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-cf1-"));
  const cleanups = [];

  function git(cwd, ...args) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return String(result.stdout ?? "").trim();
  }
  function gitCommit(cwd, message) {
    spawnSync(
      "git",
      [
        "-c", "user.email=cf1@localhost",
        "-c", "user.name=survey-depth-cf1",
        "-c", "commit.gpgsign=false",
        "commit", "-q", "--no-verify", "-m", message,
      ],
      { cwd, encoding: "utf8" },
    );
  }

  // §5.2's four tables, as the specification declares their columns, created
  // here only when the store does not already carry them. The triggers are
  // deliberately absent: they are the implementation's to ship, and T1..T8 read
  // them. `carry_runs` is created first so the foreign key resolves.
  function ensureCarriedTables(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS carry_runs (
        id                INTEGER PRIMARY KEY,
        source_kind       TEXT    NOT NULL CHECK (source_kind IN ('store','export','none')),
        source_path       TEXT,
        archived_store_id TEXT,
        archived_anchor   TEXT,
        reason            TEXT    NOT NULL,
        expected_count    INTEGER NOT NULL,
        imported_count    INTEGER NOT NULL,
        session_id        TEXT,
        ran_at            TEXT    NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS carried_findings (
        carried_id           INTEGER PRIMARY KEY,
        archived_finding_id  TEXT    NOT NULL,
        archived_store_id    TEXT    NOT NULL,
        archived_anchor_sha  TEXT    NOT NULL,
        subsystem_id         TEXT    NOT NULL,
        severity             TEXT    NOT NULL CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
        symptom              TEXT    NOT NULL,
        root_cause           TEXT    NOT NULL,
        carry_run_id         INTEGER NOT NULL REFERENCES carry_runs(id) ON DELETE RESTRICT,
        archived_resolution  TEXT    NOT NULL,
        archived_ref_sha     TEXT,
        primary_files        TEXT,
        carried_at           TEXT    NOT NULL DEFAULT (datetime('now')),
        carried_by_session   TEXT,
        UNIQUE (archived_store_id, archived_finding_id)
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS carried_finding_outcomes (
        id            INTEGER PRIMARY KEY,
        carried_id    INTEGER NOT NULL REFERENCES carried_findings(carried_id) ON DELETE RESTRICT,
        outcome       TEXT    NOT NULL,
        successor_id  TEXT,
        repaired_sha  TEXT,
        rationale     TEXT    NOT NULL,
        session_id    TEXT    NOT NULL,
        ref_sha       TEXT    NOT NULL,
        recorded_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS carried_finding_evidence (
        carried_id    INTEGER NOT NULL REFERENCES carried_findings(carried_id) ON DELETE RESTRICT,
        evidence_id   INTEGER NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
        role          TEXT    NOT NULL DEFAULT 'supports',
        attached_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (carried_id, evidence_id)
    )`);
  }

  /**
   * A carry run and a carried record written around the tools. Used wherever
   * the assertion is about what a *later* call does with the row, so the
   * fixture does not depend on the tool that writes it.
   */
  function seedCarryRun(ctx, fields = {}) {
    ensureCarriedTables(ctx.db);
    const row = {
      source_kind: "store",
      source_path: "/cf1/fixture/archive/memory.db",
      archived_store_id: "store-legacycf1fixture",
      archived_anchor: "0".repeat(40),
      reason: "cf1 fixture carry",
      expected_count: 1,
      imported_count: 1,
      session_id: ctx.sessionId ?? "cf1",
      ...fields,
    };
    return Number(
      ctx.db
        .prepare(
          `INSERT INTO carry_runs (source_kind, source_path, archived_store_id, archived_anchor,
                                   reason, expected_count, imported_count, session_id)
           VALUES (@source_kind, @source_path, @archived_store_id, @archived_anchor,
                   @reason, @expected_count, @imported_count, @session_id)`,
        )
        .run(row).lastInsertRowid,
    );
  }
  function seedCarried(ctx, fields = {}) {
    ensureCarriedTables(ctx.db);
    const runId = fields.carry_run_id ?? seedCarryRun(ctx);
    const row = {
      archived_finding_id: "B03-5",
      archived_store_id: "store-legacycf1fixture",
      archived_anchor_sha: "0".repeat(40),
      subsystem_id: "B03",
      severity: "HIGH",
      symptom: "The reconciliation count is zero and nobody reconciled.",
      root_cause: "A count of zero and the absence of a reading are stored the same way.",
      carry_run_id: runId,
      archived_resolution: "open",
      archived_ref_sha: null,
      primary_files: null,
      carried_by_session: ctx.sessionId ?? "cf1",
      ...fields,
    };
    return Number(
      ctx.db
        .prepare(
          `INSERT INTO carried_findings (archived_finding_id, archived_store_id, archived_anchor_sha,
                                         subsystem_id, severity, symptom, root_cause, carry_run_id,
                                         archived_resolution, archived_ref_sha, primary_files,
                                         carried_by_session)
           VALUES (@archived_finding_id, @archived_store_id, @archived_anchor_sha, @subsystem_id,
                   @severity, @symptom, @root_cause, @carry_run_id, @archived_resolution,
                   @archived_ref_sha, @primary_files, @carried_by_session)`,
        )
        .run(row).lastInsertRowid,
    );
  }

  /**
   * A fresh workspace, store and open session. Every assertion that writes gets
   * its own, so a refusal in one cannot be explained by a row another left.
   */
  function world(label, files = { "src/a.ts": "export const a = 1;\n" }) {
    const ws = join(scratch, `ws-${label}`);
    mkdirSync(ws, { recursive: true });
    git(ws, "init", "-q");
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(ws, name)), { recursive: true });
      writeFileSync(join(ws, name), body);
    }
    git(ws, "add", "-A");
    gitCommit(ws, "seed");
    const project = resolveProject(ws, { selectionSource: "cf1-carried-findings" });
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
    ctx.sessionId = call("start_session", { intent: `cf1-${label}` }, ctx).session_id;
    return ctx;
  }

  const headSha = (ctx) => git(ctx.project.workspacePath, "rev-parse", "HEAD");

  /** A second commit on the current branch, so ancestry has two points. */
  function commitMore(ctx, name = `src/n${Date.now()}.ts`) {
    const ws = ctx.project.workspacePath;
    writeFileSync(join(ws, name), `export const n = ${Date.now()};\n`);
    git(ws, "add", "-A");
    gitCommit(ws, "another revision");
    return headSha(ctx);
  }

  function addEvidence(ctx, refSha, sessionId = undefined) {
    const id = call(
      "add_evidence",
      {
        file_path: "src/a.ts",
        symbol: "a",
        line_range: "1-1",
        ref_sha: refSha,
        kind: "code-verified",
      },
      sessionId === undefined ? ctx : { ...ctx, sessionId },
    ).id;
    return id;
  }

  /** A findings row, written directly: the assertion is about the outcome
   *  rule that reads it, not about the phase ladder that files it. */
  function seedFinding(ctx, findingId, sessionId = ctx.sessionId) {
    ctx.db
      .prepare(
        `INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status,
                               ref_sha, session_id, pass_type)
         VALUES (?, 'B03', 'the successor symptom', 'the successor cause', 'HIGH', 'confirmed-bug',
                 ?, ?, 'survey')`,
      )
      .run(findingId, headSha(ctx), sessionId);
    return findingId;
  }

  /** `store_identity`'s minted value, as §5.3 defines the id over it. */
  function storeIdOf(ctx) {
    try {
      const row = ctx.db
        .prepare("SELECT store_generation FROM store_identity WHERE id = 1")
        .get();
      return row?.store_generation ? `store-${String(row.store_generation).slice(0, 16)}` : null;
    } catch {
      // The table is this packet's; its absence is B1's finding, not a throw.
      return null;
    }
  }

  const UNREACHABLE_SHA = "b0a7e5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c";

  // ------------------------------------------------- T1..T8: append-only, by trigger

  {
    const ctx = world("triggers");
    const carriedId = seedCarried(ctx);
    const runId = ctx.db
      .prepare("SELECT carry_run_id AS id FROM carried_findings WHERE carried_id = ?")
      .get(carriedId).id;
    const outcomeId = Number(
      ctx.db
        .prepare(
          `INSERT INTO carried_finding_outcomes (carried_id, outcome, rationale, session_id, ref_sha)
           VALUES (?, 'ruled-out', 'cf1 fixture', ?, ?)`,
        )
        .run(carriedId, ctx.sessionId, headSha(ctx)).lastInsertRowid,
    );
    const evidenceId = addEvidence(ctx, headSha(ctx));
    ctx.db
      .prepare("INSERT INTO carried_finding_evidence (carried_id, evidence_id) VALUES (?, ?)")
      .run(carriedId, evidenceId);

    // The delete cases use rows with no children. A parent whose child rows
    // hold it in place is refused by `ON DELETE RESTRICT` whatever the trigger
    // does, and a green bought by a foreign key proves nothing about the
    // trigger the assertion names.
    const childlessRunId = seedCarryRun(ctx, { archived_store_id: "store-childlessfixt" });
    const childlessCarriedId = seedCarried(ctx, {
      archived_finding_id: "T2",
      archived_store_id: "store-childlessfixt",
      carry_run_id: childlessRunId,
    });
    const outcomeOnlyCarriedId = seedCarried(ctx, {
      archived_finding_id: "T4",
      archived_store_id: "store-childlessfixt",
      carry_run_id: childlessRunId,
    });
    const childlessOutcomeId = Number(
      ctx.db
        .prepare(
          `INSERT INTO carried_finding_outcomes (carried_id, outcome, rationale, session_id, ref_sha)
           VALUES (?, 'ruled-out', 'cf1 fixture', ?, ?)`,
        )
        .run(outcomeOnlyCarriedId, ctx.sessionId, headSha(ctx)).lastInsertRowid,
    );
    const emptyRunId = seedCarryRun(ctx, { archived_store_id: "store-emptyrunfixtur" });

    const cases = [
      ["T1", "carried_findings", "UPDATE carried_findings SET severity='LOW' WHERE carried_id=?", carriedId],
      ["T2", "carried_findings", "DELETE FROM carried_findings WHERE carried_id=?", childlessCarriedId],
      ["T3", "carried_finding_outcomes", "UPDATE carried_finding_outcomes SET outcome='repaired' WHERE id=?", outcomeId],
      ["T4", "carried_finding_outcomes", "DELETE FROM carried_finding_outcomes WHERE id=?", childlessOutcomeId],
      ["T5", "carry_runs", "UPDATE carry_runs SET imported_count=99 WHERE id=?", runId],
      ["T6", "carry_runs", "DELETE FROM carry_runs WHERE id=?", emptyRunId],
      ["T7", "carried_finding_evidence", "UPDATE carried_finding_evidence SET role='contradicts' WHERE carried_id=?", carriedId],
      ["T8", "carried_finding_evidence", "DELETE FROM carried_finding_evidence WHERE carried_id=?", carriedId],
    ];
    for (const [label, table, sql, id] of cases) {
      const verb = sql.startsWith("UPDATE") ? "updated" : "deleted";
      check(`${label} a ${table} row cannot be ${verb}`, () => {
        const said = refusal(() => ctx.db.prepare(sql).run(id));
        return said
          ? null
          : `a ${table} row was ${verb} in place; §5.2 makes the table append-only by a trigger, and a record that can be rewritten after the fact is not a record of what was carried`;
      });
    }
  }

  // ------------------------------------ A1..A6: the record lives outside `findings`

  {
    const ctx = world("namespace");
    check("A1 the four tables are declared by schema.sql, not by this fixture", () => {
      const declared = ctx.db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name IN
             ('carried_findings','carried_finding_outcomes','carried_finding_evidence','carry_runs','store_identity')`,
        )
        .all()
        .map((row) => row.name);
      const wanted = [
        "carried_findings",
        "carried_finding_outcomes",
        "carried_finding_evidence",
        "carry_runs",
        "store_identity",
      ];
      const missing = wanted.filter((name) => !declared.includes(name));
      return missing.length === 0
        ? null
        : `a freshly opened store does not carry ${missing.join(", ")}; §5.2 declares them in schema.sql with CREATE ... IF NOT EXISTS so an existing populated store gains them on its next open`;
    });

    const carriedId = seedCarried(ctx, { archived_finding_id: "B03-5" });
    check("A2 a carried id is not a findings row", () => {
      const row = ctx.db
        .prepare("SELECT finding_id FROM findings WHERE finding_id = 'B03-5'")
        .get();
      return row
        ? "carrying B03-5 wrote it into `findings`, where it can be counted as a defect this survey found and where finding_resolution_current would answer about a store that no longer exists"
        : null;
    });
    check("A3 a successor may take the archived id without colliding", () => {
      const said = refusal(() => seedFinding(ctx, "B03-5"));
      return said
        ? `filing a successor finding with the archived id was refused (${said}); the two namespaces are separate precisely so the re-find can keep the id`
        : null;
    });
    check("A4 carried_findings is unique by (archived_store_id, archived_finding_id)", () => {
      const same = refusal(() => seedCarried(ctx, { archived_finding_id: "B03-5" }));
      if (!same) {
        return "the same finding was carried twice from the same archive; a second row makes the obligation count wrong and lets one archive's decision be recorded twice";
      }
      const other = refusal(() =>
        seedCarried(ctx, { archived_finding_id: "B03-5", archived_store_id: "store-secondarchive0" }),
      );
      return other
        ? `the same id from a *different* archive was refused (${other}); §5.7 depends on two archives being able to carry the same id`
        : null;
    });
    check("A5 the carried record keeps the archived resolution state", () => {
      const row = ctx.db
        .prepare("SELECT archived_resolution FROM carried_findings WHERE carried_id = ?")
        .get(carriedId);
      return row?.archived_resolution === "open"
        ? null
        : `the carried record reports archived_resolution ${JSON.stringify(row?.archived_resolution ?? null)}; the archive's own state is what tells a re-find from a re-open`;
    });
    check("A6 carry_finding is on the tool surface", () =>
      absent("carry_finding", "§5.4's carry, and with it the retroactive path of §5.8"),
    );

    check("A7 the tool's own carry writes no findings row", () => {
      // A2 reads a record the fixture wrote; this reads one `carry_finding`
      // wrote. Without it, a carry that *also* inserted into `findings` — so
      // the carried defect were counted among the ones this survey found, and
      // collided with its own successor's id — would leave every arm green.
      const missing = absent("carry_finding", "§5.2's namespace separation");
      if (missing) return missing;
      let runId = null;
      const began = refusal(() => {
        runId = call(
          "begin_carry_run",
          {
            source_kind: "store",
            source_path: "/cf1/fixture/archive/memory.db",
            archived_store_id: "store-namespacefixt",
            archived_anchor: headSha(ctx),
            reason: "a carry through the tool",
            expected_count: 1,
            imported_count: 1,
          },
          ctx,
        ).carry_run_id;
        return null;
      });
      if (began) return `begin_carry_run refused: ${began}`;
      const before = ctx.db.prepare("SELECT COUNT(*) AS n FROM findings").get().n;
      const carried = refusal(() =>
        call(
          "carry_finding",
          {
            carry_run_id: runId,
            archived_finding_id: "B04-5",
            subsystem_id: "B04",
            severity: "HIGH",
            symptom: "the archived symptom",
            root_cause: "the archived cause",
            archived_resolution: "open",
          },
          ctx,
        ),
      );
      if (carried) return `carry_finding refused: ${carried}`;
      if (ctx.db.prepare("SELECT finding_id FROM findings WHERE finding_id = 'B04-5'").get()) {
        return "carry_finding wrote B04-5 into `findings`, where it is counted as a defect this survey found, collides with its own successor's id, and makes finding_resolution_current answer about a store that no longer exists";
      }
      const after = ctx.db.prepare("SELECT COUNT(*) AS n FROM findings").get().n;
      return after === before
        ? null
        : `carry_finding added ${after - before} findings row(s); a carried record is an obligation to decide, not a finding this store confirmed`;
    });
  }

  // ------------------------------------------------- B1..B5: store identity (§5.3)

  {
    const one = world("identity-one");
    const two = world("identity-two");
    check("B1 a store mints a 32-hex store_generation on the open that creates it", () => {
      const row = one.db.prepare("SELECT store_generation FROM store_identity").get();
      const value = row?.store_generation ?? null;
      if (typeof value !== "string" || !/^[0-9a-f]{32}$/.test(value)) {
        return `store_identity holds ${JSON.stringify(value)}; §5.3 mints a random 128-bit value rendered as 32 hex characters, once, at schema creation`;
      }
      const only = one.db.prepare("SELECT COUNT(*) AS n FROM store_identity").get().n;
      return only === 1 ? null : `store_identity holds ${only} rows; the identity is single-valued`;
    });

    check("B2 two clean-slate stores of the same repository do not share an id", () => {
      const a = storeIdOf(one);
      const b = storeIdOf(two);
      if (!a || !b) return "one of the two stores minted no identity, so the collision cannot be read";
      return a === b
        ? `both stores report ${a}; a derived id collides for two rebuilds of the same repository at the same revision, which is exactly the confusion the field exists to prevent`
        : null;
    });

    check("B3 the id does not move when git_state does", () => {
      const seeded = refusal(() =>
        call(
          "set_git_state",
          { canonical_branch: "main", onboarding_sha: headSha(one), last_checked_sha: headSha(one) },
          one,
        ),
      );
      if (seeded) return `the fixture could not record a git baseline: ${seeded}`;
      const before = storeIdOf(one);
      const later = commitMore(one);
      const said = refusal(() => call("set_git_state", { last_checked_sha: later }, one));
      if (said) return `set_git_state refused the update the assertion turns on: ${said}`;
      const after = storeIdOf(one);
      const recorded = one.db
        .prepare("SELECT last_checked_sha FROM git_state WHERE repo_id='default'")
        .get()?.last_checked_sha;
      if (recorded !== later) {
        return `the fixture's git_state still reads ${String(recorded).slice(0, 7)}, so the identity was not compared across a real change`;
      }
      return before === after
        ? null
        : `the store's id moved from ${before} to ${after} when last_checked_sha changed; set_git_state's own description says "Subsequent calls may update any subset of fields", so an id written into a successor last week could not be recomputed from the source today`;
    });

    check("B4 a frozen archive with no identity row derives the legacy id from its git_state", () => {
      const missing = absent("carry_finding", "§5.3's derivation");
      if (missing) return missing;
      // A store frozen before `store_identity` existed: the row is gone, the
      // git_state row is the only identity it has.
      const archive = join(scratch, "legacy-archive.db");
      one.db.pragma("wal_checkpoint(TRUNCATE)");
      cpSync(one.project.dbPath, archive);
      const probe = openDatabase(archive);
      // A store frozen before `store_identity` existed simply does not carry
      // the table. The row cannot be deleted — the trigger refuses, which is
      // T-arm behaviour — so the fixture removes the table the way history
      // did: by never having had it.
      probe.exec("DROP TABLE store_identity");
      probe.exec(
        `INSERT INTO git_state (repo_id, canonical_branch, last_checked_sha, onboarding_sha)
         VALUES ('default','main','61bc6b5c89f7c6b5091f9cb5df5e68cd969a3f27','b8b566f')
         ON CONFLICT(repo_id) DO UPDATE SET canonical_branch='main',
           last_checked_sha='61bc6b5c89f7c6b5091f9cb5df5e68cd969a3f27', onboarding_sha='b8b566f'`,
      );
      probe.pragma("wal_checkpoint(TRUNCATE)");
      probe.close();
      const wanted = `store-legacy-${createHash("sha256")
        .update("default|main|b8b566f|61bc6b5c89f7c6b5091f9cb5df5e68cd969a3f27")
        .digest("hex")
        .slice(0, 16)}`;
      if (typeof mods.archivedStoreId !== "function") {
        return "src/invariants.ts exports no archivedStoreId, so nothing derives §5.3's identity for a source store";
      }
      let got = null;
      const said = refusal(() => {
        got = mods.archivedStoreId(archive, { immutable: true });
        return null;
      });
      if (said) return `deriving the archive's id failed: ${said}`;
      return got === wanted
        ? null
        : `the archive's id is ${JSON.stringify(got)}, not ${wanted}; §5.3 derives it from the frozen git_state row when the store has no minted identity`;
    });

    // F3/codex. §5.3 makes the legacy derivation "available only when the
    // source is opened ?immutable=1", and C20 repeats it. `readonly: true` is
    // not that: it opens a live file, replays its WAL, and sees every later
    // write. A reviewer handed a *live* pre-identity store to the derivation,
    // changed `git_state.last_checked_sha` through the ordinary tool, and
    // watched the same store report two different identities — which is the
    // one thing §5.3 says the field must never do.
    check("B4a the legacy derivation refuses an ordinary live path and is reached only immutably", () => {
      const missing = absent("carry_finding", "§5.3's derivation");
      if (missing) return missing;
      if (typeof mods.archivedStoreId !== "function") {
        return "src/invariants.ts exports no archivedStoreId";
      }
      // A live pre-identity store: no store_identity table, and a git_state
      // row this test is about to change under the derivation.
      const live = join(scratch, "live-pre-identity.db");
      one.db.pragma("wal_checkpoint(TRUNCATE)");
      cpSync(one.project.dbPath, live);
      const probe = openDatabase(live);
      probe.exec("DROP TABLE store_identity");
      probe.exec(
        `INSERT INTO git_state (repo_id, canonical_branch, last_checked_sha, onboarding_sha)
         VALUES ('default','main','1111111111111111111111111111111111111111','b8b566f')
         ON CONFLICT(repo_id) DO UPDATE SET canonical_branch='main',
           last_checked_sha='1111111111111111111111111111111111111111', onboarding_sha='b8b566f'`,
      );
      probe.pragma("wal_checkpoint(TRUNCATE)");
      probe.close();

      let openPath = null;
      const refusedOpenPath = refusal(() => {
        openPath = mods.archivedStoreId(live);
        return null;
      });
      if (!refusedOpenPath) {
        return (
          `archivedStoreId named a live pre-identity store ${JSON.stringify(openPath)} through an ` +
          "ordinary path. §5.3 makes the legacy form available only through an immutable open, " +
          "because a live store's last_checked_sha moves and the id moves with it"
        );
      }
      if (!/immutab/i.test(refusedOpenPath)) {
        return `the refusal does not say what is missing: ${refusedOpenPath}`;
      }

      // The immutable door exists, and it is the one the carry uses.
      let immutableId = null;
      const refusedImmutable = refusal(() => {
        immutableId = mods.archivedStoreId(live, { immutable: true });
        return null;
      });
      if (refusedImmutable) {
        return `the immutable open was refused as well, so nothing can name an archive: ${refusedImmutable}`;
      }
      const wanted = `store-legacy-${createHash("sha256")
        .update("default|main|b8b566f|1111111111111111111111111111111111111111")
        .digest("hex")
        .slice(0, 16)}`;
      return immutableId === wanted
        ? null
        : `the immutable open derived ${JSON.stringify(immutableId)}, not ${wanted}`;
    });

    check("B5 a live store's id is the minted one, never the legacy derivation", () => {
      if (typeof mods.archivedStoreId !== "function") {
        return "src/invariants.ts exports no archivedStoreId";
      }
      two.db.pragma("wal_checkpoint(TRUNCATE)");
      let got = null;
      const said = refusal(() => {
        got = mods.archivedStoreId(two.project.dbPath);
        return null;
      });
      if (said) return `deriving the store's id failed: ${said}`;
      const minted = storeIdOf(two);
      return got === minted
        ? null
        : `a store that holds a minted identity reported ${JSON.stringify(got)} rather than ${minted}; the legacy derivation is the fallback for an archive, not the rule`;
    });
  }

  // ------------------------------------------ D1..D7: who may write which outcome

  {
    const ctx = world("outcomes");
    const missingTool = absent("record_carried_outcome", "§5.4's authority rules");

    const outcome = (carriedId, args) =>
      refusal(() =>
        call("record_carried_outcome", { carried_id: carriedId, ...args }, ctx),
      );
    const outcomeRows = (carriedId) =>
      ctx.db
        .prepare("SELECT * FROM carried_finding_outcomes WHERE carried_id = ? ORDER BY id")
        .all(carriedId);

    check("D1 ruled-out is refused with no evidence attached at all", () => {
      if (missingTool) return missingTool;
      const id = seedCarried(ctx, { archived_finding_id: "D1" });
      const said = outcome(id, { outcome: "ruled-out", rationale: "on reflection", ref_sha: headSha(ctx) });
      if (!said) {
        return "a carried finding was ruled out with no evidence attached; requireOverturnEvidence's rule is that overturning requires evidence, not vibes, and §5.4 applies it to the carried case";
      }
      return outcomeRows(id).length === 0 ? null : "the call was refused and the outcome row was written anyway";
    });

    check("D2 ruled-out is refused on evidence from another session", () => {
      if (missingTool) return missingTool;
      const id = seedCarried(ctx, { archived_finding_id: "D2" });
      const stale = addEvidence(ctx, headSha(ctx), "cf1-some-older-session");
      const attached = refusal(() =>
        call("attach_carried_evidence", { carried_id: id, evidence_id: stale }, ctx),
      );
      if (attached) {
        ctx.db
          .prepare("INSERT OR IGNORE INTO carried_finding_evidence (carried_id, evidence_id) VALUES (?, ?)")
          .run(id, stale);
      }
      const said = outcome(id, { outcome: "ruled-out", rationale: "older reading", ref_sha: headSha(ctx) });
      if (!said) {
        return "a carried finding was ruled out on evidence collected by an earlier session; §5.4 requires a reading taken by the pass that overturns it, not one carried over from the pass that confirmed it";
      }
      return outcomeRows(id).length === 0 ? null : "the call was refused and the outcome row was written anyway";
    });

    check("D3 repaired is refused when repaired_sha does not resolve", () => {
      if (missingTool) return missingTool;
      const id = seedCarried(ctx, { archived_finding_id: "D3" });
      const evidenceId = addEvidence(ctx, headSha(ctx));
      refusal(() => call("attach_carried_evidence", { carried_id: id, evidence_id: evidenceId }, ctx));
      const said = outcome(id, {
        outcome: "repaired",
        repaired_sha: UNREACHABLE_SHA,
        rationale: "fixed somewhere",
        ref_sha: headSha(ctx),
      });
      if (!said) {
        return `a repair was recorded at ${UNREACHABLE_SHA.slice(0, 7)}, which resolves in no repository on this machine; a commit nobody can open discharges nothing`;
      }
      return outcomeRows(id).length === 0 ? null : "the call was refused and the outcome row was written anyway";
    });

    check("D4 repaired is refused when the reading is not a descendant of the repair", () => {
      if (missingTool) return missingTool;
      // A sibling branch that never contained the repair: "at or after" has no
      // meaning on a DAG until it is said which relation is meant, and §5.4
      // says ancestry.
      const base = headSha(ctx);
      const ws = ctx.project.workspacePath;
      git(ws, "checkout", "-q", "-b", "cf1-repair");
      const repairSha = commitMore(ctx, "src/repair.ts");
      git(ws, "checkout", "-q", "-");
      git(ws, "checkout", "-q", "-b", "cf1-sibling", base);
      const siblingSha = commitMore(ctx, "src/sibling.ts");
      const id = seedCarried(ctx, { archived_finding_id: "D4" });
      const evidenceId = addEvidence(ctx, siblingSha);
      refusal(() => call("attach_carried_evidence", { carried_id: id, evidence_id: evidenceId }, ctx));
      const said = outcome(id, {
        outcome: "repaired",
        repaired_sha: repairSha,
        rationale: "read on a branch that never had the repair",
        ref_sha: siblingSha,
      });
      const cleanup = () => git(ws, "checkout", "-q", "cf1-repair");
      if (!said) {
        cleanup();
        return `a repair at ${repairSha.slice(0, 7)} was discharged by a reading at ${siblingSha.slice(0, 7)}, which is not a descendant of it — git merge-base --is-ancestor is the test §5.4 names`;
      }
      const rows = outcomeRows(id).length;
      cleanup();
      return rows === 0 ? null : "the call was refused and the outcome row was written anyway";
    });

    check("D5 archived-terminal is refused: only the carry writes it", () => {
      if (missingTool) return missingTool;
      const id = seedCarried(ctx, { archived_finding_id: "D5", archived_resolution: "verified-fixed" });
      const said = outcome(id, {
        outcome: "archived-terminal",
        rationale: "the archive had closed it",
        ref_sha: headSha(ctx),
      });
      if (!said) {
        return "record_carried_outcome wrote archived-terminal; §5.4 reserves it for the carry, because a state the archive reached asserts nothing about this store and nobody here checked a commit or read a repaired path";
      }
      return /carry/i.test(said)
        ? null
        : `it refused without naming the carry as the only writer: ${said}`;
    });

    check("D6 successor-finding is refused when the successor names no findings row", () => {
      if (missingTool) return missingTool;
      const id = seedCarried(ctx, { archived_finding_id: "D6" });
      const said = outcome(id, {
        outcome: "successor-finding",
        successor_id: "B99-404",
        rationale: "re-found, allegedly",
        ref_sha: headSha(ctx),
      });
      if (!said) {
        return "a carried finding was discharged into a successor that does not exist; the successor *is* the re-find, and a reference to nothing re-finds nothing";
      }
      return outcomeRows(id).length === 0 ? null : "the call was refused and the outcome row was written anyway";
    });

    check("D9 successor-finding is refused when an earlier session filed the successor", () => {
      if (missingTool) return missingTool;
      // §5.4's rule is "an existing findings row in this store, **filed in the
      // current session**". The successor *is* this pass's re-find; pointing at
      // a finding an earlier pass filed records an association, not a re-find,
      // and would let a carried obligation be discharged by a row that was
      // already there when the carry ran.
      const id = seedCarried(ctx, { archived_finding_id: "D9" });
      seedFinding(ctx, "B03-D9", "cf1-some-older-session");
      const said = outcome(id, {
        outcome: "successor-finding",
        successor_id: "B03-D9",
        rationale: "a finding that was already here",
        ref_sha: headSha(ctx),
      });
      if (!said) {
        return "a carried finding was discharged into a successor an earlier session had filed; the successor is the re-find this pass made, and a row that predates the carry re-finds nothing";
      }
      return outcomeRows(id).length === 0
        ? null
        : "the call was refused and the outcome row was written anyway";
    });

    check("D7 a carried record reaches exactly one outcome", () => {
      if (missingTool) return missingTool;
      const id = seedCarried(ctx, { archived_finding_id: "D7" });
      const successor = seedFinding(ctx, "B03-D7");
      const first = outcome(id, {
        outcome: "successor-finding",
        successor_id: successor,
        rationale: "the re-find",
        ref_sha: headSha(ctx),
      });
      if (first) return `the control call was refused: ${first}`;
      const second = outcome(id, {
        outcome: "ruled-out",
        rationale: "second thoughts",
        ref_sha: headSha(ctx),
      });
      if (!second) {
        return "a second outcome was accepted for one carried record; §5.4 corrects a mistaken outcome by a new carried record from the same archive, which is visible, not by overwriting the decision";
      }
      const rows = outcomeRows(id);
      return rows.length === 1
        ? null
        : `${rows.length} outcome rows stand for one carried record (${rows.map((r) => r.outcome).join(", ")})`;
    });

    check("D8 a second outcome written around the tool is refused by the index", () => {
      // D7 reads the tool's refusal; this reads the substrate's. Either guard
      // alone keeps D7 green, so without this arm a reviewer could drop
      // `idx_carried_outcome_one` and leave the table able to hold two
      // decisions for one record — for the carry, or for any later writer that
      // does not go through `record_carried_outcome`.
      const id = seedCarried(ctx, { archived_finding_id: "D8" });
      const insert = (outcome) =>
        refusal(() =>
          ctx.db
            .prepare(
              `INSERT INTO carried_finding_outcomes (carried_id, outcome, rationale, session_id, ref_sha)
               VALUES (?, ?, 'cf1 fixture', ?, ?)`,
            )
            .run(id, outcome, ctx.sessionId, headSha(ctx)),
        );
      const first = insert("ruled-out");
      if (first) return `the first outcome row was refused: ${first}`;
      const second = insert("repaired");
      if (!second) {
        return "the table accepted two outcome rows for one carried record; idx_carried_outcome_one is what makes 'exactly one' a fact about the store rather than a promise one tool keeps";
      }
      const rows = outcomeRows(id);
      return rows.length === 1
        ? null
        : `${rows.length} outcome rows stand for one carried record (${rows.map((r) => r.outcome).join(", ")})`;
    });

    // ------------------------------------------------- G4: each rule's control

    check("G4a ruled-out is accepted on evidence collected in this session", () => {
      if (missingTool) return missingTool;
      const id = seedCarried(ctx, { archived_finding_id: "G4a" });
      const evidenceId = addEvidence(ctx, headSha(ctx));
      const attached = refusal(() =>
        call("attach_carried_evidence", { carried_id: id, evidence_id: evidenceId }, ctx),
      );
      if (attached) return `attach_carried_evidence refused a live evidence row: ${attached}`;
      const said = outcome(id, {
        outcome: "ruled-out",
        rationale: "the reading does not show the defect",
        ref_sha: headSha(ctx),
      });
      if (said) return `the rule refused the call that satisfies it: ${said}`;
      return outcomeRows(id).length === 1 ? null : "the accepted call wrote no outcome row";
    });

    check("G4b repaired is accepted on a reading at or after the repair", () => {
      if (missingTool) return missingTool;
      const ws = ctx.project.workspacePath;
      git(ws, "checkout", "-q", "cf1-repair");
      const repairSha = headSha(ctx);
      const laterSha = commitMore(ctx, "src/after-repair.ts");
      const atRepair = seedCarried(ctx, { archived_finding_id: "G4b-at" });
      const afterRepair = seedCarried(ctx, { archived_finding_id: "G4b-after" });
      const said = [];
      for (const [id, evidenceSha, which] of [
        [atRepair, repairSha, "at the repair itself"],
        [afterRepair, laterSha, "at a descendant of the repair"],
      ]) {
        const evidenceId = addEvidence(ctx, evidenceSha);
        refusal(() => call("attach_carried_evidence", { carried_id: id, evidence_id: evidenceId }, ctx));
        const refused = outcome(id, {
          outcome: "repaired",
          repaired_sha: repairSha,
          rationale: `read ${which}`,
          ref_sha: evidenceSha,
        });
        if (refused) said.push(`${which}: ${refused}`);
      }
      return said.length === 0
        ? null
        : `a reading equal to or descended from the repair was refused — ${said.join("; ")}`;
    });

    check("G4c successor-finding is accepted when the successor exists here", () => {
      if (missingTool) return missingTool;
      const id = seedCarried(ctx, { archived_finding_id: "G4c" });
      const successor = seedFinding(ctx, "B03-G4c");
      const said = outcome(id, {
        outcome: "successor-finding",
        successor_id: successor,
        rationale: "the same defect, re-found here",
        ref_sha: headSha(ctx),
      });
      return said ? `the rule refused the call that satisfies it: ${said}` : null;
    });
  }

  // ------------------------------- E1..E3 + G1..G3: clause 7 of *fully surveyed*

  const CHECKER_REL = "dev/check-store-fully-surveyed.mjs";
  function runChecker(ctx, extra = []) {
    ctx.db.pragma("wal_checkpoint(TRUNCATE)");
    if (!existsSync(join(REPO, CHECKER_REL))) {
      return { absent: true };
    }
    const run = spawnSync(
      process.execPath,
      [join(REPO, CHECKER_REL), "--store", ctx.project.dbPath, "--json", ...extra],
      { cwd: REPO, encoding: "utf8", timeout: 120_000 },
    );
    let report = null;
    try {
      report = JSON.parse(run.stdout ?? "null");
    } catch {
      report = null;
    }
    return {
      status: run.status,
      report,
      stdout: scrub(run.stdout ?? ""),
      stderr: scrub((run.stderr ?? "").slice(-400)),
    };
  }
  /** Clause 7's verdict and the obligations it emitted, from the report. */
  function clauseSeven(result) {
    const clause = (result.report?.clauses ?? []).find((entry) => Number(entry.clause) === 7);
    return clause ?? null;
  }

  {
    const undecided = world("clause7-undecided");
    // A *nonempty* undecided set, so the clause cannot pass by having nothing
    // to check (spec.md §8.4).
    const storeA = "store-firstarchive000";
    seedCarried(undecided, { archived_finding_id: "B03-6", archived_store_id: storeA });
    seedCarried(undecided, { archived_finding_id: "B04-5", archived_store_id: storeA });
    const decided = seedCarried(undecided, { archived_finding_id: "B03-5", archived_store_id: storeA });
    undecided.db
      .prepare(
        `INSERT INTO carried_finding_outcomes (carried_id, outcome, rationale, session_id, ref_sha)
         VALUES (?, 'ruled-out', 'decided', ?, ?)`,
      )
      .run(decided, undecided.sessionId, headSha(undecided));

    const result = runChecker(undecided);
    check("E1 the store-scoped predicate refuses a store with an undecided carried finding", () => {
      if (result.absent) {
        return `${CHECKER_REL} is absent, so a carried finding has no terminal outcome and no predicate says so; §5.5 makes it this packet's deliverable because dev/check-living-conspectus.mjs evaluates a supplied manifest and never an open store`;
      }
      if (result.report === null) {
        return `${CHECKER_REL} printed no parseable report (exit ${result.status}): ${result.stderr || result.stdout.slice(0, 200)}`;
      }
      if (result.report.fully_surveyed === true) {
        return "the predicate reported fully surveyed over a store holding two undecided carried findings; a store that discarded a prior conspectus is not fully surveyed until it has decided what became of every open defect that conspectus held";
      }
      const clause = clauseSeven(result);
      if (!clause) return "the report carries no clause 7";
      if (clause.satisfied !== false) {
        return `clause 7 reports satisfied=${JSON.stringify(clause.satisfied)} over a nonempty undecided set`;
      }
      const wanted = [`carried:${storeA}:B03-6`, `carried:${storeA}:B04-5`];
      const got = clause.missing ?? [];
      const absentIds = wanted.filter((id) => !got.includes(id));
      if (absentIds.length) {
        return `clause 7 did not emit ${absentIds.join(", ")}; the obligation id shape is carried:<archived_store_id>:<archived_finding_id> so every red has a destination`;
      }
      if (got.includes(`carried:${storeA}:B03-5`)) {
        return "clause 7 emitted an obligation for a carried record that already has a terminal outcome";
      }
      return result.status === 0
        ? `${CHECKER_REL} exited 0 while reporting an unmet clause; a predicate that reports red and exits green halts nothing`
        : null;
    });

    check("E3 the refusal names the records it is about", () => {
      // §5.5 quotes the sentence, and a sentence that says "2 carried findings
      // have no terminal outcome — ." has told the reader the count and
      // withheld everything they would need to act on it.
      if (!existsSync(join(REPO, CHECKER_REL))) return `${CHECKER_REL} is absent`;
      undecided.db.pragma("wal_checkpoint(TRUNCATE)");
      const run = spawnSync(
        process.execPath,
        [join(REPO, CHECKER_REL), "--store", undecided.project.dbPath, "--clause", "7"],
        { cwd: REPO, encoding: "utf8", timeout: 120_000 },
      );
      const said = scrub(run.stdout ?? "");
      const absentIds = ["B03-6", "B04-5"].filter((id) => !said.includes(id));
      if (absentIds.length) {
        return `the refusal does not name ${absentIds.join(", ")}: ${said.slice(-240) || "(silent)"}`;
      }
      if (!said.includes("HIGH") || !said.includes(storeA)) {
        return "the refusal names neither the severity nor the store each record came from, which is what tells a reader which obligation to take first";
      }
      return /re-found as a successor finding, ruled out with evidence .*, or marked repaired/.test(said)
        ? null
        : "the refusal does not say what would discharge the obligation; a red with no destination is the state ADR-0001's obligation table exists to remove";
    });

    // F5/codex. Clause 1 re-derived the ledger-against-tree comparison itself
    // and never read the reconciliation it was standing on, so a store whose
    // standing reconciliation had gone stale under it — §3.3's conditions 4 and
    // 5, the ones that make the reading *stand* — reported satisfied anyway.
    // C13 and §3.3a bind the whole-store predicate to the same five conditions
    // materialize_docs is bound to, plus zero `unledgered` and zero `absent`.
    check("E4 clause 1 stands on a standing reconciliation, not on any row at the revision", () => {
      if (!existsSync(join(REPO, CHECKER_REL))) return `${CHECKER_REL} is absent`;
      const clauseOne = (ctx) => {
        const result = runChecker(ctx);
        if (result.report === null) {
          return { error: `${CHECKER_REL} printed no parseable report (exit ${result.status})` };
        }
        const one = (result.report.clauses ?? []).find((entry) => Number(entry.clause) === 1);
        return one ? { one } : { error: "the report carries no clause 1" };
      };

      // Control first: a store whose reconciliation was written by the real
      // detect_changes over a ledger that covers the tree. Clause 1 holds here
      // before and after the sharpening, so the assertion cannot pass by
      // refusing everything.
      const good = world("clause1-standing");
      good.db
        .prepare("INSERT INTO subsystems (id, name, status) VALUES ('B03','B03 fixture','scoping')")
        .run();
      good.db
        .prepare(
          "INSERT INTO file_ledger (subsystem_id, file_path, classification) VALUES ('B03','src/a.ts','examined')",
        )
        .run();
      call("set_git_state", { canonical_branch: "main", onboarding_sha: headSha(good) }, good);
      call("detect_changes", { current_sha: headSha(good) }, good);
      const control = clauseOne(good);
      if (control.error) return control.error;
      if (control.one.satisfied !== true) {
        return `clause 1 refused a store reconciled at its own checked revision with every tracked path ledgered: ${JSON.stringify(control.one.note ?? control.one.missing)}`;
      }

      // The subject: the same shape, except that the only reconciliation at the
      // revision was taken over a different tree and a different ledger. §3.3
      // conditions 4 and 5 fail, so nothing stands and there is no denominator.
      const stale = world("clause1-stale");
      stale.db
        .prepare("INSERT INTO subsystems (id, name, status) VALUES ('B03','B03 fixture','scoping')")
        .run();
      stale.db
        .prepare(
          "INSERT INTO file_ledger (subsystem_id, file_path, classification) VALUES ('B03','src/a.ts','examined')",
        )
        .run();
      const head = headSha(stale);
      call("set_git_state", { last_checked_sha: head }, stale);
      stale.db
        .prepare(
          `INSERT INTO scope_reconciliations
             (detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows,
              unledgered, absent, exempt, session_id)
           VALUES (?, 'bad-tree', 'bad-ledger', 1, 1, 0, 0, 0, ?)`,
        )
        .run(head, stale.sessionId);
      const subject = clauseOne(stale);
      if (subject.error) return subject.error;
      if (subject.one.satisfied !== false) {
        return (
          "clause 1 reported satisfied over a store whose only reconciliation at the revision " +
          "records tree_digest 'bad-tree' and ledger_digest 'bad-ledger'. §3.3's conditions 4 " +
          "and 5 are what make the reading stand: a store edited since it last checked itself " +
          "against the tree has not checked itself against the tree, and a coverage fraction " +
          "stamped with R may only be taken over R's own tree"
        );
      }
      return null;
    });

    // F6/codex. Clause 3 counted attachments and stopped there, so a
    // disposition attached to evidence at a revision that does not exist was
    // "evidence-backed". §7.3's B3 states the same predicate the other way:
    // "at least one attached evidence row whose ref_sha resolves".
    check("E5 clause 3 requires an attachment whose revision resolves in the workspace", () => {
      if (!existsSync(join(REPO, CHECKER_REL))) return `${CHECKER_REL} is absent`;
      const ctx = world("clause3-unresolvable");
      const head = headSha(ctx);
      ctx.db
        .prepare("INSERT INTO subsystems (id, name, status) VALUES ('B03','B03 fixture','concerns')")
        .run();
      ctx.db
        .prepare("INSERT INTO concerns (code, origin, status) VALUES ('CF1-C','seeded','active')")
        .run();
      ctx.db
        .prepare(
          "INSERT INTO dispositions (subsystem_id, concern_code, classification) VALUES ('B03','CF1-C','ruled-out')",
        )
        .run();
      // A revision-shaped sha that no object in this workspace answers to.
      const gone = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
      const unreachable = ctx.db
        .prepare(
          "INSERT INTO evidence (file_path, symbol, line_range, ref_sha, kind) VALUES ('src/a.ts','a','1-1',?, 'code-verified')",
        )
        .run(gone).lastInsertRowid;
      ctx.db
        .prepare(
          "INSERT INTO disposition_evidence (subsystem_id, concern_code, evidence_id, role) VALUES ('B03','CF1-C',?,'supports')",
        )
        .run(unreachable);

      const readClause = () => {
        const result = runChecker(ctx);
        if (result.report === null) return { error: `${CHECKER_REL} printed no parseable report (exit ${result.status})` };
        const three = (result.report.clauses ?? []).find((entry) => Number(entry.clause) === 3);
        return three ? { three } : { error: "the report carries no clause 3" };
      };
      const before = readClause();
      if (before.error) return before.error;
      if (before.three.satisfied !== false) {
        return (
          "clause 3 reported satisfied over a disposition whose only attachment names " +
          `${gone.slice(0, 8)}…, which git cat-file -e refuses. An attachment count is not ` +
          "evidence: §2.3 already refuses the advance for a disposition whose attached ref_sha " +
          "does not resolve, and §7.3's B3 re-asserts it over the finished store"
        );
      }
      if (!(before.three.missing ?? []).some((id) => String(id).includes("B03/CF1-C"))) {
        return `clause 3 did not name the disposition: ${JSON.stringify(before.three.missing ?? [])}`;
      }

      // Control: the same disposition, one attachment that resolves. Clause 3
      // holds, so the sharpening refuses unreachable evidence and nothing else.
      const reachable = ctx.db
        .prepare(
          "INSERT INTO evidence (file_path, symbol, line_range, ref_sha, kind) VALUES ('src/a.ts','a','1-1',?, 'code-verified')",
        )
        .run(head).lastInsertRowid;
      ctx.db
        .prepare(
          "INSERT INTO disposition_evidence (subsystem_id, concern_code, evidence_id, role) VALUES ('B03','CF1-C',?,'supports')",
        )
        .run(reachable);
      const after = readClause();
      if (after.error) return after.error;
      return after.three.satisfied === true
        ? null
        : `clause 3 still refuses the disposition after a resolvable attachment was added: ${JSON.stringify(after.three.missing ?? [])}`;
    });

    check("G3 clause 7 does not bind at `mapped`", () => {
      // README §4 and decisions.md §1: a rebuild must be able to progress
      // subsystem by subsystem, so the carried obligation is a whole-store
      // predicate and not a per-subsystem one.
      const ctx = undecided;
      const said = refusal(() =>
        ctx.db
          .prepare("INSERT INTO subsystems (id, name, status) VALUES ('B03','B03 fixture','adversarial')")
          .run(),
      );
      if (said) return `the fixture could not seed a subsystem: ${said}`;
      const refused = refusal(() =>
        call("update_subsystem_status", { id: "B03", status: "mapped" }, ctx),
      );
      if (refused && /carried/i.test(refused)) {
        return `the advance to mapped was refused for a carried obligation (${refused}); §5.5 enforces clause 7 at the whole-store predicate so a rebuild can progress subsystem by subsystem`;
      }
      return null;
    });
  }

  {
    const settled = world("clause7-settled");
    const storeB = "store-secondarchive0";
    const ids = ["B03-7", "B03-8"].map((archivedId) =>
      seedCarried(settled, { archived_finding_id: archivedId, archived_store_id: storeB }),
    );
    for (const id of ids) {
      settled.db
        .prepare(
          `INSERT INTO carried_finding_outcomes (carried_id, outcome, rationale, session_id, ref_sha)
           VALUES (?, 'ruled-out', 'decided with evidence', ?, ?)`,
        )
        .run(id, settled.sessionId, headSha(settled));
    }
    const result = runChecker(settled);
    check("G1 a store whose carried records all have terminal outcomes passes clause 7", () => {
      if (result.absent) return `${CHECKER_REL} is absent`;
      if (result.report === null) {
        return `${CHECKER_REL} printed no parseable report (exit ${result.status}): ${result.stderr || result.stdout.slice(0, 200)}`;
      }
      const clause = clauseSeven(result);
      if (!clause) return "the report carries no clause 7";
      if (clause.satisfied !== true) {
        return `clause 7 reports satisfied=${JSON.stringify(clause.satisfied)} over a store whose two carried records both carry a terminal outcome: ${JSON.stringify(clause.missing ?? null)}`;
      }
      return (clause.considered ?? 0) === 2
        ? null
        : `clause 7 considered ${clause.considered ?? 0} carried record(s), not the 2 the store holds; a control over an empty set is a zero-denominator green`;
    });
  }

  {
    const archivedOnly = world("clause7-archived-terminal");
    const storeC = "store-thirdarchive00";
    const id = seedCarried(archivedOnly, {
      archived_finding_id: "B07-1",
      archived_store_id: storeC,
      archived_resolution: "verified-fixed",
    });
    archivedOnly.db
      .prepare(
        `INSERT INTO carried_finding_outcomes (carried_id, outcome, rationale, session_id, ref_sha)
         VALUES (?, 'archived-terminal', 'the archive recorded it verified-fixed', ?, ?)`,
      )
      .run(id, archivedOnly.sessionId, headSha(archivedOnly));
    const result = runChecker(archivedOnly);
    check("G2 archived-terminal is terminal for clause 7", () => {
      if (result.absent) return `${CHECKER_REL} is absent`;
      if (result.report === null) {
        return `${CHECKER_REL} printed no parseable report (exit ${result.status}): ${result.stderr || result.stdout.slice(0, 200)}`;
      }
      const clause = clauseSeven(result);
      if (!clause) return "the report carries no clause 7";
      return clause.satisfied === true && (clause.considered ?? 0) === 1
        ? null
        : `clause 7 reports satisfied=${JSON.stringify(clause.satisfied)} over ${clause.considered ?? 0} record(s) whose only outcome is archived-terminal; the carry's pre-record is terminal for the predicate and for §5.7's resolver`;
    });
  }

  check("E2 dev/check-living-conspectus.mjs still reads the frozen A0 fixture", () => {
    const path = join(REPO, "dev", "check-living-conspectus.mjs");
    if (!existsSync(path)) return "dev/check-living-conspectus.mjs is absent";
    const text = readFileSync(path, "utf8");
    if (!text.includes("dev/conspectus/self-baseline.json")) {
      return "it no longer resolves dev/conspectus/self-baseline.json; design/reader-lenses/spec.md §12.3 forbids retargeting the A0 fixture, and §5.5 adds a *new* store-scoped checker instead of moving this one";
    }
    return /--store\b/.test(text)
      ? "it grew a --store argument; the store-scoped predicate is a separate deliverable so the historical fixture keeps answering about b8b566f"
      : null;
  });

  // ---------------------------------- C1..C9: the carry, driven by the rebuild

  const DRIVER_REL = "dev/rebuild-self-conspectus-store.mjs";
  function throwawayWorkspace(label) {
    const root = join(scratch, `driver-${label}`);
    const workspace = join(root, "workspace");
    mkdirSync(workspace, { recursive: true });
    for (const args of [
      ["init", "-q", workspace],
      ["-C", workspace, "config", "user.email", "cf1@localhost"],
      ["-C", workspace, "config", "user.name", "survey-depth-cf1"],
    ]) {
      spawnSync("git", args, { encoding: "utf8" });
    }
    writeFileSync(join(workspace, "README.md"), `throwaway workspace for CF1 (${label})\n`);
    spawnSync("git", ["-C", workspace, "add", "-A"], { encoding: "utf8" });
    gitCommit(workspace, "seed");
    // Seed the store the run would discard, so "it refused before the discard"
    // is a statement about a store that existed to be lost. Without it a
    // refusal raised *after* the deletion would look the same as one raised
    // before, because there would be nothing there either way.
    const project = resolveProject(workspace, { selectionSource: "cf1-carried-findings" });
    ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
    return { root, workspace };
  }
  function runDriver(label, args, timeout = 600_000) {
    const { root, workspace } = throwawayWorkspace(label);
    const run = spawnSync(
      process.execPath,
      [
        join(REPO, DRIVER_REL),
        "--confirm",
        "--workspace",
        workspace,
        "--archive",
        join(root, "archive"),
        "--receipt",
        join(root, "receipt.json"),
        ...args,
      ],
      { cwd: REPO, encoding: "utf8", timeout },
    );
    return {
      status: run.status,
      said: scrub(`${run.stdout ?? ""} ${run.stderr ?? ""}`),
      workspace,
      dbPath: join(workspace, ".amanuensis", "memory.db"),
      receiptPath: join(root, "receipt.json"),
      // A refusal that arrives after the discard has already cost the
      // conspectus. `discarded` is the driver's own step line, so a refusal
      // raised downstream of it is visible here.
      discarded: /\bdiscarded\b/.test(String(run.stdout ?? "")),
      storeSurvives: existsSync(join(workspace, ".amanuensis", "memory.db")),
    };
  }
  /** Null when the run refused before touching the store; the sentence otherwise. */
  function refusedBeforeDiscard(run, what) {
    if (run.discarded) {
      return `the driver refused ${what} only after it had discarded the store; a carry source that cannot be read is a refusal that costs nothing before the snapshot and costs the conspectus after it`;
    }
    return run.storeSurvives
      ? null
      : `the driver refused ${what} but the store it would have discarded is gone`;
  }
  /** Rows the driver left behind, read through a fresh handle. */
  function readStore(dbPath, query, params = []) {
    if (!existsSync(dbPath)) return null;
    let db = null;
    try {
      db = openDatabase(dbPath);
      return db.prepare(query).all(...params);
    } catch {
      return null;
    } finally {
      try {
        db?.close();
      } catch {
        /* the read already happened or already failed */
      }
    }
  }

  const driverPresent = existsSync(join(REPO, DRIVER_REL));
  const serverBuilt = existsSync(join(here, "dist", "index.js"));

  check("C1 the rebuild refuses to reinitialize without --carry-from", () => {
    if (!driverPresent) return `${DRIVER_REL} is absent`;
    if (!serverBuilt) return "the built server is absent; run npm run build in mcp-server/";
    const run = runDriver("no-carry", [], 180_000);
    if (run.status === 0) {
      return "the driver discarded a conspectus without being told what to carry out of it; §5.4 makes --carry-from required because six baseline open findings were lost exactly this way";
    }
    if (!/--carry-from/.test(run.said)) {
      return `it exited ${run.status} for some other reason: ${run.said.slice(-220)}`;
    }
    return refusedBeforeDiscard(run, "a missing --carry-from");
  });

  check("C2 --carry-from none is refused without --carry-reason", () => {
    if (!driverPresent) return `${DRIVER_REL} is absent`;
    if (!serverBuilt) return "the built server is absent";
    const run = runDriver("none-unreasoned", ["--carry-from", "none"], 180_000);
    if (run.status === 0) {
      return "an empty carry was accepted with no reason; 'nothing to carry' is a judgment somebody makes, and an unreasoned empty carry is indistinguishable from a forgotten one";
    }
    if (!/--carry-reason/.test(run.said)) {
      return `it exited ${run.status} for some other reason: ${run.said.slice(-220)}`;
    }
    return refusedBeforeDiscard(run, "an unreasoned empty carry");
  });

  check("C4 an export with no archived_store_id is refused as a carry source", () => {
    if (!driverPresent) return `${DRIVER_REL} is absent`;
    if (!serverBuilt) return "the built server is absent";
    const exportPath = join(scratch, "export-no-identity.json");
    writeFileSync(
      exportPath,
      `${JSON.stringify(
        {
          anchor: "7c1c1a9f5689d396487072d012abe6fafd5f348c",
          exported_at: "2026-09-13T00:00:00Z",
          source: "cf1 fixture",
          subsystems: [],
          open_questions: [],
          counts: { findings: 1 },
          findings: [
            {
              finding_id: "B03-5",
              subsystem_id: "B03",
              severity: "HIGH",
              status: "confirmed-bug",
              resolution_state: "open",
              symptom: "a symptom",
              root_cause: "a cause",
              primary_files: [],
              ref_sha: "7c1c1a9f5689d396487072d012abe6fafd5f348c",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const run = runDriver(
      "export-no-identity",
      ["--carry-from", exportPath, "--carry-reason", "the export is the only record"],
      180_000,
    );
    if (run.status === 0) {
      return "an export carrying no archived_store_id was accepted as a carry source; without it the carry cannot name the store the records came from, which is the one thing §5.3 exists to record";
    }
    if (!/archived_store_id/.test(run.said)) {
      return `it exited ${run.status} without naming the missing field: ${run.said.slice(-220)}`;
    }
    return refusedBeforeDiscard(run, "an export with no archived_store_id");
  });

  check("G5 an export that carries archived_store_id is accepted as a carry source", () => {
    // The refusal C4 reads is about the missing field, not about exports:
    // §5.4 accepts either an archived store or an export carrying the field,
    // and a gate that only ever refuses exports would let the second half of
    // that sentence rot.
    if (!driverPresent) return `${DRIVER_REL} is absent`;
    if (!serverBuilt) return "the built server is absent";
    const storeId = "store-legacyexportfx";
    const exportPath = join(scratch, "export-with-identity.json");
    writeFileSync(
      exportPath,
      `${JSON.stringify(
        {
          anchor: "7c1c1a9f5689d396487072d012abe6fafd5f348c",
          archived_store_id: storeId,
          exported_at: "2026-09-13T00:00:00Z",
          source: "cf1 fixture",
          subsystems: [],
          open_questions: [],
          counts: { findings: 2 },
          findings: [
            {
              finding_id: "EXP-1",
              subsystem_id: "B03",
              severity: "HIGH",
              status: "confirmed-bug",
              resolution_state: "open",
              symptom: "an open defect the export carries",
              root_cause: "the cause the export carries",
              primary_files: [],
              ref_sha: "7c1c1a9f5689d396487072d012abe6fafd5f348c",
            },
            {
              finding_id: "EXP-2",
              subsystem_id: "B03",
              severity: "LOW",
              status: "ruled-out",
              resolution_state: "ruled-out",
              symptom: "a defect the archive had already overturned",
              root_cause: "the cause the export carries",
              primary_files: [],
              ref_sha: "7c1c1a9f5689d396487072d012abe6fafd5f348c",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const run = runDriver("export-with-identity", [
      "--carry-from",
      exportPath,
      "--carry-reason",
      "the archived store is not on this machine; the export is what survives",
    ]);
    if (run.status !== 0) {
      return `an export carrying archived_store_id was refused (exit ${run.status}): ${run.said.slice(-260)}`;
    }
    const runs = readStore(run.dbPath, "SELECT * FROM carry_runs ORDER BY id");
    if (!runs || runs.length !== 1) return `the rebuilt store holds ${runs?.length ?? "no readable"} carry_runs row(s)`;
    if (runs[0].source_kind !== "export" || runs[0].archived_store_id !== storeId) {
      return `the carry recorded source_kind ${JSON.stringify(runs[0].source_kind)} and archived_store_id ${JSON.stringify(runs[0].archived_store_id)}`;
    }
    const rows = readStore(
      run.dbPath,
      `SELECT cf.archived_finding_id AS id, o.outcome AS outcome
         FROM carried_findings cf
         LEFT JOIN carried_finding_outcomes o ON o.carried_id = cf.carried_id
        ORDER BY cf.archived_finding_id`,
    );
    if (!rows || rows.length !== 2) return `the carry wrote ${rows?.length ?? "no readable"} record(s) for 2 exported findings`;
    const byId = new Map(rows.map((row) => [row.id, row.outcome]));
    if (byId.get("EXP-2") !== "archived-terminal") {
      return `the export's ruled-out finding was carried with outcome ${JSON.stringify(byId.get("EXP-2") ?? null)}`;
    }
    return byId.get("EXP-1") === null || byId.get("EXP-1") === undefined
      ? null
      : `the export's open finding was pre-recorded ${JSON.stringify(byId.get("EXP-1"))}`;
  });

  // The archive the remaining C-arms carry from: a real store, frozen, holding
  // one open finding and one the archive had already closed.
  let archiveSummary = { built: false };
  {
    const source = world("archive-source");
    source.db
      .prepare(
        `INSERT INTO git_state (repo_id, canonical_branch, last_checked_sha, onboarding_sha)
         VALUES ('default','main',?,?)
         ON CONFLICT(repo_id) DO UPDATE SET last_checked_sha=excluded.last_checked_sha`,
      )
      .run(headSha(source), headSha(source));
    seedFinding(source, "B03-6");
    seedFinding(source, "B03-7");
    seedFinding(source, "B03-9");
    // B03-7 the archive closed; B03-9 it claimed to have fixed without proving
    // it, which ADR-0001 calls `fixed-pending-verification` and which is not a
    // closure. The carry must tell them apart: only the first is terminal.
    source.db
      .prepare("UPDATE findings SET status='confirmed-acceptable' WHERE finding_id='B03-7'")
      .run();
    source.db.prepare("UPDATE findings SET status='fixed' WHERE finding_id='B03-9'").run();
    source.db.pragma("wal_checkpoint(TRUNCATE)");
    const archivePath = join(scratch, "archive-store.db");
    cpSync(source.project.dbPath, archivePath);
    archiveSummary = {
      built: true,
      path: archivePath,
      expected: 3,
      identity: storeIdOf(source),
      anchor: headSha(source),
    };
  }

  const carriedRun = (() => {
    if (!driverPresent || !serverBuilt || !archiveSummary.built) return null;
    return runDriver("carry-from-store", [
      "--carry-from",
      archiveSummary.path,
      "--carry-reason",
      "the archive is the measured baseline",
    ]);
  })();

  check("C10 an export whose archived_store_id disagrees with its store is refused", () => {
    // §5.3: where the store itself is available the carry verifies the two
    // agree. An export that names the wrong archive produces a carry that is
    // internally consistent and wrong, and archived_store_id is the only field
    // that separates the two stores — so a gate that only ever read the
    // export's own claim would be trusting exactly the field under test.
    if (!driverPresent) return `${DRIVER_REL} is absent`;
    if (!serverBuilt) return "the built server is absent";
    if (!archiveSummary.built) return "the archive fixture was not built";
    const exportPath = join(scratch, "export-wrong-archive.json");
    writeFileSync(
      exportPath,
      `${JSON.stringify(
        {
          anchor: archiveSummary.anchor,
          archived_store_id: "store-someotherarchi",
          exported_at: "2026-09-13T00:00:00Z",
          source: "cf1 fixture",
          subsystems: [],
          open_questions: [],
          counts: { findings: 0 },
          findings: [],
        },
        null,
        2,
      )}\n`,
    );
    const run = runDriver(
      "export-wrong-archive",
      [
        "--carry-from",
        exportPath,
        "--carry-verify-store",
        archiveSummary.path,
        "--carry-reason",
        "the export and the store should name one archive",
      ],
      180_000,
    );
    if (run.status === 0) {
      return `an export declaring store-someotherarchi was carried from beside the store ${archiveSummary.identity}; the two name different archives and the carry took the export's word`;
    }
    if (!run.said.includes(archiveSummary.identity)) {
      return `it exited ${run.status} without naming the store's own identity: ${run.said.slice(-240)}`;
    }
    return refusedBeforeDiscard(run, "an export that names a different archive");
  });

  check("C5 a carry from an archived store writes the records and the run", () => {
    if (!carriedRun) return `${DRIVER_REL} or the built server is absent`;
    if (carriedRun.status !== 0) {
      return `the driver exited ${carriedRun.status}: ${carriedRun.said.slice(-260)}`;
    }
    const runs = readStore(carriedRun.dbPath, "SELECT * FROM carry_runs ORDER BY id");
    if (!runs || runs.length !== 1) {
      return `the rebuilt store holds ${runs?.length ?? "no readable"} carry_runs row(s); §5.2 writes exactly one per invocation so "nothing was carried" and "nobody ran a carry" are different readings`;
    }
    const run = runs[0];
    if (run.source_kind !== "store") return `carry_runs.source_kind is ${JSON.stringify(run.source_kind)}`;
    if (run.archived_store_id !== archiveSummary.identity) {
      return `the carry recorded archived_store_id ${JSON.stringify(run.archived_store_id)}, not the source's minted ${archiveSummary.identity}`;
    }
    if (run.expected_count !== archiveSummary.expected || run.imported_count !== archiveSummary.expected) {
      return `the carry recorded expected_count=${run.expected_count} and imported_count=${run.imported_count} against ${archiveSummary.expected} findings in the source`;
    }
    const rows = readStore(carriedRun.dbPath, "SELECT * FROM carried_findings ORDER BY archived_finding_id");
    if (!rows || rows.length !== archiveSummary.expected) {
      return `the rebuilt store holds ${rows?.length ?? "no readable"} carried record(s) for ${archiveSummary.expected} archived finding(s)`;
    }
    const ids = rows.map((row) => row.archived_finding_id);
    return ids.join(",") === "B03-6,B03-7,B03-9"
      ? null
      : `the carried ids are ${ids.join(", ")}; every archived finding is carried whatever its resolution state`;
  });

  check("C9 a finding the archive had already closed is pre-recorded archived-terminal", () => {
    if (!carriedRun) return `${DRIVER_REL} or the built server is absent`;
    if (carriedRun.status !== 0) return `the driver exited ${carriedRun.status}`;
    const rows = readStore(
      carriedRun.dbPath,
      `SELECT cf.archived_finding_id AS id, o.outcome AS outcome
         FROM carried_findings cf
         LEFT JOIN carried_finding_outcomes o ON o.carried_id = cf.carried_id
        ORDER BY cf.archived_finding_id`,
    );
    if (!rows) return "the rebuilt store could not be read";
    const byId = new Map(rows.map((row) => [row.id, row.outcome]));
    if (byId.get("B03-7") !== "archived-terminal") {
      return `the archive's closed finding was carried with outcome ${JSON.stringify(byId.get("B03-7") ?? null)}; pre-recording it as 'repaired' would put a row into a state whose rule requires a resolving commit and an attached post-repair reading, with neither present`;
    }
    const undecided = ["B03-6", "B03-9"].filter(
      (id) => byId.get(id) !== null && byId.get(id) !== undefined,
    );
    return undecided.length === 0
      ? null
      : `${undecided.join(" and ")} was pre-recorded ${undecided
          .map((id) => JSON.stringify(byId.get(id)))
          .join(", ")}; an open finding is the obligation the survey has to decide, and a repair the archive claimed without proving is fixed-pending-verification, never a closure`;
  });

  check("C3 --carry-from none records an explicit reasoned empty carry", () => {
    if (!driverPresent) return `${DRIVER_REL} is absent`;
    if (!serverBuilt) return "the built server is absent";
    const reason = "throwaway workspace has no predecessor";
    const run = runDriver("none-reasoned", ["--carry-from", "none", "--carry-reason", reason]);
    if (run.status !== 0) {
      return `an explicit reasoned empty carry was refused (exit ${run.status}): ${run.said.slice(-260)}`;
    }
    const runs = readStore(run.dbPath, "SELECT * FROM carry_runs ORDER BY id");
    if (!runs || runs.length !== 1) {
      return `an empty carry wrote ${runs?.length ?? "no readable"} carry_runs row(s); without one "nothing was carried" and "nobody ran a carry" are the same reading (VP4(e))`;
    }
    const row = runs[0];
    if (row.source_kind !== "none") return `source_kind is ${JSON.stringify(row.source_kind)}, not 'none'`;
    if (String(row.reason ?? "") !== reason) {
      return `the recorded reason is ${JSON.stringify(row.reason ?? null)}, not the one the caller gave`;
    }
    return row.expected_count === 0 && row.imported_count === 0
      ? null
      : `the empty carry recorded expected_count=${row.expected_count}, imported_count=${row.imported_count}`;
  });

  // ------------------------- C6..C8: the counts are a contract, not a comment

  {
    const ctx = world("counts");
    const missingBegin = absent("begin_carry_run", "§5.2's separate expected and imported counts");
    const missingCarry = absent("carry_finding", "§5.4's per-record carry");
    const missingFinish = absent("finish_carry_run", "§5.2's refusal to finish while the counts differ");

    const carryOne = (runId, archivedId) =>
      refusal(() =>
        call(
          "carry_finding",
          {
            carry_run_id: runId,
            archived_finding_id: archivedId,
            subsystem_id: "B03",
            severity: "HIGH",
            symptom: "a symptom the archive recorded",
            root_cause: "a cause the archive recorded",
            archived_resolution: "open",
          },
          ctx,
        ),
      );

    check("C6 carry_finding refuses once imported_count is reached", () => {
      if (missingBegin) return missingBegin;
      if (missingCarry) return missingCarry;
      let runId = null;
      const began = refusal(() => {
        runId = call(
          "begin_carry_run",
          {
            source_kind: "store",
            source_path: "/cf1/fixture/archive/memory.db",
            archived_store_id: "store-countsfixture0",
            archived_anchor: headSha(ctx),
            reason: "counted carry",
            expected_count: 1,
            imported_count: 1,
          },
          ctx,
        ).carry_run_id;
        return null;
      });
      if (began) return `begin_carry_run refused: ${began}`;
      const first = carryOne(runId, "C6-1");
      if (first) return `the first carried record was refused: ${first}`;
      const second = carryOne(runId, "C6-2");
      return second
        ? null
        : "a carry wrote more records than the run declared; a count nothing enforces records nothing";
    });

    check("C7 a carry whose declared counts differ refuses to finish", () => {
      if (missingBegin) return missingBegin;
      if (missingCarry) return missingCarry;
      if (missingFinish) return missingFinish;
      let runId = null;
      const began = refusal(() => {
        runId = call(
          "begin_carry_run",
          {
            source_kind: "store",
            source_path: "/cf1/fixture/archive/memory.db",
            archived_store_id: "store-partialfixture",
            archived_anchor: headSha(ctx),
            reason: "a partial carry",
            expected_count: 2,
            imported_count: 1,
          },
          ctx,
        ).carry_run_id;
        return null;
      });
      if (began) return `begin_carry_run refused a partial carry outright: ${began}`;
      // Exactly `imported_count` records are written, so the rows agree with
      // what the run committed to and the *only* disagreement left is the one
      // between expected and imported. Without this the arm would stay green on
      // C8's check alone, and dropping the expected/imported comparison would
      // cost nothing.
      const wrote = carryOne(runId, "C7-1");
      if (wrote) return `the declared record was refused: ${wrote}`;
      const said = refusal(() => call("finish_carry_run", { carry_run_id: runId }, ctx));
      return said
        ? null
        : "a carry that declared 2 expected and 1 imported, and wrote exactly that 1, finished clean; the disagreement is meant to be visible, and a finish that ignores it hides exactly the partial carry the two fields exist to show — the finding left behind is the one nothing will ask about again";
    });

    check("C8 a carry that wrote fewer records than it declared refuses to finish", () => {
      if (missingBegin) return missingBegin;
      if (missingCarry) return missingCarry;
      if (missingFinish) return missingFinish;
      let runId = null;
      const began = refusal(() => {
        runId = call(
          "begin_carry_run",
          {
            source_kind: "store",
            source_path: "/cf1/fixture/archive/memory.db",
            archived_store_id: "store-shortfixture00",
            archived_anchor: headSha(ctx),
            reason: "a carry that stops early",
            expected_count: 2,
            imported_count: 2,
          },
          ctx,
        ).carry_run_id;
        return null;
      });
      if (began) return `begin_carry_run refused: ${began}`;
      const first = carryOne(runId, "C8-1");
      if (first) return `the first carried record was refused: ${first}`;
      const said = refusal(() => call("finish_carry_run", { carry_run_id: runId }, ctx));
      if (!said) {
        return "a run that declared 2 records and wrote 1 finished clean; imported_count is what the run wrote, and a finish that does not compare it to the rows is a count nobody checked";
      }
      const second = carryOne(runId, "C8-2");
      if (second) return `the second carried record was refused: ${second}`;
      const done = refusal(() => call("finish_carry_run", { carry_run_id: runId }, ctx));
      return done ? `the completed carry was still refused: ${done}` : null;
    });
  }

  // ------------------------------------------ F1..F3: the surface and its budget

  {
    const reader = world("surface");
    const storeD = "store-surfacefixture";
    // Enough records, each with the long symptom a real finding carries, that a
    // single envelope cannot hold them.
    const symptom =
      "The reconciliation records six counts and no path set, so a coverage fraction stamped with R is re-read against a ledger that moved under it and nobody can tell a standing reading from a stale one.";
    for (let i = 0; i < 24; i++) {
      seedCarried(reader, {
        archived_finding_id: `SURF-${String(i).padStart(2, "0")}`,
        archived_store_id: storeD,
        symptom: `${symptom} (record ${i})`,
        root_cause: `${symptom} (cause ${i})`,
      });
    }
    reader.db.pragma("wal_checkpoint(TRUNCATE)");

    const session = serverBuilt
      ? await serverSession(reader.project.workspacePath, [
          { name: "list_carried_findings", arguments: {} },
        ])
      : { error: "the built server is absent; run npm run build in mcp-server/" };

    check("F1 the carried tools are advertised by tools/list", () => {
      if (session.error) return `the tool list could not be read — ${scrub(session.error)}`;
      const names = (session.tools ?? []).map((tool) => tool.name);
      if (names.length === 0) return "tools/list returned no tools";
      const wanted = [
        "carry_finding",
        "begin_carry_run",
        "finish_carry_run",
        "record_carried_outcome",
        "attach_carried_evidence",
        "list_carried_findings",
        "get_carried_finding",
      ];
      const missing = wanted.filter((name) => !names.includes(name));
      if (missing.length) {
        return `tools/list does not advertise ${missing.join(", ")}; a tool declared in src/tools and never spread into the server's array is declared and not offered, which no in-process import can see`;
      }
      const listTool = (session.tools ?? []).find((tool) => tool.name === "list_carried_findings");
      if (listTool?.annotations?.readOnlyHint !== true) {
        return "list_carried_findings is not advertised as read-only; it writes nothing";
      }
      const writeTool = (session.tools ?? []).find((tool) => tool.name === "record_carried_outcome");
      return writeTool?.annotations?.readOnlyHint === false
        ? null
        : "record_carried_outcome is advertised as read-only; it writes a durable terminal outcome";
    });

    check("F2 list_carried_findings pages within the 8192-byte envelope", () => {
      if (session.error) return `the tool list could not be read — ${scrub(session.error)}`;
      const first = session.results?.[0];
      if (!first) return "the server returned no result for list_carried_findings";
      if (first.payload?.ok === false) return `list_carried_findings refused: ${first.payload.error}`;
      if (first.bytes > 8192) {
        return `one page cost ${first.bytes} bytes against the 8192-byte budget the other list tools observe; a list tool that returns every carried finding in one envelope is a tool nothing can call twice`;
      }
      const items = first.payload?.carried ?? first.payload?.items ?? null;
      if (!Array.isArray(items) || items.length === 0) {
        return `the page carries no records: ${JSON.stringify(first.payload).slice(0, 200)}`;
      }
      if (items.length >= 24 && !first.payload?.next_cursor) {
        return "every record fitted in one page and no cursor was offered; the fixture holds 24 records precisely so the truncation path is exercised";
      }
      if (items.length < 24 && !first.payload?.next_cursor) {
        return `the page served ${items.length} of 24 records and offered no next_cursor, so the rest are unreachable — a truncation that does not say it truncated is a silent loss (VP4(e))`;
      }
      const shape = items[0];
      const wanted = ["carried_id", "archived_finding_id", "archived_store_id", "severity", "outcome"];
      const missing = wanted.filter((key) => !(key in shape));
      return missing.length === 0
        ? null
        : `a listed record carries no ${missing.join(", ")}; §5.2a names the compact page's fields`;
    });

    await checkAsync("F3 the carried count reads back through a further process", async () => {
      if (!serverBuilt) return "the built server is absent";
      const missing = absent("list_carried_findings", "§7.4 step 6's read-back");
      if (missing) return missing;
      const inProcess = reader.db
        .prepare("SELECT COUNT(*) AS n FROM carried_findings")
        .get().n;
      const pages = [];
      let cursor = null;
      for (let page = 0; page < 12; page++) {
        const args = cursor ? { cursor, limit: 25 } : { limit: 25 };
        const run = await serverSession(reader.project.workspacePath, [
          { name: "list_carried_findings", arguments: args },
        ]);
        if (run.error) return `the read-back process could not run — ${scrub(run.error)}`;
        const payload = run.results?.[0]?.payload;
        if (!payload || payload.ok === false) {
          return `the read-back refused: ${JSON.stringify(payload).slice(0, 200)}`;
        }
        const items = payload.carried ?? payload.items ?? [];
        pages.push(...items.map((item) => item.archived_finding_id));
        cursor = payload.next_cursor ?? null;
        if (!cursor) break;
      }
      const unique = new Set(pages);
      if (unique.size !== pages.length) {
        return `paging served ${pages.length} records with only ${unique.size} distinct ids; a cursor that repeats a record cannot be used to count one`;
      }
      return unique.size === inProcess
        ? null
        : `a further process read back ${unique.size} carried record(s) where the store holds ${inProcess}; a read-back by the process that wrote the rows proves a live handle, not a live store`;
    });
  }

  // ------------------------------------------------- V1, V2: the vocabulary source

  check("V1 carried_finding_outcome is declared in the vocabulary contract", () => {
    const contractPath = join(here, "contracts", "conspectus-vocabulary.json");
    if (!existsSync(contractPath)) return "contracts/conspectus-vocabulary.json is absent";
    let contract = null;
    try {
      contract = JSON.parse(readFileSync(contractPath, "utf8"));
    } catch (error) {
      return `the contract is not parseable: ${scrub(error?.message ?? error)}`;
    }
    const decl = contract.enums?.carried_finding_outcome ?? null;
    if (!decl) {
      return "the contract declares no carried_finding_outcome; an enum declared only in a CREATE TABLE body is invisible to migrateVocabularyChecks, which reads the columns to migrate from the contract's own sql mappings, so an inline CHECK never reaches an existing store";
    }
    const values = (decl.values ?? []).map((value) => value.value);
    const wanted = ["successor-finding", "ruled-out", "repaired", "archived-terminal"];
    const missing = wanted.filter((value) => !values.includes(value));
    if (missing.length) return `the contract's carried_finding_outcome omits ${missing.join(", ")}`;
    const binding = (decl.sql ?? []).some(
      (entry) => entry.table === "carried_finding_outcomes" && entry.column === "outcome",
    );
    if (!binding) {
      return "carried_finding_outcome declares no sql binding to carried_finding_outcomes.outcome, so --check-sql compares nothing and migrateVocabularyChecks migrates nothing";
    }
    const resolution = contract.enums?.finding_resolution_state?.sql ?? [];
    return resolution.some(
      (entry) => entry.table === "carried_findings" && entry.column === "archived_resolution",
    )
      ? null
      : "finding_resolution_state declares no binding to carried_findings.archived_resolution; §5.2 takes that CHECK from the contract's existing five values rather than writing them out again";
  });

  check("V2 both generated enum modules carry the four outcomes", () => {
    const generated = mods.CARRIED_FINDING_OUTCOMES;
    const wanted = ["successor-finding", "ruled-out", "repaired", "archived-terminal"];
    if (!Array.isArray(generated) || wanted.some((value) => !generated.includes(value))) {
      return `dist/vocabulary.js does not export CARRIED_FINDING_OUTCOMES with the contract's values (got ${JSON.stringify(generated ?? null)}); run scripts/gen-vocabulary.mjs`;
    }
    const pyPath = join(REPO, "materializer", "amanuensis_materializer", "vocabulary.py");
    if (!existsSync(pyPath)) return "materializer/amanuensis_materializer/vocabulary.py is absent";
    const py = readFileSync(pyPath, "utf8");
    const absentInPy = wanted.filter((value) => !py.includes(`"${value}"`));
    return absentInPy.length === 0
      ? null
      : `vocabulary.py does not carry ${absentInPy.join(", ")}; the projection reads a second list`;
  });

  // ------------------------------------------------------------ CI1: in CI

  check("CI1 this gate and GATE CF2 run in CI (spec.md §8)", () => {
    const workflow = join(REPO, ".github", "workflows", "test.yml");
    if (!existsSync(workflow)) return ".github/workflows/test.yml is absent";
    const text = readFileSync(workflow, "utf8");
    const missing = [
      ["node test-carried-findings.mjs", "GATE CF1"],
      ["dev/test-carried-finding-references.mjs", "GATE CF2"],
    ].filter(([command]) => !text.includes(command));
    return missing.length === 0
      ? null
      : `the workflow does not run ${missing.map(([, id]) => id).join(" or ")}, so a break lands on a branch no run reports`;
  });

  for (const cleanup of cleanups) cleanup();
  rmSync(scratch, { recursive: true, force: true });
}

// ------------------------------------------------------------------- the driver

let exitCode = 0;
try {
  // Load the subject defensively: an absent build must produce this gate's red
  // line, not a stack trace (spec.md §8.0 clause 1).
  const mods = {};
  try {
    ({ openDatabase: mods.openDatabase } = await import("./dist/db.js"));
    ({ resolveProject: mods.resolveProject, ensureProjectStorage: mods.ensureProjectStorage } =
      await import("./dist/project.js"));
    const [evidence, findings, git, project, subsystems] = await Promise.all([
      import("./dist/tools/evidence.js"),
      import("./dist/tools/findings.js"),
      import("./dist/tools/git.js"),
      import("./dist/tools/project.js"),
      import("./dist/tools/subsystems.js"),
    ]);
    mods.toolArrays = [
      evidence.evidenceTools,
      findings.findingTools,
      git.gitTools,
      project.projectTools,
      subsystems.subsystemTools,
    ];
    // The module this packet adds is loaded for the tools it declares, so its
    // absence is A6/D*/C6's finding rather than the gate's failure to start.
    try {
      const carried = await import("./dist/tools/carried.js");
      if (Array.isArray(carried.carriedTools)) mods.toolArrays.push(carried.carriedTools);
    } catch {
      /* the tools are absent; the arms that need them say so and print it */
    }
    try {
      ({ archivedStoreId: mods.archivedStoreId } = await import("./dist/invariants.js"));
    } catch {
      mods.archivedStoreId = null;
    }
    try {
      ({ CARRIED_FINDING_OUTCOMES: mods.CARRIED_FINDING_OUTCOMES } = await import(
        "./dist/vocabulary.js"
      ));
    } catch {
      mods.CARRIED_FINDING_OUTCOMES = null;
    }
  } catch (error) {
    failures.push(`L1 the server build could not be loaded: ${scrub(error?.message ?? error)}`);
  }

  if (failures.length === 0) {
    if (typeof mods.openDatabase !== "function") {
      failures.push("L1 dist/db.js does not export openDatabase");
    } else if (!Array.isArray(mods.toolArrays)) {
      failures.push("L1 the tool arrays could not be read from dist/tools");
    } else {
      await main(mods);
    }
  }
} catch (error) {
  failures.push(`X1 the gate did not finish: ${scrub(error?.message ?? error)}`);
}

for (const note of notes) console.log(`  note ${note}`);
console.log(`  ran  ${checked} assertion(s) against ${join(here, "dist")}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(
    "GATE P4 RED: GATE CF1 RED: a carried finding has no terminal outcome and nothing said so, " +
      "or a reinitialization carried nothing and was not made to say why, or an outcome was " +
      `written without the authority §5.4 requires — ${failures.length} of ${checked} ` +
      `assertion(s) failed; first: ${failures[0]}`,
  );
  exitCode = 1;
} else {
  console.log("GATE P4 GREEN");
}
process.exit(exitCode);
