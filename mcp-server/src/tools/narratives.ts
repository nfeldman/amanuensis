import {
  ok,
  optBool,
  optEnum,
  optString,
  requireEnum,
  requireString,
  resolveWorkspaceCommit,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import {
  isNarrativeEligible,
  type NarrativeSectionRule,
  narrativeSectionRule,
  readNarratives,
  readSubsystemStatus,
  requireActiveSession,
} from "../invariants.js";
import { orientationViolations } from "../orientation-lint.js";
import { EXPLANATION_SUBJECTS, NARRATIVE_SECTIONS } from "../vocabulary.js";
import {
  byteLength,
  EVIDENCE_CAP,
  isOneParagraph,
  isProseAndLists,
  LINE_BREAK,
  REASON_CAP,
} from "./explanations.js";

/** Cap in UTF-8 bytes (design/store-only/PLAN.md §2.1); the contract of the wire budget is the reader-lenses'. */
const BODY_CAP = 8192;
/** The table's own CHECK is on characters. */
const TOPIC_CAP = 120;
/** The read echoes the subject id and `upsert_subsystem` takes one of any size, so the envelope is bounded only if the read refuses a longer one. */
const READ_SUBJECT_ID_CAP = 256;

/**
 * The refusal sentences, one table per tool. Each begins with its own tool's
 * name so `check-refusal-parity.mjs` reads it as that tool's refusal, and each
 * names the repair rather than only the fault.
 */
const RECORD_REFUSALS = {
  noSubsystem: (id: string) =>
    `record_narrative refuses: no subsystem ${id}. Record a narrative for a subsystem that exists; list_subsystems names them.`,
  belowRung: (id: string, status: string, section: string, rung: string) =>
    `record_narrative refuses: ${id} is '${status}', and a ${section} narrative is written once a subsystem has reached '${rung}'. Advance it first.`,
  wrongSubject: (section: string, owner: string) =>
    `record_narrative refuses: ${section} is a ${owner} section. Record it with subject_type '${owner}'.`,
  citesEvidence: (section: string) =>
    `record_narrative refuses: a ${section} narrative cites the evidence it was written from. Pass evidence_ids naming evidence rows that exist; add_evidence records one.`,
  tooManyEvidence: () =>
    `record_narrative refuses: a narrative cites at most ${EVIDENCE_CAP} evidence rows. Cite the rows the text rests on; the rest can be reached from those.`,
  notInLedger: (id: string) =>
    `record_narrative refuses: none of the cited evidence is in ${id}'s ledger. Cite at least one file the subsystem's ledger holds; files outside it may accompany it.`,
  tooLong: () =>
    `record_narrative refuses: a narrative is limited to ${BODY_CAP} bytes. Split it into topics; the cap counts UTF-8 bytes.`,
  shape: () =>
    "record_narrative refuses: a narrative is prose and lists, with no line starting with '#' or '|'. The page owns its headings and tables; name a part of the section with topic instead.",
  topic: () =>
    `record_narrative refuses: a topic is a short title on one line of at most ${TOPIC_CAP} characters, with no line starting with '#' or '|'.`,
  revision: (ref: string) =>
    `record_narrative refuses: ref_sha ${ref} does not resolve to a commit in the bound workspace. Record the revision the reading was taken at.`,
  orientation: (violations: string[]) =>
    `record_narrative refuses: the narrative carries survey-status language or a count fraction, which the pages withhold: ${violations.join("; ")}. Say what the code does instead; the same lint runs again when the pages are rendered.`,
} as const;

const DECLINE_REFUSALS = {
  noSubsystem: (id: string) =>
    `decline_narrative refuses: no subsystem ${id}. Decline for a subsystem that exists; list_subsystems names them.`,
  belowRung: (id: string, status: string, section: string, rung: string) =>
    `decline_narrative refuses: ${id} is '${status}', and a ${section} narrative is answered once a subsystem has reached '${rung}'. Advance it first.`,
  wrongSubject: (section: string, owner: string) =>
    `decline_narrative refuses: ${section} is a ${owner} section. Decline it with subject_type '${owner}'.`,
  reasonTooLong: () =>
    `decline_narrative refuses: a reason is limited to ${REASON_CAP} bytes. Say the reason in fewer; the cap counts UTF-8 bytes.`,
  reasonOneParagraph: () =>
    "decline_narrative refuses: a reason is one paragraph, with no blank line and no line starting with '#', '-', '*' or '|'.",
  topic: () =>
    `decline_narrative refuses: a topic is a short title on one line of at most ${TOPIC_CAP} characters, with no line starting with '#' or '|'.`,
  revision: (ref: string) =>
    `decline_narrative refuses: ref_sha ${ref} does not resolve to a commit in the bound workspace. Record the revision the reading was taken at.`,
  orientation: (violations: string[]) =>
    `decline_narrative refuses: the reason carries survey-status language or a count fraction, which the pages withhold: ${violations.join("; ")}. Say why no narrative is written without them; the same lint runs again when the pages are rendered.`,
} as const;

type Tool = "record_narrative" | "decline_narrative";

interface Subject {
  type: "subsystem" | "project";
  id: string;
  section: string;
  rule: NarrativeSectionRule;
  topic: string;
}

/** A topic is one short line; it prints as a subheading, so it cannot carry a heading or table marker. */
function topicOf(args: Record<string, unknown>, refusal: string): string {
  const topic = (optString(args, "topic") ?? "").trim();
  if ([...topic].length > TOPIC_CAP || LINE_BREAK.test(topic) || !isProseAndLists(topic)) {
    throw new ToolError(refusal);
  }
  return topic;
}

/**
 * Whose section it is, whether the subject exists, and whether a subsystem
 * stands at the section's rung. A project section has no status condition.
 */
function resolveSubject(ctx: ServerContext, tool: Tool, args: Record<string, unknown>): Subject {
  const refusals = tool === "record_narrative" ? RECORD_REFUSALS : DECLINE_REFUSALS;
  const type = requireEnum(args, "subject_type", EXPLANATION_SUBJECTS);
  const section = requireEnum(args, "section", NARRATIVE_SECTIONS);
  const rule = narrativeSectionRule(section);
  if (rule === null)
    throw new ToolError(`section must be one of: ${NARRATIVE_SECTIONS.join(", ")}`);
  if (rule.subjectType !== type)
    throw new ToolError(refusals.wrongSubject(section, rule.subjectType));
  const topic = topicOf(args, refusals.topic());
  const suppliedId = optString(args, "subject_id");
  if (type === "project") {
    if (suppliedId !== null && suppliedId !== "project") {
      throw new ToolError("subject_id must be 'project' for a project narrative, or omitted");
    }
    return { type, id: "project", section, rule, topic };
  }
  if (suppliedId === null || suppliedId === "") {
    throw new ToolError("subject_id is required for a subsystem narrative");
  }
  const status = readSubsystemStatus(ctx.db, suppliedId);
  if (status === null) throw new ToolError(refusals.noSubsystem(suppliedId));
  if (!isNarrativeEligible(section, status)) {
    throw new ToolError(
      refusals.belowRung(suppliedId, status, section, rule.minStatus ?? "scoping"),
    );
  }
  return { type, id: suppliedId, section, rule, topic };
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
    section: subject.section,
    topic: subject.topic,
    disposition,
    ref_sha: refSha,
  });
}

const SUBJECT_PROPERTIES = {
  subject_type: { type: "string", enum: [...EXPLANATION_SUBJECTS] },
  subject_id: { type: "string" },
  section: { type: "string", enum: [...NARRATIVE_SECTIONS] },
  topic: { type: "string" },
} as const;

/** The revision, resolved in the bound workspace; a failure to resolve is this tool's refusal, in its own words. */
function resolveRevision(ctx: ServerContext, tool: Tool, args: Record<string, unknown>): string {
  const ref = requireString(args, "ref_sha");
  try {
    return resolveWorkspaceCommit(ctx, ref);
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    const refusals = tool === "record_narrative" ? RECORD_REFUSALS : DECLINE_REFUSALS;
    throw new ToolError(refusals.revision(ref));
  }
}

/** The evidence ids a narrative cites, checked as the rule for its section says. */
function citedEvidence(
  ctx: ServerContext,
  subject: Subject,
  args: Record<string, unknown>,
): number[] {
  const supplied = args.evidence_ids ?? [];
  if (!Array.isArray(supplied) || !supplied.every((v) => Number.isInteger(v))) {
    throw new ToolError("expected integer[] for evidence_ids");
  }
  const ids = [...new Set(supplied as number[])];
  const required = subject.rule.evidenceRequired;
  if (ids.length === 0) {
    if (required) throw new ToolError(RECORD_REFUSALS.citesEvidence(subject.section));
    return ids;
  }
  if (ids.length > EVIDENCE_CAP) throw new ToolError(RECORD_REFUSALS.tooManyEvidence());
  const cited = ctx.db
    .prepare(`SELECT id, file_path FROM evidence WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .all(...ids) as Array<{ id: number; file_path: string }>;
  if (cited.length !== ids.length)
    throw new ToolError(RECORD_REFUSALS.citesEvidence(subject.section));
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
  return ids;
}

export const narrativeTools: ToolDefinition[] = [
  {
    name: "record_narrative",
    description:
      "Record a narrative: the survey's prose about a subsystem (structure, concern-reasoning or challenge) or about the project (repository-shape, runtime, stateful-entities, concern-calibration, start-here or survey-plan), written from the evidence cited and bound to a revision. A subsystem section is written once the subsystem has reached its rung ('scoping' for structure, 'concerns' for concern-reasoning, 'adversarial' for challenge); a project section has none. The body is prose and lists of at most 8192 UTF-8 bytes with no heading or table line; use topic (a short title of at most 120 characters, empty for the section's single body) to name one part of a section. It is refused for text the pages' orientation lint would withhold (survey-status language, or a count fraction such as 12/35), for evidence that is missing or does not exist, and, for a subsystem, for evidence that names no file in its ledger; survey-plan needs no evidence and at most 64 rows may be cited. The record is append-only: the newest row per subject, section and topic is the effective one, and a correction is a new row. Returns a receipt and does not echo the body.",
    inputSchema: {
      type: "object",
      properties: {
        ...SUBJECT_PROPERTIES,
        body: { type: "string" },
        evidence_ids: { type: "array", items: { type: "integer" } },
        ref_sha: { type: "string" },
      },
      required: ["subject_type", "section", "body", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "record_narrative");
      const subject = resolveSubject(ctx, "record_narrative", args);
      const body = requireString(args, "body");
      if (body.trim() === "") throw new ToolError("missing required string: body");
      if (byteLength(body) > BODY_CAP) throw new ToolError(RECORD_REFUSALS.tooLong());
      if (!isProseAndLists(body)) throw new ToolError(RECORD_REFUSALS.shape());
      const violations = [
        ...(orientationViolations(body) ?? []),
        ...(subject.topic === "" ? [] : (orientationViolations(subject.topic) ?? [])),
      ];
      if (violations.length > 0) throw new ToolError(RECORD_REFUSALS.orientation(violations));
      const ids = citedEvidence(ctx, subject, args);

      const refSha = resolveRevision(ctx, "record_narrative", args);
      const write = ctx.db.transaction(() => {
        const result = ctx.db
          .prepare(
            `INSERT INTO narratives (subject_type, subject_id, section, topic, disposition, body, ref_sha, session_id)
             VALUES (?, ?, ?, ?, 'recorded', ?, ?, ?)`,
          )
          .run(subject.type, subject.id, subject.section, subject.topic, body, refSha, sessionId);
        const link = ctx.db.prepare(
          "INSERT INTO narrative_evidence (narrative_id, evidence_id) VALUES (?, ?)",
        );
        for (const id of ids) link.run(result.lastInsertRowid, id);
        return result.lastInsertRowid;
      });
      return receipt(write(), subject, "recorded", refSha);
    },
  },
  {
    name: "decline_narrative",
    description:
      "Declare that no narrative is written for a subsystem or project section, with the reason: the other way to answer the obligation record_narrative carries. The reason is one paragraph of at most 400 UTF-8 bytes, refused if the pages' orientation lint would withhold it, and declining is a real answer that has to be said out loud rather than left as silence. It applies the same subject, section and rung conditions as record_narrative. It is accepted whether or not a narrative is already recorded: the newest row per subject, section and topic is the effective one. The record is append-only. Returns a receipt and does not echo the reason.",
    inputSchema: {
      type: "object",
      properties: {
        ...SUBJECT_PROPERTIES,
        reason: { type: "string" },
        ref_sha: { type: "string" },
      },
      required: ["subject_type", "section", "reason", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "decline_narrative");
      const subject = resolveSubject(ctx, "decline_narrative", args);
      const reason = requireString(args, "reason");
      if (reason.trim() === "") throw new ToolError("missing required string: reason");
      if (byteLength(reason) > REASON_CAP) throw new ToolError(DECLINE_REFUSALS.reasonTooLong());
      if (!isOneParagraph(reason)) throw new ToolError(DECLINE_REFUSALS.reasonOneParagraph());
      const violations = orientationViolations(reason);
      if (violations?.length) throw new ToolError(DECLINE_REFUSALS.orientation(violations));

      const refSha = resolveRevision(ctx, "decline_narrative", args);
      const result = ctx.db
        .prepare(
          `INSERT INTO narratives (subject_type, subject_id, section, topic, disposition, body, ref_sha, session_id)
           VALUES (?, ?, ?, ?, 'declined', ?, ?, ?)`,
        )
        .run(subject.type, subject.id, subject.section, subject.topic, reason, refSha, sessionId);
      return receipt(result.lastInsertRowid, subject, "declined", refSha);
    },
  },
  {
    name: "get_narratives",
    description:
      "Read the narratives recorded for a subsystem or for the project, optionally for one section. Returns the effective row for each section and topic (id, section, topic, disposition recorded or declined, body, ref_sha, session_id, recorded_at, evidence_ids), ordered by section as the contract lists them, and how many section-and-topic keys were withdrawn by a reset and are owed again. With history it also lists the rows that are not effective, newest first, without their bodies. Every body is authored by a model and is served whole; model_calls is 0. It needs no session and writes nothing.",
    inputSchema: {
      type: "object",
      properties: {
        subject_type: SUBJECT_PROPERTIES.subject_type,
        subject_id: SUBJECT_PROPERTIES.subject_id,
        section: SUBJECT_PROPERTIES.section,
        history: { type: "boolean" },
      },
      required: ["subject_type"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const type = requireEnum(args, "subject_type", EXPLANATION_SUBJECTS);
      const suppliedId = optString(args, "subject_id");
      let id = "project";
      if (type === "project") {
        if (suppliedId !== null && suppliedId !== "project") {
          throw new ToolError("subject_id must be 'project' for a project narrative, or omitted");
        }
      } else {
        if (suppliedId === null || suppliedId === "") {
          throw new ToolError("subject_id is required for a subsystem narrative");
        }
        if (byteLength(suppliedId) > READ_SUBJECT_ID_CAP) {
          throw new ToolError(
            `get_narratives serves a subject_id of at most ${READ_SUBJECT_ID_CAP} bytes, which keeps its response bounded; list_subsystems names the ids`,
          );
        }
        if (readSubsystemStatus(ctx.db, suppliedId) === null) {
          throw new ToolError(`unknown subsystem: ${suppliedId}; list_subsystems names them`);
        }
        id = suppliedId;
      }
      const section = optEnum(args, "section", NARRATIVE_SECTIONS) ?? undefined;
      const reading = readNarratives(ctx.db, type, id, section);
      const evidenceOf = ctx.db.prepare(
        "SELECT evidence_id FROM narrative_evidence WHERE narrative_id = ? ORDER BY evidence_id",
      );
      const narratives = reading.rows.map((row) => ({
        id: row.id,
        section: row.section,
        topic: row.topic,
        disposition: row.disposition,
        authored: "model" as const,
        body: row.body,
        ref_sha: row.ref_sha,
        session_id: row.session_id,
        recorded_at: row.recorded_at,
        evidence_ids: (evidenceOf.all(row.id) as Array<{ evidence_id: number }>).map(
          (link) => link.evidence_id,
        ),
      }));
      const wantsHistory = optBool(args, "history");
      return ok({
        subject_type: type,
        subject_id: id,
        narratives,
        withdrawn: reading.withdrawn,
        ...(wantsHistory
          ? {
              history: reading.earlier.map((row) => ({
                id: row.id,
                section: row.section,
                topic: row.topic,
                disposition: row.disposition,
                ref_sha: row.ref_sha,
                session_id: row.session_id,
                recorded_at: row.recorded_at,
              })),
            }
          : {}),
        model_calls: 0,
      });
    },
  },
];
