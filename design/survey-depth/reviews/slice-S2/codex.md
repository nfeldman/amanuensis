## Findings

| Id | Kind | Location | Severity | Evidence | Proposed fix |
|---|---|---|---|---|---|
| F1 | gate-cannot-red | dev/test-survey-depth-red-gates.mjs:1085 | high | In a full-history disposable clone, disabled the receipt arm’s B6 refusal in dev/test-survey-depth.mjs:1046; `node dev/test-survey-depth-red-gates.mjs` still exited 0 | Add a receipt-only B6 seed with an undecided carried witness and require D0 to name B6 |
| F2 | claim-unmet | C29 / dev/test-survey-depth.mjs:943 | high | Replaced the receipt’s B3 disposition witnesses with an empty array; D0 printed `GATE D0 GREEN` because completeness is never checked | Require unique per-disposition witnesses and reconcile their count with an independently recorded disposition census |
| F3 | claim-unmet | C29 / dev/test-survey-depth.mjs:868 | high | Replaced the B1 witness’s `ledger_digest` with 64 zeroes; D0 still printed green because the receipt arm never reads that field | Carry ledger path/classification witnesses and recompute the digest, unledgered count, and absent count |
| F4 | claim-unmet | C14 / materializer/amanuensis_materializer/readback.py:341 | high | Pointed a reconciled fixture’s `workspace_path` at a nonexistent directory; clean publication and read-back stayed green and printed `2 of 5` instead of `not measured` | Treat an unavailable or unresolvable tree as non-standing; require condition 4 of spec §3.3 |
| F5 | claim-unmet | C14 / materializer/amanuensis_materializer/renderers.py:636 | medium | An unreconciled fixture published `Files carrying a survey obligation marked stale: 0 of 3`, while the same page correctly withheld the other coverage rows; read-back remained green | Derive this denominator from the standing reconciliation or render the same revision-and-reason `not measured` state |
| F6 | claim-unmet | C18 / materializer/amanuensis_materializer/renderers.py:2278 | medium | Set a term’s `first_seen` to `not-a-citation` while retaining a valid declination; publication stayed green and rendered the term as current with the declination as superseded | Classify `terms` only when at least one scoped anchor parses, resolves, and names a path in that revision |
| F7 | defect | materializer/amanuensis_materializer/readback.py:1280 | medium | Changed the published files-read value from `2 of 5` to `999 of 5`; read-back returned coverage green with no coverage mismatch | Recompute and compare the exact numerator and denominator instead of checking only for the denominator substring |
| F8 | defect | dev/test-survey-depth-red-gates.mjs:663 | high | In the required history-free snapshot, `node dev/test-survey-depth-red-gates.mjs` exited 1 with 22 failures because baseline SHA `61bc6b5…` is not an ancestor of the synthetic snapshot HEAD | Make D1 self-contained with a resolvable synthetic baseline anchor rather than depending on the review checkout’s ancestry |
| F9 | regression-fail | P5 and P6 regression commands | medium | `check-living-conspectus`, `test-rebuild-readback`, `test-rebuild-coverage`, and `test-reader-lenses-dogfood` exited 1; baseline `--check` exited 2 because recorded revisions do not exist in this history-free snapshot | Preserve the required commit graph in review snapshots or make provenance checks recognize truncated history consistently |
| F10 | regression-fail | materializer/test-search-index.py | low | The listed regression exited 1: `the browser never reported a debugging endpoint` | Make browser startup deterministic in the test environment or report the browser arm as explicitly unevaluated when unavailable |

## Notes

PM1 passed untouched and turned red after `_tracked_paths` was sabotaged to collapse `None` into zero.
P5 passed untouched in the byte-identical full-history lane worktree, isolating F8 to snapshot ancestry.
All other listed regressions passed.
AxiomDB read-only checks confirmed 35 deferred paths, 166 dispositions, and 54 unattached dispositions.
All sabotages were restored; only the supplied untracked `REVIEW/` directory remains.