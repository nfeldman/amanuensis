#!/usr/bin/env node
// GATE CR1 (design/survey-depth/spec.md §8.9a) — packet P8.
//
// `design/survey-depth/carry-receipt.json` is the denominator P10's survey
// counts its adjudications against, and P11 does not rewrite it. A denominator
// nothing compares against the thing it summarises is a number, not a
// denominator — so this gate reads the archived store the carry named, the
// receipt, and the live store the carry wrote into, and requires the three to
// agree.
//
// The status line addresses two readers. The lane's launcher greps the *packet*
// id (`^GATE P8 RED: `, `^GATE P8 GREEN`); the specification names this gate
// `CR1`. The packet marker leads and the spec gate's verdict is the reason it
// carries, so neither reader has to know about the other.
//
//   exit 0  `GATE P8 GREEN — GATE CR1 GREEN`
//   exit 1  `GATE P8 RED: GATE CR1 RED: <reason>`
//   exit 2  `GATE P8 CANNOT RUN: GATE CR1 CANNOT RUN: <reason>`
//
// **The third state is load-bearing** (§8.0 clause 3, claim C42). The archive
// is a machine-local absolute path outside the repository and the live store is
// untracked (`git ls-files .amanuensis` → 0). Where either is missing there is
// nothing to compare the receipt against, and a check that answered green there
// would be the zero-denominator green this repository has recorded three times
// (B03-2, B04-1, B04-3). `cannot run` is never offered as a red proof: the line
// begins `GATE P8 CANNOT RUN: `, which satisfies neither the launcher's red
// grep nor its green grep.
//
// Red when (§8.9a):
//   - the receipt is absent, unparseable, or does not declare this contract;
//   - it omits a finding id the archived store holds, or names one the archive
//     does not;
//   - it records an archived resolution state the archive's own row contradicts;
//   - it names a `carried_id` no `carried_findings` row in the live store has,
//     or one whose row belongs to a different archive or a different finding;
//   - its count differs from the `carry_runs` row's `expected_count` or
//     `imported_count`, or from the rows that run actually wrote;
//   - this gate does not run in `.github/workflows/test.yml`.
//
// Must-stay-green control (§8, every gate names one): the committed receipt at
// HEAD — all 22 ids present, every `carried_id` resolving, 22 = 22 = 22 — is
// green. That control alone would only prove the gate *can* pass, so the
// comparison is a pure function over three inputs and the selectivity arm below
// feeds it seeded faults one at a time, requiring each to fire its own family
// and nothing else (VP4(f): a kill proves a gate can fire, never that it fires
// selectively). The seeded arm needs no archive and no store, so it runs
// wherever the gate runs.
//
// False green it cannot exclude (§8.9a): the receipt is checked against the
// archive it names. A carry that named the wrong archive produces a receipt
// that is internally consistent and wrong. This gate narrows that by deriving
// §5.3's legacy identity from the archive it opens and requiring the receipt's
// `archived_store_id` to match — so a receipt relabelled after the fact is
// caught — but it cannot establish that the archive on this machine is *the*
// archive the rebuild should have carried from. Only the custody of the file
// itself says that.
//
// What a reviewer should sabotage, and what must go red:
//   delete a record from carry-receipt.json          → A3 (account)
//   change a record's archived_resolution            → A4 (resolution)
//   change a record's carried_id                     → A6 (carried)
//   change the receipt's count, or a carry_runs count → A5/A7 (counts)
//   relabel the receipt's archived_store_id          → A2 (archive)
//   drop the gate from .github/workflows/test.yml    → A8 (ci)
//   weaken evaluateReceipt so any of those passes    → the selectivity arm

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT_REL = "design/survey-depth/carry-receipt.json";
const STORE_REL = ".amanuensis/memory.db";
const CI_REL = ".github/workflows/test.yml";
const GATE_COMMAND = "node dev/test-carry-receipt.mjs";
const CONTRACT = "amanuensis-survey-depth/carry-receipt/v1";

const DEFAULT_ARCHIVE = join(
  process.env.HOME ?? "",
  ".claude/automations/amanuensis-clean-slate/archive/store-7c1c1a9/memory.db",
);
// Overridable for the same reason `dev/record-survey-depth-baseline.mjs` is:
// so the exit-2 path can be driven on a machine where the real archive is
// present. Pointing it at a different store changes the derived identity, which
// A2 rejects.
const ARCHIVE_PATH = resolve(process.env.AMANUENSIS_CARRY_ARCHIVE || DEFAULT_ARCHIVE);

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

// One headline per family, so the status line says which of §8.9a's red
// conditions fired rather than reporting a count.
const HEADLINES = {
  account: "the carry receipt does not account for every archived finding",
  archive: "the carry receipt names an archive whose identity it does not carry",
  resolution: "the carry receipt disagrees with the archive about a resolution state",
  carried: "the carry receipt names a carried_id no carried_findings row has",
  counts: "the carry receipt reports a count the carry run does not",
  ci: "this gate does not run in CI, so a break lands on a branch no run reports",
};

// ---------------------------------------------------------------------------
// The comparison, as a pure function of its three inputs
//
// Pure so that the selectivity arm can seed one fault at a time without an
// archive, a store, or a filesystem, and so that weakening it shows up in both
// arms at once.
//
//   archive  { archived_store_id, findings: [{ finding_id, resolution_state }] }
//   receipt  the parsed document, or null when it could not be read
//   store    { carried: [...], runs: [...] }, or null when no live store exists
//
// Returns [{ family, detail }] — empty when every assertion held.
// ---------------------------------------------------------------------------
export function evaluateReceipt({ archive, receipt, store }) {
  const failures = [];
  const fail = (family, detail) => failures.push({ family, detail: scrub(detail) });

  if (receipt === null || typeof receipt !== "object") {
    fail(
      "account",
      `${RECEIPT_REL} could not be read as a JSON object, so it accounts for none of the ` +
        `${archive.findings.length} finding(s) the archived store holds`,
    );
    return failures;
  }
  if (receipt.contract !== CONTRACT) {
    fail(
      "account",
      `${RECEIPT_REL} declares contract ${JSON.stringify(receipt.contract ?? null)}, not ` +
        `${CONTRACT}; nothing establishes that this document is the carry receipt at all`,
    );
    return failures;
  }

  // A2 — the receipt carries the identity of the archive it is checked against.
  const declaredId = receipt.archive?.archived_store_id ?? null;
  if (declaredId !== archive.archived_store_id) {
    fail(
      "archive",
      `the receipt records archived_store_id ${JSON.stringify(declaredId)} and the archive it ` +
        `is checked against derives ${archive.archived_store_id}; a receipt that names one ` +
        `archive and is checked against another is internally consistent and wrong`,
    );
  }

  const records = Array.isArray(receipt.records) ? receipt.records : null;
  if (records === null) {
    fail("account", `${RECEIPT_REL} carries no records array`);
    return failures;
  }

  // A3 — every archived id accounted for, exactly once, and nothing invented.
  const byId = new Map();
  const duplicated = [];
  for (const record of records) {
    const id = typeof record?.archived_finding_id === "string" ? record.archived_finding_id : "";
    if (byId.has(id)) duplicated.push(id);
    else byId.set(id, record);
  }
  const archived = new Map(archive.findings.map((row) => [row.finding_id, row]));
  const omitted = [...archived.keys()].filter((id) => !byId.has(id)).sort();
  const invented = [...byId.keys()].filter((id) => !archived.has(id)).sort();
  if (omitted.length) {
    fail(
      "account",
      `the receipt omits ${omitted.length} of the ${archived.size} finding id(s) the archive ` +
        `holds: ${omitted.join(", ")}`,
    );
  }
  if (invented.length) {
    fail(
      "account",
      `the receipt accounts for ${invented.length} id(s) the archive does not hold: ` +
        `${invented.join(", ")}`,
    );
  }
  if (duplicated.length) {
    fail("account", `the receipt records id(s) more than once: ${[...new Set(duplicated)].join(", ")}`);
  }

  // A4 — the archived resolution state, as the archive records it.
  for (const [id, row] of archived) {
    const record = byId.get(id);
    if (!record) continue;
    if (record.archived_resolution !== row.resolution_state) {
      fail(
        "resolution",
        `the receipt records ${id} as ${JSON.stringify(record.archived_resolution ?? null)} and ` +
          `the archive's own row reads ${JSON.stringify(row.resolution_state)}`,
      );
    }
  }

  // A5 — the receipt's own count is the count of what it accounts for.
  if (receipt.count !== records.length) {
    fail(
      "counts",
      `the receipt reports count ${JSON.stringify(receipt.count ?? null)} over ${records.length} ` +
        `record(s); the number and the rows beneath it disagree`,
    );
  }
  if (records.length !== archived.size) {
    fail(
      "account",
      `the receipt carries ${records.length} record(s) against the archive's ${archived.size} ` +
        `finding(s)`,
    );
  }

  if (store === null) return failures;

  // A6 — every carried_id resolves to the row it claims.
  const carriedById = new Map(store.carried.map((row) => [row.carried_id, row]));
  for (const record of records) {
    const id = record?.archived_finding_id ?? "";
    const carriedId = record?.carried_id;
    if (typeof carriedId !== "number" || !Number.isInteger(carriedId)) {
      fail("carried", `${id} records carried_id ${JSON.stringify(carriedId ?? null)}, which is not a row id`);
      continue;
    }
    const row = carriedById.get(carriedId);
    if (!row) {
      fail("carried", `${id} records carried_id ${carriedId}, which no carried_findings row has`);
      continue;
    }
    if (row.archived_finding_id !== id) {
      fail(
        "carried",
        `${id} records carried_id ${carriedId}, whose row carries ${row.archived_finding_id}`,
      );
    }
    if (row.archived_store_id !== archive.archived_store_id) {
      fail(
        "carried",
        `${id} records carried_id ${carriedId}, whose row was carried from ` +
          `${row.archived_store_id}, not from ${archive.archived_store_id}`,
      );
    }
    if (row.archived_resolution !== record.archived_resolution) {
      fail(
        "resolution",
        `${id} records archived_resolution ${JSON.stringify(record.archived_resolution ?? null)} ` +
          `and its carried_findings row reads ${JSON.stringify(row.archived_resolution)}`,
      );
    }
  }

  // A7 — the run the receipt names, and the two counts §5.2 keeps apart.
  const runId = receipt.carry_run?.carry_run_id ?? null;
  const run = store.runs.find((row) => row.id === runId);
  if (!run) {
    fail(
      "counts",
      `the receipt names carry_run_id ${JSON.stringify(runId)}, which no carry_runs row has, so ` +
        `no run declares what this carry was supposed to write`,
    );
  } else {
    if (run.expected_count !== records.length) {
      fail(
        "counts",
        `carry_runs row ${run.id} declares expected_count ${run.expected_count} and the receipt ` +
          `accounts for ${records.length}`,
      );
    }
    if (run.imported_count !== records.length) {
      fail(
        "counts",
        `carry_runs row ${run.id} records imported_count ${run.imported_count} and the receipt ` +
          `accounts for ${records.length}`,
      );
    }
    if (run.source_kind !== "store") {
      fail(
        "counts",
        `carry_runs row ${run.id} records source_kind ${JSON.stringify(run.source_kind)}; §5.8 ` +
          `carries from the archived store, because an export carries no store identity`,
      );
    }
    const written = store.carried.filter((row) => row.carry_run_id === run.id).length;
    if (written !== records.length) {
      fail(
        "counts",
        `carry_runs row ${run.id} has ${written} carried_findings row(s) and the receipt accounts ` +
          `for ${records.length}`,
      );
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Reading the two stores
// ---------------------------------------------------------------------------
function cannotRun(reason) {
  console.log(`GATE P8 CANNOT RUN: GATE CR1 CANNOT RUN: ${scrub(reason)}`);
  process.exit(2);
}

// node:sqlite is experimental and warns on import; this gate's stdout is its
// verdict and a runtime warning in the middle of it is noise.
process.removeAllListeners("warning");
process.on("warning", () => {});

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  cannotRun(`this runtime (${process.version}) carries no node:sqlite, so no store can be opened`);
}

/** A SQLite URI: '?' and '#' end the path, so they are what must be escaped. */
function immutableUri(path) {
  return `file:${encodeURI(path).replace(/\?/g, "%3f").replace(/#/g, "%23")}?immutable=1`;
}

function readArchive(path) {
  if (!existsSync(path)) {
    cannotRun(
      `the archived store is not readable at ${path}. GATE CR1's red requires it: without the ` +
        `archive there is no set of finding ids for the receipt to account for. Set ` +
        `AMANUENSIS_CARRY_ARCHIVE if it lives elsewhere on this machine`,
    );
  }
  let db;
  try {
    db = new DatabaseSync(immutableUri(path), { readOnly: true });
  } catch (error) {
    cannotRun(
      `the archived store at ${path} could not be opened immutably (${error?.code ?? error?.message ?? error})`,
    );
  }
  try {
    // §5.3's legacy identity, restated here rather than imported from the built
    // server so this gate runs on a bare checkout with nothing built.
    let git;
    try {
      git = db
        .prepare(
          "SELECT repo_id, canonical_branch, onboarding_sha, last_checked_sha FROM git_state ORDER BY repo_id LIMIT 1",
        )
        .get();
    } catch (error) {
      cannotRun(
        `the archived store at ${path} does not answer for its git_state row (${error?.message ?? error})`,
      );
    }
    if (!git) cannotRun(`the archived store at ${path} carries no git_state row, so it names no identity`);
    let minted = null;
    try {
      minted = db.prepare("SELECT store_generation FROM store_identity WHERE id = 1").get()
        ?.store_generation ?? null;
    } catch {
      minted = null; // frozen before store_identity existed: §5.3's legacy case
    }
    const tuple = [
      git.repo_id ?? "",
      git.canonical_branch ?? "",
      git.onboarding_sha ?? "",
      git.last_checked_sha ?? "",
    ].join("|");
    const hash = createHash("sha256").update(tuple).digest("hex");
    const archivedStoreId = minted
      ? `store-${String(minted).slice(0, 16)}`
      : `store-legacy-${hash.slice(0, 16)}`;
    // `resolution_state` derived exactly as `finding_state_current` derives it
    // (`schema.sql:1208-1218`), rather than selected from that view: the
    // archive was frozen before the view existed and carries only
    // `finding_resolution_current` and the legacy `findings.status` fallback.
    // A gate that selected from a view its subject does not have would read as
    // "cannot run" on the one archive it exists to check.
    let findings;
    try {
      findings = db
        .prepare(
          `SELECT f.finding_id,
                  COALESCE(r.resolution_state,
                           CASE f.status WHEN 'fixed'                THEN 'fixed-pending-verification'
                                         WHEN 'ruled-out'            THEN 'ruled-out'
                                         WHEN 'confirmed-acceptable' THEN 'accepted'
                                         ELSE 'open' END)            AS resolution_state
             FROM findings f
             LEFT JOIN finding_resolution_current r ON r.finding_id = f.finding_id
            ORDER BY f.finding_id`,
        )
        .all();
    } catch (error) {
      cannotRun(
        `the archived store at ${path} does not answer for its findings (${error?.message ?? error})`,
      );
    }
    if (findings.length === 0) {
      cannotRun(`the archived store at ${path} holds no findings, so there is no denominator here`);
    }
    return {
      archived_store_id: archivedStoreId,
      archived_anchor: git.last_checked_sha ?? git.onboarding_sha ?? "",
      findings,
    };
  } finally {
    try {
      db.close();
    } catch {
      /* the read already happened; a close failure changes no answer */
    }
  }
}

/**
 * The live store, read from a copy.
 *
 * Copied rather than opened in place because a read-only connection to a WAL
 * database needs a `-shm` it may not be allowed to create, and because a gate
 * must not be able to take a lock on the store it is judging. The copy is
 * writable, so SQLite replays the write-ahead log the running server left.
 */
function readLiveStore(path) {
  if (!existsSync(path)) return null;
  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-cr1-"));
  try {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(`${path}${suffix}`)) cpSync(`${path}${suffix}`, join(scratch, `memory.db${suffix}`));
    }
    let db;
    try {
      db = new DatabaseSync(join(scratch, "memory.db"));
    } catch (error) {
      return { unreadable: scrub(`the live store could not be opened (${error?.message ?? error})`) };
    }
    try {
      const carried = db
        .prepare(
          `SELECT carried_id, archived_finding_id, archived_store_id, archived_resolution, carry_run_id
             FROM carried_findings ORDER BY carried_id`,
        )
        .all();
      const runs = db
        .prepare(
          "SELECT id, source_kind, source_path, archived_store_id, expected_count, imported_count FROM carry_runs ORDER BY id",
        )
        .all();
      return { carried, runs };
    } catch (error) {
      return {
        unreadable: scrub(
          `the live store does not answer for carried_findings / carry_runs (${error?.message ?? error})`,
        ),
      };
    } finally {
      try {
        db.close();
      } catch {
        /* the read already happened */
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function readReceipt(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The selectivity arm: one seeded fault at a time over the same function
// ---------------------------------------------------------------------------
function controlTriple() {
  const archive = {
    archived_store_id: "store-legacy-0123456789abcdef",
    archived_anchor: "a".repeat(40),
    findings: [
      { finding_id: "X-1", resolution_state: "open" },
      { finding_id: "X-2", resolution_state: "verified-fixed" },
    ],
  };
  const receipt = {
    contract: CONTRACT,
    archive: { archived_store_id: archive.archived_store_id },
    carry_run: { carry_run_id: 7 },
    count: 2,
    records: [
      { archived_finding_id: "X-1", archived_resolution: "open", carried_id: 1 },
      { archived_finding_id: "X-2", archived_resolution: "verified-fixed", carried_id: 2 },
    ],
  };
  const store = {
    carried: [
      {
        carried_id: 1,
        archived_finding_id: "X-1",
        archived_store_id: archive.archived_store_id,
        archived_resolution: "open",
        carry_run_id: 7,
      },
      {
        carried_id: 2,
        archived_finding_id: "X-2",
        archived_store_id: archive.archived_store_id,
        archived_resolution: "verified-fixed",
        carry_run_id: 7,
      },
    ],
    runs: [
      {
        id: 7,
        source_kind: "store",
        source_path: "/archive/memory.db",
        archived_store_id: archive.archived_store_id,
        expected_count: 2,
        imported_count: 2,
      },
    ],
  };
  return { archive, receipt, store };
}

const SEEDED = [
  ["a dropped record", "account", (t) => t.receipt.records.pop()],
  ["an invented record", "account", (t) => t.receipt.records.push({ archived_finding_id: "X-9", archived_resolution: "open", carried_id: 3 })],
  ["a missing receipt", "account", (t) => { t.receipt = null; }],
  ["a foreign contract", "account", (t) => { t.receipt.contract = "something-else/v1"; }],
  ["a relabelled archive", "archive", (t) => { t.receipt.archive.archived_store_id = "store-legacy-ffffffffffffffff"; }],
  ["a rewritten resolution state", "resolution", (t) => { t.receipt.records[0].archived_resolution = "verified-fixed"; }],
  ["a carried_id nothing has", "carried", (t) => { t.receipt.records[0].carried_id = 99; }],
  ["a carried_id pointing at another finding", "carried", (t) => { t.receipt.records[0].carried_id = 2; }],
  ["a row carried from another archive", "carried", (t) => { t.store.carried[0].archived_store_id = "store-legacy-ffffffffffffffff"; }],
  ["a count that does not match the rows", "counts", (t) => { t.receipt.count = 3; }],
  ["a carry run nothing opened", "counts", (t) => { t.receipt.carry_run.carry_run_id = 99; }],
  ["a run that expected a different number", "counts", (t) => { t.store.runs[0].expected_count = 3; }],
  ["a run that imported a different number", "counts", (t) => { t.store.runs[0].imported_count = 1; }],
  ["a carry from the export instead of the store", "counts", (t) => { t.store.runs[0].source_kind = "export"; }],
  ["a run with fewer rows than the receipt claims", "counts", (t) => { t.store.carried.pop(); }],
];

// ---------------------------------------------------------------------------
const failures = [];
let checked = 0;
function record(family, detail) {
  failures.push({ family, detail: scrub(detail) });
}

const archive = readArchive(ARCHIVE_PATH);
const receipt = readReceipt(join(REPO, RECEIPT_REL));
const live = readLiveStore(join(REPO, STORE_REL));

// The document arm: the receipt against the archive. It runs everywhere the
// archive is readable, and it is what turns this gate red before the receipt
// exists.
const storeArm = live === null || live.unreadable ? null : live;
checked += 7;
for (const failure of evaluateReceipt({ archive, receipt, store: storeArm })) failures.push(failure);

// A8 — this gate runs in CI.
checked += 1;
{
  const workflow = join(REPO, CI_REL);
  if (!existsSync(workflow)) record("ci", `${CI_REL} is absent from the tree`);
  else if (!readFileSync(workflow, "utf8").includes(GATE_COMMAND)) {
    record("ci", `${CI_REL} does not run \`${GATE_COMMAND}\``);
  }
}

// The selectivity arm.
for (const [label, expected, seed] of SEEDED) {
  checked += 1;
  const triple = controlTriple();
  seed(triple);
  const fired = evaluateReceipt(triple);
  if (fired.length === 0) record("selectivity", `S: ${label} left the comparison green`);
  else if (!fired.some((entry) => entry.family === expected)) {
    record(
      "selectivity",
      `S: ${label} fired ${[...new Set(fired.map((e) => e.family))].join(", ")} rather than ${expected}`,
    );
  }
}
checked += 1;
{
  const control = evaluateReceipt(controlTriple());
  if (control.length > 0) {
    record("selectivity", `S0 the unsabotaged control is not green: ${control[0].detail}`);
  }
}

console.log(
  `  ran  ${checked} assertion(s) — archive ${archive.archived_store_id} ` +
    `(${archive.findings.length} finding(s)), receipt ${receipt === null ? "unreadable" : "read"}, ` +
    `live store ${storeArm === null ? "absent" : `${storeArm.carried.length} carried row(s)`}`,
);
for (const failure of failures) console.log(`  FAIL [${failure.family}] ${failure.detail}`);

if (failures.length > 0) {
  const headline =
    HEADLINES[failures[0].family] ??
    "the carry receipt comparison did not hold under a seeded fault";
  console.log(
    `GATE P8 RED: GATE CR1 RED: ${headline} — ${failures.length} of ${checked} assertion(s) ` +
      `failed; first: ${failures[0].detail}`,
  );
  process.exit(1);
}

// No failures, and the store arm never ran: there is nothing here that could
// have contradicted the receipt's carried_ids or its counts. That is an absence
// reported as an absence, not a pass (VP4(e)).
if (storeArm === null) {
  cannotRun(
    live?.unreadable
      ? `${live.unreadable}; the receipt's carried_ids and counts have nothing to be checked against`
      : `no live store at ${STORE_REL}, so the receipt's carried_ids and its counts have nothing ` +
          `to be checked against. GATE CR1 is green only where the store the carry wrote into can ` +
          `be read`,
  );
}

console.log("GATE P8 GREEN — GATE CR1 GREEN");
