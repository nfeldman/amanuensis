# Seams

*Shared objects and ordering assumptions where independently understandable subsystems meet. Use it when you are changing something two subsystems share.*

Terms on this page: [Concern](how-to-read.md#term-concern) · [System boundary](how-to-read.md#term-system-boundary)

| Seam | Party A | Shared object | Party B |
|---|---|---|---|
| **[SM-1](seams.md#sm-1)** | **[B-01](subsystems/b01-read-path.md)** Read path | the row buffer | **[B-02](subsystems/b02-write-path.md)** Write path |
| **[SM-2](seams.md#sm-2)** | **[B-02](subsystems/b02-write-path.md)** Write path | the queue handle | **[B-03](subsystems/b03-queue.md)** Queue |
| **[SM-3](seams.md#sm-3)** | **[B-01](subsystems/b01-read-path.md)** Read path | the console bridge | **[F-01](subsystems/f01-console.md)** Console |

| Seam | Shared object | Kind | Parties | Assessable? | Notes |
|---|---|---|---|---|---|
| <a id="sm-1"></a>**SM-1** | the row buffer | — | **[B-01](subsystems/b01-read-path.md)** ↔ **[B-02](subsystems/b02-write-path.md)** | ✅ |  |
| <a id="sm-2"></a>**SM-2** | the queue handle | — | **[B-02](subsystems/b02-write-path.md)** ↔ **[B-03](subsystems/b03-queue.md)** | ⏳ |  |
| <a id="sm-3"></a>**SM-3** | the console bridge | — | **[B-01](subsystems/b01-read-path.md)** ↔ **[F-01](subsystems/f01-console.md)** | ⏳ |  |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
