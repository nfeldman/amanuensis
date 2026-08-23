# Actionable redesign handoff

## Outcome

Ship the current prototype's **Field Docket** structure as a typed, report-owned reading surface—not as a live task cockpit. The first production increment should improve truthfulness and reading order before adding new data models.

## Renderer seams

| Increment | Primary seam | Change | Test first |
| --- | --- | --- | --- |
| 1. Truthful shell | `html_projection.py` snapshot/page shell | Remove duplicate hint; scope freshness copy; accessible badge definitions; explicit zero-state basis | Prohibited-copy and badge-domain fixtures |
| 2. Typed findings | `renderers.py::render_findings` plus HTML projection | Replace six-column prose rows with semantic casefiles; use already-selected `f.*` fields | One database row ↔ one article/marker/anchor/evidence route |
| 3. Action overview | overview renderer/query | Critical/high open records, decisions, assumptions, active-run caveat; visible ordering rule | Recomputed database counts and active-session ordering |
| 4. Subsystem anatomy | `SitePage.kind == subsystem` projection | Current status, action summary, purpose/boundary, jump-in reading, findings, seams, files, dispositions, history | Current-vs-historical state conflict fixture |
| 5. Mobile behavior | embedded CSS/JS | Inert closed rail; dialog/drawer focus lifecycle; 44 px controls; announced search results | Headless keyboard traversal at 375/768/1024 px |
| 6. Content index | generated static JSON/embedded data | Typed offline search over findings, decisions, files, evidence, and subsystems | `AppendLag`, `V02-1`, and `x-axiomdb-tenant` fixtures |
| 7. Architecture plate | architecture view model | Render only evidence-backed edges; textual relation-list parity; no raw-source success state | Edge/link correspondence and no-fallback gate |

## Exact component contract

### `FindingCase`

- `<article data-finding-id="…" aria-labelledby="…">`
- consequence-led heading;
- separate severity and resolution labels;
- `Why this matters`, `Observed behavior`, `Root cause`, and `Evidence` regions;
- business context, primary files, checked SHA, assumptions/decisions, and subsystem link;
- stable durable marker and anchor exactly once;
- actions are navigation/copy operations, never simulated resolution.

### `ConditionBand`

Four independent cells:

- `Source scan` — exact checked revision and detector scope;
- `Survey depth` — how far the survey progressed;
- `Engineering action` — finding/decision work state;
- `Publication integrity` — projection/readback and contradiction custody.

No aggregate status or color-only meaning.

### `ReportReentry`

- visible label: `Resume this report`;
- names the report-owned basis (`active session`, `open finding`, `open decision`, or `no prior comparison recorded`);
- stable link to the record and its evidence;
- contains no `you were`, `your task`, `continue where you left off`, or `next best action` language unless a later, separately disclosed state mechanism actually supplies it.

## Prototype/testing order

1. Bind the existing prototype anatomy to a current AxiomDB fixture (`34/34`, 15 findings, one critical, two high, active session) without changing its visual language.
2. Run the five reader-task fixtures in `task-tests.md`; add a sixth state-conflict fixture for W-01.
3. Run structural validation and readback red arms.
4. Run browser keyboard/responsive checks once local-page execution is available.
5. Only then compare thesis-first versus consequence-first first-viewport variants with representative users.

The current prototype remains the inspectable design specimen. `current-report-stress-test.md` records which parts survive the moving report and which values must be refreshed before evaluation.

