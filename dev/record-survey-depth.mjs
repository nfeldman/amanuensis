#!/usr/bin/env node
// Write `design/survey-depth/acceptance-receipt.json` from the live store
// (design/survey-depth/spec.md §7.5).
//
// The receipt is the candidate arm of `GATE D0` wherever the live store is not
// — CI, another machine, a later revision — and §7.3 requires every blocking
// predicate to be **recomputed** there rather than read. So this recorder's job
// is not to publish a verdict; it is to publish the *rows* a recomputation
// needs, and to publish them in a form that binds itself to revisions this
// repository still carries:
//
//   B1  the standing reconciliation, plus the ledger it was taken over. The
//       digests re-derive from the tree and from those rows; a witness whose
//       `ledger_digest` nothing can recompute is a recorded verdict wearing a
//       hash (F3/codex).
//   B2  the examined count and the obligation-bearing denominator, both over
//       the tracked path set at the reconciled revision (§1.4) — never over the
//       ledger's own row count, which moves with the numerator.
//   B3  one row per disposition, with each attachment's `ref_sha`. `resolved`
//       records what was true here and is re-resolved by the gate, because a
//       revision can be rewritten away after a receipt is written.
//   B4  one row per subsystem, with its scoped terms' anchors and its effective
//       declination. A per-subsystem boolean cannot say which record discharged
//       it.
//   B5  every carried record with its outcome, its `repaired_sha` and the
//       revisions of the evidence attached to it.
//
// Beside them, `reported_deltas`: every reported axis paired with the frozen
// fixture's value and the signed difference (§7.5, claim C31). The counts alone
// answer "how many"; a receipt that is a baseline for the *next* rebuild has to
// answer "against what, and by how much" without the fixture in hand.
//
// `verdict` fields are written beside the witnesses because §7.5 asks for "every
// blocking axis with its value, its baseline and its verdict" — for a *reader*.
// The gate ignores every one of them by design (§7.3, §8.8), and this recorder
// derives them from the same rows rather than from a separate judgement, so a
// verdict here can never disagree with the witness beside it.
//
// Usage:
//   node dev/record-survey-depth.mjs            write the receipt
//   node dev/record-survey-depth.mjs --check    recompute and compare; exit 1 on drift
//
// Exit codes: 0 written (or `--check` clean), 1 drift under `--check`, 2 the
// live store is not readable here. A recorder that cannot read its source says
// so rather than writing an empty receipt: an absent store is a missing
// denominator, not a pass (VP4(e)).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STORE_PATH = join(REPO, ".amanuensis/memory.db");
const RECEIPT_PATH = join(REPO, "design/survey-depth/acceptance-receipt.json");
const BASELINE_PATH = join(REPO, "dev/survey-depth-baseline.json");
const VOCABULARY_PATH = join(REPO, "mcp-server/contracts/conspectus-vocabulary.json");
const CONTRACT = "amanuensis-survey-depth/acceptance-receipt/v1";

const NUL = "\u0000";
const check = process.argv.includes("--check");

process.removeAllListeners("warning");
process.on("warning", () => {});

function die(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function git(...args) {
  return spawnSync("git", args, {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function digestOf(parts) {
  return createHash("sha256")
    .update([...parts].sort().join(NUL))
    .digest("hex");
}

function trackedPathsAt(revision) {
  const result = git("ls-tree", "-r", "--name-only", "-z", revision);
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? "")
    .split(NUL)
    .filter((path) => path.length > 0);
}

function revisionExists(revision) {
  if (typeof revision !== "string" || !revision || /\s/.test(revision)) return false;
  const result = git("cat-file", "-e", `${revision}^{commit}`);
  return !result.error && result.status === 0;
}

if (!existsSync(STORE_PATH)) {
  die(
    2,
    `cannot run: no live store at ${STORE_PATH}. The acceptance receipt is written from the
store the rebuild produced; there is nothing here to record.`,
  );
}

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (error) {
  die(2, `cannot run: node:sqlite is unavailable (${error?.message ?? error})`);
}

let db;
try {
  db = new DatabaseSync(STORE_PATH, { readOnly: true });
} catch (error) {
  die(2, `cannot run: the live store could not be opened read-only (${error?.message ?? error})`);
}

const all = (sql, ...params) => db.prepare(sql).all(...params);
const count = (sql) => Number(Object.values(all(sql)[0])[0]);

// --- the exempt set, generated from the contract, never transcribed (§1.2) ---
const exemptSet = new Set(
  (JSON.parse(readFileSync(VOCABULARY_PATH, "utf8"))?.enums?.file_classification?.values ?? [])
    .filter((value) => value.obligation_bearing === false)
    .map((value) => value.value),
);
if (!exemptSet.size) {
  die(
    2,
    `cannot run: ${VOCABULARY_PATH} supplies no obligation_bearing flags, so D2 has no exempt set`,
  );
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

const repositorySha = String(git("rev-parse", "HEAD").stdout ?? "").trim();
if (!/^[0-9a-f]{40}$/.test(repositorySha)) {
  die(2, "cannot run: this checkout has no HEAD to bind the receipt to");
}

const gitState = all("SELECT repo_id, last_checked_sha, onboarding_sha FROM git_state LIMIT 1")[0];
const checkedSha = gitState?.last_checked_sha ?? null;
const reconciliation =
  all(
    "SELECT * FROM scope_reconciliations WHERE detected_sha = ? ORDER BY id DESC LIMIT 1",
    checkedSha,
  )[0] ??
  all("SELECT * FROM scope_reconciliations ORDER BY id DESC LIMIT 1")[0] ??
  null;

const ledger = all("SELECT file_path, classification FROM file_ledger ORDER BY file_path");
const tracked = reconciliation ? (trackedPathsAt(reconciliation.detected_sha) ?? []) : [];
const trackedSet = new Set(tracked);
const ledgerPaths = new Set(ledger.map((row) => row.file_path));

const exemptPaths = new Set(
  ledger.filter((row) => exemptSet.has(row.classification ?? "")).map((row) => row.file_path),
);
const examinedPaths = new Set(
  ledger.filter((row) => row.classification === "examined").map((row) => row.file_path),
);
const obligationBearing = tracked.filter((path) => !exemptPaths.has(path)).length;
const examined = tracked.filter((path) => examinedPaths.has(path)).length;
const unledgered = tracked.filter((path) => !ledgerPaths.has(path)).length;
const absent = [...ledgerPaths].filter((path) => !trackedSet.has(path)).length;

// The witness is written only if it re-derives here. §7.5 keeps the digests so
// a later reader can recompute them; a recorder that copies a digest it never
// checked hands that reader a number that agrees with itself.
if (reconciliation) {
  const treeDigest = digestOf(tracked);
  const ledgerDigest = digestOf(
    ledger.map((row) => `${row.file_path}${NUL}${row.classification ?? ""}`),
  );
  const drift = [];
  if (treeDigest !== reconciliation.tree_digest) {
    drift.push(
      `tree_digest: the reconciliation records ${String(reconciliation.tree_digest).slice(0, 12)}…, ` +
        `the tree at ${String(reconciliation.detected_sha).slice(0, 7)} re-derives ${treeDigest.slice(0, 12)}…`,
    );
  }
  if (ledgerDigest !== reconciliation.ledger_digest) {
    drift.push(
      `ledger_digest: the reconciliation records ${String(reconciliation.ledger_digest).slice(0, 12)}…, ` +
        `the ${ledger.length} ledger row(s) re-derive ${ledgerDigest.slice(0, 12)}…, so the ledger has ` +
        "moved since it was taken and the standing reconciliation is stale (§3.3 condition 5)",
    );
  }
  if (drift.length) {
    die(2, `cannot run: the standing reconciliation does not re-derive — ${drift.join("; ")}`);
  }
}

const subsystems = all("SELECT id, name, status, priority FROM subsystems ORDER BY id");
const statusById = new Map(subsystems.map((row) => [row.id, row.status]));
const dispositions = all(
  "SELECT subsystem_id, concern_code, classification, evidence_quality FROM dispositions ORDER BY subsystem_id, concern_code",
);
const attachments = all(
  "SELECT subsystem_id, concern_code, evidence_id FROM disposition_evidence ORDER BY subsystem_id, concern_code, evidence_id",
);
const evidenceSha = new Map(
  all("SELECT id, ref_sha FROM evidence").map((row) => [row.id, row.ref_sha]),
);

const terms = all("SELECT term, subsystem_id, first_seen FROM vocabulary ORDER BY term");
const termScopes = all("SELECT term, subsystem_id FROM vocabulary_scopes");
const declinations = all(
  "SELECT id, subsystem_id, ref_sha, session_id, reason FROM vocabulary_declinations ORDER BY id DESC",
);

const carried = all(
  `SELECT c.carried_id, c.archived_store_id, c.archived_finding_id, c.subsystem_id,
          c.archived_resolution, c.severity,
          o.outcome, o.repaired_sha, o.rationale
     FROM carried_findings c
LEFT JOIN carried_finding_outcomes o ON o.carried_id = c.carried_id
    ORDER BY c.carried_id`,
);
let carriedEvidence = [];
try {
  carriedEvidence = all(
    `SELECT ce.carried_id, e.ref_sha
       FROM carried_finding_evidence ce
       JOIN evidence e ON e.id = ce.evidence_id`,
  );
} catch {
  carriedEvidence = [];
}

const B3rows = dispositions.map((row) => ({
  subsystem_id: row.subsystem_id,
  concern_code: row.concern_code,
  subsystem_status: statusById.get(row.subsystem_id) ?? "unmapped",
  disposition: row.classification,
  evidence_quality: row.evidence_quality,
  attachments: attachments
    .filter((a) => a.subsystem_id === row.subsystem_id && a.concern_code === row.concern_code)
    .map((a) => {
      const refSha = evidenceSha.get(a.evidence_id) ?? null;
      return { evidence_id: a.evidence_id, ref_sha: refSha, resolved: revisionExists(refSha) };
    }),
}));

const B4rows = subsystems.map((row) => {
  const scoped = terms.filter(
    (term) =>
      term.subsystem_id === row.id ||
      termScopes.some((scope) => scope.term === term.term && scope.subsystem_id === row.id),
  );
  const declination = declinations.find((d) => d.subsystem_id === row.id) ?? null;
  return {
    id: row.id,
    status: row.status,
    dispositions: dispositions.filter((d) => d.subsystem_id === row.id).length,
    attached: new Set(
      attachments.filter((a) => a.subsystem_id === row.id).map((a) => a.concern_code),
    ).size,
    terms: scoped.map((term) => ({ term: term.term, first_seen: term.first_seen })),
    declination: declination
      ? {
          id: declination.id,
          ref_sha: declination.ref_sha,
          session_id: declination.session_id,
          reason: declination.reason,
        }
      : null,
  };
});

const B5rows = carried.map((row) => ({
  carried_id: row.carried_id,
  archived_store_id: row.archived_store_id,
  archived_finding_id: row.archived_finding_id,
  subsystem_id: row.subsystem_id,
  archived_resolution: row.archived_resolution,
  outcome: row.outcome ?? null,
  repaired_sha: row.repaired_sha ?? null,
  evidence_revisions: carriedEvidence
    .filter((e) => e.carried_id === row.carried_id)
    .map((e) => e.ref_sha),
}));

// The blocking verdicts, derived from the witnesses above — never from a
// separate judgement, so a verdict can never disagree with its own witness.
const baselineFraction = Number(baseline?.blocking?.examined_fraction);
const openFindingIds = baseline?.blocking?.open_findings ?? [];
const archivedStoreId = baseline?.archived_store_id ?? null;
const decided = new Map(
  carried
    .filter((row) => row.archived_store_id === archivedStoreId)
    .map((row) => [row.archived_finding_id, row.outcome ?? null]),
);
const verdict = (ok) => (ok ? "green" : "red");

const receipt = {
  contract: CONTRACT,
  repository_sha: repositorySha,
  recorded_at: new Date().toISOString().slice(0, 10),
  store: {
    store_id:
      all("SELECT store_generation FROM store_identity ORDER BY id LIMIT 1")[0]?.store_generation ??
      null,
    repo_id: gitState?.repo_id ?? null,
    checked_sha: checkedSha,
    onboarding_sha: gitState?.onboarding_sha ?? null,
  },
  baseline: {
    archived_store_id: archivedStoreId,
    checked_sha: baseline?.checked_sha ?? null,
    examined_fraction: baselineFraction,
  },
  blocking: {
    B1: {
      verdict: verdict(Boolean(reconciliation) && unledgered === 0 && absent === 0),
      baseline: { unledgered: baseline?.blocking?.unledgered ?? null, absent: 0 },
      witness: reconciliation
        ? {
            detected_sha: reconciliation.detected_sha,
            tree_digest: reconciliation.tree_digest,
            ledger_digest: reconciliation.ledger_digest,
            ledger: ledger.map((row) => ({
              file_path: row.file_path,
              classification: row.classification ?? null,
            })),
            tracked_paths: reconciliation.tracked_paths,
            ledger_rows: reconciliation.ledger_rows,
            unledgered: reconciliation.unledgered,
            absent: reconciliation.absent,
            exempt: reconciliation.exempt,
            session_id: reconciliation.session_id,
          }
        : null,
    },
    B2: {
      verdict: verdict(
        obligationBearing > 0 && examined / obligationBearing + 1e-9 >= baselineFraction,
      ),
      examined,
      obligation_bearing: obligationBearing,
      fraction: obligationBearing > 0 ? examined / obligationBearing : null,
      baseline: {
        examined: baseline?.blocking?.examined ?? null,
        obligation_bearing: baseline?.blocking?.obligation_bearing ?? null,
        fraction: baselineFraction,
      },
    },
    B3: {
      verdict: verdict(
        B3rows.every(
          (row) =>
            !["concerns", "adversarial", "mapped"].includes(row.subsystem_status) ||
            row.attachments.some((a) => a.resolved),
        ),
      ),
      dispositions: B3rows,
    },
    B4: {
      verdict: verdict(
        B4rows.every(
          (row) =>
            !["structural", "concerns", "adversarial", "mapped"].includes(row.status) ||
            row.terms.some((term) => term.first_seen) ||
            Boolean(row.declination),
        ),
      ),
      subsystems: B4rows,
    },
    B5: {
      verdict: verdict(openFindingIds.every((id) => decided.get(id))),
      baseline_open_findings: openFindingIds,
      carried: B5rows,
    },
    B6: {
      verdict: verdict(B5rows.every((row) => row.outcome)),
      undecided: B5rows.filter((row) => !row.outcome).length,
    },
  },
  reported: {
    ledger_rows: ledger.length,
    evidence: count("SELECT COUNT(*) n FROM evidence"),
    dispositions: dispositions.length,
    attached_dispositions: new Set(attachments.map((a) => `${a.subsystem_id}/${a.concern_code}`))
      .size,
    disposition_evidence_rows: attachments.length,
    field_notes: count("SELECT COUNT(*) n FROM field_notes"),
    open_questions_all: count("SELECT COUNT(*) n FROM open_questions"),
    open_questions_open: count("SELECT COUNT(*) n FROM open_questions WHERE resolution='open'"),
    anchored_terms: count(
      "SELECT COUNT(*) n FROM vocabulary WHERE first_seen IS NOT NULL AND TRIM(first_seen) <> ''",
    ),
    open_findings: count("SELECT COUNT(*) n FROM findings WHERE status='confirmed-bug'"),
    subsystems: subsystems.length,
    seams: count("SELECT COUNT(*) n FROM seams"),
    claims: count("SELECT COUNT(*) n FROM claims"),
    xrefs: count("SELECT COUNT(*) n FROM xrefs"),
    sessions: count("SELECT COUNT(*) n FROM sessions"),
    finding_status_histogram: Object.fromEntries(
      all("SELECT status, COUNT(*) n FROM findings GROUP BY status ORDER BY status").map((row) => [
        row.status,
        Number(row.n),
      ]),
    ),
    classification_histogram: Object.fromEntries(
      all(
        "SELECT COALESCE(classification,'(null)') k, COUNT(*) n FROM file_ledger GROUP BY 1 ORDER BY 1",
      ).map((row) => [row.k, Number(row.n)]),
    ),
  },
};

// §7.5 asks for "every reported axis with its delta", and a delta is a
// comparison, not a count. The axes above are the candidate half; this block
// pairs each with the frozen fixture's value and the signed difference, keyed
// the same way, so a later reader can answer "against what, and by how much"
// without the fixture in hand. Histograms get a per-bucket delta over the union
// of both sides' keys: a bucket that exists on one side only is a change of the
// bucket's whole count, and dropping it would report no change at all.
//
// It is a sibling of `reported` rather than a replacement for its shape because
// `dev/test-survey-depth.mjs` reads those axes as numbers (§7.1's candidate
// arm), and this recorder does not get to change another gate's contract to
// satisfy its own. `GATE A1` recomputes every entry here from `reported` and the
// fixture, so the two can never drift apart silently.
receipt.reported_deltas = Object.fromEntries(
  Object.entries(baseline.reported ?? {}).map(([key, base]) => {
    if (typeof base === "number") {
      const candidate = receipt.reported[key];
      return [
        key,
        {
          candidate: typeof candidate === "number" ? candidate : null,
          baseline: base,
          delta: typeof candidate === "number" ? candidate - base : null,
        },
      ];
    }
    const candidate = receipt.reported[key] ?? {};
    const buckets = [...new Set([...Object.keys(base ?? {}), ...Object.keys(candidate)])].sort();
    return [
      key,
      Object.fromEntries(
        buckets.map((bucket) => [bucket, Number(candidate[bucket] ?? 0) - Number(base[bucket] ?? 0)]),
      ),
    ];
  }),
);

db.close();

const rendered = `${JSON.stringify(receipt, null, 2)}\n`;

if (check) {
  if (!existsSync(RECEIPT_PATH)) die(1, `${RECEIPT_PATH} is absent; run this recorder to write it`);
  const committed = JSON.parse(readFileSync(RECEIPT_PATH, "utf8"));
  const drift = [];
  const compare = (label, a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) drift.push(label);
  };
  compare("blocking", committed.blocking, receipt.blocking);
  compare("reported", committed.reported, receipt.reported);
  compare("reported_deltas", committed.reported_deltas, receipt.reported_deltas);
  compare("store", committed.store, receipt.store);
  if (drift.length) {
    die(1, `the committed receipt disagrees with the live store on: ${drift.join(", ")}`);
  }
  process.stdout.write(
    `acceptance receipt matches the live store: examined ${examined}/${obligationBearing}, ` +
      `${carried.length} carried record(s), ${dispositions.length} disposition(s)\n`,
  );
  process.exit(0);
}

writeFileSync(RECEIPT_PATH, rendered);
process.stdout.write(
  `wrote ${RECEIPT_PATH}\n` +
    `  repository_sha        ${repositorySha}\n` +
    `  reconciled at         ${reconciliation?.detected_sha ?? "(none)"} ` +
    `(${tracked.length} tracked, ${unledgered} unledgered, ${absent} absent)\n` +
    `  examined              ${examined}/${obligationBearing} ` +
    `(${obligationBearing > 0 ? ((100 * examined) / obligationBearing).toFixed(2) : "—"}%) against baseline ` +
    `${(100 * baselineFraction).toFixed(2)}%\n` +
    `  dispositions          ${dispositions.length}, ${receipt.reported.attached_dispositions} with an attachment\n` +
    `  carried records       ${carried.length}, ${B5rows.filter((row) => !row.outcome).length} undecided\n` +
    `  blocking verdicts     ${Object.entries(receipt.blocking)
      .map(([id, value]) => `${id}=${value.verdict}`)
      .join(" ")}\n`,
);
