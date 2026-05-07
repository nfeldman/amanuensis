import { newSessionId, ok, optString, requireString, type ToolDefinition } from "../helpers.js";
import { getSession, startSession } from "../session.js";
import { commitStorage, isGitRepo } from "../storage-git.js";

export const projectTools: ToolDefinition[] = [
  {
    name: "get_project_info",
    description:
      "Return metadata about the current project: key, workspace, storage directory, whether the DB is initialized, and stored git baseline.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, ctx) => {
      const db = ctx.db;
      const git = db
        .prepare("SELECT canonical_branch, onboarding_sha FROM git_state WHERE repo_id='default'")
        .get() as { canonical_branch?: string; onboarding_sha?: string } | undefined;
      const dbExists = !!db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entries'")
        .get();
      return {
        project_key: ctx.project.projectKey,
        workspace_path: ctx.project.workspacePath,
        storage_path: ctx.project.storagePath,
        db_exists: dbExists,
        onboarding_sha: git?.onboarding_sha ?? null,
        canonical_branch: git?.canonical_branch ?? null,
      };
    },
  },
  {
    name: "start_session",
    description:
      "Begin a new survey session. Intent is free text like 'onboarding', 'survey B-01', 'refresh'. Returns a session_id used to tag dispositions, findings, field notes, and access/query logs.",
    inputSchema: {
      type: "object",
      properties: { intent: { type: "string" } },
      required: ["intent"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const intent = requireString(args, "intent");
      const sessionId = newSessionId();
      startSession(ctx, sessionId, intent);
      return ok({ session_id: sessionId });
    },
  },
  {
    name: "get_session",
    description:
      "Return the stored metadata for a session. If no session_id is provided, returns the most recently started session.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const id = optString(args, "session_id");
      const s = getSession(ctx, id);
      if (!s) return { session_id: null, intent: null, started_at: null };
      return s;
    },
  },
  {
    name: "end_session",
    description:
      "Mark a session ended with an outcome ('completed', 'deferred', 'superseded', etc.). Not required — sessions are still valid while open — but closing them makes the activity log legible.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        outcome: { type: "string" },
      },
      required: ["outcome"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const id = optString(args, "session_id") ?? ctx.sessionId;
      if (!id) return { ok: false, error: "no active session_id and none provided" };
      const outcome = requireString(args, "outcome");
      const res = ctx.db
        .prepare("UPDATE sessions SET ended_at = datetime('now'), outcome = ? WHERE session_id = ?")
        .run(outcome, id);
      if (res.changes === 0) return { ok: false, error: `unknown session: ${id}` };
      if (ctx.sessionId === id) ctx.sessionId = null;

      // Auto-commit storage dir on session close so the session's work
      // always lands in history, even if the coordinator forgets to call
      // commit_phase_gate. No-op if the storage isn't a git repo or if
      // nothing has changed.
      let storageCommit: { commit_sha?: string; reason?: string } | undefined;
      if (isGitRepo(ctx.project.storagePath)) {
        const r = commitStorage(ctx.project.storagePath, `session ${id} ended (${outcome})`);
        storageCommit = { commit_sha: r.commit_sha, reason: r.reason };
      }
      return { ok: true, storage_commit: storageCommit };
    },
  },
  {
    name: "list_sessions",
    description:
      "List sessions, newest first. Filter by state ('active' = not ended, 'ended' = ended, or omit for all).",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string" },
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const state = optString(args, "state");
      const limit = (args.limit as number | undefined) ?? 50;
      let where = "";
      if (state === "active") where = "WHERE ended_at IS NULL";
      else if (state === "ended") where = "WHERE ended_at IS NOT NULL";
      return ctx.db
        .prepare(
          `SELECT session_id, intent, started_at, ended_at, outcome FROM sessions ${where}
             ORDER BY started_at DESC LIMIT ?`,
        )
        .all(limit);
    },
  },
];
