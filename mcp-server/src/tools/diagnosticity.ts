import {
  ok,
  optIntArray,
  optString,
  requireEnum,
  requireExistingIds,
  requireInt,
  requireString,
  requireStringArray,
  type ToolDefinition,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const VERDICTS = ["consistent", "contradicts", "irrelevant", "ambiguous"] as const;
const OUTCOMES = ["open", "resolved", "unresolved-competition"] as const;

export const diagnosticityTools: ToolDefinition[] = [
  {
    name: "open_diagnosticity_matrix",
    description:
      "Open an Analysis of Competing Hypotheses matrix when two or more concerns could independently explain the same symptom in a subsystem. Per Heuer/concern-seeding.md: enumerate concerns without pre-ranking, evaluate each piece of evidence against each concern row-wise, and rank by inconsistency — reject the concern with the most contradicting evidence first.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        symptom: { type: "string" },
        shared_location: { type: "string" },
        concern_codes: { type: "array", items: { type: "string" } },
        evidence_ids: { type: "array", items: { type: "integer" } },
        session_id: { type: "string" },
      },
      required: ["symptom", "concern_codes"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "open_diagnosticity_matrix");
      const symptom = requireString(args, "symptom");
      const sharedLocation = optString(args, "shared_location");
      const subsystemId = optString(args, "subsystem_id");
      const sessionId = optString(args, "session_id") ?? ctx.sessionId;
      const concernCodes = requireStringArray(args, "concern_codes", { minLength: 2 });
      const evidenceIds = optIntArray(args, "evidence_ids") ?? [];
      // Verify every referenced concern and evidence row exists. Errors
      // list every missing id rather than stopping at the first.
      requireExistingIds(ctx.db, "concerns", "code", concernCodes, "concern(s)");
      requireExistingIds(ctx.db, "evidence", "id", evidenceIds, "evidence");
      // better-sqlite3 transactions are synchronous; the closure runs to
      // completion before txn() returns, so its return value is safe.
      const matrixId = ctx.db.transaction((): number => {
        const info = ctx.db
          .prepare(
            `INSERT INTO diagnosticity_sessions (subsystem_id, symptom, shared_location, session_id, outcome)
             VALUES (?, ?, ?, ?, 'open')`,
          )
          .run(subsystemId, symptom, sharedLocation, sessionId);
        const id = Number(info.lastInsertRowid);
        const insConcern = ctx.db.prepare(
          "INSERT INTO diagnosticity_concerns (matrix_id, concern_code) VALUES (?, ?)",
        );
        const insEvidence = ctx.db.prepare(
          "INSERT INTO diagnosticity_evidence (matrix_id, evidence_id, row_order) VALUES (?, ?, ?)",
        );
        for (const c of concernCodes) insConcern.run(id, c);
        for (let i = 0; i < evidenceIds.length; i++) {
          insEvidence.run(id, evidenceIds[i], i + 1);
        }
        return id;
      })();
      return ok({ matrix_id: matrixId });
    },
  },
  {
    name: "record_diagnosticity_verdict",
    description:
      "Record the verdict for a single cell (one concern × one evidence row). Verdict ∈ {consistent, contradicts, irrelevant, ambiguous}. Evidence consistent with all competing concerns has zero diagnostic value; evidence that contradicts only one has maximum diagnostic value.",
    inputSchema: {
      type: "object",
      properties: {
        matrix_id: { type: "integer" },
        concern_code: { type: "string" },
        evidence_id: { type: "integer" },
        verdict: { type: "string" },
        note: { type: "string" },
      },
      required: ["matrix_id", "concern_code", "evidence_id", "verdict"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "record_diagnosticity_verdict");
      const matrixId = requireInt(args, "matrix_id");
      const concernCode = requireString(args, "concern_code");
      const evidenceId = requireInt(args, "evidence_id");
      const verdict = requireEnum(args, "verdict", VERDICTS);
      const note = optString(args, "note");
      // Verify the concern and evidence are already part of this matrix.
      const concernOk = ctx.db
        .prepare("SELECT 1 FROM diagnosticity_concerns WHERE matrix_id = ? AND concern_code = ?")
        .get(matrixId, concernCode);
      if (!concernOk) {
        return { ok: false, error: `concern ${concernCode} is not part of matrix ${matrixId}` };
      }
      const evidenceOk = ctx.db
        .prepare("SELECT 1 FROM diagnosticity_evidence WHERE matrix_id = ? AND evidence_id = ?")
        .get(matrixId, evidenceId);
      if (!evidenceOk) {
        return { ok: false, error: `evidence ${evidenceId} is not part of matrix ${matrixId}` };
      }
      ctx.db
        .prepare(
          `INSERT INTO diagnosticity_cells (matrix_id, concern_code, evidence_id, verdict, note)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(matrix_id, concern_code, evidence_id) DO UPDATE SET
             verdict = excluded.verdict,
             note = excluded.note`,
        )
        .run(matrixId, concernCode, evidenceId, verdict, note);
      return ok();
    },
  },
  {
    name: "resolve_diagnosticity_matrix",
    description:
      "Close a matrix with an outcome. 'resolved' requires a leading_concern (winner after inconsistency ranking); 'unresolved-competition' is allowed when the evidence does not disambiguate. linchpin_note documents fragile evidence the resolution depends on.",
    inputSchema: {
      type: "object",
      properties: {
        matrix_id: { type: "integer" },
        outcome: { type: "string" },
        leading_concern: { type: "string" },
        linchpin_note: { type: "string" },
      },
      required: ["matrix_id", "outcome"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "resolve_diagnosticity_matrix");
      const matrixId = requireInt(args, "matrix_id");
      const outcome = requireEnum(args, "outcome", OUTCOMES);
      const leadingConcern = optString(args, "leading_concern");
      const linchpinNote = optString(args, "linchpin_note");
      if (outcome === "resolved" && !leadingConcern) {
        return { ok: false, error: "resolved outcome requires leading_concern" };
      }
      if (leadingConcern) {
        const inMatrix = ctx.db
          .prepare("SELECT 1 FROM diagnosticity_concerns WHERE matrix_id = ? AND concern_code = ?")
          .get(matrixId, leadingConcern);
        if (!inMatrix) {
          return {
            ok: false,
            error: `leading_concern ${leadingConcern} not part of matrix ${matrixId}`,
          };
        }
      }
      const res = ctx.db
        .prepare(
          `UPDATE diagnosticity_sessions
             SET outcome = ?, leading_concern = ?, linchpin_note = ?, resolved_at = datetime('now')
           WHERE id = ?`,
        )
        .run(outcome, leadingConcern, linchpinNote, matrixId);
      if (res.changes === 0) return { ok: false, error: `no matrix ${matrixId}` };
      return ok();
    },
  },
  {
    name: "get_diagnosticity_matrix",
    description:
      "Return a fully-populated matrix: the session row, its competing concerns, its evidence rows, and every cell's verdict. Used by the materializer to render the matrix as a table.",
    inputSchema: {
      type: "object",
      properties: { matrix_id: { type: "integer" } },
      required: ["matrix_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const matrixId = requireInt(args, "matrix_id");
      const session = ctx.db
        .prepare("SELECT * FROM diagnosticity_sessions WHERE id = ?")
        .get(matrixId);
      if (!session) return null;
      const concerns = ctx.db
        .prepare(
          "SELECT concern_code, rank, eliminated FROM diagnosticity_concerns WHERE matrix_id = ? ORDER BY COALESCE(rank, 999), concern_code",
        )
        .all(matrixId);
      const evidence = ctx.db
        .prepare(
          `SELECT de.row_order, e.* FROM diagnosticity_evidence de
             JOIN evidence e ON e.id = de.evidence_id
             WHERE de.matrix_id = ? ORDER BY de.row_order`,
        )
        .all(matrixId);
      const cells = ctx.db
        .prepare("SELECT * FROM diagnosticity_cells WHERE matrix_id = ?")
        .all(matrixId);
      const evidenceValue = ctx.db
        .prepare("SELECT * FROM diagnosticity_evidence_value WHERE matrix_id = ?")
        .all(matrixId);
      return { session, concerns, evidence, cells, evidence_value: evidenceValue };
    },
  },
  {
    name: "list_diagnosticity_matrices",
    description:
      "List matrices, newest first. Filter by outcome ('open', 'resolved', 'unresolved-competition') or subsystem.",
    inputSchema: {
      type: "object",
      properties: {
        outcome: { type: "string" },
        subsystem_id: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const outcome = optString(args, "outcome");
      const subsystemId = optString(args, "subsystem_id");
      const clauses: string[] = [];
      const params: string[] = [];
      if (outcome) {
        clauses.push("outcome = ?");
        params.push(outcome);
      }
      if (subsystemId) {
        clauses.push("subsystem_id = ?");
        params.push(subsystemId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return ctx.db
        .prepare(
          `SELECT id, subsystem_id, symptom, shared_location, leading_concern, outcome, created_at, resolved_at
             FROM diagnosticity_sessions ${where} ORDER BY created_at DESC`,
        )
        .all(...params);
    },
  },
];
