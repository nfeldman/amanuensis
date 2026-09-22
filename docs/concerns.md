# Concerns

## Coverage overview

| Subsystem | **AT-1** | **AT-2** | **CC-1** | **CR-1** | **EP-1** | **IF-1** | **RL-1** | **SC-1** | **SI-1** | **SI-2** | **TB-1** | **TR-1** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **[B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)** Survey methodology and agent contracts | ⚪ | 🟡🔗 | 🟡🔗 | ⚪ | 🟡 | ⚪ | 🟡🔗 | 🟡🔗 | 🟡🔗 | 🟡 | ⚪ | 🟡🔗 |
| **[B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)** MCP core, persistence, and lifecycle | 🟡 | 🟡🔗 | 🟡🔗 | 🟡🔗 | 🟡 | ⚪ | 🟡🔗 | 🟡🔗 | 🟢 | 🟢 | 🟡🔗 | 🟢 |
| **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** Knowledge tools and workflow API | 🟡🔗 | 🟡🔗 | 🟡🔗 | 🟡🔗 | 🟡🔗 | ⚪ | 🟡🔗 | 🟡🔗 | ⚪ | 🟡🔗 | 🔴 | 🟡 |
| **[B-04](subsystems/b04-diff-aware-materializer.md)** Diff-aware materializer | 🟡🔗 | ⚪ | 🔴 | 🟡🔗 | 🟡 | 🟡🔗 | 🟡🔗 | 🟡🔗 | ⚪ | 🟡🔗 | 🟡 | 🟢 |
| **[B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)** Packaging, installer, validation, and product docs | — | — | — | — | — | — | — | 🔴 | — | — | — | — |
| **[B-06](subsystems/b06-report-interface-design-and-validation-studies.md)** Report interface design and validation studies | — | — | — | — | — | — | — | — | — | — | — | — |
| **[B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md)** Embedded research surveys and platform trials | — | — | — | — | — | — | — | — | — | — | 🔴 | — |
| **[B-08](subsystems/b08-activation-evidence-and-release-readiness.md)** Activation evidence and release readiness | — | — | — | — | — | — | — | — | — | — | — | — |
| **[B-09](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md)** Conspectus design lanes, their drivers and receipts | — | — | — | — | — | — | — | — | — | — | — | — |

**Legend**: 🟢 ruled-out · 🟡 confirmed-acceptable · 🔴 confirmed-bug · ⚠️ unresolved-competition · ⚪ out-of-scope · 🔗 linchpin-dependent · — not assessed

## Active concerns

| Code | Category | Origin | Discovered in | Notes |
|---|---|---|---|---|
| <a id="at-1"></a>**AT-1** | atomicity | seeded | — | T7: Inspect every multi-table mutation for one transaction covering the invariant it claims — the carry and its run counts, a disposition and its evidence join, a reconciliation and its scope_gaps rewrite. |
| <a id="at-2"></a>**AT-2** | checkpoint atomicity | seeded | — | T7: Mutate the database under WAL, call commit_phase_gate, clone or restore the storage commit, and verify the mutation is in it. This is the territory of archived finding B02-1 and of the A0 baseline's recoverability defect. |
| <a id="cc-1"></a>**CC-1** | derived-state coherence | seeded | — | T2: Enumerate every derived surface — the SQL views, the materialized pages, the manifest, the search index, the dashboard census — and find one that can disagree with the rows it is derived from after an ordinary write. |
| <a id="cr-1"></a>**CR-1** | concurrency | seeded | — | T8: Race two writers, the lock table, SQLite WAL commits and storage git commits; reconcile the landed records against the history. Lanes run concurrently against sibling worktrees on this machine. |
| <a id="ep-1"></a>**EP-1** | exceptional paths | seeded | — | T4: Fail validation, SQL and filesystem steps inside mutating tools and compare the dependent rows before and after. The success path establishes an invariant; ask whether the error path restores it. |
| <a id="if-1"></a>**IF-1** | incremental/full parity | seeded | — | T6: Render incremental, force-full and clean_publish from identical state and compare state, coverage and bytes; then delete a record and re-render, and look for what the incremental path leaves behind. |
| <a id="rl-1"></a>**RL-1** | resource lifecycle | seeded | — | T9: Inject success, error, timeout and cancellation at every database handle, child process, temporary directory and materializer lock boundary, and find one that is not released on every exit path. |
| <a id="sc-1"></a>**SC-1** | seam contracts | seeded | — | T11: Find a fact published in two places with nothing comparing them: the enum in the vocabulary contract against the SQL CHECK and the two generated modules, the tool inventory against DEVELOPMENT.md, the server's refusal messages against the skill references that instruct the calls they refuse, a schema field against the Python projection that reads it. |
| <a id="si-1"></a>**SI-1** | scope identity | seeded | — | T1: Try to make project-key and workspace-binding derivation conflate two checkouts of this repository, or place a store outside the configured storage root. This repository is surveyed from git worktrees whose .amanuensis is worktree-local, so two live stores for one project_key is the ordinary case, not the exotic one. |
| <a id="si-2"></a>**SI-2** | revision identity | seeded | — | T1: Follow every ref_sha, first_seen, anchor and repaired_sha from the write that accepts it to the read that trusts it; require each to resolve in the bound workspace at the moment it is read, and try to reuse one at a revision the workspace cannot reach. |
| <a id="tb-1"></a>**TB-1** | temporal bounds | seeded | — | T3: Enumerate every git and python subprocess a tool call awaits; locate the timeout, the cancellation path and the failure propagation for each. An unbounded probe on the activation path hangs the host. |
| <a id="tr-1"></a>**TR-1** | trust boundary | seeded | — | T10: Fuzz tool arguments that reach a filesystem path, a SQL identifier or a git argument: storage escape, injection, and bypass of the depth authority the phase ladder enforces. |

