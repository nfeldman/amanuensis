# **B-09** — Conspectus design lanes, their drivers and receipts

**Status**: ⚪ unmapped  
**Layer**: Design evidence

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

design/reader-lenses/**, design/survey-depth/**, and the dev/ drivers, gates and receipts those lanes own

### Survey note

*A note the survey left on the subsystem record; not bound to a revision.*

New at this rebuild. The archived conspectus had no such subsystem: the two lanes and their receipt-bound gates are work that landed after it was frozen, and they are where a gate's denominator can quietly come from the document under test.

## Start here

design/survey-depth/spec.md; dev/rebuild-self-conspectus-store.mjs; dev/test-survey-depth.mjs

## Structure

### Structural inventory not recorded as claims

No structural claim is recorded for this subsystem, and no narrative was left in its place.

## Vocabulary

**Domain vocabulary** — not recorded. Neither a term nor a declination has been recorded for this subsystem, so nobody has answered the question either way.

## Known defects here

No defect here is open or awaiting verification.

## Standing

**Unmapped** — This subsystem has not yet been surveyed; no architectural claims are authorized. It cannot justify any claim about this subsystem's behavior.

| Metric | Value |
|---|---|
| Files read | 96 of 105 ledger rows |
| Files in scope, not yet read | 9 of 105 |
| Files excluded from the survey obligation | 0 of 105 |
| Ledger rows the repository has changed under | 11 of 105 |
| Active concerns with a disposition recorded here | 0 of 12 |
| Findings by resolution state | none recorded |
| Seams assessable from both sides | no seam names this subsystem |

## Survey record

### File ledger

- **The explanation design lane: its proposal. Assigned by convention; not read in full.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-3a68f82efd"></a>`design/explanation/README.md`
- **The explanation design lane: its numbered claims. Assigned by convention; only EX8's claims were read.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-6fab54381b"></a>`design/explanation/claims.md`
- **The explanation design lane: its packet plan. Assigned by convention; only EX8's packet was read.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-30d525190a"></a>`design/explanation/plan.json`
- **The explanation design lane: the plan's generated view. Assigned by convention; not read in full.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-eba87f941c"></a>`design/explanation/plan.md`
- **The explanation design lane: its rationale. Assigned by convention; not read.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-17f06e9831"></a>`design/explanation/rationale.md`
- **The explanation design lane: its specification. Assigned by convention; only §0, §1, §2.5 and §4 were read.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-c01279b2e5"></a>`design/explanation/spec.md`
- **The explanation design lane: the reader-prose measure. Assigned by convention; not read in full.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-fc70d18aa7"></a>`dev/measure-reader-prose.mjs`
- **The explanation design lane: GATE EX1. Assigned by convention; not read.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-da2e4fc91d"></a>`dev/test-reader-measure.mjs`
- **The explanation design lane: GATE EX7. Assigned by convention; only its header was read.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-8483b626be"></a>`dev/test-republish-chain.mjs`
- **The explanation design lane: the owner decisions binding its specification. Read in full by EX8.** — examined, 1 file, examined at `2ceb0d2d`
    - <a id="le-4e216ccb8a"></a>`design/explanation/decisions.md`
- **The explanation design lane: the reader-prose measure the republish chain records. Read in full by EX8.** — examined, 1 file, examined at `2ceb0d2d`
    - <a id="le-1983f2c503"></a>`design/explanation/reader-measure.json`
- **The explanation design lane: EX8's record of its carried decisions. Written by EX8.** — examined, 1 file, examined at `2ceb0d2d`
    - <a id="le-240f2f6ee3"></a>`design/explanation/restore-progress.json`
- **The explanation design lane: the unfilled-slot census the republish chain records. Read in full by EX8.** — examined, 1 file, examined at `2ceb0d2d`
    - <a id="le-48cad7d0c0"></a>`design/explanation/unfilled-slots.json`
- **A conspectus design lane: its specification, claims, plan and receipts.** — examined, 83 files, examined at 4 revisions
    - <a id="le-690e486f82"></a>`design/reader-lenses/README.md` (`410d769b`)
    - <a id="le-4a9c0cf082"></a>`design/reader-lenses/claims.md` (`410d769b`)
    - <a id="le-ab915669bd"></a>`design/reader-lenses/decisions.md` (`410d769b`)
    - <a id="le-7b31fa9aaf"></a>`design/reader-lenses/dogfood-receipt.json` (`a521e28`)
    - <a id="le-0f51417254"></a>`design/reader-lenses/plan.json` (`410d769b`)
    - <a id="le-1d4eb2da4b"></a>`design/reader-lenses/plan.md` (`410d769b`)
    - <a id="le-3ef3a34be9"></a>`design/reader-lenses/rationale.md` (`410d769b`)
    - <a id="le-892016c673"></a>`design/reader-lenses/rebuild-coverage-receipt.json` (`410d769b`)
    - <a id="le-9ca20a5dd5"></a>`design/reader-lenses/rebuild-depth-receipt.json` (`a521e28`)
    - <a id="le-c9ff6af776"></a>`design/reader-lenses/rebuild-receipt.json` (`410d769b`)
    - <a id="le-d0388e4856"></a>`design/reader-lenses/reviews/final/claude.md` (`410d769b`)
    - <a id="le-4b95c50a58"></a>`design/reader-lenses/reviews/final/codex.md` (`410d769b`)
    - <a id="le-ee7170779a"></a>`design/reader-lenses/reviews/final/dispositions.md` (`410d769b`)
    - <a id="le-4cd0b838e1"></a>`design/reader-lenses/reviews/round-1/aggregate.json` (`410d769b`)
    - <a id="le-b4bbb225e9"></a>`design/reader-lenses/reviews/round-1/aggregate.md` (`410d769b`)
    - <a id="le-840ade95fb"></a>`design/reader-lenses/reviews/round-1/claude.md` (`410d769b`)
    - <a id="le-381d00758c"></a>`design/reader-lenses/reviews/round-1/codex.md` (`410d769b`)
    - <a id="le-ade6e5f633"></a>`design/reader-lenses/reviews/round-1/dispositions.md` (`410d769b`)
    - <a id="le-daa923a3da"></a>`design/reader-lenses/reviews/slice-S1/codex.md` (`410d769b`)
    - <a id="le-964e78cd9c"></a>`design/reader-lenses/reviews/slice-S1/dispositions.md` (`410d769b`)
    - <a id="le-90f5bbaa42"></a>`design/reader-lenses/reviews/slice-S2/codex.md` (`410d769b`)
    - <a id="le-fd373a6048"></a>`design/reader-lenses/reviews/slice-S2/dispositions.md` (`410d769b`)
    - <a id="le-38684b56ed"></a>`design/reader-lenses/reviews/slice-S3/codex.md` (`410d769b`)
    - <a id="le-dc36e5655b"></a>`design/reader-lenses/reviews/slice-S3/dispositions.md` (`410d769b`)
    - <a id="le-bfa2ab8512"></a>`design/reader-lenses/reviews/slice-S4/codex.md` (`410d769b`)
    - <a id="le-8f0497e7c7"></a>`design/reader-lenses/reviews/slice-S4/dispositions.md` (`410d769b`)
    - <a id="le-d1c1c215bd"></a>`design/reader-lenses/reviews/slice-S5/codex.md` (`410d769b`)
    - <a id="le-929d9f681f"></a>`design/reader-lenses/reviews/slice-S5/dispositions.md` (`410d769b`)
    - <a id="le-53d989af76"></a>`design/reader-lenses/reviews/slice-S6/codex.md` (`410d769b`)
    - <a id="le-24f7d0900c"></a>`design/reader-lenses/reviews/slice-S6/dispositions.md` (`410d769b`)
    - <a id="le-9e9bc452b0"></a>`design/reader-lenses/reviews/slice-S7/codex.md` (`410d769b`)
    - <a id="le-4475a3b5de"></a>`design/reader-lenses/reviews/slice-S7/dispositions.md` (`410d769b`)
    - <a id="le-e0d05cb44f"></a>`design/reader-lenses/routing-measurement.md` (`410d769b`)
    - <a id="le-f304a526b3"></a>`design/reader-lenses/spec.md` (`410d769b`)
    - <a id="le-92ad4fdec8"></a>`design/survey-depth/README.md` (`410d769b`)
    - <a id="le-bc6c74cb20"></a>`design/survey-depth/carry-receipt.json` (`410d769b`)
    - <a id="le-e0bd10291f"></a>`design/survey-depth/claims.md` (`a521e28`)
    - <a id="le-802b1b0aaf"></a>`design/survey-depth/decisions.md` (`410d769b`)
    - <a id="le-89f5e01e40"></a>`design/survey-depth/plan.json` (`a521e28`)
    - <a id="le-95d5a2b2b2"></a>`design/survey-depth/plan.md` (`a521e28`)
    - <a id="le-e7e5969f8c"></a>`design/survey-depth/rationale.md` (`410d769b`)
    - <a id="le-21ea97679c"></a>`design/survey-depth/rebuild-receipt.json` (`410d769b`)
    - <a id="le-3787d97e6e"></a>`design/survey-depth/reviews/round-1/aggregate.json` (`410d769b`)
    - <a id="le-9ac4fd66b4"></a>`design/survey-depth/reviews/round-1/aggregate.md` (`410d769b`)
    - <a id="le-b24142f86b"></a>`design/survey-depth/reviews/round-1/claude.md` (`410d769b`)
    - <a id="le-f1b6d7b0ed"></a>`design/survey-depth/reviews/round-1/codex.md` (`410d769b`)
    - <a id="le-d7fe5ee61a"></a>`design/survey-depth/reviews/round-1/dispositions.md` (`410d769b`)
    - <a id="le-ebc7ff85f8"></a>`design/survey-depth/reviews/slice-S1/codex.md` (`410d769b`)
    - <a id="le-8feffc458e"></a>`design/survey-depth/reviews/slice-S1/dispositions.md` (`410d769b`)
    - <a id="le-dea29ee379"></a>`design/survey-depth/reviews/slice-S2/codex.md` (`410d769b`)
    - <a id="le-629adfd86f"></a>`design/survey-depth/reviews/slice-S2/dispositions.md` (`410d769b`)
    - <a id="le-88e6a86ef3"></a>`design/survey-depth/reviews/slice-S3/codex.md` (`410d769b`)
    - <a id="le-fb33b7c53a"></a>`design/survey-depth/reviews/slice-S3/dispositions.md` (`410d769b`)
    - <a id="le-a29c6b0df6"></a>`design/survey-depth/reviews/slice-S4/codex.md` (`d206ad78`)
    - <a id="le-192228c4a7"></a>`design/survey-depth/reviews/slice-S4/dispositions.md` (`a521e28`)
    - <a id="le-f469616995"></a>`design/survey-depth/spec.md` (`a521e28`)
    - <a id="le-38775e2be7"></a>`dev/amanuensis-defects-to-pecia.mjs` (`a521e28`)
    - <a id="le-3e8a090b9f"></a>`dev/check-living-conspectus.mjs` (`410d769b`)
    - <a id="le-b5d08669c0"></a>`dev/check-store-fully-surveyed.mjs` (`410d769b`)
    - <a id="le-8cb883ab88"></a>`dev/cross-domain-analysis.md` (`410d769b`)
    - <a id="le-d791a42994"></a>`dev/pecia-dogfood.md` (`a521e28`)
    - <a id="le-3b63b6976b"></a>`dev/pecia-resolve-finding.mjs` (`410d769b`)
    - <a id="le-5d75a6f9dd"></a>`dev/practice-catalog-v2.10.json` (`410d769b`)
    - <a id="le-794116670e"></a>`dev/promote-docs.mjs` (`ec5824bc`)
    - <a id="le-86d43358bb"></a>`dev/rebuild-self-conspectus-store.mjs` (`410d769b`)
    - <a id="le-dce270267d"></a>`dev/receipt-provenance.mjs` (`410d769b`)
    - <a id="le-e97538ef7b"></a>`dev/record-carry-receipt.mjs` (`410d769b`)
    - <a id="le-eaca72f560"></a>`dev/record-dogfood-receipt.mjs` (`410d769b`)
    - <a id="le-dd3068b5a3"></a>`dev/record-rebuild-coverage.mjs` (`410d769b`)
    - <a id="le-2652d460a0"></a>`dev/record-rebuild-depth.mjs` (`a521e28`)
    - <a id="le-ab53457431"></a>`dev/record-regeneration-pass.mjs` (`410d769b`)
    - <a id="le-31a0f96336"></a>`dev/record-survey-depth-baseline.mjs` (`410d769b`)
    - <a id="le-7f4b01c7c8"></a>`dev/test-carried-finding-references.mjs` (`410d769b`)
    - <a id="le-f058f32538"></a>`dev/test-carry-receipt.mjs` (`a521e28`)
    - <a id="le-e4f7ba87b8"></a>`dev/test-living-conspectus.mjs` (`410d769b`)
    - <a id="le-2a2a8e0044"></a>`dev/test-pecia-carry-audit.mjs` (`a521e28`)
    - <a id="le-c925375dc4"></a>`dev/test-reader-lenses-dogfood.mjs` (`410d769b`)
    - <a id="le-a9b5120e35"></a>`dev/test-rebuild-coverage.mjs` (`410d769b`)
    - <a id="le-57cf1f04ed"></a>`dev/test-rebuild-depth.mjs` (`a521e28`)
    - <a id="le-6f19c9b5b9"></a>`dev/test-rebuild-readback.mjs` (`410d769b`)
    - <a id="le-667ac80609"></a>`dev/test-rebuild-regeneration.mjs` (`410d769b`)
    - <a id="le-15017aefd5"></a>`dev/test-survey-depth-red-gates.mjs` (`410d769b`)
    - <a id="le-8b5483aac6"></a>`dev/test-survey-depth.mjs` (`a521e28`)
- **This packet's own candidate witness: the row-level B1-B6 witnesses §7.5 requires, written by dev/record-survey-depth.mjs and recomputed by GATE D0 where no live store exists.** — examined, 1 file, examined at `a521e28`
    - <a id="le-9739de6901"></a>`design/survey-depth/acceptance-receipt.json`
- **The final whole-branch review by reviewer claude: two findings plus the notes that independently read P8, P10 and P11's failures as review-snapshot artifacts. Read in full by the fix session that dispositioned both.** — examined, 1 file, examined at `c82ceaac`
    - <a id="le-09eef34ad1"></a>`design/survey-depth/reviews/final/claude.md`
- **The final whole-branch review by reviewer codex: nine findings over the twelve landed packets, each with the command or reading that produced it. Read in full by the fix session that dispositioned all nine.** — examined, 1 file, examined at `c82ceaac`
    - <a id="le-aab796800d"></a>`design/survey-depth/reviews/final/codex.md`
- **This lane's disposition of all eleven final findings: seven fixed with red proofs, three rejected as the reviewer's environment rather than the tree's behaviour, one deferred. Written by the fix session that verified each one at HEAD.** — examined, 1 file, examined at `a521e28`
    - <a id="le-9e35b5f600"></a>`design/survey-depth/reviews/final/dispositions.md`
- **This packet's batching record: which subsystems were surveyed in which batch, behind which storage checkpoint, and what each batch left the depth measures at.** — examined, 1 file, examined at `a521e28`
    - <a id="le-72e7b4c603"></a>`design/survey-depth/survey-progress.json`
- **The receipt writer: it refuses to write a witness whose recorded digests do not re-derive from the tree and the ledger, and --check compares the committed receipt against the live store.** — examined, 1 file, examined at `a521e28`
    - <a id="le-ca0bbfc242"></a>`dev/record-survey-depth.mjs`
- **The explanation design lane: the republish chain as one command. Read in full by EX8.** — examined, 1 file, examined at `2ceb0d2d`
    - <a id="le-4e40681559"></a>`dev/republish-docs.mjs`
- **The explanation design lane: GATE EX8. Written by EX8.** — examined, 1 file, examined at `2ceb0d2d`
    - <a id="le-221135d5c6"></a>`dev/test-receipt-gates-restored.mjs`
- **GATE A1 of the survey-depth lane (spec.md §8.8): it recomputes every blocking predicate of the acceptance receipt from the row-level witnesses §7.5 requires, and carries §8.8's control — the committed receipt validates, two seeded forged-green copies of it do not. A lane gate and its receipt-recomputation belong with the other lane drivers and receipts this subsystem owns.** — examined, 1 file, examined at `a521e28`
    - <a id="le-5c70b9a90e"></a>`dev/test-survey-depth-acceptance.mjs`

### Concern review

No concern has been dispositioned in this subsystem.
