import {
  ok,
  optString,
  requireEnum,
  requireInt,
  requireString,
  type ToolDefinition,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const CATEGORIES = [
  "domain-knowledge",
  "scope-judgment",
  "priority-ranking",
  "contradiction",
  "tooling-limit",
  "ambiguous-evidence",
  "other",
] as const;

const RESOLUTIONS = ["open", "answered", "dismissed", "superseded"] as const;

export const openQuestionTools: ToolDefinition[] = [
  {
    name: "record_open_question",
    description:
      "Record something the agent could not answer without human input. " +
      "In autoprogress mode (cloud runs), use this instead of pausing for " +
      "human review: log the question, log the assumption you proceeded " +
      "with, and continue. A human reviewer later works through the " +
      "queue via get_open_questions and closes each one via " +
      "resolve_open_question. Always populate what_assumed when the " +
      "agent proceeded on an assumption — the reviewer needs to know " +
      "what to check.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: [...CATEGORIES] },
        question: { type: "string" },
        subsystem_id: { type: "string" },
        phase: { type: "string" },
        what_blocked: { type: "string" },
        what_assumed: { type: "string" },
        ref_sha: { type: "string" },
      },
      required: ["category", "question"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "record_open_question");
      const category = requireEnum(args, "category", CATEGORIES);
      const question = requireString(args, "question");
      const subsystemId = optString(args, "subsystem_id");
      const phase = optString(args, "phase");
      const whatBlocked = optString(args, "what_blocked");
      const whatAssumed = optString(args, "what_assumed");
      const refSha = optString(args, "ref_sha");
      const info = ctx.db
        .prepare(
          `INSERT INTO open_questions
            (category, subsystem_id, phase, question, what_blocked, what_assumed,
             session_id, ref_sha)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          category,
          subsystemId,
          phase,
          question,
          whatBlocked,
          whatAssumed,
          ctx.sessionId,
          refSha,
        );
      return ok({ id: info.lastInsertRowid });
    },
  },
  {
    name: "get_open_questions",
    description:
      "Return open questions. resolution_filter defaults to 'open' so the " +
      "human reviewer sees only outstanding items; pass 'all' to see " +
      "everything including resolved/dismissed history.",
    inputSchema: {
      type: "object",
      properties: {
        resolution_filter: { type: "string" },
        subsystem_id: { type: "string" },
        category: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const resFilter = optString(args, "resolution_filter") ?? "open";
      const subsystemId = optString(args, "subsystem_id");
      const category = optString(args, "category");
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (resFilter !== "all") {
        clauses.push("resolution = ?");
        params.push(resFilter);
      }
      if (subsystemId) {
        clauses.push("subsystem_id = ?");
        params.push(subsystemId);
      }
      if (category) {
        clauses.push("category = ?");
        params.push(category);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return ctx.db
        .prepare(
          `SELECT id, category, subsystem_id, phase, question, what_blocked,
                  what_assumed, session_id, ref_sha, resolution, answer,
                  created_at, resolved_at
             FROM open_questions ${where}
             ORDER BY created_at DESC`,
        )
        .all(...params);
    },
  },
  {
    name: "resolve_open_question",
    description:
      "Close out an open question. 'answered' requires `answer`; " +
      "'dismissed' is for questions no longer relevant (e.g. scope " +
      "narrowed); 'superseded' is for questions folded into a later " +
      "question that gives the same information.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        resolution: { type: "string", enum: [...RESOLUTIONS] },
        answer: { type: "string" },
      },
      required: ["id", "resolution"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "resolve_open_question");
      const id = requireInt(args, "id");
      const resolution = requireEnum(args, "resolution", RESOLUTIONS);
      const answer = optString(args, "answer");
      if (resolution === "answered" && !answer) {
        return { ok: false, error: "`answered` resolution requires an `answer`" };
      }
      const res = ctx.db
        .prepare(
          `UPDATE open_questions
             SET resolution = ?, answer = ?, resolved_at = datetime('now')
             WHERE id = ?`,
        )
        .run(resolution, answer, id);
      if (res.changes === 0) {
        return { ok: false, error: `unknown open_question: ${id}` };
      }
      return ok();
    },
  },
  {
    name: "get_autoprogress_mode",
    description:
      "Return whether the server is running in autoprogress mode. The " +
      "coordinator should call this at the top of every phase gate: if " +
      "autoprogress is on, do NOT pause for human review — record any " +
      "blocking question via record_open_question and proceed. The mode " +
      "is set via the AMANUENSIS_AUTOPROGRESS environment variable when " +
      "the server is launched.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, _ctx) => {
      const raw = process.env.AMANUENSIS_AUTOPROGRESS?.trim().toLowerCase() ?? "";
      const autoprogress = raw === "1" || raw === "true" || raw === "yes" || raw === "on";
      return {
        autoprogress,
        // Echo the raw value so an agent that got an unexpected answer
        // can diagnose whether the env var was set correctly.
        env_raw: process.env.AMANUENSIS_AUTOPROGRESS ?? null,
      };
    },
  },
];
