import { ok, optString, requireString, type ToolDefinition } from "../helpers.js";

export const vocabularyTools: ToolDefinition[] = [
  {
    name: "define_term",
    description:
      "Record a domain-vocabulary term used in this codebase. gloss is a one-sentence compressed definition (enough to use the term); expansion is the full explanation (enough to teach it). subsystem_id scopes a term; omit for codebase-wide terms. first_seen is a file:symbol@sha anchor.",
    inputSchema: {
      type: "object",
      properties: {
        term: { type: "string" },
        gloss: { type: "string" },
        expansion: { type: "string" },
        subsystem_id: { type: "string" },
        first_seen: { type: "string" },
        ref_sha: { type: "string" },
      },
      required: ["term", "gloss"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const term = requireString(args, "term");
      const gloss = requireString(args, "gloss");
      const expansion = optString(args, "expansion");
      const subsystemId = optString(args, "subsystem_id");
      const firstSeen = optString(args, "first_seen");
      const refSha = optString(args, "ref_sha");
      const existing = ctx.db.prepare("SELECT term FROM vocabulary WHERE term = ?").get(term);
      ctx.db
        .prepare(
          `INSERT INTO vocabulary (term, gloss, expansion, subsystem_id, first_seen, ref_sha)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(term) DO UPDATE SET
             gloss = excluded.gloss,
             expansion = COALESCE(excluded.expansion, vocabulary.expansion),
             subsystem_id = COALESCE(excluded.subsystem_id, vocabulary.subsystem_id),
             first_seen = COALESCE(excluded.first_seen, vocabulary.first_seen),
             ref_sha = COALESCE(excluded.ref_sha, vocabulary.ref_sha),
             updated_at = datetime('now')`,
        )
        .run(term, gloss, expansion, subsystemId, firstSeen, refSha);
      return ok({ action: existing ? "updated" : "inserted" });
    },
  },
  {
    name: "lookup_term",
    description:
      "Return a vocabulary entry (or null). Used by the notes agent to answer 'what does X mean here?'",
    inputSchema: {
      type: "object",
      properties: { term: { type: "string" } },
      required: ["term"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const term = requireString(args, "term");
      const row = ctx.db
        .prepare(
          "SELECT term, gloss, expansion, subsystem_id, first_seen, ref_sha, updated_at FROM vocabulary WHERE term = ?",
        )
        .get(term);
      return row ?? null;
    },
  },
  {
    name: "list_vocabulary",
    description:
      "List vocabulary. If subsystem_id is given, returns codebase-wide terms AND terms scoped to that subsystem (the set an agent operating inside a subsystem should know). Otherwise returns everything.",
    inputSchema: {
      type: "object",
      properties: { subsystem_id: { type: "string" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = optString(args, "subsystem_id");
      if (subsystemId) {
        return ctx.db
          .prepare(
            "SELECT term, gloss, subsystem_id FROM vocabulary WHERE subsystem_id IS NULL OR subsystem_id = ? ORDER BY term",
          )
          .all(subsystemId);
      }
      return ctx.db
        .prepare(
          "SELECT term, gloss, subsystem_id FROM vocabulary ORDER BY COALESCE(subsystem_id, ''), term",
        )
        .all();
    },
  },
];
