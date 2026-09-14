# Survey depth: normative specification

- Status: normative for the `survey-depth` lane. Binding on every packet in `plan.json`.
- Binding inputs: `design/survey-depth/README.md` (proposal), `design/survey-depth/decisions.md`
  (owner decisions). Where the proposal and the decisions differ, the decisions govern; §1.6
  and §8.5 record the one place they do.
- Base revision: `main` at `d2b1630`. Lane branch `survey-depth`.
- Measurement session: `20260914-020500-design`. Every number in §1 was re-derived by this
  session against the two stores read-only; the queries are printed beside the values and
  repeated in `claims.md`.

Terms used without redefinition are ADR-0001's (`dev/adr/0001-living-conspectus-terms.md`):
*fully surveyed*, *current*, *stale*, *invalid*, *resolved*, *verified-fixed*, *complete*.

---

## 0. What this specification changes, in one paragraph

A clean-slate rebuild passed every gate while recording a fifth of the prior survey's file
coverage, a quarter of its evidence, one in sixty of its evidence-backed dispositions, no
vocabulary, and none of six prior open defects. Nothing in the server refused any of it. This
specification adds four per-record obligations to the substrate (§2–§5), one frozen baseline
comparison (§1, §7), one projection correction (§3.4), and one prose/substrate parity check
(§6). Every obligation is **subtractive**: it refuses a status advance or a publication. None
sets a count on a field an agent must author (GP8's scope limit; BP4; `decisions.md` §3).

---

## 1. Baseline measures

### 1.1 The two stores

| | path | opened as |
|---|---|---|
| **Baseline** | `~/.claude/automations/amanuensis-clean-slate/archive/store-7c1c1a9/memory.db` | `file:…?immutable=1` |
| **Candidate** | `~/repos/amanuensis/.amanuensis/memory.db` | `file:…?mode=ro` |

Each store names the revision it was last reconciled at in `git_state.last_checked_sha`:

```sql
SELECT COALESCE(last_checked_sha,'(null)')||' / '||COALESCE(onboarding_sha,'(null)') FROM git_state;
-- baseline   61bc6b5c89f7c6b5091f9cb5df5e68cd969a3f27 / b8b566f
-- candidate  7c1c1a9f5689d396487072d012abe6fafd5f348c / 7c1c1a9f5689d396487072d012abe6fafd5f348c
```

A store's **checked revision** R is `git_state.last_checked_sha`. Every coverage measure below
is evaluated at the store's own R, because a coverage fraction whose denominator is drawn from
a different tree is a number about two trees.

### 1.2 The frozen measures

Each measure is one SQL statement over one store, or one statement plus `git ls-tree -r
--name-only R`. `dev/test-survey-depth.mjs` (§7) executes exactly these and no others.

**D1 — ledger rows.**
```sql
SELECT COUNT(*) FROM file_ledger;
```

**D2 — obligation-bearing tracked paths at R.** The denominator for D3. Tracked paths at R,
minus those whose ledger classification exempts them from the obligation to be read.
```
tracked   = git ls-tree -r --name-only R
exempt    = SELECT DISTINCT file_path FROM file_ledger
              WHERE classification IN ('generated-ignore','vendor-ignore','irrelevant','deferred-with-reason')
D2        = |tracked| - |tracked ∩ exempt|
```
A tracked path with no ledger row is obligation-bearing. That is the whole point: an
unclassified file is unread, not exempt.

**D3 — examined tracked paths at R, and the examined fraction.**
```
examined  = SELECT DISTINCT file_path FROM file_ledger WHERE classification='examined'
D3        = |tracked ∩ examined|
D3%       = D3 / D2, or "not measured" when D2 = 0
```

**D4 — evidence rows.** `SELECT COUNT(*) FROM evidence;`

**D5 — dispositions.** `SELECT COUNT(*) FROM dispositions;`

**D6 — evidence rows per disposition.** `D4 / D5`, or `not measured` when D5 = 0.

**D7 — dispositions carrying at least one attached evidence row, and the coverage fraction.**
```sql
SELECT COUNT(*) FROM dispositions d
 WHERE EXISTS (SELECT 1 FROM disposition_evidence de
                WHERE de.subsystem_id=d.subsystem_id AND de.concern_code=d.concern_code);
```
`D7% = D7 / D5`, or `not measured` when D5 = 0.

**D8 — field notes.** `SELECT COUNT(*) FROM field_notes;`

**D9 — open questions.** `SELECT COUNT(*) FROM open_questions;` and, separately,
`… WHERE resolution='open';`. Both are reported; they differ in the baseline.

**D10 — vocabulary terms with a resolvable anchor.**
```sql
SELECT COUNT(*) FROM vocabulary WHERE first_seen IS NOT NULL AND TRIM(first_seen) <> '';
```
plus, for each such row, whether `first_seen` parses as a `file:symbol@sha` citation token
(`CITATION_TOKEN_SOURCE`, `mcp-server/src/helpers.ts:225`) and whether its path exists in the
tree at its revision. A term whose anchor does not resolve is counted separately as
*unanchored*, never silently as a term.

**D11 — open findings.** `SELECT COUNT(*) FROM findings WHERE status='confirmed-bug';` and the
full status histogram beside it.

**D12 — reconciliation standing at R.** `|tracked| − |tracked ∩ ledger|` = the unledgered count,
computed from the tree, together with `SELECT COUNT(*) FROM scope_gaps WHERE kind='unledgered';`
= the count the store believes. **Their disagreement is itself a measure** and the single
strongest signal in this table.

### 1.3 The measured values

Each store at **its own** checked revision. Baseline R = `61bc6b5`; candidate R = `7c1c1a9`.

| | measure | baseline | candidate |
|---|---|---:|---:|
| D1 | ledger rows | 503 | 106 |
| — | tracked paths at R | 503 | 607 |
| D12 | unledgered tracked paths (from the tree) | **0** | **501** |
| D12 | `scope_gaps` rows the store holds | 0 | 0 |
| D2 | obligation-bearing tracked paths | 371 | 605 |
| D3 | examined tracked paths | 221 | 84 |
| D3% | **examined fraction** | **59.57 %** | **13.88 %** |
| D4 | evidence rows | 133 | 42 |
| D5 | dispositions | 128 | 180 |
| D6 | evidence rows per disposition | 1.04 | 0.23 |
| D7 | dispositions with an attached evidence row | 112 | 3 |
| D7% | attached-evidence coverage | **87.50 %** | **1.67 %** |
| — | dispositions with **no** attached row | 16 | 177 |
| — | `disposition_evidence` rows | 181 | 3 |
| D8 | field notes | 36 | 6 |
| D9 | open questions (all / `resolution='open'`) | 16 / 12 | 5 / 5 |
| D10 | vocabulary terms with a non-empty anchor | 4 | 0 |
| — | of those, anchors in `file:symbol@sha` form | 0 | — |
| D11 | open findings (`confirmed-bug`) | 13 | 14 |
| — | findings, all statuses | 22 (`confirmed-bug` 13, `fixed` 9) | 14 (`confirmed-bug` 14) |
| — | subsystems / seams | 8 / 10 | 8 / 10 |
| — | claims / xrefs | 0 / 1 | 39 / 13 |
| — | sessions | 35 | 6 |
| — | ledger classification histogram | candidate 150, examined 221, generated-ignore 124, irrelevant 2, vendor-ignore 6 | candidate 20, examined 84, generated-ignore 2 |

Two rows differ from the proposal's table and both are corrections, not disagreements: the
proposal's "Dispositions with no attached evidence row · 16 / 177" is reproduced exactly, and its
"Open questions 16 / 5" counts all rows rather than open ones (12 of the baseline's 16 are open).
The proposal's "Tracked paths with no ledger row · 493" is the candidate measured at `d2b1630`
rather than at its own checked revision `7c1c1a9`; at `7c1c1a9` it is 501. Both are recorded
because the projection stamps one and the store stamps the other.

### 1.4 The measure the proposal got wrong, and the correction

The proposal names "examined fraction of obligation-bearing rows" as a depth measure to
dominate. Computed over **ledger rows**, that fraction is:

```sql
SELECT 100.0 * SUM(classification='examined')
            / SUM(classification IS NULL OR classification IN ('candidate','examined'))
  FROM file_ledger;
-- baseline 59.57   candidate 80.77
```

**The candidate wins.** A survey that ledgered only what it read reports a higher examined
fraction than one that ledgered the repository. The denominator moved with the numerator, which
is GP24 exactly: a fan-in that counts what it was handed rather than what it was owed.

**Normative consequence.** Every coverage fraction in this specification, in the depth gate, and
in the projection takes its denominator from the **repository's tracked paths at the store's
reconciled revision**, never from the ledger's own row count. A store that has not reconciled at
its checked revision has no denominator and therefore no coverage fraction: it reports
`not measured`, and §3 refuses to publish it.

### 1.5 Freezing

The baseline column of §1.3 is frozen at this session's measurement and is transcribed into
`dev/survey-depth-baseline.json` (§7.2) as the gate's fixture. The archived store is never
restored, never written, and never regenerated. If the archived file becomes unreadable the gate
reports `RED: baseline unreadable`, never green — an absent baseline is a missing denominator,
not a pass (VP4(e)).

### 1.6 Which measures may turn a gate red

`decisions.md` §3 forbids numeric minimums on generative obligations; the proposal's §3.5 lists
`field notes` and `vocabulary terms` among the axes a rebuild must "meet or exceed". These
conflict. The decisions govern, and the resolution is:

- **Blocking axes** (§7.3) are coverage of an enumerable denominator or per-record obligations:
  D3% against the frozen baseline fraction; reconciliation standing D12; D7 as a per-disposition
  predicate, not a ratio; vocabulary as discharge-or-decline per subsystem, not a count; and
  the finding accounting of §5, which is an enumeration with one obligation per baseline finding.
- **Reported axes** are D1, D4, D5, D6, D7%, D8, D9, D10, D11 and the histograms. The gate
  prints each with its baseline beside it and a signed delta. They never turn it red.

A count over field notes would be a quota over a field the agent authors, and quotas over
authored fields are filled to order (BP4; the same reasoning already written into
`mcp-server/src/invariants.ts:152-160` for structural claims). Printing the delta preserves every
bit of signal the count carries for a reader without handing an optimizing session a number to
hit. §8.5 records what that costs.

---

## 2. Evidence-backed dispositions

### 2.1 What is wrong now

`set_disposition` requires `evidence` (a free-text citation string) and `evidence_quality`, and
writes neither to `disposition_evidence` (`mcp-server/src/tools/dispositions.ts:56-118`). The
only writer of `disposition_evidence` is `attach_evidence_to_disposition`
(`mcp-server/src/tools/evidence.ts:68-102`), which nothing requires anyone to call. The skill
asks for it in prose (`references/phase-3-concerns.md:78-82`). 177 of the candidate's 180
dispositions have no attached row.

### 2.2 `set_disposition` takes evidence ids

`set_disposition` gains one required input:

```
evidence_ids: { type: "array", items: { type: "integer" }, minItems: 1 }
```

`evidence` (the free-text citation) and `evidence_quality` are unchanged and stay required.

Handler order, after the existing session, concern-exists, depth and revision checks:

1. Every id in `evidence_ids` names a row in `evidence`. A missing id refuses the whole call.
2. Every named row's `ref_sha` resolves to a commit in the bound workspace, via
   `resolveWorkspaceCommit` (`mcp-server/src/helpers.ts:127-145`). An unresolvable row refuses
   the whole call.
3. `evidence_quality` is no stronger than the strongest `kind` among the named rows, on the
   ladder in `mcp-server/src/vocabulary.ts`. A disposition may under-claim; it may not over-claim.
4. The `dispositions` upsert and one `disposition_evidence` insert per id run in **one
   transaction** (`db.transaction(...)`), with role defaulting to `supports`. Either the
   disposition and its attachments are both present afterwards, or neither is.

`attach_evidence_to_disposition` keeps working unchanged, for `contradicts`, `linchpin` and
`compensating` roles and for adding evidence to a disposition already written.

**One id is enough.** No category of evidence is required and the count is not a quality signal;
the requirement is that the concern was answered against something a reader can open, which is
the same shape as `requireStructuralClaim`'s one-claim rule (`invariants.ts:165-184`).

Error text, exactly:

```
set_disposition requires at least one evidence_id: a disposition is how a concern was
answered, and an answer nobody can open is not a disposition. Record the reading with
add_evidence, then pass its id here. One is enough.
```
```
evidence row <id> has ref_sha <sha>, which does not resolve to a commit in the bound
workspace <path>. A disposition anchored to an unreachable revision cannot be re-read.
```
```
set_disposition claims evidence_quality '<claimed>', but the strongest attached evidence
row is kind '<actual>'. Lower the claim or attach the stronger reading.
```

### 2.3 The status-advance refusal

`enforcePhasePrerequisites` (`mcp-server/src/invariants.ts:303-359`) gains a check that runs for
target status `concerns`, `adversarial` and `mapped`:

> Every row in `dispositions` for this subsystem has at least one `disposition_evidence` row
> whose `evidence.ref_sha` resolves to a commit in the bound workspace.

Rows whose `ref_sha` no longer resolves — the repository's history was rewritten, the commit was
garbage-collected — are named individually in the refusal, because the repair differs: a missing
attachment is attached, an unreachable revision is re-read at a reachable one.

```
cannot advance <sid> to '<target>': <n> disposition(s) were answered from nothing —
<sid>/<code>, … . Every concern this subsystem has dispositioned must carry at least one
attached evidence row whose ref_sha resolves. Record the reading with add_evidence and link
it with attach_evidence_to_disposition, or pass evidence_ids to set_disposition.
```
```
cannot advance <sid> to '<target>': <n> disposition(s) rest on evidence whose revision is no
longer reachable — <sid>/<code>@<sha>, … . Re-read at a reachable commit and attach the new
evidence; an unreachable anchor cannot be verified in place.
```

Because `enforceForwardPrerequisites` (`invariants.ts:378-391`) walks every intermediate rung,
a subsystem jumping `structural → mapped` is checked at all three.

### 2.4 Migration for existing stores

No column changes and no backfill. `dispositions` and `disposition_evidence` keep their shapes,
existing rows are never rewritten, and no store is upgraded in place. The obligation binds at
the **next status advance** and at the **next publication** (§3), so:

- The candidate store's 177 unattached dispositions do not vanish and are not deleted. Its eight
  subsystems are already `mapped`, so no advance is pending; the next *refresh* that advances
  anything, and any `materialize_docs`, refuses until each is attached or the subsystem is reset.
- **The AxiomDB store** (reported by the lane brief as holding 166 dispositions; not measured by
  this session — that repository is outside the lane's custody and was not opened) gets the same
  obligations with no grace path, per `README.md` §4 and `decisions.md` §1. Its next refresh
  either attaches evidence to each disposition in a subsystem it wants to advance or publish, or
  it reports red and publishes nothing. `materialize_docs(clean_publish=true)` already leaves the
  previous output untouched on a red run (ADR-0005), so a refused publish loses nothing.
- The discharge path is mechanical and does not require re-surveying: `get_dispositions` names
  every unattached row, `get_evidence(file_path=…)` finds evidence already recorded against the
  cited file, and `attach_evidence_to_disposition` links it. Where no such evidence exists the
  concern genuinely was answered from nothing and must be re-read.

---

## 3. Scope reconciliation before authority

### 3.1 What is wrong now

`detect_changes` reconciles the ledger against `git ls-files` and rewrites `scope_gaps` from
scratch on every run (`mcp-server/src/tools/git.ts:240`, `:303-312`). Nothing requires it to have
run. `scope_gaps` is empty in both stores, and an empty `scope_gaps` is indistinguishable from a
reconciliation that found nothing. The projection then derives its tracked-path universe *from
the ledger itself* (`materializer/amanuensis_materializer/renderers.py:2689-2708`), so the
candidate's overview prints `Paths in scope with no ledger row: 0` (`renderers.py:752-753`) while
501 tracked paths have no row. Baseline finding **B03-5** describes this; the rebuild reproduced it.

### 3.2 The reconciliation record

New table, append-only, one row per `detect_changes` run:

```sql
CREATE TABLE scope_reconciliations (
    id              INTEGER PRIMARY KEY,
    detected_sha    TEXT    NOT NULL,   -- resolved, 40 hex
    tracked_paths   INTEGER NOT NULL,   -- |git ls-files| at detected_sha
    ledger_rows     INTEGER NOT NULL,   -- distinct file_ledger.file_path
    unledgered      INTEGER NOT NULL,   -- tracked with no ledger row
    absent          INTEGER NOT NULL,   -- ledger rows the tree no longer carries
    exempt          INTEGER NOT NULL,   -- tracked ∩ ledger with an exempting classification
    session_id      TEXT,
    detected_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_scope_reconciliations_sha ON scope_reconciliations(detected_sha);
```

It is a separate record rather than an inference over `scope_gaps` for one reason: a *perfectly*
reconciled store has zero `scope_gaps` rows, so "a gap row exists at R" would read a complete
reconciliation as a missing one. The count zero and the absence of a reading are different facts
and must be stored differently (VP4(e)).

`detect_changes` writes exactly one row per invocation, inside the transaction that rewrites
`scope_gaps`, and returns its id. Rows are never updated or deleted; the history of
reconciliations is itself the record of when the map was last checked against the tree.

### 3.3 "Reconciled at the checked revision", mechanically

A store is **reconciled at revision R** exactly when:

1. a `scope_reconciliations` row exists whose `detected_sha` equals R, and
2. `git_state.last_checked_sha` equals R, and
3. R resolves to a commit in the bound workspace.

The most recent such row is the **standing reconciliation**. `tracked_paths` from that row is
the denominator of every coverage fraction (§1.4). When no such row exists the store is
**unreconciled at R** and has no denominator.

Two operations refuse an unreconciled store:

- **Advance to `mapped`.** Added to `enforcePhasePrerequisites`'s `mapped` case, beside
  `requireChallengedClaims`. `mapped` is the status that licenses the phrase *fully surveyed*
  (ADR-0001 §Fully surveyed, clause 1: "Every tracked path in the pinned inventory has exactly
  one subsystem assignment or an explicit exclusion"); a subsystem cannot reach it while the
  store cannot say what the inventory was.
- **`materialize_docs`.** Checked before rendering, so a red leaves the previous `docs/`
  untouched exactly as a red read-back does.

```
cannot advance <sid> to 'mapped': the store has not been reconciled against the repository at
<sha>. Run detect_changes(current_sha=<sha>) and assign or exempt every unledgered path it
reports; a subsystem cannot be mapped while the store cannot say what the tree contains.
```
```
materialize_docs refuses: the store has not been reconciled against the repository at <sha>
(git_state.last_checked_sha=<other>, latest reconciliation at <other-or-none>). Coverage
published over an unreconciled ledger is a fraction of itself. Run detect_changes first.
```

Refusing `mapped` rather than `structural` keeps a rebuild able to progress subsystem by
subsystem; the reconciliation is a whole-store fact and belongs at the whole-store claim.

### 3.4 The projection renders "not measured"

`renderers.py::_tracked_paths` stops deriving the universe from the ledger and reads the
standing reconciliation, returning `None` when the store is unreconciled at the revision the
projection stamps. Callers distinguish `None` (no reading) from `0` (a reading of nothing).

- **Overview, Survey coverage** (`renderers.py:750-754`). The row `Paths in scope with no ledger
  row` prints the standing reconciliation's `unledgered`, or, when unreconciled:

  > `not measured — the store was last reconciled at <sha-or-never>, not at <published-sha>`

  matching the treatment the staleness row already gives a missing denominator two rows above
  (`renderers.py:717-728`).
- **Overview, Files read** (`renderers.py:745-749`). The denominator becomes D2 over the standing
  reconciliation, not `obligation` over ledger rows. Unreconciled, it prints the same
  `not measured` sentence with the same reason.
- **Not yet surveyed §1** (`renderers.py:2793-2800`). `_gap_denominator` already prints
  "No tracked paths is recorded, so this gap is not measured here. That is a statement about the
  record, not a claim that the gap is closed." (`renderers.py:2718-2724`) when handed a zero
  denominator. Passing `None` through routes an unreconciled store into that sentence with the
  revision named.
- The read-back's **coverage axis** counts a `not measured` row as present-and-honest, never as
  a satisfied coverage claim. No read-back axis is weakened: a store that *is* reconciled
  produces exactly the numbers it produces today.

---

## 4. Vocabulary: discharge or decline

### 4.1 What is wrong now

`define_term` is Phase 2 step 9 (`references/phase-2-structural.md:171-176`) and appears in no
tool precondition, no status gate and no rebuild gate. It does not require an active session,
does not validate `first_seen` as a citation, and does not resolve `ref_sha`
(`mcp-server/src/tools/vocabulary.ts:21-43`). The candidate has zero terms; the baseline has
four, none of whose anchors is in `file:symbol@sha` form.

### 4.2 `define_term` anchors resolve

`define_term` gains, in this order: `requireActiveSession`; `first_seen`, when supplied, is
validated with `requireWorkspaceCitation(value, "first_seen", { strict: true })` so it is a
real `file:symbol@sha` token; `ref_sha`, when supplied, is resolved by `resolveWorkspaceCommit`
and stored resolved. A term whose anchor does not resolve is refused, not stored unanchored.

A term is **anchored** when `first_seen` parses as a citation token, its path exists in the tree
at the token's revision, and that revision resolves. Existing rows are never rewritten; the
predicate simply reads false for them until the term is redefined.

### 4.3 The declination record

```sql
CREATE TABLE vocabulary_declinations (
    id            INTEGER PRIMARY KEY,
    subsystem_id  TEXT    NOT NULL,
    reason        TEXT    NOT NULL,   -- prose; why this subsystem carries no domain vocabulary
    session_id    TEXT    NOT NULL,
    ref_sha       TEXT    NOT NULL,   -- resolved, the revision the judgment was made at
    declared_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vocab_declinations_subsystem ON vocabulary_declinations(subsystem_id);
```

Append-only: never updated, never deleted. A later pass that *does* find a term simply defines
it; the declination stays as the record of what an earlier reader concluded and when. A
subsystem reset does not erase declinations, for the reason GP18 gives — a ruled-out record is
kept, not deleted.

New tool `decline_domain_vocabulary(subsystem_id, reason, ref_sha, session_id?)`. `reason` is
required and free-form; `ref_sha` is resolved. The tool refuses when the subsystem already has
an anchored term, so the two states cannot both be asserted:

```
decline_domain_vocabulary refuses: <sid> already has <n> anchored term(s) — <term>, … .
A subsystem cannot both carry domain vocabulary and declare it has none.
```

### 4.4 The status-advance refusal

`enforcePhasePrerequisites`'s `structural` case gains, after `requireStructuralClaim`:

> The subsystem has at least one anchored `vocabulary` row (scoped to it by `subsystem_id`), or
> at least one `vocabulary_declinations` row.

```
cannot advance <sid> to 'structural': the structural pass neither defined a domain term for
this subsystem nor declared that it has none. Either define_term with a first_seen anchor
that resolves, or decline_domain_vocabulary with the reason none applies. One term is enough;
there is no quota, and "none" is a real and common answer that has to be said out loud.
```

Codebase-wide terms (`subsystem_id IS NULL`) satisfy no subsystem's obligation. A term that
belongs to everything tells a reader nothing about the subsystem that just advanced.

### 4.5 How the projection renders a declination

A declined subsystem is rendered, not omitted. On the subsystem page, in place of the vocabulary
section:

> **Domain vocabulary** — none. Declared at `<short-sha>` in session `<id>`: *<reason>*

On the codebase/Method vocabulary index, declined subsystems are listed under a heading
`Subsystems that declared no domain vocabulary (<n> of <m>)` with each reason, so a reader sees
the difference between a subsystem nobody asked and one that answered "none". A subsystem that
has done neither — only possible in a store written before this change — renders
`not recorded`, which is the third state and is never collapsed into "none".

---

## 5. Findings carry forward

### 5.1 What is wrong now

`dev/rebuild-self-conspectus-store.mjs` snapshots and deletes the store. No record type carries a
prior finding into the successor. Six baseline open findings — `B03-5`, `B03-6`, `B03-7`,
`B03-8`, `B04-5`, `B07-1` — were neither re-found nor ruled out, and their text survives only in
`~/.claude/automations/amanuensis-clean-slate/archive/old-findings-7c1c1a9.json`. `pecia audit`
flags only *closed* records whose reference stopped resolving (eight of them); an *open*
finding's destruction is invisible to it. Candidate findings **B03-R1** and **B03-R2** name both
halves.

### 5.2 The carried-finding record

```sql
CREATE TABLE carried_findings (
    carried_id           INTEGER PRIMARY KEY,
    archived_finding_id  TEXT    NOT NULL,  -- the id in the archived store, e.g. 'B03-5'
    archived_store_id    TEXT    NOT NULL,  -- identity of the store it came from (§5.3)
    archived_anchor_sha  TEXT    NOT NULL,  -- that store's revision at export
    subsystem_id         TEXT    NOT NULL,  -- as recorded there; may not exist here
    severity             TEXT    NOT NULL CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
    symptom              TEXT    NOT NULL,
    root_cause           TEXT    NOT NULL,
    archived_resolution  TEXT    NOT NULL,  -- resolution_state as archived: open, fixed-pending-
                                            -- verification, verified-fixed, ruled-out, accepted
    archived_ref_sha     TEXT,
    primary_files        TEXT,              -- JSON array, as archived
    carried_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    carried_by_session   TEXT,
    UNIQUE (archived_store_id, archived_finding_id)
);

CREATE TABLE carried_finding_outcomes (
    id            INTEGER PRIMARY KEY,
    carried_id    INTEGER NOT NULL REFERENCES carried_findings(carried_id) ON DELETE RESTRICT,
    outcome       TEXT    NOT NULL CHECK (outcome IN
                            ('successor-finding','ruled-out','repaired')),
    successor_id  TEXT,        -- findings.finding_id, required for 'successor-finding'
    repaired_sha  TEXT,        -- resolved commit, required for 'repaired'
    rationale     TEXT    NOT NULL,
    session_id    TEXT    NOT NULL,
    ref_sha       TEXT    NOT NULL,
    recorded_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_carried_outcome_one ON carried_finding_outcomes(carried_id);
```

Carried findings live in their own table rather than in `findings`. A carried record is an
**obligation to decide**, not a finding this store confirmed; putting it in `findings` would let
it be counted as a defect this survey found, would collide with the successor's id, and would
make `finding_resolution_current` answer about a store that no longer exists.

### 5.3 Store identity

`archived_store_id` is the SHA-256 of the archived store's `git_state` row rendered as
`<repo_id>|<canonical_branch>|<onboarding_sha>|<last_checked_sha>`, truncated to 16 hex
characters, prefixed `store-`. It is written into the successor by the carry, and recomputed
from the archive on demand, so a carried record can always be traced to the store it came from.
This is what candidate finding **B03-R1** asks for: a finding id with no store generation lets a
rebuilt store silently re-satisfy a closed reference.

### 5.4 Who writes what

- **Reinitialization writes the carry.** `dev/rebuild-self-conspectus-store.mjs` gains a required
  `--carry-from <path>`, accepting either an archived store (read `?immutable=1`) or an export
  in the shape of `old-findings-7c1c1a9.json`. It refuses to reinitialize without one; `--carry-
  from none` is accepted and records an explicit, reasoned empty carry so "nothing to carry" is
  said rather than assumed. Every archived finding whose `resolution_state` is not terminal in
  the archive (`open` or `fixed-pending-verification`) is carried. Terminal ones
  (`verified-fixed`, `ruled-out`, `accepted`) are carried too but pre-recorded with outcome
  `repaired`/`ruled-out` and a rationale naming the archive, so the Pecia resolver (§5.7) can
  still answer about them.
- **New tool `carry_finding(...)`**, one carried record per call, so any reinitialization path —
  not only this script — can write the carry, and so the retroactive path (§5.8) exists.
- **New tool `record_carried_outcome(carried_id, outcome, …)`** writes the terminal outcome.
  Authority per outcome:
  - `successor-finding` — requires `successor_id` to name an existing `findings` row in this
    store, filed in the current session. The successor is the re-find.
  - `ruled-out` — requires at least one `evidence` row collected in the **current session** and
    attached to the carried record (a new `carried_finding_evidence` join, mirroring
    `finding_evidence`). This is `requireOverturnEvidence`'s rule (`invariants.ts:422-447`)
    applied to the carried case: overturning requires evidence, not vibes.
  - `repaired` — requires `repaired_sha` to resolve in the bound workspace **and** at least one
    attached evidence row whose `ref_sha` resolves at or after that commit. A claimed repair with
    no post-repair reading is `fixed-pending-verification` in ADR-0001's vocabulary, never a
    discharge.
  One outcome per carried record (`idx_carried_outcome_one`), and outcomes are never deleted. A
  mistaken outcome is corrected by a new carried record from the same archive, which is visible.

### 5.5 The fully-surveyed refusal

ADR-0001's *fully surveyed* predicate gains a seventh clause:

> 7. Every carried finding has a terminal outcome. A store that discarded a prior conspectus is
>    not fully surveyed until it has decided what became of every open defect that conspectus
>    held.

Enforced at the whole-store predicate, **not** at `mapped` for the carried finding's subsystem,
per `README.md` §4's proposal: a rebuild must be able to progress subsystem by subsystem. The
checker (`dev/check-living-conspectus.mjs` and the depth gate, §7) emits the obligation id shape
`carried:<archived_store_id>:<archived_finding_id>`, matching ADR-0001's "every red has a
destination" table.

```
not fully surveyed at <sha>: <n> carried finding(s) have no terminal outcome —
<archived_id> (<severity>, from <store-id>), … . Each must be re-found as a successor
finding, ruled out with evidence collected in this store, or marked repaired at a commit
that resolves. A discarded defect is not a decided one.
```

### 5.6 What the projection shows

A **Carried obligations** section on the Unresolved lens and on the History pages, listing every
carried record with its archived id, store, severity, symptom, and either its outcome or the
word `undecided`. Undecided carried findings are counted in the overview's *Open engineering
work* block as their own row, `Carried defects undecided`, beside `Findings open`. They are
never summed into `Findings open`: a defect this store confirmed and a defect it inherited and
has not looked at are different facts.

### 5.7 How `dev/pecia-resolve-finding.mjs` resolves through a carried record

Today the resolver reads `finding_resolution_current`, falls back to `findings.status`, and exits
1 when the id names no row (`dev/pecia-resolve-finding.mjs:74-100`). A destroyed referent is
therefore reported identically to a reopened one. New lookup order, with the existing exit-code
contract unchanged (0 resolved · 1 not resolved · 2 cannot run):

1. `findings` / `finding_resolution_current` for `<id>` — unchanged. `verified-fixed` or
   `ruled-out` → exit 0.
2. Otherwise `carried_findings` where `archived_finding_id = <id>`:
   - a `successor-finding` outcome → re-run step 1 against `successor_id` and answer with its
     result. The reference follows the finding into its successor.
   - a `ruled-out` outcome → exit 0.
   - a `repaired` outcome → exit 0.
   - **no outcome yet** → exit 1, stderr `carried from <store-id>, no terminal outcome recorded`.
     An inherited, undecided defect does not resolve. That is the point: `pecia audit` reports
     the closed Pecia record as unresolvable and the owner sees it.
3. Otherwise exit 1, stderr `no such finding in the conspectus` — unchanged.

The resolver continues never to print its argument (pecia decision `pc-cdb8`); the new stderr
lines carry no ledger content.

### 5.8 The retroactive path for the six lost findings

The candidate store has no carried records because it was built before this specification. The
lane does not write to it (`decisions.md` §6). The retroactive path is therefore:

1. The acceptance rebuild (§7.4) runs in **this worktree** with
   `--carry-from ~/.claude/automations/amanuensis-clean-slate/archive/old-findings-7c1c1a9.json`.
   That export carries all 22 archived findings with `resolution_state`, `symptom`, `root_cause`,
   `primary_files` and `ref_sha` — every field `carried_findings` needs — anchored at
   `7c1c1a9f5689d396487072d012abe6fafd5f348c`.
2. The rebuild's survey decides each of the 13 archived open findings, and in particular the six
   the 2026-09-14 rebuild lost. The expected outcomes, to be confirmed or contradicted by the
   rebuild rather than assumed by this specification: `B03-5` has a successor in the candidate's
   own record of the same defect (this specification's §3 is its repair); `B03-6`, `B03-7`,
   `B03-8`, `B04-5`, `B07-1` are undecided and must each reach a terminal outcome.
3. `pecia audit` is re-run and each previously unresolvable reference is checked against §5.7.
4. For the **candidate** store in the primary checkout, this specification prescribes nothing
   the lane executes. Its owner path is: on its next refresh, reinitialize or backfill with
   `carry_finding` from the same export. The lane records this as the owner's action, not its own.

---

## 6. Skill parity

### 6.1 The sentences that change

Each is one addition or replacement stating what the server now refuses, in the server's own
words. Line numbers are at `d2b1630`.

| Reference | Location | Change |
|---|---|---|
| `references/phase-2-structural.md` | §9 Vocabulary, `:171-176` | Replace "Continue adding terms via `define_term`." with the discharge-or-decline obligation: a term with a `first_seen` anchor that resolves, **or** `decline_domain_vocabulary` with a reason; `structural` is refused otherwise; `first_seen` must be a real `file:symbol@sha`; one term is enough and there is no quota. |
| `references/phase-3-concerns.md` | §5 Write the disposition, `:63-82` | `evidence_ids` is a required input to `set_disposition`, not a later step; the attachment happens in the same transaction; `evidence_quality` may not exceed the strongest attached kind; the advance to `concerns`/`adversarial`/`mapped` refuses a disposition with no attached row or an unresolvable one. |
| `references/phase-4-adversarial.md` | the `mapped` prerequisites | `mapped` additionally refuses an unreconciled store (§3.3) and names `detect_changes`. |
| `references/refresh.md` | §1, `:30-46` | `detect_changes` writes a reconciliation record; `materialize_docs` and `mapped` refuse without one at the published revision; the unledgered list is assigned or exempted before anything else (already said — now say the server enforces it). |
| `references/refresh.md` | new §Reinitialization | Reinitialization carries prior findings; `--carry-from` is required; the three terminal outcomes and who may write each; fully-surveyed refuses while any is undecided. |
| `references/onboarding.md` | Phase 5 / status ladder | The four new refusals listed where the ladder is introduced. |
| `references/artifact-templates.md` | subsystem-survey template | A **Domain vocabulary** section that is filled with terms or with the declination and its reason. |
| `.claude/skills/amanuensis/SKILL.md` | the refusal summary | One line per new refusal. |

No sentence is removed that describes a behaviour that still exists. Nothing in the references
is softened.

### 6.2 The parity check

`mcp-server/scripts/check-refusal-parity.mjs`, run in CI beside `check-evidence-vocabulary.mjs`.

Mechanism, deliberately narrow. A single source file
`mcp-server/contracts/refusal-parity.json` holds one entry per refusal:

```json
{
  "id": "disposition-unattached",
  "server": { "file": "src/invariants.ts", "phrase": "were answered from nothing" },
  "references": [
    { "file": "../.claude/skills/amanuensis/references/phase-3-concerns.md",
      "phrase": "answered from nothing" }
  ]
}
```

The check asserts, for every entry: the phrase occurs in the named server file; it occurs in
every named reference; and no entry is unreferenced. It fails with the entry id and the side
that lost the phrase. It is a **string-identity** check over a hand-maintained register, and §8.7
states plainly what that does and does not buy — it catches a reference edited out of agreement
with the server, and it cannot tell whether either side is *right*. That limit is why the check
is cheap: the register is the artifact under review, not a model's judgment of similarity.

A new refusal that is not in the register is caught by the check's second assertion only if
someone adds it; §8.7 records that false green. The packet's acceptance requires the register to
name all four new refusals plus the two existing ones the lane touches.

---

## 7. Acceptance rebuild

### 7.1 The depth gate, `dev/test-survey-depth.mjs`

Two arms, for the reason `dev/test-rebuild-depth.mjs:20-27` gives: the store is untracked
(`git ls-files .amanuensis` returns 0), so a gate that only read a live store would be green by
absence in CI.

- **Baseline arm.** Reads `dev/survey-depth-baseline.json` (§7.2). Red if it is absent, is not
  valid JSON, does not declare its contract, or does not bind itself to the archived store's
  identity (§5.3) and anchor.
- **Candidate arm.** Reads the live store at `.amanuensis/memory.db` when one is present, and
  otherwise the committed acceptance receipt (§7.5). When both are present it asserts both and
  requires them to agree; a receipt nobody can contradict is a claim about a claim.

The gate resolves every revision through `dev/receipt-provenance.mjs` (`resolveRevisions`,
`historyIsComplete`) exactly as the reader-lenses gates do, so a shallow clone reports
`cannot run` rather than a false red.

### 7.2 The frozen fixture

`dev/survey-depth-baseline.json`, written once by `dev/record-survey-depth-baseline.mjs` against
the archived store and committed:

```json
{
  "contract": "amanuensis-survey-depth/baseline/v1",
  "archived_store_id": "store-<16 hex>",
  "archived_path": "~/.claude/automations/amanuensis-clean-slate/archive/store-7c1c1a9/memory.db",
  "checked_sha": "61bc6b5c89f7c6b5091f9cb5df5e68cd969a3f27",
  "measured_at": "2026-09-14",
  "measured_by": "20260914-020500-design",
  "queries": { "D1": "SELECT …", "…": "…" },
  "blocking": { "examined_fraction": 0.5957, "examined": 221, "obligation_bearing": 371,
                "tracked_paths": 503, "unledgered": 0,
                "open_findings": ["B01-1","B02-3","B02-4","B03-5","B03-6","B03-7","B03-8",
                                  "B04-2","B04-3","B04-4","B04-5","B05-2","B07-1"] },
  "reported": { "ledger_rows": 503, "evidence": 133, "dispositions": 128,
                "evidence_per_disposition": 1.04, "attached_dispositions": 112,
                "attached_coverage": 0.875, "field_notes": 36,
                "open_questions_all": 16, "open_questions_open": 12,
                "anchored_terms": 4, "open_findings": 13 }
}
```

The `queries` block carries the SQL verbatim so a reader can re-derive every number without this
session. The fixture is regenerable and `--check`able, so it cannot drift from the archive
(GP28), and regenerating it against a *different* store changes `archived_store_id`, which the
gate rejects.

### 7.3 What turns the depth gate red

Blocking, per §1.6:

1. **B1 Reconciliation.** The candidate is reconciled at its checked revision (§3.3), and the
   standing reconciliation's `unledgered` equals the count re-derived from `git ls-tree` at that
   revision. A store whose reconciliation record disagrees with the tree is red.
2. **B2 Examined fraction.** `D3% ≥ 0.5957`, both sides computed over the tracked denominator at
   each store's own reconciled revision. Printed as `candidate 13.88% vs baseline 59.57%
   (−45.69 pp)` whichever way it lands.
3. **B3 Evidence-backed dispositions.** Every disposition in a subsystem at `concerns` or later
   has at least one attached evidence row whose `ref_sha` resolves. This is the §2.3 refusal
   re-asserted over the finished store, so a store written before §2 shipped is still caught.
4. **B4 Vocabulary discharge.** Every subsystem at `structural` or later has an anchored term or
   a declination.
5. **B5 Finding accounting.** Every one of the baseline's 13 open findings, by id, has a carried
   record in the candidate with a terminal outcome. Named individually when absent.
6. **B6 Carried completeness.** No carried record in the candidate is undecided.

Reported, never red: D1, D4, D5, D6, D7%, D8, D9, D10, D11, both classification histograms, and
the claim/xref/session counts, each with its baseline and a signed delta.

The gate prints the denominator beside every fraction and treats a zero denominator as
out-of-band, not as a pass (VP4(e)).

### 7.4 The acceptance rebuild

The lane's final rebuild packet runs, in **this worktree**, the recipe of
`design/reader-lenses/spec.md` §12.1 with two additions:

1. **Snapshot** — `commit_phase_gate(label="Pre-acceptance snapshot")`.
2. **Stop** — the MCP server process is shut down, pid-probed to `ESRCH`, `lsof`-checked for
   exclusivity.
3. **Delete** — `.amanuensis/memory.db` and its `-wal`/`-shm` companions.
4. **Initialize and restart** — a second process opens the storage; `initializeSchema` creates
   the three new tables and every required view.
5. **Carry** — `--carry-from …/old-findings-7c1c1a9.json` writes 22 carried records (§5.8).
   *New step.* It runs before any survey work, so the obligations exist from the first session.
6. **Read back** — from a third process: `get_project_info`, `get_dashboard`, and the carried
   count.
7. **Survey through the skill** — onboarding, then every subsystem in priority order, under §2,
   §3, §4 and §5. `detect_changes` at HEAD is part of onboarding and every unledgered path is
   assigned or exempted before any subsystem reaches `mapped`.
8. **Decide every carried finding** — `record_carried_outcome` for all 22.
9. **Publish and promote** — `materialize_docs(clean_publish=true)`, then `dev/promote-docs.mjs`
   with the read-back re-run at `docs/`.
10. **Receipts** — §7.5.

Since this worktree has no prior store, step 1 snapshots an empty storage directory and step 3 is
a no-op; both still run and both still record, because a recipe with a conditional step is a
recipe with an untested branch.

### 7.5 What it must turn green, and how the result is recorded

The acceptance is `dev/test-survey-depth.mjs` green on **B1–B6** against the frozen baseline,
with every reported axis printed. Plus, unchanged and still green: `dev/test-rebuild-coverage.mjs`,
`dev/test-rebuild-readback.mjs`, `dev/test-reader-lenses-dogfood.mjs`, and the full CI list.

The result is recorded in `design/survey-depth/acceptance-receipt.json`, written by
`dev/record-survey-depth.mjs` and committed, carrying: the contract string
`amanuensis-survey-depth/acceptance-receipt/v1`; the repository sha; the store identity and
checked revision; every blocking axis with its value, its baseline and its verdict; every
reported axis with its delta; per-subsystem status, disposition count and attached count; the
carried-finding table with each outcome; and the reconciliation record. The gate's receipt arm
asserts the same predicates over it, so the comparison is repeatable at any later revision
without the live store — which is what makes this a baseline for the *next* rebuild rather than
a one-time report.

---

## 8. Gates

Every gate is a new file, prints `GATE <id> RED: <reason>` on failure and `GATE <id> GREEN` on
success as its single last stdout line, scrubs launcher crash signatures from its messages
(`dev/test-rebuild-depth.mjs:176-196`), and is added to `.github/workflows/test.yml`.

### 8.1 `GATE SD1` — `mcp-server/test-disposition-evidence.mjs`

**Red when:** `set_disposition` accepts a call with no `evidence_ids`, with an unknown id, with
an id whose `ref_sha` does not resolve, or with an `evidence_quality` stronger than the
strongest attached kind; the disposition and its attachments are not both absent after a refused
call; or an advance to `concerns`, `adversarial` or `mapped` succeeds for a subsystem holding a
disposition with no attached resolvable row. Ships a must-stay-green control: a subsystem whose
dispositions are all attached advances (VP4(f)).

**False green it cannot exclude:** whether the attached evidence *supports* the disposition. The
gate establishes that the concern was answered against a reading someone can open at a revision
that resolves — not that the answer is right. Nor does it bite at the advance to `concerns`,
where a subsystem typically holds zero dispositions and the check is vacuously satisfied; the
first real bite is at `adversarial`, whose existing prerequisite is ≥1 disposition.

### 8.2 `GATE SR1` — `mcp-server/test-scope-reconciliation.mjs`

**Red when:** `detect_changes` returns without writing exactly one `scope_reconciliations` row;
the row's counts disagree with a re-derivation from `git ls-files` in the fixture repo; an
advance to `mapped` succeeds on an unreconciled store; `materialize_docs` renders on an
unreconciled store; or a reconciliation at revision A satisfies a publication at revision B.
Control: a reconciled store advances and publishes.

**False green it cannot exclude:** that the unledgered paths were *assigned well*. Reconciliation
proves the ledger and the tree were compared, not that a file landed in the right subsystem.

### 8.3 `GATE VD1` — `mcp-server/test-vocabulary-discharge.mjs`

**Red when:** `define_term` stores a `first_seen` that is not a citation token or whose revision
does not resolve; `define_term` runs without an active session; an advance to `structural`
succeeds for a subsystem with neither an anchored term nor a declination; a codebase-wide term
satisfies a subsystem's obligation; `decline_domain_vocabulary` succeeds for a subsystem that has
an anchored term; or a declination is updatable or deletable. Control: a subsystem with one
anchored term advances, and so does one with only a declination.

**False green it cannot exclude:** whether the declination is *true*. "This subsystem has no
domain vocabulary" is a judgment; the substrate can require that it be made, attributed and
dated, and cannot check it. That is the discharge-or-decline design accepting GP8's scope limit
rather than pretending past it.

### 8.4 `GATE CF1` — `mcp-server/test-carried-findings.mjs`

**Red when:** reinitialization runs without `--carry-from`; a carried record is writable twice
for the same `(archived_store_id, archived_finding_id)`; `record_carried_outcome` accepts
`ruled-out` with no current-session evidence, `repaired` with an unresolvable sha or no
post-repair evidence, or `successor-finding` naming an absent finding; a second outcome is
accepted for one carried record; a carried record is deletable; or the fully-surveyed predicate
returns true with an undecided carried record. Control: a store whose carried records all have
terminal outcomes is fully surveyed on that clause.

**False green it cannot exclude:** whether the successor finding is *the same defect*. The
substrate records that a decision was made with an anchor; a session that files an unrelated
finding as the successor satisfies it. §5.6's projection exists so a reader can check.

### 8.5 `GATE D1` — `dev/test-survey-depth-red-gates.mjs`

The gate *for* the depth gate. **Red when:** `dev/test-survey-depth.mjs` fails to turn red on
each of B1–B6 seeded independently into a synthetic store; when it turns red on the must-stay-
green control store; when it reports green with an absent or unreadable baseline; when it reports
a fraction without its denominator; or when it is absent from CI. One seeded fault per axis, each
independently chosen at the executed boundary rather than by a marker the gate itself writes
(VP4 v2.15).

**False green it cannot exclude:** the reported axes. Field notes, evidence rows, vocabulary
counts and open questions are printed with their deltas and never turn anything red, so a rebuild
that meets B1–B6 while recording a sixth of the baseline's field notes is green here. That is a
deliberate cost of `decisions.md` §3, taken because a count over a field an agent authors is
filled to order (BP4), and it is why §7.5's receipt records the deltas where a reviewer and the
slice review will see them. Separately, B2 cannot distinguish a file that was read from a file
marked `examined`; the classification is an assertion, and the gate checks its coverage, not its
honesty.

### 8.6 `GATE PM1` — `materializer/test-unmeasured-coverage.py`

**Red when:** the overview's `Paths in scope with no ledger row` prints a number for an
unreconciled store; the coverage denominator is drawn from the ledger rather than the standing
reconciliation; `Not yet surveyed` §1 prints a denominator for an unreconciled store; the
`not measured` sentence omits the revision or the reason; a declined subsystem renders as though
it were never asked; or the read-back's coverage axis counts a `not measured` row as satisfied.
Control: a reconciled store renders exactly the numbers it renders today, asserted byte-for-byte
against a fixture.

**False green it cannot exclude:** it asserts the rendering of a store it is handed. A
reconciliation record that is itself wrong renders faithfully and wrongly; `GATE SR1` owns that.

### 8.7 `GATE RP1` — `mcp-server/test-refusal-parity.mjs`

**Red when:** `check-refusal-parity.mjs` passes after a registered phrase is deleted from a
reference, or from the server file; when the register names a file that does not exist; when it
is empty; or when it is absent from CI. Control: the register at HEAD passes.

**False green it cannot exclude:** a refusal nobody registers. The check compares a
hand-maintained list against two sides; a fifth refusal added later with no register entry drifts
freely. It also cannot tell whether the shared sentence is *correct* — only that both sides say
it. This is string identity over a register, and naming it as such is the honest description of
what §6.2 buys.

### 8.8 `GATE A1` — `dev/test-survey-depth-acceptance.mjs`

**Red when:** `design/survey-depth/acceptance-receipt.json` is absent, is not valid JSON, does
not declare its contract, does not bind to this repository and to a store identity, records a
blocking axis as green whose recorded value fails the baseline comparison, omits any of the 22
carried findings, records a carried finding with no outcome, or disagrees with the live store
where one is present. Also red when the receipt's repository sha does not resolve on this branch.

**False green it cannot exclude:** a receipt proves what was true when it was written. The live
arm narrows the window only where a store exists to read, which in CI it does not.

### 8.9 `GATE CF2` — `dev/test-carried-finding-references.mjs`

**Red when:** `dev/pecia-resolve-finding.mjs` exits 0 for an id whose only record is an undecided
carried finding; exits 1 for an id whose carried record has a `ruled-out` or `repaired` outcome;
fails to follow `successor-finding` into the successor and answer with *its* state; prints its
argument on any path; or returns an exit code outside {0,1,2}. Control: an id with a live
`verified-fixed` finding still exits 0, and an unknown id still exits 1.

**False green it cannot exclude:** `pecia audit` reports only *closed* Pecia records whose
reference stopped resolving. An open Pecia record pointing at a destroyed finding is still
invisible to the audit; this gate makes the resolver honest, and the remaining gap is candidate
finding **B03-R2**, which the acceptance rebuild must carry forward rather than close.

### 8.10 Gates that must stay green, unchanged

`dev/test-rebuild-coverage.mjs`, `dev/test-rebuild-readback.mjs`,
`dev/test-reader-lenses-dogfood.mjs`, `dev/test-living-conspectus.mjs`,
`dev/check-living-conspectus.mjs`, `mcp-server/test-invariants.mjs`,
`mcp-server/test-derived-staleness.mjs`, `mcp-server/test-locus-standing.mjs`,
`mcp-server/test-finding-partition.mjs`, and the materializer's seven Python gates. No axis of
any of them is weakened or removed.

**One existing gate changes**, and only by widening: `dev/test-rebuild-depth.mjs` hard-codes
`CHECKLIST_CONCERNS = ["BV-1","CC-1","EV-1","GT-1","RC-1","ZD-1"]` (`:104`) and a finding-id
shape `<subsystem-id-compact>-<N>` that the clean-slate survey deliberately did not use
(candidate finding **B07-R2**). Both literals are read from the committed coverage receipt's
declared checklist and from a declared id convention instead, keeping the GP24 property the
comment at `:24-28` protects — the denominator still comes from a *different* committed document
than the one under test. Its remaining assertions, including `a disposition carries no attached
evidence`, are untouched: that assertion is this lane's own thesis and it was already right.

**Two gates are already red on this branch at `fb9f1c4`, before the lane starts**, and neither
red is caused by anything specified here. `dev/test-rebuild-depth.mjs` fails eight assertions
over the reader-lenses-era receipt this branch carries (`d2b1630` is a descendant of the
reader-lenses merge `7c1c1a9` and predates the clean-slate rebuild's commits); the acceptance
rebuild re-records that receipt for its own rebuild and must turn it green. `dev/test-rebuild-
regeneration.mjs` fails one assertion — `registry_ownership resolves 4 owning subsystem(s); a
denominator that names one subsystem cannot show a missing edge` — which is the decomposition
question the clean-slate report raised and is **out of this lane's scope**. Neither appears in
any packet's regression list, because a regression list is a promise about gates that are green
when the packet starts. `dev/test-rebuild-regeneration.mjs` stays in `completion.commands`, where
it is the launcher's and the owner's business rather than a packet's.

---

## 9. What this specification does not settle

- Whether the AxiomDB store's next refresh can discharge §2 without re-surveying. §2.4 gives a
  mechanical path; whether the evidence rows it needs already exist there is unmeasured, because
  the repository is outside this lane's custody.
- Whether a *reported* axis should ever become blocking. §1.6 chose no; §8.5 names the cost. The
  acceptance rebuild's deltas are the evidence the owner would need to revisit it.
- Whether `B02-3`'s and `B07-1`'s hang defects are in scope for the acceptance rebuild's
  successor findings, or belong to a separate lane.
