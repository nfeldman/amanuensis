// Invariants that turn Amanuensis's epistemic contracts into server-side
// enforcement. Agent prose describes the workflow for the LLM's benefit;
// these helpers make the rules machine-checked, so a violation produces
// a ToolError instead of a silently-accepted bad write.
//
// The knowledge-depth contract (see README): a subsystem's mapping
// status determines what claims the agents are authorized to make about
// it. Claims exceeding the authorized level must be rejected at the
// write path.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import SqliteDatabase from "better-sqlite3";
import { canonicalCreateViewSql, type DB } from "./db.js";
import type { ServerContext } from "./helpers.js";
import {
  isCitationToken,
  resolveWorkspaceAnchors,
  resolveWorkspaceCommits,
  ToolError,
} from "./helpers.js";
import type { VocabularyDischarge } from "./vocabulary.js";

export type SubsystemStatus =
  | "unmapped"
  | "scoping"
  | "structural"
  | "concerns"
  | "adversarial"
  | "mapped"
  | "deferred";

// Ordered progression of survey depth. `deferred` is not on the axis —
// it is an orthogonal "do not survey" flag that blocks all gated writes
// regardless of what the subsystem's prior status was.
export const STATUS_ORDER: ReadonlyArray<Exclude<SubsystemStatus, "deferred">> = [
  "unmapped",
  "scoping",
  "structural",
  "concerns",
  "adversarial",
  "mapped",
] as const;

const STATUS_RANK: Record<string, number> = {};
STATUS_ORDER.forEach((s, i) => {
  STATUS_RANK[s] = i;
});

export function statusRank(s: string): number | undefined {
  return STATUS_RANK[s];
}

/**
 * Look up a subsystem's current status, returning null when no row
 * exists. Use this when callers want to distinguish a missing
 * subsystem from a present one (e.g. insert-vs-update branches).
 */
export function readSubsystemStatus(db: DB, subsystemId: string): SubsystemStatus | null {
  const row = db.prepare("SELECT status FROM subsystems WHERE id = ?").get(subsystemId) as
    | { status: SubsystemStatus }
    | undefined;
  return row?.status ?? null;
}

/**
 * Hard-miss variant of {@link readSubsystemStatus}: throws a
 * ToolError when the subsystem is unknown. Use this from the gated
 * write path where a missing subsystem is itself a contract violation.
 */
export function getSubsystemStatus(db: DB, subsystemId: string): SubsystemStatus {
  const status = readSubsystemStatus(db, subsystemId);
  if (status === null) {
    throw new ToolError(`unknown subsystem: ${subsystemId}`);
  }
  return status;
}

/**
 * Enforce the knowledge-depth contract: reject a write that would
 * produce a claim the subsystem's current status does not authorize.
 *
 * Example: set_disposition requires the subsystem to be at `concerns`
 * or later. A subsystem still in `structural` cannot carry concern
 * dispositions because the concern pass has not run.
 *
 * `deferred` subsystems reject every gated write regardless of prior
 * rank — they are explicitly out of scope for survey work.
 */
export function requireSubsystemStatus(
  db: DB,
  subsystemId: string,
  minStatus: Exclude<SubsystemStatus, "deferred">,
  operation: string,
): void {
  const status = getSubsystemStatus(db, subsystemId);
  if (status === "deferred") {
    throw new ToolError(
      `subsystem ${subsystemId} is deferred; ${operation} is not permitted. ` +
        `Un-defer via update_subsystem_status before proceeding.`,
    );
  }
  const current = STATUS_RANK[status];
  const required = STATUS_RANK[minStatus];
  if (current === undefined) {
    throw new ToolError(`subsystem ${subsystemId} has unknown status '${status}'`);
  }
  // `minStatus` is typed as a member of STATUS_ORDER so it will always
  // have a rank; the check keeps TypeScript happy under
  // noUncheckedIndexedAccess without introducing a runtime non-null
  // assertion.
  if (required === undefined) {
    throw new ToolError(`internal: minStatus '${minStatus}' has no rank`);
  }
  if (current < required) {
    throw new ToolError(
      `subsystem ${subsystemId} is '${status}', but ${operation} requires at ` +
        `least '${minStatus}' (knowledge-depth contract). Advance the ` +
        `subsystem via update_subsystem_status first.`,
    );
  }
}

/**
 * Enforce that status transitions go forward along STATUS_ORDER. The
 * only permitted backward move is via reset_subsystem, which is an
 * explicit destructive tool with its own audit trail.
 *
 * Transitions to or from `deferred` are always permitted — it is a
 * scope flag, not a knowledge level. Pass a null `currentStatus` for
 * the insert path (no prior row to compare against).
 */
export function enforceMonotonicTransition(
  subsystemId: string,
  currentStatus: SubsystemStatus | null,
  targetStatus: SubsystemStatus,
): void {
  if (currentStatus === null) return;
  // deferred is bidirectional — a subsystem can be parked and later
  // unparked to resume the survey at whatever depth it held before.
  if (currentStatus === "deferred" || targetStatus === "deferred") return;
  const currentRank = STATUS_RANK[currentStatus];
  const targetRank = STATUS_RANK[targetStatus];
  if (currentRank === undefined || targetRank === undefined) return;
  if (targetRank < currentRank) {
    throw new ToolError(
      `cannot transition ${subsystemId} from '${currentStatus}' to '${targetStatus}' ` +
        `(would regress the knowledge-depth contract). Use reset_subsystem ` +
        `to discard dependent survey data and restart from an earlier phase.`,
    );
  }
}

/**
 * The structural phase's own deliverable, checked at the status advance
 * (spec.md §9.1). `structural` authorizes claims about types, state
 * containers, flows and the concurrency model; before this, the only thing
 * the server required of the phase was the narrative artifact — and prose is
 * not revision-bound, so nothing downstream could tell a mapped structure
 * from a described one.
 *
 * One claim is enough, and no category is required. Forcing a count, or a row
 * per category, is a quota over a field the writer must author, which is the
 * fabrication-to-order hazard BP4 names and the case GP8's v2 scope note
 * excludes from substrate enforcement. A subsystem with genuinely no mutable
 * state container records that as an explicit negative claim instead of
 * omitting the category. Claim *truth* is the adversarial pass's obligation:
 * `references/phase-4-adversarial.md` pulls these claims as targets and
 * records each outcome before the subsystem may advance to `mapped`.
 *
 * The prefix is compared with `substr`, not `LIKE`: a subsystem id may
 * legitimately contain `_` or `%`, and an unescaped LIKE pattern would let one
 * subsystem's claim satisfy another's gate.
 */
function requireStructuralClaim(db: DB, subsystemId: string): void {
  const prefix = `${subsystemId}/`;
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM claims
        WHERE valid_until_sha IS NULL
          AND substr(claim_key, 1, length(?)) = ?`,
    )
    .get(prefix, prefix) as { n: number };
  if (n > 0) return;
  throw new ToolError(
    `cannot advance ${subsystemId} to 'structural': no current claim carries a ` +
      `claim_key beginning '${prefix}'. The structural phase must record its key ` +
      `types, state containers, flow steps, concurrency invariants and seam ` +
      `contracts through add_claim before the subsystem is advanced. One claim is ` +
      `enough; a category that is genuinely empty is recorded as an explicit ` +
      `negative claim rather than omitted.`,
  );
}

/**
 * One subsystem's standing against §4.4's vocabulary obligation, re-derived
 * from the rows rather than read from a flag.
 *
 * Three states, never two (spec.md §4.5): `terms` when at least one term scoped
 * to the subsystem still **anchors** — its `first_seen` parses, its revision is
 * reachable, and its path exists in that revision's tree; `declined` when no
 * term anchors but a `vocabulary_declinations` row for the subsystem still
 * resolves; `not-recorded` when nobody has answered the question either way.
 *
 * *Anchored* is recomputed at every read, and deliberately so. `define_term`
 * refuses an anchor that does not resolve, but a store carries rows written
 * before that refusal existed — the archived baseline holds four terms whose
 * anchors are not citation tokens at all — and a revision that resolved when the
 * term was written can be rewritten away afterwards. The predicate reads false
 * for such a row without rewriting it: the row stays visible and countable, and
 * is worth nothing until the term is redefined at an anchor that opens.
 *
 * The **effective** declination is the most recent row whose `ref_sha` still
 * resolves. §4.3 keeps declinations across a subsystem reset, which is right — a
 * ruled-out record is kept (GP18) — but a kept record is history, and history
 * does not discharge a new pass. A newer row anchored to a collected revision
 * therefore does not invalidate an older one that still opens; it is the one
 * that renders as history.
 *
 * Scoping is per `(term, subsystem)`. `vocabulary.subsystem_id` is one scope,
 * `vocabulary_scopes` carries the rest, and a codebase-wide term
 * (`subsystem_id IS NULL`, no scope row) satisfies no subsystem's obligation: a
 * term that belongs to everything tells a reader nothing about the subsystem
 * that just advanced.
 *
 * Without a bound workspace there is no git to resolve against, so the row half
 * still binds — a term whose anchor parses, or a declination — and `checked` is
 * false, which is the treatment §2.3 already gives an unresolved revision.
 */
export interface VocabularyDeclination {
  id: number;
  subsystem_id: string;
  reason: string;
  session_id: string;
  ref_sha: string;
  declared_at: string;
}

export interface VocabularyDischargeReading {
  state: VocabularyDischarge;
  /** Terms scoped to the subsystem whose anchor resolves, in name order. */
  anchoredTerms: string[];
  /** Terms scoped to the subsystem whose anchor does not, or that carry none. */
  unanchoredTerms: string[];
  /** The most recent declination whose `ref_sha` resolves, or null. */
  declination: VocabularyDeclination | null;
  /** Declinations the workspace can no longer reach, newest first. */
  unreachableDeclinations: VocabularyDeclination[];
  /** False when there was no workspace to resolve revisions against. */
  checked: boolean;
}

export function readVocabularyDischarge(
  db: DB,
  workspacePath: string | null,
  subsystemId: string,
): VocabularyDischargeReading {
  const terms = db
    .prepare(
      `SELECT v.term AS term, v.first_seen AS first_seen
         FROM vocabulary v
        WHERE v.subsystem_id = ?
           OR EXISTS (SELECT 1 FROM vocabulary_scopes s
                       WHERE s.term = v.term AND s.subsystem_id = ?)
        ORDER BY v.term`,
    )
    .all(subsystemId, subsystemId) as Array<{ term: string; first_seen: string | null }>;
  const declinations = db
    .prepare(
      `SELECT id, subsystem_id, reason, session_id, ref_sha, declared_at
         FROM vocabulary_declinations
        WHERE subsystem_id = ?
        ORDER BY id DESC`,
    )
    .all(subsystemId) as VocabularyDeclination[];

  const anchors = terms.map((row) => row.first_seen ?? "");
  const resolvedAnchors =
    workspacePath === null
      ? new Map<string, boolean>()
      : resolveWorkspaceAnchors(workspacePath, anchors);
  const resolvedShas =
    workspacePath === null
      ? new Map<string, string | null>()
      : resolveWorkspaceCommits(
          workspacePath,
          declinations.map((row) => row.ref_sha),
        );

  const anchoredTerms: string[] = [];
  const unanchoredTerms: string[] = [];
  for (const row of terms) {
    const parses = isCitationToken(row.first_seen);
    const anchored =
      workspacePath === null ? parses : (resolvedAnchors.get(row.first_seen ?? "") ?? false);
    (anchored ? anchoredTerms : unanchoredTerms).push(row.term);
  }

  let declination: VocabularyDeclination | null = null;
  const unreachableDeclinations: VocabularyDeclination[] = [];
  for (const row of declinations) {
    const resolves = workspacePath === null ? true : Boolean(resolvedShas.get(row.ref_sha));
    if (resolves && declination === null) declination = row;
    else if (!resolves) unreachableDeclinations.push(row);
  }

  const state: VocabularyDischarge =
    anchoredTerms.length > 0 ? "terms" : declination !== null ? "declined" : "not-recorded";
  return {
    state,
    anchoredTerms,
    unanchoredTerms,
    declination,
    unreachableDeclinations,
    checked: workspacePath !== null,
  };
}

/**
 * §4.4, checked at the advance to `structural`, after the claim the phase owes.
 *
 * Discharge or decline, never a floor (decisions.md §3). The structural pass is
 * the one that reads a subsystem closely enough to know the words its code
 * coins, and before this it was in no tool precondition, no status gate and no
 * rebuild gate: the candidate store reached eight mapped subsystems with zero
 * vocabulary rows and nothing said so. What binds here is that the question was
 * *answered*, in one of the two ways an honest answer can take.
 *
 * **One term is enough and no count is required.** A quota over a field the
 * writer must author is the fabrication-to-order hazard BP4 names, and the same
 * reasoning {@link requireStructuralClaim} records applies word for word: a
 * subsystem that genuinely coins nothing records that as an explicit negative —
 * here a declination with its reason — rather than inventing a term to clear a
 * bar. Whether the declination is *true* is a judgement the substrate cannot
 * check; it can require that it be made, attributed and dated, and that is the
 * scope limit GP8 draws, accepted rather than pretended past.
 *
 * Returns the line the advance should report when there was no workspace to
 * resolve against, and refuses otherwise. An empty array is the ordinary result.
 */
function requireVocabularyDischarge(
  db: DB,
  subsystemId: string,
  workspacePath: string | null,
): string[] {
  const reading = readVocabularyDischarge(db, workspacePath, subsystemId);
  if (reading.state !== "not-recorded") {
    if (!reading.checked) {
      return [
        `${subsystemId} advanced to 'structural' without a bound workspace, so §4.4's anchors ` +
          `were not resolved: whether its ${reading.state === "terms" ? "term" : "declination"} ` +
          `still opens at the revision it names is unverified for this advance.`,
      ];
    }
    return [];
  }
  // Name what *was* found and rejected. "Nothing is recorded" and "four terms
  // are recorded and none of their anchors opens" are the same refusal and
  // entirely different repairs.
  const rejected: string[] = [];
  if (reading.unanchoredTerms.length > 0) {
    rejected.push(
      `${reading.unanchoredTerms.length} term(s) scoped here carry no anchor that resolves ` +
        `(${reading.unanchoredTerms.slice(0, 5).join(", ")})`,
    );
  }
  if (reading.unreachableDeclinations.length > 0) {
    const newest = reading.unreachableDeclinations[0] as VocabularyDeclination;
    rejected.push(
      `the newest declination is anchored at ${newest.ref_sha.slice(0, 7)}, which the workspace ` +
        `can no longer reach`,
    );
  }
  const found = rejected.length > 0 ? ` What is recorded: ${rejected.join("; ")}.` : "";
  throw new ToolError(
    `cannot advance ${subsystemId} to 'structural': the structural pass neither defined a ` +
      `domain term for this subsystem nor declared that it has none. Either define_term with a ` +
      `first_seen anchor that resolves, or decline_domain_vocabulary with the reason none ` +
      `applies. One term is enough; there is no quota, and "none" is a real and common answer ` +
      `that has to be said out loud.${found}`,
  );
}

/**
 * Phase 4's own deliverable, checked at the advance to `mapped` (spec.md §9.1).
 *
 * `structural` establishes that the account exists in a revision-bound,
 * evidence-backed form; §9.1 is explicit that it does not establish the
 * account is *right*, and that claim truth "remains the adversarial pass's
 * obligation — and that pass must actually be given the claims". Before this,
 * `mapped` had no prerequisite at all, so a subsystem could publish a
 * structural inventory nothing had ever challenged and still read as fully
 * surveyed (slice-S6, F6/codex).
 *
 * The denominator is every claim the subsystem still holds as current, because
 * that is what the published account rests on: a claim closed since the
 * adversarial pass is no longer part of the account, and a claim added after it
 * has not been challenged. One outcome per claim is enough and no outcome is
 * privileged — `survived` is a legitimate and common result, and demanding a
 * quota of overturnings would manufacture them (BP4). What the rule buys is
 * that an unchallenged claim cannot be silently carried across the advance.
 *
 * The prefix is compared with `substr`, not `LIKE`, for the reason
 * {@link requireStructuralClaim} gives: `_` and `%` in a subsystem id would
 * otherwise let one subsystem's outcome satisfy another's gate.
 */
function requireChallengedClaims(db: DB, subsystemId: string): void {
  const prefix = `${subsystemId}/`;
  const unchallenged = db
    .prepare(
      `SELECT c.claim_key AS claim_key
         FROM claims c
        WHERE c.valid_until_sha IS NULL
          AND substr(c.claim_key, 1, length(?)) = ?
          AND NOT EXISTS (
                SELECT 1 FROM claim_challenge_outcomes o WHERE o.claim_id = c.claim_id
              )
        ORDER BY c.claim_key`,
    )
    .all(prefix, prefix) as Array<{ claim_key: string }>;
  if (unchallenged.length === 0) return;
  const named = unchallenged
    .slice(0, 5)
    .map((row) => row.claim_key)
    .join(", ");
  const more = unchallenged.length > 5 ? ` and ${unchallenged.length - 5} more` : "";
  throw new ToolError(
    `cannot advance ${subsystemId} to 'mapped': ${unchallenged.length} current claim(s) carry no ` +
      `challenge outcome — ${named}${more}. The adversarial pass pulls every current '${prefix}' ` +
      `claim as a target and records the outcome through record_claim_challenge before the ` +
      `subsystem advances; a structural account published unchallenged is an account nobody read ` +
      `against the code.`,
  );
}

/**
 * Append one rung to the ladder a subsystem actually climbed.
 *
 * Called by every tool that writes `subsystems.status`, and only when the
 * write changes it: a re-affirmation of the status a subsystem already holds
 * climbed nothing, and counting it would make the recorded ladder disagree
 * with the survey. The row carries the tool that wrote it, the session it was
 * written in, and the revision the store was last checked at, because those
 * are exactly the three fields the depth receipt used to type in for itself
 * (slice-S6, F6/codex).
 */
export function recordStatusTransition(
  db: DB,
  entry: {
    subsystemId: string;
    fromStatus: SubsystemStatus | null;
    toStatus: SubsystemStatus;
    tool: "upsert_subsystem" | "update_subsystem_status" | "reset_subsystem";
    sessionId: string | null;
    reason?: string | null;
  },
): void {
  if (entry.fromStatus === entry.toStatus) return;
  const refSha =
    (
      db.prepare("SELECT last_checked_sha FROM git_state WHERE repo_id = 'default'").get() as
        | { last_checked_sha: string | null }
        | undefined
    )?.last_checked_sha ?? null;
  db.prepare(
    `INSERT INTO subsystem_status_transitions
       (subsystem_id, from_status, to_status, tool, session_id, ref_sha, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.subsystemId,
    entry.fromStatus,
    entry.toStatus,
    entry.tool,
    entry.sessionId,
    refSha,
    entry.reason ?? null,
  );
}

/**
 * §2.3, checked at every advance to `concerns`, `adversarial` and `mapped`.
 *
 * Every row in `dispositions` for this subsystem must carry **at least one**
 * `disposition_evidence` row whose `evidence.ref_sha` resolves in the bound
 * workspace. At least one, not all: a disposition carrying two attachments, one
 * resolvable and one whose revision was rewritten away, passes — the concern is
 * still answered against a reading someone can open, and refusing it would make
 * an ordinary rebase retroactively unmap a subsystem whose evidence is intact.
 * The unreachable attachment is returned as a warning instead, so the advance
 * says it rather than swallowing it.
 *
 * The two refusals are separate because the repairs differ: a disposition with
 * no attachment is attached, one whose revisions are all unreachable is re-read
 * at a reachable commit. Naming them in one message would tell a reader to do
 * the wrong thing to half the rows.
 *
 * `workspacePath` is how the revisions are resolved, and every status writer in
 * this server passes it. Without one the attachment half still binds — it is a
 * question about rows, not about git — and the revisions are reported as
 * unchecked rather than silently treated as reachable.
 *
 * Every distinct revision the subsystem's attachments name is resolved in one
 * `git cat-file --batch-check` (see `resolveWorkspaceCommits`); one subprocess
 * per attached row would put a status advance's cost in the subsystem's size.
 */
const NAMED_IN_REFUSAL = 25;
function nameRows(rows: readonly string[]): string {
  if (rows.length <= NAMED_IN_REFUSAL) return rows.join(", ");
  return (
    `${rows.slice(0, NAMED_IN_REFUSAL).join(", ")}, and ${rows.length - NAMED_IN_REFUSAL} more ` +
    `(get_dispositions names every one)`
  );
}

function requireAttachedEvidence(
  db: DB,
  subsystemId: string,
  targetStatus: SubsystemStatus,
  workspacePath: string | null,
): string[] {
  const rows = db
    .prepare(
      `SELECT d.concern_code AS code, e.ref_sha AS ref_sha
         FROM dispositions d
         LEFT JOIN disposition_evidence de
           ON de.subsystem_id = d.subsystem_id AND de.concern_code = d.concern_code
         LEFT JOIN evidence e ON e.id = de.evidence_id
        WHERE d.subsystem_id = ?
        ORDER BY d.concern_code`,
    )
    .all(subsystemId) as Array<{ code: string; ref_sha: string | null }>;
  if (rows.length === 0) return [];

  const attachedShas = new Map<string, string[]>();
  for (const row of rows) {
    const shas = attachedShas.get(row.code) ?? [];
    if (row.ref_sha) shas.push(row.ref_sha);
    attachedShas.set(row.code, shas);
  }

  const reachable =
    workspacePath === null
      ? new Map<string, string | null>()
      : resolveWorkspaceCommits(workspacePath, [...attachedShas.values()].flat());

  const unattached: string[] = [];
  const unreachable: string[] = [];
  const warnings: string[] = [];
  for (const [code, shas] of attachedShas) {
    if (shas.length === 0) {
      unattached.push(`${subsystemId}/${code}`);
      continue;
    }
    if (workspacePath === null) {
      warnings.push(
        `${subsystemId}/${code} carries ${shas.length} attached revision(s) that were not ` +
          `resolved: this advance was checked without a bound workspace.`,
      );
      continue;
    }
    const lost = shas.filter((sha) => !reachable.get(sha));
    if (lost.length === shas.length) {
      for (const sha of lost) unreachable.push(`${subsystemId}/${code}@${sha}`);
      continue;
    }
    for (const sha of lost) {
      warnings.push(
        `${subsystemId}/${code}@${sha} rests on a revision the workspace can no longer reach. ` +
          `The disposition still carries a resolvable reading, so the advance stands; re-read at ` +
          `a reachable commit to restore the second one.`,
      );
    }
  }

  // The refusals cap their enumeration and so does this list: a status advance
  // is not a paged reader, and a subsystem whose history was rewritten wholesale
  // could otherwise return one line per attachment. The count is kept, so the
  // scale is still visible; `get_disposition_evidence` has the rest.
  if (warnings.length > NAMED_IN_REFUSAL) {
    const elided = warnings.length - NAMED_IN_REFUSAL;
    warnings.length = NAMED_IN_REFUSAL;
    warnings.push(
      `${elided} further attachment(s) of ${subsystemId} rest on revisions the workspace can no ` +
        `longer reach; get_disposition_evidence names them.`,
    );
  }

  if (unattached.length > 0) {
    throw new ToolError(
      `cannot advance ${subsystemId} to '${targetStatus}': ${unattached.length} disposition(s) ` +
        `were answered from nothing — ${nameRows(unattached)}. Every concern this subsystem has ` +
        `dispositioned must carry at least one attached evidence row whose ref_sha resolves. ` +
        `Record the reading with add_evidence and link it with attach_evidence_to_disposition, ` +
        `or pass evidence_ids to set_disposition.`,
    );
  }
  if (unreachable.length > 0) {
    throw new ToolError(
      `cannot advance ${subsystemId} to '${targetStatus}': ${unreachable.length} disposition(s) ` +
        `rest on evidence whose revision is no longer reachable — ${nameRows(unreachable)}. ` +
        `Re-read at a reachable commit and attach the new evidence; an unreachable anchor cannot ` +
        `be verified in place.`,
    );
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// §3 Scope reconciliation before authority
// ---------------------------------------------------------------------------

/**
 * One reading of the repository's tracked paths against the file ledger, at one
 * revision, as `scope_reconciliations` stores it.
 */
export interface ScopeReconciliation {
  id: number;
  detected_sha: string;
  tree_digest: string;
  ledger_digest: string;
  tracked_paths: number;
  ledger_rows: number;
  unledgered: number;
  absent: number;
  exempt: number;
}

/**
 * A path set, as one hash. Sorted so the digest is a statement about the set
 * and not about the order git or SQLite happened to return it in, and joined on
 * NUL because that is the one byte a repository path cannot contain.
 */
const NUL = "\u0000";
function digestOf(parts: readonly string[]): string {
  return createHash("sha256")
    .update([...parts].sort().join(NUL))
    .digest("hex");
}

/** §3.2's `tree_digest`: the tracked path set the counts were taken over. */
export function trackedPathDigest(paths: readonly string[]): string {
  return digestOf(paths);
}

/**
 * §3.2's `ledger_digest`: the ledger the counts were taken against.
 *
 * Over (path, classification) pairs, one entry per ledger row, so a second
 * owner for a path, a re-classification, an added path and a dropped path all
 * move it. Re-assigning a row from one subsystem to another with the same
 * classification does not, which is the one ledger mutation a standing
 * reconciliation survives; `test-scope-reconciliation.mjs` records that as a
 * false green it cannot exclude.
 */
export function ledgerDigest(db: DB): string {
  const rows = db.prepare("SELECT file_path, classification FROM file_ledger").all() as Array<{
    file_path: string;
    classification: string | null;
  }>;
  return digestOf(rows.map((row) => `${row.file_path}${NUL}${row.classification ?? ""}`));
}

/**
 * The paths a revision's **tree** carries.
 *
 * `git ls-files` reads the index — the working tree's staged state, which moves
 * under an unrelated `git add` and does not describe the revision at all. A
 * coverage fraction stamped with R may only be taken over R's own immutable
 * tree (§3.3, `dev/adr/0001-living-conspectus-terms.md:19`). `-z` because git
 * quotes any path it cannot print literally, and a quoted path is a different
 * string from the one the ledger stores.
 */
export function listTrackedPaths(workspacePath: string, revision: string): string[] | null {
  const result = spawnSync("git", ["ls-tree", "-r", "--name-only", "-z", revision], {
    cwd: workspacePath,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? "")
    .split(NUL)
    .filter((path) => path.length > 0);
}

/** Whether a store is *reconciled at R*, and when it is not, why not. */
export type ReconciliationStanding = {
  standing: ScopeReconciliation | null;
  sha: string | null;
  why: string | null;
  lastCheckedSha: string | null;
  latestSha: string | null;
};

function readLastCheckedSha(db: DB): string | null {
  return (
    (
      db.prepare("SELECT last_checked_sha FROM git_state WHERE repo_id = 'default'").get() as
        | { last_checked_sha: string | null }
        | undefined
    )?.last_checked_sha ?? null
  );
}

/**
 * §3.3, mechanically. A store is **reconciled at revision R** exactly when R
 * resolves and is normalized to its full 40-hex commit id; a
 * `scope_reconciliations` row carries that sha; `git_state.last_checked_sha`,
 * normalized the same way, equals it; and the row's two digests still match
 * digests re-derived **now** from the tree at R and from `file_ledger`.
 *
 * Conditions 4 and 5 are what make the reading stand rather than merely have
 * happened: the first catches a row taken over a tree the revision does not
 * produce, the second catches the ordinary case — every later
 * `add_files_to_scope` or classification change invalidates the standing
 * reconciliation, and the store reverts to *unreconciled at R* until
 * `detect_changes` runs again. A store that has been edited since it last
 * checked itself against the tree has not checked itself against the tree.
 *
 * The standing reconciliation is the most recent row that satisfies all of
 * them, so a forged or superseded row cannot displace a genuine one: it simply
 * does not qualify.
 */
export function readReconciliationStanding(
  db: DB,
  workspacePath: string,
  revision: string,
): ReconciliationStanding {
  const lastCheckedSha = readLastCheckedSha(db);
  const latestSha =
    (
      db.prepare("SELECT detected_sha FROM scope_reconciliations ORDER BY id DESC LIMIT 1").get() as
        | { detected_sha: string }
        | undefined
    )?.detected_sha ?? null;
  const base = { standing: null, sha: null, lastCheckedSha, latestSha };

  // Both revisions in one `git cat-file --batch-check`, for the reason §2.2
  // batches a disposition's attachments: this predicate runs on every advance to
  // `mapped` and on every publication, and a subprocess per revision puts a
  // status advance's cost in the number of revisions it happens to compare.
  const normalized = resolveWorkspaceCommits(
    workspacePath,
    lastCheckedSha === null ? [revision] : [revision, lastCheckedSha],
  );
  const resolved = normalized.get(revision) ?? null;
  if (resolved === null) {
    return {
      ...base,
      why: `${revision} does not resolve to a commit in the bound workspace ${workspacePath}`,
    };
  }
  const tracked = listTrackedPaths(workspacePath, resolved);
  if (tracked === null) {
    return { ...base, sha: resolved, why: `the tree at ${resolved} could not be enumerated` };
  }
  const normalizedLastChecked =
    lastCheckedSha === null ? null : (normalized.get(lastCheckedSha) ?? null);
  if (normalizedLastChecked !== resolved) {
    return {
      ...base,
      sha: resolved,
      why: `git_state.last_checked_sha is ${lastCheckedSha ?? "unset"}`,
    };
  }
  const treeDigest = trackedPathDigest(tracked);
  const currentLedgerDigest = ledgerDigest(db);
  const row = db
    .prepare(
      `SELECT id, detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows,
              unledgered, absent, exempt
         FROM scope_reconciliations
        WHERE detected_sha = ? AND tree_digest = ? AND ledger_digest = ?
        ORDER BY id DESC LIMIT 1`,
    )
    .get(resolved, treeDigest, currentLedgerDigest) as ScopeReconciliation | undefined;
  if (row) return { standing: row, sha: resolved, why: null, lastCheckedSha, latestSha };

  // No qualifying row. Name which condition failed, because the repairs read
  // differently: a store that never reconciled at R and one whose ledger moved
  // under the row both run detect_changes, but a reader told only
  // "unreconciled" cannot tell a first reading from a lost one.
  const atSha = db
    .prepare(
      "SELECT tree_digest FROM scope_reconciliations WHERE detected_sha = ? ORDER BY id DESC",
    )
    .all(resolved) as Array<{ tree_digest: string }>;
  let why = "no reconciliation has been recorded at that revision";
  if (atSha.length > 0) {
    why = atSha.some((candidate) => candidate.tree_digest === treeDigest)
      ? "the file ledger has changed since the reconciliation recorded there was taken"
      : "the reconciliation recorded there was taken over a different tree";
  }
  return { ...base, sha: resolved, why };
}

/**
 * §3.3's first refusal: the advance to `mapped`.
 *
 * `mapped` is the status that licenses the phrase *fully surveyed*
 * (`dev/adr/0001-living-conspectus-terms.md:19`, clause 1), and a subsystem
 * cannot reach it while the store cannot say what the inventory was. It binds
 * at `mapped` rather than at `structural` because the reconciliation is a
 * whole-store fact and belongs at the whole-store claim; refusing earlier would
 * stop a rebuild progressing subsystem by subsystem (README §4).
 *
 * *Reconciled* is weaker than *complete*, and only the second licenses
 * publication (§3.3a): a store that accurately records 501 unledgered paths is
 * reconciled, and this advance accepts it. {@link requireCompleteReconciliation}
 * is where clause 1 binds in full.
 *
 * Without a bound workspace there is no tree to compare against, so the check
 * reports rather than refuses — the treatment §2.3 already gives an unresolved
 * revision. Every status writer in this server passes one
 * (`src/tools/subsystems.ts:127`, `:201`).
 */
export function requireReconciledStore(
  db: DB,
  subsystemId: string,
  workspacePath: string | null,
): string[] {
  if (workspacePath === null) {
    return [
      `${subsystemId} advanced to 'mapped' without a bound workspace, so §3.3's reconciliation ` +
        `was not checked: the store's coverage denominator is unverified for this advance.`,
    ];
  }
  const reading = readReconciliationStanding(db, workspacePath, "HEAD");
  if (reading.standing !== null) return [];
  const named = reading.sha ?? "HEAD";
  throw new ToolError(
    `cannot advance ${subsystemId} to 'mapped': the store has not been reconciled against the ` +
      `repository at ${named} — ${reading.why}. Run detect_changes(current_sha=${named}) and ` +
      `assign or exempt every unledgered path it reports; a subsystem cannot be mapped while ` +
      `the store cannot say what the tree contains.`,
  );
}

/**
 * §3.3 and §3.3a's second refusal: publication, and any other whole-store claim
 * that rests on the phrase *fully surveyed*.
 *
 * Returns the refusal message, or `null` when the store may publish. The two
 * refusals are separate because the repairs differ: an unreconciled store has
 * no denominator at all, and a reconciled store reporting a nonzero
 * `unledgered` or `absent` has one over a tree nobody finished inventorying.
 * Publication is the whole-store claim, and a coverage fraction over a tree 501
 * of whose paths nobody assigned or excluded is a fraction of a set the store
 * never inventoried.
 *
 * `operation` names the caller so the sentence reads as that caller's refusal;
 * §5.5's fully-surveyed predicate is the other one.
 */
export function requireCompleteReconciliation(
  db: DB,
  workspacePath: string,
  revision: string,
  operation: string,
): string | null {
  const reading = readReconciliationStanding(db, workspacePath, revision);
  if (reading.standing === null) {
    const named = reading.sha ?? revision;
    return (
      `${operation} refuses: the store has not been reconciled against the repository at ` +
      `${named} (git_state.last_checked_sha=${reading.lastCheckedSha ?? "unset"}, latest ` +
      `reconciliation at ${reading.latestSha ?? "none"}) — ${reading.why}. Coverage published ` +
      `over an unreconciled ledger is a fraction of itself. Run detect_changes first.`
    );
  }
  const { unledgered, absent } = reading.standing;
  if (unledgered === 0 && absent === 0) return null;
  return (
    `${operation} refuses: the standing reconciliation at ${reading.sha} reports ${unledgered} ` +
    `tracked path(s) with no ledger row and ${absent} ledger row(s) the tree no longer carries. ` +
    `Every tracked path needs exactly one subsystem assignment or an explicit exclusion with a ` +
    `reason before coverage over that tree is published (ADR-0001, Fully surveyed, clause 1). ` +
    `detect_changes names every one in unledgered_paths and absent_ledger_paths.`
  );
}

/**
 * Enforce that advancing a subsystem to a higher status requires evidence
 * that the prior phase ran. Called only for genuine forward transitions
 * (targetRank > currentRank); no-ops and deferred toggles are exempt.
 *
 * | Target status | Required prior-phase evidence                          |
 * |---------------|--------------------------------------------------------|
 * | structural    | ≥1 file_ledger row (scoper ran add_files_to_scope)     |
 * |               |   AND ≥1 current claim keyed `<sid>/…` (the structural |
 * |               |   phase recorded its inventory through add_claim)      |
 * |               |   AND an anchored term scoped to it or an effective     |
 * |               |   declination — discharge or decline, never a floor     |
 * | concerns      | ≥1 artifacts row kind='subsystem-survey' (structural   |
 * |               |   phase wrote and registered its narrative document)   |
 * | adversarial   | ≥1 dispositions row (concerns pass ran set_disposition)|
 * | mapped        | every current claim keyed `<sid>/…` carries a recorded |
 * |               |   challenge outcome — the adversarial pass ran over   |
 * |               |   the account the advance is about to publish         |
 *
 * `concerns`, `adversarial` and `mapped` additionally require that every
 * disposition the subsystem holds carries at least one attached evidence row
 * whose revision resolves (§2.3, {@link requireAttachedEvidence}), and `mapped`
 * alone requires the whole store to be reconciled against the repository at
 * HEAD (§3.3, {@link requireReconciledStore}). Returns the lines the advance
 * should report — attachments whose revision the workspace can no longer reach
 * on a disposition that still has a resolvable one, and an advance checked
 * without a bound workspace. An empty array is the ordinary result.
 *
 * When an agent skips phases (e.g. unmapped→concerns), every intermediate
 * status's prerequisites are checked in order, so the first missing one
 * produces a clear error pointing at the skipped phase.
 */
export function enforcePhasePrerequisites(
  db: DB,
  subsystemId: string,
  targetStatus: SubsystemStatus,
  workspacePath: string | null = null,
): string[] {
  const reported: string[] = [];
  switch (targetStatus) {
    case "structural": {
      const { n } = db
        .prepare("SELECT COUNT(*) AS n FROM file_ledger WHERE subsystem_id = ?")
        .get(subsystemId) as { n: number };
      if (n === 0) {
        throw new ToolError(
          `cannot advance ${subsystemId} to 'structural': the file ledger is empty. ` +
            `The scoping phase must populate it via add_files_to_scope before the ` +
            `structural phase begins.`,
        );
      }
      requireStructuralClaim(db, subsystemId);
      // §4.4, after the claim: the missing claim is the phase's own deliverable
      // and names the pass that did not run, so it is the first thing a caller
      // is told. The vocabulary obligation is the second sentence of the same
      // phase, not a different one.
      reported.push(...requireVocabularyDischarge(db, subsystemId, workspacePath));
      break;
    }
    case "concerns": {
      const { n } = db
        .prepare(
          "SELECT COUNT(*) AS n FROM artifacts WHERE subsystem_id = ? AND kind = 'subsystem-survey'",
        )
        .get(subsystemId) as { n: number };
      if (n === 0) {
        throw new ToolError(
          `cannot advance ${subsystemId} to 'concerns': no subsystem-survey artifact ` +
            `has been registered. The structural phase must write its narrative document ` +
            `and call register_artifact(kind='subsystem-survey') before the concern pass begins.`,
        );
      }
      break;
    }
    case "adversarial": {
      const { n } = db
        .prepare("SELECT COUNT(*) AS n FROM dispositions WHERE subsystem_id = ?")
        .get(subsystemId) as { n: number };
      if (n === 0) {
        throw new ToolError(
          `cannot advance ${subsystemId} to 'adversarial': no concern dispositions have ` +
            `been recorded. The concerns phase must evaluate at least one concern territory ` +
            `via set_disposition before the adversarial pass begins.`,
        );
      }
      break;
    }
    case "mapped": {
      requireChallengedClaims(db, subsystemId);
      // §3.3, beside the challenge check and after it: an unchallenged claim is
      // this subsystem's own missing pass, and naming it first tells the caller
      // to do the thing only it can do. The reconciliation is a whole-store
      // fact and is the second sentence, not the first.
      reported.push(...requireReconciledStore(db, subsystemId, workspacePath));
      break;
    }
    default:
      // 'unmapped', 'scoping', 'deferred' — no prerequisites.
      break;
  }
  // Last, so the first refusal a caller sees is still the phase that was
  // skipped: "the concerns pass never ran" is a different repair from "the
  // concerns pass ran and answered one of them from nothing".
  if (targetStatus === "concerns" || targetStatus === "adversarial" || targetStatus === "mapped") {
    reported.push(...requireAttachedEvidence(db, subsystemId, targetStatus, workspacePath));
  }
  return reported;
}

/**
 * Every prerequisite between where a subsystem is and where a write is putting
 * it, checked in order so the first missing one names the phase that was
 * skipped. Regressions, no-op writes and `deferred` toggles pass through: the
 * rule binds genuine forward motion only.
 *
 * `previousStatus` is `null` for a row that does not exist yet, which an insert
 * opening straight at a later status is. That is read as `unmapped` — the
 * status such a row would have had a moment earlier — rather than as "no
 * transition to check", because a fresh insert at `structural` reaches the same
 * state as an advance to `structural` and must answer for the same evidence.
 *
 * Every tool that writes `subsystems.status` calls this. A prerequisite one
 * writer honours and another walks around is not enforced, and `upsert_subsystem`
 * is a status writer as much as `update_subsystem_status` is (slice-S3,
 * F3/codex).
 *
 * Returns the lines each rung asked the advance to report, de-duplicated:
 * a jump from `structural` to `mapped` checks §2.3 at all three rungs and would
 * otherwise say the same thing about the same attachment three times.
 * `workspacePath` is what those rungs resolve recorded revisions against.
 */
export function enforceForwardPrerequisites(
  db: DB,
  subsystemId: string,
  previousStatus: SubsystemStatus | null,
  targetStatus: SubsystemStatus,
  workspacePath: string | null = null,
): string[] {
  const from = previousStatus ?? "unmapped";
  const currentRank = STATUS_ORDER.indexOf(from as Exclude<SubsystemStatus, "deferred">);
  const targetRank = STATUS_ORDER.indexOf(targetStatus as Exclude<SubsystemStatus, "deferred">);
  if (currentRank < 0 || targetRank <= currentRank) return [];
  const reported = new Set<string>();
  for (const status of STATUS_ORDER.slice(currentRank + 1, targetRank + 1)) {
    for (const line of enforcePhasePrerequisites(db, subsystemId, status, workspacePath)) {
      reported.add(line);
    }
  }
  return [...reported];
}

/**
 * Require an active session. Writes to the conspectus should always
 * be attributable to a session for audit purposes; the coordinator
 * opens one as Phase 0 of onboarding and at the start of each survey
 * pass. Reads are unaffected.
 */
export function requireActiveSession(ctx: ServerContext, operation: string): string {
  if (!ctx.sessionId) {
    throw new ToolError(`${operation} requires an active session. Call start_session first.`);
  }
  return ctx.sessionId;
}

/**
 * Evidence-required-to-overturn invariant. Overturning a finding — moving
 * it to `ruled-out` — is the adversarial pass's strongest move, and the
 * methodology's rule is "overturning requires evidence, not vibes." That
 * rule lived only in agent prose, which decays under autonomous execution.
 * This makes it machine-checked: a transition *into* `ruled-out` must be
 * backed by at least one evidence row attached to the finding in the
 * current session (i.e. gathered by the overturning pass itself, not
 * pre-existing evidence carried over from the Phase 3 read that confirmed
 * it). A bare reclassification with no new evidence is exactly the
 * "flip on re-reading" noise the guard exists to reject.
 *
 * Only the transition matters: re-affirming an already `ruled-out` finding,
 * or any non-overturn status change (e.g. confirmed-bug → fixed), is
 * unaffected.
 */
export function requireOverturnEvidence(
  db: DB,
  findingId: string,
  sessionId: string,
  previousStatus: string,
  newStatus: string,
): void {
  if (newStatus !== "ruled-out" || previousStatus === "ruled-out") return;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM finding_evidence fe
         JOIN evidence e ON e.id = fe.evidence_id
        WHERE fe.finding_id = ? AND e.session_id = ?`,
    )
    .get(findingId, sessionId) as { n: number };
  if (row.n === 0) {
    throw new ToolError(
      `cannot overturn finding ${findingId} to 'ruled-out': no new evidence was attached ` +
        `in this session. Overturning requires evidence, not vibes — record the disproving ` +
        `evidence with add_evidence, link it via attach_evidence_to_finding, then re-try the ` +
        `status change. A reclassification with no new evidence is recorded as an open ` +
        `question, not applied.`,
    );
  }
}

// ---------------------------------------------------------------------------
// §5: findings carry forward
// ---------------------------------------------------------------------------

/**
 * §5.3's store identity, for a source store this process is about to carry
 * from.
 *
 * Two forms, and the prefix says which. A store that minted a
 * `store_generation` reports `store-` plus its first 16 hex, read from the row
 * and never recomputed. The archive at `…/archive/store-7c1c1a9/memory.db` was
 * frozen before that column existed and is immutable — it cannot be given one
 * now — so for a source with no `store_identity` row the id is `store-legacy-`
 * plus the first 16 hex of SHA-256 over that store's frozen
 * `<repo_id>|<canonical_branch>|<onboarding_sha>|<last_checked_sha>`.
 *
 * That derivation is sound *for an archive*, whose `git_state` is frozen along
 * with the rest of it, and unsound for a live store, whose `last_checked_sha`
 * `set_git_state` may change at any time. The prefix is what tells a later
 * reader which of the two they are holding, and the fallback is reached only
 * when the minted row is genuinely absent.
 *
 * The source is opened **read-only**: deriving an identity must not write one,
 * because an open through `openDatabase` would mint the very row whose absence
 * selects the legacy form, and would silently turn every archive into a
 * first-form store the moment it was read.
 *
 * `readonly: true` is not, however, what §5.3 asks for on the legacy path. It
 * opens a live file: it takes locks, replays the `-wal`, and sees whatever a
 * concurrent writer has committed. §5.3 makes the legacy form "available only
 * when the source is opened `?immutable=1`", and a reviewer showed why — a
 * live pre-identity store handed to this function was named, and naming it
 * again after an ordinary `set_git_state` produced a different id for the same
 * store (F3/codex, slice S1). So the legacy derivation is reached only through
 * `{ immutable: true }`, which opens `file:<path>?immutable=1` — SQLite's own
 * frozen-snapshot mode, which takes no lock and replays no WAL — and an
 * ordinary path is refused before it can be named.
 *
 * The declaration is not taken on trust. The tuple read through the immutable
 * open is compared with the tuple a live read-only open sees, and a
 * disagreement means the `-wal` carries a change to the very row the id is
 * derived from: the source is not frozen, and it is refused rather than named.
 */
/** §5.3's identity tuple, `<repo_id>|<canonical_branch>|<onboarding_sha>|<last_checked_sha>`. */
function readIdentityTuple(db: DB, sourcePath: string, through: string): string {
  const git = db
    .prepare(
      "SELECT repo_id, canonical_branch, onboarding_sha, last_checked_sha FROM git_state ORDER BY repo_id LIMIT 1",
    )
    .get() as
    | {
        repo_id: string | null;
        canonical_branch: string | null;
        onboarding_sha: string | null;
        last_checked_sha: string | null;
      }
    | undefined;
  if (!git) {
    throw new ToolError(
      `the carry source at ${sourcePath} carries neither a store_identity row nor a git_state ` +
        `row through ${through}, so it cannot be named. A carried record must name the store it ` +
        `came from (§5.3).`,
    );
  }
  return [
    git.repo_id ?? "",
    git.canonical_branch ?? "",
    git.onboarding_sha ?? "",
    git.last_checked_sha ?? "",
  ].join("|");
}

/**
 * The same tuple, read through `file:<path>?immutable=1` — SQLite's frozen
 * snapshot: no lock taken, no `-wal` replayed, no concurrent writer observed.
 *
 * `better-sqlite3` cannot open a URI (11.10.0 treats `file:…` as a literal
 * filename and reports that the directory does not exist), so the immutable
 * read goes through `node:sqlite`, which does. It is reached with
 * `process.getBuiltinModule` rather than a top-level import so that loading
 * this module still works on a runtime that does not carry it; a runtime that
 * cannot open a source immutably is told so instead of being handed the
 * `readonly: true` fallback §5.3 refuses.
 */
function readImmutableIdentityTuple(sourcePath: string): string {
  const absolute = resolvePath(sourcePath);
  const sqlite = (
    process as unknown as { getBuiltinModule?: (id: string) => unknown }
  ).getBuiltinModule?.("node:sqlite") as
    | { DatabaseSync: new (location: string, options?: unknown) => DB }
    | undefined;
  if (!sqlite?.DatabaseSync) {
    throw new ToolError(
      `this runtime (${process.version}) carries no node:sqlite, so the carry source at ` +
        `${sourcePath} cannot be opened immutably, and §5.3's legacy derivation is available ` +
        `only through an immutable open. Run the carry on a runtime that has it.`,
    );
  }
  // A SQLite URI: '?' and '#' end the path, so they are the two characters
  // that must be escaped in it.
  const uri = `file:${encodeURI(absolute).replace(/\?/g, "%3f").replace(/#/g, "%23")}?immutable=1`;
  let db: DB;
  try {
    db = new sqlite.DatabaseSync(uri, { readOnly: true });
  } catch (error) {
    throw new ToolError(
      `the carry source at ${sourcePath} could not be opened immutably: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    return readIdentityTuple(db, sourcePath, "the immutable open");
  } finally {
    try {
      db.close();
    } catch {
      /* the read already happened; a close failure changes no answer */
    }
  }
}

export function archivedStoreId(sourcePath: string, options: { immutable?: boolean } = {}): string {
  let db: DB | null = null;
  try {
    db = new SqliteDatabase(sourcePath, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new ToolError(
      `the carry source at ${sourcePath} could not be opened read-only: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    const identity = readIdentityState(db);
    if (identity.kind === "minted") return `store-${identity.value.slice(0, 16)}`;
    if (identity.kind === "empty") {
      // The table is here and the row is not. That is not a store frozen before
      // the column existed — it is one whose identity went missing, most likely
      // a `memory.db` copied away from the `-wal` that carried the mint. The
      // legacy derivation would name it anyway, and name it *differently* from
      // the store it was copied from, so it is refused here rather than allowed
      // to invent a second identity for one archive.
      throw new ToolError(
        `the carry source at ${sourcePath} carries a store_identity table with no row. A store ` +
          `frozen before that table existed has no table at all; one that has the table and no ` +
          `row has lost its identity, and deriving a legacy id for it would name the same archive ` +
          `twice. Copy the archive whole — memory.db together with its -wal and -shm — and re-run.`,
      );
    }
    if (options.immutable !== true) {
      throw new ToolError(
        `the carry source at ${sourcePath} carries no store_identity table, so naming it means ` +
          `§5.3's legacy derivation over its git_state row — and that derivation is available ` +
          `only when the source is opened immutably. A live store's last_checked_sha moves under ` +
          `set_git_state and its derived id moves with it, so the same store would be named twice. ` +
          `Open it as the frozen archive it is (archivedStoreId(path, { immutable: true })), or ` +
          `carry from a store that minted an identity.`,
      );
    }
    const live = readIdentityTuple(db, sourcePath, "the live read-only open");
    const frozen = readImmutableIdentityTuple(sourcePath);
    if (live !== frozen) {
      throw new ToolError(
        `the carry source at ${sourcePath} was declared a frozen archive and is not one: its ` +
          `git_state row reads '${frozen}' in the database file and '${live}' once the -wal is ` +
          `replayed. §5.3's legacy id is derived from a frozen row; a row that two reads of the ` +
          `same file disagree about would name this archive twice. Checkpoint and re-freeze the ` +
          `archive, or carry from a store that minted an identity.`,
      );
    }
    return `store-legacy-${createHash("sha256").update(frozen).digest("hex").slice(0, 16)}`;
  } finally {
    try {
      db.close();
    } catch {
      /* the read already happened; a close failure changes no answer */
    }
  }
}

/** This store's own §5.3 identity, or null on a store that predates the table. */
export function storeIdentity(db: DB): string | null {
  const identity = readIdentityState(db);
  return identity.kind === "minted" ? `store-${identity.value.slice(0, 16)}` : null;
}

/**
 * Three states, never two.
 *
 * `absent` is a store frozen before `store_identity` existed, and is what
 * selects §5.3's legacy derivation. `empty` is a store that has the table and
 * lost the row — a different fact, answered differently, because collapsing the
 * two would let one archive be named twice under two different schemes.
 */
type IdentityState = { kind: "minted"; value: string } | { kind: "absent" } | { kind: "empty" };

function readIdentityState(db: DB): IdentityState {
  let row: { store_generation: string | null } | undefined;
  try {
    row = db.prepare("SELECT store_generation FROM store_identity WHERE id = 1").get() as
      | { store_generation: string | null }
      | undefined;
  } catch {
    return { kind: "absent" };
  }
  const value = row?.store_generation ?? null;
  return typeof value === "string" && value.length > 0
    ? { kind: "minted", value }
    : { kind: "empty" };
}

/**
 * Whether `ancestor` is a descendant-or-equal relation's left side: true when
 * `ancestor` is an ancestor of `descendant`, or the two are the same commit.
 *
 * "At or after" has no meaning on a Git DAG until it is said which relation is
 * meant. §5.4 says ancestry, so a reading taken on a sibling branch that never
 * contained the repair does not discharge it, however much later its timestamp
 * is. `git merge-base --is-ancestor` is the test, and it answers true for equal
 * commits.
 */
export function isAncestorOrSame(
  workspacePath: string,
  ancestor: string,
  descendant: string,
): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: workspacePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return !result.error && result.status === 0;
}

/** One carried record's terminal outcome, or null while it is undecided. */
export interface CarriedOutcome {
  outcome: "successor-finding" | "ruled-out" | "repaired" | "archived-terminal";
  successor_id: string | null;
  repaired_sha: string | null;
}

/**
 * The carried records this store holds that no outcome has decided, with the
 * obligation id §5.5 gives each of them.
 *
 * Enforced at the whole-store predicate and **not** at `mapped` for the carried
 * finding's subsystem, per `README.md` §4: a rebuild must be able to progress
 * subsystem by subsystem, and a carried record names a subsystem that may not
 * exist here at all.
 */
export function undecidedCarriedFindings(db: DB): Array<{
  carried_id: number;
  archived_finding_id: string;
  archived_store_id: string;
  severity: string;
  obligation_id: string;
}> {
  const rows = db
    .prepare(
      `SELECT cf.carried_id, cf.archived_finding_id, cf.archived_store_id, cf.severity
         FROM carried_findings cf
         LEFT JOIN carried_finding_outcomes o ON o.carried_id = cf.carried_id
        WHERE o.id IS NULL
        ORDER BY cf.archived_store_id, cf.archived_finding_id`,
    )
    .all() as Array<{
    carried_id: number;
    archived_finding_id: string;
    archived_store_id: string;
    severity: string;
  }>;
  return rows.map((row) => ({
    ...row,
    obligation_id: `carried:${row.archived_store_id}:${row.archived_finding_id}`,
  }));
}

/** One archived finding, as a carry reads it out of a source store. */
export interface ArchivedFinding {
  finding_id: string;
  subsystem_id: string;
  symptom: string;
  root_cause: string;
  severity: string;
  resolution_state: string;
  ref_sha: string | null;
  primary_files: string[];
}

/**
 * `finding_state_current` on a connection whose store may predate it.
 *
 * A no-op where the archive declares the view. Where it does not, the view is
 * declared `TEMP` — which SQLite allows on a read-only main database, because
 * the temp schema is a separate one — so the read below selects from the same
 * definition every other reader selects from.
 */
function requireFindingStateView(db: DB, sourcePath: string): void {
  const present = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='view' AND name='finding_state_current'")
    .get();
  if (present) return;
  const canonical = canonicalCreateViewSql("finding_state_current");
  if (!canonical) {
    throw new ToolError(
      `the carry source at ${sourcePath} declares no finding_state_current view and schema.sql ` +
        `carries no definition to re-declare over it, so the archive's findings cannot be read ` +
        `through the one place the legacy-status fallback is written.`,
    );
  }
  try {
    db.exec(canonical.replace(/CREATE VIEW IF NOT EXISTS/i, "CREATE TEMP VIEW"));
  } catch (error) {
    throw new ToolError(
      `the carry source at ${sourcePath} predates finding_state_current and the view could not ` +
        `be re-declared over it: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Every finding an archived store holds, with the identity and anchor a carry
 * has to record beside them.
 *
 * Read here rather than in the rebuild driver so the SQL lives where
 * `scripts/check-sql-identifiers.mjs` can see it, and so any reinitialization
 * path — not only that script — reads the archive the same way. The source is
 * opened read-only for the reason `archivedStoreId` gives: an open through
 * `openDatabase` would mint the identity row whose absence selects the legacy
 * form, turning every archive into a first-form store the moment it was read.
 *
 * `resolution_state` comes from `finding_state_current`, the view that carries
 * the legacy-status fallback exactly once: a second copy of that CASE here
 * would be the duplicated fallback `test-finding-partition.mjs` exists to
 * refuse, and would let an archive read one state on this path and another on
 * every other. The view returns exactly one row per `findings` row, so the join
 * neither drops a finding nor duplicates one, and *every* archived finding is
 * carried whatever its state (spec.md §5.4).
 *
 * **An archive predating the view still reads through it.** The one archive
 * §5.8 names — the clean-slate store frozen at `7c1c1a9` — carries
 * `finding_resolution_current` and `findings` but not `finding_state_current`,
 * because it was frozen before that view was declared, and it is immutable, so
 * it cannot be given one. The view is therefore re-declared as a `TEMP` view on
 * this read-only connection, from `schema.sql`'s own text: the archive is not
 * written, the definition is not copied into this file, and the fallback stays
 * in the single place the partition gate requires it to live. A store that has
 * the view keeps using its own.
 */
export function readArchivedStore(
  sourcePath: string,
  options: { immutable?: boolean } = {},
): {
  archived_store_id: string;
  archived_anchor: string;
  findings: ArchivedFinding[];
} {
  const archivedStore = archivedStoreId(sourcePath, options);
  let db: DB;
  try {
    db = new SqliteDatabase(sourcePath, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new ToolError(
      `the carry source at ${sourcePath} could not be opened read-only: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    const git = db
      .prepare("SELECT last_checked_sha, onboarding_sha FROM git_state ORDER BY repo_id LIMIT 1")
      .get() as { last_checked_sha: string | null; onboarding_sha: string | null } | undefined;
    requireFindingStateView(db, sourcePath);
    const rows = db
      .prepare(
        `SELECT f.finding_id, f.subsystem_id, f.symptom, f.root_cause, f.severity,
                f.ref_sha, f.primary_files, s.resolution_state
           FROM findings f
           JOIN finding_state_current s ON s.finding_id = f.finding_id
          ORDER BY f.finding_id`,
      )
      .all() as Array<{
      finding_id: string;
      subsystem_id: string;
      symptom: string;
      root_cause: string;
      severity: string;
      ref_sha: string | null;
      primary_files: string | null;
      resolution_state: string;
    }>;
    return {
      archived_store_id: archivedStore,
      archived_anchor: git?.last_checked_sha ?? git?.onboarding_sha ?? "",
      findings: rows.map((row) => ({
        finding_id: row.finding_id,
        subsystem_id: row.subsystem_id,
        symptom: row.symptom,
        root_cause: row.root_cause,
        severity: row.severity,
        resolution_state: row.resolution_state,
        ref_sha: row.ref_sha,
        primary_files: parseStringArray(row.primary_files),
      })),
    };
  } finally {
    try {
      db.close();
    } catch {
      /* the read already happened; a close failure changes no answer */
    }
  }
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}
