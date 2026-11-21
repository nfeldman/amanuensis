# Entry point

*A dated reading path recorded by an earlier session; it is survey history, not a current index. Use it when you want the reading path an earlier session wrote.*

Terms on this page: [Session](how-to-read.md#term-session)

*As written at 2026-10-02, revision `deadbeef`; kept as written, not tied to evidence.*

This is a fictional test codebase with three subsystems: [B-01](subsystems/b01-job-scheduler.md) (Job Scheduler) (scheduler), [B-02](subsystems/b02-auth-service.md) (Auth Service) (auth), and [F-01](subsystems/f01-web-ui.md) (Web UI) (web UI). The seam [SM-01](seams.md#sm-01) connects them.

## File ledger

| Path | Classification | Why in scope | Ref SHA |
|---|---|---|---|
| `scheduler/main.ts` | examined | Owns the job dispatch boundary and its auth call. | `deadbeef` |

## State containers

| Name | Location | Stores | Lifetime | Populated by | Invalidated by |
|---|---|---|---|---|---|
| `JobQueue` | `scheduler/main.ts` | Pending jobs | Process | Dispatcher | Restart |

## Non applicable territories

| Territory | Attenuating condition |
|---|---|
| Native memory | The runtime owns allocation for this service. |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
