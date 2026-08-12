import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  optString,
  requireEnum,
  requireString,
  requireStringArray,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const ITEM_KINDS = ["artifact", "commit", "test", "review-result"] as const;
const SCOPES = ["unit", "integral-head"] as const;
type ItemKind = (typeof ITEM_KINDS)[number];
type VerificationScope = (typeof SCOPES)[number];

interface CompositionRun {
  run_id: string;
  impact_run_id: string;
  assembled_head_sha: string;
  assembled_tree_sha: string;
  expected_item_count: number;
  expected_unit_item_count: number;
  expected_integral_item_count: number;
  impacted_seam_count: number;
  selected_seam_count: number;
  status: string;
  manifest_json: string;
}

interface CompositionItem {
  item_id: string;
  run_id: string;
  ordinal: number;
  item_kind: ItemKind;
  verification_scope: VerificationScope;
  subject: string;
  expected_ref: string;
  target_sha: string;
  status: string;
  runtime_input_json: string | null;
  observation_json: string | null;
  scoring_json: string | null;
}

interface ItemSpec {
  item_id: string;
  item_kind: ItemKind;
  verification_scope: VerificationScope;
  subject: string;
  expected_ref: string;
  target_sha: string;
}

interface SeamConcernSpec {
  seam_id: string;
  concern_code: string;
  rationale: string;
}

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

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
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

function resolveTree(ctx: ServerContext, commit: string): string {
  const result = git(ctx, ["rev-parse", `${commit}^{tree}`]);
  const sha = result.stdout?.toString().trim() ?? "";
  if (result.status !== 0 || !sha) throw new ToolError(`cannot resolve tree for ${commit}`);
  return sha;
}

function isAncestor(ctx: ServerContext, ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  return git(ctx, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
}

function currentHead(ctx: ServerContext): string {
  return resolveCommit(ctx, "HEAD");
}

function getRun(ctx: ServerContext, runId: string): CompositionRun {
  const row = ctx.db.prepare("SELECT * FROM composition_runs WHERE run_id=?").get(runId) as
    | CompositionRun
    | undefined;
  if (!row) throw new ToolError(`unknown composition run: ${runId}`);
  return row;
}

function getItem(ctx: ServerContext, runId: string, itemId: string): CompositionItem {
  const row = ctx.db
    .prepare("SELECT * FROM composition_items WHERE run_id=? AND item_id=?")
    .get(runId, itemId) as CompositionItem | undefined;
  if (!row) throw new ToolError(`unknown composition item: ${itemId}`);
  return row;
}

function setRunStatus(ctx: ServerContext, runId: string, status: string): void {
  ctx.db
    .prepare(
      `UPDATE composition_runs SET status=?, updated_at=datetime('now'),
          completed_at=CASE WHEN ? IN ('complete','blocked') THEN datetime('now')
                            ELSE completed_at END
        WHERE run_id=?`,
    )
    .run(status, status, runId);
}

function parseItemSpecs(
  args: Record<string, unknown>,
  headSha: string,
  ctx: ServerContext,
): ItemSpec[] {
  if (!Array.isArray(args.expected_items)) throw new ToolError("expected_items must be an array");
  const ids = new Set<string>();
  const identities = new Set<string>();
  return args.expected_items.map((value, index) => {
    const row = requireObject(value, `expected_items[${index}]`);
    const targetSha = resolveCommit(ctx, requireString(row, "target_sha"));
    if (!isAncestor(ctx, targetSha, headSha)) {
      throw new ToolError(`expected_items[${index}].target_sha is not in assembled HEAD`);
    }
    const spec: ItemSpec = {
      item_id: requireString(row, "item_id"),
      item_kind: requireEnum(row, "item_kind", ITEM_KINDS),
      verification_scope: requireEnum(row, "verification_scope", SCOPES),
      subject: requireString(row, "subject"),
      expected_ref: requireString(row, "expected_ref"),
      target_sha: targetSha,
    };
    if (ids.has(spec.item_id))
      throw new ToolError(`duplicate composition item_id: ${spec.item_id}`);
    ids.add(spec.item_id);
    const identity = `${spec.item_kind}\u0000${spec.verification_scope}\u0000${spec.subject}`;
    if (identities.has(identity)) {
      throw new ToolError(`duplicate composition item identity: ${spec.subject}`);
    }
    identities.add(identity);
    if (spec.verification_scope === "integral-head" && spec.target_sha !== headSha) {
      throw new ToolError("integral-head items must target the exact assembled HEAD");
    }
    if (spec.item_kind === "commit") {
      const expectedCommit = resolveCommit(ctx, spec.expected_ref);
      if (expectedCommit !== spec.target_sha) {
        throw new ToolError("commit item expected_ref must equal its target_sha");
      }
      spec.expected_ref = expectedCommit;
    }
    return spec;
  });
}

function parseSeamConcerns(args: Record<string, unknown>): SeamConcernSpec[] {
  if (args.seam_concerns == null) return [];
  if (!Array.isArray(args.seam_concerns)) throw new ToolError("seam_concerns must be an array");
  const identities = new Set<string>();
  return args.seam_concerns.map((value, index) => {
    const row = requireObject(value, `seam_concerns[${index}]`);
    const spec = {
      seam_id: requireString(row, "seam_id"),
      concern_code: requireString(row, "concern_code"),
      rationale: requireString(row, "rationale"),
    };
    const identity = `${spec.seam_id}\u0000${spec.concern_code}`;
    if (identities.has(identity)) throw new ToolError(`duplicate seam concern: ${identity}`);
    identities.add(identity);
    return spec;
  });
}

function readComposition(ctx: ServerContext, runId: string): Record<string, unknown> {
  const run = getRun(ctx, runId);
  const items = (
    ctx.db
      .prepare("SELECT * FROM composition_items WHERE run_id=? ORDER BY ordinal")
      .all(runId) as Array<CompositionItem & Record<string, unknown>>
  ).map((item) => ({
    ...item,
    runtime_input: item.runtime_input_json ? JSON.parse(item.runtime_input_json) : null,
    observation: item.observation_json ? JSON.parse(item.observation_json) : null,
    scoring: item.scoring_json ? JSON.parse(item.scoring_json) : null,
  }));
  const lane = ctx.db
    .prepare("SELECT * FROM composition_integral_lanes WHERE run_id=?")
    .get(runId) as
    | (Record<string, unknown> & {
        runtime_input_json: string;
        observation_json: string | null;
        scoring_json: string | null;
        dirty_paths_json: string | null;
      })
    | undefined;
  const reconciliations = (
    ctx.db
      .prepare(
        "SELECT * FROM composition_reconciliations WHERE run_id=? ORDER BY reconciliation_id",
      )
      .all(runId) as Array<Record<string, unknown> & { result_json: string }>
  ).map((row) => ({ ...row, result: JSON.parse(row.result_json) }));
  return {
    ...run,
    manifest: JSON.parse(run.manifest_json),
    items,
    seam_concerns: ctx.db
      .prepare(
        "SELECT * FROM composition_seam_concerns WHERE run_id=? ORDER BY seam_id, concern_code",
      )
      .all(runId),
    deferrals: ctx.db
      .prepare(
        "SELECT * FROM composition_deferrals WHERE run_id=? ORDER BY created_at, deferral_id",
      )
      .all(runId),
    integral_lane: lane
      ? {
          ...lane,
          runtime_input: JSON.parse(lane.runtime_input_json),
          observation: lane.observation_json ? JSON.parse(lane.observation_json) : null,
          scoring: lane.scoring_json ? JSON.parse(lane.scoring_json) : null,
          dirty_paths: lane.dirty_paths_json ? JSON.parse(lane.dirty_paths_json) : null,
        }
      : null,
    reconciliations,
  };
}

function plan(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "plan_composition_run");
  const runId = requireString(args, "run_id");
  if (ctx.db.prepare("SELECT 1 FROM composition_runs WHERE run_id=?").get(runId)) {
    throw new ToolError(`composition run_id already exists: ${runId}`);
  }
  const assembledHead = resolveCommit(ctx, requireString(args, "assembled_head_sha"));
  if (assembledHead !== currentHead(ctx)) {
    throw new ToolError("assembled_head_sha must be the currently checked-out HEAD");
  }
  const impactRunId = requireString(args, "impact_run_id");
  const impact = ctx.db
    .prepare("SELECT head_sha FROM change_impact_runs WHERE run_id=?")
    .get(impactRunId) as { head_sha: string } | undefined;
  if (!impact || resolveCommit(ctx, impact.head_sha) !== assembledHead) {
    throw new ToolError("composition impact run must target the exact assembled HEAD");
  }
  const specs = parseItemSpecs(args, assembledHead, ctx);
  const unit = specs.filter((item) => item.verification_scope === "unit");
  const integral = specs.filter((item) => item.verification_scope === "integral-head");
  for (const kind of ITEM_KINDS) {
    if (!unit.some((item) => item.item_kind === kind)) {
      throw new ToolError(`composition unit manifest requires a ${kind} item`);
    }
  }
  for (const kind of ["test", "review-result"] as const) {
    if (!integral.some((item) => item.item_kind === kind)) {
      throw new ToolError(`composition integral manifest requires a ${kind} item`);
    }
  }
  const impactedSeams = (
    ctx.db
      .prepare(
        "SELECT object_id FROM change_impact_objects WHERE run_id=? AND object_type='seam' ORDER BY object_id",
      )
      .all(impactRunId) as Array<{ object_id: string }>
  ).map((row) => row.object_id);
  const seamConcerns = parseSeamConcerns(args);
  const selectedSeams = [...new Set(seamConcerns.map((row) => row.seam_id))].sort();
  if (stableJson(selectedSeams) !== stableJson(impactedSeams)) {
    throw new ToolError("seam_concerns must cover every and only impacted seam");
  }
  if (impactedSeams.length === 0 && !optString(args, "no_impacted_seams_reason")) {
    throw new ToolError(
      "zero impacted seams require no_impacted_seams_reason (out-of-band, not green)",
    );
  }
  for (const row of seamConcerns) {
    if (!ctx.db.prepare("SELECT 1 FROM seams WHERE id=?").get(row.seam_id)) {
      throw new ToolError(`unknown impacted seam: ${row.seam_id}`);
    }
    if (
      !ctx.db
        .prepare("SELECT 1 FROM concerns WHERE code=? AND status='active'")
        .get(row.concern_code)
    ) {
      throw new ToolError(`unknown or inactive seam concern: ${row.concern_code}`);
    }
  }
  const manifest = {
    schema_version: 1,
    run_id: runId,
    impact_run_id: impactRunId,
    assembled_head_sha: assembledHead,
    assembled_tree_sha: resolveTree(ctx, assembledHead),
    expected_items: specs,
    seam_concerns: seamConcerns,
    seam_denominator: impactedSeams.length,
    no_impacted_seams_reason: optString(args, "no_impacted_seams_reason"),
    authority: { mode: "observe-only", irreversible_actions: [] },
  };
  const manifestJson = stableJson(manifest);
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO composition_runs
           (run_id, impact_run_id, assembled_head_sha, assembled_tree_sha,
            expected_item_count, expected_unit_item_count, expected_integral_item_count,
            impacted_seam_count, selected_seam_count, manifest_json, manifest_hash, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        impactRunId,
        assembledHead,
        manifest.assembled_tree_sha,
        specs.length,
        unit.length,
        integral.length,
        impactedSeams.length,
        selectedSeams.length,
        manifestJson,
        hash(manifestJson),
        sessionId,
      );
    const itemInsert = ctx.db.prepare(
      `INSERT INTO composition_items
         (item_id, run_id, ordinal, item_kind, verification_scope, subject,
          expected_ref, target_sha) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    specs.forEach((item, ordinal) => {
      itemInsert.run(
        item.item_id,
        runId,
        ordinal,
        item.item_kind,
        item.verification_scope,
        item.subject,
        item.expected_ref,
        item.target_sha,
      );
    });
    const seamInsert = ctx.db.prepare(
      `INSERT INTO composition_seam_concerns (run_id, seam_id, concern_code, rationale)
       VALUES (?, ?, ?, ?)`,
    );
    for (const row of seamConcerns) {
      seamInsert.run(runId, row.seam_id, row.concern_code, row.rationale);
    }
  })();
  return readComposition(ctx, runId);
}

function dispatchItem(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "dispatch_composition_item");
  const runId = requireString(args, "run_id");
  const item = getItem(ctx, runId, requireString(args, "item_id"));
  const run = getRun(ctx, runId);
  if (item.status !== "planned")
    throw new ToolError(`composition item ${item.item_id} is ${item.status}`);
  if (["complete", "blocked"].includes(run.status)) {
    throw new ToolError(`composition run ${runId} is ${run.status}`);
  }
  if (item.verification_scope === "unit" && !["planned", "collecting"].includes(run.status)) {
    throw new ToolError(`unit item cannot dispatch while composition run is ${run.status}`);
  }
  if (item.verification_scope === "integral-head") {
    const lane = ctx.db
      .prepare("SELECT status FROM composition_integral_lanes WHERE run_id=?")
      .get(runId) as { status: string } | undefined;
    if (!lane || !["dispatched", "landed", "scored-pass"].includes(lane.status)) {
      throw new ToolError("integral item requires a dispatched integral lane");
    }
  }
  const input = {
    schema_version: 1,
    composition_run_id: runId,
    item_id: item.item_id,
    verification_object: {
      scope: item.verification_scope,
      subject: item.subject,
      target_sha: item.target_sha,
      expected_ref: item.expected_ref,
      kind: item.item_kind,
    },
    authority: { mode: "observe-only", allowed_actions: ["inspect", "execute-check", "report"] },
  };
  const inputJson = stableJson(input);
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `UPDATE composition_items SET status='dispatched', runtime_input_json=?,
                runtime_input_hash=?, dispatched_at=datetime('now') WHERE item_id=?`,
      )
      .run(inputJson, hash(inputJson), item.item_id);
    if (run.status === "planned") setRunStatus(ctx, runId, "collecting");
  })();
  return { ...input, runtime_input_hash: hash(inputJson) };
}

function landItem(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "land_composition_item");
  const runId = requireString(args, "run_id");
  const item = getItem(ctx, runId, requireString(args, "item_id"));
  if (item.status !== "dispatched")
    throw new ToolError(`composition item ${item.item_id} is ${item.status}`);
  const observation = requireObject(args.observation, "observation");
  const observationJson = stableJson(observation);
  ctx.db
    .prepare(
      `UPDATE composition_items SET status='landed', observation_json=?, observation_hash=?,
              landed_at=datetime('now') WHERE item_id=?`,
    )
    .run(observationJson, hash(observationJson), item.item_id);
  return readComposition(ctx, runId);
}

function scoreItem(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "score_composition_item");
  const runId = requireString(args, "run_id");
  const item = getItem(ctx, runId, requireString(args, "item_id"));
  if (item.status !== "landed")
    throw new ToolError(`composition item ${item.item_id} is ${item.status}`);
  const observed = JSON.parse(item.observation_json ?? "{}") as Record<string, unknown>;
  const reasons: string[] = [];
  if (item.item_kind === "artifact") {
    const artifact = ctx.db
      .prepare("SELECT path, content_hash, ref_sha FROM artifacts WHERE path=?")
      .get(item.expected_ref) as
      | { path: string; content_hash: string | null; ref_sha: string | null }
      | undefined;
    if (!artifact?.content_hash) reasons.push("expected artifact is absent or unhashed");
    if (observed.artifact_path !== item.expected_ref)
      reasons.push("worker reported a different artifact path");
    if (artifact && observed.content_hash !== artifact.content_hash) {
      reasons.push("worker artifact hash does not match the registry");
    }
    if (artifact?.ref_sha !== item.target_sha)
      reasons.push("artifact is not tied to its target commit");
  } else if (item.item_kind === "commit") {
    const observedSha = typeof observed.commit_sha === "string" ? observed.commit_sha : "";
    let resolved = "";
    try {
      resolved = resolveCommit(ctx, observedSha);
    } catch {
      reasons.push("worker commit does not resolve");
    }
    if (resolved && resolved !== item.expected_ref)
      reasons.push("worker success omitted the expected commit");
    if (resolved && !isAncestor(ctx, resolved, getRun(ctx, runId).assembled_head_sha)) {
      reasons.push("worker commit is not in assembled HEAD");
    }
  } else if (item.item_kind === "test") {
    if (observed.test_id !== item.expected_ref)
      reasons.push("test identity does not match manifest");
    if (observed.tested_sha !== item.target_sha)
      reasons.push("test result is bound to another commit");
    if (!Number.isInteger(observed.exit_code) || observed.exit_code !== 0) {
      reasons.push(`test exited ${String(observed.exit_code)}`);
    }
    if (typeof observed.output_hash !== "string" || observed.output_hash.length === 0) {
      reasons.push("test result has no output hash");
    }
  } else {
    if (observed.review_run_id !== item.expected_ref)
      reasons.push("review result identity does not match manifest");
    const review = ctx.db
      .prepare(
        `SELECT r.status, r.reviewed_sha, r.manifest_json,
                CASE WHEN a.run_id IS NULL THEN 0 ELSE 1 END AS has_aggregation
           FROM review_analysis_runs r LEFT JOIN review_aggregations a ON a.run_id=r.run_id
          WHERE r.run_id=?`,
      )
      .get(item.expected_ref) as
      | { status: string; reviewed_sha: string; manifest_json: string; has_aggregation: number }
      | undefined;
    if (!review || review.status !== "aggregated" || review.has_aggregation !== 1) {
      reasons.push("expected review has no terminal aggregation");
    } else {
      if (review.reviewed_sha !== item.target_sha)
        reasons.push("review result is bound to another commit");
      if (item.verification_scope === "integral-head") {
        const manifest = JSON.parse(review.manifest_json) as {
          pass_specs?: Array<{ context_profile?: string }>;
        };
        if (!manifest.pass_specs?.some((spec) => spec.context_profile === "integral-head")) {
          reasons.push("integral review did not use integral-head context");
        }
      }
    }
  }
  const scoring = {
    item_id: item.item_id,
    verification_object: item.verification_scope,
    verdict: reasons.length === 0 ? "pass" : "fail",
    reasons,
  };
  const scoringJson = stableJson(scoring);
  ctx.db
    .prepare(
      `UPDATE composition_items SET status=?, scoring_json=?, scoring_hash=?,
              scored_at=datetime('now') WHERE item_id=?`,
    )
    .run(
      reasons.length === 0 ? "scored-pass" : "scored-fail",
      scoringJson,
      hash(scoringJson),
      item.item_id,
    );
  return { ...scoring, scoring_hash: hash(scoringJson) };
}

function dispatchIntegral(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  requireActiveSession(ctx, "dispatch_integral_verification");
  const runId = requireString(args, "run_id");
  const run = getRun(ctx, runId);
  if (!["planned", "collecting"].includes(run.status)) {
    throw new ToolError(`integral lane cannot dispatch while composition run is ${run.status}`);
  }
  if (currentHead(ctx) !== run.assembled_head_sha) {
    throw new ToolError("integral lane requires the assembled HEAD to remain checked out");
  }
  const unitCounts = ctx.db
    .prepare(
      `SELECT COUNT(*) AS expected,
              SUM(CASE WHEN status='scored-pass' THEN 1 ELSE 0 END) AS passed,
              SUM(CASE WHEN status='scored-fail' THEN 1 ELSE 0 END) AS failed
         FROM composition_items WHERE run_id=? AND verification_scope='unit'`,
    )
    .get(runId) as { expected: number; passed: number; failed: number };
  const deferrals = Number(
    (
      ctx.db
        .prepare("SELECT COUNT(*) AS n FROM composition_deferrals WHERE run_id=?")
        .get(runId) as {
        n: number;
      }
    ).n,
  );
  if (
    unitCounts.expected !== run.expected_unit_item_count ||
    unitCounts.passed !== unitCounts.expected ||
    unitCounts.failed !== 0 ||
    deferrals !== 0
  ) {
    throw new ToolError(
      `integral lane blocked: unit fan-in ${unitCounts.passed}/${unitCounts.expected}, failed ${unitCounts.failed}, deferred ${deferrals}`,
    );
  }
  if (ctx.db.prepare("SELECT 1 FROM composition_integral_lanes WHERE run_id=?").get(runId)) {
    throw new ToolError(`integral lane already exists for ${runId}`);
  }
  const input = {
    schema_version: 1,
    composition_run_id: runId,
    verification_object: "integral-head",
    assembled_head_sha: run.assembled_head_sha,
    assembled_tree_sha: run.assembled_tree_sha,
    clean_checkout_required: true,
    seam_concerns: ctx.db
      .prepare(
        "SELECT seam_id, concern_code, rationale FROM composition_seam_concerns WHERE run_id=? ORDER BY seam_id, concern_code",
      )
      .all(runId),
    expected_items: ctx.db
      .prepare(
        `SELECT item_id, item_kind, subject, expected_ref, target_sha
           FROM composition_items WHERE run_id=? AND verification_scope='integral-head'
          ORDER BY ordinal`,
      )
      .all(runId),
    authority: { mode: "observe-only", checkout: "clean-worktree", mutations: [] },
  };
  const inputJson = stableJson(input);
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO composition_integral_lanes
           (run_id, status, runtime_input_json, runtime_input_hash)
         VALUES (?, 'dispatched', ?, ?)`,
      )
      .run(runId, inputJson, hash(inputJson));
    setRunStatus(ctx, runId, "integral-dispatched");
  })();
  return { ...input, runtime_input_hash: hash(inputJson) };
}

function landIntegral(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "land_integral_verification");
  const runId = requireString(args, "run_id");
  const lane = ctx.db
    .prepare("SELECT status FROM composition_integral_lanes WHERE run_id=?")
    .get(runId) as { status: string } | undefined;
  if (!lane || lane.status !== "dispatched") throw new ToolError("integral lane is not dispatched");
  const dirtyPaths = requireStringArray(args, "dirty_paths");
  const observation = {
    checkout_head_sha: requireString(args, "checkout_head_sha"),
    checkout_tree_sha: requireString(args, "checkout_tree_sha"),
    checkout_mode: requireEnum(args, "checkout_mode", ["clean-worktree"] as const),
    dirty_paths: dirtyPaths,
    execution_report_hash: requireString(args, "execution_report_hash"),
  };
  const observationJson = stableJson(observation);
  ctx.db
    .prepare(
      `UPDATE composition_integral_lanes
          SET status='landed', checkout_head_sha=?, checkout_tree_sha=?, checkout_mode=?,
              dirty_paths_json=?, observation_json=?, observation_hash=?, landed_at=datetime('now')
        WHERE run_id=?`,
    )
    .run(
      observation.checkout_head_sha,
      observation.checkout_tree_sha,
      observation.checkout_mode,
      JSON.stringify(dirtyPaths),
      observationJson,
      hash(observationJson),
      runId,
    );
  return readComposition(ctx, runId);
}

function scoreIntegral(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  requireActiveSession(ctx, "score_integral_verification");
  const runId = requireString(args, "run_id");
  const run = getRun(ctx, runId);
  const lane = ctx.db
    .prepare("SELECT * FROM composition_integral_lanes WHERE run_id=?")
    .get(runId) as
    | {
        status: string;
        checkout_head_sha: string;
        checkout_tree_sha: string;
        checkout_mode: string;
        dirty_paths_json: string;
      }
    | undefined;
  if (!lane || lane.status !== "landed") throw new ToolError("integral lane is not landed");
  const reasons: string[] = [];
  if (lane.checkout_head_sha !== run.assembled_head_sha)
    reasons.push("checkout HEAD differs from assembled HEAD");
  if (lane.checkout_tree_sha !== run.assembled_tree_sha)
    reasons.push("checkout tree differs from assembled tree");
  if (lane.checkout_mode !== "clean-worktree")
    reasons.push("integral lane did not use a clean worktree");
  const dirty = JSON.parse(lane.dirty_paths_json) as string[];
  if (dirty.length > 0) reasons.push(`clean checkout has ${dirty.length} dirty paths`);
  const scoring = { verdict: reasons.length === 0 ? "pass" : "fail", reasons };
  const scoringJson = stableJson(scoring);
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `UPDATE composition_integral_lanes SET status=?, scoring_json=?, scoring_hash=?,
                scored_at=datetime('now') WHERE run_id=?`,
      )
      .run(
        reasons.length === 0 ? "scored-pass" : "scored-fail",
        scoringJson,
        hash(scoringJson),
        runId,
      );
    setRunStatus(ctx, runId, reasons.length === 0 ? "verifying" : "blocked");
  })();
  return { ...scoring, scoring_hash: hash(scoringJson) };
}

function recordDeferral(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "record_composition_deferral");
  const runId = requireString(args, "run_id");
  const run = getRun(ctx, runId);
  if (["complete", "blocked"].includes(run.status)) {
    throw new ToolError(`composition run ${runId} is ${run.status}`);
  }
  const obligationId = requireString(args, "obligation_id");
  const obligation = ctx.db
    .prepare("SELECT state, blocking FROM revalidation_obligations WHERE obligation_id=?")
    .get(obligationId) as { state: string; blocking: number } | undefined;
  if (!obligation || obligation.blocking !== 1 || obligation.state === "closed") {
    throw new ToolError("composition deferral requires an open blocking obligation destination");
  }
  const sourceItemId = optString(args, "source_item_id");
  if (sourceItemId) getItem(ctx, runId, sourceItemId);
  ctx.db
    .prepare(
      `INSERT INTO composition_deferrals
         (deferral_id, run_id, concern, obligation_id, source_item_id, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      requireString(args, "deferral_id"),
      runId,
      requireString(args, "concern"),
      obligationId,
      sourceItemId,
      sessionId,
    );
  return readComposition(ctx, runId);
}

function reconcile(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "reconcile_composition_run");
  const runId = requireString(args, "run_id");
  const run = getRun(ctx, runId);
  const counts = ctx.db
    .prepare(
      `SELECT COUNT(*) AS expected,
              SUM(CASE WHEN status!='planned' THEN 1 ELSE 0 END) AS dispatched,
              SUM(CASE WHEN status IN ('landed','scored-pass','scored-fail') THEN 1 ELSE 0 END) AS landed,
              SUM(CASE WHEN status IN ('scored-pass','scored-fail') THEN 1 ELSE 0 END) AS scored,
              SUM(CASE WHEN status='scored-pass' THEN 1 ELSE 0 END) AS passed,
              SUM(CASE WHEN status='scored-fail' THEN 1 ELSE 0 END) AS failed
         FROM composition_items WHERE run_id=?`,
    )
    .get(runId) as Record<
    "expected" | "dispatched" | "landed" | "scored" | "passed" | "failed",
    number
  >;
  const deferrals = ctx.db
    .prepare(
      "SELECT deferral_id, concern, obligation_id, source_item_id FROM composition_deferrals WHERE run_id=? ORDER BY deferral_id",
    )
    .all(runId);
  const missing = ctx.db
    .prepare(
      "SELECT item_id, item_kind, verification_scope, subject FROM composition_items WHERE run_id=? AND status!='scored-pass' ORDER BY ordinal",
    )
    .all(runId);
  const lane = ctx.db
    .prepare("SELECT status FROM composition_integral_lanes WHERE run_id=?")
    .get(runId) as { status: string } | undefined;
  const exact =
    counts.expected === run.expected_item_count &&
    counts.passed === counts.expected &&
    counts.failed === 0 &&
    deferrals.length === 0 &&
    lane?.status === "scored-pass";
  const status = exact ? "green" : "red";
  const result = {
    schema_version: 1,
    run_id: runId,
    assembled_head_sha: run.assembled_head_sha,
    fan_in: {
      expected: counts.expected,
      dispatched: counts.dispatched,
      landed: counts.landed,
      scored: counts.scored,
      passed: counts.passed,
      failed: counts.failed,
      deferred: deferrals.length,
    },
    integral_lane_status: lane?.status ?? "missing",
    seam_denominator: run.impacted_seam_count,
    seam_selection_status: run.impacted_seam_count === 0 ? "out-of-band" : "covered",
    missing_or_failed: missing,
    deferrals,
    status,
  };
  const resultJson = stableJson(result);
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO composition_reconciliations
           (run_id, expected_count, dispatched_count, landed_count, scored_count,
            passed_count, failed_count, deferred_count, status, result_json,
            result_hash, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        counts.expected,
        counts.dispatched,
        counts.landed,
        counts.scored,
        counts.passed,
        counts.failed,
        deferrals.length,
        status,
        resultJson,
        hash(resultJson),
        sessionId,
      );
    if (exact && run.status !== "complete") setRunStatus(ctx, runId, "complete");
    else if (
      (counts.failed > 0 || deferrals.length > 0 || lane?.status === "scored-fail") &&
      run.status !== "blocked"
    ) {
      setRunStatus(ctx, runId, "blocked");
    }
  })();
  return result;
}

const ITEM_SPEC_SCHEMA = {
  type: "object",
  properties: {
    item_id: { type: "string" },
    item_kind: { type: "string", enum: ITEM_KINDS },
    verification_scope: { type: "string", enum: SCOPES },
    subject: { type: "string" },
    expected_ref: { type: "string" },
    target_sha: { type: "string" },
  },
  required: ["item_id", "item_kind", "verification_scope", "subject", "expected_ref", "target_sha"],
  additionalProperties: false,
};

export const compositionTools: ToolDefinition[] = [
  {
    name: "plan_composition_run",
    description:
      "Create an immutable fan-in manifest for artifacts, commits, tests, and A7 review results. Every item declares its verification object and target commit; integral items bind to the exact currently assembled HEAD, and impacted seams require named concern coverage.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        impact_run_id: { type: "string" },
        assembled_head_sha: { type: "string" },
        expected_items: { type: "array", items: ITEM_SPEC_SCHEMA, minItems: 6 },
        seam_concerns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              seam_id: { type: "string" },
              concern_code: { type: "string" },
              rationale: { type: "string" },
            },
            required: ["seam_id", "concern_code", "rationale"],
            additionalProperties: false,
          },
        },
        no_impacted_seams_reason: { type: "string" },
      },
      required: ["run_id", "impact_run_id", "assembled_head_sha", "expected_items"],
      additionalProperties: false,
    },
    handler: (args, ctx) => plan(args, ctx),
  },
  {
    name: "dispatch_composition_item",
    description:
      "Dispatch one expected composition item with an explicit unit or integral-HEAD verification object. Integral items remain unavailable until unit fan-in has admitted the separate integral lane.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" }, item_id: { type: "string" } },
      required: ["run_id", "item_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => dispatchItem(args, ctx),
  },
  {
    name: "land_composition_item",
    description:
      "Land a worker observation exactly once without trusting its success label. A separate scorer checks the expected artifact, commit, test identity/SHA/exit, or terminal A7 aggregation against durable state.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        item_id: { type: "string" },
        observation: { type: "object" },
      },
      required: ["run_id", "item_id", "observation"],
      additionalProperties: false,
    },
    handler: (args, ctx) => landItem(args, ctx),
  },
  {
    name: "score_composition_item",
    description:
      "Independently score a landed item against its immutable manifest and durable repository/conspectus state. A success message without the expected artifact or commit becomes scored-fail.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" }, item_id: { type: "string" } },
      required: ["run_id", "item_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => scoreItem(args, ctx),
  },
  {
    name: "dispatch_integral_verification",
    description:
      "After exact passing unit fan-in, dispatch the sole composition-scoped lane over the assembled HEAD, expected integral checks, and every impacted seam's selected concerns. Missing, failed, or deferred unit work halts here.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => dispatchIntegral(args, ctx),
  },
  {
    name: "land_integral_verification",
    description:
      "Land immutable proof coordinates from a clean checkout of the assembled HEAD. Test and review results still land as their separately expected integral composition items.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        checkout_head_sha: { type: "string" },
        checkout_tree_sha: { type: "string" },
        checkout_mode: { type: "string", enum: ["clean-worktree"] },
        dirty_paths: { type: "array", items: { type: "string" } },
        execution_report_hash: { type: "string" },
      },
      required: [
        "run_id",
        "checkout_head_sha",
        "checkout_tree_sha",
        "checkout_mode",
        "dirty_paths",
        "execution_report_hash",
      ],
      additionalProperties: false,
    },
    handler: (args, ctx) => landIntegral(args, ctx),
  },
  {
    name: "score_integral_verification",
    description:
      "Verify that the integral lane used the exact assembled HEAD/tree in a clean worktree. A mismatched or dirty checkout blocks composition before final fan-in.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => scoreIntegral(args, ctx),
  },
  {
    name: "record_composition_deferral",
    description:
      "Record a composition concern as an immutable RED deferral with an existing open blocking obligation as its named destination. A source phrase alone cannot discharge the concern.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        deferral_id: { type: "string" },
        concern: { type: "string" },
        obligation_id: { type: "string" },
        source_item_id: { type: "string" },
      },
      required: ["run_id", "deferral_id", "concern", "obligation_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => recordDeferral(args, ctx),
  },
  {
    name: "reconcile_composition_run",
    description:
      "Append a reconciliation that reports expected, dispatched, landed, scored, passed, failed, and deferred N. Green requires exact item fan-in, no deferrals, and a passing clean integral lane; missing work remains RED rather than counting as less data.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => reconcile(args, ctx),
  },
  {
    name: "get_composition_run",
    description:
      "Read the immutable composition manifest, verification-object custody, seam concerns, named deferrals, integral checkout proof, and every fan-in reconciliation for one assembled HEAD.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => readComposition(ctx, requireString(args, "run_id")),
  },
];
