# ADR-0007: Compile review context from impact before generation

- Status: accepted for A6
- Date: 2026-08-12
- Deciders: Amanuensis roadmap implementation; reviewers retain judgment and
  publication remains subject to structural gates

## Context

A1 through A5 make the conspectus temporally valid, predict impact, retain
revalidation custody, require proof of repair, and run that maintenance loop
inside a bounded unattended envelope. They do not yet turn the record into a
useful review instrument. A reviewer can query each source independently, but
that either repeats discovery work or encourages a context dump whose omissions
and selection logic are invisible.

Review context has two symmetric failure modes. A narrow diff summary can omit
a defect that lives only at a reached seam. A system-wide history dump can make
a benign rename inherit unrelated defects, increasing review time and false
positives. Token limits create a third failure mode when context simply
vanishes at the boundary.

The review brief therefore needs a reproducible selection rule, not a prose
instruction to be relevant. It must also preserve the distinction between an
observed repository fact, prior interpretation, open question, direct task
constraint, and publication authority.

## Decision

### Impact-first candidate selection

`compile_review_brief` accepts one immutable A2 change-impact run, a task,
typed task constraints, a named context profile, and a token budget. It selects
required context by traversing the durable impact artifact before considering
optional global material. The required situation model contains:

- the Git diff and repository validity boundary;
- explicit task constraints;
- reached claims whose authority may be stale;
- reached confirmed and ruled-out findings and their resolution history;
- compensating dispositions on reached subsystems;
- reached seams and their complete impact reason paths;
- contradictions, obligations, unresolved questions, stale entries, and
  unexamined files; and
- every explicit A2 coverage gap.

The compiler has three named profiles. `diff-scoped` contains only impact-shaped
required context. `control-wide` additionally exposes unaffected claims as
positive controls. `integral-head` may also include unrelated current
high-severity findings for later composition review. Profile exclusions are
declared drops in the trace; they are never indistinguishable from an empty
query.

### Reversible compression and visible loss

Every candidate becomes an immutable `review_brief_trace` row recording its
section, source object, inclusion action, reason, full typed source JSON,
provenance, estimated token cost, and any obligation destination. Compact brief
items retain the trace identifier. `expand_review_brief_item` resolves that
identifier to the typed source and independently checks whether its evidence is
reachable at the reviewed commit.

Required context that exceeds the token budget blocks the brief. Optional
context is marked truncated. Both receive durable review-context obligations.
An uncovered changed file is included as an explicit gap and also receives a
deferred obligation. Empty sections have deterministic sentinels explaining
that their query had no applicable rows; they are not counted as successfully
retrieved evidence. Any attached structured evidence that is not reachable at
the reviewed commit also blocks its context item and creates an obligation.
Compiler-owned review-context obligations are excluded from later compiler
inputs so repeated briefs and validation arms cannot recursively contaminate
their own context sets; upstream A3 obligations remain eligible.

### Structural control score and independent publication

The compiler reports five equally weighted, operational components:

1. task-constraint coverage;
2. impacted-seam coverage;
3. stale-claim coverage;
4. provenance coverage over included trace rows; and
5. explicit-gap visibility.

The score is a structural completeness control, not a semantic quality or
confidence estimate. Publication requires a score of exactly one and complete
required-section reconciliation. `publish_review_brief` then independently
recomputes the impacted-seam denominator from the A2 artifact and counts only
included seams with a nonempty impact reason path. It verifies the immutable
brief hash, reviewed commit, and evidence reachability before writing an
append-only publication receipt. The brief payload, retrieval trace, and
publication receipt cannot be edited or deleted to manufacture a green result.
The schema also rejects a receipt whose trace, seam, provenance, evidence, hash,
or repository-state denominators disagree, and rejects a `published` status
transition until that receipt exists.

`validation_ablate` is deliberately exposed as fault injection for the A6
control harness. Removing task constraints, seams, or stale claims must lower
the corresponding score component and block publication in the same run cycle.
It is not a production repair mechanism.

## Alternatives rejected

- **Let the reviewer model search freely:** this makes missing context and
  selection bias irreproducible and cannot distinguish an empty query from an
  unnoticed source.
- **Always load the entire conspectus:** this gives benign changes irrelevant
  defect history, consumes budget before task-specific evidence, and measures
  context volume rather than sufficiency.
- **Use embeddings as the first selector:** current explicit Git, file-ledger,
  claim, cross-reference, and seam relations are cheaper to audit and supply a
  traversable explanation. Semantic retrieval can later compete as a measured
  supplement.
- **Truncate required sections to fit:** this can create a polished review brief
  that silently lacks the only applicable contract. Required loss must stay
  red.
- **Let the compiler certify its own seam set:** a bug in selection would also
  bless the same bug at publication. The publisher recomputes the denominator
  from the prior durable artifact.
- **Treat the control score as review correctness:** complete inputs do not
  imply a correct conclusion. A7 supplies independent generation, refutation,
  and verification.

## Consequences and limits

- A reviewer can inspect one compact situation model and expand any item to its
  source and repository-valid evidence without rerunning retrieval.
- Every inclusion, declared exclusion, truncation, and blocking loss is
  queryable for later method evaluation.
- Benign diffs remain narrow by construction, while seam-only risk is a hard
  publication denominator rather than a prompt suggestion.
- The compiler inherits omissions from the A2 impact graph and the surveyed
  record. Explicit uncovered paths and unexamined files make known gaps visible,
  but cannot reveal relationships the record never modeled.
- The structural score establishes context custody only. It does not claim
  actionable precision, missed-contract performance, reviewer usefulness, or
  reduced verification time; those require A7 and the roadmap metrics.
- Stored source JSON is a review artifact bound to one commit. It is historical
  evidence, not newly current authority after later repository changes.

## Practice basis

Practice catalog v2.8: GP7 (structured briefing), GP11 (provenance and chain of
custody), GP12 (observation/inference/open-question separation), GP14 (context
shaping), GP20 (visible gaps have destinations), GP26 (context-set diversity),
VP8 (two-sided positive controls), and VP9 (same-cycle ablation).

## Verification obligations

- [x] A known cross-seam defect retrieves the seam, full reason path, confirmed
  and ruled-out history, compensating control, stale claims, contradictions,
  unknowns, and the uncovered changed file.
- [x] An exact rename retrieves its diff but none of the unrelated defect,
  stale-claim, or seam history.
- [x] Removing task constraints, impacted seams, or stale claims lowers the
  predicted component to zero and blocks publication.
- [x] A compact stale claim expands to typed evidence reachable at the reviewed
  commit while retaining its withdrawn authority.
- [x] Evidence newer than the reviewed commit blocks its context item, creates
  a durable obligation, and cannot be published.
- [x] Diff-scoped and control-wide profiles produce measurably distinct context
  sets and declare their exclusions.
- [x] Repeated compilation retains the same source-object trace and does not
  retrieve obligations generated by the prior brief.
- [x] Budget exhaustion names every blocked or truncated item, creates an
  obligation destination, and blocks publication when required context is lost.
- [x] Publication independently reconciles the seam denominator and provenance,
  writes one idempotent receipt, rejects premature status or forged receipts,
  and rejects payload, trace, or receipt mutation.
