# ADR-0009: Verify the composition at integral HEAD after exact unit fan-in

- Status: accepted for A8
- Date: 2026-08-12
- Deciders: Amanuensis roadmap implementation; final shipping authority remains external

## Context

A7 can produce, challenge, and aggregate high-custody findings, but each pass
still has a declared object. A unit review, a local test, or a worker success
message cannot establish that independently correct pieces compose. The
important missing cases are seams: a producer can satisfy its local contract
and a consumer can satisfy its own while their versions, ordering assumptions,
or cardinalities disagree only in the assembled repository.

Aggregation also has a mundane but consequential failure mode. Reasoning over
“whatever arrived” treats a missing artifact, commit, slow check, or review
result as less data rather than a hole. A warning about that hole does not halt
anything, and a forward reference can disappear from the final report unless
it receives an owned destination.

## Decision

### Immutable fan-in manifest

`plan_composition_run` binds one A2 impact artifact to the exact currently
checked-out HEAD and tree. Before work begins it enumerates every expected
artifact, commit, test, and A7 review result. Each item names a verification
scope (`unit` or `integral-head`), subject, expected identity, and target SHA.
The manifest requires all four unit item kinds and integral test and review
items. Integral items must target the assembled HEAD; unit commits must be
ancestors of it.

Dispatch, landing, and scoring are separate write-once transitions. Landing
records a worker observation without accepting its success label. Scoring then
checks durable state:

- artifacts must exist in the registry with a content hash and exact ref SHA;
- commits must resolve, equal the expected commit, and occur in assembled HEAD;
- tests must retain identity, target SHA, exit zero, and an output hash; and
- review results must have a terminal A7 aggregation at the target SHA, with an
  `integral-head` context profile for composition-scoped review.

Schema triggers bind every status transition to its proof payload. Runs, item
plans, seam selections, lanes, deferrals, and reconciliations cannot be edited
or deleted to manufacture success.

### Integral lane as a different verification object

The integral lane cannot dispatch until every expected unit item has scored
pass and no deferral exists. Its object is the assembled repository, not a diff
or a sum of unit findings. It receives the exact HEAD/tree, the integral item
manifest, and every impacted seam with at least one named active concern. It
lands clean-worktree coordinates; a different commit, tree, mode, or any dirty
path blocks the run.

Zero impacted seams are out-of-band and require an explanation rather than a
green denominator. If seams exist, the selected seam set must equal the impact
artifact's set exactly.

### Reconciliation and deferrals

Each reconciliation appends expected, dispatched, landed, scored, passed,
failed, and deferred counts. Green requires equality across the entire expected
set, zero failures, zero deferrals, and a passing integral lane. A red
reconciliation can be followed by later collection; history remains visible.

A composition deferral is itself red. It must name an existing open blocking
revalidation obligation, optionally names the item that surfaced it, and is
included in every final reconciliation. Naming a future source is not a
destination and cannot discharge the concern.

## Alternatives rejected

- **Infer composition from all local checks passing:** changes the verification
  claim without changing the object any check examined.
- **Run another diff review at the end:** a diff-scoped lane can still omit a
  current seam or pre-existing interaction in the composed system.
- **Count any nonempty set of arrivals:** makes missing results invisible and
  biases the conclusion toward faster or easier lanes.
- **Trust worker success messages:** cannot distinguish a completed task from a
  missing artifact or unlanded commit.
- **Warn and continue on deferrals:** makes the final green state compatible
  with an acknowledged unresolved composition concern.
- **Reuse an earlier integral result:** the result's truth is bound to one tree;
  another HEAD is another verification object.

## Consequences and limits

- Composition completeness is mechanically queryable, including realized N and
  every missing or failed item.
- Seam concern selection is impact-shaped and complete relative to the recorded
  graph. An unmodeled seam remains an upstream record-quality limitation.
- The worker adapter must actually create the clean checkout and run the
  declared commands. The substrate verifies returned commit/tree/dirty-path
  proof and result identities; it cannot independently observe another process's
  filesystem namespace.
- A passing integral corpus is evidence for the checks executed, not a proof
  that all possible interactions are safe.

## Practice basis

Practice catalog v2.8: GP20 (gaps have destinations), GP21 (unit verification
does not compose), GP22 (integral lane at HEAD), GP23 (deferrals stay red),
GP24 (fan-in asserts completeness and realized N), GP25 (guards halt), VP4
(every gate turns red with its denominator), VP7 (graded positive/negative
control ladder), and VP11 (dispatched/landed/scored reconciliation).

## Verification obligations

- [x] Producer and consumer local checks pass while a seeded version mismatch
  fails only the integral contract.
- [x] A worker success message without its expected artifact scores fail and
  keeps fan-in red.
- [x] Expected, dispatched, landed, scored, passed, failed, and deferred counts
  are reported explicitly and reconcile against the immutable manifest.
- [x] An integral result is tied to exact assembled HEAD/tree and a clean
  worktree and cannot be reused for another state.
- [x] Every impacted seam has named active concerns; zero seams are out-of-band.
- [x] A deferred concern names an open blocking obligation and remains visible
  in final reconciliation.
- [x] A compatibility repair reaches green only after every one of six expected
  items passes and the integral lane has independently passed.
