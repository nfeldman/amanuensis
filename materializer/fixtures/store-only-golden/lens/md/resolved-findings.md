# Resolved findings

*Verified, ruled out, and accepted, each with the basis its resolution rests on. Use it when you want to know what was fixed or ruled out, and on what basis.*

Terms on this page: [Evidence](how-to-read.md#term-evidence) · [Challenge](how-to-read.md#term-challenge) · [Finding](how-to-read.md#term-finding)

_Each record carries the basis its resolution rests on, labelled by kind. A verified repair rests on evidence; a claim ruled out or a behaviour accepted rests on an argument someone authorized to make it recorded._

## Accepted

_1 record where the behaviour is the intended design rather than a defect._

### [Write path](subsystems/b02-write-path.md)

<!-- amanuensis:finding:5b8a8674582a5618d24e7cfc7c5784abd9ce3abf2e609ff6c2a6f5861b46da9d -->
<a id="b02-2"></a>
#### **B02-2** · `LOW`

**B02-2** drops a row under load

- **Root cause** — the buffer is reused before the reader is done with it
- **Resolution** — `accepted`, recorded 2026-11-21 03:39 UTC.
- **Basis** — `authorized-dismissal`: fixture Recorded by session `p8`. No revision is recorded for the dismissal itself; the finding was recorded at `aaaaaaaaaaaa`.

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
