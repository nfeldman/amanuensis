# Explanation: specification

Normative. `README.md` is the proposal; `decisions.md` binds this document; `claims.md` lists
each decision here as a numbered claim; `plan.json` packetizes the work.

Paths are relative to the repository root. "The store" is `.amanuensis/memory.db` with the
Markdown artifacts beside it. "The materializer" is `materializer/amanuensis_materializer/`.
"The server" is `mcp-server/src/`.

---

## 0. Conventions that apply to every packet

### 0.1 Gate protocol

Each packet has one gate, a new test file that is no other packet's gate. A later packet may
extend an earlier packet's gate file where this specification names the extension (EX6 and EX12
extend the census gate; EX9 and EX11 edit the retention gate's allowlist; EX8 and EX14 may extend
the republish gate). An extension adds cases and never removes one.

- The gate prints exactly one status line on stdout, last: `GATE <packet-id> RED: <one-line reason>`
  with a non-zero exit, or `GATE <packet-id> GREEN` with exit 0. The packet id is the plan's id
  (`EX1` … `EX15`; `EX15` runs between `EX9` and `EX10`), whatever else the test calls itself.
- The gate must reach its assertions on the tree before the packet's deliverables exist. Load
  the code under test defensively (a guarded import, a guarded file read, a subprocess whose
  failure is caught) so that absence prints the RED line and not a stack trace.
- The red output must contain the packet's `gate.red_expect` phrase and none of its
  `gate.red_rejects` strings. A wrapper gate that runs other programs prints its own summary
  lines only and never echoes a child's raw output, which can carry those strings.
- A gate asserts values and behaviour, not presence. A stub must turn it red.
- At the red commit, the first assertion to fail is the one the plan's `red_expect` names.
  Order the assertions so that it is.
- Every new gate is added to `.github/workflows/test.yml` in the job that runs its neighbours,
  and the gate asserts that it is listed there, as existing gates do.

### 0.2 Nothing is weakened

No existing test, gate, checker or read-back axis is deleted or relaxed. Where this
specification changes a rule an existing assertion encodes, the assertion becomes conditional on
the state it describes and keeps its must-fail case: the old sentence is still required in the
state where it is still true, and a control proves the new state cannot be reached without its
record. §7 lists every such assertion.

### 0.3 Receipt-bound gates

Four gates bind committed receipts to the tracked tree and to the live store:

| Gate | Command |
|---|---|
| P18 | `node dev/test-reader-lenses-dogfood.mjs` |
| P10 / D0 | `node dev/test-survey-depth.mjs` |
| P11 / A1 | `node dev/test-survey-depth-acceptance.mjs` |
| carried references | `node dev/test-carried-finding-references.mjs` |

Any commit that adds or removes a tracked path, republishes `docs/`, or reconciles the store
moves at least one of them. They are therefore **not** in the regression list of ordinary
packets. They are owned by the two packets that republish (EX8 and EX14) and by the plan's
completion commands. A fix session that adds or removes a tracked path, or changes what the
materializer emits, reruns §4.2 as its last step.

Review documents under `design/explanation/reviews/` are untracked for the same reason. The
launcher keeps them on disk and copies them to the lane's reports.

### 0.4 Register

Every label, hint and sentence the materializer emits follows
`.claude/skills/amanuensis/references/reporting-style.md`. Fixed sentences are defined once as
module constants and reused; no page restates a count that a record already carries.

---

## 1. Measuring what a reader sees (EX1)

`dev/measure-reader-prose.mjs <docs-dir>` reads the generated Markdown pages (`*.md`, recursively,
excluding files beginning with `.`) and prints JSON:

```json
{
  "pages": [{ "page": "subsystems/b04-….md", "table_chars": 0, "prose_chars": 0,
              "table_share": 0.0, "placeholders": 0 }],
  "totals": { "pages": 0, "table_chars": 0, "prose_chars": 0, "table_share": 0.0,
              "placeholders": 0 }
}
```

Definitions, fixed here so that before and after are comparable:

- A **table line** is a line whose first non-space character is `|`. `table_chars` is the count
  of characters on table lines, excluding the separator row and the `|` delimiters.
- **Prose** is every other non-blank line that is not a heading, not inside a fenced block, and
  not a table line. `prose_chars` counts its characters.
- `table_share` is `table_chars / (table_chars + prose_chars)`, rounded to four places, and
  `0` when both are zero.
- A **placeholder** is one occurrence of a string in the script's fixed list
  `MEASURE_PLACEHOLDERS`. The list is set once, in EX1, and never changes, so every recorded
  label counts the same thing:
  1. `No thesis section is recorded`
  2. `The recorded thesis carries status vocabulary and was not published`
  3. `The recorded thesis presents a composite index of the record and was not published`
  4. `No purpose statement is recorded for this subsystem`
  5. `No structured runtime boundary map is recorded yet`
  6. `**Domain vocabulary** — not recorded`
  Each entry in `reader-measure.json` carries `placeholder_list_sha256`, the hash of that list
  joined by newlines, and the gates that read the file require every entry to carry the same
  hash. EX6's gate asserts that each of the six strings occurs in a sentence the materializer
  can emit, so the list cannot drift from the renderer.

`--record <label>` appends an entry `{label, commit, contract_sha256, placeholder_list_sha256, totals}` to the `entries`
array of `design/explanation/reader-measure.json`, where `contract_sha256` is the hash of
`docs/.projection-contract.json`. Recording a label that already exists replaces that entry and
moves it to the end. EX1 records `before`. The republish script records `recovered` in EX8 and
`explained` in EX14 (§4.2). The gates that read this file require the **last** entry to be bound
to the committed contract hash, so a rerun of the chain keeps the record true.

The gate builds a three-page fixture with known counts and asserts the exact numbers, including
a page that is all table, a page with a fenced block containing `|`, and a page with two
placeholders.

This is a measurement. No gate compares it with a threshold.

---

## 2. Recovering prose that exists

All changes in this section are in `materializer/amanuensis_materializer/renderers.py` unless
stated, and each changes the bytes of `docs/` only when `docs/` is republished (EX8).

### 2.1 Prose retention (EX2)

**`findings.business_context`** renders on every full finding record as **Why it matters**,
after the symptom and before the root cause.

- On the open-findings page the Markdown is a table (`_finding_table`), so **Why it matters**
  is a column present for every row, and its cell is empty for a finding with no business
  context.
- On the resolved-findings page the Markdown is a record list, and the field is omitted for a
  finding with none.
- In HTML both pages render finding records (`html_projection.py`, the finding branch and
  `_RECORD_PROJECTIONS`); the field is added there in the same change and is omitted from a
  record whose value is empty.

The header literal asserted at `materializer/test-materializer.py:465` changes to the new
header for every state; §7 lists it.

**`vocabulary.expansion`** renders on the vocabulary page for a term scoped to a subsystem, as
it already does for a codebase-wide term. At baseline the page prints only the gloss for a
scoped term (`renderers.py`, `render_vocabulary`, the "Scoped to" branch), and all eight terms
in the self-conspectus are scoped.

**`subsystems.notes`** renders on the subsystem page whenever it is non-empty, directly after
the scope text, as:

```
### Survey note

*A note the survey left on the subsystem record; not bound to a revision.*

<notes, verbatim>
```

It is an H3 under `## Scope`, never a new H2: a heading inside the note is nested beneath the H3,
and only its level moves (final review, F17/claude). The existing fallback that prints the notes
under Structure when there are no claims and no artifact is removed, so the notes appear once.

**The retention gate** (`materializer/test-prose-retention.py`) seeds a store in which every
model-authored field carries a unique sentinel string, materializes it, and asserts that each
sentinel appears on at least one generated page. The fields are the list in
`design/reader-lenses/spec.md` §3.4:

`subsystems.scope`, `subsystems.jump_in_reading`, `subsystems.notes`, `claims.statement`,
`findings.symptom`, `findings.root_cause`, `findings.business_context`,
`dispositions.rationale`, `finding_resolution_events.rationale`, `field_notes.observation`,
`open_questions.question`, `open_questions.what_assumed`, `open_questions.answer`,
`vocabulary.gloss`, `vocabulary.expansion` (seeded on one scoped term and one codebase-wide
term), the eight seam prose columns named below, and the survey artifact.

A field that is deliberately not rendered is named in an allowlist in the test, each entry with
a reason. The allowlist is two-sided: an allowlisted field whose sentinel **does** appear fails
the gate, so the list cannot go stale. At EX2 the allowlist holds exactly the eight seam prose
columns that no renderer reads, `a_writes`, `a_reads`, `b_writes`, `b_reads`,
`ordering_assumption`, `cardinality`, `staleness_tolerance` and `schema_owner`, each with the
reason "no published conspectus records a seam; rendering is deferred". `seams.shared_object`
and `seams.notes` are seeded and must render. EX9 adds
`explanations.body` to the seeded fields with an allowlist entry "rendered by EX11", and EX11
removes that entry.

### 2.2 Claims as a register (EX3)

The Structure section's claim tables become lists. For each group:

```
### <group heading>

- <statement>
    - `<claim_key>` · subject `<subject_id>` · <epistemic kind label> · asserted at `<sha8>` · evidence: `<path>:<line_range>`, `<path>` (contradicts)
```

- The statement is the first text of the item, verbatim. Its coordinates are one nested list
  item beneath it, indented four spaces. There is no per-claim heading.
- `evidence:` lists the claim's `claim_evidence` rows joined to `evidence`, in evidence id
  order: the file path, with `:<line_range>` when `evidence.line_range` is set, and the row's
  role in parentheses when it is not `supports`. A claim with no attached row prints
  `evidence: none attached`.
- **HTML.** `html_projection.py`'s list parser flattens an indented item into its parent list
  and joins continuation lines into one run. It gains one level of nesting: an item indented
  deeper than its list's first item becomes a child `<ul>` of the preceding `<li>`. The gate
  renders the page to HTML and asserts that each statement is its own `<li>` whose coordinates
  are in a nested `<ul>`, with no script involved. Where an existing page's HTML changes only
  because its Markdown already nested an item, the nested rendering is the correct one.
- **Grouping.** The group is the first segment of the claim key after `<sid>/`. The five
  recognised segments keep their headings (`CLAIM_KIND_HEADINGS`). Any other segment is its own
  group, headed by the segment with hyphens replaced by spaces and its first letter capitalised:
  `recoverability` → **Recoverability**, `storage-lifecycle` → **Storage lifecycle**. Groups
  render in the order: the five recognised kinds, then other segments alphabetically, then
  **Other claims**, which now holds only claims whose key is outside this subsystem's namespace.
- The introductory sentence above the groups is unchanged.

`mcp-server/test-structural-claims.mjs` reads the text under each `###` up to the next heading
and must stay green.

### 2.3 Narrative with the structure it describes (EX4, completed by EX11)

Owner decision 1. When a subsystem has a registered survey artifact:

| Recorded account (§3.2) | Current claims | Where the narrative renders |
|---|---|---|
| no | none | Under `### Structural inventory not recorded as claims`, as today |
| no | one or more | Inside `## Structure`, after the last claim group, under `### Survey narrative` |
| yes | any | Under `## Survey record`, as `### Survey artifact`, as today |

A recorded account takes precedence whatever the claim count. A subsystem can hold an account
and no current claim, since `apply_change_impact` closes claims without changing status.

In the second row the block is:

```
### Survey narrative

*Narrative from the survey artifact; not individually bound to a revision.* Its source is <provenance>.

<artifact prose, nested>
```

using the existing `NARRATIVE_LABEL` and `provenance`. The survey record then carries
`### Survey artifact` with the one sentence "The survey artifact is rendered above, under
Structure." and its provenance. The narrative never renders twice on one page.

EX4 implements the first two rows with the third unreachable, since no account record exists
yet. EX11 adds the third and its gate seeds a recorded account both with and without current
claims.

### 2.4 The file ledger groups repeated reasons (EX5)

The subsystem page's file ledger becomes a list of groups. Rows are grouped by
`(classification, why_in_scope)`; a row with a unique pair is a group of one. Groups keep the
existing order (classification, then the first path).

```
- **<why_in_scope>** — <classification>, <n> file(s), <revision label> `<sha8>`
    - <a id="<anchor>"></a>`<path>`
    - <a id="<anchor>"></a>`<path>`
```

- Every path is its own nested list item and keeps its `ledger_entry_anchor` anchor, exactly
  once. In HTML the paths are a nested `<ul>` under the group's `<li>` (§2.2's nesting).
- The revision label is `examined at` only for the classification `examined`. For every other
  classification it is `recorded at`: `file_ledger.ref_sha` is set for all classifications and
  `examined_at` only for examined rows, so a revision on a candidate or exempt row is the
  revision it was recorded at and not an examination.
- When a group's rows carry more than one `ref_sha`, the head line says `<revision label> <k>
  revisions` and each path is followed by its own `` (`<sha8>`) ``. An absent `ref_sha` is not
  counted as a revision (final review, F18/claude).
- A row with no reason groups under **No reason recorded**; a row with no revision prints
  `no revision recorded`, on the head when no row in the group has one and beside its own path
  otherwise.
- The page-level `files.md` and its links are unchanged.

### 2.5 The unfilled-slot census (EX6)

`Materializer.materialize()` returns a new key `unfilled_slots`, and `materialize_docs` passes
it through. Each row:

```json
{ "slot": "thesis", "page": "index.md", "subject": "project",
  "state": "absent", "discharge": "add a '## What is this codebase?' section to entry-point.md" }
```

The census has one row per **slot that applies and is unfilled**. The slots are exactly these
six; no other empty-state sentence on any page ("No seams recorded yet", "No dependency edges
are recorded") is a slot.

| Slot | Subject | Applies to | Unfilled states | Sentence on the page |
|---|---|---|---|---|
| `thesis` | `project` | always | `absent`, `refused` | `THESIS_ABSENT`, `THESIS_REFUSED`, `THESIS_REFUSED_COMPOSITE` |
| `runtime-boundary-map` | `project` | always | `absent` | the architecture page's "No structured runtime boundary map is recorded yet." |
| `subsystem-vocabulary` | subsystem id | every subsystem | `not-recorded` | the vocabulary section's not-recorded sentence |
| `subsystem-purpose` | subsystem id | an explanation-eligible subsystem (§3.1) | `not-recorded` | `NO_PURPOSE_*` (added by EX12) |
| `subsystem-account` | subsystem id | an explanation-eligible subsystem | `not-recorded` | none: the section is absent (added by EX12) |
| `project-account` | `project` | when at least one subsystem is explanation-eligible | `not-recorded` | §3.7's no-account sentence (added by EX12) |

- For each slot there is one predicate function returning its state for a subject. The renderer
  calls it to decide what to print, and the census calls it to decide whether to emit a row.
- **Correspondence**, asserted by the gate on fixtures, is scoped to the slots that have a
  sentence: a row exists if and only if that slot's sentence is on that page, **for subjects the
  slot applies to**. A subsystem that is not explanation-eligible prints `NO_PURPOSE_*` and has
  no `subsystem-purpose` row; the gate asserts that exemption as a control, including a
  `deferred` subsystem. `subsystem-account` has no sentence, so its assertion is one-directional:
  a row exists if and only if an eligible subsystem's page has no `## How it works` section and
  no account declination.
- A declined slot is filled and has no row.
- `discharge` names the tool call or the file edit that fills the slot.
- `PLACEHOLDER_SENTENCES` is exported from the materializer: the tuple of fixed sentences above.
- The gate's fixtures cover: no eligible subsystem (no `project-account` row); an eligible
  subsystem with nothing recorded; every slot declined; every slot recorded.
- The census is **not a guard**. Publication never halts on an unfilled slot, and no text calls
  the census a gate.
- A store with every slot filled returns an empty list, and the gate asserts that control.

**Skill text.** `references/onboarding.md` names both shapes literally where it asks for them:
the thesis goes under the heading `## What is this codebase?`, and the runtime boundaries go
under `## Runtime boundary map` as the five-column table `artifact-templates.md` already shows.
`references/phase-5-packaging.md` step 5 reads `unfilled_slots` from the `materialize_docs`
result and, for each row, either fills the slot or reports it in the session summary.

**Parity.** The gate asserts that the headings the skill references name match the renderer's
patterns: `THESIS_SECTION_PATTERN` matches the heading in `onboarding.md` and in
`artifact-templates.md`, and the runtime boundary heading and column names in both files are
the ones `diagrams.py` requires.

---

## 3. The explanation record

### 3.1 Storage (EX9)

```sql
CREATE TABLE IF NOT EXISTS explanations (
    id            INTEGER PRIMARY KEY,
    subject_type  TEXT    NOT NULL CHECK (subject_type IN ('subsystem','project')),
    subject_id    TEXT    NOT NULL,   -- a subsystem id, or the literal 'project'
    slot          TEXT    NOT NULL CHECK (slot IN ('purpose','account')),
    disposition   TEXT    NOT NULL CHECK (disposition IN ('recorded','declined','withdrawn')),
    body          TEXT    NOT NULL,   -- the explanation, or the reason none is written or it was withdrawn
    ref_sha       TEXT    NOT NULL,
    session_id    TEXT    NOT NULL REFERENCES sessions(session_id),
    recorded_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (length(body) > 0),
    CHECK (subject_type <> 'project' OR (subject_id = 'project' AND slot = 'account'))
);

CREATE TABLE IF NOT EXISTS explanation_evidence (
    explanation_id INTEGER NOT NULL REFERENCES explanations(id) ON DELETE RESTRICT,
    evidence_id    INTEGER NOT NULL REFERENCES evidence(id)     ON DELETE RESTRICT,
    PRIMARY KEY (explanation_id, evidence_id)
);
```

Both tables are append-only: an immutability trigger and a no-delete trigger each, registered in
`mcp-server/contracts/append-only-tables.txt`, following `vocabulary_declinations`. They are
created by the ordinary schema path, so an existing store gains them on open
(`mcp-server/test-existing-store-migration.mjs` stays green).

Three enums are added to `mcp-server/contracts/conspectus-vocabulary.json`, each value with a
`label`, `meaning` and `cannot_justify`, and generated into both vocabulary modules:

| Enum | Values | `sql` binding |
|---|---|---|
| `explanation_subject` | `subsystem`, `project` | `explanations.subject_type` |
| `explanation_slot` | `purpose`, `account` | `explanations.slot` |
| `explanation_disposition` | `recorded`, `declined`, `withdrawn` | `explanations.disposition` |
| `explanation_discharge` | `recorded`, `declined`, `not-recorded` | none: it is computed, like `vocabulary_discharge` |

The three bound enums follow the generator's existing `sql` binding (`scripts/gen-vocabulary.mjs`),
so the existing vocabulary checks cover their CHECK lists. `explanation_discharge` is the state a
reader sees and is never stored; `not-recorded` is the absence of an effective row. Reader-facing
text for a state comes from `labels("explanation_discharge")` and `meanings(...)`, never from a
literal in a renderer. `cannot_justify` for `recorded` says that the record establishes who
wrote the explanation, at which revision and over which evidence, and not that it is true.
`claim_subject_type` is unchanged.

**Explanation-eligible.** A subsystem is explanation-eligible when its status is `structural`,
`concerns`, `adversarial` or `mapped`. The contract's `subsystem_status` values gain a boolean
field `explanation_eligible`, generated into both vocabulary modules, and the tools, the gate,
the renderers and the census all read that one field. `unmapped`, `scoping` and `deferred` are
not eligible.

**Reset.** `reset_subsystem` appends a `withdrawn` row, with the reset's reason as its body, for
each slot of that subsystem that has any row. The rows before it are kept. A resurveyed
subsystem therefore starts with no effective explanation and owes a new one.

### 3.2 The effective explanation (EX9)

For a `(subject_type, subject_id, slot)`:

- **With a bound workspace**, the effective row is the row with the greatest `id` whose
  `ref_sha` resolves to a commit in that workspace.
- **Without a bound workspace**, nothing can be resolved: the row with the greatest `id` is
  effective and the reading carries `checked: false`, as `readVocabularyDischarge` does. A path
  is bound when git reports it inside a work tree; a directory that is no repository, a path that
  does not exist and a repository whose metadata has gone are not bound. Settled by the final
  review (F2/codex, F19/claude), where the two readers disagreed on such a path; the shared case
  file carries the rule as `workspace_binding`.

The state is `recorded` or `declined` when the effective row has that disposition, and
`not-recorded` when there is no effective row or the effective row is `withdrawn`. For a
subsystem that is not explanation-eligible the state is `not-recorded` whatever rows exist. The
project's account is read the same way while no subsystem is explanation-eligible: that is the
condition it is written under (R3) and the condition its census slot applies under (§2.5).
Settled by the slice-S2 review (F5), where the two readers disagreed and EX12 already asserted
this rule.

Earlier rows are kept and never rendered as current. A correction is a new row, and it may be
written at the same commit as the row it replaces.

One reader function in `invariants.ts`, `readExplanation(db, workspacePath, subjectType,
subjectId, slot)`, implements this rule; the tools and the gate of §3.4 call it. The
materializer implements the same rule in Python. Both are written around a pure selection
function over `(rows, the set of resolvable revisions, eligibility)`, and both gates run that
function over one shared case file, `mcp-server/contracts/explanation-effective-cases.json`,
which EX9 adds: a superseded row, a declined row, a withdrawn row, an unreachable `ref_sha`,
no workspace, and an ineligible subsystem, each with its expected state and row id. The Python
gate needs no built server.

### 3.3 Tools (EX9 the two writers; EX15 the read tool and the reset rule)

**`record_explanation`** `{ subject_type, subject_id?, slot, body, evidence_ids, ref_sha }`
**`decline_explanation`** `{ subject_type, subject_id?, slot, reason, ref_sha }`

**`get_explanations`** `{ subject_type, subject_id? }`

The two writers require an active session, attribute the row to it, and resolve `ref_sha` in
the workspace. `subject_id` is required for `subsystem` and is `project` for `project`. All
three are registered like `decline_domain_vocabulary` (tool inventory, schemas,
`ADDITIVE_TOOLS`).

A successful write returns a receipt and nothing else:
`{ id, subject_type, subject_id, slot, disposition, ref_sha }`. It never echoes the body or the
evidence rows; the gate asserts the response size is unchanged between a ten-byte body and a
body at the cap.

`get_explanations` is the read path the authoring phases use (§3.5). For the subject it returns,
per slot, `{ slot, state, checked, authored: "model", row: { id, disposition, body, ref_sha,
session_id, recorded_at, evidence_ids } | null, earlier_rows: <count> }`, and `model_calls: 0`.
It applies §3.2 through `readExplanation`. Its response is bounded by the caps below. It is a
new tool; `describe_locus` is not changed (§3.8).

`record_explanation` refuses, each with a message that names the repair:

| # | Condition | Message begins |
|---|---|---|
| R1 | the subsystem does not exist | `record_explanation refuses: no subsystem <id>` |
| R2 | the subsystem's status is `unmapped`, `scoping` or `deferred` | `record_explanation refuses: <id> is '<status>'. An explanation is written by a pass that has read the subsystem` |
| R3 | subject is `project` and no subsystem is at `structural` or later | `record_explanation refuses: no subsystem has been read to 'structural'` |
| R4 | subject is `project` and slot is `purpose` | `record_explanation refuses: the project's purpose is the thesis in entry-point.md` |
| R5 | `evidence_ids` is empty, or names a row that does not exist | `record_explanation refuses: an explanation cites the evidence it was written from` |
| R6 | every cited row's kind is `name-inferred` or `pattern-matched` | `record_explanation refuses: an explanation resting only on names and patterns` |
| R7 | subject is a subsystem and no cited row's file is in that subsystem's ledger (a set that mixes ledger files with others is accepted) | `record_explanation refuses: none of the cited evidence is in <id>'s ledger` |
| R8 | `body` exceeds its cap, or a `purpose` is not one paragraph | `record_explanation refuses: <slot> is limited to <n> bytes` / `a purpose is one paragraph` |
| R9 | `evidence_ids` names more than 64 rows (added by the slice-S2 review, F6: a read serves every cited id, so the response is bounded only if the count is) | `record_explanation refuses: an explanation cites at most 64 evidence rows` |

Caps, in UTF-8 bytes: `purpose` 400, `account` 4096. 4096 is the optional-section budget of
`design/reader-lenses/spec.md` §4.1, so a later decision to serve an account on the wire does
not require truncating one. A purpose is one paragraph: no blank line and no line starting with
`#`, `-`, `*` or `|`. An account is prose and lists: no line starting with `#` or `|`.

There is no minimum length and no required count of evidence rows beyond one. The whole
`get_explanations` envelope stays under 70,000 bytes at every cap, measured by EX15's gate. The
envelope echoes the subject id, so `get_explanations` refuses a `subject_id` over 256 UTF-8 bytes
without echoing it (added by the final review, F3/codex: `upsert_subsystem` takes an id of any
size).

`decline_explanation` records `disposition = 'declined'` with the reason as `body`. It applies
the conditions of R1–R4 with its own message stems, each beginning `decline_explanation
refuses:`, and one more: the reason is limited to 400 bytes and to one paragraph by the purpose
rule above (`decline_explanation refuses: a reason is limited to 400 bytes` / `a reason is one
paragraph`). It is accepted whether or not an explanation is already recorded: the newest row
is effective either way.

Every refusal sentence of both tools is registered in `mcp-server/contracts/refusal-parity.json`
in the packet that introduces it (EX9), with `references/explanations.md` as its reference;
`scripts/check-refusal-parity.mjs` fails on an unregistered `<tool> refuses:` sentence. EX9
creates that reference with the tools' usage and refusals; EX10 adds the content brief to it.

The orientation lint (§3.6) is applied at publication, in the materializer, and not in the
tools, so the rule has one implementation. It covers recorded bodies and declination reasons.

### 3.4 The `mapped` gate (EX10)

Every transition of a subsystem **into** `mapped` is refused unless the effective `purpose` and
the effective `account` are each `recorded` or `declined`. The check is
`requireExplanationDischarge` in `invariants.ts`.

- It runs for every status write whose target is `mapped` and whose current status is not
  `mapped`, **including from `deferred`**. `deferred` otherwise skips the forward prerequisites
  (`invariants.ts`, `assertStatusTransition` and `enforceForwardPrerequisites` both return early
  for it), so the check is invoked on its own path by both status writers and not only inside
  the `case "mapped"` branch. A write that leaves an already-`mapped` subsystem `mapped` is not
  checked.
- **Without a bound workspace**, a slot with a row proceeds and the advance reports that its
  revision was not resolved; a slot with no row is refused. This is the vocabulary gate's
  behaviour (`requireVocabularyDischarge`).

The message:

```
cannot advance <sid> to 'mapped': <what is missing> for this subsystem. Either
record_explanation with the evidence it was written from, or decline_explanation with the
reason none is written. There is no length floor, and declining is a real answer that has to be
said out loud.
```

`<what is missing>` is `no purpose is recorded or declined`, `no account is recorded or
declined`, or both joined by `and`. A row whose `ref_sha` no longer resolves is named in the
message, as the vocabulary refusal names unreachable declinations.

No other status advance is gated. The gate is forward-only: existing stores are swept by the
census (§2.5), not by this check.

The refusal is registered in `mcp-server/contracts/refusal-parity.json`, and
`references/phase-5-packaging.md` quotes it.

Test fixtures that advance a subsystem to `mapped`, from any status, gain declinations through
a shared fixture helper; no fixture is weakened and no test's assertion is removed.

### 3.5 Authoring (EX10)

A new skill reference, `.claude/skills/amanuensis/references/explanations.md`, is the content
brief. `SKILL.md` lists it. It states:

**Purpose** (subsystem): one paragraph on what this part is for, in terms of what the rest of
the system or its users get from it. Not a file list, not a restatement of scope.

**Account** (subsystem), in this order, as short prose:

1. the moving parts and how control or data passes through them;
2. the rules it enforces and where each is enforced, which is where the business logic is;
3. what it depends on and what depends on it;
4. what a newcomer is likely to get wrong;
5. where to start reading.

**Account** (project): what the system does and for whom; the main parts and how one request or
record passes through them end to end; the rules that hold everywhere (invariants, trust
boundaries, conventions); and the concepts a reader has to hold. Each such concept is a
vocabulary term with an expansion, and the account uses the term. A concept that already exists
as a term scoped to a subsystem is used as it stands, with its expansion written or revised
through `define_term`; its scope is not changed (`define_term` keeps an existing scope, and
§2.1 renders scoped expansions). A new concept that belongs to no one subsystem is defined
without `subsystem_id`.

Rules for all three: written for an experienced practitioner new to this codebase; the
codebase's own vocabulary; no survey-status or coverage language; every non-trivial statement
traceable to attached evidence; when the session cannot say something true and specific, it
declines with the reason.

Phase changes:

| Reference | Change |
|---|---|
| `phase-2-structural.md` | After the advance to `structural`: record the purpose and a draft account, or decline each |
| `phase-4-adversarial.md` | The purpose and account are targets. Read them with `get_explanations`, then against the code; record a field note naming any sentence the code contradicts, with the evidence |
| `phase-5-packaging.md` | Read the account with `get_explanations`; revise it by recording a new version, or confirm it stands; then read the census (§2.5). Quotes the §3.4 refusal |
| `onboarding.md` | Phase 7 names the thesis heading (§2.5). The project account is recorded once the first subsystem reaches `structural`, and revised at each later packaging |
| `artifact-templates.md` | The "Tier 1 summary" section is replaced by a pointer to the recorded account |
| `refresh.md` | A refresh that re-examines a subsystem whose explanation cites changed files reads it with `get_explanations` and revises or confirms it |

### 3.6 The subsystem page (EX11)

Section order, replacing §7.3 of the reader-lenses specification for the first four sections:

| # | Section | Renders |
|---|---|---|
| 1 | `## Purpose` | only when the effective purpose is `recorded` or `declined` |
| 2 | `## Scope` | always, as today; with the survey note (§2.1) |
| 3 | `## Start here` | as today |
| 4 | `## How it works` | only when the effective account is `recorded` |
| 5 | `## Structure` and onward | as today, with §2.2–§2.4 |

**Purpose, recorded:** the body, then a provenance line (below).
**Purpose, declined:** "No purpose statement is recorded for this subsystem: a survey session
declined to write one at `<sha8>`. <reason>"
**Purpose, not recorded:** no `## Purpose` section. `## Scope` opens with the existing
`NO_PURPOSE_WITH_SCOPE` or `NO_PURPOSE_ALONE` sentence, exactly as today.

When the purpose is recorded or declined, `## Scope` does not print the disclaimer. Scope is
never relabelled as purpose in any state.

**How it works:** the account body, nested so that it cannot introduce a heading above H3,
then the provenance line. A declined account prints nothing here and one sentence under
`## Survey record`: "A survey session declined to write an account of how this subsystem works
at `<sha8>`. <reason>"

**Provenance line**, one for each explanation rendered as its own section (`## Purpose`,
`## How it works`, and the project account of §3.7). A purpose repeated elsewhere, on the master
plan, in hover text or in the architecture page's per-subsystem lines, is an excerpt: it carries
no provenance line and links to the subsystem page whose section does.

```
*Written by a survey session at `<sha8>` from <n> evidence row(s). <ageing>*
```

**Ageing** is computed, never authored. Let F be the distinct files cited by the explanation's
evidence rows and H the store's `git_state.last_checked_sha`:

| Condition | Sentence |
|---|---|
| H and `ref_sha` resolve and no file in F differs between them | `None of the <n> file(s) it cites has changed since.` |
| k files differ | `<k> of the <n> file(s) it cites changed since: <up to five paths>.` |
| either revision does not resolve, or there is no workspace | `Whether the files it cites have changed since is not measured here.` |

An explanation is rendered in every one of these conditions. "Not measured" is never rendered
as "unchanged".

**Lint.** `lint.orientation_violations` is applied to every recorded body and every declination
reason before it is printed. Text with a violation is not printed. In its place: "The recorded
<slot> carries survey-status vocabulary and was not published; record a corrected version." The
publish fails, as it does for a refused thesis.

- **Plumbing.** At baseline only the overview receives the failure callback (`core.py`, the
  `PagePlan` for `index.md` passes `warn=self._warn`; `render_subsystem` and
  `render_architecture` receive none). EX11 passes it to `render_subsystem` and EX12 to
  `render_architecture` and `render_master_plan`. The gate exercises the real clean-publish
  path: the refusal sentence is in the rendered page, the publish result is red, and the
  previously published output is untouched.
- The lint's negative corpus in `materializer/test-overview-truthfulness.py` gains purpose,
  account and declination sentences whose subject is a subsystem id.

**Custody.** A page that renders an explanation lists the explanation rows among its `sources`
(`_db_source`), so recording one re-renders the page. `readback.py`'s state axis gains a check
that every effective recorded explanation's body is on the page that owes it, with a red case
in the gate: a renderer that drops the body fails the read-back.

**Labels.** The words for a slot's state (`not recorded`, `declined`) come from
`labels("explanation_discharge")`; the gate asserts a changed label in the contract changes the
page.

**Narrative.** With a recorded account, the survey narrative takes the third row of §2.3.

### 3.7 Elsewhere on the pages (EX12)

- **Master plan.** The subsystem table gains a **Purpose** column holding the recorded purpose
  with any `|` replaced by `/` as neighbouring cells do, or the state's label from
  `labels("explanation_discharge")`. `html_projection.py`'s record projection for that table
  gains the column in the same change.
- **Identifier definitions.** A subsystem id's hover definition is its name and the first
  sentence of its recorded purpose, as the existing `_compact_definition` compacts it (first
  sentence, 220 characters); without a recorded purpose it is what it is today.
- **Architecture page.** A new first section, `## How the parts fit together`: the project
  account and its provenance line, then one line per subsystem, `**<id> — <name>**: <purpose>`
  for a recorded purpose and `**<id> — <name>**:` followed by the state's label otherwise.
  With no project account the section prints "No account of how the parts fit together is
  recorded." and the per-subsystem lines still render. A declined project account prints "A
  survey session declined to write an account of how the parts fit together at `<sha8>`.
  <reason>". The project account and its declination reason pass the lint of §3.6 with the
  same refusal sentence and the same failing publish; EX12's gate seeds a violation.
- **Census.** The three explanation slots of §2.5 are added. A subsystem that is not
  explanation-eligible contributes no explanation-slot row: nothing may be recorded for it, so
  nothing is unfilled. Its `subsystem-vocabulary` row is unaffected.
- The overview and its thesis are unchanged.

### 3.8 The agent read surface (EX13)

`mcp-server/src/tools/locus.ts` and the locus contract are not modified by this lane (owner
decision 5). An agent that wants a subsystem's explanation calls `get_explanations` (§3.3).

`dev/measure-locus-default.mjs` copies a store to a temporary directory, spawns the built server
against it, calls `describe_locus` with no `sections` for each locus given, and reports for each:
the wire bytes, the payload bytes, the bytes of the response with every item removed (the
floor), the budget, and the count of items served and omitted per section. `--record` writes
`design/explanation/locus-default-measure.json` for the three loci the dogfood receipt names.

The gate asserts, on a fixture store, that the script's wire-byte figure equals the length of
the response it received, that the floor is computed by removing items and re-serializing, and
that served plus omitted equals the census the response declares.

---

## 4. Restoring the receipt gates

### 4.1 State on `main` at `ee12bed`

Measured in the lane worktree at the baseline commit, over a copy of the primary checkout's
store, by running every `dev/test-*.mjs`.

**Restored by this lane** (owner decision 4):

| Gate | First failing assertion at baseline |
|---|---|
| P18 `dev/test-reader-lenses-dogfood.mjs` | the promoted contract hash differs from the hash the receipt verified |
| P10 / D0 `dev/test-survey-depth.mjs` | B6: 14 of 37 carried records are undecided; the receipt records 22 carried records |
| P11 / A1 `dev/test-survey-depth-acceptance.mjs` | the receipt's ledger accounts for 652 paths and 656 are tracked; four are unledgered |
| CF2 `dev/test-carried-finding-references.mjs` | green locally; red in CI, where the "Roadmap structure and projection" job runs it without building the server |

`npx biome check src/` also failed, on formatting in `mcp-server/src/tools/materialize.ts`; the
lane's baseline commit repairs it.

**Red or unable to run at baseline, and not in this lane's scope.** They are listed so that no
packet mistakes them for its own regression, and no packet may make one worse:

| Gate | State at baseline |
|---|---|
| P20 `dev/test-rebuild-regeneration.mjs` | red: the depth receipt records no `mapped` subsystem; registry ownership and one edge have drifted |
| P19 `dev/test-rebuild-depth.mjs` | cannot run, its specified third state: its receipts describe two unrelated stores |
| P9 `dev/test-pecia-carry-audit.mjs` | red: `dev/pecia-dogfood.md` does not account for one Pecia record |
| `dev/test-amanuensis-pecia-defects.mjs` | red: `--apply` fails |
| `dev/test-activation-evidence.mjs` | red: the captured host evidence predates a change to `mcp-server/src/project.ts` |
| P15 `mcp-server/test-consumer-route.mjs` | red: `WORKSPACE_INSTRUCTIONS` opens the server instructions with the `get_project_info` handshake, so `describe_locus` is no longer named first |
| A25 `dev/check-activation-operating-envelope.mjs --receipt dev/activation-evidence/a25-activation-operating-envelope.json` | red: the receipt pins source digests that have since moved |
| A26 `dev/check-friction-free-release-readiness.mjs --report dev/activation-evidence/a26-release-readiness.json` | red: the report pins source digests that have since moved |

The last three were added by the final review (F7/claude) and confirmed red at `ee12bed`: the first
measurement ran `dev/test-*.mjs`, and these three are outside that pattern. Restoring these needs the self-conspectus
surveyed to `mapped`, a Pecia reconciliation and a host-evidence recapture. Those are separate decisions for the owner. The rebuild receipts under
`design/reader-lenses/` are historical and this lane does not re-record them.

### 4.2 The republish chain is one command (EX7)

`dev/republish-docs.mjs` performs the chain that has so far been run by hand. Steps, in order,
each a named function so the order is testable:

1. **preflight**: the server is built from this tree; the store opens; the worktree has no
   uncommitted change outside `docs/` and the receipt files.
2. **reconcile**: over a spawned server, `start_session`, then `detect_changes` at `HEAD`. If
   any tracked path is unledgered, stop and print the paths. Assigning a path to a subsystem
   and a classification is a survey judgement, so the script does not guess; the session makes
   the `add_files_to_scope` calls and reruns the script.
3. **freshness**: `detect_changes` marks an examined ledger row stale when its file differs
   from the revision it was examined at, and the dogfood gate requires every owner of its three
   loci to stand as `examined`. If any path named in `design/reader-lenses/dogfood-receipt.json`
   has an owner whose standing is not `examined`, stop and print the paths and owners. The
   session then re-examines each: it reads the file at `HEAD`, records the examination at `HEAD`
   through the ledger tool and clears the staleness, and reruns the script. Staleness is never
   cleared on a file the session has not read. Other stale rows are left stale and are
   published as stale.
4. **publish**: `materialize_docs(clean_publish=true)`; write its response to a summary file,
   and write `{commit, unfilled_slots}` from it to `design/explanation/unfilled-slots.json`.
   Stop when it reports a red read-back or a lint refusal.
5. **promote**: `dev/promote-docs.mjs` with both `--publish-summary` and `--receipt`.
6. **dogfood receipt**: `dev/record-dogfood-receipt.mjs --promotion <receipt>`.
7. **depth receipt**: `dev/record-survey-depth.mjs`.
8. **progress record**: rewrite the derived fields of `design/survey-depth/survey-progress.json`
   from the depth receipt, and leave every other key byte-identical. The derived fields are the
   ones `dev/test-survey-depth.mjs` compares with the receipt: in `end`, `at_sha`, `examined`,
   `obligation_bearing` and `fraction`; in `carried_adjudication`, `total`, `decided`,
   `to_decide`, `outcomes`, and the `successors` and `repaired` lists, so that each outcome count
   equals the length of its list, the outcomes sum to the total, and the total equals the
   receipt's carried-record count. The script adds `derived_fields_rewritten_at` with the
   commit; the file's narrative strings predate it and are not rewritten. These fields had no
   writer and were edited by hand.
9. **measure**: with `--measure-label <label>`, run `dev/measure-reader-prose.mjs docs --record <label>`.
10. **verify**: run the four gates of §0.3 and print one line each. Exit non-zero if any is red.

The script does not run `dev/record-rebuild-depth.mjs` or any other `rebuild-*` recorder (§4.1).

Rules:

- The script never calls `detect_changes` after step 4. A reconciliation after the publish
  moves `last_checked_sha` past what the dogfood receipt records.
- No tracked path may be added after step 2. Every file a later step writes, and every file the
  session commits with the receipts, already exists and is ledgered when step 2 runs. A new path
  after the reconciliation is a path the acceptance receipt has not inventoried.
- Step 6 is refused when step 5 ran without the publish summary.
- `design/explanation/unfilled-slots.json` is created by EX7 as `{"commit": null,
  "unfilled_slots": []}` so that the path exists before the first reconcile.
- `--plan` prints the ordered steps without running them. `--from <step>` resumes.
- Each step's subprocess is injected, so the gate replaces them with stubs.

The gate (`dev/test-republish-chain.mjs`) asserts, with stubbed steps: the order of all ten;
that an unledgered path stops the run before publish and names the path; that a dogfood locus
whose owner is not `examined` stops it before publish and names the path; that a red read-back
stops it before promote; that the dogfood recorder is never reached without a publish summary;
that no reconcile follows a publish; that verification runs last, invokes all four gates, and
makes the command exit non-zero when any one is red; and that step 8, run on a fixture receipt
and a fixture progress file, produces a file satisfying the four relations above with every
other key byte-identical.

### 4.3 Deciding the carried findings (EX8)

Each of the 14 undecided carried records gets exactly one terminal outcome through
`record_carried_outcome`, decided by reading the code the record names at `HEAD`:

| What the code shows | Outcome |
|---|---|
| the defect is still present | a successor finding, recorded with evidence, and the carried record points to it |
| the defect was repaired | repaired at the commit that repaired it, with evidence at that commit |
| the described behaviour never held or no longer applies | ruled out, with the evidence that shows it |

No outcome is chosen to clear the gate. A record whose code cannot be found is ruled out only
with evidence of the removal. The session records progress in
`design/explanation/restore-progress.json` (`carried_decided`, an integer) after each decision
so that an attempt which runs out of budget is resumed and not restarted.

### 4.4 The first republish (EX8)

After the carried decisions, in this order:

1. In the store, rename the heading of `entry-point.md`'s thesis section to
   `## What is this codebase?`; its text is unchanged. Add a `## Runtime boundary map` table to
   `onboarding-report.md` from the boundaries its "Runtime boundary" prose already states.
   Rehash both artifacts.
2. Ledger every unledgered tracked path, including this lane's own files.
3. Run `node dev/republish-docs.mjs --measure-label recovered`. When it stops at the freshness
   step, re-examine the named loci as §4.2 step 3 describes and rerun it.
4. Commit `docs/` and the receipts in one commit.

The gate (`dev/test-receipt-gates-restored.mjs`) asserts over tracked files and by running the
four gates of §0.3 as subprocesses:

- each of the four exits 0;
- in `.github/workflows/test.yml`, the job that runs `dev/test-carried-finding-references.mjs`
  builds the server (`npm ci` and `npm run build` in `mcp-server`) in an earlier step;
- `docs/index.md` carries a thesis and none of the three thesis placeholder sentences;
- `docs/architecture.md` does not carry the runtime-boundary placeholder;
- `docs/findings.md` carries a **Why it matters** field;
- `design/explanation/reader-measure.json` has `before` and `recovered` entries, and its last
  entry's contract hash is the hash of the committed `docs/.projection-contract.json`.

It prints one summary line per sub-gate and never a child's raw output.

---

## 5. The explain pass (EX14)

Owner decision 2. Over this repository's self-conspectus, in the lane worktree's store:

1. For each subsystem at `structural` or later: read its claims, its findings, its survey
   artifact and the code they cite; attach or record the evidence; record a purpose and an
   account per §3.5, or decline each with the reason.
2. Record the project account, and `define_term` each cross-cutting concept it relies on.
3. Subsystems below `structural` are not touched. The tools refuse them.
4. Ledger new tracked paths, run `node dev/republish-docs.mjs --measure-label explained`, then
   `node dev/measure-locus-default.mjs --record`, which rewrites a file EX13 already committed.

Progress is recorded in `design/explanation/explain-progress.json` (`subjects_done`).

The gate (`dev/test-explanations-published.mjs`) asserts over tracked files:

- every `docs/subsystems/*.md` either has `## Purpose` or shows a status of `unmapped`,
  `scoping` or `deferred` on its status line (checked first);
- every such page with `## Purpose` also has `## How it works` or the account-declination
  sentence of §3.6, with a control in the gate's own fixtures: a page with a Purpose and
  neither is red;
- the committed `design/explanation/unfilled-slots.json` names the commit the receipts were
  recorded at and holds no `subsystem-purpose`, `subsystem-account` or `project-account` row;
- `docs/architecture.md` has `## How the parts fit together` and not the no-account sentence;
- no page carries a refused-explanation sentence;
- the four gates of §0.3 exit 0;
- `reader-measure.json` has an `explained` entry, and its last entry is bound to the committed
  contract hash.

The gate does not judge whether an explanation is true or useful.

---

## 6. Baseline regressions

Verified green in the lane worktree at the baseline commit, and listed by the packets whose
files they cover:

- TypeScript: `cd mcp-server && npm run build`; `node scripts/gen-tool-inventory.mjs --check`;
  `node scripts/check-tool-schemas.mjs`; `node scripts/check-sql-identifiers.mjs`;
  `node scripts/check-evidence-vocabulary.mjs`; `node scripts/gen-vocabulary.mjs --check`;
  `npx biome check src/`; `node test-smoke.mjs`; `node test-invariants.mjs`;
  `node test-structural-claims.mjs`; `node test-vocabulary-discharge.mjs`;
  `node test-vocabulary-source.mjs`; `node test-refusal-parity.mjs`;
  `node test-locus-standing.mjs`; `node test-locus-compactness.mjs`;
  `node test-existing-store-migration.mjs`.
- Python: `ruff check materializer/`; `python3 test-materializer.py`; `test-lens-pages.py`;
  `test-overview-truthfulness.py`; `test-history-and-disagreements.py`;
  `test-unmeasured-coverage.py`; `test-readback.py`; `test-ledger-freshness.py`.

---

## 7. What this supersedes

Rules of `design/reader-lenses/spec.md` changed by this specification, and the assertions that
encode them. Each assertion is made state-conditional per §0.2.

| Rule | Before | After | Assertions |
|---|---|---|---|
| §3.1 row 1, §7.3 item 1 | No durable purpose exists; every subsystem page says so | Purpose comes from the effective explanation; the sentence renders only in the not-recorded state | `materializer/test-lens-pages.py` (section order, first section, the disclaimer) |
| §7.3 item 3, §9.1 | Narrative is promoted into Structure only when the claims list is empty | §2.3's three states | `materializer/test-lens-pages.py` |
| §9.1 renderer contract | Claims render as a table under five headings and "Other claims" | §2.2's register and grouping | none changes: `mcp-server/test-structural-claims.mjs` stays green unmodified |
| findings table header | Five columns | Gains **Why it matters** (§2.1), in every state | `materializer/test-materializer.py:465`: the literal is replaced by the new header |
| §11.1 | The orientation lint is wired at the thesis | Wired at every recorded purpose and account as well | `materializer/test-overview-truthfulness.py` |
| §3.4 list of model-authored fields | Ends at the narrative artifact | Adds `explanations.body` | `materializer/test-prose-retention.py` |

A literal that changes for every state is replaced and listed here; an assertion about a state
that still exists is made conditional and keeps its must-fail case (§0.2).

Unchanged: §3.4's rule that no response contains text generated during the call; §3.4's rule
that the wire attaches narrative only as a pointer and only with an empty claims list; §4's
budgets; §7.2's thesis by heading.

---

## 8. Gates

| Packet | Gate | Turns red when | A false green it cannot exclude |
|---|---|---|---|
| EX1 | `dev/test-reader-measure.mjs` | the script's counts differ from the fixture's known counts | the definitions measure something other than what a reader experiences |
| EX2 | `materializer/test-prose-retention.py` | a seeded authored field reaches no page, or an allowlisted one does | a field renders somewhere a reader will not find it |
| EX3 | `materializer/test-claim-register.py` | the statement does not lead its record, or a keyed segment lands under "Other claims" | the record is ordered correctly and still hard to read |
| EX4 | `materializer/test-narrative-placement.py` | with claims present the narrative is not inside Structure, or renders twice | the narrative is stale; it is labelled unbound and not checked |
| EX5 | `materializer/test-ledger-grouping.py` | a shared reason prints more than once, or any path loses its anchor | a grouping that is correct and still long |
| EX6 | `materializer/test-placeholder-census.py` | a rendered placeholder has no census row, or a census row has no placeholder, or a full store returns rows | a placeholder sentence added later without a predicate |
| EX7 | `dev/test-republish-chain.mjs` | steps run out of order, or the run continues past an unledgered path or a red read-back | the real tools behave differently from the stubs |
| EX8 | `dev/test-receipt-gates-restored.mjs` | any of the four gates is red, or the thesis is absent from `docs/index.md` | a carried record decided wrongly but with evidence attached |
| EX9 | `mcp-server/test-explanations.mjs` | a refusal is not raised, a row can be updated or deleted, the shared effective-row cases fail, or a write echoes its body | an explanation that is false and well-formed |
| EX15 | `mcp-server/test-explanation-read.mjs` | `get_explanations` returns a row that is not the effective one, writes to the store, or a reset leaves an explanation effective | a reader that ignores what it read |
| EX10 | `mcp-server/test-explanation-gate.mjs` | `mapped` is reached with a slot neither recorded nor declined, through either status writer, from any status including `deferred` | a declination with an empty reason in substance |
| EX11 | `materializer/test-explanation-pages.py` | a Purpose heading renders without a record, the disclaimer is missing in the not-recorded state, the ageing sentence is wrong for a seeded change, or the two readers disagree | prose that passes the lint and misleads |
| EX12 | `materializer/test-explanation-orientation.py` | the master plan, hover text or architecture page omits a recorded purpose, or the census omits an unfilled explanation slot | — |
| EX13 | `dev/test-locus-default-measure.mjs` | the reported bytes differ from the response measured | the three dogfood loci are unrepresentative |
| EX14 | `dev/test-explanations-published.mjs` | a surveyed subsystem page has no Purpose, the architecture page has no account, or a receipt gate is red | every explanation is published and none is good |
