#!/usr/bin/env node
// GATE VD1 (spec.md §8.3) — packet P3 of the survey-depth lane.
//
// A structural pass either finds the words a subsystem's own code uses and
// records one, or reads the code and concludes there are none. Today it can do
// neither and still advance: `define_term` is in no precondition, no status
// gate and no rebuild gate, does not require a session, and never resolves the
// anchor it stores (`src/tools/vocabulary.ts:21-43`). The candidate store holds
// zero terms across eight mapped subsystems and nothing noticed.
//
// §4.2 makes the anchor resolve; §4.3 adds the declination as an append-only
// record; §4.4 makes the advance to `structural` refuse a subsystem that has
// done neither. Discharge or decline — never a floor (decisions.md §3).
//
// Two names appear below. `GATE VD1` is what spec.md §8.3 calls this gate;
// `GATE P3` is the packet id the launcher greps for. The status line carries
// both so neither reader has to translate.
//
//   exit 0  `GATE P3 GREEN`          — every assertion held
//   exit 1  `GATE P3 RED: <reason>`  — an assertion fired
//
// This gate has no third state: its inputs are temporary git workspaces and
// stores it creates itself, both of which every machine that can run the
// server can produce (spec.md §8.0 clause 3). One arm spawns the built server
// over stdio to read `tools/list`, which `test-locus-standing.mjs` already
// requires of the same runner.
//
// The table this packet creates is created by the gate's own fixture when the
// store does not have it, so `D1`/`D2` assert *behaviour* — an UPDATE or a
// DELETE that should have been refused — rather than schema arrival (spec.md
// §8.0). The gate never creates the triggers: a store whose schema does not
// ship them fails those two assertions, which is the point. Where an assertion
// needs the tool this packet adds, it reports the tool absent from the server's
// surface, which is an assertion the gate can make and print.
//
// Must-stay-green controls (VP4(f) — a kill proves a gate can fire, never that
// it fires selectively):
//   G1  a subsystem with exactly *one* valid anchored term advances — one term
//       is enough and no quota exists
//   G2  a subsystem with only a declination whose ref_sha resolves advances —
//       "none" is a real and common answer, said out loud
//   G3  the advance to `scoping` is not gated by vocabulary; the refusal binds
//       where §4.4 puts it and nowhere earlier
//   G4  `define_term` with no `first_seen` is accepted and stored unanchored —
//       §4.2 keeps the existing survey path writing, it just discharges nothing
//
// False greens it cannot exclude:
//   - Whether the declination is *true*. "This subsystem has no domain
//     vocabulary" is a judgement; the substrate can require that it be made,
//     attributed and dated, and cannot check it. That is the discharge-or-
//     decline design accepting GP8's scope limit rather than pretending past it.
//   - Whether an anchored term is the term a reader most needs. The anchor
//     resolves; the choice of word is not checkable here.
//   - Anchoring is re-derived from the stored token at every read, so a gate
//     run and a later read can disagree if the repository is rewritten between
//     them. That is the intended reading: history does not discharge a pass.
//
// What a reviewer should sabotage, and what must go red:
//   drop the §4.4 refusal from the advance to `structural`       → B1
//   let an unanchored term discharge                             → B2
//   let a codebase-wide term discharge a subsystem               → B3
//   let any declination row discharge, resolvable or not         → B4, E1
//   read `vocabulary.subsystem_id` only, ignoring the scopes     → B5, D3
//   drop the citation parse from define_term                     → A1
//   accept a malformed or unreachable revision                   → A2, A3
//   skip the tree lookup (`cat-file -e <sha>:<path>`)            → A4
//   stop comparing ref_sha with the token's own revision         → A5
//   drop requireActiveSession from define_term                   → A6
//   store the anchor as typed instead of resolved                → A7
//   drop either declination trigger                              → D1, D2
//   let decline_domain_vocabulary answer over an anchored term   → C2
//   stop resolving the declination's ref_sha                     → C3
//   declare the tool without advertising it                      → C5
//   drop the declination kind from the vocabulary contract       → F1
//   refuse the advance to `scoping` as well                      → G3
//   require two terms, or any count                              → G1, G2

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// A crash signature in this gate's output means the run never reached its
// assertion, so the launcher rejects it as a red proof (spec.md §8.0 clause 1).
// Assertion detail is quoted from live errors, so it is scrubbed rather than
// trusted. The elided form breaks the token in the middle: `<TypeError elided>`
// still contains `TypeError`, so a marker that merely wraps the word would
// leave the signature in the output it was meant to remove.
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

// ---------------------------------------------------------- the advertised surface

/**
 * `tools/list` from the built server over stdio.
 *
 * A tool declared in `src/tools/` and never spread into the server's array is
 * declared and not offered, which is the shape `gen-tool-inventory.mjs`'s
 * reconcile() reports and which no in-process import can see: importing the
 * array proves the array, not the surface.
 */
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
      // `cwd` is the workspace, not this directory: the server refuses a
      // `--workspace` that disagrees with the directory it was launched from
      // (`assertWorkspaceMatchesLaunch`), which is the guard that keeps a stale
      // hard-coded registration from binding someone else's repository.
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
    // The server's own refusals arrive on stderr and its exit is otherwise
    // silent, so a failure to start must report *why* rather than spend the
    // timeout: a gate that says only "no answer in 60s" has asserted nothing.
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
        clientInfo: { name: "vd1", version: "0" },
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
  function absent(name) {
    return allTools.has(name)
      ? null
      : `${name} is absent from the server's tool surface, so the obligation §4.3 gives it is carried by nothing`;
  }

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-vd1-"));
  const cleanups = [];

  function git(cwd, ...args) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return String(result.stdout ?? "").trim();
  }
  function gitCommit(cwd, message) {
    spawnSync(
      "git",
      [
        "-c", "user.email=vd1@localhost",
        "-c", "user.name=survey-depth-vd1",
        "-c", "commit.gpgsign=false",
        "commit", "-q", "--no-verify", "-m", message,
      ],
      { cwd, encoding: "utf8" },
    );
  }

  // The §4.3 table, as the specification declares its columns. Created here
  // only when the store does not already carry it, so an assertion about a row
  // is an assertion about behaviour and not about which commit is checked out.
  // The triggers are deliberately absent: they are the implementation's to
  // ship, and D1/D2 are what read them.
  function ensureDeclinationTable(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS vocabulary_declinations (
        id            INTEGER PRIMARY KEY,
        subsystem_id  TEXT    NOT NULL,
        reason        TEXT    NOT NULL,
        session_id    TEXT    NOT NULL,
        ref_sha       TEXT    NOT NULL,
        declared_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  /**
   * A declination written around the tool. Used where the row the assertion
   * needs is one the tool refuses to write — a revision the repository no
   * longer carries is exactly such a row, and a store whose history was
   * rewritten after the judgement holds one.
   */
  function seedDeclination(ctx, subsystemId, refSha, reason = "vd1 fixture: none apply") {
    ensureDeclinationTable(ctx.db);
    return ctx.db
      .prepare(
        `INSERT INTO vocabulary_declinations (subsystem_id, reason, session_id, ref_sha)
         VALUES (?, ?, ?, ?)`,
      )
      .run(subsystemId, reason, ctx.sessionId ?? "vd1", refSha).lastInsertRowid;
  }
  const declinationsOf = (ctx, subsystemId) => {
    ensureDeclinationTable(ctx.db);
    return ctx.db
      .prepare("SELECT * FROM vocabulary_declinations WHERE subsystem_id = ? ORDER BY id")
      .all(subsystemId);
  };

  /**
   * A fresh workspace, store and open session. Every assertion that writes gets
   * its own, so a refusal in one cannot be explained by a row another left.
   *
   * The workspace always has one real commit, so every revision the fixtures
   * name resolves and `src/a.ts` exists in its tree.
   */
  function world(label, files = { "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 2;\n" }) {
    const ws = join(scratch, `ws-${label}`);
    mkdirSync(ws, { recursive: true });
    git(ws, "init", "-q");
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(ws, name)), { recursive: true });
      writeFileSync(join(ws, name), body);
    }
    git(ws, "add", "-A");
    gitCommit(ws, "seed");
    const project = resolveProject(ws, { selectionSource: "vd1-vocabulary-discharge" });
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
    ctx.sessionId = call("start_session", { intent: `vd1-${label}` }, ctx).session_id;
    return ctx;
  }

  const headSha = (ctx) => git(ctx.project.workspacePath, "rev-parse", "HEAD");
  const statusOf = (ctx, id) =>
    ctx.db.prepare("SELECT status FROM subsystems WHERE id=?").get(id)?.status ?? null;
  const termRow = (ctx, term) =>
    ctx.db.prepare("SELECT * FROM vocabulary WHERE term = ?").get(term) ?? null;

  /** A second commit, so a fixture has two revisions that both resolve. */
  function secondCommit(ctx) {
    const ws = ctx.project.workspacePath;
    writeFileSync(join(ws, "src/later.ts"), `export const later = ${Date.now()};\n`);
    git(ws, "add", "-A");
    gitCommit(ws, "a second revision");
    return headSha(ctx);
  }

  function addEvidence(ctx, filePath) {
    return call(
      "add_evidence",
      {
        file_path: filePath,
        symbol: "Unit",
        line_range: "1-4",
        ref_sha: headSha(ctx),
        kind: "code-verified",
      },
      ctx,
    ).id;
  }

  let seededClaims = 0;
  function seedClaim(ctx, id, filePath) {
    seededClaims += 1;
    call(
      "add_claim",
      {
        claim_id: `VD1-CL-${seededClaims}`,
        claim_key: `${id}/key-type/unit`,
        subject_type: "symbol",
        subject_id: `${filePath}:Unit`,
        statement: `Unit is the type ${id} is built around.`,
        epistemic_kind: "observation",
        ref_sha: headSha(ctx),
        evidence_ids: [addEvidence(ctx, filePath)],
      },
      ctx,
    );
  }

  /**
   * Climb to the rung below the one §4.4 guards. Every earlier prerequisite is
   * satisfied through the tool a survey would use, so a refusal at the advance
   * is this packet's and not P1's or P2's.
   */
  function readyForStructural(ctx, id, filePath = "src/a.ts") {
    call("upsert_subsystem", { id, name: `${id} fixture`, status: "unmapped" }, ctx);
    call("update_subsystem_status", { id, status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      {
        subsystem_id: id,
        ref_sha: headSha(ctx),
        files: [{ file_path: filePath, why_in_scope: "fixture" }],
      },
      ctx,
    );
    seedClaim(ctx, id, filePath);
    return id;
  }

  /** Try the advance §4.4 guards, returning its refusal or null. */
  const advanceToStructural = (ctx, id) =>
    refusal(() => call("update_subsystem_status", { id, status: "structural" }, ctx));

  /** A well-formed 40-hex object name no repository here carries. */
  const UNREACHABLE_SHA = "b0a7e5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c";

  // ------------------------------------------- A1..A7: the anchor has to resolve

  {
    const ctx = world("anchor");
    const head = headSha(ctx);

    check("A1 define_term refuses a first_seen that is not a citation token", () => {
      const said = refusal(() =>
        call(
          "define_term",
          { term: "vd1-prose", gloss: "a term whose anchor is prose", first_seen: "somewhere in the scheduler" },
          ctx,
        ),
      );
      if (!said) {
        return "define_term stored an anchor with no file:symbol@sha form; §4.2's parse is the first of three steps and it did not run";
      }
      return termRow(ctx, "vd1-prose")
        ? "define_term refused and stored the row anyway"
        : null;
    });

    check("A2 define_term refuses a revision that is not 7-40 hex", () => {
      const results = [];
      for (const [term, anchor] of [
        ["vd1-malformed", "src/a.ts:a@zzzzzzz"],
        ["vd1-short", "src/a.ts:a@abc"],
      ]) {
        const said = refusal(() =>
          call("define_term", { term, gloss: "a malformed revision", first_seen: anchor }, ctx),
        );
        if (!said) results.push(`${anchor} was accepted`);
        else if (termRow(ctx, term)) results.push(`${anchor} was refused and stored anyway`);
      }
      return results.length === 0
        ? null
        : `${results.join("; ")} — a revision that is not an object name cannot be resolved, and an anchor nobody can open discharges nothing`;
    });

    check("A3 define_term refuses a well-formed revision the workspace cannot reach", () => {
      const said = refusal(() =>
        call(
          "define_term",
          { term: "vd1-unreachable", gloss: "a revision this repository never had", first_seen: `src/a.ts:a@${UNREACHABLE_SHA}` },
          ctx,
        ),
      );
      if (!said) {
        return `define_term stored an anchor at ${UNREACHABLE_SHA}, which resolves in no repository on this machine`;
      }
      return termRow(ctx, "vd1-unreachable") ? "define_term refused and stored the row anyway" : null;
    });

    check("A4 define_term refuses a resolvable revision whose path is not in that tree", () => {
      // The case requireWorkspaceCitation cannot see: it runs no git at all
      // (src/helpers.ts:180-207), so the token parses and the revision is real.
      const said = refusal(() =>
        call(
          "define_term",
          { term: "vd1-ghost", gloss: "a path this tree does not carry", first_seen: `src/nothing-here.ts:ghost@${head}` },
          ctx,
        ),
      );
      if (!said) {
        return "define_term stored an anchor whose path is absent from the tree at its own revision — the parse passed and no tree lookup ran";
      }
      return termRow(ctx, "vd1-ghost") ? "define_term refused and stored the row anyway" : null;
    });

    check("A5 define_term refuses a ref_sha that disagrees with its own first_seen", () => {
      const later = secondCommit(ctx);
      if (later === head) return "the fixture did not produce a second revision";
      const said = refusal(() =>
        call(
          "define_term",
          {
            term: "vd1-mismatch",
            gloss: "two revisions, one record",
            first_seen: `src/a.ts:a@${head}`,
            ref_sha: later,
          },
          ctx,
        ),
      );
      if (!said) {
        return `define_term stored first_seen at ${head.slice(0, 7)} beside ref_sha ${later.slice(0, 7)}; a row that names two revisions for one reading cannot be re-read`;
      }
      return termRow(ctx, "vd1-mismatch") ? "define_term refused and stored the row anyway" : null;
    });

    check("A6 define_term refuses without an active session", () => {
      const sessionless = { ...ctx, sessionId: null };
      const said = refusal(() =>
        call(
          "define_term",
          { term: "vd1-sessionless", gloss: "written by nobody", first_seen: `src/a.ts:a@${headSha(ctx)}` },
          sessionless,
        ),
      );
      if (!said) return "define_term wrote a durable row with no session to attribute it to";
      return termRow(ctx, "vd1-sessionless") ? "define_term refused and stored the row anyway" : null;
    });

    check("A7 an accepted anchor is stored with its revision resolved", () => {
      const full = headSha(ctx);
      const short = full.slice(0, 8);
      const said = refusal(() =>
        call(
          "define_term",
          { term: "vd1-resolved", gloss: "the anchor a later reader has to re-open", first_seen: `./src/a.ts:a@${short}` },
          ctx,
        ),
      );
      if (said) return `define_term refused a valid anchor: ${said}`;
      const row = termRow(ctx, "vd1-resolved");
      if (!row) return "define_term reported success and stored no row";
      if (row.first_seen !== `src/a.ts:a@${full}`) {
        return `first_seen is ${JSON.stringify(row.first_seen)}, not the normalized path with the resolved 40-hex revision src/a.ts:a@${full} — a stored prefix is a revision a later reader has to guess at`;
      }
      return null;
    });

    check("G4 define_term with no first_seen is accepted and stored unanchored", () => {
      const said = refusal(() =>
        call("define_term", { term: "vd1-unanchored", gloss: "the existing survey path still writes" }, ctx),
      );
      if (said) return `define_term refused a term with no anchor: ${said}`;
      const row = termRow(ctx, "vd1-unanchored");
      if (!row) return "define_term reported success and stored no row";
      return row.first_seen == null
        ? null
        : `an unanchored term was stored with first_seen ${JSON.stringify(row.first_seen)}`;
    });
  }

  // ------------------------------------- B1..B5: what the advance will not accept

  {
    const ctx = world("prerequisite");
    const head = headSha(ctx);

    check(
      "B1 a subsystem reached structural having neither defined a term nor declined",
      () => {
        readyForStructural(ctx, "B-01");
        const said = advanceToStructural(ctx, "B-01");
        if (!said) {
          return `B-01 advanced to '${statusOf(ctx, "B-01")}' with no anchored term scoped to it and no declination: the structural pass neither defined a domain term nor declared that it has none, and nothing refused`;
        }
        if (statusOf(ctx, "B-01") === "structural") {
          return `the advance reported a refusal and wrote 'structural' anyway: ${said}`;
        }
        return null;
      },
    );

    check("B2 an unanchored term does not discharge the obligation", () => {
      readyForStructural(ctx, "B-02");
      call("define_term", { term: "vd1-b02", gloss: "a term with no anchor", subsystem_id: "B-02" }, ctx);
      const said = advanceToStructural(ctx, "B-02");
      return said
        ? null
        : "B-02 advanced on a term with no first_seen; §4.2 stores such a row and §4.4 reads *anchored*, so it is visible, countable, and worth nothing";
    });

    check("B3 a codebase-wide term does not discharge a subsystem", () => {
      readyForStructural(ctx, "B-03");
      const said = refusal(() =>
        call(
          "define_term",
          { term: "vd1-everywhere", gloss: "a term that belongs to everything", first_seen: `src/a.ts:a@${head}` },
          ctx,
        ),
      );
      if (said) return `define_term refused a valid codebase-wide term: ${said}`;
      const advance = advanceToStructural(ctx, "B-03");
      return advance
        ? null
        : "B-03 advanced on a term with subsystem_id IS NULL; a term that belongs to everything tells a reader nothing about the subsystem that just advanced";
    });

    check("B4 a declination whose ref_sha no longer resolves discharges nothing", () => {
      readyForStructural(ctx, "B-04");
      seedDeclination(ctx, "B-04", UNREACHABLE_SHA);
      const said = advanceToStructural(ctx, "B-04");
      return said
        ? null
        : `B-04 advanced on a declination anchored at ${UNREACHABLE_SHA.slice(0, 7)}, which resolves nowhere; a kept record is history and history does not discharge a new pass`;
    });

    check("B5 a term anchored to another subsystem does not discharge this one", () => {
      readyForStructural(ctx, "B-05");
      readyForStructural(ctx, "B-06");
      const said = refusal(() =>
        call(
          "define_term",
          { term: "vd1-b06-only", gloss: "B-06's word", subsystem_id: "B-06", first_seen: `src/b.ts:b@${head}` },
          ctx,
        ),
      );
      if (said) return `define_term refused a valid scoped term: ${said}`;
      const advance = advanceToStructural(ctx, "B-05");
      return advance
        ? null
        : "B-05 advanced on a term scoped to B-06; the prerequisite reads terms scoped to the subsystem that is advancing";
    });
  }

  // ------------------------------------------ C1..C5: decline_domain_vocabulary

  {
    const ctx = world("decline");
    const head = headSha(ctx);

    check("C1 decline_domain_vocabulary writes one attributed, revision-bound row", () => {
      const missing = absent("decline_domain_vocabulary");
      if (missing) return missing;
      readyForStructural(ctx, "C-01");
      const said = refusal(() =>
        call(
          "decline_domain_vocabulary",
          {
            subsystem_id: "C-01",
            reason: "every identifier here is a general programming term; the subsystem coins nothing",
            ref_sha: head,
          },
          ctx,
        ),
      );
      if (said) return `decline_domain_vocabulary refused a well-formed declination: ${said}`;
      const rows = declinationsOf(ctx, "C-01");
      if (rows.length !== 1) return `one call left ${rows.length} row(s), not 1`;
      const row = rows[0];
      if (row.ref_sha !== head) return `ref_sha is ${row.ref_sha}, not the resolved ${head}`;
      if (row.session_id !== ctx.sessionId) {
        return `session_id is ${JSON.stringify(row.session_id)}, not the open session ${ctx.sessionId}; an unattributed judgement is nobody's`;
      }
      if (!String(row.reason ?? "").includes("coins nothing")) {
        return `reason is ${JSON.stringify(row.reason)}, not the sentence the caller gave`;
      }
      return null;
    });

    check("C2 decline_domain_vocabulary refuses a subsystem that has an anchored term", () => {
      const missing = absent("decline_domain_vocabulary");
      if (missing) return missing;
      readyForStructural(ctx, "C-02");
      const defined = refusal(() =>
        call(
          "define_term",
          { term: "vd1-c02", gloss: "C-02's word", subsystem_id: "C-02", first_seen: `src/a.ts:a@${head}` },
          ctx,
        ),
      );
      if (defined) return `define_term refused a valid scoped term: ${defined}`;
      const before = declinationsOf(ctx, "C-02").length;
      const said = refusal(() =>
        call(
          "decline_domain_vocabulary",
          { subsystem_id: "C-02", reason: "asserting both at once", ref_sha: head },
          ctx,
        ),
      );
      if (!said) {
        return "a subsystem was allowed to carry domain vocabulary and declare it has none at the same time";
      }
      if (!said.includes("vd1-c02")) {
        return `the refusal does not name the anchored term the caller has to look at: ${said}`;
      }
      const after = declinationsOf(ctx, "C-02").length;
      return after === before ? null : `the refusal still wrote ${after - before} row(s)`;
    });

    check("C3 decline_domain_vocabulary resolves its ref_sha and requires a session", () => {
      const missing = absent("decline_domain_vocabulary");
      if (missing) return missing;
      readyForStructural(ctx, "C-03");
      const unreachable = refusal(() =>
        call(
          "decline_domain_vocabulary",
          { subsystem_id: "C-03", reason: "anchored nowhere", ref_sha: UNREACHABLE_SHA },
          ctx,
        ),
      );
      const sessionless = refusal(() =>
        call(
          "decline_domain_vocabulary",
          { subsystem_id: "C-03", reason: "written by nobody", ref_sha: head },
          { ...ctx, sessionId: null },
        ),
      );
      const wrong = [];
      if (!unreachable) wrong.push("a declination was anchored at a revision nothing resolves");
      if (!sessionless) wrong.push("a declination was written with no session to attribute it to");
      if (declinationsOf(ctx, "C-03").length !== 0) wrong.push("a refused declination was stored");
      return wrong.length === 0 ? null : wrong.join("; ");
    });

    check("C4 the reason is required and is not a default the tool supplies", () => {
      const missing = absent("decline_domain_vocabulary");
      if (missing) return missing;
      readyForStructural(ctx, "C-04");
      const empty = refusal(() =>
        call("decline_domain_vocabulary", { subsystem_id: "C-04", reason: "", ref_sha: head }, ctx),
      );
      const omitted = refusal(() =>
        call("decline_domain_vocabulary", { subsystem_id: "C-04", ref_sha: head }, ctx),
      );
      const wrong = [];
      if (!empty) wrong.push("an empty reason was accepted");
      if (!omitted) wrong.push("an omitted reason was accepted");
      if (declinationsOf(ctx, "C-04").length !== 0) wrong.push("a refused declination was stored");
      return wrong.length === 0
        ? null
        : `${wrong.join("; ")} — "none applies" without a reason is the floor this design refuses to install`;
    });
  }

  // ------------------------------------------ D1..D3: append-only, and the scopes

  {
    const ctx = world("appendonly");
    const head = headSha(ctx);
    seedDeclination(ctx, "D-01", head, "the row a later reader must still find");

    check("D1 a declination row cannot be updated", () => {
      const said = refusal(() =>
        ctx.db.prepare("UPDATE vocabulary_declinations SET reason = ? WHERE subsystem_id = ?").run("rewritten", "D-01"),
      );
      if (!said) {
        return "an UPDATE on vocabulary_declinations succeeded; a declination that can be edited after the fact is not a record of what a reader concluded and when";
      }
      const row = declinationsOf(ctx, "D-01")[0];
      return String(row?.reason ?? "").includes("later reader")
        ? null
        : `the UPDATE was refused and the row changed anyway: reason is ${JSON.stringify(row?.reason)}`;
    });

    check("D2 a declination row cannot be deleted", () => {
      const said = refusal(() =>
        ctx.db.prepare("DELETE FROM vocabulary_declinations WHERE subsystem_id = ?").run("D-01"),
      );
      if (!said) {
        return "a DELETE on vocabulary_declinations succeeded; §4.3 keeps a ruled-out record rather than erasing it (GP18)";
      }
      return declinationsOf(ctx, "D-01").length === 1
        ? null
        : "the DELETE was refused and the row went anyway";
    });

    check("D3 re-defining a shared term does not revoke another subsystem's discharge", () => {
      readyForStructural(ctx, "D-02", "src/a.ts");
      readyForStructural(ctx, "D-03", "src/b.ts");
      const first = refusal(() =>
        call(
          "define_term",
          { term: "vd1-shared", gloss: "a word both subsystems use", subsystem_id: "D-02", first_seen: `src/a.ts:a@${head}` },
          ctx,
        ),
      );
      if (first) return `define_term refused a valid scoped term: ${first}`;
      const second = refusal(() =>
        call(
          "define_term",
          { term: "vd1-shared", gloss: "a word both subsystems use", subsystem_id: "D-03", first_seen: `src/a.ts:a@${head}` },
          ctx,
        ),
      );
      if (second) return `re-defining the shared term for D-03 was refused: ${second}`;
      const wrong = [];
      const d02 = advanceToStructural(ctx, "D-02");
      if (d02) {
        wrong.push(
          `D-02's discharge was revoked when the same term was defined for D-03, silently and after the fact: ${d02}`,
        );
      }
      const d03 = advanceToStructural(ctx, "D-03");
      if (d03) wrong.push(`D-03 could not advance on the term it just defined: ${d03}`);
      return wrong.length === 0 ? null : wrong.join("; ");
    });

    check("D4 the store re-opens with the declination rows it already held", () => {
      // §4.3's DDL is `CREATE ... IF NOT EXISTS`, and src/db.ts re-execs
      // schema.sql on every open (:84-89). A bare CREATE throws on the second
      // open, which is the failure XS1 reads from the other side.
      const before = declinationsOf(ctx, "D-01").length;
      const reopened = refusal(() => {
        const db = openDatabase(ctx.project.dbPath);
        const n = db.prepare("SELECT COUNT(*) AS n FROM vocabulary_declinations WHERE subsystem_id='D-01'").get().n;
        db.close();
        if (n !== before) throw new Error(`the re-open found ${n} row(s) where ${before} stood`);
      });
      return reopened ? `re-opening the store failed: ${reopened}` : null;
    });
  }

  // ---------------------------------------- E1: the declination that still stands

  {
    const ctx = world("effective");
    const head = headSha(ctx);

    check("E1 the effective declination is the most recent one whose ref_sha resolves", () => {
      readyForStructural(ctx, "E-01");
      seedDeclination(ctx, "E-01", head, "read at a revision the repository still has");
      seedDeclination(ctx, "E-01", UNREACHABLE_SHA, "re-declared at a revision since rewritten away");
      const said = advanceToStructural(ctx, "E-01");
      if (said) {
        return `E-01 was refused although it holds a declination at ${head.slice(0, 7)} that still resolves; the prerequisite reads the most recent *resolvable* row, and a later unresolvable one is history beside it — ${said}`;
      }
      return statusOf(ctx, "E-01") === "structural"
        ? null
        : `the advance reported no refusal and left E-01 at '${statusOf(ctx, "E-01")}'`;
    });
  }

  // ------------------------------------------------- G1..G3: the controls proper

  {
    const ctx = world("controls");
    const head = headSha(ctx);

    check("G1 one valid anchored term is enough to advance", () => {
      readyForStructural(ctx, "G-01");
      const defined = refusal(() =>
        call(
          "define_term",
          {
            term: "vd1-g01",
            gloss: "the one word G-01's code coins",
            expansion: "What it means, why it exists, and what it implies for a reader of this subsystem.",
            subsystem_id: "G-01",
            first_seen: `src/a.ts:a@${head}`,
            ref_sha: head,
          },
          ctx,
        ),
      );
      if (defined) return `define_term refused a valid anchored term: ${defined}`;
      const said = advanceToStructural(ctx, "G-01");
      if (said) return `one anchored term was not enough — a quota was installed where §4.4 says there is none: ${said}`;
      return statusOf(ctx, "G-01") === "structural"
        ? null
        : `the advance reported no refusal and left G-01 at '${statusOf(ctx, "G-01")}'`;
    });

    check("G2 a declination whose ref_sha resolves is enough to advance", () => {
      readyForStructural(ctx, "G-02");
      seedDeclination(ctx, "G-02", head, "no term here is this codebase's own; every identifier is a general one");
      const said = advanceToStructural(ctx, "G-02");
      if (said) return `"none" was not accepted as an answer: ${said}`;
      return statusOf(ctx, "G-02") === "structural"
        ? null
        : `the advance reported no refusal and left G-02 at '${statusOf(ctx, "G-02")}'`;
    });

    check("G3 the advance to scoping is not gated by vocabulary", () => {
      call("upsert_subsystem", { id: "G-03", name: "G-03 fixture", status: "unmapped" }, ctx);
      const said = refusal(() => call("update_subsystem_status", { id: "G-03", status: "scoping" }, ctx));
      return said
        ? `the vocabulary refusal moved off 'structural' and now blocks the scoping phase that has to run before a term can be found: ${said}`
        : null;
    });
  }

  // ------------------------------- F1: the declination kind lives in the contract

  check("F1 the vocabulary contract declares the three vocabulary states", () => {
    const contractPath = join(here, "contracts", "conspectus-vocabulary.json");
    if (!existsSync(contractPath)) return "contracts/conspectus-vocabulary.json is absent";
    let doc;
    try {
      doc = JSON.parse(readFileSync(contractPath, "utf8"));
    } catch (error) {
      return `the contract is not readable JSON: ${scrub(error?.message ?? error)}`;
    }
    const decl = doc?.enums?.vocabulary_discharge;
    if (!decl) {
      return "the contract carries no vocabulary_discharge enum, so 'declined' exists only as a string inside a renderer and the three states §4.5 keeps apart have no single source";
    }
    const values = (decl.values ?? []).map((v) => v.value);
    const want = ["terms", "declined", "not-recorded"];
    const missing = want.filter((v) => !values.includes(v));
    if (missing.length) return `vocabulary_discharge is missing ${missing.join(", ")}`;
    for (const value of decl.values ?? []) {
      for (const field of ["label", "meaning", "cannot_justify"]) {
        if (typeof value?.[field] !== "string" || value[field].trim() === "") {
          return `vocabulary_discharge.${value?.value} carries no ${field}`;
        }
      }
    }
    const generated = mods.VOCABULARY_DISCHARGES;
    if (!Array.isArray(generated) || want.some((v) => !generated.includes(v))) {
      return `dist/vocabulary.js does not export VOCABULARY_DISCHARGES with the contract's values (got ${JSON.stringify(generated ?? null)}); run scripts/gen-vocabulary.mjs`;
    }
    const pyPath = join(here, "..", "materializer", "amanuensis_materializer", "vocabulary.py");
    if (!existsSync(pyPath)) return "materializer/amanuensis_materializer/vocabulary.py is absent";
    const py = readFileSync(pyPath, "utf8");
    const absentInPy = want.filter((v) => !py.includes(`"${v}"`));
    return absentInPy.length === 0
      ? null
      : `vocabulary.py does not carry ${absentInPy.join(", ")}; the projection reads a second list`;
  });

  // ------------------------------------------------ C5 proper: the served surface

  {
    const ws = join(scratch, "ws-surface");
    mkdirSync(ws, { recursive: true });
    git(ws, "init", "-q");
    writeFileSync(join(ws, "src-a.ts"), "export const a = 1;\n");
    git(ws, "add", "-A");
    gitCommit(ws, "seed");
    const advertised = await listTools(ws);
    check("C5 tools/list advertises decline_domain_vocabulary", () => {
      if (advertised.error) return `the tool list could not be read — ${scrub(advertised.error)}`;
      const names = (advertised.tools ?? []).map((tool) => tool.name);
      if (names.length === 0) return "tools/list returned no tools";
      if (!names.includes("decline_domain_vocabulary")) {
        return "decline_domain_vocabulary is not advertised by tools/list; a tool declared in src/tools and never served is a tool no survey can call";
      }
      const tool = advertised.tools.find((entry) => entry.name === "decline_domain_vocabulary");
      if (tool?.annotations?.readOnlyHint !== false) return "it is advertised as read-only; it writes a durable row";
      if (tool?.annotations?.destructiveHint !== false) {
        return "it is advertised as destructive; §4.3 makes the table append-only, so the write is additive";
      }
      const required = tool?.inputSchema?.required ?? [];
      const missing = ["subsystem_id", "reason", "ref_sha"].filter((k) => !required.includes(k));
      return missing.length === 0
        ? null
        : `its advertised schema does not require ${missing.join(", ")}`;
    });
    rmSync(join(ws, "storage"), { recursive: true, force: true });
  }

  // ----------------------------------------------------------------- CI1: in CI

  check("CI1 this gate runs in CI (spec.md §8)", () => {
    const workflow = join(here, "..", ".github", "workflows", "test.yml");
    if (!existsSync(workflow)) return ".github/workflows/test.yml is absent";
    return readFileSync(workflow, "utf8").includes("node test-vocabulary-discharge.mjs")
      ? null
      : "the workflow does not run this gate, so a break lands on a branch no run reports";
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
    const [claims, evidence, files, project, subsystems, vocabulary] = await Promise.all([
      import("./dist/tools/claims.js"),
      import("./dist/tools/evidence.js"),
      import("./dist/tools/files.js"),
      import("./dist/tools/project.js"),
      import("./dist/tools/subsystems.js"),
      import("./dist/tools/vocabulary.js"),
    ]);
    mods.toolArrays = [
      claims.claimTools,
      evidence.evidenceTools,
      files.fileTools,
      project.projectTools,
      subsystems.subsystemTools,
      vocabulary.vocabularyTools,
    ];
    // The generated enum module is read for one constant this packet adds, so
    // its absence is F1's finding rather than the gate's failure to start.
    try {
      ({ VOCABULARY_DISCHARGES: mods.VOCABULARY_DISCHARGES } = await import("./dist/vocabulary.js"));
    } catch {
      mods.VOCABULARY_DISCHARGES = null;
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
    "GATE P3 RED: GATE VD1 RED: a subsystem reached structural having neither defined a term nor declined " +
      "for it, or define_term stored an anchor whose revision or path does not resolve, or a declination " +
      `proved editable, unattributed or unanswerable — ${failures.length} of ${checked} ` +
      `assertion(s) failed; first: ${failures[0]}`,
  );
  exitCode = 1;
} else {
  console.log("GATE P3 GREEN");
}
process.exit(exitCode);
