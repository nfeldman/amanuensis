# Phase 5 · Output packaging

Phase 5 of a per-subsystem survey runs in the **coordinator** — not as
a separate phase agent. By the time you're here, Phase 4 has returned
and you've advanced status to `adversarial`. This step finalizes the
subsystem's contribution to the conspectus, renders the navigable
docs, and emits the subsystem's end-of-survey summary.

Under autopilot this phase flows straight into the next subsystem's
Phase 1 if the master plan has more `unmapped` rows. No gate.

## Steps

### 1. Update `master-plan.md`

The subsystem's row:

- New status (`mapped` at the end of this phase).
- Findings counts (confirmed bugs, by severity).
- Post-survey priority — sometimes a subsystem reveals dependencies
  that re-rank what should come next. Update if needed.

### 2. Update `findings-index.md`

For each confirmed bug from this pass:

- Finding id, severity, primary file, one-line summary, link to
  the subsystem survey artifact's Adversarial Review section.
- Group by severity (CRITICAL first).

### 3. Update `entry-point.md`

This is the one-page navigator a future LLM reads cold. Touch
three sections:

- **Directory Map** — add this subsystem's primary path if it's
  newly load-bearing.
- **Confirmed Bugs** — add the new findings with a one-line
  summary each.
- **Minimal Read** — if this subsystem is now part of "the
  smallest set of files a new analyst should read to understand
  the system," add the load-bearing files. Don't bloat this
  section — it loses value as it grows.

### 4. Register and rehash every touched artifact

For each updated file:

```
register_artifact(path, kind="<one of: master-plan |
  findings-index | entry-point | subsystem-survey>",
  subsystem_id, ref_sha=<session sha>)
rehash_artifact(path, ref_sha=<session sha>)
```

This is what the materializer reads to decide whether to re-render
the page.

### 5. Materialize

```
materialize_docs()
```

The materializer is diff-aware — only pages whose DB or prose
sources changed get re-rendered. The cross-reference resolver
re-links every ID across pages. It then publishes synchronized HTML and
Markdown views and reads both back. Treat the returned `html_entrypoint` as
the primary human handoff; Markdown remains the portable audit companion.

### 6. Contradiction detection

For each finding in this pass:

- Call `get_findings(subsystem_id=...)` (and for adjacent
  subsystems, if the finding touches a shared file).
- For pre-existing findings citing the same `file:symbol@sha`
  where classifications are incompatible, call
  `add_contradiction(finding_a, finding_b, shared_location,
  conflict_type)`.

Do **not** silently resolve. An unresolved contradiction is the
single most important signal the conspectus produces — that's
where the methodology is keeping itself honest.

### 7. Seam assessability

```
get_seam_assessability()
```

Any seam whose status just flipped to `assessable=1` (both
parties `mapped`) is queued for seam assessment. See the
"Seam assessment" section of the main SKILL.md.

### 8. Close the session

```
end_session(outcome="completed")
```

### 9. Advance status

```
update_subsystem_status(id, status="mapped")
```

The DB enforces the knowledge-depth contract; if this raises
`ToolError`, a Phase 1-4 deliverable is missing. Investigate;
don't force.

### 10. Commit the final gate

```
commit_phase_gate(label="Phase 5 · <subsystem> · <findings count>
findings, <severity breakdown>")
```

The storage directory is a git repo. Phase commits are how the
methodology recovers from mid-session crashes.

## After packaging

Emit the survey-pass summary (status block, not a gate):

- Subsystem id, new status.
- Total dispositions, severity breakdown of findings.
- Contradictions detected and their state.
- Linchpin-dependent findings that remain.
- Field notes that came out of the pass.
- Open questions logged this pass (by category).
- Seams that became assessable as a result of this pass.
- The exact `html_entrypoint` returned by `materialize_docs`.

Then follow the inferred scope: for a repository-wide run, pick the next
highest-priority `unmapped` subsystem and continue until everything is
`mapped` or `deferred`; for a named subsystem, stop after its summary. Status
summaries are asynchronous and do not gate execution.
