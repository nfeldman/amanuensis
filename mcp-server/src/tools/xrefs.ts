import { spawnSync } from "node:child_process";
import {
  CITATION_TOKEN_SOURCE,
  extractWorkspaceCitations,
  ok,
  optString,
  requireString,
  type ServerContext,
  type ToolDefinition,
} from "../helpers.js";
import { XREF_RELATIONSHIPS, XREF_STRENGTHS } from "../vocabulary.js";

/**
 * §9.2's edge relationships. `xrefs.relationship` carries no CHECK and the tool
 * stays free-form, but an edge Phase 2 records because it crosses a subsystem
 * boundary is one of these two; the description says so rather than the schema,
 * because narrowing the column would refuse rows the enum already publishes.
 */
const CROSSING_RELATIONSHIPS = ["data-flow", "dependency"] as const;

/**
 * Does this revision name a commit in the bound workspace?
 *
 * The eighth local copy of the two-line git probe every tool that resolves a
 * revision carries (`findings.ts:37`, `claims.ts:104`, and six more). They are
 * deliberately not shared: each owns a different failure policy, and folding
 * them together is a refactor no packet in this plan owns.
 */
function resolvesInWorkspace(ctx: ServerContext, revision: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--verify", `${revision}^{commit}`], {
    cwd: ctx.project.workspacePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0 && String(result.stdout ?? "").trim().length > 0;
}

export const xrefTools: ToolDefinition[] = [
  {
    name: "add_xref",
    description: `Record a cross-reference between two subsystems. context is required and must carry at least one whitespace-delimited citation token of the form file:symbol@sha, with a 7-40 character hex revision — the token's path is validated as a workspace source path and its revision must resolve in the bound workspace. The surrounding prose is stored verbatim and the validated tokens come back in citations[]. The symbol is not checked for reachability: deciding whether a symbol exists at a revision needs a language parser this server does not have, so a citation records where the edge was read, not a symbol the server confirmed. relationship is free-form but should use one of the canonical values: ${XREF_RELATIONSHIPS.join(", ")}; an edge recorded because it crosses a subsystem boundary is ${CROSSING_RELATIONSHIPS.join(" or ")}. strength ∈ {${XREF_STRENGTHS.join(", ")}}; defaults to '${XREF_STRENGTHS[0]}'.`,
    inputSchema: {
      type: "object",
      properties: {
        from_id: { type: "string" },
        to_id: { type: "string" },
        relationship: { type: "string" },
        strength: { type: "string", enum: [...XREF_STRENGTHS] },
        context: {
          type: "string",
          minLength: 1,
          // The same grammar the handler enforces, so a validating host refuses
          // an uncited edge before the call is made.
          pattern: `(?:^|\\s)${CITATION_TOKEN_SOURCE}(?:\\s|$)`,
          description:
            "Why this link matters, in prose, carrying at least one file:symbol@sha citation token.",
        },
      },
      required: ["from_id", "to_id", "relationship", "context"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const fromId = requireString(args, "from_id");
      const toId = requireString(args, "to_id");
      const relationship = requireString(args, "relationship");
      const strength = optString(args, "strength") ?? XREF_STRENGTHS[0];
      const context = requireString(args, "context");
      // An edge with no well-formed, revision-resolving citation cannot be
      // recorded (§9.2); the row is written only once the citation holds.
      const citations = extractWorkspaceCitations(context, "context", {
        resolveRevision: (revision) => resolvesInWorkspace(ctx, revision),
      });
      ctx.db
        .prepare(
          `INSERT INTO xrefs (from_id, to_id, relationship, strength, context)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(from_id, to_id, relationship) DO UPDATE SET
             strength = excluded.strength,
             context = excluded.context`,
        )
        .run(fromId, toId, relationship, strength, context);
      return ok({ citations });
    },
  },
  {
    name: "get_xrefs",
    description: "Return cross-references involving a subsystem (as either source or target).",
    inputSchema: {
      type: "object",
      properties: { subsystem_id: { type: "string" } },
      required: ["subsystem_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = requireString(args, "subsystem_id");
      return ctx.db
        .prepare(
          `SELECT from_id, to_id, relationship, strength, context, discovered_at
             FROM xrefs
             WHERE from_id = ? OR to_id = ?
             ORDER BY discovered_at DESC`,
        )
        .all(subsystemId, subsystemId);
    },
  },
];
