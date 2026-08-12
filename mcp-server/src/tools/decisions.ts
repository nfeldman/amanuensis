import { createHash } from "node:crypto";
import {
  optString,
  requireEnum,
  requireString,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const AUTHORITY_KINDS = ["human", "owning-system"] as const;
const AUTHOR_KINDS = ["model", "human", "owning-system"] as const;
const PREMISE_KINDS = ["claim", "evidence", "code"] as const;

interface RevisionRow {
  revision_id: string;
  decision_id: string;
  revision_number: number;
  predecessor_revision_id: string | null;
  design_session_id: string | null;
  status: string;
  desire_sources_json: string;
  accepted_option_json: string;
  alternatives_json: string;
  constraints_json: string;
  consequences_json: string;
  falsifiers_json: string;
  premises_json: string;
  code_changes_json: string;
  rationale: string;
  authored_by_kind: string;
  authored_by: string;
  payload_hash: string;
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

function objectArray(
  value: unknown,
  field: string,
  requiredKeys: string[],
  minimum = 1,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new ToolError(`${field} must contain at least ${minimum} object(s)`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ToolError(`${field}[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    for (const key of requiredKeys) {
      if (typeof row[key] !== "string" || row[key].length === 0) {
        throw new ToolError(`${field}[${index}].${key} is required`);
      }
    }
    return row;
  });
}

function parsePremises(value: unknown): Array<Record<string, unknown>> {
  const rows = objectArray(value, "premises", ["premise_id", "kind", "ref", "statement"]);
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (!PREMISE_KINDS.includes(row.kind as (typeof PREMISE_KINDS)[number])) {
      throw new ToolError(`premises[${index}].kind is invalid`);
    }
    const id = String(row.premise_id);
    if (seen.has(id)) throw new ToolError(`duplicate premise_id: ${id}`);
    seen.add(id);
  }
  return rows;
}

function getRevision(ctx: ServerContext, revisionId: string): RevisionRow {
  const row = ctx.db
    .prepare("SELECT * FROM decision_revisions WHERE revision_id=?")
    .get(revisionId) as RevisionRow | undefined;
  if (!row) throw new ToolError(`unknown decision revision: ${revisionId}`);
  return row;
}

function revisionPayload(row: RevisionRow): Record<string, unknown> {
  return {
    revision_id: row.revision_id,
    decision_id: row.decision_id,
    revision_number: row.revision_number,
    predecessor_revision_id: row.predecessor_revision_id,
    design_session_id: row.design_session_id,
    status: row.status,
    desire_sources: JSON.parse(row.desire_sources_json),
    accepted_option: JSON.parse(row.accepted_option_json),
    alternatives: JSON.parse(row.alternatives_json),
    constraints: JSON.parse(row.constraints_json),
    consequences: JSON.parse(row.consequences_json),
    falsifiers: JSON.parse(row.falsifiers_json),
    premises: JSON.parse(row.premises_json),
    code_changes: JSON.parse(row.code_changes_json),
    rationale: row.rationale,
    authored_by_kind: row.authored_by_kind,
    authored_by: row.authored_by,
    payload_hash: row.payload_hash,
  };
}

function draft(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "draft_decision_revision");
  const decisionId = requireString(args, "decision_id");
  const revisionId = requireString(args, "revision_id");
  if (ctx.db.prepare("SELECT 1 FROM decision_revisions WHERE revision_id=?").get(revisionId)) {
    throw new ToolError(`decision revision already exists: ${revisionId}`);
  }
  const existing = ctx.db.prepare("SELECT * FROM decisions WHERE decision_id=?").get(decisionId) as
    | { decision_id: string }
    | undefined;
  const predecessorId = optString(args, "predecessor_revision_id");
  let revisionNumber = 1;
  if (existing) {
    if (!predecessorId)
      throw new ToolError("an existing decision requires predecessor_revision_id");
    const predecessor = getRevision(ctx, predecessorId);
    if (predecessor.decision_id !== decisionId)
      throw new ToolError("predecessor belongs to another decision");
    if (predecessor.status === "draft") throw new ToolError("cannot revise an unresolved draft");
    revisionNumber = predecessor.revision_number + 1;
  } else if (predecessorId) {
    throw new ToolError("a new decision cannot have a predecessor");
  }
  const designSessionId = optString(args, "design_session_id");
  let designResult: Record<string, unknown> | null = null;
  if (designSessionId) {
    const aggregation = ctx.db
      .prepare("SELECT result_json FROM design_aggregations WHERE design_session_id=?")
      .get(designSessionId) as { result_json: string } | undefined;
    if (!aggregation) throw new ToolError("decision draft requires a terminal design aggregation");
    designResult = JSON.parse(aggregation.result_json) as Record<string, unknown>;
    if (designResult.status !== "qualified") {
      throw new ToolError("an underdetermined design session cannot furnish a decision draft");
    }
  }
  const desireSources = objectArray(args.desire_sources, "desire_sources", [
    "desire_id",
    "statement",
    "source_kind",
    "source_ref",
  ]);
  if (desireSources.some((row) => row.source_kind !== "direct-user")) {
    throw new ToolError("decision desire_sources must be direct-user");
  }
  const acceptedOption = args.accepted_option;
  if (!acceptedOption || typeof acceptedOption !== "object" || Array.isArray(acceptedOption)) {
    throw new ToolError("accepted_option must be an object");
  }
  const accepted = acceptedOption as Record<string, unknown>;
  requireString(accepted, "option_key");
  requireString(accepted, "summary");
  if (
    designResult &&
    (designResult.lean as Record<string, unknown>).option_key !== accepted.option_key
  ) {
    throw new ToolError("accepted_option must match the design session's furnished lean");
  }
  const alternatives = objectArray(args.alternatives, "alternatives", [
    "option_key",
    "summary",
    "disposition",
    "evidence_ref",
  ]);
  const constraints = objectArray(args.constraints, "constraints", [
    "constraint_id",
    "statement",
    "source_ref",
  ]);
  const consequences = objectArray(args.consequences, "consequences", [
    "consequence_id",
    "statement",
    "direction",
  ]);
  const falsifiers = objectArray(args.falsifiers, "falsifiers", [
    "falsifier_id",
    "condition",
    "destination",
  ]);
  const premises = parsePremises(args.premises);
  const codeChanges = objectArray(args.code_changes, "code_changes", ["path", "relationship"], 0);
  const authorKind = requireEnum(args, "authored_by_kind", AUTHOR_KINDS);
  const payload = {
    revision_id: revisionId,
    decision_id: decisionId,
    revision_number: revisionNumber,
    predecessor_revision_id: predecessorId,
    design_session_id: designSessionId,
    desire_sources: desireSources,
    accepted_option: accepted,
    alternatives,
    constraints,
    consequences,
    falsifiers,
    premises,
    code_changes: codeChanges,
    rationale: requireString(args, "rationale"),
    authored_by_kind: authorKind,
    authored_by: requireString(args, "authored_by"),
  };
  const payloadHash = hash(payload);
  ctx.db.transaction(() => {
    if (!existing) {
      ctx.db
        .prepare("INSERT INTO decisions (decision_id, title, created_by) VALUES (?, ?, ?)")
        .run(decisionId, requireString(args, "title"), sessionId);
    }
    ctx.db
      .prepare(
        `INSERT INTO decision_revisions
           (revision_id, decision_id, revision_number, predecessor_revision_id,
            design_session_id, desire_sources_json, accepted_option_json,
            alternatives_json, constraints_json, consequences_json, falsifiers_json,
            premises_json, code_changes_json, rationale, authored_by_kind,
            authored_by, payload_hash, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId,
        decisionId,
        revisionNumber,
        predecessorId,
        designSessionId,
        stableJson(desireSources),
        stableJson(accepted),
        stableJson(alternatives),
        stableJson(constraints),
        stableJson(consequences),
        stableJson(falsifiers),
        stableJson(premises),
        stableJson(codeChanges),
        payload.rationale,
        authorKind,
        payload.authored_by,
        payloadHash,
        sessionId,
      );
    ctx.db
      .prepare(
        `INSERT INTO decision_events
           (revision_id, event_type, actor_kind, actor_id, reason, detail_json)
         VALUES (?, 'drafted', ?, ?, ?, ?)`,
      )
      .run(
        revisionId,
        authorKind,
        payload.authored_by,
        "decision revision drafted",
        stableJson({ payload_hash: payloadHash }),
      );
  })();
  return revisionPayload(getRevision(ctx, revisionId));
}

function authority(args: Record<string, unknown>) {
  const actorKind = requireEnum(args, "actor_kind", AUTHORITY_KINDS);
  const actorId = requireString(args, "actor_id");
  const authorityScope = requireString(args, "authority_scope");
  const authoritySource = requireString(args, "authority_source");
  return { actorKind, actorId, authorityScope, authoritySource };
}

function accept(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "accept_decision_revision");
  const revision = getRevision(ctx, requireString(args, "revision_id"));
  if (revision.status !== "draft") throw new ToolError(`decision revision is ${revision.status}`);
  const auth = authority(args);
  if (
    auth.authorityScope !== revision.decision_id &&
    auth.authorityScope !== `${revision.decision_id}:${revision.revision_id}`
  ) {
    throw new ToolError("acceptance authority_scope does not cover this decision revision");
  }
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO decision_events
           (revision_id, event_type, actor_kind, actor_id, authority_scope, reason, detail_json)
         VALUES (?, 'accepted', ?, ?, ?, ?, ?)`,
      )
      .run(
        revision.revision_id,
        auth.actorKind,
        auth.actorId,
        auth.authorityScope,
        requireString(args, "reason"),
        stableJson({ authority_source: auth.authoritySource }),
      );
    ctx.db
      .prepare(
        "UPDATE decision_revisions SET status='accepted', terminal_at=datetime('now') WHERE revision_id=?",
      )
      .run(revision.revision_id);
    ctx.db
      .prepare("UPDATE decisions SET current_revision_id=? WHERE decision_id=?")
      .run(revision.revision_id, revision.decision_id);
    if (revision.predecessor_revision_id) {
      const predecessor = getRevision(ctx, revision.predecessor_revision_id);
      if (predecessor.status === "accepted") {
        ctx.db
          .prepare("UPDATE decision_revisions SET status='superseded' WHERE revision_id=?")
          .run(predecessor.revision_id);
        ctx.db
          .prepare(
            `INSERT INTO decision_events
               (revision_id, event_type, actor_kind, actor_id, authority_scope, reason, detail_json)
             VALUES (?, 'superseded', ?, ?, ?, 'accepted successor revision', ?)`,
          )
          .run(
            predecessor.revision_id,
            auth.actorKind,
            auth.actorId,
            auth.authorityScope,
            stableJson({ successor_revision_id: revision.revision_id }),
          );
      }
    }
  })();
  return revisionPayload(getRevision(ctx, revision.revision_id));
}

function reject(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "reject_decision_revision");
  const revision = getRevision(ctx, requireString(args, "revision_id"));
  if (revision.status !== "draft") throw new ToolError(`decision revision is ${revision.status}`);
  const auth = authority(args);
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        "UPDATE decision_revisions SET status='rejected', terminal_at=datetime('now') WHERE revision_id=?",
      )
      .run(revision.revision_id);
    ctx.db
      .prepare(
        `INSERT INTO decision_events
           (revision_id, event_type, actor_kind, actor_id, authority_scope, reason, detail_json)
         VALUES (?, 'rejected', ?, ?, ?, ?, ?)`,
      )
      .run(
        revision.revision_id,
        auth.actorKind,
        auth.actorId,
        auth.authorityScope,
        requireString(args, "reason"),
        stableJson({ authority_source: auth.authoritySource }),
      );
  })();
  return revisionPayload(getRevision(ctx, revision.revision_id));
}

function invalidate(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "invalidate_decision_revision");
  const revision = getRevision(ctx, requireString(args, "revision_id"));
  if (revision.status !== "accepted")
    throw new ToolError("only an accepted decision can be invalidated");
  const evidenceId = args.evidence_id;
  const impactRunId = optString(args, "impact_run_id");
  if (!(Number.isInteger(evidenceId) || impactRunId)) {
    throw new ToolError("invalidation requires evidence_id or impact_run_id");
  }
  ctx.db.transaction(() => {
    ctx.db
      .prepare("UPDATE decision_revisions SET status='invalidated' WHERE revision_id=?")
      .run(revision.revision_id);
    ctx.db
      .prepare(
        "UPDATE decisions SET current_revision_id=NULL WHERE decision_id=? AND current_revision_id=?",
      )
      .run(revision.decision_id, revision.revision_id);
    ctx.db
      .prepare(
        `INSERT INTO decision_events
           (revision_id, event_type, actor_kind, actor_id, reason, evidence_id,
            impact_run_id, detail_json)
         VALUES (?, 'invalidated', 'amanuensis', 'amanuensis:decision-custody', ?, ?, ?, '{}')`,
      )
      .run(
        revision.revision_id,
        requireString(args, "reason"),
        Number.isInteger(evidenceId) ? evidenceId : null,
        impactRunId,
      );
    ctx.db
      .prepare(
        `INSERT OR IGNORE INTO revalidation_obligations
           (obligation_id, trigger_type, trigger_id, destination_type, destination_id,
            source_impact_run_id, owner, state, blocking, priority)
         VALUES (?, 'decision-impact', ?, 'decision', ?, ?,
                 'amanuensis:decision-review', 'ready', 1, 0)`,
      )
      .run(
        `decision-impact:${impactRunId ?? `evidence-${evidenceId}`}:${revision.revision_id}`,
        `${impactRunId ?? `evidence-${evidenceId}`}:${revision.revision_id}`,
        revision.decision_id,
        impactRunId,
      );
  })();
  return revisionPayload(getRevision(ctx, revision.revision_id));
}

function impact(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "detect_decision_impacts");
  const impactRunId = requireString(args, "impact_run_id");
  const run = ctx.db
    .prepare("SELECT status FROM change_impact_runs WHERE run_id=?")
    .get(impactRunId) as { status: string } | undefined;
  if (!run || run.status !== "applied")
    throw new ToolError("decision impact detection requires an applied impact run");
  const impactedClaims = new Set(
    (
      ctx.db
        .prepare(
          "SELECT claim_id FROM change_impact_invalidations WHERE run_id=? AND state='applied'",
        )
        .all(impactRunId) as Array<{ claim_id: string }>
    ).map((row) => row.claim_id),
  );
  const changedPaths = new Set(
    (
      ctx.db
        .prepare("SELECT path_before, path_after FROM change_impact_files WHERE run_id=?")
        .all(impactRunId) as Array<{ path_before: string | null; path_after: string | null }>
    ).flatMap((row) => [row.path_before, row.path_after].filter((path): path is string => !!path)),
  );
  const accepted = ctx.db
    .prepare("SELECT * FROM decision_revisions WHERE status='accepted' ORDER BY revision_id")
    .all() as RevisionRow[];
  const results: Array<Record<string, unknown>> = [];
  ctx.db.transaction(() => {
    for (const revision of accepted) {
      const premises = JSON.parse(revision.premises_json) as Array<Record<string, unknown>>;
      const codeChanges = JSON.parse(revision.code_changes_json) as Array<Record<string, unknown>>;
      const matches = premises.filter(
        (premise) =>
          (premise.kind === "claim" && impactedClaims.has(String(premise.ref))) ||
          (premise.kind === "code" && changedPaths.has(String(premise.ref))) ||
          (premise.kind === "evidence" &&
            !!ctx.db
              .prepare(
                "SELECT 1 FROM evidence WHERE id=? AND file_path IN (SELECT path_before FROM change_impact_files WHERE run_id=? UNION SELECT path_after FROM change_impact_files WHERE run_id=?)",
              )
              .get(Number(premise.ref), impactRunId, impactRunId)),
      );
      const codeMatches = codeChanges.filter((change) => changedPaths.has(String(change.path)));
      if (matches.length === 0 && codeMatches.length === 0) continue;
      const obligationId = `decision-impact:${impactRunId}:${revision.revision_id}`;
      ctx.db
        .prepare(
          `INSERT OR IGNORE INTO revalidation_obligations
             (obligation_id, trigger_type, trigger_id, destination_type, destination_id,
              source_impact_run_id, owner, state, blocking, priority)
           VALUES (?, 'decision-impact', ?, 'decision', ?, ?,
                   'amanuensis:decision-review', 'ready', 1, 0)`,
        )
        .run(
          obligationId,
          `${impactRunId}:${revision.revision_id}`,
          revision.decision_id,
          impactRunId,
        );
      const prior = ctx.db
        .prepare(
          "SELECT 1 FROM decision_events WHERE revision_id=? AND event_type='impact-detected' AND impact_run_id=?",
        )
        .get(revision.revision_id, impactRunId);
      if (!prior) {
        ctx.db
          .prepare(
            `INSERT INTO decision_events
               (revision_id, event_type, actor_kind, actor_id, reason, impact_run_id, detail_json)
             VALUES (?, 'impact-detected', 'amanuensis', 'amanuensis:decision-impact',
                     'accepted decision premise or code link changed', ?, ?)`,
          )
          .run(
            revision.revision_id,
            impactRunId,
            stableJson({
              matched_premises: matches,
              matched_code_changes: codeMatches,
              obligation_id: obligationId,
            }),
          );
      }
      results.push({
        revision_id: revision.revision_id,
        decision_id: revision.decision_id,
        matched_premises: matches,
        matched_code_changes: codeMatches,
        obligation_id: obligationId,
      });
    }
  })();
  return {
    impact_run_id: impactRunId,
    accepted_decision_count: accepted.length,
    impacted_decision_count: results.length,
    impacts: results,
  };
}

function getDecision(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const decisionId = requireString(args, "decision_id");
  const decision = ctx.db.prepare("SELECT * FROM decisions WHERE decision_id=?").get(decisionId) as
    | Record<string, unknown>
    | undefined;
  if (!decision) throw new ToolError(`unknown decision: ${decisionId}`);
  const revisions = ctx.db
    .prepare("SELECT * FROM decision_revisions WHERE decision_id=? ORDER BY revision_number")
    .all(decisionId) as RevisionRow[];
  return {
    ...decision,
    revisions: revisions.map((row) => ({
      ...revisionPayload(row),
      events: ctx.db
        .prepare("SELECT * FROM decision_events WHERE revision_id=? ORDER BY event_id")
        .all(row.revision_id),
    })),
    open_obligations: ctx.db
      .prepare(
        "SELECT * FROM revalidation_obligations WHERE destination_type='decision' AND destination_id=? AND state NOT IN ('closed','dead-letter') ORDER BY created_at",
      )
      .all(decisionId),
  };
}

function projectionPayload(ctx: ServerContext, revisionId: string): Record<string, unknown> {
  const revision = getRevision(ctx, revisionId);
  const decision = ctx.db
    .prepare("SELECT title, current_revision_id FROM decisions WHERE decision_id=?")
    .get(revision.decision_id) as { title: string; current_revision_id: string | null };
  const events = ctx.db
    .prepare(
      "SELECT event_type, actor_kind, actor_id, authority_scope, reason, evidence_id, impact_run_id, detail_json, created_at FROM decision_events WHERE revision_id=? ORDER BY event_id",
    )
    .all(revisionId) as Array<Record<string, unknown> & { detail_json: string }>;
  return {
    schema_version: "1.0.0",
    decision: {
      decision_id: revision.decision_id,
      title: decision.title,
      current_revision_id: decision.current_revision_id,
    },
    revision: revisionPayload(revision),
    events: events.map((event) => ({ ...event, detail: JSON.parse(event.detail_json) })),
    authority: {
      source: "amanuensis",
      transfer: "projection-only",
      acceptance_remains_with_source: true,
    },
  };
}

function project(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "project_decision_revision");
  const projectionId = requireString(args, "projection_id");
  const revisionId = requireString(args, "revision_id");
  const payload = projectionPayload(ctx, revisionId);
  ctx.db
    .prepare(
      `INSERT INTO decision_projections
         (projection_id, revision_id, schema_version, projection_json, projection_hash, projected_by)
       VALUES (?, ?, '1.0.0', ?, ?, ?)`,
    )
    .run(projectionId, revisionId, stableJson(payload), hash(payload), sessionId);
  return { projection_id: projectionId, projection_hash: hash(payload), projection: payload };
}

function verifyProjection(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "verify_decision_projection");
  const projectionId = requireString(args, "projection_id");
  const row = ctx.db
    .prepare("SELECT * FROM decision_projections WHERE projection_id=?")
    .get(projectionId) as { revision_id: string; projection_json: string } | undefined;
  if (!row) throw new ToolError(`unknown decision projection: ${projectionId}`);
  const expected = projectionPayload(ctx, row.revision_id);
  const candidate = args.projection ?? JSON.parse(row.projection_json);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new ToolError("projection must be an object");
  }
  const actual = candidate as Record<string, unknown>;
  const expectedRevision = expected.revision as Record<string, unknown>;
  const actualRevision = actual.revision as Record<string, unknown> | undefined;
  const stateOk =
    actual.schema_version === "1.0.0" &&
    (actual.decision as Record<string, unknown> | undefined)?.decision_id ===
      (expected.decision as Record<string, unknown>).decision_id &&
    actualRevision?.status === expectedRevision.status;
  const requiredFields = [
    "desire_sources",
    "accepted_option",
    "alternatives",
    "constraints",
    "consequences",
    "falsifiers",
    "premises",
    "code_changes",
  ];
  const coverageOk =
    !!actualRevision &&
    requiredFields
      .filter((field) => field !== "accepted_option")
      .every((field) => Array.isArray(actualRevision[field])) &&
    !!actualRevision.accepted_option &&
    typeof actualRevision.accepted_option === "object" &&
    !Array.isArray(actualRevision.accepted_option) &&
    Array.isArray(actual.events);
  const contentOk = stableJson(actual) === stableJson(expected);
  const report = {
    axes: {
      state: { ok: stateOk },
      coverage: { ok: coverageOk, required_fields: requiredFields },
      content: { ok: contentOk, expected_hash: hash(expected), actual_hash: hash(actual) },
    },
    ok: stateOk && coverageOk && contentOk,
  };
  ctx.db
    .prepare(
      `INSERT INTO decision_projection_verifications
         (projection_id, state_ok, coverage_ok, content_ok, ok, report_json, verified_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      projectionId,
      stateOk ? 1 : 0,
      coverageOk ? 1 : 0,
      contentOk ? 1 : 0,
      report.ok ? 1 : 0,
      stableJson(report),
      sessionId,
    );
  return report;
}

const authorityProperties = {
  actor_kind: { type: "string", enum: [...AUTHORITY_KINDS] },
  actor_id: { type: "string", minLength: 1 },
  authority_scope: { type: "string", minLength: 1 },
  authority_source: { type: "string", minLength: 1 },
  reason: { type: "string", minLength: 1 },
};

export const decisionTools: ToolDefinition[] = [
  {
    name: "draft_decision_revision",
    description:
      "Create an immutable draft decision revision from qualified design advice or direct human/system authorship. Desire sources, selected option, rejected alternatives, constraints, consequences, falsifiers, premises, and code links are mandatory custody; a rejected or accepted decision can only be reconsidered as a new revision.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "decision_id",
        "revision_id",
        "title",
        "desire_sources",
        "accepted_option",
        "alternatives",
        "constraints",
        "consequences",
        "falsifiers",
        "premises",
        "code_changes",
        "rationale",
        "authored_by_kind",
        "authored_by",
      ],
      properties: {
        decision_id: { type: "string", minLength: 1 },
        revision_id: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1 },
        predecessor_revision_id: { type: "string", minLength: 1 },
        design_session_id: { type: "string", minLength: 1 },
        desire_sources: { type: "array", minItems: 1, items: { type: "object" } },
        accepted_option: { type: "object" },
        alternatives: { type: "array", minItems: 1, items: { type: "object" } },
        constraints: { type: "array", minItems: 1, items: { type: "object" } },
        consequences: { type: "array", minItems: 1, items: { type: "object" } },
        falsifiers: { type: "array", minItems: 1, items: { type: "object" } },
        premises: { type: "array", minItems: 1, items: { type: "object" } },
        code_changes: { type: "array", items: { type: "object" } },
        rationale: { type: "string", minLength: 1 },
        authored_by_kind: { type: "string", enum: [...AUTHOR_KINDS] },
        authored_by: { type: "string", minLength: 1 },
      },
    },
    handler: draft,
  },
  {
    name: "accept_decision_revision",
    description:
      "Accept one draft revision only through an explicit human or owning-system authority event whose scope covers this decision. Acceptance names the actor, authority source, and reason; an accepted predecessor becomes superseded without losing history.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "revision_id",
        "actor_kind",
        "actor_id",
        "authority_scope",
        "authority_source",
        "reason",
      ],
      properties: { revision_id: { type: "string", minLength: 1 }, ...authorityProperties },
    },
    handler: accept,
  },
  {
    name: "reject_decision_revision",
    description:
      "Reject one draft through explicit human or owning-system authority. The proposal, alternatives, evidence, and reason remain immutable and queryable; reconsideration requires a successor revision.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "revision_id",
        "actor_kind",
        "actor_id",
        "authority_scope",
        "authority_source",
        "reason",
      ],
      properties: { revision_id: { type: "string", minLength: 1 }, ...authorityProperties },
    },
    handler: reject,
  },
  {
    name: "invalidate_decision_revision",
    description:
      "Invalidate accepted decision authority without editing its premises. New evidence or an applied impact run is required, history remains readable, and a blocking decision-review obligation is created.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["revision_id", "reason"],
      properties: {
        revision_id: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 },
        evidence_id: { type: "integer" },
        impact_run_id: { type: "string", minLength: 1 },
      },
    },
    handler: invalidate,
  },
  {
    name: "detect_decision_impacts",
    description:
      "Compare an applied A2 impact artifact with every accepted decision's typed claim, evidence, and code premises. Matches append an impact event and create a blocking decision-review obligation; accepted history is never silently rewritten.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["impact_run_id"],
      properties: { impact_run_id: { type: "string", minLength: 1 } },
    },
    handler: impact,
  },
  {
    name: "get_decision",
    description:
      "Read a decision's complete immutable revision and authority-event history, rejected and superseded alternatives, current authority pointer, and open review obligations.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["decision_id"],
      properties: { decision_id: { type: "string", minLength: 1 } },
    },
    handler: getDecision,
  },
  {
    name: "project_decision_revision",
    description:
      "Create a portable CodebaseDecision 1.0.0 projection for Chorusmith session custody. It carries desire sources, authority events, alternatives, consequences, falsifiers, premises, and source-owned acceptance without transferring decision authority.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["projection_id", "revision_id"],
      properties: {
        projection_id: { type: "string", minLength: 1 },
        revision_id: { type: "string", minLength: 1 },
      },
    },
    handler: project,
  },
  {
    name: "verify_decision_projection",
    description:
      "Read a stored or caller-supplied portable decision projection back against durable source state. State, exact required-field coverage, and semantic content must all agree; dropping desire source, acceptance authority, alternatives, or falsifiers turns red.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["projection_id"],
      properties: {
        projection_id: { type: "string", minLength: 1 },
        projection: { type: "object" },
      },
    },
    handler: verifyProjection,
  },
];
