# Onboarding (8 phases)

Run this when the project's `db_exists` is false or the user explicitly says
"run onboarding". Unlike per-subsystem surveys, **the coordinator executes
onboarding directly** — there is no per-phase agent for this pass. The
phase agents (scoper, structural, concerns, adversarial) are for
per-subsystem surveys, not the first-pass repo walk.

The eight phases below run **continuously** under autopilot. You do not pause
between phases. Anything you can't decide cleanly gets logged via
`record_open_question(category, question, what_assumed, ...)` and you keep
moving. The full open-question queue is surfaced at the end of Phase 7 for
the human to work through asynchronously. See `open-questions.md` for the
categories.

If the human picked **orderly batches** (option B) at the up-front gate,
treat onboarding Phases 1–7 as the first batch and only stop after
Phase 7's checkpoint. Subsequent subsystem surveys are separate batches.

## Setup

1. Call `start_session(intent="onboarding")`. Remember the `session_id`.
2. Capture the canonical-branch HEAD SHA: `git rev-parse HEAD`. This is
   the onboarding SHA — every `ref_sha` for evidence collected in this
   pass uses it.

## Phase 0 · Orientation

- Confirm you can read the workspace; list top-level contents.
- Read `references/concern-territories.md` (the territory catalog used
  in Phase 4) and `references/artifact-templates.md` (output formats).
- Enumerate available language-intelligence tools (call hierarchy, find
  references, go-to-definition). Note results — they shape all later
  navigation. If only grep is available, say so: it changes how Phase 2
  reads.

## Phase 1 · Repository shape

Explore top-level. Identify languages, build systems, code generation,
module structure, version control. Produce the **directory cluster
table** (one row per significant directory: apparent role, language,
confidence, notes). Continue to Phase 2.

## Phase 2 · Runtime boundary map

Processes, services, IPC mechanisms, external dependencies. Produce the
**runtime boundary table** (one row per process / service: language,
peers, mechanism). Continue to Phase 3.

## Phase 3 · Stateful entity identification

Caches, locks, persistent state, cross-request state, concurrency
primitives. Produce the **stateful-entity table** (name, location, what
it stores, lifetime, populated by, invalidated by). Continue to Phase 4.

## Phase 4 · Concern calibration

This is the territory pass. For each territory in
`references/concern-territories.md`:

- **Applicability check.** Does it apply to this codebase's languages,
  runtimes, and concurrency model?
- **If yes**: derive 1–4 codebase-specific concern entries via
  `add_concern(code, category, origin="seeded", notes)`. Codes should
  be short ids (e.g. `CC-1`, `RC-2`) so they survive in dispositions
  later.
- **If no**: record the disqualifying condition in the onboarding
  report's Concern Calibration section. Do **not** silently skip.

A well-formed concern is codebase-specific, falsifiable by static
analysis, non-redundant, and scaled to defect surface area. A malformed
concern is generic ("does this codebase have caching bugs?") or
requires runtime to falsify.

The checklist drives every subsystem's Phase 3, so calibration quality
matters. If a territory's applicability is genuinely uncertain — the
codebase has hybrid semantics, or you can't tell whether a substrate is
in use without runtime evidence — record an
`open_question(category="ambiguous-evidence")` and proceed with your
best read. Continue to Phase 5.

## Phase 5 · Draft master plan

Enumerate subsystems. For each, call
`upsert_subsystem(id, name, status="unmapped", layer, scope,
jump_in_reading, notes, priority)`.

**Rank every subsystem by survey priority** (1 = survey first). Base
the ranking on signal strength:

- High defect surface area (concurrency, caches, seams) → higher
  priority.
- Subsystems other systems depend on structurally → higher.
- Subsystems where the concern checklist points to unresolved risk →
  higher.
- Pure ornamentation, demonstrably-trivial wrappers → lower.

Ties are fine. Use dense ranks (1, 2, 2, 3) rather than sparse
(1, 3, 3, 5) unless spacing carries information. Two subsystems at
priority 2 means "both equally important next after #1."

Group by layer in the master-plan artifact, then order within each
layer by priority. If two subsystems are genuinely tied and the
tiebreaker matters,
`record_open_question(category="priority-ranking")` and proceed with
the tiebreaker you picked. Continue to Phase 6.

## Phase 6 · Questions for the human (logged, not blocking)

Under autopilot this phase **does not gate**. The three tiers below
become `open_question` rows the human resolves asynchronously:

- **Tier 1 — Blockers.** Without an answer, certain subsystem areas
  cannot be reliably mapped (e.g. "what are the tenancy semantics
  here?"). Log as `category="domain-knowledge"` or `"scope-judgment"`.
  Always populate `what_assumed` — your best read becomes the working
  assumption until the human contradicts it.
- **Tier 2 — Priority shapers.** Answers would re-rank subsystems by
  risk. Log as `category="priority-ranking"`.
- **Tier 3 — Context.** Answers would reduce false positives on
  surprising patterns. Log as `category="ambiguous-evidence"` or
  `"other"`.

Proceed to Phase 7 with the working assumptions in place. The human
will see the queue at the Phase 7 checkpoint.

## Phase 7 · Produce the conspectus

- Call `set_git_state(canonical_branch, onboarding_sha=HEAD,
  last_checked_sha=HEAD, branch_convention, detected_branches)`.
- Write the prose artifacts to the project storage directory using the
  templates in `references/artifact-templates.md`:
  - `onboarding-report.md`
  - `concern-checklist.md` — the calibrated checklist; this supersedes
    the territory catalog for future sessions.
  - `master-plan.md`
  - `findings-index.md` — empty to start.
  - `entry-point.md` — must pass the acceptance gate: a new LLM
    reading only this file must answer "what does this system do? what
    do I map first? given a bug report, what do I read first? given a
    feature request, what mode applies?"
  - `field-notes.md` — seeded with onboarding observations.
- For each artifact, call `register_artifact(path, kind, ...)` then
  `rehash_artifact(path, ref_sha=onboarding_sha)` so the materializer
  sees the content.
- Call `materialize_docs()` to render the navigable human docs.
- Call `end_session(outcome="completed")`.

Commit at every phase boundary. Storage is a git repo;
`commit_phase_gate(label="Onboarding Phase N · <name>")` covers it.

## Phase 7 checkpoint summary

Once `materialize_docs()` returns, emit a one-screen summary:

- Subsystem count by layer, top-ranked priorities.
- Concerns derived (count by territory applicability vs. disqualified).
- Open-question queue (count by category, with a one-line preview of
  the highest-impact entries).
- Path to the rendered `docs/` and to the prose artifacts.

Then **continue to the next scheduled work** based on the up-front
gate:

- Autopilot (A) → start surveying the highest-priority `unmapped`
  subsystem.
- Orderly batches (B) → checkpoint here; ask the human whether to
  continue with the first survey batch or adjust scope.
- Single subsystem (C) with onboarding completed → survey that
  subsystem.

No additional gate between onboarding completion and the next survey
unless option B was chosen.
