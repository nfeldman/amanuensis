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
import { ToolError } from "./helpers.js";

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
 * Enforce that advancing a subsystem to a higher status requires evidence
 * that the prior phase ran. Called only for genuine forward transitions
 * (targetRank > currentRank); no-ops and deferred toggles are exempt.
 *
 * | Target status | Required prior-phase evidence                          |
 * |---------------|--------------------------------------------------------|
 * | structural    | ≥1 file_ledger row (scoper ran add_files_to_scope)     |
 * | concerns      | ≥1 artifacts row kind='subsystem-survey' (structural   |
 * |               |   phase wrote and registered its narrative document)   |
 * | adversarial   | ≥1 dispositions row (concerns pass ran set_disposition)|
 * | mapped        | (no additional gate — monotonic + adversarial gates    |
 * |               |   are sufficient)                                       |
 *
 * When an agent skips phases (e.g. unmapped→concerns), every intermediate
 * status's prerequisites are checked in order, so the first missing one
 * produces a clear error pointing at the skipped phase.
 */
export function enforcePhasePrerequisites(
  db: DB,
  subsystemId: string,
  targetStatus: SubsystemStatus,
): void {
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
    default:
      // 'unmapped', 'scoping', 'deferred' — no prerequisites.
      break;
  }
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
