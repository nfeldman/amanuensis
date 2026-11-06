# Explanation: claims packet

Reviewers see this file, `spec.md`, `plan.json`, `plan.md`, `decisions.md` and a history-free
snapshot of the repository. Each claim is one normative decision. Evidence is a file with a line
number, a command with its result, a specification section, or a practice-catalog id. Catalog
ids refer to `~/research/practice-audit/practice-catalog.md` version 3.7 (2026-10-15).

The self-conspectus store may be read at
`sqlite3 "file:/Users/nfeldman/repos/amanuensis/.amanuensis/memory.db?mode=ro"`.

---

### C1

`findings.business_context` renders on every full finding record, open and resolved, as a field
labelled **Why it matters**; a finding without one renders no such field.

Evidence:
- `spec.md` §2.1.
- `rg -n business_context materializer/amanuensis_materializer/` returns no match in a renderer.
- `SELECT count(*), sum(business_context IS NOT NULL AND business_context <> '') FROM findings;` → `11|11`.
- `git show d302237 --stat` removed the `_Business context_` line from finding records.

### C2

`subsystems.notes` renders on the subsystem page whenever non-empty, as `### Survey note` under
`## Scope`, labelled as not bound to a revision, and appears once on the page.

Evidence:
- `spec.md` §2.1.
- `materializer/amanuensis_materializer/renderers.py:1187-1208` prints the notes only when the
  subsystem has no claim and no survey artifact.
- `SELECT count(*) FROM subsystems WHERE notes IS NOT NULL AND notes <> '';` → `9`.

### C3

A retention gate seeds a sentinel in every model-authored field and requires each to reach a
generated page, with a reasoned allowlist that fails when an allowlisted field does render.

Evidence:
- `spec.md` §2.1.
- `design/reader-lenses/spec.md:420-426` lists the model-authored durable fields.
- Practice catalog VP4: every gate must be able to turn red; the two-sided allowlist is that case.

### C4

A claim renders as a list item whose first text is its statement, followed by one coordinate
line carrying the claim key, subject, epistemic kind, asserting revision and evidence; no claim
has its own heading.

Evidence:
- `spec.md` §2.2.
- `materializer/amanuensis_materializer/renderers.py:1168-1186` renders a five-column table with
  the claim key in the first column.
- `.claude/skills/amanuensis/references/reporting-style.md`: an opaque identifier is "a
  coordinate plus a definition".
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

Each claim record lists the files its `claim_evidence` rows cite, with a line range where the
evidence row has one, and prints `evidence: none attached` when no row is attached.

Evidence:
- `spec.md` §2.2.
- `mcp-server/src/schema.sql:1326-1331` defines `claim_evidence`.
- No renderer joins `claim_evidence`: `rg -n claim_evidence materializer/amanuensis_materializer/renderers.py`
  matches only the Structure membership query at `:1086-1091`.

### C7

When a subsystem has current claims and no recorded account, its survey narrative renders inside
`## Structure` after the claim groups under `### Survey narrative`, with the existing unbound
label and provenance; the survey record then carries a pointer and the narrative never renders
twice.

Evidence:
- `spec.md` §2.3; `decisions.md` §1.
- `materializer/amanuensis_materializer/renderers.py:1161-1215, 1422-1436`.
- `.claude/skills/amanuensis/references/phase-2-structural.md` requires a claim before a
  subsystem advances, so the zero-claim branch is unreachable for a surveyed subsystem.

### C8

The subsystem file ledger renders as groups of rows sharing a classification and a reason; each
reason prints once per group and every path keeps its ledger anchor exactly once.

Evidence:
- `spec.md` §2.4.
- `materializer/amanuensis_materializer/renderers.py:1391-1404`.
- `SELECT subsystem_id, count(*), count(DISTINCT why_in_scope) FROM file_ledger GROUP BY 1;`
  shows subsystems whose rows outnumber their distinct reasons several times over.
- `materializer/amanuensis_materializer/renderers.py` `render_files` links to
  `ledger_entry_anchor` targets.

### C9

`materialize_docs` returns `unfilled_slots`, one row per placeholder the pages render, each
naming the slot, page, subject, state and the call or edit that discharges it; rows and rendered
placeholders are produced by the same predicates.

Evidence:
- `spec.md` §2.5.
- `materializer/amanuensis_materializer/core.py:259-432` returns the publish summary;
  `mcp-server/src/tools/materialize.ts` passes summary keys through.
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
Markdown by the definitions in `spec.md` §1, and records labelled totals bound to the published
contract hash; no gate compares the figures with a threshold.

Evidence:
- `spec.md` §1.
- `decisions.md` §6 excludes a gate on above-the-fold prose share.

### C14

`dev/republish-docs.mjs` runs the republish chain as ordered, injectable steps; it stops before
publishing when a tracked path is unledgered, stops before promoting on a red read-back, never
reconciles after publishing, and rewrites the derived rows of `survey-progress.json`.

Evidence:
- `spec.md` §4.2.
- `dev/record-dogfood-receipt.mjs` reads the publish mode from the promotion receipt, which
  `dev/promote-docs.mjs` writes only with `--publish-summary`.
- `dev/test-reader-lenses-dogfood.mjs:55-57` compares the store's `last_checked_sha` with the receipt.
- `dev/test-survey-depth.mjs:1308-1330` requires the progress record's `end` row to equal the
  receipt's; `rg -l survey-progress dev/` names no writer.
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
id and slot, with a disposition, a body, a revision and a session; a project subject admits only
the `account` slot.

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

The `entries` table is not used.

Evidence:
- `spec.md` §3.1; `decisions.md` §6.
- `mcp-server/src/schema.sql:28-49`: `entries` holds a pointer to a prose section and no body.

### C21

Three enums, `explanation_subject`, `explanation_slot` and `explanation_discharge`, are added to
`conspectus-vocabulary.json` with a label, meaning and `cannot_justify` per value;
`claim_subject_type` is unchanged.

Evidence:
- `spec.md` §3.1.
- `mcp-server/contracts/conspectus-vocabulary.json`: `vocabulary_discharge` is the pattern.
- `design/reader-lenses/decisions.md`: labels and enums have one source.

### C22

The effective explanation for a subject and slot is the newest row whose `ref_sha` resolves in
the workspace; earlier rows are kept; a correction is a new row and may share its predecessor's
commit.

Evidence:
- `spec.md` §3.2.
- `mcp-server/src/invariants.ts:254-318`: `readVocabularyDischarge` applies the same rule to
  declinations.
- Practice catalog GP18: persistent revisable state; earlier versions are kept.

### C23

`record_explanation` refuses a subsystem below `structural`, a project purpose, missing or
name-only evidence, evidence outside the subsystem's ledger, and a body over its cap; it sets no
minimum length.

Evidence:
- `spec.md` §3.3, refusals R1–R8.
- Practice catalog GP10 (authority bounded by survey depth), BP6 (classification from naming),
  BP4 (a quota on an authored field).
- `conspectus-vocabulary.json` `evidence_kind` includes `name-inferred` and `pattern-matched`.
- `design/reader-lenses/spec.md` §4.1: 4096 bytes per optional section.

### C24

`decline_explanation` records a reasoned declination as a row, and is accepted whether or not an
explanation is already recorded.

Evidence:
- `spec.md` §3.3.
- `design/survey-depth/decisions.md`: discharge or decline, never a floor.

### C25

Advancing a subsystem to `mapped` is refused unless its effective purpose and effective account
are each recorded or declined, through both status writers; no other advance is gated and
existing stores are not swept by the check.

Evidence:
- `spec.md` §3.4.
- `mcp-server/src/invariants.ts:342-383, 933-938` and `mcp-server/src/tools/subsystems.ts:127-133, 201-207`:
  the vocabulary gate and its two call sites.
- Practice catalog VP24: a forward-only gate needs a separate sweep of what already exists;
  the census of C9 is that sweep.

### C26

The `mapped` refusal is registered in `refusal-parity.json` and quoted by
`references/phase-5-packaging.md`.

Evidence:
- `spec.md` §3.4.
- `mcp-server/contracts/refusal-parity.json`; `mcp-server/test-refusal-parity.mjs`.

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
project account contain, and cross-cutting concepts are recorded as codebase-wide vocabulary
terms with expansions.

Evidence:
- `spec.md` §3.5.
- `mcp-server/src/tools/vocabulary.ts:63-82`: `define_term` takes an `expansion` and an optional
  `subsystem_id`.
- `rg -n -i 'purpose|how it works|cross-cutting' .claude/skills/amanuensis/references/phase-*.md`
  finds no instruction to explain either.

### C29

A subsystem page opens with `## Purpose` only when a purpose is recorded or declined; in the
not-recorded state it opens with `## Scope` and the existing no-purpose sentence; scope is never
relabelled as purpose.

Evidence:
- `spec.md` §3.6, §7.
- `materializer/amanuensis_materializer/renderers.py:122-130, 1122-1144`.
- `materializer/test-lens-pages.py` asserts the section order and the no-purpose sentence.

### C30

Every rendered explanation carries a provenance line with its revision, its evidence count and a
computed ageing sentence; an explanation whose cited files changed is still rendered, and a
change that cannot be measured is reported as not measured.

Evidence:
- `spec.md` §3.6.
- `dev/adr/0001-living-conspectus-terms.md` defines stale for authority-bearing objects;
  `README.md` item 8 of this design states explanations are orientation, not authority.
- Practice catalog GP27 (the ageing sentence is computed by code, with no model) and BP22
  (unreadable is not scored as absent).

### C31

The orientation lint applies to every recorded purpose and account at publication; a violating
body is not printed, a refusal sentence takes its place and the publish fails.

Evidence:
- `spec.md` §3.6.
- `materializer/amanuensis_materializer/lint.py:1-30`; `renderers.py:260-284` applies it to the thesis.
- `design/reader-lenses/spec.md` §11.1.

### C32

Once a subsystem has a recorded account, its survey narrative renders under `## Survey record`
and not inside `## Structure`.

Evidence:
- `spec.md` §2.3 row 3; `decisions.md` §1.

### C33

The master plan carries each subsystem's recorded purpose in a Purpose column, and a subsystem
id's hover definition is its name and recorded purpose.

Evidence:
- `spec.md` §3.7.
- `materializer/amanuensis_materializer/renderers.py:944-996`; `core.py:92-107, 571-642`.

### C34

The architecture page opens with `## How the parts fit together`: the project account with its
provenance line, then one line per subsystem carrying its purpose or "no purpose recorded".

Evidence:
- `spec.md` §3.7.
- `docs/architecture.md`: three of its four sections are placeholder sentences.

### C35

The census reports `subsystem-purpose`, `subsystem-account` and `project-account` slots, and a
subsystem below `structural` contributes no row.

Evidence:
- `spec.md` §2.5, §3.7.
- C23: nothing can be recorded for such a subsystem.

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

Where this design changes a rule an existing assertion encodes, the assertion becomes
conditional on the state it describes and keeps its must-fail case.

Evidence:
- `spec.md` §0.2, §7.
- Practice catalog VP25: a gate edited after it fires needs a red proof in the same change.
