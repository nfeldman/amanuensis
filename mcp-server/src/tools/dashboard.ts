import { OBLIGATION_BEARING_SQL, optInt, type ToolDefinition } from "../helpers.js";
import { ACTIVE_LEDGER_ROW_SQL } from "../invariants.js";
import { outsideSurveySeams, outsideSurveySubsystems, scopeCounts } from "../standing.js";
// One predicate for one question. The open count was derived here from
// `findings.status`, and from `finding_state_current` in every lens, so a
// finding whose resolution event had overtaken its coarse status was open on
// this surface and closed on the others (F9/codex).
import { OPEN_FINDING_SQL } from "../vocabulary.js";

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
      "Return a high-level project overview: project key, canonical branch, SHAs, subsystem counts, open bugs, stale entries, scoped files with how many were examined and how many are still unread candidates, open field notes, unresolved contradictions. The ledger counts are over the survey set: a ledger row on a path the survey leaves out is inactive, counted only as inactive_ledger_rows. excluded_paths counts, by source (gitignore, user, meta), the paths the last reconciliation recorded as excluded: the tree's paths it left out, and any ledgered or evidence-cited path the tree no longer carries that its rules still exclude, whose rows stay inactive (detect_changes's scope.excluded counts the tree's alone) and unsorted_paths the survey paths no sorting row covers; unclassified_paths counts unledgered paths over the survey set. outside_survey names the subsystems whose ledger rows are all on excluded paths, and the seams with an endpoint among them; none of them owes survey work.",
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
                  (SELECT COUNT(*) FILTER (WHERE ${OPEN_FINDING_SQL}) FROM finding_state_current) AS open_bugs,
                  (SELECT COUNT(*) FILTER (WHERE stale=1 AND ${OBLIGATION_BEARING_SQL}) FROM file_ledger) AS stale_entries,
                  (SELECT COUNT(*) FILTER (WHERE stale=1 AND NOT (${OBLIGATION_BEARING_SQL})) FROM file_ledger) AS stale_exempt,
                  (SELECT COUNT(*)                                       FROM file_ledger) AS scoped_files,
                  (SELECT COUNT(*) FILTER (WHERE classification='examined') FROM file_ledger)  AS examined_files,
                  (SELECT COUNT(*) FILTER (WHERE COALESCE(classification, 'candidate')='candidate' AND ${OBLIGATION_BEARING_SQL}) FROM file_ledger) AS unexamined_files,
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
        stale_exempt: number;
        scoped_files: number;
        examined_files: number;
        unexamined_files: number;
        unclassified_paths: number;
        absent_files: number;
        open_field_notes: number;
        unresolved_contradictions: number;
        open_revalidation_obligations: number;
        blocked_revalidation_obligations: number;
        failed_revalidation_runs: number;
      };
      // scoped_files mixes examined, candidate and exempt rows; examined_files
      // and unexamined_files (still 'candidate', carrying the survey
      // obligation) say how much of the scope was read (finding B03-5).
      // stale_entries = 0 is only a health claim when something was actually
      // measured. staleness_measured carries the denominator so a caller cannot
      // read an empty ledger as a fresh conspectus (finding B03-2).
      // A ledger row on a path the survey leaves out is inactive (§2.6a): counted once as
      // inactive_ledger_rows, and taken out of every ledger quantity above.
      const inactive = ctx.db
        .prepare(
          `SELECT COUNT(*) AS rows,
                  COUNT(*) FILTER (WHERE stale=1 AND ${OBLIGATION_BEARING_SQL}) AS stale_entries,
                  COUNT(*) FILTER (WHERE stale=1 AND NOT (${OBLIGATION_BEARING_SQL})) AS stale_exempt,
                  COUNT(*) FILTER (WHERE classification='examined') AS examined_files,
                  COUNT(*) FILTER (WHERE COALESCE(classification, 'candidate')='candidate' AND ${OBLIGATION_BEARING_SQL}) AS unexamined_files
             FROM file_ledger WHERE NOT (${ACTIVE_LEDGER_ROW_SQL})`,
        )
        .get() as {
        rows: number;
        stale_entries: number;
        stale_exempt: number;
        examined_files: number;
        unexamined_files: number;
      };
      row.scoped_files -= inactive.rows;
      row.stale_entries -= inactive.stale_entries;
      row.stale_exempt -= inactive.stale_exempt;
      row.examined_files -= inactive.examined_files;
      row.unexamined_files -= inactive.unexamined_files;
      const scope = scopeCounts(ctx.db);
      const outsideSubsystems = outsideSurveySubsystems(ctx.db);
      return {
        project_key: ctx.project.projectKey,
        ...row,
        staleness_measured: row.scoped_files > 0,
        inactive_ledger_rows: inactive.rows,
        excluded_paths: scope.excluded,
        unsorted_paths: scope.unsorted,
        outside_survey: {
          subsystems: outsideSubsystems,
          seams: outsideSurveySeams(ctx.db, outsideSubsystems),
        },
      };
    },
  },
];
