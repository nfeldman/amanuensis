# Phase 2 · Structural inventory

Phase 2 of a subsystem survey: **map the subsystem's shape** — type
graph, state containers, data flows, concurrency model, seam
contracts from this side — so Phase 3 can evaluate concerns against
an actual map instead of raw code.

## Inputs

- `subsystem_id`, `session_id`, `survey-session SHA`.
- Call `get_subsystem_files(subsystem_id)` — the file ledger from
  Phase 1 is what you read.

If you need to expand scope mid-phase, update the ledger via
`add_files_to_scope`. Do not quietly read files outside the ledger.

## Process

### 1. Key types first

For statically typed languages, read class/struct/type/interface
definitions before any method bodies. The type graph is higher
signal than implementation detail. Record in prose; add vocabulary
entries (`define_term`) for the non-obvious names. Each term's
`first_seen` is a `file:symbol@sha` anchor whose revision must resolve
and whose path must exist in that revision's tree, or the call is
refused.

### 2. State containers

For every significant mutable state holder:

- Name and approximate location.
- What it stores.
- Lifetime (per-request, per-session, per-process, persistent).
- How it is populated; how it is invalidated or updated.

Pay particular attention to **caches and locks** — disproportionately
likely to harbor correctness bugs.

### 3. Primary data flows

At least one end-to-end trace of the primary data flow, with
file + symbol references at each step. If there are multiple
independent flows, trace each.

Each flow ends in marks or a declination. Once its steps are recorded as
claims (step 7), call `record_claim_mark(claim_id, kind, label, target,
evidence_id, ref_sha)` for each commit point, crash point, exit, seam crossing
and trigger you read, or say the flow has none with
`decline_claim_marks(flow, reason, ref_sha)`. Step 7 lists the kinds and what
the writers refuse. Neither refuses the advance; a flow with neither is shown
on its page as having no marks recorded.

### 4. Concurrency model

Single-threaded? Pool? Async runtime? Actor? GIL? Is there shared
mutable state crossing threads or async boundaries? Document with
evidence — not by intuition from naming.

### 5. Seam contracts from this side

For every seam this subsystem participates in, update the seam via
`upsert_seam`:

- `a_writes` / `a_reads` (or `b_writes` / `b_reads` depending on the
  seam row's `party_a` / `party_b` assignment).
- `ordering_assumption` — `total-ordering` | `causal` | `none` |
  `unspecified`.
- `cardinality` — `single-consumer` | `fan-out` | `n-to-n` | etc.
- `staleness_tolerance` — `strong-consistent` | `bounded:<duration>` |
  `eventual` | `not-specified`.
- `schema_owner` if one party owns the schema.

You are writing **this subsystem's half of the contract**; the
counterpart fills in the other half when it is mapped. Seam concerns
(`SC-N` codes) are evaluated later by the adversarial agent or the
coordinator's seam-assessment step — not here.

### 6. Crossing edges

Call `add_xref` once for every data flow or dependency that crosses a
subsystem boundary; one row per crossing. The traces from step 3 that
leave this subsystem and the seams written in step 5 are where they
are found.

- `from_id` / `to_id` — the two subsystems, in the direction the data
  or the dependency runs.
- `relationship` — `data-flow` where a value crosses, `dependency`
  where a call or an import crosses. Those two are what a crossing
  edge is; the other canonical values describe resemblances between
  subsystems rather than traffic between them.
- `strength` — `observed`, `confirmed`, or `structural`.
- `context` — **required**, and it must carry a citation. Write one
  line of prose saying why the link matters, with at least one
  `file:symbol@sha` token in it naming where you read the crossing.
  The context is split on whitespace and at least one token must be
  exactly `<path>:<symbol>@<7-40 hex sha>`, so leave the token
  unpunctuated — `… at src/queue.ts:enqueue@a1b2c3d`, not
  `(src/queue.ts:enqueue@a1b2c3d)`. The path is checked as a workspace
  source path and the revision must resolve in this repository. The
  symbol is not checked for reachability, so cite the symbol you
  actually read. An edge with no such token cannot be recorded.

Record only edges you read. Never infer one from a shared name, a
path prefix, or a nearby seam: `architecture.md` renders its topology
from these rows and nothing else, so an inferred edge becomes a
published relation no one verified. A boundary you could not read
from this side is an `record_open_question`, not a guessed edge.

### 7. Record the inventory as claims

Prose is not revision-bound. Everything the steps above established is
also recorded through `add_claim`, so a later reader can tell what is
still current from what a newer commit has superseded, and so the
adversarial pass has something to challenge.

One claim per structural fact, with a `claim_key` that is **stable
across re-surveys** — the next survey of the same fact supersedes this
claim rather than adding a duplicate beside it.

`<symbol-slug>` is the whole `<path>:<symbol>` pair — the same string
`subject_id` carries — lowercased with non-alphanumerics collapsed to
`-`, so `src/http/config.ts:Config` slugs to
`src-http-config-ts-config`. The path is part of it because
`idx_claims_current_key` admits one current row per `claim_key`: a slug
built from the symbol alone makes two files that both define `Config`
collide, and the second reading is refused rather than recorded, so the
subsystem's inventory is silently short by one (slice-S3, F9/codex).
Two symbols of the same name in one file are the language's problem,
not the key's.

- **Key type** — `<sid>/key-type/<symbol-slug>`; `subject_type:
  "symbol"`, `subject_id: "<path>:<symbol>"`; `epistemic_kind:
  "observation"`; at least one evidence row of kind `code-verified` or
  `contract-stated` citing that same `<path>`.
- **State container** — `<sid>/state-container/<symbol-slug>`; subject
  and evidence as for a key type. State the lifetime and the
  invalidation rule in the `statement`.
- **Flow step** — `<sid>/flow/<flow-slug>/<nn>`, `<nn>` zero-padded in
  execution order; subject and evidence as for a key type, naming the
  symbol that step runs.
- **Concurrency invariant** — `<sid>/concurrency`; `subject_type:
  "subsystem"`, `subject_id: "<sid>"`; `epistemic_kind: "observation"`
  when you read the guarantee, `"inference"` when you derived it from
  the runtime; at least one evidence row, any kind.
- **Seam contract** — `<sid>/seam/<seam-id>`; `subject_type: "seam"`,
  `subject_id: "<seam-id>"`; `epistemic_kind: "observation"`; at least
  one evidence row citing the writing or the reading site.

The server refuses a `key-type`, `state-container` or `flow` claim
unless one attached evidence row is `code-verified` or
`contract-stated` **and** cites the file named in `subject_id`. Those
three are read off one file, so the record can require that the reading
cite it. Concurrency and seam claims carry the weaker requirement on
purpose: they are frequently derived rather than read, and a kind the
evidence cannot honestly carry is worse than an honest weak one.

**A category that is genuinely empty is claimed as an explicit
negative, not omitted.** Drop the symbol segment and make the
subsystem the subject: `<sid>/key-type`, `<sid>/state-container` or
`<sid>/flow`, with `subject_type: "subsystem"`, `subject_id: "<sid>"`,
and a `statement` that says plainly what is absent and over what
scope — "B-04 holds no mutable state container; every value it
computes is returned, not retained."
Cite the evidence rows you read to conclude it. An absence is not read
off one symbol, so the file-anchored rule above does not apply to it.

**This is a prerequisite, not a suggestion.** The advance to
`structural` is refused unless at least one current claim carries a
`claim_key` beginning `<sid>/`. No count beyond one is required and no
category is mandatory — a quota over a field you have to author invites
padding rather than accuracy. Record what you found; the adversarial
pass in Phase 4 pulls every one of these claims as a target and is
where their truth is tested.

**Flow marks.** A flow step can carry marks that say what the step does
to the flow. `record_claim_mark(claim_id, kind, label?, target?, evidence_id,
ref_sha)` records one on a current flow-step claim:

- `commit-point` — the step after which the flow's effect is kept; no label or target.
- `crash-point` — a step where the process can stop partway; `label` says what is left half done.
- `exit` — a way the flow stops early; `label` says why, `target` is the number of the step it unwinds to (`03`) or `leaves-flow`.
- `crosses-seam` — a step where work passes a system boundary; `target` is a seam the subsystem is party to (`SM-02`).
- `trigger` — what starts the flow; step `00` only; no label or target.

A label is one line of at most 120 characters. `evidence_id` is one row that is
`code-verified` or `contract-stated` and cites the file the step's claim is about.
A mark stands while its claim is current. When a claim is superseded its marks
do not carry over, so the successor records its own. `withdraw_claim_mark(mark_id,
reason)` retracts a mistaken mark without closing the claim, and a flow with no
marks to record says so with `decline_claim_marks(flow, reason, ref_sha)`, where
`flow` is `<sid>/flow/<slug>`. `get_claims` returns each claim's standing marks as
`marks`, and a flow step's flow's newest declination as `mark_declination`. The
writers need an active session. They refuse:

- `record_claim_mark refuses: <kind> is not a mark kind` — use one of the five.
- `record_claim_mark refuses: no claim <id>` — pass the `claim_id` of a flow step `get_claims` lists.
- `record_claim_mark refuses: <key> is not a flow step. A mark goes on a claim keyed <sid>/flow/<slug>/<nn>` — mark a flow step.
- `record_claim_mark refuses: claim <id> is closed, so its marks would not be current` — mark the claim that replaced it.
- `record_claim_mark refuses: a trigger is the start of a flow, so it belongs to step 00` — put it on step `00`.
- `record_claim_mark refuses: a <kind> mark needs a <label or target>` — pass the one the kind carries.
- `record_claim_mark refuses: a <kind> mark takes no <label or target>` — leave it out.
- `record_claim_mark refuses: a label is one line of at most 120 characters` — say it in fewer.
- `record_claim_mark refuses: no seam <id>` — name a seam `upsert_seam` recorded.
- `record_claim_mark refuses: seam <id> lies between <a> and <b>, and <sid> is not one of them` — name a seam the flow's subsystem is party to.
- `record_claim_mark refuses: an exit unwinds to a step of its own flow or to 'leaves-flow'` — name a current step of the same flow by its number.
- `record_claim_mark refuses: no evidence row <id>` — `add_evidence` records one.
- `record_claim_mark refuses: evidence <id> does not show the step` — cite the step's file in a strong kind.
- `record_claim_mark refuses: evidence <id> was taken at a revision that ref_sha <ref> does not descend from` — record the mark at a revision that includes it.
- `record_claim_mark refuses: ref_sha <ref> does not resolve` — record the revision the mark was read at.
- `record_claim_mark refuses: mark <id> already says this about the step` — withdraw it first if it is to change.
- `withdraw_claim_mark refuses: no mark <id>` — pass the id `record_claim_mark` returned.
- `withdraw_claim_mark refuses: mark <id> is already withdrawn` — record it again if it should stand.
- `withdraw_claim_mark refuses: a reason is one paragraph of at most 400 bytes` — no blank line, and no line starting with `#`, `-`, `*` or `|`.
- `decline_claim_marks refuses: <flow> is not a flow. Name it <sid>/flow/<slug>` — without the step number.
- `decline_claim_marks refuses: flow <flow> has no current step claim` — record its steps first.
- `decline_claim_marks refuses: a reason is one paragraph of at most 400 bytes` — say why the flow has no marks in fewer.
- `decline_claim_marks refuses: ref_sha <ref> does not resolve` — record the revision the flow was read at.

### 8. Update file classifications

Files actually read in this phase move from `candidate` to
`examined` via `update_file_classification`. Every file still at
`candidate` when the subsystem advances to `mapped` is refused there by
name (*"still 'candidate', never examined"*): read it, or classify it
`deferred-with-reason` and say why it was left unread.

### 9. Vocabulary

This phase discharges the subsystem's domain-vocabulary obligation or
declines it. The advance to `structural` refuses a pass that *"neither
defined a domain term for this subsystem nor declared that it has
none"*.

Keep adding terms via `define_term`. Any internal name whose meaning
required reading code should be captured with enough expansion that the
next survey pass does not have to rediscover it. Each term's `first_seen`
is a `file:symbol@sha` anchor whose revision must resolve and whose path
must exist in that revision's tree; a term stored without one anchors
nothing and discharges nothing.

One anchored term is enough. There is no quota, and no reason to invent a
term to clear a count.

Where the subsystem genuinely has no vocabulary of its own, say so:
`decline_domain_vocabulary(subsystem_id, reason, ref_sha)`. The record is
append-only and attributed to the session that wrote it, and "none" is a
real and common answer that has to be said out loud. A subsystem *"cannot
both carry domain vocabulary and declare it has none"* — the declination
is refused where an anchored term already stands.

## Record the narrative

The prose around the inventory is recorded, not written to a file. For each
part the structure needs, call

```
record_narrative(subject_type="subsystem", subject_id, section="structure",
  topic, body, evidence_ids, ref_sha=<session sha>)
```

The parts to consider are the key types, the state containers, one flow per
primary trace, the concurrency model, and each seam from this side. `topic` is
a short title for the part, at most 120 characters; the page prints it as a
subheading. The body is prose and lists of at most 8192 bytes, with no heading
or table line. The typed parts already have their own records (claims, seams,
vocabulary), so say what they do not: why the parts are shaped as they are, and
how work moves between them. Cite each symbol as `file:symbol@sha`. At least
one of `evidence_ids` must be an `add_evidence` row for a file in the
subsystem's ledger.

Where the code supports no prose beyond the claims, say so:
`decline_narrative(subject_type="subsystem", subject_id, section="structure",
reason, ref_sha)`, with the reason in one paragraph of at most 400 bytes.
Recording or declining is what the advance to `concerns` asks for, and it
refuses with *"no structure narrative has been recorded or declined"* until one
has. A correction is a new row; the newest row for a topic is the one served.

## Hand back

Return to the coordinator with a one-line summary:

- Counts of key types, state containers, flows documented, and
  the claims recorded for them.
- Concurrency model verdict.
- The structure topics recorded, or the reason none was.
- Seam contracts written + any seams where contract detail is still
  unknown.
- Vocabulary additions.
- Field notes from reading.
- Open questions logged this phase.
- A purpose and a draft account with the `add_evidence` ids each was
  written from, or the reason none can be written.

The coordinator advances status to `structural`, answers the two
explanation slots below, and starts Phase 3 immediately. No pause. That
advance is refused if step 7 recorded no claim, so hand back only once at
least one current `<sid>/` claim exists.

For seams where you genuinely cannot tell the contract from this
side (e.g. ordering depends on a runtime config you can't read),
fill in what you can and
`record_open_question(category="ambiguous-evidence", what_assumed=...)`
for the rest.

## After the advance

Once the status reads `structural`, record the purpose and a draft account,
or decline each. `references/explanations.md` says what each contains. Both
writers refuse earlier, since *"An explanation is written by a pass that has
read the subsystem"*.

```
record_explanation(subject_type="subsystem", subject_id, slot="purpose",
  body, evidence_ids, ref_sha=<session sha>)
record_explanation(subject_type="subsystem", subject_id, slot="account",
  body, evidence_ids, ref_sha=<session sha>)
```

Where the session cannot say something true and specific yet, use
`decline_explanation(subject_type="subsystem", subject_id, slot, reason,
ref_sha)` for that slot. Declining with a reason is a complete answer.
The account is a draft at this point: Phase 4 reads it against the code and
Phase 5 revises or confirms it.

## Rules

- **Types before implementation.** Read class bodies for method
  signatures and invariants, not for line-by-line logic.
- **Cite everything.** Every structural statement in a narrative needs a
  `file:symbol@sha` reference, and every claim recorded through
  `add_claim` needs its evidence rows.
- **Do not classify concerns yet.** Phase 3 does that. If you notice
  a concern while structural reading, record a
  `add_field_note(category="candidate-concern")` and continue mapping.
- **Do not cross into unmapped territory.** If a flow exits this
  subsystem into another, stop at the seam, record the boundary
  contract, and record the crossing itself as an edge (step 6).
