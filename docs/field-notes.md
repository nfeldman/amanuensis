# Leads

_Observations from every survey pass that are not yet findings: patterns, anomalies, connections, tensions, and candidate concerns recorded when a reader noticed something the phase structure did not ask for. Closed leads are on [Resolved leads and questions](resolved-leads.md)._

## Anomaly

_1 open lead._

- <a id="lead-2"></a>Measured over this store at 2388433 by extracting each evidence row's file at its own ref_sha and counting lines: 13 of the 35 rows carrying a line_range point past the end of the file they name — ev13 git.ts:detect_changes 1319-1384 of 465, ev14 carried.ts:record_carried_outcome 3512-3639 of 735, ev17 xrefs.ts:resolvesInWorkspace 581-588 of 107, ev18 dashboard.ts:get_dashboard 141-148 of 85, ev19 artifacts.ts:resolveArtifactPath 689-712 of 177, ev20 dashboard.ts:get_dashboard 102-121 of 85, ev21 findings.ts:verify_finding_fix 1792-1798 of 486, ev22 stale.ts:clear_staleness 1107-1120 of 135, ev23 findings.ts:update_finding_status 1696-1700 of 486, ev24 phase-2-structural.md 238-302 of 254, ev25 onboarding.md 213-250 of 205, ev27 refresh.md 345-357 of 141, ev31 diagrams.py:subsystem_dependency_view 1022-1048 of 307. Every named symbol does exist in its file and the behaviour each row was cited for holds where the symbol actually is, so these are displaced coordinates rather than invented observations — the mechanism is recorded as finding B03-R5. The same displacement appears in the root_cause prose of B03-R1, B03-R2, B03-R3 and B03-R4, which are the four findings re-found from carried obligations; the ranges they quote are the archived store's, not this repository's. @ `.amanuensis/memory.db:evidence` · _recorded 2026-09-18 02:14 UTC_

## Pattern

_1 open lead._

- <a id="lead-1"></a>Three guards in this subsystem share one shape: read the declaration out of the source that already exists, then assert the live state against it, rather than maintaining a second list. requireSchemaObjects parses schema.sql's own CREATE statements; helpers.ts re-exports the obligation split from the generated vocabulary module instead of restating it; the concern checklist was moved out of a gate's literal into a contract for the same reason. REQUIRED_VIEWS is the one place the pattern is not applied — two view names maintained by hand — and it is the one that predates the others. @ `mcp-server/src/db.ts:requireSchemaObjects@c0734040022f0e1f1b9d8c480259f6142a875fca` · _recorded 2026-09-15 04:29 UTC_

