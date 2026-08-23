# How to read this conspectus

An Amanuensis conspectus is a **persistent, evidence-driven
architectural record** of a codebase. This site is the human-facing
view; behind it sits a SQLite database every claim on the site was
generated from. Every assertion carries provenance: who said it, when,
against what commit, with what evidence, at what depth of survey.

This page is shipped automatically with every conspectus. Read it
once; you won't need to read it again.

## What to look at first

| If you're here because… | Start here |
|---|---|
| You've never seen this project before | [`entry-point.md`](entry-point.md) → [`master-plan.md`](master-plan.md) |
| You're investigating a specific bug | [`findings.md`](findings.md), filtered by severity |
| You want to understand the architecture | [`architecture.md`](architecture.md), then a subsystem page |
| You're evaluating how trustworthy this is | [`open-questions.md`](open-questions.md), [`contradictions.md`](contradictions.md), [`diagnosticity.md`](diagnosticity.md) |
| You want to reproduce or extend the survey | `provenance.md` (if present) + the repo's git log |

## Reading the status badges

Every subsystem carries a **status** that defines what claims about
it you should accept. This is the knowledge-depth contract — the
methodology's most important epistemic guardrail.

| Status | What claims are authorized |
|---|---|
| `unmapped` | **None.** No assertions about behavior. |
| `scoping` | File scope only: "F is in scope for S." No behavioral claims. |
| `structural` | Types, state containers, data flows, concurrency model. **No correctness claims.** |
| `concerns` | Concern review with evidence. Findings at evidence_quality ≥ code-verified. |
| `adversarial` | As above, plus findings survived attempted refutation. **Highest confidence.** |
| `mapped` | Complete. Seam contracts filled in. Ready for composition with mapped peers. |
| `deferred` | Orthogonal flag: "do not survey yet." Not a knowledge level. |

If you see a confident-sounding claim about a subsystem that is still
`structural`, that's a methodology violation — treat the claim as
speculation. The server enforces this at write time, but readers are
the final check.

## Reading evidence quality

Every disposition and every finding carries an `evidence_quality`
tag that describes how solid the underlying observation is. Higher
quality supports stronger claims.

| Quality | What it means |
|---|---|
| `code-verified` | The reviewer read the code and confirmed the behavior. Strongest. |
| `contract-stated` | An explicit contract (type signature, schema, docstring with semantics) asserts the behavior. |
| `comment-asserted` | A code comment claims the behavior, but the code was not verified against the claim. |
| `name-inferred` | Inferred from a symbol's name (e.g. `sanitizeInput` must sanitize). Weak; needs adversarial review. |
| `pattern-matched` | Fits a pattern we've seen elsewhere. Weakest; used only as a scoping signal. |

Any finding classified `confirmed-bug` should rest on
`code-verified` or `contract-stated` evidence. If you see a
confirmed-bug with `name-inferred` evidence that survived adversarial
review, that's a flag to look closely — either the adversarial pass
was inadequate or the reviewer genuinely had no better evidence and
flagged the finding as linchpin-dependent.

## Reading finding severity

Severity reflects impact, not confidence.

| Severity | Typical shape |
|---|---|
| `CRITICAL` | Data loss, security hole, privilege escalation, production outage path. |
| `HIGH` | Incorrect behavior on a common code path; corrupt state; wedged queues. |
| `MEDIUM` | Incorrect behavior on an edge case; correctness issue with a known workaround. |
| `LOW` | Readability/maintainability; defensive-coding gaps; would bite a future change. |

## Reading finding status

After adversarial review, each finding carries one of:

| Status | What it means |
|---|---|
| `confirmed-bug` | The bug is real at the surveyed commit, survived refutation. |
| `confirmed-acceptable` | The behavior exists but is the intended design — documented as such. |
| `ruled-out` | Claim was made but adversarial review overturned it. Record preserved so future analysts don't re-tread the same ground. |
| `fixed` | Confirmed at the surveyed commit; a later commit has addressed it. |

Note that `ruled-out` findings stay in the record. That's a feature,
not dead wood — if somebody reads a later version of the code and
starts to form the same suspicion, the overturn argument is already
written down.

## Reading open questions

If the conspectus was produced by the autoprogress coordinator
(cloud mode), [`open-questions.md`](open-questions.md) is the queue
of things the agent could not answer without human input. Each entry
records:

- the **question** (what the agent couldn't decide)
- **what it blocked** (the classification or decision that was held up)
- **what the agent assumed** (the best-available interpretation it
  proceeded with)

A small open-question queue, mostly in the `priority-ranking` or
`scope-judgment` categories, means the run was confident. A large
queue weighted toward `domain-knowledge` or `contradiction` means
the survey is walking on thin ice — treat its findings with more
skepticism and plan a focused human pass on those subsystems.

## Reading contradictions

[`contradictions.md`](contradictions.md) pairs findings that make
incompatible claims about the same `file:symbol@sha`. The conspectus
preserves these rather than smoothing them away; an unresolved
contradiction is the most honest thing a survey can say about a
genuinely ambiguous situation.

Resolutions:

- `a-supersedes-b` / `b-supersedes-a` — one claim is now considered
  correct; the other stays on record for traceability.
- `scope-distinction` — both claims are right, about different
  scopes (different inputs, different code paths). The `scope_note`
  explains.
- `unresolved` — the evidence genuinely does not disambiguate.

If you see `unresolved`, that's the survey telling you: "two
credible readings, no way to choose between them yet." That is
information.

## Reading diagnosticity matrices

When two or more concerns could independently explain the same
observable symptom in a subsystem, the coordinator opens a matrix
(the Analysis of Competing Hypotheses pattern). The matrix's columns
are the competing concerns; its rows are pieces of evidence; each
cell records whether that evidence is `consistent`, `contradicts`,
`irrelevant`, or `ambiguous` for that concern.

The methodology ranks concerns by **inconsistency** — the one with
the most contradicting evidence is rejected first — rather than by
supporting evidence, because an evidence base consistent with all
competing explanations tells you nothing. The `leading_concern` on
a resolved matrix is the surviving best explanation; the
`linchpin_note` identifies the single piece of evidence the
resolution most depends on (and therefore the one a reviewer should
re-verify first).

Matrices that resolve to `unresolved-competition` are analogous to
unresolved contradictions: a legitimate terminal state when the
evidence does not disambiguate.

## Provenance

If the conspectus ships with a `provenance.md`
page, that is the chronological event log: sessions in order,
findings within sessions in order, with commit SHAs and timestamps.
It's the evidence that the survey was run in the order it claims —
not retroactively curated.

Combined with the git log of the conspectus repo itself (every
phase gate is a commit; every commit is timestamped), provenance is
the strongest claim the methodology can make about its own honesty.

## Reproducing what you're reading

Anyone with:

- the surveyed codebase's commit SHA (the `ref_sha` on findings and
  evidence),
- the Amanuensis version that ran the survey (captured in commit
  messages on the conspectus repo), and
- sufficient API budget to drive an LLM through the same phases

…can replay the survey and see whether their conclusions overlap
with these. Non-determinism in the LLM means the two runs won't be
identical; structural overlap is the expected property, and the
[`compare_conspectuses`](https://github.com/search?q=compare_conspectuses)
tool in the Amanuensis server measures it.

## If something here looks wrong

Say so. The conspectus treats reader-surfaced disagreement as a
first-class signal: a reviewer who disagrees with a finding should
open an issue against this conspectus repo; the next survey session
records the disagreement as a field note or converts it into a
diagnosticity matrix if the reviewer's argument looks credible
enough to compete with the existing finding.

A methodology that refuses to hear its readers is one that should
not be trusted.
