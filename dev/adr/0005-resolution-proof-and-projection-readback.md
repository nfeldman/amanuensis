# ADR-0005: Separate repair intent, verified resolution, and projection proof

- Status: accepted for A4
- Date: 2026-08-12
- Deciders: Amanuensis roadmap implementation; product-level authority remains with the user

## Context

The inherited model allowed `findings.status='fixed'` with only an optional
location. That made repair less demanding than refutation: ruling a finding out
required new evidence, while declaring it fixed required none. The materializer
had the analogous problem. Its manifest tracked renderer inputs and pre-xref
content, but no process read the finished files back and compared them with the
database state a reader was meant to see.

Both are projection/authority confusions. A location is evidence of repair
intent, not evidence that repaired behavior holds. A successful write is
evidence that a generator ran, not evidence that the published projection
corresponds to durable truth.

## Decision

### Resolution authority

Keep the legacy mutable finding status as a coarse compatibility projection and
put authority in append-only `finding_resolution_events`:

1. `fixed` requires a resolvable repair SHA and location and creates only
   `fixed-pending-verification`.
2. `verify_finding_fix` requires structured evidence attached as
   `fix-verification`, collected in the active session, at the repair commit or
   one of its descendants.
3. Verification appends `verified-fixed`; reopening or a later repair appends
   another event without erasing the earlier proof.
4. Existing fixed labels are swept once into pending events with an explicit
   legacy-unverified rationale. No confirming evidence is invented.
5. Contradiction resolution also requires current-session structured evidence.
   That evidence must be attached to one of the contradictory findings.
   Database triggers enforce attachment for both verified fixes and resolved
   contradictions beneath the tool layer. Claims and revalidation obligations
   retain their existing evidence gates. `audit_resolution_invariants` reports
   violations across all four domains and never repairs them.

### Projection proof

After xref resolution, the materializer writes a publication receipt and reads
the output back on three non-interchangeable axes:

- **State:** DB-derived finding and stale-entry identities have exactly one
  opaque marker in the finished Markdown.
- **Coverage:** the current page plan is complete, and every local cross-link
  recorded at publication remains present and resolves inside the projection.
- **Content:** page bytes match post-xref hashes in the publication receipt.

`--clean-publish` renders into an isolated sibling directory, performs all
three checks, and promotes it only when they are green. A red staging run leaves
the prior projection untouched. `verify_materialized_docs` checks an existing
projection without rendering. MCP calls append a verification run and its
mismatches to the database; they do not change findings, entries, claims, or
other durable source state. A later clean publish repairs the projection from
that source state.

## Alternatives rejected

- **Add more fields to `findings`:** this would still overwrite history and
  require rebuilding the existing SQLite check-constrained table.
- **Treat a fix location or passing status as verification:** neither proves
  behavior at or after the repair commit.
- **Reuse the incremental manifest as the oracle:** it hashes renderer output
  before global cross-reference rewriting and therefore does not represent the
  bytes readers receive.
- **Make read-back auto-correct the database:** this reverses authority and can
  turn a corrupt derived artifact into durable “truth.”
- **One aggregate projection checksum:** it detects drift but cannot identify
  whether state, coverage, or byte correspondence failed.

## Consequences and limits

- Callers that previously marked a finding fixed with no repair SHA now receive
  a hard error and must make the repair boundary explicit.
- A verified finding can later reopen without losing its historical proof.
- Clean publication refuses to replace a non-empty directory that lacks an
  Amanuensis manifest, preventing accidental custody of unrelated files.
- State markers are opaque hashes so the cross-reference resolver cannot edit
  them accidentally.
- Content read-back proves byte correspondence with the publication receipt;
  it does not prove that the source claim or renderer semantics are correct.
  Semantic review remains a separate validation obligation (GP28).
- Link expectations are receipt-backed, so this gate detects post-render loss
  and broken targets. It does not by itself prove the generator discovered
  every semantically desirable link.

## Verification obligations

- [x] A fix-location-only transition is rejected.
- [x] Pre-repair evidence cannot create `verified-fixed`; evidence at or after
  the repair can.
- [x] Reopen and claim-supersession histories retain earlier fixed/invalidated
  proof.
- [x] Direct database insertion of a verified state without evidence fails.
- [x] Legacy fixed rows import as pending without invented proof.
- [x] Removing a finding, cross-link, or stale marker turns the corresponding
  read-back axis red.
- [x] A red read-back is recorded, does not mutate durable truth, and cannot
  publish; a later clean render repairs from source truth.
