import {
  ok,
  optString,
  requireEnum,
  requireString,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const CLASSIFICATIONS = [
  "candidate",
  "examined",
  "generated-ignore",
  "vendor-ignore",
  "irrelevant",
  "deferred-with-reason",
] as const;
type Classification = (typeof CLASSIFICATIONS)[number];

function isClassification(v: string): v is Classification {
  return (CLASSIFICATIONS as readonly string[]).includes(v);
}

export const fileTools: ToolDefinition[] = [
  {
    name: "add_files_to_scope",
    description:
      "Append or update file ledger rows for a subsystem. Each file gets a why_in_scope rationale and an optional classification (default 'candidate'). ref_sha anchors the observation to a specific commit.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        ref_sha: { type: "string" },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file_path: { type: "string" },
              why_in_scope: { type: "string" },
              classification: { type: "string" },
            },
            required: ["file_path"],
            additionalProperties: false,
          },
        },
      },
      required: ["subsystem_id", "ref_sha", "files"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "add_files_to_scope");
      const subsystemId = requireString(args, "subsystem_id");
      const refSha = requireString(args, "ref_sha");
      const files = args.files as Array<{
        file_path: string;
        why_in_scope?: string;
        classification?: string;
      }>;
      if (!Array.isArray(files) || files.length === 0) {
        return { ok: false, error: "files must be a non-empty array" };
      }
      // Validate classifications up front so a single bad value rejects
      // the whole batch before any rows are written. Database errors
      // raised inside the transaction propagate as themselves rather
      // than being swallowed and relabelled as validation failures.
      const normalized = files.map((f) => {
        const classification = f.classification ?? "candidate";
        if (!isClassification(classification)) {
          throw new ToolError(`invalid classification: ${classification}`);
        }
        return {
          file_path: f.file_path,
          why_in_scope: f.why_in_scope ?? null,
          classification,
        };
      });
      const stmt = ctx.db.prepare(
        `INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at)
         VALUES (?, ?, ?, ?, ?, CASE WHEN ?='examined' THEN datetime('now') ELSE NULL END)
         ON CONFLICT(subsystem_id, file_path) DO UPDATE SET
           why_in_scope = COALESCE(excluded.why_in_scope, file_ledger.why_in_scope),
           classification = COALESCE(excluded.classification, file_ledger.classification),
           ref_sha = excluded.ref_sha,
           examined_at = CASE WHEN excluded.classification='examined' THEN datetime('now') ELSE file_ledger.examined_at END`,
      );
      ctx.db.transaction(() => {
        for (const f of normalized) {
          stmt.run(
            subsystemId,
            f.file_path,
            f.why_in_scope,
            f.classification,
            refSha,
            f.classification,
          );
        }
      })();
      return ok({ added: normalized.length });
    },
  },
  {
    name: "update_file_classification",
    description:
      "Transition a scoped file to a new classification (e.g., candidate → examined). Updates examined_at when the new classification is 'examined'.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        file_path: { type: "string" },
        classification: { type: "string" },
        ref_sha: { type: "string" },
      },
      required: ["subsystem_id", "file_path", "classification"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "update_file_classification");
      const subsystemId = requireString(args, "subsystem_id");
      const filePath = requireString(args, "file_path");
      const classification = requireEnum(args, "classification", CLASSIFICATIONS);
      const refSha = optString(args, "ref_sha");
      const res = ctx.db
        .prepare(
          `UPDATE file_ledger
             SET classification = ?,
                 ref_sha = COALESCE(?, ref_sha),
                 examined_at = CASE WHEN ?='examined' THEN datetime('now') ELSE examined_at END
           WHERE subsystem_id = ? AND file_path = ?`,
        )
        .run(classification, refSha, classification, subsystemId, filePath);
      if (res.changes === 0) {
        return { ok: false, error: "no matching file_ledger row" };
      }
      return ok();
    },
  },
  {
    name: "get_subsystem_files",
    description:
      "List the file ledger for a subsystem. classification_filter narrows to e.g. 'examined' or 'candidate'.",
    inputSchema: {
      type: "object",
      properties: {
        subsystem_id: { type: "string" },
        classification_filter: { type: "string" },
      },
      required: ["subsystem_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const subsystemId = requireString(args, "subsystem_id");
      const classificationFilter = optString(args, "classification_filter");
      const rows = classificationFilter
        ? ctx.db
            .prepare(
              "SELECT file_path, why_in_scope, classification, ref_sha, examined_at FROM file_ledger WHERE subsystem_id = ? AND classification = ? ORDER BY file_path",
            )
            .all(subsystemId, classificationFilter)
        : ctx.db
            .prepare(
              "SELECT file_path, why_in_scope, classification, ref_sha, examined_at FROM file_ledger WHERE subsystem_id = ? ORDER BY file_path",
            )
            .all(subsystemId);
      return rows;
    },
  },
];
