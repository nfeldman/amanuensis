# Decisions needed

_Questions the survey could not settle on its own. Each records what it blocked and the assumption the survey proceeded with, so a reader can see which readings would change if the assumption turns out wrong. Questions already settled are on [Resolved leads and questions](resolved-leads.md)._

## Contradiction

_3 open questions._

<a id="question-6"></a>
### #6 · subsystem **[B-09](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md)** · phase `refresh`

> survey-progress.json end.obligation_bearing is 496 and matches the acceptance receipt, but end.denominator_note still opens with 'D2 is 493' before explaining final-review growth to 496. Which prose should a later acceptance rerun correct while preserving the historical arithmetic?

- **Assumption the survey proceeded with** — Treat the structured 496 and its matching receipt witness as the historical measured denominator, and retain the stale introductory sentence as a recorded prose discrepancy.
- **Recorded** — 2026-10-07 22:46 UTC.

<a id="question-4"></a>
### #4 · subsystem **[B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)** · phase `refresh`

> The committed Pecia projection closes pc-5465 through amanuensis:B02-R5 from another checkout's store, while this current acceptance-rebuild store's finding inventory has no B02-R5. Where should that reference be resolved for this self-conspectus without inventing a duplicate verified finding?

- **Assumption the survey proceeded with** — Treat the projection's closure as checkout-specific historical evidence. Preserve this store's finding authority and record the discrepancy; do not copy a terminal outcome from the prose into the database.
- **Recorded** — 2026-10-07 22:44 UTC.

<a id="question-2"></a>
### #2 · subsystem **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** · phase `adversarial`

> [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)/[SI-2](concerns.md#si-2) is dispositioned confirmed-acceptable on the rationale that "every revision this surface accepts is resolved at the write and re-resolved at the read", but [SI-2](concerns.md#si-2)'s calibrated probe names the anchor as well as the ref_sha, and finding B03-R5 establishes that an anchor's symbol and line_range are never checked against the file at that revision — 13 of this store's 35 evidence rows point past the end of their own file. Does [SI-2](concerns.md#si-2) on [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) stay confirmed-acceptable with its scope narrowed to the revision half, or become confirmed-bug with B03-R5 as the finding that confirms it?

- **What this blocked** — Nothing. The finding and the measurement are both recorded; only the disposition's classification is left open.
- **Assumption the survey proceeded with** — Left as recorded. B03-R5 is filed as a confirmed bug with its own evidence, and [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)/[SI-2](concerns.md#si-2)'s classification is unchanged: revising a disposition another packet's survey pass recorded is a survey act, and this session is P11, which publishes and records receipts. The next session to survey [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) adjudicates it.
- **Recorded** — 2026-09-18 02:14 UTC.

## Ambiguous evidence

_2 open questions._

<a id="question-5"></a>
### #5 · subsystem **[B-09](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md)** · phase `refresh`

> Historical acceptance/dogfood receipts at a00d6f2 and depth receipt at d206ad7 describe the pre-refresh store, while this refresh adds ledger rows, notes and a verified finding repair. A1's live comparison and depth/regeneration receipts will disagree with the current store. What current acceptance rerun should supersede these receipts without overwriting the frozen P10/P11 experiment or asserting new mapped depth?

- **What this blocked** — Current lane-acceptance claims cannot be inferred from historical green verdict fields.
- **Assumption the survey proceeded with** — Retain the recorded historical receipts and record current refresh evidence separately. Materialization will verify the live projection independently. Do not restamp the historical receipts to conceal drift; the tracked pc-6425 regeneration issue remains unresolved.
- **Recorded** — 2026-10-07 22:46 UTC.

<a id="question-3"></a>
### #3 · subsystem **[B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)** · phase `refresh`

> B05-R1's observed runtime/package version mismatch is absent at beta.3, but its root-cause claim also names the lack of a mechanical version-parity gate. Should this finding be narrowed to that surviving recurrence risk or closed for the concrete mismatch with a successor guard obligation?

- **Assumption the survey proceeded with** — Keep B05-R1 open until an explicit concern re-pass separates the corrected literal from the unimplemented guard; a version bump is not a new parity enforcement mechanism.
- **Recorded** — 2026-10-07 22:44 UTC.

## Scope judgment

_1 open question._

<a id="question-1"></a>
### #1

> Territory T5 (aliasing and ownership) is disqualified for this pass. Does a subsystem's structural pass find one?

- **Assumption the survey proceeded with** — No cross-request shared mutable object is established in this read: every request and response crosses MCP serialization, and residual process-local state is covered by [CR-1](concerns.md#cr-1) and [RL-1](concerns.md#rl-1). Reopen if a subsystem's structural pass finds an alias.
- **Recorded** — 2026-09-15 03:43 UTC.

