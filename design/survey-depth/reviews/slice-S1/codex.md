## Findings

| Id | Kind | Location | Severity | Evidence | Proposed fix |
|---|---|---|---|---|---|
| F1 | gate-cannot-red | mcp-server/test-existing-store-migration.mjs:173 | high | Deleted both `scope_reconciliations` triggers at `schema.sql:229-234`; P0 still exited 0 with `46/81` tables proved because lines 195-196 exclude tables missing either trigger from the denominator. | Assert an independent list of required tables and both trigger names before probing them. |
| F2 | claim-unmet | C38 / mcp-server/src/schema.sql:475 | high | `vocabulary_scopes` has no immutability or deletion trigger. In a fresh database, UPDATE changed one row and DELETE removed it. | Add guarded `vocabulary_scopes_is_immutable` and unconditional `vocabulary_scopes_cannot_be_deleted` triggers, plus an explicit gate assertion. |
| F3 | claim-unmet | C20 / mcp-server/src/invariants.ts:1115 | high | `archivedStoreId` opens legacy sources with `readonly: true`, not immutable mode. A live pre-identity store was accepted, and changing `git_state.last_checked_sha` changed its derived ID from `store-legacy-dc30709e182a7a70` to `store-legacy-c7fcbd001c751a26`. | Permit the legacy derivation only through an explicitly immutable archive URI or handle; reject ordinary live paths. |
| F4 | compactness | mcp-server/src/tools/carried.ts:206,650 | medium | Wrote a valid carried finding with a 9,000-character `archived_finding_id`; `list_carried_findings` returned 18,428 bytes against the 8,192-byte budget because it never removes the final row. | Bound writer string lengths and defensively compact or reject a single record that exceeds the response envelope. |
| F5 | claim-unmet | C13 / dev/check-store-fully-surveyed.mjs:158 | high | A fixture had `git_state.last_checked_sha` different from HEAD and reconciliation digests `bad-tree` and `bad-ledger`; clause 1 still reported `satisfied: true`. The checker merely selects the latest row and enumerates its revision. | Reuse the five-condition standing-reconciliation check and require zero `unledgered` and `absent` rows. |
| F6 | claim-unmet | C23 / dev/check-store-fully-surveyed.mjs:238 | high | Attached evidence whose `ref_sha` was `deadbeef…`; `git cat-file -e` exited 1, but clause 3 reported `satisfied: true` because it checks only attachment count. | Join attached evidence and require every qualifying disposition to have an evidence revision that resolves in the workspace. |
| F7 | regression-fail | mcp-server/test-residual-hardening.mjs:1147 | medium | `cd mcp-server && node test-residual-hardening.mjs` exits 1: `carried_finding_outcome is neither probed nor declared as a non-input`. | Add a behavioral validator probe for `record_carried_outcome.outcome`. |
| F8 | regression-fail | REVIEW/packets.json:343 | low | Four listed regressions exit 1 in the mandated history-free snapshot: `check-living-conspectus`, `test-reader-lenses-dogfood`, `test-rebuild-coverage`, and `test-rebuild-readback`; each requires absent commit objects such as `b8b566f`, `d6dd421`, `7c1c1a9`, or `dee59d3`. | Bundle the referenced history or fixture objects in review snapshots, or replace these packet commands with history-independent fixtures. |
| F9 | regression-fail | dev/test-amanuensis-pecia-defects.mjs | low | The exact listed command exits 1 because `pecia init` cannot write the sandboxed default UV cache. Rerunning with `UV_CACHE_DIR=/tmp/amanuensis-review-uv-cache` passes all 8 assertions. | Give this regression a workspace-writable UV cache in the test or review launcher. |

## Notes

All five packet gates passed before sabotage.
P1-P4 turned red under targeted sabotage and passed again after restoration.
All sabotaged source files were restored; the final diff is clean apart from the supplied untracked `REVIEW/` directory.
Of 35 unique regression commands, 29 passed exactly as listed.
No HTML or browser-facing JavaScript changed within this slice.