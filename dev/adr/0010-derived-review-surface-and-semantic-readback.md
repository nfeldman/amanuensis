# ADR-0010: Derive the review surface and verify its semantic export

- Status: accepted for A9
- Date: 2026-08-12
- Deciders: Amanuensis roadmap implementation; final code and product decisions remain external

## Context

A8 establishes whether exact unit results compose at one assembled HEAD. That
record is rigorous but still forces a reviewer to know storage tables, join
finding history manually, and infer whether an item is new, regressed,
pre-existing, disproved, or merely suspected. That violates the product's
original time-saving promise and creates a second risk: a polished export can
preserve rows while changing their meaning or silently omitting uncertainty.

The review surface therefore needs to be both derived and inspectable. It may
compress durable records, but it cannot invent another source of truth. The
labels that matter to a decision must be operational definitions, and every
actionable item must reach its evidence without requiring schema knowledge.

## Decision

### Derive an immutable session from terminal composition state

`compile_review_session` accepts only a reconciled `complete` or `blocked` A8
composition whose impact head equals the assembled HEAD. It emits a compact,
immutable set of items grouped into situation, findings, challenges,
regressions, latent defects, stale knowledge, open obligations, unknowns, and
history. Item IDs are stable hashes of source identity and semantic state;
every item retains a record URI and source backlink.

The semantic labels have deterministic meanings:

- **regression:** currently open finding with a prior `verified-fixed` event;
- **latent defect:** currently open finding whose evidence ref is at or before
  the impact base, with no prior verified repair;
- **ruled-out historical:** current finding resolution is `ruled-out`;
- **unverified suspicion:** open `candidate-concern` field note;
- **unknown:** open question;
- **stale knowledge:** a claim validity interval closed at or before the
  reviewed HEAD; and
- **survived, contested, or defeated challenge:** the terminal mechanical A7
  aggregation for a hypothesis referenced by the composition.

The tool does not claim that these definitions are universal ontology. They are
the review contract's operational partitions, chosen so downstream consumers
cannot casually collapse unlike epistemic states.

### Make expansion and decisions explicit

The default response returns compact items. `expand_review_session_item` returns
the source record, cited evidence, and review backlink in one call. Compilation
rejects an actionable item without cited evidence, except an open obligation:
its structured durable row is already the work-custody record and destination.

`complete_review_session` records the advice furnished and the reviewer's
accepted or rejected decisions separately. Advice cannot become a decision by
mere inclusion in a report, and both arrays must reconcile to known session
items at the schema boundary.

### Verify export semantics after writing

`export_review_session` writes canonical JSON and a Markdown projection only
under fixed project-storage paths. Lexical containment is insufficient, so the
writer also resolves the nearest existing ancestor and rejects a symlink that
escapes storage.

`verify_review_export` reads the JSON back and independently checks three axes:

1. **state:** session identity, reviewed SHA, and source summary hash;
2. **coverage:** the exact stable item-ID set, including unknowns; and
3. **content:** semantic state, section, epistemic kind, statement, record URI,
   and evidence identity for every item.

Verification is append-only and its stored booleans and mismatch count must
reconcile to the report JSON in SQLite. A label swap or removed unknown is red
even if the document remains well-formed.

### Measure task outcomes

Session evaluation requires verification minutes, a constraint denominator,
and the missed-constraint count. Expansion count is retained to measure the
cost of evidence access. Satisfaction is optional context and cannot replace
task-performance measures.

## Alternatives rejected

- **Render the current dashboard:** it lacks change, challenge, temporal, and
  composition semantics and offers no exact export correspondence.
- **Let a model summarize database rows:** makes labels, selection, and omission
  nondeterministic before a trustworthy task-bounded contract exists.
- **Use severity as the review taxonomy:** severity does not distinguish a new
  defect from a regression, stale history, suspicion, or uncertainty.
- **Validate only JSON shape:** a semantically corrupted but structurally valid
  export would pass.
- **Treat furnished advice as accepted:** collapses assistant output into user
  authority and makes completion records misleading.
- **Allow caller-selected export paths:** expands filesystem authority without
  advancing the review use case.

## Consequences and limits

- Review consumers no longer need SQLite table knowledge for the A9 decision
  surface, while every item remains traceable to durable storage.
- Exact operational labels make semantic corruption testable and establish the
  vocabulary A10 can preserve in `CodebaseBrief`.
- One expansion is a structural property of the API. Whether the resulting
  evidence is sufficient remains an evidence-quality and user-testing question.
- Latency and missed-constraint metrics now have a durable home, but this slice
  does not claim a measured improvement until real sessions are recorded.
- Current compilation is repository-wide within the terminal composition. A10
  owns task-bounded selection and explicit omission semantics.

## Practice basis

Practice catalog v2.8: GP7 (explicit uncertainty), GP11 (separate observation,
inference, and question), GP12 (preserve provenance), GP14 (progressive
disclosure), GP28 (read-back verification), VP12 (operational definitions), and
VP20 (task performance rather than satisfaction alone).

## Verification obligations

- [x] Regression, latent defect, ruled-out history, unverified suspicion, and
  unknown appear as distinct operational states in one seeded session.
- [x] Every actionable compact item reaches its source and evidence in one
  expansion.
- [x] Completion preserves advice and decisions as separate reconciled fields.
- [x] A fixed-path export rejects a symlink-parent escape outside project
  storage.
- [x] Green read-back reconciles state, exact coverage, and content.
- [x] Swapping regression/latent labels and removing an unknown independently
  turn semantic read-back red.
- [x] Evaluation requires verification time and missed-constraint denominators;
  satisfaction remains optional.
