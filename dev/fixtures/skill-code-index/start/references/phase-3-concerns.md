# Phase 3 · Concern-driven deep read

Phase 3 of a subsystem survey: **apply the calibrated concern checklist
to the structural map** Phase 2 produced. Every concern reaches a
terminal state — `confirmed-bug` | `confirmed-acceptable` | `ruled-out`
| `out-of-scope` | `unresolved-competition` — with evidence, an
evidence-quality tag, a linchpin flag, and a one-sentence rationale.

The coordinator has already advanced this subsystem to `concerns`;
`set_disposition` and `add_finding` are refused below it.

## Inputs

- Call `list_concerns(status_filter="active")` — this is your
  checklist.
- Call
  `get_subsystem_files(subsystem_id, classification_filter="examined")`
  for the structural-inventoried files.
- Call `get_narratives(subject_type="subsystem", subject_id,
  section="structure")` for the structural map, and `get_claims` for the
  inventory. A store imported from files may hold its structural map as an
  imported survey body instead: when no structure narrative is in force, call
  `get_imported_artifacts(kind="subsystem-survey", subsystem_id,
  include_body=true)`
  and read the body no withdrawal has retired. It is written as it was, not tied
  to evidence, so check what it says against the code before relying on it.
  **If there is no structure narrative, no declination and no unwithdrawn
  imported survey body, stop and return to the coordinator** — concern work on
  a partial structural map is the largest source of false confidence in the
  methodology.

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

The citation is checked against the file at `ref_sha`, and a call that fails is
refused. The path must exist at that revision, and `line_range` (`N`, `N-M` or
a comma-separated list) must lie inside the file. `excerpt` must appear in those
lines: quote the source as it is at that revision. Whitespace is ignored, so
code can be reflowed onto one line, and `...` marks an elision. A paraphrase or
HTML-escaped text is refused.

In a language the code index parses, `symbol` must name a definition at
`ref_sha`: a `symbol_id`, a qualified name, or a bare name naming one
definition. `read_symbol` returns these location fields as `evidence_args`;
add `kind`. The row stores the canonical `symbol_id` and is anchored to the
definition, and an omitted `line_range` is filled with the definition's
citeable span. The rules and their refusals are in
[`code-index.md`](code-index.md#citing-a-definition-with-add_evidence):

- `add_evidence refuses: <symbol> names no definition in <path>`: the refusal
  lists the nearest `symbol_id`s. Pass one of them, or omit symbol: a
  free-text label belongs in note.
- `<symbol> names <count> definitions … and line_range does not fall within exactly
  one of them`: give a `line_range` inside the one to cite.
- `line_range … reaches outside <symbol_id>`: cite lines inside the
  definition, or omit symbol to cite lines no definition holds.
- `the excerpt is not inside <symbol_id>`: quote that definition's own text;
  text from a neighbouring definition, even on the same line, is not part of it.

Without a `symbol`, in another language, or with `AMANUENSIS_CODE_INDEX=off`,
the row is written as before, with no anchor.

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

Record the readings first with `add_evidence`, then pass their ids:
*"set_disposition requires at least one evidence_id"* — a disposition is
how a concern was answered, and an answer nobody can open is not a
disposition. The rows are attached inside the same write, not as a later
step.

`set_disposition`:

- `evidence_ids` — the recorded evidence rows this disposition rests on.
  At least one, and every one's revision must resolve in the workspace.
- `classification` ∈ `{confirmed-bug, confirmed-acceptable,
  ruled-out, out-of-scope, unresolved-competition}`.
- `evidence` — `file:symbol@sha` (legacy free-text field; still
  useful for at-a-glance inspection).
- `evidence_quality` — no stronger than the strongest attached row's
  kind. The server refuses a quality the attached evidence does not
  support.
- `linchpin_dependent` — `true` if the classification hinges on
  `comment-asserted` / `name-inferred` / `pattern-matched`
  evidence, OR if you only have call-path context (no historical /
  domain / scope).
- `rationale` — one sentence.
- `pass_type="survey"`.

`attach_evidence_to_disposition(subsystem_id, concern_code,
evidence_id, role)` attaches further rows afterwards. Role ∈
`{supports, contradicts, linchpin, compensating}`.

The advance out of this phase reads what you attached. Leaving the
subsystem at `concerns`, `adversarial` or `mapped` is refused while any
disposition was *"answered from nothing"*, and refused again when one
rests on a commit the workspace can no longer reach — *"an unreachable
anchor cannot be verified in place"*. Re-read at a reachable commit and
attach the new evidence.

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
the boundary. Record an `add_field_note(category="candidate-concern",
location=<seam id>)` describing what would need to be evaluated
once the counterpart is `mapped`. Do not enter unmapped territory.

### 9. New vocabulary

Anything you learn in the course of concern work — call it out with
`define_term`. Anchor it at the commit you read it at: `first_seen` is a
`file:symbol@sha` anchor whose revision must resolve and whose path must
exist in that revision's tree, or the call is refused.

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

## Record the reasoning

A disposition's rationale is one sentence. Reasoning that did not fit it is
recorded as a narrative:

```
record_narrative(subject_type="subsystem", subject_id,
  section="concern-reasoning", topic, body, evidence_ids,
  ref_sha=<session sha>)
```

The topic names what the reasoning is about, such as a concern code or a
seam. The body says how the concern was framed, which compensating
mechanisms were considered, and why each evidence quality was chosen. It is
prose and lists with no heading or table line, and at least one of
`evidence_ids` is a row for a file in the subsystem's ledger. Below `concerns`
it is refused: *"a concern-reasoning narrative is written once a subsystem has
reached 'concerns'"*. Where the dispositions say all there is to say, record
nothing.

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

The coordinator advances to `adversarial` and starts adversarial
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
