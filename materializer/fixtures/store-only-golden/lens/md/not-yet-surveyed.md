# Not yet surveyed

*The recorded edge of the map, each gap counted over the unit it occupies. Use it when you want to know what the survey has not covered.*

Terms on this page: [Survey](how-to-read.md#term-survey) · [Subsystem](how-to-read.md#term-subsystem) · [Survey depth](how-to-read.md#term-survey-depth) · [Mapped](how-to-read.md#term-mapped) · [Scope](how-to-read.md#term-scope) · [Concern](how-to-read.md#term-concern)

Counted at `cfc2c80635e9` on `main`.

## Paths with no ledger row

**4 of 15** tracked paths are named by no `file_ledger` row in any subsystem. They participate in no subsystem's scope, so nothing here has been read, excluded, or deferred.

### (repository root) — 1 path

- `README.md`

### docs — 1 path

- `docs/guide.md`

### src — 1 path

- `src/new.ts`

### tools — 1 path

- `tools/build.sh`

## Files in scope that no one has read

**4 of 13** ledger rows that carry a survey obligation are classified `candidate`: the file participates in its subsystem and no one has read it.

### Read path **[B-01](subsystems/b01-read-path.md)** — 1 unread of 6 rows carrying an obligation

- `src/a.b.ts` — In scope for [B-01](subsystems/b01-read-path.md).

### Write path **[B-02](subsystems/b02-write-path.md)** — 1 unread of 4 rows carrying an obligation

- `src/mixed.ts` — In scope for [B-02](subsystems/b02-write-path.md).

### Queue **[B-03](subsystems/b03-queue.md)** — 2 unread of 2 rows carrying an obligation

- `src/pending.ts` — In scope for [B-03](subsystems/b03-queue.md).
- `src/queue.ts` — In scope for [B-03](subsystems/b03-queue.md).

## Subsystems set aside

**2 of 5** subsystems are deferred. `deferred` is not a rung on the survey ladder but an orthogonal do-not-survey flag, so nothing in them has been surveyed at any depth.

| Subsystem | Layer | Recorded reason |
|---|---|---|
| [Console](subsystems/f01-console.md) **[F-01](subsystems/f01-console.md)** | frontend | Set aside: the console is vendored from upstream and is not read here. |
| [Widgets](subsystems/f02-widgets.md) **[F-02](subsystems/f02-widgets.md)** | frontend | No reason is recorded. |

## Seam sides no one has assessed

**5 of 6** (seam, side) pairs carry no recorded assessment. The unit is the pair, not the seam: a seam assessed from one side only is half-known, and counting seams would report it as covered.

Binding: per-party-proxy; no seam-bound disposition is recorded. An `SC-%` disposition says a party has assessed some seam concern, never that it assessed this seam.

| Seam | Unassessed party | Other party | Why |
|---|---|---|---|
| **[SM-1](seams.md#sm-1)** | [Write path](subsystems/b02-write-path.md) **[B-02](subsystems/b02-write-path.md)** | **[B-01](subsystems/b01-read-path.md)** | this party holds no `SC-%` disposition |
| **[SM-2](seams.md#sm-2)** | [Write path](subsystems/b02-write-path.md) **[B-02](subsystems/b02-write-path.md)** | **[B-03](subsystems/b03-queue.md)** | the seam is not assessable: both parties must be `mapped` |
| **[SM-2](seams.md#sm-2)** | [Queue](subsystems/b03-queue.md) **[B-03](subsystems/b03-queue.md)** | **[B-02](subsystems/b02-write-path.md)** | the seam is not assessable: both parties must be `mapped` |
| **[SM-3](seams.md#sm-3)** | [Read path](subsystems/b01-read-path.md) **[B-01](subsystems/b01-read-path.md)** | **[F-01](subsystems/f01-console.md)** | the seam is not assessable: both parties must be `mapped` |
| **[SM-3](seams.md#sm-3)** | [Console](subsystems/f01-console.md) **[F-01](subsystems/f01-console.md)** | **[B-01](subsystems/b01-read-path.md)** | the seam is not assessable: both parties must be `mapped` |

## Concerns no one has dispositioned here

**15 of 20** (subsystem, active concern) pairs carry no disposition. The unit is the pair: a concern dispositioned somewhere else says nothing about this subsystem, and counting concern codes would report a checklist as complete while most regions were never tested against it.

| Subsystem | Undispositioned | Concerns |
|---|---|---|
| [Read path](subsystems/b01-read-path.md) **[B-01](subsystems/b01-read-path.md)** | 2 of 4 | **[concern CC-2](concerns.md#cc-2)**, **[concern CC-3](concerns.md#cc-3)** |
| [Write path](subsystems/b02-write-path.md) **[B-02](subsystems/b02-write-path.md)** | 3 of 4 | **[concern CC-1](concerns.md#cc-1)**, **[concern CC-3](concerns.md#cc-3)**, **[concern SC-1](concerns.md#sc-1)** |
| [Queue](subsystems/b03-queue.md) **[B-03](subsystems/b03-queue.md)** | 3 of 4 | **[concern CC-1](concerns.md#cc-1)**, **[concern CC-2](concerns.md#cc-2)**, **[concern CC-3](concerns.md#cc-3)** |
| [Console](subsystems/f01-console.md) **[F-01](subsystems/f01-console.md)** | 3 of 4 | **[concern CC-1](concerns.md#cc-1)**, **[concern CC-2](concerns.md#cc-2)**, **[concern SC-1](concerns.md#sc-1)** |
| [Widgets](subsystems/f02-widgets.md) **[F-02](subsystems/f02-widgets.md)** | 4 of 4 | **[concern CC-1](concerns.md#cc-1)**, **[concern CC-2](concerns.md#cc-2)**, **[concern CC-3](concerns.md#cc-3)**, **[concern SC-1](concerns.md#sc-1)** |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
