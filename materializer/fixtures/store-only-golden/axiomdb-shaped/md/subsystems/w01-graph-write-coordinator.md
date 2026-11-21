# **W-01** — Graph write coordinator

*Scope, structure, boundaries, defects, and the survey record for Graph write coordinator. Use it when you have picked a subsystem.*

Terms on this page: [Survey](../how-to-read.md#term-survey) · [Subsystem](../how-to-read.md#term-subsystem) · [Layer](../how-to-read.md#term-layer) · [Survey depth](../how-to-read.md#term-survey-depth) · [Mapped](../how-to-read.md#term-mapped) · [Scope](../how-to-read.md#term-scope) · [Evidence](../how-to-read.md#term-evidence) · [Claim](../how-to-read.md#term-claim) · [Challenge](../how-to-read.md#term-challenge) · [Concern](../how-to-read.md#term-concern) · [Concern review](../how-to-read.md#term-concern-review) · [Finding](../how-to-read.md#term-finding) · [Lead](../how-to-read.md#term-lead) · [Decision needed](../how-to-read.md#term-decision-needed) · [System boundary](../how-to-read.md#term-system-boundary) · [Recorded edge](../how-to-read.md#term-recorded-edge) · [Standing](../how-to-read.md#term-standing) · [Purpose, account](../how-to-read.md#term-purpose-account)

**Status**: 🟢 mapped  
**Layer**: —

## Purpose

**W-01** serializes writes to one graph and holds them back while a rebuild runs.

*Written by a survey session at `c3b1492c` from 1 evidence row(s). Whether the files it cites have changed since is not measured here.*

## Scope

No scope statement is recorded for this subsystem. The file ledger in its survey record is the only account of what belongs to it.

## How it works

A write takes the graph lock, waits on the fence, and commits through the write core.

*Written by a survey session at `c3b1492c` from 1 evidence row(s). Whether the files it cites have changed since is not measured here.*

## Structure

### Structural inventory not recorded as claims

No structural claim is recorded for this subsystem. The survey artifact is rendered below, under Survey record. Its source is `W-01-graph-write-coordinator.md` at content hash `669e0ceddf41`, recorded at `c3b1492c0da8`, written on 2026-09-26.

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-01](../seams.md#sm-01)** | index permutations | **[S-01](s01-storage-substrate.md)** (Storage substrate) | both parties are `mapped` |
| **[SM-02](../seams.md#sm-02)** | snapshot generation | **[Q-01](q01-query-front-end.md)** (Query front end) | not yet: both parties must be `mapped` |

## Vocabulary

**Domain vocabulary** — not recorded. Neither a term nor a declination has been recorded for this subsystem, so nobody has answered the question either way.

## Known defects here

No defect here is open or awaiting verification.

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 1 of 1 ledger row |
| Files in scope, not yet read | 0 of 1 |
| Files excluded from the survey obligation | 0 of 1 |
| Ledger rows the repository has changed under | 0 of 1 |
| Active concerns with a disposition recorded here | 1 of 2 — 1 confirmed-acceptable |
| Findings by resolution state | none recorded |
| Seams assessable from both sides | 1 of 2 |

## Survey record

### File ledger

- **No reason recorded** — examined, 1 file, examined at `c3b1492c`
    - <a id="le-c0468ac389"></a>`crates/quad-core/src/write/coordinator.rs`

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[concern CC-1](../concerns.md#cc-1)** | confirmed-acceptable | code-verified |  | The lock is held across the commit. |

### Survey artifact

*Written on 2026-09-26 at revision c3b1492c as the survey's working notes, and kept as written. The account above was recorded on 2026-09-01 at revision c3b1492c; where the two disagree, the later one is the current reading.*

*As written at 2026-09-26, revision `c3b1492c`; kept as written, not tied to evidence.*

#### **W-01** — Graph write coordinator

##### Structural inventory (Phase 2)

###### Key types

| Symbol | Role | Source |
|---|---|---|
| `GraphLock` | Shared per-graph lock handle. | `coordinator.rs:31` |
| `WriteFence` | Blocks writers while a rebuild runs. | `coordinator.rs:273-410` |

###### Data flow — coordinated write (`execute_inner`)

1. Take the graph lock.
2. Check the fence.
3. Commit through the write core.

```rust
let _guard = locks.graph(graph_id).lock();
fence.wait_inactive();
core.commit(batch)?;
```

##### Concern assessment

| Concern | Classification | Evidence |
|---|---|---|
| [concern CC-1](../concerns.md#cc-1) | confirmed-acceptable | `coordinator.rs:1170` |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
