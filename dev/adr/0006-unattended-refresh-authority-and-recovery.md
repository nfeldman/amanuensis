# ADR-0006: Make unattended refresh a durable, bounded coordinator

- Status: accepted for A5
- Date: 2026-08-12
- Deciders: Amanuensis roadmap implementation; product decisions and irreversible external actions remain human-authorized

## Context

A1 through A4 supplied temporal claims, explainable impact, revalidation
custody, evidence-gated resolution, and projection read-back. They did not make
their composition safe to run unattended. A process could still crash after a
child operation landed but before its parent recorded success, a provider could
be named without an enforceable data boundary, and a worker success signal
could be mistaken for authoritative completion.

Those are coordinator failures, not prompting failures. Retrying a prose
instruction cannot distinguish work that never started from work that landed
immediately before a crash. Likewise, asking a worker to stay in scope does not
make the provider, read set, write set, budget, or external side-effect boundary
auditable.

## Decision

### Immutable execution envelope

`plan_refresh_run` creates one immutable manifest and hash before execution. It
pins:

- base and head commits, allowed source prefixes, and relation-discovery mode;
- run and replicate identities plus deterministic child-run identities;
- provider allowlist, selected provider, model, runtime, determinism mode, and
  the exact runtime input;
- per-attempt and aggregate token/cost bounds;
- authority mode, write prefixes, side effects, and the projection output; and
- automatic-dispatch and concurrency limits.

The database rejects later mutation of those fields. The target head must be
the checked-out `HEAD`, because the final materializer proves the checked-out
tree. A different target, a selected provider outside the allowlist, an output
outside project storage, insufficient conspectus-write authority, mismatched
branch-write authority, or an irreversible effect such as deploy, merge,
external messaging, or decision acceptance produces a durable `blocked` plan
before impact analysis or dispatch. Configured analysis calls inside the envelope carry
`preauthorized-envelope`; product decisions remain `human-only`.

Provider execution is an outbox boundary. The coordinator durably dispatches a
fully identified attempt and exposes its runtime route and input to the worker
adapter. `land_refresh_result`, `fail_refresh_result`, and
`score_refresh_result` bring the outcome back under A3 custody. Landing records
consulted source paths, written artifacts, tokens, and cost. Read, write,
authority, or budget violations remain queryable and cannot be accepted.

### Crash adoption and exact completion

Every mutating stage has a deterministic identity:

- impact: `<refresh>:impact`;
- revalidation: `<refresh>:revalidation`;
- attempt: `<refresh>:attempt:<ordinal>:<attempt-number>`; and
- final projection proof: `projection:<refresh>:final`.

`execute_refresh_run` and `resume_refresh_run` query durable child state before
acting. If a child exists, resume adopts it and records that fact; if it does
not, resume creates it. Stage events have idempotency keys and are append-only.
Cancellation preserves attempts, returns unfinished obligations to an honest
state where allowed, and never manufactures resolution.

Completion is computed only after:

1. the predicted impact has been durably applied;
2. every resulting obligation has exact A3 fan-in with landed, scored,
   evidence-gated closure and no protocol violation; and
3. a clean A4 materialization has passed state, coverage, and content read-back
   under its deterministic projection ID, bound to the planned head and output
   directory.

A worker message, a non-empty result set, or a successful materializer process
is insufficient. Zero-impact refreshes skip provider work but still require the
final durable read-back.

### Determinism is a routed control, not a promise

`provider-default`, `seeded`, and `local-deterministic` produce distinct
runtime routes. Seeded mode pins and exposes the seed; local-deterministic mode
requires a local runtime. This proves the control reached the provider adapter.
It does not claim that a hosted model is bit-for-bit deterministic.

## Alternatives rejected

- **Retry the whole refresh with random identifiers:** duplicates claims and
  obligations when an earlier side effect landed before the crash.
- **Trust worker completion callbacks:** callbacks report transport state, not
  exact reconciliation or authoritative resolution.
- **Keep authority in agent instructions:** this provides no durable proof of
  the provider, sources, writes, costs, or side effects actually used.
- **Let read-back repair source truth:** this reverses the A4 authority
  direction and can make a corrupt projection authoritative.
- **Call providers inside the SQLite transaction:** external calls cannot share
  SQLite atomicity and would hold locks across unbounded network latency. The
  durable outbox/landing boundary makes the unavoidable split explicit.
- **Treat an unchanged diff as automatic success:** it avoids revalidation but
  fails to prove that the final projection still corresponds to durable truth.

## Consequences and limits

- An unattended refresh is now resumable at each mutating boundary and retains
  enough state to explain whether work was created, adopted, blocked, landed,
  scored, cancelled, or read back.
- The provider adapter can consume preauthorized work without another approval
  prompt, but only for the provider and side effects pinned in the manifest.
- Final output is constrained to the project storage root. Provider artifacts
  remain constrained separately by A3 write prefixes.
- Existing A3 databases receive the additive `consulted_sources` column before
  canonical schema initialization; prior durable rows are retained.
- The coordinator validates custody and correspondence, not the semantic
  quality of a provider's conclusion. A6 and later validation slices measure
  whether the assembled context and recommendations are actually useful.
- Provider-default and seeded routes can still vary across calls. Run and
  replicate IDs preserve that variation for later evaluation rather than
  hiding it.

## Practice basis

Practice catalog v2.8: GP8 (validate structure before execution), GP10
(decompose before synthesis), GP16 (bounded automation), GP24 (historical
sweeps and migration), GP25 (read-back), GP33 (replicate identity), VP11
(provider/runtime controls), VP18 (fault injection), and VP20 (independent
correspondence verification).

## Verification obligations

- [x] Crashes after impact prediction, impact application, revalidation
  planning, dispatch, and projection read-back resume without duplicate child
  custody.
- [x] A crash after A3 dispatch but before refresh-outbox recording adopts the
  attempt exactly once and does not infer completion.
- [x] Seeded and provider-default modes produce distinct observed runtime
  inputs; the seed is present only on the seeded route.
- [x] Out-of-envelope providers, irreversible effects, manifest mutation, and
  projection paths outside storage halt in the substrate; a non-HEAD target is
  blocked before impact.
- [x] A deterministic projection-proof ID is idempotent for the same proof and
  cannot be rebound to a different output mode or source state.
- [x] Consulted-source boundary violations land as telemetry and cannot be
  accepted as resolution.
- [x] A zero-impact run creates no obligations or provider work and completes
  only after projection read-back.
- [x] A crash after green read-back resumes from one durable projection proof
  and reaches completion from reconciliation plus read-back.
- [x] Existing databases gain consulted-source custody without losing prior
  claims.
