# Notes

## 2026-08-22 — commissioning note

This workspace is intentionally narrower than a general information-architecture survey. The panel's unresolved issue is epistemic: which reorientation affordances can be generated from report-owned state, and which would falsely imply knowledge of the reader's interrupted task. The research pass should keep that boundary visible.

## Prior-work check

- Targeted search of `/Users/nfeldman/repos/scholiast` and `/Users/nfeldman/repos/amanuensis/scholiast` found no prior task-index, workspace-index, re-entry, or interruption-recovery survey.
- `/Users/nfeldman/repos/amanuensis/scholiast/ai-primary-web-platform-landscape` contains useful baseline claims about a repeated global shell, JS-dependent mobile navigation, offline output, readback, and diff-aware reuse. It does not answer the commissioned question.
- A previously named workspace at `/Users/nfeldman/repos/amanuensis/scholiast/delightful-orienting-codebase-reports` was not present when checked on 2026-08-22.

## 2026-08-22 — source and counterevidence pass

- Directly read three primary papers: Parnin & Rugaber (ICPC 2009), Parnin & DeLine (CHI 2010), and Kersten & Murphy (FSE 2006). Their exact evidence locators and limits are in `sources.md`.
- Counterevidence/transfer-limit search deliberately inspected the controlled study’s null lag results and threats to validity, and Mylar’s own field-study threats/shortcomings. The useful result is not “indexes work”; it is that content-rich cues can aid orientation under particular IDE conditions while simple hierarchy/last-location cues, inferred relevance, and predictions have documented limits.
- No source directly evaluates a static, offline codebase-survey report or validates a `Resume` label in that setting. That absence is a query result for this three-paper, primary-source pass, not a claim that no such study exists.
- Link audit: all three author/university full-text URLs opened successfully. Browser-wrapper DOI checks could not be completed (one rejected as unsafe direct URL; two ACM DOI requests returned 403), recorded in `sources.md` rather than treated as broken citations.

## Vocabulary boundary

- **Task context (Mylar):** a user-specific graph of artifacts and relations assembled from a named task plus a developer’s interaction history; it is not merely an architecture map or subsystem list.
- **Working context (Parnin & DeLine):** applications, windows, and documents needed for a task; distinct from **mental context**, such as plans, goals, and program knowledge.
- **Report-owned re-entry cue:** a stable fact generated from the survey (snapshot, session, record state, link). It is not evidence of what the reader last saw, intended, or should do next.

## Open question O001

What wording and page composition let readers discover the report-owned `Resume` route without mistaking it for saved personal state? Resolving this needs an Amanuensis prototype usability/accessibility evaluation, not more inference from IDE studies.
