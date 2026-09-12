import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  optString,
  optStringArray,
  requireEnum,
  requireInt,
  requireString,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const CONTEXT_PROFILES = ["diff-scoped", "control-wide", "integral-head"] as const;
const VALIDATION_ABLATIONS = ["task-constraints", "impacted-seams", "stale-claims"] as const;
const CONSTRAINT_SOURCE_KINDS = ["direct-user", "repository-contract", "issue", "adr"] as const;

const SECTION_ORDER = [
  "task",
  "task_constraints",
  "changed_files",
  "stale_claims",
  "historical_findings",
  "compensating_controls",
  "impacted_seams",
  "contradictions",
  "obligations",
  "unknowns",
  "uncovered_files",
  "unaffected_controls",
  "integral_findings",
] as const;

const REQUIRED_SECTIONS = [
  "task",
  "task_constraints",
  "changed_files",
  "stale_claims",
  "historical_findings",
  "compensating_controls",
  "impacted_seams",
  "contradictions",
  "obligations",
  "unknowns",
  "uncovered_files",
] as const;

type Section = (typeof SECTION_ORDER)[number];
type ContextProfile = (typeof CONTEXT_PROFILES)[number];

interface TaskConstraint {
  constraint_id: string;
  statement: string;
  source_kind: (typeof CONSTRAINT_SOURCE_KINDS)[number];
  source_ref: string;
}

interface Candidate {
  section: Section;
  objectType: string;
  objectId: string;
  required: boolean;
  priority: number;
  reason: string;
  compact: Record<string, unknown>;
  source: Record<string, unknown>;
  provenance: Record<string, unknown>;
  profileIncluded: boolean;
}

interface TraceDraft extends Candidate {
  traceId: string;
  ordinal: number;
  action: "included" | "omitted" | "truncated" | "blocked";
  actionReason: string;
  estimatedTokens: number;
  obligationId: string | null;
}

interface ImpactRun {
  run_id: string;
  base_sha: string;
  head_sha: string;
  status: string;
  artifact_json: string;
}

interface ImpactObject {
  object_type: string;
  object_id: string;
  impact_kind: string;
  invalidates: number;
  reason_path: string;
}

interface ReviewBriefRow {
  brief_id: string;
  impact_run_id: string;
  context_profile: ContextProfile;
  task: string;
  task_constraints: string;
  reviewed_sha: string;
  token_budget: number;
  estimated_tokens: number;
  control_score: number;
  required_section_count: number;
  included_required_section_count: number;
  uncovered_file_count: number;
  omitted_section_count: number;
  truncated_item_count: number;
  status: string;
  brief_json: string;
  brief_hash: string;
  session_id: string;
  created_at: string;
  published_at: string | null;
}

function git(ctx: ServerContext, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("git", args, {
    cwd: ctx.project.workspacePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveCommit(ctx: ServerContext, requested: string): string {
  const result = git(ctx, ["rev-parse", "--verify", `${requested}^{commit}`]);
  const sha = result.stdout?.toString().trim() ?? "";
  if (result.status !== 0 || !sha) throw new ToolError(`unknown git commit: ${requested}`);
  return sha;
}

function isAncestor(ctx: ServerContext, ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  const result = git(ctx, ["merge-base", "--is-ancestor", ancestor, descendant]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return false;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function compactText(value: string | null, maximum = 180): string | null {
  if (value === null || value.length <= maximum) return value;
  return `${value.slice(0, maximum - 1)}…`;
}

function estimateTokens(value: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
}

function sourceHasUnreachableEvidence(source: Record<string, unknown>): boolean {
  if (!Array.isArray(source.evidence)) return false;
  return source.evidence.some(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      (row as Record<string, unknown>).reachable_at_reviewed_sha !== true,
  );
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(",");
}

function parseConstraints(args: Record<string, unknown>): TaskConstraint[] {
  const value = args.task_constraints;
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolError("task_constraints must contain at least one typed constraint");
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ToolError(`task_constraints[${index}] must be an object`);
    }
    const row = item as Record<string, unknown>;
    const constraintId = requireString(row, "constraint_id");
    if (seen.has(constraintId)) throw new ToolError(`duplicate constraint_id: ${constraintId}`);
    seen.add(constraintId);
    return {
      constraint_id: constraintId,
      statement: requireString(row, "statement"),
      source_kind: requireEnum(row, "source_kind", CONSTRAINT_SOURCE_KINDS),
      source_ref: requireString(row, "source_ref"),
    };
  });
}

function getImpactRun(ctx: ServerContext, runId: string): ImpactRun {
  const run = ctx.db.prepare("SELECT * FROM change_impact_runs WHERE run_id=?").get(runId) as
    | ImpactRun
    | undefined;
  if (!run) throw new ToolError(`unknown change impact run: ${runId}`);
  return run;
}

function getBrief(ctx: ServerContext, briefId: string): ReviewBriefRow {
  const row = ctx.db.prepare("SELECT * FROM review_briefs WHERE brief_id=?").get(briefId) as
    | ReviewBriefRow
    | undefined;
  if (!row) throw new ToolError(`unknown review brief: ${briefId}`);
  return row;
}

function claimEvidence(ctx: ServerContext, claimId: string, reviewedSha: string) {
  return (
    ctx.db
      .prepare(
        `SELECT e.*, ce.role
           FROM claim_evidence ce JOIN evidence e ON e.id=ce.evidence_id
          WHERE ce.claim_id=? ORDER BY e.id`,
      )
      .all(claimId) as Array<Record<string, unknown> & { id: number; ref_sha: string }>
  ).map((row) => ({
    ...row,
    reachable_at_reviewed_sha: isAncestor(ctx, row.ref_sha, reviewedSha),
  }));
}

function findingEvidence(ctx: ServerContext, findingId: string, reviewedSha: string) {
  return (
    ctx.db
      .prepare(
        `SELECT e.*, fe.role
           FROM finding_evidence fe JOIN evidence e ON e.id=fe.evidence_id
          WHERE fe.finding_id=? ORDER BY e.id`,
      )
      .all(findingId) as Array<Record<string, unknown> & { id: number; ref_sha: string }>
  ).map((row) => ({
    ...row,
    reachable_at_reviewed_sha: isAncestor(ctx, row.ref_sha, reviewedSha),
  }));
}

function dispositionEvidence(
  ctx: ServerContext,
  subsystemId: string,
  concernCode: string,
  reviewedSha: string,
) {
  return (
    ctx.db
      .prepare(
        `SELECT e.*, de.role
           FROM disposition_evidence de JOIN evidence e ON e.id=de.evidence_id
          WHERE de.subsystem_id=? AND de.concern_code=? ORDER BY e.id`,
      )
      .all(subsystemId, concernCode) as Array<
      Record<string, unknown> & { id: number; ref_sha: string }
    >
  ).map((row) => ({
    ...row,
    reachable_at_reviewed_sha: isAncestor(ctx, row.ref_sha, reviewedSha),
  }));
}

function buildCandidates(
  ctx: ServerContext,
  run: ImpactRun,
  task: string,
  constraints: TaskConstraint[],
  profile: ContextProfile,
): Candidate[] {
  const objects = ctx.db
    .prepare("SELECT * FROM change_impact_objects WHERE run_id=? ORDER BY object_type, object_id")
    .all(run.run_id) as ImpactObject[];
  const paths = new Map(
    objects.map((row) => [
      `${row.object_type}\u0000${row.object_id}`,
      parseJson<Array<Record<string, unknown>>>(row.reason_path, []),
    ]),
  );
  const candidates: Candidate[] = [];
  const add = (candidate: Candidate) => candidates.push(candidate);

  add({
    section: "task",
    objectType: "review-task",
    objectId: "objective",
    required: true,
    priority: 0,
    reason: "the review objective defines the decision surface",
    compact: { objective: compactText(task, 240), epistemic_kind: "direct-intent" },
    source: { objective: task, epistemic_kind: "direct-intent" },
    provenance: { source_kind: "direct-user", source_ref: "compile_review_brief.task" },
    profileIncluded: true,
  });
  for (const constraint of constraints) {
    add({
      section: "task_constraints",
      objectType: "task-constraint",
      objectId: constraint.constraint_id,
      required: true,
      priority: 0,
      reason: "explicit task constraints bound review recommendations",
      compact: {
        constraint_id: constraint.constraint_id,
        statement: compactText(constraint.statement, 220),
        source_kind: constraint.source_kind,
      },
      source: {
        ...constraint,
        epistemic_kind: constraint.source_kind === "direct-user" ? "direct-intent" : "observation",
      },
      provenance: { source_kind: constraint.source_kind, source_ref: constraint.source_ref },
      profileIncluded: true,
    });
  }

  const changedFiles = ctx.db
    .prepare("SELECT * FROM change_impact_files WHERE run_id=? ORDER BY ordinal")
    .all(run.run_id) as Array<Record<string, unknown> & { ordinal: number }>;
  for (const file of changedFiles) {
    add({
      section: "changed_files",
      objectType: "changed-file",
      objectId: String(file.path_after ?? file.path_before ?? file.ordinal),
      required: true,
      priority: 0,
      reason: "Git diff is the primary review scope",
      compact: {
        change_type: file.change_type,
        path_before: file.path_before,
        path_after: file.path_after,
        similarity: file.similarity,
      },
      source: { ...file, base_sha: run.base_sha, head_sha: run.head_sha },
      provenance: { source_kind: "git-diff", base_sha: run.base_sha, head_sha: run.head_sha },
      profileIncluded: true,
    });
  }

  const claimObjects = objects.filter((row) => row.object_type === "claim");
  for (const object of claimObjects) {
    const claim = ctx.db.prepare("SELECT * FROM claims WHERE claim_id=?").get(object.object_id) as
      | (Record<string, unknown> & {
          valid_from_sha: string;
          valid_until_sha: string | null;
          statement: string;
          epistemic_kind: string;
        })
      | undefined;
    if (!claim) continue;
    const intervalValid =
      isAncestor(ctx, claim.valid_from_sha, run.head_sha) &&
      (claim.valid_until_sha === null || !isAncestor(ctx, claim.valid_until_sha, run.head_sha));
    const evidence = claimEvidence(ctx, object.object_id, run.head_sha);
    add({
      section: "stale_claims",
      objectType: "claim",
      objectId: object.object_id,
      required: true,
      priority: 1,
      reason: "impact prediction reached a previously authoritative claim",
      compact: {
        claim_id: object.object_id,
        statement: compactText(claim.statement, 220),
        epistemic_kind: claim.epistemic_kind,
        interval_valid_at_reviewed_sha: intervalValid,
        authority_at_reviewed_sha: intervalValid && object.invalidates !== 1,
      },
      source: {
        type: "claim",
        claim,
        evidence,
        interval_valid_at_reviewed_sha: intervalValid,
        authority_at_reviewed_sha: intervalValid && object.invalidates !== 1,
      },
      provenance: {
        impact_reason_path: paths.get(`claim\u0000${object.object_id}`) ?? [],
        evidence_ids: evidence.map((row) => row.id),
      },
      profileIncluded: true,
    });
  }

  const findingIds = objects
    .filter((row) => row.object_type === "finding")
    .map((row) => row.object_id);
  for (const findingId of findingIds) {
    const finding = ctx.db.prepare("SELECT * FROM findings WHERE finding_id=?").get(findingId) as
      | (Record<string, unknown> & { symptom: string; root_cause: string })
      | undefined;
    if (!finding) continue;
    const evidence = findingEvidence(ctx, findingId, run.head_sha);
    const resolution = ctx.db
      .prepare("SELECT * FROM finding_resolution_current WHERE finding_id=?")
      .get(findingId);
    add({
      section: "historical_findings",
      objectType: "finding",
      objectId: findingId,
      required: true,
      priority: 1,
      reason: "the impact graph reached prior confirmed or ruled-out review history",
      compact: {
        finding_id: findingId,
        symptom: compactText(finding.symptom, 180),
        root_cause: compactText(finding.root_cause, 180),
        severity: finding.severity,
        status: finding.status,
        resolution_state:
          (resolution as Record<string, unknown> | undefined)?.resolution_state ?? null,
      },
      source: { type: "finding", finding, resolution: resolution ?? null, evidence },
      provenance: {
        impact_reason_path: paths.get(`finding\u0000${findingId}`) ?? [],
        evidence_ids: evidence.map((row) => row.id),
      },
      profileIncluded: true,
    });
  }

  const impactedSubsystems = [
    ...new Set(
      objects.filter((row) => row.object_type === "subsystem").map((row) => row.object_id),
    ),
  ].sort();
  if (impactedSubsystems.length > 0) {
    const rows = ctx.db
      .prepare(
        `SELECT * FROM dispositions
          WHERE subsystem_id IN (${placeholders(impactedSubsystems)})
            AND classification IN ('confirmed-acceptable','ruled-out')
          ORDER BY subsystem_id, concern_code`,
      )
      .all(...impactedSubsystems) as Array<
      Record<string, unknown> & {
        subsystem_id: string;
        concern_code: string;
        rationale: string | null;
      }
    >;
    for (const row of rows) {
      const evidence = dispositionEvidence(ctx, row.subsystem_id, row.concern_code, run.head_sha);
      add({
        section: "compensating_controls",
        objectType: "disposition",
        objectId: `${row.subsystem_id}:${row.concern_code}`,
        required: true,
        priority: 2,
        reason: "a reached subsystem has a prior acceptable or ruled-out control",
        compact: {
          subsystem_id: row.subsystem_id,
          concern_code: row.concern_code,
          classification: row.classification,
          rationale: compactText(row.rationale, 180),
        },
        source: { type: "disposition", disposition: row, evidence },
        provenance: {
          impact_reason_path: paths.get(`subsystem\u0000${row.subsystem_id}`) ?? [],
          evidence_ids: evidence.map((evidenceRow) => evidenceRow.id),
        },
        profileIncluded: true,
      });
    }
  }

  const seamIds = objects.filter((row) => row.object_type === "seam").map((row) => row.object_id);
  for (const seamId of seamIds) {
    const seam = ctx.db.prepare("SELECT * FROM seams WHERE id=?").get(seamId) as
      | Record<string, unknown>
      | undefined;
    if (!seam) continue;
    add({
      section: "impacted_seams",
      objectType: "seam",
      objectId: seamId,
      required: true,
      priority: 0,
      reason: "an explicit seam relation is on the impact path",
      compact: {
        seam_id: seamId,
        shared_object: seam.shared_object,
        parties: [seam.party_a, seam.party_b],
        ordering_assumption: seam.ordering_assumption,
        staleness_tolerance: seam.staleness_tolerance,
      },
      source: { type: "seam", seam },
      provenance: { impact_reason_path: paths.get(`seam\u0000${seamId}`) ?? [] },
      profileIncluded: true,
    });
  }

  if (findingIds.length > 0) {
    const contradictionRows = ctx.db
      .prepare(
        `SELECT * FROM contradictions
          WHERE finding_a IN (${placeholders(findingIds)})
             OR finding_b IN (${placeholders(findingIds)})
          ORDER BY id`,
      )
      .all(...findingIds, ...findingIds) as Array<Record<string, unknown> & { id: number }>;
    for (const contradiction of contradictionRows) {
      const events = ctx.db
        .prepare(
          `SELECT cre.*, e.file_path, e.ref_sha, e.kind
             FROM contradiction_resolution_events cre
             LEFT JOIN evidence e ON e.id=cre.evidence_id
            WHERE cre.contradiction_id=? ORDER BY cre.id`,
        )
        .all(contradiction.id);
      add({
        section: "contradictions",
        objectType: "contradiction",
        objectId: String(contradiction.id),
        required: true,
        priority: 1,
        reason: "a contradiction involves impacted finding history",
        compact: {
          contradiction_id: contradiction.id,
          finding_a: contradiction.finding_a,
          finding_b: contradiction.finding_b,
          conflict_type: contradiction.conflict_type,
          resolution: contradiction.resolution,
        },
        source: { type: "contradiction", contradiction, resolution_events: events },
        provenance: { finding_ids: [contradiction.finding_a, contradiction.finding_b] },
        profileIncluded: true,
      });
    }
  }

  const seenObligations = new Set<string>();
  for (const object of objects.filter((row) => row.object_type === "obligation")) {
    const questionId = object.object_id.startsWith("open-question:")
      ? Number.parseInt(object.object_id.slice("open-question:".length), 10)
      : Number.NaN;
    const question = Number.isFinite(questionId)
      ? ctx.db.prepare("SELECT * FROM open_questions WHERE id=?").get(questionId)
      : null;
    if (!question) continue;
    seenObligations.add(object.object_id);
    add({
      section: "obligations",
      objectType: "open-question",
      objectId: object.object_id,
      required: true,
      priority: 1,
      reason: "an open question lies on the impact path",
      compact: {
        obligation_id: object.object_id,
        question: compactText(String((question as Record<string, unknown>).question), 200),
        category: (question as Record<string, unknown>).category,
      },
      source: { type: "open-question", question },
      provenance: { impact_reason_path: paths.get(`obligation\u0000${object.object_id}`) ?? [] },
      profileIncluded: true,
    });
  }
  const durableObligations = ctx.db
    .prepare(
      `SELECT * FROM revalidation_obligations
        WHERE owner!='amanuensis:review-context'
          AND (source_impact_run_id=?
           OR (destination_type='seam' AND destination_id IN
               (SELECT object_id FROM change_impact_objects WHERE run_id=? AND object_type='seam')))
        ORDER BY obligation_id`,
    )
    .all(run.run_id, run.run_id) as Array<Record<string, unknown> & { obligation_id: string }>;
  for (const obligation of durableObligations) {
    if (seenObligations.has(obligation.obligation_id)) continue;
    seenObligations.add(obligation.obligation_id);
    add({
      section: "obligations",
      objectType: "revalidation-obligation",
      objectId: obligation.obligation_id,
      required: true,
      priority: 1,
      reason: "durable work custody is attached to the impact or an impacted seam",
      compact: {
        obligation_id: obligation.obligation_id,
        destination_type: obligation.destination_type,
        destination_id: obligation.destination_id,
        state: obligation.state,
        blocking: obligation.blocking,
      },
      source: { type: "revalidation-obligation", obligation },
      provenance: { source_impact_run_id: obligation.source_impact_run_id },
      profileIncluded: true,
    });
  }

  if (impactedSubsystems.length > 0) {
    const openQuestions = ctx.db
      .prepare(
        `SELECT * FROM open_questions
          WHERE resolution='open' AND subsystem_id IN (${placeholders(impactedSubsystems)})
          ORDER BY id`,
      )
      .all(...impactedSubsystems) as Array<Record<string, unknown> & { id: number }>;
    for (const question of openQuestions) {
      const objectId = `open-question:${question.id}`;
      if (seenObligations.has(objectId)) continue;
      add({
        section: "unknowns",
        objectType: "open-question",
        objectId,
        required: true,
        priority: 2,
        reason: "an impacted subsystem has an unresolved question",
        compact: {
          question_id: question.id,
          question: compactText(String(question.question), 200),
          category: question.category,
          what_assumed: compactText(String(question.what_assumed ?? ""), 160),
        },
        source: { type: "open-question", question },
        provenance: {
          impact_reason_path: paths.get(`subsystem\u0000${question.subsystem_id}`) ?? [],
        },
        profileIncluded: true,
      });
    }
    const staleEntries = ctx.db
      .prepare(
        `SELECT * FROM entries
          WHERE stale=1 AND subsystem_id IN (${placeholders(impactedSubsystems)})
          ORDER BY id, tier`,
      )
      .all(...impactedSubsystems) as Array<
      Record<string, unknown> & { id: string; tier: number; subsystem_id: string }
    >;
    for (const entry of staleEntries) {
      add({
        section: "unknowns",
        objectType: "stale-entry",
        objectId: `${entry.id}:${entry.tier}`,
        required: true,
        priority: 2,
        reason: "an impacted subsystem contains explicitly stale knowledge",
        compact: {
          entry_id: entry.id,
          tier: entry.tier,
          stale_reason: entry.stale_reason,
          stale_since: entry.stale_since,
        },
        source: { type: "stale-entry", entry },
        provenance: {
          impact_reason_path: paths.get(`subsystem\u0000${entry.subsystem_id}`) ?? [],
        },
        profileIncluded: true,
      });
    }
    const unexamined = ctx.db
      .prepare(
        `SELECT * FROM file_ledger
          WHERE subsystem_id IN (${placeholders(impactedSubsystems)})
            AND classification!='examined'
          ORDER BY subsystem_id, file_path`,
      )
      .all(...impactedSubsystems) as Array<
      Record<string, unknown> & { subsystem_id: string; file_path: string }
    >;
    for (const file of unexamined) {
      add({
        section: "unknowns",
        objectType: "unverified-file",
        objectId: `${file.subsystem_id}:${file.file_path}`,
        required: true,
        priority: 2,
        reason: "an impacted subsystem contains a file not classified as examined",
        compact: {
          subsystem_id: file.subsystem_id,
          file_path: file.file_path,
          classification: file.classification,
          why_in_scope: compactText(String(file.why_in_scope ?? ""), 160),
        },
        source: { type: "file-ledger", file },
        provenance: {
          impact_reason_path: paths.get(`subsystem\u0000${file.subsystem_id}`) ?? [],
        },
        profileIncluded: true,
      });
    }
  }

  for (const gap of objects.filter((row) => row.object_type === "gap")) {
    add({
      section: "uncovered_files",
      objectType: "impact-gap",
      objectId: gap.object_id,
      required: true,
      priority: 0,
      reason: "A2 found a changed path with no explicit coverage relation",
      compact: {
        gap_id: gap.object_id,
        impact_kind: gap.impact_kind,
        destination: "tracked review-context obligation",
      },
      source: { type: "impact-gap", gap: { ...gap, reason_path: parseJson(gap.reason_path, []) } },
      provenance: { impact_reason_path: paths.get(`gap\u0000${gap.object_id}`) ?? [] },
      profileIncluded: true,
    });
  }

  for (const control of objects.filter((row) => row.object_type === "control")) {
    const claim = ctx.db.prepare("SELECT * FROM claims WHERE claim_id=?").get(control.object_id) as
      | (Record<string, unknown> & { statement: string })
      | undefined;
    if (!claim) continue;
    const evidence = claimEvidence(ctx, control.object_id, run.head_sha);
    add({
      section: "unaffected_controls",
      objectType: "control-claim",
      objectId: control.object_id,
      required: false,
      priority: 3,
      reason: "the explicit impact graph classified this claim as an unaffected control",
      compact: {
        claim_id: control.object_id,
        statement: compactText(claim.statement, 180),
        authority_at_reviewed_sha: true,
      },
      source: { type: "claim-control", claim, evidence },
      provenance: { control_reason_path: paths.get(`control\u0000${control.object_id}`) ?? [] },
      profileIncluded: profile !== "diff-scoped",
    });
  }

  if (profile === "integral-head") {
    const impactedFindingSet = new Set(findingIds);
    const integralFindings = ctx.db
      .prepare(
        `SELECT * FROM findings
          WHERE status='confirmed-bug' AND severity IN ('CRITICAL','HIGH')
          ORDER BY severity, finding_id`,
      )
      .all() as Array<Record<string, unknown> & { finding_id: string; symptom: string }>;
    for (const finding of integralFindings) {
      if (impactedFindingSet.has(finding.finding_id)) continue;
      const evidence = findingEvidence(ctx, finding.finding_id, run.head_sha);
      add({
        section: "integral_findings",
        objectType: "integral-finding",
        objectId: finding.finding_id,
        required: false,
        priority: 4,
        reason: "integral-head context retains current high-severity system risk",
        compact: {
          finding_id: finding.finding_id,
          symptom: compactText(finding.symptom, 180),
          severity: finding.severity,
          status: finding.status,
        },
        source: { type: "finding", finding, evidence },
        provenance: { source_kind: "integral-head", evidence_ids: evidence.map((row) => row.id) },
        profileIncluded: true,
      });
    }
  }

  return candidates;
}

function ablatedSection(ablations: string[], section: Section): boolean {
  return (
    (section === "task_constraints" && ablations.includes("task-constraints")) ||
    (section === "impacted_seams" && ablations.includes("impacted-seams")) ||
    (section === "stale_claims" && ablations.includes("stale-claims"))
  );
}

function traceObligationId(briefId: string, section: string, objectId: string): string {
  return `review:${briefId}:${hash(`${section}\u0000${objectId}`).slice(0, 16)}`;
}

function compile(
  ctx: ServerContext,
  values: {
    briefId: string;
    run: ImpactRun;
    task: string;
    constraints: TaskConstraint[];
    profile: ContextProfile;
    tokenBudget: number;
    ablations: string[];
    sessionId: string;
  },
): Record<string, unknown> {
  const candidates = buildCandidates(
    ctx,
    values.run,
    values.task,
    values.constraints,
    values.profile,
  ).sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    const sectionOrder = SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
    return (
      sectionOrder || `${a.objectType}:${a.objectId}`.localeCompare(`${b.objectType}:${b.objectId}`)
    );
  });
  const traces: TraceDraft[] = [];
  let usedTokens = estimateTokens({
    schema_version: 1,
    brief_id: values.briefId,
    task: compactText(values.task, 240),
    reviewed_sha: values.run.head_sha,
  });
  for (const candidate of candidates) {
    const estimatedTokens = estimateTokens(candidate.compact);
    let action: TraceDraft["action"];
    let actionReason: string;
    if (!candidate.profileIncluded) {
      action = "omitted";
      actionReason = `declared drop: ${values.profile} excludes ${candidate.section}`;
    } else if (ablatedSection(values.ablations, candidate.section)) {
      action = "blocked";
      actionReason = `validation ablation removed required section ${candidate.section}`;
    } else if (sourceHasUnreachableEvidence(candidate.source)) {
      action = "blocked";
      actionReason = `structured evidence is not reachable at reviewed commit ${values.run.head_sha}`;
    } else if (usedTokens + estimatedTokens <= values.tokenBudget) {
      action = "included";
      actionReason = candidate.reason;
      usedTokens += estimatedTokens;
    } else if (candidate.required) {
      action = "blocked";
      actionReason = `token budget exhausted before required ${candidate.section} context`;
    } else {
      action = "truncated";
      actionReason = `token budget exhausted before optional ${candidate.section} context`;
    }
    const needsObligation =
      action === "blocked" ||
      action === "truncated" ||
      (candidate.section === "uncovered_files" && action === "included");
    const ordinal = traces.length;
    traces.push({
      ...candidate,
      traceId: `${values.briefId}:trace:${ordinal}`,
      ordinal,
      action,
      actionReason,
      estimatedTokens,
      obligationId: needsObligation
        ? traceObligationId(values.briefId, candidate.section, candidate.objectId)
        : null,
    });
  }

  const candidatesBySection = new Map<Section, TraceDraft[]>();
  for (const trace of traces) {
    const rows = candidatesBySection.get(trace.section) ?? [];
    rows.push(trace);
    candidatesBySection.set(trace.section, rows);
  }
  for (const section of SECTION_ORDER) {
    if ((candidatesBySection.get(section) ?? []).length > 0) continue;
    const ordinal = traces.length;
    const required = REQUIRED_SECTIONS.includes(section as (typeof REQUIRED_SECTIONS)[number]);
    const sentinel: TraceDraft = {
      section,
      objectType: "section",
      objectId: `${section}:empty`,
      required,
      priority: 4,
      reason: "candidate query returned no applicable context",
      compact: {},
      source: { type: "empty-section", section },
      provenance: { source_kind: "deterministic-empty-query", impact_run_id: values.run.run_id },
      profileIncluded: true,
      traceId: `${values.briefId}:trace:${ordinal}`,
      ordinal,
      action: "omitted",
      actionReason: "not applicable: candidate query returned zero rows",
      estimatedTokens: 0,
      obligationId: null,
    };
    traces.push(sentinel);
    candidatesBySection.set(section, [sentinel]);
  }

  const sections: Record<string, unknown[]> = Object.fromEntries(
    SECTION_ORDER.map((section) => [
      section,
      traces
        .filter((trace) => trace.section === section && trace.action === "included")
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((trace) => ({ ...trace.compact, trace_id: trace.traceId })),
    ]),
  );
  const sectionStatus = Object.fromEntries(
    SECTION_ORDER.map((section) => {
      const rows = traces.filter((trace) => trace.section === section);
      const substantive = rows.filter((trace) => trace.objectType !== "section");
      return [
        section,
        {
          expected: substantive.length,
          included: substantive.filter((trace) => trace.action === "included").length,
          omitted: substantive.filter((trace) => trace.action === "omitted").length,
          truncated: substantive.filter((trace) => trace.action === "truncated").length,
          blocked: substantive.filter((trace) => trace.action === "blocked").length,
          required: REQUIRED_SECTIONS.includes(section as (typeof REQUIRED_SECTIONS)[number]),
          empty_reason:
            substantive.length === 0 ? "not applicable: candidate query returned zero rows" : null,
        },
      ];
    }),
  ) as Record<
    Section,
    {
      expected: number;
      included: number;
      omitted: number;
      truncated: number;
      blocked: number;
      required: boolean;
      empty_reason: string | null;
    }
  >;
  const includedRequiredSections = REQUIRED_SECTIONS.filter((section) => {
    const rows = traces.filter(
      (trace) => trace.section === section && trace.objectType !== "section" && trace.required,
    );
    return rows.length === 0 || rows.every((trace) => trace.action === "included");
  }).length;

  const expectedConstraints = traces.filter(
    (trace) => trace.section === "task_constraints" && trace.objectType !== "section",
  );
  const expectedSeams = traces.filter(
    (trace) => trace.section === "impacted_seams" && trace.objectType !== "section",
  );
  const expectedStaleClaims = traces.filter(
    (trace) => trace.section === "stale_claims" && trace.objectType !== "section",
  );
  const expectedGaps = traces.filter(
    (trace) => trace.section === "uncovered_files" && trace.objectType !== "section",
  );
  const coverage = (rows: TraceDraft[], neutral = 1) =>
    rows.length === 0
      ? neutral
      : rows.filter((trace) => trace.action === "included").length / rows.length;
  const included = traces.filter((trace) => trace.action === "included");
  const provenanceCoverage =
    included.length === 0
      ? 0
      : included.filter((trace) => Object.keys(trace.provenance).length > 0).length /
        included.length;
  const controlComponents = {
    task_constraint_coverage: coverage(expectedConstraints, 0),
    impacted_seam_coverage: coverage(expectedSeams),
    stale_claim_coverage: coverage(expectedStaleClaims),
    provenance_coverage: provenanceCoverage,
    gap_visibility: coverage(expectedGaps),
  };
  const controlScore =
    Math.round(
      (Object.values(controlComponents).reduce((sum, component) => sum + component, 0) /
        Object.keys(controlComponents).length) *
        1_000_000,
    ) / 1_000_000;
  const blockingReasons: Array<{ trace_id: string; section: string; reason: string }> = traces
    .filter((trace) => trace.action === "blocked")
    .map((trace) => ({
      trace_id: trace.traceId,
      section: trace.section,
      reason: trace.actionReason,
    }));
  if (controlScore < 1) {
    blockingReasons.push({
      trace_id: "control-score",
      section: "control-score",
      reason: `review brief control score is ${controlScore}, not 1`,
    });
  }
  const status = blockingReasons.length > 0 ? "blocked" : "publishable";
  const omittedSections = SECTION_ORDER.map((section) => ({
    section,
    ...sectionStatus[section],
  })).filter((row) => Number(row.expected) === 0 || Number(row.omitted) > 0);
  const budgetTruncation = traces
    .filter(
      (trace) =>
        trace.action === "truncated" ||
        (trace.action === "blocked" && trace.actionReason.startsWith("token budget")),
    )
    .map((trace) => ({
      trace_id: trace.traceId,
      section: trace.section,
      object_type: trace.objectType,
      object_id: trace.objectId,
      reason: trace.actionReason,
      obligation_id: trace.obligationId,
    }));
  const brief = {
    schema_version: 1,
    brief_id: values.briefId,
    impact_run_id: values.run.run_id,
    context_profile: values.profile,
    repository_validity: {
      base_sha: values.run.base_sha,
      reviewed_sha: values.run.head_sha,
      impact_status: values.run.status,
    },
    task: { objective: values.task, constraints: sections.task_constraints },
    token_budget: values.tokenBudget,
    estimated_tokens: usedTokens,
    sections,
    section_status: sectionStatus,
    omitted_sections: omittedSections,
    budget_truncation: budgetTruncation,
    uncovered_files: sections.uncovered_files,
    control_score: controlScore,
    control_components: controlComponents,
    blocking_reasons: blockingReasons,
    publication_status: status,
  };
  const briefJson = JSON.stringify(brief);
  const briefHash = hash(briefJson);

  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO review_briefs
           (brief_id, impact_run_id, context_profile, task, task_constraints,
            reviewed_sha, token_budget, estimated_tokens, control_score,
            required_section_count, included_required_section_count,
            uncovered_file_count, omitted_section_count, truncated_item_count,
            status, brief_json, brief_hash, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        values.briefId,
        values.run.run_id,
        values.profile,
        values.task,
        JSON.stringify(values.constraints),
        values.run.head_sha,
        values.tokenBudget,
        usedTokens,
        controlScore,
        REQUIRED_SECTIONS.length,
        includedRequiredSections,
        expectedGaps.length,
        omittedSections.length,
        traces.filter((trace) => trace.action === "truncated").length,
        status,
        briefJson,
        briefHash,
        values.sessionId,
      );
    const insertObligation = ctx.db.prepare(
      `INSERT OR IGNORE INTO revalidation_obligations
         (obligation_id, trigger_type, trigger_id, destination_type, destination_id,
          source_impact_run_id, owner, state, blocking, priority)
       VALUES (?, 'manual', ?, 'artifact', ?, ?, 'amanuensis:review-context', ?, ?, ?)`,
    );
    for (const trace of traces) {
      if (!trace.obligationId) continue;
      const blocking = trace.action === "blocked" ? 1 : 0;
      insertObligation.run(
        trace.obligationId,
        trace.traceId,
        values.briefId,
        values.run.run_id,
        blocking ? "blocked" : "deferred",
        blocking,
        blocking ? 1 : 3,
      );
    }
    const insertTrace = ctx.db.prepare(
      `INSERT INTO review_brief_trace
         (trace_id, brief_id, ordinal, section, action, object_type, object_id,
          reason, provenance_json, source_json, estimated_tokens, obligation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const trace of traces) {
      insertTrace.run(
        trace.traceId,
        values.briefId,
        trace.ordinal,
        trace.section,
        trace.action,
        trace.objectType,
        trace.objectId,
        trace.actionReason,
        JSON.stringify(trace.provenance),
        JSON.stringify(trace.source),
        trace.estimatedTokens,
        trace.obligationId,
      );
    }
    ctx.db
      .prepare(
        `INSERT INTO query_log
           (question, fields_hit, tier_reached, session_id)
         VALUES (?, ?, 3, ?)`,
      )
      .run(
        `review brief ${values.briefId}: ${values.task}`,
        JSON.stringify(["what", "why", "how", "where", "see-also", "confidence"]),
        values.sessionId,
      );
  })();
  return readBrief(ctx, values.briefId);
}

function readBrief(ctx: ServerContext, briefId: string): Record<string, unknown> {
  const row = getBrief(ctx, briefId);
  const trace = (
    ctx.db
      .prepare("SELECT * FROM review_brief_trace WHERE brief_id=? ORDER BY ordinal")
      .all(briefId) as Array<
      Record<string, unknown> & { provenance_json: string; source_json: string }
    >
  ).map((item) => {
    const { provenance_json: provenanceJson, source_json: sourceJson, ...columns } = item;
    return { ...columns, provenance: JSON.parse(provenanceJson), source: JSON.parse(sourceJson) };
  });
  const publication = ctx.db
    .prepare("SELECT * FROM review_brief_publications WHERE brief_id=?")
    .get(briefId);
  const obligations = ctx.db
    .prepare(
      `SELECT DISTINCT o.* FROM review_brief_trace t
        JOIN revalidation_obligations o ON o.obligation_id=t.obligation_id
       WHERE t.brief_id=? ORDER BY o.blocking DESC, o.priority, o.obligation_id`,
    )
    .all(briefId);
  const { task_constraints: taskConstraints, brief_json: briefJson, ...columns } = row;
  return {
    ...columns,
    task_constraints: JSON.parse(taskConstraints),
    brief: JSON.parse(briefJson),
    trace,
    obligations,
    publication: publication ?? null,
  };
}

function publish(ctx: ServerContext, briefId: string): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "publish_review_brief");
  const brief = getBrief(ctx, briefId);
  if (brief.status === "published") return readBrief(ctx, briefId);
  if (brief.status !== "publishable") {
    throw new ToolError(`review brief ${briefId} is ${brief.status}, not publishable`);
  }
  if (hash(brief.brief_json) !== brief.brief_hash) {
    throw new ToolError("review brief payload hash mismatch");
  }
  resolveCommit(ctx, brief.reviewed_sha);
  const red = ctx.db
    .prepare(
      `SELECT COUNT(*) AS n FROM review_brief_trace
        WHERE brief_id=? AND action IN ('blocked','truncated') AND section IN
          (${REQUIRED_SECTIONS.map(() => "?").join(",")})`,
    )
    .get(briefId, ...REQUIRED_SECTIONS) as { n: number };
  if (red.n > 0 || brief.included_required_section_count !== brief.required_section_count) {
    throw new ToolError("review brief required-section reconciliation is red");
  }
  const expectedSeams = ctx.db
    .prepare(
      "SELECT COUNT(*) AS n FROM change_impact_objects WHERE run_id=? AND object_type='seam'",
    )
    .get(brief.impact_run_id) as { n: number };
  const includedSeams = ctx.db
    .prepare(
      `SELECT COUNT(*) AS n FROM review_brief_trace
        WHERE brief_id=? AND section='impacted_seams' AND action='included'
          AND json_array_length(json_extract(provenance_json, '$.impact_reason_path')) > 0`,
    )
    .get(briefId) as { n: number };
  if (includedSeams.n !== expectedSeams.n) {
    throw new ToolError(
      `review brief seam reconciliation is red: expected ${expectedSeams.n}, included with provenance ${includedSeams.n}`,
    );
  }
  const invalidEvidence = ctx.db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM review_brief_trace t, json_each(json_extract(t.source_json, '$.evidence')) evidence
        WHERE t.brief_id=? AND t.action='included'
          AND COALESCE(json_extract(evidence.value, '$.reachable_at_reviewed_sha'), 0) != 1`,
    )
    .get(briefId) as { n: number };
  if (invalidEvidence.n > 0) {
    throw new ToolError(
      `review brief repository-validity reconciliation is red: ${invalidEvidence.n} unreachable evidence rows`,
    );
  }
  if (brief.control_score !== 1) {
    throw new ToolError(`review brief control score is ${brief.control_score}, not 1`);
  }
  const includedTrace = ctx.db
    .prepare("SELECT COUNT(*) AS n FROM review_brief_trace WHERE brief_id=? AND action='included'")
    .get(briefId) as { n: number };
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO review_brief_publications
           (brief_id, brief_hash, reviewed_sha, control_score,
            included_trace_count, seam_count, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        briefId,
        brief.brief_hash,
        brief.reviewed_sha,
        brief.control_score,
        includedTrace.n,
        expectedSeams.n,
        sessionId,
      );
    ctx.db
      .prepare(
        `UPDATE review_briefs
            SET status='published', published_at=datetime('now')
          WHERE brief_id=?`,
      )
      .run(briefId);
  })();
  return readBrief(ctx, briefId);
}

export const reviewTools: ToolDefinition[] = [
  {
    name: "compile_review_brief",
    description:
      "Compile and persist a typed, token-bounded ReviewBrief from one durable change-impact run. Explicit impact relations select context first; every inclusion, declared drop, truncation, or block receives a reversible trace and every real gap receives an obligation destination. validation_ablate is a fault-injection control for A6 tests.",
    inputSchema: {
      type: "object",
      properties: {
        brief_id: { type: "string" },
        impact_run_id: { type: "string" },
        task: { type: "string" },
        task_constraints: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              constraint_id: { type: "string" },
              statement: { type: "string" },
              source_kind: { type: "string", enum: CONSTRAINT_SOURCE_KINDS },
              source_ref: { type: "string" },
            },
            required: ["constraint_id", "statement", "source_kind", "source_ref"],
            additionalProperties: false,
          },
        },
        context_profile: { type: "string", enum: CONTEXT_PROFILES },
        token_budget: { type: "integer", minimum: 64 },
        validation_ablate: {
          type: "array",
          items: { type: "string", enum: VALIDATION_ABLATIONS },
        },
      },
      required: ["impact_run_id", "task", "task_constraints", "context_profile", "token_budget"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "compile_review_brief");
      const briefId = optString(args, "brief_id") ?? `review-${randomUUID()}`;
      if (ctx.db.prepare("SELECT 1 FROM review_briefs WHERE brief_id=?").get(briefId)) {
        throw new ToolError(`review brief_id already exists: ${briefId}`);
      }
      const run = getImpactRun(ctx, requireString(args, "impact_run_id"));
      resolveCommit(ctx, run.base_sha);
      resolveCommit(ctx, run.head_sha);
      const tokenBudget = requireInt(args, "token_budget");
      if (tokenBudget < 64) throw new ToolError("token_budget must be at least 64");
      const ablations = optStringArray(args, "validation_ablate") ?? [];
      for (const ablation of ablations) {
        if (!VALIDATION_ABLATIONS.includes(ablation as (typeof VALIDATION_ABLATIONS)[number])) {
          throw new ToolError(`validation_ablate contains unknown control: ${ablation}`);
        }
      }
      return compile(ctx, {
        briefId,
        run,
        task: requireString(args, "task"),
        constraints: parseConstraints(args),
        profile: requireEnum(args, "context_profile", CONTEXT_PROFILES),
        tokenBudget,
        ablations,
        sessionId,
      });
    },
  },
  {
    name: "publish_review_brief",
    description:
      "Publish a compiled ReviewBrief only after independently reconciling its immutable hash, every required section, the A2 impacted-seam denominator with nonempty provenance, and a perfect structural control score.",
    inputSchema: {
      type: "object",
      properties: { brief_id: { type: "string" } },
      required: ["brief_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => publish(ctx, requireString(args, "brief_id")),
  },
  {
    name: "get_review_brief",
    description:
      "Read a ReviewBrief with its typed sections, section-status and budget declarations, full retrieval trace, gap obligations, control components, and publication receipt.",
    inputSchema: {
      type: "object",
      properties: { brief_id: { type: "string" } },
      required: ["brief_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => readBrief(ctx, requireString(args, "brief_id")),
  },
  {
    name: "expand_review_brief_item",
    description:
      "Expand one included compact ReviewBrief item through its trace ID to the full typed source, evidence, impact provenance, and repository-validity checks at the reviewed commit.",
    inputSchema: {
      type: "object",
      properties: { brief_id: { type: "string" }, trace_id: { type: "string" } },
      required: ["brief_id", "trace_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const brief = getBrief(ctx, requireString(args, "brief_id"));
      const traceId = requireString(args, "trace_id");
      const trace = ctx.db
        .prepare("SELECT * FROM review_brief_trace WHERE brief_id=? AND trace_id=?")
        .get(brief.brief_id, traceId) as
        | (Record<string, unknown> & {
            action: string;
            provenance_json: string;
            source_json: string;
          })
        | undefined;
      if (!trace) throw new ToolError(`unknown review brief trace: ${traceId}`);
      if (trace.action !== "included") {
        throw new ToolError(`review brief trace ${traceId} is ${trace.action}, not included`);
      }
      const source = JSON.parse(trace.source_json) as Record<string, unknown>;
      const evidence = Array.isArray(source.evidence)
        ? (source.evidence as Array<Record<string, unknown>>)
        : [];
      return {
        brief_id: brief.brief_id,
        trace_id: traceId,
        section: trace.section,
        object_type: trace.object_type,
        object_id: trace.object_id,
        reviewed_sha: brief.reviewed_sha,
        provenance: JSON.parse(trace.provenance_json),
        source,
        repository_validity: {
          reviewed_sha_resolves: resolveCommit(ctx, brief.reviewed_sha) === brief.reviewed_sha,
          evidence: evidence.map((row) => ({
            evidence_id: row.id,
            ref_sha: row.ref_sha,
            reachable_at_reviewed_sha:
              typeof row.ref_sha === "string" && isAncestor(ctx, row.ref_sha, brief.reviewed_sha),
          })),
        },
        expansion_hash: hash(trace.source_json),
      };
    },
  },
];
