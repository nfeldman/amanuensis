# Open questions

_Items the autoprogress coordinator could not decide without human input. Each entry records the question, what the agent could not do because of it, and what assumption (if any) the agent proceeded with. Close out via `resolve_open_question` once answered; the reviewer's answers can feed back into a `reset_subsystem` + re-survey if the assumption turned out wrong._

## Open (2)

### Domain Knowledge (1)

#### #5 · subsystem `B-06` · phase `B-06 Phase 2`

> What privacy and persistence policy should govern optional device-local trail pinning in production?

- **What this blocked:** The validation report explicitly leaves the production policy unresolved.
- **Assumption the agent proceeded with:** Keep trail pinning optional, explicitly device-local, clearable, and outside required route recovery until a product policy is accepted.
- _recorded 2026-08-23 05:55 UTC_

### Ambiguous Evidence (1)

#### #4 · subsystem `B-06` · phase `B-06 Phase 2`

> What production gate and owner will close the remaining forced-colors, zoom, screen-reader order, print-pagination, and representative-reader validation limits?

- **What this blocked:** No owner or closing run is recorded in the design corpus.
- **Assumption the agent proceeded with:** Treat these as explicit pre-production obligations; do not infer accessibility or reader-performance conformance from the current structural and visual checks.
- _recorded 2026-08-23 05:55 UTC_

## Resolved (3)

| # | Category | Question | Resolution | Answer |
|---|---|---|---|---|
| #1 | scope-judgment | For the A0 definition of fully surveyed, should every tracked repository file be assigned/excluded, including tests, generated dist files, prompts, and product documentation? | answered | For the immutable A0 fixture at b8b566f, yes: every tracked file is assigned or explicitly excluded, and any generated surface is admitted only with its generator/drift contract. This answer is historical-fixture scope only; it does not claim the live conspectus inventories current HEAD. |
| #2 | priority-ranking | Should Codex MCP registration become a supported installer target alongside VS Code MCP configuration? | answered | No under the currently accepted installer contract. The shipped installer owns VS Code MCP configuration; Codex registration is unsupported until a separate portable configuration contract and accepted product decision add it. The v2.10 reconciliation did not expand installer scope. |
| #3 | ambiguous-evidence | Is a phase checkpoint intended to version the SQLite database itself, or only prose artifacts while SQLite durability relies on WAL? | answered | A phase checkpoint is intended to version all durable survey state, including SQLite. The handler now checkpoints the live WAL connection before staging memory.db, and [B02-1](findings.md#b02-1) is verified-fixed by evidence 24 at 457e1c1. |

