import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  ok,
  optString,
  requireEnum,
  requireString,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const KINDS = [
  "onboarding-report",
  "entry-point",
  "master-plan",
  "findings-index",
  "concern-checklist",
  "field-notes",
  "subsystem-survey",
  "seam-assessment",
  "dispatch-prompt",
  "other",
] as const;

/**
 * The record tools that replace each hand-written kind (PLAN store-only §1.1,
 * §2.5). A survey's prose lives in the store now, so the registry keeps only
 * `other`, the server's own exports.
 */
const REPLACED_BY: Record<string, string> = {
  "onboarding-report":
    "record_narrative (repository-shape, runtime, stateful-entities), record_project_profile and record_runtime_boundary",
  "entry-point":
    "record_explanation (subject_type 'project', slot 'purpose') and record_narrative (start-here)",
  "master-plan": "record_narrative (survey-plan)",
  "findings-index": "add_finding",
  "concern-checklist": "add_concern (territory, probe) and record_territory_disposition",
  "field-notes": "add_field_note",
  "subsystem-survey":
    "record_narrative (structure, concern-reasoning, challenge) or decline_narrative",
  "seam-assessment": "upsert_seam",
  "dispatch-prompt": "log_dispatch",
};

/** The sentence that refuses a hand-written kind: its tool, the kind, and the tools to call instead. */
function handWrittenRefusal(tool: string, kind: string): string {
  return (
    `${tool} refuses kind '${kind}': that prose is recorded in the store now, not written as a file. ` +
    `Call ${REPLACED_BY[kind] ?? "the record tool for it"} instead; kind 'other' stays for the server's own exports.`
  );
}

function hashFile(path: string): { hash: string; bytes: number } {
  const buf = readFileSync(path);
  const hash = createHash("sha256").update(buf).digest("hex");
  return { hash, bytes: buf.length };
}

export function resolveArtifactPath(storagePath: string, relOrAbs: string): string {
  // Artifacts are addressed by a path relative to project storage. Reject
  // any attempt to escape storage via `..`, an absolute path, or a
  // symlink under the storage tree pointing outward. The lexical check
  // catches the first two; the realpath check (only attempted if the
  // target exists) catches the third.
  const realRoot = realpathSync(storagePath);
  const abs = resolve(realRoot, relOrAbs);
  if (abs !== realRoot && !abs.startsWith(realRoot + sep)) {
    throw new Error(`artifact path escapes project storage: ${relOrAbs}`);
  }
  try {
    const real = realpathSync(abs);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) {
      throw new Error(`artifact path escapes project storage via symlink: ${relOrAbs}`);
    }
  } catch (e) {
    // ENOENT is expected when an artifact is registered before the file
    // is written; symlink escape requires an existing entry, so a
    // missing target is safe to permit.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return abs;
}

export const artifactTools: ToolDefinition[] = [
  {
    name: "register_artifact",
    description:
      "Record that a file the server wrote exists and capture its content hash. Only kind 'other' (the server's own exports) is accepted; every hand-written kind (onboarding-report, entry-point, master-plan, findings-index, concern-checklist, field-notes, subsystem-survey, seam-assessment, dispatch-prompt) is refused with the record tool that replaces it, because that prose is recorded in the store. `path` is relative to the project storage directory. If the file exists, its size and sha256 are computed automatically.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        kind: { type: "string" },
        subsystem_id: { type: "string" },
        ref_sha: { type: "string" },
        session_id: { type: "string" },
        notes: { type: "string" },
      },
      required: ["path", "kind"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "register_artifact");
      const path = requireString(args, "path");
      const kind = requireEnum(args, "kind", KINDS);
      if (kind !== "other") throw new ToolError(handWrittenRefusal("register_artifact", kind));
      const subsystemId = optString(args, "subsystem_id");
      const refSha = optString(args, "ref_sha");
      const sessionId = optString(args, "session_id") ?? ctx.sessionId;
      const notes = optString(args, "notes");
      let contentHash: string | null = null;
      let bytes: number | null = null;
      try {
        const abs = resolveArtifactPath(ctx.project.storagePath, path);
        const st = statSync(abs);
        if (st.isFile()) {
          const { hash, bytes: b } = hashFile(abs);
          contentHash = hash;
          bytes = b;
        }
      } catch {
        // File doesn't exist yet — the agent may be registering upfront
        // and will update the hash on a later call. Not an error.
      }
      ctx.db
        .prepare(
          `INSERT INTO artifacts (path, kind, subsystem_id, content_hash, ref_sha, session_id, bytes, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             kind = excluded.kind,
             subsystem_id = COALESCE(excluded.subsystem_id, artifacts.subsystem_id),
             content_hash = COALESCE(excluded.content_hash, artifacts.content_hash),
             ref_sha = COALESCE(excluded.ref_sha, artifacts.ref_sha),
             session_id = COALESCE(excluded.session_id, artifacts.session_id),
             bytes = COALESCE(excluded.bytes, artifacts.bytes),
             notes = COALESCE(excluded.notes, artifacts.notes),
             written_at = datetime('now')`,
        )
        .run(path, kind, subsystemId, contentHash, refSha, sessionId, bytes, notes);
      return ok({ content_hash: contentHash, bytes });
    },
  },
  {
    name: "list_artifacts",
    description:
      "List registered files: the server's own exports (kind 'other') and any row an earlier version registered. Filter by kind and/or subsystem_id.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string" },
        subsystem_id: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const kind = optString(args, "kind");
      const subsystemId = optString(args, "subsystem_id");
      const clauses: string[] = [];
      const params: string[] = [];
      if (kind) {
        clauses.push("kind = ?");
        params.push(kind);
      }
      if (subsystemId) {
        clauses.push("subsystem_id = ?");
        params.push(subsystemId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return ctx.db
        .prepare(
          `SELECT path, kind, subsystem_id, content_hash, ref_sha, session_id, written_at, bytes, notes
             FROM artifacts ${where} ORDER BY written_at DESC`,
        )
        .all(...params);
    },
  },
  {
    name: "rehash_artifact",
    description:
      "Re-read a registered file from disk and update its stored content_hash + bytes. Only kind 'other' (the server's own exports) can be rehashed; a row of a hand-written kind is refused with the record tool that replaces it.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        ref_sha: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "rehash_artifact");
      const path = requireString(args, "path");
      const refSha = optString(args, "ref_sha");
      const existing = ctx.db.prepare("SELECT kind FROM artifacts WHERE path = ?").get(path) as
        | { kind: string }
        | undefined;
      if (!existing) return { ok: false, error: `artifact ${path} not registered` };
      if (existing.kind !== "other")
        throw new ToolError(handWrittenRefusal("rehash_artifact", existing.kind));
      try {
        const abs = resolveArtifactPath(ctx.project.storagePath, path);
        const { hash, bytes } = hashFile(abs);
        // written_at dates the notes a subsystem page prints under its account
        // ("Written on …"), so it moves only when the bytes do: a rehash of an
        // unchanged file must not make old notes look newer than the account.
        ctx.db
          .prepare(
            `UPDATE artifacts SET written_at = CASE WHEN content_hash IS ? THEN written_at ELSE datetime('now') END,
                    content_hash = ?, bytes = ?, ref_sha = COALESCE(?, ref_sha) WHERE path = ?`,
          )
          .run(hash, hash, bytes, refSha, path);
        return ok({ content_hash: hash, bytes });
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  },
];
