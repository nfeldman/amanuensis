# Explanation: claims packet

Reviewers see this file, `spec.md`, `plan.json`, `plan.md`, `decisions.md` and a history-free
snapshot of the repository. Each claim is one normative decision. Evidence is a file with a line
number, a command with its result, a specification section, or a practice-catalog id. Catalog
ids refer to `~/research/practice-audit/practice-catalog.md` version 3.7 (2026-10-15).

The self-conspectus store may be read at
`sqlite3 "file:/Users/nfeldman/repos/amanuensis/.amanuensis/memory.db?mode=ro"`.

---

### C1

`findings.business_context` renders on every full finding record as **Why it matters**: a column
on the open-findings Markdown table, present for every row and empty where a finding has none; a
field on the resolved-findings record list and on both pages' HTML records, omitted where empty.

Evidence:
- `spec.md` §2.1.
- `materializer/amanuensis_materializer/renderers.py:1486-1506` renders open findings as a table;
  `materializer/test-materializer.py:465` pins its header.
- `rg -n business_context materializer/amanuensis_materializer/` returns no match in a renderer.
- `SELECT count(*), sum(business_context IS NOT NULL AND business_context <> '') FROM findings;` → `11|11`.

### C2

`subsystems.notes` renders on the subsystem page whenever non-empty, as `### Survey note` under
`## Scope`, labelled as not bound to a revision, and appears once on the page.

Evidence:
- `spec.md` §2.1.
- `materializer/amanuensis_materializer/renderers.py:1187-1208` prints the notes only when the
  subsystem has no claim and no survey artifact.
- `SELECT count(*) FROM subsystems WHERE notes IS NOT NULL AND notes <> '';` → `9`.

### C3

A retention gate seeds a sentinel in every field of `spec.md` §2.1's list and requires each to
reach a generated page, with a reasoned allowlist that fails when an allowlisted field does
render; the allowlist is the eight seam prose columns no renderer reads.

Evidence:
- `spec.md` §2.1.
- `design/reader-lenses/spec.md:420-426` lists the model-authored durable fields.
- `mcp-server/src/schema.sql:1016-1023`: `a_writes`, `a_reads`, `b_writes`, `b_reads`,
  `ordering_assumption`, `cardinality`, `staleness_tolerance`, `schema_owner`;
  `rg "b_writes|b_reads|cardinality" materializer/amanuensis_materializer/` returns nothing.
- Practice catalog VP4: every gate must be able to turn red; the two-sided allowlist is that case.

### C4

In Markdown a claim renders as a list item whose first text is its statement, with its
coordinates (claim key, subject, epistemic kind, asserting revision, evidence) as one nested list
item beneath it and no heading of its own; in HTML the statement is its own `<li>` and the
coordinates are a nested `<ul>`, which requires `html_projection.py`'s list parser to nest.

Evidence:
- `spec.md` §2.2.
- `materializer/amanuensis_materializer/renderers.py:1168-1186` renders a five-column table with
  the claim key in the first column.
- `materializer/amanuensis_materializer/html_projection.py:2795-2812`: the list parser matches
  indented items as siblings and joins continuation lines into the item's text.
- `mcp-server/test-structural-claims.mjs` reads the text under each `###` heading up to the next
  heading.

### C5

Claims group by the first segment of their key after `<sid>/`: the five recognised segments keep
their headings, any other segment is headed by its humanised name, and **Other claims** holds
only claims whose key is outside the subsystem's namespace.

Evidence:
- `spec.md` §2.2.
- `materializer/amanuensis_materializer/renderers.py:140-148, 197-204` maps every unrecognised
  segment to `other`.
- `SELECT claim_key FROM claims WHERE valid_until_sha IS NULL;` → 11 rows, of which 10 carry a
  segment outside the five recognised (`recoverability`, `trust`, `projection`, …).

### C6

Each claim record lists the files its `claim_evidence` rows cite, with `evidence.line_range`
where set and the row's role where it is not `supports`, and prints `evidence: none attached`
when no row is attached.

Evidence:
- `spec.md` §2.2.
- `mcp-server/src/schema.sql:1066-1071` (`evidence.line_range`), `:1326-1331` (`claim_evidence.role`).

### C7

When a subsystem has current claims and no recorded account, its survey narrative renders inside
`## Structure` after the claim groups under `### Survey narrative`, with the existing unbound
label and provenance; the survey record then carries a pointer and the narrative never renders
twice.

Evidence:
- `spec.md` §2.3; `decisions.md` §1.
- `materializer/amanuensis_materializer/renderers.py:1161-1215, 1422-1436`.

### C8

The subsystem file ledger renders as groups of rows sharing a classification and a reason; each
reason prints once per group, every path is a nested list item keeping its ledger anchor exactly
once, and a revision is labelled `examined at` only for the classification `examined` and
`recorded at` otherwise.

Evidence:
- `spec.md` §2.4.
- `materializer/amanuensis_materializer/renderers.py:1391-1404`.
- `mcp-server/src/tools/files.ts:70-78`: `ref_sha` is written for every classification and
  `examined_at` only for `examined`.
- `SELECT subsystem_id, count(*), count(DISTINCT why_in_scope) FROM file_ledger GROUP BY 1;`

### C9

`materialize_docs` returns `unfilled_slots`, one row per slot of `spec.md` §2.5's table that
applies to its subject and is unfilled, each naming the slot, page, subject, state and the call
or edit that discharges it; a slot's state comes from one predicate that both the renderer and
the census call; no other empty-state sentence is a slot.

Evidence:
- `spec.md` §2.5.
- `materializer/amanuensis_materializer/core.py:259-432` returns the publish summary.
- Practice catalog GP20: a gap is visible when the party that can close it is told how.

### C10

The census never halts publication and is not described anywhere as a guard or gate.

Evidence:
- `spec.md` §2.5.
- Practice catalog GP25: a guard halts; a notice that does not halt is not a guard.

### C11

`references/onboarding.md` names the thesis heading and the runtime boundary map heading and
columns literally, and a gate asserts those literals match the renderer's patterns.

Evidence:
- `spec.md` §2.5.
- `materializer/amanuensis_materializer/renderers.py:206-209` accepts only a heading matching
  `what is this (codebase|project)`.
- `.claude/skills/amanuensis/references/onboarding.md:174-177` asks the question as "what does
  this system do?"; `.amanuensis/entry-point.md:3` is headed `## What this system does`;
  `docs/index.md:7` publishes the thesis placeholder.
- `materializer/amanuensis_materializer/diagrams.py:229-262` requires an exact heading and columns.

### C12

`references/phase-5-packaging.md` step 5 reads `unfilled_slots` and fills or reports each row.

Evidence:
- `spec.md` §2.5.
- `.claude/skills/amanuensis/references/phase-5-packaging.md:55-70` ends the step at the
  returned `html_entrypoint`.

### C13

`dev/measure-reader-prose.mjs` computes table-text share and placeholder count over generated
Markdown by the definitions in `spec.md` §1, counting one fixed list of six placeholder strings
whose hash is recorded with every entry; no gate compares the figures with a threshold.

Evidence:
- `spec.md` §1.
- `decisions.md` §6 excludes a gate on above-the-fold prose share.

### C14

`dev/republish-docs.mjs` runs the republish chain as ten ordered, injectable steps; it stops
before publishing when a tracked path is unledgered or a dogfood locus has an owner that is not
`examined`, stops before promoting on a red read-back, never reconciles after publishing,
rewrites every field of `survey-progress.json` that the depth gate compares with the receipt, and
exits non-zero when a receipt gate is red.

Evidence:
- `spec.md` §4.2.
- `dev/record-dogfood-receipt.mjs` reads the publish mode from the promotion receipt.
- `mcp-server/src/tools/git.ts:352-369`: `detect_changes` marks a drifted examined row stale;
  `dev/test-reader-lenses-dogfood.mjs:298-314` requires every owner of each locus to be `examined`.
- `dev/test-survey-depth.mjs:1278-1330`: outcome counts equal list lengths, outcomes sum to the
  total, the total equals the receipt's carried count, the `end` row equals the receipt's coverage.
- `git show 19c8442` performed the chain by hand.

### C15

Each of the 14 undecided carried records receives one terminal outcome decided from the code at
`HEAD`, with evidence; none is chosen to clear a gate.

Evidence:
- `spec.md` §4.3; `decisions.md` §4.
- `node dev/test-survey-depth.mjs` → `B6 no carried record undecided — the live store: 14 of 37
  carried record(s) are undecided`.
- `design/survey-depth/spec.md` §5 defines the three terminal outcomes.

### C16

After EX8 the four gates of `spec.md` §0.3 exit 0 at the commit that records the receipts, and
the CI job that runs the carried-references gate builds the server first.

Evidence:
- `spec.md` §4.1, §4.4.
- Baseline at `ee12bed`: `node dev/test-reader-lenses-dogfood.mjs` exit 1;
  `node dev/test-survey-depth.mjs` exit 1; `node dev/test-survey-depth-acceptance.mjs` exit 1.
- `.github/workflows/test.yml:14-37`: the job reaches `dev/test-carried-finding-references.mjs`
  with no `mcp-server` build step before it; the CI log reports `Cannot find module …/mcp-server/dist/db.js`.

### C17

EX8 renames this repository's thesis heading to `## What is this codebase?` without changing its
text, and adds a `## Runtime boundary map` table drawn from the boundaries `onboarding-report.md`
already states.

Evidence:
- `spec.md` §4.4.
- `.amanuensis/entry-point.md:3-10`; `.amanuensis/onboarding-report.md` has a "Runtime boundary" section.

### C18

Explanations are stored in a new append-only table `explanations` keyed by subject type, subject
id and slot, with a stored disposition of `recorded`, `declined` or `withdrawn`, a body, a
revision and a session; a project subject admits only the `account` slot.

Evidence:
- `spec.md` §3.1.
- `mcp-server/src/schema.sql` has no purpose column on `subsystems` and no table for an account.
- `mcp-server/src/schema.sql:514-534` and `mcp-server/contracts/append-only-tables.txt`: the
  append-only pattern of `vocabulary_declinations`.

### C19

Explanations are not stored as claims.

Evidence:
- `spec.md` §3.1.
- `mcp-server/src/tools/claims.ts:149-160`: a claim can be superseded or invalidated only at a
  strict descendant of the commit it was asserted at.
- `mcp-server/src/tools/impact.ts:437-459`: `apply_change_impact` closes a subsystem-subject
  claim when a ledger file of that subsystem changes; `renderers.py:1077-1095` renders current
  claims only.
- `mcp-server/src/invariants.ts:408-435`: `mapped` is refused while a current claim in the
  subsystem's namespace has no challenge outcome.

### C20

The `entries` table is not used to store explanations.

Evidence:
- `spec.md` §3.1; `decisions.md` §6.
- `mcp-server/src/schema.sql:28-49`: `entries` holds a pointer to a prose section and no body.

### C21

`conspectus-vocabulary.json` gains `explanation_subject`, `explanation_slot` and
`explanation_disposition`, each bound to its SQL column through the generator's `sql` binding,
and `explanation_discharge` (`recorded`, `declined`, `not-recorded`), which is computed and never
stored; `subsystem_status` values gain a boolean `explanation_eligible`; `claim_subject_type` is
unchanged.

Evidence:
- `spec.md` §3.1.
- `mcp-server/scripts/gen-vocabulary.mjs:250-258` emits SQL-constrained vocabularies only for
  enums with a `sql` binding; `vocabulary_discharge` has none.
- `design/reader-lenses/decisions.md`: labels and enums have one source.

### C22

With a bound workspace the effective explanation is the newest row whose `ref_sha` resolves in
it; without one the newest row is effective and the reading is marked unchecked. A `withdrawn`
effective row, or a subsystem that is not explanation-eligible, reads as `not-recorded`. Earlier
rows are kept, and a correction is a new row that may share its predecessor's commit.

Evidence:
- `spec.md` §3.2.
- `mcp-server/src/invariants.ts:254-318`: `readVocabularyDischarge` applies the same rule to
  declinations.
- Practice catalog GP18: persistent revisable state; earlier versions are kept.

### C23

`record_explanation` refuses a subsystem that is not explanation-eligible, a project purpose, an
empty or unknown evidence list, an evidence set made only of `name-inferred` and
`pattern-matched` rows, an evidence set none of whose files is in the subsystem's ledger, and a
body over its cap; it sets no minimum length, and a successful write returns a receipt that does
not echo the body.

Evidence:
- `spec.md` §3.3, refusals R1–R8.
- Practice catalog GP10 (assertion authority is gated by what was examined), BP6
  (classification from naming), GP8 (a mechanical check on an authored field establishes its
  form and attribution, not its truth).
- `conspectus-vocabulary.json` `evidence_kind` includes `name-inferred` and `pattern-matched`.
- `design/reader-lenses/spec.md` §4.1: 4096 bytes per optional section.

### C24

`decline_explanation` records a reasoned declination as a row, limits the reason to 400 bytes
and one paragraph, uses its own refusal stems, and is accepted whether or not an explanation is
already recorded.

Evidence:
- `spec.md` §3.3.
- `design/survey-depth/decisions.md`: discharge or decline, never a floor.

### C25

Every transition of a subsystem into `mapped`, from any status including `deferred`, is refused
unless its effective purpose and effective account are each recorded or declined, through both
status writers; without a bound workspace a slot with a row proceeds with a report and a slot
with no row is refused; no other advance is gated and existing stores are not swept by the check.

Evidence:
- `spec.md` §3.4.
- `mcp-server/src/invariants.ts:138-141, 1017-1023`: a transition from `deferred` returns before
  any prerequisite is checked; `:969` is the `case "mapped"` branch.
- `mcp-server/src/invariants.ts:342-383`: the vocabulary gate's no-workspace behaviour.
- Practice catalog VP24: a retrofitted guard requires a historical sweep; the census of C9 is
  that sweep.

### C26

Every refusal sentence of `record_explanation` and `decline_explanation`, and the `mapped`
refusal, is registered in `refusal-parity.json` in the packet that introduces it, with a skill
reference that carries its phrase.

Evidence:
- `spec.md` §3.3, §3.4.
- `mcp-server/scripts/check-refusal-parity.mjs:604-626` fails on a `<tool> refuses:` sentence
  with no register entry; `mcp-server/test-refusal-parity.mjs`.

### C27

The structural phase records a purpose and a draft account; the adversarial phase reads both
against the code; packaging revises or confirms the account; the project account is recorded
once a subsystem reaches `structural`.

Evidence:
- `spec.md` §3.5.
- `.claude/skills/amanuensis/references/artifact-templates.md:321-325` describes a "Tier 1
  summary" produced during Phase 5; `references/phase-5-packaging.md` has no step that produces it.
- Practice catalog GP28: a derived artifact is derived from its sources and something asserts it back.

### C28

A skill reference `references/explanations.md` states what a purpose, a subsystem account and a
project account contain; each concept the project account relies on is a vocabulary term with an
expansion, an existing scoped term keeping its scope and a new cross-subsystem concept defined
without one.

Evidence:
- `spec.md` §3.5.
- `mcp-server/src/tools/vocabulary.ts:127-137`: `define_term` keeps an existing `subsystem_id`
  when none is passed.
- `SELECT count(*), sum(subsystem_id IS NOT NULL) FROM vocabulary;` → all terms are scoped.

### C29

A subsystem page opens with `## Purpose` only when a purpose is recorded or declined; in the
not-recorded state it opens with `## Scope` and the existing no-purpose sentence; scope is never
relabelled as purpose.

Evidence:
- `spec.md` §3.6, §7.
- `materializer/amanuensis_materializer/renderers.py:122-130, 1122-1144`.
- `materializer/test-lens-pages.py` asserts the section order and the no-purpose sentence.

### C30

Every explanation rendered as its own section carries a provenance line with its revision, its
evidence count and a computed ageing sentence; a purpose repeated on another page is an excerpt
that links to that section; an explanation whose cited files changed is still rendered, and a
change that cannot be measured is reported as not measured.

Evidence:
- `spec.md` §3.6, §3.7.
- `dev/adr/0001-living-conspectus-terms.md` defines stale for authority-bearing objects;
  `README.md` item 8 of this design states explanations are orientation, not authority.
- Practice catalog GP27 (the ageing sentence is computed by code, with no model) and BP22
  (unreadable is not scored as absent).

### C31

The orientation lint applies at publication to every recorded purpose, account and declination
reason, on the subsystem pages and the architecture page; violating text is not printed, a
refusal sentence takes its place and the publish fails, which requires passing the failure
callback to those renderers.

Evidence:
- `spec.md` §3.6, §3.7.
- `materializer/amanuensis_materializer/lint.py:1-30`; `renderers.py:260-284` applies it to the thesis.
- `materializer/amanuensis_materializer/core.py:494` passes `warn=self._warn` to `render_index`
  only; `:534` builds subsystem pages without it.

### C32

A recorded account takes precedence over the claim count: once a subsystem has one, its survey
narrative renders under `## Survey record` and not inside `## Structure`, with or without
current claims.

Evidence:
- `spec.md` §2.3; `decisions.md` §1.
- `mcp-server/src/tools/impact.ts:437-459` closes subsystem-subject claims without changing the
  subsystem's status, so an account with no current claim is reachable.

### C33

The master plan carries each subsystem's recorded purpose in a Purpose column, with `|` replaced
as neighbouring cells do, and a subsystem id's hover definition is its name and the first
sentence of its recorded purpose as `_compact_definition` compacts it.

Evidence:
- `spec.md` §3.7.
- `materializer/amanuensis_materializer/renderers.py:944-996`; `core.py:92-107` keeps the first
  sentence, capped at 220 characters.

### C34

The architecture page opens with `## How the parts fit together`: the project account with its
provenance line, or its declination, or the no-account sentence; then one line per subsystem
carrying its purpose or the state's label.

Evidence:
- `spec.md` §3.7.
- `docs/architecture.md`: three of its four sections are empty-state sentences.

### C35

The census reports `subsystem-purpose`, `subsystem-account` and `project-account` slots; a
subsystem that is not explanation-eligible contributes no explanation-slot row and keeps its
vocabulary row; `project-account` applies only when a subsystem is eligible.

Evidence:
- `spec.md` §2.5, §3.7.
- C23: nothing can be recorded for an ineligible subsystem.
- `docs/subsystems/b06-report-interface-design-and-validation-studies.md` prints both the
  no-purpose sentence and the vocabulary not-recorded sentence for an `unmapped` subsystem.

### C36

`mcp-server/src/tools/locus.ts` and the locus contract are not modified.

Evidence:
- `spec.md` §3.8; `decisions.md` §5.
- `mcp-server/test-locus-compactness.mjs:40-50`: the response floor leaves room for "nought to
  two items" under the 8192-byte default.

### C37

`dev/measure-locus-default.mjs` reports, for a default `describe_locus` call on each given
locus, the wire bytes, payload bytes, floor, budget and items served and omitted per section,
measured over a temporary copy of the store.

Evidence:
- `spec.md` §3.8.
- `dev/record-dogfood-receipt.mjs:78-200` spawns the built server and measures `wire_bytes`.

### C38

The explain pass records or declines a purpose and an account for each subsystem at `structural`
or later in this repository's store, records the project account, leaves lower subsystems
untouched, and republishes.

Evidence:
- `spec.md` §5; `decisions.md` §2.
- `SELECT id, status FROM subsystems ORDER BY id;` → B-01 to B-04 `adversarial`, B-05 and B-07
  `concerns`, B-06, B-08 and B-09 `unmapped`.

### C39

The four receipt-bound gates are outside ordinary packets' regression lists and inside the two
republishing packets and the completion commands; review documents are untracked.

Evidence:
- `spec.md` §0.3.
- `node dev/test-survey-depth-acceptance.mjs` → `[binding]: the receipt's ledger accounts for 652
  path(s) and 656 are tracked at ee12bed`.

### C40

Five gates that are red or unable to run at baseline are named and left unrestored, and the
`rebuild-*` receipts are not re-recorded.

Evidence:
- `spec.md` §4.1.
- In the lane worktree at baseline: `node dev/test-rebuild-regeneration.mjs` exit 1;
  `node dev/test-rebuild-depth.mjs` exit 2; `node dev/test-pecia-carry-audit.mjs` exit 1;
  `node dev/test-amanuensis-pecia-defects.mjs` exit 1; `node dev/test-activation-evidence.mjs` exit 1.

### C41

Where this design changes a rule an existing assertion encodes for one state, the assertion
becomes conditional on that state and keeps its must-fail case; a literal that changes in every
state is replaced and listed in `spec.md` §7; a later packet may extend an earlier gate file only
where the specification names the extension, and only by adding cases.

Evidence:
- `spec.md` §0.1, §0.2, §7.
- Practice catalog VP25: a gate edited after it fires needs a red proof in the same change.

### C42

A read tool `get_explanations` returns, for a subject, each slot's effective state and row and a
count of earlier rows, with zero model calls; the authoring phases read explanations through it;
`describe_locus` is unchanged.

Evidence:
- `spec.md` §3.3, §3.5, §3.8.
- `mcp-server/src/tools/locus.ts` serves `purpose: null` and has no account section.

### C43

`reset_subsystem` appends a `withdrawn` row for each slot of the subsystem that has a row, so a
reset subsystem has no effective explanation and owes a new one.

Evidence:
- `spec.md` §3.1.
- `mcp-server/src/tools/subsystems.ts:316-372`: a reset deletes the subsystem's claims, findings,
  ledger and artifacts and returns its status to an earlier rung.

### C44

A page that renders an explanation lists the explanation rows among its sources, and the
read-back's state axis checks that every effective recorded explanation's body is on the page
that owes it.

Evidence:
- `spec.md` §3.6.
- `materializer/amanuensis_materializer/renderers.py:1439-1453`: a page re-renders when one of
  its listed sources changes.
- `mcp-server/test-structural-claims.mjs` has the equivalent custody check for claims.

### C45

`vocabulary.expansion` renders on the vocabulary page for a term scoped to a subsystem, as it
does for a codebase-wide term.

Evidence:
- `spec.md` §2.1.
- `materializer/amanuensis_materializer/renderers.py:2352-2361` prints only the gloss for a
  scoped term.

### C46

The effective-row rule has one shared case file, `mcp-server/contracts/explanation-effective-cases.json`,
which both the TypeScript reader's gate and the Python reader's gate run, so the Python gate
needs no built server.

Evidence:
- `spec.md` §3.2.
- `.github/workflows/test.yml:586-625`: the materializer job installs Python and ruff and does
  not install or build `mcp-server`.

