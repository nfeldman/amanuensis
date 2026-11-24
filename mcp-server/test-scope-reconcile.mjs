#!/usr/bin/env node
// GATE SC4 (design/scope/PLAN.md §3 SC4; §2.5, §2.6a) — the reconciliation
// core over the survey set.
//
// Turns red when:
//   1. `unledgered` is not computed over the survey set: an excluded path is
//      reported unledgered, or a survey path is not (U1, U2);
//   2. `scope_exclusions` and both digests are not written in the same
//      transaction as the reconciliation, or the rows or digests do not
//      re-derive under the restated formulas (T1, T2);
//   3. the ledger rows, the ledger digest and the counts are read outside that
//      transaction (T3);
//   4. standing:
//      - a rule recorded after a reconciliation does not take it away, or takes
//        it away with another reason than "the scope rules have changed since
//        the reconciliation recorded there was taken" (S1);
//      - an extra, swapped or re-sourced `scope_exclusions` row does not take
//        it away through `exclusion_digest` (S2, S3, S4);
//   5. publication and `mapped`:
//      - publication is not refused while `unsorted > 0` in `sorted` mode, or
//        the refusal does not name up to 20 unsorted paths (P1);
//      - publication is refused in `legacy` mode (P2);
//      - `mapped` is refused with unsorted paths (M1);
//   6. excluded paths with ledger rows:
//      - they are deleted, or not reported as `excluded_with_rows` (E1);
//      - a `candidate` row there blocks `mapped` (M1, with its control M0);
//      - the ledger digest includes them (E2);
//      - an include rule does not reactivate them (E3);
//   7. `records_citing_excluded` does not list a claim made before the rule
//      (R1);
//   8. an untouched legacy store loses its standing after the upgrade (L1),
//      or a legacy store's gitignore matches do not leave the survey set (L2);
//   9. this gate is not registered in CI (CI1).
//  10. a fixture git command reads the machine's configuration: with a planted
//      global hooks path and template directory, a hook runs (HN1).
//
// Every fixture is a temporary git repository and a store under a temporary
// AMANUENSIS_STORAGE_ROOT; nothing here reads a real store or the network.
// The legacy fixture applies the schema at 6a6dc43, read from this
// repository's history, as test-scope-schema.mjs does.
//
// The digests are restated here, not imported (GP24): a fixture checked by the
// code under test proves only that the code agrees with itself.
//
//   exit 0  `GATE SC4 GREEN`
//   exit 1  `GATE SC4 RED: <reason>`

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { citedSource } from "./fixtures/cited-source.mjs";
import { stableClaimKey } from "./fixtures/claim-key.mjs";
import { dischargeExplanations } from "./fixtures/explanation-discharge.mjs";
import { examineScope } from "./fixtures/examine-scope.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PRE_UPGRADE_SHA = "6a6dc43";
const RULE_CHANGED = "the scope rules have changed since the reconciliation recorded there was taken";

// A crash signature in this gate's output means the run never reached its
// assertion, so the launcher rejects it as a red proof. Detail quoted from a
// live error is scrubbed rather than trusted.
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
  "Traceback (most recent call last)",
];
function scrub(text) {
  let out = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  for (const signature of CRASH_SIGNATURES) {
    const cut = Math.ceil(signature.length / 2);
    out = out.split(signature).join(`${signature.slice(0, cut)}…${signature.slice(cut)}`);
  }
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

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (value) => JSON.stringify(value);

// ------------------------------------------------------- restated formulas

const NUL = "\u0000";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** §2.5: active rules then active sorting rows, each by id, `kind\0id\0pattern\0action-or-category`, joined by \n. */
function scopeDigestOf(db) {
  const active = (table) => {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    const withdrawn = new Set(rows.map((row) => row.supersedes).filter((id) => id != null));
    return rows.filter((row) => !withdrawn.has(row.id));
  };
  const lines = [
    ...active("scope_rules").map((r) => ["rule", r.id, r.pattern, r.action].join(NUL)),
    ...active("scope_sorting").map((r) => ["sorting", r.id, r.pattern, r.category].join(NUL)),
  ];
  return sha256(lines.join("\n"));
}

/** §2.5: one reconciliation's exclusions, by path, `file_path\0source\0rule_id-or-empty`, joined by \n. */
function exclusionDigestOf(rows) {
  return sha256(
    [...rows]
      .sort((a, b) => byCodeUnit(a.file_path, b.file_path))
      .map((r) => [r.file_path, r.source, r.rule_id ?? ""].join(NUL))
      .join("\n"),
  );
}

/** invariants.ts ledgerDigest, restated, over the ledger rows whose path is not excluded (§2.6a). */
function ledgerDigestOf(db, excluded = new Set()) {
  const rows = db
    .prepare("SELECT file_path, classification FROM file_ledger")
    .all()
    .filter((row) => !excluded.has(row.file_path));
  return sha256(rows.map((r) => `${r.file_path}${NUL}${r.classification ?? ""}`).sort().join(NUL));
}

const treeDigestOf = (paths) => sha256([...paths].sort().join(NUL));

// ---------------------------------------------------------------- fixtures

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${result.status}: ${String(result.stderr).trim()}`);
  }
  return String(result.stdout ?? "").trim();
}
function gitCommit(cwd, message) {
  git(
    cwd,
    "-c", "user.email=sc4@localhost",
    "-c", "user.name=scope-sc4",
    "-c", "commit.gpgsign=false",
    "commit", "-q", "--no-verify", "-m", message,
  );
}

function main(mods) {
  const {
    openDatabase,
    resolveProject,
    ensureProjectStorage,
    readReconciliationStanding,
    requireCompleteReconciliation,
    toolArrays,
    Database,
  } = mods;
  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  function call(name, args, ctx) {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    return td.handler(args, ctx);
  }

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-sc4-"));
  process.env.AMANUENSIS_STORAGE_ROOT = join(scratch, "storage");
  const cleanups = [];
  // The fixture's git must not read the machine's configuration: a global
  // hooks path or template directory would run something outside this gate.
  // A hostile global configuration is planted here, so a fixture command that
  // inherits it fails the gate (HN1).
  const hostile = join(scratch, "hostile");
  for (const dir of [join(hostile, "hooks"), join(hostile, "template", "hooks")]) {
    mkdirSync(dir, { recursive: true });
    for (const hook of ["pre-commit", "commit-msg", "post-commit"]) {
      writeFileSync(join(dir, hook), `#!/bin/sh\necho "${hook} ran" >> '${join(hostile, "ran.log")}'\nexit 1\n`);
      chmodSync(join(dir, hook), 0o755);
    }
  }
  writeFileSync(
    join(hostile, "gitconfig"),
    `[core]\n\thooksPath = ${join(hostile, "hooks")}\n[init]\n\ttemplateDir = ${join(hostile, "template")}\n`,
  );
  process.env.GIT_CONFIG_GLOBAL = join(hostile, "gitconfig");


  function workspace(label, files, forced = []) {
    const ws = join(scratch, `ws-${label}`);
    mkdirSync(ws, { recursive: true });
    git(ws, "init", "-q", "--template=");
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(ws, name)), { recursive: true });
      writeFileSync(join(ws, name), body);
    }
    git(ws, "add", "-A");
    // Paths the tree's own .gitignore matches, tracked anyway: the case
    // §2.9 calls the one behaviour change for legacy stores.
    if (forced.length > 0) git(ws, "add", "-f", ...forced);
    gitCommit(ws, "seed");
    return ws;
  }

  function contextFor(ws, label) {
    const project = resolveProject(ws, { selectionSource: "sc4-scope-reconcile" });
    ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
    return project;
  }

  function open(project) {
    const ctx = { project, db: openDatabase(project.dbPath), sessionId: null };
    cleanups.push(() => {
      try {
        ctx.db.close();
      } catch {
        /* already reported */
      }
    });
    ctx.sessionId = call("start_session", { intent: "sc4 fixture" }, ctx).session_id;
    return ctx;
  }

  const headSha = (ctx) => git(ctx.project.workspacePath, "rev-parse", "HEAD");
  const statusOf = (ctx, id) =>
    ctx.db.prepare("SELECT status FROM subsystems WHERE id=?").get(id)?.status ?? null;

  function reconcile(ctx) {
    if (!ctx.db.prepare("SELECT 1 FROM git_state WHERE repo_id='default'").get()) {
      call("set_git_state", { canonical_branch: "main", onboarding_sha: headSha(ctx) }, ctx);
    }
    return call("detect_changes", { current_sha: headSha(ctx) }, ctx);
  }
  const latestRow = (ctx) =>
    ctx.db.prepare("SELECT * FROM scope_reconciliations ORDER BY id DESC LIMIT 1").get() ?? null;
  const exclusionsOf = (ctx, id) =>
    ctx.db
      .prepare(
        "SELECT file_path, source, rule_id FROM scope_exclusions WHERE reconciliation_id = ? ORDER BY file_path",
      )
      .all(id);
  const standing = (ctx) =>
    readReconciliationStanding(ctx.db, ctx.project.workspacePath, "HEAD");

  /** Run `fn` against the store inside a transaction that is always rolled back. */
  function rolledBack(ctx, fn) {
    ctx.db.exec("BEGIN");
    try {
      return fn();
    } finally {
      ctx.db.exec("ROLLBACK");
    }
  }

  function addEvidence(ctx, filePath) {
    return call(
      "add_evidence",
      { file_path: filePath, symbol: "Unit", line_range: "1-4", ref_sha: headSha(ctx), kind: "code-verified" },
      ctx,
    ).id;
  }
  let claims = 0;
  function addClaim(ctx, id, filePath) {
    claims += 1;
    const claimId = `SC4-CL-${claims}`;
    call(
      "add_claim",
      {
        claim_id: claimId,
        claim_key: stableClaimKey(id, "key-type", `${filePath}:Unit`),
        subject_type: "symbol",
        subject_id: `${filePath}:Unit`,
        statement: `Unit is the type ${filePath} is built around.`,
        epistemic_kind: "observation",
        ref_sha: headSha(ctx),
        evidence_ids: [addEvidence(ctx, filePath)],
      },
      ctx,
    );
    return claimId;
  }

  function seedChallenges(ctx, id) {
    const open = ctx.db
      .prepare(
        `SELECT claim_id FROM claims c
          WHERE c.valid_until_sha IS NULL
            AND substr(c.claim_key, 1, length(?)) = ?
            AND NOT EXISTS (SELECT 1 FROM claim_challenge_outcomes o WHERE o.claim_id = c.claim_id)`,
      )
      .all(`${id}/`, `${id}/`);
    for (const row of open) {
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

  /** test-scope-reconciliation.mjs's climb, to the last rung before `mapped`. */
  function climbToAdversarial(ctx, id, filePath) {
    call("upsert_subsystem", { id, name: `${id} fixture`, status: "unmapped" }, ctx);
    call("update_subsystem_status", { id, status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      { subsystem_id: id, ref_sha: headSha(ctx), files: [{ file_path: filePath, why_in_scope: "fixture" }] },
      ctx,
    );
    addClaim(ctx, id, filePath);
    call(
      "decline_domain_vocabulary",
      { subsystem_id: id, reason: "fixture subsystem: its seeded files coin no term of their own", ref_sha: headSha(ctx) },
      ctx,
    );
    call("update_subsystem_status", { id, status: "structural" }, ctx);
    call(
      "decline_narrative",
      {
        subject_type: "subsystem",
        subject_id: id,
        section: "structure",
        reason: "Fixture subsystem: its files say nothing specific enough to narrate.",
        ref_sha: headSha(ctx),
      },
      ctx,
    );
    call("update_subsystem_status", { id, status: "concerns" }, ctx);
    call("add_concern", { code: "SC4-C1", category: "cache", origin: "seeded" }, ctx);
    call(
      "set_disposition",
      {
        subsystem_id: id,
        concern_code: "SC4-C1",
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
    examineScope(call, ctx, id);
  }

  const ownerWords = "\"leave that folder out of the survey\"";

  // ====================================================== world 1: the survey
  //
  //   .gitignore        survey, unsorted        (no sorting row covers it)
  //   README.md         survey, unsorted
  //   build/out.ts      gitignore               (force-added)
  //   design/proto.ts   user (rule `design/`)   ledgered candidate, with a claim
  //   notes/n.md        meta (sorting `notes/`)
  //   src/a.ts          survey, product         ledgered, examined
  //   src/b.ts          survey, product         unledgered

  const ws1 = workspace(
    "survey",
    {
      ".gitignore": "build/\n",
      "README.md": "# Fixture\n",
      "build/out.ts": "export const built = true;\n",
      "design/proto.ts": citedSource("design"),
      "notes/n.md": "# Notes\nWhat was tried, and why.\n",
      "src/a.ts": citedSource("a"),
      "src/b.ts": citedSource("b"),
    },
    ["build/out.ts"],
  );
  const ctx = open(contextFor(ws1, "survey"));
  climbToAdversarial(ctx, "B-01", "src/a.ts");
  call(
    "add_files_to_scope",
    {
      subsystem_id: "B-01",
      ref_sha: headSha(ctx),
      files: [{ file_path: "design/proto.ts", why_in_scope: "scoped before the owner excluded design/" }],
    },
    ctx,
  );
  const beforeRuleClaim = addClaim(ctx, "B-01", "design/proto.ts");
  const beforeRuleEvidence = ctx.db
    .prepare("SELECT evidence_id FROM claim_evidence WHERE claim_id = ?")
    .get(beforeRuleClaim)?.evidence_id;
  seedChallenges(ctx, "B-01");
  dischargeExplanations(call, ctx, "B-01", headSha(ctx));

  check("M0 control: with nothing excluded, the candidate row on design/proto.ts blocks mapped", () => {
    const result = reconcile(ctx);
    if (result?.ok === false) return `detect_changes refused: ${result.error}`;
    const denied = refusal(() => call("update_subsystem_status", { id: "B-01", status: "mapped" }, ctx));
    if (denied === null) return "the advance was taken, so the fixture's candidate row proves nothing below";
    return /design\/proto\.ts/.test(denied) && /candidate/.test(denied)
      ? null
      : `the advance was refused for another reason: ${denied}`;
  });

  const rule = call(
    "set_scope_rule",
    { pattern: "design/", action: "exclude", reason: "plans, not code", owner_words: ownerWords },
    ctx,
  );
  const product = call(
    "record_scope_sorting",
    { pattern: "src/", category: "product", description: "the code" },
    ctx,
  );
  const meta = call(
    "record_scope_sorting",
    {
      pattern: "notes/",
      category: "meta",
      description: "working notes",
      inventory: [{ file_path: "notes/n.md", line_range: "1-2", excerpt: "# Notes" }],
    },
    ctx,
  );
  if (!rule?.id || !product?.id || !meta?.id) {
    failures.push(
      `F1 the scope rows were not recorded: ${scrub(show({ rule, product, meta })).slice(0, 300)}`,
    );
  }

  // Every read detect_changes makes of the ledger or the scope rows, with
  // whether a transaction was open when it ran.
  const reads = [];
  const traced = new Proxy(ctx.db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql) => {
          const statement = target.prepare(sql);
          const table = /\bFROM\s+(file_ledger|scope_rules|scope_sorting|scope_mode_changes)\b/i.exec(sql)?.[1];
          if (!table) return statement;
          const wrapped = new Proxy(statement, {
            get(st, name) {
              const value = Reflect.get(st, name, st);
              if (typeof value !== "function") return value;
              if (!["all", "get", "iterate"].includes(name)) {
                return (...args) => {
                  const out = value.apply(st, args);
                  return out === st ? wrapped : out;
                };
              }
              return (...args) => {
                reads.push({ table, inTransaction: target.inTransaction });
                return value.apply(st, args);
              };
            },
          });
          return wrapped;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const tracedCtx = { project: ctx.project, db: traced, sessionId: ctx.sessionId };
  const r1 = call("detect_changes", { current_sha: headSha(ctx) }, tracedCtx);
  const row1 = latestRow(ctx);

  check("T3 the ledger, the scope rows and the counts are read inside the reconciliation's transaction", () => {
    if (r1?.ok === false) return `detect_changes refused: ${r1.error}`;
    const tables = new Set(reads.map((r) => r.table));
    const missing = ["file_ledger", "scope_rules", "scope_sorting"].filter((t) => !tables.has(t));
    if (missing.length > 0) return `detect_changes never read ${missing.join(", ")}`;
    const outside = reads.filter((r) => !r.inTransaction).map((r) => r.table);
    return outside.length === 0
      ? null
      : `${outside.length} read(s) ran outside the transaction (${[...new Set(outside)].join(", ")}): a write between them and the commit would be counted against a ledger the row does not describe`;
  });

  check("U1 unledgered is the survey set minus the ledger, and scope_gaps says the same", () => {
    const want = [".gitignore", "README.md", "src/b.ts"];
    const got = [...(r1?.unledgered_paths ?? [])].sort();
    const gaps = ctx.db
      .prepare("SELECT file_path FROM scope_gaps WHERE kind = 'unledgered' ORDER BY file_path")
      .all()
      .map((r) => r.file_path);
    const wrong = [];
    if (!same(got, want)) wrong.push(`unledgered_paths ${show(got)}, want ${show(want)}`);
    if (!same(gaps, want)) wrong.push(`scope_gaps unledgered ${show(gaps)}, want ${show(want)}`);
    if (row1?.unledgered !== 3) wrong.push(`the row records unledgered ${row1?.unledgered}, want 3`);
    return wrong.length ? wrong.join("; ") : null;
  });

  check("U2 the response and the row carry the survey set's counts", () => {
    const wantScope = {
      mode: "sorted",
      survey_paths: 4,
      excluded: { gitignore: 1, user: 1, meta: 1 },
      unsorted: 2,
      unsorted_paths: [".gitignore", "README.md"],
    };
    const got = r1?.scope ?? null;
    const gotScope = got && {
      mode: got.mode,
      survey_paths: got.survey_paths,
      excluded: got.excluded && {
        gitignore: got.excluded.gitignore,
        user: got.excluded.user,
        meta: got.excluded.meta,
      },
      unsorted: got.unsorted,
      unsorted_paths: got.unsorted_paths && [...got.unsorted_paths].sort(),
    };
    const wrong = [];
    if (!same(gotScope, wantScope)) wrong.push(`scope ${show(got)}, want ${show(wantScope)}`);
    const wantRow = {
      tracked_paths: 7,
      survey_paths: 4,
      excluded: 3,
      unsorted: 2,
      scope_mode: "sorted",
      ledger_rows: 1,
      unledgered: 3,
      absent: 0,
      exempt: 0,
    };
    const gotRow = row1 && Object.fromEntries(Object.keys(wantRow).map((k) => [k, row1[k]]));
    if (!same(gotRow, wantRow)) wrong.push(`the row carries ${show(gotRow)}, want ${show(wantRow)}`);
    return wrong.length ? wrong.join("; ") : null;
  });

  check("T2 scope_exclusions and both digests are written and re-derive under the restated formulas", () => {
    if (!row1) return "no reconciliation row";
    const want = [
      { file_path: "build/out.ts", source: "gitignore", rule_id: null },
      { file_path: "design/proto.ts", source: "user", rule_id: rule?.id },
      { file_path: "notes/n.md", source: "meta", rule_id: meta?.id },
    ];
    const got = exclusionsOf(ctx, row1.id);
    const wrong = [];
    if (!same(got, want)) wrong.push(`scope_exclusions ${show(got)}, want ${show(want)}`);
    if (row1.scope_digest !== scopeDigestOf(ctx.db)) {
      wrong.push(`scope_digest ${row1.scope_digest} is not the restated ${scopeDigestOf(ctx.db)}`);
    }
    if (row1.exclusion_digest !== exclusionDigestOf(want)) {
      wrong.push(`exclusion_digest ${row1.exclusion_digest} is not the restated ${exclusionDigestOf(want)}`);
    }
    const tracked = git(ws1, "ls-tree", "-r", "--name-only", headSha(ctx)).split("\n");
    if (row1.tree_digest !== treeDigestOf(tracked)) wrong.push("tree_digest is no longer the whole tree");
    return wrong.length ? wrong.join("; ") : null;
  });

  check("E1 the excluded ledger row is reported, not deleted", () => {
    const want = [{ subsystem_id: "B-01", file_path: "design/proto.ts", source: "user", rule_id: rule?.id }];
    const got = (r1?.excluded_with_rows ?? null)?.map((r) => ({
      subsystem_id: r.subsystem_id,
      file_path: r.file_path,
      source: r.source,
      rule_id: r.rule_id,
    }));
    const wrong = [];
    if (!same(got, want)) wrong.push(`excluded_with_rows ${show(r1?.excluded_with_rows)}, want ${show(want)}`);
    const kept = ctx.db
      .prepare("SELECT classification FROM file_ledger WHERE file_path = 'design/proto.ts'")
      .get();
    if (kept?.classification !== "candidate") wrong.push(`the ledger row became ${show(kept)}`);
    return wrong.length ? wrong.join("; ") : null;
  });

  check("E2 the ledger digest leaves the excluded row out", () => {
    if (!row1) return "no reconciliation row";
    const wrong = [];
    const want = ledgerDigestOf(ctx.db, new Set(["build/out.ts", "design/proto.ts", "notes/n.md"]));
    if (row1.ledger_digest !== want) wrong.push(`ledger_digest ${row1.ledger_digest}, want ${want} (the ledger without design/proto.ts)`);
    const excludedEdit = rolledBack(ctx, () => {
      ctx.db.prepare("UPDATE file_ledger SET classification = 'examined' WHERE file_path = 'design/proto.ts'").run();
      return standing(ctx);
    });
    if (!excludedEdit.standing) wrong.push(`re-classifying the excluded row took standing away: ${excludedEdit.why}`);
    const includedEdit = rolledBack(ctx, () => {
      ctx.db.prepare("UPDATE file_ledger SET classification = 'irrelevant' WHERE file_path = 'src/a.ts'").run();
      return standing(ctx);
    });
    if (includedEdit.standing) wrong.push("control: re-classifying an included row left the reconciliation standing");
    return wrong.length ? wrong.join("; ") : null;
  });

  check("R1 records_citing_excluded lists the evidence and the claim made before the rule", () => {
    const got = r1?.records_citing_excluded;
    const want = {
      count: 2,
      records: [
        { kind: "claim", id: beforeRuleClaim },
        { kind: "evidence", id: beforeRuleEvidence },
      ],
    };
    const gotShape = got && {
      count: got.count,
      records: got.records?.map((r) => ({ kind: r.kind, id: r.id })),
    };
    return same(gotShape, want) ? null : `records_citing_excluded ${show(got)}, want ${show(want)}`;
  });

  check("S0 control: the reconciliation stands", () => {
    const reading = standing(ctx);
    if (!reading.standing) return `it does not stand: ${reading.why}`;
    return reading.standing.id === row1?.id ? null : `the standing row is ${reading.standing.id}, not ${row1?.id}`;
  });

  /** Tamper with this reconciliation's exclusions with the triggers lifted, inside a rolled-back transaction. */
  function tampered(sql, ...params) {
    return rolledBack(ctx, () => {
      for (const name of [
        "scope_exclusion_is_immutable",
        "scope_exclusion_cannot_be_replaced",
      ]) {
        ctx.db.exec(`DROP TRIGGER IF EXISTS ${name}`);
      }
      ctx.db.prepare(sql).run(...params);
      return standing(ctx);
    });
  }
  const exclusionWhy = (reading, what) => {
    if (reading.standing) return `${what} left the reconciliation standing`;
    return /exclusion/.test(reading.why ?? "") ? null : `${what} took standing away for another reason: ${reading.why}`;
  };

  check("S2 an extra scope_exclusions row takes standing away through exclusion_digest", () =>
    exclusionWhy(
      tampered(
        "INSERT INTO scope_exclusions (reconciliation_id, file_path, source, rule_id) VALUES (?, 'src/b.ts', 'gitignore', NULL)",
        row1?.id,
      ),
      "an extra row on src/b.ts",
    ),
  );
  check("S3 a swapped scope_exclusions row takes standing away through exclusion_digest", () =>
    exclusionWhy(
      tampered(
        "UPDATE scope_exclusions SET file_path = 'README.md' WHERE reconciliation_id = ? AND file_path = 'notes/n.md'",
        row1?.id,
      ),
      "notes/n.md swapped for README.md",
    ),
  );
  check("S4 a re-sourced scope_exclusions row takes standing away through exclusion_digest", () =>
    exclusionWhy(
      tampered(
        "UPDATE scope_exclusions SET source = 'meta' WHERE reconciliation_id = ? AND file_path = 'design/proto.ts'",
        row1?.id,
      ),
      "design/proto.ts re-sourced from user to meta",
    ),
  );

  check("M1 mapped is taken with unsorted paths and a candidate row on an excluded path", () => {
    if (!row1 || row1.unsorted === 0) return "the fixture has no unsorted path, so this proves nothing";
    const denied = refusal(() => call("update_subsystem_status", { id: "B-01", status: "mapped" }, ctx));
    if (denied !== null) return `the advance was refused: ${denied}`;
    return statusOf(ctx, "B-01") === "mapped" ? null : `B-01 is ${statusOf(ctx, "B-01")}`;
  });

  check("S1 a rule recorded after the reconciliation takes standing away, with the named reason", () => {
    const later = call(
      "set_scope_rule",
      { pattern: "README.md", action: "exclude", reason: "boilerplate", owner_words: ownerWords },
      ctx,
    );
    if (!later?.id) return `the rule was not recorded: ${show(later)}`;
    const reading = standing(ctx);
    if (reading.standing) return "the reconciliation still stands after a rule it does not account for";
    const wrong = [];
    if (reading.why !== RULE_CHANGED) wrong.push(`why is ${show(reading.why)}, want ${show(RULE_CHANGED)}`);
    const message = requireCompleteReconciliation(ctx.db, ws1, "HEAD", "materialize_docs") ?? "";
    if (!message.includes(RULE_CHANGED)) wrong.push(`the publication refusal does not name it: ${message}`);
    // Withdraw it again: the remaining checks run on world 1's original rules.
    call(
      "set_scope_rule",
      { pattern: "README.md", action: "include", reason: "withdrawn", owner_words: ownerWords, supersedes: later.id },
      ctx,
    );
    return wrong.length ? wrong.join("; ") : null;
  });

  check("E3 an include rule reactivates the excluded ledger row", () => {
    const include = call(
      "set_scope_rule",
      { pattern: "design/proto.ts", action: "include", reason: "the prototype is code", owner_words: ownerWords },
      ctx,
    );
    if (!include?.id) return `the include rule was not recorded: ${show(include)}`;
    const r2 = reconcile(ctx);
    if (r2?.ok === false) return `detect_changes refused: ${r2.error}`;
    const row2 = latestRow(ctx);
    const wrong = [];
    if (!same(r2.excluded_with_rows ?? null, [])) wrong.push(`excluded_with_rows ${show(r2.excluded_with_rows)}, want []`);
    const excluded = exclusionsOf(ctx, row2.id).map((r) => r.file_path);
    if (excluded.includes("design/proto.ts")) wrong.push("design/proto.ts is still excluded");
    const wantDigest = ledgerDigestOf(ctx.db, new Set(excluded));
    if (row2.ledger_digest !== wantDigest || row2.ledger_digest === row1?.ledger_digest) {
      wrong.push("the ledger digest does not count design/proto.ts again");
    }
    if (row2.ledger_rows !== 2) wrong.push(`ledger_rows ${row2.ledger_rows}, want 2`);
    if (r2.records_citing_excluded?.count !== 0) {
      wrong.push(`records_citing_excluded ${show(r2.records_citing_excluded)} after the include`);
    }
    return wrong.length ? wrong.join("; ") : null;
  });

  check("T1 a failed exclusion write takes the whole reconciliation with it", () => {
    writeFileSync(join(ws1, "build", "late.ts"), "export const late = 1;\n");
    writeFileSync(join(ws1, "src", "c.ts"), citedSource("c"));
    git(ws1, "add", "-f", "build/late.ts", "src/c.ts");
    gitCommit(ws1, "a gitignored path and a survey path at a revision the store has not seen");
    const count = () => ctx.db.prepare("SELECT COUNT(*) AS n FROM scope_reconciliations").get().n;
    const gaps = () =>
      ctx.db.prepare("SELECT file_path, kind FROM scope_gaps ORDER BY file_path, kind").all();
    const last = () =>
      ctx.db.prepare("SELECT last_checked_sha FROM git_state WHERE repo_id='default'").get()?.last_checked_sha;
    const before = { n: count(), gaps: gaps(), last: last() };
    ctx.db.exec(
      `CREATE TRIGGER sc4_block_exclusions BEFORE INSERT ON scope_exclusions
       FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'sc4 fixture blocks the exclusion write'); END`,
    );
    try {
      refusal(() => reconcile(ctx));
    } finally {
      ctx.db.exec("DROP TRIGGER sc4_block_exclusions");
    }
    const wrong = [];
    if (count() !== before.n) wrong.push(`${count() - before.n} reconciliation row(s) were written without their exclusions`);
    if (!same(gaps(), before.gaps)) wrong.push("scope_gaps was rewritten");
    if (last() !== before.last) wrong.push("git_state.last_checked_sha moved");
    return wrong.length ? wrong.join("; ") : null;
  });

  // ================================================= world 2: publication
  {
    const files = { "src/a.ts": citedSource("a"), "README.md": "# Fixture\n" };
    for (let n = 1; n <= 23; n++) files[`misc/f${String(n).padStart(2, "0")}.txt`] = `file ${n}\n`;
    const ws2 = workspace("publication", files);
    const ctx2 = open(contextFor(ws2, "publication"));
    call("upsert_subsystem", { id: "B-02", name: "B-02 fixture", status: "unmapped" }, ctx2);
    call("update_subsystem_status", { id: "B-02", status: "scoping" }, ctx2);
    call(
      "add_files_to_scope",
      {
        subsystem_id: "B-02",
        ref_sha: headSha(ctx2),
        files: Object.keys(files).map((file_path) => ({
          file_path,
          why_in_scope: "fixture",
          classification: "examined",
        })),
      },
      ctx2,
    );
    call("record_scope_sorting", { pattern: "src/", category: "product", description: "the code" }, ctx2);
    const r = reconcile(ctx2);

    check("P1 publication is refused in sorted mode while paths are unsorted, naming up to 20", () => {
      if (r?.ok === false) return `detect_changes refused: ${r.error}`;
      const row = latestRow(ctx2);
      if (row?.unledgered !== 0 || row?.absent !== 0) {
        return `the fixture reconciles to ${row?.unledgered} unledgered and ${row?.absent} absent, so the unsorted refusal is untested`;
      }
      if (row.unsorted !== 24) return `the row records ${row.unsorted} unsorted, want 24`;
      const summary = call("materialize_docs", { output_dir: "docs", clean_publish: true }, ctx2);
      if (summary?.ok !== false) return `the store published: ${scrub(show(summary)).slice(0, 200)}`;
      const message = String(summary.error ?? "");
      const all = ["README.md", ...Object.keys(files).filter((p) => p.startsWith("misc/"))].sort();
      const named = all.filter((p) => message.includes(p));
      const wrong = [];
      if (!/no sorting row covers/.test(message)) wrong.push("it does not say the paths are unsorted");
      if (!same(named, all.slice(0, 20))) wrong.push(`it names ${show(named)}, want the first 20 ${show(all.slice(0, 20))}`);
      if (!/\b24\b/.test(message)) wrong.push("it does not give the count, 24");
      if (/has not been reconciled/.test(message)) wrong.push("it refused the store as unreconciled");
      return wrong.length ? `${wrong.join("; ")} — ${message}` : null;
    });
  }

  // ================================================= world 3: a legacy store
  {
    const ws3 = workspace(
      "legacy",
      {
        ".gitignore": "build/\n",
        "README.md": "# Fixture\n",
        "a.ts": citedSource("a"),
        "build/gen.ts": "export const generated = true;\n",
      },
      ["build/gen.ts"],
    );
    const project = contextFor(ws3, "legacy");
    const head = git(ws3, "rev-parse", "HEAD");
    const schema = spawnSync("git", ["show", `${PRE_UPGRADE_SHA}:mcp-server/src/schema.sql`], {
      cwd: here,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    let legacyId = null;
    let ctx3 = null;
    check("L0 the pre-upgrade store is built", () => {
      if (schema.status !== 0 || !schema.stdout) {
        return `git show ${PRE_UPGRADE_SHA}:mcp-server/src/schema.sql gave nothing (a shallow clone needs fetch-depth: 0)`;
      }
      rmSync(project.dbPath, { force: true });
      for (const suffix of ["-wal", "-shm"]) rmSync(`${project.dbPath}${suffix}`, { force: true });
      const raw = new Database(project.dbPath);
      raw.pragma("foreign_keys = OFF");
      try {
        raw.exec(schema.stdout);
        if (raw.prepare("SELECT 1 FROM sqlite_master WHERE name = 'scope_mode_changes'").get()) {
          return "the pre-upgrade schema already has scope_mode_changes";
        }
        raw.prepare("INSERT INTO subsystems (id, name, status) VALUES ('B-01', 'Core', 'structural')").run();
        const ledger = [
          [".gitignore", "irrelevant"],
          ["README.md", "irrelevant"],
          ["a.ts", "examined"],
          ["build/gen.ts", "generated-ignore"],
        ];
        for (const [file, classification] of ledger) {
          raw
            .prepare("INSERT INTO file_ledger (subsystem_id, file_path, classification, ref_sha) VALUES ('B-01', ?, ?, ?)")
            .run(file, classification, head);
        }
        raw
          .prepare(
            "INSERT INTO git_state (repo_id, canonical_branch, last_checked_sha, onboarding_sha) VALUES ('default', 'main', ?, ?)",
          )
          .run(head, head);
        const tracked = git(ws3, "ls-tree", "-r", "--name-only", head).split("\n");
        legacyId = Number(
          raw
            .prepare(
              `INSERT INTO scope_reconciliations
                 (detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows, unledgered, absent, exempt)
               VALUES (?, ?, ?, ?, ?, 0, 0, 3)`,
            )
            .run(head, treeDigestOf(tracked), ledgerDigestOf(raw), tracked.length, ledger.length).lastInsertRowid,
        );
      } finally {
        raw.close();
      }
      ctx3 = open(project);
      return null;
    });

    if (ctx3) {
      check("L1 an untouched legacy store keeps its standing after the upgrade, and may publish", () => {
        const mode = ctx3.db.prepare("SELECT mode FROM scope_mode_changes ORDER BY id DESC LIMIT 1").get()?.mode;
        if (mode !== "legacy") return `the store opened as ${mode}`;
        const reading = standing(ctx3);
        if (!reading.standing) return `the legacy reconciliation lost its standing: ${reading.why}`;
        if (reading.standing.id !== legacyId) return `the standing row is ${reading.standing.id}, not ${legacyId}`;
        const message = requireCompleteReconciliation(ctx3.db, ws3, "HEAD", "materialize_docs");
        return message === null ? null : `publication was refused: ${message}`;
      });

      check("L2 a legacy store's gitignore match leaves the survey set; P2 publication stays allowed in legacy", () => {
        const r = reconcile(ctx3);
        if (r?.ok === false) return `detect_changes refused: ${r.error}`;
        const row = latestRow(ctx3);
        const wrong = [];
        if (row.scope_mode !== "legacy") wrong.push(`scope_mode ${row.scope_mode}`);
        if (row.unsorted !== 0) wrong.push(`unsorted ${row.unsorted} in legacy mode`);
        if (!same(exclusionsOf(ctx3, row.id), [{ file_path: "build/gen.ts", source: "gitignore", rule_id: null }])) {
          wrong.push(`scope_exclusions ${show(exclusionsOf(ctx3, row.id))}`);
        }
        const reported = (r.excluded_with_rows ?? []).map((e) => `${e.file_path}:${e.source}`);
        if (!same(reported, ["build/gen.ts:gitignore"])) wrong.push(`excluded_with_rows ${show(r.excluded_with_rows)}`);
        const reading = standing(ctx3);
        if (reading.standing?.id !== row.id) wrong.push(`the new row does not stand: ${reading.why}`);
        const message = requireCompleteReconciliation(ctx3.db, ws3, "HEAD", "materialize_docs");
        if (message !== null) wrong.push(`publication was refused in legacy mode: ${message}`);
        return wrong.length ? wrong.join("; ") : null;
      });

      check("L3 the first sorting row ends a legacy reconciliation's standing, with the named reason", () => {
        call("record_scope_sorting", { pattern: "a.ts", category: "product", description: "the code" }, ctx3);
        const reading = standing(ctx3);
        if (reading.standing) return "the reconciliation still stands after the store's first sorting row";
        return reading.why === RULE_CHANGED ? null : `why is ${show(reading.why)}`;
      });
    }
  }

  check("CI1 this gate runs in CI, in the mcp-server job", () => {
    const workflow = join(here, "..", ".github", "workflows", "test.yml");
    if (!existsSync(workflow)) return ".github/workflows/test.yml is absent";
    return readFileSync(workflow, "utf8").includes("node test-scope-reconcile.mjs")
      ? null
      : "the workflow does not run this gate";
  });

  check("HN1 no hook from the machine's git configuration ran in a fixture", () => {
    const log = join(hostile, "ran.log");
    return existsSync(log) ? `hooks ran: ${readFileSync(log, "utf8").trim().split("\n").join(", ")}` : null;
  });

  for (const cleanup of cleanups) cleanup();
  rmSync(scratch, { recursive: true, force: true });
}

// --------------------------------------------------------------- the driver

try {
  const mods = {};
  try {
    mods.Database = (await import("better-sqlite3")).default;
    ({ openDatabase: mods.openDatabase } = await import("./dist/db.js"));
    ({ resolveProject: mods.resolveProject, ensureProjectStorage: mods.ensureProjectStorage } =
      await import("./dist/project.js"));
    ({
      readReconciliationStanding: mods.readReconciliationStanding,
      requireCompleteReconciliation: mods.requireCompleteReconciliation,
    } = await import("./dist/invariants.js"));
    const names = [
      ["artifacts", "artifactTools"],
      ["claims", "claimTools"],
      ["concerns", "concernTools"],
      ["dispositions", "dispositionTools"],
      ["evidence", "evidenceTools"],
      ["explanations", "explanationTools"],
      ["files", "fileTools"],
      ["git", "gitTools"],
      ["materialize", "materializeTools"],
      ["narratives", "narrativeTools"],
      ["project", "projectTools"],
      ["scope", "scopeTools"],
      ["subsystems", "subsystemTools"],
      ["vocabulary", "vocabularyTools"],
    ];
    mods.toolArrays = await Promise.all(
      names.map(async ([file, name]) => (await import(`./dist/tools/${file}.js`))[name]),
    );
  } catch (error) {
    failures.push(`L the server build could not be loaded: ${scrub(error?.message ?? error)}`);
  }
  if (failures.length === 0) {
    if (mods.toolArrays.some((tools) => !Array.isArray(tools))) {
      failures.push("L a tool array could not be read from dist/tools");
    } else {
      main(mods);
    }
  }
} catch (error) {
  failures.push(`X the gate did not finish: ${scrub(error?.message ?? error)}`);
}

console.log(`  ran  ${checked} assertion(s) against ${join(here, "dist")}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`GATE SC4 RED: ${failures.length} of ${checked} assertion(s) failed; first: ${failures[0]}`);
  process.exit(1);
}
console.log("GATE SC4 GREEN");
process.exit(0);
