# Concern checklist (calibrated)

**Derived**: 2026-08-12 from onboarding session `mspky4v5-2wuk50if` at `b8b566f`

This file supersedes the generic territory catalog for the self-survey. A disposition is
terminal only when it carries evidence or a tracked unresolved destination.

## Active concerns

| Code | Category | Source territory | Codebase-specific probe |
|---|---|---|---|
| [SI-1](concerns.md#si-1) | scope identity | T1 | Try to make project-key derivation conflate workspaces or escape the configured storage root; inspect the stored `workspace_path` response. |
| [SI-2](concerns.md#si-2) | revision identity | T1 | Trace evidence/artifact SHA fields through writes and reads; attempt reuse at another revision. |
| [CC-1](concerns.md#cc-1) | derived-state coherence | T2 | Enumerate every materialized page's DB/prose dependencies and compare them with the page plan and manifest. |
| [TB-1](concerns.md#tb-1) | temporal bounds | T3 | Enumerate git and Python subprocess calls; locate timeout, cancellation, and failure propagation. |
| [EP-1](concerns.md#ep-1) | exceptional paths | T4 | Inject one renderer failure and inspect global status, retained pages, manifest writes, and publication behavior. |
| [EP-2](concerns.md#ep-2) | exceptional paths | T4 | Fail validation/SQL/filesystem steps inside mutating tools and compare pre/post dependent rows. |
| [IF-1](concerns.md#if-1) | incremental/full parity | T6 | Render incremental, force-full, and clean export from identical state and compare state, coverage, and bytes. |
| [AT-1](concerns.md#at-1) | atomicity | T7 | Inspect every multi-table mutation for one transaction covering the invariant it claims. |
| [AT-2](concerns.md#at-2) | checkpoint atomicity | T7 | Mutate DB under WAL, call `commit_phase_gate`, clone/restore the storage commit, and verify the mutation exists. |
| [CR-1](concerns.md#cr-1) | concurrency | T8 | Race writers, locks, SQLite WAL commits, and storage git commits; reconcile landed records and history. |
| [RL-1](concerns.md#rl-1) | resource lifecycle | T9 | Inject success/error/timeout/cancel at DB, child-process, temporary-directory, and materializer-lock boundaries. |
| [RL-2](concerns.md#rl-2) | workflow lifecycle | T9 | Abandon sessions, dispatches, questions, and locks; verify explicit recovery and authority behavior. |
| [TR-1](concerns.md#tr-1) | trust boundary | T10 | Fuzz MCP paths/enums/strings for storage escape, SQL/git injection, and depth-authority bypass. |
| [TR-2](concerns.md#tr-2) | installer trust boundary | T10 | Feed conflicting/commented/malformed configs and hostile paths; verify backup, preservation, and refusal behavior. |
| [SC-1](concerns.md#sc-1) | schema/tool/materializer seam | T11 | Change a schema field and require tool queries plus Python projections to fail or update together. |
| [SC-2](concerns.md#sc-2) | source/package seam | T11 | Compare root agent/materializer sources with package mirrors from a clean tree and require generated inventory parity. |

## Non-applicable during onboarding

| Territory | Disqualifying condition |
|---|---|
| T5 aliasing and ownership | No cross-request shared returned mutable object was established in the onboarding read. Request/response values cross MCP serialization; residual process-local state is covered by [CR-1](concerns.md#cr-1)/[RL-2](concerns.md#rl-2). Reopen if a subsystem structural pass finds an alias. |

## Discovered concerns

None promoted during onboarding. The Codex registration gap is a [B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md) open question, not yet
a correctness concern. The WAL/checkpoint observation is already captured by [AT-2](concerns.md#at-2).
