import {
  ok,
  optInt,
  optString,
  requireEnum,
  requireInt,
  requireString,
  requireWorkspaceSourcePath,
  type ToolDefinition,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const KINDS = [
  "code-verified",
  "contract-stated",
  "comment-asserted",
  "name-inferred",
  "pattern-matched",
  "test-observed",
  "config-asserted",
  "doc-asserted",
  "runtime-observed",
] as const;

const DISP_ROLES = ["supports", "contradicts", "linchpin", "compensating"] as const;
const FIND_ROLES = [
  "symptom",
  "root-cause",
  "fix-anchor",
  "fix-verification",
  "compensating",
] as const;

export const evidenceTools: ToolDefinition[] = [
  {
    name: "add_evidence",
    description:
      "Record a structured code citation. file_path + symbol + line_range + ref_sha uniquely anchor a piece of observed behavior; kind captures how solid the observation is. Returns the evidence id to be attached to dispositions/findings/diagnosticity cells.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        symbol: { type: "string" },
        line_range: { type: "string" },
        ref_sha: { type: "string" },
        kind: { type: "string" },
        excerpt: { type: "string" },
        note: { type: "string" },
        session_id: { type: "string" },
      },
      required: ["file_path", "ref_sha", "kind"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "add_evidence");
      const filePath = requireWorkspaceSourcePath(args.file_path);
      const refSha = requireString(args, "ref_sha");
      const kind = requireEnum(args, "kind", KINDS);
      const symbol = optString(args, "symbol");
      const lineRange = optString(args, "line_range");
      const excerpt = optString(args, "excerpt");
      const note = optString(args, "note");
      const sessionId = optString(args, "session_id") ?? ctx.sessionId;
      const info = ctx.db
        .prepare(
          `INSERT INTO evidence (file_path, symbol, line_range, ref_sha, kind, excerpt, note, session_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(filePath, symbol, lineRange, refSha, kind, excerpt, note, sessionId);
      return ok({ id: info.lastInsertRowid });
    },
  },
  {
    name: "attach_evidence_to_disposition",
    description:
      "Link an evidence row to a disposition with a role (supports / contradicts / linchpin / compensating). Idempotent — repeated calls just update the role.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        concern_code: { type: "string" },
        evidence_id: { type: "integer" },
        role: { type: "string" },
      },
      required: ["subsystem_id", "concern_code", "evidence_id", "role"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "attach_evidence_to_disposition");
      const subsystemId = requireString(args, "subsystem_id");
      const concernCode = requireString(args, "concern_code");
      const evidenceId = requireInt(args, "evidence_id");
      const role = requireEnum(args, "role", DISP_ROLES);
      const disp = ctx.db
        .prepare("SELECT 1 FROM dispositions WHERE subsystem_id = ? AND concern_code = ?")
        .get(subsystemId, concernCode);
      if (!disp) return { ok: false, error: `no disposition for ${subsystemId}/${concernCode}` };
      const ev = ctx.db.prepare("SELECT 1 FROM evidence WHERE id = ?").get(evidenceId);
      if (!ev) return { ok: false, error: `no evidence ${evidenceId}` };
      ctx.db
        .prepare(
          `INSERT INTO disposition_evidence (subsystem_id, concern_code, evidence_id, role)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(subsystem_id, concern_code, evidence_id) DO UPDATE SET role = excluded.role`,
        )
        .run(subsystemId, concernCode, evidenceId, role);
      return ok();
    },
  },
  {
    name: "attach_evidence_to_finding",
    description:
      "Link an evidence row to a finding with a role (symptom / root-cause / fix-anchor / fix-verification / compensating). verify_finding_fix requires fix-verification.",
    inputSchema: {
      type: "object",
      properties: {
        finding_id: { type: "string" },
        evidence_id: { type: "integer" },
        role: { type: "string" },
      },
      required: ["finding_id", "evidence_id", "role"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "attach_evidence_to_finding");
      const findingId = requireString(args, "finding_id");
      const evidenceId = requireInt(args, "evidence_id");
      const role = requireEnum(args, "role", FIND_ROLES);
      const f = ctx.db.prepare("SELECT 1 FROM findings WHERE finding_id = ?").get(findingId);
      if (!f) return { ok: false, error: `no finding ${findingId}` };
      const ev = ctx.db.prepare("SELECT 1 FROM evidence WHERE id = ?").get(evidenceId);
      if (!ev) return { ok: false, error: `no evidence ${evidenceId}` };
      ctx.db
        .prepare(
          `INSERT INTO finding_evidence (finding_id, evidence_id, role)
           VALUES (?, ?, ?)
           ON CONFLICT(finding_id, evidence_id) DO UPDATE SET role = excluded.role`,
        )
        .run(findingId, evidenceId, role);
      return ok();
    },
  },
  {
    name: "get_evidence",
    description:
      "Fetch evidence rows. Filter by id, file_path, kind, ref_sha, or any combination. Returns the full row with collected_at timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        file_path: { type: "string" },
        kind: { type: "string" },
        ref_sha: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const id = optInt(args, "id");
      if (id != null) {
        return ctx.db.prepare("SELECT * FROM evidence WHERE id = ?").get(id) ?? null;
      }
      const filePath = optString(args, "file_path");
      const kind = optString(args, "kind");
      const refSha = optString(args, "ref_sha");
      const clauses: string[] = [];
      const params: string[] = [];
      if (filePath) {
        clauses.push("file_path = ?");
        params.push(filePath);
      }
      if (kind) {
        clauses.push("kind = ?");
        params.push(kind);
      }
      if (refSha) {
        clauses.push("ref_sha = ?");
        params.push(refSha);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return ctx.db
        .prepare(`SELECT * FROM evidence ${where} ORDER BY collected_at DESC`)
        .all(...params);
    },
  },
  {
    name: "get_disposition_evidence",
    description: "Return all evidence rows attached to a disposition, including role.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        concern_code: { type: "string" },
      },
      required: ["subsystem_id", "concern_code"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = requireString(args, "subsystem_id");
      const concernCode = requireString(args, "concern_code");
      return ctx.db
        .prepare(
          `SELECT e.*, de.role
             FROM disposition_evidence de JOIN evidence e ON e.id = de.evidence_id
             WHERE de.subsystem_id = ? AND de.concern_code = ?
             ORDER BY de.role, e.collected_at`,
        )
        .all(subsystemId, concernCode);
    },
  },
  {
    name: "get_finding_evidence",
    description: "Return all evidence rows attached to a finding, including role.",
    inputSchema: {
      type: "object",
      properties: { finding_id: { type: "string" } },
      required: ["finding_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const findingId = requireString(args, "finding_id");
      return ctx.db
        .prepare(
          `SELECT e.*, fe.role
             FROM finding_evidence fe JOIN evidence e ON e.id = fe.evidence_id
             WHERE fe.finding_id = ?
             ORDER BY fe.role, e.collected_at`,
        )
        .all(findingId);
    },
  },
];
