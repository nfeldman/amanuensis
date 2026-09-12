# Concern checklist

Calibrated for this codebase at `258ccd2`. Each entry is falsifiable by reading code; none
needs a runtime to answer. This supersedes the territory catalog for later sessions.

| Code | Category | Question |
|---|---|---|
| [CC-1](concerns.md#cc-1) | cache-coherence | Derived state is served from SQL views over append-only event tables (`finding_state_current`, `file_standing`). Does any reader compute the same predicate inline instead of reading the view, so a schema change moves one and not the other? |
| [RC-1](concerns.md#rc-1) | resource-lifecycle | The server holds one SQLite handle for the life of the process and also writes the storage directory's git repository. Can a handle outlive the file it was opened on, or a commit run against a directory another process is mutating? |
| [BV-1](concerns.md#bv-1) | boundary-validation | Tool arguments carry workspace-relative paths, revisions, and output directories supplied by an agent. Is every one containment-asserted against the bound workspace or storage root before it reaches the filesystem? |
| [EV-1](concerns.md#ev-1) | evidence-integrity | Claims and evidence are bound to git revisions. Is every recorded revision resolved in the bound workspace at write time, and is ancestry checked where the record's meaning depends on it? |
| [GT-1](concerns.md#gt-1) | generated-artifact-drift | One vocabulary source feeds generated TypeScript and Python enum modules, SQL `CHECK` literals, tool validators, and hand-written `SKILL.md` prose. Can any of those four drift without a check naming which one diverged? |
| [ZD-1](concerns.md#zd-1) | zero-denominator-verification | Several gates assert over records that may be absent. Can a gate pass because its subject is absent rather than because the property holds? Three such greens have already been found here (B03-2, B04-1, B04-3). |

Territories disqualified, with the condition: distributed consensus (one process, one
database); request-scoped tenancy (the server binds one workspace for its lifetime);
client-side rendering state (the projection has a complete no-JavaScript reading path);
schema migration under load (the schema is applied at open with `CREATE TABLE IF NOT EXISTS`).
