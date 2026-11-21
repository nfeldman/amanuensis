# Memory audit (hygiene sweep)

When the human says "audit", "memory audit", or "what's stale", run
this sweep. Your output is a **prioritized worklist**, not new findings.
The worklist is the deliverable here; when the human wants it worked rather
than listed, that is `references/refresh.md`.

Unlike the phase work, you do not read source code here. You read the
DB and the conspectus itself.

## Sweep order

Run these in order; **stop any category that has nothing interesting**
so the final report stays short. A short report is a healthy report.

### 1. Unresolved contradictions

```
get_contradictions(resolution_filter="unresolved")
```

Any row here is by definition a priority — two findings about the same
code disagree, and nobody has reconciled them. For each:

- Pull the two findings for context: `get_findings(subsystem_id=...)` on
  each one's subsystem, and `get_finding_evidence(finding_id)` for what
  each cites.
- Check whether the finding sessions are weeks apart (stale) or
  recent.
- Surface the pair with a one-sentence recommendation:
  *"Resolve: adversarial-sweep the shared location; decide
  a-supersedes-b / b-supersedes-a / scope-distinction."*

### 2. Linchpin-dependent findings and dispositions

- `get_findings()` — filter for findings whose evidence is attached
  with quality `comment-asserted`, `name-inferred`, or
  `pattern-matched` (`get_finding_evidence(finding_id)`).
- `get_dispositions()` — filter for `linchpin_dependent=1`.

These are findings/dispositions that survived Phase 4 but remain
fragile. The auditor's job is to ensure they stay fragile **on
purpose, not by accident**. For each:

- If the referenced file was modified since the last survey-session
  SHA (you can check via `detect_changes` for the relevant
  subsystem if the coordinator asks), flag for re-verification.
- If multiple linchpin-dependent findings cite the same file,
  propose a focused adversarial probe on that file.

### 3. Open field notes by age

```
get_field_notes(follow_up="open", limit=50)
```

Bucket by age:

- `< 7 days` — still fresh; no action unless category is critical.
- `7–30 days` — aging; worth a second look.
- `> 30 days` — cold. Either promote to a finding (run a focused
  survey) or dismiss explicitly.

Pay special attention to `tension` and `candidate-concern` — tensions
don't resolve themselves; candidate concerns left open for months
usually mean the concern should be added to the checklist and
dispositioned across subsystems.

### 4. Scope reconciliation and stale files

```
detect_changes(current_sha=<HEAD>)
get_stale_backlog(limit=10)
```

`detect_changes` reconciles the file ledger against the working tree.
Read all of what it returns, not just the stale subsystems:

- `unledgered_paths` — tracked files no subsystem has classified. These
  are scope the survey never saw; assign them with `add_files_to_scope`
  before trusting any coverage claim.
- `absent_ledger_paths` — ledger rows whose file the repository no
  longer tracks. Retire each with `retire_ledger_file`, which removes
  the row without discarding the subsystem's dispositions, findings,
  artifacts, or cross-references.
- `reconciled_tracked_paths` / `reconciled_ledger_rows` — the
  denominators. A zero result means something only alongside these; a
  clean reconciliation over an empty ledger is not a clean conspectus.

`get_stale_backlog` then ranks stale files by their subsystem's access
heat. High-heat stale files are the ones people keep reading despite the
drift, so they get refresh priority. Re-examine the file, then call
`clear_staleness(subsystem_id, file_path, ref_sha, evidence_id | reason)` —
clearing is per file, so re-reading one file never vouches for the rest of its
subsystem. The clear is recorded in `staleness_clears` with its basis; with
neither an evidence row citing the file nor a one-line reason, the server
answers `clear_staleness refuses: a clear records its basis`.

This is the reconciliation the rest of the system reads. A subsystem
cannot reach `mapped`, and the projection cannot be published, while
*"the store has not been reconciled against the repository at"* the
revision in question; publication is refused again while the standing
reconciliation reports *"tracked path(s) with no ledger row"*. Report
the unledgered list here — the coordinator assigns it.

Check `get_dashboard().staleness_measured` before repeating any
freshness claim. When it is false, nothing has been scoped and the
absence of stale files is absence of measurement, not health.

### 5. Diagnosticity matrices left open

```
list_diagnosticity_matrices(outcome="open")
```

Any matrix open beyond a single session is usually stuck because
further evidence is needed. For each, recommend either:

- A focused Phase 3 pass targeting the specific shared location, or
- An explicit `resolve_diagnosticity_matrix(outcome="unresolved-competition")`
  acknowledging the evidence doesn't discriminate.

### 6. Seams that just became assessable

```
get_seam_assessability()
```

Anything with `assessable=1` whose seam row has no `SC-N`
dispositions yet is ready for its seam assessment. Flag for the
coordinator to run.

### 7. Narratives

For each `mapped` subsystem:

```
get_narratives(subject_type="subsystem", subject_id=<id>)
```

- If a section the survey owes has no effective row (`structure` for any
  subsystem past `scoping`, `concern-reasoning` and `challenge` for one past
  `concerns` or `adversarial`) and no declination, flag it.
- If an effective narrative's `ref_sha` is older than a change to a file it
  cites, or the file is on the stale backlog (category 4), list it as ageing:
  the prose may no longer describe the code. It is not a hard error; a refresh
  revises it.
- `withdrawn` counts the keys a reset withdrew and the subsystem still owes.

For the project, `get_narratives(subject_type="project")` should hold an
effective row for each of the six sections the onboarding pass records.

## Output shape

```
## Contradictions (P0)
- [B01-1 ⟷ B03-2] shared: scheduler/main.ts:runJob@abc123. ...

## Linchpin-dependent findings needing verification (P1)
- [B02-3] comment-asserted sanitization; file modified 4 commits ago. ...

## Open field notes going cold (P2)
- [#47, 62 days] tension at SM-01: queue assumed single-consumer,
  but Phase 2 of B-02 found two consumer handlers. ...

## Stale entries (by heat)
- B-01 (heat 3.2, stale since 2026-03-18 — git-drift)

## Open diagnosticity matrices
- DM-7 (B-02, "intermittent 401s") — open 3 weeks; no cells recorded
  since the first two. Recommend explicit unresolved-competition.

## Seam assessments ready
- SM-02 (B-01 ↔ B-04) — both parties mapped; 0 SC-N dispositions.

## Narratives owed or ageing
- B-02 structure — no row and no declination.
- B-03 challenge "B03-1" — cites a file stale since 2026-03-18.
```

Skip any section that has nothing.

## Rules

- **You do not modify dispositions, findings, or xrefs** in this
  mode. You recommend; the coordinator or phase agents execute.
- **You may resolve field notes** explicitly as `dismissed` after
  consulting the human — but not silently.
- **Do not run `materialize_docs`** from here. The coordinator
  decides when to re-render.
