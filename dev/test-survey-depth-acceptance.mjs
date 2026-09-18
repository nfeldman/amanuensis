#!/usr/bin/env node
// GATE A1 (design/survey-depth/spec.md §8.8) — packet P11.
//
// `design/survey-depth/acceptance-receipt.json` is what the depth gate reads
// wherever the live store is not — CI, another machine, a later revision — and
// §7.3 requires every blocking predicate to be **recomputed** from it rather
// than read off a verdict field. A receipt nobody recomputes is a self-report.
// This gate is the recomputation, and the seeded forgeries below are what
// distinguish it from a gate that always greens (VP4(f); §8.8's own words: A1
// was the only gate in §8 with no control).
//
// The status line addresses two readers. The lane's launcher greps the *packet*
// id (`^GATE P11 RED: `, `^GATE P11 GREEN`); the specification names this gate
// `A1`. The packet marker leads and the spec gate's verdict is the reason it
// carries, so neither reader has to know about the other.
//
//   exit 0  `GATE P11 GREEN — GATE A1 GREEN`
//   exit 1  `GATE P11 RED: GATE A1 RED: <reason>`
//   exit 2  `GATE P11 CANNOT RUN: GATE A1 CANNOT RUN: <reason>`
//
// The third state is reached only where this checkout cannot answer ancestry —
// a shallow clone, which `dev/receipt-provenance.mjs` reports rather than
// guesses. Everything else this gate needs is committed: the receipt, the
// frozen baseline fixture, the carry receipt, the vocabulary contract and the
// tree. The live store is read when one is present and is never required; it is
// untracked (`git ls-files .amanuensis` → 0), so requiring it would make this
// gate green by absence in CI, which is the zero-denominator failure this
// repository has recorded three times.
//
// Red when (§8.8):
//   - the receipt is absent, unparseable, or does not declare its contract;
//   - it does not bind to this repository and to a store identity — its
//     `repository_sha`, its store's `checked_sha` or its reconciliation's
//     `detected_sha` does not resolve on this branch; its digests do not
//     re-derive; its baseline block names a different archive than the frozen
//     fixture; or **its ledger does not account for every path tracked at the
//     revision this gate runs at**. That last one is deliberate and is §7.3 B1's
//     own requirement ("zero unledgered and zero absent at the acceptance
//     revision") carried forward: a tracked path added after the receipt was
//     written is a path the acceptance never classified, and a receipt that
//     still claims a complete inventory over it is bound to a repository that
//     no longer exists. Re-record the receipt; do not relax the assertion;
//   - it records a blocking axis as green whose recorded value fails the
//     baseline comparison, or whose own row-level witnesses refute it. B1–B4
//     are recomputed here from the witnesses §7.5 requires — the reconciliation
//     digests, the per-disposition attachment `ref_sha` values, the
//     per-subsystem anchors and declinations — and **no `verdict` field is ever
//     read as an input**; each is compared against the recomputation instead,
//     so a flipped verdict is a failure rather than an answer;
//   - it omits any carried finding the carry receipt accounts for, or records
//     one with no outcome, or with an outcome outside the vocabulary contract's
//     `carried_finding_outcome`;
//   - it does not carry every reported axis with its baseline and its signed
//     delta (§7.5, claim C31);
//   - it disagrees with the live store where one is present;
//   - this gate does not run in `.github/workflows/test.yml`.
//
// Must-stay-green control (§8.8): the committed receipt at HEAD, bound to this
// repository and to the acceptance store, validates — and is the only receipt
// that does. Paired with it, the two **seeded forged-green receipts** §8.8
// names, both derived from that same committed receipt so that nothing but the
// seeded lie separates them from the control:
//
//   forgery 1  B2's `verdict` flipped to green while its recorded
//              `examined_fraction` stays below the baseline's 0.5957.
//   forgery 2  a per-disposition witness row whose attachment `ref_sha` values
//              do not resolve, while B3's `verdict` reads green.
//
// A1 must turn red on both, in the `blocking` family, and the unseeded control
// must not report that family. A kill proves a gate *can* fire, never that it
// fires selectively, so a third arm builds a synthetic complete input set,
// checks it evaluates clean, and then seeds one fault at a time into it —
// twenty-one of them — requiring each to fire its own family and no other. That
// arm needs no store, no archive and no tree, so it runs wherever this gate
// runs and a weakening of `evaluateAcceptance` shows up in it immediately.
//
// False green it cannot exclude (§8.8): a receipt proves what was true when it
// was written. Every revision it cites is re-resolved here and every digest is
// re-derived, so a receipt whose citations were rewritten away is caught — but
// a disposition that was wrong when it was attached to code that exists is not.
// The live arm narrows the window only where a store exists to read, which in
// CI it does not.
//
// What a reviewer should sabotage, and what must go red:
//   flip any blocking verdict to green                 → blocking
//   lower a B2 count or fraction below the baseline    → blocking
//   point a B3 witness ref_sha at an unreachable rev   → blocking
//   empty a subsystem's terms and declination          → blocking
//   drop a carried record, or blank its outcome        → carried
//   change a reported delta so it stops arithmetic     → reported
//   add a tracked file without re-recording the receipt→ binding
//   edit a digest, a store id, or a bound revision     → binding
//   change a count in the live store only              → live
//   drop the gate from .github/workflows/test.yml      → ci
//   weaken evaluateAcceptance so any of those passes   → the selectivity arm

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { historyIsComplete } from "./receipt-provenance.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT_REL = "design/survey-depth/acceptance-receipt.json";
const BASELINE_REL = "dev/survey-depth-baseline.json";
const CARRY_REL = "design/survey-depth/carry-receipt.json";
const VOCABULARY_REL = "mcp-server/contracts/conspectus-vocabulary.json";
const STORE_REL = ".amanuensis/memory.db";
const CI_REL = ".github/workflows/test.yml";
const GATE_COMMAND = "node dev/test-survey-depth-acceptance.mjs";
const CONTRACT = "amanuensis-survey-depth/acceptance-receipt/v1";

const NUL = "\u0000";

// §7.3 B3 applies from `concerns`; §7.3 B4 from `structural`. The ladder is the
// skill's, spelled out here rather than read from the receipt: a receipt that
// renamed a rung must not be able to move its own threshold.
const STATUS_ORDER = ["unmapped", "scoping", "structural", "concerns", "adversarial", "mapped"];
const B3_FROM = STATUS_ORDER.indexOf("concerns");
const B4_FROM = STATUS_ORDER.indexOf("structural");

process.removeAllListeners("warning");
process.on("warning", () => {});

// Every message this gate prints is scrubbed of these, so an absent deliverable
// reads as a failed assertion rather than as a gate that never reached one.
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
  for (const signature of CRASH_SIGNATURES) out = out.split(signature).join(elide(signature));
  return out;
}

// One headline per family, in the order a status line prefers them, so the line
// says which of §8.8's red conditions fired rather than reporting a count.
const FAMILY_ORDER = ["binding", "blocking", "carried", "reported", "live", "ci"];
const HEADLINES = {
  binding: "the acceptance receipt does not bind to this repository and store",
  blocking: "the acceptance receipt records a blocking axis its own witnesses refute",
  carried: "the acceptance receipt does not account for every carried finding with an outcome",
  reported: "the acceptance receipt does not carry every reported axis with its delta",
  live: "the acceptance receipt disagrees with the live store",
  ci: "this gate does not run in CI, so a break lands on a branch no run reports",
};

function digestOf(parts) {
  return createHash("sha256")
    .update([...parts].sort().join(NUL))
    .digest("hex");
}

function isSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function short(value) {
  return isSha(value) ? `${value.slice(0, 7)}` : JSON.stringify(value ?? null);
}

function sample(list, n = 3) {
  const head = [...list].slice(0, n);
  return list.length > n ? `${head.join(", ")}, … (${list.length} in all)` : head.join(", ");
}

// ---------------------------------------------------------------------------
// The comparison, as a pure function of its inputs
//
// Pure so the selectivity arm can seed one fault at a time with no tree, no
// store and no filesystem, and so that weakening it shows up in every arm at
// once. `repository` supplies the three things only git can answer, as
// injectable functions.
//
//   receipt      the parsed document, or null when it could not be read
//   baseline     the frozen fixture of §7.2
//   carriedIds   the finding ids the carry receipt accounts for (the
//                denominator, read from a *different* committed document so a
//                dropped record cannot shrink both halves at once — GP24)
//   outcomes     the vocabulary contract's carried_finding_outcome values
//   exempt       the classifications the contract marks obligation_bearing:false
//   repository   { head, headPaths: string[], treeAt(sha), resolves(sha) }
//   store        { store_generation, checked_sha, ledger_rows, examined,
//                  obligation_bearing, dispositions, carried } or null
//   ci           the CI workflow text, or null when it could not be read
//
// Returns [{ family, detail }] — empty when every assertion held.
// ---------------------------------------------------------------------------
export function evaluateAcceptance({
  receipt,
  baseline,
  carriedIds,
  outcomes,
  exempt,
  repository,
  store,
  ci,
}) {
  const failures = [];
  const fail = (family, detail) => failures.push({ family, detail: scrub(detail) });

  // --- ci is independent of the receipt, so it is checked whatever happens ---
  if (typeof ci !== "string") {
    fail("ci", `${CI_REL} could not be read, so nothing establishes that this gate runs on a push`);
  } else if (!ci.includes(GATE_COMMAND)) {
    fail("ci", `${CI_REL} does not run \`${GATE_COMMAND}\`, so a break lands unreported`);
  }

  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail(
      "binding",
      `${RECEIPT_REL} could not be read as a JSON object, so it binds nothing to this repository ` +
        "or to any store",
    );
    return failures;
  }
  if (receipt.contract !== CONTRACT) {
    fail(
      "binding",
      `${RECEIPT_REL} declares contract ${JSON.stringify(receipt.contract ?? null)}, not ` +
        `${CONTRACT}; nothing establishes that this document is the acceptance receipt at all`,
    );
    return failures;
  }

  // --- A1 binding: every revision it cites resolves on this branch ----------
  const cited = [
    ["repository_sha", receipt.repository_sha],
    ["store.checked_sha", receipt.store?.checked_sha],
    ["blocking.B1.witness.detected_sha", receipt.blocking?.B1?.witness?.detected_sha],
  ];
  for (const [label, value] of cited) {
    if (!isSha(value)) {
      fail(
        "binding",
        `the receipt's ${label} is ${JSON.stringify(value ?? null)}, not a 40-hex revision, so ` +
          "the receipt is bound to nothing this repository can check",
      );
    } else if (!repository.resolves(value)) {
      fail(
        "binding",
        `the receipt's ${label} ${short(value)} does not resolve as an ancestor of HEAD on this ` +
          "branch, so the receipt cites a revision this checkout cannot reach",
      );
    }
  }

  // --- A2 binding: the store identity of §5.3 -------------------------------
  const storeId = receipt.store?.store_id;
  if (typeof storeId !== "string" || !storeId.trim()) {
    fail(
      "binding",
      "the receipt records no store.store_id, so it is not bound to the store whose survey it " +
        "reports; §5.3 mints that identity at schema creation for exactly this reason",
    );
  }

  // --- A3 binding: the frozen baseline it is compared against ---------------
  if (receipt.baseline?.archived_store_id !== baseline.archived_store_id) {
    fail(
      "binding",
      `the receipt compares against archive ${JSON.stringify(receipt.baseline?.archived_store_id ?? null)} ` +
        `and ${BASELINE_REL} froze ${JSON.stringify(baseline.archived_store_id)}; a receipt measured ` +
        "against a different baseline is internally consistent and not the acceptance",
    );
  }
  if (receipt.baseline?.checked_sha !== baseline.checked_sha) {
    fail(
      "binding",
      `the receipt records the baseline at ${short(receipt.baseline?.checked_sha)} and the frozen ` +
        `fixture at ${short(baseline.checked_sha)}`,
    );
  }
  const baselineFraction = Number(baseline.blocking?.examined_fraction);
  if (Number(receipt.baseline?.examined_fraction) !== baselineFraction) {
    fail(
      "binding",
      `the receipt records the baseline examined fraction as ` +
        `${JSON.stringify(receipt.baseline?.examined_fraction ?? null)} and the frozen fixture as ` +
        `${baselineFraction}; the comparison would be against a number nobody measured`,
    );
  }

  // --- A4 binding: the reconciliation witness re-derives --------------------
  const witness = receipt.blocking?.B1?.witness ?? null;
  const ledgerRows = Array.isArray(witness?.ledger) ? witness.ledger : null;
  if (ledgerRows === null) {
    fail(
      "binding",
      "the receipt carries no blocking.B1.witness.ledger, so B1 cannot be recomputed from it and " +
        "§7.5's digests bind to rows nobody can see",
    );
    return failures;
  }

  const ledgerPaths = ledgerRows.map((row) => String(row?.file_path ?? ""));
  const ledgerSet = new Set(ledgerPaths);
  const ledgerDigest = digestOf(
    ledgerRows.map((row) => `${row?.file_path ?? ""}${NUL}${row?.classification ?? ""}`),
  );
  if (ledgerDigest !== witness.ledger_digest) {
    fail(
      "binding",
      `the receipt records ledger_digest ${String(witness.ledger_digest).slice(0, 12)}… and its ` +
        `${ledgerRows.length} recorded ledger row(s) re-derive ${ledgerDigest.slice(0, 12)}…; the ` +
        "digest and the rows beneath it describe two different ledgers",
    );
  }

  const detected = witness.detected_sha;
  const treeAtDetected = isSha(detected) ? repository.treeAt(detected) : null;
  if (treeAtDetected === null) {
    fail(
      "binding",
      `the tree at the reconciliation's detected_sha ${short(detected)} cannot be enumerated here, ` +
        "so neither digest can be re-derived",
    );
  } else {
    const treeDigest = digestOf(treeAtDetected);
    if (treeDigest !== witness.tree_digest) {
      fail(
        "binding",
        `the receipt records tree_digest ${String(witness.tree_digest).slice(0, 12)}… and the ` +
          `${treeAtDetected.length} path(s) tracked at ${short(detected)} re-derive ` +
          `${treeDigest.slice(0, 12)}…`,
      );
    }
  }

  // --- A5 binding: the ledger accounts for the tree this gate runs against --
  // §7.3 B1 at the acceptance revision. A path added after the receipt was
  // written is a path the acceptance never classified.
  const headPaths = repository.headPaths ?? [];
  const headSet = new Set(headPaths);
  const unledgeredHere = headPaths.filter((path) => !ledgerSet.has(path)).sort();
  const absentHere = [...ledgerSet].filter((path) => !headSet.has(path)).sort();
  if (unledgeredHere.length || absentHere.length) {
    fail(
      "binding",
      `the receipt's ledger accounts for ${ledgerSet.size} path(s) and ${headPaths.length} are ` +
        `tracked at ${short(repository.head)}: ${unledgeredHere.length} unledgered ` +
        `(${sample(unledgeredHere) || "none"}) and ${absentHere.length} absent ` +
        `(${sample(absentHere) || "none"}). The receipt is bound to a tree this revision no longer ` +
        "has; re-record it at this revision rather than relaxing the inventory",
    );
  }

  // --- B1 recomputed at its own revision ------------------------------------
  if (treeAtDetected !== null) {
    const trackedThere = new Set(treeAtDetected);
    const unledgered = treeAtDetected.filter((path) => !ledgerSet.has(path)).length;
    const absent = [...ledgerSet].filter((path) => !trackedThere.has(path)).length;
    verdictAgrees(fail, receipt.blocking?.B1, "B1", unledgered === 0 && absent === 0, () =>
      `${unledgered} tracked path(s) are unledgered and ${absent} ledger row(s) name a path the ` +
        `tree at ${short(detected)} does not carry; ADR-0001 clause 1 requires exactly one ` +
        "assignment or explicit exclusion per tracked path",
    );
    if (Number(witness.unledgered) !== unledgered || Number(witness.absent) !== absent) {
      fail(
        "blocking",
        `B1's witness records unledgered=${witness.unledgered} absent=${witness.absent} and its ` +
          `own ledger against the tree at ${short(detected)} re-derives ${unledgered} and ${absent}`,
      );
    }
  }

  // --- B2 recomputed --------------------------------------------------------
  const exemptSet = new Set(exempt);
  const B2 = receipt.blocking?.B2 ?? {};
  if (treeAtDetected !== null) {
    const byPath = new Map(ledgerRows.map((row) => [row?.file_path, row?.classification ?? null]));
    const obligationBearing = treeAtDetected.filter(
      (path) => !exemptSet.has(byPath.get(path) ?? ""),
    ).length;
    const examined = treeAtDetected.filter((path) => byPath.get(path) === "examined").length;
    if (Number(B2.examined) !== examined || Number(B2.obligation_bearing) !== obligationBearing) {
      fail(
        "blocking",
        `B2 records examined=${B2.examined} over ${B2.obligation_bearing} obligation-bearing ` +
          `path(s) and its own ledger re-derives ${examined} over ${obligationBearing}`,
      );
    }
  }
  const recordedFraction = Number(B2.fraction);
  const recomputedFraction =
    Number(B2.obligation_bearing) > 0 ? Number(B2.examined) / Number(B2.obligation_bearing) : null;
  if (recomputedFraction === null) {
    fail(
      "blocking",
      "B2's obligation-bearing denominator is zero or missing, which is out of band and never a " +
        "pass (VP4(e))",
    );
  } else if (Math.abs(recordedFraction - recomputedFraction) > 1e-9) {
    fail(
      "blocking",
      `B2 records fraction ${recordedFraction} and its own examined/obligation_bearing ` +
        `(${B2.examined}/${B2.obligation_bearing}) is ${recomputedFraction.toFixed(6)}`,
    );
  }
  verdictAgrees(
    fail,
    B2,
    "B2",
    recomputedFraction !== null && recordedFraction + 1e-9 >= baselineFraction,
    () =>
      `its recorded examined fraction ${Number.isFinite(recordedFraction) ? (100 * recordedFraction).toFixed(2) : "—"}% ` +
      `(${B2.examined ?? "—"}/${B2.obligation_bearing ?? "—"}) is below the frozen baseline's ` +
      `${(100 * baselineFraction).toFixed(2)}%`,
  );

  // --- B4's subsystem rows first: B3 reads their statuses -------------------
  const B4 = receipt.blocking?.B4 ?? {};
  const subsystems = Array.isArray(B4.subsystems) ? B4.subsystems : [];
  if (!subsystems.length) {
    fail(
      "blocking",
      "B4 carries no per-subsystem rows, so §7.5's vocabulary witnesses are absent and B4 cannot " +
        "be recomputed from this receipt",
    );
  }
  const statusById = new Map(subsystems.map((row) => [row?.id, row?.status]));
  const B4gaps = [];
  for (const row of subsystems) {
    const rung = STATUS_ORDER.indexOf(String(row?.status ?? ""));
    if (rung < B4_FROM) continue;
    const terms = Array.isArray(row?.terms) ? row.terms : [];
    const anchored = terms.filter(
      (term) => typeof term?.first_seen === "string" && term.first_seen.trim(),
    );
    const declination = row?.declination ?? null;
    const declines =
      declination &&
      declination.id !== undefined &&
      declination.id !== null &&
      isSha(declination.ref_sha) &&
      repository.resolves(declination.ref_sha) &&
      typeof declination.session_id === "string" &&
      declination.session_id.trim();
    if (!anchored.length && !declines) {
      B4gaps.push(`${row?.id ?? "(unnamed)"}@${row?.status ?? "(no status)"}`);
    }
  }
  verdictAgrees(
    fail,
    B4,
    "B4",
    subsystems.length > 0 && B4gaps.length === 0,
    () =>
      subsystems.length === 0
        ? "it carries no subsystem rows at all"
        : `subsystem(s) ${B4gaps.join(", ")} are at structural or later with neither an anchored ` +
          "term nor an effective declination whose revision resolves",
  );

  // --- B3 recomputed, one row per disposition ------------------------------
  const B3 = receipt.blocking?.B3 ?? {};
  const dispositions = Array.isArray(B3.dispositions) ? B3.dispositions : [];
  if (!dispositions.length) {
    fail(
      "blocking",
      "B3 carries no per-disposition rows, so §7.5's evidence witnesses are absent and B3 cannot " +
        "be recomputed from this receipt",
    );
  }
  const B3gaps = [];
  for (const row of dispositions) {
    const id = `${row?.subsystem_id ?? "(unnamed)"}/${row?.concern_code ?? "(no concern)"}`;
    const declared = String(row?.subsystem_status ?? "");
    const actual = statusById.get(row?.subsystem_id);
    if (actual !== undefined && actual !== declared) {
      fail(
        "blocking",
        `B3's row for ${id} declares its subsystem at ${JSON.stringify(declared)} and B4's row for ` +
          `${row?.subsystem_id} records ${JSON.stringify(actual)}; a row that can move its own ` +
          "threshold is not a witness",
      );
    }
    if (STATUS_ORDER.indexOf(declared) < B3_FROM) continue;
    const attachments = Array.isArray(row?.attachments) ? row.attachments : [];
    const resolving = attachments.filter(
      (a) => isSha(a?.ref_sha) && repository.resolves(a.ref_sha),
    );
    if (!resolving.length) {
      B3gaps.push(
        attachments.length
          ? `${id} (${attachments.length} attachment(s), none resolving: ` +
            `${sample(attachments.map((a) => short(a?.ref_sha)))})`
          : `${id} (no attached evidence row at all)`,
      );
    }
  }
  verdictAgrees(
    fail,
    B3,
    "B3",
    dispositions.length > 0 && B3gaps.length === 0,
    () =>
      dispositions.length === 0
        ? "it carries no disposition rows at all"
        : `disposition(s) ${B3gaps.join("; ")} sit in a subsystem at concerns or later with no ` +
          "attached evidence row whose ref_sha resolves (§2.3 re-asserted over the finished store)",
  );

  // --- B5/B6: the carried table --------------------------------------------
  const B5 = receipt.blocking?.B5 ?? {};
  const carried = Array.isArray(B5.carried) ? B5.carried : null;
  if (carried === null) {
    fail("carried", "the receipt carries no blocking.B5.carried table");
  } else {
    const byId = new Map();
    for (const row of carried) byId.set(String(row?.archived_finding_id ?? ""), row);
    const omitted = [...carriedIds].filter((id) => !byId.has(id)).sort();
    if (omitted.length) {
      fail(
        "carried",
        `the receipt omits ${omitted.length} of the ${carriedIds.length} carried finding(s) ` +
          `${CARRY_REL} accounts for: ${sample(omitted, 6)}`,
      );
    }
    const undecided = carried
      .filter((row) => !row?.outcome || !String(row.outcome).trim())
      .map((row) => String(row?.archived_finding_id ?? "(unnamed)"))
      .sort();
    if (undecided.length) {
      fail(
        "carried",
        `${undecided.length} carried record(s) reach no outcome: ${sample(undecided, 6)}; §5.5 ` +
          "refuses fully surveyed while any obligation is undecided",
      );
    }
    const unknown = carried
      .filter((row) => row?.outcome && !outcomes.includes(String(row.outcome)))
      .map((row) => `${row?.archived_finding_id}=${row?.outcome}`)
      .sort();
    if (unknown.length) {
      fail(
        "carried",
        `${unknown.length} carried record(s) record an outcome outside the vocabulary contract's ` +
          `carried_finding_outcome {${outcomes.join(", ")}}: ${sample(unknown, 6)}`,
      );
    }
    for (const row of carried) {
      if (String(row?.outcome) !== "repaired") continue;
      if (!isSha(row?.repaired_sha) || !repository.resolves(row.repaired_sha)) {
        fail(
          "carried",
          `carried record ${row?.archived_finding_id} is repaired at ` +
            `${short(row?.repaired_sha)}, which does not resolve on this branch; §5.4 requires the ` +
            "repair to name a commit this workspace can reach",
        );
      }
    }
    // B5's own denominator: the baseline's open findings, each terminal.
    const openIds = baseline.blocking?.open_findings ?? [];
    const missing = openIds.filter((id) => {
      const row = byId.get(id);
      return !row?.outcome || !String(row.outcome).trim();
    });
    verdictAgrees(
      fail,
      B5,
      "B5",
      openIds.length > 0 && missing.length === 0,
      () =>
        openIds.length === 0
          ? "the frozen baseline names no open finding, so B5 has no denominator (VP4(e))"
          : `baseline open finding(s) ${missing.join(", ")} have no carried record with a terminal ` +
            "outcome in the candidate",
    );
    const B6 = receipt.blocking?.B6 ?? {};
    verdictAgrees(
      fail,
      B6,
      "B6",
      undecided.length === 0,
      () => `${undecided.length} carried record(s) are undecided: ${sample(undecided, 6)}`,
    );
    if (Number(B6.undecided ?? 0) !== undecided.length) {
      fail(
        "blocking",
        `B6 records undecided=${B6.undecided} and the carried table holds ${undecided.length}`,
      );
    }
  }

  // --- the reported axes, each with its baseline and signed delta (§7.5) ----
  const reported = receipt.reported ?? {};
  const deltas = receipt.reported_deltas ?? null;
  if (deltas === null || typeof deltas !== "object") {
    fail(
      "reported",
      "the receipt carries no reported_deltas block, so §7.5's “every reported axis with its " +
        "delta” is unmet and a reader has counts with nothing to compare them to",
    );
  } else {
    for (const [key, base] of Object.entries(baseline.reported ?? {})) {
      const candidate = reported[key];
      const entry = deltas[key];
      if (typeof base === "number") {
        if (typeof candidate !== "number") {
          fail("reported", `the receipt records no numeric reported axis ${key}`);
          continue;
        }
        if (!entry || typeof entry !== "object") {
          fail("reported", `the receipt records no delta for reported axis ${key}`);
          continue;
        }
        if (entry.candidate !== candidate || entry.baseline !== base) {
          fail(
            "reported",
            `reported axis ${key}: the delta block records candidate ` +
              `${JSON.stringify(entry.candidate ?? null)} / baseline ` +
              `${JSON.stringify(entry.baseline ?? null)} against the receipt's ${candidate} and ` +
              `the fixture's ${base}`,
          );
          continue;
        }
        if (entry.delta !== candidate - base) {
          fail(
            "reported",
            `reported axis ${key}: ${candidate} − ${base} is ${candidate - base} and the receipt ` +
              `records a delta of ${JSON.stringify(entry.delta ?? null)}`,
          );
        }
      } else if (base && typeof base === "object") {
        const entryKeys = entry && typeof entry === "object" ? entry : null;
        if (!entryKeys) {
          fail("reported", `the receipt records no per-key delta for histogram ${key}`);
          continue;
        }
        const wanted = [
          ...new Set([...Object.keys(base), ...Object.keys(reported[key] ?? {})]),
        ].sort();
        for (const bucket of wanted) {
          const candidate = Number(reported[key]?.[bucket] ?? 0);
          const before = Number(base[bucket] ?? 0);
          if (Number(entryKeys[bucket]) !== candidate - before) {
            fail(
              "reported",
              `histogram ${key}.${bucket}: ${candidate} − ${before} is ${candidate - before} and ` +
                `the receipt records ${JSON.stringify(entryKeys[bucket] ?? null)}`,
            );
          }
        }
      }
    }
  }

  // --- the live store, where one exists ------------------------------------
  if (store) {
    if (store.store_generation !== storeId) {
      fail(
        "live",
        `the receipt names store ${JSON.stringify(storeId ?? null)} and the live store mints ` +
          `${JSON.stringify(store.store_generation ?? null)}; the receipt reports a survey of a ` +
          "different store",
      );
    }
    if (store.checked_sha !== receipt.store?.checked_sha) {
      fail(
        "live",
        `the receipt records the store checked at ${short(receipt.store?.checked_sha)} and the ` +
          `live store records ${short(store.checked_sha)}`,
      );
    }
    const pairs = [
      ["ledger rows", store.ledger_rows, Number(receipt.reported?.ledger_rows)],
      ["examined", store.examined, Number(B2.examined)],
      ["obligation-bearing paths", store.obligation_bearing, Number(B2.obligation_bearing)],
      ["dispositions", store.dispositions, Number(receipt.reported?.dispositions)],
      ["carried records", store.carried, carried === null ? NaN : carried.length],
    ];
    for (const [label, live, recorded] of pairs) {
      if (Number(live) !== Number(recorded)) {
        fail(
          "live",
          `the live store holds ${live} ${label} and the receipt records ${recorded}`,
        );
      }
    }
  }

  return failures;
}

// A blocking axis is never *read*. `holds` is the recomputation; the recorded
// verdict is compared against it, in both directions, so a flipped verdict is a
// failure rather than an answer (§7.3, §8.8).
function verdictAgrees(fail, axis, id, holds, why) {
  const recorded = axis?.verdict ?? null;
  if (!holds) {
    fail(
      "blocking",
      recorded === "green"
        ? `${id} records verdict "green" and recomputing it from the receipt's own witnesses ` +
          `refutes that: ${why()}`
        : `${id} does not hold: ${why()}`,
    );
    return;
  }
  if (recorded !== "green") {
    fail(
      "blocking",
      `${id} recomputes as holding and the receipt records verdict ` +
        `${JSON.stringify(recorded)}; the acceptance requires every blocking axis green`,
    );
  }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
function git(...args) {
  return spawnSync("git", args, {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readJson(relative) {
  try {
    return JSON.parse(readFileSync(join(REPO, relative), "utf8"));
  } catch {
    return null;
  }
}

function cannotRun(reason) {
  console.log(`GATE P11 CANNOT RUN: GATE A1 CANNOT RUN: ${scrub(reason)}`);
  process.exit(2);
}

function trackedPathsAt(revision) {
  const result = git("ls-tree", "-r", "--name-only", "-z", revision);
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? "")
    .split(NUL)
    .filter((path) => path.length > 0);
}

function buildRepository() {
  const head = String(git("rev-parse", "HEAD").stdout ?? "").trim();
  if (!isSha(head)) cannotRun("this checkout has no HEAD to measure the receipt against");
  if (!historyIsComplete(REPO)) {
    cannotRun(
      "revision ancestry is not evaluable in a shallow clone, so every revision the receipt cites " +
        "would go unchecked — check out with full history (`fetch-depth: 0` in CI)",
    );
  }
  const headPaths = trackedPathsAt(head);
  if (headPaths === null) cannotRun(`the tree at ${short(head)} cannot be enumerated here`);

  const resolved = new Map();
  const trees = new Map();
  return {
    head,
    headPaths,
    treeAt(sha) {
      if (!trees.has(sha)) trees.set(sha, trackedPathsAt(sha));
      return trees.get(sha);
    },
    resolves(sha) {
      if (!isSha(sha)) return false;
      if (resolved.has(sha)) return resolved.get(sha);
      const exists = git("cat-file", "-e", `${sha}^{commit}`);
      let answer = !exists.error && exists.status === 0;
      if (answer) {
        const ancestor = git("merge-base", "--is-ancestor", sha, head);
        answer = !ancestor.error && ancestor.status === 0;
      }
      resolved.set(sha, answer);
      return answer;
    },
  };
}

async function readLiveStore(exempt) {
  const path = join(REPO, STORE_REL);
  if (!existsSync(path)) return null;
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return null;
  }
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch {
    return null;
  }
  try {
    const all = (sql, ...params) => db.prepare(sql).all(...params);
    const count = (sql) => Number(Object.values(all(sql)[0])[0]);
    const identity = all("SELECT store_generation FROM store_identity ORDER BY id LIMIT 1")[0];
    const gitState = all("SELECT last_checked_sha FROM git_state LIMIT 1")[0];
    const reconciliation =
      all(
        "SELECT detected_sha FROM scope_reconciliations WHERE detected_sha = ? ORDER BY id DESC LIMIT 1",
        gitState?.last_checked_sha ?? null,
      )[0] ?? all("SELECT detected_sha FROM scope_reconciliations ORDER BY id DESC LIMIT 1")[0];
    const ledger = all("SELECT file_path, classification FROM file_ledger");
    const tracked = reconciliation ? (trackedPathsAt(reconciliation.detected_sha) ?? []) : [];
    const exemptSet = new Set(exempt);
    const byPath = new Map(ledger.map((row) => [row.file_path, row.classification]));
    return {
      store_generation: identity?.store_generation ?? null,
      checked_sha: gitState?.last_checked_sha ?? null,
      ledger_rows: ledger.length,
      examined: tracked.filter((path) => byPath.get(path) === "examined").length,
      obligation_bearing: tracked.filter((path) => !exemptSet.has(byPath.get(path) ?? "")).length,
      dispositions: count("SELECT COUNT(*) n FROM dispositions"),
      carried: count("SELECT COUNT(*) n FROM carried_findings"),
    };
  } catch {
    return null;
  } finally {
    try {
      db.close();
    } catch {
      /* the handle is read-only and this process is ending either way */
    }
  }
}

// ---------------------------------------------------------------------------
// The selectivity arm: a synthetic complete input set, then one fault at a time
// ---------------------------------------------------------------------------
const SYNTH_TREE = ["a.ts", "b.ts", "c.generated.ts"];
const SYNTH_SHA = "1".repeat(40);
const SYNTH_OTHER = "2".repeat(40);
const SYNTH_DEAD = "0".repeat(40);

function syntheticInputs() {
  const ledger = [
    { file_path: "a.ts", classification: "examined" },
    { file_path: "b.ts", classification: "examined" },
    { file_path: "c.generated.ts", classification: "generated-ignore" },
  ];
  const reported = { ledger_rows: 3, evidence: 4, dispositions: 2 };
  const baseline = {
    archived_store_id: "store-synthetic",
    checked_sha: SYNTH_OTHER,
    blocking: { examined_fraction: 0.5, open_findings: ["X-1"] },
    reported: { ledger_rows: 1, evidence: 1, dispositions: 1 },
  };
  const receipt = {
    contract: CONTRACT,
    repository_sha: SYNTH_SHA,
    store: { store_id: "synthetic-generation", checked_sha: SYNTH_SHA },
    baseline: {
      archived_store_id: "store-synthetic",
      checked_sha: SYNTH_OTHER,
      examined_fraction: 0.5,
    },
    blocking: {
      B1: {
        verdict: "green",
        witness: {
          detected_sha: SYNTH_SHA,
          tree_digest: digestOf(SYNTH_TREE),
          ledger_digest: digestOf(
            ledger.map((row) => `${row.file_path}${NUL}${row.classification}`),
          ),
          ledger,
          unledgered: 0,
          absent: 0,
        },
      },
      B2: { verdict: "green", examined: 2, obligation_bearing: 2, fraction: 1 },
      B3: {
        verdict: "green",
        dispositions: [
          {
            subsystem_id: "B-01",
            concern_code: "CC-1",
            subsystem_status: "mapped",
            attachments: [{ evidence_id: 1, ref_sha: SYNTH_SHA, resolved: true }],
          },
          {
            subsystem_id: "B-02",
            concern_code: "CC-1",
            subsystem_status: "concerns",
            attachments: [{ evidence_id: 2, ref_sha: SYNTH_SHA, resolved: true }],
          },
        ],
      },
      B4: {
        verdict: "green",
        subsystems: [
          {
            id: "B-01",
            status: "mapped",
            dispositions: 1,
            attached: 1,
            terms: [{ term: "t", first_seen: `a.ts:t@${SYNTH_SHA}` }],
            declination: null,
          },
          {
            id: "B-02",
            status: "concerns",
            dispositions: 1,
            attached: 1,
            terms: [],
            declination: { id: 7, ref_sha: SYNTH_SHA, session_id: "s-1" },
          },
        ],
      },
      B5: {
        verdict: "green",
        baseline_open_findings: ["X-1"],
        carried: [
          {
            carried_id: 1,
            archived_store_id: "store-synthetic",
            archived_finding_id: "X-1",
            outcome: "repaired",
            repaired_sha: SYNTH_SHA,
            evidence_revisions: [SYNTH_SHA],
          },
          {
            carried_id: 2,
            archived_store_id: "store-synthetic",
            archived_finding_id: "X-2",
            outcome: "ruled-out",
            repaired_sha: null,
            evidence_revisions: [],
          },
        ],
      },
      B6: { verdict: "green", undecided: 0 },
    },
    reported,
    reported_deltas: {
      ledger_rows: { candidate: 3, baseline: 1, delta: 2 },
      evidence: { candidate: 4, baseline: 1, delta: 3 },
      dispositions: { candidate: 2, baseline: 1, delta: 1 },
    },
  };
  const repository = {
    head: SYNTH_SHA,
    headPaths: [...SYNTH_TREE],
    treeAt: (sha) => (sha === SYNTH_SHA ? [...SYNTH_TREE] : null),
    resolves: (sha) => sha === SYNTH_SHA || sha === SYNTH_OTHER,
  };
  return {
    receipt,
    baseline,
    carriedIds: ["X-1", "X-2"],
    outcomes: ["successor-finding", "ruled-out", "repaired", "archived-terminal"],
    exempt: ["generated-ignore", "vendor-ignore"],
    repository,
    store: {
      store_generation: "synthetic-generation",
      checked_sha: SYNTH_SHA,
      ledger_rows: 3,
      examined: 2,
      obligation_bearing: 2,
      dispositions: 2,
      carried: 2,
    },
    ci: `  - run: ${GATE_COMMAND}\n`,
  };
}

const SEEDS = [
  [["binding"], "the contract string is changed", (i) => (i.receipt.contract = "something/else/v1")],
  [["binding"], "repository_sha is zeroed", (i) => (i.receipt.repository_sha = SYNTH_DEAD)],
  [["binding", "live"], "the store identity is dropped", (i) => (i.receipt.store.store_id = "")],
  [
    ["binding"],
    "the baseline archive is relabelled",
    (i) => (i.receipt.baseline.archived_store_id = "store-other"),
  ],
  [
    ["binding"],
    "the ledger digest is edited",
    (i) => (i.receipt.blocking.B1.witness.ledger_digest = SYNTH_DEAD),
  ],
  [
    ["binding"],
    "the tree digest is edited",
    (i) => (i.receipt.blocking.B1.witness.tree_digest = SYNTH_DEAD),
  ],
  [
    ["binding"],
    "a tracked path is added without re-recording the receipt",
    (i) => i.repository.headPaths.push("d.ts"),
  ],
  [
    ["blocking", "live"],
    "B2's verdict is flipped green over a fraction below the baseline",
    (i) => {
      i.receipt.blocking.B2.examined = 0;
      i.receipt.blocking.B2.fraction = 0;
      i.receipt.blocking.B1.witness.ledger[0].classification = "candidate";
      i.receipt.blocking.B1.witness.ledger[1].classification = "candidate";
      i.receipt.blocking.B1.witness.ledger_digest = digestOf(
        i.receipt.blocking.B1.witness.ledger.map(
          (row) => `${row.file_path}${NUL}${row.classification}`,
        ),
      );
    },
  ],
  [
    ["blocking"],
    "B3's witness names a ref_sha that does not resolve",
    (i) => (i.receipt.blocking.B3.dispositions[0].attachments[0].ref_sha = SYNTH_DEAD),
  ],
  [
    ["blocking"],
    "a disposition loses its only attachment",
    (i) => (i.receipt.blocking.B3.dispositions[1].attachments = []),
  ],
  [
    ["blocking"],
    "a B3 row understates its subsystem's status",
    (i) => (i.receipt.blocking.B3.dispositions[0].subsystem_status = "scoping"),
  ],
  [
    ["blocking"],
    "a subsystem loses both its anchor and its declination",
    (i) => {
      i.receipt.blocking.B4.subsystems[1].declination = null;
      i.receipt.blocking.B4.subsystems[1].terms = [];
    },
  ],
  [
    ["blocking"],
    "a declination's revision no longer resolves",
    (i) => (i.receipt.blocking.B4.subsystems[1].declination.ref_sha = SYNTH_DEAD),
  ],
  [
    ["blocking"],
    "B1's recorded unledgered count disagrees with its ledger",
    (i) => (i.receipt.blocking.B1.witness.unledgered = 4),
  ],
  [
    ["carried", "live"],
    "a carried record is dropped",
    (i) => i.receipt.blocking.B5.carried.splice(1, 1),
  ],
  [["carried", "blocking"], "a carried outcome is blanked", (i) => (i.receipt.blocking.B5.carried[1].outcome = "")],
  [
    ["carried"],
    "a repaired record names a revision that does not resolve",
    (i) => (i.receipt.blocking.B5.carried[0].repaired_sha = SYNTH_DEAD),
  ],
  [
    ["reported"],
    "a delta stops being candidate minus baseline",
    (i) => (i.receipt.reported_deltas.evidence.delta = 99),
  ],
  [["reported"], "the delta block is dropped", (i) => delete i.receipt.reported_deltas],
  [
    ["live"],
    "the live store holds a different count",
    (i) => (i.store.dispositions = 41),
  ],
  [["ci"], "the gate is removed from the workflow", (i) => (i.ci = "  - run: node dev/other.mjs\n")],
];

function runSelectivity(report) {
  const control = evaluateAcceptance(syntheticInputs());
  if (control.length) {
    report(
      false,
      "the synthetic control evaluates clean, so a seeded fault is the only difference",
      `the unseeded synthetic input set reports ${control.length} failure(s): ` +
        control.map((f) => `${f.family}: ${f.detail}`).join(" | "),
    );
    return;
  }
  report(true, "the synthetic control evaluates clean, so a seeded fault is the only difference");

  // CI's own state: the store is untracked, so on a bare checkout the receipt
  // arm stands alone. It must still evaluate — a gate that only answered where
  // a store exists would be green by absence exactly where it is load-bearing.
  const noStore = evaluateAcceptance({ ...syntheticInputs(), store: null });
  report(
    noStore.length === 0,
    "with no live store the receipt arm stands alone and still evaluates every assertion",
    `dropping the store changed the verdict: ${noStore.map((f) => `${f.family}: ${f.detail}`).join(" | ")}`,
  );
  // And the live arm is not decoration: the same inputs with a store that
  // disagrees must fail, so "no store" is a narrower check and never a laxer one.
  const wrongStore = syntheticInputs();
  wrongStore.store.ledger_rows = 999;
  report(
    evaluateAcceptance(wrongStore).some((f) => f.family === "live"),
    "a live store that disagrees still fails, so the no-store path is narrower and not laxer",
    "a disagreeing store produced no live failure",
  );

  for (const [expected, label, seed] of SEEDS) {
    const inputs = syntheticInputs();
    seed(inputs);
    const failures = evaluateAcceptance(inputs);
    const families = new Set(failures.map((f) => f.family));
    // Exact set equality, in both directions. A fault that fires nothing is a
    // gate that cannot see it; a fault that fires every family names nothing.
    // Where a seeded lie is genuinely visible from two sides — a dropped
    // carried record is both an incomplete receipt and a disagreement with the
    // store that still holds the row — the seed declares both, so the pairing
    // stays an assertion rather than a tolerance.
    const missing = expected.filter((family) => !families.has(family));
    const spurious = [...families].filter((family) => !expected.includes(family));
    if (missing.length || spurious.length) {
      report(
        false,
        `seeded: ${label}`,
        `expected exactly {${expected.join(", ")}} and the seeded fault fired ` +
          `{${[...families].join(", ") || "nothing"}}` +
          `${missing.length ? `; missing ${missing.join(", ")}` : ""}` +
          `${spurious.length ? `; spurious ${spurious.join(", ")}` : ""}`,
      );
      continue;
    }
    report(true, `seeded: ${label} → ${expected.join(" + ")}`);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const emitted = [];
const failures = [];
let checked = 0;
function report(ok, assertion, detail) {
  checked += 1;
  if (ok) {
    emitted.push(`  PASS ${scrub(assertion)}`);
    return;
  }
  const line = `${scrub(assertion)}: ${scrub(detail ?? "")}`;
  failures.push(line);
  emitted.push(`  FAIL ${line}`);
}

let exitCode = 0;
try {
  const baseline = readJson(BASELINE_REL);
  if (baseline === null) {
    cannotRun(`${BASELINE_REL} could not be read, so there is no frozen baseline to compare against`);
  }
  const vocabulary = readJson(VOCABULARY_REL);
  const exempt = (vocabulary?.enums?.file_classification?.values ?? [])
    .filter((value) => value.obligation_bearing === false)
    .map((value) => value.value);
  if (!exempt.length) {
    cannotRun(`${VOCABULARY_REL} supplies no obligation_bearing flags, so B2 has no exempt set`);
  }
  const outcomes = (vocabulary?.enums?.carried_finding_outcome?.values ?? []).map(
    (value) => value.value ?? value,
  );
  if (!outcomes.length) {
    cannotRun(`${VOCABULARY_REL} declares no carried_finding_outcome values`);
  }
  const carry = readJson(CARRY_REL);
  const carriedIds = (carry?.records ?? []).map((row) => String(row.archived_finding_id));
  if (!carriedIds.length) {
    cannotRun(
      `${CARRY_REL} accounts for no carried finding, so B5 would be counted against an empty ` +
        "denominator (VP4(e))",
    );
  }

  const repository = buildRepository();
  const receipt = readJson(RECEIPT_REL);
  const store = await readLiveStore(exempt);
  const ci = existsSync(join(REPO, CI_REL)) ? readFileSync(join(REPO, CI_REL), "utf8") : null;

  emitted.push(
    `GATE A1 — ${RECEIPT_REL} recomputed against ${BASELINE_REL} at ${short(repository.head)}` +
      `${store ? ", and against the live store" : " (no live store here; the receipt arm stands alone)"}`,
  );
  emitted.push("");
  emitted.push("the committed receipt — §8.8's must-stay-green control");
  const found = evaluateAcceptance({
    receipt,
    baseline,
    carriedIds,
    outcomes,
    exempt,
    repository,
    store,
    ci,
  });
  if (found.length) {
    for (const failure of found) report(false, `[${failure.family}]`, failure.detail);
  } else {
    report(true, "the committed receipt validates against this repository, this baseline and this store");
  }

  // The recorder arm.
  //
  // Every assertion above reads the committed receipt and re-derives its
  // predicates from the store; none of them ran `dev/record-survey-depth.mjs`,
  // the tool that wrote it. So the recorder could be broken outright — forced
  // to exit 2 on an available store — and A1 stayed green, and a reported axis
  // could drift away from the store with nothing to notice. `--check` is the
  // recorder's own answer to "would I write this same document today"; it is
  // stable across runs over an unchanged store, and its three exit codes are
  // kept distinct here because a recorder that cannot read its source is a
  // different fact from a recorder that disagrees with it (VP4(e)).
  // Guarded by the live store: where this gate has no store to read, the
  // recorder has none either, and its exit 2 is that same absence rather than a
  // fault of its own.
  if (store) {
    const recorder = join(REPO, "dev/record-survey-depth.mjs");
    if (!existsSync(recorder)) {
      report(false, "[live]", "dev/record-survey-depth.mjs is absent, so the receipt has no writer");
    } else {
      const run = spawnSync(process.execPath, [recorder, "--check"], {
        cwd: REPO,
        encoding: "utf8",
      });
      const said = scrub(`${run.stdout ?? ""} ${run.stderr ?? ""}`);
      if (run.error) {
        report(false, "[live]", "dev/record-survey-depth.mjs --check could not be run");
      } else if (run.status === 2) {
        report(
          false,
          "[live]",
          `dev/record-survey-depth.mjs --check cannot run against a store this gate just read: ${said}`,
        );
      } else if (run.status !== 0) {
        report(
          false,
          "[live]",
          `dev/record-survey-depth.mjs --check exits ${run.status}: ${said}`,
        );
      } else {
        report(true, "the recorder re-derives the committed receipt from the live store");
      }
    }
  }

  // §8.8's two seeded forged-green receipts, derived from the committed one so
  // that nothing but the seeded lie separates them from the control above.
  emitted.push("");
  emitted.push("§8.8's seeded forged-green receipts — each must turn this gate red");
  const controlFamilies = new Set(found.map((f) => f.family));
  const forgeries = [
    [
      "B2 flipped to green over an examined fraction below the baseline",
      (copy) => {
        copy.blocking.B2.verdict = "green";
        copy.blocking.B2.examined = 1;
        copy.blocking.B2.fraction = 1 / Number(copy.blocking.B2.obligation_bearing || 1);
      },
    ],
    [
      "a B3 witness row whose attachments name an unreachable ref_sha, verdict green",
      (copy) => {
        copy.blocking.B3.verdict = "green";
        const row = (copy.blocking.B3.dispositions ?? []).find(
          (candidate) =>
            STATUS_ORDER.indexOf(String(candidate?.subsystem_status ?? "")) >= B3_FROM &&
            Array.isArray(candidate?.attachments) &&
            candidate.attachments.length,
        );
        if (row) for (const attachment of row.attachments) attachment.ref_sha = SYNTH_DEAD;
      },
    ],
  ];
  for (const [label, forge] of forgeries) {
    if (receipt === null) {
      report(false, `forged receipt: ${label}`, "there is no committed receipt to forge a copy of");
      continue;
    }
    const copy = JSON.parse(JSON.stringify(receipt));
    forge(copy);
    const forged = evaluateAcceptance({
      receipt: copy,
      baseline,
      carriedIds,
      outcomes,
      exempt,
      repository,
      store,
      ci,
    });
    const families = new Set(forged.map((f) => f.family));
    if (!families.has("blocking")) {
      report(
        false,
        `forged receipt: ${label}`,
        `the forgery produced ${forged.length} failure(s) in ${[...families].join(", ") || "no family"} ` +
          "and none of them blocking, so a self-reported green would have validated",
      );
    } else if (controlFamilies.has("blocking")) {
      report(
        false,
        `forged receipt: ${label}`,
        "the unseeded receipt already fails the blocking family, so this forgery proves the gate " +
          "can fire and not that it fires on the forgery",
      );
    } else {
      report(true, `forged receipt: ${label} → blocking`);
    }
  }

  emitted.push("");
  emitted.push("selectivity — a synthetic control, then one seeded fault at a time (VP4(f))");
  runSelectivity(report);

  emitted.push("");
  for (const line of emitted) console.log(line);

  if (failures.length) {
    const headline =
      FAMILY_ORDER.map((family) => (found.some((f) => f.family === family) ? family : null)).find(
        Boolean,
      ) ?? null;
    const reason = headline ? HEADLINES[headline] : "this gate does not fire on a forged receipt";
    console.log(
      `GATE P11 RED: GATE A1 RED: ${reason} — ${failures.length} of ${checked} assertion(s) ` +
        `failed; first: ${failures[0]}`,
    );
    exitCode = 1;
  } else {
    console.log("GATE P11 GREEN — GATE A1 GREEN");
  }
} catch (error) {
  for (const line of emitted) console.log(line);
  console.log(
    `GATE P11 RED: GATE A1 RED: ${HEADLINES.binding} — this gate could not complete its ` +
      `recomputation: ${scrub(error?.message ?? error)}`,
  );
  exitCode = 1;
}

process.exit(exitCode);
