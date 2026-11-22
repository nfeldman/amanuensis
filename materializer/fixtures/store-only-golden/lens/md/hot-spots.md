# Hot spots

*Where unresolved work and unread territory concentrate, as separate measures. Use it when you want to know where open work concentrates.*

Terms on this page: [Subsystem](how-to-read.md#term-subsystem) · [Evidence](how-to-read.md#term-evidence) · [Finding](how-to-read.md#term-finding) · [Stale](how-to-read.md#term-stale)

_Rows are ordered by open critical and high defects, then open medium and low, then the unread fraction._

| Subsystem | Open critical + high | Open medium + low | Awaiting verification | Undiscriminated | Weakest evidence quality | Unread files | Stale files | Unassessed seam sides |
|---|---|---|---|---|---|---|---|---|
| [Read path](subsystems/b01-read-path.md) **[B-01](subsystems/b01-read-path.md)** | 1 | 0 | 0 | 1 | `code-verified` | 1/6 | 0 | 3/4 |
| [Queue](subsystems/b03-queue.md) **[B-03](subsystems/b03-queue.md)** | 0 | 0 | 0 | 0 | — | 2/2 | 0 | 2/2 |
| [Write path](subsystems/b02-write-path.md) **[B-02](subsystems/b02-write-path.md)** | 0 | 0 | 1 | 0 | — | 1/4 | 1 | 3/4 |
| [Console](subsystems/f01-console.md) **[F-01](subsystems/f01-console.md)** | 0 | 0 | 0 | 0 | — | 0/1 | 0 | 2/2 |
| [Widgets](subsystems/f02-widgets.md) **[F-02](subsystems/f02-widgets.md)** | 0 | 0 | 0 | 0 | — | 0/0 | 0 | 0/0 |

## What each column measures

**Open critical + high** and **Open medium + low** are kept apart because severity is an ordinal ramp of consequence and adding the two ends of it together would let four readability defects outweigh one data-loss path.

**Awaiting verification** counts repairs recorded against a commit with no evidence yet that they hold. It is not progress and it is not an open defect; it is a claim nobody has checked.

**Undiscriminated** counts unresolved contradictions, open and unresolved-competition matrices, and concern reviews that recorded a competition. A contradiction between findings in two subsystems is counted in both, because it is undiscriminated territory in both.

**Weakest evidence quality** is the weakest rung any `confirmed-bug` review here rests on, not an average: the weakest link is what a reader should re-verify first.

**Unread files** and **Stale files** are counted over ledger rows that carry a survey obligation; generated, vendored, and irrelevant paths are outside the denominator.

**Unassessed seam sides** counts `(seam, side)` pairs over twice the seams this subsystem is party to: a seam assessed from one side only is half-known, and counting seams would report it as covered. Binding: per-party-proxy; no seam-bound disposition is recorded. An `SC-%` disposition says a party has assessed some seam concern, never that it assessed this seam.

No **Access heat** column is shown: no recorded access reaches a subsystem, and a column of zeros would read as a measurement that was taken.

