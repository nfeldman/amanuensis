import { createHash } from "node:crypto";

export const CODEBASE_BRIEF_SCHEMA_VERSION = "1.0.0" as const;
export const BRIEF_MODES = ["review", "design", "generative"] as const;
export const BRIEF_SECTIONS = [
  "facts",
  "direct_intent",
  "inferred_intent",
  "constraints",
  "contradictions",
  "changes",
  "options",
  "gaps",
] as const;
export const EPISTEMIC_KINDS = [
  "observed-behavior",
  "inference",
  "direct-intent",
  "inferred-intent",
  "recommendation",
  "open-question",
] as const;

export type BriefMode = (typeof BRIEF_MODES)[number];
export type BriefSection = (typeof BRIEF_SECTIONS)[number];
export type EpistemicKind = (typeof EPISTEMIC_KINDS)[number];

export interface BriefProvenance {
  kind: "direct-user" | "durable-record" | "evidence" | "derived-rule";
  ref: string;
  sha: string | null;
}

export interface BriefValidity {
  status: "current" | "historical" | "stale" | "unknown";
  as_of_sha: string;
  valid_from_sha: string | null;
  valid_until_sha: string | null;
}

export interface BriefCandidate {
  candidate_id: string;
  category: BriefSection;
  epistemic_kind: EpistemicKind;
  statement: string;
  source: {
    record_uri: string;
    source_type: string;
    source_id: string;
  };
  provenance: BriefProvenance[];
  validity: BriefValidity;
  required: boolean;
  modes: BriefMode[];
  relevance_terms: string[];
  candidate_hash: string;
}

export interface CodebaseBriefSource {
  schema_version: typeof CODEBASE_BRIEF_SCHEMA_VERSION;
  source_id: string;
  review_session_id: string;
  reviewed_sha: string;
  objective: string;
  candidates: BriefCandidate[];
  source_hash: string;
}

export interface CodebaseBrief {
  schema_version: typeof CODEBASE_BRIEF_SCHEMA_VERSION;
  brief_id: string;
  mode: BriefMode;
  source: {
    source_id: string;
    source_hash: string;
    review_session_id: string;
    reviewed_sha: string;
  };
  task: { objective: string };
  budget: {
    item_limit: number;
    required_count: number;
    selected_count: number;
    omitted_count: number;
  };
  selection: {
    algorithm: "registry-then-lexical-v1";
    model_calls: 0;
    registry_ids: string[];
    lexical_query: string;
    query_terms: string[];
  };
  source_manifest: Array<{ candidate_id: string; candidate_hash: string }>;
  sections: Record<BriefSection, Array<BriefCandidate & { selection_basis: string }>>;
  omissions: Array<{
    candidate_id: string;
    candidate_hash: string;
    reason: "policy" | "irrelevant" | "budget";
    detail: string;
  }>;
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalized(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalized(value));
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function finalizeCandidate(
  candidate: Omit<BriefCandidate, "candidate_hash">,
): BriefCandidate {
  return { ...candidate, candidate_hash: contentHash(candidate) };
}

export function finalizeSource(
  source: Omit<CodebaseBriefSource, "source_hash">,
): CodebaseBriefSource {
  return { ...source, source_hash: contentHash(source) };
}

function tokenize(value: string): string[] {
  return [
    ...new Set(
      value
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3),
    ),
  ].sort();
}

function lexicalScore(candidate: BriefCandidate, terms: string[]): number {
  if (terms.length === 0) return 1;
  const corpus = `${candidate.statement} ${candidate.relevance_terms.join(" ")}`.toLowerCase();
  return terms.reduce((score, term) => score + (corpus.includes(term) ? 1 : 0), 0);
}

export function compileBrief(
  source: CodebaseBriefSource,
  input: {
    brief_id: string;
    mode: BriefMode;
    item_limit: number;
    registry_ids?: string[];
    lexical_query?: string;
  },
): CodebaseBrief {
  const sourceErrors = validateSource(source);
  if (sourceErrors.length > 0)
    throw new Error(`invalid CodebaseBrief source: ${sourceErrors.join("; ")}`);
  const registryIds = [...new Set(input.registry_ids ?? [])].sort();
  const candidateIds = new Set(source.candidates.map((candidate) => candidate.candidate_id));
  const missing = registryIds.filter((id) => !candidateIds.has(id));
  if (missing.length > 0) throw new Error(`unknown registry candidate IDs: ${missing.join(", ")}`);
  const lexicalQuery = input.lexical_query ?? source.objective;
  const queryTerms = tokenize(lexicalQuery);
  const registry = new Set(registryIds);
  const required = source.candidates.filter((candidate) => candidate.required);
  const forced = source.candidates.filter(
    (candidate) => candidate.required || registry.has(candidate.candidate_id),
  );
  if (input.item_limit < forced.length) {
    throw new Error(
      `item_limit ${input.item_limit} cannot hold ${forced.length} required or registry-selected items`,
    );
  }
  const ranked = source.candidates
    .filter((candidate) => !candidate.required && !registry.has(candidate.candidate_id))
    .map((candidate) => ({ candidate, score: lexicalScore(candidate, queryTerms) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.candidate_id.localeCompare(right.candidate.candidate_id),
    );
  const selected = new Map<string, string>();
  for (const candidate of forced) {
    selected.set(
      candidate.candidate_id,
      registry.has(candidate.candidate_id) ? "registry-exact" : "required",
    );
  }
  for (const row of ranked) {
    if (selected.size >= input.item_limit) break;
    if (!row.candidate.modes.includes(input.mode) || row.score === 0) continue;
    selected.set(row.candidate.candidate_id, "lexical");
  }
  const omissions: CodebaseBrief["omissions"] = [];
  for (const candidate of source.candidates) {
    if (selected.has(candidate.candidate_id)) continue;
    const score = lexicalScore(candidate, queryTerms);
    if (!candidate.modes.includes(input.mode)) {
      omissions.push({
        candidate_id: candidate.candidate_id,
        candidate_hash: candidate.candidate_hash,
        reason: "policy",
        detail: `${input.mode} mode excludes this candidate by its declared mode policy`,
      });
    } else if (score === 0) {
      omissions.push({
        candidate_id: candidate.candidate_id,
        candidate_hash: candidate.candidate_hash,
        reason: "irrelevant",
        detail: `no deterministic lexical match for query terms: ${queryTerms.join(", ") || "none"}`,
      });
    } else {
      omissions.push({
        candidate_id: candidate.candidate_id,
        candidate_hash: candidate.candidate_hash,
        reason: "budget",
        detail: `ranked below the item_limit of ${input.item_limit}`,
      });
    }
  }
  const sections = Object.fromEntries(
    BRIEF_SECTIONS.map((section) => [section, []]),
  ) as unknown as CodebaseBrief["sections"];
  for (const candidate of source.candidates) {
    const basis = selected.get(candidate.candidate_id);
    if (basis) sections[candidate.category].push({ ...candidate, selection_basis: basis });
  }
  const brief: CodebaseBrief = {
    schema_version: CODEBASE_BRIEF_SCHEMA_VERSION,
    brief_id: input.brief_id,
    mode: input.mode,
    source: {
      source_id: source.source_id,
      source_hash: source.source_hash,
      review_session_id: source.review_session_id,
      reviewed_sha: source.reviewed_sha,
    },
    task: { objective: source.objective },
    budget: {
      item_limit: input.item_limit,
      required_count: required.length,
      selected_count: selected.size,
      omitted_count: omissions.length,
    },
    selection: {
      algorithm: "registry-then-lexical-v1",
      model_calls: 0,
      registry_ids: registryIds,
      lexical_query: lexicalQuery,
      query_terms: queryTerms,
    },
    source_manifest: source.candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      candidate_hash: candidate.candidate_hash,
    })),
    sections,
    omissions,
  };
  const result = validateCodebaseBrief(brief);
  if (!result.ok) throw new Error(`compiled an invalid CodebaseBrief: ${result.errors.join("; ")}`);
  return brief;
}

function objectAt(value: unknown, path: string, errors: string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  return value as Record<string, unknown>;
}

function textAt(row: Record<string, unknown>, key: string, path: string, errors: string[]): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) errors.push(`${path}.${key} is required`);
  return typeof value === "string" ? value : "";
}

function validateCandidate(value: unknown, path: string, errors: string[]): void {
  const row = objectAt(value, path, errors);
  if (!row) return;
  textAt(row, "candidate_id", path, errors);
  const category = textAt(row, "category", path, errors);
  if (!BRIEF_SECTIONS.includes(category as BriefSection))
    errors.push(`${path}.category is invalid`);
  const kind = textAt(row, "epistemic_kind", path, errors);
  if (!EPISTEMIC_KINDS.includes(kind as EpistemicKind))
    errors.push(`${path}.epistemic_kind is invalid`);
  textAt(row, "statement", path, errors);
  const candidateHash = textAt(row, "candidate_hash", path, errors);
  if (typeof row.required !== "boolean") errors.push(`${path}.required must be boolean`);
  if (!Array.isArray(row.modes) || row.modes.length === 0)
    errors.push(`${path}.modes must be non-empty`);
  else if (row.modes.some((mode) => !BRIEF_MODES.includes(mode as BriefMode)))
    errors.push(`${path}.modes contains an invalid mode`);
  if (!Array.isArray(row.relevance_terms)) errors.push(`${path}.relevance_terms must be an array`);
  const source = objectAt(row.source, `${path}.source`, errors);
  if (source)
    for (const key of ["record_uri", "source_type", "source_id"])
      textAt(source, key, `${path}.source`, errors);
  if (!Array.isArray(row.provenance) || row.provenance.length === 0)
    errors.push(`${path}.provenance must be non-empty`);
  else
    row.provenance.forEach((entry, index) => {
      const provenance = objectAt(entry, `${path}.provenance[${index}]`, errors);
      if (provenance) {
        textAt(provenance, "kind", `${path}.provenance[${index}]`, errors);
        textAt(provenance, "ref", `${path}.provenance[${index}]`, errors);
        if (!(provenance.sha === null || typeof provenance.sha === "string"))
          errors.push(`${path}.provenance[${index}].sha must be string or null`);
      }
    });
  const validity = objectAt(row.validity, `${path}.validity`, errors);
  if (validity) {
    const status = textAt(validity, "status", `${path}.validity`, errors);
    if (!["current", "historical", "stale", "unknown"].includes(status))
      errors.push(`${path}.validity.status is invalid`);
    textAt(validity, "as_of_sha", `${path}.validity`, errors);
    for (const key of ["valid_from_sha", "valid_until_sha"]) {
      if (!(validity[key] === null || typeof validity[key] === "string"))
        errors.push(`${path}.validity.${key} must be string or null`);
    }
  }
  if (category === "direct_intent" && kind !== "direct-intent")
    errors.push(`${path} direct_intent must retain direct-intent epistemic kind`);
  if (category === "inferred_intent" && kind !== "inferred-intent")
    errors.push(`${path} inferred_intent must retain inferred-intent epistemic kind`);
  if (category === "options" && kind !== "recommendation")
    errors.push(`${path} options must retain recommendation epistemic kind`);
  if (candidateHash) {
    const hashInput = { ...row };
    delete hashInput.candidate_hash;
    delete hashInput.selection_basis;
    if (contentHash(hashInput) !== candidateHash)
      errors.push(`${path}.candidate_hash does not reconcile`);
  }
}

export function validateSource(source: unknown): string[] {
  const errors: string[] = [];
  const row = objectAt(source, "source", errors);
  if (!row) return errors;
  if (row.schema_version !== CODEBASE_BRIEF_SCHEMA_VERSION)
    errors.push("source.schema_version must be 1.0.0");
  for (const key of ["source_id", "review_session_id", "reviewed_sha", "objective", "source_hash"])
    textAt(row, key, "source", errors);
  if (!Array.isArray(row.candidates) || row.candidates.length === 0)
    errors.push("source.candidates must be non-empty");
  else {
    row.candidates.forEach((candidate, index) => {
      validateCandidate(candidate, `source.candidates[${index}]`, errors);
    });
    const ids = row.candidates.map(
      (candidate) => (candidate as Record<string, unknown>).candidate_id,
    );
    if (new Set(ids).size !== ids.length) errors.push("source candidate IDs must be unique");
  }
  if (typeof row.source_hash === "string" && row.source_hash.length > 0) {
    const hashInput = { ...row };
    delete hashInput.source_hash;
    if (contentHash(hashInput) !== row.source_hash)
      errors.push("source.source_hash does not reconcile");
  }
  return errors;
}

export function validateCodebaseBrief(brief: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const row = objectAt(brief, "brief", errors);
  if (!row) return { ok: false, errors };
  if (row.schema_version !== CODEBASE_BRIEF_SCHEMA_VERSION)
    errors.push("brief.schema_version must be 1.0.0");
  textAt(row, "brief_id", "brief", errors);
  const mode = textAt(row, "mode", "brief", errors);
  if (!BRIEF_MODES.includes(mode as BriefMode)) errors.push("brief.mode is invalid");
  const source = objectAt(row.source, "brief.source", errors);
  if (source)
    for (const key of ["source_id", "source_hash", "review_session_id", "reviewed_sha"])
      textAt(source, key, "brief.source", errors);
  const task = objectAt(row.task, "brief.task", errors);
  if (task) textAt(task, "objective", "brief.task", errors);
  const budget = objectAt(row.budget, "brief.budget", errors);
  const selectedCount =
    budget && typeof budget.selected_count === "number" ? budget.selected_count : -1;
  const omittedCount =
    budget && typeof budget.omitted_count === "number" ? budget.omitted_count : -1;
  if (budget)
    for (const key of ["item_limit", "required_count", "selected_count", "omitted_count"])
      if (!Number.isInteger(budget[key]) || Number(budget[key]) < 0)
        errors.push(`brief.budget.${key} must be a non-negative integer`);
  const selection = objectAt(row.selection, "brief.selection", errors);
  if (selection) {
    if (selection.algorithm !== "registry-then-lexical-v1")
      errors.push("brief.selection.algorithm is invalid");
    if (selection.model_calls !== 0) errors.push("brief.selection.model_calls must be zero");
    if (!Array.isArray(selection.registry_ids) || !Array.isArray(selection.query_terms))
      errors.push("brief.selection registry_ids and query_terms must be arrays");
    if (typeof selection.lexical_query !== "string")
      errors.push("brief.selection.lexical_query must be text");
  }
  const manifest = Array.isArray(row.source_manifest) ? row.source_manifest : [];
  if (!Array.isArray(row.source_manifest) || manifest.length === 0)
    errors.push("brief.source_manifest must be non-empty");
  const manifestIds = manifest.map((entry, index) => {
    const item = objectAt(entry, `brief.source_manifest[${index}]`, errors);
    if (!item) return "";
    textAt(item, "candidate_hash", `brief.source_manifest[${index}]`, errors);
    return textAt(item, "candidate_id", `brief.source_manifest[${index}]`, errors);
  });
  const manifestHashes = new Map(
    manifest.map((entry) => {
      const item = entry as Record<string, unknown>;
      return [String(item.candidate_id), String(item.candidate_hash)];
    }),
  );
  const sections = objectAt(row.sections, "brief.sections", errors);
  const includedIds: string[] = [];
  if (sections)
    for (const section of BRIEF_SECTIONS) {
      const items = sections[section];
      if (!Array.isArray(items)) {
        errors.push(`brief.sections.${section} must be an array`);
        continue;
      }
      items.forEach((item, index) => {
        validateCandidate(item, `brief.sections.${section}[${index}]`, errors);
        const candidate = item as Record<string, unknown>;
        if (candidate.category !== section)
          errors.push(`brief.sections.${section}[${index}] category does not match section`);
        textAt(candidate, "selection_basis", `brief.sections.${section}[${index}]`, errors);
        if (typeof candidate.candidate_id === "string") {
          includedIds.push(candidate.candidate_id);
          if (
            typeof candidate.candidate_hash === "string" &&
            manifestHashes.get(candidate.candidate_id) !== candidate.candidate_hash
          ) {
            errors.push(`brief.sections.${section}[${index}] hash differs from source manifest`);
          }
        }
      });
    }
  const omissions = Array.isArray(row.omissions) ? row.omissions : [];
  if (!Array.isArray(row.omissions)) errors.push("brief.omissions must be an array");
  const omittedIds = omissions.map((entry, index) => {
    const omission = objectAt(entry, `brief.omissions[${index}]`, errors);
    if (!omission) return "";
    const reason = textAt(omission, "reason", `brief.omissions[${index}]`, errors);
    if (!["policy", "irrelevant", "budget"].includes(reason))
      errors.push(`brief.omissions[${index}].reason is invalid`);
    textAt(omission, "detail", `brief.omissions[${index}]`, errors);
    const candidateHash = textAt(omission, "candidate_hash", `brief.omissions[${index}]`, errors);
    const candidateId = textAt(omission, "candidate_id", `brief.omissions[${index}]`, errors);
    if (candidateId && candidateHash && manifestHashes.get(candidateId) !== candidateHash) {
      errors.push(`brief.omissions[${index}] hash differs from source manifest`);
    }
    return candidateId;
  });
  const accounted = [...includedIds, ...omittedIds];
  if (new Set(manifestIds).size !== manifestIds.length)
    errors.push("brief.source_manifest IDs must be unique");
  if (new Set(accounted).size !== accounted.length)
    errors.push("each source candidate must appear exactly once");
  if ([...manifestIds].sort().join("\0") !== [...accounted].sort().join("\0"))
    errors.push("source manifest does not reconcile with selected plus omitted candidates");
  if (selectedCount !== includedIds.length)
    errors.push("brief.budget.selected_count does not reconcile");
  if (omittedCount !== omittedIds.length)
    errors.push("brief.budget.omitted_count does not reconcile");
  return { ok: errors.length === 0, errors };
}
