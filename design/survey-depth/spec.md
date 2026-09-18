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

There are **twelve** measures, D1–D12. Each is one SQL statement over one store, or one
statement plus `git ls-tree -r --name-only R`; D9 is reported as two statements over the same
table. `dev/test-survey-depth.mjs` (§7) executes these twelve as its baseline and comparison
layer, and **separately** evaluates the six acceptance predicates B1–B6 of §7.3. Those are
per-record obligations, not measures: B3 joins `dispositions` to `subsystems` and resolves each
`ref_sha`, B4 reads `vocabulary_declinations`, and B5 and B6 read `carried_findings`. No
D-measure expresses any of them, and the fixture (§7.2) lists them under their own key so a
reader is never told the gate runs twelve statements when it runs twelve statements and six
predicates.

**D1 — ledger rows.**
```sql
SELECT COUNT(*) FROM file_ledger;
```

**D2 — obligation-bearing tracked paths at R.** The denominator for D3. Tracked paths at R,
minus those whose ledger classification exempts them from the obligation to be read.
```
tracked   = git ls-tree -r --name-only R
exempt    = SELECT DISTINCT file_path FROM file_ledger
              WHERE classification IN (<the classifications the contract marks
                                       obligation_bearing = false>)
D2        = |tracked| - |tracked ∩ exempt|
```
A tracked path with no ledger row is obligation-bearing. That is the whole point: an
unclassified file is unread, not exempt.

**The exempt set is generated, never transcribed.** `mcp-server/contracts/conspectus-vocabulary.json`
carries an `obligation_bearing` boolean on every `file_classification` value, and it is the single
source (GP28): at `d2b1630` it marks `generated-ignore`, `vendor-ignore` and `irrelevant` false and
`candidate`, `examined` and **`deferred-with-reason`** true. An earlier draft of this section
hard-coded `deferred-with-reason` as exempt, which contradicted the contract and would have exempted
35 paths in the AxiomDB store from the obligation the contract says they carry. The predicate is
derived from the contract through `mcp-server/src/vocabulary.ts` and
`materializer/amanuensis_materializer/vocabulary.py`, the two files `scripts/gen-vocabulary.mjs`
generates, so a classification added or reclassified there reaches this measure with no second list
to maintain. Neither store's histogram (§1.3) contains a `deferred-with-reason` row, so no value in
§1.3 changes; the derivation does.

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

`decisions.md` §3 forbids numeric minimums on generative obligations; item 5 of the proposal's §3
("Depth gate against the baseline") lists `field notes` and `vocabulary terms` among the axes a
rebuild must "meet or exceed". These conflict. The decisions govern, and the resolution is:

- **Blocking axes** (§7.3) are not measures at all. They are coverage of an enumerable
  denominator, or per-record obligations the gate evaluates beside the measures:
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
2. Every named row's `ref_sha` resolves to a commit in the bound workspace. The **distinct**
   `ref_sha` values among the named rows are resolved in **one** `git cat-file --batch-check`
   over the bound workspace, not one `resolveWorkspaceCommit` per id. An unresolvable row
   refuses the whole call, naming the row and its sha.

   The batching is not an optimization detail; it is what keeps an existing gate honest.
   `resolveWorkspaceCommit` (`mcp-server/src/helpers.ts:127-145`) spawns `git rev-parse` and
   cannot be cached — the comment at `:110-125` explains why, and ends "the subprocess is
   therefore paid on every durable write". `mcp-server/test-perf-ceilings.mjs:187` reads
   `set_disposition` against a 200 ms ceiling that `:171-184` records as ~31× a measured
   6.35-6.50 ms single subprocess, the tightest multiple in that section. One subprocess per
   evidence id would make the call N+1 subprocesses and put that ceiling within reach of an
   ordinary multi-evidence disposition. `cd mcp-server && node test-perf-ceilings.mjs` is in
   P1's regression list for exactly this reason.
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

> Every row in `dispositions` for this subsystem has **at least one** `disposition_evidence` row
> whose `evidence.ref_sha` resolves to a commit in the bound workspace.

**At least one, not all.** A disposition carrying two attachments, one resolvable and one whose
revision was rewritten away, **passes**: the concern is still answered against a reading someone
can open. The unresolvable attachment is still reported — the advance prints it as a warning line
naming `<sid>/<code>@<sha>` — but it does not refuse, because refusing it would make an ordinary
rebase retroactively unmap a subsystem whose evidence is intact. Only a disposition with **no**
resolvable attachment refuses.

Rows whose attachments *all* fail to resolve — the repository's history was rewritten, the commit
was garbage-collected — are named individually in the refusal, because the repair differs: a
missing attachment is attached, an unreachable revision is re-read at a reachable one.

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

No column changes and no backfill of **domain rows**. `dispositions` and `disposition_evidence`
keep their shapes and no existing disposition, evidence row or attachment is rewritten, deleted or
re-derived. The obligation binds at the **next status advance** and at the **next publication**
(§3), so:

The **schema** is a different matter and this specification does not pretend otherwise.
`openDatabase` runs `runMigrations` and then `initializeSchema` on **every** open
(`mcp-server/src/db.ts:46-58`), `initializeSchema` re-execs the whole of `schema.sql` (`:84-89`),
and `migrateVocabularyChecks` rebuilds a `CHECK`-constrained table on an existing store when the
contract widens an enum (`:137-192`). Every table this specification adds therefore arrives on an
existing store the next time it is opened, additively and without touching a domain row. That
migration is **tested on a copy of a real existing store**, not asserted: packet P0 copies the
AxiomDB store to temporary storage and gates additive creation, refusal behaviour, non-mutation of
existing rows, and clean-publish rollback.

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
CREATE TABLE IF NOT EXISTS scope_reconciliations (
    id              INTEGER PRIMARY KEY,
    detected_sha    TEXT    NOT NULL,   -- resolved, 40 hex, from rev-parse <R>^{commit}
    tree_digest     TEXT    NOT NULL,   -- SHA-256 over the sorted NUL-joined tracked path set
    ledger_digest   TEXT    NOT NULL,   -- SHA-256 over the sorted NUL-joined (path, classification)
    tracked_paths   INTEGER NOT NULL,   -- |git ls-tree -r --name-only detected_sha|
    ledger_rows     INTEGER NOT NULL,   -- distinct file_ledger.file_path
    unledgered      INTEGER NOT NULL,   -- tracked with no ledger row
    absent          INTEGER NOT NULL,   -- ledger rows the tree no longer carries
    exempt          INTEGER NOT NULL,   -- tracked ∩ ledger with an exempting classification
    session_id      TEXT,
    detected_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scope_reconciliations_sha
    ON scope_reconciliations(detected_sha);

CREATE TRIGGER IF NOT EXISTS scope_reconciliation_is_immutable
BEFORE UPDATE ON scope_reconciliations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'scope reconciliation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS scope_reconciliation_cannot_be_deleted
BEFORE DELETE ON scope_reconciliations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'scope reconciliation cannot be deleted'); END;
```

Three properties of that block are load-bearing and were absent from an earlier draft.

**`IF NOT EXISTS` throughout.** `src/db.ts:85-88` states the contract — "The schema is written with
CREATE … IF NOT EXISTS throughout, so we can run it on every open" — and `:89` execs the file on
every `openDatabase`. 516 of `schema.sql`'s 517 `^CREATE` statements carry it, the single exception
being preceded by a `DROP VIEW IF EXISTS`. Bare DDL copied into that file throws on the second open
of any store. The same applies to §4.3's and §5.2's blocks.

**The triggers, not the prose, are what make the table append-only.** `schema.sql:2622-2627` is the
repository's established `<name>_is_immutable` / `<name>_cannot_be_deleted` pair, one of 269
triggers in that file. `GATE SR1` (§8.2) is red when a reconciliation row proves updatable or
deletable, and a table declared append-only only in a paragraph cannot satisfy it.
`decisions.md` §2 asks for substrate, not prose.

**The two digests, not the counts, are the witness.** Six integers cannot answer D2, which is a
*set* intersection, and they go stale silently: a later `set_disposition` or `add_files_to_scope`
changes the ledger without touching the row that claims to describe it. `tree_digest` pins the path
set the counts were taken over, and `ledger_digest` pins the ledger they were taken against, so
§3.3 can tell a standing reconciliation from a stale one.

It is a separate record rather than an inference over `scope_gaps` for one reason: a *perfectly*
reconciled store has zero `scope_gaps` rows, so "a gap row exists at R" would read a complete
reconciliation as a missing one. The count zero and the absence of a reading are different facts
and must be stored differently (VP4(e)).

`detect_changes` writes exactly one row per invocation, inside the transaction that rewrites
`scope_gaps`, and returns its id. Rows are never updated or deleted; the history of
reconciliations is itself the record of when the map was last checked against the tree.

### 3.3 "Reconciled at the checked revision", mechanically

A store is **reconciled at revision R** exactly when:

1. R resolves to a commit in the bound workspace, and R is normalized to the **full 40-hex**
   commit id it resolves to before any comparison — an abbreviation, a tag or a branch name is
   resolved first, never string-matched;
2. a `scope_reconciliations` row exists whose `detected_sha` equals that full sha;
3. `git_state.last_checked_sha`, normalized the same way, equals it;
4. the row's `tree_digest` equals the digest re-derived now from `git ls-tree -r --name-only <R>`;
   and
5. the row's `ledger_digest` equals the digest re-derived now from `file_ledger`.

The most recent such row is the **standing reconciliation**. `tracked_paths` from that row is
the denominator of every coverage fraction (§1.4). When no such row exists the store is
**unreconciled at R** and has no denominator.

**The tree at R, not the index.** `detect_changes` today enumerates `git ls-files`
(`mcp-server/src/tools/git.ts:220-222`), which reads the *index* — the working tree's staged state,
which moves under an unrelated `git add` and does not describe R's tree at all. It enumerates
`git ls-tree -r --name-only <R>` instead, which is R's immutable tree and the only object a
coverage fraction stamped with R may be taken over.

**Conditions 4 and 5 are what make the reading stand.** A reconciliation is a comparison of two
sets at a moment. Condition 4 catches R's tree being re-pointed under the row; condition 5 catches
the ledger changing after the row was written, which is the ordinary case — every subsequent
`add_files_to_scope` or classification change invalidates the standing reconciliation and the
store reverts to *unreconciled at R* until `detect_changes` runs again. That is the intended
behaviour: a store that has been edited since it last checked itself against the tree has not
checked itself against the tree.

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

### 3.3a Reconciled is weaker than complete, and only one of them licenses *fully surveyed*

Being *reconciled at R* says the ledger and the tree were compared and the record of that
comparison still stands. It does **not** say the comparison came out clean. A store that records
`unledgered = 501` accurately is reconciled; ADR-0001 clause 1 — "Every tracked path in the pinned
inventory has exactly one subsystem assignment or an explicit exclusion with owner and reason"
(`dev/adr/0001-living-conspectus-terms.md:19`) — is nevertheless false for it.

The two predicates therefore bind at different places, and an earlier draft collapsed them:

- **Advance to `mapped`** requires only *reconciled at R*. ADR-0001's per-subsystem clause is
  clause 2, not clause 1, and `README.md` §4 and `decisions.md` §1 both require a rebuild to be
  able to progress subsystem by subsystem. A subsystem cannot be held hostage to a path in some
  other subsystem's territory.
- **`materialize_docs`** and the **fully-surveyed predicate** require *reconciled at R* **and**
  `unledgered = 0` **and** `absent = 0` in the standing reconciliation — that is, clause 1 in
  full. Publication is the whole-store claim, and a published coverage fraction over a tree 501
  of whose paths nobody assigned or excluded is a fraction of a set the store never inventoried.

```
materialize_docs refuses: the standing reconciliation at <sha> reports <n> tracked path(s) with
no ledger row and <m> ledger row(s) the tree no longer carries. Every tracked path needs exactly
one subsystem assignment or an explicit exclusion with a reason before coverage over that tree is
published (ADR-0001, Fully surveyed, clause 1). get_scope_gaps names them.
```

§7.3's B1 asserts the same thing over the finished store, for the same reason.

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
**parsed** with `requireWorkspaceCitation(value, "first_seen", { strict: true })`; `ref_sha`, when
supplied, is resolved by `resolveWorkspaceCommit` and stored resolved.

**Parsing is not resolution, and the difference is the whole obligation.**
`requireWorkspaceCitation` (`mcp-server/src/helpers.ts:180-207`) takes `indexOf(":")` and
`lastIndexOf("@")` and validates the path *syntax*. It does not run git, does not resolve the
revision the token names, and does not ask whether the path exists in that revision's tree. A
`first_seen` of `src/nothing-here.ts:ghost@0000000` passes it. So `define_term` gains a third
step of its own, after the parse:

> **Resolve the anchor.** The token's revision is resolved with `resolveWorkspaceCommit`, and the
> token's path is looked up in that revision's tree with `git cat-file -e <sha>:<path>`. Both must
> succeed.

A term is **anchored** when all three hold: the token parses, its revision resolves, and its path
exists in the tree at that revision. Nothing else is anchored.

A `define_term` call that supplies a `first_seen` which does not resolve is **refused** — a
malformed anchor is a typo to fix, not a record to keep. A call that supplies **no** `first_seen`
is **accepted and stored unanchored**, because the codebase already holds four such rows in the
baseline and an existing survey path writes them; an unanchored term is simply a term that
discharges no obligation. §4.4's prerequisite, §7.3's B4 and the D10 measure all read *anchored*,
so an unanchored row is visible, countable, and worth nothing. Existing rows are never rewritten;
the predicate reads false for them until the term is redefined with an anchor that resolves.

### 4.3 The declination record

```sql
CREATE TABLE IF NOT EXISTS vocabulary_declinations (
    id            INTEGER PRIMARY KEY,
    subsystem_id  TEXT    NOT NULL,
    reason        TEXT    NOT NULL,   -- prose; why this subsystem carries no domain vocabulary
    session_id    TEXT    NOT NULL,
    ref_sha       TEXT    NOT NULL,   -- resolved, the revision the judgment was made at
    declared_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vocab_declinations_subsystem
    ON vocabulary_declinations(subsystem_id);

CREATE TRIGGER IF NOT EXISTS vocab_declination_is_immutable
BEFORE UPDATE ON vocabulary_declinations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'vocabulary declination is immutable'); END;
CREATE TRIGGER IF NOT EXISTS vocab_declination_cannot_be_deleted
BEFORE DELETE ON vocabulary_declinations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'vocabulary declination cannot be deleted'); END;
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

> The subsystem has at least one anchored `vocabulary` row **scoped to it**, or at least one
> `vocabulary_declinations` row **whose `ref_sha` still resolves in the bound workspace**.

```
cannot advance <sid> to 'structural': the structural pass neither defined a domain term for
this subsystem nor declared that it has none. Either define_term with a first_seen anchor
that resolves, or decline_domain_vocabulary with the reason none applies. One term is enough;
there is no quota, and "none" is a real and common answer that has to be said out loud.
```

Codebase-wide terms (`subsystem_id IS NULL`) satisfy no subsystem's obligation. A term that
belongs to everything tells a reader nothing about the subsystem that just advanced.

**Scoping is per `(term, subsystem)`, not per term.** `vocabulary.term` is the table's primary key
(`mcp-server/src/schema.sql:406`) and `define_term`'s upsert sets
`subsystem_id = COALESCE(excluded.subsystem_id, vocabulary.subsystem_id)`
(`mcp-server/src/tools/vocabulary.ts:36`). One term row can therefore be scoped to exactly one
subsystem, and re-defining a term shared between A and B for B **moves it off A** — silently,
after A has already advanced on it. A's discharge is revoked with no signal at the moment it
happens, and B4 (§7.3) turns red over the finished store with no way to see when it broke.

The fix is a `vocabulary_scopes(term, subsystem_id)` join table, declared with the same
`IF NOT EXISTS` and written by `define_term`: a term may be scoped to any number of subsystems and
`vocabulary.subsystem_id` is kept as the primary scope for compatibility with existing readers. If
the join table is judged too large a change for P3, the fallback is narrower and must be stated in
the same commit: `define_term` **refuses** to re-scope a term whose current `subsystem_id` names a
subsystem at `structural` or later that has no other anchored term, naming both subsystems in the
refusal. Silent revocation is the one outcome neither option permits.

**The declination's revision must still resolve.** §4.3 keeps declinations across a subsystem
reset, which is right — a ruled-out record is kept (GP18). But a kept record is history, and
history does not discharge a new pass. The prerequisite reads the **effective** declination: the
most recent row for the subsystem whose `ref_sha` resolves. Older rows, and rows anchored to a
revision the repository no longer has, render as history (§4.5) and satisfy nothing.

### 4.5 How the projection renders a declination

**Effective state first, history beneath it.** A subsystem can hold both anchored terms and a
declination — §4.3 deliberately permits a later pass to define a term without erasing the earlier
judgment — so the projection needs a precedence rule rather than two sections that each claim to
be the answer. The rule: **current anchored terms win.** A subsystem with at least one anchored
term renders its vocabulary section normally, and any declination renders *below it* under
`Superseded: this subsystem previously declared no domain vocabulary`, with its reason, session and
revision. A subsystem with no anchored term renders the declination as its vocabulary section. The
three states — terms, declined, not recorded — are never collapsed into two.

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
CREATE TABLE IF NOT EXISTS carried_findings (
    carried_id           INTEGER PRIMARY KEY,
    archived_finding_id  TEXT    NOT NULL,  -- the id in the archived store, e.g. 'B03-5'
    archived_store_id    TEXT    NOT NULL,  -- identity of the store it came from (§5.3)
    archived_anchor_sha  TEXT    NOT NULL,  -- that store's revision at export
    subsystem_id         TEXT    NOT NULL,  -- as recorded there; may not exist here
    severity             TEXT    NOT NULL CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
    symptom              TEXT    NOT NULL,
    root_cause           TEXT    NOT NULL,
    carry_run_id         INTEGER NOT NULL REFERENCES carry_runs(id) ON DELETE RESTRICT,
    archived_resolution  TEXT    NOT NULL CHECK (archived_resolution IN
                            ('open','accepted','ruled-out',
                             'fixed-pending-verification','verified-fixed')),
    archived_ref_sha     TEXT,
    primary_files        TEXT,              -- JSON array, as archived
    carried_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    carried_by_session   TEXT,
    UNIQUE (archived_store_id, archived_finding_id)
);

CREATE TABLE IF NOT EXISTS carried_finding_outcomes (
    id            INTEGER PRIMARY KEY,
    carried_id    INTEGER NOT NULL REFERENCES carried_findings(carried_id) ON DELETE RESTRICT,
    outcome       TEXT    NOT NULL CHECK (outcome IN
                            ('successor-finding','ruled-out','repaired','archived-terminal')),
    successor_id  TEXT,        -- findings.finding_id, required for 'successor-finding'
    repaired_sha  TEXT,        -- resolved commit, required for 'repaired'
    rationale     TEXT    NOT NULL,
    session_id    TEXT    NOT NULL,
    ref_sha       TEXT    NOT NULL,
    recorded_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_carried_outcome_one
    ON carried_finding_outcomes(carried_id);

-- The evidence join §5.4's `ruled-out` and `repaired` authority rules require.
-- An earlier draft named it and never declared it.
CREATE TABLE IF NOT EXISTS carried_finding_evidence (
    carried_id    INTEGER NOT NULL REFERENCES carried_findings(carried_id) ON DELETE RESTRICT,
    evidence_id   INTEGER NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
    role          TEXT    NOT NULL DEFAULT 'supports',
    attached_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (carried_id, evidence_id)
);

-- One row per invocation of the carry, including a reasoned empty one. Without
-- it "nothing was carried" and "nobody ran a carry" are the same reading (VP4(e)).
CREATE TABLE IF NOT EXISTS carry_runs (
    id                INTEGER PRIMARY KEY,
    source_kind       TEXT    NOT NULL CHECK (source_kind IN ('store','export','none')),
    source_path       TEXT,               -- NULL only for source_kind='none'
    archived_store_id TEXT,               -- NULL only for source_kind='none'
    archived_anchor   TEXT,               -- the archive's anchor revision
    reason            TEXT    NOT NULL,   -- required for every kind; the only field 'none' has
    expected_count    INTEGER NOT NULL,   -- findings the source declares
    imported_count    INTEGER NOT NULL,   -- carried_findings rows this run wrote
    session_id        TEXT,
    ran_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS carried_finding_is_immutable
BEFORE UPDATE ON carried_findings FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'carried finding is immutable'); END;
CREATE TRIGGER IF NOT EXISTS carried_finding_cannot_be_deleted
BEFORE DELETE ON carried_findings FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'carried finding cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS carried_outcome_is_immutable
BEFORE UPDATE ON carried_finding_outcomes FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'carried finding outcome is immutable'); END;
CREATE TRIGGER IF NOT EXISTS carried_outcome_cannot_be_deleted
BEFORE DELETE ON carried_finding_outcomes FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'carried finding outcome cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS carry_run_is_immutable
BEFORE UPDATE ON carry_runs FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'carry run is immutable'); END;
CREATE TRIGGER IF NOT EXISTS carry_run_cannot_be_deleted
BEFORE DELETE ON carry_runs FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'carry run cannot be deleted'); END;
```

`expected_count` and `imported_count` are separate fields so a partial carry is a visible
disagreement rather than a silent one; `carry_finding` refuses once `imported_count` is reached and
the carry refuses to finish while they differ.

**Both enums are declared in the contract, not inline.**
`mcp-server/contracts/conspectus-vocabulary.json` is the single enum source and
`scripts/gen-vocabulary.mjs --check-sql` asserts every `CHECK` literal in `schema.sql` matches it
(`:28-31` also generates `mcp-server/src/vocabulary.ts` and
`materializer/amanuensis_materializer/vocabulary.py`, both of which P3 and P4 therefore deliver).
So `carried_finding_outcome` is added to the contract with the four values above, and
`archived_resolution` takes its `CHECK` from the contract's existing `finding_resolution_state`,
whose five values are exactly the five an earlier draft wrote out in a comment. An enum declared
only in a `CREATE TABLE` body is invisible to `migrateVocabularyChecks` (`src/db.ts:154-192`),
which reads the columns to migrate from the contract's own `sql` mappings — so an inline `CHECK`
would never reach an existing store.

### 5.2a Reading and attaching

Two tools, because §7.4 step 6 promises a third-process read-back of the carried count and §5.4's
authority rules require an attachment surface, and an earlier draft named neither:

- **`attach_carried_evidence(carried_id, evidence_id, role?)`** — the `finding_evidence` shape,
  writing `carried_finding_evidence`. `role` defaults to `supports`.
- **`list_carried_findings(outcome?, subsystem_id?, limit?, cursor?)`** — a compact page of
  carried records: `carried_id`, `archived_finding_id`, `archived_store_id`, `severity`,
  `outcome` or `undecided`, and the first line of `symptom`. Default `limit` 25, hard maximum 100,
  and the response is truncated to the same 8192-byte envelope budget the other list tools observe,
  with `next_cursor` when it truncates. `symptom` and `root_cause` in full come from
  `get_carried_finding(carried_id)`, one record per call. A reader that must page is a reader that
  can page; a list tool that returns 22 full findings in one envelope is a tool nothing can call
  twice.

Carried findings live in their own table rather than in `findings`. A carried record is an
**obligation to decide**, not a finding this store confirmed; putting it in `findings` would let
it be counted as a defect this survey found, would collide with the successor's id, and would
make `finding_resolution_current` answer about a store that no longer exists.

### 5.3 Store identity

A carried record must name the store it came from, and the name must not change under it. That is
what candidate finding **B03-R1** asks for: a finding id with no store generation lets a rebuilt
store silently re-satisfy a closed reference.

**Minted, not derived.** Every store mints a `store_generation` — a random 128-bit value, rendered
as 32 hex characters — once, in `initializeSchema`, on the open that creates it, and stores it in a
single-row `store_identity` table declared with the same `IF NOT EXISTS` and the same immutability
triggers as everything else in §3.2. `archived_store_id` is `store-` plus the first 16 hex of that
value. It is written into the successor by the carry and never recomputed, because there is nothing
to recompute: identity is a fact the store carries, not a function of its mutable state.

An earlier draft derived it as the SHA-256 of `<repo_id>|<canonical_branch>|<onboarding_sha>|<last_checked_sha>`,
and that derivation fails in both directions. `set_git_state` lets any caller update
`last_checked_sha` — its own description reads "Subsequent calls may update any subset of fields"
(`mcp-server/src/tools/git.ts:91-96`) — so a store's identity changes every time it reconciles, and
an id written into a successor last week cannot be recomputed from the source today. And two
clean-slate rebuilds of the same repository at the same revision produce the same tuple, so they
**collide**: exactly the confusion the field exists to prevent.

**The legacy fallback, for the one archive that predates this.** The archived store at
`…/archive/store-7c1c1a9/memory.db` was frozen before `store_identity` existed and is immutable —
it cannot be given one now. For a source with no `store_identity` row, `archived_store_id` is the
SHA-256 digest of that store's `git_state` row, in the format above, truncated the same way and
prefixed `store-legacy-`. That derivation is sound *for an archive*, because an archive's
`git_state` is frozen along with the rest of it; it is unsound for a live store, which is why it is
available only when the source is opened `?immutable=1` and why the prefix says so. The baseline
store's row is `default | main | b8b566f | 61bc6b5c89f7c6b5091f9cb5df5e68cd969a3f27`; the fixture
(§7.2) records the resulting id so the gate compares an id rather than re-deriving one.

**The export must carry it.** An export cannot derive either form:
`old-findings-7c1c1a9.json`'s top-level keys are exactly `anchor`, `counts`, `exported_at`,
`findings`, `open_questions`, `source`, `subsystems`, and a substring search of the whole file finds
none of `repo_id`, `canonical_branch`, `onboarding_sha`, `last_checked_sha` or `git_state`. Its
`anchor` is `7c1c1a9f…`, the repository HEAD at export, which is not the archived store's
`last_checked_sha` `61bc6b5c…` and so is not a substitute. The export contract therefore gains a
required top-level `archived_store_id`, written by the exporter from the store it is exporting, and
`--carry-from <export>` **refuses** an export that lacks it, naming the field. Where the store
itself is available the carry verifies the two agree and refuses on a mismatch.

### 5.4 Who writes what

- **Reinitialization writes the carry.** `dev/rebuild-self-conspectus-store.mjs` gains a required
  `--carry-from <path>`, accepting either an archived store (read `?immutable=1`) or an export
  carrying `archived_store_id` under §5.3's contract. It refuses to reinitialize without one.
  `--carry-from none` is accepted **only together with `--carry-reason "<text>"`**, and the pair
  writes a `carry_runs` row with `source_kind='none'`, the reason, and both counts zero. Without
  the reason the driver refuses: "nothing to carry" is a judgment somebody makes, and an
  unreasoned empty carry is indistinguishable from a forgotten one. Every archived finding is
  carried, whatever its archived `resolution_state`, and `carry_runs.expected_count` records how
  many the source declared.
- **An archived terminal finding is pre-recorded `archived-terminal`, not `repaired`.** The three
  outcomes below are *authority-bearing*: each asserts something about **this** store, with a rule
  that says who may assert it and on what evidence. A finding the archive had already closed
  asserts nothing about this store — nobody here checked a commit or read a repaired path. The
  export's histogram is `open 13`, `verified-fixed 8`, `fixed-pending-verification 1`; pre-recording
  those 8 as `repaired` would put 8 rows into a state whose rule requires a resolving commit and an
  attached post-repair reading, with neither present. `GATE CF1` (§8.4) is red when
  `record_carried_outcome` does precisely that, so the carry would have been writing rows the
  gate exists to reject. `archived-terminal` carries the archived state and a rationale naming
  the archive, is terminal for §5.7's resolver and for clause 7 (§5.5), and is not writable by
  `record_carried_outcome` at all — only the carry writes it, and only for a finding the source
  records as `verified-fixed`, `ruled-out` or `accepted`.
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
    `carried_finding_evidence` row whose evidence `ref_sha` resolves and is a **descendant of or
    equal to** `repaired_sha`. "At or after" has no meaning on a Git DAG until it is said which
    relation is meant; this one is ancestry, tested with
    `git merge-base --is-ancestor <repaired_sha> <evidence_sha>`, so a reading taken on a sibling
    branch that never contained the repair does not discharge it. A claimed repair with no
    post-repair reading is `fixed-pending-verification` in ADR-0001's vocabulary, never a
    discharge.
  `archived-terminal` is written by the carry alone and is refused here, naming the carry as its
  only writer.

  One outcome per carried record (`idx_carried_outcome_one`), and outcomes are never deleted. A
  mistaken outcome is corrected by a new carried record from the same archive, which is visible.

### 5.5 The fully-surveyed refusal

ADR-0001's *fully surveyed* predicate gains a seventh clause:

> 7. Every carried finding has a terminal outcome. A store that discarded a prior conspectus is
>    not fully surveyed until it has decided what became of every open defect that conspectus
>    held.

Enforced at the whole-store predicate, **not** at `mapped` for the carried finding's subsystem,
per `README.md` §4's proposal: a rebuild must be able to progress subsystem by subsystem. The
obligation id shape is `carried:<archived_store_id>:<archived_finding_id>`, matching ADR-0001's
"every red has a destination" table.

**The whole-store predicate has no store-scoped implementation today, and this lane must write
one.** `dev/check-living-conspectus.mjs` is not it: `:723` resolves its fixture to
`dev/conspectus/self-baseline.json` and `main()` calls `evaluateConspectus(manifest)` over the
parsed JSON. It evaluates a **supplied manifest**, never an open store, and that manifest is the
immutable A0 historical fixture at `b8b566f` which `design/reader-lenses/spec.md` §12.3 forbids
retargeting or regenerating — `dev/test-living-conspectus.mjs:8-15` imports the same
`evaluateConspectus` and mutates the same fixture. Nor does the server carry the predicate:
`grep -rn "fully.surveyed\|fullySurveyed" mcp-server/src/` returns one hit, `vocabulary.ts:1296`,
which is the phrase inside a word list. Clause 7 added to a predicate with no store-scoped
implementation would be vacuous wherever it was enforced.

So P4 delivers `dev/check-store-fully-surveyed.mjs`: the six existing clauses plus clause 7,
evaluated against an **open store** read-only, emitting the same obligation ids, with clause 7's
census enumerating every `carried_findings` row from the store itself. §7.3's B6 uses the same
census over the store or, in CI where no store exists, over the acceptance receipt's carried table.
`dev/check-living-conspectus.mjs` keeps reading the frozen A0 fixture and is not retargeted.

```
not fully surveyed at <sha>: <n> carried finding(s) have no terminal outcome —
<archived_id> (<severity>, from <store-id>), … . Each must be re-found as a successor
finding, ruled out with evidence collected in this store, or marked repaired at a commit
that resolves. A discarded defect is not a decided one.
```

### 5.6 What the projection shows

This section is delivered by **P6**, not by P4: it is renderer and read-back work, and P6 is the
projection packet. P6 therefore depends on P4 as well as P2 and P3, and `readback.py` gains a
carried-record census beside the ones it already runs — `_finding_partition_census`,
`_ledger_stale_census` and `_locus_index_census` (`readback.py:252-262`) enumerate findings, stale
entries and the locus index from the database and none of them sees a carried row.

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
2. Otherwise `carried_findings` where `archived_finding_id = <id>`. The table is unique by
   `(archived_store_id, archived_finding_id)`, so an id alone can match rows carried from two
   different archives. **An ambiguous match is a refusal, never a choice**: the resolver exits 2
   (`cannot run`) with stderr `<n> carried records share that id; qualify it as
   <store-id>:<finding-id>`, and it accepts the qualified form as its argument. Picking the newest,
   or the first, would let one archive's decision answer for another's defect. With exactly one
   match:
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
   `--carry-from ~/.claude/automations/amanuensis-clean-slate/archive/store-7c1c1a9/memory.db`,
   the archived **store**, opened `?immutable=1`.

   Not the export. `old-findings-7c1c1a9.json` carries all 22 findings with `resolution_state`,
   `symptom`, `root_cause`, `primary_files` and `ref_sha`, but it carries no store identity and
   predates the contract field §5.3 adds, so the carry could not name the store the records came
   from — the one thing §5.3 exists to record. The archived store carries every field the export
   does (`findings` holds `finding_id`, `subsystem_id`, `symptom`, `root_cause`, `severity`,
   `status`, `primary_files`, `ref_sha`, `pass_type`, and `finding_resolution_current` supplies
   `resolution_state`) **and** the `git_state` row from which the legacy `archived_store_id`
   derives. `carry_runs` records `source_kind='store'` and that path.
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
| `references/phase-1-scope.md` | §3 Seed vocabulary, `:53-58` | The `define_term` call gains the anchor obligation: `first_seen` must be a `file:symbol@sha` whose revision resolves and whose path exists there, or the call is refused. |
| `references/phase-2-structural.md` | §1, `:24` | The same, where `define_term` is first named. |
| `references/phase-3-concerns.md` | `:120` | The same, where `define_term` is named again. |
| `.claude/skills/amanuensis/SKILL.md` | the refusal summary | One line per new refusal. |

No sentence is removed that describes a behaviour that still exists. Nothing in the references
is softened.

The last three rows are the correction to an eight-entry register that named only the passage a
refusal was *designed* against. `phase-1-scope.md:58` instructs
`define_term(term, gloss, expansion, subsystem_id, first_seen, ref_sha)` — a call the server will
start refusing — and it was absent; so were `phase-2-structural.md:24` and
`phase-3-concerns.md:120`. A caller that a change breaks is an affected caller wherever it lives,
and §6.2's inventory is what finds the next one.

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

**The candidate set is derived, so an omission is a finding rather than silence.** A register
compared only against itself cannot report what nobody wrote down — §8.7 records that false green,
and `phase-1-scope.md:58` is the proof it was already happening. So the check gains a third
assertion with a generated left-hand side: `check-refusal-parity.mjs` scans
`mcp-server/src/invariants.ts` and `mcp-server/src/tools/*.ts` for `ToolError` messages beginning
`cannot advance`, `refuses:` or `requires`, and reports every such message with no register entry
whose `server.phrase` occurs in it. It also reports every skill reference that names a tool whose
handler throws a registered refusal and that carries no registered phrase — which is what finds
`phase-1-scope.md`.

That derivation is lexical and it is not complete: a refusal phrased outside those three openings
is invisible to it, and §8.7 says so. It converts the failure mode from *silent* to *narrower*,
which is the honest claim. The packet's acceptance requires the register to name all four new
refusals plus the two existing ones the lane touches, and requires the derived set to be empty.

**An entry names its tools in two roles, and the source is asked about both.** `refuses` lists
the advertised tools the server states the sentence at — thrown from the handler, through
whatever that handler calls or names, or documented in the tool's own definition — and
`instructs` lists the tools a reference calling them must warn about and which do not refuse
themselves. Their union is what the reference-side scan searches the skill for. A fifth
assertion checks each name against the source in both directions: a tool filed as refusing
whose handler never states the sentence, and a tool filed as merely instructing it that throws
it, are both findings. One field held both roles until slice-S3's review, and nothing compared
it to a call site: `active-session-required` named `start_session`, the repair, whose handler
starts a session, while every tool that throws the requirement was absent. `refuses` is held to
being true rather than to being complete — roughly fifty handlers call `requireActiveSession`,
and a register enumerating them would oblige every reference naming any of the fifty to quote
the sentence. The derived scan above is what covers a refusal no entry carries at all.

The set of advertised tools this rests on is read as the tool-definition shape
`scripts/gen-tool-inventory.mjs` reads — a `name` published with a `description` and an
`inputSchema` — not as a bare `name:` key, which these modules also use for response sections
and which advertised eleven fields the server never exposed.

---

## 7. Acceptance rebuild

### 7.1 The depth gate, `GATE D0` — `dev/test-survey-depth.mjs`

It prints `GATE D0 GREEN`, `GATE D0 RED: <reason>` or `GATE D0 CANNOT RUN: <reason>` as its single
last stdout line, under §8.0's protocol. `GATE D1` (§8.5) is the gate *for* it. Under §8.0 clause 4 that control gate **is**
D0's red proof for its live-store arm; the receipt arm still takes a tree-bound red.

Two arms, for the reason `dev/test-rebuild-depth.mjs:20-27` gives: the store is untracked
(`git ls-files .amanuensis` returns 0), so a gate that only read a live store would be green by
absence in CI.

- **Baseline arm.** Reads `dev/survey-depth-baseline.json` (§7.2). Red if it is absent, is not
  valid JSON, does not declare its contract, or does not bind itself to the archived store's
  identity (§5.3) and anchor.
- **Candidate arm.** Reads the live store at `.amanuensis/memory.db` when one is present, and
  otherwise the committed acceptance receipt (§7.5). When both are present it asserts both and
  requires them to agree; a receipt nobody can contradict is a claim about a claim. When
  **neither** is present the arm is `cannot run` and the gate exits **2**, printing
  `GATE D0 CANNOT RUN: no live store and no committed acceptance receipt`. That is a third state,
  distinct from red and from green, and it is the state CI is in between the packet that
  registers this gate and the packet that writes the receipt. Without it the gate is knowingly
  red for three packets and stops being a signal for any of them; with it the absence is
  reported as an absence, which is VP4(e) applied to the gate's own inputs.

  `GATE D1` (§8.5) asserts that the arm reaches `cannot run` — not green — in that window, so the
  third state cannot be used to hide a real red.

- **Blocking predicates.** The twelve measures are the comparison layer. The six predicates B1–B6
  of §7.3 are evaluated separately, over rows rather than over counts, and they are what turn the
  gate red. §7.2's fixture and §7.5's receipt keep them under their own keys for that reason.

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

**`--check` must be able to say it cannot run.** The archive lives at
`~/.claude/automations/amanuensis-clean-slate/archive/store-7c1c1a9/memory.db`: a machine-local
absolute path outside the repository. On CI, on another machine, or after the archive is moved,
`node dev/record-survey-depth-baseline.mjs --check` exits **2** with
`cannot run: the archived store is not readable at <path>`. It never exits 0. A `--check` that
silently passes where it cannot read its source is the zero-denominator green this repository has
recorded three times, and a check whose only honest answer off this machine is "green" is not a
check. It is in P5's regression list and in `completion.commands` so the exit-2 path is exercised
by the launcher rather than assumed.

### 7.3 What turns the depth gate red

Blocking, per §1.6:

1. **B1 Reconciliation and complete inventory.** The candidate is reconciled at its checked
   revision under §3.3's five conditions; the standing reconciliation's `unledgered` and `absent`
   both equal the counts re-derived from `git ls-tree -r --name-only` at that revision; **and both
   are zero**. A store whose record disagrees with the tree is red, and so is one whose record
   agrees with the tree and says 501.

   The zero is not extra strictness, it is ADR-0001 clause 1
   (`dev/adr/0001-living-conspectus-terms.md:19`): "Every tracked path in the pinned inventory has
   exactly one subsystem assignment or an explicit exclusion with owner and reason." An earlier
   draft required only that the recorded count match the tree, which a correctly recorded 501
   satisfies — and 501 is exactly the candidate's number. The acceptance rebuild claims to be
   fully surveyed; clause 1 is part of what that means. §3.3a binds the same predicate at
   publication, where the rebuild meets it first.
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

**Every predicate is recomputed, never read.** B1–B6 are evaluated over rows — the reconciliation
row and a fresh `git ls-tree`, each disposition with its attachments' `ref_sha` values, each
subsystem with its anchored terms and effective declination, each carried record with its outcome.
Where the candidate arm reads the receipt rather than a live store (§7.1), it recomputes them from
the **row-level witnesses** §7.5 requires the receipt to carry, and **never** from a recorded
verdict field. A gate that reads a receipt's `"verdict": "green"` validates a self-report; that is
the false green `GATE A1` seeds a forged receipt against (§8.8).

The gate prints the denominator beside every fraction and treats a zero denominator as
out-of-band, not as a pass (VP4(e)).

### 7.4 The acceptance rebuild

Steps 1–7 of onboarding belong to **P8**, the per-subsystem survey and the carried adjudication
(steps 7–8) to **P10**, and publication, promotion and the receipts (steps 9–10) to **P11**. One
packet for all of it was a 300-minute budget over a rebuild that must reach at least 361 examined
paths where its predecessor reached 84.

The lane's rebuild packets run, in **this worktree**, the recipe of
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
with every reported axis printed. Plus, still green: `dev/test-rebuild-coverage.mjs`,
`dev/test-reader-lenses-dogfood.mjs`, the full CI list, and `dev/test-rebuild-readback.mjs` as P4
updated it (§8.10).

The result is recorded in `design/survey-depth/acceptance-receipt.json`, written by
`dev/record-survey-depth.mjs` and committed, carrying: the contract string
`amanuensis-survey-depth/acceptance-receipt/v1`; the repository sha; the store identity and
checked revision; every blocking axis with its value, its baseline and its verdict; every
reported axis with its delta; per-subsystem status, disposition count and attached count; the
carried-finding table with each outcome; and the reconciliation record.

Plus the **row-level witnesses** without which B3 and B4 cannot be recomputed from it:

- **B3** — one row per disposition: `subsystem_id`, `concern_code`, the subsystem's status, and
  the `ref_sha` of every attached evidence row with whether each resolved at write time. Aggregate
  attached counts cannot answer "does *this* disposition carry a resolvable row".
- **B4** — one row per subsystem: its anchored terms with each term's `first_seen` token, and its
  effective declination's `id`, `ref_sha` and `session_id`. A per-subsystem boolean cannot answer
  which record discharged it.
- **B1** — the standing reconciliation's `detected_sha`, `tree_digest` and `ledger_digest`, so the
  digests can be re-derived at any later revision that still has the tree.
- **B5/B6** — the full carried table with `archived_store_id`, `archived_finding_id`, outcome, and
  for `repaired` the `repaired_sha` and the attached evidence revisions.

That is what makes this a baseline for the *next* rebuild rather than a one-time report: the
comparison is repeatable at any later revision without the live store, and repeatable by
recomputation rather than by trust. The gate's receipt arm asserts the same predicates over the
receipt that its live arm asserts over the store.

---

## 8. Gates

Every gate is a new file, prints `GATE <id> RED: <reason>` on failure and `GATE <id> GREEN` on
success as its single last stdout line, scrubs launcher crash signatures from its messages
(`dev/test-rebuild-depth.mjs:176-196`), names a must-stay-green control, states in its header the
false green it cannot exclude, and is added to `.github/workflows/test.yml`.

### 8.0 The red commit protocol

Every gate in this specification is a **new file**. Left to itself, each packet's red commit would
therefore fail by `MODULE_NOT_FOUND` — the test does not exist yet — and a launcher watching only
for a nonzero exit would accept that as the gate's red proof. It is not one. A missing file proves
the file is missing; it proves nothing about whether the assertion inside it can fire, which is the
only thing a red proof is for. This is VP4(f)'s "a kill proves a gate *can* fire, never that it
fires *selectively*", one step earlier: an absent file does not prove even that.

**The launcher enforces, and every packet's gate must satisfy:**

1. **At the red commit** the gate file **exists and runs**. It exits non-zero, prints
   `GATE <packet-id> RED: <reason>` as its last stdout line, and its output contains **no crash
   signature** — none of `MODULE_NOT_FOUND`, `Cannot find module`, `ENOENT`, `SyntaxError`,
   `ReferenceError`, `TypeError`, `is not a function`, `command not found`, `ModuleNotFoundError`,
   `ImportError`. The red commit therefore ships the **complete test**, including its fixtures and
   its must-stay-green control, against the **unchanged** implementation.
2. **At HEAD**, after the implementation lands, the same command exits 0 and prints
   `GATE <packet-id> GREEN`.
3. **A `cannot run` is never accepted as the red.** Three gates here declare a third state and
   exit **2**: `GATE D0` (§7.1) when there is neither a live store nor a committed acceptance
   receipt, `GATE XS1` (§8.0a) when the source store is unreadable on this machine, and
   `GATE CR1` (§8.9a) when the archived store is unreadable. All three exit non-zero, so an exit
   code alone cannot separate a refusal to measure from a measurement. The launcher's test is a
   conjunction — non-zero **and** a last line beginning `GATE <packet-id> RED:` — so a `cannot run`
   fails it, and that is the intended behaviour rather than a launcher fault: a gate that could not
   read its inputs has asserted nothing, and accepting it would reproduce the `MODULE_NOT_FOUND`
   error one level up, with the gate's *inputs* absent instead of the gate's *file*. The red proof
   is therefore taken where those inputs are present, and each such gate names what its red
   requires: XS1 a readable copy of the AxiomDB store, CR1 the readable archived store at
   §7.2's path, and D0 the live store at `.amanuensis/memory.db` that **P8** initializes in this
   worktree — untracked (`git ls-files .amanuensis` → 0), so D0's red proof is machine-local, and
   in a clean checkout the same commit reports `cannot run`. A packet whose red proof needs an
   input the machine does not have is blocked, not waived.

4. **A requirement the context makes impossible or vacuous does not apply** — owner ruling,
   2026-09-17. Clauses 1 and 2 assume the gate's red condition is a property of the **tree**.
   Where it is a property of an **untracked live store**, the launcher cannot take that proof:
   `verify_packet` checks the red commit out into a fresh detached worktree that has no
   `.amanuensis`, and it runs the red arm and the HEAD arm against the same store minutes apart,
   so no live-store property can differ between them. Requiring it yields either a `cannot run`
   the launcher rejects or a tree-bound stand-in that proves something else. For such a gate the
   clause 1 and 2 proof is **discharged by a named control gate** that seeds each red condition
   into a synthetic store and asserts the gate fires on it, itself verified under clauses 1 and 2
   in its own packet. For `GATE D0` that control is `GATE D1` (§8.5), verified in **P5**. The
   packet declares `gate.red_proof` naming the control packet and gate; the launcher then
   requires that control packet to be `done` and launcher-verified with its gate green at HEAD,
   and does not require the packet's own red commit to make a live-store property differ. Nothing
   is waived in silence: a declaration naming no control, or naming one that is not verified, is
   refused, and the exemption reaches only the live-store arm. A gate whose red condition **is**
   tree-bound keeps clauses 1 and 2, `GATE D0`'s receipt arm included wherever a receipt is
   committed.

**What this requires of every red condition in §7.3 and §8.1 to §8.9b.** Each must name the *assertion* that
fires — the call that should have been refused and was not, the row that should have been
unwritable and was written — and must be reachable against the implementation as it stands before
the packet. "The test file is absent" is not a red condition and is not accepted as one. Where a
red condition depends on a table the packet itself creates, the test creates that table in its own
fixture so the assertion is about behaviour rather than about schema arrival; where it depends on a
tool the packet itself adds, the red arm asserts the tool is **absent from `tools/list`**, which is
an assertion the gate can make and print.

Each packet's `gate.red_expect` in `plan.json` quotes the first line of the reason its red prints,
and `gate.red_rejects` carries the crash signatures above.

**What the launcher verifies, and the one gate it does not.** The protocol above is checked against
each packet's `gate` field in `plan.json`, and the plan carries exactly one such field per packet,
with no two packets sharing a test path. Eleven of the twelve packet gates are specified in this
section; the twelfth is `GATE D0`, whose red conditions are §7.3's B1–B6 and whose red at **P10**
is a property of the surveyed store, not of a missing file — its file is a **P5** deliverable and
already exists at P10's red commit. `GATE CF2` is the only gate this specification declares
that is not a packet gate: §8.9 places it in **P4**, whose gate field is `GATE CF1`. CF2's red is
therefore shipped and proved inside P4's red commit and checked by P4's acceptance, and it runs as a
regression command from P8 onward — a weaker proof than every other gate here receives, recorded
here rather than left to be discovered.

**Every packet re-runs the gates it depends on.** A packet's regression list contains the gate
command of every packet it transitively depends on. Without that closure a gate goes red in the
packet that broke it and is not run again until some later packet happens to list it, so the red is
attributed to the wrong change and discovered at the wrong time — the failure the reader-lenses lane
recorded when its `P2` gate had been red since `P8`. The serialized S1 packets share
`mcp-server/src/invariants.ts`, `src/schema.sql` and `src/db.ts`, which is the coupling that makes
the closure load-bearing rather than ceremonial. `GATE CF2` remains the one
exception, for the reason just given: it is not a packet gate and runs as a regression command from
**P8** onward.

### 8.0a `GATE XS1` — `mcp-server/test-existing-store-migration.mjs`

**Red when:** opening a copy of an existing populated store rewrites, deletes or re-derives any
`dispositions`, `evidence`, `disposition_evidence`, `file_ledger` or `vocabulary` row — asserted by
a row-level digest taken before and after; a second open of the same copy throws, which is what bare
`CREATE TABLE` in `schema.sql` does (`src/db.ts:85-89`); any table this lane adds is absent after the
open; an `UPDATE` or `DELETE` on one of those tables succeeds; a subsystem holding an unattached
disposition advances; or `materialize_docs(clean_publish=true)` alters the previous output on a
refused run. Control: a copy whose dispositions are all attached advances and publishes. Reports
`cannot run` — never green — when the source store is unreadable on this machine.

**False green it cannot exclude:** it tests the AxiomDB store's shape, which is one existing store.
A store with a shape neither it nor the fixtures cover migrates untested. That shape was chosen
because it is the adversarial one available: 295 ledger rows over 187 distinct paths with 53
multiply owned, 1718 scope gaps, 54 unattached dispositions, and 35 `deferred-with-reason` paths.

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
the row's counts disagree with a re-derivation from `git ls-tree -r --name-only <R>` in the fixture
repo; an `UPDATE` or a `DELETE` on a `scope_reconciliations` row succeeds; a reconciliation row
whose `detected_sha` is an abbreviation satisfies a full-sha comparison, or the reverse; a store
with **duplicate ledger ownership** — one path owned by two subsystems, which the AxiomDB store
holds for 53 of its 187 distinct paths — reconciles without reporting it; a **correct but nonzero**
`unledgered` count publishes (§3.3a); the index and the tree disagree and the reconciliation
follows the index; a reconciliation stands after the ledger has been mutated under it; an advance
to `mapped` succeeds on an unreconciled store; `materialize_docs` renders on an unreconciled store;
or a reconciliation at revision A satisfies a publication at revision B.
Control: a reconciled store with zero unledgered and zero absent paths advances and publishes.

**False green it cannot exclude:** that the unledgered paths were *assigned well*. Reconciliation
proves the ledger and the tree were compared, not that a file landed in the right subsystem.

### 8.3 `GATE VD1` — `mcp-server/test-vocabulary-discharge.mjs`

**Red when:** `define_term` stores a `first_seen` that is not a citation token; one whose revision
is **malformed** (not 7–40 hex); one whose revision is well-formed but **unreachable** in the bound
workspace; one whose revision resolves but whose **path does not exist in that revision's tree** —
the case `requireWorkspaceCitation` cannot see, since it runs no git at all
(`src/helpers.ts:180-207`); or one whose `ref_sha` **mismatches** the revision inside its own
`first_seen` token. Also red when `define_term` runs without an active session; when re-scoping a
term **silently revokes** another subsystem's discharge (§4.4); when an advance to `structural`
succeeds for a subsystem with neither an anchored term nor an effective declination; when a
codebase-wide term satisfies a subsystem's obligation; when a declination whose `ref_sha` no longer
resolves satisfies one; when `decline_domain_vocabulary` succeeds for a subsystem that has an
anchored term; or when a declination row proves updatable or deletable.
Control: a subsystem with one **valid anchored** term advances — the anchor's revision resolves and
its path exists in that tree — and so does one with only a declination whose `ref_sha` resolves.

**False green it cannot exclude:** whether the declination is *true*. "This subsystem has no
domain vocabulary" is a judgment; the substrate can require that it be made, attributed and
dated, and cannot check it. That is the discharge-or-decline design accepting GP8's scope limit
rather than pretending past it.

### 8.4 `GATE CF1` — `mcp-server/test-carried-findings.mjs`

**Red when:** reinitialization runs without `--carry-from`; `--carry-from none` is accepted
without `--carry-reason`, or is accepted and writes no `carry_runs` row; a carry finishes with
`imported_count` unequal to `expected_count`; a carried record is writable twice for the same
`(archived_store_id, archived_finding_id)`; `record_carried_outcome` accepts `ruled-out` with no
current-session evidence attached through `carried_finding_evidence`, `repaired` with an
unresolvable sha or with evidence whose revision is **not a descendant of or equal to**
`repaired_sha`, `successor-finding` naming an absent finding, or `archived-terminal` at all; a
second outcome is accepted for one carried record; a carried record, outcome or carry run proves
updatable or deletable; an export lacking `archived_store_id` is accepted as a carry source; or the
store-scoped fully-surveyed predicate returns true with an undecided carried record — asserted over
a store holding a **nonempty** undecided set, so the clause cannot pass by having nothing to check.
Control: a store whose carried records all have terminal outcomes is fully surveyed on that clause,
and one whose only outcomes are `archived-terminal` is too.

**False green it cannot exclude:** whether the successor finding is *the same defect*. The
substrate records that a decision was made with an anchor; a session that files an unrelated
finding as the successor satisfies it. §5.6's projection exists so a reader can check.

### 8.5 `GATE D1` — `dev/test-survey-depth-red-gates.mjs`

The gate *for* the depth gate. **Red when:** `dev/test-survey-depth.mjs` fails to turn red on
each of B1–B6 seeded independently into a synthetic store; when it turns red on the must-stay-
green control store; when it reports green with an absent or unreadable baseline; when it reports
green with neither a live store nor a committed receipt, rather than exiting 2 `cannot run` (§7.1);
when it reports a blocking verdict read from the receipt's recorded verdict field rather than
recomputed from §7.5's witnesses; when it reports a fraction without its denominator; when
`dev/record-survey-depth-baseline.mjs --check` exits 0 with the archive unreadable rather than
exiting 2; or when it is absent from CI. One seeded fault per axis, each
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
Two controls, because one fixture cannot carry both halves. **(a)** A reconciled store with
**zero** unledgered paths renders exactly the numbers it renders today, asserted byte-for-byte
against a committed fixture. **(b)** A reconciled store with unledgered **greater than zero**
renders against the *new* denominator, with the old value recorded in the gate's header as the
intended change. The second fixture is not optional: today's "Files read, of those carrying an
obligation" denominator is `obligation_files`, computed at `renderers.py:415` as
`SUM(CASE WHEN {OBLIGATION_BEARING_SQL} …) FROM file_ledger` — over ledger rows — and read at
`:630`. §3.4 moves it to D2 over the standing reconciliation, and the two differ by exactly the
unledgered count. A byte-identical control is therefore satisfiable **only** on a zero-unledgered
fixture, which is the one store shape this change does not affect: the control as first written
could not have failed.

**False green it cannot exclude:** it asserts the rendering of a store it is handed. A
reconciliation record that is itself wrong renders faithfully and wrongly; `GATE SR1` owns that.

### 8.7 `GATE RP1` — `mcp-server/test-refusal-parity.mjs`

**Red when:** `check-refusal-parity.mjs` passes after a registered phrase is deleted from a
reference, or from the server file; when the register names a file that does not exist; when it
is empty; when it is absent from CI; when a refusal added to a tool handler or to
`invariants.ts` is reported by no derived candidate; when an entry binds a refusal to a response
field rather than to an advertised tool; or when an entry files a tool as refusing that never
states the sentence, or as instructing one that does. Control: the register at HEAD passes, and
the count of tools the check reads equals the count `tools/list` advertises.

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

**Control:** the committed receipt at HEAD, bound to this repository and to the acceptance store,
validates — and is the only receipt that does. Paired with it, a **seeded forged-green receipt**:
a copy of the valid receipt whose B2 `verdict` is flipped to `green` while its recorded
`examined_fraction` stays below the baseline, and a second copy whose per-disposition witness rows
name a `ref_sha` that does not resolve while its B3 verdict reads green. A1 must turn red on both.
A1 was the only gate in this section with no control, which is the failure VP4(f) names: a gate
whose green nothing can distinguish from a gate that always greens.

**False green it cannot exclude:** a receipt proves what was true when it was written. The live
arm narrows the window only where a store exists to read, which in CI it does not.

### 8.9 `GATE CF2` — `dev/test-carried-finding-references.mjs`, in **P4**

Every red condition below is a property of `dev/pecia-resolve-finding.mjs`, which P4 delivers. A
gate asserting P4's behaviour cannot prove P9's: by the time P9 starts, the resolver has shipped
and the gate is green on its first run, with no red commit available to it. It therefore belongs
to P4, whose red it does prove. P9 keeps a gate of its own, `GATE PA1` of §8.9b, which is P9's own
deliverable and its own claim.


**Red when:** `dev/pecia-resolve-finding.mjs` exits 0 for an id whose only record is an undecided
carried finding; exits 1 for an id whose carried record has a `ruled-out` or `repaired` outcome;
fails to follow `successor-finding` into the successor and answer with *its* state; prints its
argument on any path; or returns an exit code outside {0,1,2}. Control: an id with a live
`verified-fixed` finding still exits 0, and an unknown id still exits 1.

**False green it cannot exclude:** `pecia audit` reports only *closed* Pecia records whose
reference stopped resolving. An open Pecia record pointing at a destroyed finding is still
invisible to the audit; this gate makes the resolver honest, and the remaining gap is candidate
finding **B03-R2**, which the acceptance rebuild must carry forward rather than close.

### 8.9a `GATE CR1` — `dev/test-carry-receipt.mjs`, in **P8**

**Red when:** `design/survey-depth/carry-receipt.json` omits any finding id the archived store
holds; records a `carried_id` that no `carried_findings` row has; records an archived resolution
state that disagrees with the archive's own row for that id; or reports a row count that differs
from the `carry_runs` row's `expected_count` and `imported_count`. Control: a receipt written from
the archived store with all 22 ids present, every `carried_id` resolving, and 22 = 22 = 22 is green.
Reports `cannot run` — never green — when the archived store is unreadable on this machine.

**False green it cannot exclude:** the receipt is checked against the archive it names. A carry that
named the wrong archive produces a receipt that is internally consistent and wrong; only the
`archived_store_id` of §5.3 separates the two stores, and this gate trusts that field rather than
re-deriving it.

### 8.9b `GATE PA1` — `dev/test-pecia-carry-audit.mjs`, in **P9**

**Red when:** `dev/pecia-dogfood.md` leaves a closed Pecia record unaccounted — any of the eight
whose reference stopped resolving (`pc-1a91`, `pc-207e`, `pc-707e`, `pc-80b8`, `pc-833d`,
`pc-adce`, `pc-ae87`, `pc-d688`), each of which must name the carried record and its outcome — or
accounts for one by naming a `carried_id` that no `carried_findings` row has. Control: a dogfood
document naming all eight, each with a resolving carried id, is green.

**False green it cannot exclude:** `pecia audit` enumerates only *closed* records whose reference
stopped resolving. An open Pecia record pointing at a destroyed finding is outside those eight and
outside this gate; that gap is candidate finding **B03-R2**, which the acceptance rebuild carries
forward rather than closes.

### 8.10 Gates that must stay green, unchanged

`dev/test-rebuild-coverage.mjs`, `dev/test-reader-lenses-dogfood.mjs`,
`dev/test-living-conspectus.mjs`,
`dev/check-living-conspectus.mjs`, `mcp-server/test-invariants.mjs`,
`mcp-server/test-derived-staleness.mjs`, `mcp-server/test-locus-standing.mjs`,
`mcp-server/test-finding-partition.mjs`, and the materializer's seven Python gates. No axis of
any of them is weakened or removed.

**Two existing gates change, and only by widening.**

`dev/test-rebuild-depth.mjs` hard-codes `CHECKLIST_CONCERNS = ["BV-1","CC-1","EV-1","GT-1","RC-1","ZD-1"]`
(`:104`) and a finding-id shape `<subsystem-id-compact>-<N>` that the clean-slate survey
deliberately did not use (candidate finding **B07-R2**). Both literals move out of the test body —
but **not** into `design/reader-lenses/rebuild-coverage-receipt.json`, which an earlier draft named.
The comment at `:19-24` states the property that would destroy: "Every denominator this gate counts
against is read from a *different* committed document than the one under test … A numerator and its
denominator that shrink together prove nothing (GP24)." That independence is real today — the
coverage receipt's `repository_sha` is `dee59d3e…` and it was written by P17 of the reader-lenses
lane — and it survives only while the rebuild packet does not rewrite it. So:

- The checklist moves to **`mcp-server/contracts/concern-checklist.json`**, a standalone committed
  contract regenerated only by an explicit onboarding-calibration step and `--check`ed in CI. The
  id convention moves beside it. Neither is a receipt and neither is rewritten by a rebuild.
- `design/reader-lenses/rebuild-coverage-receipt.json` is **removed from the rebuild packets'
  deliverables**. It stays a document a different run produced, which is the whole of its value
  here.

Its remaining assertions, including `a disposition carries no attached evidence`, are untouched:
that assertion is this lane's own thesis and it was already right.

**Its green requirement does not apply, and this is what discharges it instead** — owner ruling
(`decisions.md` §7), applied 2026-09-18 after P11 attempt 2 established that no survey work can
meet it. Three assertions read their denominators from `design/reader-lenses/rebuild-coverage-receipt.json`,
the independence this section protects, and that document describes the store **P17** surveyed,
which §7.4 steps 2 to 4 delete. `:443-446` refuses any subsystem outside P17's eight and this
rebuild has nine; `:761-769` requires the receipt's adversarial targets to equal P17's claim keys
exactly, and this store's eleven claims are under none of them, so its two clauses cannot both
hold; `:936-953` reads batch priorities from P17's receipt and refuses a revisited subsystem. The
numerator now describes one store and the denominator another, so the requirement is not
unfinished work, it is unsatisfiable. It therefore does not bind, and the obligation is discharged
by all three of:

1. **The property is still asserted for this rebuild**, by `GATE D0` (§7.1) and `GATE A1` (§8.8)
   over the frozen baseline fixture (§7.2) and this lane's acceptance receipt (§7.5) — two
   documents written by different runs, which is the independence §8.10 was protecting.
2. **The reader-lenses gate keeps its own subject.** Its P17-denominated arms report
   `cannot run` and exit 2 — never green, and never a red that blames this store for not being
   the other one — when the depth receipt under test does not describe the store the coverage
   receipt describes. That is the identity check P8 already applied to `dev/test-rebuild-coverage.mjs`
   and `dev/test-reader-lenses-dogfood.mjs`, and the third state §7.1 already defines. Every
   assertion that does not depend on P17's sets keeps firing over whatever receipt is committed.
3. **A control proves the arms still fire.** The historical pair — P17's coverage receipt and the
   depth receipt as committed before the clean-slate rebuild — is replayed from git history into a
   temporary tree and must reach the verdicts it reached then; and a receipt relabelled to claim an
   identity it does not have must turn the arm **red**, not `cannot run`. Without that control the
   identity check is indistinguishable from an exemption.

This is scoping, not weakening: no axis is dropped for the subject the gate can still speak about,
and CI must end green — say there how the third state is handled, the same way §7.1 answers it
for `GATE D0`.

**Which receipt stays, decided in P11 attempt 3.**
`design/reader-lenses/rebuild-depth-receipt.json` **stays the record of this rebuild** — the
document attempt 2 re-recorded, describing the store this worktree initialized. The alternative,
restoring the P19 document so the gate keeps P17's store as its subject, was measured and rejected:

- Restored, the two documents read as one store and every arm fires — and the gate is **red on
  seven assertions** over the P19 receipt: the ladder's `covers` span, the three concerns
  `mcp-server/contracts/concern-checklist.json` calibrated that the reader-lenses survey never
  held, `B-02/AL-1` with no attached evidence row, `ZD-1` classified `confirmed-bug` with no
  finding, `B02-R1`'s missing counter-claim, seam `S-01` unevidenced on `B-02`, and no batches.
  That is the pre-existing red this section records at `fb9f1c4`, and none of it is repairable
  from here: the store those rows describe was deleted by §7.4 step 3 and lives in no worktree
  this lane may write. CI would end red with no path to green.
- Kept, the two documents read as two stores, the P17-denominated arms report `cannot run`, the
  seven assertions that do not read P17's sets all hold — both controls among them — and the gate
  exits 2. CI ends green on the third state.
- The receipt that stays is also the only one anything can contradict. It names the store at
  `…/amanuensis-survey-depth/.amanuensis`, which exists and which the live arm reads; the P19
  document names `/Users/nfeldman/repos/amanuensis/.amanuensis`, a store the primary checkout has since
  rebuilt, so restoring it would leave a receipt at HEAD describing no store anywhere. It would
  also retire the four derivation defects attempt 2 fixed in `dev/record-rebuild-depth.mjs`, which
  nothing but that receipt exercises.

**How the two stores are told apart**, from facts the documents already carry: the absolute
`storage_path` each was written against, and whether their recorded storage histories share a
commit. A store that continues another carries its commits; one initialized from nothing has its
own root and shares none — the historical pair shares 100 of 100, this rebuild's receipt 0 of 24.
Where a document records neither field the answer is *the same store*: a missing field must not buy
an exemption. `.github/workflows/test.yml` computes those two facts itself rather than asking the
gate, because a gate that tells CI which answer to accept can excuse itself.

**What this costs, stated plainly.** Fourteen of the gate's twenty-one assertions are unanswerable
here and seven still hold. What the fourteen would have said about *this* rebuild is said by
`GATE D0` (§7.1) and `GATE A1` (§8.8): B3 is the same evidence-backed-disposition predicate,
recomputed from §7.5's row-level witnesses against a fixture a different run wrote, which is the
independence this section exists to protect. `node dev/test-rebuild-depth.mjs` stays in
`completion.commands` as a bare command, where exit 2 and its `CANNOT RUN` line are the owner's to
read, alongside `dev/test-rebuild-regeneration.mjs`.

`dev/test-rebuild-readback.mjs` spawns the rebuild driver directly at `:541-552` and `:686-699` with
`--confirm --workspace --archive --receipt` and no `--carry-from`, and asserts it exits 0 (`:584`,
`:596`, `:622`, `:720`, `:737`). §5.4 makes `--carry-from` required, so the gate breaks. The comment
at `:494-500` records why it drives the real script rather than reimplementing it (F1/codex), so the
answer is to update the invocations, not to weaken them: both arms pass
`--carry-from none --carry-reason "throwaway workspace has no predecessor"`, a new assertion checks
the `carry_runs` row was written — otherwise the `--carry-from none` branch is a branch nothing
tests — and a separate arm keeps the missing-argument refusal red. The file is a **P4 deliverable**;
an earlier draft had P4 promising it stayed green while specifying the change that breaks it.

**Two gates are already red on this branch at `fb9f1c4`, before the lane starts**, and neither
red is caused by anything specified here. `dev/test-rebuild-depth.mjs` fails eight assertions
over the reader-lenses-era receipt this branch carries (`d2b1630` is a descendant of the
reader-lenses merge `7c1c1a9` and predates the clean-slate rebuild's commits); re-run in this
worktree at `ec11d3f` it still prints `GATE P19 RED: … 8 failed assertion(s)`. The acceptance
rebuild re-records that receipt for its own rebuild and must turn it green. `dev/test-rebuild-
regeneration.mjs` fails one assertion — `registry_ownership resolves 4 owning subsystem(s); a
denominator that names one subsystem cannot show a missing edge` — which is the decomposition
question the clean-slate report raised and is **out of this lane's scope**.

A regression list is a promise about gates that are **green when the packet starts**, so neither
belongs in one — and an earlier draft asserted that while the plan put `node dev/test-rebuild-depth.mjs`
in two packets' regression lists and `node dev/test-survey-depth.mjs`, which cannot be green until
the rebuild writes its candidate, in two more. Both are removed from every regression list. Each
appears in the **acceptance** of the packet expected to turn it green, which is where a gate a
packet is supposed to fix belongs. `dev/test-rebuild-regeneration.mjs` stays in
`completion.commands`, where it is the launcher's and the owner's business rather than a packet's.
It also holds a `set_disposition` call site (`dev/test-rebuild-regeneration.mjs`), so it is a P1
deliverable even though it is nobody's regression: a caller a change breaks must be updated whether
or not it was passing.

---

## 9. What this specification does not settle

- Whether the AxiomDB store's next refresh can discharge §2 without re-surveying. §2.4 gives a
  mechanical path; whether the evidence rows it needs already exist there is unmeasured, because
  the repository is outside this lane's custody.
- Whether a *reported* axis should ever become blocking. §1.6 chose no; §8.5 names the cost. The
  acceptance rebuild's deltas are the evidence the owner would need to revisit it.
- Whether `B02-3`'s and `B07-1`'s hang defects are in scope for the acceptance rebuild's
  successor findings, or belong to a separate lane.
