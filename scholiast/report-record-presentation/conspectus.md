# Presenting Amanuensis report records

**Workspace:** `/Users/nfeldman/repos/amanuensis/scholiast/report-record-presentation/`

## Charter

Determine the most effective human-facing presentation for each recurring
Amanuensis record family while preserving the Markdown projection and the
underlying data model.

This is a mixed technical and information-design question. It is not a survey
of UI frameworks, a redesign of the report's global information architecture,
or a search for one component to use everywhere.

The comparison starts from the actual AxiomDB corpus and evaluates, at minimum:

1. findings: identification and workflow state, symptom, root cause, and source
   revision;
2. file scope: file identity and path, review classification, reason for
   inclusion, and source revision;
3. concern dispositions: concern identity, verdict, evidence strength, linchpin
   dependence, and rationale;
4. structural inventories: symbols, roles, locations, lifetimes, and state
   transitions;
5. genuine comparisons and matrices where lateral scanning is the reader's
   task.

Candidate representations include conventional tables, responsive tables,
stacked record rows, definition-list records, cards, disclosure-based details,
and hybrids. The user's suggested metadata column plus two reading columns is
one candidate, not a governing rule.

## Decision criteria

A satisfactory result must justify representation per record family against:

- orientation: identify the object and its state quickly;
- comprehension: follow long causal or explanatory prose without lateral
  panning or broken reading order;
- comparison: scan the same attribute across records when that is actually the
  task;
- action: reach the next relevant source, subsystem, evidence, or decision;
- provenance: retain paths, revisions, and machine identifiers without giving
  them unearned visual priority;
- accessibility and responsiveness: preserve semantic reading order, keyboard
  access, zoom behavior, and narrow-screen comprehension;
- density: avoid both schema dumps and card-grid sprawl;
- implementation fit: remain self-contained, dependency-light, and derivable
  from current Markdown/data without inventing workflow state.

## Current status

Landscape mapped against primary accessibility guidance, mature design-system
contracts, scoped empirical studies, and the current AxiomDB population. The
corpus instrument found 49 table schemas and 784 rows; one initial zero-population
error was corrected and recorded. Claim map and representation synthesis are
current as of 2026-08-23. Representative-reader testing remains open.

## Synthesis

There is no optimum table component. The optimum is a small presentation grammar
chosen by the information relationship and the reader's operation.

### Findings

Use a vertically ordered **finding register**. Each finding is one semantic
`<article>` with:

1. a compact header containing severity, ID, subsystem, workflow state, and
   checked revision;
2. the first observed-behavior sentence as a lede, not falsely promoted to a
   separately authored title;
3. the remaining observed behavior at a stable reading measure;
4. root cause after it, at the same measure;
5. direct routes to the subsystem and supporting evidence.

Do not place symptom and root cause beside each other. Their causal order matters,
and the median record would put 576 and 848 characters into competing columns.
Do not hide either behind disclosure by default; both are needed to assess a
finding. A later index/detail split is promising, but it needs a real title/lede
field rather than synthetic summaries.

### File scope

Use a compact **file register**, visually one row per file rather than a card grid.
At wide widths it has two regions:

- file identity: basename first; full path, classification, and checked revision
  as subordinate facts;
- why this file is in scope: the dominant reading field.

On narrow screens the identity precedes the reason. The full path remains visible
and copyable but does not dictate column width. The revision never gets its own
column.

### Concern dispositions

Use a **disposition register**. Its header keeps concern ID, verdict, evidence
quality, and linchpin dependence together. The rationale follows at one readable
measure. Omit the linchpin fact entirely when false instead of printing 125 empty
cells across 130 records.

### Structural inventories

Use two forms because the tasks differ:

- symbol / role / source becomes a compact data list: symbol and source identity,
  then role;
- state-container lifecycles remain a true comparison grid, with name and location
  combined into a row header and Stores / Lifetime / Populated by / Invalidated by
  retained as comparable columns.

The second survives as a table because lateral comparison is the point. It gets a
local scroll container at narrow widths rather than pretending the relationship is
one-dimensional.

### Other report families

- Keep the coverage heatmap as a table.
- Keep compact seam / shared-object / other-party comparisons as tables; convert
  the global seam form with 954-character median Notes into records.
- Render project metrics and other key/value summaries as definition lists.
- Render the master plan as a subsystem register; Scope and Jump-in are narrative,
  not columns.
- Render long concern catalogs and open-question registers as records.
- Keep short definition and route comparisons as tables when readers genuinely
  compare across them.

## Visual and interaction consequences

- Use one ruled vertical register, not a grid of floating cards.
- Use square geometry and restrained outlines; record separation should not require
  rounded containers.
- Preserve one primary reading column inside narrative records even on wide screens.
- Use small labels to name fields, but do not repeat page-level explanations inside
  every record.
- Sort findings by recorded severity and status; do not invent an aggregate score.
- Keep provenance in the normal reading and copy order. Subordinate is not hidden.
- Reserve horizontal scrolling for true two-dimensional tables.
- Keep critical technical content open. Progressive disclosure is for secondary or
  advanced detail, not symptom or root cause.

## Implementation boundary

Use explicit renderer hooks for known Amanuensis record schemas. Do not infer
semantics from arbitrary text length and do not turn every Markdown table into a
data list. Markdown remains the faithful, inspectable schema projection; HTML maps
known record families to the presentation grammar above and leaves unknown tables
as properly marked-up tables.

The recommendation is evidence-backed but not user-tested. It rejects the current
schema dump and the parallel-prose candidate with high confidence; it does not claim
measured superiority between an all-open finding register and a future dedicated
finding-page design.

## Transfer into Amanuensis

The first production transfer is implemented in
`materializer/amanuensis_materializer/html_projection.py` as exact schema hooks.
It covers findings, file ledgers, concern dispositions and catalogs, structural
inventories, subsystem plans, open questions, global seams, key/value summaries,
and lifecycle tables. Unknown schemas still render as semantic tables.

The integration fixture asserts both red boundaries: a finding schema must become
one article per row with no table, while lifecycle data must remain a table. The
active AxiomDB projection was regenerated after the transfer and passed independent
state, coverage, and content read-back. This establishes faithful construction, not
reader-performance superiority; O-02 remains open.
