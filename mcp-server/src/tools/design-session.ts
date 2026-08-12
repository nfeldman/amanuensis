import { createHash } from "node:crypto";
import {
  requireEnum,
  requireString,
  requireStringArray,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const LENSES = ["immanent", "adversarial", "speculative"] as const;
const CONDITIONS = ["clean", "marker-only", "treated", "null"] as const;
const PROFILE_BY_LENS = {
  immanent: "existing-trajectory",
  adversarial: "constraint-challenge",
  speculative: "adjacent-possible",
} as const;
const MODE_BY_LENS = {
  immanent: "review",
  adversarial: "design",
  speculative: "generative",
} as const;
const SECTIONS_BY_LENS = {
  immanent: ["facts", "direct_intent", "constraints", "changes", "gaps"],
  adversarial: ["facts", "constraints", "contradictions", "changes", "gaps"],
  speculative: ["direct_intent", "inferred_intent", "constraints", "changes", "options", "gaps"],
} as const;

type Lens = (typeof LENSES)[number];

interface Desire {
  desire_id: string;
  statement: string;
  priority: number | null;
  exclusive_group: string | null;
  source_ref: string;
}

interface LensSpec {
  lens: Lens;
  brief_id: string;
  provider: string;
  model: string;
  model_family: string;
}

interface OptionInput {
  option_key: string;
  summary: string;
  preserves: string[];
  rejects: string[];
  enables: string[];
  forecloses: string[];
  migration_cost: { level: "low" | "medium" | "high"; rationale: string };
  reversibility: {
    level: "reversible" | "partially-reversible" | "irreversible";
    conditions: string;
  };
  evidence_item_ids: string[];
  evidence_gaps: string[];
  falsifiers: string[];
  research_needs: string[];
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function allowedKeys(row: Record<string, unknown>, allowed: string[], path: string): void {
  const extra = Object.keys(row).filter((key) => !allowed.includes(key));
  if (extra.length > 0)
    throw new ToolError(`${path} contains forbidden fields: ${extra.join(", ")}`);
}

function stringArray(row: Record<string, unknown>, key: string, path: string): string[] {
  const value = row[key];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new ToolError(`${path}.${key} must be a string array`);
  }
  const unique = [...new Set(value as string[])];
  if (unique.length !== value.length) throw new ToolError(`${path}.${key} contains duplicates`);
  return unique.sort();
}

function parseDesires(value: unknown): Desire[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolError("desires must contain at least one human-origin desire");
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ToolError(`desires[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    allowedKeys(
      row,
      ["desire_id", "statement", "priority", "exclusive_group", "source_ref", "source_kind"],
      `desires[${index}]`,
    );
    if (row.source_kind !== "direct-user") {
      throw new ToolError(`desires[${index}].source_kind must be direct-user`);
    }
    const id = requireString(row, "desire_id");
    if (seen.has(id)) throw new ToolError(`duplicate desire_id: ${id}`);
    seen.add(id);
    const priority = row.priority == null ? null : Number(row.priority);
    if (priority !== null && (!Number.isInteger(priority) || priority < 1 || priority > 5)) {
      throw new ToolError(`desires[${index}].priority must be an integer from 1 to 5`);
    }
    const exclusive = row.exclusive_group == null ? null : String(row.exclusive_group);
    if (exclusive !== null && exclusive.length === 0) {
      throw new ToolError(`desires[${index}].exclusive_group must be non-empty or null`);
    }
    return {
      desire_id: id,
      statement: requireString(row, "statement"),
      priority,
      exclusive_group: exclusive,
      source_ref: requireString(row, "source_ref"),
    };
  });
}

function parseLensSpecs(value: unknown): LensSpec[] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new ToolError("lens_specs must contain exactly immanent, adversarial, and speculative");
  }
  const specs = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ToolError(`lens_specs[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    allowedKeys(
      row,
      ["lens", "brief_id", "provider", "model", "model_family"],
      `lens_specs[${index}]`,
    );
    return {
      lens: requireEnum(row, "lens", LENSES),
      brief_id: requireString(row, "brief_id"),
      provider: requireString(row, "provider"),
      model: requireString(row, "model"),
      model_family: requireString(row, "model_family"),
    };
  });
  if (
    [...new Set(specs.map((spec) => spec.lens))].sort().join("|") !== [...LENSES].sort().join("|")
  ) {
    throw new ToolError("lens_specs must name each required lens exactly once");
  }
  return specs;
}

function unresolvedDesires(desires: Desire[]): Array<Record<string, unknown>> {
  const groups = new Map<string, Desire[]>();
  for (const desire of desires) {
    if (!desire.exclusive_group) continue;
    const rows = groups.get(desire.exclusive_group) ?? [];
    rows.push(desire);
    groups.set(desire.exclusive_group, rows);
  }
  const unresolved: Array<Record<string, unknown>> = [];
  for (const [group, rows] of groups) {
    if (rows.length < 2) continue;
    const scored = rows.map((row) => ({ row, priority: row.priority ?? 0 }));
    const maximum = Math.max(...scored.map((item) => item.priority));
    const leaders = scored.filter((item) => item.priority === maximum);
    if (maximum === 0 || leaders.length !== 1) {
      unresolved.push({
        exclusive_group: group,
        desire_ids: rows.map((row) => row.desire_id).sort(),
        reason: "mutually exclusive desires have no unique human priority",
        missing_desire: `Choose or prioritize one desire in exclusive group ${group}.`,
      });
    }
  }
  return unresolved;
}

function getBrief(ctx: ServerContext, briefId: string): Record<string, unknown> {
  const row = ctx.db
    .prepare("SELECT brief_json FROM codebase_briefs WHERE brief_id=?")
    .get(briefId) as { brief_json: string } | undefined;
  if (!row) throw new ToolError(`unknown CodebaseBrief: ${briefId}`);
  return JSON.parse(row.brief_json) as Record<string, unknown>;
}

function controlledPacket(
  designSessionId: string,
  lens: Lens,
  brief: Record<string, unknown>,
  desires: Desire[],
): Record<string, unknown> {
  const sections = brief.sections as Record<string, unknown[]>;
  const includedSections = [...SECTIONS_BY_LENS[lens]];
  return {
    schema_version: 1,
    design_session_id: designSessionId,
    lens,
    mandate:
      lens === "immanent"
        ? "Recover and extend the architecture's existing trajectory without treating accidents as intent."
        : lens === "adversarial"
          ? "Try to overturn attractive options against constraints and evidence; retain what survives."
          : "Explore adjacent potential beyond the current trajectory while naming what would be foreclosed.",
    context_profile: PROFILE_BY_LENS[lens],
    source: brief.source,
    task: brief.task,
    desires,
    included_sections: includedSections,
    context: Object.fromEntries(
      includedSections.map((section) => [section, sections[section] ?? []]),
    ),
    output_contract: {
      minimum_options: 2,
      fields: [
        "preserves",
        "rejects",
        "enables",
        "forecloses",
        "migration_cost",
        "reversibility",
        "evidence_item_ids",
        "evidence_gaps",
        "falsifiers",
        "research_needs",
      ],
      authority: "advice-only",
    },
  };
}

function plan(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const plannedBy = requireActiveSession(ctx, "plan_design_session");
  const designSessionId = requireString(args, "design_session_id");
  if (
    ctx.db.prepare("SELECT 1 FROM design_sessions WHERE design_session_id=?").get(designSessionId)
  ) {
    throw new ToolError(`design session already exists: ${designSessionId}`);
  }
  const desires = parseDesires(args.desires);
  const specs = parseLensSpecs(args.lens_specs);
  const orchestratorFamily = requireString(args, "orchestrator_model_family");
  const families = new Set(specs.map((spec) => spec.model_family));
  if (families.size < 2 || [...families].every((family) => family === orchestratorFamily)) {
    throw new ToolError(
      "design panel requires at least two model families and one family different from the orchestrator",
    );
  }
  const briefRows = specs.map((spec) => ({ spec, brief: getBrief(ctx, spec.brief_id) }));
  const sourceIds = new Set(
    briefRows.map((row) => String((row.brief.source as Record<string, unknown>).source_id)),
  );
  const sourceHashes = new Set(
    briefRows.map((row) => String((row.brief.source as Record<string, unknown>).source_hash)),
  );
  if (sourceIds.size !== 1 || sourceHashes.size !== 1) {
    throw new ToolError("all design lenses must project the same immutable CodebaseBrief source");
  }
  for (const row of briefRows) {
    if (row.brief.mode !== MODE_BY_LENS[row.spec.lens]) {
      throw new ToolError(
        `${row.spec.lens} lens requires a ${MODE_BY_LENS[row.spec.lens]} CodebaseBrief`,
      );
    }
  }
  const conflicts = unresolvedDesires(desires);
  const planRecord = {
    schema_version: 1,
    design_session_id: designSessionId,
    source_id: [...sourceIds][0],
    source_hash: [...sourceHashes][0],
    desires,
    contradictions: conflicts,
    lens_manifest: specs.map((spec) => ({
      ...spec,
      context_profile: PROFILE_BY_LENS[spec.lens],
      expected_mode: MODE_BY_LENS[spec.lens],
    })),
    independence_contract: {
      dispatch_all_before_land: true,
      lens_outputs_in_packets: false,
      aggregation: "mechanical-after-exact-fan-in",
      deliberation_round: false,
    },
  };
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO design_sessions
           (design_session_id, source_id, source_hash, desire_count, conflict_count,
            orchestrator_model_family, plan_json, plan_hash, planned_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        designSessionId,
        [...sourceIds][0],
        [...sourceHashes][0],
        desires.length,
        conflicts.length,
        orchestratorFamily,
        stableJson(planRecord),
        hash(planRecord),
        plannedBy,
      );
    const desireInsert = ctx.db.prepare(
      `INSERT INTO design_desires
         (design_session_id, desire_id, statement, priority, exclusive_group, source_ref)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const desire of desires) {
      desireInsert.run(
        designSessionId,
        desire.desire_id,
        desire.statement,
        desire.priority,
        desire.exclusive_group,
        desire.source_ref,
      );
    }
    const lensInsert = ctx.db.prepare(
      `INSERT INTO design_lenses
         (design_session_id, lens, brief_id, provider, model, model_family,
          context_profile, packet_json, packet_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of briefRows) {
      const packet = controlledPacket(designSessionId, row.spec.lens, row.brief, desires);
      lensInsert.run(
        designSessionId,
        row.spec.lens,
        row.spec.brief_id,
        row.spec.provider,
        row.spec.model,
        row.spec.model_family,
        PROFILE_BY_LENS[row.spec.lens],
        stableJson(packet),
        hash(packet),
      );
    }
  })();
  return { plan: planRecord, underdetermination: conflicts };
}

function dispatch(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "dispatch_design_lens");
  const designSessionId = requireString(args, "design_session_id");
  const lens = requireEnum(args, "lens", LENSES);
  const row = ctx.db
    .prepare("SELECT * FROM design_lenses WHERE design_session_id=? AND lens=?")
    .get(designSessionId, lens) as
    | { status: string; packet_json: string; packet_hash: string }
    | undefined;
  if (!row) throw new ToolError(`unknown design lens: ${designSessionId}/${lens}`);
  if (row.status !== "planned") throw new ToolError(`design lens is ${row.status}`);
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `UPDATE design_lenses SET status='dispatched', observed_packet_hash=packet_hash,
          dispatched_at=datetime('now') WHERE design_session_id=? AND lens=?`,
      )
      .run(designSessionId, lens);
    ctx.db
      .prepare(
        `UPDATE design_sessions SET status='collecting'
          WHERE design_session_id=? AND status='planned'`,
      )
      .run(designSessionId);
  })();
  return { packet_hash: row.packet_hash, runtime_input: JSON.parse(row.packet_json) };
}

function parseOption(
  value: unknown,
  path: string,
  desireIds: Set<string>,
  visibleIds: Set<string>,
): OptionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError(`${path} must be an object`);
  }
  const row = value as Record<string, unknown>;
  allowedKeys(
    row,
    [
      "option_key",
      "summary",
      "preserves",
      "rejects",
      "enables",
      "forecloses",
      "migration_cost",
      "reversibility",
      "evidence_item_ids",
      "evidence_gaps",
      "falsifiers",
      "research_needs",
    ],
    path,
  );
  const preserves = stringArray(row, "preserves", path);
  const rejects = stringArray(row, "rejects", path);
  const unknownDesires = [...preserves, ...rejects].filter((id) => !desireIds.has(id));
  if (unknownDesires.length > 0)
    throw new ToolError(`${path} references unknown desires: ${unknownDesires.join(", ")}`);
  const overlap = preserves.filter((id) => rejects.includes(id));
  if (overlap.length > 0)
    throw new ToolError(`${path} both preserves and rejects: ${overlap.join(", ")}`);
  const evidenceIds = stringArray(row, "evidence_item_ids", path);
  const invisible = evidenceIds.filter((id) => !visibleIds.has(id));
  if (invisible.length > 0)
    throw new ToolError(`${path} cites context not visible to its lens: ${invisible.join(", ")}`);
  const migration = row.migration_cost;
  if (!migration || typeof migration !== "object" || Array.isArray(migration)) {
    throw new ToolError(`${path}.migration_cost must be an object`);
  }
  const migrationRow = migration as Record<string, unknown>;
  allowedKeys(migrationRow, ["level", "rationale"], `${path}.migration_cost`);
  const migrationLevel = requireEnum(migrationRow, "level", ["low", "medium", "high"] as const);
  const reversibility = row.reversibility;
  if (!reversibility || typeof reversibility !== "object" || Array.isArray(reversibility)) {
    throw new ToolError(`${path}.reversibility must be an object`);
  }
  const reversibilityRow = reversibility as Record<string, unknown>;
  allowedKeys(reversibilityRow, ["level", "conditions"], `${path}.reversibility`);
  const reversibilityLevel = requireEnum(reversibilityRow, "level", [
    "reversible",
    "partially-reversible",
    "irreversible",
  ] as const);
  return {
    option_key: requireString(row, "option_key"),
    summary: requireString(row, "summary"),
    preserves,
    rejects,
    enables: stringArray(row, "enables", path),
    forecloses: stringArray(row, "forecloses", path),
    migration_cost: {
      level: migrationLevel,
      rationale: requireString(migrationRow, "rationale"),
    },
    reversibility: {
      level: reversibilityLevel,
      conditions: requireString(reversibilityRow, "conditions"),
    },
    evidence_item_ids: evidenceIds,
    evidence_gaps: stringArray(row, "evidence_gaps", path),
    falsifiers: stringArray(row, "falsifiers", path),
    research_needs: stringArray(row, "research_needs", path),
  };
}

function visibleCandidateIds(packet: Record<string, unknown>): Set<string> {
  const context = packet.context as Record<string, unknown[]>;
  return new Set(
    Object.values(context)
      .flat()
      .map((item) => (item as Record<string, unknown>).candidate_id)
      .filter((id): id is string => typeof id === "string"),
  );
}

function land(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "land_design_lens");
  allowedKeys(
    args,
    [
      "design_session_id",
      "lens",
      "options",
      "preferred_option_key",
      "analysis",
      "detected_contradictions",
    ],
    "landing",
  );
  const designSessionId = requireString(args, "design_session_id");
  const lens = requireEnum(args, "lens", LENSES);
  const row = ctx.db
    .prepare("SELECT * FROM design_lenses WHERE design_session_id=? AND lens=?")
    .get(designSessionId, lens) as
    | { status: string; packet_json: string; packet_hash: string; observed_packet_hash: string }
    | undefined;
  if (!row) throw new ToolError(`unknown design lens: ${designSessionId}/${lens}`);
  if (row.status !== "dispatched") throw new ToolError(`design lens is ${row.status}`);
  const dispatchedCount = Number(
    (
      ctx.db
        .prepare(
          "SELECT COUNT(*) AS n FROM design_lenses WHERE design_session_id=? AND status IN ('dispatched','landed')",
        )
        .get(designSessionId) as { n: number }
    ).n,
  );
  if (dispatchedCount !== 3) {
    throw new ToolError(
      "all three independent lens packets must dispatch before any output may land",
    );
  }
  if (!Array.isArray(args.options) || args.options.length < 2) {
    throw new ToolError("each lens must furnish at least two architecture options");
  }
  const desires = ctx.db
    .prepare("SELECT * FROM design_desires WHERE design_session_id=? ORDER BY desire_id")
    .all(designSessionId) as Desire[];
  const desireIds = new Set(desires.map((desire) => desire.desire_id));
  const packet = JSON.parse(row.packet_json) as Record<string, unknown>;
  const visibleIds = visibleCandidateIds(packet);
  const options = args.options.map((option, index) =>
    parseOption(option, `options[${index}]`, desireIds, visibleIds),
  );
  const optionKeys = options.map((option) => option.option_key);
  if (new Set(optionKeys).size !== optionKeys.length)
    throw new ToolError("option_key must be unique within a lens");
  const preferred = requireString(args, "preferred_option_key");
  if (!optionKeys.includes(preferred))
    throw new ToolError("preferred_option_key must name one furnished option");
  const contradictions = args.detected_contradictions ?? [];
  if (!Array.isArray(contradictions))
    throw new ToolError("detected_contradictions must be an array");
  const output = {
    schema_version: 1,
    lens,
    options,
    preferred_option_key: preferred,
    analysis: requireString(args, "analysis"),
    detected_contradictions: contradictions,
    authority: "advice-only",
  };
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `UPDATE design_lenses SET status='landed', output_json=?, output_hash=?,
          landed_at=datetime('now') WHERE design_session_id=? AND lens=?`,
      )
      .run(stableJson(output), hash(output), designSessionId, lens);
    const insert = ctx.db.prepare(
      `INSERT INTO design_options
         (design_session_id, lens, option_key, summary, preserves_json, rejects_json,
          enables_json, forecloses_json, migration_cost_json, reversibility_json,
          evidence_item_ids_json, evidence_gaps_json, falsifiers_json,
          research_needs_json, constraint_preservation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const option of options) {
      insert.run(
        designSessionId,
        lens,
        option.option_key,
        option.summary,
        JSON.stringify(option.preserves),
        JSON.stringify(option.rejects),
        JSON.stringify(option.enables),
        JSON.stringify(option.forecloses),
        stableJson(option.migration_cost),
        stableJson(option.reversibility),
        JSON.stringify(option.evidence_item_ids),
        JSON.stringify(option.evidence_gaps),
        JSON.stringify(option.falsifiers),
        JSON.stringify(option.research_needs),
        option.preserves.length / desires.length,
      );
    }
    const landedCount = Number(
      (
        ctx.db
          .prepare(
            "SELECT COUNT(*) AS n FROM design_lenses WHERE design_session_id=? AND status='landed'",
          )
          .get(designSessionId) as { n: number }
      ).n,
    );
    if (landedCount === 3) {
      ctx.db
        .prepare("UPDATE design_sessions SET status='ready-to-aggregate' WHERE design_session_id=?")
        .run(designSessionId);
    }
  })();
  return output;
}

function parseStoredOption(row: Record<string, unknown>): Record<string, unknown> {
  return {
    lens: row.lens,
    option_key: row.option_key,
    summary: row.summary,
    preserves: JSON.parse(String(row.preserves_json)),
    rejects: JSON.parse(String(row.rejects_json)),
    enables: JSON.parse(String(row.enables_json)),
    forecloses: JSON.parse(String(row.forecloses_json)),
    migration_cost: JSON.parse(String(row.migration_cost_json)),
    reversibility: JSON.parse(String(row.reversibility_json)),
    evidence_item_ids: JSON.parse(String(row.evidence_item_ids_json)),
    evidence_gaps: JSON.parse(String(row.evidence_gaps_json)),
    falsifiers: JSON.parse(String(row.falsifiers_json)),
    research_needs: JSON.parse(String(row.research_needs_json)),
    constraint_preservation: row.constraint_preservation,
  };
}

function aggregationMatrix(
  options: Array<Record<string, unknown>>,
  outputs: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const keys = [...new Set(options.map((option) => String(option.option_key)))].sort();
  const matrixOptions = keys.map((optionKey) => {
    const contributions = options.filter((option) => option.option_key === optionKey);
    const supporting = outputs
      .filter((output) => output.preferred_option_key === optionKey)
      .map((output) => String(output.lens))
      .sort();
    return {
      option_key: optionKey,
      summaries: contributions.map((option) => ({ lens: option.lens, summary: option.summary })),
      contributions,
      supporting_lenses: supporting,
    };
  });
  const preferences = outputs.map((output) => ({
    lens: output.lens,
    option_key: output.preferred_option_key,
  }));
  const disagreements: Array<Record<string, unknown>> = [];
  if (new Set(preferences.map((row) => row.option_key)).size > 1) {
    disagreements.push({
      disagreement_id: "preferred-option",
      kind: "preferred-option",
      positions: preferences,
      lanes: preferences.map((row) => row.lens),
    });
  }
  for (const option of matrixOptions) {
    const contributions = option.contributions as Array<Record<string, unknown>>;
    if (contributions.length < 2) continue;
    for (const field of [
      "preserves",
      "rejects",
      "enables",
      "forecloses",
      "migration_cost",
      "reversibility",
    ]) {
      const variants = new Set(contributions.map((row) => stableJson(row[field])));
      if (variants.size > 1) {
        disagreements.push({
          disagreement_id: `${option.option_key}:${field}`,
          kind: "option-field",
          option_key: option.option_key,
          field,
          positions: contributions.map((row) => ({ lens: row.lens, value: row[field] })),
          lanes: contributions.map((row) => row.lens),
        });
      }
    }
  }
  return { options: matrixOptions, disagreements };
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))].sort();
}

function aggregate(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const aggregatedBy = requireActiveSession(ctx, "aggregate_design_session");
  const designSessionId = requireString(args, "design_session_id");
  const session = ctx.db
    .prepare("SELECT * FROM design_sessions WHERE design_session_id=?")
    .get(designSessionId) as { status: string } | undefined;
  if (!session) throw new ToolError(`unknown design session: ${designSessionId}`);
  if (session.status !== "ready-to-aggregate")
    throw new ToolError(`design session is ${session.status}`);
  const desires = ctx.db
    .prepare("SELECT * FROM design_desires WHERE design_session_id=? ORDER BY desire_id")
    .all(designSessionId) as Desire[];
  const lensRows = ctx.db
    .prepare("SELECT lens, output_json FROM design_lenses WHERE design_session_id=? ORDER BY lens")
    .all(designSessionId) as Array<{ lens: string; output_json: string }>;
  if (lensRows.length !== 3 || lensRows.some((row) => !row.output_json)) {
    throw new ToolError("design aggregation requires exact three-lens fan-in");
  }
  const outputs = lensRows.map((row) => JSON.parse(row.output_json) as Record<string, unknown>);
  const options = (
    ctx.db
      .prepare("SELECT * FROM design_options WHERE design_session_id=? ORDER BY option_key, lens")
      .all(designSessionId) as Array<Record<string, unknown>>
  ).map(parseStoredOption);
  const matrix = aggregationMatrix(options, outputs);
  const missingDesires = unresolvedDesires(desires);
  const votes = new Map<string, number>();
  for (const output of outputs) {
    const key = String(output.preferred_option_key);
    votes.set(key, (votes.get(key) ?? 0) + 1);
  }
  const ranked = [...votes.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const leader = ranked[0];
  let leanKey = leader && leader[1] >= 2 && leader[1] > (ranked[1]?.[1] ?? 0) ? leader[0] : null;
  if (!leanKey) {
    missingDesires.push({
      reason: "no architecture option has an independent strict majority",
      missing_desire: "Supply a priority or discriminating constraint between the leading options.",
      option_keys: ranked.map(([key]) => key),
    });
  }
  const maximumPriority = Math.max(...desires.map((desire) => desire.priority ?? 0));
  const decisiveDesires = new Set(
    desires
      .filter((desire) => (desire.priority ?? 0) === maximumPriority && maximumPriority > 0)
      .map((desire) => desire.desire_id),
  );
  const leanContributions = leanKey
    ? options.filter((option) => option.option_key === leanKey)
    : [];
  if (
    leanKey &&
    leanContributions.some((option) =>
      (option.rejects as string[]).some((desireId) => decisiveDesires.has(desireId)),
    )
  ) {
    missingDesires.push({
      reason: "leading option rejects a highest-priority desire in at least one independent lens",
      missing_desire: `Resolve whether ${leanKey} may reject the disputed high-priority desire.`,
    });
    leanKey = null;
  }
  if (missingDesires.length > 0) leanKey = null;
  const leanContributionsFinal = leanKey
    ? options.filter((option) => option.option_key === leanKey)
    : [];
  const evidence = uniqueStrings(
    leanContributionsFinal.flatMap((option) => option.evidence_item_ids as string[]),
  );
  if (leanKey && evidence.length === 0) {
    missingDesires.push({
      reason: "leading option has no decisive evidence",
      missing_desire: `Collect evidence capable of discriminating ${leanKey}.`,
    });
    leanKey = null;
  }
  const disagreements = matrix.disagreements as Array<Record<string, unknown>>;
  const lean = leanKey
    ? {
        option_key: leanKey,
        authority: "advice-only",
        decision_status: "unaccepted",
        decisive_evidence: evidence,
        surviving_disagreements: disagreements.filter(
          (row) => row.option_key === leanKey || row.kind === "preferred-option",
        ),
        falsifiers: uniqueStrings(
          leanContributionsFinal.flatMap((option) => option.falsifiers as string[]),
        ),
        research_needs: uniqueStrings(
          leanContributionsFinal.flatMap((option) => option.research_needs as string[]),
        ),
      }
    : null;
  const status = lean ? "qualified" : "underdetermined";
  const result = {
    schema_version: 1,
    design_session_id: designSessionId,
    status,
    matrix,
    lean,
    missing_desires: missingDesires,
    fan_in: { expected: 3, dispatched: 3, landed: 3, aggregated: 3 },
    authority: {
      furnished: "architecture advice",
      accepted_decision: false,
      acceptance_requires: "authorized A12 acceptance event",
    },
  };
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO design_aggregations
           (design_session_id, status, option_count, disagreement_count, matrix_json,
            lean_json, missing_desires_json, result_json, result_hash, aggregated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        designSessionId,
        status,
        (matrix.options as unknown[]).length,
        disagreements.length,
        stableJson(matrix),
        lean ? stableJson(lean) : null,
        stableJson(missingDesires),
        stableJson(result),
        hash(result),
        aggregatedBy,
      );
    ctx.db
      .prepare(
        `UPDATE design_sessions SET status=?, completed_at=datetime('now')
          WHERE design_session_id=?`,
      )
      .run(status === "qualified" ? "aggregated" : "underdetermined", designSessionId);
  })();
  return result;
}

function anonymizeMatrix(
  matrix: Record<string, unknown>,
  blindLabel: string,
): Record<string, unknown> {
  const alias = (lens: unknown) =>
    `lane-${createHash("sha256")
      .update(`${blindLabel}\0${String(lens)}`)
      .digest("hex")
      .slice(0, 8)}`;
  const copy = structuredClone(matrix) as {
    options: Array<Record<string, unknown>>;
    disagreements: Array<Record<string, unknown>>;
  };
  for (const option of copy.options) {
    option.summaries = (option.summaries as Array<Record<string, unknown>>).map((row) => ({
      lane: alias(row.lens),
      summary: row.summary,
    }));
    option.contributions = (option.contributions as Array<Record<string, unknown>>).map((row) => {
      const { lens, ...rest } = row;
      return { lane: alias(lens), ...rest };
    });
    option.supporting_lanes = (option.supporting_lenses as unknown[]).map(alias).sort();
    delete option.supporting_lenses;
  }
  copy.disagreements = copy.disagreements.map((row) => {
    const result = { ...row };
    if (Array.isArray(result.positions)) {
      result.positions = (result.positions as Array<Record<string, unknown>>).map((position) => {
        const { lens, ...rest } = position;
        return { lane: alias(lens), ...rest };
      });
    }
    result.lanes = Array.isArray(result.lanes) ? (result.lanes as unknown[]).map(alias).sort() : [];
    return result;
  });
  return copy;
}

function prepareEvaluationPacket(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const preparedBy = requireActiveSession(ctx, "prepare_design_evaluation_packet");
  const packetId = requireString(args, "packet_id");
  const designSessionId = requireString(args, "design_session_id");
  const condition = requireEnum(args, "condition", CONDITIONS);
  const replicateId = requireString(args, "replicate_id");
  const blindLabel = requireString(args, "blind_label");
  const canaryTerms = requireStringArray(args, "content_canary_terms", { minLength: 1 });
  const aggregation = ctx.db
    .prepare("SELECT result_json FROM design_aggregations WHERE design_session_id=?")
    .get(designSessionId) as { result_json: string } | undefined;
  if (!aggregation) throw new ToolError("design evaluation requires a terminal aggregation");
  const result = JSON.parse(aggregation.result_json) as Record<string, unknown>;
  if (condition === "null" && result.status !== "underdetermined") {
    throw new ToolError("null evaluation condition requires an underdetermined design artifact");
  }
  if (condition !== "null" && result.status !== "qualified") {
    throw new ToolError(`${condition} evaluation condition requires a qualified design artifact`);
  }
  const packet = {
    schema_version: 1,
    blind_label: blindLabel,
    artifact: {
      status: result.status,
      matrix: anonymizeMatrix(result.matrix as Record<string, unknown>, blindLabel),
      lean: result.lean
        ? Object.fromEntries(
            Object.entries(result.lean as Record<string, unknown>).filter(
              ([key]) => key !== "surviving_disagreements",
            ),
          )
        : null,
      missing_desires: result.missing_desires,
    },
    scoring_contract: {
      assess: [
        "constraint-preservation",
        "meaningful-disagreement-retention",
        "evidence-custody",
        "qualified-or-underdetermined",
      ],
      do_not_infer_condition: true,
    },
  };
  const payload = stableJson(packet).toLowerCase();
  const leaked = canaryTerms.filter((term) => payload.includes(term.toLowerCase()));
  if (leaked.length > 0) {
    throw new ToolError(`design evaluation content canary leaked: ${leaked.join(", ")}`);
  }
  ctx.db
    .prepare(
      `INSERT INTO design_evaluation_packets
         (packet_id, design_session_id, condition, replicate_id, blind_label,
          packet_json, packet_hash, canary_terms_json, content_canary_ok, prepared_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(
      packetId,
      designSessionId,
      condition,
      replicateId,
      blindLabel,
      stableJson(packet),
      hash(packet),
      JSON.stringify(canaryTerms),
      preparedBy,
    );
  return { packet_id: packetId, packet_hash: hash(packet), evaluation_input: packet };
}

function getSession(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const designSessionId = requireString(args, "design_session_id");
  const session = ctx.db
    .prepare("SELECT * FROM design_sessions WHERE design_session_id=?")
    .get(designSessionId) as (Record<string, unknown> & { plan_json: string }) | undefined;
  if (!session) throw new ToolError(`unknown design session: ${designSessionId}`);
  const lenses = ctx.db
    .prepare("SELECT * FROM design_lenses WHERE design_session_id=? ORDER BY lens")
    .all(designSessionId) as Array<
    Record<string, unknown> & { packet_json: string; output_json: string | null }
  >;
  const aggregation = ctx.db
    .prepare("SELECT * FROM design_aggregations WHERE design_session_id=?")
    .get(designSessionId) as (Record<string, unknown> & { result_json: string }) | undefined;
  return {
    ...session,
    plan: JSON.parse(session.plan_json),
    desires: ctx.db
      .prepare("SELECT * FROM design_desires WHERE design_session_id=? ORDER BY desire_id")
      .all(designSessionId),
    lenses: lenses.map((row) => ({
      ...row,
      packet: JSON.parse(row.packet_json),
      output: row.output_json ? JSON.parse(row.output_json) : null,
    })),
    aggregation: aggregation
      ? { ...aggregation, result: JSON.parse(aggregation.result_json) }
      : null,
    evaluation_packets: ctx.db
      .prepare(
        `SELECT packet_id, blind_label, replicate_id, packet_hash, content_canary_ok, prepared_at
           FROM design_evaluation_packets WHERE design_session_id=? ORDER BY packet_id`,
      )
      .all(designSessionId),
  };
}

const lensSpecSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lens", "brief_id", "provider", "model", "model_family"],
  properties: {
    lens: { type: "string", enum: [...LENSES] },
    brief_id: { type: "string", minLength: 1 },
    provider: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    model_family: { type: "string", minLength: 1 },
  },
};

const optionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "option_key",
    "summary",
    "preserves",
    "rejects",
    "enables",
    "forecloses",
    "migration_cost",
    "reversibility",
    "evidence_item_ids",
    "evidence_gaps",
    "falsifiers",
    "research_needs",
  ],
  properties: {
    option_key: { type: "string", minLength: 1 },
    summary: { type: "string", minLength: 1 },
    preserves: { type: "array", items: { type: "string", minLength: 1 } },
    rejects: { type: "array", items: { type: "string", minLength: 1 } },
    enables: { type: "array", items: { type: "string", minLength: 1 } },
    forecloses: { type: "array", items: { type: "string", minLength: 1 } },
    migration_cost: {
      type: "object",
      additionalProperties: false,
      required: ["level", "rationale"],
      properties: {
        level: { type: "string", enum: ["low", "medium", "high"] },
        rationale: { type: "string", minLength: 1 },
      },
    },
    reversibility: {
      type: "object",
      additionalProperties: false,
      required: ["level", "conditions"],
      properties: {
        level: { type: "string", enum: ["reversible", "partially-reversible", "irreversible"] },
        conditions: { type: "string", minLength: 1 },
      },
    },
    evidence_item_ids: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    evidence_gaps: { type: "array", items: { type: "string", minLength: 1 } },
    falsifiers: { type: "array", items: { type: "string", minLength: 1 } },
    research_needs: { type: "array", items: { type: "string", minLength: 1 } },
  },
};

export const designSessionTools: ToolDefinition[] = [
  {
    name: "plan_design_session",
    description:
      "Plan exactly three independent immanent, adversarial, and speculative architecture lenses over review/design/generative projections of one CodebaseBrief source. Human-origin desires, exclusive conflicts, context profiles, model-family diversity, and no-deliberation fan-in are frozen before dispatch.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["design_session_id", "desires", "lens_specs", "orchestrator_model_family"],
      properties: {
        design_session_id: { type: "string", minLength: 1 },
        desires: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["desire_id", "statement", "source_kind", "source_ref"],
            properties: {
              desire_id: { type: "string", minLength: 1 },
              statement: { type: "string", minLength: 1 },
              priority: { type: "integer", minimum: 1, maximum: 5 },
              exclusive_group: { type: "string", minLength: 1 },
              source_kind: { type: "string", const: "direct-user" },
              source_ref: { type: "string", minLength: 1 },
            },
          },
        },
        lens_specs: { type: "array", minItems: 3, maxItems: 3, items: lensSpecSchema },
        orchestrator_model_family: { type: "string", minLength: 1 },
      },
    },
    handler: plan,
  },
  {
    name: "dispatch_design_lens",
    description:
      "Dispatch one frozen design-lens packet. Packets contain only that lens's controlled CodebaseBrief sections and human-origin desires, never another lens output; all three must dispatch before any can land.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["design_session_id", "lens"],
      properties: {
        design_session_id: { type: "string", minLength: 1 },
        lens: { type: "string", enum: [...LENSES] },
      },
    },
    handler: dispatch,
  },
  {
    name: "land_design_lens",
    description:
      "Land one independent lens's option matrix contribution. Every option names what it preserves, rejects, enables, and forecloses plus migration cost, reversibility, visible evidence, gaps, falsifiers, and research needs. Decision or acceptance fields are forbidden.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "design_session_id",
        "lens",
        "options",
        "preferred_option_key",
        "analysis",
        "detected_contradictions",
      ],
      properties: {
        design_session_id: { type: "string", minLength: 1 },
        lens: { type: "string", enum: [...LENSES] },
        options: { type: "array", minItems: 2, items: optionSchema },
        preferred_option_key: { type: "string", minLength: 1 },
        analysis: { type: "string", minLength: 1 },
        detected_contradictions: { type: "array", items: { type: "object" } },
      },
    },
    handler: land,
  },
  {
    name: "aggregate_design_session",
    description:
      "Mechanically aggregate exact three-lens fan-in without a deliberation round. Preserve option-field and preference disagreements; furnish an advice-only lean only with an independent strict majority, decisive evidence, and no unresolved mutually exclusive or highest-priority desire.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["design_session_id"],
      properties: { design_session_id: { type: "string", minLength: 1 } },
    },
    handler: aggregate,
  },
  {
    name: "prepare_design_evaluation_packet",
    description:
      "Create a content-checked blind evaluation packet for clean, marker-only, treated, or null design artifacts. The returned packet omits condition, session, lens, provider, and model identities; lens contributions are anonymously relabeled and surviving canary terms halt delivery.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "packet_id",
        "design_session_id",
        "condition",
        "replicate_id",
        "blind_label",
        "content_canary_terms",
      ],
      properties: {
        packet_id: { type: "string", minLength: 1 },
        design_session_id: { type: "string", minLength: 1 },
        condition: { type: "string", enum: [...CONDITIONS] },
        replicate_id: { type: "string", minLength: 1 },
        blind_label: { type: "string", minLength: 1 },
        content_canary_terms: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        },
      },
    },
    handler: prepareEvaluationPacket,
  },
  {
    name: "get_design_session",
    description:
      "Read a design session's immutable desire and lens manifests, controlled packets, independent outputs, preserved disagreements, option matrix, advice-only or underdetermined result, and blinded evaluation-packet metadata.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["design_session_id"],
      properties: { design_session_id: { type: "string", minLength: 1 } },
    },
    handler: getSession,
  },
];
