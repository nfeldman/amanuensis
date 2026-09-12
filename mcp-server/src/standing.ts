/**
 * Standing: the per-locus certainty gate (spec §2).
 *
 * Everything here is computed from rows already in the store, from a git
 * ancestry check, or from a code constant. No branch consults a model, and the
 * same store against the same workspace HEAD produces byte-identical output —
 * which is what lets the tools in §5 quote a standing block as evidence rather
 * than as a summary.
 *
 * The division of labour is deliberate. `file_standing` (schema.sql) carries
 * the per-owner predicate, because a predicate that lives in SQL is a
 * subtractive guard the substrate enforces rather than a rule prose asks a
 * writer to honour (catalog GP8). Three things SQL cannot decide are decided
 * here: whether a path has any owner at all, whether the owners agree, and
 * whether an examination revision is still reachable from HEAD.
 */
import { spawnSync } from "node:child_process";
import type { DB } from "./db.js";
import { requireWorkspaceSourcePath, type ServerContext } from "./helpers.js";
import { STATUS_ORDER, statusRank } from "./invariants.js";
import { VOCABULARY } from "./vocabulary.js";

export type LocusKind = "file" | "symbol" | "subsystem" | "term";

/**
 * §2.1's inference order, as a code constant. Step 2 precedes step 3 because
 * recorded vocabulary terms contain `:` — `Severity (sh:Violation / sh:Warning
 * / sh:Info)` is a real term that the colon test alone kinds `symbol` and
 * leaves unreachable. Step 5 precedes step 6 because §2.2's `unledgered` state
 * exists precisely for a path no table names; falling through to `not-defined`
 * would contradict it.
 */
export const LOCUS_INFERENCE_ORDER = [
  "subsystem-id",
  "vocabulary-term",
  "colon-split",
  "ledgered-path",
  "path-shaped",
  "bare-term",
] as const;
export type LocusInferenceStep = (typeof LOCUS_INFERENCE_ORDER)[number] | "caller-supplied";

export interface ResolvedLocus {
  value: string;
  kind: LocusKind;
  /** Which step of §2.1 decided the kind. Always echoed. */
  kind_inferred_by: LocusInferenceStep;
  /** Index of the colon a symbol locus was split at, or null. Always echoed. */
  split_at: number | null;
  path: string | null;
  symbol: string | null;
  subsystem_id: string | null;
  term: string | null;
}

export type StandingState =
  | "unledgered"
  | "excluded"
  | "scoped-unread"
  | "examined"
  | "examined-stale"
  | "absent"
  | "mixed";

/**
 * Weakest authority first.
 *
 * §2.3 states what each state authorizes but does not rank them, and `mixed`
 * needs a rank: it authorizes only what the *weakest* owner authorizes. The
 * order below is read straight off that table — `unledgered` authorizes
 * nothing at all; `excluded` authorizes a fact about the record; `absent` a
 * fact about the path's history; `scoped-unread` participation; then the two
 * readings, dated before current. A gap the spec left open, filled here and
 * recorded rather than left to each caller to guess at.
 */
export const STANDING_AUTHORITY_ORDER: readonly StandingState[] = [
  "unledgered",
  "excluded",
  "absent",
  "scoped-unread",
  "examined-stale",
  "examined",
] as const;

export interface StandingAuthorization {
  authorizes: string;
  cannot_justify: string;
}

export interface OwnerStanding {
  subsystem_id: string;
  subsystem_name: string | null;
  classification: string | null;
  standing_state: StandingState;
  authority_ceiling: string | null;
  ref_sha: string | null;
  examined_at: string | null;
  stale: number;
  stale_reason: string | null;
  reachability_checked: boolean;
  authorization_downgraded: string | null;
  authorizes: string;
  cannot_justify: string;
}

export interface DeferredOwner {
  subsystem_id: string;
  subsystem_name: string | null;
  reason: string | null;
}

export interface AuthorityCeiling {
  value: string;
  label: string;
  authorizes: string;
  cannot_justify: string;
  deferred_owners: DeferredOwner[];
  /** §2.4.3's added sentence when any owner is deferred; empty otherwise. */
  deferred_note: string;
  caveat: string;
}

export interface RevisionBlock {
  checked_sha: string | null;
  checked_at: string | null;
  repository_head: string | null;
  origin_head: string | null;
  agrees: boolean;
  unchecked_since: string | null;
}

export interface MeasuredBlock {
  ledger_rows: number;
  ledger_reconciled: boolean | null;
  reconciliation_receipt: { last_checked_sha: string; last_checked_at: string | null } | null;
  staleness_measured: boolean;
  evidence_rows: number;
  claims_recorded: number;
}

export interface UnknownEntry {
  kind:
    | "concern-without-disposition"
    | "candidate-sibling"
    | "open-question"
    | "open-lead"
    | "unassessed-seam";
  [field: string]: unknown;
}

export interface FileStandingBlock {
  owners: OwnerStanding[];
  state: StandingState;
  authority_ceiling: AuthorityCeiling;
  revision: RevisionBlock;
  measured: MeasuredBlock;
  unknown: UnknownEntry[];
  authorizes: string;
  cannot_justify: string;
  reachability_checked: boolean;
  authorization_downgraded: string | null;
}

export interface SubsystemStandingBlock {
  state: string;
  name: string | null;
  authorizes: string;
  cannot_justify: string;
  ledger: {
    examined: number;
    candidate: number;
    excluded: number;
    stale: number;
    total: number;
  };
  concerns: {
    applicable: number;
    covered: number;
    by_classification: Record<string, number>;
  };
  findings: Record<string, number>;
  seams: { seam_id: string; shared_object: string; side: string; assessable: number }[];
  revision: RevisionBlock;
  measured: MeasuredBlock;
  unknown: UnknownEntry[];
}

export interface SymbolStandingBlock {
  file: FileStandingBlock;
  symbol: string;
  symbol_cited: boolean;
  citing_evidence: { id: number; kind: string; ref_sha: string }[];
  symbol_prefix_matches: { id: number; kind: string; symbol: string; match: "prefix" }[];
  symbol_standing?: string;
  note?: string;
}

export interface TermStandingBlock {
  state: "defined" | "not-defined";
  term: string;
  gloss?: string | null;
  expansion?: string | null;
  subsystem_id?: string | null;
  first_seen?: string | null;
  ref_sha?: string | null;
  nearest_terms?: string[];
}

export type StandingBlock =
  | FileStandingBlock
  | SubsystemStandingBlock
  | SymbolStandingBlock
  | TermStandingBlock;

export interface LocusStanding {
  locus: ResolvedLocus;
  standing: StandingBlock;
}

// ---------------------------------------------------------------------------
// §2.3's authorization text, read from the single enum source
// ---------------------------------------------------------------------------

/** What a standing state authorizes and what it cannot justify (VP12). */
export function standingAuthorization(state: string): StandingAuthorization {
  const value = VOCABULARY.standing_state?.values.find((v) => v.value === state);
  return {
    authorizes: value?.authorizes ?? "nothing",
    cannot_justify: value?.cannot_justify ?? "any claim about this locus",
  };
}

/** The reader-facing label for a standing state, from the same enum source. */
export function standingLabel(state: string): string {
  return VOCABULARY.standing_state?.values.find((v) => v.value === state)?.label ?? state;
}

function subsystemAuthorization(status: string): StandingAuthorization {
  const value = VOCABULARY.subsystem_status?.values.find((v) => v.value === status);
  return {
    authorizes: value?.authorizes ?? "nothing",
    cannot_justify: value?.cannot_justify ?? "any claim beyond the recorded rows",
  };
}

// ---------------------------------------------------------------------------
// §2.1 — deterministic locus resolution
// ---------------------------------------------------------------------------

/**
 * Normalize a path without refusing one. `requireWorkspaceSourcePath` is the
 * guard at ingress and it throws; kind inference has to be able to *look* at a
 * candidate before deciding it is a path at all, so the two are separated and
 * the throwing form is applied once the kind is settled.
 */
function normalizeCandidate(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function pathIsNamedByATable(db: DB, path: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS present
         WHERE EXISTS (SELECT 1 FROM file_ledger WHERE file_path = :path)
            OR EXISTS (SELECT 1 FROM scope_gaps  WHERE file_path = :path)
            OR EXISTS (SELECT 1 FROM evidence    WHERE file_path = :path)`,
    )
    .get({ path }) as { present: number } | undefined;
  return !!row;
}

/** §2.1 step 5: contains `/`, or ends in a `.<ext>` of one to six alphanumerics. */
function pathShaped(value: string): boolean {
  return value.includes("/") || /\.[A-Za-z0-9]{1,6}$/.test(value);
}

function isSubsystemId(db: DB, value: string): boolean {
  return !!db.prepare("SELECT 1 FROM subsystems WHERE id = ?").get(value);
}

function isVocabularyTerm(db: DB, value: string): boolean {
  return !!db.prepare("SELECT 1 FROM vocabulary WHERE term = ?").get(value);
}

function asSymbol(value: string, step: LocusInferenceStep): ResolvedLocus {
  const splitAt = value.indexOf(":");
  const path = requireWorkspaceSourcePath(normalizeCandidate(value.slice(0, splitAt)), "locus");
  return {
    value,
    kind: "symbol",
    kind_inferred_by: step,
    split_at: splitAt,
    path,
    symbol: value.slice(splitAt + 1),
    subsystem_id: null,
    term: null,
  };
}

function asFile(value: string, step: LocusInferenceStep): ResolvedLocus {
  return {
    value,
    kind: "file",
    kind_inferred_by: step,
    split_at: null,
    path: requireWorkspaceSourcePath(normalizeCandidate(value), "locus"),
    symbol: null,
    subsystem_id: null,
    term: null,
  };
}

function asSubsystem(value: string, step: LocusInferenceStep): ResolvedLocus {
  return {
    value,
    kind: "subsystem",
    kind_inferred_by: step,
    split_at: null,
    path: null,
    symbol: null,
    subsystem_id: value,
    term: null,
  };
}

function asTerm(value: string, step: LocusInferenceStep): ResolvedLocus {
  return {
    value,
    kind: "term",
    kind_inferred_by: step,
    split_at: null,
    path: null,
    symbol: null,
    subsystem_id: null,
    term: value,
  };
}

/**
 * Resolve a locus string to a kind, in §2.1's fixed order.
 *
 * A caller may force the kind; the response says so rather than reporting a
 * step that never ran.
 */
export function resolveLocus(db: DB, value: string, kind?: LocusKind | null): ResolvedLocus {
  if (kind) {
    if (kind === "symbol") return asSymbol(value, "caller-supplied");
    if (kind === "file") return asFile(value, "caller-supplied");
    if (kind === "subsystem") return asSubsystem(value, "caller-supplied");
    return asTerm(value, "caller-supplied");
  }
  // 1. exact subsystems.id
  if (isSubsystemId(db, value)) return asSubsystem(value, "subsystem-id");
  // 2. exact vocabulary.term — before the colon test, because terms carry colons
  if (isVocabularyTerm(db, value)) return asTerm(value, "vocabulary-term");
  // 3. contains ':' — split at the first one; the whole remainder is the symbol
  if (value.includes(":")) return asSymbol(value, "colon-split");
  // 4. a path some table names
  const candidate = normalizeCandidate(value);
  if (pathIsNamedByATable(db, candidate)) return asFile(value, "ledgered-path");
  // 5. path-shaped and named nowhere: `unledgered`, not `not-defined`
  if (pathShaped(candidate)) return asFile(value, "path-shaped");
  // 6. otherwise a term the vocabulary does not define
  return asTerm(value, "bare-term");
}

// ---------------------------------------------------------------------------
// Git, run in the bound workspace. Every failure is a value, never a throw:
// standing has to report an unavailable git, not fail on it.
// ---------------------------------------------------------------------------

interface GitProbe {
  available: boolean;
  head: string | null;
  run: (args: string[]) => { status: number | null; stdout: string };
}

function gitProbe(ctx: ServerContext): GitProbe {
  const run = (args: string[]) => {
    try {
      const result = spawnSync("git", args, {
        cwd: ctx.project.workspacePath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (result.error) return { status: null, stdout: "" };
      return { status: result.status, stdout: String(result.stdout ?? "").trim() };
    } catch {
      return { status: null, stdout: "" };
    }
  };
  const dir = run(["rev-parse", "--git-dir"]);
  if (dir.status !== 0) return { available: false, head: null, run };
  const head = run(["rev-parse", "HEAD"]);
  return { available: true, head: head.status === 0 ? head.stdout : null, run };
}

/**
 * §2.2's reachability table. Only ever consulted for a row the view left
 * `examined`; the two failures carry distinct reasons because `detect_changes`
 * already owns `unverifiable-ref` and using one word for both rules would make
 * the same label mean two things across two writers. A missing revision joins
 * the unresolvable outcome rather than passing (F4/codex).
 */
function reachability(
  git: GitProbe,
  refSha: string | null,
): { state: "examined" | "examined-stale"; reason: string | null } {
  // A row with no examination revision is the limiting case of the table's
  // first outcome, not an exemption from it: there is no revision for
  // `rev-parse` to resolve, so the reading cannot be attributed to a commit
  // and ADR-0001 § Current will not grant it current authority. It reads
  // `unverifiable-ref` for the same reason a bad SHA does — a commit that
  // cannot be compared against — and `detect_changes` never revisits it,
  // because that pass only checks rows that carry a `ref_sha`.
  if (!refSha) return { state: "examined-stale", reason: "unverifiable-ref" };
  const resolved = git.run(["rev-parse", "--verify", `${refSha}^{commit}`]);
  if (resolved.status !== 0) return { state: "examined-stale", reason: "unverifiable-ref" };
  if (!git.head) return { state: "examined-stale", reason: "unverifiable-ref" };
  const ancestor = git.run(["merge-base", "--is-ancestor", resolved.stdout, git.head]);
  if (ancestor.status === 0) return { state: "examined", reason: null };
  if (ancestor.status === 1) return { state: "examined-stale", reason: "unreachable-ref" };
  // git could not answer the question at all, which is the `unverifiable` case.
  return { state: "examined-stale", reason: "unverifiable-ref" };
}

// ---------------------------------------------------------------------------
// §2.4.4 — revision
// ---------------------------------------------------------------------------

interface GitStateRow {
  canonical_branch: string | null;
  last_checked_sha: string | null;
  last_checked_at: string | null;
}

function gitStateRow(db: DB): GitStateRow | null {
  return (
    (db
      .prepare(
        "SELECT canonical_branch, last_checked_sha, last_checked_at FROM git_state WHERE repo_id = 'default'",
      )
      .get() as GitStateRow | undefined) ?? null
  );
}

/**
 * The upstream head, resolved the way `source_alignment` resolves it: ask git
 * which ref the canonical branch tracks, and fall back to the conventional
 * `origin/<branch>` only when no upstream is configured. Reading
 * `refs/remotes/origin/<branch>` first reports the wrong ref in any clone whose
 * remote is not named `origin`.
 */
function originHead(git: GitProbe, branch: string | null): string | null {
  if (!git.available || !branch) return null;
  const upstream = git.run(["rev-parse", "--verify", `${branch}@{upstream}`]);
  if (upstream.status === 0 && upstream.stdout) return upstream.stdout;
  const fallback = git.run(["rev-parse", "--verify", `refs/remotes/origin/${branch}`]);
  return fallback.status === 0 && fallback.stdout ? fallback.stdout : null;
}

function revisionBlock(db: DB, git: GitProbe): RevisionBlock {
  const state = gitStateRow(db);
  const checked = state?.last_checked_sha ?? null;
  const head = git.head;
  const agrees = checked !== null && head !== null && checked === head;
  return {
    checked_sha: checked,
    checked_at: state?.last_checked_at ?? null,
    repository_head: head,
    origin_head: originHead(git, state?.canonical_branch ?? null),
    agrees,
    unchecked_since: agrees ? null : checked,
  };
}

// ---------------------------------------------------------------------------
// §2.4.5 — measured. Every count carries its denominator (VP4).
// ---------------------------------------------------------------------------

function reconciliationReceipt(db: DB): MeasuredBlock["reconciliation_receipt"] {
  const state = gitStateRow(db);
  if (!state?.last_checked_sha) return null;
  return { last_checked_sha: state.last_checked_sha, last_checked_at: state.last_checked_at };
}

function measuredForPath(db: DB, path: string, ownerRows: number): MeasuredBlock {
  const gapRows = (
    db
      .prepare("SELECT COUNT(*) AS n FROM scope_gaps WHERE file_path = ? AND kind = 'unledgered'")
      .get(path) as { n: number }
  ).n;
  const evidenceRows = (
    db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE file_path = ?").get(path) as { n: number }
  ).n;
  const claims = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT c.claim_id) AS n
           FROM claims c
           JOIN claim_evidence ce ON ce.claim_id = c.claim_id
           JOIN evidence e ON e.id = ce.evidence_id
          WHERE e.file_path = ? AND c.valid_until_sha IS NULL`,
      )
      .get(path) as { n: number }
  ).n;
  return {
    ledger_rows: ownerRows,
    // `scope_gaps` records only unledgered and absent paths and is rebuilt by
    // every reconciliation, so a ledgered path has zero gap rows whether or
    // not a reconciliation has ever run. A zero there proves nothing, so the
    // field is null and the receipt below carries what is actually known.
    ledger_reconciled: ownerRows === 0 ? gapRows > 0 : null,
    reconciliation_receipt: ownerRows === 0 ? null : reconciliationReceipt(db),
    staleness_measured: ownerRows > 0,
    evidence_rows: evidenceRows,
    claims_recorded: claims,
  };
}

// ---------------------------------------------------------------------------
// §2.4.6 — unknown[], five sources and no others
// ---------------------------------------------------------------------------

const SEAM_BINDING = "per-party-proxy; no seam-bound disposition is recorded";

/**
 * Where a field note's free-form `location` touched the locus. A directory
 * prefix must never read as a file-level binding, so the match is reported
 * rather than assumed.
 */
export type LocationMatch = "exact" | "prefix" | "owner" | "none";

function locationMatch(
  location: string | null,
  path: string | null,
  owners: string[],
): LocationMatch {
  if (!location) return "none";
  const tokens = location
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (path) {
    for (const token of tokens) {
      if (token === path) return "exact";
      if (token.startsWith(`${path}:`)) return "exact";
    }
    for (const token of tokens) {
      const directory = token.endsWith("/") ? token : `${token}/`;
      if (path.startsWith(directory)) return "prefix";
    }
  }
  for (const token of tokens) if (owners.includes(token)) return "owner";
  return "none";
}

interface UnknownScope {
  owners: string[];
  path: string | null;
}

function concernsWithoutDisposition(db: DB, scope: UnknownScope): UnknownEntry[] {
  if (scope.owners.length === 0) return [];
  const placeholders = scope.owners.map(() => "?").join(",");
  // The unit is the (owner, concern) pair. Quantified over "any owner" this
  // predicate reports nothing on a store where every active concern is
  // dispositioned *somewhere*, which is a zero-denominator green (VP4).
  const rows = db
    .prepare(
      `SELECT s.id AS subsystem_id, c.code AS concern_code, c.category
         FROM concerns c
         JOIN subsystems s ON s.id IN (${placeholders})
        WHERE c.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM dispositions d
                           WHERE d.subsystem_id = s.id AND d.concern_code = c.code)
        ORDER BY s.id, c.code`,
    )
    .all(...scope.owners) as { subsystem_id: string; concern_code: string; category: string }[];
  return rows.map((row) => ({
    kind: "concern-without-disposition",
    subsystem_id: row.subsystem_id,
    concern_code: row.concern_code,
    category: row.category,
  }));
}

function candidateSiblings(db: DB, scope: UnknownScope): UnknownEntry[] {
  if (scope.owners.length === 0) return [];
  const placeholders = scope.owners.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT DISTINCT file_path
         FROM file_ledger
        WHERE subsystem_id IN (${placeholders})
          AND COALESCE(classification, 'candidate') = 'candidate'
          AND file_path != ?
        ORDER BY file_path`,
    )
    .all(...scope.owners, scope.path ?? "") as { file_path: string }[];
  if (rows.length === 0) return [];
  return [
    {
      kind: "candidate-sibling",
      count: rows.length,
      paths: rows.slice(0, 5).map((row) => row.file_path),
    },
  ];
}

function openQuestions(db: DB, scope: UnknownScope): UnknownEntry[] {
  if (scope.owners.length === 0) return [];
  const placeholders = scope.owners.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, subsystem_id, category, question
         FROM open_questions
        WHERE resolution = 'open' AND subsystem_id IN (${placeholders})
        ORDER BY id`,
    )
    .all(...scope.owners) as {
    id: number;
    subsystem_id: string;
    category: string;
    question: string;
  }[];
  return rows.map((row) => ({
    kind: "open-question",
    question_id: row.id,
    subsystem_id: row.subsystem_id,
    category: row.category,
    question: row.question,
    // `open_questions` carries no locus column, so the binding is the
    // subsystem and the entry says so rather than implying the file.
    scope: "subsystem",
  }));
}

function openLeads(db: DB, scope: UnknownScope): UnknownEntry[] {
  const rows = db
    .prepare(
      "SELECT id, category, observation, location FROM field_notes WHERE follow_up = 'open' ORDER BY id",
    )
    .all() as { id: number; category: string; observation: string; location: string | null }[];
  const out: UnknownEntry[] = [];
  for (const row of rows) {
    const match = locationMatch(row.location, scope.path, scope.owners);
    if (match === "none") continue;
    out.push({
      kind: "open-lead",
      note_id: row.id,
      category: row.category,
      observation: row.observation,
      location: row.location,
      location_match: match,
    });
  }
  return out;
}

function unassessedSeams(db: DB, scope: UnknownScope): UnknownEntry[] {
  if (scope.owners.length === 0) return [];
  const placeholders = scope.owners.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT seam_id, shared_object, party_a, party_b, assessable
         FROM seam_assessability
        WHERE party_a IN (${placeholders}) OR party_b IN (${placeholders})
        ORDER BY seam_id`,
    )
    .all(...scope.owners, ...scope.owners) as {
    seam_id: string;
    shared_object: string;
    party_a: string;
    party_b: string;
    assessable: number;
  }[];
  const holdsSeamConcern = db.prepare(
    "SELECT 1 FROM dispositions WHERE subsystem_id = ? AND concern_code LIKE 'SC-%'",
  );
  const out: UnknownEntry[] = [];
  for (const row of rows) {
    // The unit is the (seam, side) pair. Quantified over "either party" this
    // predicate reports nothing for a seam one of whose sides has assessed a
    // seam concern, which is every seam that is half-assessed.
    for (const side of ["a", "b"] as const) {
      const subsystemId = side === "a" ? row.party_a : row.party_b;
      if (!scope.owners.includes(subsystemId)) continue;
      const assessed = !!holdsSeamConcern.get(subsystemId);
      if (row.assessable === 1 && assessed) continue;
      out.push({
        kind: "unassessed-seam",
        seam_id: row.seam_id,
        shared_object: row.shared_object,
        side,
        subsystem_id: subsystemId,
        assessable: row.assessable,
        reason: row.assessable === 0 ? "not-assessable" : "no-seam-concern-disposition",
        // `dispositions` has no seam id, so an SC-% row proves that this party
        // assessed *some* seam concern, never that it assessed this seam.
        binding: SEAM_BINDING,
      });
    }
  }
  return out;
}

/** §2.4.6's five sources, in the order the table lists them. */
export function collectUnknown(db: DB, scope: UnknownScope): UnknownEntry[] {
  return [
    ...concernsWithoutDisposition(db, scope),
    ...candidateSiblings(db, scope),
    ...openQuestions(db, scope),
    ...openLeads(db, scope),
    ...unassessedSeams(db, scope),
  ];
}

// ---------------------------------------------------------------------------
// §2.4.3 — the authority ceiling
// ---------------------------------------------------------------------------

/**
 * §2.4.3's caveat, carried verbatim from the skill's authorized-claims ladder.
 * `mapped` marks the workflow complete; the underlying records govern.
 */
const CEILING_CAVEAT =
  "mapped is a workflow completion mark and is not itself proof that every finding survived challenge.";

function ceilingFor(db: DB, ownerIds: string[]): AuthorityCeiling {
  const rows =
    ownerIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT id, name, status, notes FROM subsystems
              WHERE id IN (${ownerIds.map(() => "?").join(",")}) ORDER BY id`,
          )
          .all(...ownerIds) as {
          id: string;
          name: string | null;
          status: string;
          notes: string | null;
        }[]);
  const deferred: DeferredOwner[] = rows
    .filter((row) => row.status === "deferred")
    .map((row) => ({ subsystem_id: row.id, subsystem_name: row.name, reason: row.notes }));
  // `deferred` is an orthogonal do-not-survey flag, not a rung on the ladder
  // (invariants.ts STATUS_ORDER), so no rank is defined for it and none is
  // invented here. A ledger row whose subsystem has no row at all is ranked
  // `unmapped`: the weakest reading is the only safe one.
  const ranked = rows
    .filter((row) => row.status !== "deferred")
    .map((row) => (statusRank(row.status) === undefined ? "unmapped" : row.status));
  // Kept out of `authorizes` so that the authorization sentence stays exactly
  // the one the enum source carries; a reader surface renders both.
  const deferredNote = deferred.length
    ? `${deferred.length} owning subsystem(s) are deferred; nothing was surveyed there.`
    : "";
  if (ranked.length === 0) {
    const everyOwnerDeferred = rows.length > 0;
    const value = everyOwnerDeferred ? "deferred" : "unmapped";
    const base = everyOwnerDeferred
      ? { authorizes: "nothing", cannot_justify: "any claim about this file's content or behavior" }
      : subsystemAuthorization("unmapped");
    return {
      value,
      label: VOCABULARY.subsystem_status?.values.find((v) => v.value === value)?.label ?? value,
      authorizes: base.authorizes,
      cannot_justify: base.cannot_justify,
      deferred_owners: deferred,
      deferred_note: deferredNote,
      caveat: CEILING_CAVEAT,
    };
  }
  let weakest = ranked[0] as string;
  for (const status of ranked) {
    if ((statusRank(status) ?? 0) < (statusRank(weakest) ?? 0)) weakest = status;
  }
  const authorization = subsystemAuthorization(weakest);
  return {
    value: weakest,
    label: VOCABULARY.subsystem_status?.values.find((v) => v.value === weakest)?.label ?? weakest,
    authorizes: authorization.authorizes,
    cannot_justify: authorization.cannot_justify,
    deferred_owners: deferred,
    deferred_note: deferredNote,
    caveat: CEILING_CAVEAT,
  };
}

// ---------------------------------------------------------------------------
// §2.2, §2.4 — the file standing block
// ---------------------------------------------------------------------------

interface StandingRow {
  file_path: string;
  subsystem_id: string;
  subsystem_name: string | null;
  classification: string | null;
  standing_state: StandingState;
  authority_ceiling: string | null;
  ref_sha: string | null;
  examined_at: string | null;
  stale: number;
  stale_reason: string | null;
}

function weakestState(states: StandingState[]): StandingState {
  let weakest = states[0] as StandingState;
  for (const state of states) {
    if (STANDING_AUTHORITY_ORDER.indexOf(state) < STANDING_AUTHORITY_ORDER.indexOf(weakest))
      weakest = state;
  }
  return weakest;
}

export function fileStanding(ctx: ServerContext, path: string): FileStandingBlock {
  const db = ctx.db;
  const git = gitProbe(ctx);
  const rows = db
    .prepare(
      `SELECT file_path, subsystem_id, subsystem_name, classification, standing_state,
              authority_ceiling, ref_sha, examined_at, stale, stale_reason
         FROM file_standing WHERE file_path = ? ORDER BY subsystem_id`,
    )
    .all(path) as StandingRow[];

  const owners: OwnerStanding[] = rows.map((row) => {
    let state = row.standing_state;
    let reason = row.stale_reason;
    let checked = true;
    let downgraded: string | null = null;
    if (state === "examined") {
      if (!git.available) {
        // ADR-0001 makes a resolving evidence revision part of what current
        // authority requires. The ledger row still says `examined` and the
        // state reports it; the authorization served is the dated one.
        checked = false;
        downgraded = "reachability-unchecked";
      } else {
        const verdict = reachability(git, row.ref_sha);
        state = verdict.state;
        if (verdict.reason) reason = verdict.reason;
      }
    }
    const authorization = standingAuthorization(downgraded ? "examined-stale" : state);
    return {
      subsystem_id: row.subsystem_id,
      subsystem_name: row.subsystem_name,
      classification: row.classification,
      standing_state: state,
      authority_ceiling: row.authority_ceiling,
      ref_sha: row.ref_sha,
      examined_at: row.examined_at,
      stale: row.stale,
      stale_reason: reason,
      reachability_checked: checked,
      authorization_downgraded: downgraded,
      authorizes: authorization.authorizes,
      cannot_justify: authorization.cannot_justify,
    };
  });

  let state: StandingState;
  if (owners.length === 0) {
    const absentRows = (
      db
        .prepare("SELECT COUNT(*) AS n FROM scope_gaps WHERE file_path = ? AND kind = 'absent'")
        .get(path) as { n: number }
    ).n;
    // §2.4.2's zero-owner state. A recorded `absent` gap is the more specific
    // of the two facts, so it is reported instead of the bare `unledgered`.
    state = absentRows > 0 ? "absent" : "unledgered";
  } else {
    const distinct = [...new Set(owners.map((owner) => owner.standing_state))];
    state = distinct.length === 1 ? (distinct[0] as StandingState) : "mixed";
  }

  // §2.3: `mixed` authorizes only what the weakest owner authorizes, and a
  // downgraded row's authorization is what it was downgraded to.
  const effective =
    state === "mixed"
      ? weakestState(
          owners.map((owner) =>
            owner.authorization_downgraded ? "examined-stale" : owner.standing_state,
          ),
        )
      : owners.some((owner) => owner.authorization_downgraded) && state === "examined"
        ? "examined-stale"
        : state;
  const authorization = standingAuthorization(effective);
  const downgraded = owners.find((owner) => owner.authorization_downgraded) ?? null;

  const ownerIds = owners.map((owner) => owner.subsystem_id);
  return {
    owners,
    state,
    authority_ceiling: ceilingFor(db, ownerIds),
    revision: revisionBlock(db, git),
    measured: measuredForPath(db, path, owners.length),
    unknown: collectUnknown(db, { owners: ownerIds, path }),
    authorizes: authorization.authorizes,
    cannot_justify: authorization.cannot_justify,
    reachability_checked:
      owners.length === 0 ? git.available : owners.every((o) => o.reachability_checked),
    authorization_downgraded: downgraded?.authorization_downgraded ?? null,
  };
}

// ---------------------------------------------------------------------------
// §2.5 — the other locus kinds
// ---------------------------------------------------------------------------

export function subsystemStanding(ctx: ServerContext, subsystemId: string): SubsystemStandingBlock {
  const db = ctx.db;
  const git = gitProbe(ctx);
  const row = db.prepare("SELECT id, name, status FROM subsystems WHERE id = ?").get(subsystemId) as
    | { id: string; name: string | null; status: string }
    | undefined;
  const status = row?.status ?? "unmapped";
  const ledger = db
    .prepare(
      `SELECT
         SUM(CASE WHEN standing_state = 'examined' OR standing_state = 'examined-stale' THEN 1 ELSE 0 END) AS examined,
         SUM(CASE WHEN standing_state = 'scoped-unread' THEN 1 ELSE 0 END) AS candidate,
         SUM(CASE WHEN standing_state = 'excluded' THEN 1 ELSE 0 END) AS excluded,
         SUM(CASE WHEN stale = 1 THEN 1 ELSE 0 END) AS stale,
         COUNT(*) AS total
       FROM file_standing WHERE subsystem_id = ?`,
    )
    .get(subsystemId) as Record<string, number | null>;
  const applicable = (
    db.prepare("SELECT COUNT(*) AS n FROM concerns WHERE status = 'active'").get() as { n: number }
  ).n;
  const dispositions = db
    .prepare(
      `SELECT d.classification, COUNT(*) AS n
         FROM dispositions d JOIN concerns c ON c.code = d.concern_code
        WHERE d.subsystem_id = ? AND c.status = 'active'
        GROUP BY d.classification ORDER BY d.classification`,
    )
    .all(subsystemId) as { classification: string | null; n: number }[];
  const byClassification: Record<string, number> = {};
  for (const value of VOCABULARY.disposition_classification?.values ?? [])
    byClassification[value.value] = 0;
  let covered = 0;
  for (const entry of dispositions) {
    covered += entry.n;
    if (entry.classification) byClassification[entry.classification] = entry.n;
  }
  const findings = db
    .prepare(
      "SELECT resolution_state, COUNT(*) AS n FROM finding_state_current WHERE subsystem_id = ? GROUP BY resolution_state ORDER BY resolution_state",
    )
    .all(subsystemId) as { resolution_state: string; n: number }[];
  const byState: Record<string, number> = {};
  for (const value of VOCABULARY.finding_resolution_state?.values ?? []) byState[value.value] = 0;
  for (const entry of findings) byState[entry.resolution_state] = entry.n;
  const seams = db
    .prepare(
      `SELECT seam_id, shared_object, party_a, party_b, assessable
         FROM seam_assessability WHERE party_a = ? OR party_b = ? ORDER BY seam_id`,
    )
    .all(subsystemId, subsystemId) as {
    seam_id: string;
    shared_object: string;
    party_a: string;
    party_b: string;
    assessable: number;
  }[];
  const authorization = subsystemAuthorization(status);
  return {
    state: status,
    name: row?.name ?? null,
    authorizes: authorization.authorizes,
    cannot_justify: authorization.cannot_justify,
    ledger: {
      examined: ledger.examined ?? 0,
      candidate: ledger.candidate ?? 0,
      excluded: ledger.excluded ?? 0,
      stale: ledger.stale ?? 0,
      total: ledger.total ?? 0,
    },
    concerns: { applicable, covered, by_classification: byClassification },
    findings: byState,
    seams: seams.map((seam) => ({
      seam_id: seam.seam_id,
      shared_object: seam.shared_object,
      side: seam.party_a === subsystemId ? "a" : "b",
      assessable: seam.assessable,
    })),
    revision: revisionBlock(db, git),
    measured: {
      ledger_rows: ledger.total ?? 0,
      ledger_reconciled: null,
      reconciliation_receipt: reconciliationReceipt(db),
      staleness_measured: (ledger.total ?? 0) > 0,
      evidence_rows: (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM evidence
              WHERE file_path IN (SELECT file_path FROM file_ledger WHERE subsystem_id = ?)`,
          )
          .get(subsystemId) as { n: number }
      ).n,
      claims_recorded: (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM claims WHERE subject_type = 'subsystem' AND subject_id = ? AND valid_until_sha IS NULL",
          )
          .get(subsystemId) as { n: number }
      ).n,
    },
    unknown: collectUnknown(db, { owners: [subsystemId], path: null }),
  };
}

export function symbolStanding(
  ctx: ServerContext,
  path: string,
  symbol: string,
): SymbolStandingBlock {
  const db = ctx.db;
  const file = fileStanding(ctx, path);
  const exact = db
    .prepare(
      "SELECT id, kind, ref_sha FROM evidence WHERE file_path = ? AND symbol = ? ORDER BY id",
    )
    .all(path, symbol) as { id: number; kind: string; ref_sha: string }[];
  // 45 of 209 recorded symbols on the reference store carry a parenthetical
  // qualifier, so exact match alone under-reports. The prefix rows are
  // reported beside the citation, never merged into `symbol_cited`.
  const prefix = db
    .prepare(
      `SELECT id, kind, symbol FROM evidence
        WHERE file_path = ? AND symbol IS NOT NULL AND symbol != ?
          AND (symbol LIKE ? ESCAPE '\\' OR symbol LIKE ? ESCAPE '\\')
        ORDER BY id`,
    )
    .all(
      path,
      symbol,
      `${symbol.replace(/[\\%_]/g, "\\$&")} %`,
      `${symbol.replace(/[\\%_]/g, "\\$&")}(%`,
    ) as { id: number; kind: string; symbol: string }[];
  const block: SymbolStandingBlock = {
    file,
    symbol,
    symbol_cited: exact.length > 0,
    citing_evidence: exact,
    symbol_prefix_matches: prefix.map((row) => ({
      id: row.id,
      kind: row.kind,
      symbol: row.symbol,
      match: "prefix" as const,
    })),
  };
  if (exact.length === 0) {
    block.symbol_standing = "not-individually-cited";
    block.note = "the file's state does not extend to this symbol";
  }
  return block;
}

/**
 * §2.5's nearest recorded terms: case-insensitive prefix matches in
 * lexicographic order, then lexicographic order over the remainder, capped at
 * five. No model call and no fuzzy scoring — the same store returns the same
 * five terms every time.
 */
export function nearestTerms(db: DB, term: string, limit = 5): string[] {
  const rows = db.prepare("SELECT term FROM vocabulary ORDER BY term").all() as { term: string }[];
  const needle = term.toLowerCase();
  const prefixed = rows
    .filter((row) => row.term.toLowerCase().startsWith(needle))
    .map((row) => row.term);
  const rest = rows.filter((row) => !prefixed.includes(row.term)).map((row) => row.term);
  return [...prefixed, ...rest].slice(0, limit);
}

export function termStanding(db: DB, term: string): TermStandingBlock {
  const row = db
    .prepare(
      "SELECT term, gloss, expansion, subsystem_id, first_seen, ref_sha FROM vocabulary WHERE term = ?",
    )
    .get(term) as
    | {
        term: string;
        gloss: string;
        expansion: string | null;
        subsystem_id: string | null;
        first_seen: string | null;
        ref_sha: string | null;
      }
    | undefined;
  if (!row) return { state: "not-defined", term, nearest_terms: nearestTerms(db, term) };
  return {
    state: "defined",
    term: row.term,
    gloss: row.gloss,
    expansion: row.expansion,
    subsystem_id: row.subsystem_id,
    first_seen: row.first_seen,
    ref_sha: row.ref_sha,
  };
}

// ---------------------------------------------------------------------------
// The one entry point the tools use
// ---------------------------------------------------------------------------

/** Resolve a locus and compute the standing block its kind calls for. */
export function describeLocusStanding(
  ctx: ServerContext,
  value: string,
  kind?: LocusKind | null,
): LocusStanding {
  const locus = resolveLocus(ctx.db, value, kind ?? null);
  if (locus.kind === "subsystem")
    return { locus, standing: subsystemStanding(ctx, locus.subsystem_id as string) };
  if (locus.kind === "term") return { locus, standing: termStanding(ctx.db, locus.term as string) };
  if (locus.kind === "symbol")
    return {
      locus,
      standing: symbolStanding(ctx, locus.path as string, locus.symbol as string),
    };
  return { locus, standing: fileStanding(ctx, locus.path as string) };
}

/** Re-exported so callers rank owner statuses against the one declared ladder. */
export { STATUS_ORDER };
