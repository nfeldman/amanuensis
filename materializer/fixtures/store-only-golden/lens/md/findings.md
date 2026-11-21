# Open findings

*Defects open or awaiting verification at the checked revision. Use it when you want the defects still open.*

Terms on this page: [Evidence](how-to-read.md#term-evidence) · [Challenge](how-to-read.md#term-challenge) · [Finding](how-to-read.md#term-finding)

## Open

_1 defect(s) with no recorded repair._

### Critical findings

#### [Read path](subsystems/b01-read-path.md)

| ID | Status | Symptom | Why it matters | Root cause | Ref SHA |
|---|---|---|---|---|---|
<!-- amanuensis:finding:cc78044544af598925de07123aa694d25430434fcf83dd6fa8c44449698b6824 -->
| <a id="b01-1"></a>**B01-1** | open | **B01-1** drops a row under load |  | the buffer is reused before the reader is done with it | `aaaaaaaa` |

## Awaiting verification

_1 repair(s) recorded against a commit, with no evidence yet that they hold._

### High findings

#### [Write path](subsystems/b02-write-path.md)

| ID | Status | Symptom | Why it matters | Root cause | Ref SHA |
|---|---|---|---|---|---|
<!-- amanuensis:finding:47d5c6eae5b99f1bfe21308db51867ae17da48ba25d361eb042149ccdbe0f877 -->
| <a id="b02-1"></a>**B02-1** | fixed-pending-verification | **B02-1** drops a row under load |  | the buffer is reused before the reader is done with it | `aaaaaaaa` |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
