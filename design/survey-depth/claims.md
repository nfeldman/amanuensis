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

The depth measures are the ten statements in `spec.md` §1.2 (D1–D12), frozen with the baseline,
and `dev/test-survey-depth.mjs` executes exactly those and no others.

Evidence:
- `spec.md:§1.2`; the SQL is carried verbatim into `dev/survey-depth-baseline.json` (`spec.md:§7.2`).
- `SELECT COALESCE(last_checked_sha,'(null)')||' / '||COALESCE(onboarding_sha,'(null)') FROM git_state;`
  → baseline `61bc6b5c89f7c6b5091f9cb5df5e68cd969a3f27 / b8b566f`; candidate
  `7c1c1a9f5689d396487072d012abe6fafd5f348c / 7c1c1a9f5689d396487072d012abe6fafd5f348c`.

### C2

Every coverage fraction takes its denominator from the repository's tracked paths at the store's
reconciled revision, never from `file_ledger`'s own row count.

Evidence:
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
subsystem has no attached evidence row, or has one whose `ref_sha` does not resolve in the bound
workspace. The two cases produce different messages.

Evidence:
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

No store is migrated, backfilled or rewritten. The obligation binds at the next status advance
and at the next publication. The AxiomDB store receives the same obligations with no grace path;
a refresh that cannot meet them reports red and publishes nothing.

Evidence:
- `README.md` §4 — "Proposed: the same obligations; a refresh that cannot meet them reports red
  rather than publishing."
- `decisions.md` §1 — "Fix the tool, not the data."
- `dev/adr/0005-resolution-proof-and-projection-readback.md` and
  `mcp-server/src/tools/materialize.ts:226-233` — `clean_publish=true` leaves prior output
  untouched on a red run.
- The AxiomDB store's 166 dispositions are stated by the lane brief and were **not** measured by
  this session; `decisions.md` §6 places that repository outside the lane's custody.

### C11

Reconciliation is recorded in a new append-only `scope_reconciliations` table written by
`detect_changes`, not inferred from the presence of `scope_gaps` rows.

Evidence:
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

A store is reconciled at revision R exactly when a `scope_reconciliations` row has
`detected_sha = R`, `git_state.last_checked_sha = R`, and R resolves in the bound workspace.

Evidence:
- `spec.md` §3.3.
- `dev/adr/0001-living-conspectus-terms.md:19-21` clause 1 — "Its inventory names R and its
  immutable tree. Every tracked path in the pinned inventory has exactly one subsystem
  assignment or an explicit exclusion with owner and reason."
- Candidate `git_state.last_checked_sha` = `7c1c1a9…` with 501 unledgered paths at that revision.

### C13

The advance to `mapped` and `materialize_docs` refuse an unreconciled store. The advance to
`structural` does not.

Evidence:
- `mcp-server/src/invariants.ts:351-354` — the `mapped` case, where `requireChallengedClaims`
  already sits.
- `README.md` §4 — "Proposed: the predicate, so a rebuild can progress subsystem by subsystem."
- `mcp-server/src/tools/materialize.ts:226-247`.
- Baseline finding B03-5: "A subsystem can report status 'mapped' with zero unledgered paths,
  zero absent …" (`SELECT symptom FROM findings WHERE finding_id='B03-5';`, baseline store).

### C14

The projection prints `not measured`, naming the revision and the reason, wherever a coverage
figure has no standing reconciliation, and `_tracked_paths` reads the reconciliation record
rather than the ledger.

Evidence:
- `materializer/amanuensis_materializer/renderers.py:750-753` — `"Paths in scope with no ledger
  row", str(unledgered["n"] or 0)`; the candidate's published overview therefore prints `0`.
- `renderers.py:717-728` — the staleness row's existing `"not measured by this projection"`
  treatment, which this matches.
- `renderers.py:2718-2724` — `_gap_denominator` already emits "No … is recorded, so this gap is
  not measured here. That is a statement about the record, not a claim that the gap is closed."
- `renderers.py:2728-2745` docstring — "A section that cannot turn red on the only store it has
  been run against is a zero-denominator green (VP4)".

### C15

`define_term` requires an active session, validates `first_seen` as a `file:symbol@sha` citation,
and stores `ref_sha` resolved.

Evidence:
- `mcp-server/src/tools/vocabulary.ts:21-43` — no `requireActiveSession`, no citation validation,
  no revision resolution.
- `mcp-server/src/helpers.ts:225` — `CITATION_TOKEN_SOURCE`.
- Baseline `SELECT term, first_seen FROM vocabulary;` → 4 rows, 2 with a bare path and no `@sha`
  (`design/delightful-output-panel/task-tests.md`,
  `design/delightful-output-panel/source-capture.md`); 0 of 4 match the citation grammar.

### C16

A new append-only `vocabulary_declinations` table and a `decline_domain_vocabulary` tool record a
reasoned "no domain vocabulary" per subsystem; the tool refuses when the subsystem already has an
anchored term.

Evidence:
- `decisions.md` §3 — "satisfied either by real records with resolvable anchors or by an
  explicit, reasoned declaration that none apply."
- GP18 — ruled-out records are kept, not deleted.
- Candidate `SELECT COUNT(*) FROM vocabulary;` → 0, across 8 `mapped` subsystems.

### C17

The advance to `structural` refuses a subsystem with neither an anchored term scoped to it nor a
declination. A codebase-wide term (`subsystem_id IS NULL`) satisfies no subsystem's obligation.

Evidence:
- `mcp-server/src/invariants.ts:309-322` — the `structural` case, where `requireStructuralClaim`
  already sits.
- `mcp-server/src/schema.sql` `vocabulary.subsystem_id` — "NULL = codebase-wide, else scoped".
- `.claude/skills/amanuensis/references/phase-2-structural.md:171-176` — vocabulary is step 9 and
  carries no gate.

### C18

A declined subsystem is rendered with its reason, session and revision. "Declined" and "not
recorded" are distinct renderings and are never collapsed.

Evidence:
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

A carried record names the store it came from, via `archived_store_id` = `store-` plus the first
16 hex of SHA-256 over `<repo_id>|<canonical_branch>|<onboarding_sha>|<last_checked_sha>`.

Evidence:
- Candidate finding B03-R1: "`finding_id` carries no store generation, so a rebuilt store can
  silently re-satisfy a closed Pecia reference."
- Baseline `git_state` → `default | main | b8b566f | 61bc6b5c…`; candidate →
  `default | main | 7c1c1a9… | 7c1c1a9…`; the two rows differ, so the derivation separates them.

### C21

Reinitialization requires `--carry-from <archived store | export>`; `--carry-from none` records
an explicit reasoned empty carry. All archived findings are carried, terminal ones pre-recorded
with their archived outcome.

Evidence:
- `dev/rebuild-self-conspectus-store.mjs` — snapshot, stop, delete, reinitialize; no carry step.
- `design/reader-lenses/spec.md:1346-1374` §12.1 — the seven-step recipe, no carry step.
- `~/.claude/automations/amanuensis-clean-slate/archive/old-findings-7c1c1a9.json` — keys
  `['anchor','exported_at','source','subsystems','findings','open_questions','counts']`; each
  finding carries `finding_id, subsystem_id, severity, status, resolution_state,
  resolution_rationale, resolution_fix_sha, symptom, root_cause, primary_files, fix_location,
  ref_sha, pass_type, created_at`; anchor `7c1c1a9f5689d396487072d012abe6fafd5f348c`.
- GP25 — a guard halts; a warning that does not halt is prose with better timing.

### C22

A carried finding reaches exactly one of three terminal outcomes: `successor-finding` (naming a
finding filed in this store), `ruled-out` (requiring evidence collected in the current session),
`repaired` (requiring a resolving commit **and** an attached evidence row at or after it).

Evidence:
- `mcp-server/src/invariants.ts:422-447` — `requireOverturnEvidence`: "Overturning requires
  evidence, not vibes"; evidence must carry the current `session_id`.
- `dev/adr/0001-living-conspectus-terms.md:46-48` §Verified-fixed — "A code change, a developer
  assertion, or status `fixed` without new evidence is `fixed-pending-verification`, never
  verified-fixed."
- `dev/adr/0001-living-conspectus-terms.md:42-44` §Resolved — a terminal resolution, an
  authorized actor, and resolution evidence or an explicit authorized dismissal.

### C23

ADR-0001's *fully surveyed* predicate gains clause 7: every carried finding has a terminal
outcome. It is enforced at the whole-store predicate, not at `mapped` for the carried finding's
subsystem.

Evidence:
- `dev/adr/0001-living-conspectus-terms.md:19-30` — the six existing clauses.
- `dev/adr/0001-living-conspectus-terms.md:56-60` — the obligation-id table; the new shape is
  `carried:<archived_store_id>:<archived_finding_id>`.
- `README.md` §4 — the undecided question, "Proposed: the predicate".
- `decisions.md` §4.

### C24

`dev/pecia-resolve-finding.mjs` looks up `findings` first, then `carried_findings`: a
`successor-finding` outcome re-runs the lookup against the successor and answers with its state;
`ruled-out` and `repaired` exit 0; an undecided carried record exits 1. Exit codes and the
no-echo rule are unchanged.

Evidence:
- `dev/pecia-resolve-finding.mjs:29` — "Exit codes: 0 resolved · 1 not resolved · 2 cannot run."
- `dev/pecia-resolve-finding.mjs:31-33` — "It deliberately never prints its argument … pecia
  decision pc-cdb8."
- `dev/pecia-resolve-finding.mjs:89-100` — a missing row and a non-terminal state both exit 1
  today, so a destroyed referent and a reopened one are indistinguishable.
- `~/.claude/automations/amanuensis-clean-slate/report.md` — `pecia audit` reported exactly the 8
  closed defects whose reference stopped resolving: `pc-1a91 pc-207e pc-707e pc-80b8 pc-833d
  pc-adce pc-ae87 pc-d688`.

### C25

The six findings the 2026-09-14 rebuild lost are carried retroactively by the acceptance
rebuild's carry step from the archived export, not by writing to the primary checkout's store.

Evidence:
- `decisions.md` §6 — the primary checkout and its rebuilt store are read-only for the lane.
- `old-findings-7c1c1a9.json` holds all six with full text:
  `B03-5 HIGH open`, `B03-6 MEDIUM open`, `B03-7 MEDIUM open`, `B03-8 MEDIUM open`,
  `B04-5 MEDIUM open`, `B07-1 LOW open`.
- `README.md` §1 — "6 archived ones (B03-5, B03-6, B03-7, B03-8, B04-5, B07-1) were neither
  re-found nor ruled out".

### C26

Eight named passages in the skill's references and `SKILL.md` change to state the new refusals in
the server's own words; no sentence describing a surviving behaviour is removed and nothing is
softened.

Evidence:
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

The depth gate's blocking axes are B1 reconciliation standing, B2 examined fraction ≥ 0.5957,
B3 every disposition in a subsystem at `concerns`+ evidence-backed with a resolving `ref_sha`,
B4 every subsystem at `structural`+ discharged or declined, B5 all 13 baseline open findings
carried with a terminal outcome, B6 no undecided carried record.

Evidence:
- `spec.md` §7.3; the 13 ids are C4's list.
- Applied to the candidate as measured, each of B1, B2, B3, B4, B5 is red: 501 unledgered vs 0
  recorded; 13.88 % vs 59.57 %; 177 of 180 unattached; 0 terms and 0 declinations over 8 mapped
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
verdict and every reported axis with its delta, so the comparison is repeatable without the live
store.

Evidence:
- `dev/test-rebuild-depth.mjs:92-98` — the `RECEIPT_CONTRACT` /
  `design/reader-lenses/rebuild-depth-receipt.json` pattern this follows.
- `design/reader-lenses/spec.md:1407-1437` §12.4 — the dogfood gate runs against committed
  artifacts, not the live store.

### C32

Every gate prints `GATE <id> RED: <reason>` or `GATE <id> GREEN` as its single last stdout line,
scrubs launcher crash signatures, names a must-stay-green control, and states in its header the
false green it cannot exclude.

Evidence:
- `mcp-server/test-locus-standing.mjs:1450`, `:1455` — the `GATE P6 RED:` / `GATE P6 GREEN`
  protocol.
- `dev/test-rebuild-depth.mjs:176-201` — the `SCRUB` table, `emit`, `check`.
- `dev/test-rebuild-depth.mjs:68-78` — the "False greens it cannot exclude" header section.
- VP4(f) — "a kill proves a gate *can* fire, never that it fires *selectively*"; every newly
  installed checker ships its must-fail case and a must-stay-green control in the same commit.

### C33

No existing gate, test or read-back axis is weakened. `dev/test-rebuild-depth.mjs` changes only
by reading two hard-coded literals from a declared source instead of from its own body, and its
`a disposition carries no attached evidence` assertion is untouched.

Evidence:
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
