# ADR-0002: Combine Git validity intervals with explicit supersession

- Status: accepted for A1
- Date: 2026-08-12
- Deciders: Amanuensis roadmap implementation; product-level authority remains with the user

## Context

A living conspectus must answer two different questions without rewriting
history:

1. What was authoritative for repository state X?
2. What changed a claim's meaning, why, and what replaced it?

The repository's commit graph is the behavioral timeline. Wall-clock dates and
SHA text are not order relations. Existing entries, dispositions, findings,
contradictions, and evidence must remain readable without a destructive
backfill that invents precision their schemas did not record.

## Decision

Use immutable, epistemically typed claim versions with:

- a stable `claim_key` naming the semantic slot and at most one open-ended
  version per key;
- `valid_from_sha` and exclusive `valid_until_sha` boundaries evaluated by Git
  ancestry;
- an explicit predecessor→successor edge for semantic lineage;
- append-only validity events carrying commit, evidence, session, and reason;
- an atomic supersession write that closes the predecessor and opens the
  successor at the same commit; and
- a read-only compatibility projection over legacy records.

`observation`, `inference`, `hypothesis`, `open-question`, `direct-intent`,
`inferred-intent`, and `decision` are distinct stored kinds. The write path
requires an active session, known Git commits, and structured evidence. A new
claim version cannot overwrite an old one.

## Options considered

### A. Commit intervals only

| Dimension | Assessment |
|---|---|
| Query at commit | Strong |
| Semantic lineage | Weak |
| Write complexity | Low |
| Audit explanation | Weak |

Intervals make temporal queries direct, but an end boundary cannot distinguish
invalidation, correction, refinement, or replacement. Reasons would drift into
free text and lineage reconstruction would become heuristic.

### B. Supersession edges only

| Dimension | Assessment |
|---|---|
| Query at commit | Weak |
| Semantic lineage | Strong |
| Write complexity | Medium |
| Audit explanation | Medium |

Edges preserve meaning changes, but answering authority at a repository state
requires replaying a graph and inferring timing. An invalidated claim with no
successor also fits poorly.

### C. Combined intervals, edges, and events

| Dimension | Assessment |
|---|---|
| Query at commit | Strong |
| Semantic lineage | Strong |
| Write complexity | High |
| Audit explanation | Strong |

The representations overlap, so correspondence must be enforced. Atomic tools,
unique-current indexes, immutable-version triggers, and supersession-integrity
triggers make disagreement a rejected transaction rather than repair work.

## Consequences

- Current authority and historical truth remain separate and queryable.
- Supersession is continuous: predecessor end and successor start share one
  commit boundary.
- Git ancestry checks make writes and as-of reads workspace-dependent; stored
  SHAs remain portable, but an unavailable commit is not silently accepted.
- Legacy rows are projected, not backfilled. Their missing temporal or
  epistemic precision remains visible as null or conservative typing.
- Claim reads initially perform ancestry filtering in application code. A2 may
  add cached reachability only after measured query pressure justifies it.
- Rollback ignores the additive tables and view. No old table or artifact must
  be down-migrated.

## Verification obligations

- [x] Reject missing evidence, unknown commits, invalid intervals, competing
  current versions, reused evidence on supersession, and cycles.
- [x] Exhaustively enumerate bounded interval/query positions.
- [x] Prove rejected transitions are transactional.
- [x] Compare the compatibility projection with seeded legacy objects.
- [x] Run schema, tool-contract, smoke, storage, and invariant suites.
