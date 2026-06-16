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
entries (`define_term`) for the non-obvious names.

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

### 6. Update file classifications

Files actually read in this phase move from `candidate` to
`examined` via `update_file_classification`.

### 7. Vocabulary

Continue adding terms via `define_term`. Any internal name whose
meaning required reading code should be captured with enough
expansion that the next survey pass does not have to rediscover it.

## Output artifact

Write a prose structural summary into the subsystem's survey
artifact at the project storage root: `<id>-<slug>.md`. Sections:

- **Key types** — table with symbol, role, source `file:symbol@sha`.
- **State containers** — table per the list above.
- **Data flows** — at least one end-to-end, with numbered steps.
- **Concurrency model** — prose paragraph with evidence citations.
- **Seam contracts** — one sub-section per seam, this side filled
  in.

After writing, call
`register_artifact(path="<id>-<slug>.md", kind="subsystem-survey",
subsystem_id, ref_sha=<session sha>)` then
`rehash_artifact(path, ref_sha=<session sha>)`.

## Hand back

Return to the coordinator with a one-line summary:

- Counts of key types, state containers, flows documented.
- Concurrency model verdict.
- Seam contracts written + any seams where contract detail is still
  unknown.
- Vocabulary additions.
- Field notes from reading.
- Open questions logged this phase.

The coordinator advances status to `structural` and starts Phase 3
immediately. No pause.

For seams where you genuinely cannot tell the contract from this
side (e.g. ordering depends on a runtime config you can't read),
fill in what you can and
`record_open_question(category="ambiguous-evidence", what_assumed=...)`
for the rest.

## Rules

- **Types before implementation.** Read class bodies for method
  signatures and invariants, not for line-by-line logic.
- **Cite everything.** Every structural claim in the summary needs a
  `file:symbol@sha` reference.
- **Do not classify concerns yet.** Phase 3 does that. If you notice
  a concern while structural reading, record a
  `field_note(category="candidate-concern")` and continue mapping.
- **Do not cross into unmapped territory.** If a flow exits this
  subsystem into another, stop at the seam and record the boundary
  contract.
