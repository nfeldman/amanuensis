#!/usr/bin/env node
// The reader-lenses P20 regeneration pass, written into the live
// self-conspectus store through the server's own tool handlers.
//
// Three slice-S6 findings needed writes to a store that is untracked, which is
// why they could not be closed by editing a committed receipt:
//
//   F6 — every current `<sid>/` claim now needs a durable challenge outcome
//        before its subsystem may hold `mapped`. P19's adversarial pass
//        already probed all of them and recorded each probe as a field note;
//        the outcome had nowhere to live because `claim_validity_events`
//        admits only asserted/invalidated/superseded/revalidated and a
//        surviving claim closes no interval. This transcribes each recorded
//        probe into `claim_challenge_outcomes` **with a pointer back to the
//        note it came from**, so nothing here is presented as a fresh reading:
//        `field_note_id` says exactly which probe produced it. A claim whose
//        probe note is missing is reported and skipped, never invented.
//
//   F7 — `mcp-server/src/index.ts` imports and registers tool arrays owned by
//        B-05, B-06, B-07 and B-09 with no recorded edge, so the topology drew
//        a registry that depends on four subsystems it never names. Those four
//        edges are recorded here through `add_xref`, each with a citation
//        token the tool validates and resolves.
//
// It runs through the built tool handlers rather than by writing SQL, for the
// reason the skill gives: a row the tools would have refused is a row the
// conspectus cannot stand behind. It is idempotent — an outcome or an edge
// that is already recorded is left alone — so a partial run can be repeated.
//
// Usage: node dev/record-regeneration-pass.mjs [--dry-run]

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STORAGE = join(REPO, ".amanuensis");
const DRY_RUN = process.argv.includes("--dry-run");

if (!existsSync(join(STORAGE, "memory.db"))) {
  process.stderr.write(`no store at ${join(STORAGE, "memory.db")}\n`);
  process.exit(1);
}

const { openDatabase } = await import("../mcp-server/dist/db.js");
const { resolveProject } = await import("../mcp-server/dist/project.js");
const { claimTools } = await import("../mcp-server/dist/tools/claims.js");
const { xrefTools } = await import("../mcp-server/dist/tools/xrefs.js");
const { projectTools } = await import("../mcp-server/dist/tools/project.js");
const { storageHistoryTools } = await import("../mcp-server/dist/tools/storage-history.js");

const TOOLS = new Map(
  [...claimTools, ...xrefTools, ...projectTools, ...storageHistoryTools].map((tool) => [tool.name, tool]),
);

const project = resolveProject(REPO, {
  selectionSource: "dev/record-regeneration-pass.mjs",
  serverVersion: "regeneration-pass",
});
const db = openDatabase(project.dbPath);
const ctx = { project, db, sessionId: null };

function call(name, args) {
  const tool = TOOLS.get(name);
  if (!tool) throw new Error(`${name} is not exported by the built tools`);
  return tool.handler(args, ctx);
}

const all = (sql, ...params) => db.prepare(sql).all(...params);
const one = (sql, ...params) => db.prepare(sql).get(...params) ?? null;

// ---------------------------------------------------------------------------
// F7 — the registry's own crossings, read off `mcp-server/src/index.ts`.
//
// Each entry is a reading of that file: the importer is B-01 (the module is in
// B-01's ledger), the target is the subsystem whose ledger owns the modules it
// pulls in, and the context says what the dependency *is* rather than that one
// file imports another. The citation names where the edge was read; symbol
// reachability is deliberately unchecked (spec.md §9.2).
// ---------------------------------------------------------------------------
const REGISTRY_EDGES = [
  {
    from_id: "B-01",
    to_id: "B-05",
    relationship: "dependency",
    context:
      "the finding, disposition, concern, contradiction and resolution tools reach a client only " +
      "through the single registry this module concatenates and dispatches against, so the " +
      "resolution custody surface exists for a caller exactly when the registry carries it, read at " +
      "mcp-server/src/index.ts:allTools@__SHA__",
  },
  {
    from_id: "B-01",
    to_id: "B-06",
    relationship: "dependency",
    context:
      "the reader-lens tools are placed at the head of the advertised list deliberately — §5.5 " +
      "makes list order the order a host reads — and describe_locus is also the one name the " +
      "read-only annotation carve-out holds, so the registry decides both that the consumer route " +
      "is reachable and that it is annotated as a query, read at " +
      "mcp-server/src/index.ts:READ_ONLY_TOOLS@__SHA__",
  },
  {
    from_id: "B-01",
    to_id: "B-07",
    relationship: "dependency",
    context:
      "the git-state, staleness, change-impact and refresh tools are registered by this module and " +
      "by nothing else, so the freshness surface a host can call is whatever the registry admits, " +
      "read at mcp-server/src/index.ts:allTools@__SHA__",
  },
  {
    from_id: "B-01",
    to_id: "B-09",
    relationship: "dependency",
    context:
      "materialize_docs and verify_materialized_docs are dispatched through this registry, so the " +
      "publication and read-back custody path is entered through the same validator and annotation " +
      "rules every other tool call is, read at mcp-server/src/index.ts:allTools@__SHA__",
  },
];

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------
const head = one("SELECT last_checked_sha FROM git_state WHERE repo_id = 'default'")?.last_checked_sha;
if (!head) throw new Error("the store records no last_checked_sha to bind this pass to");

const report = { outcomes_written: 0, outcomes_present: 0, edges_written: 0, edges_present: 0, skipped: [] };

if (!DRY_RUN) {
  // The session opens first: `commit_phase_gate` is itself a gated write, and
  // the snapshot has to be attributable to the pass that took it.
  ctx.sessionId = call("start_session", {
    intent:
      "P20 regeneration: transcribe P19's recorded adversarial probes into the durable " +
      "challenge-outcome record, and record the registry crossings index.ts makes visible",
  }).session_id;
  call("commit_phase_gate", {
    label: "Pre-regeneration snapshot (P20): before challenge outcomes and the registry edges",
  });
}

// --- F6: one outcome per claim, from the probe note that produced it ---------
const probesByKey = new Map();
for (const note of all("SELECT id, observation FROM field_notes ORDER BY id")) {
  const match = /adversarial probe for claim (\S+)/.exec(String(note.observation ?? ""));
  if (!match) continue;
  if (!probesByKey.has(match[1])) probesByKey.set(match[1], []);
  probesByKey.get(match[1]).push(note);
}

/**
 * The probe note that is about *this* claim.
 *
 * A `claim_key` whose first reading was overturned and re-asserted has two
 * notes under one key: the one that overturned the predecessor and the one
 * that confirmed the successor. Taking the first would attach the overturning
 * text to the surviving claim — a transcription that says the opposite of what
 * the outcome says. A note that names the claim id is about that claim; where
 * none does, a note whose wording announces an overturning is not the record
 * of a claim that survived.
 */
function probeFor(claim) {
  const notes = probesByKey.get(claim.claim_key) ?? [];
  const namesClaim = (note) => String(note.observation).includes(claim.claim_id);
  // A note that opens by announcing an overturning is the record of the
  // overturning, even when its later sentences also name the successor.
  const announcesOverturn = (note) => /overturned it|superseded it/.test(String(note.observation));
  const wanted = claim.valid_until_sha === null ? announcesOverturn : (note) => !announcesOverturn(note);
  const ordered = [
    notes.find((note) => namesClaim(note) && !wanted(note)),
    notes.find((note) => !wanted(note)),
    notes.find(namesClaim),
    notes[0],
  ];
  return ordered.find(Boolean) ?? null;
}

const recorded = new Set(all(`SELECT claim_id FROM claim_challenge_outcomes`).map((row) => row.claim_id));

for (const claim of all("SELECT claim_id, claim_key, valid_until_sha FROM claims ORDER BY claim_key, claim_id")) {
  if (recorded.has(claim.claim_id)) {
    report.outcomes_present += 1;
    continue;
  }
  // A closed claim carries an outcome only when an event closed it: that event
  // *is* the outcome, and its reason is the challenge that produced it.
  if (claim.valid_until_sha !== null) {
    const event = one(
      `SELECT id, event_type, reason FROM claim_validity_events
        WHERE claim_id = ? AND at_sha = ? AND event_type IN ('invalidated','superseded')
        ORDER BY id DESC LIMIT 1`,
      claim.claim_id,
      claim.valid_until_sha,
    );
    if (!event) {
      report.skipped.push(`${claim.claim_id} is closed and no validity event records what closed it`);
      continue;
    }
    const outcome = event.event_type === "invalidated" ? "overturned" : "superseded";
    const closingNote = probeFor(claim);
    if (!DRY_RUN) {
      call("record_claim_challenge", {
        claim_id: claim.claim_id,
        outcome,
        challenge: event.reason,
        ref_sha: claim.valid_until_sha,
        validity_event_id: event.id,
        ...(closingNote ? { field_note_id: closingNote.id } : {}),
      });
    }
    report.outcomes_written += 1;
    continue;
  }
  const note = probeFor(claim);
  if (!note) {
    report.skipped.push(`${claim.claim_id} (${claim.claim_key}) has no recorded probe to transcribe`);
    continue;
  }
  if (!DRY_RUN) {
    call("record_claim_challenge", {
      claim_id: claim.claim_id,
      outcome: "survived",
      challenge: note.observation,
      ref_sha: head,
      field_note_id: note.id,
    });
  }
  report.outcomes_written += 1;
}

// --- F7: the four registry crossings -----------------------------------------
const edgePairs = new Set(all("SELECT from_id, to_id FROM xrefs").map((row) => `${row.from_id}→${row.to_id}`));
for (const edge of REGISTRY_EDGES) {
  if (edgePairs.has(`${edge.from_id}→${edge.to_id}`)) {
    report.edges_present += 1;
    continue;
  }
  if (!DRY_RUN) {
    call("add_xref", {
      from_id: edge.from_id,
      to_id: edge.to_id,
      relationship: edge.relationship,
      strength: "structural",
      context: edge.context.replace(/__SHA__/g, head),
    });
  }
  report.edges_written += 1;
}

if (!DRY_RUN) {
  call("commit_phase_gate", {
    label:
      `P20 regeneration · ${report.outcomes_written} claim challenge outcomes transcribed from their ` +
      `probe notes, ${report.edges_written} registry crossings recorded`,
  });
  call("end_session", { session_id: ctx.sessionId, outcome: "completed" });
}

db.close();

process.stdout.write(
  `${DRY_RUN ? "[dry run] " : ""}${report.outcomes_written} challenge outcome(s) written ` +
    `(${report.outcomes_present} already present), ${report.edges_written} edge(s) written ` +
    `(${report.edges_present} already present)\n`,
);
for (const line of report.skipped) process.stdout.write(`  skipped: ${line}\n`);
process.exit(report.skipped.length ? 1 : 0);
