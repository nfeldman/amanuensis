## Findings

| Id | Kind | Location | Severity | Evidence | Proposed fix |
|---|---|---|---|---|---|
| F1 | gate-cannot-red | mcp-server/test-refusal-parity.mjs:417 | high | Disabled the checker’s entire `src/tools/*.ts` scan at check-refusal-parity.mjs:314; all 22 assertions still passed and the gate exited 0 with `GATE P7 GREEN`. A6 only injects an unregistered refusal into invariants.ts. | Add a sabotage arm that inserts an unregistered refusal into a tool handler and requires the derived scan to identify it. |
| F2 | gate-cannot-red | mcp-server/scripts/check-refusal-parity.mjs:122 | medium | The regex reports 220 advertised tools while the generated `tools/list` inventory has 209; names such as `hot_spots` are response fields in tools/locus.ts, not tools. Replacing the contract’s `decline_domain_vocabulary` mapping with `hot_spots` still produced `GATE P7 GREEN`. | Reuse the stricter tool-definition scanner from gen-tool-inventory.mjs:44 or read the built tool inventory; add a sabotage using a non-tool `name` field. |
| F3 | contract-drift | mcp-server/contracts/refusal-parity.json:139 | medium | The contract says `tools` identifies handlers that throw the refusal, but `active-session-required` names `start_session`; its handler at tools/project.ts:46 starts a session without calling `requireActiveSession`. Actual callers such as `define_term` at tools/vocabulary.ts:87 are omitted, and checker line 390 verifies only global advertisement. | Separate throwing tools from repair/mentioned tools and validate throwing-tool associations against handler call sites. |
| F4 | regression-fail | dev/test-rebuild-readback.mjs | low | The listed command exited 1 because receipt revision `7c1c1a9f5689d396487072d012abe6fafd5f348c` does not resolve in this history-free snapshot. | Run this regression in a full-history snapshot containing its receipt-bound revision; do not weaken the provenance assertion. |
| F5 | regression-fail | dev/test-rebuild-coverage.mjs | low | The listed command exited 1 because revisions `7c1c1a9f5689d396487072d012abe6fafd5f348c`, `7c1c1a9`, and `dee59d3e019a6747af714aa5a44acbb774ff6d5f` do not resolve here. | Preserve the receipt-bound commit objects in the review snapshot. |
| F6 | regression-fail | dev/test-reader-lenses-dogfood.mjs | low | The listed command exited 1 because dogfood receipt revision `d6dd4215768038a543b4a5c561d7159b21fa1431` does not resolve here. | Preserve the receipt-bound commit object in the review snapshot. |

## Notes

The baseline and restored P7 gate passed; inverting its derived-refusal predicate made it red.
Under pinned Node 24 and Python 3.12, the other 13 regression commands passed.