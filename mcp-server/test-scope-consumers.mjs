#!/usr/bin/env node
// GATE SC11 (design/scope/PLAN.md §3 SC11; §2.6a) — consumers of inactive
// ledger rows. A ledger row on a path the survey set excludes is kept, and
// creates no work.
//
// One store per arm, built the same way: subsystem S-01 owns `src/core.ts`
// (examined), `design/spec.md` (examined) and `design/draft.md` (candidate);
// `README.md` is sorted and never ledgered. In the `excluded` arm the owner
// excludes `design/` after the rows exist, so both design rows are inactive.
// Commit c1 then changes `design/spec.md` and nothing else. The `included` arm
// records no rule, so the same commit lands on an in-scope path: that is the
// positive control, and every route below must create work there.
//
// Turns red when:
//   1. `detect_changes` maps the change on the excluded path to its subsystem,
//      or marks the inactive row stale (D1); or the control's change is not
//      mapped or not marked stale (D0);
//   2. the stale backlog lists the inactive row (B1), or the control's stale
//      row is missing from it (B0), or an exclusion appended to the latest
//      reconciliation after it was taken hides that row (B2);
//   3. `get_attention` lists the inactive row in its stale section, or counts
//      it in the hot-spot stale, unread or obligation columns (A1); or the
//      control's row is not listed and counted (A0); or the open section's
//      empty state counts the inactive rows as examined or unread (A2);
//   4. change impact maps the change on the excluded path to a subsystem, or
//      opens a gap for it (I1); or the control's change is not mapped (I0), or
//      an in-scope changed path with no ledger row opens no gap (I2); or a
//      path added under the excluded prefix since the last reconciliation
//      opens a gap (I3); or a change on the excluded path reaches a finding or
//      invalidates a claim made before the rule (I5), while the control's
//      change does not reach both (I4);
//   5. review planning makes an inactive row required work, as a stale file or
//      an unverified file (R1); or the control's rows are not required (R0);
//   6. a refresh run blocks on drift over the inactive row (F1); or the
//      control's run does not block on the drift it cannot own (F0);
//   7. this gate is not registered in CI (CI1).
//   8. a fixture git command reads the machine's configuration: with a planted
//      global hooks path and template directory, a hook runs (HN1).
//
// Every fixture is a temporary git repository and a store under a temporary
// AMANUENSIS_STORAGE_ROOT; nothing here reads a real store or the network.
//
//   exit 0  `GATE SC11 GREEN`
//   exit 1  `GATE SC11 RED: <reason>`

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stableClaimKey } from "./fixtures/claim-key.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SUBSYSTEM = "S-01";
const CORE = "src/core.ts";
const SPEC = "design/spec.md";
const DRAFT = "design/draft.md";
const CLAIM = "SC11-CL-1";
const FINDING = "S01-1";

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

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (value) => JSON.stringify(value);

// ---------------------------------------------------------------- fixtures

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
function commitAll(cwd, message) {
  git(cwd, "add", "-A");
  git(
    cwd,
    "-c", "user.email=sc11@localhost",
    "-c", "user.name=scope-sc11",
    "-c", "commit.gpgsign=false",
    "commit", "-q", "--no-verify", "-m", message,
  );
  return git(cwd, "rev-parse", "HEAD");
}

function main(mods) {
  const { openDatabase, resolveProject, ensureProjectStorage, toolArrays } = mods;
  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  function call(name, args, ctx) {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    return td.handler(args, ctx);
  }

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-sc11-"));
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
  // Every git this gate runs, its fixtures' and the server's own (the store's
  // storage commits run in this process), reads no configuration but its
  // repository's: no global or system file. HN1 turns red without this.
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";

  /**
   * One arm's store at c1. `excluded`: the owner excludes `design/` after the
   * rows exist. `ledgerSpec`: whether `design/spec.md` has a ledger row at all.
   */
  function build(label, { excluded, ledgerSpec = true, records = false, source = "user" }) {
    const ws = join(scratch, `ws-${label}`);
    const write = (name, body) => {
      mkdirSync(dirname(join(ws, name)), { recursive: true });
      writeFileSync(join(ws, name), body);
    };
    mkdirSync(ws, { recursive: true });
    git(ws, "init", "-q", "--template=");
    write(CORE, "export const value = 1;\n");
    write(SPEC, "# Spec\n\nThe value is one.\n");
    write(DRAFT, "# Draft\n\nNot settled.\n");
    write("README.md", "# Fixture\n");
    const c0 = commitAll(ws, "seed");

    const project = resolveProject(ws, { selectionSource: `sc11-${label}` });
    ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
    const ctx = { project, db: openDatabase(project.dbPath), sessionId: null };
    cleanups.push(() => {
      try {
        ctx.db.close();
      } catch {
        /* already reported */
      }
    });
    ctx.sessionId = call("start_session", { intent: `sc11 ${label}` }, ctx).session_id;

    call("upsert_subsystem", { id: SUBSYSTEM, name: "Core", status: "unmapped" }, ctx);
    call("update_subsystem_status", { id: SUBSYSTEM, status: "scoping" }, ctx);
    const files = [
      { file_path: CORE, why_in_scope: "the code", classification: "examined" },
      { file_path: DRAFT, why_in_scope: "a draft beside the code", classification: "candidate" },
    ];
    if (ledgerSpec) {
      files.push({ file_path: SPEC, why_in_scope: "the spec the code follows", classification: "examined" });
    }
    call("add_files_to_scope", { subsystem_id: SUBSYSTEM, ref_sha: c0, files }, ctx);
    const sortingIds = {};
    for (const pattern of ["src/", "design/", "README.md", ".gitignore"]) {
      sortingIds[pattern] = call("record_scope_sorting", { pattern, category: "product", description: `fixture ${pattern}` }, ctx).id;
    }
    call("set_git_state", { canonical_branch: "main", onboarding_sha: c0 }, ctx);
    call("detect_changes", { current_sha: c0 }, ctx);
    // Records made before the owner's rule: a claim whose evidence is on the
    // spec, and a finding that names it as a primary file (§2.6a).
    if (records) {
      const evidenceId = call(
        "add_evidence",
        { file_path: SPEC, symbol: "Spec", line_range: "1-3", ref_sha: c0, kind: "code-verified" },
        ctx,
      ).id;
      call(
        "add_claim",
        {
          claim_id: CLAIM,
          claim_key: stableClaimKey(SUBSYSTEM, "spec-value", `${SPEC}:Spec`),
          subject_type: "symbol",
          subject_id: `${SPEC}:Spec`,
          statement: "The spec says the value is one.",
          epistemic_kind: "observation",
          ref_sha: c0,
          evidence_ids: [evidenceId],
        },
        ctx,
      );
      ctx.db
        .prepare(
          `INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status, primary_files, ref_sha)
           VALUES (?, ?, 'fixture symptom', 'fixture cause', 'LOW', 'confirmed-bug', ?, ?)`,
        )
        .run(FINDING, SUBSYSTEM, JSON.stringify([`${SPEC}:Spec@${c0}`]), c0);
    }
    // The exclusion, from the source asked for: the owner's rule, a meta row
    // that withdraws the product row over design/, or the repository's own
    // .gitignore, committed after the rows and before the change.
    let base = c0;
    if (excluded && source === "user") {
      call(
        "set_scope_rule",
        {
          pattern: "design/",
          action: "exclude",
          reason: "plans, not code",
          owner_words: "don't survey design/",
        },
        ctx,
      );
    } else if (excluded && source === "meta") {
      call(
        "record_scope_sorting",
        {
          pattern: "design/",
          category: "meta",
          description: "plans",
          supersedes: sortingIds["design/"],
          inventory: [{ file_path: SPEC, line_range: "1", excerpt: "# Spec" }],
        },
        ctx,
      );
    } else if (excluded && source === "gitignore") {
      write(".gitignore", "design/\n");
      base = commitAll(ws, "ignore design/");
    }
    if (excluded) call("detect_changes", { current_sha: base }, ctx);

    write(SPEC, "# Spec\n\nThe value is two.\n");
    const c1 = commitAll(ws, "change the spec only");
    return { ctx, ws, c0: base, c1 };
  }

  const specRow = (ctx) =>
    ctx.db
      .prepare("SELECT stale, stale_reason FROM file_ledger WHERE subsystem_id = ? AND file_path = ?")
      .get(SUBSYSTEM, SPEC);

  const arms = {
    excluded: build("excluded", { excluded: true }),
    included: build("included", { excluded: false }),
  };

  // ------------------------------------------------------- detect_changes
  const detected = {};
  for (const [arm, fx] of Object.entries(arms)) {
    detected[arm] = call("detect_changes", { current_sha: fx.c1 }, fx.ctx);
  }

  check("D0 control: detect_changes maps the in-scope change to its subsystem and marks the row stale", () => {
    const r = detected.included;
    const wrong = [];
    const mapped = (r.stale_subsystems ?? []).map((s) => [s.subsystem_id, [...s.changed_files].sort()]);
    if (!same(mapped, [[SUBSYSTEM, [SPEC]]])) wrong.push(`stale_subsystems ${show(r.stale_subsystems)}`);
    const row = specRow(arms.included.ctx);
    if (!same(row, { stale: 1, stale_reason: "git-drift" })) wrong.push(`the row is ${show(row)}`);
    if (r.stale_files !== 1) wrong.push(`stale_files is ${show(r.stale_files)}`);
    return wrong.length ? wrong.join("; ") : null;
  });

  check("D1 detect_changes neither maps the excluded change nor marks the inactive row stale", () => {
    const r = detected.excluded;
    const wrong = [];
    const excludedRow = (r.excluded_with_rows ?? []).some((e) => e.file_path === SPEC);
    if (!excludedRow) wrong.push(`the fixture's row is not excluded: ${show(r.excluded_with_rows)}`);
    if (!same(r.stale_subsystems, [])) wrong.push(`stale_subsystems ${show(r.stale_subsystems)}`);
    const row = specRow(arms.excluded.ctx);
    if (!same(row, { stale: 0, stale_reason: null })) wrong.push(`the inactive row is ${show(row)}`);
    if (r.stale_files !== 0) wrong.push(`stale_files is ${show(r.stale_files)}`);
    return wrong.length ? wrong.join("; ") : null;
  });

  // A row marked stale before the owner's rule was recorded keeps its flag:
  // nothing is deleted or rewritten (§2.6a). Set here so each reader below is
  // tested on its own, not only through detect_changes declining to mark it.
  arms.excluded.ctx.db
    .prepare(
      `UPDATE file_ledger SET stale = 1, stale_since = datetime('now'), stale_reason = 'git-drift'
        WHERE subsystem_id = ? AND file_path = ?`,
    )
    .run(SUBSYSTEM, SPEC);

  // ----------------------------------------------------------- the backlog
  const backlog = (arm) =>
    call("get_stale_backlog", { limit: 50 }, arms[arm].ctx).map((row) => `${row.subsystem_id}:${row.source_path}`);

  check("B0 control: the stale backlog lists the in-scope stale row", () => {
    const rows = backlog("included");
    return same(rows, [`${SUBSYSTEM}:${SPEC}`]) ? null : `the backlog is ${show(rows)}`;
  });
  check("B1 the stale backlog leaves out the inactive row", () => {
    const rows = backlog("excluded");
    return same(rows, []) ? null : `the backlog is ${show(rows)}`;
  });

  // An exclusion row appended to the latest reconciliation after it was
  // taken fails that row's exclusion_digest, so standing falls back to an
  // earlier reconciliation. The consumers must not trust the appended row
  // either: inactive is decided by the latest reconciliation whose exclusions
  // verify. Tampered with the triggers lifted, inside a rolled-back
  // transaction.
  check("B2 an exclusion appended after the reconciliation does not make an in-scope row inactive", () => {
    const { db } = arms.included.ctx;
    const latest = db.prepare("SELECT MAX(id) AS id FROM scope_reconciliations").get().id;
    db.exec("BEGIN");
    try {
      for (const name of ["scope_exclusion_is_immutable", "scope_exclusion_cannot_be_replaced"]) {
        db.exec(`DROP TRIGGER IF EXISTS ${name}`);
      }
      db.prepare(
        "INSERT INTO scope_exclusions (reconciliation_id, file_path, source, rule_id) VALUES (?, ?, 'gitignore', NULL)",
      ).run(latest, SPEC);
      const rows = backlog("included");
      return same(rows, [`${SUBSYSTEM}:${SPEC}`]) ? null : `the backlog is ${show(rows)}`;
    } finally {
      db.exec("ROLLBACK");
    }
  });

  // ---------------------------------------------------------- get_attention
  const attention = (arm) => call("get_attention", { sections: ["stale", "hot_spots"] }, arms[arm].ctx);
  const attentionView = (payload) => {
    const stale = payload?.sections?.stale;
    const spot = (payload?.sections?.hot_spots?.items ?? []).find((item) => item.subsystem_id === SUBSYSTEM);
    return {
      stale_ledger: (stale?.items ?? [])
        .filter((item) => item.source === "ledger")
        .map((item) => `${item.subsystem_id}:${item.file_path}`),
      stale_counts: stale?.counts ?? null,
      stale_files: spot?.stale_files ?? null,
      unread: spot?.unread ?? null,
    };
  };

  check("A0 control: get_attention lists the in-scope stale row and counts the subsystem's rows", () => {
    const view = attentionView(attention("included"));
    const expected = {
      stale_ledger: [`${SUBSYSTEM}:${SPEC}`],
      stale_counts: { claim: 0, ledger: 1, drifted_unread: 0, drifted_deferred: 0 },
      stale_files: 1,
      unread: { candidate: 1, obligation_bearing: 3 },
    };
    return same(view, expected) ? null : `get_attention reads ${show(view)}`;
  });
  check("A1 get_attention leaves the inactive rows out of the stale section and the hot-spot counts", () => {
    const view = attentionView(attention("excluded"));
    const expected = {
      stale_ledger: [],
      stale_counts: { claim: 0, ledger: 0, drifted_unread: 0, drifted_deferred: 0 },
      stale_files: 0,
      unread: { candidate: 0, obligation_bearing: 1 },
    };
    return same(view, expected) ? null : `get_attention reads ${show(view)}`;
  });

  // The open section's empty state counts the active ledger: an inactive row
  // is neither examined nor still to be read. Neither arm records a finding,
  // so both answer with the empty state.
  const openCounts = (arm) => {
    const statement = String(call("get_attention", { sections: ["open"] }, arms[arm].ctx)?.sections?.open?.statement ?? "");
    const match = /over (\d+) examined file\(s\).*?; (\d+) file\(s\) are scoped but not yet read/.exec(statement);
    return match ? { examined: Number(match[1]), unread: Number(match[2]) } : { statement };
  };
  check("A2 get_attention's open section counts the active ledger, with the included arm as control", () => {
    const got = { included: openCounts("included"), excluded: openCounts("excluded") };
    const want = { included: { examined: 2, unread: 1 }, excluded: { examined: 1, unread: 0 } };
    return same(got, want) ? null : `the open section reads ${show(got)}, want ${show(want)}`;
  });

  // ---------------------------------------------------------- change impact
  const impactView = (arm, fx, runId) => {
    const r = call("predict_change_impact", { base_sha: fx.c0, head_sha: fx.c1, run_id: runId }, fx.ctx);
    return {
      subsystems: (r.mapped_objects ?? [])
        .filter((o) => o.object_type === "subsystem")
        .map((o) => o.object_id)
        .sort(),
      gaps: (r.gaps ?? []).map((o) => o.object_id).sort(),
    };
  };

  check("I0 control: change impact maps the in-scope change to its subsystem", () => {
    const view = impactView("included", arms.included, "sc11-impact-included");
    return same(view, { subsystems: [SUBSYSTEM], gaps: [] }) ? null : `impact reads ${show(view)}`;
  });
  check("I1 change impact neither maps the excluded change nor opens a gap for it", () => {
    const view = impactView("excluded", arms.excluded, "sc11-impact-excluded");
    return same(view, { subsystems: [], gaps: [] }) ? null : `impact reads ${show(view)}`;
  });
  check("I2 control: an in-scope changed path with no ledger row opens a gap", () => {
    const fx = build("unledgered", { excluded: false, ledgerSpec: false });
    const view = impactView("unledgered", fx, "sc11-impact-unledgered");
    return same(view, { subsystems: [], gaps: [`unmapped-file:${SPEC}`] }) ? null : `impact reads ${show(view)}`;
  });

  // A path added under the excluded prefix after the last reconciliation is
  // excluded at the revision it appears in: no gap (§2.6a, §2.2).
  check("I3 change impact opens no gap for a path added under an excluded prefix since the last reconciliation", () => {
    const fx = build("late", { excluded: true });
    const added = "design/new.md";
    mkdirSync(dirname(join(fx.ws, added)), { recursive: true });
    writeFileSync(join(fx.ws, added), "# New\n\nA later plan.\n");
    const c2 = commitAll(fx.ws, "add a plan under the excluded prefix");
    const r = call("predict_change_impact", { base_sha: fx.c1, head_sha: c2, run_id: "sc11-impact-late" }, fx.ctx);
    const view = {
      subsystems: (r.mapped_objects ?? []).filter((o) => o.object_type === "subsystem").map((o) => o.object_id),
      gaps: (r.gaps ?? []).map((o) => o.object_id),
    };
    return same(view, { subsystems: [], gaps: [] }) ? null : `impact reads ${show(view)}`;
  });

  // The records made before the rule: a change to the excluded path reaches
  // neither the finding nor the claim in the excluded arm; the same change
  // reaches both in the included arm.
  const recordsView = (arm, excluded) => {
    const fx = build(arm, { excluded, records: true });
    const r = call("predict_change_impact", { base_sha: fx.c0, head_sha: fx.c1, run_id: `sc11-impact-${arm}` }, fx.ctx);
    return {
      findings: (r.mapped_objects ?? []).filter((o) => o.object_type === "finding").map((o) => o.object_id),
      invalidated: (r.invalidated_claims ?? []).map((o) => o.object_id),
    };
  };
  check("I4 control: change impact reaches the in-scope path's finding and invalidates its claim", () => {
    const view = recordsView("records-included", false);
    return same(view, { findings: [FINDING], invalidated: [CLAIM] }) ? null : `impact reads ${show(view)}`;
  });
  check("I5 change impact neither reaches a finding nor invalidates a claim through an excluded path", () => {
    const view = recordsView("records-excluded", true);
    return same(view, { findings: [], invalidated: [] }) ? null : `impact reads ${show(view)}`;
  });

  // A seam into a subsystem outside the survey is crossed by nothing: a change
  // to the in-scope code reaches neither the outside subsystem, nor the seam,
  // nor a claim about either (final review, F5/codex). B-02 owns only the
  // spec, so the owner's rule puts it outside; the included arm is the control.
  const outsideSeamView = (arm, excluded) => {
    const fx = build(arm, { excluded: false, ledgerSpec: false });
    const ctx = fx.ctx;
    call("upsert_subsystem", { id: "B-02", name: "Plans", status: "unmapped" }, ctx);
    call("update_subsystem_status", { id: "B-02", status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      { subsystem_id: "B-02", ref_sha: fx.c0, files: [{ file_path: SPEC, why_in_scope: "the plan", classification: "examined" }] },
      ctx,
    );
    call("upsert_seam", { id: "SM-OUT", shared_object: "the value", party_a: SUBSYSTEM, party_b: "B-02" }, ctx);
    const evidenceId = call(
      "add_evidence",
      { file_path: SPEC, symbol: "Spec", line_range: "1-3", ref_sha: fx.c0, kind: "code-verified" },
      ctx,
    ).id;
    for (const [claimId, subjectType, subjectId] of [
      ["C-OUT", "subsystem", "B-02"],
      ["C-SEAM", "seam", "SM-OUT"],
    ]) {
      call(
        "add_claim",
        {
          claim_id: claimId,
          claim_key: `sc11.${claimId.toLowerCase()}`,
          subject_type: subjectType,
          subject_id: subjectId,
          statement: `The fixture's ${subjectId} holds.`,
          epistemic_kind: "observation",
          ref_sha: fx.c0,
          evidence_ids: [evidenceId],
        },
        ctx,
      );
    }
    if (excluded) {
      call(
        "set_scope_rule",
        { pattern: "design/", action: "exclude", reason: "plans, not code", owner_words: "don't survey design/" },
        ctx,
      );
    }
    call("detect_changes", { current_sha: fx.c1 }, ctx);
    writeFileSync(join(fx.ws, CORE), "export const value = 3;\n");
    const c2 = commitAll(fx.ws, "change the code only");
    const r = call("predict_change_impact", { base_sha: fx.c1, head_sha: c2, run_id: `sc11-impact-${arm}` }, ctx);
    return {
      subsystems: (r.mapped_objects ?? []).filter((o) => o.object_type === "subsystem").map((o) => o.object_id).sort(),
      seams: (r.mapped_objects ?? []).filter((o) => o.object_type === "seam").map((o) => o.object_id).sort(),
      invalidated: (r.invalidated_claims ?? []).map((o) => o.object_id).sort(),
    };
  };
  check("I6 control: with nothing excluded, a code change crosses the seam to B-02 and its claims", () => {
    const view = outsideSeamView("seam-included", false);
    const want = { subsystems: ["B-02", SUBSYSTEM], seams: ["SM-OUT"], invalidated: ["C-OUT", "C-SEAM"] };
    return same(view, want) ? null : `impact reads ${show(view)}, want ${show(want)}`;
  });
  check("I7 change impact crosses no seam into a subsystem outside the survey", () => {
    const view = outsideSeamView("seam-excluded", true);
    const want = { subsystems: [SUBSYSTEM], seams: [], invalidated: [] };
    return same(view, want) ? null : `impact reads ${show(view)}, want ${show(want)}`;
  });

  // The inactive-row controls hold for every source, not only the owner's rule:
  // a consumer that treated only `user` exclusions as inactive would leave meta
  // and gitignored rows creating work (final review, F12/codex).
  for (const source of ["meta", "gitignore"]) {
    check(`X1 a ${source} exclusion makes the row inactive for detect_changes, the backlog and change impact`, () => {
      const fx = build(`source-${source}`, { excluded: true, source });
      const wrong = [];
      const r = call("detect_changes", { current_sha: fx.c1 }, fx.ctx);
      const row = (r.excluded_with_rows ?? []).find((e) => e.file_path === SPEC);
      if (row?.source !== source) wrong.push(`excluded_with_rows ${show(r.excluded_with_rows)}`);
      if (!same(r.stale_subsystems, [])) wrong.push(`stale_subsystems ${show(r.stale_subsystems)}`);
      if (!same(specRow(fx.ctx), { stale: 0, stale_reason: null })) wrong.push(`the inactive row is ${show(specRow(fx.ctx))}`);
      fx.ctx.db
        .prepare("UPDATE file_ledger SET stale = 1, stale_reason = 'git-drift' WHERE subsystem_id = ? AND file_path = ?")
        .run(SUBSYSTEM, SPEC);
      const rows = call("get_stale_backlog", { limit: 50 }, fx.ctx).map((e) => `${e.subsystem_id}:${e.source_path}`);
      if (!same(rows, [])) wrong.push(`the backlog is ${show(rows)}`);
      const impact = call("predict_change_impact", { base_sha: fx.c0, head_sha: fx.c1, run_id: `sc11-impact-${source}` }, fx.ctx);
      const mapped = (impact.mapped_objects ?? []).filter((o) => o.object_type === "subsystem").map((o) => o.object_id);
      const gaps = (impact.gaps ?? []).map((o) => o.object_id);
      if (!same({ mapped, gaps }, { mapped: [], gaps: [] })) wrong.push(`impact reads ${show({ mapped, gaps })}`);
      return wrong.length ? wrong.join("; ") : null;
    });
  }

  // ------------------------------------------------------------ refresh run
  const refreshView = (arm) => {
    const fx = arms[arm];
    const storage = fx.ctx.project.storagePath;
    const runId = `sc11-refresh-${arm}`;
    const plan = call(
      "plan_refresh_run",
      {
        run_id: runId,
        replicate_id: `sc11-replicate-${arm}`,
        base_sha: fx.c0,
        head_sha: fx.c1,
        allowed_sources: ["src"],
        provider_allowlist: ["fixture-provider"],
        selected_provider: "fixture-provider",
        model: "fixture-model",
        runtime: "fixture-runtime",
        determinism_mode: "seeded",
        determinism_seed: 42,
        relation_discovery: "explicit-only",
        max_depth: 4,
        authority_mode: "conspectus-write",
        allowed_write_prefixes: ["docs"],
        allowed_side_effects: ["analysis-api-call", "conspectus-write"],
        auto_dispatch: true,
        max_concurrency: 1,
        max_attempts_per_obligation: 2,
        max_tokens_per_attempt: 1000,
        max_total_tokens: 3000,
        max_total_cost_microusd: 3000,
        planned_tokens_per_attempt: 500,
        planned_cost_microusd: 500,
        output_dir: join(storage, "docs"),
      },
      fx.ctx,
    );
    if (plan?.status === "blocked") return { planned: `blocked: ${show(plan.blocking_reasons)}` };
    let thrown = null;
    try {
      call("execute_refresh_run", { run_id: runId }, fx.ctx);
    } catch (error) {
      thrown = String(error?.message ?? error);
    }
    const events = fx.ctx.db
      .prepare("SELECT stage, event_type, idempotency_key, detail_json FROM refresh_stage_events WHERE run_id = ? ORDER BY rowid")
      .all(runId);
    const drift = events.find((e) => e.idempotency_key === "unowned-drift");
    return {
      thrown,
      drift: drift ? JSON.parse(drift.detail_json).unowned : null,
      reached_readback: events.some((e) => e.stage === "readback"),
    };
  };

  check("F0 control: a refresh run blocks on drift over the in-scope row it cannot own", () => {
    const view = refreshView("included");
    const expected = { thrown: null, drift: [`${SUBSYSTEM}:${SPEC}`], reached_readback: false };
    return same(view, expected) ? null : `the run reads ${show(view)}`;
  });
  check("F1 a refresh run does not block on drift over the inactive row", () => {
    const view = refreshView("excluded");
    // The run goes on past the drift check to verification, where this
    // fixture's unledgered README.md refuses publication: proof it got there.
    const expected = { thrown: null, drift: null, reached_readback: true };
    return same(view, expected) ? null : `the run reads ${show(view)}`;
  });

  // ------------------------------------------------------- review planning
  // A second commit changes the in-scope code, so S-01 is impacted in both
  // arms and the review brief reads its ledger rows.
  const reviewView = (arm) => {
    const fx = arms[arm];
    writeFileSync(join(fx.ws, CORE), "export const value = 2;\n");
    const c2 = commitAll(fx.ws, "change the code");
    const impactRun = `sc11-review-impact-${arm}`;
    call("predict_change_impact", { base_sha: fx.c1, head_sha: c2, run_id: impactRun }, fx.ctx);
    const briefId = `sc11-brief-${arm}`;
    call(
      "compile_review_brief",
      {
        brief_id: briefId,
        impact_run_id: impactRun,
        task: "Review the change to the code.",
        task_constraints: [
          {
            constraint_id: "keep-value",
            statement: "Keep the exported name.",
            source_kind: "direct-user",
            source_ref: "request:sc11",
          },
        ],
        context_profile: "diff-scoped",
        token_budget: 20_000,
      },
      fx.ctx,
    );
    return fx.ctx.db
      .prepare(
        `SELECT object_type, object_id FROM review_brief_trace
          WHERE brief_id = ? AND object_type IN ('stale-file', 'unverified-file')
          ORDER BY object_type, object_id`,
      )
      .all(briefId)
      .map((row) => `${row.object_type}:${row.object_id}`);
  };

  check("R0 control: review planning requires the impacted subsystem's stale and unverified rows", () => {
    const items = reviewView("included");
    const expected = [`stale-file:${SUBSYSTEM}:${SPEC}`, `unverified-file:${SUBSYSTEM}:${DRAFT}`];
    return same(items, expected) ? null : `the brief requires ${show(items)}`;
  });
  check("R1 review planning does not make an inactive row required work", () => {
    const items = reviewView("excluded");
    return same(items, []) ? null : `the brief requires ${show(items)}`;
  });

  check("CI1 this gate runs in CI, in the mcp-server job", () => {
    const workflow = join(here, "..", ".github", "workflows", "test.yml");
    if (!existsSync(workflow)) return ".github/workflows/test.yml is absent";
    return readFileSync(workflow, "utf8").includes("node test-scope-consumers.mjs")
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
    ({ openDatabase: mods.openDatabase } = await import("./dist/db.js"));
    ({ resolveProject: mods.resolveProject, ensureProjectStorage: mods.ensureProjectStorage } =
      await import("./dist/project.js"));
    const names = [
      ["files", "fileTools"],
      ["claims", "claimTools"],
      ["evidence", "evidenceTools"],
      ["git", "gitTools"],
      ["impact", "impactTools"],
      ["locus", "locusTools"],
      ["project", "projectTools"],
      ["refresh", "refreshTools"],
      ["review", "reviewTools"],
      ["scope", "scopeTools"],
      ["seams", "seamTools"],
      ["stale", "staleTools"],
      ["subsystems", "subsystemTools"],
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
  console.log(`GATE SC11 RED: ${failures.length} of ${checked} assertion(s) failed; first: ${failures[0]}`);
  process.exit(1);
}
console.log("GATE SC11 GREEN");
process.exit(0);
