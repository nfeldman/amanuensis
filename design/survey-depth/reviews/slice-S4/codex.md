## Findings

| Id | Kind | Location | Severity | Evidence | Proposed fix |
|---|---|---|---|---|---|
| F1 | regression-fail | receipt provenance gates | high | `test-survey-depth`, `test-survey-depth-acceptance`, `test-rebuild-readback`, `test-rebuild-coverage`, and `test-reader-lenses-dogfood` all exit 1 because their recorded revisions are absent from this history-free snapshot | preserve the required commit objects in review snapshots or provide a provenance-aware review fixture |
| F2 | regression-fail | dev/test-carry-receipt.mjs:638 | medium | the exact P8 gate exits 2 because `.amanuensis/memory.db` is absent, despite every packet gate being required to pass | provide the carried store to the review or add an explicit relocatable live-store input |
| F3 | gate-cannot-red | design/survey-depth/survey-progress.json:2 | high | changed its contract from v1 to v0 and GATE P10 still exited 0; the committed file also reports 4 repaired and 10 successors while listing 5 and 9, and its final 350/489 differs from the acceptance receipt’s 352/491 | validate the progress contract and reconcile its final metrics and outcome census against the acceptance receipt |
| F4 | gate-cannot-red | dev/amanuensis-defects-to-pecia.mjs:393 | high | disabled the entire `--carry-audit` branch and GATE P9 still exited 0 | have PA1 invoke `--carry-audit --markdown` against its synthetic inputs and compare the generated accounting |
| F5 | gate-cannot-red | dev/record-carry-receipt.mjs:171 | medium | forced the recorder to exit 2 unconditionally; in a provenance-complete clone with the carried store, GATE P8 remained green | exercise `record-carry-receipt.mjs --check` in CR1’s controlled fixture |
| F6 | gate-cannot-red | dev/record-survey-depth.mjs:101 | medium | forced the acceptance recorder to exit 2 despite an available store; GATE P11 remained green | add a synthetic-store arm that regenerates the receipt and compares it with the validated document |
| F7 | regression-fail | dev/test-amanuensis-pecia-defects.mjs:143 | low | the exact command exits 1 after `pecia init` cannot write the uv cache; the unchecked failure becomes an ENOENT at line 144. Setting `UV_CACHE_DIR` to `/tmp` makes all eight assertions pass | configure a writable uv cache and assert `pecia init` succeeded before writing its configuration |
| F8 | regression-fail | materializer/test-search-index.py:625 | low | `python3 test-search-index.py` exits 1 because the discovered Chromium binary exits 134 without reporting a debugging endpoint | provision a runnable browser for the review sandbox or configure `AMANUENSIS_TEST_BROWSER` explicitly |
| F9 | contract-drift | design/survey-depth/spec.md:1232 | medium | §5.8, C25, the receipt, and the executed carry use the archived immutable store, but §7.4 still requires `old-findings-7c1c1a9.json` | change §7.4 step 5 to the archived store path |
| F10 | contract-drift | design/survey-depth/plan.json:1036 | low | one acceptance clause first requires `test-rebuild-depth` to exit 2, then says the supposedly superseding ruling requires GREEN; the implemented and specified result is exit 2 | remove the stale GREEN clause and retain the documented third-state requirement |

## Notes

P8’s receipt omission, P9’s accounting-row deletion, P10’s B2 reduction, and P11’s contract corruption each turned their core gate red.
All sabotage was restored; the snapshot is clean except for the supplied untracked `REVIEW/` directory.
All other listed regression commands passed.