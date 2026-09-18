# Hot spots

_Rows are ordered by open critical and high defects, then open medium and low, then the unread fraction._

| Subsystem | Open critical + high | Open medium + low | Awaiting verification | Undiscriminated | Weakest evidence quality | Unread files | Stale files | Unassessed seam sides |
|---|---|---|---|---|---|---|---|---|
| [Knowledge tools and workflow API](subsystems/b03-knowledge-tools-and-workflow-api.md) **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** | 1 | 3 | 0 | 0 | `code-verified` | 0/43 | 0 | 0/0 |
| [MCP core, persistence, and lifecycle](subsystems/b02-mcp-core-persistence-and-lifecycle.md) **[B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)** | 0 | 2 | 0 | 0 | — | 0/13 | 0 | 0/0 |
| [Diff-aware materializer](subsystems/b04-diff-aware-materializer.md) **[B-04](subsystems/b04-diff-aware-materializer.md)** | 0 | 2 | 0 | 0 | `code-verified` | 0/24 | 0 | 0/0 |
| [Embedded research surveys and platform trials](subsystems/b07-embedded-research-surveys-and-platform-trials.md) **[B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md)** | 0 | 1 | 0 | 0 | `code-verified` | 74/79 | 0 | 0/0 |
| [Packaging, installer, validation, and product docs](subsystems/b05-packaging-installer-validation-and-product-docs.md) **[B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)** | 0 | 1 | 0 | 0 | `code-verified` | 65/153 | 1 | 0/0 |
| [Survey methodology and agent contracts](subsystems/b01-survey-methodology-and-agent-contracts.md) **[B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)** | 0 | 0 | 0 | 0 | — | 0/37 | 0 | 0/0 |
| [Report interface design and validation studies](subsystems/b06-report-interface-design-and-validation-studies.md) **[B-06](subsystems/b06-report-interface-design-and-validation-studies.md)** | 0 | 0 | 0 | 0 | — | 0/24 | 0 | 0/0 |
| [Activation evidence and release readiness](subsystems/b08-activation-evidence-and-release-readiness.md) **[B-08](subsystems/b08-activation-evidence-and-release-readiness.md)** | 0 | 0 | 0 | 0 | — | 0/33 | 0 | 0/0 |
| [Conspectus design lanes, their drivers and receipts](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md) **[B-09](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md)** | 0 | 0 | 0 | 0 | — | 0/84 | 7 | 0/0 |

## What each column measures

**Open critical + high** and **Open medium + low** are kept apart because severity is an ordinal ramp of consequence and adding the two ends of it together would let four readability defects outweigh one data-loss path.

**Awaiting verification** counts repairs recorded against a commit with no evidence yet that they hold. It is not progress and it is not an open defect; it is a claim nobody has checked.

**Undiscriminated** counts unresolved contradictions, open and unresolved-competition matrices, and concern reviews that recorded a competition. A contradiction between findings in two subsystems is counted in both, because it is undiscriminated territory in both.

**Weakest evidence quality** is the weakest rung any `confirmed-bug` review here rests on, not an average: the weakest link is what a reader should re-verify first.

**Unread files** and **Stale files** are counted over ledger rows that carry a survey obligation; generated, vendored, and irrelevant paths are outside the denominator.

**Unassessed seam sides** counts `(seam, side)` pairs over twice the seams this subsystem is party to: a seam assessed from one side only is half-known, and counting seams would report it as covered. Binding: per-party-proxy; no seam-bound disposition is recorded. An `SC-%` disposition says a party has assessed some seam concern, never that it assessed this seam.

No **Access heat** column is shown: no recorded access reaches a subsystem, and a column of zeros would read as a measurement that was taken.

