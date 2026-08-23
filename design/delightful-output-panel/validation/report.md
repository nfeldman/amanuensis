# Prototype validation report

**Prototype:** `design/delightful-output-panel/prototype/index.html` in the isolated worktree  
**Validated:** 2026-08-22  
**Prototype SHA-256:** `e8eddfe2fcc3a285613b4377642ed196d18173a63929c4ecdcdd15ed0e0f92c6`

## Automated result

Command:

```sh
node design/delightful-output-panel/validation/validate-prototype.mjs
```

Result: **26 / 26 checks passed**.

Checks cover:

- HTML5 doctype, document language, responsive viewport;
- skip link, main/nav/aside landmarks, explicit search label;
- reduced-motion, print, and no-JavaScript treatments;
- frozen `25 / 34`, 14-findings, comparison-unknown, register-agreement, and visible-qualification content;
- unique IDs, resolving fragment links, resolving `aria-controls` targets;
- no external runtime assets or HTTP navigation;
- explicit button types and `<details>/<summary>` pairing;
- parseable inline JavaScript, no NUL placeholders, one H1, and semantic article records.

A second stdlib HTML parser stack check reported zero unmatched or misnested explicit tags.

## Current-publication fixture

The compact first-viewport fixture at `../prototype-current/index.html` was added after the report advanced to `34 / 34` mapped subsystems and 15 open findings (one critical, two high). Its SHA-256 is `32b730768ba99256eb16509513f1540b43a6af38b5ee53a97084969c9e92d411`.

Ten structural assertions passed: doctype, four independent condition cells, three current high-consequence finding articles, current coverage/counts, active-run caveat, report-owned re-entry language, absence of personal-task claims, semantic landmarks, and narrow responsive rules. This is markup/read-back validation, not a visual or usability result.

## Visual result

macOS Quick Look rendered the local file at 1440px into `index.html.png` (SHA-256 `3e64a1ed6cb7afae6cd2af78b8a91569dba97c50c9287d9ec590f5d9ac9d68ec`). The pass confirmed:

- the rail, one-breath project model, task routes, and four-axis condition band establish a clear first-screen hierarchy;
- the static grid motif reads as an accent behind the hero rather than a dependency diagram;
- source/coverage/consequence/publication signals remain visually discrete;
- the typographic scale and local system-font stacks render coherently without external requests;
- the no-JavaScript banner and static rail remain readable in the preview renderer.

The no-JavaScript banner was adjusted after the first preview so the fixed desktop rail no longer covers its opening text; structural validation was re-run after that change.

## Reader-task result

The five structured walkthroughs in `../task-tests.md` pass at the information-architecture level:

- T1 orientation;
- T2 action on `V02-1` with a visible deployment qualification;
- T3 trust audit including publication-integrity read-back;
- T4 re-entry with an explicit unknown comparison baseline;
- T5 name/ID/topic lookup and return to the invoking case.

These are artifact walkthroughs, not human-subject results.

## Custody check

Panel/research changes are contained in the isolated worktree:

- `design/delightful-output-panel/`
- `scholiast/task-workspace-reorientation-indexes/`

`materializer/amanuensis_materializer/html_projection.py` was already an untracked working-tree file and was read only by this panel. No production Amanuensis renderer or AxiomDB report file was modified by the rerun.

## Remaining validation limits

- No representative-reader study was performed.
- No assistive-technology conformance claim is made.
- Narrow responsive states are implemented and structurally inspected, but the available headless Firefox invocation did not produce a screenshot; browser-specific narrow visual QA remains.
- Forced colors, 200%/400% zoom, screen-reader order, and print pagination remain pre-production gates.
- Device-local trail pinning has parse-level validation; the production privacy/persistence policy remains unresolved.
- The current-publication fixture could not be rendered through the in-app browser because local `file://` navigation was rejected by that browser's URL policy; no live-browser claim is made for it.
