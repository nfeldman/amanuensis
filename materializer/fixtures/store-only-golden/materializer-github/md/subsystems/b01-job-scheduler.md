# **B-01** — Job Scheduler

*Scope, structure, boundaries, defects, and the survey record for Job Scheduler. Use it when you have picked a subsystem.*

Terms on this page: [Survey](../how-to-read.md#term-survey) · [Subsystem](../how-to-read.md#term-subsystem) · [Layer](../how-to-read.md#term-layer) · [Survey depth](../how-to-read.md#term-survey-depth) · [Mapped](../how-to-read.md#term-mapped) · [Scope](../how-to-read.md#term-scope) · [Evidence](../how-to-read.md#term-evidence) · [Claim](../how-to-read.md#term-claim) · [Challenge](../how-to-read.md#term-challenge) · [Concern](../how-to-read.md#term-concern) · [Concern review](../how-to-read.md#term-concern-review) · [Finding](../how-to-read.md#term-finding) · [Lead](../how-to-read.md#term-lead) · [Decision needed](../how-to-read.md#term-decision-needed) · [System boundary](../how-to-read.md#term-system-boundary) · [Recorded edge](../how-to-read.md#term-recorded-edge) · [Standing](../how-to-read.md#term-standing) · [Purpose, account](../how-to-read.md#term-purpose-account)

**Status**: 🟢 mapped  
**Layer**: backend

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

scheduler/**

### Survey note

*A note the survey left on the subsystem record; not bound to a revision.*

Note about **B-01**

## Start here

scheduler/main.ts

## Structure

### Structural inventory not recorded as claims

No structural claim is recorded for this subsystem, and no narrative was left in its place.

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-01](../seams.md#sm-01)** | jobs_queue | **[B-02](b02-auth-service.md)** (Auth Service) | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-01** | → | **[B-02](b02-auth-service.md)** | dependency | confirmed | **B-01** calls [B-02](b02-auth-service.md) on job start |

## Vocabulary

- **runJob** — per-job entry point in the scheduler

**Domain vocabulary** — not recorded. Neither a term nor a declination has been recorded for this subsystem, so nobody has answered the question either way.

## Known defects here

No defect here is open or awaiting verification.

1 further defect here reached a terminal state; it is recorded on [Resolved findings](../resolved-findings.md).

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Ledger | no file is recorded, so nothing here is measured |
| Active concerns with a disposition recorded here | 2 of 3 — 1 confirmed-acceptable, 1 ruled-out |
| Findings by resolution state | 1 accepted |
| Seams assessable from both sides | 1 of 1 |

## Survey record

### File ledger

No file is recorded in this subsystem's ledger.

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[concern CB-1](../concerns.md#cb-1)** | confirmed-acceptable | code-verified |  | Single goroutine per job. |
| **[concern CC-1](../concerns.md#cc-1)** | ruled-out | code-verified |  | No cache in **B-01**. |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
