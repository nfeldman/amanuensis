import {
  BRIEF_MODES,
  type BriefCandidate,
  type BriefMode,
  type BriefSection,
  CODEBASE_BRIEF_SCHEMA_VERSION,
  type CodebaseBrief,
  type CodebaseBriefSource,
  compileBrief,
  contentHash,
  type EpistemicKind,
  finalizeCandidate,
  finalizeSource,
  validateCodebaseBrief,
} from "../codebase-brief-contract.js";
import {
  optInt,
  optString,
  optStringArray,
  requireEnum,
  requireString,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

interface ReviewSessionRow {
  review_session_id: string;
  reviewed_sha: string;
  status: string;
}

interface ReviewItemRow {
  item_id: string;
  section: string;
  semantic_state: string;
  epistemic_kind: string;
  statement: string;
  source_type: string;
  source_id: string;
  record_uri: string;
}

interface ConstraintInput {
  constraint_id: string;
  statement: string;
  source_kind: string;
  source_ref: string;
}

interface DerivedInput {
  id: string;
  statement: string;
  source_item_ids: string[];
  relevance_terms: string[];
}

function getSource(ctx: ServerContext, sourceId: string): CodebaseBriefSource {
  const row = ctx.db
    .prepare("SELECT source_json FROM codebase_brief_sources WHERE source_id=?")
    .get(sourceId) as { source_json: string } | undefined;
  if (!row) throw new ToolError(`unknown CodebaseBrief source: ${sourceId}`);
  return JSON.parse(row.source_json) as CodebaseBriefSource;
}

function parseConstraints(value: unknown): ConstraintInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolError("constraints must contain at least one typed constraint");
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ToolError(`constraints[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const id = requireString(row, "constraint_id");
    if (seen.has(id)) throw new ToolError(`duplicate constraint_id: ${id}`);
    seen.add(id);
    const sourceKind = requireString(row, "source_kind");
    if (!["direct-user", "repository-contract", "issue", "adr"].includes(sourceKind)) {
      throw new ToolError(`constraints[${index}].source_kind is invalid`);
    }
    return {
      constraint_id: id,
      statement: requireString(row, "statement"),
      source_kind: sourceKind,
      source_ref: requireString(row, "source_ref"),
    };
  });
}

function parseDerived(value: unknown, field: string): DerivedInput[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ToolError(`${field} must be an array`);
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ToolError(`${field}[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const id = requireString(row, "id");
    if (seen.has(id)) throw new ToolError(`duplicate ${field} id: ${id}`);
    seen.add(id);
    const sourceIds = row.source_item_ids;
    if (
      !Array.isArray(sourceIds) ||
      sourceIds.length === 0 ||
      sourceIds.some((item) => typeof item !== "string")
    ) {
      throw new ToolError(`${field}[${index}].source_item_ids must be a non-empty string array`);
    }
    const terms = row.relevance_terms;
    if (
      terms != null &&
      (!Array.isArray(terms) || terms.some((item) => typeof item !== "string"))
    ) {
      throw new ToolError(`${field}[${index}].relevance_terms must be a string array`);
    }
    return {
      id,
      statement: requireString(row, "statement"),
      source_item_ids: [...new Set(sourceIds as string[])].sort(),
      relevance_terms: [...new Set((terms as string[] | undefined) ?? [])].sort(),
    };
  });
}

function sectionFor(item: ReviewItemRow): BriefSection {
  if (item.semantic_state === "changed") return "changes";
  if (item.section === "challenges") return "contradictions";
  if (["stale-knowledge", "open-obligations", "unknowns"].includes(item.section)) return "gaps";
  return "facts";
}

function modesFor(item: ReviewItemRow): BriefMode[] {
  if (item.section === "history") return ["review"];
  if (item.section === "challenges") return ["review", "design"];
  return [...BRIEF_MODES];
}

function epistemicKind(item: ReviewItemRow): EpistemicKind {
  if (item.epistemic_kind === "open-question") return "open-question";
  if (item.epistemic_kind === "observation") return "observed-behavior";
  return "inference";
}

function validityFor(item: ReviewItemRow, reviewedSha: string, ctx: ServerContext) {
  let validFrom: string | null = null;
  let validUntil: string | null = null;
  if (item.source_type === "claim") {
    const claim = ctx.db
      .prepare("SELECT valid_from_sha, valid_until_sha FROM claims WHERE claim_id=?")
      .get(item.source_id) as
      | { valid_from_sha: string; valid_until_sha: string | null }
      | undefined;
    validFrom = claim?.valid_from_sha ?? null;
    validUntil = claim?.valid_until_sha ?? null;
  } else if (item.source_type === "finding") {
    const finding = ctx.db
      .prepare("SELECT ref_sha FROM findings WHERE finding_id=?")
      .get(item.source_id) as { ref_sha: string | null } | undefined;
    validFrom = finding?.ref_sha ?? null;
  }
  const status =
    item.semantic_state === "stale-claim"
      ? "stale"
      : item.section === "history"
        ? "historical"
        : ["unknown", "unverified-suspicion"].includes(item.semantic_state)
          ? "unknown"
          : "current";
  return {
    status,
    as_of_sha: reviewedSha,
    valid_from_sha: validFrom,
    valid_until_sha: validUntil,
  } as const;
}

function evidenceProvenance(ctx: ServerContext, reviewSessionId: string, itemId: string) {
  return (
    ctx.db
      .prepare(
        `SELECT e.id, e.ref_sha FROM review_session_item_evidence l
          JOIN evidence e ON e.id=l.evidence_id
         WHERE l.review_session_id=? AND l.item_id=? ORDER BY e.id`,
      )
      .all(reviewSessionId, itemId) as Array<{ id: number; ref_sha: string }>
  ).map((row) => ({ kind: "evidence" as const, ref: `evidence:${row.id}`, sha: row.ref_sha }));
}

function prepareSource(args: Record<string, unknown>, ctx: ServerContext): CodebaseBriefSource {
  const preparedBy = requireActiveSession(ctx, "prepare_codebase_brief_source");
  const sourceId = requireString(args, "source_id");
  if (ctx.db.prepare("SELECT 1 FROM codebase_brief_sources WHERE source_id=?").get(sourceId)) {
    throw new ToolError(`CodebaseBrief source already exists: ${sourceId}`);
  }
  const reviewSessionId = requireString(args, "review_session_id");
  const review = ctx.db
    .prepare(
      "SELECT review_session_id, reviewed_sha, status FROM review_sessions WHERE review_session_id=?",
    )
    .get(reviewSessionId) as ReviewSessionRow | undefined;
  if (!review) throw new ToolError(`unknown review session: ${reviewSessionId}`);
  const objective = requireString(args, "objective");
  const constraints = parseConstraints(args.constraints);
  const inferredIntents = parseDerived(args.inferred_intents, "inferred_intents");
  const options = parseDerived(args.options, "options");
  const reviewItems = ctx.db
    .prepare("SELECT * FROM review_session_items WHERE review_session_id=? ORDER BY ordinal")
    .all(reviewSessionId) as ReviewItemRow[];
  const knownReviewIds = new Set(reviewItems.map((item) => item.item_id));
  for (const entry of [...inferredIntents, ...options]) {
    const missing = entry.source_item_ids.filter((id) => !knownReviewIds.has(id));
    if (missing.length > 0)
      throw new ToolError(`${entry.id} references unknown review items: ${missing.join(", ")}`);
  }
  const candidates: BriefCandidate[] = [];
  candidates.push(
    finalizeCandidate({
      candidate_id: `${sourceId}:direct-intent:objective`,
      category: "direct_intent",
      epistemic_kind: "direct-intent",
      statement: objective,
      source: {
        record_uri: `amanuensis://codebase-brief-source/${encodeURIComponent(sourceId)}/objective`,
        source_type: "direct-user",
        source_id: "objective",
      },
      provenance: [
        { kind: "direct-user", ref: "prepare_codebase_brief_source.objective", sha: null },
      ],
      validity: {
        status: "current",
        as_of_sha: review.reviewed_sha,
        valid_from_sha: null,
        valid_until_sha: null,
      },
      required: true,
      modes: [...BRIEF_MODES],
      relevance_terms: ["objective", "task"],
    }),
  );
  for (const constraint of constraints) {
    candidates.push(
      finalizeCandidate({
        candidate_id: `${sourceId}:constraint:${constraint.constraint_id}`,
        category: "constraints",
        epistemic_kind:
          constraint.source_kind === "direct-user" ? "direct-intent" : "observed-behavior",
        statement: constraint.statement,
        source: {
          record_uri: `amanuensis://constraint/${encodeURIComponent(constraint.constraint_id)}`,
          source_type: constraint.source_kind,
          source_id: constraint.constraint_id,
        },
        provenance: [
          {
            kind: constraint.source_kind === "direct-user" ? "direct-user" : "durable-record",
            ref: constraint.source_ref,
            sha: null,
          },
        ],
        validity: {
          status: "current",
          as_of_sha: review.reviewed_sha,
          valid_from_sha: null,
          valid_until_sha: null,
        },
        required: true,
        modes: [...BRIEF_MODES],
        relevance_terms: ["constraint", constraint.constraint_id],
      }),
    );
  }
  for (const item of reviewItems) {
    candidates.push(
      finalizeCandidate({
        candidate_id: item.item_id,
        category: sectionFor(item),
        epistemic_kind: epistemicKind(item),
        statement: item.statement,
        source: {
          record_uri: item.record_uri,
          source_type: item.source_type,
          source_id: item.source_id,
        },
        provenance: [
          { kind: "durable-record", ref: item.record_uri, sha: review.reviewed_sha },
          ...evidenceProvenance(ctx, reviewSessionId, item.item_id),
        ],
        validity: validityFor(item, review.reviewed_sha, ctx),
        required: false,
        modes: modesFor(item),
        relevance_terms: [item.section, item.semantic_state],
      }),
    );
  }
  for (const [category, kind, entries] of [
    ["inferred_intent", "inferred-intent", inferredIntents],
    ["options", "recommendation", options],
  ] as const) {
    for (const entry of entries) {
      candidates.push(
        finalizeCandidate({
          candidate_id: `${sourceId}:${category}:${entry.id}`,
          category,
          epistemic_kind: kind,
          statement: entry.statement,
          source: {
            record_uri: `amanuensis://codebase-brief-source/${encodeURIComponent(sourceId)}/${category}/${encodeURIComponent(entry.id)}`,
            source_type: category,
            source_id: entry.id,
          },
          provenance: entry.source_item_ids.map((id) => ({
            kind: "derived-rule",
            ref: `amanuensis://review-item/${encodeURIComponent(id)}`,
            sha: review.reviewed_sha,
          })),
          validity: {
            status: "current",
            as_of_sha: review.reviewed_sha,
            valid_from_sha: null,
            valid_until_sha: null,
          },
          required: false,
          modes: ["design", "generative"],
          relevance_terms: entry.relevance_terms,
        }),
      );
    }
  }
  candidates.sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
  const source = finalizeSource({
    schema_version: CODEBASE_BRIEF_SCHEMA_VERSION,
    source_id: sourceId,
    review_session_id: reviewSessionId,
    reviewed_sha: review.reviewed_sha,
    objective,
    candidates,
  });
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO codebase_brief_sources
           (source_id, review_session_id, reviewed_sha, schema_version, candidate_count,
            source_json, source_hash, prepared_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sourceId,
        reviewSessionId,
        review.reviewed_sha,
        CODEBASE_BRIEF_SCHEMA_VERSION,
        candidates.length,
        JSON.stringify(source),
        source.source_hash,
        preparedBy,
      );
    const insert = ctx.db.prepare(
      `INSERT INTO codebase_brief_candidates
         (source_id, candidate_id, category, epistemic_kind, required, candidate_hash, candidate_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const candidate of candidates) {
      insert.run(
        sourceId,
        candidate.candidate_id,
        candidate.category,
        candidate.epistemic_kind,
        candidate.required ? 1 : 0,
        candidate.candidate_hash,
        JSON.stringify(candidate),
      );
    }
  })();
  return source;
}

function compile(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const compiledBy = requireActiveSession(ctx, "compile_codebase_brief");
  const briefId = requireString(args, "brief_id");
  if (ctx.db.prepare("SELECT 1 FROM codebase_briefs WHERE brief_id=?").get(briefId)) {
    throw new ToolError(`CodebaseBrief already exists: ${briefId}`);
  }
  const sourceId = requireString(args, "source_id");
  const source = getSource(ctx, sourceId);
  const mode = requireEnum(args, "mode", BRIEF_MODES);
  const itemLimit = optInt(args, "item_limit", 50);
  if (itemLimit === null || itemLimit < 1) throw new ToolError("item_limit must be at least 1");
  let brief: CodebaseBrief;
  try {
    brief = compileBrief(source, {
      brief_id: briefId,
      mode,
      item_limit: itemLimit,
      registry_ids: optStringArray(args, "registry_ids") ?? [],
      lexical_query: optString(args, "lexical_query") ?? undefined,
    });
  } catch (error) {
    throw new ToolError(error instanceof Error ? error.message : String(error));
  }
  const validation = validateCodebaseBrief(brief);
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO codebase_briefs
           (brief_id, source_id, mode, schema_version, item_limit, included_count,
            omitted_count, brief_json, brief_hash, compiled_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        briefId,
        sourceId,
        mode,
        CODEBASE_BRIEF_SCHEMA_VERSION,
        itemLimit,
        brief.budget.selected_count,
        brief.budget.omitted_count,
        JSON.stringify(brief),
        contentHash(brief),
        compiledBy,
      );
    ctx.db
      .prepare(
        `INSERT INTO codebase_brief_validations
           (brief_id, input_hash, schema_ok, semantic_ok, error_count, report_json, validated_by)
         VALUES (?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        briefId,
        contentHash(brief),
        validation.ok ? 1 : 0,
        validation.errors.length,
        JSON.stringify(validation),
        compiledBy,
      );
  })();
  return { brief, validation };
}

function getBrief(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const briefId = requireString(args, "brief_id");
  const row = ctx.db.prepare("SELECT * FROM codebase_briefs WHERE brief_id=?").get(briefId) as
    | (Record<string, unknown> & { brief_json: string })
    | undefined;
  if (!row) throw new ToolError(`unknown CodebaseBrief: ${briefId}`);
  return {
    ...row,
    brief: JSON.parse(row.brief_json),
    validations: ctx.db
      .prepare("SELECT * FROM codebase_brief_validations WHERE brief_id=? ORDER BY validation_id")
      .all(briefId),
  };
}

function lookup(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sourceId = requireString(args, "source_id");
  getSource(ctx, sourceId);
  const ids = optStringArray(args, "candidate_ids") ?? [];
  if (ids.length === 0) throw new ToolError("candidate_ids must contain at least one exact ID");
  const rows = ctx.db
    .prepare(
      `SELECT candidate_id, candidate_json FROM codebase_brief_candidates
        WHERE source_id=? ORDER BY candidate_id`,
    )
    .all(sourceId) as Array<{ candidate_id: string; candidate_json: string }>;
  const byId = new Map(rows.map((row) => [row.candidate_id, JSON.parse(row.candidate_json)]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0)
    throw new ToolError(`unknown registry candidate IDs: ${missing.join(", ")}`);
  return {
    source_id: sourceId,
    lookup_route: "registry-exact",
    model_calls: 0,
    candidates: ids.map((id) => byId.get(id)),
  };
}

function validate(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const briefId = optString(args, "brief_id");
  let brief = args.brief;
  if (briefId) {
    const row = ctx.db
      .prepare("SELECT brief_json FROM codebase_briefs WHERE brief_id=?")
      .get(briefId) as { brief_json: string } | undefined;
    if (!row) throw new ToolError(`unknown CodebaseBrief: ${briefId}`);
    brief = JSON.parse(row.brief_json);
  }
  if (brief === undefined) throw new ToolError("provide brief_id or brief");
  return { input_hash: contentHash(brief), ...validateCodebaseBrief(brief) };
}

const constraintSchema = {
  type: "object",
  additionalProperties: false,
  required: ["constraint_id", "statement", "source_kind", "source_ref"],
  properties: {
    constraint_id: { type: "string", minLength: 1 },
    statement: { type: "string", minLength: 1 },
    source_kind: { type: "string", enum: ["direct-user", "repository-contract", "issue", "adr"] },
    source_ref: { type: "string", minLength: 1 },
  },
};

const derivedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "statement", "source_item_ids"],
  properties: {
    id: { type: "string", minLength: 1 },
    statement: { type: "string", minLength: 1 },
    source_item_ids: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    relevance_terms: { type: "array", items: { type: "string", minLength: 1 } },
  },
};

export const codebaseBriefTools: ToolDefinition[] = [
  {
    name: "prepare_codebase_brief_source",
    description:
      "Freeze a storage-independent CodebaseBrief source record from one A9 review session plus typed direct constraints, provenance-bound inferred intent, and candidate options. The source is immutable and shared by all mode projections.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["source_id", "review_session_id", "objective", "constraints"],
      properties: {
        source_id: { type: "string", minLength: 1 },
        review_session_id: { type: "string", minLength: 1 },
        objective: { type: "string", minLength: 1 },
        constraints: { type: "array", minItems: 1, items: constraintSchema },
        inferred_intents: { type: "array", items: derivedSchema },
        options: { type: "array", items: derivedSchema },
      },
    },
    handler: prepareSource,
  },
  {
    name: "compile_codebase_brief",
    description:
      "Compile a versioned review, design, or generative CodebaseBrief from one immutable source. Exact registry IDs are resolved first, lexical ranking is deterministic, model_calls is always zero, and every excluded candidate receives a policy, irrelevance, or budget reason.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["brief_id", "source_id", "mode"],
      properties: {
        brief_id: { type: "string", minLength: 1 },
        source_id: { type: "string", minLength: 1 },
        mode: { type: "string", enum: [...BRIEF_MODES] },
        item_limit: { type: "integer", minimum: 1, default: 50 },
        registry_ids: { type: "array", items: { type: "string", minLength: 1 } },
        lexical_query: { type: "string" },
      },
    },
    handler: compile,
  },
  {
    name: "get_codebase_brief",
    description:
      "Read one immutable CodebaseBrief projection, its source identity, explicit omissions, deterministic selection trace, and append-only validation records.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["brief_id"],
      properties: { brief_id: { type: "string", minLength: 1 } },
    },
    handler: getBrief,
  },
  {
    name: "lookup_codebase_brief_objects",
    description:
      "Resolve exact candidate IDs in a frozen CodebaseBrief source through the local registry. This path is deterministic, preserves source objects byte-for-byte, and performs zero model calls.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["source_id", "candidate_ids"],
      properties: {
        source_id: { type: "string", minLength: 1 },
        candidate_ids: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
      },
    },
    handler: lookup,
  },
  {
    name: "validate_codebase_brief",
    description:
      "Validate a stored or caller-supplied CodebaseBrief 1.0.0. Semantic checks reject erased epistemic kinds, category drift, duplicate accounting, and any source candidate missing from both selected content and explicit omissions.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        brief_id: { type: "string", minLength: 1 },
        brief: { type: "object" },
      },
      anyOf: [
        {
          type: "object",
          properties: { brief_id: { type: "string", minLength: 1 } },
          required: ["brief_id"],
        },
        {
          type: "object",
          properties: { brief: { type: "object" } },
          required: ["brief"],
        },
      ],
    },
    handler: validate,
  },
];
