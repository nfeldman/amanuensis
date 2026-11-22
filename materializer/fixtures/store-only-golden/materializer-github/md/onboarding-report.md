# Onboarding report

*The repository boundary and initial decomposition that established this conspectus. Use it when you want the first pass's decisions about scope and split.*

Terms on this page: [Conspectus](how-to-read.md#term-conspectus) · [Subsystem](how-to-read.md#term-subsystem)

*As written at 2026-10-02, revision `deadbeef`; kept as written, not tied to evidence.*

**Codebase**: FictionalProject — materializer fixture

## Directory clusters

- scheduler/ — [B-01](subsystems/b01-job-scheduler.md) (Job Scheduler)
- auth/ — [B-02](subsystems/b02-auth-service.md) (Auth Service)
- web/ — [F-01](subsystems/f01-web-ui.md) (Web UI)

## Runtime boundary map

| Runtime / Process | Language | Communicates with | Mechanism | Notes |
|---|---|---|---|---|
| Host agent | external | scheduler service | stdio RPC | Starts the scheduler process. |
| Scheduler service | Python | auth service | HTTPS request | Dispatches authenticated jobs. |
| Auth service | TypeScript | policy database | SQL transaction | Owns authorization decisions. |
