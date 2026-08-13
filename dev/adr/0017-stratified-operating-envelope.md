# ADR-0017: Derive a narrow operating envelope without pooling repository strata

- Status: accepted for A16
- Date: 2026-08-12
- Deciders: Amanuensis owns evaluation custody and derived product claims; repository/runtime evidence owns observed outcomes

## Context

A working self-survey demonstrates that Amanuensis can run. It does not establish
that the same workflow improves review or design outcomes across languages,
repository shapes, modes, context sets, models, or runtimes. A pooled benchmark
would be especially misleading: a large positive result in one repository can
conceal a weak result in another, and a metric pinned at its floor or ceiling can
look like evidence of no effect when the instrument had no ability to resolve one.

The evaluation apparatus is itself fallible. A negative observation is not a
product result until input delivery, baseline production, determinism, and
headroom are checked. A positive observation is not an efficacy claim until
null, stronger-control, ablation, test-retest, and two-sided sensitivity arms
behave coherently and an independent alternative-explanation pass survives.

## Decision

### Freeze a manifest before collecting results

`plan_evaluation_program` accepts at least two repository strata and freezes:

- repository type, languages, scale, shape, inclusion reason, exclusion criteria,
  and seeded or known outcomes;
- change class, review mode, context condition, model family, and runtime;
- metric definitions, direction, integer minimum detectable effect, step size,
  and per-metric stopping rule;
- exactly one baseline, surface-identical null, stronger control, treatment,
  ablation, test-retest, sensitivity-add, and sensitivity-remove condition; and
- at least two substrate-generated replicates per condition.

The null declares its comparison with baseline and the surface dimensions it
holds fixed: shape, length distribution, identifiers, and cross-references. The
manifest also names unsupported languages, scales, repository shapes, and
decision classes. These declarations bound the eventual claim; they do not
make the synthetic fixture representative.

Replicate and case identifiers are generated from the program, stratum,
condition, and replicate ordinal. SQLite makes replicate IDs globally unique.
The report's optional assignment list is validation-only and rejects duplicate,
missing, or extra values rather than authoring the program after results exist.

### Clear the instrument before interpreting an observation

`land_evaluation_result` requires the exact preregistered metric set. Each metric
contains its own numerator, denominator, retained exclusion count, and a value
recomputed by the server. Excluded observations remain separately readable and
must appear in every metric's exclusion count.

The result also records the expected and observed input hash, baseline read-back,
assigned condition and observed manipulation, determinism setting and observed
operation change, and metric floor, ceiling, and baseline. Delivery failure or
an inert determinism control blocks interpretation. Insufficient headroom yields
`undetermined-no-headroom`, never a null or unsupported product verdict.

If agreement is reported, raw agreement, chance agreement, and chance-corrected
agreement must arrive together and reconcile arithmetically. A zero-count rubric
category requires a recorded operational frame and positive exposure count before
absence can be attributed to the evaluated system.

### Derive each claim within one stratum

Publication requires exact fan-in across every planned case. The server derives
condition means and the primary treatment effect separately for each repository ×
mode × context × model/runtime stratum. The control ordering respects the metric's
declared direction. Test-retest variation is reported beside the metric step and
MDE.

A supported verdict requires a valid instrument for every replicate, effect at
least the preregistered MDE, coherent graded controls and two-sided sensitivity,
stable test-retest behavior, and a survived alternative-explanation review for
every treatment replicate. A valid instrument below those conditions is
`unsupported`; any instrument failure makes the stratum
`undetermined-instrument`.

The report has no pooled efficacy field. Callers must provide exactly one claim
per stratum, and each supplied verdict must equal the server-derived verdict.
The operating envelope is therefore the set of supported, unsupported, and
instrument-undetermined strata plus the manifest's explicitly unsupported
conditions—not a general score.

### Re-derive the published report at the consumer boundary

The manifest, cases, results, alternative reviews, report, and verification
records are append-only. `verify_operating_envelope` regenerates the report from
durable inputs and records independent state, coverage, and semantic-content
axes. A caller-supplied report exists only for fault injection; it cannot rewrite
the stored report.

## Options considered

- **Publish one aggregate efficacy score:** rejected because heterogeneous
  repository and runtime effects would be invisible.
- **Treat a failed or flat observation as a product null:** rejected because
  delivery, determinism, and headroom failures are properties of the instrument.
- **Use a single negative control:** rejected because an insensitive evaluator
  would then look precise; the stronger control, ablation, and sensitivity arms
  measure the other half of the instrument.
- **Let the result producer declare pass:** rejected because verdicts, agreement,
  control ordering, exclusion custody, and report counts are derived.
- **Claim a representative benchmark from checked-in fixtures:** rejected. The
  fixtures prove the custody and red-gate apparatus, not real-world efficacy.

## Consequences

- The first checked-in envelope is deliberately narrow and synthetic. It
  demonstrates one supported stratum, one valid but below-MDE stratum, and one
  no-headroom stratum; it authorizes no population claim.
- Adding a repository, metric, condition, or replicate increases exact fan-in and
  cannot be hidden by an aggregate.
- A real evaluation is more expensive because controls and repeat runs are
  mandatory. That cost buys interpretability rather than a guaranteed positive.
- Runtime/model changes define new strata. They cannot silently extend an old
  operating envelope.

## Practice basis

Practice catalog v2.8: GP2–GP5 (independent, blinded, heterogeneous work before
mechanical aggregation), GP17 and GP19 (domain calibration and adversarial
alternatives), GP29–GP34 (metric reachability, rater-specific resolving power,
specific attribution, exclusion scope, substrate replicate identity, and unused
rubric framing), and VP1–VP10 plus VP13–VP18 (surface-identical nulls, red-capable
gates, repeatability, non-pooling, graded controls, ablation, baseline clearance,
agreement components, headroom, instrument-first negatives, content blinding,
MDEs, and live determinism). The fixture validates these structural obligations;
it does not measure population accuracy.

## Verification obligations

- [x] Three repositories cover distinct types, scales, shapes, modes, contexts, models, and runtimes.
- [x] All eight condition roles and two generated replicates per role produce exact fan-out and fan-in.
- [x] A malformed surface null turns the planning gate red.
- [x] Every metric preserves its own exclusion count and exact numerator/denominator arithmetic.
- [x] Agreement cannot be stored without raw, chance, and reconciled chance-corrected values.
- [x] A zero-count rubric category without operational exposure turns red.
- [x] Reused replicate identifiers and incomplete fan-in turn publication red.
- [x] A pooled positive and a positive override of a weak subgroup both turn publication red.
- [x] No-headroom observations remain distinct from valid unsupported results.
- [x] Positive support requires survived alternative-explanation review.
- [x] State, coverage, and content report read-back can independently turn red.
