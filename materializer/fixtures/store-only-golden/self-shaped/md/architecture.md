# Architecture

*Runtime shape, recorded edges, and boundaries, read as one connected system. Use it when you want the overall shape before reading any one part.*

Terms on this page: [Subsystem](how-to-read.md#term-subsystem) · [Layer](how-to-read.md#term-layer) · [Survey depth](how-to-read.md#term-survey-depth) · [System boundary](how-to-read.md#term-system-boundary) · [Recorded edge](how-to-read.md#term-recorded-edge) · [Purpose, account](how-to-read.md#term-purpose-account)

## How the parts fit together

The server records a survey in one database; the materializer publishes pages from it.

*Written by a survey session at `c3b1492c` from 2 evidence row(s). Whether the files it cites have changed since is not measured here.*

- **[B-01](subsystems/b01-survey-method.md) — Survey method**: [B-01](subsystems/b01-survey-method.md) tells the agent what to read and what to record.
- **[B-02](subsystems/b02-record-store.md) — Record store**: [B-02](subsystems/b02-record-store.md) holds every record the survey writes.
- **[B-03](subsystems/b03-page-materializer.md) — Page materializer**: Not recorded

## Runtime boundary map

_Projected from the recorded runtime boundaries; mechanisms and targets are preserved as recorded._

| Runtime / Process | Language | Communicates with | Mechanism | Notes |
|---|---|---|---|---|
| MCP server | TypeScript | Agent host | stdio JSON-RPC | One process per session. |
| MCP server | TypeScript | Materializer | Subprocess | Spawned per publish. |

Imported from the onboarding report and not tied to evidence: MCP server → Agent host by stdio JSON-RPC; MCP server → Materializer by Subprocess.

## Subsystem atlas

_No dependency edges are recorded in this publication. The layer map below is a subsystem atlas, not an inferred dependency graph._

| Region | Subsystem | Survey depth |
|---|---|---|
| Other | **[B-01](subsystems/b01-survey-method.md)** Survey method | Structural |
| Other | **[B-02](subsystems/b02-record-store.md)** Record store | Structural |
| Other | **[B-03](subsystems/b03-page-materializer.md)** Page materializer | Scoped |

## Recorded boundaries

_No boundary between subsystems is recorded, so no diagram is drawn. 3 of 3 subsystems have no recorded boundary._

## Seam topology

_No seams recorded yet._

## Staleness map

_No stale files across 2 scoped files carrying a survey obligation, at the last reconciliation._

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
