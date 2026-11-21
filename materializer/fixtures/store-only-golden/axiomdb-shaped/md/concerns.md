# Concerns

*Which failure modes were tested where, and the disposition each one reached. Use it when you want to know which defect kinds were checked where.*

Terms on this page: [Evidence](how-to-read.md#term-evidence) · [Concern](how-to-read.md#term-concern) · [Concern review](how-to-read.md#term-concern-review)

## Coverage overview

| Subsystem | **CC-1** | **CC-2** |
|---|---|---|
| **[Q-01](subsystems/q01-query-front-end.md)** Query front end | — | — |
| **[S-01](subsystems/s01-storage-substrate.md)** Storage substrate | — | — |
| **[W-01](subsystems/w01-graph-write-coordinator.md)** Graph write coordinator | 🟡 | — |

**Legend**: 🟢 ruled-out · 🟡 confirmed-acceptable · 🔴 confirmed-bug · ⚠️ unresolved-competition · ⚪ out-of-scope · 🔗 linchpin-dependent · — not assessed

## Active concerns

| Code | Category | Origin | Discovered in | Notes |
|---|---|---|---|---|
| <a id="cc-1"></a>**concern CC-1** | concurrency | seeded | — |  |
| <a id="cc-2"></a>**concern CC-2** | data-integrity | seeded | — |  |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
