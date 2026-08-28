import { optInt, type ToolDefinition } from "../helpers.js";

export const dashboardTools: ToolDefinition[] = [
  {
    name: "get_hot_subsystems",
    description:
      "Return the most-accessed subsystems over the last 7 days, weighted by recency. Reads from the hot_subsystems view.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const limit = optInt(args, "limit", 5) ?? 5;
      return ctx.db
        .prepare("SELECT entry_id, access_count, last_accessed, heat FROM hot_subsystems LIMIT ?")
        .all(limit);
    },
  },
  {
    name: "get_dashboard",
    description:
      "Return a high-level project overview: project key, canonical branch, SHAs, subsystem counts, open bugs, stale entries, open field notes, unresolved contradictions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, ctx) => {
      // One round-trip: SQLite assembles the per-table counts as
      // scalar subqueries inside a single SELECT. COUNT(*) FILTER (…)
      // collapses what was previously a SUM(CASE WHEN … THEN 1 ELSE 0 END)
      // pattern.
      const row = ctx.db
        .prepare(
          `SELECT (SELECT canonical_branch FROM git_state WHERE repo_id='default') AS canonical_branch,
                  (SELECT onboarding_sha   FROM git_state WHERE repo_id='default') AS onboarding_sha,
                  (SELECT last_checked_sha FROM git_state WHERE repo_id='default') AS last_checked_sha,
                  (SELECT COUNT(*)                                       FROM subsystems)      AS subsystem_count,
                  (SELECT COUNT(*) FILTER (WHERE status='mapped')        FROM subsystems)      AS mapped_count,
                  (SELECT COUNT(*)                                       FROM findings)        AS total_findings,
                  (SELECT COUNT(*) FILTER (WHERE status='confirmed-bug') FROM findings)        AS open_bugs,
                  (SELECT COUNT(*) FILTER (WHERE stale=1)                FROM file_ledger)     AS stale_entries,
                  (SELECT COUNT(*)                                       FROM file_ledger)     AS scoped_files,
                  (SELECT COUNT(*) FILTER (WHERE kind='unledgered')      FROM scope_gaps)      AS unclassified_paths,
                  (SELECT COUNT(*) FILTER (WHERE kind='absent')          FROM scope_gaps)      AS absent_files,
                  (SELECT COUNT(*) FILTER (WHERE follow_up='open')       FROM field_notes)     AS open_field_notes,
                  (SELECT COUNT(*) FILTER (WHERE resolution='unresolved') FROM contradictions) AS unresolved_contradictions,
                  (SELECT open FROM revalidation_dashboard) AS open_revalidation_obligations,
                  (SELECT blocked FROM revalidation_dashboard) AS blocked_revalidation_obligations,
                  (SELECT COUNT(*) FROM revalidation_runs WHERE status='failed') AS failed_revalidation_runs`,
        )
        .get() as {
        canonical_branch: string | null;
        onboarding_sha: string | null;
        last_checked_sha: string | null;
        subsystem_count: number;
        mapped_count: number;
        total_findings: number;
        open_bugs: number;
        stale_entries: number;
        scoped_files: number;
        unclassified_paths: number;
        absent_files: number;
        open_field_notes: number;
        unresolved_contradictions: number;
        open_revalidation_obligations: number;
        blocked_revalidation_obligations: number;
        failed_revalidation_runs: number;
      };
      // stale_entries = 0 is only a health claim when something was actually
      // measured. staleness_measured carries the denominator so a caller cannot
      // read an empty ledger as a fresh conspectus (finding B03-2).
      return {
        project_key: ctx.project.projectKey,
        ...row,
        staleness_measured: row.scoped_files > 0,
      };
    },
  },
];
