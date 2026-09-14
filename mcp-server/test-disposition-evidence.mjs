#!/usr/bin/env node
// GATE SD1 (spec.md §8.1) — packet P1 of the survey-depth lane.
//
// A disposition is how a concern was answered. Today `set_disposition` takes a
// free-text citation and writes nothing to `disposition_evidence`
// (src/tools/dispositions.ts:85-118); the only writer of that table is
// `attach_evidence_to_disposition`, which nothing requires anyone to call, and
// 177 of the candidate store's 180 dispositions carry no attached row. §2.2
// makes `evidence_ids` a required input and writes the disposition and its
// attachments in one transaction; §2.3 refuses a status advance for a
// subsystem holding a disposition with no attached evidence row whose
// `ref_sha` still resolves.
//
// Two names appear below. `GATE SD1` is what spec.md §8.1 calls this gate;
// `GATE P1` is the packet id the launcher greps for. The status line carries
// both so neither reader has to translate.
//
//   exit 0  `GATE P1 GREEN`          — every assertion held
//   exit 1  `GATE P1 RED: <reason>`  — an assertion fired
//
// This gate has no third state: its inputs are a temporary git workspace and a
// store it creates itself, both of which every machine that can run the server
// can produce (spec.md §8.0 clause 3).
//
// Must-stay-green controls (VP4(f) — a kill proves a gate can fire, never that
// it fires selectively):
//   E6  an under-claimed evidence_quality is accepted
//   E7  a well-formed call writes the disposition and one attachment per id
//   A7  a disposition with one resolvable and one unreachable attachment
//       advances, and the unreachable one is reported rather than refused
//   A8  a subsystem whose dispositions are all attached advances to
//       `adversarial` and then to `mapped`, with nothing reported
//
// False greens it cannot exclude:
//   - Whether the attached evidence *supports* the disposition. This gate
//     establishes that the concern was answered against a reading someone can
//     open at a revision that resolves — not that the answer is right.
//   - The refusal is **vacuous at the advance to `concerns`**: a subsystem
//     reaching that rung ordinarily holds zero dispositions, and a rule with an
//     empty domain refuses nothing. The first real bite is at `adversarial`,
//     whose existing prerequisite is ≥1 disposition. A2 below still drives the
//     `concerns` rung, against a disposition seeded by SQL at `structural`
//     depth — a state no tool can write — so the code path is asserted rather
//     than assumed, while the ordinary-case vacuity stands as stated.
//   - A disposition whose attachments all resolve today can be rewritten out of
//     reach tomorrow. The check is live at each advance, not durable.
//
// What a reviewer should sabotage, and what must go red:
//   drop `evidence_ids` from set_disposition's required list      → S1, E1
//   accept an unknown or unreachable evidence id                  → E3, E4
//   drop the evidence_quality ladder comparison                   → E5
//   write the disposition outside the transaction                 → E8
//   drop the §2.3 check from enforcePhasePrerequisites            → A1..A6
//   refuse a disposition that still has one resolvable attachment  → A7
//   resolve one revision per evidence row instead of in one batch  → B1, B3

import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
  const { openDatabase, resolveProject, ensureProjectStorage, invariants, toolArrays } = mods;

  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  function call(name, args, ctx) {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    return td.handler(args, ctx);
  }

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-sd1-"));
  const cleanups = [];

  // The real git, captured before any shim is put on PATH (B1/B3 install one).
  const REAL_GIT = String(
    spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout ?? "",
  ).trim();

  function git(cwd, ...args) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return String(result.stdout ?? "").trim();
  }
  function gitCommit(cwd, message) {
    spawnSync(
      "git",
      [
        "-c", "user.email=sd1@localhost",
        "-c", "user.name=survey-depth-sd1",
        "-c", "commit.gpgsign=false",
        "commit", "-q", "--no-verify", "-m", message,
      ],
      { cwd, encoding: "utf8" },
    );
  }

  /**
   * A fresh workspace, store and open session. Every assertion that writes gets
   * its own, so a refusal in one cannot be explained by a row another left.
   */
  function world(label) {
    const ws = join(scratch, `ws-${label}`);
    mkdirSync(ws, { recursive: true });
    git(ws, "init", "-q");
    writeFileSync(join(ws, "seed.ts"), `export const seed = "${label}";\n`);
    git(ws, "add", "seed.ts");
    gitCommit(ws, "seed");
    const project = resolveProject(ws, { selectionSource: "sd1-disposition-evidence" });
    ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
    const db = openDatabase(project.dbPath);
    const ctx = { project, db, sessionId: null };
    cleanups.push(() => {
      try {
        db.close();
      } catch {
        /* the assertion already reported whatever broke */
      }
      rmSync(project.storagePath, { recursive: true, force: true });
    });
    ctx.sessionId = call("start_session", { intent: `sd1-${label}` }, ctx).session_id;
    return ctx;
  }

  const headSha = (ctx) => git(ctx.project.workspacePath, "rev-parse", "HEAD");

  /**
   * A real commit object that no ref points at, then pruned: the state §2.3
   * exists for — a reading recorded at a revision the repository later lost.
   *
   * Seeded this way rather than by writing a fabricated sha into `evidence`,
   * because `add_evidence` resolves `ref_sha` at ingress (src/tools/evidence.ts:50)
   * and a row it would never have written proves nothing about a row it did.
   * No ref moves and no history is rewritten: `commit-tree` writes an object
   * nothing references, and `prune --expire=now` collects it.
   */
  function evidenceAtLostRevision(ctx, filePath, note) {
    const ws = ctx.project.workspacePath;
    const tree = git(ws, "rev-parse", "HEAD^{tree}");
    const lost = String(
      spawnSync(
        "git",
        [
          "-c", "user.email=sd1@localhost",
          "-c", "user.name=survey-depth-sd1",
          "commit-tree", tree, "-m", `reading recorded here: ${note}`,
        ],
        { cwd: ws, encoding: "utf8" },
      ).stdout ?? "",
    ).trim();
    const id = call(
      "add_evidence",
      { file_path: filePath, symbol: "Unit", line_range: "1-4", ref_sha: lost, kind: "code-verified" },
      ctx,
    ).id;
    return { id, sha: lost };
  }
  const collectLostCommits = (ctx) => git(ctx.project.workspacePath, "prune", "--expire=now");

  function addEvidence(ctx, filePath, kind = "code-verified") {
    return call(
      "add_evidence",
      {
        file_path: filePath,
        symbol: "Unit",
        line_range: "1-4",
        ref_sha: headSha(ctx),
        kind,
      },
      ctx,
    ).id;
  }

  let seededClaims = 0;
  function seedClaim(ctx, id) {
    const filePath = `src/${id}/index.ts`;
    seededClaims += 1;
    call(
      "add_claim",
      {
        claim_id: `SD1-CL-${seededClaims}`,
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

  /** The §3.3 reconciliation the advance to `mapped` requires (P2). */
  function reconcileStore(ctx) {
    const sha = headSha(ctx);
    if (!ctx.db.prepare("SELECT 1 FROM git_state WHERE repo_id='default'").get()) {
      call("set_git_state", { canonical_branch: "main", onboarding_sha: sha }, ctx);
    }
    call("detect_changes", { current_sha: sha }, ctx);
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
          challenge: "fixture probe: read the declaration and found nothing that would overturn it",
          ref_sha: headSha(ctx),
        },
        ctx,
      );
    }
  }

  /** Climb to `concerns` without writing a disposition of any kind. */
  function climbToConcerns(ctx, id) {
    const filePath = `src/${id}/index.ts`;
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
    seedClaim(ctx, id);
    call("update_subsystem_status", { id, status: "structural" }, ctx);
    call("register_artifact", { path: `${id}-survey.md`, kind: "subsystem-survey", subsystem_id: id }, ctx);
    call("update_subsystem_status", { id, status: "concerns" }, ctx);
    return filePath;
  }

  function addConcern(ctx, code) {
    call("add_concern", { code, category: "cache", origin: "seeded" }, ctx);
    return code;
  }

  function disposition(ctx, id, code, extra = {}) {
    return {
      subsystem_id: id,
      concern_code: code,
      classification: "ruled-out",
      evidence: `src/${id}/index.ts:Unit@${headSha(ctx)}`,
      evidence_quality: "code-verified",
      linchpin_dependent: false,
      rationale: "fixture disposition",
      ref_sha: headSha(ctx),
      pass_type: "survey",
      ...extra,
    };
  }

  const dispositionRow = (ctx, id, code) =>
    ctx.db
      .prepare("SELECT * FROM dispositions WHERE subsystem_id = ? AND concern_code = ?")
      .get(id, code) ?? null;
  const attachments = (ctx, id, code) =>
    ctx.db
      .prepare(
        "SELECT evidence_id, role FROM disposition_evidence WHERE subsystem_id = ? AND concern_code = ? ORDER BY evidence_id",
      )
      .all(id, code);
  const statusOf = (ctx, id) =>
    ctx.db.prepare("SELECT status FROM subsystems WHERE id = ?").get(id)?.status ?? null;

  /**
   * Seed a `dispositions` row by SQL. Used only where the tool cannot write the
   * state under test: a disposition held by a `structural` subsystem (A2), and
   * an unattached disposition after §2.2 makes attachment mandatory (A1, A3..A6).
   */
  function seedDispositionRow(ctx, id, code, quality = "code-verified") {
    ctx.db
      .prepare(
        `INSERT INTO dispositions
           (subsystem_id, concern_code, classification, evidence, evidence_quality,
            linchpin_dependent, rationale, ref_sha, session_id, pass_type)
         VALUES (?, ?, 'ruled-out', ?, ?, 0, 'seeded by the gate', ?, ?, 'survey')
         ON CONFLICT(subsystem_id, concern_code) DO UPDATE SET evidence_quality = excluded.evidence_quality`,
      )
      .run(
        id,
        code,
        `src/${id}/index.ts:Unit@${headSha(ctx)}`,
        quality,
        headSha(ctx),
        ctx.sessionId,
      );
  }
  function attachRow(ctx, id, code, evidenceId, role = "supports") {
    ctx.db
      .prepare(
        `INSERT INTO disposition_evidence (subsystem_id, concern_code, evidence_id, role)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(subsystem_id, concern_code, evidence_id) DO UPDATE SET role = excluded.role`,
      )
      .run(id, code, evidenceId, role);
  }

  /**
   * Run `fn` with a `git` shim first on PATH that records every invocation.
   * C37's claim is about the number of subprocesses, so it is measured rather
   * than read off the source: a resolver that spawns one `rev-parse` per
   * evidence id and a resolver that spawns one `cat-file --batch-check` for all
   * of them are indistinguishable from their results alone.
   */
  function gitInvocationsDuring(fn) {
    const bin = mkdtempSync(join(scratch, "gitshim-"));
    const log = join(bin, "invocations.log");
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(REAL_GIT)} "$@"\n`,
    );
    chmodSync(join(bin, "git"), 0o755);
    const priorPath = process.env.PATH;
    process.env.PATH = `${bin}:${priorPath}`;
    let thrown = null;
    try {
      fn();
    } catch (error) {
      thrown = error;
    } finally {
      process.env.PATH = priorPath;
    }
    const lines = existsSync(log)
      ? readFileSync(log, "utf8").split("\n").filter((line) => line.length > 0)
      : [];
    return { lines, thrown };
  }

  // ------------------------------------------------------------------ S1: surface

  check("S1 set_disposition advertises evidence_ids as a required integer array", () => {
    const schema = allTools.get("set_disposition")?.inputSchema;
    if (!schema) return "set_disposition is absent from the tool arrays";
    const property = schema.properties?.evidence_ids;
    const required = Array.isArray(schema.required) ? schema.required : [];
    const problems = [];
    if (!property) problems.push("evidence_ids is not a declared property");
    else {
      if (property.type !== "array") problems.push(`evidence_ids is declared ${property.type}, not array`);
      if (property.items?.type !== "integer") problems.push("evidence_ids items are not integers");
      if (property.minItems !== 1) problems.push(`minItems is ${property.minItems}, not 1`);
    }
    if (!required.includes("evidence_ids")) problems.push("evidence_ids is not in required");
    // A client validating against this schema must still be able to send the
    // unchanged inputs, so the widening may not drop what was required before.
    for (const key of ["evidence", "evidence_quality", "rationale", "ref_sha"]) {
      if (!required.includes(key)) problems.push(`${key} is no longer required`);
    }
    return problems.length === 0
      ? null
      : `the advertised schema does not carry §2.2's input: ${problems.join("; ")}`;
  });

  // ------------------------------------------------- E1..E9: the write contract

  {
    const ctx = world("write");
    climbToConcerns(ctx, "B-01");
    addConcern(ctx, "CC-1");
    addConcern(ctx, "CC-2");
    addConcern(ctx, "CC-3");
    addConcern(ctx, "CC-4");
    addConcern(ctx, "CC-5");
    addConcern(ctx, "CC-6");
    const strong = addEvidence(ctx, "src/B-01/index.ts", "code-verified");
    const weak = addEvidence(ctx, "src/B-01/index.ts", "doc-asserted");
    const lost = evidenceAtLostRevision(ctx, "src/B-01/index.ts", "B-01 write contract");
    collectLostCommits(ctx);

    const leftNothing = (code) => {
      const row = dispositionRow(ctx, "B-01", code);
      const rows = attachments(ctx, "B-01", code);
      if (row) return `the refused call left a dispositions row for B-01/${code}`;
      if (rows.length > 0) return `the refused call left ${rows.length} attachment(s) for B-01/${code}`;
      return null;
    };

    check("E1 a call with no evidence_ids is refused, and leaves neither row behind", () => {
      const message = refusal(() => call("set_disposition", disposition(ctx, "B-01", "CC-1"), ctx));
      if (message === null) {
        return "set_disposition accepted a disposition with no evidence_ids: the concern was answered from nothing and the server took it";
      }
      if (!message.includes("requires at least one evidence_id")) {
        return `the refusal does not name §2.2's requirement: ${message}`;
      }
      return leftNothing("CC-1");
    });

    check("E2 an empty evidence_ids array is refused the same way", () => {
      const message = refusal(() =>
        call("set_disposition", disposition(ctx, "B-01", "CC-2", { evidence_ids: [] }), ctx),
      );
      if (message === null) return "set_disposition accepted evidence_ids: []";
      if (!message.includes("requires at least one evidence_id")) {
        return `the refusal does not name §2.2's requirement: ${message}`;
      }
      return leftNothing("CC-2");
    });

    check("E3 an unknown evidence id is refused, naming it, and leaves neither row behind", () => {
      const absent = 99_001;
      const message = refusal(() =>
        call(
          "set_disposition",
          disposition(ctx, "B-01", "CC-3", { evidence_ids: [strong, absent] }),
          ctx,
        ),
      );
      if (message === null) return `set_disposition accepted evidence id ${absent}, which names no row`;
      if (!message.includes(String(absent))) return `the refusal does not name id ${absent}: ${message}`;
      return leftNothing("CC-3");
    });

    check("E4 an id whose ref_sha no longer resolves is refused, naming the row and the sha", () => {
      const message = refusal(() =>
        call(
          "set_disposition",
          disposition(ctx, "B-01", "CC-4", { evidence_ids: [strong, lost.id] }),
          ctx,
        ),
      );
      if (message === null) {
        return `set_disposition accepted evidence row ${lost.id}, whose revision ${lost.sha.slice(0, 12)} the repository no longer holds`;
      }
      if (!message.includes(String(lost.id)) || !message.includes(lost.sha)) {
        return `the refusal names neither the row nor its revision: ${message}`;
      }
      if (!message.includes("does not resolve to a commit in the bound workspace")) {
        return `the refusal does not use §2.2's wording: ${message}`;
      }
      return leftNothing("CC-4");
    });

    check("E5 an evidence_quality stronger than the strongest attached kind is refused", () => {
      const message = refusal(() =>
        call(
          "set_disposition",
          disposition(ctx, "B-01", "CC-5", {
            evidence_ids: [weak],
            evidence_quality: "code-verified",
          }),
          ctx,
        ),
      );
      if (message === null) {
        return "set_disposition accepted evidence_quality 'code-verified' over a single 'doc-asserted' attachment: the disposition over-claims its own evidence";
      }
      if (!message.includes("code-verified") || !message.includes("doc-asserted")) {
        return `the refusal names neither the claim nor the attached kind: ${message}`;
      }
      if (!message.includes("Lower the claim or attach the stronger reading")) {
        return `the refusal does not use §2.2's wording: ${message}`;
      }
      return leftNothing("CC-5");
    });

    check("E6 control: an under-claimed evidence_quality is accepted", () => {
      const result = call(
        "set_disposition",
        disposition(ctx, "B-01", "CC-6", {
          evidence_ids: [strong],
          evidence_quality: "doc-asserted",
        }),
        ctx,
      );
      if (!result?.ok) return `a disposition may under-claim; this one was refused: ${scrub(JSON.stringify(result))}`;
      const row = dispositionRow(ctx, "B-01", "CC-6");
      return row?.evidence_quality === "doc-asserted"
        ? null
        : `the accepted under-claim stored evidence_quality ${row?.evidence_quality}`;
    });
  }

  {
    const ctx = world("accept");
    climbToConcerns(ctx, "B-01");
    addConcern(ctx, "CC-1");
    addConcern(ctx, "CC-2");
    const first = addEvidence(ctx, "src/B-01/index.ts", "code-verified");
    const second = addEvidence(ctx, "src/B-01/index.ts", "test-observed");
    const third = addEvidence(ctx, "src/B-01/index.ts", "code-verified");

    check("E7 control: a well-formed call writes the disposition and one attachment per id", () => {
      const result = call(
        "set_disposition",
        disposition(ctx, "B-01", "CC-1", { evidence_ids: [first, second] }),
        ctx,
      );
      if (!result?.ok) return `the well-formed call was refused: ${scrub(JSON.stringify(result))}`;
      const row = dispositionRow(ctx, "B-01", "CC-1");
      if (!row) return "the accepted call wrote no dispositions row";
      const rows = attachments(ctx, "B-01", "CC-1");
      if (rows.length !== 2) {
        return `2 evidence ids produced ${rows.length} disposition_evidence row(s): ${JSON.stringify(rows)}`;
      }
      const ids = rows.map((r) => r.evidence_id).join(",");
      if (ids !== [first, second].sort((a, b) => a - b).join(",")) {
        return `the attachments name ${ids}, not the ids the call passed`;
      }
      const roles = [...new Set(rows.map((r) => r.role))];
      return roles.length === 1 && roles[0] === "supports"
        ? null
        : `the attachments carry role(s) ${roles.join(", ")}, not 'supports'`;
    });

    check("E8 the disposition and its attachments are written in one transaction", () => {
      // A good disposition first, so the rollback has a prior state to preserve.
      call("set_disposition", disposition(ctx, "B-01", "CC-2", { evidence_ids: [first] }), ctx);
      const before = dispositionRow(ctx, "B-01", "CC-2");
      if (!before) return "the fixture disposition was not written, so the rollback has nothing to protect";
      // Refuse the attachment write from inside SQLite, which is the only way to
      // fail *after* the dispositions upsert has already run in the same call.
      ctx.db.exec(
        "CREATE TRIGGER sd1_refuse_attachment BEFORE INSERT ON disposition_evidence " +
          "FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'sd1 probe refuses the attachment'); END",
      );
      let message = null;
      try {
        message = refusal(() =>
          call(
            "set_disposition",
            disposition(ctx, "B-01", "CC-2", {
              // A third `code-verified` row, so nothing earlier in the handler
              // can refuse this call: the ladder check would have turned this
              // assertion vacuous — the write would never reach the attachment
              // the trigger is here to refuse, and a non-transactional
              // implementation would pass unnoticed.
              evidence_ids: [third],
              classification: "confirmed-bug",
              rationale: "the rewrite the rollback must undo",
            }),
            ctx,
          ),
        );
      } finally {
        ctx.db.exec("DROP TRIGGER sd1_refuse_attachment");
      }
      if (message === null) {
        return "the attachment insert was refused by SQLite and set_disposition still reported success";
      }
      if (!message.includes("sd1 probe refuses the attachment")) {
        return `the call was refused before it reached the attachment, so the rollback was never exercised: ${message}`;
      }
      const after = dispositionRow(ctx, "B-01", "CC-2");
      if (!after) return "the rollback removed the disposition the earlier accepted call had written";
      if (after.classification !== before.classification || after.rationale !== before.rationale) {
        return `the refused call left its rewrite behind: classification ${before.classification} became ${after.classification}`;
      }
      const rows = attachments(ctx, "B-01", "CC-2");
      return rows.length === 1 && rows[0].evidence_id === first
        ? null
        : `the refused call changed the attachments to ${JSON.stringify(rows)}`;
    });
  }

  // --------------------------------------------- A1..A8: the status-advance refusal

  {
    const ctx = world("advance-unattached");
    climbToConcerns(ctx, "B-01");
    addConcern(ctx, "CC-1");
    seedDispositionRow(ctx, "B-01", "CC-1");

    check("A1 an advance to 'adversarial' is refused while a disposition carries no attachment", () => {
      const message = refusal(() =>
        call("update_subsystem_status", { id: "B-01", status: "adversarial" }, ctx),
      );
      if (message === null) {
        return "a subsystem whose only disposition carries no attached evidence row advanced to 'adversarial': a disposition was answered from nothing and the advance published it";
      }
      if (!message.includes("answered from nothing")) {
        return `the refusal does not use §2.3's wording: ${message}`;
      }
      if (!message.includes("B-01/CC-1")) return `the refusal does not name the disposition: ${message}`;
      if (!message.includes("attach_evidence_to_disposition") || !message.includes("evidence_ids")) {
        return `the refusal does not name both repairs: ${message}`;
      }
      return statusOf(ctx, "B-01") === "concerns"
        ? null
        : `the refusal did not hold the write back: B-01 is now '${statusOf(ctx, "B-01")}'`;
    });

    check("A3 the same subsystem is refused at 'mapped', which walks every rung", () => {
      seedChallenges(ctx, "B-01");
      const message = refusal(() =>
        call("update_subsystem_status", { id: "B-01", status: "mapped" }, ctx),
      );
      if (message === null) return "the unattached disposition reached 'mapped' by jumping the rung that checks it";
      if (!message.includes("answered from nothing")) {
        return `the refusal does not use §2.3's wording: ${message}`;
      }
      return statusOf(ctx, "B-01") === "concerns"
        ? null
        : `the refusal did not hold the write back: B-01 is now '${statusOf(ctx, "B-01")}'`;
    });

    check("A5 enforcePhasePrerequisites refuses directly, so a third status writer cannot walk around it", () => {
      const enforce = invariants?.enforcePhasePrerequisites;
      if (typeof enforce !== "function") return "invariants.js does not export enforcePhasePrerequisites";
      const message = refusal(() =>
        enforce(ctx.db, "B-01", "adversarial", ctx.project.workspacePath),
      );
      if (message === null) {
        return "enforcePhasePrerequisites accepts a subsystem holding an unattached disposition, so the rule lives in the tool and any second status writer bypasses it";
      }
      return message.includes("answered from nothing")
        ? null
        : `enforcePhasePrerequisites refused for some other reason: ${message}`;
    });
  }

  {
    // Its own fixture: A1 and A3 leave B-01 wherever the implementation under
    // test put it, and `upsert_subsystem`'s refusal must be about the
    // attachment rule rather than about a monotonic regression.
    const ctx = world("advance-second-door");
    climbToConcerns(ctx, "B-01");
    addConcern(ctx, "CC-1");
    seedDispositionRow(ctx, "B-01", "CC-1");

    check("A4 upsert_subsystem — the second status door — is refused the same way", () => {
      const message = refusal(() =>
        call("upsert_subsystem", { id: "B-01", name: "B-01 fixture", status: "adversarial" }, ctx),
      );
      if (message === null) {
        return "upsert_subsystem writes subsystems.status directly and advanced past the check that update_subsystem_status enforces";
      }
      if (!message.includes("answered from nothing")) {
        return `the refusal does not use §2.3's wording: ${message}`;
      }
      return statusOf(ctx, "B-01") === "concerns"
        ? null
        : `the refusal did not hold the write back: B-01 is now '${statusOf(ctx, "B-01")}'`;
    });
  }

  {
    // §8.1's stated vacuity, asserted rather than assumed: the rung is driven
    // against a disposition no tool could have written at this depth.
    const ctx = world("advance-concerns");
    const filePath = `src/B-02/index.ts`;
    call("upsert_subsystem", { id: "B-02", name: "B-02 fixture", status: "unmapped" }, ctx);
    call("update_subsystem_status", { id: "B-02", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      { subsystem_id: "B-02", ref_sha: headSha(ctx), files: [{ file_path: filePath, why_in_scope: "fixture" }] },
      ctx,
    );
    seedClaim(ctx, "B-02");
    call("update_subsystem_status", { id: "B-02", status: "structural" }, ctx);
    call("register_artifact", { path: "B-02-survey.md", kind: "subsystem-survey", subsystem_id: "B-02" }, ctx);
    addConcern(ctx, "CC-1");
    seedDispositionRow(ctx, "B-02", "CC-1");

    check("A2 the advance to 'concerns' runs the check too, though it is ordinarily vacuous", () => {
      const message = refusal(() =>
        call("update_subsystem_status", { id: "B-02", status: "concerns" }, ctx),
      );
      if (message === null) {
        return "the check does not run at the advance to 'concerns', so §2.3's three target statuses are two";
      }
      if (!message.includes("answered from nothing") || !message.includes("B-02/CC-1")) {
        return `the refusal does not use §2.3's wording: ${message}`;
      }
      return statusOf(ctx, "B-02") === "structural"
        ? null
        : `the refusal did not hold the write back: B-02 is now '${statusOf(ctx, "B-02")}'`;
    });
  }

  {
    const ctx = world("advance-unreachable");
    const filePath = climbToConcerns(ctx, "B-01");
    addConcern(ctx, "CC-1");
    const lost = evidenceAtLostRevision(ctx, filePath, "B-01 sole attachment");
    seedDispositionRow(ctx, "B-01", "CC-1");
    attachRow(ctx, "B-01", "CC-1", lost.id);
    collectLostCommits(ctx);

    check("A6 a disposition whose only attachment's revision is unreachable is refused, naming it", () => {
      const message = refusal(() =>
        call("update_subsystem_status", { id: "B-01", status: "adversarial" }, ctx),
      );
      if (message === null) {
        return `a disposition resting only on revision ${lost.sha.slice(0, 12)}, which the repository no longer holds, advanced to 'adversarial'`;
      }
      if (!message.includes("no longer reachable")) {
        return `the refusal does not use §2.3's second wording: ${message}`;
      }
      if (!message.includes(`B-01/CC-1@${lost.sha}`)) {
        return `the refusal does not name B-01/CC-1@<sha>: ${message}`;
      }
      if (message.includes("answered from nothing")) {
        return `an attached-but-unreachable disposition was reported as unattached, and the two repairs differ: ${message}`;
      }
      return statusOf(ctx, "B-01") === "concerns"
        ? null
        : `the refusal did not hold the write back: B-01 is now '${statusOf(ctx, "B-01")}'`;
    });
  }

  {
    const ctx = world("advance-mixed");
    const filePath = climbToConcerns(ctx, "B-01");
    addConcern(ctx, "CC-1");
    const good = addEvidence(ctx, filePath, "code-verified");
    const lost = evidenceAtLostRevision(ctx, filePath, "B-01 second attachment");
    call("set_disposition", disposition(ctx, "B-01", "CC-1", { evidence_ids: [good] }), ctx);
    attachRow(ctx, "B-01", "CC-1", lost.id, "compensating");
    collectLostCommits(ctx);

    check("A7 control: one resolvable and one unreachable attachment advances, and reports the unreachable one", () => {
      let result;
      const message = refusal(() => {
        result = call("update_subsystem_status", { id: "B-01", status: "adversarial" }, ctx);
        return result;
      });
      if (message !== null) {
        return `an ordinary rebase retroactively unmapped a subsystem whose evidence is intact: ${message}`;
      }
      if (statusOf(ctx, "B-01") !== "adversarial") {
        return `the advance reported success but B-01 is '${statusOf(ctx, "B-01")}'`;
      }
      const reported = JSON.stringify(result ?? {});
      if (!reported.includes(`B-01/CC-1@${lost.sha}`)) {
        return `the unreachable attachment was not reported by the advance: ${scrub(reported)}`;
      }
      return null;
    });
  }

  {
    const ctx = world("advance-control");
    const filePath = climbToConcerns(ctx, "B-01");
    addConcern(ctx, "CC-1");
    addConcern(ctx, "CC-2");
    const a = addEvidence(ctx, filePath, "code-verified");
    const b = addEvidence(ctx, filePath, "test-observed");
    call("set_disposition", disposition(ctx, "B-01", "CC-1", { evidence_ids: [a] }), ctx);
    call(
      "set_disposition",
      disposition(ctx, "B-01", "CC-2", { evidence_ids: [a, b], evidence_quality: "test-observed" }),
      ctx,
    );

    check("A8 control: a subsystem whose dispositions are all attached advances to 'mapped'", () => {
      const toAdversarial = refusal(() =>
        call("update_subsystem_status", { id: "B-01", status: "adversarial" }, ctx),
      );
      if (toAdversarial !== null) return `the advance to 'adversarial' was refused: ${toAdversarial}`;
      seedChallenges(ctx, "B-01");
      // §3.3, which P2 added to the same rung: `mapped` also requires the whole
      // store to have been reconciled against the tree at HEAD. Taken here,
      // after the last ledger write, because a reconciliation is invalidated by
      // the next one. This control is about §2.3's attachment rule, so the
      // reconciliation is a prerequisite it satisfies rather than one it tests.
      reconcileStore(ctx);
      let result;
      const toMapped = refusal(() => {
        result = call("update_subsystem_status", { id: "B-01", status: "mapped" }, ctx);
        return result;
      });
      if (toMapped !== null) return `the advance to 'mapped' was refused: ${toMapped}`;
      if (statusOf(ctx, "B-01") !== "mapped") {
        return `the advance reported success but B-01 is '${statusOf(ctx, "B-01")}'`;
      }
      const reported = JSON.stringify(result ?? {});
      return reported.includes("no longer reachable")
        ? `a subsystem whose attachments all resolve was told one does not: ${scrub(reported)}`
        : null;
    });
  }

  // ------------------------------------------------------- B1..B3: one subprocess

  {
    const ctx = world("batched");
    const filePath = climbToConcerns(ctx, "B-01");
    addConcern(ctx, "CC-1");
    addConcern(ctx, "CC-2");
    // Five rows over three distinct revisions: two commits beside HEAD, so the
    // distinct-value collapse is exercised as well as the batching.
    writeFileSync(join(ctx.project.workspacePath, "second.ts"), "export const second = 2;\n");
    git(ctx.project.workspacePath, "add", "second.ts");
    gitCommit(ctx.project.workspacePath, "second");
    const shaTwo = headSha(ctx);
    writeFileSync(join(ctx.project.workspacePath, "third.ts"), "export const third = 3;\n");
    git(ctx.project.workspacePath, "add", "third.ts");
    gitCommit(ctx.project.workspacePath, "third");
    const shaThree = headSha(ctx);
    const shaOne = git(ctx.project.workspacePath, "rev-parse", "HEAD~2");
    const ids = [shaOne, shaOne, shaTwo, shaThree, shaThree].map(
      (sha) =>
        call(
          "add_evidence",
          { file_path: filePath, symbol: "Unit", line_range: "1-4", ref_sha: sha, kind: "code-verified" },
          ctx,
        ).id,
    );

    let observed = null;
    check("B1 set_disposition resolves five ids over three revisions in one batched git call", () => {
      // The arguments are built outside the measured window: `disposition()`
      // reads HEAD through git itself, and counting the fixture's own
      // subprocesses would make this assertion about the gate.
      const args = disposition(ctx, "B-01", "CC-1", { evidence_ids: ids, ref_sha: shaThree });
      const run = gitInvocationsDuring(() => {
        call("set_disposition", args, ctx);
      });
      observed = run;
      if (run.thrown) return `the batched call threw — ${scrub(run.thrown?.message ?? run.thrown)}`;
      const batches = run.lines.filter((line) => line.includes("cat-file") && line.includes("--batch-check"));
      const revParses = run.lines.filter((line) => line.includes("rev-parse"));
      notes.push(
        `one set_disposition over 5 evidence ids at 3 distinct revisions spawned ${run.lines.length} git subprocess(es): ${run.lines.map((l) => l.split(" ").slice(0, 2).join(" ")).join(", ") || "none"}`,
      );
      if (batches.length !== 1) {
        return `the call ran ${batches.length} 'git cat-file --batch-check' subprocess(es), not 1; §2.2 step 2 requires the distinct ref_sha values to be resolved in one batch, and test-perf-ceilings.mjs:187 reads this writer against a 200 ms ceiling ~31× a single subprocess`;
      }
      if (revParses.length > 1) {
        return `the call ran ${revParses.length} 'git rev-parse' subprocess(es); one resolves the disposition's own ref_sha, the rest are the per-id resolution §2.2 forbids`;
      }
      return null;
    });

    check("B2 the batched resolution accepts all five and attaches one row per id", () => {
      const row = dispositionRow(ctx, "B-01", "CC-1");
      if (!row) return "the batched call wrote no dispositions row";
      const rows = attachments(ctx, "B-01", "CC-1");
      const distinct = new Set(ids);
      return rows.length === distinct.size
        ? null
        : `${distinct.size} distinct id(s) produced ${rows.length} attachment(s)`;
    });

    check("B3 the advance resolves the subsystem's revisions in one batched git call too", () => {
      // A second disposition, so the advance has more than one row to resolve.
      call(
        "set_disposition",
        disposition(ctx, "B-01", "CC-2", { evidence_ids: [ids[0], ids[2]], ref_sha: shaThree }),
        ctx,
      );
      const run = gitInvocationsDuring(() => {
        call("update_subsystem_status", { id: "B-01", status: "adversarial" }, ctx);
      });
      if (run.thrown) return `the advance threw — ${scrub(run.thrown?.message ?? run.thrown)}`;
      if (statusOf(ctx, "B-01") !== "adversarial") {
        return `the control advance was refused; B-01 is '${statusOf(ctx, "B-01")}'`;
      }
      const batches = run.lines.filter((line) => line.includes("cat-file") && line.includes("--batch-check"));
      const revParses = run.lines.filter((line) => line.includes("rev-parse"));
      notes.push(
        `one advance over 2 dispositions at 3 distinct revisions spawned ${run.lines.length} git subprocess(es)`,
      );
      if (batches.length !== 1) {
        return `the advance ran ${batches.length} 'git cat-file --batch-check' subprocess(es), not 1`;
      }
      if (revParses.length > 0) {
        return `the advance ran ${revParses.length} 'git rev-parse' subprocess(es); the advance resolves every attached revision and must batch them`;
      }
      return null;
    });

    if (observed === null) notes.push("B1 did not run, so the subprocess census is unmeasured");
  }

  // ----------------------------------------------------------------- C1: in CI

  check("C1 this gate runs in CI (spec.md §8)", () => {
    const workflow = join(here, "..", ".github", "workflows", "test.yml");
    if (!existsSync(workflow)) return ".github/workflows/test.yml is absent";
    return readFileSync(workflow, "utf8").includes("node test-disposition-evidence.mjs")
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
    mods.invariants = await import("./dist/invariants.js");
    const [artifacts, claims, concerns, dispositions, evidence, files, gitModule, project, subsystems] =
      await Promise.all([
        import("./dist/tools/artifacts.js"),
        import("./dist/tools/claims.js"),
        import("./dist/tools/concerns.js"),
        import("./dist/tools/dispositions.js"),
        import("./dist/tools/evidence.js"),
        import("./dist/tools/files.js"),
        import("./dist/tools/git.js"),
        import("./dist/tools/project.js"),
        import("./dist/tools/subsystems.js"),
      ]);
    mods.toolArrays = [
      artifacts.artifactTools,
      claims.claimTools,
      concerns.concernTools,
      dispositions.dispositionTools,
      evidence.evidenceTools,
      files.fileTools,
      gitModule.gitTools,
      project.projectTools,
      subsystems.subsystemTools,
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
    "GATE P1 RED: GATE SD1 RED: a disposition was answered from nothing — set_disposition took a " +
      "call with no evidence_ids, an unknown or unreachable id, or a quality stronger than its " +
      "evidence; a refused call left a row behind; a subsystem holding an unattached disposition " +
      `advanced; or the resolution was not batched — ${failures.length} of ${checked} assertion(s) ` +
      `failed; first: ${failures[0]}`,
  );
  exitCode = 1;
} else {
  console.log("GATE P1 GREEN");
}
process.exit(exitCode);
