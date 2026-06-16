# Phase 1 · Scope

Phase 1 of a subsystem survey: **define what is in scope before reading
anything in depth.** No method bodies yet. The ledger exists to
prevent sampling bias in later phases — if you only ever read the
files you happened to notice first, your concern coverage inherits
that bias.

## Inputs

- `subsystem_id` (the one being scoped).
- `session_id` (tag every DB write with it).
- `survey-session SHA` (every `ref_sha` in this phase uses it). Get
  via `git rev-parse HEAD` on the canonical branch.

Call `get_subsystem_files(subsystem_id)` first. If there are
pre-existing rows from an earlier session, they were produced at a
different SHA and may be stale — review them, keep classifications
that still apply, update where the file moved.

## Process

### 1. Find the files

Start from `jump_in_reading` on the subsystem row. Then search for
files participating in the subsystem by:

- Name patterns consistent with the subsystem's domain vocabulary.
- Import/dependency graph edges from seed files.
- Directory neighborhood of seed files.
- Callers and callees of key symbols (semantic tools first; grep
  last).

### 2. Classify each file

For every candidate, call `add_files_to_scope` with one of:

- `candidate` — in scope, not yet read (default after scoping).
- `examined` — only set this at the end of Phase 2/3 when it's
  actually read.
- `generated-ignore` — generated code. Record the **source schema**
  and runtime consumer separately as scoped files.
- `vendor-ignore` — third-party / vendored code.
- `irrelevant` — confusingly named but not in scope.
- `deferred-with-reason` — worth surveying eventually but outside
  this pass.

Every file gets a `why_in_scope` rationale. No blanks. No leaving a
file as `candidate` with no rationale — if you can't say why it's in
scope, it probably isn't, or you haven't understood it yet. Either
way, neither is a reason to silently skip.

### 3. Seed vocabulary

For every significant domain term encountered (non-obvious protocol
names, internal jargon, legacy concepts, borrowed words from other
disciplines), call
`define_term(term, gloss, expansion, subsystem_id, first_seen, ref_sha)`.

Two levels:

- `gloss` — one sentence, enough to *use* the term.
- `expansion` — enough to *teach* the concept (multi-paragraph is
  fine).

Vocabulary seeded now prevents a cascade of guesswork in later
phases.

### 4. Stub every seam

For every boundary where this subsystem communicates with, shares
state with, or makes behavioral assumptions about another
subsystem:

- If the counterpart subsystem is already registered:
  `upsert_seam(id="SM-...", shared_object, shared_object_kind,
  party_a=<this subsystem>, party_b=<counterpart>, ...)`.
- If the counterpart subsystem does not exist in the master plan
  yet, still record the seam with a best-guess `party_b` and a
  `field_note(category="connection", ...)` flagging the missing
  counterpart. The coordinator will reconcile IDs later.
- Leave behavioral-contract fields (`a_writes`,
  `ordering_assumption`, etc.) blank at this phase — those are
  Phase 2's job.

### 5. Record peripheral observations

Anything the phase structure does not ask for goes into
`add_field_note`. Categories:

- `pattern` — recurrence across files/subsystems.
- `anomaly` — deviation from the pattern you'd expect.
- `tension` — two local-correctness invariants in conflict.
- `candidate-concern` — pattern that might warrant a new concern code.
- `connection` — cross-subsystem link not yet represented in xrefs.

## Hand back

Return to the coordinator with a one-line summary:

- Files added to scope, broken down by classification.
- Vocabulary terms defined.
- Seams stubbed.
- Field notes recorded.
- Open questions logged this phase (by category).

The coordinator advances `update_subsystem_status(id, status="scoping")`
and starts Phase 2 immediately. No pause.

When you're not sure whether a file is in scope, prefer
`record_open_question(category="scope-judgment", what_assumed=...)`
plus your chosen classification over halting.

## Hard rules

- **Do not read method bodies.** Type definitions, imports,
  signatures, configuration — yes. Implementation detail — no.
  Phase 2 is for that.
- **Do not skip files because the name seems unrelated.** Naming is
  a signal. Read directory structure and imports.
- **Do not leave a candidate file without a `why_in_scope`.** If you
  cannot say why it's in scope, it probably isn't — or you haven't
  understood it yet.
- **Do not confuse generated files with analysis targets.** Trace
  them back to source schema and runtime consumer; survey those.
