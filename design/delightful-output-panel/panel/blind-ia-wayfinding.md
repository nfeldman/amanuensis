# Blind first-reading memo — information architecture and wayfinding

## Discipline and reader need

My discipline is information architecture, with wayfinding as the governing concern. I privilege the reader's ability to answer five questions at every moment: **Where am I? Why am I here? What can I safely believe? Where should I go next? How do I get back?** Delight, in this kind of evidence product, is the feeling that a large and qualified record is navigable without being simplified into false certainty.

Method note: the in-app rendered browser was unavailable in this session. I inspected the generated self-contained HTML, its interaction code, its Markdown companions, and representative linked pages. Visual judgments below are therefore limited to what the document structure and CSS establish; the navigation and content observations are direct.

## Observations from the first reading

### What was easy

- The persistent rail establishes a stable global vocabulary. Human-facing names lead, IDs such as **R-04**, **W-05**, and **SM-07** remain visible, the current page is marked, and the pages are grouped into Orientation, Evidence, Working record, Reference, and Subsystems.
- The report is unusually good at stating its epistemic contract. The reader's guide explains what `unmapped`, `structural`, `adversarial`, and `mapped` authorize; evidence labels and severity are textual rather than color-only; branch, checked SHA, timestamp, and staleness recur on every page.
- The Markdown companion is genuinely one click away in both the rail and footer. Stable HTML pages, fragment links such as `findings.html#r04-1`, skip navigation, keyboard focus styles, reduced-motion handling, print rules, and useful no-JavaScript content are already present.
- A subsystem can be found by name or ID through the rail filter. Once on **R-04 — B/F incremental deletion**, its scope, layer, jump-in files, concern dispositions, finding, and related subsystem links are all present. The seam graph is a particularly good accessible projection: for example, **W-01 ↔ SM-07 ↔ W-05** is rendered as linked nodes with the shared object's meaning between them.
- The actual AxiomDB material is strong. “Visibility is metadata, not deletion,” the 16-byte `InlineMeta`, five index permutations, and atomic epoch swaps form a memorable system model. The high finding **R04-1** is concrete enough to act on: an asserted `:a rdf:type :C` does not yield `:a rdf:type :D` even when the subclass axiom exists.

### Where I lost orientation

1. **The real entrance is hidden behind the entrance.** `index.html` is the default, but it tells me only “19 / 34 mapped,” “11 findings,” and a list of destinations. It does not say what AxiomDB is. The excellent answer lives in `entry-point.html`, labeled “Where to begin” under Reference. The overview first sends a newcomer to the reader's guide; the guide then sends them to the entry point and master plan. A five-minute newcomer pays two orientation hops before learning that AxiomDB is a Rust RDF quad store.

2. **The global rail is both map and warehouse inventory.** About a dozen report-level destinations and all 34 subsystems occupy one continuous fixed rail. It is reassuring that everything has a home, but difficult to see the project shape or the few routes that matter now. On narrow screens the entire map moves behind “Browse,” so following a link also removes the visible sense of place.

3. **The overview reports counts without giving them meaning.** “19 / 34 mapped” does not say that behavioral claims about the other 15 are unauthorized. “0 unresolved contradictions” sounds globally reassuring, but the contradictions page narrowly means incompatible findings about the same code location. Meanwhile the entry point's headline claim that AxiomDB materializes OWL 2 EL inferences at write time is directly qualified by **R04-1**, which says no production path materializes ABox inferences. “No contradictory finding pairs recorded” would be honest; “no contradictions” is too broad for a first viewport.

4. **The subsystem template puts recordkeeping before consequence.** On R-04, a reader passes Scope, Jump-in reading, Notes, a six-row File ledger, and a four-row Concern dispositions table before reaching the only high finding. The page's most consequential fact—“complete, tested, and unreachable”—appears after the evidence machinery that proves it. W-05 similarly makes the reader traverse catalog detail before reaching the vivid risk that after 65,536 CLEAR/DROP operations old quads can reappear.

5. **Cross-page links provide destinations but not recovery.** The current page marker is useful, yet there is no breadcrumb, local section map, “came from,” reading trail, or task-preserving return link. Following **RC-1** from R-04 to Review coverage changes both page and conceptual level. Browser Back is the only way to recover the prior investigative thread. Deep pages also lack a persistent local table of contents, so a fragment jump can leave the reader unsure what came before or after it.

6. **Search is a rail filter, not report discovery.** It can find subsystem names, IDs, and page descriptions, but not **R04-1**, **SM-07**, `clear_generation`, `BulkFinalizeHook`, an open-question number, or a section anchor. “No matching page in this projection” is technically correct but gives no recovery or alternative query.

7. **The architecture entrance does not yet orient.** “Architecture at a glance” opens with a placeholder runtime map, followed by raw Mermaid source for a subsystem roster. That source defines status classes but no dependency edges. The first usable relationship view—the seven-seam trace—arrives later. The promised connected-system view therefore begins as absence plus implementation notation.

8. **Some route labels are visibly broken.** The reader's guide renders linked labels as NUL-wrapped ordinals such as `0`, `1`, `36`, and `41` rather than “Where to begin,” “Subsystem map,” “Decisions needed,” and “Conflicting evidence.” The footer nevertheless says cross-links were verified. The URLs may resolve, but information scent is lost exactly where a newcomer is choosing a route.

## Creative judgment: build a field atlas with a visible route

The governing metaphor should be a **field atlas**, not a document library or status dashboard. An atlas gives a stable coordinate system, shows explored and blank territory together, and lets a reader follow a route without mistaking the map for the land. Every page should expose a compact “compass line”:

> AxiomDB / Reasoning / **R-04 B/F incremental deletion** · **Mapped** — behavior, concern evidence, and adversarial challenge are available · checked at `d19ade703e3c`

The report should organize around reader intent first, evidence objects second, and publication mechanics last.

### Information architecture

1. **Start** — the project model, survey boundary, coverage interpretation, top risk, decisions needed, freshness, and four task routes.
2. **System map** — runtime boundary, nine architectural regions, 34 subsystems, and the seven seams. A text relationship list is primary; a diagram is an enhancement.
3. **Risks and decisions** — confirmed findings, unresolved assumptions/open questions, contradictory finding pairs, and competing explanations in one work-oriented hub. These remain distinct types, not a blended “health” score.
4. **Subsystems** — grouped first by architectural region (Query, Reasoning, Storage and encoding, Write path, Service, and so on), then sortable by survey depth, priority, findings, and staleness.
5. **Evidence record** — review coverage, seam assessments, field notes, and the survey log.
6. **Reference** — reader's guide, glossary, onboarding record, review checklist, and Markdown companions.

The global rail should initially show only these six landmarks plus a compact “Current route.” Expanding Subsystems reveals regions, not all 34 names at once. This is native disclosure, so the structure remains navigable without JavaScript.

### First viewport

The first viewport should answer the new engineer's entire five-minute question before offering methodology:

> **AxiomDB**  
> Rust-native RDF quad store: five embedded Fjall index permutations, SPARQL queries through Leapfrog TrieJoin + Volcano operators, and write-time OWL 2 EL materialization—**with a confirmed gap on ABox writes**.
>
> **Surveyed:** 19 of 34 subsystems. Detailed behavioral claims are available for 19; the remaining 15 have scope only or no authorized behavior claims. Checked at `d19ade703e3c`; no records are marked stale.
>
> **Most consequential open finding:** **R04-1 · High · code-verified** — production writes do not invoke incremental reasoning, so valid inferred rows can be silently absent. **Decision #10** still affects whether the remedy is wiring or correcting the published capability.
>
> **Choose a route:** Understand the system · Fix the biggest risk · Audit what is trustworthy · Resume the survey

Below that: a nine-region coverage atlas, “what changed since your last generated report” (or the honest statement that comparison data is unavailable), then the work queue. Branch/SHA/timestamp remain visible but do not displace the project definition.

### Signature moves

1. **Compass line plus recoverable trail.** Structural breadcrumbs and a sticky local section map work without JavaScript. Progressive enhancement may add a short local reading trail—`Overview → R04-1 → R-04 → TB-3`—with “return to R04-1” links. A followed link never becomes a one-way door.

2. **One jump field across object types.** `⌘K` searches pages, subsystem names/IDs, findings, seams, open questions, glossary terms, section headings, and topics. A result carries type and context: “**R04-1** · High finding · R-04 B/F incremental deletion,” “**SM-07** · seam · W-01 ↔ W-05,” or “`clear_generation` · W-05 / W05-1.” Zero results suggests nearby terms and retains the query.

3. **Evidence aperture.** A finding begins with plain-language effect, affected surface, status, evidence quality, surveyed SHA, remaining assumption, and next action. Root cause, primary files, concern history, and adversarial record open below via headings or native `<details>`. The epistemic qualifiers are never collapsed. This makes rigor progressively available instead of progressively absent.

## Content-specific page sketches

**Subsystem landing: Reasoning / R-04**

> **B/F incremental deletion** `R-04` · Mapped  
> Purpose: retract inferred facts after asserted facts are deleted.  
> **Important:** the implementation is complete and tested but has no production caller. **R04-1 · High**  
> Depends on: **W-01** per-graph serialization · Related paths: **R-03** additions, **R-05** shadow rebuild, **R-06** scheduler  
> Start in code: `reason/bf.rs` at `load_bf_state`, then backward expansion and forward recheck.  
> Sections: Finding · How it works · Dependencies · Evidence · Survey log

**Finding landing: R04-1**

> **What happens:** inserting `:a rdf:type :C` may never make `:a rdf:type :D` queryable even when `:C rdfs:subClassOf :D` is present. The client receives no warning.  
> **Why we believe it:** code-verified at three independent junctions—the incremental functions have no production caller, `on_write_commit` exits on ABox-only writes, and `BulkFinalizeHook` has no implementor.  
> **What remains unsettled:** Decision #10 asks whether this was intentional staging. That changes the recommended remedy and severity rationale, not the observed wiring gap.  
> **Next useful action:** answer Decision #10; then either wire the coordinator/bulk path or correct `architecture.md` and the published capability matrix.

**Finding landing: W05-1** should lead with the workload translation currently buried in business context: “A graph cleared once per minute can wrap its 16-bit generation in about 45 days; because old rows are never reclaimed, deleted data can become visible again.” Then show the two linked mechanisms—missing GC and `wrapping_add`—as a causal pair, not two dense table columns.

## How this direction handles the five reader tasks

1. **New engineer:** the Start viewport names the product, gives the two governing architectural ideas, interprets 19/34, and offers “Understand the system” into the region/seam map.
2. **Maintainer responding to change:** “Fix the biggest risk” opens findings sorted by consequence, with **R04-1** already exposing impact, evidence, assumption, affected subsystems, and next action.
3. **Skeptical reviewer:** “Audit what is trustworthy” shows mapped versus unauthorized territory, evidence quality, stale records, open decisions, linchpins, and contradictory *finding pairs* without converting them to a confidence score.
4. **Returning reader:** a comparison strip shows what changed, what remains open, and the latest/resumable route (“SM-07 assessment, then Q-01 onward”). When comparison data does not exist, the page says so rather than inferring activity from timestamps.
5. **Specialist:** the jump field resolves names, IDs, findings, seams, symbols, and topics. The compass line, local section map, relationship neighbors, and recoverable trail preserve place while links are followed.

## Hardest tradeoff and intentional refusal

The tradeoff is that progressive disclosure can make a rigorous record feel suspiciously simple. I accept one extra action to reach file ledgers and adversarial transcripts, but I do **not** hide status, evidence quality, SHA, assumptions, linchpins, or unresolved state. Those are part of the claim, not metadata.

I would refuse a composite trust/health score, a celebratory “56% complete” progress ring, or a single heroic dependency diagram. They compress different things—coverage, correctness, freshness, severity, and uncertainty—into an authority the survey does not possess. The atlas should make blank territory legible, make consequential routes obvious, and let every conclusion reopen into its evidence.
