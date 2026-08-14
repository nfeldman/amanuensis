# ADR-0019: Separate public evaluation mechanics from private historical truth

- Status: accepted for A18
- Date: 2026-08-14
- Deciders: Amanuensis owns transport and qualification; the evaluation corpus owns hidden tasks and oracles; repository behavior owns historical truth

## Context

A16 can preregister conditions, retain results, and derive a non-pooled operating
envelope, but its checked-in fixture is synthetic. It proves result custody, not
that Amanuensis or any construction discipline improves work on real code.

Repository histories furnish stronger natural cases: a pre-repair snapshot, a
later repair, and executable regression evidence. They also create a serious
leakage path. A normal checkout exposes later commits, messages, reviews,
writebacks, and often the exact regression test. Giving those materials to a
treatment agent would turn the experiment into answer retrieval. Checking exact
private defects into this public repository would create the same problem and
would violate the custody boundary for other projects' implementation details.

## Decision

### Split protocol custody from evaluator truth

Amanuensis publishes the versioned corpus schema and the deterministic
`amanuensis-evaluate-history` runner. A private evaluator repository stores exact
repository roots, target and repair commits, participant tasks, evaluator-owned
patches, canaries, and qualification receipts.

The split is functional, not security by obscurity. The public side makes every
gate inspectable. The private side withholds only case-specific future state and
the oracle from treatment agents. A manifest path and its referenced task and
patch must remain within one evaluator custody directory; only the source
repository root may be external.

### Qualify every case before it can consume a treatment run

Qualification resolves full 40-character target and fix commits exactly and
requires the fix to descend from the target. Each commit is exported with
`git archive` into a temporary tree. Git metadata never enters that tree.

The runner scans the participant task and exported trees for the fix commit,
case-specific evaluator names, and random canaries. It applies the hidden patch
only inside evaluator scratch space, then runs a shell-free command vector with
a bounded timeout. A case qualifies only when the oracle fails at the target and
passes at the fix. One exact fan-in receipt binds manifest, task, oracle, command,
runner, contract, source-tree, output, and outcome digests for every selected case.

### Keep treatment preparation and scoring asymmetric

`prepare` exports only the target tree and a fixed `AMANUENSIS_TASK.md`; it
rejects non-empty destinations and scans the completed packet. `score` scans the
treatment workspace, copies it to evaluator scratch space, applies the hidden
oracle to the copy, and returns an outcome receipt. It neither mutates the
participant result nor reveals the oracle output.

The runner is deliberately model-agnostic. Assignment, counterbalancing,
blinded human scoring, minimum detectable effects, and publication remain A16
program concerns. A qualified case is an instrument component, not an efficacy
result.

## Options considered

- **Give agents detached Git worktrees:** rejected because detached worktrees
  still expose repository history and later commits through `.git`.
- **Use the later regression test directly:** rejected because it may be
  present at the fix and its name or surrounding commit can leak the answer.
  Evaluator-owned equivalent tests are applied to both snapshots instead.
- **Store exact cases in the public Amanuensis fixture:** rejected because the
  public contract does not need other projects' copyable implementation truth.
- **Treat reports, commit messages, or nightly distillation as truth:** rejected.
  They are candidate-discovery and provenance sources; executable repository
  behavior owns admission.
- **Claim efficacy after two passing cases:** rejected. Two cases demonstrate
  corpus transport and oracle sensitivity only.

## Consequences

- Real cases can be replayed without granting treatment agents future history.
- Private corpus loss remains a material risk, so its branch and receipts must
  be committed durably in the research repository.
- Evaluator patches require maintenance if old snapshots become unbuildable on
  available toolchains; such failure is an instrument failure, not a product
  result.
- Absolute local repository paths remain allowed because they are operational
  configuration, not evaluator truth.
- The first private tranche contains one Rust workspace case and one TypeScript
  repository-tooling case. It authorizes no population or product claim.

## Practice basis

Practice catalog v2.8: GP1 (verify before use), GP3–GP4 (blind challenge and
independent aggregation), GP21–GP22 and GP24 (integral scope, seam controls, exact
fan-in), VP1–VP6 (nulls, red gates, retest, no pooling), VP9–VP10 (ablation and
baseline), VP12 and VP16–VP17 (operational rubric, content blinding, MDE), VP19
(clean export), VP21–VP23 (diagnostic coverage and manipulation checks), and VP25
(independent evidence after repaired gates).

## Verification obligations

- [x] The synthetic fixture fails its hidden test at target and passes at fix.
- [x] The participant packet contains no `.git` history or hidden test.
- [x] A leaked canary turns preparation/scoring red before the oracle runs.
- [x] Equal target and fix commits are rejected.
- [x] Scoring applies the hidden patch to a copy, not the participant workspace.
- [x] Two private historical cases fail at their exact targets and pass at their known repairs in one qualification run.
- [x] The receipt retains per-case outcomes and digests without pooling them into an efficacy score.
