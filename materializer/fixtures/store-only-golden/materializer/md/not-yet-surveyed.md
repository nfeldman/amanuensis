# Not yet surveyed

*The recorded edge of the map, each gap counted over the unit it occupies. Use it when you want to know what the survey has not covered.*

Terms on this page: [Survey](how-to-read.md#term-survey) · [Subsystem](how-to-read.md#term-subsystem) · [Survey depth](how-to-read.md#term-survey-depth) · [Mapped](how-to-read.md#term-mapped) · [Scope](how-to-read.md#term-scope) · [Concern](how-to-read.md#term-concern)

Counted at `deadbeefdead` on `main`.

## Paths with no ledger row

No tracked paths is recorded, so this gap is not measured here. That is a statement about the record, not a claim that the gap is closed. Not measured — no reconciliation has been recorded for this store, at `deadbeefdead` or at any other revision.

## Files in scope that no one has read

No ledger rows that carry a survey obligation is recorded, so this gap is not measured here. That is a statement about the record, not a claim that the gap is closed.

## Subsystems set aside

**0 of 3** subsystems are deferred. `deferred` is not a rung on the survey ladder but an orthogonal do-not-survey flag, so nothing in them has been surveyed at any depth.

## Seam sides no one has assessed

**2 of 2** (seam, side) pairs carry no recorded assessment. The unit is the pair, not the seam: a seam assessed from one side only is half-known, and counting seams would report it as covered.

Binding: per-party-proxy; no seam-bound disposition is recorded. An `SC-%` disposition says a party has assessed some seam concern, never that it assessed this seam.

| Seam | Unassessed party | Other party | Why |
|---|---|---|---|
| **[SM-01](seams.md#sm-01)** | [Job Scheduler](subsystems/b01-job-scheduler.md) **[B-01](subsystems/b01-job-scheduler.md)** | **[B-02](subsystems/b02-auth-service.md)** (Auth Service) | this party holds no `SC-%` disposition |
| **[SM-01](seams.md#sm-01)** | [Auth Service](subsystems/b02-auth-service.md) **[B-02](subsystems/b02-auth-service.md)** | **[B-01](subsystems/b01-job-scheduler.md)** | this party holds no `SC-%` disposition |

## Concerns no one has dispositioned here

**6 of 9** (subsystem, active concern) pairs carry no disposition. The unit is the pair: a concern dispositioned somewhere else says nothing about this subsystem, and counting concern codes would report a checklist as complete while most regions were never tested against it.

| Subsystem | Undispositioned | Concerns |
|---|---|---|
| [Job Scheduler](subsystems/b01-job-scheduler.md) **[B-01](subsystems/b01-job-scheduler.md)** | 1 of 3 | **[concern TC-1](concerns.md#tc-1)** |
| [Auth Service](subsystems/b02-auth-service.md) **[B-02](subsystems/b02-auth-service.md)** | 2 of 3 | **[concern CB-1](concerns.md#cb-1)**, **[concern CC-1](concerns.md#cc-1)** |
| [Web UI](subsystems/f01-web-ui.md) **[F-01](subsystems/f01-web-ui.md)** | 3 of 3 | **[concern CB-1](concerns.md#cb-1)**, **[concern CC-1](concerns.md#cc-1)**, **[concern TC-1](concerns.md#tc-1)** |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
