#!/usr/bin/env node
// Gate for reader-lenses packet P19 — every non-deferred subsystem of the
// rebuilt self-conspectus carried from `structural` to `mapped` through the
// skill's Phase 3 (concern review), Phase 4 (adversarial review) and Phase 5
// (packaging). Decision 4 asks for a rebuilt conspectus; P17 stopped at Phase 2,
// so a `structural` store is a claims-backed inventory nobody has challenged.
// (spec.md §12.1 step 6, §12.3; claims C52, C42, C43, C55, C63.)
//
// Two arms, for the reason P16's and P17's gates have two. The depth of the
// survey is a past event over a store that is untracked — `git ls-files
// .amanuensis` returns 0 — so a gate that only read the store would be green by
// absence in CI and in the launcher's verification worktree, which is the
// zero-denominator failure this repository has already recorded three times
// (VP4, and concern ZD-1 in this very survey). The pass is therefore recorded in
// a committed receipt and asserted over there. The *live store*, when one is
// present, is then read directly and read-only and must satisfy the same
// invariants: a receipt nobody can contradict is a claim about a claim.
//
// Every denominator this gate counts against is read from a *different*
// committed document than the one under test — `rebuild-coverage-receipt.json`,
// written by P17 — or is written out literally here. A numerator and its
// denominator that shrink together prove nothing (GP24), and the concern
// checklist is spelled out below rather than read from the record so that
// dropping a concern from the survey cannot also drop it from what this expects.
//
// Turns red when:
//   - `design/reader-lenses/rebuild-depth-receipt.json` is absent, is not valid
//     JSON, or does not bind itself to this repository and this store;
//   - a subsystem P17 carried to `structural` is not `mapped` here, or a
//     subsystem P17 deferred was mapped anyway;
//   - a subsystem's status ladder skips a rung, runs backwards, ends anywhere
//     but `mapped`, or reaches `mapped` by any route other than
//     `update_subsystem_status`; or a rung's own prerequisite (a registered
//     subsystem-survey artifact for `concerns`, a disposition for `adversarial`)
//     is not in the record;
//   - an active concern has no terminal disposition in a non-deferred subsystem
//     and no recorded open question naming the exact gap;
//   - a disposition carries no attached evidence, cites a file that is not in
//     the tree, or claims an evidence quality its attached rows do not support;
//     or rests on the weakest three evidence kinds without declaring itself
//     linchpin-dependent;
//   - a `ruled-out` disposition carries no overturn argument — the concern was
//     dismissed with no record of what dismissed it;
//   - a finding was not recorded through `add_finding`, carries no attached
//     evidence, or does not reconcile with the per-state counts beside it;
//   - a `confirmed-bug` disposition has no finding, or a finding names no
//     disposition that confirms it;
//   - a subsystem records no adversarial pass, or a current `<sid>/` claim P17
//     recorded carries no adversarial outcome — the structural account would
//     then have been published unchallenged;
//   - a seam whose two parties are both mapped carries no SC disposition, or
//     carries one on only one side;
//   - the live store, when present, breaks any of those, or has lost a
//     disposition, a finding or an outcome the receipt records;
//   - the gate does not run in `.github/workflows/test.yml`.
//
// False greens it cannot exclude. Whether a disposition is *correct* is not
// checked here and cannot be: the record can require that a concern was answered
// against code that exists, at the quality claimed, with an argument attached —
// not that the answer was right. Nor can it establish that the adversarial pass
// looked hard: a `survived` outcome on every claim is a legitimate result and an
// unfalsifiable one from outside, so what is asserted is that every claim has an
// outcome and that an `overturned` one carries the evidence that overturned it.
// The concern checklist itself is a denominator this gate takes on faith: a
// concern nobody calibrated is a concern nobody can miss. And a receipt proves
// what was true when it was written; the live arm narrows that window only where
// a store exists to read.
//
// Output protocol: exactly one status line, last, on stdout. Every message is
// scrubbed of the launcher's crash signatures, so an absent deliverable reads as
// a failed assertion rather than as a gate that never ran.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const RECEIPT_REL = "design/reader-lenses/rebuild-depth-receipt.json";
const COVERAGE_REL = "design/reader-lenses/rebuild-coverage-receipt.json";
const CI_REL = ".github/workflows/test.yml";
const GATE_COMMAND = "node dev/test-rebuild-depth.mjs";
const STORE_REL = ".amanuensis/memory.db";

const RECEIPT_CONTRACT = "amanuensis-reader-lenses/rebuild-depth-receipt/v1";

// The calibrated checklist onboarding produced for this repository, written out
// rather than read from the record. This is the denominator every subsystem's
// concern coverage is counted against; reading it from the same document that
// reports the coverage would let a dropped concern shrink both halves at once.
const CHECKLIST_CONCERNS = ["BV-1", "CC-1", "EV-1", "GT-1", "RC-1", "ZD-1"];

// phase-3-concerns.md: every concern reaches one of these. Nothing lingers at
// "suspected" or "unknown".
const TERMINAL_CLASSIFICATIONS = [
  "confirmed-bug",
  "confirmed-acceptable",
  "ruled-out",
  "out-of-scope",
  "unresolved-competition",
];

// The evidence-kind ladder, strongest first (SKILL.md § How findings flow).
const EVIDENCE_KINDS = [
  "code-verified",
  "runtime-observed",
  "contract-stated",
  "test-observed",
  "config-asserted",
  "doc-asserted",
  "comment-asserted",
  "name-inferred",
  "pattern-matched",
];

// The weakest three. A classification resting on one of these is
// linchpin-dependent by the skill's own rule, and saying so is the point.
const FRAGILE_KINDS = ["comment-asserted", "name-inferred", "pattern-matched"];

const DISPOSITION_ROLES = ["supports", "contradicts", "linchpin", "compensating"];
const FINDING_ROLES = ["symptom", "root-cause", "fix-anchor", "fix-verification", "compensating"];

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const FINDING_STATUSES = ["confirmed-bug", "confirmed-acceptable", "fixed", "ruled-out"];
const RESOLUTION_STATES = [
  "open",
  "accepted",
  "ruled-out",
  "fixed-pending-verification",
  "verified-fixed",
];

// phase-4-adversarial.md step 4: the verdict vocabulary for a finding target and
// the outcome vocabulary for a claim target. They are different lists on purpose.
const FINDING_VERDICTS = [
  "upheld",
  "overturned",
  "scope-restricted",
  "quality-upgraded",
  "quality-downgraded",
];
const CLAIM_OUTCOMES = ["survived", "overturned", "superseded"];

const STATUS_ORDER = ["unmapped", "scoping", "structural", "concerns", "adversarial", "mapped"];

const PASS_TYPES = ["onboarding", "survey", "adversarial", "refresh"];

// ---------------------------------------------------------------------------
// Output funnel. Nothing reaches stdout except through emit(), and everything is
// scrubbed of the launcher's crash signatures so that a genuine assertion
// failure is never mistaken for a gate that never ran.
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
}

function readJson(relPath) {
  const abs = join(REPO, relPath);
  if (!existsSync(abs)) return { text: null, value: null };
  let text = null;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return { text: null, value: null };
  }
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    return { text, value: null };
  }
}

function isHex(value, min, max) {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${min},${max}}$`).test(value);
}

import { historyIsComplete, resolveRevisions } from "./receipt-provenance.mjs";

function git(args) {
  return spawnSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function inTree(relPath) {
  if (typeof relPath !== "string" || !relPath || relPath.startsWith("/") || relPath.includes("..")) {
    return false;
  }
  return existsSync(join(REPO, relPath));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function statusRank(status) {
  if (status === "deferred") return -1;
  return STATUS_ORDER.indexOf(String(status ?? ""));
}

function pairKey(a, b) {
  return [a, b].sort().join(" ");
}

function qualityRank(kind) {
  return EVIDENCE_KINDS.indexOf(String(kind ?? ""));
}

// ---------------------------------------------------------------------------
// The two committed documents. The coverage receipt is P17's, and is what this
// packet's denominators are read from.
// ---------------------------------------------------------------------------
emit("the concern, adversarial and packaging passes, as recorded in the committed depth receipt");

const { text: receiptText, value: receipt } = readJson(RECEIPT_REL);
const { text: coverageText, value: coverage } = readJson(COVERAGE_REL);

function requireReceipt() {
  if (receiptText === null) {
    return `${RECEIPT_REL} is absent: the depth receipt records no terminal disposition, no adversarial outcome and no subsystem carried to mapped`;
  }
  if (receipt === null) return `${RECEIPT_REL} is not valid JSON, so the depth receipt cannot be read`;
  return null;
}

function requireCoverage() {
  if (coverageText === null) {
    return `${COVERAGE_REL} is absent: P17's coverage receipt is the denominator this packet is counted against`;
  }
  if (coverage === null) return `${COVERAGE_REL} is not valid JSON`;
  return null;
}

const rowsOf = () => (Array.isArray(receipt?.subsystems) ? receipt.subsystems : []);
const rowById = (id) => rowsOf().find((row) => row?.id === id) ?? null;
const seamsOf = () => (Array.isArray(receipt?.seams) ? receipt.seams : []);

/** P17's record of what was surveyed: the set this packet owes depth on. */
const coverageRows = () => (Array.isArray(coverage?.subsystems) ? coverage.subsystems : []);
const expectedMapped = () =>
  coverageRows()
    .filter((row) => statusRank(row?.status) >= statusRank("structural"))
    .map((row) => row.id);
const expectedDeferred = () =>
  coverageRows()
    .filter((row) => row?.status === "deferred")
    .map((row) => row.id);
/** The `<sid>/` claim keys P17 left current — Phase 4's target list (§9.1). */
const coverageClaimKeys = (sid) => {
  const row = coverageRows().find((entry) => entry?.id === sid);
  return (Array.isArray(row?.claims) ? row.claims : []).map((claim) => claim?.claim_key);
};
const coverageSeams = () => (Array.isArray(coverage?.seams) ? coverage.seams : []);

const dispositionsOf = (row) => (Array.isArray(row?.dispositions) ? row.dispositions : []);
const findingsOf = (row) => (Array.isArray(row?.findings) ? row.findings : []);
const gapsOf = (row) => (Array.isArray(row?.concern_gaps) ? row.concern_gaps : []);

check("the depth receipt declares its contract and binds itself to this repository and store", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  if (receipt.contract !== RECEIPT_CONTRACT) {
    return `the depth receipt declares ${JSON.stringify(receipt.contract ?? null)}, not ${RECEIPT_CONTRACT}`;
  }
  if (receipt.packet !== "P19") return `the depth receipt names packet ${JSON.stringify(receipt.packet ?? null)}`;
  const bound = resolveRevisions(REPO, [receipt.repository_sha], "the depth receipt's repository_sha");
  if (!isHex(receipt.repository_sha, 7, 40)) {
    return "the depth receipt does not bind itself to a repository revision";
  }
  if (bound) return bound;
  if (typeof receipt.storage_path !== "string" || !receipt.storage_path.endsWith("/.amanuensis")) {
    return `the depth receipt's storage path is not a workspace-local store: ${JSON.stringify(receipt.storage_path ?? null)}`;
  }
  if (
    typeof receipt.workspace_path !== "string" ||
    !receipt.storage_path.startsWith(`${receipt.workspace_path}/`)
  ) {
    return "the depth receipt's storage path does not sit inside the workspace it names";
  }
  if (!isHex(receipt.store?.last_checked_sha, 40, 40)) {
    return `the depth receipt records the store's last_checked_sha as ${JSON.stringify(receipt.store?.last_checked_sha ?? null)}, not a resolved commit`;
  }
  return null;
});

check("every subsystem row carries the store's last_checked_sha, and it resolves on this branch", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const expected = receipt.store?.last_checked_sha;
  const rows = rowsOf();
  if (!rows.length) return "the depth receipt records no subsystem";
  const disagreeing = rows.filter((row) => row?.last_checked_sha !== expected);
  if (disagreeing.length) {
    return `subsystem(s) ${disagreeing.map((row) => row.id).join(", ")} record a last_checked_sha other than the store's ${expected}`;
  }
  // Shallow used to be a note-and-pass here; it is RED now (F2/codex).
  return resolveRevisions(REPO, [expected], "the store's last_checked_sha");
});

check("every subsystem P17 carried to structural is mapped here, and nothing P17 deferred is", () => {
  const missing = requireReceipt() ?? requireCoverage();
  if (missing) return missing;
  const owed = expectedMapped();
  if (owed.length < 3) {
    return `P17's coverage receipt records ${owed.length} surveyed subsystem(s); the denominator this packet owes depth on is not credible`;
  }
  const present = rowsOf().map((row) => row?.id);
  const absent = owed.filter((id) => !present.includes(id));
  if (absent.length) {
    return `subsystem(s) ${absent.join(", ")} were surveyed to structural by P17 and have no row in the depth receipt`;
  }
  const unsurveyed = present.filter((id) => !owed.includes(id) && !expectedDeferred().includes(id));
  if (unsurveyed.length) {
    return `the depth receipt carries row(s) for ${unsurveyed.join(", ")}, which P17's coverage receipt does not record as surveyed`;
  }
  const short = owed.filter((id) => rowById(id)?.status !== "mapped");
  if (short.length) {
    return `subsystem(s) ${short.map((id) => `${id}=${rowById(id)?.status ?? "absent"}`).join(", ")} are not mapped: decision 4 asks for a rebuilt conspectus, not a structural survey`;
  }
  const deferredMapped = expectedDeferred().filter((id) => rowById(id) && rowById(id).status === "mapped");
  if (deferredMapped.length) {
    return `subsystem(s) ${deferredMapped.join(", ")} were deferred with a reason and are recorded as mapped anyway`;
  }
  return null;
});

check("each subsystem's status ladder climbs one rung at a time to mapped, through update_subsystem_status", () => {
  const missing = requireReceipt() ?? requireCoverage();
  if (missing) return missing;
  for (const id of expectedMapped()) {
    const row = rowById(id);
    const ladder = Array.isArray(row?.status_ladder) ? row.status_ladder : [];
    if (!ladder.length) return `${id} records no status ladder, so nothing says how it reached mapped`;
    const opened = coverageRows().find((entry) => entry?.id === id)?.status;
    if (ladder[0]?.from !== opened) {
      return `${id}'s ladder opens at ${JSON.stringify(ladder[0]?.from ?? null)}; P17 left it at ${JSON.stringify(opened ?? null)}`;
    }
    let previous = ladder[0].from;
    for (const step of ladder) {
      if (step?.from !== previous) {
        return `${id}'s ladder jumps from ${JSON.stringify(previous)} to a step recorded as leaving ${JSON.stringify(step?.from ?? null)}`;
      }
      if (statusRank(step?.to) !== statusRank(previous) + 1) {
        return `${id}'s ladder steps ${JSON.stringify(previous)} → ${JSON.stringify(step?.to ?? null)}, which is not the next rung of the survey progression`;
      }
      if (step?.tool !== "update_subsystem_status") {
        return `${id} reached ${JSON.stringify(step?.to ?? null)} through ${JSON.stringify(step?.tool ?? null)}; update_subsystem_status is the only route`;
      }
      if (!nonEmpty(step?.session_id)) return `${id}'s step to ${step?.to} is attributed to no session`;
      if (!isHex(step?.ref_sha, 7, 40)) return `${id}'s step to ${step?.to} is bound to no revision`;
      previous = step.to;
    }
    if (previous !== "mapped") return `${id}'s ladder ends at ${JSON.stringify(previous)}, not mapped`;
    // The two rungs the server itself gates. A ladder that claims them without
    // the record behind them is a ladder that could not have been climbed.
    if (!nonEmpty(row?.artifact?.path) || !isHex(row?.artifact?.content_hash, 64, 64)) {
      return `${id} advanced to concerns with no registered subsystem-survey artifact in the record`;
    }
    if (!dispositionsOf(row).length) {
      return `${id} advanced to adversarial with no disposition in the record`;
    }
  }
  return null;
});

check("every active concern has a terminal disposition in every non-deferred subsystem, or a named gap", () => {
  const missing = requireReceipt() ?? requireCoverage();
  if (missing) return missing;
  const declared = Array.isArray(receipt.checklist_concerns) ? receipt.checklist_concerns : [];
  const declaredCodes = declared.map((entry) => entry?.code);
  const dropped = CHECKLIST_CONCERNS.filter((code) => !declaredCodes.includes(code));
  if (dropped.length) {
    return `the depth receipt's checklist omits concern(s) ${dropped.join(", ")}, which onboarding calibrated as active`;
  }
  for (const id of expectedMapped()) {
    const row = rowById(id);
    const byCode = new Map(dispositionsOf(row).map((entry) => [entry?.concern_code, entry]));
    const gapCodes = new Set(gapsOf(row).map((entry) => entry?.concern_code));
    for (const code of CHECKLIST_CONCERNS) {
      const disposition = byCode.get(code);
      if (!disposition) {
        if (!gapCodes.has(code)) {
          return `${id} records no terminal disposition for concern ${code} and no open question naming the gap`;
        }
        const gap = gapsOf(row).find((entry) => entry?.concern_code === code);
        if (!Number.isInteger(gap?.open_question_id) || !nonEmpty(gap?.gap)) {
          return `${id}'s gap on concern ${code} names no open question id and no exact gap`;
        }
        continue;
      }
      if (!TERMINAL_CLASSIFICATIONS.includes(disposition.classification)) {
        return `${id}/${code} is classified ${JSON.stringify(disposition.classification ?? null)}, which is not a terminal state`;
      }
    }
    const denominator = row?.active_concern_denominator;
    if (denominator !== CHECKLIST_CONCERNS.length) {
      return `${id} counts its active-concern denominator as ${JSON.stringify(denominator ?? null)}; the calibrated checklist holds ${CHECKLIST_CONCERNS.length}`;
    }
    const terminal = dispositionsOf(row).filter(
      (entry) =>
        CHECKLIST_CONCERNS.includes(entry?.concern_code) &&
        TERMINAL_CLASSIFICATIONS.includes(entry?.classification),
    ).length;
    if (row?.terminal_dispositions !== terminal) {
      return `${id} reports ${JSON.stringify(row?.terminal_dispositions ?? null)} terminal disposition(s) and lists ${terminal}`;
    }
  }
  return null;
});

check("every disposition is evidence-backed at the quality it claims, and declares its linchpins", () => {
  const missing = requireReceipt() ?? requireCoverage();
  if (missing) return missing;
  let counted = 0;
  for (const id of expectedMapped()) {
    const row = rowById(id);
    for (const disposition of dispositionsOf(row)) {
      counted += 1;
      const label = `${id}/${disposition?.concern_code}`;
      if (!nonEmpty(disposition?.rationale)) return `${label} carries no rationale`;
      if (!PASS_TYPES.includes(disposition?.pass_type)) {
        return `${label} records pass_type ${JSON.stringify(disposition?.pass_type ?? null)}`;
      }
      if (!EVIDENCE_KINDS.includes(disposition?.evidence_quality)) {
        return `${label} claims evidence quality ${JSON.stringify(disposition?.evidence_quality ?? null)}, which is not on the ladder`;
      }
      if (typeof disposition?.linchpin_dependent !== "boolean") {
        return `${label} does not say whether it is linchpin-dependent`;
      }
      const evidence = Array.isArray(disposition?.evidence) ? disposition.evidence : [];
      if (!evidence.length) {
        return `${label} carries no attached evidence row, so the concern was answered from nothing`;
      }
      for (const entry of evidence) {
        if (!Number.isInteger(entry?.evidence_id)) return `${label} attaches an evidence row with no id`;
        if (!inTree(entry?.file_path)) {
          return `${label} cites ${JSON.stringify(entry?.file_path ?? null)}, which is not a file in this tree`;
        }
        if (!EVIDENCE_KINDS.includes(entry?.kind)) {
          return `${label} attaches evidence of kind ${JSON.stringify(entry?.kind ?? null)}`;
        }
        if (!isHex(entry?.ref_sha, 7, 40)) return `${label} attaches evidence bound to no revision`;
        if (!DISPOSITION_ROLES.includes(entry?.role)) {
          return `${label} attaches evidence in role ${JSON.stringify(entry?.role ?? null)}, outside {${DISPOSITION_ROLES.join(", ")}}`;
        }
      }
      // "evidence_quality — matches the strongest evidence row attached."
      // Claiming better than what is attached is the #1 way the methodology
      // fails, and it is mechanically checkable here.
      const strongest = Math.min(...evidence.map((entry) => qualityRank(entry?.kind)));
      if (qualityRank(disposition.evidence_quality) < strongest) {
        return `${label} claims ${disposition.evidence_quality} and its strongest attached row is ${EVIDENCE_KINDS[strongest]}`;
      }
      if (FRAGILE_KINDS.includes(disposition.evidence_quality) && !disposition.linchpin_dependent) {
        return `${label} rests on ${disposition.evidence_quality} evidence and does not declare itself linchpin-dependent`;
      }
      if (disposition.classification === "ruled-out" && !nonEmpty(disposition?.overturn_argument)) {
        return `${label} was ruled out and keeps no overturn argument, so nothing records what dismissed the concern`;
      }
    }
  }
  if (!counted) return "the depth receipt records no disposition at all";
  return null;
});

check("every finding was recorded through add_finding with attached evidence, and the counts reconcile", () => {
  const missing = requireReceipt() ?? requireCoverage();
  if (missing) return missing;
  const seen = new Set();
  for (const id of expectedMapped()) {
    const row = rowById(id);
    const findings = findingsOf(row);
    for (const finding of findings) {
      const fid = finding?.finding_id;
      if (typeof fid !== "string" || !new RegExp(`^${id.replace("-", "")}-\\d+$`).test(fid)) {
        return `${id} records finding ${JSON.stringify(fid ?? null)}, which does not follow <subsystem-id-compact>-<N>`;
      }
      if (seen.has(fid)) return `finding ${fid} is recorded twice`;
      seen.add(fid);
      if (finding?.recorded_via !== "add_finding") {
        return `finding ${fid} says it was recorded through ${JSON.stringify(finding?.recorded_via ?? null)}; add_finding is the only route`;
      }
      if (!SEVERITIES.includes(finding?.severity)) {
        return `finding ${fid} carries severity ${JSON.stringify(finding?.severity ?? null)}`;
      }
      if (!FINDING_STATUSES.includes(finding?.status)) {
        return `finding ${fid} carries status ${JSON.stringify(finding?.status ?? null)}`;
      }
      if (!RESOLUTION_STATES.includes(finding?.resolution_state)) {
        return `finding ${fid} carries resolution state ${JSON.stringify(finding?.resolution_state ?? null)}`;
      }
      if (!nonEmpty(finding?.symptom) || !nonEmpty(finding?.root_cause)) {
        return `finding ${fid} records no symptom or no root cause`;
      }
      if (!isHex(finding?.ref_sha, 7, 40)) return `finding ${fid} is bound to no revision`;
      const evidence = Array.isArray(finding?.evidence) ? finding.evidence : [];
      if (!evidence.length) return `finding ${fid} carries no attached evidence row`;
      for (const entry of evidence) {
        if (!Number.isInteger(entry?.evidence_id)) return `finding ${fid} attaches an evidence row with no id`;
        if (!inTree(entry?.file_path)) {
          return `finding ${fid} cites ${JSON.stringify(entry?.file_path ?? null)}, which is not a file in this tree`;
        }
        if (!FINDING_ROLES.includes(entry?.role)) {
          return `finding ${fid} attaches evidence in role ${JSON.stringify(entry?.role ?? null)}`;
        }
      }
    }
    const byState = row?.findings_by_state;
    if (!byState || typeof byState !== "object") {
      return `${id} records no findings-by-state rollup`;
    }
    const recomputed = {};
    for (const finding of findings) {
      recomputed[finding.resolution_state] = (recomputed[finding.resolution_state] ?? 0) + 1;
    }
    for (const state of RESOLUTION_STATES) {
      const declared = byState[state] ?? 0;
      const actual = recomputed[state] ?? 0;
      if (declared !== actual) {
        return `${id} reports ${declared} finding(s) at ${state} and lists ${actual}`;
      }
    }
    const stray = Object.keys(byState).filter((state) => !RESOLUTION_STATES.includes(state));
    if (stray.length) return `${id}'s findings-by-state rollup names state(s) ${stray.join(", ")}`;
  }
  return null;
});

check("a confirmed-bug disposition has a finding, and every finding names a disposition that confirms it", () => {
  const missing = requireReceipt() ?? requireCoverage();
  if (missing) return missing;
  for (const id of expectedMapped()) {
    const row = rowById(id);
    const confirmed = dispositionsOf(row)
      .filter((entry) => entry?.classification === "confirmed-bug")
      .map((entry) => entry.concern_code);
    const findings = findingsOf(row);
    const covered = new Set(findings.map((finding) => finding?.concern_code));
    const orphanConcerns = confirmed.filter((code) => !covered.has(code));
    if (orphanConcerns.length) {
      return `${id} classified concern(s) ${orphanConcerns.join(", ")} as confirmed-bug and recorded no finding for them`;
    }
    const codes = new Set(dispositionsOf(row).map((entry) => entry?.concern_code));
    for (const finding of findings) {
      if (!codes.has(finding?.concern_code)) {
        return `finding ${finding?.finding_id} names concern ${JSON.stringify(finding?.concern_code ?? null)}, which has no disposition on ${id}`;
      }
      const disposition = dispositionsOf(row).find((entry) => entry?.concern_code === finding.concern_code);
      // A finding still standing as a confirmed bug against a concern its own
      // subsystem ruled out is the contradiction the methodology exists to
      // surface, not a rollup to smooth over.
      if (finding.status === "confirmed-bug" && disposition.classification !== "confirmed-bug") {
        return `finding ${finding.finding_id} stands as a confirmed bug while ${id}/${finding.concern_code} is ${disposition.classification}`;
      }
    }
  }
  return null;
});

check("every subsystem ran an adversarial pass over every claim P17 left current (§9.1, Phase 4)", () => {
  const missing = requireReceipt() ?? requireCoverage();
  if (missing) return missing;
  for (const id of expectedMapped()) {
    const row = rowById(id);
    const adversarial = row?.adversarial;
    if (!adversarial || typeof adversarial !== "object") return `${id} records no adversarial pass`;
    if (!Number.isInteger(adversarial.passes) || adversarial.passes < 1) {
      return `${id} records ${JSON.stringify(adversarial.passes ?? null)} adversarial pass(es); mapped would then imply a review that did not happen`;
    }
    const targets = Array.isArray(adversarial.claim_targets) ? adversarial.claim_targets : [];
    const owed = coverageClaimKeys(id);
    if (!owed.length) return `P17's coverage receipt records no claim for ${id}, so Phase 4 has no target list`;
    const targeted = targets.map((entry) => entry?.claim_key);
    const unchallenged = owed.filter((key) => !targeted.includes(key));
    if (unchallenged.length) {
      return `claim(s) ${unchallenged.join(", ")} carry no adversarial outcome, so ${id}'s structural account was published unchallenged`;
    }
    const unknown = targeted.filter((key) => !owed.includes(key));
    if (unknown.length) {
      return `${id} records an outcome for ${unknown.join(", ")}, which P17's coverage receipt does not hold as a current claim`;
    }
    for (const target of targets) {
      if (!CLAIM_OUTCOMES.includes(target?.outcome)) {
        return `claim ${target?.claim_key} carries outcome ${JSON.stringify(target?.outcome ?? null)}, outside {${CLAIM_OUTCOMES.join(", ")}}`;
      }
      if (!nonEmpty(target?.challenge)) {
        return `claim ${target?.claim_key} records no challenge, so nothing says what would have overturned it or where that was looked for`;
      }
      // A `survived` outcome changes no row, so it is indistinguishable from a
      // claim nobody looked at unless the record says where it was written down.
      if (!nonEmpty(target?.record)) {
        return `claim ${target?.claim_key} records outcome ${target.outcome} with no durable record of it`;
      }
      if (target.outcome === "survived" && !/^field-note:\d+$/.test(String(target.record))) {
        return `claim ${target.claim_key} survived and its record is ${JSON.stringify(target.record)}, not a field note id`;
      }
      if (target.outcome !== "survived" && !/^claim-validity-event:\d+$/.test(String(target.record))) {
        return `claim ${target.claim_key} was ${target.outcome} and its record is ${JSON.stringify(target.record)}, not a claim validity event`;
      }
    }
    const outcomes = adversarial.outcomes ?? {};
    for (const outcome of CLAIM_OUTCOMES) {
      const declared = outcomes[outcome] ?? 0;
      const actual = targets.filter((entry) => entry.outcome === outcome).length;
      if (declared !== actual) {
        return `${id} reports ${declared} claim(s) ${outcome} and lists ${actual}`;
      }
    }
    const verdicts = Array.isArray(adversarial.finding_verdicts) ? adversarial.finding_verdicts : [];
    const verdictIds = verdicts.map((entry) => entry?.finding_id);
    for (const finding of findingsOf(row)) {
      if (!verdictIds.includes(finding.finding_id)) {
        return `finding ${finding.finding_id} was not challenged in ${id}'s adversarial pass`;
      }
    }
    for (const verdict of verdicts) {
      if (!FINDING_VERDICTS.includes(verdict?.verdict)) {
        return `finding ${verdict?.finding_id} carries verdict ${JSON.stringify(verdict?.verdict ?? null)}`;
      }
      if (!nonEmpty(verdict?.claim_b)) {
        return `finding ${verdict?.finding_id}'s adversarial entry records no counter-claim`;
      }
      const finding = findingsOf(row).find((entry) => entry.finding_id === verdict.finding_id);
      if (!finding) return `${id}'s adversarial pass names finding ${verdict?.finding_id}, which it does not record`;
      if (verdict.verdict === "overturned") {
        if (finding.status !== "ruled-out") {
          return `finding ${finding.finding_id} was overturned and still stands at ${finding.status}`;
        }
        const compensating = (Array.isArray(finding.evidence) ? finding.evidence : []).filter(
          (entry) => entry?.role === "compensating",
        );
        if (!compensating.length) {
          return `finding ${finding.finding_id} was overturned with no compensating evidence attached; overturning requires evidence, not vibes`;
        }
      }
    }
    // A linchpin-dependent disposition is a Phase 4 target on the same terms as
    // a finding: Phase 3 flagged it precisely so Phase 4 would try to upgrade it.
    const linchpins = dispositionsOf(row)
      .filter((entry) => entry?.linchpin_dependent === true)
      .map((entry) => entry.concern_code);
    const probed = (Array.isArray(adversarial.disposition_targets) ? adversarial.disposition_targets : []).map(
      (entry) => entry?.concern_code,
    );
    const unprobed = linchpins.filter((code) => !probed.includes(code));
    if (unprobed.length) {
      return `${id} left linchpin-dependent disposition(s) ${unprobed.join(", ")} unprobed by the adversarial pass`;
    }
    for (const target of Array.isArray(adversarial.disposition_targets) ? adversarial.disposition_targets : []) {
      if (!FINDING_VERDICTS.includes(target?.verdict)) {
        return `${id}/${target?.concern_code} carries adversarial verdict ${JSON.stringify(target?.verdict ?? null)}`;
      }
      if (!nonEmpty(target?.claim_b)) {
        return `${id}/${target?.concern_code} records no counter-claim for its adversarial probe`;
      }
    }
  }
  return null;
});

check("every seam whose two parties are both mapped carries an SC disposition on both sides", () => {
  const missing = requireReceipt() ?? requireCoverage();
  if (missing) return missing;
  const mapped = new Set(expectedMapped().filter((id) => rowById(id)?.status === "mapped"));
  const owed = coverageSeams().filter(
    (seam) => seam?.party_a !== seam?.party_b && mapped.has(seam?.party_a) && mapped.has(seam?.party_b),
  );
  if (!owed.length) {
    return "P17's coverage receipt records no seam between two mapped subsystems, so seam assessment has no denominator";
  }
  const recorded = new Map(seamsOf().map((seam) => [seam?.id, seam]));
  for (const seam of owed) {
    const entry = recorded.get(seam.id);
    if (!entry) return `seam ${seam.id} (${seam.party_a}↔${seam.party_b}) has both parties mapped and no seam assessment`;
    if (entry.assessable !== true) {
      return `seam ${seam.id} has both parties mapped and is recorded as not assessable`;
    }
    if (!/^SC-\d+$/.test(String(entry.concern_code ?? ""))) {
      return `seam ${seam.id} carries concern code ${JSON.stringify(entry.concern_code ?? null)}, not an SC-N seam concern`;
    }
    if (!nonEmpty(entry.notes)) return `seam ${seam.id} records no assessment in its notes`;
    const sides = Array.isArray(entry.dispositions) ? entry.dispositions : [];
    for (const party of [seam.party_a, seam.party_b]) {
      const side = sides.find((row) => row?.subsystem_id === party);
      if (!side) return `seam ${seam.id} carries no SC disposition on ${party}; both parties are assessed or neither is`;
      if (!TERMINAL_CLASSIFICATIONS.includes(side.classification)) {
        return `seam ${seam.id} on ${party} is classified ${JSON.stringify(side.classification ?? null)}`;
      }
      if (side.concern_code !== entry.concern_code) {
        return `seam ${seam.id} on ${party} is filed under ${JSON.stringify(side.concern_code ?? null)}, not the seam's own ${entry.concern_code}`;
      }
      if (side.pass_type !== "adversarial") {
        return `seam ${seam.id} on ${party} was written as a ${JSON.stringify(side.pass_type ?? null)} pass; seam assessment is adversarial`;
      }
      const evidence = Array.isArray(side.evidence) ? side.evidence : [];
      if (!evidence.length) return `seam ${seam.id} on ${party} carries no evidence from that side`;
      for (const row of evidence) {
        if (!inTree(row?.file_path)) {
          return `seam ${seam.id} on ${party} cites ${JSON.stringify(row?.file_path ?? null)}, which is not a file in this tree`;
        }
      }
    }
  }
  return null;
});

check("the batches ran in priority order, each behind its own storage checkpoint", () => {
  const missing = requireReceipt() ?? requireCoverage();
  if (missing) return missing;
  const batches = Array.isArray(receipt.batches) ? receipt.batches : [];
  if (!batches.length) return "the depth pass records no batch, so a failure resumes from the start";
  const history = Array.isArray(receipt.storage_history) ? receipt.storage_history : [];
  if (!history.length) return "the depth receipt carries no storage history, so no checkpoint can be found in it";
  const priority = new Map(coverageRows().map((row) => [row?.id, row?.priority]));
  const seen = [];
  let previousHigh = 0;
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    if (batch?.n !== index + 1) {
      return `batch ${index + 1} is numbered ${JSON.stringify(batch?.n ?? null)}; batches are consecutive from 1`;
    }
    const ids = Array.isArray(batch?.subsystems) ? batch.subsystems : [];
    if (ids.length) {
      const ranks = ids.map((id) => priority.get(id));
      if (ranks.some((rank) => !Number.isInteger(rank))) return `batch ${batch.n} names a subsystem with no priority`;
      const low = Math.min(...ranks);
      if (low < previousHigh) {
        return `batch ${batch.n} carried priority ${low} after batch ${index} reached priority ${previousHigh}: the batches did not run in priority order`;
      }
      previousHigh = Math.max(...ranks);
      seen.push(...ids);
    } else if (batch?.kind !== "seam-assessment") {
      return `batch ${JSON.stringify(batch?.n ?? null)} carried no subsystem and is not the seam-assessment pass`;
    }
    if (!isHex(batch?.storage_commit, 7, 40)) {
      return `batch ${batch.n} records no checkpoint commit, so a failure there resumes from the start`;
    }
    const commit = history.find(
      (entry) =>
        typeof entry?.sha === "string" &&
        (entry.sha.startsWith(batch.storage_commit) || batch.storage_commit.startsWith(entry.sha)),
    );
    if (!commit) return `batch ${batch.n}'s checkpoint ${batch.storage_commit} is not in the storage history`;
    if (String(commit.message ?? "") !== String(batch.label ?? " ")) {
      return `batch ${batch.n}'s checkpoint commit says ${JSON.stringify(commit.message ?? null)}, not the batch label ${JSON.stringify(batch.label ?? null)}`;
    }
    for (const id of ids) {
      if (!String(batch.label ?? "").includes(id)) {
        return `batch ${batch.n}'s checkpoint label does not name ${id}, so the checkpoint does not say what it covers`;
      }
    }
  }
  const duplicated = seen.filter((id, index) => seen.indexOf(id) !== index);
  if (duplicated.length) return `subsystem(s) ${[...new Set(duplicated)].join(", ")} were carried in more than one batch`;
  const uncarried = expectedMapped().filter((id) => !seen.includes(id));
  if (uncarried.length) return `subsystem(s) ${uncarried.join(", ")} are mapped and in no batch`;
  return null;
});

// ---------------------------------------------------------------------------
// The live store, when one is present. Read-only and direct: the gate must not
// write to the store it is judging, and must not need a built server to judge it.
// ---------------------------------------------------------------------------
emit("");

const storeAbs = join(REPO, STORE_REL);
let live = null;
let liveError = null;
if (existsSync(storeAbs)) {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(storeAbs, { readOnly: true });
    const all = (sql) => db.prepare(sql).all();
    live = {
      subsystems: all("SELECT id, status FROM subsystems"),
      concerns: all("SELECT code, status FROM concerns"),
      dispositions: all(
        "SELECT subsystem_id, concern_code, classification, evidence_quality, linchpin_dependent, pass_type FROM dispositions",
      ),
      dispositionEvidence: all(
        "SELECT subsystem_id, concern_code, evidence_id, role FROM disposition_evidence",
      ),
      findings: all("SELECT finding_id, subsystem_id, severity, status FROM findings"),
      findingEvidence: all("SELECT finding_id, evidence_id, role FROM finding_evidence"),
      findingState: all("SELECT finding_id, resolution_state FROM finding_state_current"),
      claims: all("SELECT claim_id, claim_key FROM claims WHERE valid_until_sha IS NULL"),
      claimEvents: all("SELECT claim_id, event_type FROM claim_validity_events"),
      fieldNotes: all("SELECT id, observation FROM field_notes"),
      seams: all("SELECT id, party_a, party_b, notes FROM seams"),
    };
    db.close();
  } catch (e) {
    liveError = e && e.message ? e.message : String(e);
  }
  if (live) emit("the live store at .amanuensis/memory.db, read directly and read-only");
  else emit("the live store at .amanuensis/memory.db could not be opened");
} else {
  emit(
    "the live store is absent here (`git ls-files .amanuensis` → 0), so the committed depth receipt is the whole gate; this is the mode CI runs in",
  );
}

if (existsSync(storeAbs)) {
  check("the live store opens for reading", () => liveError ?? (live ? null : "the store yielded no rows"));

  check("every subsystem the depth receipt maps is mapped in the live store", () => {
    if (!live) return "the live store could not be read";
    const missing = requireReceipt() ?? requireCoverage();
    if (missing) return missing;
    const byId = new Map(live.subsystems.map((row) => [row.id, row.status]));
    const short = expectedMapped().filter((id) => byId.get(id) !== "mapped");
    if (short.length) {
      return `subsystem(s) ${short.map((id) => `${id}=${byId.get(id) ?? "absent"}`).join(", ")} are mapped in the receipt and not in the live store`;
    }
    return null;
  });

  check("the live store holds an evidence-backed terminal disposition for every concern in every mapped subsystem", () => {
    if (!live) return "the live store could not be read";
    const missing = requireReceipt() ?? requireCoverage();
    if (missing) return missing;
    const byPair = new Map(
      live.dispositions.map((row) => [`${row.subsystem_id}/${row.concern_code}`, row]),
    );
    const evidenceCount = new Map();
    for (const row of live.dispositionEvidence) {
      const key = `${row.subsystem_id}/${row.concern_code}`;
      evidenceCount.set(key, (evidenceCount.get(key) ?? 0) + 1);
    }
    for (const id of expectedMapped()) {
      const row = rowById(id);
      const gapCodes = new Set(gapsOf(row).map((entry) => entry?.concern_code));
      for (const code of CHECKLIST_CONCERNS) {
        const key = `${id}/${code}`;
        const disposition = byPair.get(key);
        if (!disposition) {
          if (gapCodes.has(code)) continue;
          return `the live store holds no disposition for ${key}`;
        }
        if (!TERMINAL_CLASSIFICATIONS.includes(disposition.classification)) {
          return `the live store classifies ${key} as ${JSON.stringify(disposition.classification)}`;
        }
        if (!(evidenceCount.get(key) > 0)) {
          return `the live store attaches no evidence to ${key}`;
        }
        const recorded = dispositionsOf(row).find((entry) => entry?.concern_code === code);
        if (recorded && recorded.classification !== disposition.classification) {
          return `${key} is ${disposition.classification} in the live store and ${recorded.classification} in the receipt`;
        }
      }
    }
    return null;
  });

  check("every finding in the live store carries evidence, and the receipt records the same set", () => {
    if (!live) return "the live store could not be read";
    const missing = requireReceipt() ?? requireCoverage();
    if (missing) return missing;
    const evidenceCount = new Map();
    for (const row of live.findingEvidence) {
      evidenceCount.set(row.finding_id, (evidenceCount.get(row.finding_id) ?? 0) + 1);
    }
    const stateById = new Map(live.findingState.map((row) => [row.finding_id, row.resolution_state]));
    const recorded = new Map();
    for (const id of expectedMapped()) {
      for (const finding of findingsOf(rowById(id))) recorded.set(finding.finding_id, finding);
    }
    for (const row of live.findings) {
      if (!(evidenceCount.get(row.finding_id) > 0)) {
        return `live finding ${row.finding_id} carries no attached evidence`;
      }
      const entry = recorded.get(row.finding_id);
      if (!entry) return `live finding ${row.finding_id} is not in the depth receipt`;
      if (entry.status !== row.status || entry.severity !== row.severity) {
        return `live finding ${row.finding_id} is ${row.severity}/${row.status}; the receipt says ${entry.severity}/${entry.status}`;
      }
      const state = stateById.get(row.finding_id);
      if (entry.resolution_state !== state) {
        return `live finding ${row.finding_id} resolves as ${JSON.stringify(state ?? null)}; the receipt says ${JSON.stringify(entry.resolution_state)}`;
      }
    }
    const lost = [...recorded.keys()].filter(
      (fid) => !live.findings.some((row) => row.finding_id === fid),
    );
    if (lost.length) return `finding(s) ${lost.join(", ")} are in the receipt and not in the live store`;
    return null;
  });

  check("every current <sid>/ claim in the live store carries a recorded adversarial outcome", () => {
    if (!live) return "the live store could not be read";
    const missing = requireReceipt() ?? requireCoverage();
    if (missing) return missing;
    const challenged = new Set();
    for (const note of live.fieldNotes) {
      const match = /adversarial probe for claim ([^\s]+)/.exec(String(note.observation ?? ""));
      if (match) challenged.add(match[1]);
    }
    const eventClaims = new Set(
      live.claimEvents.filter((row) => row.event_type !== "asserted").map((row) => row.claim_id),
    );
    const mapped = new Set(expectedMapped());
    for (const claim of live.claims) {
      const sid = String(claim.claim_key).split("/")[0];
      if (!mapped.has(sid)) continue;
      if (challenged.has(claim.claim_key) || eventClaims.has(claim.claim_id)) continue;
      return `live claim ${claim.claim_key} is current in a mapped subsystem with no adversarial outcome recorded against it`;
    }
    return null;
  });

  check("every assessable seam carries its SC disposition on both sides in the live store", () => {
    if (!live) return "the live store could not be read";
    const missing = requireReceipt() ?? requireCoverage();
    if (missing) return missing;
    const mapped = new Set(
      live.subsystems.filter((row) => row.status === "mapped").map((row) => row.id),
    );
    const byPair = new Set(
      live.dispositions.map((row) => `${row.subsystem_id}/${row.concern_code}`),
    );
    const recorded = new Map(seamsOf().map((seam) => [seam?.id, seam]));
    for (const seam of live.seams) {
      if (seam.party_a === seam.party_b) continue;
      if (!mapped.has(seam.party_a) || !mapped.has(seam.party_b)) continue;
      const entry = recorded.get(seam.id);
      if (!entry) return `live seam ${seam.id} is assessable and has no assessment in the depth receipt`;
      for (const party of [seam.party_a, seam.party_b]) {
        if (!byPair.has(`${party}/${entry.concern_code}`)) {
          return `the live store holds no ${entry.concern_code} disposition on ${party} for seam ${seam.id}`;
        }
      }
      if (!nonEmpty(seam.notes)) return `live seam ${seam.id} was assessed and records nothing in its notes`;
    }
    // A seam assessment the receipt claims and the store does not hold is the
    // same defect read from the other end.
    const pairs = new Set(live.seams.map((seam) => pairKey(seam.party_a, seam.party_b)));
    for (const seam of seamsOf()) {
      if (!pairs.has(pairKey(seam?.party_a, seam?.party_b))) {
        return `the depth receipt assesses seam ${seam?.id} (${seam?.party_a}↔${seam?.party_b}), which the live store does not hold`;
      }
    }
    return null;
  });

  check("the live store's concern checklist still holds every calibrated concern as active", () => {
    if (!live) return "the live store could not be read";
    const active = new Set(live.concerns.filter((row) => row.status === "active").map((row) => row.code));
    const retired = CHECKLIST_CONCERNS.filter((code) => !active.has(code));
    if (retired.length) {
      return `concern(s) ${retired.join(", ")} are no longer active in the live store; retiring a concern shrinks the denominator this gate counts against`;
    }
    return null;
  });
}

emit("");
check("the gate runs in CI", () => {
  const ci = existsSync(join(REPO, CI_REL)) ? readFileSync(join(REPO, CI_REL), "utf8") : null;
  if (ci === null) return `${CI_REL} is absent`;
  return ci.includes(GATE_COMMAND) ? null : "the gate is not run in CI";
});

emit("");
if (failures.length) {
  emit(
    `GATE P19 RED: the rebuilt self-conspectus is not mapped through concerns, adversarial review and packaging — ${failures.length} failed assertion(s) over the depth receipt, covering the status ladder, the terminal disposition of every active concern, the adversarial outcome of every claim and finding, and seam assessment on both sides; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("GATE P19 GREEN");
