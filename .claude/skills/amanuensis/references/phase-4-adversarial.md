# Phase 4 · Adversarial review

Phase 4 of a subsystem survey: **try to overturn each confirmed finding
and each linchpin-dependent disposition** from Phase 3. Findings that
survive this pass are the highest-confidence claims in the conspectus.

## Mindset

Phase 3 looked for evidence that concerns obtain. Your job is the
opposite — look for evidence they don't, or that a compensating
mechanism bounds the damage, or that the execution context makes the
concern inapplicable.

Phase 2's structural claims are targets on the same terms. The status
gate that admitted the subsystem to `structural` establishes that those
claims exist and cite evidence; it establishes nothing about whether
they are true. This pass is where that is decided.

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
- Every **current claim whose `claim_key` begins `<sid>/`** — Phase
  2's structural inventory: key types, state containers, flow steps,
  the concurrency invariant, seam contracts, and any explicit negative
  claim. Call `get_claims(subsystem_id: "<sid>")`, which returns
  exactly those rows — the prefix is matched on the server, so a
  target cannot be lost to a filter you forgot to write. Every one of
  them is a target; none is exempt for being small.

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

For each **claim** target, write one entry under the same section,
keyed by `claim_key`:

- **Claim** — the `claim_key` and the statement as recorded.
- **Challenge** — what would have to be true for the claim to be
  wrong, and where you looked.
- **Outcome** — one of:
  - `survived` — you looked and found nothing that overturns it.
  - `overturned` — you found evidence the claim is wrong at the
    current revision.
  - `superseded` — the claim was right and is now stale; you have a
    corrected reading of the same fact.

### 5. Update the DB

For each verdict:

- **`overturned`** — first attach the disproving evidence
  (`add_evidence` for Claim B, then
  `attach_evidence_to_finding(..., role="compensating")`), *then*
  `update_finding_status(finding_id, status="ruled-out")` and
  `set_disposition` with `classification="ruled-out"`. The order
  matters: the server enforces evidence-required-to-overturn and
  rejects a flip to `ruled-out` with no new evidence attached this
  session. **Do not delete the finding** — the ruled-out record
  helps future analysts avoid re-treading the same ground.
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

And for each claim outcome:

- **`overturned`** — `add_evidence` for the disproof, then
  `invalidate_claim(claim_id, at_sha, reason, evidence_ids)`. That
  writes the `invalidated` row in `claim_validity_events`, which is
  the durable record that the claim was challenged and lost. The
  server rejects an invalidation whose evidence is already attached
  to the claim, so the disproof has to be new.
- **`superseded`** — `supersede_claim`, which closes the predecessor
  and opens the successor on the same `claim_key` in one commit and
  writes the `superseded` event. Use this, not delete-and-re-add: the
  history is the point.
- **`survived`** — no claim row changes, so the outcome has to be
  recorded explicitly or it is indistinguishable from a claim nobody
  looked at. Write
  `add_field_note(category="pattern", observation="adversarial probe
  for claim ${claim_key} did not overturn it", location=<sid>)`
  alongside the artifact entry.

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
- Counts per claim outcome (`survived`, `overturned`, `superseded`),
  and the `claim_key` of any target you did not reach.
- Contradictions detected and their resolutions.
- Linchpin-dependent dispositions that remain — these are the
  legitimate ongoing fragility the materializer will surface.
- Open questions logged this phase.

The coordinator advances status to `adversarial` and runs Phase 5
packaging immediately. No pause.

**Before the subsystem may advance to `mapped`, every current `<sid>/`
claim must carry a recorded outcome** — a `claim_validity_event` from
`invalidate_claim` or `supersede_claim`, or an explicit `survived`
note. A claim with no recorded outcome means the structural account
was published unchallenged; say so in the hand-back rather than
letting `mapped` imply a review that did not happen. The server refuses
the advance in those terms: *"current claim(s) carry no challenge
outcome"*.

`mapped` additionally refuses an unreconciled store. *"the store has not
been reconciled against the repository at"* the revision being claimed is
the sentence, and the repair is `detect_changes(current_sha=<HEAD>)`
followed by assigning or exempting every unledgered path it reports. A
subsystem cannot be mapped while the store cannot say what the tree
contains.

It refuses on Phase 3's evidence too. Any disposition *"answered from
nothing"* blocks the advance, and *"set_disposition requires at least one
evidence_id"* is where that begins: record the reading with `add_evidence`
and pass its id, or attach it with `attach_evidence_to_disposition`.

## Rules

- **Overturning requires evidence, not vibes.** "Claim A might be
  wrong if there were a retry" is not a disproof. Find the retry,
  or admit it isn't there.
- **Be fair to Phase 3.** If you can't overturn, say so. Do not
  invent compensating mechanisms because it feels more balanced to
  overturn some of the findings. The same holds for claims: a
  `survived` outcome on every claim is a legitimate result, and
  inventing one overturn to look rigorous corrupts the record.
- **`linchpin-dependent` is a valid steady state.** Not every
  finding can be upgraded to `code-verified`. Persistent fragility
  that is documented is better than false confidence.
- **Do not touch other subsystems' findings.** If your adversarial
  probe reveals a bug in subsystem B while you're on A, record a
  field note. Do not write findings outside your pass's
  subsystem.
