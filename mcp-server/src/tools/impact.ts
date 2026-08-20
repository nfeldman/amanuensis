import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  ok,
  optEnum,
  optInt,
  optString,
  requireString,
  requireWorkspaceSourcePath,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const DISCOVERY_MODES = ["explicit-only", "request-if-gap"] as const;
type DiscoveryMode = (typeof DISCOVERY_MODES)[number];

type ChangeType =
  | "added"
  | "deleted"
  | "modified"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unmerged"
  | "unknown";

interface ChangedFile {
  ordinal: number;
  change_type: ChangeType;
  path_before: string | null;
  path_after: string | null;
  similarity: number | null;
  content_changed: boolean;
}

interface PathStep {
  kind: string;
  id: string;
  detail?: string;
}

interface ImpactObject {
  object_type:
    | "changed-file"
    | "subsystem"
    | "seam"
    | "finding"
    | "obligation"
    | "claim"
    | "control"
    | "gap";
  object_id: string;
  impact_kind: "direct" | "transitive" | "unaffected" | "gap";
  invalidates: boolean;
  reason_path: PathStep[];
}

interface TraversedRelation {
  ordinal: number;
  relation_class: "xref" | "seam";
  relation_id: string;
  from_id: string;
  to_id: string;
}

interface ClaimRow {
  claim_id: string;
  claim_key: string;
  subject_type: string;
  subject_id: string;
  valid_from_sha: string;
  valid_until_sha: string | null;
}

interface RunRow {
  run_id: string;
  base_sha: string;
  head_sha: string;
  relation_discovery_mode: DiscoveryMode;
  max_depth: number;
  explicit_gap_count: number;
  status: "predicted" | "applied" | "abandoned";
  artifact_json: string;
  session_id: string;
  created_at: string;
  applied_at: string | null;
}

function git(ctx: ServerContext, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("git", args, {
    cwd: ctx.project.workspacePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function resolveCommit(ctx: ServerContext, requested: string): string {
  const result = git(ctx, ["rev-parse", "--verify", `${requested}^{commit}`]);
  if (result.status !== 0) throw new ToolError(`unknown git commit: ${requested}`);
  const sha = result.stdout?.toString().trim() ?? "";
  if (!sha) throw new ToolError(`unknown git commit: ${requested}`);
  return sha;
}

function isAncestor(ctx: ServerContext, ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  const result = git(ctx, ["merge-base", "--is-ancestor", ancestor, descendant]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new ToolError(
    `cannot compare git commits ${ancestor} and ${descendant}: ${result.stderr?.toString().trim() ?? "unknown git error"}`,
  );
}

function parseChangedFiles(ctx: ServerContext, baseSha: string, headSha: string): ChangedFile[] {
  const result = git(ctx, ["diff", "--name-status", "-M", "-C", `${baseSha}..${headSha}`]);
  if (result.status !== 0) {
    throw new ToolError(
      `git diff failed: ${result.stderr?.toString().trim() ?? "unknown git error"}`,
    );
  }
  const typeByCode: Record<string, ChangeType> = {
    A: "added",
    D: "deleted",
    M: "modified",
    R: "renamed",
    C: "copied",
    T: "type-changed",
    U: "unmerged",
    X: "unknown",
  };
  return (result.stdout?.toString() ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line, ordinal) => {
      const [rawStatus, first, second] = line.split("\t");
      const code = rawStatus?.slice(0, 1) ?? "X";
      const similarityRaw = rawStatus?.slice(1) ?? "";
      const similarity = similarityRaw ? Number.parseInt(similarityRaw, 10) : null;
      const changeType = typeByCode[code] ?? "unknown";
      const paired = changeType === "renamed" || changeType === "copied";
      return {
        ordinal,
        change_type: changeType,
        path_before: changeType === "added" ? null : (first ?? null),
        path_after: changeType === "deleted" ? null : paired ? (second ?? null) : (first ?? null),
        similarity: Number.isFinite(similarity) ? similarity : null,
        content_changed: !(changeType === "renamed" && similarity === 100),
      };
    });
}

function pathsOf(change: ChangedFile): string[] {
  return [...new Set([change.path_before, change.path_after].filter((v): v is string => !!v))];
}

function changeIdentifier(change: ChangedFile): string {
  return change.path_before === change.path_after
    ? (change.path_after ?? change.path_before ?? `change:${change.ordinal}`)
    : `${change.path_before ?? "∅"} -> ${change.path_after ?? "∅"}`;
}

function claimAppliesAt(ctx: ServerContext, row: ClaimRow, sha: string): boolean {
  if (!isAncestor(ctx, row.valid_from_sha, sha)) return false;
  return row.valid_until_sha === null || !isAncestor(ctx, row.valid_until_sha, sha);
}

function parsePrimaryFiles(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.split("@")[0]?.split(":")[0] ?? item);
  } catch {
    return [];
  }
}

function computeImpact(
  ctx: ServerContext,
  runId: string,
  baseSha: string,
  headSha: string,
  maxDepth: number,
  discoveryMode: DiscoveryMode,
): Record<string, unknown> & {
  changed_files: ChangedFile[];
  mapped_objects: ImpactObject[];
  traversed_relations: TraversedRelation[];
  invalidated_claims: ImpactObject[];
  unaffected_controls: ImpactObject[];
  gaps: ImpactObject[];
} {
  const changedFiles = parseChangedFiles(ctx, baseSha, headSha);
  const objects = new Map<string, ImpactObject>();
  const objectKey = (object: Pick<ImpactObject, "object_type" | "object_id">) =>
    `${object.object_type}\u0000${object.object_id}`;
  const addObject = (object: ImpactObject) => {
    const key = objectKey(object);
    const prior = objects.get(key);
    if (!prior || object.reason_path.length < prior.reason_path.length) objects.set(key, object);
  };

  const changedPathReasons = new Map<string, PathStep[]>();
  const invalidatingPaths = new Set<string>();
  for (const change of changedFiles) {
    const id = changeIdentifier(change);
    const reason = [{ kind: "git-change", id, detail: change.change_type }];
    addObject({
      object_type: "changed-file",
      object_id: id,
      impact_kind: "direct",
      invalidates: false,
      reason_path: reason,
    });
    for (const path of pathsOf(change)) {
      changedPathReasons.set(path, reason);
      if (change.content_changed) invalidatingPaths.add(path);
    }
  }

  const subsystemPaths = new Map<string, PathStep[]>();
  const allChangedPaths = [...changedPathReasons.keys()];
  if (allChangedPaths.length > 0) {
    const placeholders = allChangedPaths.map(() => "?").join(",");
    const rows = ctx.db
      .prepare(
        `SELECT subsystem_id, file_path FROM file_ledger
          WHERE file_path IN (${placeholders}) ORDER BY subsystem_id, file_path`,
      )
      .all(...allChangedPaths) as Array<{ subsystem_id: string; file_path: string }>;
    const mappedPaths = new Set(rows.map((row) => row.file_path));
    // A rename/copy is one Git change with two names. If either side resolves
    // through the ledger, the other name is not an unmapped semantic gap.
    for (const change of changedFiles) {
      const paths = pathsOf(change);
      if (paths.some((path) => mappedPaths.has(path))) {
        for (const path of paths) mappedPaths.add(path);
      }
    }
    for (const row of rows) {
      if (!invalidatingPaths.has(row.file_path)) continue;
      const path = [
        ...(changedPathReasons.get(row.file_path) ?? []),
        { kind: "file-ledger", id: row.file_path },
        { kind: "subsystem", id: row.subsystem_id },
      ];
      if (!subsystemPaths.has(row.subsystem_id)) subsystemPaths.set(row.subsystem_id, path);
      addObject({
        object_type: "subsystem",
        object_id: row.subsystem_id,
        impact_kind: "direct",
        invalidates: false,
        reason_path: path,
      });
    }
    for (const path of allChangedPaths) {
      if (mappedPaths.has(path)) continue;
      addObject({
        object_type: "gap",
        object_id: `unmapped-file:${path}`,
        impact_kind: "gap",
        invalidates: false,
        reason_path: [
          ...(changedPathReasons.get(path) ?? []),
          { kind: "explicit-relation-gap", id: path, detail: "no file-ledger mapping" },
        ],
      });
    }
  }

  const xrefs = ctx.db
    .prepare("SELECT from_id, to_id, relationship FROM xrefs ORDER BY from_id, to_id, relationship")
    .all() as Array<{ from_id: string; to_id: string; relationship: string }>;
  const seams = ctx.db
    .prepare("SELECT id, party_a, party_b FROM seams ORDER BY id")
    .all() as Array<{ id: string; party_a: string; party_b: string }>;
  const adjacency = new Map<
    string,
    Array<{ relation_class: "xref" | "seam"; relation_id: string; other: string }>
  >();
  const addEdge = (
    from: string,
    other: string,
    relationClass: "xref" | "seam",
    relationId: string,
  ) => {
    const edges = adjacency.get(from) ?? [];
    edges.push({ relation_class: relationClass, relation_id: relationId, other });
    adjacency.set(from, edges);
  };
  for (const row of xrefs) {
    const id = `xref:${row.from_id}:${row.to_id}:${row.relationship}`;
    addEdge(row.from_id, row.to_id, "xref", id);
    addEdge(row.to_id, row.from_id, "xref", id);
  }
  for (const row of seams) {
    const id = `seam:${row.id}`;
    addEdge(row.party_a, row.party_b, "seam", id);
    addEdge(row.party_b, row.party_a, "seam", id);
  }
  for (const edges of adjacency.values()) {
    edges.sort((a, b) =>
      `${a.relation_class}:${a.relation_id}:${a.other}`.localeCompare(
        `${b.relation_class}:${b.relation_id}:${b.other}`,
      ),
    );
  }

  const queue = [...subsystemPaths.keys()].sort().map((id) => ({ id, depth: 0 }));
  const visited = new Map([...subsystemPaths.keys()].map((id) => [id, 0]));
  const relations: TraversedRelation[] = [];
  const relationKeys = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= maxDepth) continue;
    for (const edge of adjacency.get(current.id) ?? []) {
      const relationKey = `${edge.relation_class}\u0000${edge.relation_id}\u0000${current.id}\u0000${edge.other}`;
      if (!relationKeys.has(relationKey)) {
        relationKeys.add(relationKey);
        relations.push({
          ordinal: relations.length,
          relation_class: edge.relation_class,
          relation_id: edge.relation_id,
          from_id: current.id,
          to_id: edge.other,
        });
      }
      const basePath = subsystemPaths.get(current.id) ?? [];
      const nextPath = [
        ...basePath,
        { kind: edge.relation_class, id: edge.relation_id },
        { kind: "subsystem", id: edge.other },
      ];
      if (edge.relation_class === "seam") {
        const seamId = edge.relation_id.slice("seam:".length);
        addObject({
          object_type: "seam",
          object_id: seamId,
          impact_kind: "transitive",
          invalidates: false,
          reason_path: nextPath.slice(0, -1),
        });
      }
      const priorDepth = visited.get(edge.other);
      if (priorDepth !== undefined && priorDepth <= current.depth + 1) continue;
      visited.set(edge.other, current.depth + 1);
      subsystemPaths.set(edge.other, nextPath);
      addObject({
        object_type: "subsystem",
        object_id: edge.other,
        impact_kind: "transitive",
        invalidates: false,
        reason_path: nextPath,
      });
      queue.push({ id: edge.other, depth: current.depth + 1 });
    }
  }

  const findingPaths = new Map<string, PathStep[]>();
  const findings = ctx.db
    .prepare("SELECT finding_id, subsystem_id, primary_files FROM findings ORDER BY finding_id")
    .all() as Array<{ finding_id: string; subsystem_id: string; primary_files: string | null }>;
  const evidenceFindingRows = ctx.db
    .prepare(
      `SELECT fe.finding_id, e.file_path
         FROM finding_evidence fe JOIN evidence e ON e.id = fe.evidence_id
        ORDER BY fe.finding_id, e.file_path`,
    )
    .all() as Array<{ finding_id: string; file_path: string }>;
  const directFindingFiles = new Map<string, string>();
  for (const row of evidenceFindingRows) {
    if (invalidatingPaths.has(row.file_path) && !directFindingFiles.has(row.finding_id)) {
      directFindingFiles.set(row.finding_id, row.file_path);
    }
  }
  for (const finding of findings) {
    const primary = parsePrimaryFiles(finding.primary_files).find((path) =>
      invalidatingPaths.has(path),
    );
    const directFile = directFindingFiles.get(finding.finding_id) ?? primary;
    const subsystemPath = subsystemPaths.get(finding.subsystem_id);
    if (!directFile && !subsystemPath) continue;
    const path = directFile
      ? [
          ...(changedPathReasons.get(directFile) ?? []),
          { kind: "finding-evidence", id: directFile },
          { kind: "finding", id: finding.finding_id },
        ]
      : [...(subsystemPath ?? []), { kind: "finding", id: finding.finding_id }];
    findingPaths.set(finding.finding_id, path);
    addObject({
      object_type: "finding",
      object_id: finding.finding_id,
      impact_kind: directFile ? "direct" : "transitive",
      invalidates: false,
      reason_path: path,
    });
  }

  const obligationPaths = new Map<string, PathStep[]>();
  const obligations = ctx.db
    .prepare(
      `SELECT id, subsystem_id FROM open_questions
        WHERE resolution = 'open' ORDER BY id`,
    )
    .all() as Array<{ id: number; subsystem_id: string | null }>;
  for (const obligation of obligations) {
    if (!obligation.subsystem_id) continue;
    const subsystemPath = subsystemPaths.get(obligation.subsystem_id);
    if (!subsystemPath) continue;
    const id = `open-question:${obligation.id}`;
    const path = [...subsystemPath, { kind: "obligation", id }];
    obligationPaths.set(id, path);
    addObject({
      object_type: "obligation",
      object_id: id,
      impact_kind: "transitive",
      invalidates: false,
      reason_path: path,
    });
  }

  const evidenceRows = ctx.db
    .prepare(
      `SELECT ce.claim_id, e.file_path
         FROM claim_evidence ce JOIN evidence e ON e.id = ce.evidence_id
        ORDER BY ce.claim_id, e.file_path`,
    )
    .all() as Array<{ claim_id: string; file_path: string }>;
  const directClaimFiles = new Map<string, string>();
  for (const row of evidenceRows) {
    if (invalidatingPaths.has(row.file_path) && !directClaimFiles.has(row.claim_id)) {
      directClaimFiles.set(row.claim_id, row.file_path);
    }
  }
  const claims = (
    ctx.db.prepare("SELECT * FROM claims ORDER BY claim_id").all() as ClaimRow[]
  ).filter((row) => claimAppliesAt(ctx, row, baseSha));
  const invalidatedClaims: ImpactObject[] = [];
  const unaffectedControls: ImpactObject[] = [];
  for (const claim of claims) {
    const directFile = directClaimFiles.get(claim.claim_id);
    let targetPath: PathStep[] | undefined;
    if (directFile) {
      targetPath = [
        ...(changedPathReasons.get(directFile) ?? []),
        { kind: "claim-evidence", id: directFile },
        { kind: "claim", id: claim.claim_id },
      ];
    } else if (claim.subject_type === "subsystem") {
      const path = subsystemPaths.get(claim.subject_id);
      if (path) targetPath = [...path, { kind: "claim", id: claim.claim_id }];
    } else if (claim.subject_type === "seam") {
      const object = objects.get(`seam\u0000${claim.subject_id}`);
      if (object) targetPath = [...object.reason_path, { kind: "claim", id: claim.claim_id }];
    } else if (claim.subject_type === "finding") {
      const path = findingPaths.get(claim.subject_id);
      if (path) targetPath = [...path, { kind: "claim", id: claim.claim_id }];
    } else if (claim.subject_type === "obligation") {
      const path = obligationPaths.get(claim.subject_id);
      if (path) targetPath = [...path, { kind: "claim", id: claim.claim_id }];
    }
    if (targetPath) {
      const object: ImpactObject = {
        object_type: "claim",
        object_id: claim.claim_id,
        impact_kind: directFile ? "direct" : "transitive",
        invalidates: true,
        reason_path: targetPath,
      };
      invalidatedClaims.push(object);
      addObject(object);
    } else {
      const object: ImpactObject = {
        object_type: "control",
        object_id: claim.claim_id,
        impact_kind: "unaffected",
        invalidates: false,
        reason_path: [{ kind: "control", id: "not-reached-by-explicit-graph" }],
      };
      unaffectedControls.push(object);
      addObject(object);
    }
  }

  const mappedObjects = [...objects.values()].sort((a, b) =>
    `${a.object_type}:${a.object_id}`.localeCompare(`${b.object_type}:${b.object_id}`),
  );
  const gaps = mappedObjects.filter((object) => object.object_type === "gap");
  return {
    schema_version: 1,
    run_id: runId,
    base_sha: baseSha,
    head_sha: headSha,
    relation_discovery: {
      mode: discoveryMode,
      explicit_gap_count: gaps.length,
      request:
        discoveryMode === "request-if-gap" && gaps.length > 0
          ? {
              kind: "relation-discovery-request",
              status: "not-executed",
              gap_ids: gaps.map((gap) => gap.object_id),
              constraint:
                "return candidate relations for independent verification; do not invalidate",
            }
          : null,
    },
    changed_files: changedFiles,
    mapped_objects: mappedObjects,
    traversed_relations: relations,
    invalidated_claims: invalidatedClaims.sort((a, b) => a.object_id.localeCompare(b.object_id)),
    unaffected_controls: unaffectedControls.sort((a, b) => a.object_id.localeCompare(b.object_id)),
    gaps,
    counts: {
      denominator_status: changedFiles.length === 0 ? "out-of-band-zero" : "measured",
      changed_files: changedFiles.length,
      content_changes: changedFiles.filter((change) => change.content_changed).length,
      mapped_objects: mappedObjects.length,
      traversed_relations: relations.length,
      invalidated_claims: invalidatedClaims.length,
      unaffected_controls: unaffectedControls.length,
      explicit_gaps: gaps.length,
    },
  };
}

function persistImpact(
  ctx: ServerContext,
  artifact: ReturnType<typeof computeImpact>,
  sessionId: string,
  maxDepth: number,
  discoveryMode: DiscoveryMode,
): void {
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO change_impact_runs
           (run_id, base_sha, head_sha, relation_discovery_mode, max_depth,
            explicit_gap_count, artifact_json, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.run_id,
        artifact.base_sha,
        artifact.head_sha,
        discoveryMode,
        maxDepth,
        artifact.gaps.length,
        JSON.stringify(artifact),
        sessionId,
      );
    const fileInsert = ctx.db.prepare(
      `INSERT INTO change_impact_files
         (run_id, ordinal, change_type, path_before, path_after, similarity)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const file of artifact.changed_files) {
      fileInsert.run(
        artifact.run_id,
        file.ordinal,
        file.change_type,
        file.path_before,
        file.path_after,
        file.similarity,
      );
    }
    const objectInsert = ctx.db.prepare(
      `INSERT INTO change_impact_objects
         (run_id, object_type, object_id, impact_kind, invalidates, reason_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const object of artifact.mapped_objects) {
      objectInsert.run(
        artifact.run_id,
        object.object_type,
        object.object_id,
        object.impact_kind,
        object.invalidates ? 1 : 0,
        JSON.stringify(object.reason_path),
      );
    }
    const relationInsert = ctx.db.prepare(
      `INSERT INTO change_impact_relations
         (run_id, ordinal, relation_class, relation_id, from_id, to_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const relation of artifact.traversed_relations) {
      relationInsert.run(
        artifact.run_id,
        relation.ordinal,
        relation.relation_class,
        relation.relation_id,
        relation.from_id,
        relation.to_id,
      );
    }
    const invalidationInsert = ctx.db.prepare(
      `INSERT INTO change_impact_invalidations (run_id, claim_id, reason_path)
       VALUES (?, ?, ?)`,
    );
    for (const claim of artifact.invalidated_claims) {
      invalidationInsert.run(artifact.run_id, claim.object_id, JSON.stringify(claim.reason_path));
    }
  })();
}

export const impactTools: ToolDefinition[] = [
  {
    name: "predict_change_impact",
    description:
      "Compute and durably record an explainable predicted diff before comparison or invalidation. Uses rename-aware Git changes, file-ledger mappings, claim/finding evidence, xrefs, seams, and open obligations. Explicit gaps can emit a non-executing discovery request; this tool never calls a model.",
    inputSchema: {
      type: "object",
      properties: {
        base_sha: { type: "string" },
        head_sha: { type: "string" },
        run_id: { type: "string" },
        max_depth: { type: "integer", minimum: 0, maximum: 16 },
        relation_discovery: { type: "string", enum: DISCOVERY_MODES },
      },
      required: ["base_sha", "head_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "predict_change_impact");
      const baseSha = resolveCommit(ctx, requireString(args, "base_sha"));
      const headSha = resolveCommit(ctx, requireString(args, "head_sha"));
      if (baseSha === headSha) throw new ToolError("change impact range must contain a change");
      if (!isAncestor(ctx, baseSha, headSha)) {
        throw new ToolError(`base_sha ${baseSha} must be an ancestor of head_sha ${headSha}`);
      }
      const runId = optString(args, "run_id") ?? `impact-${randomUUID()}`;
      const maxDepth = optInt(args, "max_depth", 8) ?? 8;
      if (maxDepth < 0 || maxDepth > 16) throw new ToolError("max_depth must be between 0 and 16");
      const discoveryMode = optEnum(args, "relation_discovery", DISCOVERY_MODES) ?? "explicit-only";
      const artifact = computeImpact(ctx, runId, baseSha, headSha, maxDepth, discoveryMode);
      try {
        persistImpact(ctx, artifact, sessionId, maxDepth, discoveryMode);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("UNIQUE constraint failed")) {
          throw new ToolError(`change impact run_id already exists: ${runId}`);
        }
        throw error;
      }
      return artifact;
    },
  },
  {
    name: "get_change_impact",
    description:
      "Read a durable predicted-diff artifact and its current application state. Optional object_type/object_id filters return the exact traversable reason path for one impacted object.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        object_type: { type: "string" },
        object_id: { type: "string" },
      },
      required: ["run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const runId = requireString(args, "run_id");
      const run = ctx.db.prepare("SELECT * FROM change_impact_runs WHERE run_id = ?").get(runId) as
        | RunRow
        | undefined;
      if (!run) throw new ToolError(`unknown change impact run: ${runId}`);
      const objectType = optString(args, "object_type");
      const objectId = optString(args, "object_id");
      if ((objectType === null) !== (objectId === null)) {
        throw new ToolError("object_type and object_id must be supplied together");
      }
      if (objectType && objectId) {
        const object = ctx.db
          .prepare(
            `SELECT object_type, object_id, impact_kind, invalidates, reason_path
               FROM change_impact_objects
              WHERE run_id = ? AND object_type = ? AND object_id = ?`,
          )
          .get(runId, objectType, objectId) as
          | {
              object_type: string;
              object_id: string;
              impact_kind: string;
              invalidates: number;
              reason_path: string;
            }
          | undefined;
        if (!object) throw new ToolError(`impact object not found: ${objectType}/${objectId}`);
        return {
          run_id: runId,
          status: run.status,
          object: {
            ...object,
            invalidates: object.invalidates === 1,
            reason_path: JSON.parse(object.reason_path),
          },
        };
      }
      const invalidations = ctx.db
        .prepare(
          `SELECT claim_id, state, evidence_id, applied_at, reason_path
             FROM change_impact_invalidations WHERE run_id = ? ORDER BY claim_id`,
        )
        .all(runId)
        .map((row) => {
          const typed = row as { reason_path: string };
          return { ...typed, reason_path: JSON.parse(typed.reason_path) };
        });
      return {
        ...JSON.parse(run.artifact_json),
        execution: {
          status: run.status,
          session_id: run.session_id,
          created_at: run.created_at,
          applied_at: run.applied_at,
          invalidations,
        },
      };
    },
  },
  {
    name: "apply_change_impact",
    description:
      "Atomically apply a previously recorded prediction: create structured git-change evidence, close every still-current predicted claim at head_sha, append validity events, and retain the immutable predicted artifact for audit.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "apply_change_impact");
      const runId = requireString(args, "run_id");
      const reason = optString(args, "reason") ?? `invalidated by change impact ${runId}`;
      const run = ctx.db.prepare("SELECT * FROM change_impact_runs WHERE run_id = ?").get(runId) as
        | RunRow
        | undefined;
      if (!run) throw new ToolError(`unknown change impact run: ${runId}`);
      if (run.status !== "predicted") {
        throw new ToolError(`change impact ${runId} is ${run.status}, not predicted`);
      }
      const predicted = ctx.db
        .prepare(
          `SELECT i.claim_id, i.reason_path, c.valid_from_sha, c.valid_until_sha
             FROM change_impact_invalidations i
             JOIN claims c ON c.claim_id = i.claim_id
            WHERE i.run_id = ? AND i.state = 'predicted'
            ORDER BY i.claim_id`,
        )
        .all(runId) as Array<{
        claim_id: string;
        reason_path: string;
        valid_from_sha: string;
        valid_until_sha: string | null;
      }>;
      for (const row of predicted) {
        if (row.valid_until_sha !== null) {
          throw new ToolError(`claim ${row.claim_id} changed after prediction; recompute impact`);
        }
        if (
          row.valid_from_sha === run.head_sha ||
          !isAncestor(ctx, row.valid_from_sha, run.head_sha)
        ) {
          throw new ToolError(
            `claim ${row.claim_id} cannot be invalidated at impact head; recompute impact`,
          );
        }
      }
      const artifact = JSON.parse(run.artifact_json) as { changed_files: ChangedFile[] };
      const changesById = new Map(
        artifact.changed_files.map((change) => [changeIdentifier(change), change]),
      );
      const appliedEvidenceIds: number[] = [];
      ctx.db.transaction(() => {
        const evidenceByChange = new Map<string, number>();
        for (const row of predicted) {
          const reasonPath = JSON.parse(row.reason_path) as PathStep[];
          const changeStep = reasonPath.find((step) => step.kind === "git-change");
          const change = changeStep ? changesById.get(changeStep.id) : undefined;
          if (!changeStep || !change) {
            throw new ToolError(`claim ${row.claim_id} has no resolvable Git-change reason`);
          }
          let evidenceId = evidenceByChange.get(changeStep.id);
          if (evidenceId === undefined) {
            const evidencePath = change.path_after ?? change.path_before;
            if (!evidencePath) {
              throw new ToolError(`change ${changeStep.id} has no evidence path`);
            }
            const sourcePath = requireWorkspaceSourcePath(evidencePath);
            const evidenceSha = change.path_after ? run.head_sha : run.base_sha;
            const evidence = ctx.db
              .prepare(
                `INSERT INTO evidence
                   (file_path, ref_sha, kind, note, session_id)
                 VALUES (?, ?, 'runtime-observed', ?, ?)`,
              )
              .run(
                sourcePath,
                evidenceSha,
                `${reason}; Git range ${run.base_sha}..${run.head_sha}; change ${changeStep.id}`,
                sessionId,
              );
            evidenceId = Number(evidence.lastInsertRowid);
            evidenceByChange.set(changeStep.id, evidenceId);
            appliedEvidenceIds.push(evidenceId);
          }
          ctx.db
            .prepare("UPDATE claims SET valid_until_sha = ? WHERE claim_id = ?")
            .run(run.head_sha, row.claim_id);
          ctx.db
            .prepare(
              `INSERT INTO claim_evidence (claim_id, evidence_id, role)
               VALUES (?, ?, 'contradicts')`,
            )
            .run(row.claim_id, evidenceId);
          ctx.db
            .prepare(
              `INSERT INTO claim_validity_events
                 (claim_id, event_type, at_sha, reason, evidence_id, session_id)
               VALUES (?, 'invalidated', ?, ?, ?, ?)`,
            )
            .run(row.claim_id, run.head_sha, reason, evidenceId, sessionId);
          ctx.db
            .prepare(
              `UPDATE change_impact_invalidations
                  SET state = 'applied', evidence_id = ?, applied_at = datetime('now')
                WHERE run_id = ? AND claim_id = ?`,
            )
            .run(evidenceId, runId, row.claim_id);
        }
        ctx.db
          .prepare(
            `UPDATE change_impact_runs
                SET status = 'applied', applied_at = datetime('now')
              WHERE run_id = ?`,
          )
          .run(runId);
      })();
      return ok({
        run_id: runId,
        invalidated_claims: predicted.length,
        evidence_id: appliedEvidenceIds[0] ?? null,
        evidence_ids: appliedEvidenceIds,
      });
    },
  },
];
