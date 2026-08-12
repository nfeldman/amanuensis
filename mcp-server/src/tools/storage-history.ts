import { checkpointDatabaseForStorageCommit } from "../db.js";
import { optInt, requireString, type ToolDefinition, ToolError } from "../helpers.js";
import { requireActiveSession } from "../invariants.js";
import { commitStorage, getStorageLog, isGitRepo } from "../storage-git.js";

export const storageHistoryTools: ToolDefinition[] = [
  {
    name: "commit_phase_gate",
    description:
      "Commit the current state of the storage directory with a label. " +
      "Call at phase boundaries, end of onboarding, or any other moment " +
      "that should be recoverable. Returns the short SHA and whether a " +
      "commit actually happened (no-op if nothing changed since the last " +
      "commit). The label is passed via stdin so special characters are " +
      "never interpreted as args; labels must be single-line ≤500 chars.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Single-line commit message, ≤500 chars" },
      },
      required: ["label"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "commit_phase_gate");
      const label = requireString(args, "label");
      if (!ctx.project.storageGitReady && !isGitRepo(ctx.project.storagePath)) {
        throw new ToolError(
          "storage directory is not a git repo — check server logs for git init failure",
        );
      }
      checkpointDatabaseForStorageCommit(ctx.db);
      const result = commitStorage(ctx.project.storagePath, label);
      if (!result.ok) {
        throw new ToolError(result.reason ?? "commit failed");
      }
      return {
        committed: result.reason === "committed",
        commit_sha: result.commit_sha ?? null,
        reason: result.reason,
      };
    },
  },
  {
    name: "get_storage_history",
    description:
      "List recent commits on the storage directory. Useful for inspecting " +
      "phase-gate history, auditing what changed across a session, or " +
      "picking a rollback target. Returns short SHA, ISO date, and message " +
      "for each commit, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Max commits to return (default 20, cap 500)",
        },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const limit = optInt(args, "limit", 20) ?? 20;
      const log = getStorageLog(ctx.project.storagePath, limit);
      return { is_git_repo: isGitRepo(ctx.project.storagePath), commits: log };
    },
  },
];
