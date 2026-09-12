## Findings

| Id | Kind | Location | Severity | Evidence | Proposed fix |
|---|---|---|---|---|---|
| F1 | gate-cannot-red | mcp-server/test-edge-contract.mjs:809 | high | Swapped rendered From and To identifiers in `diagrams.py:110-113`; P13 still reported GREEN because it checks only that both identifiers occur somewhere in each row. | Parse table cells and assert exact From, Relationship, To, Strength, and Context values in their respective columns. |
| F2 | gate-cannot-red | mcp-server/test-edge-contract.mjs:958 | high | Replaced the workflow command with `run: echo skipped # node test-edge-contract.mjs`; P13 still reported “this gate runs in CI” and GREEN. | Parse the workflow YAML and require an executable step whose working directory and command exactly invoke the gate. |
| F3 | gate-cannot-red | mcp-server/test-edge-contract.mjs:928 | high | Inverted Phase 2’s instruction to “Never record an add_xref row…”; P13 remained GREEN because the prose regex treats “record” as an obligation without checking negation. | Gate a machine-readable Phase 2 directive or exact normative sentence, including its positive polarity. |
| F4 | claim-unmet | C55,C63 / design/reader-lenses/plan.json:891 | high | A missing-module sabotage exited 1, matched `red_expect` (`add_xref\|context`), and did not match `red_rejects`; `SCRUB` rewrote the forbidden module-error text before the launcher could inspect it. | Preserve raw build/load diagnostics, reject any build or load failure first, and use an assertion-specific `red_expect` pattern. |
| F5 | contract-drift | mcp-server/src/tools/locus.ts:907 | medium | Spec §3.2 and P6 require an xref without a source `ref_sha` column to remain unbound. Seeding P6’s xref context with a valid citation made P6 fail: “a seam or xref carries a ref_sha it has no column for.” P13 derives `ref_sha` from the first prose token. | Keep xrefs unbound while exposing `citations[]`, or add an explicit revision column and specify how multiple cited revisions bind the edge. |

## Notes

- P13 passed before and after restoration; truncating `citations[]` correctly turned it red.
- All 13 listed regression commands passed under the workspace-managed runtime.
- The read-only AxiomDB query found 0 xrefs across 35 subsystems.
- All sabotage edits were restored; P13 and P6 finished GREEN with a clean tracked diff.