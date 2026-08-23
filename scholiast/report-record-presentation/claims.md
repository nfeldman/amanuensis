# Claims

## C-01 · Choose by reader operation, not storage shape

- **what:** The HTML projection should choose a representation according to the
  reader's operation: tables for lateral comparison, data lists for multiline
  record comprehension, and definition lists for key/value facts.
- **how:** Corroborated design-system and accessibility guidance with distinct
  “when to use” boundaries.
- **where:** S-004, S-006, S-007, S-008.
- **when:** Sources checked 2026-08-23.
- **why:** Governs every record-family decision in this survey.
- **confidence:** Corroborated practitioner/standards guidance; classification
  **Probable**, because no target-user experiment has compared these exact
  Amanuensis representations.
- **see-also:** C-02, C-03, C-04.

## C-02 · Metadata belongs with the record, not in peer columns

- **what:** ID, subsystem, workflow state, evidence quality, and revision should
  be grouped as subordinate key/value facts attached to the record they qualify.
- **how:** GOV.UK's summary-list contract identifies metadata as a key/value use;
  the AxiomDB profile shows these values are short while their adjacent narrative
  fields are hundreds of characters long.
- **where:** S-007, S-012.
- **when:** Checked/measured 2026-08-23.
- **why:** Directly addresses wasted SHA/status columns without hiding provenance.
- **confidence:** Corroborated guidance plus direct corpus measurement;
  classification **Probable**.
- **see-also:** C-05, C-06.

## C-03 · Long explanatory records are not tabular merely because Markdown stores them in rows

- **what:** Findings, file-scope reasons, concern rationales, and the master-plan
  Scope/Jump-in pair should not remain HTML tables.
- **how:** PatternFly recommends data lists for multiline records; W3C reserves
  table semantics for grid relationships. In AxiomDB, median narrative lengths
  are 576/848 characters for finding symptom/root cause, 211 for file-scope
  reasons, 552 for disposition rationale, and 102/172 for subsystem Scope/Jump-in.
- **where:** S-004, S-008, S-012.
- **when:** Checked/measured 2026-08-23.
- **why:** These are the largest recurring failure surfaces in the current HTML.
- **confidence:** Corroborated guidance plus complete local population;
  classification **Probable**.
- **see-also:** C-04, C-05, C-06, C-07.

## C-04 · The metadata-plus-two-prose-columns candidate does not survive the corpus

- **what:** Collapsing metadata is sound, but presenting full symptom and root
  cause in parallel columns is not the optimum for findings; they should read
  sequentially at a stable text measure.
- **how:** Direct measurement gives a median 1,424 characters across the two
  fields; parallel columns would narrow two causally ordered passages. The one
  directly accessed line-length study favors a medium measure under its tested
  screen-reading conditions, but its scope is only supporting evidence.
- **where:** S-011, S-012.
- **when:** Measured/checked 2026-08-23.
- **why:** Evaluates the user's candidate rather than canonizing it.
- **confidence:** Direct corpus measurement plus limited reading evidence;
  classification **Inferred** until representative-reader task testing.
- **see-also:** C-03, C-05.

## C-05 · Findings need a register and a reading surface

- **what:** A finding should be one semantic article with compact metadata, a
  consequence-led lead, then sequential Observed behavior and Root cause regions;
  the aggregate page also needs a compact route for choosing among findings.
- **how:** Derived from C-01 through C-04 and the prior task requirement that a
  maintainer reach and understand a consequential finding without lateral table
  reading. The current source model has no title field; first symptom sentences
  are themselves 109 characters at the median and 224 at the 90th percentile.
- **where:** S-002, S-003, S-012.
- **when:** Measured 2026-08-23.
- **why:** Balances scan, comprehension, and provenance rather than forcing one
  geometry to do all three.
- **confidence:** **Inferred**; classification **Probable** for semantic articles,
  **Underdetermined** for whether aggregate expansion or dedicated finding pages
  best supplies the detail surface.
- **see-also:** Open question O-01 in `notes.md`.

## C-06 · File ledgers and dispositions need distinct record grammars

- **what:** File-scope records should lead with basename and reason-for-inclusion,
  with full path/classification/revision subordinate. Dispositions should lead
  with concern and verdict, then show the full rationale at reading width, with
  evidence quality and linchpin dependence adjacent to the verdict.
- **how:** Applied C-01/C-02 to the measured field-length and task differences in
  S-012. The file record is a scope explanation; the disposition is an adjudicated
  technical claim. Their similar source tables do not justify one shared component.
- **where:** S-001, S-012.
- **when:** Measured 2026-08-23.
- **why:** Prevents a generic “record card” from becoming the next schema dump.
- **confidence:** Direct corpus analysis and information-relationship inference;
  classification **Inferred** pending task testing.
- **see-also:** C-02, C-03.

## C-07 · Some tables must remain tables

- **what:** Coverage heatmaps and compact, regular comparison grids should retain
  semantic table markup; a “never use tables” policy would discard useful spatial
  relationships.
- **how:** W3C documents the programmatic value of row/column relationships;
  GOV.UK defines comparison as the table use case; controlled studies show that
  concise tabular quantitative summaries can outperform prose in their own scope.
- **where:** S-004, S-005, S-006, S-009, S-010.
- **when:** Checked 2026-08-23.
- **why:** Establishes the counter-boundary to C-03.
- **confidence:** Corroborated with scoped empirical support; classification
  **Established** for preserving true tables, not for any specific table design.
- **see-also:** C-01, C-08.

## C-08 · Horizontal scrolling is a containment fallback, not a design success

- **what:** Use a local scroll container only for content whose comprehension
  genuinely depends on two dimensions; reflow non-tabular records instead.
- **how:** WCAG Reflow explicitly scopes the two-dimensional exception to the
  content that requires it and recommends containing that scroll.
- **where:** S-005.
- **when:** Checked 2026-08-23.
- **why:** Distinguishes an accessible fallback from a readable primary layout.
- **confidence:** Single authoritative standards source; classification
  **Established** for conformance scope, **Single-source** as usability guidance.
- **see-also:** C-03, C-07.

## C-09 · Prefer a ruled register to a grid of cards

- **what:** The complex recurring record families should use a vertically ordered
  data-list/register treatment, not independent cards arranged in a grid.
- **how:** PatternFly distinguishes data lists from cards and recommends the list
  when the record cannot fit comfortably in a card. AxiomDB's narrative lengths
  exceed compact-card capacity, while severity/priority ordering is meaningful.
- **where:** S-012, S-013.
- **when:** Checked/measured 2026-08-23.
- **why:** Avoids solving the schema-dump problem by replacing it with low-density
  card sprawl and broken reading order.
- **confidence:** One vendor guideline plus direct corpus fit; classification
  **Inferred** pending reader testing.
- **see-also:** C-03, C-05, C-06.
