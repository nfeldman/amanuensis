# Concerns

*Which failure modes were tested where, and the disposition each one reached. Use it when you want to know which defect kinds were checked where.*

Terms on this page: [Evidence](how-to-read.md#term-evidence) · [Concern](how-to-read.md#term-concern) · [Concern review](how-to-read.md#term-concern-review)

## Coverage overview

| Subsystem | **CB-1** | **CC-1** | **TC-1** |
|---|---|---|---|
| **[B-01](subsystems/b01-job-scheduler.md)** Job Scheduler | 🟡 | 🟢 | — |
| **[B-02](subsystems/b02-auth-service.md)** Auth Service | — | — | 🔴 |
| **[F-01](subsystems/f01-web-ui.md)** Web UI | — | — | — |

**Legend**: 🟢 ruled-out · 🟡 confirmed-acceptable · 🔴 confirmed-bug · ⚠️ unresolved-competition · ⚪ out-of-scope · 🔗 linchpin-dependent · — not assessed

## Active concerns

| Code | Category | Origin | Discovered in | Notes |
|---|---|---|---|---|
| <a id="cb-1"></a>**concern CB-1** | concurrency | seeded | — |  |
| <a id="cc-1"></a>**concern CC-1** | cache-coherence | seeded | — |  |
| <a id="tc-1"></a>**concern TC-1** | trust-boundary | seeded | — |  |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
