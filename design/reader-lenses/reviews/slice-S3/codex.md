## Findings

| Id | Kind | Location | Severity | Evidence | Proposed fix |
|---|---|---|---|---|---|
| F1 | gate-cannot-red | mcp-server/test-structural-claims.mjs:775 | medium | removed the `key-type` renderer grouping at renderers.py:120; P11 still exited 0 and reported its grouping assertion green | assert the “Key types” heading and its claim independently |
| F2 | gate-cannot-red | mcp-server/test-phase2-claims-gate.mjs:724 | high | inverted phase-4-adversarial.md:183 to permit mapping before claim outcomes; P12 still exited 0 and reported the before-mapped assertion green | assert the normative clause and attempt a runtime mapped transition with an unreviewed claim |
| F3 | claim-unmet | C43 / mcp-server/src/tools/subsystems.ts:107 | high | runtime probe called `upsert_subsystem` on a scoped subsystem and received `ok:true`, `status:"structural"`, `claims:0`; this path never calls `enforcePhasePrerequisites` | route every forward status writer through the prerequisite checks and cover fresh and existing upserts |
| F4 | claim-unmet | C42 / mcp-server/src/tools/claims.ts:35 | medium | runtime probe accepted subject `unit.ts:Other` using only `code-verified` evidence for `unit.ts:Real`; spec §9.1 requires the same file and symbol, but `EvidenceRow` and the query omit `symbol` | select `evidence.symbol` and require it to match the symbol portion of `subject_id` |
| F5 | defect | mcp-server/src/tools/claims.ts:438 | high | runtime probe superseded a structural claim with only `name-inferred` evidence from another file and created current successor `CL-2`; `supersede_claim` never invokes `requireFileAnchoredEvidence` | centralize structural evidence validation in the shared insertion path so add and supersede enforce it |
| F6 | defect | mcp-server/src/tools/subsystems.ts:264 | medium | after resetting to `scoping`, runtime probe found one old current claim and re-advanced to `structural` without recording a new claim | close or remove current subsystem structural claims when resetting below structural, then test that re-advance requires a fresh claim |
| F7 | contract-drift | C19 / mcp-server/src/tools/locus.ts:1428 | medium | `structure` is default and line 1448 attaches `view.narrative` regardless of `requested`; the input schema has no narrative opt-in, contrary to spec §4.2 | add an explicit narrative opt-in and suppress the pointer otherwise |
| F8 | contract-drift | C43 / .claude/skills/amanuensis/references/phase-4-adversarial.md:42 | medium | spec §9.1 requires `get_claims(subsystem_id)`, but the instructions acknowledge that filter is absent and fetch every current claim for client-side filtering | add a server-side literal claim-key-prefix or subsystem filter to `get_claims` |
| F9 | claim-unmet | C42 / .claude/skills/amanuensis/references/phase-2-structural.md:76 | medium | the prescribed slug uses only the symbol, while schema.sql:1042 permits one current row per `claim_key`; two files defining `Config` therefore collide and cannot both be recorded | include a normalized path or deterministic collision suffix in structural claim keys |
| F10 | defect | materializer/amanuensis_materializer/renderers.py:138 | low | `_nest_prose("~~~text\\n# literal code heading\\n~~~", 3)` returned `~~~text\\n#### literal code heading\\n~~~`, mutating code inside a valid tilde fence | recognize CommonMark fence characters and lengths, or transform headings through a Markdown parser |

## Notes

- Both packet gates pass on the restored snapshot.
- All 19 unique regression commands from `packets.json` passed.
- Read-only AxiomDB check found zero `claims` and zero `claim_evidence` rows.
- All sabotage and probe changes were restored; only the provided `REVIEW/` directory remains untracked.