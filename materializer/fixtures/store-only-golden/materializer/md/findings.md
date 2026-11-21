# Open findings

*Defects open or awaiting verification at the checked revision. Use it when you want the defects still open.*

Terms on this page: [Evidence](how-to-read.md#term-evidence) · [Challenge](how-to-read.md#term-challenge) · [Finding](how-to-read.md#term-finding)

## Open

_1 defect(s) with no recorded repair._

### High findings

#### [Auth Service](subsystems/b02-auth-service.md)

| ID | Status | Symptom | Why it matters | Root cause | Ref SHA |
|---|---|---|---|---|---|
<!-- amanuensis:finding:47d5c6eae5b99f1bfe21308db51867ae17da48ba25d361eb042149ccdbe0f877 -->
| <a id="b02-1"></a>**B02-1** | open | Unvalidated query params reach SQL | Affects all auth flows | parse trusts client claim | `deadbeef` |

