# Survey depth: gates that refuse a shallow conspectus

- Status: proposal for a product ruling, 2026-09-14. Nothing here is implemented.
- Baseline: the archived self-conspectus at
  `~/.claude/automations/amanuensis-clean-slate/archive/store-7c1c1a9/memory.db`
  (open read-only with `?immutable=1`), surveyed 2026-08-12 to 2026-08-29 under the
  pre-merge skill. The comparison target: the rebuilt store the clean-slate session
  produced on 2026-09-14 at `~/repos/amanuensis/.amanuensis/memory.db` (`?mode=ro`),
  and its report at `~/.claude/automations/amanuensis-clean-slate/report.md`.
- Source: `main` at `d2b1630`.

## Evidence labels

**[O]** observed in source, a store, or a report, with a reference. **[J]** judgment.

## The problem

A clean-slate rebuild of this repository's own conspectus, run through the merged skill
and gated by the reader-lenses gates, satisfied every gate and produced a record with a
fifth of the previous survey's file coverage, a third of its evidence, no vocabulary, and
six of its thirteen open defects lost. The gates measured structure and never depth, and
the server accepted what the skill's prose forbids.

## 1. What the record shows

| | archived store | rebuilt store |
|---|---:|---:|
| Ledger rows (599 tracked files at `d2b1630`) | 503 | 106 |
| Tracked paths with no ledger row | reconciled by `detect_changes` | 493, never reconciled; overview prints `0` |
| Examined rows | 221 | 84 |
| Evidence rows | 133 | 42 |
| Dispositions | 128 | 180 |
| Dispositions with no attached evidence row | 16 | 177 |
| Field notes | 36 | 6 |
| Open questions | 16 | 5 |
| Vocabulary terms | 4 | 0 |
| Seams | 10 | 10 |
| Subsystem narrative artifacts | 47 KB | 31 KB |
| Structural claims / edges / challenge outcomes | 0 / 1 / 0 | 39 / 13 / 39 |
| Open findings | 13 | 14, of which 2 re-find archived ones, 5 archived ones were repaired by the merge, and 6 archived ones (B03-5, B03-6, B03-7, B03-8, B04-5, B07-1) were neither re-found nor ruled out |

- **[O]** `set_disposition` requires an `evidence` string and `evidence_quality`, not an
  attached row; `disposition_evidence` is written only by `attach_evidence_to_disposition`
  (`mcp-server/src/tools/dispositions.ts`, `mcp-server/src/tools/evidence.ts`). 177 of 180
  rebuilt dispositions have no attached row. `dev/test-rebuild-depth.mjs` reported it
  ("B-02/AL-1 carries no attached evidence row, so the concern was answered from nothing")
  and the clean-slate report attributed the gate's red to hard-coded identifiers.
- **[O]** Nothing requires scope reconciliation before `mapped` or before publication.
  `scope_gaps` is empty in the rebuilt store; `git_state.last_checked_sha` equals the
  onboarding revision; the published overview line "Paths in scope with no ledger row"
  reads `0` because its query counts rows of an empty table. The archived store's open
  finding B03-5 describes this and the rebuild reproduced it.
- **[O]** Vocabulary is Phase 2 step 7 in `references/phase-2-structural.md` and appears in
  no status gate, no tool precondition, and no rebuild gate. Both stores are effectively
  without it; the archived store's four terms come from a design-panel pass.
- **[O]** `dev/rebuild-self-conspectus-store.mjs` snapshots and deletes the store. No
  record type carries a prior finding forward; the ledger's `amanuensis:<id>` references for
  the six lost findings resolve to nothing and `pecia audit` flags only closed records
  (rebuilt store finding B03-R2; the reference gap is B03-R1).
- **[O]** The reader-lenses gates that certified the rebuild (`test-rebuild-coverage`,
  `test-rebuild-readback`, `test-reader-lenses-dogfood`) assert claims, edges, outcomes,
  receipts, and read-back; none asserts examined fraction, evidence per disposition,
  vocabulary, or the fate of prior findings. The session finished in 98 minutes of a
  300-minute budget having satisfied all of them.

## 2. Diagnosis [J]

The survey's depth was held up by prose the sessions happened to follow, and the merged
work added gates for the new record types without adding any for the old ones. The moment
a session optimized for the gates, depth fell to what the gates required. Restoring the
archive would restore the data and leave the route able to lose it again.

## 3. Proposal: depth obligations in the substrate, the archive as the yardstick

Every rule below lives in the server or in a gate, never only in the skill, and each has a
named red condition. The archived store is not restored; it is the baseline a rebuild
must dominate.

1. **Evidence-backed dispositions.** A status advance to `concerns` or beyond refuses any
   disposition for that subsystem without at least one attached evidence row whose
   `ref_sha` resolves; `set_disposition` accepts evidence ids and attaches them in the
   same transaction so the common path cannot skip the attachment.
2. **Scope reconciliation before authority.** `mapped` and `materialize_docs` refuse a
   store whose `scope_gaps` was not recorded by `detect_changes` at the checked revision;
   the overview's unledgered count prints "not measured" when there is no denominator,
   the same way staleness already does.
3. **Vocabulary: discharge or decline.** Phase 2 must either define at least one term
   with a resolvable `first_seen` anchor for the subsystem or record an explicit
   no-domain-vocabulary declaration with a reason; the status advance to `structural`
   refuses a subsystem that has done neither. No numeric floor: a floor is a generative
   field that gets filled to order.
4. **Findings carry forward.** A reinitialization records every prior finding as a
   carried, unverified obligation in the new store, with its archived identity and text;
   the store cannot reach fully surveyed while any carried finding is neither re-found
   (successor finding), ruled out with evidence, nor marked repaired at a named commit.
   Pecia references resolve through the carried record until a successor exists.
5. **Depth gate against the baseline.** `dev/test-survey-depth.mjs` reads the archived
   store as the baseline and the live store as the candidate and turns red unless the
   candidate meets or exceeds the baseline on examined rows, examined fraction of
   obligation-bearing rows, evidence rows, evidence rows per disposition, field notes,
   and vocabulary terms, and accounts for every baseline open finding. The baseline is
   frozen; the comparison is the acceptance for any future rebuild of this repository.
6. **Skill parity.** The phase references say what the server now refuses, in the same
   words, so the prose and the substrate cannot drift apart; a check compares them.

Acceptance for this lane: with the gates in place, a fresh clean-slate rebuild of this
repository in the lane's worktree turns the depth gate green against the archived
baseline, and the four defects above are filed and closed with red proofs.

## 4. Not decided here

- Whether a carried finding blocks `mapped` for its subsystem or only the fully-surveyed
  predicate. Proposed: the predicate, so a rebuild can progress subsystem by subsystem.
- Whether AxiomDB's store, which has a legacy shape, gets the same obligations on its next
  refresh or a grace path. Proposed: the same obligations; a refresh that cannot meet
  them reports red rather than publishing.
