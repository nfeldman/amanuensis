#!/usr/bin/env node
// GATE SR1 (spec.md §8.2) — packet P2 of the survey-depth lane.
//
// A reconciliation is a comparison of two sets at a moment: the repository's
// tracked paths at a revision, and the file ledger. Today nothing records that
// the comparison happened. `detect_changes` rewrites `scope_gaps` from scratch
// (src/tools/git.ts:303-312) and an empty `scope_gaps` is indistinguishable
// from a reconciliation that found nothing — the candidate store has zero gap
// rows and 501 unledgered tracked paths at the same revision. §3.2 makes the
// reading its own append-only record; §3.3 defines when that record still
// stands; §3.3a separates *reconciled* from *complete* and binds each to the
// operation it licenses.
//
// Two names appear below. `GATE SR1` is what spec.md §8.2 calls this gate;
// `GATE P2` is the packet id the launcher greps for. The status line carries
// both so neither reader has to translate.
//
//   exit 0  `GATE P2 GREEN`          — every assertion held
//   exit 1  `GATE P2 RED: <reason>`  — an assertion fired
//
// This gate has no third state: its inputs are temporary git workspaces and
// stores it creates itself, both of which every machine that can run the
// server can produce (spec.md §8.0 clause 3). The one arm that needs more —
// the control's real publication — needs the materializer and a python3, which
// `test-projection-custody.mjs` already requires of the same runner.
//
// The table this packet creates is created by the gate's own fixture when the
// store does not have it, so `A5`/`A6` assert *behaviour* — an UPDATE or a
// DELETE that should have been refused — rather than schema arrival (spec.md
// §8.0). The gate never creates the triggers: a store whose schema does not
// ship them fails those two assertions, which is the point.
//
// Must-stay-green controls (VP4(f) — a kill proves a gate can fire, never that
// it fires selectively):
//   C1  a reconciled store with zero unledgered and zero absent advances to
//       `mapped` and publishes, with every read-back axis green
//   C2  the advance to `structural` does not refuse an unreconciled store
//   C3  the advance to `mapped` does not refuse a reconciliation that reports
//       a correct but nonzero `unledgered` — §3.3a binds that at publication
//
// False greens it cannot exclude:
//   - That the unledgered paths were *assigned well*. Reconciliation proves the
//     ledger and the tree were compared, not that a file landed in the right
//     subsystem.
//   - `ledger_digest` is taken over (path, classification) pairs, as §3.2
//     specifies. Moving one ledger row from subsystem A to subsystem B, with
//     the path and the classification unchanged, leaves the multiset identical
//     and so leaves a standing reconciliation standing. Every other ledger
//     mutation — an added path, a dropped path, a re-classification, a second
//     owner — moves the digest, and A12 asserts that.
//   - A reconciliation stands against the tree as it is re-derived *now*. It
//     says nothing about a workspace whose git objects have become unreadable,
//     which is reported as unresolvable rather than silently accepted.
//
// What a reviewer should sabotage, and what must go red:
//   write no scope_reconciliations row                         → A1, A3
//   write the row outside the scope_gaps transaction           → A2
//   keep `git ls-files`, or enumerate HEAD instead of R        → A10, A11
//   store `current_sha` unresolved                             → A7, A8
//   drop either immutability trigger                           → A5, A6
//   stop re-deriving tree_digest or ledger_digest              → A12, A13
//   drop the §3.3 refusal from the advance to `mapped`         → A14
//   drop the §3.3 refusal from materialize_docs                → A15, A16
//   drop the §3.3a zero-unledgered refusal from publication    → A17
//   move the §3.3a refusal onto the advance to `mapped`        → C3
//   refuse the advance to `structural` too                     → C2
//   stop reporting duplicate ledger ownership                  → A9

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

// --------------------------------------------------------------- the gate body

function main(mods) {
  const { openDatabase, resolveProject, ensureProjectStorage, toolArrays } = mods;

  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  function call(name, args, ctx) {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    return td.handler(args, ctx);
  }

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-sr1-"));
  const cleanups = [];

  function git(cwd, ...args) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return String(result.stdout ?? "").trim();
  }
  function gitCommit(cwd, message) {
    spawnSync(
      "git",
      [
        "-c", "user.email=sr1@localhost",
        "-c", "user.name=survey-depth-sr1",
        "-c", "commit.gpgsign=false",
        "commit", "-q", "--no-verify", "-m", message,
      ],
      { cwd, encoding: "utf8" },
    );
  }

  // The §3.2 table, as the specification declares its columns. Created here
  // only when the store does not already carry it, so an assertion about a row
  // is an assertion about behaviour and not about which commit is checked out.
  // The triggers are deliberately absent: they are the implementation's to
  // ship, and A5/A6 are what read them.
  const RECONCILIATION_COLUMNS =
    "detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows, unledgered, absent, exempt";
  function ensureReconciliationTable(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS scope_reconciliations (
        id              INTEGER PRIMARY KEY,
        detected_sha    TEXT    NOT NULL,
        tree_digest     TEXT    NOT NULL,
        ledger_digest   TEXT    NOT NULL,
        tracked_paths   INTEGER NOT NULL,
        ledger_rows     INTEGER NOT NULL,
        unledgered      INTEGER NOT NULL,
        absent          INTEGER NOT NULL,
        exempt          INTEGER NOT NULL,
        session_id      TEXT,
        detected_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  function reconciliationRows(ctx) {
    ensureReconciliationTable(ctx.db);
    return ctx.db.prepare("SELECT * FROM scope_reconciliations ORDER BY id").all();
  }
  function latestReconciliation(ctx) {
    const rows = reconciliationRows(ctx);
    return rows.length > 0 ? rows[rows.length - 1] : null;
  }
  function seedReconciliation(ctx, row) {
    ensureReconciliationTable(ctx.db);
    ctx.db
      .prepare(
        `INSERT INTO scope_reconciliations (${RECONCILIATION_COLUMNS})
         VALUES (@detected_sha, @tree_digest, @ledger_digest, @tracked_paths,
                 @ledger_rows, @unledgered, @absent, @exempt)`,
      )
      .run({
        tracked_paths: 0,
        ledger_rows: 0,
        unledgered: 0,
        absent: 0,
        exempt: 0,
        ...row,
      });
  }
  function setLastCheckedSha(ctx, sha) {
    ctx.db
      .prepare(
        `INSERT INTO git_state (repo_id, canonical_branch, last_checked_sha, onboarding_sha)
         VALUES ('default', 'main', ?, ?)
         ON CONFLICT(repo_id) DO UPDATE SET last_checked_sha=excluded.last_checked_sha`,
      )
      .run(sha, sha);
  }

  // The gate's own derivation, kept independent of the server's. §3.2 pins both
  // digests: SHA-256 over the sorted NUL-joined tracked path set, and over the
  // sorted NUL-joined (path, classification) pairs.
  const NUL = "\u0000";
  const digest = (parts) => createHash("sha256").update(parts.join(NUL)).digest("hex");
  function treeAt(ctx, revision) {
    return git(ctx.project.workspacePath, "ls-tree", "-r", "--name-only", revision)
      .split("\n")
      .filter(Boolean);
  }
  function ledgerOf(ctx) {
    return ctx.db.prepare("SELECT subsystem_id, file_path, classification FROM file_ledger").all();
  }
  const EXEMPT = new Set(["generated-ignore", "vendor-ignore", "irrelevant"]);
  /** Re-derive §3.2's six counts and two digests from the repository and the ledger. */
  function derive(ctx, revision) {
    const tracked = treeAt(ctx, revision);
    const trackedSet = new Set(tracked);
    const rows = ledgerOf(ctx);
    const ledgerPaths = new Set(rows.map((r) => r.file_path));
    return {
      tracked_paths: tracked.length,
      ledger_rows: ledgerPaths.size,
      unledgered: tracked.filter((p) => !ledgerPaths.has(p)).length,
      absent: rows.filter((r) => !trackedSet.has(r.file_path)).length,
      // Distinct paths, not rows: §3.2's `exempt` is one side of the tracked-set
      // intersection, and a path owned twice is one path.
      exempt: new Set(
        rows
          .filter((r) => trackedSet.has(r.file_path) && EXEMPT.has(r.classification))
          .map((r) => r.file_path),
      ).size,
      tree_digest: digest([...tracked].sort()),
      ledger_digest: digest(rows.map((r) => `${r.file_path}${NUL}${r.classification ?? ""}`).sort()),
    };
  }

  /**
   * A fresh workspace, store and open session. Every assertion that writes gets
   * its own, so a refusal in one cannot be explained by a row another left.
   *
   * `files` are committed at the first commit; the workspace always has one
   * real commit so every revision the fixtures name resolves.
   */
  function world(
    label,
    files = { "a.ts": "export const a = 1;\n", "b.ts": "export const b = 2;\n" },
  ) {
    const ws = join(scratch, `ws-${label}`);
    mkdirSync(ws, { recursive: true });
    git(ws, "init", "-q");
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(ws, name)), { recursive: true });
      writeFileSync(join(ws, name), body);
    }
    git(ws, "add", "-A");
    gitCommit(ws, "seed");
    const project = resolveProject(ws, { selectionSource: "sr1-scope-reconciliation" });
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
    ctx.sessionId = call("start_session", { intent: `sr1-${label}` }, ctx).session_id;
    return ctx;
  }

  const headSha = (ctx) => git(ctx.project.workspacePath, "rev-parse", "HEAD");
  const statusOf = (ctx, id) =>
    ctx.db.prepare("SELECT status FROM subsystems WHERE id=?").get(id)?.status ?? null;

  /** `set_git_state` once, then one real `detect_changes` at `revision`. */
  function reconcile(ctx, revision = null) {
    const sha = revision ?? headSha(ctx);
    if (!ctx.db.prepare("SELECT 1 FROM git_state WHERE repo_id='default'").get()) {
      call("set_git_state", { canonical_branch: "main", onboarding_sha: headSha(ctx) }, ctx);
    }
    return call("detect_changes", { current_sha: sha }, ctx);
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
        claim_id: `SR1-CL-${seededClaims}`,
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

  function seedChallenges(ctx, id) {
    const unchallenged = ctx.db
      .prepare(
        `SELECT claim_id FROM claims c
          WHERE c.valid_until_sha IS NULL
            AND substr(c.claim_key, 1, length(?)) = ?
            AND NOT EXISTS (SELECT 1 FROM claim_challenge_outcomes o WHERE o.claim_id = c.claim_id)`,
      )
      .all(`${id}/`, `${id}/`);
    for (const row of unchallenged) {
      call(
        "record_claim_challenge",
        {
          claim_id: row.claim_id,
          outcome: "survived",
          challenge:
            "fixture probe: read the declaration and found nothing that would overturn it",
          ref_sha: headSha(ctx),
        },
        ctx,
      );
    }
  }

  /**
   * Climb to `adversarial`, the last rung before the one §3.3 guards. Every
   * prerequisite is satisfied through the tool a survey would use, including
   * §2.2's `evidence_ids`, so a refusal here is this packet's and not P1's.
   */
  // §4.4's own deliverable, checked at the same advance the claim is: the
  // structural pass either records a domain term whose anchor resolves or
  // declares the subsystem carries none. These fixture subsystems coin no word
  // of their own, so they say so — which is an answer, not a gap.
  function dischargeVocabulary(ctx, id) {
    call(
      "decline_domain_vocabulary",
      {
        subsystem_id: id,
        reason: "fixture subsystem: its seeded files coin no term of their own",
        ref_sha: headSha(ctx),
      },
      ctx,
    );
  }

  let seededConcerns = 0;
  function climbToAdversarial(ctx, id, filePath) {
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
    dischargeVocabulary(ctx, id);
    call("update_subsystem_status", { id, status: "structural" }, ctx);
    call(
      "register_artifact",
      { path: `${id}-survey.md`, kind: "subsystem-survey", subsystem_id: id },
      ctx,
    );
    call("update_subsystem_status", { id, status: "concerns" }, ctx);
    seededConcerns += 1;
    const code = `SR1-C${seededConcerns}`;
    call("add_concern", { code, category: "cache", origin: "seeded" }, ctx);
    call(
      "set_disposition",
      {
        subsystem_id: id,
        concern_code: code,
        classification: "ruled-out",
        evidence: `${filePath}:Unit@${headSha(ctx)}`,
        evidence_ids: [addEvidence(ctx, filePath)],
        evidence_quality: "code-verified",
        linchpin_dependent: false,
        rationale: "fixture disposition",
        ref_sha: headSha(ctx),
        pass_type: "survey",
      },
      ctx,
    );
    call("update_subsystem_status", { id, status: "adversarial" }, ctx);
    return id;
  }

  /** Try the advance §3.3 guards, returning its refusal or null. */
  function advanceToMapped(ctx, id) {
    seedChallenges(ctx, id);
    return refusal(() => call("update_subsystem_status", { id, status: "mapped" }, ctx));
  }

  // ------------------------------------------------- A1..A4: the record itself

  {
    const ctx = world("record");
    climbToAdversarial(ctx, "B-01", "a.ts");
    const before = reconciliationRows(ctx).length;

    check(
      "A1 detect_changes writes exactly one scope_reconciliations row and returns its id",
      () => {
        const result = reconcile(ctx);
        if (result?.ok === false) return `detect_changes refused: ${result.error}`;
        const rows = reconciliationRows(ctx);
        if (rows.length !== before + 1) {
          return `one detect_changes call left ${rows.length - before} new row(s), not 1 — a store with no reconciliation record cannot tell a reading of nothing from no reading at all (VP4(e))`;
        }
        const second = reconcile(ctx);
        if (second?.ok === false) return `the second detect_changes refused: ${second.error}`;
        const after = reconciliationRows(ctx);
        if (after.length !== before + 2) {
          return `a second detect_changes left ${after.length - before - 1} further row(s), not 1; §3.2 makes the history of reconciliations the record of when the map was last checked`;
        }
        const latest = after[after.length - 1];
        if (second.reconciliation_id !== latest.id) {
          return `detect_changes returned reconciliation_id ${JSON.stringify(second.reconciliation_id)} for row id ${latest.id}`;
        }
        return null;
      },
    );

    check("A2 the row is written inside the transaction that rewrites scope_gaps", () => {
      // An ABORT on the insert must take the whole reconciliation with it. The
      // blocked run is aimed at a *new* commit carrying a *new* unledgered
      // path, so a write that landed outside the transaction is visible twice
      // over: the gap rows would have been rebuilt against the new tree, and
      // last_checked_sha would have moved to the new revision. Run against the
      // same revision the fixture already reconciled at, both would come out
      // byte-identical and the assertion would pass over an insert that had
      // escaped the transaction entirely.
      const ws = ctx.project.workspacePath;
      writeFileSync(join(ws, "atomicity.ts"), "export const atomicity = true;\n");
      git(ws, "add", "atomicity.ts");
      gitCommit(ws, "a path the ledger does not carry, at a revision it has not seen");
      const gapsBefore = ctx.db.prepare("SELECT COUNT(*) AS n FROM scope_gaps").get().n;
      if (gapsBefore === 0) {
        return "the fixture left no scope_gaps row, so atomicity is untested here";
      }
      const shaBefore = ctx.db
        .prepare("SELECT last_checked_sha FROM git_state WHERE repo_id='default'")
        .get()?.last_checked_sha;
      ctx.db.exec(
        `CREATE TRIGGER sr1_block_reconciliation BEFORE INSERT ON scope_reconciliations
         FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'sr1 fixture blocks the insert'); END`,
      );
      let blocked = null;
      try {
        blocked = refusal(() => reconcile(ctx));
      } finally {
        ctx.db.exec("DROP TRIGGER IF EXISTS sr1_block_reconciliation");
      }
      if (!blocked) {
        return "detect_changes completed while an insert into scope_reconciliations was blocked, so it wrote no row inside that transaction";
      }
      const gapsAfter = ctx.db.prepare("SELECT COUNT(*) AS n FROM scope_gaps").get().n;
      if (gapsAfter !== gapsBefore) {
        return `the aborted run left ${gapsAfter} scope_gaps row(s) where ${gapsBefore} stood: the gap rewrite committed without the record of the reading that produced it`;
      }
      const shaAfter = ctx.db
        .prepare("SELECT last_checked_sha FROM git_state WHERE repo_id='default'")
        .get()?.last_checked_sha;
      if (shaAfter !== shaBefore) {
        return `the aborted run still moved git_state.last_checked_sha from ${shaBefore} to ${shaAfter}`;
      }
      return null;
    });

    check("A3 the row's counts agree with a re-derivation from git ls-tree at the revision", () => {
      const fresh = reconcile(ctx);
      if (fresh?.ok === false) return `detect_changes refused: ${fresh.error}`;
      const row = latestReconciliation(ctx);
      if (!row) return "detect_changes wrote no scope_reconciliations row to compare";
      const expected = derive(ctx, headSha(ctx));
      const wrong = [];
      for (const key of ["tracked_paths", "ledger_rows", "unledgered", "absent", "exempt"]) {
        if (row[key] !== expected[key]) {
          wrong.push(`${key}=${row[key]} but the tree gives ${expected[key]}`);
        }
      }
      notes.push(
        `the fixture reconciles ${expected.tracked_paths} tracked path(s) against ${expected.ledger_rows} ledger path(s): ${expected.unledgered} unledgered, ${expected.absent} absent, ${expected.exempt} exempt`,
      );
      return wrong.length === 0 ? null : wrong.join("; ");
    });

    check("A4 the row stores the resolved sha and both witness digests beside the counts", () => {
      const row = latestReconciliation(ctx);
      if (!row) return "detect_changes wrote no scope_reconciliations row";
      const expected = derive(ctx, headSha(ctx));
      const wrong = [];
      if (!/^[0-9a-f]{40}$/.test(String(row.detected_sha ?? ""))) {
        wrong.push(
          `detected_sha=${JSON.stringify(row.detected_sha)} is not a resolved 40-hex commit id`,
        );
      }
      if (row.tree_digest !== expected.tree_digest) {
        wrong.push(
          `tree_digest=${JSON.stringify(row.tree_digest)} is not SHA-256 over the sorted NUL-joined tracked path set`,
        );
      }
      if (row.ledger_digest !== expected.ledger_digest) {
        wrong.push(
          `ledger_digest=${JSON.stringify(row.ledger_digest)} is not SHA-256 over the sorted NUL-joined (path, classification) pairs`,
        );
      }
      return wrong.length === 0 ? null : wrong.join("; ");
    });
  }

  // ------------------------------------------- A5, A6: the table is append-only

  {
    const ctx = world("append-only");
    seedReconciliation(ctx, {
      detected_sha: headSha(ctx),
      tree_digest: digest(["a.ts", "b.ts"]),
      ledger_digest: digest([]),
      tracked_paths: 2,
    });

    check("A5 an UPDATE on a scope_reconciliations row is refused by the schema", () => {
      const denied = refusal(() =>
        ctx.db.prepare("UPDATE scope_reconciliations SET unledgered = 999").run(),
      );
      if (!denied) {
        return "a reconciliation row proved updatable; §3.2 ships scope_reconciliation_is_immutable and it is the trigger, not the paragraph, that makes the table append-only";
      }
      return /immutable/i.test(denied)
        ? null
        : `the UPDATE was refused, but not by the immutability trigger: ${denied}`;
    });

    check("A6 a DELETE on a scope_reconciliations row is refused by the schema", () => {
      const denied = refusal(() => ctx.db.prepare("DELETE FROM scope_reconciliations").run());
      if (!denied) {
        return "a reconciliation row proved deletable; §3.2 ships scope_reconciliation_cannot_be_deleted and a history that can be rewritten is not a record of when the map was checked";
      }
      return /cannot be deleted/i.test(denied)
        ? null
        : `the DELETE was refused, but not by the deletion trigger: ${denied}`;
    });
  }

  // ------------------------------ A7, A8: an abbreviation is resolved, not matched

  {
    const ctx = world("abbreviation");
    climbToAdversarial(ctx, "B-01", "a.ts");
    const full = headSha(ctx);
    const abbreviated = full.slice(0, 7);

    check("A7 detect_changes normalizes an abbreviated revision to its full 40-hex id", () => {
      const result = reconcile(ctx, abbreviated);
      if (result?.ok === false) {
        return `detect_changes refused an abbreviated revision: ${result.error}`;
      }
      const row = latestReconciliation(ctx);
      if (!row) return "detect_changes wrote no scope_reconciliations row";
      if (row.detected_sha !== full) {
        return `detected_sha=${JSON.stringify(row.detected_sha)} for a call made at ${abbreviated}; §3.3 clause 1 resolves the revision before any comparison`;
      }
      const stored = ctx.db
        .prepare("SELECT last_checked_sha FROM git_state WHERE repo_id='default'")
        .get()?.last_checked_sha;
      if (stored !== full) {
        return `git_state.last_checked_sha=${JSON.stringify(stored)}, not the resolved ${full}`;
      }
      const denied = advanceToMapped(ctx, "B-01");
      return denied === null
        ? null
        : `the store reconciled at ${abbreviated} refused the advance to mapped: ${denied}`;
    });
  }

  {
    const ctx = world("abbreviation-seeded");
    climbToAdversarial(ctx, "B-01", "a.ts");
    const full = headSha(ctx);

    check(
      "A8 a row whose detected_sha is an abbreviation does not satisfy a full-sha comparison",
      () => {
        seedReconciliation(ctx, { ...derive(ctx, full), detected_sha: full.slice(0, 7) });
        setLastCheckedSha(ctx, full.slice(0, 7));
        const denied = advanceToMapped(ctx, "B-01");
        if (!denied) {
          return "a reconciliation recorded at a 7-hex abbreviation satisfied the advance at the full sha; §3.3 clause 2 compares resolved 40-hex ids, never string prefixes";
        }
        return /has not been reconciled/.test(denied)
          ? null
          : `the advance was refused, but not as unreconciled: ${denied}`;
      },
    );
  }

  // ------------------------------- A9: duplicate ledger ownership is reported

  {
    const ctx = world("duplicate-ownership");
    climbToAdversarial(ctx, "B-01", "a.ts");
    climbToAdversarial(ctx, "B-02", "b.ts");
    call(
      "add_files_to_scope",
      {
        subsystem_id: "B-02",
        ref_sha: headSha(ctx),
        files: [{ file_path: "a.ts", why_in_scope: "a second owner for the same path" }],
      },
      ctx,
    );

    check("A9 a store with one path owned by two subsystems reconciles and says so", () => {
      const result = reconcile(ctx);
      if (result?.ok === false) return `detect_changes refused: ${result.error}`;
      const reported = JSON.stringify(result);
      const owners = ctx.db
        .prepare(
          "SELECT subsystem_id FROM file_ledger WHERE file_path='a.ts' ORDER BY subsystem_id",
        )
        .all()
        .map((r) => r.subsystem_id);
      if (owners.length !== 2) return `the fixture left ${owners.length} owner(s) of a.ts, not 2`;
      if (!/duplicate/i.test(reported)) {
        return `detect_changes reported nothing about duplicate ownership while a.ts is owned by ${owners.join(" and ")}; the AxiomDB store holds this for 53 of its 187 distinct paths, and a reconciliation silent about it is a reading that did not report its own ambiguity`;
      }
      if (!reported.includes('"a.ts"')) {
        return `detect_changes reported duplicate ownership without naming a.ts: ${scrub(reported).slice(0, 300)}`;
      }
      for (const owner of owners) {
        if (!reported.includes(`"${owner}"`)) {
          return `the duplicate-ownership report does not name ${owner}, so a reader cannot tell which two subsystems claim a.ts`;
        }
      }
      return null;
    });
  }

  // ------------------- A10, A11: the tree at R, never the index and never HEAD

  {
    const ctx = world("tree-not-index");
    climbToAdversarial(ctx, "B-01", "a.ts");
    const first = headSha(ctx);
    const ws = ctx.project.workspacePath;
    writeFileSync(join(ws, "c.ts"), "export const c = 3;\n");
    git(ws, "add", "c.ts");
    gitCommit(ws, "grow");
    const second = headSha(ctx);
    // The index and the tree now disagree in both directions: `d.ts` is staged
    // and never committed, `a.ts` is dropped from the index and still in HEAD.
    writeFileSync(join(ws, "d.ts"), "export const d = 4;\n");
    git(ws, "add", "d.ts");
    git(ws, "rm", "--cached", "-q", "a.ts");

    check("A10 the reconciliation enumerates the tree at the revision, not the index", () => {
      const index = new Set(git(ws, "ls-files").split("\n").filter(Boolean));
      const tree = new Set(treeAt(ctx, second));
      if (index.has("a.ts") || !tree.has("a.ts")) {
        return "the fixture did not separate the index from the tree";
      }
      if (!index.has("d.ts") || tree.has("d.ts")) {
        return "the fixture did not stage an uncommitted path";
      }
      const result = reconcile(ctx, second);
      if (result?.ok === false) return `detect_changes refused: ${result.error}`;
      const row = latestReconciliation(ctx);
      if (!row) return "detect_changes wrote no scope_reconciliations row";
      if (row.tracked_paths !== tree.size) {
        return `tracked_paths=${row.tracked_paths} against a tree of ${tree.size} and an index of ${index.size}; git ls-files reads the working tree's staged state, which moves under an unrelated git add and does not describe the revision at all`;
      }
      if (row.tree_digest !== derive(ctx, second).tree_digest) {
        return "tree_digest is not the digest of the revision's own path set";
      }
      if (JSON.stringify(result).includes('"d.ts"')) {
        return "the reconciliation reported the staged-but-uncommitted d.ts as a tracked path";
      }
      return null;
    });

    check("A11 a reconciliation at an earlier revision enumerates that revision's tree", () => {
      const result = reconcile(ctx, first);
      if (result?.ok === false) return `detect_changes refused: ${result.error}`;
      const row = latestReconciliation(ctx);
      if (!row) return "detect_changes wrote no scope_reconciliations row";
      const expected = derive(ctx, first);
      if (row.detected_sha !== first) {
        return `detected_sha=${JSON.stringify(row.detected_sha)} for a reconciliation asked for at ${first}`;
      }
      if (
        row.tracked_paths !== expected.tracked_paths ||
        row.tree_digest !== expected.tree_digest
      ) {
        return `tracked_paths=${row.tracked_paths} and tree_digest for ${first} do not match that revision's tree (${expected.tracked_paths} path(s)); a coverage fraction stamped with a revision may only be taken over that revision's tree`;
      }
      return null;
    });
  }

  // ------------------- A12: a reconciliation goes stale under a ledger mutation

  {
    const ctx = world("stale-under-mutation");
    climbToAdversarial(ctx, "B-01", "a.ts");
    climbToAdversarial(ctx, "B-02", "b.ts");

    check("A12 a standing reconciliation stops standing once the ledger is mutated under it", () => {
      const result = reconcile(ctx);
      if (result?.ok === false) return `detect_changes refused: ${result.error}`;
      const first = advanceToMapped(ctx, "B-01");
      if (first !== null) return `the reconciled store refused the first advance: ${first}`;
      // The ordinary case: a later add_files_to_scope changes the ledger the
      // row claims to describe, without touching the row.
      call(
        "add_files_to_scope",
        {
          subsystem_id: "B-01",
          ref_sha: headSha(ctx),
          files: [{ file_path: "b.ts", why_in_scope: "a path added after the reconciliation" }],
        },
        ctx,
      );
      const denied = advanceToMapped(ctx, "B-02");
      if (!denied) {
        return "the advance stood on a reconciliation whose ledger had changed under it; §3.3 condition 5 re-derives ledger_digest, so a store edited since it last checked itself against the tree has not checked itself against the tree";
      }
      if (!/has not been reconciled/.test(denied)) {
        return `the advance was refused, but not as unreconciled: ${denied}`;
      }
      // …and running detect_changes again restores it.
      const again = reconcile(ctx);
      if (again?.ok === false) return `the second detect_changes refused: ${again.error}`;
      const restored = advanceToMapped(ctx, "B-02");
      return restored === null
        ? null
        : `a fresh detect_changes did not restore the advance: ${restored}`;
    });
  }

  // ---------------------------- A13: a forged row does not stand for a reading

  {
    const ctx = world("forged");
    climbToAdversarial(ctx, "B-01", "a.ts");
    climbToAdversarial(ctx, "B-02", "b.ts");
    const sha = headSha(ctx);

    check("A13 a row whose digests do not re-derive is not a standing reconciliation", () => {
      const derived = derive(ctx, sha);
      seedReconciliation(ctx, {
        ...derived,
        detected_sha: sha,
        tree_digest: digest(["a.ts", "b.ts", "a path the tree never carried"]),
      });
      setLastCheckedSha(ctx, sha);
      const treeDenied = advanceToMapped(ctx, "B-01");
      if (!treeDenied) {
        return "a row carrying a tree_digest the revision does not produce satisfied the advance; §3.3 condition 4 re-derives it";
      }
      seedReconciliation(ctx, {
        ...derived,
        detected_sha: sha,
        ledger_digest: digest(["a ledger this store never held"]),
      });
      const ledgerDenied = advanceToMapped(ctx, "B-02");
      if (!ledgerDenied) {
        return "a row carrying a ledger_digest the ledger does not produce satisfied the advance; §3.3 condition 5 re-derives it";
      }
      return null;
    });
  }

  // -------------------- A14, C2: the advance to `mapped`, and the one below it

  {
    const ctx = world("advance");

    check("C2 the advance to structural does not refuse an unreconciled store", () => {
      climbToAdversarial(ctx, "B-01", "a.ts");
      if (statusOf(ctx, "B-01") !== "adversarial") {
        return `the climb stopped at ${JSON.stringify(statusOf(ctx, "B-01"))}; §3.3 refuses mapped, and the reconciliation is a whole-store fact that belongs at the whole-store claim`;
      }
      if (reconciliationRows(ctx).length !== 0) {
        return "the climb wrote a reconciliation row, so this control proves nothing";
      }
      return null;
    });

    check("A14 the advance to mapped refuses an unreconciled store, and names the repair", () => {
      const denied = advanceToMapped(ctx, "B-01");
      if (!denied) {
        return "an unreconciled store advanced to mapped; mapped is the status that licenses 'fully surveyed' and a subsystem cannot reach it while the store cannot say what the inventory was";
      }
      const wrong = [];
      if (!/has not been reconciled/.test(denied)) {
        wrong.push("it does not say the store is unreconciled");
      }
      if (!/detect_changes/.test(denied)) wrong.push("it does not name detect_changes as the repair");
      if (!denied.includes(headSha(ctx))) {
        wrong.push("it does not name the revision it wanted reconciled");
      }
      if (statusOf(ctx, "B-01") === "mapped") wrong.push("the refusal still left the subsystem mapped");
      return wrong.length === 0 ? null : `${wrong.join("; ")} — ${denied}`;
    });
  }

  // ------------------- A15, A16, A17, C3: publication is the whole-store claim

  /**
   * Every published byte, as one digest. A refused publication must leave the
   * previous output exactly as it found it, which is the treatment a red
   * read-back already gets (src/tools/materialize.ts, §3.3).
   */
  function publishedState(dir) {
    if (!existsSync(dir)) return "absent";
    const parts = [];
    const walk = (at, prefix) => {
      for (const entry of readdirSync(at, { withFileTypes: true }).sort((x, y) =>
        x.name < y.name ? -1 : 1,
      )) {
        const path = join(at, entry.name);
        if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
        else {
          parts.push(
            `${prefix}${entry.name}:${createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12)}`,
          );
        }
      }
    };
    walk(dir, "");
    return parts.length === 0 ? "empty" : parts.join(",");
  }

  {
    const ctx = world("publish-unreconciled", { "a.ts": "export const a = 1;\n" });
    climbToAdversarial(ctx, "B-01", "a.ts");
    const docs = join(ctx.project.storagePath, "docs");

    check("A15 materialize_docs refuses an unreconciled store before it renders", () => {
      const summary = call("materialize_docs", { output_dir: "docs", clean_publish: true }, ctx);
      if (summary?.ok !== false) {
        return `the publication went ahead over an unreconciled ledger: ${scrub(JSON.stringify(summary)).slice(0, 240)}`;
      }
      const message = String(summary.error ?? "");
      const wrong = [];
      if (!/has not been reconciled/.test(message)) {
        wrong.push("the refusal does not say the store is unreconciled");
      }
      if (!/detect_changes/.test(message)) {
        wrong.push("it does not name detect_changes as the repair");
      }
      if (!message.includes(headSha(ctx))) {
        wrong.push("it does not name the revision being published");
      }
      if (summary.published === true) {
        wrong.push("the refused publish promoted its staging directory");
      }
      const state = publishedState(docs);
      if (state !== "absent" && state !== "empty") {
        wrong.push(`it rendered anyway: ${state.slice(0, 160)}`);
      }
      return wrong.length === 0 ? null : `${wrong.join("; ")} — ${scrub(message)}`;
    });
  }

  {
    // A store entitled to publish, that then stops being entitled to. The first
    // publication is what gives A16 and A17 a previous output to protect.
    const ctx = world("publish-standing", { "a.ts": "export const a = 1;\n" });
    climbToAdversarial(ctx, "B-01", "a.ts");
    const docs = join(ctx.project.storagePath, "docs");
    let standing = null;

    check("A16 a reconciliation at revision A does not satisfy a publication at revision B", () => {
      const a = headSha(ctx);
      const first = reconcile(ctx, a);
      if (first?.ok === false) return `detect_changes refused: ${first.error}`;
      const opening = call("materialize_docs", { output_dir: "docs", clean_publish: true }, ctx);
      if (opening?.ok !== true || opening.published !== true) {
        return `the reconciled store did not publish, so there is no previous output to protect: ${scrub(JSON.stringify(opening)).slice(0, 300)}`;
      }
      standing = publishedState(docs);
      if (standing === "absent" || standing === "empty") {
        return "the publication promoted nothing into the output directory";
      }
      const ws = ctx.project.workspacePath;
      writeFileSync(join(ws, "c.ts"), "export const c = 3;\n");
      git(ws, "add", "c.ts");
      gitCommit(ws, "a second commit, published without a second reconciliation");
      const b = headSha(ctx);
      if (a === b) return "the fixture did not move HEAD";
      const summary = call("materialize_docs", { output_dir: "docs", clean_publish: true }, ctx);
      if (summary?.ok !== false) {
        return `a reconciliation at ${a.slice(0, 7)} published a projection stamped ${b.slice(0, 7)}: ${scrub(JSON.stringify(summary)).slice(0, 240)}`;
      }
      const message = String(summary.error ?? "");
      const wrong = [];
      if (!message.includes(b)) {
        wrong.push(`the refusal does not name the revision being published (${b})`);
      }
      if (!message.includes(a)) {
        wrong.push(`it does not name where the store was last reconciled (${a})`);
      }
      const now = publishedState(docs);
      if (now !== standing) wrong.push("it altered the previous output");
      return wrong.length === 0 ? null : `${wrong.join("; ")} — ${scrub(message)}`;
    });

    check("A17 a correct but nonzero unledgered count does not publish", () => {
      const result = reconcile(ctx);
      if (result?.ok === false) return `detect_changes refused: ${result.error}`;
      const row = latestReconciliation(ctx);
      if (!row) return "detect_changes wrote no scope_reconciliations row";
      if (row.unledgered === 0) {
        return "the fixture left nothing unledgered, so this assertion proves nothing";
      }
      const summary = call("materialize_docs", { output_dir: "docs", clean_publish: true }, ctx);
      if (summary?.ok !== false) {
        return `a store whose standing reconciliation reports ${row.unledgered} unledgered path(s) published a coverage fraction over a tree nobody inventoried: ${scrub(JSON.stringify(summary)).slice(0, 240)}`;
      }
      const message = String(summary.error ?? "");
      const wrong = [];
      if (/has not been reconciled/.test(message)) {
        wrong.push(
          "the store was refused as unreconciled; §3.3a's refusal is a different one, about a reading that came out unclean",
        );
      }
      if (!/no ledger row/.test(message)) {
        wrong.push("the refusal does not report the unledgered count");
      }
      if (!/ADR-0001/.test(message)) wrong.push("it does not cite the clause it enforces");
      if (standing !== null && publishedState(docs) !== standing) {
        wrong.push("it altered the previous output");
      }
      return wrong.length === 0 ? null : `${wrong.join("; ")} — ${scrub(message)}`;
    });
  }

  {
    const ctx = world("advance-nonzero-gap");
    climbToAdversarial(ctx, "B-01", "a.ts");

    check("C3 the advance to mapped stands on a correct but nonzero unledgered count", () => {
      const result = reconcile(ctx);
      if (result?.ok === false) return `detect_changes refused: ${result.error}`;
      const row = latestReconciliation(ctx);
      if (!row) return "detect_changes wrote no scope_reconciliations row";
      if (row.unledgered === 0) {
        return "the fixture left nothing unledgered, so this control proves nothing";
      }
      const denied = advanceToMapped(ctx, "B-01");
      return denied === null
        ? null
        : `a subsystem was held hostage to a path in another subsystem's territory: ADR-0001's per-subsystem clause is clause 2, and README §4 requires a rebuild to progress subsystem by subsystem — ${denied}`;
    });
  }

  // ------------------------------------------ C1: the must-stay-green control

  {
    // Every tracked path is ledgered, so the standing reconciliation reports
    // zero unledgered and zero absent: §3.3a's clause-1 store.
    const ctx = world("control", { "a.ts": "export const a = 1;\n" });
    climbToAdversarial(ctx, "B-01", "a.ts");

    check("C1 a reconciled, complete store advances to mapped and publishes", () => {
      const result = reconcile(ctx);
      if (result?.ok === false) return `detect_changes refused: ${result.error}`;
      const row = latestReconciliation(ctx);
      if (!row) return "detect_changes wrote no scope_reconciliations row";
      if (row.unledgered !== 0 || row.absent !== 0) {
        return `the control fixture reconciles to ${row.unledgered} unledgered and ${row.absent} absent, so it is not the clause-1 store this control needs`;
      }
      const denied = advanceToMapped(ctx, "B-01");
      if (denied !== null) {
        return `the reconciled, complete store refused the advance to mapped: ${denied}`;
      }
      const summary = call("materialize_docs", { output_dir: "docs", clean_publish: true }, ctx);
      if (summary?.ok !== true || summary.published !== true) {
        return `the reconciled, complete store did not publish: ${scrub(JSON.stringify(summary)).slice(0, 400)}`;
      }
      if (summary.readback && summary.readback.ok !== true) {
        return `the publication's read-back was red: ${scrub(JSON.stringify(summary.readback)).slice(0, 300)}`;
      }
      notes.push(
        `the control published ${row.tracked_paths} tracked path(s) with a standing reconciliation at ${String(row.detected_sha).slice(0, 7)}`,
      );
      return null;
    });
  }

  // ------------------- A18: the table arrives on the next open of an older store

  {
    const ctx = world("migration");
    climbToAdversarial(ctx, "B-01", "a.ts");
    reconcile(ctx);
    const census = () =>
      ["file_ledger", "dispositions", "claims", "evidence", "subsystems"]
        .map((table) => {
          const rows = ctx.db.prepare(`SELECT * FROM ${table}`).all();
          return `${table}:${rows.length}:${createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16)}`;
        })
        .join(",");

    check("A18 an existing store gains the table on its next open, with no domain row rewritten", () => {
      const before = census();
      const dbPath = ctx.project.dbPath;
      // The shape of a store written before this packet: the table is simply
      // not there. Dropped rather than simulated, so the next open is the real
      // migration path (src/db.ts:84-89).
      ctx.db.exec("DROP TABLE IF EXISTS scope_reconciliations");
      ctx.db.close();
      let reopened;
      try {
        reopened = openDatabase(dbPath);
      } catch (error) {
        return `re-opening a store without the table threw: ${scrub(error?.message ?? error)}`;
      }
      const present = reopened
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='scope_reconciliations'",
        )
        .get();
      const triggers = reopened
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'scope_reconciliation%' ORDER BY name",
        )
        .all()
        .map((r) => r.name);
      reopened.close();
      try {
        // The second open of the same store: bare DDL in schema.sql throws here
        // (src/db.ts:85-88), which is what `IF NOT EXISTS` throughout prevents.
        ctx.db = openDatabase(dbPath);
      } catch (error) {
        return `a second open of the same store threw, which is what bare CREATE in schema.sql does: ${scrub(error?.message ?? error)}`;
      }
      const after = census();
      const wrong = [];
      if (!present) {
        wrong.push("initializeSchema did not create scope_reconciliations on the next open");
      }
      for (const name of [
        "scope_reconciliation_is_immutable",
        "scope_reconciliation_cannot_be_deleted",
      ]) {
        if (!triggers.includes(name)) wrong.push(`the open left ${name} absent`);
      }
      if (after !== before) wrong.push(`domain rows changed across the open: ${before} became ${after}`);
      return wrong.length === 0 ? null : wrong.join("; ");
    });
  }

  // ----------------------------------------------------------------- CI1: in CI

  check("CI1 this gate runs in CI (spec.md §8)", () => {
    const workflow = join(here, "..", ".github", "workflows", "test.yml");
    if (!existsSync(workflow)) return ".github/workflows/test.yml is absent";
    return readFileSync(workflow, "utf8").includes("node test-scope-reconciliation.mjs")
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
    const [
      artifacts,
      claims,
      concerns,
      dispositions,
      evidence,
      files,
      gitModule,
      materialize,
      project,
      subsystems,
      vocabulary,
    ] = await Promise.all([
      import("./dist/tools/artifacts.js"),
      import("./dist/tools/claims.js"),
      import("./dist/tools/concerns.js"),
      import("./dist/tools/dispositions.js"),
      import("./dist/tools/evidence.js"),
      import("./dist/tools/files.js"),
      import("./dist/tools/git.js"),
      import("./dist/tools/materialize.js"),
      import("./dist/tools/project.js"),
      import("./dist/tools/subsystems.js"),
      import("./dist/tools/vocabulary.js"),
    ]);
    mods.toolArrays = [
      artifacts.artifactTools,
      claims.claimTools,
      concerns.concernTools,
      dispositions.dispositionTools,
      evidence.evidenceTools,
      files.fileTools,
      gitModule.gitTools,
      materialize.materializeTools,
      project.projectTools,
      subsystems.subsystemTools,
      vocabulary.vocabularyTools,
    ];
  } catch (error) {
    failures.push(`L1 the server build could not be loaded: ${scrub(error?.message ?? error)}`);
  }

  if (failures.length === 0) {
    if (typeof mods.openDatabase !== "function") {
      failures.push("L1 dist/db.js does not export openDatabase");
    } else if (!Array.isArray(mods.toolArrays)) {
      failures.push("L1 the tool arrays could not be read from dist/tools");
    } else {
      main(mods);
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
    "GATE P2 RED: GATE SR1 RED: the store was not reconciled at the published revision — " +
      "detect_changes wrote no append-only reading of the tree at R, or wrote one whose counts, " +
      "digests or resolved sha do not re-derive, or the advance to 'mapped' and materialize_docs " +
      `took a store that has no standing reconciliation — ${failures.length} of ${checked} ` +
      `assertion(s) failed; first: ${failures[0]}`,
  );
  exitCode = 1;
} else {
  console.log("GATE P2 GREEN");
}
process.exit(exitCode);
