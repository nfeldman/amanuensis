#!/usr/bin/env node
// The frozen baseline of design/survey-depth/spec.md §1.3, measured from the
// archived clean-slate store and written to `dev/survey-depth-baseline.json`.
//
// The archive is the *measured* baseline, never a restore target
// (`decisions.md` §1). It is opened `file:<path>?immutable=1` — SQLite's frozen
// snapshot mode, which takes no lock and replays no `-wal` — so recording a
// number about it cannot change it, and so the §5.3 legacy identity derived
// below is derived from the row the file actually holds rather than from
// whatever a concurrent writer left in the write-ahead log.
//
// Why the fixture exists at all. The store is machine-local and outside the
// repository; the gate that compares a rebuild against it (`GATE D0`,
// `dev/test-survey-depth.mjs`) runs in CI, where the archive is not. A gate
// whose denominator lives on one laptop has no denominator (VP4(e)), so the
// numbers are committed, together with the SQL that produced each one, and the
// commitment is kept honest by regenerating and comparing rather than by
// trusting the file.
//
//   node dev/record-survey-depth-baseline.mjs            rewrite the fixture
//   node dev/record-survey-depth-baseline.mjs --check    exit 1 if it would change
//   node dev/record-survey-depth-baseline.mjs --print    print it, write nothing
//
// **`--check` has three answers, not two.**
//
//   exit 0   the committed fixture is what the archive still says
//   exit 1   it is not — the difference is printed
//   exit 2   cannot run: the archive is not readable here, or the revision it
//            names does not resolve in this repository
//
// Exit 2 is the load-bearing one. On CI, on another machine, or after the
// archive is moved, a `--check` that silently exited 0 would certify a file
// nothing had been compared against — the zero-denominator green this
// repository has recorded three times (B03-2, B04-1, B04-3), and the reason
// §7.2 requires this path to be exercised rather than assumed. It is in P5's
// regression list and in `plan.json`'s `completion.commands` for that reason.
//
// `AMANUENSIS_BASELINE_STORE` overrides the archive path. It exists so the
// exit-2 path can be driven from `dev/test-survey-depth-red-gates.mjs` on a
// machine where the real archive *is* present; pointing it at a second populated
// store would regenerate the fixture against a different store, which changes
// `archived_store_id` and is exactly what `GATE D0` rejects.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_REL = "dev/survey-depth-baseline.json";
const FIXTURE_PATH = join(REPO, FIXTURE_REL);

const CONTRACT = "amanuensis-survey-depth/baseline/v1";
const MEASURED_AT = "2026-09-14";
const MEASURED_BY = "20260914-020500-design";

const DEFAULT_ARCHIVE = join(
  process.env.HOME ?? "",
  ".claude/automations/amanuensis-clean-slate/archive/store-7c1c1a9/memory.db",
);
const ARCHIVE_PATH = resolve(process.env.AMANUENSIS_BASELINE_STORE || DEFAULT_ARCHIVE);
// Recorded in the fixture with `$HOME` folded back to `~`, because the absolute
// form names whoever ran it and the fixture is committed.
const ARCHIVE_DISPLAY = process.env.HOME
  ? ARCHIVE_PATH.replace(
      new RegExp(`^${process.env.HOME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      "~",
    )
  : ARCHIVE_PATH;

const checkOnly = process.argv.includes("--check");
const printOnly = process.argv.includes("--print");

function cannotRun(reason) {
  process.stderr.write(`cannot run: ${reason}\n`);
  process.exit(2);
}

// node:sqlite is experimental and warns on import; this tool's stderr carries
// its reasons and a runtime warning in the middle of them is noise.
process.removeAllListeners("warning");
process.on("warning", () => {});

// ---------------------------------------------------------------------------
// §1.2's twelve measures, carried verbatim into the fixture so a reader can
// re-derive every number without this session. D9 is two statements over one
// table; D2, D3, D10 and D12 need the tree beside the SQL, and say so.
// ---------------------------------------------------------------------------
const QUERIES = {
  D1: "SELECT COUNT(*) FROM file_ledger;",
  D2: [
    "-- tracked = git ls-tree -r --name-only -z <R>",
    "SELECT DISTINCT file_path FROM file_ledger WHERE classification IN (<the classifications",
    "  mcp-server/contracts/conspectus-vocabulary.json marks obligation_bearing = false>);",
    "-- D2 = |tracked| - |tracked INTERSECT exempt|; a tracked path with no ledger row is",
    "-- obligation-bearing, because an unclassified file is unread, not exempt.",
  ],
  D3: [
    "SELECT DISTINCT file_path FROM file_ledger WHERE classification='examined';",
    "-- D3 = |tracked INTERSECT examined|; D3% = D3 / D2, or 'not measured' when D2 = 0.",
  ],
  D4: "SELECT COUNT(*) FROM evidence;",
  D5: "SELECT COUNT(*) FROM dispositions;",
  D6: "-- D4 / D5, or 'not measured' when D5 = 0.",
  D7: [
    "SELECT COUNT(*) FROM dispositions d",
    " WHERE EXISTS (SELECT 1 FROM disposition_evidence de",
    "                WHERE de.subsystem_id=d.subsystem_id AND de.concern_code=d.concern_code);",
    "-- D7% = D7 / D5, or 'not measured' when D5 = 0.",
  ],
  D8: "SELECT COUNT(*) FROM field_notes;",
  D9: [
    "SELECT COUNT(*) FROM open_questions;",
    "SELECT COUNT(*) FROM open_questions WHERE resolution='open';",
  ],
  D10: [
    "SELECT COUNT(*) FROM vocabulary WHERE first_seen IS NOT NULL AND TRIM(first_seen) <> '';",
    "-- and, per row, whether first_seen matches CITATION_TOKEN_SOURCE",
    "-- (mcp-server/src/helpers.ts:283) and whether its path is in the tree at its revision.",
    "-- A term whose anchor does not resolve is counted unanchored, never as a term.",
  ],
  D11: [
    "SELECT COUNT(*) FROM findings WHERE status='confirmed-bug';",
    "SELECT status, COUNT(*) FROM findings GROUP BY status ORDER BY status;",
  ],
  D12: [
    "-- |tracked| - |tracked INTERSECT ledger|, computed from the tree, beside",
    "SELECT COUNT(*) FROM scope_gaps WHERE kind='unledgered';",
    "-- the count the store believes. Their disagreement is itself the measure.",
  ],
};

// §7.3's six acceptance predicates, listed under their own key so a reader is
// never told the gate runs twelve statements when it runs twelve statements and
// six per-record predicates (§1.2, C1/codex).
const PREDICATES = {
  B1: "The candidate is reconciled at its checked revision under §3.3's five conditions; the standing reconciliation's unledgered and absent both equal the counts re-derived from the tree, and both are zero (ADR-0001 clause 1).",
  B2: "D3% >= the frozen baseline fraction, both sides over the tracked denominator at each store's own reconciled revision.",
  B3: "Every disposition in a subsystem at 'concerns' or later has at least one attached evidence row whose ref_sha resolves.",
  B4: "Every subsystem at 'structural' or later has an anchored term or a declination.",
  B5: "Every baseline open finding in blocking.open_findings has a carried record in the candidate, qualified by this archived_store_id, with a terminal outcome.",
  B6: "No carried record in the candidate is undecided.",
};

// ---------------------------------------------------------------------------
// The archive
// ---------------------------------------------------------------------------
if (!existsSync(ARCHIVE_PATH)) {
  cannotRun(`the archived store is not readable at ${ARCHIVE_PATH}`);
}

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  cannotRun(
    `this runtime (${process.version}) carries no node:sqlite, so the archive cannot be opened immutably`,
  );
}

// A SQLite URI: '?' and '#' end the path, so they are the two characters that
// must be escaped in it.
const uri = `file:${encodeURI(ARCHIVE_PATH).replace(/\?/g, "%3f").replace(/#/g, "%23")}?immutable=1`;
let db;
try {
  db = new DatabaseSync(uri, { readOnly: true });
} catch (error) {
  cannotRun(
    `the archived store at ${ARCHIVE_PATH} could not be opened immutably (${error?.code ?? error?.message ?? error})`,
  );
}

function one(sql, ...params) {
  return db.prepare(sql).get(...params);
}
function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}
function count(sql) {
  try {
    return Number(Object.values(one(sql))[0]);
  } catch (error) {
    cannotRun(
      `the archived store does not answer ${JSON.stringify(sql)} (${error?.message ?? error})`,
    );
  }
}

// ---------------------------------------------------------------------------
// §5.3's identity, and the revision every coverage measure is taken at.
// ---------------------------------------------------------------------------
let gitState;
try {
  gitState = one(
    "SELECT repo_id, canonical_branch, onboarding_sha, last_checked_sha FROM git_state ORDER BY repo_id LIMIT 1",
  );
} catch (error) {
  cannotRun(`the archived store carries no readable git_state row (${error?.message ?? error})`);
}
if (!gitState) cannotRun("the archived store carries no git_state row, so it names no revision");

/**
 * §5.3's legacy identity: `store-legacy-` plus the first 16 hex of SHA-256 over
 * the frozen `<repo_id>|<canonical_branch>|<onboarding_sha>|<last_checked_sha>`.
 *
 * Restated here rather than imported from `mcp-server/src/invariants.ts`
 * (`archivedStoreId`) so that this tool runs on a bare checkout with nothing
 * built. It is not left to drift: where the build *is* present, the two are
 * compared below and a disagreement is a refusal, not a warning.
 */
function legacyIdentityFrom(row) {
  const tuple = [
    row.repo_id ?? "",
    row.canonical_branch ?? "",
    row.onboarding_sha ?? "",
    row.last_checked_sha ?? "",
  ].join("|");
  return `store-legacy-${createHash("sha256").update(tuple).digest("hex").slice(0, 16)}`;
}

let archivedStoreId;
{
  let minted = null;
  try {
    minted =
      one("SELECT store_generation FROM store_identity WHERE id = 1")?.store_generation ?? null;
  } catch {
    minted = null; // frozen before store_identity existed: §5.3's legacy case
  }
  archivedStoreId =
    typeof minted === "string" && minted.length > 0
      ? `store-${minted.slice(0, 16)}`
      : legacyIdentityFrom(gitState);
}

// GP28 parity. `archivedStoreId` is the server's implementation of the same
// rule; where it can be loaded, the two must agree, and a disagreement means one
// of them has moved. This never *supplies* the id — it checks the one above.
let parity = "not evaluated: mcp-server/dist is not built here";
try {
  const invariants = await import("../mcp-server/dist/invariants.js");
  if (typeof invariants.archivedStoreId === "function") {
    const theirs = invariants.archivedStoreId(ARCHIVE_PATH, { immutable: true });
    if (theirs !== archivedStoreId) {
      cannotRun(
        `§5.3's identity is derived two ways and they disagree: this tool reads ${archivedStoreId}, ` +
          `mcp-server/dist/invariants.js reads ${theirs}. One of the two has moved; fix it before ` +
          "freezing a fixture that names the archive.",
      );
    }
    parity = `agrees with mcp-server/src/invariants.ts archivedStoreId()`;
  }
} catch {
  /* a bare checkout is the ordinary case; the fixture does not depend on it */
}

const checkedSha = String(gitState.last_checked_sha ?? "");

function git(...args) {
  return spawnSync("git", args, {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const resolvedSha = (() => {
  if (!checkedSha) return null;
  const result = git("rev-parse", "--verify", "--quiet", `${checkedSha}^{commit}`);
  if (result.error || result.status !== 0) return null;
  const sha = String(result.stdout ?? "").trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
})();
if (!resolvedSha) {
  cannotRun(
    `the archived store was reconciled at ${checkedSha || "(unset)"}, which does not resolve to a ` +
      `commit in ${REPO}; a coverage fraction stamped with R may only be taken over R's own tree (§3.3)`,
  );
}

const tracked = (() => {
  const result = git("ls-tree", "-r", "--name-only", "-z", resolvedSha);
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? "")
    .split("\u0000")
    .filter((path) => path.length > 0);
})();
if (tracked === null) cannotRun(`the tree at ${resolvedSha.slice(0, 7)} could not be enumerated`);
const trackedSet = new Set(tracked);

// ---------------------------------------------------------------------------
// D2's exempt set, generated from the contract and never transcribed (§1.2,
// GP28, D9/codex). `deferred-with-reason` is obligation-bearing there, and 35
// AxiomDB paths turn on it.
// ---------------------------------------------------------------------------
const VOCABULARY_REL = "mcp-server/contracts/conspectus-vocabulary.json";
let exemptClassifications;
try {
  const contract = JSON.parse(readFileSync(join(REPO, VOCABULARY_REL), "utf8"));
  const values = contract?.enums?.file_classification?.values ?? [];
  if (!values.length) throw new Error("file_classification declares no values");
  const unflagged = values.filter((value) => typeof value?.obligation_bearing !== "boolean");
  if (unflagged.length) {
    throw new Error(
      `${unflagged.map((v) => v?.value).join(", ")} carry no obligation_bearing flag`,
    );
  }
  exemptClassifications = values
    .filter((value) => value.obligation_bearing === false)
    .map((value) => value.value)
    .sort();
} catch (error) {
  cannotRun(`${VOCABULARY_REL} does not supply D2's exempt set (${error?.message ?? error})`);
}

// ---------------------------------------------------------------------------
// The twelve measures
// ---------------------------------------------------------------------------
const ledgerRows = all("SELECT file_path, classification FROM file_ledger");
const ledgerPaths = new Set(ledgerRows.map((row) => row.file_path));

const exemptSet = new Set(exemptClassifications);
const exemptPaths = new Set(
  ledgerRows.filter((row) => exemptSet.has(row.classification ?? "")).map((row) => row.file_path),
);
const examinedPaths = new Set(
  ledgerRows.filter((row) => row.classification === "examined").map((row) => row.file_path),
);

const D1 = count("SELECT COUNT(*) FROM file_ledger");
const D2 = tracked.filter((path) => !exemptPaths.has(path)).length;
const D3 = tracked.filter((path) => examinedPaths.has(path)).length;
const D4 = count("SELECT COUNT(*) FROM evidence");
const D5 = count("SELECT COUNT(*) FROM dispositions");
const D7 = count(
  `SELECT COUNT(*) FROM dispositions d
    WHERE EXISTS (SELECT 1 FROM disposition_evidence de
                   WHERE de.subsystem_id=d.subsystem_id AND de.concern_code=d.concern_code)`,
);
const D8 = count("SELECT COUNT(*) FROM field_notes");
const D9all = count("SELECT COUNT(*) FROM open_questions");
const D9open = count("SELECT COUNT(*) FROM open_questions WHERE resolution='open'");
const D11 = count("SELECT COUNT(*) FROM findings WHERE status='confirmed-bug'");
const D12tree = tracked.filter((path) => !ledgerPaths.has(path)).length;
const D12absent = [...ledgerPaths].filter((path) => !trackedSet.has(path)).length;
const D12store = count("SELECT COUNT(*) FROM scope_gaps WHERE kind='unledgered'");

// D10: an anchor is a term only when it parses and its path is in the tree at
// its own revision. `CITATION_TOKEN_SOURCE`, mcp-server/src/helpers.ts:283.
const CITATION_TOKEN = /^[^\s:]+(?:\/[^\s:]+)*:[^\s@]+@[0-9a-fA-F]{7,40}$/;
const anchoredRows = all(
  "SELECT term, first_seen FROM vocabulary WHERE first_seen IS NOT NULL AND TRIM(first_seen) <> '' ORDER BY term",
);
const D10 = anchoredRows.length;
const D10parsing = anchoredRows.filter((row) => CITATION_TOKEN.test(String(row.first_seen))).length;

const dispositionEvidenceRows = count("SELECT COUNT(*) FROM disposition_evidence");
const unattachedDispositions = D5 - D7;

const statusHistogram = Object.fromEntries(
  all("SELECT status, COUNT(*) n FROM findings GROUP BY status ORDER BY status").map((row) => [
    row.status,
    Number(row.n),
  ]),
);
const classificationHistogram = Object.fromEntries(
  all(
    "SELECT COALESCE(classification,'(null)') k, COUNT(*) n FROM file_ledger GROUP BY 1 ORDER BY 1",
  ).map((row) => [row.k, Number(row.n)]),
);

const openFindings = all(
  "SELECT finding_id FROM findings WHERE status='confirmed-bug' ORDER BY finding_id",
).map((row) => row.finding_id);

const ratio = (numerator, denominator) =>
  denominator === 0 ? null : Number((numerator / denominator).toFixed(4));

const fixture = {
  contract: CONTRACT,
  archived_store_id: archivedStoreId,
  archived_path: ARCHIVE_DISPLAY,
  checked_sha: resolvedSha,
  measured_at: MEASURED_AT,
  measured_by: MEASURED_BY,
  obligation_exempt_classifications: exemptClassifications,
  queries: QUERIES,
  predicates: PREDICATES,
  blocking: {
    examined_fraction: ratio(D3, D2),
    examined: D3,
    obligation_bearing: D2,
    tracked_paths: tracked.length,
    unledgered: D12tree,
    absent: D12absent,
    open_findings: openFindings,
  },
  reported: {
    ledger_rows: D1,
    evidence: D4,
    dispositions: D5,
    evidence_per_disposition: ratio(D4, D5),
    attached_dispositions: D7,
    attached_coverage: ratio(D7, D5),
    unattached_dispositions: unattachedDispositions,
    disposition_evidence_rows: dispositionEvidenceRows,
    field_notes: D8,
    open_questions_all: D9all,
    open_questions_open: D9open,
    anchored_terms: D10,
    anchored_terms_in_citation_form: D10parsing,
    open_findings: D11,
    scope_gaps_unledgered: D12store,
    subsystems: count("SELECT COUNT(*) FROM subsystems"),
    seams: count("SELECT COUNT(*) FROM seams"),
    claims: count("SELECT COUNT(*) FROM claims"),
    xrefs: count("SELECT COUNT(*) FROM xrefs"),
    sessions: count("SELECT COUNT(*) FROM sessions"),
    finding_status_histogram: statusHistogram,
    classification_histogram: classificationHistogram,
  },
};

db.close();

const rendered = `${JSON.stringify(fixture, null, 2)}\n`;

if (printOnly) {
  process.stdout.write(rendered);
  process.exit(0);
}

if (checkOnly) {
  if (!existsSync(FIXTURE_PATH)) {
    process.stderr.write(
      `${FIXTURE_REL} is absent; run this tool with no arguments to write it.\n`,
    );
    process.exit(1);
  }
  const committed = readFileSync(FIXTURE_PATH, "utf8");
  if (committed === rendered) {
    process.stdout.write(
      `${FIXTURE_REL} still matches the archive at ${ARCHIVE_DISPLAY} ` +
        `(${archivedStoreId}, reconciled at ${resolvedSha.slice(0, 7)}; identity parity: ${parity})\n`,
    );
    process.exit(0);
  }
  process.stderr.write(`${FIXTURE_REL} no longer matches the archive it was measured from.\n`);
  const committedLines = committed.split("\n");
  const renderedLines = rendered.split("\n");
  let shown = 0;
  for (let i = 0; i < Math.max(committedLines.length, renderedLines.length) && shown < 20; i++) {
    if (committedLines[i] !== renderedLines[i]) {
      process.stderr.write(`  line ${i + 1}\n    committed: ${committedLines[i] ?? "(absent)"}\n`);
      process.stderr.write(`    archive:   ${renderedLines[i] ?? "(absent)"}\n`);
      shown += 1;
    }
  }
  process.exit(1);
}

writeFileSync(FIXTURE_PATH, rendered);
process.stdout.write(
  `wrote ${FIXTURE_REL} from ${ARCHIVE_DISPLAY}\n` +
    `  ${archivedStoreId}, reconciled at ${resolvedSha.slice(0, 7)} over ${tracked.length} tracked path(s)\n` +
    `  examined ${D3}/${D2} obligation-bearing, ${D12tree} unledgered, ${D12absent} absent\n` +
    `  ${openFindings.length} open finding(s) the acceptance rebuild must account for\n` +
    `  identity parity: ${parity}\n`,
);
