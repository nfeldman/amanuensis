import {
  ok,
  optString,
  requireEnum,
  requireString,
  resolveWorkspaceCommit,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import {
  EXPLANATION_ELIGIBLE_STATUSES,
  isExplanationEligible,
  readSubsystemStatus,
  requireActiveSession,
} from "../invariants.js";
import { EXPLANATION_SLOTS, EXPLANATION_SUBJECTS } from "../vocabulary.js";

/** Caps in UTF-8 bytes (design/explanation/spec.md §3.3). 4096 is the optional-section budget of the reader-lenses wire. */
const BODY_CAPS = { purpose: 400, account: 4096 } as const;
const REASON_CAP = 400;

/** Evidence kinds that rest on a name or a pattern and so cannot carry an explanation alone. */
const NAME_AND_PATTERN_KINDS: readonly string[] = ["name-inferred", "pattern-matched"];

/**
 * The refusal sentences, one table per tool. Each begins with its own tool's
 * name so `check-refusal-parity.mjs` reads it as that tool's refusal, and each
 * names the repair rather than only the fault.
 */
const RECORD_REFUSALS = {
  noSubsystem: (id: string) =>
    `record_explanation refuses: no subsystem ${id}. Record an explanation for a subsystem that exists; list_subsystems names them.`,
  notRead: (id: string, status: string) =>
    `record_explanation refuses: ${id} is '${status}'. An explanation is written by a pass that has read the subsystem; advance it to 'structural' first.`,
  noStructural: () =>
    "record_explanation refuses: no subsystem has been read to 'structural'. The project account is recorded once the first subsystem reaches that status.",
  projectPurpose: () =>
    "record_explanation refuses: the project's purpose is the thesis in entry-point.md. Record the project's account, or write the thesis under '## What is this codebase?'.",
  citesEvidence: () =>
    "record_explanation refuses: an explanation cites the evidence it was written from. Pass evidence_ids naming evidence rows that exist; add_evidence records one.",
  namesAndPatterns: () =>
    "record_explanation refuses: an explanation resting only on names and patterns. Cite at least one row whose kind is not name-inferred or pattern-matched.",
  notInLedger: (id: string) =>
    `record_explanation refuses: none of the cited evidence is in ${id}'s ledger. Cite at least one file the subsystem's ledger holds; files outside it may accompany it.`,
  tooLong: (slot: string, cap: number) =>
    `record_explanation refuses: ${slot} is limited to ${cap} bytes. Say less; the cap counts UTF-8 bytes.`,
  onePurposeParagraph: () =>
    "record_explanation refuses: a purpose is one paragraph, with no blank line and no line starting with '#', '-', '*' or '|'.",
  accountShape: () =>
    "record_explanation refuses: an account is prose and lists, with no line starting with '#' or '|'. A heading or a table would sit above the page's own structure.",
} as const;

const DECLINE_REFUSALS = {
  noSubsystem: (id: string) =>
    `decline_explanation refuses: no subsystem ${id}. Decline for a subsystem that exists; list_subsystems names them.`,
  notRead: (id: string, status: string) =>
    `decline_explanation refuses: ${id} is '${status}'. An explanation is written by a pass that has read the subsystem; advance it to 'structural' first.`,
  noStructural: () =>
    "decline_explanation refuses: no subsystem has been read to 'structural'. The project account is answered once the first subsystem reaches that status.",
  projectPurpose: () =>
    "decline_explanation refuses: the project's purpose is the thesis in entry-point.md. Only the project's account is recorded or declined here.",
  reasonTooLong: () =>
    `decline_explanation refuses: a reason is limited to ${REASON_CAP} bytes. Say the reason in fewer; the cap counts UTF-8 bytes.`,
  reasonOneParagraph: () =>
    "decline_explanation refuses: a reason is one paragraph, with no blank line and no line starting with '#', '-', '*' or '|'.",
} as const;

type Tool = "record_explanation" | "decline_explanation";

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

/** A paragraph carries no blank line and no heading, list or table line. */
function isOneParagraph(text: string): boolean {
  return text.split("\n").every((line) => {
    const trimmed = line.trimStart();
    return trimmed !== "" && !/^[#\-*|]/.test(trimmed);
  });
}

/** An account is prose and lists: blank lines and list lines pass, headings and tables do not. */
function isProseAndLists(text: string): boolean {
  return text.split("\n").every((line) => !/^[#|]/.test(line.trimStart()));
}

interface Subject {
  type: string;
  id: string;
  slot: string;
}

/**
 * R1-R4 for both writers, each with its own tool's sentence. The project
 * subject has one slot and one id; the subsystem subject has to exist and has
 * to have been read.
 */
function resolveSubject(ctx: ServerContext, tool: Tool, args: Record<string, unknown>): Subject {
  const refusals = tool === "record_explanation" ? RECORD_REFUSALS : DECLINE_REFUSALS;
  const type = requireEnum(args, "subject_type", EXPLANATION_SUBJECTS);
  const slot = requireEnum(args, "slot", EXPLANATION_SLOTS);
  const suppliedId = optString(args, "subject_id");
  if (type === "project") {
    if (suppliedId !== null && suppliedId !== "project") {
      throw new ToolError("subject_id must be 'project' for a project explanation, or omitted");
    }
    if (slot === "purpose") throw new ToolError(refusals.projectPurpose());
    const read = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM subsystems
          WHERE status IN (${EXPLANATION_ELIGIBLE_STATUSES.map(() => "?").join(", ")})`,
      )
      .get(...EXPLANATION_ELIGIBLE_STATUSES) as { n: number };
    if (read.n === 0) throw new ToolError(refusals.noStructural());
    return { type, id: "project", slot };
  }
  if (suppliedId === null || suppliedId === "") {
    throw new ToolError("subject_id is required for a subsystem explanation");
  }
  const status = readSubsystemStatus(ctx.db, suppliedId);
  if (status === null) throw new ToolError(refusals.noSubsystem(suppliedId));
  if (!isExplanationEligible(status)) throw new ToolError(refusals.notRead(suppliedId, status));
  return { type, id: suppliedId, slot };
}

/** The session, and the revision resolved in the bound workspace, for either writer. */
function attribution(ctx: ServerContext, tool: Tool, args: Record<string, unknown>) {
  const sessionId = requireActiveSession(ctx, tool);
  return { sessionId, resolve: () => resolveWorkspaceCommit(ctx, requireString(args, "ref_sha")) };
}

function receipt(
  id: number | bigint,
  subject: Subject,
  disposition: "recorded" | "declined",
  refSha: string,
) {
  return ok({
    id: Number(id),
    subject_type: subject.type,
    subject_id: subject.id,
    slot: subject.slot,
    disposition,
    ref_sha: refSha,
  });
}

const SUBJECT_PROPERTIES = {
  subject_type: { type: "string", enum: [...EXPLANATION_SUBJECTS] },
  subject_id: { type: "string" },
  slot: { type: "string", enum: [...EXPLANATION_SLOTS] },
} as const;

export const explanationTools: ToolDefinition[] = [
  {
    name: "record_explanation",
    description:
      "Record an explanation of a subsystem (its purpose or its account) or of the project (its account), written from the evidence cited. A purpose is one paragraph of at most 400 UTF-8 bytes; an account is prose and lists of at most 4096 bytes. There is no minimum length and one evidence row is enough. Refused for a subsystem that has not been read to 'structural', for a project purpose (the thesis in entry-point.md is the project's purpose), for evidence that is missing, rests only on names and patterns, or has no file in the subsystem's ledger. The record is append-only: a correction is a new row, which may share the earlier row's commit. Returns a receipt and does not echo the body.",
    inputSchema: {
      type: "object",
      properties: {
        ...SUBJECT_PROPERTIES,
        body: { type: "string" },
        evidence_ids: { type: "array", items: { type: "integer" } },
        ref_sha: { type: "string" },
      },
      required: ["subject_type", "slot", "body", "evidence_ids", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const { sessionId, resolve } = attribution(ctx, "record_explanation", args);
      const subject = resolveSubject(ctx, "record_explanation", args);
      const body = requireString(args, "body");
      if (body.trim() === "") throw new ToolError("missing required string: body");
      const cap = BODY_CAPS[subject.slot as keyof typeof BODY_CAPS];
      if (byteLength(body) > cap) throw new ToolError(RECORD_REFUSALS.tooLong(subject.slot, cap));
      if (subject.slot === "purpose" && !isOneParagraph(body)) {
        throw new ToolError(RECORD_REFUSALS.onePurposeParagraph());
      }
      if (subject.slot === "account" && !isProseAndLists(body)) {
        throw new ToolError(RECORD_REFUSALS.accountShape());
      }

      const supplied = args.evidence_ids;
      if (!Array.isArray(supplied) || !supplied.every((v) => Number.isInteger(v))) {
        throw new ToolError("expected integer[] for evidence_ids");
      }
      const ids = [...new Set(supplied as number[])];
      if (ids.length === 0) throw new ToolError(RECORD_REFUSALS.citesEvidence());
      const cited = ctx.db
        .prepare(
          `SELECT id, file_path, kind FROM evidence WHERE id IN (${ids.map(() => "?").join(", ")})`,
        )
        .all(...ids) as Array<{ id: number; file_path: string; kind: string }>;
      if (cited.length !== ids.length) throw new ToolError(RECORD_REFUSALS.citesEvidence());
      if (cited.every((row) => NAME_AND_PATTERN_KINDS.includes(row.kind))) {
        throw new ToolError(RECORD_REFUSALS.namesAndPatterns());
      }
      if (subject.type === "subsystem") {
        const files = [...new Set(cited.map((row) => row.file_path))];
        const inLedger = ctx.db
          .prepare(
            `SELECT COUNT(*) AS n FROM file_ledger
              WHERE subsystem_id = ? AND file_path IN (${files.map(() => "?").join(", ")})`,
          )
          .get(subject.id, ...files) as { n: number };
        if (inLedger.n === 0) throw new ToolError(RECORD_REFUSALS.notInLedger(subject.id));
      }

      const refSha = resolve();
      const write = ctx.db.transaction(() => {
        const result = ctx.db
          .prepare(
            `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
             VALUES (?, ?, ?, 'recorded', ?, ?, ?)`,
          )
          .run(subject.type, subject.id, subject.slot, body, refSha, sessionId);
        const link = ctx.db.prepare(
          "INSERT INTO explanation_evidence (explanation_id, evidence_id) VALUES (?, ?)",
        );
        for (const id of ids) link.run(result.lastInsertRowid, id);
        return result.lastInsertRowid;
      });
      return receipt(write(), subject, "recorded", refSha);
    },
  },
  {
    name: "decline_explanation",
    description:
      "Declare that no explanation is written for a subsystem or project slot, with the reason: the other way to answer the obligation record_explanation carries. The reason is one paragraph of at most 400 UTF-8 bytes, and declining is a real answer that has to be said out loud rather than left as silence. It applies the same subject conditions as record_explanation. It is accepted whether or not an explanation is already recorded: the newest row is the effective one. The record is append-only. Returns a receipt and does not echo the reason.",
    inputSchema: {
      type: "object",
      properties: {
        ...SUBJECT_PROPERTIES,
        reason: { type: "string" },
        ref_sha: { type: "string" },
      },
      required: ["subject_type", "slot", "reason", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const { sessionId, resolve } = attribution(ctx, "decline_explanation", args);
      const subject = resolveSubject(ctx, "decline_explanation", args);
      const reason = requireString(args, "reason");
      if (reason.trim() === "") throw new ToolError("missing required string: reason");
      if (byteLength(reason) > REASON_CAP) throw new ToolError(DECLINE_REFUSALS.reasonTooLong());
      if (!isOneParagraph(reason)) throw new ToolError(DECLINE_REFUSALS.reasonOneParagraph());

      const refSha = resolve();
      const result = ctx.db
        .prepare(
          `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
           VALUES (?, ?, ?, 'declined', ?, ?, ?)`,
        )
        .run(subject.type, subject.id, subject.slot, reason, refSha, sessionId);
      return receipt(result.lastInsertRowid, subject, "declined", refSha);
    },
  },
];
