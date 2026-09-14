# Hot spots

_Each column is one measure, read on its own. The rows are ordered by open critical and high defects, then by open medium and low, then by the fraction of this region no one has read, then by identifier — four keys applied in turn, not one number. There is no combined score, because unresolved work and unread territory are different kinds of not-done and no arithmetic turns them into one._

| Subsystem | Open critical + high | Open medium + low | Awaiting verification | Undiscriminated | Weakest evidence quality | Unread files | Stale files | Unassessed seam sides |
|---|---|---|---|---|---|---|---|---|
| [Server core: repository binding, storage, schema, lifecycle](subsystems/b02-server-core-repository-binding-storage-schema-lifecycle.md) **[B-02](subsystems/b02-server-core-repository-binding-storage-schema-lifecycle.md)** | 2 | 2 | 0 | 0 | `test-observed` | 0/8 | 0 | 0/10 |
| [Reader lenses: standing, locus account, claims, edges, vocabulary](subsystems/b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md) **[B-04](subsystems/b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)** | 2 | 2 | 0 | 0 | `runtime-observed` | 0/9 | 0 | 0/6 |
| [Knowledge tools and workflow API](subsystems/b03-knowledge-tools-and-workflow-api.md) **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** | 1 | 1 | 0 | 0 | `code-verified` | 6/20 | 0 | 0/8 |
| [Gates, evidence custody, and CI](subsystems/b07-gates-evidence-custody-and-ci.md) **[B-07](subsystems/b07-gates-evidence-custody-and-ci.md)** | 0 | 2 | 0 | 0 | `test-observed` | 3/14 | 0 | 0/2 |
| [Survey methodology and agent contracts](subsystems/b01-survey-methodology-and-agent-contracts.md) **[B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)** | 0 | 1 | 0 | 0 | `contract-stated` | 4/16 | 0 | 0/2 |
| [Materializer: human projection, read-back, HTML](subsystems/b05-materializer-human-projection-read-back-html.md) **[B-05](subsystems/b05-materializer-human-projection-read-back-html.md)** | 0 | 0 | 0 | 1 | — | 3/11 | 0 | 0/6 |
| [Records: design, research, published projection, execution ledger](subsystems/b08-records-design-research-published-projection-execution-ledger.md) **[B-08](subsystems/b08-records-design-research-published-projection-execution-ledger.md)** | 0 | 0 | 0 | 0 | `doc-asserted` | 3/14 | 0 | 0/4 |
| [Packaging, installer, and host activation](subsystems/b06-packaging-installer-and-host-activation.md) **[B-06](subsystems/b06-packaging-installer-and-host-activation.md)** | 0 | 0 | 0 | 0 | `code-verified` | 1/12 | 0 | 0/2 |

## What each column measures

**Open critical + high** and **Open medium + low** are kept apart because severity is an ordinal ramp of consequence and adding the two ends of it together would let four readability defects outweigh one data-loss path.

**Awaiting verification** counts repairs recorded against a commit with no evidence yet that they hold. It is not progress and it is not an open defect; it is a claim nobody has checked.

**Undiscriminated** counts unresolved contradictions, open and unresolved-competition matrices, and concern reviews that recorded a competition. A contradiction between findings in two subsystems is counted in both, because it is undiscriminated territory in both.

**Weakest evidence quality** is the weakest rung any `confirmed-bug` review here rests on, not an average: the weakest link is what a reader should re-verify first.

**Unread files** and **Stale files** are counted over ledger rows that carry a survey obligation; generated, vendored, and irrelevant paths are outside the denominator.

**Unassessed seam sides** counts `(seam, side)` pairs over twice the seams this subsystem is party to: a seam assessed from one side only is half-known, and counting seams would report it as covered. Binding: per-party-proxy; no seam-bound disposition is recorded. An `SC-%` disposition says a party has assessed some seam concern, never that it assessed this seam.

No **Access heat** column is shown: no recorded access reaches a subsystem, and a column of zeros would read as a measurement that was taken.

