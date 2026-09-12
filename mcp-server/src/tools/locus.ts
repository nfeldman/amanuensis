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
  citationTokensIn,
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
import { ATTENTION_LABELS, EVIDENCE_KINDS, SEVERITIES } from "../vocabulary.js";

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

  /** The workspace head, or null when git cannot answer. */
  head(): string | null {
    const result = this.run(["rev-parse", "--verify", "HEAD"]);
    return result.status === 0 && result.stdout ? result.stdout : null;
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
  /**
   * §9.1's `claim_key` namespace for a subsystem locus, as a LIKE pattern.
   *
   * §3.1's two arms — the subject id and the evidence citation — do not select
   * every claim a subsystem owns: §9.1 gives a seam claim `subject_type: seam`
   * and a `<sid>/seam/<id>` key, so a seam contract whose evidence cites a file
   * outside this subsystem's ledger matches neither arm. §9.1's phase
   * prerequisite and §7.3's page both read the `<sid>/` namespace, so the tool
   * reads it too; without it the two surfaces would answer "what does this
   * subsystem claim" differently, and a claim would be current on one and
   * absent from the other. Null for every other locus kind, which has no
   * namespace of its own.
   */
  claimKeyPrefix: string | null;
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
      claimKeyPrefix: `${id.replace(/([%_\\])/g, "\\$1")}/%`,
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
      claimKeyPrefix: null,
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
    claimKeyPrefix: null,
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
  narrative?: NarrativePointer;
  /**
   * §4.3's drop order for a section whose rule reads a column the response does
   * not serve: one opaque key per item, descending key order being drop order.
   * Absent for the seven sections whose order is readable from their items.
   */
  drop_keys?: string[];
}

/**
 * §3.4's narrative attachment, in the only shape §3.4 permits: a pointer, not
 * prose. The survey artifact is model-authored and not bound to any revision
 * item by item, so it is served as a path and a content hash a reader can
 * resolve — §9.1 renders its body on the subsystem page, where the labelling
 * travels with it, and never inside a response §4.1 bounds to 8192 bytes.
 *
 * That settles the drift F7/codex left open across §4.2, §5.1 and §9.1, in one
 * place. §4.2 lists `narrative` as opt-in while §5.1 fixes this tool's
 * signature at `locus`/`kind`/`sections`/`as_of_sha` and constrains `sections`
 * to §3.1's eight names, so no channel exists to opt in — read as a contract on
 * the *tool*, the two cannot both hold. They are not both about the tool.
 * §4.2's `narrative` names the narrative **body**, which no tool response
 * serves under any option: §9.1's "on the page only" is where it is opt-in, and
 * the page is where opting in happens. What §3.4 attaches here is the locator,
 * about 200 bytes of code-authored path and hash, which travels with
 * `structure` and is therefore on by default alongside it. No claim changes,
 * §5.1's input surface is not widened, and the two tools P14 adds carry no
 * narrative channel of their own — `get_attention`'s `sections` is a different
 * enum over §5.2's seven names.
 */
interface NarrativePointer {
  artifact_path: string;
  content_hash: string | null;
  revision_bound: false;
  label: string;
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
  narrative?: NarrativePointer;
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

/**
 * §9.1's literal. A reader — and a checker — must be able to tell the absence
 * of a *record* from the absence of the thing recorded (§2.3, §4.3).
 */
const NO_CLAIMS_STATEMENT = "Structural inventory not recorded as claims";

/** §3.4's label, carried verbatim beside every narrative pointer. */
const NARRATIVE_LABEL = "Narrative from the survey artifact; not individually bound to a revision";

/**
 * §3.4's narrative attachment for a subsystem locus with no current claim.
 *
 * Only a subsystem has one: the `subsystem-survey` artifact is written per
 * subsystem, and attaching an owner's narrative to one of its files would
 * assert that the prose is about that file, which nothing recorded it as. A
 * subsystem that records several survey artifacts serves the first by path —
 * the pointer is a pointer, and §9.1's page renders every one of them, so
 * nothing is hidden from a reader by the choice.
 */
function surveyNarrative(db: DB, scope: AccountScope): NarrativePointer | null {
  if (!scope.subsystemId) return null;
  const row = db
    .prepare(
      `SELECT path, content_hash FROM artifacts
        WHERE kind = 'subsystem-survey' AND subsystem_id = ?
        ORDER BY path LIMIT 1`,
    )
    .get(scope.subsystemId) as { path: string; content_hash: string | null } | undefined;
  if (!row) return null;
  return {
    artifact_path: row.path,
    content_hash: row.content_hash,
    revision_bound: false,
    label: NARRATIVE_LABEL,
  };
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
  if (scope.claimKeyPrefix) {
    conditions.push("c.claim_key LIKE ? ESCAPE '\\'");
    params.push(scope.claimKeyPrefix);
  }
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
  if (items.length > 0) return { source_rows: rows.length, items };
  // §9.1: an authorized locus with no claim says so in the literal §9.1 fixes,
  // and never renders an empty section as if the locus had no structure. The
  // sentence is about the *record*, not about the code: "not recorded as
  // claims" is what the store can support, where "has no structure" is not.
  const narrative = surveyNarrative(db, scope);
  return {
    source_rows: rows.length,
    items,
    statement: NO_CLAIMS_STATEMENT,
    ...(narrative ? { narrative } : {}),
  };
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
    ...xrefs.map((row) => {
      // §9.2 requires every recorded edge to cite a resolvable revision inside
      // its prose `context`, and those tokens are served here: reading them
      // back is lexical, since the write path already resolved each against
      // the workspace and a read must not shell out to git once per edge.
      //
      // They do not bind the item. `xrefs` has no `ref_sha` column, so §3.2
      // holds the row unbound: a citation is the revision one *reading* was
      // taken at, not a revision the edge is valid at, and an edge whose prose
      // cites several has no single one to promote. Electing the first token
      // would present the relation as pinned to whichever revision the writer
      // happened to mention first, and would contradict P6's gate on this same
      // section. A reader wanting the revisions reads `citations[]`, where the
      // count is visible (slice-S4 F5/codex).
      const citations = citationTokensIn(row.context);
      return {
        kind: "xref",
        from_id: row.from_id,
        to_id: row.to_id,
        relationship: row.relationship,
        strength: row.strength,
        context: row.context,
        citations,
        ref_sha: null,
        revision_bound: false,
        authored: "model",
      };
    }),
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

/**
 * §4.1's budgets are measured on the bytes the host receives, and the locus a
 * caller names is echoed into the parts of a response that are never
 * truncatable: the subject or scope block, and each section's empty-state
 * statement. An unbounded subject therefore buys unbounded untruncatable
 * bytes, which is how a schema-valid call was made to serve four times its
 * budget (F1/codex).
 *
 * The bound is read off the arithmetic rather than chosen: the wire envelope
 * repeats the payload, so each byte of subject costs four — two echoes,
 * doubled — and `get_history`'s floor over an empty subject measures about
 * 3800 bytes against an 8192-byte budget. 512 bytes leaves roughly 2400 for
 * served rows, and is some five times the longest path this repository holds.
 * It is enforced here, in code, and advertised as `maxLength`; a host that
 * validates its calls and one that does not are refused alike.
 */
const MAX_SUBJECT_LENGTH = 512;

function boundedSubject(name: string, value: string): string {
  const length = Buffer.byteLength(value, "utf8");
  if (length > MAX_SUBJECT_LENGTH) {
    throw new ToolError(
      `${name} is ${length} bytes, over the ${MAX_SUBJECT_LENGTH}-byte limit: a locus is a file path, a symbol, a subsystem id, or a term.`,
    );
  }
  return value;
}

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
      // §2.4.6's census unit is the (seam, side) pair, so the seam alone names
      // two members at any file both parties own, and the ledger could not say
      // which side went unserved (F9/codex). The subsystem follows the side
      // because "side b" is only meaningful against the seam row a reader
      // would otherwise have to go and fetch.
      return `unknown:seam/${String(entry.seam_id)}/${String(entry.side)}/${String(entry.subsystem_id)}`;
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
  const value = boundedSubject("locus", requireString(args, "locus"));
  const kind = (optString(args, "kind") as LocusKind | null) ?? null;
  const requestedSections = optStringArray(args, "sections");
  const asOfArgument = optString(args, "as_of_sha");
  if (asOfArgument !== null) boundedSubject("as_of_sha", asOfArgument);
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
    // §3.4: the narrative travels with the section that has no claims to serve,
    // and never beside items. It is a pointer of about 200 bytes and is not a
    // truncation candidate: dropping it would leave the literal standing with
    // nothing a reader could go and read.
    if (build.narrative) view.narrative = build.narrative;
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
    // C8 makes this refusal actionable rather than merely correct: it names
    // the locus and how many owners it has, because the caller's next move is
    // `list_scope(subsystem_id)` and a byte count does not tell them which
    // locus to go and read (F6/codex).
    const ownerCount = standingUnknown(standing, locus.kind) === null ? null : scope.owners.length;
    const owners = ownerCount === null ? "" : `, which has ${ownerCount} owning subsystem(s)`;
    throw new ToolError(
      `${locus.value} cannot be served inside the ${WIRE_CEILING}-byte ceiling: the untruncatable part of the response measures ${wire} bytes${owners}. Read the owners from list_scope instead.`,
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

// ---------------------------------------------------------------------------
// §5.2, §5.3: the two lens tools, and the budget engine they share
// ---------------------------------------------------------------------------

/** §5.2's contract, shipped at contracts/attention.schema.json. */
export const ATTENTION_CONTRACT_VERSION = "1.0.0";
/** §5.3's contract, shipped at contracts/locus-history.schema.json. */
export const LOCUS_HISTORY_CONTRACT_VERSION = "1.0.0";

/** §5.2's sections, in the order the response presents them. */
export const ATTENTION_SECTIONS = [
  "open",
  "awaiting_verification",
  "undiscriminated",
  "decisions",
  "leads",
  "stale",
  "hot_spots",
] as const;
type AttentionSection = (typeof ATTENTION_SECTIONS)[number];

/** §5.3's families, in the order the response presents them. */
export const HISTORY_SECTIONS = [
  "resolutions",
  "claims",
  "contradictions",
  "questions",
  "leads",
  "sessions",
] as const;
type HistorySection = (typeof HISTORY_SECTIONS)[number];

/** §4.1's two remaining budgets. */
const ATTENTION_WIRE_BUDGET = 12288;
const HISTORY_WIRE_BUDGET = 8192;

/**
 * Retention across sections, highest retention first, for both tools.
 *
 * The rule is `describe_locus`'s: the deepest served list gives up the next
 * item, so every section that holds something is sampled before any section is
 * asked for a second row, and this list breaks the ties — the section nearest
 * the end gives way first. A section-major order would empty the last families
 * outright on any store large enough to truncate, which would turn a partial
 * answer into one that looks whole.
 */
const ATTENTION_RETENTION: readonly AttentionSection[] = [
  "open", // what the record says is wrong and unrepaired
  "awaiting_verification", // repairs with no proof yet
  "undiscriminated", // where two accounts still stand
  "decisions", // what only a human can settle
  "stale", // readings the repository has moved under
  "leads", // suspicions that are not yet findings
  "hot_spots", // measures, derivable from the sections above
];

const HISTORY_RETENTION: readonly HistorySection[] = [
  "resolutions",
  "contradictions",
  "claims",
  "questions",
  "leads",
  "sessions",
];

const ROUND_ROBIN_TRUNCATION_ORDER = "round-robin-sections-then-ledger-ids-v1";

/**
 * §4.1's residual case for the two tools: `census`, every per-reason `count`,
 * and the scope block are never truncated, so a response can be over budget
 * with nothing left to drop. It says so rather than refusing an answer the
 * record supports.
 *
 * What it may not do is drift arbitrarily far past the number the trace
 * advertises. §4.1 gives these two tools one budget each; the 32768-byte
 * ceiling is `describe_locus`'s expanded budget and means nothing here
 * (F1/codex), so the residue is bounded by a ceiling derived from the tool's
 * own budget. The untruncatable floor is the subject or scope block, the
 * section views and their statements, the census, the ledger counts, and the
 * trace; measured on this packet's gate fixture it is 3792 bytes for
 * `get_history` against 8192 and 4724 for `get_attention` against 12288, both
 * under half. No larger store has been measured, so the factor is headroom
 * chosen against that one measurement rather than a number the record has
 * earned: it is the room the record gets before the call is refused with the
 * remedy named, because no host should be handed three times what it was told
 * to expect. `get_attention` echoes its whole subsystem list untruncatably, so
 * a store with enough subsystems will reach the residue honestly; if one ever
 * reaches the ceiling, re-measure before raising the factor.
 */
const ROUND_ROBIN_CEILING_FACTOR = 2;
const ROUND_ROBIN_OVER_BUDGET_REASON =
  "This response is over its byte budget with every truncatable item already dropped: each section's census and each omission count are never truncated.";

interface BudgetedSection {
  name: string;
  /** Rows the source holds for this scope, before the section's own policy. */
  source_rows: number;
  /** Eligible candidates, already in retention order: the last is dropped first. */
  items: Item[];
  /** Stable ids, parallel to `items`. */
  ids: string[];
  /**
   * Candidates the section's own policy excludes: counted in the census and
   * recorded in the ledger under `policy`, never served. §4.3's two reasons are
   * the only ones, and ADR-0011 defines `policy` as exclusion by the declared
   * mode policy — which is what a candidate no §5.2 label covers is.
   */
  policy_ids: string[];
  statement?: string;
  counts?: Record<string, number>;
  session_attribution?: string;
  ordering_basis?: string;
  seam_binding?: string;
}

interface RoundRobinTrace {
  model_calls: 0;
  selection: string;
  budget_bytes: number;
  payload_bytes: number;
  response_bytes: number;
  truncation_order: string;
  truncated: boolean;
  within_budget: boolean;
  over_budget_reason: string | null;
  limit: number | null;
}

interface BudgetedView {
  census: number;
  recorded: boolean;
  requested: boolean;
  items: Item[];
  statement?: string;
  counts?: Record<string, number>;
  session_attribution?: string;
  ordering_basis?: string;
  seam_binding?: string;
}

/**
 * §4.1 and §4.3, for the two tools that carry one budget each.
 *
 * `describe_locus` keeps its own loop rather than sharing this one, because it
 * enforces three budgets this does not — the standing block's value, each
 * optional section's value, and the 32768-byte ceiling error that names the
 * locus's owners. The parts both need are the ones that decide whether a
 * response is honest: `buildLedger`'s aggregation, the id sub-budget ladder,
 * and the census invariant, all of which are shared.
 */
function serveWithinBudget(
  sections: readonly BudgetedSection[],
  budgetBytes: number,
  limit: number | null,
  /** Highest retention first; ties are broken toward the front of this list. */
  retention: readonly string[],
  requested: (name: string) => boolean,
  assemble: (parts: {
    sections: Record<string, BudgetedView>;
    census: { total: number; by_section: Record<string, number> };
    omitted: OmissionEntry[];
    trace: RoundRobinTrace;
  }) => Record<string, unknown>,
): Record<string, unknown> {
  interface State {
    section: BudgetedSection;
    view: BudgetedView;
    served: Item[];
    keep: number;
    wanted: boolean;
  }
  const states: State[] = [];
  const views: Record<string, BudgetedView> = {};
  const census: Record<string, number> = {};
  for (const section of sections) {
    const wanted = requested(section.name);
    const served: Item[] = [];
    const total = section.items.length + section.policy_ids.length;
    const view: BudgetedView = {
      census: total,
      recorded: section.source_rows > 0,
      requested: wanted,
      items: served,
    };
    if (section.statement) view.statement = section.statement;
    if (section.counts) view.counts = section.counts;
    if (section.session_attribution) view.session_attribution = section.session_attribution;
    if (section.ordering_basis) view.ordering_basis = section.ordering_basis;
    if (section.seam_binding) view.seam_binding = section.seam_binding;
    // §4.3: an item limit evicts under `budget`, the same reason the byte
    // budget evicts under, because both are the caller's ranking cut rather
    // than a policy about what the section holds.
    const ceiling = limit === null ? section.items.length : Math.min(limit, section.items.length);
    states.push({ section, view, served, keep: wanted ? ceiling : 0, wanted });
    views[section.name] = view;
    census[section.name] = total;
  }

  const omitted: OmissionEntry[] = [];
  const trace: RoundRobinTrace = {
    model_calls: 0,
    selection: "registry-exact-v1",
    budget_bytes: budgetBytes,
    payload_bytes: 0,
    response_bytes: 0,
    truncation_order: ROUND_ROBIN_TRUNCATION_ORDER,
    truncated: false,
    within_budget: true,
    over_budget_reason: null,
    limit,
  };
  const payload = assemble({
    sections: views,
    census: {
      total: Object.values(census).reduce((sum, count) => sum + count, 0),
      by_section: census,
    },
    omitted,
    trace,
  });

  let idBudget: number = OMITTED_IDS_BUDGET;

  function refresh(): void {
    const groups: DroppedGroup[] = [];
    for (const state of states) {
      state.served.splice(0, state.served.length, ...state.section.items.slice(0, state.keep));
      const policy = state.wanted
        ? [...state.section.policy_ids]
        : [...state.section.policy_ids, ...state.section.ids];
      if (policy.length) {
        groups.push({ section: state.section.name, reason: "policy", ids: policy });
      }
      if (state.wanted) {
        const budgetDropped = state.section.ids.slice(state.keep);
        if (budgetDropped.length) {
          groups.push({ section: state.section.name, reason: "budget", ids: budgetDropped });
        }
      }
    }
    omitted.splice(0, omitted.length, ...buildLedger(groups, idBudget));
    trace.truncated = omitted.some((entry) => entry.reason === "budget");
  }

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

  /** One item from whichever served list is deepest; `retention` breaks ties. */
  const byRetention = [...states].sort(
    (a, b) => retention.indexOf(a.section.name) - retention.indexOf(b.section.name),
  );
  function dropNext(): boolean {
    let chosen: State | null = null;
    for (const state of byRetention) {
      if (state.keep === 0) continue;
      if (!chosen || state.keep >= chosen.keep) chosen = state;
    }
    if (!chosen) return false;
    chosen.keep -= 1;
    refresh();
    return true;
  }

  function shrinkIdBudget(): boolean {
    const next = OMITTED_IDS_LADDER.find((value) => value < idBudget);
    if (next === undefined) return false;
    idBudget = next;
    refresh();
    return true;
  }

  refresh();
  for (let guard = 0; guard < 20000; guard += 1) {
    const wire = settle();
    if (wire <= budgetBytes) break;
    const largest = Math.max(
      1,
      ...states.flatMap((state) =>
        state.served.map((item) => Buffer.byteLength(JSON.stringify(item), "utf8")),
      ),
    );
    const step = Math.max(1, Math.floor((wire - budgetBytes) / (2 * largest)));
    let dropped = 0;
    for (let index = 0; index < step; index += 1) {
      if (!dropNext()) break;
      dropped += 1;
    }
    if (dropped === 0 && !shrinkIdBudget()) break;
  }

  // The drop step is sized against the largest served item, so a pass can give
  // up more than the shortfall needed. Take back what still fits, highest
  // retention first: a budget met with room to spare is a smaller answer than
  // the record supports, and the ledger would declare a drop that was not
  // required.
  for (let guard = 0; guard < 20000; guard += 1) {
    let grown: State | null = null;
    for (const state of byRetention) {
      if (state.keep >= state.section.items.length || !state.wanted) continue;
      if (limit !== null && state.keep >= limit) continue;
      if (!grown || state.keep < grown.keep) grown = state;
    }
    if (!grown) break;
    grown.keep += 1;
    refresh();
    if (settle() > budgetBytes) {
      grown.keep -= 1;
      refresh();
      settle();
      break;
    }
  }

  const wire = settle();
  const ceiling = budgetBytes * ROUND_ROBIN_CEILING_FACTOR;
  if (wire > ceiling) {
    throw new ToolError(
      `this response cannot be served inside the ${ceiling}-byte ceiling on a ${budgetBytes}-byte budget: the untruncatable part measures ${wire} bytes. Narrow the call with scope, sections, or a shorter subject.`,
    );
  }
  if (wire > budgetBytes) {
    trace.within_budget = false;
    trace.over_budget_reason = ROUND_ROBIN_OVER_BUDGET_REASON;
    settle();
  }

  // §4.3's invariant, checked before returning.
  for (const state of states) {
    const dropped = omitted
      .filter((entry) => entry.section === state.section.name)
      .reduce((total, entry) => total + entry.count, 0);
    if (state.served.length + dropped !== state.view.census) {
      throw new ToolError(
        `section ${state.section.name} cannot reconcile its census: ${state.served.length} selected + ${dropped} omitted != ${state.view.census}`,
      );
    }
  }
  return payload;
}

// ---------------------------------------------------------------------------
// §5.2: get_attention
// ---------------------------------------------------------------------------

/**
 * §5.2's seven labels, as a code constant checked against the vocabulary
 * source by `test-vocabulary-source.mjs`. Four are ADR-0010's operational
 * definitions reused verbatim, two are this tool's own, and `open` is
 * `finding_state_current.resolution_state`'s own value rather than a label
 * anything here invents.
 *
 * Three of ADR-0010's seven are deliberately absent. `ruled-out-historical` is
 * History, not Unresolved. The A7 challenge aggregation — *survived*,
 * *contested*, *defeated* — is terminal over a hypothesis a composition
 * references, and this tool has no composition. `latent-defect` is defined
 * over the impact base of an A8 composition, which this tool also has no
 * access to; substituting a different base under the same word is the
 * overloading decision 6 exists to prevent, so the findings that would have
 * carried it are `open`.
 */

interface AttentionScope {
  requested: string | null;
  kind: "project" | "subsystem" | "path-prefix";
  subsystems: string[];
  path_prefix: string | null;
  /** False when the argument names nothing the store holds. */
  resolved: boolean;
}

function likeEscape(value: string): string {
  return value.replace(/([%_\\])/g, "\\$1");
}

/**
 * §5.2's scope argument, disambiguated by §2.1's rule: an exact `subsystems.id`
 * decides first, and anything else is read as a repository path prefix. A
 * prefix that names no ledgered path resolves to an honest empty rather than
 * to the whole project, because silently widening a scope nobody asked for is
 * how a narrow question gets a wide answer.
 */
function resolveAttentionScope(db: DB, requested: string | null): AttentionScope {
  const everySubsystem = (
    db.prepare("SELECT id FROM subsystems ORDER BY id").all() as { id: string }[]
  ).map((row) => row.id);
  if (!requested) {
    return {
      requested: null,
      kind: "project",
      subsystems: everySubsystem,
      path_prefix: null,
      resolved: true,
    };
  }
  const subsystem = db.prepare("SELECT id FROM subsystems WHERE id = ?").get(requested) as
    | { id: string }
    | undefined;
  if (subsystem) {
    return {
      requested,
      kind: "subsystem",
      subsystems: [subsystem.id],
      path_prefix: null,
      resolved: true,
    };
  }
  const owners = (
    db
      .prepare(
        "SELECT DISTINCT subsystem_id FROM file_ledger WHERE file_path LIKE ? ESCAPE '\\' ORDER BY subsystem_id",
      )
      .all(`${likeEscape(requested)}%`) as { subsystem_id: string }[]
  ).map((row) => row.subsystem_id);
  return {
    requested,
    kind: "path-prefix",
    subsystems: owners,
    path_prefix: requested,
    resolved: owners.length > 0,
  };
}

/** Whether a stored path lies under the scope, or true when no prefix is set. */
function pathInScope(scope: AttentionScope, path: string | null): boolean {
  if (!scope.path_prefix) return true;
  return path?.startsWith(scope.path_prefix) === true;
}

/**
 * The repository paths the scope's subsystems own, read from `file_ledger`.
 * A subsystem scope names a set of files as much as it names an id, so this is
 * what lets a record that cites a path be reached by the scope that owns it.
 * Read once per response rather than per row.
 */
function scopeOwnedPaths(db: DB, scope: AttentionScope): ReadonlySet<string> {
  if (scope.subsystems.length === 0) return new Set();
  const rows = db
    .prepare(
      `SELECT DISTINCT file_path FROM file_ledger
        WHERE subsystem_id IN (${placeholders(scope.subsystems)})`,
    )
    .all(...scope.subsystems) as { file_path: string }[];
  return new Set(rows.map((row) => row.file_path));
}

/**
 * Whether a `field_notes.location` names something in scope. The column is a
 * comma-separated free-text list of paths, symbols, and subsystem ids
 * (`schema.sql:344`), so each token is tested three ways: against the scope's
 * subsystem ids, against its path prefix, and against the paths its subsystems
 * own in `file_ledger`. The third is what makes a subsystem scope reach a note
 * that cites one of its files rather than its id — a note names where the
 * observation was made, and nothing obliges it to name the owner (F2/codex).
 * This is scope membership, not §2.4.6's per-locus binding, which is why it is
 * a separate predicate rather than a second copy of `standing.ts`'s
 * `locationMatch`.
 */
function locationInScope(
  scope: AttentionScope,
  location: string | null,
  ownedPaths: ReadonlySet<string>,
): boolean {
  if (scope.kind === "project") return true;
  if (!location) return false;
  const tokens = location
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  for (const token of tokens) {
    if (scope.subsystems.includes(token)) return true;
    const path = token.split("@")[0]?.split(":")[0] ?? token;
    if (scope.path_prefix && path.startsWith(scope.path_prefix)) return true;
    if (ownedPaths.has(path)) return true;
  }
  return false;
}

interface AttentionFinding {
  finding_id: string;
  subsystem_id: string;
  severity: string;
  resolution_state: string;
  ref_sha: string | null;
  primary_files: string | null;
}

/**
 * The unresolved findings in scope: §6.1's Unresolved predicate, narrowed by
 * the scope argument. A path prefix narrows by what the finding *cites* — an
 * evidence row or a `primary_files` citation under the prefix — rather than by
 * its subsystem alone, because a subsystem owning one file under the prefix
 * would otherwise answer for every finding it holds.
 */
function attentionFindings(db: DB, scope: AttentionScope): AttentionFinding[] {
  return findingsInScope(db, scope, ["open", "fixed-pending-verification"]);
}

/**
 * Every finding the scope reaches, at the resolution states asked for, or at
 * every state when `states` is null. The two callers want different sets and
 * the *scoping* is the same for both, which is why it lives here once: what
 * scope a finding lies in is a question about where it was recorded, never
 * about what state it has since reached (F9/codex).
 */
function findingsInScope(
  db: DB,
  scope: AttentionScope,
  states: readonly string[] | null,
): AttentionFinding[] {
  if (scope.subsystems.length === 0) return [];
  const stateFilter = states === null ? "" : `AND s.resolution_state IN (${placeholders(states)}) `;
  const rows = db
    .prepare(
      `SELECT s.finding_id, s.subsystem_id, s.severity, s.resolution_state,
              f.ref_sha, f.primary_files
         FROM finding_state_current s JOIN findings f ON f.finding_id = s.finding_id
        WHERE s.subsystem_id IN (${placeholders(scope.subsystems)})
          ${stateFilter}
        ORDER BY s.finding_id`,
    )
    .all(...scope.subsystems, ...(states ?? [])) as AttentionFinding[];
  if (!scope.path_prefix) return rows;
  const cited = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT fe.finding_id FROM finding_evidence fe
             JOIN evidence e ON e.id = fe.evidence_id
            WHERE e.file_path LIKE ? ESCAPE '\\'`,
        )
        .all(`${likeEscape(scope.path_prefix)}%`) as { finding_id: string }[]
    ).map((row) => row.finding_id),
  );
  return rows.filter((row) => {
    if (cited.has(row.finding_id)) return true;
    if (!row.primary_files) return false;
    let entries: unknown;
    try {
      entries = JSON.parse(row.primary_files);
    } catch {
      return false;
    }
    if (!Array.isArray(entries)) return false;
    return entries.some((entry) => {
      if (typeof entry !== "string") return false;
      const citation = entry.split("@")[0] ?? entry;
      const colon = citation.indexOf(":");
      const path = colon === -1 ? citation : citation.slice(0, colon);
      return path.startsWith(scope.path_prefix as string);
    });
  });
}

/** The revision the response is read against: the reconciled head, else HEAD. */
function checkedSha(db: DB, probe: CommitProbe): string | null {
  const row = db
    .prepare("SELECT last_checked_sha FROM git_state WHERE repo_id = 'default'")
    .get() as { last_checked_sha: string | null } | undefined;
  if (row?.last_checked_sha) return row.last_checked_sha;
  return probe.head();
}

function severityOrder(a: AttentionFinding, b: AttentionFinding): number {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    a.subsystem_id.localeCompare(b.subsystem_id) ||
    a.finding_id.localeCompare(b.finding_id)
  );
}

function buildAttentionFindingSection(
  name: "open" | "awaiting_verification",
  findings: AttentionFinding[],
  priorVerified: ReadonlySet<string>,
  emptyStatement: string,
): BudgetedSection {
  const state = name === "open" ? "open" : "fixed-pending-verification";
  const rows = findings.filter((row) => row.resolution_state === state).sort(severityOrder);
  const items: Item[] = rows.map((row) => {
    const regression = name === "open" && priorVerified.has(row.finding_id);
    const item: Item = {
      finding_id: row.finding_id,
      label: regression ? "regression" : name === "open" ? "open" : "awaiting-verification",
      severity: row.severity,
      subsystem_id: row.subsystem_id,
      ref_sha: row.ref_sha,
      revision_bound: row.ref_sha !== null,
      authored: "code",
    };
    if (regression) item.prior_verified_fixed = true;
    return item;
  });
  const section: BudgetedSection = {
    name,
    source_rows: rows.length,
    items,
    ids: rows.map((row) => `finding:${row.finding_id}`),
    policy_ids: [],
    ordering_basis: "severity-then-subsystem-then-id",
  };
  if (rows.length === 0) section.statement = emptyStatement;
  return section;
}

/** §5.2's `undiscriminated`: the three sources that share the one property. */
/**
 * §5.2's `undiscriminated`: the records where two credible accounts still
 * stand. `scopedFindingIds` is every finding the scope reaches at any
 * resolution state, not the unresolved ones: whether two accounts still stand
 * is a question about the contradiction, and a contradiction between two
 * findings that have each reached a terminal state is exactly the case where
 * nobody has picked between them (F9/codex).
 */
function buildUndiscriminated(
  db: DB,
  scope: AttentionScope,
  scopedFindingIds: ReadonlySet<string>,
): BudgetedSection {
  const items: Item[] = [];
  const ids: string[] = [];
  const contradictions = db
    .prepare(
      `SELECT id, finding_a, finding_b, conflict_type FROM contradictions
        WHERE COALESCE(resolution,'unresolved') = 'unresolved' ORDER BY id`,
    )
    .all() as { id: number; finding_a: string; finding_b: string; conflict_type: string }[];
  const scopedContradictions =
    scope.kind === "project"
      ? contradictions
      : contradictions.filter(
          (row) => scopedFindingIds.has(row.finding_a) || scopedFindingIds.has(row.finding_b),
        );
  for (const row of scopedContradictions) {
    items.push({
      kind: "contradiction",
      contradiction_id: row.id,
      label: "undiscriminated",
      conflict_type: row.conflict_type,
      findings: [row.finding_a, row.finding_b],
      ref_sha: null,
      revision_bound: false,
      authored: "code",
    });
    ids.push(`contradiction:${row.id}`);
  }
  const matrices = (
    scope.subsystems.length === 0
      ? []
      : (db
          .prepare(
            `SELECT id, subsystem_id, symptom, COALESCE(outcome,'open') AS outcome
               FROM diagnosticity_sessions
              WHERE COALESCE(outcome,'open') IN ('open','unresolved-competition')
                AND subsystem_id IN (${placeholders(scope.subsystems)})
              ORDER BY id`,
          )
          .all(...scope.subsystems) as {
          id: number;
          subsystem_id: string;
          symptom: string;
          outcome: string;
        }[])
  ) as { id: number; subsystem_id: string; symptom: string; outcome: string }[];
  for (const row of matrices) {
    items.push({
      kind: "diagnosticity-matrix",
      matrix_id: row.id,
      label: "undiscriminated",
      subsystem_id: row.subsystem_id,
      outcome: row.outcome,
      symptom: row.symptom,
      ref_sha: null,
      revision_bound: false,
      authored: "model",
    });
    ids.push(`matrix:${row.id}`);
  }
  const dispositions =
    scope.subsystems.length === 0
      ? []
      : (db
          .prepare(
            `SELECT subsystem_id, concern_code FROM dispositions
              WHERE classification = 'unresolved-competition'
                AND subsystem_id IN (${placeholders(scope.subsystems)})
              ORDER BY subsystem_id, concern_code`,
          )
          .all(...scope.subsystems) as { subsystem_id: string; concern_code: string }[]);
  for (const row of dispositions) {
    items.push({
      kind: "disposition",
      subsystem_id: row.subsystem_id,
      concern_code: row.concern_code,
      label: "undiscriminated",
      ref_sha: null,
      revision_bound: false,
      authored: "code",
    });
    ids.push(`disposition:${row.subsystem_id}/${row.concern_code}`);
  }
  const section: BudgetedSection = {
    name: "undiscriminated",
    source_rows: items.length,
    items,
    ids,
    policy_ids: [],
    counts: {
      contradictions: scopedContradictions.length,
      matrices: matrices.length,
      dispositions: dispositions.length,
    },
    ordering_basis: "contradictions-then-matrices-then-dispositions-each-by-id",
  };
  if (items.length === 0) {
    section.statement = "No record in scope holds two accounts the evidence does not pick between.";
  }
  return section;
}

/** §5.2's `decisions`: open questions, ADR-0010's `unknown` verbatim. */
function buildDecisions(db: DB, scope: AttentionScope): BudgetedSection {
  const rows = (
    scope.kind === "project"
      ? (db
          .prepare(
            `SELECT id, category, subsystem_id, question, ref_sha FROM open_questions
              WHERE COALESCE(resolution,'open') = 'open' ORDER BY category, id`,
          )
          .all() as QuestionRow[])
      : scope.subsystems.length === 0
        ? []
        : (db
            .prepare(
              `SELECT id, category, subsystem_id, question, ref_sha FROM open_questions
                WHERE COALESCE(resolution,'open') = 'open'
                  AND subsystem_id IN (${placeholders(scope.subsystems)})
                ORDER BY category, id`,
            )
            .all(...scope.subsystems) as QuestionRow[])
  ) as QuestionRow[];
  const section: BudgetedSection = {
    name: "decisions",
    source_rows: rows.length,
    items: rows.map((row) => ({
      question_id: row.id,
      label: "unknown",
      category: row.category,
      subsystem_id: row.subsystem_id,
      question: row.question,
      ref_sha: row.ref_sha,
      revision_bound: row.ref_sha !== null,
      authored: "model",
    })),
    ids: rows.map((row) => `question:${row.id}`),
    policy_ids: [],
    ordering_basis: "category-then-id",
  };
  if (rows.length === 0) {
    section.statement = "No open question is recorded in scope.";
  }
  return section;
}

interface QuestionRow {
  id: number;
  category: string;
  subsystem_id: string | null;
  question: string;
  ref_sha: string | null;
}

/**
 * §5.2's `leads`. ADR-0010 defines `unverified-suspicion` over the
 * `candidate-concern` category alone, and §10's label enum carries no value for
 * an open note of another category, so the other four categories are census
 * members excluded by policy rather than items given a label that would say
 * something the record does not. Their count is exact and their ids are in the
 * ledger, so the tool's answer still reconciles with the Leads page.
 */
function buildAttentionLeads(db: DB, scope: AttentionScope): BudgetedSection {
  const rows = db
    .prepare(
      `SELECT id, category, observation, location, ref_sha FROM field_notes
        WHERE COALESCE(follow_up,'open') = 'open' ORDER BY id`,
    )
    .all() as {
    id: number;
    category: string;
    observation: string;
    location: string | null;
    ref_sha: string | null;
  }[];
  const ownedPaths = scopeOwnedPaths(db, scope);
  const inScope = rows.filter((row) => locationInScope(scope, row.location, ownedPaths));
  const suspicions = inScope.filter((row) => row.category === "candidate-concern");
  const others = inScope.filter((row) => row.category !== "candidate-concern");
  const byCategory: Record<string, number> = {};
  for (const row of others) byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
  const section: BudgetedSection = {
    name: "leads",
    source_rows: inScope.length,
    items: suspicions.map((row) => ({
      note_id: row.id,
      label: "unverified-suspicion",
      category: row.category,
      observation: row.observation,
      location: row.location,
      ref_sha: row.ref_sha,
      revision_bound: row.ref_sha !== null,
      authored: "model",
    })),
    ids: suspicions.map((row) => `lead:${row.id}`),
    policy_ids: others.map((row) => `lead:${row.id}`),
    counts: { unverified_suspicion: suspicions.length, ...byCategory },
    ordering_basis: "id",
    statement:
      others.length > 0
        ? "Open leads of other categories are in the omission ledger under policy: unverified-suspicion is an open candidate-concern note, and no label here covers the rest."
        : undefined,
  };
  if (inScope.length === 0) {
    section.statement = "No lead is open in scope.";
  }
  return section;
}

interface StaleClaimRow {
  claim_id: string;
  claim_key: string;
  subject_type: string;
  subject_id: string;
  valid_from_sha: string;
  valid_until_sha: string;
}

/**
 * §5.2's `stale`, the one label carrying two sources. ADR-0010's definition is
 * over claims; §5.2 extends it to obligation-bearing ledger rows, which is the
 * same epistemic state expressed over the ledger. Every item declares which,
 * and the two are counted apart and never summed, because a count over both
 * would be a property of the roster rather than of either population (VP6).
 *
 * The extension stops where §6.1 stops it: a `candidate` row's drift happened
 * before anyone read the file, so calling it stale *knowledge* would assert a
 * reading nobody took. Those rows are counted under their own name.
 */
function buildStale(
  db: DB,
  scope: AttentionScope,
  probe: CommitProbe,
  head: string | null,
): BudgetedSection {
  const claimRows = db
    .prepare(
      `SELECT claim_id, claim_key, subject_type, subject_id, valid_from_sha, valid_until_sha
         FROM claims WHERE valid_until_sha IS NOT NULL ORDER BY claim_id`,
    )
    .all() as StaleClaimRow[];
  const prefixes = scope.subsystems.map((id) => `${id}/`);
  const scopedClaims = claimRows.filter((row) => {
    if (scope.kind !== "project") {
      const named =
        scope.subsystems.includes(row.subject_id) ||
        prefixes.some((prefix) => row.claim_key.startsWith(prefix)) ||
        pathInScope(scope, row.subject_id.split(":")[0] ?? row.subject_id);
      if (!named) return false;
    }
    // "Closed at or before the reviewed HEAD" is an ancestry question, never a
    // text or wall-clock one (§3.3). A head git cannot resolve leaves the row
    // out rather than admitting one the tool cannot place.
    return head === null ? false : probe.isAncestor(row.valid_until_sha, head);
  });
  const ledgerRows = db
    .prepare(
      `SELECT subsystem_id, file_path, COALESCE(classification,'candidate') AS classification,
              ref_sha, stale_reason, stale_since
         FROM file_ledger
        WHERE stale = 1
          AND COALESCE(classification,'candidate')
              NOT IN ('generated-ignore','vendor-ignore','irrelevant')
        ORDER BY subsystem_id, file_path`,
    )
    .all() as {
    subsystem_id: string;
    file_path: string;
    classification: string;
    ref_sha: string | null;
    stale_reason: string | null;
    stale_since: string | null;
  }[];
  const scopedLedger = ledgerRows.filter(
    (row) =>
      (scope.kind === "project" || scope.subsystems.includes(row.subsystem_id)) &&
      pathInScope(scope, row.file_path),
  );
  const examined = scopedLedger.filter((row) => row.classification === "examined");
  const unread = scopedLedger.filter((row) => row.classification === "candidate");
  const deferred = scopedLedger.filter((row) => row.classification === "deferred-with-reason");

  const items: Item[] = [
    ...scopedClaims.map((row) => ({
      source: "claim",
      label: "stale-knowledge",
      claim_id: row.claim_id,
      claim_key: row.claim_key,
      subject_type: row.subject_type,
      subject_id: row.subject_id,
      closed_at_sha: row.valid_until_sha,
      ref_sha: row.valid_until_sha,
      revision_bound: true,
      authored: "code",
    })),
    ...examined.map((row) => ({
      source: "ledger",
      label: "stale-knowledge",
      subsystem_id: row.subsystem_id,
      file_path: row.file_path,
      classification: row.classification,
      stale_reason: row.stale_reason,
      ref_sha: row.ref_sha,
      revision_bound: row.ref_sha !== null,
      authored: "code",
    })),
  ];
  const section: BudgetedSection = {
    name: "stale",
    source_rows: scopedClaims.length + scopedLedger.length,
    items,
    ids: [
      ...scopedClaims.map((row) => `claim:${row.claim_id}`),
      ...examined.map((row) => `ledger:${row.subsystem_id}/${row.file_path}`),
    ],
    policy_ids: [...unread, ...deferred].map(
      (row) => `ledger:${row.subsystem_id}/${row.file_path}`,
    ),
    counts: {
      claim: scopedClaims.length,
      ledger: examined.length,
      drifted_unread: unread.length,
      drifted_deferred: deferred.length,
    },
    ordering_basis: "claims-then-ledger-rows-by-subsystem-and-path",
    statement:
      unread.length + deferred.length > 0
        ? "The two sources are counted apart and never summed. Drifted rows nobody has read are in the ledger under policy: no reading of them has gone stale."
        : "The two sources are counted apart and never summed.",
  };
  if (items.length === 0 && section.policy_ids.length === 0) {
    section.statement = head
      ? `No claim interval is closed at or before ${head.slice(0, 10)} and no obligation-bearing ledger row in scope is stale.`
      : "No claim interval is closed and no obligation-bearing ledger row in scope is stale; the reviewed revision could not be resolved.";
  }
  return section;
}

/** §7.6's per-subsystem measures, each column a separate measure and no total. */
function buildHotSpots(db: DB, scope: AttentionScope): BudgetedSection {
  const ids = scope.subsystems;
  if (ids.length === 0) {
    return {
      name: "hot_spots",
      source_rows: 0,
      items: [],
      ids: [],
      policy_ids: [],
      statement: "No subsystem is in scope.",
      ordering_basis: "open-critical-high-then-open-medium-low-then-unread-fraction-then-id",
    };
  }
  const holder = placeholders(ids);
  const counted = <T extends Record<string, unknown>>(sql: string, ...params: unknown[]): T[] =>
    db.prepare(sql).all(...params) as T[];

  const severityRows = counted<{ subsystem_id: string; severity: string; n: number }>(
    `SELECT subsystem_id, severity, COUNT(*) AS n FROM finding_state_current
      WHERE resolution_state = 'open' AND subsystem_id IN (${holder})
      GROUP BY subsystem_id, severity`,
    ...ids,
  );
  const awaitingRows = counted<{ subsystem_id: string; n: number }>(
    `SELECT subsystem_id, COUNT(*) AS n FROM finding_state_current
      WHERE resolution_state = 'fixed-pending-verification' AND subsystem_id IN (${holder})
      GROUP BY subsystem_id`,
    ...ids,
  );
  const matrixRows = counted<{ subsystem_id: string; n: number }>(
    `SELECT subsystem_id, COUNT(*) AS n FROM diagnosticity_sessions
      WHERE COALESCE(outcome,'open') IN ('open','unresolved-competition')
        AND subsystem_id IN (${holder}) GROUP BY subsystem_id`,
    ...ids,
  );
  const dispositionRows = counted<{ subsystem_id: string; n: number }>(
    `SELECT subsystem_id, COUNT(*) AS n FROM dispositions
      WHERE classification = 'unresolved-competition' AND subsystem_id IN (${holder})
      GROUP BY subsystem_id`,
    ...ids,
  );
  const contradictionRows = counted<{ subsystem_id: string; n: number }>(
    `SELECT f.subsystem_id AS subsystem_id, COUNT(DISTINCT c.id) AS n
       FROM contradictions c JOIN findings f
         ON f.finding_id = c.finding_a OR f.finding_id = c.finding_b
      WHERE COALESCE(c.resolution,'unresolved') = 'unresolved'
        AND f.subsystem_id IN (${holder}) GROUP BY f.subsystem_id`,
    ...ids,
  );
  const ledgerRows = counted<{
    subsystem_id: string;
    candidate: number;
    obligation: number;
    stale: number;
  }>(
    `SELECT subsystem_id,
            SUM(CASE WHEN COALESCE(classification,'candidate') = 'candidate' THEN 1 ELSE 0 END) AS candidate,
            SUM(CASE WHEN COALESCE(classification,'candidate')
                     NOT IN ('generated-ignore','vendor-ignore','irrelevant') THEN 1 ELSE 0 END) AS obligation,
            SUM(CASE WHEN stale = 1 AND COALESCE(classification,'candidate')
                     NOT IN ('generated-ignore','vendor-ignore','irrelevant') THEN 1 ELSE 0 END) AS stale
       FROM file_ledger WHERE subsystem_id IN (${holder}) GROUP BY subsystem_id`,
    ...ids,
  );
  const bugQuality = counted<{ subsystem_id: string; evidence_quality: string | null }>(
    `SELECT subsystem_id, evidence_quality FROM dispositions
      WHERE classification = 'confirmed-bug' AND subsystem_id IN (${holder})`,
    ...ids,
  );
  // §2.4.6 counts a side unassessed on either of two grounds, so both are
  // read: `assessable` is 0 unless *both* parties are `mapped`, and a party
  // may hold no `SC-%` disposition. Reading only the disposition calls an
  // unassessable seam assessed (F8/codex).
  const seamRows = counted<{
    seam_id: string;
    party_a: string;
    party_b: string;
    assessable: number;
  }>("SELECT seam_id, party_a, party_b, assessable FROM seam_assessability");
  const assessed = new Set(
    counted<{ subsystem_id: string }>(
      "SELECT DISTINCT subsystem_id FROM dispositions WHERE concern_code LIKE 'SC-%'",
    ).map((row) => row.subsystem_id),
  );
  // §7.6 column 10: the column is omitted entirely when nothing was recorded,
  // rather than printing a column of zeros over an empty table (VP4). An
  // `access_log` row names an *entry*, not a subsystem — `entry_id` and
  // `entry_tier` are `entries`'s composite key (`schema.sql:96-103`) — so the
  // measure exists only where the join reaches one, and a row that names an
  // entry no longer recorded, or an entry belonging to no subsystem, reaches
  // nothing. The gate is the joined result, not `access_log`'s own row count:
  // counting rows that reach no subsystem is how a column of zeros is printed
  // over a table that looks non-empty (F3/codex).
  const accessRows = counted<{ subsystem_id: string; n: number }>(
    `SELECT e.subsystem_id AS subsystem_id, COUNT(*) AS n
       FROM access_log a
       JOIN entries e ON e.id = a.entry_id AND e.tier = a.entry_tier
      WHERE e.subsystem_id IS NOT NULL
      GROUP BY e.subsystem_id`,
  );
  const accessRecorded = accessRows.length;

  const sum = (rows: { subsystem_id: string; n: number }[], id: string): number =>
    rows.filter((row) => row.subsystem_id === id).reduce((total, row) => total + row.n, 0);

  const items: Item[] = ids.map((id) => {
    const severityOf = (names: string[]): number =>
      severityRows
        .filter((row) => row.subsystem_id === id && names.includes(row.severity))
        .reduce((total, row) => total + row.n, 0);
    const ledger = ledgerRows.find((row) => row.subsystem_id === id) ?? {
      subsystem_id: id,
      candidate: 0,
      obligation: 0,
      stale: 0,
    };
    const qualities = bugQuality
      .filter((row) => row.subsystem_id === id)
      .map((row) => row.evidence_quality)
      .filter((value): value is string => typeof value === "string");
    // Weakest, not strongest: the ladder ranks strongest first, so the largest
    // rank is the reading a confirmed bug rests on at its weakest point.
    let weakest: string | null = null;
    let weakestRank = -1;
    for (const quality of qualities) {
      const rank = (EVIDENCE_KINDS as readonly string[]).indexOf(quality);
      const effective = rank < 0 ? EVIDENCE_KINDS.length : rank;
      if (effective > weakestRank) {
        weakestRank = effective;
        weakest = quality;
      }
    }
    const seams = seamRows.filter((row) => row.party_a === id || row.party_b === id);
    let unassessedSides = 0;
    for (const seam of seams) {
      for (const party of [seam.party_a, seam.party_b]) {
        if (Number(seam.assessable) === 0 || !assessed.has(party)) unassessedSides += 1;
      }
    }
    const item: Item = {
      subsystem_id: id,
      open_critical_high: severityOf(["CRITICAL", "HIGH"]),
      open_medium_low: severityOf(["MEDIUM", "LOW"]),
      awaiting_verification: sum(awaitingRows, id),
      undiscriminated: sum(contradictionRows, id) + sum(matrixRows, id) + sum(dispositionRows, id),
      weakest_confirmed_bug_evidence: weakest,
      unread: { candidate: ledger.candidate, obligation_bearing: ledger.obligation },
      stale_files: ledger.stale,
      unassessed_seam_sides: { sides: unassessedSides, of: seams.length * 2 },
      ref_sha: null,
      revision_bound: false,
      authored: "code",
    };
    if (accessRecorded) {
      item.access_heat = sum(accessRows, id);
    }
    return item;
  });
  // §7.6's sort. There is no composite column and no total row: each measure
  // is read on its own, and the order only decides which row is read first.
  const fraction = (item: Item): number => {
    const unread = item.unread as { candidate: number; obligation_bearing: number };
    return unread.obligation_bearing === 0 ? 0 : unread.candidate / unread.obligation_bearing;
  };
  items.sort(
    (a, b) =>
      Number(b.open_critical_high) - Number(a.open_critical_high) ||
      Number(b.open_medium_low) - Number(a.open_medium_low) ||
      fraction(b) - fraction(a) ||
      String(a.subsystem_id).localeCompare(String(b.subsystem_id)),
  );
  return {
    name: "hot_spots",
    source_rows: items.length,
    items,
    ids: items.map((item) => `subsystem:${String(item.subsystem_id)}`),
    policy_ids: [],
    ordering_basis: "open-critical-high-then-open-medium-low-then-unread-fraction-then-id",
    // §2.4.6: a disposition carries no seam id, so `unassessed_seam_sides` is
    // counted over each party's own SC-prefixed dispositions — a proxy for the
    // side, not an assessment of the seam. §7.6 column 10 is omitted entirely
    // rather than printed as zeros over an empty table (VP4).
    seam_binding: "per-party-proxy",
    statement: accessRecorded
      ? undefined
      : "Access heat is not measured: no access_log row reaches a subsystem through entries.",
  };
}

function getAttentionHandler(args: Record<string, unknown>, ctx: ServerContext) {
  const requestedScopeArgument = optString(args, "scope");
  const requestedScope =
    requestedScopeArgument === null ? null : boundedSubject("scope", requestedScopeArgument);
  const requestedSections = optStringArray(args, "sections");
  const limitArgument = args.limit;
  let limit: number | null = null;
  if (limitArgument !== undefined && limitArgument !== null) {
    if (
      typeof limitArgument !== "number" ||
      !Number.isInteger(limitArgument) ||
      limitArgument < 1
    ) {
      throw new ToolError("limit must be a positive integer");
    }
    limit = limitArgument;
  }
  if (requestedSections) {
    for (const name of requestedSections) {
      if (!(ATTENTION_SECTIONS as readonly string[]).includes(name)) {
        throw new ToolError(`unknown section: ${name}`);
      }
    }
  }
  const db = ctx.db;
  const probe = new CommitProbe(ctx);
  const scope = resolveAttentionScope(db, requestedScope);
  const head = checkedSha(db, probe);
  const findings = attentionFindings(db, scope);
  // Scope membership for the undiscriminated section is read over every
  // finding the scope reaches, not only the unresolved ones (F9/codex).
  const scopedFindingIds = new Set(findingsInScope(db, scope, null).map((row) => row.finding_id));
  const priorVerified = new Set(
    (
      db
        .prepare(
          "SELECT DISTINCT finding_id FROM finding_resolution_events WHERE resolution_state = 'verified-fixed'",
        )
        .all() as { finding_id: string }[]
    ).map((row) => row.finding_id),
  );
  const ledgerCounts = db
    .prepare(
      `SELECT COUNT(*) AS scoped,
              SUM(CASE WHEN classification = 'examined' THEN 1 ELSE 0 END) AS examined,
              SUM(CASE WHEN COALESCE(classification,'candidate') = 'candidate' THEN 1 ELSE 0 END) AS candidate
         FROM file_ledger`,
    )
    .get() as { scoped: number; examined: number | null; candidate: number | null };
  // §6.1's empty state: scope, basis, and the checked revision are always
  // present, and an empty answer never renders as a bare "none".
  const emptyOpen = `No open finding is recorded${head ? ` at ${head.slice(0, 10)}` : ""} over ${ledgerCounts.examined ?? 0} examined file(s) in ${scope.subsystems.length} subsystem(s); ${ledgerCounts.candidate ?? 0} file(s) are scoped but not yet read.${head ? "" : " The reviewed revision could not be resolved."}`;

  const sections: BudgetedSection[] = [
    buildAttentionFindingSection("open", findings, priorVerified, emptyOpen),
    buildAttentionFindingSection(
      "awaiting_verification",
      findings,
      priorVerified,
      "No repair is awaiting verification in scope.",
    ),
    buildUndiscriminated(db, scope, scopedFindingIds),
    buildDecisions(db, scope),
    buildAttentionLeads(db, scope),
    buildStale(db, scope, probe, head),
    buildHotSpots(db, scope),
  ];

  // A subtractive guard, in the substrate rather than in a comment (GP8): a
  // label outside §10's enum never reaches a caller, whatever a later section
  // builder decides to write.
  for (const section of sections) {
    for (const item of section.items) {
      if (section.name === "hot_spots") continue;
      if (!(ATTENTION_LABELS as readonly string[]).includes(String(item.label))) {
        throw new ToolError(
          `section ${section.name} produced the label ${String(item.label)}, which the vocabulary source does not carry`,
        );
      }
    }
  }

  const wanted = new Set<string>(requestedSections ?? ATTENTION_SECTIONS);
  return serveWithinBudget(
    sections,
    ATTENTION_WIRE_BUDGET,
    limit,
    ATTENTION_RETENTION,
    (name) => wanted.has(name),
    ({ sections: views, census, omitted, trace }) => ({
      contract_version: ATTENTION_CONTRACT_VERSION,
      scope: {
        requested: scope.requested,
        kind: scope.kind,
        subsystems: scope.subsystems,
        path_prefix: scope.path_prefix,
        resolved: scope.resolved,
      },
      checked_sha: head,
      sections: views,
      census,
      omitted,
      trace,
    }),
  );
}

// ---------------------------------------------------------------------------
// §5.3: get_history
// ---------------------------------------------------------------------------

/**
 * §1.1's two sentences, carried on the sections whose record family keeps no
 * event trail. A History surface that ordered these silently would imply an
 * account of how they reached their state that the store does not hold.
 */
const QUESTION_ORDER_STATEMENT = "When this reached its state is recorded; how it did is not.";
const LEAD_ORDER_STATEMENT =
  "Neither when nor how this lead reached its state is recorded, only that it did; the order below is the order the leads were opened.";

interface HistorySubject {
  kind: "locus" | "finding";
  locus: ResolvedLocus | null;
  scope: AccountScope | null;
  findingIds: string[];
  owners: string[];
  path: string | null;
}

function resolveHistorySubject(ctx: ServerContext, args: Record<string, unknown>): HistorySubject {
  const locusRaw = optString(args, "locus");
  const findingRaw = optString(args, "finding_id");
  const locusArgument = locusRaw === null ? null : boundedSubject("locus", locusRaw);
  const findingArgument = findingRaw === null ? null : boundedSubject("finding_id", findingRaw);
  if ((locusArgument === null) === (findingArgument === null)) {
    throw new ToolError("exactly one of locus or finding_id is required");
  }
  if (findingArgument !== null) {
    const row = ctx.db
      .prepare("SELECT finding_id, subsystem_id FROM findings WHERE finding_id = ?")
      .get(findingArgument) as { finding_id: string; subsystem_id: string } | undefined;
    if (!row) throw new ToolError(`unknown finding: ${findingArgument}`);
    return {
      kind: "finding",
      locus: null,
      scope: null,
      findingIds: [row.finding_id],
      owners: [row.subsystem_id],
      path: null,
    };
  }
  const { locus } = describeLocusStanding(ctx, locusArgument as string, null);
  const scope = buildScope(ctx.db, locus);
  const findings = matchingFindings(ctx.db, scope);
  return {
    kind: "locus",
    locus,
    scope,
    findingIds: findings.map((row) => row.finding_id),
    owners: scope.owners,
    path: scope.path,
  };
}

function buildResolutionHistory(db: DB, subject: HistorySubject): BudgetedSection {
  const rows = subject.findingIds.length
    ? (db
        .prepare(
          `SELECT id, finding_id, resolution_state, fix_sha, fix_location, rationale, recorded_at
             FROM finding_resolution_events
            WHERE finding_id IN (${placeholders(subject.findingIds)})
            ORDER BY id DESC`,
        )
        .all(...subject.findingIds) as ResolutionEventRow[])
    : [];
  return {
    name: "resolutions",
    source_rows: rows.length,
    items: rows.map((row) => ({
      event_id: row.id,
      finding_id: row.finding_id,
      resolution_state: row.resolution_state,
      recorded_at: row.recorded_at,
      rationale: row.rationale,
      ref_sha: row.fix_sha,
      revision_bound: row.fix_sha !== null,
      authored: "model",
    })),
    ids: rows.map((row) => `event:${row.id}`),
    policy_ids: [],
    ordering_basis: "event-id-descending",
    statement: rows.length === 0 ? "No resolution event is recorded for this subject." : undefined,
  };
}

function buildClaimHistory(db: DB, subject: HistorySubject): BudgetedSection {
  if (subject.kind === "finding") {
    return {
      name: "claims",
      source_rows: 0,
      items: [],
      ids: [],
      policy_ids: [],
      ordering_basis: "event-id-descending",
      statement: "Claims are recorded against a locus, not against a finding.",
    };
  }
  const scope = subject.scope as AccountScope;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (scope.subjectIds.length) {
    conditions.push(`c.subject_id IN (${placeholders(scope.subjectIds)})`);
    params.push(...scope.subjectIds);
  }
  if (scope.claimKeyPrefix) {
    conditions.push("c.claim_key LIKE ? ESCAPE '\\'");
    params.push(scope.claimKeyPrefix);
  }
  const cites = evidenceMatch(scope);
  if (cites) {
    conditions.push(
      `EXISTS (SELECT 1 FROM claim_evidence ce JOIN evidence e ON e.id = ce.evidence_id
                WHERE ce.claim_id = c.claim_id AND ${cites.sql})`,
    );
    params.push(...cites.params);
  }
  if (conditions.length === 0) {
    return {
      name: "claims",
      source_rows: 0,
      items: [],
      ids: [],
      policy_ids: [],
      ordering_basis: "event-id-descending",
      statement: "No claim names this locus.",
    };
  }
  const where = conditions.join(" OR ");
  const events = db
    .prepare(
      `SELECT v.id, v.claim_id, v.event_type, v.at_sha, v.reason, v.created_at
         FROM claim_validity_events v JOIN claims c ON c.claim_id = v.claim_id
        WHERE ${where} ORDER BY v.id DESC`,
    )
    .all(...params) as {
    id: number;
    claim_id: string;
    event_type: string;
    at_sha: string;
    reason: string;
    created_at: string;
  }[];
  const supersessions = db
    .prepare(
      `SELECT s.predecessor_claim_id, s.successor_claim_id, s.at_sha, s.rationale, s.created_at
         FROM claim_supersessions s JOIN claims c ON c.claim_id = s.predecessor_claim_id
        WHERE ${where} ORDER BY s.created_at DESC, s.predecessor_claim_id DESC`,
    )
    .all(...params) as {
    predecessor_claim_id: string;
    successor_claim_id: string;
    at_sha: string;
    rationale: string;
    created_at: string;
  }[];
  const items: Item[] = [
    ...supersessions.map((row) => ({
      kind: "supersession",
      predecessor_claim_id: row.predecessor_claim_id,
      successor_claim_id: row.successor_claim_id,
      recorded_at: row.created_at,
      rationale: row.rationale,
      ref_sha: row.at_sha,
      revision_bound: true,
      authored: "model",
    })),
    ...events.map((row) => ({
      kind: "validity-event",
      event_id: row.id,
      claim_id: row.claim_id,
      event_type: row.event_type,
      recorded_at: row.created_at,
      reason: row.reason,
      ref_sha: row.at_sha,
      revision_bound: true,
      authored: "model",
    })),
  ];
  return {
    name: "claims",
    source_rows: items.length,
    items,
    ids: [
      ...supersessions.map((row) => `supersession:${row.predecessor_claim_id}`),
      ...events.map((row) => `claim-event:${row.id}`),
    ],
    policy_ids: [],
    ordering_basis: "supersessions-then-validity-events-newest-first",
    statement:
      items.length === 0
        ? "No claim about this locus has been superseded or invalidated."
        : undefined,
  };
}

function buildContradictionHistory(db: DB, subject: HistorySubject): BudgetedSection {
  const rows = subject.findingIds.length
    ? (db
        .prepare(
          `SELECT e.id, e.contradiction_id, e.resolution, e.scope_note, e.rationale, e.recorded_at,
                  c.finding_a, c.finding_b
             FROM contradiction_resolution_events e
             JOIN contradictions c ON c.id = e.contradiction_id
            WHERE c.finding_a IN (${placeholders(subject.findingIds)})
               OR c.finding_b IN (${placeholders(subject.findingIds)})
            ORDER BY e.id DESC`,
        )
        .all(...subject.findingIds, ...subject.findingIds) as {
        id: number;
        contradiction_id: number;
        resolution: string;
        scope_note: string | null;
        rationale: string;
        recorded_at: string;
        finding_a: string;
        finding_b: string;
      }[])
    : [];
  return {
    name: "contradictions",
    source_rows: rows.length,
    items: rows.map((row) => ({
      event_id: row.id,
      contradiction_id: row.contradiction_id,
      resolution: row.resolution,
      findings: [row.finding_a, row.finding_b],
      recorded_at: row.recorded_at,
      rationale: row.rationale,
      ref_sha: null,
      revision_bound: false,
      authored: "model",
    })),
    ids: rows.map((row) => `contradiction-event:${row.id}`),
    policy_ids: [],
    ordering_basis: "event-id-descending",
    statement:
      rows.length === 0 ? "No contradiction touching this subject has been resolved." : undefined,
  };
}

function buildQuestionHistory(db: DB, subject: HistorySubject): BudgetedSection {
  // `open_questions` carries a nullable `subsystem_id` and nothing else that
  // reaches a record: no column, and no link table, binds a question to a
  // finding (`schema.sql:4617-4640`). A finding subject therefore inherits its
  // subsystem's questions or none, and inheriting them asserts an attribution
  // the store does not hold — the same over-reach `buildLeadHistory` avoids by
  // binding a finding subject through `follow_up` (F4/codex).
  if (subject.kind === "finding") {
    return {
      name: "questions",
      source_rows: 0,
      items: [],
      ids: [],
      policy_ids: [],
      ordering_basis: "resolved_at-descending-then-id",
      statement:
        "No question is bound to a finding: the record binds a question to a subsystem, never to one finding. Ask by locus to read the subsystem's closed questions.",
    };
  }
  const owners = subject.owners;
  const rows = owners.length
    ? (db
        .prepare(
          `SELECT id, category, subsystem_id, question, answer, resolution, resolved_at, ref_sha
             FROM open_questions
            WHERE resolution IN ('answered','dismissed','superseded')
              AND subsystem_id IN (${placeholders(owners)})
            ORDER BY resolved_at DESC, id DESC`,
        )
        .all(...owners) as {
        id: number;
        category: string;
        subsystem_id: string | null;
        question: string;
        answer: string | null;
        resolution: string;
        resolved_at: string | null;
        ref_sha: string | null;
      }[])
    : [];
  return {
    name: "questions",
    source_rows: rows.length,
    items: rows.map((row) => ({
      question_id: row.id,
      resolution: row.resolution,
      category: row.category,
      subsystem_id: row.subsystem_id,
      question: row.question,
      // §5.3 serves answered questions; an answered question without its
      // answer serves the fact of a resolution and withholds the resolution
      // (F5/codex). `null` is carried rather than elided so that "dismissed,
      // with nothing recorded" reads differently from "answered".
      answer: row.resolution === "answered" ? row.answer : null,
      resolved_at: row.resolved_at,
      ref_sha: row.ref_sha,
      revision_bound: row.ref_sha !== null,
      authored: "model",
    })),
    ids: rows.map((row) => `question:${row.id}`),
    policy_ids: [],
    ordering_basis: "resolved_at-descending-then-id",
    statement: rows.length
      ? QUESTION_ORDER_STATEMENT
      : "No question about this subject has been answered, dismissed, or superseded.",
  };
}

function buildLeadHistory(db: DB, subject: HistorySubject): BudgetedSection {
  const rows = db
    .prepare(
      `SELECT id, category, observation, location, follow_up, ref_sha, created_at
         FROM field_notes WHERE COALESCE(follow_up,'open') <> 'open' ORDER BY id DESC`,
    )
    .all() as {
    id: number;
    category: string;
    observation: string;
    location: string | null;
    follow_up: string;
    ref_sha: string | null;
    created_at: string;
  }[];
  const matched = rows.filter((row) => {
    if (subject.kind === "finding") return row.follow_up === subject.findingIds[0];
    const tokens = (row.location ?? "")
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    return tokens.some((token) => {
      if (subject.owners.includes(token)) return true;
      if (!subject.path) return false;
      const path = token.split("@")[0]?.split(":")[0] ?? token;
      return path === subject.path;
    });
  });
  return {
    name: "leads",
    source_rows: matched.length,
    items: matched.map((row) => ({
      note_id: row.id,
      follow_up: row.follow_up,
      category: row.category,
      observation: row.observation,
      location: row.location,
      ref_sha: row.ref_sha,
      revision_bound: row.ref_sha !== null,
      authored: "model",
    })),
    ids: matched.map((row) => `lead:${row.id}`),
    policy_ids: [],
    ordering_basis: "id-descending",
    statement: matched.length
      ? LEAD_ORDER_STATEMENT
      : "No lead about this subject has been closed.",
  };
}

function buildSessionHistory(db: DB, subject: HistorySubject): BudgetedSection {
  // C24's declared attribution: a session reaches a subject only through a row
  // that cites it — evidence collected there, or a finding it recorded — never
  // through a claim that the session touched the file.
  const sessionIds = new Set<string>();
  if (subject.scope) {
    const cites = evidenceMatch(subject.scope);
    if (cites) {
      for (const row of db
        .prepare(
          `SELECT DISTINCT e.session_id FROM evidence e WHERE ${cites.sql} AND e.session_id IS NOT NULL`,
        )
        .all(...cites.params) as { session_id: string }[]) {
        sessionIds.add(row.session_id);
      }
    }
  }
  if (subject.findingIds.length) {
    for (const row of db
      .prepare(
        `SELECT DISTINCT session_id FROM findings
          WHERE finding_id IN (${placeholders(subject.findingIds)}) AND session_id IS NOT NULL`,
      )
      .all(...subject.findingIds) as { session_id: string }[]) {
      sessionIds.add(row.session_id);
    }
    for (const row of db
      .prepare(
        `SELECT DISTINCT session_id FROM finding_resolution_events
          WHERE finding_id IN (${placeholders(subject.findingIds)}) AND session_id IS NOT NULL`,
      )
      .all(...subject.findingIds) as { session_id: string }[]) {
      sessionIds.add(row.session_id);
    }
  }
  const ids = [...sessionIds];
  const rows = ids.length
    ? (db
        .prepare(
          `SELECT session_id, intent, started_at, ended_at, outcome FROM sessions
            WHERE session_id IN (${placeholders(ids)}) ORDER BY started_at DESC, session_id DESC`,
        )
        .all(...ids) as {
        session_id: string;
        intent: string;
        started_at: string;
        ended_at: string | null;
        outcome: string | null;
      }[])
    : [];
  return {
    name: "sessions",
    source_rows: rows.length,
    items: rows.map((row) => ({
      session_id: row.session_id,
      intent: row.intent,
      started_at: row.started_at,
      ended_at: row.ended_at,
      outcome: row.outcome,
      ref_sha: null,
      revision_bound: false,
      authored: "code",
    })),
    ids: rows.map((row) => `session:${row.session_id}`),
    policy_ids: [],
    session_attribution: "by-citation",
    ordering_basis: "started_at-descending",
    statement: rows.length === 0 ? "No session cites this subject." : undefined,
  };
}

function getHistoryHandler(args: Record<string, unknown>, ctx: ServerContext) {
  const limitArgument = args.limit;
  let limit: number | null = null;
  if (limitArgument !== undefined && limitArgument !== null) {
    if (
      typeof limitArgument !== "number" ||
      !Number.isInteger(limitArgument) ||
      limitArgument < 1
    ) {
      throw new ToolError("limit must be a positive integer");
    }
    limit = limitArgument;
  }
  const db = ctx.db;
  const subject = resolveHistorySubject(ctx, args);
  const sections: BudgetedSection[] = [
    buildResolutionHistory(db, subject),
    buildClaimHistory(db, subject),
    buildContradictionHistory(db, subject),
    buildQuestionHistory(db, subject),
    buildLeadHistory(db, subject),
    buildSessionHistory(db, subject),
  ];
  return serveWithinBudget(
    sections,
    HISTORY_WIRE_BUDGET,
    limit,
    HISTORY_RETENTION,
    () => true,
    ({ sections: views, census, omitted, trace }) => ({
      contract_version: LOCUS_HISTORY_CONTRACT_VERSION,
      subject: {
        kind: subject.kind,
        locus: subject.locus,
        finding_id: subject.kind === "finding" ? subject.findingIds[0] : null,
      },
      sections: views,
      census,
      omitted,
      trace,
    }),
  );
}

export const locusTools: ToolDefinition[] = [
  {
    name: "describe_locus",
    description:
      "Return what the conspectus records about one file, symbol, subsystem, or term: its standing — what the record authorizes and what it cannot justify — followed by the recorded account. Reads only; makes no model call and generates no text. An unknown locus returns a standing state, not an error. Pass `sections` to choose exactly which account sections to return; omit it for the default set. The response is bounded: what does not fit is declared in `omitted[]` with an exact count, never dropped silently.",
    inputSchema: {
      type: "object",
      properties: {
        locus: { type: "string", minLength: 1, maxLength: MAX_SUBJECT_LENGTH },
        kind: { type: "string", enum: ["file", "symbol", "subsystem", "term"] },
        sections: {
          type: "array",
          items: { type: "string", enum: [...ACCOUNT_SECTIONS] },
        },
        as_of_sha: { type: "string", maxLength: MAX_SUBJECT_LENGTH },
      },
      required: ["locus"],
      additionalProperties: false,
    },
    // §4.1: the text block is serialized without indentation, because the
    // budget is measured on the bytes the host receives.
    compact: true,
    handler: describeLocusHandler,
  },
  {
    name: "get_attention",
    description:
      "Return what the conspectus records as unresolved: open findings and regressions, repairs awaiting verification, records where two credible accounts still stand, open questions, unverified suspicions, knowledge the repository has moved under, and per-subsystem measures. Every item carries an operational label whose meaning is fixed by the reader's guide. Reads only; makes no model call and generates no text. Pass `scope` to narrow to one subsystem id or one repository path prefix. The response is bounded: what does not fit is declared in `omitted[]` with an exact count, never dropped silently.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", minLength: 1, maxLength: MAX_SUBJECT_LENGTH },
        sections: {
          type: "array",
          items: { type: "string", enum: [...ATTENTION_SECTIONS] },
        },
        limit: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    compact: true,
    handler: getAttentionHandler,
  },
  {
    name: "get_history",
    description:
      "Return what the conspectus records as concluded about one locus or one finding: resolution events, claim supersessions and validity events, resolved contradictions, answered or dismissed questions, closed leads, and the sessions that cite the subject. Newest first, one page. Exactly one of `locus` or `finding_id` is required. Reads only; makes no model call and generates no text. The response is bounded: what does not fit is declared in `omitted[]` with an exact count, never dropped silently.",
    inputSchema: {
      type: "object",
      properties: {
        locus: { type: "string", minLength: 1, maxLength: MAX_SUBJECT_LENGTH },
        finding_id: { type: "string", minLength: 1, maxLength: MAX_SUBJECT_LENGTH },
        limit: { type: "integer", minimum: 1 },
      },
      // §5.3 requires exactly one subject. The handler has always refused the
      // other two shapes; advertising the requirement is what lets a host that
      // validates its calls tell a malformed call from a server fault
      // (F6/codex). `not: {}` is how draft 2020-12 spells "this property may
      // not appear" inside a branch.
      oneOf: [
        {
          type: "object",
          required: ["locus"],
          properties: { locus: { type: "string" }, finding_id: { not: {} } },
        },
        {
          type: "object",
          required: ["finding_id"],
          properties: { finding_id: { type: "string" }, locus: { not: {} } },
        },
      ],
      additionalProperties: false,
    },
    compact: true,
    handler: getHistoryHandler,
  },
];
