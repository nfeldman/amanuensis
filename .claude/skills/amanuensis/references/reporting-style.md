# Reporting Style

Use this contract for HTML labels, navigation, hints, generated prose, and
design handoffs. It governs the human projection, not identifiers stored by
the target codebase.

## Keep information architecture and interface design separate

- Let information architecture determine what exists, its hierarchy, its
  routes, and which status dimensions must remain distinct.
- Let interface design determine layout, typography, color, density, and
  interaction within that structure.
- Do not let a visual direction rename records, merge status dimensions, or
  create unsupported workflow state.
- Keep the project name as the primary identity. Present Amanuensis as the
  producing system or method, never as the project's title.

## Register

Write primarily for experienced software practitioners. Prefer established
terms such as project, subsystem, component, module, interface, dependency,
implementation, finding, evidence, decision, risk, test, status, source,
revision, and next step.

Use textual-critical vocabulary only when it identifies the evidence
relationship more precisely:

- **witness** — a specific source file, revision, artifact, or recorded output
  being compared;
- **variant** — a materially different implementation or recorded reading;
- **reading** — an interpretation of behavior supported by cited witnesses;
- **locus** — the exact code or artifact location under discussion;
- **collation** — systematic comparison of witnesses or revisions;
- **apparatus** — a compact presentation of variants, evidence, and provenance;
- **gloss** or **annotation** — explanatory material attached to a technical
  record;
- **provenance**, **transmission**, and **recension** — use only when tracking
  origin, transformation, or a distinct derived version.

Do not rename ordinary software concepts merely to add atmosphere. A file is
a file unless its role as a witness matters. A finding remains a finding.

Two specialized labels are explicitly part of the Amanuensis voice:

- **Decision docket** — a bounded list of unresolved decisions and the
  information needed to make them. Do not use it as a synonym for all findings.
- **Warrants** — the explicit reasoning that connects evidence to a claim or
  recommendation. Keep the underlying evidence directly reachable.

## Avoid decorative registers

- Avoid clinical labels such as `casefile`, `triage`, `diagnosis`, or
  `condition` when the object is a finding, priority, status, or decision.
  Technical uses such as race condition and precondition remain correct.
- Avoid implying personal memory or task prediction. Prefer `Continue
  reviewing` over `Resume this report` unless reader-specific state actually
  exists and is disclosed.
- Prefer `Supporting evidence` over `Evidence trail`, and `Not yet surveyed`
  over `Unseen territory`.
- Do not style the interface as paper, parchment, a field notebook, an archive,
  or a manuscript facsimile. Textual-critical precision does not require
  antiquarian visual treatment.
- A bookish display face, square geometry, restrained rules, and a green-gray
  palette may give the report character without pretending that the screen is
  a physical page. Avoid beige fields, paper textures, curled edges, ornamental
  stamps, and redundant document furniture.
- Avoid decorative metaphor in navigation. Use direct labels that remain
  meaningful when read out of context.

## Present records for reading, not storage inspection

Markdown tables are a portable schema projection. The HTML projection must
choose a presentation from the reader's operation, not reproduce every stored
field as an equally prominent column.

- Use a semantic table only when readers need to compare several records on
  the same attributes in both directions. Keep row and column headers explicit.
- Use a ruled record register for records dominated by prose or for rows whose
  fields have different reading priorities. Use `<article>` for independently
  addressable records and `<dl>` for compact name/value facts.
- Keep identifiers, status, evidence quality, paths, and revision provenance
  visible but subordinate to the language that explains consequence, role, or
  scope. Do not spend a peer column on a short revision hash.
- Do not split long causal prose into parallel columns merely because the
  source has two fields. Preserve a stable reading order and a comfortable text
  measure.
- A finite run of adjacent narrative paragraphs may use the full available
  single-column measure until its own reading field reaches `120ch`. At that
  intrinsic threshold, balance it into two columns; use three columns only
  when the same field reaches `190ch`. Query the prose container rather than
  the viewport so navigation, zoom, and embedding geometry participate. Keep
  source order ordinary, preserve a single-column fallback, use generous
  gutters, and never pour records, tables, code, or an unbounded page into the
  multicolumn flow.
- Do not put critical qualifications behind disclosure by default. Disclosure
  is appropriate for receipts and supporting detail after the record is usable.
- Omit genuinely absent optional facts instead of displaying empty cells or
  false-valued boilerplate.
- Choose projections by a known schema or record type. Unknown tables remain
  tables until Amanuensis has an explicit presentation contract; text-length
  heuristics are not a substitute for semantics.

Current typed projections:

- Findings are one anchored article each: compact identity and status,
  consequence-led observed behavior, then root cause in sequence.
- File ledgers are ruled registers: filename and full path with review and
  revision facts, beside the dominant `Why in scope` account.
- Concern-review records keep concern, verdict, evidence, and any actual
  linchpin together; rationale receives the reading measure.
- Symbol/role/source inventories and subsystem plans are record registers.
- State-container lifecycles, coverage matrices, and other genuine cross-record
  comparisons remain tables. Merge a subordinate location into the row header
  when that improves scanning without losing its label.
- Two-column term/meaning and metric/value data become definition lists.

Use ruled registers rather than a grid of rounded cards. The goal is a quiet,
continuous reading surface with clear record boundaries, not a dashboard tile
for every row.

## Architecture and source routes

- Treat an opaque known identifier as a coordinate plus a definition, never as
  self-explanatory copy. Wrap every visible occurrence in semantic definition
  markup with a descriptive native title and matching accessible name;
  especially enforce this in table headers, matrix axes, navigation, and
  compact metadata. Where space permits, print the human name beside the code
  rather than relying on the tooltip alone.
- Do not present a nodes-only diagram as a dependency graph. If no dependency
  edges are recorded, say so and render the linked subsystem inventory as a
  layer atlas. Never infer edges from names, prefixes, or nearby seams.
- A topology view must retain a complete readable relation account. Group seams
  into connected areas, name the hub where one exists, keep the shared object
  out of a cramped edge label, and link every subsystem and seam.
- Use a compact atlas for place and a separate topology for recorded relations;
  neither should become a decorative heroic graph or the only route to content.
- When the recorded workspace has a verified `github.com` origin, make file
  identities open the reviewed path at that record's revision. Keep the full
  repository-relative path visible and copyable. Never guess a repository URL.
- Translate method/storage labels at the projection boundary. Prefer `Concern
  review` over `Concern dispositions`, `Start here` over `Jump-in reading`, and
  `Related subsystems` over `Cross-references` as page headings. Durable schema
  names may remain unchanged.

## Projection copy examples

| Avoid | Prefer |
|---|---|
| Casefiles | Findings |
| Four conditions | Project status |
| Resume this report | Continue reviewing |
| Evidence trail | Supporting evidence |
| Unseen territory | Not yet surveyed |
| Living architecture evidence register | Architecture survey produced by Amanuensis |

Keep labels concise. Put qualifications in adjacent hints or definitions,
not in invented terminology.
