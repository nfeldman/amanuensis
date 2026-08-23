# Task/workspace indexes for reorientation after interruption

## Charter

- **Status:** initial evidence pass complete 2026-08-22; transfer remains unvalidated in static-report use
- **Question:** What can a static, offline codebase survey responsibly borrow from task- or workspace-index patterns to help a reader resume after interruption, without inventing user history or presenting itself as a live task manager?
- **Why this exists:** Three independent design critiques agreed that Amanuensis needs a clearer re-entry path, but disagreed on whether it should lead with an action queue, an atlas, or evidence casefiles. Existing Scholiast work under `ai-primary-web-platform-landscape` covers runtime and navigation substrate, not interruption recovery or task/workspace indexes.
- **In scope:** empirical software-engineering and HCI evidence on task context, interruption recovery, resumption cues, and stable external representations; explicit transfer limits to a static generated report.
- **Out of scope:** general dashboard design, productivity-system advice, user-tracking, personalization, implementation details, and any crawl of `/Users/nfeldman/research`.
- **Source standard:** prefer directly read primary papers or official artifact documentation. Record discovery-only items as `not-accessed`; do not promote snippets or abstracts to held evidence.
- **Decision this may inform:** whether the redesign should expose a truthful `Resume` entry point, what durable inputs may back it, and what language must be avoided when no user-specific task state exists.

## Facets

1. What evidence shows that explicit task context or resumption cues help programmers resume interrupted work?
2. Which cues or index fields are durable enough for a static, offline report?
3. What does the evidence *not* justify transferring to Amanuensis?

## Success condition

A compact claim map with three to six directly read primary sources, seven-field claims, at least one explicit counterevidence/transfer-limit search, and a bounded design implication rather than a literature-style recommendation dump.

## Calibrated concern territories

- **Scope misapplication:** IDE experiments and active programming tasks are not static survey reports.
- **Temporal conflation:** older IDE/task-context studies may predate current development workflows.
- **Provenance collapse:** abstracts and later summaries are discovery routes, not evidence.
- **Counterevidence invisibility:** search for null, weak, or context-dependent effects, not only benefits.
- **Definition instability:** distinguish task context, workspace state, navigation history, and recommended next action.

## Claim map

| ID | Standing | Condensed result | Decision bearing |
| --- | --- | --- | --- |
| C001 | Single-source | Resuming programming sessions frequently includes reconstructive navigation rather than immediate editing. | A re-entry affordance is a real problem hypothesis, not decorative navigation. |
| C002 | Single-source | Content-rich activity cues were preferred and weakly associated with completion in one small study, but did not significantly reduce measured lag. | Prefer concrete evidence/content over an abstract hierarchy; do not promise speed or effectiveness. |
| C003 | Single-source | Mylar’s task context depends on a user’s named task and interaction history, and has documented lifecycle/inference limits. | Do not copy a task manager’s claims or ranking model into a generated static report. |
| C004 | Inferred | A static report may expose report-owned state as a `Resume` route, but must not imply knowledge of the reader’s task, history, or next action. | Build truthful reorientation around snapshot/session/evidence links; avoid personalized language. |

## Bounded implication

The evidence supports a modest, inspectable report surface: `Resume this report` can identify the snapshot and point to durable survey-owned entry points (for example, open findings, recorded decisions, or the active survey session) with their basis visible. It does **not** support a “continue your task,” “you were working on,” or algorithmic “next best action” feature unless Amanuensis later captures and discloses user-specific state. This is an inference (C004), not a measured result for static reports.

## Remaining gap

No direct evidence in this narrow pass tests a static offline codebase report. O001 in `notes.md` is therefore a prototype-validation question, not settled research.
