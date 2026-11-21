# Concerns

*Which failure modes were tested where, and the disposition each one reached. Use it when you want to know which defect kinds were checked where.*

Terms on this page: [Evidence](how-to-read.md#term-evidence) · [Concern](how-to-read.md#term-concern) · [Concern review](how-to-read.md#term-concern-review)

## Coverage overview

| Subsystem | **CC-1** | **CC-2** | **CC-3** | **SC-1** |
|---|---|---|---|---|
| **[B-01](subsystems/b01-read-path.md)** Read path | 🔴 | — | — | 🟡 |
| **[B-02](subsystems/b02-write-path.md)** Write path | — | 🟢 | — | — |
| **[B-03](subsystems/b03-queue.md)** Queue | — | — | — | 🟡 |
| **[F-01](subsystems/f01-console.md)** Console | — | — | ⚪ | — |
| **[F-02](subsystems/f02-widgets.md)** Widgets | — | — | — | — |

**Legend**: 🟢 ruled-out · 🟡 confirmed-acceptable · 🔴 confirmed-bug · ⚠️ unresolved-competition · ⚪ out-of-scope · 🔗 linchpin-dependent · — not assessed

## Active concerns

| Code | Category | Origin | Discovered in | Notes |
|---|---|---|---|---|
| <a id="cc-1"></a>**concern CC-1** | concurrency | seeded | — |  |
| <a id="cc-2"></a>**concern CC-2** | data-integrity | seeded | — |  |
| <a id="cc-3"></a>**concern CC-3** | error-handling | seeded | — |  |
| <a id="sc-1"></a>**concern SC-1** | composition | seeded | — |  |

## Retired/merged concerns

- **concern CC-9** — retired · 

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
