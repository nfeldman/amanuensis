# Concern Territories

Amanuensis's concern territory catalog. Use during onboarding Phase 4
("concern calibration") to derive the codebase-specific concern
checklist. Territories are expected to evolve — split, merge, refine,
or retire as survey experience accumulates.

---

## How to use this doc

For each territory below, the Amanuensis coordinator performs the
following steps during Phase 4 of onboarding:

1. **Applicability check.** Given the codebase's languages, runtime
   models, and concurrency substrates, does this territory obtain at all?
   If not, record the disqualifying condition and skip.
2. **Local instantiation.** For territories that apply, characterize how
   the defect class manifests in this specific substrate. Name the
   concrete patterns to look for.
3. **Derive falsifiable concerns.** Produce 1–4 concern entries per
   applicable territory, each a codebase-specific probe of the form:
   *"In this codebase, to test whether concern X obtains, I would
   examine Y at Z."*

A well-formed concern entry is codebase-specific, falsifiable by static
analysis, non-redundant, and scaled to the codebase's defect surface
area. A malformed entry is generic ("does this codebase have caching
bugs?") or requires runtime to falsify.

Add each derived concern via the MCP tool
`add_concern(code, category, origin="seeded", notes)`. Non-applicable
territories do not get a concern row — record the disqualifying
condition in the onboarding report's Concern Calibration section.

---

## Territory 1 — Scope-Context Identity Conflation

**Defect class.** An entity unique within one context is treated as
co-referential with an entity in a distinct context; or a value
computed against one scope is served in response to a query from a
disjoint scope.

**Prevalence.** High in systems with multiple access modes, versioned
data, tenant-scoped configuration, or request-history-dependent state.
Reproduction requires prior state, not only present inputs — making
these bugs particularly refractory to deterministic testing.

**Probes.**
- Cache, map, and identity-system keys: does each key include every
  field that discriminates the same entity across contexts? Audit for
  absent version, scope, tenant, or temporal discriminants.
- Signatures accepting "an ID": is that ID always unambiguously typed,
  or is it scope-polymorphic across call sites?
- Test coverage for same-datum, distinct-context scenarios — absence
  is itself a signal.
- In versioned systems: what happens when a cache entry for version N
  is served to a caller requesting version M?

**Shaping predicates.**
- Does this system maintain multiple access modes or versioned/scoped
  representations of the same datum?
- Are derived or computed values cached and keyed on entity identity
  alone?

## Territory 2 — Cache Coherence Failure

**Defect class.** A cache returns a stale value because the underlying
datum mutated and invalidation did not reach all relevant cache
entries.

**Three independent failure modes.**
1. *Invalidation absence* — mutation occurred; no invalidation signal
   was emitted.
2. *Invalidation underreach* — invalidation fired but covered only a
   proper subset of affected entries.
3. *TTL miscalibration* — TTL exceeds acceptable staleness for the use
   case; or no TTL exists and event-driven invalidation is relied upon
   exclusively but is incomplete.

**Probes.**
- Enumerate all caches (in-memory maps with lifetime, external cache
  entries, memoized results persisting across calls).
- For each: enumerate all mutation events on the underlying datum.
  Trace reachability to every cache holding derived values. Construct a
  coverage matrix: caches × mutation events → {invalidated, not
  invalidated, unknown}.
- Inspect `putIfAbsent`, `computeIfAbsent`, or in-flight deduplication
  patterns — these can silently suppress the second of two concurrent
  legitimate writes.

**Shaping predicates.**
- Are any caches intentionally staleness-tolerant? Document these
  explicitly to exclude them from defect classification.

## Territory 3 — Temporal Bound Violation

**Defect class.** A call that should complete within a bounded interval
can suspend indefinitely, holding a thread, connection, lock, or
document reference until process restart.

**Risk amplifiers.**
- Blocked call holds a resource with other waiters (thread pool slot,
  database connection, file handle, distributed lock).
- Blocked call site is an HTTP request handler or queue consumer —
  resource exhaustion cascades.
- No circuit breaker or supervisor preempts the suspended call.

**Probes.**
- Every exogenous call (remote service, database, cache, FFI boundary,
  subprocess): is a timeout configured?
- In systems with explicit futures/promises/coroutines: does every
  `.await`, `.get()`, `join`, `recv` have a cancellation or timeout path?
- Thread pool instantiation: per-call or singleton? Per-call creation
  is a resource-exhaustion pattern under load.
- Resource acquisition under the blocked call: what happens to held
  resources if the call never returns?

**Substrate-specific forms.**
- Java: `Future.get()` without timeout; blocking within
  try-with-resources holding a document reference.
- Rust: absent `tokio::time::timeout` on `.await`; blocking calls in
  async context.
- Go: channel receive without `select`/`default`; goroutine leak from
  abandoned work.
- Erlang/Elixir: `GenServer.call` without explicit timeout; mailbox
  overflow.
- COBOL or other batch: non-returning external calls — batch-design-
  dependent.

## Territory 4 — Exceptional Path Invariant Asymmetry

**Defect class.** The exceptional path fails to perform the same
cleanup, resource release, notification, or state reset as the
nominal path.

**Why underdetected.** Exceptional paths have lower test density than
nominal paths. Reviews tend toward nominal-path correctness.
Divergences accumulate silently across revisions.

**Probes.**
- Every `catch`, `rescue`, `recover`, error handler, or early return:
  does it release the same resources as the nominal exit?
- Locks, connections, refcounts, file handles, session state: released
  unconditionally (RAII, `defer`, `finally`, `with`) or conditionally
  on nominal exit only?
- Downstream notification: are downstream systems notified of failure
  with sufficient information to recover, or does the failure propagate
  silently?
- Retry precondition idempotency: after a failed attempt, is system
  state identical to pre-attempt state?

## Territory 5 — Aliasing and Ownership Violation

**Defect class.** Two loci share a reference to the same mutable
object; one mutates it; the other's invariants are silently violated.

**Substrate dependence is high.**
- Rust: borrow checker eliminates most statically; residual risk at
  `unsafe`, `Arc<Mutex<T>>` manual coordination, FFI crossings.
- Java/Kotlin: collection aliasing is endemic — a list returned from a
  service method may be the internal representation; caller mutation
  corrupts shared state.
- JavaScript/TypeScript: `{...obj}` is a shallow copy; nested
  mutations still alias.
- C/C++: pointer aliasing is pervasive; the concern is contract
  enforcement, not aliasing existence.
- ML/functional: largely absent; risk re-emerges at FFI boundaries or
  explicit mutable structures.

**Probes.**
- Objects returned from caches or service methods: do callers receive
  a reference to the cached object or a defensive copy?
- Exceptional-path fallback construction: are multiple error-result
  objects sharing a mutable container that is then independently
  mutated?
- Loop-local construction: does each iteration receive an independent
  copy of shared sub-objects?

## Territory 6 — Incremental/Full Path Divergence

**Defect class.** A system supports both full recomputation and
δ-update of derived state. The δ-update path fails to cover all
derived structures updated by the full path, leaving a proper subset
stale.

**Common substrates.**
- Compilers and interpreters with incremental AST re-evaluation.
- Build systems with incremental dependency tracking.
- View models or UI state updated on delta events.
- Lazily-rebuilt but incrementally-updated caches or index views.

**Probes.**
- Find all paths labeled "incremental," "delta," "partial update," or
  equivalent.
- Find the corresponding full path.
- Compare the sets of derived structures updated by each — co-extensive?
- Structures *marked* or *flagged* during full recomputation are prime
  candidates for update methods the δ-path omits.

## Territory 7 — Atomicity Violation

**Defect class.** A series of writes that must be atomic are not —
either because the transaction boundary excludes some writes, or
because the rollback mechanism does not cover all mutations within
the commit path.

**Scope is broader than databases.**
- Database transactions: boundary placement.
- Application-level journaling (undo systems, RAII rollback trees).
- Optimistic concurrency / conflict detection: late-detection behavior.
- Event publication: events published before commit allow consumers to
  read uncommitted state.

**Probes.**
- Multi-step mutation sites: for each, is there an atomicity mechanism,
  or can a failure after write N leave the system in a partial state?
- Event and notification dispatch: at what point in the transaction
  lifecycle does dispatch fire?
- Rollback verification: does rollback actually restore pre-transaction
  state, including all mutable sub-objects?

## Territory 8 — Concurrency Race Windows

**Defect class.** Two concurrent operations interleave such that each
produces a locally valid result, but the combined effect is incorrect.

**Probes.**
- Shared mutable state accessed without a lock, or with a lock
  released between a read and a dependent write (TOCTOU).
- Map/set updates from concurrent threads: `putIfAbsent` followed by a
  read is not a linearizable compound operation.
- Reference counting and lifecycle management: concurrent acquisition
  and release.
- Event deduplication: can two legitimate events for the same entity
  arrive concurrently with one silently suppressed?

**Non-applicability conditions.**
- Single-threaded environments (non-yielding event loop, GIL).
- Actor models with no shared mutable state.
- Pure functional systems.
If any of these obtain, document and skip — but verify rather than
assume.

## Territory 9 — Resource Lifecycle Asymmetry

**Defect class.** A resource is acquired but its release conditions
are not co-extensive with its acquisition conditions.

**Resource taxonomy.**
- File handles, sockets, database connections, HTTP connections.
- Distributed locks (advisory or mandatory).
- Thread-pool slots.
- Memory (in non-GC or GC-adjacent substrates: `Arc` refcounting).
- Application-level handles (document locks, session handles).

**Probes.**
- Every `open`, `acquire`, `lock`, `connect`, `new`: is there a
  guaranteed release path on exception, panic, cancellation, or
  context destruction?
- Long-running async operations holding a resource: behavior on
  mid-execution cancellation?
- Accumulation leaks: any path where release precondition is contingent
  on a future that can suspend indefinitely?

## Territory 10 — Trust Boundary Elision

**Defect class.** A value produced at one authority level is used at
a higher authority level without re-validation — implicit trust
inheritance across a privilege boundary.

**Manifestations.**
- Input validation at the perimeter only; downstream consumers assume
  sanitization has occurred.
- Service-to-service: service B assumes service A has validated; the
  assumption is implicit, not contractual.
- Privilege escalation: a lower-privileged principal supplies a value
  used in a privileged context without re-checking.
- Deserialized data from disk or queue: treated as trusted
  post-deserialization, even if written by an earlier or malformed
  version.

**Shaping predicates.**
- Where are the trust boundaries? (user browser, internal service,
  admin interface, background worker.)
- Is authentication enforced at the perimeter only, or at each
  individual service call?

## Territory 11 — Seam Contract Violations

**Defect class.** Two subsystems sharing a boundary each exhibit
correct intra-subsystem behavior, but their assumptions about the
other's behavioral contract are mutually incompatible. The defect
exists only in the composition — invisible to intra-subsystem survey.

**Common forms.** Each is the inter-system analog of an intra-system
defect class in the cited territory.
- *Staleness mismatch* (cf. T2): A writes assuming B re-fetches on every
  access; B caches after first read assuming A will push updates.
- *Ordering inversion* (cf. T7): A emits an event before state S is
  externally observable; B assumes S is observable on event receipt.
- *Cardinality conflict* (cf. T8): A assumes a single consumer drains
  a queue; B deploys multiple instances.
- *Schema divergence*: A serializes a field as optional; B treats
  absence as an error — or vice versa.
- *Lifecycle disagreement* (cf. T9): A assumes exclusive write authority
  over a shared resource during an operation; B has an independent
  write path to the same resource.
- *Authority confusion* (cf. T10): A validates at its entry boundary;
  B assumes re-validation has occurred upstream.

**Amanuensis-specific protocol.** Seams in Amanuensis are first-class
DB rows via the `seams` table; seam concerns are SC-N codes. Phase 2
of every subsystem survey fills in *this subsystem's* half of each
seam's behavioral contract. A seam becomes *assessable* only when both
parties reach `mapped` status — use `get_seam_assessability()` to
surface ready seams. SC-N dispositions are written by the adversarial
agent (or the coordinator's seam-assessment step), with the same
evidence cited on BOTH parties' disposition rows.

**Shaping predicates.**
- What is the seam surface area? (count of subsystems sharing mutable
  state with this one).
- Are there shared objects owned by a third subsystem on which
  multiple others depend? (that subsystem must be `mapped` before
  seam assessment).
- Are shared interfaces versioned independently? (schema divergence
  is the expected outcome.)

---

## When concerns compete — diagnosticity matrices

Standard territory-by-territory evaluation treats each concern as
independent. When two or more concerns share the same observable
symptom in the same subsystem, that assumption is violated, and
evaluating them independently risks confirming the wrong one.

**Trigger condition.** Two or more concerns could each independently
explain the same observable symptom (e.g., stale data attributable to
cache staleness, replication lag, or an atomicity violation; a missing
update attributable to a race window, an invalidation underreach, or
an incremental/full path divergence).

**Protocol.** Amanuensis concretizes Richards Heuer's Analysis of
Competing Hypotheses into the `diagnosticity_*` tables. When the
concerns agent encounters competing concerns, it returns to the
coordinator, which opens a matrix via
`open_diagnosticity_matrix(subsystem_id, symptom, shared_location,
concern_codes=[...], evidence_ids=[...])`.

1. *Enumerate competing concerns without pre-ranking.*
2. *List all relevant evidence.* Each evidence row is one matrix row.
3. *Evaluate evidence across columns, not down.* For each evidence row,
   ask: *which concerns does this evidence discriminate between?*
   Evidence consistent with all competing concerns has zero diagnostic
   value. Evidence consistent with only one concern has maximum
   diagnostic value. Record verdicts via
   `record_diagnosticity_verdict(matrix_id, concern_code, evidence_id,
   verdict)`. Verdict ∈ {consistent, contradicts, irrelevant, ambiguous}.
4. *Identify linchpin evidence.* Mark one or two pieces of evidence the
   leading hypothesis most depends on. If fragile (comment-asserted
   or name-inferred), record it in `linchpin_note` on the matrix.
5. *Rank by inconsistency, not support.* Reject the concern with the
   most contradicting evidence first. Do not accept the one with the
   most supporting evidence.
6. *Record the outcome.* `resolve_diagnosticity_matrix(matrix_id,
   outcome, leading_concern, linchpin_note)` with outcome
   ∈ {resolved, unresolved-competition}. If ambiguity remains, the
   matrix resolves as `unresolved-competition` with the matrix
   attached as rationale — this is a legitimate terminal state.

The materializer renders every matrix as a verdict-grid page under
`docs/diagnosticity/dm-<id>.md`, with a diagnostic-value column
summarizing each evidence row.

---

## Discovered concerns

Concerns not anticipated by the territory catalog that emerge during
survey work are added via `add_concern(origin="discovered")` with a
code like `OB-1` (observed during onboarding), `DC-1` (discovered
during concern pass), or a territory-style code for concerns that
are obvious refinements of a known territory.

Promoted concerns can later be re-categorized — `retire_concern` and
`add_concern` together let a discovered concern be renamed or merged
into an existing one.

---

## Calibration criteria

A well-calibrated checklist:

- Is codebase-specific. *"In this codebase, are MutexGuard-protected
  map mutations within the scheduler's per-job state ever performed
  under two different lock scopes?"* — not *"does the system have
  race conditions?"*.
- Is falsifiable by static analysis. If the only way to falsify is to
  run the code, it's a runtime concern, not a survey concern.
- Is non-redundant. Overlapping entries must be merged.
- Is scaled to the codebase. Entry count reflects defect surface area,
  not template geometry.
