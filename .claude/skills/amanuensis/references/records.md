# Records

A survey writes nothing to the storage directory. Everything it finds is a
record in the store, and the pages are built from those records. This file says
which tool holds which part, and what each narrative section contains. The
refusals and the argument rules of each tool are in
[`explanations.md`](explanations.md), and the style of labels and prose is in
[`reporting-style.md`](reporting-style.md). Something that fits no record goes
to `record_open_question`, never to a file.

A record cites the evidence it was read from (`add_evidence`, then
`evidence_ids`) and the revision it was read at (`ref_sha`). In a language the
code index parses, the `symbol` of an `add_evidence` call must name a
definition; a free-text label belongs in `note`. The writers need an active
session. Every record is append-only: the newest row for a subject
is the one served, and a correction is a new row.

Prose in a record is prose and lists, at most the size the tool names, with no
heading or table line. The page owns its headings and tables.

## Paths outside the survey

A path the survey set leaves out, because the repository's ignore files match
it, the owner excluded it, or onboarding sorted it as meta, gets no new record.
Every writer that names a path or writes evidence refuses it with its source and
its rule: `add_files_to_scope`, `update_file_classification`,
`clear_staleness`, `add_evidence`, `land_review_pass`'s `new_evidence`,
`apply_change_impact`, `define_term`'s `first_seen`, `add_field_note`'s
`location`, `add_finding`'s and `carry_finding`'s `primary_files`, and
`log_dispatch`. The refusal says: An excluded path gets no new record; reads
still answer for it. Cite the code instead. Bring the path back only when the
owner asks, with an owner include rule that quotes the owner's words
([`onboarding.md`](onboarding.md), Phase 0b).

Two writes are allowed on an excluded path. `retire_ledger_file` removes a
ledger row left on one, which is how a row the reconciliation lists under
`excluded_with_rows` is cleared. The sorting inventory may cite one, because it
writes no evidence.

A record may not rest on an excluded path's evidence either. An evidence row
that exists already, because it was recorded before the path was excluded, can't
be attached to a new record. The writers of claims (asserting, closing and
superseding one), of dispositions (setting one, and attaching a row to one) and
of findings (`attach_evidence_to_finding` and `verify_finding_fix`) refuse it,
as do `clear_staleness`'s `evidence_id`, `record_explanation`,
`record_narrative`, `record_runtime_boundary`, `attach_carried_evidence`, the
diagnosticity matrix, decision invalidation, contradiction resolution, claim
marks, the Chorusmith parity scope and the crosswalk's provenance. It makes no
difference whether the row arrives as `evidence_id` or in `evidence_ids`. The
refusal names the evidence row, its path, its source and its rule, and says:
A record gets no support from an excluded path's evidence; reads still answer
for it. Cite a reading of the code instead. Bring the path back only when the
owner asks, with an owner include rule.

## Project profile

`record_project_profile(name, ref_sha)` holds the project's name, one line. It
is the identity every page prints first. A name that is blank or longer is
refused: `record_project_profile refuses: a name is one line of at most 120
characters`.

## Purposes and accounts

`record_explanation` holds a purpose (one paragraph) and an account (prose and
lists) for a subsystem or for the project. The project's purpose is its
thesis, recorded at onboarding with `record_explanation(subject_type="project",
slot="purpose", body, evidence_ids, ref_sha)`; the overview prints it. A part
that has no explanation to give says so with `decline_explanation`. Read both
back with `get_explanations`. What each contains is in
[`explanations.md`](explanations.md). Both writers refuse a project account
until a subsystem has been read: `record_explanation refuses: no subsystem has
been read to 'structural'` and `decline_explanation refuses: no subsystem has
been read to 'structural'`.

## Runtime boundaries

`record_runtime_boundary` holds one crossing between two runtimes: where it
starts and in what language, where it ends, the mechanism, and a note. The
architecture page draws the map from these rows. `withdraw_runtime_boundary`
takes a crossing off, and `get_runtime_boundaries` reads the map back.
Withdrawing a crossing that is not on the map is refused:
`withdraw_runtime_boundary refuses: no crossing from <from> to <to> by
<mechanism> is on the map`. A crossing with no evidence is refused:
`record_runtime_boundary refuses: a crossing cites the evidence it was read
from`.

## Narratives

`record_narrative` holds the longer prose of a survey, one body for each
section and topic. `topic` is a short title that names one part of a section;
the page prints it as a subheading. `decline_narrative` says that a section has
nothing to add, with the reason. `get_narratives` reads the newest row for each
section and topic. A narrative that cites no evidence is refused: `a <section>
narrative cites the evidence it was written from`; below its rung, `a
<section> narrative is written once a subsystem has reached '<rung>'`. The
reason of a declination is one paragraph: `decline_narrative refuses: a reason
is one paragraph`.

A subsystem has three sections, each written once the subsystem has reached the
rung that makes it possible:

- `structure` holds how the subsystem is built: its parts, what it holds, and
  how work moves through it. Phase 2 writes it, one topic for each part. The
  inventory's typed parts have their own records (claims, seams, vocabulary),
  so a narrative says what they do not.
- `concern-reasoning` holds why each concern was judged to apply, to be
  acceptable, or to be a bug, where a disposition's rationale was too short to
  say it. Phase 3 writes it.
- `challenge` holds what was tried to disprove the subsystem's findings, and
  what held. Phase 4 writes one for each finding or claim, with the finding id
  or the claim key as the topic.

The project has six sections, all written at onboarding:

- `repository-shape` holds how the repository is laid out and where its parts
  meet.
- `runtime` holds what runs, in which language or process, and how the parts
  call each other. The crossings themselves are runtime boundaries.
- `stateful-entities` holds what the system stores or remembers between calls,
  and what may change it.
- `concern-calibration` holds which kinds of concern apply to this project and
  which do not, and why.
- `start-here` holds where a new reader should begin, and in what order to read
  on.
- `survey-plan` holds what the survey means to read next, and in what order. It
  needs no evidence.

Phase 5 reads each subsystem's narratives and revises them with a new row, or
confirms them.

## Concern calibration

`add_concern` adds a concern to the checklist, with the territory of
[`concern-territories.md`](concern-territories.md) it was seeded from and the
probe that tests it in this codebase. `record_territory_disposition` says for
each territory whether it applies, or is disqualified and by which condition.
`list_concerns` reads the checklist back. A probe over the cap is refused:
`add_concern refuses: a probe is limited to 1200 bytes`. A disqualified
territory with no condition is refused: `record_territory_disposition refuses:
a disqualified territory names the condition that rules it out`.

## Flow marks

A flow step is a claim keyed `<sid>/flow/<slug>/<nn>`. `record_claim_mark` puts
a mark on one: a commit point, a crash point, an exit, a seam crossing, or the
trigger. `withdraw_claim_mark` retracts a mistaken one. A flow with nothing to
mark says so with `decline_claim_marks`. `get_claims` returns the marks with
each claim. A mark on a claim that is not a flow step is refused:
`record_claim_mark refuses: <key> is not a flow step`; one on a claim that does
not exist, `record_claim_mark refuses: no claim <id>`; a withdrawal of a mark that is not
there, `withdraw_claim_mark refuses: no mark <id>`; a declination for a flow
with no steps, `decline_claim_marks refuses: flow <flow> has no current step
claim`.

## Records that already existed

Claims (`add_claim`), seams (`upsert_seam`), crossing edges (`add_xref`),
vocabulary terms, findings, dispositions, field notes and open questions each
have their own tool and need no prose file. The master plan, the
findings index and the field notes are the subsystem, finding and field-note
tables, and the pages are built from them. An earlier version's hand-written
files are kept in the store as written, and `get_imported_artifacts` reads
them. They are not edited or registered again.
