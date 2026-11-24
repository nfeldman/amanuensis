/**
 * The survey-scope tools (design/scope/PLAN.md §2.4): the owner's rules, onboarding's
 * sorting of the tree into product and meta, and a read-back of what decides a path.
 *
 * The rows are append-only (§2.1): a rule or sorting row is withdrawn by a later row that
 * names it in `supersedes`. Resolution itself lives in `src/scope.ts`; these tools record
 * its inputs and report what it now decides, at the last reconciled revision. Recording a
 * row does not reconcile: the caller runs `detect_changes` for that.
 */

import { type DB, readScopeMode, type ScopeMode } from "../db.js";
import {
  ok,
  optInt,
  optString,
  requireEnum,
  requireEvidenceCitation,
  requireString,
  requireWorkspaceSourcePath,
  resolveWorkspaceCommit,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";
import {
  activeRows,
  decidePath,
  gitignoredPaths,
  listTreeEntries,
  matchesPattern,
  normalizePattern,
  resolveScope,
  ScopePatternError,
  type ScopeRuleRow,
  type ScopeSortingRow,
} from "../scope.js";

const ACTIONS = ["exclude", "include"] as const;
const CATEGORIES = ["product", "meta"] as const;

/** How many paths a response lists before it gives only the count. */
const PATH_CAP = 50;

type RuleRow = ScopeRuleRow & {
  reason: string;
  owner_words: string;
  session_id: string | null;
  recorded_at: string;
};
type SortingRow = ScopeSortingRow & {
  description: string;
  session_id: string | null;
  recorded_at: string;
};

function scopeRows(db: DB): { rules: RuleRow[]; sorting: SortingRow[]; mode: ScopeMode } {
  return {
    rules: db.prepare("SELECT * FROM scope_rules ORDER BY id").all() as RuleRow[],
    sorting: db.prepare("SELECT * FROM scope_sorting ORDER BY id").all() as SortingRow[],
    mode: readScopeMode(db),
  };
}

/** §2.2's normal form, or the refusal that names why the pattern is not one. */
function scopePattern(tool: string, args: Record<string, unknown>): string {
  const raw = requireString(args, "pattern");
  try {
    return normalizePattern(raw);
  } catch (error) {
    if (!(error instanceof ScopePatternError)) throw error;
    throw new ToolError(
      `${tool} refuses: the pattern ${JSON.stringify(raw)} is not one a scope row can hold: ` +
        `${error.message}. Give an exact path, a directory prefix ending in / or a glob, ` +
        "relative to the repository root",
      "scope.pattern",
    );
  }
}

/** The row `supersedes` names, which must exist and still be active. */
function requireSupersedable(
  tool: string,
  db: DB,
  table: "scope_rules" | "scope_sorting",
  id: number | null,
): void {
  if (id === null) return;
  const noun = table === "scope_rules" ? "scope rule" : "sorting row";
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) {
    throw new ToolError(
      `${tool} refuses: supersedes ${id} names no ${noun} in this store; get_scope lists the ` +
        "active rows and their ids",
      "scope.supersedes-unknown",
    );
  }
  const by = db
    .prepare(`SELECT id FROM ${table} WHERE supersedes = ? ORDER BY id LIMIT 1`)
    .get(id) as { id: number } | undefined;
  if (by) {
    throw new ToolError(
      `${tool} refuses: ${noun} ${id} is already withdrawn by ${noun} ${by.id}; supersede ` +
        `${by.id} instead`,
      "scope.supersedes-withdrawn",
    );
  }
}

type ScopeRevision = { sha: string; from: "requested" | "last reconciliation" | "HEAD" };

/**
 * The revision a scope answer is taken at: the one asked for, else the last reconciled
 * revision, else HEAD while the store has no reconciliation (as during Phase 0b, before
 * its first `detect_changes`).
 */
function scopeRevision(ctx: ServerContext, requested: string | null): ScopeRevision {
  if (requested !== null) {
    return { sha: resolveWorkspaceCommit(ctx, requested, "revision"), from: "requested" };
  }
  const last = ctx.db
    .prepare("SELECT detected_sha FROM scope_reconciliations ORDER BY id DESC LIMIT 1")
    .get() as { detected_sha: string } | undefined;
  if (last) return { sha: last.detected_sha, from: "last reconciliation" };
  return { sha: resolveWorkspaceCommit(ctx, "HEAD", "revision"), from: "HEAD" };
}

/** The tree at `revision` and which of its paths the revision's own ignore files match. */
function treeAt(ctx: ServerContext, revision: string): { paths: string[]; ignored: Set<string> } {
  const workspace = ctx.project.workspacePath;
  if (!workspace) throw new ToolError("no workspace is bound, so the tree cannot be read");
  const entries = listTreeEntries(workspace, revision);
  return {
    paths: entries.map((entry) => entry.path),
    ignored: gitignoredPaths(workspace, entries),
  };
}

const capped = (paths: readonly string[]) => paths.slice(0, PATH_CAP);

/**
 * The paths a just-recorded row now decides at the last reconciled revision: those whose
 * deciding rule or sorting row it is, under §2.2's precedence and every active row. A
 * failure to read the tree does not undo the recorded row; it is reported in place of
 * the paths.
 */
function covers(ctx: ServerContext, kind: "rule" | "sorting", id: number) {
  let revision: ScopeRevision;
  try {
    revision = scopeRevision(ctx, null);
  } catch (error) {
    return { revision: null, unavailable: (error as Error).message };
  }
  try {
    const { paths, ignored } = treeAt(ctx, revision.sha);
    const { rules, sorting, mode } = scopeRows(ctx.db);
    const decided = paths
      .filter((path) => {
        const by = decidePath(path, {
          rules,
          sorting,
          mode,
          ignored: ignored.has(path),
        }).decided_by;
        return by !== null && by.kind === kind && by.id === id;
      })
      .sort();
    return {
      revision: revision.sha,
      revision_from: revision.from,
      count: decided.length,
      paths: capped(decided),
    };
  } catch (error) {
    return {
      revision: revision.sha,
      revision_from: revision.from,
      unavailable: (error as Error).message,
    };
  }
}

const RECONCILE_NEXT =
  "Run detect_changes: the survey set changes only when a reconciliation is taken, and a " +
  "reconciliation recorded before this row does not account for it.";

type InventoryItem = { file_path: string; line_range: string; excerpt: string };

/** The inventory's citations, each under `pattern` and checked as add_evidence checks one. */
function requireInventory(
  ctx: ServerContext,
  pattern: string,
  category: (typeof CATEGORIES)[number],
  raw: unknown,
  revision: string,
): InventoryItem[] {
  if (raw != null && !Array.isArray(raw)) {
    throw new ToolError("expected an array for inventory", "arg.type");
  }
  const items = (raw ?? []) as unknown[];
  if (category === "meta" && items.length === 0) {
    throw new ToolError(
      `record_scope_sorting refuses: a meta row needs an inventory. Cite at least one file ` +
        `under ${pattern} with a line_range and an excerpt, as proof the folder was opened`,
      "scope.inventory-required",
    );
  }
  const workspace = ctx.project.workspacePath as string;
  return items.map((value, index) => {
    const item = (value ?? {}) as Record<string, unknown>;
    const filePath = requireWorkspaceSourcePath(item.file_path, `inventory[${index}].file_path`);
    if (!matchesPattern(pattern, filePath)) {
      throw new ToolError(
        `record_scope_sorting refuses: inventory[${index}] cites ${filePath}, which is outside ` +
          `the pattern ${pattern}; cite a file the row covers`,
        "scope.inventory-outside",
      );
    }
    const lineRange = typeof item.line_range === "string" ? item.line_range.trim() : "";
    const excerpt = typeof item.excerpt === "string" ? item.excerpt : "";
    if (lineRange.length === 0 || excerpt.trim().length === 0) {
      throw new ToolError(
        `record_scope_sorting refuses: inventory[${index}] needs both a line_range and an ` +
          "excerpt; open the file and quote lines from it",
        "scope.inventory-citation",
      );
    }
    let normalized: string | null;
    try {
      normalized = requireEvidenceCitation(workspace, revision, filePath, lineRange, excerpt);
    } catch (error) {
      if (!(error instanceof ToolError)) throw error;
      throw new ToolError(`inventory[${index}]: ${error.message}`, error.rule);
    }
    return { file_path: filePath, line_range: normalized ?? lineRange, excerpt };
  });
}

function describeDecider(
  decided: ReturnType<typeof decidePath>["decided_by"],
  rules: readonly RuleRow[],
  sorting: readonly SortingRow[],
) {
  if (decided === null) return null;
  if (decided.kind === "gitignore") return { kind: "gitignore" as const };
  if (decided.kind === "rule") {
    const rule = rules.find((row) => row.id === decided.id);
    return {
      kind: "rule" as const,
      id: decided.id,
      pattern: rule?.pattern,
      action: decided.action,
      reason: rule?.reason,
      owner_words: rule?.owner_words,
    };
  }
  const row = sorting.find((candidate) => candidate.id === decided.id);
  return {
    kind: "sorting" as const,
    id: decided.id,
    pattern: row?.pattern,
    category: decided.category,
    description: row?.description,
  };
}

function pathAccount(decision: ReturnType<typeof decidePath>, inTree: boolean): string {
  const where = inTree ? "" : " It is not in the tree at this revision.";
  const by = decision.decided_by;
  if (by === null) {
    return decision.unsorted
      ? `No rule or sorting row covers this path, so it is in the survey set and unsorted.${where}`
      : `No rule or sorting row covers this path, so it is in the survey set.${where}`;
  }
  if (by.kind === "gitignore") {
    return `The repository's own ignore files match this path at this revision, so it is outside the survey set.${where}`;
  }
  if (by.kind === "rule") {
    return by.action === "include"
      ? `Owner rule ${by.id} includes this path${decision.unsorted ? "; no sorting row covers it, so it is unsorted" : ""}.${where}`
      : `Owner rule ${by.id} excludes this path.${where}`;
  }
  return by.category === "meta"
    ? `Sorting row ${by.id} sorts this path as meta, so it is outside the survey set.${where}`
    : `Sorting row ${by.id} sorts this path as product.${where}`;
}

/** The last reconciliation's own record of the survey set; null counts on a row that predates it. */
function lastReconciliation(db: DB) {
  const row = db
    .prepare(
      `SELECT id, detected_sha, detected_at, scope_digest, scope_mode, survey_paths, excluded,
              unsorted
         FROM scope_reconciliations ORDER BY id DESC LIMIT 1`,
    )
    .get() as
    | {
        id: number;
        detected_sha: string;
        detected_at: string;
        scope_digest: string | null;
        scope_mode: ScopeMode | null;
        survey_paths: number | null;
        excluded: number | null;
        unsorted: number | null;
      }
    | undefined;
  if (!row) return null;
  const base = { id: row.id, detected_sha: row.detected_sha, detected_at: row.detected_at };
  if (row.scope_digest === null) return { ...base, scope: null };
  const bySource = { gitignore: 0, user: 0, meta: 0 };
  for (const { source, n } of db
    .prepare(
      "SELECT source, COUNT(*) AS n FROM scope_exclusions WHERE reconciliation_id = ? GROUP BY source",
    )
    .all(row.id) as Array<{ source: keyof typeof bySource; n: number }>) {
    bySource[source] = n;
  }
  return {
    ...base,
    scope: {
      mode: row.scope_mode,
      survey_paths: row.survey_paths,
      excluded: bySource,
      unsorted: row.unsorted,
    },
  };
}

export const scopeTools: ToolDefinition[] = [
  {
    name: "set_scope_rule",
    description:
      "Record one of the owner's survey-scope rules: exclude a path from the survey, or include " +
      "one back from what the repository's ignore files or onboarding's meta sorting leave out. " +
      "The pattern is an exact path, a directory prefix ending in / (design/ covers everything " +
      "under it) or a glob (* within one segment, ** across segments). Call this only when the " +
      "owner has asked, and quote the owner's own words that asked for it in owner_words; a rule " +
      "without them is refused. The owner's rules win over gitignore and sorting; between two of " +
      "them the more specific pattern decides, and the later one breaks a tie. A rule is " +
      "withdrawn by a later rule that names it in supersedes. Returns the paths the rule now " +
      "decides at the last reconciled revision (the count and up to 50 paths) and a reminder to " +
      "run detect_changes, since a reconciliation recorded before the rule does not account for it.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        action: { type: "string", enum: [...ACTIONS] },
        reason: { type: "string" },
        owner_words: {
          type: "string",
          description: "The owner's words that asked for this rule, quoted.",
        },
        supersedes: { type: "integer", description: "The id of the rule this one withdraws." },
      },
      required: ["pattern", "action", "reason", "owner_words"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "set_scope_rule");
      const pattern = scopePattern("set_scope_rule", args);
      const action = requireEnum(args, "action", ACTIONS);
      const reason = requireString(args, "reason");
      const ownerWords = optString(args, "owner_words");
      if (ownerWords === null || ownerWords.trim().length === 0) {
        throw new ToolError(
          "set_scope_rule refuses: owner_words is empty. A scope rule records what the owner " +
            "asked for: quote the owner's own words that asked for it, and record no rule the " +
            "owner did not ask for",
          "scope.owner-words-required",
        );
      }
      const supersedes = optInt(args, "supersedes");
      const id = ctx.db.transaction(() => {
        requireSupersedable("set_scope_rule", ctx.db, "scope_rules", supersedes);
        return Number(
          ctx.db
            .prepare(
              `INSERT INTO scope_rules (pattern, action, reason, owner_words, supersedes, session_id)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(pattern, action, reason, ownerWords, supersedes, ctx.sessionId).lastInsertRowid,
        );
      })();
      return ok({
        id,
        pattern,
        action,
        supersedes,
        covers: covers(ctx, "rule", id),
        next: RECONCILE_NEXT,
      });
    },
  },
  {
    name: "record_scope_sorting",
    description:
      "Record onboarding's sorting of a path, directory prefix or glob as product or meta. " +
      "Product is code or material relevant to code (tests, fixtures, build, CI, configuration, " +
      "documentation that ships or describes use), and the survey covers it. Meta is material " +
      "about the project rather than part of it (plans, specs and reviews of past work, " +
      "research, recorded evidence, notes), and the survey leaves it out. A meta row needs an " +
      "inventory: at least one {file_path, line_range, excerpt} citation of a file under its " +
      "pattern, checked against the last reconciled revision (HEAD before the first " +
      "reconciliation) as add_evidence checks a citation. Inventory citations are kept apart " +
      "from evidence: they never support a claim and no page prints them. They are accepted even " +
      "when the path is already excluded. The most specific sorting row decides a path, and the " +
      "later one breaks a tie; a row is withdrawn by a later row that names it in supersedes. In " +
      "a legacy store, the first sorting row moves the store to sorted mode, where a survey path " +
      "no sorting row covers counts as unsorted. Returns the paths the row now decides at the " +
      "last reconciled revision and a reminder to run detect_changes.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        category: { type: "string", enum: [...CATEGORIES] },
        description: { type: "string", description: "One line: what is there." },
        inventory: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file_path: { type: "string" },
              line_range: { type: "string" },
              excerpt: { type: "string" },
            },
            required: ["file_path", "line_range", "excerpt"],
            additionalProperties: false,
          },
        },
        supersedes: {
          type: "integer",
          description: "The id of the sorting row this one withdraws.",
        },
      },
      required: ["pattern", "category", "description"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "record_scope_sorting");
      const pattern = scopePattern("record_scope_sorting", args);
      const category = requireEnum(args, "category", CATEGORIES);
      const description = requireString(args, "description");
      const supersedes = optInt(args, "supersedes");
      const raw = args.inventory;
      const revision =
        raw == null || (Array.isArray(raw) && raw.length === 0)
          ? null
          : scopeRevision(ctx, null).sha;
      const inventory = requireInventory(ctx, pattern, category, raw, revision ?? "");
      const written = ctx.db.transaction(() => {
        requireSupersedable("record_scope_sorting", ctx.db, "scope_sorting", supersedes);
        const before = readScopeMode(ctx.db);
        const id = Number(
          ctx.db
            .prepare(
              `INSERT INTO scope_sorting (pattern, category, description, supersedes, session_id)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .run(pattern, category, description, supersedes, ctx.sessionId).lastInsertRowid,
        );
        const insert = ctx.db.prepare(
          `INSERT INTO scope_inventory (sorting_id, file_path, line_range, excerpt, ref_sha)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const item of inventory) {
          insert.run(id, item.file_path, item.line_range, item.excerpt, revision);
        }
        if (before !== "legacy") return { id, modeChange: null };
        const change = Number(
          ctx.db
            .prepare("INSERT INTO scope_mode_changes (mode, reason) VALUES ('sorted', ?)")
            .run(`sorting row ${id} was the first recorded in this legacy store`).lastInsertRowid,
        );
        return { id, modeChange: change };
      })();
      return ok({
        id: written.id,
        pattern,
        category,
        supersedes,
        inventory: inventory.length,
        ...(revision === null ? {} : { ref_sha: revision }),
        ...(written.modeChange === null
          ? {}
          : {
              mode_change: {
                from: "legacy",
                to: "sorted",
                id: written.modeChange,
                message:
                  "This store was surveyed before sorting existed (legacy mode). Its first " +
                  "sorting row moved it to sorted mode: from the next reconciliation on, every " +
                  "survey path needs a sorting row, and a path none covers counts as unsorted " +
                  "and blocks publication.",
              },
            }),
        covers: covers(ctx, "sorting", written.id),
        next: RECONCILE_NEXT,
      });
    },
  },
  {
    name: "get_scope",
    description:
      "Read-only. The store's survey-scope mode (sorted, or legacy for a store surveyed before " +
      "sorting existed), the active owner rules and sorting rows, the last reconciliation's " +
      "recorded counts, and the survey set resolved under the active rows at revision (default: " +
      "the last reconciled revision, else HEAD): its size, the excluded paths by source " +
      "(gitignore, user, meta) and the unsorted paths (the count and up to 50). With path, " +
      "names the owner rule, sorting row or gitignore match that decides that path, or says " +
      "that nothing does.",
    inputSchema: {
      type: "object",
      properties: {
        revision: { type: "string" },
        path: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const requested = optString(args, "revision");
      const path = args.path == null ? null : requireWorkspaceSourcePath(args.path, "path");
      const { rules, sorting, mode } = scopeRows(ctx.db);
      const inventoryCounts = new Map(
        (
          ctx.db
            .prepare("SELECT sorting_id, COUNT(*) AS n FROM scope_inventory GROUP BY sorting_id")
            .all() as Array<{ sorting_id: number; n: number }>
        ).map((row) => [row.sorting_id, row.n]),
      );
      const response: Record<string, unknown> = {
        mode,
        rules: activeRows(rules).map((rule) => ({
          id: rule.id,
          pattern: rule.pattern,
          action: rule.action,
          reason: rule.reason,
          owner_words: rule.owner_words,
          supersedes: rule.supersedes,
          recorded_at: rule.recorded_at,
        })),
        sorting: activeRows(sorting).map((row) => ({
          id: row.id,
          pattern: row.pattern,
          category: row.category,
          description: row.description,
          supersedes: row.supersedes,
          inventory: inventoryCounts.get(row.id) ?? 0,
          recorded_at: row.recorded_at,
        })),
        withdrawn: {
          rules: rules.length - activeRows(rules).length,
          sorting: sorting.length - activeRows(sorting).length,
        },
        last_reconciliation: lastReconciliation(ctx.db),
      };

      let revision: ScopeRevision;
      try {
        revision = scopeRevision(ctx, requested);
      } catch (error) {
        if (requested !== null) throw error;
        return ok({ ...response, scope: { unavailable: (error as Error).message } });
      }
      const { paths, ignored } = treeAt(ctx, revision.sha);
      const resolution = resolveScope({ rules, sorting, mode, paths, ignored });
      response.scope = {
        revision: revision.sha,
        revision_from: revision.from,
        survey_paths: resolution.survey.length,
        excluded: resolution.counts,
        unsorted: resolution.unsorted.length,
        unsorted_paths: capped(resolution.unsorted),
      };
      if (path !== null) {
        const inTree = paths.includes(path);
        const decision = decidePath(path, { rules, sorting, mode, ignored: ignored.has(path) });
        response.path = {
          file_path: path,
          in_tree: inTree,
          in_survey: decision.in_survey,
          source: decision.source,
          unsorted: decision.unsorted,
          decided_by: describeDecider(decision.decided_by, rules, sorting),
          account: pathAccount(decision, inTree),
        };
      }
      return ok(response);
    },
  },
];
