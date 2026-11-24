#!/usr/bin/env node
// GATE SC5 (design/scope/PLAN.md §3 SC5; §2.10, §2.6a) — the completion
// checker over the survey set.
//
// Turns red when:
//   1. clause 1 is not evaluated over the survey set: the recorded exclusions
//      stay in its denominator, or an excluded path is named as owed work (S1);
//   2. both digests are not recomputed before the reconciliation is trusted:
//      - a changed rule, or a changed sorting row, leaves clause 1 evaluable, or
//        takes standing away without the sentence "the scope rules have changed
//        since the reconciliation recorded there was taken" (D1, D2);
//      - an extra, a swapped or a deleted `scope_exclusions` row leaves it
//        evaluable, or takes standing away without the sentence "the
//        scope_exclusions rows recorded there no longer match the
//        reconciliation's exclusion_digest" (D3, D4, D5);
//      - a recorded `scope_digest` that no longer matches leaves it evaluable (D6);
//   3. the ledger digest keeps the excluded rows: a store with an inactive row
//      does not reconcile, or a change to an inactive row ends standing, or a
//      change to an active row does not (G1, G2, G3);
//   4. an unsorted path in `sorted` mode is not a named obligation
//      `unsorted:<path>`, or a sorted path still is one (U1, U2);
//   5. clauses 2, 3 and 4 do not skip a subsystem, and a seam, outside the
//      survey, or do not name them in the JSON and the text report, or skip an
//      in-survey subsystem or seam too (O1, O2, O3, O4);
//   6. a legacy store does not read as before: its whole tree is not clause 1's
//      denominator, a sorting obligation is invented for it, a rule recorded
//      after it does not end a legacy reconciliation's standing, or a store with
//      none of the scope tables makes the checker give up (L1, L2, L3, L4);
//   7. this gate is not registered in CI (CI1).
//
// Every fixture is a temporary git repository and a store under a temporary
// AMANUENSIS_STORAGE_ROOT; nothing here reads a real store or the network. The
// store is built with the server's own handlers, then the checker is run as a
// subprocess over copies of it. The digests are not restated here: the checker
// is expected to decline a store whose recorded digests disagree with its
// rows, and the gate shows that by editing the rows.
//
//   exit 0  `GATE SC5 GREEN`
//   exit 1  `GATE SC5 RED: <reason>`

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const server = join(repo, "mcp-server");
const checker = join(here, "check-store-fully-surveyed.mjs");

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

const show = (value) => JSON.stringify(value);
const sortedList = (list) => [...(list ?? [])].sort();
const sameList = (a, b) => show(sortedList(a)) === show(sortedList(b));

const RULE_CHANGED = "the scope rules have changed since the reconciliation recorded there was taken";
const EXCLUSIONS_CHANGED =
  "the scope_exclusions rows recorded there no longer match the reconciliation's exclusion_digest";
const LEDGER_CHANGED = "the file ledger has changed since the reconciliation recorded there was taken";

// Fixture git reads no configuration but its own repository's: no global or
// system file, no hooks, no template.
const FIXTURE_GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

function git(cwd, ...args) {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    env: FIXTURE_GIT_ENV,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${result.status}: ${String(result.stderr).trim()}`);
  }
  return String(result.stdout ?? "").trim();
}
function gitCommit(cwd, message) {
  git(
    cwd,
    "-c", "user.email=sc5@localhost",
    "-c", "user.name=scope-sc5",
    "-c", "commit.gpgsign=false",
    "commit", "-q", "--no-verify", "-m", message,
  );
}

async function main(mods) {
  const { openDatabase, resolveProject, ensureProjectStorage, toolArrays, DatabaseSync } = mods;
  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  function call(name, args, ctx) {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    const result = td.handler(args, ctx);
    if (result && typeof result === "object" && result.ok === false && result.error) {
      throw new Error(`${name} refused: ${result.error}`);
    }
    return result;
  }

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-sc5-"));
  process.env.AMANUENSIS_STORAGE_ROOT = join(scratch, "storage");
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  const cleanups = [];

  function workspace(label, files, forced = []) {
    const ws = join(scratch, `ws-${label}`);
    mkdirSync(ws, { recursive: true });
    git(ws, "init", "-q", "--template=");
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(ws, name)), { recursive: true });
      writeFileSync(join(ws, name), body);
    }
    git(ws, "add", "-A");
    if (forced.length > 0) git(ws, "add", "-f", ...forced);
    gitCommit(ws, "seed");
    return ws;
  }

  function open(ws, label) {
    const project = resolveProject(ws, { selectionSource: "sc5-store-fully-surveyed" });
    ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
    const ctx = { project, db: openDatabase(project.dbPath), sessionId: null };
    cleanups.push(() => {
      try {
        ctx.db.close();
      } catch {
        /* already closed */
      }
    });
    ctx.sessionId = call("start_session", { intent: `sc5 ${label}` }, ctx).session_id;
    return ctx;
  }

  const headSha = (ctx) => git(ctx.project.workspacePath, "rev-parse", "HEAD");
  function reconcile(ctx) {
    if (!ctx.db.prepare("SELECT 1 FROM git_state WHERE repo_id='default'").get()) {
      call("set_git_state", { canonical_branch: "main", onboarding_sha: headSha(ctx) }, ctx);
    }
    return call("detect_changes", { current_sha: headSha(ctx) }, ctx);
  }
  function addFiles(ctx, subsystem, files) {
    call(
      "add_files_to_scope",
      {
        subsystem_id: subsystem,
        ref_sha: headSha(ctx),
        files: files.map(([file_path, classification]) => ({
          file_path,
          why_in_scope: "fixture",
          ...(classification ? { classification } : {}),
        })),
      },
      ctx,
    );
  }

  // A copy of the store as it stands, for the checker to read and for a
  // tamper to edit, without touching the store the world goes on using.
  let copies = 0;
  function snapshot(ctx) {
    ctx.db.pragma("wal_checkpoint(TRUNCATE)");
    copies += 1;
    const dest = join(scratch, `snap-${copies}.db`);
    copyFileSync(ctx.project.dbPath, dest);
    return dest;
  }
  /** A copy of `source` with the triggers on `tables` lifted and `fn` applied to it. */
  function edited(source, tables, fn) {
    copies += 1;
    const dest = join(scratch, `snap-${copies}.db`);
    copyFileSync(source, dest);
    const db = new DatabaseSync(dest);
    try {
      for (const table of tables) {
        const triggers = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?")
          .all(table);
        for (const { name } of triggers) db.exec(`DROP TRIGGER IF EXISTS "${name}"`);
      }
      fn(db);
    } finally {
      db.close();
    }
    return dest;
  }

  function runChecker(store, ws, extra = []) {
    const run = spawnSync(process.execPath, [checker, "--store", store, "--workspace", ws, ...extra], {
      cwd: repo,
      encoding: "utf8",
      timeout: 120_000,
      env: FIXTURE_GIT_ENV,
    });
    return { status: run.status, stdout: String(run.stdout ?? ""), stderr: String(run.stderr ?? "") };
  }
  function report(store, ws) {
    const run = runChecker(store, ws, ["--json"]);
    let parsed = null;
    try {
      parsed = JSON.parse(run.stdout);
    } catch {
      parsed = null;
    }
    if (!parsed?.clauses) {
      throw new Error(
        `the checker gave no report (exit ${run.status}): ${run.stderr.trim().split("\n").pop() ?? ""}`,
      );
    }
    return parsed;
  }
  const clauseOf = (parsed, number) => {
    const entry = parsed.clauses.find((candidate) => Number(candidate.clause) === number);
    if (!entry) throw new Error(`the report carries no clause ${number}`);
    return entry;
  };

  // =============================================================== world A
  //
  //   .gitignore        survey   ledgered irrelevant; sorted product in step 2
  //   README.md         survey   ledgered irrelevant; sorted product in step 2
  //   build/out.ts      gitignore (force-added), no ledger row
  //   design/proto.ts   user (rule `design/`), B-02's only ledger row
  //   notes/n.md        meta (sorting `notes/`), an inactive row in B-01
  //   src/a.ts          survey, product, B-01
  //   src/b.ts          survey, product, B-03

  const wsA = workspace(
    "a",
    {
      ".gitignore": "build/\n",
      "README.md": "# Fixture\n",
      "build/out.ts": "export const built = true;\n",
      "design/proto.ts": "export const proto = 1;\n",
      "notes/n.md": "# Notes\nWhat was tried, and why.\n",
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 2;\n",
    },
    ["build/out.ts"],
  );
  const ctx = open(wsA, "world a");
  for (const [id, name] of [
    ["B-01", "the code"],
    ["B-02", "the plans"],
    ["B-03", "the helpers"],
  ]) {
    call("upsert_subsystem", { id, name, status: "unmapped" }, ctx);
  }
  addFiles(ctx, "B-01", [
    ["src/a.ts", "examined"],
    ["README.md", "irrelevant"],
    [".gitignore", "irrelevant"],
    ["notes/n.md", "irrelevant"],
  ]);
  addFiles(ctx, "B-02", [["design/proto.ts"]]);
  addFiles(ctx, "B-03", [["src/b.ts"]]);
  call("add_concern", { code: "SC5-C1", category: "cache", origin: "seeded" }, ctx);
  call(
    "set_scope_rule",
    {
      pattern: "design/",
      action: "exclude",
      reason: "plans, not code",
      owner_words: '"leave that folder out of the survey"',
    },
    ctx,
  );
  call("record_scope_sorting", { pattern: "src/", category: "product", description: "the code" }, ctx);
  call(
    "record_scope_sorting",
    {
      pattern: "notes/",
      category: "meta",
      description: "working notes",
      inventory: [{ file_path: "notes/n.md", line_range: "1-2", excerpt: "# Notes" }],
    },
    ctx,
  );
  // Seams after the rule: upsert_seam writes none of the §2.6 paths. SM-01 is
  // between two in-survey subsystems; SM-02 and SM-03 each touch B-02.
  for (const [id, a, b] of [
    ["SM-01", "B-01", "B-03"],
    ["SM-02", "B-01", "B-02"],
    ["SM-03", "B-02", "B-03"],
  ]) {
    call("upsert_seam", { id, shared_object: `${id} object`, shared_object_kind: "table", party_a: a, party_b: b }, ctx);
  }

  const r1 = reconcile(ctx);
  const snapUnsorted = snapshot(ctx);

  call("record_scope_sorting", { pattern: "README.md", category: "product", description: "the readme" }, ctx);
  call("record_scope_sorting", { pattern: ".gitignore", category: "product", description: "ignore file" }, ctx);
  reconcile(ctx);
  const snapSorted = snapshot(ctx);

  const SURVEY = [".gitignore", "README.md", "src/a.ts", "src/b.ts"];

  check("S1 clause 1 is taken over the survey set: four paths, none of the three excluded ones owed", () => {
    if (r1?.ok === false) return `detect_changes refused: ${r1.error}`;
    const entry = clauseOf(report(snapSorted, wsA), 1);
    if (entry.evaluable !== true) return `clause 1 found no standing reconciliation: ${entry.note}`;
    if (entry.considered !== SURVEY.length) {
      return `considered ${entry.considered} path(s), want the ${SURVEY.length} of the survey set`;
    }
    if (!sameList(entry.missing, [])) return `owes ${show(entry.missing)}, want nothing`;
    return entry.satisfied === true ? null : "clause 1 is not satisfied over a fully sorted survey set";
  });

  check("U1 sorted mode: each path no sorting row covers is a named obligation unsorted:<path>", () => {
    const entry = clauseOf(report(snapUnsorted, wsA), 1);
    if (entry.evaluable !== true) return `clause 1 found no standing reconciliation: ${entry.note}`;
    if (entry.satisfied === true) return "clause 1 is satisfied with two unsorted paths";
    if (entry.considered !== SURVEY.length) return `considered ${entry.considered}, want ${SURVEY.length}`;
    return sameList(entry.missing, ["unsorted:.gitignore", "unsorted:README.md"])
      ? null
      : `owes ${show(entry.missing)}, want unsorted:.gitignore and unsorted:README.md`;
  });

  check("U2 once a sorting row covers a path it is no longer owed", () => {
    const entry = clauseOf(report(snapSorted, wsA), 1);
    return (entry.missing ?? []).some((id) => id.startsWith("unsorted:"))
      ? `still owes ${show(entry.missing)}`
      : null;
  });

  // ----------------------------------------------------------- both digests

  // A rule recorded after the reconciliation was taken (D1), a sorting row (D2).
  call("set_scope_rule", { pattern: "docs/", action: "exclude", reason: "a second rule", owner_words: '"and docs"' }, ctx);
  const snapRule = snapshot(ctx);
  call("record_scope_sorting", { pattern: "docs/", category: "product", description: "later sorting" }, ctx);
  const snapSorting = snapshot(ctx);

  const lostStanding = (store, sentence, what) => {
    const entry = clauseOf(report(store, wsA), 1);
    if (entry.evaluable === true && entry.satisfied === true) return `${what} left clause 1 satisfied`;
    if (entry.evaluable === true) return `${what} left a reconciliation standing: ${show(entry.missing)}`;
    if (!(entry.missing ?? []).includes("inventory:reconciliation")) {
      return `${what} did not name the missing reconciliation: ${show(entry.missing)}`;
    }
    return String(entry.note).includes(sentence)
      ? null
      : `${what} took standing away for another reason: ${entry.note}`;
  };

  check("D1 a rule recorded after the reconciliation ends its standing, with the rules' sentence", () =>
    lostStanding(snapRule, RULE_CHANGED, "a new rule"),
  );
  check("D2 a sorting row recorded after the reconciliation ends its standing, with the rules' sentence", () =>
    lostStanding(snapSorting, RULE_CHANGED, "a new sorting row"),
  );
  check("D3 an extra scope_exclusions row ends standing, with the exclusion sentence", () => {
    const store = edited(snapSorted, ["scope_exclusions"], (db) => {
      db.exec(
        `INSERT INTO scope_exclusions (reconciliation_id, file_path, source, rule_id)
         VALUES ((SELECT MAX(id) FROM scope_reconciliations), 'src/b.ts', 'gitignore', NULL)`,
      );
    });
    return lostStanding(store, EXCLUSIONS_CHANGED, "an extra exclusion row on src/b.ts");
  });
  check("D4 a swapped scope_exclusions row ends standing, with the exclusion sentence", () => {
    const store = edited(snapSorted, ["scope_exclusions"], (db) => {
      db.exec("UPDATE scope_exclusions SET file_path = 'README.md' WHERE file_path = 'notes/n.md'");
    });
    return lostStanding(store, EXCLUSIONS_CHANGED, "notes/n.md swapped for README.md");
  });
  check("D5 a re-sourced scope_exclusions row ends standing, with the exclusion sentence", () => {
    const store = edited(snapSorted, ["scope_exclusions"], (db) => {
      db.exec("UPDATE scope_exclusions SET source = 'gitignore', rule_id = NULL WHERE file_path = 'design/proto.ts'");
    });
    return lostStanding(store, EXCLUSIONS_CHANGED, "design/proto.ts re-sourced as gitignore");
  });
  check("D6 a recorded scope_digest that no longer matches the rows ends standing", () => {
    const store = edited(snapSorted, ["scope_reconciliations"], (db) => {
      db.exec(
        "UPDATE scope_reconciliations SET scope_digest = '00' || substr(scope_digest, 3) WHERE id = (SELECT MAX(id) FROM scope_reconciliations)",
      );
    });
    return lostStanding(store, RULE_CHANGED, "an edited scope_digest");
  });
  check("D7 a deleted scope_exclusions row ends standing, with the exclusion sentence", () => {
    const store = edited(snapSorted, ["scope_exclusions"], (db) => {
      db.exec("DELETE FROM scope_exclusions WHERE file_path = 'build/out.ts'");
    });
    return lostStanding(store, EXCLUSIONS_CHANGED, "a deleted exclusion row on build/out.ts");
  });

  // ------------------------------------------------------------ ledger digest

  check("G1 the ledger digest leaves out the excluded rows: B-02's and notes/n.md's rows do not stop the reconciliation standing", () => {
    const rows = ctx.db
      .prepare("SELECT file_path FROM file_ledger WHERE file_path IN ('design/proto.ts', 'notes/n.md')")
      .all();
    if (rows.length !== 2) return `the fixture's two inactive rows are ${show(rows)}`;
    const entry = clauseOf(report(snapSorted, wsA), 1);
    return entry.evaluable === true ? null : `a store with two inactive ledger rows does not reconcile: ${entry.note}`;
  });
  check("G2 a change to an inactive ledger row leaves the reconciliation standing", () => {
    const store = edited(snapSorted, [], (db) => {
      db.exec("UPDATE file_ledger SET classification = 'examined' WHERE file_path = 'design/proto.ts'");
    });
    const entry = clauseOf(report(store, wsA), 1);
    return entry.evaluable === true ? null : `changing an inactive row ended standing: ${entry.note}`;
  });
  check("G3 a change to an active ledger row ends standing, with the ledger's sentence", () => {
    const store = edited(snapSorted, [], (db) => {
      db.exec("UPDATE file_ledger SET classification = 'deferred-with-reason' WHERE file_path = 'src/a.ts'");
    });
    const entry = clauseOf(report(store, wsA), 1);
    if (entry.evaluable === true) return "changing an active row left the reconciliation standing";
    return String(entry.note).includes(LEDGER_CHANGED)
      ? null
      : `standing ended for another reason: ${entry.note}`;
  });

  // --------------------------------------------------- clauses 2, 3 and 4

  const text = (store, number) => runChecker(store, wsA, ["--clause", String(number)]).stdout;

  check("O1 clause 2 skips B-02, which is outside the survey, owes B-01 and B-03, and names B-02", () => {
    const parsed = report(snapSorted, wsA);
    const entry = clauseOf(parsed, 2);
    if (!sameList(entry.missing, ["subsystem:B-01:phase-sequence", "subsystem:B-03:phase-sequence"])) {
      return `owes ${show(entry.missing)}, want B-01 and B-03 only`;
    }
    if (entry.considered !== 2) return `considered ${entry.considered}, want the 2 in the survey`;
    if (!sameList(entry.outside_survey, ["B-02"])) return `names ${show(entry.outside_survey)} as outside, want B-02`;
    const line = text(snapSorted, 2).split("\n").find((l) => /outside the survey/.test(l)) ?? "";
    return /\bB-02\b/.test(line) && !/\bB-0[13]\b/.test(line)
      ? null
      : `the text report's outside-the-survey line is ${show(line)}`;
  });
  check("O2 clause 3 skips B-02's pairs, owes B-01's and B-03's, and names B-02", () => {
    const entry = clauseOf(report(snapSorted, wsA), 3);
    if (!sameList(entry.missing, ["concern:B-01/SC5-C1:disposition", "concern:B-03/SC5-C1:disposition"])) {
      return `owes ${show(entry.missing)}, want B-01's and B-03's pair only`;
    }
    if (entry.considered !== 2) return `considered ${entry.considered}, want 2`;
    if (!sameList(entry.outside_survey, ["B-02"])) return `names ${show(entry.outside_survey)} as outside, want B-02`;
    const line = text(snapSorted, 3).split("\n").find((l) => /outside the survey/.test(l)) ?? "";
    return /\bB-02\b/.test(line) ? null : `the text report's outside-the-survey line is ${show(line)}`;
  });
  check("O3 clause 4 skips the two seams that touch B-02, owes SM-01, and names SM-02 and SM-03", () => {
    const entry = clauseOf(report(snapSorted, wsA), 4);
    const want = ["seam:SM-01:endpoint:B-01", "seam:SM-01:endpoint:B-03", "seam:SM-01:integral-assessment"];
    if (!sameList(entry.missing, want)) return `owes ${show(entry.missing)}, want only SM-01's`;
    if (entry.considered !== 1) return `considered ${entry.considered}, want 1`;
    if (!sameList(entry.outside_survey, ["SM-02", "SM-03"])) {
      return `names ${show(entry.outside_survey)} as outside, want SM-02 and SM-03`;
    }
    const line = text(snapSorted, 4).split("\n").find((l) => /outside the survey/.test(l)) ?? "";
    return /SM-02/.test(line) && /SM-03/.test(line) && !/SM-01/.test(line)
      ? null
      : `the text report's outside-the-survey line is ${show(line)}`;
  });
  check("O4 with no standing reconciliation nothing is outside the survey, so no clause skips anything", () => {
    const parsed = report(snapRule, wsA);
    for (const [number, expected] of [
      [2, ["subsystem:B-01:phase-sequence", "subsystem:B-02:phase-sequence", "subsystem:B-03:phase-sequence"]],
    ]) {
      const entry = clauseOf(parsed, number);
      if (!sameList(entry.missing, expected)) return `clause ${number} owes ${show(entry.missing)}, want all three`;
      if ((entry.outside_survey ?? []).length > 0) {
        return `clause ${number} names ${show(entry.outside_survey)} as outside with no standing reconciliation`;
      }
    }
    return null;
  });

  // =============================================================== world L
  //
  // A legacy store: a reconciliation taken before survey scope existed, over a
  // store with no rules and no sorting rows. Its denominator is the whole
  // tree, and it owes no sorting.

  const wsL = workspace("l", { "README.md": "# Legacy\n", "src/a.ts": "export const a = 1;\n" });
  const ctxL = open(wsL, "legacy");
  call("upsert_subsystem", { id: "L-01", name: "legacy", status: "unmapped" }, ctxL);
  addFiles(ctxL, "L-01", [
    ["src/a.ts", "examined"],
    ["README.md", "irrelevant"],
  ]);
  reconcile(ctxL);
  const snapLegacyBase = snapshot(ctxL);
  const SCOPE_TABLES = [
    "scope_exclusions",
    "scope_inventory",
    "scope_rules",
    "scope_sorting",
    "scope_mode_changes",
    "scope_reconciliations",
  ];
  const snapLegacy = edited(snapLegacyBase, SCOPE_TABLES, (db) => {
    db.exec(
      `UPDATE scope_reconciliations SET scope_digest = NULL, exclusion_digest = NULL, excluded = NULL,
              unsorted = NULL, survey_paths = NULL, scope_mode = NULL`,
    );
    db.exec("DELETE FROM scope_exclusions");
    db.exec("DELETE FROM scope_mode_changes");
    db.exec("INSERT INTO scope_mode_changes (mode, reason) VALUES ('legacy', 'predates survey scope')");
  });

  check("L1 a legacy store reads as before: the whole tree is clause 1's denominator and nothing is owed", () => {
    const parsed = report(snapLegacy, wsL);
    const entry = clauseOf(parsed, 1);
    if (entry.evaluable !== true) return `clause 1 found no standing reconciliation: ${entry.note}`;
    if (entry.considered !== 2) return `considered ${entry.considered}, want the 2 tracked paths`;
    if (!sameList(entry.missing, [])) return `owes ${show(entry.missing)}, want nothing`;
    for (const number of [2, 3, 4]) {
      if ((clauseOf(parsed, number).outside_survey ?? []).length > 0) {
        return `clause ${number} names something as outside the survey in a legacy store`;
      }
    }
    return clauseOf(parsed, 2).considered === 1 ? null : "clause 2 did not consider the one subsystem";
  });
  check("L2 a legacy store with an owner rule recorded after its reconciliation no longer stands", () => {
    const store = edited(snapLegacy, SCOPE_TABLES, (db) => {
      db.exec(
        `INSERT INTO scope_rules (pattern, action, reason, owner_words)
         VALUES ('docs/', 'exclude', 'a rule after the upgrade', '"leave docs out"')`,
      );
    });
    return lostStandingIn(store, wsL, RULE_CHANGED, "an owner rule on a legacy store");
  });
  check("L3 a sorting row recorded on a legacy store ends its legacy reconciliation's standing too", () => {
    const store = edited(snapLegacy, SCOPE_TABLES, (db) => {
      db.exec("INSERT INTO scope_sorting (pattern, category, description) VALUES ('src/', 'product', 'the code')");
    });
    return lostStandingIn(store, wsL, RULE_CHANGED, "a sorting row on a legacy store");
  });
  check("L4 a store with none of the scope tables or columns is read, not refused", () => {
    const store = edited(snapLegacy, SCOPE_TABLES, (db) => {
      for (const table of ["scope_exclusions", "scope_inventory", "scope_rules", "scope_sorting", "scope_mode_changes"]) {
        db.exec(`DROP TABLE IF EXISTS ${table}`);
      }
    });
    const run = runChecker(store, wsL, ["--json"]);
    if (run.status === 2) return `the checker cannot run: ${run.stderr.trim().split("\n").pop()}`;
    const entry = clauseOf(report(store, wsL), 1);
    return entry.evaluable === true && entry.considered === 2 && sameList(entry.missing, [])
      ? null
      : `clause 1 reads ${show({ evaluable: entry.evaluable, considered: entry.considered, missing: entry.missing })}`;
  });

  function lostStandingIn(store, ws, sentence, what) {
    const entry = clauseOf(report(store, ws), 1);
    if (entry.evaluable === true) return `${what} left a reconciliation standing`;
    return String(entry.note).includes(sentence) ? null : `${what} took standing away for another reason: ${entry.note}`;
  }

  // ------------------------------------------------------------------- CI

  check("CI1 the gate is registered in the CI workflow", () => {
    const workflow = join(repo, ".github", "workflows", "test.yml");
    if (!existsSync(workflow)) return "the CI workflow is missing";
    return readFileSync(workflow, "utf8").includes("node dev/test-store-fully-surveyed-scope.mjs")
      ? null
      : "the CI workflow does not run dev/test-store-fully-surveyed-scope.mjs";
  });

  for (const cleanup of cleanups) cleanup();
  rmSync(scratch, { recursive: true, force: true });
}

// --------------------------------------------------------------- the driver

try {
  const mods = {};
  try {
    const load = (relative) => import(pathToFileURL(join(server, relative)).href);
    ({ openDatabase: mods.openDatabase } = await load("dist/db.js"));
    ({ resolveProject: mods.resolveProject, ensureProjectStorage: mods.ensureProjectStorage } =
      await load("dist/project.js"));
    const names = [
      ["concerns", "concernTools"],
      ["files", "fileTools"],
      ["git", "gitTools"],
      ["project", "projectTools"],
      ["scope", "scopeTools"],
      ["seams", "seamTools"],
      ["subsystems", "subsystemTools"],
    ];
    mods.toolArrays = await Promise.all(
      names.map(async ([file, name]) => (await load(`dist/tools/${file}.js`))[name]),
    );
    process.removeAllListeners("warning");
    process.on("warning", () => {});
    ({ DatabaseSync: mods.DatabaseSync } = await import("node:sqlite"));
  } catch (error) {
    failures.push(`L the server build could not be loaded: ${scrub(error?.message ?? error)}`);
  }
  if (failures.length === 0) {
    if (mods.toolArrays.some((tools) => !Array.isArray(tools))) {
      failures.push("L a tool array could not be read from mcp-server/dist/tools");
    } else {
      await main(mods);
    }
  }
} catch (error) {
  failures.push(`X the gate did not finish: ${scrub(error?.message ?? error)}`);
}

console.log(`  ran  ${checked} assertion(s) against ${join(server, "dist")}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`GATE SC5 RED: ${failures.length} of ${checked} assertion(s) failed; first: ${failures[0]}`);
  process.exit(1);
}
console.log("GATE SC5 GREEN");
process.exit(0);
