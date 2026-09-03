#!/usr/bin/env node
// Project Amanuensis's confirmed defects into the Pecia work ledger.
//
//   node dev/amanuensis-defects-to-pecia.mjs            # plan only (default)
//   node dev/amanuensis-defects-to-pecia.mjs --json     # plan as JSON
//   node dev/amanuensis-defects-to-pecia.mjs --apply    # write through the pecia CLI
//
// WHAT THIS IS. Amanuensis decides what is a defect and whether a repair is
// proven; Pecia schedules work. This carries the first into the second without
// creating a second authority for one fact: a finding becomes a Pecia `defect`
// whose evidence is the foreign reference `amanuensis:<finding_id>`, resolved by
// dev/pecia-resolve-finding.mjs. Nothing about the finding's truth is copied —
// only enough to schedule against, plus a pointer back (ADAPTERS.md: prefer a
// reference over a copy whenever the source system remains the authority).
//
// WHAT IT IS NOT. Not an importer. Findings change state as repairs land and are
// verified, so this reconciles: it reads the current Pecia head for each finding
// and appends a revision only when the projection differs. Under format v2 that
// is native — `rev` is a compare-and-swap token and `touched` is computed by the
// tool — so this drives `pecia add|edit|close` rather than appending to
// .pecia/work.jsonl, which v2 demoted to a regenerated projection (E015 fires if
// anything writes to it as if it were authority).
//
// THE MAPPING THAT MATTERS. `fixed-pending-verification` maps to `in-progress`,
// never `done`. Both systems independently refuse to let "fixed" mean "verified":
// Amanuensis withholds verified-fixed until post-repair evidence lands, and
// Pecia's E007 requires evidence licensing a defect's closure. A defect only
// closes here once the resolver can license it.
//
// Exit codes: 0 plan produced or applied cleanly · 1 apply failed · 2 cannot run.

process.removeAllListeners("warning");
process.on("warning", () => {});

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = join(root, ".amanuensis", "memory.db");
const ledgerPath = join(root, ".pecia", "work.jsonl");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const asJson = args.includes("--json");

const SCHEME = "amanuensis";
const OWNER = "import:amanuensis";
// 4 is `someday` and is excluded from `next` — a confirmed defect never belongs there.
const PRIORITY = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const TERMINAL = new Set(["done", "dropped", "superseded"]);

// Amanuensis resolution state -> what Pecia should hold. `accepted` is absent on
// purpose: confirmed-acceptable is a reviewed decision that the behavior is
// intended, which is not a defect and must not enter a defect ledger.
const STATE = {
  open: { status: "open" },
  "fixed-pending-verification": { status: "in-progress" },
  "verified-fixed": { status: "done" },
  "ruled-out": { status: "dropped" },
};

function cannotRun(reason) {
  process.stderr.write(`cannot run: ${reason}\n`);
  process.exit(2);
}

if (!existsSync(dbPath)) cannotRun("no conspectus at .amanuensis/memory.db");
if (!existsSync(ledgerPath)) cannotRun("no Pecia ledger at .pecia/work.jsonl — run `pecia init` first");

// ---------------------------------------------------------------------------
// Read both sides.
// ---------------------------------------------------------------------------

const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(dbPath, { readOnly: true });

const findings = db
  .prepare(
    `SELECT f.finding_id, f.subsystem_id, f.symptom, f.root_cause, f.severity,
            f.status, f.business_context, f.fix_location, f.ref_sha, f.pass_type,
            COALESCE(r.resolution_state,
              CASE f.status WHEN 'fixed' THEN 'fixed-pending-verification'
                            WHEN 'ruled-out' THEN 'ruled-out'
                            WHEN 'confirmed-acceptable' THEN 'accepted'
                            ELSE 'open' END) AS resolution_state,
            r.fix_sha, r.rationale AS resolution_rationale
       FROM findings f
       LEFT JOIN finding_resolution_current r ON r.finding_id = f.finding_id
      ORDER BY f.finding_id`,
  )
  .all();
db.close();

// work.jsonl carries every revision; the head is the highest rev per id. It is a
// projection and may be behind the log — that is clean, not an error (v2 §6) —
// so `--apply` regenerates it first rather than planning against a stale read.
function readHeads() {
  const heads = new Map();
  for (const line of readFileSync(ledgerPath, "utf8").split("\n")) {
    const text = line.trim();
    if (!text) continue;
    let rec;
    try {
      rec = JSON.parse(text);
    } catch {
      cannotRun("the Pecia projection contains a line that is not JSON");
    }
    const prior = heads.get(rec.id);
    if (!prior || rec.rev > prior.rev) heads.set(rec.id, rec);
  }
  return heads;
}

// A finding's label can legitimately cover a CHAIN of records, because Pecia
// treats closure as final: a finding that comes back after its defect closed
// gets a successor carrying `discovered_from`, never an illegal reopen (E005).
// So the label resolves to the chain's tail — the record no other record in the
// chain was discovered from — which is the same rule dev/pecia-dogfood.md records
// for the roadmap validator. Two records that independently claim one finding are
// two tails, and that fails closed rather than picking one.
function indexBySourceLabel(heads) {
  const chains = new Map();
  for (const rec of heads.values()) {
    for (const label of rec.labels ?? []) {
      if (!label.startsWith(`${SCHEME}:`)) continue;
      const findingId = label.slice(SCHEME.length + 1);
      if (!chains.has(findingId)) chains.set(findingId, []);
      chains.get(findingId).push(rec);
    }
  }
  const byFinding = new Map();
  const collisions = [];
  for (const [findingId, members] of chains) {
    const predecessors = new Set(
      members.map((r) => r.edges?.discovered_from).filter(Boolean),
    );
    const tails = members.filter((r) => !predecessors.has(r.id));
    if (tails.length === 1) byFinding.set(findingId, tails[0]);
    else collisions.push({ finding: findingId, tails: tails.map((r) => r.id) });
  }
  return { byFinding, collisions };
}

function describeCollisions(collisions) {
  return collisions
    .map((c) => `${c.finding} (${c.tails.length === 0 ? "cycle" : c.tails.join(", ")})`)
    .join("; ");
}

// ---------------------------------------------------------------------------
// Project one finding into the record this adapter owns.
// ---------------------------------------------------------------------------

function firstSentence(text, cap) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  const cut = flat.split(/(?<=\.)\s/)[0] ?? flat;
  const chosen = cut.length > 0 && cut.length <= cap ? cut : flat;
  return chosen.length <= cap ? chosen : `${chosen.slice(0, cap - 1).trimEnd()}…`;
}

function project(finding) {
  const target = STATE[finding.resolution_state];
  if (!target) return null; // `accepted` and anything unmapped: see skip reporting.

  const labels = [
    `${SCHEME}:${finding.finding_id}`,
    `subsystem:${finding.subsystem_id}`,
    `severity:${finding.severity}`,
  ];

  // Rule 3: absence is declared, not silent. Everything the conspectus holds
  // that this record does not carry is named here, so a reader of the ledger
  // can see the boundary rather than infer it.
  const body = [
    `**Symptom.** ${String(finding.symptom).trim()}`,
    "",
    `**Root cause.** ${String(finding.root_cause).trim()}`,
    ...(finding.business_context
      ? ["", `**Why it matters.** ${String(finding.business_context).trim()}`]
      : []),
    "",
    "**Not carried by this projection.** Amanuensis remains the authority for this",
    "finding. Its evidence rows, concern dispositions, contradiction links, field",
    "notes and append-only resolution history are not copied here; the record's",
    `evidence is the reference \`${SCHEME}:${finding.finding_id}\`, which resolves`,
    "only while the conspectus records the finding as verified-fixed. Inter-finding",
    "relations are not projected as edges: a contradiction is not a dependency, and",
    "a wrong edge is worse than a declared absence.",
    "",
    `_Provenance: ${finding.finding_id} in .amanuensis/memory.db · subsystem ` +
      `${finding.subsystem_id} · severity ${finding.severity} · recorded at ` +
      `${finding.ref_sha} by the ${finding.pass_type} pass · source status ` +
      `"${finding.status}" · source resolution state "${finding.resolution_state}"._`,
  ].join("\n");

  return {
    type: "defect",
    title: `${finding.finding_id} — ${firstSentence(finding.symptom, 96)}`,
    status: target.status,
    priority: PRIORITY[finding.severity] ?? 2,
    owner: OWNER,
    labels,
    body,
    // The reference is attached only where it can resolve. `audit` runs the
    // resolver against every head carrying a foreign reference, not only closed
    // ones, so putting `amanuensis:<id>` on an open defect would report an
    // unresolvable reference for every defect still legitimately open — turning
    // the one signal that should mean "a closure lost its licence" into constant
    // noise. E007 requires evidence on `defect` + `done`; that is exactly where
    // it goes.
    evidence: TERMINAL.has(target.status) ? `${SCHEME}:${finding.finding_id}` : null,
    disposition: TERMINAL.has(target.status) ? disposition(finding) : null,
  };
}

// Composed from source facts only. Never a rationale this adapter invented.
function disposition(finding) {
  const at = finding.fix_sha ? ` Repair recorded at ${finding.fix_sha}.` : "";
  if (finding.resolution_state === "verified-fixed") {
    return (
      `Amanuensis records ${finding.finding_id} as verified-fixed: post-repair ` +
      `evidence was collected and bound to the repair lineage.${at} ` +
      `Verified by the conspectus, not by this ledger.`
    );
  }
  return (
    `Amanuensis records ${finding.finding_id} as ruled-out: adversarial review ` +
    `overturned the finding with new evidence.` +
    (finding.resolution_rationale ? ` Recorded rationale: ${finding.resolution_rationale}` : "")
  );
}

// ---------------------------------------------------------------------------
// Plan.
// ---------------------------------------------------------------------------

// "unknown" is pecia's own placeholder for evidence a record does not yet carry;
// null and "" mean the same thing. Normalizing them is what makes re-running
// this adapter a no-op rather than a perpetual edit.
function absentEvidence(value) {
  return value == null || value === "" || value === "unknown" ? null : value;
}

function planFor(finding, head) {
  const want = project(finding);
  if (!want) {
    return {
      action: "skip",
      finding: finding.finding_id,
      reason: `resolution state "${finding.resolution_state}" is not a defect`,
    };
  }
  if (!head) {
    return { action: "create", finding: finding.finding_id, want };
  }
  // E005: terminal states are final. A finding that came back after its record
  // closed needs a successor record, never an illegal reopen.
  if (TERMINAL.has(head.status) && !TERMINAL.has(want.status)) {
    return {
      action: "reopen",
      finding: finding.finding_id,
      pecia: head.id,
      want,
      reason: `Pecia record is ${head.status} but the finding is ${finding.resolution_state}`,
    };
  }
  const changed = [];
  if (head.title !== want.title) changed.push("title");
  if (head.status !== want.status) changed.push("status");
  if (head.priority !== want.priority) changed.push("priority");
  if ((head.body ?? "") !== want.body) changed.push("body");
  // `pecia add` seeds evidence as "unknown", and this adapter leaves it unset on
  // a non-terminal defect. Treat both as absent, or every run would diff a null
  // want-value against "unknown" and re-edit a record that is already correct.
  if (absentEvidence(head.evidence) !== absentEvidence(want.evidence)) changed.push("evidence");
  if (want.disposition && head.disposition !== want.disposition) changed.push("disposition");
  const haveLabels = [...(head.labels ?? [])].sort().join(" ");
  if (haveLabels !== [...want.labels].sort().join(" ")) changed.push("labels");

  if (changed.length === 0) {
    return { action: "noop", finding: finding.finding_id, pecia: head.id };
  }
  const closing = TERMINAL.has(want.status) && !TERMINAL.has(head.status);
  return {
    action: closing ? "close" : "update",
    finding: finding.finding_id,
    pecia: head.id,
    want,
    changed,
  };
}

const heads = readHeads();
const { byFinding, collisions } = indexBySourceLabel(heads);
if (collisions.length) {
  cannotRun(`a finding's record chain does not resolve to one tail: ${describeCollisions(collisions)}`);
}

const plan = findings.map((f) => planFor(f, byFinding.get(f.finding_id)));

// ---------------------------------------------------------------------------
// Report / apply.
// ---------------------------------------------------------------------------

const counts = plan.reduce((acc, p) => ((acc[p.action] = (acc[p.action] ?? 0) + 1), acc), {});

// Since format v1.4 the write gate IS the checker: pecia refuses any write that
// would introduce a new error finding, and reports it as one or more
// "write refused" findings on stdout with exit 1. That is a verdict about ONE
// record, not a broken tool — so it must not abort the run. The case that makes
// this concrete is E016 (v2.4): a defect someone has since triaged behind an open
// blocker cannot be closed, even once Amanuensis verifies the repair, because the
// ledger knows something the conspectus does not. Escalating that finding and
// continuing is the same rule the survey methodology applies to a blocked unit.
//
// Returns { ok } on success, { refused } when the checker declined, and aborts
// only when pecia itself could not run.
function pecia(argv, label) {
  const result = spawnSync("pecia", argv, { cwd: root, encoding: "utf8" });
  if (result.error) cannotRun(`pecia is not runnable: ${result.error.message}`);
  if (result.status === 0) {
    try {
      return { ok: true, data: JSON.parse(result.stdout) };
    } catch {
      return { ok: true, data: {} };
    }
  }
  const refusals = [];
  for (const line of (result.stdout || "").split("\n")) {
    const text = line.trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed.message === "string" && parsed.message.startsWith("write refused")) {
        refusals.push({ code: parsed.code, id: parsed.id, message: parsed.message });
      }
    } catch {
      // A non-JSON line is not a refusal record; the fatal path reports it below.
    }
  }
  if (refusals.length) return { ok: false, refused: refusals };
  process.stderr.write(
    `${label} failed (exit ${result.status})\n${result.stderr || result.stdout}\n`,
  );
  return { ok: false, fatal: true };
}

// `--force` brands a revision forced:true and bypasses the checker. This adapter
// never does that: a refused write is the ledger disagreeing with the conspectus,
// and overriding it would launder that disagreement into the record.
function must(call, label) {
  if (call.ok) return call.data;
  if (call.fatal) process.exit(1);
  return null; // refused — the caller reports and moves on
}

function labelArgs(labels) {
  return labels.flatMap((l) => ["--label", l]);
}

// .pecia/snapshot.json is this repository's custody manifest around Pecia's
// projection, not a Pecia artifact: it binds the committed work.jsonl to the
// timeline head it was derived from, and dev/test-pecia-roadmap.mjs asserts both
// bindings. `pecia snapshot` refreshes its own snapshot.head and work.jsonl but
// knows nothing about this file, so any write to the timeline must re-derive it
// or the correspondence gate goes red on a ledger that is actually fine.
// Only the derived fields move; schemaVersion, projectionDetectorVersion,
// authority and limitation are the manifest's own claims and are left alone.
function refreshSnapshotManifest() {
  const manifestPath = join(root, ".pecia", "snapshot.json");
  const headPath = join(root, ".pecia", "snapshot.head");
  if (!existsSync(manifestPath) || !existsSync(headPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const head = readFileSync(headPath, "utf8").trim();
  const digest = createHash("sha256").update(readFileSync(ledgerPath)).digest("hex");
  if (manifest.timelineHead === head && manifest.workProjectionSha256 === digest) return null;
  manifest.timelineHead = head;
  manifest.workProjectionSha256 = digest;
  manifest.exportedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return head;
}

if (!apply) {
  if (asJson) {
    console.log(JSON.stringify({ ok: true, mode: "plan", counts, plan }, null, 2));
  } else {
    for (const p of plan) {
      const detail =
        p.action === "skip"
          ? p.reason
          : p.action === "noop"
            ? `${p.pecia} is current`
            : p.action === "create"
              ? `new ${p.want.status} defect, priority ${p.want.priority}`
              : p.action === "reopen"
                ? p.reason
                : `${p.pecia}: ${p.changed.join(", ")} → ${p.want.status}`;
      console.log(`  ${p.action.padEnd(7)} ${p.finding.padEnd(8)} ${detail}`);
    }
    const summary = Object.entries(counts)
      .sort()
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");
    console.log(`\nplan: ${summary}. Nothing written — re-run with --apply.`);
  }
  process.exit(0);
}

// Applying: regenerate the projection first so the plan was not computed against
// a stale shadow, then re-derive. A stale snapshot is clean, but planning from
// one would silently re-create records that already exist.
must(pecia(["snapshot"], "pecia snapshot"), "snapshot");
const freshHeads = readHeads();
const fresh = indexBySourceLabel(freshHeads);
if (fresh.collisions.length) {
  cannotRun(`a finding's record chain does not resolve to one tail: ${describeCollisions(fresh.collisions)}`);
}
const applied = [];
const escalated = [];

function refuse(p, call, stage) {
  escalated.push({
    finding: p.finding,
    pecia: p.pecia ?? null,
    stage,
    refusals: call.refused.map((r) => `${r.code}: ${r.message}`),
  });
}

for (const f of findings) {
  const p = planFor(f, fresh.byFinding.get(f.finding_id));
  if (p.action === "skip" || p.action === "noop") continue;
  const w = p.want;

  if (p.action === "create" || p.action === "reopen") {
    const argv = [
      "add",
      "--type", "defect",
      "--title", w.title,
      "--priority", String(w.priority),
      "--owner", w.owner,
      "--body", w.body,
      ...labelArgs(w.labels),
    ];
    if (p.action === "reopen") argv.push("--discovered-from", p.pecia);
    const createCall = pecia(argv, `add ${p.finding}`);
    const created = must(createCall, "add");
    if (!created) {
      refuse(p, createCall, "add");
      continue;
    }
    const newId = created.id ?? created.record?.id;
    if (!newId) cannotRun(`pecia add did not report an id for ${p.finding}`);
    // `add` cannot set a non-open status, and evidence belongs only on a record
    // that is closing. A terminal record gets both from `close` below, so the
    // only case needing a second revision here is in-progress.
    if (w.status === "in-progress") {
      const editCall = pecia(["edit", newId, "--status", "in-progress"], `edit ${newId}`);
      if (!must(editCall, "edit")) {
        refuse({ ...p, pecia: newId }, editCall, "edit");
        continue;
      }
    }
    if (TERMINAL.has(w.status)) {
      const closeCall = pecia(
        ["close", newId, "--status", w.status, "--disposition", w.disposition, "--evidence", w.evidence],
        `close ${newId}`,
      );
      if (!must(closeCall, "close")) {
        // The record exists and is correct; only its closure was declined. It
        // stays open, which is the truthful state until the refusal is resolved.
        refuse({ ...p, pecia: newId }, closeCall, "close");
        continue;
      }
    }
    applied.push({ ...p, pecia: newId });
    continue;
  }

  if (p.action === "update") {
    const argv = [
      "edit", p.pecia,
      "--title", w.title,
      "--body", w.body,
      "--priority", String(w.priority),
      ...labelArgs(w.labels),
    ];
    if (w.evidence) argv.push("--evidence", w.evidence);
    if (!TERMINAL.has(w.status)) argv.push("--status", w.status);
    const editCall = pecia(argv, `edit ${p.pecia}`);
    if (!must(editCall, "edit")) {
      refuse(p, editCall, "edit");
      continue;
    }
    applied.push(p);
    continue;
  }

  if (p.action === "close") {
    const closeCall = pecia(
      ["close", p.pecia, "--status", w.status, "--disposition", w.disposition, "--evidence", w.evidence],
      `close ${p.pecia}`,
    );
    if (!must(closeCall, "close")) {
      refuse(p, closeCall, "close");
      continue;
    }
    applied.push(p);
  }
}

must(pecia(["snapshot"], "pecia snapshot"), "snapshot");
const rebound = refreshSnapshotManifest();
const report = {
  ok: escalated.length === 0,
  mode: "apply",
  applied: applied.length,
  counts,
  snapshot_rebound: rebound,
  escalated,
};
if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`applied ${applied.length} change(s): ${applied.map((a) => `${a.finding}→${a.action}`).join(", ") || "none"}`);
  if (rebound) console.log(`rebound .pecia/snapshot.json to timeline head ${rebound.slice(0, 12)}…`);
  for (const e of escalated) {
    console.log(`\nescalated ${e.finding}${e.pecia ? ` (${e.pecia})` : ""} at ${e.stage}:`);
    for (const r of e.refusals) console.log(`  ${r}`);
  }
  console.log("\nRun `pecia check` and `pecia audit` next; audit resolves every amanuensis: reference.");
}
if (escalated.length) process.exit(1);
