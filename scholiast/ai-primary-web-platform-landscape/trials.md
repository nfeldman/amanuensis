# Discriminating trials

**As of 2026-08-22.** Source IDs resolve through [`sources.md`](sources.md). These trials apply Practice Catalog v2.10’s freeze, red-proof, differential, coverage, and limitation disciplines (S006).

## Decision gates

The current decision is not “which demo looks nicest?” A candidate must preserve these invariants:

1. primary prose, status, navigation, and tables exist in pre-rendered HTML;
2. every runtime asset can be local and every local reference resolves;
3. enhancement failure leaves a coherent reading surface;
4. generated output can be checked independently of the renderer;
5. source-to-output changes are bounded and attributable;
6. build inputs can be pinned and reproduced;
7. keyboard, narrow-viewport, reduced-motion, focus, and accessible-name behavior can turn a gate red;
8. added build/runtime machinery buys a named capability that native code does not already supply.

Direct `file://` use is preferred, not mandatory. A candidate can pass with a remote-asset-free local-static-server profile, but that cost must be explicit.

## Executed trials

### TR-01 — Measured real-report baseline

**Discriminator:** establish the current contract before comparing alternatives.

**Method and result:** detector 1.0.0 inspected the named AxiomDB index and every sibling HTML link. The bundle contained 49 HTML + 49 Markdown files; all 4,566 local links resolved. HTML totaled 3,533,237 bytes. Repeated CSS, inline scripts, and page navigation represented 63.7% of HTML bytes. Existing materializer and read-back suites passed (S003–S008, S013).

**What it rules out:** migration proposals that assume the current system is a client app, relies on remote assets, has no projection verification, or is already single-file.

**Uncovered:** browser accessibility, other project sizes, modern HTML conformance, memory use.

### TR-02 — Edit-blast-radius differential

**Prediction:** content-only edits should affect only the corresponding page(s); adding/removing a globally navigable entity should expose the cost of embedding full navigation on every page.

**Result:** in the 18-page fixture, a prose edit rendered 2/18 HTML pages; adding one subsystem rendered 19/19; removing it rendered 18/18. A no-change run rendered 0/18 (S004, S008).

**Interpretation:** hashing/diffing works, but the shell’s embedded navigation defeats locality for topology changes. Shared versioned CSS/JS assets reduce byte repetition but do not alone fix embedded-navigation invalidation.

**Uncovered:** wall-clock scaling beyond 19 pages, parallel builds, navigation alternatives.

### TR-03 — Projection red proof

**Prediction:** independent Markdown and HTML state, coverage, and content corruptions must each turn the read-back gate red.

**Result:** all recorded fault arms passed by failing when injected and accepting the clean artifact (S005, S013).

**Interpretation:** this is a major reason not to replace the current generator casually. A new renderer needs equivalent output-level gates, not only component unit tests.

**Uncovered:** semantic HTML errors, CSS/layout defects, focus and screen-reader behavior.

### TR-04 — Pinned packaging feasibility fixture

**Fixture:** the same small report idea—heading, navigation, filterable three-row status table, and method disclosure—was implemented with Eleventy, Astro, Observable Framework, Lit bundled as an IIFE, and Alpine’s CSP build. Exact sources, lockfile, and outputs are in [`trials/`](trials/) (S035).

**Pre-execution expectation for the final repeat:**

- Eleventy remains remote-free, classic-script, and direct-file-compatible after explicit `.html` permalink configuration.
- Astro pre-renders complete content but emits its authored interactive script as a module.
- Configured Observable remains remote-free only with `style: null`, `globalStylesheets: []`, and `footer: null`; it emits modules and no caption/scoped headers for the Markdown table.
- Lit’s IIFE remains remote-free/direct-file-capable, but the primary table remains absent from static HTML—an intentional reject arm.
- Alpine CSP remains remote-free/direct-file-capable, with a duplicated `<noscript>` table fallback and a comparatively large runtime.
- Rebuilding without source changes produces the same aggregate hashes in `trial-inspection.json`.

The initial exploratory builds preceded this durable prediction record, so they do **not** count as preregistered. The final repeat below is the catalog-compliant confirmation run.

**Recorded result before final repeat:**

| Candidate | Emitted files / bytes | Script contract | Remote assets / broken refs | Structural result | Distribution implication |
|---|---:|---|---|---|---|
| Eleventy | 4 / 2,574 | 1 classic external | 0 / 0 | Complete table; caption + 5 scoped headers | Direct, local HTTP, hosted |
| Astro | 2 / 2,937 | 1 inline module | 0 / 0 | Complete table; caption + 5 scoped headers | Content direct; enhancement local HTTP/hosted |
| Observable | 4 / 52,789 | 1 inline module + 3 local module assets | 0 / 0 after explicit config | Complete table, but 0 captions / 0 scoped headers; reactive result is runtime-owned | Local HTTP/hosted |
| Lit IIFE | 2 / 24,984 | 1 classic external | 0 / 0 | **Reject arm:** 0 static tables/captions/headers; table appears only after upgrade | Direct runtime feasible, document fallback fails |
| Alpine CSP | 4 / 71,815 | 2 classic external | 0 / 0 | `<noscript>` duplicates primary rows; 2 tables / 2 captions in source | Direct feasible; fallback/source duplication cost |

Source-size counts are included in S036 but are not treated as productivity or maintainability measurements. The fixtures are too small and hand-authored.

**Default/configuration counterevidence:** Observable’s first build attempted registry resolution of multiple `@latest` imports and initially failed without network access. Its default head also emitted Google Fonts. Explicit global stylesheet/footer/style configuration removed runtime remote assets, but not the build-time network/reproducibility concern (S035, S036).

**Uncovered:** JavaScript execution, visual equivalence, real report navigation, framework-specific incremental invalidation, large data, authoring errors, assistive technology.

### TR-05 — Trial detector red proof

**Prediction:** a clean local asset must pass; a remote script, a missing local script, and an inline module must each be detected in the appropriate field.

**Protocol:** the first red-proof attempt exercised detector 1.0.0; after that attempt exposed the path-labeling defect recorded below, repeat the complete accept/reject population against detector 1.0.1 before accepting TR-04’s zero counts.

**Result:** after the 1.0.0 path-labeling defect described below was fixed and versioned, detector 1.0.1 passed the clean accept arm and all three red arms. [`verify-trial-snapshot.py`](verify-trial-snapshot.py) then confirmed that live output exactly matched the recorded JSON (S043).

### TR-06 — Build/dependency cost sanity check

**Result:** one warm timed run reported Eleventy 0.25 s, Astro 0.60 s, Observable 0.72 s, Lit bundle 0.12 s, and Alpine asset copy 0.08 s at 0.01 s reporting precision (S039). Installed closure measurements were 20.3 MB/130 package directories for Eleventy, 145.0 MB/197 for Astro, 92.3 MB/258 for Observable, 13.0 MB/8 for Lit+esbuild, and 1.13 MB/3 for Alpine CSP (S037).

**Interpretation:** the byte/graph differences are real for this installation. The timings are not a performance ranking: only one timed warm repeat exists and the build jobs differ.

**Security arm:** `npm audit --json` on the combined pinned graph returned one low-severity, Windows-only esbuild development-server path traversal through Observable Framework. It has no generated-report runtime effect on the inspected macOS build, but the current Framework package did not resolve to a patched esbuild; npm suggested a framework downgrade (S038).

**Uncovered:** clean install time, cold cache, other platforms, transitive license audit, undisclosed vulnerabilities, Quarto footprint.

### TR-07 — Direct-file browser trial

**Prediction:** classic-script bundles can execute under direct file loading; module bundles require HTTP(S) under the browser’s module CORS rules (S015).

**Result:** not executed. The in-app browser rejected navigation to a local `file://` URL by policy before page load (S040). This tool failure is neither a candidate pass nor failure. Because direct-file use is preferred rather than mandatory, the decision uses output structure plus the local-static-server profile and leaves browser execution open.

### TR-08 — Pinned copy-owned registry trial

**Pre-execution record, written before dependency installation or registry retrieval.** The representative is `shadcn@4.19.0`, using the official registry and the current default Base UI path. It is not presumed to represent every copy-owned catalog. The same heading, navigation, three-row status table, search control, caption/scoped headers, and method disclosure used in TR-04 will be rendered in two arms:

- **document arm:** registry-copied React component source is evaluated at build time with `react-dom/server`; the complete report is emitted as HTML, Tailwind is compiled to a local stylesheet, and the existing classic filter script supplies bounded enhancement;
- **client-owned reject arm:** equivalent report content is mounted only from a client script, so a static detector must report no table in the authored HTML.

**Predictions:**

1. The official CLI will materialize readable TypeScript source in the fixture, but the copied source will retain imports from package-owned primitives and utilities; “own the source” will therefore describe the top component layer, not the whole behavior stack.
2. The document arm will contain the complete table, caption, row/column scopes, landmarks, and labeled search input before JavaScript; it will contain no remote runtime assets or unresolved local references. Direct-file use should be feasible because its enhancement is a classic script.
3. The client-owned arm will turn the document-presence gate red despite using the same component source. This will show that registry ownership and output ownership are independent choices.
4. The installed/build closure will materially exceed the current generator and plain HTML fixture. The copied component source will be smaller than that closure, but larger and less direct than the equivalent native table/input markup.
5. A deliberate local edit to a copied component will be visible to the CLI’s diff command. The project will not contain an automatically maintained three-way merge base or per-component upstream version record, so interpreting upgrades will remain adopter work.
6. A registry-policy detector will accept the recorded official item set and reject synthetic items that request environment variables, unpinned remote registry dependencies, or paths outside the allowed component tree. This detector will prove only the declared payload policy, not the safety of copied code or npm lifecycle dependencies.

**Decision rule:** a successful document arm proves feasibility, not fitness. The category enters Amanuensis’s primary shortlist only if source ownership removes a demonstrated limitation at less total cost than native templates plus output-level read-back. Otherwise it remains a conditional application-surface or reference-source option.

**Known limitations before execution:** one small fixture; no assistive-technology/browser run; no paid-source arm; no claim about AI productivity; CLI/vendor source and trial share an origin; registry payload review cannot certify behavior; a current upstream diff is not a three-way upgrade test.

**Executed result:** all six predictions were discriminating and survived qualification (S061–S067).

| Arm / measurement | Recorded result | Interpretation |
|---|---|---|
| Copied/init source | 5 files; 7,434 bytes; 197 nonblank lines; 12 imports | Source is locally visible, but imports package-owned React, Base UI, CVA, `clsx`, and `tailwind-merge`; ownership is layered. |
| Fixture-authored source | 4 files; 3,968 bytes; 112 nonblank lines; 11 imports | This includes the report, client entry, static-render build script, and classic filter—not config/CSS—so line counts are descriptive context volume only. |
| Full installed tree | 397 package directories; 16,803 files; 189,709,898 bytes | Concrete npm installation including registry CLI and build tooling; not browser payload. |
| Document arm | 3 files / 46,216 bytes; 5,459 HTML bytes; 1 classic script; 0 remote/broken refs | Complete heading/nav/main, one table/caption, 5 scoped headers, labeled search input. Direct/static-folder contract is structurally feasible. |
| Client-owned reject arm | 3 files / 278,244 bytes; 237,560-byte JS asset; 1 module; 0 static headings/landmarks/tables/search inputs | Gate turned red as predicted. Copy ownership did not prevent client ownership of primary content. |
| Generated document DOM | 44 elements; 20 `data-slot` elements; 34 class attributes / 209 class tokens | Native table/input/button elements remain inspectable, but utility-class/context density and wrapper metadata are much higher than the plain fixture. These counts are not a legibility score. |
| Upgrade differential | One local provenance comment was shown exactly by `shadcn add button --diff`; no files changed | Useful current-upstream visibility. The generated project stored no per-item upstream version or three-way base; the trial added its own payload snapshot/hashes. |
| Declared-payload policy | 4 official items accepted; env-var, unpinned URL, unpinned GitHub ref, and traversal arms rejected | Red-proves the narrow allowlist detector, not component-code or package safety. |
| Advisory query | 1 low-severity Windows development-server esbuild advisory | Build-tool scope only for this output. Audit is not a security certification. |

The Nova preset initially added a packaged Geist font. The document arm deliberately removed the font import/dependency and used `system-ui` before confirmation so the local-static output had no asset-copy ambiguity. This is an explicit offline-hardening customization, demonstrating that preset defaults still require packaging review.

**Build incident:** the first sandboxed run compiled CSS, then the `tsx` runner received `EPERM` opening its temporary IPC socket. The exact build succeeded with that environment restriction removed. This was recorded as an execution-environment incident, not a framework failure. A subsequent full rebuild succeeded and the live detector exactly matched the recorded snapshot.

**Decision:** TR-08 proves that a copy-owned registry is compatible with Amanuensis’s document contract only when a separate build/output architecture preserves it. It does not beat the current native projection or the much smaller Eleventy feasibility fixture for this report. The category is therefore admitted as a conditional application-surface/internal-source-distribution layer and rejected as the primary shell; C011 is preserved explicitly in C025.

**Still uncovered:** browser execution, keyboard/AT/visual accessibility, modern HTML validation, a complex registry block, malicious source behavior, npm lifecycle scripts, cold/repeated timings, package-license closure, long-term upstream change, and actual AI/human maintenance performance.

## Confirmation-run incident

The first confirmation run built all five fixtures and reproduced the recorded output hashes, but `trial-red-proof.py` failed before its first assertion: detector 1.0.0 tried to express the temporary fault fixture relative to the durable workspace. This was an instrument defect, not a candidate failure. The detector was changed only to permit an absolute label for out-of-workspace fixtures and bumped to 1.0.1; output schema and candidate scanning logic were unchanged. The required red arms and output comparison were then rerun rather than waived.

**Final confirmation:** all five builds exited zero; all recorded hashes and structural/reference fields were unchanged; detector 1.0.1’s clean accept and remote/missing/module red arms passed; live JSON exactly matched [`trial-inspection.json`](trial-inspection.json) (S043).

## Final confirmation commands and expected invariants

After this prediction record was written, execute:

```text
cd /Users/nfeldman/repos/amanuensis/scholiast/ai-primary-web-platform-landscape/trials
npm run build:eleventy
npm run build:astro
OBSERVABLE_TELEMETRY_DISABLE=true npm run build:observable
npm run build:lit
npm run build:alpine
cd ..
python3 trial-red-proof.py
python3 trial-inspection.py
python3 dependency-footprint.py
```

Pass requires: every build exits zero; the detector red arms pass; every remote-asset and unresolved-reference list remains empty; module counts remain Eleventy 0, Astro 1, Observable 1, Lit 0, Alpine 0; aggregate hashes match S036.

TR-08’s confirmation sequence is separate because it has an isolated lockfile:

```text
cd /Users/nfeldman/repos/amanuensis/scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy
mise x -- npm run build
mise x -- npx --no-install tsc --noEmit
cd ../..
python3 registry-policy.py
python3 verify-registry-trial-snapshot.py
python3 verify-survey.py
```

Pass requires a zero exit from every command; four clean registry items and all four policy reject arms; exact live/snapshot equality; a 27-claim/68-source structural survey audit; and unchanged structural/output hashes in S062.

## Next discriminating trials before implementation choice

### NT-01 — Full representative projection bake-off

Use the current AxiomDB materialized model, not hand-copied prose. Render the same 49-page content through: (A) improved current generator, (B) Eleventy, and (C) Astro. Add Observable only as a separate analytical-page arm, not pool it with document generators.

Measure exact output coverage, local link resolution, text/table equivalence, generated bytes by category, one-prose-edit blast radius, one-entity-add blast radius, cold/warm build time with at least three repeats, and clean-network-disabled rebuild. Reject any arm without equivalent read-back.

### NT-02 — Browser and accessibility matrix

At 375×812 and 1280×800, with JavaScript enabled and disabled where supported:

- keyboard-only open/close/filter/navigation;
- focus visibility and focus return after Escape;
- correct `aria-expanded` state;
- reduced-motion behavior;
- no primary content/navigation loss;
- modern HTML validation;
- automated axe plus manual landmark/heading/table/name review.

Include a surface-identical broken-label arm and a hidden-mobile-navigation arm to prove the gates can fail. Automated axe is necessary but insufficient.

### NT-03 — Analytical annex threshold

Compare precomputed HTML/SVG against Observable Framework, Perspective, and DuckDB-Wasm only on a concrete task: e.g. filtering/pivoting/querying a dataset too large for the current table. Record dataset size, required user questions, payload, first-use latency, keyboard behavior, static fallback, local-server setup, and build/network reproducibility. Reject the runtime if the known questions can be precomputed without losing user value.

### NT-04 — Quarto one-file export

Install/pin Quarto in an isolated trial, render a representative report with `embed-resources: true`, disconnect the network, and verify one-file open, text/table/chart fallback, PDF/print behavior, link semantics, axe/manual accessibility, and reproducible inputs. Compare it as an **export target**, not as a replacement for Amanuensis’s model or read-back.

### NT-05 — Copy-owned complex-component admission trial

Trigger only after naming an application-like interaction that native HTML, precomputation, and the NT-03 specialists cannot satisfy. Freeze one exact task and compare:

- native/platform implementation or specialist baseline;
- one captured shadcn official item or ReUI/Kibo complex item;
- Park UI as the cross-framework architecture arm;
- Intent UI only when React Aria’s behavior set matches the task.

Before retrieval, record expected source/DOM/dependency differences. Capture every registry payload, license, package lock, and declared file/dependency/config/env field. Inject reject arms for an unpinned dependency, path escape, undisclosed remote asset, overwritten local customization, missing label/keyboard behavior, client-only primary content, and JavaScript-disabled fallback. Measure copied/authored/generated context separately, a real upstream-update merge, static/SSR output, bundle assets, cold/warm build with repeats, axe plus manual keyboard/AT behavior, and output read-back. Reject any candidate whose only advantage is catalog availability or model familiarity.
