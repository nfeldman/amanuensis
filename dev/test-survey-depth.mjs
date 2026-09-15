#!/usr/bin/env node
// GATE D0 (design/survey-depth/spec.md §7.1) — survey depth, against a baseline
// that was frozen before anything in this lane could move it.
//
// A clean-slate rebuild passed every gate this repository had while recording a
// fifth of the prior survey's file coverage, a quarter of its evidence, one in
// sixty of its evidence-backed dispositions, no vocabulary, and none of six
// prior open defects (§0). Every one of those is a *depth* fact, and nothing
// measured depth. This gate does, against the archived store's frozen numbers.
//
// **Two arms, because the store is untracked.** `git ls-files .amanuensis`
// returns 0, so a gate that only read a live store would be green by absence in
// CI — the zero-denominator failure this repository has already recorded three
// times (VP4; concern ZD-1). The baseline is therefore a committed fixture
// (`dev/survey-depth-baseline.json`, written by
// `dev/record-survey-depth-baseline.mjs`), and the candidate is the live store
// where one exists and otherwise the committed acceptance receipt. Where both
// exist, both are read and required to agree: a receipt nobody can contradict is
// a claim about a claim.
//
// **Three states, not two.** Between the packet that registers this gate and the
// packet that writes the receipt there is neither a live store nor a receipt.
// That is reported as `GATE P10 CANNOT RUN: GATE D0 CANNOT RUN` with exit **2** — an absence reported
// as an absence (VP4(e)) rather than a knowing red that stops being a signal.
// `GATE D1` (§8.5) asserts the third state is reached there, so it cannot be
// used to hide a real red, and §8.0 clause 3 forbids offering it as a red proof.
//
// **What turns it red** — §7.3's six predicates, evaluated over rows, never over
// the counts beside them, and recomputed from the receipt's row-level witnesses
// where the candidate is a receipt:
//
//   B1  the candidate is reconciled at its checked revision under §3.3's five
//       conditions, and the standing reconciliation's `unledgered` and `absent`
//       both equal the counts re-derived from `git ls-tree` *and are both zero*.
//       A store whose record disagrees with the tree is red; so is one whose
//       record agrees with the tree and says 501 (ADR-0001 clause 1, C29/codex).
//   B2  the examined fraction is at least the frozen baseline's, both sides over
//       the tracked denominator at each store's own reconciled revision (§1.4).
//   B3  every disposition in a subsystem at `concerns` or later carries at least
//       one attached evidence row whose `ref_sha` resolves.
//   B4  every subsystem at `structural` or later has an anchored term or a
//       declination that still resolves.
//   B5  every baseline open finding has a carried record here, qualified by the
//       archived store's identity, with a terminal outcome. Named when absent.
//   B6  no carried record here is undecided.
//
// The baseline arm is red — never green, never `cannot run` — when the fixture
// is absent, unparseable, undeclared, or not bound to the archived store's
// identity and anchor (§1.5): a missing denominator is not a pass.
//
// **What is reported and never blocks.** D1, D4, D5, D6, D7%, D8, D9, D10, D11,
// both classification histograms and the claim/xref/session counts are printed
// with the baseline beside them and a signed delta. A count over a field an
// agent authors is a quota, and quotas over authored fields are filled to order
// (BP4; `decisions.md` §3; the same reasoning already in
// `mcp-server/src/invariants.ts:152-160`). §8.5 records what that costs.
//
// Every fraction prints its denominator, and a zero denominator prints
// `not measured` rather than a percentage: a store that has not reconciled at
// its checked revision has no denominator and therefore no coverage fraction
// (§1.4, VP4(e)).
//
// **Test seam.** `AMANUENSIS_DEPTH_WORKSPACE` relocates the *candidate* — the
// live store, the committed receipt and the git the candidate's revisions are
// resolved in all move together, so no arm can be swapped for a friendlier one
// on its own. `AMANUENSIS_DEPTH_BASELINE` relocates the fixture. Both exist for
// `dev/test-survey-depth-red-gates.mjs`, which seeds faults into a synthetic
// store; both are printed in the header when set, so a relocated run says so.
//
// **The receipt shape this arm recomputes from** (§7.5), for whoever writes
// `design/survey-depth/acceptance-receipt.json`. Aggregate counts are not
// enough for B3 or B4 — "does *this* disposition carry a resolvable row" and
// "which record discharged *this* subsystem" are per-row questions:
//
//   { "contract": "amanuensis-survey-depth/acceptance-receipt/v1",
//     "repository_sha": "<40 hex, an ancestor of HEAD>",
//     "blocking": {
//       "B1": { "witness": { "detected_sha", "tree_digest", "ledger_digest",
//                            "tracked_paths", "ledger_rows", "unledgered",
//                            "absent", "exempt" } },
//       "B2": { "examined": <n>, "obligation_bearing": <n> },
//       "B3": { "dispositions": [ { "subsystem_id", "concern_code",
//                                   "subsystem_status",
//                                   "attachments": [ { "evidence_id", "ref_sha",
//                                                      "resolved" } ] } ] },
//       "B4": { "subsystems": [ { "id", "status",
//                                 "terms": [ { "term", "first_seen" } ],
//                                 "declination": { "id", "ref_sha", "session_id" } } ] },
//       "B5": { "carried": [ { "archived_store_id", "archived_finding_id",
//                              "outcome", "repaired_sha",
//                              "evidence_revisions": [] } ] } },
//     "reported": { … the axes below, by the fixture's own key names … } }
//
// A `verdict` field beside any of those is ignored on purpose. So is
// `attachments[].resolved`: it says what was true when the receipt was written,
// and a revision can be rewritten away afterwards, so every `ref_sha` is
// re-resolved here.
//
// **False greens it cannot exclude.** The reported axes, by design. And B2
// cannot distinguish a file that was read from a file marked `examined`: the
// classification is an assertion, and this gate checks its coverage, not its
// honesty.
//
// Output protocol: exactly one status line, last, on stdout, scrubbed of the
// launcher's crash signatures. It leads with the packet marker §8.0 binds the
// launcher to and carries §7.1's `GATE D0` verdict as its reason, because the
// two name the same gate in different vocabularies — see `PACKET` below.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { historyIsComplete, resolveRevisions } from "./receipt-provenance.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BASELINE_REL = "dev/survey-depth-baseline.json";
const RECEIPT_REL = "design/survey-depth/acceptance-receipt.json";
const STORE_REL = ".amanuensis/memory.db";
const VOCABULARY_REL = "mcp-server/contracts/conspectus-vocabulary.json";

const BASELINE_CONTRACT = "amanuensis-survey-depth/baseline/v1";
const RECEIPT_CONTRACT = "amanuensis-survey-depth/acceptance-receipt/v1";

const CANDIDATE_ROOT = resolve(process.env.AMANUENSIS_DEPTH_WORKSPACE || REPO);
const BASELINE_PATH = resolve(process.env.AMANUENSIS_DEPTH_BASELINE || join(REPO, BASELINE_REL));
const STORE_PATH = join(CANDIDATE_ROOT, STORE_REL);
const RECEIPT_PATH = join(CANDIDATE_ROOT, RECEIPT_REL);

// The status ladder, and the two rungs the predicates bind at. `deferred` is off
// the ladder entirely and owes neither.
const STATUS_ORDER = ["unmapped", "scoping", "structural", "concerns", "adversarial", "mapped"];
const statusRank = (status) =>
  status === "deferred" ? -1 : STATUS_ORDER.indexOf(String(status ?? ""));
const STRUCTURAL_RANK = STATUS_ORDER.indexOf("structural");
const CONCERNS_RANK = STATUS_ORDER.indexOf("concerns");

// §9.2's one-token citation grammar (`CITATION_TOKEN_SOURCE`,
// mcp-server/src/helpers.ts:283), restated rather than imported so this gate
// runs with nothing built.
const CITATION_TOKEN = /^([^\s:]+(?:\/[^\s:]+)*):([^\s@]+)@([0-9a-fA-F]{7,40})$/;

// ---------------------------------------------------------------------------
// Output funnel. Nothing reaches stdout except through emit(), and everything is
// scrubbed of the launcher's crash signatures, so a genuine assertion failure is
// never mistaken for a gate that never ran.
// ---------------------------------------------------------------------------
const SCRUB = [
  [/MODULE_NOT_FOUND/g, "module-absent"],
  [/ModuleNotFoundError/g, "python-module-absent"],
  [/Cannot find module/g, "cannot load module"],
  [/No such file or directory/g, "path is absent"],
  [/No such file/g, "path is absent"],
  [/can't open file/g, "cannot open path"],
  [/SyntaxError/g, "syntax-error"],
  [/ImportError/g, "python-import-error"],
  [/ReferenceError/g, "reference-error"],
  [/TypeError/g, "type-error"],
  [/ENOENT/g, "PATH-ABSENT"],
  [/is not defined/g, "is undeclared"],
  [/is not a function/g, "is not callable"],
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
  return reason === null;
}

// The status line addresses two readers with different vocabularies, so it
// carries both names. §7.1 fixes this gate's verdict as `GATE D0 …`; §8.0
// clauses 1-2 bind the launcher to the *packet* id, and `verify_packet` greps
// `^GATE P10 RED: ` at the red commit and `^GATE P10 GREEN` at HEAD, knowing
// nothing of the spec's gate names. P5 shipped a complete, correct gate and was
// refused for exactly this collision; it fixed it by leading with the packet
// marker and carrying the spec gate's verdict as the reason, and D0 is the
// second and last gate in this lane whose spec name is not its packet id.
// `gate.red_expect`, which §8.0 says quotes the first line of the reason, is
// therefore still matched by the D0 half.
const PACKET = "P10";

function red(reason) {
  emit("");
  emit(`GATE ${PACKET} RED: GATE D0 RED: ${reason}`);
  process.exit(1);
}

function cannotRun(reason) {
  emit("");
  emit(`GATE ${PACKET} CANNOT RUN: GATE D0 CANNOT RUN: ${reason}`);
  process.exit(2);
}

// node:sqlite is experimental and warns on import; this gate's stdout is its
// verdict and a runtime warning in the middle of it is noise.
process.removeAllListeners("warning");
process.on("warning", () => {});

// ---------------------------------------------------------------------------
// Numbers, always with what they are out of.
// ---------------------------------------------------------------------------
/** `70.59% (12/17)`, or `not measured (denominator 0)` — never a bare percent. */
function pct(numerator, denominator) {
  if (!(denominator > 0)) return `not measured (denominator 0, ${numerator} counted)`;
  return `${((100 * numerator) / denominator).toFixed(2)}% (${numerator}/${denominator})`;
}

function signed(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "(no baseline)";
  const rendered = Math.abs(value).toFixed(digits);
  if (value > 0) return `(+${rendered})`;
  if (value < 0) return `(−${rendered})`;
  return `(±${rendered})`;
}

function signedPoints(candidate, base) {
  if (candidate === null || base === null) return "(no baseline)";
  const delta = 100 * (candidate - base);
  const rendered = Math.abs(delta).toFixed(2);
  if (delta > 0) return `(+${rendered} pp)`;
  if (delta < 0) return `(−${rendered} pp)`;
  return `(±${rendered} pp)`;
}

const NUL = "\u0000";
/**
 * §3.2's digest formula, restated rather than imported.
 *
 * `mcp-server/src/invariants.ts` computes the digests this gate verifies. A
 * predicate that re-derives a digest with the same code that wrote it compares
 * a value with itself and both halves move together (GP24), so the formula is
 * written out: SHA-256 over the sorted, NUL-joined parts.
 */
function digestOf(parts) {
  return createHash("sha256")
    .update([...parts].sort().join(NUL))
    .digest("hex");
}

function git(cwd, ...args) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** `git rev-parse <r>^{commit}`, or null when nothing here answers to it. */
function resolveRevision(cwd, revision) {
  if (typeof revision !== "string" || !revision) return null;
  const result = git(cwd, "rev-parse", "--verify", "--quiet", `${revision}^{commit}`);
  if (result.error || result.status !== 0) return null;
  const sha = String(result.stdout ?? "").trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

function trackedPathsAt(cwd, revision) {
  const result = git(cwd, "ls-tree", "-r", "--name-only", "-z", revision);
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? "")
    .split(NUL)
    .filter((path) => path.length > 0);
}

/**
 * Which of `revisions` name a commit here, in one batched `git cat-file
 * --batch-check` — the same one call the server pays on a durable write
 * (C37/claude), rather than one subprocess per revision.
 */
function resolveMany(cwd, revisions) {
  const resolved = new Map();
  const askable = [];
  for (const value of revisions) {
    if (resolved.has(value)) continue;
    resolved.set(value, false);
    if (typeof value === "string" && value.length > 0 && !/\s/.test(value)) askable.push(value);
  }
  if (!askable.length) return resolved;
  const result = spawnSync("git", ["cat-file", "--batch-check"], {
    cwd,
    encoding: "utf8",
    input: `${askable.map((value) => `${value}^{commit}`).join("\n")}\n`,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return resolved;
  const lines = String(result.stdout ?? "")
    .split("\n")
    .filter((line) => line.length > 0);
  for (let i = 0; i < askable.length && i < lines.length; i++) {
    if (/^[0-9a-f]{40} commit \d+$/.test(lines[i])) resolved.set(askable[i], true);
  }
  return resolved;
}

/**
 * Does a `file:symbol@sha` anchor still open? The token must parse, its
 * revision must resolve, and its path must be in that revision's tree — the
 * three conditions `readVocabularyDischarge` reads (invariants.ts:196-240),
 * re-derived here over the same rows.
 */
function anchorOpens(cwd, anchor) {
  const match = CITATION_TOKEN.exec(String(anchor ?? ""));
  if (!match) return false;
  const [, path, , sha] = match;
  const result = git(cwd, "cat-file", "-e", `${sha}:${path}`);
  return !result.error && result.status === 0;
}

// ---------------------------------------------------------------------------
// The baseline arm. A committed fixture of *this* repository, measured from the
// frozen archive; its anchor is resolved here, not in the candidate's tree.
// ---------------------------------------------------------------------------
emit("GATE D0 — survey depth against the frozen baseline (design/survey-depth/spec.md §7)");
emit(
  `  baseline fixture: ${BASELINE_PATH === join(REPO, BASELINE_REL) ? BASELINE_REL : BASELINE_PATH}`,
);
emit(`  candidate root:   ${CANDIDATE_ROOT === REPO ? "this repository" : CANDIDATE_ROOT}`);
emit("");
emit("the baseline arm — an absent denominator is red, never green (§1.5)");

let baseline = null;
if (!existsSync(BASELINE_PATH)) {
  red(
    `the frozen baseline fixture is absent at ${BASELINE_PATH}. There is no denominator to compare ` +
      "a rebuild against, and an absent baseline is a missing denominator, not a pass (§1.5, VP4(e)). " +
      "Run node dev/record-survey-depth-baseline.mjs on a machine holding the archived store.",
  );
}
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch (error) {
  red(
    `the frozen baseline fixture at ${BASELINE_PATH} could not be read as JSON ` +
      `(${scrub(error?.message ?? String(error))}), so this gate has no baseline`,
  );
}

check("the fixture declares the baseline contract", () =>
  baseline?.contract === BASELINE_CONTRACT
    ? null
    : `it declares ${JSON.stringify(baseline?.contract ?? null)}, not ${BASELINE_CONTRACT}`,
);

check("the fixture binds itself to the archived store's identity (§5.3)", () =>
  /^store-(legacy-)?[0-9a-f]{16}$/.test(String(baseline?.archived_store_id ?? ""))
    ? null
    : `archived_store_id is ${JSON.stringify(baseline?.archived_store_id ?? null)}`,
);

check("the fixture binds itself to the revision it was measured at", () => {
  const sha = String(baseline?.checked_sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(sha))
    return `checked_sha is ${JSON.stringify(baseline?.checked_sha ?? null)}`;
  if (!historyIsComplete(REPO)) return null; // handled as cannot run below
  return resolveRevisions(REPO, [sha], "the fixture's checked_sha");
});

check("the fixture carries the twelve measures' SQL and a nonzero denominator", () => {
  const queries = baseline?.queries ?? {};
  const missing = [
    "D1",
    "D2",
    "D3",
    "D4",
    "D5",
    "D6",
    "D7",
    "D8",
    "D9",
    "D10",
    "D11",
    "D12",
  ].filter((key) => !(key in queries));
  if (missing.length) return `queries carries no ${missing.join(", ")}`;
  if (!(Number(baseline?.blocking?.obligation_bearing) > 0)) {
    return `blocking.obligation_bearing is ${JSON.stringify(baseline?.blocking?.obligation_bearing ?? null)}, so the baseline fraction has no denominator`;
  }
  if (
    !Array.isArray(baseline?.blocking?.open_findings) ||
    !baseline.blocking.open_findings.length
  ) {
    return "blocking.open_findings names no finding, so B5 would be satisfied by an empty accounting";
  }
  return null;
});

if (failures.length) {
  red(
    `the frozen baseline fixture does not bind itself to the archived store it claims to measure — ` +
      `${failures.length} failed assertion(s); first: ${failures[0]}`,
  );
}

for (const [label, root] of [
  ["this repository", REPO],
  ["the candidate's workspace", CANDIDATE_ROOT],
]) {
  if (historyIsComplete(root)) continue;
  cannotRun(
    `revision ancestry is not evaluable in a shallow clone of ${label}, so the revisions the ` +
      "fixture and the candidate bind themselves to cannot be resolved — check out with full " +
      "history (`fetch-depth: 0` in CI, a non-shallow clone locally)",
  );
}

const baselineFraction = Number(baseline.blocking.examined_fraction);
const baselineOpenFindings = baseline.blocking.open_findings.map(String);
const archivedStoreId = String(baseline.archived_store_id);

emit(
  `  baseline: ${archivedStoreId} at ${String(baseline.checked_sha).slice(0, 7)}, examined ` +
    `${pct(baseline.blocking.examined, baseline.blocking.obligation_bearing)}, ` +
    `${baselineOpenFindings.length} open finding(s) to account for`,
);

// D2's exempt set is generated from the contract, never transcribed (§1.2,
// GP28). `deferred-with-reason` is obligation-bearing there, and exempting it
// would shrink the denominator of every coverage fraction below (D9/codex).
let exemptClassifications = null;
try {
  const contract = JSON.parse(readFileSync(join(REPO, VOCABULARY_REL), "utf8"));
  const values = contract?.enums?.file_classification?.values ?? [];
  if (!values.length) throw new Error("file_classification declares no values");
  if (values.some((value) => typeof value?.obligation_bearing !== "boolean")) {
    throw new Error("a file_classification value carries no obligation_bearing flag");
  }
  exemptClassifications = values
    .filter((value) => value.obligation_bearing === false)
    .map((value) => value.value);
} catch (error) {
  red(
    `${VOCABULARY_REL} does not supply D2's exempt set (${scrub(error?.message ?? String(error))}). ` +
      "The obligation-bearing predicate is generated from the contract's obligation_bearing field " +
      "and has no second list to fall back on (§1.2).",
  );
}
const exemptSet = new Set(exemptClassifications);
emit(`  obligation-exempt classifications, from the contract: ${[...exemptSet].sort().join(", ")}`);

// ---------------------------------------------------------------------------
// The candidate arm. A live store, a committed receipt, both, or neither.
// ---------------------------------------------------------------------------
emit("");
emit("the candidate arm");

const hasStore = existsSync(STORE_PATH);
const hasReceipt = existsSync(RECEIPT_PATH);

if (!hasStore && !hasReceipt) {
  emit(`  no store at ${STORE_REL} and no receipt at ${RECEIPT_REL} under ${CANDIDATE_ROOT}`);
  cannotRun(
    "no live store and no committed acceptance receipt. The store is untracked " +
      "(`git ls-files .amanuensis` → 0) and the receipt is written by the packet that runs the " +
      "acceptance rebuild, so between registering this gate and writing that receipt there is " +
      "nothing to measure. An absence is reported as an absence, never as a pass (§7.1, VP4(e)).",
  );
}

/**
 * One candidate's six predicates and its reported axes, computed from rows.
 *
 * `verdicts` is a map from predicate id to a failure sentence or null. Nothing
 * in here is ever read from a recorded verdict field: §7.5's receipt carries
 * row-level witnesses precisely so the receipt arm can recompute what the live
 * arm computes, and a gate that read `"verdict": "green"` would be validating a
 * self-report (§8.8).
 */
function emptyReading(source) {
  return {
    source,
    verdicts: {},
    reconciliation: null,
    examined: null,
    obligationBearing: null,
    carriedIds: [],
    reported: {},
  };
}

function fail(reading, predicate, sentence) {
  if (!reading.verdicts[predicate]) reading.verdicts[predicate] = sentence;
}

// ---------------------------------------------------------------------------
// The live store, read directly and read-only: this gate must not write to the
// store it is judging, and must not need a built server to judge it.
// ---------------------------------------------------------------------------
let storeReading = null;
let receiptReading = null;

if (hasStore) {
  emit(`  reading the live store at ${STORE_PATH}, read-only`);
  const reading = emptyReading("the live store");
  let db = null;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(STORE_PATH, { readOnly: true });
  } catch (error) {
    red(
      `the live store at ${STORE_PATH} could not be opened read-only ` +
        `(${scrub(error?.message ?? String(error))}); a candidate this gate cannot read is not a ` +
        "candidate that passed",
    );
  }
  const all = (sql, ...params) => {
    try {
      return db.prepare(sql).all(...params);
    } catch {
      return null;
    }
  };
  const one = (sql, ...params) => {
    const rows = all(sql, ...params);
    return rows === null ? null : (rows[0] ?? null);
  };
  const countOf = (sql) => {
    const row = one(sql);
    return row === null ? null : Number(Object.values(row)[0]);
  };

  // --- B1: reconciliation standing, and clause 1 in full -------------------
  const gitState = one("SELECT last_checked_sha FROM git_state ORDER BY repo_id LIMIT 1");
  const lastChecked = gitState?.last_checked_sha ?? null;
  const R = resolveRevision(CANDIDATE_ROOT, lastChecked);
  const tracked = R ? (trackedPathsAt(CANDIDATE_ROOT, R) ?? []) : [];
  const trackedSet = new Set(tracked);
  const ledger = all("SELECT file_path, classification FROM file_ledger") ?? [];
  const ledgerPaths = new Set(ledger.map((row) => row.file_path));

  const treeDigest = digestOf(tracked);
  const ledgerDigest = digestOf(
    ledger.map((row) => `${row.file_path}${NUL}${row.classification ?? ""}`),
  );

  if (!lastChecked) {
    fail(
      reading,
      "B1",
      "the store's git_state names no last_checked_sha, so it has no revision to be reconciled at",
    );
  } else if (!R) {
    fail(
      reading,
      "B1",
      `the store was reconciled at ${lastChecked}, which does not resolve to a commit in ${CANDIDATE_ROOT}`,
    );
  } else {
    const rows =
      all(
        `SELECT * FROM scope_reconciliations
          WHERE detected_sha = ? AND tree_digest = ? AND ledger_digest = ?
          ORDER BY id DESC LIMIT 1`,
        R,
        treeDigest,
        ledgerDigest,
      ) ?? null;
    if (rows === null) {
      fail(
        reading,
        "B1",
        "the store carries no scope_reconciliations table, so it has never recorded a reading of the tree against the ledger (§3.2)",
      );
    } else if (!rows.length) {
      const atSha =
        all("SELECT tree_digest FROM scope_reconciliations WHERE detected_sha = ?", R) ?? [];
      const why =
        atSha.length === 0
          ? `no reconciliation has been recorded at ${R.slice(0, 7)}`
          : atSha.some((row) => row.tree_digest === treeDigest)
            ? "the file ledger has changed since the reconciliation recorded there was taken"
            : "the reconciliation recorded there was taken over a different tree";
      fail(reading, "B1", `the store is not reconciled at ${R.slice(0, 7)}: ${why} (§3.3)`);
    } else {
      const standing = rows[0];
      reading.reconciliation = standing;
      const unledgered = tracked.filter((path) => !ledgerPaths.has(path)).length;
      const absent = [...ledgerPaths].filter((path) => !trackedSet.has(path)).length;
      if (Number(standing.tracked_paths) !== tracked.length) {
        fail(
          reading,
          "B1",
          `the standing reconciliation records ${standing.tracked_paths} tracked path(s); the tree at ${R.slice(0, 7)} carries ${tracked.length}`,
        );
      }
      if (Number(standing.unledgered) !== unledgered || Number(standing.absent) !== absent) {
        fail(
          reading,
          "B1",
          `the standing reconciliation records unledgered=${standing.unledgered}, absent=${standing.absent}; the tree at ${R.slice(0, 7)} gives ${unledgered} and ${absent}`,
        );
      }
      if (unledgered !== 0 || absent !== 0) {
        fail(
          reading,
          "B1",
          `${unledgered} tracked path(s) have no ledger row and ${absent} ledger row(s) the tree no longer carries. ` +
            "Every tracked path needs exactly one subsystem assignment or an explicit exclusion with a reason " +
            "before coverage over that tree is claimed (ADR-0001, Fully surveyed, clause 1; §3.3a)",
        );
      }
    }
  }

  // --- B2: the examined fraction over the tracked denominator --------------
  const exemptPaths = new Set(
    ledger.filter((row) => exemptSet.has(row.classification ?? "")).map((row) => row.file_path),
  );
  const examinedPaths = new Set(
    ledger.filter((row) => row.classification === "examined").map((row) => row.file_path),
  );
  const obligationBearing = tracked.filter((path) => !exemptPaths.has(path)).length;
  const examined = tracked.filter((path) => examinedPaths.has(path)).length;
  reading.obligationBearing = obligationBearing;
  reading.examined = examined;
  if (!(obligationBearing > 0)) {
    fail(
      reading,
      "B2",
      `the examined fraction is ${pct(examined, obligationBearing)} — a store with no obligation-bearing ` +
        "tracked path has no denominator and therefore no coverage fraction (§1.4), which is out of band, not a pass",
    );
  } else {
    const fraction = examined / obligationBearing;
    if (fraction + 1e-9 < baselineFraction) {
      fail(
        reading,
        "B2",
        `examined ${pct(examined, obligationBearing)} against the frozen baseline ` +
          `${pct(baseline.blocking.examined, baseline.blocking.obligation_bearing)} ` +
          `${signedPoints(fraction, baselineFraction)}`,
      );
    }
  }

  // --- B3: every disposition at concerns+ carries a resolving attachment ---
  const subsystems = all("SELECT id, status FROM subsystems") ?? [];
  const statusById = new Map(subsystems.map((row) => [row.id, row.status]));
  const dispositions = all("SELECT subsystem_id, concern_code FROM dispositions") ?? [];
  const attachments =
    all("SELECT subsystem_id, concern_code, evidence_id FROM disposition_evidence") ?? [];
  const evidenceSha = new Map(
    (all("SELECT id, ref_sha FROM evidence") ?? []).map((row) => [row.id, row.ref_sha]),
  );
  const attachedResolves = resolveMany(
    CANDIDATE_ROOT,
    attachments.map((row) => evidenceSha.get(row.evidence_id)).filter(Boolean),
  );
  {
    const unbacked = [];
    for (const row of dispositions) {
      if (statusRank(statusById.get(row.subsystem_id)) < CONCERNS_RANK) continue;
      const mine = attachments.filter(
        (a) => a.subsystem_id === row.subsystem_id && a.concern_code === row.concern_code,
      );
      const resolving = mine.filter(
        (a) => attachedResolves.get(evidenceSha.get(a.evidence_id)) === true,
      );
      if (!resolving.length) {
        unbacked.push(
          `${row.subsystem_id}/${row.concern_code}${mine.length ? ` (${mine.length} attachment(s), none at a revision this workspace carries)` : " (nothing attached)"}`,
        );
      }
    }
    if (unbacked.length) {
      fail(
        reading,
        "B3",
        `${unbacked.length} of ${dispositions.length} disposition(s) in a subsystem at 'concerns' or later carry no attached evidence row whose ref_sha resolves: ${unbacked.slice(0, 6).join(", ")}${unbacked.length > 6 ? ", …" : ""}`,
      );
    }
  }

  // --- B4: discharge or decline, per subsystem at structural+ --------------
  {
    const terms = all("SELECT term, subsystem_id, first_seen FROM vocabulary") ?? [];
    const scopes = all("SELECT term, subsystem_id FROM vocabulary_scopes") ?? [];
    const declinations = all(
      "SELECT id, subsystem_id, ref_sha FROM vocabulary_declinations ORDER BY id DESC",
    );
    const declinationResolves = resolveMany(
      CANDIDATE_ROOT,
      (declinations ?? []).map((row) => row.ref_sha),
    );
    const undischarged = [];
    for (const subsystem of subsystems) {
      if (statusRank(subsystem.status) < STRUCTURAL_RANK) continue;
      const scoped = terms.filter(
        (term) =>
          term.subsystem_id === subsystem.id ||
          scopes.some((scope) => scope.term === term.term && scope.subsystem_id === subsystem.id),
      );
      const anchored = scoped.filter((term) => anchorOpens(CANDIDATE_ROOT, term.first_seen));
      if (anchored.length) continue;
      const declined = (declinations ?? []).some(
        (row) => row.subsystem_id === subsystem.id && declinationResolves.get(row.ref_sha) === true,
      );
      if (declined) continue;
      undischarged.push(
        `${subsystem.id} (${subsystem.status}${scoped.length ? `, ${scoped.length} scoped term(s), none anchored` : ", no scoped term"}${declinations === null ? ", and the store carries no vocabulary_declinations table" : ""})`,
      );
    }
    if (undischarged.length) {
      fail(
        reading,
        "B4",
        `${undischarged.length} subsystem(s) at 'structural' or later neither anchor a domain term nor carry a declination that still resolves: ${undischarged.slice(0, 6).join(", ")}${undischarged.length > 6 ? ", …" : ""}`,
      );
    }
  }

  // --- B5 and B6: the carried accounting ----------------------------------
  {
    const carried = all(
      `SELECT c.archived_store_id, c.archived_finding_id, o.outcome
         FROM carried_findings c
    LEFT JOIN carried_finding_outcomes o ON o.carried_id = c.carried_id
        ORDER BY c.carried_id`,
    );
    if (carried === null) {
      const sentence =
        "the store carries no carried_findings table, so it has decided nothing about the conspectus it replaced (§5.2)";
      fail(reading, "B5", sentence);
      fail(reading, "B6", sentence);
    } else {
      reading.carriedIds = carried.map(
        (row) => `${row.archived_store_id}/${row.archived_finding_id}`,
      );
      const decided = new Map();
      for (const row of carried) {
        if (row.archived_store_id !== archivedStoreId) continue;
        decided.set(row.archived_finding_id, row.outcome ?? null);
      }
      const missing = baselineOpenFindings.filter((id) => !decided.has(id));
      const undecided = baselineOpenFindings.filter((id) => decided.has(id) && !decided.get(id));
      if (missing.length || undecided.length) {
        fail(
          reading,
          "B5",
          `${missing.length} of the baseline's ${baselineOpenFindings.length} open finding(s) have no carried record under ${archivedStoreId}${missing.length ? `: ${missing.join(", ")}` : ""}` +
            (undecided.length
              ? `; ${undecided.length} carried with no terminal outcome: ${undecided.join(", ")}`
              : ""),
        );
      }
      const openRows = carried.filter((row) => !row.outcome);
      if (openRows.length) {
        fail(
          reading,
          "B6",
          `${openRows.length} of ${carried.length} carried record(s) are undecided: ${openRows
            .slice(0, 6)
            .map((row) => `${row.archived_store_id}/${row.archived_finding_id}`)
            .join(", ")}${openRows.length > 6 ? ", …" : ""}`,
        );
      }
    }
  }

  // --- the reported axes ---------------------------------------------------
  const dispositionCount = dispositions.length;
  const attachedPairs = new Set(attachments.map((row) => `${row.subsystem_id}/${row.concern_code}`))
    .size;
  reading.reported = {
    ledger_rows: ledger.length,
    evidence: countOf("SELECT COUNT(*) n FROM evidence"),
    dispositions: dispositionCount,
    attached_dispositions: attachedPairs,
    disposition_evidence_rows: attachments.length,
    field_notes: countOf("SELECT COUNT(*) n FROM field_notes"),
    open_questions_all: countOf("SELECT COUNT(*) n FROM open_questions"),
    open_questions_open: countOf("SELECT COUNT(*) n FROM open_questions WHERE resolution='open'"),
    anchored_terms: countOf(
      "SELECT COUNT(*) n FROM vocabulary WHERE first_seen IS NOT NULL AND TRIM(first_seen) <> ''",
    ),
    open_findings: countOf("SELECT COUNT(*) n FROM findings WHERE status='confirmed-bug'"),
    subsystems: subsystems.length,
    seams: countOf("SELECT COUNT(*) n FROM seams"),
    claims: countOf("SELECT COUNT(*) n FROM claims"),
    xrefs: countOf("SELECT COUNT(*) n FROM xrefs"),
    sessions: countOf("SELECT COUNT(*) n FROM sessions"),
    finding_status_histogram: Object.fromEntries(
      (all("SELECT status, COUNT(*) n FROM findings GROUP BY status ORDER BY status") ?? []).map(
        (row) => [row.status, Number(row.n)],
      ),
    ),
    classification_histogram: Object.fromEntries(
      (
        all(
          "SELECT COALESCE(classification,'(null)') k, COUNT(*) n FROM file_ledger GROUP BY 1 ORDER BY 1",
        ) ?? []
      ).map((row) => [row.k, Number(row.n)]),
    ),
  };
  reading.checkedSha = R;
  try {
    db.close();
  } catch {
    /* the reads already happened; a close failure changes no answer */
  }
  storeReading = reading;
}

// ---------------------------------------------------------------------------
// The committed receipt. Every blocking predicate is recomputed from §7.5's
// row-level witnesses; the receipt's own `verdict` fields are never read.
// ---------------------------------------------------------------------------
if (hasReceipt) {
  emit(`  reading the committed acceptance receipt at ${RECEIPT_PATH}`);
  const reading = emptyReading("the committed acceptance receipt");
  let receipt = null;
  try {
    receipt = JSON.parse(readFileSync(RECEIPT_PATH, "utf8"));
  } catch (error) {
    red(
      `the committed acceptance receipt at ${RECEIPT_PATH} could not be read as JSON ` +
        `(${scrub(error?.message ?? String(error))})`,
    );
  }
  if (receipt?.contract !== RECEIPT_CONTRACT) {
    red(
      `the committed acceptance receipt declares contract ${JSON.stringify(receipt?.contract ?? null)}, ` +
        `not ${RECEIPT_CONTRACT}, so what its fields mean is undeclared`,
    );
  }
  // The receipt binds itself to a revision, and that binding is resolved rather
  // than pattern-matched. A gate that only checked for forty hex digits accepts
  // forty zeroes, which is what slice-S6's independent review demonstrated —
  // `dev/receipt-provenance.mjs`'s own header records it (F1/F2). A receipt
  // whose `repository_sha` names no commit on this branch reports on a tree
  // nobody here has.
  {
    const bound = resolveRevisions(
      CANDIDATE_ROOT,
      [receipt?.repository_sha],
      "the acceptance receipt's repository_sha",
    );
    if (bound) {
      red(
        `${bound}. The receipt is the only witness the candidate arm has where no live store exists; ` +
          "one that binds itself to nothing reports on a tree nobody here carries.",
      );
    }
  }

  const blocking = receipt?.blocking ?? {};

  // --- B1 ------------------------------------------------------------------
  {
    const witness = blocking?.B1?.witness ?? null;
    if (!witness) {
      fail(
        reading,
        "B1",
        "the receipt carries no B1 witness, so the reconciliation cannot be recomputed from it (§7.5)",
      );
    } else {
      const detected = resolveRevision(CANDIDATE_ROOT, witness.detected_sha);
      if (!detected) {
        fail(
          reading,
          "B1",
          `the receipt's reconciliation names ${witness.detected_sha}, which does not resolve in ${CANDIDATE_ROOT}, so its tree_digest cannot be re-derived`,
        );
      } else {
        const tracked = trackedPathsAt(CANDIDATE_ROOT, detected) ?? [];
        reading.checkedSha = detected;
        if (digestOf(tracked) !== witness.tree_digest) {
          fail(
            reading,
            "B1",
            `the receipt's tree_digest does not match the tree at ${detected.slice(0, 7)}, so the counts beside it were taken over a different path set`,
          );
        }
        if (Number(witness.tracked_paths) !== tracked.length) {
          fail(
            reading,
            "B1",
            `the receipt records ${witness.tracked_paths} tracked path(s); the tree at ${detected.slice(0, 7)} carries ${tracked.length}`,
          );
        }
      }
      if (Number(witness.unledgered) !== 0 || Number(witness.absent) !== 0) {
        fail(
          reading,
          "B1",
          `the receipt's standing reconciliation records unledgered=${witness.unledgered}, absent=${witness.absent}. ` +
            "Every tracked path needs exactly one subsystem assignment or an explicit exclusion with a reason " +
            "(ADR-0001, Fully surveyed, clause 1; §3.3a)",
        );
      }
      // §7.5 carries `ledger_digest` "so the digests can be re-derived at any
      // later revision that still has the tree". `tree_digest` re-derives from
      // the tree; `ledger_digest` re-derives from nothing unless the ledger
      // travels with it, and a witness field nothing recomputes is a recorded
      // verdict under another name (F3/codex, §7.5's own rule for B3 and B4).
      const ledger = Array.isArray(witness.ledger) ? witness.ledger : null;
      if (ledger === null) {
        fail(
          reading,
          "B1",
          "the receipt's B1 witness carries no ledger rows, so its ledger_digest, its unledgered count " +
            "and its absent count cannot be re-derived from it and stand only on the receipt's own word (§7.5)",
        );
      } else {
        const rederived = digestOf(
          ledger.map((row) => `${row?.file_path ?? ""}${NUL}${row?.classification ?? ""}`),
        );
        if (rederived !== String(witness.ledger_digest ?? "")) {
          fail(
            reading,
            "B1",
            `the receipt's ledger_digest is ${String(witness.ledger_digest ?? "(absent)").slice(0, 12)}…; ` +
              `the ${ledger.length} ledger row(s) beside it re-derive ${rederived.slice(0, 12)}…, ` +
              "so the counts were taken against a ledger the receipt does not carry (§3.3 condition 5)",
          );
        }
        if (Number(witness.ledger_rows) !== ledger.length) {
          fail(
            reading,
            "B1",
            `the receipt records ledger_rows=${witness.ledger_rows} and carries ${ledger.length} ledger row witness(es)`,
          );
        }
        // The reconciliation's own counts, recomputed. `unledgered` and
        // `absent` are the two halves of ADR-0001 clause 1, and a receipt that
        // merely *records* them zero has asserted the thing under test.
        if (reading.checkedSha) {
          const tracked = new Set(trackedPathsAt(CANDIDATE_ROOT, reading.checkedSha) ?? []);
          const ledgered = new Set(ledger.map((row) => String(row?.file_path ?? "")));
          const unledgered = [...tracked].filter((path) => !ledgered.has(path));
          const absent = [...ledgered].filter((path) => !tracked.has(path));
          if (unledgered.length || absent.length) {
            fail(
              reading,
              "B1",
              `the receipt records unledgered=${witness.unledgered}, absent=${witness.absent}; its own ledger witness ` +
                `against the tree at ${reading.checkedSha.slice(0, 7)} leaves ${unledgered.length} tracked path(s) ` +
                `unledgered${unledgered.length ? ` (${unledgered.slice(0, 4).join(", ")}${unledgered.length > 4 ? ", …" : ""})` : ""} ` +
                `and ${absent.length} ledger path(s) absent from the tree` +
                `${absent.length ? ` (${absent.slice(0, 4).join(", ")}${absent.length > 4 ? ", …" : ""})` : ""}`,
            );
          }
        }
      }
      reading.reconciliation = witness;
    }
  }

  // --- B2 ------------------------------------------------------------------
  {
    const examined = Number(blocking?.B2?.examined);
    const obligationBearing = Number(blocking?.B2?.obligation_bearing);
    reading.examined = Number.isFinite(examined) ? examined : null;
    reading.obligationBearing = Number.isFinite(obligationBearing) ? obligationBearing : null;
    if (!Number.isFinite(examined) || !Number.isFinite(obligationBearing)) {
      fail(
        reading,
        "B2",
        "the receipt records no examined count and obligation-bearing denominator (§7.5)",
      );
    } else if (!(obligationBearing > 0)) {
      fail(
        reading,
        "B2",
        `the receipt reports ${pct(examined, obligationBearing)} — a zero denominator is out of band, not a pass (§1.4, VP4(e))`,
      );
    } else if (examined > obligationBearing) {
      fail(
        reading,
        "B2",
        `the receipt reports ${examined} examined of ${obligationBearing} obligation-bearing path(s), which is not a fraction`,
      );
    } else if (examined / obligationBearing + 1e-9 < baselineFraction) {
      fail(
        reading,
        "B2",
        `examined ${pct(examined, obligationBearing)} against the frozen baseline ` +
          `${pct(baseline.blocking.examined, baseline.blocking.obligation_bearing)} ` +
          `${signedPoints(examined / obligationBearing, baselineFraction)}`,
      );
    }
  }

  // --- B3: recomputed from the per-disposition witnesses -------------------
  {
    const rows = Array.isArray(blocking?.B3?.dispositions) ? blocking.B3.dispositions : null;
    if (rows === null) {
      fail(
        reading,
        "B3",
        "the receipt carries no per-disposition witness, so whether *this* disposition carries a resolvable row cannot be answered from it (§7.5)",
      );
    } else {
      // §7.5 requires "one row per disposition". A gate that only walks the
      // rows it is handed passes an empty table vacuously and a table padded
      // by repeating one row by arithmetic, so the witness table is first
      // reconciled against the census the receipt records independently of it
      // (F2/codex).
      const census = Number(receipt?.reported?.dispositions);
      const keys = rows.map((row) => `${row?.subsystem_id}/${row?.concern_code}`);
      const distinct = new Set(keys);
      if (distinct.size !== keys.length) {
        const counts = new Map();
        for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
        const repeated = [...counts].filter(([, n]) => n > 1).map(([key]) => key);
        fail(
          reading,
          "B3",
          `the receipt witnesses ${keys.length} disposition(s) over ${distinct.size} distinct ` +
            `(subsystem_id, concern_code) pair(s): ${repeated.slice(0, 6).join(", ")}${repeated.length > 6 ? ", …" : ""}`,
        );
      }
      if (!Number.isFinite(census)) {
        fail(
          reading,
          "B3",
          "the receipt records no disposition count beside its witness table, so whether the table is " +
            "complete cannot be answered from it (§7.5)",
        );
      } else if (distinct.size !== census) {
        fail(
          reading,
          "B3",
          `the receipt records ${census} disposition(s) and witnesses ${distinct.size} of them, so ` +
            `${Math.abs(census - distinct.size)} disposition(s) are outside the table this predicate walks (§7.5)`,
        );
      }
      const resolves = resolveMany(
        CANDIDATE_ROOT,
        rows
          .flatMap((row) => (Array.isArray(row?.attachments) ? row.attachments : []))
          .map((a) => a?.ref_sha),
      );
      const unbacked = [];
      for (const row of rows) {
        if (statusRank(row?.subsystem_status) < CONCERNS_RANK) continue;
        const mine = Array.isArray(row?.attachments) ? row.attachments : [];
        // `resolved` as recorded is not read: it says what was true when the
        // receipt was written, and a revision can be rewritten away afterwards.
        const resolving = mine.filter((a) => resolves.get(a?.ref_sha) === true);
        if (!resolving.length) {
          unbacked.push(
            `${row?.subsystem_id}/${row?.concern_code}${mine.length ? ` (${mine.length} attachment(s), none at a revision this workspace carries)` : " (nothing attached)"}`,
          );
        }
      }
      if (unbacked.length) {
        fail(
          reading,
          "B3",
          `${unbacked.length} of ${rows.length} disposition witness(es) in a subsystem at 'concerns' or later carry no attached evidence row whose ref_sha resolves: ${unbacked.slice(0, 6).join(", ")}${unbacked.length > 6 ? ", …" : ""}`,
        );
      }
    }
  }

  // --- B4: recomputed from the per-subsystem witnesses ---------------------
  {
    const rows = Array.isArray(blocking?.B4?.subsystems) ? blocking.B4.subsystems : null;
    if (rows === null) {
      fail(
        reading,
        "B4",
        "the receipt carries no per-subsystem witness, so which record discharged each subsystem cannot be answered from it (§7.5)",
      );
    } else {
      const declinationShas = resolveMany(
        CANDIDATE_ROOT,
        rows.map((row) => row?.declination?.ref_sha).filter(Boolean),
      );
      const undischarged = [];
      for (const row of rows) {
        if (statusRank(row?.status) < STRUCTURAL_RANK) continue;
        const terms = Array.isArray(row?.terms) ? row.terms : [];
        const anchored = terms.filter((term) => anchorOpens(CANDIDATE_ROOT, term?.first_seen));
        if (anchored.length) continue;
        if (row?.declination?.ref_sha && declinationShas.get(row.declination.ref_sha) === true)
          continue;
        undischarged.push(
          `${row?.id} (${row?.status}${terms.length ? `, ${terms.length} term(s), none anchored` : ", no term"}${row?.declination ? ", declination at a revision this workspace cannot reach" : ", no declination"})`,
        );
      }
      if (undischarged.length) {
        fail(
          reading,
          "B4",
          `${undischarged.length} subsystem witness(es) at 'structural' or later neither anchor a domain term nor carry a declination that still resolves: ${undischarged.slice(0, 6).join(", ")}${undischarged.length > 6 ? ", …" : ""}`,
        );
      }
    }
  }

  // --- B5 and B6 -----------------------------------------------------------
  {
    const rows = Array.isArray(blocking?.B5?.carried) ? blocking.B5.carried : null;
    if (rows === null) {
      const sentence =
        "the receipt carries no carried table, so what became of the conspectus it replaced cannot be read from it (§7.5)";
      fail(reading, "B5", sentence);
      fail(reading, "B6", sentence);
    } else {
      reading.carriedIds = rows.map(
        (row) => `${row?.archived_store_id}/${row?.archived_finding_id}`,
      );
      const decided = new Map();
      for (const row of rows) {
        if (row?.archived_store_id !== archivedStoreId) continue;
        decided.set(String(row?.archived_finding_id), row?.outcome ?? null);
      }
      const missing = baselineOpenFindings.filter((id) => !decided.has(id));
      const undecided = baselineOpenFindings.filter((id) => decided.has(id) && !decided.get(id));
      if (missing.length || undecided.length) {
        fail(
          reading,
          "B5",
          `${missing.length} of the baseline's ${baselineOpenFindings.length} open finding(s) have no carried record under ${archivedStoreId}${missing.length ? `: ${missing.join(", ")}` : ""}` +
            (undecided.length
              ? `; ${undecided.length} carried with no terminal outcome: ${undecided.join(", ")}`
              : ""),
        );
      }
      const openRows = rows.filter((row) => !row?.outcome);
      if (openRows.length) {
        fail(
          reading,
          "B6",
          `${openRows.length} of ${rows.length} carried witness(es) are undecided: ${openRows
            .slice(0, 6)
            .map((row) => `${row?.archived_store_id}/${row?.archived_finding_id}`)
            .join(", ")}${openRows.length > 6 ? ", …" : ""}`,
        );
      }
    }
  }

  reading.reported = receipt?.reported ?? {};
  receiptReading = reading;
}

// ---------------------------------------------------------------------------
// The verdicts, and the agreement between two arms where both ran.
// ---------------------------------------------------------------------------
const PREDICATES = [
  ["B1", "reconciliation standing, with zero unledgered and zero absent"],
  ["B2", "the examined fraction against the frozen baseline"],
  ["B3", "every disposition at 'concerns' or later evidence-backed"],
  ["B4", "every subsystem at 'structural' or later discharged or declined"],
  ["B5", "every baseline open finding carried with a terminal outcome"],
  ["B6", "no carried record undecided"],
];

const readings = [storeReading, receiptReading].filter(Boolean);

emit("");
emit("blocking predicates (§7.3), recomputed over rows — never read from a recorded verdict");
for (const [id, title] of PREDICATES) {
  for (const reading of readings) {
    check(`${id} ${title} — ${reading.source}`, () => reading.verdicts[id] ?? null);
  }
}

if (storeReading && receiptReading) {
  emit("");
  emit(
    "both arms ran, so they must agree — a receipt nobody can contradict is a claim about a claim",
  );
  check("the two arms agree on every blocking predicate", () => {
    const disagreements = PREDICATES.filter(
      ([id]) => Boolean(storeReading.verdicts[id]) !== Boolean(receiptReading.verdicts[id]),
    ).map(([id]) => id);
    return disagreements.length
      ? `${disagreements.join(", ")} hold(s) in one arm and not the other`
      : null;
  });
  check("the two arms agree on the coverage numerator and its denominator", () => {
    if (storeReading.examined !== receiptReading.examined) {
      return `the store reports ${storeReading.examined} examined path(s) and the receipt reports ${receiptReading.examined}`;
    }
    if (storeReading.obligationBearing !== receiptReading.obligationBearing) {
      return `the store reports ${storeReading.obligationBearing} obligation-bearing path(s) and the receipt reports ${receiptReading.obligationBearing}`;
    }
    return null;
  });
  check("the two arms agree on the reconciliation the coverage was taken over", () => {
    const a = storeReading.reconciliation ?? {};
    const b = receiptReading.reconciliation ?? {};
    for (const field of [
      "detected_sha",
      "tree_digest",
      "ledger_digest",
      "tracked_paths",
      "unledgered",
      "absent",
    ]) {
      if (String(a[field] ?? "") !== String(b[field] ?? "")) {
        return `${field} is ${JSON.stringify(a[field] ?? null)} in the store and ${JSON.stringify(b[field] ?? null)} in the receipt`;
      }
    }
    return null;
  });
  check("the two arms carry the same carried records", () => {
    const a = [...storeReading.carriedIds].sort().join(",");
    const b = [...receiptReading.carriedIds].sort().join(",");
    return a === b
      ? null
      : `the store holds ${storeReading.carriedIds.length} carried record(s) and the receipt ${receiptReading.carriedIds.length}, and the two sets differ`;
  });
}

// ---------------------------------------------------------------------------
// The reported axes: printed with the baseline and a signed delta, never red.
// ---------------------------------------------------------------------------
const AXES = [
  ["D1 ", "ledger rows", "ledger_rows"],
  ["D4 ", "evidence rows", "evidence"],
  ["D5 ", "dispositions", "dispositions"],
  ["D8 ", "field notes", "field_notes"],
  ["D9 ", "open questions (all)", "open_questions_all"],
  ["D9 ", "open questions (open)", "open_questions_open"],
  ["D10", "vocabulary terms with an anchor", "anchored_terms"],
  ["D11", "open findings (confirmed-bug)", "open_findings"],
  ["—  ", "disposition_evidence rows", "disposition_evidence_rows"],
  ["—  ", "subsystems", "subsystems"],
  ["—  ", "seams", "seams"],
  ["—  ", "claims", "claims"],
  ["—  ", "xrefs", "xrefs"],
  ["—  ", "sessions", "sessions"],
];

emit("");
emit(
  "reported axes (§1.6) — printed with the baseline and a signed delta; none of these turns this gate red",
);
for (const reading of readings) {
  emit(`  from ${reading.source}:`);
  const reported = reading.reported ?? {};
  for (const [id, label, key] of AXES) {
    const candidate = reported[key];
    const base = baseline.reported?.[key];
    const delta =
      typeof candidate === "number" && typeof base === "number" ? candidate - base : null;
    emit(
      `    ${id} ${label.padEnd(32)} candidate ${String(candidate ?? "—").padStart(6)}   baseline ${String(base ?? "—").padStart(6)}   ${signed(delta)}`,
    );
  }
  // D6 and D7% are per-disposition ratios, not tracked-file coverage fractions
  // (C2), and are reported for the same reason the counts are.
  const d5 = reported.dispositions;
  const d4 = reported.evidence;
  const d7 = reported.attached_dispositions;
  const baseD5 = baseline.reported?.dispositions;
  const baseD4 = baseline.reported?.evidence;
  const baseD7 = baseline.reported?.attached_dispositions;
  const ratio = (n, d) => (d > 0 ? n / d : null);
  emit(
    `    D6  ${"evidence rows per disposition".padEnd(32)} candidate ${
      d5 > 0
        ? `${(d4 / d5).toFixed(2)} (${d4}/${d5})`
        : `not measured (denominator 0, ${d4 ?? 0} counted)`
    }   baseline ${
      baseD5 > 0 ? `${(baseD4 / baseD5).toFixed(2)} (${baseD4}/${baseD5})` : "not measured"
    }   ${signed(
      ratio(d4, d5) !== null && ratio(baseD4, baseD5) !== null
        ? ratio(d4, d5) - ratio(baseD4, baseD5)
        : null,
      2,
    )}`,
  );
  emit(
    `    D7% ${"dispositions with an attachment".padEnd(32)} candidate ${pct(d7 ?? 0, d5 ?? 0)}   baseline ${pct(baseD7 ?? 0, baseD5 ?? 0)}   ${signedPoints(ratio(d7, d5), ratio(baseD7, baseD5))}`,
  );
  emit(
    `    D3% ${"examined fraction (blocking)".padEnd(32)} candidate ${pct(reading.examined ?? 0, reading.obligationBearing ?? 0)}   baseline ${pct(baseline.blocking.examined, baseline.blocking.obligation_bearing)}   ${signedPoints(
      reading.obligationBearing > 0 ? reading.examined / reading.obligationBearing : null,
      baselineFraction,
    )}`,
  );
  const histogram = (which) => {
    const candidate = reported[which] ?? {};
    const base = baseline.reported?.[which] ?? {};
    const keys = [...new Set([...Object.keys(candidate), ...Object.keys(base)])].sort();
    return keys.length
      ? keys
          .map(
            (key) =>
              `${key}=${candidate[key] ?? 0} ${signed((candidate[key] ?? 0) - (base[key] ?? 0))}`,
          )
          .join(", ")
      : "(none recorded)";
  };
  emit(
    `    —   ${"ledger classification histogram".padEnd(32)} ${histogram("classification_histogram")}`,
  );
  emit(`    —   ${"finding status histogram".padEnd(32)} ${histogram("finding_status_histogram")}`);
}

// ---------------------------------------------------------------------------
emit("");
if (failures.length) {
  // The reason names the predicates that fired, in §7.3's order, before it
  // says how many assertions failed: a reader — and `gate.red_expect`, which
  // §8.0 says quotes this line — needs to know *which* obligation the rebuild
  // missed, and a bare count answers that for nobody.
  const fired = PREDICATES.map(([id]) => id).filter((id) =>
    readings.some((reading) => reading.verdicts[id]),
  );
  const where = fired.length
    ? `on ${fired.join(", ")}${failures.length > fired.length && storeReading && receiptReading ? " and on the agreement of its two arms" : ""}`
    : "on the agreement of its two arms";
  red(
    `the candidate store does not meet the frozen baseline ${where} — ${failures.length} failed ` +
      "assertion(s) over §7.3's blocking predicates" +
      `${storeReading && receiptReading ? " and the agreement of its two arms" : ""}; ` +
      `first: ${failures[0]}`,
  );
}
emit(`GATE ${PACKET} GREEN — GATE D0 GREEN`);
