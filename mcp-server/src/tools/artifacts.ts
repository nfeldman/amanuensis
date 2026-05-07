import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { ok, optString, requireEnum, requireString, type ToolDefinition } from "../helpers.js";
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

function hashFile(path: string): { hash: string; bytes: number } {
  const buf = readFileSync(path);
  const hash = createHash("sha256").update(buf).digest("hex");
  return { hash, bytes: buf.length };
}

function resolveArtifactPath(storagePath: string, relOrAbs: string): string {
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
      "Record that a prose artifact exists and capture its content hash. `path` is relative to the project storage directory. If the file exists, its size and sha256 are computed automatically. This is the source of truth the diff-aware materializer uses to decide what to re-render.",
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
      "List registered prose artifacts. Filter by kind ('subsystem-survey', 'findings-index', etc.) and/or subsystem_id.",
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
      "Re-read an artifact from disk and update its stored content_hash + bytes. Called by the agents right after writing an artifact file so the materializer's diff check reflects the current contents.",
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
      const existing = ctx.db.prepare("SELECT 1 FROM artifacts WHERE path = ?").get(path);
      if (!existing) return { ok: false, error: `artifact ${path} not registered` };
      try {
        const abs = resolveArtifactPath(ctx.project.storagePath, path);
        const { hash, bytes } = hashFile(abs);
        ctx.db
          .prepare(
            `UPDATE artifacts SET content_hash = ?, bytes = ?, ref_sha = COALESCE(?, ref_sha), written_at = datetime('now') WHERE path = ?`,
          )
          .run(hash, bytes, refSha, path);
        return ok({ content_hash: hash, bytes });
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  },
];
