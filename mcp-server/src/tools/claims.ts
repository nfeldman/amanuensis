import {
  ok,
  optBool,
  optInt,
  optString,
  requireEnum,
  requireExistingIds,
  requireString,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import {
  parseFlowStepKey,
  readClaimMarkDeclinations,
  readCurrentClaimMarks,
  requireActiveSession,
} from "../invariants.js";
import { spawnSync } from "../subprocess.js";
import {
  CLAIM_EPISTEMIC_KINDS,
  CLAIM_SUBJECT_TYPES,
  type ClaimEpistemicKind,
  EVIDENCE_KINDS,
} from "../vocabulary.js";

interface ClaimRow {
  claim_id: string;
  claim_key: string;
  subject_type: string;
  subject_id: string;
  statement: string;
  epistemic_kind: ClaimEpistemicKind;
  asserted_at_sha: string;
  valid_from_sha: string;
  valid_until_sha: string | null;
  session_id: string;
  created_at: string;
}

interface EvidenceRow {
  id: number;
  ref_sha: string;
  kind: string;
  file_path: string;
}

/**
 * §9.1's three file-anchored structural categories, as the `claim_key` shape
 * that names them. A key type, a state container, or a step of a flow is read
 * off one file, so the record can require that the reading cite it.
 * `<sid>/concurrency` and `<sid>/seam/<id>` are deliberately outside the
 * pattern: §9.1 keeps the weaker requirement for them because they are
 * frequently derived rather than read, and forcing a kind they cannot honestly
 * carry is the fabrication hazard BP4 names.
 */
const FILE_ANCHORED_CLAIM_KEY = /^[^/\s]+\/(key-type|state-container|flow)\//;

/**
 * §9.1's outcome vocabulary for a claim target, which is deliberately not the
 * finding-target verdict vocabulary: a claim either stood, fell, or was
 * replaced by a better reading of the same `claim_key`.
 */
const CLAIM_CHALLENGE_OUTCOMES = ["survived", "overturned", "superseded"] as const;

/**
 * The floor on a recorded challenge. `survived` changes no row, so without an
 * argument attached it is indistinguishable from a claim nobody looked at —
 * which is precisely the state slice-S6 found the store in. The floor is a
 * length, not a shape: demanding a template over a field the writer must
 * author is the fabrication-to-order hazard BP4 names.
 */
const MIN_CHALLENGE_LENGTH = 24;

/**
 * The evidence kinds §9.1 accepts for those three categories, filtered out of
 * the generated vocabulary rather than restated: if the enum source ever drops
 * one, this list shrinks with it instead of naming a kind nothing can carry.
 */
export const FILE_ANCHORED_EVIDENCE: readonly string[] = EVIDENCE_KINDS.filter(
  (kind) => kind === "code-verified" || kind === "contract-stated",
);

/** §2.1's symbol split: the path is everything before the **first** colon. */
export function subjectPath(subjectId: string): string {
  const at = subjectId.indexOf(":");
  return at < 0 ? subjectId : subjectId.slice(0, at);
}

/**
 * §9.1's second subtractive check. One attached row must satisfy **both**
 * halves — a strong kind *and* the file `subject_id` names. Two rows that each
 * satisfy one half do not satisfy it together: a `code-verified` reading of a
 * different file says nothing about this symbol, and a `name-inferred` row on
 * the right file is the classification-from-naming BP6 rules out. The refusal
 * names the kinds it found, so the caller can see which half failed.
 */
function requireFileAnchoredEvidence(
  claimKey: string,
  subjectId: string,
  rows: EvidenceRow[],
): void {
  if (!FILE_ANCHORED_CLAIM_KEY.test(claimKey)) return;
  const path = subjectPath(subjectId);
  if (rows.some((row) => FILE_ANCHORED_EVIDENCE.includes(row.kind) && row.file_path === path)) {
    return;
  }
  const found =
    rows.map((row) => `${row.kind} on ${row.file_path}`).join(", ") || "no evidence at all";
  throw new ToolError(
    `claim_key ${claimKey} records a key type, state container, or flow step read off ${path}, so at least one attached evidence row must be ${FILE_ANCHORED_EVIDENCE.join(" or ")} *and* cite ${path}; the attached evidence is ${found}`,
  );
}

/**
 * phase-2-structural.md's `<symbol-slug>`: the whole `<path>:<symbol>` pair
 * lowercased with non-alphanumeric runs collapsed to `-`, so two files that
 * both define `Config` get two keys (slice-S3, F9/codex).
 */
function symbolSlug(subjectId: string): string {
  return subjectId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const STABLE_KEY_PREFIX = /^([^/\s]+)\/(key-type|state-container|flow)\//;

/**
 * B04-R7: the stable-key rule, checked when the key is written. A key-type or
 * state-container key is `<sid>/<category>/<symbol-slug>`, so the next reading
 * of the same symbol supersedes this one instead of sitting beside it; a flow
 * step is `<sid>/flow/<flow-slug>/<nn>`, ordered by its number. The rule used
 * to run only in a dev gate after the record was durable, when correcting a
 * key meant discarding the structural phase, because `supersede_claim` keeps
 * the key. It runs in `add_claim` only: a successor inherits its key, and a
 * key written before this check must stay supersedable.
 */
function requireStableClaimKey(claimKey: string, subjectId: string): void {
  const match = STABLE_KEY_PREFIX.exec(claimKey);
  if (!match) return;
  const [prefix, sid, category] = match;
  if (category === "flow") {
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*\/[0-9]{2,}$/.test(claimKey.slice(prefix.length))) return;
    throw new ToolError(
      `claim_key ${claimKey} is a flow step whose key is not ${sid}/flow/<flow-slug>/<nn>, so its steps have no recorded order`,
    );
  }
  const expected = `${sid}/${category}/${symbolSlug(subjectId)}`;
  if (claimKey === expected) return;
  throw new ToolError(
    `claim_key ${claimKey} names subject ${subjectId}, whose stable key is ${expected}; an unstable key duplicates rather than supersedes`,
  );
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

export function isAncestor(ctx: ServerContext, ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  const result = git(ctx, ["merge-base", "--is-ancestor", ancestor, descendant]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new ToolError(
    `cannot compare git commits ${ancestor} and ${descendant}: ${result.stderr?.toString().trim() ?? "unknown git error"}`,
  );
}

/**
 * A claim closes at its own valid_from_sha or at a descendant of it.
 *
 * Closing at a descendant says the claim held until that commit. Closing at
 * valid_from_sha leaves an empty interval: the claim never held, which is the
 * record of a claim found wrong at the commit it was recorded at. A survey
 * reads one revision, so before this was allowed it could not overturn its own
 * claim at all (finding B04-R6). A boundary that is not a descendant would put
 * the end of the interval before its start.
 */
function requireClosingBoundary(
  ctx: ServerContext,
  boundary: string,
  validFrom: string,
  operation: string,
): void {
  if (!isAncestor(ctx, validFrom, boundary)) {
    throw new ToolError(
      `${operation} commit ${boundary} must be the claim's valid_from_sha ${validFrom} or a descendant of it`,
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
    .prepare(
      `SELECT id, ref_sha, kind, file_path FROM evidence WHERE id IN (${placeholders}) ORDER BY id`,
    )
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

/**
 * The one place a row is written to `claims`. §9.1's file-anchored check runs
 * here rather than in `add_claim`'s handler because a claim_key has two doors:
 * `add_claim` opens it and `supersede_claim` replaces what is behind it, and a
 * successor inherits its predecessor's `claim_key` and `subject_id` — it
 * asserts the same file-anchored thing about the same symbol. Enforcing on one
 * door only left the other able to replace a sound reading with a
 * `name-inferred` row on an unrelated file while the `structural` gate went on
 * counting the key as satisfied (slice-S3, F5/codex). The rows passed are the
 * ones that will be attached as `supports`, not every id the caller named.
 */
function insertClaim(
  ctx: ServerContext,
  values: {
    claimId: string;
    claimKey: string;
    subjectType: string;
    subjectId: string;
    statement: string;
    epistemicKind: ClaimEpistemicKind;
    assertedAtSha: string;
    validFromSha: string;
    sessionId: string;
    evidenceRows: EvidenceRow[];
    reason: string;
  },
): void {
  requireFileAnchoredEvidence(values.claimKey, values.subjectId, values.evidenceRows);
  const evidenceIds = values.evidenceRows.map((row) => row.id);
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
  attachEvidence(ctx, values.claimId, evidenceIds, "supports");
  ctx.db
    .prepare(
      `INSERT INTO claim_validity_events
         (claim_id, event_type, at_sha, reason, evidence_id, session_id)
       VALUES (?, 'asserted', ?, ?, ?, ?)`,
    )
    .run(values.claimId, values.assertedAtSha, values.reason, evidenceIds[0], values.sessionId);
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
      "Create one current, immutable, epistemically typed claim backed by structured evidence. The Git commit and every evidence SHA must resolve in the target workspace. A claim_key may have only one current version. A key-type or state-container key must be <sid>/<category>/<symbol-slug>, the slug being subject_id lowercased with non-alphanumeric runs collapsed to '-'; a flow key must be <sid>/flow/<flow-slug>/<nn>.",
    inputSchema: {
      type: "object",
      properties: {
        claim_id: { type: "string" },
        claim_key: { type: "string" },
        subject_type: { type: "string", enum: CLAIM_SUBJECT_TYPES },
        subject_id: { type: "string" },
        statement: { type: "string" },
        epistemic_kind: { type: "string", enum: CLAIM_EPISTEMIC_KINDS },
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
      // §9.1's first subtractive check: the enum §10.1's source owns, enforced
      // by code rather than asked for in a prompt (GP8's v2 scope note).
      const subjectType = requireEnum(args, "subject_type", CLAIM_SUBJECT_TYPES);
      const subjectId = requireString(args, "subject_id");
      requireStableClaimKey(claimKey, subjectId);
      const statement = requireString(args, "statement");
      const epistemicKind = requireEnum(args, "epistemic_kind", CLAIM_EPISTEMIC_KINDS);
      const assertedAtSha = resolveCommit(ctx, requireString(args, "ref_sha"));
      const validFromSha = resolveCommit(ctx, optString(args, "valid_from_sha") ?? assertedAtSha);
      if (!isAncestor(ctx, validFromSha, assertedAtSha)) {
        throw new ToolError(
          `valid_from_sha ${validFromSha} is not an ancestor of asserted_at_sha ${assertedAtSha}`,
        );
      }
      const evidenceIds = requireEvidenceIds(args);
      const evidenceRows = requireEvidence(ctx, evidenceIds, assertedAtSha);

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
            evidenceRows,
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
    name: "record_claim_challenge",
    description: `Record the adversarial pass's outcome for one current claim (spec.md §9.1, Phase 4). outcome ∈ {${CLAIM_CHALLENGE_OUTCOMES.join(", ")}}. \`challenge\` is what would have overturned the claim and where that was looked for, in prose of at least ${MIN_CHALLENGE_LENGTH} characters; a one-word note is not a challenge. An 'overturned' or 'superseded' outcome must name the claim_validity_events row that closed the claim — invalidate_claim and supersede_claim write it — and 'survived' must not, because nothing was closed. field_note_id optionally links the probe note the pass wrote. The record is append-only: a later pass records a further outcome, it does not edit this one. Every current \`<sid>/\` claim must carry an outcome before the subsystem may advance to 'mapped'.`,
    inputSchema: {
      type: "object",
      properties: {
        claim_id: { type: "string" },
        outcome: { type: "string", enum: [...CLAIM_CHALLENGE_OUTCOMES] },
        challenge: { type: "string", minLength: MIN_CHALLENGE_LENGTH },
        ref_sha: { type: "string" },
        validity_event_id: { type: "integer" },
        field_note_id: { type: "integer" },
      },
      required: ["claim_id", "outcome", "challenge", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "record_claim_challenge");
      const claimId = requireString(args, "claim_id");
      const outcome = requireEnum(args, "outcome", CLAIM_CHALLENGE_OUTCOMES);
      const challenge = requireString(args, "challenge");
      if (challenge.trim().length < MIN_CHALLENGE_LENGTH) {
        throw new ToolError(
          `challenge must say what would have overturned claim ${claimId} and where that was ` +
            `looked for, in at least ${MIN_CHALLENGE_LENGTH} characters; a survived outcome with ` +
            `no argument behind it is indistinguishable from a claim nobody read`,
        );
      }
      const claim = ctx.db.prepare("SELECT * FROM claims WHERE claim_id = ?").get(claimId) as
        | ClaimRow
        | undefined;
      if (!claim) throw new ToolError(`unknown claim: ${claimId}`);
      const atSha = resolveCommit(ctx, requireString(args, "ref_sha"));
      const eventId = optInt(args, "validity_event_id");
      const noteId = optInt(args, "field_note_id");

      if (outcome === "survived") {
        // A claim that survived its challenge is still the account the
        // subsystem publishes, so it must still be current; a closed interval
        // is history, and history does not survive a challenge made after it.
        if (claim.valid_until_sha !== null) {
          throw new ToolError(`claim ${claimId} is historical, not current authority`);
        }
        if (eventId !== null) {
          throw new ToolError(
            "a survived claim closed no validity interval, so validity_event_id names an event that cannot be about this outcome",
          );
        }
      } else {
        if (eventId === null) {
          throw new ToolError(
            `an ${outcome} outcome must name the claim_validity_events row that closed ${claimId}; ` +
              `an overturning that closed no interval overturned nothing`,
          );
        }
        const event = ctx.db
          .prepare("SELECT claim_id, event_type, at_sha FROM claim_validity_events WHERE id = ?")
          .get(eventId) as { claim_id: string; event_type: string; at_sha: string } | undefined;
        if (!event) throw new ToolError(`unknown claim validity event: ${eventId}`);
        if (event.claim_id !== claimId) {
          throw new ToolError(
            `claim validity event ${eventId} belongs to claim ${event.claim_id}, not ${claimId}`,
          );
        }
        const expected = outcome === "overturned" ? "invalidated" : "superseded";
        if (event.event_type !== expected) {
          throw new ToolError(
            `an ${outcome} outcome must cite an '${expected}' event; event ${eventId} is '${event.event_type}'`,
          );
        }
        // The cited event must be the one that closed *this* claim. A claim
        // that is still current was not overturned, and an event that closed
        // it at another boundary belongs to a different challenge. This is
        // also why an overturning outcome is recorded against a historical
        // claim: closing the interval is what invalidate_claim and
        // supersede_claim do, so by the time the outcome can cite its event
        // the claim is no longer current.
        if (claim.valid_until_sha === null) {
          throw new ToolError(
            `claim ${claimId} is still current; an ${outcome} outcome must cite the event that closed it`,
          );
        }
        if (claim.valid_until_sha !== event.at_sha) {
          throw new ToolError(
            `claim ${claimId} was closed at ${claim.valid_until_sha}; event ${eventId} is recorded at ${event.at_sha}`,
          );
        }
      }
      if (
        noteId !== null &&
        !ctx.db.prepare("SELECT 1 FROM field_notes WHERE id = ?").get(noteId)
      ) {
        throw new ToolError(`unknown field note: ${noteId}`);
      }

      const result = ctx.db
        .prepare(
          `INSERT INTO claim_challenge_outcomes
             (claim_id, claim_key, outcome, challenge, at_sha, validity_event_id, field_note_id, session_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(claimId, claim.claim_key, outcome, challenge, atSha, eventId, noteId, sessionId);
      return ok({
        id: Number(result.lastInsertRowid),
        claim_id: claimId,
        claim_key: claim.claim_key,
        outcome,
        at_sha: atSha,
      });
    },
  },
  {
    name: "get_claim_challenges",
    description:
      "Return the recorded adversarial outcomes for one claim or for every current claim of one subsystem, oldest first. Read-only; the record is append-only, so the last row is the latest reading and the earlier ones are the history.",
    inputSchema: {
      type: "object",
      properties: {
        claim_id: { type: "string" },
        subsystem_id: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const claimId = optString(args, "claim_id");
      const subsystemId = optString(args, "subsystem_id");
      if (claimId === null && subsystemId === null) {
        throw new ToolError("name a claim_id or a subsystem_id");
      }
      if (claimId !== null) {
        return ctx.db
          .prepare(
            `SELECT id, claim_id, claim_key, outcome, challenge, at_sha, validity_event_id,
                    field_note_id, session_id, created_at
               FROM claim_challenge_outcomes WHERE claim_id = ? ORDER BY id`,
          )
          .all(claimId);
      }
      const prefix = `${subsystemId}/`;
      return ctx.db
        .prepare(
          `SELECT o.id, o.claim_id, o.claim_key, o.outcome, o.challenge, o.at_sha,
                  o.validity_event_id, o.field_note_id, o.session_id, o.created_at
             FROM claim_challenge_outcomes o
            WHERE substr(o.claim_key, 1, length(?)) = ?
            ORDER BY o.id`,
        )
        .all(prefix, prefix);
    },
  },
  {
    name: "invalidate_claim",
    description:
      "Close a current claim's validity interval at an exclusive Git boundary while preserving its history. Requires new contradictory evidence and a reason; rejected transitions are transactional. at_sha must be the claim's valid_from_sha or a descendant of it; closing at valid_from_sha records that the claim never held, for a claim that was already false there; a claim that held and later became false closes at the commit that made it false. Returns validity_event_id, which an 'overturned' record_claim_challenge cites.",
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
      requireClosingBoundary(ctx, atSha, claim.valid_from_sha, "invalidation");
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

      const validityEventId = ctx.db.transaction(() => {
        ctx.db
          .prepare("UPDATE claims SET valid_until_sha = ? WHERE claim_id = ?")
          .run(atSha, claimId);
        attachEvidence(ctx, claimId, newEvidence, "contradicts");
        return ctx.db
          .prepare(
            `INSERT INTO claim_validity_events
               (claim_id, event_type, at_sha, reason, evidence_id, session_id)
             VALUES (?, 'invalidated', ?, ?, ?, ?)`,
          )
          .run(claimId, atSha, reason, newEvidence[0], sessionId).lastInsertRowid;
      })();
      // record_claim_challenge cites this event for an 'overturned' outcome.
      return ok({
        claim_id: claimId,
        valid_until_sha: atSha,
        validity_event_id: Number(validityEventId),
      });
    },
  },
  {
    name: "supersede_claim",
    description:
      "Atomically close a current predecessor and create its successor in the same claim_key at one Git commit. at_sha must be the predecessor's valid_from_sha or a descendant of it; at valid_from_sha the predecessor never held, which corrects a claim that was already imprecise there. The successor id must be new and its supporting evidence must not already support the predecessor. Returns validity_event_id, which a 'superseded' record_claim_challenge cites.",
    inputSchema: {
      type: "object",
      properties: {
        predecessor_claim_id: { type: "string" },
        successor_claim_id: { type: "string" },
        statement: { type: "string" },
        epistemic_kind: { type: "string", enum: CLAIM_EPISTEMIC_KINDS },
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
      const epistemicKind = requireEnum(args, "epistemic_kind", CLAIM_EPISTEMIC_KINDS);
      const rationale = requireString(args, "rationale");
      const atSha = resolveCommit(ctx, requireString(args, "at_sha"));
      requireClosingBoundary(ctx, atSha, predecessor.valid_from_sha, "supersession");
      const evidenceIds = requireEvidenceIds(args);
      const evidenceRows = requireEvidence(ctx, evidenceIds, atSha);
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
      // Only the rows that will actually support the successor. The carried-over
      // ids support the predecessor and stay attached to it; a successor judged
      // on its predecessor's evidence would inherit a soundness it never earned.
      const successorRows = evidenceRows.filter((row) => !predecessorEvidence.has(row.id));
      const successorEvidence = successorRows.map((row) => row.id);

      let validityEventId = 0;
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
            evidenceRows: successorRows,
            reason: rationale,
          });
          validityEventId = Number(
            ctx.db
              .prepare(
                `INSERT INTO claim_validity_events
                 (claim_id, event_type, at_sha, reason, evidence_id, session_id)
               VALUES (?, 'superseded', ?, ?, ?, ?)`,
              )
              .run(predecessorId, atSha, rationale, successorEvidence[0], sessionId)
              .lastInsertRowid,
          );
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
        // record_claim_challenge cites this event for a 'superseded' outcome.
        validity_event_id: validityEventId,
      });
    },
  },
  {
    name: "get_claims",
    description:
      "Return typed claims, current by default. subsystem_id returns every claim whose claim_key begins '<subsystem_id>/', matched literally. query_sha performs a Git-ancestry as-of query using exclusive invalidation boundaries; include_historical returns every stored version when query_sha is omitted. Each claim carries marks, the flow marks recorded on it that stand now (none once the claim is closed, and none that were withdrawn), and a flow-step claim carries mark_declination, the newest declaration that its flow has no marks to record, or null.",
    inputSchema: {
      type: "object",
      properties: {
        claim_id: { type: "string" },
        claim_key: { type: "string" },
        // Deliberately unconstrained: this is a read filter over stored rows,
        // and the store carries legacy subject types outside §10.1's enum
        // (`impact.ts` reads `finding` and `obligation`). Constraining the
        // filter would make those rows unreachable rather than invalid.
        subject_type: { type: "string" },
        subject_id: { type: "string" },
        epistemic_kind: { type: "string", enum: CLAIM_EPISTEMIC_KINDS },
        // §9.1's `get_claims(subsystem_id)`: every claim whose `claim_key`
        // begins `<sid>/`. Phase 4 pulls its targets this way, and reading
        // every current claim in the store to filter them client-side made
        // the completeness of the adversarial pass a property of the caller's
        // code rather than of the query (slice-S3, F8/codex).
        subsystem_id: { type: "string" },
        query_sha: { type: "string" },
        include_historical: { type: "boolean" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const clauses: string[] = [];
      const params: string[] = [];
      const subsystemId = optString(args, "subsystem_id");
      if (subsystemId !== null) {
        // substr, not LIKE: a subsystem id may carry `_` or `%`, and an
        // unescaped pattern would reach into another subsystem's namespace —
        // the same reason `requireStructuralClaim` matches this way.
        const prefix = `${subsystemId}/`;
        clauses.push("substr(claim_key, 1, length(?)) = ?");
        params.push(prefix, prefix);
      }
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
      // PLAN §7.2: each claim carries its current, unwithdrawn marks (none once the claim
      // is closed), and a flow step its flow's newest declination.
      const marks = readCurrentClaimMarks(
        ctx.db,
        rows.map((row) => row.claim_id),
      );
      const flows = rows.flatMap((row) => parseFlowStepKey(row.claim_key)?.flow ?? []);
      const declinations = readClaimMarkDeclinations(ctx.db, [...new Set(flows)]);
      return rows.map((row) => {
        const flow = parseFlowStepKey(row.claim_key)?.flow;
        return {
          ...claimWithEvidence(ctx, row),
          marks: marks.get(row.claim_id) ?? [],
          mark_declination: (flow !== undefined && declinations.get(flow)) || null,
        };
      });
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
        // As in `get_claims`: a filter over legacy rows, not a writer.
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
