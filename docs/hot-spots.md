# Hot spots

_Each column is one measure, read on its own. The rows are ordered by open critical and high defects, then by open medium and low, then by the fraction of this region no one has read, then by identifier — four keys applied in turn, not one number. There is no combined score, because unresolved work and unread territory are different kinds of not-done and no arithmetic turns them into one._

| Subsystem | Open critical + high | Open medium + low | Awaiting verification | Undiscriminated | Weakest evidence quality | Unread files | Stale files | Unassessed seam sides |
|---|---|---|---|---|---|---|---|---|
| [Survey record tools](subsystems/b04-survey-record-tools.md) **[B-04](subsystems/b04-survey-record-tools.md)** | 0 | 2 | 0 | 0 | `code-verified` | 5/8 | 0 | 0/2 |
| [Development harness and gates](subsystems/b11-development-harness-and-gates.md) **[B-11](subsystems/b11-development-harness-and-gates.md)** | 0 | 2 | 0 | 0 | `code-verified` | 2/7 | 0 | 0/2 |
| [Findings, dispositions, and resolution custody](subsystems/b05-findings-dispositions-and-resolution-custody.md) **[B-05](subsystems/b05-findings-dispositions-and-resolution-custody.md)** | 0 | 1 | 0 | 0 | `code-verified` | 4/5 | 0 | 0/2 |
| [Git state, staleness, and refresh](subsystems/b07-git-state-staleness-and-refresh.md) **[B-07](subsystems/b07-git-state-staleness-and-refresh.md)** | 0 | 1 | 0 | 0 | `code-verified` | 3/4 | 0 | 0/0 |
| [Materializer rendering pipeline](subsystems/b08-materializer-rendering-pipeline.md) **[B-08](subsystems/b08-materializer-rendering-pipeline.md)** | 0 | 1 | 0 | 0 | `code-verified` | 3/5 | 0 | 0/4 |
| [The Amanuensis skill](subsystems/b10-the-amanuensis-skill.md) **[B-10](subsystems/b10-the-amanuensis-skill.md)** | 0 | 1 | 0 | 0 | `contract-stated` | 2/5 | 0 | 0/2 |
| [Conspectus schema, vocabulary, and invariants](subsystems/b03-conspectus-schema-vocabulary-and-invariants.md) **[B-03](subsystems/b03-conspectus-schema-vocabulary-and-invariants.md)** | 0 | 1 | 0 | 0 | `code-verified` | 1/4 | 0 | 0/6 |
| [Server runtime and tool dispatch](subsystems/b01-server-runtime-and-tool-dispatch.md) **[B-01](subsystems/b01-server-runtime-and-tool-dispatch.md)** | 0 | 1 | 0 | 0 | `code-verified` | 1/7 | 0 | 0/6 |
| [Projection read-back and publication custody](subsystems/b09-projection-read-back-and-publication-custody.md) **[B-09](subsystems/b09-projection-read-back-and-publication-custody.md)** | 0 | 0 | 0 | 0 | — | 2/3 | 0 | 0/2 |
| [Repository binding and storage custody](subsystems/b02-repository-binding-and-storage-custody.md) **[B-02](subsystems/b02-repository-binding-and-storage-custody.md)** | 0 | 0 | 0 | 0 | — | 2/4 | 0 | 0/6 |
| [Locus standing and the reader lenses](subsystems/b06-locus-standing-and-the-reader-lenses.md) **[B-06](subsystems/b06-locus-standing-and-the-reader-lenses.md)** | 0 | 0 | 0 | 0 | — | 0/3 | 0 | 0/4 |
| [Vendored research corpus](subsystems/b12-vendored-research-corpus.md) **[B-12](subsystems/b12-vendored-research-corpus.md)** | 0 | 0 | 0 | 0 | — | 0/3 | 0 | 0/0 |

## What each column measures

**Open critical + high** and **Open medium + low** are kept apart because severity is an ordinal ramp of consequence and adding the two ends of it together would let four readability defects outweigh one data-loss path.

**Awaiting verification** counts repairs recorded against a commit with no evidence yet that they hold. It is not progress and it is not an open defect; it is a claim nobody has checked.

**Undiscriminated** counts unresolved contradictions, open and unresolved-competition matrices, and concern reviews that recorded a competition. A contradiction between findings in two subsystems is counted in both, because it is undiscriminated territory in both.

**Weakest evidence quality** is the weakest rung any `confirmed-bug` review here rests on, not an average: the weakest link is what a reader should re-verify first.

**Unread files** and **Stale files** are counted over ledger rows that carry a survey obligation; generated, vendored, and irrelevant paths are outside the denominator.

**Unassessed seam sides** counts `(seam, side)` pairs over twice the seams this subsystem is party to: a seam assessed from one side only is half-known, and counting seams would report it as covered. Binding: per-party-proxy; no seam-bound disposition is recorded. An `SC-%` disposition says a party has assessed some seam concern, never that it assessed this seam.

No **Access heat** column is shown: no recorded access reaches a subsystem, and a column of zeros would read as a measurement that was taken.

