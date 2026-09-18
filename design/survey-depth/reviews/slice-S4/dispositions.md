# slice-S4 fix dispositions

Run `20260918-162853-fix-slice-S4`, one reviewer (codex), ten findings.

Every finding was reproduced or refuted first. The four `gate-cannot-red`
findings all held: each named a gate that never ran the tool or read the
document it was supposed to bind, and each is now sharpened so the reviewer's
own sabotage turns it red. The four `regression-fail` findings split: two are
properties of the review fixture, reproduced in a faithful history-free
snapshot, and two do not reproduce here at all.

| F1 | verified: yes | action: fixed in part, launcher fix staged | reproduced: rebuilt the fixture exactly as run.sh make_snapshot does (git archive HEAD, blinded, one commit, the four snapshot_history fetches) and all five gates exit 1 there — A1 first says `repository_sha 0f7dac6 does not resolve as an ancestor of HEAD`. Cause measured, not inferred: 5 of the 6 revisions the receipts bind to (0f7dac6d, a7f9384d, 3daedc1c, b716a6d1, c0734040) are lane-only commits, and snapshot_history fetches a hard-coded list of four SHAs each gated on `merge-base --is-ancestor <sha> main`, so a lane commit is structurally unfetchable — fetching the lane's past would also un-blind rationale.md and reviews/ at those revisions, which is why it refuses. Repo-side residue repaired: A1 was genuinely red at HEAD here (receipt drifted, see F6) and is re-recorded at e8b0f73. Fixture-side fix staged as run.sh.new for the launcher's install-staged-and-relaunch.sh — snapshot_history is not edited in place because run.sh is the running script. Gates not weakened: no red was converted to a cannot-run |
| F2 | verified: yes | action: fixed | reproduced in the same snapshot: `node dev/test-carry-receipt.mjs` cannot reach `.amanuensis/memory.db` and CR1 reports its cannot-run, exit 2, because make_snapshot copies the tree and never the untracked store. Preserved rather than repaired away: while fixing F5 the new recorder arm turned that exact exit 2 into a red, and it is now guarded behind the store arm (d627ea6) so an absent store stays an absence. The fixture change that supplies a relocatable store rides with F1's staged run.sh.new |
| F3 | verified: yes | action: fixed | reproduced: nothing in dev/, mcp-server/, materializer/ or .github/ reads design/survey-depth/survey-progress.json — it is a P10 deliverable with no reader, so the contract v1→v0 sabotage moves no gate. Both data claims hold too: the store witnesses 5 repaired and 9 successor findings against the census's 4 and 10, and the final row read 350/489 against the receipt's 352/491. GATE P10 now checks the three claims the document makes about itself and leaves the per-batch rows alone, which it says are not re-derivable. red 439ff57 (red on the committed tree), green 49266c6; contract sabotage re-applied and undone: GATE P10 exits 1 naming it |
| F4 | verified: yes | action: fixed | reproduced: dev/test-pecia-carry-audit.mjs contains no spawn of dev/amanuensis-defects-to-pecia.mjs, so the whole `--carry-audit` branch the document cites as its regenerator was unread. PA1 now runs `--carry-audit --markdown` and requires the emitted table to equal the committed one row for row. fixed 8de0ffa; with `if (carryAudit)` disabled at dev/amanuensis-defects-to-pecia.mjs:393 PA1 exits 1 with FAIL [producer], restored it is green on 57 assertions |
| F5 | verified: yes | action: fixed | reproduced: dev/test-carry-receipt.mjs had no spawnSync at all, so dev/record-carry-receipt.mjs was never run by its own gate. CR1 now runs `--check` and keeps its three exit codes distinct. fixed 51d1ea6, guarded d627ea6; with `process.exit(2)` forced into the recorder CR1 exits 1 with FAIL [recorder], restored it is green on 25 assertions |
| F6 | verified: yes | action: fixed | reproduced: dev/test-survey-depth-acceptance.mjs spawns only git, never dev/record-survey-depth.mjs. Sharper than the reviewer's sabotage, the unexercised recorder had already let real drift through — `node dev/record-survey-depth.mjs --check` exited 1 on the committed tree, disagreeing with the live store on `reported` and `reported_deltas`. red a668500, green e8b0f73. `--check` is stable across three consecutive runs over an unchanged store, so the arm is not flaky. A1's binding arm remains red on one unledgered path, below |
| F7 | verified: no | action: rejected | `node dev/test-amanuensis-pecia-defects.mjs` exits 0 here: "8/8 passed". The uv cache failure is a property of the review sandbox's HOME, not of the tree; the reviewer's own note says `UV_CACHE_DIR=/tmp` makes all eight pass. The unchecked-failure-into-ENOENT hardening they propose at line 143 is a fair point about a test's own robustness, but it is not a defect this tree exhibits and no claim or gate binds it |
| F8 | verified: no | action: rejected | `cd materializer && python3 test-search-index.py` exits 0 here with GATE P10 GREEN. The Chromium binary exiting 134 without a debugging endpoint is the review sandbox's browser, not the tree's; AMANUENSIS_TEST_BROWSER already exists for exactly this, which is the configuration the reviewer proposes |
| F9 | verified: yes | action: fixed | reproduced by reading: spec.md §7.4 step 5 said `--carry-from …/old-findings-7c1c1a9.json` while §5.8 step 1, the carry receipt's own note and P8's plan notes all name the archived store opened ?immutable=1 — P8's notes had already recorded step 5 as the stale sentence. Step 5 now names the store and cites §5.8 for why. fixed 57cac81; the three surviving references to the export describe it as an artifact and are accurate. node aggregate-reviews.mjs check-claims: claims ok, 43 claims |
| F10 | verified: yes | action: fixed | reproduced by running it: `node dev/test-rebuild-depth.mjs` exits 2 — 14 P17-denominated arms report the third state, the other 7 including both §8.10 controls hold — so the clause's "SUPERSEDED BY OWNER RULING 2026-09-18: dev/test-rebuild-depth.mjs is GREEN" contradicted both the clause's own first half and the implementation. The true half of the ruling is kept, the GREEN assertion removed and the third state restated. fixed 57cac81; plan-tool validate: plan valid, 12 packets in 4 slices |

## Addendum — run `20260918-165724-fix-slice-S4`

The launcher refused the run above and sent this session back with one
instruction: "The dispositions for slice-S4 are complete and stand. What remains
is that P11's gate is RED at HEAD. Repair that: reproduce it first, and do not
redo the dispositions." No row, verdict or action in the table above is altered
by this addendum; it records only what happened after the table was written.

Reproduced at d206ad7: `node dev/test-survey-depth-acceptance.mjs` exits 1 with
27 of 28 assertions passing and one binding failure — the receipt's ledger
accounts for 647 paths and 649 are tracked, the two unledgered ones being
`design/survey-depth/reviews/slice-S4/codex.md` and this file. F6's row above
ends by noting that A1's binding arm was still red on one unledgered path; that
path was codex.md, and committing this document made it two. So the review's own
two deliverables were what held the gate red — a treadmill the lane has met
before, and P10's notes in `plan.json` record the chain that closes it.

Repaired at 830e752, not by relaxing the inventory but by the route the gate's
message names: both documents recorded in `file_ledger` through
`add_files_to_scope` (B-09, `examined`, their six sibling slice reviews'
`why_in_scope`, both read in full here), `detect_changes` at d206ad7 reconciling
649/649/0/0, the acceptance receipt re-recorded (B2 352/491 → 354/493, every
blocking verdict green), and the three documents that follow the store brought
with it: `survey-progress.json`'s final row, which GATE P10 requires to equal the
receipt's and which went red on the old numbers; the dogfood receipt, through
`materialize_docs(clean_publish=true)` → `dev/promote-docs.mjs` →
`dev/record-dogfood-receipt.mjs`; and the rebuild-depth receipt, which GATE P20
requires to read the same store revision. No tracked path was added or retired:
649 before, 649 after.

GATE A1 GREEN at HEAD. GATE P19 keeps its sanctioned exit-2 third state with
both §8.10 controls, and GATE P20 is back to the same five pre-existing
assertions it was red on before this session.
