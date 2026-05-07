import { execFileSync } from "node:child_process";
import type { ServerContext } from "../helpers.js";
import {
  nowIso,
  ok,
  optString,
  optStringArray,
  requireString,
  type ToolDefinition,
} from "../helpers.js";

function getGit(ctx: ServerContext): {
  canonical_branch: string;
  branch_convention: string | null;
  last_checked_sha: string | null;
  last_checked_at: string | null;
  onboarding_sha: string;
  detected_branches: string | null;
} | null {
  const row = ctx.db
    .prepare(
      "SELECT canonical_branch, branch_convention, last_checked_sha, last_checked_at, onboarding_sha, detected_branches FROM git_state WHERE repo_id = 'default'",
    )
    .get() as
    | {
        canonical_branch: string;
        branch_convention: string | null;
        last_checked_sha: string | null;
        last_checked_at: string | null;
        onboarding_sha: string;
        detected_branches: string | null;
      }
    | undefined;
  return row ?? null;
}

function runGit(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
      .toString()
      .trim();
  } catch (e) {
    // execFileSync stashes the captured streams on the thrown error.
    // Surface stderr so callers see "fatal: not a git repository"
    // rather than a bare exit code.
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer | string };
    const stderr = err.stderr?.toString().trim();
    throw new Error(stderr ? `git ${args.join(" ")}: ${stderr}` : err.message);
  }
}

export const gitTools: ToolDefinition[] = [
  {
    name: "get_git_state",
    description:
      "Return the stored git baseline (canonical branch, onboarding SHA, last-checked SHA, detected branches).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, ctx) => {
      const g = getGit(ctx);
      if (!g) return null;
      return {
        ...g,
        detected_branches: g.detected_branches ? JSON.parse(g.detected_branches) : [],
      };
    },
  },
  {
    name: "set_git_state",
    description:
      "Create or update the git baseline. On first call, onboarding_sha and canonical_branch are required. Subsequent calls may update any subset of fields. detected_branches is an array; stored as JSON.",
    inputSchema: {
      type: "object",
      properties: {
        canonical_branch: { type: "string" },
        branch_convention: { type: "string" },
        last_checked_sha: { type: "string" },
        onboarding_sha: { type: "string" },
        detected_branches: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const existing = getGit(ctx);
      const canonical = optString(args, "canonical_branch") ?? existing?.canonical_branch;
      const onboardingSha = optString(args, "onboarding_sha") ?? existing?.onboarding_sha;
      if (!canonical || !onboardingSha) {
        return {
          ok: false,
          error: "first set_git_state call must include canonical_branch and onboarding_sha",
        };
      }
      const branchConvention =
        optString(args, "branch_convention") ?? existing?.branch_convention ?? null;
      const lastCheckedSha =
        optString(args, "last_checked_sha") ?? existing?.last_checked_sha ?? null;
      const lastCheckedAt = args.last_checked_sha ? nowIso() : (existing?.last_checked_at ?? null);
      const detected = optStringArray(args, "detected_branches");
      const detectedJson = detected
        ? JSON.stringify(detected)
        : (existing?.detected_branches ?? null);

      if (existing) {
        ctx.db
          .prepare(
            `UPDATE git_state SET canonical_branch=?, branch_convention=?, last_checked_sha=?, last_checked_at=?, onboarding_sha=?, detected_branches=? WHERE repo_id='default'`,
          )
          .run(
            canonical,
            branchConvention,
            lastCheckedSha,
            lastCheckedAt,
            onboardingSha,
            detectedJson,
          );
      } else {
        ctx.db
          .prepare(
            `INSERT INTO git_state (repo_id, canonical_branch, branch_convention, last_checked_sha, last_checked_at, onboarding_sha, detected_branches) VALUES ('default', ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            canonical,
            branchConvention,
            lastCheckedSha,
            lastCheckedAt,
            onboardingSha,
            detectedJson,
          );
      }
      return ok();
    },
  },
  {
    name: "detect_changes",
    description:
      "Compare current_sha against last_checked_sha for files tracked in the file_ledger. Marks affected entries stale and updates last_checked_sha. Requires the target workspace to be a git repo the server can shell out to.",
    inputSchema: {
      type: "object",
      properties: { current_sha: { type: "string" } },
      required: ["current_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const currentSha = requireString(args, "current_sha");
      const g = getGit(ctx);
      if (!g) return { ok: false, error: "git_state not initialized; call set_git_state first" };
      const lastSha = g.last_checked_sha ?? g.onboarding_sha;
      let changedFiles: string[] = [];
      try {
        const out = runGit(ctx.project.workspacePath, [
          "diff",
          "--name-only",
          `${lastSha}..${currentSha}`,
        ]);
        changedFiles = out.split("\n").filter(Boolean);
      } catch (e) {
        return {
          ok: false,
          error: `git diff failed: ${(e as Error).message}. Is the workspace a git repo?`,
        };
      }

      // Map changed files → affected subsystems.
      const bySubsystem = new Map<string, { files: Set<string>; commits: number }>();
      if (changedFiles.length) {
        const placeholders = changedFiles.map(() => "?").join(",");
        const rows = ctx.db
          .prepare(
            `SELECT subsystem_id, file_path FROM file_ledger WHERE file_path IN (${placeholders})`,
          )
          .all(...changedFiles) as { subsystem_id: string; file_path: string }[];
        for (const r of rows) {
          if (!bySubsystem.has(r.subsystem_id)) {
            bySubsystem.set(r.subsystem_id, { files: new Set(), commits: 0 });
          }
          bySubsystem.get(r.subsystem_id)?.files.add(r.file_path);
        }
      }

      // Commit count between SHAs.
      let commitCount = 0;
      try {
        const out = runGit(ctx.project.workspacePath, [
          "rev-list",
          "--count",
          `${lastSha}..${currentSha}`,
        ]);
        commitCount = parseInt(out, 10) || 0;
      } catch {
        commitCount = 0;
      }

      // Mark affected entries stale.
      const staleTx = ctx.db.transaction(() => {
        for (const subsystemId of bySubsystem.keys()) {
          ctx.db
            .prepare(
              `UPDATE entries SET stale=1, stale_since=datetime('now'), stale_reason='git-drift' WHERE subsystem_id=? AND stale=0`,
            )
            .run(subsystemId);
        }
        ctx.db
          .prepare(
            `UPDATE git_state SET last_checked_sha=?, last_checked_at=datetime('now') WHERE repo_id='default'`,
          )
          .run(currentSha);
      });
      staleTx();

      const stale_subsystems = Array.from(bySubsystem.entries()).map(([subsystem_id, v]) => ({
        subsystem_id,
        changed_files: Array.from(v.files),
        commit_count: commitCount,
      }));
      return {
        stale_subsystems,
        stale_count: stale_subsystems.length,
        total_changed_files: changedFiles.length,
      };
    },
  },
];
