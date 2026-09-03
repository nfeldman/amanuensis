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
// rather than trusting the caller's validation.
const FINDING_ID = /^[A-Za-z0-9._-]+$/;

function cannotRun(reason) {
  process.stderr.write(`amanuensis resolver cannot run: ${reason}\n`);
  process.exit(2);
}

const target = process.argv[2];
if (!target) cannotRun("no finding id argument");
if (!FINDING_ID.test(target)) cannotRun("finding id is not in the accepted charset");
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
  const row = db
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
    .get(target);

  if (!row) {
    // No such finding. Not an error in this repository's terms — the reference
    // simply does not resolve, which is exactly what audit should report.
    process.stderr.write("no such finding in the conspectus\n");
    process.exit(1);
  }
  // The two terminal dispositions that license a closure. Anything else — open,
  // accepted, or a repair still awaiting its proof — does not.
  if (row.state !== "verified-fixed" && row.state !== "ruled-out") {
    process.stderr.write(`finding is ${row.state}; no terminal disposition licenses a closure\n`);
    process.exit(1);
  }
  process.exit(0);
} finally {
  try {
    db?.close();
  } catch {
    // A close failure cannot change a decision already made from the read.
  }
}
