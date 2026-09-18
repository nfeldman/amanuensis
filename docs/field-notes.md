# Leads

_Observations from every survey pass that are not yet findings: patterns, anomalies, connections, tensions, and candidate concerns recorded when a reader noticed something the phase structure did not ask for. Closed leads are on [Resolved leads and questions](resolved-leads.md)._

## Pattern

_1 open lead._

- <a id="lead-1"></a>Three guards in this subsystem share one shape: read the declaration out of the source that already exists, then assert the live state against it, rather than maintaining a second list. requireSchemaObjects parses schema.sql's own CREATE statements; helpers.ts re-exports the obligation split from the generated vocabulary module instead of restating it; the concern checklist was moved out of a gate's literal into a contract for the same reason. REQUIRED_VIEWS is the one place the pattern is not applied — two view names maintained by hand — and it is the one that predates the others. @ `mcp-server/src/db.ts:requireSchemaObjects@c0734040022f0e1f1b9d8c480259f6142a875fca` · _recorded 2026-09-15 04:29 UTC_

