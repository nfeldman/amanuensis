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
   `STATUS_ORDER` in `mcp-server/src/invariants.ts:26-35`. `deferred` **is not on that axis**:
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
| 1 | `purpose` | owning subsystems' `name`, `scope`, `jump_in_reading` | on |
| 2 | `structure` | current `claims` whose `subject_id` is the locus or whose evidence cites it | on |
| 3 | `defects` | `finding_state_current` joined to `findings.primary_files` / `finding_evidence` | on |
| 4 | `reviews` | `dispositions` whose attached evidence cites the locus | off |
| 5 | `boundaries` | `seams` where an owner is a party; `xrefs` from or to an owner | on |
| 6 | `terms` | `vocabulary` scoped to an owner or whose `first_seen` cites the locus | on |
| 7 | `leads` | open `field_notes` and open `open_questions` per §2.4's rules | off |
| 8 | `history_pointer` | counts only: `finding_resolution_events`, `sessions` touching the locus | on |

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
`as_of_sha` switches the whole response to the historical reading at that commit:

```sql
-- structure, historical
SELECT * FROM claims
 WHERE valid_from_sha = :as_of                                   -- exact interval open
    OR (:as_of IS NOT NULL AND valid_until_sha IS NOT NULL);      -- candidate, filtered by ancestry
```

Interval membership is decided by commit ancestry in code, exactly as `claims.ts` already does
(`isAncestor`), never by SHA text or wall-clock order. A historical response carries
`as_of_sha` and `current: false` at the top level and on every item.

### 3.4 No model-generated text

No field of any response in §5 may contain text a model produced during the call. The tools
make zero model calls and report `model_calls: 0` in their trace, mirroring ADR-0011's
`registry-then-lexical-v1` trace contract. Narrative prose written by a survey (the
`subsystem-survey` artifact) may be attached to the `structure` section **only** under
`narrative: { artifact_path, content_hash, revision_bound: false, label:
"Narrative from the survey artifact; not individually bound to a revision" }` and only when the
claims list for that locus is empty.

---

## 4. Compactness

Decision 5 makes compactness a design constraint with a mechanical gate.

### 4.1 Budgets, in bytes of the serialized JSON payload

| Budget | Bytes | Enforced on |
|---|---|---|
| `describe_locus` default response | **8192** | the compact (`JSON.stringify` without indentation) payload |
| standing block alone | **3072** | within the above |
| each optional section when requested | **4096** | per section |
| whole response with every section requested | **32768** | hard ceiling; exceeding it is an error, not a truncation |
| `get_attention` default response | **12288** | compact payload |
| `get_history` default response | **8192** | compact payload |

`owners[]` and `unknown[]`'s per-kind **counts** are never truncated. The per-kind sample lists
inside `unknown[]` are truncated before anything else.

### 4.2 Opt-in sections

On by default: `purpose`, `structure`, `defects`, `boundaries`, `terms`, plus standing and
`unknown`. Opt-in only: `reviews`, `leads`, `history_pointer` detail (its counts are always on),
and `narrative`.

### 4.3 Truncation is declared, never silent

Truncation follows ADR-0011's omission-ledger discipline. Every candidate item is either
selected or recorded in `omitted[]` with exactly one operational reason:

- `policy` — the section was not requested;
- `budget` — eligible but ranked below the byte or item budget;
- `not-recorded` — the source table holds no row (an honest empty, not an omission).

`census` states the total candidate count per section. The invariant, checked by the tool before
returning and by the gate: for every section, `selected + omitted == census`, and every omitted
item id is distinct and present in the census. A response that cannot satisfy the invariant
fails rather than returning a smaller truthful-looking answer (GP24, GP25).

Truncation order within a section is fixed and stated in the schema: drop the lowest-consequence
items first — for `defects`, the terminal states before the non-terminal; for `structure`, the
items with the weakest `evidence_kind`; for `terms` and `leads`, reverse creation order. The
order is a code constant, never a model choice.

### 4.4 The gate must be able to fail on a bloated response

`mcp-server/test-locus-compactness.mjs` seeds a store with a pathological locus — 40 findings,
120 evidence rows, 60 claims, 30 open leads on one path — and asserts:

1. the default response is ≤ 8192 bytes;
2. `selected + omitted == census` for every section;
3. every `omitted` entry carries one of the three reasons;
4. removing the truncation step makes assertion 1 fail (the red proof is committed as a
   deliberate over-budget fixture the test builds and measures, not as a disabled branch).

---

## 5. Tools

Three read tools are added. The 195-tool surface is otherwise unchanged (GP37: no new roles,
no new ceremony).

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
| `latent-defect` | currently open finding whose evidence ref is at or before the impact base, with no prior verified repair |
| `unverified-suspicion` | open `candidate-concern` field note |
| `unknown` | open question |
| `stale-knowledge` | a claim validity interval closed at or before the reviewed HEAD — **extended** to include obligation-bearing `file_ledger` rows with `stale=1`, which is the same epistemic state expressed over the ledger rather than over claims; the item carries `source: "claim"` or `source: "ledger"` so the two are never pooled (VP6) |

Labels ADR-0010 defines but that `get_attention` does not reuse, because they require an A8
composition it does not have: `ruled-out-historical` (it is History, not Unresolved) and
`survived / contested / defeated challenge`. `get_attention` adds exactly two labels of its
own, both with the same shape of definition: `awaiting-verification` (current resolution state
`fixed-pending-verification`) and `contested` (an unresolved contradiction, an open
diagnosticity matrix, or an `unresolved-competition` disposition). A future review brief can
cite `get_attention` output without carrying a second vocabulary.

Sections: `open`, `awaiting_verification`, `contested`, `decisions`, `leads`, `stale`,
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

Membership is SQL. One new view removes the duplicated resolution fallback that
`renderers.py:443` and every future reader would otherwise each re-derive:

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
SELECT id FROM subsystems ORDER BY COALESCE(layer,'~'), id;             -- structure
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
-- contested
SELECT id FROM contradictions WHERE resolution='unresolved' OR resolution IS NULL;
SELECT id FROM diagnosticity_sessions WHERE COALESCE(outcome,'open')='open';
SELECT subsystem_id, concern_code FROM dispositions
 WHERE classification='unresolved-competition';
-- decisions and leads
SELECT id FROM open_questions WHERE resolution='open';
SELECT id FROM field_notes   WHERE follow_up='open';
-- stale knowledge
SELECT subsystem_id, file_path FROM file_ledger
 WHERE stale=1 AND COALESCE(classification,'candidate')
       NOT IN ('generated-ignore','vendor-ignore','irrelevant');
```
Ordering: open findings by severity (`CRITICAL, HIGH, MEDIUM, LOW`) then subsystem then id;
then awaiting verification by severity; then contested; then decisions by category then id;
then leads with `candidate-concern` first; then stale rows by subsystem then path.
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
SELECT * FROM open_questions WHERE resolution IN ('answered','dismissed','superseded');
SELECT * FROM field_notes    WHERE follow_up <> 'open';
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
| `contested.md` | Contested records | Contested | Where credible records disagree or evidence does not discriminate | Unresolved | — | `contested` | **new** |
| `open-questions.md` | Decisions needed | Decisions needed | Questions the survey could not settle, with the assumption used | Unresolved | — | `questions` | consequence-first ordering |
| `field-notes.md` | Leads | Leads | Open observations that are not yet findings | Unresolved | — | `notes` | open only; resolved move to History |
| `stale.md` | Stale knowledge | Stale knowledge | Examined files the repository has changed under | Unresolved | — | `stale` | **new**; carries the ledger markers |
| `hot-spots.md` | Hot spots | Hot spots | Where unresolved work and unread territory concentrate | Unresolved | — | `hotspots` | **new** |
| `resolved-findings.md` | Resolved findings | Resolved findings | Verified, ruled out, and accepted, with the proof each rests on | History | — | `findings` | **new** |
| `resolution-history.md` | Resolution history | Resolution history | The append-only account of how records reached their state | History | — | `timeline` | **new** |
| `sessions.md` | Sessions and publications | Sessions and publications | What ran, when, and what it produced | History | — | `sessions` | **new** |
| `contradictions.md` | Conflicting evidence | Conflicting evidence | Resolved disagreements and the evidence that settled them | History | — | `contradictions` | re-homed; unresolved rows move to `contested.md` |
| `how-to-read.md` | How to read the conspectus | Reader's guide | Every enum, what it authorizes, and what it cannot justify | Method | — | `guide` | generated from the enum source (§10) |
| `concerns.md` | Review coverage | Review coverage | Which failure modes were tested where | Method | — | `coverage` | group changed |
| `concern-checklist.md` | Calibrated review checklist | Review checklist | The concern set and its provenance | Method | — | `artifact` | group changed |
| `diagnosticity.md` | Competing explanations | Competing explanations | Index of evidence matrices and their outcomes | Method | — | `diagnosticity` | group changed; open matrices also listed on `contested.md` as links |
| `matrices/<id>.md` | `<symptom>` | `<symptom>` | One matrix | Method | Evidence matrices | `matrix` | group changed |
| `onboarding-report.md` | Onboarding record | Onboarding record | The repository boundary and initial decomposition | Method | — | `artifact` | group changed |
| `entry-point.md` | Where to begin | Where to begin | A dated reading path recorded by an earlier session | Method | — | `artifact` | group changed; page states its own date and that it is survey history |

**No page is retired.** Every existing path survives with a new home or a narrower membership,
so authored prose links and the coverage read-back axis cannot break on this change.

### 7.2 Overview, first viewport

In this order, and nothing else above the fold:

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

1. Purpose (`name`, `layer`, purpose sentence from `scope`)
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

One row per distinct `file_ledger.file_path`. Columns: path (with a stable `id` anchor derived
from the path slug), owners (every one, each linked to its subsystem page anchor), standing
state, examined revision (short), open-defect count. Sorted by path. Every row's path anchor is
the ⌘K landing target; the anchor lives on this page and links onward to the owning subsystem
page's ledger entry, so no per-file page is created (decision 3).

### 7.5 Not yet surveyed

Four sections, each with its denominator: unledgered paths (`scope_gaps.kind='unledgered'`),
candidate rows grouped by subsystem, deferred subsystems with their recorded reason, unassessed
seams (`seam_assessability.assessable=0` or no `SC-%` disposition), and active concerns with no
disposition anywhere. Each section states the count and the total it is drawn from.

### 7.6 Hot spots

One row per subsystem. Columns, each a separate measure:

1. Subsystem (linked name, id as a defined identifier)
2. Open critical + high
3. Open medium + low
4. Awaiting verification
5. Contested (unresolved contradictions + open matrices + `unresolved-competition` dispositions)
6. Weakest evidence quality among `confirmed-bug` dispositions, or `—`
7. Unread fraction — candidate ÷ obligation-bearing ledger rows, printed as `n/m`
8. Stale files
9. Unassessed seams
10. Access heat — **the column is omitted entirely** when `access_log` has no row for any
    subsystem, rather than printing a column of zeros (VP4)

Sort: column 2 descending, then 3, then 7 as a fraction, then subsystem id ascending. There is
no composite column and no total row.

### 7.7 History pages

`resolved-findings.md` renders each resolved finding as a full marked record: id, severity,
symptom, root cause, resolution state, fix revision and location, the verification evidence row
(for `verified-fixed`), the overturning argument (`rationale`, for `ruled-out`), or the
acceptance rationale (`accepted`). `resolution-history.md` is a newest-first event timeline over
`finding_resolution_events` and `contradiction_resolution_events` with the finding or
contradiction linked. `sessions.md` lists sessions (intent, start, end, outcome), refresh runs,
and projection verification runs with their three axes.

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

### 8.1 What JavaScript may do

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

Nothing else. No client-side data fetching, no analytics, no persisted view state beyond the
existing theme key, no dashboard tiles, no animation.

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
  content hash, so the **content** axis covers it. The **state** axis gains one check: every
  obligation-bearing `file_ledger.file_path` appears exactly once in `paths`, and every
  `evidence` row with a non-null `symbol` appears at least once in `symbols`. A missing or
  duplicated entry turns the state axis red.

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
duplicates. `add_claim` already requires at least one evidence id and already refuses evidence
unreachable at the asserting commit; no new evidence gate is needed.

**Phase prerequisite.** `enforcePhasePrerequisites` gains one condition: advancing a subsystem
to `structural` requires at least one current claim whose `claim_key` begins `<sid>/`. A
subsystem with genuinely no mutable state container records that as a claim with an explicit
negative statement rather than omitting the category; no count of claims is required beyond
one, because forcing a generative field to a shape invites fabrication to order (BP4, and GP8's
v2 scope note). Claim **truth** remains the adversarial pass's obligation; this gate only
establishes that the structural account exists in a revision-bound, evidence-backed form.

**Renderer contract.** The subsystem page and `describe_locus`'s `structure` section read
claims. With zero claims for a subsystem, both render the literal
*"Structural inventory not recorded as claims"* and then, on the page only, the survey
artifact's narrative under §3.4's `narrative` labelling. An empty section is never rendered as
if the subsystem had no structure.

### 9.2 The xref and edge contract

Phase 2 records one `add_xref` row for every data flow or dependency that crosses a subsystem
boundary. `add_xref` gains a required, validated `context`: a non-empty string that contains a
`file:symbol@sha` citation, checked with `requireWorkspaceCitation(value, "context")`. An edge
with no citation cannot be recorded.

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
   by severity, then awaiting verification, then contested, then decision, then lead).
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

Enums carried: `finding_resolution_state`, `standing_state`, `file_classification`,
`subsystem_status`, `evidence_kind`, `disposition_classification`, `severity`,
`field_note_category`, `open_question_category`, `lens`, `omission_reason`.

### 10.2 Which surfaces read it

| Surface | How |
|---|---|
| Server validators | `mcp-server/src/vocabulary.ts`, **generated** from the JSON by `scripts/gen-vocabulary.mjs`; `tools/*.ts` import their enum arrays from it instead of declaring literals |
| Reader's guide | `materializer/amanuensis_materializer/vocabulary.py`, generated by the same script; `render_how_to_read` builds every table from it |
| `how-to-read` tables and HTML hints | `html_projection.py`'s `STATUS_HINTS`, `EVIDENCE_HINTS`, `SEVERITY_HINTS`, `DISPLAY_STATUS`, and `STATUS_AXIS` are built from `vocabulary.py`, not from literals |
| `check-evidence-vocabulary.mjs` | extended, not replaced: it keeps its existing three-way comparison and adds a fourth party — the JSON source — so a change that satisfies three copies and not the source is still red |

`node mcp-server/scripts/gen-vocabulary.mjs --check` joins CI and fails when either generated
file differs from the source, exactly as `gen-tool-inventory.mjs --check` already does.

---

## 11. Overview truthfulness

### 11.1 Orientation prose carries no freshness or status vocabulary

Rule: the thesis on `index.md` (§7.2 step 2) and the subsystem purpose sentences may not
contain freshness or status vocabulary, because that vocabulary makes a claim the prose cannot
keep current.

Lint: `materializer/amanuensis_materializer/lint.py` exposes
`orientation_violations(text) -> list[str]`, matching, case-insensitively and on word
boundaries, every term in `orientation_forbidden_terms` (§10.1) plus the pattern
`\b\d+\s*/\s*\d+\b` (a fraction of counts). `render_index` calls it; a non-empty result appends
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

1. The store lives at `<worktree>/.amanuensis/memory.db` and is excluded from Git by
   `.git/info/exclude`. Before discarding, `commit_phase_gate(label="Pre-rebuild snapshot")`
   captures the storage directory's own Git history.
2. The rebuild runs through the skill, not by hand: onboarding, then every subsystem in
   priority order, with Phase 2 writing structural claims (§9.1) and edges (§9.2).
3. The rebuild session is the only packet with `needs_mcp: true`.

### 12.2 `docs/` republication

`docs/` is the checked-in projection (48 tracked files). It is regenerated by
`materialize_docs` with `clean_publish` and committed, including `docs/.manifest.json` and
`docs/.projection-contract.json`. A red read-back leaves the prior `docs/` untouched
(ADR-0005), so a failed rebuild cannot publish.

### 12.3 What must stay green

`dev/check-living-conspectus.mjs` checks the **immutable A0 historical fixture** at `b8b566f`
(`dev/conspectus/self-baseline.json`, `baseline-report.json`,
`baseline-report-detector-1.0.0.json`, `detector-registry.json`). Those artifacts are never
rewritten, retargeted, or regenerated by the rebuild; the rebuild changes only the live store
and `docs/`. `node dev/check-living-conspectus.mjs` and `node dev/test-living-conspectus.mjs`
must pass unchanged after the rebuild.

### 12.4 The dogfood gate

`dev/test-reader-lenses-dogfood.mjs`, run from the worktree root, asserts against the rebuilt
store:

1. `describe_locus` on `mcp-server/src/index.ts`, `mcp-server/src/tools/findings.ts`, and
   `materializer/amanuensis_materializer/core.py` each returns headline state `examined` (or
   `mixed` with every owner `examined`) and a `structure` section with **at least one current
   claim** whose evidence cites that file.
2. `get_attention`'s open and awaiting-verification item id sets are **exactly equal** — not
   merely non-empty — to
   `SELECT finding_id FROM finding_state_current WHERE resolution_state IN ('open','fixed-pending-verification')`
   (GP24: fan-in asserts completeness).
3. A clean publish read-back is green on all three axes, and the published `docs/` byte-matches
   the receipt.

---

## 13. Gates

Every gate names the condition that turns it red and the false green it cannot exclude (VP4).

| Gate (test file) | Turns red when | False green it cannot exclude |
|---|---|---|
| `mcp-server/test-finding-partition.mjs` | a finding whose current state is `verified-fixed`, `ruled-out`, or `accepted` appears in the Unresolved membership query; the overview's per-state counts do not reconcile exactly to `finding_state_current`; `finding_state_current` disagrees with `finding_resolution_current` on any finding that has an event row | a correct partition does not make the findings themselves correct |
| `materializer/test-overview-truthfulness.py` | orientation prose containing any `orientation_forbidden_terms` term or a count fraction reaches the published overview; the publish does not turn red when it does; the thesis is taken from anywhere but the named heading | a clean thesis can still be wrong about the project |
| `materializer/test-ledger-freshness.py` | the freshness strip disagrees with `get_dashboard` on `stale_entries`, `stale_exempt`, `scoped_files`, or `staleness_measured`; an empty ledger renders as "No recorded stale entries"; removing a `stale.md` record leaves the state axis green | agreement between two readers of one table does not make the table right |
| `mcp-server/test-locus-standing.mjs` | `describe_locus` on an unledgered path returns anything but `unledgered`; on a `candidate` row returns a non-empty `structure`; on a stale row omits `examined-stale`; on a multi-owner file with disagreeing owners returns a single headline state; `unknown` is absent; an unreachable `ref_sha` is not downgraded | a mechanically correct standing can sit on a wrong ledger row |
| `mcp-server/test-locus-compactness.mjs` | the default response exceeds 8192 bytes; `selected + omitted != census` in any section; an omission carries a reason outside the three; the over-budget fixture does not exceed the budget before truncation | a compact response can still omit the item that mattered |
| `mcp-server/test-locus-index-view.mjs` | `file_standing` or `finding_state_current` disagrees with a hand-written reference query on the seeded store; a path present in `evidence` but not in `file_ledger` is missing from the locus resolution path | the view can be right and the ledger stale |
| `materializer/test-lens-pages.py` | a finding renders its marker on more than one page or on none; a new page's `group` is outside `NAV_GROUPS`; nav group order differs from `NAV_GROUPS`; an empty lens page omits scope, basis, or checked revision; the hot-spot table prints an all-zero access-heat column | correct page membership does not make any record true |
| `materializer/test-search-index.py` | an obligation-bearing ledger path is missing from or duplicated in `search-index.js`; the index is absent from `.projection-contract.json`; a cited symbol is missing; the no-JS path cannot reach a file's anchor | an index entry proves reachability, not usefulness |
| `mcp-server/test-vocabulary-source.mjs` | a generated enum file differs from `conspectus-vocabulary.json`; a tool validator accepts a value the source does not carry; the reader's guide lists a value the server rejects; an enum value lacks `label`, `meaning`, or `cannot_justify` | agreeing copies can share one wrong definition |
| `mcp-server/test-structural-claims.mjs` | a claim closed by `apply_change_impact` still appears as current in `describe_locus` or on the page; a subsystem with zero claims renders an empty structure section instead of the labelled fallback; narrative attaches without its `revision_bound: false` label | claim presence does not prove claim truth; that stays the adversarial pass's job |
| `mcp-server/test-phase2-claims-gate.mjs` | a subsystem advances to `structural` with no current `<sid>/` claim; the gate demands a per-category quota rather than one claim; an explicit negative claim is refused | a satisfied prerequisite proves the account exists in structured form, not that it is right |
| `mcp-server/test-edge-contract.mjs` | `add_xref` accepts an empty or uncited `context`; `architecture.md` renders a topology with zero recorded edges; a rendered edge has no `xrefs` row | a recorded edge can still be wrong |
| `materializer/test-history-and-contested.py` | a resolved record appears on `contested.md` or an unresolved one on a History page; the hot-spot sort order differs from §7.6; an all-zero access-heat column is printed; an empty lens page omits scope, basis, or checked revision; the reader's guide lists a value the server does not enforce | a correct split does not make either side's records true |
| `mcp-server/test-attention-history.mjs` | a `get_attention` label's meaning differs from ADR-0010's; claim-derived and ledger-derived stale knowledge are pooled into one count; the open and awaiting-verification id sets are not exactly equal to the `finding_state_current` query; either response exceeds its budget or omits its ledger | an exactly reconciled list can still be a list of wrong findings |
| `mcp-server/test-consumer-route.mjs` | `describe_locus` is not read-only-annotated; `SERVER_INSTRUCTIONS` does not name it in its first sentence; a harness given only the server instructions needs more than one call to answer a file question; the three tools are absent from the generated inventory | reachability does not prove the answer changed an agent's behavior |
| `dev/test-reader-lenses-dogfood.mjs` | any of §12.4's three assertions fails | a green dogfood on one repository is not generality |

Existing gates that must stay green after every packet: the complete CI list in
`.github/workflows/test.yml`, reproduced in `plan.json`'s `completion.commands`.
