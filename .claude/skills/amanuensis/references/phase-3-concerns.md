# Phase 3 · Concern-driven deep read

Phase 3 of a subsystem survey: **apply the calibrated concern checklist
to the structural map** Phase 2 produced. Every concern reaches a
terminal state — `confirmed-bug` | `confirmed-acceptable` | `ruled-out`
| `out-of-scope` | `unresolved-competition` — with evidence, an
evidence-quality tag, a linchpin flag, and a one-sentence rationale.

## Inputs

- Call `list_concerns(status_filter="active")` — this is your
  checklist.
- Call
  `get_subsystem_files(subsystem_id, classification_filter="examined")`
  for the structural-inventoried files.
- Read the subsystem survey artifact (`<id>-<slug>.md`) for the
  structural map. **If it's missing or incomplete, stop and return to
  the coordinator** — concern work on a partial structural summary is
  the largest source of false confidence in the methodology.

## For each concern

Work them one by one.

### 1. State what would confirm or rule it out here

Be specific: *"To confirm/disconfirm <concern> in this subsystem, I
would examine <symbol> in <file> for <specific condition>."* Vague
intentions produce vague findings.

### 2. Find the relevant code

Semantic tools first (find-references, call-hierarchy,
find-implementations). Grep last.

### 3. Read to sufficient depth

Sufficient = **you could defend the classification under
adversarial questioning.** If you are not sure, it is not sufficient
yet.

### 4. Record evidence first

Call
`add_evidence(file_path, symbol, line_range, ref_sha, kind, excerpt?, note?)`.

`kind` ladder (use the strongest the evidence actually supports —
overstating quality is the #1 way the methodology fails):

- `code-verified` — you read the lines; the code does what you
  claim.
- `contract-stated` — interface or type contract states this
  explicitly.
- `test-observed` — a test exercises this behavior.
- `config-asserted` — a config file states the value.
- `doc-asserted` — documentation states this.
- `comment-asserted` — a comment claims this; the code was not
  re-verified.
- `name-inferred` — the name suggests this; no code or contract
  confirms.
- `pattern-matched` — this matches a pattern seen elsewhere.

### 5. Write the disposition

`set_disposition`:

- `classification` ∈ `{confirmed-bug, confirmed-acceptable,
  ruled-out, out-of-scope, unresolved-competition}`.
- `evidence` — `file:symbol@sha` (legacy free-text field; still
  useful for at-a-glance inspection).
- `evidence_quality` — matches the strongest evidence row attached.
- `linchpin_dependent` — `true` if the classification hinges on
  `comment-asserted` / `name-inferred` / `pattern-matched`
  evidence, OR if you only have call-path context (no historical /
  domain / scope).
- `rationale` — one sentence.
- `pass_type="survey"`.

Then attach each evidence row:
`attach_evidence_to_disposition(subsystem_id, concern_code,
evidence_id, role)`. Role ∈ `{supports, contradicts, linchpin,
compensating}`.

### 6. Context frame for confirmed bugs and confirmed-acceptable

Before a classification counts as *thick*, you need all four
dimensions:

- **Call-path context** — every known path to this code, not just
  the primary caller.
- **Historical context** — why the code looks this way (deliberate
  design, accretion, tech debt, migration artifact).
- **Domain context** — the domain rule that makes this (un)acceptable.
- **Scope context** — whether the concern applies on one call path
  or to all consumers.

Thin findings (only call-path context) **must** set
`linchpin_dependent=true` and explicitly flag the missing dimensions
in the rationale so Phase 4 tries to fill them.

### 7. Competing concerns

If two or more concerns could independently explain the same
symptom in this subsystem, do **not** write individual dispositions
yet. Return to the coordinator and request a diagnosticity matrix.
The coordinator calls `open_diagnosticity_matrix(...)`; you then
record each cell's verdict via `record_diagnosticity_verdict(...)`.
Only after the matrix resolves do you write dispositions.

### 8. Seam concerns

If a concern path crosses a seam into another subsystem, stop at
the boundary. Record a `field_note(category="candidate-concern",
location=<seam id>)` describing what would need to be evaluated
once the counterpart is `mapped`. Do not enter unmapped territory.

### 9. New vocabulary

Anything you learn in the course of concern work — call it out with
`define_term`.

## Produce findings for confirmed bugs

For each `confirmed-bug` disposition, also call:

```
add_finding(
  finding_id, subsystem_id, symptom, root_cause, severity,
  status="confirmed-bug", primary_files, business_context, ref_sha,
  pass_type="survey"
)
```

`finding_id` convention: `<subsystem-id-compact>-<N>` (e.g.
`B01-1`).

`severity`:

- `CRITICAL` — data loss, security, production availability.
- `HIGH` — user-visible incorrect behavior in common paths.
- `MEDIUM` — user-visible incorrect behavior in uncommon paths, or
  degrading performance under load.
- `LOW` — latent or cosmetic; incorrect behavior under conditions
  that don't occur in practice today.

Attach the same evidence rows via
`attach_evidence_to_finding(finding_id, evidence_id, role)`. Role
∈ `{symptom, root-cause, fix-anchor, compensating}`.

## Hand back

Return to the coordinator with a one-line summary:

- Dispositions: counts per classification.
- Findings: count, severity breakdown, linchpin-dependent count.
- Diagnosticity matrices opened (if any) and outcomes.
- Field notes added.
- Open questions logged this phase.
- Concerns with evidence only at `comment-asserted` /
  `name-inferred` / `pattern-matched` quality — Phase 4 will try
  hardest to upgrade or overturn these.

The coordinator advances to `concerns` status and starts adversarial
review immediately. No pause.

When a concern's classification hinges on a domain rule you can't
verify (e.g. "this is acceptable iff tenant IDs are globally
unique"), prefer
`record_open_question(category="domain-knowledge", what_assumed=...)`
plus your best-read disposition over halting.

## Rules

- **Every concern gets a terminal state.** Nothing lingers at
  "suspected" or "unknown."
- **No confirmation from naming alone.** Read the code.
- **Look for compensating mechanisms.** If you notice one, that's
  evidence the concern is ruled out — record it. If you suspect one
  but can't find it, flag `linchpin_dependent=true` and let Phase 4
  hunt.
- **Thin findings must self-declare.** A finding with only
  call-path context is not thick. Mark it.
- **Phase 3 does not run adversarial review on its own findings.**
  That's Phase 4's job. Do not pre-empt.
