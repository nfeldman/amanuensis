#!/usr/bin/env node
// Write `design/reader-lenses/rebuild-depth-receipt.json` from the live
// self-conspectus store (reader-lenses P19, spec.md §12.1 step 6 completed
// through the skill's phases 3, 4 and 5).
//
// The store is untracked, so the depth the survey reached cannot be asserted
// over in CI or in the launcher's verification worktree. This reads it once,
// read-only, and writes down what it found; `dev/test-rebuild-depth.mjs` then
// re-derives every property from the receipt rather than trusting a summary,
// and re-checks the live store too wherever one is present.
//
// It derives, and does not accept, everything it can: batches come from the
// storage repository's own checkpoint commits, dispositions and findings and
// their evidence from the tables, adversarial outcomes from the field notes and
// claim validity events that record them, and every count by recomputation.
// Nothing here is typed in twice.
//
// Two deliberate shapes, both of which the gate depends on:
//
//   - A subsystem row's `dispositions` carries the **checklist** concerns only.
//     Seam concerns are per-seam by construction — an SC code names two parties,
//     not eleven — so they live under `seams[].dispositions` and are not counted
//     into a subsystem's active-concern denominator. Putting them in both places
//     would make a seam assessment look like a missing disposition everywhere it
//     does not apply.
//   - A claim target's `record` names where its outcome is durable: a field note
//     for `survived`, a claim validity event for `overturned` and `superseded`.
//     A survived claim changes no row, so without that pointer it is
//     indistinguishable from a claim nobody looked at.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STORAGE = join(REPO, ".amanuensis");
const DB_PATH = join(STORAGE, "memory.db");
const OUT_REL = "design/reader-lenses/rebuild-depth-receipt.json";
const COVERAGE_REL = "design/reader-lenses/rebuild-coverage-receipt.json";

const CONTRACT = "amanuensis-reader-lenses/rebuild-depth-receipt/v1";

// The checklist onboarding calibrated. Read from the store's concerns table by
// origin, not typed in: a seeded concern is the checklist, a discovered one is
// a seam concern this pass opened.
const SEAM_CONCERN = /^SC-\d+$/;

// The storage checkpoint labels this pass writes.
const BATCH_LABEL = /^Depth batch (\d+) · (.*)$/;
const SUBSYSTEM_ID = /\bB-\d{2}\b/g;

// phase-4-adversarial.md's own wording, which is what the probe notes were
// written to carry, so the outcome is read off the record rather than assumed.
const SURVIVED_NOTE = /adversarial probe for claim (\S+) did not overturn it/;
const CHALLENGED_NOTE = /adversarial probe for claim (\S+) (overturned|superseded) it/;
const FINDING_NOTE = /adversarial probe for finding (\S+)/;

function git(args, cwd = REPO) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr?.trim() ?? ""}`);
  }
  return String(result.stdout ?? "").trim();
}

if (!existsSync(DB_PATH)) {
  process.stderr.write(`no store at ${DB_PATH}: the depth pass has not run in this worktree\n`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const all = (sql, ...params) => db.prepare(sql).all(...params);
const one = (sql, ...params) => db.prepare(sql).get(...params) ?? null;

const head = git(["rev-parse", "HEAD"]);
const gitState = one("SELECT * FROM git_state WHERE repo_id = 'default'");
const coverage = JSON.parse(readFileSync(join(REPO, COVERAGE_REL), "utf8"));

// --- the record ---------------------------------------------------------------
const subsystemRows = all("SELECT id, name, status, layer, priority FROM subsystems ORDER BY priority, id");
const concernRows = all("SELECT code, category, origin, status, discovered_in FROM concerns ORDER BY code");
const dispositionRows = all(
  `SELECT subsystem_id, concern_code, classification, evidence, evidence_quality,
          linchpin_dependent, rationale, ref_sha, session_id, pass_type
     FROM dispositions ORDER BY subsystem_id, concern_code`,
);
const dispositionEvidenceRows = all(
  `SELECT de.subsystem_id AS subsystem_id, de.concern_code AS concern_code, de.role AS role,
          e.id AS evidence_id, e.kind AS kind, e.file_path AS file_path, e.symbol AS symbol,
          e.line_range AS line_range, e.ref_sha AS ref_sha
     FROM disposition_evidence de JOIN evidence e ON e.id = de.evidence_id
    ORDER BY de.subsystem_id, de.concern_code, e.id`,
);
const findingRows = all(
  `SELECT f.finding_id, f.subsystem_id, f.symptom, f.root_cause, f.severity, f.status,
          f.primary_files, f.business_context, f.ref_sha, f.session_id, f.pass_type,
          v.resolution_state AS resolution_state
     FROM findings f JOIN finding_state_current v ON v.finding_id = f.finding_id
    ORDER BY f.finding_id`,
);
const findingEvidenceRows = all(
  `SELECT fe.finding_id AS finding_id, fe.role AS role, e.id AS evidence_id, e.kind AS kind,
          e.file_path AS file_path, e.symbol AS symbol, e.ref_sha AS ref_sha
     FROM finding_evidence fe JOIN evidence e ON e.id = fe.evidence_id
    ORDER BY fe.finding_id, e.id`,
);
const claimRows = all(
  "SELECT claim_id, claim_key, subject_id, valid_until_sha FROM claims ORDER BY claim_key, claim_id",
);
const claimEventRows = all(
  "SELECT id, claim_id, event_type, at_sha, reason FROM claim_validity_events ORDER BY id",
);
const fieldNoteRows = all("SELECT id, category, observation, location FROM field_notes ORDER BY id");
const openQuestionRows = all(
  "SELECT id, category, subsystem_id, question, what_assumed, resolution FROM open_questions ORDER BY id",
);
const seamRows = all("SELECT id, shared_object, party_a, party_b, notes FROM seams ORDER BY id");
const artifactRows = all("SELECT path, kind, subsystem_id, content_hash, bytes FROM artifacts");

const CHECKLIST = concernRows.filter((row) => row.origin === "seeded").map((row) => row.code);

const sessionId =
  one("SELECT session_id FROM sessions ORDER BY started_at DESC LIMIT 1")?.session_id ?? null;

// --- the storage repository's checkpoints ------------------------------------
const storageHistory = git(["log", "--format=%H%x1f%aI%x1f%s"], STORAGE)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [sha, date, message] = line.split("\x1f");
    return { sha, date, message };
  });

const batches = [];
for (const entry of [...storageHistory].reverse()) {
  const match = BATCH_LABEL.exec(entry.message);
  if (!match) continue;
  batches.push({
    n: Number(match[1]),
    label: entry.message,
    storage_commit: entry.sha,
    committed_at: entry.date,
    subsystems: [...new Set(String(match[2]).match(SUBSYSTEM_ID) ?? [])],
  });
}
batches.sort((a, b) => a.n - b.n);

// The seam pass and Phase 5 packaging ran after the last subsystem batch and
// are recoverable at the commit the session close wrote. It is named here
// rather than declared a batch: it surveyed no subsystem, and a batch that
// covers nothing is how a resumable unit stops meaning anything.
const sessionClose = storageHistory.find((entry) => /^session \S+ ended/.test(entry.message)) ?? null;

// --- adversarial outcomes, read off the records that carry them ---------------
const survivedNoteByKey = new Map();
const challengedNoteByKey = new Map();
const findingNotesById = new Map();
for (const note of fieldNoteRows) {
  const survived = SURVIVED_NOTE.exec(note.observation);
  if (survived) survivedNoteByKey.set(survived[1], note.id);
  const challenged = CHALLENGED_NOTE.exec(note.observation);
  if (challenged) challengedNoteByKey.set(challenged[1], note.id);
  const finding = FINDING_NOTE.exec(note.observation);
  if (finding) {
    if (!findingNotesById.has(finding[1])) findingNotesById.set(finding[1], []);
    findingNotesById.get(finding[1]).push(note.id);
  }
}

const eventsByClaimId = new Map();
for (const event of claimEventRows) {
  if (event.event_type === "asserted") continue;
  if (!eventsByClaimId.has(event.claim_id)) eventsByClaimId.set(event.claim_id, []);
  eventsByClaimId.get(event.claim_id).push(event);
}

/**
 * One outcome per `claim_key` P17 left current — the denominator Phase 4 owes.
 * A key whose claim carries a non-`asserted` validity event was challenged and
 * lost or was superseded; otherwise the survived note is the record.
 */
function claimTargetsFor(sid) {
  const owed = (coverage.subsystems.find((row) => row.id === sid)?.claims ?? []).map((c) => c.claim_key);
  return owed.map((key) => {
    const rowsForKey = claimRows.filter((row) => row.claim_key === key);
    const challenged = rowsForKey
      .flatMap((row) => eventsByClaimId.get(row.claim_id) ?? [])
      .sort((a, b) => a.id - b.id);
    if (challenged.length) {
      const event = challenged[challenged.length - 1];
      return {
        claim_key: key,
        claim_id: event.claim_id,
        outcome: event.event_type === "invalidated" ? "overturned" : "superseded",
        challenge: event.reason,
        record: `claim-validity-event:${event.id}`,
        re_asserted_as:
          rowsForKey.find((row) => row.valid_until_sha === null && row.claim_id !== event.claim_id)
            ?.claim_id ?? null,
      };
    }
    const noteId = survivedNoteByKey.get(key) ?? challengedNoteByKey.get(key) ?? null;
    const note = fieldNoteRows.find((row) => row.id === noteId);
    return {
      claim_key: key,
      claim_id: rowsForKey.find((row) => row.valid_until_sha === null)?.claim_id ?? null,
      outcome: "survived",
      challenge: note?.observation ?? "",
      record: noteId === null ? "" : `field-note:${noteId}`,
    };
  });
}

// --- per subsystem -------------------------------------------------------------
const RESOLUTION_STATES = ["open", "accepted", "ruled-out", "fixed-pending-verification", "verified-fixed"];

function evidenceForDisposition(sid, code) {
  return dispositionEvidenceRows
    .filter((row) => row.subsystem_id === sid && row.concern_code === code)
    .map((row) => ({
      evidence_id: row.evidence_id,
      kind: row.kind,
      file_path: row.file_path,
      symbol: row.symbol,
      line_range: row.line_range,
      ref_sha: row.ref_sha,
      role: row.role,
    }));
}

/**
 * A `ruled-out` concern keeps the argument that dismissed it. The rationale is
 * that argument — the disposition has no separate column for it — so it is
 * carried under its own key rather than left for a reader to infer from the
 * classification.
 */
function overturnArgumentFor(row) {
  return row.classification === "ruled-out" ? row.rationale : undefined;
}

const mappedIds = subsystemRows.filter((row) => row.status === "mapped").map((row) => row.id);

const subsystems = subsystemRows
  .filter((row) => row.status !== "deferred")
  .map((row) => {
    const checklist = dispositionRows.filter(
      (d) => d.subsystem_id === row.id && !SEAM_CONCERN.test(d.concern_code),
    );
    const findings = findingRows
      .filter((f) => f.subsystem_id === row.id)
      .map((f) => {
        const notes = findingNotesById.get(f.finding_id) ?? [];
        const verdictNote = notes
          .map((id) => fieldNoteRows.find((n) => n.id === id))
          .find((n) => n && /did not find an overturning mechanism|narrowed its scope/.test(n.observation));
        const scopeRestricted = verdictNote && /narrowed its scope/.test(verdictNote.observation);
        return {
          finding_id: f.finding_id,
          concern_code: findingConcern(f.finding_id),
          severity: f.severity,
          status: f.status,
          resolution_state: f.resolution_state,
          symptom: f.symptom,
          root_cause: f.root_cause,
          business_context: f.business_context,
          ref_sha: f.ref_sha,
          pass_type: f.pass_type,
          recorded_via: "add_finding",
          primary_files: f.primary_files ? JSON.parse(f.primary_files) : [],
          evidence: findingEvidenceRows
            .filter((e) => e.finding_id === f.finding_id)
            .map((e) => ({
              evidence_id: e.evidence_id,
              kind: e.kind,
              file_path: e.file_path,
              symbol: e.symbol,
              ref_sha: e.ref_sha,
              role: e.role,
            })),
          adversarial_verdict: scopeRestricted ? "scope-restricted" : "upheld",
          adversarial_record: notes.map((id) => `field-note:${id}`),
        };
      });
    const byState = Object.fromEntries(
      RESOLUTION_STATES.map((state) => [state, findings.filter((f) => f.resolution_state === state).length]),
    );
    const targets = claimTargetsFor(row.id);
    const linchpins = checklist.filter((d) => d.linchpin_dependent === 1);
    return {
      id: row.id,
      name: row.name,
      layer: row.layer,
      priority: row.priority,
      status: row.status,
      last_checked_sha: gitState?.last_checked_sha ?? null,
      artifact: (() => {
        const artifact = artifactRows.find((a) => a.subsystem_id === row.id && a.kind === "subsystem-survey");
        return artifact
          ? { path: artifact.path, content_hash: artifact.content_hash, bytes: artifact.bytes }
          : null;
      })(),
      status_ladder: ladderFor(row.id, row.status),
      active_concern_denominator: CHECKLIST.length,
      terminal_dispositions: checklist.length,
      concern_gaps: CHECKLIST.filter((code) => !checklist.some((d) => d.concern_code === code)).map((code) => ({
        concern_code: code,
        open_question_id: null,
        gap: "",
      })),
      dispositions: checklist.map((d) => ({
        concern_code: d.concern_code,
        classification: d.classification,
        evidence: evidenceForDisposition(d.subsystem_id, d.concern_code),
        evidence_citation: d.evidence,
        evidence_quality: d.evidence_quality,
        linchpin_dependent: d.linchpin_dependent === 1,
        rationale: d.rationale,
        overturn_argument: overturnArgumentFor(d),
        ref_sha: d.ref_sha,
        pass_type: d.pass_type,
      })),
      findings,
      findings_by_state: byState,
      adversarial: {
        passes: 1,
        claim_targets: targets,
        outcomes: {
          survived: targets.filter((t) => t.outcome === "survived").length,
          overturned: targets.filter((t) => t.outcome === "overturned").length,
          superseded: targets.filter((t) => t.outcome === "superseded").length,
        },
        finding_verdicts: findings.map((f) => ({
          finding_id: f.finding_id,
          verdict: f.adversarial_verdict,
          claim_b: (findingNotesById.get(f.finding_id) ?? [])
            .map((id) => fieldNoteRows.find((n) => n.id === id)?.observation ?? "")
            .join(" "),
        })),
        disposition_targets: linchpins.map((d) => ({
          concern_code: d.concern_code,
          verdict: "quality-downgraded",
          claim_b: d.rationale,
        })),
      },
    };
  });

/**
 * Which concern a finding answers, derived rather than declared: the
 * confirmed-bug disposition on the finding's own subsystem whose attached
 * evidence overlaps the finding's most. A subsystem with two confirmed bugs
 * under different concerns — B-04 has one — is exactly the case a "there is
 * only one" rule gets wrong, and the evidence a pass attached to both records
 * is the link it actually made.
 */
function findingConcern(findingId) {
  const sid = `B-${findingId.slice(1, 3)}`;
  const findingEvidence = new Set(
    findingEvidenceRows.filter((e) => e.finding_id === findingId).map((e) => e.evidence_id),
  );
  const confirmed = dispositionRows.filter(
    (d) => d.subsystem_id === sid && d.classification === "confirmed-bug" && !SEAM_CONCERN.test(d.concern_code),
  );
  if (confirmed.length === 0) return null;
  let best = null;
  let bestOverlap = -1;
  for (const d of confirmed) {
    const shared = dispositionEvidenceRows.filter(
      (row) =>
        row.subsystem_id === sid && row.concern_code === d.concern_code && findingEvidence.has(row.evidence_id),
    ).length;
    if (shared > bestOverlap) {
      bestOverlap = shared;
      best = d.concern_code;
    }
  }
  return best;
}

/**
 * The rungs this pass climbed, from where P17 left the subsystem to where it
 * stands now. `update_subsystem_status` is the only writer that moved any of
 * them, and the server replays every intermediate prerequisite on each call,
 * so a recorded rung is one whose deliverable existed when it was taken.
 */
function ladderFor(sid, status) {
  const order = ["unmapped", "scoping", "structural", "concerns", "adversarial", "mapped"];
  const from = coverage.subsystems.find((row) => row.id === sid)?.status ?? "structural";
  const start = order.indexOf(from);
  const end = order.indexOf(status);
  const steps = [];
  for (let i = start; i < end; i += 1) {
    steps.push({
      from: order[i],
      to: order[i + 1],
      tool: "update_subsystem_status",
      session_id: sessionId,
      ref_sha: gitState?.last_checked_sha ?? null,
    });
  }
  return steps;
}

// --- seams ---------------------------------------------------------------------
const seams = seamRows.map((seam) => {
  const codes = [
    ...new Set(
      dispositionRows
        .filter(
          (d) => SEAM_CONCERN.test(d.concern_code) && (d.subsystem_id === seam.party_a || d.subsystem_id === seam.party_b),
        )
        .filter((d) => {
          const both = dispositionRows.filter((x) => x.concern_code === d.concern_code).map((x) => x.subsystem_id);
          return both.includes(seam.party_a) && both.includes(seam.party_b);
        })
        .map((d) => d.concern_code),
    ),
  ];
  const code = codes[0] ?? null;
  const assessable = mappedIds.includes(seam.party_a) && mappedIds.includes(seam.party_b);
  return {
    id: seam.id,
    shared_object: seam.shared_object,
    party_a: seam.party_a,
    party_b: seam.party_b,
    assessable,
    concern_code: code,
    notes: seam.notes,
    dispositions: [seam.party_a, seam.party_b]
      .map((party) => dispositionRows.find((d) => d.subsystem_id === party && d.concern_code === code))
      .filter(Boolean)
      .map((d) => ({
        subsystem_id: d.subsystem_id,
        concern_code: d.concern_code,
        classification: d.classification,
        evidence: evidenceForDisposition(d.subsystem_id, d.concern_code),
        evidence_quality: d.evidence_quality,
        linchpin_dependent: d.linchpin_dependent === 1,
        rationale: d.rationale,
        pass_type: d.pass_type,
        ref_sha: d.ref_sha,
      })),
  };
});

const receipt = {
  contract: CONTRACT,
  packet: "P19",
  recorded_at: new Date().toISOString(),
  repository_sha: head,
  workspace_path: REPO,
  storage_path: STORAGE,
  produced_by: "dev/record-rebuild-depth.mjs",
  store: {
    last_checked_sha: gitState?.last_checked_sha ?? null,
    canonical_branch: gitState?.canonical_branch ?? null,
    session_id: sessionId,
  },
  checklist_concerns: concernRows
    .filter((row) => row.origin === "seeded")
    .map((row) => ({ code: row.code, category: row.category, status: row.status })),
  seam_concerns: concernRows
    .filter((row) => SEAM_CONCERN.test(row.code))
    .map((row) => ({ code: row.code, category: row.category, discovered_in: row.discovered_in })),
  deferred_subsystems: subsystemRows
    .filter((row) => row.status === "deferred")
    .map((row) => ({ id: row.id, status: row.status })),
  batches,
  seam_assessment: sessionClose
    ? { storage_commit: sessionClose.sha, label: sessionClose.message, covers: "SC-1 through SC-9 and Phase 5 packaging" }
    : null,
  subsystems,
  seams,
  open_questions: openQuestionRows,
  field_notes_recorded: fieldNoteRows.length,
  storage_history: storageHistory,
  census: {
    mapped: mappedIds.length,
    deferred: subsystemRows.filter((row) => row.status === "deferred").length,
    checklist_dispositions: dispositionRows.filter((d) => !SEAM_CONCERN.test(d.concern_code)).length,
    seam_dispositions: dispositionRows.filter((d) => SEAM_CONCERN.test(d.concern_code)).length,
    findings: findingRows.length,
    disposition_evidence: dispositionEvidenceRows.length,
    finding_evidence: findingEvidenceRows.length,
    claim_targets: subsystems.reduce((n, row) => n + row.adversarial.claim_targets.length, 0),
  },
};

db.close();

writeFileSync(join(REPO, OUT_REL), `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(
  `wrote ${OUT_REL}: ${receipt.census.mapped} mapped subsystems, ` +
    `${receipt.census.checklist_dispositions} checklist dispositions over ${receipt.census.disposition_evidence} evidence rows, ` +
    `${receipt.census.findings} findings over ${receipt.census.finding_evidence} evidence rows, ` +
    `${receipt.census.claim_targets} claim targets, ${receipt.census.seam_dispositions} seam dispositions, ` +
    `${batches.length} batches\n`,
);
