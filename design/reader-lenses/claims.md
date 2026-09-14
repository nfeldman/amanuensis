# Reader lenses: claims packet

One normative decision per claim, in `spec.md` order. Evidence lines point at files with line
numbers, SQL over the AxiomDB store at `~/repos/axiomdb/.amanuensis/memory.db` (read-only,
storage state 2026-09-10 21:57), ADR sections, or practice-catalog ids (2.13, stamp
`3ffe3ba1f9e1`).

---

### C1

The four lens labels are `Codebase`, `Unresolved`, `History`, and `Method`; the Overview is the
entrance and not a lens.

Evidence:
- `.claude/skills/amanuensis/references/reporting-style.md:24-34` — practitioner register; established terms preferred.
- `.claude/skills/amanuensis/references/reporting-style.md:56-70` — decorative and clinical registers excluded; `Not yet surveyed` fixed.
- `design/reader-lenses/decisions.md:7-10` — label choice delegated under a least-imported-meaning constraint.
- `dev/adr/0001-living-conspectus-terms.md` § Resolved.
- Catalog GP37.

### C2

`Unresolved` and `History` partition every record carrying a resolution, an obligation, or a
terminal disposition, by ADR-0001's definition of *resolved*; `fixed-pending-verification` is
`Unresolved`.

Evidence:
- `dev/adr/0001-living-conspectus-terms.md` § Resolved — terminal state, authorized actor, resolution evidence or authorized dismissal.
- `dev/adr/0005-resolution-proof-and-projection-readback.md` § Resolution authority items 1–3.
- `mcp-server/src/schema.sql:798-815` — `finding_resolution_events.resolution_state` enum and the two CHECK constraints.
- `SELECT f.severity, COALESCE(r.resolution_state,'open'), COUNT(*) FROM findings f LEFT JOIN finding_resolution_current r ON r.finding_id=f.finding_id GROUP BY 1,2;` → `CRITICAL|verified-fixed|1`, `HIGH|verified-fixed|4`, `MEDIUM|open|8`, `MEDIUM|ruled-out|1`, `MEDIUM|verified-fixed|2`, `LOW|open|8`, `LOW|ruled-out|1`.
- `materializer/amanuensis_materializer/renderers.py:442-457` — ordering by severity, resolution rendered as a column.

### C3

Standing carries a seven-value state enum: `unledgered`, `excluded`, `scoped-unread`,
`examined`, `examined-stale`, `absent`, `mixed`.

Evidence:
- `mcp-server/src/schema.sql:158-180` — `file_ledger.classification` enum and `stale`/`stale_reason`.
- `mcp-server/src/schema.sql:186-199` — `scope_gaps.kind IN ('unledgered','absent')`.
- `SELECT classification, COUNT(*) FROM file_ledger GROUP BY 1;` → `candidate|111`, `deferred-with-reason|35`, `examined|126`, `generated-ignore|20`, `irrelevant|1`, `vendor-ignore|2`.
- `SELECT kind, COUNT(*) FROM scope_gaps GROUP BY 1;` → `unledgered|1717`.
- Catalog VP12.

### C4

A locus is a file path, a `<path>:<symbol>` pair, a subsystem id, or a vocabulary term; kind is
inferred in the order exact subsystem id, exact vocabulary term, contains `:` (split at the
first), path-table match, path-shaped, else term; the split point and the deciding step are
always echoed.

Evidence:
- `mcp-server/src/helpers.ts:75-95` — `requireWorkspaceSourcePath` normalization and reserved-state guard.
- `mcp-server/src/helpers.ts:97-127` — `requireWorkspaceCitation` `file:symbol@sha` form.
- `mcp-server/src/schema.sql:360-372` — `vocabulary.term` primary key, `first_seen`.
- `mcp-server/src/schema.sql:623-643` — `subsystems.id` primary key.

### C5

Per-owner standing is a SQL predicate in one new view, `file_standing`, over `file_ledger`
joined to `subsystems`; it adds no table.

Evidence:
- `mcp-server/src/schema.sql:158-180` — the columns the CASE reads.
- `mcp-server/src/schema.sql:179-180` — `idx_file_ledger_path`, `idx_file_ledger_stale`.
- `mcp-server/src/schema.sql:493-540` — existing views built the same way (`concern_coverage`, `subsystem_scope`, `finding_summary`).
- `mcp-server/scripts/check-sql-identifiers.mjs:1-25` — identifiers in `src/**/*.ts` resolve against `src/schema.sql`.
- Catalog GP8.

### C6

Reachability of `ref_sha` is decided in code after the view returns `examined`: an unresolvable
revision downgrades the owner row to `examined-stale` with `stale_reason = "unverifiable-ref"`,
matching `detect_changes`'s existing meaning, and a resolvable non-ancestor downgrades it with
the distinct reason `unreachable-ref`; an unavailable git reports `reachability_checked: false`
and serves the `examined-stale` authorization text.

Evidence:
- `mcp-server/src/tools/claims.ts:57-90` — `resolveCommit`, `isAncestor`, `requireStrictDescendant`.
- `.claude/skills/amanuensis/references/refresh.md:44-47` — `unverifiable_ref_rows` as a named reconciliation output.
- `dev/adr/0001-living-conspectus-terms.md` § Stale, § Current.
- Catalog GP8; GP27.

### C7

Each standing state names what it authorizes and what it cannot justify; `unledgered`,
`excluded`, and `scoped-unread` render as "not examined" and never as "no findings".

Evidence:
- `dev/adr/0001-living-conspectus-terms.md` § Fully surveyed, closing sentence.
- `.claude/skills/amanuensis/SKILL.md:119-126` — the authorized-claims ladder.
- `materializer/amanuensis_materializer/html_projection.py:56-76` — `STATUS_HINTS` already state authorization per status.
- Catalog VP12.

### C8

`owners[]` lists every `file_standing` row and is exempt from truncation; when the complete array
alone would exceed the hard ceiling the tool errors with the path and owner count rather than
returning a partial array; the headline `state` is `mixed` when owners disagree.

Evidence:
- `SELECT COUNT(*) FROM (SELECT file_path FROM file_ledger GROUP BY file_path HAVING COUNT(DISTINCT subsystem_id)>1);` → `53`.
- `SELECT subsystem_id, classification FROM file_ledger WHERE file_path LIKE '%coordinator.rs' ORDER BY subsystem_id;` → `R-05|examined`, `W-01|examined`, `W-02|candidate`, `W-03|candidate`, `W-05|candidate`, `W-06|examined`.
- `mcp-server/src/schema.sql:177` — `PRIMARY KEY (subsystem_id, file_path)`.
- Catalog VP6.

### C9

`authority_ceiling` is the weakest ranked status among non-deferred owners; deferred owners are
listed separately and given no rank, and the ceiling carries the caveat that `mapped` is a
workflow completion mark and not proof that every finding survived challenge.

Evidence:
- `mcp-server/src/schema.sql:626-630` — `subsystems.status` enum.
- `.claude/skills/amanuensis/SKILL.md:125-126` — `adversarial` and `mapped` rows of the authorized-claims table.
- `SELECT status, COUNT(*) FROM subsystems GROUP BY 1;` → `mapped|35`.
- `dev/adr/0001-living-conspectus-terms.md` § Alternatives considered, "Treat mapped as complete".

### C10

Standing reports `checked_sha`, `checked_at`, `repository_head`, `origin_head` when an upstream
is recorded, and `agrees`; a disagreement sets `unchecked_since` and marks every section
`as_of` the checked revision.

Evidence:
- `mcp-server/src/schema.sql:63-77` — `git_state` columns.
- `SELECT canonical_branch, substr(last_checked_sha,1,10), last_checked_at FROM git_state;` → `main|d395c4d534|2026-09-11 01:30:50`.
- `materializer/amanuensis_materializer/html_projection.py:2473-2490` — the snapshot strip's branch/checked/as-of items.
- `.claude/skills/amanuensis/SKILL.md:59-60` — `last_checked_sha != HEAD` folds `detect_changes` into scope.

### C11

Standing reports a `measured` block — `ledger_rows`, `ledger_reconciled`,
`reconciliation_receipt`, `staleness_measured`, `evidence_rows`, `claims_recorded` — so zero can
never read as health; `ledger_reconciled` is non-null only where the path has no owner rows.

Evidence:
- `mcp-server/src/tools/dashboard.ts:66-73` — `staleness_measured: row.scoped_files > 0`, with the finding B03-2 note.
- `mcp-server/src/helpers.ts:4-20` — `OBLIGATION_EXEMPT_CLASSIFICATIONS`, `OBLIGATION_BEARING_SQL`.
- `mcp-server/src/schema.sql:165-172` — the schema comment recording that `entries` staleness columns were never written.
- `SELECT 'claims',COUNT(*) FROM claims UNION ALL SELECT 'xrefs',COUNT(*) FROM xrefs UNION ALL SELECT 'entries',COUNT(*) FROM entries;` → `claims|0`, `xrefs|0`, `entries|0`.
- Catalog VP4.

### C12

`unknown[]` is mandatory and drawn from exactly five sources — undispositioned (owner, active
concern) pairs, candidate siblings, open questions, open leads, unassessed (seam, side) pairs;
open questions carry `scope: "subsystem"`, open leads carry `location_match`, and unassessed
seam sides carry the per-party-proxy limitation.

Evidence:
- `mcp-server/src/schema.sql:137-155` — `concerns.status IN ('active','retired','merged','candidate')`.
- `mcp-server/src/schema.sql:201-227` — `dispositions` primary key `(subsystem_id, concern_code)`.
- `mcp-server/src/schema.sql:291-305` — `field_notes.location`, `field_notes.follow_up`.
- `mcp-server/src/schema.sql:4538-4562` — `open_questions` columns; no location column.
- `mcp-server/src/schema.sql:720-733` — `seam_assessability` columns including `assessable`.
- `SELECT resolution, COUNT(*) FROM open_questions GROUP BY 1;` → `answered|5`, `open|31`.
- `SELECT follow_up='open', COUNT(*) FROM field_notes GROUP BY 1;` → `1|103`.
- `SELECT classification, COUNT(*) FROM dispositions GROUP BY 1;` → `confirmed-acceptable|86`, `confirmed-bug|25`, `out-of-scope|21`, `ruled-out|34`; `SELECT COUNT(*) FROM concerns;` → `36`.

### C13

A subsystem locus reports its own ladder status and counts; a symbol locus reports
`symbol_cited` on exact match plus separate `symbol_prefix_matches`, and never inherits the
file's state silently; a term locus returns the vocabulary row or `not-defined` with up to five
nearest terms selected by prefix then lexicographic order, with no subsystem tier.

Evidence:
- `mcp-server/src/schema.sql:751-769` — `evidence.symbol`, `idx_evidence_file`.
- `SELECT COUNT(*), COUNT(DISTINCT file_path), COUNT(DISTINCT symbol) FROM evidence;` → `209|71|197`.
- `SELECT COUNT(*) FROM vocabulary;` → `41`.
- `mcp-server/src/tools/vocabulary.ts:46-66` — `lookup_term` exact-match contract.
- Catalog GP27.

### C14

The account has eight sections in a fixed order, and `defects` is partitioned `open`,
`awaiting-verification`, `verified-fixed`, `ruled-out`, `accepted`.

Evidence:
- `materializer/amanuensis_materializer/renderers.py:282-420` — the current subsystem page order: status, scope, start here, notes, ledger, concern review, findings, related subsystems, seams, vocabulary, survey notes.
- `dev/adr/0010-derived-review-surface-and-semantic-readback.md` § Make expansion and decisions explicit.
- `mcp-server/src/schema.sql:798-806` — the five resolution states.
- Catalog GP14.

### C15

Every account item carries `ref_sha` and, where its source row has one, `evidence_kind`; an item
with no revision carries `revision_bound: false`.

Evidence:
- `mcp-server/src/schema.sql:751-766` — `evidence.ref_sha NOT NULL`, `evidence.kind` enum.
- `mcp-server/src/schema.sql:229-249` — `findings.ref_sha` nullable.
- `mcp-server/src/schema.sql:360-370` — `vocabulary.ref_sha` nullable.
- `dev/adr/0011-codebase-brief-contract.md` § Freeze source truth before projecting a mode.

### C16

The default reading is current in ADR-0001's sense; `as_of_sha` returns a historical reading only
for the sections whose sources carry validity intervals or event tables, marks every other
section `as_of_supported: false` and serves it at current, and decides interval membership by
commit ancestry in code over every stored row with no SQL pre-filter.

Evidence:
- `dev/adr/0001-living-conspectus-terms.md` § Current, § Stale, § Invalid.
- `mcp-server/src/schema.sql:930-965` — `valid_until_sha` as an exclusive Git boundary; `idx_claims_current_key` unique where `valid_until_sha IS NULL`.
- `mcp-server/src/tools/claims.ts:73-90` — ancestry evaluated with `git merge-base --is-ancestor`.

### C17

No response field contains text generated during the tool call; the tools report
`model_calls: 0`, every item carries `authored: "model" | "code"` identifying durable
model-authored source fields, and survey narrative is attached only under an explicit
`narrative` label with `revision_bound: false`.

Evidence:
- `dev/adr/0011-codebase-brief-contract.md` § Select deterministically and account for loss — `model_calls: 0`.
- `dev/adr/0010-derived-review-surface-and-semantic-readback.md` § Alternatives rejected, "Let a model summarize database rows".
- `mcp-server/src/schema.sql:662-678` — `artifacts.content_hash`, `artifacts.ref_sha`.
- Catalog GP8 v2 scope note; BP4.

### C18

Response budgets are 8192 bytes for the `describe_locus` default, 3072 for standing, 4096 per
optional section, 32768 as a hard ceiling, 12288 for `get_attention`, 8192 for `get_history`,
enforced on the emitted wire response — compact text block plus `structuredContent` — and not on
an internal payload.

Evidence:
- `design/reader-lenses/decisions.md:24-27` — compactness is a design constraint with a mechanical gate.
- `mcp-server/src/helpers.ts:41-56` — every tool serializes its payload twice, as text and as `structuredContent`.
- `dev/adr/0011-codebase-brief-contract.md` § Consequences and limits — item-count budget, exact omissions.

### C19

`purpose`, `structure`, `defects`, `boundaries`, `terms`, standing, and `unknown` are on by
default; `reviews`, `leads`, `history_pointer` detail, and `narrative` are opt-in.

Evidence:
- `design/reader-lenses/decisions.md:24-27`.
- `dev/adr/0010-derived-review-surface-and-semantic-readback.md` § Make expansion and decisions explicit — compact by default, one expansion.
- Catalog GP14.

### C20

Truncation is declared through an omission ledger with exactly two reasons — `policy` and
`budget` — aggregated per `(section, reason)` with an exact `count`, with
`selected + omitted == census` per section, an unrecorded source declared as
`census: 0, recorded: false` rather than as an omission, and a fixed, code-constant truncation
order.

Evidence:
- `dev/adr/0011-codebase-brief-contract.md` § Select deterministically and account for loss — the three operational reasons and the exact census reconciliation.
- `dev/adr/0011-codebase-brief-contract.md` § Verification obligations, items 3 and 6.
- Catalog GP24; GP25.

### C21

`describe_locus(locus, kind?, sections?, as_of_sha?)` ships an output contract at
`mcp-server/contracts/locus-account.schema.json` version `1.0.0`, and an unknown locus returns a
standing state rather than an error.

Evidence:
- `mcp-server/contracts/codebase-brief.schema.json` — the existing contract-file precedent.
- `dev/adr/0011-codebase-brief-contract.md` § Freeze source truth before projecting a mode — external contract version `1.0.0` shipped under `mcp-server/contracts/`.
- `mcp-server/src/index.ts:236-249` — Ajv validation of every tool's `inputSchema` at call time.
- `mcp-server/scripts/check-tool-schemas.mjs:1-30` — every `inputSchema` compiles as draft-07 and carries only recognized keywords.

### C22

`index.ts` gains an explicit `READ_ONLY_TOOLS` set so `describe_locus`, `get_attention`, and
`get_history` advertise `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`,
`openWorldHint: false`.

Evidence:
- `mcp-server/src/index.ts:33-44` — `toolAnnotations` derives `readOnlyHint` from the `get_`/`list_`/`lookup_` prefixes only.
- `mcp-server/src/index.ts:24-31` — `ADDITIVE_TOOLS` is the existing explicit carve-out pattern.
- `.github/workflows/test.yml` — "MCP initialization, annotations, structured results, and error semantics" runs `test-mcp-compatibility.mjs`.

### C23

`get_attention` reuses ADR-0010's `regression`, `unverified-suspicion`, `unknown`, and
`stale-knowledge` verbatim, does not reuse `latent-defect` or `contested`, extends
`stale-knowledge` to obligation-bearing stale ledger rows with a `source` discriminator, and adds
exactly two labels of its own, `awaiting-verification` and `undiscriminated`.

Evidence:
- `design/reader-lenses/decisions.md:29-31` — reuse ADR-0010's operational labels.
- `dev/adr/0010-derived-review-surface-and-semantic-readback.md` § Derive an immutable session from terminal composition state — the seven definitions.
- `dev/adr/0010-derived-review-surface-and-semantic-readback.md` § Decision, opening paragraph — compilation requires a reconciled `complete` or `blocked` A8 composition at the assembled HEAD.
- `SELECT COUNT(*) FROM refresh_runs;` → `0`; `SELECT COUNT(*) FROM file_ledger WHERE stale=1;` → `0` of `295`.
- Catalog VP6.

### C24

`get_history(locus? | finding_id?, limit?)` returns resolution events, claim supersessions and
validity events, contradiction resolution events, closed questions ordered by `resolved_at`,
resolved leads ordered by `id`, and the sessions attributed to the locus through citing rows,
declared as `session_attribution: by-citation`.

Evidence:
- `mcp-server/src/schema.sql:798-861` — `finding_resolution_events`, `finding_resolution_current`.
- `mcp-server/src/schema.sql:863-880` — `contradiction_resolution_events`.
- `mcp-server/src/schema.sql:978-1000` — `claim_validity_events`, `claim_supersessions`.
- `mcp-server/src/schema.sql:598-607` — `sessions` columns and `idx_sessions_started`.
- `SELECT COUNT(*) FROM sessions;` → `24`.

### C25

`SERVER_INSTRUCTIONS` opens with the consumer route naming `describe_locus`, then
`get_attention` and `get_history`, and keeps the producer route after it.

Evidence:
- `mcp-server/src/index.ts:18-19` — the current instructions open with "Build and maintain an evidence-backed codebase conspectus. Start with get_project_info…".
- `mcp-server/src/index.ts:253-259` — `instructions` passed to the MCP `Server` constructor.
- `.claude/skills/amanuensis/SKILL.md:1-16` — every trigger phrase is an operator verb.
- `design/reader-lenses/README.md:305-312`.

### C26

The three tools live in `mcp-server/src/tools/locus.ts`, are registered first in `allTools`, and
round-trip through the generated tool inventory.

Evidence:
- `mcp-server/src/index.ts:186-228` — `allTools` composition order.
- `mcp-server/src/index.ts:230-240` — `ListToolsRequestSchema` returns `allTools` in array order.
- `mcp-server/scripts/gen-tool-inventory.mjs:35-50` — grouping inferred from the source file each tool is exported from.
- `mcp-server/DEVELOPMENT.md:200-202` — the generated block, "196 tools across 41 groups".

### C27

One new view, `finding_state_current`, carries the legacy-status fallback once, and all five
existing readers of finding resolution — `renderers.py`, `list_findings`, `get_finding_summary`,
`compile_review_session`, and the review historical-findings reader — select from it.

Evidence:
- `materializer/amanuensis_materializer/renderers.py:443-455` — the fallback CASE expression written inline in the renderer.
- `mcp-server/src/schema.sql:852-861` — `finding_resolution_current` with no legacy fallback.
- `mcp-server/src/schema.sql:836-851` — the one-time legacy sweep to `fixed-pending-verification`.
- `mcp-server/src/schema.sql:229-249` — `findings.status` enum retained as a coarse mutable projection.
- `dev/adr/0005-resolution-proof-and-projection-readback.md` § Resolution authority, item 4.

### C28

Each lens has a membership predicate in SQL, a stated ordering, and an honest empty state
carrying scope, basis, and checked revision; stale knowledge is `classification='examined'` with
drifted candidates reported separately, `unresolved-competition` matrices are Unresolved, and
closed questions and resolved leads have a History page.

Evidence:
- `mcp-server/src/schema.sql:264-282` — `contradictions.resolution` enum including `unresolved`.
- `mcp-server/src/schema.sql:201-219` — `dispositions.classification` including `unresolved-competition`.
- `mcp-server/src/schema.sql:291-305` — `field_notes.category` including `candidate-concern`.
- `materializer/amanuensis_materializer/renderers.py:451-454` — the current `ORDER BY` is severity, subsystem, id, with no resolution partition.
- `dev/adr/0001-living-conspectus-terms.md` § Fully surveyed, item 3 — `unresolved-competition` is visible debt.
- Catalog VP4.

### C29

A finding renders as a full record with its opaque marker on exactly one page, selected by its
current resolution state; every other surface links, and `_build_xref_index` routes finding ids
to the same page so no cross-link anchor breaks.

Evidence:
- `materializer/amanuensis_materializer/readback.py:32-40` — `finding_marker`, `stale_marker`.
- `materializer/amanuensis_materializer/readback.py:148-176` — exactly-one-marker checks per format.
- `dev/adr/0005-resolution-proof-and-projection-readback.md` § Projection proof, state axis.

### C30

`PagePlan` and `SitePage` gain a `subgroup` field, navigation group order becomes the explicit
constant `NAV_GROUPS`, and no existing page path is retired.

Evidence:
- `materializer/amanuensis_materializer/core.py:104-118` — `PagePlan` fields.
- `materializer/amanuensis_materializer/html_projection.py:29-45` — `SitePage` fields.
- `materializer/amanuensis_materializer/html_projection.py:2442-2471` — `_nav` groups by dict insertion order.
- `materializer/amanuensis_materializer/core.py:205-212` — `prune_retired` deletes files for pages with no generator.
- `materializer/amanuensis_materializer/readback.py:190-243` — coverage axis rejects a missing planned page and an unresolved local link.

### C31

The page plan is the table in `spec.md` §7.1: `files.md`, `not-yet-surveyed.md`,
`disagreements.md`, `stale.md`, `hot-spots.md`, `resolved-findings.md`, `resolution-history.md`,
`resolved-leads.md`, and `sessions.md` are added; `findings.md`, `contradictions.md`,
`field-notes.md`, `seams.md`, `vocabulary.md`, `concerns.md`, `diagnosticity.md`, and the prose
passthroughs change group or membership only.

Evidence:
- `materializer/amanuensis_materializer/core.py:323-379` — the current static page plan and its four groups.
- `materializer/amanuensis_materializer/core.py:380-420` — per-subsystem and per-matrix plans.
- `design/reader-lenses/decisions.md:12-17` — one files index with anchors, no per-file pages.
- `SELECT COUNT(*) FROM file_ledger;` → `295`.

### C32

The overview carries, first in source order and with nothing between them, identity, a thesis
taken by heading, four separate status dimensions from durable records, one linked count per
`finding_resolution_state` value, and one route into each lens, with no composite score; the
contract is over source order, not over a literal viewport.

Evidence:
- `materializer/amanuensis_materializer/renderers.py:103-124` — the thesis is currently the first non-header paragraph of `entry-point.md`.
- `materializer/amanuensis_materializer/renderers.py:142-151` — "Confirmed findings … (n critical, n high)" counts all findings regardless of resolution, beside "Open bugs".
- `mcp-server/src/schema.sql:902-925` — `projection_verification_runs`, `projection_mismatches`.
- `mcp-server/src/schema.sql:798-806` — the five `finding_resolution_state` values.
- `design/delightful-output-panel/revision-2026-08-23.md` — four separate status dimensions; project-first identity; consequential findings before inventory.
- Catalog BP26.

### C33

The subsystem page order is identity and Scope — `subsystems.scope` rendered under that heading
and never as a purpose sentence — then start here, structure, boundaries, vocabulary, known
defects here, standing, then the survey record as secondary apparatus.

Evidence:
- `materializer/amanuensis_materializer/renderers.py:334-420` — the current order places the file ledger and concern review before findings and the structural narrative last.
- `.claude/skills/amanuensis/references/phase-2-structural.md:84-97` — the structural summary's sections.
- `.claude/skills/amanuensis/references/reporting-style.md:72-90` — subordinate facts stay subordinate to the language that explains consequence.

### C34

One Files index carries every distinct ledger path with its owners, standing, a per-owner
examined revision, open-defect count, and a collision-resistant path-hash anchor rather than a
slug; no per-file page is generated.

Evidence:
- `design/reader-lenses/decisions.md:12-17`.
- `SELECT COUNT(*) FROM file_ledger;` → `295`; `SELECT COUNT(*) FROM (SELECT file_path FROM file_ledger GROUP BY file_path HAVING COUNT(DISTINCT subsystem_id)>1);` → `53`.
- `materializer/amanuensis_materializer/html_projection.py:2442-2462` — nav search indexes label, record id, hint, and status only.

### C35

The Not-yet-surveyed page carries unledgered paths, candidate rows by subsystem, deferred
subsystems, unassessed (seam, side) pairs, and undispositioned (subsystem, active concern)
pairs, each counted over the unit its gap occupies and each with its denominator.

Evidence:
- `SELECT kind, COUNT(*) FROM scope_gaps GROUP BY 1;` → `unledgered|1717`.
- `SELECT classification, COUNT(*) FROM file_ledger GROUP BY 1;` → `candidate|111` of `295`.
- `mcp-server/src/schema.sql:720-733` — `seam_assessability.assessable`.
- `SELECT COUNT(*) FROM seams;` → `20`; `SELECT COUNT(*) FROM concerns;` → `36`; `SELECT COUNT(*) FROM dispositions;` → `166`.
- `dev/adr/0001-living-conspectus-terms.md` § Fully surveyed, items 1, 3, 4.

### C36

The hot-spot table carries ten separate columns, sorts by open critical+high then open
medium+low then unread fraction then subsystem id, has no composite column, and omits the access
heat column entirely when no subsystem has an access row.

Evidence:
- `mcp-server/src/schema.sql:96-109` — `access_log` and `idx_access_hot`.
- `mcp-server/src/schema.sql:420-433` — `hot_subsystems` view.
- `SELECT COUNT(*) FROM access_log;` → `1`.
- `mcp-server/src/schema.sql:201-219` — `dispositions.evidence_quality`, `linchpin_dependent`.
- Catalog VP4; BP26.

### C37

`resolved-findings.md` renders each resolved finding as a full marked record with its basis
labelled by kind — verification evidence, authorized dismissal, or `none-recorded`;
`resolution-history.md` is a newest-first
event timeline; `resolved-leads.md` carries closed questions and resolved leads; `sessions.md`
carries sessions, refresh runs, and projection verification runs.

Evidence:
- `mcp-server/src/schema.sql:798-816` — `fix_location`, `fix_sha`, `evidence_id`, `rationale` on every event.
- `mcp-server/src/schema.sql:820-834` — the `finding_verification_evidence_integrity` trigger requiring `fix-verification` attachment.
- `mcp-server/src/schema.sql:902-925` — `projection_verification_runs`.
- `mcp-server/src/schema.sql:1413-1468` — `refresh_runs`.
- `dev/adr/0005-resolution-proof-and-projection-readback.md` § Resolution authority, item 3.

### C38

`how-to-read.md` is generated from the enum source, one table per enum, each row carrying value,
label, operational meaning, and what it cannot justify.

Evidence:
- `materializer/amanuensis_materializer/renderers.py:792-812` — the reader's guide is a static string constant.
- `materializer/amanuensis_materializer/renderers.py:858-870` — its evidence-quality table lists five kinds.
- `mcp-server/src/schema.sql:757-762` — `evidence.kind` accepts nine.
- `materializer/amanuensis_materializer/renderers.py:890-899` — its finding-status table lists `confirmed-bug`, `confirmed-acceptable`, `ruled-out`, `fixed`, and carries neither `fixed-pending-verification` nor `verified-fixed`.
- Catalog VP12.

### C39

New JavaScript may extend ⌘K over a generated locus index, filter the open-findings and hot-spot
tables in place, and manage anchored navigation, and may add nothing else; the existing shell's
theme and mobile-navigation behaviour is preserved unchanged and is outside the restriction.

Evidence:
- `materializer/amanuensis_materializer/html_projection.py:932-955` — the existing `⌘K` handler filters nav items only.
- `materializer/amanuensis_materializer/html_projection.py:2442-2462` — `data-search` carries label, record id, hint, status.
- `design/reader-lenses/decisions.md:12-17` — simple JavaScript enhancement, tasteful, accessibility required.
- `.claude/skills/amanuensis/references/reporting-style.md:151-153` — ruled registers, not dashboard tiles.

### C40

The enhancement satisfies progressive enhancement with a complete no-JavaScript reading path,
keyboard operability, accessible names and states, deterministic focus management, and no
external resources.

Evidence:
- `materializer/amanuensis_materializer/html_projection.py:911-932` — existing `inert`, `aria-expanded`, and focus-restoration handling in `setMenuOpen`.
- `materializer/amanuensis_materializer/html_projection.py:2505-2520` — the shell's skip link and `aria-label`ed navigation.
- `materializer/amanuensis_materializer/html_projection.py:2510` — all CSS is inline; no external stylesheet or font is referenced.
- `design/reader-lenses/decisions.md:16-17`.

### C41

`search-index.js` is a projection artifact covered by the content axis through the publication
receipt; the projection inventory is widened to `*.js` and `verify_projection` derives expected
paths from `manifest.projection_files` so the coverage axis does not report it missing; and the
state axis requires every obligation-bearing ledger path exactly once and every cited symbol at
least once.

Evidence:
- `materializer/amanuensis_materializer/readback.py:86-107` — `write_contract` hashes every listed page into `.projection-contract.json`.
- `materializer/amanuensis_materializer/readback.py:245-262` — the content axis compares finished bytes to the receipt.
- `materializer/amanuensis_materializer/core.py:263-268` — `manifest.projection_files` records the HTML result's files.
- `dev/adr/0005-resolution-proof-and-projection-readback.md` § Projection proof.

### C42

Phase 2 records key types, state containers, flow steps, concurrency invariants, and seam
contracts as `add_claim` calls with stable `claim_key`s; `add_claim` validates `subject_type`
against an enum and refuses a key-type, state-container, or flow claim whose evidence is all
outside `{code-verified, contract-stated}` or cites a different file than `subject_id`.

Evidence:
- `mcp-server/src/tools/claims.ts:225-252` — `add_claim` input schema; `evidence_ids` `minItems: 1`.
- `mcp-server/src/tools/claims.ts:96-112` — evidence must be reachable at the authority commit.
- `mcp-server/src/schema.sql:940-967` — `claims` columns; `idx_claims_current_key` unique per `claim_key` where open-ended.
- `.claude/skills/amanuensis/references/phase-2-structural.md:20-70` — the five structural categories Phase 2 already produces.
- `SELECT COUNT(*) FROM claims;` → `0`.

### C43

Advancing a subsystem to `structural` requires at least one current claim whose `claim_key`
begins `<sid>/`; no larger count is required, and claim truth remains the adversarial pass's
obligation, which requires Phase 4 to pull current `<sid>/` claims as targets and record each
challenge outcome before `mapped`.

Evidence:
- `.claude/skills/amanuensis/SKILL.md:123` — `structural` authorizes types, state containers, flows, and the concurrency model.
- `mcp-server/src/schema.sql:165-172` — `enforcePhasePrerequisites` named as the reason the ledger denominator is non-empty by construction.
- `dev/adr/0001-living-conspectus-terms.md` § Executable obligations, closing paragraph — the checker enforces existence, terminality, grounding, and reconciliation, not truth.
- Catalog BP4; GP8 v2 scope note.

### C44

The subsystem page and the `structure` section read claims and, with zero claims, render the
literal "Structural inventory not recorded as claims" with the narrative labelled as not
individually revision-bound.

Evidence:
- `materializer/amanuensis_materializer/renderers.py:320-332` — the survey artifact is read and concatenated into `survey_prose`.
- `materializer/amanuensis_materializer/renderers.py:420-421` — it is appended last, under "Survey notes".
- `mcp-server/src/schema.sql:662-678` — `artifacts.content_hash`, `artifacts.ref_sha`.
- `dev/adr/0011-codebase-brief-contract.md` § Alternatives rejected, "Token truncation without an omission ledger".

### C45

`add_xref` requires a `context` containing at least one whitespace-delimited token matching the
`file:symbol@sha` grammar, validates that token's path and resolves its revision while keeping
the surrounding prose and not checking symbol reachability, and `architecture.md` renders
topology from recorded edges only.

Evidence:
- `mcp-server/src/tools/xrefs.ts:5-38` — `add_xref` input schema with `context` optional.
- `mcp-server/src/schema.sql:78-90` — `xrefs.relationship` values including `data-flow` and `dependency`.
- `materializer/amanuensis_materializer/renderers.py:196-204` — the heading switches between "Subsystem dependency graph" and "Subsystem atlas" on `xrefs`.
- `.claude/skills/amanuensis/references/reporting-style.md:182-184` — never infer edges from names, prefixes, or nearby seams.
- `SELECT COUNT(*) FROM xrefs;` → `0`.

### C46

`SKILL.md`'s routing table gains a consumer row routing "what do we know about X" / "before I
change X" / "is there a finding on this file" to `describe_locus` first.

Evidence:
- `.claude/skills/amanuensis/SKILL.md:90-101` — the routing table; every row is an operator verb.
- `.claude/skills/amanuensis/SKILL.md:12-16` — the description already names those adjacent asks as triggers.
- `mcp-server/scripts/check-evidence-vocabulary.mjs:44-50` — `SKILL.md` is already parsed by a mechanical check.

### C47

`references/notes.md` fixes its answer shape: standing in one line, then the account led by the
most consequential open item, then what is not known; it never runs a survey.

Evidence:
- `.claude/skills/amanuensis/references/notes.md:44-70` — the current typical tool sequences start from a subsystem id.
- `.claude/skills/amanuensis/references/notes.md:30-34` — every claim cites evidence or is not made.
- `.claude/skills/amanuensis/references/notes.md:88-100` — the existing limits section.

### C48

`mcp-server/contracts/conspectus-vocabulary.json` is the single enum source carrying every
CHECK-constrained vocabulary and the obligation-bearing flag; `vocabulary.ts` and `vocabulary.py`
are generated from it with `--check` and `--check-sql` modes in CI, and
`check-evidence-vocabulary.mjs` is replaced by a four-way comparison over the JSON source, both
generated files, and `SKILL.md`.

Evidence:
- `mcp-server/scripts/check-evidence-vocabulary.mjs:1-42` — the existing three-copy comparison and the B03-3 rationale.
- `mcp-server/scripts/gen-tool-inventory.mjs:17-19` — the `--check` precedent.
- `materializer/amanuensis_materializer/html_projection.py:56-133` — four hint dictionaries and one axis map, all literals.
- `materializer/amanuensis_materializer/renderers.py:816-900` — the reader's guide's literal tables.
- `.github/workflows/test.yml` — "Evidence vocabulary — add_evidence, set_disposition, and SKILL.md agree".

### C49

An orientation lint rejects survey-status assertions and count fractions in the published thesis,
turns the publish red, and names the file to correct; its gate carries a negative corpus as well
as a positive one.

Evidence:
- `materializer/amanuensis_materializer/renderers.py:103-124` — the thesis is the first non-header paragraph of `entry-point.md`.
- `materializer/amanuensis_materializer/core.py:270-276` — `summary.warnings` and `summary.ok = False` already gate a publish.
- `materializer/amanuensis_materializer/html_projection.py:2487-2492` — the freshness label rendered beside it.
- Catalog GP25.

### C50

The freshness strip, the overview count, and the read-back denominator read `file_ledger`, and a
parity gate asserts they equal `get_dashboard` on the same store.

Evidence:
- `materializer/amanuensis_materializer/core.py:220` — `SELECT COUNT(*) AS n FROM entries WHERE stale=1`.
- `materializer/amanuensis_materializer/renderers.py:89-90` — the same query behind "Stale entries".
- `mcp-server/src/tools/dashboard.ts:37-39` — `get_dashboard` counts `file_ledger` with `OBLIGATION_BEARING_SQL`.
- `SELECT COUNT(*) FROM entries;` → `0`; `SELECT COUNT(*) FROM file_ledger;` → `295`.
- `materializer/amanuensis_materializer/html_projection.py:2484-2490` — `stale_entry_count` drives the strip's label and class.

### C51

`readback.py` keeps the `entries`-derived stale check and adds `ledger_stale_marker`, requiring
exactly one marker per obligation-bearing stale ledger row in each format.

Evidence:
- `materializer/amanuensis_materializer/readback.py:36-40` — `stale_marker(entry_id, tier)`.
- `materializer/amanuensis_materializer/readback.py:158-176` — the per-format exactly-one check.
- `materializer/amanuensis_materializer/readback.py:150-154` — the stale set is read from `entries`.
- `mcp-server/src/schema.sql:165-172` — the recorded reason `entries` staleness was a zero-denominator green (B03-2).
- Catalog VP4.

### C52

The self-conspectus store is snapshotted, the server stopped, the store deleted, a new server
started and read back against an empty store, and only then rebuilt through the skill with
claims-backed Phase 2 and recorded edges, in checkpointed packets.

Evidence:
- `design/reader-lenses/decisions.md:18-23`.
- `.claude/skills/amanuensis/SKILL.md:65-70` — snapshot with `commit_phase_gate` before a destructive operation.
- `.claude/skills/amanuensis/SKILL.md:99` — "reinit survey" authorizes the destructive operation.
- `git check-ignore -v .amanuensis` → `.git/info/exclude:8:/.amanuensis`; `git ls-files .amanuensis | wc -l` → `0`.

### C53

`materialize_docs` writes `.amanuensis/docs`, its output path being confined to project storage;
`dev/promote-docs.mjs` promotes the green publish to the tracked `docs/` and re-reads it at that
path before it is committed; the A0 historical fixture under
`dev/conspectus/` is never rewritten and `dev/check-living-conspectus.mjs` stays green.

Evidence:
- `git ls-files docs | wc -l` → `48`, including `docs/.manifest.json` and `docs/.projection-contract.json`.
- `dev/conspectus/README.md:1-19` — the fixture is an immutable historical artifact at `b8b566f`; rebaselining requires a new report identity.
- `dev/adr/0005-resolution-proof-and-projection-readback.md` § Projection proof — a red staging run leaves the prior projection untouched.
- `.github/workflows/test.yml` — "Verify versioned historical A0 conspectus baseline".

### C54

The dogfood gate runs against a committed receipt rather than the untracked store, and asserts
`examined` standing with at least one structural claim on three named files, exact set equality
between `finding_state_current` and `get_attention`'s selected ids unioned with its
budget-omitted ids, and a green clean publish byte-matching the promoted `docs/`.

Evidence:
- `design/reader-lenses/decisions.md:18-23`.
- `mcp-server/src/schema.sql:852-861` — `finding_resolution_current`.
- `dev/adr/0001-living-conspectus-terms.md` § Fully surveyed, item 5 — equality, not non-emptiness.
- `dev/adr/0005-resolution-proof-and-projection-readback.md` § Decision, `--clean-publish`.
- Catalog GP24.

### C55

Every gate in the plan names the condition that turns it red and the false green it cannot
exclude; the `red(<id>)` commit contains the gate file, and each packet carries a
`gate.red_expect` assertion pattern the red output must match, so a module-not-found exit is not
accepted as red.

Evidence:
- `dev/adr/0001-living-conspectus-terms.md` § Complete — every required control has a recorded red proof.
- `.github/workflows/test.yml` — the `pecia-defects` job comment records three zero-denominator greens already found in this repository (B03-2, B04-1, B04-3).
- `mcp-server/src/schema.sql:165-172` — finding B03-2 recorded in the schema itself.
- Catalog VP4; VP25.

### C56

The materializer probes for `file_standing` and `finding_state_current` at the start of every
render and turns the publish red with a named cause when either is absent; it never falls back to
an inline copy of the predicate.

Evidence:
- `materializer/amanuensis_materializer/db.py:15-23` — `open_ro` opens `mode=ro` and applies no schema.
- `mcp-server/src/db.ts:48-53` — `initializeSchema` runs `schema.sql`; only `openDatabase` calls it.
- `mcp-server/src/schema.sql` — the views are `CREATE VIEW IF NOT EXISTS`, created on server open.
- Catalog VP4; GP25.

### C57

`unreachable-ref` is a new `file_ledger.stale_reason` value for a resolvable revision that is not
an ancestor of HEAD; `unverifiable-ref` keeps the meaning `detect_changes` already writes.

Evidence:
- `mcp-server/src/tools/git.ts:246-262` — a ref is `unverifiable` only when `git diff --name-only <ref> <head>` fails.
- `mcp-server/src/tools/git.ts:274-275` — `markStale.run("unverifiable-ref", …)`.
- `mcp-server/src/schema.sql:175` — `stale_reason` carries no CHECK constraint.
- `SELECT COUNT(DISTINCT ref_sha) FROM file_ledger WHERE classification='examined' AND ref_sha IS NOT NULL;` → `4`; all four resolve and are ancestors in `~/repos/axiomdb`, so the store cannot exercise the branch.

### C58

History carries no account of how `open_questions` and `field_notes` reached their terminal
state; each page states that limit in one line.

Evidence:
- `mcp-server/src/schema.sql:4538-4560` — `open_questions.resolution` and `resolved_at` are mutable columns.
- `mcp-server/src/schema.sql:291-302` — `field_notes.follow_up` is free text with no resolution time.
- `mcp-server/src/schema.sql:798-814`, `863-866` — the two event tables that do exist.
- No `UPDATE` or `DELETE` on `finding_resolution_events` exists in `mcp-server/src/` or `materializer/`.
- Catalog GP12; BP7.

### C59

Every account item carries `authored: "model" | "code"`, naming the durable fields an earlier
survey session's model wrote.

Evidence:
- `mcp-server/src/schema.sql:630-632` — `subsystems.scope`, `jump_in_reading`, `notes` are free text.
- `mcp-server/src/schema.sql:945` — `claims.statement`.
- `mcp-server/src/schema.sql:296` — `field_notes.observation`.
- `dev/adr/0011-codebase-brief-contract.md` § trace contract.
- Catalog GP12.

### C60

Ledger rows classified `candidate` with `stale=1` are reported under their own heading with their
own denominator, never as stale knowledge.

Evidence:
- `mcp-server/src/tools/git.ts:236-242`, `246-262` — `detect_changes` marks drift on every row carrying a `ref_sha`, regardless of classification.
- `SELECT COUNT(*) FROM file_ledger WHERE classification='candidate';` → `111`; `SELECT COUNT(*) FROM file_ledger WHERE classification='candidate' AND length(ref_sha)=40;` → `111`.
- Catalog VP6.

### C61

`resolved-leads.md` is a History page carrying answered, dismissed, and superseded questions and
closed field notes.

Evidence:
- `SELECT resolution, COUNT(*) FROM open_questions GROUP BY 1;` → `answered|5`, `open|31`.
- `SELECT follow_up, COUNT(*) FROM field_notes GROUP BY 1;` → `open|103`.
- `mcp-server/src/schema.sql:4555-4559` — `resolution` enum and `resolved_at`.
- ADR-0005 § projection read-back — every rendered record is reachable from a planned page.

### C62

`dev/promote-docs.mjs` promotes a green `.amanuensis/docs` publish to the tracked `docs/` and
re-reads the promoted tree before it is committed.

Evidence:
- `mcp-server/src/tools/materialize.ts:241-245` — `output_dir` defaults to `docs` and is resolved by `resolveStorageOutputPath`.
- `mcp-server/src/project.ts:1003-1012` — relative output resolves under `project.storagePath` and is containment-asserted.
- `git ls-files docs | wc -l` → `48`.
- Catalog GP21.

### C63

The `red(<id>)` commit contains the gate file, and each packet carries a `gate.red_expect` pattern
the launcher requires the red output to match and rejects module-not-found on.

Evidence:
- `run.sh:326` — `[ "$red_status" -ne 0 ]` accepts any non-zero exit.
- `run.sh:324` — `( cd … && npm run build … ) || true` swallows a failed build at the red commit.
- `cd mcp-server && node test-locus-compactness.mjs` on the baseline exits with `MODULE_NOT_FOUND`.
- Catalog VP4; VP15.

### C64

The one-call routing property is a measurement with two arms and at least two runs per condition,
recorded separately; it is not a gate and blocks no packet.

Evidence:
- Catalog VP5 — repeatability before effect, ≥2 runs per condition.
- Catalog VP10 — verify the baseline arm, not only the treatment.
- Catalog BP26 — visible rigor with no decision leverage.
