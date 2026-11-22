# Subsystem map

*Every region, grouped by layer, with the scope recorded for it. Use it when you are looking for the part of the code that does something.*

Terms on this page: [Subsystem](how-to-read.md#term-subsystem) · [Layer](how-to-read.md#term-layer) · [Survey depth](how-to-read.md#term-survey-depth) · [Mapped](how-to-read.md#term-mapped) · [Scope](how-to-read.md#term-scope) · [Finding](how-to-read.md#term-finding)

| Region | Subsystem | Survey depth |
|---|---|---|
| backend | **[B-01](subsystems/b01-job-scheduler.md)** Job Scheduler | Mapped |
| backend | **[B-02](subsystems/b02-auth-service.md)** Auth Service | Mapped |
| frontend | **[F-01](subsystems/f01-web-ui.md)** Web UI | Scoped |

## backend

| Priority | ID | Name | Status | Purpose | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|---|
| — | **[B-01](subsystems/b01-job-scheduler.md)** | Job Scheduler | 🟢 mapped | Not recorded | scheduler/** | scheduler/main.ts | 1 (0 open) |
| — | **[B-02](subsystems/b02-auth-service.md)** | Auth Service | 🟢 mapped | Not recorded | auth/** | auth/index.ts | 1 (1 open) |

## frontend

| Priority | ID | Name | Status | Purpose | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|---|
| — | **[F-01](subsystems/f01-web-ui.md)** | Web UI | 🔵 scoping | Not recorded | web/** | web/main.tsx | 0 (0 open) |

