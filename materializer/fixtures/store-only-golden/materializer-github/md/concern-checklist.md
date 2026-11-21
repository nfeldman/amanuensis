# Concern checklist (calibrated)

*The concern set and its provenance. Use it when you want the list of defect kinds and where it came from.*

Terms on this page: [Concern](how-to-read.md#term-concern)

*As written at 2026-10-02, revision `deadbeef`; kept as written, not tied to evidence.*

## Active concerns (3)

| Code | Category | Territory | Codebase-specific probe (abbreviated) | Primary subsystems |
|---|---|---|---|---|
| [concern CC-1](concerns.md#cc-1) | cache-coherence | T2 | Does the scheduler retain stale authorization state after a policy change? | [B-01](subsystems/b01-job-scheduler.md) (Job Scheduler), [B-02](subsystems/b02-auth-service.md) (Auth Service) |
| CC-2 | cache-coherence | T2 | Trace every holder of the shared policy snapshot. | [B-02](subsystems/b02-auth-service.md) |
| [concern TC-1](concerns.md#tc-1) | trust-boundary | T10 | Verify that every public request path validates its caller. | [B-02](subsystems/b02-auth-service.md), [F-01](subsystems/f01-web-ui.md) (Web UI) |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
