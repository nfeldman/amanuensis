# Amanuensis baseline inspection

As of 2026-08-22. The current renderer file was uncommitted at repo HEAD `c0e28549e03802231ffb18f53845f88d3c450ae8`; its content SHA-256 was `e4e8a35f77599106e3ba5b2e833c46a4b2345420fef3e8b6464f24ea987b9aa8`. The named AxiomDB index SHA-256 was `a49b29a5debcadbff368f60f1ad11294f31533fa7a0d137e7d66d05f4d836501`.

## Named index

Detector 1.0.0 reported:

- 52,280 bytes, 387 lines, HTML doctype, `lang=en`, and viewport metadata;
- one `main`, one `nav`, two `aside`, one `header`, and one `footer` landmark;
- one `h1`, nine `h2`, no duplicate IDs, and no heading-level skips (the navigation’s four `h2` headings precede the document `h1` in DOM order);
- 69 links: 64 local and five fragments; no remote assets;
- one search input with an explicit `<label>`, two buttons, one captioned table with both column headers scoped;
- two inline scripts and one inline style block;
- lexical signals for skip navigation, `:focus-visible`, reduced motion, color scheme, and print styles;
- no inline event handlers, `eval`, or `document.write`.

This is structural evidence only. It does not certify browser layout, keyboard operation, screen-reader output, accessible names after runtime initialization, contrast, forced-colors behavior, or WCAG conformance.

## Complete AxiomDB docs bundle

- 49 HTML files and 49 Markdown companions;
- directory allocation reported by `du -sk`: 5,228 KiB;
- HTML bytes: 3,533,237;
- all 4,566 local links resolved inside the bundle;
- repeated embedded CSS: 15,469 bytes/page, 757,981 bytes total;
- inline script bytes total: 118,139;
- repeated navigation bytes total: 1,376,200;
- article body bytes total: 1,114,368;
- CSS + scripts + repeated navigation: 63.7% of HTML bytes in this snapshot.

## Executed current test

`mise exec -- python materializer/test-materializer.py` passed. Particularly discriminating observations:

- a byte-identical second run rendered 0 of 18 HTML pages;
- changing one prose artifact rendered 2 of 18 HTML pages;
- adding one subsystem rendered 19 of 19 HTML pages because global navigation changed;
- removing it rendered 18 of 18 remaining HTML pages;
- an injected renderer exception made summary `ok=false` while other pages remained available;
- test assertions confirm no `https://` reference in the test index, HTML tables rather than pipe prose, and relationship-map output.

The separate `test-readback.py` source contains red arms for missing Markdown and HTML state markers and broken Markdown and HTML links. Update 2026-08-22: it was subsequently executed and passed all of those independent state, coverage, and content fault arms (S013).

## Instrument rejection

The macOS `/usr/bin/tidy` binary rejected HTML5 landmark elements (`aside`, `nav`, `section`). This is a scope failure of the validator, not evidence against the document. Its output is retained to prevent later re-use as a conformance verdict. A modern HTML5 validator is a trial obligation.
