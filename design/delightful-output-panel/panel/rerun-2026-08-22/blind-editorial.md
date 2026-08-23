## A. First impression and evidence-to-action diagnosis

Review constraint: this was a source-only critique of the generated HTML/CSS/JS; no live `file://` browser rendering was available. Visual impressions are therefore inferred from structure and styling rather than pixels.

### Observed facts

- The surface has a strong documentary foundation: self-contained assets, a skip link, visible focus treatment, reduced-motion handling, semantic table headers, and human-readable status text rather than color alone. See [html_projection.py:175](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:175), [html_projection.py:188](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:188), and [html_projection.py:363](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:363).

- The visual language is deliberately editorial: paper tones, restrained signal colors, serif display type, monospace metadata, and generous reading measure. That is useful delight because it frames the material as a record to inspect rather than a monitoring dashboard to glance at. See [html_projection.py:111](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:111).

- Every page receives the same global snapshot strip and the same hint twice: once below the title and once again as a “Reading hint.” See [html_projection.py:853](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:853). On the overview, the duplication is literal at [index.html:299](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html:299) and [index.html:308](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html:308).

- “No recorded stale entries” is a global statement derived from `entries.stale`, not a page- or finding-level freshness judgment. The shell treats a nonempty checked SHA plus zero stale entries as aligned, regardless of individual finding SHAs. See [html_projection.py:807](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:807) and [core.py:165](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/core.py:165). Change detection only marks entries belonging to changed paths matched exactly through the file ledger. See [git.ts:162](/Users/nfeldman/repos/amanuensis/mcp-server/src/tools/git.ts:162) and [git.ts:192](/Users/nfeldman/repos/amanuensis/mcp-server/src/tools/git.ts:192).

- The overview reports useful counts, but the next major block is a generic directory rather than a prioritized action queue. “Latest session” appears last, even though it is active and began after the displayed source-check timestamp. See [index.html:314](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html:314), [index.html:318](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html:318), and [index.html:323](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html:323).

- Findings are rendered as severity-grouped tables whose symptom and root-cause cells contain paragraph-scale prose. The critical row demonstrates the result: the highest-priority action is visually trapped inside a six-column horizontal record. See [findings.html:309](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/findings.html:309). The renderer fetches all finding fields but emits only ID, subsystem, resolution, symptom, root cause, and SHA, omitting business context and primary-file evidence from the aggregate page. See [renderers.py:442](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/renderers.py:442) and [renderers.py:467](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/renderers.py:467).

- The decisions page contains unusually good decision context: the question, what it blocked, the assumption in force, evidence on both sides, and consequences of reversal. See [open-questions.html:313](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/open-questions.html:313). But its only resolution guidance is an inline tool name in introductory prose; there is no per-question action affordance. See [open-questions.html:309](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/open-questions.html:309).

- Survey depth and software health share the same generic badge vocabulary. Q-01 is green and “Mapped,” yet its record contains a confirmed bug. Both claims are individually valid, but their juxtaposition invites “green means healthy.” See [q01…html:305](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/subsystems/q01-sparql-front-end-and-query-pipeline.html:305) and [q01…html:397](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/subsystems/q01-sparql-front-end-and-query-pipeline.html:397). The CSS explicitly groups mapped with positive states. See [html_projection.py:306](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:306).

- Status definitions are exposed through `title` attributes. The visible labels are good, but the explanatory meaning is not reliably keyboard- or screen-reader-discoverable. See [html_projection.py:457](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:457).

- Subsystem pages preserve substantial traceability—scope, jump-in reading, file ledger, concern dispositions, findings, seams, and adversarial notes—but present them as one long undifferentiated reading sequence. See [q01…html:309](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/subsystems/q01-sparql-front-end-and-query-pipeline.html:309), [q01…html:322](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/subsystems/q01-sparql-front-end-and-query-pipeline.html:322), and [q01…html:388](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/subsystems/q01-sparql-front-end-and-query-pipeline.html:388).

- The contradictions page honestly preserves explicit disagreement, but its empty state only says “No contradictions recorded.” It does not distinguish “checked and none found” from “no contradiction records exist.” See [contradictions.html:309](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/contradictions.html:309).

- Existing verification is strong against projection drift: authoritative markers, planned pages, local links, fragments, and publication-receipt hashes are checked independently. The verifier explicitly says this proves projection correspondence, not semantic truth. See [readback.py:154](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/readback.py:154) and [readback.py:274](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/readback.py:274).

### Inferences

The current design is a good archive and a weak decision surface. It asks the reader to infer priority by reading every chapter, translating three status systems, and manually joining findings, open questions, subsystem files, and assumptions.

The main attention-theater risk is not decoration; it is authoritative-looking uniformity. Every page receives the same freshness reassurance, every mapped subsystem gets a positive green signal, and every finding receives similar tabular weight. That consistency feels rigorous while obscuring three materially different questions:

- What requires action?
- What is known, inferred, contradicted, or stale?
- What source and revision authorize that statement?

The useful delight should remain: calm typography, offline durability, disciplined whitespace, and relationship traces. Delight becomes harmful when it promotes survey completion over defect urgency or makes global metadata look like item-level verification.

### Open questions

- Who is the primary reader: maintainer triaging work, reviewer auditing claims, or newcomer learning architecture? The preferred direction below assumes maintainers and staff engineers are primary, with audit detail one disclosure away.

- Is the HTML intentionally read-only? If so, actions must be links or copyable commands, never simulated “Resolve” buttons. If a trusted write channel is planned, that needs explicit authority, authentication, and audit semantics.

- Can the data model distinguish “contradiction check completed with none found” from “no check recorded”? The current contradictions table cannot express that basis.

- Is staleness intended to cover all finding evidence, or only tiered `entries`? The current label should remain narrower unless the detector’s coverage expands.

## B. Three incompatible redesign directions

### 1. Decision queue — preferred

Optimize for “What should I do next?”

The overview becomes a triage surface: action-required findings, human decisions, assumptions currently affecting severity or scope, and source records needing re-check. Findings become vertically readable cases with direct evidence routes.

Strength: fastest responsible action; makes consequences and authority visible together.

Cost: weakens the contemplative atlas quality and necessarily applies editorial ordering that must be made explicit and testable.

### 2. Evidence dossier

Optimize for “Can I audit this claim?”

Every claim is a dossier with observation, inference, evidence type, source revision, competing evidence, assumptions, and disposition. The overview is an integrity ledger rather than an action dashboard.

Strength: strongest epistemic preservation and source custody.

Cost: slower operational triage; critical defects may remain visually comparable to low-impact but richly evidenced claims.

### 3. Architecture atlas

Optimize for “How does the system compose?”

Make the subsystem and seam map primary. Findings, staleness, decisions, and contradictions appear as overlays on the architecture. Useful delight comes from seeing blast radius and shared boundaries, not decorative motion.

Strength: best mental model and strongest support for cross-subsystem reasoning.

Cost: hardest to make accessible, printable, and useful on small screens; spatial prominence can accidentally substitute topology for operational priority.

## C. Preferred component anatomy

### Overview

1. **Identity header**
   - Project name and conspectus purpose.
   - Source snapshot, source-check time, active-run state.
   - One nonduplicated orientation sentence.

2. **Snapshot caveat**
   - If a survey session is active: show a signal banner before all counts.
   - Explain whether counts include that run.

3. **Action required**
   - Critical/high open findings first.
   - Each item: ID, consequence-led title, affected subsystem, resolution state, checked revision, and “Open finding.”
   - “View all action-required findings.”

4. **Decisions affecting the record**
   - Open questions ordered by consequence, not category alone.
   - Show question, assumption currently in force, affected findings/subsystems, and whether it blocks work or only changes calibration.
   - “Open decision record” and “Copy resolution command.”

5. **Integrity of this snapshot**
   - Separate lanes for survey coverage, tracked-record staleness, explicit contradictions, and unresolved assumptions.
   - Never combine these into one green health signal.

6. **Change/accountability**
   - Last source check, last completed survey run, active run, and report generation time as distinct timestamps.
   - If change history is unavailable, say so.

7. **Explore the system**
   - Architecture, subsystem map, boundaries, coverage, glossary.
   - These are secondary routes, not the center of the page.

### Findings

1. **Page header**
   - Scope statement: which statuses are included.
   - Count reconciliation by resolution state and severity.

2. **Filter and sort controls**
   - Resolution: action required / verification pending / closed.
   - Severity, subsystem, evidence freshness, assumption dependency, contradiction state.
   - Default sort: action state, then severity, then stale/contradicted evidence.

3. **One `<article>` per finding**
   - Heading: `V02-1 — HTTP routes allow unauthenticated cross-tenant access`.
   - Separate severity and resolution badges.
   - “Why this matters” before implementation detail.
   - “Observed behavior” and “Root cause” as separate readable blocks.
   - Business context visible, not discarded.
   - Evidence trace: primary files, checked SHA, evidence quality, source subsystem.
   - Linked assumptions and contradiction records.
   - Actions: open subsystem, inspect evidence, copy ID, inspect durable record.

4. **Progressive disclosure**
   - Keep full root-cause detail available, but do not place it in a wide table cell.
   - A compact table view can be a later alternate mode.

5. **Preserved custody**
   - Retain each durable finding marker exactly once.
   - Deep links remain stable.

### Subsystem

1. **Two-axis header**
   - `Survey depth` and `Software action state` must be visually and semantically separate.
   - Source snapshot and subsystem evidence revision shown distinctly.

2. **At-a-glance triage**
   - Open findings.
   - Decisions/assumptions affecting this subsystem.
   - Explicit contradictions.
   - Concern disposition totals.
   - Tracked records needing re-check.

3. **Purpose and boundary**
   - Scope.
   - What this subsystem owns.
   - What it explicitly does not own.
   - Dependencies and seams.

4. **Jump-in reading**
   - Ordered file list with “why read this.”
   - Primary files before candidate/deferred files.
   - Revision attached to each file.

5. **Findings**
   - Same article component as the aggregate page, not a parallel representation.

6. **Concern dispositions**
   - Compact filterable matrix.
   - Each row exposes classification, evidence quality, linchpin dependency, scope limit, and rationale.
   - Explanations remain visible without relying on `title`.

7. **Flows and state**
   - Structural inventory, key types, state containers, and data flows.
   - Preserve diagrams where they clarify composition.

8. **Adversarial record**
   - Claim, attempted disproof, surviving evidence, verdict, and scope restriction.
   - Visually distinguish observation from inference.

9. **Audit appendix**
   - Full file ledger, raw survey notes, vocabulary, and durable Markdown link.

## D. Exact microcopy and labels

### Snapshot and freshness

- `Source snapshot: main @ d19ade70`
- `Source checked: Aug 22, 2026 at 4:39 PM EDT`
- `Source scan: no tracked records flagged for re-check`
- `Source scan: 3 tracked records need re-check`
- `Source scan not recorded`
- `Survey run in progress`
- `This snapshot predates the active survey run; findings may change.`
- `Report generated from durable conspectus records`

Avoid `Fresh` and `No recorded stale entries`; both read more broadly than the detector proves.

### Survey depth

- `Not surveyed`
- `Scope recorded`
- `Structure mapped`
- `Concern review in progress`
- `Adversarial challenge in progress`
- `Reviewed through adversarial challenge`
- `Review deferred`

Replace `Mapped`, whose positive color currently resembles a software-health judgment.

### Finding resolution

- `Engineering action required`
- `Fix recorded — verification pending`
- `Closed — fix verified`
- `Closed — claim ruled out`
- `Accepted behavior — no change proposed`

### Evidence language

- `Verified in code`
- `Stated by contract`
- `Observed in test`
- `Claimed by configuration`
- `Claimed by documentation`
- `Claimed by comment`
- `Inferred from name`
- `Pattern signal only`

### Decision language

- `Needs human decision`
- `Assumption currently in force`
- `What this decision changes`
- `Work blocked`
- `Work continued under assumption`
- `Open decision record`
- `Copy resolution command`
- `Re-survey affected subsystem`

### Contradictions and zero states

- `No explicit contradiction records in this snapshot.`
- `This does not establish that all claims agree.`
- `Contradiction check not recorded.`
- `Conflicting evidence requires review.`

### Traceability actions

- `View evidence at checked revision`
- `Open subsystem context`
- `Inspect durable Markdown`
- `Copy finding ID`
- `Show why this status applies`

## E. Minimum viable renderer changes vs. later work

### Minimum viable

- Remove the duplicate reading hint from the generic shell.
- Rename and scope the freshness language without changing the database.
- Split badge namespaces into survey depth, finding resolution, severity, and evidence quality; expose descriptions as visible or `aria-describedby` text instead of `title` only.
- Change `render_findings` from paragraph-scale table rows to one heading/card block per finding. It already selects `f.*`, so business context and primary files can be emitted without a schema migration.
- Add conditional page anatomy by `SitePage.kind`; the current page plan already supplies `kind`. See [core.py:254](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/core.py:254).
- Add overview sections for action-required findings and open decisions using existing queries.
- Add source revision, assumption links, and subsystem links to finding cards.
- Preserve current markers, route resolution, offline assets, print behavior, and Markdown companions.
- Extend current readback red arms rather than replacing them.

### Ambitious later work

- Introduce typed HTML view models instead of routing all page semantics through a small Markdown parser.
- Compute per-record freshness from evidence paths and revisions, including renames and dependency changes.
- Add a generated client-side search index with filters across findings, decisions, evidence, and subsystems.
- Add checked-revision source links where repository hosting information is available.
- Represent contradiction-check custody explicitly: evaluated state, checked revision, method, and result.
- Add timeline/delta views between source checks.
- Add the architecture-atlas overlay as an alternate view, not the only route.
- Add write actions only through a trusted audited integration; keep static HTML actions honest until then.

## F. Mechanical acceptance checks and false-green risks

1. **Freshness scope check**

   Assert every page has one source-scan element with `data-checked-sha` and `data-scope="tracked-entries"`, and that prohibited broad copy such as `Fresh` or `No recorded stale entries` is absent.

   False-green risk: the UI can accurately describe an incomplete detector; exact-path ledger matching may still miss renames, generated dependencies, or untracked evidence.

2. **Status-domain check**

   Assert every badge declares exactly one domain: `survey-depth`, `finding-resolution`, `severity`, or `evidence-quality`; verify allowed labels per domain and require an accessible description that is not title-only.

   False-green risk: correct markup cannot prove the upstream record was assigned the right semantic state.

3. **Finding custody check**

   For every finding row in the database, assert exactly one aggregate `<article data-finding-id>`, one durable marker, one stable anchor, one subsystem link, resolution text, symptom, root cause, ref SHA, and evidence route.

   False-green risk: presence and one-to-one correspondence do not prove that the prose or evidence itself is correct.

4. **Overview reconciliation check**

   Recompute action-required, verification-pending, open-decision, contradiction, and tracked-staleness counts from the database and compare them with the rendered overview. If a session is active, require the active-run caveat before the action queue.

   False-green risk: counts can reconcile while the editorial priority function orders the wrong work first.

5. **Keyboard and responsive check**

   In a headless browser, tab through skip link, search, navigation, filters, disclosures, and finding actions; verify visible focus, mobile menu focus return, Escape closure with `aria-expanded=false`, no background focus while open, and no viewport-wide horizontal overflow at narrow widths.

   False-green risk: scripted keyboard traversal and automated accessibility rules do not reproduce screen-reader interpretation or real comprehension.

6. **Epistemic zero-state check**

   Require every empty evidence surface to render a machine-readable basis such as `data-zero-basis="evaluated-none"` or `data-zero-basis="not-evaluated"`. Fail if a bare “none recorded” message appears without basis, checked revision, and scope.

   False-green risk: this only becomes meaningful if the upstream workflow records evaluation custody honestly; an empty database mislabeled as evaluated would still pass.
