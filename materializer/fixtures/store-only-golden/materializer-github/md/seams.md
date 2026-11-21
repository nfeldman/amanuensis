# Seams

*Shared objects and ordering assumptions where independently understandable subsystems meet. Use it when you are changing something two subsystems share.*

Terms on this page: [Concern](how-to-read.md#term-concern) · [System boundary](how-to-read.md#term-system-boundary)

| Seam | Party A | Shared object | Party B |
|---|---|---|---|
| **[SM-01](seams.md#sm-01)** | **[B-01](subsystems/b01-job-scheduler.md)** Job Scheduler | jobs_queue | **[B-02](subsystems/b02-auth-service.md)** Auth Service |

| Seam | Shared object | Kind | Parties | Assessable? | Notes |
|---|---|---|---|---|---|
| <a id="sm-01"></a>**SM-01** | jobs_queue | queue | **[B-01](subsystems/b01-job-scheduler.md)** ↔ **[B-02](subsystems/b02-auth-service.md)** | ✅ |  |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
