# Architecture

*Runtime shape, recorded edges, and boundaries, read as one connected system. Use it when you want the overall shape before reading any one part.*

Terms on this page: [Subsystem](how-to-read.md#term-subsystem) · [Layer](how-to-read.md#term-layer) · [Survey depth](how-to-read.md#term-survey-depth) · [System boundary](how-to-read.md#term-system-boundary) · [Recorded edge](how-to-read.md#term-recorded-edge) · [Purpose, account](how-to-read.md#term-purpose-account)

## How the parts fit together

No account of how the parts fit together is recorded.

- **[B-01](subsystems/b01-job-scheduler.md) — Job Scheduler**: Not recorded
- **[B-02](subsystems/b02-auth-service.md) — Auth Service**: Not recorded
- **[F-01](subsystems/f01-web-ui.md) — Web UI**: Not recorded

## Runtime boundary map

_Projected from the recorded runtime boundaries; mechanisms and targets are preserved as recorded._

| Runtime / Process | Language | Communicates with | Mechanism | Notes |
|---|---|---|---|---|
| Host agent | external | scheduler service | stdio RPC | Starts the scheduler process. |
| Scheduler service | Python | auth service | HTTPS request | Dispatches authenticated jobs. |
| Auth service | TypeScript | policy database | SQL transaction | Owns authorization decisions. |

Imported from the onboarding report and not tied to evidence: Host agent → scheduler service by stdio RPC; Scheduler service → auth service by HTTPS request; Auth service → policy database by SQL transaction.

## Subsystem dependency graph

_1 of 3 recorded subsystems carries no recorded edge; the table below is what the survey recorded, not the whole dependency surface. No edge is inferred from a name, a prefix, or a nearby seam._

| From | Relationship | To | Strength | Context |
|---|---|---|---|---|
| **[B-01](subsystems/b01-job-scheduler.md)** Job Scheduler | dependency | **[B-02](subsystems/b02-auth-service.md)** Auth Service | confirmed | [B-01](subsystems/b01-job-scheduler.md) calls [B-02](subsystems/b02-auth-service.md) on job start |

## Recorded boundaries

_1 of 3 subsystems has no recorded boundary. Each seam and each recorded dependency below joins two recorded subsystems; no line is inferred from a name or a layer._

| Layer | Subsystem | Boundary | Other end |
|---|---|---|---|
| backend | **[B-01](subsystems/b01-job-scheduler.md)** Job Scheduler | **[SM-01](seams.md#sm-01)** seam | **[B-02](subsystems/b02-auth-service.md)** Auth Service |
| backend | **[B-01](subsystems/b01-job-scheduler.md)** Job Scheduler | dependency → | **[B-02](subsystems/b02-auth-service.md)** Auth Service |
| backend | **[B-02](subsystems/b02-auth-service.md)** Auth Service | **[SM-01](seams.md#sm-01)** seam | **[B-01](subsystems/b01-job-scheduler.md)** Job Scheduler |
| backend | **[B-02](subsystems/b02-auth-service.md)** Auth Service | ← dependency | **[B-01](subsystems/b01-job-scheduler.md)** Job Scheduler |
| frontend | **[F-01](subsystems/f01-web-ui.md)** Web UI | none recorded | — |

## Seam topology

| Seam | Party A | Shared object | Party B |
|---|---|---|---|
| **[SM-01](seams.md#sm-01)** | **[B-01](subsystems/b01-job-scheduler.md)** Job Scheduler | jobs_queue | **[B-02](subsystems/b02-auth-service.md)** Auth Service |

## Staleness map

_No staleness data recorded. No files have been scoped, so this view reports absence of measurement rather than freshness._

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
