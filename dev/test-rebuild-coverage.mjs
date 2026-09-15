#!/usr/bin/env node
// Gate for reader-lenses packet P17 — the self-conspectus rebuilt through the
// skill with a claims-backed Phase 2 (spec.md §12.1 step 6, §9.1, §9.2;
// claims C52, C42, C43, C45, C55, C63).
//
// Two arms, for the reason P16's gate has two. The *rebuild* is a past event
// over a store that is untracked — `git ls-files .amanuensis` returns 0 — so a
// gate that only read the store would be green by absence in CI and in the
// launcher's verification worktree, which is the zero-denominator failure this
// repository has already recorded three times (VP4). The rebuild is therefore
// recorded in a committed receipt and asserted over there. The *live store*, when
// one is present, is then read directly and read-only, and must satisfy the same
// invariants: a receipt nobody can contradict is a claim about a claim.
//
// Turns red when:
//   - `design/reader-lenses/rebuild-coverage-receipt.json` is absent or does not
//     record a subsystem decomposition, its claims, and its edges;
//   - onboarding did not record the repository boundary — a canonical branch, an
//     onboarding revision, `.amanuensis` excluded from the scan, and the six
//     onboarding artifacts each hashed;
//   - the decomposition is not what was surveyed: a subsystem appears in no
//     batch, in two batches, or in no receipt row, or the priorities are not
//     dense ranks from 1;
//   - the batches did not run in priority order, or a batch has no checkpoint
//     commit in the storage history under its own label — without which a
//     failure resumes from the start rather than from the last batch;
//   - a subsystem that reached `structural` carries no current claim whose
//     `claim_key` begins `<sid>/` (§9.1's prerequisite), or one that did not
//     reach it carries no reason for stopping;
//   - a `key-type`, `state-container` or `flow` claim's evidence is all outside
//     {code-verified, contract-stated}, or none of it cites the file named in
//     `subject_id`, or the `claim_key`'s slug is not the slug of `subject_id`,
//     or a cited file is not in the tree — §9.1's two subtractive checks,
//     re-run over the record rather than trusted from it;
//   - an edge carries no citation token matching §9.2's grammar, or its token's
//     path is not in the tree, or its `relationship` is not a crossing;
//   - a seam between two different subsystems has no edge between those two
//     subsystems, or a `structural` subsystem is in no edge and records no
//     reason for being isolated (GP24: fan-in asserts completeness);
//   - the live store, when present, breaks any of those invariants, or has lost
//     a subsystem, a claim or an edge the receipt records;
//   - the gate does not run in `.github/workflows/test.yml`.
//
// False greens it cannot exclude. A claim's *truth* is not checked here and
// cannot be: the record can require that a key type be read off the file it
// names, not that the reading was right. That is the adversarial pass's job
// (§9.1, Phase 4), which this packet does not run. Nor does a well-formed edge
// prove the crossing exists — symbol reachability is deliberately unchecked
// (§9.2), so a citation records where an edge was read, not a symbol the server
// confirmed. Coverage of *every* crossing cannot be established at all: the
// denominator is what the survey saw, so this gate can catch a seam with no
// edge and cannot catch a crossing nobody read. And a receipt proves what was
// true when it was written; the live arm narrows that window only where a store
// exists to read.
//
// Output protocol: exactly one status line, last, on stdout. Every message is
// scrubbed of the launcher's crash signatures, so an absent deliverable reads as
// a failed assertion rather than as a gate that never ran.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { historyIsComplete, resolveRevisions } from "./receipt-provenance.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const RECEIPT_REL = "design/reader-lenses/rebuild-coverage-receipt.json";
const CI_REL = ".github/workflows/test.yml";
const GATE_COMMAND = "node dev/test-rebuild-coverage.mjs";
const STORE_REL = ".amanuensis/memory.db";

const RECEIPT_CONTRACT = "amanuensis-reader-lenses/rebuild-coverage-receipt/v1";

// §12.1 step 6 rebuilds through the skill, and onboarding Phase 7 names exactly
// these artifacts. Written out rather than read from the reference so that
// dropping one from onboarding cannot also drop it from what this expects.
const ONBOARDING_ARTIFACTS = [
  "onboarding-report.md",
  "concern-checklist.md",
  "master-plan.md",
  "findings-index.md",
  "entry-point.md",
  "field-notes.md",
];

// §9.1's three file-anchored categories and the evidence kinds they accept.
const FILE_ANCHORED = ["key-type", "state-container", "flow"];
const STRONG_EVIDENCE = ["code-verified", "contract-stated"];

// §9.2: an edge recorded because it crosses a subsystem boundary is one of these.
const CROSSING_RELATIONSHIPS = ["data-flow", "dependency"];
const STRENGTHS = ["observed", "confirmed", "structural"];

// §9.2's citation grammar, applied to one whitespace-delimited token.
const CITATION_TOKEN = /^[^\s:]+(?:\/[^\s:]+)*:[^\s@]+@[0-9a-fA-F]{7,40}$/;

const STATUS_ORDER = [
  "unmapped",
  "scoping",
  "structural",
  "concerns",
  "adversarial",
  "mapped",
];

// §12.3's immutable A0 historical fixture. The rebuild changes the live store
// and `docs/`; these are never rewritten.
const FIXTURES = [
  "dev/conspectus/self-baseline.json",
  "dev/conspectus/baseline-report.json",
  "dev/conspectus/baseline-report-detector-1.0.0.json",
  "dev/conspectus/detector-registry.json",
];

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

function readText(absPath) {
  if (!existsSync(absPath)) return null;
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

function sha256(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

function isHex(value, min, max) {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${min},${max}}$`).test(value);
}

function git(args) {
  return spawnSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** §2.1's symbol split: the path is everything before the first colon. */
function subjectPath(subjectId) {
  const at = String(subjectId ?? "").indexOf(":");
  return at < 0 ? String(subjectId ?? "") : String(subjectId).slice(0, at);
}

/**
 * phase-2-structural.md's `<symbol-slug>`: the whole `<path>:<symbol>` pair
 * lowercased with non-alphanumeric runs collapsed to `-`. Recomputed here
 * rather than trusted, because a slug built from the symbol alone is what made
 * two `Config` types collide and silently shortened a subsystem's inventory by
 * one (slice-S3, F9/codex).
 */
function symbolSlug(subjectId) {
  return String(subjectId ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * phase-2-structural.md's two file-anchored key shapes. A key type and a state
 * container are one symbol each, so their key is the subject's own slug and the
 * unique index on `claim_key` makes the next reading supersede this one. A flow
 * step is `<sid>/flow/<flow-slug>/<nn>`: several steps of one flow share a slug
 * and are ordered by the number, so the subject's slug is not the key and
 * requiring it would refuse every flow after the first.
 */
function keyShapeFailure(sid, category, key, subjectId) {
  if (category === "flow") {
    return new RegExp(`^${sid}/flow/[a-z0-9]+(?:-[a-z0-9]+)*/[0-9]{2,}$`).test(key)
      ? null
      : `claim ${key} is a flow step whose key is not <sid>/flow/<flow-slug>/<nn>, so its steps have no recorded order`;
  }
  const expected = `${sid}/${category}/${symbolSlug(subjectId)}`;
  return key === expected
    ? null
    : `claim ${key} names subject ${subjectId}, whose stable key is ${expected}; an unstable key duplicates rather than supersedes`;
}

/** Files are checked against the tree, so a cited path that moved turns red. */
function inTree(relPath) {
  if (typeof relPath !== "string" || !relPath || relPath.startsWith("/") || relPath.includes("..")) {
    return false;
  }
  return existsSync(join(REPO, relPath));
}

function citationTokens(context) {
  return String(context ?? "")
    .split(/\s+/)
    .filter((token) => CITATION_TOKEN.test(token));
}

/**
 * `deferred` is orthogonal to the progression (`update_subsystem_status`'s own
 * words) — it is a subsystem the survey decided not to walk. It ranks at the
 * bottom so it can never satisfy `structural`, and it is a recognised status so
 * that a deferral is read as a decision that owes a reason, not as a corrupt row.
 */
function statusRank(status) {
  if (status === "deferred") return 0;
  return STATUS_ORDER.indexOf(String(status ?? ""));
}

function isKnownStatus(status) {
  return status === "deferred" || STATUS_ORDER.includes(String(status ?? ""));
}

function pairKey(a, b) {
  return [a, b].sort().join("\0");
}

// ---------------------------------------------------------------------------
// The receipt.
// ---------------------------------------------------------------------------
emit("the rebuild, as recorded in the committed coverage receipt");

const receiptText = readText(join(REPO, RECEIPT_REL));
let receipt = null;
if (receiptText !== null) {
  try {
    receipt = JSON.parse(receiptText);
  } catch {
    receipt = null;
  }
}

function requireReceipt() {
  if (receiptText === null) {
    return `${RECEIPT_REL} is absent: no subsystem decomposition, no claim, and no edge is recorded for the rebuild`;
  }
  if (receipt === null) return `${RECEIPT_REL} is not valid JSON`;
  return null;
}

const subsystemsOf = () => (Array.isArray(receipt?.subsystems) ? receipt.subsystems : []);
const decompositionOf = () =>
  Array.isArray(receipt?.onboarding?.decomposition) ? receipt.onboarding.decomposition : [];
const batchesOf = () => (Array.isArray(receipt?.batches) ? receipt.batches : []);
const xrefsOf = () => (Array.isArray(receipt?.xrefs) ? receipt.xrefs : []);
const seamsOf = () => (Array.isArray(receipt?.seams) ? receipt.seams : []);
const surveyed = () => subsystemsOf().filter((row) => statusRank(row?.status) >= statusRank("structural"));

check("the receipt declares its contract and binds itself to this repository", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  if (receipt.contract !== RECEIPT_CONTRACT) {
    return `the receipt declares ${JSON.stringify(receipt.contract ?? null)}, not ${RECEIPT_CONTRACT}`;
  }
  if (receipt.packet !== "P17") return `the receipt names packet ${JSON.stringify(receipt.packet ?? null)}`;
  if (!isHex(receipt.repository_sha, 7, 40)) {
    return "the receipt does not bind itself to a repository revision";
  }
  if (typeof receipt.storage_path !== "string" || !receipt.storage_path.endsWith("/.amanuensis")) {
    return `the receipt's storage path is not a workspace-local store: ${JSON.stringify(receipt.storage_path ?? null)}`;
  }
  if (
    typeof receipt.workspace_path !== "string" ||
    !receipt.storage_path.startsWith(`${receipt.workspace_path}/`)
  ) {
    return "the receipt's storage path does not sit inside the workspace it names";
  }
  return null;
});

check("onboarding recorded the repository boundary", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const onboarding = receipt.onboarding;
  if (!onboarding || typeof onboarding !== "object") return "the receipt records no onboarding pass";
  if (typeof onboarding.session_id !== "string" || !onboarding.session_id.trim()) {
    return "the onboarding pass is not attributed to a session";
  }
  if (!isHex(onboarding.onboarding_sha, 40, 40)) {
    return `the onboarding revision is ${JSON.stringify(onboarding.onboarding_sha ?? null)}, not a resolved commit`;
  }
  if (typeof onboarding.canonical_branch !== "string" || !onboarding.canonical_branch.trim()) {
    return "no canonical branch was recorded, so the boundary has no branch";
  }
  const boundary = onboarding.boundary ?? {};
  const excluded = Array.isArray(boundary.excluded_paths) ? boundary.excluded_paths : [];
  if (!excluded.includes(".amanuensis")) {
    return "the repository boundary does not exclude .amanuensis, which is Amanuensis's own state and not evidence about the system";
  }
  if (!Number.isInteger(boundary.tracked_files) || boundary.tracked_files <= 0) {
    return "the repository boundary records no tracked-file count";
  }
  return null;
});

check("onboarding registered its six artifacts, each hashed", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const rows = Array.isArray(receipt.onboarding?.artifacts) ? receipt.onboarding.artifacts : [];
  const byPath = new Map(rows.map((row) => [row?.path, row]));
  const absent = ONBOARDING_ARTIFACTS.filter((path) => !byPath.has(path));
  if (absent.length) return `onboarding recorded no artifact for ${absent.join(", ")}`;
  const unhashed = ONBOARDING_ARTIFACTS.filter((path) => {
    const row = byPath.get(path);
    return !isHex(row?.content_hash, 64, 64) || !Number.isInteger(row?.bytes) || row.bytes <= 0;
  });
  if (unhashed.length) return `onboarding recorded no content hash and size for ${unhashed.join(", ")}`;
  return null;
});

check("the initial decomposition is a ranked set of subsystems", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const rows = decompositionOf();
  if (rows.length < 3) {
    return `the decomposition holds ${rows.length} subsystem(s); onboarding Phase 5 enumerates the subsystems of the repository, not a placeholder`;
  }
  const ids = rows.map((row) => row?.id);
  if (ids.some((id) => typeof id !== "string" || !id.trim())) return "a decomposition row has no subsystem id";
  if (new Set(ids).size !== ids.length) return "the decomposition repeats a subsystem id";
  const unnamed = rows.filter((row) => !String(row?.name ?? "").trim() || !String(row?.layer ?? "").trim());
  if (unnamed.length) {
    return `${unnamed.length} decomposition row(s) carry no name or no layer`;
  }
  const priorities = rows.map((row) => row?.priority);
  if (priorities.some((p) => !Number.isInteger(p) || p < 1)) {
    return "a subsystem carries no survey priority, so 'priority order' has no meaning";
  }
  const distinct = [...new Set(priorities)].sort((a, b) => a - b);
  const dense = distinct.every((value, index) => value === index + 1);
  if (!dense) {
    return `the priorities are sparse ranks ${distinct.join(", ")}; onboarding Phase 5 requires dense ranks from 1`;
  }
  return null;
});

check("every decomposed subsystem was surveyed exactly once, in one batch", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const decomposed = decompositionOf().map((row) => row?.id);
  const surveyedIds = subsystemsOf().map((row) => row?.id);
  const batches = batchesOf();
  if (!batches.length) return "the rebuild records no batch, so a failure resumes from the start";
  const batched = [];
  for (const batch of batches) {
    const ids = Array.isArray(batch?.subsystems) ? batch.subsystems : [];
    if (!ids.length) {
      // §12.1 makes onboarding step 6's first unit; it surveys no subsystem and
      // still owes a checkpoint, because a rebuild that fails after it should
      // resume from the decomposition rather than re-derive it. Nothing else may
      // be empty: an empty survey batch is a batch that did no work.
      if (batch?.kind !== "onboarding" || batch?.n !== 1) {
        return `batch ${JSON.stringify(batch?.n ?? null)} surveyed no subsystem and is not the onboarding pass`;
      }
      continue;
    }
    if (batch?.kind === "onboarding") {
      return `batch ${JSON.stringify(batch?.n ?? null)} is the onboarding pass and also surveyed ${ids.join(", ")}`;
    }
    batched.push(...ids);
  }
  const duplicated = batched.filter((id, index) => batched.indexOf(id) !== index);
  if (duplicated.length) return `subsystem(s) ${[...new Set(duplicated)].join(", ")} appear in more than one batch`;
  const unbatched = decomposed.filter((id) => !batched.includes(id));
  if (unbatched.length) return `subsystem(s) ${unbatched.join(", ")} are in the decomposition and in no batch`;
  const unplanned = batched.filter((id) => !decomposed.includes(id));
  if (unplanned.length) return `batch(es) surveyed ${unplanned.join(", ")}, which the decomposition does not contain`;
  const unrecorded = decomposed.filter((id) => !surveyedIds.includes(id));
  if (unrecorded.length) return `subsystem(s) ${unrecorded.join(", ")} have no survey row in the receipt`;
  const extra = surveyedIds.filter((id) => !decomposed.includes(id));
  if (extra.length) return `survey row(s) for ${extra.join(", ")} name no subsystem in the decomposition`;
  return null;
});

check("the batches ran in priority order, each behind a checkpoint commit", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const batches = batchesOf();
  if (!batches.length) return "the rebuild records no batch";
  const priority = new Map(decompositionOf().map((row) => [row?.id, row?.priority]));
  const history = Array.isArray(receipt.storage_history) ? receipt.storage_history : [];
  if (!history.length) return "the receipt carries no storage history, so no checkpoint can be found in it";
  let previousHigh = 0;
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    if (batch?.n !== index + 1) {
      return `batch ${index + 1} is numbered ${JSON.stringify(batch?.n ?? null)}; batches are consecutive from 1`;
    }
    const ids = Array.isArray(batch.subsystems) ? batch.subsystems : [];
    if (ids.length) {
      const ranks = ids.map((id) => priority.get(id));
      if (ranks.some((rank) => !Number.isInteger(rank))) {
        return `batch ${batch.n} surveyed a subsystem with no priority`;
      }
      const low = Math.min(...ranks);
      const high = Math.max(...ranks);
      if (low < previousHigh) {
        return `batch ${batch.n} surveyed priority ${low} after batch ${index} reached priority ${previousHigh}: the batches did not run in priority order`;
      }
      previousHigh = high;
    }
    if (!isHex(batch.storage_commit, 7, 40)) {
      return `batch ${batch.n} records no checkpoint commit, so a failure there resumes from the start`;
    }
    const commit = history.find(
      (entry) =>
        typeof entry?.sha === "string" &&
        (entry.sha.startsWith(batch.storage_commit) || batch.storage_commit.startsWith(entry.sha)),
    );
    if (!commit) {
      return `batch ${batch.n}'s checkpoint ${batch.storage_commit} is not in the storage history`;
    }
    if (String(commit.message ?? "") !== String(batch.label ?? "\0")) {
      return `batch ${batch.n}'s checkpoint commit says ${JSON.stringify(commit.message ?? null)}, not the batch label ${JSON.stringify(batch.label ?? null)}`;
    }
    if (batch.kind === "onboarding" && !/onboarding/i.test(String(batch.label ?? ""))) {
      return `batch ${batch.n} is the onboarding pass and its checkpoint label does not say so`;
    }
    for (const id of ids) {
      if (!String(batch.label ?? "").includes(id)) {
        return `batch ${batch.n}'s checkpoint label does not name ${id}, so the checkpoint does not say what it covers`;
      }
    }
  }
  return null;
});

check("a subsystem that stopped short of structural says why", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const rows = subsystemsOf();
  if (!rows.length) return "the receipt records no surveyed subsystem";
  const unknown = rows.filter((row) => !isKnownStatus(row?.status));
  if (unknown.length) {
    return `subsystem(s) ${unknown.map((row) => `${row?.id}=${row?.status}`).join(", ")} carry a status outside the survey progression`;
  }
  const short = rows.filter((row) => statusRank(row.status) < statusRank("structural"));
  const silent = short.filter((row) => !String(row?.deferred_reason ?? "").trim());
  if (silent.length) {
    return `subsystem(s) ${silent.map((row) => row.id).join(", ")} did not reach structural and record no reason`;
  }
  if (!surveyed().length) {
    return "no subsystem reached structural, so the rebuild produced no claims-backed inventory";
  }
  return null;
});

check("every structural subsystem carries a current <sid>/ claim (§9.1)", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const rows = surveyed();
  if (!rows.length) return "no subsystem reached structural, so the prerequisite has no denominator";
  const bare = [];
  for (const row of rows) {
    const claims = Array.isArray(row?.claims) ? row.claims : [];
    const own = claims.filter((claim) => String(claim?.claim_key ?? "").startsWith(`${row.id}/`));
    if (!own.length) bare.push(row.id);
  }
  if (bare.length) {
    return `subsystem(s) ${bare.join(", ")} reached structural with no current claim whose claim_key begins <sid>/`;
  }
  return null;
});

check("every claim is evidence-backed, and the file-anchored ones cite their own file", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const rows = surveyed();
  if (!rows.length) return "no subsystem reached structural, so no claim is under test";
  const seenKeys = new Map();
  let claimCount = 0;
  for (const row of rows) {
    for (const claim of Array.isArray(row?.claims) ? row.claims : []) {
      claimCount += 1;
      const key = String(claim?.claim_key ?? "");
      if (!key) return `${row.id} records a claim with no claim_key`;
      if (seenKeys.has(key)) {
        return `claim_key ${key} is current twice (${seenKeys.get(key)} and ${row.id}); only one current row per key is admitted`;
      }
      seenKeys.set(key, row.id);
      if (!["symbol", "subsystem", "seam"].includes(claim?.subject_type)) {
        return `claim ${key} carries subject_type ${JSON.stringify(claim?.subject_type ?? null)}, outside {symbol, subsystem, seam}`;
      }
      if (!String(claim?.statement ?? "").trim()) return `claim ${key} carries no statement`;
      if (!isHex(claim?.ref_sha, 7, 40)) {
        return `claim ${key} is not bound to a revision: ${JSON.stringify(claim?.ref_sha ?? null)}`;
      }
      const evidence = Array.isArray(claim?.evidence) ? claim.evidence : [];
      if (!evidence.length) return `claim ${key} carries no evidence row`;
      for (const row2 of evidence) {
        if (!inTree(row2?.file_path)) {
          return `claim ${key} cites ${JSON.stringify(row2?.file_path ?? null)}, which is not a file in this tree`;
        }
        if (!isHex(row2?.ref_sha, 7, 40)) {
          return `claim ${key} cites evidence with no resolved revision`;
        }
      }
      const category = key.slice(row.id.length + 1).split("/")[0];
      if (FILE_ANCHORED.includes(category) && claim.subject_type === "symbol") {
        const path = subjectPath(claim.subject_id);
        const anchored = evidence.some(
          (row2) => STRONG_EVIDENCE.includes(row2?.kind) && row2?.file_path === path,
        );
        if (!anchored) {
          const found = evidence.map((row2) => `${row2?.kind} on ${row2?.file_path}`).join(", ");
          return `claim ${key} is a ${category} read off ${path}, and its evidence is ${found || "nothing"}: none of it is ${STRONG_EVIDENCE.join(" or ")} on that file`;
        }
        const shapeFailure = keyShapeFailure(row.id, category, key, claim.subject_id);
        if (shapeFailure) return shapeFailure;
      }
    }
  }
  if (!claimCount) return "the receipt records no claim at all";
  return null;
});

check("every edge carries a citation token whose path is in the tree (§9.2)", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const edges = xrefsOf();
  if (!edges.length) return "the rebuild recorded no edge, so the topology has nothing to render from";
  const known = new Set(decompositionOf().map((row) => row?.id));
  for (const edge of edges) {
    const label = `${edge?.from_id} → ${edge?.to_id}`;
    if (!known.has(edge?.from_id) || !known.has(edge?.to_id)) {
      return `edge ${label} names a subsystem outside the decomposition`;
    }
    if (edge.from_id === edge.to_id) return `edge ${label} does not cross a subsystem boundary`;
    if (!CROSSING_RELATIONSHIPS.includes(edge?.relationship)) {
      return `edge ${label} is a ${JSON.stringify(edge?.relationship ?? null)}, not a crossing (${CROSSING_RELATIONSHIPS.join(" or ")})`;
    }
    if (!STRENGTHS.includes(edge?.strength)) {
      return `edge ${label} records strength ${JSON.stringify(edge?.strength ?? null)}`;
    }
    const tokens = citationTokens(edge?.context);
    if (!tokens.length) {
      return `edge ${label} carries no citation token matching <path>:<symbol>@<sha> in its context`;
    }
    const recorded = Array.isArray(edge?.citations) ? edge.citations : [];
    if (!recorded.length) return `edge ${label} records no validated citation`;
    for (const citation of recorded) {
      const token = `${citation?.path}:${citation?.symbol}@${citation?.sha}`;
      if (!tokens.includes(token)) {
        return `edge ${label} records citation ${token}, which is not a token of its own context`;
      }
      if (!inTree(citation?.path)) {
        return `edge ${label} cites ${JSON.stringify(citation?.path ?? null)}, which is not a file in this tree`;
      }
      if (!isHex(citation?.sha, 7, 40)) return `edge ${label} cites an unresolved revision`;
    }
  }
  return null;
});

check("every seam between two subsystems has an edge, and no structural subsystem is silently isolated", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const edges = xrefsOf();
  const pairs = new Set(edges.map((edge) => pairKey(edge?.from_id, edge?.to_id)));
  const crossing = seamsOf().filter((seam) => seam?.party_a && seam?.party_b && seam.party_a !== seam.party_b);
  const uncovered = crossing.filter((seam) => !pairs.has(pairKey(seam.party_a, seam.party_b)));
  if (uncovered.length) {
    return `seam(s) ${uncovered.map((seam) => `${seam.id} (${seam.party_a}↔${seam.party_b})`).join(", ")} record a boundary with no edge between those subsystems`;
  }
  const touched = new Set();
  for (const edge of edges) {
    touched.add(edge?.from_id);
    touched.add(edge?.to_id);
  }
  const isolated = surveyed().filter(
    (row) => !touched.has(row.id) && !String(row?.no_crossing_reason ?? "").trim(),
  );
  if (isolated.length) {
    return `subsystem(s) ${isolated.map((row) => row.id).join(", ")} reached structural, appear in no edge, and record no reason for having no crossing`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// The published narrative against the code it describes. The rebuilt B-03
// claim called claim rows immutable and the adversarial pass upheld it saying
// supersession happens "rather than updating a row", while both invalidation
// and supersession execute `UPDATE claims SET valid_until_sha` (F8/codex). A
// claim about the schema that the schema's own writers contradict is a defect
// in the record, not a wording quibble — so the contradiction is asserted
// against the source rather than left to a reader to notice.
// ---------------------------------------------------------------------------
const MUTABILITY_SOURCE = "mcp-server/src/tools/claims.ts";
const CLAIM_INTERVAL_UPDATE = /UPDATE claims SET valid_until_sha/;

check(`no receipt describes claim rows as never updated while ${MUTABILITY_SOURCE} updates them`, () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const sourcePath = join(REPO, MUTABILITY_SOURCE);
  if (!existsSync(sourcePath)) {
    return `${MUTABILITY_SOURCE} is absent, so the narrative cannot be checked against it`;
  }
  const source = readFileSync(sourcePath, "utf8");
  const updates = CLAIM_INTERVAL_UPDATE.test(source);
  // Both directions matter: if the code stops updating the interval in place,
  // this check must stop demanding that the prose say it does.
  const narratives = [];
  for (const row of subsystemsOf()) {
    for (const claim of Array.isArray(row?.claims) ? row.claims : []) {
      if (typeof claim?.statement === "string") {
        narratives.push([`claim ${claim.claim_key ?? "(unkeyed)"}`, claim.statement]);
      }
    }
  }
  const offenders = narratives.filter(
    ([, text]) =>
      /\bimmutable row\b/i.test(text) || /rather than (updating|overwriting) a row/i.test(text),
  );
  if (updates && offenders.length) {
    return (
      `${offenders.map(([where]) => where).join(", ")} describe(s) a claim row as never updated, ` +
      `but ${MUTABILITY_SOURCE} executes UPDATE claims SET valid_until_sha on both the ` +
      "invalidation and the supersession path"
    );
  }
  if (!updates && !offenders.length) {
    return (
      `${MUTABILITY_SOURCE} no longer updates valid_until_sha in place, so this check is ` +
      "measuring nothing — re-derive it against whatever closes a claim interval now"
    );
  }
  return null;
});

check("every revision the receipt cites resolves and is an ancestor of HEAD", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const shas = new Set();
  for (const row of subsystemsOf()) {
    for (const claim of Array.isArray(row?.claims) ? row.claims : []) {
      if (isHex(claim?.ref_sha, 7, 40)) shas.add(claim.ref_sha);
      for (const evidence of Array.isArray(claim?.evidence) ? claim.evidence : []) {
        if (isHex(evidence?.ref_sha, 7, 40)) shas.add(evidence.ref_sha);
      }
    }
  }
  for (const edge of xrefsOf()) {
    for (const citation of Array.isArray(edge?.citations) ? edge.citations : []) {
      if (isHex(citation?.sha, 7, 40)) shas.add(citation.sha);
    }
  }
  if (isHex(receipt.onboarding?.onboarding_sha, 40, 40)) shas.add(receipt.onboarding.onboarding_sha);
  // The receipt's own binding is a cited revision too: checking it for hex
  // shape alone accepted forty zeroes (F2/codex).
  if (typeof receipt.repository_sha === "string" && receipt.repository_sha) {
    shas.add(receipt.repository_sha);
  }
  if (!shas.size) return "the receipt cites no revision at all, so nothing binds its claims and edges to the code";
  // Unevaluable ancestry is RED, not a note-and-pass. It used to be the
  // latter, and the `mcp-server` CI job checked out at depth 1, so this check
  // never evaluated there at all — the zero-denominator green these gates
  // exist to refuse (VP4). That job now uses `fetch-depth: 0`.
  const failure = resolveRevisions(REPO, shas, "the revisions the receipt cites");
  if (failure) return failure;
  return null;
});

check("the A0 fixture under dev/conspectus/ is unchanged (§12.3)", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const recorded = receipt.fixtures_unchanged?.digests;
  if (!recorded || typeof recorded !== "object") {
    return "the receipt records no digest for the historical A0 fixture";
  }
  const unrecorded = FIXTURES.filter((path) => !isHex(recorded[path], 64, 64));
  if (unrecorded.length) return `the receipt records no sha256 for ${unrecorded.join(", ")}`;
  const drifted = [];
  for (const path of FIXTURES) {
    const abs = join(REPO, path);
    if (!existsSync(abs)) {
      drifted.push(`${path} is gone`);
      continue;
    }
    if (sha256(abs) !== recorded[path]) drifted.push(`${path} was rewritten by the rebuild`);
  }
  return drifted.length ? drifted.join("; ") : null;
});

// ---------------------------------------------------------------------------
// The live store, when one is present. Read-only and direct: the gate must not
// write to the store it is judging, and must not need a built server to judge it.
// ---------------------------------------------------------------------------
emit("");

const storeAbs = join(REPO, STORE_REL);
// The store the receipt describes, which is not always the store at this path.
//
// The receipt records an absolute `storage_path`, and `.amanuensis` is
// worktree-local: a second checkout of this repository has a second store at
// the same *relative* path that this receipt never described. Asserting the
// receipt's rows over it would report a disagreement between two unrelated
// stores as a defect in one — the class of confusion
// `design/survey-depth/spec.md` §5.3 exists to stop, and the state the
// survey-depth acceptance rebuild puts this worktree into: it initializes a
// store here, carried from the clean-slate archive, at a different revision.
//
// So the live arm runs against the store the receipt names, and says so when
// the store it found is a different one. Every assertion is unchanged where the
// subject is present; none is skipped silently.
function receiptStorePath() {
  const recorded = receipt?.storage_path;
  return typeof recorded === "string" && recorded.length > 0 ? join(recorded, "memory.db") : null;
}
const liveIsReceiptSubject = (() => {
  const recorded = receiptStorePath();
  if (recorded === null) return true; // no path recorded: behave exactly as before
  return resolve(recorded) === resolve(storeAbs);
})();
let live = null;
let liveError = null;
if (existsSync(storeAbs) && liveIsReceiptSubject) {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(storeAbs, { readOnly: true });
    const all = (sql) => db.prepare(sql).all();
    live = {
      subsystems: all("SELECT id, name, status, priority FROM subsystems"),
      claims: all(
        "SELECT claim_id, claim_key, subject_type, subject_id FROM claims WHERE valid_until_sha IS NULL",
      ),
      claimEvidence: all(
        "SELECT ce.claim_id AS claim_id, e.kind AS kind, e.file_path AS file_path " +
          "FROM claim_evidence ce JOIN evidence e ON e.id = ce.evidence_id",
      ),
      xrefs: all("SELECT from_id, to_id, relationship, context FROM xrefs"),
      seams: all("SELECT id, party_a, party_b FROM seams"),
    };
    db.close();
  } catch (e) {
    liveError = e && e.message ? e.message : String(e);
  }
  if (live) emit("the live store at .amanuensis/memory.db, read directly and read-only");
  else emit("the live store at .amanuensis/memory.db could not be opened");
} else if (existsSync(storeAbs)) {
  emit(
    `the store at .amanuensis/memory.db is not the one this receipt describes (it records ` +
      `${receiptStorePath()}), so the committed receipt is the whole gate: a store ` +
      `this receipt never described can neither confirm nor contradict it`,
  );
} else {
  emit(
    "the live store is absent here (`git ls-files .amanuensis` → 0), so the committed receipt is the whole gate; this is the mode CI runs in",
  );
}

if (existsSync(storeAbs) && liveIsReceiptSubject) {
  check("the live store opens for reading", () => liveError ?? (live ? null : "the store yielded no rows"));

  check("the live store still holds every subsystem the receipt records, at its status", () => {
    if (!live) return "the live store could not be read";
    const missing = requireReceipt();
    if (missing) return missing;
    const byId = new Map(live.subsystems.map((row) => [row.id, row]));
    const lost = [];
    const regressed = [];
    for (const row of subsystemsOf()) {
      const found = byId.get(row.id);
      if (!found) {
        lost.push(row.id);
        continue;
      }
      if (statusRank(found.status) < statusRank(row.status)) {
        regressed.push(`${row.id} is ${found.status}, the receipt says ${row.status}`);
      }
    }
    if (lost.length) return `subsystem(s) ${lost.join(", ")} are in the receipt and not in the live store`;
    if (regressed.length) return regressed.join("; ");
    return null;
  });

  check("every structural subsystem in the live store carries a current <sid>/ claim", () => {
    if (!live) return "the live store could not be read";
    const rows = live.subsystems.filter((row) => statusRank(row.status) >= statusRank("structural"));
    if (!rows.length) return "no subsystem in the live store reached structural";
    const bare = rows.filter(
      (row) => !live.claims.some((claim) => String(claim.claim_key).startsWith(`${row.id}/`)),
    );
    if (bare.length) {
      return `subsystem(s) ${bare.map((row) => row.id).join(", ")} are structural in the live store with no current <sid>/ claim`;
    }
    return null;
  });

  check("every file-anchored claim in the live store cites its own file with code-grade evidence", () => {
    if (!live) return "the live store could not be read";
    const byClaim = new Map();
    for (const row of live.claimEvidence) {
      if (!byClaim.has(row.claim_id)) byClaim.set(row.claim_id, []);
      byClaim.get(row.claim_id).push(row);
    }
    let anchoredCount = 0;
    for (const claim of live.claims) {
      const key = String(claim.claim_key);
      const category = key.split("/")[1];
      if (!FILE_ANCHORED.includes(category) || claim.subject_type !== "symbol") continue;
      anchoredCount += 1;
      const path = subjectPath(claim.subject_id);
      const evidence = byClaim.get(claim.claim_id) ?? [];
      if (!evidence.some((row) => STRONG_EVIDENCE.includes(row.kind) && row.file_path === path)) {
        const found = evidence.map((row) => `${row.kind} on ${row.file_path}`).join(", ");
        return `live claim ${key} is a ${category} read off ${path}, and its evidence is ${found || "nothing"}`;
      }
      const shapeFailure = keyShapeFailure(key.split("/")[0], category, key, claim.subject_id);
      if (shapeFailure) return `in the live store: ${shapeFailure}`;
    }
    if (!anchoredCount) {
      return "the live store holds no key-type, state-container or flow claim, so the inventory is not claims-backed";
    }
    return null;
  });

  check("every edge in the live store carries a citation token, and every seam has one", () => {
    if (!live) return "the live store could not be read";
    if (!live.xrefs.length) return "the live store records no edge";
    for (const edge of live.xrefs) {
      const label = `${edge.from_id} → ${edge.to_id}`;
      if (!CROSSING_RELATIONSHIPS.includes(edge.relationship)) {
        return `live edge ${label} is a ${edge.relationship}, not a crossing`;
      }
      const tokens = citationTokens(edge.context);
      if (!tokens.length) return `live edge ${label} carries no citation token in its context`;
      const offTree = tokens.filter((token) => !inTree(token.slice(0, token.indexOf(":"))));
      if (offTree.length) return `live edge ${label} cites ${offTree.join(", ")}, not a file in this tree`;
    }
    const pairs = new Set(live.xrefs.map((edge) => pairKey(edge.from_id, edge.to_id)));
    const uncovered = live.seams
      .filter((seam) => seam.party_a !== seam.party_b)
      .filter((seam) => !pairs.has(pairKey(seam.party_a, seam.party_b)));
    if (uncovered.length) {
      return `live seam(s) ${uncovered.map((seam) => seam.id).join(", ")} record a boundary with no edge between those subsystems`;
    }
    return null;
  });
}

emit("");
check("the gate runs in CI", () => {
  const ci = readText(join(REPO, CI_REL));
  if (ci === null) return `${CI_REL} is absent`;
  return ci.includes(GATE_COMMAND) ? null : "the gate is not run in CI";
});

emit("");
if (failures.length) {
  emit(
    `GATE P17 RED: the self-conspectus was not rebuilt through the skill with a claims-backed Phase 2 — ${failures.length} failed assertion(s) across the onboarding boundary, the batched subsystem coverage, the <sid>/ claim prerequisite and its evidence, and the cited edge contract; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("GATE P17 GREEN");
