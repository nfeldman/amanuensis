# Explanations

What a part of the codebase is for, and how it works, written down by a survey
session that has read it. An explanation is recorded at a revision, over the
evidence it was written from, and is kept: a correction is a new row, and the
newest row whose revision still resolves is the effective one. The record
establishes who wrote the explanation, at which revision and over which evidence.
It does not establish that the explanation is true.

There are two slots. A **purpose** (subsystem or project) is one paragraph of at
most 400 bytes. An **account** (subsystem or project) is prose and lists of at
most 4096 bytes. The project's purpose is its thesis: what the codebase is, in
one paragraph, recorded with `record_explanation(subject_type="project",
slot="purpose", body, evidence_ids, ref_sha)`. The overview prints that record
and nothing else. There is no minimum length and one evidence row is enough.
Declining is a real answer. A session that cannot say something true and
specific says so, with the reason, and the reason is kept.

## What to write

**Purpose** (subsystem): one paragraph on what this part is for, in terms of what
the rest of the system or its users get from it. Not a file list, not a
restatement of scope.

**Purpose** (project): one paragraph on what the codebase is and who it is for,
written from its entry points and manifests. It is recorded at onboarding, before
any subsystem has been read.

**Account** (subsystem): short prose on how the part works. It covers the moving
parts and how control or data passes through them; the rules it enforces and
where each is enforced, which is where the business logic is; and what it
depends on and what depends on it. An account has no sections of its own and no
lead-in labels.

Where to start reading is not part of an account. A subsystem's page prints its
`jump_in_reading` as the "Start here" line under
its scope, and the project's `start-here` narrative gives the routes through the
whole codebase. A better starting point is recorded there.

**Account** (project): what the system does and for whom; the main parts and how
one request or record passes through them end to end; the rules that hold
everywhere (invariants, trust boundaries, conventions); and the concepts a reader
has to hold. Each such concept is a vocabulary term with an expansion, and the
account uses the term. A concept that already exists as a term scoped to a
subsystem is used as it stands, with its expansion written or revised through
`define_term`; its scope is not changed. A new concept that belongs to no one
subsystem is defined without `subsystem_id`. Either way the term's `first_seen` is
an anchor *"whose revision must resolve and whose path must exist in that
revision's tree"*.

These rules apply to every purpose and account:
- Address an experienced practitioner new to this codebase; § Prose in
  `reporting-style.md` sets the style. Use the codebase's own names where they help the
  reader find the code, and say what each means the first time it appears.
- Use no survey-status or coverage language.
- Make every non-trivial statement traceable to attached evidence.
- When the session can't say something true and specific, it declines and gives
  the reason.

A purpose answers "what is this for?" in a sentence or two that a reader can
repeat. An account that reads as a list of mechanisms has failed, however true
each item is.

Less is more: too much detail and the reader glazes over. Many true facts fit;
keep one only if a reader who did not know it would change
the code wrongly or misread what it does, and leave out what the names and the
file list already tell them. Prefer what the survey has weighed (its claims,
findings and seams) to what turns up while reading.

There is no length floor. A short explanation that is true is better than a long
one written to look finished. An account or a narrative rarely needs more than
2048 bytes; the caps are ceilings, not targets. Declining with a reason is a complete answer, and a
later pass that knows more records over it.

Leave out what the reader already has on the same page: the scope and the "Start
here" line. An explanation says how the code works, not what is wrong with it:
findings, defects and their ids stay out, since the page lists them on their own.
A revision is no longer than the text it replaces unless a fact needs the room.

## Rewriting on request

Any prose the survey recorded can be replaced on the reader's word: a purpose,
an account, a narrative, a term's expansion, a note. When someone says anything
about how a piece is written (too long, the wrong emphasis, missing what they
care about), tell them it can be rewritten and ask what it should focus on or
change. Then write the replacement, show it, and record it once they are
satisfied. They can also amend the text or write their own; record theirs as
given, over the evidence it rests on. A replacement is a new row and the old one
stays in the history, except a term's expansion, which `define_term` replaces in
place. The rules above still hold: where a request would break
one, say which and why.

## When each is written

| Phase | What happens |
|---|---|
| Structural (`phase-2-structural.md`) | After the advance to `structural`, record the purpose and a draft account, or decline each. |
| Adversarial (`phase-4-adversarial.md`) | Read both with `get_explanations`, then against the code. A sentence the code contradicts becomes a field note with the evidence. |
| Packaging (`phase-5-packaging.md`) | Read the account with `get_explanations`, then revise it by recording a new version or confirm it stands. The advance to `mapped` refuses a slot that is neither recorded nor declined. |
| Onboarding (`onboarding.md`) | The project purpose is recorded first, over the evidence it was read from, and needs no subsystem. The project account is recorded once the first subsystem reaches `structural`, and revised at each later packaging. |
| Refresh (`refresh.md`) | An explanation that cites changed files is read with `get_explanations` and revised or confirmed. |

## Tools

The two writers need an active session, attribute the row to it, and resolve
`ref_sha` in the bound workspace. `subject_id` names the subsystem and is
omitted for the project. A successful write returns only
`{id, subject_type, subject_id, slot, disposition, ref_sha}`; it never echoes
the body.

### `record_explanation`

`record_explanation(subject_type, subject_id?, slot, body, evidence_ids, ref_sha)`
records an explanation as `recorded`. Call it for a subsystem that has been
advanced to `structural` or later, citing the `add_evidence` rows the
explanation was written from. An `add_evidence` `symbol` names a definition; a free-text
label belongs in `note`. A project's purpose is accepted at any status, with
one evidence row at least. Call it again to correct an earlier explanation,
even at the same commit.

It refuses, each time with the sentence to repair:

- `record_explanation refuses: no subsystem <id>` — the subsystem does not exist.
- `record_explanation refuses: <id> is '<status>'. An explanation is written by a pass that has read the subsystem` — its status is `unmapped`, `scoping` or `deferred`.
- `record_explanation refuses: no subsystem has been read to 'structural'` — a project account needs at least one subsystem that has.
- `record_explanation refuses: an explanation cites the evidence it was written from` — `evidence_ids` is empty or names a row that does not exist.
- `record_explanation refuses: an explanation cites at most 64 evidence rows` — cite the rows the text rests on. A read serves every cited id, so its response is bounded only if the count is.
- `record_explanation refuses: an explanation resting only on names and patterns` — every cited row's kind is `name-inferred` or `pattern-matched`.
- `record_explanation refuses: none of the cited evidence is in <id>'s ledger` — no cited row's file is in the subsystem's ledger. A set that mixes ledger files with outside files is accepted.
- `record_explanation refuses: <slot> is limited to <n> bytes` — a purpose is over 400 bytes, or an account over 4096. The cap counts UTF-8 bytes.
- `record_explanation refuses: a purpose is one paragraph` — the purpose has a blank line or a line starting with `#`, `-`, `*` or `|`.
- `record_explanation refuses: an account is prose and lists` — the account has a line starting with `#` or `|`.
- `record_explanation refuses: the <slot> carries survey-status language or a count fraction` — the pages' orientation lint would withhold it: a sentence saying the conspectus, the survey or a subsystem is surveyed, mapped, current and the like, or a part over its whole such as `12/35`. A slash list such as exit codes `0/1/3` is not a count. The lint runs again at render. If the server cannot start Python, the write goes through and only the render checks.

### `decline_explanation`

`decline_explanation(subject_type, subject_id?, slot, reason, ref_sha)` records
the reason no explanation is written, as `declined`. It is accepted whether or
not an explanation is already recorded: the newest row is effective either way.
The reason is one paragraph of at most 400 bytes, for either slot.

It applies the subject conditions of `record_explanation` with its own sentences:

- `decline_explanation refuses: no subsystem <id>` — the subsystem does not exist.
- `decline_explanation refuses: <id> is '<status>'. An explanation is written by a pass that has read the subsystem` — its status is `unmapped`, `scoping` or `deferred`.
- `decline_explanation refuses: no subsystem has been read to 'structural'` — a project account is answered once one has.
- `decline_explanation refuses: the project's purpose is recorded, not declined` — record it with `record_explanation` from the evidence the entry points and manifests give; only the project's account is declined.
- `decline_explanation refuses: a reason is limited to 400 bytes` — the reason is too long.
- `decline_explanation refuses: a reason is one paragraph` — the reason has a blank line or a line starting with `#`, `-`, `*` or `|`.
- `decline_explanation refuses: the reason carries survey-status language or a count fraction` — the same lint as for a recorded explanation.

### `get_explanations`

`get_explanations(subject_type, subject_id?)` reads back what was recorded. It is
the way a later pass sees an earlier one's explanation; `describe_locus` does not
serve one. It needs no session and writes nothing. For each slot of the subject (the
subsystem and the project each have `purpose` and `account`) it returns

    {slot, state, checked, authored: "model",
     row: {id, disposition, body, ref_sha, session_id, recorded_at, evidence_ids} | null,
     earlier_rows}

and `model_calls: 0`. `state` is `recorded`, `declined` or `not-recorded`. `row` is
the effective row: the newest whose `ref_sha` the workspace still reaches, so a
row written at a revision that has since been rewritten away is passed over for
the older row that resolves. `earlier_rows` counts the rows kept below it. A
subsystem that has not been read to `structural` reads `not-recorded` whatever
rows exist, the project's account reads the same while no subsystem has been (its
purpose reads at any status, and a purpose copied in by the import reads as
`recorded` with the disposition `imported` on its row), and
`checked` is false when no workspace was bound to resolve revisions against, or
when the bound path is one git cannot answer in; the newest row is effective then. The body is served whole, so a response carries at most the
400-byte purpose and the 4096-byte account with their fields and 64 evidence ids
each. The whole envelope stays under 70,000 bytes in the worst case, a body of
control characters at every cap; prose at every cap measures about 17,000. An unknown
subsystem, a `subject_id` over 256 bytes (the envelope echoes it), or a subsystem
call without `subject_id`, is refused.

### A reset withdraws

`reset_subsystem` does not delete explanations. It appends a `withdrawn` row, with
the reset's reason as its body, for each slot of that subsystem that has any row,
and needs an active session to attribute it. The earlier rows are kept, both slots
read `not-recorded`, and the resurveyed subsystem owes a new explanation:
`record_explanation` makes the next row effective. The withdrawn row is written at
the workspace's current revision. When that cannot be resolved it is written at
each revision the slot's rows name, so the withdrawal still holds in whichever
workspace is bound later.

## Narratives

A **narrative** is the survey's longer prose about one subject, kept in the store
and not in a file: how a subsystem is built, why each concern was judged as it
was, what the challenge tried, and the project's shape, runtime, state, concern
calibration, reading route and plan. It is recorded at a revision, over the
evidence it was written from, and is kept: a correction is a new row. The record
establishes who wrote it, at which revision and over which evidence, not that it
is true.

| Section | Subject | Written once the subsystem has reached | Evidence |
|---|---|---|---|
| `structure` | subsystem | `scoping` | required |
| `concern-reasoning` | subsystem | `concerns` | required |
| `challenge` | subsystem | `adversarial` | required |
| `repository-shape`, `runtime`, `stateful-entities`, `concern-calibration`, `start-here` | project | no rung | required |
| `survey-plan` | project | no rung | optional |

A body is prose and lists of at most 8192 bytes: no line starting with `#` or `|`,
since the page owns its headings and tables. A section holds several narratives,
one per **topic** (a short title of at most 120 characters, empty for the
section's single body); the effective one for each subject, section and topic is
the newest. Cite at least one file in the subsystem's ledger.

A narrative holds its section and nothing else. A `structure` narrative says how
the subsystem is built; where to start belongs to the "Start here" line. The prose rules for
explanations apply here too, the length rule included, except to a `challenge`
narrative: that one is the review of a finding, so it names the finding and is
held only to the server's cap, as § 4 of `phase-4-adversarial.md` sets out.

### `record_narrative`

`record_narrative(subject_type, subject_id?, section, topic?, body, evidence_ids, ref_sha)`
records a narrative as `recorded`. It needs an active session, and returns
`{id, subject_type, subject_id, section, topic, disposition, ref_sha}` without the
body. It refuses, each time with the sentence to repair:

- `record_narrative refuses: no subsystem <id>` — the subsystem does not exist.
- `a <section> narrative is written once a subsystem has reached '<rung>'` — advance the subsystem first; a parked (`deferred`) subsystem holds none until it is resumed.
- `Record it with subject_type` — the section belongs to the other kind of subject.
- `a <section> narrative cites the evidence it was written from` — `evidence_ids` is empty or names a row that does not exist; only `survey-plan` may cite none.
- `a narrative cites at most` 64 evidence rows.
- `record_narrative refuses: none of the cited evidence is in <id>'s ledger` — cite a file the ledger holds; files outside it may accompany it.
- `record_narrative refuses: a narrative is limited to 8192 bytes` — split it into topics.
- `a narrative is prose and lists` — the body has a line starting with `#` or `|`.
- `record_narrative refuses: a topic is a short title on one line` — over 120 characters, or on more than one line.
- `record_narrative refuses: ref_sha <ref> does not resolve` — record the revision the reading was taken at.
- `the narrative carries survey-status language or a count fraction` — the same lint as for an explanation.

### `decline_narrative`

`decline_narrative(subject_type, subject_id?, section, topic?, reason, ref_sha)`
records the reason no narrative is written, as `declined`; the newest row is
effective whether or not a narrative is recorded. The reason is one paragraph of
at most 400 bytes. It applies the subject and rung conditions of `record_narrative`
with its own sentences:

- `decline_narrative refuses: no subsystem <id>`
- `narrative is answered once a subsystem has reached '<rung>'`
- `Decline it with subject_type`
- `decline_narrative refuses: a reason is limited to 400 bytes`
- `decline_narrative refuses: a reason is one paragraph`
- `decline_narrative refuses: a topic is a short title on one line`
- `decline_narrative refuses: ref_sha <ref> does not resolve`
- `decline_narrative refuses: the reason carries survey-status language or a count fraction`

### `get_narratives`

`get_narratives(subject_type, subject_id?, section?, history?)` reads back the
effective narrative for each section and topic, as
`{id, section, topic, disposition, authored: "model", body, ref_sha, session_id, recorded_at, evidence_ids}`,
with `withdrawn` counting the keys a reset withdrew and `model_calls: 0`. `history`
adds the rows that are not effective, without their bodies. It needs no session
and writes nothing.

### A reset withdraws

`reset_subsystem` does not delete narratives. It appends a `withdrawn` row, with the
reset's reason as its body, for every effective narrative of that subsystem, and a
withdrawal for each imported survey body of it, and needs an active session to
attribute them. The earlier rows are kept, and the resurveyed subsystem owes a new
narrative.

## Project records

Four more records describe the project as a whole, each kept in the store and
each over a revision. The project's purpose is the explanation above; the others
are these.

### `record_project_profile`

`record_project_profile(name, ref_sha)` records the project's name, as one line of
at most 120 characters. The newest row is the effective name. It needs an active
session, and returns `{id, name, ref_sha}`. It refuses:

- `record_project_profile refuses: a name is one line of at most 120 characters` — the name is blank, has a line break or is longer.
- `record_project_profile refuses: ref_sha <ref> does not resolve` — record the revision the name was read at.

### `record_runtime_boundary`, `withdraw_runtime_boundary` and `get_runtime_boundaries`

`record_runtime_boundary(from_runtime, from_language?, to_runtime, mechanism, notes?, evidence_ids, ref_sha)`
records one crossing between runtimes: a TypeScript server starting a Python
process, say, over stdio. The newest row for each `(from_runtime, to_runtime, mechanism)`
is the effective one, so a correction is a new row. `withdraw_runtime_boundary(from_runtime, to_runtime, mechanism, reason?, ref_sha)`
takes an edge off the map; recording it again puts it back. `get_runtime_boundaries()`
returns the effective crossings, each with its `origin` (`recorded`, or `imported`
from an earlier version's table, with no evidence), its `evidence_ids`, and how many
edges were withdrawn. The writers need an active session. They refuse:

- `record_runtime_boundary refuses: <field> is one line of at most 120 characters with no '|'` — `from_runtime`, `from_language`, `to_runtime` or `mechanism`; the map is a table with a row for each crossing.
- `record_runtime_boundary refuses: notes is one line of at most 400 bytes with no '|'` — say less.
- `record_runtime_boundary refuses: a crossing cites the evidence it was read from` — `evidence_ids` is empty or names a row that does not exist.
- `record_runtime_boundary refuses: a crossing cites at most 64 evidence rows` — cite the rows the crossing rests on.
- `record_runtime_boundary refuses: ref_sha <ref> does not resolve` — record the revision the crossing was read at.
- `withdraw_runtime_boundary refuses: no crossing from <from> to <to> by <mechanism> is on the map` — name an edge `get_runtime_boundaries` lists.
- `withdraw_runtime_boundary refuses: a reason is one line of at most 400 bytes with no '|'` — say why the crossing is gone in fewer.
- `withdraw_runtime_boundary refuses: ref_sha <ref> does not resolve` — record the revision the crossing was found gone at.

### Concern territory and probe, and `record_territory_disposition`

`add_concern(code, category?, origin, discovered_in?, notes?, territory?, probe?)`
takes the territory the concern was seeded from, by its id in
`concern-territories.md` (`T7`), and the probe that tests it in this codebase, of
at most 1200 bytes. Adding a code again updates them when given and keeps them
when not; `list_concerns` returns both. It refuses:

- `add_concern refuses: territory is the id of a territory in concern-territories.md` — name it as `T7`, not in words.
- `add_concern refuses: a probe is limited to 1200 bytes` — say the check in fewer.

`record_territory_disposition(territory, disposition, condition?, open_question_id?, ref_sha)`
records whether a territory applies to the project: `applies`, or `disqualified`
with the condition that rules it out. The newest row for each territory is
effective. It needs an active session, and refuses:

- `record_territory_disposition refuses: territory is the id of a territory in concern-territories.md` — name it as `T7`.
- `record_territory_disposition refuses: a disqualified territory names the condition that rules it out` — pass `condition`.
- `record_territory_disposition refuses: a condition is one paragraph of at most 400 bytes` — no blank line, and no line starting with `#`, `-`, `*` or `|`.
- `record_territory_disposition refuses: no open question <id>` — pass the id `record_open_question` returned, or omit it.
- `record_territory_disposition refuses: ref_sha <ref> does not resolve` — record the revision the territory was judged at.
