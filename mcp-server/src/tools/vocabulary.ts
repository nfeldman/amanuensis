import {
  CITATION_TOKEN_SOURCE,
  isCitationToken,
  ok,
  optString,
  parseCitation,
  requireString,
  requireWorkspaceCitation,
  resolveWorkspaceCommit,
  type ServerContext,
  type ToolDefinition,
  ToolError,
  workspaceTreeHasPath,
} from "../helpers.js";
import { readVocabularyDischarge, requireActiveSession } from "../invariants.js";

/**
 * §4.2's three steps, in order, over a supplied `first_seen`.
 *
 * **Parsing is not resolution, and the difference is the whole obligation.**
 * `requireWorkspaceCitation` takes `indexOf(":")` and `lastIndexOf("@")` and
 * validates the path *syntax*. It runs no git, does not resolve the revision
 * the token names, and does not ask whether the path exists in that revision's
 * tree, so `src/nothing-here.ts:ghost@0000000` passes it. A term recorded on
 * such an anchor looks exactly like a term recorded on a real one, and the
 * measure that counts anchored terms cannot tell them apart.
 *
 * Each step refuses with its own sentence, because the repairs differ: a token
 * that does not parse is a typo in the form, an unreachable revision is a
 * reading taken on a branch that was rewritten, and a path absent from the tree
 * is a reading of a file that was never there at that commit.
 *
 * The returned anchor is stored **resolved** — the normalized path and the full
 * 40-character object name — for the reason `resolveWorkspaceCommit` gives: a
 * later reader comparing revisions has a commit to compare rather than a prefix
 * to guess at, and a prefix that is unambiguous today need not stay so.
 */
function resolveAnchor(ctx: ServerContext, value: string): string {
  const parsed = requireWorkspaceCitation(value, "first_seen", { strict: true });
  if (!isCitationToken(parsed)) {
    throw new ToolError(
      `first_seen ${value} is not a citation token: it must be one whitespace-free ` +
        `file:symbol@sha, whose revision is 7-40 hex characters. An anchor nobody can open ` +
        `records where a term was first seen without saying where that is.`,
    );
  }
  const { path, symbol, revision } = parseCitation(parsed);
  if (!path || !symbol || !revision) {
    throw new ToolError(`first_seen ${value} must use file:symbol@sha form`);
  }
  const resolved = resolveWorkspaceCommit(ctx, revision, "first_seen revision");
  if (!workspaceTreeHasPath(ctx.project.workspacePath, resolved, path)) {
    throw new ToolError(
      `first_seen ${value} names a path the tree at ${resolved.slice(0, 7)} does not carry: ` +
        `git cat-file -e ${resolved.slice(0, 7)}:${path} fails. The revision resolves and the ` +
        `path does not exist in it, which is the case a citation parse cannot see — record the ` +
        `term at a revision where the file it was first seen in is present.`,
    );
  }
  return `${path}:${symbol}@${resolved}`;
}

export const vocabularyTools: ToolDefinition[] = [
  {
    name: "define_term",
    description:
      "Record a domain-vocabulary term used in this codebase. gloss is a one-sentence compressed definition (enough to use the term); expansion is the full explanation (enough to teach it). subsystem_id scopes a term; omit for codebase-wide terms, which discharge no subsystem's structural obligation. first_seen is a file:symbol@sha anchor whose revision must resolve and whose path must exist in that revision's tree; a term recorded without one is stored and anchors nothing.",
    inputSchema: {
      type: "object",
      properties: {
        term: { type: "string" },
        gloss: { type: "string" },
        expansion: { type: "string" },
        subsystem_id: { type: "string" },
        // The published grammar is the one the handler enforces, generated from
        // the same source, rather than a second copy of it that can drift.
        first_seen: { type: "string", pattern: `^${CITATION_TOKEN_SOURCE}$` },
        ref_sha: { type: "string" },
      },
      required: ["term", "gloss"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      // A term is a durable, attributable record like every other write here;
      // before this it was the one survey deliverable a nameless caller could
      // leave behind (spec.md §4.2).
      requireActiveSession(ctx, "define_term");
      const term = requireString(args, "term");
      const gloss = requireString(args, "gloss");
      const expansion = optString(args, "expansion");
      const subsystemId = optString(args, "subsystem_id");
      const suppliedAnchor = optString(args, "first_seen");
      const suppliedRefSha = optString(args, "ref_sha");

      const firstSeen = suppliedAnchor === null ? null : resolveAnchor(ctx, suppliedAnchor);
      const anchorRevision = firstSeen === null ? null : parseCitation(firstSeen).revision;
      let refSha: string | null = null;
      if (suppliedRefSha !== null) {
        refSha = resolveWorkspaceCommit(ctx, suppliedRefSha, "ref_sha");
        if (anchorRevision !== null && refSha !== anchorRevision) {
          // Two revisions for one reading. Whichever is right, a reader opening
          // the row cannot tell which, and the anchored predicate would answer
          // over one while the row advertises the other.
          throw new ToolError(
            `ref_sha ${refSha.slice(0, 7)} disagrees with the revision inside first_seen ` +
              `(${anchorRevision.slice(0, 7)}). A term records one reading at one revision; ` +
              `pass the anchor alone, or pass a ref_sha that resolves to the same commit.`,
          );
        }
      }

      const existing = ctx.db
        .prepare("SELECT term, subsystem_id FROM vocabulary WHERE term = ?")
        .get(term) as { term: string; subsystem_id: string | null } | undefined;

      const write = ctx.db.transaction(() => {
        // The scope a row already carries is written to the join table before
        // the upsert moves the primary scope, so a term shared between two
        // subsystems stays scoped to both. Without this, re-defining a term for
        // B revoked A's discharge silently, after A had already advanced on it
        // (spec.md §4.4).
        const scope = ctx.db.prepare(
          "INSERT OR IGNORE INTO vocabulary_scopes (term, subsystem_id) VALUES (?, ?)",
        );
        if (existing?.subsystem_id) scope.run(term, existing.subsystem_id);
        if (subsystemId) scope.run(term, subsystemId);
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
      });
      write();
      return ok({ action: existing ? "updated" : "inserted", anchored: firstSeen !== null });
    },
  },
  {
    name: "decline_domain_vocabulary",
    description:
      "Declare that a subsystem carries no domain vocabulary of its own, with the reason it does not. This is the other way to discharge the structural phase's vocabulary obligation: one term is enough, there is no quota, and 'none' is a real and common answer that has to be said out loud rather than left as silence. The record is append-only and is kept when a later pass does find a term. Refused for a subsystem that already has an anchored term.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        reason: { type: "string" },
        ref_sha: { type: "string" },
        session_id: { type: "string" },
      },
      required: ["subsystem_id", "reason", "ref_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "decline_domain_vocabulary");
      const subsystemId = requireString(args, "subsystem_id");
      const reason = requireString(args, "reason");
      const suppliedSession = optString(args, "session_id");
      if (suppliedSession !== null && suppliedSession !== sessionId) {
        // The column exists so the judgement can be attributed, not so a caller
        // can attribute it to someone else.
        throw new ToolError(
          `session_id ${suppliedSession} is not the active session (${sessionId}). A declination ` +
            `is attributed to the session that made the judgement; omit session_id to use it.`,
        );
      }
      const refSha = resolveWorkspaceCommit(ctx, requireString(args, "ref_sha"), "ref_sha");

      const reading = readVocabularyDischarge(ctx.db, ctx.project.workspacePath, subsystemId);
      if (reading.anchoredTerms.length > 0) {
        const named = reading.anchoredTerms.slice(0, 5).join(", ");
        const more =
          reading.anchoredTerms.length > 5 ? `, and ${reading.anchoredTerms.length - 5} more` : "";
        throw new ToolError(
          `decline_domain_vocabulary refuses: ${subsystemId} already has ` +
            `${reading.anchoredTerms.length} anchored term(s) — ${named}${more}. A subsystem ` +
            `cannot both carry domain vocabulary and declare it has none.`,
        );
      }

      const result = ctx.db
        .prepare(
          `INSERT INTO vocabulary_declinations (subsystem_id, reason, session_id, ref_sha)
           VALUES (?, ?, ?, ?)`,
        )
        .run(subsystemId, reason, sessionId, refSha);
      return ok({ id: Number(result.lastInsertRowid), subsystem_id: subsystemId, ref_sha: refSha });
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
        // The scope set, not `vocabulary.subsystem_id`, is what scoping means
        // once a term can belong to more than one subsystem — a reader listing
        // B's vocabulary must see a term B shares with A (spec.md §4.4).
        return ctx.db
          .prepare(
            `SELECT term, gloss, subsystem_id
               FROM vocabulary v
              WHERE v.subsystem_id IS NULL
                 OR v.subsystem_id = ?
                 OR EXISTS (SELECT 1 FROM vocabulary_scopes s
                             WHERE s.term = v.term AND s.subsystem_id = ?)
              ORDER BY term`,
          )
          .all(subsystemId, subsystemId);
      }
      return ctx.db
        .prepare(
          "SELECT term, gloss, subsystem_id FROM vocabulary ORDER BY COALESCE(subsystem_id, ''), term",
        )
        .all();
    },
  },
];
