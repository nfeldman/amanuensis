## A) First 60-second impression — observed facts

Constraint: this is a source/markup critique; I inspected the generated HTML/CSS/JS directly rather than a browser-rendered `file://` page.

1. The report already has a distinctive editorial voice: paper-like surfaces, serif display type, muted teal/ochre signals, double rules, and a fixed “atlas” rail. It feels calmer and more serious than a generic SaaS dashboard, and that identity should survive. [`html_projection.py:111`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:111), [`html_projection.py:198`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:198), [`html_projection.py:248`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:248)

2. Orientation is present but not editorially decisive. The overview leads with provenance, a six-row state table, a ten-link navigation list, then latest-session metadata. It says what exists, but not “here is the most consequential thing to understand or do now.” [`index.html:298`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html:298), [`index.html:314`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html:314), [`index.html:318`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html:318)

3. The global rail is useful but indiscriminate: every orientation, evidence, working-record, reference, and all 34 subsystem links are expanded together in a fixed 18.5rem column. Search filters page labels and hints only, not findings or record contents. [`index.html:287`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html:287), [`html_projection.py:408`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:408), [`html_projection.py:773`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:773)

4. The highest-value evidence is placed in the least readable form. Findings are six-column tables whose “Symptom” and “Root cause” cells contain dossier-length prose; the generic renderer wraps tables in horizontal scrolling rather than choosing a finding-specific structure. [`findings.html:309`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/findings.html:309), [`findings.html:315`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/findings.html:315), [`renderers.py:467`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/renderers.py:467), [`html_projection.py:693`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:693)

5. “Architecture at a glance” currently opens with a placeholder, then exposes raw Mermaid source for the subsystem graph. The HTML parser only converts Mermaid when it recognizes edges; otherwise it deliberately emits “Diagram source.” The page’s promise and its delivered visual are therefore far apart. [`architecture.html:298`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/architecture.html:298), [`architecture.html:310`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/architecture.html:310), [`architecture.html:315`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/architecture.html:315), [`html_projection.py:586`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:586)

## B) Preferred redesign direction — inference and proposal

### “The Evidence Fieldbook”

Treat the report as an annotated engineering fieldbook: a continuous, authoritative reading surface with plates, marginalia, and trails—not a grid of interchangeable cards.

- Preserve the paper/ink palette, serif/mono typography, square geometry, rules, and restrained status colors. These are already memorable and appropriately sober.
- Replace the always-expanded atlas rail with three task entrances—**Orient**, **Trace**, **Decide**—plus a layer-collapsed subsystem index. Show a page-local contents trail beside long records.
- Make the overview begin with a three-sentence editorial précis: what the system is, what the survey now establishes, and what most deserves attention. Follow with one “attention line” for the highest-impact finding or unanswered decision.
- Render metrics as a compact ledger sentence or ruled strip, not metric cards: “34/34 mapped · 15 open defects · 1 critical · 0 stale.” Each term links to its evidence surface.
- Turn each finding into a horizontal dossier: severity/ID in the margin; symptom as the headline; causal mechanism as a numbered trace; reachability, evidence custody, and resolution state in a narrow annotation column. Avoid a card border around every record.
- Reorder subsystem pages around reader intent: load-bearing invariant → findings → seams/dependencies → jump-in files → dispositions → structural inventory → survey history. The current file ledger arrives before findings and concern conclusions. [`w01…html:322`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/subsystems/w01-graph-write-coordinator-and-write-fence.html:322)
- Make architecture a real hyperlinked plate: layer bands, directional flows, and seam lines. Focus or selecting a subsystem should emphasize its immediate neighborhood while retaining a complete accessible relation list.
- Put provenance in a consistent marginal gutter: SHA, source locations, evidence quality, linchpin status, and copied anchor. Definitions must open on focus/click, not depend on `title` tooltips.
- Add one reversible **Scan / Read** control. Scan mode shows headlines, statuses, and causal summaries; Read mode exposes the full evidence unchanged. Deep links must land with the relevant record expanded.
- Use memorable motion sparingly: an ink line may trace a seam on hover/focus, but no ambient animation. Preserve the existing reduced-motion behavior. [`html_projection.py:363`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:363)

## C) Deliberately different alternatives

### Alternate 1: “Operations Control Room”

A dark, dense cockpit with metric tiles, filters, severity queues, trend charts, and live-looking alert states.

Why reject it: it would make orientation fast, but falsely frame a derived evidence register as real-time telemetry. Card repetition would flatten the distinction between a confirmed defect, a methodological caveat, and a decision requiring human judgment. It would also discard the strongest existing quality: calm editorial authority.

### Alternate 2: “Dependency Observatory”

A graph-first, zoomable spatial canvas where every page is reached through the architecture map and evidence appears in floating inspectors.

Why reject it as the primary direction: it could make relationships memorable, but 34 subsystems plus seams, findings, dispositions, and provenance will become a navigation tax. Graphs are weak at sustained reading, mobile use, printing, and screen-reader traversal. Prefer the Fieldbook, while borrowing the Observatory’s focused-neighborhood behavior for the architecture plate.

## D) Three high-value page scenarios and content order

### 1. “I just opened this unfamiliar repository. What matters?”

1. Project thesis and survey scope
2. Current source custody: branch, SHA, checked time, freshness
3. One-line state ledger
4. Most consequential confirmed finding
5. Decisions that could materially change interpretation
6. Architecture plate and critical paths
7. Recommended reading trail by role or task
8. Coverage gaps and latest activity

### 2. “I need to understand and act on V02-1.”

1. Finding ID, severity, resolution state, affected subsystem
2. Plain-language consequence
3. Reproduction/reachability conditions
4. Causal chain, numbered in execution order
5. Affected entry points and blast radius
6. Direct evidence and source locations
7. Adversarial result, linchpins, and remaining uncertainty
8. Related findings, seams, and decisions
9. Fix/verification state and durable anchor

### 3. “I’m changing W-01. What must I not break?”

1. Subsystem identity, survey depth, freshness
2. Load-bearing invariant in plain language
3. Open findings and high-consequence latent exposure
4. Scope and jump-in files
5. Incoming/outgoing seams and ordering assumptions
6. Key data flows
7. Concern dispositions summarized by outcome
8. Detailed structural inventory and file ledger
9. Adversarial notes, survey history, glossary

The existing W-01 material contains nearly all of this, but its first major object is a very long file ledger and its core invariant appears much later in survey prose. [`w01…html:310`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/subsystems/w01-graph-write-coordinator-and-write-fence.html:310), [`w01…html:322`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/subsystems/w01-graph-write-coordinator-and-write-fence.html:322), [`w01…html:383`](/Users/nfeldman/repos/axiomdb/.amanuensis/docs/subsystems/w01-graph-write-coordinator-and-write-fence.html:383)

## E) Risks, accessibility, and responsive considerations

- Reordering must not imply that omitted or collapsed evidence is weaker. Preserve every record, anchor, source hash, status, and Markdown companion.
- Color cannot carry state alone. Keep visible labels and shapes/patterns; measure contrast in both themes.
- `title` attributes are insufficient for evidence/status definitions on touch and keyboard. Use visible disclosures or `aria-describedby`.
- At mobile widths, findings must become semantic stacked dossiers rather than horizontally panned tables.
- The Browse drawer needs focus transfer, focus containment, background inertness, Escape closure, `aria-expanded` reset, and focus return. Current Escape handling only removes the class. [`html_projection.py:399`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:399)
- Quiet buttons need at least 44×44 CSS-pixel touch targets; the current compact padding is unlikely to meet that. [`html_projection.py:241`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:241)
- Search should announce result count and expose result type—page, subsystem, finding, concern—not merely hide navigation rows.
- Print styles should break between evidence records, not attempt to keep entire long sections or tables together. [`html_projection.py:367`](/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py:367)
- Preserve dependency-free and `file://` operation; the design should not require a graph library, webfont, or server-side search.

## F) Acceptance checks that can turn RED

1. At 375×667, V02-1’s ID, severity, status, consequence, symptom, and root-cause headings are readable in DOM order without horizontally scrolling any table region.
2. Keyboard opening of **Browse** moves focus into the drawer; Tab stays within it; Escape closes it, sets `aria-expanded="false"`, and returns focus to the trigger.
3. `Cmd/Ctrl+K`, then typing `V02-1`, yields a typed “Finding” result; Enter navigates directly to `findings.html#v02-1`.
4. The canonical architecture page contains no “Diagram source” fallback for the subsystem dependency graph; every subsystem and every rendered edge also appears in an accessible textual relation list.
5. Every finding is represented by a separately named semantic record—such as `<article aria-labelledby>`—with distinct fields for symptom, cause, reachability, evidence, and resolution; a six-column findings table fails the check.

## Open questions

- Is the report primarily for periodic reading and change preparation, or must it also support operational monitoring?
- Should “Decisions needed” merely explain how to resolve questions elsewhere, or eventually support answering within the projection?
- Is the 34-subsystem AxiomDB report representative of expected scale, or should the navigation be tested against materially larger surveys?
- Is the absence of dependency edges in the generated subsystem graph missing data, or a renderer limitation that should itself be surfaced explicitly?
