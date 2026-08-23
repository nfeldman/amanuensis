# Shortlist and explicit rejections

**Decision date: 2026-08-22.** Source IDs resolve through [`sources.md`](sources.md). Direct `file://` use is preferred, not mandatory.

## Recommendation

Keep Amanuensis’s Python model → deterministic projection → independent read-back architecture, and evolve the HTML projection into a **platform-first, progressively enhanced multi-page report**. Do not migrate the primary shell to a JavaScript UI framework or a new static-site generator now.

This is not a vote for leaving the current renderer untouched. The baseline identifies concrete changes:

1. **Emit shared, content-hashed local CSS and classic JS assets for the folder profile.** CSS plus scripts are repeated across every page today; this removes most of that repetition while preserving direct-file use (C003–C005).
2. **Keep all primary content, status, tables, and navigation usable before JavaScript.** Fix narrow-screen navigation so a no-JS reader can reach the page index, and make Escape/focus/`aria-expanded` state an executed browser contract (C002, C006; S025).
3. **Separate distribution profiles.**
   - Default durable folder: relative `.html` links, local shared assets, direct-file preferred.
   - Optional single-file export: inline the exact local assets and only the selected report/page set.
   - Optional served-enhanced annex: module/Wasm/data exploration behind a tiny local static server.
4. **Keep template and behavior boundaries boring.** Use named Python render functions/templates, CSS custom properties, native controls, and short event handlers. Avoid client state for facts already known during generation.
5. **Preserve and extend output validation.** Keep state/coverage/content read-back and link traversal; add a modern HTML validator and the browser/a11y gates in NT-02 (S004, S005, S013, S043).
6. **Reduce navigation blast radius by information architecture, not client rendering.** Keep a complete index/search surface, but consider section-local navigation and breadcrumbs on detail pages instead of repeating the entire topology everywhere. Measure the result against TR-02 before adopting it.
7. **Treat registries as reviewed source imports.** If Amanuensis ever consumes one, capture the exact payload and license, allowlist paths/declarations, pin package inputs, require a clean diff, retain a provenance header/manifest, and run output-level semantic/a11y gates. Do not give an agent blanket overwrite authority (C023; S047, S063–S065).

Why this wins: it retains the current system’s strongest unusual property—validated projections—while fixing measured byte and progressive-enhancement costs. It also minimizes the vocabulary and generated-runtime state that both an AI reader and a human reviewer must reconstruct.

## Shortlisted layers

### 1. Copy-owned registries for bounded application surfaces—not the report shell

The category is substantial, and TR-08 proved that copied components can participate in a platform-compatible static report **when React is restricted to build-time rendering and enhancement remains a local classic script**. That outcome came from the output architecture, not the registry: the same copied components in the client-owned arm erased the entire static document contract (C019, C022).

If a future Amanuensis annex becomes application-like, shortlist these in order for a focused trial:

- **shadcn/ui registry protocol** when schema-driven source acquisition, inspection, dry-run/diff, and an internal registry are the core need;
- **Park UI** as the strongest cross-framework comparison and a test of whether Ark/Panda state/codegen earns its much broader stack;
- **Intent UI** when a React application is already chosen and React Aria’s explicit DOM/accessibility/testing model is valuable;
- **ReUI or Kibo** only for a named complex interaction such as editable data grids, Gantt/Kanban, calendar scheduling, or advanced filters that simpler HTML/specialists cannot supply;
- **HyperUI** only as a native-markup/style recipe source to distill, not a synchronized component dependency.

For Amanuensis today, none enters the primary implementation shortlist. The current generator already owns its source, emits more direct DOM, avoids the 189.7 MB trial build/CLI tree, and has stronger projection read-back. The new category changes the option map, not C011’s decision (C025).

### 2. Native Custom Elements, fallback-first

Use a custom element only for a repeated, stateful widget with a stable contract. Prefer light DOM. Put meaningful fallback content inside the element before upgrade; never use it to own primary prose, navigation, or the only copy of a table (S021, TR-04).

Adopt Lit only if native custom-element lifecycle/rendering code becomes the larger maintenance risk. The Lit trial proved classic/IIFE, remote-free packaging is feasible, but also demonstrated the exact client-only-content failure to forbid (S020, S036, S037).

### 3. Quarto as an optional analytical or single-file export

Quarto is the strongest substantial alternative for a self-contained analytical document: prose, executable computation, dashboards, and documented one-file resource embedding (S016). Trial it as an export target that consumes frozen Amanuensis data; do not make it the source of record or discard projection read-back. NT-04 is the admission gate.

### 4. Eleventy as the external SSG fallback

If presentation authoring must leave Python, Eleventy is the lowest-conceptual-cost replacement candidate. The trial emitted complete semantic HTML, local classic JS, and working `.html` links in a 2,574-byte folder once the permalink was explicit (S035, S036). Admission still requires the full 49-page bake-off and equivalent read-back in NT-01.

### 5. Astro for a richer static component layer

Astro remains viable because local static serving is acceptable and content pre-renders. Choose it over Eleventy only when isolated interactive components, cross-framework component reuse, or a larger page-component system is an actual requirement. Its 145 MB/197-directory measured build closure and module-default script output are costs, not disqualifiers (S018, S036, S037).

### 6. Declarative visualization, then specialist data runtimes

For fixed charts, generate accessible SVG/figure output plus a textual conclusion and underlying table. Observable Plot and Vega-Lite are the leading declarative trial candidates because their specifications are compact and their output exposes title/caption/ARIA controls (S041, S042).

Only then escalate:

- **Observable Framework** for linked reactive views, polyglot build-time data loaders, or client SQL across several analytical pages. Keep it an annex until maintenance/reproducibility concerns and table semantics pass a representative trial (S014, S028, S035–S038).
- **Perspective** for user-controlled pivot/grid/chart exploration over large or streaming data (S033).
- **DuckDB-Wasm** for genuinely user-authored local SQL over data too large or variable to precompute (S034).

Every annex must retain a static summary and data table and must work without external network access once built. A tiny local server is acceptable; an online CDN is not required.

## Explicit rejections for the primary Amanuensis shell

| Rejected now | Why | What would reverse the decision |
|---|---|---|
| **React** | Substantial ecosystem, but JSX/component/state/runtime indirection solves no current report requirement. “Models know React” lacks controlled support (S026, S027, S030, S032). | A concrete application-like workflow where React-only components materially reduce total validated code, demonstrated in NT-01/NT-02. |
| **Preact** | Smaller runtime does not remove the VDOM/source-to-DOM indirection or establish a needed capability (S032). | Same reversal condition as React, with measured end-to-end advantage. |
| **Svelte** | Compiler and syntax are substantial, but current surface is a document, not a stateful application (S024). | Reports become a persistent application workspace and a representative Svelte trial beats platform/Astro on validated complexity. |
| **Qwik** | Resumability/serialized state addresses hydration startup for complex apps; it increases output opacity here and is in a v2 transition (S028, S032). | A large interactive report demonstrably suffers hydration/startup cost that islands or bounded enhancement cannot solve. |
| **htmx** | Useful capabilities require dynamic endpoints; a static server only serves files (S022). | Amanuensis becomes an intentionally live server application with fragment/mutation endpoints and retains ordinary-link fallbacks. |
| **VanJS** | Thin continuity (one recent sampled author) and a proprietary state/DOM vocabulary without a missing capability (S028, S032). | Broader maintainer continuity plus a concrete trial advantage over native DOM. |
| **Alpine CSP** | The tiny fixture needed a 69,625-byte runtime and duplicate no-JS table; `x-*` adds an implicit expression layer (S023, S036). | Multiple markup-local state machines make explicit JS objectively harder to validate, and NT-02 passes with one generated fallback source. |
| **Lit as the page shell** | Client-owned primary content fails the document contract; shadow/render boundaries reduce direct inspection (TR-04). | None for the shell. Lit remains eligible for bounded, fallback-first custom elements. |
| **Observable Framework as primary today** | Substantial data features, but health is quiet, initial build resolved `@latest`, the configured trial still needs modules/HTTP, and default Markdown table semantics were weaker (S028, S035–S038). | Full-scale bake-off passes offline local-server, lock/rebuild, semantics, accessibility, read-back, and maintenance-risk gates. |
| **Quarto as source of record** | Excellent analytical publisher, but replacing the canonical model/projection pipeline would conflate data computation, narrative authoring, and report integrity. Local trial not executed (S016). | It can consume—not replace—the frozen model and pass NT-04; this reverses only the export decision. |
| **Perspective or DuckDB-Wasm as general foundation** | Both are substantial specialists with large Wasm/data deployment surfaces. They are unjustified when generation can answer known questions (S033, S034, S042). | A named user exploration/query task fails the precomputed arm in NT-03. |
| **CDN/`latest` runtime or build resolution** | Undermines offline durability, reproducibility, and supply-chain review. The Observable exploratory build demonstrated the risk (S035, S038). | No reversal. Pin and vendor or cache verified artifacts. |
| **Client-only primary content** | A report must remain an inspectable document; the Lit reject arm showed static structure disappears (S036). | No reversal for prose, navigation, status, or sole-copy tables. |
| **shadcn/React as the primary shell** | TR-08 could preserve the report only by adding a React/Base/Tailwind/CLI build stack around a build-time static render and classic script. The 397-directory/189.7 MB installation and 197 nonblank copied/init lines solved no current limitation; the ordinary client arm failed static content (S061–S062). | A named application workflow where registry components reduce total validated code and pass NT-05 against native/Astro arms. |
| **Park UI or Intent UI for the current report** | Both are substantial peers, but add framework + headless + styling/codegen layers for controls already expressed by native HTML/CSS. No AI or accessibility outcome advantage was established (S052–S053, S060, S066). | A required non-native widget and a representative output/a11y/upgrade trial demonstrating lower total ownership cost. |
| **ReUI/Kibo catalog adoption from dashboard resemblance** | Their complex components are credible, but dashboard visuals do not prove report orientation, complete pre-JS content, local packaging, or readable generated DOM (S056, C027). | A named annex task fails precomputed HTML and specialist arms, then an item-pinned trial passes NT-03/NT-05. |
| **Unreviewed community registry or agent overwrite** | The core directory warns that third-party code must be reviewed. Registry items can add files, dependencies, config and env requirements; current tooling exposes diffs but the trial had no built-in three-way base (S046–S048, S063, S065). | No blanket reversal. Item-level captured provenance, allowlist policy, diff review, and validation are mandatory. |
| **Manual galleries as a semantic component system** | HyperUI transfers maintenance with no sync/testing protocol; copied HTML quality is item-specific. Catalyst source is paid and its license restricts redistribution as a UI library/template/builder (S054, S058). | HyperUI may supply individually audited native recipes. Catalyst may be used only in a licensed end product, not as public Amanuensis source. |
| **Copied wrapper treated as full ownership** | Chakra snippets and the surveyed registries retain package-owned headless/runtime behavior. The ownership claim is true only for the local wrapper/style layer (C020; S049–S055). | Never as wording. Record the exact ownership boundary and imported stack. |

## Decision sequence

```text
Need only reading, search, disclosure, theme, or small filters?
  -> platform-first HTML/CSS/classic JS

Need a copied component because an application-like surface already exists?
  -> pin and capture the item; inspect imports/license/declarations
  -> shadcn protocol first; Park as cross-framework comparison; Intent for React Aria
  -> pre-render primary content and run registry/output/a11y gates

Repeated bounded stateful widget?
  -> native Custom Element with fallback
  -> Lit only if native lifecycle/rendering repetition is measured

Need external presentation toolchain?
  -> Eleventy for document templates
  -> Astro only for component/island requirements

Need analytical publication or one-file computed report?
  -> Quarto export trial

Need linked reactive analysis?
  -> Observable annex trial

Need user pivoting or ad hoc SQL over genuinely large/variable data?
  -> Perspective or DuckDB-Wasm annex trial
```

The shortlist is intentionally layered. A specialist can be excellent at its job without becoming the architecture of the whole report.
