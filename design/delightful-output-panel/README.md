# Delightful output panel

This directory holds a design panel for the human-facing Amanuensis HTML
projection, using the current AxiomDB conspectus as its representative corpus.
It is an isolated prototype workspace: nothing here is a production
materializer input or output.

## Method

1. Three panelists receive only `blind-brief.md` and the generated AxiomDB
   report it names. They work independently and cannot read one another's
   output.
2. The lead freezes and inventories the first readings before opening any
   existing research.
3. Existing Scholiast work is located and research claims are kept in a
   separate durable Scholiast workspace. Any new research stays there.
4. The lead develops materially different directions, records tensions and
   rejected tradeoffs, and tests each direction against concrete reader tasks.
5. A self-contained prototype and implementation-ready design language are
   produced in this directory, then checked mechanically and visually.

The panel method is frozen against Practice Catalog v2.10 (2026-08-14). Its
load-bearing disciplines here are blind first readings, independence before
aggregation, no deliberation round, explicit model-lineage accounting,
verify-before-apply, exact fan-in, and read-back of delivered artifacts.

## Custody boundaries

- Current representative report (read-only):
  `/Users/nfeldman/repos/axiomdb/.amanuensis/docs/`
- Panel artifacts (writeable):
  `/Users/nfeldman/repos/amanuensis/design/delightful-output-panel/`
- Research custody for the current reorientation facet:
  `scholiast/task-workspace-reorientation-indexes/` in this isolated worktree.
- Production Amanuensis and AxiomDB files: read-only for this panel.

## Outcome

The panel initially selected **Field Docket**: decision-first content inside a stable map. Subsequent product review separated the information-architecture result from the interface direction. The IA findings remain useful; the busy paper/editorial treatment and clinical vocabulary do not.

`revision-2026-08-23.md` is the current product ruling. It keeps project-first identity, distinct status dimensions, consequential findings, supporting evidence, and report-owned return paths. The revised interface uses a neutral software-tool visual language and a software-practitioner register, with precise textual-critical terms where useful. `Decision docket` and `Warrants` remain deliberate exceptions.

The prototype freezes the coherent AxiomDB state captured at 2026-08-22 18:15:05 EDT: 25/34 mapped and 14 confirmed open findings, including `V02-1` critical and `R04-1` high. The source survey remained active after capture.

## Artifact index

### Primary handoff

- `prototype/index.html` — historical self-contained panel prototype.
- `prototype-current/index.html` — current, quieter fixture bound to the later 34/34, 15-finding publication and the 2026-08-23 product ruling.
- `revision-2026-08-23.md` — accepted separation of IA and UI, register, retained decisions, and rejected visual tropes.
- `design-language.md` — tokens, components, content grammar, responsive/accessibility behavior, view model, read-back gates, and exact Amanuensis renderer seams.
- `task-tests.md` — five concrete reader-task fixtures, direction comparison, selected-direction walkthroughs, and failure triggers.
- `source-capture.md` — frozen representative facts, timestamps, hashes, and the moving-source caveat.
- `current-report-stress-test.md` — applies the prototype anatomy to the later 34/34, 15-finding AxiomDB publication.
- `actionable-redesign.md` — staged renderer seams, component contracts, and red-capable test order.

### Panel record

- `blind-brief.md` — the sealed prompt shared by every blind reader.
- `panel/method-and-lineage.md` — blind protocol, exact 3/3 fan-in, memo hashes, and honest Codex-only lineage accounting.
- `panel/blind-ia-wayfinding.md` — independent information-architecture reading.
- `panel/blind-interaction-art-direction.md` — independent interaction/art-direction reading.
- `panel/blind-editorial-decision-design.md` — independent editorial decision-design reading.
- `panel/synthesis-and-directions.md` — Field Atlas, Decision Docket, Living Evidence Edition, dialectical selection, rejected tradeoffs, and unresolved disagreements.
- `panel/rerun-2026-08-22/` — fresh 3/3 blind memos, exact model/hash fan-in, and a tightened synthesis after the current-report and Scholiast checks.

### Validation

- `validation/validate-prototype.mjs` — dependency-free structural validator.
- `validation/index.html.png` — local desktop visual-QA capture.
- `validation/report.md` — checks performed, results, and remaining validation limits.

### Durable Scholiast custody

The current narrow research facet is intentionally outside this design directory at:

`scholiast/task-workspace-reorientation-indexes/`

It contains the conspectus, append-only source ledger, seven-field claims, notes, counterevidence pass, and explicit static-report transfer boundary. A previously named `delightful-orienting-codebase-reports` workspace was not present when checked; the rerun synthesis therefore supersedes any earlier references to claims from that missing path.
