# **S-01** — Storage substrate

*Scope, structure, boundaries, defects, and the survey record for Storage substrate. Use it when you have picked a subsystem.*

Terms on this page: [Survey](../how-to-read.md#term-survey) · [Subsystem](../how-to-read.md#term-subsystem) · [Layer](../how-to-read.md#term-layer) · [Survey depth](../how-to-read.md#term-survey-depth) · [Mapped](../how-to-read.md#term-mapped) · [Scope](../how-to-read.md#term-scope) · [Evidence](../how-to-read.md#term-evidence) · [Claim](../how-to-read.md#term-claim) · [Challenge](../how-to-read.md#term-challenge) · [Concern](../how-to-read.md#term-concern) · [Concern review](../how-to-read.md#term-concern-review) · [Finding](../how-to-read.md#term-finding) · [Lead](../how-to-read.md#term-lead) · [Decision needed](../how-to-read.md#term-decision-needed) · [System boundary](../how-to-read.md#term-system-boundary) · [Recorded edge](../how-to-read.md#term-recorded-edge) · [Standing](../how-to-read.md#term-standing) · [Purpose, account](../how-to-read.md#term-purpose-account)

**Status**: 🟢 mapped  
**Layer**: —

## Purpose

**S-01** stores each quad under five key orders.

*Written by a survey session at `c3b1492c` from 1 evidence row(s). Whether the files it cites have changed since is not measured here.*

## Scope

No scope statement is recorded for this subsystem. The file ledger in its survey record is the only account of what belongs to it.

## Structure

### Structural inventory not recorded as claims

No structural claim is recorded for this subsystem. *Narrative from the survey artifact; not individually bound to a revision.* Its source is `S-01-storage-substrate.md` at content hash `c664dfe0af48`, recorded at `c3b1492c0da8`, written on 2026-08-21.

*As written at 2026-08-21, revision `c3b1492c`; kept as written, not tied to evidence.*

#### **S-01** — Storage substrate

##### Structural inventory (Phase 2)

| Symbol | Role | Source |
|---|---|---|
| `Permutation` | One of the five key orders. | `index/perm.rs:12` |

```text
spog posg ogsp gspo gpos
```

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-01](../seams.md#sm-01)** | index permutations | **[W-01](w01-graph-write-coordinator.md)** (Graph write coordinator) | both parties are `mapped` |

## Vocabulary

**Domain vocabulary** — not recorded. Neither a term nor a declination has been recorded for this subsystem, so nobody has answered the question either way.

## Known defects here

No defect here is open or awaiting verification.

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 1 of 1 ledger row |
| Files in scope, not yet read | 0 of 1 |
| Files excluded from the survey obligation | 0 of 1 |
| Ledger rows the repository has changed under | 0 of 1 |
| Active concerns with a disposition recorded here | 0 of 2 |
| Findings by resolution state | none recorded |
| Seams assessable from both sides | 1 of 1 |

## Survey record

### File ledger

- **No reason recorded** — examined, 1 file, examined at `c3b1492c`
    - <a id="le-b709f4c9f2"></a>`crates/quad-core/src/index/perm.rs`

### Concern review

No concern has been dispositioned in this subsystem.

### Survey artifact

The survey artifact is rendered above, under Structure, because no structural claim is recorded to stand in its place. Its source is `S-01-storage-substrate.md` at content hash `c664dfe0af48`, recorded at `c3b1492c0da8`, written on 2026-08-21.
