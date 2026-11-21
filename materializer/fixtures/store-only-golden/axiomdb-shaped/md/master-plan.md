# Subsystem map

*Every region, grouped by layer, with the scope recorded for it. Use it when you are looking for the part of the code that does something.*

Terms on this page: [Subsystem](how-to-read.md#term-subsystem) · [Layer](how-to-read.md#term-layer) · [Survey depth](how-to-read.md#term-survey-depth) · [Mapped](how-to-read.md#term-mapped) · [Scope](how-to-read.md#term-scope) · [Finding](how-to-read.md#term-finding)

| Region | Subsystem | Survey depth |
|---|---|---|
| unlayered | **[Q-01](subsystems/q01-query-front-end.md)** Query front end | Structural |
| unlayered | **[S-01](subsystems/s01-storage-substrate.md)** Storage substrate | Mapped |
| unlayered | **[W-01](subsystems/w01-graph-write-coordinator.md)** Graph write coordinator | Mapped |

## unlayered

| Priority | ID | Name | Status | Purpose | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|---|
| — | **[Q-01](subsystems/q01-query-front-end.md)** | Query front end | 🟠 structural | Not recorded | — | — | 0 (0 open) |
| — | **[S-01](subsystems/s01-storage-substrate.md)** | Storage substrate | 🟢 mapped | [S-01](subsystems/s01-storage-substrate.md) stores each quad under five key orders. | — | — | 0 (0 open) |
| — | **[W-01](subsystems/w01-graph-write-coordinator.md)** | Graph write coordinator | 🟢 mapped | [W-01](subsystems/w01-graph-write-coordinator.md) serializes writes to one graph and holds them back while a rebuild runs. | — | — | 0 (0 open) |

