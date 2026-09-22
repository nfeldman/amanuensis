#!/usr/bin/env node
// Pecia foreign-reference resolver for the `amanuensis:` scheme.
//
// Declared in .pecia/config.yaml as `resolvers: [amanuensis=dev/pecia-resolve-finding.mjs]`.
// Pecia's `audit` invokes it as `<command> <target>` from the repository root and
// reads only the exit code (pecia_cli.py:resolve_reference).
//
// Exit 0 means the referent RESOLVES — this repository's conspectus records a
// terminal disposition for the named finding that licenses a Pecia closure:
// `verified-fixed` (a repair proven by post-repair evidence bound to the repair
// lineage) or `ruled-out` (the finding overturned by new evidence in an
// adversarial pass). Those are the two Amanuensis states that close a defect,
// and they map to Pecia's `done` and `dropped` respectively.
//
// Rule 1 still applies: resolvable is not true. The claim licensed here is
// "Amanuensis holds a terminal disposition for this finding", not "the defect is
// gone". Note what is deliberately NOT licensed: `fixed-pending-verification`
// does not resolve. Someone claiming a repair is not the conspectus proving one,
// and the whole point of routing defects through this reference is that Pecia
// inherits that distinction instead of re-deciding it.
//
// This exists so the defect record in Pecia REFERS to the finding instead of
// copying it (ADAPTERS.md: prefer a reference whenever the source system remains
// the authority). Amanuensis owns finding state; Pecia owns scheduling. If a
// finding is later reopened, this stops resolving and `pecia audit` reports the
// closed defect as unresolvable — which is the cross-system check the reference
// is for.
//
// A destroyed referent used to be reported identically to a reopened one: a
// reinitialization discarded the store, and an id that had named a finding
// answered `no such finding in the conspectus` with nothing to say that the
// conspectus had been replaced. `carried_findings` is where that fact now
// lives, so this resolver reads it as step 2
// (design/survey-depth/spec.md §5.7):
//
//   1. `findings` / `finding_resolution_current` — unchanged.
//   2. otherwise `carried_findings` for the same id. The table is unique by
//      (archived_store_id, archived_finding_id), so an id alone can match rows
//      carried from two different archives; an ambiguous match is a REFUSAL,
//      never a choice, because picking the newest would let one archive's
//      decision answer for another's defect. A `successor-finding` outcome
//      re-runs step 1 against the successor and answers with *its* state;
//      `ruled-out`, `repaired` and `archived-terminal` resolve; no outcome
//      yet does not, which is the point — an inherited, undecided defect is
//      exactly what `pecia audit` should surface.
//   3. otherwise `no such finding in the conspectus` — unchanged.
//
// Exit codes: 0 resolved · 1 not resolved · 2 cannot run.
//
// It deliberately never prints its argument. The command is repo-local but the
// argument is ledger content, and a resolver that echoes it launders ledger text
// into an agent's context (pecia decision pc-cdb8).

// node:sqlite is experimental in Node 24 and warns on import. A resolver's stderr
// is noise in an audit run, so silence the warning before the module loads.
process.removeAllListeners("warning");
process.on("warning", () => {});

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = join(root, ".amanuensis", "memory.db");

// Pecia's FOREIGN_REF_RE already bounds the target to [A-Za-z0-9._/-]+, but this
// value crosses a process boundary into a SQL parameter, so re-check it here
// rather than trusting the caller's validation. The store-qualified form §5.7
// asks for adds one colon: `<store-id>:<finding-id>`.
const FINDING_ID = /^[A-Za-z0-9._-]+$/;
const QUALIFIED_ID = /^([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)$/;

function cannotRun(reason) {
  process.stderr.write(`amanuensis resolver cannot run: ${reason}\n`);
  process.exit(2);
}

const target = process.argv[2];
if (!target) cannotRun("no finding id argument");
const qualified = target ? QUALIFIED_ID.exec(target) : null;
const qualifiedStoreId = qualified ? qualified[1] : null;
const findingId = qualified ? qualified[2] : target;
if (!FINDING_ID.test(findingId) || (qualifiedStoreId !== null && !FINDING_ID.test(qualifiedStoreId))) {
  cannotRun("finding id is not in the accepted charset");
}
if (!existsSync(dbPath)) cannotRun("no conspectus at .amanuensis/memory.db");

const { DatabaseSync } = await import("node:sqlite");

let db;
try {
  db = new DatabaseSync(dbPath, { readOnly: true });
} catch (error) {
  cannotRun(`conspectus is unreadable (${error.code ?? error.message})`);
}

try {
  // finding_resolution_current is the authority; findings.status is a coarse
  // mutable projection the schema explicitly demotes. Fall back to the same
  // COALESCE the server's get_findings uses so a pre-resolution-proof store
  // still answers, rather than reporting a missing row as unresolvable.
  const liveState = (id) =>
    db
      .prepare(
        `SELECT COALESCE(r.resolution_state,
                  CASE f.status WHEN 'fixed' THEN 'fixed-pending-verification'
                                WHEN 'ruled-out' THEN 'ruled-out'
                                WHEN 'confirmed-acceptable' THEN 'accepted'
                                ELSE 'open' END) AS state
           FROM findings f
           LEFT JOIN finding_resolution_current r ON r.finding_id = f.finding_id
          WHERE f.finding_id = ?`,
      )
      .get(id) ?? null;

  // The two terminal dispositions that license a closure. Anything else — open,
  // accepted, or a repair still awaiting its proof — does not.
  const RESOLVES = new Set(["verified-fixed", "ruled-out"]);

  // Step 1, unchanged, and only for an unqualified id: the qualified form names
  // an archive, and no live finding is scoped to one.
  const live = qualifiedStoreId === null ? liveState(findingId) : null;
  if (live) {
    if (!RESOLVES.has(live.state)) {
      process.stderr.write(`finding is ${live.state}; no terminal disposition licenses a closure\n`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Step 2: the carried record. A store whose schema predates the carry has no
  // such table, and that is step 3's answer rather than an error.
  const hasCarried =
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='carried_findings'")
      .get() !== undefined;
  if (hasCarried) {
    const carried = db
      .prepare(
        `SELECT cf.carried_id, cf.archived_store_id, o.outcome AS outcome, o.successor_id
           FROM carried_findings cf
           LEFT JOIN carried_finding_outcomes o ON o.carried_id = cf.carried_id
          WHERE cf.archived_finding_id = ?` +
          (qualifiedStoreId === null ? "" : " AND cf.archived_store_id = ?") +
          " ORDER BY cf.archived_store_id",
      )
      .all(...(qualifiedStoreId === null ? [findingId] : [findingId, qualifiedStoreId]));

    if (carried.length > 1) {
      // Never a choice. Picking the newest, or the first, would let one
      // archive's decision answer for another archive's defect.
      process.stderr.write(
        `${carried.length} carried records share that id; qualify it as <store-id>:<finding-id>\n`,
      );
      process.exit(2);
    }
    const record = carried[0];
    if (record) {
      if (record.outcome === "successor-finding") {
        // The reference follows the finding into its successor, and answers
        // with the successor's state rather than with the fact that one exists.
        const successor = record.successor_id ? liveState(record.successor_id) : null;
        if (!successor) {
          process.stderr.write("carried record names a successor this store does not hold\n");
          process.exit(1);
        }
        if (!RESOLVES.has(successor.state)) {
          process.stderr.write(
            `carried record was re-found here and its successor is ${successor.state}; no terminal disposition licenses a closure\n`,
          );
          process.exit(1);
        }
        process.exit(0);
      }
      if (
        record.outcome === "ruled-out" ||
        record.outcome === "repaired" ||
        record.outcome === "archived-terminal"
      ) {
        process.exit(0);
      }
      // Inherited and undecided. This is the state the carry exists to make
      // visible: `pecia audit` reports the closed Pecia record as unresolvable
      // and the owner sees that a defect was discarded rather than decided.
      process.stderr.write(
        `carried from ${record.archived_store_id}, no terminal outcome recorded\n`,
      );
      process.exit(1);
    }
  }

  // Step 3. No such finding. Not an error in this repository's terms — the
  // reference simply does not resolve, which is exactly what audit should report.
  process.stderr.write("no such finding in the conspectus\n");
  process.exit(1);
} finally {
  try {
    db?.close();
  } catch {
    // A close failure cannot change a decision already made from the read.
  }
}
