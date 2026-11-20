import {
  ok,
  optString,
  requireString,
  resolveWorkspaceCommit,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import {
  type ClaimMarkRow,
  parseFlowStepKey,
  readCurrentClaimMarks,
  requireActiveSession,
} from "../invariants.js";
import { CLAIM_MARK_KINDS, type ClaimMarkKind, VOCABULARY } from "../vocabulary.js";
import { FILE_ANCHORED_EVIDENCE, isAncestor, subjectPath } from "./claims.js";
import { byteLength, isOneParagraph, LINE_BREAK, REASON_CAP } from "./explanations.js";

/** A mark's label (a crash point's half-done state, an exit's reason) is one short line. */
const LABEL_CAP = 120;
/** The target of an exit that does not unwind to a step of its flow. */
const LEAVES_FLOW = "leaves-flow";

/**
 * The refusal sentences, one table per tool. Each begins with its own tool's
 * name so `check-refusal-parity.mjs` reads it as that tool's refusal, and each
 * names the repair rather than only the fault.
 */
const MARK_REFUSALS = {
  kind: (kind: string) =>
    `record_claim_mark refuses: ${kind || "an empty kind"} is not a mark kind. Use one of ${CLAIM_MARK_KINDS.join(", ")}.`,
  noClaim: (id: string) =>
    `record_claim_mark refuses: no claim ${id}. Pass the claim_id of a flow step that get_claims lists.`,
  closed: (id: string) =>
    `record_claim_mark refuses: claim ${id} is closed, so its marks would not be current. Mark the claim that replaced it.`,
  notFlowStep: (key: string) =>
    `record_claim_mark refuses: ${key} is not a flow step. A mark goes on a claim keyed <sid>/flow/<slug>/<nn>.`,
  onlyFirstStep: (key: string, step: string) =>
    `record_claim_mark refuses: a trigger is the start of a flow, so it belongs to step 00; ${key} is step ${step}.`,
  needs: (kind: string, field: string) =>
    `record_claim_mark refuses: a ${kind} mark needs a ${field}. ${
      field === "label"
        ? `Say in one line of at most ${LABEL_CAP} characters what it is.`
        : "Name where it points."
    }`,
  unused: (kind: string, field: string) =>
    `record_claim_mark refuses: a ${kind} mark takes no ${field}. Leave it out.`,
  label: () =>
    `record_claim_mark refuses: a label is one line of at most ${LABEL_CAP} characters. Say it in fewer.`,
  noSeam: (target: string) =>
    `record_claim_mark refuses: no seam ${target}. Name a seam upsert_seam recorded.`,
  notParty: (target: string, a: string, b: string, subsystem: string) =>
    `record_claim_mark refuses: seam ${target} lies between ${a} and ${b}, and ${subsystem} is not one of them. Name a seam the flow's subsystem is party to.`,
  exitTarget: (target: string, steps: string[]) =>
    `record_claim_mark refuses: an exit unwinds to a step of its own flow or to '${LEAVES_FLOW}', and ${target} is neither. The flow's current steps are ${steps.join(", ") || "none"}; name one by its number.`,
  noEvidence: (id: number) =>
    `record_claim_mark refuses: no evidence row ${id}. add_evidence records one.`,
  evidenceFile: (id: number, path: string) =>
    `record_claim_mark refuses: evidence ${id} does not show the step. A mark rests on a code-verified or contract-stated row that cites ${path}, the file the step's claim is about.`,
  evidenceRevision: (id: number, ref: string) =>
    `record_claim_mark refuses: evidence ${id} was taken at a revision that ref_sha ${ref} does not descend from. Record the mark at a revision that includes it.`,
  revision: (ref: string) =>
    `record_claim_mark refuses: ref_sha ${ref} does not resolve to a commit in the bound workspace. Record the revision the mark was read at.`,
  duplicate: (id: number) =>
    `record_claim_mark refuses: mark ${id} already says this about the step. Withdraw it first if it is to change.`,
} as const;

const WITHDRAW_REFUSALS = {
  noMark: (id: number) =>
    `withdraw_claim_mark refuses: no mark ${id}. Pass the id record_claim_mark returned, or one get_claims lists.`,
  already: (id: number) =>
    `withdraw_claim_mark refuses: mark ${id} is already withdrawn. Record it again if it should stand.`,
  reason: () =>
    `withdraw_claim_mark refuses: a reason is one paragraph of at most ${REASON_CAP} bytes, with no blank line and no line starting with '#', '-', '*' or '|'. Say why the mark is wrong in fewer.`,
} as const;

const DECLINE_REFUSALS = {
  flow: (flow: string) =>
    `decline_claim_marks refuses: ${flow || "an empty flow"} is not a flow. Name it <sid>/flow/<slug>, without the step number.`,
  noSteps: (flow: string) =>
    `decline_claim_marks refuses: flow ${flow} has no current step claim. Record its steps with add_claim first.`,
  reason: () =>
    `decline_claim_marks refuses: a reason is one paragraph of at most ${REASON_CAP} bytes, with no blank line and no line starting with '#', '-', '*' or '|'. Say why the flow has no marks to record in fewer.`,
  revision: (ref: string) =>
    `decline_claim_marks refuses: ref_sha ${ref} does not resolve to a commit in the bound workspace. Record the revision the flow was read at.`,
} as const;

interface ClaimRow {
  claim_id: string;
  claim_key: string;
  subject_id: string;
  valid_until_sha: string | null;
}

/** What the contract says of a mark kind: which columns it must carry and whether it is tied to one step. */
function kindRule(kind: ClaimMarkKind): { requires: readonly string[]; onlyStep: string | null } {
  const entry = VOCABULARY.claim_mark_kind?.values.find((value) => value.value === kind);
  return { requires: entry?.requires ?? [], onlyStep: entry?.only_step ?? null };
}

/** The text of an optional argument, trimmed, or null when absent or blank. */
function optTrimmed(args: Record<string, unknown>, key: string): string | null {
  const value = optString(args, key)?.trim() ?? "";
  return value === "" ? null : value;
}

/** A reason: required, one paragraph, within the byte cap. */
function requireReason(args: Record<string, unknown>, refusal: () => string): string {
  const text = (optString(args, "reason") ?? "").trim();
  if (text === "" || byteLength(text) > REASON_CAP || !isOneParagraph(text)) {
    throw new ToolError(refusal());
  }
  return text;
}

/** The revision, resolved in the bound workspace; a failure to resolve is this tool's refusal, in its own words. */
function resolveRevision(
  ctx: ServerContext,
  args: Record<string, unknown>,
  refusal: (ref: string) => string,
): string {
  const ref = requireString(args, "ref_sha");
  try {
    return resolveWorkspaceCommit(ctx, ref);
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    throw new ToolError(refusal(ref));
  }
}

/** The step numbers of `flow` (`<sid>/flow/<slug>`) that have a current claim, in order. */
function currentSteps(ctx: ServerContext, flow: string): string[] {
  const rows = ctx.db
    .prepare(
      `SELECT claim_key FROM claims
        WHERE substr(claim_key, 1, length(?)) = ? AND valid_until_sha IS NULL
        ORDER BY claim_key`,
    )
    .all(`${flow}/`, `${flow}/`) as Array<{ claim_key: string }>;
  return rows.flatMap((row) => {
    const parsed = parseFlowStepKey(row.claim_key);
    return parsed?.flow === flow ? parsed.step : [];
  });
}

export const claimMarkTools: ToolDefinition[] = [
  {
    name: "record_claim_mark",
    description: `Record a flow mark on one current flow-step claim (a claim keyed <sid>/flow/<slug>/<nn>): kind commit-point (the step after which the flow's effect is kept), crash-point (a step where the process can stop partway; label says what is left half done), exit (a way the flow stops early; label says why, target is a step number of the same flow or '${LEAVES_FLOW}'), crosses-seam (target is a seam the subsystem is party to) or trigger (what starts the flow; step 00 only). A label is one line of at most ${LABEL_CAP} characters; a kind takes only the label and target it needs. evidence_id names one evidence row that is code-verified or contract-stated and cites the file the step's claim is about. A mark stands while its claim is current and it is not withdrawn: a closed claim's marks are not current, and its successor records its own. The record is append-only. Returns a receipt.`,
    inputSchema: {
      type: "object",
      properties: {
        claim_id: { type: "string" },
        kind: { type: "string", enum: [...CLAIM_MARK_KINDS] },
        label: { type: "string" },
        target: { type: "string" },
        evidence_id: { type: "integer" },
        ref_sha: { type: "string" },
      },
      required: ["claim_id", "kind", "evidence_id", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "record_claim_mark");
      const claimId = requireString(args, "claim_id");
      const kindText = requireString(args, "kind");
      if (!(CLAIM_MARK_KINDS as readonly string[]).includes(kindText)) {
        throw new ToolError(MARK_REFUSALS.kind(kindText));
      }
      const kind = kindText as ClaimMarkKind;
      const claim = ctx.db
        .prepare(
          "SELECT claim_id, claim_key, subject_id, valid_until_sha FROM claims WHERE claim_id = ?",
        )
        .get(claimId) as ClaimRow | undefined;
      if (!claim) throw new ToolError(MARK_REFUSALS.noClaim(claimId));
      const step = parseFlowStepKey(claim.claim_key);
      if (!step) throw new ToolError(MARK_REFUSALS.notFlowStep(claim.claim_key));
      if (claim.valid_until_sha !== null) throw new ToolError(MARK_REFUSALS.closed(claimId));
      const rule = kindRule(kind);
      if (rule.onlyStep !== null && step.step !== rule.onlyStep) {
        throw new ToolError(MARK_REFUSALS.onlyFirstStep(claim.claim_key, step.step));
      }

      // Which of label and target a kind carries is the contract's; a field it does not use is refused, not dropped.
      const label = optTrimmed(args, "label");
      const target = optTrimmed(args, "target");
      for (const [field, given] of [
        ["label", label],
        ["target", target],
      ] as const) {
        if (rule.requires.includes(field) && given === null) {
          throw new ToolError(MARK_REFUSALS.needs(kind, field));
        }
        if (!rule.requires.includes(field) && given !== null) {
          throw new ToolError(MARK_REFUSALS.unused(kind, field));
        }
      }
      if (label !== null && ([...label].length > LABEL_CAP || LINE_BREAK.test(label))) {
        throw new ToolError(MARK_REFUSALS.label());
      }
      if (kind === "crosses-seam" && target !== null) {
        const seam = ctx.db
          .prepare("SELECT party_a, party_b FROM seams WHERE id = ?")
          .get(target) as { party_a: string; party_b: string } | undefined;
        if (!seam) throw new ToolError(MARK_REFUSALS.noSeam(target));
        if (seam.party_a !== step.subsystemId && seam.party_b !== step.subsystemId) {
          throw new ToolError(
            MARK_REFUSALS.notParty(target, seam.party_a, seam.party_b, step.subsystemId),
          );
        }
      }
      if (kind === "exit" && target !== null && target !== LEAVES_FLOW) {
        const steps = currentSteps(ctx, step.flow);
        if (!steps.includes(target)) throw new ToolError(MARK_REFUSALS.exitTarget(target, steps));
      }

      const evidenceId = args.evidence_id;
      if (typeof evidenceId !== "number" || !Number.isInteger(evidenceId)) {
        throw new ToolError("expected integer for evidence_id");
      }
      const evidence = ctx.db
        .prepare("SELECT id, ref_sha, kind, file_path FROM evidence WHERE id = ?")
        .get(evidenceId) as
        | { id: number; ref_sha: string; kind: string; file_path: string }
        | undefined;
      if (!evidence) throw new ToolError(MARK_REFUSALS.noEvidence(evidenceId));
      // As requireFileAnchoredEvidence reads a flow step: one row, a strong kind and the claim subject's file.
      const path = subjectPath(claim.subject_id);
      if (!FILE_ANCHORED_EVIDENCE.includes(evidence.kind) || evidence.file_path !== path) {
        throw new ToolError(MARK_REFUSALS.evidenceFile(evidenceId, path));
      }
      const refSha = resolveRevision(ctx, args, MARK_REFUSALS.revision);
      let reachable = false;
      try {
        reachable = isAncestor(ctx, evidence.ref_sha, refSha);
      } catch (error) {
        if (!(error instanceof ToolError)) throw error;
      }
      if (!reachable) throw new ToolError(MARK_REFUSALS.evidenceRevision(evidenceId, refSha));

      const standing = readCurrentClaimMarks(ctx.db, [claimId]).get(claimId) ?? [];
      const same = standing.find(
        (mark: ClaimMarkRow) =>
          mark.kind === kind && mark.label === label && mark.target === target,
      );
      if (same) throw new ToolError(MARK_REFUSALS.duplicate(same.id));

      const result = ctx.db
        .prepare(
          `INSERT INTO claim_marks (claim_id, kind, label, target, evidence_id, ref_sha, session_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(claimId, kind, label, target, evidenceId, refSha, sessionId);
      return ok({
        id: Number(result.lastInsertRowid),
        claim_id: claimId,
        kind,
        label,
        target,
        evidence_id: evidenceId,
        ref_sha: refSha,
      });
    },
  },
  {
    name: "withdraw_claim_mark",
    description: `Withdraw a flow mark that was recorded by mistake, with the reason, without closing its claim: mark_id is the id record_claim_mark returned or get_claims lists. The reason is one paragraph of at most ${REASON_CAP} UTF-8 bytes. The withdrawal is a new row and the mark is kept; a withdrawn mark is no longer returned by get_claims, and the same mark can be recorded again. Returns a receipt.`,
    inputSchema: {
      type: "object",
      properties: { mark_id: { type: "integer" }, reason: { type: "string" } },
      required: ["mark_id", "reason"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "withdraw_claim_mark");
      const markId = args.mark_id;
      if (typeof markId !== "number" || !Number.isInteger(markId)) {
        throw new ToolError("expected integer for mark_id");
      }
      if (!ctx.db.prepare("SELECT 1 FROM claim_marks WHERE id = ?").get(markId)) {
        throw new ToolError(WITHDRAW_REFUSALS.noMark(markId));
      }
      if (ctx.db.prepare("SELECT 1 FROM claim_mark_withdrawals WHERE mark_id = ?").get(markId)) {
        throw new ToolError(WITHDRAW_REFUSALS.already(markId));
      }
      const reason = requireReason(args, WITHDRAW_REFUSALS.reason);
      const result = ctx.db
        .prepare(
          "INSERT INTO claim_mark_withdrawals (mark_id, reason, session_id) VALUES (?, ?, ?)",
        )
        .run(markId, reason, sessionId);
      return ok({ id: Number(result.lastInsertRowid), mark_id: markId });
    },
  },
  {
    name: "decline_claim_marks",
    description: `Declare that a flow has no marks to record, with the reason (for example that it writes nothing, so it has no commit point): the other way to answer the obligation record_claim_mark carries. flow is <sid>/flow/<slug>, without the step number, and has to have a current step claim. The reason is one paragraph of at most ${REASON_CAP} UTF-8 bytes. The record is append-only: the newest declination is the one get_claims returns on the flow's steps. Returns a receipt.`,
    inputSchema: {
      type: "object",
      properties: {
        flow: { type: "string" },
        reason: { type: "string" },
        ref_sha: { type: "string" },
      },
      required: ["flow", "reason", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "decline_claim_marks");
      const flow = requireString(args, "flow").trim();
      if (!/^[^/\s]+\/flow\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(flow)) {
        throw new ToolError(DECLINE_REFUSALS.flow(flow));
      }
      if (currentSteps(ctx, flow).length === 0) throw new ToolError(DECLINE_REFUSALS.noSteps(flow));
      const reason = requireReason(args, DECLINE_REFUSALS.reason);
      const refSha = resolveRevision(ctx, args, DECLINE_REFUSALS.revision);
      const result = ctx.db
        .prepare(
          "INSERT INTO claim_mark_declinations (flow_key, reason, ref_sha, session_id) VALUES (?, ?, ?, ?)",
        )
        .run(flow, reason, refSha, sessionId);
      return ok({ id: Number(result.lastInsertRowid), flow, ref_sha: refSha });
    },
  },
];
