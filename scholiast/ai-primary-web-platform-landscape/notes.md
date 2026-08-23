# Research notes and search record

## Calibrated concern protocol

The following territories materially threaten this question:

1. **Provenance collapse (T1), high:** vendor documentation can establish an API but not accessibility, maintainability, or production fitness. Capability cells require measured/marketed tags and direct repository evidence.
2. **Survivorship and selection (T2), high:** familiar frameworks and high-star projects dominate search. Discovery must include standards-native patterns, document/report systems, build-time generators, Web Components, hypermedia, fine-grained reactivity, and intentionally minimal libraries—not only top SPA frameworks.
3. **Temporal conflation (T3), high:** browser support, project health, licensing, and framework architecture move quickly. Every matrix is dated 2026-08-22; compatibility and health require current primary sources.
4. **False consensus (T4), medium:** “the industry uses React” does not answer the reporting/offline question. Search for critiques, explicit non-goals, and project-specific constraints.
5. **Scope misapplication (T5), very high:** app-framework evidence may not transfer to read-mostly reports; benchmark/demo success may not transfer to 49-page, data-rich outputs. Every recommendation must state its target surface.
6. **Definition instability (T6), very high:** AI-primary, web platform, vanilla, lightweight, static, self-contained, and accessible are unstable; tracked in `vocabulary.md`.
7. **Motivated source structure (T7), high:** nearly all framework capability evidence is first-party. Marketed claims cap at Grey; license and health come from repository artifacts/APIs.
8. **Anecdote promotion (T8), medium:** Amanuensis is one demanding case; its measured baseline establishes local constraints but not ecosystem prevalence.
9. **Counterevidence invisibility (T9), high:** explicit searches will target project abandonment, relicense history, accessibility limitations, security advisories, `file://`/CSP/offline constraints, and failed or missing maintenance signals.
10. **Missing mechanism (T10), high:** claims that an approach is “AI-friendly” need a mechanism and a discriminating trial (e.g. source locality, generated-code ratio, inspectable DOM, edit blast radius), not sentiment.

## Practice Catalog v2.10 application

- Rubric frozen for this survey; no amendments during the run (freeze discipline).
- GP1/GP8: verify before applying; structural checks attest form, not truth.
- GP3/GP6: load-bearing synthesis will receive a blind refutation pass if a clean independent context can be created; refute, do not presume.
- GP11/GP12: every claim retains provenance and observation/inference/open status.
- GP20/GP23: every gap leaves with a destination in `trials.md` or an explicit deferral.
- GP28/GP36: generated matrix summaries will be checked against their cells; expected trial diffs will be written before execution.
- VP1–VP3: at least one surface-identical failure/null arm for the selected implementation pattern.
- VP4/VP7/VP8: gates must turn red and use both accept and reject controls.
- VP5: repeat timings where timing is load-bearing; report least count and avoid equivalence language from one run.
- VP6: never pool unlike candidate classes.
- VP9/VP10: compare against the current renderer baseline on the same fixture and verify the baseline independently.
- VP12: operationalize “substantial,” “thin,” “unreliable,” “AI-legible,” and “offline-fit” before scoring.
- VP15: clear validator scope before accepting negative findings; the legacy `tidy` rejection has already demonstrated this need.
- VP19/VP20: execute final gates from a clean export if practical and re-read every delivered artifact.
- VP21: report red-proof coverage across the trial gate population.
- VP23: list the uncovered fields of every differential trial.
- VP26: detector versions remain separate from output schemas (`baseline-inspection.py` / JSON).

## Baseline search record

- Read current renderer implementation, renderer end-to-end tests, and projection read-back fault-injection tests.
- Parsed the named AxiomDB `index.html` with detector 1.0.0.
- Inventoried the complete sibling docs bundle because “self-contained” is a bundle-level property.
- Traversed all local HTML links; 4,566 targets checked, 0 unresolved.
- Executed `materializer/test-materializer.py`; it passed all current assertions.
- Rejected `/usr/bin/tidy` as a conformance instrument after it failed on standard HTML5 landmark elements; retained the negative result as claim C009.
- Converted the index through Pandoc’s HTML reader to inspect text-only reading order; content and table text remained present without executing JavaScript.

## Landscape map before deep search

Expected discourse homes and candidate families (not yet recommendations):

- WHATWG/W3C/MDN platform primitives and accessibility guidance;
- plain server-/build-rendered multi-page HTML with progressive enhancement;
- custom elements and Web Components, including declarative shadow DOM;
- hypermedia libraries and HTML-over-the-wire patterns;
- small template/tagged-template libraries and fine-grained reactive custom-element libraries;
- compiler-first UI systems whose runtime output is native DOM;
- mainstream VDOM/meta-framework ecosystems;
- data/document-oriented systems (Observable Framework, Quarto, static-site generators);
- local-first/offline packaging patterns, single-file bundlers, and browser-native data/query components;
- styling systems: handwritten CSS, design-token layers, utility CSS, and component libraries.

Structurally absent from easy web search: comparative evidence about code legibility to model readers, controlled measurements of AI-authored maintainability, negative results for `file://` report workflows, and accessibility outcomes for generated reports rather than demo components. These absences are findings only after queries are recorded; until then they are search obligations.

## Scope clarification during trials

On 2026-08-22 the user clarified that preserving direct `file://` use is preferred, not mandatory. Earlier trial design treated direct-file execution as a likely hard gate; all final dispositions must instead use three distribution profiles: direct-file, local static server without network, and hosted static. Module-based output is a portability cost, not by itself a rejection. No earlier measurement is discarded; its interpretation changes.

## Final challenge and handoff state

The load-bearing conclusion was challenged against the strongest reversal cases rather than treated as a framework preference:

- Shared assets reduce repeated bytes but do not by themselves reduce global-navigation invalidation; the recommendation therefore includes an information-architecture trial rather than claiming the asset refactor solves both defects.
- Eleventy can reproduce the small document contract with lower build cost than Astro, but no executed evidence yet shows that either replacement preserves Amanuensis read-back or improves the 49-page system. NT-01 owns that reversal path.
- Quarto has the strongest documented one-file analytical export, but the CLI was not installed and no local output was inspected. It remains a shortlist hypothesis gated by NT-04.
- Observable Framework has a capability advantage for linked reactive analysis. The recommendation is annex-only because the exact inspected version also exposed maintenance, registry-resolution, module, build-graph, and table-semantics costs; NT-01/NT-03 can reverse that disposition for a bounded surface.
- Direct-file browser execution was not performed. The browser-control instrument rejected local navigation before execution, so no candidate receives a browser pass or failure from TR-07.

An independent blind challenge was not executed because this run did not have authorization to create an independent agent/context. The substitute was a same-context refutation pass plus detector red proof and explicit reversal conditions. This is weaker than catalog GP3/GP6’s preferred blind challenge and is a disclosed limitation, not silently treated as satisfied.

The survey and copy-owned-registry extension are complete for the architecture decision. Implementation should not begin until the relevant admission trial is selected: NT-01 for a generator migration, NT-02 for any shell change, NT-03 for an analytical runtime, NT-04 for Quarto export, or NT-05 for a complex copied component.

## Original final verification record (before registry extension)

Executed after the final reread and documentation corrections on 2026-08-22:

- `verify-survey.py`: PASS — 11 required documents, 18 complete seven-field claims, 45 unique source IDs, all top-level JSON parsed, and all claim/source references resolved.
- `trial-red-proof.py`: PASS — clean accept plus remote-script, missing-reference, and module reject arms.
- `verify-trial-snapshot.py`: PASS — live trial inspection exactly matched the durable snapshot.
- `materializer/test-materializer.py`: PASS — all diff-aware behavior and injected renderer-failure reporting.
- `materializer/test-readback.py`: PASS — independent Markdown and HTML state, coverage, and content faults all turned red.
- `link-audit.py` 1.0.0: PASS with network access — 44 local references (34 unique targets) and 62 web references (61 unique targets), zero failures. The resolution audit does not validate anchor fragments or evidentiary support.

## 2026-08-22 extension: copy-owned registries

### Frozen category map before deep search

1. **Machine-readable source registries:** a CLI resolves an item manifest and writes implementation files plus declared dependencies into the consumer tree. shadcn/ui is one instance; direct peers must be discovered independently.
2. **Copy/paste galleries:** documentation exposes snippets or file sets for manual ownership, often with no upgrade protocol or machine-readable dependency graph.
3. **Hybrid copied compositions:** local wrapper/composition source remains consumer-owned but delegates behavior and semantics to package-owned headless primitives.
4. **Package-owned design systems:** conventional installed components provide a contrast arm; local code owns usage and theme, not implementation.
5. **Enabling stacks:** application framework/renderer, headless primitives, CSS compiler/tokens, class/variant utilities, icon packages, and registry CLI/protocol. These are evaluated as part of the delivered architecture rather than hidden behind “you own the code.”

### Extension-specific concern calibration

- **T1/T7, very high:** vendor galleries conflate visible source availability with ownership of the full behavioral and supply-chain stack. Every item claim must follow imports and generated configuration.
- **T2, high:** shadcn-compatible catalogs are overrepresented in search and may be derivative item sets rather than independent approaches. Discovery will classify lineage and avoid counting reskins as architectural peers.
- **T3, high:** registry schemas, Tailwind integrations, React/server-component conventions, item versions, and CLI behavior move quickly. All rows are dated; trial inputs are pinned and retained.
- **T5, very high:** app dashboard blocks may look like data-rich reporting but optimize for authenticated live applications rather than durable read-mostly documents. Static pre-rendering, no-JS content, and offline packaging remain separate gates.
- **T6, very high:** “open code,” “copy-owned,” “headless,” “accessible,” “registry,” and “design system” are unstable and now operationalized in `vocabulary.md`.
- **T9, high:** search specifically for registry overwrite/update behavior, accessibility disclaimers, license boundaries for copied code and examples, transitive advisories, remote font/icon assumptions, and dormant projects.
- **T10, high:** an AI-primary advantage must name a mechanism—local inspectable source, editable boundaries, registry metadata, or reduced API recall—and survive code/context-volume and drift costs. Marketing claims that AI can customize copied code do not establish net maintainability.

### Extension practice controls

- Preserve S001–S045 and C001–C018; append new rows and claims only.
- Write the representative-trial prediction before installation/build execution, including at least one reject arm that catches client-only primary content or an unresolved/remote asset.
- Compare the complete stack and emitted artifact against the same heading/navigation/filterable three-row table/method-disclosure contract used by TR-04.
- Record authored/copied/generated lines separately; line count is context volume, not productivity or comprehension.
- Treat a clean package advisory query as “no published match found for this lockfile at this time,” never as proof of security.
- Reconcile the extension against C011 explicitly even if the conclusion does not change.

### Extension discovery and counterevidence record

Discovery did not stop at shadcn-compatible search results. The final category map contains:

- **schema-driven registries:** shadcn/ui, Park UI, Intent UI, plus Vue/Reka and Svelte/Bits ports;
- **complex registry catalogs:** ReUI and Kibo, distinguished from reskins by their own data-grid/calendar/Gantt/Kanban/filter/tree primitives and compositions;
- **manual galleries/source delivery:** HyperUI and commercial Tailwind Plus/Catalyst;
- **hybrid copied wrappers:** Chakra CLI snippets and every copied layer that delegates to a headless package;
- **package-owned contrast:** Base UI, React Aria, Radix, Ark and Headless UI;
- **enabling style/codegen:** Tailwind, Panda, CVA, `tailwind-merge`, icon/framework/runtime packages.

The shadcn registry directory exposed broad discovery but was not counted as independent evidence: it warned that third-party source must be reviewed, and many entries share the same registry/protocol/headless lineage. Direct repositories and installation manifests determined which variants were architecturally distinct (S048, S052–S059).

Directed counterevidence found:

- shadcn’s own security guidance treats registries as third-party code dependencies and recommends inspecting files/targets/dependencies/env declarations and pinning GitHub addresses to a full SHA;
- its migration guidance says owned/customized source defeats a universal codemod, moving behavior-change interpretation to an agent/human workflow;
- Tailwind v4 changes can require overwrite/reapplication, while HyperUI explicitly offers no synchronization and transfers maintenance;
- Base UI and Radix explicitly retain author duties for labels/focus/contrast, limiting “accessible component” claims;
- Catalyst’s license permits end products but restricts redistribution as a UI library/template/builder;
- the TR-08 default preset added a local font dependency/import that the report arm deliberately removed to make offline packaging explicit;
- npm audit found a low-severity Windows development-server esbuild advisory in the exact pinned trial graph; no report runtime effect was inferred.

No disclosed malicious item or accessibility regression was executed. Those absences remain open coverage, not clean findings.

### Extension AI-evidence search

Primary-research queries targeted UI/front-end generation, component reuse, design systems/registries, maintenance, and accessibility. DesignBench compares vanilla, React, Vue and Angular over generation/edit/repair but does not test component registries; ComUICoder introduces component-aware segmentation/reuse precisely because long complex sites exhibit redundancy and inconsistency; A11YN reports that baseline generated UIs reproduce accessibility flaws and improves them using an explicit testing-engine reward (S066). No reviewed source compared copy-owned registry code with package-owned primitives or native templates for long-term AI-primary repository authorship.

This preserves C010/C026’s bounded absence finding. Vendor skills, MCP endpoints, component search, and source visibility are real affordances; no net correctness, accessibility, context-efficiency, or maintenance advantage is promoted from them.

### Extension trial challenge and handoff

The trial deliberately gave the category its strongest plausible report architecture: React components executed at build time, full static HTML, Tailwind compiled locally, and only a classic filter at runtime. It passed the document/output gate. The same component source in a normal client-owned Vite arm turned the primary-content gate red. This differential is why the result is not “React/shadcn cannot make static reports”; it is “the registry does not supply the property that Amanuensis needs.”

The strongest reversal case remains a genuinely application-like annex whose complex component behavior materially reduces total validated code. NT-05 owns that decision and requires a native/specialist baseline, captured payload/license, real upgrade merge, browser/AT gates, and output read-back. Until triggered, implementation should remain on the platform-first path.

The extension did not use an independent subagent/blind context; the original catalog limitation therefore remains. Same-context refutation, preregistered predictions, client reject arm, four registry-policy red arms, advisory review, exact rebuild, and snapshot verification are the available substitutes, not equivalent claims of independence.

### Extension final verification record

Executed after the category synthesis, claim reconciliation, and full-document reread on 2026-08-22:

- `verify-survey.py`: PASS — 12 required documents, 27 complete seven-field claims, 68 unique source IDs, all top-level JSON parsed, and every claim/source reference resolved.
- pinned registry `npm run build`: PASS — both document and client reject arms rebuilt.
- TypeScript `tsc --noEmit`: PASS; `npm ls --all`: PASS with only platform-inapplicable optional packages noted.
- `registry-policy.py`: PASS — four clean official payloads accepted; env-var, unpinned URL, unpinned GitHub ref, and path-traversal arms rejected.
- `verify-registry-trial-snapshot.py`: PASS — live detector result exactly matched the durable snapshot.
- original `trial-red-proof.py` and `verify-trial-snapshot.py`: PASS.
- current `materializer/test-materializer.py`: PASS; current `materializer/test-readback.py`: PASS.
- updated `link-audit.py`: PASS — 64 local references (46 unique targets), 118 web references (116 unique targets), zero failures; one HyperUI HTTP 403 was access-limited rather than broken.
