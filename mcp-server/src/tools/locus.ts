/**
 * `describe_locus` — the consumer route into the conspectus (spec §3, §5.1).
 *
 * The tool answers one question: what does the record hold about this file,
 * symbol, subsystem, or term, and what does that record authorize? Standing
 * (§2) is computed in `../standing.js`; everything here assembles the account
 * that follows it.
 *
 * Three properties are load-bearing and every branch below preserves them.
 *
 * 1. **No text is generated during the call.** Every string served is either a
 *    column read from the store or a code constant in this file. The response
 *    reports `model_calls: 0` and each item declares `authored: "model" |
 *    "code"`, because durable rows an earlier survey session wrote *are*
 *    model-authored prose and a reader is entitled to know which sentences a
 *    model wrote (§3.4).
 * 2. **Every item states what revision it is bound to.** A row whose source
 *    table has no revision column carries `ref_sha: null` and
 *    `revision_bound: false` rather than borrowing a neighbour's (§3.2).
 * 3. **A historical reading is served only where the store can source one.**
 *    `as_of_sha` is not a whole-account snapshot: five of the eight sections
 *    are mutable rows with no validity interval and no event table, so they
 *    are served at their current value and say so (§3.3).
 */
import { spawnSync } from "node:child_process";
import type { DB } from "../db.js";
import {
  optString,
  optStringArray,
  requireString,
  responseBytes,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import {
  describeLocusStanding,
  type FileStandingBlock,
  type LocusKind,
  type ResolvedLocus,
  STANDING_AUTHORITY_ORDER,
  STATUS_ORDER,
  type StandingBlock,
  type StandingState,
  type SymbolStandingBlock,
  type UnknownEntry,
} from "../standing.js";
import { EVIDENCE_KINDS, SEVERITIES } from "../vocabulary.js";

/** §5.1: the output contract shipped at contracts/locus-account.schema.json. */
export const LOCUS_ACCOUNT_CONTRACT_VERSION = "1.0.0";

/** §3.1's eight sections, in the order the account presents them. */
export const ACCOUNT_SECTIONS = [
  "purpose",
  "structure",
  "defects",
  "reviews",
  "boundaries",
  "terms",
  "leads",
  "history_pointer",
] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

/**
 * §4.2. `history_pointer` is always present — its counts are on by default and
 * only its detail is opt-in — so it is not in either list; the section builder
 * reads `requested` for the detail.
 */
const DEFAULT_SECTIONS: readonly AccountSection[] = [
  "purpose",
  "structure",
  "defects",
  "boundaries",
  "terms",
];

/** §3.1's defects partition, in order, against the resolution states it covers. */
const DEFECT_PARTITIONS = [
  ["open", "open"],
  ["awaiting-verification", "fixed-pending-verification"],
  ["verified-fixed", "verified-fixed"],
  ["ruled-out", "ruled-out"],
  ["accepted", "accepted"],
] as const;

/**
 * §2.3. Only these two states authorize a claim about the file's content; the
 * rest authorize a fact about the record and nothing about the code. The
 * structure section is the one place the account carries content claims, so it
 * is the one place this gate applies — and when it closes, the response says
 * so with the state's own `cannot_justify` sentence rather than reporting an
 * empty source.
 */
const CONTENT_AUTHORIZING: readonly StandingState[] = ["examined", "examined-stale"];

/** §3.1: no durable purpose field exists, so none is invented from a name. */
const NO_PURPOSE_SENTENCE =
  "No purpose statement is recorded for this subsystem; scope states what it covers.";

/** §3.3's sentence for a section the store cannot place in time. */
function asOfUnsupportedSentence(sha: string): string {
  return `This section has no recorded history; the values below are current, not as of ${sha}.`;
}

// ---------------------------------------------------------------------------
// Git: the two questions a historical reading asks
// ---------------------------------------------------------------------------

/**
 * `claims.ts` and `standing.ts` each ask git the same two questions behind
 * their own guard, and this is the third caller. The three are deliberately
 * not shared yet: each owns a different failure policy — `claims.ts` refuses a
 * write, `standing.ts` downgrades an authorization, and this one refuses a
 * historical reading — and folding them together is a refactor no packet in
 * this plan owns. The duplication is named here so it is not mistaken for an
 * oversight.
 */
class CommitProbe {
  private readonly cwd: string;
  private readonly cache = new Map<string, boolean>();

  constructor(ctx: ServerContext) {
    this.cwd = ctx.project.workspacePath;
  }

  private run(args: string[]): { status: number; stdout: string } {
    const result = spawnSync("git", args, {
      cwd: this.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: result.status ?? 1, stdout: String(result.stdout ?? "").trim() };
  }

  /** Resolve a revision or refuse the call; an unresolvable as_of_sha is an error (§5.1). */
  resolve(revision: string): string {
    const result = this.run(["rev-parse", "--verify", `${revision}^{commit}`]);
    if (result.status !== 0 || !result.stdout) {
      throw new ToolError(`unknown git commit: ${revision}`);
    }
    return result.stdout;
  }

  /**
   * Membership in a validity interval is decided by commit ancestry, never by
   * SHA text or wall-clock order (§3.3). A revision git cannot compare is not
   * an ancestor: the reading stays conservative rather than admitting a row it
   * cannot place.
   */
  isAncestor(ancestor: string | null, descendant: string): boolean {
    if (!ancestor) return false;
    if (ancestor === descendant) return true;
    const key = `${ancestor}->${descendant}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const result = this.run(["merge-base", "--is-ancestor", ancestor, descendant]);
    const verdict = result.status === 0;
    this.cache.set(key, verdict);
    return verdict;
  }
}

// ---------------------------------------------------------------------------
// Scope: what this locus owns, and which stored ids name it
// ---------------------------------------------------------------------------

interface AccountScope {
  locus: ResolvedLocus;
  owners: string[];
  path: string | null;
  symbol: string | null;
  subsystemId: string | null;
  term: string | null;
  /** Values a `claims.subject_id` may equal to be about this locus. */
  subjectIds: string[];
}

function ownersOfPath(db: DB, path: string): string[] {
  return (
    db
      .prepare(
        "SELECT DISTINCT subsystem_id FROM file_ledger WHERE file_path = ? ORDER BY subsystem_id",
      )
      .all(path) as { subsystem_id: string }[]
  ).map((row) => row.subsystem_id);
}

function buildScope(db: DB, locus: ResolvedLocus): AccountScope {
  if (locus.kind === "subsystem") {
    const id = locus.subsystem_id as string;
    return {
      locus,
      owners: [id],
      path: null,
      symbol: null,
      subsystemId: id,
      term: null,
      subjectIds: [id],
    };
  }
  if (locus.kind === "term") {
    const term = locus.term as string;
    const row = db.prepare("SELECT subsystem_id FROM vocabulary WHERE term = ?").get(term) as
      | { subsystem_id: string | null }
      | undefined;
    return {
      locus,
      owners: row?.subsystem_id ? [row.subsystem_id] : [],
      path: null,
      symbol: null,
      subsystemId: null,
      term,
      subjectIds: [term],
    };
  }
  const path = locus.path as string;
  const subjectIds = [path];
  if (locus.kind === "symbol") subjectIds.push(`${path}:${locus.symbol}`, locus.value);
  return {
    locus,
    owners: ownersOfPath(db, path),
    path,
    symbol: locus.symbol,
    subsystemId: null,
    term: null,
    subjectIds: [...new Set(subjectIds)],
  };
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(",");
}

/**
 * §2.3's weakest-owner rule, read off the file block. `mixed` authorizes only
 * what the weakest owner authorizes, and an owner whose reachability could not
 * be checked authorizes what `examined-stale` authorizes.
 */
function effectiveFileState(block: FileStandingBlock): StandingState {
  const states = block.owners.map((owner) =>
    owner.authorization_downgraded ? ("examined-stale" as StandingState) : owner.standing_state,
  );
  if (states.length === 0) return block.state;
  let weakest = states[0] as StandingState;
  for (const state of states) {
    if (STANDING_AUTHORITY_ORDER.indexOf(state) < STANDING_AUTHORITY_ORDER.indexOf(weakest)) {
      weakest = state;
    }
  }
  return weakest;
}

/**
 * Whether the standing block authorizes a claim about the code itself, and the
 * sentence to serve when it does not. §2.3's table is stated for file standing,
 * so the gate applies to `file` and `symbol` loci; a subsystem's ladder status
 * and a term's definition are not on that axis and no rank is invented for them.
 */
function contentAuthorization(
  locus: ResolvedLocus,
  standing: StandingBlock,
): { authorized: boolean; cannot_justify: string; state: string } {
  if (locus.kind === "file" || locus.kind === "symbol") {
    const file =
      locus.kind === "symbol"
        ? (standing as SymbolStandingBlock).file
        : (standing as FileStandingBlock);
    const state = effectiveFileState(file);
    return {
      authorized: CONTENT_AUTHORIZING.includes(state),
      cannot_justify: file.cannot_justify,
      state,
    };
  }
  return {
    authorized: true,
    cannot_justify: "",
    state: String((standing as { state?: string }).state ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

type Item = Record<string, unknown>;

interface SectionBuild {
  /** Rows the source holds for this locus, before any gate. */
  source_rows: number;
  /** Rows eligible to be served: the census the omission ledger reconciles against. */
  items: Item[];
  /** Set when §2.3 closes the section; the items are withheld, not absent. */
  authorized?: boolean;
  withheld?: number;
  cannot_justify?: string;
  statement?: string;
  counts?: Record<string, number>;
  session_attribution?: string;
  /**
   * §4.3's drop order for a section whose rule reads a column the response does
   * not serve: one opaque key per item, descending key order being drop order.
   * Absent for the seven sections whose order is readable from their items.
   */
  drop_keys?: string[];
}

interface SectionView {
  census: number;
  recorded: boolean;
  requested: boolean;
  as_of_supported: boolean;
  items: Item[];
  statement?: string;
  as_of?: string;
  authorized?: boolean;
  withheld_unauthorized?: number;
  cannot_justify?: string;
  source_rows?: number;
  counts?: Record<string, number>;
  session_attribution?: string;
}

/** The strongest attached evidence kind, ranked by the declared ladder. */
function strongestKind(kinds: string[]): string | null {
  let best: string | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const kind of kinds) {
    const rank = (EVIDENCE_KINDS as readonly string[]).indexOf(kind);
    if (rank >= 0 && rank < bestRank) {
      bestRank = rank;
      best = kind;
    }
  }
  return best;
}

function severityRank(severity: string): number {
  const rank = (SEVERITIES as readonly string[]).indexOf(severity);
  return rank < 0 ? SEVERITIES.length : rank;
}

/**
 * §3.1's evidence arm, as a predicate over the `evidence` alias `e` rather
 * than as a list of ids. A subsystem locus can own hundreds of evidence rows,
 * and a query that first materializes their ids and then binds one parameter
 * per id scales with the store rather than with the answer — and eventually
 * meets SQLite's variable ceiling. Returns null when nothing can cite the
 * locus (a term), so a caller drops the arm rather than binding a false one.
 *
 * A symbol locus is cited only by evidence naming that exact symbol: a file's
 * citations are never silently inherited by one of its symbols (§2.5).
 */
function evidenceMatch(scope: AccountScope): { sql: string; params: unknown[] } | null {
  if (scope.path) {
    return scope.symbol
      ? { sql: "e.file_path = ? AND e.symbol = ?", params: [scope.path, scope.symbol] }
      : { sql: "e.file_path = ?", params: [scope.path] };
  }
  if (scope.subsystemId) {
    return {
      sql: "e.file_path IN (SELECT file_path FROM file_ledger WHERE subsystem_id = ?)",
      params: [scope.subsystemId],
    };
  }
  return null;
}

function buildPurpose(db: DB, scope: AccountScope): SectionBuild {
  if (scope.owners.length === 0) return { source_rows: 0, items: [] };
  const rows = db
    .prepare(
      `SELECT id, name, status, layer, scope, jump_in_reading, notes
         FROM subsystems WHERE id IN (${placeholders(scope.owners)}) ORDER BY id`,
    )
    .all(...scope.owners) as {
    id: string;
    name: string;
    status: string;
    layer: string | null;
    scope: string | null;
    jump_in_reading: string | null;
    notes: string | null;
  }[];
  const items = rows.map((row) => ({
    subsystem_id: row.id,
    name: row.name,
    status: row.status,
    layer: row.layer,
    // `subsystems.scope` is a file-and-boundary list, not a purpose sentence,
    // and it is served under its own name rather than read as one (§3.1).
    scope: row.scope,
    jump_in_reading: row.jump_in_reading,
    purpose: null,
    ref_sha: null,
    revision_bound: false,
    authored: row.scope || row.jump_in_reading || row.notes ? "model" : "code",
  }));
  return {
    source_rows: rows.length,
    items,
    statement: items.length ? NO_PURPOSE_SENTENCE : undefined,
  };
}

interface ClaimRow {
  claim_id: string;
  claim_key: string;
  subject_type: string;
  subject_id: string;
  statement: string;
  epistemic_kind: string;
  asserted_at_sha: string;
  valid_from_sha: string;
  valid_until_sha: string | null;
}

function buildStructure(
  db: DB,
  scope: AccountScope,
  authorization: { authorized: boolean; cannot_justify: string },
  probe: CommitProbe,
  asOf: string | null,
): SectionBuild {
  const cites = evidenceMatch(scope);
  const conditions = [`c.subject_id IN (${placeholders(scope.subjectIds)})`];
  const params: unknown[] = [...scope.subjectIds];
  if (cites) {
    conditions.push(
      `EXISTS (SELECT 1 FROM claim_evidence ce JOIN evidence e ON e.id = ce.evidence_id
                WHERE ce.claim_id = c.claim_id AND ${cites.sql})`,
    );
    params.push(...cites.params);
  }
  // Every stored row is a candidate and ancestry alone decides membership: a
  // SQL pre-filter on the validity columns drops exactly the claims opened at
  // a strict ancestor and still open, which is what a historical read most
  // needs (§3.3).
  const rows = db
    .prepare(
      `SELECT c.claim_id, c.claim_key, c.subject_type, c.subject_id, c.statement,
              c.epistemic_kind, c.asserted_at_sha, c.valid_from_sha, c.valid_until_sha
         FROM claims c
        WHERE ${conditions.join(" OR ")}
        ORDER BY c.claim_id`,
    )
    .all(...params) as ClaimRow[];

  const applies = (row: ClaimRow): boolean => {
    if (!asOf) return row.valid_until_sha === null;
    return (
      probe.isAncestor(row.valid_from_sha, asOf) &&
      (row.valid_until_sha === null || !probe.isAncestor(row.valid_until_sha, asOf))
    );
  };
  const kindsFor = db.prepare(
    `SELECT e.kind FROM claim_evidence ce JOIN evidence e ON e.id = ce.evidence_id
      WHERE ce.claim_id = ?`,
  );
  const selected = rows.filter(applies);
  if (!authorization.authorized) {
    return {
      source_rows: rows.length,
      items: [],
      authorized: false,
      withheld: selected.length,
      // The sentence is §2.3's own, carried in a field rather than quoted
      // inside prose: a reader — and a checker — must be able to tell what the
      // record cannot justify from what the tool is asserting.
      cannot_justify: authorization.cannot_justify,
      statement:
        "Not examined: this locus's standing authorizes no claim about its content, so no structural claim is served here.",
    };
  }
  const items = selected.map((row) => ({
    claim_id: row.claim_id,
    claim_key: row.claim_key,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    statement: row.statement,
    epistemic_kind: row.epistemic_kind,
    ref_sha: row.asserted_at_sha,
    evidence_kind: strongestKind(
      (kindsFor.all(row.claim_id) as { kind: string }[]).map((e) => e.kind),
    ),
    revision_bound: true,
    authored: "model",
    current: row.valid_until_sha === null,
  }));
  return { source_rows: rows.length, items };
}

interface FindingRow {
  finding_id: string;
  subsystem_id: string;
  severity: string;
  resolution_state: string;
  legacy_status: string;
  symptom: string;
  ref_sha: string | null;
  primary_files: string | null;
  /** 1 when an evidence row cites the locus; the `primary_files` arm is decided in code. */
  cited: number;
}

interface ResolutionEventRow {
  id: number;
  finding_id: string;
  resolution_state: string;
  fix_sha: string | null;
  fix_location: string | null;
  rationale: string;
  recorded_at: string;
}

/**
 * Whether a finding's `primary_files` citation names this locus.
 *
 * A citation is `path[:symbol][@sha]`, and the symbol half is significant: at
 * a symbol locus the whole `path:symbol` must match, because C13 forbids a
 * symbol from inheriting the file's state silently and the evidence arm
 * already narrows on `e.symbol`. Comparing the path alone let every finding
 * cited to one symbol answer for every other symbol in the same file
 * (F7/codex). A file locus still matches on the path, which is what collects
 * the file's symbol-level findings onto it.
 *
 * The split is on the *first* colon, so a `Type::method` symbol survives it.
 */
function primaryFilesNames(
  primaryFiles: string | null,
  path: string,
  symbol: string | null,
): boolean {
  if (!primaryFiles) return false;
  let entries: unknown;
  try {
    entries = JSON.parse(primaryFiles);
  } catch {
    return false;
  }
  if (!Array.isArray(entries)) return false;
  return entries.some((entry) => {
    if (typeof entry !== "string") return false;
    const citation = entry.split("@")[0] ?? entry;
    const colon = citation.indexOf(":");
    const file = colon === -1 ? citation : citation.slice(0, colon);
    if (file !== path) return false;
    if (!symbol) return true;
    return colon !== -1 && citation.slice(colon + 1) === symbol;
  });
}

function matchingFindings(db: DB, scope: AccountScope): FindingRow[] {
  const columns = `s.finding_id, s.subsystem_id, s.severity, s.resolution_state,
                   s.legacy_status, f.symptom, f.ref_sha, f.primary_files`;
  const from = "FROM finding_state_current s JOIN findings f ON f.finding_id = s.finding_id";
  if (scope.subsystemId) {
    return db
      .prepare(
        `SELECT ${columns}, 1 AS cited ${from} WHERE s.subsystem_id = ? ORDER BY s.finding_id`,
      )
      .all(scope.subsystemId) as FindingRow[];
  }
  if (!scope.path) return [];
  const cites = evidenceMatch(scope);
  if (!cites) return [];
  // Two arms, because §3.1 names two: a finding whose evidence cites the path,
  // and a finding whose `primary_files` citation names it. `primary_files` is
  // a JSON array, so that arm is narrowed in SQL to the owning subsystems and
  // decided in code.
  const citedSql = `EXISTS (SELECT 1 FROM finding_evidence fe JOIN evidence e ON e.id = fe.evidence_id
                             WHERE fe.finding_id = f.finding_id AND ${cites.sql})`;
  const conditions = [citedSql];
  const params: unknown[] = [...cites.params, ...cites.params];
  if (scope.owners.length) {
    conditions.push(
      `(f.primary_files IS NOT NULL AND f.subsystem_id IN (${placeholders(scope.owners)}))`,
    );
    params.push(...scope.owners);
  }
  const rows = db
    .prepare(
      `SELECT ${columns}, ${citedSql} AS cited ${from}
        WHERE ${conditions.join(" OR ")}
        ORDER BY s.finding_id`,
    )
    .all(...params) as FindingRow[];
  return rows.filter(
    (row) =>
      row.cited === 1 || primaryFilesNames(row.primary_files, scope.path as string, scope.symbol),
  );
}

/**
 * §3.3's replay. An event is at or before `as_of_sha` when the revision it
 * names is an ancestor of it; the walk stops at the first event that is
 * provably later, because everything recorded after it is later too.
 *
 * Two honest limits are reported rather than papered over. An event that names
 * no revision cannot be placed at a commit at all — it is included, because the
 * store holds it, and counted so a reader knows the cut was not made by
 * revision alone. And a finding with no events has only `findings.status` to
 * go on, a mutable column with no revision: its current value is served with
 * `as_of_placeable: false` rather than being back-dated to a commit.
 */
function resolutionAt(
  events: ResolutionEventRow[],
  currentState: string,
  probe: CommitProbe,
  asOf: string,
): { state: string; placeable: boolean; unplaceable: number } {
  if (events.length === 0) return { state: currentState, placeable: false, unplaceable: 0 };
  let state: string | null = null;
  let unplaceable = 0;
  for (const event of events) {
    if (event.fix_sha && !probe.isAncestor(event.fix_sha, asOf)) break;
    if (!event.fix_sha) unplaceable += 1;
    state = event.resolution_state;
  }
  // No event had been recorded by then, which is what `open` means: no
  // terminal resolution event exists for the finding at that commit.
  return { state: state ?? "open", placeable: true, unplaceable };
}

/**
 * §2.3's rule, carried to the one section it bears on. "No open findings" is
 * an assertion about the code, and only a reading of the code can license it.
 *
 * The rule is stated for file standing, so the other two kinds need their own
 * threshold and get one from the ladder they are already on: a subsystem may
 * report an absence of findings once its survey has reached `concerns`, the
 * first status at which findings are recorded at all, and a term is not a
 * locus that findings are recorded against. Below that threshold the section
 * says what is true — nothing was read — and never reports an absence it
 * cannot see.
 */
function defectsEmptyStatement(locus: ResolvedLocus, state: string): string {
  if (locus.kind === "file" || locus.kind === "symbol") {
    return state === "examined"
      ? "No open findings are recorded for this locus."
      : "Not examined: nothing was read here, so the record says nothing about defects at this locus.";
  }
  if (locus.kind === "subsystem") {
    const reached = STATUS_ORDER.indexOf(state as (typeof STATUS_ORDER)[number]);
    const recordsFindings = STATUS_ORDER.indexOf("concerns");
    return reached >= 0 && reached >= recordsFindings
      ? "No open findings are recorded for this subsystem."
      : `Not examined: this subsystem's status is ${state}, which is short of the stage at which findings are recorded.`;
  }
  return "Findings are recorded against files and subsystems, not against a term.";
}

function buildDefects(
  db: DB,
  rows: FindingRow[],
  probe: CommitProbe,
  asOf: string | null,
  emptyStatement: string,
): SectionBuild {
  const eventsFor = db.prepare(
    `SELECT id, finding_id, resolution_state, fix_sha, fix_location, rationale, recorded_at
       FROM finding_resolution_events WHERE finding_id = ? ORDER BY id`,
  );
  const placed = rows.map((row) => {
    if (!asOf) {
      return { row, state: row.resolution_state, placeable: true, unplaceable: 0 };
    }
    const events = eventsFor.all(row.finding_id) as ResolutionEventRow[];
    const replay = resolutionAt(events, row.resolution_state, probe, asOf);
    return {
      row,
      state: replay.state,
      placeable: replay.placeable,
      unplaceable: replay.unplaceable,
    };
  });
  const partitionOf = (state: string): string =>
    DEFECT_PARTITIONS.find(([, resolution]) => resolution === state)?.[0] ?? "open";
  const items: Item[] = [];
  for (const [partition, resolution] of DEFECT_PARTITIONS) {
    const inPartition = placed
      .filter((entry) => partitionOf(entry.state) === partition && entry.state === resolution)
      .sort(
        (a, b) =>
          severityRank(a.row.severity) - severityRank(b.row.severity) ||
          a.row.finding_id.localeCompare(b.row.finding_id),
      );
    for (const entry of inPartition) {
      const item: Item = {
        finding_id: entry.row.finding_id,
        subsystem_id: entry.row.subsystem_id,
        severity: entry.row.severity,
        resolution_state: entry.state,
        partition,
        symptom: entry.row.symptom,
        ref_sha: entry.row.ref_sha,
        revision_bound: entry.row.ref_sha !== null,
        authored: "model",
      };
      if (asOf) {
        item.as_of_placeable = entry.placeable;
        if (entry.unplaceable > 0) item.as_of_unplaceable_events = entry.unplaceable;
        item.current = entry.state === entry.row.resolution_state;
      }
      items.push(item);
    }
  }
  return {
    source_rows: rows.length,
    items,
    statement: items.length === 0 ? emptyStatement : undefined,
  };
}

function buildReviews(db: DB, scope: AccountScope): SectionBuild {
  const cites = evidenceMatch(scope);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (cites) {
    conditions.push(
      `EXISTS (SELECT 1 FROM disposition_evidence de JOIN evidence e ON e.id = de.evidence_id
                WHERE de.subsystem_id = d.subsystem_id AND de.concern_code = d.concern_code
                  AND ${cites.sql})`,
    );
    params.push(...cites.params);
  }
  if (scope.subsystemId) {
    conditions.push("d.subsystem_id = ?");
    params.push(scope.subsystemId);
  }
  if (conditions.length === 0) return { source_rows: 0, items: [] };
  const rows = db
    .prepare(
      `SELECT d.subsystem_id, d.concern_code, d.classification, d.evidence_quality, d.rationale,
              (SELECT e.ref_sha FROM disposition_evidence de JOIN evidence e ON e.id = de.evidence_id
                WHERE de.subsystem_id = d.subsystem_id AND de.concern_code = d.concern_code
                ORDER BY e.id LIMIT 1) AS ref_sha,
              (SELECT e.kind FROM disposition_evidence de JOIN evidence e ON e.id = de.evidence_id
                WHERE de.subsystem_id = d.subsystem_id AND de.concern_code = d.concern_code
                ORDER BY e.id LIMIT 1) AS evidence_kind
         FROM dispositions d
        WHERE ${conditions.join(" OR ")}
        ORDER BY d.subsystem_id, d.concern_code`,
    )
    .all(...params) as {
    subsystem_id: string;
    concern_code: string;
    classification: string | null;
    evidence_quality: string | null;
    rationale: string | null;
    ref_sha: string | null;
    evidence_kind: string | null;
  }[];
  return {
    source_rows: rows.length,
    items: rows.map((row) => ({
      subsystem_id: row.subsystem_id,
      concern_code: row.concern_code,
      classification: row.classification,
      evidence_quality: row.evidence_quality,
      rationale: row.rationale,
      ref_sha: row.ref_sha,
      evidence_kind: row.evidence_kind,
      revision_bound: row.ref_sha !== null,
      authored: "model",
    })),
  };
}

function buildBoundaries(db: DB, scope: AccountScope): SectionBuild {
  if (scope.owners.length === 0) return { source_rows: 0, items: [] };
  const list = placeholders(scope.owners);
  const seams = db
    .prepare(
      `SELECT id, shared_object, shared_object_kind, party_a, party_b
         FROM seams WHERE party_a IN (${list}) OR party_b IN (${list}) ORDER BY id`,
    )
    .all(...scope.owners, ...scope.owners) as {
    id: string;
    shared_object: string;
    shared_object_kind: string | null;
    party_a: string;
    party_b: string;
  }[];
  const xrefs = db
    .prepare(
      `SELECT from_id, to_id, relationship, strength, context
         FROM xrefs WHERE from_id IN (${list}) OR to_id IN (${list})
        ORDER BY from_id, to_id, relationship`,
    )
    .all(...scope.owners, ...scope.owners) as {
    from_id: string;
    to_id: string;
    relationship: string;
    strength: string;
    context: string | null;
  }[];
  const items: Item[] = [
    ...seams.map((row) => ({
      kind: "seam",
      seam_id: row.id,
      shared_object: row.shared_object,
      shared_object_kind: row.shared_object_kind,
      party_a: row.party_a,
      party_b: row.party_b,
      // `seams` carries no revision column, so the row is not bound to one.
      ref_sha: null,
      revision_bound: false,
      authored: "model",
    })),
    ...xrefs.map((row) => ({
      kind: "xref",
      from_id: row.from_id,
      to_id: row.to_id,
      relationship: row.relationship,
      strength: row.strength,
      context: row.context,
      ref_sha: null,
      revision_bound: false,
      authored: "model",
    })),
  ];
  return { source_rows: items.length, items };
}

function buildTerms(db: DB, scope: AccountScope): SectionBuild {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (scope.owners.length) {
    conditions.push(`subsystem_id IN (${placeholders(scope.owners)})`);
    params.push(...scope.owners);
  }
  if (scope.path) {
    conditions.push("(first_seen = ? OR first_seen LIKE ?)");
    params.push(scope.path, `${scope.path}:%`);
  }
  if (scope.term) {
    conditions.push("term = ?");
    params.push(scope.term);
  }
  if (conditions.length === 0) return { source_rows: 0, items: [] };
  const rows = db
    .prepare(
      `SELECT term, gloss, subsystem_id, first_seen, ref_sha, created_at
         FROM vocabulary WHERE ${conditions.join(" OR ")} ORDER BY term`,
    )
    .all(...params) as {
    term: string;
    gloss: string;
    subsystem_id: string | null;
    first_seen: string | null;
    ref_sha: string | null;
    created_at: string;
  }[];
  return {
    source_rows: rows.length,
    // §4.3's "reverse creation order": the term recorded most recently is the
    // first to go. `created_at` decides it and is not served, so the order
    // travels beside the items rather than inside them.
    drop_keys: rows.map((row) => `${row.created_at}|${row.term}`),
    items: rows.map((row) => ({
      term: row.term,
      gloss: row.gloss,
      subsystem_id: row.subsystem_id,
      first_seen: row.first_seen,
      ref_sha: row.ref_sha,
      revision_bound: row.ref_sha !== null,
      authored: "model",
    })),
  };
}

/**
 * §3.1's leads: the same open leads and open questions §2.4.6 reports under
 * `unknown[]`, read through the same predicates. The standing block computed
 * them already, so they are re-shaped here rather than re-derived — a second
 * copy of the `location` matching rules is a second place for them to drift.
 */
function buildLeads(db: DB, standing: StandingBlock, locusKind: LocusKind): SectionBuild {
  const block =
    locusKind === "symbol"
      ? (standing as SymbolStandingBlock).file
      : (standing as FileStandingBlock);
  const unknown = Array.isArray(block?.unknown) ? block.unknown : [];
  const noteSha = db.prepare("SELECT ref_sha FROM field_notes WHERE id = ?");
  const questionSha = db.prepare("SELECT ref_sha FROM open_questions WHERE id = ?");
  const items: Item[] = [];
  for (const entry of unknown) {
    if (entry.kind === "open-lead") {
      const ref = (noteSha.get(entry.note_id as number) as { ref_sha: string | null } | undefined)
        ?.ref_sha;
      items.push({
        kind: "lead",
        note_id: entry.note_id,
        category: entry.category,
        observation: entry.observation,
        location: entry.location,
        location_match: entry.location_match,
        ref_sha: ref ?? null,
        revision_bound: (ref ?? null) !== null,
        authored: "model",
      });
    } else if (entry.kind === "open-question") {
      const ref = (
        questionSha.get(entry.question_id as number) as { ref_sha: string | null } | undefined
      )?.ref_sha;
      items.push({
        kind: "question",
        question_id: entry.question_id,
        category: entry.category,
        subsystem_id: entry.subsystem_id,
        question: entry.question,
        // `open_questions` carries no locus column (§2.4.6).
        scope: "subsystem",
        ref_sha: ref ?? null,
        revision_bound: (ref ?? null) !== null,
        authored: "model",
      });
    }
  }
  return { source_rows: items.length, items };
}

/**
 * §3.1's history pointer. The section declares `as_of_supported: true`, so a
 * historical reading owes it the same cut the defects section takes: an event
 * belongs to a reading at `as_of` when the revision it names is an ancestor of
 * it (§3.3, C16). Serving the whole event table under a historical reading
 * reported repairs that had not happened yet at the requested commit
 * (F8/codex).
 *
 * Two rows the cut cannot place are kept rather than dropped, matching
 * `resolutionAt`'s policy: an event that names no revision, and a session,
 * which has wall-clock timestamps and no revision at all. Both are marked
 * `as_of_placeable: false` so a reader knows the cut was not made by revision
 * alone, and the unplaceable events are counted.
 */
function buildHistoryPointer(
  db: DB,
  scope: AccountScope,
  findings: FindingRow[],
  probe: CommitProbe,
  asOf: string | null,
): SectionBuild {
  const findingIds = findings.map((row) => row.finding_id);
  const allEvents = findingIds.length
    ? (db
        .prepare(
          `SELECT id, finding_id, resolution_state, fix_sha, fix_location, rationale, recorded_at
             FROM finding_resolution_events WHERE finding_id IN (${placeholders(findingIds)})
            ORDER BY id`,
        )
        .all(...findingIds) as ResolutionEventRow[])
    : [];
  const events = asOf
    ? allEvents.filter((row) => !row.fix_sha || probe.isAncestor(row.fix_sha, asOf))
    : allEvents;
  const unplaceableEvents = asOf ? events.filter((row) => !row.fix_sha).length : 0;
  // C24's by-citation attribution: a session reaches this locus only through a
  // row that cites it — the evidence it collected here, or a finding it
  // recorded — never through a claim that the session touched the file.
  const sessionIds = new Set<string>();
  const cites = evidenceMatch(scope);
  if (cites) {
    for (const row of db
      .prepare(
        `SELECT DISTINCT e.session_id FROM evidence e
          WHERE ${cites.sql} AND e.session_id IS NOT NULL`,
      )
      .all(...cites.params) as { session_id: string }[]) {
      sessionIds.add(row.session_id);
    }
  }
  if (findingIds.length) {
    for (const row of db
      .prepare(
        `SELECT DISTINCT session_id FROM findings WHERE finding_id IN (${placeholders(findingIds)})
           AND session_id IS NOT NULL`,
      )
      .all(...findingIds) as { session_id: string }[]) {
      sessionIds.add(row.session_id);
    }
  }
  const sessions = sessionIds.size
    ? (db
        .prepare(
          `SELECT session_id, intent, started_at, ended_at, outcome FROM sessions
            WHERE session_id IN (${placeholders([...sessionIds])}) ORDER BY started_at, session_id`,
        )
        .all(...sessionIds) as {
        session_id: string;
        intent: string;
        started_at: string;
        ended_at: string | null;
        outcome: string | null;
      }[])
    : [];
  const items: Item[] = [
    ...events.map((row) => {
      const item: Item = {
        kind: "resolution-event",
        event_id: row.id,
        finding_id: row.finding_id,
        resolution_state: row.resolution_state,
        recorded_at: row.recorded_at,
        ref_sha: row.fix_sha,
        revision_bound: row.fix_sha !== null,
        authored: "model",
      };
      if (asOf) item.as_of_placeable = row.fix_sha !== null;
      return item;
    }),
    ...sessions.map((row) => {
      const item: Item = {
        kind: "session",
        session_id: row.session_id,
        intent: row.intent,
        started_at: row.started_at,
        ended_at: row.ended_at,
        ref_sha: null,
        revision_bound: false,
        authored: "code",
      };
      // A session carries timestamps and no revision, so the cut cannot place
      // it at a commit; §3.3 forbids placing it by wall clock instead.
      if (asOf) item.as_of_placeable = false;
      return item;
    }),
  ];
  return {
    source_rows: items.length,
    items,
    counts: {
      finding_resolution_events: events.length,
      sessions: sessions.length,
      ...(unplaceableEvents > 0 ? { as_of_unplaceable_events: unplaceableEvents } : {}),
    },
    // C24's declaration: a session reaches a locus only through a row that
    // cites it, never through a claim that the session touched the file.
    session_attribution: "by-citation",
  };
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// §4: the budgets, and the ledger that declares what they cost
// ---------------------------------------------------------------------------

/**
 * §4.1's table, as code constants. Every budget below is measured on the bytes
 * the host receives — the compact text block plus the `structuredContent` that
 * repeats it — except the two that §4.1 states over the compact payload's own
 * values, which are named for what they bound.
 */
const WIRE_BUDGET = 8192;
const WIRE_BUDGET_PER_OPTIONAL_SECTION = 4096;
const WIRE_CEILING = 32768;
const STANDING_VALUE_BUDGET = 3072;
const OPTIONAL_SECTION_VALUE_BUDGET = 4096;

/** §4.3: the id list an aggregated ledger entry carries, per entry. */
const OMITTED_IDS_BUDGET = 1024;
/**
 * The ladder that sub-budget walks down when every truncatable item is already
 * gone and the response is still over budget. Counts are never touched (§4.1);
 * only the sample of ids beside them shrinks, and it says that it did.
 */
const OMITTED_IDS_LADDER = [OMITTED_IDS_BUDGET, 512, 256, 128, 64, 0] as const;

/**
 * §4.3's order, named in the response so a reader can tell which policy
 * produced the answer, and versioned so a change to it is visible rather than
 * silent.
 */
const TRUNCATION_ORDER = "unknown-then-round-robin-sections-then-ledger-ids-v1";

/**
 * Retention across sections, highest retention first.
 *
 * §4.3 fixes the order *within* a section and leaves the order across them
 * open; this constant fills it. Retention is round-robin rather than
 * section-major: the deepest served list always gives up the next item, so
 * every section that holds something is sampled before any section is asked for
 * a second row. A section-major order would empty the last five sections
 * outright on any store large enough to truncate, which would make the account
 * a partial answer pretending to be a whole one. This list breaks the ties —
 * when several sections are equally deep, the one nearest the end gives way.
 */
const SECTION_RETENTION: readonly AccountSection[] = [
  "purpose", // one row per owner: the cheapest orientation the account has
  "defects", // what the record says is wrong, its own order leading with open
  "structure", // what the record says the locus is
  "boundaries", // what it touches
  "terms", // what its words mean here
  "leads", // what is unresolved; standing's unknown[] counts them too
  "reviews", // concern dispositions, opt-in
  "history_pointer", // detail behind a pointer whose counts are always served
];

/**
 * A stable id for every candidate, distinct across the whole response: the
 * ledger reconciles against the census by id (§4.3), so two rows that share an
 * id would let an omission stand for something it did not drop. Sections that
 * mix two sources name the source, because the two id spaces are independent.
 */
function itemId(section: AccountSection, item: Item): string {
  switch (section) {
    case "purpose":
      return `purpose:${String(item.subsystem_id)}`;
    case "structure":
      return `structure:${String(item.claim_id)}`;
    case "defects":
      return `defects:${String(item.finding_id)}`;
    case "reviews":
      return `reviews:${String(item.subsystem_id)}/${String(item.concern_code)}`;
    case "boundaries":
      return item.kind === "seam"
        ? `boundaries:seam/${String(item.seam_id)}`
        : `boundaries:xref/${String(item.from_id)}>${String(item.to_id)}/${String(item.relationship)}`;
    case "terms":
      return `terms:${String(item.term)}`;
    case "leads":
      return item.kind === "lead"
        ? `leads:note/${String(item.note_id)}`
        : `leads:question/${String(item.question_id)}`;
    case "history_pointer":
      return item.kind === "resolution-event"
        ? `history:event/${String(item.event_id)}`
        : `history:session/${String(item.session_id)}`;
  }
}

/** The same, for the standing block's unknown[] entries (§2.4.6). */
function unknownId(entry: UnknownEntry): string {
  switch (entry.kind) {
    case "concern-without-disposition":
      return `unknown:concern/${String(entry.subsystem_id)}/${String(entry.concern_code)}`;
    case "candidate-sibling":
      return `unknown:candidate-siblings/${String(entry.count)}`;
    case "open-question":
      return `unknown:question/${String(entry.question_id)}`;
    case "open-lead":
      return `unknown:lead/${String(entry.note_id)}`;
    case "unassessed-seam":
      return `unknown:seam/${String(entry.seam_id)}`;
    default:
      return `unknown:${String(entry.kind)}`;
  }
}

/**
 * §4.3's within-section order, as item indices with the most-retained first:
 * the last index returned is the first one dropped. Two of the eight rules are
 * §4.3's own words; the rest are stated here because §4.3 does not state them,
 * and each is a code constant rather than a judgment made per call.
 */
function retentionOrder(section: AccountSection, build: SectionBuild): number[] {
  const indices = build.items.map((_, index) => index);
  // A builder that reads a column it does not serve hands the order over as
  // keys: descending key order is drop order, so retention is ascending.
  if (build.drop_keys) {
    const keys = build.drop_keys;
    return indices.sort((a, b) => String(keys[a]).localeCompare(String(keys[b])));
  }
  if (section === "structure") {
    // §4.3: the weakest `evidence_kind` goes first. A claim with no attached
    // evidence ranks below every kind rather than above them.
    const rank = (index: number): number => {
      const kind = build.items[index]?.evidence_kind;
      const found = (EVIDENCE_KINDS as readonly string[]).indexOf(String(kind ?? ""));
      return found < 0 ? EVIDENCE_KINDS.length : found;
    };
    return indices.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        String(build.items[a]?.claim_id).localeCompare(String(build.items[b]?.claim_id)),
    );
  }
  if (section === "history_pointer") {
    // A pointer is most useful pointing at the latest conclusion, so recency
    // is retained and the oldest row gives way first. A resolution event is a
    // conclusion and a session is a visit, so the visits go first.
    const rank = (index: number): number =>
      build.items[index]?.kind === "resolution-event" ? 0 : 1;
    const recency = (index: number): string =>
      String(build.items[index]?.event_id ?? build.items[index]?.started_at ?? "");
    return indices.sort((a, b) => rank(a) - rank(b) || recency(b).localeCompare(recency(a)));
  }
  // The remaining five sections are already presented in retention order:
  //   defects      §3.1's partition order leads with the two non-terminal
  //                states and orders each partition by severity then id, so
  //                the tail is the weakest of the terminal states — which is
  //                exactly §4.3's "terminal states before the non-terminal";
  //   leads        `field_notes` and `open_questions` both in ascending id, so
  //                the tail is the newest — §4.3's "reverse creation order";
  //   boundaries   seams before xrefs, each in recorded order;
  //   purpose      one row per owner, in owner order;
  //   reviews      by subsystem then concern code.
  return indices;
}

interface OmissionEntry {
  section: string;
  reason: "policy" | "budget";
  count: number;
  ids: string[];
  ids_truncated: boolean;
}

interface DroppedGroup {
  section: string;
  reason: "policy" | "budget";
  /** Every dropped id, in the order they were dropped: never truncated here. */
  ids: string[];
}

/**
 * §4.3's ledger: one entry per `(section, reason)` with an exact count, and an
 * id list bounded by its own sub-budget. The count is what the census invariant
 * reconciles against, so it is never truncated; a truncated id list says so.
 */
function buildLedger(groups: readonly DroppedGroup[], idBudget: number): OmissionEntry[] {
  const out: OmissionEntry[] = [];
  for (const group of groups) {
    if (group.ids.length === 0) continue;
    const ids: string[] = [];
    // The brackets, then each id with its quotes and separator.
    let used = 2;
    for (const id of group.ids) {
      used += Buffer.byteLength(id, "utf8") + 3;
      if (used > idBudget) break;
      ids.push(id);
    }
    out.push({
      section: group.section,
      reason: group.reason,
      count: group.ids.length,
      ids,
      ids_truncated: ids.length < group.ids.length,
    });
  }
  return out;
}

/** The array standing keeps its unknown[] in, or null for a kind that has none. */
function standingUnknown(standing: StandingBlock, kind: LocusKind): UnknownEntry[] | null {
  const block = (kind === "symbol" ? (standing as SymbolStandingBlock).file : standing) as
    | { unknown?: unknown }
    | undefined;
  return Array.isArray(block?.unknown) ? (block.unknown as UnknownEntry[]) : null;
}

interface AccountTrace {
  model_calls: 0;
  selection: string;
  budget_bytes: number;
  payload_bytes: number;
  response_bytes: number;
  truncation_order: string;
  truncated: boolean;
  within_budget: boolean;
  over_budget_reason: string | null;
}

/**
 * §4.1's residual case, stated once. `owners[]`, every census and every
 * per-reason count are never truncated, so a locus with enough owners cannot be
 * brought inside its budget by dropping anything. The response says so rather
 * than refusing an answer the record can support; only the 32768-byte ceiling
 * is an error.
 */
const OVER_BUDGET_REASON =
  "This response is over its byte budget with every truncatable item already dropped: owners[], each section's census, and each omission count are never truncated.";

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

function describeLocusHandler(args: Record<string, unknown>, ctx: ServerContext) {
  const value = requireString(args, "locus");
  const kind = (optString(args, "kind") as LocusKind | null) ?? null;
  const requestedSections = optStringArray(args, "sections");
  const asOfArgument = optString(args, "as_of_sha");
  if (requestedSections) {
    for (const name of requestedSections) {
      if (!(ACCOUNT_SECTIONS as readonly string[]).includes(name)) {
        throw new ToolError(`unknown section: ${name}`);
      }
    }
  }
  const db = ctx.db;
  const probe = new CommitProbe(ctx);
  const asOf = asOfArgument ? probe.resolve(asOfArgument) : null;

  const { locus, standing } = describeLocusStanding(ctx, value, kind);
  const scope = buildScope(db, locus);
  const authorization = contentAuthorization(locus, standing);
  const findings = matchingFindings(db, scope);

  const wanted = new Set<AccountSection>(
    (requestedSections as AccountSection[] | null) ?? DEFAULT_SECTIONS,
  );
  const builders: Record<AccountSection, () => SectionBuild> = {
    purpose: () => buildPurpose(db, scope),
    structure: () => buildStructure(db, scope, authorization, probe, asOf),
    defects: () =>
      buildDefects(db, findings, probe, asOf, defectsEmptyStatement(locus, authorization.state)),
    reviews: () => buildReviews(db, scope),
    boundaries: () => buildBoundaries(db, scope),
    terms: () => buildTerms(db, scope),
    leads: () => buildLeads(db, standing, locus.kind),
    history_pointer: () => buildHistoryPointer(db, scope, findings, probe, asOf),
  };

  // §2.4.4: when the recorded reconciliation is behind the workspace head,
  // every section is marked as of the revision that was actually checked.
  const revision = (standing as { revision?: { unchecked_since?: string | null } }).revision;
  const uncheckedSince = revision?.unchecked_since ?? null;

  interface SectionState {
    name: AccountSection;
    view: SectionView;
    build: SectionBuild;
    requested: boolean;
    /** Item indices, most-retained first (§4.3). */
    retention: number[];
    /** How many of `retention` are still served. */
    keep: number;
    /** The array `view.items` holds; mutated in place as items are dropped. */
    served: Item[];
  }

  const sections: Record<string, SectionView> = {};
  const states: SectionState[] = [];
  const census: Record<string, number> = {};
  for (const name of ACCOUNT_SECTIONS) {
    const requested = wanted.has(name);
    const build = builders[name]();
    const served: Item[] = [];
    const view: SectionView = {
      census: build.items.length,
      recorded: build.source_rows > 0,
      requested,
      as_of_supported: name === "structure" || name === "defects" || name === "history_pointer",
      items: served,
    };
    // §4.2: `history_pointer`'s counts are on by default; only its detail is
    // opt-in, so the counts are attached whether or not the section was asked
    // for and the detail follows `requested` like every other section.
    if (build.counts) view.counts = build.counts;
    if (build.session_attribution) view.session_attribution = build.session_attribution;
    if (build.authorized === false) {
      view.authorized = false;
      view.withheld_unauthorized = build.withheld ?? 0;
      if (build.cannot_justify) view.cannot_justify = build.cannot_justify;
    }
    if (build.source_rows !== view.census) view.source_rows = build.source_rows;
    if (asOf && !view.as_of_supported) {
      view.statement = asOfUnsupportedSentence(asOf);
    } else if (build.statement) {
      view.statement = build.statement;
    }
    if (uncheckedSince) view.as_of = uncheckedSince;
    const retention = retentionOrder(name, build);
    states.push({
      name,
      view,
      build,
      requested,
      retention,
      keep: requested ? retention.length : 0,
      served,
    });
    census[name] = view.census;
    sections[name] = view;
  }
  const stateOf = (name: AccountSection): SectionState =>
    states.find((state) => state.name === name) as SectionState;

  // §4.1: unknown[]'s per-kind sample lists are truncated before anything
  // else, so they are grouped by kind and given up round-robin: a sample keeps
  // one of each kind for as long as it keeps any.
  const unknownArray = standingUnknown(standing, locus.kind);
  const unknownGroups: { entries: UnknownEntry[]; keep: number }[] = [];
  if (unknownArray) {
    const byKind = new Map<string, UnknownEntry[]>();
    for (const entry of unknownArray) {
      const group = byKind.get(entry.kind) ?? [];
      group.push(entry);
      byKind.set(entry.kind, group);
    }
    for (const entries of byKind.values()) unknownGroups.push({ entries, keep: entries.length });
    census.unknown = unknownArray.length;
  }
  const unknownAll = unknownArray ? [...unknownArray] : [];

  const optionalRequested = [...wanted].filter((name) => !DEFAULT_SECTIONS.includes(name)).length;
  const budgetBytes = Math.min(
    WIRE_CEILING,
    WIRE_BUDGET + WIRE_BUDGET_PER_OPTIONAL_SECTION * optionalRequested,
  );

  const omitted: OmissionEntry[] = [];
  const trace: AccountTrace = {
    model_calls: 0,
    selection: "registry-exact-v1",
    budget_bytes: budgetBytes,
    payload_bytes: 0,
    response_bytes: 0,
    truncation_order: TRUNCATION_ORDER,
    truncated: false,
    within_budget: true,
    over_budget_reason: null,
  };
  const payload = {
    contract_version: LOCUS_ACCOUNT_CONTRACT_VERSION,
    locus,
    standing,
    sections,
    census: {
      total: Object.values(census).reduce((sum, count) => sum + count, 0),
      by_section: census,
    },
    omitted,
    trace,
    current: asOf === null,
    as_of_sha: asOf,
  };

  let idBudget: number = OMITTED_IDS_BUDGET;

  /** Re-derive every truncation-dependent part of the payload in place. */
  function refresh(): void {
    for (const state of states) {
      const kept = new Set(state.retention.slice(0, state.keep));
      state.served.splice(
        0,
        state.served.length,
        ...state.build.items.filter((_, index) => kept.has(index)),
      );
    }
    if (unknownArray) {
      const kept = new Set<UnknownEntry>();
      for (const group of unknownGroups)
        for (const entry of group.entries.slice(0, group.keep)) kept.add(entry);
      unknownArray.splice(0, unknownArray.length, ...unknownAll.filter((entry) => kept.has(entry)));
    }
    const groups: DroppedGroup[] = [];
    if (unknownArray) {
      const dropped: string[] = [];
      for (const group of unknownGroups) {
        for (const entry of group.entries.slice(group.keep)) dropped.push(unknownId(entry));
      }
      if (dropped.length) groups.push({ section: "unknown", reason: "budget", ids: dropped });
    }
    for (const state of states) {
      // A section the call did not ask for is dropped whole, by policy; a
      // section it did ask for gives up its least-retained items, by budget.
      // The two reasons are exclusive by construction (§4.3).
      const reason: "policy" | "budget" = state.requested ? "budget" : "policy";
      const droppedIndices = state.requested ? state.retention.slice(state.keep) : state.retention;
      const ids = droppedIndices.map((index) =>
        itemId(state.name, state.build.items[index] as Item),
      );
      if (ids.length) groups.push({ section: state.name, reason, ids });
    }
    omitted.splice(0, omitted.length, ...buildLedger(groups, idBudget));
    trace.truncated = omitted.some((entry) => entry.reason === "budget");
  }

  /** §4.1's standing budget is stated over the compact payload's own value. */
  function standingBytes(): number {
    return Buffer.byteLength(JSON.stringify(standing), "utf8");
  }

  /**
   * The reported sizes are part of the response they measure, so they are
   * iterated to the fixed point where the number a response reports is the
   * number it has. Writing a longer number can only make the response longer,
   * so the iteration is monotone and settles in a pass or two.
   */
  function settle(): number {
    for (let pass = 0; pass < 8; pass += 1) {
      const compact = Buffer.byteLength(JSON.stringify(payload), "utf8");
      const wire = responseBytes(payload, { compact: true });
      if (trace.payload_bytes === compact && trace.response_bytes === wire) return wire;
      trace.payload_bytes = compact;
      trace.response_bytes = wire;
    }
    throw new ToolError("the response size could not be measured to a fixed point");
  }

  /** Give up one unknown[] entry, from the deepest per-kind sample. */
  function dropUnknown(): boolean {
    let deepest: { entries: UnknownEntry[]; keep: number } | null = null;
    for (const group of unknownGroups) {
      if (group.keep === 0) continue;
      if (!deepest || group.keep >= deepest.keep) deepest = group;
    }
    if (!deepest) return false;
    deepest.keep -= 1;
    refresh();
    return true;
  }

  /** Give up one item from the named section's least-retained end. */
  function dropFrom(name: AccountSection): boolean {
    const state = stateOf(name);
    if (state.keep === 0) return false;
    state.keep -= 1;
    refresh();
    return true;
  }

  /**
   * §4.3's order: unknown[]'s samples first, then one item from whichever
   * served list is deepest — the round-robin the retention list breaks ties
   * for.
   */
  function dropNext(): boolean {
    if (unknownGroups.some((group) => group.keep > 0)) return dropUnknown();
    let chosen: SectionState | null = null;
    for (const name of SECTION_RETENTION) {
      const state = stateOf(name);
      if (state.keep === 0) continue;
      if (!chosen || state.keep >= chosen.keep) chosen = state;
    }
    if (!chosen) return false;
    chosen.keep -= 1;
    refresh();
    return true;
  }

  /** The last resort: shrink the ledger's id samples, never its counts. */
  function shrinkIdBudget(): boolean {
    const next = OMITTED_IDS_LADDER.find((value) => value < idBudget);
    if (next === undefined) return false;
    idBudget = next;
    refresh();
    return true;
  }

  refresh();

  // §4.1's standing budget. unknown[] is the only part of the block that may
  // be truncated, so when the sample is gone the block is as small as the
  // record allows and the response says so under `within_budget`.
  while (standingBytes() > STANDING_VALUE_BUDGET && dropUnknown()) {
    /* refresh() re-measured the block; the condition re-reads it */
  }

  // §4.1's per-section budget, on each optional section the call asked for.
  for (const state of states) {
    if (!state.requested || DEFAULT_SECTIONS.includes(state.name)) continue;
    while (
      Buffer.byteLength(JSON.stringify(state.view), "utf8") > OPTIONAL_SECTION_VALUE_BUDGET &&
      dropFrom(state.name)
    ) {
      /* dropFrom() re-materialized the view; the condition re-reads it */
    }
  }

  // §4.1's wire budget, measured on the emitted response. Each pass drops what
  // the shortfall needs, sized against the largest served item so the estimate
  // never overshoots, and re-measures.
  for (let guard = 0; guard < 20000; guard += 1) {
    const wire = settle();
    if (wire <= budgetBytes) break;
    const largest = Math.max(
      1,
      ...states.flatMap((state) =>
        state.served.map((item) => Buffer.byteLength(JSON.stringify(item), "utf8")),
      ),
      ...(unknownArray ?? []).map((entry) => Buffer.byteLength(JSON.stringify(entry), "utf8")),
    );
    const step = Math.max(1, Math.floor((wire - budgetBytes) / (2 * largest)));
    let dropped = 0;
    for (let index = 0; index < step; index += 1) {
      if (!dropNext()) break;
      dropped += 1;
    }
    if (dropped === 0 && !shrinkIdBudget()) break;
  }

  const wire = settle();
  // §4.1: exceeding the hard ceiling is an error, not a truncation. The two
  // are different failures: a budget the response cannot reach is declared,
  // because the record still supports the answer; a response past the ceiling
  // is refused, because no host should be handed it.
  if (wire > WIRE_CEILING) {
    throw new ToolError(
      `this locus cannot be served inside the ${WIRE_CEILING}-byte ceiling: the untruncatable part of the response measures ${wire} bytes`,
    );
  }
  if (wire > budgetBytes) {
    trace.within_budget = false;
    trace.over_budget_reason = OVER_BUDGET_REASON;
    settle();
  }

  // §4.3's invariant, checked before returning: a response that cannot
  // reconcile its own census fails rather than returning a smaller
  // truthful-looking answer.
  for (const [name, count] of Object.entries(census)) {
    const served =
      name === "unknown" ? (unknownArray?.length ?? 0) : (sections[name]?.items.length ?? 0);
    const dropped = omitted
      .filter((entry) => entry.section === name)
      .reduce((total, entry) => total + entry.count, 0);
    if (served + dropped !== count) {
      throw new ToolError(
        `section ${name} cannot reconcile its census: ${served} selected + ${dropped} omitted != ${count}`,
      );
    }
  }
  return payload;
}

export const locusTools: ToolDefinition[] = [
  {
    name: "describe_locus",
    description:
      "Return what the conspectus records about one file, symbol, subsystem, or term: its standing — what the record authorizes and what it cannot justify — followed by the recorded account. Reads only; makes no model call and generates no text. An unknown locus returns a standing state, not an error. Pass `sections` to choose exactly which account sections to return; omit it for the default set. The response is bounded: what does not fit is declared in `omitted[]` with an exact count, never dropped silently.",
    inputSchema: {
      type: "object",
      properties: {
        locus: { type: "string", minLength: 1 },
        kind: { type: "string", enum: ["file", "symbol", "subsystem", "term"] },
        sections: {
          type: "array",
          items: { type: "string", enum: [...ACCOUNT_SECTIONS] },
        },
        as_of_sha: { type: "string" },
      },
      required: ["locus"],
      additionalProperties: false,
    },
    // §4.1: the text block is serialized without indentation, because the
    // budget is measured on the bytes the host receives.
    compact: true,
    handler: describeLocusHandler,
  },
];
