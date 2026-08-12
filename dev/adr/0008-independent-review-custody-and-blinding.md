# ADR-0008: Separate review generation, refutation, and verification by custody

- Status: accepted for A7
- Date: 2026-08-12
- Deciders: Amanuensis roadmap implementation; reviewers retain final authority

## Context

A6 produces a complete, provenance-bearing ReviewBrief, but a good input does
not make one reviewing model independent of its own first conclusion. Asking a
generator to critique itself preserves the same context, rationale, and likely
failure modes. A deliberation round can further turn nominally separate passes
into one correlated consensus before their disagreements become observable.

The experimental apparatus has a second problem: a polished result can remain
stable for the wrong reason. Expected findings, fixture markers, or another
pass's verdict can leak through renamed fields or content. A null arm with a
different surface can measure that marker instead of reasoning. Comparing
context or runtime diversity without holding the other axes fixed also makes
the result uninterpretable.

## Decision

### Three staged roles, no deliberation

One immutable analysis manifest pins the reviewed commit, published A6 briefs,
provider allowlist, source prefixes, budgets, runtime identities, condition,
replicate, and salted blind-truth seal. Every pass has a unique durable identity
and a write-once dispatch/landing boundary.

- Generators receive one published ReviewBrief and its sanitized evidence
  catalog. They return evidence-backed candidates or an explicit non-vacuity
  report.
- Refuters dispatch only after every generator has landed and hypotheses are
  mechanically frozen. They receive anonymous claim variants and structured
  evidence, never generator rationale, confidence, provider, model, identity,
  or prior verdict. An overturn requires newly discovered evidence.
- Verifiers dispatch only after every refuter has landed. They receive the
  frozen claims plus pooled candidate and refuter-discovered evidence, never a
  refuter verdict or rationale.

There is no deliberation round. Aggregation waits for exact pass and judgment
fan-in, retains every candidate and disagreement, and marks a hypothesis
defeated only when a verifier independently overturns it using evidence newly
discovered by an overturning refuter. A survivor therefore means “unanimously
upheld by this bounded panel,” not “true.” Contested hypotheses remain visible
instead of being averaged away.

### Controlled diversity

The condition changes the candidate-generation axis while challenge roles stay
fixed within each role:

- `same-context` holds profile, frame, provider, model, and runtime fixed;
- `varied-context` varies the ReviewBrief profile and analytical frame while
  holding provider, model, and runtime fixed; and
- `heterogeneous-runtime` holds context fixed while requiring at least two
  runtime identities/model families, including one different from the
  orchestrator family.

These conditions are reported separately. The implementation makes no claim
that heterogeneity has a particular benefit; it creates the instrument needed
to measure its resolving power and false-positive profile later.

### Blinding and evaluation

Fixture truth is salted and sealed before planning and can be revealed only
after terminal judgment. Structural guards scan every runtime packet for
forbidden keys before dispatch and again in SQLite. The reveal step scans the
actual serialized packets for a content canary. Contamination records, reveals,
pass payloads, hypotheses, aggregations, and evaluation reports are immutable.
Contaminated runs are excluded from efficacy scoring.

The validation ladder contains surface-matched clean, marker-only, treated,
and deliberately incoherent null arms. Every condition/arm cell requires at
least two runs, and every pair must contain exactly one run of every arm. The
evaluator independently hashes the structural shapes of the packets actually
dispatched rather than trusting the fixture's declared surface hash. It reports
exact outcomes, set-Jaccard test-retest stability, and the metric step size per
cell; it never pools across arms or conditions. Marker findings are diffed
against their matched clean controls.

New evidence must lie inside the source envelope, name a real file at a Git
commit ancestral to the reviewed state, and be independently available to the
verifier. This proves custody and repository validity, not the semantic force
of the evidence.

## Alternatives rejected

- **One model with a self-critique prompt:** does not separate evidence access
  or preserve an independent judgment.
- **Agents deliberate before voting:** destroys the independent observations
  needed to diagnose correlated failure.
- **Majority vote:** can turn shared error into false certainty and discards
  the evidence that changed a conclusion.
- **Let refuters overturn from the original packet:** rewards adversarial tone
  without requiring a new disproof.
- **Trust fixture labels for blinding and surface parity:** lets the evaluator
  certify its own declaration instead of inspecting dispatched content.
- **Pool repetitions or conditions:** reports roster dispersion rather than
  reliability of the measured object and hides condition-specific failures.

## Consequences and limits

- Each conclusion has a reproducible custody trail from context through raw
  candidates, challenge judgments, disagreements, and status-moving evidence.
- A provider adapter can execute the outbox packets without receiving broader
  mutation authority; API calls remain outside SQLite transactions.
- More passes consume more time and money. Budgets bound the run, but A7 does
  not show that extra compute improves correctness.
- The deterministic fixture proves state transitions, blinding, paired-arm
  scoring, and red controls. It does not measure live-model semantic accuracy,
  reviewer usefulness, precision/recall, or the magnitude of a heterogeneity
  effect. Those require repeated live provider trials under this instrument.
- Finding-key grouping is a declared candidate identity supplied by generators;
  divergent claim variants remain visible in the frozen packet and aggregate.

## Practice basis

Practice catalog v2.8: GP2 (depth of independent scrutiny), GP3 (blind
challenge), GP4 (independence then aggregation), GP5 and GP30 (model
heterogeneity as a separately measured condition), GP6 (try to overturn and
uphold survivors), GP13 (generator/verifier split), GP15 (single-purpose
roles), GP19 (adversarial work as a first-class stage), GP26 (context-set
diversity), VP1–VP3 (surface-identical null and marker controls), VP5
(test-retest with step size), VP6 (no pooling), VP15 (adversarial positive
controls), and VP16 (content-tested blinding).

## Verification obligations

- [x] Every generator lands before hypothesis freeze, every refuter lands before
  verifier dispatch, and every pass lands before aggregation.
- [x] Pre-aggregation reads expose statuses and hashes, not private pass inputs
  or conclusions.
- [x] Challenge packets omit rationale, confidence, provider/model identity,
  pass identity, and prior verdicts; content canaries test renamed-field leaks.
- [x] A refuter cannot overturn using only the original packet; a defeated
  hypothesis requires newly discovered evidence reused by a verifier.
- [x] The aggregate retains defeated candidates, disagreements, raw judgments,
  and the evidence that changed status.
- [x] Same-context, varied-context, and heterogeneous-runtime manifests vary
  only the intended generator axis and retain fixed challenge replicates.
- [x] Clean, marker-only, treated, and null arms are paired, structurally
  checked from dispatched packets, run twice per cell, and reported separately.
- [x] Blind-truth and prior-verdict injections mark runs contaminated before
  provider judgment; contaminated runs are durably excluded from scoring.
