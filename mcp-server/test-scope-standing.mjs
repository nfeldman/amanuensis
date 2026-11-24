#!/usr/bin/env node
// GATE SC6 (design/scope/PLAN.md §3 SC6; §2.7, §2.6a) — the readers over the survey set:
// describe_locus, get_dashboard, list_subsystems and the code index.
//
// One workspace and one store, built the way the owner's survey is: the owner excludes
// `design/` and `Makefile` after records about them exist, `gen/out.ts` is matched by the
// repository's ignore files, `notes/` is sorted meta, `gen/kept.ts` is gitignored and
// included by the owner, `vendor/lib.ts` is a ledger-exempt (vendor-ignore) row inside the
// survey set, and `misc/stray.txt` is covered by no sorting row. Subsystem S-02 owns only
// `design/` rows, so it is outside the survey, and so is its seam to S-01.
//
// Turns red when:
//   1. describe_locus on an excluded path does not answer standing `excluded` with
//      `exclusion: {source, rule_id, pattern, reason}` for each of the three sources (user,
//      gitignore, meta), or does so for a path the survey keeps, or a symbol locus on an
//      excluded path does not carry it on its file block, or a bare file name the owner
//      excluded is answered as an undefined term (E1-E5);
//   2. a ledger-exempt path inside the survey set does not answer `excluded` with
//      `source: "ledger"` and its classification, or an included path that is also
//      gitignored has anything but ordinary standing, or an unledgered in-scope path stops
//      answering `unledgered` (L1-L3);
//   3. a describe_locus response does not validate against
//      contracts/locus-account.schema.json (S1), or the `excluded` value's meaning in
//      contracts/conspectus-vocabulary.json does not name the survey set (V1), or
//      gen-vocabulary.mjs --check or --check-sql fails (V2, V3);
//   4. get_dashboard does not count the excluded paths by source and the unsorted paths,
//      or counts the inactive ledger rows, or does not report the subsystem and the seam
//      outside the survey (D1-D3); list_subsystems or describe_locus on a subsystem does not
//      say which subsystem is outside the survey, or describe_locus counts a subsystem's
//      inactive rows or their evidence (D4-D6); get_dashboard's excluded_paths and its
//      description disagree about a deleted excluded ledgered path (D7);
//   5. find_symbol returns a definition in an excluded path by default, or leaves it out
//      with include_excluded: true, or a limited page is short because of it, even past more
//      excluded rows than its widest window (F1-F4);
//   6. search_records returns a hit whose subject is an excluded file locus or a subsystem
//      outside the survey, drops a record that cites both included and excluded evidence,
//      ignores include_excluded or include_history for the same rule, or filters after the
//      page is cut so page 1 is short while more hits exist, or history search serves a closed
//      record on an excluded locus, or a record located at a bare excluded file name (R1-R7);
//   7. outline_file or read_symbol on an excluded path does not answer, or does not carry
//      `excluded` with its source, or carries it on an included path (O1-O3);
//   8. a recorded exclusion stops answering `excluded` when git cannot read the workspace, or
//      a file and its subsystem disagree about a rule recorded since the last reconciliation
//      (U1, U2);
//   9. a server's instructions do not name the new standing source (I1), or this gate is
//      not registered in CI (CI1).
//
// Every fixture is a temporary git repository and a store under a temporary
// AMANUENSIS_STORAGE_ROOT; nothing here reads a real store or the network.
//
//   exit 0  `GATE SC6 GREEN`
//   exit 1  `GATE SC6 RED: <reason>`

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stableClaimKey } from "./fixtures/claim-key.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const S1 = "S-01";
const S2 = "S-02";

// A crash signature in this gate's output means the run never reached its assertion, so the
// launcher rejects it as a red proof. Detail quoted from a live error is scrubbed.
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
  return out.slice(0, 500);
}

const failures = [];
let checked = 0;
async function check(label, fn) {
  checked++;
  try {
    const detail = await fn();
    if (detail) failures.push(`${label}: ${scrub(detail)}`);
  } catch (error) {
    failures.push(`${label}: threw — ${scrub(error?.message ?? error)}`);
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (value) => scrub(JSON.stringify(value));

// ---------------------------------------------------------------- fixtures

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
  // The ignored files are tracked on purpose: a tracked path the ignore files match is the
  // case the survey set exists for.
  git(cwd, "add", "-f", "gen/out.ts", "gen/kept.ts");
  git(
    cwd,
    "-c", "user.email=sc6@localhost",
    "-c", "user.name=scope-sc6",
    "-c", "commit.gpgsign=false",
    "commit", "-q", "--no-verify", "-m", message,
  );
  return git(cwd, "rev-parse", "HEAD");
}

const SOURCES = {
  ".gitignore": "gen/out.ts\n",
  "README.md": "# Fixture\n",
  Makefile: "all:\n\ttrue\n",
  "src/core.ts": "export function includedThing(): number {\n  return 1;\n}\n",
  "src/other.ts": "export const unledgered = 2;\nexport const used = includedThing();\n",
  "vendor/lib.ts": "export function vendorThing(): number {\n  return 3;\n}\n",
  "design/spec.md": "# Spec\n\nThe value is one.\n",
  // More references in an excluded path than find_symbol's widest window, ahead of the one
  // included reference in path order (F4).
  "design/tool.ts": `export function excludedThing(): number {\n  return 4;\n}\n${"includedThing();\n".repeat(5001)}`,
  "notes/log.md": "# Log\n\nA working note.\n",
  "notes/helper.ts": "export function metaThing(): number {\n  return 5;\n}\n",
  "gen/out.ts": "export function ignoredThing(): number {\n  return 6;\n}\n",
  "gen/kept.ts": "export function keptThing(): number {\n  return 7;\n}\n",
  "misc/stray.txt": "no sorting row covers this\n",
};

const CODE_LOCI = {
  user: "design/tool.ts",
  gitignore: "gen/out.ts",
  meta: "notes/helper.ts",
};

async function main(mods) {
  const { openDatabase, resolveProject, ensureProjectStorage, toolArrays } = mods;
  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  async function call(name, args, ctx) {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    return await td.handler(args, ctx);
  }

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-sc6-"));
  process.env.AMANUENSIS_STORAGE_ROOT = join(scratch, "storage");
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("AMANUENSIS_CODE_INDEX")) delete process.env[key];
  }

  const ws = join(scratch, "ws");
  mkdirSync(ws, { recursive: true });
  git(ws, "init", "-q", "--template=");
  for (const [name, body] of Object.entries(SOURCES)) {
    mkdirSync(dirname(join(ws, name)), { recursive: true });
    writeFileSync(join(ws, name), body);
  }
  const c0 = commitAll(ws, "seed");

  const project = resolveProject(ws, { selectionSource: "sc6-gate" });
  ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
  const ctx = { project, db: openDatabase(project.dbPath), sessionId: null };
  ctx.sessionId = (await call("start_session", { intent: "sc6 gate" }, ctx)).session_id;

  for (const [id, name] of [[S1, "Core"], [S2, "Design"]]) {
    await call("upsert_subsystem", { id, name, status: "unmapped" }, ctx);
    await call("update_subsystem_status", { id, status: "scoping" }, ctx);
  }
  // gen/kept.ts is gitignored; the owner includes it back before it is ledgered.
  await call(
    "set_scope_rule",
    { pattern: "gen/kept.ts", action: "include", reason: "generated, but ours", owner_words: "survey gen/kept.ts after all" },
    ctx,
  );
  await call(
    "add_files_to_scope",
    {
      subsystem_id: S1,
      ref_sha: c0,
      files: [
        { file_path: "src/core.ts", why_in_scope: "the code", classification: "examined" },
        { file_path: "vendor/lib.ts", why_in_scope: "vendored copy, not ours", classification: "vendor-ignore" },
        { file_path: "gen/kept.ts", why_in_scope: "generated but owned", classification: "candidate" },
      ],
    },
    ctx,
  );
  await call(
    "add_files_to_scope",
    {
      subsystem_id: S2,
      ref_sha: c0,
      files: [
        { file_path: "design/spec.md", why_in_scope: "the spec", classification: "examined" },
        { file_path: "design/tool.ts", why_in_scope: "a design sketch", classification: "candidate" },
      ],
    },
    ctx,
  );
  for (const pattern of ["src/", "vendor/", "design/", "README.md", ".gitignore", "gen/kept.ts"]) {
    await call("record_scope_sorting", { pattern, category: "product", description: `fixture ${pattern}` }, ctx);
  }
  const notesSorting = (
    await call(
      "record_scope_sorting",
      {
        pattern: "notes/",
        category: "meta",
        description: "working notes",
        inventory: [{ file_path: "notes/log.md", line_range: "1", excerpt: "# Log" }],
      },
      ctx,
    )
  ).id;
  await call(
    "upsert_seam",
    { id: "SM-01", shared_object: "spec file", shared_object_kind: "file", party_a: S1, party_b: S2 },
    ctx,
  );

  // Records made before the owner's rule (§2.6a).
  const evCore = (
    await call(
      "add_evidence",
      { file_path: "src/core.ts", symbol: "includedThing", line_range: "1-3", ref_sha: c0, kind: "code-verified" },
      ctx,
    )
  ).id;
  const evSpec = (
    await call(
      "add_evidence",
      { file_path: "design/spec.md", symbol: "Spec", line_range: "1-3", ref_sha: c0, kind: "code-verified" },
      ctx,
    )
  ).id;
  const addClaim = (id, subject, statement, evidenceIds) =>
    call(
      "add_claim",
      {
        claim_id: id,
        claim_key: stableClaimKey(S1, "structure", subject),
        subject_type: "symbol",
        subject_id: subject,
        statement,
        epistemic_kind: "observation",
        ref_sha: c0,
        evidence_ids: evidenceIds,
      },
      ctx,
    );
  await addClaim("CL-BOTH", "src/core.ts:includedThing", "zebra marks both included and excluded evidence", [evCore, evSpec]);
  await addClaim("CL-SPEC", "design/spec.md:Spec", "zebra zebra marks a claim about the excluded spec", [evSpec]);
  // A closed claim on the excluded spec: only history search reaches it (R6).
  await addClaim("CL-OLD", "design/spec.md:Value", "zebra zebra an invalidated claim about the excluded spec", [evSpec]);
  const evValue = (
    await call(
      "add_evidence",
      { file_path: "design/spec.md", line_range: "3", ref_sha: c0, kind: "code-verified" },
      ctx,
    )
  ).id;
  await call("invalidate_claim", { claim_id: "CL-OLD", at_sha: c0, reason: "fixture: closed", evidence_ids: [evValue] }, ctx);
  const finding = (id, subsystem, text) =>
    ctx.db
      .prepare(
        `INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status, primary_files, ref_sha)
         VALUES (?, ?, ?, 'fixture cause', 'LOW', 'confirmed-bug', '[]', ?)`,
      )
      .run(id, subsystem, text, c0);
  finding("S01-1", S1, "zebra finding one");
  finding("S01-2", S1, "zebra finding two");
  finding("S01-3", S1, "zebra finding three");
  finding("S02-1", S2, "zebra zebra finding in the outside subsystem");
  for (let n = 1; n <= 5; n++) {
    await call(
      "add_field_note",
      { category: "anomaly", observation: "zebra zebra zebra a note on the excluded spec", location: "design/spec.md" },
      ctx,
    );
  }
  // A note located at a bare file name the owner excludes below (R7).
  await call(
    "add_field_note",
    { category: "anomaly", observation: "zebra zebra zebra a note on the Makefile", location: "Makefile" },
    ctx,
  );

  // The owner's exclusions, after the records; one more owner rule on a bare file name.
  const designRule = (
    await call(
      "set_scope_rule",
      { pattern: "design/", action: "exclude", reason: "plans, not code", owner_words: "don't survey design/" },
      ctx,
    )
  ).id;
  await call(
    "set_scope_rule",
    { pattern: "Makefile", action: "exclude", reason: "build glue", owner_words: "skip the Makefile" },
    ctx,
  );
  await call("set_git_state", { canonical_branch: "main", onboarding_sha: c0 }, ctx);
  const detected = await call("detect_changes", { current_sha: c0 }, ctx);

  await check("P0 the fixture reconciles with one path per source and one unsorted path", () => {
    const s = detected.scope ?? {};
    const want = { gitignore: 1, user: 3, meta: 2 };
    if (!same(s.excluded, want)) return `scope.excluded is ${show(s.excluded)}, want ${show(want)}`;
    if (!same(s.unsorted_paths, ["misc/stray.txt"])) return `unsorted_paths is ${show(s.unsorted_paths)}`;
    return null;
  });

  const describe = async (locus, extra = {}) => call("describe_locus", { locus, ...extra }, ctx);

  // ---------------------------------------------------------- describe_locus
  const responses = {};
  const loci = {
    user: "design/spec.md",
    gitignore: "gen/out.ts",
    meta: "notes/log.md",
    ledger: "vendor/lib.ts",
    included: "gen/kept.ts",
    unledgered: "src/other.ts",
    symbol: "design/tool.ts:excludedThing",
    bare: "Makefile",
  };
  for (const [key, locus] of Object.entries(loci)) {
    try {
      responses[key] = await describe(locus);
    } catch (error) {
      responses[key] = { thrown: String(error?.message ?? error) };
    }
  }
  const standingOf = (key) => responses[key]?.standing ?? {};
  const fileBlock = (key) => (key === "symbol" ? standingOf(key).file ?? {} : standingOf(key));

  await check("E1 an owner-excluded path answers excluded with its rule and pattern", () => {
    const s = standingOf("user");
    if (s.state !== "excluded") return `state is ${show(s.state)}${responses.user?.thrown ? ` (${responses.user.thrown})` : ""}`;
    const want = { source: "user", rule_id: designRule, pattern: "design/", reason: "plans, not code" };
    return same(s.exclusion, want) ? null : `exclusion is ${show(s.exclusion)}, want ${show(want)}`;
  });
  await check("E2 a gitignored path answers excluded with source gitignore", () => {
    const s = standingOf("gitignore");
    if (s.state !== "excluded") return `state is ${show(s.state)}`;
    const e = s.exclusion ?? {};
    if (e.source !== "gitignore" || e.rule_id !== null) return `exclusion is ${show(e)}`;
    return typeof e.reason === "string" && e.reason.length > 0 && "pattern" in e ? null : `exclusion is ${show(e)}`;
  });
  await check("E3 a path sorted as meta answers excluded with its sorting row and pattern", () => {
    const s = standingOf("meta");
    if (s.state !== "excluded") return `state is ${show(s.state)}`;
    const want = { source: "meta", rule_id: notesSorting, pattern: "notes/", reason: "working notes" };
    return same(s.exclusion, want) ? null : `exclusion is ${show(s.exclusion)}, want ${show(want)}`;
  });
  await check("E4 a symbol on an excluded path carries the exclusion on its file block", () => {
    const f = fileBlock("symbol");
    if (f.state !== "excluded") return `file.state is ${show(f.state)}`;
    return f.exclusion?.source === "user" && f.exclusion?.pattern === "design/" ? null : `exclusion is ${show(f.exclusion)}`;
  });
  await check("E5 a bare file name the owner excluded resolves as a file, not an undefined term", () => {
    const r = responses.bare ?? {};
    if (r.locus?.kind !== "file") return `locus is ${show(r.locus)}`;
    if (r.locus?.kind_inferred_by !== "path-shaped") return `kind_inferred_by is ${show(r.locus?.kind_inferred_by)}`;
    return r.standing?.state === "excluded" && r.standing?.exclusion?.source === "user" ? null : `standing is ${show(r.standing)}`;
  });
  await check("L1 a ledger-exempt path inside the survey answers excluded with source ledger and its classification", () => {
    const s = standingOf("ledger");
    if (s.state !== "excluded") return `state is ${show(s.state)}`;
    const e = s.exclusion ?? {};
    if (e.source !== "ledger" || e.classification !== "vendor-ignore") return `exclusion is ${show(e)}`;
    return e.rule_id === null && e.pattern === null && e.reason === "vendored copy, not ours" ? null : `exclusion is ${show(e)}`;
  });
  await check("L2 an included path that is also gitignored has ordinary standing", () => {
    const s = standingOf("included");
    if (s.state !== "scoped-unread") return `state is ${show(s.state)}`;
    return "exclusion" in s ? `exclusion is ${show(s.exclusion)}` : null;
  });
  await check("L3 an in-scope unledgered path still answers unledgered", () => {
    const s = standingOf("unledgered");
    return s.state === "unledgered" && !("exclusion" in s) ? null : `standing is ${show({ state: s.state, exclusion: s.exclusion })}`;
  });
  await check("L4 an excluded path's ledger rows are inactive: no owner is served", () => {
    const owners = standingOf("user").owners;
    return Array.isArray(owners) && owners.length === 0 ? null : `owners is ${show(owners)}`;
  });

  await check("S1 every describe_locus response validates against locus-account.schema.json", async () => {
    let Ajv2020;
    try {
      Ajv2020 = (await import("ajv/dist/2020.js")).default;
    } catch {
      return "the draft 2020-12 validator could not be loaded";
    }
    const schema = JSON.parse(readFileSync(join(here, "contracts", "locus-account.schema.json"), "utf8"));
    const validate = new Ajv2020({ strict: true }).compile(schema);
    const wrong = [];
    const subsystems = { s1: await describe(S1), s2: await describe(S2) };
    responses.s1 = subsystems.s1;
    responses.s2 = subsystems.s2;
    for (const [key, response] of Object.entries(responses)) {
      if (response.thrown) {
        wrong.push(`${key} threw`);
        continue;
      }
      if (!validate(response)) wrong.push(`${key}: ${(validate.errors ?? []).slice(0, 2).map((e) => `${e.instancePath} ${e.message}`).join("; ")}`);
    }
    return wrong.length ? wrong.join(" | ") : null;
  });

  // ------------------------------------------------------------- vocabulary
  await check("V1 the contract's `excluded` standing names the survey set", () => {
    const doc = JSON.parse(readFileSync(join(here, "contracts", "conspectus-vocabulary.json"), "utf8"));
    const value = doc.enums?.standing_state?.values?.find((v) => v.value === "excluded");
    const meaning = String(value?.meaning ?? "");
    const wrong = [];
    if (!/survey/i.test(meaning)) wrong.push(`the meaning does not name the survey: ${show(meaning)}`);
    if (!/ledger/i.test(meaning)) wrong.push("the meaning no longer names the ledger classification");
    return wrong.length ? wrong.join("; ") : null;
  });
  for (const [label, flag] of [["V2", "--check"], ["V3", "--check-sql"]]) {
    await check(`${label} gen-vocabulary.mjs ${flag} passes`, () => {
      const r = spawnSync("node", [join(here, "scripts", "gen-vocabulary.mjs"), flag], { encoding: "utf8" });
      return r.status === 0 ? null : `exit ${r.status}: ${String(r.stdout || r.stderr).trim().split("\n")[0]}`;
    });
  }

  // ------------------------------------------------- dashboard, subsystems
  const dash = await call("get_dashboard", {}, ctx);
  await check("D1 get_dashboard counts the excluded paths by source and the unsorted paths", () => {
    const want = { gitignore: 1, user: 3, meta: 2, total: 6 };
    const wrong = [];
    if (!same(dash.excluded_paths, want)) wrong.push(`excluded_paths is ${show(dash.excluded_paths)}, want ${show(want)}`);
    if (dash.unsorted_paths !== 1) wrong.push(`unsorted_paths is ${show(dash.unsorted_paths)}`);
    if (dash.unclassified_paths !== 4) wrong.push(`unclassified_paths is ${show(dash.unclassified_paths)}, want 4 (.gitignore, README.md, src/other.ts, misc/stray.txt)`);
    return wrong.length ? wrong.join("; ") : null;
  });
  await check("D2 get_dashboard leaves the inactive ledger rows out of its counts", () => {
    const wrong = [];
    if (dash.scoped_files !== 3) wrong.push(`scoped_files is ${show(dash.scoped_files)}, want 3`);
    if (dash.examined_files !== 1) wrong.push(`examined_files is ${show(dash.examined_files)}, want 1`);
    if (dash.unexamined_files !== 1) wrong.push(`unexamined_files is ${show(dash.unexamined_files)}, want 1`);
    return wrong.length ? wrong.join("; ") : null;
  });
  await check("D3 get_dashboard reports the subsystem and the seam outside the survey", () => {
    const want = { subsystems: [S2], seams: ["SM-01"] };
    return same(dash.outside_survey, want) ? null : `outside_survey is ${show(dash.outside_survey)}`;
  });
  await check("D4 list_subsystems reports which subsystem is outside the survey", async () => {
    const rows = await call("list_subsystems", {}, ctx);
    const got = Object.fromEntries(rows.map((row) => [row.id, row.outside_survey]));
    return same(got, { [S1]: false, [S2]: true }) ? null : `outside_survey by subsystem is ${show(got)}`;
  });
  await check("D6 describe_locus on a subsystem counts only its active ledger rows and their evidence", () => {
    const got = [S1, S2].map((id) => {
      const s = (id === S1 ? responses.s1 : responses.s2)?.standing ?? {};
      return { total: s.ledger?.total, examined: s.ledger?.examined, rows: s.measured?.ledger_rows, evidence: s.measured?.evidence_rows };
    });
    const want = [{ total: 3, examined: 1, rows: 3, evidence: 1 }, { total: 0, examined: 0, rows: 0, evidence: 0 }];
    return same(got, want) ? null : `counts are ${show(got)}, want ${show(want)}`;
  });
  await check("D5 describe_locus on a subsystem says whether it is outside the survey", () => {
    const got = [responses.s1?.standing?.outside_survey, responses.s2?.standing?.outside_survey];
    return same(got, [false, true]) ? null : `outside_survey is ${show(got)}`;
  });

  // --------------------------------------------------------------- find_symbol
  const rowsOf = (r) => (r.results ?? []).map((x) => `${x.path}#${x.symbol_id}`).sort();
  const keptDefs = ["gen/kept.ts#keptThing", "src/core.ts#includedThing", "vendor/lib.ts#vendorThing"];
  const allDefs = [
    ...keptDefs,
    "design/tool.ts#excludedThing",
    "gen/out.ts#ignoredThing",
    "notes/helper.ts#metaThing",
  ].sort();
  await check("F1 find_symbol leaves out definitions in excluded paths by default", async () => {
    const r = await call("find_symbol", { query: "Thing" }, ctx);
    if (r.ok !== true) return `refused: ${show(r.error)}`;
    return same(rowsOf(r), keptDefs) ? null : `rows are ${show(rowsOf(r))}, want ${show(keptDefs)}`;
  });
  await check("F2 find_symbol with include_excluded restores them", async () => {
    const r = await call("find_symbol", { query: "Thing", include_excluded: true }, ctx);
    if (r.ok !== true) return `refused: ${show(r.error)}`;
    return same(rowsOf(r), allDefs) ? null : `rows are ${show(rowsOf(r))}, want ${show(allDefs)}`;
  });
  await check("F3 find_symbol's page is full when more in-survey definitions exist", async () => {
    const r = await call("find_symbol", { query: "Thing", limit: 2 }, ctx);
    if (r.ok !== true) return `refused: ${show(r.error)}`;
    const wrong = [];
    if ((r.results ?? []).length !== 2) wrong.push(`${(r.results ?? []).length} rows, want 2`);
    if (r.more !== true) wrong.push("more is not true");
    const excluded = (r.results ?? []).filter((x) => !keptDefs.some((k) => k.startsWith(`${x.path}#`)));
    if (excluded.length) wrong.push(`a page row is excluded: ${show(excluded)}`);
    return wrong.length ? wrong.join("; ") : null;
  });

  await check("F4 find_symbol fills a page past more excluded rows than its widest window", async () => {
    const r = await call("find_symbol", { query: "includedThing", mode: "references", limit: 1 }, ctx);
    if (r.ok !== true) return `refused: ${show(r.error)}`;
    const paths = (r.results ?? []).map((x) => x.path);
    return same(paths, ["src/other.ts"]) ? null : `rows are in ${show(paths)}, want src/other.ts (more ${show(r.more)})`;
  });

  // ------------------------------------------------------------ search_records
  const idsOf = (r) => (r.results ?? []).map((x) => `${x.kind}:${x.id}`);
  const keptHits = ["claim:CL-BOTH", "finding:S01-1", "finding:S01-2", "finding:S01-3"];
  await check("R1 search_records leaves out a file locus on an excluded path and a subsystem outside the survey", async () => {
    const r = await call("search_records", { query: "zebra" }, ctx);
    if (r.ok !== true) return `refused: ${show(r.error)}`;
    return same([...idsOf(r)].sort(), keptHits) ? null : `hits are ${show(idsOf(r))}, want ${show(keptHits)}`;
  });
  await check("R2 a record citing both included and excluded evidence is kept", async () => {
    const r = await call("search_records", { query: "zebra", kinds: ["claim"] }, ctx);
    return same(idsOf(r), ["claim:CL-BOTH"]) ? null : `claims are ${show(idsOf(r))}`;
  });
  await check("R3 include_excluded restores every left-out hit", async () => {
    const r = await call("search_records", { query: "zebra", include_excluded: true }, ctx);
    if (r.ok !== true) return `refused: ${show(r.error)}`;
    const got = idsOf(r);
    const want = [
      ...keptHits,
      "claim:CL-SPEC",
      "finding:S02-1",
      ...[1, 2, 3, 4, 5, 6].map((n) => `field-note:${n}`),
    ].sort();
    return same([...got].sort(), want) ? null : `hits are ${show(got.sort())}, want ${show(want)}`;
  });
  await check("R4 history search follows the same rule", async () => {
    const plain = await call("search_records", { query: "zebra", include_history: true }, ctx);
    if (!same([...idsOf(plain)].sort(), keptHits)) return `hits are ${show(idsOf(plain))}`;
    const all = await call("search_records", { query: "zebra", include_history: true, include_excluded: true }, ctx);
    return idsOf(all).length === 13 ? null : `with include_excluded the history search returns ${idsOf(all).length} hits, want 13`;
  });
  await check("R6 history search leaves out a closed record on an excluded locus unless include_excluded", async () => {
    const plain = await call("search_records", { query: "invalidated", include_history: true }, ctx);
    if (idsOf(plain).includes("claim:CL-OLD")) return `history search serves CL-OLD: ${show(idsOf(plain))}`;
    const all = await call("search_records", { query: "invalidated", include_history: true, include_excluded: true }, ctx);
    return same(idsOf(all), ["claim:CL-OLD"]) ? null : `with include_excluded the hits are ${show(idsOf(all))}, want CL-OLD`;
  });
  await check("R7 a record located at a bare file name the owner excluded is left out unless include_excluded", async () => {
    const plain = await call("search_records", { query: "Makefile" }, ctx);
    if (idsOf(plain).length) return `search serves ${show(idsOf(plain))}`;
    const all = await call("search_records", { query: "Makefile", include_excluded: true }, ctx);
    return same(idsOf(all), ["field-note:6"]) ? null : `with include_excluded the hits are ${show(idsOf(all))}`;
  });
  await check("R5 the filter runs before the page is cut: page 1 is full while more hits exist", async () => {
    const r = await call("search_records", { query: "zebra", limit: 2 }, ctx);
    if (r.ok !== true) return `refused: ${show(r.error)}`;
    const wrong = [];
    if ((r.results ?? []).length !== 2) wrong.push(`${(r.results ?? []).length} hits, want 2`);
    if (r.more !== true) wrong.push("more is not true");
    const bad = idsOf(r).filter((id) => !keptHits.includes(id));
    if (bad.length) wrong.push(`left-out hits served: ${show(bad)}`);
    // The control: the same page with the rule off is the excluded records, which is why
    // a cut before the filter would leave page 1 empty.
    const control = await call("search_records", { query: "zebra", limit: 2, include_excluded: true }, ctx);
    if (idsOf(control).some((id) => keptHits.includes(id))) wrong.push(`the control page is not the excluded records: ${show(idsOf(control))}`);
    return wrong.length ? wrong.join("; ") : null;
  });

  // ------------------------------------------------- outline_file, read_symbol
  await check("O1 outline_file on an excluded path answers and carries `excluded` with its source", async () => {
    const wrong = [];
    for (const [source, path] of Object.entries(CODE_LOCI)) {
      const r = await call("outline_file", { path }, ctx);
      if (r.ok !== true) {
        wrong.push(`${path} refused: ${show(r.error)}`);
        continue;
      }
      if (r.excluded?.source !== source) wrong.push(`${path} carries excluded ${show(r.excluded)}, want source ${source}`);
    }
    return wrong.length ? wrong.join("; ") : null;
  });
  await check("O2 read_symbol on an excluded path answers and carries `excluded`", async () => {
    const r = await call("read_symbol", { path: "design/tool.ts", symbol: "excludedThing" }, ctx);
    if (r.ok !== true) return `refused: ${show(r.error)}`;
    if (!String(r.source ?? "").includes("excludedThing")) return `source is ${show(r.source)}`;
    const want = { source: "user", rule_id: designRule, pattern: "design/" };
    const got = { source: r.excluded?.source, rule_id: r.excluded?.rule_id, pattern: r.excluded?.pattern };
    return same(got, want) ? null : `excluded is ${show(r.excluded)}`;
  });
  await check("O3 an included path's outline and symbol carry no `excluded`", async () => {
    const wrong = [];
    for (const path of ["src/core.ts", "vendor/lib.ts", "gen/kept.ts"]) {
      const r = await call("outline_file", { path }, ctx);
      if (r.ok !== true) wrong.push(`${path} refused: ${show(r.error)}`);
      else if ("excluded" in r) wrong.push(`${path} carries excluded ${show(r.excluded)}`);
    }
    const s = await call("read_symbol", { path: "src/core.ts", symbol: "includedThing" }, ctx);
    if (s.ok !== true || "excluded" in s) wrong.push(`read_symbol src/core.ts: ${show(s.excluded ?? s.error)}`);
    return wrong.length ? wrong.join("; ") : null;
  });

  // ------------------------------------------- the reconciliation decides standing
  await check("U1 a recorded exclusion still answers excluded when git cannot read the workspace", async () => {
    // The same store bound to a workspace that is not there: no git, and no tree read before.
    const away = { ...ctx, project: { ...ctx.project, workspacePath: join(scratch, "gone") } };
    const wrong = [];
    for (const [path, source] of [["notes/log.md", "meta"], ["gen/out.ts", "gitignore"]]) {
      let r;
      try {
        r = await call("describe_locus", { locus: path }, away);
      } catch (error) {
        wrong.push(`${path} threw ${String(error?.message ?? error)}`);
        continue;
      }
      if (r.standing?.state !== "excluded" || r.standing?.exclusion?.source !== source) {
        wrong.push(`${path} answers ${show({ state: r.standing?.state, exclusion: r.standing?.exclusion, owners: r.standing?.owners?.length })}`);
      }
    }
    return wrong.length ? wrong.join("; ") : null;
  });
  await check("U2 a file and its subsystem agree on a rule recorded since the last reconciliation", async () => {
    await call(
      "set_scope_rule",
      { pattern: "src/core.ts", action: "exclude", reason: "fixture: late rule", owner_words: "skip src/core.ts" },
      ctx,
    );
    const phase = async (label) => {
      const file = (await describe("src/core.ts")).standing ?? {};
      const total = (await describe(S1)).standing?.ledger?.total;
      const fileExcluded = file.state === "excluded";
      const counted = total === 3;
      return fileExcluded === counted ? `${label}: the file answers ${show(file.state)} while ${S1} counts ${show(total)} rows` : null;
    };
    const before = await phase("before detect_changes");
    await call("detect_changes", { current_sha: c0 }, ctx);
    const after = await phase("after detect_changes");
    return [before, after].filter(Boolean).join("; ") || null;
  });

  await check("D7 get_dashboard counts an excluded ledgered path the tree no longer carries, and says so", async () => {
    git(ws, "rm", "-q", "design/tool.ts");
    const c1 = commitAll(ws, "delete an excluded, ledgered path");
    const reconciled = await call("detect_changes", { current_sha: c1 }, ctx);
    const counted = (await call("get_dashboard", {}, ctx)).excluded_paths ?? {};
    const wrong = [];
    // The tree's own exclusions, and the one kept for the deleted row so it stays inactive.
    if (counted.user !== (reconciled.scope?.excluded?.user ?? NaN) + 1) {
      wrong.push(`excluded_paths.user is ${show(counted.user)}, detect_changes counts ${show(reconciled.scope?.excluded?.user)} in the tree`);
    }
    const description = allTools.get("get_dashboard")?.description ?? "";
    if (!/no longer carries/.test(description) || !/scope\.excluded counts the tree's alone/.test(description)) {
      wrong.push("get_dashboard's description does not say which paths excluded_paths counts");
    }
    return wrong.length ? wrong.join("; ") : null;
  });

  // ------------------------------------------------------ instructions and CI
  await check("I1 both server instruction texts name the new standing source", () => {
    const wrong = [];
    for (const file of ["src/cli.ts", "src/index.ts"]) {
      const text = readFileSync(join(here, file), "utf8");
      if (!/exclusion/.test(text) || !/gitignore/.test(text)) wrong.push(`${file} does not name the exclusion source`);
    }
    return wrong.length ? wrong.join("; ") : null;
  });
  await check("CI1 this gate runs in CI, in the mcp-server job", () => {
    const workflow = join(here, "..", ".github", "workflows", "test.yml");
    if (!existsSync(workflow)) return ".github/workflows/test.yml is absent";
    return readFileSync(workflow, "utf8").includes("node test-scope-standing.mjs")
      ? null
      : "the workflow does not run this gate";
  });

  ctx.db.close();
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
      ["field-notes", "fieldNoteTools"],
      ["git", "gitTools"],
      ["locus", "locusTools"],
      ["project", "projectTools"],
      ["scope", "scopeTools"],
      ["seams", "seamTools"],
      ["subsystems", "subsystemTools"],
      ["dashboard", "dashboardTools"],
      ["code-index", "codeIndexTools"],
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
      await main(mods);
    }
  }
} catch (error) {
  failures.push(`X the gate did not finish: ${scrub(error?.message ?? error)}`);
}

console.log(`  ran  ${checked} assertion(s) against ${join(here, "dist")}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`GATE SC6 RED: ${failures.length} of ${checked} assertion(s) failed; first: ${failures[0]}`);
  process.exit(1);
}
console.log("GATE SC6 GREEN");
process.exit(0);
