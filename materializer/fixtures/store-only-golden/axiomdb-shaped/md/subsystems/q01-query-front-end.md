# **Q-01** — Query front end

*Scope, structure, boundaries, defects, and the survey record for Query front end. Use it when you have picked a subsystem.*

Terms on this page: [Survey](../how-to-read.md#term-survey) · [Subsystem](../how-to-read.md#term-subsystem) · [Layer](../how-to-read.md#term-layer) · [Survey depth](../how-to-read.md#term-survey-depth) · [Mapped](../how-to-read.md#term-mapped) · [Scope](../how-to-read.md#term-scope) · [Evidence](../how-to-read.md#term-evidence) · [Claim](../how-to-read.md#term-claim) · [Challenge](../how-to-read.md#term-challenge) · [Concern](../how-to-read.md#term-concern) · [Concern review](../how-to-read.md#term-concern-review) · [Finding](../how-to-read.md#term-finding) · [Lead](../how-to-read.md#term-lead) · [Decision needed](../how-to-read.md#term-decision-needed) · [System boundary](../how-to-read.md#term-system-boundary) · [Recorded edge](../how-to-read.md#term-recorded-edge) · [Standing](../how-to-read.md#term-standing) · [Purpose, account](../how-to-read.md#term-purpose-account)

**Status**: 🟠 structural  
**Layer**: —

## Scope

No purpose statement is recorded for this subsystem.

No scope statement is recorded for this subsystem. The file ledger in its survey record is the only account of what belongs to it.

## Structure

### Structural inventory not recorded as claims

No structural claim is recorded for this subsystem. *Narrative from the survey artifact; not individually bound to a revision.* Its source is `Q-01-query-front-end.md` at content hash `9ebf2bb43787`, recorded at `c3b1492c0da8`, written on 2026-08-21.

*As written at 2026-08-21, revision `c3b1492c`; kept as written, not tied to evidence.*

#### **Q-01** — Query front end

##### Structural inventory (Phase 2)

The parser hands an algebra tree to the planner, which refuses `SERVICE`.

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-02](../seams.md#sm-02)** | snapshot generation | **[W-01](w01-graph-write-coordinator.md)** (Graph write coordinator) | not yet: both parties must be `mapped` |

## Vocabulary

**Domain vocabulary** — not recorded. Neither a term nor a declination has been recorded for this subsystem, so nobody has answered the question either way.

## Known defects here

No defect here is open or awaiting verification.

## Standing

**Structural** — The structure pass is done: types, state, flows and concurrency are mapped; correctness claims are not yet authorized. It cannot justify any correctness claim.

| Metric | Value |
|---|---|
| Files read | 1 of 1 ledger row |
| Files in scope, not yet read | 0 of 1 |
| Files excluded from the survey obligation | 0 of 1 |
| Ledger rows the repository has changed under | 0 of 1 |
| Active concerns with a disposition recorded here | 0 of 2 |
| Findings by resolution state | none recorded |
| Seams assessable from both sides | 0 of 1 |

## Survey record

### File ledger

- **No reason recorded** — examined, 1 file, examined at `c3b1492c`
    - <a id="le-9dbd55d5f0"></a>`crates/quad-core/src/query/parse.rs`

### Concern review

No concern has been dispositioned in this subsystem.

### Survey artifact

The survey artifact is rendered above, under Structure, because no structural claim is recorded to stand in its place. Its source is `Q-01-query-front-end.md` at content hash `9ebf2bb43787`, recorded at `c3b1492c0da8`, written on 2026-08-21.

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
