# Concerns

## Coverage overview

| Subsystem | **AT-1** | **AT-2** | **CC-1** | **CR-1** | **EP-1** | **EP-2** | **IF-1** | **RL-1** | **RL-2** | **SC-1** | **SC-2** | **SC-3** | **SC-4** | **SC-5** | **SC-6** | **SD-1** | **SI-1** | **SI-2** | **TB-1** | **TR-1** | **TR-2** | **VG-1** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **[B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)** Survey methodology and agent contracts | ⚪ | ⚪ | ⚪ | 🟡 | ⚪ | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | — | 🟡 | — | — | — | 🟡 | 🟡 | ⚪ | 🟡 | ⚪ | — |
| **[B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)** MCP core, persistence, and lifecycle | 🟡 | 🟡 | ⚪ | ⚠️🔗 | ⚪ | 🟡 | ⚪ | ⚠️🔗 | ⚠️🔗 | 🟡 | ⚪ | — | — | — | — | — | 🟡 | 🟡 | 🔴 | 🟡 | ⚪ | — |
| **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** Knowledge tools and workflow API | 🟡 | ⚠️🔗 | ⚪ | 🟡 | 🟡 | 🟡 | 🟡 | ⚠️🔗 | 🟡 | 🟡 | ⚪ | — | — | — | 🔴 | 🔴 | 🟡 | 🟡 | ⚠️🔗 | 🟡 | ⚪ | 🔴 |
| **[B-04](subsystems/b04-diff-aware-materializer.md)** Diff-aware materializer | ⚠️🔗 | ⚪ | 🟡 | 🟡 | 🟡 | ⚪ | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | — | — | — | — | 🟡 | 🟡 | ⚪ | 🟡 | ⚪ | 🔴 |
| **[B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)** Packaging, installer, validation, and product docs | ⚪ | ⚪ | ⚪ | ⚪ | 🟡 | ⚪ | ⚪ | ⚪ | ⚪ | 🟡 | 🟡 | — | — | — | — | — | 🟡 | 🟡 | ⚠️🔗 | ⚪ | 🟡 | 🔴 |
| **[B-06](subsystems/b06-report-interface-design-and-validation-studies.md)** Report interface design and validation studies | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | 🟡 | 🟡 | 🟡 | — | — | ⚪ | 🟡 | ⚪ | ⚪ | ⚪ | — |
| **[B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md)** Embedded research surveys and platform trials | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | 🔴 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | 🟡 | — | — | ⚪ | 🟡 | 🔴 | ⚪ | ⚪ | — |
| **[B-08](subsystems/b08-activation-evidence-and-release-readiness-harness.md)** Activation evidence and release-readiness harness | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | 🟡 | 🟡 | — | — | 🟢 |

**Legend**: 🟢 ruled-out · 🟡 confirmed-acceptable · 🔴 confirmed-bug · ⚠️ unresolved-competition · ⚪ out-of-scope · 🔗 linchpin-dependent · — not assessed

## Active concerns

| Code | Category | Origin | Discovered in | Notes |
|---|---|---|---|---|
| <a id="at-1"></a>**AT-1** | atomicity | seeded | — | Inspect multi-table resets, status advances, finding transitions, and diagnosticity resolution for transaction boundaries covering all dependent writes. |
| <a id="at-2"></a>**AT-2** | atomicity | seeded | — | Verify a phase checkpoint persists SQLite WAL changes into the git-tracked memory.db before reporting a storage commit or no-op. |
| <a id="cc-1"></a>**CC-1** | cache-coherence | seeded | — | Compare every materialized page with its declared DB/prose source set; omitted dependencies must not leave a page falsely unchanged. |
| <a id="cr-1"></a>**CR-1** | concurrency | seeded | — | Verify concurrent agents, advisory write locks, SQLite WAL writers, and storage git commits cannot lose or misattribute landed work. |
| <a id="ep-1"></a>**EP-1** | exceptional-paths | seeded | — | Verify a failed page render cannot publish a globally green or internally inconsistent documentation set. |
| <a id="ep-2"></a>**EP-2** | exceptional-paths | seeded | — | Verify each mutating tool either commits all dependent rows or leaves pre-call state intact when validation, SQL, or filesystem work fails. |
| <a id="if-1"></a>**IF-1** | incremental-full-divergence | seeded | — | Compare incremental materialization, force-full materialization, and clean-export outputs for exact state, coverage, and content correspondence. |
| <a id="rl-1"></a>**RL-1** | resource-lifecycle | seeded | — | Verify database handles, spawned processes, temporary directories, and materializer locks release on success, error, timeout, and cancellation. |
| <a id="rl-2"></a>**RL-2** | resource-lifecycle | seeded | — | Verify sessions, dispatches, open questions, and write locks have explicit terminal or recovery paths and cannot remain silently authoritative after abandonment. |
| <a id="sc-1"></a>**SC-1** | seam-contract | seeded | — | Verify schema columns/views, TypeScript tool queries, and Python materializer reads evolve together and fail closed on contract drift. |
| <a id="sc-2"></a>**SC-2** | seam-contract | seeded | — | Verify package-time agent/materializer mirrors are derived from root sources and CI detects stale or host-dependent packaged assets. |
| <a id="sc-3"></a>**SC-3** | seam-contract | discovered | [SM-06](seams.md#sm-06) | Verify the [B-06](subsystems/b06-report-interface-design-and-validation-studies.md) report-presentation contract and [B-04](subsystems/b04-diff-aware-materializer.md) typed HTML projection agree on record-vs-table selection, label translation, identifier definitions, and revision-bound read-back. |
| <a id="sc-4"></a>**SC-4** | seam-contract | discovered | [SM-07](seams.md#sm-07) | Verify the [B-06](subsystems/b06-report-interface-design-and-validation-studies.md) product ruling/design language and [B-01](subsystems/b01-survey-methodology-and-agent-contracts.md) reporting-style contract agree on project identity, practitioner register, specialized labels, record grammar, and identifier treatment. |
| <a id="sc-5"></a>**SC-5** | seam-contract | discovered | [SM-08](seams.md#sm-08) | Verify [B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md) research limitations survive transfer into [B-06](subsystems/b06-report-interface-design-and-validation-studies.md) report-design rules: report-owned re-entry must not imply personal history, and corpus/prototype evidence must not be promoted to reader-performance or conformance guarantees. |
| <a id="sc-6"></a>**SC-6** | seam-contract | discovered | [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) | Verify the evidence-quality vocabulary the [B-01](subsystems/b01-survey-methodology-and-agent-contracts.md) methodology contract publishes is the vocabulary the [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) tool layer accepts, so that recording the strongest kind an agent's evidence actually supports is always expressible rather than forcing an over- or under-statement. |
| <a id="sd-1"></a>**SD-1** | scope-coverage | discovered | [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) | Verify the file ledger is reconciled against the working tree: files added since the last baseline must be surfaced as unclassified, and ledger rows for deleted files must not remain authoritative as 'examined'. A subsystem reported 'mapped' with 0 stale entries must not be able to conceal unclassified or nonexistent scope. |
| <a id="si-1"></a>**SI-1** | scope-identity | seeded | — | Verify project-key derivation, stored workspace_path collision detection, and storage-root confinement cannot conflate two workspaces or escape the root. |
| <a id="si-2"></a>**SI-2** | revision-identity | seeded | — | Verify every evidence-bearing record and generated artifact retains the exact repository revision and cannot be reused as current evidence at another SHA. |
| <a id="tb-1"></a>**TB-1** | temporal-bounds | seeded | — | Inspect every git and Python subprocess invocation for bounded completion, cancellation, and actionable failure propagation. |
| <a id="tr-1"></a>**TR-1** | trust-boundary | seeded | — | Verify MCP string/path/enum inputs cannot escape storage, inject SQL or git arguments, or create authority beyond the active subsystem depth. |
| <a id="tr-2"></a>**TR-2** | trust-boundary | seeded | — | Verify installer parsing and config merging preserve unrelated user configuration, back up destructive overwrites, and reject path traversal. |
| <a id="vg-1"></a>**VG-1** | validation-gate | discovered | [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) | Verify every published health signal is computed from a source that production code actually populates. A gate whose denominator is structurally always zero reports green regardless of system state and is not evidence of health. |

