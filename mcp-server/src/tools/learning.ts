import { createHash } from "node:crypto";
import {
  optString,
  requireEnum,
  requireInt,
  requireString,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const SOURCE_KINDS = ["agent-session", "review-session", "design-session"] as const;
const CHANNELS = ["corpus", "retrieval", "method", "research", "user-preference"] as const;
const EPISTEMIC_KINDS = ["observation", "inference", "external-claim", "direct-intent"] as const;
const ARTIFACT_KINDS = [
  "code-claim",
  "finding",
  "review-item",
  "design-option",
  "decision-revision",
  "research-request",
  "external-claim",
  "method-qualification",
  "review-evaluation",
  "query-log",
  "human-statement",
] as const;
const OUTCOME_STATES = ["planned", "produced", "accepted", "later-invalidated"] as const;
const EVALUATION_KINDS = [
  "provenance-audit",
  "treatment-versus-clean",
  "ablation",
  "human-confirmation",
] as const;

type Channel = (typeof CHANNELS)[number];
type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

interface LessonRow {
  lesson_id: string;
  predecessor_lesson_id: string | null;
  rollback_of_lesson_id: string | null;
  extraction_id: string;
  channel: Channel;
  epistemic_kind: string;
  proposition: string;
  scope_json: string;
  target_policy_key: string;
  configuration_json: string;
  evidence_artifact_ids_json: string;
  human_source_json: string | null;
  rollback_plan_json: string;
  payload_hash: string;
  status: "candidate" | "qualified" | "active" | "superseded";
}

interface PolicyRow {
  policy_version_id: string;
  policy_key: string;
  revision_number: number;
  lesson_id: string;
  predecessor_policy_version_id: string | null;
  channel: Channel;
  configuration_json: string;
  configuration_hash: string;
  affected_future_runs_json: string;
  status: "staged" | "active" | "superseded";
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function objects(value: unknown, field: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolError(`${field} must contain at least one object`);
  }
  return value.map((item, index) => object(item, `${field}[${index}]`));
}

function strings(value: unknown, field: string, minimum = 1): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw new ToolError(`${field} must contain non-empty strings`);
  }
  const result = [...new Set(value as string[])];
  if (result.length < minimum)
    throw new ToolError(`${field} must contain at least ${minimum} item(s)`);
  return result;
}

function lesson(ctx: ServerContext, lessonId: string): LessonRow {
  const row = ctx.db.prepare("SELECT * FROM learning_lessons WHERE lesson_id=?").get(lessonId) as
    | LessonRow
    | undefined;
  if (!row) throw new ToolError(`unknown learning lesson: ${lessonId}`);
  return row;
}

function policyVersion(ctx: ServerContext, versionId: string): PolicyRow {
  const row = ctx.db
    .prepare("SELECT * FROM learning_policy_versions WHERE policy_version_id=?")
    .get(versionId) as PolicyRow | undefined;
  if (!row) throw new ToolError(`unknown learning policy version: ${versionId}`);
  return row;
}

function terminalSource(
  ctx: ServerContext,
  sourceKind: (typeof SOURCE_KINDS)[number],
  sourceRef: string,
): string {
  if (sourceKind === "agent-session") {
    const row = ctx.db
      .prepare("SELECT ended_at, outcome FROM sessions WHERE session_id=?")
      .get(sourceRef) as { ended_at: string | null; outcome: string | null } | undefined;
    if (!row?.ended_at || !row.outcome)
      throw new ToolError("learning requires an ended agent session with an outcome");
    return row.outcome;
  }
  if (sourceKind === "review-session") {
    const row = ctx.db
      .prepare(
        `SELECT r.status FROM review_sessions r JOIN review_session_completions c
           ON c.review_session_id=r.review_session_id WHERE r.review_session_id=?`,
      )
      .get(sourceRef) as { status: string } | undefined;
    if (!row || row.status !== "furnished")
      throw new ToolError("learning requires a furnished review session");
    return row.status;
  }
  const row = ctx.db
    .prepare(
      `SELECT d.status FROM design_sessions d JOIN design_aggregations a
         ON a.design_session_id=d.design_session_id WHERE d.design_session_id=?`,
    )
    .get(sourceRef) as { status: string } | undefined;
  if (!row || !["aggregated", "underdetermined"].includes(row.status)) {
    throw new ToolError("learning requires a terminal design session");
  }
  return row.status;
}

function artifactExists(
  ctx: ServerContext,
  kind: ArtifactKind,
  ref: string,
  sourceKind: (typeof SOURCE_KINDS)[number],
  sourceRef: string,
): boolean {
  if (kind === "human-statement") return true;
  if (kind === "review-item") {
    return (
      sourceKind === "review-session" &&
      !!ctx.db
        .prepare("SELECT 1 FROM review_session_items WHERE review_session_id=? AND item_id=?")
        .get(sourceRef, ref)
    );
  }
  if (kind === "design-option") {
    const split = ref.indexOf(":");
    return (
      sourceKind === "design-session" &&
      split > 0 &&
      !!ctx.db
        .prepare(
          "SELECT 1 FROM design_options WHERE design_session_id=? AND lens=? AND option_key=?",
        )
        .get(sourceRef, ref.slice(0, split), ref.slice(split + 1))
    );
  }
  if (kind === "external-claim" && sourceKind === "agent-session") {
    return !!ctx.db
      .prepare(
        `SELECT 1 FROM research_external_claims c
          JOIN research_results r ON r.result_id=c.result_id
          JOIN research_requests q ON q.request_id=r.request_id
         WHERE c.external_claim_id=? AND q.created_by=?`,
      )
      .get(ref, sourceRef);
  }
  const lookups: Record<
    Exclude<ArtifactKind, "human-statement" | "review-item" | "design-option">,
    [string, string, string | null, boolean?]
  > = {
    "code-claim": ["claims", "claim_id", "session_id"],
    finding: ["findings", "finding_id", "session_id"],
    "decision-revision": ["decision_revisions", "revision_id", "created_by"],
    "research-request": ["research_requests", "request_id", "created_by"],
    "external-claim": ["research_external_claims", "external_claim_id", null],
    "method-qualification": ["method_qualification_plans", "qualification_id", "planned_by"],
    "review-evaluation": ["review_session_evaluations", "evaluation_id", "recorded_by"],
    "query-log": ["query_log", "id", "session_id", true],
  };
  const [table, column, sessionColumn, numeric] = lookups[kind];
  const value = numeric ? Number(ref) : ref;
  if (numeric && !Number.isInteger(value)) return false;
  if (sourceKind === "agent-session" && sessionColumn) {
    return !!ctx.db
      .prepare(`SELECT 1 FROM ${table} WHERE ${column}=? AND ${sessionColumn}=?`)
      .get(value, sourceRef);
  }
  return !!ctx.db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(value);
}

function acceptedArtifactIsConsistent(
  ctx: ServerContext,
  kind: ArtifactKind,
  ref: string,
  sourceKind: (typeof SOURCE_KINDS)[number],
  sourceRef: string,
): boolean {
  if (kind === "review-item") {
    if (sourceKind !== "review-session") return false;
    const row = ctx.db
      .prepare("SELECT decisions_json FROM review_session_completions WHERE review_session_id=?")
      .get(sourceRef) as { decisions_json: string } | undefined;
    return (
      !!row &&
      (JSON.parse(row.decisions_json) as Array<Record<string, unknown>>).some(
        (decision) => decision.item_id === ref && decision.disposition === "accepted",
      )
    );
  }
  if (kind === "design-option") {
    const optionKey = ref.slice(ref.indexOf(":") + 1);
    return (
      sourceKind === "design-session" &&
      !!ctx.db
        .prepare(
          `SELECT 1 FROM decision_revisions r JOIN decision_events e ON e.revision_id=r.revision_id
            WHERE r.design_session_id=? AND e.event_type='accepted'
              AND json_extract(r.accepted_option_json, '$.option_key')=?`,
        )
        .get(sourceRef, optionKey)
    );
  }
  if (kind === "decision-revision") {
    return !!ctx.db
      .prepare("SELECT 1 FROM decision_events WHERE revision_id=? AND event_type='accepted'")
      .get(ref);
  }
  return true;
}

function invalidatedArtifactIsConsistent(
  ctx: ServerContext,
  kind: ArtifactKind,
  ref: string,
): boolean {
  if (kind === "code-claim") {
    return !!ctx.db
      .prepare("SELECT 1 FROM claims WHERE claim_id=? AND valid_until_sha IS NOT NULL")
      .get(ref);
  }
  if (kind === "decision-revision") {
    return !!ctx.db
      .prepare(
        "SELECT 1 FROM decision_revisions WHERE revision_id=? AND status IN ('superseded','invalidated')",
      )
      .get(ref);
  }
  if (kind === "research-request") {
    return !!ctx.db
      .prepare("SELECT 1 FROM research_requests WHERE request_id=? AND status='expired'")
      .get(ref);
  }
  if (kind === "method-qualification") {
    return !!ctx.db
      .prepare(
        "SELECT 1 FROM method_qualification_plans WHERE qualification_id=? AND status='failed'",
      )
      .get(ref);
  }
  throw new ToolError(`${kind} does not expose a mechanically checkable later-invalidated state`);
}

function parseOutcomeArtifacts(
  ctx: ServerContext,
  value: unknown,
  sourceKind: (typeof SOURCE_KINDS)[number],
  sourceRef: string,
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  return objects(value, "artifacts").map((row, index) => {
    const artifactId = requireString(row, "artifact_id");
    if (seen.has(artifactId)) throw new ToolError(`duplicate artifacts[${index}].artifact_id`);
    seen.add(artifactId);
    const kind = requireEnum(row, "artifact_kind", ARTIFACT_KINDS);
    const ref = requireString(row, "source_ref");
    if (!artifactExists(ctx, kind, ref, sourceKind, sourceRef)) {
      throw new ToolError(`artifacts[${index}] source does not resolve in the completed session`);
    }
    const states = strings(row.states, `artifacts[${index}].states`);
    const expected = OUTCOME_STATES.slice(0, states.length);
    if (stableJson(states) !== stableJson(expected)) {
      throw new ToolError(
        "artifact outcome states must form planned → produced → accepted → later-invalidated",
      );
    }
    if (
      states.includes("accepted") &&
      !acceptedArtifactIsConsistent(ctx, kind, ref, sourceKind, sourceRef)
    ) {
      throw new ToolError(`artifacts[${index}] acceptance does not match durable source state`);
    }
    if (states.includes("later-invalidated") && !invalidatedArtifactIsConsistent(ctx, kind, ref)) {
      throw new ToolError(`artifacts[${index}] invalidation does not match durable source state`);
    }
    const provenance = object(row.provenance, `artifacts[${index}].provenance`);
    const source = requireEnum(provenance, "source_kind", [
      "human",
      "repository",
      "session",
      "research",
      "qualification",
    ] as const);
    const provenanceRef = requireString(provenance, "source_ref");
    requireString(provenance, "statement");
    const actorId = optString(provenance, "actor_id");
    if (kind === "human-statement" && (source !== "human" || !actorId)) {
      throw new ToolError("human-statement artifacts require a named human source");
    }
    return {
      artifact_id: artifactId,
      artifact_kind: kind,
      source_ref: ref,
      statement: requireString(row, "statement"),
      states,
      provenance: {
        ...provenance,
        source_kind: source,
        source_ref: provenanceRef,
        actor_id: actorId,
      },
    };
  });
}

function extractOutcome(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const extractedBy = requireActiveSession(ctx, "extract_learning_outcome");
  const extractionId = requireString(args, "extraction_id");
  const sourceKind = requireEnum(args, "source_kind", SOURCE_KINDS);
  const sourceRef = requireString(args, "source_ref");
  const terminalState = terminalSource(ctx, sourceKind, sourceRef);
  const artifacts = parseOutcomeArtifacts(ctx, args.artifacts, sourceKind, sourceRef);
  const counts = Object.fromEntries(
    OUTCOME_STATES.map((state) => [
      state === "later-invalidated" ? "later_invalidated" : state,
      artifacts.filter((artifact) => (artifact.states as string[]).includes(state)).length,
    ]),
  ) as Record<string, number>;
  const outcome = {
    schema_version: "1.0.0",
    source: { kind: sourceKind, ref: sourceRef, terminal_state: terminalState },
    counts,
    artifacts,
  };
  ctx.db
    .prepare(
      `INSERT INTO learning_outcome_extractions
         (extraction_id,source_kind,source_ref,source_terminal_state,planned_count,
          produced_count,accepted_count,invalidated_count,outcome_json,outcome_hash,extracted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      extractionId,
      sourceKind,
      sourceRef,
      terminalState,
      counts.planned,
      counts.produced,
      counts.accepted,
      counts.later_invalidated,
      stableJson(outcome),
      hash(outcome),
      extractedBy,
    );
  return { extraction_id: extractionId, outcome_hash: hash(outcome), outcome };
}

function extractionArtifacts(
  ctx: ServerContext,
  extractionId: string,
): Array<Record<string, unknown>> {
  const row = ctx.db
    .prepare("SELECT outcome_json FROM learning_outcome_extractions WHERE extraction_id=?")
    .get(extractionId) as { outcome_json: string } | undefined;
  if (!row) throw new ToolError(`unknown learning extraction: ${extractionId}`);
  return (JSON.parse(row.outcome_json) as { artifacts: Array<Record<string, unknown>> }).artifacts;
}

function rollbackPlan(value: unknown): Record<string, unknown> {
  const plan = object(value, "rollback_plan");
  const affected = object(plan.affected_future_runs, "rollback_plan.affected_future_runs");
  return {
    trigger: requireString(plan, "trigger"),
    action: requireString(plan, "action"),
    preserves: strings(plan.preserves, "rollback_plan.preserves"),
    affected_future_runs: {
      selection_rule: requireString(affected, "selection_rule"),
      known_run_ids: Array.isArray(affected.known_run_ids)
        ? strings(affected.known_run_ids, "rollback_plan.affected_future_runs.known_run_ids", 0)
        : [],
    },
  };
}

const channelEvidence: Record<Channel, readonly ArtifactKind[]> = {
  corpus: ["code-claim", "finding"],
  retrieval: ["review-evaluation", "query-log", "review-item"],
  method: ["method-qualification", "review-evaluation", "design-option"],
  research: ["research-request", "external-claim"],
  "user-preference": ["human-statement"],
};

const channelEpistemic: Record<Channel, string> = {
  corpus: "observation",
  retrieval: "inference",
  method: "inference",
  research: "external-claim",
  "user-preference": "direct-intent",
};

function proposeLesson(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const proposedBy = requireActiveSession(ctx, "propose_learning_lesson");
  const lessonId = requireString(args, "lesson_id");
  const extractionId = requireString(args, "extraction_id");
  const channel = requireEnum(args, "channel", CHANNELS);
  const epistemicKind = requireEnum(args, "epistemic_kind", EPISTEMIC_KINDS);
  if (epistemicKind !== channelEpistemic[channel]) {
    throw new ToolError(`${channel} learning requires epistemic_kind ${channelEpistemic[channel]}`);
  }
  const artifacts = extractionArtifacts(ctx, extractionId);
  const byId = new Map(artifacts.map((artifact) => [String(artifact.artifact_id), artifact]));
  const evidenceIds = strings(args.evidence_artifact_ids, "evidence_artifact_ids");
  const evidence = evidenceIds.map((id) => {
    const artifact = byId.get(id);
    if (!artifact) throw new ToolError(`learning evidence is absent from extraction: ${id}`);
    return artifact;
  });
  if (
    !evidence.some((artifact) =>
      channelEvidence[channel].includes(artifact.artifact_kind as ArtifactKind),
    )
  ) {
    throw new ToolError(`${channel} lesson lacks channel-appropriate evidence`);
  }
  const predecessorId = optString(args, "predecessor_lesson_id");
  const rollbackOfId = optString(args, "rollback_of_lesson_id");
  for (const [label, id] of [
    ["predecessor", predecessorId],
    ["rollback", rollbackOfId],
  ] as const) {
    if (!id) continue;
    const prior = lesson(ctx, id);
    if (
      prior.status !== "active" ||
      prior.channel !== channel ||
      prior.target_policy_key !== args.target_policy_key
    ) {
      throw new ToolError(
        `${label} lesson must be the active lesson for the same channel and policy`,
      );
    }
  }
  const scope = object(args.scope, "scope");
  const configuration = object(args.configuration, "configuration");
  const plan = rollbackPlan(args.rollback_plan);
  let humanSource: Record<string, unknown> | null = null;
  if (channel === "user-preference") {
    humanSource = object(args.human_source, "human_source");
    const actorId = requireString(humanSource, "actor_id");
    const sourceRef = requireString(humanSource, "source_ref");
    const statement = requireString(humanSource, "statement");
    const humanScope = object(humanSource.scope, "human_source.scope");
    if (stableJson(humanScope) !== stableJson(scope))
      throw new ToolError("human preference scope must match lesson scope");
    const matches = evidence.some((artifact) => {
      const provenance = artifact.provenance as Record<string, unknown>;
      return (
        artifact.artifact_kind === "human-statement" &&
        provenance.actor_id === actorId &&
        provenance.source_ref === sourceRef &&
        artifact.statement === statement
      );
    });
    if (!matches)
      throw new ToolError("human preference source does not match extracted direct evidence");
    humanSource = { actor_id: actorId, source_ref: sourceRef, statement, scope: humanScope };
  } else if (args.human_source != null) {
    throw new ToolError("human_source is reserved for user-preference lessons");
  }
  const payload = {
    lesson_id: lessonId,
    predecessor_lesson_id: predecessorId,
    rollback_of_lesson_id: rollbackOfId,
    extraction_id: extractionId,
    channel,
    epistemic_kind: epistemicKind,
    proposition: requireString(args, "proposition"),
    scope,
    target_policy_key: requireString(args, "target_policy_key"),
    configuration,
    evidence_artifact_ids: evidenceIds,
    human_source: humanSource,
    rollback_plan: plan,
  };
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO learning_lessons
           (lesson_id,predecessor_lesson_id,rollback_of_lesson_id,extraction_id,channel,
            epistemic_kind,proposition,scope_json,target_policy_key,configuration_json,
            evidence_artifact_ids_json,human_source_json,rollback_plan_json,payload_hash,proposed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        lessonId,
        predecessorId,
        rollbackOfId,
        extractionId,
        channel,
        epistemicKind,
        payload.proposition,
        stableJson(scope),
        payload.target_policy_key,
        stableJson(configuration),
        stableJson(evidenceIds),
        humanSource ? stableJson(humanSource) : null,
        stableJson(plan),
        hash(payload),
        proposedBy,
      );
    ctx.db
      .prepare(
        "INSERT INTO learning_events (lesson_id,event_type,actor_kind,actor_id,detail_json) VALUES (?, 'proposed', 'amanuensis', ?, ?)",
      )
      .run(
        lessonId,
        proposedBy,
        stableJson({ extraction_id: extractionId, evidence_artifact_ids: evidenceIds }),
      );
  })();
  return { lesson_id: lessonId, status: "candidate", payload_hash: hash(payload) };
}

function qualifyLesson(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const evaluatedBy = requireActiveSession(ctx, "qualify_learning_lesson");
  const row = lesson(ctx, requireString(args, "lesson_id"));
  if (row.status !== "candidate") throw new ToolError(`learning lesson is ${row.status}`);
  const evaluationKind = requireEnum(args, "evaluation_kind", EVALUATION_KINDS);
  const allowedEvaluationKinds: Record<Channel, readonly (typeof EVALUATION_KINDS)[number][]> = {
    corpus: ["provenance-audit"],
    retrieval: ["provenance-audit", "ablation"],
    method: ["treatment-versus-clean", "ablation"],
    research: ["provenance-audit"],
    "user-preference": ["human-confirmation"],
  };
  if (!allowedEvaluationKinds[row.channel].includes(evaluationKind)) {
    throw new ToolError(`${row.channel} learning cannot use ${evaluationKind} evaluation`);
  }
  const baseline = requireInt(args, "baseline_value_milli");
  const observed = requireInt(args, "observed_value_milli");
  const expectedDirection = requireEnum(args, "expected_direction", [
    "increase",
    "decrease",
  ] as const);
  const minimumEffect = requireInt(args, "minimum_effect_milli");
  if (minimumEffect <= 0) throw new ToolError("minimum_effect_milli must be positive");
  const effect = expectedDirection === "increase" ? observed - baseline : baseline - observed;
  const passed = effect >= minimumEffect;
  const knownEvidence = new Set(JSON.parse(row.evidence_artifact_ids_json) as string[]);
  const evaluationEvidence = strings(args.evidence_artifact_ids, "evidence_artifact_ids");
  if (evaluationEvidence.some((id) => !knownEvidence.has(id))) {
    throw new ToolError("learning evaluation evidence must come from the candidate extraction");
  }
  const qualificationId = optString(args, "method_qualification_id");
  if (row.channel === "method") {
    if (!qualificationId) throw new ToolError("method learning requires method_qualification_id");
    const qualification = ctx.db
      .prepare(
        "SELECT target_policy_key,status FROM method_qualification_plans WHERE qualification_id=?",
      )
      .get(qualificationId) as { target_policy_key: string; status: string } | undefined;
    if (!qualification || qualification.target_policy_key !== row.target_policy_key) {
      throw new ToolError("method qualification target does not match learning policy");
    }
  } else if (qualificationId) {
    throw new ToolError("method_qualification_id is reserved for method learning");
  }
  const confirmedByKind = optString(args, "confirmed_by_kind");
  const confirmedBy = optString(args, "confirmed_by");
  if (row.channel === "user-preference") {
    const humanSource = JSON.parse(row.human_source_json ?? "null") as Record<
      string,
      unknown
    > | null;
    if (
      evaluationKind !== "human-confirmation" ||
      confirmedByKind !== "human" ||
      confirmedBy !== humanSource?.actor_id
    ) {
      throw new ToolError("preference qualification must be confirmed by its named human source");
    }
  } else if (confirmedByKind || confirmedBy) {
    throw new ToolError("confirmation authority is reserved for user-preference learning");
  }
  const limitations = strings(args.limitations, "limitations");
  const report = {
    evaluation_kind: evaluationKind,
    metric: requireString(args, "metric"),
    baseline_value_milli: baseline,
    observed_value_milli: observed,
    expected_direction: expectedDirection,
    minimum_effect_milli: minimumEffect,
    effect_milli: effect,
    evidence_artifact_ids: evaluationEvidence,
    method_qualification_id: qualificationId,
    confirmed_by: confirmedBy ? { kind: confirmedByKind, id: confirmedBy } : null,
    limitations,
    passed,
  };
  const evaluationId = requireString(args, "evaluation_id");
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO learning_evaluations
           (evaluation_id,lesson_id,evaluation_kind,metric,baseline_value_milli,
            observed_value_milli,expected_direction,minimum_effect_milli,effect_milli,passed,
            evidence_artifact_ids_json,method_qualification_id,confirmed_by_kind,confirmed_by,
            limitations_json,report_json,evaluated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        evaluationId,
        row.lesson_id,
        evaluationKind,
        report.metric,
        baseline,
        observed,
        expectedDirection,
        minimumEffect,
        effect,
        passed ? 1 : 0,
        stableJson(evaluationEvidence),
        qualificationId,
        confirmedByKind,
        confirmedBy,
        stableJson(limitations),
        stableJson(report),
        evaluatedBy,
      );
    if (passed) {
      ctx.db
        .prepare(
          "INSERT INTO learning_events (lesson_id,event_type,actor_kind,actor_id,detail_json) VALUES (?, 'qualified', 'amanuensis', ?, ?)",
        )
        .run(
          row.lesson_id,
          evaluatedBy,
          stableJson({ evaluation_id: evaluationId, report_hash: hash(report) }),
        );
      ctx.db
        .prepare(
          "UPDATE learning_lessons SET status='qualified', qualified_at=datetime('now') WHERE lesson_id=?",
        )
        .run(row.lesson_id);
    }
  })();
  return {
    evaluation_id: evaluationId,
    lesson_id: row.lesson_id,
    status: passed ? "qualified" : "candidate",
    passed,
    report,
  };
}

function stagePolicy(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const stagedBy = requireActiveSession(ctx, "stage_learning_policy");
  const row = lesson(ctx, requireString(args, "lesson_id"));
  if (row.status !== "qualified")
    throw new ToolError("learning policy requires a qualified lesson");
  const configuration = object(args.configuration, "configuration");
  if (stableJson(configuration) !== row.configuration_json)
    throw new ToolError("policy configuration differs from the qualified lesson");
  const active = ctx.db
    .prepare("SELECT * FROM learning_policy_versions WHERE policy_key=? AND status='active'")
    .get(row.target_policy_key) as PolicyRow | undefined;
  if ((active?.lesson_id ?? null) !== row.predecessor_lesson_id) {
    throw new ToolError("learning successor does not identify the currently active lesson");
  }
  if (row.channel === "method") {
    const evaluation = ctx.db
      .prepare(
        "SELECT method_qualification_id FROM learning_evaluations WHERE lesson_id=? AND passed=1",
      )
      .get(row.lesson_id) as { method_qualification_id: string } | undefined;
    if (
      !evaluation ||
      !ctx.db
        .prepare("SELECT 1 FROM unattended_method_policy WHERE policy_key=? AND qualification_id=?")
        .get(row.target_policy_key, evaluation.method_qualification_id)
    ) {
      throw new ToolError(
        "method learning cannot stage before the qualified method is active in the unattended registry",
      );
    }
  }
  const rollback = JSON.parse(row.rollback_plan_json) as Record<string, unknown>;
  const affected = rollback.affected_future_runs as Record<string, unknown>;
  const revision = active ? active.revision_number + 1 : 1;
  const versionId = requireString(args, "policy_version_id");
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO learning_policy_versions
           (policy_version_id,policy_key,revision_number,lesson_id,predecessor_policy_version_id,
            channel,configuration_json,configuration_hash,affected_future_runs_json,staged_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        versionId,
        row.target_policy_key,
        revision,
        row.lesson_id,
        active?.policy_version_id ?? null,
        row.channel,
        row.configuration_json,
        hash(configuration),
        stableJson(affected),
        stagedBy,
      );
    ctx.db
      .prepare(
        "INSERT INTO learning_events (lesson_id,event_type,actor_kind,actor_id,detail_json) VALUES (?, 'staged', 'amanuensis', ?, ?)",
      )
      .run(
        row.lesson_id,
        stagedBy,
        stableJson({ policy_version_id: versionId, revision_number: revision }),
      );
  })();
  return {
    policy_version_id: versionId,
    policy_key: row.target_policy_key,
    revision_number: revision,
    status: "staged",
  };
}

function runtimePolicy(row: PolicyRow): Record<string, unknown> {
  return {
    policy_key: row.policy_key,
    policy_version_id: row.policy_version_id,
    revision_number: row.revision_number,
    lesson_id: row.lesson_id,
    channel: row.channel,
    configuration: JSON.parse(row.configuration_json),
    affected_future_runs: JSON.parse(row.affected_future_runs_json),
    status: row.status,
  };
}

function activePolicy(
  ctx: ServerContext,
  policyKey: string,
  requirePostactivationReadback = true,
): Record<string, unknown> | null {
  const row = ctx.db
    .prepare("SELECT * FROM learning_policy_versions WHERE policy_key=? AND status='active'")
    .get(policyKey) as PolicyRow | undefined;
  if (!row) return null;
  if (
    requirePostactivationReadback &&
    !ctx.db
      .prepare(
        `SELECT 1 FROM learning_policy_readbacks
          WHERE policy_version_id=? AND phase='postactivation' AND ok=1`,
      )
      .get(row.policy_version_id)
  ) {
    return null;
  }
  return runtimePolicy(row);
}

function readbackReport(
  expected: Record<string, unknown>,
  actual: unknown,
): Record<string, unknown> {
  const value =
    actual && typeof actual === "object" && !Array.isArray(actual)
      ? (actual as Record<string, unknown>)
      : {};
  const required = [
    "policy_key",
    "policy_version_id",
    "revision_number",
    "lesson_id",
    "channel",
    "configuration",
    "affected_future_runs",
    "status",
  ];
  const stateOk = value.status === expected.status;
  const coverageOk = required.every((field) => Object.hasOwn(value, field));
  const contentOk = stableJson(value) === stableJson(expected);
  return {
    axes: {
      state: { ok: stateOk, expected: expected.status, actual: value.status ?? null },
      coverage: { ok: coverageOk, required },
      content: { ok: contentOk, expected_hash: hash(expected), actual_hash: hash(value) },
    },
    ok: stateOk && coverageOk && contentOk,
  };
}

function insertReadback(
  ctx: ServerContext,
  versionId: string,
  phase: string,
  report: Record<string, unknown>,
  actor: string,
): void {
  const axes = object(report.axes, "readback.axes");
  const state = object(axes.state, "readback.axes.state");
  const coverage = object(axes.coverage, "readback.axes.coverage");
  const content = object(axes.content, "readback.axes.content");
  ctx.db
    .prepare(
      `INSERT INTO learning_policy_readbacks
         (policy_version_id,phase,state_ok,coverage_ok,content_ok,ok,report_json,audited_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      versionId,
      phase,
      state.ok === true ? 1 : 0,
      coverage.ok === true ? 1 : 0,
      content.ok === true ? 1 : 0,
      report.ok ? 1 : 0,
      stableJson(report),
      actor,
    );
}

function verifyPolicy(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const actor = requireActiveSession(ctx, "verify_learning_policy");
  const row = policyVersion(ctx, requireString(args, "policy_version_id"));
  if (row.status !== "staged") throw new ToolError(`learning policy version is ${row.status}`);
  const stagedExpected = runtimePolicy(row);
  const pre = readbackReport(stagedExpected, runtimePolicy(row));
  if (!pre.ok) throw new ToolError("staged learning policy failed preactivation read-back");
  let post: Record<string, unknown> | null = null;
  ctx.db.transaction(() => {
    insertReadback(ctx, row.policy_version_id, "preactivation", pre, actor);
    const predecessor = row.predecessor_policy_version_id
      ? policyVersion(ctx, row.predecessor_policy_version_id)
      : null;
    if (predecessor) {
      if (predecessor.status !== "active")
        throw new ToolError("learning predecessor policy is no longer active");
      ctx.db
        .prepare(
          "INSERT INTO learning_events (lesson_id,event_type,actor_kind,actor_id,detail_json) VALUES (?, 'superseded', 'amanuensis', ?, ?)",
        )
        .run(
          predecessor.lesson_id,
          actor,
          stableJson({
            successor_policy_version_id: row.policy_version_id,
            affected_future_runs: JSON.parse(row.affected_future_runs_json),
          }),
        );
      ctx.db
        .prepare(
          "UPDATE learning_lessons SET status='superseded', superseded_at=datetime('now') WHERE lesson_id=?",
        )
        .run(predecessor.lesson_id);
      ctx.db
        .prepare(
          "UPDATE learning_policy_versions SET status='superseded', superseded_by=?, superseded_at=datetime('now') WHERE policy_version_id=?",
        )
        .run(row.policy_version_id, predecessor.policy_version_id);
    }
    ctx.db
      .prepare(
        "INSERT INTO learning_events (lesson_id,event_type,actor_kind,actor_id,detail_json) VALUES (?, 'activated', 'amanuensis', ?, ?)",
      )
      .run(
        row.lesson_id,
        actor,
        stableJson({ policy_version_id: row.policy_version_id, readback: "required" }),
      );
    ctx.db
      .prepare(
        "UPDATE learning_lessons SET status='active', activated_at=datetime('now') WHERE lesson_id=?",
      )
      .run(row.lesson_id);
    ctx.db
      .prepare(
        "UPDATE learning_policy_versions SET status='active', activated_at=datetime('now') WHERE policy_version_id=?",
      )
      .run(row.policy_version_id);
    const expected = { ...stagedExpected, status: "active" };
    post = readbackReport(expected, activePolicy(ctx, row.policy_key, false));
    if (!post.ok) throw new ToolError("activated learning policy failed next-run read-back");
    insertReadback(ctx, row.policy_version_id, "postactivation", post, actor);
  })();
  if (!post) throw new ToolError("activated learning policy did not produce a read-back");
  return {
    policy_version_id: row.policy_version_id,
    policy_key: row.policy_key,
    status: "active",
    readback: post,
  };
}

function auditPolicy(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const actor = requireActiveSession(ctx, "audit_learning_policy");
  const policyKey = requireString(args, "policy_key");
  const row = ctx.db
    .prepare("SELECT * FROM learning_policy_versions WHERE policy_key=? AND status='active'")
    .get(policyKey) as PolicyRow | undefined;
  if (!row) throw new ToolError(`no active learning policy: ${policyKey}`);
  const expected = runtimePolicy(row);
  const actual = args.observed_policy ?? activePolicy(ctx, policyKey);
  const report = readbackReport(expected, actual);
  insertReadback(ctx, row.policy_version_id, "audit", report, actor);
  return report;
}

function getLedger(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const lessonId = optString(args, "lesson_id");
  if (!lessonId) {
    return {
      extractions: ctx.db
        .prepare("SELECT * FROM learning_outcome_extractions ORDER BY extracted_at, extraction_id")
        .all(),
      lessons: ctx.db
        .prepare(
          "SELECT lesson_id,predecessor_lesson_id,rollback_of_lesson_id,extraction_id,channel,epistemic_kind,proposition,target_policy_key,status FROM learning_lessons ORDER BY proposed_at,lesson_id",
        )
        .all(),
      active_policies: ctx.db
        .prepare(
          "SELECT policy_key,policy_version_id,revision_number,lesson_id,channel,configuration_json,affected_future_runs_json FROM learning_policy_versions WHERE status='active' ORDER BY policy_key",
        )
        .all(),
    };
  }
  const row = lesson(ctx, lessonId);
  return {
    ...row,
    scope: JSON.parse(row.scope_json),
    configuration: JSON.parse(row.configuration_json),
    evidence_artifact_ids: JSON.parse(row.evidence_artifact_ids_json),
    human_source: row.human_source_json ? JSON.parse(row.human_source_json) : null,
    rollback_plan: JSON.parse(row.rollback_plan_json),
    evaluation:
      ctx.db.prepare("SELECT * FROM learning_evaluations WHERE lesson_id=?").get(lessonId) ?? null,
    events: ctx.db
      .prepare("SELECT * FROM learning_events WHERE lesson_id=? ORDER BY event_id")
      .all(lessonId),
    policy_versions: ctx.db
      .prepare("SELECT * FROM learning_policy_versions WHERE lesson_id=? ORDER BY revision_number")
      .all(lessonId),
  };
}

const stringArraySchema = {
  type: "array",
  minItems: 1,
  items: { type: "string", minLength: 1 },
};
const provenanceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source_kind", "source_ref", "statement"],
  properties: {
    source_kind: {
      type: "string",
      enum: ["human", "repository", "session", "research", "qualification"],
    },
    source_ref: { type: "string", minLength: 1 },
    statement: { type: "string", minLength: 1 },
    actor_id: { type: "string", minLength: 1 },
  },
};
const rollbackPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["trigger", "action", "preserves", "affected_future_runs"],
  properties: {
    trigger: { type: "string", minLength: 1 },
    action: { type: "string", minLength: 1 },
    preserves: stringArraySchema,
    affected_future_runs: {
      type: "object",
      additionalProperties: false,
      required: ["selection_rule", "known_run_ids"],
      properties: {
        selection_rule: { type: "string", minLength: 1 },
        known_run_ids: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
      },
    },
  },
};

export const learningTools: ToolDefinition[] = [
  {
    name: "extract_learning_outcome",
    description:
      "Freeze a completed agent, review, or design session outcome as an exact planned → produced → accepted → later-invalidated artifact ledger. Every artifact has typed provenance, state prefixes reconcile mechanically, and supported invalidations must match current durable state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["extraction_id", "source_kind", "source_ref", "artifacts"],
      properties: {
        extraction_id: { type: "string", minLength: 1 },
        source_kind: { type: "string", enum: [...SOURCE_KINDS] },
        source_ref: { type: "string", minLength: 1 },
        artifacts: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "artifact_id",
              "artifact_kind",
              "source_ref",
              "statement",
              "states",
              "provenance",
            ],
            properties: {
              artifact_id: { type: "string", minLength: 1 },
              artifact_kind: { type: "string", enum: [...ARTIFACT_KINDS] },
              source_ref: { type: "string", minLength: 1 },
              statement: { type: "string", minLength: 1 },
              states: {
                type: "array",
                minItems: 1,
                maxItems: 4,
                items: { type: "string", enum: [...OUTCOME_STATES] },
              },
              provenance: provenanceSchema,
            },
          },
        },
      },
    },
    handler: extractOutcome,
  },
  {
    name: "propose_learning_lesson",
    description:
      "Create an immutable candidate in exactly one corpus, retrieval, method, research, or user-preference channel from a completed outcome extraction. Channel-specific epistemic kinds and evidence are enforced; preferences require a matching named human statement and exact scope. Every candidate carries an executable rollback trigger, action, preservation set, and affected-future-run selector.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "lesson_id",
        "extraction_id",
        "channel",
        "epistemic_kind",
        "proposition",
        "scope",
        "target_policy_key",
        "configuration",
        "evidence_artifact_ids",
        "rollback_plan",
      ],
      properties: {
        lesson_id: { type: "string", minLength: 1 },
        predecessor_lesson_id: { type: "string", minLength: 1 },
        rollback_of_lesson_id: { type: "string", minLength: 1 },
        extraction_id: { type: "string", minLength: 1 },
        channel: { type: "string", enum: [...CHANNELS] },
        epistemic_kind: { type: "string", enum: [...EPISTEMIC_KINDS] },
        proposition: { type: "string", minLength: 1 },
        scope: { type: "object" },
        target_policy_key: { type: "string", minLength: 1 },
        configuration: { type: "object" },
        evidence_artifact_ids: stringArraySchema,
        human_source: {
          type: "object",
          additionalProperties: false,
          required: ["actor_id", "source_ref", "statement", "scope"],
          properties: {
            actor_id: { type: "string", minLength: 1 },
            source_ref: { type: "string", minLength: 1 },
            statement: { type: "string", minLength: 1 },
            scope: { type: "object" },
          },
        },
        rollback_plan: rollbackPlanSchema,
      },
    },
    handler: proposeLesson,
  },
  {
    name: "qualify_learning_lesson",
    description:
      "Mechanically score a candidate against frozen evidence and a minimum effect. Method lessons additionally require treatment-versus-clean or ablation evidence plus an A14 qualification that passed read-back; preference lessons require scored confirmation by their named human source. A failed score remains candidate and cannot activate.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "evaluation_id",
        "lesson_id",
        "evaluation_kind",
        "metric",
        "baseline_value_milli",
        "observed_value_milli",
        "expected_direction",
        "minimum_effect_milli",
        "evidence_artifact_ids",
        "limitations",
      ],
      properties: {
        evaluation_id: { type: "string", minLength: 1 },
        lesson_id: { type: "string", minLength: 1 },
        evaluation_kind: { type: "string", enum: [...EVALUATION_KINDS] },
        metric: { type: "string", minLength: 1 },
        baseline_value_milli: { type: "integer" },
        observed_value_milli: { type: "integer" },
        expected_direction: { type: "string", enum: ["increase", "decrease"] },
        minimum_effect_milli: { type: "integer", minimum: 1 },
        evidence_artifact_ids: stringArraySchema,
        method_qualification_id: { type: "string", minLength: 1 },
        confirmed_by_kind: { type: "string", enum: ["human", "owning-system"] },
        confirmed_by: { type: "string", minLength: 1 },
        limitations: stringArraySchema,
      },
    },
    handler: qualifyLesson,
  },
  {
    name: "stage_learning_policy",
    description:
      "Stage one qualified lesson as the next immutable policy version. Configuration must exactly match the qualified candidate; a successor must name the currently active lesson, and method learning additionally requires the matching A14 unattended method activation.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["policy_version_id", "lesson_id", "configuration"],
      properties: {
        policy_version_id: { type: "string", minLength: 1 },
        lesson_id: { type: "string", minLength: 1 },
        configuration: { type: "object" },
      },
    },
    handler: stagePolicy,
  },
  {
    name: "verify_learning_policy",
    description:
      "Read a staged policy through the runtime representation, activate it transactionally, supersede prior lesson and policy history, then read the active next-run policy again on independent state, coverage, and content axes. Any mismatch rolls the entire activation back.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["policy_version_id"],
      properties: { policy_version_id: { type: "string", minLength: 1 } },
    },
    handler: verifyPolicy,
  },
  {
    name: "audit_learning_policy",
    description:
      "Re-read one active learning policy through the same registry consumed by future runs and append a state/coverage/content audit. observed_policy is a validation-only fault-injection surface; it never mutates policy.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["policy_key"],
      properties: {
        policy_key: { type: "string", minLength: 1 },
        observed_policy: { type: "object" },
      },
    },
    handler: auditPolicy,
  },
  {
    name: "get_learning_policy",
    description:
      "Return the active, read-back-verified policy representation consumed by future runs for one key, or null when no qualified lesson is active.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["policy_key"],
      properties: { policy_key: { type: "string", minLength: 1 } },
    },
    handler: (args, ctx) => activePolicy(ctx, requireString(args, "policy_key")),
  },
  {
    name: "get_learning_ledger",
    description:
      "Read the typed distillation ledger. Without lesson_id it returns extraction, lesson, and active-policy summaries; with lesson_id it returns immutable provenance, evaluation, event history, rollback plan, and every policy version.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { lesson_id: { type: "string", minLength: 1 } },
    },
    handler: getLedger,
  },
];
