# Survey depth: claims packet

Reviewers see this file, `spec.md`, `plan.md`, a history-free snapshot of the repository, and
both stores read-only. Each claim is one normative decision. Evidence is a file with a line
number, a query with its result, an ADR section, or a practice-catalog id.

Stores, as opened by this session:

- **Baseline** `sqlite3 "file:/Users/nfeldman/.claude/automations/amanuensis-clean-slate/archive/store-7c1c1a9/memory.db?immutable=1"`
- **Candidate** `sqlite3 "file:/Users/nfeldman/repos/amanuensis/.amanuensis/memory.db?mode=ro"`

Revisions are resolved in this worktree with `git ls-tree -r --name-only <rev> | wc -l`.

---

### C1

The depth measures are the twelve statements D1–D12 in `spec.md` §1.2, frozen with the baseline.
`dev/test-survey-depth.mjs` executes those twelve as its reported and comparison layer, and
separately evaluates the six acceptance predicates B1–B6 of §7.3, which are per-record obligations
rather than measures and are listed under their own key in the fixture and the receipt.

Evidence:
- `spec.md:§1.2` — D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12; the SQL is carried verbatim
  into `dev/survey-depth-baseline.json` (`spec.md:§7.2`).
- `spec.md` §7.3: B3 joins `dispositions` to `subsystems` and resolves each attachment's `ref_sha`;
  B4 reads `vocabulary_declinations`; B5 and B6 read `carried_findings`. No D-measure expresses any
  of them.
- `spec.md` §1.6 lists "the finding accounting of §5" as blocking beside the D-measures.
- `SELECT COALESCE(last_checked_sha,'(null)')||' / '||COALESCE(onboarding_sha,'(null)') FROM git_state;`
  → baseline `61bc6b5c89f7c6b5091f9cb5df5e68cd969a3f27 / b8b566f`; candidate
  `7c1c1a9f5689d396487072d012abe6fafd5f348c / 7c1c1a9f5689d396487072d012abe6fafd5f348c`.

### C2

Every **tracked-file coverage fraction** takes its denominator from the repository's tracked paths
at the store's reconciled revision, never from `file_ledger`'s own row count. D6 and D7% are
per-disposition ratios and are not tracked-file coverage fractions. The obligation-bearing
predicate that D2 subtracts is generated from `conspectus-vocabulary.json`'s `obligation_bearing`
field, not transcribed.

Evidence:
- `mcp-server/contracts/conspectus-vocabulary.json` `file_classification`: `obligation_bearing` is
  false for `generated-ignore`, `vendor-ignore` and `irrelevant`, and **true** for `candidate`,
  `examined` and `deferred-with-reason`.
- AxiomDB `SELECT COUNT(*) FROM file_ledger WHERE classification='deferred-with-reason';` → 35.
- Neither store's classification histogram (`spec.md` §1.3) contains a `deferred-with-reason` row,
  so the derivation changes no value in §1.3.
- `spec.md` §1.2 D6 is `D4 / D5` and D7% is `D7 / D5`, both over `dispositions`.
- Over ledger rows:
  `SELECT printf('%.2f',100.0*SUM(classification='examined')/SUM(classification IS NULL OR classification IN ('candidate','examined'))) FROM file_ledger;`
  → baseline `59.57`, candidate `80.77`.
- Over tracked paths at each store's own checked revision (`git ls-tree -r --name-only R`, minus
  ledger paths classified `generated-ignore|vendor-ignore|irrelevant|deferred-with-reason`):
  baseline 221 / 371 = `59.57%` at `61bc6b5`; candidate 84 / 605 = `13.88%` at `7c1c1a9`.
- `README.md` §1 table row "Ledger rows (599 tracked files at `d2b1630`) | 503 | 106".
- GP24 — fan-in asserts completeness, not non-emptiness; a numerator and denominator that shrink
  together prove nothing.

### C3

Each store is measured at the revision its own `git_state.last_checked_sha` names, not at a
common revision.

Evidence:
- `git ls-tree -r --name-only 61bc6b5 | wc -l` → 503; `… 7c1c1a9 | wc -l` → 607;
  `… d2b1630 | wc -l` → 599.
- Baseline ledger distinct paths = 503, unledgered at `61bc6b5` = 0; at `d2b1630` = 108 with 12
  ledger paths no longer tracked.
- Candidate unledgered at `7c1c1a9` = 501; at `d2b1630` = 493 (the proposal's figure).

### C4

The baseline's frozen values are: 503 ledger rows; 503 tracked paths; 0 unledgered; 371
obligation-bearing; 221 examined (59.57 %); 133 evidence; 128 dispositions; 1.04 evidence per
disposition; 112 dispositions with an attached row (87.50 %); 181 `disposition_evidence` rows;
36 field notes; 16 open questions (12 open); 4 vocabulary terms with a non-empty anchor, 0 in
`file:symbol@sha` form; 13 open findings of 22; 8 subsystems; 10 seams; 0 claims; 1 xref; 35
sessions; classifications candidate 150 / examined 221 / generated-ignore 124 / irrelevant 2 /
vendor-ignore 6.

Evidence:
- Queries as in `spec.md` §1.2, run against the baseline URI above; values reproduced in
  `spec.md` §1.3.
- `SELECT GROUP_CONCAT(status||'='||n,' ') FROM (SELECT status,COUNT(*) n FROM findings GROUP BY status ORDER BY status);`
  → `confirmed-bug=13 fixed=9`.
- `SELECT finding_id FROM findings WHERE status='confirmed-bug' ORDER BY finding_id;` → `B01-1,
  B02-3, B02-4, B03-5, B03-6, B03-7, B03-8, B04-2, B04-3, B04-4, B04-5, B05-2, B07-1`.
- `~/.claude/automations/amanuensis-clean-slate/archive/old-findings-7c1c1a9.json` `counts` →
  `{"subsystems":8,"findings":22,"claims":0,"open_questions":16,"evidence":133,"xrefs":1,
  "dispositions":128,"concerns":22,"seams":10,"file_ledger":503}`.

### C5

The candidate's values are: 106 ledger rows; 607 tracked paths; 501 unledgered; 605
obligation-bearing; 84 examined (13.88 %); 42 evidence; 180 dispositions; 0.23 evidence per
disposition; 3 dispositions with an attached row (1.67 %); 3 `disposition_evidence` rows; 6 field
notes; 5 open questions (5 open); 0 vocabulary terms; 14 open findings of 14; 8 subsystems; 10
seams; 39 claims; 13 xrefs; 6 sessions; classifications candidate 20 / examined 84 /
generated-ignore 2.

Evidence:
- Queries as in `spec.md` §1.2, run against the candidate URI above.
- `SELECT COUNT(*) FROM dispositions d WHERE NOT EXISTS (SELECT 1 FROM disposition_evidence de WHERE de.subsystem_id=d.subsystem_id AND de.concern_code=d.concern_code);`
  → 177, matching `README.md` §1.
- `SELECT COUNT(*) FROM scope_gaps;` → 0 in both stores.
- The clean-slate report (`~/.claude/automations/amanuensis-clean-slate/report.md`, "Survey depth
  reached") records 37 evidence rows and 12 findings; the store now holds 42 and 14, so it was
  written to after that report. The store, not the report, is this packet's source.

### C6

The depth gate's red axes are reconciliation standing, examined fraction, per-disposition
evidence attachment, per-subsystem vocabulary discharge, and the per-finding carried accounting.
Field notes, open questions, evidence-row counts, vocabulary-term counts, disposition counts and
every ratio derived from them are printed with their baseline and a signed delta and never turn
a gate red.

Evidence:
- `decisions.md` §3 — "No numeric minimums."
- `README.md` §3.5 names `field notes` and `vocabulary terms` among axes a rebuild must "meet or
  exceed"; `spec.md` §1.6 records the conflict and resolves it to `decisions.md`.
- BP4 — a quota over a field the writer must author invites padding.
- The same reasoning is already written into this server:
  `mcp-server/src/invariants.ts:152-160` ("Forcing a count, or a row per category, is a quota
  over a field the writer must author") and `:199-203`.
- GP8 scope — subtractive guards; over a generative field a guard buys form, not truth.
- `spec.md` §8.5 states the false green this accepts.

### C7

`set_disposition` takes a required `evidence_ids` array of at least one existing evidence id and
writes the disposition and one `disposition_evidence` row per id in a single transaction.

Evidence:
- `mcp-server/src/tools/dispositions.ts:24-49` — current `required` list has no evidence ids.
- `mcp-server/src/tools/dispositions.ts:85-118` — the insert writes only `dispositions`.
- `mcp-server/src/tools/evidence.ts:68-102` — `attach_evidence_to_disposition` is the sole writer
  of `disposition_evidence`.
- `.claude/skills/amanuensis/references/phase-3-concerns.md:78-82` asks for the attachment in
  prose; candidate `SELECT COUNT(*) FROM disposition_evidence;` → 3 against 180 dispositions.
- `mcp-server/src/invariants.ts:175` — the one-is-enough precedent for a required-citation rule.

### C8

`set_disposition` refuses an `evidence_quality` stronger than the strongest `kind` among the
evidence rows it attaches.

Evidence:
- `mcp-server/src/tools/dispositions.ts:12-20` — `evidence_quality` "names the strongest evidence
  row attached to it".
- `.claude/skills/amanuensis/references/phase-3-concerns.md:71` — "matches the strongest evidence
  row attached."
- `dev/test-rebuild-depth.mjs:117-131` already asserts this over the receipt
  (`EVIDENCE_KINDS`, `FRAGILE_KINDS`).

### C9

An advance to `concerns`, `adversarial` or `mapped` refuses when any disposition of that
subsystem has **no** attached evidence row whose `ref_sha` resolves in the bound workspace. A
disposition with at least one resolvable attachment passes even when another attachment's revision
is unreachable; the unreachable attachment is reported, not refused. The two cases produce
different messages.

Evidence:
- `spec.md` §2.3 — the predicate is "at least one `disposition_evidence` row whose
  `evidence.ref_sha` resolves".
- `mcp-server/src/invariants.ts:303-359` — `enforcePhasePrerequisites`; `:378-391` walks every
  intermediate rung.
- `mcp-server/src/helpers.ts:127-145` — `resolveWorkspaceCommit`.
- Running `node dev/test-rebuild-depth.mjs` in this worktree at `fb9f1c4` prints
  `FAIL every disposition is evidence-backed at the quality it claims, and declares its
  linchpins: B-02/AL-1 carries no attached evidence row, so the concern was answered from
  nothing`.
- `~/.claude/automations/amanuensis-clean-slate/report.md` attributes that gate's red to
  hard-coded identifiers (candidate finding B07-R2) rather than to this assertion.

### C10

No existing domain row is migrated, backfilled or rewritten. The schema is additively migrated on
the next open of any store, and that migration is tested against a copy of the AxiomDB store. The
obligation binds at the next status advance and at the next publication. The AxiomDB store receives
the same obligations with no grace path; a refresh that cannot meet them reports red and publishes
nothing.

Evidence:
- `mcp-server/src/db.ts:46-58` — `openDatabase` runs `runMigrations` then `initializeSchema` on
  every open; `:84-89` re-execs `schema.sql`; `:154-192` `migrateVocabularyChecks` rebuilds
  `CHECK`-constrained tables on existing stores.
- AxiomDB, read-only: 166 dispositions, 54 unattached, 35 of 35 subsystems `mapped`, 1718
  `scope_gaps` rows, and `SELECT COUNT(*) FROM sqlite_master WHERE name IN
  ('scope_reconciliations','carried_findings');` → 0.
- `README.md` §4 — "Proposed: the same obligations; a refresh that cannot meet them reports red
  rather than publishing."
- `decisions.md` §1 — "Fix the tool, not the data."
- `dev/adr/0005-resolution-proof-and-projection-readback.md` and
  `mcp-server/src/tools/materialize.ts:226-233` — `clean_publish=true` leaves prior output
  untouched on a red run.
- The AxiomDB store's 166 dispositions are stated by the lane brief and were **not** measured by
  this session; `decisions.md` §6 places that repository outside the lane's custody.

### C11

Reconciliation is recorded in a new `scope_reconciliations` table written by `detect_changes`, not
inferred from the presence of `scope_gaps` rows. The table is append-only by
`scope_reconciliation_is_immutable` and `scope_reconciliation_cannot_be_deleted`, declared in
`schema.sql` beside it, and it stores a tree digest and a ledger digest beside the counts.

Evidence:
- `mcp-server/src/schema.sql:2622-2627` — the `<name>_is_immutable` / `<name>_cannot_be_deleted`
  pair, one of 269 triggers in the file.
- `mcp-server/src/tools/git.ts:91-96` — `set_git_state` "Subsequent calls may update any subset of
  fields", so `last_checked_sha` alone cannot stand for a reconciliation.
- `mcp-server/src/tools/git.ts:303-312` — `DELETE FROM scope_gaps` then re-insert; the table
  describes the tree now, and is empty both when nothing is wrong and when nothing was checked.
- `SELECT COUNT(*) FROM scope_gaps;` → 0 in both stores, while the candidate has 501 unledgered
  tracked paths and the baseline has 0.
- VP4(e) — report the denominator beside the verdict; a zero denominator is out-of-band, not
  green.
- `materializer/amanuensis_materializer/renderers.py:2689-2708` — `_tracked_paths` currently
  reconstructs the universe from `scope_gaps` plus the ledger, so an empty `scope_gaps` yields a
  universe equal to the ledger.

### C12

A store is reconciled at revision R exactly when R resolves and is normalized to its full 40-hex
commit id; a `scope_reconciliations` row has `detected_sha` equal to it;
`git_state.last_checked_sha` equals it; and the row's `tree_digest` and `ledger_digest` still match
digests re-derived now from `git ls-tree -r --name-only R` and from `file_ledger`. Reconciliation
enumerates R's tree, never the index.

Evidence:
- `mcp-server/src/tools/git.ts:220-222` — `detect_changes` today runs `git ls-files`, which reads
  the index, not R's tree.
- `spec.md` §3.3.
- `dev/adr/0001-living-conspectus-terms.md:19-21` clause 1 — "Its inventory names R and its
  immutable tree. Every tracked path in the pinned inventory has exactly one subsystem
  assignment or an explicit exclusion with owner and reason."
- Candidate `git_state.last_checked_sha` = `7c1c1a9…` with 501 unledgered paths at that revision.

### C13

The advance to `mapped` and `materialize_docs` refuse an unreconciled store; the advance to
`structural` does not. `materialize_docs` and the fully-surveyed predicate additionally refuse a
reconciliation reporting nonzero `unledgered` or `absent`; the advance to `mapped` does not.

Evidence:
- `dev/adr/0001-living-conspectus-terms.md:19` clause 1 — "Every tracked path in the pinned
  inventory has exactly one subsystem assignment or an explicit exclusion with owner and reason";
  `:20` clause 2 is the per-subsystem clause.
- Candidate: 501 unledgered tracked paths at `7c1c1a9` with 8 of 8 subsystems already `mapped`.
- `mcp-server/src/invariants.ts:351-354` — the `mapped` case, where `requireChallengedClaims`
  already sits.
- `README.md` §4 — "Proposed: the predicate, so a rebuild can progress subsystem by subsystem."
- `mcp-server/src/tools/materialize.ts:226-247`.
- Baseline finding B03-5: "A subsystem can report status 'mapped' with zero unledgered paths,
  zero absent …" (`SELECT symptom FROM findings WHERE finding_id='B03-5';`, baseline store).

### C14

The projection prints `not measured`, naming the revision and the reason, wherever a coverage
figure has no standing reconciliation, and `_tracked_paths` reads the reconciliation record rather
than the ledger. The change alters the "Files read, of those carrying an obligation" denominator
for any store with unledgered paths, so the gate's controls are two fixtures rather than one.

Evidence:
- `materializer/amanuensis_materializer/renderers.py:415` — `obligation_files` is
  `SUM(CASE WHEN {OBLIGATION_BEARING_SQL} … ) FROM file_ledger`, over ledger rows; `:630` reads it.
- `materializer/amanuensis_materializer/renderers.py:750-753` — `"Paths in scope with no ledger
  row", str(unledgered["n"] or 0)`; the candidate's published overview therefore prints `0`.
- `renderers.py:717-728` — the staleness row's existing `"not measured by this projection"`
  treatment, which this matches.
- `renderers.py:2718-2724` — `_gap_denominator` already emits "No … is recorded, so this gap is
  not measured here. That is a statement about the record, not a claim that the gap is closed."
- `renderers.py:2728-2745` docstring — "A section that cannot turn red on the only store it has
  been run against is a zero-denominator green (VP4)".

### C15

`define_term` requires an active session, parses `first_seen` as a `file:symbol@sha` citation,
**resolves** the token's revision and verifies the token's path exists in that revision's tree, and
stores `ref_sha` resolved. A supplied anchor that does not resolve refuses the call; an absent
anchor stores an unanchored term that discharges nothing.

Evidence:
- `mcp-server/src/helpers.ts:180-207` — `requireWorkspaceCitation` checks `indexOf(":")`,
  `lastIndexOf("@")` and path syntax; it runs no git and performs no tree lookup.
- `mcp-server/src/tools/vocabulary.ts:20` — `required: ["term", "gloss"]`.
- `mcp-server/src/tools/vocabulary.ts:21-43` — no `requireActiveSession`, no citation validation,
  no revision resolution.
- `mcp-server/src/helpers.ts:225` — `CITATION_TOKEN_SOURCE`.
- Baseline `SELECT term, first_seen FROM vocabulary;` → 4 rows, 2 with a bare path and no `@sha`
  (`design/delightful-output-panel/task-tests.md`,
  `design/delightful-output-panel/source-capture.md`); 0 of 4 match the citation grammar.

### C16

A new `vocabulary_declinations` table and a `decline_domain_vocabulary` tool record a reasoned "no
domain vocabulary" per subsystem; the tool refuses when the subsystem already has an anchored term.
The table is append-only by `vocab_declination_is_immutable` and
`vocab_declination_cannot_be_deleted`, declared in `schema.sql` beside it.

Evidence:
- `mcp-server/src/schema.sql:2622-2627` — the immutability trigger pair.
- `spec.md` §8.3 — `GATE VD1` is red when a declination is updatable or deletable.
- `decisions.md` §3 — "satisfied either by real records with resolvable anchors or by an
  explicit, reasoned declaration that none apply."
- GP18 — ruled-out records are kept, not deleted.
- Candidate `SELECT COUNT(*) FROM vocabulary;` → 0, across 8 `mapped` subsystems.

### C17

The advance to `structural` refuses a subsystem with neither an anchored term scoped to it nor an
effective declination whose `ref_sha` still resolves. A codebase-wide term (`subsystem_id IS NULL`)
satisfies no subsystem's obligation. Scoping is per `(term, subsystem)`, so re-defining a shared
term for one subsystem cannot silently revoke another's discharge.

Evidence:
- `mcp-server/src/schema.sql:406` — `term TEXT PRIMARY KEY`, one row per term.
- `mcp-server/src/tools/vocabulary.ts:36` — the upsert sets
  `subsystem_id = COALESCE(excluded.subsystem_id, vocabulary.subsystem_id)`, so a non-null
  `subsystem_id` on a re-definition overwrites the existing scope.
- `mcp-server/src/invariants.ts:309-322` — the `structural` case, where `requireStructuralClaim`
  already sits.
- `mcp-server/src/schema.sql` `vocabulary.subsystem_id` — "NULL = codebase-wide, else scoped".
- `.claude/skills/amanuensis/references/phase-2-structural.md:171-176` — vocabulary is step 9 and
  carries no gate.

### C18

A declined subsystem is rendered with its reason, session and revision. "Declined" and "not
recorded" are distinct renderings and are never collapsed. Where a subsystem holds both anchored
terms and a declination, the terms render as the current state and the declination renders beneath
them as superseded history.

Evidence:
- `spec.md` §4.3 — a declination is kept across a reset and a later term may be defined, so both
  records can coexist.
- `spec.md` §4.5.
- VP4(e) — the silent-failure state must not be representable as a valid in-band reading.

### C19

Carried findings live in `carried_findings` and `carried_finding_outcomes`, not in `findings`.

Evidence:
- `mcp-server/src/schema.sql` `findings.finding_id TEXT PRIMARY KEY` — a carried id would collide
  with a successor id in the same namespace.
- `dev/pecia-resolve-finding.mjs:73-88` — `finding_resolution_current` is the resolver's
  authority and answers about this store.
- Candidate finding B03-R2: "A clean-slate rebuild has **no supported path** for carrying
  unresolved findings forward" (`~/.claude/automations/amanuensis-clean-slate/report.md`).

### C20

A carried record names the store it came from via `archived_store_id`. Every store mints an
immutable `store_generation` at schema creation and `archived_store_id` is `store-` plus its first
16 hex. For an archive frozen before that field existed, `archived_store_id` is
`store-legacy-` plus the first 16 hex of SHA-256 over that archive's frozen
`<repo_id>|<canonical_branch>|<onboarding_sha>|<last_checked_sha>`, available only when the source
is opened `?immutable=1`. An export carries `archived_store_id` as a required contract field.

Evidence:
- Candidate finding B03-R1: "`finding_id` carries no store generation, so a rebuilt store can
  silently re-satisfy a closed Pecia reference."
- `mcp-server/src/tools/git.ts:91-96` — `set_git_state` "Subsequent calls may update any subset of
  fields", so a live store's `last_checked_sha` changes and the derived id changes with it; two
  rebuilds sharing the tuple yield one id.
- Baseline `git_state` → `default | main | b8b566f | 61bc6b5c…`; candidate →
  `default | main | 7c1c1a9… | 7c1c1a9…`.
- `old-findings-7c1c1a9.json` top-level keys → `anchor, counts, exported_at, findings,
  open_questions, source, subsystems`; a substring search of the whole file for `repo_id`,
  `canonical_branch`, `onboarding_sha`, `last_checked_sha`, `git_state` and `archived_store_id`
  returns none. Its `anchor` is `7c1c1a9f…`, not the archived store's `last_checked_sha`
  `61bc6b5c…`.

### C21

Reinitialization requires `--carry-from`, naming an archived store or an export carrying
`archived_store_id`; `--carry-from none` requires `--carry-reason` and records an explicit reasoned
empty carry in `carry_runs`. All archived findings are carried, with `expected_count` and
`imported_count` recorded separately. A finding the archive had already closed is pre-recorded with
the outcome `archived-terminal`, which the carry alone writes and which is not one of the three
authority-bearing outcomes.

Evidence:
- `old-findings-7c1c1a9.json` `resolution_state` histogram → `open` 13, `verified-fixed` 8,
  `fixed-pending-verification` 1.
- `spec.md` §8.4 — `GATE CF1` is red when `record_carried_outcome` accepts `repaired` with no
  post-repair evidence.
- `dev/rebuild-self-conspectus-store.mjs` — snapshot, stop, delete, reinitialize; no carry step.
- `design/reader-lenses/spec.md:1346-1374` §12.1 — the seven-step recipe, no carry step.
- `~/.claude/automations/amanuensis-clean-slate/archive/old-findings-7c1c1a9.json` — keys
  `['anchor','exported_at','source','subsystems','findings','open_questions','counts']`; each
  finding carries `finding_id, subsystem_id, severity, status, resolution_state,
  resolution_rationale, resolution_fix_sha, symptom, root_cause, primary_files, fix_location,
  ref_sha, pass_type, created_at`; anchor `7c1c1a9f5689d396487072d012abe6fafd5f348c`.
- GP25 — a guard halts; a warning that does not halt is prose with better timing.

### C22

A carried finding reaches exactly one terminal outcome. Three are authority-bearing and written by
`record_carried_outcome`: `successor-finding` (naming a finding filed in this store), `ruled-out`
(requiring evidence collected in the current session and attached through `carried_finding_evidence`),
`repaired` (requiring a resolving `repaired_sha` **and** an attached evidence row whose revision is
a descendant of or equal to it, tested with `git merge-base --is-ancestor`). The fourth,
`archived-terminal`, is written only by the carry.

Evidence:
- `spec.md` §5.4 named `carried_finding_evidence`; `spec.md` §5.2 now declares it.
- `mcp-server/src/invariants.ts:422-447` — `requireOverturnEvidence`: "Overturning requires
  evidence, not vibes"; evidence must carry the current `session_id`.
- `dev/adr/0001-living-conspectus-terms.md:46-48` §Verified-fixed — "A code change, a developer
  assertion, or status `fixed` without new evidence is `fixed-pending-verification`, never
  verified-fixed."
- `dev/adr/0001-living-conspectus-terms.md:42-44` §Resolved — a terminal resolution, an
  authorized actor, and resolution evidence or an explicit authorized dismissal.

### C23

ADR-0001's *fully surveyed* predicate gains clause 7: every carried finding has a terminal outcome.
It is enforced at the whole-store predicate, not at `mapped` for the carried finding's subsystem.
The whole-store predicate is given a store-scoped implementation,
`dev/check-store-fully-surveyed.mjs`, which evaluates an open store read-only;
`dev/check-living-conspectus.mjs` continues to read the frozen A0 fixture and is not retargeted.

Evidence:
- `dev/check-living-conspectus.mjs:723` resolves its fixture to `dev/conspectus/self-baseline.json`
  and `main()` calls `evaluateConspectus(manifest)` over the parsed JSON, not over a store.
- `dev/test-living-conspectus.mjs:8-15` imports the same `evaluateConspectus` and mutates the same
  fixture; `design/reader-lenses/spec.md` §12.3 forbids retargeting it.
- `grep -rn "fully.surveyed\|fullySurveyed" mcp-server/src/` → one hit, `vocabulary.ts:1296`, a
  phrase inside a word list.
- `dev/adr/0001-living-conspectus-terms.md:19-30` — the six existing clauses.
- `dev/adr/0001-living-conspectus-terms.md:56-60` — the obligation-id table; the new shape is
  `carried:<archived_store_id>:<archived_finding_id>`.
- `README.md` §4 — the undecided question, "Proposed: the predicate".
- `decisions.md` §4.

### C24

`dev/pecia-resolve-finding.mjs` looks up `findings` first, then `carried_findings`: a
`successor-finding` outcome re-runs the lookup against the successor and answers with its state;
`ruled-out`, `repaired` and `archived-terminal` exit 0; an undecided carried record exits 1. An id
matching carried records from more than one archive exits 2 and asks for the store-qualified form.
Exit codes and the no-echo rule are unchanged.

Evidence:
- `spec.md` §5.2 — `carried_findings` is `UNIQUE (archived_store_id, archived_finding_id)`, so an
  unqualified id can match rows from two archives.
- `dev/pecia-resolve-finding.mjs:29` — "Exit codes: 0 resolved · 1 not resolved · 2 cannot run."
- `dev/pecia-resolve-finding.mjs:31-33` — "It deliberately never prints its argument … pecia
  decision pc-cdb8."
- `dev/pecia-resolve-finding.mjs:89-100` — a missing row and a non-terminal state both exit 1
  today, so a destroyed referent and a reopened one are indistinguishable.
- `~/.claude/automations/amanuensis-clean-slate/report.md` — `pecia audit` reported exactly the 8
  closed defects whose reference stopped resolving: `pc-1a91 pc-207e pc-707e pc-80b8 pc-833d
  pc-adce pc-ae87 pc-d688`.

### C25

The six findings the 2026-09-14 rebuild lost are carried retroactively by the acceptance rebuild's
carry step from the archived **store**, not from the export and not by writing to the primary
checkout's store.

Evidence:
- The archived store's `findings` table holds all 22 rows with `finding_id`, `subsystem_id`,
  `symptom`, `root_cause`, `severity`, `status`, `primary_files`, `ref_sha` and `pass_type`, and
  `finding_resolution_current` supplies `resolution_state`; its `git_state` row supplies the legacy
  `archived_store_id`. The export supplies no store identity.
- `decisions.md` §6 — the primary checkout and its rebuilt store are read-only for the lane.
- `old-findings-7c1c1a9.json` holds all six with full text:
  `B03-5 HIGH open`, `B03-6 MEDIUM open`, `B03-7 MEDIUM open`, `B03-8 MEDIUM open`,
  `B04-5 MEDIUM open`, `B07-1 LOW open`.
- `README.md` §1 — "6 archived ones (B03-5, B03-6, B03-7, B03-8, B04-5, B07-1) were neither
  re-found nor ruled out".

### C26

Eleven named passages in the skill's references and `SKILL.md` change to state the new refusals in
the server's own words; no sentence describing a surviving behaviour is removed and nothing is
softened. The parity check derives a candidate refusal set from the server's own thrown messages
and reports every entry with no register row.

Evidence:
- `.claude/skills/amanuensis/references/phase-1-scope.md:58` calls
  `define_term(term, gloss, expansion, subsystem_id, first_seen, ref_sha)`;
  `references/phase-2-structural.md:24` and `references/phase-3-concerns.md:120` name `define_term`
  again. None of the three was in the eight-entry register.
- `spec.md` §6.1 table; `decisions.md` §2.
- Current text: `references/phase-2-structural.md:171-176`; `references/phase-3-concerns.md:63-82`;
  `references/refresh.md:30-46`; `references/phase-4-adversarial.md`; `references/onboarding.md`;
  `references/artifact-templates.md`.
- Candidate finding B01-R1: "`phase-4-adversarial.md` instructs an operation the server refuses
  and one it has replaced" — the same drift class this check exists to stop.

### C27

The parity check is string identity between a hand-maintained register
(`mcp-server/contracts/refusal-parity.json`), the server file, and each reference.

Evidence:
- `mcp-server/scripts/check-evidence-vocabulary.mjs` — the existing precedent, holding the
  source, both generated copies and `SKILL.md`'s prose ladder together.
- `mcp-server/contracts/conspectus-vocabulary.json` — the single enum source; no new declaration
  kind or obligation state is introduced outside it.
- GP28 — a fact stored twice needs a generator and a `--check`; the coverage axis asks whether
  the `--check` exists, runs in the gate runner, and is in the repair path.
- `spec.md` §8.7 records that a refusal nobody registers drifts freely.

### C28

`dev/test-survey-depth.mjs` has a baseline arm over a committed frozen fixture and a candidate
arm over the live store or the acceptance receipt, and reports `RED` rather than green when the
baseline is unreadable.

Evidence:
- `dev/test-rebuild-depth.mjs:20-27` — "a gate that only read the store would be green by absence
  in CI … which is the zero-denominator failure this repository has already recorded three times
  (VP4, and concern ZD-1 in this very survey)."
- `git ls-files .amanuensis` → 0.
- VP4(e); `dev/receipt-provenance.mjs` (`resolveRevisions`, `historyIsComplete`).

### C29

The depth gate's blocking axes are B1 reconciliation standing with zero unledgered and zero absent
paths, B2 examined fraction ≥ 0.5957,
B3 every disposition in a subsystem at `concerns`+ evidence-backed with a resolving `ref_sha`,
B4 every subsystem at `structural`+ discharged or declined, B5 all 13 baseline open findings
carried with a terminal outcome, B6 no undecided carried record.

Evidence:
- `spec.md` §7.3; the 13 ids are C4's list.
- `dev/adr/0001-living-conspectus-terms.md:19` clause 1 — exactly one assignment or explicit
  exclusion per tracked path.
- Applied to the candidate as measured, each of B1, B2, B3, B4, B5 is red: 501 unledgered against a
  required 0; 13.88 % vs 59.57 %; 177 of 180 unattached; 0 terms and 0 declinations over 8 mapped
  subsystems; 0 carried records against 13 baseline open findings.

### C30

The acceptance rebuild runs `design/reader-lenses/spec.md` §12.1's recipe in this worktree with a
carry step inserted after initialization and before any survey work, and runs the snapshot and
delete steps unconditionally even though this worktree has no prior store.

Evidence:
- `design/reader-lenses/spec.md:1346-1374` §12.1 steps 1-7; `:1374-1397` §12.2 publication and
  promotion; `:1398-1406` §12.3 what stays green.
- `ls -la .amanuensis` in this worktree → no such directory.
- VP4 — a recipe whose conditional branch never executes is a branch nothing has tested.

### C31

The acceptance result is recorded in `design/survey-depth/acceptance-receipt.json` under the
contract `amanuensis-survey-depth/acceptance-receipt/v1`, carrying every blocking axis with its
verdict, every reported axis with its delta, and the row-level witnesses each blocking predicate is
recomputed from — per-disposition attachment `ref_sha` values for B3, per-subsystem term anchors and
declination records for B4, the reconciliation's two digests for B1, and the carried table for
B5/B6. The gate recomputes each predicate from those rows and never reads a recorded verdict field.

Evidence:
- `dev/test-rebuild-depth.mjs:92-98` — the `RECEIPT_CONTRACT` /
  `design/reader-lenses/rebuild-depth-receipt.json` pattern this follows.
- `design/reader-lenses/spec.md:1407-1437` §12.4 — the dogfood gate runs against committed
  artifacts, not the live store.

### C32

Every gate prints `GATE <id> RED: <reason>` or `GATE <id> GREEN` as its single last stdout line,
scrubs launcher crash signatures, names a must-stay-green control, and states in its header the
false green it cannot exclude. `GATE A1` gains the control it lacked, paired with a seeded
forged-green receipt.

Evidence:
- `spec.md` §8.1, §8.2, §8.3, §8.4, §8.5, §8.6, §8.7 and §8.9 each name a control; §8.8 named none.
- `mcp-server/test-locus-standing.mjs:1450`, `:1455` — the `GATE P6 RED:` / `GATE P6 GREEN`
  protocol.
- `dev/test-rebuild-depth.mjs:176-201` — the `SCRUB` table, `emit`, `check`.
- `dev/test-rebuild-depth.mjs:68-78` — the "False greens it cannot exclude" header section.
- VP4(f) — "a kill proves a gate *can* fire, never that it fires *selectively*"; every newly
  installed checker ships its must-fail case and a must-stay-green control in the same commit.

### C33

No existing gate, test or read-back axis is weakened. `dev/test-rebuild-depth.mjs` changes only by
reading two hard-coded literals from `mcp-server/contracts/concern-checklist.json`, a standalone
committed contract no rebuild packet rewrites, and its `a disposition carries no attached evidence`
assertion is untouched. `design/reader-lenses/rebuild-coverage-receipt.json` is not a deliverable of
any rebuild packet. `dev/test-rebuild-readback.mjs` changes only by passing an explicit reasoned
empty carry and asserting the record it writes.

Evidence:
- `design/reader-lenses/rebuild-coverage-receipt.json` — `packet` `P17`, `repository_sha`
  `dee59d3e019a6747af714aa5a44acbb774ff6d5f`; a document a different run produced.
- `dev/test-rebuild-readback.mjs:541-552` and `:686-699` spawn the rebuild driver with
  `--confirm --workspace --archive --receipt` and no `--carry-from`, and `:584`, `:596`, `:622`,
  `:720`, `:737` assert it exited 0.
- Running `node dev/test-rebuild-depth.mjs` in this worktree at `ec11d3f` → `GATE P19 RED: … 8
  failed assertion(s)`.
- `dev/test-rebuild-depth.mjs:104` — `const CHECKLIST_CONCERNS = ["BV-1","CC-1","EV-1","GT-1","RC-1","ZD-1"];`
- `dev/test-rebuild-depth.mjs:24-28` — the GP24 property the literal protects: "reading it from
  the same document that reports the coverage would let a dropped concern shrink both halves at
  once."
- Running the gate at `fb9f1c4` prints `FAIL … the depth receipt's checklist omits concern(s)
  BV-1, EV-1, GT-1, RC-1` and `FAIL … B-02 records finding "B02-R1", which does not follow
  <subsystem-id-compact>-<N>`.
- Candidate finding B07-R2: "The depth gate hard-codes the discarded survey's concern codes and a
  colliding finding-id shape."
- `.github/workflows/test.yml:255`, `:260`, `:266`, `:274` — the four rebuild gates in CI.

### C34

Every gate's red commit ships the complete test, including its fixtures and its must-stay-green
control, against the unchanged implementation. At the red commit the gate exits non-zero, prints
`GATE <packet-id> RED: <reason>` as its last stdout line, and emits no crash signature; at HEAD it
exits 0 and prints `GATE <packet-id> GREEN`. Every red condition in `spec.md` §7.3 and §8 names
the assertion that fires, never the absence of the test file.

Evidence:
- `spec.md` §8.0.
- `plan.json` — all twelve packet `gate.test_path` values are files that exist neither on disk nor
  in `HEAD` at `e6ce473`: `test-existing-store-migration.mjs`, `test-disposition-evidence.mjs`,
  `test-scope-reconciliation.mjs`, `test-vocabulary-discharge.mjs`, `test-carried-findings.mjs`,
  `test-survey-depth-red-gates.mjs`, `test-unmeasured-coverage.py`, `test-refusal-parity.mjs`,
  `test-carry-receipt.mjs`, `test-survey-depth.mjs`, `test-survey-depth-acceptance.mjs`,
  `test-pecia-carry-audit.mjs`; `test-carried-finding-references.mjs` is the same, and is the one
  declared gate that is not a packet gate (`spec.md` §8.0, §8.9).
- `plan.json` `gate.red_rejects` carries the crash signatures `MODULE_NOT_FOUND`,
  `Cannot find module`, `ENOENT`, `SyntaxError`, `ReferenceError`, `TypeError`,
  `is not a function`, `command not found`, `ModuleNotFoundError`, `ImportError`.
- VP4(f) — a kill proves a gate can fire, never that it fires selectively.

### C35

The additive schema migration is gated against a copy of an existing populated store, not asserted.
Packet P0 copies the AxiomDB store to temporary storage and tests table creation, refusal behaviour,
non-mutation of existing rows, and clean-publish rollback.

Evidence:
- AxiomDB, read-only: 166 dispositions, 54 unattached, 35 of 35 subsystems `mapped`, 295 ledger rows
  over 187 distinct paths, 53 paths owned by more than one subsystem, 1718 `scope_gaps` rows, 41
  vocabulary rows, 35 `deferred-with-reason` paths, and `SELECT COUNT(*) FROM sqlite_master WHERE
  name IN ('scope_reconciliations','carried_findings');` → 0.
- `mcp-server/src/db.ts:46-58`, `:84-89`, `:154-192`.
- `decisions.md` §6 places the AxiomDB repository outside the lane's custody; the copy is read once
  and written nowhere.

### C36

`dev/test-survey-depth.mjs` exits 2 `cannot run` when it has neither a live store nor a committed
acceptance receipt, and `dev/record-survey-depth-baseline.mjs --check` exits 2 when the archived
store is unreadable. Neither reports green in those states.

Evidence:
- `spec.md` §7.1 candidate arm; §7.2's archive path
  `~/.claude/automations/amanuensis-clean-slate/archive/store-7c1c1a9/memory.db` is a machine-local
  absolute path outside the repository.
- `dev/receipt-provenance.mjs` — `resolveRevisions`, `historyIsComplete`, the existing
  `cannot run` precedent.
- VP4(e) — a zero denominator is out-of-band, not a pass.

### C37

`set_disposition` resolves the distinct `ref_sha` values among the evidence rows it attaches in one
batched `git cat-file --batch-check`, not one `resolveWorkspaceCommit` per id.

Evidence:
- `mcp-server/src/helpers.ts:110-125` — the subprocess "is paid on every durable write" and cannot
  be cached; `:127-145` is one `spawnSync` per call.
- `mcp-server/test-perf-ceilings.mjs:187` — `ceiling("set_disposition (resolves ref_sha)", 200, …)`;
  `:171-184` records the measured cost as 6.35-6.50 ms and the ceiling as ~31×, "tighter in
  multiples than every other entry in this section".

### C38

Every table this specification adds is declared with `CREATE TABLE IF NOT EXISTS` and carries a
`<name>_is_immutable` / `<name>_cannot_be_deleted` trigger pair declared beside it. The trigger,
not the prose, is what makes the table append-only.

Evidence:
- `mcp-server/src/db.ts:85-88` — "The schema is written with CREATE ... IF NOT EXISTS throughout, so
  we can run it on every open"; `:89` execs `schema.sql` on every `openDatabase`.
- `grep -c '^CREATE' mcp-server/src/schema.sql` → 517; `grep -c '^CREATE.*IF NOT EXISTS'` → 516.
- `mcp-server/src/schema.sql:2622-2627` — the trigger pair, one of 269 in the file.
- `decisions.md` §2.

### C39

`spec.md` §5.6's carried-obligation projection is delivered by P6, which depends on P4, and
`readback.py` gains a carried-record census beside its existing ones.

Evidence:
- `materializer/amanuensis_materializer/readback.py:252-262` — `_finding_partition_census`,
  `_ledger_stale_census` and `_locus_index_census` enumerate findings, stale entries and the locus
  index from the database; none sees a carried row.

### C40

`carried_finding_outcome` is declared in `mcp-server/contracts/conspectus-vocabulary.json` and
`carried_findings.archived_resolution` takes its `CHECK` from the contract's existing
`finding_resolution_state`. The two files `scripts/gen-vocabulary.mjs` generates are deliverables of
every packet that changes the contract.

Evidence:
- `mcp-server/scripts/gen-vocabulary.mjs:28-31` — writes `mcp-server/src/vocabulary.ts` and
  `materializer/amanuensis_materializer/vocabulary.py`; `--check-sql` asserts the schema's `CHECK`
  literals match the source.
- `mcp-server/contracts/conspectus-vocabulary.json` `finding_resolution_state` → `open`, `accepted`,
  `ruled-out`, `fixed-pending-verification`, `verified-fixed`.
- `mcp-server/src/db.ts:154-192` — `migrateVocabularyChecks` reads the columns to migrate from the
  contract's own `sql` mappings, so an enum declared only inline never reaches an existing store.

### C41

`design/survey-depth/carry-receipt.json` is written by P8 and records, for every finding id the
archived store holds, that id's archived resolution state and the `carried_id` of the record the
carry wrote. P10's survey takes its denominator from that file; P11 records the acceptance receipts
and does not rewrite it. `GATE CR1` — `dev/test-carry-receipt.mjs`, `spec.md` §8.9a — is red when
the receipt omits an archived id, names a `carried_id` no `carried_findings` row has, disagrees with
the archive's own resolution state, or reports a count differing from `carry_runs`.

Evidence:
- The archived store's `findings` table holds 22 rows (C25); `plan.json` P8 acceptance records
  `expected_count` 22 equal to `imported_count` 22.
- `dev/test-rebuild-depth.mjs:19-24` — "Every denominator this gate counts against is read from a
  *different* committed document than the one under test … A numerator and its denominator that
  shrink together prove nothing (GP24)"; `design/reader-lenses/rebuild-coverage-receipt.json` was
  written by reader-lenses P17 at `dee59d3e`.
- `plan.json` P8 — `dev/record-carry-receipt.mjs`, `design/survey-depth/carry-receipt.json` and
  `dev/test-carry-receipt.mjs` are deliverables; P10 `depends_on` P8 and P11 `depends_on` P10.

### C42

A `cannot run` is never accepted as a gate's red proof. `GATE D0`, `GATE XS1` and `GATE CR1` each
exit 2 in that state, so the launcher's red check is a conjunction: exit non-zero **and** a last
stdout line beginning `GATE <packet-id> RED:`. Each of the three names the input its red requires —
XS1 a readable copy of the AxiomDB store, CR1 the archived store at `spec.md` §7.2's path, D0 the
live store `.amanuensis/memory.db` that P8 initializes in the lane worktree. A packet whose red
proof needs an input the machine does not have is blocked, not waived.

Evidence:
- `spec.md` §8.0 clause 3; §7.1 candidate arm; §8.0a and §8.9a each state `cannot run` — never
  green — when their store is unreadable on this machine.
- The lane worktree holds no `.amanuensis` directory and `git ls-files .amanuensis` returns 0, so
  D0's candidate arm has no live store until P8 initializes one; `plan.json` P11 writes
  `design/survey-depth/acceptance-receipt.json`, after P10.
- `plan.json` — P0, P8 and P10 `gate.red_expect` begin `GATE XS1 RED:`, `GATE CR1 RED:` and
  `GATE D0 RED:`, none of which a `cannot run` line satisfies.
- VP4(e) — a zero denominator is out-of-band, not a pass; VP4(f) — a kill proves a gate can fire,
  never that it fires selectively.

### C43

Every packet's regression list contains the gate command of every packet it transitively depends
on. `GATE CF2` is the exception: it is not a packet gate and runs as a regression command from P8
onward.

Evidence:
- `plan.json` — the closure holds for all twelve packets; before this revision P2 through P7 ran
  none of their predecessors' lane gates, and P10, P11 and P9 ran neither `dev/test-carry-receipt.mjs`
  (P8) nor `dev/test-survey-depth.mjs` (P10).
- `plan.json` S1 is serialized P0 to P1 to P2 to P3 to P4, and those packets share
  `mcp-server/src/invariants.ts`, `src/schema.sql` and `src/db.ts`.
- `design/reader-lenses/plan.json` — P2's gate `cd mcp-server && node test-finding-partition.mjs`
  appears in exactly one later packet's regression list (P21, the last packet), and 20 of that
  lane's 21 packets omit at least one predecessor's gate.
- `spec.md` §8.0.

