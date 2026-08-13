import { createHash } from "node:crypto";
import {
  requireEnum,
  requireInt,
  requireString,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const ROLES = [
  "baseline",
  "null",
  "stronger-control",
  "treatment",
  "ablation",
  "test-retest",
  "sensitivity-add",
  "sensitivity-remove",
] as const;
const METRIC_IDS = ["M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10", "M11", "M12"] as const;
const INSTRUMENT_STATES = [
  "valid",
  "delivery-failed",
  "determinism-failed",
  "undetermined-no-headroom",
] as const;

interface ProgramRow {
  program_id: string;
  manifest_json: string;
  manifest_hash: string;
  expected_case_count: number;
  status: "planned" | "collecting" | "ready" | "published";
}

interface CaseRow {
  case_id: string;
  program_id: string;
  stratum_id: string;
  repository_id: string;
  repository_type: string;
  languages_json: string;
  scale_bucket: string;
  repository_shape: string;
  change_class: string;
  mode: string;
  context_condition: string;
  model_family: string;
  runtime_id: string;
  condition_id: string;
  condition_role: (typeof ROLES)[number];
  replicate_id: string;
  expected_input_hash: string;
  status: string;
}

interface ResultRow {
  case_id: string;
  primary_metric_id: string;
  primary_value_milli: number;
  metrics_json: string;
  instrument_status: (typeof INSTRUMENT_STATES)[number];
  excluded_observations_json: string;
  agreement_json: string | null;
  limitations_json: string;
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

function present<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new ToolError(message);
  return value;
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

function program(ctx: ServerContext, programId: string): ProgramRow {
  const row = ctx.db
    .prepare("SELECT * FROM evaluation_programs WHERE program_id=?")
    .get(programId) as ProgramRow | undefined;
  if (!row) throw new ToolError(`unknown evaluation program: ${programId}`);
  return row;
}

function evaluationCase(ctx: ServerContext, caseId: string): CaseRow {
  const row = ctx.db.prepare("SELECT * FROM evaluation_cases WHERE case_id=?").get(caseId) as
    | CaseRow
    | undefined;
  if (!row) throw new ToolError(`unknown evaluation case: ${caseId}`);
  return row;
}

function parseRepositories(value: unknown): Array<Record<string, unknown>> {
  const ids = new Set<string>();
  return objects(value, "repositories", 2).map((row, index) => {
    const repositoryId = requireString(row, "repository_id");
    if (ids.has(repositoryId))
      throw new ToolError(`duplicate repositories[${index}].repository_id`);
    ids.add(repositoryId);
    return {
      repository_id: repositoryId,
      repository_type: requireString(row, "repository_type"),
      languages: strings(row.languages, `repositories[${index}].languages`),
      scale_bucket: requireString(row, "scale_bucket"),
      repository_shape: requireString(row, "repository_shape"),
      inclusion_reason: requireString(row, "inclusion_reason"),
      exclusion_criteria: strings(
        row.exclusion_criteria,
        `repositories[${index}].exclusion_criteria`,
      ),
      known_outcomes: objects(row.known_outcomes, `repositories[${index}].known_outcomes`).map(
        (outcome) => ({
          outcome_id: requireString(outcome, "outcome_id"),
          statement: requireString(outcome, "statement"),
          source_ref: requireString(outcome, "source_ref"),
        }),
      ),
    };
  });
}

function parseMetrics(value: unknown): Array<Record<string, unknown>> {
  const ids = new Set<string>();
  return objects(value, "metrics").map((row, index) => {
    const metricId = requireEnum(row, "metric_id", METRIC_IDS);
    if (ids.has(metricId)) throw new ToolError(`duplicate metrics[${index}].metric_id`);
    ids.add(metricId);
    const mde = requireInt(row, "minimum_detectable_effect_milli");
    const step = requireInt(row, "step_size_milli");
    if (mde <= 0 || step <= 0) throw new ToolError("metric MDE and step size must be positive");
    return {
      metric_id: metricId,
      definition: requireString(row, "definition"),
      direction: requireEnum(row, "direction", ["increase", "decrease"] as const),
      minimum_detectable_effect_milli: mde,
      step_size_milli: step,
      stopping_rule: requireString(row, "stopping_rule"),
    };
  });
}

function parseConditions(value: unknown): Array<Record<string, unknown>> {
  const roles = new Set<string>();
  const ids = new Set<string>();
  const result = objects(value, "conditions", ROLES.length).map((row, index) => {
    const conditionId = requireString(row, "condition_id");
    const role = requireEnum(row, "role", ROLES);
    if (ids.has(conditionId)) throw new ToolError(`duplicate conditions[${index}].condition_id`);
    if (roles.has(role)) throw new ToolError(`duplicate condition role: ${role}`);
    ids.add(conditionId);
    roles.add(role);
    const condition: Record<string, unknown> = {
      condition_id: conditionId,
      role,
      intervention: requireString(row, "intervention"),
      expected_behavior: requireString(row, "expected_behavior"),
      manipulation_check: requireString(row, "manipulation_check"),
    };
    if (role === "null") {
      const surfaceIdentity = object(row.surface_identity, `conditions[${index}].surface_identity`);
      const dimensions = strings(
        surfaceIdentity.dimensions,
        `conditions[${index}].surface_identity.dimensions`,
      );
      const requiredDimensions = [
        "shape",
        "length-distribution",
        "identifiers",
        "cross-references",
      ];
      if (!requiredDimensions.every((dimension) => dimensions.includes(dimension))) {
        throw new ToolError(
          `conditions[${index}] null must control shape, length-distribution, identifiers, and cross-references`,
        );
      }
      if (requireString(surfaceIdentity, "compared_against_role") !== "baseline") {
        throw new ToolError(
          `conditions[${index}] null surface identity must be compared against baseline`,
        );
      }
      condition.surface_identity = {
        compared_against_role: "baseline",
        dimensions,
      };
    }
    return condition;
  });
  for (const role of ROLES)
    if (!roles.has(role)) throw new ToolError(`missing condition role: ${role}`);
  return result;
}

function parseStrata(
  value: unknown,
  repositories: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const repositoryIds = new Set(repositories.map((row) => String(row.repository_id)));
  const ids = new Set<string>();
  const usedRepositories = new Set<string>();
  const result = objects(value, "strata", 2).map((row, index) => {
    const stratumId = requireString(row, "stratum_id");
    const repositoryId = requireString(row, "repository_id");
    if (ids.has(stratumId)) throw new ToolError(`duplicate strata[${index}].stratum_id`);
    if (!repositoryIds.has(repositoryId))
      throw new ToolError(`strata[${index}] references unknown repository`);
    ids.add(stratumId);
    usedRepositories.add(repositoryId);
    return {
      stratum_id: stratumId,
      repository_id: repositoryId,
      change_class: requireString(row, "change_class"),
      mode: requireString(row, "mode"),
      context_condition: requireString(row, "context_condition"),
      model_family: requireString(row, "model_family"),
      runtime_id: requireString(row, "runtime_id"),
    };
  });
  if (usedRepositories.size < 2)
    throw new ToolError("evaluation strata must cover at least two repositories");
  if (new Set(result.map((row) => row.context_condition)).size < 2) {
    throw new ToolError(
      "evaluation strata must include at least two independent context conditions",
    );
  }
  if (new Set(result.map((row) => `${row.model_family}:${row.runtime_id}`)).size < 2) {
    throw new ToolError("evaluation strata must include at least two model/runtime conditions");
  }
  return result;
}

function planProgram(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const plannedBy = requireActiveSession(ctx, "plan_evaluation_program");
  const programId = requireString(args, "program_id");
  const manifestInput = object(args.manifest, "manifest");
  const repositories = parseRepositories(manifestInput.repositories);
  const strata = parseStrata(manifestInput.strata, repositories);
  const metrics = parseMetrics(manifestInput.metrics);
  const primaryMetricId = requireEnum(manifestInput, "primary_metric_id", METRIC_IDS);
  if (!metrics.some((metric) => metric.metric_id === primaryMetricId)) {
    throw new ToolError("primary_metric_id is absent from preregistered metrics");
  }
  const conditions = parseConditions(manifestInput.conditions);
  const replicates = requireInt(manifestInput, "replicates_per_condition");
  if (replicates < 2)
    throw new ToolError("evaluation requires at least two replicates per condition");
  const stoppingRules = strings(manifestInput.stopping_rules, "stopping_rules");
  const unsupported = object(manifestInput.unsupported, "unsupported");
  const unsupportedScope = {
    languages: strings(unsupported.languages, "unsupported.languages"),
    scales: strings(unsupported.scales, "unsupported.scales"),
    repository_shapes: strings(unsupported.repository_shapes, "unsupported.repository_shapes"),
    decision_classes: strings(unsupported.decision_classes, "unsupported.decision_classes"),
  };
  const rubric = object(manifestInput.rubric, "rubric");
  const categories = strings(rubric.categories, "rubric.categories", 2);
  const framing = object(rubric.operational_framing, "rubric.operational_framing");
  for (const category of categories) requireString(framing, category);
  const manifest = {
    schema_version: "1.0.0",
    program_id: programId,
    repositories,
    strata,
    metrics,
    primary_metric_id: primaryMetricId,
    conditions,
    replicates_per_condition: replicates,
    stopping_rules: stoppingRules,
    unsupported: unsupportedScope,
    rubric: { categories, operational_framing: framing },
    reporting_rule: "per repository × mode × context × model/runtime × replicate; never pooled",
  };
  const manifestHash = hash(manifest);
  const repositoriesById = new Map(repositories.map((row) => [String(row.repository_id), row]));
  const cases = strata.flatMap((stratum) =>
    conditions.flatMap((condition) =>
      Array.from({ length: replicates }, (_, index) => {
        const replicateId = `${programId}:${stratum.stratum_id}:${condition.condition_id}:r${index + 1}`;
        const caseId = `case:${replicateId}`;
        return {
          case_id: caseId,
          replicate_id: replicateId,
          stratum,
          condition,
          repository: present(
            repositoriesById.get(String(stratum.repository_id)),
            `missing repository for stratum ${stratum.stratum_id}`,
          ),
          expected_input_hash: hash({
            manifest_hash: manifestHash,
            stratum,
            condition,
            replicate_id: replicateId,
          }),
        };
      }),
    ),
  );
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO evaluation_programs
           (program_id,schema_version,manifest_json,manifest_hash,expected_case_count,planned_by)
         VALUES (?, '1.0.0', ?, ?, ?, ?)`,
      )
      .run(programId, stableJson(manifest), manifestHash, cases.length, plannedBy);
    const insert = ctx.db.prepare(
      `INSERT INTO evaluation_cases
         (case_id,program_id,stratum_id,repository_id,repository_type,languages_json,
          scale_bucket,repository_shape,change_class,mode,context_condition,model_family,
          runtime_id,condition_id,condition_role,replicate_id,expected_input_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of cases) {
      insert.run(
        item.case_id,
        programId,
        item.stratum.stratum_id,
        item.stratum.repository_id,
        item.repository.repository_type,
        stableJson(item.repository.languages),
        item.repository.scale_bucket,
        item.repository.repository_shape,
        item.stratum.change_class,
        item.stratum.mode,
        item.stratum.context_condition,
        item.stratum.model_family,
        item.stratum.runtime_id,
        item.condition.condition_id,
        item.condition.role,
        item.replicate_id,
        item.expected_input_hash,
      );
    }
  })();
  return {
    program_id: programId,
    manifest_hash: manifestHash,
    expected_case_count: cases.length,
    cases: cases.map((item) => ({
      case_id: item.case_id,
      replicate_id: item.replicate_id,
      stratum_id: item.stratum.stratum_id,
      condition_id: item.condition.condition_id,
      condition_role: item.condition.role,
      expected_input_hash: item.expected_input_hash,
    })),
  };
}

function parseMetricsResult(
  value: unknown,
  expected: Array<Record<string, unknown>>,
  excludedCount: number,
): Array<Record<string, unknown>> {
  const rows = objects(value, "metrics");
  const expectedIds = expected.map((row) => String(row.metric_id)).sort();
  const seen = new Set<string>();
  const result = rows.map((row, index) => {
    const metricId = requireEnum(row, "metric_id", METRIC_IDS);
    if (seen.has(metricId)) throw new ToolError(`duplicate metrics[${index}].metric_id`);
    seen.add(metricId);
    const numerator = requireInt(row, "numerator");
    const denominator = requireInt(row, "denominator");
    const reportedExcluded = requireInt(row, "excluded_count");
    if (numerator < 0 || denominator <= 0 || numerator > denominator) {
      throw new ToolError(`metrics[${index}] has invalid numerator/denominator`);
    }
    if (reportedExcluded !== excludedCount) {
      throw new ToolError("every metric must preserve the full excluded-observation count");
    }
    const valueMilli = requireInt(row, "value_milli");
    if (valueMilli !== Math.round((numerator / denominator) * 1000)) {
      throw new ToolError(`metrics[${index}].value_milli does not reconcile`);
    }
    return {
      metric_id: metricId,
      numerator,
      denominator,
      excluded_count: reportedExcluded,
      value_milli: valueMilli,
    };
  });
  if (stableJson([...seen].sort()) !== stableJson(expectedIds)) {
    throw new ToolError("landed metric IDs do not exactly match the preregistration");
  }
  return result.sort((left, right) =>
    String(left.metric_id).localeCompare(String(right.metric_id)),
  );
}

function parseAgreement(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  const row = object(value, "agreement");
  const raw = requireInt(row, "raw_agreement_milli");
  const chance = requireInt(row, "chance_agreement_milli");
  const corrected = requireInt(row, "chance_corrected_agreement_milli");
  if (
    raw < 0 ||
    raw > 1000 ||
    chance < 0 ||
    chance >= 1000 ||
    corrected < -1000 ||
    corrected > 1000
  ) {
    throw new ToolError("agreement values are outside their milli-unit ranges");
  }
  const expected = Math.round(((raw - chance) / (1000 - chance)) * 1000);
  if (corrected !== expected)
    throw new ToolError(
      "chance-corrected agreement does not reconcile with raw and chance agreement",
    );
  return {
    raw_agreement_milli: raw,
    chance_agreement_milli: chance,
    chance_corrected_agreement_milli: corrected,
  };
}

function landResult(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const landedBy = requireActiveSession(ctx, "land_evaluation_result");
  const item = evaluationCase(ctx, requireString(args, "case_id"));
  if (item.status !== "planned") throw new ToolError(`evaluation case is ${item.status}`);
  const p = program(ctx, item.program_id);
  if (!["planned", "collecting"].includes(p.status))
    throw new ToolError(`evaluation program is ${p.status}`);
  const manifest = JSON.parse(p.manifest_json) as Record<string, unknown>;
  const metricSpecs = manifest.metrics as Array<Record<string, unknown>>;
  const primaryMetricId = String(manifest.primary_metric_id);
  const exclusions = objects(args.excluded_observations, "excluded_observations", 0).map((row) => ({
    observation_id: requireString(row, "observation_id"),
    reason: requireString(row, "reason"),
    reported_separately: row.reported_separately === true,
  }));
  if (exclusions.some((row) => !row.reported_separately)) {
    throw new ToolError("excluded observations must remain reported separately");
  }
  const metrics = parseMetricsResult(args.metrics, metricSpecs, exclusions.length);
  const primary = metrics.find((metric) => metric.metric_id === primaryMetricId);
  if (!primary) throw new ToolError("primary metric is absent from landed result");
  const deliveryInput = object(args.delivery, "delivery");
  const observedInputHash = requireString(deliveryInput, "observed_input_hash");
  const deliveryVerified = deliveryInput.delivery_verified === true;
  const determinismSetting = requireString(deliveryInput, "determinism_setting");
  const observedDeterminism = requireString(deliveryInput, "observed_determinism_value");
  const determinismChanged = deliveryInput.determinism_changed_operation === true;
  const baselineVerified = deliveryInput.baseline_verified === true;
  const observedConditionId = requireString(deliveryInput, "observed_condition_id");
  const manipulationObserved = deliveryInput.manipulation_observed === true;
  const headroom = object(deliveryInput.headroom, "delivery.headroom");
  const floor = requireInt(headroom, "floor_milli");
  const ceiling = requireInt(headroom, "ceiling_milli");
  const baseline = requireInt(headroom, "baseline_milli");
  if (!(floor < ceiling && baseline >= floor && baseline <= ceiling)) {
    throw new ToolError("delivery headroom bounds are inconsistent");
  }
  const primarySpec = present(
    metricSpecs.find((metric) => metric.metric_id === primaryMetricId),
    "primary metric specification is absent",
  );
  const mde = Number(primarySpec.minimum_detectable_effect_milli);
  let instrumentStatus: (typeof INSTRUMENT_STATES)[number] = "valid";
  if (
    !deliveryVerified ||
    observedInputHash !== item.expected_input_hash ||
    !baselineVerified ||
    observedConditionId !== item.condition_id ||
    !manipulationObserved
  ) {
    instrumentStatus = "delivery-failed";
  } else if (
    !determinismChanged ||
    determinismSetting.length === 0 ||
    observedDeterminism.length === 0
  ) {
    instrumentStatus = "determinism-failed";
  } else if (baseline - floor < mde || ceiling - baseline < mde) {
    instrumentStatus = "undetermined-no-headroom";
  }
  const rubric = manifest.rubric as Record<string, unknown>;
  const categories = rubric.categories as string[];
  const rubricCountsInput = object(args.rubric_counts, "rubric_counts");
  const rubricCounts = Object.fromEntries(
    categories.map((category) => {
      const count = requireInt(rubricCountsInput, category);
      if (count < 0) throw new ToolError(`rubric_counts.${category} must be non-negative`);
      return [category, count];
    }),
  );
  if (Object.keys(rubricCountsInput).sort().join("|") !== [...categories].sort().join("|")) {
    throw new ToolError("rubric count categories do not exactly match the preregistration");
  }
  const unusedChecks = objects(args.unused_category_checks ?? [], "unused_category_checks", 0).map(
    (row) => ({
      category: requireString(row, "category"),
      operational_frame_present: row.operational_frame_present === true,
      instrument_exposure_count: requireInt(row, "instrument_exposure_count"),
    }),
  );
  for (const [category, count] of Object.entries(rubricCounts)) {
    if (count !== 0) continue;
    const check = unusedChecks.find((row) => row.category === category);
    if (!check?.operational_frame_present || check.instrument_exposure_count <= 0) {
      throw new ToolError(`unused rubric category ${category} lacks operational-framing check`);
    }
  }
  const agreement = parseAgreement(args.agreement);
  const limitations = strings(args.limitations, "limitations");
  const delivery = {
    observed_input_hash: observedInputHash,
    expected_input_hash: item.expected_input_hash,
    delivery_verified: deliveryVerified,
    determinism_setting: determinismSetting,
    observed_determinism_value: observedDeterminism,
    determinism_changed_operation: determinismChanged,
    baseline_verified: baselineVerified,
    observed_condition_id: observedConditionId,
    manipulation_observed: manipulationObserved,
    headroom: { floor_milli: floor, ceiling_milli: ceiling, baseline_milli: baseline },
  };
  const result = {
    result_id: requireString(args, "result_id"),
    case_id: item.case_id,
    primary_metric_id: primaryMetricId,
    metrics,
    primary_value_milli: primary.value_milli,
    delivery,
    instrument_status: instrumentStatus,
    rubric_counts: rubricCounts,
    unused_category_checks: unusedChecks,
    excluded_observations: exclusions,
    agreement,
    limitations,
  };
  ctx.db.transaction(() => {
    if (p.status === "planned") {
      ctx.db
        .prepare("UPDATE evaluation_programs SET status='collecting' WHERE program_id=?")
        .run(p.program_id);
    }
    ctx.db
      .prepare(
        `INSERT INTO evaluation_results
           (result_id,case_id,primary_metric_id,metrics_json,primary_value_milli,delivery_json,
            instrument_status,rubric_counts_json,unused_category_checks_json,
            excluded_observations_json,agreement_json,limitations_json,result_hash,landed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.result_id,
        item.case_id,
        primaryMetricId,
        stableJson(metrics),
        primary.value_milli,
        stableJson(delivery),
        instrumentStatus,
        stableJson(rubricCounts),
        stableJson(unusedChecks),
        stableJson(exclusions),
        agreement ? stableJson(agreement) : null,
        stableJson(limitations),
        hash(result),
        landedBy,
      );
    ctx.db
      .prepare(
        "UPDATE evaluation_cases SET status='landed',landed_at=datetime('now') WHERE case_id=?",
      )
      .run(item.case_id);
    const remaining = ctx.db
      .prepare("SELECT COUNT(*) AS n FROM evaluation_cases WHERE program_id=? AND status!='landed'")
      .get(p.program_id) as { n: number };
    if (remaining.n === 0) {
      ctx.db
        .prepare("UPDATE evaluation_programs SET status='ready' WHERE program_id=?")
        .run(p.program_id);
    }
  })();
  return {
    case_id: item.case_id,
    result_id: result.result_id,
    instrument_status: instrumentStatus,
  };
}

function reviewAlternatives(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const reviewedBy = requireActiveSession(ctx, "review_evaluation_alternatives");
  const caseId = requireString(args, "case_id");
  evaluationCase(ctx, caseId);
  const alternatives = objects(args.alternatives, "alternatives").map((row) => ({
    explanation: requireString(row, "explanation"),
    disposition: requireEnum(row, "disposition", ["survives", "ruled-out", "unresolved"] as const),
    rationale: requireString(row, "rationale"),
  }));
  const evidence = strings(args.evidence, "evidence");
  const outcome = requireEnum(args, "outcome", [
    "survived",
    "explained-away",
    "underdetermined",
  ] as const);
  const reviewId = requireString(args, "review_id");
  ctx.db
    .prepare(
      `INSERT INTO evaluation_alternative_reviews
         (review_id,case_id,alternatives_json,evidence_json,outcome,limitation,reviewed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      reviewId,
      caseId,
      stableJson(alternatives),
      stableJson(evidence),
      outcome,
      requireString(args, "limitation"),
      reviewedBy,
    );
  return { review_id: reviewId, case_id: caseId, outcome };
}

function mean(values: number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function deriveEnvelope(
  ctx: ServerContext,
  p: ProgramRow,
  claims: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const manifest = JSON.parse(p.manifest_json) as Record<string, unknown>;
  const primaryId = String(manifest.primary_metric_id);
  const primarySpec = present(
    (manifest.metrics as Array<Record<string, unknown>>).find(
      (metric) => metric.metric_id === primaryId,
    ),
    "primary metric specification is absent",
  );
  const mde = Number(primarySpec.minimum_detectable_effect_milli);
  const step = Number(primarySpec.step_size_milli);
  const direction = String(primarySpec.direction);
  const cases = ctx.db
    .prepare(
      "SELECT * FROM evaluation_cases WHERE program_id=? ORDER BY stratum_id,condition_role,replicate_id",
    )
    .all(p.program_id) as CaseRow[];
  const results = ctx.db
    .prepare(
      `SELECT r.* FROM evaluation_results r JOIN evaluation_cases c ON c.case_id=r.case_id
        WHERE c.program_id=? ORDER BY c.stratum_id,c.condition_role,c.replicate_id`,
    )
    .all(p.program_id) as ResultRow[];
  const resultByCase = new Map(results.map((row) => [row.case_id, row]));
  const reviews = new Map(
    (
      ctx.db
        .prepare(
          `SELECT a.case_id,a.outcome FROM evaluation_alternative_reviews a
          JOIN evaluation_cases c ON c.case_id=a.case_id WHERE c.program_id=?`,
        )
        .all(p.program_id) as Array<{ case_id: string; outcome: string }>
    ).map((row) => [row.case_id, row.outcome]),
  );
  const strata = manifest.strata as Array<Record<string, unknown>>;
  const repositories = new Map(
    (manifest.repositories as Array<Record<string, unknown>>).map((row) => [
      String(row.repository_id),
      row,
    ]),
  );
  const stratumReports = strata.map((stratum) => {
    const stratumCases = cases.filter((item) => item.stratum_id === stratum.stratum_id);
    const roleValues = Object.fromEntries(
      ROLES.map((role) => [
        role,
        stratumCases
          .filter((item) => item.condition_role === role)
          .map((item) =>
            present(resultByCase.get(item.case_id), `missing result for ${item.case_id}`),
          )
          .map((result) => result.primary_value_milli),
      ]),
    ) as Record<(typeof ROLES)[number], number[]>;
    const means = Object.fromEntries(ROLES.map((role) => [role, mean(roleValues[role])])) as Record<
      (typeof ROLES)[number],
      number
    >;
    const instrumentFailures = stratumCases
      .map((item) => ({
        case_id: item.case_id,
        status: present(resultByCase.get(item.case_id), `missing result for ${item.case_id}`)
          .instrument_status,
      }))
      .filter((row) => row.status !== "valid");
    const effect =
      direction === "increase"
        ? means.treatment - means.baseline
        : means.baseline - means.treatment;
    const atLeastAsGood = (left: number, right: number) =>
      direction === "increase" ? left >= right : left <= right;
    const controlsOk =
      atLeastAsGood(means.baseline, means.null) &&
      atLeastAsGood(means["stronger-control"], means.treatment) &&
      atLeastAsGood(means.treatment, means.ablation) &&
      atLeastAsGood(means["sensitivity-add"], means.treatment) &&
      atLeastAsGood(means.treatment, means["sensitivity-remove"]);
    const stable = Math.abs(means.treatment - means["test-retest"]) <= Math.max(step, mde);
    const positive = instrumentFailures.length === 0 && effect >= mde && controlsOk && stable;
    const treatmentCases = stratumCases.filter((item) => item.condition_role === "treatment");
    const alternativeReviewOk = treatmentCases.every(
      (item) => reviews.get(item.case_id) === "survived",
    );
    let verdict: "supported" | "unsupported" | "undetermined-instrument" = "unsupported";
    if (instrumentFailures.length > 0) verdict = "undetermined-instrument";
    else if (positive && alternativeReviewOk) verdict = "supported";
    const repository = present(
      repositories.get(String(stratum.repository_id)),
      `missing repository for stratum ${stratum.stratum_id}`,
    );
    return {
      stratum_id: stratum.stratum_id,
      repository: repository,
      change_class: stratum.change_class,
      mode: stratum.mode,
      context_condition: stratum.context_condition,
      model_family: stratum.model_family,
      runtime_id: stratum.runtime_id,
      replicate_results: stratumCases.map((item) => {
        const result = present(
          resultByCase.get(item.case_id),
          `missing result for ${item.case_id}`,
        );
        return {
          case_id: item.case_id,
          replicate_id: item.replicate_id,
          condition_id: item.condition_id,
          condition_role: item.condition_role,
          primary_value_milli: result.primary_value_milli,
          metrics: JSON.parse(result.metrics_json),
          instrument_status: result.instrument_status,
          agreement: result.agreement_json ? JSON.parse(result.agreement_json) : null,
          excluded_observations: JSON.parse(result.excluded_observations_json),
          limitations: JSON.parse(result.limitations_json),
        };
      }),
      condition_means_milli: means,
      effect_milli: effect,
      mde_milli: mde,
      controls: {
        ok: controlsOk,
        test_retest_stable: stable,
        alternative_review_ok: alternativeReviewOk,
      },
      instrument_failures: instrumentFailures,
      verdict,
    };
  });
  return {
    schema_version: "1.0.0",
    program_id: p.program_id,
    manifest_hash: p.manifest_hash,
    reporting_unit: "repository × mode × context × model/runtime × replicate",
    pooled_efficacy_metric: null,
    claims,
    strata: stratumReports,
    operating_envelope: {
      supported_strata: stratumReports
        .filter((row) => row.verdict === "supported")
        .map((row) => row.stratum_id),
      undetermined_strata: stratumReports
        .filter((row) => row.verdict === "undetermined-instrument")
        .map((row) => row.stratum_id),
      unsupported_strata: stratumReports
        .filter((row) => row.verdict === "unsupported")
        .map((row) => row.stratum_id),
      unsupported_conditions: manifest.unsupported,
    },
    stopping_rules: manifest.stopping_rules,
  };
}

function parseClaims(value: unknown, stratumIds: string[]): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const claims = objects(value, "claims", stratumIds.length).map((row, index) => {
    const scopeKind = requireString(row, "scope_kind");
    if (scopeKind !== "stratum")
      throw new ToolError("pooled program-level efficacy claims are forbidden");
    const stratumId = requireString(row, "stratum_id");
    if (!stratumIds.includes(stratumId))
      throw new ToolError(`claims[${index}] names unknown stratum`);
    if (seen.has(stratumId)) throw new ToolError(`duplicate claim for stratum: ${stratumId}`);
    seen.add(stratumId);
    return {
      scope_kind: "stratum",
      stratum_id: stratumId,
      verdict: requireEnum(row, "verdict", [
        "supported",
        "unsupported",
        "undetermined-instrument",
      ] as const),
      statement: requireString(row, "statement"),
    };
  });
  if (stableJson([...seen].sort()) !== stableJson([...stratumIds].sort())) {
    throw new ToolError("claims must cover every stratum exactly once");
  }
  return claims.sort((left, right) =>
    String(left.stratum_id).localeCompare(String(right.stratum_id)),
  );
}

function publishEnvelope(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const publishedBy = requireActiveSession(ctx, "publish_operating_envelope");
  const p = program(ctx, requireString(args, "program_id"));
  if (p.status !== "ready") throw new ToolError(`evaluation program is ${p.status}`);
  const cases = ctx.db
    .prepare(
      "SELECT replicate_id,stratum_id FROM evaluation_cases WHERE program_id=? ORDER BY replicate_id",
    )
    .all(p.program_id) as Array<{ replicate_id: string; stratum_id: string }>;
  const expectedReplicates = cases.map((item) => item.replicate_id);
  if (args.replicate_assignments != null) {
    if (
      !Array.isArray(args.replicate_assignments) ||
      !args.replicate_assignments.every((item) => typeof item === "string")
    ) {
      throw new ToolError("replicate_assignments must be string[]");
    }
    const observed = args.replicate_assignments as string[];
    if (new Set(observed).size !== observed.length)
      throw new ToolError("replicate ID reuse is forbidden");
    if (stableJson([...observed].sort()) !== stableJson(expectedReplicates)) {
      throw new ToolError("replicate assignments do not exactly match the preregistered cases");
    }
  }
  const stratumIds = [...new Set(cases.map((item) => item.stratum_id))].sort();
  const claims = parseClaims(args.claims, stratumIds);
  const report = deriveEnvelope(ctx, p, claims);
  const derivedById = new Map(
    (report.strata as Array<Record<string, unknown>>).map((row) => [
      String(row.stratum_id),
      row.verdict,
    ]),
  );
  for (const claim of claims) {
    if (claim.verdict !== derivedById.get(String(claim.stratum_id))) {
      throw new ToolError(`claim for ${claim.stratum_id} conflicts with its unpooled verdict`);
    }
  }
  const envelope = report.operating_envelope as {
    supported_strata: string[];
    undetermined_strata: string[];
    unsupported_strata: string[];
  };
  const reportId = requireString(args, "report_id");
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO operating_envelope_reports
           (report_id,program_id,schema_version,report_json,report_hash,stratum_count,
            supported_count,undetermined_count,unsupported_count,published_by)
         VALUES (?, ?, '1.0.0', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reportId,
        p.program_id,
        stableJson(report),
        hash(report),
        stratumIds.length,
        envelope.supported_strata.length,
        envelope.undetermined_strata.length,
        envelope.unsupported_strata.length,
        publishedBy,
      );
    ctx.db
      .prepare(
        "UPDATE evaluation_programs SET status='published',published_at=datetime('now') WHERE program_id=?",
      )
      .run(p.program_id);
  })();
  return { report_id: reportId, report_hash: hash(report), report };
}

function verifyEnvelope(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const verifiedBy = requireActiveSession(ctx, "verify_operating_envelope");
  const reportId = requireString(args, "report_id");
  const stored = ctx.db
    .prepare("SELECT program_id,report_json FROM operating_envelope_reports WHERE report_id=?")
    .get(reportId) as { program_id: string; report_json: string } | undefined;
  if (!stored) throw new ToolError(`unknown operating envelope report: ${reportId}`);
  const storedReport = JSON.parse(stored.report_json) as Record<string, unknown>;
  const p = program(ctx, stored.program_id);
  const expected = deriveEnvelope(ctx, p, storedReport.claims as Array<Record<string, unknown>>);
  const actual = args.report ?? storedReport;
  const value =
    actual && typeof actual === "object" && !Array.isArray(actual)
      ? (actual as Record<string, unknown>)
      : {};
  const stateOk = value.schema_version === "1.0.0" && value.program_id === p.program_id;
  const coverageOk =
    Array.isArray(value.strata) &&
    value.strata.length === (expected.strata as unknown[]).length &&
    value.pooled_efficacy_metric === null;
  const contentOk = stableJson(value) === stableJson(expected);
  const report = {
    axes: {
      state: { ok: stateOk },
      coverage: { ok: coverageOk },
      content: { ok: contentOk, expected_hash: hash(expected), actual_hash: hash(value) },
    },
    ok: stateOk && coverageOk && contentOk,
  };
  ctx.db
    .prepare(
      `INSERT INTO operating_envelope_verifications
         (report_id,state_ok,coverage_ok,content_ok,ok,report_json,verified_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      reportId,
      stateOk ? 1 : 0,
      coverageOk ? 1 : 0,
      contentOk ? 1 : 0,
      report.ok ? 1 : 0,
      stableJson(report),
      verifiedBy,
    );
  return report;
}

function getProgram(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const p = program(ctx, requireString(args, "program_id"));
  const report = ctx.db
    .prepare("SELECT * FROM operating_envelope_reports WHERE program_id=?")
    .get(p.program_id) as (Record<string, unknown> & { report_json: string }) | undefined;
  return {
    ...p,
    manifest: JSON.parse(p.manifest_json),
    cases: ctx.db
      .prepare(
        "SELECT * FROM evaluation_cases WHERE program_id=? ORDER BY stratum_id,condition_role,replicate_id",
      )
      .all(p.program_id),
    report: report ? { ...report, report: JSON.parse(report.report_json) } : null,
  };
}

const stringArraySchema = { type: "array", minItems: 1, items: { type: "string", minLength: 1 } };

export const evaluationTools: ToolDefinition[] = [
  {
    name: "plan_evaluation_program",
    description:
      "Freeze a multi-repository operating-envelope program with at least two repository strata, explicit inclusion/exclusion and known outcomes, per-metric MDE/step/stopping rules, all eight control roles, at least two substrate-generated replicates per condition, rubric framing, and unsupported languages/scales/shapes/decision classes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["program_id", "manifest"],
      properties: {
        program_id: { type: "string", minLength: 1 },
        manifest: {
          type: "object",
          additionalProperties: false,
          required: [
            "repositories",
            "strata",
            "metrics",
            "primary_metric_id",
            "conditions",
            "replicates_per_condition",
            "stopping_rules",
            "unsupported",
            "rubric",
          ],
          properties: {
            repositories: { type: "array", minItems: 2, items: { type: "object" } },
            strata: { type: "array", minItems: 2, items: { type: "object" } },
            metrics: { type: "array", minItems: 1, items: { type: "object" } },
            primary_metric_id: { type: "string", enum: [...METRIC_IDS] },
            conditions: { type: "array", minItems: 8, items: { type: "object" } },
            replicates_per_condition: { type: "integer", minimum: 2 },
            stopping_rules: stringArraySchema,
            unsupported: { type: "object" },
            rubric: { type: "object" },
          },
        },
      },
    },
    handler: planProgram,
  },
  {
    name: "land_evaluation_result",
    description:
      "Land one preregistered replicate with exact metric denominators, excluded-observation custody, input/determinism delivery proof, baseline headroom, rubric-category exposure checks, limitations, and—when used—raw, chance, and chance-corrected agreement together. Negative observations with failed delivery or no headroom remain instrument-undetermined.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "result_id",
        "case_id",
        "metrics",
        "delivery",
        "rubric_counts",
        "unused_category_checks",
        "excluded_observations",
        "limitations",
      ],
      properties: {
        result_id: { type: "string", minLength: 1 },
        case_id: { type: "string", minLength: 1 },
        metrics: { type: "array", minItems: 1, items: { type: "object" } },
        delivery: { type: "object" },
        rubric_counts: { type: "object" },
        unused_category_checks: { type: "array", items: { type: "object" } },
        excluded_observations: { type: "array", items: { type: "object" } },
        agreement: { type: "object" },
        limitations: stringArraySchema,
      },
    },
    handler: landResult,
  },
  {
    name: "review_evaluation_alternatives",
    description:
      "Record an independent adversarial alternative-explanation pass for one valid landed treatment replicate. Positive operating-envelope support requires every treatment replicate's review to survive; explained-away and underdetermined reviews remain blocking.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["review_id", "case_id", "alternatives", "evidence", "outcome", "limitation"],
      properties: {
        review_id: { type: "string", minLength: 1 },
        case_id: { type: "string", minLength: 1 },
        alternatives: { type: "array", minItems: 1, items: { type: "object" } },
        evidence: stringArraySchema,
        outcome: { type: "string", enum: ["survived", "explained-away", "underdetermined"] },
        limitation: { type: "string", minLength: 1 },
      },
    },
    handler: reviewAlternatives,
  },
  {
    name: "publish_operating_envelope",
    description:
      "Publish only after exact multi-repository fan-in. Derive efficacy separately for every repository/mode/context/model-runtime stratum from baseline, null, stronger control, treatment, ablation, test-retest, and two-sided sensitivity replicates. Program-level pooled efficacy claims, duplicate replicate assignments, subgroup verdict overrides, and positive claims lacking survived alternative review are rejected.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["report_id", "program_id", "claims"],
      properties: {
        report_id: { type: "string", minLength: 1 },
        program_id: { type: "string", minLength: 1 },
        replicate_assignments: { type: "array", items: { type: "string", minLength: 1 } },
        claims: { type: "array", minItems: 2, items: { type: "object" } },
      },
    },
    handler: publishEnvelope,
  },
  {
    name: "verify_operating_envelope",
    description:
      "Re-derive a published operating envelope from durable per-replicate results and verify state, exact stratum coverage/no-pooling, and semantic content. A caller-supplied report is a validation-only fault-injection surface.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["report_id"],
      properties: { report_id: { type: "string", minLength: 1 }, report: { type: "object" } },
    },
    handler: verifyEnvelope,
  },
  {
    name: "get_evaluation_program",
    description:
      "Read one immutable evaluation manifest, every repository-stratified replicate and instrument state, plus the published evidence-backed operating envelope when present.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["program_id"],
      properties: { program_id: { type: "string", minLength: 1 } },
    },
    handler: getProgram,
  },
];
