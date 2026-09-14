## Findings

| Id | Kind | Location | Severity | Evidence | Proposed fix |
|---|---|---|---|---|---|
| F1 | claim-unmet | C6 / mcp-server/src/helpers.ts:114 | high | After `add_evidence` cached a full SHA, resetting and pruning that commit made `git rev-parse` exit 128; a second `add_evidence` still returned `ok` and stored another row at the now-unresolvable SHA | Remove the cross-call cache or revalidate cached commits before every durable write |
| F2 | gate-cannot-red | mcp-server/test-residual-hardening.mjs:556 | medium | Inverted `get_finding_summary` at findings.ts:475 to count `NOT (OPEN_FINDING_SQL)`; the P21 gate still printed `GATE P21 GREEN` | Exercise `get_finding_summary` on the divergent fixture and reconcile its `open_bugs` total |
| F3 | gate-cannot-red | mcp-server/test-residual-hardening.mjs:726 | medium | Added out-of-source category `bogus` to open-questions.ts; both P21 and `test-vocabulary-source.mjs` remained green | Discover all contract-bound validators or explicitly probe open-question, contradiction, diagnosticity, and subsystem-status validators |
| F4 | claim-unmet | C48 / mcp-server/src/tools/open-questions.ts:11 | medium | Spec §10.2 requires generated enum imports, but open-question categories and resolutions remain literals; contradiction and diagnosticity validators do likewise | Replace all source-enumerated literals with generated arrays and make the vocabulary gate enumerate every binding |
| F5 | claim-unmet | C32 / materializer/amanuensis_materializer/renderers.py:251 | medium | Publishing a seeded thesis containing `Health: 72%` returned code 0 with `ok: true`, `published: true`, no warnings, and retained the health index in index.md | Move composite-index detection into production linting and reject the publish; assert the armed publish itself is red |
| F6 | regression-fail | design/reader-lenses/dogfood-receipt.json | medium | `node dev/test-reader-lenses-dogfood.mjs` exited 1 because repository SHA `331078257db7b478aae4f97884fe00cbd90a6e24` does not resolve in this snapshot | Regenerate the receipt against a reachable revision or include its referenced commit in review snapshots |

## Notes

P21 passed before sabotage and after restoration; removing `add_evidence` revision resolution produced the expected red result.
The other 18 listed regression commands passed.
Changed cloud and performance tests also passed.
Sabotage was manually restored because the snapshot’s Git index is read-only; no tracked changes remain.