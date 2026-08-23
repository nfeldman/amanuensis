# Artifact Templates

Amanuensis's output artifact formats. Coordinators and phase agents write these
prose artifacts to the project-local `.amanuensis/` storage directory during
survey work.

Structured data — file ledgers, dispositions, findings, field notes,
evidence rows, seams, diagnosticity matrices — lives in `memory.db`
only. The materializer renders both structured and prose sources into
navigable human docs; these templates cover the prose half.

The templates below are minimal skeletons. Agents extend them as the
subsystem requires. Do not remove the headers — the materializer and
xref resolver rely on them.

---

## 1 · Onboarding report (`onboarding-report.md`)

```markdown
# Onboarding report

**Codebase**: [name]
**Date**: [ISO 8601]
**Onboarding session**: [session_id]

## Repository shape

| Dimension | Observed value | Confidence |
|---|---|---|
| Primary language(s) | | |
| Secondary language(s) | | |
| Build system(s) | | |
| Code generation present? | Yes/No | |
| Generated file patterns | | |
| Monorepo or single service? | | |
| Deployable unit count | | |
| Canonical branch | | |
| Branch convention | | |
| Onboarding SHA | | |

### Directory cluster map

| Cluster | Apparent role | Language | Confidence | Notes |
|---|---|---|---|---|

## Runtime boundary map

| Runtime / Process | Language | Communicates with | Mechanism | Notes |
|---|---|---|---|---|

## Significant stateful entities

| Name | Location | What it stores | Lifetime | Populated by | Invalidated by |
|---|---|---|---|---|---|

## Concern calibration

[For each territory: applicability verdict + derived concern codes.
Non-applicable territories noted with the disqualifying condition.]

## Draft master plan

[Full subsystem table — see master-plan.md template below.]

## Questions for the human

### Tier 1 — Blockers (answers required before these subsystem areas can be mapped reliably)

1.
2.

### Tier 2 — Priority shapers (answers would help rank subsystems by risk)

1.
2.

### Tier 3 — Context (answers would reduce false positives on surprising patterns)

1.
2.

## Recommended first mapping

**Top**: [Subsystem ID] — [rationale]
**Second**: [Subsystem ID] — [rationale]
```

---

## 2 · Entry point (`entry-point.md`)

The universal-first-read document. A new agent reading only this file
must be able to answer:

1. What does this system do? Who are its runtime processes?
2. What should be mapped first, and why?
3. Given a bug report, what is the first thing to read?
4. Given a request to design a new feature, what mode applies and what
   does it consult first?

If any answer requires reading a different file first, the entry point
is incomplete.

```markdown
# Entry point

**Conspectus version**: [ISO 8601]
**Canonical branch**: [branch]
**Onboarding SHA**: [sha]

## What is this codebase?

[3–6 sentences: runtime processes, primary coordination language,
primary data stores. Must stand alone — no external references.]

## Domain vocabulary

[Key terms discovered during onboarding that affect correctness
interpretation. Full definitions live in the vocabulary table; this
section lists the ones every agent must know before touching code.]

## Directory map

| Path | Kind | Canonical source |
|---|---|---|
| `entry-point.md` | entry-point | this file |
| `onboarding-report.md` | onboarding-report | |
| `master-plan.md` | master-plan | |
| `findings-index.md` | findings-index | |
| `concern-checklist.md` | concern-checklist | |
| `field-notes.md` | field-notes | |
| `<id>-<slug>.md` | subsystem-survey | one per mapped subsystem |

## Knowledge depth contract

| Mapping status | Authorized claims |
|---|---|
| `unmapped` | None. No assertions about behavior. |
| `scoping` | File scope only. "File F participates in subsystem S." No behavioral claims. |
| `structural` | Types, state containers, flows, concurrency model. No correctness claims. |
| `concerns` | Concern dispositions with evidence. Confirmed findings at evidence_quality ≥ code-verified. |
| `adversarial` | Adversarial work is authorized and in progress. Only findings with recorded adversarial support count as survived. |
| `mapped` | Workflow-marked complete with seam contracts filled in. Inspect the records; status alone does not prove universal challenge coverage. |

**Any claim exceeding the authorized level must be flagged explicitly
as speculative.**

## Mode selection

| Task | Start here |
|---|---|
| Bug report | Search `findings-index.md`, then `get_findings(subsystem_id)`. |
| New feature | Find the affected subsystem(s) in `master-plan.md`; consult their survey artifacts. |
| Refactor | Consult the affected subsystem's xrefs and seam assessments. |
| Onboarding a new contributor | This file, then `master-plan.md`, then the `jump_in_reading` files per subsystem. |

## Minimal bootstrapping read

A new LLM or contributor reading only these files has enough context
to work on any subsystem:

1. This file (entry-point.md)
2. master-plan.md
3. The target subsystem's `jump_in_reading` files
4. findings-index.md (filtered to the target subsystem)
```

---

## 3 · Master plan (`master-plan.md`)

```markdown
# Master plan

**Last updated**: [ISO 8601]

## <Layer 1>

| Priority | ID | Name | Status | Scope | Jump-in reading | Notes |
|---|---|---|---|---|---|---|

## <Layer 2>

| Priority | ID | Name | Status | Scope | Jump-in reading | Notes |
|---|---|---|---|---|---|---|

## Pending activities

- Seam assessments: [seam ID] (both parties `mapped`, awaiting SC-N dispositions)
- Diagnosticity matrices open: [DM-N] at [subsystem]
```

Status values: `unmapped`, `scoping`, `structural`, `concerns`,
`adversarial`, `mapped`, `deferred`.

---

## 4 · Findings index (`findings-index.md`)

A human-readable index of confirmed findings across all subsystems.
The DB's `findings` table is authoritative; this file is a rendered
summary that persists across sessions.

```markdown
# Findings index

**Last updated**: [ISO 8601]

## CRITICAL (N)

- [B02-1] Unvalidated query params reach SQL — `auth/gateway.ts:parse@<sha>`
  - Severity: CRITICAL · Status: confirmed-bug · Session: [id]
  - Business context: affects all auth flows

## HIGH (N)

## MEDIUM (N)

## LOW (N)

## Ruled out (N)

- [B01-1] (ruled out in adversarial review — supervisor bounds the blast radius)
```

The materializer produces a richer primary reading surface at
`docs/findings.html`, with `docs/findings.md` as its portable companion; this
prose index remains the human-committed record.

---

## 5 · Concern checklist (`concern-checklist.md`)

```markdown
# Concern checklist (calibrated)

**Derived**: [ISO 8601] from onboarding session [id]

This file supersedes `concern-territories.md` for future sessions —
agents work from this calibrated list, not the territory catalog.

## Active concerns

| Code | Category | Source territory | Codebase-specific probe |
|---|---|---|---|
| CC-1 | cache | T2 cache coherence | In this codebase: audit `UserCache.putIfAbsent` sites for legitimate-concurrent-write suppression. |
| SC-1 | seam | T11 seam contract | B-01 writes `jobs_queue` with enqueue-order semantics; B-02 assumes causal ordering. |

## Non-applicable territories

| Territory | Disqualifying condition |
|---|---|
| T8 concurrency race windows | Codebase runs on CPython with GIL; no shared mutable state across threads. |

## Discovered concerns

| Code | Category | Discovered in | Notes |
|---|---|---|---|
| OB-1 | observability | onboarding | Log schema changes unannounced; downstream parsers assume stability. |
```

---

## 6 · Field notes (`field-notes.md`)

Append-only. Structured notes live in the DB (`field_notes` table);
this prose file captures the narrative context the DB rows don't carry.

```markdown
# Field notes

## Patterns

[Observations that recur across files or subsystems.]

## Anomalies

[Deviations from the expected pattern.]

## Tensions

[Cases where local correctness invariants are in conflict.]

## Candidate concerns

[Patterns that might warrant a new concern code.]

## Connections

[Cross-subsystem links not yet represented in xrefs.]
```

The materializer surfaces the DB rows as `docs/field-notes.md` grouped
by category. This prose file is for longer-form observations that
don't fit the table schema.

---

## 7 · Subsystem survey (`<id>-<slug>.md`)

One per mapped subsystem. Written incrementally by the phase agents.

```markdown
# [Subsystem ID] — [Name]

**Status**: [current status]
**Jump-in reading**: [2–3 files]

## Tier 1 summary

[The compressed summary for future consultation. Produced during Phase
5 packaging. Uses the codebase's own vocabulary; maintains seven-field
invariant (what, how, where, when, why, confidence, see-also).]

## Structural inventory (Phase 2)

### Key types

| Symbol | Role | Source |
|---|---|---|

### State containers

| Name | Location | Stores | Lifetime | Populated by | Invalidated by |
|---|---|---|---|---|---|

### Data flows

[One end-to-end trace per primary flow, with numbered steps and
file:symbol@sha references.]

### Concurrency model

[Prose paragraph with evidence citations.]

### Seam contracts (this subsystem's side)

#### SM-XX — [shared object]

- What this subsystem writes: [...]
- What this subsystem reads: [...]
- Ordering assumption: [...]
- Cardinality: [...]
- Staleness tolerance: [...]

## Concern work (Phase 3)

[Structured dispositions live in the DB. Prose here covers the
reasoning that didn't fit in the disposition's rationale field:
context framing, compensating mechanisms considered, why each
evidence quality tag was chosen.]

## Adversarial review (Phase 4)

### [Finding ID] — Claim A vs Claim B

- **Claim A**: [Phase 3 conclusion]
- **Claim B**: [What adversarial review found]
- **Evidence for Claim B**: [file:symbol@sha]
- **Verdict**: [upheld / overturned / scope-restricted / quality-upgraded / quality-downgraded]

[One subsection per finding reviewed.]
```

The materializer decorates this file with DB-sourced tables
(dispositions, findings, evidence) when rendering the human-facing
`docs/subsystems/<slug>.md` page; the prose file remains the
authoritative narrative.

---

## 8 · Dispatch prompts (`_meta/prompts/<timestamp>-<role>-<seq>.md`)

Record of each sub-agent dispatch. Indexed by `log_dispatch`;
file contents include the full prompt + response for audit trail.

```markdown
# Dispatch [session-id] seq [N] · [role]

**Dispatched**: [ISO 8601]
**Completed**: [ISO 8601 or null]
**Subsystem**: [id]
**Artifacts written**: [comma-separated paths]

## Prompt

[Full prompt text passed to the sub-agent.]

## Response

[Full response / summary returned by the sub-agent.]
```

The `_meta/prompts/` directory keeps the full audit trail for every
sub-agent dispatch. The `subagent_log` table is the queryable index;
each row references a dispatch prompt file by path.
