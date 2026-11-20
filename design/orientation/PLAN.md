# Orientation: what the published site tells a first-time reader

- Status: plan, 2026-11-19. Nothing here is implemented. Owner decisions D1–D4 recorded
  2026-11-20 and folded into the packets (§5); D5 is still open.
- Source: branch `claude/orientation-plan-e03563`, from `main` at `6c9b181`.
- Corpora read, not written: this repository's store (`.amanuensis/docs/` in the primary
  checkout, subsystem IDs `B-NN`) and the AxiomDB store (`~/repos/axiomdb/.amanuensis/docs/`,
  35 subsystems). No Amanuensis tool, skill or CLI was run.
- Labels: **[O]** observed in source or a published page, with a location. **[M]** measured
  (counted). **[J]** a judgment proposed here.

## The report

A beta tester, an experienced engineer who ran Amanuensis on their own codebase, could find
their way around but:

1. met many unfamiliar terms;
2. did not get the overall workflow, or what the tool expects of them;
3. saw things called "maps" with no picture of structure;
4. saw IDs such as `C-01` and `R-06` that look like a scheme, with nothing saying what the
   letters mean;
5. did not know the word "conspectus".

They asked for an index of pages saying what each is for and when to use it, definitions in
each section, and an explicit account of the workflow.

## 1. Findings

### 1.1 What the site has today (verified, two corrections)

- **[O]** The overview is `render_index` (`materializer/amanuensis_materializer/renderers.py:943`).
  Its last block, "The four lenses" (`renderers.py:1177`), gives one link per lens. Its only
  sentence about what the site is: "An architecture survey of {name}, recorded by Amanuensis"
  (`renderers.py:1041`). Nothing says an AI agent wrote it, or links to the reader's guide
  except as the Method lens's route.
- **[O]** The reader's guide is `how-to-read.md`, built by `render_how_to_read`
  (`renderers.py:3336`) from `_route_tables` (`:3302`) and `_vocabulary_tables` (`:3269`). Its
  intro is a heading and nothing else (`HOW_TO_READ_INTRO`, `:3256`).
- **Correction.** The guide is not "tables of status values plus a page list" in the sense of a
  short page. **[M]** On this repository's store it is 33 KB with 31 enum tables, one for every
  enum in `mcp-server/contracts/conspectus-vocabulary.json`, including internal apparatus a reader
  never sees as a label (`vocabulary_discharge`, `explanation_discharge`, `pass_type`,
  `omission_reason`, `claim_subject_type`). Each table is headed by the stored name
  ("Xref relationship", "Field note follow up").
- **[O]** The guide defines values, never nouns. Nothing on the site says what a subsystem,
  finding, concern, claim, seam, lead, lens or conspectus is. The contract has no place to put
  such a definition: its top-level keys are `contract_version`, `description`, `enums` and
  `orientation_forbidden_terms`.
- **[O]** `vocabulary.md` is the codebase glossary (the project's own terms). Its nav label is
  "Codebase glossary". The guide's own section is titled "The vocabulary this record uses", so
  the site has two "vocabularies" and no glossary of its own terms.
- **[O]** The page plan is in `materializer/amanuensis_materializer/core.py:497-525`
  (`PagePlan` class at `:111`, `_routes` at `:133`).

### 1.2 The page list is not yet an index

- **[O]** `_route_tables` is generated from the page plan, so it cannot miss a page. That is
  the right base. It is headed "What to look at first" but lists every page, including one row
  per subsystem and per evidence matrix (35 subsystem rows on AxiomDB).
- **[O]** Its one descriptive column is "What it carries", filled from `PagePlan.hint`. No column
  says when to use a page. The overview's and the guide's own hints are empty strings
  (`core.py:500`, `:522`).
- **[O]** In HTML the hint prints under each page's title (`html_projection.py:3016`). In
  Markdown it does not print at all.

### 1.3 "Map" names three things and draws none of them

- **[O]** `master-plan.md` has three names: nav label "Subsystems", title "Subsystem map"
  (`core.py:502`), and its own heading "# Master plan" (`renderers.py`, `render_master_plan`).
  Its body is one table per layer (`render_master_plan`); nothing graphical.
- **[O]** "Map" also appears in the status "Mapped", "Runtime boundary map", "Staleness map",
  and the hint "The recorded edge of the map".
- **[O]** Visuals that do exist, all on the architecture page and all built at render time:
  a runtime-boundary SVG from the onboarding table (`html_projection.py:2058`); a layer atlas of
  subsystem cards, used only when no dependency edge is recorded (`_subsystem_atlas`, `:2016`);
  hub-and-spoke cards for dependencies and seams (`_connection_topology`, `:2221`); a bar chart
  for staleness. `diagrams.py` produces Markdown tables and one Mermaid pie, which the HTML turns
  into bars.
- **[M]** Both real stores record **zero** dependency edges (`xrefs`): each architecture page
  shows "Subsystem atlas", never "Subsystem dependency graph". AxiomDB records 20 seams.
  `phase-2-structural.md` step 6 has told the structural pass to call `add_xref` since
  2026-09-12 (`b4191d3`). Why neither store has any is not established here.

### 1.4 IDs: the letters are an agent's choice, and nothing says so

- **[O]** The server accepts any string as a subsystem ID (`mcp-server/src/tools/subsystems.ts`,
  `upsert_subsystem`, `id: { type: "string" }`). Onboarding Phase 5 calls
  `upsert_subsystem(id, …)` with no rule for the ID (`.claude/skills/amanuensis/references/onboarding.md`).
  The schema defines no scheme.
- **[O]** Finding IDs are also the agent's choice: the tool says the ID "conventionally looks
  like 'B01-1' (subsystem code + sequence)" (`mcp-server/src/tools/findings.ts:79`). Seam IDs
  are "e.g. 'SM-01'" (`mcp-server/src/schema.sql`, `seams`). Concern codes are "short ids (e.g.
  `CC-1`, `RC-2`)" (onboarding Phase 4); seam concerns are `SC-N` (`SKILL.md`, "Seam
  assessment"). Only evidence-matrix IDs (`DM-N`) are minted by the materializer.
- **[M]** AxiomDB's 35 subsystem letters mostly follow the layer's initial (`Q` Query,
  `R` Reasoning, `S` Storage and encoding, `W` Write path) but not consistently: `C-01`, `C-02`
  and `P-01` are all "Contract and tooling", `H` is "Verification and evidence", `M` is
  "Identity", `V` is "Service". This repository's store uses `B` for every subsystem. A reader
  who sees a pattern in AxiomDB cannot decode it, because it is half a pattern.
- **[M]** On AxiomDB's findings, seams, concerns, leads and decisions pages, concern-code
  prefixes (`CC`, `RC`, `ID`, `TR`, `TB`, `OB`, `RL`) have the same shape as subsystem and seam
  IDs. Nothing tells a reader that `RC-2` is a concern and `R-02` a subsystem.
- **[O]** Where an ID is defined: Markdown turns a known ID into a link
  (`xref.py`); HTML also wraps it in `<abbr title="ID — definition">`
  (`html_projection.py:1460-1535`). The name is in a hover tooltip only, which touch screens and
  a quick read never reveal. `reporting-style.md` prefers tooltips unless the name is adjacent.
- **[O]** Both resolvers match the shape `[A-Z]{1,3}\d{0,3}-\d{1,3}` (`xref.py:42`,
  `html_projection.py:1455`). An ID outside that shape is neither linked nor defined.
  **[M]** This repository's findings pages mention `B04-R6`-shaped IDs; the published
  `findings.html` prints "(B04-R6)" in prose as plain text. A lowercase subsystem ID such as
  `auth` would never link anywhere.

### 1.5 The workflow is real but unstated, and partly inconsistent

What the skill actually does (`SKILL.md`, `references/onboarding.md`,
`references/subsystem-survey.md`, `references/open-questions.md`, `references/refresh.md`):

- **Onboarding**, once: Phases 0–7. Read the repository's shape; record the runtime boundary
  table and stateful entities; derive a project-specific review checklist (concerns) from the
  territory catalog; list the subsystems by layer and rank them; log questions for the person
  without waiting; write the first prose artifacts and publish.
- **Subsystem survey**, one per subsystem in priority order: Phase 1 scope (file ledger, terms,
  seam stubs), Phase 2 structural (types, state, flows, concurrency, claims, edges), Phase 3
  concerns (a verdict with evidence for each checklist item; confirmed bugs become findings),
  Phase 4 adversarial (try to overturn each claim and finding), Phase 5 packaging (purpose and
  account, update artifacts, publish). The status climbs one rung per phase, and the server
  refuses a rung the record does not support.
- **Refresh**, when the code changes: reconcile, then re-read each changed file and clear it.
- **The person**: does not gate anything. The agent runs "autonomously by default", logs every
  judgment call as an open question with the assumption it used, and keeps going. Checkpoints
  are after onboarding, after each subsystem, after each batch, and at the start of a session.
  The person reads the queue "asynchronously", answers questions, redirects ("survey X",
  "stop"), or asks about a locus ("what do we know about X"). The agent "do[es] not resolve
  questions on the human's behalf unless the human says so".

Inconsistencies, recorded as findings. None is fixed by this plan except where a packet says so.

- **W1. The person's channel is never stated on the site, and is misstated in the skill.**
  `open-questions.md` says the human answers with `resolve_open_question(id, resolution=…)`, a
  tool call a person cannot make; in practice they tell the agent. The "Decisions needed" page
  (`render_open_questions`, `renderers.py:3381`) says what a question is but not how to answer it.
- **W2. A stale page reference.** `open-questions.md` says questions render "per phase boundary
  in the relevant subsystem-survey artifact, plus a global queue on the findings index". They
  render on `open-questions.md` ("Decisions needed").
- **W3. Leftovers from the removed menu and review gates.** `open-questions.md`'s headless
  preflight says "Run as if option **A — autopilot until done** was selected"; `SKILL.md` removed
  that menu ("Infer scope without a menu"). `subsystem-survey.md`'s resume logic labels each
  status "(approved)", though nothing approves it.
- **W4. Packaging publishes before it marks the subsystem done.**
  `phase-5-packaging.md` runs `materialize_docs` at step 5 and `update_subsystem_status(…,
  "mapped")` at step 9, so the site published at the end of a survey shows that subsystem one
  rung short until the next publish. Read, not reproduced.
- **W5. The seam check runs before either party can be mapped.** Step 7 calls
  `get_seam_assessability()`, which is true only when both parties are `mapped`
  (`schema.sql`, view `seam_assessability`). The subsystem being packaged is not `mapped` until
  step 9. So when the second party of a seam is packaged, its own status is still `adversarial`
  and the seam does not flip; no packaging step ever sees it flip. Only the audit route catches
  it (`memory-audit.md`'s example: "SM-02 (B-01 ↔ B-04) — both parties mapped; 0 SC-N
  dispositions"). Read, not reproduced.
- **W6. Does a status name the pass just finished or the pass under way?** Decided by D4: for
  `concerns` and `adversarial` it names the pass under way. The server and the contract already
  work that way; the skill does not.
  - **[O] Server.** `set_disposition` and `add_finding` with a concern pass need the subsystem at
    `concerns` or above, and with `pass_type="adversarial"` at `adversarial` or above
    (`mcp-server/src/tools/dispositions.ts:96-97`, `findings.ts:162-163`).
    `update_finding_status`, `update_finding_severity` and `verify_finding_fix` need `concerns`
    (`findings.ts:269`, `:366`, `:424`). The advance itself checks the previous pass's output and
    says so: `concerns` needs a `subsystem-survey` artifact "before the concern pass begins";
    `adversarial` needs at least one disposition "before the adversarial pass begins"
    (`mcp-server/src/invariants.ts`, `enforcePhasePrerequisites`).
  - **[O] Contract.** `concerns` means "concern-by-concern review is in progress";
    `adversarial` means "Candidate conclusions are being challenged". `scoping` and
    `structural` describe a finished pass. The labels ("Concerns", "Adversarial") do not say
    which.
  - **[O] Skill.** It advances after each pass: `phase-3-concerns.md:188` ("The coordinator
    advances to `concerns` status and starts adversarial review"), `phase-4-adversarial.md:225`
    ("advances status to `adversarial` and runs Phase 5"), `subsystem-survey.md:55` ("After the
    phase returns: … `update_subsystem_status(id, status=<phase_name>)`") and `:67`. `SKILL.md`'s
    ladder (`:129-131`) puts Phase 3 under `structural` and Phase 4 under `concerns`. The resume
    list (`subsystem-survey.md:20-24`) reads each status as "this pass is done". Followed
    literally, Phase 3's first `set_disposition` is refused, because the subsystem is still
    `structural`. Read, not reproduced: the stores' dispositions show agents got past it,
    probably by advancing early on the refusal.
- **W7. `deferred` is a depth the site prints and the skill's ladder leaves out, on purpose.**
  The contract carries it; the tool calls it an orthogonal flag (`subsystems.ts`,
  `update_subsystem_status` description); `mcp-server/scripts/check-evidence-vocabulary.mjs`
  (`:167`, `omits: ["deferred"]`) declares the omission deliberate. Not a skill defect, but a
  reader who sees "Deferred" on the Subsystem map has nothing that explains it. Terms
  (Appendix A) covers it; the skill is left alone.
- **W8. "Phase N" means two things.** Onboarding Phases 0–7 and survey Phases 1–5 share
  numbers. **[M]** Agent-written prose on published pages says "Phase 2" etc. (AxiomDB: 17
  lines on Leads, 13 on Decisions needed, 13 on System boundaries) with nothing saying which
  sequence.
- **W9. Two names per record family.** The site translates "field note" to "Lead", "open
  question" to "Decision needed", "seam" to "System boundary", "master plan" to "Subsystem map".
  The skill, agent-written prose and the chat use the first names. A reader meets both.

## 2. What to build

Each part answers one item of the report. Packets are in §4.

### 2.1 Amanuensis's own terms (report item 1, 5)

**[J]** Add a `reader_terms` section to the vocabulary contract. Each entry has `term`,
`aliases` (the other names in W9, and the stored name), `definition` (one or two plain
sentences), and `pages` (where a reader meets it). The generator emits it into
`vocabulary.py`; the guide renders it as a "Terms" section with one anchor per term
(`#term-<slug>`).

- **Where each definition lives:** generated from the contract, not authored in a renderer, so
  the same entry can later feed tool descriptions and the skill.
- **Status values stay where they are** (the enum tables), but the guide shows only enums whose
  values a reader sees as labels, chosen by a new per-enum flag `reader_facing`. The other enums
  go under one closed `<details>` "Full vocabulary" section in HTML, and a final section in
  Markdown. Each table is headed by a plain name, with the stored name in small type.
- **"Definitions in each section":** each page prints, under its title, one line "Terms on this
  page:" linking the guide's anchors. The list per page comes from the terms' `pages` field, so it
  is generated, not authored per page.
- **Draft definitions** are in Appendix A. They are short on purpose; the packet copies them in.

### 2.2 IDs (report item 4)

**Decided (D1): the letters stay labels and the site explains them. They carry no meaning.**

Reasons: an ID is a primary key in `subsystems`, a prefix of every finding ID, a party in seams,
and a key in carried findings across stores (`carried_findings.archived_finding_id`). A scheme
enforced from now on would leave every existing store non-conforming, and renaming is not
possible behind the append-only tables. Layers are the obvious source for a letter, but AxiomDB
shows layers that share an initial and names that change. A letter that is right most of the
time is worse for a reader than one that is plainly arbitrary.

What the site does instead:

1. **Say it.** The guide gets a section "How IDs are formed" (Appendix B): one row per ID kind,
   with its shape, what it names, who chose it, an example taken from this store, and which page
   it links to.
2. **Say what this store's letters do, from the data.** For subsystem IDs, the guide computes,
   per leading letter, the set of layers its subsystems are in. If every letter maps to exactly
   one layer and no layer has two letters, it says "Here the letter is the layer: Q is Query, …".
   Otherwise it says "The letters were chosen when the survey began and do not encode anything.
   Read the name beside the ID." This stays true per store with no onboarding change.
3. **Show the name, not only a tooltip.** The first mention of a subsystem ID in each page's body
   prints its name beside it: "R-06 (Rule evaluation)". Later mentions keep the link and tooltip.
   Tables that already have an adjacent Name column are left alone (`reporting-style.md`). Finding
   IDs keep the tooltip, since the name of a finding is a sentence.
4. **Link every known ID, whatever its shape.** Build the match pattern from the xref index's
   keys (an alternation of exact IDs, longest first) instead of a fixed shape, in both `xref.py`
   and `html_projection.py`. `B04-R6` and `auth` then link and carry a definition.
5. **Tell concern codes apart.** Where a concern code is printed outside the review-coverage
   matrix, prefix it with "concern" in the link text ("concern RC-2"), the way findings are
   already introduced as "Finding in …" in the tooltip.

No onboarding change and no ID scheme for new stores (D1).

### 2.3 How a survey works (report item 2, and the tester's last point)

**[J]** A generated section of the guide, "How a survey works", and a three-sentence version
at the top of the guide and in the overview's identity line. Content is in Appendix C. It
covers:

- **Who wrote this:** an AI agent, reading the repository without changing it.
- **The two stages** (onboarding once; one survey per subsystem) and refresh, with what each
  produces and where it shows on the site.
- **The five passes** of a survey, each with the depth it sets, *when* it sets it, and what that
  depth lets a reader rely on. Per D4, Scope and Structure set `scoping` and `structural` when
  they finish; Concern review and Challenge set `concerns` and `adversarial` when they start;
  Packaging sets `mapped` when it finishes. The depth labels and meanings come from the
  contract's `subsystem_status` entries, so they cannot drift. The pairing of pass, depth and
  timing comes from a new contract section `survey_passes`, because nothing else records it in
  one place. The skill's gate (O10) reads the same section.
- **What it expects from you:** nothing in order to keep going; reading "Decisions needed" and
  answering in your chat with the agent; redirecting or stopping it; asking about a file. And
  *when*: at checkpoints, which it names.
- **Phase numbers:** a two-row key mapping "onboarding Phase 0–7" and "survey Phase 1–5" to the
  pass names, so "Phase 2" in agent-written prose can be decoded (W8).

The "Decisions needed" page gets one line under its title saying how to answer: "To answer,
tell the agent in your session, for example: 'Decision #12: tenancy is per account.' This site
is read-only." (W1.)

Where the real workflow is unclear (W4, W5, W7), the section describes what the record shows
and does not paper over it. D4 settled W6: the two in-progress depths get labels that say so
("Reviewing concerns", "Challenging claims"; O1), and packet O10 fixes W1–W6 in the skill.

### 2.4 Page index (report: "what each page is for and when to use it")

**[J]** Yes, the route table becomes the index. It is already generated from the page plan,
which is the property an index needs. Changes:

- `PagePlan` gains `use_when: str` (one plain sentence starting "Use it when" / a question the
  reader has). Overview and guide get real hints.
- The section is renamed "Pages on this site", with columns **Page**, **What it shows**,
  **Use it when**, grouped by lens with each lens's one-sentence meaning (already in the `lens`
  enum) under its heading.
- Per-subsystem and per-matrix pages collapse to one row per subgroup ("Subsystem pages: one
  per subsystem, listed on the Subsystem map").
- It moves to second place in the guide, after "What this site is" and before "How a survey
  works".
- The HTML page header prints `use_when` under the hint; Markdown prints both under the title,
  so the two views say the same thing.

Draft `use_when` sentences are in Appendix D.

### 2.5 Structure visuals (report item 3)

The architecture page has an atlas and a runtime SVG; the "map" page has neither. **[J]**

1. **Subsystem map gets the atlas.** `render_master_plan` emits, above its per-layer tables, the
   three-column table the HTML already turns into the atlas (`Region | Subsystem | Survey depth`,
   matched by `_SUBSYSTEM_ATLAS_PROJECTION`, `html_projection.py:1631`). One row per subsystem,
   always, whether or not edges exist. No new component. The page's heading becomes its title.
2. **A boundary diagram, built at render time.** A new SVG on the architecture page, after the
   atlas or dependency section: subsystems as boxes in one column band per layer, and one line
   per recorded relation. Seams are drawn as undirected lines labelled with the seam ID; recorded
   `xrefs` as arrows. It follows the runtime-SVG pattern (`_runtime_boundary_diagram`): inline
   SVG, CSS tokens, `role="img"` with a title and description, and the existing topology cards
   kept beside it as the readable account. Rules from `reporting-style.md` that bind it: no edge
   inferred from names or layers; a subsystem with no recorded relation is drawn and counted
   ("12 of 35 subsystems have no recorded boundary"); the caption says "Recorded boundaries", and
   says "dependency" only when `xrefs` rows exist; no browser diagram runtime.
3. **Not in scope:** a force-directed or interactive graph, which `reporting-style.md` rules out
   ("decorative heroic graph"), and any change to why stores record no `xrefs` (§1.3).

Layout, so the packet can be executed without design work: columns are layers in the order the
Subsystem map lists them; boxes within a column are in ID order; a box is 200×44 CSS px with the
ID on line 1 and the truncated name on line 2; lines are straight between box edges, drawn under
boxes, with the seam ID at the midpoint in a small label. Above 8 layers the SVG wraps to a second
band. This is plain, legible at AxiomDB's size (35 boxes, 20 lines), and testable.

### 2.6 The word "conspectus"

**Decided (D2).** Reader-facing copy says "this survey" or "this site" and defines "conspectus"
once, in Terms, as the product's name for the record and the site built from it. Titles change:
"How to read the conspectus" → "How to read this survey". Durable names
(`conspectus-vocabulary.json`, `#conspectus-search`) stay.

### 2.7 "Map"

**Decided (D3).** The page keeps the title "Subsystem map" once O7 gives it the atlas, and its
heading "# Master plan" becomes that title. The status label "Mapped" stays and Terms defines it
(Appendix A). The other "map" names (§1.3) are left alone.

## 3. Relation to existing work

**Reader lenses** (`design/reader-lenses/spec.md`, packets P1–P16, landed):

- **Builds on** §7.1's page plan and §10's single-source contract. Every addition here is
  generated from those two sources.
- **Amends §7.8.** §7.8 says the guide is "one table per enum". This plan reorders the guide
  (what the site is; pages; how a survey works; terms; IDs; status values) and puts the
  non-reader-facing enums last. Packet O3 adds a one-line note to §7.8 pointing here.
- **Respects §7.2.** The overview's five items stay in source order with nothing between them
  (`test-overview-truthfulness.py`, `OVERVIEW_SECTIONS`). The plan changes only item 1's sentence
  (identity), adding who wrote the site and a link to the guide, and avoids every
  `orientation_forbidden_terms` entry and every number, so the composite-index lint has nothing
  to read.
- **Compatible with §1.3** ("no lens, page, or field is named for what a reader should do"):
  "Use it when" is a hint column, not a name.
- **Compatible with §9.2** and `reporting-style.md`'s diagram rules; §2.5 follows them.

**Explanation lane** (`design/explanation/`, merged 2026-11-06): it explains the *codebase*
(thesis, purpose, account). This plan explains *Amanuensis*. They meet in two places: the ID
tooltip already uses a subsystem's purpose sentence (`core.py`, `_build_xref_index`), which §2.2
leaves as is; and the orientation lint (`lint.py`) applies to thesis and explanations only, so
a guide that defines "stale" and "mapped" does not trip it. Nothing is superseded.

**BACKLOG.md:** no open item covers orientation. Two touch it: "Downstream publishing ships
Markdown only" (so every addition here must render in Markdown too, §7.9) and the explanation
quality items (unrelated). **Nothing in the backlog is superseded.** Packet O0 adds this plan
as a backlog entry.

**Repository `docs/`:** this repository publishes its own conspectus to `docs/`, and publishing
it breaks the dogfood gate until its receipt is re-recorded. No packet here republishes `docs/`.
The changes reach `docs/` at the next deliberate republish (decision D5).

## 4. Packets

Rules for every packet:

- Work in a worktree on a branch; do not touch the primary checkout.
- Do not run Amanuensis tools, the skill, or `materializer/materialize.py` against a real store.
  Tests seed their own stores, as `materializer/test-lens-pages.py` does (`make_workspace`,
  `seed`, `publish`); copy that pattern.
- New gate files go in `materializer/` (or `dev/` for skill-only checks), carry a "Turns red when"
  docstring like the existing gates, and get a step in `.github/workflows/test.yml` next to the
  other materializer gates.
- Run tests serially, never in parallel. Run `biome format` only inside `mcp-server/src`.
- **Done** means: the packet's gate is green, every earlier orientation gate is green, and the
  existing materializer gates in `test.yml` are no redder than before (diff the FAIL lines, not
  only exit codes). Commit each green packet.
- **Gate markers.** Every gate prints exactly one status line, last: `GATE <packet id> RED:
  <reason>` with a non-zero exit, or `GATE <packet id> GREEN` with exit 0. The id is the
  packet's own (`O1`, `O12`), never a decision or finding id (`D4`, `W6`). An earlier lane halted
  because a gate printed an id other than the one its launcher looked for. Each packet has its
  own gate file; a packet that "extends" another packet's gate gets a new file instead.
- Order: O0 → O1 → O2 → O3 → O4 → O6 → O9 → O14 → O5 → O7 → O8 → O10 → O12 → O13. O11 only on
  D5, after the rest. `design/orientation/plan.json` is the executable form of this order and of
  every packet's files, gate and regressions; where the two differ, fix the JSON to match this
  file.

### O0 · Record the plan

- **Files:** `BACKLOG.md`.
- **Do:** add a "Reader orientation" section under "Publishing and rendering" that links this plan
  and lists W1–W9 as items, each one line.
- **Gate:** new `dev/test-orientation-backlog.mjs`. Turns red when `BACKLOG.md` has no link to
  `design/orientation/PLAN.md`, or the "Reader orientation" section lacks any of W1–W9.

### O1 · Contract: terms, ID kinds, survey passes, reader-facing flag

- **Files:** `mcp-server/contracts/conspectus-vocabulary.json`,
  `mcp-server/scripts/gen-vocabulary.mjs`, generated `materializer/amanuensis_materializer/vocabulary.py`
  (and `mcp-server/src/vocabulary.ts` if the generator emits there).
- **Do:**
  1. Add `reader_terms` (Appendix A), `id_kinds` (Appendix B: `kind`, `shape`, `names`,
     `chosen_by`, `links_to`), and `survey_passes` (Appendix C table: `pass`, `phase`, `does`,
     `status`, `set_when`). `set_when` is `"start"` or `"end"`: the pass sets `status` when it
     starts or when it finishes. Values, per D4: Scope `scoping`/end, Structure `structural`/end,
     Concern review `concerns`/start, Challenge `adversarial`/start, Packaging `mapped`/end.
  1a. **D4 labels and meanings** in `subsystem_status`: `scoping` label "Scoping" → "Scoped"
     (owner, 2026-11-20: the depth means the scope pass is done, and "Scoping" read as under
     way); `concerns` label "Concerns" → "Reviewing concerns"; `adversarial` label
     "Adversarial" → "Challenging claims". Values,
     `authorizes` and `cannot_justify` do not change. Meanings: `scoping` becomes "The scope
     pass is done: the subsystem's boundary and files are established, nothing more.";
     `structural` becomes "The structure pass is done: types, state, flows and concurrency are
     mapped; correctness claims are not yet authorized."; `concerns` and `adversarial` keep
     theirs (they already say "in progress" / "being challenged"). Leave the `pass_type` enum's
     own "Adversarial" label alone; it is a different enum. The value `scoping` stays: the
     server, the skill's ladder and `check-evidence-vocabulary.mjs` use values, not labels.
     Before changing, `rg -n '"Scoping"|"Concerns"|"Adversarial"|Reviewing concerns'
     materializer mcp-server/src dev` and update any test that asserts an old status label
     (none did at `0ce2b18`; labels are read from `VOCABULARY`).
  2. Add `"reader_facing": true|false` to every enum. True for: `finding_resolution_state`,
     `severity`, `subsystem_status`, `standing_state`, `stale_reason`, `file_classification`,
     `evidence_kind`, `disposition_classification`, `field_note_category`,
     `open_question_category`, `open_question_resolution`, `contradiction_resolution`,
     `diagnosticity_outcome`, `lens`. False for the rest.
  3. Teach the generator to validate and emit them to Python as `READER_TERMS`, `ID_KINDS`,
     `SURVEY_PASSES` (tuples of dicts) and to carry `reader_facing` inside `VOCABULARY`. Validation
     errors: a term without a definition; an alias equal to another term; a `survey_passes`
     `status` not in `subsystem_status`, or `set_when` other than `start`/`end`; the
     `survey_passes` statuses out of ladder order; an enum missing `reader_facing`.
  4. Bump `contract_version` to `1.1.0`.
- **Gate:** `node mcp-server/scripts/gen-vocabulary.mjs --check` and `--check-sql` green; new
  `materializer/test-orientation-contract.py` turns red when any of the four validation errors
  above is accepted (it writes a broken copy of the JSON to a temp dir and runs the generator on
  it); when `vocabulary.py` lacks the three constants; or when a `subsystem_status` value whose
  `survey_passes` row has `set_when: "start"` has a label that does not begin with an "-ing"
  word; or one with `set_when: "end"` has a label that does begin with one (so "Scoping" is
  red), or a meaning containing neither "done" nor "complete". These checks keep D4's labels
  and meanings in step with the timing. `node
  mcp-server/scripts/check-evidence-vocabulary.mjs` stays green (it compares status values, not
  labels).

### O2 · The page index

- **Files:** `materializer/amanuensis_materializer/core.py` (`PagePlan`, `_routes`, the
  `plan.extend` list), `renderers.py` (`_route_tables`), `html_projection.py` (`SitePage`, the
  page-head block near `:3016`).
- **Do:** add `use_when` to `PagePlan` and `SitePage`; fill it for every static page from
  Appendix D, and for the subsystem and matrix subgroups once; give the overview and guide real
  hints (Appendix D). Rewrite `_route_tables` as §2.4 describes. Print `use_when` under the hint
  in HTML, and print hint plus `use_when` as an italic paragraph under the H1 in Markdown.
- **Gate:** new `materializer/test-orientation-index.py`. Turns red when: a static page has an
  empty hint or `use_when`; the index has a row per subsystem instead of one per subgroup; a
  planned page is missing from the index; the Markdown and HTML of any page disagree about its
  `use_when` text.

### O3 · The guide's new shape and Terms

- **Files:** `renderers.py` (`HOW_TO_READ_INTRO`, `_vocabulary_tables`, `render_how_to_read`),
  `core.py` (guide title, §2.6), `design/reader-lenses/spec.md` (one line in §7.8).
- **Do:** guide sections in this order: **What this site is** (Appendix C, first paragraph);
  **Pages on this site** (O2); **How a survey works** (O4 fills it; until then the heading is
  absent); **Terms** (from `READER_TERMS`, one `###` per term with `<a id="term-<slug>">`,
  aliases on one line, definition, "Seen on:" links); **How IDs are formed** (O5 fills it);
  **Status values** (reader-facing enums, plain heading, stored name in a code span after it);
  **Full vocabulary** (the rest; `<details>` in HTML).
- **Gate:** new `materializer/test-orientation-guide.py`. Turns red when: the H2 order differs
  from the list above (ignoring the two not yet filled); a `READER_TERMS` entry has no anchor; a
  non-reader-facing enum appears before "Full vocabulary"; the first 600 bytes of the guide's
  Markdown body contain a backtick (raw stored names up top are the thing being fixed); the
  guide's title contains "conspectus" (D2); the Terms section lacks an entry for "Conspectus"
  or for "Mapped" (D2, D3).

### O4 · How a survey works

- **Files:** `renderers.py` (guide section; overview identity line at `:1041`;
  `render_open_questions` lede), `materializer/test-overview-truthfulness.py` (identity
  expectation only).
- **Do:** render Appendix C from `SURVEY_PASSES` and `subsystem_status` (labels and meanings
  generated; the surrounding sentences are constants in `renderers.py`). Change the identity
  sentence to Appendix C's overview version. Add the how-to-answer line to "Decisions needed".
- **Gate:** new `materializer/test-orientation-workflow.py`. Turns red when: the pass table has
  a row count different from `SURVEY_PASSES`, or a depth label that differs from the contract's
  label, or a row whose "when" cell disagrees with its `set_when` (D4); the section lacks the
  subheadings "What it expects from you" and "Phase numbers"; the Decisions needed page lacks
  "tell the agent"; the overview identity paragraph contains a
  forbidden term or a digit. `test-overview-truthfulness.py` must stay green with only its
  identity expectation updated.

### O5 · IDs

- **Files:** `xref.py` (`ID_PAT`, `XrefIndex.link`), `html_projection.py`
  (`_IDENTIFIER_PATTERN`, `_IdentifierMarkup`), `core.py` (`_build_xref_index`: pass names and
  kinds), `renderers.py` (guide section "How IDs are formed").
- **Do:** §2.2 items 1–5. Build both patterns from the index's keys
  (`re.escape`, longest first, same lookarounds). First-mention expansion happens in the
  Markdown xref pass so both views get it: track, per page, which subsystem IDs have been
  expanded; skip a match whose table row already holds the name. The letter key is computed in
  the renderer from `subsystems.id` and `subsystems.layer`.
- **Gate:** new `materializer/test-orientation-ids.py`, with a fixture of two stores: one whose
  letters map one-to-one to layers, one like AxiomDB's (`C` and `P` in one layer). Turns red
  when: the guide's letter sentence is wrong for either store; `B04-R6` or a lowercase ID in prose
  is not linked; the first body mention of a subsystem ID on a page lacks its name; a second
  mention gains one; an ID in a table with an adjacent Name column gains one; a concern code in
  prose lacks the "concern" prefix.

### O6 · Terms on each page

- **Files:** `html_projection.py` (page head), `renderers.py` or `core.py` (a helper that maps a
  page path to its terms via `READER_TERMS[*].pages`).
- **Do:** print "Terms on this page:" with links to the guide's anchors, under the `use_when`
  line, in both views. Omit the line when a page has no terms.
- **Gate:** new `materializer/test-orientation-terms.py`: turns red when a page listed in some
  term's `pages` lacks the line in either view, a page with no terms has the line, or a link's
  anchor does not exist in the guide's HTML.

### O7 · Subsystem map atlas and one name

- **Files:** `renderers.py` (`render_master_plan`).
- **Do:** §2.5 item 1. Change `# Master plan` to the page title, "Subsystem map" (D3: the title
  in `core.py` stays as it is).
- **Gate:** new `materializer/test-orientation-map.py`: turns red when `master-plan.html` lacks
  `class="subsystem-atlas"` with one `atlas-item` per subsystem (seed at least two layers and a
  `deferred` subsystem), or the Markdown H1 is not "Subsystem map". `test-lens-pages.py` stays
  green.

### O8 · Boundary diagram

- **Files:** `diagrams.py` (a pure function returning nodes, edges and layer order),
  `renderers.py` (`render_architecture`: a marker the HTML recognises, as the runtime table is
  recognised by its header signature), `html_projection.py` (an SVG builder modelled on
  `_runtime_boundary_diagram`, CSS tokens next to the `runtime-svg-*` rules).
- **Do:** §2.5 item 2 and its layout.
- **Gate:** new `materializer/test-orientation-diagram.py`. Turns red when: the SVG has a node
  count other than the subsystem count or a line count other than seams plus `xrefs`; any line
  joins two subsystems no seam or xref names; the caption says "dependency" with zero `xrefs`;
  the "no recorded boundary" count is wrong; the SVG lacks `role="img"`, a `<title>` or a
  `<desc>`; the page contains `<script` referencing a diagram library; zero seams and zero xrefs
  produce an SVG instead of a sentence.

### O9 · Overview link and polish

- **Files:** `renderers.py` (`render_index`, lens routes).
- **Do:** the Method route reads "How to read this survey: what each page is for, the terms it
  uses, and how a survey works". Nothing else on the overview changes.
- **Gate:** new `materializer/test-orientation-overview.py`: turns red when the overview's
  Method route (both views) does not carry that text and link to the guide.
  `test-overview-truthfulness.py` stays green.

### O10 · Skill workflow repairs (W1–W6)

- **Files:** `.claude/skills/amanuensis/references/open-questions.md`,
  `references/subsystem-survey.md`, `references/phase-3-concerns.md`,
  `references/phase-4-adversarial.md`, `references/phase-5-packaging.md`, `SKILL.md`; new
  `dev/test-skill-workflow-text.mjs`.
- **First:** write the gate and run it on the unedited skill. It must be red on W6 (and W3, W4).
  Put its FAIL lines in the commit message. Then edit the skill until it is green.
- **Do:**
  - W1/W2: in "Reviewing the queue", say the person answers by telling the agent, which then
    calls `resolve_open_question`; name the "Decisions needed" page.
  - W3: delete "Run as if option A …" (replace with "Run the inferred scope to completion");
    delete "(approved)" from the resume list.
  - W4/W5: move "Advance status" before "Materialize" and "Seam assessability" in
    `phase-5-packaging.md` and the summary list in `subsystem-survey.md`; keep step 10's commit
    last. Check first that nothing in steps 5–8 needs the subsystem below `mapped`; if something
    does, stop and record it instead.
  - W6 (D4: a status names the pass under way for `concerns` and `adversarial`):
    - `subsystem-survey.md`: replace "After the phase returns" step 1's generic
      `status=<phase_name>` with a table **"When each phase sets the status"**, columns
      `Phase | Status | When`, five rows. The When cell is exactly "before the phase starts" or
      "when the phase ends": 1 `scoping` ends; 2 `structural` ends; 3 `concerns` starts;
      4 `adversarial` starts; 5 `mapped` ends (within Phase 5, before materializing; W4).
      Add a "Before the phase starts" step to "Running a phase" that applies the "before" rows,
      with the server's prerequisite for each: `concerns` needs the registered
      `subsystem-survey` artifact (Phase 2's output); `adversarial` needs at least one
      disposition (Phase 3's output). Keep the refusal handling (diagnose, re-run once, else
      `deferred`). Fix line 67 ("Phase 4 returns, status advances to `adversarial`") to say the
      status is already `adversarial`.
    - Resume list: `unmapped` → Phase 1; `scoping` → Phase 2; `structural` → advance to
      `concerns`, then Phase 3; `concerns` → finish Phase 3 (`get_concern_coverage` shows the
      concerns still without a verdict), then advance to `adversarial` and run Phase 4;
      `adversarial` → finish Phase 4 (claims without a `record_claim_challenge` outcome), then
      Phase 5.
    - `phase-3-concerns.md`: near the top, before the first `set_disposition`, say "The
      coordinator has already advanced this subsystem to `concerns`; `set_disposition` and
      `add_finding` are refused below it." Replace `:188` with "The coordinator advances to
      `adversarial` and starts adversarial review immediately. No pause."
    - `phase-4-adversarial.md`: the same opening sentence for `adversarial` (adversarial
      `set_disposition`/`add_finding` are refused below it). Replace `:225` with "The coordinator
      runs Phase 5 packaging immediately. No pause."
    - `SKILL.md` (`:129-131`): keep the ladder line exactly as it is (the vocabulary check parses
      it); replace the arrow row under it with one sentence per rung saying which phase sets it
      and when, matching the table above. The "Authorized claims" table keeps its rows and values.
- **Gate:** the new script turns red when:
  - `open-questions.md` contains "option **A**" or tells the human to call a tool;
  - `subsystem-survey.md` contains "(approved)";
  - in `phase-5-packaging.md` the "Advance status" heading comes after "Materialize" or "Seam
    assessability";
  - **(W6)** `subsystem-survey.md` contains `status=<phase_name>`, or lacks the "When each phase
    sets the status" table, or that table's (status, when) pairs differ from the contract's
    `survey_passes` (`status`, `set_when`; "before the phase starts" = `start`, "when the phase
    ends" = `end`). Read `mcp-server/contracts/conspectus-vocabulary.json` directly, so the
    skill and the site share one source (this makes O10 depend on O1);
  - **(W6)** in `phase-3-concerns.md`, the first mention of `set_disposition` comes before a
    sentence saying the subsystem is already at `concerns`; or any line says the coordinator
    "advances to `concerns`" after the phase. The same for `phase-4-adversarial.md` with
    `adversarial`, using its first `set_disposition` or `pass_type="adversarial"` mention;
  - **(W6)** `SKILL.md`'s arrow row still puts "Phase 3" under `structural` or "Phase 4" under
    `concerns`.
  
  Also run `node mcp-server/scripts/check-evidence-vocabulary.mjs` (it parses `SKILL.md`'s
  ladder line and its "Authorized claims" table) and keep it green, and add the new script as a
  step in `.github/workflows/test.yml` beside the vocabulary check.
- **Last:** edit only the tracked source `.claude/skills/amanuensis`. Then regenerate the
  packaged copy with `cd mcp-server && node scripts/prepack-bundle-assets.mjs` (the copy under
  `mcp-server/skills` is gitignored, so there is nothing to commit from it) and run
  `node mcp-server/scripts/check-reference-calls.mjs` and `node mcp-server/test-reference-calls.mjs`.
- **Not here:** W7 is handled by Terms; W8 by O4's phase key; W9 by Terms' aliases. The server
  and the contract's values need no change for W6 (D4).

### Publishing defects from `BACKLOG.md` (added 2026-11-20)

The four open items under "Publishing and rendering" in `BACKLOG.md` at `4d92312`, read against
the code. Two can be built now (O12, O13), one in part (O14); two need an owner decision first
(D6, D7 in §5) and are not in the lane. The fifth item, the AxiomDB maintenance lane's publish
step, lives in `~/.claude/automations/axiomdb-maintenance`, outside this repository, and is left
out of this plan.

- **[O] Why the state axis reports the previous run.** The overview's Publication integrity
  block reads the newest `projection_verification_runs` row (`renderers.py`, `render_index`,
  the `verification` query near `:1025`; printed near `:1141`). `materialize_docs` writes that
  row in `recordReadback` (`mcp-server/src/tools/materialize.ts`) only after `materialize.py`
  has written and read back the pages. So a page can never show its own read-back: it always
  shows the publication before it, and a failed attempt's red lands on the next, green
  publication's overview. The same cause makes a CLI render show the last tool-driven run.
- **[O] Survey notes.** `narrative_placement` already puts the survey narrative under the account
  when an account is recorded (`renderers.py`, "survey-record" placement: the "Survey artifact"
  subsection at the end of the page). What is missing is the date: in that placement the
  narrative prints with no provenance at all, and nothing says it is older working notes.
  `artifacts.written_at` and `ref_sha` hold the date and revision; the account's `recorded_at` is
  in `explanations` but not selected by `explanation_rows` (`readback.py`).
- **[O] Markdown only.** Every page is written as HTML and Markdown into the same output
  directory (`SKILL.md`: "HTML is the primary human reading surface; Markdown is its portable,
  inspectable companion"). Nothing on the site says the Markdown lacks the diagrams, search and
  hover definitions, or where the HTML is.

### O12 · Say which publication the read-back describes

- **Files:** `materializer/amanuensis_materializer/renderers.py` (`render_index`, the
  "Publication integrity" block); new `materializer/test-orientation-readback-label.py`.
- **Do:** under "### Publication integrity", when a run exists, print before the table the
  constant sentence `PUBLICATION_INTEGRITY_LAG` = "A publication's read-back is recorded after its
  pages are written, so these results describe the publication before this one." Rename the row
  "Verified at" to "Read back at". Leave the no-run sentence as it is. The new sentence must
  contain no digit and neither word "red" nor "green": `test-overview-truthfulness.py`'s
  `publication_integrity_values` counts those words and dates in the block, and must stay green
  unchanged. Do not change `materialize.ts` or the read-back.
- **Gate:** turns red when, on a seeded store with two runs (older: state axis failed; newer: all
  passed), the overview's Publication integrity block in either view lacks the sentence, still
  says "Verified at", lacks "Read back at" with the newer run's date, or reports the older run.
  Regressions: `test-overview-truthfulness.py`, `test-readback.py`, `cd mcp-server && node
  test-projection-custody.mjs`.

### O13 · Date the survey notes under the account

- **Files:** `materializer/amanuensis_materializer/renderers.py` (`render_subsystem`: the
  `survey_rows` query, the `provenance` string, the "Survey artifact" subsection),
  `materializer/amanuensis_materializer/readback.py` (`explanation_rows`: add `recorded_at` to
  its SELECT); new `materializer/test-orientation-survey-notes.py`.
- **Do:** select `written_at` with each survey artifact row. Add "written on <YYYY-MM-DD>" to
  each artifact's entry in `provenance`, so every placement carries the date. In the
  "survey-record" placement (an account is recorded), print under "### Survey artifact", before
  the prose, one italic line per artifact: "Written on <date> at revision <sha8> as the survey's
  working notes, and kept as written. The account above was recorded on <date> at revision
  <sha8>; where the two disagree, the later one is the current reading." Never modify an
  artifact file (the server appends status lines to it). Dates are the first ten characters of
  the stored timestamps.
- **Gate:** turns red when, on a seeded subsystem with a recorded account and a survey artifact
  whose prose contradicts it: any line of the artifact's prose appears above the account's
  heading; the dated line is missing or names the wrong date or revision for either record; the
  artifact file's bytes changed; or a subsystem without an account (claims present) lacks
  "written on" in its narrative's provenance. Regressions: `test-narrative-placement.py`,
  `test-explanation-pages.py`, `test-prose-retention.py`, `test-readback.py`.

### O14 · Say what the Markdown view leaves out

- **Files:** `materializer/amanuensis_materializer/renderers.py` (the guide's "What this site is"
  section, from O3); new `materializer/test-orientation-views.py`. Depends on O3.
- **Do:** end "What this site is" with: "Each page is written twice from the same record: as
  HTML, which adds the diagrams, the search and the definitions shown on hover, and as Markdown.
  Both are written to the same directory; the HTML starts at index.html. A copy of the Markdown
  alone leaves those out." No backticks (O3's gate forbids them in the guide's first 600 bytes).
  The overview is not changed (§7.2). This is the in-repository half of the backlog item; whether
  downstream copies should carry the HTML is D7.
- **Gate:** turns red when the guide's Markdown or HTML lacks the paragraph, or the publish
  output lacks `index.html` beside `index.md`. Regressions: `test-orientation-guide.py`,
  `test-lens-pages.py`.

### O11 · Cold-reader check (only on D5)

- **Do:** render a fixture store and the AxiomDB store's copy with the new materializer, give a
  fresh model from another lab only the HTML guide and overview, and ask the tester's questions:
  what does `R-06` mean; what is a finding versus a lead; what will the agent do next and what does
  it need from me; which page answers "is this file read". Judge blind against the guide's own
  text.
- **Gate:** each answer correct and traced to a sentence on the site; any miss becomes an O3/O4
  copy fix.

## 5. Decisions for the owner

Decided by the owner on 2026-11-20 (relayed by the backlog-triage session):

- **D1. ID letters: decided, labels only.** The site explains them (§2.2, O5). No onboarding
  change and no scheme for new stores.
- **D2. "Conspectus": decided.** "This survey" in titles and copy; the word is defined once in
  Terms (§2.6, O3).
- **D3. "Map": decided.** "Subsystem map" stays the title once O7 gives it the atlas; the label
  "Mapped" stays and Terms defines it (§2.7, O7, Appendix A).
- **D4. Status timing (W6): decided, option A.** A status names the pass under way for
  `concerns` and `adversarial`; `scoping`, `structural` and `mapped` are set when their pass is
  done. The server and the contract's values stay as they are. The contract gets labels that
  say "under way" and meanings that say "done" (O1); the skill advances to `concerns` and
  `adversarial` before those passes start (O10), and a gate fails on the old order.
  - Follow-up, decided 2026-11-20: the label "Scoping" read as under way although the depth
    means the scope pass is done, so O1 relabels it "Scoped". The stored value stays `scoping`.

Still open:

- **D5. Republish and test on a real store.** Reaching `docs/` and running O11 on AxiomDB need
  Amanuensis use and a dogfood receipt re-record. Owner, 2026-11-20: only after the lane's
  packets land.
- **D6. A CLI render and the store's publication record** (`BACKLOG.md`). `materialize.py` run
  by hand writes pages and records no read-back, so the overview keeps the last tool-driven run
  (O12 at least labels that run as earlier). The backlog names two fixes, and they differ in kind:
  (A) the CLI records its own read-back in the store, which makes the Python materializer a
  writer of `projection_verification_runs` (today only `materialize.ts` writes it); or (B) the CLI
  refuses to write outside the store's `docs/` unless told to, and a page it writes says it was
  not read back. Pick one; not in the lane until then.
- **D7. Should downstream copies carry the HTML?** A conspectus copied into a repository's
  `docs/` carries Markdown only. Shipping HTML too changes what lands in another repository and
  is done by the AxiomDB maintenance lane's publish step, outside this repository. O14 only
  says on the site what the Markdown leaves out. Ship HTML downstream, or not?

## Appendix A · Terms (draft definitions for `reader_terms`)

| Term | Aliases | Definition |
|---|---|---|
| Amanuensis | | The tool that produced this site. An AI agent runs it to survey a repository. |
| Conspectus | survey record | Amanuensis's name for what a survey keeps: a database of what was read and concluded, plus this site, which is built from it. |
| Survey | | The agent's reading of the repository, done in passes, with each conclusion tied to the code it read. |
| Session | | One stretch of work by the agent. Sessions and publications lists them. |
| Subsystem | | A part of the codebase the survey treats as one unit, with its own files and its own page. The agent chose the split during onboarding. |
| Layer | region | A group of subsystems with a similar role. Pages group subsystems by layer. |
| Survey depth | status | How far the survey of a subsystem has got. Unmapped: not started. Scoped and Structural: that pass is done. Reviewing concerns and Challenging claims: that pass is under way. Mapped: every pass is done. Deferred: left out of the survey on purpose. Each depth limits what the record may claim. |
| Mapped | | The last survey depth: every pass has run. It does not mean every file is read or every bug found. |
| Scope | file ledger | The files a subsystem owns, each marked as read, not yet read, or left out with a reason. |
| Evidence | | A pointer to code at a commit (file, symbol, lines) with a note of how strong it is: read in code, seen in a test, stated in a comment, and so on. |
| Claim | | A statement about how the code is built ("this cache is per request"), with evidence. |
| Challenge | adversarial pass | A pass in which the agent tries to prove its own claims and findings wrong. Each claim records whether it survived. |
| Concern | | One kind of defect worth looking for in this codebase, such as a race on a shared cache. The review checklist is the full list. |
| Concern review | disposition | The verdict for one concern in one subsystem: bug found, acceptable, ruled out, out of scope, or undecided. |
| Finding | | A defect the survey confirmed, with evidence, a severity, and a state (open, repaired, verified, ruled out, accepted). |
| Lead | field note | Something the agent noticed that is not a finding: a pattern, an oddity, a tension, a possible concern. |
| Decision needed | open question | Something the agent could not settle alone. It records the assumption it used and keeps going; you answer it. |
| Disagreement | contradiction | Two records that cannot both be true. The survey keeps both until one is settled. |
| Competing explanations | diagnosticity matrix | A table weighing several causes for one symptom against the evidence. |
| System boundary | seam | A place where two subsystems share something (a table, a queue, a cache) and depend on each other's assumptions about it. |
| Recorded edge | xref | A dependency or data flow between two subsystems that the agent wrote down. Edges are never guessed from names. |
| Stale | | A file that changed after the revision the survey recorded for it: the one it was read at, scoped at, or set aside at. What the survey said about it may no longer hold. |
| Checked at | revision | The commit the survey last compared itself against. Everything on the site is as of that commit. |
| Standing | | What the record says about one file: no record, left out, in scope but unread, read, read but changed since. |
| Lens | | One of four groups of pages: Codebase (what the project is), Unresolved (open work), History (what was settled), Method (how far to trust the rest). |
| Thesis | | The paragraph on the overview that says what the codebase does. |
| Purpose, account | explanation | A subsystem's one-sentence purpose and its longer explanation of how it works, each written from evidence. |
| Publication check | read-back | After building the site, Amanuensis reads it back to confirm it matches the record. The overview shows the result. |

`pages` for each term: the packet fills it from where the term's label is printed (for
example Lead → `field-notes.md`, `resolved-leads.md`, subsystem pages).

## Appendix B · ID kinds (draft `id_kinds`)

| Kind | Shape | Names | Chosen by | Links to |
|---|---|---|---|---|
| Subsystem | letters, dash, number: `R-06` | a subsystem | the agent, at onboarding | the subsystem's page |
| Finding | subsystem code, dash, sequence: `R06-2` | a defect in that subsystem | the agent, when it records the finding | Open or Resolved findings |
| Seam | `SM-` and a number: `SM-03` | a system boundary | the agent | System boundaries |
| Concern | short letters, dash, number: `RC-2` | a checklist item | the agent, at onboarding | Review coverage |
| Seam concern | `SC-` and a number | a checklist item about one boundary | the agent | Review coverage |
| Competing explanations | `DM-` and a number | one evidence table | numbered by Amanuensis | its own page |
| Decision | `#` and a number | a decision needed | numbered by Amanuensis | Decisions needed |

Sentence above the table: "IDs are short labels so records can point at each other. Except
where this page says otherwise, the letters are not a code: read the name beside the ID."

## Appendix C · How a survey works (draft copy)

**Overview identity (item 1 of §7.2):** "An architecture survey of {name}. An AI agent running
Amanuensis read the repository, without changing it, and recorded what it found here. New to this
site? Start with [How to read this survey](how-to-read.md)."

**Guide, "What this site is":** "This site is the record of an AI agent's survey of {name}. The
agent read the code, recorded what it concluded and the code each conclusion rests on, and
listed what it could not settle. It does not change the code. Every page is as of one commit,
shown at the top as *Checked*."

**Guide, "How a survey works":**

> The agent works in two stages and does not wait for approval between steps.
>
> **Onboarding**, once. The agent reads the repository's shape, splits it into subsystems
> grouped by layer, writes a review checklist of defects worth looking for in this codebase,
> ranks the subsystems, and publishes the first version of this site.
>
> **A survey of each subsystem**, highest priority first, in five passes:

| Pass | What the agent does | Survey depth it sets, and when |
|---|---|---|
| Scope | Lists the subsystem's files and the terms it uses. | Scoped, when the pass is done *(label and meaning generated)* |
| Structure | Reads the files; records types, state, data flows, concurrency, and claims. | Structural, when the pass is done |
| Concern review | Gives every checklist item a verdict with evidence. Confirmed defects become findings. | Reviewing concerns, as the pass starts |
| Challenge | Tries to prove each claim and finding wrong. | Challenging claims, as the pass starts |
| Packaging | Writes the subsystem's purpose and account, updates the site. | Mapped, when the pass is done |

> A subsystem shown as *Reviewing concerns* or *Challenging claims* is in the middle of that
> pass: its verdicts and findings so far are not the last word.

> **Refresh**, when the code changes. The agent re-reads files that changed since it read them.
> Until then they are listed on Stale knowledge.

**What it expects from you**

- Nothing, for it to keep going. When it cannot decide something, it records a *decision
  needed* with the assumption it used, and carries on.
- At each checkpoint (after onboarding, after each subsystem, and at the start of each session)
  it posts a summary in your chat. Read **Decisions needed** then, and answer what you can by
  telling the agent in your session. This site is read-only; answers reach the record only
  through the agent.
- You can redirect it at any time: name a subsystem to survey next, say "stop", or ask "what do
  we know about <file>".

**Phase numbers.** Notes written by the agent may say "Phase 2". Onboarding has Phases 0–7;
each subsystem survey has Phases 1–5, which are the five passes above in order.

## Appendix D · Page index copy (draft `use_when`)

| Page | Hint (new or kept) | Use it when |
|---|---|---|
| Overview | What the codebase is, and where the survey stands. | you arrive, or want the current counts. |
| Architecture | kept | you want the overall shape before reading any one part. |
| Subsystem map | kept | you are looking for the part of the code that does something. |
| Files | kept | you want to know whether a particular file was read. |
| Not yet surveyed | kept | you want to know what the survey has not covered. |
| System boundaries | kept | you are changing something two subsystems share. |
| Codebase glossary | kept | a project-specific name is unfamiliar. |
| Open findings | kept | you want the defects still open. |
| Disagreements | kept | you want to know where the record contradicts itself. |
| Decisions needed | kept | you want to know what the agent needs from you. |
| Leads | kept | you want things noticed but not yet confirmed. |
| Stale knowledge | kept | you want to know what may be out of date since the code changed. |
| Hot spots | kept | you want to know where open work concentrates. |
| Resolved findings | kept | you want to know what was fixed or ruled out, and on what basis. |
| Resolution history | kept | you want to know how a record reached its state. |
| Resolved leads and questions | kept | you want to know how a question was answered. |
| Sessions and publications | kept | you want to know when the survey ran. |
| Conflicting evidence | kept | you want to see how a disagreement was settled. |
| Reader's guide | What each page is for, the terms the site uses, and how a survey works. | a word, an ID or a page is unfamiliar. |
| Review coverage | kept | you want to know which defect kinds were checked where. |
| Review checklist | kept | you want the list of defect kinds and where it came from. |
| Competing explanations | kept | you want to see how a symptom's cause was weighed. |
| Onboarding record | kept | you want the first pass's decisions about scope and split. |
| Where to begin | kept | you want the reading path an earlier session wrote. |
| Subsystem pages | one per subsystem | you have picked a subsystem. |
| Evidence tables | one per matrix | you followed a `DM-` link. |
