# Claim inventory

Each claim preserves the seven-field invariant. Classification is separate from evidence confidence.

## C001 — Current renderer is dependency-free at report runtime

- **what:** The inspected Amanuensis renderer emits plain HTML with embedded CSS and embedded JavaScript and no remote runtime assets; the AxiomDB example can be read from a local bundle without a web server.
- **how:** Direct implementation inspection plus static artifact scan; S002 contains zero remote asset URLs and all 64 non-fragment links on the index are local.
- **where:** S001 lines 1–8, 822–873; S002; S007.
- **when:** Renderer and artifact inspected 2026-08-22.
- **why:** Bears on web-platform alignment, dependency cost, security surface, and offline fitness.
- **confidence:** Single-source (implementation and artifact share one project origin, despite two evidence paths).
- **see-also:** C003, C004, C007.
- **classification:** Established for the inspected version.

## C002 — The current shell uses meaningful native semantics and several accessibility primitives

- **what:** The inspected index has `lang=en`, viewport metadata, skip link, `main`/`nav`/`aside`/`header`/`footer` landmarks, a labeled search input, visible-focus CSS, reduced-motion CSS, one captioned table, and scoped column headers.
- **how:** Deterministic static structure scan and direct renderer inspection.
- **where:** S001 lines 176–374 and 822–873; S007.
- **when:** 2026-08-22.
- **why:** Bears on standards alignment and accessibility baseline.
- **confidence:** Single-source.
- **see-also:** C005, C006.
- **classification:** Established as structural presence only; no runtime or conformance verdict is authorized.

## C003 — The inspected offline deliverable is a self-contained folder, not a single-file report

- **what:** The AxiomDB projection comprises 49 HTML plus 49 Markdown files in a 5,228 KiB docs folder; the HTML subset is 3,533,237 bytes and its 4,566 local links all resolve inside the bundle.
- **how:** File inventory, byte counts, and independent local-link traversal across every HTML page.
- **where:** S003; S008.
- **when:** 2026-08-22.
- **why:** Bears on the meaning of “self-contained,” offline delivery, portability, and packaging.
- **confidence:** Single-source.
- **see-also:** C001, C004, vocabulary term “self-contained.”
- **classification:** Established for this output snapshot.

## C004 — Repeated shell bytes dominate this real output

- **what:** Embedded CSS, inline scripts, and repeated navigation account for 63.7% of all HTML bytes in the 49-page AxiomDB projection; the CSS alone is repeated 49 times (757,981 bytes total).
- **how:** Mechanical extraction of each page’s `<style>`, inline `<script>`, `<nav class="rail-nav">`, and article byte lengths.
- **where:** S003; S008.
- **when:** 2026-08-22.
- **why:** Bears on single-file versus folder packaging, update cost, diff size, and whether shared static assets are worth considering.
- **confidence:** Single-source.
- **see-also:** C003, C005.
- **classification:** Established for this output snapshot; general scaling behavior remains inferred until other sites are measured.

## C005 — Global navigation makes site-wide HTML invalidation broad

- **what:** In the executed 18-page fixture, adding one subsystem produced a 19-page site and re-rendered all 19 HTML pages; removing it re-rendered all 18 remaining HTML pages. This follows from embedding the complete navigation list in every page.
- **how:** Existing end-to-end test executed on the current working tree, paired with direct inspection of `_nav()` and `_shell()`.
- **where:** S001 lines 773–873; S004; S008.
- **when:** 2026-08-22.
- **why:** Bears on incremental-build cost and maintainability at report scale.
- **confidence:** Single-source.
- **see-also:** C004.
- **classification:** Established for the current test fixture and renderer.

## C006 — Mobile cross-page navigation is JavaScript-dependent

- **what:** Below 900px the navigation rail is translated off-canvas by CSS and becomes visible only when JavaScript toggles `body.nav-open`; with JavaScript disabled the current document remains readable, but the global page index is unavailable on narrow viewports.
- **how:** Direct code-path inspection of media CSS and menu-toggle JavaScript; text-only conversion confirms current-page content remains present.
- **where:** S001 lines 344–365, 399–406, 836–871; S008.
- **when:** 2026-08-22.
- **why:** Bears on progressive enhancement and accessibility.
- **confidence:** Single-source.
- **see-also:** C002.
- **classification:** Probable pending an executed narrow-viewport, JavaScript-disabled browser trial.

## C007 — The renderer has structural projection read-back and diff-aware behavior

- **what:** The implementation hashes output, skips byte-identical pages, retires manifest-owned obsolete files, and verifies HTML and Markdown state/coverage/content correspondence. The current materializer end-to-end test passed, including red fault propagation and diff-aware cases.
- **how:** Direct code/test inspection plus execution of `materializer/test-materializer.py`.
- **where:** S001 lines 877–925; S004; S005; S008; S013.
- **when:** 2026-08-22.
- **why:** Bears on testability, maintainability, and AI-authored pipeline safety.
- **confidence:** Single-source.
- **see-also:** C005.
- **classification:** Established for the executed materializer and read-back fixtures. Update 2026-08-22: S013 supplied new evidence by executing all recorded read-back red arms successfully.

## C008 — The custom Markdown renderer deliberately trades coverage for a small auditable core

- **what:** `MarkdownRenderer` implements a limited subset (headings, fenced code, simple tables, flat lists, blockquotes, paragraphs, inline emphasis/code/links, and two Mermaid shapes) instead of depending on a general Markdown engine.
- **how:** Direct implementation inspection.
- **where:** S001 lines 484–762.
- **when:** 2026-08-22.
- **why:** Bears on AI/human code legibility, dependency cost, feature completeness, and parser security.
- **confidence:** Single-source.
- **see-also:** Open trial requirement: malformed/nested Markdown reject and accept corpus.
- **classification:** Established as architecture; whether the trade is favorable for Amanuensis is underdetermined.

## C009 — The legacy `tidy` executable is not a valid HTML5 conformance oracle here

- **what:** `/usr/bin/tidy` rejected standard HTML5 elements such as `aside`, `nav`, and `section` in S002; those diagnostics therefore cannot be used as evidence that the document is invalid.
- **how:** Negative instrument check against known-valid HTML5 element vocabulary; the tool’s own output demonstrates scope mismatch.
- **where:** S008.
- **when:** 2026-08-22.
- **why:** Prevents a false accessibility/conformance finding under catalog VP15 and BP22.
- **confidence:** Single-source.
- **see-also:** S002.
- **classification:** Refuted as an applicable validator; a modern HTML5 validator remains an open trial.

## C010 — No valid framework ranking for AI-primary report code was established

- **what:** The evidence reviewed does not establish that React, Svelte, standards-native code, or any other candidate universally yields more correct, maintainable, or legible code when an AI is the primary author and frequent reader.
- **how:** Directed search found one broad sequential web benchmark that evaluates model/task success without answering this framework decision, one early framework-comparative repository with one run per combination and a narrow app candidate set, and maintainability studies that do not compare these front-end approaches.
- **where:** S026–S031.
- **when:** Sources available and read through 2026-08-22.
- **why:** Prevents training-data familiarity, token-count anecdotes, and framework popularity from overriding measurable output and validation properties.
- **confidence:** Cross-checked for the surveyed evidence set; absence claims remain bounded by the recorded search.
- **see-also:** C011, taxonomy “What AI-primary changes.”
- **classification:** Established within survey scope; ecosystem-wide proof of absence is not claimed.

## C011 — Platform-first progressive enhancement is the best current primary architecture for Amanuensis

- **what:** Retaining the Python model/projection/read-back pipeline while evolving its output to semantic pre-rendered HTML, shared local assets, and bounded fallback-first enhancement has the best evidence-adjusted fit for the current report.
- **how:** Compared the measured baseline’s existing strengths and defects against each candidate’s source/output contract, build footprint, distribution profile, health, and missing capabilities. No candidate offsets the migration cost while preserving equivalent projection validation.
- **where:** S001–S008, S013, S025, S028–S029, S035–S043; `taxonomy.md`, `vendor-matrix.md`, `shortlist.md`.
- **when:** Decision snapshot 2026-08-22.
- **why:** Directly answers the primary architecture decision for data-rich reorientation surfaces.
- **confidence:** Probable (multi-source inference plus local trials; representative full-scale alternative builds and browser/a11y trials remain open).
- **see-also:** C004–C007, C010, C012–C016.
- **classification:** Probable recommendation, not a universal web-development rule.

## C012 — Eleventy and Astro are substantial generators but not justified replacements today

- **what:** Eleventy and Astro are healthy, capable static generators; Eleventy is the lower-conceptual-cost external fallback, while Astro becomes attractive only when component/island requirements are real. Neither presently justifies replacing the current projection pipeline.
- **how:** First-party architecture, dated health, npm metadata, installed dependency closures, and pinned output trials were compared with existing read-back/differential behavior.
- **where:** S004–S005, S013, S018–S019, S028–S029, S035–S039, S043.
- **when:** 2026-08-22.
- **why:** Separates project substance from project-specific architectural fit.
- **confidence:** Cross-checked for small-output feasibility and current health; probable for migration fitness pending NT-01.
- **see-also:** C011; `trials.md` NT-01.
- **classification:** Established as substantial; probable as “do not migrate now.”

## C013 — Quarto is the strongest optional analytical/single-file export candidate

- **what:** Among discovered document-oriented systems, Quarto most directly supports computed narrative, static dashboards, multiple analysis languages, and a documented one-HTML-file remote-dependency-free export.
- **how:** Compared first-party output/deployment/accessibility documentation and dated repository health against Amanuensis’s distribution and data-reporting requirements.
- **where:** S016–S017, S028.
- **when:** 2026-08-22.
- **why:** Identifies a substantial path for analytical publication without replacing the canonical model.
- **confidence:** Single-source for output capability plus independent health; local feasibility remains unexecuted.
- **see-also:** C011; `trials.md` NT-04.
- **classification:** Probable shortlist; not implementation-ready until NT-04.

## C014 — Observable Framework is substantial but currently a higher-risk analytical annex

- **what:** Observable Framework provides unusually strong build-time data loaders, reactive analysis, search, and client SQL, but the inspected current project has quiet maintenance, a large build graph, build-time registry resolution, weaker default table semantics in the fixture, and a local-HTTP/module distribution contract.
- **how:** Combined first-party capability docs, bounded GitHub health, npm/installed-closure measurements, clean/warm build observations, output inspection, and advisory query.
- **where:** S014–S015, S028–S029, S035–S039, S043.
- **when:** 2026-08-22.
- **why:** Determines whether its strong data-app capability should become Amanuensis’s shell or a bounded annex.
- **confidence:** Cross-checked for observed version/configuration; future maintenance and full-scale fitness remain uncertain.
- **see-also:** C010–C011, C016.
- **classification:** Established as substantial; probable as annex-only/defer-primary.

## C015 — Direct-file compatibility is a cost dimension, not the final gate

- **what:** Direct `file://` operation is preferred but not mandatory; remote-asset-free output behind a tiny local static server remains eligible.
- **how:** User clarified the requirement during the trial run; distributions are consequently recorded as Direct, Local HTTP, and Hosted/static rather than pass/fail on direct-file alone.
- **where:** `conspectus.md`, `vocabulary.md`, `notes.md`, `vendor-matrix.md`.
- **when:** Clarified 2026-08-22.
- **why:** Prevents false rejection of module-based static outputs such as Astro and Observable while preserving the portability tradeoff.
- **confidence:** Authoritative requirement clarification.
- **see-also:** S015, S040; C012, C014.
- **classification:** Established task constraint.

## C016 — Browser analytics engines belong behind a demonstrated exploration threshold

- **what:** Perspective, DuckDB-Wasm, Observable Plot, and Vega-Lite are substantial specialist options; they should not become the report foundation unless a named user exploration/query task cannot be satisfied by generation-time HTML/SVG/data summaries.
- **how:** Compared documented data/query/visualization mechanisms, asset/package topology, project health where measured, and accessibility affordances with the report’s read-mostly orientation goal.
- **where:** S028, S033–S034, S041–S042.
- **when:** 2026-08-22.
- **why:** Avoids paying Wasm/runtime/query complexity for questions already known at generation time while retaining a credible path for genuinely interactive data.
- **confidence:** Probable architectural inference; no representative large-data trial was executed.
- **see-also:** `trials.md` NT-03.
- **classification:** Probable decision boundary.

## C017 — The pinned packaging trials distinguish document preservation from client ownership

- **what:** Eleventy, Astro, and configured Observable emitted primary table content in static HTML; the Lit reject arm emitted no static table because content was created only after upgrade; Alpine preserved a duplicated `<noscript>` table. All configured outputs had zero remote assets and zero unresolved local references.
- **how:** Built pinned fixtures, scanned all HTML/assets with detector 1.0.1, red-proved remote/missing/module detection, rebuilt, and compared live output exactly with the recorded JSON.
- **where:** S035–S036, S043; `trial-inspection.json`.
- **when:** 2026-08-22.
- **why:** Tests the primary-content/progressive-enhancement contract independently of vendor claims.
- **confidence:** Single-fixture executed evidence with red proof.
- **see-also:** C011–C014.
- **classification:** Established for the feasibility fixtures; not a general accessibility or framework verdict.

## C018 — The trial detector’s first confirmation failure was an instrument defect and was not waived

- **what:** Detector 1.0.0 failed when labeling an out-of-workspace temporary red fixture. Version 1.0.1 changed only path labeling, then passed the clean accept arm, three reject arms, and exact live-snapshot comparison.
- **how:** Fault-injection execution, code-level minimal fix, version bump, and repeat.
- **where:** S043; `trials.md` “Confirmation-run incident.”
- **when:** 2026-08-22.
- **why:** Preserves failure provenance and prevents a broken validation instrument from certifying candidate output.
- **confidence:** Single-source executed evidence.
- **see-also:** S006 practice GP1/GP8/VP4/VP7/VP8/VP26.
- **classification:** Established.

## C019 — A copy-owned registry is a source-acquisition layer, not an output architecture

- **what:** Machine-readable registries such as shadcn can distribute implementation files, dependencies, CSS/configuration, hooks, pages, and other project assets, but they do not determine whether the resulting report is pre-rendered, client-owned, direct-file-capable, or accessible.
- **how:** Compared the registry schema/CLI contract with two output arms built from the same copied component source. The document arm preserved the full static report; the client-owned arm preserved none of its primary structure in authored HTML.
- **where:** S046–S047, S061–S062, S067; TR-08.
- **when:** Documentation read and trial executed 2026-08-22.
- **why:** Prevents “open code” from being mistaken for progressive enhancement, offline packaging, or platform ownership.
- **confidence:** Cross-checked mechanism plus one executed differential fixture.
- **see-also:** C011, C017, C020, C025.
- **classification:** Established as an architectural distinction; output results are fixture-scoped.

## C020 — “Own the source” usually describes only the copied layer

- **what:** The surveyed copy-owned systems commonly retain package-owned behavior and build layers: shadcn’s Base variant imports Base UI/React plus class utilities; Park imports Ark UI and Panda CSS; Intent imports React Aria and Tailwind; Chakra snippets wrap Chakra packages; Catalyst blocks depend on Headless UI.
- **how:** Followed documented installation dependencies and imports in the exact copied trial files, then contrasted them with the package-owned primitive documentation.
- **where:** S049–S058, S061–S062.
- **when:** 2026-08-22.
- **why:** Bears on AI context requirements, update responsibility, accessibility attribution, supply-chain review, and claims of abstraction removal.
- **confidence:** Cross-checked across five independent project lineages and direct trial source.
- **see-also:** C019, C021–C024.
- **classification:** Established for the surveyed systems; a pure HTML snippet can own more of its implementation but less of an upgrade/testing protocol.

## C021 — Copy ownership transfers semantic and accessibility responsibility; it does not eliminate it

- **what:** Headless primitives can supply roles, focus, keyboard behavior, and interaction mechanics, while the consumer still owns labels, visible focus, contrast, composition, table semantics, fallbacks, and testing. Copying wrappers increases the consumer’s ability to inspect or change those choices and also increases its duty to preserve them during customization and upgrades.
- **how:** Reconciled W3C native/ARIA responsibility guidance with Base UI, React Aria, Radix, Ark/Park, and Intent contracts, then statically inspected the trial’s authored scopes/label and generated DOM.
- **where:** S025, S049–S053, S062, S066.
- **when:** 2026-08-22.
- **why:** “Accessible components” is otherwise liable to become an unsupported application-level guarantee, especially under frequent AI edits.
- **confidence:** Cross-checked for responsibility split; no downstream browser/assistive-technology conformance verdict.
- **see-also:** C002, C010, C019–C020.
- **classification:** Established as a responsibility boundary; trial accessibility remains open.

## C022 — The representative copy-owned stack paired static output with a large build/context premium

- **what:** In TR-08, five copied/CLI-initialized source files measured 7,434 bytes and 197 nonblank lines, while the full installed CLI/build tree measured 397 package directories and 189,709,898 bytes. The pre-rendered artifact was 46,216 bytes and contained the complete document; the client-owned artifact was 278,244 bytes and contained no static primary structure.
- **how:** Exact-pinned installation, source grouping, full node_modules inventory, deterministic builds, static output scan, reject arm, and live-snapshot comparison.
- **where:** S061–S062, S067.
- **when:** 2026-08-22.
- **why:** Quantifies the separation among locally visible source, hidden enabling stack, and emitted runtime/output cost for the same report fixture.
- **confidence:** Single-fixture executed evidence with exact snapshot confirmation.
- **see-also:** C017, C019–C020, C025.
- **classification:** Established for this installation and fixture; not a general productivity or typical-size ranking.

## C023 — Current registry tooling makes drift visible but leaves upgrade integration and provenance state to the adopter

- **what:** The pinned shadcn CLI exposed a deliberate local edit with `--diff` and supplied view/dry-run controls, but the initialized project retained no per-component upstream version or three-way base; the survey had to capture mutable registry payloads and hashes separately. Official guidance accordingly treats third-party registries as code dependencies and recommends inspection and immutable GitHub refs.
- **how:** Inserted a one-line local customization, executed the current-upstream diff without overwrite, inspected generated project state, froze payload hashes, and red-proved a declared-payload policy.
- **where:** S047, S061, S063, S065, S067.
- **when:** 2026-08-22.
- **why:** Bears on long-lived AI customization, repeatable upgrades, supply-chain trust, and the difference between visible drift and merge-safe updates.
- **confidence:** Executed for shadcn 4.19.0 plus first-party guidance; other registries may implement stronger version state.
- **see-also:** C020, C024–C025.
- **classification:** Established for the trial; probable as a category risk, not a universal absence claim.

## C024 — The copy-owned landscape contains substantial peers and meaningful variants, not one universal winner

- **what:** shadcn provides the most developed general registry protocol/tooling in the surveyed set; Park is the strongest cross-framework registry peer; Intent is an accessibility-oriented React Aria variant; ReUI and Kibo add complex dashboard/data compositions; HyperUI is a native-markup gallery; Chakra snippets are a thin copied wrapper over package primitives; Catalyst is a substantial commercial source-delivery variant with redistribution limits.
- **how:** Discovered projects from first-party directories/repositories, classified distribution and enabling stacks, checked dated repository/package metadata and licenses, and separated capability claims from vendor accessibility/AI marketing.
- **where:** S048, S052–S060; `taxonomy.md`; `vendor-matrix.md`.
- **when:** Decision snapshot 2026-08-22.
- **why:** Prevents shadcn’s visibility from collapsing distinct architectures into one category or turning derivatives into independent evidence.
- **confidence:** Cross-checked for documented architecture, current metadata, and license; no comparative production benchmark was executed.
- **see-also:** C019–C023, C027.
- **classification:** Probable taxonomy and shortlist disposition; project capabilities are established where directly documented.

## C025 — Copy-owned registries do not revise Amanuensis’s primary architecture recommendation

- **what:** C011 remains the recommendation: keep the Python model/projection/read-back pipeline and platform-first pre-rendered report. Copy-owned registries become a conditional application-surface/reference-source layer, not the primary shell, because their strongest benefits address component acquisition and customization while Amanuensis’s load-bearing needs are durable documents, validated projections, low runtime cost, and restrained interaction.
- **how:** Challenged C011 with the strongest category candidates and a pinned successful pre-rendered registry arm, then compared its added source/build/provenance obligations with the current generator and the smaller TR-04 document fixture.
- **where:** C011, S001–S008, S013, S061–S067; `shortlist.md`.
- **when:** Revision review 2026-08-22.
- **why:** Records preservation of a prior conclusion explicitly rather than silently omitting the new category.
- **confidence:** Probable multi-source inference; a future application-like Amanuensis surface can trigger the reversal trial in `shortlist.md`.
- **see-also:** C019–C024, C027.
- **classification:** Prior conclusion preserved; scope expanded, recommendation unchanged.

## C026 — Current AI-UI evidence strengthens validation requirements but does not establish a registry advantage

- **what:** Recent UI-generation research reports framework-syntax/component-reuse difficulty and accessibility failures, but the reviewed studies do not compare copy-owned registries with package components or native templates for repository-scale AI authorship and maintenance.
- **how:** Directed primary-research search reviewed DesignBench, ComUICoder, and A11YN alongside the earlier benchmark/maintenance evidence in C010.
- **where:** S026–S031, S066.
- **when:** Sources available and read through 2026-08-22.
- **why:** Prevents vendor “AI-ready,” MCP, skill, or copyability claims from becoming a net-maintainability ranking without a controlled task.
- **confidence:** Cross-checked within the recorded evidence set; ecosystem-wide proof of absence is not claimed.
- **see-also:** C010, C021–C025.
- **classification:** Established within survey scope; the valid positive inference is to strengthen compile, DOM, accessibility, and differential gates.

## C027 — Complex copied registries are credible for application-like data surfaces but not automatically for reports

- **what:** ReUI and Kibo contain real data-grid, calendar, Gantt, Kanban, filtering, and other dashboard-oriented components, making the category substantial for application surfaces. Their component and headless-library depth does not by itself satisfy report orientation, complete pre-JS content, static fallback, offline bundle, or output read-back.
- **how:** Inspected project architecture/catalog claims and compared the described capabilities with Amanuensis’s measured report contract and specialist-annex decision boundary.
- **where:** S001–S008, S056, S060; C016, C019–C025.
- **when:** 2026-08-22.
- **why:** Separates a strong task-specific component catalog from fitness as a durable reorientation surface.
- **confidence:** Probable; no complex community-registry item was installed or browser-tested.
- **see-also:** C016, C024–C025; `trials.md` NT-03 and NT-05.
- **classification:** Substantial capability, conditional application/annex fit, reject as automatic primary shell.
