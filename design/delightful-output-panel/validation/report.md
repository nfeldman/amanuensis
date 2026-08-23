# Prototype validation report

**Prototype:** `design/delightful-output-panel/prototype/index.html` in the isolated worktree  
**Validated:** 2026-08-23
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

The compact first-page fixture at `../prototype-current/index.html` was added after the report advanced to `34 / 34` mapped subsystems and 15 open findings (one critical, two high), then revised on 2026-08-23 after product review separated the IA result from the UI direction. Its current SHA-256 is `22da33881a7bb51088e6e025f223339e69f2124c4a89da8dafd56cc22bb57d5e`.

Sixteen current-fixture assertions pass inside the 42-check validator: document structure, project-first identity, secondary Amanuensis identity, bounded navigation, three semantic finding records, retained `Decision docket`/`Warrants` vocabulary, direct practitioner labels, retired clinical labels, absence of literal paper/texture tokens, presence of the green-gray palette and mid-century display stack, square container geometry, no JavaScript requirement, no remote assets, unique IDs, and resolved fragments. This is markup/read-back validation, not a visual or usability result.

## Production projection result

The typed record grammar was applied to the active AxiomDB publication and the
materializer's independent state, coverage, and content read-back passed with
zero mismatches. Inspection of the generated HTML found:

- 15 finding articles and no table on `findings.html`;
- 19 file-ledger records, 12 concern-disposition records, and 13 structural-
  inventory records on the W-01 subsystem page;
- one lifecycle table retained on W-01; and
- the 34-by-36 concern coverage relation retained as a complete semantic matrix
  on `concerns.html`, while a sparse linked coverage index becomes the default
  surface and concern prose on the checklist remains a record register.

The later typography and terrain pass additionally verified in generated
markup that:

- title and orientation copy have no inherited reading-measure cap;
- finite narrative runs retain ordinary source order, remain one column below
  a `120ch` reading field, then progressively become two columns at `120ch`
  and three at `190ch` through intrinsic container queries;
- `master-plan.html` contains 34 subsystem records and no table;
- AxiomDB's zero recorded dependency edges produce a linked 34-subsystem atlas
  rather than an inferred graph;
- seven recorded seams produce four linked connected areas;
- file-ledger identities open the reviewed revision on AxiomDB's verified
  GitHub origin; and
- known opaque identifiers carry semantic definition markup, a descriptive
  native title, and a matching accessible name wherever they appear; and
- the HTML projection contains none of the legacy reader-facing phrases
  `Concern dispositions`, `Jump-in reading`, `evidence dispositions`, or
  `Fix awaiting verification`; and
- Markdown and HTML contain no unresolved cross-reference placeholder bytes,
  including links whose visible labels use inline code.

The materializer integration test includes red-capable assertions for both
sides of the grammar: prose-heavy findings must not regress to a table, and
lifecycle data must remain a table.

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

The original panel/research pass was contained in:

- `design/delightful-output-panel/`
- `scholiast/task-workspace-reorientation-indexes/`

The later product revision deliberately changed the production renderer and
added a separate research workspace at
`scholiast/report-record-presentation/`. The active AxiomDB HTML companions and
projection manifests were regenerated from its existing conspectus state; no
survey database or authored Markdown source was rewritten by the presentation
change.

## Remaining validation limits

- No representative-reader study was performed.
- No assistive-technology conformance claim is made.
- Narrow responsive states are implemented and structurally inspected, but
  automated inspection of the active local `file://` projection was blocked by
  the browser security boundary; browser-specific optical QA remains.
- Forced colors, 200%/400% zoom, screen-reader order, and print pagination remain pre-production gates.
- Device-local trail pinning has parse-level validation; the production privacy/persistence policy remains unresolved.
- The current-publication fixture is available as a local `file://` page, but
  this pass makes no automated live-browser or representative-reader claim for
  it.
