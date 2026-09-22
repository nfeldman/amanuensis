# Fix dispositions — slice-S3 (packet P7, skill parity and its check)

Run `20260914-230354-fix-slice-S3`, branch `survey-depth`. One reviewer, codex; six
findings. Three reproduced and are repaired with red proofs; three are failures of the
review snapshot rather than of the tree, and did not reproduce here.

| Id | Verified | Action | Detail |
|---|---|---|---|
| F1/codex | verified: yes | action: fixed | reproduced: with `serverSources()` narrowed to `src/invariants.ts` (`if (false && existsSync(dir))` at check-refusal-parity.mjs:314) all 22 assertions passed and the gate printed `GATE P7 GREEN`. A6 and every other arm injected into invariants.ts, so the half of the derivation that reads the handlers was unwatched. A12 (test-refusal-parity.mjs) injects an unregistered `cannot advance` into the fixture's `src/tools/probe.ts` and requires the derived scan to name it; the fixture's tools now carry a real definition and handler. Re-applied the reviewer's sabotage locally: A12 fails, `GATE P7 RED`, 1 of 26; undone, green again. red 32f233f, green 1c23f3c |
| F2/codex | verified: yes | action: fixed | reproduced: replacing the `decline_domain_vocabulary` mapping with `hot_spots` left `GATE P7 GREEN`; the bare `name:` scan read 220 names where tools/list advertises 209, the eleven extras being response-section fields (`hot_spots`, `leads`, `stale`, `claims`, `sessions` and six more). `advertisedTools()` now reads the description/inputSchema pair gen-tool-inventory.mjs:44 reads and the counts agree at 209. A13 registers the fixture's response field, G6 counts the fixture's tools, C5 compares the checker's set against the inventory rendered from a live tools/list; all three failed before the fix. Re-applied the sabotage: G2 fails naming the entry and the name, `GATE P7 RED`; undone, green. red 32f233f, green 1c23f3c |
| F3/codex | verified: yes | action: fixed | reproduced: refusal-parity.json:141 named `start_session`, whose handler at tools/project.ts:46 calls `startSession` and never `requireActiveSession`, while `define_term` at vocabulary.ts:87 does and was absent; checker line 390 tested only that the name was advertised. Six entries carried repair tools the same way (set_disposition, attach_evidence_to_disposition, invalidate_claim, supersede_claim, decline_domain_vocabulary, detect_changes). `tools` is replaced by `refuses` and `instructs`, and assertion 5 checks each name against the source in both directions — the handler, whatever it calls or names, and the tool's own definition. All 16 entries realigned; the union is still what the reference-side scan searches. A14, A15 and A16 are the arms; restoring the instance makes the checker report it by entry and tool. red 04919d8, green f50ac2d |
| F4/codex | verified: no | action: rejected | `node dev/test-rebuild-readback.mjs` exits 0 here (`GATE P16 GREEN`), and `git cat-file -t 7c1c1a9f5689d396487072d012abe6fafd5f348c` resolves to a commit in this worktree. The failure is the review snapshot's: it is built by `git archive HEAD` and carries one commit. run.sh:243 `snapshot_history` already fetches this exact sha for the slice-S1 instance of the same finding and logged no warning for this run, so the gap is in that path, not in the tree under review. No provenance assertion was weakened |
| F5/codex | verified: no | action: rejected | `node dev/test-rebuild-coverage.mjs` exits 0 here (`GATE P17 GREEN`); `7c1c1a9f5689d396487072d012abe6fafd5f348c`, `7c1c1a9` and `dee59d3e019a6747af714aa5a44acbb774ff6d5f` all resolve under `git cat-file -t`. Same cause and same location as F4 |
| F6/codex | verified: no | action: rejected | `node dev/test-reader-lenses-dogfood.mjs` exits 0 here (`GATE P18 GREEN`); `d6dd4215768038a543b4a5c561d7159b21fa1431` resolves under `git cat-file -t`. Same cause and same location as F4 |

## What was run

Every regression command in P7's list, after the last fix: 17 of 17 exit 0, including
`gen-tool-inventory.mjs --check`, `check-tool-schemas.mjs`, `check-evidence-vocabulary.mjs`,
`biome check src/`, `npm run build`, the three receipt-bound rebuild gates F4–F6 name, and
`test-refusal-parity.mjs` itself. `scripts/check-refusal-parity.mjs` exits 0 over the
repository: 16 registered refusals, 209 advertised tools, an empty derived candidate set.
GATE P7 is green at 29 assertions, up from 22.

## What the fixes do not buy

`refuses` is held to being true, not to being complete. About fifty handlers call
`requireActiveSession`, and a register that enumerated them would oblige every reference
naming any of the fifty to quote the sentence; the derived scan is what covers a refusal no
entry carries at all. The call graph is lexical and module-scoped: a refusal reached through
a name bound inside another function is invisible to it, which is deliberate — following
such names let three repair tools appear to state refusals they never say, and this register
caught it before the realignment was committed.
