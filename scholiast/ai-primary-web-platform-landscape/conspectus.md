# AI-primary web-platform landscape for Amanuensis

- **Durable workspace:** `/Users/nfeldman/repos/amanuensis/scholiast/ai-primary-web-platform-landscape/`
- **As-of date:** 2026-08-22
- **Status:** Complete for the copy-owned-registry extension; 27 claims, 68 sources, a dated category matrix, and a pinned two-arm registry trial are recorded. Browser/assistive-technology and complex-component admission remain explicitly open.
- **Practice rubric:** `/Users/nfeldman/research/practice-audit/practice-catalog.md` v2.10 (applied and cited; no other local research was inspected unless that catalog explicitly linked it).

## Charter

Survey the current state of the art in building on the web platform when AI is the primary author and a frequent reader of the code, with particular attention to data-rich reporting and reorientation surfaces like Amanuensis. Discover the candidate landscape rather than validating a supplied shortlist. Distinguish approaches that are substantial from those that are thin, immature, unreliable, or mismatched.

This is a mixed technical, empirical, and evaluative question. The survey must evaluate:

1. alignment with browser and web-platform primitives;
2. accessibility and progressive enhancement;
3. legibility to AI authors/readers and to human maintainers;
4. maintainability and architectural explicitness;
5. testability, including behavior and accessibility tests;
6. dependency, build, and operational cost;
7. project health, license, provenance, and security posture;
8. fitness for offline and self-contained reports;
9. fitness for Amanuensis specifically, grounded in inspection of its generator and rendered example.

Distribution clarification received 2026-08-22: direct `file://` operation is preferred, not mandatory. The survey therefore treats direct-file, tiny-static-server, and hosted-static operation as separate profiles and charges server dependence as an operational/portability cost rather than an automatic rejection.

A satisfactory answer comprises a sourced taxonomy, a dated vendor/project matrix, a shortlist with explicit rejections, and discriminating trials that can overturn attractive but weak candidates. Certainty can be high for directly inspected project properties and measured local trials, moderate for architectural fitness inferred from those properties, and low for ecosystem-wide claims whose evidence is promotional or incomplete.

### 2026-08-22 extension charter

Add the missing category of copy-owned component registries, treating shadcn/ui as one known example rather than a supplied answer. Discover direct peers and meaningful variants, including the design-system stacks that make copied components function. Evaluate source ownership versus package abstraction, semantic/accessibility responsibility, context and code volume, customization and upgrade drift, generated DOM legibility, dependency/build/runtime cost, offline packaging, testability, license/provenance, security, health, and fit for Amanuensis. Run a pinned feasibility trial against the existing report fixture where practical. Preserve earlier dispositions unless new evidence changes them, and record any revision pair explicitly.

## Scope boundaries

- Inspect the Amanuensis generator in `/Users/nfeldman/repos/amanuensis` and the rendered example at `/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html`.
- Work only in this durable workspace for survey artifacts.
- Do not inspect other local research except references explicitly linked by practice catalog v2.10.
- Prefer primary documentation, repositories, standards, and direct measurements over popularity signals or commentary.
- For the extension, distinguish registry/distribution architecture from visual style and from the packaged primitives, CSS compiler, utility merger, icons, and application framework that a copied item still imports.

## Current claim map

The inventory contains 27 seven-field claims. C001–C009 establish the Amanuensis baseline and instrument boundaries; C010–C018 reconcile the original candidate landscape, packaging trials, and recommendation. C019–C027 define and test copy-owned registries, ownership/accessibility/drift boundaries, direct peers and variants, AI-evidence limits, and data-surface fitness.

## Extension result and revision record

The added category is substantial but orthogonal to the shell decision. A machine-readable registry can make source acquisition, inspection, and customization unusually explicit. It does not determine whether output is static or client-owned, does not copy the full behavior/build stack, and does not transfer accessibility or upgrade responsibility away from the adopter.

The direct landscape is plural:

- shadcn/ui has the deepest surveyed general registry protocol and review/diff tooling;
- Park UI is the strongest independent cross-framework peer, enabled by Ark UI/Panda CSS;
- Intent UI is the strongest React Aria/accessibility-oriented direct variant;
- ReUI and Kibo are substantial complex dashboard/data registries;
- HyperUI is a manual native-markup gallery, Chakra snippets a copied-wrapper/package hybrid, and Catalyst a commercial delivered-source variant with material redistribution limits.

**Revision pair:** C011 before extension recommended the current platform-first Python projection/read-back architecture. C025 after the strongest new category trial preserves that recommendation. The scope changes: copy-owned registries are now an explicit conditional shortlist for internal source distribution or future application-like annexes, and NT-05 records how one could earn admission. No prior project disposition was reversed. C010 is reinforced, not changed: current AI-UI research supports stronger validation but does not establish a copy-owned-registry maintainability advantage.

TR-08 used `shadcn@4.19.0` with captured Base Nova `button`, `input`, `label`, and `table` payloads. Its pre-rendered arm preserved the complete remote-free report in 46,216 bytes; its client arm was 278,244 bytes and contained none of the primary static structure. Five copied/init files measured 197 nonblank lines while the full CLI/build installation measured 397 package directories and 189.7 MB. These are exact feasibility measurements, not a framework or productivity benchmark.

## Deliverables

- `taxonomy.md` — sourced approach taxonomy and substantial/thin/unreliable assessment.
- `vendor-matrix.md` — dated, cell-sourced comparison with health and license evidence.
- `shortlist.md` — recommended candidates plus explicit rejections and decision boundaries.
- `trials.md` — discriminating trial designs and recorded local results where feasible.
- `sources.md` — append-only source ledger.
- `claims.md` — seven-field claim inventory.
- `vocabulary.md` — unstable terms and working definitions.
- `notes.md` — search record, gaps, deferrals, and handoff state.
- `registry-trial-verification.md` — frozen inputs, commands/results, instrument incident, red-proof coverage, and limitations for TR-08.
- `README.md` — compact result and artifact map.
