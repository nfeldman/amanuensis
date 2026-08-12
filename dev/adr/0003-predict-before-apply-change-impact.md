# ADR-0003: Persist change-impact predictions before applying invalidation

- Status: accepted for A2
- Date: 2026-08-12
- Deciders: Amanuensis roadmap implementation; product-level authority remains with the user

## Context

Amanuensis must turn a Git range into a precise set of knowledge that needs
revalidation. A conservative whole-subsystem stale flag is safe but destroys
too much useful authority. An inferred relation graph can improve recall, but
letting a model silently expand invalidation makes the result nondeterministic
and difficult to audit.

The result also has two distinct jobs: predict what should lose authority, and
then mutate the system of record. Combining them makes it impossible to record
the expected diff before inspecting the consequences.

## Decision

Separate impact into two durable operations:

1. `predict_change_impact` resolves a rename-aware Git diff, maps paths through
   the file ledger and evidence, traverses explicit xrefs and seams, and stores
   every impacted object and explanation path without changing claim validity.
2. `apply_change_impact` re-reads the stored prediction, rejects intervening
   claim drift, creates structured Git-range evidence, and atomically closes
   the predicted current claims while appending validity events.

Exact `R100` renames remain observable but do not seed semantic invalidation.
Changed paths without a ledger mapping become explicit gap objects. In
`request-if-gap` mode the predictor emits a provider-neutral discovery request;
it never calls a lexical, embedding, or model provider itself. Candidate
relations must enter the explicit graph and be independently re-predicted
before they can invalidate anything.

The first implementation traverses xrefs and seam endpoints bidirectionally.
That matches their existing repository contract as cross-references and shared
boundaries. Directional runtime semantics are not inferred from relationship
names.

## Options considered

### A. Mutate while walking the graph

This is operationally simple but destroys the prediction/apply boundary. A
partial failure can leave claims closed without a complete artifact, and an
operator cannot compare predicted with realized impact before authority moves.

### B. Persist prediction, then apply atomically

This adds storage and a drift check, but preserves the pre-comparison artifact,
makes every invalidation explainable, and permits dry runs, fixture scoring, or
abandonment without rewriting history. This is the selected option.

### C. Ask a model for the affected set first

This may find relations absent from the explicit graph, but its nondeterminism
would be inside the safety-critical path before the deterministic baseline has
been measured. A2 therefore exposes only a bounded escalation packet.

## Consequences

- Prediction exit zero means the artifact is well-formed, not that recall is
  sufficient. Labeled fixture metrics remain separate.
- Empty Git ranges report an out-of-band zero denominator instead of a green
  impact verdict.
- Every invalidated claim retains a traversable reason path and one durable
  validity event tied to the range evidence.
- Relation gaps remain visible. The engine does not pretend an explicit graph
  covers runtime or generated-code coupling.
- A failed apply is all-or-nothing. Intervening validity changes require a new
  prediction rather than best-effort skipping.
- Rollback can stop applying predictions and return to conservative subsystem
  invalidation without deleting runs or validity events already written.

## Verification obligations

- [x] Record the prediction before loading expected fixture outcomes.
- [x] Measure exact known-invalidating and benign-rename arms with denominators.
- [x] Remove and restore both xref and seam edges and observe the predicted
  downstream claims disappear and return.
- [x] Exhaustively check all four subsets of the two-edge relation core.
- [x] Demonstrate explicit-relation ablation before admitting discovery output.
- [x] Prove application writes validity events and fails atomically on drift.
