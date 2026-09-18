import { execFileSync } from "node:child_process";
import type { ServerContext } from "../helpers.js";
import {
  nowIso,
  OBLIGATION_EXEMPT_CLASSIFICATIONS,
  ok,
  optString,
  optStringArray,
  requireString,
  resolveWorkspaceCommits,
  type ToolDefinition,
} from "../helpers.js";
// §3's reconciliation record shares one derivation with the predicate that
// reads it back. Two copies of "the digest of the tracked path set" would
// disagree the first time either was edited, and the disagreement would present
// as a store that reconciles and is never reconciled.
import { ledgerDigest, listTrackedPaths, trackedPathDigest } from "../invariants.js";
// The reconciliation's three outcomes are named by the enum source, not by a
// literal beside each `markStale` call. Typing the writer's argument is what
// makes the compiler refuse a value the source does not carry: `git-driftt`
// was reachable here and no gate could see it (F4/codex, F2/codex).
import type { StaleReason } from "../vocabulary.js";

/**
 * The `stale_reason` for one reconciliation outcome. `StaleReason` is
 * `(typeof STALE_REASONS)[number]` from the generated module, so a value the
 * vocabulary source does not carry stops compiling at the call site instead of
 * landing in the ledger — which is what `git-driftt` did, invisibly to every
 * gate, until F4/codex and F2/codex found it by mutation.
 */
function staleReason(value: StaleReason): StaleReason {
  return value;
}

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

/**
 * How many duplicately owned paths one reconciliation names before it stops
 * enumerating. The count beside it keeps the scale visible; `file_standing`
 * holds the rest. A store whose ledger overlaps wholesale would otherwise put
 * the response's size in the ledger's size.
 */
const NAMED_DUPLICATE_PATHS = 25;

function carriesObligation(row: { classification: string | null }): boolean {
  const value = (row.classification ??
    "candidate") as (typeof OBLIGATION_EXEMPT_CLASSIFICATIONS)[number];
  return !OBLIGATION_EXEMPT_CLASSIFICATIONS.includes(value);
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
      "Reconcile the file_ledger against the tree at current_sha: mark drifted and absent entries stale, rewrite scope_gaps, update last_checked_sha, and record the reading as one append-only scope_reconciliations row carrying its counts and two witness digests. The advance to 'mapped' and materialize_docs both refuse a store with no standing reconciliation. Requires the target workspace to be a git repo the server can shell out to.",
    inputSchema: {
      type: "object",
      properties: { current_sha: { type: "string" } },
      required: ["current_sha"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const requestedSha = requireString(args, "current_sha");
      const g = getGit(ctx);
      if (!g) return { ok: false, error: "git_state not initialized; call set_git_state first" };
      // §3.3 clause 1: the revision is resolved to the full 40-hex commit it
      // names before anything is compared or stored. An abbreviation, a tag or
      // a branch name is a different string from the id a later comparison
      // holds, and string-matching the two is how a reconciliation at one
      // revision comes to satisfy a publication at another.
      const currentSha =
        resolveWorkspaceCommits(ctx.project.workspacePath, [requestedSha]).get(requestedSha) ??
        null;
      if (currentSha === null) {
        return {
          ok: false,
          error:
            `current_sha ${requestedSha} does not resolve to a commit in the bound workspace ` +
            `${ctx.project.workspacePath}; a reconciliation is stamped with the revision it was ` +
            `taken at, so the revision has to exist`,
        };
      }
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

      // Reconcile the ledger against the tree at `currentSha`. Intersecting the
      // commit diff with existing rows (above) can only ever see files someone
      // already classified: additions match no row and drop out, and rows whose
      // file was deleted keep asserting they were examined. Both halves of that
      // gap are finding B03-1, so the tree itself is the reference here, not the
      // diff.
      //
      // The tree at the revision, never `git ls-files`. That reads the index —
      // the working tree's staged state, which moves under an unrelated
      // `git add` and does not describe the revision at all, while every count
      // written below is stamped with it (§3.3).
      const trackedPaths = listTrackedPaths(ctx.project.workspacePath, currentSha);
      if (trackedPaths === null) {
        return {
          ok: false,
          error:
            `git ls-tree -r --name-only ${currentSha} failed. Is the workspace a git repo the ` +
            `server can read?`,
        };
      }
      const trackedSet = new Set(trackedPaths);
      const ledgerRows = ctx.db
        .prepare("SELECT subsystem_id, file_path, ref_sha, classification FROM file_ledger")
        .all() as {
        subsystem_id: string;
        file_path: string;
        ref_sha: string | null;
        classification: string | null;
      }[];
      const ledgerPaths = new Set(ledgerRows.map((r) => r.file_path));

      const unledgered = trackedPaths.filter((p) => !ledgerPaths.has(p));
      const absent = ledgerRows.filter((r) => !trackedSet.has(r.file_path));
      // `exempt` is the third part of the tracked set: paths the ledger carries
      // and that carry no survey obligation. Counted over distinct paths,
      // because it is one side of the tracked-set intersection §3.2 records and
      // not a count of rows.
      const exemptPaths = new Set(
        ledgerRows
          .filter((row) => trackedSet.has(row.file_path) && !carriesObligation(row))
          .map((row) => row.file_path),
      );

      // One path owned by two subsystems is neither unledgered nor absent, so
      // neither `scope_gaps` kind records it and a reconciliation silent about
      // it is a reading that did not report its own ambiguity — the AxiomDB
      // store holds it for 53 of its 187 distinct ledger paths. Reported rather
      // than refused: which subsystem should own a shared path is a coordinator
      // judgement, not a server one. The list is capped and the count is kept,
      // so a wholesale overlap is visible without putting a reconciliation's
      // response size in the ledger's size.
      const ownersByPath = new Map<string, string[]>();
      for (const row of ledgerRows) {
        const owners = ownersByPath.get(row.file_path);
        if (owners) owners.push(row.subsystem_id);
        else ownersByPath.set(row.file_path, [row.subsystem_id]);
      }
      const duplicateOwnership = [...ownersByPath.entries()]
        .filter(([, owners]) => owners.length > 1)
        .map(([file_path, owners]) => ({ file_path, subsystem_ids: [...owners].sort() }))
        .sort((a, b) => (a.file_path < b.file_path ? -1 : 1));

      // A ledger row is stale when its content differs from the commit at which
      // it was examined — a claim about content, not about which paths happen to
      // appear in the range being inspected. Deciding it from the moving
      // lastSha..currentSha window cannot self-correct: a file marked stale in
      // one window and restored in the next stays flagged forever, because
      // nothing lowers the flag except clear_staleness (finding B03-4).
      //
      // Rows are grouped by their examination commit so this costs one git call
      // per distinct ref_sha rather than one per file.
      const byRefSha = new Map<string, typeof ledgerRows>();
      for (const row of ledgerRows) {
        if (!trackedSet.has(row.file_path) || !row.ref_sha) continue;
        const group = byRefSha.get(row.ref_sha);
        if (group) group.push(row);
        else byRefSha.set(row.ref_sha, [row]);
      }
      const drifted: typeof ledgerRows = [];
      const unverifiable: typeof ledgerRows = [];
      const fresh: typeof ledgerRows = [];
      for (const [refSha, rows] of byRefSha) {
        let changedSinceExamination: Set<string>;
        try {
          changedSinceExamination = new Set(
            runGit(ctx.project.workspacePath, ["diff", "--name-only", refSha, currentSha])
              .split("\n")
              .filter(Boolean),
          );
        } catch {
          // An examination commit that is no longer reachable cannot be
          // compared against. Treat those rows as unverified rather than
          // silently fresh, and say so in the reason.
          unverifiable.push(...rows);
          continue;
        }
        for (const row of rows) {
          if (changedSinceExamination.has(row.file_path)) drifted.push(row);
          else fresh.push(row);
        }
      }

      let reconciliationId = 0;
      let treeDigest = "";
      let recordedLedgerDigest = "";
      const reconcileTx = ctx.db.transaction(() => {
        const markStale = ctx.db.prepare(
          `UPDATE file_ledger SET stale=1, stale_since=datetime('now'), stale_reason=?
             WHERE subsystem_id=? AND file_path=? AND stale=0`,
        );
        const mark = (rows: typeof ledgerRows, reason: StaleReason) => {
          for (const row of rows) markStale.run(reason, row.subsystem_id, row.file_path);
        };
        mark(drifted, staleReason("git-drift"));
        mark(absent, staleReason("absent"));
        mark(unverifiable, staleReason("unverifiable-ref"));
        // Staleness is re-derived in both directions. A row whose content
        // matches its examination commit again is fresh by the same rule that
        // made it stale, so leaving it flagged would be churn, not obligation.
        const markFresh = ctx.db.prepare(
          `UPDATE file_ledger SET stale=0, stale_since=NULL, stale_reason=NULL
             WHERE subsystem_id=? AND file_path=? AND stale=1 AND stale_reason IS NOT '${staleReason("absent")}'`,
        );
        for (const row of fresh) markFresh.run(row.subsystem_id, row.file_path);

        // scope_gaps is rebuilt each run: it describes the tree as it is now,
        // not an accumulating log. A path that was classified since the last
        // reconciliation must stop being reported.
        ctx.db.prepare("DELETE FROM scope_gaps").run();
        const gap = ctx.db.prepare(
          `INSERT INTO scope_gaps (file_path, kind, subsystem_id, detected_sha) VALUES (?, ?, ?, ?)`,
        );
        for (const path of unledgered) gap.run(path, "unledgered", null, currentSha);
        // One gap row per absent *path*, not per owner: the table is keyed
        // (file_path, kind), so a path two subsystems claim would collide on the
        // second insert and abort the whole rewrite — no reconciliation written
        // at all, and the store still answering from the last one (F5/codex).
        // Nothing is lost by taking the first owner here, because `mark(absent,
        // …)` above has already flagged every owner's ledger row: the per-owner
        // obligation lives in `file_ledger`, and `scope_gaps` is the countable
        // statement that the path is gone.
        const seenAbsent = new Set<string>();
        for (const row of absent) {
          if (seenAbsent.has(row.file_path)) continue;
          seenAbsent.add(row.file_path);
          gap.run(row.file_path, "absent", row.subsystem_id, currentSha);
        }

        ctx.db
          .prepare(
            `UPDATE git_state SET last_checked_sha=?, last_checked_at=datetime('now') WHERE repo_id='default'`,
          )
          .run(currentSha);

        // The reading itself, one append-only row per invocation, written in the
        // same transaction as the gap rewrite it describes. A perfectly
        // reconciled store has zero `scope_gaps` rows, so the presence of a gap
        // row cannot stand in for the reading: the count zero and the absence of
        // a reading are different facts (VP4(e), §3.2). The two digests are
        // taken here rather than above so they describe the ledger this
        // transaction is committing.
        treeDigest = trackedPathDigest(trackedPaths);
        recordedLedgerDigest = ledgerDigest(ctx.db);
        const written = ctx.db
          .prepare(
            `INSERT INTO scope_reconciliations
               (detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows,
                unledgered, absent, exempt, session_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            currentSha,
            treeDigest,
            recordedLedgerDigest,
            trackedPaths.length,
            ledgerPaths.size,
            unledgered.length,
            absent.length,
            exemptPaths.size,
            ctx.sessionId,
          );
        reconciliationId = Number(written.lastInsertRowid);
      });
      reconcileTx();

      for (const row of absent) {
        if (!bySubsystem.has(row.subsystem_id)) {
          bySubsystem.set(row.subsystem_id, { files: new Set(), commits: 0 });
        }
        bySubsystem.get(row.subsystem_id)?.files.add(row.file_path);
      }

      const staleRows = [...drifted, ...absent, ...unverifiable];
      const stale_subsystems = Array.from(bySubsystem.entries()).map(([subsystem_id, v]) => ({
        subsystem_id,
        changed_files: Array.from(v.files),
        commit_count: commitCount,
      }));
      return {
        stale_subsystems,
        stale_count: stale_subsystems.length,
        total_changed_files: changedFiles.length,
        // The reading's own identity, so a caller can find the row this call
        // wrote rather than guessing which of a store's reconciliations it was.
        reconciliation_id: reconciliationId,
        reconciled_at_sha: currentSha,
        tree_digest: treeDigest,
        ledger_digest: recordedLedgerDigest,
        // Reconciliation denominators travel with the result so a zero finding
        // is readable as "nothing drifted out of this much" rather than as an
        // unqualified all-clear.
        reconciled_tracked_paths: trackedPaths.length,
        reconciled_ledger_rows: ledgerRows.length,
        reconciled_ledger_paths: ledgerPaths.size,
        reconciled_exempt_paths: exemptPaths.size,
        duplicate_ownership_count: duplicateOwnership.length,
        duplicate_ownership: duplicateOwnership.slice(0, NAMED_DUPLICATE_PATHS),
        unledgered_paths: unledgered,
        absent_ledger_paths: absent.map((r) => ({
          subsystem_id: r.subsystem_id,
          file_path: r.file_path,
        })),
        // Split by obligation: drift over generated or vendored files is real
        // but carries no survey work, and folding it into one number would let
        // a republished projection read as the conspectus going stale.
        stale_files: staleRows.filter(carriesObligation).length,
        unverifiable_ref_rows: unverifiable.length,
        stale_exempt_files: staleRows.filter((row) => !carriesObligation(row)).length,
      };
    },
  },
];
