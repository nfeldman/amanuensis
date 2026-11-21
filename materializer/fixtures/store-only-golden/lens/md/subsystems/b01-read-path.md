# **B-01** — Read path

*Scope, structure, boundaries, defects, and the survey record for Read path. Use it when you have picked a subsystem.*

Terms on this page: [Survey](../how-to-read.md#term-survey) · [Subsystem](../how-to-read.md#term-subsystem) · [Layer](../how-to-read.md#term-layer) · [Survey depth](../how-to-read.md#term-survey-depth) · [Mapped](../how-to-read.md#term-mapped) · [Scope](../how-to-read.md#term-scope) · [Evidence](../how-to-read.md#term-evidence) · [Claim](../how-to-read.md#term-claim) · [Challenge](../how-to-read.md#term-challenge) · [Concern](../how-to-read.md#term-concern) · [Concern review](../how-to-read.md#term-concern-review) · [Finding](../how-to-read.md#term-finding) · [Lead](../how-to-read.md#term-lead) · [Decision needed](../how-to-read.md#term-decision-needed) · [System boundary](../how-to-read.md#term-system-boundary) · [Recorded edge](../how-to-read.md#term-recorded-edge) · [Standing](../how-to-read.md#term-standing) · [Purpose, account](../how-to-read.md#term-purpose-account)

**Status**: 🟢 mapped  
**Layer**: backend

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

src/reader.ts and the two files it re-exports

## Start here

Open src/reader.ts first; it names every other file in this region.

## Structure

### Structural inventory not recorded as claims

No structural claim is recorded for this subsystem, and no narrative was left in its place.

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-1](../seams.md#sm-1)** | the row buffer | **[B-02](b02-write-path.md)** (Write path) | both parties are `mapped` |
| **[SM-3](../seams.md#sm-3)** | the console bridge | **[F-01](f01-console.md)** (Console) | not yet: both parties must be `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-01** | → | **[B-02](b02-write-path.md)** | depends-on | confirmed | the reader drains the buffer |

## Vocabulary

- **row buffer** — the shared page the writer fills and the reader drains

**Domain vocabulary** — not recorded. Neither a term nor a declination has been recorded for this subsystem, so nobody has answered the question either way.

## Known defects here

1 defect here is open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- [B01-1](../findings.md#b01-1) drops a row under load — [B01-1](../findings.md#b01-1) · 🔴 CRITICAL · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 5 of 8 ledger rows |
| Files in scope, not yet read | 1 of 8 |
| Files excluded from the survey obligation | 2 of 8 |
| Ledger rows the repository has changed under | 0 of 8 |
| Active concerns with a disposition recorded here | 2 of 4 — 1 confirmed-bug, 1 confirmed-acceptable |
| Findings by resolution state | 1 open |
| Seams assessable from both sides | 1 of 2 |

## Survey record

### File ledger

- **In scope for **B-01**.** — candidate, 1 file, recorded at `aaaaaaaa`
    - <a id="le-ab2d612626"></a>`src/a.b.ts`
- **In scope for **B-01**.** — examined, 5 files, examined at `aaaaaaaa`
    - <a id="le-caf4cb2f7f"></a>`src/a-b.ts`
    - <a id="le-1749fe3edc"></a>`src/a/b.ts`
    - <a id="le-08f67b58e1"></a>`src/agreed.ts`
    - <a id="le-30894145f2"></a>`src/mixed.ts`
    - <a id="le-4fc851b2fb"></a>`src/shared.ts`
- **In scope for **B-01**.** — generated-ignore, 1 file, recorded at `aaaaaaaa`
    - <a id="le-5393cae2e6"></a>`dist/bundle.js`
- **In scope for **B-01**.** — vendor-ignore, 1 file, recorded at `aaaaaaaa`
    - <a id="le-2583a17df8"></a>`vendor/lib.js`

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[concern CC-1](../concerns.md#cc-1)** | confirmed-bug | code-verified |  | fixture |
| **[concern SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified |  | fixture |
