# Resolved findings

*Verified, ruled out, and accepted, each with the basis its resolution rests on. Use it when you want to know what was fixed or ruled out, and on what basis.*

Terms on this page: [Evidence](how-to-read.md#term-evidence) · [Challenge](how-to-read.md#term-challenge) · [Finding](how-to-read.md#term-finding)

_Each record carries the basis its resolution rests on, labelled by kind. A verified repair rests on evidence; a claim ruled out or a behaviour accepted rests on an argument someone authorized to make it recorded._

## Terminal without a recorded basis

1 record below reached a terminal state with neither verification evidence nor a recorded rationale. The store says they are closed and does not say on what: [**B01-1**](#b01-1).

## Accepted

_1 record where the behaviour is the intended design rather than a defect._

### [Job Scheduler](subsystems/b01-job-scheduler.md)

<!-- amanuensis:finding:cc78044544af598925de07123aa694d25430434fcf83dd6fa8c44449698b6824 -->
<a id="b01-1"></a>
#### **B01-1** · `MEDIUM`

race on job start

- **Root cause** — lock released between check and start
- **Resolution** — `accepted`, carried by the legacy status with no resolution event recorded.
- **Basis** — `none-recorded`: No basis is recorded for this resolution.

