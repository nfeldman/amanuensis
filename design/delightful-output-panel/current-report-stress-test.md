# Current-report stress test

This stress test applies the existing Field Docket prototype and the fresh blind directions to the current AxiomDB publication. It is a structured walkthrough over real report records, not a user study or accessibility conformance result.

## Current capture

Observed directly in the generated report on 2026-08-22:

| Signal | Current generated value | Design consequence |
| --- | --- | --- |
| Survey reach | `34 / 34` subsystems mapped; `7 / 7` seams assessed | Coverage is no longer the most useful lead. “Mapped” must still not imply healthy. |
| Findings | `15` confirmed open; `1 critical`, `2 high` | The first actionable surface should reconcile and expose three high-consequence records without a wide table. |
| Working record | `21` open field notes | These are not automatically an action queue; their state and bearing must be explicit. |
| Contradictions | `0` unresolved | The empty state must state its basis; zero records is not proof that all claims agree. |
| Source scan | checked `d19ade703e3c`; `0` tracked entries marked stale | Copy must name this limited detector scope rather than globally say “fresh.” |
| Survey activity | an active recalibration session began after the displayed report timestamp | Active work is not publication delta and may not be included in the visible counts. |

## Five real-page probes

### 1. Overview: consequence is still below inventory

The overview duplicates its orientation hint, then presents a six-row count table and a ten-link directory before the active-session record. A reader can learn the publication identity but must leave the page to learn what the critical finding actually is.

**Prototype result:** Field Docket passes by placing the one-breath system model, four non-composite conditions, and `V02-1` consequence in the first reading sequence. The current `34/34` state strengthens the case for action-first rather than map-first entry.

**Required update:** replace the historical prototype's counts (`25/34`, `14`, one high) with a generated fixture before any comparative reader test. Its structure remains valid; its numeric snapshot is intentionally frozen and must not be presented as current.

### 2. Findings: the critical record cannot be scanned responsibly

`V02-1` places a long symptom and an even longer three-part causal chain inside a six-column row. Two high findings follow in the same geometry. On narrow screens the table wrapper permits horizontal panning, but that is not a readable decision surface.

**Prototype result:** the semantic casefile keeps severity, resolution, consequence, reachability, evidence, uncertainty, and next safe move in a vertical sequence. This direction survives the current report unchanged.

**Red acceptance condition:** every durable finding row maps to exactly one semantic article and stable anchor; `V02-1` is readable at 375 px without horizontal panning.

### 3. Architecture: the promised atlas has no usable plate

The runtime map is a placeholder. The subsystem dependency graph becomes a raw `Diagram source` block containing nodes but no useful rendered relationships. The seam graph later on the page is more informative than the promised primary object.

**Prototype result:** a small region atlas is useful as a coordinate, but a heroic dependency graph should not be the entrance. The production architecture view needs a linked plate only when edges exist, plus an equivalent textual relation list.

**Red acceptance condition:** no production architecture page labels raw Mermaid as the delivered diagram; every visible edge has a readable equivalent and local link.

### 4. Subsystem: structured state and embedded prose disagree

W-01's generated header says `Mapped`, while retained survey prose says `structural (Phase 2 complete)`. The likely explanation is historical prose embedded in a now-complete record, but the page does not label it as dated history. A returning reader cannot tell which state authorizes action.

**Prototype result:** separate current structured state from dated survey history, and show explicit conflict custody if they cannot be reconciled.

**Red acceptance condition:** a fixture with current `mapped` plus historical `structural` prose must either label the latter with its phase/date or render an explicit state-conflict record. Silent coexistence fails.

### 5. Mobile navigation: the drawer is visually hidden, not behaviorally closed

Below 900 px the rail is translated off-screen but remains in the document's tab order. Escape only removes `nav-open`; it does not set `aria-expanded=false`, return focus, or make the background inert.

**Prototype result:** the existing prototype has a simpler navigation model, but the production drawer behavior remains untested because local browser navigation was unavailable in this run.

**Red acceptance condition:** with Browse closed, Tab cannot reach rail links; opening transfers focus; Escape closes, resets `aria-expanded`, and returns focus; the rest of the page is inert while the drawer is open.

## What this stress test establishes

- The chosen composition is still structurally useful against the present 34/34, 15-finding report.
- It establishes neither reader performance nor WCAG conformance.
- The existing prototype is an inspectable design fixture, not a current-state dashboard.
- The highest-value next prototype is not a new color treatment; it is a current-data view-model fixture for overview, finding casefile, subsystem state/history, and report-owned re-entry.

