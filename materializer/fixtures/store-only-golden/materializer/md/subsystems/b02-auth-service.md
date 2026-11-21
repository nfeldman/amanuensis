# **B-02** — Auth Service

*Scope, structure, boundaries, defects, and the survey record for Auth Service. Use it when you have picked a subsystem.*

Terms on this page: [Survey](../how-to-read.md#term-survey) · [Subsystem](../how-to-read.md#term-subsystem) · [Layer](../how-to-read.md#term-layer) · [Survey depth](../how-to-read.md#term-survey-depth) · [Mapped](../how-to-read.md#term-mapped) · [Scope](../how-to-read.md#term-scope) · [Evidence](../how-to-read.md#term-evidence) · [Claim](../how-to-read.md#term-claim) · [Challenge](../how-to-read.md#term-challenge) · [Concern](../how-to-read.md#term-concern) · [Concern review](../how-to-read.md#term-concern-review) · [Finding](../how-to-read.md#term-finding) · [Lead](../how-to-read.md#term-lead) · [Decision needed](../how-to-read.md#term-decision-needed) · [System boundary](../how-to-read.md#term-system-boundary) · [Recorded edge](../how-to-read.md#term-recorded-edge) · [Standing](../how-to-read.md#term-standing) · [Purpose, account](../how-to-read.md#term-purpose-account)

**Status**: 🟢 mapped  
**Layer**: backend

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

auth/**

## Start here

auth/index.ts

## Structure

### Structural inventory not recorded as claims

No structural claim is recorded for this subsystem, and no narrative was left in its place.

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-01](../seams.md#sm-01)** | jobs_queue | **[B-01](b01-job-scheduler.md)** (Job Scheduler) | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **[B-01](b01-job-scheduler.md)** | → | **B-02** | dependency | confirmed | [B-01](b01-job-scheduler.md) calls **B-02** on job start |

## Vocabulary

**Domain vocabulary** — not recorded. Neither a term nor a declination has been recorded for this subsystem, so nobody has answered the question either way.

## Known defects here

1 defect here is open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- Unvalidated query params reach SQL — [B02-1](../findings.md#b02-1) · 🟠 HIGH · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Ledger | no file is recorded, so nothing here is measured |
| Active concerns with a disposition recorded here | 1 of 3 — 1 confirmed-bug |
| Findings by resolution state | 1 open |
| Seams assessable from both sides | 1 of 1 |

## Survey record

### File ledger

No file is recorded in this subsystem's ledger.

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[concern TC-1](../concerns.md#tc-1)** | confirmed-bug | code-verified |  | Gateway trusts unvalidated client input. |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
