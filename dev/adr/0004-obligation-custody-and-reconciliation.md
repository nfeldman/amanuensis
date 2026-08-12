# ADR-0004: Make revalidation a custody protocol, not a stale-work list

- Status: accepted for A3
- Date: 2026-08-12
- Deciders: Amanuensis roadmap implementation; product-level authority remains with the user

## Context

A2 can withdraw current authority and explain why. That is not a closed loop:
without a durable destination, an invalidated claim becomes another backlog row
that can be lost between sessions. Full automation also introduces failure
states absent from a manual survey: work can be dispatched but never land,
land twice, time out, exceed its budget, write outside its authority, or land
without being scored.

Counting completed workers is insufficient because retries make attempts and
obligations different units. Completion must reconcile the exact set of
expected obligations, not the number of successful calls.

## Decision

Use five append-preserving layers:

1. An applied change-impact invalidation creates one owned, blocking obligation
   through a database trigger. An idempotent historical sweep covers applied
   invalidations that predate the trigger.
2. A revalidation run snapshots source, provider, write-authority, concurrency,
   retry, token, and cost bounds, plus the exact expected obligation count.
3. Each run stores a source-filtered work packet before dispatch, including the
   invalidated claim, evidence, impact reason path, and impacted neighborhood.
4. Each dispatch has distinct run, obligation, attempt, replicate, and attempt
   number identities. Attempts and their plan are immutable; retries append.
5. Landing and scoring are distinct. Reconciliation requires exact fan-in,
   scored evidence-backed closure, and zero protocol violations.

Duplicate deliveries and scores are stored as violations before returning an
error. Budget or authority overrun results are also retained, but cannot be
accepted. Failed/timed-out work returns to `ready` only while retry capacity
remains; otherwise it enters `dead-letter` and keeps the run red.

## Consequences

- No applied invalidation can silently lack a destination.
- A protocol violation irreversibly fails that run. A later clean retry uses a
  new run; it cannot erase the incident.
- Throughput is not a completion metric. The realized obligation denominator is
  reported beside dispatched, landed, and scored attempts.
- `observe-only` runs cannot write artifacts. Write-capable modes require an
  explicit relative-prefix allowlist.
- Accepted closure requires new structured evidence. A revalidated claim must
  be current, occupy the invalidated claim key, and carry that evidence.
- Rollback disables automatic planning/dispatch while obligations remain
  blocking and queryable; existing attempt history is never deleted.

## Verification obligations

- [x] Verify future trigger custody and the historical sweep independently.
- [x] Inject dropped, duplicate, timed-out, and unscored arms with separate
  diagnostics and an exact fan-in denominator.
- [x] Prove retry identities append and cannot overwrite earlier attempts.
- [x] Exercise provider, source, concurrency, token, cost, and authority bounds.
- [x] Complete a timed-out-then-retried run with new evidence and read it back
  through the dashboard.
