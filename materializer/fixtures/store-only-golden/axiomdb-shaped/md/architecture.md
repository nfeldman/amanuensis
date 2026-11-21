# Architecture

*Runtime shape, recorded edges, and boundaries, read as one connected system. Use it when you want the overall shape before reading any one part.*

Terms on this page: [Subsystem](how-to-read.md#term-subsystem) · [Layer](how-to-read.md#term-layer) · [Survey depth](how-to-read.md#term-survey-depth) · [System boundary](how-to-read.md#term-system-boundary) · [Recorded edge](how-to-read.md#term-recorded-edge) · [Purpose, account](how-to-read.md#term-purpose-account)

## How the parts fit together

The store keeps quads in five orders and one write path per graph.

*Written by a survey session at `c3b1492c` from 2 evidence row(s). Whether the files it cites have changed since is not measured here.*

- **[Q-01](subsystems/q01-query-front-end.md) — Query front end**: Not recorded
- **[S-01](subsystems/s01-storage-substrate.md) — Storage substrate**: [S-01](subsystems/s01-storage-substrate.md) stores each quad under five key orders.
- **[W-01](subsystems/w01-graph-write-coordinator.md) — Graph write coordinator**: [W-01](subsystems/w01-graph-write-coordinator.md) serializes writes to one graph and holds them back while a rebuild runs.

## Runtime boundary map

_Projected from the recorded runtime boundaries; mechanisms and targets are preserved as recorded._

| Runtime / Process | Language | Communicates with | Mechanism | Notes |
|---|---|---|---|---|
| Embedded `quad-core` | Rust | Host application (in-process) | Direct API | The primary deployment. |
| `quad-server` | Rust | Clients | gRPC over HTTP/2 | Optional TLS. |
| `quad-server` | Rust | Clients | HTTP (SPARQL protocol) | Plaintext unless terminated upstream. |

Imported from the onboarding report and not tied to evidence: Embedded `quad-core` → Host application (in-process) by Direct API; `quad-server` → Clients by gRPC over HTTP/2; `quad-server` → Clients by HTTP (SPARQL protocol).

## Subsystem atlas

_No dependency edges are recorded in this publication. The layer map below is a subsystem atlas, not an inferred dependency graph._

| Region | Subsystem | Survey depth |
|---|---|---|
| Other | **[Q-01](subsystems/q01-query-front-end.md)** Query front end | Structural |
| Other | **[S-01](subsystems/s01-storage-substrate.md)** Storage substrate | Mapped |
| Other | **[W-01](subsystems/w01-graph-write-coordinator.md)** Graph write coordinator | Mapped |

## Recorded boundaries

_0 of 3 subsystems have no recorded boundary. Each seam below joins two recorded subsystems; no line is inferred from a name or a layer._

| Layer | Subsystem | Boundary | Other end |
|---|---|---|---|
| unlayered | **[Q-01](subsystems/q01-query-front-end.md)** Query front end | **[SM-02](seams.md#sm-02)** seam | **[W-01](subsystems/w01-graph-write-coordinator.md)** Graph write coordinator |
| unlayered | **[S-01](subsystems/s01-storage-substrate.md)** Storage substrate | **[SM-01](seams.md#sm-01)** seam | **[W-01](subsystems/w01-graph-write-coordinator.md)** Graph write coordinator |
| unlayered | **[W-01](subsystems/w01-graph-write-coordinator.md)** Graph write coordinator | **[SM-01](seams.md#sm-01)** seam | **[S-01](subsystems/s01-storage-substrate.md)** Storage substrate |
| unlayered | **[W-01](subsystems/w01-graph-write-coordinator.md)** Graph write coordinator | **[SM-02](seams.md#sm-02)** seam | **[Q-01](subsystems/q01-query-front-end.md)** Query front end |

## Seam topology

| Seam | Party A | Shared object | Party B |
|---|---|---|---|
| **[SM-01](seams.md#sm-01)** | **[W-01](subsystems/w01-graph-write-coordinator.md)** Graph write coordinator | index permutations | **[S-01](subsystems/s01-storage-substrate.md)** Storage substrate |
| **[SM-02](seams.md#sm-02)** | **[W-01](subsystems/w01-graph-write-coordinator.md)** Graph write coordinator | snapshot generation | **[Q-01](subsystems/q01-query-front-end.md)** Query front end |

## Staleness map

_No stale files across 3 scoped files carrying a survey obligation, at the last reconciliation._
