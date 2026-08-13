import { execFileSync } from "node:child_process";
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
import { artifactTools } from "./artifacts.js";
import { claimTools } from "./claims.js";
import { codebaseBriefTools } from "./codebase-brief.js";
import { decisionTools } from "./decisions.js";
import { evidenceTools } from "./evidence.js";
import { fileTools } from "./files.js";
import { projectTools } from "./project.js";
import { refreshTools } from "./refresh.js";
import { researchTools } from "./research.js";
import { revalidationTools } from "./revalidation.js";
import { reviewTools } from "./review.js";
import { subsystemTools } from "./subsystems.js";

const ADAPTER_KINDS = [
  "CodebaseBrief",
  "ReviewBrief",
  "ResearchRequest",
  "Decision",
  "Obligation",
  "RunManifest",
] as const;
type AdapterKind = (typeof ADAPTER_KINDS)[number];

const CUSTODY_MATRIX = {
  schema_version: "1.0.0",
  rows: [
    {
      asset: "durable truth",
      owner: "amanuensis",
      chorusmith_authority: "projection-and-invocation-only",
      non_transferable: ["evidence gates", "knowledge depth", "decision authority", "completion"],
    },
    {
      asset: "session artifacts",
      owner: "chorusmith",
      amanuensis_authority: "validate-and-land-domain-results",
      non_transferable: ["attempt routing", "context assembly receipts"],
    },
    {
      asset: "provider configuration",
      owner: "chorusmith",
      amanuensis_authority: "enforce-preauthorized-envelope",
      non_transferable: ["provider selection", "retry policy"],
    },
    {
      asset: "user preferences",
      owner: "human",
      chorusmith_authority: "transport-only",
      amanuensis_authority: "typed-scoped-custody-only",
      non_transferable: ["preference origination", "scope expansion"],
    },
  ],
} as const;

const ADAPTER_CATALOG: Record<
  AdapterKind,
  {
    artifactKind: string;
    schemaRef: string;
    outputSlot: string;
    readTool: string;
    mutationTools: string[];
  }
> = {
  CodebaseBrief: {
    artifactKind: "AmanuensisCodebaseBrief",
    schemaRef: "AmanuensisCodebaseBrief@1.0.0",
    outputSlot: "codebase-brief",
    readTool: "get_codebase_brief",
    mutationTools: [
      "add_evidence",
      "add_claim",
      "prepare_codebase_brief_source",
      "compile_codebase_brief",
      "validate_codebase_brief",
    ],
  },
  ReviewBrief: {
    artifactKind: "AmanuensisReviewBrief",
    schemaRef: "AmanuensisReviewBrief@1.0.0",
    outputSlot: "review-brief",
    readTool: "get_review_brief",
    mutationTools: ["compile_review_brief", "publish_review_brief"],
  },
  ResearchRequest: {
    artifactKind: "AmanuensisResearchRequest",
    schemaRef: "AmanuensisResearchRequest@1.0.0",
    outputSlot: "research-request",
    readTool: "get_research_request",
    mutationTools: [
      "propose_research_request",
      "dispatch_research_request",
      "land_research_result",
      "consume_research_result",
      "expire_research_request",
    ],
  },
  Decision: {
    artifactKind: "AmanuensisDecision",
    schemaRef: "AmanuensisDecision@1.0.0",
    outputSlot: "decision",
    readTool: "get_decision",
    mutationTools: [
      "draft_decision_revision",
      "accept_decision_revision",
      "reject_decision_revision",
    ],
  },
  Obligation: {
    artifactKind: "AmanuensisObligation",
    schemaRef: "AmanuensisObligation@1.0.0",
    outputSlot: "obligation",
    readTool: "get_revalidation_dashboard",
    mutationTools: [
      "invalidate_decision_revision",
      "detect_decision_impacts",
      "plan_revalidation_run",
      "dispatch_revalidation_attempt",
      "land_revalidation_result",
      "fail_revalidation_attempt",
      "score_revalidation_result",
      "reconcile_revalidation_run",
    ],
  },
  RunManifest: {
    artifactKind: "AmanuensisRunManifest",
    schemaRef: "AmanuensisRunManifest@1.0.0",
    outputSlot: "run-manifest",
    readTool: "get_chorusmith_adapter_run",
    mutationTools: [
      "start_session",
      "upsert_subsystem",
      "add_files_to_scope",
      "update_subsystem_status",
      "register_artifact",
      "plan_refresh_run",
      "execute_refresh_run",
      "resume_refresh_run",
      "cancel_refresh_run",
    ],
  },
};

const DOMAIN_TOOLS = new Map(
  [
    ...projectTools,
    ...subsystemTools,
    ...fileTools,
    ...artifactTools,
    ...evidenceTools,
    ...claimTools,
    ...codebaseBriefTools,
    ...reviewTools,
    ...researchTools,
    ...decisionTools,
    ...revalidationTools,
    ...refreshTools,
  ].map((tool) => [tool.name, tool]),
);

interface AdapterRunRow {
  run_id: string;
  external_run_ref: string;
  manifest_json: string;
  manifest_hash: string;
  expected_step_count: number;
  expected_snapshot_hash: string;
  status: "planned" | "running" | "ready" | "verified";
  recovery_count: number;
}

function checkedOutCommit(ctx: ServerContext): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ctx.project.workspacePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new ToolError("cannot resolve the checked-out repository commit");
  }
}

function assertRunSourceCommit(ctx: ServerContext, currentRun: AdapterRunRow): void {
  const manifest = JSON.parse(currentRun.manifest_json) as Record<string, unknown>;
  const expected = requireString(manifest, "source_commit");
  const actual = checkedOutCommit(ctx);
  if (actual !== expected) {
    throw new ToolError(`adapter source commit drift: expected ${expected}, found ${actual}`);
  }
  try {
    const trackedChanges = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: ctx.project.workspacePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (trackedChanges.length > 0) {
      throw new ToolError("adapter source commit has tracked worktree changes");
    }
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("cannot verify the adapter source worktree");
  }
}

interface AdapterStepRow {
  step_id: string;
  run_id: string;
  ordinal: number;
  adapter_kind: AdapterKind;
  tool_name: string;
  args_json: string;
  args_hash: string;
  expected_output_keys_json: string;
  status: "planned" | "landed";
  output_json: string | null;
  output_hash: string | null;
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

function integerIds(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(Number.isInteger)) {
    throw new ToolError(`${field} must contain integer IDs`);
  }
  const result = [...new Set(value as number[])].sort((left, right) => left - right);
  if (result.length !== value.length) throw new ToolError(`${field} contains duplicate IDs`);
  return result;
}

function run(ctx: ServerContext, runId: string): AdapterRunRow {
  const row = ctx.db.prepare("SELECT * FROM chorusmith_adapter_runs WHERE run_id=?").get(runId) as
    | AdapterRunRow
    | undefined;
  if (!row) throw new ToolError(`unknown Chorusmith adapter run: ${runId}`);
  return row;
}

function resolveCommit(ctx: ServerContext, requested: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--verify", `${requested}^{commit}`], {
      cwd: ctx.project.workspacePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new ToolError(`source_commit is not a repository commit: ${requested}`);
  }
}

interface ParityScope {
  claim_ids: string[];
  decision_ids: string[];
  obligation_ids: string[];
  evidence_ids: number[];
}

function parseScope(value: unknown): ParityScope {
  const row = object(value, "parity_scope");
  const claimIds = strings(row.claim_ids, "parity_scope.claim_ids");
  const decisionIds = strings(row.decision_ids, "parity_scope.decision_ids");
  const obligationIds = strings(row.obligation_ids, "parity_scope.obligation_ids");
  for (const [field, ids] of [
    ["claim_ids", claimIds],
    ["decision_ids", decisionIds],
    ["obligation_ids", obligationIds],
  ] as const) {
    if (ids.length !== (row[field] as unknown[]).length) {
      throw new ToolError(`parity_scope.${field} contains duplicate IDs`);
    }
  }
  return {
    claim_ids: claimIds.sort(),
    decision_ids: decisionIds.sort(),
    obligation_ids: obligationIds.sort(),
    evidence_ids: integerIds(row.evidence_ids, "parity_scope.evidence_ids"),
  };
}

function exactRows<T>(rows: T[], expectedCount: number, kind: string): T[] {
  if (rows.length !== expectedCount) {
    throw new ToolError(
      `parity scope expected ${expectedCount} ${kind} record(s), found ${rows.length}`,
    );
  }
  return rows;
}

function captureSnapshot(ctx: ServerContext, scope: ParityScope): Record<string, unknown> {
  const claimPlaceholders = scope.claim_ids.map(() => "?").join(",");
  const claims = exactRows(
    ctx.db
      .prepare(
        `SELECT claim_id,claim_key,subject_type,subject_id,statement,epistemic_kind,
                asserted_at_sha,valid_from_sha,valid_until_sha
           FROM claims WHERE claim_id IN (${claimPlaceholders}) ORDER BY claim_id`,
      )
      .all(...scope.claim_ids) as Array<Record<string, unknown>>,
    scope.claim_ids.length,
    "claim",
  );
  const claimLinks = ctx.db
    .prepare(
      `SELECT claim_id,evidence_id,role FROM claim_evidence
        WHERE claim_id IN (${claimPlaceholders}) ORDER BY claim_id,evidence_id`,
    )
    .all(...scope.claim_ids) as Array<Record<string, unknown>>;
  const linkedEvidence = new Set(claimLinks.map((row) => Number(row.evidence_id)));
  for (const evidenceId of linkedEvidence) {
    if (!scope.evidence_ids.includes(evidenceId)) {
      throw new ToolError(`parity scope omits claim evidence ID ${evidenceId}`);
    }
  }

  const evidencePlaceholders = scope.evidence_ids.map(() => "?").join(",");
  const evidence = exactRows(
    ctx.db
      .prepare(
        `SELECT id,file_path,symbol,line_range,ref_sha,kind,excerpt,note
           FROM evidence WHERE id IN (${evidencePlaceholders}) ORDER BY id`,
      )
      .all(...scope.evidence_ids) as Array<Record<string, unknown>>,
    scope.evidence_ids.length,
    "evidence",
  );

  const decisionPlaceholders = scope.decision_ids.map(() => "?").join(",");
  const decisions = exactRows(
    ctx.db
      .prepare(
        `SELECT decision_id,title,current_revision_id
           FROM decisions WHERE decision_id IN (${decisionPlaceholders}) ORDER BY decision_id`,
      )
      .all(...scope.decision_ids) as Array<Record<string, unknown>>,
    scope.decision_ids.length,
    "decision",
  );
  const revisions = ctx.db
    .prepare(
      `SELECT revision_id,decision_id,revision_number,predecessor_revision_id,design_session_id,
              status,desire_sources_json,accepted_option_json,alternatives_json,constraints_json,
              consequences_json,falsifiers_json,premises_json,code_changes_json,rationale,
              authored_by_kind,authored_by,payload_hash
         FROM decision_revisions WHERE decision_id IN (${decisionPlaceholders})
        ORDER BY decision_id,revision_number`,
    )
    .all(...scope.decision_ids) as Array<Record<string, unknown>>;
  const revisionIds = revisions.map((row) => String(row.revision_id));
  const events =
    revisionIds.length === 0
      ? []
      : (ctx.db
          .prepare(
            `SELECT revision_id,event_type,actor_kind,actor_id,authority_scope,reason,evidence_id,
                    impact_run_id,detail_json
               FROM decision_events WHERE revision_id IN (${revisionIds.map(() => "?").join(",")})
              ORDER BY revision_id,event_id`,
          )
          .all(...revisionIds) as Array<Record<string, unknown>>);

  const obligationPlaceholders = scope.obligation_ids.map(() => "?").join(",");
  const obligations = exactRows(
    ctx.db
      .prepare(
        `SELECT obligation_id,trigger_type,trigger_id,destination_type,destination_id,
                source_impact_run_id,owner,state,blocking,priority,resolution_evidence_id,resolution_note
           FROM revalidation_obligations WHERE obligation_id IN (${obligationPlaceholders})
          ORDER BY obligation_id`,
      )
      .all(...scope.obligation_ids) as Array<Record<string, unknown>>,
    scope.obligation_ids.length,
    "obligation",
  );

  const decodeJsonFields = (rows: Array<Record<string, unknown>>) =>
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key.endsWith("_json") ? key.slice(0, -5) : key,
          key.endsWith("_json") && typeof value === "string" ? JSON.parse(value) : value,
        ]),
      ),
    );

  return {
    schema_version: "1.0.0",
    scope,
    behavior: {
      claims,
      decisions: {
        records: decisions,
        revisions: decodeJsonFields(revisions),
        events: decodeJsonFields(events),
      },
      obligations,
    },
    evidence: {
      records: evidence,
      claim_links: claimLinks,
    },
    verification_surface: {
      authoritative_claim_count: claims.filter((row) => row.valid_until_sha === null).length,
      decision_count: decisions.length,
      obligation_count: obligations.length,
      evidence_count: evidence.length,
      human_verification_item_ids: [
        ...scope.claim_ids.map((id) => `claim:${id}`),
        ...scope.decision_ids.map((id) => `decision:${id}`),
        ...scope.obligation_ids.map((id) => `obligation:${id}`),
      ],
    },
  };
}

function timedSnapshot(ctx: ServerContext, scope: ParityScope): Record<string, unknown> {
  const started = process.hrtime.bigint();
  const snapshot = captureSnapshot(ctx, scope);
  const elapsedUs = Number((process.hrtime.bigint() - started) / 1000n);
  return {
    snapshot,
    snapshot_hash: hash(snapshot),
    verification_time_us: Math.max(1, elapsedUs),
    verification_time_kind: "mechanical-parity-projection",
  };
}

function captureParity(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  return timedSnapshot(ctx, parseScope(args.parity_scope));
}

function catalog(): Record<string, unknown> {
  return {
    schema_version: "1.0.0",
    project_type: "codebase",
    transport: { kind: "mcp", server_name: "amanuensis-memory" },
    adapters: Object.entries(ADAPTER_CATALOG).map(([kind, value]) => ({
      kind,
      artifact_kind: value.artifactKind,
      schema_ref: value.schemaRef,
      schema_version: "1.0.0",
      output_slot: value.outputSlot,
      read_tool: value.readTool,
      mutation_tools: value.mutationTools,
      authority: "amanuensis-invariants-remain-authoritative",
    })),
    custody_matrix: CUSTODY_MATRIX,
    extraction_policy: {
      status: "retained-direct",
      rule: "No workflow moves until behavior, evidence, recovery, and verification-time parity are green.",
    },
  };
}

function parseExpectedDirect(value: unknown): Record<string, unknown> {
  const row = object(value, "expected_direct");
  const snapshot = object(row.snapshot, "expected_direct.snapshot");
  if (snapshot.schema_version !== "1.0.0") {
    throw new ToolError("expected_direct snapshot schema_version must be 1.0.0");
  }
  const snapshotHash = requireString(row, "snapshot_hash");
  if (snapshotHash !== hash(snapshot)) {
    throw new ToolError("expected_direct snapshot hash does not reconcile");
  }
  const verificationTimeUs = requireInt(row, "verification_time_us");
  if (verificationTimeUs <= 0) {
    throw new ToolError("expected_direct.verification_time_us must be positive");
  }
  parseScope(snapshot.scope);
  return {
    snapshot,
    snapshot_hash: snapshotHash,
    verification_time_us: verificationTimeUs,
    verification_time_kind: "mechanical-parity-projection",
  };
}

function parseSteps(value: unknown): Array<Record<string, unknown>> {
  const ids = new Set<string>();
  return objects(value, "steps").map((row, index) => {
    const stepId = requireString(row, "step_id");
    const adapterKind = requireEnum(row, "adapter_kind", ADAPTER_KINDS);
    const toolName = requireString(row, "tool_name");
    if (ids.has(stepId)) throw new ToolError(`duplicate step_id: ${stepId}`);
    ids.add(stepId);
    if (!ADAPTER_CATALOG[adapterKind].mutationTools.includes(toolName)) {
      throw new ToolError(`${toolName} is not authorized by the ${adapterKind}@1.0.0 adapter`);
    }
    if (!DOMAIN_TOOLS.has(toolName)) {
      throw new ToolError(`adapter tool is not present in this Amanuensis build: ${toolName}`);
    }
    const toolArgs = object(row.args, `steps[${index}].args`);
    const expectedOutputKeys = strings(
      row.expected_output_keys,
      `steps[${index}].expected_output_keys`,
    ).sort();
    return {
      step_id: stepId,
      ordinal: index + 1,
      adapter_kind: adapterKind,
      tool_name: toolName,
      args: toolArgs,
      expected_output_keys: expectedOutputKeys,
    };
  });
}

function planRun(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const plannedBy = requireActiveSession(ctx, "plan_chorusmith_adapter_run");
  const runId = requireString(args, "run_id");
  const externalRunRef = requireString(args, "external_run_ref");
  const sourceCommit = resolveCommit(ctx, requireString(args, "source_commit"));
  const expectedDirect = parseExpectedDirect(args.expected_direct);
  const expectedSnapshot = expectedDirect.snapshot as Record<string, unknown>;
  const parityPolicy = object(args.parity_policy, "parity_policy");
  const recoveryProbeRequired = parityPolicy.recovery_probe_required === true;
  const maxVerificationOverheadUs = requireInt(parityPolicy, "max_verification_overhead_us");
  if (maxVerificationOverheadUs < 0) {
    throw new ToolError("parity_policy.max_verification_overhead_us must be non-negative");
  }
  const steps = parseSteps(args.steps);
  const manifest = {
    schema_version: "1.0.0",
    kind: "AmanuensisRunManifest",
    run_id: runId,
    external_run_ref: externalRunRef,
    source_commit: sourceCommit,
    transport: { kind: "mcp", server_name: "amanuensis-memory" },
    adapter_catalog_hash: hash(catalog()),
    steps,
    parity_scope: parseScope(expectedSnapshot.scope),
    expected_direct: expectedDirect,
    parity_policy: {
      recovery_probe_required: recoveryProbeRequired,
      max_verification_overhead_us: maxVerificationOverheadUs,
    },
    custody_matrix: CUSTODY_MATRIX,
    authority: {
      domain_invariants: "amanuensis",
      orchestration: "chorusmith",
      acceptance: "human-or-owning-system",
    },
  };
  const manifestHash = hash(manifest);
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO chorusmith_adapter_runs
           (run_id,external_run_ref,schema_version,manifest_json,manifest_hash,
            expected_step_count,expected_snapshot_hash,planned_by)
         VALUES (?, ?, '1.0.0', ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        externalRunRef,
        stableJson(manifest),
        manifestHash,
        steps.length,
        String(expectedDirect.snapshot_hash),
        plannedBy,
      );
    const insert = ctx.db.prepare(
      `INSERT INTO chorusmith_adapter_steps
         (step_id,run_id,ordinal,adapter_kind,tool_name,args_json,args_hash,
          expected_output_keys_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const step of steps) {
      insert.run(
        step.step_id,
        runId,
        step.ordinal,
        step.adapter_kind,
        step.tool_name,
        stableJson(step.args),
        hash(step.args),
        stableJson(step.expected_output_keys),
      );
    }
  })();
  return {
    run_id: runId,
    external_run_ref: externalRunRef,
    manifest_hash: manifestHash,
    expected_step_count: steps.length,
    status: "planned",
  };
}

function nextStep(ctx: ServerContext, runId: string): AdapterStepRow | undefined {
  return ctx.db
    .prepare(
      "SELECT * FROM chorusmith_adapter_steps WHERE run_id=? AND status='planned' ORDER BY ordinal LIMIT 1",
    )
    .get(runId) as AdapterStepRow | undefined;
}

function executeStep(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "execute_chorusmith_adapter_step");
  const currentRun = run(ctx, requireString(args, "run_id"));
  if (!["planned", "running"].includes(currentRun.status)) {
    throw new ToolError(`Chorusmith adapter run is ${currentRun.status}`);
  }
  assertRunSourceCommit(ctx, currentRun);
  validateRunCustody(ctx, currentRun);
  const step = nextStep(ctx, currentRun.run_id);
  if (!step) throw new ToolError("Chorusmith adapter run has no pending step");
  const requestedStepId = requireString(args, "step_id");
  if (requestedStepId !== step.step_id) {
    throw new ToolError(`out-of-order adapter step: expected ${step.step_id}`);
  }
  const adapter = ADAPTER_CATALOG[step.adapter_kind];
  if (!adapter.mutationTools.includes(step.tool_name)) {
    throw new ToolError(`${step.tool_name} is no longer authorized by ${step.adapter_kind}`);
  }
  const tool = DOMAIN_TOOLS.get(step.tool_name);
  if (!tool) throw new ToolError(`Amanuensis tool is unavailable: ${step.tool_name}`);
  const toolArgs = JSON.parse(step.args_json) as Record<string, unknown>;
  if (hash(toolArgs) !== step.args_hash)
    throw new ToolError(`adapter step ${step.step_id} args drifted`);
  let output: Record<string, unknown> = {};
  ctx.db.transaction(() => {
    if (currentRun.status === "planned") {
      ctx.db
        .prepare("UPDATE chorusmith_adapter_runs SET status='running' WHERE run_id=?")
        .run(currentRun.run_id);
    }
    const result = tool.handler(toolArgs, ctx);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new ToolError(`adapter step ${step.step_id} returned a non-object result`);
    }
    output = result as Record<string, unknown>;
    if (output.ok === false) {
      throw new ToolError(`adapter step ${step.step_id} was rejected: ${String(output.error)}`);
    }
    const requiredKeys = JSON.parse(step.expected_output_keys_json) as string[];
    const missing = requiredKeys.filter((key) => !(key in output));
    if (missing.length > 0) {
      throw new ToolError(
        `adapter step ${step.step_id} omitted output keys: ${missing.join(", ")}`,
      );
    }
    ctx.db
      .prepare(
        `UPDATE chorusmith_adapter_steps
            SET status='landed',output_json=?,output_hash=?,landed_at=datetime('now')
          WHERE step_id=?`,
      )
      .run(stableJson(output), hash(output), step.step_id);
    const remaining = ctx.db
      .prepare(
        "SELECT COUNT(*) AS n FROM chorusmith_adapter_steps WHERE run_id=? AND status='planned'",
      )
      .get(currentRun.run_id) as { n: number };
    if (remaining.n === 0) {
      ctx.db
        .prepare("UPDATE chorusmith_adapter_runs SET status='ready' WHERE run_id=?")
        .run(currentRun.run_id);
    }
  })();
  return {
    run_id: currentRun.run_id,
    step_id: step.step_id,
    ordinal: step.ordinal,
    adapter_kind: step.adapter_kind,
    tool_name: step.tool_name,
    output,
    output_hash: hash(output),
    next_step_id: nextStep(ctx, currentRun.run_id)?.step_id ?? null,
    status: run(ctx, currentRun.run_id).status,
  };
}

function validateRunCustody(
  ctx: ServerContext,
  currentRun: AdapterRunRow,
): Array<Record<string, unknown>> {
  const steps = ctx.db
    .prepare(
      `SELECT step_id,ordinal,adapter_kind,tool_name,args_json,args_hash,
              expected_output_keys_json,status,output_json,output_hash
         FROM chorusmith_adapter_steps WHERE run_id=? ORDER BY ordinal`,
    )
    .all(currentRun.run_id) as Array<Record<string, unknown>>;
  if (steps.length !== currentRun.expected_step_count) {
    throw new ToolError(
      `adapter fan-in expected ${currentRun.expected_step_count} step(s), found ${steps.length}`,
    );
  }
  const manifest = JSON.parse(currentRun.manifest_json) as Record<string, unknown>;
  const planned = objects(manifest.steps, "manifest.steps");
  if (planned.length !== currentRun.expected_step_count) {
    throw new ToolError("adapter manifest step count does not reconcile");
  }
  let plannedSeen = false;
  const landed: Array<Record<string, unknown>> = [];
  for (const [index, step] of steps.entries()) {
    const expected = planned[index];
    const actualPlan = {
      step_id: step.step_id,
      ordinal: step.ordinal,
      adapter_kind: step.adapter_kind,
      tool_name: step.tool_name,
      args: JSON.parse(String(step.args_json)),
      expected_output_keys: JSON.parse(String(step.expected_output_keys_json)),
    };
    if (stableJson(actualPlan) !== stableJson(expected)) {
      throw new ToolError(`adapter step ${String(step.step_id)} does not match its manifest`);
    }
    if (hash(actualPlan.args) !== step.args_hash) {
      throw new ToolError(`adapter step ${String(step.step_id)} args do not reconcile`);
    }
    if (step.status === "planned") {
      plannedSeen = true;
      continue;
    }
    if (plannedSeen) {
      throw new ToolError("adapter landed steps are not an exact ordinal prefix");
    }
    landed.push(step);
  }
  for (const step of landed) {
    if (!step.output_json || hash(JSON.parse(String(step.output_json))) !== step.output_hash) {
      throw new ToolError(`landed adapter step ${step.step_id} output does not reconcile`);
    }
  }
  return landed;
}

function recoveryProjection(ctx: ServerContext, scope: ParityScope): Record<string, unknown> {
  const claimSlots = scope.claim_ids.map(() => "?").join(",");
  const decisionSlots = scope.decision_ids.map(() => "?").join(",");
  const obligationSlots = scope.obligation_ids.map(() => "?").join(",");
  const evidenceSlots = scope.evidence_ids.map(() => "?").join(",");
  return {
    claim_ids: (
      ctx.db
        .prepare(
          `SELECT claim_id AS id FROM claims WHERE claim_id IN (${claimSlots}) ORDER BY claim_id`,
        )
        .all(...scope.claim_ids) as Array<{ id: string }>
    ).map((row) => row.id),
    decision_ids: (
      ctx.db
        .prepare(
          `SELECT decision_id AS id FROM decisions WHERE decision_id IN (${decisionSlots}) ORDER BY decision_id`,
        )
        .all(...scope.decision_ids) as Array<{ id: string }>
    ).map((row) => row.id),
    obligation_ids: (
      ctx.db
        .prepare(
          `SELECT obligation_id AS id FROM revalidation_obligations WHERE obligation_id IN (${obligationSlots}) ORDER BY obligation_id`,
        )
        .all(...scope.obligation_ids) as Array<{ id: string }>
    ).map((row) => row.id),
    evidence_ids: (
      ctx.db
        .prepare(`SELECT id FROM evidence WHERE id IN (${evidenceSlots}) ORDER BY id`)
        .all(...scope.evidence_ids) as Array<{ id: number }>
    ).map((row) => row.id),
  };
}

function resumeRun(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const resumedBy = requireActiveSession(ctx, "resume_chorusmith_adapter_run");
  const currentRun = run(ctx, requireString(args, "run_id"));
  if (!["running", "ready"].includes(currentRun.status)) {
    throw new ToolError(
      `only a running or ready Chorusmith adapter run can resume; found ${currentRun.status}`,
    );
  }
  assertRunSourceCommit(ctx, currentRun);
  const landed = validateRunCustody(ctx, currentRun);
  const manifest = JSON.parse(currentRun.manifest_json) as Record<string, unknown>;
  const scope = parseScope(manifest.parity_scope);
  const projection = recoveryProjection(ctx, scope);
  const pending = nextStep(ctx, currentRun.run_id);
  const receipt = {
    schema_version: "1.0.0",
    run_id: currentRun.run_id,
    external_run_ref: currentRun.external_run_ref,
    landed_step_count: landed.length,
    next_step_id: pending?.step_id ?? null,
    domain_projection_hash: hash(projection),
    source_state_mutated_by_recovery: false,
  };
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO chorusmith_adapter_recoveries
           (run_id,landed_step_count,next_step_id,domain_projection_hash,receipt_json,resumed_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        currentRun.run_id,
        landed.length,
        pending?.step_id ?? null,
        receipt.domain_projection_hash,
        stableJson(receipt),
        resumedBy,
      );
    ctx.db
      .prepare("UPDATE chorusmith_adapter_runs SET recovery_count=recovery_count+1 WHERE run_id=?")
      .run(currentRun.run_id);
  })();
  return receipt;
}

function verifyParity(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const verifiedBy = requireActiveSession(ctx, "verify_chorusmith_adapter_parity");
  const currentRun = run(ctx, requireString(args, "run_id"));
  if (currentRun.status !== "ready") {
    throw new ToolError(`Chorusmith adapter run is ${currentRun.status}`);
  }
  assertRunSourceCommit(ctx, currentRun);
  validateRunCustody(ctx, currentRun);
  const manifest = JSON.parse(currentRun.manifest_json) as Record<string, unknown>;
  const expectedDirect = object(manifest.expected_direct, "manifest.expected_direct");
  const expectedSnapshot = object(expectedDirect.snapshot, "manifest.expected_direct.snapshot");
  const current = timedSnapshot(ctx, parseScope(manifest.parity_scope));
  const actualSnapshot = current.snapshot as Record<string, unknown>;
  const expectedBehavior = expectedSnapshot.behavior;
  const actualBehavior = actualSnapshot.behavior;
  const expectedEvidence = expectedSnapshot.evidence;
  const actualEvidence = actualSnapshot.evidence;
  const expectedSurface = expectedSnapshot.verification_surface;
  const actualSurface = actualSnapshot.verification_surface;
  const policy = object(manifest.parity_policy, "manifest.parity_policy");
  const recoveryRequired = policy.recovery_probe_required === true;
  const maxOverheadUs = Number(policy.max_verification_overhead_us);
  const directTimeUs = Number(expectedDirect.verification_time_us);
  const orchestratedTimeUs = Number(current.verification_time_us);
  const scopeOk = stableJson(actualSnapshot.scope) === stableJson(expectedSnapshot.scope);
  const behaviorOk = scopeOk && stableJson(actualBehavior) === stableJson(expectedBehavior);
  const evidenceOk = stableJson(actualEvidence) === stableJson(expectedEvidence);
  const recoveryOk = !recoveryRequired || currentRun.recovery_count > 0;
  const verificationTimeOk =
    stableJson(actualSurface) === stableJson(expectedSurface) &&
    orchestratedTimeUs <= directTimeUs + maxOverheadUs;
  const report = {
    schema_version: "1.0.0",
    run_id: currentRun.run_id,
    expected_snapshot_hash: currentRun.expected_snapshot_hash,
    actual_snapshot_hash: current.snapshot_hash,
    axes: {
      behavior: { ok: behaviorOk, scope_equal: scopeOk },
      evidence: { ok: evidenceOk },
      recovery: {
        ok: recoveryOk,
        required: recoveryRequired,
        recovery_count: currentRun.recovery_count,
      },
      verification_time: {
        ok: verificationTimeOk,
        direct_us: directTimeUs,
        orchestrated_us: orchestratedTimeUs,
        max_overhead_us: maxOverheadUs,
        surface_equal: stableJson(actualSurface) === stableJson(expectedSurface),
      },
    },
    extraction_status:
      behaviorOk && evidenceOk && recoveryOk && verificationTimeOk
        ? "parity-proven-retain-direct-until-feature-move"
        : "blocked",
    ok: behaviorOk && evidenceOk && recoveryOk && verificationTimeOk,
  };
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO chorusmith_parity_verifications
           (run_id,behavior_ok,evidence_ok,recovery_ok,verification_time_ok,ok,report_json,verified_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        currentRun.run_id,
        behaviorOk ? 1 : 0,
        evidenceOk ? 1 : 0,
        recoveryOk ? 1 : 0,
        verificationTimeOk ? 1 : 0,
        report.ok ? 1 : 0,
        stableJson(report),
        verifiedBy,
      );
    if (report.ok) {
      ctx.db
        .prepare(
          "UPDATE chorusmith_adapter_runs SET status='verified',verified_at=datetime('now') WHERE run_id=?",
        )
        .run(currentRun.run_id);
    }
  })();
  return report;
}

function readObligation(ctx: ServerContext, sourceId: string): Record<string, unknown> {
  const row = ctx.db
    .prepare(
      `SELECT obligation_id,trigger_type,trigger_id,destination_type,destination_id,
              source_impact_run_id,owner,state,blocking,priority,resolution_evidence_id,resolution_note
         FROM revalidation_obligations WHERE obligation_id=?`,
    )
    .get(sourceId) as Record<string, unknown> | undefined;
  if (!row) throw new ToolError(`unknown obligation: ${sourceId}`);
  return row;
}

function readSource(
  ctx: ServerContext,
  adapterKind: AdapterKind,
  sourceId: string,
): Record<string, unknown> {
  if (adapterKind === "Obligation") return readObligation(ctx, sourceId);
  if (adapterKind === "RunManifest") return getRun({ run_id: sourceId }, ctx);
  const adapter = ADAPTER_CATALOG[adapterKind];
  const tool = DOMAIN_TOOLS.get(adapter.readTool);
  if (!tool) throw new ToolError(`adapter read tool is unavailable: ${adapter.readTool}`);
  const idFields: Record<Exclude<AdapterKind, "Obligation" | "RunManifest">, string> = {
    CodebaseBrief: "brief_id",
    ReviewBrief: "brief_id",
    ResearchRequest: "request_id",
    Decision: "decision_id",
  };
  const field = idFields[adapterKind];
  const payload = tool.handler({ [field]: sourceId }, ctx);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ToolError(`${adapter.readTool} returned a non-object payload`);
  }
  return payload as Record<string, unknown>;
}

function exportArtifact(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const exportedBy = requireActiveSession(ctx, "export_chorusmith_adapter_artifact");
  const exportId = requireString(args, "export_id");
  const adapterKind = requireEnum(args, "adapter_kind", ADAPTER_KINDS);
  const sourceId = requireString(args, "source_id");
  const runId = args.run_id == null ? null : requireString(args, "run_id");
  const externalRunRef = runId ? run(ctx, runId).external_run_ref : null;
  const adapter = ADAPTER_CATALOG[adapterKind];
  const payload = readSource(ctx, adapterKind, sourceId);
  const envelope = {
    kind: "AmanuensisChorusmithArtifactEnvelope",
    schemaVersion: "1.0.0",
    sourceRef: `amanuensis://${adapterKind}/${sourceId}`,
    sourcePayloadHash: `sha256:${hash(payload)}`,
    authority: {
      owner: "amanuensis",
      transfer: "projection-only",
      externalWriteAuthority: false,
    },
    artifactInput: {
      runKey: externalRunRef,
      artifactKind: adapter.artifactKind,
      schemaRef: adapter.schemaRef,
      schemaVersion: "1.0.0",
      producedByStageId: "amanuensis-adapter",
      attemptIndex: 0,
      outputSlot: adapter.outputSlot,
      payload,
    },
  };
  const envelopeHash = hash(envelope);
  ctx.db
    .prepare(
      `INSERT INTO chorusmith_adapter_exports
         (export_id,run_id,adapter_kind,source_id,envelope_json,envelope_hash,exported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(exportId, runId, adapterKind, sourceId, stableJson(envelope), envelopeHash, exportedBy);
  return { export_id: exportId, envelope_hash: envelopeHash, envelope };
}

function getRun(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const currentRun = run(ctx, requireString(args, "run_id"));
  return {
    ...currentRun,
    manifest: JSON.parse(currentRun.manifest_json),
    steps: ctx.db
      .prepare("SELECT * FROM chorusmith_adapter_steps WHERE run_id=? ORDER BY ordinal")
      .all(currentRun.run_id),
    recoveries: ctx.db
      .prepare("SELECT * FROM chorusmith_adapter_recoveries WHERE run_id=? ORDER BY recovery_id")
      .all(currentRun.run_id),
    verifications: ctx.db
      .prepare(
        "SELECT * FROM chorusmith_parity_verifications WHERE run_id=? ORDER BY verification_id",
      )
      .all(currentRun.run_id),
  };
}

const parityScopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["claim_ids", "decision_ids", "obligation_ids", "evidence_ids"],
  properties: {
    claim_ids: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    decision_ids: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    obligation_ids: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    evidence_ids: { type: "array", minItems: 1, items: { type: "integer", minimum: 1 } },
  },
};

export const chorusmithAdapterTools: ToolDefinition[] = [
  {
    name: "get_chorusmith_adapter_catalog",
    description:
      "Return the versioned CodebaseBrief, ReviewBrief, ResearchRequest, Decision, Obligation, and RunManifest adapter registry plus the custody matrix. Amanuensis retains durable-truth and invariant authority; Chorusmith receives typed projection and invocation authority only.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    handler: () => catalog(),
  },
  {
    name: "capture_chorusmith_parity_snapshot",
    description:
      "Derive a deterministic parity snapshot for exact authoritative claim, decision, obligation, and evidence IDs, plus the identical human-verification item surface and measured mechanical projection time. Missing or silently excluded records are errors.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["parity_scope"],
      properties: { parity_scope: parityScopeSchema },
    },
    handler: captureParity,
  },
  {
    name: "plan_chorusmith_adapter_run",
    description:
      "Freeze an AmanuensisRunManifest@1.0.0 against an exact repository commit, typed adapter steps, an independently captured direct-path snapshot, recovery-probe policy, verification-time ceiling, and the non-transferable custody matrix. Only explicitly allowlisted Amanuensis tools may appear.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "run_id",
        "external_run_ref",
        "source_commit",
        "expected_direct",
        "parity_policy",
        "steps",
      ],
      properties: {
        run_id: { type: "string", minLength: 1 },
        external_run_ref: { type: "string", minLength: 1 },
        source_commit: { type: "string", minLength: 1 },
        expected_direct: {
          type: "object",
          required: ["snapshot", "snapshot_hash", "verification_time_us"],
          properties: {
            snapshot: { type: "object" },
            snapshot_hash: { type: "string", minLength: 1 },
            verification_time_us: { type: "integer", minimum: 1 },
          },
        },
        parity_policy: {
          type: "object",
          required: ["recovery_probe_required", "max_verification_overhead_us"],
          properties: {
            recovery_probe_required: { type: "boolean" },
            max_verification_overhead_us: { type: "integer", minimum: 0 },
          },
        },
        steps: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["step_id", "adapter_kind", "tool_name", "args", "expected_output_keys"],
            properties: {
              step_id: { type: "string", minLength: 1 },
              adapter_kind: { type: "string", enum: [...ADAPTER_KINDS] },
              tool_name: { type: "string", minLength: 1 },
              args: { type: "object" },
              expected_output_keys: {
                type: "array",
                minItems: 1,
                items: { type: "string", minLength: 1 },
              },
            },
          },
        },
      },
    },
    handler: planRun,
  },
  {
    name: "execute_chorusmith_adapter_step",
    description:
      "Execute exactly the next frozen adapter step by invoking the existing Amanuensis tool handler inside one database transaction. The adapter has no direct domain-table write path, so evidence, depth, authority, and completion invariants remain authoritative and a rejected step rolls back its custody update.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["run_id", "step_id"],
      properties: {
        run_id: { type: "string", minLength: 1 },
        step_id: { type: "string", minLength: 1 },
      },
    },
    handler: executeStep,
  },
  {
    name: "resume_chorusmith_adapter_run",
    description:
      "Resume a durable in-progress or ready adapter run after orchestration loss. Reconcile every landed args/output hash, derive the current domain projection without mutating source truth, append a recovery receipt, and return the exact next step.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["run_id"],
      properties: { run_id: { type: "string", minLength: 1 } },
    },
    handler: resumeRun,
  },
  {
    name: "verify_chorusmith_adapter_parity",
    description:
      "Before any extraction may advance, compare the orchestrated run with its frozen direct-path baseline on behavior, evidence identifiers, interruption recovery, and verification surface/time. Only a four-axis green report may move the run to verified; failures remain append-only.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["run_id"],
      properties: { run_id: { type: "string", minLength: 1 } },
    },
    handler: verifyParity,
  },
  {
    name: "export_chorusmith_adapter_artifact",
    description:
      "Project one durable CodebaseBrief, ReviewBrief, ResearchRequest, Decision, Obligation, or RunManifest through its @1.0.0 adapter into an Amanuensis custody envelope containing a Chorusmith PersistArtifactInput-compatible projection. Chorusmith must compute its own native record hash during future ingress; export is append-only, projection-only, and grants no external write authority.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["export_id", "adapter_kind", "source_id"],
      properties: {
        export_id: { type: "string", minLength: 1 },
        adapter_kind: { type: "string", enum: [...ADAPTER_KINDS] },
        source_id: { type: "string", minLength: 1 },
        run_id: { type: "string", minLength: 1 },
      },
    },
    handler: exportArtifact,
  },
  {
    name: "get_chorusmith_adapter_run",
    description:
      "Read one immutable adapter manifest, its ordered landed/pending steps, restart receipts, and parity verifications. This is also the RunManifest@1.0.0 adapter's projection source.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["run_id"],
      properties: { run_id: { type: "string", minLength: 1 } },
    },
    handler: getRun,
  },
];
