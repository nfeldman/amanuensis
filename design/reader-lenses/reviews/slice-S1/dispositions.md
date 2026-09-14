# slice-S1 — fix-session dispositions

Run `20260911-223211-fix-slice-S1`, one reviewer (codex), so the `/name` suffix is omitted.
Every finding was reproduced at runtime before any repair was written (GP1, verify-before-apply);
the probes are recorded in the Reproduction column and each repair carries a red commit that
fails on the tree preceding it.

| F1 | verified: yes | action: fixed | reproduced: a runtime probe took B02-1 to verified-fixed through the tools, closed the store and reopened it; `finding_state_current` returned `fixed-pending-verification` and the events table carried a fourth row with `origin_key='legacy-fixed:B02-1'`. `verify_finding_fix` writes the event, not `findings.status`, so the sweep at schema.sql:845 re-imported on every open and `origin_key` could not stop it (the verification carries none, so `INSERT OR IGNORE` saw no conflict). Sharpened test-resolution-proof.mjs with three arms; `NOT EXISTS` guard added to the sweep. red fd02f16, green 34a8762 |
| F2 | verified: yes | action: fixed | reproduced: a legacy fixture carrying the pre-widening five-value CHECK, opened through `openDatabase`, rejected `runtime-observed`, `test-observed`, `config-asserted`, and `doc-asserted` on `dispositions.evidence_quality`; a read-only copy of `~/repos/axiomdb/.amanuensis/memory.db` carries exactly that constraint. The contract's own `sql` mappings are now generated into vocabulary.ts, and `runMigrations` rebuilds any table whose CHECK is narrower than the source by SQLite's documented procedure. Verified on a copy of the AxiomDB store: 131 tables, no row-count change, no index or trigger lost, no FK violation, `integrity_check` ok. red 2c13ca5, green c87f151 |
| F3 | verified: yes | action: fixed | reproduced: a fixture with a LOW open finding and a CRITICAL `fixed-pending-verification` one rendered `pending_before_open=True`; renderers.py:863 ordered severity before state and the page's headings were severity-major with no state grouping at all. findings.md now opens on `## Open` / `## Awaiting verification` with severity as h3 and the subsystem as h4; the P2 gate gained an ordering arm and a heading arm over the fixture's already-crossed B01-2/B01-4 pair. red f5ff94e, green 579098d |
| F4 | verified: yes | action: fixed | reproduced: in a clone made with `--origin upstream` whose `main` tracks `upstream/trunk`, `git rev-parse main@{upstream}` returned a SHA while `source_alignment.origin_head` was empty and the row read "Origin head \| not known here". `source_alignment` now resolves `<branch>@{upstream}` with `refs/remotes/origin/<branch>` as the fallback, and the row is named Upstream head with the resolving ref in its value. The first form of the red arm passed for the wrong reason — a fresh clone's workspace head is the upstream head — so it now reads the upstream row alone. red 97feb76, green 01b27e3 |
| F5 | verified: yes | action: fixed | reproduced: with one scoped `generated-ignore` row, `ledger_freshness` returned `scoped_files=1, obligation_files=0, stale_exempt=1` while renderers.py:425 printed "not measured by this projection" — spec §11.2 fixes `staleness_measured` on `scoped_files`, and core.py:246 and html_projection.py:2444 already read it that way, so the overview contradicted the strip on the same store. The row now reports that none of the scoped files carries an obligation, keeps the exempt count, and reserves the unmeasured sentence for an empty ledger; the P4 gate gained an all-exempt fixture. red 66c18d2, green 597c2da |

## Notes

- Nothing was deferred and nothing was rejected; no test or gate was weakened.
- F2 was filed against C48. C48 as written governs the single enum source and its CI checks, not
  the migration of existing stores, so the claim mapping is looser than the finding — but the
  defect is real and independent of the mapping, and the repair is what makes C48's "single enum
  source" true of a store rather than only of a fresh database.
- Two gates were realigned rather than weakened where a spec-mandated change moved the structure
  under them: `test-materializer.py`'s heading-level assertions follow findings.html down one
  level and gain an ordering assertion (F3), and the P3 gate's `\bOrigin head\b` becomes
  `\bUpstream head\b` for a row that no longer reports one named remote (F4).
- Regression run green: the four packet gates; ruff and the four materializer tests; biome, the
  build, five mcp-server checkers and ten mcp-server tests; and the five repo-level roadmap and
  living-conspectus checks.
