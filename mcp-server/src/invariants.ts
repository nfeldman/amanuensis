// Invariants that turn Amanuensis's epistemic contracts into server-side
// enforcement. Agent prose describes the workflow for the LLM's benefit;
// these helpers make the rules machine-checked, so a violation produces
// a ToolError instead of a silently-accepted bad write.
//
// The knowledge-depth contract (see README): a subsystem's mapping
// status determines what claims the agents are authorized to make about
// it. Claims exceeding the authorized level must be rejected at the
// write path.
import type { DB } from "./db.js";
import type { ServerContext } from "./helpers.js";
import { resolveWorkspaceCommits, ToolError } from "./helpers.js";

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
 * | concerns      | ≥1 artifacts row kind='subsystem-survey' (structural   |
 * |               |   phase wrote and registered its narrative document)   |
 * | adversarial   | ≥1 dispositions row (concerns pass ran set_disposition)|
 * | mapped        | every current claim keyed `<sid>/…` carries a recorded |
 * |               |   challenge outcome — the adversarial pass ran over   |
 * |               |   the account the advance is about to publish         |
 *
 * `concerns`, `adversarial` and `mapped` additionally require that every
 * disposition the subsystem holds carries at least one attached evidence row
 * whose revision resolves (§2.3, {@link requireAttachedEvidence}). Returns the
 * lines the advance should report — today, attachments whose revision the
 * workspace can no longer reach on a disposition that still has a resolvable
 * one. An empty array is the ordinary result.
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
    return requireAttachedEvidence(db, subsystemId, targetStatus, workspacePath);
  }
  return [];
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
