#!/usr/bin/env node
// Gate for reader-lenses packet P18 — the dogfood receipt, and the promoted
// `docs/` the receipt says was verified (spec.md §12.2, §12.4, §13; claims C53,
// C54, C62, C55, C63).
//
// Two arms, and the first one is the whole gate in CI. `git ls-files
// .amanuensis` returns 0: the store is untracked, so every assertion §12.4 makes
// about `describe_locus`, `get_attention` and `finding_state_current` is about a
// call that happened in one worktree at one revision. A gate that only read the
// live store would be green-by-absence in CI and in the launcher's verification
// worktree, which is the zero-denominator failure this repository has already
// recorded three times (VP4; concern ZD-1 in this repository's own survey). So
// the responses are committed in `design/reader-lenses/dogfood-receipt.json` and
// asserted over there, and the live store — wherever one exists — is read
// directly, read-only, and must still satisfy the same properties. The mode is
// printed, because a receipt nobody can contradict is a claim about a claim.
//
// The promoted tree is the exception, and deliberately so: `docs/` **is**
// tracked, so the byte-match is not taken from the receipt at all. Every page
// the promoted contract names is re-hashed here, at the path it was committed
// to. That is §12.2's point — verifying one directory and committing another is
// GP21, a unit-scoped pass asserted as a system-scoped one.
//
// Turns red when:
//   - `design/reader-lenses/dogfood-receipt.json` is absent, is not valid JSON,
//     declares another contract, or does not bind itself to a revision of this
//     repository and to a workspace-local store with a resolved
//     `last_checked_sha`;
//   - `describe_locus` did not return `examined` standing — or `mixed` with
//     every owner `examined` — for any of the three named files, or served no
//     current structural claim whose recorded evidence cites that file, or
//     named a file that is not in the tree;
//   - `get_attention`'s selected open and awaiting-verification ids, unioned
//     with the ids its omission ledger records under `reason: "budget"`, are not
//     **exactly** the `finding_state_current` ids in `open` and
//     `fixed-pending-verification`; or an omission's `count` does not match the
//     ids it carries; or `selected + omitted != census` in either section; or
//     the recorded state query is empty, so the equality has no denominator;
//   - the recorded clean publish is not green on all three read-back axes, did
//     not publish, or wrote anywhere but `.amanuensis/docs`;
//   - the recorded post-promotion read-back at the root `docs/` is not green on
//     all three axes;
//   - the promoted `docs/.projection-contract.json` or `docs/.manifest.json` is
//     not byte-identical to the source artifact the receipt verified — the
//     bytes committed are then not the bytes that were verified;
//   - any page the promoted contract names is missing from `docs/`, or its
//     bytes hash to anything but the `content_hash` the contract records, or
//     `docs/` holds a file no contract page and neither receipt artifact claims;
//   - any promoted file is untracked, so the commit does not contain what this
//     gate just verified;
//   - `dev/promote-docs.mjs` is absent, or promotes from a source carrying no
//     `.projection-contract.json`, or from a source whose pages do not match the
//     contract it does carry — in either case a destination it was pointed at is
//     also required to come through untouched;
//   - the live store, where one exists, disagrees with the receipt on
//     `finding_state_current`, on `last_checked_sha`, or on the ledger
//     classification of any of the three named files;
//   - the gate does not run in `.github/workflows/test.yml`.
//
// False greens it cannot exclude. A green dogfood on one repository is not
// generality: every number here is Amanuensis's reading of Amanuensis, and the
// second repository that would make it a measurement does not exist yet. A
// receipt proves what was true when it was written — the live arm narrows that
// window only where a store is present, and in CI it is not. The byte-match
// proves the promoted tree is the verified tree; it does not prove the
// projection says anything true, which is what the read-back axes are for and
// what §13's materializer gates test. And the structural claim this asserts the
// existence of is a claim: that it is current, cited and attributed is checked
// here, that it is *right* is the adversarial pass's job and P19's receipt.
//
// Output protocol: exactly one status line, last, on stdout. Every message is
// scrubbed of the launcher's crash signatures, so an absent deliverable reads as
// a failed assertion rather than as a gate that never ran.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { historyIsComplete, resolveRevisions } from "./receipt-provenance.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const RECEIPT_REL = "design/reader-lenses/dogfood-receipt.json";
const PROMOTE_REL = "dev/promote-docs.mjs";
const DOCS_REL = "docs";
const CI_REL = ".github/workflows/test.yml";
const GATE_COMMAND = "node dev/test-reader-lenses-dogfood.mjs";
const STORE_REL = ".amanuensis/memory.db";

const RECEIPT_CONTRACT = "amanuensis-reader-lenses/dogfood-receipt/v1";
const CONTRACT_NAME = ".projection-contract.json";
const MANIFEST_NAME = ".manifest.json";

// §12.4 assertion 1's three files, written out here rather than read from the
// receipt. Reading them from the document under test would let dropping a file
// from the dogfood also drop it from what this expects.
const DOGFOOD_LOCI = [
  "mcp-server/src/index.ts",
  "mcp-server/src/tools/findings.ts",
  "materializer/amanuensis_materializer/core.py",
];

// §12.2 step 1: the publish is confined to project storage, and that containment
// is the guard working as designed. The promotion is the second, explicit step.
const SOURCE_DOCS_SUFFIX = "/.amanuensis/docs";

// The two resolution states §12.4 assertion 2 counts. `finding_state_current`
// carries five; these are the two `get_attention` serves under `open` and
// `awaiting_verification`.
const UNRESOLVED_STATES = ["open", "fixed-pending-verification"];

// §3.2's standing states that authorize a structural claim about a file's
// content. `mixed` is admitted only when every owner is `examined` (§12.4).
const EXAMINED_STATES = ["examined", "mixed"];

const READBACK_AXES = ["state", "coverage", "content"];

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

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isHex(value, min, max) {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${min},${max}}$`).test(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function git(args) {
  return spawnSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function sameSet(a, b) {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Every regular file beneath `abs`, as paths relative to it, sorted. */
function walk(abs, prefix = "") {
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(join(abs, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// The committed receipt.
// ---------------------------------------------------------------------------
emit("the dogfood receipt, as committed");

const { text: receiptText, value: receipt } = readJson(RECEIPT_REL);

function requireReceipt() {
  if (receiptText === null) {
    return `${RECEIPT_REL} is absent: the dogfood receipt records no describe_locus response, no attention reconciliation and no publication`;
  }
  if (receipt === null) return `${RECEIPT_REL} is not valid JSON, so the dogfood receipt cannot be read`;
  return null;
}

const lociOf = () => (Array.isArray(receipt?.loci) ? receipt.loci : []);
const locusFor = (path) => lociOf().find((entry) => entry?.locus === path) ?? null;
const stateRowsOf = () =>
  Array.isArray(receipt?.finding_state_current) ? receipt.finding_state_current : [];
const attentionOf = () => receipt?.attention?.response ?? null;
const publicationOf = () => receipt?.publication ?? null;

check("the dogfood receipt declares its contract and binds itself to this repository and store", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  if (receipt.contract !== RECEIPT_CONTRACT) {
    return `the dogfood receipt declares ${JSON.stringify(receipt.contract ?? null)}, not ${RECEIPT_CONTRACT}`;
  }
  if (receipt.packet !== "P18") return `the dogfood receipt names packet ${JSON.stringify(receipt.packet ?? null)}`;
  if (!isHex(receipt.repository_sha, 7, 40)) {
    return "the dogfood receipt does not bind itself to a repository revision";
  }
  const bound = resolveRevisions(REPO, [receipt.repository_sha], "the dogfood receipt's repository_sha");
  if (bound) return bound;
  if (typeof receipt.storage_path !== "string" || !receipt.storage_path.endsWith("/.amanuensis")) {
    return `the dogfood receipt's storage path is not a workspace-local store: ${JSON.stringify(receipt.storage_path ?? null)}`;
  }
  if (
    typeof receipt.workspace_path !== "string" ||
    !receipt.storage_path.startsWith(`${receipt.workspace_path}/`)
  ) {
    return "the dogfood receipt's storage path does not sit inside the workspace it names";
  }
  if (!isHex(receipt.store?.last_checked_sha, 40, 40)) {
    return `the dogfood receipt records the store's last_checked_sha as ${JSON.stringify(receipt.store?.last_checked_sha ?? null)}, not a resolved commit`;
  }
  // A shallow clone used to skip this silently; it is RED now (F2/codex).
  return resolveRevisions(REPO, [receipt.store.last_checked_sha], "the store's last_checked_sha");
});

// ---------------------------------------------------------------------------
// §12.4 assertion 1 — three files, examined standing, one structural claim each.
// ---------------------------------------------------------------------------
emit("");
emit("§12.4 assertion 1 — describe_locus on the three named files");

for (const path of DOGFOOD_LOCI) {
  check(`${path} is in the tree and the receipt records its describe_locus response`, () => {
    const missing = requireReceipt();
    if (missing) return missing;
    if (!existsSync(join(REPO, path))) {
      return `${path} is not in this tree, so the recorded response describes a file that is gone`;
    }
    const entry = locusFor(path);
    if (!entry) return `the dogfood receipt carries no describe_locus response for ${path}`;
    const response = entry.response;
    if (!response || typeof response !== "object") {
      return `the recorded response for ${path} is not an object`;
    }
    if (response.contract_version !== "1.0.0") {
      return `the recorded response for ${path} declares contract_version ${JSON.stringify(response.contract_version ?? null)}`;
    }
    if (response.locus?.value !== path) {
      return `the recorded response is for locus ${JSON.stringify(response.locus?.value ?? null)}, not ${path}`;
    }
    if (response.locus?.kind !== "file") {
      return `${path} was resolved as kind ${JSON.stringify(response.locus?.kind ?? null)}, not file`;
    }
    return null;
  });

  check(`${path} stands as examined, with every owner examined`, () => {
    const missing = requireReceipt();
    if (missing) return missing;
    const standing = locusFor(path)?.response?.standing;
    if (!standing) return `the recorded response for ${path} carries no standing`;
    if (!EXAMINED_STATES.includes(standing.state)) {
      return `${path} stands as ${JSON.stringify(standing.state ?? null)}, which authorizes no claim about its content`;
    }
    const owners = Array.isArray(standing.owners) ? standing.owners : [];
    if (!owners.length) return `${path} carries no ledger owner, so its standing rests on nothing`;
    const short = owners.filter((owner) => owner?.standing_state !== "examined");
    if (short.length) {
      return `${path} has owner(s) ${short.map((owner) => `${owner?.subsystem_id}=${owner?.standing_state}`).join(", ")} that are not examined`;
    }
    const unread = owners.filter((owner) => owner?.classification !== "examined");
    if (unread.length) {
      return `${path} has owner(s) ${unread.map((owner) => `${owner?.subsystem_id}=${owner?.classification}`).join(", ")} whose ledger classification is not examined`;
    }
    if (!nonEmpty(standing.authorizes) || !nonEmpty(standing.cannot_justify)) {
      return `${path}'s standing does not say both what it authorizes and what it cannot justify`;
    }
    return null;
  });

  check(`${path} carries at least one current structural claim whose evidence cites it`, () => {
    const missing = requireReceipt();
    if (missing) return missing;
    const entry = locusFor(path);
    const section = entry?.response?.sections?.structure;
    if (!section) return `the recorded response for ${path} carries no structure section`;
    if (section.requested !== true) {
      return `the structure section was not requested for ${path}, so an empty one proves nothing`;
    }
    if (section.recorded !== true) return `no structural account is recorded for ${path}`;
    if (!(Number(section.census) > 0)) {
      return `the structure section for ${path} has a census of ${JSON.stringify(section.census ?? null)}`;
    }
    const items = Array.isArray(section.items) ? section.items : [];
    if (!items.length) {
      return `the structure section for ${path} served no item: the budget dropped every claim, so the account reached no reader`;
    }
    // "Whose evidence cites that file" is not visible in the served item —
    // buildStructure admits a claim on `subject_id` OR on a claim_key prefix OR
    // on cited evidence, joined with OR. The receipt records the evidence file
    // paths the store holds per served claim, which is what this reads.
    const citations = entry?.evidence_citations ?? {};
    const current = items.filter((item) => item?.current === true);
    if (!current.length) return `every structural claim served for ${path} is closed`;
    const cited = current.filter((item) => {
      const paths = citations[String(item?.claim_id)];
      return Array.isArray(paths) && paths.includes(path);
    });
    if (!cited.length) {
      return `no current structural claim served for ${path} has recorded evidence citing ${path}`;
    }
    for (const item of cited) {
      if (!nonEmpty(item.statement)) return `claim ${item.claim_id} on ${path} carries no statement`;
      if (item.revision_bound !== true) {
        return `claim ${item.claim_id} on ${path} is not revision-bound, so it is not a structural claim`;
      }
      if (!isHex(item.ref_sha, 7, 40)) {
        return `claim ${item.claim_id} on ${path} carries no revision`;
      }
      if (item.authored !== "model" && item.authored !== "code") {
        return `claim ${item.claim_id} on ${path} does not say who authored it`;
      }
    }
    return null;
  });
}

// ---------------------------------------------------------------------------
// §12.4 assertion 2 — the attention fan-in, exact against the state view.
// ---------------------------------------------------------------------------
emit("");
emit("§12.4 assertion 2 — get_attention's selected and budget-omitted ids against finding_state_current");

check("the receipt records a non-empty finding_state_current query, so the equality has a denominator", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const rows = stateRowsOf();
  if (!rows.length) {
    return "the dogfood receipt records no finding_state_current row: an equality over two empty sets is the zero-denominator green this repository has recorded three times";
  }
  for (const row of rows) {
    if (!nonEmpty(row?.finding_id)) return "a finding_state_current row carries no finding_id";
    if (!nonEmpty(row?.resolution_state)) {
      return `finding ${row?.finding_id} carries no resolution_state`;
    }
  }
  const unresolved = rows.filter((row) => UNRESOLVED_STATES.includes(row.resolution_state));
  if (!unresolved.length) {
    return "no recorded finding is open or awaiting verification, so the fan-in is asserted over an empty set";
  }
  return null;
});

check("the recorded get_attention response declares its contract, scope and revision", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const response = attentionOf();
  if (!response) return "the dogfood receipt carries no get_attention response";
  if (response.contract_version !== "1.0.0") {
    return `the recorded attention response declares contract_version ${JSON.stringify(response.contract_version ?? null)}`;
  }
  if (response.scope?.kind !== "project" || response.scope?.requested !== null) {
    return `the recorded attention response was scoped to ${JSON.stringify(response.scope?.requested ?? null)}, not the whole project`;
  }
  if (!isHex(response.checked_sha, 40, 40)) {
    return `the recorded attention response reads against ${JSON.stringify(response.checked_sha ?? null)}`;
  }
  if (response.checked_sha !== receipt.store?.last_checked_sha) {
    return `the attention response reads against ${response.checked_sha} and the store records ${receipt.store?.last_checked_sha}`;
  }
  return null;
});

check("selected ids unioned with the budget-omitted ids are exactly the finding_state_current ids", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const response = attentionOf();
  if (!response) return "the dogfood receipt carries no get_attention response";
  const sections = response.sections ?? {};
  const omissions = Array.isArray(response.omitted) ? response.omitted : [];
  const selected = [];
  for (const name of ["open", "awaiting_verification"]) {
    const section = sections[name];
    if (!section) return `the recorded attention response carries no ${name} section`;
    if (section.requested !== true) return `the ${name} section was not requested`;
    const items = Array.isArray(section.items) ? section.items : [];
    for (const item of items) {
      if (!nonEmpty(item?.finding_id)) return `an item in ${name} carries no finding_id`;
      selected.push(item.finding_id);
    }
  }
  const omittedIds = [];
  for (const name of ["open", "awaiting_verification"]) {
    for (const omission of omissions) {
      if (omission?.section !== name) continue;
      if (omission.reason !== "budget") {
        return `the ${name} section omits ${omission.count} record(s) under reason ${JSON.stringify(omission.reason ?? null)}; §12.4 unions the budget omissions only`;
      }
      const ids = Array.isArray(omission.ids) ? omission.ids : [];
      if (omission.ids_truncated === true) {
        return `the ${name} omission ledger truncated its id list, so the union cannot be evaluated`;
      }
      if (ids.length !== Number(omission.count)) {
        return `the ${name} omission ledger counts ${omission.count} and carries ${ids.length} id(s)`;
      }
      for (const id of ids) {
        // §5.2's omission ids are namespaced (`finding:<id>`); the finding id is
        // what the state view holds.
        const value = String(id).startsWith("finding:") ? String(id).slice("finding:".length) : String(id);
        omittedIds.push(value);
      }
    }
  }
  const expected = stateRowsOf()
    .filter((row) => UNRESOLVED_STATES.includes(row?.resolution_state))
    .map((row) => row.finding_id);
  const union = [...selected, ...omittedIds];
  if (new Set(union).size !== union.length) {
    return "a finding is both served and omitted in the attention response";
  }
  if (!sameSet(union, expected)) {
    const missingIds = expected.filter((id) => !union.includes(id));
    const extra = union.filter((id) => !expected.includes(id));
    return `the union is not the finding_state_current set — missing ${missingIds.length ? missingIds.join(", ") : "none"}; unexpected ${extra.length ? extra.join(", ") : "none"}`;
  }
  return null;
});

check("selected plus omitted reconciles to the census in both sections", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const response = attentionOf();
  if (!response) return "the dogfood receipt carries no get_attention response";
  const omissions = Array.isArray(response.omitted) ? response.omitted : [];
  for (const name of ["open", "awaiting_verification"]) {
    const section = response.sections?.[name];
    if (!section) return `the recorded attention response carries no ${name} section`;
    const served = Array.isArray(section.items) ? section.items.length : 0;
    const omitted = omissions
      .filter((entry) => entry?.section === name)
      .reduce((total, entry) => total + Number(entry.count ?? 0), 0);
    if (served + omitted !== Number(section.census)) {
      return `${name}: ${served} served + ${omitted} omitted != census ${JSON.stringify(section.census ?? null)}`;
    }
  }
  const stateCounts = new Map();
  for (const row of stateRowsOf()) {
    stateCounts.set(row.resolution_state, (stateCounts.get(row.resolution_state) ?? 0) + 1);
  }
  if (Number(response.sections?.open?.census) !== (stateCounts.get("open") ?? 0)) {
    return `the open census is ${JSON.stringify(response.sections?.open?.census ?? null)} and the state view holds ${stateCounts.get("open") ?? 0} open finding(s)`;
  }
  if (
    Number(response.sections?.awaiting_verification?.census) !==
    (stateCounts.get("fixed-pending-verification") ?? 0)
  ) {
    return `the awaiting_verification census is ${JSON.stringify(response.sections?.awaiting_verification?.census ?? null)} and the state view holds ${stateCounts.get("fixed-pending-verification") ?? 0} row(s) awaiting verification`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// §12.4 assertion 3 — the publish was green, and the promoted tree is the tree
// that was verified. The byte-match is computed here, not read.
// ---------------------------------------------------------------------------
emit("");
emit("§12.4 assertion 3 — the clean publish, the promotion, and the promoted bytes");

check("the recorded clean publish is green on all three axes and published into project storage", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const publish = publicationOf()?.clean_publish;
  if (!publish) return "the dogfood receipt records no clean publish";
  if (publish.mode !== "clean-publish") {
    return `the recorded publish ran in mode ${JSON.stringify(publish.mode ?? null)}`;
  }
  if (publish.ok !== true) return "the recorded clean publish is not green";
  if (publish.published !== true) return "the recorded clean publish did not promote its staging directory";
  for (const axis of READBACK_AXES) {
    if (publish.axes?.[axis]?.ok !== true) return `the clean publish's ${axis} axis is red`;
  }
  if (Number(publish.mismatch_count ?? 0) !== 0) {
    return `the clean publish records ${publish.mismatch_count} mismatch(es)`;
  }
  if (typeof publish.output_dir !== "string" || !publish.output_dir.endsWith(SOURCE_DOCS_SUFFIX)) {
    return `the clean publish wrote to ${JSON.stringify(publish.output_dir ?? null)}, not the storage-confined docs directory`;
  }
  return null;
});

check("the recorded post-promotion read-back ran at the root docs/ and is green on all three axes", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  const promotion = publicationOf()?.promotion;
  if (!promotion) return "the dogfood receipt records no promotion";
  if (promotion.destination !== DOCS_REL) {
    return `the promotion wrote to ${JSON.stringify(promotion.destination ?? null)}, not the tracked ${DOCS_REL}/`;
  }
  if (typeof promotion.source !== "string" || !promotion.source.endsWith(".amanuensis/docs")) {
    return `the promotion read from ${JSON.stringify(promotion.source ?? null)}, not the storage-confined publish`;
  }
  const readback = promotion.readback;
  if (!readback) return "the promotion records no read-back of the promoted tree";
  if (readback.ok !== true) return "the post-promotion read-back is not green";
  for (const axis of READBACK_AXES) {
    if (readback.axes?.[axis]?.ok !== true) return `the post-promotion ${axis} axis is red`;
  }
  if (typeof readback.output_dir !== "string" || !readback.output_dir.endsWith(`/${DOCS_REL}`)) {
    return `the post-promotion read-back was run against ${JSON.stringify(readback.output_dir ?? null)}, which is not the promoted tree`;
  }
  return null;
});

const docsAbs = join(REPO, DOCS_REL);
const { text: promotedContractText, value: promotedContract } = readJson(`${DOCS_REL}/${CONTRACT_NAME}`);

check("the promoted contract and manifest are byte-identical to the artifacts the receipt verified", () => {
  const missing = requireReceipt();
  if (missing) return missing;
  if (promotedContractText === null) return `${DOCS_REL}/${CONTRACT_NAME} is absent, so the promoted tree carries no publication receipt`;
  if (promotedContract === null) return `${DOCS_REL}/${CONTRACT_NAME} is not valid JSON`;
  const manifestAbs = join(docsAbs, MANIFEST_NAME);
  if (!existsSync(manifestAbs)) return `${DOCS_REL}/${MANIFEST_NAME} is absent`;
  const source = publicationOf()?.source_artifacts;
  if (!source) return "the dogfood receipt records no hash for the artifacts it verified before promotion";
  const contractHash = sha256(readFileSync(join(docsAbs, CONTRACT_NAME)));
  if (contractHash !== source.projection_contract_sha256) {
    return `the promoted ${CONTRACT_NAME} hashes to ${contractHash} and the verified source hashed to ${JSON.stringify(source.projection_contract_sha256 ?? null)}: the bytes committed are not the bytes that were verified`;
  }
  const manifestHash = sha256(readFileSync(manifestAbs));
  if (manifestHash !== source.manifest_sha256) {
    return `the promoted ${MANIFEST_NAME} hashes to ${manifestHash} and the verified source hashed to ${JSON.stringify(source.manifest_sha256 ?? null)}`;
  }
  return null;
});

check("every page the promoted contract names byte-matches it at the path it was committed to", () => {
  if (promotedContract === null) {
    return `${DOCS_REL}/${CONTRACT_NAME} cannot be read, so the promoted tree cannot be byte-matched`;
  }
  const pages = Array.isArray(promotedContract.pages) ? promotedContract.pages : [];
  if (!pages.length) return `${DOCS_REL}/${CONTRACT_NAME} names no page: an empty contract byte-matches anything`;
  const seen = new Set();
  for (const page of pages) {
    const rel = String(page?.path ?? "");
    if (!rel || rel.startsWith("/") || rel.includes("..")) {
      return `the promoted contract names an unusable page path ${JSON.stringify(page?.path ?? null)}`;
    }
    if (seen.has(rel)) return `the promoted contract names ${rel} twice`;
    seen.add(rel);
    const abs = join(docsAbs, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      return `the promoted contract names ${rel}, which is not in ${DOCS_REL}/`;
    }
    const actual = sha256(readFileSync(abs));
    if (actual !== page?.content_hash) {
      return `${DOCS_REL}/${rel} hashes to ${actual} and the promoted contract records ${JSON.stringify(page?.content_hash ?? null)}`;
    }
  }
  const present = walk(docsAbs);
  const unclaimed = present.filter((rel) => rel !== CONTRACT_NAME && rel !== MANIFEST_NAME && !seen.has(rel));
  if (unclaimed.length) {
    return `${DOCS_REL}/ holds ${unclaimed.length} file(s) the promoted contract does not claim: ${unclaimed.slice(0, 5).join(", ")}`;
  }
  emit(`       (${pages.length} promoted page(s) re-hashed at ${DOCS_REL}/)`);
  return null;
});

check("every promoted file is tracked, so the commit contains what was verified", () => {
  const listed = git(["ls-files", "-z", DOCS_REL]);
  if (listed.status !== 0) return "git could not list the tracked files under docs/";
  const tracked = new Set(
    String(listed.stdout ?? "")
      .split("\0")
      .filter(Boolean)
      .map((path) => relative(DOCS_REL, path)),
  );
  if (!tracked.size) return `no file under ${DOCS_REL}/ is tracked`;
  const present = walk(docsAbs);
  const untracked = present.filter((rel) => !tracked.has(rel));
  if (untracked.length) {
    return `${untracked.length} promoted file(s) are untracked: ${untracked.slice(0, 5).join(", ")}`;
  }
  const vanished = [...tracked].filter((rel) => !present.includes(rel));
  if (vanished.length) {
    return `${vanished.length} tracked file(s) under ${DOCS_REL}/ are not in the working tree: ${vanished.slice(0, 5).join(", ")}`;
  }
  for (const required of [CONTRACT_NAME, MANIFEST_NAME]) {
    if (!tracked.has(required)) return `${DOCS_REL}/${required} is not tracked`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// §12.2 step 2 — the promotion script refuses a source it cannot verify. Run,
// not read: a script that only names the refusal in a comment refuses nothing.
// ---------------------------------------------------------------------------
emit("");
emit("§12.2 step 2 — dev/promote-docs.mjs refuses an unverified source");

function runPromotion(source, destination) {
  return spawnSync(
    process.execPath,
    [join(REPO, PROMOTE_REL), "--source", source, "--destination", destination, "--json"],
    { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
  );
}

let sandbox = null;
try {
  sandbox = mkdtempSync(join(tmpdir(), "amanuensis-promote-refusal-"));
} catch {
  sandbox = null;
}

check("dev/promote-docs.mjs is in the tree", () =>
  existsSync(join(REPO, PROMOTE_REL)) ? null : `${PROMOTE_REL} is absent: nothing promotes a green publish to the tracked docs/`,
);

check("it refuses a source carrying no projection contract, and leaves the destination untouched", () => {
  if (!existsSync(join(REPO, PROMOTE_REL))) return `${PROMOTE_REL} is absent`;
  if (!sandbox) return "no temporary directory was available to run the refusal against";
  const source = join(sandbox, "no-contract-source");
  const destination = join(sandbox, "no-contract-destination");
  mkdirSync(source, { recursive: true });
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(source, "index.md"), "# unverified\n");
  writeFileSync(join(destination, "keep.md"), "# previous contents\n");
  const run = runPromotion(source, destination);
  if (run.error) return `the promotion script could not be run — ${run.error.message}`;
  if (run.status === 0) {
    return "the promotion script promoted a source carrying no projection contract";
  }
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  if (!/contract/i.test(output)) {
    return `the refusal does not name the missing contract: ${output.trim().split("\n").pop() ?? "(no output)"}`;
  }
  const after = walk(destination);
  if (after.length !== 1 || after[0] !== "keep.md") {
    return `the refused promotion changed the destination: it now holds ${after.join(", ") || "nothing"}`;
  }
  if (readFileSync(join(destination, "keep.md"), "utf8") !== "# previous contents\n") {
    return "the refused promotion rewrote the destination's previous contents";
  }
  return null;
});

check("it refuses a source whose pages do not match the contract it carries", () => {
  if (!existsSync(join(REPO, PROMOTE_REL))) return `${PROMOTE_REL} is absent`;
  if (!sandbox) return "no temporary directory was available to run the refusal against";
  const source = join(sandbox, "drifted-source");
  const destination = join(sandbox, "drifted-destination");
  mkdirSync(source, { recursive: true });
  mkdirSync(destination, { recursive: true });
  const body = "# rendered\n";
  writeFileSync(join(source, "index.md"), body);
  writeFileSync(
    join(source, CONTRACT_NAME),
    `${JSON.stringify(
      {
        version: 2,
        pages: [{ path: "index.md", content_hash: sha256(Buffer.from(body, "utf8")) }],
        local_links: [],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(source, MANIFEST_NAME), `${JSON.stringify({ pages: [{ path: "index.md" }] }, null, 2)}\n`);
  // The page drifts from the contract after it was written: the publish's own
  // receipt no longer describes the bytes on disk.
  writeFileSync(join(source, "index.md"), "# edited after publication\n");
  writeFileSync(join(destination, "keep.md"), "# previous contents\n");
  const run = runPromotion(source, destination);
  if (run.error) return `the promotion script could not be run — ${run.error.message}`;
  if (run.status === 0) {
    return "the promotion script promoted a source whose pages do not hash to its contract";
  }
  const after = walk(destination);
  if (after.length !== 1 || after[0] !== "keep.md") {
    return `the refused promotion changed the destination: it now holds ${after.join(", ") || "nothing"}`;
  }
  return null;
});

check("a red read-back at the destination restores the previous contents and promotes nothing", () => {
  if (!existsSync(join(REPO, PROMOTE_REL))) return `${PROMOTE_REL} is absent`;
  if (!sandbox) return "no temporary directory was available to run the promotion against";
  const source = join(sandbox, "green-source");
  const destination = join(sandbox, "managed-destination");
  mkdirSync(source, { recursive: true });
  mkdirSync(destination, { recursive: true });
  // A source that passes every check this script can make without a store: its
  // one page hashes to its contract, and it carries a manifest.
  const body = "# published\n";
  writeFileSync(join(source, "index.md"), body);
  writeFileSync(
    join(source, CONTRACT_NAME),
    `${JSON.stringify(
      { version: 2, pages: [{ path: "index.md", content_hash: sha256(Buffer.from(body, "utf8")) }], local_links: [] },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(source, MANIFEST_NAME), `${JSON.stringify({ pages: [{ path: "index.md" }] }, null, 2)}\n`);
  // A destination whose own manifest claims what is in it, so the promotion is
  // replacing a managed output rather than somebody else's files.
  const previous = "# the contents that must survive a red read-back\n";
  writeFileSync(join(destination, "index.md"), previous);
  writeFileSync(join(destination, MANIFEST_NAME), `${JSON.stringify({ pages: [{ path: "index.md" }] }, null, 2)}\n`);
  // The read-back is stubbed rather than run: this arm is about what the
  // promotion does when the destination comes back red, and forcing the real
  // materializer to render a red projection would be testing the materializer.
  // Green on the source, red on the destination — the order promote-docs calls
  // them in.
  const stub = join(sandbox, "readback-stub.sh");
  const green = JSON.stringify({
    ok: true,
    axes: { state: { ok: true }, coverage: { ok: true }, content: { ok: true } },
    mismatch_count: 0,
    mode: "readback",
  });
  const red = JSON.stringify({
    ok: false,
    axes: { state: { ok: true }, coverage: { ok: false }, content: { ok: true } },
    mismatch_count: 3,
    mode: "readback",
  });
  writeFileSync(
    stub,
    [
      "#!/bin/sh",
      `COUNT="${join(sandbox, "readback-count")}"`,
      'n=$(cat "$COUNT" 2>/dev/null || echo 0)',
      "n=$((n+1))",
      'echo "$n" > "$COUNT"',
      'if [ "$n" -ge 2 ]; then',
      `  echo '${red}'`,
      "  exit 1",
      "fi",
      `echo '${green}'`,
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const run = spawnSync(
    process.execPath,
    [join(REPO, PROMOTE_REL), "--source", source, "--destination", destination, "--json"],
    {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      env: { ...process.env, AMANUENSIS_PYTHON: stub },
    },
  );
  if (run.error) return `the promotion script could not be run — ${run.error.message}`;
  if (run.status === 0) {
    return "the promotion script reported success after the read-back at the destination came back red";
  }
  if (readFileSync(join(destination, "index.md"), "utf8") !== previous) {
    return "a red read-back at the destination left the promoted bytes in place instead of the previous contents";
  }
  const leftovers = readdirSync(sandbox, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(".managed-destination."))
    .map((entry) => entry.name);
  if (leftovers.length) {
    return `the restored promotion left ${leftovers.join(", ")} beside the destination`;
  }
  return null;
});

if (sandbox) {
  try {
    rmSync(sandbox, { recursive: true, force: true });
  } catch {
    /* a leftover temporary directory is not a gate failure */
  }
}

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
      findingState: all("SELECT finding_id, resolution_state FROM finding_state_current"),
      gitState: all("SELECT last_checked_sha, canonical_branch FROM git_state"),
      ledger: all("SELECT subsystem_id, file_path, classification, stale FROM file_ledger"),
    };
    db.close();
  } catch (e) {
    liveError = e && e.message ? e.message : String(e);
  }
  if (live) emit("the live store at .amanuensis/memory.db, read directly and read-only");
  else emit("the live store at .amanuensis/memory.db could not be opened");
} else {
  emit(
    "the live store is absent here (`git ls-files .amanuensis` → 0), so the committed dogfood receipt is the whole gate; this is the mode CI runs in",
  );
}

if (existsSync(storeAbs)) {
  check("the live store opens for reading", () => liveError ?? (live ? null : "the store yielded no rows"));

  check("the live store's finding_state_current is exactly what the receipt recorded", () => {
    if (!live) return "the live store could not be read";
    const missing = requireReceipt();
    if (missing) return missing;
    const recorded = new Map(stateRowsOf().map((row) => [row.finding_id, row.resolution_state]));
    for (const row of live.findingState) {
      if (!recorded.has(row.finding_id)) {
        return `live finding ${row.finding_id} is not in the receipt's finding_state_current`;
      }
      if (recorded.get(row.finding_id) !== row.resolution_state) {
        return `live finding ${row.finding_id} resolves as ${row.resolution_state}; the receipt says ${recorded.get(row.finding_id)}`;
      }
    }
    const liveIds = new Set(live.findingState.map((row) => row.finding_id));
    const lost = [...recorded.keys()].filter((id) => !liveIds.has(id));
    if (lost.length) return `finding(s) ${lost.join(", ")} are in the receipt and not in the live store`;
    return null;
  });

  check("the live store is still at the revision the receipt recorded", () => {
    if (!live) return "the live store could not be read";
    const missing = requireReceipt();
    if (missing) return missing;
    const row = live.gitState[0];
    if (!row) return "the live store records no git state";
    if (row.last_checked_sha !== receipt.store?.last_checked_sha) {
      return `the live store was last checked at ${row.last_checked_sha}; the receipt records ${receipt.store?.last_checked_sha}`;
    }
    return null;
  });

  check("the three named files are examined in the live ledger", () => {
    if (!live) return "the live store could not be read";
    for (const path of DOGFOOD_LOCI) {
      const rows = live.ledger.filter((row) => row.file_path === path);
      if (!rows.length) return `${path} has no ledger row in the live store`;
      const unread = rows.filter((row) => row.classification !== "examined");
      if (unread.length) {
        return `${path} is ${unread.map((row) => `${row.subsystem_id}=${row.classification ?? "unclassified"}`).join(", ")} in the live ledger`;
      }
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
    `GATE P18 RED: the dogfood receipt and the promoted docs/ do not hold — ${failures.length} failed assertion(s) over the committed receipt, covering examined standing with a cited structural claim on three files, the exact fan-in of get_attention against finding_state_current, and the byte-match of every promoted page against the contract re-read at docs/; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("GATE P18 GREEN");
