import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
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

const ENTITY_KINDS = [
  "code-claim",
  "external-claim",
  "concern",
  "decision-revision",
  "method",
] as const;
const SOURCE_KINDS = [
  "code-claim",
  "external-claim",
  "concern",
  "decision-revision",
  "repository-evidence",
  "direct-user",
] as const;
const RELATION_TYPES = [
  "supports",
  "contradicts",
  "refines",
  "analogous-to",
  "applies-to",
  "derived-from",
  "supersedes",
] as const;
const PROVENANCE_KINDS = [
  "repository-evidence",
  "code-claim",
  "external-claim",
  "decision-revision",
  "direct-user",
] as const;
const CONTROL_TYPES = ["baseline", "positive", "negative", "scramble", "inconclusive"] as const;
const CONTROL_OUTCOMES = ["accept", "reject", "inconclusive"] as const;

interface EntityRow {
  entity_id: string;
  entity_kind: (typeof ENTITY_KINDS)[number];
  source_kind: (typeof SOURCE_KINDS)[number];
  source_ref: string;
  label: string;
  normalized_label: string;
  definition: string;
  negative_criteria_json: string;
  provenance_json: string;
  identity_state: "pending" | "distinct" | "same-as";
  canonical_entity_id: string | null;
}

interface RelationRow {
  relation_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  status: string;
}

interface QualificationRow {
  qualification_id: string;
  method_entity_id: string;
  collatio_contract_json: string;
  prediction_json: string;
  controls_json: string;
  red_gates_json: string;
  custody_json: string;
  target_policy_key: string;
  plan_hash: string;
  status: string;
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

function objects(value: unknown, field: string, minimum = 1): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new ToolError(`${field} must contain at least ${minimum} object(s)`);
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

function normalizedLabel(label: string): string {
  return label
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function entity(ctx: ServerContext, entityId: string): EntityRow {
  const row = ctx.db.prepare("SELECT * FROM crosswalk_entities WHERE entity_id=?").get(entityId) as
    | EntityRow
    | undefined;
  if (!row) throw new ToolError(`unknown crosswalk entity: ${entityId}`);
  return row;
}

function relation(ctx: ServerContext, relationId: string): RelationRow {
  const row = ctx.db
    .prepare("SELECT * FROM crosswalk_relations WHERE relation_id=?")
    .get(relationId) as RelationRow | undefined;
  if (!row) throw new ToolError(`unknown crosswalk relation: ${relationId}`);
  return row;
}

function qualification(ctx: ServerContext, qualificationId: string): QualificationRow {
  const row = ctx.db
    .prepare("SELECT * FROM method_qualification_plans WHERE qualification_id=?")
    .get(qualificationId) as QualificationRow | undefined;
  if (!row) throw new ToolError(`unknown method qualification: ${qualificationId}`);
  return row;
}

function sourceExists(
  ctx: ServerContext,
  entityKind: (typeof ENTITY_KINDS)[number],
  sourceKind: (typeof SOURCE_KINDS)[number],
  sourceRef: string,
): boolean {
  if (entityKind !== "method" && entityKind !== sourceKind) return false;
  if (
    entityKind === "method" &&
    !["external-claim", "repository-evidence", "direct-user"].includes(sourceKind)
  ) {
    return false;
  }
  if (sourceKind === "direct-user") return true;
  const lookups: Record<string, [string, string]> = {
    "code-claim": ["claims", "claim_id"],
    "external-claim": ["research_external_claims", "external_claim_id"],
    concern: ["concerns", "code"],
    "decision-revision": ["decision_revisions", "revision_id"],
    "repository-evidence": ["evidence", "id"],
  };
  const lookup = lookups[sourceKind];
  if (!lookup) return false;
  const [table, column] = lookup;
  const value: string | number =
    sourceKind === "repository-evidence" ? Number(sourceRef) : sourceRef;
  return (
    (sourceKind !== "repository-evidence" || Number.isInteger(value)) &&
    !!ctx.db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(value)
  );
}

function provenance(
  ctx: ServerContext,
  value: unknown,
  field = "provenance",
): Array<Record<string, unknown>> {
  const rows = objects(value, field);
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const kind = requireEnum(row, "kind", PROVENANCE_KINDS);
    const ref = requireString(row, "ref");
    const statement = requireString(row, "statement");
    const key = `${kind}:${ref}`;
    if (seen.has(key)) throw new ToolError(`${field}[${index}] duplicates ${key}`);
    seen.add(key);
    if (!sourceExists(ctx, kind === "direct-user" ? "method" : (kind as never), kind, ref)) {
      throw new ToolError(`${field}[${index}] does not resolve: ${key}`);
    }
    return { kind, ref, statement };
  });
}

function stageEntity(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "stage_crosswalk_entity");
  const entityId = requireString(args, "entity_id");
  const entityKind = requireEnum(args, "entity_kind", ENTITY_KINDS);
  const sourceKind = requireEnum(args, "source_kind", SOURCE_KINDS);
  const sourceRef = requireString(args, "source_ref");
  if (!sourceExists(ctx, entityKind, sourceKind, sourceRef)) {
    throw new ToolError(
      "crosswalk entity source does not resolve or is incompatible with entity kind",
    );
  }
  const label = requireString(args, "label");
  const normalized = normalizedLabel(label);
  const definition = requireString(args, "definition");
  const negativeCriteria = strings(args.negative_criteria, "negative_criteria");
  const sourceProvenance = provenance(ctx, args.provenance);
  const candidates = ctx.db
    .prepare(
      `SELECT entity_id, entity_kind, label, definition, identity_state, canonical_entity_id
         FROM crosswalk_entities
        WHERE normalized_label=? AND identity_state!='pending'
        ORDER BY entity_id`,
    )
    .all(normalized) as Array<Record<string, unknown>>;
  const state = candidates.length === 0 ? "distinct" : "pending";
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO crosswalk_entities
           (entity_id, entity_kind, source_kind, source_ref, label, normalized_label,
            definition, negative_criteria_json, provenance_json, identity_state,
            canonical_entity_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`,
      )
      .run(
        entityId,
        entityKind,
        sourceKind,
        sourceRef,
        label,
        normalized,
        definition,
        stableJson(negativeCriteria),
        stableJson(sourceProvenance),
        sessionId,
      );
    if (state === "distinct") {
      ctx.db
        .prepare(
          `INSERT INTO crosswalk_identity_resolutions
             (entity_id, candidate_entity_id, resolution, evidence_json, rationale, resolved_by)
           VALUES (?, NULL, 'unique', ?, 'no normalized-label candidate existed at registration', ?)`,
        )
        .run(entityId, stableJson(sourceProvenance), sessionId);
      ctx.db
        .prepare(
          "UPDATE crosswalk_entities SET identity_state='distinct', canonical_entity_id=entity_id WHERE entity_id=?",
        )
        .run(entityId);
    }
  })();
  return {
    entity_id: entityId,
    identity_state: state,
    canonical_entity_id: state === "distinct" ? entityId : null,
    identity_candidates: candidates,
  };
}

function resolveIdentity(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "resolve_crosswalk_identity");
  const row = entity(ctx, requireString(args, "entity_id"));
  if (row.identity_state !== "pending")
    throw new ToolError("crosswalk entity identity is already resolved");
  const candidate = entity(ctx, requireString(args, "candidate_entity_id"));
  if (candidate.identity_state === "pending")
    throw new ToolError("identity candidate is unresolved");
  if (candidate.normalized_label !== row.normalized_label) {
    throw new ToolError("identity candidate must come from the normalized-label collision set");
  }
  const resolution = requireEnum(args, "resolution", ["same-as", "distinct"] as const);
  const evidence = provenance(ctx, args.evidence, "evidence");
  const rationale = requireString(args, "rationale");
  if (resolution === "distinct" && JSON.parse(row.negative_criteria_json).length === 0) {
    throw new ToolError("distinct identity requires negative criteria");
  }
  const canonical = resolution === "same-as" ? candidate.canonical_entity_id : row.entity_id;
  if (!canonical) throw new ToolError("identity candidate lacks canonical identity");
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO crosswalk_identity_resolutions
           (entity_id, candidate_entity_id, resolution, evidence_json, rationale, resolved_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.entity_id,
        candidate.entity_id,
        resolution,
        stableJson(evidence),
        rationale,
        sessionId,
      );
    ctx.db
      .prepare(
        "UPDATE crosswalk_entities SET identity_state=?, canonical_entity_id=? WHERE entity_id=?",
      )
      .run(resolution, canonical, row.entity_id);
    if (resolution === "same-as") {
      ctx.db
        .prepare(
          `INSERT INTO crosswalk_relations
             (relation_id, source_entity_id, target_entity_id, relation_type, statement,
              positive_criteria_json, negative_criteria_json, provenance_json,
              valid_from, created_by)
           VALUES (?, ?, ?, 'same-as', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `identity:${row.entity_id}:${candidate.entity_id}`,
          row.entity_id,
          candidate.entity_id,
          rationale,
          stableJson(["evidence establishes referential identity"]),
          row.negative_criteria_json,
          stableJson(evidence),
          `identity-resolution:${row.entity_id}`,
          sessionId,
        );
    }
  })();
  return {
    entity_id: row.entity_id,
    resolution,
    canonical_entity_id: canonical,
    candidate_entity_id: candidate.entity_id,
  };
}

function addProperty(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "add_crosswalk_property");
  const entityId = requireString(args, "entity_id");
  const sourceEntityId = optString(args, "source_entity_id") ?? entityId;
  entity(ctx, entityId);
  entity(ctx, sourceEntityId);
  const propertyId = requireString(args, "property_id");
  const propertyKey = requireString(args, "property_key");
  if (args.value === undefined) throw new ToolError("value is required");
  const sourceProvenance = provenance(ctx, args.provenance);
  ctx.db
    .prepare(
      `INSERT INTO crosswalk_properties
         (property_id, entity_id, property_key, value_json, source_entity_id,
          provenance_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      propertyId,
      entityId,
      propertyKey,
      stableJson(args.value),
      sourceEntityId,
      stableJson(sourceProvenance),
      sessionId,
    );
  return { property_id: propertyId, entity_id: entityId, source_entity_id: sourceEntityId };
}

function insertRelation(
  args: Record<string, unknown>,
  ctx: ServerContext,
  predecessor: string | null = null,
): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "add_crosswalk_relation");
  const relationId = requireString(args, "relation_id");
  const sourceEntityId = requireString(args, "source_entity_id");
  const targetEntityId = requireString(args, "target_entity_id");
  entity(ctx, sourceEntityId);
  entity(ctx, targetEntityId);
  const relationType = requireEnum(args, "relation_type", RELATION_TYPES);
  const positiveCriteria = strings(args.positive_criteria, "positive_criteria");
  const negativeCriteria = strings(args.negative_criteria, "negative_criteria");
  const sourceProvenance = provenance(ctx, args.provenance);
  ctx.db
    .prepare(
      `INSERT INTO crosswalk_relations
         (relation_id, predecessor_relation_id, source_entity_id, target_entity_id,
          relation_type, statement, positive_criteria_json, negative_criteria_json,
          provenance_json, valid_from, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      relationId,
      predecessor,
      sourceEntityId,
      targetEntityId,
      relationType,
      requireString(args, "statement"),
      stableJson(positiveCriteria),
      stableJson(negativeCriteria),
      stableJson(sourceProvenance),
      requireString(args, "valid_from"),
      sessionId,
    );
  return { relation_id: relationId, status: "current", predecessor_relation_id: predecessor };
}

function addCounterevidence(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "add_crosswalk_counterevidence");
  const relationId = requireString(args, "relation_id");
  relation(ctx, relationId);
  const counterevidenceId = requireString(args, "counterevidence_id");
  const sourceProvenance = provenance(ctx, args.provenance);
  ctx.db
    .prepare(
      `INSERT INTO crosswalk_counterevidence
         (counterevidence_id, relation_id, statement, provenance_json, created_by)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      counterevidenceId,
      relationId,
      requireString(args, "statement"),
      stableJson(sourceProvenance),
      sessionId,
    );
  return { counterevidence_id: counterevidenceId, relation_id: relationId, resolution: "open" };
}

function supersedeRelation(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const predecessor = relation(ctx, requireString(args, "predecessor_relation_id"));
  if (predecessor.status !== "current")
    throw new ToolError("only a current relation can be superseded");
  if (
    args.source_entity_id !== predecessor.source_entity_id ||
    args.target_entity_id !== predecessor.target_entity_id
  ) {
    throw new ToolError("successor must retain relation endpoints");
  }
  const validFrom = requireString(args, "valid_from");
  const successor = ctx.db.transaction(() => {
    const next = insertRelation(args, ctx, predecessor.relation_id);
    ctx.db
      .prepare(
        `UPDATE crosswalk_relations
            SET status='superseded', valid_until=?, superseded_at=datetime('now')
          WHERE relation_id=?`,
      )
      .run(validFrom, predecessor.relation_id);
    return next;
  })();
  return { ...successor, supersedes: predecessor.relation_id };
}

function durableArtifact(path: string): { path: string; hash: string; bytes: number } {
  if (!isAbsolute(path)) throw new ToolError("qualification artifact_path must be absolute");
  const lexical = resolve(path);
  if (!existsSync(lexical) || !statSync(lexical).isFile()) {
    throw new ToolError("qualification artifact must be an existing file");
  }
  const real = realpathSync(lexical);
  if (
    real.startsWith("/tmp/") ||
    real.startsWith("/private/tmp/") ||
    (/^\/private\/var\/folders\//.test(real) && real.includes("/T/"))
  ) {
    throw new ToolError("qualification artifact cannot use temporary custody");
  }
  const bytes = readFileSync(real);
  return {
    path: real,
    hash: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

function parseControls(value: unknown): Array<Record<string, unknown>> {
  const rows = objects(value, "controls", CONTROL_TYPES.length);
  const ids = new Set<string>();
  const types = new Set<string>();
  const expectedByType: Record<string, string> = {
    baseline: "accept",
    positive: "reject",
    negative: "accept",
    scramble: "reject",
    inconclusive: "inconclusive",
  };
  const parsed = rows.map((row, index) => {
    const controlId = requireString(row, "control_id");
    const type = requireEnum(row, "type", CONTROL_TYPES);
    const expectedOutcome = requireEnum(row, "expected_outcome", CONTROL_OUTCOMES);
    if (ids.has(controlId)) throw new ToolError(`duplicate controls[${index}].control_id`);
    if (types.has(type)) throw new ToolError(`duplicate control type: ${type}`);
    if (expectedOutcome !== expectedByType[type]) {
      throw new ToolError(`control ${type} must expect ${expectedByType[type]}`);
    }
    ids.add(controlId);
    types.add(type);
    return {
      control_id: controlId,
      type,
      expected_outcome: expectedOutcome,
      definition: requireString(row, "definition"),
      negative_criteria: strings(row.negative_criteria, `controls[${index}].negative_criteria`),
    };
  });
  for (const type of CONTROL_TYPES) {
    if (!types.has(type)) throw new ToolError(`missing control type: ${type}`);
  }
  return parsed;
}

function parseRedGates(value: unknown): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  return objects(value, "red_gates").map((row, index) => {
    const gateId = requireString(row, "gate_id");
    if (seen.has(gateId)) throw new ToolError(`duplicate red_gates[${index}].gate_id`);
    seen.add(gateId);
    return {
      gate_id: gateId,
      fault: requireString(row, "fault"),
      expected_failure: requireString(row, "expected_failure"),
    };
  });
}

function planQualification(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "plan_method_qualification");
  const qualificationId = requireString(args, "qualification_id");
  const method = entity(ctx, requireString(args, "method_entity_id"));
  if (method.entity_kind !== "method" || method.identity_state === "pending") {
    throw new ToolError("method qualification requires a resolved method entity");
  }
  const collatio = object(args.collatio_contract, "collatio_contract");
  const contract = {
    program_version: requireString(collatio, "program_version"),
    design_ref: requireString(collatio, "design_ref"),
    qualification_scope: requireString(collatio, "qualification_scope"),
    authorization_status: requireEnum(collatio, "authorization_status", ["authorized"] as const),
  };
  const predictionInput = object(args.prediction, "prediction");
  const prediction = {
    metric: requireString(predictionInput, "metric"),
    baseline_value_milli: requireInt(predictionInput, "baseline_value_milli"),
    expected_direction: requireEnum(predictionInput, "expected_direction", [
      "increase",
      "decrease",
    ] as const),
    minimum_effect_milli: requireInt(predictionInput, "minimum_effect_milli"),
    falsifier: requireString(predictionInput, "falsifier"),
  };
  if (prediction.minimum_effect_milli <= 0)
    throw new ToolError("minimum_effect_milli must be positive");
  const controls = parseControls(args.controls);
  const redGates = parseRedGates(args.red_gates);
  const custodyInput = object(args.custody, "custody");
  const custody = {
    expected_artifacts: strings(custodyInput.expected_artifacts, "custody.expected_artifacts"),
    expected_result_count: requireInt(custodyInput, "expected_result_count"),
    result_schema_version: requireString(custodyInput, "result_schema_version"),
  };
  if (custody.expected_result_count !== 1 || custody.expected_artifacts.length !== 1) {
    throw new ToolError("method qualification expects exactly one reconciled result artifact");
  }
  const plan = {
    qualification_id: qualificationId,
    method_entity_id: method.entity_id,
    collatio_contract: contract,
    prediction,
    controls,
    red_gates: redGates,
    custody,
    target_policy_key: requireString(args, "target_policy_key"),
  };
  ctx.db
    .prepare(
      `INSERT INTO method_qualification_plans
         (qualification_id, method_entity_id, collatio_contract_json, prediction_json,
          controls_json, red_gates_json, custody_json, target_policy_key, plan_hash, planned_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      qualificationId,
      method.entity_id,
      stableJson(contract),
      stableJson(prediction),
      stableJson(controls),
      stableJson(redGates),
      stableJson(custody),
      plan.target_policy_key,
      hash(plan),
      sessionId,
    );
  return { status: "planned", plan_hash: hash(plan), plan };
}

function landQualification(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "land_method_qualification");
  const plan = qualification(ctx, requireString(args, "qualification_id"));
  if (plan.status !== "planned") throw new ToolError(`method qualification is ${plan.status}`);
  const resultId = requireString(args, "result_id");
  const controlResults = objects(args.control_results, "control_results").map((row) => ({
    control_id: requireString(row, "control_id"),
    observed_outcome: requireEnum(row, "observed_outcome", CONTROL_OUTCOMES),
  }));
  const gateResults = objects(args.red_gate_results, "red_gate_results").map((row) => ({
    gate_id: requireString(row, "gate_id"),
    fired: row.fired === true,
    observed_failure: requireString(row, "observed_failure"),
  }));
  const custody = object(args.custody_counts, "custody_counts");
  const custodyCounts = {
    planned: requireInt(custody, "planned"),
    landed: requireInt(custody, "landed"),
    schema_valid: requireInt(custody, "schema_valid"),
  };
  const limitations = strings(args.limitations, "limitations");
  const artifact = durableArtifact(requireString(args, "artifact_path"));
  const expectedCustody = JSON.parse(plan.custody_json) as Record<string, unknown>;
  const expectedArtifacts = expectedCustody.expected_artifacts as string[];
  if (expectedArtifacts.length !== 1 || basename(artifact.path) !== expectedArtifacts[0]) {
    throw new ToolError("qualification artifact does not match the frozen custody manifest");
  }
  let artifactPayload: Record<string, unknown>;
  try {
    artifactPayload = object(
      JSON.parse(readFileSync(artifact.path, "utf8")),
      "qualification artifact",
    );
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("qualification artifact must be valid JSON");
  }
  const observedValue = requireInt(args, "observed_value_milli");
  const expectedArtifactPayload = {
    schema_version: expectedCustody.result_schema_version,
    qualification_id: plan.qualification_id,
    observed_value_milli: observedValue,
    control_results: controlResults,
    red_gate_results: gateResults,
    custody_counts: custodyCounts,
    limitations,
  };
  if (stableJson(artifactPayload) !== stableJson(expectedArtifactPayload)) {
    throw new ToolError("qualification artifact content does not match the landed result");
  }
  const result = {
    result_id: resultId,
    qualification_id: plan.qualification_id,
    plan_hash: plan.plan_hash,
    artifact,
    observed_value_milli: observedValue,
    control_results: controlResults,
    red_gate_results: gateResults,
    custody_counts: custodyCounts,
    limitations,
  };
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO method_qualification_results
           (result_id, qualification_id, artifact_path, artifact_hash,
            result_json, result_hash, landed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        resultId,
        plan.qualification_id,
        artifact.path,
        artifact.hash,
        stableJson(result),
        hash(result),
        sessionId,
      );
    ctx.db
      .prepare("UPDATE method_qualification_plans SET status='landed' WHERE qualification_id=?")
      .run(plan.qualification_id);
  })();
  return { status: "landed", result_hash: hash(result), result };
}

function exactMap(
  expected: Array<Record<string, unknown>>,
  actual: Array<Record<string, unknown>>,
  id: string,
  expectedField: string,
  actualField: string,
): { ok: boolean; expected_ids: string[]; actual_ids: string[]; mismatches: string[] } {
  const expectedIds = expected.map((row) => String(row[id])).sort();
  const actualIds = actual.map((row) => String(row[id])).sort();
  const actualById = new Map(actual.map((row) => [String(row[id]), row]));
  const mismatches = expected
    .filter((row) => actualById.get(String(row[id]))?.[actualField] !== row[expectedField])
    .map((row) => String(row[id]));
  return {
    ok: stableJson(expectedIds) === stableJson(actualIds) && mismatches.length === 0,
    expected_ids: expectedIds,
    actual_ids: actualIds,
    mismatches,
  };
}

function scoreQualification(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "score_method_qualification");
  const plan = qualification(ctx, requireString(args, "qualification_id"));
  if (plan.status !== "landed") throw new ToolError(`method qualification is ${plan.status}`);
  const stored = ctx.db
    .prepare("SELECT * FROM method_qualification_results WHERE qualification_id=?")
    .get(plan.qualification_id) as
    | {
        result_id: string;
        artifact_path: string;
        artifact_hash: string;
        result_json: string;
        result_hash: string;
      }
    | undefined;
  if (!stored) throw new ToolError("method qualification result is missing");
  const result = JSON.parse(stored.result_json) as Record<string, unknown>;
  const prediction = JSON.parse(plan.prediction_json) as Record<string, unknown>;
  const observed = Number(result.observed_value_milli);
  const baseline = Number(prediction.baseline_value_milli);
  const minimum = Number(prediction.minimum_effect_milli);
  const effect =
    prediction.expected_direction === "increase" ? observed - baseline : baseline - observed;
  const predictionOk = effect >= minimum;
  const controls = exactMap(
    JSON.parse(plan.controls_json),
    result.control_results as Array<Record<string, unknown>>,
    "control_id",
    "expected_outcome",
    "observed_outcome",
  );
  const redGates = exactMap(
    (JSON.parse(plan.red_gates_json) as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      expected_result: stableJson({ fired: true, observed_failure: row.expected_failure }),
    })),
    (result.red_gate_results as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      observed_result: stableJson({
        fired: row.fired,
        observed_failure: row.observed_failure,
      }),
    })),
    "gate_id",
    "expected_result",
    "observed_result",
  );
  const custody = result.custody_counts as Record<string, unknown>;
  const expectedCustody = JSON.parse(plan.custody_json) as Record<string, unknown>;
  const custodyOk =
    custody.planned === expectedCustody.expected_result_count &&
    custody.landed === expectedCustody.expected_result_count &&
    custody.schema_valid === expectedCustody.expected_result_count;
  const artifact = durableArtifact(stored.artifact_path);
  const readbackOk =
    artifact.hash === stored.artifact_hash &&
    hash(result) === stored.result_hash &&
    result.plan_hash === plan.plan_hash;
  const report = {
    qualification_id: plan.qualification_id,
    axes: {
      prediction: { ok: predictionOk, effect_milli: effect, minimum_effect_milli: minimum },
      controls,
      red_gates: redGates,
      custody: { ok: custodyOk, expected: expectedCustody, actual: custody },
      readback: { ok: readbackOk, artifact_hash: artifact.hash, result_hash: hash(result) },
    },
    limitations: result.limitations,
  };
  const passed = predictionOk && controls.ok && redGates.ok && custodyOk && readbackOk;
  const scoreId = requireString(args, "score_id");
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO method_qualification_scores
           (score_id, qualification_id, result_id, prediction_ok, controls_ok,
            red_gates_ok, custody_ok, readback_ok, passed, report_json, scored_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        scoreId,
        plan.qualification_id,
        stored.result_id,
        predictionOk ? 1 : 0,
        controls.ok ? 1 : 0,
        redGates.ok ? 1 : 0,
        custodyOk ? 1 : 0,
        readbackOk ? 1 : 0,
        passed ? 1 : 0,
        stableJson({ ...report, passed }),
        sessionId,
      );
    ctx.db
      .prepare(
        "UPDATE method_qualification_plans SET status=?, terminal_at=datetime('now') WHERE qualification_id=?",
      )
      .run(passed ? "passed" : "failed", plan.qualification_id);
  })();
  return { score_id: scoreId, status: passed ? "passed" : "failed", passed, report };
}

function activateMethod(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "activate_qualified_method");
  const plan = qualification(ctx, requireString(args, "qualification_id"));
  const policyKey = requireString(args, "policy_key");
  if (plan.target_policy_key !== policyKey)
    throw new ToolError("policy key does not match qualification target");
  const configuration = object(args.configuration, "configuration");
  ctx.db
    .prepare(
      `INSERT INTO unattended_method_policy
         (policy_key, method_entity_id, qualification_id, configuration_json, activated_by)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      policyKey,
      plan.method_entity_id,
      plan.qualification_id,
      stableJson(configuration),
      sessionId,
    );
  return {
    policy_key: policyKey,
    method_entity_id: plan.method_entity_id,
    qualification_id: plan.qualification_id,
  };
}

function projectionPayload(ctx: ServerContext): Record<string, unknown> {
  const entities = ctx.db
    .prepare(
      `SELECT entity_id, entity_kind, source_kind, source_ref, label, definition,
              identity_state, canonical_entity_id
         FROM crosswalk_entities ORDER BY entity_id`,
    )
    .all() as Array<Record<string, unknown>>;
  const relations = ctx.db
    .prepare(
      `SELECT relation_id, predecessor_relation_id, source_entity_id, target_entity_id,
              relation_type, statement, status, valid_from, valid_until
         FROM crosswalk_relations ORDER BY relation_id`,
    )
    .all() as Array<Record<string, unknown>>;
  const counterevidence = ctx.db
    .prepare(
      `SELECT counterevidence_id, relation_id, statement, resolution
         FROM crosswalk_counterevidence ORDER BY counterevidence_id`,
    )
    .all() as Array<Record<string, unknown>>;
  const typeCounts = ctx.db
    .prepare(
      `SELECT relation_type, COUNT(*) AS count FROM crosswalk_relations
        GROUP BY relation_type ORDER BY relation_type`,
    )
    .all();
  return {
    schema_version: "1.0.0",
    counts: {
      entities: entities.length,
      relations: relations.length,
      unresolved_identities: entities.filter((row) => row.identity_state === "pending").length,
      unresolved_contradictions: counterevidence.filter((row) => row.resolution === "open").length,
    },
    relation_type_counts: typeCounts,
    entities,
    relations,
    counterevidence,
    active_methods: ctx.db
      .prepare(
        `SELECT policy_key, method_entity_id, qualification_id, configuration_json
           FROM unattended_method_policy ORDER BY policy_key`,
      )
      .all(),
  };
}

function projectCrosswalk(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "project_crosswalk");
  const projectionId = requireString(args, "projection_id");
  const payload = projectionPayload(ctx);
  ctx.db
    .prepare(
      `INSERT INTO crosswalk_projections
         (projection_id, schema_version, projection_json, projection_hash, projected_by)
       VALUES (?, '1.0.0', ?, ?, ?)`,
    )
    .run(projectionId, stableJson(payload), hash(payload), sessionId);
  return { projection_id: projectionId, projection_hash: hash(payload), projection: payload };
}

function verifyProjection(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "verify_crosswalk_projection");
  const projectionId = requireString(args, "projection_id");
  const stored = ctx.db
    .prepare("SELECT projection_json FROM crosswalk_projections WHERE projection_id=?")
    .get(projectionId) as { projection_json: string } | undefined;
  if (!stored) throw new ToolError(`unknown crosswalk projection: ${projectionId}`);
  const expected = projectionPayload(ctx);
  const actual = (args.projection ?? JSON.parse(stored.projection_json)) as Record<string, unknown>;
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    throw new ToolError("projection must be an object");
  }
  const stateOk = actual.schema_version === "1.0.0";
  const coverageOk =
    Array.isArray(actual.entities) &&
    Array.isArray(actual.relations) &&
    Array.isArray(actual.counterevidence) &&
    Array.isArray(actual.relation_type_counts) &&
    Array.isArray(actual.active_methods) &&
    stableJson(actual.counts) === stableJson(expected.counts);
  const contentOk = stableJson(actual) === stableJson(expected);
  const report = {
    axes: {
      state: { ok: stateOk },
      coverage: { ok: coverageOk },
      content: { ok: contentOk, expected_hash: hash(expected), actual_hash: hash(actual) },
    },
    ok: stateOk && coverageOk && contentOk,
  };
  ctx.db
    .prepare(
      `INSERT INTO crosswalk_projection_verifications
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

function getCrosswalk(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const entityId = optString(args, "entity_id");
  if (!entityId) return projectionPayload(ctx);
  const row = entity(ctx, entityId);
  return {
    ...row,
    negative_criteria: JSON.parse(row.negative_criteria_json),
    provenance: JSON.parse(row.provenance_json),
    identity_resolution:
      ctx.db
        .prepare("SELECT * FROM crosswalk_identity_resolutions WHERE entity_id=?")
        .get(entityId) ?? null,
    properties: ctx.db
      .prepare("SELECT * FROM crosswalk_properties WHERE entity_id=? ORDER BY property_id")
      .all(entityId),
    relations: ctx.db
      .prepare(
        `SELECT r.*,
                (SELECT COUNT(*) FROM crosswalk_counterevidence c
                  WHERE c.relation_id=r.relation_id AND c.resolution='open') AS open_counterevidence_count
           FROM crosswalk_relations r
          WHERE r.source_entity_id=? OR r.target_entity_id=? ORDER BY r.relation_id`,
      )
      .all(entityId, entityId),
  };
}

const provenanceSchema = {
  type: "array",
  minItems: 1,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "ref", "statement"],
    properties: {
      kind: { type: "string", enum: [...PROVENANCE_KINDS] },
      ref: { type: "string", minLength: 1 },
      statement: { type: "string", minLength: 1 },
    },
  },
};
const stringsSchema = { type: "array", minItems: 1, items: { type: "string", minLength: 1 } };
const controlSchema = {
  type: "object",
  additionalProperties: false,
  required: ["control_id", "type", "expected_outcome", "definition", "negative_criteria"],
  properties: {
    control_id: { type: "string", minLength: 1 },
    type: { type: "string", enum: [...CONTROL_TYPES] },
    expected_outcome: { type: "string", enum: [...CONTROL_OUTCOMES] },
    definition: { type: "string", minLength: 1 },
    negative_criteria: stringsSchema,
  },
};
const redGateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["gate_id", "fault", "expected_failure"],
  properties: {
    gate_id: { type: "string", minLength: 1 },
    fault: { type: "string", minLength: 1 },
    expected_failure: { type: "string", minLength: 1 },
  },
};
const controlResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["control_id", "observed_outcome"],
  properties: {
    control_id: { type: "string", minLength: 1 },
    observed_outcome: { type: "string", enum: [...CONTROL_OUTCOMES] },
  },
};
const redGateResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["gate_id", "fired", "observed_failure"],
  properties: {
    gate_id: { type: "string", minLength: 1 },
    fired: { type: "boolean" },
    observed_failure: { type: "string", minLength: 1 },
  },
};
const relationProperties = {
  relation_id: { type: "string", minLength: 1 },
  source_entity_id: { type: "string", minLength: 1 },
  target_entity_id: { type: "string", minLength: 1 },
  relation_type: { type: "string", enum: [...RELATION_TYPES] },
  statement: { type: "string", minLength: 1 },
  positive_criteria: stringsSchema,
  negative_criteria: stringsSchema,
  provenance: provenanceSchema,
  valid_from: { type: "string", minLength: 1 },
};

export const crosswalkTools: ToolDefinition[] = [
  {
    name: "stage_crosswalk_entity",
    description:
      "Stage a provenance-bearing code claim, external claim, concern, decision revision, or method endpoint. A unique normalized label resolves as distinct; a collision stays pending and cannot receive relations or enrichment until explicit same-as or distinct resolution.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "entity_id",
        "entity_kind",
        "source_kind",
        "source_ref",
        "label",
        "definition",
        "negative_criteria",
        "provenance",
      ],
      properties: {
        entity_id: { type: "string", minLength: 1 },
        entity_kind: { type: "string", enum: [...ENTITY_KINDS] },
        source_kind: { type: "string", enum: [...SOURCE_KINDS] },
        source_ref: { type: "string", minLength: 1 },
        label: { type: "string", minLength: 1 },
        definition: { type: "string", minLength: 1 },
        negative_criteria: stringsSchema,
        provenance: provenanceSchema,
      },
    },
    handler: stageEntity,
  },
  {
    name: "resolve_crosswalk_identity",
    description:
      "Resolve one normalized-label collision as same-as or distinct with supporting evidence and rationale. Same-as adopts the candidate's canonical identity and writes a typed relation; distinct preserves both definitions and negative criteria.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entity_id", "candidate_entity_id", "resolution", "evidence", "rationale"],
      properties: {
        entity_id: { type: "string", minLength: 1 },
        candidate_entity_id: { type: "string", minLength: 1 },
        resolution: { type: "string", enum: ["same-as", "distinct"] },
        evidence: provenanceSchema,
        rationale: { type: "string", minLength: 1 },
      },
    },
    handler: resolveIdentity,
  },
  {
    name: "add_crosswalk_property",
    description:
      "Add one immutable, provenance-bearing property to a resolved endpoint. A property copied from another endpoint is accepted only when both resolve to the same canonical identity; analogy and name similarity never confer inheritance.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["property_id", "entity_id", "property_key", "value", "provenance"],
      properties: {
        property_id: { type: "string", minLength: 1 },
        entity_id: { type: "string", minLength: 1 },
        property_key: { type: "string", minLength: 1 },
        value: {},
        source_entity_id: { type: "string", minLength: 1 },
        provenance: provenanceSchema,
      },
    },
    handler: addProperty,
  },
  {
    name: "add_crosswalk_relation",
    description:
      "Add a current relation from the finite supports/contradicts/refines/analogous-to/applies-to/derived-from/supersedes vocabulary. Both identities must be resolved; positive and negative criteria plus validated provenance are mandatory.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: Object.keys(relationProperties),
      properties: relationProperties,
    },
    handler: (args, ctx) => insertRelation(args, ctx),
  },
  {
    name: "add_crosswalk_counterevidence",
    description:
      "Attach immutable counterevidence to a relation without averaging it into consensus or editing the relation. Counterevidence remains visible with its historical relation even after a successor changes current authority.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["counterevidence_id", "relation_id", "statement", "provenance"],
      properties: {
        counterevidence_id: { type: "string", minLength: 1 },
        relation_id: { type: "string", minLength: 1 },
        statement: { type: "string", minLength: 1 },
        provenance: provenanceSchema,
      },
    },
    handler: addCounterevidence,
  },
  {
    name: "supersede_crosswalk_relation",
    description:
      "Create an evidence-bearing successor relation over the same endpoints and close the predecessor's validity interval. Prior claims and counterevidence remain immutable and readable.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["predecessor_relation_id", ...Object.keys(relationProperties)],
      properties: {
        predecessor_relation_id: { type: "string", minLength: 1 },
        ...relationProperties,
      },
    },
    handler: supersedeRelation,
  },
  {
    name: "plan_method_qualification",
    description:
      "Freeze a Collatio-compatible qualification plan for a resolved method: authorized scope, falsifiable metric prediction, baseline/positive/negative/scramble/inconclusive controls, production red gates, exact result custody, and target unattended policy key.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "qualification_id",
        "method_entity_id",
        "collatio_contract",
        "prediction",
        "controls",
        "red_gates",
        "custody",
        "target_policy_key",
      ],
      properties: {
        qualification_id: { type: "string", minLength: 1 },
        method_entity_id: { type: "string", minLength: 1 },
        collatio_contract: {
          type: "object",
          additionalProperties: false,
          required: [
            "program_version",
            "design_ref",
            "qualification_scope",
            "authorization_status",
          ],
          properties: {
            program_version: { type: "string", minLength: 1 },
            design_ref: { type: "string", minLength: 1 },
            qualification_scope: { type: "string", minLength: 1 },
            authorization_status: { const: "authorized" },
          },
        },
        prediction: {
          type: "object",
          additionalProperties: false,
          required: [
            "metric",
            "baseline_value_milli",
            "expected_direction",
            "minimum_effect_milli",
            "falsifier",
          ],
          properties: {
            metric: { type: "string", minLength: 1 },
            baseline_value_milli: { type: "integer" },
            expected_direction: { type: "string", enum: ["increase", "decrease"] },
            minimum_effect_milli: { type: "integer", minimum: 1 },
            falsifier: { type: "string", minLength: 1 },
          },
        },
        controls: { type: "array", minItems: 5, items: controlSchema },
        red_gates: { type: "array", minItems: 1, items: redGateSchema },
        custody: {
          type: "object",
          additionalProperties: false,
          required: ["expected_artifacts", "expected_result_count", "result_schema_version"],
          properties: {
            expected_artifacts: stringsSchema,
            expected_result_count: { const: 1 },
            result_schema_version: { type: "string", minLength: 1 },
          },
        },
        target_policy_key: { type: "string", minLength: 1 },
      },
    },
    handler: planQualification,
  },
  {
    name: "land_method_qualification",
    description:
      "Land one durable qualification result whose JSON content exactly matches the frozen artifact name/schema, measured prediction value, control outcomes, red-gate firings, reconciliation counts, and limitations. Landing re-reads and hashes the artifact and never self-awards pass status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "qualification_id",
        "result_id",
        "artifact_path",
        "observed_value_milli",
        "control_results",
        "red_gate_results",
        "custody_counts",
        "limitations",
      ],
      properties: {
        qualification_id: { type: "string", minLength: 1 },
        result_id: { type: "string", minLength: 1 },
        artifact_path: { type: "string", minLength: 1 },
        observed_value_milli: { type: "integer" },
        control_results: { type: "array", minItems: 1, items: controlResultSchema },
        red_gate_results: { type: "array", minItems: 1, items: redGateResultSchema },
        custody_counts: {
          type: "object",
          additionalProperties: false,
          required: ["planned", "landed", "schema_valid"],
          properties: {
            planned: { type: "integer", minimum: 0 },
            landed: { type: "integer", minimum: 0 },
            schema_valid: { type: "integer", minimum: 0 },
          },
        },
        limitations: stringsSchema,
      },
    },
    handler: landQualification,
  },
  {
    name: "score_method_qualification",
    description:
      "Mechanically score a landed method result against its frozen prediction, exact graded-control set, every red-gate proof, custody counts, and artifact/result read-back. Any failed axis yields failed qualification.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["qualification_id", "score_id"],
      properties: {
        qualification_id: { type: "string", minLength: 1 },
        score_id: { type: "string", minLength: 1 },
      },
    },
    handler: scoreQualification,
  },
  {
    name: "activate_qualified_method",
    description:
      "Activate a method at its frozen unattended-policy destination. SQLite rejects direct or handler writes unless the matching qualification passed prediction, controls, red gates, custody, and read-back.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["qualification_id", "policy_key", "configuration"],
      properties: {
        qualification_id: { type: "string", minLength: 1 },
        policy_key: { type: "string", minLength: 1 },
        configuration: { type: "object" },
      },
    },
    handler: activateMethod,
  },
  {
    name: "project_crosswalk",
    description:
      "Create an immutable Crosswalk 1.0.0 projection with exact endpoint and relation identities, typed relation counts, unresolved identity/contradiction counts, counterevidence, history, and active qualified methods.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["projection_id"],
      properties: { projection_id: { type: "string", minLength: 1 } },
    },
    handler: projectCrosswalk,
  },
  {
    name: "verify_crosswalk_projection",
    description:
      "Read a stored or caller-supplied crosswalk projection back against durable state on independent state, exact coverage/count, and semantic content axes.",
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
  {
    name: "get_crosswalk",
    description:
      "Read the full crosswalk projection or one endpoint with its identity resolution, properties, typed relations, and open counterevidence counts.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { entity_id: { type: "string", minLength: 1 } },
    },
    handler: getCrosswalk,
  },
];
