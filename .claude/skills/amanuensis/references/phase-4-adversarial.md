# Phase 4 · Adversarial review

Phase 4 of a subsystem survey: **try to overturn each confirmed finding
and each linchpin-dependent disposition** from Phase 3. Findings that
survive this pass are the highest-confidence claims in the conspectus.

## Mindset

Phase 3 looked for evidence that concerns obtain. Your job is the
opposite — look for evidence they don't, or that a compensating
mechanism bounds the damage, or that the execution context makes the
concern inapplicable.

This is **not devil's-advocate theater.** You are looking for *actual*
mechanisms the Phase 3 read missed. A common LLM failure mode is
confirming bugs without checking for:

- Retry loops, supervisors, journaling, TTLs.
- Type-system guarantees (ownership, RAII, total functions).
- Single-caller invariants that bound the blast radius.
- Runtime substrates that make the bad interleaving impossible (a
  GIL, a single-threaded event loop, a transaction isolation level).
- Circuit breakers, rate limiters, idempotency keys.

Find those.

## Process

### 1. Pull the targets

- `get_findings(subsystem_id, status="confirmed-bug")` — every
  confirmed bug.
- `get_dispositions(subsystem_id)` filtered for
  `linchpin_dependent=true`.
- Any `confirmed-acceptable` disposition with only call-path
  context (Phase 3's rationale flags this).

### 2. For each target, formulate the disproof question

- What mechanism, if it exists, would overturn this?
- What language / runtime guarantee could make the concern
  inapplicable?
- What invariant at the call site might rule out the bad
  interleaving? *("I assumed this could be called concurrently. Is
  it always called under a lock I didn't read?")*
- Is the execution context modeled correctly? *("I assumed N is
  unbounded. Is it actually bounded by config?")*

### 3. Go look

Semantic tools to find call sites, implementations, type
constraints. Walk out from the finding's location in both
directions. Do not limit yourself to the ledger if the answer might
live outside — add files via `add_files_to_scope` with
`why_in_scope="adversarial probe for ${finding_id}"`.

### 4. Record explicit contradiction pairs

For each target, write in the subsystem survey artifact
(`<id>-<slug>.md`) under an "Adversarial review" section:

- **Claim A** — what Phase 3 concluded.
- **Claim B** — what you found (or failed to find).
- **Evidence for Claim B** — `file:symbol@sha` + what it shows.
- **Verdict** — one of:
  - `upheld` — Claim A survives; Claim B did not find an
    overturning mechanism.
  - `overturned` — Claim B produced evidence that invalidates
    Claim A.
  - `scope-restricted` — Claim A applies to a narrower scope than
    Phase 3 implied.
  - `quality-upgraded` — Claim A survives AND evidence quality can
    be raised (e.g., `comment-asserted` → `code-verified` because
    you confirmed by reading).
  - `quality-downgraded` — no stronger evidence found; the finding
    stays but its linchpin dependency is now documented
    explicitly.

### 5. Update the DB

For each verdict:

- **`overturned`** —
  `update_finding_status(finding_id, status="ruled-out")`, and
  `set_disposition` with `classification="ruled-out"` and evidence
  from Claim B. **Do not delete the finding** — the ruled-out
  record helps future analysts avoid re-treading the same ground.
- **`scope-restricted`** — update the finding's `business_context`
  to note the narrower scope, and add a field note describing
  which code paths are in vs. out of scope.
- **`quality-upgraded`** — `add_evidence` with the stronger
  `kind`, attach via `attach_evidence_to_disposition` with role
  `supports`, and consider `set_disposition` again with
  `linchpin_dependent=false`.
- **`quality-downgraded`** — keep `linchpin_dependent=true` and
  append the explicit gap to the disposition's `rationale`. A
  persistent linchpin dependency is fine — it just has to be
  visible.
- **`upheld`** — no DB change needed, but record the adversarial
  probe in
  `add_field_note(category="pattern", observation="adversarial
  probe for ${finding_id} did not find an overturning mechanism")`
  so the pattern of successful hardening is legible.

### 6. Contradiction detection across sessions

Before handing back, check for contradictions between your findings
and pre-existing findings (other subsystems, other sessions) that
cite the same `file:symbol@sha`:

- Query via `get_evidence(file_path=<path>)` and
  `get_finding_evidence` per finding.
- For any pair where classifications are logically incompatible
  (e.g., one says `confirmed-bug`, another `ruled-out`), call
  `add_contradiction(finding_a, finding_b, shared_location,
  conflict_type)`.
- Resolve via `resolve_contradiction` when you can determine which
  finding supersedes or whether they describe distinct scopes.

## Hand back

Return to the coordinator with a one-line summary:

- Counts per verdict (`upheld`, `overturned`, `scope-restricted`,
  `quality-upgraded`, `quality-downgraded`).
- Contradictions detected and their resolutions.
- Linchpin-dependent dispositions that remain — these are the
  legitimate ongoing fragility the materializer will surface.
- Open questions logged this phase.

The coordinator advances status to `adversarial` and runs Phase 5
packaging immediately. No pause.

## Rules

- **Overturning requires evidence, not vibes.** "Claim A might be
  wrong if there were a retry" is not a disproof. Find the retry,
  or admit it isn't there.
- **Be fair to Phase 3.** If you can't overturn, say so. Do not
  invent compensating mechanisms because it feels more balanced to
  overturn some of the findings.
- **`linchpin-dependent` is a valid steady state.** Not every
  finding can be upgraded to `code-verified`. Persistent fragility
  that is documented is better than false confidence.
- **Do not touch other subsystems' findings.** If your adversarial
  probe reveals a bug in subsystem B while you're on A, record a
  field note. Do not write findings outside your pass's
  subsystem.
