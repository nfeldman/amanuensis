# Store-only: the database holds everything, HTML is the only published projection

- Status: plan, 2026-11-20. Owner decisions D1–D16 decided 2026-11-20 (§9): every
  recommendation accepted, D16 as amended there. Lane launched 2026-11-20 on branch `store-only`,
  cut from `main` at `32ad430` (the orientation merge). Between `3b9e885` and `32ad430` only
  `BACKLOG.md` changed, so every line reference below still holds at the lane's base.
- Decision being planned: `BACKLOG.md`, "The database holds everything; HTML is the only
  published projection" (owner, 2026-11-20). Diagrams join this plan (owner, same day).
- Baseline: branch `orientation` at `3b9e885`, its final whole-branch review (worktree
  `~/automation/claude/amanuensis-orientation`). Every file and line reference below is to that branch unless it says `main`.
  The lane for this plan must be cut from `main` **after** `orientation` merges (§10).
- Corpora read, not written: this repository's store (`.amanuensis/`, 9 subsystems, 12 artifacts)
  and AxiomDB's (`~/repos/axiomdb/.amanuensis/`, 35 subsystems, 41 artifacts), with
  `sqlite3 -readonly` and `shasum`. No Amanuensis tool, skill or CLI was run.
- Diagram source: `design/diagrams/CATALOG.md` in the primary checkout. It is local and not
  committed, so a lane worktree will not have it. Every rule a diagram packet needs is restated
  in Appendix B; packets must not cite the catalog as their only source.
- Labels: **[O]** observed in source or a store, with a location. **[M]** measured (counted).
  **[J]** a judgment proposed here.
- Review: one cross-family read (`codex exec -s read-only -m gpt-6.1-sol`, 2026-11-20), saved in
  `reviews/codex-plan-review.md`; all 16 findings were accepted and folded in (§12).
- Format: the orientation lane's `design/orientation/PLAN.md` and `plan.json`. `plan.json` here is
  the executable form of §8; where the two differ, fix the JSON to match this file.

## 0. Summary

Two gaps, as the backlog states them, and one correction to it.

1. **The skill has the agent hand-write seven prose files.** Two of them (`master-plan.md`,
   `findings-index.md`) and most of a third (`field-notes.md`) duplicate tables and are never
   read. The others carry content no table holds: the project thesis and name, the runtime
   boundary map, territory calibration and probes, reading guidance, and every subsystem's
   survey narrative. On AxiomDB that narrative is the **only** record of the structural
   inventory: the store holds **0 claims** **[M]**, so every subsystem page prints its
   `<id>-<slug>.md` file (333 KB in all), under Structure or, where an account is recorded, as the
   survey record at the end of the page (`narrative_placement`, `renderers.py:237-250`).
2. **HTML is parsed out of Markdown files on disk.** Each renderer returns Markdown text; the run
   writes `.md`; the xref pass rewrites those files; `html_projection.py` reads them back and
   parses them with a custom line-based parser and about twenty recognition hooks (table header
   signatures, emoji chips, Mermaid shapes, heading levels).
3. **Correction.** The backlog says the read-back "compares the two". It does not. The read-back
   censuses **both** views against store rows, once per suffix (`readback.py:1004-1041`), and
   hashes every file into `.projection-contract.json`. That is the right shape; it only has to
   drop the Markdown branch and cover the new records and diagrams.

The plan, in order:

- **Records first** (S1). New append-only tables and tools for every piece of hand-written
  content that no table holds, plus flow marks (the first code-diagram record), plus a one-shot
  import that copies every existing artifact's bytes into the store with its provenance.
- **Pages from the store** (S2). The materializer stops reading the storage directory; the skill
  stops writing files.
- **HTML without Markdown** (S3). Split the parser into "Markdown → page model" and
  "page model → HTML", stop writing `.md`, then convert renderers to build the page model
  directly, family by family, each proven byte-identical against golden HTML; then delete the
  parser.
- **Read-back and publication** (S4). Every rendered record and diagram carries a machine mark the
  read-back checks against the store; the publishing chain and downstream copies carry HTML.
- **Diagrams** (S5). Shared SVG primitives, the survey workflow and status ladder, coverage bars,
  finding badges, the seam contract, and the flow strip.

## 1. Inventory

### 1.1 What the skill has the agent write by hand

Seven files, all in the storage root `.amanuensis/` except where noted. Skill locations are in
`.claude/skills/amanuensis/`. "Read by" lists every code reader found.

| # | File | Written at | Read by | Content no table holds |
|---|---|---|---|---|
| 1 | `onboarding-report.md` | `onboarding.md:190-192` (Phase 7); runtime table under an exact heading `:46-56`; non-applicable territories `:80-81` | passthrough page "Onboarding record" (`core.py:570`, `renderers.py:3880-3889`); runtime table parsed for the architecture SVG (`diagrams.py:342-379`); project name from its `**Codebase**:` line (`renderers.py:534-541`) | repository shape and directory cluster map; runtime boundary map; stateful entities; concern calibration prose; recommended first mapping. (Draft master plan duplicates `subsystems`; questions duplicate `open_questions`.) |
| 2 | `concern-checklist.md` | `onboarding.md:193-194` | passthrough page "Review checklist" (`core.py:568`), reshaped by `_CONCERN_CHECKLIST_PROJECTION` in HTML | each concern's source territory and codebase-specific probe; non-applicable territories and their disqualifying condition; competing-concern warnings. `concerns` has code, category, origin, status, notes only (`schema.sql:137-149`). |
| 3 | `master-plan.md` | `onboarding.md:195`; updated `phase-5-packaging.md:14-21`, `subsystem-survey.md:103-104` | **nothing**: the published page is built from `subsystems` (`render_master_plan`) | "Pending activities" prose only. |
| 4 | `findings-index.md` | `onboarding.md:196`; updated `phase-5-packaging.md:23-29` | **nothing** | nothing; `findings` is "the queryable form of findings-index.md" (`schema.sql:338`). AxiomDB's copy has 35 KB including a "What is *not* recorded here, and why" section. |
| 5 | `entry-point.md` | `onboarding.md:197-204`; updated `phase-5-packaging.md:31-43` | the overview's thesis, by heading "What is this codebase?" (`renderers.py:360-442`, `read_thesis`); passthrough page "Where to begin" (`core.py:571`). `record_explanation` does **not** read it; it refuses a project purpose and names the file (`explanations.ts:45,72`). | the thesis (the project's purpose); reading guidance ("Minimal bootstrapping read", and in this repository's store free sections such as "Given a bug report"). Domain vocabulary duplicates `vocabulary`; directory map, knowledge-depth contract and mode selection are template boilerplate. |
| 6 | `field-notes.md` | `onboarding.md:205` (seeded once) | **nothing**: the page is built from `field_notes` | the longer narrative around each note. |
| 7 | `<id>-<slug>.md` survey narrative (this repository's store keeps them under `subsystems/`) | Phase 2 writes it (`phase-2-structural.md:201-218`); Phase 4 appends "Adversarial review" (`phase-4-adversarial.md:78-79`); a lock is taken on its path (`subsystem-survey.md:46`) | the `concerns` advance requires one registered row (`invariants.ts:1227-1234`); the subsystem page embeds every body (`renderers.py:1551-1566`, placement by `narrative_placement`, `:237-250`); `describe_locus` returns its path and hash (`locus.ts:488-511`) | narrative around the structural inventory, concern reasoning, adversarial narrative. Typed parts already have tables: `claims` (key-type, state-container, flow, concurrency, seam keys), `seams`, `vocabulary`, dispositions, claim challenges, `explanations`. |

Also in the skill, not written in practice:

- **8. `_meta/prompts/<timestamp>-<role>-<seq>.md`** dispatch prompts: a template
  (`artifact-templates.md:395-419`) that no step tells the agent to write; `log_dispatch`'s
  description points at it (`dispatch.ts:14`). Neither real store has a `_meta/` directory **[O]**.
- **`seam-assessment`** is an artifact kind no step registers; seam assessment goes to
  `upsert_seam` (`SKILL.md:274-279`). The memory audit is chat output (`memory-audit.md:147-171`).

Prose the agent writes **through tools** today, already in the store and unchanged by this plan:
`explanations.body`, `subsystems.scope`/`jump_in_reading`/`notes`, finding and field-note text,
disposition rationales, seam read/write fields.

Files the **server** writes, which are exports rather than hand-written content and are not
published pages: review exports (`review-session.ts:738-786`, JSON and Markdown, registered as
kind `other`; the payload is also stored in `review_exports.export_json`), `compare_conspectuses`'s
optional `write_to` Markdown (`compare.ts:505-513`), and the research handoff's required
`claims.md` in a research worker's own workspace (`research.ts:546`). Out of scope (D9).

The `artifacts` table **[O]** (`schema.sql:1087-1101`): `path` (relative to storage), `kind`
(`onboarding-report`, `entry-point`, `master-plan`, `findings-index`, `concern-checklist`,
`field-notes`, `subsystem-survey`, `seam-assessment`, `dispatch-prompt`, `other`), `subsystem_id`,
`content_hash` (sha256), `ref_sha`, `session_id`, `written_at`, `bytes`, `notes`. The materializer
prints `content_hash` in the survey narrative's provenance (`renderers.py:1669-1671`) and puts the
artifact rows in the page's manifest sources, but decides re-rendering by hashing the prose bytes
itself (`renderers.py:736-740`), so the skill's statement that rehashing is "what the materializer
reads to decide whether to re-render" (`phase-5-packaging.md:56-57`) is wrong.

Other readers of `artifacts` **[O]**: `score_composition_item` requires a registered row, its hash
and its target revision for an item of kind `artifact` (`composition.ts:461-472`); the memory
audit reads `written_at` and checks for missing files (`memory-audit.md:133-145`).

### 1.2 Pages the materializer builds from Markdown

Every page is built from Markdown: renderers return `(markdown_text, sources)` (`core.py:303-346`),
the run writes `<output>/<page>.md`, `xref.resolve_all` rewrites those files (`core.py:353-373`),
and `render_html_projection` reads the finished files back and parses them
(`html_projection.py:3531-3548`, `MarkdownRenderer` at `:3019-3173`).

Pages whose Markdown includes **file bodies from the storage directory** **[O]**:

| Page | Disk prose it reads |
|---|---|
| `index` (Project overview) | thesis from `entry-point.md`; project name from `onboarding-report.md` |
| `architecture` | runtime boundary table from `onboarding-report.md` |
| `subsystems/<slug>` (one per subsystem) | every registered `subsystem-survey` body |
| `concern-checklist` (Review checklist) | whole file, verbatim |
| `onboarding-report` (Onboarding record) | whole file, verbatim |
| `entry-point` (Where to begin) | whole file, verbatim |

The other 18 static pages and every matrix page are built from store rows only. The guide is
built from the page plan and the contract.

HTML recognition hooks that exist only because HTML is parsed from Markdown **[O]**
(`html_projection.py`): block grammar (marker comments, anchors, fences, headings opening
sections, tables, lists, blockquotes); the inline subset in `_inline` (`:1533-1615`: code spans,
links with `.md`→`.html`, emoji and whole-cell status chips, display phrases, emphasis); table
signatures (`_SUBSYSTEM_ATLAS_PROJECTION`, dependency and seam topology, runtime boundary,
O8 boundary diagram, concern checklist, coverage index, 12 `_RECORD_PROJECTIONS`, summary
lists, lifecycle tables, the guide's enum tables (`_ENUM_TABLE_PROJECTION`, `:1807`, which prints
stored values literally so no enum's label replaces them), hot-spot facets, `_DISPLAY_FIELD`); Mermaid (`graph` → relationship
trace, `pie showData` → staleness bars); page- and section-specific hooks (legend skipping,
heading renames, `<details>` for the full vocabulary, finding headings by level); and the
`<abbr>` identifier pass over the finished HTML.

Also written: `search-index.js`, `.manifest.json`, `.projection-contract.json`. CSS and JS are
inline in each page.

### 1.3 Where each piece of content goes

| Content | Record that holds it | New? |
|---|---|---|
| Project thesis | `explanations` row, `subject_type='project'`, `slot='purpose'` | widened CHECK (§2.2) |
| Project name | `project_profile.name` | new |
| Runtime boundary map | `runtime_boundaries` rows, one per edge, with evidence | new |
| Repository shape, cluster map, stateful entities, concern calibration, first mapping, pending activities, reading guidance | `narratives` rows on the project, one section each (§2.1) | new |
| Concern source territory and probe | `concerns.territory`, `concerns.probe` | new columns |
| Non-applicable territories and their condition | `territory_dispositions` | new |
| Survey narrative (structure, concern reasoning, challenge) | `narratives` rows on the subsystem | new |
| Flow marks (commit point, crash point, exit, seam crossing, trigger) | `claim_marks` | new (§7) |
| Draft master plan, master-plan tables | `subsystems` (exists) | dropped as files |
| Findings index | `findings` (exists) | dropped |
| Field notes file | `field_notes` (exists) | dropped |
| Domain vocabulary, directory map, depth contract, mode selection | `vocabulary`, page plan, contract (exist) | dropped |
| Dispatch prompts | not kept (D8) | dropped |
| Every existing file's bytes, as written | `imported_artifacts` | new (§5) |

## 2. Records

All new tables follow the store's conventions **[O]**: declared in `mcp-server/src/schema.sql`
with `CREATE TABLE IF NOT EXISTS`; additive columns and CHECK rebuilds in `runMigrations`
(`db.ts`), which runs before `initializeSchema` on every open; append-only tables get
`_is_immutable` and `_cannot_be_deleted` triggers and a line in `contracts/append-only-tables.txt`;
enums come from `contracts/conspectus-vocabulary.json` through `gen-vocabulary.mjs` (CHECKs are
widened on open by `migrateVocabularyChecks`); writers require an active session
(`requireActiveSession`) and resolve `ref_sha` in the bound workspace; each refusal is a sentence
that starts with the tool's name and names the repair (`check-refusal-parity.mjs`); a correction
is a new row; the effective row is read by one function, never selected ad hoc.

### 2.1 `narratives`: the survey's prose, bound to a revision

Modelled on `explanations` (`schema.sql:583-626`, `tools/explanations.ts`).

```sql
CREATE TABLE IF NOT EXISTS narratives (
    id            INTEGER PRIMARY KEY,
    subject_type  TEXT NOT NULL CHECK (subject_type IN ('subsystem','project')),
    subject_id    TEXT NOT NULL,          -- a subsystem id, or 'project'
    section       TEXT NOT NULL,          -- from contract enum narrative_section
    topic         TEXT NOT NULL DEFAULT '',  -- short title; '' is the section's single body
    disposition   TEXT NOT NULL CHECK (disposition IN ('recorded','declined','withdrawn')),
    body          TEXT NOT NULL,          -- the prose, or the reason none is written / withdrawn
    ref_sha       TEXT NOT NULL,
    session_id    TEXT NOT NULL REFERENCES sessions(session_id),
    recorded_at   TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (length(body) > 0),
    CHECK (length(topic) <= 120)
);
CREATE TABLE IF NOT EXISTS narrative_evidence (narrative_id, evidence_id, PRIMARY KEY (...));
```

- **Sections** (contract enum `narrative_section`, each entry with `subject_type`, `label`,
  `meaning`, `min_status` for subsystem sections, `evidence` = `required` or `optional`):
  - subsystem: `structure` (min `scoping`, written by Phase 2 while the subsystem is still
    `scoping`, per orientation D4), `concern-reasoning` (min `concerns`), `challenge` (min
    `adversarial`). Evidence required, at least one row citing a file in the subsystem's ledger.
  - project: `repository-shape`, `runtime`, `stateful-entities`, `concern-calibration`,
    `start-here`, `survey-plan`. Evidence required except `survey-plan` (a plan, not a reading).
- **Topic** replaces headings. A section holds several narratives, one per topic (for example
  `structure` / "on_write_commit dispatch"); the effective row is per
  `(subject, section, topic)`. The renderer prints the topic as a subheading. **[J]**
- **Shape.** The body uses the stored-prose grammar (§3.4): paragraphs and lists, code spans,
  emphasis, links; no heading or table line (the page owns its structure; tables are records).
  Cap 8192 UTF-8 bytes per body **[J]**; the orientation lint runs on write, as
  `record_explanation` does (`orientation-lint.ts`).
- **Tools.** `record_narrative`, `decline_narrative` (reason, one paragraph, ≤400 bytes),
  `get_narratives` (effective rows, optional history). Refusals name the status rung, the
  missing evidence, the cap, or the shape.
- **Reset.** `reset_subsystem` appends a `withdrawn` row for every effective subsystem narrative,
  as it does for explanations, instead of deleting artifact rows (`subsystems.ts:423-425`).
- **Ageing.** A narrative is bound to `ref_sha`. The page prints its date and revision, and marks
  it ageing when a cited file is stale, exactly as explanations are. This also covers backlog
  item "Other prose ages too" for the survey notes.

### 2.2 Project records

- **Thesis.** Rebuild `explanations` without the CHECK that forbids a project purpose
  (`subject_type <> 'project' OR … slot = 'account'`), the way `migrateClaimsNeverHeld` rebuilds
  `claims`. Add `'imported'` to `disposition` for the thesis copied in by §5 (no evidence; D2).
  `record_explanation(subject_type='project', slot='purpose')` is accepted at any status with one
  paragraph, ≤400 bytes and at least one evidence row; the "entry-point.md" refusal sentences
  go. The project account keeps its "first structural subsystem" rule. Every reader of the
  effective row must treat `imported` like `recorded` for a project purpose and nowhere else:
  `readExplanation`'s state (`invariants.ts:436` admits only `recorded` and `declined` today), the
  Python `effective_explanations` (`readback.py:405`) and the read-back's `_explanation_census`.
  The read side must admit the slot too: `get_explanations` lists only `account` for the project
  (`SLOTS_OF`, `explanations.ts:168-171`), and project eligibility in TypeScript
  (`invariants.ts:473`) and Python (`readback.py:317`) requires a structural subsystem whatever the
  slot. A purpose recorded at onboarding, before any subsystem is structural, must be readable and
  must render.
- **`project_profile`** (append-only, effective = newest): `name`, `ref_sha`, `session_id`,
  `recorded_at`. Tool `record_project_profile`. Replaces the `**Codebase**:` line.
- **`runtime_boundaries`** (append-only rows, effective = newest per
  `(from_runtime, to_runtime, mechanism)`, withdrawal by a row with `withdrawn = 1`):
  `from_runtime`, `from_language`, `to_runtime`, `mechanism`, `notes`, `origin`
  (`recorded`|`imported`), `ref_sha`, `session_id`; `runtime_boundary_evidence` (required for
  `recorded`). Tools `record_runtime_boundary`, `withdraw_runtime_boundary`,
  `get_runtime_boundaries`. The five columns are today's table (`artifact-templates.md:58`).
- **Concern calibration.** `concerns` gains nullable `territory` and `probe` (additive migration);
  `add_concern` takes them. `territory_dispositions` (append-only, effective = newest per
  territory): `territory` (from `concern-territories.md`'s ids), `disposition`
  (`applies`|`disqualified`), `condition` (the disqualifying condition), `open_question_id`
  (nullable), `ref_sha`, `session_id`. Tool `record_territory_disposition`.

### 2.3 `claim_marks`: flow marks (catalog N1)

See §7.2. Recorded early because surveys must accumulate them before the flow strip has
anything to draw.

### 2.4 `imported_artifacts`: every existing file, as written

Immutable, one row per artifact path imported by §5: `path`, `kind`, `subsystem_id`, `body`
(the file's bytes as UTF-8 text), `body_sha256`, `registered_hash` (the `artifacts.content_hash`
at import), `hash_matches` (0/1), `registered_ref_sha`, `written_at` (from `artifacts`),
`imported_at`, `session_id`. `imported_artifact_withdrawals(path, reason, session_id, at)` lets
`reset_subsystem` retire an imported survey body without deleting it.

### 2.5 What stops

- `register_artifact` and `rehash_artifact` refuse every hand-written kind with a sentence naming
  the record tool that replaces it. `other` stays for the server's own exports. (D7 for removing
  the tools entirely.)
- The `concerns` prerequisite (`invariants.ts:1227-1234`) becomes: an effective `structure`
  narrative (recorded or declined), **or** an imported, unwithdrawn `subsystem-survey` body for
  the subsystem (so an existing store's in-flight subsystem is not stranded).
- `describe_locus`'s narrative pointer (`locus.ts:488-511`) points at the structure narratives
  (or the imported body) by record id, with its revision; `revision_bound` becomes true for a
  recorded narrative.
- Composition (`composition.ts:461-472`) gains an item kind `record`: the expected reference names
  a narrative or explanation row, and scoring checks that the row exists, is effective and was
  recorded at the item's target commit. Items of kind `artifact` keep working for the server's own
  exports (kind `other`).

## 3. Rendering

### 3.1 Target shape

`renderer(conn) → Page` (a page model) `→ html_writer(Page) → HTML`. No Markdown text exists at any
point except inside stored prose bodies, which a small prose renderer turns into model inlines.

The page model is the data the HTML builders already consume after parsing **[J]**: a page has a
title, head fields (hint, use_when, terms), and sections; a section has blocks. Block kinds, one
per recognition hook in §1.2 so nothing is lost:
`Heading`, `Paragraph(inlines)`, `List`, `Code`, `Quote`, `Anchor`, `RecordMarker`,
`Table(columns, rows)`, `RecordList(kind, rows)` (the 12 record projections), `SummaryList`,
`LifecycleTable`, `Atlas`, `Topology(kind)`, `RuntimeDiagram`, `BoundaryDiagram`,
`CoverageIndex`, `ConcernChecklist`, `EnumTable` (values printed literally), `StalenessBars`, `RelationshipTrace`, `Facets`, `Details`,
`Figure(svg_model)`, `Notice`. Inlines: `Text`, `Code`, `Emph`, `Strong`, `Link`, `RecordRef`
(an ID with its target and definition, replacing the post-hoc `<abbr>` pass), `Chip(enum, value)`
(replacing emoji and whole-cell word recognition).

The builders in `html_projection.py` (`_record_list`, `_subsystem_atlas`,
`_runtime_boundary_diagram`, `_boundary_diagram`, …) are kept and fed from model blocks; the
recognition step that found their input in parsed Markdown is what goes.

### 3.2 Route: split, move the tests, stop writing Markdown, convert, delete

A big-bang rewrite of ~4,000 lines of renderers is not executable by Sonnet in one packet and
would have no reference to check against. The route keeps a byte-identical reference at every
step **[J]**:

1. **Split** (SO11). `MarkdownRenderer` becomes `parse_markdown(text) → Page` plus
   `write_html(Page) → str`. The pipeline is Markdown → Page → HTML; HTML output is byte-identical
   on a golden corpus of fixture stores.
2. **Move the tests** (SO12). While `.md` is still written, every test that asserts on a generated
   `.md` page is moved to the same assertion on its `.html` twin (§11). The suites stay green; a
   Markdown-only assertion with no HTML equivalent is named in the commit message with its reason.
3. **HTML only** (SO13). The run stops writing `.md`; Markdown lives in memory between a renderer
   and `parse_markdown`; xref resolution runs on that in-memory text; the read-back drops its
   Markdown branches. The published directory holds `.html`, `search-index.js` and the two
   contract files. A previous publication's `.md` files that the old manifest claimed are removed
   (non-clean mode) or vanish with the swap (clean publish); an unmanaged `.md` is still refused.
4. **Convert** (SO14–SO18). Each renderer family returns a `Page` directly. Gate: HTML for those
   pages equals the current golden HTML, and `parse_markdown` is not called for them (an
   instrumented counter).
5. **Delete** (SO19). `parse_markdown`, the Markdown xref rewrite and every recognition hook go.
   Page ids lose `.md` (`index.md` → `index.html` in `PagePlan`). The composite-index lint, which
   today runs over the whole rendered `index.md` (`renderers.py:1250-1257`), runs over the
   overview model's text. The one Markdown reader left is `legacy_prose.py` (§3.4), for imported
   bodies only.

**Golden corpus.** The fixture stores the materializer tests already seed (`test-materializer.py`,
`test-lens-pages.py`), plus a fixture shaped like AxiomDB (imported bodies with tables and fences,
0 claims, seams, no xrefs, a recorded account on some subsystems) and one shaped like this
repository's store. Files live under `materializer/fixtures/store-only-golden/` with a `VERSION`
file naming the packet that last wrote them. **Update rule:** only SO11 (red commit, from the
unchanged tree), SO13 (green commit, HTML only), SO20 (record and census attributes) and SO22–SO25
(their diagrams) may regenerate it, each in its green commit, and each of those gates asserts that
the regenerated files differ from the previous version **only** inside the elements the packet
adds (attributes named in §3.5, or `<figure data-diagram="<kind>">` blocks). Every earlier
conversion gate compares against the current version, so it stays meaningful after a regeneration.

### 3.3 Store-sourced content before the page model (S2)

Switching sources is independent of the Markdown question and is done first, in today's pipeline,
so the redesign never has a state where pages lose content:

- thesis from the effective project-purpose explanation (recorded or imported); project name from
  `project_profile`, else the imported name (§5), else the binding (`renderers.py:541`);
- runtime map from `runtime_boundaries`;
- subsystem narrative from effective `narratives` plus unwithdrawn imported survey bodies,
  keeping `narrative_placement`'s four cases and O13's dated line;
- "Onboarding record", "Review checklist" and "Where to begin" become generated pages from the
  project narratives, concerns with territory and probe, territory dispositions and the imported
  bodies (shown under "As written at onboarding", D1);
- the manifest's `prose:` sources become `db:` sources. No prose file under the storage root is
  read. The binding files (`workspace_path`, `initialization.json`, `project_identity`) are still
  read for workspace resolution and as the project-name fallback (`renderers.py:459`,
  `readback.py:216`); SO8's gate instruments file opens under storage and allows exactly those and
  the database files.

### 3.4 Stored-prose grammar

Bodies stored by `record_explanation`, `record_narrative` and the other prose fields are text in
a documented subset, rendered by `prose.py` into model inlines and blocks: paragraphs; `-`, `*`
and numbered lists; code spans and fenced code; `*`/`_` emphasis; `**` strong; links; record IDs,
which become `RecordRef`. No headings, tables, raw HTML or images. The writers already refuse
heading and table lines for explanations (`isProseAndLists`); narratives use the same rule. A
link to `<page>.md` in older prose is rewritten to `.html`, as `_html_href` does today. (D13.)

**Imported bodies are the exception.** They are full Markdown: headings, tables, fences, links,
lists, and tables whose header matches a record projection (a survey narrative's key-type and
state-container tables match `structural-inventory`). `legacy_prose.py` renders them: the block
grammar of today's parser, heading levels shifted as `_nest_prose` (`renderers.py:256-288`) does,
and the record-list projections applied as today, so their HTML is unchanged. It is the only
Markdown reader that survives SO19, and SO19's gate asserts nothing but the imported-body path
calls it. When the last imported body in a store is withdrawn by re-survey, nothing in that store
uses it.

### 3.5 Read-back: HTML against the store

Today **[O]** (`readback.py:971-1164`): three axes. State: finding markers once per view, and
censuses for finding partition, stale ledger, carried records, the search index and explanations,
each per suffix. Coverage: planned pages and their twins present, local links and anchors,
coverage measurements. Content: SHA-256 of every page against `.projection-contract.json`,
receipt membership, the render-notice census. Recorded by `recordReadback`
(`materialize.ts:127-212`) into `projection_verification_runs` and `projection_mismatches`.

After SO13 every census runs on HTML only. SO20 completes it:

- **Record marks.** The HTML writer emits `data-record="<type>:<id>"` and, where a state is
  printed, `data-state="<enum value>"` on every rendered record (finding, subsystem depth, claim,
  disposition, seam, narrative, explanation, imported body, runtime boundary, territory
  disposition). The read-back checks, per record type: each record the page plan says a page
  shows appears there exactly once (coverage), its printed state equals the store's (state), and
  a prose body's text equals the stored body after the prose renderer's normalisation (content).
- **Diagram census** (catalog rule 14). Every drawn node and edge carries `data-node="<record>"`
  or `data-edge="<record>"`. The read-back parses the SVG elements themselves, not a summary
  attribute, recomputes the diagram's model from the store, and compares the two sets. A drawn edge
  no record joins, or a missing node, is a content mismatch. A summary attribute written by the
  same function that drew the SVG would only check itself.
- **Sabotage tests reseal.** Each read-back sabotage edits a page and then rewrites
  `.projection-contract.json` for the edited bytes, so the hash check cannot be what turns it red;
  the semantic census must.
- The axis names and the two tables stay as they are, so `render_index`, `refresh.ts` and O12's
  label keep working.

## 4. Skill changes

The skill stops writing files (SO10). Concretely, in `.claude/skills/amanuensis/` only (then
`node scripts/prepack-bundle-assets.mjs` regenerates the gitignored packaged copy):

- `onboarding.md` Phase 7: replace "write the prose artifacts" with the record calls:
  `record_project_profile`; `record_explanation(project, purpose)` for the thesis (with its
  acceptance check moved from the file to the recorded body); `record_runtime_boundary` per row
  (Phase 2's "exact heading" instruction goes); `record_narrative(project, …)` for repository
  shape, stateful entities, concern calibration, start-here and survey plan;
  `add_concern(territory, probe)`; `record_territory_disposition`. Delete the master plan,
  findings index and field-notes file steps; the tables already hold them.
- `phase-2-structural.md`: replace "write `<id>-<slug>.md` and register it" (`:201-218`) with
  `record_narrative(subsystem, structure, topic, …)` per topic, or `decline_narrative` with a
  reason. Add flow marks to step 3 (§7.2), discharge-or-decline.
- `phase-3-concerns.md`: reasoning that did not fit a disposition rationale goes to
  `record_narrative(subsystem, concern-reasoning, …)`; stop reading the file (`:19`), read
  `get_narratives` instead.
- `phase-4-adversarial.md`: the "Adversarial review" section becomes
  `record_narrative(subsystem, challenge, topic=<finding or claim key>, …)`.
- `phase-5-packaging.md`: delete steps 1–4 (master plan, findings index, entry point,
  register/rehash) and the inaccurate rehash sentence; keep "Settle the explanations"; add
  "settle the narratives" (revise by a new row, or confirm).
- `subsystem-survey.md`: the lock is taken on the subsystem id, not a file path (`:46`); the
  summary list loses the file steps.
- `artifact-templates.md` → `records.md`: one section per record family saying which tool holds
  which part and what each section's narrative contains. The dispatch-prompt template goes (D8).
- `memory-audit.md`: the artifact checks (`:133-145`, `:179-181`) become narrative checks
  (effective rows exist per mapped subsystem; ageing ones listed).
- `explanations.md`, `SKILL.md`: the thesis is a recorded project purpose, not a file section.

Gate (`dev/test-skill-no-file-writes.mjs`): the skill names no `register_artifact`,
`rehash_artifact`, `artifact-templates.md`, and no instruction to write or append a `.md` file in
the storage directory; every record tool it calls exists (`check-reference-calls.mjs`), and each
of `record_narrative`, `record_runtime_boundary`, `record_project_profile`,
`record_territory_disposition`, `record_claim_mark` and `record_explanation(project, purpose)` is
called at the step this section names.

## 5. Migrating existing stores

### 5.1 What opening a store does

Opening a store with the new server runs only schema work: new tables, the two `concerns`
columns, the `explanations` rebuild. It reads no file. **[J]** Reading files on open would make an
open's result depend on the storage directory.

**The rollout boundary is the next open, not a release.** AxiomDB's `.mcp.json` launches
`${AMANUENSIS_HOME:-/Users/nfeldman/repos/amanuensis}/mcp-server/dist/index.js`, and that server
reads `schema.sql` beside itself and migrates on open (`db.ts:14`, `:67`). So once the lane's branch
is merged into the primary checkout and `dist` is rebuilt, the next nightly session migrates
AxiomDB's store (new tables, the `explanations` rebuild). An older server opening a migrated store
is not tested today. D16 (decided): snapshot both stores with
`sqlite3 <db> "VACUUM INTO '<backup>'"` immediately before the rebuild, as a rollback point for
the lanes; no pause; the next nightly open migrates. SO2's gate checks that the base-tree server still opens a store the new
server migrated (it builds the base tree's `dist` into a temp directory).

### 5.2 The import

`import_artifact_bodies` (server tool, active session required, idempotent, `dry_run` flag):

1. For every `artifacts` row of a hand-written kind (`onboarding-report`, `entry-point`,
   `master-plan`, `findings-index`, `concern-checklist`, `field-notes`, `subsystem-survey`,
   `seam-assessment`, `dispatch-prompt`) whose path is not yet in `imported_artifacts`: read the
   file under storage (same containment checks as `resolveArtifactPath`), store its bytes, its
   sha256, the registered hash and whether they match. A missing file is reported and imported as
   nothing; it is not an error for the rest.
2. Extract, with the materializer's own functions (spawned as `orientation-lint.ts` spawns the
   lint, so there is one copy of each rule): the thesis (`read_thesis`) → an `explanations` row
   `(project, purpose, 'imported')` with the body exactly as the overview prints it today; the
   project name (the `**Codebase**:` line) → `project_profile`; the runtime boundary table
   (`diagrams._runtime_boundary_table`) → `runtime_boundaries` rows with `origin='imported'`.
   Nothing else is parsed: no claims, concerns or narratives are invented from prose.
3. Never write, move or delete a file. The files stay; the storage git repository keeps their
   history.

### 5.3 Per store

**This repository's store** (`.amanuensis/`, storage mode `independent`) **[M]**: 12 artifacts,
34,146 bytes; all 12 files match their registered hash; 6 survey bodies under `subsystems/`
(`B-0N-structural.md`); 9 subsystems, 11 claims, 0 xrefs, 0 seams; 2 project accounts, 17
subsystem explanations. The self-rebuild is waiting (owner, 2026-11-20) and will replace this
store. Importing is cheap and keeps the published self-conspectus renderable by the new
materializer; republishing `docs/` needs the dogfood receipt re-recorded
(`publishing-docs-breaks-the-dogfood-gate`). (D6.)

**AxiomDB's store** **[M]**: 41 artifacts, about 455 KB: 35 survey bodies (333 KB), entry point
(24.7 KB), master plan (28 KB), findings index (35.9 KB), onboarding report (14.1 KB), concern
checklist (11.6 KB), field notes (7.2 KB). **0 claims, 0 xrefs, 20 seams**, 438 field notes, 36
concerns. `entry-point.md` no longer matches its registered hash: it is 23,630 bytes against 24,664
registered at `c711feb7` on 2026-11-04; the import records `hash_matches = 0`, and its "as written" block says
"edited after it was registered". Because the store has no claims, the imported survey bodies are
the subsystem pages' only structure; they must render (D1). The import runs where AxiomDB's store
is maintained, the maintenance lane (`~/.claude/automations/axiomdb-maintenance`), after a release
carrying S1–S2, and its next publication is HTML-only (D6, D15, both decided).

### 5.4 Content no record can hold

Nothing is lost: `imported_artifacts` holds every byte. What cannot be **structured** is the prose
itself. The plan does not parse it into claims, narratives or concerns, because every such record
cites evidence read from code and a parse would invent that evidence **[J]**. So:

- Imported survey bodies render on their subsystem page, in the placement O13 gives them, under a
  label: "As written at `<date>`, revision `<sha8>`; kept as written, not tied to evidence." A
  re-survey's narratives and claims replace them (a subsystem reset withdraws them).
- The imported onboarding report, entry point and concern checklist render on the generated
  Onboarding record, Where to begin and Review checklist pages, below the records, under the same
  label.
- Imported master plan, findings index and field notes are held but not rendered: today's pages
  already ignore them and render the tables (§1.1). They stay queryable (`get_imported_artifacts`).
- The imported thesis renders as the overview's purpose with "imported from the entry point, not
  tied to evidence" until a recorded purpose replaces it (D2).

## 6. Downstream copies

D7 decided copies carry the HTML; the copy step is the AxiomDB maintenance lane's, outside this
repository. What a copy carries after this plan:

- every `.html` page (top level and `subsystems/`), `search-index.js`, `.manifest.json` and
  `.projection-contract.json`, exactly as the publication's clean-publish output holds them;
- no `.md` page. O14's sentence ("A copy of the Markdown alone leaves those out") and the "Each page
  is written twice" paragraph are rewritten by SO13, since there is no Markdown view;
- one generated, content-free `README.md` (D10, decided) pointing at `index.html`, because
  GitHub's directory view shows a README and shows `.html` only as source.

In-repository work (SO21): `dev/promote-docs.mjs` and `dev/republish-docs.mjs` copy HTML only and
re-run `materialize.py --readback-only` at the destination, so the same check verifies any copy.
The maintenance lane's publish step then copies the same file set and runs the same read-back; that
change is the owner's, outside the lane.

## 7. Diagrams

### 7.1 Settling the catalog's open questions

| # | Catalog question | Proposed answer | Owner? |
|---|---|---|---|
| 1 | Generic `claim_marks`/`claim_relations` or typed tables | `claim_marks` now, generic, with per-kind rules in the contract (which claim key family a kind applies to, which payload fields it requires); `claim_relations` deferred until N4/N6 are wanted | D3 |
| 2 | Contract entries count as records for method diagrams | Yes. `survey_passes` (O1) gains `actor` and `checkpoint`; the rung prerequisites are described in the contract and a gate checks they agree with `enforcePhasePrerequisites`, rather than the server reading them from the contract. Finding-state transitions join the contract with B5, which is not in this plan | D5 |
| 3 | Commit order for B4 | Not in this plan's packets. When built: git at build time, degrading to an ordered event list without a workspace | listed |
| 4 | Seam assessment (N2) | Not in this plan's packets; A1 ships with "assessable" only | listed |
| 5 | Build code diagrams now (throwaway Markdown plumbing) or after | After: every diagram is built on the page model (S5), so no Markdown signature is ever written for one | settled here |
| 6 | Phase 2 records flow marks from the next survey on; refuse the advance? | Record them from SO10 on, discharge-or-decline; do not refuse an advance, print the gap (A3 draws "not recorded") | D4 |
| 7 | Labelled illustrations | Allowed in the guide, headed "Illustration", no real ID, replaced by a real instance once one exists | D14 |
| 8 | Diagrams on the overview | None; the overview keeps reader-lenses §7.2's five items | D14 |
| 9 | Narrow screens | Scroll inside the frame (the precedent), readable account beside it | D14 |

### 7.2 Flow marks (catalog N1)

```sql
CREATE TABLE IF NOT EXISTS claim_marks (
    id           INTEGER PRIMARY KEY,
    claim_id     TEXT    NOT NULL REFERENCES claims(claim_id),   -- claims.claim_id is TEXT
    kind         TEXT NOT NULL,      -- contract enum claim_mark_kind
    label        TEXT,               -- crash-point label, exit status
    target       TEXT,               -- exit: step it unwinds to, or 'leaves-flow'; crosses-seam: seam id
    evidence_id  INTEGER NOT NULL REFERENCES evidence(id),
    ref_sha      TEXT NOT NULL,
    session_id   TEXT NOT NULL REFERENCES sessions(session_id),
    recorded_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
-- plus claim_mark_declinations(claim_id, reason, ...) for "this flow has no commit point"
```

- Kinds: `commit-point`, `crash-point`, `exit`, `crosses-seam`, `trigger`. All apply only to
  current flow-step claims (`<sid>/flow/<slug>/<nn>`, the shape `requireStableClaimKey` enforces);
  `trigger` only to step `00`; `crosses-seam` names an existing seam whose parties include the
  subsystem; `exit.target` names a step of the same flow or `leaves-flow`.
- The evidence row must cite the claim subject's file (as `requireFileAnchoredEvidence` does for
  structural keys).
- Marks inherit the claim's validity: a closed claim's marks are not current; a successor records
  its own. Append-only.
- Tools `record_claim_mark`, `withdraw_claim_mark(mark_id, reason)` (appends a row to
  `claim_mark_withdrawals`, so a mistaken mark is retracted without closing its claim),
  `decline_claim_marks(flow, reason)`; `get_claims` returns current, unwithdrawn marks with each
  claim.

### 7.3 What this plan builds, and what waits

Built (S5, SO22–SO25, on the page model, each with a census gate and read-back): **B1** how a survey runs
(three lanes: agent, server, you; from `survey_passes` with actors and checkpoints), **B2** the
status ladder in the guide and, on each subsystem page, the ladder with a "here" marker and its
climb from `subsystem_status_transitions`; **A5** what was read (coverage bars from
`file_standing` and the latest `scope_reconciliations`); **A4** finding badges on the atlas (O7)
and the boundary diagram (O8), from the hot-spots computation; **A2** the seam contract per seam;
**A3** the flow strip from flow claims and `claim_marks`. **A11**, the runtime boundary SVG,
changes its source to `runtime_boundaries` in SO9.

Waiting (not packets here): A1 complete (needs N2, N3), A6 change impact, A7 concurrency lanes
(N4), A8 state charts (N5), A9 type relations (probably never), A10 flows across subsystems, B3
progress over time, B4 claim life (question 3), B5 finding life (after D5's transitions land),
B6 why stale, B7 store to page, B8 how the records relate. Never: call graphs, churn hot spots,
lifetime charts, a coverage heatmap graphic, an evidence-ladder graphic.

## 8. Packets

Rules for every packet (as in the orientation lane):

- Work in the lane worktree on branch `store-only`; never touch the primary checkout.
- Do not run Amanuensis tools, the skill, or `materialize.py` against a real store. Tests seed
  their own stores (`materializer/test-lens-pages.py`: `make_workspace`, `seed`, `publish`).
- **Gates are hermetic.** No gate reads a real store, a file outside the worktree, or the network.
  The migration and import packets use committed legacy fixtures built by
  `mcp-server/fixtures/build-legacy-stores.mjs` (SO2): a store on the base tree's schema with
  artifacts rows and files shaped like AxiomDB's (0 claims, seams, survey bodies with tables and
  fences, an entry point whose bytes differ from its registered hash) and like this repository's
  (survey bodies under `subsystems/`). The real stores are checked once by a separate acceptance
  command, `mcp-server/accept-store-only-real-stores.mjs`, which snapshots each store with
  `sqlite3 <db> "VACUUM INTO '<tmp>'"` (a consistent snapshot, unlike copying the database and its
  WAL separately), runs migration and import on the snapshot, and prints a report. It is not a gate
  and not a CI step; the owner runs it (D6, D16).
- New gates carry a "Turns red when" header, print exactly one last line `GATE <id> RED: <reason>`
  (non-zero) or `GATE <id> GREEN` (zero), use the packet's own id, and get a step in
  `.github/workflows/test.yml`. A packet that extends an earlier gate gets a new file.
- Every gate that checks rejection also checks acceptance: a valid input of each kind is accepted,
  persisted and read back. A handler that refuses everything must be red.
- Golden HTML changes only under the update rule in §3.2.
- Run tests serially. `biome format` only inside `mcp-server/src`.
- Done means the packet's gate is green, every earlier store-only gate is green, the existing
  suites are no redder than at the packet's start (diff FAIL lines, not exit codes), and the
  packet is committed. Many `dev/` gates are red on `main` already (`main-gate-baseline`); a
  packet is judged by not adding FAIL lines.
- Models: Sonnet by default; SO2, SO7, SO11, SO13 and SO20 name Opus. A second attempt runs on
  Opus.

Order: SO0 → SO1 → … → SO25, one at a time, in number order (dependencies in Appendix A).

### Slice S1 · Records

**SO0 · Record the plan.** Files: `BACKLOG.md`. Add a link to this plan under the store-only item,
the §0 correction about the read-back, and the decisions D1–D16 as one line each, each marked
decided on 2026-11-20 with its outcome (D16 as amended in §9).
Gate `dev/test-store-only-backlog.mjs`: red when the item does not link
`design/store-only/PLAN.md`, still says the read-back compares the two views, or lacks any of
D1–D16.

**SO1 · Contract enums.** Files: `mcp-server/contracts/conspectus-vocabulary.json`,
`scripts/gen-vocabulary.mjs`, generated `vocabulary.py` and `vocabulary.ts`. Add enums
`narrative_section` (per §2.1, with `subject_type`, `label`, `meaning`, `min_status`, `evidence`),
`narrative_disposition`, `claim_mark_kind` (with `applies_to` and `requires`),
`territory_disposition`, `runtime_boundary_origin`, each with `reader_facing` (O1's flag) and
**no `sql` binding yet**: SO2 adds the bindings with the DDL, so `--check-sql` holds at every
commit. Generator validation: a subsystem section without a `min_status` on the ladder; a project
section with one; a mark kind whose `applies_to` is not a claim key family; a duplicate label.
Bump `contract_version` (minor). Gate `materializer/test-store-only-contract.py`: red when any
validation error above is accepted (broken copies run through the generator in a temp dir), or the
generated Python/TS lack the enums. Regressions: `gen-vocabulary.mjs --check` and `--check-sql`,
`check-evidence-vocabulary.mjs`, `test-vocabulary-source.mjs`, `test-orientation-contract.py`.

**SO2 · Schema, migrations and legacy fixtures (Opus).** Files: `schema.sql`, `db.ts`,
`contracts/append-only-tables.txt`, the contract's `sql` bindings and the explanation
disposition's new value `imported`, `mcp-server/fixtures/build-legacy-stores.mjs` and its committed
output, new `mcp-server/test-store-only-schema.mjs`. Tables of §2.1–2.4 and §7.2 (with
`claim_mark_withdrawals`) and their append-only triggers; `concerns.territory`/`probe` by additive
migration; `migrateExplanationsProjectPurpose` rebuilding `explanations` from the canonical DDL, as
`migrateClaimsNeverHeld` does. Gate, on a fresh store and on copies of both legacy fixtures: red
when a new table or trigger is missing; an UPDATE or DELETE on an append-only table succeeds; the
rebuilt `explanations` drops a row, column, index or trigger; a project purpose or an `imported`
row is refused by the schema; any existing table's row count changes; the base tree's server
(built from `git show` of the packet's start commit into a temp directory) fails to open and
smoke-read a store the new server migrated. Regressions: `gen-vocabulary.mjs --check-sql`,
`test-existing-store-migration.mjs` (its cannot-run state), `test-explanations.mjs`,
`test-record-integrity.mjs`, `test-smoke.mjs`.

**SO3 · Narrative tools.** Files: `tools/narratives.ts`, `index.ts`, `invariants.ts`
(`readNarrative`, eligibility), `contracts/refusal-parity.json`, tool inventory,
`tools/subsystems.ts` (reset withdraws narratives and imported survey bodies). Gate
`mcp-server/test-store-only-narratives.mjs` (driving built handlers over fixtures, as
`test-explanations.mjs`): red when a valid narrative of each section is refused or not returned by
`get_narratives`; a structure narrative is accepted on an `unmapped` subsystem; concern-reasoning
below `concerns`; challenge below `adversarial`; a body with a heading or table line, over 8192
bytes, or failing the orientation lint is accepted; required evidence is missing or outside the
ledger and accepted; the effective row is not the newest per `(subject, section, topic)`; a reset
leaves an effective subsystem narrative or imported survey body; a refusal does not start with the
tool name. Regressions: `test-explanations.mjs`, `test-refusal-parity.mjs`,
`check-refusal-parity.mjs`, `check-tool-schemas.mjs`, `test-smoke.mjs`.

**SO4 · Project records.** Files: `tools/explanations.ts` (writer and `SLOTS_OF`),
`invariants.ts` (`readExplanation` admits `imported` for the project purpose; project eligibility
by slot), `readback.py` (the Python eligibility at `:317` and `effective_explanations`), a new
`tools/project-records.ts`, `tools/concerns.ts`, refusal parity. Gate
`mcp-server/test-store-only-project-records.mjs`: red when `record_explanation(project, purpose)`
is refused with valid input before any subsystem is structural, or accepted without evidence or
over 400 bytes; `get_explanations(project)` does not return the purpose, or the Python reader does
not; any refusal still names `entry-point.md`; `record_project_profile`'s effective name is not the
newest; `record_runtime_boundary` accepts a `recorded` row without evidence or a withdrawn edge stays
effective; `add_concern` drops `territory` or `probe`; `record_territory_disposition` accepts
`disqualified` without a condition. Regressions: `test-explanations.mjs`,
`test-explanation-gate.mjs`, `test-explanation-read.mjs`, `test-refusal-parity.mjs`,
`check-concern-checklist.mjs`.

**SO5 · Flow marks.** Files: new `tools/claim-marks.ts`, `tools/claims.ts` (`get_claims` returns
marks), `invariants.ts`. Gate `mcp-server/test-store-only-claim-marks.mjs`: red when a valid mark of
each kind is refused, not persisted, or not returned by `get_claims`; a mark is accepted on a
non-flow claim, a closed claim, `trigger` off step `00`, `crosses-seam` naming a seam the subsystem
is not party to, `exit` naming a step of another flow, or evidence not citing the subject's file; a
closed claim's or a withdrawn mark is returned as current; a declination is missing from
`get_claims`. Regressions: `test-structural-claims.mjs`, `test-temporal-claims.mjs`,
`test-phase2-claims-gate.mjs`, `test-refusal-parity.mjs`.

**SO6 · The server stops depending on files.** Files: `invariants.ts`
(`enforcePhasePrerequisites`), `tools/locus.ts`, `tools/artifacts.ts`, `tools/subsystems.ts`,
`tools/composition.ts`. §2.5. Gate `mcp-server/test-store-only-no-files.mjs`: drives a fixture
subsystem from `unmapped` to `mapped` through the tools with **no file written under storage**; red
when the `concerns` advance is refused with a structure narrative recorded or declined, or accepted
with neither (and no import); `register_artifact` accepts a hand-written kind or refuses `other`;
`describe_locus`'s narrative pointer names a file path for a subsystem with narratives; a
composition item of kind `record` scores wrongly for an effective, a superseded, or a wrong-commit
row; the run leaves any file in storage besides the database and storage-git files. Regressions:
`test-invariants.mjs`, `test-locus-standing.mjs`, `test-locus-compactness.mjs`,
`test-composition.mjs`, `test-smoke.mjs`.

**SO7 · Import (Opus).** Files: new `tools/import.ts`, new
`materializer/amanuensis_materializer/legacy_extract.py` (a CLI over `read_thesis`, the codebase
line and `_runtime_boundary_table`), refusal parity, `mcp-server/accept-store-only-real-stores.mjs`
(the acceptance command, not run by the packet). §5.2. Gate `mcp-server/test-store-only-import.mjs`
on copies of both legacy fixtures: red when any imported body differs from its file's bytes;
`hash_matches` is wrong (the AxiomDB-shaped entry point 0, every other row 1); the imported thesis
differs from what `read_thesis` returns on the same storage; the imported runtime rows differ from
`_runtime_boundary_table`; the project name differs from the `**Codebase**:` line; any claim,
concern or narrative row is created; a second run imports anything; any **artifact file** under
storage changes (the database and WAL files are expected to change); a missing file stops the rest.
Regressions: SO2's gate, `test-smoke.mjs`.

### Slice S2 · Pages from the store, and the skill

**SO8 · The materializer reads the store, not files.** Files: `renderers.py` (`read_thesis`, the
project-name reader, the survey-artifact lookup, passthroughs), `diagrams.py`
(`_runtime_boundary_table` reads records), `core.py` (passthrough planning), `manifest.py`,
`legacy_prose.py` (created here, used for imported bodies; §3.4). §3.3. Gate
`materializer/test-store-only-sources.py`: seeds a store with records **and** storage files carrying
different sentinels; red when any page carries a file sentinel; any file under storage other than
the database files and the three binding files is opened (instrumented `open`); the manifest has a
`prose:` key; an import-only store (old shape) loses its thesis, runtime diagram, survey narrative
(in either placement) or any of the three pages; an imported body lacks the "as written" label with
its date and revision; a withdrawn import still renders. Regressions: the materializer suite,
especially `test-narrative-placement.py`, `test-orientation-survey-notes.py`,
`test-overview-truthfulness.py`, `test-prose-retention.py`, `test-readback.py`;
`test-structural-claims.mjs`, `test-edge-contract.mjs`.

**SO9 · New records on pages, censused.** Files: `renderers.py` (subsystem page sections,
architecture, the three generated method pages), `readback.py` (censuses), `html_projection.py`
only where a new table signature is unavoidable (deleted in SO19). Structure narratives under
Structure, concern reasoning under Review coverage, challenge narratives under Challenge, each
topic a subheading with date, revision and ageing; project narratives on Onboarding record and
Where to begin; territory and probe columns and territory dispositions on Review checklist; the
runtime SVG from `runtime_boundaries` with imported rows labelled. Gate
`materializer/test-store-only-record-pages.py`: red when a recorded narrative, territory
disposition or runtime boundary is missing from its page in either view; a withdrawn or superseded
one renders; an ageing narrative is not marked; the read-back stays green after a seeded
narrative's text is altered on the page with the contract resealed. Regressions: the materializer
suite, `test-store-only-sources.py`.

**SO10 · The skill records instead of writing files.** §4. Files: the skill's references and
`SKILL.md`; new `dev/test-skill-no-file-writes.mjs`. First run the gate on the unedited skill and
put its FAIL lines in the red commit. Regressions: `check-reference-calls.mjs`,
`test-reference-calls.mjs`, `check-evidence-vocabulary.mjs`, `dev/test-skill-workflow-text.mjs`
(O10), `check-concern-checklist.mjs`; then `prepack-bundle-assets.mjs`.

### Slice S3 · HTML without Markdown

**SO11 · Split the parser (Opus).** Files: new `materializer/amanuensis_materializer/page.py`
(model), `html_projection.py` (`parse_markdown`, `write_html`), golden corpus under
`materializer/fixtures/store-only-golden/` generated **in the red commit from the unchanged tree**
by `materializer/make-golden.py`. Every recognition hook in §1.2 becomes a block kind resolved in
`parse_markdown`; `write_html` contains no Markdown handling. Gate
`materializer/test-store-only-model.py`: red when HTML for any golden page differs byte for byte;
`page.py` lacks a block kind for any hook listed in its own `HOOKS` table (which must list every
`_*_PROJECTION` constant and Mermaid shape `rg` finds in the base tree); `write_html`'s module
imports or calls the parser. Regressions: the materializer suite, `test-search-index.py`.

**SO12 · Move the tests to HTML.** Files: the materializer tests and the six mcp-server tests in
§11. While `.md` is still written, each assertion on a generated `.md` page becomes the same
assertion on the `.html` twin. Gate `dev/test-store-only-test-views.mjs`: red when any listed test
reads a generated `.md` page (a static scan for the page names and `.md` reads, with the allowed
exceptions listed in the gate and the commit message); the suites must stay green. Regressions:
the materializer suite and the six.

**SO13 · HTML-only output (Opus).** Files: `core.py` (no `.md` writes; in-memory Markdown passed
to `parse_markdown`; xref on in-memory text), `xref.py`, `readback.py` (drop `.md` branches;
markers once in HTML), `materialize.py` (contract and manifest over `.html` and `.js`; non-clean
mode removes `.md` files the previous manifest claimed), and the guide's views paragraph (O14) and
the CLI notice (O15) rewritten for one view. Gate `materializer/test-store-only-html-only.py`: red
when a publish writes any `.md`; a publication over a previous `.md`+`.html` output leaves a claimed
`.md`; an unmanaged `.md` is not refused; the contract lists a `.md`; the read-back is not green on
all three axes for a fresh publication; a sabotaged HTML finding marker (removed, duplicated, with
the contract resealed) is not red; the guide still mentions a Markdown view; any link in any page
targets `.md`. Regenerate the golden corpus at the green commit (rule §3.2). Regressions: the
materializer suite, `test-store-only-model.py`, `test-projection-custody.mjs`,
`test-finding-partition.mjs`, `test-edge-contract.mjs`, `test-structural-claims.mjs`,
`test-residual-hardening.mjs`, `test-invariants.mjs`, `test-smoke.mjs`,
`test-orientation-cli-render.py`.

**SO14–SO18 · Renderers build the model.** One family each: SO14 overview, architecture, subsystem
map, guide (creates `prose.py`, the §3.4 grammar, and model-level xref linking in `xref.py`); SO15
subsystem pages (narrative placement; imported bodies through `legacy_prose.py`; `_nest_prose`
goes); SO16 the Unresolved pages (open findings, disagreements, decisions needed, leads, stale
knowledge, hot spots); SO17 the History pages (resolved findings, resolution history, resolved
leads, sessions, conflicting evidence); SO18 Method and remaining pages (review coverage, review
checklist, competing explanations, matrices, onboarding record, where to begin, files, not yet
surveyed, system boundaries, glossary). Gate per packet
`materializer/test-store-only-convert-<family>.py`: red when any page of the family differs from
the current golden HTML, or `parse_markdown` is called while building one (instrumented counter).
Regressions: the materializer suite, SO11's and SO13's gates, the earlier conversion gates.

**SO19 · Delete the Markdown intermediate.** Files: `html_projection.py` (parser and page hooks
removed), `xref.py` (text rewrite removed), `core.py` (page ids end `.html`), `lint.py` callers
(composite-index lint over the overview model's text). Gate
`materializer/test-store-only-no-markdown.py`: red when `parse_markdown` or any page-level
`_*_PROJECTION` signature still exists; anything but the imported-body path calls
`legacy_prose.py`; a `PagePlan` path ends in `.md`; a composite-index violation seeded into the
overview is not caught; golden HTML differs. Regressions: everything.

### Slice S4 · Read-back and publication

**SO20 · Read-back against the store (Opus).** §3.5. Files: `page.py`/`write_html` (record and
node/edge attributes), `readback.py`, `diagrams.py`, golden regeneration (attributes only). Gate
`materializer/test-store-only-readback.py`, a sabotage table run with the contract resealed after
each edit: a finding's printed state changed; a subsystem depth label changed; a narrative body
altered; an imported body truncated; a record removed from its page; an edge added to the runtime
SVG; a node removed from the boundary SVG. Each must produce a mismatch on the right axis with the
right `object_type`, and an unsabotaged publication must be green. Regressions: `test-readback.py`,
`test-projection-custody.mjs`, `test-refresh-recovery.mjs`, `test-orientation-readback-label.py`,
the conversion gates.

**SO21 · Publication chain and copies.** §6. Files: `dev/promote-docs.mjs`,
`dev/republish-docs.mjs`, and the `dev/` readers of `docs/*.md`: `test-reader-lenses-dogfood.mjs`,
`test-rebuild-readback.mjs`, `test-explanations-published.mjs`, `test-republish-chain.mjs`,
`test-receipt-gates-restored.mjs`, `measure-reader-prose.mjs` (each reads HTML). D10 is decided yes: `materialize.py` writes the
content-free README. **No republish.** Gate
`dev/test-store-only-publish-chain.mjs` over a temp copy of a fixture publication: red when promote
copies or expects a `.md`; the read-back at the destination is not run or not green; a stray file in
the destination is not refused; any of the six readers still opens a `.md` page; the README is missing or
carries any survey content. The six read the tracked `docs/`, which stays Markdown until the owner
republishes (D15). Four of them run as regressions and must exit 0. `test-explanations-published.mjs`
(EX14) and `test-receipt-gates-restored.mjs` (EX8) are converted like the others but are not
regressions: each runs P11 (`dev/test-survey-depth-acceptance.mjs`) as a sub-gate, and P11 is red at
baseline by owner decision, so neither can exit 0 in this lane (D17).

### Slice S5 · Diagrams

Every diagram packet follows Appendix B, adds a pure model function to `diagrams.py`, draws with
the shared primitives, puts `data-node`/`data-edge` on every mark, regenerates golden only inside
its `<figure data-diagram>` blocks, and adds a gate that is red on: a node count different from the
record count; an edge no record joins; a missing `role="img"`, `<title>` or `<desc>` with counts; no
readable account beside it; a below-threshold input drawing an SVG instead of a sentence;
non-identical output on a second render; a sabotaged mark the read-back does not catch.

**SO22 · Primitives, survey workflow (B1), status ladder (B2).**
Contract: `survey_passes` gains `actor` and `checkpoint`; a check that the contract's rung
prerequisites name the same rungs `enforcePhasePrerequisites` checks. Guide gets B1 and the ladder;
each subsystem page gets the ladder with its marker and climb (a subsystem with no transitions says
its history was not recorded; `deferred` drawn beside the ladder, not as a rung). Gate
`materializer/test-store-only-method-diagrams.py`.

**SO23 · Coverage bars (A5) and finding badges (A4).** A5 on each subsystem page and the Files
page (no reconciliation → "coverage not measured", never zero); A4 on the atlas and O8 diagram,
from the hot-spots computation, separate badges per measure, no "clean" badge, badges only from
`concerns` up. Gate `materializer/test-store-only-coverage-badges.py` (also red when A4's counts
differ from `hot-spots.html`'s).

**SO24 · Seam contract (A2).** One per seam on System boundaries: party A, shared object, party B,
four arrows, assumptions as a caption; an unrecorded half dashed and labelled; all four fields empty
→ a sentence. Gate `materializer/test-store-only-seam-diagram.py`.

**SO25 · Flow strip (A3).** One strip per flow on the subsystem page: steps in `<nn>` order, a
commit line from `commit-point`, crash marks, exits below their step, seam crossings linking the
seam; a step with more than two exits lists them; fewer than three steps → a sentence; more than 12
wraps; more than 20 → a numbered table; a flow with no marks and no declination says "marks not
recorded". Gate `materializer/test-store-only-flow-strip.py`. Depends on SO5.

## 9. Owner decisions

**Decided 2026-11-20 by the owner: every recommendation below is accepted** ("all decisions as
you lean"). D16 is amended by the owner's note that legacy data from earlier Amanuensis versions
does not need protecting. The alternatives are kept for the record.

- **D1. Imported prose: render or hold?** Render imported survey bodies, onboarding report, entry
  point and concern checklist verbatim under an "as written" label; hold master plan, findings index
  and field notes unrendered. *Recommended*, because AxiomDB has no claims and its pages would lose
  every structure section otherwise. Alternatives: hold all unrendered; drop.
- **D2. The imported thesis.** Accept it as an `imported` project purpose with no evidence, labelled
  on the overview, until a recorded one replaces it. *Recommended.* Alternative: require a recorded
  purpose before the next publication (AxiomDB's overview has no purpose until then). Blocks SO2.
- **D3. Flow marks as generic `claim_marks`** with per-kind contract rules, relations deferred.
  *Recommended.* Alternative: typed tables per mark kind. Blocks SO1.
- **D4. Flow marks: print the gap, never refuse an advance**, discharge-or-decline in the skill;
  revisit after one survey's counts. *Recommended.* Alternative: refuse `structural` while a flow
  has neither marks nor a declination.
- **D5. Contract entries count as records for the method diagrams**, with actors and checkpoints
  in the contract and a gate holding the server's rung prerequisites to it (finding-state
  transitions follow with B5). *Recommended.* Alternative: the server reads its prerequisites from the contract (larger,
  riskier change).
- **D6. When to import each real store.** AxiomDB: in its maintenance lane, after a release that
  carries S1–S2. This repository's store: import too, before any republish of `docs/`, even though
  the self-rebuild will replace it. *Recommended.* Both are Amanuensis use; the owner's
  acceptance of this decision is the go-ahead, and each still runs only after the lane lands.
- **D7. `register_artifact` and `rehash_artifact`.** Refuse hand-written kinds now (SO6), remove the
  tools at the next minor version. *Recommended.*
- **D8. Dispatch prompt files.** Drop the template; keep nothing beyond `subagent_log`.
  *Recommended* (no store has one). Alternative: store prompt and response text in the log.
- **D9. Server-written exports** (review export Markdown, `compare_conspectuses write_to`, the
  research handoff's `claims.md`). Out of scope; they are handoff files, not the published
  projection. *Recommended.* Alternative: HTML review exports.
- **D10. A content-free `README.md` in published output and copies**, pointing at `index.html`.
  *Recommended*, for GitHub's directory view. Alternative: none.
- **D11. Files on disk after import** stay untouched; deleting them is the owner's, by hand.
  *Recommended.*
- **D12. Version.** Pages lose their `.md` form: a breaking output change, released as `0.3.0`
  with a release note. *Recommended.*
- **D13. Stored-prose grammar** (§3.4) as the documented contract for every prose field.
  *Recommended.*
- **D14. Catalog questions 7–9**: illustrations allowed and labelled; no diagram on the overview;
  scroll inside the frame on narrow screens. *Recommended.*
- **D15. Republish and real-store checks** (`docs/`, AxiomDB's copy) only after the lane lands and
  D6's imports run, as orientation D5. *Recommended.*

- **D16. Activation on the real stores: decided.** The owner does not need data written by earlier,
  less capable versions preserved, so the AxiomDB lanes are **not** paused or pinned, and the next
  nightly open after the rebuild migrates the store unattended. One backup is still taken, for a
  different reason: immediately before `dist` is rebuilt in the primary checkout, snapshot both
  stores with `sqlite3 <db> "VACUUM INTO '<backup>'"`. It exists so that, if the new server cannot
  open or migrate a store, the old `dist` can be restored and the nightly lanes keep running while
  the fault is fixed. It is a rollback point for the lanes, not an archive, and can be deleted once
  a nightly run has succeeded on the migrated store. No backup is taken now: one taken before the
  merge would be stale by the time it was needed.

- **D17. SO21's P11-dependent regressions: decided 2026-11-21.** SO21 was exhausted after two
  attempts because its regression list held EX14 and EX8, which run P11 as a sub-gate; P11 is red
  at baseline by owner decision, and re-recording its receipt needs the live store and the MCP
  tools, which this lane forbids. The owner's ruling: "Drop the two tests." Both are removed from
  SO21's regression list; SO21's gate still checks that neither opens a `.md` page. No other packet
  lists either test or anything else that runs P11.

Listed, not decided here: catalog questions 3 (commit order for B4) and 4 (seam assessment, N2).

## 10. Dependence on the orientation branch

The lane is cut from `main` after `orientation` merges. These parts build on it directly:

- **Contract (O1):** `reader_facing`, `reader_terms`, `survey_passes` and the D4 labels. SO1 extends
  the same file and generator; SO22 adds `actor` and `checkpoint` to `survey_passes`.
- **Page plan and guide (O2, O3, O4, O6, O9):** `use_when`, the guide's sections, terms per page.
  SO14 converts these renderers; the golden corpus must be generated on the merged tree.
- **IDs (O5):** the xref patterns built from index keys and first-mention names. SO13 and SO14 move
  that logic from text rewriting to the model.
- **Atlas and boundary diagram (O7, O8):** two of the recognition hooks SO11 turns into block kinds;
  A4's badges sit on them.
- **Skill (O10):** status timing (D4) and the "When each phase sets the status" table; SO10 edits
  the same files and must keep `dev/test-skill-workflow-text.mjs` green.
- **Read-back label (O12), survey notes date (O13), views paragraph (O14), CLI render (O15):**
  SO8 keeps O13's dated placement for imported bodies; SO13 rewrites O14's paragraph and makes O15's
  notice HTML-only; O15's `--recorded-publication` and `--allow-external-output` flags are kept.

If `orientation` changes in its final review, regenerate §1's line numbers before SO0 starts. Nothing
in this plan edits that branch or its lane.

## 11. Test churn (from §1.2's survey)

Materializer: 29 of 30 test files assert on `.md` output; six assert on Markdown only
(`test-ledger-grouping`, `test-narrative-placement`, `test-placeholder-census`,
`test-orientation-survey-notes`, `test-claim-register`, `test-severity-history`). mcp-server:
`test-finding-partition.mjs`, `test-projection-custody.mjs`, `test-edge-contract.mjs`,
`test-structural-claims.mjs`, `test-residual-hardening.mjs`, `test-invariants.mjs`. Indirect:
`test-scope-reconciliation`, `test-package-artifact`, `test-locus-index-view`,
`test-existing-store-migration`, `test-workspace-binding`, `test-cloud-storage`. `dev/`: the six in
SO21. SO12 moves each to HTML without weakening it; a test whose Markdown assertion has no HTML
equivalent is listed in the commit message with the reason, never silently dropped.

## 12. Cross-family review and its dispositions

Codex read the first draft against `orientation` at `3b9e885` and the two stores. Every finding was
checked against the code before it was accepted; all 16 were.

| # | Finding | Disposition |
|---|---|---|
| 1 | SO1 adds an enum value whose CHECK only SO2 widens, so `--check-sql` fails at SO1 | SO1 adds enums without `sql` bindings; SO2 adds bindings, `imported` and the DDL together |
| 2 | Real-store gates cannot run in CI and stay required for every later packet | Gates use committed legacy fixtures (SO2); real stores move to an acceptance command the owner runs |
| 3 | SO7's "no file under storage changes" forbids the import's own database writes | Only artifact files must stay unchanged; database and WAL files are expected to change |
| 4 | Copying a live database and its WAL separately is not a consistent snapshot | The acceptance command snapshots with `VACUUM INTO` |
| 5 | Composition scoring reads `artifacts` and is not handled | §1.1, §2.5: a `record` item kind; SO6 gates it |
| 6 | AxiomDB's MCP runs the primary checkout's `dist`, so a rebuild migrates its store on next open | §5.1 and new D16; SO2 checks the base-tree server still opens a migrated store |
| 7 | Golden files break when SO20 and the diagram packets change HTML | §3.2 update rule: named packets only, diffs confined to their elements, `VERSION` file |
| 8 | Imported bodies hold tables and fences, not just headings | §3.4: `legacy_prose.py` keeps the block grammar and record projections for imported bodies only |
| 9 | A project purpose would be writable but unreadable (`SLOTS_OF`, eligibility by structural subsystem) | §2.2 and SO4: read paths in TypeScript and Python, gated before any structural subsystem |
| 10 | A census attribute written by the drawing function checks only itself; hash mismatch can mask the census | §3.5: the read-back parses drawn elements; sabotage tests reseal the contract |
| 11 | SO5 has no positive witness and no way to retract a mark | Acceptance of each kind gated; `withdraw_claim_mark` added; a general rule in §8 |
| 12 | Binding files under storage are still read | §3.3 narrowed to "no prose file"; SO8 allow-lists opens |
| 13 | `_ENUM_TABLE_PROJECTION` missing from the hook inventory | Added to §1.2 and as `EnumTable` in §3.1 |
| 14 | SO12 and SO15 (first draft) too large for one session | Split: test migration (SO12) before the output switch (SO13); Unresolved and History separate (SO16, SO17) |
| 15 | plan.json omitted SO21's six dev readers; D5 promised transitions no packet builds | Deliverables and regressions added; transitions deferred to B5 |
| 16 | Byte counts and the `content_hash` claim were wrong | Corrected in §1.1, §0 and §5.3 |

## Appendix A · Packet dependencies

| Packet | Depends on |
|---|---|
| SO0 | — |
| SO1 | SO0 |
| SO2 | SO1 |
| SO3, SO4, SO5 | SO2 |
| SO6 | SO3 |
| SO7 | SO3, SO4 |
| SO8 | SO4, SO7 |
| SO9 | SO3, SO8 |
| SO10 | SO3, SO4, SO5, SO6, SO9 |
| SO11 | SO9 |
| SO12 | SO11 |
| SO13 | SO12 |
| SO14 → SO15 → SO16 → SO17 → SO18 | SO13 (each the previous) |
| SO19 | SO18 |
| SO20 | SO19 |
| SO21 | SO13, SO20 |
| SO22 | SO20 |
| SO23, SO24 | SO22 |
| SO25 | SO5, SO22 |

## Appendix B · Diagram rules (restated from the catalog, which is not committed)

1. Every mark is a record and links to its anchor; contract entries count as records (D5). Nothing is
   drawn from prose or the renderer's own knowledge.
2. Status decides what is drawn: `unmapped`/`deferred` a box only; `scoping` coverage and seam stubs;
   `structural` components, flows, seam halves, no verdict badges; `concerns`/`adversarial` badges
   marked "under review"; `mapped` everything. Captions quote the contract's `authorizes` /
   `cannot_justify`.
3. A closed claim is never drawn as current; a current claim whose cited file is stale is hatched
   ("cited file changed since `<sha>`"); every diagram prints the revision(s) it was read at.
4. One question per diagram, stated in the caption in the reader's words.
5. No relation the store does not hold; arbitrary order (ID order) is stated; field notes of category
   `connection` are never edges.
6. Absence is drawn and counted ("n of m have no recorded X"); "recorded none" differs from "not
   recorded".
7. Uncertainty shows: `observation` solid, `inference` dashed, `hypothesis`/`open-question` dotted and
   labelled; marks resting only on `comment-asserted`, `name-inferred` or `pattern-matched` evidence
   carry the linchpin mark; a `survived` challenge carries a tick.
8. A complete readable account sits beside every SVG; `role="img"`, `<title>`, `<desc>` with counts;
   links focusable in reading order.
9. Colours from CSS tokens only, following the enum encoded, never the only signal.
10. Deterministic, byte-identical output; stable, stated ordering; no force layout.
11. Declared minimum and maximum mark counts per diagram: a sentence below, a table or split above;
    text never below 11 px; a fixed 960 viewBox width that scrolls in its frame.
12. No runtime: no diagram library, no layout JavaScript; strips, lanes, bands, small grids and
    fixed-order layers only.
13. Illustrations are headed "Illustration" and use no real ID (D14).
14. Every diagram has a census gate and a read-back (§3.5).
