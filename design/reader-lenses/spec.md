# Reader lenses: normative specification

- Status: normative for the `reader-lenses` branch. Implementable without the session that wrote it.
- Binds: `design/reader-lenses/README.md` (proposal), `design/reader-lenses/decisions.md` (owner decisions).
- Governed by: ADR-0001 (terms), ADR-0005 (resolution proof and projection read-back),
  ADR-0010 (operational review labels), ADR-0011 (contract versioning, omission ledger),
  `.claude/skills/amanuensis/references/reporting-style.md` (register, IA/UI boundary).
- Practice catalog 2.13, stamp `3ffe3ba1f9e1`.
- Claim ids `C<n>` in this document refer to `design/reader-lenses/claims.md`.

Everything below is a contract. Where a rule is mechanical it names the file that enforces it;
a rule stated only in prose is not a guard (GP25). Nothing here may weaken an existing test,
gate, or read-back axis: every change is additive or strictly strengthening.

---

## 1. Labels

### 1.1 The four lenses

| Label | Operational meaning (one sentence) | Enum value |
|---|---|---|
| **Codebase** | The recorded account of what the project is, how it works, and which of its territory has not been read. | `codebase` |
| **Unresolved** | Records that have not reached a terminal, evidence-backed state at the checked revision, in ADR-0001's sense of *resolved*. | `unresolved` |
| **History** | Records that have reached a terminal state, plus — for the families that record one — the append-only account of how they got there, and the sessions and publications that produced them. | `history` |
| **Method** | The apparatus by which a reader judges how far the rest of the record can be trusted. | `method` |

The **Overview** is not a lens; it is the entrance (§7.2).

`Unresolved` and `History` partition every record that carries a resolution, an obligation, or a
terminal disposition. The partition rule is exactly ADR-0001's definition of *resolved*: a
terminal state, an authorized actor or rule, and resolution evidence or an explicit authorized
dismissal. A repair without verification evidence is `fixed-pending-verification` and therefore
**Unresolved** (ADR-0005). No record appears in both lenses as a full record.

Only two record families carry an append-only event trail: findings
(`finding_resolution_events`) and contradictions (`contradiction_resolution_events`), neither of
which any code path updates or deletes. `open_questions.resolution` and `field_notes.follow_up`
are mutable columns with no event table (`schema.sql:4538-4560`, `291-305`), so for those two
families History carries the terminal state and nothing about how it was reached.
`open_questions` at least records `resolved_at` (`schema.sql:4559`) and orders by it;
`field_notes` records no resolution time at all (`schema.sql:291-302`) and orders by `id`, which
is creation order, not resolution order. Both are stated on the page in one line: *"When this
reached its state is recorded; how it did is not."* for questions, and *"Neither when nor how
this lead reached its state is recorded, only that it did; the order below is the order the
leads were opened."* for leads. History never presents a reconstruction it cannot source.

### 1.2 Every user-visible label introduced

Standing states (§2), each with what it authorizes and what it cannot justify:

| Enum value | Human label | Operational meaning |
|---|---|---|
| `unledgered` | No record | No `file_ledger` row names this path in any subsystem. |
| `excluded` | Excluded | A ledger row classifies the path as generated, vendored, irrelevant, or deferred with a recorded reason. |
| `scoped-unread` | In scope, not yet read | A ledger row classifies the path `candidate`: it participates in a subsystem, and no one has read it. |
| `examined` | Examined | A ledger row classifies the path `examined`, it is not stale, and its examination revision resolves in the workspace. |
| `examined-stale` | Examined, since changed | The path was examined, and drift, absence, or an unreachable examination revision has withdrawn that reading's currency. |
| `absent` | No longer in the repository | A `scope_gaps` row of kind `absent`, or a ledger row whose `stale_reason` is `absent`. |
| `mixed` | Owners disagree | Two or more owning subsystems record different standing states for the same path. |

Account section labels (§3): **Purpose and entry**, **Structure**, **Known defects**,
**Concern review**, **Boundaries**, **Terms**, **Leads and questions**, **History**.

Page labels (§7.1): **Overview**, **Architecture**, **Subsystems**, **Files**,
**Not yet surveyed**, **System boundaries**, **Codebase glossary**, **Open findings**,
**Disagreements**, **Decisions needed**, **Leads**, **Stale knowledge**, **Hot spots**,
**Resolved findings**, **Resolution history**, **Resolved leads and questions**,
**Sessions and publications**, **Conflicting evidence**, **Reader's guide**,
**Review coverage**, **Review checklist**,
**Competing explanations**, **Onboarding record**, **Where to begin**.

Field labels introduced by standing: **Owners**, **Authority ceiling**, **Checked at**,
**Repository head**, **Origin head**, **Measured**, **Not known here**.

### 1.3 Register rules that bind these labels

- No decorative metaphor, no clinical register, no antiquarian furniture
  (`reporting-style.md` § "Avoid decorative registers").
- `Not yet surveyed` is fixed by the 2026-08-23 ruling and is not re-worded.
- No label may imply a workflow state the record does not hold. In particular no lens,
  page, or field is named for what a reader should *do*.
- Durable schema names (`file_ledger`, `dispositions`, `finding_resolution_events`) are not
  renamed. Translation happens only at the projection boundary.

---

## 2. Standing

Standing is the per-locus certainty gate. It is computed by code from existing tables and is
never authored by a model. It is a subtractive guard in the catalog's sense (GP8, and the v2
scope note: the guard is over fields code removes or checks, not over a field a writer authors).

### 2.1 Locus kinds

| Kind | Syntax | Resolution |
|---|---|---|
| `file` | a repository-relative path | normalized by `requireWorkspaceSourcePath` |
| `symbol` | `<path>:<symbol>` | split at the **first** `:`; the path is normalized and the entire remainder — further `::` included — is the symbol |
| `subsystem` | a subsystem id (`^[A-Za-z]-?\d+$` or any `subsystems.id`) | exact match on `subsystems.id` |
| `term` | any other string | exact match on `vocabulary.term`, else nearest recorded terms |

Kind is inferred deterministically in this order, and the order is a code constant:

1. exact `subsystems.id` match ⟹ `subsystem`;
2. exact `vocabulary.term` match ⟹ `term`;
3. contains `:` ⟹ `symbol`, splitting at the **first** `:`; everything after it is the symbol,
   so `crates/x.rs:GraphWriteCoordinator::evict_idle_locks` yields the symbol
   `GraphWriteCoordinator::evict_idle_locks`;
4. exact match on `file_ledger.file_path`, `scope_gaps.file_path`, or `evidence.file_path`
   ⟹ `file`;
5. path-shaped — contains `/`, or ends in a `.<ext>` of one to six alphanumerics — ⟹ `file`,
   resolving to `unledgered` rather than being mis-kinded as a term;
6. otherwise `term`, resolving to `not-defined`.

Step 2 precedes step 3 because stored terms contain `:`: the AxiomDB store's vocabulary holds
`Severity (sh:Violation / sh:Warning / sh:Info)`, which the old order kinded `symbol` and left
unreachable. Step 5 precedes step 6 because §2.2's `unledgered` state exists precisely for a
path no table names; falling through to `term`/`not-defined` contradicts it.

The chosen kind is always echoed in the response as `locus.kind`; a caller may force it with the
`kind` argument. `kind_inferred_by` names the step that decided it.

### 2.2 The state enum and its mechanical predicate

One new view carries the per-owner predicate. It adds no table.

```sql
CREATE VIEW IF NOT EXISTS file_standing AS
SELECT l.file_path,
       l.subsystem_id,
       l.classification,
       CASE
         WHEN l.stale_reason = 'absent'                       THEN 'absent'
         WHEN l.classification IN ('generated-ignore','vendor-ignore',
                                   'irrelevant','deferred-with-reason')
                                                              THEN 'excluded'
         WHEN COALESCE(l.classification,'candidate')='candidate' THEN 'scoped-unread'
         WHEN l.classification = 'examined' AND l.stale = 0    THEN 'examined'
         WHEN l.classification = 'examined'                    THEN 'examined-stale'
         ELSE 'scoped-unread'
       END                                                     AS standing_state,
       l.stale, l.stale_reason, l.ref_sha, l.examined_at,
       s.status                                                AS authority_ceiling
  FROM file_ledger l
  LEFT JOIN subsystems s ON s.id = l.subsystem_id;
```

`unledgered` is the absence of every row for the path:

```sql
SELECT (SELECT COUNT(*) FROM file_standing WHERE file_path = :path)                     AS owner_rows,
       (SELECT COUNT(*) FROM scope_gaps WHERE file_path = :path AND kind='unledgered')  AS gap_rows,
       (SELECT COUNT(*) FROM scope_gaps WHERE file_path = :path AND kind='absent')      AS absent_rows;
```

`owner_rows = 0` ⟹ headline state `unledgered`. `gap_rows` is meaningful **only** when
`owner_rows = 0`: there it distinguishes *recorded as unledgered by a reconciliation* from *never
reconciled*, and it is reported as `measured.ledger_reconciled`. For a path that has owner rows,
`scope_gaps` is silent by construction (`detect_changes` rebuilds the table each run and records
only unledgered and absent paths, `schema.sql:186-193`), so `ledger_reconciled` is **null** there
and the response instead carries `measured.reconciliation_receipt`:
`{ last_checked_sha, last_checked_at }` from `git_state` (`schema.sql:63-71`), or `null` when no
reconciliation has ever run. A zero gap count is never presented as proof of reconciliation.

**Reachability is not decidable in SQL.** After the view returns `examined`, the tool runs
`git rev-parse --verify <ref_sha>^{commit}` and then
`git merge-base --is-ancestor <ref_sha> HEAD` in the bound workspace. The two failures are
distinct states, and they carry distinct reasons because the existing reconciliation already owns
one of the two words:

| Outcome | `standing_state` | `stale_reason` |
|---|---|---|
| `rev-parse` cannot resolve the revision | `examined-stale` | `unverifiable-ref` |
| resolves, but is not an ancestor of HEAD | `examined-stale` | `unreachable-ref` |
| resolves and is an ancestor | `examined` | unchanged |

`unverifiable-ref` keeps exactly the meaning `detect_changes` already writes it with — a commit
that cannot be compared against (`mcp-server/src/tools/git.ts:246-262` pushes a row to
`unverifiable` only when `git diff --name-only <ref> <head>` itself fails). Using one word for
both rules would make the same label mean two things across two writers, which is the defect
§1.3 forbids. `unreachable-ref` is a new value of `file_ledger.stale_reason`, which carries no
CHECK constraint (`schema.sql:175`), and is added to the `standing_state` enum source of §10.1.

When git is unavailable the tool reports `reachability_checked: false`. The state stays
`examined` — the ledger row says what it says — but the **authorization** does not: ADR-0001
§ Current makes a resolving evidence revision part of what current authority requires, so with
`reachability_checked: false` the `authorizes` and `cannot_justify` text served for that row is
the `examined-stale` row of §2.3, and the response carries
`authorization_downgraded: "reachability-unchecked"`. The tool never silently upgrades, and it
never serves `examined`'s authorization on an unchecked reading.

**The view must exist before anything reads it.** `file_standing` and `finding_state_current`
are created by `initializeSchema` in `mcp-server/src/db.ts:48-53`, which only `openDatabase`
calls; the materializer opens the store read-only
(`materializer/amanuensis_materializer/db.py:15-23`, `mode=ro`) and never applies `schema.sql`.
A store last opened by an older server therefore lacks both views while `files.md` (§7.4) and
§6.1 read them. The materializer probes
`SELECT 1 FROM sqlite_master WHERE type='view' AND name IN ('file_standing','finding_state_current')`
at the start of every render and, when either is missing, **turns the publish red** with the
named cause *"the store predates the reader-lens views; open it once with the current MCP server
to create them"*. It never falls back to an inline copy of the predicate: two copies of one
definition is the false green §13 already names.

### 2.3 What each state authorizes and cannot justify (VP12)

| State | Authorizes | Cannot justify |
|---|---|---|
| `unledgered` | nothing | "there are no findings here"; "this file is out of scope" |
| `excluded` | the recorded exclusion reason and classification | any claim about the file's content or behavior |
| `scoped-unread` | "this file participates in subsystem S" | any claim about content, behavior, or the absence of defects |
| `examined` | current claims whose evidence cites this file | claims about symbols no evidence cites; absence of defects |
| `examined`, `reachability_checked: false` | a dated reading attributed to `ref_sha`, exactly as `examined-stale` | any current claim at the repository head; the examination revision was never resolved |
| `examined-stale` | a dated historical reading, attributed to `ref_sha` | any current claim at the repository head |
| `absent` | that the path was once surveyed | anything at the repository head |
| `mixed` | only what the **weakest** owner state authorizes | anything the weakest owner state cannot justify |

The projection and the tools must say "not examined", never "no findings", at `unledgered`,
`excluded`, and `scoped-unread`. The phrase "no open findings" is legal only when the state is
`examined` and the defects section was computed.

### 2.4 Accompanying fields (mandatory, in this order)

1. **`owners[]`** — one entry per `file_standing` row: `subsystem_id`, `subsystem_name`,
   `classification`, `standing_state`, `authority_ceiling`, `ref_sha`, `examined_at`,
   `stale`, `stale_reason`. **Every owner is listed.** There is no truncation of this array;
   it is excluded from the budget truncation order in §4. `file_ledger`'s primary key is
   `(subsystem_id, file_path)` (`schema.sql:176`), so the array is unbounded in principle — the
   AxiomDB store's `crates/axiomdb-server/src/main.rs` already carries ten owners. When the
   complete array alone would push the response past §4.1's hard ceiling, the tool returns a
   `ToolError` naming the path and the owner count rather than a truncated array: the caller can
   then read the owners from `list_scope(subsystem_id)`. A truncated `owners[]` is never
   returned, because §2.4.2's headline `state` is a function of the whole set and a partial set
   would make `mixed` undecidable.
2. **`state`** — the headline. It is the single shared owner state when all owners agree, the
   zero-owner state (`unledgered` / `absent`) when there are none, and the literal `"mixed"`
   otherwise. A response may never present one owner's state as the file's state.
3. **`authority_ceiling`** — `{ value, label, authorizes, deferred_owners[] }`. The ranked
   ladder is `unmapped < scoping < structural < concerns < adversarial < mapped`, exactly
   `STATUS_ORDER` in `mcp-server/src/invariants.ts:23-33`. `deferred` **is not on that axis**:
   the same file calls it "an orthogonal *do not survey* flag that blocks all gated writes",
   so no rank is defined for it and none is invented here. Therefore:

   - the ceiling `value` is the weakest ranked status among **non-deferred** owners;
   - every deferred owner is listed in `deferred_owners[]` with its recorded reason, and the
     ceiling text adds *"`<n>` owning subsystem(s) are deferred; nothing was surveyed there"*;
   - when **every** owner is deferred the ceiling `value` is the literal `"deferred"`, it
     authorizes nothing, and `cannot_justify` is *any claim about this file's content or
     behavior*.

   The ceiling carries the skill's caveat verbatim: `mapped` is a workflow completion mark and
   is not itself proof that every finding survived challenge.
4. **`revision`** — `{ checked_sha, checked_at, repository_head, origin_head, agrees }` where
   `checked_sha` is `git_state.last_checked_sha`, `repository_head` is the workspace HEAD, and
   `origin_head` is `git rev-parse <canonical_branch>@{upstream}` when an upstream is recorded,
   otherwise `null`. When `checked_sha != repository_head` the response carries
   `unchecked_since: "<checked_sha>"` and every account section is marked
   `as_of: "<checked_sha>"`.
5. **`measured`** — `{ ledger_rows, ledger_reconciled, reconciliation_receipt,
   staleness_measured, evidence_rows, claims_recorded }`. `ledger_reconciled` is non-null only
   at `owner_rows = 0` (§2.2). `staleness_measured` is `ledger_rows > 0`, matching
   `get_dashboard`'s existing rule (helpers.ts `OBLIGATION_BEARING_SQL`, dashboard.ts). A zero
   can never be read as health without its denominator (VP4).
6. **`unknown[]`** — mandatory, possibly empty, with exactly these sources and no others:

   | `kind` | Exact source |
   |---|---|
   | `concern-without-disposition` | for **each** owner subsystem `o`: `concerns.status='active'` and no `dispositions` row `(o, code)`. The unit is the **(owner, concern) pair**, not the concern; the entry carries `subsystem_id` |
   | `candidate-sibling` | `file_ledger` rows classified `candidate` in any owner subsystem (count plus up to 5 paths) |
   | `open-question` | `open_questions.resolution='open'` whose `subsystem_id` is an owner |
   | `open-lead` | `field_notes.follow_up='open'` whose `location` equals the path, begins `<path>:`, equals an owner id, or — splitting `location` on `,` and trimming — contains a token that is the path or a directory prefix of it |
   | `unassessed-seam` | for **each** seam in `seam_assessability` with an owner as `party_a` or `party_b`, and for **each side** that is an owner: `assessable=0`, or that side holds no `dispositions` row with `concern_code LIKE 'SC-%'`. The unit is the **(seam, side) pair** |

   Two of these predicates were global in the reviewed draft and reported zero on a store that
   holds real gaps. Read-only over the AxiomDB store: 1,094 (subsystem, active-concern) pairs
   have no disposition while **every** active concern code has a disposition *somewhere* (0 of
   36 codes are wholly undispositioned), and 9 of 20 seams lack an `SC-%` disposition on exactly
   one side while **0** lack it on both. A predicate quantified over "any owner" or "either
   party" is therefore a zero-denominator green in the VP4 sense: it cannot turn red on this
   store's actual gaps. The unit of both predicates is the pair.

   Two limits are stated in the response rather than hidden:

   - `open_questions` carries no locus column, so `open-question` entries are subsystem-scoped
     and each carries `scope: "subsystem"`.
   - `dispositions`' primary key is `(subsystem_id, concern_code)` (`schema.sql:220`) — **no
     seam id**. The only seam-bound concern record is `composition_seam_concerns`
     (`schema.sql:2205-2211`), which holds 0 rows on the AxiomDB store. The `SC-%` proxy
     therefore says *this party has assessed some seam concern*, never *this party has assessed
     this seam*. Every `unassessed-seam` entry carries
     `binding: "per-party-proxy; no seam-bound disposition is recorded"`, and the same sentence
     appears on §7.5's page and beside §7.6's column.
   - `field_notes.location` is free-form: 0 of 103 rows on the AxiomDB store equal a subsystem
     id, 6 carry a `:…@` citation, and values such as
     `crates/axiomdb-core/src/reason/, crates/axiomdb-core/src/write/` are comma-joined
     directories. Each `open-lead` entry carries
     `location_match: "exact" | "prefix" | "owner" | "none"` so a directory-prefix hit is never
     read as a file-level binding.

### 2.5 Standing for the other locus kinds

- **`subsystem`** — `state` is the subsystem's own ladder status (`unmapped … deferred`); no
  parallel enum is invented. Fields: examined / candidate / excluded / stale counts over the
  ledger; terminal dispositions over active concerns as `covered` / `applicable` with the
  five terminal classifications broken out; findings by resolution state; seam assessability
  per `seam_assessability.assessable`. `unknown[]` uses the same five sources.
- **`symbol`** — the file's standing block verbatim, plus `symbol_cited` (`true` when an
  `evidence` row has that `file_path` and an exactly equal `symbol`), the citing evidence ids
  and kinds, and when `symbol_cited` is false the literal
  `symbol_standing: "not-individually-cited"` with the sentence *the file's state does not
  extend to this symbol*. Exact match alone under-reports: 45 of 209 `evidence.symbol` values on
  the AxiomDB store carry a parenthetical qualifier
  (`GraphWriteCoordinator::execute_inner (SSI retry fence re-check)`), so the response also
  reports `symbol_prefix_matches[]` — evidence rows on the same `file_path` whose `symbol` equals
  the requested symbol followed by a space or `(` — under
  `match: "prefix"`, never merged into `symbol_cited`. The file's state is never silently
  inherited by the symbol.
- **`term`** — the `vocabulary` row (`gloss`, `expansion`, `subsystem_id`, `first_seen`,
  `ref_sha`) or `state: "not-defined"` with up to five nearest recorded terms, selected
  deterministically: case-insensitive prefix matches ordered lexicographically, then
  lexicographic order over the remainder. There is **no** same-subsystem tier: a term's
  subsystem is known only from its `vocabulary` row (`schema.sql:360-370`), which a
  `not-defined` term by definition does not have, and `describe_locus` takes no subsystem
  argument (§5.1), so that tier had no referent and could not be evaluated. No model call and no
  fuzzy scoring.

---

## 3. Account

The account follows standing in every response and on every page. It is assembled from durable
rows only.

### 3.1 Sections, sources, order

| # | Section | Source | Default |
|---|---|---|---|
| 1 | `purpose` | owning subsystems' `name`, `layer`, `jump_in_reading`; `scope` rendered separately and labelled **Scope** | on |
| 2 | `structure` | current `claims` whose `subject_id` is the locus or whose evidence cites it | on |
| 3 | `defects` | `finding_state_current` joined to `findings.primary_files` / `finding_evidence` | on |
| 4 | `reviews` | `dispositions` whose attached evidence cites the locus | off |
| 5 | `boundaries` | `seams` where an owner is a party; `xrefs` from or to an owner | on |
| 6 | `terms` | `vocabulary` scoped to an owner or whose `first_seen` cites the locus | on |
| 7 | `leads` | open `field_notes` and open `open_questions` per §2.4's rules | off |
| 8 | `history_pointer` | counts only: `finding_resolution_events`, `sessions` touching the locus | on |

`subsystems.scope` is **not** a purpose sentence and is never rendered as one. The column's own
comment calls it "free-text: key files, directories, symbols" (`schema.sql:630`), and the
AxiomDB values are file-and-boundary lists — `W-01`'s is
`crates/axiomdb-core/src/write/coordinator.rs (4008 lines); the GraphLockMap /
DomainRebuildLockMap types and …`. It renders under the heading **Scope** with its recorded text
verbatim. No durable purpose field exists; where a subsystem has none the section renders
*"No purpose statement is recorded for this subsystem; `scope` below states what it covers."*
Inventing one from `name` or from the path list would be BP6, classification-from-naming.

The order above is fixed. `defects` is partitioned `open`, `awaiting-verification`,
`verified-fixed`, `ruled-out`, `accepted`, in that order, and each partition is ordered by
severity then `finding_id`.

### 3.2 Per-item revision binding

Every item in every section carries `ref_sha` and, where the source row has one, `evidence_kind`.
An item with no `ref_sha` in its source row carries `ref_sha: null` and
`revision_bound: false`; it is never presented beside revision-bound items without that flag.

### 3.3 Current-only default; historical on request

Default is **current** in ADR-0001's sense: for `claims`, `valid_until_sha IS NULL`; for
findings, the current row of `finding_state_current`; for dispositions, the single stored row.

`as_of_sha` does **not** switch the whole response to a historical reading, because most account
sources cannot support one. `dispositions`, `seams`, `vocabulary`, `subsystems`, and
`file_ledger` are mutable rows with no validity interval and no event table: they hold one
current value and no record of any earlier one. A whole-account snapshot at an ancestor commit
would therefore be a reconstruction the store cannot source, which is exactly the failure
ADR-0001 § Current rules out. Instead:

| Section | `as_of_sha` support | Mechanism |
|---|---|---|
| `structure` (claims) | **yes** | `claims.valid_from_sha` / `valid_until_sha`, by ancestry |
| `defects` (findings) | **yes** | `finding_resolution_events` replayed to the last event at or before `as_of_sha` |
| `history_pointer` | **yes** | the two event tables, same cut |
| `purpose`, `reviews`, `boundaries`, `terms`, `leads` | **no** | no validity interval and no event table exists |

A response carrying `as_of_sha` marks each section `as_of_supported: true | false`. Unsupported
sections are served at their **current** value with `as_of_supported: false` and the sentence
*"This section has no recorded history; the values below are current, not as of `<sha>`."*
Serving them silently as if they were historical is the defect; omitting them would make the
response look emptier at an ancestor than it is. `current: false` appears only on the items the
store can actually place in time.

For the supported sections the candidate set is **every stored row**; ancestry alone decides
membership, exactly as the existing as-of path already works:
`get_claims` selects every `claims` row when `query_sha` is set
(`mcp-server/src/tools/claims.ts:484-486`) and filters in code with `claimAppliesAt`
(`claims.ts:156-159`), which tests `isAncestor(valid_from_sha, query)` and
`valid_until_sha IS NULL OR NOT isAncestor(valid_until_sha, query)`. There is **no SQL
pre-filter**: the reviewed draft's `WHERE valid_from_sha = :as_of OR valid_until_sha IS NOT NULL`
dropped every still-open claim opened at a strict ancestor of `as_of_sha`, which is the common
case and the one a historical read most needs. Membership is decided by commit ancestry in code,
never by SHA text or wall-clock order.

### 3.4 No model-generated text

No field of any response in §5 may contain text generated **during this tool call**. The tools
make zero model calls and report `model_calls: 0` in their trace, mirroring ADR-0011's
`registry-then-lexical-v1` trace contract. That is the whole of the guarantee, and the response
says so rather than implying more: durable rows written by an earlier survey session *are*
model-authored prose, and several of the fields served here are exactly that.

Every item therefore carries `authored: "model" | "code"`. The model-authored durable fields are
`subsystems.scope`, `subsystems.jump_in_reading`, `subsystems.notes`, `claims.statement`,
`findings.symptom`, `findings.root_cause`, `findings.business_context`,
`dispositions.rationale`, `finding_resolution_events.rationale`, `field_notes.observation`,
`open_questions.question` / `what_assumed` / `answer`, `vocabulary.gloss` / `expansion`,
`seams.*` prose, and the `narrative` artifact. Everything else — states, counts, ids, revisions,
classifications, timestamps — is `code`. A reader is entitled to know which sentences a model
wrote, even when no model ran to serve them. Narrative prose written by a survey (the
`subsystem-survey` artifact) may be attached to the `structure` section **only** under
`narrative: { artifact_path, content_hash, revision_bound: false, label:
"Narrative from the survey artifact; not individually bound to a revision" }` and only when the
claims list for that locus is empty.

---

## 4. Compactness

Decision 5 makes compactness a design constraint with a mechanical gate.

### 4.1 Budgets, in bytes of the serialized JSON payload

Budgets are enforced on **the bytes the host actually receives**, not on an internal
representation. `jsonResult` (`mcp-server/src/helpers.ts:43-56`) emits
`JSON.stringify(data, null, 2)` as the text block *and* repeats the same object in
`structuredContent`, so a budget measured on the compact payload under-counts the real cost by
the indentation overhead and then again by the whole duplicate. Decision 5 binds the emitted
size, so that is what is measured.

The three tools call `jsonResult(data, { compact: true })`, a new option that serializes the
text block with `JSON.stringify(data)` — no indentation. `structuredContent` is still populated,
because the MCP contract and existing hosts depend on it; it is counted, not dropped.

| Budget | Bytes | Enforced on |
|---|---|---|
| `describe_locus` default response | **8192** | `JSON.stringify(jsonResult(payload, { compact: true }))` — the whole wire response, text block plus `structuredContent` |
| standing block alone | **3072** | the compact payload's `standing` value |
| each optional section when requested | **4096** | the compact payload's section value |
| whole response with every section requested | **32768** | hard ceiling on the wire response; exceeding it is an error, not a truncation |
| `get_attention` default response | **12288** | wire response, as above |
| `get_history` default response | **8192** | wire response, as above |

`trace.response_bytes` reports the wire measurement and `trace.payload_bytes` the compact
payload, so the two are never confused. `owners[]`, every per-section `census`, and `omitted[]`'s
per-reason **counts** are never truncated. The per-kind sample lists inside `unknown[]` are
truncated before anything else.

### 4.2 Opt-in sections

On by default: `purpose`, `structure`, `defects`, `boundaries`, `terms`, plus standing and
`unknown`. Opt-in only: `reviews`, `leads`, `history_pointer` detail (its counts are always on),
and `narrative`.

### 4.3 Truncation is declared, never silent

Truncation follows ADR-0011's omission-ledger discipline. Every candidate item is either
selected or recorded in `omitted[]` with exactly one operational reason:

- `policy` — the section was not requested;
- `budget` — eligible but ranked below the byte or item budget.

Those are two of ADR-0011's three reasons (`dev/adr/0011-codebase-brief-contract.md:63-65`). The third, `irrelevant`
("zero lexical overlap with the task query"), does not apply: selection here is registry-exact,
not lexical, so no candidate is ever dropped for irrelevance. There is **no** `not-recorded`
reason. An empty source table produces no omission row at all, because an omission row must
carry the id of a census member and a table with no rows has no id to carry — the reviewed
draft's third reason could not satisfy its own invariant. An honest empty is a property of the
section, not an entry in the ledger:

```json
"sections": { "terms": { "census": 0, "recorded": false, "items": [] } }
```

with `recorded: false` rendered as *"No terms are recorded for this locus"* and never as
*"No terms"*.

`census` states the total candidate count per section. The invariant, checked by the tool before
returning and by the gate: for every section, `selected + omitted == census`, and every omitted
item id is distinct and present in the census. A response that cannot satisfy the invariant
fails rather than returning a smaller truthful-looking answer (GP24, GP25).

**The ledger is bounded independently of the census.** `get_attention`'s default census on the
AxiomDB store is 16 open findings, 31 open questions, and 103 open leads; an `omitted[]` of one
entry per dropped id would approach the 12288-byte budget on its own and force the tool to error
rather than answer. `omitted[]` is therefore **aggregated**, one entry per `(section, reason)`:

```json
{ "section": "leads", "reason": "budget", "count": 97,
  "ids": ["…"], "ids_truncated": true }
```

`count` is exact and never truncated — it is what the census invariant reconciles against. `ids`
carries as many as fit in a 1024-byte per-entry sub-budget and sets `ids_truncated` when it
cannot carry them all. A truncated id list is itself declared; a truncated count would be a lie.

Truncation order within a section is fixed and stated in the schema: drop the lowest-consequence
items first — for `defects`, the terminal states before the non-terminal; for `structure`, the
items with the weakest `evidence_kind`; for `terms` and `leads`, reverse creation order. The
order is a code constant, never a model choice.

### 4.4 The gate must be able to fail on a bloated response

`mcp-server/test-locus-compactness.mjs` seeds a store with a pathological locus — 40 findings,
120 evidence rows, 60 claims, 30 open leads on one path — and a second fixture whose
`get_attention` census exceeds 150 items across sections, and asserts:

1. `JSON.stringify(jsonResult(payload, { compact: true }))` — the whole wire response, not the
   compact payload alone — is ≤ 8192 bytes for `describe_locus` and ≤ 12288 for `get_attention`;
2. the same response serialized through the **default** `jsonResult` is measured and reported, so
   the indentation and `structuredContent` overhead the budget accounts for is visible in the
   test output rather than assumed;
3. `selected + omitted == census` for every section, reconciling against `omitted[].count`;
4. every `omitted` entry carries `policy` or `budget` and no other reason; a section with
   `census: 0` carries `recorded: false` and contributes **no** omission row;
5. on the 150-item fixture the aggregated ledger is under its sub-budget and `ids_truncated` is
   `true` with `count` still exact;
6. removing the truncation step makes assertion 1 fail (the red proof is committed as a
   deliberate over-budget fixture the test builds and measures, not as a disabled branch).

---

## 5. Tools

Three read tools are added, taking the surface from **196** to **199**. The reviewed draft said
195; `node mcp-server/scripts/gen-tool-inventory.mjs --check` on the branch baseline reports
"tool inventory block up to date (196 tools)", so the baseline is read from the generated
inventory, never restated from memory. Every expected count in §13 and in `plan.json` derives
from that command's output rather than from a literal in this document. Nothing else about the
surface changes (GP37: no new roles, no new ceremony).

### 5.1 `describe_locus`

```
describe_locus(locus: string,
               kind?: "file"|"symbol"|"subsystem"|"term",
               sections?: string[],
               as_of_sha?: string)
```

- **Input schema** — `additionalProperties: false`; `locus` required, non-empty;
  `sections` items constrained by `enum` to the eight section names of §3.1.
- **Output schema** — `mcp-server/contracts/locus-account.schema.json`, contract version
  `1.0.0`, shape: `{ contract_version, locus:{value,kind}, standing:{…§2.4},
  sections:{…}, census, omitted[], trace:{ model_calls, selection: "registry-exact-v1",
  budget_bytes, response_bytes }, current, as_of_sha }`.
- **Determinism** — zero model calls; every branch is SQL, a git ancestry check, or a code
  constant. The same store and the same workspace HEAD produce byte-identical output.
- **Annotations** — read-only. `index.ts`'s `toolAnnotations` derives `readOnlyHint` from the
  `get_`/`list_`/`lookup_` prefixes, which `describe_locus` does not match. Add an explicit
  `READ_ONLY_TOOLS` set to `index.ts` containing `describe_locus` and keep the prefix rule as
  a fallback, so the tool advertises `readOnlyHint: true`, `destructiveHint: false`,
  `idempotentHint: true`, `openWorldHint: false`.
- **Errors** — an unresolvable `as_of_sha` is a `ToolError`. An unknown locus is **not** an
  error: it returns `state: "unledgered"` or `state: "not-defined"` with an empty account.

### 5.2 `get_attention`

```
get_attention(scope?: string, sections?: string[], limit?: integer)
```

`scope` is a subsystem id or a path prefix, disambiguated by the §2.1 rule. Output schema
`mcp-server/contracts/attention.schema.json`, version `1.0.0`.

Decision 6: the item labels reuse ADR-0010's operational definitions **verbatim** where they
apply, with the same meanings:

| `get_attention` label | ADR-0010 definition, unchanged |
|---|---|
| `regression` | currently open finding with a prior `verified-fixed` event |
| `unverified-suspicion` | open `candidate-concern` field note |
| `unknown` | open question |
| `stale-knowledge` | a claim validity interval closed at or before the reviewed HEAD — **extended** to include obligation-bearing `file_ledger` rows with `stale=1`, which is the same epistemic state expressed over the ledger rather than over claims; the item carries `source: "claim"` or `source: "ledger"` so the two are never pooled (VP6) |

Three of ADR-0010's labels are **not** reused, each for a stated reason:

- `ruled-out-historical` — it is History, not Unresolved.
- `survived / contested / defeated challenge` — the terminal mechanical A7 aggregation for a
  hypothesis referenced by a composition; `get_attention` has no composition.
- `latent-defect` — ADR-0010 defines it as an open finding "whose evidence ref is at or before
  **the impact base**", and `compile_review_session` computes it exactly that way,
  `isAncestor(ctx, finding.ref_sha, impact.base_sha)`
  (`mcp-server/src/tools/review-session.ts:222-227`). `get_attention` has no A8 composition and
  therefore no impact base. Substituting a different base — `git_state.last_checked_sha`, say —
  under the same word would be the very overloading decision 6 exists to prevent, so the label
  is dropped rather than redefined. Findings that would have carried it are `open`, ordered by
  severity like the rest.

`get_attention` adds exactly two labels of its own, both with the same shape of definition:

| Label | Definition |
|---|---|
| `awaiting-verification` | current resolution state `fixed-pending-verification` |
| `undiscriminated` | an unresolved `contradictions` row, a `diagnosticity_sessions` row whose `outcome` is `open` **or** `unresolved-competition`, or a `dispositions` row classified `unresolved-competition` |

The reviewed draft called the second one `contested`. Both reviewers overturned that
independently and both were right: ADR-0010 already defines *contested* — "survived, contested,
or defeated challenge", the terminal A7 aggregation on a hypothesis
(`dev/adr/0010-derived-review-surface-and-semantic-readback.md:42-43`) — so the draft assigned an
existing operational label a second, different meaning while its own §13 gate turns red when "a
`get_attention` label's meaning differs from ADR-0010's". `undiscriminated` states the property
the three sources share: two or more credible accounts stand and the record does not say which
of them the evidence picks out. It collides with no ADR-0010 label and with no schema value.
A future review brief can cite `get_attention` output without carrying a second vocabulary.

Sections: `open`, `awaiting_verification`, `undiscriminated`, `decisions`, `leads`, `stale`,
`hot_spots`. Default: all, each bounded by §4.

### 5.3 `get_history`

```
get_history(locus?: string, finding_id?: string, limit?: integer)
```

Exactly one of `locus` or `finding_id` is required. Output schema
`mcp-server/contracts/locus-history.schema.json`, version `1.0.0`: resolution events
(`finding_resolution_events`, ordered by `id`), claim supersessions and validity events,
contradiction resolution events, answered or dismissed questions, resolved field notes, and the
`sessions` that touched the locus, each with `intent`, `started_at`, `ended_at`, `outcome`.
Newest first, one page, `omitted[]` per §4.3.

### 5.4 Server instructions

`SERVER_INSTRUCTIONS` in `mcp-server/src/index.ts` opens with the consumer route and keeps the
producer route after it:

> To learn what is recorded about a file, symbol, subsystem, or term, call `describe_locus`
> first. Its standing states what the record authorizes and what it cannot justify; do not
> claim beyond it, and when standing is `unledgered` or `scoped-unread` say so rather than
> reading the file and improvising. `get_attention` returns what is unresolved; `get_history`
> returns what was concluded. To build or maintain a conspectus, start with `get_project_info`,
> then `get_dashboard` and `list_subsystems`; read source code for evidence and write survey
> state only through Amanuensis tools. Bind claims to repository revisions, keep observations
> separate from inference and open questions, and do not claim beyond a subsystem's recorded
> status. Use the Amanuensis skill when installed for the full survey, review, design, and
> refresh workflows.

### 5.5 Tool inventory placement

The three tools live in one new module, `mcp-server/src/tools/locus.ts`, exported as
`locusTools` and registered in `index.ts` **first** in `allTools` so they head the advertised
list. `scripts/gen-tool-inventory.mjs` groups by source file, so they appear as a `locus` group
in `DEVELOPMENT.md`; the block is regenerated and `node scripts/gen-tool-inventory.mjs --check`
must pass.

---

## 6. Lens membership

Membership is SQL. One new view removes the duplicated resolution fallback, and **every existing
reader is migrated onto it** — the duplication is the defect, so leaving copies behind would
leave the defect:

| Reader | State today |
|---|---|
| `materializer/amanuensis_materializer/renderers.py:446-451` (`render_findings`) | full inline fallback CASE |
| `mcp-server/src/tools/findings.ts:402-406` (`list_findings`) | the same inline fallback CASE, independently maintained |
| `mcp-server/src/tools/findings.ts:440-443` (`get_finding_summary`) | a **partial** fallback — it maps only `status='fixed'`, so `ruled-out` and `confirmed-acceptable` rows fall through differently from the other two readers |
| `mcp-server/src/tools/review-session.ts:190-197` (`compile_review_session`) | reads `finding_resolution_current` with **no** fallback, so a legacy row with no event disagrees with the renderer |
| `mcp-server/src/tools/review.ts:398-400` (historical findings) | reads `finding_resolution_current` with **no** fallback, same disagreement |

All five select from `finding_state_current` after this change. The last two carry no inline
fallback to delete; their defect is the opposite one — they under-report legacy rows the
renderer reports — and the view fixes both directions at once.

```sql
CREATE VIEW IF NOT EXISTS finding_state_current AS
SELECT f.finding_id, f.subsystem_id, f.severity, f.status AS legacy_status,
       COALESCE(r.resolution_state,
                CASE f.status WHEN 'fixed'                THEN 'fixed-pending-verification'
                              WHEN 'ruled-out'            THEN 'ruled-out'
                              WHEN 'confirmed-acceptable' THEN 'accepted'
                              ELSE 'open' END)            AS resolution_state,
       r.fix_sha, r.fix_location, r.evidence_id AS resolution_evidence_id,
       r.recorded_at AS resolution_recorded_at
  FROM findings f
  LEFT JOIN finding_resolution_current r ON r.finding_id = f.finding_id;
```

### 6.1 Predicates, ordering, honest empty state

**Codebase.**
```sql
SELECT id, name, layer, scope FROM subsystems
 ORDER BY COALESCE(layer,'~'), id;                                       -- structure (scope is Scope, not Purpose)
SELECT * FROM claims WHERE valid_until_sha IS NULL;                      -- structure
SELECT * FROM seam_assessability;                                        -- boundaries
SELECT * FROM xrefs;                                                     -- edges
SELECT * FROM vocabulary ORDER BY term;                                  -- terms
SELECT * FROM file_standing ORDER BY file_path, subsystem_id;            -- standing per file
```
Ordering: layer → subsystem id → file path → symbol. Empty state: the Not-yet-surveyed page is
always present and always lists what is not known — unledgered paths, candidate rows, deferred
subsystems, unassessed seams, undispositioned concerns — with the scope, the basis, and the
checked revision. Territory is never omitted to make the map look complete.

**Unresolved.**
```sql
-- open findings and repairs awaiting verification
SELECT * FROM finding_state_current
 WHERE resolution_state IN ('open','fixed-pending-verification');
-- undiscriminated
SELECT id FROM contradictions WHERE resolution='unresolved' OR resolution IS NULL;
SELECT id FROM diagnosticity_sessions
 WHERE COALESCE(outcome,'open') IN ('open','unresolved-competition');
SELECT subsystem_id, concern_code FROM dispositions
 WHERE classification='unresolved-competition';
-- decisions and leads
SELECT id FROM open_questions WHERE resolution='open';
SELECT id FROM field_notes   WHERE follow_up='open';
-- stale knowledge: examined readings the repository has moved under
SELECT subsystem_id, file_path FROM file_ledger
 WHERE stale=1 AND classification='examined';
-- drifted unread scope: reported separately, never as stale knowledge
SELECT subsystem_id, file_path FROM file_ledger
 WHERE stale=1 AND COALESCE(classification,'candidate')='candidate';
```
`diagnosticity_sessions.outcome` admits `unresolved-competition` (`schema.sql:4478-4479`). The
reviewed draft's `COALESCE(outcome,'open')='open'` selected it into neither lens — History
selects nothing from that table — so a matrix that ended in acknowledged, unresolved competition
would have vanished from the projection entirely. ADR-0001 § Fully surveyed calls that state
"visible debt, not hidden success"; it is Unresolved.

The stale-knowledge predicate is narrowed from obligation-bearing to `classification='examined'`
for the same reason in reverse. `detect_changes` checks every ledger row that carries a `ref_sha`
(`mcp-server/src/tools/git.ts:236-242`, `246-262`) and marks drifted ones `git-drift` regardless
of classification, and **all 111** `candidate` rows on the AxiomDB store carry a 40-character
`ref_sha`. Under the draft's predicate an unread file would have appeared on a page whose own
hint reads *"Examined files the repository has changed under"* — a false statement about the
strongest thing the record could be read to claim. Drifted candidates are real and are reported,
under their own heading *"Scoped but unread, and changed since scoping"*, with their own
denominator.

Ordering: open findings by severity (`CRITICAL, HIGH, MEDIUM, LOW`) then subsystem then id;
then awaiting verification by severity; then undiscriminated; then decisions by category then
id; then leads with `candidate-concern` first; then stale rows by subsystem then path; then
drifted candidates by subsystem then path.
Empty state: *"No open findings at `<checked_sha>` over `<n>` examined files in `<m>`
subsystems; `<k>` files are scoped but not yet read."* Scope, basis, and checked revision are
always present; an empty page never renders as a bare "none".

**History.**
```sql
SELECT * FROM finding_state_current
 WHERE resolution_state IN ('verified-fixed','ruled-out','accepted');
SELECT * FROM finding_resolution_events        ORDER BY id DESC;
SELECT * FROM contradiction_resolution_events  ORDER BY id DESC;
SELECT * FROM contradictions WHERE resolution IS NOT NULL AND resolution<>'unresolved';
SELECT * FROM open_questions WHERE resolution IN ('answered','dismissed','superseded')
 ORDER BY resolved_at DESC, id DESC;   -- resolved-leads.md
SELECT * FROM field_notes    WHERE follow_up <> 'open'
 ORDER BY id DESC;                     -- resolved-leads.md; no resolution time is recorded
SELECT * FROM sessions       ORDER BY started_at DESC;
SELECT * FROM refresh_runs   ORDER BY id DESC;
SELECT * FROM projection_verification_runs ORDER BY id DESC;
```
Ordering: newest first by the event id or timestamp of the record family; filterable by
subsystem and locus. Empty state: *"No resolutions recorded at `<checked_sha>`."*

**Method.** Fixed membership: reader's guide, review coverage, review checklist, competing
explanations, onboarding record, where to begin. No empty state is needed; these pages exist
whenever the conspectus does.

### 6.2 Exactly once, with the marker

The read-back state axis (ADR-0005) requires exactly one opaque marker per finding across the
Markdown corpus and exactly one across the HTML corpus. Therefore:

- a finding renders as a **full record with its `finding_marker`** on exactly one page — the
  page selected by its `finding_state_current.resolution_state`: `findings.md` for `open` and
  `fixed-pending-verification`, `resolved-findings.md` for `verified-fixed`, `ruled-out`, and
  `accepted`;
- every other lens, the subsystem pages, and the Files index **link** to that anchor and must
  not emit the marker;
- `_build_xref_index` (`materializer/amanuensis_materializer/core.py:455-462`) currently routes
  **every** finding id to `findings.md#<id>`. It is changed to route by
  `finding_state_current.resolution_state`, to the same page §6.2 selects. Without that change
  every `[[B01-1]]` reference and every recorded link to a now-resolved finding resolves to an
  anchor that no longer exists, and the coverage axis reports `cross-link-anchor`
  (`materializer/amanuensis_materializer/readback.py:255-272`) — the partition would break the
  read-back it is meant to keep green;
- the subsystem page's "Known defects here" section lists open defects as links plus a
  collapsed count of resolved ones, never as full marked records.

The same rule governs the new ledger staleness marker (§11.3): exactly one full record per
stale ledger row, on `stale.md`.

---

## 7. Human projection

Markdown and HTML remain synchronized companions generated from the same post-xref bytes. Every
read-back axis stays green, and §11.3 adds one axis obligation rather than relaxing any.

### 7.1 Page plan

`PagePlan` and `SitePage` gain one field, `subgroup: str = ""`. Navigation group order becomes
an explicit constant `NAV_GROUPS = ("Overview", "Codebase", "Unresolved", "History", "Method")`
in `html_projection.py`; `_nav` renders groups in that order, items without a subgroup first,
then each subgroup under an `<h3>`. A page whose `group` is not in `NAV_GROUPS` is a render
error, not a silently appended group.

| path | title | label | hint (first clause) | group | subgroup | kind | change |
|---|---|---|---|---|---|---|---|
| `index.md` | Project overview | Overview | Identity, four status dimensions, and one route into each lens | Overview | — | `overview` | rewritten (§7.2) |
| `architecture.md` | Architecture at a glance | Architecture | Runtime shape, recorded edges, and boundaries | Codebase | — | `architecture` | edges from `xrefs` only; atlas when none (§9.2) |
| `master-plan.md` | Subsystem map | Subsystems | Every region, grouped by layer, with its purpose sentence | Codebase | — | `registry` | grouped by layer; survey depth subordinate |
| `files.md` | Files | Files | One row per ledger file with owners, standing, and open defects | Codebase | — | `files` | **new** |
| `not-yet-surveyed.md` | Not yet surveyed | Not yet surveyed | The recorded edge of the map | Codebase | — | `gaps` | **new** |
| `seams.md` | System boundaries | System boundaries | Shared objects and ordering assumptions | Codebase | — | `seams` | group changed from Evidence |
| `vocabulary.md` | Codebase glossary | Codebase glossary | The project's own names | Codebase | — | `glossary` | group changed |
| `subsystems/<id>-<slug>.md` | `<name>` | `<name>` | Purpose, structure, boundaries, defects, and survey record | Codebase | Subsystems | `subsystem` | reordered (§7.3) |
| `findings.md` | Open findings | Open findings | Defects open or awaiting verification at the checked revision | Unresolved | — | `findings` | membership narrowed (§6.1) |
| `disagreements.md` | Records that disagree | Disagreements | Where credible records disagree or the evidence does not discriminate | Unresolved | — | `undiscriminated` | **new**; carries `unresolved-competition` matrices too |
| `open-questions.md` | Decisions needed | Decisions needed | Questions the survey could not settle, with the assumption used | Unresolved | — | `questions` | consequence-first ordering |
| `field-notes.md` | Leads | Leads | Open observations that are not yet findings | Unresolved | — | `notes` | open only; resolved move to History |
| `stale.md` | Stale knowledge | Stale knowledge | Examined files the repository has changed under, and scoped files that changed before anyone read them | Unresolved | — | `stale` | **new**; carries the ledger markers; two sections with separate denominators (§6.1) |
| `hot-spots.md` | Hot spots | Hot spots | Where unresolved work and unread territory concentrate | Unresolved | — | `hotspots` | **new** |
| `resolved-findings.md` | Resolved findings | Resolved findings | Verified, ruled out, and accepted, each with the basis its resolution rests on | History | — | `findings` | **new** |
| `resolution-history.md` | Resolution history | Resolution history | The append-only account of how records reached their state | History | — | `timeline` | **new** |
| `resolved-leads.md` | Resolved leads and questions | Resolved leads and questions | Questions that were answered or dismissed, and leads that were closed | History | — | `resolved-leads` | **new**; states that for these two families only the terminal state is recorded (§1.1) |
| `sessions.md` | Sessions and publications | Sessions and publications | What ran, when, and what it produced | History | — | `sessions` | **new** |
| `contradictions.md` | Conflicting evidence | Conflicting evidence | Resolved disagreements and the evidence that settled them | History | — | `contradictions` | re-homed; unresolved rows move to `disagreements.md` |
| `how-to-read.md` | How to read the conspectus | Reader's guide | Every enum, what it authorizes, and what it cannot justify | Method | — | `guide` | generated from the enum source (§10) |
| `concerns.md` | Review coverage | Review coverage | Which failure modes were tested where | Method | — | `coverage` | group changed |
| `concern-checklist.md` | Calibrated review checklist | Review checklist | The concern set and its provenance | Method | — | `artifact` | group changed |
| `diagnosticity.md` | Competing explanations | Competing explanations | Index of evidence matrices and their outcomes | Method | — | `diagnosticity` | group changed; open and `unresolved-competition` matrices also listed on `disagreements.md` as links |
| `matrices/<id>.md` | `<symptom>` | `<symptom>` | One matrix | Method | Evidence matrices | `matrix` | group changed |
| `onboarding-report.md` | Onboarding record | Onboarding record | The repository boundary and initial decomposition | Method | — | `artifact` | group changed |
| `entry-point.md` | Where to begin | Where to begin | A dated reading path recorded by an earlier session | Method | — | `artifact` | group changed; page states its own date and that it is survey history |

**No page is retired.** Every existing path survives with a new home or a narrower membership,
so authored prose links and the coverage read-back axis cannot break on this change.

### 7.2 Overview, source order

In this order, first in the document's source, with nothing else between them. The contract is
over **source order**, not over what a particular reader sees without scrolling: "first viewport"
is a function of viewport size, zoom, font metrics, and translated or enlarged text, none of
which the projection controls and none of which a gate can evaluate. `test-lens-pages.py`
asserts the source order and that no other block precedes item 5; the HTML is additionally
rendered at 360, 768, and 1280 CSS pixels to confirm nothing in the shell is inserted above
item 1 at any of them. A literal viewport guarantee is not made, because it could not be kept.

1. **Identity** — the project name as primary identity; Amanuensis named only as the producing
   method (`reporting-style.md`).
2. **Thesis** — the body of the `entry-point.md` section whose heading matches
   `^#{1,6}\s*what is this (codebase|project)\??\s*$` case-insensitively. If no such section
   exists, the page states *"No thesis section is recorded; add a 'What is this codebase?'
   section to `entry-point.md`."* It never falls back to the first paragraph. The thesis is
   subject to the §11.1 lint.
3. **Four status dimensions**, each a separate named fact from durable records, never merged
   and never scored:
   - *Source alignment* — `git_state.last_checked_sha` against the workspace head and, when
     recorded, the origin head; plus obligation-bearing stale ledger rows with the denominator.
   - *Survey coverage* — subsystems by ladder status; obligation-bearing ledger rows examined
     versus candidate; unledgered paths from `scope_gaps`.
   - *Open engineering work* — open findings, repairs awaiting verification, unresolved
     contradictions, open decisions.
   - *Publication integrity* — the latest `projection_verification_runs` row: the three axes
     and when they last ran.
4. **Counts by resolution state** — one linked count per value of the
   `finding_resolution_state` enum, generated by iterating the enum source of §10 so the line
   cannot drift from the enum. Each count links to the page where that state's records render
   in full.
5. **One route into each lens.**

No composite score, no health index, no progress bar, no tile grid (BP26,
`reporting-style.md`). The freshness strip is ledger-derived (§11.2).

### 7.3 Subsystem page order

1. Identity (`name`, `layer`) and **Scope** — `subsystems.scope` verbatim under that heading,
   never relabelled Purpose (§3.1). When no purpose statement is recorded the page says so.
2. Start here (`jump_in_reading`)
3. Structure — current claims grouped by claim kind; when none, the labelled narrative fallback
   with the heading *"Structural inventory not recorded as claims"* and the artifact's
   `content_hash` and `ref_sha`
4. Boundaries — seams and recorded edges
5. Vocabulary
6. Known defects here — open and awaiting-verification as links, then a collapsed count of
   resolved ones with a link to `resolved-findings.md`
7. Standing — the subsystem standing block of §2.5
8. Survey record — file ledger, concern review, adversarial notes, then the survey artifact —
   as secondary apparatus, in that order

### 7.4 Files index

One row per distinct `file_ledger.file_path`. Columns: path (with a stable `id` anchor), owners
(every one, each linked to its subsystem page anchor), standing state, examined revision per
owner, open-defect count. Sorted by path.

**The anchor is collision-resistant and is not `slugify`.**
`materializer/amanuensis_materializer/slugs.py:20-23` collapses every run of non-`[a-z0-9-]`
characters to a single `-`, so `src/a/b.ts`, `src/a-b.ts`, and `src/a.b.ts` all slugify to
`src-a-b-ts`. The file anchor is `f-<first 10 hex of sha1(file_path)>` with the slug carried as
visible link text; `test-search-index.py` seeds three colliding paths and requires three distinct
anchors, each reachable with JavaScript disabled.

The **examined revision is per owner, not per file.** `file_ledger.ref_sha` lives on the
`(subsystem_id, file_path)` row, so two owners can record different examination revisions for one
path; the AxiomDB store holds 53 multi-owner paths, one with ten owners. The column renders one
short revision per owner beside that owner's name, and renders a single value only when every
owner agrees. A singular revision on a multi-owner row would assert an agreement the ledger does
not record. Every row's path anchor is
the ⌘K landing target; the anchor lives on this page and links onward to the owning subsystem
page's ledger entry, so no per-file page is created (decision 3).

### 7.5 Not yet surveyed

Five sections, each with its denominator and each counted over the **unit its gap actually
occupies** (§2.4.6):

1. unledgered paths (`scope_gaps.kind='unledgered'`), over tracked paths;
2. candidate rows grouped by subsystem, over obligation-bearing ledger rows;
3. deferred subsystems with their recorded reason, over subsystems;
4. unassessed **seam sides** — `assessable=0`, or a party holding no `SC-%` disposition —
   counted as `(seam, side)` pairs over `2 × seams`, carrying §2.4.6's
   `binding: per-party-proxy` sentence;
5. **(subsystem, active concern) pairs** with no disposition, over `subsystems × active
   concerns`.

Sections 4 and 5 were "no `SC-%` disposition" and "active concerns with no disposition anywhere"
in the reviewed draft. Both report **zero** on the AxiomDB store — every active concern code has
a disposition somewhere, and no seam lacks `SC-%` on both sides — while the store holds 1,094
undispositioned pairs and 9 one-sided seams. A section that cannot turn red on the only store it
has been run against is a zero-denominator green (VP4), and this page exists precisely to show
what is not known.

### 7.6 Hot spots

One row per subsystem. Columns, each a separate measure:

1. Subsystem (linked name, id as a defined identifier)
2. Open critical + high
3. Open medium + low
4. Awaiting verification
5. Undiscriminated (unresolved contradictions + `open` and `unresolved-competition` matrices + `unresolved-competition` dispositions)
6. Weakest evidence quality among `confirmed-bug` dispositions, or `—`
7. Unread fraction — candidate ÷ obligation-bearing ledger rows, printed as `n/m`
8. Stale files
9. Unassessed seam sides, as `n/m` over `2 × seams` this subsystem is party to, with §2.4.6's `binding: per-party-proxy` sentence in the column note
10. Access heat — **the column is omitted entirely** when `access_log` has no row for any
    subsystem, rather than printing a column of zeros (VP4)

Sort: column 2 descending, then 3, then 7 as a fraction, then subsystem id ascending. There is
no composite column and no total row.

### 7.7 History pages

`resolved-findings.md` renders each resolved finding as a full marked record: id, severity,
symptom, root cause, resolution state, fix revision and location, and its **basis**, which is
labelled by kind because the schema requires different things of different states.
`schema.sql:813` requires `evidence_id` only for `verified-fixed`; `accepted` and
`ruled-out` need `rationale` alone, and `mcp-server/src/tools/findings.ts` accepts them that way.
ADR-0001 § Resolved licenses this — "resolution evidence **or an explicit authorized
dismissal**" — so the page does not claim evidence it does not have:

| Resolution state | `basis.kind` | Rendered |
|---|---|---|
| `verified-fixed` | `evidence` | the verification `evidence` row, linked, with its kind and revision |
| `ruled-out` | `authorized-dismissal` | the overturning argument (`rationale`) with the recording session and revision |
| `accepted` | `authorized-dismissal` | the acceptance rationale, likewise |
| any of the three with neither | `none-recorded` | *"No basis is recorded for this resolution."* and the row is listed again at the top of the page under **Terminal without a recorded basis**, with its count |

`materializer/test-history-and-contested.py` seeds one `accepted` finding with an empty rationale
and requires the `none-recorded` rendering and the count; a page that silently renders such a row
as resolved-with-proof is red. The §7.1 hint says "the basis its resolution rests on", not "the
proof", because for two of the three states it is not proof.

`resolution-history.md` is a newest-first event timeline over `finding_resolution_events` and
`contradiction_resolution_events` with the finding or contradiction linked.
`resolved-leads.md` lists answered, dismissed, and superseded `open_questions` newest-first by
`resolved_at`, then closed `field_notes` by `id` descending, each group carrying §1.1's
one-line statement of what the store does and does not record about how they got there.
`sessions.md` lists sessions (intent, start, end, outcome), refresh runs, and projection
verification runs with their three axes.

### 7.8 Method pages

`how-to-read.md` is generated from the enum source of §10: one table per enum, each row carrying
the value, the human label, the operational meaning, and what it cannot justify. Its "what to
look at first" table is generated from the page plan, so a new page cannot be missing from it.
The remaining Method pages are unchanged in content.

### 7.9 Markdown and HTML stay synchronized

No rule above is expressed in HTML only. Every new page has a Markdown renderer in
`renderers.py` and is rendered to HTML by the existing pipeline; the search index of §8 is the
only projection artifact with no Markdown companion, and it is covered by §8's read-back rule.

---

## 8. Interface enhancement

Decision 3: no per-file pages; a better visual design and simple JavaScript enhancement are
welcome, tastefully, with accessibility required.

### 8.1 What new JavaScript may do

This section governs **behaviour added by this change**. The existing projection shell already
ships inline JavaScript that toggles the light/dark theme (persisting one key in `localStorage`,
mirroring it across tabs through a `storage` listener) and opens and closes the mobile navigation
with deterministic focus restoration — `materializer/amanuensis_materializer/html_projection.py`,
the `_JS` block at line 877, `setMenuOpen` at line 916. Those functions are preserved unchanged
and are **not** in scope for the restriction below; a rule that forbade them would describe a
projection that does not exist and has never been the one under review.

1. **Extend ⌘K to file paths and cited symbols.** The materializer writes one projection
   artifact, `search-index.js`, that assigns
   `window.__amanuensisLocusIndex = { paths: [...], symbols: [...] }`. Each path entry is
   `{ p: path, o: [subsystem ids], s: standing state, h: "files.html#<slug>" }`; each symbol
   entry is `{ y: symbol, p: path, h: <anchor> }`. It is referenced with a relative
   `<script src>` so it loads from `file://`, and it is the only script file besides the inline
   `_JS`.
2. **In-page filters** on `findings.md`'s open list and on `hot-spots.md`: filter by subsystem
   and by severity, applied by toggling `hidden` on rows or articles.
3. **Anchored navigation**: every record carries a stable `id`; clicking a result moves focus to
   the target and updates the fragment.

Nothing else is added. No client-side data fetching, no analytics, no persisted view state
beyond the existing theme key, no dashboard tiles, no animation. Filter state is not persisted at
all: it lives in the DOM for the life of the page.

### 8.2 What it must satisfy

- **Progressive enhancement.** With JavaScript disabled, every route is reachable: the Files
  page lists every path with its anchor, the nav lists every page, the filters are absent and
  all rows are visible. Nothing is `hidden` in the served HTML that JavaScript must reveal.
- **Keyboard.** ⌘K focuses the search input; `ArrowDown`/`ArrowUp` move through results;
  `Enter` activates; `Escape` closes and restores focus to the previously focused element.
  Filters are native `<input type="checkbox">` and `<select>` inside a labelled `<fieldset>`.
- **Accessible names and states.** The search input is `role="combobox"` with
  `aria-expanded`, `aria-controls`, and `aria-activedescendant`; results are a `role="listbox"`
  of `role="option"` elements with `aria-selected`. A `aria-live="polite"` region announces the
  result count and, for filters, "`n` of `m` rows shown".
- **Focus management.** Focus is never trapped; opening and closing the result list and the
  mobile nav both restore focus deterministically, as the existing `setMenuOpen` already does.
- **No external resources.** No CDN, no font fetch, no network request of any kind. The CSS and
  the behavioral JavaScript stay inline; `search-index.js` is same-directory data.
- **Read-back coverage of the generated index.** `search-index.js` is listed in
  `manifest.projection_files` and in `.projection-contract.json`'s `pages` array with its
  content hash, so the **content** axis covers it
  (`materializer/amanuensis_materializer/readback.py:276-290` hashes whatever the receipt
  names). The **coverage** axis needs two changes first, or adding the file turns it red for the
  wrong reason:

  1. `ProjectionVerifier` inventories only `*.md` and `*.html` (`readback.py:147-152`), so a
     `search-index.js` in `expected_paths` (`core.py:285`) is reported as *"planned page is
     missing"* (`readback.py:199-207`) even when it is present. The inventory glob gains `*.js`.
  2. `verify_projection` (`core.py:313-327`) derives `expected_paths` from the page plan alone,
     so it would never expect the file at all. It derives them from
     `manifest.projection_files` as well, which is where the materializer records it.

  The **state** axis then gains one check: every obligation-bearing `file_ledger.file_path`
  appears exactly once in `paths`, and every `evidence` row with a non-null `symbol` appears at
  least once in `symbols`. A missing or duplicated entry turns the state axis red.

### 8.3 Register

Quiet. Ruled registers, not cards. The result list is a plain list with the path, its owners,
and its standing label; no icons, no scores, no counts badged onto the nav.

---

## 9. Survey changes

### 9.1 Phase 2 writes structural claims

`references/phase-2-structural.md` gains a step between the current steps 5 and 6. For every
structural fact it records in prose, Phase 2 also records a claim through `add_claim`:

| Claim kind | `claim_key` | `subject_type` / `subject_id` | `epistemic_kind` | Required evidence |
|---|---|---|---|---|
| key type | `<sid>/key-type/<symbol-slug>` | `symbol` / `<path>:<symbol>` | `observation` | ≥1 `evidence` row, kind ∈ {`code-verified`, `contract-stated`} citing that `file_path` and `symbol` |
| state container | `<sid>/state-container/<symbol-slug>` | `symbol` / `<path>:<symbol>` | `observation` | as above |
| flow step | `<sid>/flow/<flow-slug>/<nn>` | `symbol` / `<path>:<symbol>` | `observation` | as above |
| concurrency invariant | `<sid>/concurrency` | `subsystem` / `<sid>` | `observation` or `inference` | ≥1 `evidence` row; `inference` when the invariant is derived rather than read |
| seam contract | `<sid>/seam/<seam-id>` | `seam` / `<seam-id>` | `observation` | ≥1 `evidence` row citing the writing or reading site |

`claim_key` must be stable across re-surveys so a later reading supersedes rather than
duplicates. `add_claim` already requires at least one evidence id (`claims.ts:239`,
`minItems: 1`) and already refuses evidence unreachable at the asserting commit
(`claims.ts:98-115`).

It does **not** check anything else, and the table above is otherwise prose. `add_claim`'s input
schema declares `subject_type: { type: "string" }` with no enum (`claims.ts:233`), and
`claims.subject_type` carries no CHECK beyond `length > 0` (`schema.sql:943`, `957`);
`requireEvidence` resolves and ancestry-checks each row but never reads `evidence.kind`. So the
"required evidence" column could be satisfied by a `name-inferred` row on an unrelated file, and
nothing would say so. Two **subtractive** checks are added to `add_claim` itself — code rejecting
a value, not a prompt asking for one (GP8, whose v2 scope note licenses exactly this shape):

1. `subject_type` is validated against the enum `{symbol, subsystem, seam}` from §10.1's
   source, by `requireEnum`.
2. A claim whose `claim_key` matches `^<sid>/(key-type|state-container|flow)/` is refused unless
   at least one of its `evidence_ids` has `kind ∈ {code-verified, contract-stated}` **and** an
   `evidence.file_path` equal to the path in `subject_id`. The error names the kinds it found.

Concurrency and seam claims keep the weaker requirement the table states: they are frequently
derived rather than read, and forcing a kind they cannot honestly carry is the fabrication hazard
BP4 names. `claims` and `claim_evidence` both hold **0 rows** on the AxiomDB store, so neither
check can be validated against real data yet; `test-structural-claims.mjs` seeds both the
accepted and the refused case.

**Phase prerequisite.** `enforcePhasePrerequisites` gains one condition: advancing a subsystem
to `structural` requires at least one current claim whose `claim_key` begins `<sid>/`. A
subsystem with genuinely no mutable state container records that as a claim with an explicit
negative statement rather than omitting the category; no count of claims is required beyond
one, because forcing a generative field to a shape invites fabrication to order (BP4, and GP8's
v2 scope note). Claim **truth** remains the adversarial pass's obligation — and that pass must actually be given
the claims. `references/phase-4-adversarial.md` § Process step 1 pulls confirmed bugs, linchpin
dispositions, and call-path-only `confirmed-acceptable` dispositions; it does not read `claims`
at all. It gains one target line, *"every current claim whose `claim_key` begins `<sid>/`, via
`get_claims(subsystem_id)`"*, and one recording line: the challenge outcome for each is written
as a `claim_validity_event` or an explicit "survived" note before the subsystem may advance to
`mapped`. Without that, this prerequisite would establish only that claims exist and would name
a reviewer that never sees them. The gate here establishes that the structural account exists in
a revision-bound, evidence-backed form; §9.5 establishes that it was challenged.

**Renderer contract.** The subsystem page and `describe_locus`'s `structure` section read
claims. With zero claims for a subsystem, both render the literal
*"Structural inventory not recorded as claims"* and then, on the page only, the survey
artifact's narrative under §3.4's `narrative` labelling. An empty section is never rendered as
if the subsystem had no structure.

### 9.2 The xref and edge contract

Phase 2 records one `add_xref` row for every data flow or dependency that crosses a subsystem
boundary. `add_xref` gains a required `context` carrying at least one citation. The validation is
**token-level**, because `requireWorkspaceCitation` cannot validate a citation embedded in prose:

`mcp-server/src/helpers.ts:99-125` takes `value.indexOf(":")` as the separator and
`value.lastIndexOf("@")` as the revision **over the whole string**, then normalizes everything
before the first colon as the path. `requireWorkspaceSourcePath` rejects only absolute,
traversing, and `.amanuensis` paths (`helpers.ts:79-96`), so it accepts strings containing
spaces. The consequences are both directions of wrong: `"why: src/a.ts:sym@abc123"` is
**accepted** with `"why"` normalized as the path — the real citation is never checked — while
`"one-line: why this link matters"` is **rejected** for having no `@`, though `xrefs.context` is
documented as exactly that kind of one-line prose (`schema.sql:86`). And nothing in the function
resolves the revision or the path, so `"src/a.ts:f@NOT_A_SHA trailing prose"` passes.

Therefore: `context` is split on whitespace, and at least one token must match
`^[^\s:]+(?:/[^\s:]+)*:[^\s@]+@[0-9a-fA-F]{7,40}$`. Each matching token is then validated —
`requireWorkspaceSourcePath` on the path part, and `git rev-parse --verify <sha>^{commit}` on the
revision, which must resolve in the bound workspace. The surrounding prose is stored verbatim;
the validated tokens are returned in the response as `citations[]`. **Symbol reachability is not
checked** and the contract says so: deciding whether a symbol exists at a revision needs a
language parser the server does not have, and `evidence.symbol` is a free-text field
(45 of 209 values on the AxiomDB store carry a parenthetical qualifier). An edge with no
well-formed, revision-resolving citation token cannot be recorded.

`mcp-server/test-smoke.mjs:254` calls `add_xref` with no `context` and is updated in the same
packet; it is the only existing caller.

`relationship` for these rows is `data-flow` or `dependency` (the existing enum values).
`architecture.md` renders topology **from recorded edges only**; with zero `xrefs` rows it
renders the layer atlas and says so, exactly as `reporting-style.md` requires. Edges are never
inferred from names, prefixes, or nearby seams.

### 9.3 Skill routing

`SKILL.md`'s routing table gains one row, placed directly after the "what have you noticed" row:

| User says… | You do |
|---|---|
| "what do we know about X" / "before I change X" / "is there a finding on this file" / "what is `<term>` here" | Call `describe_locus` first. Answer with standing, then the account. When standing is `unledgered`, `excluded`, or `scoped-unread`, say so and offer a survey; do not read the file and improvise. See `references/notes.md`. |

`SKILL.md`'s description front matter already carries the trigger phrases "what do we know
about X subsystem" and "is there a finding on this file"; they are widened to files, symbols,
and terms.

### 9.4 `references/notes.md` answer shape

The consumer route's answer shape becomes fixed and is stated as a contract in that file:

1. **Standing, first, in one line** — the state, the owners when they disagree, the authority
   ceiling, and the checked revision.
2. **The account**, leading with the most consequential open item when one exists (open finding
   by severity, then awaiting verification, then undiscriminated, then decision, then lead).
3. **What is not known** — the `unknown` list, never omitted, never softened.

It cites row ids and `file:symbol@sha` as it does today. It never runs a survey. The existing
limits section is unchanged.

---

## 10. Single-source enums

### 10.1 Where the definitions live

`mcp-server/contracts/conspectus-vocabulary.json`, contract version `1.0.0`. One object per
enum; one entry per value:

```json
{ "contract_version": "1.0.0",
  "enums": {
    "finding_resolution_state": {
      "axis": "resolution",
      "values": [
        { "value": "open", "label": "Open",
          "meaning": "No terminal resolution event has been recorded for this finding.",
          "cannot_justify": "that the defect is still reproducible at the repository head" }
      ] } },
  "orientation_forbidden_terms": ["stale", "fresh", "mapped", "unmapped", "re-anchored",
    "up to date", "out of date", "current as of", "fully surveyed"] }
```

Enums carried — every CHECK-constrained vocabulary any surface in §10.2 reads or enforces:
`finding_resolution_state`, `standing_state`, `stale_reason`, `file_classification`,
`subsystem_status`, `evidence_kind`, `evidence_quality`, `disposition_classification`,
`severity`, `field_note_category`, `open_question_category`, `open_question_resolution`,
`field_note_follow_up`, `xref_relationship`, `xref_strength`, `contradiction_resolution`,
`diagnosticity_outcome`, `claim_epistemic_kind`, `claim_subject_type`, `concern_status`,
`pass_type`, `lens`, `omission_reason`, `attention_label`.

The reviewed draft carried eleven and omitted nine that the projection and the validators both
read; a single-source contract with holes in it is a contract that permits drift exactly where it
is not looking. `stale_reason` is new to the list and carries `unreachable-ref` (§2.2).

**The obligation predicate is generated, not copied.** It exists in three hand-maintained copies
today — `mcp-server/src/helpers.ts:19-20` (`OBLIGATION_BEARING_SQL`),
`materializer/amanuensis_materializer/diagrams.py:119`'s `_OBLIGATION_BEARING`, and the SQL in §6.1
and §11.2 of this document. Each `file_classification` value carries an `obligation_bearing`
boolean in the JSON source, and `gen-vocabulary.mjs` emits the SQL fragment and the Python tuple
from it. A fourth copy would be a fourth place to drift.

### 10.2 Which surfaces read it

| Surface | How |
|---|---|
| Server validators | `mcp-server/src/vocabulary.ts`, **generated** from the JSON by `scripts/gen-vocabulary.mjs`; `tools/*.ts` import their enum arrays from it instead of declaring literals |
| Reader's guide | `materializer/amanuensis_materializer/vocabulary.py`, generated by the same script; `render_how_to_read` builds every table from it |
| `how-to-read` tables and HTML hints | `html_projection.py`'s `STATUS_HINTS`, `EVIDENCE_HINTS`, `SEVERITY_HINTS`, `DISPLAY_STATUS`, and `STATUS_AXIS` are built from `vocabulary.py`, not from literals |
| SQL constraints | `gen-vocabulary.mjs --check-sql` parses every `CHECK (<col> IN (…))` literal in `src/schema.sql` for the columns the source names and fails on any divergence. The CHECKs are **not** generated into `schema.sql` — the file is applied to live databases on every open (`db.ts:48-53`), so rewriting it mechanically is a migration risk, not a formatting one. Parity is asserted; authorship stays with the schema |
| `check-evidence-vocabulary.mjs` | **rewritten**, not extended |

`node mcp-server/scripts/gen-vocabulary.mjs --check` and `--check-sql` join CI and fail when a
generated file or a SQL CHECK differs from the source, exactly as `gen-tool-inventory.mjs
--check` already does.

`check-evidence-vocabulary.mjs` cannot survive this change as written.
`mcp-server/scripts/check-evidence-vocabulary.mjs:17-28` recovers its two lists by regex —
`const KINDS = [` from `src/tools/evidence.ts` and `const EVIDENCE_QUALITY = [` from
`src/tools/dispositions.ts` — and throws `could not find <name>` when the match fails. The moment
those files import their arrays from generated `vocabulary.ts`, the literal is gone and the check
dies on its own error path. Rewriting it to follow the import is worse: both sides would then be
the same array, and a comparison of one array with itself cannot turn red. It is replaced by a
four-way comparison — `conspectus-vocabulary.json`, generated `vocabulary.ts`, generated
`vocabulary.py`, and `SKILL.md`'s prose ladder — each read independently, with a divergence in
**any** of the four reported by name. `SKILL.md` is the only one of the four that is
hand-written, and it is the one the original check existed to catch.

---

## 11. Overview truthfulness

### 11.1 Orientation prose carries no freshness or status vocabulary

Rule: the thesis on `index.md` (§7.2 step 2) and the subsystem purpose sentences may not
contain freshness or status vocabulary, because that vocabulary makes a claim the prose cannot
keep current.

Lint: `materializer/amanuensis_materializer/lint.py` exposes
`orientation_violations(text) -> list[str]`.

A bare word-boundary match over `orientation_forbidden_terms` is too coarse to ship. `\bmapped\b`
matches inside *memory-mapped*, because `-` is a word boundary, and `\bstale\b` matches *a stale
cache is invalidated by…* — a correct technical sentence about the subject matter, not a claim
about the survey. The rule is about **survey-status assertions**, so the match is shaped like
one:

1. A forbidden term matches only when it stands as a predicate about the record or the project:
   the term, case-insensitively on word boundaries, **not** immediately preceded by a hyphen or a
   `` ` `` and **not** inside a `` `code span` `` or a fenced block. That alone clears
   *memory-mapped* and every quoted enum value.
2. A cleared term still matches when it is the complement of a copula whose subject is the
   project, the codebase, the conspectus, the survey, the documentation, or a subsystem —
   `\b(this (codebase|project)|the (conspectus|survey|documentation)|[A-Z]-\d+)\s+(is|are|was|were|remains?)\b[^.]{0,40}<term>`.
   That is what catches *the conspectus is fully surveyed* while leaving *a stale cache* alone.
3. The count-fraction pattern `\b\d+\s*/\s*\d+\b` matches unconditionally; a fraction in
   orientation prose is always a number that will go out of date.

`materializer/test-overview-truthfulness.py` carries both arms: a positive corpus of eight
status assertions that must all be caught, and a negative corpus — *memory-mapped page cache*,
*a stale cache*, *the mapped region*, *re-anchored the B-tree* — that must all pass. A lint with
only the positive arm measures nothing about its false-alarm rate (VP7). `render_index` calls it; a non-empty result appends
a warning to the materializer summary, sets `summary.ok = False`, and renders the thesis slot
as *"The recorded thesis carries status vocabulary and was not published; correct
`entry-point.md`."* A guard that does not halt is prose with better timing (GP25).

### 11.2 Ledger-derived freshness replaces the `entries`-derived strip

`core.py` currently computes `stale_entry_count` from `entries WHERE stale=1`, a table nothing
writes. It is replaced by:

```sql
SELECT COUNT(*) FILTER (WHERE stale=1 AND COALESCE(classification,'candidate')
                        NOT IN ('generated-ignore','vendor-ignore','irrelevant')) AS stale_obligation,
       COUNT(*) FILTER (WHERE stale=1 AND COALESCE(classification,'candidate')
                            IN ('generated-ignore','vendor-ignore','irrelevant'))  AS stale_exempt,
       COUNT(*)                                                                    AS scoped_files
  FROM file_ledger;
```

`staleness_measured = scoped_files > 0`. The HTML snapshot strip and the overview's count read
these. When `staleness_measured` is false the strip reads *"Freshness not measured by this
projection"* — which is true — and never *"No recorded stale entries"*. A parity gate asserts
the strip's numbers equal `get_dashboard`'s `stale_entries`, `stale_exempt`, `scoped_files`, and
`staleness_measured` on the same store.

### 11.3 The stale read-back axis gains a denominator

`readback.py` keeps its `entries`-derived stale marker check unchanged and **adds**
`ledger_stale_marker(subsystem_id, file_path)`. The state axis requires exactly one such marker
in the Markdown corpus and exactly one in the HTML corpus for every obligation-bearing
`file_ledger` row with `stale=1`. The markers are emitted by `stale.md` (§6.2). Removing a row's
record turns the state axis red; the axis can therefore turn red, which the `entries`-derived
one could not.

---

## 12. Self-conspectus rebuild

Decision 4: the Amanuensis self-conspectus is discarded and rebuilt with the new survey so its
documentation is claims-backed. AxiomDB backfill is out of scope.

### 12.1 Discard and rebuild

The MCP server holds an open SQLite handle for the life of the process and exposes no
whole-store reinitialization operation — `reset_subsystem` is per-subsystem and
`commit_phase_gate` only snapshots — so deleting the file underneath a running server would leave
it writing through a stale handle to an unlinked inode. The rebuild is therefore a sequence of
checkpointed steps with an explicit process boundary, each one independently verifiable:

1. **Snapshot.** `commit_phase_gate(label="Pre-rebuild snapshot")` captures the storage
   directory's own Git history. The store lives at `<worktree>/.amanuensis/memory.db` and is
   excluded from Git by `.git/info/exclude`; `git ls-files .amanuensis` returns 0 files, so the
   snapshot is the only record of the pre-rebuild state.
2. **Stop.** The MCP server process is shut down. Nothing may hold a handle to the store.
3. **Delete.** `.amanuensis/memory.db` and its `-wal` and `-shm` companions are removed.
4. **Initialize and restart.** A new server process opens the storage, which runs
   `initializeSchema` (`db.ts:48-53`) and creates both new views.
5. **Read back.** `get_project_info` and `get_dashboard` answer against an empty store, with the
   storage marker validated — proof that step 4 produced a live store and not a resurrected
   handle.
6. **Rebuild.** Onboarding, then every subsystem in priority order, with Phase 2 writing
   structural claims (§9.1) and edges (§9.2).
7. **Publish and promote** (§12.2).

Steps 1–5 are one packet, step 6 is batched per subsystem, and step 7 is its own packet. A single
packet spanning destruction, a full survey of every subsystem, publication, and read-back has no
intermediate state a failure can be resumed from. Only the rebuild packets carry
`needs_mcp: true`.

### 12.2 `docs/` republication

`docs/` is the checked-in projection (48 tracked files, confirmed by `git ls-files docs`).
`materialize_docs` **cannot write it**: `output_dir` defaults to `"docs"` and is resolved by
`resolveStorageOutputPath` (`mcp-server/src/tools/materialize.ts:242-246`), which resolves
relative paths against `project.storagePath` and asserts containment
(`mcp-server/src/project.ts:1003-1012`). The tool therefore writes `.amanuensis/docs`, and the
containment assertion means it can never be pointed at the repository root — which is the guard
working as designed, not a bug to remove.

Publication is two steps, and the second one is explicit:

1. `materialize_docs(clean_publish=true)` renders and reads back into `.amanuensis/docs`. A red
   read-back leaves that directory's previous contents untouched (ADR-0005), so a failed rebuild
   publishes nothing.
2. `dev/promote-docs.mjs` copies `.amanuensis/docs` to the tracked `docs/`, refusing to run
   unless the source carries a `.projection-contract.json` whose three axes are green. It then
   re-reads the **promoted** tree — `verify_materialized_docs` pointed at root `docs/` — and
   fails if any file's hash differs from the contract. The bytes that get committed are the bytes
   that were verified at the path they were committed to; verifying a different directory and
   committing this one is GP21, a unit-scoped pass asserted as a system-scoped one.

`docs/.manifest.json` and `docs/.projection-contract.json` are committed with the rest.

### 12.3 What must stay green

`dev/check-living-conspectus.mjs` checks the **immutable A0 historical fixture** at `b8b566f`
(`dev/conspectus/self-baseline.json`, `baseline-report.json`,
`baseline-report-detector-1.0.0.json`, `detector-registry.json`). Those artifacts are never
rewritten, retargeted, or regenerated by the rebuild; the rebuild changes only the live store
and `docs/`. `node dev/check-living-conspectus.mjs` and `node dev/test-living-conspectus.mjs`
must pass unchanged after the rebuild.

### 12.4 The dogfood gate

`dev/test-reader-lenses-dogfood.mjs` runs against **committed artifacts**, not against the live
store. `git ls-files .amanuensis` returns 0: the store is untracked, so a gate that reads it
cannot run in CI and would be green-by-absence anywhere else. The rebuild packet writes
`design/reader-lenses/dogfood-receipt.json` — the three `describe_locus` responses, the
`get_attention` id sets, and the `finding_state_current` query result, each with the store's
`last_checked_sha` — and commits it alongside `docs/.projection-contract.json`. The gate asserts
over those. It also runs against the live store when one is present, and says which mode it ran
in; the committed-artifact mode is the one CI executes.

Against the rebuilt store, and then against the receipt:

1. `describe_locus` on `mcp-server/src/index.ts`, `mcp-server/src/tools/findings.ts`, and
   `materializer/amanuensis_materializer/core.py` each returns headline state `examined` (or
   `mixed` with every owner `examined`) and a `structure` section with **at least one current
   claim** whose evidence cites that file.
2. `get_attention`'s open and awaiting-verification ids, **union the ids its `omitted[]` records
   under `reason: "budget"`**, are **exactly equal** — not merely non-empty — to
   `SELECT finding_id FROM finding_state_current WHERE resolution_state IN ('open','fixed-pending-verification')`
   (GP24: fan-in asserts completeness). The union is what the equality is over, because §4 bounds
   the response: the AxiomDB store already holds 16 open findings, 31 open questions, and 103
   open leads, so on a large store the selected set is a strict subset by design. Requiring
   equality over the selected set alone would force the tool to exceed its own budget, setting
   two contracts against each other. `omitted[].count` must also reconcile, so the union cannot
   be satisfied by an empty `ids` list.
3. A clean publish read-back is green on all three axes, and the **promoted** root `docs/`
   byte-matches the contract, re-read at that path (§12.2).

---

## 13. Gates

Every gate names the condition that turns it red and the false green it cannot exclude (VP4).

**A missing file is not a red gate.** The launcher's red proof checks out the `red(<id>)` commit
into a fresh worktree and accepts **any** non-zero exit — `run.sh:326` is
`[ "$red_status" -ne 0 ]` — while `run.sh:324` swallows a failed build with `|| true`. Every gate
here is a new file, so at the red commit the command exits non-zero with
`Cannot find module '…/test-locus-compactness.mjs'` and the proof passes without the gate's
assertion ever having been evaluated. That is a false green about the gate itself, and it
applies to all sixteen packets.

Two things are therefore required of every packet, both recorded in `plan.json` and both
mechanically checked:

1. The `red(<id>)` commit **contains the gate file**. The gate is written first, against the
   unbuilt behaviour; the red commit is the one where the test exists and fails on its own
   assertion.
2. Each packet carries `gate.red_expect`, a regular expression matching the assertion text the
   gate prints when it fails for the intended reason. The launcher greps `verify-<id>-red.out`
   for it, and additionally **rejects** a red output matching
   `MODULE_NOT_FOUND|Cannot find module|No such file|can't open file|SyntaxError`. A red for the
   wrong reason is not a red.

`plan.json` carries `gate.red_expect` for all sixteen packets. The launcher change that reads it
is recorded in `rationale.md` § Unsettled: this session can specify the field and cannot land the
harness change that consumes it.

| Gate (test file) | Turns red when | False green it cannot exclude |
|---|---|---|
| `mcp-server/test-finding-partition.mjs` | a finding whose current state is `verified-fixed`, `ruled-out`, or `accepted` appears in the Unresolved membership query; the overview's per-state counts do not reconcile exactly to `finding_state_current`; `finding_state_current` disagrees with `finding_resolution_current` on any finding that has an event row | a correct partition does not make the findings themselves correct |
| `materializer/test-overview-truthfulness.py` | a survey-status assertion or a count fraction reaches the published overview; the publish does not turn red when it does; the thesis is taken from anywhere but the named heading; **or** any member of the negative corpus (*memory-mapped*, *a stale cache*, *the mapped region*, *re-anchored the B-tree*) is flagged — the false-alarm arm is part of the gate, not a separate concern (VP7) | a clean thesis can still be wrong about the project |
| `materializer/test-ledger-freshness.py` | the freshness strip disagrees with `get_dashboard` on `stale_entries`, `stale_exempt`, `scoped_files`, or `staleness_measured`; an empty ledger renders as "No recorded stale entries"; removing a `stale.md` record leaves the state axis green | agreement between two readers of one table does not make the table right |
| `mcp-server/test-locus-standing.mjs` | `describe_locus` on an unledgered path returns anything but `unledgered`; on a `candidate` row returns a non-empty `structure`; on a stale row omits `examined-stale`; on a multi-owner file with disagreeing owners returns a single headline state; `unknown` is absent; a resolvable non-ancestor `ref_sha` is not downgraded with `unreachable-ref`; an unresolvable one is not downgraded with `unverifiable-ref`; a git-unavailable run leaves `examined`'s authorization text in place instead of the `examined-stale` text; a deferred owner is given a ladder rank; `ledger_reconciled` is non-null on a path that has owner rows; the documented kind-inference order mis-kinds a vocabulary term containing `:`, a `Type::method` symbol, or a path in no table | a mechanically correct standing can sit on a wrong ledger row |
| `mcp-server/test-locus-compactness.mjs` | the **wire** response (text block plus `structuredContent`) exceeds 8192 bytes; `selected + omitted != census` in any section; an omission carries a reason outside `policy`/`budget`; a `census: 0` section emits an omission row instead of `recorded: false`; the aggregated ledger's `count` is truncated; the over-budget fixture does not exceed the budget before truncation | a compact response can still omit the item that mattered |
| `mcp-server/test-locus-index-view.mjs` | `file_standing` or `finding_state_current` disagrees with a **declared fixture table** of `(classification, stale, stale_reason) → expected standing_state` covering all seven states, including `candidate` with `stale=1` and `classification IS NULL`; a path present in `evidence` but not in `file_ledger` is missing from the locus resolution path; the materializer does not turn the publish red on a store lacking either view | the view can be right and the ledger stale |
| `materializer/test-lens-pages.py` | a finding renders its marker on more than one page or on none; a new page's `group` is outside `NAV_GROUPS`; nav group order differs from `NAV_GROUPS`; an empty lens page omits scope, basis, or checked revision; the hot-spot table prints an all-zero access-heat column | correct page membership does not make any record true |
| `materializer/test-search-index.py` | an obligation-bearing ledger path is missing from or duplicated in `search-index.js`; the index is absent from `.projection-contract.json`; a cited symbol is missing; the no-JS path cannot reach a file's anchor; three colliding path slugs do not produce three distinct anchors; a clean publish with `search-index.js` present is not green on the coverage axis, or removing the file does not turn it red | an index entry proves reachability, not usefulness |
| `mcp-server/test-vocabulary-source.mjs` | a generated enum file differs from `conspectus-vocabulary.json`; a SQL `CHECK (… IN (…))` for a named column differs from the source; a tool validator accepts a value the source does not carry; the reader's guide lists a value the server rejects; an enum value lacks `label`, `meaning`, or `cannot_justify`; the four-way check cannot report which of the four parties diverged | agreeing copies can share one wrong definition — which is why `SKILL.md`, the only hand-written party, is read independently |
| `mcp-server/test-structural-claims.mjs` | a claim closed by `apply_change_impact` still appears as current in `describe_locus` or on the page; a subsystem with zero claims renders an empty structure section instead of the labelled fallback; narrative attaches without its `revision_bound: false` label; `add_claim` accepts a `subject_type` outside `{symbol, subsystem, seam}`; `add_claim` accepts a `<sid>/key-type\|state-container\|flow` claim whose evidence kinds are all outside `{code-verified, contract-stated}` or whose evidence cites a different file than `subject_id` | claim presence does not prove claim truth; that stays the adversarial pass's job |
| `mcp-server/test-phase2-claims-gate.mjs` | a subsystem advances to `structural` with no current `<sid>/` claim; the gate demands a per-category quota rather than one claim; an explicit negative claim is refused | a satisfied prerequisite proves the account exists in structured form, not that it is right |
| `mcp-server/test-edge-contract.mjs` | `add_xref` accepts an empty `context`, one with no citation token, or one whose token's revision does not resolve; `add_xref` **rejects** a `context` that is prose containing a well-formed citation token; `architecture.md` renders a topology with zero recorded edges; a rendered edge has no `xrefs` row | a recorded edge can still be wrong; symbol reachability is not checked and the contract says so |
| `materializer/test-history-and-contested.py` | a resolved record appears on `disagreements.md` or an unresolved one on a History page; an `unresolved-competition` matrix or a closed question or resolved lead renders on no page at all; a terminal finding with no recorded basis renders as resolved-with-proof instead of `none-recorded`; the hot-spot sort order differs from §7.6; an all-zero access-heat column is printed; an empty lens page omits scope, basis, or checked revision; the reader's guide lists a value the server does not enforce | a correct split does not make either side's records true |
| `mcp-server/test-attention-history.mjs` | per-label fixture assertions fail — a finding with a prior `verified-fixed` event is not `regression`, an open `candidate-concern` note is not `unverified-suspicion`, an `unresolved-competition` matrix is not `undiscriminated`, a `fixed-pending-verification` row is not `awaiting-verification`; `latent-defect` or `contested` appears as a label at all; claim-derived and ledger-derived stale knowledge are pooled into one count; the open and awaiting-verification ids unioned with the budget-omitted ids are not exactly equal to the `finding_state_current` query; either response exceeds its budget or omits its ledger | an exactly reconciled list can still be a list of wrong findings |
| `mcp-server/test-consumer-route.mjs` | `describe_locus` is not read-only-annotated; `SERVER_INSTRUCTIONS` does not name it in its first sentence; the three tools are absent from the generated inventory, or the inventory's count is not the baseline plus three | reachability does not prove the answer changed an agent's behavior — and the one-call routing claim is **not** gated here; see §13.1 |
| `dev/test-reader-lenses-dogfood.mjs` | any of §12.4's three assertions fails against the committed receipt; the receipt's `last_checked_sha` is absent; the promoted root `docs/` does not byte-match the contract re-read at that path | a green dogfood on one repository is not generality; a receipt proves what was true when it was written |

### 13.1 What is asserted statically and what is measured

`test-consumer-route.mjs` checks static facts: annotations, instruction text, inventory
membership and count. It does **not** check that "a harness given only the server instructions
needs more than one call to answer a file question", which the reviewed draft listed as a red
condition. That is a behavioural claim about a model, and one run of it is not a measurement
(VP5): it needs ≥2 runs per condition, an unaided arm to compare against (VP10), and a stated
least count. It is specified in §13.2 as a measurement with its own protocol, is not a gate, and
never blocks a packet.

### 13.2 The routing measurement

Run separately from CI, recorded in `design/reader-lenses/routing-measurement.md`: 20 file
questions over the rebuilt self-conspectus, two arms — server instructions with the
`describe_locus` route and server instructions without it — 2 runs per arm per question, one
model held fixed. Reported per question and per arm with the tool-call counts; never pooled
across arms (VP6). The result informs §5.4's wording; it gates nothing, and a null result is
reported as a null result.

### 13.3 CI

Every gate above is added to `.github/workflows/test.yml` **by the packet that creates it**, not
collectively at the end; a gate that exists but never runs in CI is a guard with better timing.
`plan.json` lists `.github/workflows/test.yml` in every packet's deliverables with the acceptance
"the packet's gate runs in CI", and reproduces the complete resulting CI list in
`completion.commands`. Existing gates must stay green after every packet.
