import { spawnSync } from "node:child_process";
import {
  ok,
  optBool,
  optString,
  requireEnum,
  requireExistingIds,
  requireString,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const EPISTEMIC_KINDS = [
  "observation",
  "inference",
  "hypothesis",
  "open-question",
  "direct-intent",
  "inferred-intent",
  "decision",
] as const;

type EpistemicKind = (typeof EPISTEMIC_KINDS)[number];

interface ClaimRow {
  claim_id: string;
  claim_key: string;
  subject_type: string;
  subject_id: string;
  statement: string;
  epistemic_kind: EpistemicKind;
  asserted_at_sha: string;
  valid_from_sha: string;
  valid_until_sha: string | null;
  session_id: string;
  created_at: string;
}

interface EvidenceRow {
  id: number;
  ref_sha: string;
}

function requireEvidenceIds(args: Record<string, unknown>): number[] {
  const value = args.evidence_ids;
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolError("evidence_ids must contain at least one structured evidence id");
  }
  if (!value.every((id) => typeof id === "number" && Number.isInteger(id))) {
    throw new ToolError("evidence_ids must contain only integers");
  }
  return [...new Set(value as number[])];
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
  if (result.status !== 0) {
    throw new ToolError(`unknown git commit: ${requested}`);
  }
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

function requireStrictDescendant(
  ctx: ServerContext,
  boundary: string,
  validFrom: string,
  operation: string,
): void {
  if (boundary === validFrom || !isAncestor(ctx, validFrom, boundary)) {
    throw new ToolError(
      `${operation} commit ${boundary} must be a strict descendant of valid_from_sha ${validFrom}`,
    );
  }
}

function requireEvidence(
  ctx: ServerContext,
  evidenceIds: number[],
  authoritySha: string,
): EvidenceRow[] {
  requireExistingIds(ctx.db, "evidence", "id", evidenceIds, "evidence id(s)");
  const placeholders = evidenceIds.map(() => "?").join(",");
  const rows = ctx.db
    .prepare(`SELECT id, ref_sha FROM evidence WHERE id IN (${placeholders}) ORDER BY id`)
    .all(...evidenceIds) as EvidenceRow[];
  for (const row of rows) {
    const evidenceSha = resolveCommit(ctx, row.ref_sha);
    if (!isAncestor(ctx, evidenceSha, authoritySha)) {
      throw new ToolError(
        `evidence ${row.id} at ${evidenceSha} is not reachable at authority commit ${authoritySha}`,
      );
    }
  }
  return rows;
}

function currentClaim(ctx: ServerContext, claimId: string): ClaimRow {
  const row = ctx.db.prepare("SELECT * FROM claims WHERE claim_id = ?").get(claimId) as
    | ClaimRow
    | undefined;
  if (!row) throw new ToolError(`unknown claim: ${claimId}`);
  if (row.valid_until_sha !== null) {
    throw new ToolError(`claim ${claimId} is historical, not current authority`);
  }
  return row;
}

function attachEvidence(
  ctx: ServerContext,
  claimId: string,
  evidenceIds: number[],
  role: "supports" | "contradicts" | "qualifies",
): void {
  const insert = ctx.db.prepare(
    "INSERT INTO claim_evidence (claim_id, evidence_id, role) VALUES (?, ?, ?)",
  );
  for (const evidenceId of evidenceIds) insert.run(claimId, evidenceId, role);
}

function claimWithEvidence(ctx: ServerContext, row: ClaimRow): Record<string, unknown> {
  const evidence = ctx.db
    .prepare(
      `SELECT ce.evidence_id, ce.role, e.file_path, e.symbol, e.line_range,
              e.ref_sha, e.kind
         FROM claim_evidence ce
         JOIN evidence e ON e.id = ce.evidence_id
        WHERE ce.claim_id = ?
        ORDER BY ce.evidence_id`,
    )
    .all(row.claim_id);
  return { ...row, evidence };
}

function claimAppliesAt(ctx: ServerContext, row: ClaimRow, querySha: string): boolean {
  if (!isAncestor(ctx, row.valid_from_sha, querySha)) return false;
  return row.valid_until_sha === null || !isAncestor(ctx, row.valid_until_sha, querySha);
}

function insertClaim(
  ctx: ServerContext,
  values: {
    claimId: string;
    claimKey: string;
    subjectType: string;
    subjectId: string;
    statement: string;
    epistemicKind: EpistemicKind;
    assertedAtSha: string;
    validFromSha: string;
    sessionId: string;
    evidenceIds: number[];
    reason: string;
  },
): void {
  ctx.db
    .prepare(
      `INSERT INTO claims (
         claim_id, claim_key, subject_type, subject_id, statement,
         epistemic_kind, asserted_at_sha, valid_from_sha, session_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.claimId,
      values.claimKey,
      values.subjectType,
      values.subjectId,
      values.statement,
      values.epistemicKind,
      values.assertedAtSha,
      values.validFromSha,
      values.sessionId,
    );
  attachEvidence(ctx, values.claimId, values.evidenceIds, "supports");
  ctx.db
    .prepare(
      `INSERT INTO claim_validity_events
         (claim_id, event_type, at_sha, reason, evidence_id, session_id)
       VALUES (?, 'asserted', ?, ?, ?, ?)`,
    )
    .run(
      values.claimId,
      values.assertedAtSha,
      values.reason,
      values.evidenceIds[0],
      values.sessionId,
    );
}

function friendlyWriteError(error: unknown, claimKey?: string): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("idx_claims_current_key") || message.includes("UNIQUE constraint failed")) {
    throw new ToolError(
      claimKey
        ? `claim_key ${claimKey} already has current authority; supersede it atomically`
        : "claim write conflicts with existing authority",
    );
  }
  throw error;
}

export const claimTools: ToolDefinition[] = [
  {
    name: "add_claim",
    description:
      "Create one current, immutable, epistemically typed claim backed by structured evidence. The Git commit and every evidence SHA must resolve in the target workspace. A claim_key may have only one current version.",
    inputSchema: {
      type: "object",
      properties: {
        claim_id: { type: "string" },
        claim_key: { type: "string" },
        subject_type: { type: "string" },
        subject_id: { type: "string" },
        statement: { type: "string" },
        epistemic_kind: { type: "string", enum: EPISTEMIC_KINDS },
        ref_sha: { type: "string" },
        valid_from_sha: { type: "string" },
        evidence_ids: { type: "array", items: { type: "integer" }, minItems: 1 },
      },
      required: [
        "claim_id",
        "claim_key",
        "subject_type",
        "subject_id",
        "statement",
        "epistemic_kind",
        "ref_sha",
        "evidence_ids",
      ],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "add_claim");
      const claimId = requireString(args, "claim_id");
      const claimKey = requireString(args, "claim_key");
      const subjectType = requireString(args, "subject_type");
      const subjectId = requireString(args, "subject_id");
      const statement = requireString(args, "statement");
      const epistemicKind = requireEnum(args, "epistemic_kind", EPISTEMIC_KINDS);
      const assertedAtSha = resolveCommit(ctx, requireString(args, "ref_sha"));
      const validFromSha = resolveCommit(ctx, optString(args, "valid_from_sha") ?? assertedAtSha);
      if (!isAncestor(ctx, validFromSha, assertedAtSha)) {
        throw new ToolError(
          `valid_from_sha ${validFromSha} is not an ancestor of asserted_at_sha ${assertedAtSha}`,
        );
      }
      const evidenceIds = requireEvidenceIds(args);
      requireEvidence(ctx, evidenceIds, assertedAtSha);

      try {
        ctx.db.transaction(() => {
          insertClaim(ctx, {
            claimId,
            claimKey,
            subjectType,
            subjectId,
            statement,
            epistemicKind,
            assertedAtSha,
            validFromSha,
            sessionId,
            evidenceIds,
            reason: "initial assertion",
          });
        })();
      } catch (error) {
        friendlyWriteError(error, claimKey);
      }
      return ok({ claim_id: claimId, claim_key: claimKey, valid_from_sha: validFromSha });
    },
  },
  {
    name: "invalidate_claim",
    description:
      "Close a current claim's validity interval at an exclusive Git boundary while preserving its history. Requires new contradictory evidence and a reason; rejected transitions are transactional.",
    inputSchema: {
      type: "object",
      properties: {
        claim_id: { type: "string" },
        at_sha: { type: "string" },
        reason: { type: "string" },
        evidence_ids: { type: "array", items: { type: "integer" }, minItems: 1 },
      },
      required: ["claim_id", "at_sha", "reason", "evidence_ids"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "invalidate_claim");
      const claimId = requireString(args, "claim_id");
      const reason = requireString(args, "reason");
      const claim = currentClaim(ctx, claimId);
      const atSha = resolveCommit(ctx, requireString(args, "at_sha"));
      requireStrictDescendant(ctx, atSha, claim.valid_from_sha, "invalidation");
      const evidenceIds = requireEvidenceIds(args);
      requireEvidence(ctx, evidenceIds, atSha);
      const existing = new Set(
        (
          ctx.db
            .prepare("SELECT evidence_id FROM claim_evidence WHERE claim_id = ?")
            .all(claimId) as Array<{ evidence_id: number }>
        ).map((row) => row.evidence_id),
      );
      if (!evidenceIds.some((id) => !existing.has(id))) {
        throw new ToolError("invalidation requires new evidence not already attached to the claim");
      }
      const newEvidence = evidenceIds.filter((id) => !existing.has(id));

      ctx.db.transaction(() => {
        ctx.db
          .prepare("UPDATE claims SET valid_until_sha = ? WHERE claim_id = ?")
          .run(atSha, claimId);
        attachEvidence(ctx, claimId, newEvidence, "contradicts");
        ctx.db
          .prepare(
            `INSERT INTO claim_validity_events
               (claim_id, event_type, at_sha, reason, evidence_id, session_id)
             VALUES (?, 'invalidated', ?, ?, ?, ?)`,
          )
          .run(claimId, atSha, reason, newEvidence[0], sessionId);
      })();
      return ok({ claim_id: claimId, valid_until_sha: atSha });
    },
  },
  {
    name: "supersede_claim",
    description:
      "Atomically close a current predecessor and create its successor in the same claim_key at one Git commit. The successor id must be new and its supporting evidence must not already support the predecessor.",
    inputSchema: {
      type: "object",
      properties: {
        predecessor_claim_id: { type: "string" },
        successor_claim_id: { type: "string" },
        statement: { type: "string" },
        epistemic_kind: { type: "string", enum: EPISTEMIC_KINDS },
        at_sha: { type: "string" },
        rationale: { type: "string" },
        evidence_ids: { type: "array", items: { type: "integer" }, minItems: 1 },
      },
      required: [
        "predecessor_claim_id",
        "successor_claim_id",
        "statement",
        "epistemic_kind",
        "at_sha",
        "rationale",
        "evidence_ids",
      ],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "supersede_claim");
      const predecessorId = requireString(args, "predecessor_claim_id");
      const successorId = requireString(args, "successor_claim_id");
      if (ctx.db.prepare("SELECT 1 FROM claims WHERE claim_id = ?").get(successorId)) {
        throw new ToolError(
          `successor claim_id ${successorId} must be new; reusing an existing claim would permit a supersession cycle`,
        );
      }
      const predecessor = currentClaim(ctx, predecessorId);
      const statement = requireString(args, "statement");
      const epistemicKind = requireEnum(args, "epistemic_kind", EPISTEMIC_KINDS);
      const rationale = requireString(args, "rationale");
      const atSha = resolveCommit(ctx, requireString(args, "at_sha"));
      requireStrictDescendant(ctx, atSha, predecessor.valid_from_sha, "supersession");
      const evidenceIds = requireEvidenceIds(args);
      requireEvidence(ctx, evidenceIds, atSha);
      const predecessorEvidence = new Set(
        (
          ctx.db
            .prepare("SELECT evidence_id FROM claim_evidence WHERE claim_id = ?")
            .all(predecessorId) as Array<{ evidence_id: number }>
        ).map((row) => row.evidence_id),
      );
      if (!evidenceIds.some((id) => !predecessorEvidence.has(id))) {
        throw new ToolError("supersession requires new evidence not attached to the predecessor");
      }
      const successorEvidence = evidenceIds.filter((id) => !predecessorEvidence.has(id));

      try {
        ctx.db.transaction(() => {
          ctx.db
            .prepare("UPDATE claims SET valid_until_sha = ? WHERE claim_id = ?")
            .run(atSha, predecessorId);
          insertClaim(ctx, {
            claimId: successorId,
            claimKey: predecessor.claim_key,
            subjectType: predecessor.subject_type,
            subjectId: predecessor.subject_id,
            statement,
            epistemicKind,
            assertedAtSha: atSha,
            validFromSha: atSha,
            sessionId,
            evidenceIds: successorEvidence,
            reason: rationale,
          });
          ctx.db
            .prepare(
              `INSERT INTO claim_validity_events
                 (claim_id, event_type, at_sha, reason, evidence_id, session_id)
               VALUES (?, 'superseded', ?, ?, ?, ?)`,
            )
            .run(predecessorId, atSha, rationale, successorEvidence[0], sessionId);
          ctx.db
            .prepare(
              `INSERT INTO claim_supersessions
                 (predecessor_claim_id, successor_claim_id, at_sha,
                  evidence_id, rationale, session_id)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(predecessorId, successorId, atSha, successorEvidence[0], rationale, sessionId);
        })();
      } catch (error) {
        friendlyWriteError(error, predecessor.claim_key);
      }
      return ok({
        predecessor_claim_id: predecessorId,
        successor_claim_id: successorId,
        boundary_sha: atSha,
      });
    },
  },
  {
    name: "get_claims",
    description:
      "Return typed claims, current by default. query_sha performs a Git-ancestry as-of query using exclusive invalidation boundaries; include_historical returns every stored version when query_sha is omitted.",
    inputSchema: {
      type: "object",
      properties: {
        claim_id: { type: "string" },
        claim_key: { type: "string" },
        subject_type: { type: "string" },
        subject_id: { type: "string" },
        epistemic_kind: { type: "string", enum: EPISTEMIC_KINDS },
        query_sha: { type: "string" },
        include_historical: { type: "boolean" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const clauses: string[] = [];
      const params: string[] = [];
      for (const [argument, column] of [
        ["claim_id", "claim_id"],
        ["claim_key", "claim_key"],
        ["subject_type", "subject_type"],
        ["subject_id", "subject_id"],
        ["epistemic_kind", "epistemic_kind"],
      ] as const) {
        const value = optString(args, argument);
        if (value !== null) {
          clauses.push(`${column} = ?`);
          params.push(value);
        }
      }
      const query = optString(args, "query_sha");
      const querySha = query === null ? null : resolveCommit(ctx, query);
      if (querySha === null && !optBool(args, "include_historical")) {
        clauses.push("valid_until_sha IS NULL");
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      let rows = ctx.db
        .prepare(`SELECT * FROM claims ${where} ORDER BY claim_key, valid_from_sha, claim_id`)
        .all(...params) as ClaimRow[];
      if (querySha !== null) rows = rows.filter((row) => claimAppliesAt(ctx, row, querySha));
      return rows.map((row) => claimWithEvidence(ctx, row));
    },
  },
  {
    name: "get_claim_history",
    description:
      "Return every version, evidence link, validity event, and supersession edge for one claim_key.",
    inputSchema: {
      type: "object",
      properties: { claim_key: { type: "string" } },
      required: ["claim_key"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const claimKey = requireString(args, "claim_key");
      const claims = ctx.db
        .prepare("SELECT * FROM claims WHERE claim_key = ? ORDER BY created_at, claim_id")
        .all(claimKey) as ClaimRow[];
      const claimIds = claims.map((row) => row.claim_id);
      if (claimIds.length === 0) return { claim_key: claimKey, claims: [], events: [], edges: [] };
      const placeholders = claimIds.map(() => "?").join(",");
      const events = ctx.db
        .prepare(
          `SELECT * FROM claim_validity_events
            WHERE claim_id IN (${placeholders}) ORDER BY id`,
        )
        .all(...claimIds);
      const edges = ctx.db
        .prepare(
          `SELECT * FROM claim_supersessions
            WHERE predecessor_claim_id IN (${placeholders}) ORDER BY created_at`,
        )
        .all(...claimIds);
      return {
        claim_key: claimKey,
        claims: claims.map((row) => claimWithEvidence(ctx, row)),
        events,
        edges,
      };
    },
  },
  {
    name: "get_legacy_claim_projection",
    description:
      "Read the non-destructive compatibility projection of legacy entries, evidence, dispositions, findings, and contradictions. Null temporal fields remain null rather than being invented.",
    inputSchema: {
      type: "object",
      properties: {
        legacy_source: { type: "string" },
        subject_type: { type: "string" },
        subject_id: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const clauses: string[] = [];
      const params: string[] = [];
      for (const key of ["legacy_source", "subject_type", "subject_id"] as const) {
        const value = optString(args, key);
        if (value !== null) {
          clauses.push(`${key} = ?`);
          params.push(value);
        }
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return ctx.db
        .prepare(`SELECT * FROM legacy_claim_projection ${where} ORDER BY claim_id`)
        .all(...params);
    },
  },
];
