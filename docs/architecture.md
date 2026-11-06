# Architecture

## Runtime boundary map

_Projected from the recorded [onboarding runtime boundary table](onboarding-report.md#runtime-boundary-map); mechanisms and targets are preserved as surveyed._

| Runtime / Process | Language | Communicates with | Mechanism | Notes |
|---|---|---|---|---|
| MCP server | TypeScript | Host | stdio | One process, spawned by the host |
| MCP server | TypeScript | `git` | Subprocess | Revision resolution in the workspace |
| MCP server | TypeScript | Storage git repository | Subprocess | Checkpoints of the store |
| MCP server | TypeScript | Materializer | Spawned `python3` | Python; renders the store to Markdown and HTML |
| MCP server | TypeScript | SQLite store | `better-sqlite3` | Workspace-local `.amanuensis/`; two worktrees hold two stores under one project key |

## Subsystem atlas

_No dependency edges are recorded in this publication. The layer map below is a subsystem atlas, not an inferred dependency graph._

| Region | Subsystem | Survey depth |
|---|---|---|
| Coordination | **[B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)** Survey methodology and agent contracts | adversarial |
| Delivery | **[B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)** Packaging, installer, validation, and product docs | concerns |
| Delivery | **[B-08](subsystems/b08-activation-evidence-and-release-readiness.md)** Activation evidence and release readiness | unmapped |
| Design evidence | **[B-06](subsystems/b06-report-interface-design-and-validation-studies.md)** Report interface design and validation studies | unmapped |
| Design evidence | **[B-09](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md)** Conspectus design lanes, their drivers and receipts | unmapped |
| Projection | **[B-04](subsystems/b04-diff-aware-materializer.md)** Diff-aware materializer | adversarial |
| Research evidence | **[B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md)** Embedded research surveys and platform trials | concerns |
| Runtime | **[B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)** MCP core, persistence, and lifecycle | adversarial |
| Runtime | **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** Knowledge tools and workflow API | adversarial |

## Seam topology

_No seams recorded yet._

## Staleness map

```mermaid
pie showData
    title Stale entries by subsystem
    "B-05" : 7
    "B-04" : 5
    "B-01" : 2
    "B-09" : 1
    "B-03" : 1
```
