// Searching the code index (PLAN §4.3): `find_symbol`'s definitions and references at one
// revision.
//
// Definitions are BM25 over `symbols_fts` (a name and its qname split on case and punctuation,
// the signature and the doc comment), joined to the revision's tree so only the blobs that
// revision holds answer. References are the extractor's name-matched rows: a place where the
// name appears as an identifier, never resolved, so every row carries `match: "name"`. The
// tree is indexed on first use; until `trees_complete` exists for the revision the answer is
// `partial`, and the next call resumes where the last one stopped.
import type Database from "better-sqlite3";
import { type CodeIndex, identifierWords, type TreeResult, type Unavailable } from "./store.js";

export const FIND_MODES = ["definitions", "references"] as const;
export type FindMode = (typeof FIND_MODES)[number];

export interface FindOptions {
  mode: FindMode;
  kind: string | null;
  pathPrefix: string | null;
  limit: number;
}

export interface DefinitionHit {
  path: string;
  symbol_id: string;
  kind: string;
  start_line: number;
  end_line: number;
  doc_start_line?: number;
  occurrence?: number;
  partial?: true;
  signature: string;
}

export interface ReferenceHit {
  path: string;
  name: string;
  kind: string;
  line: number;
  match: "name";
}

export interface FindResult {
  state: "ok";
  partial: boolean;
  /** Why the tree index is incomplete, when it is. */
  partial_reason?: string;
  results: DefinitionHit[] | ReferenceHit[];
  /** True when more rows matched than `limit` returns. */
  more: boolean;
}

/** BM25 weights for name, qname, signature and doc. */
const DEFINITION_WEIGHTS = "10.0, 5.0, 2.0, 1.0";

/**
 * An FTS5 query from free text: its words split on punctuation and case, each quoted, all
 * required. Null when the text holds no word.
 */
export function matchQuery(text: string): string | null {
  const words = [...new Set(identifierWords(text).map((w) => w.toLowerCase()))];
  if (words.length === 0) return null;
  return words.map((w) => `"${w}"`).join(" ");
}

function partialReason(tree: TreeResult): string {
  if (tree.budget) return `the ${tree.budget.limit} budget (${tree.budget.value}) stopped indexing`;
  if (tree.unavailable > 0) return `${tree.unavailable} file(s) are missing from this clone`;
  return "the tree index is incomplete";
}

/** Index the tree at `commit` unless it is complete; whether it is partial, and why. */
async function ensureTree(
  index: CodeIndex,
  workspace: string,
  commit: string,
): Promise<Unavailable | { partial: boolean; reason?: string }> {
  const status = index.treeStatus(commit);
  if (status.state === "unavailable") return status;
  if (status.complete) return { partial: false };
  const tree = await index.indexTree(workspace, commit);
  if (tree.state === "unavailable") return { state: "unavailable", reason: tree.reason ?? "tree" };
  return tree.partial ? { partial: true, reason: partialReason(tree) } : { partial: false };
}

function definitions(
  db: Database.Database,
  commit: string,
  query: string,
  options: FindOptions,
): { rows: DefinitionHit[]; more: boolean } {
  const rows = db
    .prepare(
      `SELECT t.path, s.symbol_id, s.kind, s.start_line, s.end_line, s.doc_start_line,
              s.occurrence, s.partial, s.signature,
              (SELECT COUNT(*) FROM symbols o
                WHERE o.blob_sha = s.blob_sha AND o.lang = s.lang
                  AND o.symbol_id = s.symbol_id) AS occurrences
         FROM symbols_fts
         JOIN symbols s ON s.id = symbols_fts.rowid
         JOIN trees t ON t.rev = ? AND t.blob_sha = s.blob_sha AND t.lang = s.lang
                     AND t.skip_reason IS NULL
        WHERE symbols_fts MATCH ?
          AND (? IS NULL OR s.kind = ?)
          AND (? IS NULL OR substr(t.path, 1, length(?)) = ?)
        ORDER BY bm25(symbols_fts, ${DEFINITION_WEIGHTS}), t.path, s.ordinal
        LIMIT ?`,
    )
    .all(
      commit,
      query,
      options.kind,
      options.kind,
      options.pathPrefix,
      options.pathPrefix,
      options.pathPrefix,
      options.limit + 1,
    ) as (Omit<DefinitionHit, "partial"> & { partial: number; occurrences: number })[];
  const hits = rows.slice(0, options.limit).map((row) => {
    const hit: DefinitionHit = {
      path: row.path,
      symbol_id: row.symbol_id,
      kind: row.kind,
      start_line: row.start_line,
      end_line: row.end_line,
      signature: row.signature,
    };
    if (row.doc_start_line !== row.start_line) hit.doc_start_line = row.doc_start_line;
    if (row.occurrences > 1) hit.occurrence = row.occurrence;
    if (row.partial === 1) hit.partial = true;
    return hit;
  });
  return { rows: hits, more: rows.length > options.limit };
}

function references(
  db: Database.Database,
  commit: string,
  name: string,
  options: FindOptions,
): { rows: ReferenceHit[]; more: boolean } {
  const rows = db
    .prepare(
      `SELECT t.path, r.name, r.kind, r.line
         FROM refs r
         JOIN trees t ON t.rev = ? AND t.blob_sha = r.blob_sha AND t.lang = r.lang
                     AND t.skip_reason IS NULL
        WHERE r.name = ?
          AND (? IS NULL OR r.kind = ?)
          AND (? IS NULL OR substr(t.path, 1, length(?)) = ?)
        ORDER BY t.path, r.line, r.ordinal
        LIMIT ?`,
    )
    .all(
      commit,
      name,
      options.kind,
      options.kind,
      options.pathPrefix,
      options.pathPrefix,
      options.pathPrefix,
      options.limit + 1,
    ) as Omit<ReferenceHit, "match">[];
  return {
    rows: rows.slice(0, options.limit).map((row) => ({ ...row, match: "name" as const })),
    more: rows.length > options.limit,
  };
}

/**
 * Definitions matching `query`'s words, or references to the name `query`, in the tree at
 * `commit`. The tree is indexed first when it is not complete.
 */
export async function findSymbols(
  index: CodeIndex,
  workspace: string,
  commit: string,
  query: string,
  options: FindOptions,
): Promise<FindResult | Unavailable> {
  const tree = await ensureTree(index, workspace, commit);
  if ("state" in tree) return tree;
  const found = index.use((db) => {
    if (options.mode === "references") return references(db, commit, query.trim(), options);
    const match = matchQuery(query);
    return match ? definitions(db, commit, match, options) : { rows: [], more: false };
  });
  if ("state" in found) return found;
  return {
    state: "ok",
    partial: tree.partial,
    ...(tree.reason ? { partial_reason: tree.reason } : {}),
    results: found.rows as DefinitionHit[] | ReferenceHit[],
    more: found.more,
  };
}
