# **B-02** — Write path

*Scope, structure, boundaries, defects, and the survey record for Write path. Use it when you have picked a subsystem.*

Terms on this page: [Survey](../how-to-read.md#term-survey) · [Subsystem](../how-to-read.md#term-subsystem) · [Layer](../how-to-read.md#term-layer) · [Survey depth](../how-to-read.md#term-survey-depth) · [Mapped](../how-to-read.md#term-mapped) · [Scope](../how-to-read.md#term-scope) · [Evidence](../how-to-read.md#term-evidence) · [Claim](../how-to-read.md#term-claim) · [Challenge](../how-to-read.md#term-challenge) · [Concern](../how-to-read.md#term-concern) · [Concern review](../how-to-read.md#term-concern-review) · [Finding](../how-to-read.md#term-finding) · [Lead](../how-to-read.md#term-lead) · [Decision needed](../how-to-read.md#term-decision-needed) · [System boundary](../how-to-read.md#term-system-boundary) · [Recorded edge](../how-to-read.md#term-recorded-edge) · [Standing](../how-to-read.md#term-standing) · [Purpose, account](../how-to-read.md#term-purpose-account)

**Status**: 🟢 mapped  
**Layer**: backend

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

src/writer.ts, src/shared.ts

## Structure

### Structural inventory not recorded as claims

No structural claim is recorded for this subsystem, and no narrative was left in its place.

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-1](../seams.md#sm-1)** | the row buffer | **[B-01](b01-read-path.md)** (Read path) | both parties are `mapped` |
| **[SM-2](../seams.md#sm-2)** | the queue handle | **[B-03](b03-queue.md)** (Queue) | not yet: both parties must be `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **[B-01](b01-read-path.md)** | → | **B-02** | depends-on | confirmed | the reader drains the buffer |

## Vocabulary

**Domain vocabulary** — not recorded. Neither a term nor a declination has been recorded for this subsystem, so nobody has answered the question either way.

## Known defects here

1 defect here is open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- [B02-1](../findings.md#b02-1) drops a row under load — [B02-1](../findings.md#b02-1) · 🟠 HIGH · Unverified fix

1 further defect here reached a terminal state; it is recorded on [Resolved findings](../resolved-findings.md).

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 2 of 4 ledger rows |
| Files in scope, not yet read | 1 of 4 |
| Files excluded from the survey obligation | 0 of 4 |
| Ledger rows the repository has changed under | 1 of 4 |
| Active concerns with a disposition recorded here | 1 of 4 — 1 ruled-out |
| Findings by resolution state | 1 accepted, 1 unverified fix |
| Seams assessable from both sides | 1 of 2 |

## Survey record

### File ledger

- **In scope for **B-02**.** — candidate, 1 file, recorded at `aaaaaaaa`
    - <a id="le-44a764fa4e"></a>`src/mixed.ts`
- **In scope for **B-02**.** — examined, 3 files, examined at 2 revisions
    - <a id="le-d82107d48d"></a>`src/agreed.ts` (`aaaaaaaa`)
    - <a id="le-29e6683589"></a>`src/gone.ts` (`aaaaaaaa`)
    - <a id="le-b4d03c4bbe"></a>`src/shared.ts` (`bbbbbbbb`)

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[concern CC-2](../concerns.md#cc-2)** | ruled-out | code-verified |  | fixture |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
