#!/usr/bin/env node
// Is this *store* fully surveyed? ADR-0001's seven clauses, evaluated read-only
// against an open conspectus.
//
// The A0 checker (`dev/check-living-conspectus.mjs`, deleted 2026-11-23 and in
// git history) was not this: it evaluated a **supplied manifest**, the A0
// historical fixture at `b8b566f`, never an open store. Nor does the server
// carry the predicate — before this file,
// `grep -rn "fully.surveyed" mcp-server/src/` returned one hit, a word inside a
// vocabulary list. Clause 7 added to a predicate with no store-scoped
// implementation would have been vacuous wherever it was enforced
// (design/survey-depth/spec.md §5.5).
//
// The obligation ids are ADR-0001's own, so a red here has the same destination
// a red there does, and clause 7 adds one shape:
// `carried:<archived_store_id>:<archived_finding_id>`.
//
//   exit 0  fully surveyed
//   exit 1  not fully surveyed — every unmet obligation is named
//   exit 2  cannot run: no store, an unreadable store, or a store too old to
//           carry the tables the clauses read
//
// **Two clauses a store alone cannot answer, and they are not silently passed.**
// Clause 5 is exact run fan-in and clause 6 is a clean export's three-axis
// read-back. Both are evaluated here where the store records them — the
// composition run's dispatched/landed/scored sets, and
// `projection_verification_runs` — and both report *unevaluable* rather than
// *satisfied* when the store holds no such record. A predicate that answers
// "yes" because it found nothing to check is the zero-denominator green this
// whole lane exists to remove (VP4).
//
// **The denominator is the survey set** (design/scope/PLAN.md §2.10). Clause 1
// is taken over the tree at R minus the standing reconciliation's
// `scope_exclusions` rows, and a reconciliation stands only while the
// `scope_digest` and `exclusion_digest` it recorded equal digests re-derived
// here from the store's rows. In `sorted` mode a survey path no sorting row
// covers is an obligation, `unsorted:<path>`. Clauses 2, 3 and 4 skip a
// subsystem, and a seam, that is outside the survey (§2.6a) and name it.
//
// Usage:
//   node dev/check-store-fully-surveyed.mjs --store <path/to/memory.db>
//                                           [--workspace <dir>] [--revision <R>]
//                                           [--json] [--clause <n>]
//
// `--workspace` supplies the repository whose tree clause 1 is evaluated
// against; it defaults to the store's grandparent (`<ws>/.amanuensis/memory.db`).
// `--revision` defaults to the reconciliation the store last recorded, because
// a coverage fraction stamped with R may only be taken over R's own immutable
// tree (ADR-0001 clause 1, spec.md §3.3).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const flag = (name) => process.argv.includes(name);
const asJson = flag("--json");

function cannotRun(reason) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ cannot_run: reason }, null, 2)}\n`);
  } else {
    process.stderr.write(`cannot run: ${reason}\n`);
  }
  process.exit(2);
}

const storeArg = arg("--store");
if (!storeArg) cannotRun("no --store <path> given");
const storePath = resolve(storeArg);
if (!existsSync(storePath)) cannotRun(`no store at ${storePath}`);

const workspacePath = resolve(arg("--workspace", dirname(dirname(storePath))));

// node:sqlite is experimental and warns on import; this tool's stderr carries
// its reasons, and a runtime warning in the middle of them is noise.
process.removeAllListeners("warning");
process.on("warning", () => {});
const { DatabaseSync } = await import("node:sqlite");

let db;
try {
  db = new DatabaseSync(storePath, { readOnly: true });
} catch (error) {
  cannotRun(`the store is unreadable (${error?.code ?? error?.message ?? error})`);
}

function tableExists(name) {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(name) !==
    undefined
  );
}
function rows(sql, ...params) {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return null;
  }
}

// A store that predates this lane cannot be evaluated on clause 7, and
// reporting it satisfied would be the false green the clause exists to stop.
for (const required of ["subsystems", "file_ledger", "concerns", "dispositions"]) {
  if (!tableExists(required)) cannotRun(`the store carries no ${required} table`);
}
if (!tableExists("carried_findings")) {
  cannotRun(
    "the store carries no carried_findings table, so clause 7 cannot be evaluated over it; " +
      "open it once with a server carrying design/survey-depth §5.2's schema",
  );
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const clauses = [];
/**
 * One clause's verdict.
 *
 * `considered` is the denominator and is always reported: a clause satisfied
 * over nothing is a different answer from a clause satisfied over everything,
 * and collapsing the two is what lets a conspectus report complete coverage of
 * a set it never enumerated.
 */
function clause(number, title, { satisfied, considered, missing = [], note = null, ...rest }) {
  // `rest` carries a clause's own detail — clause 7's named undecided records,
  // for instance — which the sentence below prints and which a JSON reader
  // would otherwise have to re-derive from the obligation ids.
  clauses.push({
    clause: number,
    title,
    satisfied,
    // A clause with an empty denominator is not *satisfied*, and it is not
    // *missed* either: nobody recorded the thing it reads. Both block `fully
    // surveyed`; only one of them names an obligation somebody can discharge.
    evaluable: considered > 0,
    considered,
    missing,
    note,
    ...rest,
  });
}

// --- clause 1: inventory ----------------------------------------------------

function trackedPathsAt(revision) {
  const result = spawnSync("git", ["ls-tree", "-r", "--name-only", "-z", revision], {
    cwd: workspacePath,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? "")
    .split("\u0000")
    .filter((path) => path.length > 0);
}

/** `git rev-parse <r>^{commit}`, or null when nothing in this workspace answers to it. */
function resolveRevision(revision) {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`], {
    cwd: workspacePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return null;
  const sha = String(result.stdout ?? "").trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/**
 * §3.2's two digests, re-derived here rather than imported.
 *
 * The server computes them in `mcp-server/src/invariants.ts`; this file reads
 * them back from a different implementation on purpose. A predicate that
 * re-derives a digest with the same code that wrote it compares a value with
 * itself and both sides move together (GP24) -- so the formula is restated:
 * SHA-256 over the sorted, NUL-joined parts, one part per tracked path, and
 * one `<path>NUL<classification>` part per ledger row.
 */
function digestOf(parts) {
  return createHash("sha256").update([...parts].sort().join("\u0000")).digest("hex");
}

const NUL = "\u0000";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** A rule or sorting row is withdrawn by a later row that supersedes it (§2.1). */
function activeRows(table, columns) {
  if (!tableExists(table)) return [];
  const all = rows(`SELECT id, ${columns}, supersedes FROM ${table} ORDER BY id`) ?? [];
  const withdrawn = new Set(all.map((row) => row.supersedes).filter((id) => id != null));
  return all.filter((row) => !withdrawn.has(row.id));
}

/**
 * §2.5's `scope_digest`, restated: SHA-256 over the active rules and then the
 * active sorting rows, each as `kind \0 id \0 pattern \0 action-or-category`,
 * in id order, joined with `\n`.
 */
function scopeDigestNow() {
  return sha256(
    [
      ...activeRows("scope_rules", "pattern, action").map((row) =>
        ["rule", row.id, row.pattern, row.action].join(NUL),
      ),
      ...activeRows("scope_sorting", "pattern, category").map((row) =>
        ["sorting", row.id, row.pattern, row.category].join(NUL),
      ),
    ].join("\n"),
  );
}

/**
 * §2.5's `exclusion_digest`, restated: one reconciliation's `scope_exclusions`
 * rows by path, each as `file_path \0 source \0 rule_id-or-empty`, joined with `\n`.
 */
function exclusionDigestOf(exclusions) {
  return sha256(
    [...exclusions]
      .sort((a, b) => (a.file_path < b.file_path ? -1 : a.file_path > b.file_path ? 1 : 0))
      .map((row) => [row.file_path, row.source, row.rule_id ?? ""].join(NUL))
      .join("\n"),
  );
}

/**
 * The store's scope mode: its latest `scope_mode_changes` row. A store that
 * predates survey scope has none, and is `legacy`.
 */
function scopeMode() {
  if (!tableExists("scope_mode_changes")) return "legacy";
  return (rows("SELECT mode FROM scope_mode_changes ORDER BY id DESC LIMIT 1") ?? [])[0]?.mode ?? "legacy";
}

/** Whether the store holds a rule or a sorting row, withdrawn or not (§2.9). */
function hasScopeRows() {
  return ["scope_rules", "scope_sorting"].some(
    (table) => tableExists(table) && (rows(`SELECT 1 AS one FROM ${table} LIMIT 1`) ?? []).length > 0,
  );
}

/** One reconciliation's `scope_exclusions` rows; none for a store without the table. */
function exclusionsOf(reconciliationId) {
  if (!tableExists("scope_exclusions")) return [];
  return (
    rows(
      "SELECT file_path, source, rule_id FROM scope_exclusions WHERE reconciliation_id = ? ORDER BY file_path",
      reconciliationId,
    ) ?? []
  );
}

/**
 * Whether `pattern` covers `path` (§2.2), restated: an exact path, a directory
 * prefix ending in `/`, or a glob where `*` stays inside one segment and `**`
 * crosses them. Only sorting needs it here, to name a path no row covers.
 */
function globRegex(pattern) {
  const directory = pattern.endsWith("/");
  const segments = (directory ? pattern.slice(0, -1) : pattern).split("/");
  const escape = (text) => text.replace(/[\\^$.|?+()[\]{}]/g, "\\$&");
  let source = "";
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === "**") {
      source += last ? ".+" : "(?:[^/]+/)*";
      return;
    }
    source += segment
      .split(/\*{2,}/)
      .map((part) => part.split("*").map(escape).join("[^/]*"))
      .join(".*");
    if (!last) source += "/";
  });
  return new RegExp(`^${source}${directory ? "/.+" : ""}$`, "s");
}
function covers(pattern, path) {
  if (pattern.includes("*")) return globRegex(pattern).test(path);
  return pattern.endsWith("/") ? path.startsWith(pattern) : path === pattern;
}

const LEDGER_CHANGED = "the file ledger has changed since the reconciliation recorded there was taken";
const SCOPE_RULES_CHANGED = "the scope rules have changed since the reconciliation recorded there was taken";
const SCOPE_MODE_CHANGED = "the store's scope mode has changed since the reconciliation recorded there was taken";
const EXCLUSIONS_CHANGED =
  "the scope_exclusions rows recorded there no longer match the reconciliation's exclusion_digest";

/**
 * Is a reconciliation *standing* at R? §3.3's five conditions and the two scope digests (§2.5), and only a row
 * meeting all five is one (`the most recent such row`).
 *
 * Clause 1 used to skip this entirely: it took the newest reconciliation row,
 * enumerated the tree at whatever revision that row named, and re-derived the
 * ledger-against-tree comparison itself. That answers a true question about
 * some revision, and it is not clause 1 -- a store whose ledger has been edited
 * since it last checked itself against the tree has not checked itself against
 * the tree, and §3.3a binds publication and this predicate to the reading, not
 * to a fresh comparison the predicate makes for itself (F5/codex, C13).
 */
function standingReconciliation(revision) {
  const resolved = resolveRevision(revision);
  if (resolved === null) {
    return { row: null, sha: null, why: `${revision} does not resolve to a commit in ${workspacePath}` };
  }
  const tracked = trackedPathsAt(resolved);
  if (tracked === null) {
    return { row: null, sha: resolved, why: `the tree at ${resolved.slice(0, 7)} could not be enumerated` };
  }
  const gitState = (rows("SELECT last_checked_sha FROM git_state ORDER BY repo_id LIMIT 1") ?? [])[0];
  const lastChecked = gitState?.last_checked_sha ?? null;
  const normalizedLastChecked = lastChecked === null ? null : resolveRevision(lastChecked);
  if (normalizedLastChecked !== resolved) {
    return {
      row: null,
      sha: resolved,
      why: `git_state.last_checked_sha is ${lastChecked ?? "unset"}, not ${resolved.slice(0, 7)}`,
    };
  }
  const treeDigest = digestOf(tracked);
  // Each candidate is judged against the store as it is now (§2.5): the scope
  // digest and the exclusion digest are re-derived from the rows, and the
  // ledger digest leaves out the rows on paths that candidate excluded from
  // the survey set (§2.6a).
  const ledger = rows("SELECT file_path, classification FROM file_ledger") ?? [];
  const currentScope = scopeDigestNow();
  const mode = scopeMode();
  const scoped = hasScopeRows();
  const judge = (candidate) => {
    const exclusions = exclusionsOf(candidate.id);
    if (candidate.scope_digest == null) {
      // Taken before survey scope existed: it stands only while the store has
      // no rules and no sorting rows (§2.9), and it resolved no exclusions.
      if (scoped) return SCOPE_RULES_CHANGED;
      if (exclusions.length > 0 || candidate.exclusion_digest != null) return EXCLUSIONS_CHANGED;
    } else {
      if (candidate.scope_digest !== currentScope) return SCOPE_RULES_CHANGED;
      if (candidate.scope_mode !== mode) return SCOPE_MODE_CHANGED;
      if (candidate.exclusion_digest !== exclusionDigestOf(exclusions)) return EXCLUSIONS_CHANGED;
    }
    const excluded = new Set(exclusions.map((exclusion) => exclusion.file_path));
    const current = digestOf(
      ledger
        .filter((entry) => !excluded.has(entry.file_path))
        .map((entry) => `${entry.file_path}\u0000${entry.classification ?? ""}`),
    );
    return candidate.ledger_digest === current ? null : LEDGER_CHANGED;
  };
  let failedWhy = null;
  let row = null;
  for (const candidate of rows(
    `SELECT * FROM scope_reconciliations
      WHERE detected_sha = ? AND tree_digest = ?
      ORDER BY id DESC`,
    resolved,
    treeDigest,
  ) ?? []) {
    const failed = judge(candidate);
    if (failed === null) {
      row = candidate;
      break;
    }
    failedWhy ??= failed;
  }
  if (!row) {
    const atSha = rows("SELECT tree_digest FROM scope_reconciliations WHERE detected_sha = ?", resolved) ?? [];
    const why =
      atSha.length === 0
        ? `no reconciliation has been recorded at ${resolved.slice(0, 7)}`
        : atSha.some((candidate) => candidate.tree_digest === treeDigest)
          ? (failedWhy ?? LEDGER_CHANGED)
          : "the reconciliation recorded there was taken over a different tree";
    return { row: null, sha: resolved, why };
  }
  const exclusions = exclusionsOf(row.id);
  const excluded = new Set(exclusions.map((exclusion) => exclusion.file_path));
  return {
    row,
    sha: resolved,
    why: null,
    tracked,
    survey: tracked.filter((path) => !excluded.has(path)),
    exclusions,
    mode,
  };
}

// The standing reconciliation clause 1 found, kept for the clauses that skip
// what is outside the survey. Null when none stands: with no reading of what
// was excluded, nothing is skipped.
let surveyStanding = null;

{
  const gitState = (rows("SELECT last_checked_sha FROM git_state ORDER BY repo_id LIMIT 1") ?? [])[0];
  const latest = tableExists("scope_reconciliations")
    ? (rows("SELECT * FROM scope_reconciliations ORDER BY id DESC LIMIT 1") ?? [])[0]
    : undefined;
  // R is the revision the *store* says it checked. The newest reconciliation's
  // own sha is the fallback only when git_state carries none, and §3.3's
  // condition 3 then requires the two to agree anyway.
  const revision = arg("--revision", gitState?.last_checked_sha ?? latest?.detected_sha ?? null);
  const standing = revision ? standingReconciliation(revision) : { row: null, sha: null, why: null };
  const tracked = standing.tracked ?? null;
  if (standing.row !== null) surveyStanding = standing;
  if (!revision) {
    clause(1, "inventory names R and every tracked path has one destination", {
      satisfied: false,
      considered: 0,
      missing: ["inventory:revision"],
      note: "the store records no checked revision and no scope reconciliation, so there is no revision its inventory is taken over; §3.3 makes the reading the record",
    });
  } else if (standing.row === null) {
    clause(1, "inventory names R and every tracked path has one destination", {
      satisfied: false,
      considered: 0,
      missing: ["inventory:reconciliation"],
      note: `the store is not reconciled at ${revision.slice(0, 7)} under §3.3's conditions and the scope digests: ${standing.why}`,
    });
  } else if (tracked === null) {
    clause(1, "inventory names R and every tracked path has one destination", {
      satisfied: false,
      considered: 0,
      missing: ["inventory:tree"],
      note: `the tree at ${revision.slice(0, 7)} could not be enumerated in ${workspacePath}; a coverage fraction stamped with R may only be taken over R's own immutable tree`,
    });
  } else {
    // The survey set: the tree minus this reconciliation's exclusions (§2.10).
    // A ledger row on an excluded path is inactive, so it is not looked at.
    // An incomplete inventory is counted over the same set, and keeps each
    // path's named assignment and sorting obligation (F9/codex, slice S3).
    const survey = standing.survey;
    // §3.3a: reconciled is weaker than complete, and only complete licenses
    // *fully surveyed*. A store that accurately records 501 unledgered paths is
    // reconciled and clause 1 is false for it.
    const incomplete =
      Number(standing.row.unledgered ?? 0) !== 0 || Number(standing.row.absent ?? 0) !== 0;
    const owners = new Map();
    for (const row of rows("SELECT subsystem_id, file_path, classification FROM file_ledger") ?? []) {
      if (!owners.has(row.file_path)) owners.set(row.file_path, []);
      owners.get(row.file_path).push(row);
    }
    const missing = incomplete ? ["inventory:unledgered"] : [];
    for (const path of survey) {
      const destinations = owners.get(path) ?? [];
      if (destinations.length === 0) missing.push(`file:${path}:assignment`);
      else if (destinations.length > 1) missing.push(`file:${path}:assignment`);
      else if (
        destinations[0].classification === null ||
        destinations[0].classification === undefined
      ) {
        // An unclassified row is an assignment nobody finished: ADR-0001 clause
        // 1 asks for an assignment *or an explicit exclusion with a reason*,
        // and a NULL classification is neither.
        missing.push(`file:${path}:exclusion-reason`);
      }
    }
    // In `sorted` mode a survey path no active sorting row covers is still owed
    // a product or meta decision (§2.2 step 4).
    if (standing.mode === "sorted") {
      const sorting = activeRows("scope_sorting", "pattern").map((row) => row.pattern);
      const covered = (path) =>
        sorting.some((pattern) => {
          try {
            return covers(pattern, path);
          } catch {
            return false;
          }
        });
      for (const path of survey) if (!covered(path)) missing.push(`unsorted:${path}`);
    }
    const excludedCounts = ["gitignore", "user", "meta"]
      .map((source) => `${standing.exclusions.filter((row) => row.source === source).length} ${source}`)
      .join(", ");
    const over = `the survey set at ${revision.slice(0, 7)}: ${tracked.length} tracked path(s) less ${standing.exclusions.length} excluded (${excludedCounts})`;
    clause(1, "inventory names R and every tracked path has one destination", {
      satisfied: missing.length === 0,
      considered: survey.length,
      missing,
      note: incomplete
        ? `the standing reconciliation at ${standing.sha.slice(0, 7)} reports ${standing.row.unledgered} survey path(s) with no ledger row and ${standing.row.absent} ledger row(s) the tree no longer carries, over ${over}; every survey path needs exactly one subsystem assignment or an explicit exclusion with a reason before coverage over that tree is published`
        : `evaluated over ${over}, against the standing reconciliation recorded there`,
    });
  }
}

// --- what is outside the survey (design/scope/PLAN.md §2.6a) ---------------

// A subsystem whose ledger rows are all on excluded paths is outside the
// survey: it owes no status advance, and clauses 2, 3 and 4 skip it and say
// so. A subsystem with no ledger rows at all is not outside, since nothing
// excluded it. With no standing reconciliation there is no reading of the
// exclusions, so nothing is outside.
const outsideSubsystems = new Set();
if (surveyStanding !== null) {
  const excludedPaths = new Set(surveyStanding.exclusions.map((row) => row.file_path));
  const owned = new Map();
  for (const row of rows("SELECT subsystem_id, file_path FROM file_ledger") ?? []) {
    if (!owned.has(row.subsystem_id)) owned.set(row.subsystem_id, []);
    owned.get(row.subsystem_id).push(row.file_path);
  }
  for (const [id, paths] of owned) {
    if (paths.length > 0 && paths.every((path) => excludedPaths.has(path))) outsideSubsystems.add(id);
  }
}
/** A seam with an endpoint outside the survey is outside it too. */
const seamIsOutside = (seam) => outsideSubsystems.has(seam.party_a) || outsideSubsystems.has(seam.party_b);

// --- clause 2: every assigned subsystem is mapped ---------------------------

{
  const all = rows("SELECT id, status FROM subsystems ORDER BY id") ?? [];
  const outside = all.filter((row) => outsideSubsystems.has(row.id)).map((row) => row.id);
  const subsystems = all.filter((row) => !outsideSubsystems.has(row.id));
  const missing = subsystems
    .filter((row) => row.status !== "mapped")
    .map((row) => `subsystem:${row.id}:phase-sequence`);
  clause(2, "every assigned subsystem is mapped", {
    satisfied: subsystems.length > 0 && missing.length === 0,
    considered: subsystems.length,
    missing,
    note:
      all.length === 0
        ? "the store holds no subsystems, so nothing was surveyed"
        : subsystems.length === 0
          ? "every subsystem is outside the survey, so this clause has no denominator"
          : null,
    outside_survey: outside,
  });
}

// --- clause 3: every active concern has a terminal, evidence-backed disposition

{
  const TERMINAL = new Set([
    "confirmed-bug",
    "confirmed-acceptable",
    "ruled-out",
    "out-of-scope",
    "unresolved-competition",
  ]);
  const everySubsystem = (rows("SELECT id FROM subsystems ORDER BY id") ?? []).map((row) => row.id);
  const outside = everySubsystem.filter((id) => outsideSubsystems.has(id));
  const subsystems = everySubsystem.filter((id) => !outsideSubsystems.has(id));
  const active = (rows("SELECT code FROM concerns WHERE status = 'active' ORDER BY code") ?? []).map(
    (row) => row.code,
  );
  const dispositions = new Map();
  for (const row of rows(
    `SELECT d.subsystem_id, d.concern_code, d.classification,
            (SELECT COUNT(*) FROM disposition_evidence de
              WHERE de.subsystem_id = d.subsystem_id AND de.concern_code = d.concern_code) AS attached
       FROM dispositions d`,
  ) ?? []) {
    dispositions.set(`${row.subsystem_id}/${row.concern_code}`, row);
  }

  // *Evidence-backed* is not *has an attachment row*. §2.3 already refuses the
  // advance for a disposition whose attached ref_sha does not resolve, and
  // §7.3's B3 states the same predicate over the finished store: "at least one
  // attached evidence row whose ref_sha resolves". Counting attachments let a
  // disposition answered at a revision this repository does not carry satisfy
  // clause 3 (F6/codex, C23).
  //
  // One `git cat-file --batch-check` over the distinct revisions, not one
  // subprocess per attachment: the store under audit may hold thousands.
  const attachments = new Map();
  for (const row of rows(
    `SELECT de.subsystem_id, de.concern_code, e.ref_sha
       FROM disposition_evidence de
       JOIN evidence e ON e.id = de.evidence_id`,
  ) ?? []) {
    const key = `${row.subsystem_id}/${row.concern_code}`;
    if (!attachments.has(key)) attachments.set(key, []);
    attachments.get(key).push(row.ref_sha ?? "");
  }
  const distinct = [...new Set([...attachments.values()].flat().filter((sha) => sha.length > 0))];
  const resolves = new Set();
  if (distinct.length > 0) {
    const probe = spawnSync("git", ["cat-file", "--batch-check"], {
      cwd: workspacePath,
      encoding: "utf8",
      input: `${distinct.join("\n")}\n`,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (!probe.error && typeof probe.stdout === "string") {
      for (const [index, line] of probe.stdout.split("\n").entries()) {
        const sha = distinct[index];
        if (sha !== undefined && line.length > 0 && !/\bmissing\b/.test(line)) resolves.add(sha);
      }
    }
  }

  const missing = [];
  for (const subsystemId of subsystems) {
    for (const code of active) {
      const key = `${subsystemId}/${code}`;
      const row = dispositions.get(key);
      if (!row || !TERMINAL.has(row.classification) || Number(row.attached ?? 0) === 0) {
        missing.push(`concern:${key}:disposition`);
        continue;
      }
      if (!(attachments.get(key) ?? []).some((sha) => resolves.has(sha))) {
        missing.push(`concern:${key}:evidence-revision`);
      }
    }
  }
  clause(3, "every active concern has one terminal, evidence-backed disposition", {
    satisfied: subsystems.length * active.length > 0 && missing.length === 0,
    considered: subsystems.length * active.length,
    missing,
    note:
      subsystems.length * active.length === 0
        ? "no subsystem × active-concern pair exists, so this clause has no denominator"
        : null,
    outside_survey: outside,
  });
}

// --- clause 4: every declared seam names two mapped endpoints and is assessed

{
  const everySeam = rows("SELECT id, party_a, party_b FROM seams ORDER BY id") ?? [];
  const outside = everySeam.filter(seamIsOutside).map((seam) => seam.id);
  const seams = everySeam.filter((seam) => !seamIsOutside(seam));
  const status = new Map(
    (rows("SELECT id, status FROM subsystems") ?? []).map((row) => [row.id, row.status]),
  );
  const assessed = new Set(
    (
      rows(
        `SELECT DISTINCT c.seam_id AS seam_id
           FROM composition_seam_concerns c
           JOIN composition_integral_lanes l ON l.run_id = c.run_id
          WHERE l.status = 'scored-pass'`,
      ) ?? []
    ).map((row) => row.seam_id),
  );
  const missing = [];
  for (const seam of seams) {
    for (const endpoint of [seam.party_a, seam.party_b]) {
      if (status.get(endpoint) !== "mapped") missing.push(`seam:${seam.id}:endpoint:${endpoint}`);
    }
    if (!assessed.has(seam.id)) missing.push(`seam:${seam.id}:integral-assessment`);
  }
  clause(4, "every declared seam names two mapped endpoints and is integrally assessed", {
    satisfied: seams.length > 0 && missing.length === 0,
    considered: seams.length,
    missing,
    note:
      everySeam.length === 0
        ? "the store declares no seams, so this clause has no denominator"
        : seams.length === 0
          ? "every seam has an endpoint outside the survey, so this clause has no denominator"
          : null,
    outside_survey: outside,
  });
}

// --- clause 5: exact run fan-in ---------------------------------------------

{
  const runs = rows("SELECT run_id, expected_item_count FROM composition_runs ORDER BY run_id") ?? [];
  const missing = [];
  let considered = 0;
  for (const run of runs) {
    const items = rows("SELECT item_id, status FROM composition_items WHERE run_id = ?", run.run_id) ?? [];
    considered += Number(run.expected_item_count ?? 0);
    const seen = new Set(items.map((item) => item.item_id));
    if (seen.size !== Number(run.expected_item_count ?? 0)) {
      missing.push(`run:${run.run_id}:dispatched:expected-item-count`);
    }
    for (const item of items) {
      if (item.status === "planned") missing.push(`run:${run.run_id}:dispatched:${item.item_id}`);
      else if (item.status === "dispatched") missing.push(`run:${run.run_id}:landed:${item.item_id}`);
      else if (item.status === "landed") missing.push(`run:${run.run_id}:scored:${item.item_id}`);
      else if (item.status === "scored-fail") missing.push(`run:${run.run_id}:scored:${item.item_id}`);
    }
  }
  clause(5, "every expected work item is dispatched, landed and scored", {
    satisfied: runs.length > 0 && missing.length === 0,
    considered,
    missing: runs.length === 0 ? ["run:fan-in:no-run-recorded"] : missing,
    note:
      runs.length === 0
        ? "the store records no composition run, so exact fan-in is unevaluable here — reported unevaluable rather than satisfied, because a clause that passes for want of a denominator is the zero-denominator green this predicate exists to refuse"
        : null,
  });
}

// --- clause 6: a clean export agrees on three axes --------------------------

{
  const AXES = ["state", "coverage", "content"];
  const verified = tableExists("projection_verification_runs")
    ? (rows(
        "SELECT * FROM projection_verification_runs ORDER BY verified_at DESC, rowid DESC LIMIT 1",
      ) ?? [])[0]
    : undefined;
  if (!verified) {
    clause(6, "a clean export agrees with durable state on state, coverage and content", {
      satisfied: false,
      considered: 0,
      missing: AXES.map((axis) => `export:${axis}:read-back`),
      note: "the store records no projection verification run, so the three-axis read-back is unevaluable here — and is reported unevaluable rather than satisfied",
    });
  } else {
    const missing = AXES.filter((axis) => Number(verified[`${axis}_ok`] ?? 0) !== 1).map(
      (axis) => `export:${axis}:read-back`,
    );
    clause(6, "a clean export agrees with durable state on state, coverage and content", {
      satisfied: missing.length === 0,
      considered: AXES.length,
      missing,
      note: null,
    });
  }
}

// --- clause 7: every carried finding has a terminal outcome -----------------

{
  // A corrected outcome stays as a row; the current one is the row no later row
  // supersedes (mcp-server/src/schema.sql, carried_finding_outcomes). A store from
  // before corrections has no supersedes_outcome_id column and one row per record.
  const CURRENT_ONLY =
    " AND NOT EXISTS (SELECT 1 FROM carried_finding_outcomes later" +
    " WHERE later.supersedes_outcome_id = o.id)";
  const corrected = (rows("SELECT 1 FROM pragma_table_info('carried_finding_outcomes') WHERE name = 'supersedes_outcome_id'") ?? []).length > 0;
  const carried =
    rows(
      `SELECT cf.carried_id, cf.archived_finding_id, cf.archived_store_id, cf.severity,
              o.outcome AS outcome
         FROM carried_findings cf
         LEFT JOIN carried_finding_outcomes o ON o.carried_id = cf.carried_id${corrected ? CURRENT_ONLY : ""}
        ORDER BY cf.archived_store_id, cf.archived_finding_id`,
    ) ?? [];
  const undecided = carried.filter((row) => row.outcome === null || row.outcome === undefined);
  clause(7, "every carried finding has a terminal outcome", {
    satisfied: undecided.length === 0,
    considered: carried.length,
    missing: undecided.map((row) => `carried:${row.archived_store_id}:${row.archived_finding_id}`),
    note:
      carried.length === 0
        ? "the store carries no findings from a predecessor; a store that never discarded a conspectus owes it nothing"
        : `${carried.length - undecided.length} of ${carried.length} carried record(s) have reached a terminal outcome`,
    // The named detail clause 7's sentence prints, kept beside the obligation
    // ids so a reader does not have to join two lists by hand.
    ...(undecided.length > 0
      ? {
          undecided: undecided.map((row) => ({
            archived_finding_id: row.archived_finding_id,
            archived_store_id: row.archived_store_id,
            severity: row.severity,
          })),
        }
      : {}),
  });
}

try {
  db.close();
} catch {
  // Every clause was evaluated from reads already taken.
}

const unmet = clauses.filter((entry) => entry.satisfied !== true);
const report = {
  store: storePath,
  workspace: workspacePath,
  fully_surveyed: unmet.length === 0,
  clauses,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const wanted = arg("--clause", null);
  for (const entry of clauses) {
    if (wanted !== null && String(entry.clause) !== wanted) continue;
    const mark =
      entry.satisfied === true ? "ok  " : entry.evaluable === false ? "none" : "MISS";
    process.stdout.write(
      `${mark} clause ${entry.clause}: ${entry.title} (${entry.considered} considered, ${entry.missing.length} unmet)\n`,
    );
    if (entry.note) process.stdout.write(`       ${entry.note}\n`);
    if ((entry.outside_survey ?? []).length > 0) {
      process.stdout.write(`       outside the survey, skipped: ${entry.outside_survey.join(", ")}\n`);
    }
    for (const id of entry.missing.slice(0, 12)) process.stdout.write(`       ${id}\n`);
    if (entry.missing.length > 12) {
      process.stdout.write(`       …and ${entry.missing.length - 12} more\n`);
    }
  }
  const seven = clauses.find((entry) => entry.clause === 7);
  if (seven && seven.satisfied !== true) {
    const named = (seven.undecided ?? [])
      .slice(0, 8)
      .map((row) => `${row.archived_finding_id} (${row.severity}, from ${row.archived_store_id})`)
      .join(", ");
    process.stdout.write(
      `\nnot fully surveyed: ${seven.missing.length} carried finding(s) have no terminal outcome — ` +
        `${named}${seven.missing.length > 8 ? ", …" : ""}. Each must be re-found as a successor ` +
        `finding, ruled out with evidence collected in this store, or marked repaired at a commit ` +
        `that resolves. A discarded defect is not a decided one.\n`,
    );
  }
  process.stdout.write(
    report.fully_surveyed
      ? "\nfully surveyed: all seven clauses hold\n"
      : `\nnot fully surveyed: ${unmet.length} of ${clauses.length} clause(s) unmet\n`,
  );
}

process.exit(report.fully_surveyed ? 0 : 1);
