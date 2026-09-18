# Concern checklist (calibrated)

**Derived**: at `b716a6d1496d9dd312356fb8f3ba6764f7567467` from `references/concern-territories.md`, during the acceptance
rebuild's onboarding. This supersedes the generic territory catalog for this survey.

The same checklist is committed in the repository as
`mcp-server/contracts/concern-checklist.json`, because the gate that counts a survey's concern
coverage must read its denominator from a document the survey does not also write.

A disposition is terminal only when it carries attached evidence whose revision resolves, or a
recorded open question naming the exact gap.

| Code | Category | Territory | Probe |
|---|---|---|---|
| [AT-1](concerns.md#at-1) | atomicity | T7 | Inspect every multi-table mutation for one transaction covering the invariant it claims — the carry and its run counts, a disposition and its evidence join, a reconciliation and its scope_gaps rewrite. |
| [AT-2](concerns.md#at-2) | checkpoint atomicity | T7 | Mutate the database under WAL, call commit_phase_gate, clone or restore the storage commit, and verify the mutation is in it. This is the territory of archived finding B02-1 and of the A0 baseline's recoverability defect. |
| [CC-1](concerns.md#cc-1) | derived-state coherence | T2 | Enumerate every derived surface — the SQL views, the materialized pages, the manifest, the search index, the dashboard census — and find one that can disagree with the rows it is derived from after an ordinary write. |
| [CR-1](concerns.md#cr-1) | concurrency | T8 | Race two writers, the lock table, SQLite WAL commits and storage git commits; reconcile the landed records against the history. Lanes run concurrently against sibling worktrees on this machine. |
| [EP-1](concerns.md#ep-1) | exceptional paths | T4 | Fail validation, SQL and filesystem steps inside mutating tools and compare the dependent rows before and after. The success path establishes an invariant; ask whether the error path restores it. |
| [IF-1](concerns.md#if-1) | incremental/full parity | T6 | Render incremental, force-full and clean_publish from identical state and compare state, coverage and bytes; then delete a record and re-render, and look for what the incremental path leaves behind. |
| [RL-1](concerns.md#rl-1) | resource lifecycle | T9 | Inject success, error, timeout and cancellation at every database handle, child process, temporary directory and materializer lock boundary, and find one that is not released on every exit path. |
| [SC-1](concerns.md#sc-1) | seam contracts | T11 | Find a fact published in two places with nothing comparing them: the enum in the vocabulary contract against the SQL CHECK and the two generated modules, the tool inventory against DEVELOPMENT.md, the server's refusal messages against the skill references that instruct the calls they refuse, a schema field against the Python projection that reads it. |
| [SI-1](concerns.md#si-1) | scope identity | T1 | Try to make project-key and workspace-binding derivation conflate two checkouts of this repository, or place a store outside the configured storage root. This repository is surveyed from git worktrees whose .amanuensis is worktree-local, so two live stores for one project_key is the ordinary case, not the exotic one. |
| [SI-2](concerns.md#si-2) | revision identity | T1 | Follow every ref_sha, first_seen, anchor and repaired_sha from the write that accepts it to the read that trusts it; require each to resolve in the bound workspace at the moment it is read, and try to reuse one at a revision the workspace cannot reach. |
| [TB-1](concerns.md#tb-1) | temporal bounds | T3 | Enumerate every git and python subprocess a tool call awaits; locate the timeout, the cancellation path and the failure propagation for each. An unbounded probe on the activation path hangs the host. |
| [TR-1](concerns.md#tr-1) | trust boundary | T10 | Fuzz tool arguments that reach a filesystem path, a SQL identifier or a git argument: storage escape, injection, and bypass of the depth authority the phase ladder enforces. |

## Not applicable during onboarding

| Territory | Disqualifying condition |
|---|---|
| T5 aliasing and ownership | No cross-request shared mutable object is established in this read: every request and response crosses MCP serialization, and residual process-local state is covered by [CR-1](concerns.md#cr-1) and [RL-1](concerns.md#rl-1). Recorded as an open question so a structural pass that finds an alias reopens it. |

## Finding ids

`<subsystem-compact>-R<N>` — `B03-R1`, not `B03-5`. The archived conspectus this store carried
from names its own findings `<subsystem-compact>-<N>`, and 22 of those ids are live carried records
here; a finding of this survey sharing one would shadow the obligation it inherited.
