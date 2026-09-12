## Findings

| Id | Kind | Location | Severity | Evidence | Proposed fix |
|---|---|---|---|---|---|
| F1 | defect | mcp-server/src/schema.sql:838 | high | Runtime probe marked a finding verified-fixed, closed the database, and reopened it. State changed to fixed-pending-verification because the legacy sweep appended a newer pending event with origin key `legacy-fixed:<id>`. | Import legacy fixed rows only when no resolution event exists for the finding; add a close-and-reopen regression test. |
| F2 | claim-unmet | C48 / mcp-server/src/db.ts:66 | high | The current schema permits nine evidence-quality values, but migrations never rebuild the existing CHECK constraint. The real AxiomDB schema still lists five values, and an upgraded legacy fixture rejected `test-observed` with a CHECK constraint failure. | Add a transactional table-rebuild migration preserving data, indexes, triggers, and foreign keys; test all vocabulary values against an upgraded database. |
| F3 | claim-unmet | C28 / materializer/amanuensis_materializer/renderers.py:857 | medium | Spec §6.1 requires every open finding before every fixed-pending-verification finding. A runtime fixture with a low-severity open finding and critical pending finding reported `pending_before_open=True`; the SQL orders severity before resolution state. | Make resolution state the primary grouping and ordering key, then severity, subsystem, and finding id; add a crossed-severity fixture. |
| F4 | claim-unmet | C32 / materializer/amanuensis_materializer/renderers.py:251 | medium | Source alignment resolves hard-coded `refs/remotes/origin/<branch>`. In a runtime repository where `main` tracked `upstream/trunk`, `git rev-parse main@{upstream}` returned a SHA while `source_alignment.origin_head` was empty. | Resolve `<canonical_branch>@{upstream}` and add coverage for renamed or non-origin upstream remotes. |
| F5 | claim-unmet | C50 / materializer/amanuensis_materializer/renderers.py:421 | medium | With one scoped generated-ignore row, `ledger_freshness` returned `scoped_files=1`, `stale_exempt=1`, and `stale_obligation=0`, but Overview said freshness was “not measured by this projection.” Spec §11.2 permits that statement only when scoped files equal zero. | Determine measurement from `scoped_files`, not obligation count; report zero obligation-bearing files while retaining the exempt count, and add an all-exempt gate fixture. |

## Notes

All four packet gates passed cleanly and turned red under independent production-code sabotage.
All listed regression commands passed.
Sabotage edits were restored; `git status --short` shows only the supplied untracked `REVIEW/` bundle.