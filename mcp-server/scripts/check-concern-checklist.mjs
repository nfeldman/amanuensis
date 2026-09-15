#!/usr/bin/env node
// `contracts/concern-checklist.json` — the calibrated checklist and the
// finding-id convention beside it, checked.
//
// Both were literals inside `dev/test-rebuild-depth.mjs` (`:104`), which counts
// a survey's concern coverage against them. The gate's own comment says why
// they could not move into a receipt: "Every denominator this gate counts
// against is read from a *different* committed document than the one under
// test … A numerator and its denominator that shrink together prove nothing
// (GP24)." A standalone contract keeps that separation — but a contract nothing
// checks is a literal with a longer path, so this is the check
// `design/survey-depth/spec.md` §8.10 asks for.
//
//   node scripts/check-concern-checklist.mjs            check
//   node scripts/check-concern-checklist.mjs --quiet    check, print only failures
//
// Two arms, and the first runs everywhere.
//
// **The document arm** reads the contract and the territory catalog the
// calibration was derived from, and fails when the checklist is malformed,
// when a code repeats, when a concern names a territory the catalog does not
// declare, when a declared territory is neither covered by a concern nor
// disqualified with a reason — onboarding Phase 4's "do **not** silently skip",
// made mechanical — when a territory is somehow both, or when the finding-id
// convention is not a usable pattern or does not accept its own example.
//
// **The live-store arm** runs only where `.amanuensis/memory.db` exists, and
// requires the contract's codes to be exactly the store's active concerns. It
// is what stops the contract drifting from the calibration it claims to record.
// Its absence is reported, not passed over: a check that said nothing about the
// arm it could not run would be reporting a narrower pass as a wider one.
//
// Exit 0 when every assertion held, 1 otherwise. There is no third state: the
// document arm needs nothing but the repository.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MCP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(MCP, "..");
const CONTRACT_REL = "mcp-server/contracts/concern-checklist.json";
const CATALOG_REL = ".claude/skills/amanuensis/references/concern-territories.md";
const STORE_REL = ".amanuensis/memory.db";
const CONTRACT = "amanuensis/concern-checklist/v1";
const CODE_SHAPE = /^[A-Z]{2}-\d+$/;

const quiet = process.argv.includes("--quiet");

// node:sqlite is experimental and warns on import; this check's output is its
// verdict and a runtime warning in the middle of it is noise. A runtime without
// it fails the one arm that needs it, not the whole check.
process.removeAllListeners("warning");
process.on("warning", () => {});
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const failures = [];
let checked = 0;
function check(label, fn) {
  checked++;
  try {
    const detail = fn();
    if (detail) failures.push(`${label}: ${detail}`);
  } catch (error) {
    failures.push(`${label}: threw — ${String(error?.message ?? error).replace(/\s+/g, " ")}`);
  }
}

let doc = null;
check("the contract parses and declares itself", () => {
  const path = join(REPO, CONTRACT_REL);
  if (!existsSync(path)) return `${CONTRACT_REL} is absent`;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return `${CONTRACT_REL} is not valid JSON (${error?.message ?? error})`;
  }
  if (doc.contract !== CONTRACT) {
    return `${CONTRACT_REL} declares contract ${JSON.stringify(doc.contract ?? null)}, not ${CONTRACT}`;
  }
  return null;
});

/** Territory ids the catalog declares, e.g. T1 … T11. */
function catalogTerritories() {
  const path = join(REPO, CATALOG_REL);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const ids = [...text.matchAll(/^## Territory (\d+)\s+—/gm)].map((match) => `T${match[1]}`);
  return ids.length ? ids : null;
}

check("every concern is well formed and its code is unique", () => {
  if (!doc) return "the contract did not parse";
  const concerns = Array.isArray(doc.concerns) ? doc.concerns : null;
  if (!concerns || concerns.length === 0) return "the contract declares no concerns";
  const seen = new Set();
  const bad = [];
  for (const concern of concerns) {
    const code = concern?.code;
    if (typeof code !== "string" || !CODE_SHAPE.test(code)) {
      bad.push(`${JSON.stringify(code ?? null)} is not a <XX>-<N> code`);
      continue;
    }
    if (seen.has(code)) bad.push(`${code} is declared twice`);
    seen.add(code);
    if (typeof concern.category !== "string" || concern.category.trim() === "") {
      bad.push(`${code} names no category`);
    }
    if (typeof concern.territory !== "string" || concern.territory.trim() === "") {
      bad.push(`${code} names no territory`);
    }
    // A concern nobody can falsify is a concern nobody can dispose of.
    if (typeof concern.probe !== "string" || concern.probe.trim().length < 40) {
      bad.push(`${code} carries no codebase-specific probe`);
    }
  }
  return bad.length ? bad.join("; ") : null;
});

check("every territory is covered or disqualified, and none is both", () => {
  if (!doc) return "the contract did not parse";
  const declared = catalogTerritories();
  if (declared === null) return `${CATALOG_REL} declares no territories this check could read`;
  const covered = new Set((doc.concerns ?? []).map((concern) => concern?.territory));
  const disqualified = new Map(
    (doc.disqualified_territories ?? []).map((entry) => [entry?.territory, entry]),
  );
  const problems = [];
  for (const territory of declared) {
    const isCovered = covered.has(territory);
    const entry = disqualified.get(territory);
    if (!isCovered && !entry) {
      problems.push(
        `${territory} is declared in the catalog and is neither covered by a concern nor ` +
          `disqualified with a reason`,
      );
    }
    if (isCovered && entry) {
      problems.push(`${territory} is both covered by a concern and listed as disqualified`);
    }
    if (entry && (typeof entry.reason !== "string" || entry.reason.trim().length < 40)) {
      problems.push(`${territory} is disqualified with no stated reason`);
    }
  }
  for (const territory of covered) {
    if (!declared.includes(territory)) {
      problems.push(`a concern names territory ${JSON.stringify(territory)}, which the catalog does not declare`);
    }
  }
  return problems.length ? problems.join("; ") : null;
});

check("the finding-id convention is a usable pattern that accepts its own example", () => {
  if (!doc) return "the contract did not parse";
  const convention = doc.finding_id_convention;
  if (!convention || typeof convention.template !== "string") {
    return "the contract declares no finding_id_convention.template";
  }
  if (!convention.template.includes("{subsystem_compact}")) {
    return "the template carries no {subsystem_compact} placeholder, so it cannot be applied per subsystem";
  }
  const example = convention.example;
  if (typeof example?.subsystem_id !== "string" || typeof example?.finding_id !== "string") {
    return "the convention carries no {subsystem_id, finding_id} example to test itself against";
  }
  let pattern;
  try {
    pattern = new RegExp(
      convention.template.replace("{subsystem_compact}", example.subsystem_id.replaceAll("-", "")),
    );
  } catch (error) {
    return `the template is not a usable pattern (${error?.message ?? error})`;
  }
  if (!pattern.test(example.finding_id)) {
    return `the template rejects its own example ${example.finding_id} for ${example.subsystem_id}`;
  }
  // The convention exists to keep this survey's findings from shadowing the
  // ids it carried (spec.md §5.7), so the archived shape must *not* match.
  const archivedShape = `${example.subsystem_id.replaceAll("-", "")}-5`;
  if (pattern.test(archivedShape)) {
    return (
      `the template also accepts ${archivedShape}, the shape the archived conspectus used; a ` +
      `finding named that way would shadow the carried obligation of the same id`
    );
  }
  return null;
});

check("the contract is what the live store's active concerns say", () => {
  const store = join(REPO, STORE_REL);
  if (!existsSync(store)) {
    // Reported, not passed over. `--quiet` still prints this line.
    console.log(
      `  note no store at ${STORE_REL}; the calibration arm did not run and the document arm ` +
        `alone is what passed here`,
    );
    return null;
  }
  if (!doc) return "the contract did not parse";
  if (DatabaseSync === null) {
    console.log(
      `  note this runtime (${process.version}) carries no node:sqlite; the calibration arm did ` +
        `not run and the document arm alone is what passed here`,
    );
    return null;
  }
  let db;
  try {
    db = new DatabaseSync(store, { readOnly: true });
  } catch (error) {
    return `the live store could not be opened read-only (${error?.message ?? error})`;
  }
  try {
    const active = db
      .prepare("SELECT code FROM concerns WHERE status = 'active' ORDER BY code")
      .all()
      .map((row) => row.code);
    const declared = (doc.concerns ?? []).map((concern) => concern?.code).sort();
    const missing = active.filter((code) => !declared.includes(code));
    const extra = declared.filter((code) => !active.includes(code));
    if (missing.length || extra.length) {
      return (
        `the store's active concerns and the contract disagree —` +
        `${missing.length ? ` the store has ${missing.join(", ")} and the contract does not;` : ""}` +
        `${extra.length ? ` the contract has ${extra.join(", ")} and the store does not;` : ""}` +
        ` a checklist that has drifted from the calibration it records is a denominator nobody set`
      );
    }
    return null;
  } finally {
    try {
      db.close();
    } catch {
      /* the read already happened */
    }
  }
});

if (!quiet) console.log(`  ran  ${checked} assertion(s) over ${CONTRACT_REL}`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
if (failures.length) {
  console.log(
    `concern checklist: ${failures.length} of ${checked} assertion(s) failed; the checklist is the ` +
      `denominator dev/test-rebuild-depth.mjs counts against`,
  );
  process.exit(1);
}
if (!quiet) {
  console.log(
    `concern checklist: ${doc.concerns.length} active concern(s), ` +
      `${(doc.disqualified_territories ?? []).length} disqualified territory(ies), ` +
      `finding ids ${doc.finding_id_convention.template}`,
  );
}
