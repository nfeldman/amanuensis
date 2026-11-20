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
import { readRuntimeBoundaries, requireActiveSession } from "../invariants.js";
import { TERRITORY_DISPOSITIONS } from "../vocabulary.js";
import { TERRITORY_ID } from "./concerns.js";
import {
  byteLength,
  EVIDENCE_CAP,
  isOneParagraph,
  LINE_BREAK,
  REASON_CAP,
} from "./explanations.js";

/** The project's name and each cell of the runtime boundary table are short, one-line labels. */
const LABEL_CAP = 120;
/** A boundary's notes sit in one table cell. */
const NOTES_CAP = 400;

/**
 * The refusal sentences, one table per tool. Each begins with its own tool's
 * name so `check-refusal-parity.mjs` reads it as that tool's refusal, and each
 * names the repair rather than only the fault.
 */
const PROFILE_REFUSALS = {
  name: () =>
    `record_project_profile refuses: a name is one line of at most ${LABEL_CAP} characters. Say what the project is called, as its repository or manifest does.`,
  revision: (ref: string) =>
    `record_project_profile refuses: ref_sha ${ref} does not resolve to a commit in the bound workspace. Record the revision the name was read at.`,
} as const;

const BOUNDARY_REFUSALS = {
  field: (field: string) =>
    `record_runtime_boundary refuses: ${field} is one line of at most ${LABEL_CAP} characters with no '|'. Shorten it; the map is a table with one row per crossing.`,
  notes: () =>
    `record_runtime_boundary refuses: notes is one line of at most ${NOTES_CAP} bytes with no '|'. Say less; the cap counts UTF-8 bytes.`,
  citesEvidence: () =>
    "record_runtime_boundary refuses: a crossing cites the evidence it was read from. Pass evidence_ids naming evidence rows that exist; add_evidence records one.",
  tooManyEvidence: () =>
    `record_runtime_boundary refuses: a crossing cites at most ${EVIDENCE_CAP} evidence rows. Cite the rows the crossing rests on.`,
  revision: (ref: string) =>
    `record_runtime_boundary refuses: ref_sha ${ref} does not resolve to a commit in the bound workspace. Record the revision the crossing was read at.`,
} as const;

const WITHDRAW_REFUSALS = {
  noEdge: (from: string, to: string, mechanism: string) =>
    `withdraw_runtime_boundary refuses: no crossing from ${from} to ${to} by ${mechanism} is on the map. Name an edge get_runtime_boundaries lists.`,
  reason: () =>
    `withdraw_runtime_boundary refuses: a reason is one line of at most ${NOTES_CAP} bytes with no '|'. Say why the crossing is gone in fewer.`,
  revision: (ref: string) =>
    `withdraw_runtime_boundary refuses: ref_sha ${ref} does not resolve to a commit in the bound workspace. Record the revision the crossing was found gone at.`,
} as const;

const TERRITORY_REFUSALS = {
  territory: () =>
    "record_territory_disposition refuses: territory is the id of a territory in concern-territories.md, such as T7. Name it by id, not in words.",
  needsCondition: () =>
    "record_territory_disposition refuses: a disqualified territory names the condition that rules it out. Pass condition, one paragraph.",
  condition: () =>
    `record_territory_disposition refuses: a condition is one paragraph of at most ${REASON_CAP} bytes, with no blank line and no line starting with '#', '-', '*' or '|'.`,
  noQuestion: (id: number) =>
    `record_territory_disposition refuses: no open question ${id}. Pass the id record_open_question returned, or omit it.`,
  revision: (ref: string) =>
    `record_territory_disposition refuses: ref_sha ${ref} does not resolve to a commit in the bound workspace. Record the revision the territory was judged at.`,
} as const;

/** One line of at most `cap` characters, trimmed, with no `|` when it sits in a table cell. */
function isOneLine(text: string, cap: number, cell: boolean): boolean {
  return (
    text !== "" &&
    [...text].length <= cap &&
    !LINE_BREAK.test(text) &&
    (!cell || !text.includes("|"))
  );
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

/** The text of an optional argument, trimmed, or null when absent or blank. */
function optTrimmed(args: Record<string, unknown>, key: string): string | null {
  const value = optString(args, key);
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** The evidence ids a crossing cites: at least one, all of them present. */
function boundaryEvidence(ctx: ServerContext, args: Record<string, unknown>): number[] {
  const supplied = args.evidence_ids;
  if (!Array.isArray(supplied) || !supplied.every((v) => Number.isInteger(v))) {
    throw new ToolError("expected integer[] for evidence_ids");
  }
  const ids = [...new Set(supplied as number[])];
  if (ids.length === 0) throw new ToolError(BOUNDARY_REFUSALS.citesEvidence());
  if (ids.length > EVIDENCE_CAP) throw new ToolError(BOUNDARY_REFUSALS.tooManyEvidence());
  const found = ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM evidence WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .get(...ids) as { n: number };
  if (found.n !== ids.length) throw new ToolError(BOUNDARY_REFUSALS.citesEvidence());
  return ids;
}

/** An edge's three identifying labels, each one line with no `|`. */
function edgeLabels(args: Record<string, unknown>) {
  const labels = { from_runtime: "", to_runtime: "", mechanism: "" };
  for (const key of Object.keys(labels) as Array<keyof typeof labels>) {
    const text = requireString(args, key).trim();
    if (!isOneLine(text, LABEL_CAP, true)) throw new ToolError(BOUNDARY_REFUSALS.field(key));
    labels[key] = text;
  }
  return labels;
}

const EDGE_PROPERTIES = {
  from_runtime: { type: "string" },
  to_runtime: { type: "string" },
  mechanism: { type: "string" },
} as const;

export const projectRecordTools: ToolDefinition[] = [
  {
    name: "record_project_profile",
    description:
      "Record the project's name, bound to a revision: the replacement for the codebase line of the onboarding report. The name is one line of at most 120 characters. The record is append-only: the newest row is the effective name, and a correction is a new row. Returns a receipt.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, ref_sha: { type: "string" } },
      required: ["name", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "record_project_profile");
      const name = requireString(args, "name").trim();
      if (!isOneLine(name, LABEL_CAP, false)) throw new ToolError(PROFILE_REFUSALS.name());
      const refSha = resolveRevision(ctx, args, PROFILE_REFUSALS.revision);
      const result = ctx.db
        .prepare("INSERT INTO project_profile (name, ref_sha, session_id) VALUES (?, ?, ?)")
        .run(name, refSha, sessionId);
      return ok({ id: Number(result.lastInsertRowid), name, ref_sha: refSha });
    },
  },
  {
    name: "record_runtime_boundary",
    description:
      "Record one crossing between runtimes on the runtime boundary map: from_runtime (with its from_language), to_runtime and the mechanism of the crossing, with notes and the evidence it was read from. Each of from_runtime, from_language, to_runtime and mechanism is one line of at most 120 characters with no '|'; notes is one line of at most 400 UTF-8 bytes. At least one evidence row is required and at most 64 may be cited. The record is append-only: the newest row per (from_runtime, to_runtime, mechanism) is the effective one, so a correction is a new row, and withdraw_runtime_boundary removes an edge. Returns a receipt.",
    inputSchema: {
      type: "object",
      properties: {
        ...EDGE_PROPERTIES,
        from_language: { type: "string" },
        notes: { type: "string" },
        evidence_ids: { type: "array", items: { type: "integer" } },
        ref_sha: { type: "string" },
      },
      required: ["from_runtime", "to_runtime", "mechanism", "evidence_ids", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "record_runtime_boundary");
      const edge = edgeLabels(args);
      const fromLanguage = optTrimmed(args, "from_language");
      if (fromLanguage !== null && !isOneLine(fromLanguage, LABEL_CAP, true)) {
        throw new ToolError(BOUNDARY_REFUSALS.field("from_language"));
      }
      const notes = optTrimmed(args, "notes");
      if (notes !== null && (byteLength(notes) > NOTES_CAP || !isOneLine(notes, NOTES_CAP, true))) {
        throw new ToolError(BOUNDARY_REFUSALS.notes());
      }
      const ids = boundaryEvidence(ctx, args);
      const refSha = resolveRevision(ctx, args, BOUNDARY_REFUSALS.revision);
      const write = ctx.db.transaction(() => {
        const result = ctx.db
          .prepare(
            `INSERT INTO runtime_boundaries
               (from_runtime, from_language, to_runtime, mechanism, notes, origin, withdrawn, ref_sha, session_id)
             VALUES (?, ?, ?, ?, ?, 'recorded', 0, ?, ?)`,
          )
          .run(
            edge.from_runtime,
            fromLanguage,
            edge.to_runtime,
            edge.mechanism,
            notes,
            refSha,
            sessionId,
          );
        const link = ctx.db.prepare(
          "INSERT INTO runtime_boundary_evidence (boundary_id, evidence_id) VALUES (?, ?)",
        );
        for (const id of ids) link.run(result.lastInsertRowid, id);
        return result.lastInsertRowid;
      });
      return ok({ id: Number(write()), ...edge, origin: "recorded", ref_sha: refSha });
    },
  },
  {
    name: "withdraw_runtime_boundary",
    description:
      "Withdraw a crossing from the runtime boundary map: the edge named by from_runtime, to_runtime and mechanism, which has to be on the map now, with an optional one-line reason of at most 400 UTF-8 bytes. The withdrawal is a new row and the earlier rows are kept; recording the edge again puts it back. Returns a receipt.",
    inputSchema: {
      type: "object",
      properties: { ...EDGE_PROPERTIES, reason: { type: "string" }, ref_sha: { type: "string" } },
      required: ["from_runtime", "to_runtime", "mechanism", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "withdraw_runtime_boundary");
      const from = requireString(args, "from_runtime").trim();
      const to = requireString(args, "to_runtime").trim();
      const mechanism = requireString(args, "mechanism").trim();
      const standing = readRuntimeBoundaries(ctx.db).rows.find(
        (row) => row.from_runtime === from && row.to_runtime === to && row.mechanism === mechanism,
      );
      if (!standing) throw new ToolError(WITHDRAW_REFUSALS.noEdge(from, to, mechanism));
      const reason = optTrimmed(args, "reason");
      if (
        reason !== null &&
        (byteLength(reason) > NOTES_CAP || !isOneLine(reason, NOTES_CAP, true))
      ) {
        throw new ToolError(WITHDRAW_REFUSALS.reason());
      }
      const refSha = resolveRevision(ctx, args, WITHDRAW_REFUSALS.revision);
      const result = ctx.db
        .prepare(
          `INSERT INTO runtime_boundaries
             (from_runtime, from_language, to_runtime, mechanism, notes, origin, withdrawn, ref_sha, session_id)
           VALUES (?, ?, ?, ?, ?, 'recorded', 1, ?, ?)`,
        )
        .run(from, standing.from_language, to, mechanism, reason, refSha, sessionId);
      return ok({ id: Number(result.lastInsertRowid), withdrawn: true, ref_sha: refSha });
    },
  },
  {
    name: "get_runtime_boundaries",
    description:
      "Read the runtime boundary map: the effective crossing for each (from_runtime, to_runtime, mechanism) as {id, from_runtime, from_language, to_runtime, mechanism, notes, origin (recorded or imported), ref_sha, session_id, recorded_at, evidence_ids}, ordered by edge, and how many edges were withdrawn. An imported crossing carries no evidence. Every row is authored by a model and is served whole; model_calls is 0. It needs no session and writes nothing.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, ctx) => {
      const reading = readRuntimeBoundaries(ctx.db);
      const evidenceOf = ctx.db.prepare(
        "SELECT evidence_id FROM runtime_boundary_evidence WHERE boundary_id = ? ORDER BY evidence_id",
      );
      return ok({
        boundaries: reading.rows.map((row) => ({
          id: row.id,
          from_runtime: row.from_runtime,
          from_language: row.from_language,
          to_runtime: row.to_runtime,
          mechanism: row.mechanism,
          notes: row.notes,
          origin: row.origin,
          ref_sha: row.ref_sha,
          session_id: row.session_id,
          recorded_at: row.recorded_at,
          evidence_ids: (evidenceOf.all(row.id) as Array<{ evidence_id: number }>).map(
            (link) => link.evidence_id,
          ),
        })),
        withdrawn: reading.withdrawn,
        authored: "model" as const,
        model_calls: 0,
      });
    },
  },
  {
    name: "record_territory_disposition",
    description:
      "Record whether a territory of concern-territories.md applies to the project, by its id (T1, T2, …): disposition 'applies' or 'disqualified'. A disqualified territory names the condition that rules it out, one paragraph of at most 400 UTF-8 bytes, and may point at the open question that records the doubt. The record is append-only: the newest row per territory is the effective one, and a correction is a new row. Returns a receipt.",
    inputSchema: {
      type: "object",
      properties: {
        territory: { type: "string", pattern: "^T[1-9][0-9]*$" },
        disposition: { type: "string", enum: [...TERRITORY_DISPOSITIONS] },
        condition: { type: "string" },
        open_question_id: { type: "integer" },
        ref_sha: { type: "string" },
      },
      required: ["territory", "disposition", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "record_territory_disposition");
      const territory = requireString(args, "territory").trim();
      if (!TERRITORY_ID.test(territory)) throw new ToolError(TERRITORY_REFUSALS.territory());
      const disposition = requireEnum(args, "disposition", TERRITORY_DISPOSITIONS);
      const condition = optTrimmed(args, "condition");
      if (disposition === "disqualified" && condition === null) {
        throw new ToolError(TERRITORY_REFUSALS.needsCondition());
      }
      if (
        condition !== null &&
        (byteLength(condition) > REASON_CAP || !isOneParagraph(condition))
      ) {
        throw new ToolError(TERRITORY_REFUSALS.condition());
      }
      const rawQuestion = args.open_question_id;
      let questionId: number | null = null;
      if (rawQuestion != null) {
        if (typeof rawQuestion !== "number" || !Number.isInteger(rawQuestion)) {
          throw new ToolError("expected integer for open_question_id");
        }
        questionId = rawQuestion;
        if (!ctx.db.prepare("SELECT 1 FROM open_questions WHERE id = ?").get(questionId)) {
          throw new ToolError(TERRITORY_REFUSALS.noQuestion(questionId));
        }
      }
      const refSha = resolveRevision(ctx, args, TERRITORY_REFUSALS.revision);
      const result = ctx.db
        .prepare(
          `INSERT INTO territory_dispositions (territory, disposition, condition, open_question_id, ref_sha, session_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(territory, disposition, condition, questionId, refSha, sessionId);
      return ok({ id: Number(result.lastInsertRowid), territory, disposition, ref_sha: refSha });
    },
  },
];
