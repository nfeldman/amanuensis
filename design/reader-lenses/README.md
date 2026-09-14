# Reader lenses: one record, four questions

- Status: proposal for a product ruling, 2026-09-10. Nothing here is implemented.
- Representative corpus: the AxiomDB conspectus at storage state 2026-09-10 21:57
  (`~/repos/axiomdb/.amanuensis/docs/`, `memory.db` at 22:03), read only.
- Amanuensis source: `main` at `01f778a`.
- Practice catalog: 2.13, stamp `3ffe3ba1f9e1`, queried at the framing moment.

## Evidence labels

- **[O] Observation:** directly visible in Amanuensis source, the AxiomDB store, or its
  generated projection. Each carries a file, query, or page reference.
- **[R] Prior ruling or research:** an accepted decision record, panel ruling, or Scholiast
  claim in this repository.
- **[J] Judgment:** a design decision proposed here. Not promoted to evidence.

## The problem in one paragraph

Amanuensis holds three kinds of knowledge about a codebase in one store: an account of
what the system is and how it works, a register of what is currently wrong or contested,
and a ledger of what was concluded and later resolved. The human projection and the tool
surface both present that store through a single organizing principle, the survey
method: pages and tools are named for the phase that produced a record, not for the
question a reader brings. The visible symptom is a findings page whose first record is a
verified-fixed critical defect and an overview that counts it as one of "1 critical, 4
high". The structural cause is that resolution state is rendered as a badge inside a
severity ordering, the documentation content is locked in prose that nothing can query
by file or symbol, and no entrance to the record starts from the code's own coordinates.

## 1. What the record holds and how it is projected today

### 1.1 The three uses are already distinct in the data

| Reader question | Record families that answer it | Where they surface today |
|---|---|---|
| What is this system and how does it work? | `subsystems` (scope, jump-in, notes), `vocabulary`, `seams`, `xrefs`, the Phase 2 structural inventory, the entry-point thesis | `master-plan`, `architecture`, `vocabulary`, per-subsystem pages, `entry-point` prose |
| What is wrong or unsettled right now? | open `findings`, unresolved `contradictions`, open `diagnosticity_sessions`, `unresolved-competition` dispositions, open `field_notes`, open `open_questions`, stale ledger rows | `findings` (mixed with resolved), `contradictions`, `diagnosticity`, `field-notes`, `open-questions` |
| What was concluded before, and what happened to it? | `finding_resolution_events`, resolved contradictions, answered questions, resolved notes, `sessions`, publication receipts, storage history | `findings` (mixed with open), nowhere else |
| How far should I trust any of this? | `file_ledger` classification and staleness, `dispositions` × `concerns` coverage, `evidence` kinds, projection read-back, `how-to-read` | `concerns`, `concern-checklist`, `how-to-read`, the per-page snapshot strip |

**[O]** Every family in the second column exists as a table or view in
`mcp-server/src/schema.sql`. The projection does not lack data. It lacks a partition by
question.

### 1.2 The projection is organized by method phase

- **[O]** The site navigation groups pages as Orientation, Evidence, Working record, and
  Reference ([core.py:337](../../materializer/amanuensis_materializer/core.py:337)). Those
  are names for how records were produced.
- **[O]** A subsystem page renders, in order: status and layer, scope, start here, notes,
  file ledger, concern review, findings, related subsystems, seams, vocabulary, and only
  then "Survey notes"
  ([renderers.py:282](../../materializer/amanuensis_materializer/renderers.py:282)). Key
  types, state containers, data flows, and the concurrency model live inside "Survey
  notes" as prose under a heading literally named "Structural inventory (Phase 2)". In
  AxiomDB that heading appears on 26 of 35 subsystem pages, always after the ledger and
  the concern table.
- **[O]** The W-01 page opens with "Status: Mapped, Layer: Write path", then scope, then
  a ruled file register; the account of what the write coordinator does begins several
  screens down.

### 1.3 Resolution state is a badge inside a severity ordering

- **[O]** `render_findings` orders by severity, then subsystem, then id, and prints the
  resolution state as a column
  ([renderers.py:442](../../materializer/amanuensis_materializer/renderers.py:442)).
- **[O]** AxiomDB, severity × current resolution, from `finding_resolution_current`:

| Severity | open | verified-fixed | ruled-out |
|---|---:|---:|---:|
| CRITICAL | 0 | 1 | 0 |
| HIGH | 0 | 4 | 0 |
| MEDIUM | 8 | 2 | 1 |
| LOW | 8 | 0 | 1 |

- **[O]** The overview states "Confirmed findings: 25 (1 critical, 4 high)" and, on the
  next line, "Open bugs: 16". The first line counts all findings regardless of
  resolution ([renderers.py:81](../../materializer/amanuensis_materializer/renderers.py:81)).
  Every critical and high finding it advertises is resolved.
- **[O]** The findings page opens with the heading "Critical findings", the subsystem
  "HTTP SPARQL surface and routes", and the record V02-1 carrying a green "Verified
  fixed" tag. The first thing a reader sees under "Confirmed findings" is a closed case.
- **[R]** The 2026-08-23 ruling already required that survey depth, finding resolution,
  severity, source alignment, and proof state carry distinct names and colors
  (`design/delightful-output-panel/revision-2026-08-23.md`). The colors were separated.
  The ordering was not: a resolved critical still outranks an open medium because
  resolution never became a partition.

### 1.4 The overview's prose outranks its measured state

- **[O]** "Quick orientation" on the overview is the first non-heading paragraph of the
  hand-written `entry-point.md`
  ([renderers.py:81](../../materializer/amanuensis_materializer/renderers.py:81)). In
  AxiomDB that paragraph is the 2026-08-23 line "34/34 mapped, 7/7 seams assessed, but
  re-anchored: read the warning". It is displayed on 2026-09-11 beside a strip reading
  "No recorded stale entries", after two nightly maintenance-lane refreshes (sessions
  started 2026-09-10 and 2026-09-11) have re-examined the store.
- **[O]** The site-wide freshness badge and the overview's "Stale entries" both count
  `entries WHERE stale=1`
  ([core.py:220](../../materializer/amanuensis_materializer/core.py:220),
  [readback.py:159](../../materializer/amanuensis_materializer/readback.py:159),
  [html_projection.py:2484](../../materializer/amanuensis_materializer/html_projection.py:2484)).
  `entries` has 0 rows in AxiomDB; nothing writes it. `get_dashboard` counts
  `file_ledger` ([dashboard.ts:24](../../mcp-server/src/tools/dashboard.ts:24)). The
  projection and the tool can disagree about freshness, and only the tool is measuring.
  This is the surface the 2026-08-29 refresh recorded as B04-1; it remains
  fixed-pending-verification in this repository's own conspectus.
- **[O]** The reader's guide is generated from string literals in
  [renderers.py:792](../../materializer/amanuensis_materializer/renderers.py:792). It lists
  five evidence kinds; the server enforces nine. Its finding-status table has no
  `fixed-pending-verification` and no `verified-fixed`, the two states this cycle is
  about. This is the same failure the refresh memory named: every hand-maintained
  restatement drifts, every checked one holds.

### 1.5 The documentation content is not addressable

- **[O]** AxiomDB store populations: `claims` 0, `claim_validity_events` 0, `xrefs` 0,
  `refresh_runs` 0, `change_impact_runs` 0, `revalidation_obligations` 0, `query_log` 0,
  `access_log` 1. The A1–A5 engine (temporal claims, impact, revalidation, unattended
  refresh) has never run against this repository. The survey phases write prose
  artifacts, the file ledger, dispositions, findings, evidence, seams, and vocabulary.
- **[O]** Consequently the only revision-bound, locus-addressable records are evidence
  rows (`get_evidence` filters by `file_path`), finding `primary_files`, and ledger rows.
  What a type is, what state a subsystem owns, and how a request flows are prose.
- **[O]** The ledger carries 111 `candidate` rows (scoped, never read) beside 126
  `examined`, in a conspectus whose every subsystem is `mapped`. V-04 is 13 candidate to
  2 examined. 53 files sit in more than one subsystem.
- **[O]** No tool answers "what is known about `coordinator.rs`". `get_subsystem_files`
  takes a subsystem; `get_findings` filters by subsystem, severity, and status;
  `list_subsystems` has no path filter. An agent must call `get_subsystem_files` up to 35
  times to find an owner, then join by hand.
- **[O]** The HTML search box indexes page label, id, hint, and status
  ([html_projection.py:2442](../../materializer/amanuensis_materializer/html_projection.py:2442)).
  A file path or symbol name finds nothing.
- **[O]** The server instructions and every skill trigger phrase are operator verbs:
  onboarding, survey, resume, audit, refresh
  ([index.ts:18](../../mcp-server/src/index.ts:18),
  [SKILL.md](../../.claude/skills/amanuensis/SKILL.md)). The one consumer route,
  `references/notes.md`, starts from a subsystem id the reader must already know.
- **[O]** 103 field notes are recorded and none is resolved; 31 open questions stand
  against 5 resolved. Neither page orders by consequence.

### 1.6 What is already decided and should not be re-derived

- **[R]** ADR-0001 gives `current`, `stale`, `invalid`, `resolved`, and `verified-fixed`
  mechanical definitions. Standing (section 3.1) is a projection of those definitions
  onto a locus, not a new vocabulary.
- **[R]** ADR-0010 already defines an operational partition for a decision surface:
  regression, latent defect, ruled-out historical, unverified suspicion, unknown, stale
  knowledge, and survived/contested/defeated challenge. It applies only to a review
  session compiled from an A8 composition. The attention lens below reuses those labels
  rather than inventing parallel ones.
- **[R]** The 2026-08-23 ruling: project-first identity, four separate status
  dimensions, consequential findings before inventory, "Not yet surveyed" as the label
  for unexamined territory, and a strict boundary between information architecture and
  interface design. This proposal is IA only. It renames nothing for atmosphere and
  specifies no color.
- **[R]** The reorientation survey (`scholiast/task-workspace-reorientation-indexes/`)
  bounds re-entry to report-owned state. Nothing below implies personal history.

## 2. Diagnosis [J]

Three faults, one root.

**Root.** The projection and the tool surface expose the structure of the *method*. A
reader who arrives with a question about the code has to know which survey phase
produced the answer, and an agent has to know which of 195 tools reads it.

- **F1 · Lens and status are conflated.** Resolution is a status dimension. It was
  correctly separated from severity for color, then left inside severity for ordering
  and page membership. A status dimension decides *which lens* a record appears in;
  severity decides *its order within the lens*. Today both are columns of one table.
- **F2 · Documentation is locked in prose.** The structural account cannot be bound to a
  revision, invalidated by a change, or retrieved by locus, because it is a Markdown
  section, not a claim. The certainty gate the owner asked for can therefore be computed
  for findings and ledger rows but not for "what does this type do". The v2 engine was
  built for exactly this and has never been fed.
- **F3 · There is no locus entrance.** Humans search page titles; agents search
  subsystem ids. The code's own coordinates, path and symbol, are not routes into the
  record, so the most common question an editing agent has ("before I touch this file,
  what is known?") has no cheap answer and no honest "not surveyed" reply.

**On the owner's three-lens proposal.** Codebase / current findings / resolved findings
is the right first cut and the right priority order. Two adjustments follow from the
data. First, "resolved findings" is one section of a broader history lens: resolved
contradictions, answered questions, sessions, and publication receipts are the same kind
of record and today have no home at all. Second, "current findings" should be broader
than findings: contested claims, repairs awaiting verification, candidate concerns, and
decisions needed are all current attention and all currently scattered. A fourth, small
lens for trust apparatus (reader's guide, checklist, coverage, read-back) keeps
method material out of the other three without hiding it.

## 3. Proposal: one contract, four lenses, three projections

The unit of change is a **typed locus account** computed by the server. The HTML
projection, the MCP read surface, and the skill's consumer route are three projections
of that one contract. Nothing is authored twice.

### 3.1 Standing: the certainty gate as a typed record

Every answer about a locus begins with its standing. Standing is computed by code from
existing tables; it is a subtractive guard in the catalog's sense, and it must never be
authored by a model.

A **locus** is one of: a file path; a `file:symbol` pair; a subsystem id; a vocabulary
term. Standing for a file:

| State | Predicate (mechanical) | Authorizes | Cannot justify |
|---|---|---|---|
| `not-in-scope` | no `file_ledger` row | nothing | "no findings here" |
| `excluded` | classification ∈ {generated-ignore, vendor-ignore, irrelevant, deferred-with-reason} | the recorded reason | any claim about content |
| `scoped-unread` | classification = `candidate` | "F participates in S" | any claim about content or absence of defects |
| `examined` | classification = `examined` ∧ stale = 0 ∧ `ref_sha` reachable | current claims whose evidence cites F | claims about symbols not cited; absence of defects |
| `examined-stale` | examined ∧ stale = 1 | a dated historical reading | any current claim |
| `absent` | `scope_gaps.kind = 'absent'` | that F was once surveyed | anything at HEAD |

Alongside the state, standing always carries:

- **owners:** each owning subsystem with its status and its own classification of the
  file; 53 AxiomDB files have more than one owner, and `coordinator.rs` is `examined` in
  three of its six and `candidate` in the other three. When owners disagree, standing
  lists each; there is no single headline state that could hide the mixed case.
- **authority ceiling:** the owning subsystem's status on the existing ladder
  (`unmapped` … `mapped`), stated as what it authorizes, with the skill's caveat that
  `mapped` does not itself prove challenge coverage.
- **checked head vs repository head:** `git_state.last_checked_sha` against the workspace
  HEAD and, when an origin is recorded, the origin head. If they differ, standing says
  "unchecked since `<sha>`". This is the AxiomDB anchor warning made mechanical instead
  of a paragraph that outlives its truth.
- **measured:** whether staleness was measured at all (`file_ledger` non-empty, a
  `detect_changes` recorded), so zero can never read as fresh by default.
- **unknown:** a mandatory list, possibly empty, of concerns without a disposition for
  the owner, candidate siblings in the same subsystem, open questions and open field
  notes naming the locus, and unassessed seams the owner is party to.

For a subsystem locus the same block reports examined/candidate/stale counts, terminal
dispositions over applicable concerns, findings by resolution state, and seam
assessability. For a `file:symbol` locus it reports the file's standing plus whether the
symbol is individually cited by any current evidence row; if not, it says so rather than
inheriting the file's state silently. For a term it returns the vocabulary row or "not
defined" with the nearest recorded terms.

**Operational definition rule (catalog VP12).** Each state names what evidence cannot
justify. "No open findings" at a `scoped-unread` locus is absence of examination, and
the projection must say "not examined", never "no findings".

### 3.2 The account: what a locus is known to be

After standing, an account has optional sections, each item carrying its own `ref_sha`
and evidence kind, current-only by default in ADR-0001's sense and historical on request:

1. **purpose and entry:** owner subsystem purpose sentence and start-here reading;
2. **structure:** current structural claims citing the locus (key types, state
   containers, flow steps, concurrency invariants, seam contracts). Empty today; see P3;
3. **defects:** findings citing the locus, partitioned `open`, `awaiting verification`,
   `verified-fixed`, `ruled-out`, `accepted`;
4. **reviews:** dispositions whose evidence cites the locus, with concern, verdict,
   evidence quality, and linchpin flag;
5. **boundaries:** seams naming the locus's owner, with shared object and other party;
6. **terms:** vocabulary scoped to the owner or first seen at the locus;
7. **leads and questions:** open field notes and open questions naming the locus;
8. **history pointer:** counts of resolution events and sessions touching the locus.

The account never contains a model-generated summary. Narrative prose from survey
artifacts may be attached, labelled as narrative that is not individually revision-bound.

### 3.3 Four lenses with mechanical membership

A lens is a query plus a presentation over the same records. A record can appear in more
than one lens with different fields; it is authored and marked once.

| Lens | Reader question | Membership predicate | Ordering | Honest empty state |
|---|---|---|---|---|
| **Codebase** | What is this, how does it work, what is not yet known? | subsystems, structural claims, seams, edges, vocabulary, standing per file | by the system's own structure: layer → subsystem → file → symbol | "not yet surveyed" territory listed explicitly, never omitted |
| **Needs attention** | What is wrong, contested, or unverified right now? | findings with `resolution_state ∈ {open, fixed-pending-verification}`; unresolved contradictions; open diagnosticity matrices; `unresolved-competition` dispositions; open `candidate-concern` notes; open questions; stale examined files | open by severity, then awaiting verification, then contested, then decisions, then leads | "no open findings at `<sha>` over `<n>` examined files" with basis |
| **History** | What was concluded and what became of it? | findings `verified-fixed`, `ruled-out`, `accepted`; resolved contradictions; answered or dismissed questions; resolved notes; sessions; refresh runs; publication receipts | newest first; filterable by subsystem and locus | "no resolutions recorded" |
| **Method** | How far should I trust this? | reader's guide, concern checklist, coverage matrix, evidence-kind profile, staleness measurement, read-back proof, onboarding record | fixed | none needed |

The **overview** is not a lens. It is the entrance: identity and thesis; the four status
dimensions the 2026-08-23 ruling already named (source alignment, survey coverage, open
engineering work, publication integrity), each from durable records; one route into
each lens. No composite score. The findings line becomes four linked numbers by
resolution state.

### 3.4 Human projection

Navigation collapses to the entrance plus four groups. Current pages map as follows.

| Current page | New home | Change |
|---|---|---|
| Overview | Overview | counts by resolution state; thesis taken from the "What is this codebase?" section by heading, not the first paragraph; freshness from the ledger |
| Architecture | Codebase · Architecture | unchanged rule: atlas until edges are recorded, then topology from recorded edges only |
| Subsystem map | Codebase · Subsystems | grouped by layer with purpose sentences; survey depth as a subordinate fact |
| Subsystem pages | Codebase · `<id>` | reordered: purpose, start here, structure (claims, or narrative labelled as such), boundaries, vocabulary, known defects here (open first; resolved collapsed with links to History), standing block, then the survey record (ledger, concern review, adversarial notes) as secondary apparatus |
| — | Codebase · Files | new: one row per ledger file with owners, standing, examined revision, open-defect count; ⌘K indexes paths and cited symbols and lands on the subsystem-page anchor |
| — | Codebase · Not yet surveyed | new: unledgered paths, candidate rows by subsystem, deferred subsystems, unassessed seams, concerns without dispositions. The edge of the map, as a page |
| Codebase glossary | Codebase · Vocabulary | unchanged |
| Findings | Needs attention · Open findings | only open and awaiting verification; each rendered once with its marker |
| — | Needs attention · Contested | new: unresolved contradictions, open matrices, unresolved-competition dispositions |
| Decisions needed | Needs attention · Decisions | unchanged content; consequence-first ordering |
| Field notes | Needs attention · Leads | open notes only, candidate-concern first; resolved notes move to History |
| — | Needs attention · Hot spots | new: the hotmap. One row per subsystem with separate columns: open findings by severity, awaiting verification, contested, weakest evidence quality among confirmed-bug dispositions, unread fraction, stale files, unassessed seams, and access heat only when measured. Sorted by open critical/high, then medium, then unread fraction. No composite |
| — | History · Resolved findings | new: verified-fixed with fix revision and verification evidence; ruled-out with the overturning argument; accepted with the rationale |
| — | History · Resolution history | new: append-only event timeline per finding |
| — | History · Sessions and publications | new: sessions with intent and outcome, refresh runs, read-back receipts |
| Review coverage, Review checklist | Method | unchanged |
| Conflicting evidence, Competing explanations | Needs attention · Contested (open) and History (resolved) | split by resolution |
| Reader's guide | Method · Reader's guide | generated from the same enum source the server validates against |
| Onboarding record, Where to begin | Method · Onboarding record; the thesis section of Where to begin feeds the overview | the rest of the entry-point prose is survey history, labelled as dated |

Every page keeps the snapshot strip and gains a standing block appropriate to its lens.
The read-back state axis is preserved: each finding renders exactly once as a full
record with its marker, in whichever lens its resolution state selects; other lenses
link.

### 3.5 Agent projection: three read tools

The 195-tool surface stays; three tools are added and advertised first, so a consumer
never needs the operator vocabulary.

- `describe_locus(locus, sections?, as_of_sha?)` returns standing always, then the
  requested account sections. Zero model calls, deterministic, every item revision-bound.
  Default sections: purpose, structure, defects, boundaries, terms, unknown.
- `get_attention(scope?)` returns the Needs attention lens as data: open findings by
  severity, awaiting verification, contested, decisions, leads, and the hot-spot rows.
  `scope` is a subsystem id or a path prefix. This is the hotmap for agents.
- `get_history(locus | finding_id)` returns resolution events, supersessions, and the
  sessions that touched the locus.

Routing changes so the tools are reachable in one step:

- `SERVER_INSTRUCTIONS` opens with the consumer route: to learn what is known about a
  file, symbol, subsystem, or term, call `describe_locus`; its standing states what the
  record authorizes; do not claim beyond it.
- The skill routing table gains a row: "what do we know about X", "before I change X",
  "is there a finding on this file" → `describe_locus` first; answer with standing, then
  the account; when standing is `scoped-unread` or `not-in-scope`, say so and offer a
  survey rather than reading the file and improvising.
- `amanuensis install` offers, opt-in, to append a short "Ask Amanuensis before editing"
  paragraph to the target repository's agent instructions. AxiomDB's `CLAUDE.md` does not
  mention Amanuensis today.

Why not extend `CodebaseBrief`: it is a task-bounded, frozen projection that requires an
A9 review session, itself requiring an A8 composition. That is the right contract for a
review or design session and the wrong weight for "what is this file". `describe_locus`
is the cheap, unfrozen, per-locus read; a brief can cite its output.

### 3.6 Skill projection: the consumer route

`references/notes.md` becomes the consumer route proper. Its answer shape is fixed:
standing first, in one line; then the account, leading with the most consequential open
item if one exists; then what is not known. It cites row ids and `file:symbol@sha` as
today. It never runs a survey.

## 4. Substrate changes, in dependency order

The IA cannot be sharper than the records. These are the changes each lens depends on.

- **P1 · Partition findings by `finding_resolution_current`.** The view exists; only the
  renderer and the overview need to read it. No schema change.
- **P2 · A locus index.** One view joining `file_ledger`, `evidence` (by `file_path` and
  `symbol`), finding `primary_files`, `seams` parties, `vocabulary.first_seen`, and the
  loci named in `field_notes` and `open_questions`. `describe_locus`, the Files page, and
  ⌘K read it. Schema: one view and one index; no new tables.
- **P3 · Phase 2 writes structural claims.** `add_claim` exists with Git validity
  intervals and supersession. Phase 2 records key types, state containers, flow steps,
  concurrency invariants, and seam contracts as claims with evidence, and the survey
  artifact keeps the narrative. The renderer reads claims and falls back to narrative
  with an explicit label. This is the change that connects the v1 survey to the v2
  engine: once documentation is claims, `predict_change_impact` and revalidation apply to
  it, and standing becomes true for documentation, not only for findings.
- **P4 · Edges as records.** Phase 2 records data-flow and dependency edges between
  subsystems (`add_xref` exists; AxiomDB has zero rows). The architecture page renders
  the topology from recorded edges only, and the Codebase lens gains the connective view
  the owner described: seams and flows as the network under the tree.
- **P5 · Overview state from the store only.** The thesis is taken by heading. A
  materialization lint rejects orientation prose containing freshness or status
  vocabulary ("stale", "mapped", "re-anchored", counts of subsystems) so a dated warning
  can no longer headline a refreshed conspectus.
- **P6 · One enum source.** The reader's guide, the `how-to-read` tables, and the server's
  validators read the same enum definitions, checked the way
  `check-evidence-vocabulary.mjs` already checks three copies of the evidence ladder.
- **P7 · Retire `entries`-derived freshness.** The freshness strip, the overview count,
  and the read-back stale axis read `file_ledger`. Until then the strip must say
  "freshness not measured by this projection", which is true.

P1, P2, P5, P6, and P7 require no survey re-run. P3 and P4 change what future surveys
write; existing conspectuses show narrative fallbacks until refreshed.

## 5. Delivery slices with red gates

Each slice ships behind a gate that has been shown to fail before it is trusted.

| Slice | Contents | Turns red when | False-green warning |
|---|---|---|---|
| **S1 · Truthful partition** | P1, P5, P7; findings page and overview; History · Resolved findings | a fixture with one verified-fixed CRITICAL and one open LOW renders the CRITICAL anywhere in Needs attention, or the overview's four counts fail to reconcile to `finding_resolution_current`, or orientation prose carrying status vocabulary reaches the overview | correct partition does not prove the findings themselves are right |
| **S2 · Standing** | P2, P6; `describe_locus`; Files page; Not yet surveyed page; standing block on subsystem pages; ⌘K over paths and symbols | `describe_locus` on an unledgered path returns anything but `not-in-scope`; on a `candidate` returns a non-empty structure section; on a stale row omits `examined-stale`; the reader's guide enum tables differ from the server enums | a mechanically correct standing can sit on a wrong ledger row |
| **S3 · Documentation from claims** | P3; Phase 2 skill change; renderer reads claims; `describe_locus` structure section | a claim closed by `apply_change_impact` still appears as current in `describe_locus` or on the page; a subsystem with zero claims shows an empty structure section instead of "structural inventory not recorded as claims" | claim presence does not prove claim truth; that remains the adversarial pass's job |
| **S4 · Connective view** | P4; edges on the architecture page; `boundaries` section carries edges | zero recorded edges renders anything but the atlas; a rendered edge has no recorded row | edges recorded by a survey can still be wrong |
| **S5 · Consumer routing** | `get_attention`, `get_history`; server instructions; skill route; installer opt-in | the MCP compatibility harness, given only server instructions and no skill, needs more than one call to reach `describe_locus` for a file question | reachability does not prove the answer changed an agent's behavior |

S1 is small and is the direct fix for what the owner saw. S2 is the load-bearing slice.
S3 is the one that changes what Amanuensis *is*: a survey whose documentation is claims
can be kept current by the engine that already exists.

## 6. Reader tests, before and after [J]

Structured walkthroughs, not user-study results, in the format of
`../delightful-output-panel/task-tests.md`.

| Task | Today | Proposed |
|---|---|---|
| T1 · "Is anything open and serious?" | Overview says 1 critical, 4 high; reader opens Findings and reads five badges to learn all five are resolved | Overview: open 0 critical, 0 high, 8 medium, 8 low; one click to the open list |
| T2 · "Before I edit `coordinator.rs`, what is known?" | Human: ⌘K finds no file; guesses W-01. Agent: up to 35 `get_subsystem_files` calls, then hand joins across four tools | Human: ⌘K → W-01 anchor with standing. Agent: one `describe_locus` call. With today's store it would return: `examined` in W-01, R-05, and W-06, `scoped-unread` in W-02, W-03, and W-05, all six owners `mapped`, checked at `d395c4d5`; 22 evidence rows citing 22 symbols; W-01 defects 2 open low and 1 verified-fixed high; structure "not recorded as claims"; unknown: 24 active concerns with no W-01 disposition |
| T3 · "Was the lock-map growth defect fixed?" | Scan the findings page for W01-3 among open records | History · Resolved: W01-3, fix revision, verification evidence, session |
| T4 · "How does the write path work?" | Open W-01, scroll past status, scope, a 19-row ledger, and a 12-row concern table to "Survey notes" | Codebase · W-01 opens with purpose, key types, state containers, flows, boundaries |
| T5 · "What has not been looked at?" | Nothing; 111 candidate rows are distributed across 35 ledgers | Codebase · Not yet surveyed: unledgered paths, candidate rows by subsystem, deferred, unassessed seams, undispositioned concerns |

## 7. Not decided here; for the owner

1. **Labels.** "Codebase · Needs attention · History · Method" are proposed in the
   practitioner register the style contract requires. "Resolved" could be the History
   lens's visible label if the owner prefers the three-lens wording; the membership
   rules do not change.
2. **History as a top-level lens or a filter.** The proposal makes it a lens because
   sessions and publications have no other home. If that feels heavy, Resolved findings
   can sit as the last group of Needs attention with the same partition rule.
3. **Per-file pages or an index with anchors.** AxiomDB has 295 ledger rows; per-file
   pages would triple the projection. The proposal uses one Files page plus anchors and
   ⌘K. Per-file pages become worthwhile only when structural claims are dense.
4. **Backfill.** Existing conspectuses hold 35 subsystems of prose structural inventory.
   Forward-only (new surveys write claims; old pages show labelled narrative) is safe.
   Extracting claims from existing prose is a generative task and the catalog's warning
   applies: required fields get fabricated to order. If a backfill is wanted, bound it
   to the hot subsystems and run it as verify-before-apply.
5. **Injection versus advice.** An editing agent could be made to call `describe_locus`
   by a `PreToolUse` hook rather than by instruction. That is substrate enforcement, but
   it is additive context, not a subtractive guard, and blocking an edit on standing
   would make an advisory record coercive. Proposed as an experiment, not a default.
6. **One attention contract.** `get_attention` and ADR-0010's review session partition
   overlap. The proposal reuses the ADR-0010 labels so a future review brief can cite
   `get_attention` output rather than carrying a second vocabulary. Whether the review
   session should be re-based on it is a separate decision.

## 8. Practice basis

Catalog 2.13. GP37 (decision-relevant parsimony: three read tools and one contract, no
new roles or ceremonies); VP12 (operational definitions with what each label cannot
justify, section 3.1); VP4 (every gate above has a named red condition and a named
false-green); GP14 (context-shaping: standing before account, sections opt-in); BP26
(no composite health score, no progress theater on the overview); GP16 (lens labels,
backfill, and injection remain the owner's decisions). The substrate-not-prompt scope
warning is respected: standing and lens membership are subtractive and computed by
code; the account narrative and the `unknown` list's prose are generative fields and are
not forced to be well-formed.
