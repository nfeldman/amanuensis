import {
  ok,
  optBool,
  optIntArray,
  optString,
  requireEnum,
  requireString,
  requireWorkspaceCitation,
  resolveWorkspaceCommit,
  resolveWorkspaceCommits,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession, requireSubsystemStatus } from "../invariants.js";
// A disposition's evidence_quality names the strongest evidence row attached to
// it, so this vocabulary must be exactly what add_evidence accepts. It was once
// a shorter list, which left an agent whose best evidence was `test-observed`
// no way to say so — it had to overstate as code-verified or understate as
// contract-stated, and code-verified is the nearer value (finding B03-3). Both
// are now generated from contracts/conspectus-vocabulary.json, and
// scripts/check-evidence-vocabulary.mjs holds the source, the two generated
// copies, and SKILL.md's prose ladder together.
import {
  DISPOSITION_CLASSIFICATIONS,
  EVIDENCE_KINDS,
  EVIDENCE_QUALITIES,
  PASS_TYPES,
} from "../vocabulary.js";

/**
 * §2.2's refusals, quoted where the specification quotes them. A disposition is
 * the record of how a concern was answered; the answer has to be openable.
 */
const EVIDENCE_IDS_REQUIRED =
  "set_disposition requires at least one evidence_id: a disposition is how a concern was " +
  "answered, and an answer nobody can open is not a disposition. Record the reading with " +
  "add_evidence, then pass its id here. One is enough.";

export const dispositionTools: ToolDefinition[] = [
  {
    name: "set_disposition",
    description:
      "Record how a concern applies to a subsystem. Every disposition must carry evidence_ids (at least one recorded evidence row, attached as it is written), evidence (file:symbol@sha), evidence_quality (no stronger than the strongest attached row's kind), a rationale, and the pass that produced it. ref_sha and every attached row's revision must resolve to a commit in the bound workspace. This is the primary DB analog of the subsystem survey's Concern Disposition Table.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        concern_code: { type: "string" },
        classification: { type: "string" },
        evidence: { type: "string" },
        evidence_ids: {
          type: "array",
          items: { type: "integer" },
          minItems: 1,
          description:
            "Evidence rows this disposition rests on, from add_evidence. Attached as the disposition is written. One is enough.",
        },
        evidence_quality: { type: "string" },
        linchpin_dependent: { type: "boolean" },
        rationale: { type: "string" },
        ref_sha: { type: "string" },
        session_id: { type: "string" },
        pass_type: { type: "string" },
      },
      required: [
        "subsystem_id",
        "concern_code",
        "classification",
        "evidence",
        "evidence_ids",
        "evidence_quality",
        "rationale",
        "ref_sha",
        "pass_type",
      ],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "set_disposition");
      const subsystemId = requireString(args, "subsystem_id");
      const concernCode = requireString(args, "concern_code");
      const classification = requireEnum(args, "classification", DISPOSITION_CLASSIFICATIONS);
      const evidence = requireWorkspaceCitation(args.evidence, "evidence", { strict: false });
      const evidenceQuality = requireEnum(args, "evidence_quality", EVIDENCE_QUALITIES);
      const linchpin = optBool(args, "linchpin_dependent", false);
      const rationale = requireString(args, "rationale");
      const requestedRefSha = requireString(args, "ref_sha");
      const passType = requireEnum(args, "pass_type", PASS_TYPES);
      const sessionId = optString(args, "session_id") ?? ctx.sessionId;

      // Knowledge-depth contract: dispositions are only authorized
      // once the subsystem has reached the concerns pass. Adversarial
      // writes reach higher still. The gate rejects premature writes
      // instead of silently accepting claims a structural or scoping
      // survey cannot support.
      const minStatus = passType === "adversarial" ? "adversarial" : "concerns";
      requireSubsystemStatus(ctx.db, subsystemId, minStatus, "set_disposition");

      // Verify the concern exists to avoid silent FK-style orphans.
      const concernExists = ctx.db
        .prepare("SELECT 1 FROM concerns WHERE code = ?")
        .get(concernCode);
      if (!concernExists) {
        return { ok: false, error: `concern ${concernCode} does not exist — add it first` };
      }

      // Resolved in the bound workspace, and stored resolved, for the reason
      // add_claim already resolved its own: an unresolvable revision is
      // published as a revision-bound reading by every reader (F6/codex). It
      // runs after the depth and concern gates so a caller who got those wrong
      // is told that rather than told about its revision.
      const refSha = resolveWorkspaceCommit(ctx, requestedRefSha);

      // §2.2. A disposition names the readings it rests on, and the server
      // writes the attachment rather than asking the agent to remember a second
      // call. `attach_evidence_to_disposition` was the only writer of
      // `disposition_evidence` and nothing required anyone to call it, so 177 of
      // the candidate store's 180 dispositions carried no attached row.
      //
      // Ordered after the session, depth, concern and revision checks above so a
      // caller who got one of those wrong is told that, not told about evidence.
      const evidenceIds = optIntArray(args, "evidence_ids");
      if (evidenceIds === null || evidenceIds.length === 0) {
        throw new ToolError(EVIDENCE_IDS_REQUIRED);
      }
      const distinctIds = [...new Set(evidenceIds)];
      const rows = ctx.db
        .prepare(
          `SELECT id, ref_sha, kind FROM evidence
            WHERE id IN (${distinctIds.map(() => "?").join(",")})`,
        )
        .all(...distinctIds) as Array<{ id: number; ref_sha: string | null; kind: string }>;
      const byId = new Map(rows.map((row) => [row.id, row]));
      const missing = distinctIds.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        throw new ToolError(
          `unknown evidence_id: ${missing.join(", ")} — record the reading with add_evidence first`,
        );
      }

      // One subprocess for the whole set, not one per id: see
      // `resolveWorkspaceCommits`. An unreachable revision refuses the call,
      // because a disposition anchored to a revision nobody can check out is
      // the same defect as one anchored to nothing.
      const reachable = resolveWorkspaceCommits(
        ctx.project.workspacePath,
        rows.map((row) => row.ref_sha ?? ""),
      );
      for (const id of distinctIds) {
        const row = byId.get(id) as { id: number; ref_sha: string | null; kind: string };
        if (reachable.get(row.ref_sha ?? "")) continue;
        throw new ToolError(
          `evidence row ${id} has ref_sha ${row.ref_sha ?? "(none)"}, which does not resolve to a ` +
            `commit in the bound workspace ${ctx.project.workspacePath}. A disposition anchored ` +
            `to an unreachable revision cannot be re-read.`,
        );
      }

      // A disposition may under-claim its evidence; it may not over-claim it.
      // The ladder is ordered strongest first, so the strongest kind attached is
      // the smallest index, and a claim below that index claims more than the
      // reading supports.
      const strongestRank = Math.min(
        ...rows.map((row) => {
          const rank = EVIDENCE_KINDS.indexOf(row.kind as (typeof EVIDENCE_KINDS)[number]);
          return rank < 0 ? EVIDENCE_KINDS.length : rank;
        }),
      );
      const claimedRank = EVIDENCE_QUALITIES.indexOf(evidenceQuality);
      if (claimedRank >= 0 && claimedRank < strongestRank) {
        const strongest = EVIDENCE_KINDS[strongestRank] ?? "(none on the ladder)";
        throw new ToolError(
          `set_disposition claims evidence_quality '${evidenceQuality}', but the strongest ` +
            `attached evidence row is kind '${strongest}'. Lower the claim or attach the ` +
            `stronger reading.`,
        );
      }

      // One transaction: either the disposition and its attachments are both
      // present afterwards, or neither is. A disposition written without its
      // attachments is exactly the state §2.2 exists to prevent, and a partial
      // write would produce it from a call that reported failure.
      const write = ctx.db.transaction(() => {
        ctx.db
          .prepare(
            `INSERT INTO dispositions
            (subsystem_id, concern_code, classification, evidence, evidence_quality,
             linchpin_dependent, rationale, ref_sha, session_id, pass_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(subsystem_id, concern_code) DO UPDATE SET
             classification = excluded.classification,
             evidence = excluded.evidence,
             evidence_quality = excluded.evidence_quality,
             linchpin_dependent = excluded.linchpin_dependent,
             rationale = excluded.rationale,
             assessed_at = datetime('now'),
             ref_sha = excluded.ref_sha,
             session_id = excluded.session_id,
             pass_type = excluded.pass_type`,
          )
          .run(
            subsystemId,
            concernCode,
            classification,
            evidence,
            evidenceQuality,
            linchpin ? 1 : 0,
            rationale,
            refSha,
            sessionId,
            passType,
          );
        const attach = ctx.db.prepare(
          `INSERT INTO disposition_evidence (subsystem_id, concern_code, evidence_id, role)
             VALUES (?, ?, ?, 'supports')
             ON CONFLICT(subsystem_id, concern_code, evidence_id) DO NOTHING`,
        );
        // DO NOTHING, not DO UPDATE: a row already attached as `contradicts`,
        // `linchpin` or `compensating` was given that role deliberately through
        // `attach_evidence_to_disposition`, and this default must not overwrite
        // it when the disposition is revised.
        for (const id of distinctIds) attach.run(subsystemId, concernCode, id);
      });
      write();
      return ok({ evidence_attached: distinctIds.length });
    },
  },
  {
    name: "get_dispositions",
    description:
      "Return dispositions. Filter by subsystem_id, concern_code, or both. Omit both to return everything (useful for adversarial review across the conspectus).",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        concern_code: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = optString(args, "subsystem_id");
      const concernCode = optString(args, "concern_code");
      const clauses: string[] = [];
      const params: string[] = [];
      if (subsystemId) {
        clauses.push("subsystem_id = ?");
        params.push(subsystemId);
      }
      if (concernCode) {
        clauses.push("concern_code = ?");
        params.push(concernCode);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return ctx.db
        .prepare(
          `SELECT subsystem_id, concern_code, classification, evidence, evidence_quality,
                  linchpin_dependent, rationale, ref_sha, session_id, pass_type, assessed_at
             FROM dispositions ${where}
             ORDER BY subsystem_id, concern_code`,
        )
        .all(...params);
    },
  },
  {
    name: "get_concern_coverage",
    description:
      "Return the concern × subsystem matrix (active concerns × registered subsystems) with current disposition or '—' for unexamined cells. Used to produce the materialized heatmap.",
    inputSchema: {
      type: "object",
      properties: { subsystem_id: { type: "string" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = optString(args, "subsystem_id");
      // Coverage is the cartesian product of active concerns × registered
      // subsystems, left-joined with dispositions so unexamined cells
      // surface as the em-dash sentinel. We let SQLite assemble the matrix
      // rather than reconstituting it row-by-row in JS — for a populated
      // conspectus this is one query instead of three plus a hash join.
      const sql = `
        SELECT c.code AS concern_code,
               c.category AS category,
               s.id AS subsystem_id,
               COALESCE(d.classification, '—') AS disposition,
               d.assessed_at AS assessed_at
          FROM concerns c
          CROSS JOIN subsystems s
          LEFT JOIN dispositions d
            ON d.concern_code = c.code AND d.subsystem_id = s.id
         WHERE c.status = 'active' ${subsystemId ? "AND s.id = ?" : ""}
         ORDER BY s.id, c.code`;
      const stmt = ctx.db.prepare(sql);
      return (subsystemId ? stmt.all(subsystemId) : stmt.all()) as Array<{
        concern_code: string;
        category: string | null;
        subsystem_id: string;
        disposition: string;
        assessed_at: string | null;
      }>;
    },
  },
];
