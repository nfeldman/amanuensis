import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  optString,
  requireEnum,
  requireInt,
  requireString,
  requireStringArray,
  requireWorkspaceSourcePath,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const ROLES = ["generator", "refuter", "verifier"] as const;
const CONDITIONS = ["same-context", "varied-context", "heterogeneous-runtime"] as const;
const PROFILES = ["diff-scoped", "control-wide", "integral-head"] as const;
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const VERDICTS = ["upheld", "overturned", "scope-restricted", "undetermined"] as const;
const EVIDENCE_KINDS = [
  "code-verified",
  "contract-stated",
  "comment-asserted",
  "name-inferred",
  "pattern-matched",
  "test-observed",
  "config-asserted",
  "doc-asserted",
  "runtime-observed",
] as const;
const LEAK_INJECTIONS = ["blind-truth-field", "prior-verdict-field"] as const;
const BLIND_ARMS = ["clean", "marker-only", "treated", "null"] as const;

type Role = (typeof ROLES)[number];
type Condition = (typeof CONDITIONS)[number];
type Profile = (typeof PROFILES)[number];

interface AnalysisRun {
  run_id: string;
  impact_run_id: string;
  reviewed_sha: string;
  replicate_id: string;
  condition: Condition;
  orchestrator_model_family: string;
  provider_allowlist: string;
  allowed_source_prefixes: string;
  max_total_tokens: number;
  max_total_cost_microusd: number;
  expected_generator_count: number;
  expected_refuter_count: number;
  expected_verifier_count: number;
  blind_assignment_id: string;
  sealed_truth_hash: string;
  validation_inject_leak: string | null;
  status: string;
  manifest_json: string;
  manifest_hash: string;
  session_id: string;
}

interface ReviewPass {
  pass_id: string;
  run_id: string;
  ordinal: number;
  role: Role;
  replicate_id: string;
  context_profile: Profile;
  analytical_frame: string;
  provider: string;
  model: string;
  model_family: string;
  runtime: string;
  planned_tokens: number;
  planned_cost_microusd: number;
  status: string;
  runtime_input_json: string | null;
  runtime_input_hash: string | null;
}

interface PassSpec {
  pass_id: string;
  role: Role;
  replicate_id: string;
  context_profile: Profile;
  analytical_frame: string;
  provider: string;
  model: string;
  model_family: string;
  runtime: string;
  planned_tokens: number;
  planned_cost_microusd: number;
}

interface EvidenceInput {
  local_key: string;
  file_path: string;
  symbol: string | null;
  line_range: string | null;
  ref_sha: string;
  kind: (typeof EVIDENCE_KINDS)[number];
  excerpt: string | null;
  note: string | null;
}

interface BlindTruth {
  assignment_id: string;
  arm_type: (typeof BLIND_ARMS)[number];
  pair_id: string;
  replicate_id: string;
  surface_contract_hash: string;
  expected_finding_keys: string[];
  leak_canary: string;
}

const ROLE_CONTRACTS: Record<Role, Record<string, unknown>> = {
  generator: {
    objective: "Generate candidate review findings from the assigned published ReviewBrief.",
    may_read: ["assigned ReviewBrief", "allowed repository sources"],
    must_not_read: ["blind truth", "other passes", "expected findings"],
    output: "candidate claims with evidence, scope, severity, rationale, or a non-vacuity report",
  },
  refuter: {
    objective: "Try to overturn each anonymous hypothesis; uphold what survives.",
    may_read: ["anonymous claim variants", "structured evidence", "allowed repository sources"],
    must_not_read: ["generator rationale", "confidence", "pass identity", "any prior verdict"],
    framing: "Refute, do not presume false. An overturn requires newly discovered evidence.",
  },
  verifier: {
    objective: "Independently judge each anonymous hypothesis against the pooled evidence.",
    may_read: ["anonymous claim variants", "candidate evidence", "newly discovered evidence"],
    must_not_read: ["generator rationale", "refuter rationale", "confidence", "any prior verdict"],
    framing: "Verify evidence and decide independently; do not infer consensus.",
  },
};

function normalizedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizedJson(item)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizedJson(value));
}

function jsonShape(value: unknown): unknown {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, jsonShape(item)]),
    );
  }
  return typeof value;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function truthHash(salt: string, truth: BlindTruth): string {
  return hash(`${salt}\u0000${stableJson(truth)}`);
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
  return git(ctx, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function normalizePrefixes(values: string[]): string[] {
  const prefixes = unique(values.map((value) => value.replace(/^\.\//, "")));
  if (prefixes.length === 0) throw new ToolError("allowed_source_prefixes must not be empty");
  for (const prefix of prefixes) {
    if (!prefix || prefix.startsWith("/") || prefix.split("/").includes("..")) {
      throw new ToolError("allowed_source_prefixes must contain relative, non-traversing paths");
    }
  }
  return prefixes;
}

function pathAllowed(path: string, prefixes: string[]): boolean {
  const normalized = path.replace(/^\.\//, "");
  return prefixes.some((prefix) => {
    const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return normalized === prefix || normalized.startsWith(base);
  });
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseSpecs(args: Record<string, unknown>): PassSpec[] {
  if (!Array.isArray(args.pass_specs)) throw new ToolError("pass_specs must be an array");
  const passIds = new Set<string>();
  const roleReplicates = new Set<string>();
  return args.pass_specs.map((item, index) => {
    const row = requireObject(item, `pass_specs[${index}]`);
    const spec: PassSpec = {
      pass_id: requireString(row, "pass_id"),
      role: requireEnum(row, "role", ROLES),
      replicate_id: requireString(row, "replicate_id"),
      context_profile: requireEnum(row, "context_profile", PROFILES),
      analytical_frame: requireString(row, "analytical_frame"),
      provider: requireString(row, "provider"),
      model: requireString(row, "model"),
      model_family: requireString(row, "model_family"),
      runtime: requireString(row, "runtime"),
      planned_tokens: requireInt(row, "planned_tokens"),
      planned_cost_microusd: requireInt(row, "planned_cost_microusd"),
    };
    if (spec.planned_tokens <= 0 || spec.planned_cost_microusd < 0) {
      throw new ToolError(`pass_specs[${index}] budgets must be positive/non-negative`);
    }
    if (passIds.has(spec.pass_id)) throw new ToolError(`duplicate pass_id: ${spec.pass_id}`);
    passIds.add(spec.pass_id);
    const roleReplicate = `${spec.role}\u0000${spec.replicate_id}`;
    if (roleReplicates.has(roleReplicate)) {
      throw new ToolError(`duplicate ${spec.role} replicate_id: ${spec.replicate_id}`);
    }
    roleReplicates.add(roleReplicate);
    return spec;
  });
}

function getRun(ctx: ServerContext, runId: string): AnalysisRun {
  const row = ctx.db.prepare("SELECT * FROM review_analysis_runs WHERE run_id=?").get(runId) as
    | AnalysisRun
    | undefined;
  if (!row) throw new ToolError(`unknown review analysis run: ${runId}`);
  return row;
}

function getPass(ctx: ServerContext, runId: string, passId: string): ReviewPass {
  const row = ctx.db
    .prepare("SELECT * FROM review_passes WHERE run_id=? AND pass_id=?")
    .get(runId, passId) as ReviewPass | undefined;
  if (!row) throw new ToolError(`unknown review pass: ${passId}`);
  return row;
}

function setRunStatus(ctx: ServerContext, runId: string, status: string): void {
  ctx.db
    .prepare(
      `UPDATE review_analysis_runs SET status=?, updated_at=datetime('now'),
          completed_at=CASE WHEN ? IN ('aggregated','contaminated','failed')
                            THEN datetime('now') ELSE completed_at END
        WHERE run_id=?`,
    )
    .run(status, status, runId);
}

function evidenceRows(ctx: ServerContext, evidenceIds: number[]): Array<Record<string, unknown>> {
  if (evidenceIds.length === 0) return [];
  const rows = ctx.db
    .prepare(
      `SELECT id, file_path, symbol, line_range, ref_sha, kind, excerpt
         FROM evidence WHERE id IN (${evidenceIds.map(() => "?").join(",")}) ORDER BY id`,
    )
    .all(...evidenceIds) as Array<Record<string, unknown> & { id: number }>;
  if (rows.length !== evidenceIds.length) {
    const found = new Set(rows.map((row) => row.id));
    throw new ToolError(
      `unknown evidence ids: ${evidenceIds.filter((id) => !found.has(id)).join(", ")}`,
    );
  }
  return rows;
}

function briefEvidenceCatalog(ctx: ServerContext, briefId: string): Array<Record<string, unknown>> {
  const evidence = new Map<number, Record<string, unknown>>();
  const rows = ctx.db
    .prepare(
      "SELECT source_json FROM review_brief_trace WHERE brief_id=? AND action='included' ORDER BY ordinal",
    )
    .all(briefId) as Array<{ source_json: string }>;
  for (const row of rows) {
    const source = JSON.parse(row.source_json) as Record<string, unknown>;
    if (!Array.isArray(source.evidence)) continue;
    for (const item of source.evidence) {
      if (!item || typeof item !== "object") continue;
      const typed = item as Record<string, unknown>;
      const id = Number(typed.id);
      if (!Number.isInteger(id)) continue;
      evidence.set(id, {
        id,
        file_path: typed.file_path,
        symbol: typed.symbol,
        line_range: typed.line_range,
        ref_sha: typed.ref_sha,
        kind: typed.kind,
        excerpt: typed.excerpt,
      });
    }
  }
  return [...evidence.values()].sort((left, right) => Number(left.id) - Number(right.id));
}

function validateEvidence(
  ctx: ServerContext,
  run: AnalysisRun,
  rows: Array<Record<string, unknown>>,
): void {
  const prefixes = parseJson<string[]>(run.allowed_source_prefixes, []);
  for (const row of rows) {
    const filePath = requireWorkspaceSourcePath(row.file_path);
    const refSha = String(row.ref_sha);
    if (!pathAllowed(filePath, prefixes)) {
      throw new ToolError(`evidence source outside allowed_source_prefixes: ${filePath}`);
    }
    resolveCommit(ctx, refSha);
    if (!isAncestor(ctx, refSha, run.reviewed_sha)) {
      throw new ToolError(`evidence ${String(row.id ?? filePath)} is newer than reviewed_sha`);
    }
    if (git(ctx, ["cat-file", "-e", `${refSha}:${filePath}`]).status !== 0) {
      throw new ToolError(`evidence source does not exist at ref_sha: ${filePath}@${refSha}`);
    }
  }
}

function parseNewEvidence(args: Record<string, unknown>): EvidenceInput[] {
  if (args.new_evidence == null) return [];
  if (!Array.isArray(args.new_evidence)) throw new ToolError("new_evidence must be an array");
  const keys = new Set<string>();
  return args.new_evidence.map((item, index) => {
    const row = requireObject(item, `new_evidence[${index}]`);
    const localKey = requireString(row, "local_key");
    if (keys.has(localKey)) throw new ToolError(`duplicate new_evidence local_key: ${localKey}`);
    keys.add(localKey);
    return {
      local_key: localKey,
      file_path: requireWorkspaceSourcePath(row.file_path),
      symbol: optString(row, "symbol"),
      line_range: optString(row, "line_range"),
      ref_sha: requireString(row, "ref_sha"),
      kind: requireEnum(row, "kind", EVIDENCE_KINDS),
      excerpt: optString(row, "excerpt"),
      note: optString(row, "note"),
    };
  });
}

function walkKeys(value: unknown, keys: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, keys);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      keys.push(key);
      walkKeys(item, keys);
    }
  }
}

function detectInputLeak(role: Role, runtimeInput: Record<string, unknown>): string | null {
  const keys: string[] = [];
  walkKeys(runtimeInput, keys);
  const blind = new Set([
    "expected_findings",
    "expected_finding_keys",
    "truth",
    "arm_type",
    "evaluation_condition",
    "leak_canary",
  ]);
  if (keys.some((key) => blind.has(key))) return "blind-truth-field";
  if (
    role !== "generator" &&
    keys.some((key) =>
      ["verdict", "rationale", "confidence", "prior_verdict", "source_pass_id"].includes(key),
    )
  ) {
    return "prior-verdict-field";
  }
  return null;
}

function recordContamination(
  ctx: ServerContext,
  runId: string,
  passId: string | null,
  leakType: string,
  detail: Record<string, unknown>,
): void {
  ctx.db
    .prepare(
      `INSERT INTO review_contamination_events (run_id, pass_id, leak_type, detail_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(runId, passId, leakType, JSON.stringify(detail));
  const run = getRun(ctx, runId);
  if (!["contaminated", "failed"].includes(run.status)) setRunStatus(ctx, runId, "contaminated");
}

function hypothesisPackets(ctx: ServerContext, runId: string): Array<Record<string, unknown>> {
  return (
    ctx.db
      .prepare(
        `SELECT hypothesis_id, challenge_packet_json
           FROM review_hypotheses WHERE run_id=? ORDER BY ordinal`,
      )
      .all(runId) as Array<{ hypothesis_id: string; challenge_packet_json: string }>
  ).map((row) => ({
    hypothesis_id: row.hypothesis_id,
    ...JSON.parse(row.challenge_packet_json),
  }));
}

function verificationPackets(ctx: ServerContext, runId: string): Array<Record<string, unknown>> {
  return hypothesisPackets(ctx, runId).map((packet) => {
    const hypothesisId = String(packet.hypothesis_id);
    const ids = (
      ctx.db
        .prepare(
          `SELECT DISTINCT je.evidence_id
             FROM review_judgments j
             JOIN review_passes p ON p.pass_id=j.pass_id
             JOIN review_judgment_evidence je ON je.judgment_id=j.judgment_id
            WHERE p.run_id=? AND p.role='refuter' AND j.hypothesis_id=?
            ORDER BY je.evidence_id`,
        )
        .all(runId, hypothesisId) as Array<{ evidence_id: number }>
    ).map((row) => row.evidence_id);
    const priorEvidence = Array.isArray(packet.evidence)
      ? (packet.evidence as Array<Record<string, unknown>>).map((row) => Number(row.id))
      : [];
    const evidence = evidenceRows(ctx, unique([...priorEvidence, ...ids].map(String)).map(Number));
    const { evidence: _oldEvidence, ...withoutEvidence } = packet;
    return { ...withoutEvidence, evidence };
  });
}

function runtimeInput(
  ctx: ServerContext,
  run: AnalysisRun,
  pass: ReviewPass,
): Record<string, unknown> {
  const common = {
    schema_version: 1,
    analysis_run_id: run.run_id,
    pass_id: pass.pass_id,
    role: pass.role,
    replicate_id: pass.replicate_id,
    reviewed_sha: run.reviewed_sha,
    analytical_frame: pass.analytical_frame,
    role_contract: ROLE_CONTRACTS[pass.role],
    authority: {
      mode: "observe-only",
      allowed_source_prefixes: parseJson(run.allowed_source_prefixes, []),
      allowed_actions: ["inspect", "report"],
      forbidden_actions: ["write-code", "accept-decision", "merge", "deploy", "external-message"],
    },
  };
  let input: Record<string, unknown>;
  if (pass.role === "generator") {
    const brief = ctx.db
      .prepare(
        `SELECT b.brief_id, b.brief_hash, b.brief_json, p.brief_hash AS publication_hash
           FROM review_analysis_briefs ab
           JOIN review_briefs b ON b.brief_id=ab.brief_id
           JOIN review_brief_publications p ON p.brief_id=b.brief_id
          WHERE ab.run_id=? AND ab.context_profile=?`,
      )
      .get(run.run_id, pass.context_profile) as
      | { brief_id: string; brief_hash: string; brief_json: string; publication_hash: string }
      | undefined;
    if (!brief || brief.brief_hash !== brief.publication_hash) {
      throw new ToolError(`published ReviewBrief missing for ${pass.context_profile}`);
    }
    input = {
      ...common,
      context_profile: pass.context_profile,
      review_brief: JSON.parse(brief.brief_json),
      review_brief_hash: brief.brief_hash,
      evidence_catalog: briefEvidenceCatalog(ctx, brief.brief_id),
    };
  } else if (pass.role === "refuter") {
    input = { ...common, hypotheses: hypothesisPackets(ctx, run.run_id) };
  } else {
    input = { ...common, hypotheses: verificationPackets(ctx, run.run_id) };
  }
  if (run.validation_inject_leak === "blind-truth-field") {
    input.expected_finding_keys = ["validation-leak"];
  }
  if (run.validation_inject_leak === "prior-verdict-field" && pass.role !== "generator") {
    input.prior_verdict = "upheld";
  }
  return input;
}

function readAnalysis(ctx: ServerContext, runId: string): Record<string, unknown> {
  const run = getRun(ctx, runId);
  const passes = ctx.db
    .prepare(
      `SELECT pass_id, ordinal, role, replicate_id, context_profile, analytical_frame,
              provider, model, model_family, runtime, planned_tokens,
              planned_cost_microusd, status, runtime_input_hash, result_hash,
              actual_tokens, actual_cost_microusd, dispatched_at, landed_at, failure
         FROM review_passes WHERE run_id=? ORDER BY ordinal`,
    )
    .all(runId);
  const aggregation = ctx.db
    .prepare("SELECT * FROM review_aggregations WHERE run_id=?")
    .get(runId) as (Record<string, unknown> & { result_json: string }) | undefined;
  const reveal = ctx.db.prepare("SELECT * FROM review_blind_reveals WHERE run_id=?").get(runId) as
    | (Record<string, unknown> & { truth_json: string })
    | undefined;
  const contamination = ctx.db
    .prepare("SELECT * FROM review_contamination_events WHERE run_id=? ORDER BY id")
    .all(runId)
    .map((row) => {
      const typed = row as Record<string, unknown> & { detail_json: string };
      return { ...typed, detail: JSON.parse(typed.detail_json) };
    });
  return {
    ...run,
    provider_allowlist: JSON.parse(run.provider_allowlist),
    allowed_source_prefixes: JSON.parse(run.allowed_source_prefixes),
    manifest: JSON.parse(run.manifest_json),
    passes,
    hypothesis_count: (
      ctx.db.prepare("SELECT COUNT(*) AS n FROM review_hypotheses WHERE run_id=?").get(runId) as {
        n: number;
      }
    ).n,
    aggregation: aggregation
      ? { ...aggregation, result: JSON.parse(aggregation.result_json) }
      : null,
    reveal: reveal ? { ...reveal, truth: JSON.parse(reveal.truth_json) } : null,
    contamination,
  };
}

function plan(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "plan_review_analysis");
  const runId = requireString(args, "run_id");
  if (ctx.db.prepare("SELECT 1 FROM review_analysis_runs WHERE run_id=?").get(runId)) {
    throw new ToolError(`review analysis run_id already exists: ${runId}`);
  }
  const condition = requireEnum(args, "condition", CONDITIONS);
  const replicateId = requireString(args, "replicate_id");
  const orchestratorFamily = requireString(args, "orchestrator_model_family");
  const providers = unique(requireStringArray(args, "provider_allowlist", { minLength: 1 }));
  const prefixes = normalizePrefixes(
    requireStringArray(args, "allowed_source_prefixes", { minLength: 1 }),
  );
  const maxTokens = requireInt(args, "max_total_tokens");
  const maxCost = requireInt(args, "max_total_cost_microusd");
  if (maxTokens <= 0 || maxCost < 0)
    throw new ToolError("analysis budgets must be positive/non-negative");
  const specs = parseSpecs(args);
  const counts = Object.fromEntries(
    ROLES.map((role) => [role, specs.filter((spec) => spec.role === role).length]),
  ) as Record<Role, number>;
  for (const role of ROLES) {
    if (counts[role] < 2)
      throw new ToolError(`review analysis requires at least two ${role} passes`);
  }
  if (specs.some((spec) => !providers.includes(spec.provider))) {
    throw new ToolError("every pass provider must be in provider_allowlist");
  }
  if (specs.reduce((sum, spec) => sum + spec.planned_tokens, 0) > maxTokens) {
    throw new ToolError("planned pass tokens exceed max_total_tokens");
  }
  if (specs.reduce((sum, spec) => sum + spec.planned_cost_microusd, 0) > maxCost) {
    throw new ToolError("planned pass cost exceeds max_total_cost_microusd");
  }

  const briefIds = unique(requireStringArray(args, "brief_ids", { minLength: 1 }));
  const briefs = ctx.db
    .prepare(
      `SELECT b.* FROM review_briefs b JOIN review_brief_publications p ON p.brief_id=b.brief_id
        WHERE b.brief_id IN (${briefIds.map(() => "?").join(",")}) ORDER BY b.context_profile`,
    )
    .all(...briefIds) as Array<
    Record<string, unknown> & {
      brief_id: string;
      impact_run_id: string;
      reviewed_sha: string;
      context_profile: Profile;
      task: string;
      task_constraints: string;
    }
  >;
  if (briefs.length !== briefIds.length) throw new ToolError("every brief_id must be published");
  const impactIds = unique(briefs.map((brief) => brief.impact_run_id));
  const reviewedShas = unique(briefs.map((brief) => brief.reviewed_sha));
  const tasks = unique(briefs.map((brief) => `${brief.task}\u0000${brief.task_constraints}`));
  if (impactIds.length !== 1 || reviewedShas.length !== 1 || tasks.length !== 1) {
    throw new ToolError(
      "analysis briefs must share impact run, reviewed SHA, task, and constraints",
    );
  }
  const profiles = new Set(briefs.map((brief) => brief.context_profile));
  if (profiles.size !== briefs.length) {
    throw new ToolError("analysis accepts at most one published brief per context profile");
  }
  if (specs.some((spec) => !profiles.has(spec.context_profile))) {
    throw new ToolError("every pass context_profile needs a supplied published brief");
  }
  const generators = specs.filter((spec) => spec.role === "generator");
  const generatorProfiles = new Set(generators.map((spec) => spec.context_profile));
  const generatorFrames = new Set(generators.map((spec) => spec.analytical_frame));
  const generatorFamilies = new Set(generators.map((spec) => spec.model_family));
  const generatorProviders = new Set(generators.map((spec) => spec.provider));
  const generatorModels = new Set(generators.map((spec) => spec.model));
  const generatorRuntimes = new Set(generators.map((spec) => spec.runtime));
  const generatorRuntimeIdentities = new Set(
    generators.map((spec) => `${spec.provider}\u0000${spec.model}\u0000${spec.runtime}`),
  );
  for (const role of ["refuter", "verifier"] as const) {
    const challengePasses = specs.filter((spec) => spec.role === role);
    for (const [axis, values] of [
      ["context profile", challengePasses.map((spec) => spec.context_profile)],
      ["analytical frame", challengePasses.map((spec) => spec.analytical_frame)],
      ["provider", challengePasses.map((spec) => spec.provider)],
      ["model", challengePasses.map((spec) => spec.model)],
      ["model family", challengePasses.map((spec) => spec.model_family)],
      ["runtime", challengePasses.map((spec) => spec.runtime)],
    ] as const) {
      if (new Set(values).size !== 1) {
        throw new ToolError(`${role} replicates must hold ${axis} fixed`);
      }
    }
  }
  if (
    condition === "same-context" &&
    (generatorProfiles.size !== 1 ||
      generatorFrames.size !== 1 ||
      generatorFamilies.size !== 1 ||
      generatorProviders.size !== 1 ||
      generatorModels.size !== 1 ||
      generatorRuntimes.size !== 1)
  ) {
    throw new ToolError(
      "same-context must hold profile, frame, provider, model, and runtime fixed",
    );
  }
  if (
    condition === "varied-context" &&
    (generatorProfiles.size < 2 ||
      generatorFrames.size < 2 ||
      generatorFamilies.size !== 1 ||
      generatorProviders.size !== 1 ||
      generatorModels.size !== 1 ||
      generatorRuntimes.size !== 1)
  ) {
    throw new ToolError(
      "varied-context must vary profile and frame while holding provider, model, and runtime fixed",
    );
  }
  if (
    condition === "heterogeneous-runtime" &&
    (generatorProfiles.size !== 1 ||
      generatorFrames.size !== 1 ||
      generatorFamilies.size < 2 ||
      generatorRuntimeIdentities.size < 2 ||
      !generators.some((spec) => spec.model_family !== orchestratorFamily))
  ) {
    throw new ToolError(
      "heterogeneous-runtime must hold context fixed, vary model family, and differ from the orchestrator",
    );
  }
  const injection = optString(args, "validation_inject_leak");
  if (
    injection !== null &&
    !LEAK_INJECTIONS.includes(injection as (typeof LEAK_INJECTIONS)[number])
  ) {
    throw new ToolError("unknown validation_inject_leak");
  }
  const manifest = {
    schema_version: 1,
    run_id: runId,
    impact_run_id: impactIds[0],
    reviewed_sha: reviewedShas[0],
    replicate_id: replicateId,
    condition,
    orchestrator_model_family: orchestratorFamily,
    provider_allowlist: providers,
    allowed_source_prefixes: prefixes,
    max_total_tokens: maxTokens,
    max_total_cost_microusd: maxCost,
    blind_assignment_id: requireString(args, "blind_assignment_id"),
    sealed_truth_hash: requireString(args, "sealed_truth_hash"),
    pass_specs: specs,
    authority: { mode: "observe-only", allowed_side_effects: ["analysis-api-call"] },
  };
  const manifestJson = stableJson(manifest);
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO review_analysis_runs
           (run_id, impact_run_id, reviewed_sha, replicate_id, condition,
            orchestrator_model_family, provider_allowlist, allowed_source_prefixes,
            max_total_tokens, max_total_cost_microusd, expected_generator_count,
            expected_refuter_count, expected_verifier_count, blind_assignment_id,
            sealed_truth_hash, validation_inject_leak, status, manifest_json,
            manifest_hash, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)`,
      )
      .run(
        runId,
        impactIds[0],
        reviewedShas[0],
        replicateId,
        condition,
        orchestratorFamily,
        JSON.stringify(providers),
        JSON.stringify(prefixes),
        maxTokens,
        maxCost,
        counts.generator,
        counts.refuter,
        counts.verifier,
        manifest.blind_assignment_id,
        manifest.sealed_truth_hash,
        injection,
        manifestJson,
        hash(manifestJson),
        sessionId,
      );
    const briefInsert = ctx.db.prepare(
      "INSERT INTO review_analysis_briefs (run_id, context_profile, brief_id) VALUES (?, ?, ?)",
    );
    for (const brief of briefs) briefInsert.run(runId, brief.context_profile, brief.brief_id);
    const passInsert = ctx.db.prepare(
      `INSERT INTO review_passes
         (pass_id, run_id, ordinal, role, replicate_id, context_profile,
          analytical_frame, provider, model, model_family, runtime,
          planned_tokens, planned_cost_microusd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    specs.forEach((spec, ordinal) => {
      passInsert.run(
        spec.pass_id,
        runId,
        ordinal,
        spec.role,
        spec.replicate_id,
        spec.context_profile,
        spec.analytical_frame,
        spec.provider,
        spec.model,
        spec.model_family,
        spec.runtime,
        spec.planned_tokens,
        spec.planned_cost_microusd,
      );
    });
  })();
  return readAnalysis(ctx, runId);
}

function dispatch(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "dispatch_review_pass");
  const runId = requireString(args, "run_id");
  const pass = getPass(ctx, runId, requireString(args, "pass_id"));
  const run = getRun(ctx, runId);
  if (pass.status !== "planned")
    throw new ToolError(`review pass ${pass.pass_id} is ${pass.status}`);
  const allowed =
    (pass.role === "generator" && ["planned", "generating"].includes(run.status)) ||
    (pass.role === "refuter" && ["hypotheses-frozen", "refuting"].includes(run.status)) ||
    (pass.role === "verifier" && ["verification-ready", "verifying"].includes(run.status));
  if (!allowed) throw new ToolError(`${pass.role} pass cannot dispatch while run is ${run.status}`);
  const input = runtimeInput(ctx, run, pass);
  const leak = detectInputLeak(pass.role, input);
  if (leak) {
    recordContamination(ctx, runId, pass.pass_id, leak, {
      forbidden_keys: true,
      validation_injection: run.validation_inject_leak,
    });
    throw new ToolError(`review pass input contaminated: ${leak}`);
  }
  const inputJson = stableJson(input);
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `UPDATE review_passes
            SET status='dispatched', runtime_input_json=?, runtime_input_hash=?,
                dispatched_at=datetime('now') WHERE pass_id=?`,
      )
      .run(inputJson, hash(inputJson), pass.pass_id);
    if (run.status === "planned") setRunStatus(ctx, runId, "generating");
    if (run.status === "hypotheses-frozen") setRunStatus(ctx, runId, "refuting");
    if (run.status === "verification-ready") setRunStatus(ctx, runId, "verifying");
  })();
  return {
    run_id: runId,
    pass_id: pass.pass_id,
    role: pass.role,
    provider: pass.provider,
    model: pass.model,
    model_family: pass.model_family,
    runtime: pass.runtime,
    runtime_input: input,
    runtime_input_hash: hash(inputJson),
  };
}

function failPass(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "fail_review_pass");
  const runId = requireString(args, "run_id");
  const pass = getPass(ctx, runId, requireString(args, "pass_id"));
  if (pass.status !== "dispatched")
    throw new ToolError(`review pass ${pass.pass_id} is ${pass.status}`);
  const failure = requireString(args, "failure");
  ctx.db.transaction(() => {
    ctx.db
      .prepare("UPDATE review_passes SET status='failed', failure=? WHERE pass_id=?")
      .run(failure, pass.pass_id);
    setRunStatus(ctx, runId, "failed");
  })();
  return readAnalysis(ctx, runId);
}

function land(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "land_review_pass");
  const runId = requireString(args, "run_id");
  const pass = getPass(ctx, runId, requireString(args, "pass_id"));
  const run = getRun(ctx, runId);
  if (pass.status !== "dispatched")
    throw new ToolError(`review pass ${pass.pass_id} is ${pass.status}`);
  if (["contaminated", "failed"].includes(run.status)) {
    throw new ToolError(`review analysis run ${runId} does not accept results while ${run.status}`);
  }
  const actualTokens = requireInt(args, "actual_tokens");
  const actualCost = requireInt(args, "actual_cost_microusd");
  if (actualTokens < 0 || actualCost < 0) throw new ToolError("actual usage must be non-negative");
  const used = ctx.db
    .prepare(
      `SELECT COALESCE(SUM(actual_tokens),0) AS tokens,
              COALESCE(SUM(actual_cost_microusd),0) AS cost
         FROM review_passes WHERE run_id=? AND status='landed'`,
    )
    .get(runId) as { tokens: number; cost: number };
  if (
    used.tokens + actualTokens > run.max_total_tokens ||
    used.cost + actualCost > run.max_total_cost_microusd
  ) {
    ctx.db.transaction(() => {
      ctx.db
        .prepare(
          "UPDATE review_passes SET status='failed', failure='aggregate budget exceeded' WHERE pass_id=?",
        )
        .run(pass.pass_id);
      setRunStatus(ctx, runId, "failed");
    })();
    throw new ToolError("review analysis aggregate budget exceeded");
  }
  if (!Array.isArray(args.judgments)) throw new ToolError("judgments must be an array");
  const judgments = args.judgments.map((item, index) => requireObject(item, `judgments[${index}]`));
  if (pass.role === "generator" && judgments.length === 0) {
    requireString(args, "no_findings_reason");
    const coverage = requireObject(args.coverage, "coverage");
    requireStringArray(coverage, "areas_checked", { minLength: 1 });
  }
  const hypotheses = ctx.db
    .prepare(
      "SELECT hypothesis_id, finding_key, challenge_packet_json FROM review_hypotheses WHERE run_id=? ORDER BY ordinal",
    )
    .all(runId) as Array<{
    hypothesis_id: string;
    finding_key: string;
    challenge_packet_json: string;
  }>;
  if (pass.role !== "generator") {
    const submitted = judgments.map((item) => requireString(item, "hypothesis_id")).sort();
    const expected = hypotheses.map((item) => item.hypothesis_id).sort();
    if (stableJson(submitted) !== stableJson(expected)) {
      throw new ToolError("challenge judgments must exactly reconcile every frozen hypothesis");
    }
  }
  const newEvidence = parseNewEvidence(args);
  validateEvidence(
    ctx,
    run,
    newEvidence.map((row) => ({ ...row, id: row.local_key })),
  );
  const localEvidence = new Map<string, number>();
  const dispatchedInput = parseJson<Record<string, unknown>>(pass.runtime_input_json, {});
  const allowedPacketEvidence = (hypothesisId: string | null): Set<number> => {
    if (pass.role === "generator") {
      const catalog = Array.isArray(dispatchedInput.evidence_catalog)
        ? (dispatchedInput.evidence_catalog as Array<Record<string, unknown>>)
        : [];
      return new Set(catalog.map((row) => Number(row.id)).filter(Number.isInteger));
    }
    const packets = Array.isArray(dispatchedInput.hypotheses)
      ? (dispatchedInput.hypotheses as Array<Record<string, unknown>>)
      : [];
    const packet = packets.find((row) => row.hypothesis_id === hypothesisId);
    const evidence =
      packet && Array.isArray(packet.evidence)
        ? (packet.evidence as Array<Record<string, unknown>>)
        : [];
    return new Set(evidence.map((row) => Number(row.id)).filter(Number.isInteger));
  };
  const resultPayload = {
    judgments,
    no_findings_reason: optString(args, "no_findings_reason"),
    coverage: args.coverage ?? null,
    new_evidence: newEvidence,
    actual_tokens: actualTokens,
    actual_cost_microusd: actualCost,
  };
  const resultJson = stableJson(resultPayload);
  ctx.db.transaction(() => {
    const evidenceInsert = ctx.db.prepare(
      `INSERT INTO evidence
         (file_path, symbol, line_range, ref_sha, kind, excerpt, note, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of newEvidence) {
      const inserted = evidenceInsert.run(
        row.file_path,
        row.symbol,
        row.line_range,
        row.ref_sha,
        row.kind,
        row.excerpt,
        row.note,
        sessionId,
      );
      localEvidence.set(row.local_key, Number(inserted.lastInsertRowid));
    }
    const judgmentInsert = ctx.db.prepare(
      `INSERT INTO review_judgments
         (judgment_id, pass_id, hypothesis_id, finding_key, claim, severity,
          scope, verdict, rationale, payload_json, payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const evidenceLink = ctx.db.prepare(
      `INSERT INTO review_judgment_evidence (judgment_id, evidence_id, origin)
       VALUES (?, ?, ?)`,
    );
    const seenKeys = new Set<string>();
    judgments.forEach((item, index) => {
      const existingIds =
        item.evidence_ids == null
          ? []
          : (() => {
              if (!Array.isArray(item.evidence_ids) || !item.evidence_ids.every(Number.isInteger)) {
                throw new ToolError(`judgments[${index}].evidence_ids must be integer[]`);
              }
              return item.evidence_ids as number[];
            })();
      const newKeys =
        item.new_evidence_keys == null ? [] : requireStringArray(item, "new_evidence_keys");
      const unknownKeys = newKeys.filter((key) => !localEvidence.has(key));
      if (unknownKeys.length > 0)
        throw new ToolError(`unknown new_evidence_keys: ${unknownKeys.join(", ")}`);
      const discoveredIds = newKeys.map((key) => localEvidence.get(key) as number);
      const allEvidenceIds = unique([...existingIds, ...discoveredIds].map(String)).map(Number);
      const rows = evidenceRows(ctx, allEvidenceIds);
      validateEvidence(ctx, run, rows);
      let hypothesisId: string | null = null;
      let findingKey: string;
      let claim: string;
      let severity: string | null;
      let scope: string | null;
      let verdict: string;
      if (pass.role === "generator") {
        findingKey = requireString(item, "finding_key");
        if (seenKeys.has(findingKey))
          throw new ToolError(`duplicate finding_key in pass: ${findingKey}`);
        seenKeys.add(findingKey);
        claim = requireString(item, "claim");
        severity = requireEnum(item, "severity", SEVERITIES);
        scope = requireString(item, "scope");
        verdict = "proposed";
        if (allEvidenceIds.length === 0)
          throw new ToolError("generator candidates require evidence");
      } else {
        hypothesisId = requireString(item, "hypothesis_id");
        const hypothesis = hypotheses.find((candidate) => candidate.hypothesis_id === hypothesisId);
        if (!hypothesis) throw new ToolError(`unknown hypothesis_id: ${hypothesisId}`);
        findingKey = hypothesis.finding_key;
        const packet = JSON.parse(hypothesis.challenge_packet_json) as { claims: string[] };
        claim = packet.claims.join(" | ");
        severity = null;
        scope = null;
        verdict = requireEnum(item, "verdict", VERDICTS);
        if (verdict === "overturned" && allEvidenceIds.length === 0) {
          throw new ToolError("an overturn requires evidence");
        }
        if (pass.role === "refuter" && verdict === "overturned" && discoveredIds.length === 0) {
          throw new ToolError("a refuter can overturn only with newly discovered evidence");
        }
      }
      const packetEvidence = allowedPacketEvidence(hypothesisId);
      const unassigned = existingIds.filter((evidenceId) => !packetEvidence.has(evidenceId));
      if (unassigned.length > 0) {
        throw new ToolError(`evidence not assigned to this pass packet: ${unassigned.join(", ")}`);
      }
      const rationale = requireString(item, "rationale");
      const judgmentId = `${pass.pass_id}:judgment:${index}`;
      const payload = {
        hypothesis_id: hypothesisId,
        finding_key: findingKey,
        claim,
        severity,
        scope,
        verdict,
        rationale,
        evidence_ids: allEvidenceIds,
      };
      const payloadJson = stableJson(payload);
      judgmentInsert.run(
        judgmentId,
        pass.pass_id,
        hypothesisId,
        findingKey,
        claim,
        severity,
        scope,
        verdict,
        rationale,
        payloadJson,
        hash(payloadJson),
      );
      for (const evidenceId of existingIds)
        evidenceLink.run(judgmentId, evidenceId, "prior-packet");
      for (const evidenceId of discoveredIds)
        evidenceLink.run(judgmentId, evidenceId, "discovered-by-pass");
    });
    ctx.db
      .prepare(
        `UPDATE review_passes
            SET status='landed', result_json=?, result_hash=?, actual_tokens=?,
                actual_cost_microusd=?, landed_at=datetime('now') WHERE pass_id=?`,
      )
      .run(resultJson, hash(resultJson), actualTokens, actualCost, pass.pass_id);
    if (pass.role === "refuter") {
      const remaining = ctx.db
        .prepare(
          "SELECT COUNT(*) AS n FROM review_passes WHERE run_id=? AND role='refuter' AND status!='landed'",
        )
        .get(runId) as { n: number };
      if (remaining.n === 0) setRunStatus(ctx, runId, "verification-ready");
    }
    if (pass.role === "verifier") {
      const remaining = ctx.db
        .prepare(
          "SELECT COUNT(*) AS n FROM review_passes WHERE run_id=? AND role='verifier' AND status!='landed'",
        )
        .get(runId) as { n: number };
      if (remaining.n === 0) setRunStatus(ctx, runId, "ready-to-aggregate");
    }
  })();
  return readAnalysis(ctx, runId);
}

function freeze(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "freeze_review_hypotheses");
  const runId = requireString(args, "run_id");
  const run = getRun(ctx, runId);
  if (run.status !== "generating")
    throw new ToolError(`cannot freeze hypotheses while ${run.status}`);
  const pending = ctx.db
    .prepare(
      "SELECT COUNT(*) AS n FROM review_passes WHERE run_id=? AND role='generator' AND status!='landed'",
    )
    .get(runId) as { n: number };
  if (pending.n > 0) throw new ToolError(`${pending.n} generator passes have not landed`);
  const candidates = ctx.db
    .prepare(
      `SELECT j.*, p.ordinal AS pass_ordinal
         FROM review_judgments j JOIN review_passes p ON p.pass_id=j.pass_id
        WHERE p.run_id=? AND p.role='generator' ORDER BY j.finding_key, p.ordinal, j.judgment_id`,
    )
    .all(runId) as Array<
    Record<string, unknown> & {
      judgment_id: string;
      finding_key: string;
      claim: string;
    }
  >;
  const grouped = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const rows = grouped.get(candidate.finding_key) ?? [];
    rows.push(candidate);
    grouped.set(candidate.finding_key, rows);
  }
  ctx.db.transaction(() => {
    const hypothesisInsert = ctx.db.prepare(
      `INSERT INTO review_hypotheses
         (hypothesis_id, run_id, ordinal, finding_key, challenge_packet_json, challenge_packet_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const mapInsert = ctx.db.prepare(
      "INSERT INTO review_hypothesis_candidates (hypothesis_id, judgment_id) VALUES (?, ?)",
    );
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([findingKey, rows], ordinal) => {
        const evidenceIds = (
          ctx.db
            .prepare(
              `SELECT DISTINCT je.evidence_id FROM review_judgment_evidence je
                WHERE je.judgment_id IN (${rows.map(() => "?").join(",")}) ORDER BY je.evidence_id`,
            )
            .all(...rows.map((row) => row.judgment_id)) as Array<{ evidence_id: number }>
        ).map((row) => row.evidence_id);
        const packet = {
          finding_key: findingKey,
          claims: unique(rows.map((row) => row.claim)),
          evidence: evidenceRows(ctx, evidenceIds),
        };
        const packetJson = stableJson(packet);
        const hypothesisId = `${runId}:hypothesis:${hash(findingKey).slice(0, 16)}`;
        hypothesisInsert.run(
          hypothesisId,
          runId,
          ordinal,
          findingKey,
          packetJson,
          hash(packetJson),
        );
        for (const row of rows) mapInsert.run(hypothesisId, row.judgment_id);
      });
    setRunStatus(ctx, runId, "hypotheses-frozen");
  })();
  return readAnalysis(ctx, runId);
}

function aggregate(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "aggregate_review_analysis");
  const runId = requireString(args, "run_id");
  const run = getRun(ctx, runId);
  if (run.status !== "ready-to-aggregate") {
    throw new ToolError(`review analysis run ${runId} is ${run.status}, not ready-to-aggregate`);
  }
  const passes = ctx.db
    .prepare("SELECT * FROM review_passes WHERE run_id=? ORDER BY ordinal")
    .all(runId) as Array<ReviewPass>;
  const expected =
    run.expected_generator_count + run.expected_refuter_count + run.expected_verifier_count;
  const landed = passes.filter((pass) => pass.status === "landed");
  if (landed.length !== expected || passes.length !== expected) {
    throw new ToolError(
      `review pass fan-in mismatch: expected ${expected}, landed ${landed.length}`,
    );
  }
  const hypotheses = ctx.db
    .prepare("SELECT * FROM review_hypotheses WHERE run_id=? ORDER BY ordinal")
    .all(runId) as Array<Record<string, unknown> & { hypothesis_id: string; finding_key: string }>;
  const results = hypotheses.map((hypothesis) => {
    const judgments = ctx.db
      .prepare(
        `SELECT j.*, p.role, p.pass_id, p.model_family
           FROM review_judgments j JOIN review_passes p ON p.pass_id=j.pass_id
          WHERE p.run_id=? AND j.hypothesis_id=? ORDER BY p.ordinal`,
      )
      .all(runId, hypothesis.hypothesis_id) as Array<
      Record<string, unknown> & {
        judgment_id: string;
        role: Role;
        verdict: string;
      }
    >;
    const expectedJudgments = run.expected_refuter_count + run.expected_verifier_count;
    if (judgments.length !== expectedJudgments) {
      throw new ToolError(`hypothesis ${hypothesis.hypothesis_id} judgment fan-in mismatch`);
    }
    const discoveredOverturnEvidence = new Set(
      (
        ctx.db
          .prepare(
            `SELECT DISTINCT je.evidence_id
               FROM review_judgments j
               JOIN review_passes p ON p.pass_id=j.pass_id
               JOIN review_judgment_evidence je ON je.judgment_id=j.judgment_id
              WHERE p.run_id=? AND p.role='refuter' AND j.hypothesis_id=?
                AND j.verdict='overturned' AND je.origin='discovered-by-pass'`,
          )
          .all(runId, hypothesis.hypothesis_id) as Array<{ evidence_id: number }>
      ).map((row) => row.evidence_id),
    );
    const verifierOverturnEvidence = new Set(
      (
        ctx.db
          .prepare(
            `SELECT DISTINCT je.evidence_id
               FROM review_judgments j
               JOIN review_passes p ON p.pass_id=j.pass_id
               JOIN review_judgment_evidence je ON je.judgment_id=j.judgment_id
              WHERE p.run_id=? AND p.role='verifier' AND j.hypothesis_id=?
                AND j.verdict='overturned'`,
          )
          .all(runId, hypothesis.hypothesis_id) as Array<{ evidence_id: number }>
      ).map((row) => row.evidence_id),
    );
    const verifiedDefeat = [...discoveredOverturnEvidence].some((id) =>
      verifierOverturnEvidence.has(id),
    );
    const unanimousUphold = judgments.every((judgment) => judgment.verdict === "upheld");
    const finalStatus = verifiedDefeat ? "defeated" : unanimousUphold ? "survived" : "contested";
    const hasDisagreement = new Set(judgments.map((judgment) => judgment.verdict)).size > 1;
    const candidateJudgments = ctx.db
      .prepare(
        `SELECT j.*, p.pass_id, p.model_family
           FROM review_hypothesis_candidates hc
           JOIN review_judgments j ON j.judgment_id=hc.judgment_id
           JOIN review_passes p ON p.pass_id=j.pass_id
          WHERE hc.hypothesis_id=? ORDER BY p.ordinal`,
      )
      .all(hypothesis.hypothesis_id);
    return {
      hypothesis_id: hypothesis.hypothesis_id,
      finding_key: hypothesis.finding_key,
      generator_recurrence: candidateJudgments.length,
      final_status: finalStatus,
      has_disagreement: hasDisagreement,
      evidence_that_moved_status: verifiedDefeat
        ? [...discoveredOverturnEvidence].filter((id) => verifierOverturnEvidence.has(id))
        : [],
      candidates: candidateJudgments,
      independent_judgments: judgments,
    };
  });
  const result = {
    schema_version: 1,
    run_id: runId,
    reviewed_sha: run.reviewed_sha,
    condition: run.condition,
    fan_in: { expected_passes: expected, landed_passes: landed.length },
    hypotheses: results,
    disagreements: results.filter((result) => result.has_disagreement),
    defeated_hypotheses: results.filter((result) => result.final_status === "defeated"),
    retained_finding_keys: results
      .filter((result) => result.final_status === "survived")
      .map((result) => result.finding_key)
      .sort(),
  };
  const resultJson = stableJson(result);
  const survived = results.filter((result) => result.final_status === "survived").length;
  const defeated = results.filter((result) => result.final_status === "defeated").length;
  const contested = results.length - survived - defeated;
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO review_aggregations
           (run_id, expected_pass_count, landed_pass_count, hypothesis_count,
            survived_count, defeated_count, contested_count, result_json,
            result_hash, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        expected,
        landed.length,
        results.length,
        survived,
        defeated,
        contested,
        resultJson,
        hash(resultJson),
        sessionId,
      );
    setRunStatus(ctx, runId, "aggregated");
  })();
  return readAnalysis(ctx, runId);
}

function parseTruth(args: Record<string, unknown>): BlindTruth {
  const row = requireObject(args.truth, "truth");
  return {
    assignment_id: requireString(row, "assignment_id"),
    arm_type: requireEnum(row, "arm_type", BLIND_ARMS),
    pair_id: requireString(row, "pair_id"),
    replicate_id: requireString(row, "replicate_id"),
    surface_contract_hash: requireString(row, "surface_contract_hash"),
    expected_finding_keys: unique(requireStringArray(row, "expected_finding_keys")),
    leak_canary: requireString(row, "leak_canary"),
  };
}

function reveal(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "reveal_review_analysis_truth");
  const runId = requireString(args, "run_id");
  const run = getRun(ctx, runId);
  if (!["aggregated", "contaminated"].includes(run.status)) {
    throw new ToolError(
      `blind truth can be revealed only after terminal judgment, not ${run.status}`,
    );
  }
  if (ctx.db.prepare("SELECT 1 FROM review_blind_reveals WHERE run_id=?").get(runId)) {
    throw new ToolError(`blind truth already revealed for ${runId}`);
  }
  const truth = parseTruth(args);
  if (truth.assignment_id !== run.blind_assignment_id || truth.replicate_id !== run.replicate_id) {
    throw new ToolError("blind truth assignment or replicate does not match the sealed run");
  }
  const computed = truthHash(requireString(args, "salt"), truth);
  if (computed !== run.sealed_truth_hash) throw new ToolError("blind truth seal mismatch");
  const canaryPasses = (
    ctx.db
      .prepare(
        "SELECT pass_id, runtime_input_json FROM review_passes WHERE run_id=? AND runtime_input_json IS NOT NULL",
      )
      .all(runId) as Array<{ pass_id: string; runtime_input_json: string }>
  ).filter((pass) => pass.runtime_input_json.includes(truth.leak_canary));
  for (const pass of canaryPasses) {
    recordContamination(ctx, runId, pass.pass_id, "content-canary", {
      leak_canary_hash: hash(truth.leak_canary),
    });
  }
  const contaminated =
    canaryPasses.length > 0 ||
    Number(
      (
        ctx.db
          .prepare("SELECT COUNT(*) AS n FROM review_contamination_events WHERE run_id=?")
          .get(runId) as { n: number }
      ).n,
    ) > 0;
  ctx.db
    .prepare(
      `INSERT INTO review_blind_reveals
         (run_id, truth_json, truth_hash, contaminated, revealed_by)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(runId, stableJson(truth), computed, contaminated ? 1 : 0, sessionId);
  return readAnalysis(ctx, runId);
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  return [...a].filter((item) => b.has(item)).length / union.size;
}

function scoreEvaluation(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "score_review_evaluation");
  const evaluationId = requireString(args, "evaluation_id");
  if (ctx.db.prepare("SELECT 1 FROM review_evaluations WHERE evaluation_id=?").get(evaluationId)) {
    throw new ToolError(`review evaluation already exists: ${evaluationId}`);
  }
  const runIds = unique(requireStringArray(args, "run_ids", { minLength: 1 }));
  const rows = runIds.map((runId) => {
    const run = getRun(ctx, runId);
    const revealRow = ctx.db
      .prepare("SELECT * FROM review_blind_reveals WHERE run_id=?")
      .get(runId) as { truth_json: string; contaminated: number } | undefined;
    if (!revealRow) throw new ToolError(`blind truth not revealed for ${runId}`);
    const aggregation = ctx.db
      .prepare("SELECT result_json FROM review_aggregations WHERE run_id=?")
      .get(runId) as { result_json: string } | undefined;
    const truth = JSON.parse(revealRow.truth_json) as BlindTruth;
    const result = aggregation
      ? (JSON.parse(aggregation.result_json) as { retained_finding_keys: string[] })
      : null;
    const passShapes = (
      ctx.db
        .prepare(
          `SELECT role, runtime_input_json FROM review_passes
            WHERE run_id=? AND runtime_input_json IS NOT NULL ORDER BY ordinal`,
        )
        .all(runId) as Array<{ role: Role; runtime_input_json: string }>
    ).map((pass) => ({ role: pass.role, shape: jsonShape(JSON.parse(pass.runtime_input_json)) }));
    return {
      run,
      truth,
      result,
      observed_surface_hash: hash(stableJson(passShapes)),
      contaminated: revealRow.contaminated === 1 || run.status === "contaminated",
    };
  });
  const excluded = rows.filter((row) => row.contaminated).map((row) => row.run.run_id);
  const included = rows.filter((row) => !row.contaminated && row.result !== null);
  const conditions: Record<string, unknown> = {};
  const redReasons: string[] = [];
  for (const condition of CONDITIONS) {
    const conditionRows = included.filter((row) => row.run.condition === condition);
    const rowsByPair = new Map<string, typeof conditionRows>();
    for (const row of conditionRows) {
      const pair = rowsByPair.get(row.truth.pair_id) ?? [];
      pair.push(row);
      rowsByPair.set(row.truth.pair_id, pair);
    }
    for (const [pairId, pairRows] of rowsByPair) {
      for (const arm of BLIND_ARMS) {
        const count = pairRows.filter((row) => row.truth.arm_type === arm).length;
        if (count !== 1) {
          redReasons.push(`${condition}/${pairId} has ${count} ${arm} runs, requires exactly 1`);
        }
      }
    }
    const armReports: Record<string, unknown> = {};
    for (const arm of BLIND_ARMS) {
      const armRows = conditionRows.filter((row) => row.truth.arm_type === arm);
      if (armRows.length < 2)
        redReasons.push(`${condition}/${arm} has ${armRows.length} replicates, requires 2`);
      const runReports = armRows.map((row) => {
        const predicted = unique(row.result?.retained_finding_keys ?? []);
        const expected = unique(row.truth.expected_finding_keys);
        return {
          run_id: row.run.run_id,
          replicate_id: row.run.replicate_id,
          pair_id: row.truth.pair_id,
          predicted,
          expected,
          exact: stableJson(predicted) === stableJson(expected),
          step_size: 1 / Math.max(1, new Set([...predicted, ...expected]).size),
        };
      });
      const stability =
        runReports.length < 2
          ? null
          : Math.min(
              ...runReports
                .slice(1)
                .map((row) => jaccard(runReports[0]?.predicted ?? [], row.predicted)),
            );
      armReports[arm] = { runs: runReports, test_retest_jaccard: stability };
      for (const report of runReports) {
        if (!report.exact)
          redReasons.push(`${condition}/${arm}/${report.run_id} differs from sealed truth`);
      }
    }
    const cleanByPair = new Map(
      conditionRows
        .filter((row) => row.truth.arm_type === "clean")
        .map((row) => [row.truth.pair_id, unique(row.result?.retained_finding_keys ?? [])]),
    );
    const markerDeltas = conditionRows
      .filter((row) => row.truth.arm_type === "marker-only")
      .map((row) => {
        const clean = cleanByPair.get(row.truth.pair_id) ?? [];
        const marker = unique(row.result?.retained_finding_keys ?? []);
        const extra = marker.filter((key) => !clean.includes(key));
        return { pair_id: row.truth.pair_id, clean, marker, extra };
      });
    if (markerDeltas.some((delta) => delta.extra.length > 0)) {
      redReasons.push(`${condition} marker-only arm has directional contamination`);
    }
    conditions[condition] = {
      arms: armReports,
      marker_treated_vs_untreated: markerDeltas,
      pooled_summary: null,
      pooling_policy: "reported separately; no cross-condition or cross-arm pooling",
    };
  }
  const declaredSurfaceHashes = unique(included.map((row) => row.truth.surface_contract_hash));
  if (declaredSurfaceHashes.length !== 1) {
    redReasons.push("blind arms do not declare one surface contract");
  }
  const observedSurfaceHashes: Record<string, string[]> = {};
  for (const condition of CONDITIONS) {
    observedSurfaceHashes[condition] = unique(
      included
        .filter((row) => row.run.condition === condition)
        .map((row) => row.observed_surface_hash),
    );
    if (observedSurfaceHashes[condition].length !== 1) {
      redReasons.push(`${condition} dispatched packets are not surface-identical`);
    }
  }
  const report = {
    schema_version: 1,
    evaluation_id: evaluationId,
    included_runs: included.map((row) => row.run.run_id),
    excluded_contaminated_runs: excluded,
    conditions,
    declared_surface_contract_hashes: declaredSurfaceHashes,
    observed_surface_hashes: observedSurfaceHashes,
    status: redReasons.length === 0 ? "valid" : "red",
    red_reasons: redReasons,
  };
  const reportJson = stableJson(report);
  ctx.db
    .prepare(
      `INSERT INTO review_evaluations
         (evaluation_id, run_ids_json, included_run_count, excluded_run_count,
          status, report_json, report_hash, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      evaluationId,
      JSON.stringify(runIds),
      included.length,
      excluded.length,
      report.status,
      reportJson,
      hash(reportJson),
      sessionId,
    );
  return report;
}

const PASS_SPEC_SCHEMA = {
  type: "object",
  properties: {
    pass_id: { type: "string" },
    role: { type: "string", enum: ROLES },
    replicate_id: { type: "string" },
    context_profile: { type: "string", enum: PROFILES },
    analytical_frame: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    model_family: { type: "string" },
    runtime: { type: "string" },
    planned_tokens: { type: "integer", minimum: 1 },
    planned_cost_microusd: { type: "integer", minimum: 0 },
  },
  required: [
    "pass_id",
    "role",
    "replicate_id",
    "context_profile",
    "analytical_frame",
    "provider",
    "model",
    "model_family",
    "runtime",
    "planned_tokens",
    "planned_cost_microusd",
  ],
  additionalProperties: false,
};

export const reviewAnalysisTools: ToolDefinition[] = [
  {
    name: "plan_review_analysis",
    description:
      "Plan a sealed, observe-only A7 review analysis with at least two generator, refuter, and verifier passes. The manifest isolates same-context, varied-context, or heterogeneous-runtime conditions, pins provider and budget bounds, and accepts only published A6 briefs from one reviewed commit.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        replicate_id: { type: "string" },
        condition: { type: "string", enum: CONDITIONS },
        orchestrator_model_family: { type: "string" },
        provider_allowlist: { type: "array", items: { type: "string" }, minItems: 1 },
        allowed_source_prefixes: { type: "array", items: { type: "string" }, minItems: 1 },
        max_total_tokens: { type: "integer", minimum: 1 },
        max_total_cost_microusd: { type: "integer", minimum: 0 },
        blind_assignment_id: { type: "string" },
        sealed_truth_hash: { type: "string" },
        brief_ids: { type: "array", items: { type: "string" }, minItems: 1 },
        pass_specs: { type: "array", items: PASS_SPEC_SCHEMA, minItems: 6 },
        validation_inject_leak: { type: "string", enum: LEAK_INJECTIONS },
      },
      required: [
        "run_id",
        "replicate_id",
        "condition",
        "orchestrator_model_family",
        "provider_allowlist",
        "allowed_source_prefixes",
        "max_total_tokens",
        "max_total_cost_microusd",
        "blind_assignment_id",
        "sealed_truth_hash",
        "brief_ids",
        "pass_specs",
      ],
      additionalProperties: false,
    },
    handler: (args, ctx) => plan(args, ctx),
  },
  {
    name: "dispatch_review_pass",
    description:
      "Dispatch one durable review outbox packet at its allowed stage. Generators receive one published ReviewBrief; refuters receive anonymous claim-plus-evidence packets; verifiers receive pooled evidence without prior verdicts. Structural leakage marks the run contaminated before provider work.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" }, pass_id: { type: "string" } },
      required: ["run_id", "pass_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => dispatch(args, ctx),
  },
  {
    name: "land_review_pass",
    description:
      "Land one independent pass exactly once with usage, structured judgments, and repository-valid evidence inside the sealed source and budget envelope. Generator empty results require a non-vacuity report; refuter overturns require newly discovered disproving evidence.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        pass_id: { type: "string" },
        judgments: { type: "array", items: { type: "object" } },
        new_evidence: { type: "array", items: { type: "object" } },
        no_findings_reason: { type: "string" },
        coverage: { type: "object" },
        actual_tokens: { type: "integer", minimum: 0 },
        actual_cost_microusd: { type: "integer", minimum: 0 },
      },
      required: ["run_id", "pass_id", "judgments", "actual_tokens", "actual_cost_microusd"],
      additionalProperties: false,
    },
    handler: (args, ctx) => land(args, ctx),
  },
  {
    name: "fail_review_pass",
    description:
      "Record a dispatched review pass failure and halt the analysis without manufacturing fan-in or retrying under the same pass identity.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        pass_id: { type: "string" },
        failure: { type: "string" },
      },
      required: ["run_id", "pass_id", "failure"],
      additionalProperties: false,
    },
    handler: (args, ctx) => failPass(args, ctx),
  },
  {
    name: "freeze_review_hypotheses",
    description:
      "After every generator lands, mechanically freeze candidate finding keys into anonymous challenge packets containing claim variants and structured evidence but no rationale, confidence, provider, model, or pass identity.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => freeze(args, ctx),
  },
  {
    name: "aggregate_review_analysis",
    description:
      "Mechanically aggregate only after exact generator/refuter/verifier fan-in. Retain every disagreement and rationale; mark a hypothesis defeated only when a refuter's newly discovered evidence is independently reused by an overturning verifier.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => aggregate(args, ctx),
  },
  {
    name: "reveal_review_analysis_truth",
    description:
      "Reveal a blind fixture only after judgment is terminal, verify its salted seal, scan every dispatched packet for the content canary, and durably mark contaminated runs for exclusion.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        salt: { type: "string" },
        truth: {
          type: "object",
          properties: {
            assignment_id: { type: "string" },
            arm_type: { type: "string", enum: BLIND_ARMS },
            pair_id: { type: "string" },
            replicate_id: { type: "string" },
            surface_contract_hash: { type: "string" },
            expected_finding_keys: { type: "array", items: { type: "string" } },
            leak_canary: { type: "string" },
          },
          required: [
            "assignment_id",
            "arm_type",
            "pair_id",
            "replicate_id",
            "surface_contract_hash",
            "expected_finding_keys",
            "leak_canary",
          ],
          additionalProperties: false,
        },
      },
      required: ["run_id", "salt", "truth"],
      additionalProperties: false,
    },
    handler: (args, ctx) => reveal(args, ctx),
  },
  {
    name: "score_review_evaluation",
    description:
      "Score sealed clean, marker-only, treated, and null arms with at least two replicates per same-context, varied-context, and heterogeneous-runtime condition. Report each cell separately with set stability and metric step size; never pool, and exclude contaminated runs.",
    inputSchema: {
      type: "object",
      properties: {
        evaluation_id: { type: "string" },
        run_ids: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      required: ["evaluation_id", "run_ids"],
      additionalProperties: false,
    },
    handler: (args, ctx) => scoreEvaluation(args, ctx),
  },
  {
    name: "get_review_analysis",
    description:
      "Read review-analysis manifest, pass custody, contamination, aggregation, and post-judgment reveal. Before aggregation it exposes pass status and hashes, never another pass's private runtime input or judgment payload.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => readAnalysis(ctx, requireString(args, "run_id")),
  },
];
