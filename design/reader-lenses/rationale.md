CANARY: acd8ebeec590fc66a233405d

# Reader lenses: rationale

Everything persuasive lives here. `spec.md` states contracts; `claims.md` states decisions with
evidence and no reasons. This file carries the reasons, the alternatives that lost, the
tradeoffs accepted, and the things this session could not settle.

This file is removed from every review snapshot. The canary token above appears nowhere else in
the repository; the launcher refuses to launch a reviewer if it leaks.

---

## 1. Labels

The owner's constraint (decision 1) was: convey accurate meaning to both human and AI consumers
with the least room for imported, unwanted meaning. That is a *subtractive* criterion — it asks
which words carry the least freight — so each candidate was tested by asking what a reader
could wrongly infer from it, not by asking what it evokes.

### Codebase

Kept from the proposal. The objection is that the lens holds the *record of* the codebase, not
the codebase; a reader might expect source. In a survey report that ambiguity does not survive
the first page, and every alternative was worse: *Account* is a textual-critical import the
style contract reserves for evidence relationships; *System* invites confusion with the
runtime; *Architecture* is already a page inside the lens. `Codebase` is the practitioner word,
imports nothing, and matches the existing `Codebase glossary` page label.

### Unresolved, not "Needs attention"

The proposal offered **Needs attention**. It reads well and it loses on the owner's criterion.
"Attention" is a directive: it tells the reader that these records are things *they* should act
on. The record does not know the reader's priorities, and an agent reading `get_attention`
would be licensed to infer a work queue that no row asserts. It is also task-tracker vocabulary
— one register-step away from the `triage` family `reporting-style.md` excludes.

**Unresolved** states a property of the records instead of an instruction to the reader, and it
is not a new word: ADR-0001 already defines *resolved* mechanically — a terminal resolution, an
authorized actor or rule, and resolution evidence or an explicit authorized dismissal. Naming
the lens for the negation of an existing operational definition means the label's meaning is
already checked by code elsewhere in the system, which is the strongest form of VP12 compliance
available: there is no second definition to drift.

The fit is exact at the edge cases that matter. A repair with no verification evidence is
`fixed-pending-verification`, which ADR-0005 defines as *pending* — unresolved. A stale
examined file creates a named revalidation obligation, which ADR-0001 says is open until
closed — unresolved. Both belong in the lens and both are counter-intuitive under
"Needs attention", where "a fix that's already landed" reads like a resolved thing.

Rejected alternatives:

- **Open** — the best practitioner word, and unusable: it collides with the exact enum value
  `open`, and `fixed-pending-verification` is *not* `open` while still belonging to the lens.
  A label that is also a member value of the enum it partitions is precisely the imported
  meaning the owner asked to avoid.
- **Current problems** — "problem" excludes decisions and leads, which are in the lens.
- **Working record** — the existing nav group name, and it names the method (how the record was
  produced), which is the root fault this cycle exists to fix.
- **Live** / **Active** — workflow state the store does not hold.

Cost accepted: the tool is `get_attention` (fixed by the lane brief) while the lens is
`Unresolved`. One name faces agents, the other faces readers. The spec states the mapping in
§5.2 so the two cannot be read as different partitions, and `get_attention`'s item labels are
ADR-0010's, not the lens's, so nothing depends on the tool name carrying the lens's meaning. If
the reviewers overturn `Unresolved`, `Needs attention` restores cleanly: no predicate changes.

### History

Kept, and it survives the owner's fallback in decision 2 without needing it. "Resolved" was the
three-lens alternative, and it cannot hold sessions, refresh runs, or publication receipts —
records that are not resolutions of anything and that have no home today at all. `History` is
the ordinary word for an append-only account of what happened, it is what `git` calls the same
thing, and it imports nothing. If a reviewer overturns History as a lens, decision 2's fallback
applies mechanically: the same membership predicate becomes the last group of `Unresolved`,
and the three History pages become three sections. Nothing else changes — which is why the
partition was written as SQL over `finding_state_current` rather than as page membership.

### Method

Kept. `Apparatus` is available in the approved textual-critical vocabulary and would be
defensible, but the style contract permits it only when it identifies an *evidence
relationship* more precisely, and this lens holds the reader's guide and the onboarding record
as well as the coverage matrix. `Trust` is a claim the lens cannot make on its own behalf;
`Provenance` is narrower than the content. `Method` is accurate and flat.

### Standing states

`not-in-scope` from the proposal was renamed **`unledgered`** to match the existing
`scope_gaps.kind` token. "Not in scope" is read by both humans and models as *deliberately
excluded*, which is what `excluded` means; two states that both sound like exclusion is a
rubric bug in VP12's exact sense. `unledgered` says only what is true: no ledger row names this
path.

`examined-stale` absorbs the unreachable-revision case rather than getting its own state. The
distinction lives in `stale_reason` (`git-drift` | `absent` | `unverifiable-ref`), because the
authorization consequence is identical in all three: a dated historical reading, no current
claim. A state whose authorizations are identical to another's is a second name for one thing.

`mixed` is the one label with no analogue in the proposal, and it is load-bearing. The owner's
brief says no single headline state may hide a mixed case; `coordinator.rs` is `examined` in
three owners and `candidate` in three. Without a `mixed` value, a consumer that reads only
`standing.state` gets *some* owner's answer, and which one it gets is an ordering accident. The
alternative — omitting `state` entirely for multi-owner files — breaks every consumer's schema
expectation and makes the common case pay for the uncommon one. `mixed` authorizes exactly what
the weakest owner authorizes, which is the only safe reading.

---

## 2. Standing as a subtractive guard

The catalog's v2 scope warning on GP8 is the reason standing is shaped the way it is.
Substrate-not-prompt is measured only for *subtractive* guards; over a generative field a
mechanical guard buys form and can cost accuracy, and required fields get fabricated to order.

Standing is entirely subtractive: every field is a `CASE` over a column, a `COUNT`, a set
difference, or a git ancestry call. Nothing in it is authored. That is why the `unknown` list is
specified as five *exact queries* rather than as "the things we don't know": a model asked to
enumerate its own ignorance will produce a plausible list, and a plausible list of unknowns is
worse than none, because it looks complete. The five sources are the ones the schema can
compute. The spec states the limitation that `open_questions` has no locus column instead of
papering over it with a text search, and that is a deliberate refusal to make a fuzzy match look
like a binding.

Reachability is the one place the guard leaves SQL. It has to: commit ancestry is not a column.
The design keeps it honest by reporting `reachability_checked: false` when git is unavailable
rather than defaulting to `examined` silently — VP4's rule that a check which cannot run is not
a green.

---

## 3. Compactness

Decision 5 refused hook-based injection on the ground that the tools are called often and must
not spam the context. That makes compactness a contract, not a preference, and the design took
three consequences from it.

First, the budget is in **bytes of the serialized payload**, not in item counts. Item counts are
what ADR-0011 used, and they are the right unit when the items are uniform; locus account items
are not — one finding's `symptom` and `root_cause` can outweigh twenty vocabulary glosses. A
byte budget is also the thing a gate can measure without agreeing with the implementation about
what an item is.

Second, `owners[]` is exempt. If the budget could evict an owner, a multi-owner file could
return a truthful-looking response that hides the disagreement the `mixed` state exists to
expose. Truncating the thing the design is for is the failure mode to design against, so the
array that carries the mixed case is the one array outside the budget.

Third, the omission ledger is ADR-0011's. The distinction that matters is between *the store
holds no row* and *we dropped it* — the difference between an honest empty and a silent loss.
Without it, an empty section and a truncated section are indistinguishable, which is exactly
ADR-0011's "token truncation without an omission ledger" failure.

The first draft carried that distinction as a third omission reason, `not-recorded`. Both
reviewers overturned it and both were right for the same reason: §4.3 requires every omitted
entry to carry a census member's id, and a section whose table holds no row has census 0 and no
id to carry, so the reason could not satisfy the invariant it sat inside. The distinction is
kept and moved to where it belongs — it is a property of the section (`census: 0,
recorded: false`), not an entry in a ledger of dropped items. `irrelevant`, ADR-0011's third
reason, is also not carried: it means zero lexical overlap with a task query, and selection here
is registry-exact rather than lexical, so nothing is ever dropped for irrelevance.

The numbers (8192 / 3072 / 4096 / 32768) are engineering judgments sized against the AxiomDB
store's worst real locus — `coordinator.rs`, six owners, 24 undispositioned concerns — with
roughly 2× headroom. They are not measured optima. The gate checks *that the budget binds*, not
that the number is right; a later measurement can move the constant without changing the
contract.

---

## 4. Three tools, no fourth

GP37 (decision-relevant parsimony) is the reason the tool surface grows by three and not more,
and the reason none of the three is a write tool. Each protects a distinct invariant:
`describe_locus` answers "what is known here and what does it authorize", `get_attention`
answers "what is not settled", `get_history` answers "what became of what was concluded". A
fourth tool for the Codebase lens as data was considered and dropped: `describe_locus` at a
subsystem locus already returns it, and a second entry point would give the same records two
shapes.

`CodebaseBrief` was not extended, for the reason the proposal gives: it is a task-bounded frozen
projection requiring an A9 review session requiring an A8 composition. That is the right weight
for a review and the wrong weight for "what is this file". A brief can cite `describe_locus`
output; the reverse would make every file question pay for a composition.

The `READ_ONLY_TOOLS` change to `index.ts` is small and easy to skip, which is why it is a
claim of its own (C22). `toolAnnotations` infers read-only from the `get_`/`list_`/`lookup_`
prefixes. `describe_locus` matches none, so without the change the most-called read tool in the
system would advertise itself as destructive — a hint that hosts use for confirmation prompts.
Renaming it `get_locus` would have avoided the change; the lane brief fixes the name, and the
name is better: `describe_` says the response is an account, while `get_` in this codebase
means a row fetch.

### Reusing ADR-0010's labels (decision 6)

Decision 6 required it, and the fit is good but not total. Four of the seven labels transfer
verbatim. Three do not: `ruled-out historical` is a History record rather than an Unresolved
one; the `survived / contested / defeated challenge` triad is the terminal aggregation of an A7
run that `get_attention` has no access to; and `latent-defect` is defined over an A8 composition's
impact base that `get_attention` also does not have. Inventing lookalikes for them would be the
exact failure ADR-0010 warns about — downstream consumers collapsing unlike epistemic states —
so they are named as not-reused rather than approximated.

The first draft did exactly that twice, and round-1 caught both. It kept `latent-defect` without
a base, and it introduced `contested` as a label of its own for unresolved contradictions and
open matrices — while ADR-0010 already spends that word on the challenge triad. Both reviewers
overturned the second one independently; it is the only claim on which they agreed to overturn,
and the draft's own §13 gate ("a `get_attention` label's meaning differs from ADR-0010's") would
have turned red on it. The lesson is narrower than "reuse the labels": a reuse instruction makes
the *near misses* the dangerous cases, because a word that almost fits is harder to notice than
one that does not fit at all. `undiscriminated` is the replacement and the reasoning for the
word is in §12 item 10; `latent-defect` is dropped rather than renamed, for the reason in item 11.

`stale-knowledge` is extended rather than duplicated. ADR-0010 defines it over a closed claim
validity interval; the same epistemic state over the ledger is a stale examined file. Both are
"this reading may no longer hold, and nothing has yet established that it is false", which is
ADR-0001's `stale` exactly. They carry a `source` discriminator because VP6 forbids pooling
across heterogeneous arms: a count that mixes claim-derived and ledger-derived staleness is a
property of which engine has run, not of the codebase. In AxiomDB the claims engine has never
run, so an undiscriminated count would read as zero stale knowledge in a store with 111 unread
files.

---

## 5. The projection

### No page is retired

The largest tradeoff in §7. A clean information architecture would retire `contradictions.md`
and `diagnosticity.md` and fold their records into `disagreements.md` and the History pages. The
materializer supports retirement (`prune_retired`), so the cost is not technical: it is that
the prose passthrough pages (`entry-point.md`, `onboarding-report.md`, `concern-checklist.md`)
are authored by survey sessions and may contain Markdown links to retired paths. The coverage
read-back axis turns red on a local link that does not resolve, so a retirement would make
publishing fail on some existing conspectuses for a reason unrelated to this change, discovered
at publish time on a user's repository.

Re-homing every existing path costs one thing: `contradictions.md` now carries only *resolved*
contradictions while its unresolved siblings live on `disagreements.md`, which is a partition a
reader must learn. Both pages state the split and link to each other. That is a smaller cost
than a broken publish, and it can be revisited once a survey-authored-link lint exists.

### Five counts, not four

The lane brief asks for "four linked counts by resolution state". The enum has five values:
`open`, `fixed-pending-verification`, `verified-fixed`, `ruled-out`, `accepted`. Rendering four
would mean hiding one — and the whole cycle exists because the overview hid resolution behind
severity. The spec therefore generates the count line by iterating the enum source, so it
carries five today and carries whatever the enum carries tomorrow. This is the one place the
design reads the brief's number as an instance of a rule rather than as the rule.

### The hot-spot table's missing column

The access-heat column is omitted entirely when no subsystem has an access row, rather than
printed as zeros. AxiomDB has one `access_log` row across 35 subsystems. A column of zeros
invites the reading "nothing is hot here", which is a claim about the codebase; the true claim
is "heat was not measured". This is VP4 applied to a table column: a measure with a zero
denominator is not a zero, and the honest projection of an unmeasured dimension is its absence
plus a sentence.

### No composite

BP26. Every request for a single number to rank subsystems by is a request to average
incommensurable axes — open criticals, unread fraction, evidence quality — into a score whose
movement no one can attribute. The ten columns stay ten columns and the sort is lexicographic
over three of them.

---

## 6. Interface enhancement (decision 3)

The owner declined per-file pages and welcomed tasteful JavaScript. The design takes "tasteful"
to mean the enhancement must be invisible when it works and absent when it fails, which is why
the no-JS path is specified as *complete* rather than *degraded*: the Files page lists every
path with its anchor whether or not the index loads.

`search-index.js` is a `<script src>` assigning a global rather than a `fetch`ed JSON file
because the projection must work from `file://`, where `fetch` of a sibling file is blocked by
the same-origin policy in Chrome and Safari. Inlining the index into every page was rejected on
size: 295 paths plus 197 symbols is roughly 40KB, which on 50 pages is 2MB of duplicated data
in a projection that is checked into Git.

Bringing the index under read-back (C41) is the part that matters and the part easiest to skip.
An index that silently loses half its paths is worse than no index: it answers "nothing known
about this file" for a file the store knows a great deal about. Requiring every
obligation-bearing ledger path exactly once makes that a red state axis, which is the same
discipline ADR-0005 applies to finding markers.

---

## 7. Survey changes

### Claims are the load-bearing change

P3 is what makes standing true for documentation rather than only for findings. Today the
structural account is prose in a Markdown artifact: it cannot be bound to a revision,
invalidated by a change, or retrieved by locus. The v2 engine — temporal claims, change impact,
revalidation — was built for exactly this and has never been fed in either store. Once the
structural inventory is claims, `predict_change_impact` and revalidation apply to documentation.

The risk is BP4's inverse, stated in the catalog's v2 scope note: a mechanical check over a
field the writer must author gets satisfied by fabrication. A claim is a generative field. The
mitigations are deliberate and limited:

1. The phase prerequisite requires **one** claim, not a quota per category. A quota is a
   fabrication incentive; a single claim is a check that the phase produced structured output
   at all.
2. The evidence gate is subtractive and already exists: `add_claim` requires at least one
   evidence row and refuses evidence unreachable at the asserting commit. That is a
   `file:symbol@sha` existence check, which is GP8's measured-good case.
3. The spec says plainly that claim truth stays the adversarial pass's obligation. A claims-
   backed conspectus is *addressable*, not *verified*, and conflating the two would be the
   same category error as treating `mapped` as complete (ADR-0001's rejected alternative).

An explicit negative claim ("this subsystem owns no mutable state container") is permitted
precisely so the honest answer to a category is available without omission. Omission and
fabrication are the two failure modes; naming the negative case gives the writer a third move.

### Forward-only, no backfill

Decision 4 put AxiomDB backfill out of scope, and the proposal's reasoning stands: extracting
claims from 35 subsystems of existing prose is a generative task at scale, and the catalog's
warning applies directly. The renderer's labelled narrative fallback is what makes forward-only
safe — an un-backfilled conspectus says "structural inventory not recorded as claims" rather
than rendering an empty section that reads as "no structure here".

### The xref citation requirement

Making `context` required and citation-validated is a breaking change to `add_xref`, and the
blast radius is real: `test-smoke.mjs` calls every tool. It is worth it because an uncited edge
is indistinguishable from an inferred one, and `reporting-style.md` forbids inferring edges from
names, prefixes, or nearby seams. With zero rows in both stores there is no migration cost —
the requirement binds only future writes, which is VP24's point about retrofitted declarative
guards: there is no historical state here to sweep.

---

## 8. Single-source enums

`check-evidence-vocabulary.mjs` exists because the evidence ladder was published in three places
and diverged; the reader's guide is currently a fourth copy that lists five evidence kinds where
the server enforces nine, and a finding-status table that carries neither of the two states this
cycle is about. The fix is not a fifth checker.

One JSON source with two generated outputs was chosen over a runtime-shared file because the
materializer is a separately installed Python package and cannot read `mcp-server/contracts/` at
run time. Generation with `--check` in CI is the same pattern `gen-tool-inventory.mjs` already
establishes, so it adds a step, not a mechanism (GP37).

`check-evidence-vocabulary.mjs` is extended rather than replaced so its existing red conditions
survive. A change that updates all three current copies but not the source must still be red;
that is VP25's point about editing a gate — the repaired gate has to keep the property that made
it useful.

---

## 9. Overview truthfulness

The AxiomDB overview displays a 2026-08-23 warning — "34/34 mapped, 7/7 seams assessed, but
re-anchored: read the warning" — on 2026-09-11, after two nightly refreshes, beside a strip
reading "No recorded stale entries". Two independent faults produce that: the thesis is taken
as the first non-header paragraph of a hand-authored file, and the freshness strip counts a
table nothing writes.

Taking the thesis by heading fixes the first fault only if the prose in that heading cannot
itself carry a freshness claim, which is why the lint exists. The lint is a word list, which is
crude: it will reject a legitimate sentence containing "mapped" in a different sense. That is
the accepted cost of a subtractive guard over a generative field — it constrains form, not
content, and the failure mode is a refusal to publish with a named file to correct, not a
silent rewrite. GP25: it halts.

The freshness fault is finding B04-1, still `fixed-pending-verification` in this repository's
own conspectus. The fix is not just to change the query: it is to make the read-back axis able
to turn red. `entries` has zero rows in both stores, so the stale axis has never had a
denominator — it is a zero-denominator green of exactly the kind this repository has now
recorded three times. Adding `ledger_stale_marker` while keeping the `entries` check means the
axis gains a denominator without losing anything, which is the only shape of change the "nothing
may weaken an existing gate" constraint permits.

---

## 10. The dogfood slice

Decision 4 put the self-conspectus rebuild in scope. It is the only place this cycle's work gets
exercised end to end by the system that produced it, and the only packet that needs the MCP
server.

The three named files are chosen to be certainly examined and structurally non-trivial:
`mcp-server/src/index.ts` (server composition and annotations), `mcp-server/src/tools/findings.ts`
(the resolution surface this cycle partitions), and
`materializer/amanuensis_materializer/core.py` (the page plan this cycle changes). If any of the
three fails to reach `examined` with a structural claim, the survey did not do what §9 says it
does, and the gate says so rather than the report saying it.

The `get_attention` reconciliation is **exact set equality**, not non-emptiness. ADR-0001's
fully-surveyed definition makes the same distinction for run fan-in, and GP24 states it as a
rule: a fan-in that asserts non-emptiness cannot detect an omission. A tool that returns
nineteen of twenty open findings would pass any count-based check that also drifted.

---

## 11. Catalog citations and how each is applied

| Id | Application in this design |
|---|---|
| GP37 | Three read tools and one contract; no new agent roles, no new ceremony; enum generation is a step in an existing mechanism, not a new one |
| GP8 (+ v2 scope note) | Standing, lens membership, and the omission ledger are subtractive and computed by code; the claim statement and the narrative are generative and are not forced to a shape |
| BP4 | The Phase 2 prerequisite requires one claim, not a quota, precisely because a mechanical check over an authored field is satisfiable by fabrication |
| VP12 | Every enum value carries an operational meaning *and* what it cannot justify, in one source read by the server, the guide, and the projection |
| VP4 | Every gate in §13 names a red condition and a false green; the access-heat column is omitted rather than zeroed; the stale axis gains a denominator |
| VP6 | `stale-knowledge` carries a `source` discriminator so claim-derived and ledger-derived staleness are never pooled |
| GP24 | The dogfood gate asserts exact set equality; the omission ledger asserts `selected + omitted == census` |
| GP25 | The orientation lint halts the publish; an over-budget response errors rather than truncating past the ceiling |
| GP14 | Standing before account; optional sections opt-in; compact by default with one expansion |
| GP27 | Nearest-term selection, locus kind inference, and every lens query are deterministic lookups with `model_calls: 0` |
| BP26 | No composite score, no health index, no progress artifact on the overview |
| VP24 | The `add_xref` citation requirement binds future writes; both stores hold zero rows, so no historical sweep is owed |
| VP25 | `check-evidence-vocabulary.mjs` is extended, not rewritten, so its existing red conditions survive the change |
| GP16 | Labels, backfill scope, and injection remained the owner's decisions; this design chose only inside them |

---

## 12. Unsettled

Recorded rather than resolved. None of these blocks the plan; each is a place a reviewer or the
owner may reasonably overrule the design.

1. **`Unresolved` versus `Needs attention`.** The strongest label decision in this document and
   the one most exposed to taste. The membership predicate is identical either way, so a
   reversal is a rename of one enum value and its labels, contained entirely in
   `conspectus-vocabulary.json`. Flagged for the reviewers explicitly.

2. **The tool name `get_attention` against the lens name `Unresolved`.** The lane brief fixes
   the tool names. If the owner wants one vocabulary across both surfaces, the tool should be
   `get_unresolved` and the change is mechanical; this session did not take that liberty.

3. **Four counts versus five on the overview.** The brief says four; the enum has five. The
   spec generates the line from the enum. If the owner meant exactly four visible numbers, the
   design would have to hide `accepted`, and it declined to.

4. **The Phase 2 prerequisite's blast radius.** Requiring a structural claim before advancing to
   `structural` will force fixture updates in several existing tests, each of which must create
   a session, an evidence row, and a commit-resolvable SHA. The plan isolates this in its own
   packet (P12 in the plan as numbered) so an over-run cannot take the claims-rendering work
   down with it, but the
   estimate is the least confident in the plan. If P9 exhausts its attempts, the fallback is to
   keep the renderer contract and the dogfood gate and drop the status prerequisite — at the
   cost that future surveys of *other* repositories are guided by prose rather than guarded by
   code.

5. **The orientation word list.** A word list is a crude instrument for a semantic rule. It will
   produce false positives on legitimate prose. The alternative — a model judging whether prose
   makes a freshness claim — is a model performing a deterministic-looking check, which is BP26.
   The list is the lesser evil and it is data, not code, so it is cheap to tune.

6. **Whether `describe_locus` should be hooked.** Decision 5 said no to injection and the design
   respects it. The proposal's observation stands unaddressed: an editing agent that is *told*
   to call the tool will sometimes not. Nothing in this cycle measures whether the consumer
   route changes agent behavior, and `test-consumer-route.mjs` explicitly cannot: reachability
   is not adoption. A measurement would need a task-performance arm, which is out of scope here.

7. **Byte budgets are judgments, not measurements.** Sized against the worst locus in one store
   with 2× headroom. A second store could make 8192 wrong in either direction. The gate proves
   the budget binds and the ledger reconciles; it does not prove the number is well chosen.

8. **The `unknown` list cannot bind open questions to a file.** `open_questions` has no location
   column. Adding one is a schema change this cycle did not take, so file-level standing reports
   subsystem-scoped questions with an explicit `scope` field. A reader asking "what is unknown
   about *this file*" gets a slightly wider answer than the question, labelled as such.

### Added by the round-1 revision (run `20260911-195201-revise`)

9. **`gate.red_expect` is specified here and consumed by a file this session does not own.**
   The field is in `plan.json` for all eighteen packets and §13 states the rule, but the code
   that would enforce it is `run.sh:322-328` in the lane's automation directory, and this
   session is running under that launcher. Editing it mid-run would change the harness driving
   the session that is editing it. Until that change lands, "the gate was red before its packet"
   remains satisfiable by a missing file — which is the very false green the field exists to
   close. **This is the single largest unclosed hole in the plan**, and it is a guard specified
   in prose rather than enforced in the substrate, which is exactly what GP25 warns about. The
   packet-level acceptance line ("the red output matches `gate.red_expect`") is a second,
   weaker instrument: it depends on the implementing session checking its own work.

10. **`undiscriminated` is a coined label.** Decision 1 asks for the least imported meaning, and
    every alternative was worse against the collision that forced the rename. `contested` is
    taken by ADR-0010. `unreconciled` collides with ledger reconciliation inside this same
    codebase (`reconcileTx`, `ledger_reconciled`, `refresh.md`). `competing-explanations` is
    already the Method page label for the matrix index, which is apparatus, not a record state.
    `undiscriminated` names the property the three sources share — the evidence does not pick
    out which of two credible accounts holds — and it is the wording the diagnosticity page hint
    already used. It is nonetheless a word a reader has to learn, and the owner may prefer
    another. The change is a rename of one enum value, one page path, and one section key.

11. **`latent-defect` was dropped rather than re-based, and something is lost.** An open finding
    whose evidence predates the last checked revision is a real and useful category, and
    `get_attention` can no longer surface it. The alternative was to keep the word with a
    different base (`git_state.last_checked_sha` instead of the A8 impact base), which is
    precisely the overloading that made `contested` a defect. Losing a category is recoverable;
    a vocabulary whose words mean different things in different tools is not. If the owner wants
    the category back, it needs a *new* name and a stated base, not this one.

12. **The seam gap is measured by a proxy that cannot bind to a seam.** `dispositions` has no
    seam id and `composition_seam_concerns` holds zero rows, so "this party has assessed some
    seam concern" is the strongest statement available. Every surface now says so, which is
    honest but not sufficient: a party that assessed seam A and not seam B counts as having
    assessed both. The real fix is a seam-bound disposition record, which is a schema change
    this cycle did not take. The 9 one-sided seams the store holds are found; a one-sided gap
    *within* an assessed party is not.

13. **Neither substrate check in §9.1 has ever run against real data.** `claims` and
    `claim_evidence` are both empty on the AxiomDB store and on the self-conspectus that is
    about to be discarded. The evidence-kind and subject-type refusals are therefore validated
    only by seeded fixtures. That is the right instrument for a guard, but it means the first
    real survey to hit them is also their first real test, and a rule that is too strict will be
    discovered by a session that cannot advance a subsystem.

14. **The routing measurement (§13.2) is specified and unscheduled.** Removing the one-call
    claim from `test-consumer-route.mjs` was correct — one run of a model is not a measurement —
    but the replacement is a protocol, not a result. Item 6 above said nothing in this cycle
    measures whether the consumer route changes agent behavior; that is still true, and now it
    is written down as a measurement someone has to run rather than as a gate that would have
    reported a number without earning it.

15. **`docs/` promotion adds a script no existing test covers end to end.**
    `dev/promote-docs.mjs` is new, and the guard it works around — `resolveStorageOutputPath`'s
    containment assertion — exists for a good reason. A promotion step is a second path by which
    bytes reach a tracked directory, and P18's acceptance re-reads the promoted tree at its own
    path, which is the strongest check available. It does not make the copy itself atomic.

16. **C1 was overturned by one reviewer and upheld by the other, and this session rejected the
    overturn.** Decision 2 makes History conditional on surviving review, so this is the
    disposition most exposed to being wrong. The reasoning is in `dispositions.md`: the evidence
    Codex offered — mutable, unversioned dispositions, seams, vocabulary and subsystem rows —
    is evidence about §3.3's `as_of_sha` whole-account snapshot, which *was* overturned and
    *is* removed, not about §6.1's History membership, whose event spine is two append-only
    tables plus `sessions`, `refresh_runs`, and `projection_verification_runs`. The narrow part
    that did bear on the lens — `open_questions` and `field_notes` have no event table — is
    applied. If the owner reads the decision-2 trigger as "any reviewer overturn, regardless of
    what the evidence bears on", the fallback is mechanical: delete the History group from
    `NAV_GROUPS`, move its four pages into Unresolved as a final group, and the partition rule
    in §1.1 is unchanged.

---

## 13. Plan adjustments against the proposal's slices

The lane brief allows the slices to be adjusted if the spec demands it, provided the reason is
recorded. Three adjustments were made.

**The enum source moved from S2 to S1 (P1).** The proposal put P6 (one enum source) in S2
alongside standing. The spec makes the overview's per-state count line and the reader's guide
*generated* from that source rather than hand-listed, and both land in S1. Keeping P6 in S2
would mean writing a literal list in S1 and replacing it in S2 — a second copy of the enum,
created deliberately, in the slice whose whole purpose is to stop the record lying about state.
P1 now runs first and everything downstream reads it.

**S2 carries six packets, not two.** The proposal's S2 is described as one slice ("P2, P6;
`describe_locus`; Files page; Not yet surveyed page; standing block; ⌘K"). At one gate per
packet and a single session per packet, that is six sessions of work: the standing views, the
tool, the budgets, the page plan, the Unresolved and History pages, and the search index. They
are split so a failure in the page work cannot consume the tool's budget, and so each has a gate
that can fail on its own. The slice boundary — and therefore the review boundary — is unchanged.

**The `pecia-defects` CI job is not in `completion.commands`.** It is gated on the repository
variable `PECIA_GATE_ENABLED` and needs a clone of a private repository plus the `pecia` CLI on
`PATH`. Including it would put a command in the completion list that fails locally for a reason
unrelated to this branch, which is the opposite of a useful gate. Every other job's steps are
present, adapted to worktree-root paths, plus every packet gate (sixteen at the time of writing,
eighteen after the round-1 revision split the rebuild packet). `npm ci` is omitted on
the assumption that `mcp-server/node_modules` is installed; `npm audit --audit-level=critical`,
`npm run build`, and every test step are included.
