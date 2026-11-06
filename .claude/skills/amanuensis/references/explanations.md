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

## Tools

Both tools need an active session, attribute the row to it, and resolve
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
