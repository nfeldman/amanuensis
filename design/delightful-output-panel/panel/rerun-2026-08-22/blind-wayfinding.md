# Blind wayfinding critique

I inspected the generated HTML/CSS/JS directly; `file://` browser execution was not available here, so responsive and keyboard findings are code-derived rather than browser-run.

## Observed facts

### A. Navigation model: successes and failure modes

- The projection creates one fully repeated, grouped global navigation rail from the page plan: Orientation, Evidence, Working record, Reference, Subsystems, and evidence matrices. Its implementation emits every planned page into the rail; the current page gets `aria-current="page"`. [`core.py:251`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/core.py:251) [`html_projection.py:773`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:773)

  - Success: a reader can always escape a deep subsystem page to global landmarks, and current-page identity is programmatic.
  - Failure: the real AxiomDB rail contains 49 links, including the whole subsystem registry, before the document; this is an index presented as persistent navigation rather than a task-oriented workspace. [`index.html:279`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html:279)

- Search is a client-side substring filter over each page’s label, ID, hint, and status; ⌘/Ctrl+K focuses it. It neither searches page content nor ranks results nor exposes task/work-item records. [`html_projection.py:785`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:785) [`html_projection.py:408`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:408)

  - Success: known subsystem IDs and names are quick to reach.
  - Failure: “find the claim about AppendLag,” “what changed,” or “what should I do next?” cannot be answered unless those terms happen to appear in a page label or hint.

- Every page exposes a consistent location/snapshot header: group or subsystem ID, title, branch, checked SHA, timestamp, freshness, and (for subsystem pages) survey depth. [`html_projection.py:765`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:765) [`html_projection.py:853`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:853) The AxiomDB overview additionally gives counts and an active-session sentence. [`index.html:296`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html:296) [`index.html:315`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html:315) [`index.html:323`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html:323)

  - Success: “where am I?” and “which revision is this?” are answerable on every page.
  - Failure: no page distinguishes *changed since my last visit* from the current snapshot, and the overview’s aggregate counts do not turn into an ordered next-work queue.

- The subsystem map is a credible atlas: it groups subsystems by layer and exposes priority, status, scope, jump-in reading, and finding count. [`master-plan.html:297`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/master-plan.html:297) The materializer explicitly orders subsystems by layer then priority. [`renderers.py:232`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/renderers.py:232)

  - Success: a reader choosing a subsystem can orient to code scope and starting files.
  - Failure: it optimizes registry lookup, not interruption recovery. “Priority 1” is visible only after reaching the applicable layer/table, rather than being an actionable global queue.

- The findings page groups claims by severity and links each claim to its subsystem. [`findings.html:309`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/findings.html:309)

  - Success: impact-first review is supported.
  - Failure: severity, open/closed disposition, evidence freshness, and owner/next action are not represented as separate, navigable dimensions.

- Evidence/proof has real substrate support. HTML is generated from post-cross-reference Markdown; the materializer verifies the reading surface, and the read-back tests turn red independently for missing HTML finding markers and broken HTML routes. [`core.py:161`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/core.py:161) [`test-readback.py:134`](/Users/nfeldman/repos/amanuensis/materializer/test-readback.py:134) [`test-readback.py:151`](/Users/nfeldman/repos/amanuensis/materializer/test-readback.py:151)

  - Success: “is this projection internally faithful and linked?” has a strong, testable answer.
  - Failure: the UI only says it was “verified after cross-link resolution”; it does not provide a reader-facing proof path from a recommendation to its source records, test/run receipt, and relevant SHA. [`html_projection.py:867`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:867)

- Keyboard fundamentals exist: a skip link, visible focus styling, semantic `nav`, `aria-current`, and keyboard search. [`html_projection.py:188`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:188) [`html_projection.py:192`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:192) [`html_projection.py:834`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:834)

  - Failure: below 900px the rail is merely translated off-screen, not made inert/hidden; its many links remain in DOM tab order. Escape removes `nav-open` but does not reset the Browse button’s `aria-expanded` value or restore focus. [`html_projection.py:344`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:344) [`html_projection.py:399`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:399)

- The architecture page illustrates the gap between map and navigation: the dependency graph is currently exposed as raw diagram source, while the seam graph is rendered as linked relationship records. [`architecture.html:313`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/architecture.html:313) [`architecture.html:392`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/architecture.html:392)

- There is a concrete state contradiction: W-01’s persistent snapshot declares its survey depth “Mapped,” while the page’s own survey notes say “structural (Phase 2 complete).” [`w01-graph-write-coordinator-and-write-fence.html:297`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/subsystems/w01-graph-write-coordinator-and-write-fence.html:297) [`w01-graph-write-coordinator-and-write-fence.html:351`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/subsystems/w01-graph-write-coordinator-and-write-fence.html:351) This makes the visible state model unsafe as a resumption cue.

- Existing tests prove generated-page presence, selected links, table markup, incremental behavior, and read-back integrity, but do not exercise keyboard order, responsive drawer semantics, content search, prioritization, or interruption recovery. [`test-materializer.py:189`](/Users/nfeldman/repos/amanuensis/materializer/test-materializer.py:189) [`test-materializer.py:202`](/Users/nfeldman/repos/amanuensis/materializer/test-materializer.py:202)

## Inferences

### B. Three competing IA directions

1. **Work queue / survey cockpit**

   Primary job: resume an interrupted survey: what changed, what is risky, what is blocked, what action has the best next value, and how to verify it.

   Primary objects are work items and decisions; subsystems become context. This is strongest for active maintainers, weakest for passive codebase exploration.

2. **Codebase atlas / object-first workspace**

   Primary job: enter an unfamiliar subsystem, locate its boundary, adjacent systems, jump-in files, current knowledge, and evidence.

   Primary objects are subsystem dossiers, code locations, seams, and dependency paths. This best preserves architectural comprehension, but can bury urgent or unfinished work.

3. **Evidence casefile / claim-first review**

   Primary job: assess whether a conclusion deserves trust: claim, severity, competing explanations, source anchors, test evidence, resolution, and history.

   Primary objects are findings, concerns, contradictions, and proof receipts. This is best for review/audit, but makes “where should I explore?” subordinate to an already-known claim.

### C. Provisional choice: work queue / survey cockpit

The stated five questions privilege resumption and accountable action over browsing, so choose the cockpit direction provisionally. Keep the atlas and casefile as first-class routes, not as competing homepages.

**Page taxonomy**

- **Resume** — personal/current-session reorientation: current revision, change summary, resumed item, blockers, suggested next action.
- **Work queue** — actionable records: open findings, stale records, unresolved contradictions, open field notes, pending verification, decisions needed; sortable/filterable by impact, dependency, and age.
- **Atlas** — subsystem registry, layer map, dependency/seam traversal, and jump-in code locations.
- **Dossier** — one subsystem’s current state, boundaries, active work, findings, proof, history, and adjacent systems.
- **Casefile** — one claim/decision/contradiction with evidence and resolution history.
- **Proof/verification** — projection receipt, source revision, read-back result, test/run evidence, and links to raw durable records.
- **Reference** — glossary, method, onboarding, and checklist.

**Persistent global navigation**

`Resume · Work queue · Atlas · Casefiles · Proof · Reference`, plus universal search.

Global navigation should contain no complete subsystem list. Search results should be categorized (subsystem, finding, concern, file, evidence) and include a result’s state and next action.

**Local navigation**

Within a dossier: `Overview · Open work · Scope/files · Findings · Evidence · Seams/dependencies · History`.

Within a casefile: `Claim · Evidence · Competing explanations · Resolution · Related work · Proof receipt`.

Each local header should state: object identity, canonical revision, source freshness, survey depth, and action state—separately.

**Task-state model**

Do not reuse a single “status” field. Maintain separately:

| Dimension | Examples | Answers |
|---|---|---|
| Source alignment | current, stale, unknown | “Does this reflect the selected revision?” |
| Survey depth | unmapped, structural, concern-reviewed, adversarially reviewed | “How much has been established?” |
| Claim disposition | candidate, confirmed defect, accepted behavior, ruled out, fixed pending verification, verified fixed | “What is believed?” |
| Action state | untriaged, investigating, blocked, awaiting decision, ready to verify, completed | “What should happen next?” |
| Proof state | source-linked, test-observed, independently verified, receipt failed | “How can I substantiate it?” |

Only canonical structured records may populate the shared header/nav state. Freeform notes may explain state but cannot silently override it; a disagreement becomes an explicit conflict record.

**Reorientation flow**

1. On opening **Resume**, show “You are at revision X; since your last visit Y changed.”
2. Surface only the top actionable items: blocked/awaiting-decision, critical/high unverified, source-stale, then planned continuation.
3. Choosing an item opens its dossier/casefile with a compact context strip: subsystem, adjacent seam, current task state, and why this is next.
4. The primary action is explicit—e.g. “inspect evidence,” “run verification,” “resolve decision”—not merely “read this page.”
5. Completing/deferring the action records a state transition and refreshes Resume.
6. “Prove it” opens the exact evidence chain and the projection/test receipt at the same revision.

### D. Conflicts and tradeoffs

- A cockpit can over-direct a reader toward the current survey agenda; the atlas must remain independently useful for exploratory architecture work.
- Global search across durable content requires indexing and result governance; label-only filtering is simple and offline-safe but cannot answer investigative queries.
- Separating status dimensions prevents misleading compression, but increases visible complexity. The UI must present a compact summary without reintroducing a false single status.
- Persisting “last visit” enables interruption recovery but introduces local-state/privacy and shared-machine questions. A session-recorded resume pointer is more auditable but may be stale or multi-user-conflicted.
- A proof route improves accountability but can slow ordinary reading. It should be a stable secondary route, with an explicit “why this recommendation” link from every queue item.
- Making mobile navigation modal/inert fixes keyboard order but requires careful focus handling and changes the current no-JS degradation behavior.

## Open questions

- Is the principal user an active survey operator, a code reviewer, or a new engineer learning the system? The chosen cockpit should be reconsidered if passive onboarding dominates.
- What events count as “changed”: repository SHA, survey-record mutation, rendered content diff, evidence/test result, or only task-state transition?
- Is task ownership/assignee part of the durable model, or must “next” remain recommendation-only?
- Can source files and test receipts be linked as stable local/remote artifacts, rather than only named in prose?
- Should persistent resume state be per-browser, per-user in durable storage, or explicitly per survey session?

## E. Acceptance checks

1. **Canonical state consistency**  
   Generate a dossier with survey depth `structural`; assert header, global/atlas badges, filter metadata, and local overview all expose `structural`.  
   Reject: a fixture like W-01 renders “Mapped” in the header and “structural” in the dossier text without an explicit conflict record.

2. **Interrupt-and-resume answerability**  
   Seed a changed SHA, one stale record, one high-priority verification task, and one blocked decision; open Resume. In the initial viewport and with no search, it must identify current revision, changes, the next action, blocker, and a proof link.  
   Reject: a reader must visit Index, Findings, Field notes, and a subsystem page to assemble those answers.

3. **Universal content search**  
   Index subsystem names/IDs, finding IDs, claim text, source paths, concerns, and evidence labels. Searching `AppendLag` returns the relevant W-01 casefile/dossier with result type and state.  
   Reject: a term occurring in a finding/dossier but absent from page labels and hints produces “No matching page.”

4. **Keyboard and mobile navigation**  
   At a ≤900px viewport, with Browse closed, Tab must not enter rail links; opening Browse moves focus into the drawer, Escape closes it, restores focus to Browse, and sets `aria-expanded="false"`. Ctrl/⌘K must focus universal search from any page.  
   Reject: a keyboard user tabs through off-screen rail links or Escape leaves `aria-expanded="true"`.

5. **Dimension separation and filtering**  
   With a mapped-but-stale subsystem containing an open confirmed defect awaiting verification, its dossier and queue must expose all four independently and filters must return it for each relevant dimension.  
   Reject: “mapped” suppresses the stale/action warning, or marking a record stale changes its survey depth.

6. **Reader-verifiable recommendation**  
   For every queue item, “Why this next?” opens a casefile with source revision, claim/disposition, evidence links, applicable test or read-back receipt, and a machine-checkable route-integrity result. Corrupting the finding marker or its HTML target must fail the verification result.  
   Reject: the item only links to prose or a subsystem page and still presents itself as verified after the receipt is broken.
