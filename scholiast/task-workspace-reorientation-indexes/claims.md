# Claim inventory

Claims distinguish empirical observations about programmers and IDEs from the narrower design inferences for a static Amanuensis report. All source pointers below are directly read unless marked otherwise.

## Empirical software-research claims

### C001 — Re-entry often involves reconstructive navigation, not simply returning to the last edit

- **Class:** Single-source
- **what:** In Parnin and Rugaber’s logged programming sessions, most retained sessions did not begin coding within one minute, and most involved navigation before editing; the authors interpret this as developers seeking task context on resumption.
- **how:** Exploratory analysis of 9,899 retained interaction-log sessions from 85 programmers; descriptive behavioral measures, not an intervention.
- **where:** Parnin & Rugaber, 2009, p. 1 abstract and pp. 3–7, [DOI 10.1109/ICPC.2009.5090030](https://doi.org/10.1109/ICPC.2009.5090030), author PDF in S001 — directly read.
- **when:** 2009 publication; evidence re-read 2026-08-22.
- **why:** Facet 1. It establishes a reorientation problem worth addressing, while not establishing that any particular report UI solves it.
- **confidence:** Single-source — one observational, historical study in IDE interaction data.
- **see-also:** C002 (the limited cue intervention), C004 (static-report boundary), S001, D004.

### C002 — Content-level activity cues were preferred and associated with more task completions, but the experiment did not show a statistically significant reduction in measured resumption or edit lag

- **Class:** Single-source
- **what:** In a 14-participant controlled study, the content timeline and DOI tree conditions together had more task completions than notes-only (reported as weak significance), and participants rated the content timeline higher than notes and the DOI tree; the three conditions’ resumption and edit-lag differences were not statistically significant.
- **how:** Within-subject controlled study of interrupted feature work in three unfamiliar game codebases; cues and notes compared by completion, errors, lags, and post-task ratings.
- **where:** Parnin & DeLine, 2010, pp. 6–8, especially pp. 7–8, [DOI 10.1145/1753326.1753342](https://doi.org/10.1145/1753326.1753342), author PDF in S002 — directly read.
- **when:** 2010 publication; evidence re-read 2026-08-22.
- **why:** Facets 1 and 3. It supports trying concrete, content-bearing re-entry cues, but blocks a claim that an index or timeline reliably makes resumption faster.
- **confidence:** Single-source — small historical controlled study with warned interruptions, expert participants, unfamiliar code, and a direct null result for lag measures.
- **see-also:** C001, C003, C004, S002, D004.

### C003 — A task-focused workspace is a user-specific model, not a neutral codebase index

- **Class:** Single-source
- **what:** Mylar’s task context is constructed from a programmer’s interactions and structural artifact relations, associated with an active task, then used to filter/rank the IDE. The paper reports improved edit ratio in its accepted field-study cohort, but also documents selection bias, task-lifecycle shortcomings, related-task ambiguity, and possible inference/tuning failures.
- **how:** Longitudinal field study of a task-context IDE, measuring interaction history and an edit-to-selection proxy; authors’ discussion of model limitations supplies the counterweight.
- **where:** Kersten & Murphy, 2006, pp. 1–4, 7–9, [DOI 10.1145/1181775.1181777](https://doi.org/10.1145/1181775.1181777), UBC PDF in S003 — directly read.
- **when:** 2006 publication; evidence re-read 2026-08-22.
- **why:** Facets 2 and 3. It identifies the missing ingredients a generated report does not possess: an active task, personal interaction stream, and a user-correctable relevance model.
- **confidence:** Single-source — voluntary early-adopter cohort (16 of 99), historical Eclipse/Java context, and proxy outcome; directly relevant as a mechanism boundary, not as a transfer guarantee.
- **see-also:** C002, C004, S003, D004.

## Inference for Amanuensis (not an empirical result)

### C004 — A static report may offer a truthful report-owned “Resume” route, but must not simulate a personal task/workspace index

- **Class:** Inferred
- **what:** Amanuensis may group durable, report-owned cues — snapshot identity, survey/session state, unresolved findings or decisions, and stable links to the relevant subsystem/evidence — under a `Resume` route that means “continue orienting in this report.” It should not label a browser location as “your last task,” infer a reader’s intent, rank “next action” from absent interaction history, or claim personalized continuity.
- **how:** Scope translation from C001–C003: developers benefit from reconstructing context and can value content-rich cues, but the studied systems obtain that context from individual activity, named tasks, and editable workspace state. A static output has only generator-owned facts. The negative boundary follows directly from missing inputs, not from a measured report experiment.
- **where:** Inference from S001 pp. 1, 3–7; S002 pp. 6–9; S003 pp. 1–4, 7–9. No direct static-report study was located in this narrow pass.
- **when:** Inference made 2026-08-22 against the report design question; source evidence is 2006–2010.
- **why:** Facets 2 and 3; informs a truthful redesign without inventing reader history or turning the report into a live task manager.
- **confidence:** Inferred — plausible constrained design translation, not validation that the route improves report use.
- **see-also:** C001, C002, C003, S001–S003, D004; open question O001 in notes.md.
