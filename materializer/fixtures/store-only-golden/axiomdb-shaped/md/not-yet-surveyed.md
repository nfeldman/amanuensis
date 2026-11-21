# Not yet surveyed

*The recorded edge of the map, each gap counted over the unit it occupies. Use it when you want to know what the survey has not covered.*

Terms on this page: [Survey](how-to-read.md#term-survey) · [Subsystem](how-to-read.md#term-subsystem) · [Survey depth](how-to-read.md#term-survey-depth) · [Mapped](how-to-read.md#term-mapped) · [Scope](how-to-read.md#term-scope) · [Concern](how-to-read.md#term-concern)

Counted at `d395c4d5a9e1` on `main`.

## Paths with no ledger row

No tracked paths is recorded, so this gap is not measured here. That is a statement about the record, not a claim that the gap is closed. Not measured — no reconciliation has been recorded for this store, at `d395c4d5a9e1` or at any other revision.

## Files in scope that no one has read

**0 of 3** ledger rows that carry a survey obligation are classified `candidate`: the file participates in its subsystem and no one has read it.

## Subsystems set aside

**0 of 3** subsystems are deferred. `deferred` is not a rung on the survey ladder but an orthogonal do-not-survey flag, so nothing in them has been surveyed at any depth.

## Seam sides no one has assessed

**4 of 4** (seam, side) pairs carry no recorded assessment. The unit is the pair, not the seam: a seam assessed from one side only is half-known, and counting seams would report it as covered.

Binding: per-party-proxy; no seam-bound disposition is recorded. An `SC-%` disposition says a party has assessed some seam concern, never that it assessed this seam.

| Seam | Unassessed party | Other party | Why |
|---|---|---|---|
| **[SM-01](seams.md#sm-01)** | [Graph write coordinator](subsystems/w01-graph-write-coordinator.md) **[W-01](subsystems/w01-graph-write-coordinator.md)** | **[S-01](subsystems/s01-storage-substrate.md)** (Storage substrate) | this party holds no `SC-%` disposition |
| **[SM-01](seams.md#sm-01)** | [Storage substrate](subsystems/s01-storage-substrate.md) **[S-01](subsystems/s01-storage-substrate.md)** | **[W-01](subsystems/w01-graph-write-coordinator.md)** | this party holds no `SC-%` disposition |
| **[SM-02](seams.md#sm-02)** | [Graph write coordinator](subsystems/w01-graph-write-coordinator.md) **[W-01](subsystems/w01-graph-write-coordinator.md)** | **[Q-01](subsystems/q01-query-front-end.md)** (Query front end) | the seam is not assessable: both parties must be `mapped` |
| **[SM-02](seams.md#sm-02)** | [Query front end](subsystems/q01-query-front-end.md) **[Q-01](subsystems/q01-query-front-end.md)** | **[W-01](subsystems/w01-graph-write-coordinator.md)** | the seam is not assessable: both parties must be `mapped` |

## Concerns no one has dispositioned here

**5 of 6** (subsystem, active concern) pairs carry no disposition. The unit is the pair: a concern dispositioned somewhere else says nothing about this subsystem, and counting concern codes would report a checklist as complete while most regions were never tested against it.

| Subsystem | Undispositioned | Concerns |
|---|---|---|
| [Query front end](subsystems/q01-query-front-end.md) **[Q-01](subsystems/q01-query-front-end.md)** | 2 of 2 | **[concern CC-1](concerns.md#cc-1)**, **[concern CC-2](concerns.md#cc-2)** |
| [Storage substrate](subsystems/s01-storage-substrate.md) **[S-01](subsystems/s01-storage-substrate.md)** | 2 of 2 | **[concern CC-1](concerns.md#cc-1)**, **[concern CC-2](concerns.md#cc-2)** |
| [Graph write coordinator](subsystems/w01-graph-write-coordinator.md) **[W-01](subsystems/w01-graph-write-coordinator.md)** | 1 of 2 | **[concern CC-2](concerns.md#cc-2)** |

