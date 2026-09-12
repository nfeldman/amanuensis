#!/usr/bin/env node
// Gate for reader-lenses packet P21 — the residual hardening the final
// whole-branch review verified and deferred with no packet
// (spec.md §2.2, §2.4, §3.2, §10, §11; claims C6, C16, C27, C48, C55, C63).
//
// Six findings, one gate. Each arm below drives the behaviour the finding
// named rather than the text of the repair, because five of the six were
// filed as "the gate cannot turn red" and a textual successor would inherit
// exactly that defect.
//
// Turns red when:
//   - add_evidence, add_finding, or set_disposition accepts a ref_sha that
//     does not resolve to a commit in the bound workspace, so a stored row
//     carries an unresolved ref_sha while describe_locus reports it
//     revision_bound (F6/codex, high);
//   - one of those writers stores something other than the resolved
//     revision, so revision_bound is a claim the record cannot support;
//   - one of those writers accepts a revision that resolved on an earlier call
//     but has since stopped resolving — a cached resolution standing in for a
//     live one (F1/codex, slice-S7);
//   - the open-finding count is derived from findings.status in any of the
//     four surfaces that publish one — a duplicate predicate beside
//     finding_state_current — or the master plan, get_dashboard, and
//     list_subsystems disagree on a store holding a legacy-only finding and
//     a finding whose event log has overtaken its coarse status (F9/codex);
//   - detect_changes or the standing reachability table writes a literal
//     stale_reason the vocabulary source does not carry, or either writer
//     stops reading the generated STALE_REASONS (F4/codex, F2/codex);
//   - a tool validator accepts a value the vocabulary source does not carry
//     (F2/claude);
//   - the overview truthfulness lint does not catch a bare percentage or an
//     `n of m` ratio presented as a health index (F3/claude);
//   - the gate does not run in CI.
//
// False green it cannot exclude: agreement on a wrong definition. If the
// vocabulary source itself carried `git-driftt`, every arm here would pass —
// which is why the source is read straight from the JSON contract rather than
// through the generated module the writers import, and why the open-count arm
// computes its expectation from `finding_state_current` in SQL rather than
// from any constant the three readers share.
//
// Output protocol: exactly one status line, last, on stdout. Every subprocess
// is captured and never echoed, and every message is scrubbed, so a missing
// deliverable reports as an assertion failure rather than as a crashed gate.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const MCP = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(MCP, "..");
const PY = process.env.AMANUENSIS_PYTHON ?? "python3";

const SOURCE_REL = "mcp-server/contracts/conspectus-vocabulary.json";
const GIT_REL = "mcp-server/src/tools/git.ts";
const STANDING_REL = "mcp-server/src/standing.ts";
const DASHBOARD_REL = "mcp-server/src/tools/dashboard.ts";
const SUBSYSTEMS_REL = "mcp-server/src/tools/subsystems.ts";
const FINDINGS_REL = "mcp-server/src/tools/findings.ts";
const RENDERERS_REL = "materializer/amanuensis_materializer/renderers.py";
const OVERVIEW_GATE_REL = "materializer/test-overview-truthfulness.py";
const CI_REL = ".github/workflows/test.yml";

// ---------------------------------------------------------------------------
// Output funnel. Nothing reaches stdout except through emit(), and everything
// is scrubbed of the launcher's crash signatures so that a genuine assertion
// failure is never mistaken for a gate that never ran.
// ---------------------------------------------------------------------------
const SCRUB = [
  [/MODULE_NOT_FOUND/g, "module-absent"],
  [/ModuleNotFoundError/g, "python-module-absent"],
  [/Cannot find module/g, "cannot load module"],
  [/No such file( or directory)?/g, "path is absent"],
  [/can't open file/g, "cannot open path"],
  [/SyntaxError/g, "syntax-error"],
  [/ImportError/g, "python-import-error"],
  [/ReferenceError/g, "reference-error"],
  [/TypeError/g, "type-error"],
  [/ENOENT/g, "PATH-ABSENT"],
  [/is not defined/g, "is undeclared"],
  [/command not found/g, "executable is absent"],
];

function scrub(text) {
  let out = String(text ?? "");
  for (const [pattern, replacement] of SCRUB) out = out.replace(pattern, replacement);
  return out;
}

function emit(line) {
  process.stdout.write(`${scrub(line)}\n`);
}

const failures = [];
function check(label, fn) {
  let reason = null;
  try {
    reason = fn();
  } catch (e) {
    reason = `threw while checking — ${e && e.message ? e.message : e}`;
  }
  if (reason) {
    failures.push(`${label}: ${reason}`);
    emit(`  FAIL ${label}: ${reason}`);
  } else {
    emit(`  ok   ${label}`);
  }
}

function readText(absPath) {
  if (!existsSync(absPath)) return null;
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

function readJson(absPath) {
  const text = readText(absPath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The vocabulary source, read as JSON. Every enum expectation below comes from
// here and never from the generated module a writer imports: comparing an
// array with itself is the shape F2/claude filed against.
// ---------------------------------------------------------------------------
const source = readJson(join(REPO, SOURCE_REL));
function sourceValues(name) {
  const decl = source?.enums?.[name];
  if (!decl || !Array.isArray(decl.values)) return null;
  return decl.values.map((entry) => entry.value);
}

// ---------------------------------------------------------------------------
// Deliverables, loaded defensively: an absent or unbuilt deliverable must read
// as an assertion failure, not as a crashed gate. dist/ is a build artifact,
// so compile first — a gate that reads stale bytes certifies code that is not
// under review.
// ---------------------------------------------------------------------------
const built = ensureBuilt();

let mods = null;
let loadError = null;
try {
  const [db, project, evidence, findings, dispositions, files, fieldNotes, claims, xrefs, git, dashboard, subsystems, locus] =
    await Promise.all([
      import("./dist/db.js"),
      import("./dist/project.js"),
      import("./dist/tools/evidence.js"),
      import("./dist/tools/findings.js"),
      import("./dist/tools/dispositions.js"),
      import("./dist/tools/files.js"),
      import("./dist/tools/field-notes.js"),
      import("./dist/tools/claims.js"),
      import("./dist/tools/xrefs.js"),
      import("./dist/tools/git.js"),
      import("./dist/tools/dashboard.js"),
      import("./dist/tools/subsystems.js"),
      import("./dist/tools/locus.js"),
    ]);
  mods = { db, project, evidence, findings, dispositions, files, fieldNotes, claims, xrefs, git, dashboard, subsystems, locus };
} catch (e) {
  loadError = e && e.message ? e.message : String(e);
}

const TOOL_SETS = () => [
  mods?.evidence?.evidenceTools,
  mods?.findings?.findingTools,
  mods?.dispositions?.dispositionTools,
  mods?.files?.fileTools,
  mods?.fieldNotes?.fieldNoteTools,
  mods?.claims?.claimTools,
  mods?.xrefs?.xrefTools,
  mods?.git?.gitTools,
  mods?.dashboard?.dashboardTools,
  mods?.subsystems?.subsystemTools,
  mods?.locus?.locusTools,
];

function tool(name) {
  for (const set of TOOL_SETS()) {
    if (!Array.isArray(set)) continue;
    const found = set.find((entry) => entry?.name === name);
    if (found) return found;
  }
  return null;
}

/**
 * Call a tool. Returns `{ ok, value, error, accepted }`; a throw is a refusal.
 *
 * `accepted` is the list `requireEnum` names in its refusal — the set the
 * running validator says it takes. Probing with one out-of-source value is not
 * enough on its own: the sabotage that opened F2/claude widened one list by
 * exactly one value, which still refuses every other probe.
 */
function call(name, args, ctx) {
  const definition = tool(name);
  if (!definition || typeof definition.handler !== "function") {
    return { ok: false, value: null, error: `tool ${name} is not registered`, missing: true };
  }
  const readAccepted = (message) => {
    const match = /must be one of:\s*(.+)$/m.exec(String(message ?? ""));
    return match ? match[1].split(",").map((entry) => entry.trim()).filter(Boolean) : null;
  };
  try {
    const value = definition.handler(args, ctx);
    if (value && typeof value === "object" && value.ok === false) {
      const error = String(value.error ?? "refused");
      return { ok: false, value, error, accepted: readAccepted(error) };
    }
    return { ok: true, value, error: null, accepted: null };
  } catch (e) {
    const error = e && e.message ? e.message : String(e);
    return { ok: false, value: null, error, accepted: readAccepted(error) };
  }
}

// ---------------------------------------------------------------------------
// Fixture: a two-commit workspace and a store whose ledger carries a drifted
// row, a deleted row, a clean row, and a row whose examination revision does
// not resolve — one positive and one negative case for every branch below.
// ---------------------------------------------------------------------------
const roots = [];
function tempRoot(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function rawGit(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} did not succeed`);
  return String(result.stdout ?? "").trim();
}

let fixture = null;
let fixtureError = !built.ok
  ? `src/ was not compiled before this gate read dist/ — ${built.detail}`
  : loadError
    ? `the tool modules could not be loaded — ${loadError}`
    : null;

function buildFixture() {
  const root = tempRoot("amanuensis-p21-");
  const workspace = join(root, "workspace");
  const storageRoot = join(root, "storage-root");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  rawGit(workspace, "init", "-q", "-b", "main");
  rawGit(workspace, "config", "user.email", "test@localhost");
  rawGit(workspace, "config", "user.name", "P21 Residual Hardening");
  rawGit(workspace, "config", "commit.gpgsign", "false");

  writeFileSync(join(workspace, "src", "ledger.ts"), "export const row = 1;\n");
  writeFileSync(join(workspace, "src", "clean.ts"), "export const clean = true;\n");
  writeFileSync(join(workspace, "src", "drift.ts"), "export const drift = 1;\n");
  writeFileSync(join(workspace, "src", "bad-ref.ts"), "export const bad = 1;\n");
  writeFileSync(join(workspace, "src", "gone.ts"), "export const gone = 1;\n");
  writeFileSync(join(workspace, "src", "unreachable.ts"), "export const off = 1;\n");
  rawGit(workspace, "add", "-A");
  rawGit(workspace, "commit", "-q", "--no-verify", "-m", "base");
  const base = rawGit(workspace, "rev-parse", "HEAD");

  // A commit on a side branch that never reaches main, over a file main does
  // not touch. Its ledger row survives reconciliation as `examined` — the only
  // state §2.2 consults the reachability table for — so it is the one positive
  // case for standing.ts's `unreachable-ref` branch.
  rawGit(workspace, "checkout", "-q", "-b", "side");
  writeFileSync(join(workspace, "src", "aside.ts"), "export const aside = 2;\n");
  rawGit(workspace, "add", "-A");
  rawGit(workspace, "commit", "-q", "--no-verify", "-m", "side");
  const side = rawGit(workspace, "rev-parse", "HEAD");
  rawGit(workspace, "checkout", "-q", "main");

  writeFileSync(join(workspace, "src", "drift.ts"), "export const drift = 2;\n");
  rmSync(join(workspace, "src", "gone.ts"));
  rawGit(workspace, "add", "-A");
  rawGit(workspace, "commit", "-q", "--no-verify", "-m", "head");
  const head = rawGit(workspace, "rev-parse", "HEAD");

  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
  const project = mods.project.resolveProject(workspace, {
    selectionSource: "test-residual-hardening",
    serverVersion: "test",
  });
  mods.project.ensureProjectStorage(project, (dbPath) => mods.db.openDatabase(dbPath).close());
  const db = mods.db.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: "p21" };

  db.prepare("INSERT INTO sessions (session_id, intent) VALUES ('p21', 'p21-gate')").run();
  db.prepare("INSERT INTO concerns (code, origin) VALUES ('SC-1', 'seeded')").run();
  const subsystem = db.prepare(
    "INSERT INTO subsystems (id, name, status, layer) VALUES (?, ?, ?, ?)",
  );
  subsystem.run("B-01", "Ledger", "adversarial", "core");
  subsystem.run("B-02", "Index", "adversarial", "core");

  const ledger = db.prepare(
    `INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at, stale)
     VALUES (?, ?, 'p21 fixture', 'examined', ?, '2026-09-01 12:00:00', 0)`,
  );
  ledger.run("B-01", "src/ledger.ts", head);
  ledger.run("B-01", "src/clean.ts", base);
  ledger.run("B-01", "src/drift.ts", base);
  ledger.run("B-01", "src/bad-ref.ts", "deadbeef");
  ledger.run("B-01", "src/gone.ts", base);
  ledger.run("B-01", "src/unreachable.ts", side);

  // Checked at the workspace head, so §2.4.4 serves the account at current
  // rather than at an ancestor cut; the reconciliation below still has work,
  // because staleness is decided per row against its own examination commit.
  db.prepare(
    `INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha, last_checked_sha)
     VALUES ('default', 'main', ?, ?)`,
  ).run(base, head);

  return { root, workspace, storageRoot, project, db, ctx, base, side, head, short: head.slice(0, 8) };
}

if (!fixtureError) {
  try {
    fixture = buildFixture();
  } catch (e) {
    fixtureError = `the fixture could not be built — ${e && e.message ? e.message : e}`;
  }
}

/**
 * A second workspace and store, built for the one arm that destroys the commit
 * it writes at. Two commits: `base` survives, `doomed` is removed mid-arm by
 * `forget()`, which rewinds the branch and then collects the unreachable
 * object — the shape a rebase, an amend, or a force-fetch leaves behind.
 */
function buildPrunableWorkspace() {
  const root = tempRoot("amanuensis-p21-prune-");
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  rawGit(workspace, "init", "-q", "-b", "main");
  rawGit(workspace, "config", "user.email", "test@localhost");
  rawGit(workspace, "config", "user.name", "P21 Residual Hardening");
  rawGit(workspace, "config", "commit.gpgsign", "false");
  writeFileSync(join(workspace, "src", "ledger.ts"), "export const row = 1;\n");
  rawGit(workspace, "add", "-A");
  rawGit(workspace, "commit", "-q", "--no-verify", "-m", "base");
  const base = rawGit(workspace, "rev-parse", "HEAD");
  writeFileSync(join(workspace, "src", "ledger.ts"), "export const row = 2;\n");
  rawGit(workspace, "add", "-A");
  rawGit(workspace, "commit", "-q", "--no-verify", "-m", "doomed");
  const doomed = rawGit(workspace, "rev-parse", "HEAD");

  const project = mods.project.resolveProject(workspace, {
    selectionSource: "test-residual-hardening",
    serverVersion: "test",
  });
  mods.project.ensureProjectStorage(project, (dbPath) => mods.db.openDatabase(dbPath).close());
  const db = mods.db.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: "p21" };
  db.prepare("INSERT INTO sessions (session_id, intent) VALUES ('p21', 'p21-prune')").run();
  db.prepare("INSERT INTO concerns (code, origin) VALUES ('SC-1', 'seeded')").run();
  db.prepare(
    "INSERT INTO subsystems (id, name, status, layer) VALUES ('B-01', 'Ledger', 'adversarial', 'core')",
  ).run();
  const forget = () => {
    rawGit(workspace, "reset", "-q", "--hard", base);
    for (const args of [["reflog", "expire", "--expire=now", "--expire-unreachable=now", "--all"], ["gc", "--prune=now", "--quiet"]]) {
      spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
    }
  };
  return { root, workspace, project, db, ctx, base, doomed, forget };
}

function needFixture() {
  return fixture ? null : (fixtureError ?? "the fixture is unavailable");
}

emit("GATE P21 — revision-bound writers, one open-finding predicate, gates that can turn red");
emit("");

check("src/ was compiled into dist/ before this gate read it", () => built.detail);
check("the vocabulary source is readable", () =>
  source ? null : `${SOURCE_REL} is absent or is not parseable JSON`,
);
check("the fixture workspace and store were built", () => needFixture());

// ---------------------------------------------------------------------------
// F6/codex — the three writers resolve ref_sha in the bound workspace.
// ---------------------------------------------------------------------------
emit("");
emit("F6/codex — evidence, findings, and dispositions are bound to a resolved revision");

// Each writer, the arguments that are valid apart from the revision, and the
// table and column its record lands in.
function evidenceArgs(refSha) {
  return {
    file_path: "src/ledger.ts",
    symbol: "row",
    line_range: "1-1",
    ref_sha: refSha,
    kind: "code-verified",
  };
}

function findingArgs(id, refSha) {
  return {
    finding_id: id,
    subsystem_id: "B-01",
    symptom: "the row writer drops the last entry",
    root_cause: "the loop bound is exclusive",
    severity: "MEDIUM",
    status: "confirmed-bug",
    primary_files: [`src/ledger.ts:row@${refSha}`],
    ref_sha: refSha,
    pass_type: "survey",
  };
}

function dispositionArgs(refSha) {
  return {
    subsystem_id: "B-01",
    concern_code: "SC-1",
    classification: "ruled-out",
    evidence: `src/ledger.ts:row@${refSha}`,
    evidence_quality: "code-verified",
    rationale: "the writer is bounded by the ledger row count",
    ref_sha: refSha,
    pass_type: "survey",
  };
}

const UNRESOLVABLE = "deadbeef";

check("add_evidence refuses an unresolved ref_sha", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const result = call("add_evidence", evidenceArgs(UNRESOLVABLE), fixture.ctx);
  return result.ok
    ? `add_evidence stored an unresolved ref_sha ${UNRESOLVABLE}, which resolves to no commit in the bound workspace`
    : null;
});

check("add_finding refuses an unresolved ref_sha", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const result = call("add_finding", findingArgs("B01-BAD", UNRESOLVABLE), fixture.ctx);
  return result.ok
    ? `add_finding stored an unresolved ref_sha ${UNRESOLVABLE}, which resolves to no commit in the bound workspace`
    : null;
});

check("set_disposition refuses an unresolved ref_sha", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const result = call("set_disposition", dispositionArgs(UNRESOLVABLE), fixture.ctx);
  return result.ok
    ? `set_disposition stored an unresolved ref_sha ${UNRESOLVABLE}, which resolves to no commit in the bound workspace`
    : null;
});

check("no unresolved ref_sha reached the store", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const bad = [];
  for (const [table] of [["evidence"], ["findings"], ["dispositions"]]) {
    const rows = fixture.db.prepare(`SELECT ref_sha FROM ${table} WHERE ref_sha IS NOT NULL`).all();
    for (const row of rows) {
      if (String(row.ref_sha) === UNRESOLVABLE) bad.push(`${table} carries the unresolved ref_sha`);
    }
  }
  return bad.length ? bad.join("; ") : null;
});

check("the three writers store the resolved revision, so revision_bound is backed", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const abbreviated = fixture.short;
  const bad = [];
  const evidenceResult = call("add_evidence", evidenceArgs(abbreviated), fixture.ctx);
  if (!evidenceResult.ok) bad.push(`add_evidence refused a resolvable revision — ${evidenceResult.error}`);
  const findingResult = call("add_finding", findingArgs("B01-1", abbreviated), fixture.ctx);
  if (!findingResult.ok) bad.push(`add_finding refused a resolvable revision — ${findingResult.error}`);
  const dispositionResult = call("set_disposition", dispositionArgs(abbreviated), fixture.ctx);
  if (!dispositionResult.ok)
    bad.push(`set_disposition refused a resolvable revision — ${dispositionResult.error}`);
  if (bad.length) return bad.join("; ");

  const stored = [
    ["evidence", fixture.db.prepare("SELECT ref_sha FROM evidence ORDER BY id DESC LIMIT 1").get()],
    ["findings", fixture.db.prepare("SELECT ref_sha FROM findings WHERE finding_id='B01-1'").get()],
    [
      "dispositions",
      fixture.db
        .prepare("SELECT ref_sha FROM dispositions WHERE subsystem_id='B-01' AND concern_code='SC-1'")
        .get(),
    ],
  ];
  for (const [table, row] of stored) {
    const value = row ? String(row.ref_sha) : null;
    if (value !== fixture.head)
      bad.push(
        `${table} stored ${JSON.stringify(value)} for the abbreviated revision ${abbreviated}, not the resolved ${fixture.head}`,
      );
  }
  if (bad.length) return bad.join("; ");

  // The read surface's claim, on the record the writers just made.
  const account = call(
    "describe_locus",
    { locus: "src/ledger.ts", sections: ["defects"] },
    fixture.ctx,
  );
  if (!account.ok) return `describe_locus refused the fixture path — ${account.error}`;
  const defects = account.value?.sections?.defects;
  const item = (defects?.items ?? []).find((entry) => entry.finding_id === "B01-1");
  if (!item) return "describe_locus does not carry the fixture finding, so revision_bound is unproven";
  if (item.revision_bound !== true) return "the finding is not reported revision_bound";
  if (item.ref_sha !== fixture.head)
    return `revision_bound is reported over ${JSON.stringify(item.ref_sha)}, not the resolved revision`;
  return null;
});

// A resolution that succeeded once is not a resolution that still holds. The
// writers memoize object-name-shaped input per workspace on the reasoning that
// "a commit does not stop existing inside one server process" — which rewinding
// the branch and collecting the loose objects falsifies, and which a rebase, an
// amend, or a force-fetch reaches by the route a survey session actually takes.
// The consequence is the one F6/codex was filed for, arriving by a second door:
// a durable row stored at a revision nothing can resolve, published as
// `revision_bound` (F1/codex, slice-S7).
//
// The arm runs in its own workspace and its own store, because it destroys the
// commit it writes at and the shared fixture's later arms need theirs.
check("a writer refuses a revision that has stopped resolving since it was cached", () => {
  const blocked = needFixture();
  if (blocked) return blocked;

  let scratch = null;
  try {
    scratch = buildPrunableWorkspace();
  } catch (e) {
    return `the prunable workspace could not be built — ${e && e.message ? e.message : e}`;
  }

  // 1. A durable write at the doomed commit, which populates any cache.
  const first = call("add_evidence", evidenceArgs(scratch.doomed), scratch.ctx);
  if (!first.ok) return `add_evidence refused a resolvable revision — ${first.error}`;

  // 2. Take the commit away.
  try {
    scratch.forget();
  } catch (e) {
    return `the doomed commit could not be removed — ${e && e.message ? e.message : e}`;
  }

  // 3. The denominator: if git still resolves it, the arm proves nothing and
  //    must say so rather than pass (VP4).
  const probe = spawnSync("git", ["rev-parse", "--verify", `${scratch.doomed}^{commit}`], {
    cwd: scratch.workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (probe.status === 0)
    return "the removed commit still resolves in the scratch workspace, so this arm measures nothing";

  // 4. The same revision, now unresolvable, must be refused by every writer.
  const bad = [];
  const second = call("add_evidence", evidenceArgs(scratch.doomed), scratch.ctx);
  if (second.ok) bad.push("add_evidence accepted a revision that no longer resolves");
  const finding = call("add_finding", findingArgs("B01-PRUNED", scratch.doomed), scratch.ctx);
  if (finding.ok) bad.push("add_finding accepted a revision that no longer resolves");
  const disposition = call("set_disposition", dispositionArgs(scratch.doomed), scratch.ctx);
  if (disposition.ok) bad.push("set_disposition accepted a revision that no longer resolves");
  if (bad.length) return bad.join("; ");

  // 5. And nothing reached the store behind the refusal.
  const rows = scratch.db
    .prepare("SELECT COUNT(*) AS n FROM evidence WHERE ref_sha=?")
    .get(scratch.doomed);
  if (Number(rows?.n ?? 0) !== 1)
    return `the store holds ${rows?.n} rows at the removed revision, not the one written while it resolved`;
  return null;
});

// ---------------------------------------------------------------------------
// F9/codex — one open-finding predicate over finding_state_current.
// ---------------------------------------------------------------------------
emit("");
emit("F9/codex — one open-finding predicate, every reader that publishes a count");

check("no reader derives an open count from findings.status", () => {
  const bad = [];
  for (const rel of [DASHBOARD_REL, SUBSYSTEMS_REL, FINDINGS_REL]) {
    const text = readText(join(REPO, rel));
    if (text === null) {
      bad.push(`${rel} is absent`);
      continue;
    }
    if (/status\s*=\s*'confirmed-bug'/.test(text))
      bad.push(`${rel} carries the duplicate predicate over findings.status`);
  }
  const renderers = readText(join(REPO, RENDERERS_REL));
  if (renderers === null) bad.push(`${RENDERERS_REL} is absent`);
  else if (/WHEN status='confirmed-bug'|FROM findings GROUP BY subsystem_id/.test(renderers))
    bad.push(`${RENDERERS_REL} carries the duplicate predicate over findings.status`);
  return bad.length ? bad.join("; ") : null;
});

// A store the two predicates disagree about: one legacy-only finding that
// only the view's fallback can place, and one finding whose event log has
// overtaken its coarse status. `findings.status` counts two open; the
// resolution record holds one.
function seedDivergentFindings() {
  const insert = fixture.db.prepare(
    `INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status, ref_sha, session_id, pass_type)
     VALUES (?, 'B-02', 'legacy row', 'legacy cause', 'MEDIUM', ?, ?, 'p21', 'survey')`,
  );
  insert.run("B02-LEGACY", "confirmed-bug", fixture.head);
  insert.run("B02-OVERTAKEN", "confirmed-bug", fixture.head);
  // The event log has recorded the repair; `findings.status` has not caught
  // up. Only a reader that goes through the view sees this finding closed.
  fixture.db
    .prepare(
      `INSERT INTO finding_resolution_events
         (finding_id, resolution_state, fix_location, fix_sha, effective_sha, rationale, session_id)
       VALUES ('B02-OVERTAKEN', 'fixed-pending-verification', 'src/ledger.ts', ?, ?, 'repaired', 'p21')`,
    )
    .run(fixture.head, fixture.head);
}

let expectedOpen = null;
check("the fixture holds a legacy-only finding and one the event log has overtaken", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  try {
    seedDivergentFindings();
  } catch (e) {
    return `the divergent findings could not be seeded — ${e && e.message ? e.message : e}`;
  }
  const viewOpen = fixture.db
    .prepare("SELECT COUNT(*) AS n FROM finding_state_current WHERE resolution_state='open'")
    .get();
  const statusOpen = fixture.db
    .prepare("SELECT COUNT(*) AS n FROM findings WHERE status='confirmed-bug'")
    .get();
  expectedOpen = Number(viewOpen?.n ?? -1);
  if (expectedOpen === Number(statusOpen?.n ?? -1))
    return "the fixture does not separate the two predicates, so the arms below could not turn red";
  const legacy = fixture.db
    .prepare("SELECT resolution_state FROM finding_state_current WHERE finding_id='B02-LEGACY'")
    .get();
  if (String(legacy?.resolution_state) !== "open")
    return "the legacy-only finding does not reach the view's fallback";
  return null;
});

check("get_dashboard counts open findings from finding_state_current", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  if (expectedOpen === null) return "the divergent fixture was not seeded";
  const result = call("get_dashboard", {}, fixture.ctx);
  if (!result.ok) return `get_dashboard refused — ${result.error}`;
  const got = Number(result.value?.open_bugs);
  return got === expectedOpen
    ? null
    : `get_dashboard reports ${got} open findings where finding_state_current holds ${expectedOpen}; it is still reading findings.status`;
});

check("list_subsystems counts open findings from finding_state_current", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  if (expectedOpen === null) return "the divergent fixture was not seeded";
  const result = call("list_subsystems", {}, fixture.ctx);
  if (!result.ok) return `list_subsystems refused — ${result.error}`;
  const listed = Array.isArray(result.value) ? result.value : [];
  const got = listed.reduce((total, entry) => total + Number(entry.confirmed_bugs ?? 0), 0);
  return got === expectedOpen
    ? null
    : `list_subsystems reports ${got} open findings where finding_state_current holds ${expectedOpen}; it is still reading findings.status`;
});

function pythonProbe(code) {
  const result = spawnSync(PY, ["-c", code], { encoding: "utf8", cwd: REPO });
  return {
    status: result.status === null ? 1 : result.status,
    out: String(result.stdout ?? "").trim(),
    err: String(result.stderr ?? "").trim(),
  };
}

check("the master plan counts open findings from finding_state_current", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  if (expectedOpen === null) return "the divergent fixture was not seeded";
  const probe = pythonProbe(
    [
      "import json, pathlib, sys",
      `sys.path.insert(0, ${JSON.stringify(join(REPO, "materializer"))})`,
      "from amanuensis_materializer.db import open_ro",
      "from amanuensis_materializer.renderers import render_master_plan",
      `conn = open_ro(pathlib.Path(${JSON.stringify(fixture.project.dbPath)}))`,
      `text, _sources = render_master_plan(conn, pathlib.Path(${JSON.stringify(fixture.project.storagePath)}))`,
      "print(json.dumps({'text': text}))",
    ].join("\n"),
  );
  if (probe.status !== 0 || !probe.out)
    return `the master plan renderer could not be driven — ${scrub(probe.err).slice(0, 200)}`;
  let text = "";
  try {
    text = String(JSON.parse(probe.out.split("\n").pop()).text ?? "");
  } catch {
    return "the master plan probe returned no renderable text";
  }
  const counts = [...text.matchAll(/\((\d+) open\)/g)].map((m) => Number(m[1]));
  if (counts.length === 0) return "the master plan renders no open count to read";
  const got = counts.reduce((total, n) => total + n, 0);
  return got === expectedOpen
    ? null
    : `the master plan reports ${got} open findings where finding_state_current holds ${expectedOpen}; it is still reading findings.status`;
});

// ---------------------------------------------------------------------------
// F4/codex and F2/codex — stale_reason values come from the source.
// ---------------------------------------------------------------------------
emit("");
emit("F4/codex, F2/codex — the stale_reason writers are bound to the enum source");

// Comments are stripped first: a doc comment naming the enum is not a binding
// to it, and this arm exists because two writers were bound to nothing.
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

check("git.ts and standing.ts take their stale_reason values from the generated enum", () => {
  const bad = [];
  for (const rel of [GIT_REL, STANDING_REL]) {
    const raw = readText(join(REPO, rel));
    if (raw === null) {
      bad.push(`${rel} is absent`);
      continue;
    }
    const text = withoutComments(raw);
    if (!/from "\.{1,2}\/vocabulary\.js"/.test(text))
      bad.push(`${rel} does not read the generated enum module`);
    if (!/\bStaleReason\b|\bSTALE_REASONS\b/.test(text))
      bad.push(`${rel} writes a literal stale_reason instead of taking it from the generated STALE_REASONS`);
  }
  return bad.length ? bad.join("; ") : null;
});

// The standing arm runs first, on purpose. §2.2 consults the reachability
// table only for a row the view still calls `examined`, and the detect_changes
// arm below marks two of these rows stale; reading standing afterwards would
// report the ledger column back rather than the table under test.
check("the standing reachability table writes only stale_reason values the source carries", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const reasons = sourceValues("stale_reason");
  if (!reasons) return "the vocabulary source carries no stale_reason enum";
  const wanted = [
    ["src/unreachable.ts", "unreachable-ref"],
    ["src/bad-ref.ts", "unverifiable-ref"],
  ];
  const bad = [];
  for (const [path, reason] of wanted) {
    const account = call("describe_locus", { locus: path }, fixture.ctx);
    if (!account.ok) {
      bad.push(`describe_locus refused ${path} — ${account.error}`);
      continue;
    }
    const owners = account.value?.standing?.owners ?? [];
    if (owners.length === 0) {
      bad.push(`describe_locus reports no owner for ${path}`);
      continue;
    }
    const reported = owners.map((owner) => owner.stale_reason);
    const offending = reported.filter((value) => value !== null && !reasons.includes(String(value)));
    if (offending.length) {
      bad.push(`${path} carries a literal stale_reason ${JSON.stringify(offending[0])}`);
      continue;
    }
    if (!reported.includes(reason))
      bad.push(`${path} reads ${JSON.stringify(reported)}, not ${reason}`);
  }
  return bad.length ? bad.join("; ") : null;
});

check("detect_changes writes only stale_reason values the source carries", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const reasons = sourceValues("stale_reason");
  if (!reasons) return "the vocabulary source carries no stale_reason enum";
  const result = call("detect_changes", { current_sha: fixture.head }, fixture.ctx);
  if (!result.ok) return `detect_changes refused — ${result.error}`;
  const rows = fixture.db
    .prepare("SELECT file_path, stale_reason FROM file_ledger WHERE stale_reason IS NOT NULL")
    .all();
  if (rows.length === 0)
    return "detect_changes marked nothing stale on a fixture holding a drifted, an absent, and an unverifiable row";
  const offending = rows
    .filter((row) => !reasons.includes(String(row.stale_reason)))
    .map((row) => `${row.file_path} carries a literal stale_reason ${JSON.stringify(row.stale_reason)}`);
  if (offending.length) return offending.join("; ");
  const byPath = new Map(rows.map((row) => [row.file_path, String(row.stale_reason)]));
  const wanted = [
    ["src/drift.ts", "git-drift"],
    ["src/gone.ts", "absent"],
    ["src/bad-ref.ts", "unverifiable-ref"],
  ];
  const wrong = wanted
    .filter(([path, reason]) => byPath.get(path) !== reason)
    .map(([path, reason]) => `${path} reads ${JSON.stringify(byPath.get(path) ?? null)}, not ${reason}`);
  return wrong.length ? wrong.join("; ") : null;
});

// ---------------------------------------------------------------------------
// F2/claude — a validator that accepts an out-of-source value turns this red.
// ---------------------------------------------------------------------------
emit("");
emit("F2/claude — every bound validator refuses a value the source does not carry");

const OUT_OF_SOURCE = "not-a-vocabulary-value";

// Each entry drives one validator with arguments that are valid apart from the
// enum field. The refusal must come from the tool, not from a later invariant,
// so each `args` builder is otherwise acceptable on the fixture store.
function validatorProbes() {
  const head = fixture.head;
  return [
    {
      label: "add_evidence.kind",
      tool: "add_evidence",
      args: { ...evidenceArgs(head), kind: OUT_OF_SOURCE },
      enumName: "evidence_kind",
    },
    {
      label: "add_finding.severity",
      tool: "add_finding",
      args: { ...findingArgs("B01-V1", head), severity: OUT_OF_SOURCE },
      enumName: "severity",
    },
    {
      label: "add_finding.status",
      tool: "add_finding",
      args: { ...findingArgs("B01-V2", head), status: OUT_OF_SOURCE },
      enumName: "finding_status",
    },
    {
      label: "add_finding.pass_type",
      tool: "add_finding",
      args: { ...findingArgs("B01-V3", head), pass_type: OUT_OF_SOURCE },
      enumName: "pass_type",
    },
    {
      label: "set_disposition.classification",
      tool: "set_disposition",
      args: { ...dispositionArgs(head), classification: OUT_OF_SOURCE },
      enumName: "disposition_classification",
    },
    {
      label: "set_disposition.evidence_quality",
      tool: "set_disposition",
      args: { ...dispositionArgs(head), evidence_quality: OUT_OF_SOURCE },
      enumName: "evidence_quality",
    },
    {
      label: "update_file_classification.classification",
      tool: "update_file_classification",
      args: { subsystem_id: "B-01", file_path: "src/ledger.ts", classification: OUT_OF_SOURCE },
      enumName: "file_classification",
    },
    {
      label: "add_field_note.category",
      tool: "add_field_note",
      args: {
        subsystem_id: "B-01",
        category: OUT_OF_SOURCE,
        observation: "a note the category should refuse",
        location: "src/ledger.ts",
      },
      enumName: "field_note_category",
    },
    {
      label: "add_claim.subject_type",
      tool: "add_claim",
      args: {
        claim_id: "B-01-c1",
        claim_key: "B-01/concurrency/writer",
        subject_type: OUT_OF_SOURCE,
        subject_id: "src/ledger.ts:append",
        statement: "the writer holds the ledger lock for the whole append",
        epistemic_kind: "observation",
        ref_sha: head,
        evidence_ids: [1],
      },
      enumName: "claim_subject_type",
    },
    {
      label: "add_claim.epistemic_kind",
      tool: "add_claim",
      args: {
        claim_id: "B-01-c2",
        claim_key: "B-01/concurrency/writer",
        subject_type: "symbol",
        subject_id: "src/ledger.ts:append",
        statement: "the writer holds the ledger lock for the whole append",
        epistemic_kind: OUT_OF_SOURCE,
        ref_sha: head,
        evidence_ids: [1],
      },
      enumName: "claim_epistemic_kind",
    },
  ];
}

check("no tool validator accepts a value the vocabulary source does not carry", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const bad = [];
  for (const probe of validatorProbes()) {
    const values = sourceValues(probe.enumName);
    if (!values) {
      bad.push(`the source carries no ${probe.enumName} enum`);
      continue;
    }
    if (values.includes(OUT_OF_SOURCE)) {
      bad.push(`${probe.enumName} carries the probe value, so the arm measures nothing`);
      continue;
    }
    const result = call(probe.tool, probe.args, fixture.ctx);
    if (result.missing) {
      bad.push(`${probe.tool} is not registered`);
      continue;
    }
    if (result.ok) {
      bad.push(`the ${probe.label} validator accepts ${OUT_OF_SOURCE}`);
      continue;
    }
    if (result.accepted === null) {
      bad.push(`the ${probe.label} validator refused without naming what it accepts`);
      continue;
    }
    const extra = result.accepted.filter((value) => !values.includes(value));
    const absent = values.filter((value) => !result.accepted.includes(value));
    if (extra.length)
      bad.push(`the ${probe.label} validator accepts ${extra.join(", ")}, which the source does not carry`);
    if (absent.length)
      bad.push(`the ${probe.label} validator refuses ${absent.join(", ")}, which the source carries`);
  }
  return bad.length ? bad.slice(0, 4).join("; ") : null;
});

// Some vocabularies are enforced by the published input schema rather than by
// a handler call — a host validates them before the handler runs, so the
// behavioural arm above cannot reach them. The tool is found by the property
// it publishes rather than by name, which also keeps this assertion out of
// P13's whole-file scan for `context`-less edge writers.
const SCHEMA_ENFORCED = [{ module: "xrefs", property: "strength", enumName: "xref_strength" }];

check("every enum a tool schema publishes is exactly the source's list", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const bad = [];
  for (const entry of SCHEMA_ENFORCED) {
    const values = sourceValues(entry.enumName);
    if (!values) {
      bad.push(`the source carries no ${entry.enumName} enum`);
      continue;
    }
    const set = mods?.[entry.module]?.[`${entry.module.replace(/s$/, "")}Tools`];
    const definition = (Array.isArray(set) ? set : []).find(
      (candidate) => candidate?.inputSchema?.properties?.[entry.property] !== undefined,
    );
    if (!definition) {
      bad.push(`no tool in ${entry.module} publishes ${entry.property}`);
      continue;
    }
    const schema = definition.inputSchema.properties[entry.property];
    const declared = Array.isArray(schema?.enum) ? schema.enum.map(String) : null;
    if (!declared) {
      bad.push(
        `${definition.name}.${entry.property} publishes no enum, so a validator accepts anything`,
      );
      continue;
    }
    if (declared.join(" ") !== values.join(" "))
      bad.push(
        `${definition.name}.${entry.property} publishes ${declared.join(", ")}, not the source's list`,
      );
  }
  return bad.length ? bad.join("; ") : null;
});

// ---------------------------------------------------------------------------
// F3/claude — a bare percentage presented as health turns the publish red.
// ---------------------------------------------------------------------------
emit("");
emit("F3/claude — the overview lint catches a composite index that carries no 'score'");

// Caught: a label paired with a bare percentage or an n-of-m ratio. Cleared:
// prose that carries no status label, and the counts the overview is required
// to publish. A lint with only the positive arm measures nothing about its
// false-alarm rate (VP7), so both corpora are driven here.
const COMPOSITE_POSITIVE = [
  "Health: 72%",
  "| Overall readiness | 7 of 12 |",
  "Conspectus health 34/57",
  "Maturity — 88 %",
];
const COMPOSITE_NEGATIVE = [
  "| Files carrying a survey obligation marked stale | 12 of 240 |",
  "| Files read, of those carrying an obligation | 340 of 512 |",
  "Findings by resolution state: open 4, verified-fixed 9",
  "The replay covers `100%` of committed transactions.",
];

check("the overview gate exposes a composite-index lint that catches a bare percentage", () => {
  const gatePath = join(REPO, OVERVIEW_GATE_REL);
  if (!existsSync(gatePath)) return `${OVERVIEW_GATE_REL} is absent`;
  const probe = pythonProbe(
    [
      "import importlib.util, json, sys",
      `spec = importlib.util.spec_from_file_location("p21_overview_gate", ${JSON.stringify(gatePath)})`,
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      'fn = getattr(module, "composite_index_violations", None)',
      "if fn is None:",
      "    print(json.dumps({'missing': True}))",
      "else:",
      `    positive = ${JSON.stringify(COMPOSITE_POSITIVE)}`,
      `    negative = ${JSON.stringify(COMPOSITE_NEGATIVE)}`,
      "    print(json.dumps({",
      "        'missed': [line for line in positive if not fn(line)],",
      "        'false_alarms': [line for line in negative if fn(line)],",
      "    }))",
    ].join("\n"),
  );
  if (probe.status !== 0 || !probe.out)
    return `the overview lint could not be driven — ${scrub(probe.err).slice(0, 200)}`;
  let verdict = null;
  try {
    verdict = JSON.parse(probe.out.split("\n").pop());
  } catch {
    return "the overview lint probe returned no verdict";
  }
  if (verdict.missing)
    return `${OVERVIEW_GATE_REL} exposes no composite_index_violations, so a bare percentage presented as health passes`;
  if ((verdict.missed ?? []).length)
    return `the lint misses a bare percentage presented as health: ${verdict.missed.join(" | ")}`;
  if ((verdict.false_alarms ?? []).length)
    return `the lint flags honest counted prose: ${verdict.false_alarms.join(" | ")}`;
  return null;
});

check("the overview gate runs its composite-index lint over the published overview", () => {
  const text = readText(join(REPO, OVERVIEW_GATE_REL));
  if (text === null) return `${OVERVIEW_GATE_REL} is absent`;
  if (!/composite_index_violations\s*\(/.test(text))
    return `${OVERVIEW_GATE_REL} declares no composite-index lint`;
  return /check\((\s*)?"[^"]*composite index[^"]*"/i.test(text)
    ? null
    : "the composite-index lint is declared but never asserted as a check";
});

// ---------------------------------------------------------------------------
check("the packet's gate runs in CI", () => {
  const ci = readText(join(REPO, CI_REL));
  if (ci === null) return `${CI_REL} is absent`;
  return ci.includes("node test-residual-hardening.mjs") ? null : "the gate is not run in CI";
});

// ---------------------------------------------------------------------------
if (fixture?.db) {
  try {
    fixture.db.close();
  } catch {
    /* the fixture is being torn down; a close failure changes no verdict */
  }
}
for (const dir of roots) rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  emit("");
  emit(
    `GATE P21 RED: the residual hardening does not hold — ${failures.length} assertion(s) failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("");
emit("GATE P21 GREEN");
