# Seams

*Shared objects and ordering assumptions where independently understandable subsystems meet. Use it when you are changing something two subsystems share.*

Terms on this page: [Concern](how-to-read.md#term-concern) · [System boundary](how-to-read.md#term-system-boundary)

| Seam | Party A | Shared object | Party B |
|---|---|---|---|
| **[SM-01](seams.md#sm-01)** | **[W-01](subsystems/w01-graph-write-coordinator.md)** Graph write coordinator | index permutations | **[S-01](subsystems/s01-storage-substrate.md)** Storage substrate |
| **[SM-02](seams.md#sm-02)** | **[W-01](subsystems/w01-graph-write-coordinator.md)** Graph write coordinator | snapshot generation | **[Q-01](subsystems/q01-query-front-end.md)** Query front end |

| Seam | Shared object | Kind | Parties | Assessable? | Notes |
|---|---|---|---|---|---|
| <a id="sm-01"></a>**SM-01** | index permutations | table | **[W-01](subsystems/w01-graph-write-coordinator.md)** ↔ **[S-01](subsystems/s01-storage-substrate.md)** | ✅ |  |
| <a id="sm-02"></a>**SM-02** | snapshot generation | shared-memory | **[W-01](subsystems/w01-graph-write-coordinator.md)** ↔ **[Q-01](subsystems/q01-query-front-end.md)** | ⏳ |  |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
