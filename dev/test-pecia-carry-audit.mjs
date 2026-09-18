#!/usr/bin/env node
// GATE PA1 (design/survey-depth/spec.md §8.9b) — packet P9.
//
// The 2026-09-14 clean-slate rebuild destroyed the conspectus that eight closed
// Pecia defects cite as the evidence licensing their closure. `pecia audit`
// reported all eight as `unresolvable-evidence`: a closure whose licence had
// disappeared. §5.8's carry brings the archived findings forward and §5.7's
// resolver follows a reference into the carried record, so the eight can now be
// answered — but only if somebody says, on the record, which carried record
// answers for which closure. `dev/pecia-dogfood.md` is where that is said, and
// this gate is what stops it drifting from the carry it describes.
//
// The lane's launcher greps the *packet* id (`^GATE P9 RED: `, `^GATE P9
// GREEN`); the specification names this gate `PA1`. The packet marker leads and
// the spec gate's verdict is the reason it carries, so neither reader has to
// know about the other.
//
//   exit 0  `GATE P9 GREEN — GATE PA1 GREEN`
//   exit 1  `GATE P9 RED: GATE PA1 RED: <reason>`
//   exit 2  `GATE P9 CANNOT RUN: GATE PA1 CANNOT RUN: <reason>`
//
// Red when (§8.9b):
//   - `dev/pecia-dogfood.md` carries no accounting table, carries two, or
//     leaves any of the eight closed Pecia records unaccounted;
//   - a row accounts for a record by naming a reference that record does not
//     carry;
//   - a row names a `carried_id` no `carried_findings` row has, or one whose
//     row carries a different archived finding or came from another archive;
//   - a row names an outcome the carried record's own outcome contradicts;
//   - a row accounts for a Pecia record the audit does not report;
//   - the projection no longer carries exactly the eight closed
//     amanuensis-referenced records §8.9b names — the denominator moved under
//     the numerator, which is the arithmetic this lane exists to refuse (GP24);
//   - the document does not name the gap the audit leaves open (B03-R2);
//   - where the live store is readable, a reference the document declares
//     answered does not in fact resolve through `dev/pecia-resolve-finding.mjs`;
//   - this gate does not run in `.github/workflows/test.yml`.
//
// **Every denominator is read from a document other than the one under test.**
// The eight records come from `.pecia/work.jsonl`, the Pecia projection. The
// carried records they must name come from `design/survey-depth/acceptance-
// receipt.json`'s `blocking.B5.carried` — P11's committed witness of
// `carried_findings` joined to `carried_finding_outcomes`, which `GATE A1`
// recomputes against the live store. Neither is a P9 deliverable, so this gate
// cannot be satisfied by editing the document it judges.
//
// Must-stay-green control (§8.9b): a dogfood document naming all eight, each
// with a resolving carried id, is green — that is the committed document at
// HEAD. A control alone would only prove the gate *can* pass, so the comparison
// is a pure function over its four inputs and the selectivity arm below feeds it
// seeded faults one at a time, requiring each to fire its own family and nothing
// else (VP4(f): a kill proves a gate can fire, never that it fires selectively).
// The seeded arm needs no store and runs wherever the gate runs.
//
// **The gap this gate cannot close** (§8.9b, acceptance clause 3). `pecia audit`
// enumerates only *closed* records whose reference stopped resolving. An **open**
// Pecia record pointing at a destroyed finding is reported by nothing: the audit
// does not look at it, so it is outside the eight and outside every assertion
// here. That is candidate finding **B03-R2**, which the acceptance rebuild
// carries forward rather than closes — carried record 11, outcome
// `successor-finding` into B03-R2 — and this gate requires the document to say
// so rather than let the silence read as coverage.
//
// A second gap, narrower: the eight are derived as the terminal records whose
// evidence is an `amanuensis:` reference, and that set is then required to equal
// the eight §8.9b names. So this gate notices a record leaving the set, but it
// takes the spec's word for which eight the 2026-09-14 audit reported; the
// audit output itself (`~/.claude/automations/amanuensis-clean-slate/report.md`)
// is machine-local and outside the repository.
//
// What a reviewer should sabotage, and what must go red:
//   delete a row from the dogfood accounting table   → account
//   point a row at another finding's reference       → reference
//   change a row's carried_id to 99, or to another
//     row's id                                       → carried
//   change a row's outcome to `ruled-out`            → outcome
//   add a row for a Pecia record the audit is silent
//     about                                          → extra
//   drop a closed record from .pecia/work.jsonl      → census
//   remove B03-R2 from the document                  → gap
//   record an outcome the live store contradicts     → outcome (store arm)
//   break dev/pecia-resolve-finding.mjs for one id   → resolves (store arm)
//   drop the gate from .github/workflows/test.yml    → ci
//   weaken evaluateCarryAudit so any of those passes → the selectivity arm

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOGFOOD_REL = "dev/pecia-dogfood.md";
const LEDGER_REL = ".pecia/work.jsonl";
const ACCEPTANCE_REL = "design/survey-depth/acceptance-receipt.json";
const STORE_REL = ".amanuensis/memory.db";
const RESOLVER_REL = "dev/pecia-resolve-finding.mjs";
const CI_REL = ".github/workflows/test.yml";
const GATE_COMMAND = "node dev/test-pecia-carry-audit.mjs";

const SCHEME = "amanuensis";
// Pecia treats closure as final; these are the three states it closes into, and
// they are the states `pecia audit` checks a foreign reference against.
const TERMINAL = new Set(["done", "dropped", "superseded"]);
const OUTCOMES = new Set(["successor-finding", "ruled-out", "repaired", "archived-terminal"]);

// §8.9b names these. They are the *control* on the derivation below, never its
// source: the set is derived from the projection and then required to equal
// this, so a record leaving the projection is a red rather than a smaller
// denominator that the same numerator satisfies.
const SPEC_EIGHT = [
  "pc-1a91",
  "pc-207e",
  "pc-707e",
  "pc-80b8",
  "pc-833d",
  "pc-adce",
  "pc-ae87",
  "pc-d688",
];

// The gap of §8.9b: an open Pecia record pointing at a destroyed finding is
// outside the audit. The document must name the finding that carries it.
const GAP_FINDING = "B03-R2";

// The header row that opens the accounting table. A heading's wording may be
// revised; this is the contract between the document and this gate.
const TABLE_KEY = "Pecia record";

// Every message this gate prints is scrubbed of these, so an absent deliverable
// reads as a failed assertion rather than as a gate that never reached one
// (§8.0 clause 1).
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

// One headline per family, so the status line says which of §8.9b's red
// conditions fired rather than reporting a count. `account` carries the
// packet's declared red_expect phrase verbatim.
const HEADLINES = {
  account: "dev/pecia-dogfood.md leaves a closed Pecia record unaccounted",
  reference: "an accounting row names a reference its Pecia record does not carry",
  carried: "an accounting row names a carried record the carry did not write",
  outcome: "an accounting row names an outcome the carried record contradicts",
  extra: "an accounting row answers for a Pecia record the audit does not report",
  census: "the closed records the audit reports are no longer the eight §8.9b names",
  gap: "the document does not name the gap the audit leaves open",
  resolves: "a reference the document declares answered does not resolve",
  ci: "this gate does not run in CI, so a break lands on a branch no run reports",
  selectivity: "the comparison stayed green under a seeded fault",
};

// ---------------------------------------------------------------------------
// The comparison, as a pure function of its inputs
//
// Pure so that the selectivity arm can seed one fault at a time without a
// store, a ledger or a filesystem, and so that weakening it shows up in both
// arms at once.
//
//   closed    [{ pecia_id, reference, status }]  terminal records carrying an
//                                                amanuensis reference
//   carried   [{ carried_id, archived_finding_id, archived_store_id, outcome }]
//   archiveId the archive §5.8 carried from, as the acceptance receipt declares
//             it — read from `baseline.archived_store_id`, not derived from the
//             rows, so a row relabelled to another archive is a red rather than
//             a second archive the majority silently absorbs
//   table     null (absent) | { ambiguous: n } | { rows, malformed }
//   gapNoted  boolean — the document names GAP_FINDING
//
// Returns [{ family, detail }] — empty when every assertion held.
// ---------------------------------------------------------------------------
export function evaluateCarryAudit({ closed, carried, archiveId, table, gapNoted }) {
  const failures = [];
  const fail = (family, detail) => failures.push({ family, detail: scrub(detail) });

  const expected = new Map(closed.map((row) => [row.pecia_id, row]));

  // A1 — the accounting exists, and there is exactly one of it.
  if (table === null) {
    fail(
      "account",
      `${DOGFOOD_REL} carries no table whose first column is "${TABLE_KEY}", so it accounts for ` +
        `none of the ${expected.size} closed Pecia record(s) whose reference the clean-slate ` +
        `rebuild destroyed: ${[...expected.keys()].sort().join(", ")}`,
    );
    return failures;
  }
  if (table.ambiguous) {
    fail(
      "account",
      `${DOGFOOD_REL} carries ${table.ambiguous} tables whose first column is "${TABLE_KEY}"; ` +
        `two accountings are two answers, and this gate will not choose between them`,
    );
    return failures;
  }

  for (const bad of table.malformed ?? []) {
    fail("account", `${DOGFOOD_REL} line ${bad.line}: ${bad.reason}`);
  }

  // A2 — every one of the eight accounted for, exactly once, and nothing else.
  const byPecia = new Map();
  const duplicated = [];
  for (const row of table.rows) {
    if (byPecia.has(row.pecia_id)) duplicated.push(row.pecia_id);
    else byPecia.set(row.pecia_id, row);
  }
  const unaccounted = [...expected.keys()].filter((id) => !byPecia.has(id)).sort();
  if (unaccounted.length) {
    fail(
      "account",
      `${unaccounted.length} of ${expected.size} closed record(s) have no accounting row: ` +
        `${unaccounted.join(", ")}`,
    );
  }
  if (duplicated.length) {
    fail(
      "account",
      `the accounting answers twice for ${[...new Set(duplicated)].sort().join(", ")}`,
    );
  }
  const invented = [...byPecia.keys()].filter((id) => !expected.has(id)).sort();
  if (invented.length) {
    fail(
      "extra",
      `the accounting answers for ${invented.length} record(s) the audit does not report as a ` +
        `closed reference that stopped resolving: ${invented.join(", ")}`,
    );
  }

  // A3 — the census control. The eight are derived from the projection above;
  // this is where the derivation is held against the set §8.9b named.
  const derived = [...expected.keys()].sort().join(", ");
  const named = [...SPEC_EIGHT].sort().join(", ");
  if (derived !== named) {
    fail(
      "census",
      `the projection carries ${expected.size} terminal record(s) with an ${SCHEME} reference ` +
        `(${derived || "none"}); §8.9b names 8 (${named}). A denominator that moves under a ` +
        `fixed numerator is not a denominator`,
    );
  }

  // A4..A6 — each row against the record it answers for and the carry it cites.
  const carriedById = new Map(carried.map((row) => [row.carried_id, row]));
  for (const row of table.rows) {
    const record = expected.get(row.pecia_id);
    if (!record) continue; // already reported as `extra`

    // A4 — the reference the row claims is the reference the record carries.
    if (row.reference !== record.reference) {
      fail(
        "reference",
        `${row.pecia_id} is accounted for as \`${row.reference}\` and the Pecia record's own ` +
          `evidence reads \`${record.reference}\``,
      );
      continue;
    }
    const findingId = record.reference.slice(SCHEME.length + 1);

    // A5 — the carried record named exists and is the one for this finding.
    const carriedRow = carriedById.get(row.carried_id);
    if (!carriedRow) {
      fail(
        "carried",
        `${row.pecia_id} is answered by carried_id ${row.carried_id}, which no carried_findings ` +
          `row has; the closure is licensed by a record the carry never wrote`,
      );
      continue;
    }
    if (carriedRow.archived_finding_id !== findingId) {
      fail(
        "carried",
        `${row.pecia_id} cites \`${record.reference}\` and is answered by carried_id ` +
          `${row.carried_id}, whose row carries ${carriedRow.archived_finding_id}`,
      );
      continue;
    }
    if (carriedRow.archived_store_id !== archiveId) {
      fail(
        "carried",
        `${row.pecia_id} is answered by carried_id ${row.carried_id}, whose row was carried ` +
          `from ${carriedRow.archived_store_id}, and §5.8's carry declares ${archiveId}. One ` +
          `archive's decision may not answer for another's defect (§5.7)`,
      );
      continue;
    }

    // A6 — the outcome the row states is the outcome recorded against it.
    if (carriedRow.outcome === null || carriedRow.outcome === undefined) {
      fail(
        "outcome",
        `${row.pecia_id} is answered by carried_id ${row.carried_id} with outcome ` +
          `\`${row.outcome}\`, and no outcome is recorded against that carried record; an ` +
          `undecided obligation licenses no closure`,
      );
      continue;
    }
    if (carriedRow.outcome !== row.outcome) {
      fail(
        "outcome",
        `${row.pecia_id} is answered by carried_id ${row.carried_id} with outcome ` +
          `\`${row.outcome}\`, and the carried record's own outcome is ` +
          `\`${carriedRow.outcome}\``,
      );
    }
  }

  // A7 — the gap the audit leaves open is named, not left as silence.
  if (!gapNoted) {
    fail(
      "gap",
      `${DOGFOOD_REL} does not name ${GAP_FINDING}. \`pecia audit\` sees only closed records, so ` +
        `an open record pointing at a destroyed finding is invisible to it and to this gate; a ` +
        `document that reports the eight without that sentence reads as coverage`,
    );
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Reading the inputs
// ---------------------------------------------------------------------------
function cannotRun(reason) {
  console.log(`GATE P9 CANNOT RUN: GATE PA1 CANNOT RUN: ${scrub(reason)}`);
  process.exit(2);
}

// node:sqlite is experimental and warns on import; this gate's stdout is its
// verdict and a runtime warning in the middle of it is noise.
process.removeAllListeners("warning");
process.on("warning", () => {});

/**
 * The Pecia projection's heads, and the closed records carrying a reference
 * into the conspectus.
 *
 * `work.jsonl` carries every revision; the head is the highest `rev` per id,
 * which is how `dev/amanuensis-defects-to-pecia.mjs:readHeads` reads it.
 */
function readClosedReferences(path) {
  if (!existsSync(path)) {
    cannotRun(
      `there is no Pecia projection at ${LEDGER_REL}, so nothing declares which closed records ` +
        `cite the conspectus. This gate's denominator is that file`,
    );
  }
  const heads = new Map();
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    cannotRun(`${LEDGER_REL} could not be read (${error?.message ?? error})`);
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      cannotRun(`${LEDGER_REL} carries a line that is not JSON, so the projection cannot be read`);
    }
    const prior = heads.get(record.id);
    if (!prior || record.rev > prior.rev) heads.set(record.id, record);
  }
  const closed = [];
  for (const record of heads.values()) {
    if (!TERMINAL.has(record.status)) continue;
    const evidence = typeof record.evidence === "string" ? record.evidence : "";
    if (!evidence.startsWith(`${SCHEME}:`)) continue;
    closed.push({ pecia_id: record.id, reference: evidence, status: record.status });
  }
  closed.sort((a, b) => (a.pecia_id < b.pecia_id ? -1 : 1));
  return { heads, closed };
}

/**
 * P11's committed witness of the carry: `carried_findings` joined to
 * `carried_finding_outcomes`, recorded in the acceptance receipt and recomputed
 * against the live store by `GATE A1`. It is read here rather than the live
 * store because the store is untracked (`git ls-files .amanuensis` → 0) and
 * this gate must be able to answer on a bare checkout.
 */
function readCarriedWitness(path) {
  if (!existsSync(path)) {
    cannotRun(
      `there is no acceptance receipt at ${ACCEPTANCE_REL}, so no committed document says which ` +
        `carried records the carry wrote`,
    );
  }
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    cannotRun(`${ACCEPTANCE_REL} is not readable as JSON (${error?.message ?? error})`);
  }
  const rows = receipt?.blocking?.B5?.carried;
  if (!Array.isArray(rows) || rows.length === 0) {
    cannotRun(
      `${ACCEPTANCE_REL} carries no blocking.B5.carried witness, so there is no committed record ` +
        `of what the carry wrote for the accounting to be checked against`,
    );
  }
  const archiveId = receipt?.baseline?.archived_store_id;
  if (typeof archiveId !== "string" || archiveId.length === 0) {
    cannotRun(
      `${ACCEPTANCE_REL} declares no baseline.archived_store_id, so nothing says which archive ` +
        `§5.8 carried from and a row citing another archive could not be told apart`,
    );
  }
  return {
    archiveId,
    rows: rows.map((row) => ({
      carried_id: row.carried_id,
      archived_finding_id: row.archived_finding_id,
      archived_store_id: row.archived_store_id,
      outcome: row.outcome ?? null,
    })),
  };
}

/**
 * The accounting table.
 *
 * Strict by design: every fact a row asserts is a backticked code span, so a
 * sentence of prose in the same row cannot be mistaken for an assertion and a
 * missing assertion cannot be read out of surrounding text. Exactly one span
 * per field, or the row is malformed and the gate says which line.
 */
export function parseAccounting(markdown) {
  const lines = markdown.split("\n");
  const tables = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cells = rowCells(lines[i]);
    if (!cells || cells[0] !== TABLE_KEY) continue;
    const delimiter = rowCells(lines[i + 1]);
    if (!delimiter || !delimiter.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    const rows = [];
    const malformed = [];
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      const body = rowCells(lines[j]);
      if (!body) break;
      const spans = [...lines[j].matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
      const pick = (pattern) => {
        const hit = [...new Set(spans.filter((span) => pattern.test(span)))];
        return hit.length === 1 ? hit[0] : null;
      };
      const peciaId = pick(/^pc-[0-9a-f]{4,}$/);
      const reference = pick(new RegExp(`^${SCHEME}:[A-Za-z0-9._-]+$`));
      const carried = pick(/^carried_id \d+$/);
      const outcome = [...new Set(spans.filter((span) => OUTCOMES.has(span)))];
      const missing = [];
      if (!peciaId) missing.push("exactly one `pc-<id>` span");
      if (!reference) missing.push(`exactly one \`${SCHEME}:<finding>\` span`);
      if (!carried) missing.push("exactly one `carried_id <n>` span");
      if (outcome.length !== 1) missing.push("exactly one outcome span");
      if (missing.length) {
        malformed.push({
          line: j + 1,
          reason: `an accounting row must carry ${missing.join(", ")}; this row carries ${
            spans.length
          } code span(s)`,
        });
        continue;
      }
      rows.push({
        pecia_id: peciaId,
        reference,
        carried_id: Number.parseInt(carried.slice("carried_id ".length), 10),
        outcome: outcome[0],
        line: j + 1,
      });
    }
    tables.push({ rows, malformed });
    i = j;
  }
  if (tables.length === 0) return null;
  if (tables.length > 1) return { ambiguous: tables.length };
  return tables[0];
}

/** A Markdown table row: `| a | b |`. Cells carry no unescaped pipe. */
function rowCells(line) {
  if (typeof line !== "string") return null;
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|") || trimmed.length < 3) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * The live store, read from a copy.
 *
 * Copied rather than opened in place because a read-only connection to a WAL
 * database needs a `-shm` it may not be allowed to create, and because a gate
 * must not take a lock on the store it is judging. Absent on a bare checkout,
 * which narrows this gate rather than stopping it: every assertion above is
 * over committed documents.
 */
async function readLiveCarried(path) {
  if (!existsSync(path)) return null;
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return null; // a runtime with no node:sqlite narrows the gate the same way
  }
  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-pa1-"));
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
      return {
        rows: db
          .prepare(
            `SELECT cf.carried_id, cf.archived_finding_id, cf.archived_store_id, o.outcome
               FROM carried_findings cf
               LEFT JOIN carried_finding_outcomes o ON o.carried_id = cf.carried_id
              ORDER BY cf.carried_id`,
          )
          .all()
          .map((row) => ({ ...row, outcome: row.outcome ?? null })),
      };
    } catch (error) {
      return {
        unreadable: scrub(
          `the live store does not answer for carried_findings (${error?.message ?? error})`,
        ),
      };
    } finally {
      try {
        db.close();
      } catch {
        /* the read already happened; a close failure changes no answer */
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The selectivity arm: one seeded fault at a time over the same function
// ---------------------------------------------------------------------------
function controlInputs() {
  const closed = SPEC_EIGHT.map((id, index) => ({
    pecia_id: id,
    reference: `${SCHEME}:T0${index}-1`,
    status: "done",
  }));
  const archiveId = "store-legacy-0123456789abcdef";
  const carried = closed.map((row, index) => ({
    carried_id: index + 1,
    archived_finding_id: `T0${index}-1`,
    archived_store_id: archiveId,
    outcome: "archived-terminal",
  }));
  const rows = closed.map((row, index) => ({
    pecia_id: row.pecia_id,
    reference: row.reference,
    carried_id: index + 1,
    outcome: "archived-terminal",
    line: 40 + index,
  }));
  return { closed, carried, archiveId, table: { rows, malformed: [] }, gapNoted: true };
}

const SEEDED = [
  ["a dropped accounting row", "account", (t) => t.table.rows.pop()],
  ["no accounting table at all", "account", (t) => { t.table = null; }],
  ["two accounting tables", "account", (t) => { t.table = { ambiguous: 2 }; }],
  ["a row answering twice", "account", (t) => t.table.rows.push({ ...t.table.rows[0] })],
  ["a malformed row", "account", (t) => t.table.malformed.push({ line: 9, reason: "no outcome span" })],
  ["a row for a record the audit is silent about", "extra", (t) => {
    t.table.rows.push({ ...t.table.rows[0], pecia_id: "pc-0000" });
  }],
  ["a reference the record does not carry", "reference", (t) => {
    t.table.rows[0].reference = `${SCHEME}:T99-9`;
  }],
  ["a carried_id nothing has", "carried", (t) => { t.table.rows[0].carried_id = 99; }],
  ["a carried_id pointing at another finding", "carried", (t) => { t.table.rows[0].carried_id = 2; }],
  ["a carried row from another archive", "carried", (t) => {
    t.carried[0].archived_store_id = "store-legacy-ffffffffffffffff";
  }],
  ["an outcome the carried record contradicts", "outcome", (t) => {
    t.table.rows[0].outcome = "ruled-out";
  }],
  ["a closure licensed by an undecided obligation", "outcome", (t) => {
    t.carried[0].outcome = null;
  }],
  ["a closed record dropped from the projection", "census", (t) => {
    t.closed.pop();
    t.table.rows.pop();
  }],
  ["a ninth closed record in the projection", "census", (t) => {
    t.closed.push({ pecia_id: "pc-ffff", reference: `${SCHEME}:T99-1`, status: "done" });
    t.table.rows.push({
      pecia_id: "pc-ffff",
      reference: `${SCHEME}:T99-1`,
      carried_id: 1,
      outcome: "archived-terminal",
      line: 99,
    });
  }],
  ["the gap left as silence", "gap", (t) => { t.gapNoted = false; }],
];

// ---------------------------------------------------------------------------
const failures = [];
let checked = 0;
function record(family, detail) {
  failures.push({ family, detail: scrub(detail) });
}

const { closed } = readClosedReferences(join(REPO, LEDGER_REL));
const { archiveId, rows: carried } = readCarriedWitness(join(REPO, ACCEPTANCE_REL));
const dogfoodPath = join(REPO, DOGFOOD_REL);
const markdown = existsSync(dogfoodPath) ? readFileSync(dogfoodPath, "utf8") : "";
const table = parseAccounting(markdown);
const gapNoted = new RegExp(`\\b${GAP_FINDING}\\b`).test(markdown);

// The document arm. It runs everywhere, and it is what turns this gate red
// before the accounting exists.
checked += 7;
for (const failure of evaluateCarryAudit({ closed, carried, archiveId, table, gapNoted })) {
  failures.push(failure);
}

// The store arm. It narrows the document arm where the store the carry wrote
// into can be read, and its absence is never a pass: nothing above depends on
// it.
const live = await readLiveCarried(join(REPO, STORE_REL));
let storeNote = "absent";
if (live?.unreadable) {
  storeNote = "unreadable";
} else if (live?.rows) {
  storeNote = `${live.rows.length} carried row(s)`;
  const byId = new Map(live.rows.map((row) => [row.carried_id, row]));
  for (const row of table?.rows ?? []) {
    checked += 1;
    const actual = byId.get(row.carried_id);
    if (!actual) {
      record(
        "carried",
        `${row.pecia_id} is answered by carried_id ${row.carried_id}, which no carried_findings ` +
          `row in the live store has`,
      );
      continue;
    }
    if (actual.outcome !== row.outcome) {
      record(
        "outcome",
        `${row.pecia_id} is answered by carried_id ${row.carried_id} with outcome ` +
          `\`${row.outcome}\`, and the live store records ` +
          `\`${actual.outcome ?? "no outcome"}\``,
      );
    }
  }

  // `pecia audit` re-run, through the resolver `pecia audit` itself calls
  // (.pecia/config.yaml: `resolvers: [amanuensis=dev/pecia-resolve-finding.mjs]`).
  // A document that says a closure is answered, over a resolver that still says
  // it is not, is a claim about the carry that the carry does not support.
  const resolver = join(REPO, RESOLVER_REL);
  if (existsSync(resolver)) {
    for (const row of table?.rows ?? []) {
      checked += 1;
      const findingId = row.reference.slice(SCHEME.length + 1);
      const result = spawnSync(process.execPath, [resolver, findingId], {
        cwd: REPO,
        encoding: "utf8",
      });
      if (result.error) {
        record("resolves", `${RESOLVER_REL} could not be run for ${row.pecia_id}`);
        continue;
      }
      if (result.status !== 0) {
        record(
          "resolves",
          `${row.pecia_id} is accounted for as answered by carried_id ${row.carried_id}, and ` +
            `${RESOLVER_REL} exits ${result.status} for its reference — the closure is still ` +
            `unlicensed and \`pecia audit\` still reports it`,
        );
      }
    }
  } else {
    record("resolves", `${RESOLVER_REL} is absent, so no reference can be re-resolved`);
  }
}

// The gate runs in CI.
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
  const inputs = controlInputs();
  seed(inputs);
  const fired = evaluateCarryAudit(inputs);
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
  const control = evaluateCarryAudit(controlInputs());
  if (control.length > 0) {
    record("selectivity", `S0 the unsabotaged control is not green: ${control[0].detail}`);
  }
}

console.log(
  `  ran  ${checked} assertion(s) — ${closed.length} closed Pecia record(s) citing the ` +
    `conspectus, ${carried.length} carried record(s) in the acceptance witness, accounting ` +
    `${table === null ? "absent" : table.ambiguous ? `ambiguous (${table.ambiguous} tables)` : `${table.rows.length} row(s)`}, ` +
    `live store ${storeNote}`,
);
for (const failure of failures) console.log(`  FAIL [${failure.family}] ${failure.detail}`);

if (failures.length > 0) {
  const headline = HEADLINES[failures[0].family] ?? HEADLINES.account;
  console.log(
    `GATE P9 RED: GATE PA1 RED: ${headline} — ${failures.length} of ${checked} assertion(s) ` +
      `failed; first: ${failures[0].detail}`,
  );
  process.exit(1);
}

console.log("GATE P9 GREEN — GATE PA1 GREEN");
