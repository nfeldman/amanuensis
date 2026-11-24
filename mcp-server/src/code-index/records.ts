// The records index (PLAN §4.6): full-text search over the store's records, kept in the
// code-index sidecar beside the symbol tables. It is a cache like the rest of the sidecar:
// nothing in `memory.db` refers to it, and deleting it loses nothing.
//
// Keeping it current. Each search first brings every source up to date with the store, per
// source table. Append-only tables (claims, narratives, explanations) use a cursor on SQLite
// `rowid`, because their text ids are caller-supplied and not monotonic; the rows at or below
// the cursor are checked by (rowid, key, timestamp, sha256 of the indexed text), so a claim
// deleted by `reset_subsystem` and a later row given its rowid start the source over, even
// with the same id in the same second. Tables updated in place (findings;
// vocabulary, upserted by `term`; field notes; open questions) are reconciled by content
// digest: every call compares (key, sha256 of the indexed text) for every row and re-indexes
// what changed, appeared or vanished. A store with a new `store_identity` starts every source
// over. The gate checks `RECORD_SOURCES` against schema.sql.
//
// Deciding what a hit returns. The index only finds candidates. Whether one is returned, and
// with which status, is decided by the store's own readers, called with the workspace's HEAD
// where a reader takes a revision: claims as `get_claims` with `query_sha` at HEAD; narratives
// as `readNarratives` (the effective row per section and topic, withdrawn keys excluded);
// explanations as `readExplanation` (the newest row whose revision the workspace reaches, with
// its phase rule); findings, field notes, open questions and vocabulary as `get_findings`,
// `get_field_notes`, `get_open_questions` and `lookup_term` return them. `include_history` adds
// the rows those readers leave out, each with its status.
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  citedSourcePath,
  resolveWorkspaceCommits,
  type ServerContext,
  type ToolDefinition,
} from "../helpers.js";
import {
  type ExplanationReading,
  isProjectExplanationEligible,
  isSubjectExplanationEligible,
  type NarrativeReading,
  readExplanation,
  readNarratives,
  readSubsystemStatus,
} from "../invariants.js";
import { outsideSurveySubsystems, scopeExclusion } from "../standing.js";
import { claimTools } from "../tools/claims.js";
import { findingTools } from "../tools/findings.js";
import { vocabularyTools } from "../tools/vocabulary.js";
import { matchQuery } from "./search.js";
import { type CodeIndex, identifierWords, searchWords, type Unavailable } from "./store.js";

export const RECORD_KINDS = [
  "claim",
  "narrative",
  "explanation",
  "finding",
  "field-note",
  "open-question",
  "vocabulary",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export interface RecordSource {
  kind: RecordKind;
  table: string;
  /** The column whose value is a hit's id. */
  key: string;
  /** The columns whose text is indexed. */
  columns: readonly string[];
  /** `rowid`: append-only text, cursored. `digest`: text updated in place, reconciled. */
  sync: "rowid" | "digest";
  /** For a rowid source, the insertion time that, with the text's digest, tells a reused rowid from the row it had. */
  stamp?: string;
}

export const RECORD_SOURCES: readonly RecordSource[] = [
  {
    kind: "claim",
    table: "claims",
    key: "claim_id",
    columns: ["claim_key", "statement"],
    sync: "rowid",
    stamp: "created_at",
  },
  {
    kind: "narrative",
    table: "narratives",
    key: "id",
    columns: ["section", "topic", "body"],
    sync: "rowid",
    stamp: "recorded_at",
  },
  {
    kind: "explanation",
    table: "explanations",
    key: "id",
    columns: ["slot", "body"],
    sync: "rowid",
    stamp: "recorded_at",
  },
  {
    kind: "finding",
    table: "findings",
    key: "finding_id",
    columns: ["symptom", "root_cause", "business_context", "fix_location"],
    sync: "digest",
  },
  {
    kind: "field-note",
    table: "field_notes",
    key: "id",
    columns: ["observation", "location"],
    sync: "digest",
  },
  {
    kind: "open-question",
    table: "open_questions",
    key: "id",
    columns: ["question", "what_blocked", "what_assumed", "answer"],
    sync: "digest",
  },
  {
    kind: "vocabulary",
    table: "vocabulary",
    key: "term",
    columns: ["gloss", "expansion"],
    sync: "digest",
  },
];

/** A snippet is at most this many UTF-8 bytes. */
export const SNIPPET_BYTES = 240;

const RECORDS_DDL = `
CREATE TABLE IF NOT EXISTS records (
    id            INTEGER PRIMARY KEY,
    kind          TEXT    NOT NULL,
    key           TEXT    NOT NULL,
    source_rowid  INTEGER NOT NULL,
    digest        TEXT    NOT NULL,
    UNIQUE (kind, key)
);
CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
    key, text, words, tokenize='porter unicode61'
);
CREATE TABLE IF NOT EXISTS records_sync (
    kind              TEXT    PRIMARY KEY,
    store_generation  TEXT    NOT NULL,
    cursor            INTEGER NOT NULL,
    guard             TEXT    NOT NULL
);
`;

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * The case-split words of the identifiers a record's text quotes (`requireEvidenceCitation` →
 * `require Evidence Citation`), which the tokenizer would keep whole, so a record is found by
 * an identifier's words as a definition is by its name's.
 */
function identifierParts(text: string): string {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((word) => {
      const parts = identifierWords(word);
      return parts.length > 1 ? parts : [];
    })
    .join(" ");
}

function textOf(source: RecordSource, row: Record<string, unknown>): string {
  return source.columns
    .map((column) => row[column])
    .filter((value) => typeof value === "string" && value.length > 0)
    .join("\n");
}

function storeGeneration(store: Database.Database): string {
  const row = store.prepare("SELECT store_generation FROM store_identity WHERE id = 1").get() as
    | { store_generation: string }
    | undefined;
  return row?.store_generation ?? "";
}

/** Bring one source's rows in the sidecar up to date with the store. */
function syncSource(sidecar: Database.Database, store: Database.Database, source: RecordSource) {
  const generation = storeGeneration(store);
  const state = sidecar
    .prepare("SELECT store_generation, cursor, guard FROM records_sync WHERE kind = ?")
    .get(source.kind) as { store_generation: string; cursor: number; guard: string } | undefined;
  const clear = () => {
    sidecar
      .prepare("DELETE FROM records_fts WHERE rowid IN (SELECT id FROM records WHERE kind = ?)")
      .run(source.kind);
    sidecar.prepare("DELETE FROM records WHERE kind = ?").run(source.kind);
  };
  const upsert = sidecar.prepare(
    `INSERT INTO records (kind, key, source_rowid, digest) VALUES (?, ?, ?, ?)
     ON CONFLICT (kind, key) DO UPDATE SET source_rowid = excluded.source_rowid,
                                           digest = excluded.digest
     RETURNING id`,
  );
  const removeText = sidecar.prepare("DELETE FROM records_fts WHERE rowid = ?");
  const addText = sidecar.prepare(
    "INSERT INTO records_fts (rowid, key, text, words) VALUES (?, ?, ?, ?)",
  );
  const index = (key: string, rowid: number, text: string) => {
    const { id } = upsert.get(source.kind, key, rowid, sha256(text)) as { id: number };
    removeText.run(id);
    addText.run(id, searchWords(key), text, identifierParts(text));
  };
  const saveState = (cursor: number, guard: string) =>
    sidecar
      .prepare(
        `INSERT INTO records_sync (kind, store_generation, cursor, guard) VALUES (?, ?, ?, ?)
         ON CONFLICT (kind) DO UPDATE SET store_generation = excluded.store_generation,
                                          cursor = excluded.cursor, guard = excluded.guard`,
      )
      .run(source.kind, generation, cursor, guard);

  let cursor = 0;
  if (state && state.store_generation === generation) cursor = state.cursor;
  else clear();

  if (source.sync === "rowid") {
    const line = (row: Record<string, unknown>) =>
      `${row.rid}\t${String(row.k)}\t${String(row.st ?? "")}\t${sha256(textOf(source, row))}`;
    const kept = (
      store
        .prepare(
          `SELECT rowid AS rid, ${source.key} AS k, ${source.stamp} AS st, ${source.columns.join(", ")}
             FROM ${source.table} WHERE rowid <= ? ORDER BY rowid`,
        )
        .all(cursor) as Record<string, unknown>[]
    ).map(line);
    let lines = kept;
    if (cursor > 0 && sha256(kept.join("\n")) !== state?.guard) {
      clear();
      cursor = 0;
      lines = [];
    }
    const fresh = store
      .prepare(
        `SELECT rowid AS rid, ${source.key} AS k, ${source.stamp} AS st, ${source.columns.join(", ")}
           FROM ${source.table} WHERE rowid > ? ORDER BY rowid`,
      )
      .all(cursor) as Record<string, unknown>[];
    for (const row of fresh) {
      index(String(row.k), row.rid as number, textOf(source, row));
      lines.push(line(row));
      cursor = row.rid as number;
    }
    saveState(cursor, sha256(lines.join("\n")));
    return;
  }

  const indexed = new Map(
    (
      sidecar.prepare("SELECT id, key, digest FROM records WHERE kind = ?").all(source.kind) as {
        id: number;
        key: string;
        digest: string;
      }[]
    ).map((row) => [row.key, row]),
  );
  const rows = store
    .prepare(
      `SELECT rowid AS rid, ${source.key} AS k, ${source.columns.join(", ")} FROM ${source.table}`,
    )
    .all() as Record<string, unknown>[];
  for (const row of rows) {
    const key = String(row.k);
    const text = textOf(source, row);
    if (indexed.get(key)?.digest !== sha256(text)) index(key, row.rid as number, text);
    indexed.delete(key);
  }
  for (const gone of indexed.values()) {
    removeText.run(gone.id);
    sidecar.prepare("DELETE FROM records WHERE id = ?").run(gone.id);
  }
  saveState(0, "");
}

/** Bring every source up to date, each in one immediate transaction on the sidecar. */
function syncRecords(sidecar: Database.Database, store: Database.Database): void {
  sidecar.exec(RECORDS_DDL);
  for (const source of RECORD_SOURCES) {
    sidecar.transaction(() => syncSource(sidecar, store, source)).immediate();
  }
}

// ---------------------------------------------------------------------------------------
// Resolving a hit through the store's readers

interface Resolved {
  /** Whether the reader returns the row by default. */
  current: boolean;
  status: string;
  subject: string | null;
  /** For a claim, its key: a `subject` filter also matches `<subject>/` at its start. */
  claimKey?: string;
  /** The file locus the record is about (a symbol claim, a field note's location), when it has one. */
  fileLocus?: string;
  /** For a term, every subsystem it is scoped to, as `list_vocabulary` reads the scope set. */
  scopes?: string[];
}

function handlerOf(tools: ToolDefinition[], name: string): ToolDefinition["handler"] {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`the store has no ${name} reader`);
  return tool.handler;
}

const getClaims = handlerOf(claimTools, "get_claims");
const getFindings = handlerOf(findingTools, "get_findings");
const lookupTerm = handlerOf(vocabularyTools, "lookup_term");

/** Per-search memo of what the readers answered, so one subject is read once. */
class Readers {
  private narratives = new Map<string, NarrativeReading>();
  private explanations = new Map<string, ExplanationReading>();
  private findings: Map<string, Record<string, unknown>> | null = null;

  constructor(
    private readonly ctx: ServerContext,
    private readonly head: string,
  ) {}

  async resolve(kind: RecordKind, key: string): Promise<Resolved | null> {
    switch (kind) {
      case "claim":
        return this.claim(key);
      case "narrative":
        return this.narrative(Number(key));
      case "explanation":
        return this.explanation(Number(key));
      case "finding":
        return this.finding(key);
      case "field-note":
        return this.fieldNote(Number(key));
      case "open-question":
        return this.openQuestion(Number(key));
      case "vocabulary":
        return this.term(key);
    }
  }

  private async claim(id: string): Promise<Resolved | null> {
    const db = this.ctx.db;
    const row = db
      .prepare(
        "SELECT claim_key, subject_type, subject_id, valid_until_sha FROM claims WHERE claim_id = ?",
      )
      .get(id) as
      | {
          claim_key: string;
          subject_type: string;
          subject_id: string;
          valid_until_sha: string | null;
        }
      | undefined;
    if (!row) return null;
    const locus = row.subject_type === "symbol" ? citedSourcePath(row.subject_id) : null;
    const base = {
      subject: row.subject_id,
      claimKey: row.claim_key,
      ...(locus ? { fileLocus: locus } : {}),
    };
    const atHead = (await getClaims({ claim_id: id, query_sha: this.head }, this.ctx)) as unknown[];
    if (atHead.length > 0) {
      return {
        ...base,
        current: true,
        status: row.valid_until_sha === null ? "current" : "applies-at-head",
      };
    }
    if (row.valid_until_sha === null) return { ...base, current: false, status: "inapplicable" };
    const closed = db
      .prepare(
        `SELECT event_type FROM claim_validity_events
          WHERE claim_id = ? AND event_type IN ('superseded', 'invalidated')
          ORDER BY id DESC LIMIT 1`,
      )
      .get(id) as { event_type: string } | undefined;
    return { ...base, current: false, status: closed?.event_type ?? "closed" };
  }

  private narrative(id: number): Resolved | null {
    const db = this.ctx.db;
    const row = db
      .prepare(
        "SELECT subject_type, subject_id, section, topic, disposition FROM narratives WHERE id = ?",
      )
      .get(id) as
      | {
          subject_type: string;
          subject_id: string;
          section: string;
          topic: string;
          disposition: string;
        }
      | undefined;
    if (!row) return null;
    const subjectKey = `${row.subject_type}\u0000${row.subject_id}`;
    let reading = this.narratives.get(subjectKey);
    if (!reading) {
      reading = readNarratives(db, row.subject_type, row.subject_id);
      this.narratives.set(subjectKey, reading);
    }
    const subject = row.subject_id;
    const effective = reading.rows.find((r) => r.id === id);
    if (effective) return { current: true, status: effective.disposition, subject };
    const newest = db
      .prepare(
        `SELECT disposition FROM narratives
          WHERE subject_type = ? AND subject_id = ? AND section = ? AND topic = ?
          ORDER BY id DESC LIMIT 1`,
      )
      .get(row.subject_type, row.subject_id, row.section, row.topic) as { disposition: string };
    return {
      current: false,
      status: newest.disposition === "withdrawn" ? "withdrawn" : "replaced",
      subject,
    };
  }

  private explanation(id: number): Resolved | null {
    const db = this.ctx.db;
    const row = db
      .prepare(
        "SELECT subject_type, subject_id, slot, disposition, ref_sha FROM explanations WHERE id = ?",
      )
      .get(id) as
      | {
          subject_type: string;
          subject_id: string;
          slot: string;
          disposition: string;
          ref_sha: string;
        }
      | undefined;
    if (!row) return null;
    const slotKey = `${row.subject_type}\u0000${row.subject_id}\u0000${row.slot}`;
    const workspace = this.ctx.project.workspacePath;
    let reading = this.explanations.get(slotKey);
    if (!reading) {
      reading = readExplanation(db, workspace, row.subject_type, row.subject_id, row.slot);
      this.explanations.set(slotKey, reading);
    }
    const subject = row.subject_id;
    if (reading.row?.id === id) return { current: true, status: reading.state, subject };
    const eligible =
      row.subject_type === "project"
        ? isProjectExplanationEligible(db, row.slot)
        : isSubjectExplanationEligible(
            row.subject_type,
            readSubsystemStatus(db, row.subject_id),
            [],
          );
    if (!eligible) return { current: false, status: "not-eligible", subject };
    if (reading.checked && workspace !== null) {
      const resolved = resolveWorkspaceCommits(workspace, [row.ref_sha]).get(row.ref_sha);
      if (resolved === null || resolved === undefined) {
        return { current: false, status: "unreachable", subject };
      }
    }
    const newest = db
      .prepare(
        `SELECT disposition FROM explanations
          WHERE subject_type = ? AND subject_id = ? AND slot = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(row.subject_type, row.subject_id, row.slot) as { disposition: string };
    const withdrawn = row.disposition === "withdrawn" || newest.disposition === "withdrawn";
    return { current: false, status: withdrawn ? "withdrawn" : "replaced", subject };
  }

  private async finding(id: string): Promise<Resolved | null> {
    if (!this.findings) {
      const rows = (await getFindings({}, this.ctx)) as Record<string, unknown>[];
      this.findings = new Map(rows.map((r) => [String(r.finding_id), r]));
    }
    const row = this.findings.get(id);
    if (!row) return null;
    return {
      current: true,
      status: String(row.status),
      subject: (row.subsystem_id as string | null) ?? null,
    };
  }

  private fieldNote(id: number): Resolved | null {
    const row = this.ctx.db
      .prepare("SELECT location, follow_up FROM field_notes WHERE id = ?")
      .get(id) as { location: string | null; follow_up: string | null } | undefined;
    if (!row) return null;
    // A location is free text; it is a file locus when it reads as a path, or when it is a
    // bare name the survey set excludes (`Makefile`), as describe_locus resolves one.
    const location = row.location?.trim() ?? "";
    const locus = /[/.]/.test(location)
      ? citedSourcePath(location)
      : location.length > 0 && !/\s/.test(location) && scopeExclusion(this.ctx, location)
        ? citedSourcePath(location)
        : null;
    return {
      current: true,
      status: row.follow_up ?? "open",
      subject: row.location,
      ...(locus ? { fileLocus: locus } : {}),
    };
  }

  private openQuestion(id: number): Resolved | null {
    const row = this.ctx.db
      .prepare("SELECT subsystem_id, resolution FROM open_questions WHERE id = ?")
      .get(id) as { subsystem_id: string | null; resolution: string | null } | undefined;
    if (!row) return null;
    // `get_open_questions` returns only open questions unless asked for all.
    const status = row.resolution ?? "open";
    return { current: status === "open", status, subject: row.subsystem_id };
  }

  private async term(term: string): Promise<Resolved | null> {
    const row = (await lookupTerm({ term }, this.ctx)) as Record<string, unknown> | null;
    if (!row) return null;
    const scopes = (
      this.ctx.db
        .prepare("SELECT subsystem_id FROM vocabulary_scopes WHERE term = ? ORDER BY subsystem_id")
        .all(term) as { subsystem_id: string }[]
    ).map((s) => s.subsystem_id);
    return {
      current: true,
      status: "current",
      subject: (row.subsystem_id as string | null) ?? null,
      scopes,
    };
  }
}

/**
 * design/scope/PLAN.md §2.7: a hit is left out only when its subject is itself outside the
 * survey, a file locus on an excluded path or a subsystem whose every ledger row is on one.
 * A record that cites both included and excluded evidence has an included subject and stays.
 */
class SurveyReach {
  private subsystems: Set<string> | null = null;
  private paths = new Map<string, boolean>();

  constructor(private readonly ctx: ServerContext) {}

  outside(resolved: Resolved): boolean {
    if (resolved.fileLocus) {
      let excluded = this.paths.get(resolved.fileLocus);
      if (excluded === undefined) {
        excluded = scopeExclusion(this.ctx, resolved.fileLocus) !== null;
        this.paths.set(resolved.fileLocus, excluded);
      }
      return excluded;
    }
    if (resolved.subject === null) return false;
    this.subsystems ??= new Set(outsideSurveySubsystems(this.ctx.db));
    return this.subsystems.has(resolved.subject);
  }
}

// ---------------------------------------------------------------------------------------
// Searching

export interface RecordSearch {
  query: string;
  kinds: readonly RecordKind[] | null;
  subject: string | null;
  includeHistory: boolean;
  /** Restore the hits whose subject is outside the survey (§2.7). */
  includeExcluded?: boolean;
  limit: number;
}

export interface RecordHit {
  kind: RecordKind;
  id: string | number;
  subject: string | null;
  status: string;
  snippet: string;
}

/** `text` cut to at most `bytes` UTF-8 bytes, on a character boundary. */
export function cutBytes(text: string, bytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= bytes) return text;
  let end = bytes;
  while (end > 0 && ((buffer[end] as number) & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString("utf8");
}

const SEARCH_BATCH = 200;

/**
 * Records matching `query`'s words, ranked by BM25, each returned only as its reader returns
 * it (or, with `includeHistory`, with the status that reader leaves it out for).
 */
export async function searchRecords(
  index: CodeIndex,
  ctx: ServerContext,
  head: string,
  search: RecordSearch,
): Promise<{ state: "ok"; results: RecordHit[]; more: boolean } | Unavailable> {
  const synced = index.use((sidecar) => {
    syncRecords(sidecar, ctx.db);
    return true as const;
  });
  if (synced !== true) return synced;
  const match = matchQuery(search.query);
  if (!match) return { state: "ok", results: [], more: false };
  const kinds = search.kinds ?? RECORD_KINDS;
  const readers = new Readers(ctx, head);
  const reach = new SurveyReach(ctx);
  const results: RecordHit[] = [];
  for (let offset = 0; ; offset += SEARCH_BATCH) {
    const batch = index.use(
      (sidecar) =>
        sidecar
          .prepare(
            `SELECT r.kind, r.key, snippet(records_fts, 1, '', '', '…', 40) AS snippet
               FROM records_fts
               JOIN records r ON r.id = records_fts.rowid
              WHERE records_fts MATCH ?
                AND r.kind IN (${kinds.map(() => "?").join(", ")})
              ORDER BY bm25(records_fts, 2.0, 1.0, 1.0), r.kind, r.key
              LIMIT ? OFFSET ?`,
          )
          .all(match, ...kinds, SEARCH_BATCH, offset) as {
          kind: RecordKind;
          key: string;
          snippet: string;
        }[],
    );
    if ("state" in batch) return batch;
    for (const hit of batch) {
      const resolved = await readers.resolve(hit.kind, hit.key);
      if (!resolved) continue;
      if (!resolved.current && !search.includeHistory) continue;
      // Before the page is cut: a hit left out never takes a place in it.
      if (!search.includeExcluded && reach.outside(resolved)) continue;
      if (
        search.subject !== null &&
        resolved.subject !== search.subject &&
        !resolved.scopes?.includes(search.subject) &&
        !resolved.claimKey?.startsWith(`${search.subject}/`)
      ) {
        continue;
      }
      if (results.length === search.limit) return { state: "ok", results, more: true };
      const source = RECORD_SOURCES.find((s) => s.kind === hit.kind);
      results.push({
        kind: hit.kind,
        id: source?.key === "id" ? Number(hit.key) : hit.key,
        subject: resolved.subject,
        status: resolved.status,
        snippet: cutBytes(hit.snippet, SNIPPET_BYTES),
      });
    }
    if (batch.length < SEARCH_BATCH) return { state: "ok", results, more: false };
  }
}
