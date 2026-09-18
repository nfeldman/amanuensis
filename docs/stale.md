# Stale knowledge

8 of 490 files carrying a survey obligation are recorded as changed since the revision the ledger names, checked at `e2382dc3cb7c` on `main`. 0 of 154 scoped files exempt from that obligation have also changed; they are counted on the [overview](index.md) and are not recorded here, because drift in generated or vendored territory is not survey staleness.

## Examined files the repository has changed under

8 of 351 examined files have changed since the revision they were read at.

| File | Owner | Read at | Drift recorded | Reason | Why in scope |
|---|---|---|---|---|---|
<!-- amanuensis:ledger-stale:91903b73afbdd825a9cb4ed734706c3fbc8f19377f94519a8c95be55504fce8c -->
| <a id="ls-91903b73af"></a>`.github/workflows/test.yml` | [Packaging, installer, validation, and product docs](subsystems/b05-packaging-installer-validation-and-product-docs.md) | `c0734040` | 2026-09-18 01:47 UTC | git-drift | The CI registration of every gate this lane ships, including GATE D0's three-state block and GATE D1 beside it. |
<!-- amanuensis:ledger-stale:b01863459874479c4a7067c7648df567293d6ba694ead5b6d3aa27babacf1646 -->
| <a id="ls-b018634598"></a>`design/reader-lenses/rebuild-depth-receipt.json` | [Conspectus design lanes, their drivers and receipts](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md) | `410d769b` | 2026-09-18 01:47 UTC | git-drift | A conspectus design lane: its specification, claims, plan and receipts. |
<!-- amanuensis:ledger-stale:c173f9183f78f66b53e459ea2a651222f3df69bfa975a016c20890b6800ddf61 -->
| <a id="ls-c173f9183f"></a>`design/survey-depth/acceptance-receipt.json` | [Conspectus design lanes, their drivers and receipts](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md) | `081e12ed` | 2026-09-18 01:15 UTC | git-drift | This packet's own candidate witness: the row-level B1-B6 witnesses §7.5 requires, written by dev/record-survey-depth.mjs and recomputed by GATE D0 where no live store exists. |
<!-- amanuensis:ledger-stale:4d2e5241472fa6fb4a0f965b4aa99243f811c02224434e98b46b240cf44ece0c -->
| <a id="ls-4d2e524147"></a>`design/survey-depth/plan.json` | [Conspectus design lanes, their drivers and receipts](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md) | `410d769b` | 2026-09-18 01:24 UTC | git-drift | A conspectus design lane: its specification, claims, plan and receipts. |
<!-- amanuensis:ledger-stale:36ea48edadf9cd35852bb7ea41603810eb15768a0575eb71e232bf567442042c -->
| <a id="ls-36ea48edad"></a>`design/survey-depth/plan.md` | [Conspectus design lanes, their drivers and receipts](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md) | `410d769b` | 2026-09-18 01:47 UTC | git-drift | A conspectus design lane: its specification, claims, plan and receipts. |
<!-- amanuensis:ledger-stale:d2a78918559128dc0ada7479fd9e245b12de2ce6aa4c3d8e5ab3deeb095916a6 -->
| <a id="ls-d2a7891855"></a>`design/survey-depth/survey-progress.json` | [Conspectus design lanes, their drivers and receipts](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md) | `081e12ed` | 2026-09-18 01:15 UTC | git-drift | This packet's batching record: which subsystems were surveyed in which batch, behind which storage checkpoint, and what each batch left the depth measures at. |
<!-- amanuensis:ledger-stale:898a43df4442e963e3a60f05472c390516816bd2adb3a7ad74ee0ac051b7582f -->
| <a id="ls-898a43df44"></a>`dev/record-survey-depth.mjs` | [Conspectus design lanes, their drivers and receipts](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md) | `081e12ed` | 2026-09-18 01:47 UTC | git-drift | The receipt writer: it refuses to write a witness whose recorded digests do not re-derive from the tree and the ledger, and --check compares the committed receipt against the live store. |
<!-- amanuensis:ledger-stale:e798be622ab837d5f558fc4ee82131c9e23a6f90dc27207f270b4c411c7e720b -->
| <a id="ls-e798be622a"></a>`dev/test-rebuild-depth.mjs` | [Conspectus design lanes, their drivers and receipts](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md) | `410d769b` | 2026-09-18 01:47 UTC | git-drift | A conspectus design lane: its specification, claims, plan and receipts. |

## Scoped but unread, and changed since scoping

0 of 139 files in scope but not yet read have changed since they were scoped.

## Deferred files that changed after they were set aside

No file in this ledger is deferred with a recorded reason.

