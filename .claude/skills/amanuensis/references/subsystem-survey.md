# Per-subsystem survey (coordinator's view)

This is the coordinator's loop for "survey [subsystem_id]". The five
phases each have their own reference; this file ties them together
and covers resume logic and Phase 5 packaging.

The loop runs **autonomously** — phases flow into each other without
human gating. Anything ambiguous goes into `record_open_question` (see
`open-questions.md`) and execution continues with the best-available
assumption. Status block at each phase transition; full summary at
Phase 5.

## Resume logic (before any handoff)

1. Call `get_subsystem_files(subsystem_id)`. If empty and
   `status="unmapped"`, start at Phase 1.
2. Otherwise look at the current status via `list_subsystems` (which
   carries the most recent `update_subsystem_status` value). Resume
   from whichever phase comes next:
   - `unmapped` → Phase 1 (scope)
   - `scoping` (approved) → Phase 2 (structural)
   - `structural` (approved) → Phase 3 (concerns)
   - `concerns` (approved) → Phase 4 (adversarial)
   - `adversarial` (approved) → Phase 5 (packaging, you run this)

## Session setup

1. Call `start_session(intent="survey ${subsystem_id}")`. Remember the
   `session_id`.
2. Capture the survey-session SHA: `git rev-parse HEAD` on the
   canonical branch. Use this SHA for every `ref_sha` in this
   session.
3. Before each phase handoff:
   `acquire_lock(artifact_path="<id>-<slug>.md", holder_id=session_id)`.
   Release after the phase completes.

## Running a phase

Prefer dispatching the phase as a Task-tool subagent so its reading
context is isolated. Give it:

- The phase's reference file (e.g. `references/phase-1-scope.md`).
- The subsystem id and session id.
- The survey-session SHA.
- A reminder to write everything through the MCP tools — never to the
  workspace source.

Run inline only if subagents are unavailable.

After the phase returns:

1. Call `update_subsystem_status(id, status=<phase_name>)`. The DB
   enforces the knowledge-depth contract; a premature status update
   raises a `ToolError`. **If that fires**, the phase didn't produce
   what the next phase needs. Diagnose the missing deliverable, re-run the
   phase once with that deficiency explicit, and if it remains blocked mark
   the subsystem `deferred` with the gap as its reason.
2. Emit a one-line status block (counts, new findings,
   contradictions, field notes, open questions added).
3. Run the next phase immediately. No pause.

## Phase 5 · Output packaging (you run this directly)

Phase 4 returns, status advances to `adversarial`, and you continue
straight into Phase 5:

1. **Update `master-plan.md`** — the subsystem's row (status,
   findings counts, ranked priority post-survey).
2. **Update `findings-index.md`** — add any confirmed bugs from this
   pass. Include severity, primary file, one-line summary, finding
   id.
3. **Update `entry-point.md`** — Directory Map row for this
   subsystem if it newly appears; Confirmed Bugs section; Minimal
   Read section if this subsystem is now load-bearing for understanding
   the system.
4. **Register and rehash every touched artifact**:
   `register_artifact(path, kind, ...)` then `rehash_artifact(path,
   ref_sha=session_sha)`.
5. **Materialize**: `materialize_docs()`.
6. **Contradiction detection.** For each finding in this pass, check
   `get_findings(subsystem_id=...)` for pre-existing findings citing
   the same file:symbol. On any incompatible classification, call
   `add_contradiction(finding_a, finding_b, shared_location,
   conflict_type)`. Do not resolve silently.
7. **Seam assessability check.** Call `get_seam_assessability()`.
   Any seam whose status just flipped to `assessable` is queued for
   seam assessment (see the main SKILL.md "Seam assessment" section).
8. **Close the session.** Call `end_session(outcome="completed")`.
9. **Advance status.** Call
   `update_subsystem_status(id, status="mapped")`.

## When a phase can't produce what the next one needs

If a phase's output is too thin for the next phase (incomplete file
ledger, missing structural sections, no examined files, etc.), the
DB will refuse the status advance with `ToolError`. Emit a one-line diagnosis,
re-run the phase once with a tighter brief, and then either advance or mark the
subsystem `deferred` with the exact gap before moving to the next independent
unit.

If the gap is judgment-shaped rather than coverage-shaped (e.g. you
can't tell what the right scope of file F is), prefer
`record_open_question` and proceed with a working assumption rather
than pausing.

Deferred subsystems carry their reason; they don't degrade the
checklist.

## End-of-survey summary

After Phase 5 packaging, before moving on, emit:

- Subsystem id, new status (`mapped` or `deferred`).
- Dispositions: counts per classification.
- Findings: count, severity breakdown, linchpin-dependent count.
- Contradictions detected this pass.
- Open questions added this pass (by category).
- Seams that became `assessable` as a result.
- Next subsystem in priority order (if continuing under autopilot).

Then continue without asking whether to continue inside the inferred scope.
