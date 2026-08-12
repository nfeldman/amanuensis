# ADR-0014: Admit external research only through a decision-bound queue

- Status: accepted for A13
- Date: 2026-08-12
- Deciders: Amanuensis owns admission and code-evidence custody; Scholiast owns external-source custody

## Context

Amanuensis can expose gaps and A12 decisions can name uncertain premises, but
unbounded topic generation would turn every interesting question into backlog.
The opposite failure is more subtle: imported research can sound authoritative
enough to overwrite what the repository demonstrably does. A useful broker must
therefore answer two different questions without conflating them: whether a
question is worth sending outside the codebase, and what authority the returned
testimony has after it comes back.

Scholiast already defines the external boundary: durable per-question custody,
source classes and their limitations, held excerpts, access status, confidence
degradation across unread hops, and claim maps that keep contested evidence
open. Amanuensis needs to preserve that boundary while attaching the result to
the exact codebase decision field it can inform.

## Decision

### Admission is explicit, inspectable, and non-destructive

Every proposal becomes an immutable `ResearchRequest 1.0.0` record, including
rejections and deferrals. An admitted request must name a real decision revision
and field, current local evidence, the remaining uncertainty, needed external
source classes, disconfirmers, a bounded source/time budget, and an exhausted
local search with an unresolved reason.

Expected information value is deliberately a small transparent instrument:
`decision sensitivity × uncertainty reducibility`, each scored 1–5, with an
admission threshold of 9. This is not treated as an empirically calibrated
probability or quality signal. It exposes the two judgments for later
evaluation. Questions below the threshold or with incomplete local search are
deferred and nonblocking by default. Missing decision destinations and exact
duplicates are rejected. A duplicate may re-enter only by naming a premise ID
that exists in the decision revision and has changed.

The durable states are `rejected`, `deferred`, `admitted`, `dispatched`,
`landed`, `consumed`, and `expired`. SQLite requires append-only transition
events and the corresponding dispatch, result, or consumption custody object.
Terminal rows cannot disappear, so M10 retains its denominator.

### Dispatch transfers a bounded question, not authority

Only admitted work can produce a Scholiast handoff. The handoff requires an
existing, non-temporary `scholiast/<slug>` workspace and carries the question,
why it matters, established and ruled-out ground, output shape, source-quality
guidance, held evidence, access-status rule, disconfirmers, budget, and decision
destination. A temporary directory or transcript is not research custody.

Landing re-reads every named artifact from that workspace and records its path,
size, and SHA-256. Sources remain append-only with locator, source class, access
status, held excerpt when directly read, and limitation. External claims keep
classification, confidence, source IDs, chain degradation, and a destination.
That destination must exactly match the request's named decision field; a
result cannot redirect itself to make its consumption look useful.

### External claims and code observations remain different kinds

Imported claims live in `research_external_claims`, never in the repository
`claims` table. A result may target a hypothesis, option, premise, or confidence
reason. It cannot target `code-observation`. When external testimony conflicts
with a current evidence-backed code observation, the adapter writes an open
`research_code_contradictions` row and preserves both sides.

Consumption must either name the exact result claim, effect kind, target field,
and effect statement, or record a reason for no change. It records a candidate
change in the decision-support record; it does not edit an immutable accepted
decision. Applying a premise change requires the normal A12 successor-revision
and acceptance path.

## Options considered

- **Dispatch every generated topic:** rejected because volume is not decision
  yield and creates a backlog with no destination.
- **Use one opaque research-worthiness score:** rejected because it hides the
  value judgment and invites false calibration. The two scored judgments and
  fixed threshold remain readable and revisable.
- **Require all deferred work to block:** rejected because external latency can
  freeze decisions that should proceed under explicit uncertainty. Blocking is
  an explicit property, never inferred from curiosity.
- **Import external findings into temporal code claims:** rejected because a
  source about standards or common practice cannot establish repository
  behavior. Contradiction is retained instead of resolved by type coercion.
- **Mutate a decision premise on consumption:** rejected because research
  synthesis is not acceptance authority. Consumption can motivate a successor
  revision but cannot rewrite history.

## Consequences

- Amanuensis can automate question generation and ingestion without becoming a
  generic research feed or second source of truth for code.
- Rejected, deferred, expired, and no-change work remains visible for backlog
  and decision-yield measurement.
- Scholiast handoffs are heavier than a plain prompt because custody and access
  status cross the boundary explicitly.
- The information-value threshold is a provisional operating rule. A14/A15 may
  revise it only from measured yield and backlog behavior, not intuition.
- A consumed premise effect still needs an A12 decision revision before it can
  become accepted policy.

## Practice basis

Practice catalog v2.8: GP9 (preserve contradiction), GP11 (source/access
custody), GP12 (separate epistemic kinds), GP20 (every gap has a destination),
GP23 (deferral remains tracked), and GP29 (consumption can record the named
field measured by research decision yield). Scholiast supplies the durable
workspace, source limitation, held-evidence, and chain-degradation contract.

## Verification obligations

- [x] Curiosity without a decision destination is durably rejected and cannot block.
- [x] Incomplete local search and low expected value defer rather than dispatch.
- [x] Exact duplicates link prior work; the escape names an existing changed premise.
- [x] Dispatch rejects temporary custody and emits the complete Scholiast brief.
- [x] Landed artifacts are re-read and hashed from the dispatched workspace.
- [x] Source access status, excerpts, limitations, and chain degradation survive read-back.
- [x] A well-cited external/code contradiction preserves both claims and remains open.
- [x] Consumed work names its changed field or records why nothing changed.
- [x] Direct state writes cannot bypass transition events and custody objects.
