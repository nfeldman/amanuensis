# Explanations

What a part of the codebase is for, and how it works, written down by a survey
session that has read it. An explanation is recorded at a revision, over the
evidence it was written from, and is kept: a correction is a new row, and the
newest row whose revision still resolves is the effective one. The record
establishes who wrote the explanation, at which revision and over which evidence.
It does not establish that the explanation is true.

There are two slots. A **purpose** (subsystem) is one paragraph of at most 400
bytes. An **account** (subsystem or project) is prose and lists of at most 4096
bytes. The project has no purpose slot: its purpose is the thesis in
`entry-point.md`. There is no minimum length and one evidence row is enough.
Declining is a real answer. A session that cannot say something true and
specific says so, with the reason, and the reason is kept.

## What to write

**Purpose** (subsystem): one paragraph on what this part is for, in terms of what
the rest of the system or its users get from it. Not a file list, not a
restatement of scope.

**Account** (subsystem), in this order, as short prose:

1. the moving parts and how control or data passes through them;
2. the rules it enforces and where each is enforced, which is where the business
   logic is;
3. what it depends on and what depends on it;
4. what a newcomer is likely to get wrong;
5. where to start reading.

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

Rules for all three: written for an experienced practitioner new to this codebase;
the codebase's own vocabulary; no survey-status or coverage language; every
non-trivial statement traceable to attached evidence; when the session cannot say
something true and specific, it declines with the reason.

There is no length floor. A short explanation that is true is better than a long
one written to look finished. Declining with a reason is a complete answer, and a
later pass that knows more records over it.

## When each is written

| Phase | What happens |
|---|---|
| Structural (`phase-2-structural.md`) | After the advance to `structural`, record the purpose and a draft account, or decline each. |
| Adversarial (`phase-4-adversarial.md`) | Read both with `get_explanations`, then against the code. A sentence the code contradicts becomes a field note with the evidence. |
| Packaging (`phase-5-packaging.md`) | Read the account with `get_explanations`, then revise it by recording a new version or confirm it stands. The advance to `mapped` refuses a slot that is neither recorded nor declined. |
| Onboarding (`onboarding.md`) | The project account is recorded once the first subsystem reaches `structural`, and revised at each later packaging. |
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
explanation was written from. Call it again to correct an earlier explanation,
even at the same commit.

It refuses, each time with the sentence to repair:

- `record_explanation refuses: no subsystem <id>` — the subsystem does not exist.
- `record_explanation refuses: <id> is '<status>'. An explanation is written by a pass that has read the subsystem` — its status is `unmapped`, `scoping` or `deferred`.
- `record_explanation refuses: no subsystem has been read to 'structural'` — a project account needs at least one subsystem that has.
- `record_explanation refuses: the project's purpose is the thesis in entry-point.md` — a project subject takes only the account slot.
- `record_explanation refuses: an explanation cites the evidence it was written from` — `evidence_ids` is empty or names a row that does not exist.
- `record_explanation refuses: an explanation cites at most 64 evidence rows` — cite the rows the text rests on. A read serves every cited id, so its response is bounded only if the count is.
- `record_explanation refuses: an explanation resting only on names and patterns` — every cited row's kind is `name-inferred` or `pattern-matched`.
- `record_explanation refuses: none of the cited evidence is in <id>'s ledger` — no cited row's file is in the subsystem's ledger. A set that mixes ledger files with outside files is accepted.
- `record_explanation refuses: <slot> is limited to <n> bytes` — a purpose is over 400 bytes, or an account over 4096. The cap counts UTF-8 bytes.
- `record_explanation refuses: a purpose is one paragraph` — the purpose has a blank line or a line starting with `#`, `-`, `*` or `|`.
- `record_explanation refuses: an account is prose and lists` — the account has a line starting with `#` or `|`.

### `decline_explanation`

`decline_explanation(subject_type, subject_id?, slot, reason, ref_sha)` records
the reason no explanation is written, as `declined`. It is accepted whether or
not an explanation is already recorded: the newest row is effective either way.
The reason is one paragraph of at most 400 bytes, for either slot.

It applies the subject conditions of `record_explanation` with its own sentences:

- `decline_explanation refuses: no subsystem <id>` — the subsystem does not exist.
- `decline_explanation refuses: <id> is '<status>'. An explanation is written by a pass that has read the subsystem` — its status is `unmapped`, `scoping` or `deferred`.
- `decline_explanation refuses: no subsystem has been read to 'structural'` — a project account is answered once one has.
- `decline_explanation refuses: the project's purpose is the thesis in entry-point.md` — only the account is declined for the project.
- `decline_explanation refuses: a reason is limited to 400 bytes` — the reason is too long.
- `decline_explanation refuses: a reason is one paragraph` — the reason has a blank line or a line starting with `#`, `-`, `*` or `|`.

### `get_explanations`

`get_explanations(subject_type, subject_id?)` reads back what was recorded. It is
the way a later pass sees an earlier one's explanation; `describe_locus` does not
serve one. It needs no session and writes nothing. For each slot of the subject (a
subsystem has `purpose` and `account`, the project only `account`) it returns

    {slot, state, checked, authored: "model",
     row: {id, disposition, body, ref_sha, session_id, recorded_at, evidence_ids} | null,
     earlier_rows}

and `model_calls: 0`. `state` is `recorded`, `declined` or `not-recorded`. `row` is
the effective row: the newest whose `ref_sha` the workspace still reaches, so a
row written at a revision that has since been rewritten away is passed over for
the older row that resolves. `earlier_rows` counts the rows kept below it. A
subsystem that has not been read to `structural` reads `not-recorded` whatever
rows exist, the project's account reads the same while no subsystem has been, and
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
