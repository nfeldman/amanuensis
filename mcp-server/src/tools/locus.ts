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
  type StandingBlock,
  type StandingState,
  type SymbolStandingBlock,
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

interface EvidenceRow {
  id: number;
  file_path: string;
  symbol: string | null;
  ref_sha: string;
  kind: string;
  session_id: string | null;
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

/** §3.1's evidence arm: which evidence rows cite this locus. */
function citingEvidence(db: DB, scope: AccountScope): EvidenceRow[] {
  if (!scope.path) {
    if (!scope.subsystemId) return [];
    return db
      .prepare(
        `SELECT DISTINCT e.id, e.file_path, e.symbol, e.ref_sha, e.kind, e.session_id
           FROM evidence e
           JOIN file_ledger l ON l.file_path = e.file_path
          WHERE l.subsystem_id = ?
          ORDER BY e.id`,
      )
      .all(scope.subsystemId) as EvidenceRow[];
  }
  const rows = db
    .prepare(
      "SELECT id, file_path, symbol, ref_sha, kind, session_id FROM evidence WHERE file_path = ? ORDER BY id",
    )
    .all(scope.path) as EvidenceRow[];
  // A symbol locus is cited only by evidence naming that exact symbol; the
  // file's citations are not silently inherited by one of its symbols (§2.5).
  return scope.symbol ? rows.filter((row) => row.symbol === scope.symbol) : rows;
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
  evidence: EvidenceRow[],
  authorization: { authorized: boolean; cannot_justify: string },
  probe: CommitProbe,
  asOf: string | null,
): SectionBuild {
  const evidenceIds = evidence.map((row) => row.id);
  const conditions = [`c.subject_id IN (${placeholders(scope.subjectIds)})`];
  const params: unknown[] = [...scope.subjectIds];
  if (evidenceIds.length) {
    conditions.push(
      `c.claim_id IN (SELECT claim_id FROM claim_evidence WHERE evidence_id IN (${placeholders(evidenceIds)}))`,
    );
    params.push(...evidenceIds);
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

function primaryFilesNames(primaryFiles: string | null, path: string): boolean {
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
    const file = citation.includes(":") ? citation.slice(0, citation.indexOf(":")) : citation;
    return file === path;
  });
}

function matchingFindings(db: DB, scope: AccountScope, evidence: EvidenceRow[]): FindingRow[] {
  const select = `SELECT s.finding_id, s.subsystem_id, s.severity, s.resolution_state,
                         s.legacy_status, f.symptom, f.ref_sha, f.primary_files
                    FROM finding_state_current s
                    JOIN findings f ON f.finding_id = s.finding_id`;
  if (scope.subsystemId) {
    return db
      .prepare(`${select} WHERE s.subsystem_id = ? ORDER BY s.finding_id`)
      .all(scope.subsystemId) as FindingRow[];
  }
  if (!scope.path) return [];
  const evidenceIds = evidence.map((row) => row.id);
  const owners = scope.owners;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (evidenceIds.length) {
    conditions.push(
      `f.finding_id IN (SELECT finding_id FROM finding_evidence WHERE evidence_id IN (${placeholders(evidenceIds)}))`,
    );
    params.push(...evidenceIds);
  }
  if (owners.length) {
    conditions.push(
      `(f.primary_files IS NOT NULL AND f.subsystem_id IN (${placeholders(owners)}))`,
    );
    params.push(...owners);
  }
  if (conditions.length === 0) return [];
  const rows = db
    .prepare(`${select} WHERE ${conditions.join(" OR ")} ORDER BY s.finding_id`)
    .all(...params) as FindingRow[];
  const cited = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT finding_id FROM finding_evidence WHERE evidence_id IN (${placeholders(evidenceIds.length ? evidenceIds : [-1])})`,
        )
        .all(...(evidenceIds.length ? evidenceIds : [-1])) as { finding_id: string }[]
    ).map((row) => row.finding_id),
  );
  return rows.filter(
    (row) =>
      cited.has(row.finding_id) || primaryFilesNames(row.primary_files, scope.path as string),
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

function buildDefects(
  db: DB,
  scope: AccountScope,
  evidence: EvidenceRow[],
  probe: CommitProbe,
  asOf: string | null,
  standingState: string,
): SectionBuild {
  const rows = matchingFindings(db, scope, evidence);
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
  // §2.3: "no open findings" is legal only at `examined`. Anywhere else the
  // section says what is true — the file was not examined — and never reports
  // an absence it cannot see.
  const statement =
    items.length === 0
      ? standingState === "examined"
        ? "No open findings are recorded for this locus."
        : "Not examined: nothing was read here, so the record says nothing about defects at this locus."
      : undefined;
  return { source_rows: rows.length, items, statement };
}

function buildReviews(db: DB, scope: AccountScope, evidence: EvidenceRow[]): SectionBuild {
  const evidenceIds = evidence.map((row) => row.id);
  if (evidenceIds.length === 0 && !scope.subsystemId) return { source_rows: 0, items: [] };
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (evidenceIds.length) {
    conditions.push(
      `(d.subsystem_id, d.concern_code) IN (SELECT subsystem_id, concern_code FROM disposition_evidence
         WHERE evidence_id IN (${placeholders(evidenceIds)}))`,
    );
    params.push(...evidenceIds);
  }
  if (scope.subsystemId) {
    conditions.push("d.subsystem_id = ?");
    params.push(scope.subsystemId);
  }
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
      `SELECT term, gloss, subsystem_id, first_seen, ref_sha
         FROM vocabulary WHERE ${conditions.join(" OR ")} ORDER BY term`,
    )
    .all(...params) as {
    term: string;
    gloss: string;
    subsystem_id: string | null;
    first_seen: string | null;
    ref_sha: string | null;
  }[];
  return {
    source_rows: rows.length,
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

function buildHistoryPointer(
  db: DB,
  findings: FindingRow[],
  evidence: EvidenceRow[],
): SectionBuild {
  const findingIds = findings.map((row) => row.finding_id);
  const events = findingIds.length
    ? (db
        .prepare(
          `SELECT id, finding_id, resolution_state, fix_sha, fix_location, rationale, recorded_at
             FROM finding_resolution_events WHERE finding_id IN (${placeholders(findingIds)})
            ORDER BY id`,
        )
        .all(...findingIds) as ResolutionEventRow[])
    : [];
  // C24's by-citation attribution: a session reaches this locus through the
  // rows that cite it, and the citing evidence was already read for the
  // account's other sections.
  const sessionIds = new Set<string>();
  for (const row of evidence) if (row.session_id) sessionIds.add(row.session_id);
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
    ...events.map((row) => ({
      kind: "resolution-event",
      event_id: row.id,
      finding_id: row.finding_id,
      resolution_state: row.resolution_state,
      recorded_at: row.recorded_at,
      ref_sha: row.fix_sha,
      revision_bound: row.fix_sha !== null,
      authored: "model",
    })),
    ...sessions.map((row) => ({
      kind: "session",
      session_id: row.session_id,
      intent: row.intent,
      started_at: row.started_at,
      ended_at: row.ended_at,
      ref_sha: null,
      revision_bound: false,
      authored: "code",
    })),
  ];
  return {
    source_rows: items.length,
    items,
    counts: { finding_resolution_events: events.length, sessions: sessions.length },
    // C24's declaration: a session reaches a locus only through a row that
    // cites it, never through a claim that the session touched the file.
    session_attribution: "by-citation",
  };
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

interface OmissionEntry {
  section: string;
  reason: "policy" | "budget";
  count: number;
  ids: string[];
  ids_truncated: boolean;
}

/** §4.3: an aggregated ledger entry, one per (section, reason), with an exact count. */
const OMITTED_IDS_BUDGET = 1024;

function itemId(section: string, item: Item): string {
  const key =
    item.claim_id ??
    item.finding_id ??
    item.term ??
    item.subsystem_id ??
    item.seam_id ??
    item.note_id ??
    item.question_id ??
    item.event_id ??
    item.session_id ??
    item.concern_code;
  return `${section}:${String(key ?? "row")}`;
}

function omissionFor(section: string, items: Item[]): OmissionEntry {
  const ids: string[] = [];
  let bytes = 0;
  let truncated = false;
  for (const item of items) {
    const id = itemId(section, item);
    bytes += id.length + 3;
    if (bytes > OMITTED_IDS_BUDGET) {
      truncated = true;
      break;
    }
    ids.push(id);
  }
  // The count is exact and never truncated: it is what the census invariant
  // reconciles against, and a truncated count would be a lie (§4.3).
  return { section, reason: "policy", count: items.length, ids, ids_truncated: truncated };
}

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
  const evidence = citingEvidence(db, scope);
  const authorization = contentAuthorization(locus, standing);
  const findings = matchingFindings(db, scope, evidence);

  const wanted = new Set<AccountSection>(
    (requestedSections as AccountSection[] | null) ?? DEFAULT_SECTIONS,
  );
  const builders: Record<AccountSection, () => SectionBuild> = {
    purpose: () => buildPurpose(db, scope),
    structure: () => buildStructure(db, scope, evidence, authorization, probe, asOf),
    defects: () => buildDefects(db, scope, evidence, probe, asOf, authorization.state),
    reviews: () => buildReviews(db, scope, evidence),
    boundaries: () => buildBoundaries(db, scope),
    terms: () => buildTerms(db, scope),
    leads: () => buildLeads(db, standing, locus.kind),
    history_pointer: () => buildHistoryPointer(db, findings, evidence),
  };

  // §2.4.4: when the recorded reconciliation is behind the workspace head,
  // every section is marked as of the revision that was actually checked.
  const revision = (standing as { revision?: { unchecked_since?: string | null } }).revision;
  const uncheckedSince = revision?.unchecked_since ?? null;

  const sections: Record<string, SectionView> = {};
  const omitted: OmissionEntry[] = [];
  const bySection: Record<string, number> = {};
  for (const name of ACCOUNT_SECTIONS) {
    const requested = wanted.has(name);
    const build = builders[name]();
    const census = build.items.length;
    const view: SectionView = {
      census,
      recorded: build.source_rows > 0,
      requested,
      as_of_supported: name === "structure" || name === "defects" || name === "history_pointer",
      items: requested ? build.items : [],
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
    if (build.source_rows !== census) view.source_rows = build.source_rows;
    if (asOf && !view.as_of_supported) {
      view.statement = asOfUnsupportedSentence(asOf);
    } else if (build.statement) {
      view.statement = build.statement;
    }
    if (uncheckedSince) view.as_of = uncheckedSince;
    if (view.items.length === 0 && census > 0) {
      omitted.push(omissionFor(name, build.items));
    }
    bySection[name] = census;
    sections[name] = view;
  }

  // §4.3's invariant, checked before returning: a response that cannot
  // reconcile its own census fails rather than returning a smaller
  // truthful-looking answer.
  for (const name of ACCOUNT_SECTIONS) {
    const view = sections[name] as SectionView;
    const dropped = omitted
      .filter((entry) => entry.section === name)
      .reduce((total, entry) => total + entry.count, 0);
    if (view.items.length + dropped !== view.census) {
      throw new ToolError(
        `section ${name} cannot reconcile its census: ${view.items.length} selected + ${dropped} omitted != ${view.census}`,
      );
    }
  }

  const payload = {
    contract_version: LOCUS_ACCOUNT_CONTRACT_VERSION,
    locus,
    standing,
    sections,
    census: {
      total: Object.values(bySection).reduce((sum, count) => sum + count, 0),
      by_section: bySection,
    },
    omitted,
    trace: {
      model_calls: 0,
      selection: "registry-exact-v1",
      budget_bytes: wanted.size > DEFAULT_SECTIONS.length ? 32768 : 8192,
      payload_bytes: 0,
      // The wire measurement belongs to the emitting helper, not to the
      // handler: it counts the text block and the duplicated
      // structuredContent, neither of which exists yet at this point.
      response_bytes: null,
    },
    current: asOf === null,
    as_of_sha: asOf,
  };
  // Measured, not estimated: iterate to the fixed point where the reported
  // size is the size of the payload that reports it.
  let measured = 0;
  for (let pass = 0; pass < 4; pass += 1) {
    payload.trace.payload_bytes = measured;
    const size = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (size === measured) break;
    measured = size;
  }
  return payload;
}

export const locusTools: ToolDefinition[] = [
  {
    name: "describe_locus",
    description:
      "Return what the conspectus records about one file, symbol, subsystem, or term: its standing — what the record authorizes and what it cannot justify — followed by the recorded account. Reads only; makes no model call and generates no text. An unknown locus returns a standing state, not an error. Pass `sections` to choose exactly which account sections to return; omit it for the default set.",
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
    handler: describeLocusHandler,
  },
];
