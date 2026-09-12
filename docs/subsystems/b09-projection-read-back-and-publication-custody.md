# **B-09** — Projection read-back and publication custody

**Status**: 🟢 mapped  
**Layer**: materializer

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

materializer/amanuensis_materializer/{readback,manifest,db}.py and mcp-server/src/tools/materialize.ts — the three read-back axes, the projection contract, the manifest, and the tool that stages a publish into project storage.

## Start here

materializer/amanuensis_materializer/readback.py, then mcp-server/src/tools/materialize.ts

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-09/key-type/materializer-amanuensis-materializer-readback-py-ledger-stale-sections` | `materializer/amanuensis_materializer/readback.py:LEDGER_STALE_SECTIONS` | Stale ledger rows are published under three headings keyed by classification — examined, candidate, and deferred-with-reason — each with its own denominator, because drift is marked on any row carrying a revision and a candidate row can be stale without anyone having read the file. Folding them together would assert a reading the ledger does not record. | Observation | `258ccd28fc19` |
| `B-09/key-type/materializer-amanuensis-materializer-readback-py-write-contract` | `materializer/amanuensis_materializer/readback.py:write_contract` | The projection contract is a hash per published page, written at the end of a render. It is what the content axis compares finished bytes against, so a read-back is a comparison with a receipt rather than a second rendering — and a tree verified at one path can be shown to be the tree committed at another. | Observation | `258ccd28fc19` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-09/state-container` | `B-09` | **B-09** holds no in-memory state container. What persists is on disk: .projection-contract.json and .manifest.json beside the published pages. Both are written once per publish and read by the next verification, so the custody record outlives the process that made it. | Inference | `258ccd28fc19` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-09/concurrency` | `B-09` | Verification is single-threaded and runs after the render in the same process, over files on disk. Its guarantee is about bytes, not about the store: it can show that what was written is what the contract recorded, and cannot show that the store did not change while the render ran. | Inference | `258ccd28fc19` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-07](../seams.md#sm-07)** | .projection-contract.json (the per-page hash receipt) | **[B-08](b08-materializer-rendering-pipeline.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **[B-08](b08-materializer-rendering-pipeline.md)** | → | **B-09** | data-flow | structural | the rendered page list is what the contract is written over, so the render decides the denominator the read-back then verifies, read at materializer/amanuensis_materializer/readback.py:write_contract@258ccd2 |
| **[B-11](b11-development-harness-and-gates.md)** | → | **B-09** | data-flow | observed | the living-conspectus gate reads the committed projection receipts as its denominator, so a publish that recorded nothing gives that gate nothing to check, read at dev/check-living-conspectus.mjs:main@258ccd2 |
| **B-09** | → | **[B-03](b03-conspectus-schema-vocabulary-and-invariants.md)** | dependency | observed | the state axis's denominator is the stale ledger rows the schema defines, split by the classification column rather than pooled, read at materializer/amanuensis_materializer/readback.py:LEDGER_STALE_SECTIONS@258ccd2 |

## Known defects here

No defect here is open or awaiting verification.

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 1 of 3 ledger rows |
| Files in scope, not yet read | 2 of 3 |
| Files excluded from the survey obligation | 0 of 3 |
| Ledger rows the repository has changed under | 0 of 3 |
| Active concerns with a disposition recorded here | 7 of 15 — 6 confirmed-acceptable, 1 out-of-scope |
| Findings by resolution state | none recorded |
| Seams assessable from both sides | 1 of 1 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-a606e31b5c"></a>`materializer/amanuensis_materializer/manifest.py` | candidate | The manifest the diff-aware renderer and the contract are both written from. | `258ccd28` |
| <a id="le-710b89668d"></a>`mcp-server/src/tools/materialize.ts` | candidate | The tool that spawns the CLI and resolves its output path under project storage, which is why a publish cannot write the tracked docs/ directly. | `258ccd28` |
| <a id="le-f515b73422"></a>`materializer/amanuensis_materializer/readback.py` | examined | The projection contract and the three read-back axes: content, coverage, and state, plus the markers each obligation-bearing row must appear under exactly once. | `258ccd28` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[BV-1](../concerns.md#bv-1)** | confirmed-acceptable | code-verified |  | Every path this module opens is built by joining the output root it was handed with a page name the render produced, so nothing agent-supplied is resolved here; the tool-facing argument that decides that root is containment-asserted in [B-02](b02-repository-binding-and-storage-custody.md) before this process starts. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | code-verified |  | The two queries this module runs against findings select finding_id alone, to build the set of rows a marker is owed for; neither maps a status to a resolution, so no predicate is duplicated here even though findings are read. |
| **[EV-1](../concerns.md#ev-1)** | out-of-scope | code-verified |  | What this subsystem binds is bytes, not revisions: the contract records a sha256 per published page and the verification compares finished bytes to it, so no git revision is recorded or resolved anywhere in it. |
| **[GT-1](../concerns.md#gt-1)** | confirmed-acceptable | code-verified |  | The classifications this module partitions on come from the generated Python vocabulary rather than a local list, so a classification added to the source arrives here as an unclaimed value the partition check reports by name instead of as a row that quietly belongs to no heading. |
| **[RC-1](../concerns.md#rc-1)** | confirmed-acceptable | code-verified |  | Single-threaded, after the render, over files on disk: the resources are opened, read, and closed one at a time, and the receipt written beside the pages outlives the process on purpose, which is what lets the next verification re-read a tree the render no longer holds. |
| **[SC-7](../concerns.md#sc-7)** | confirmed-acceptable | code-verified |  | From the verifier's side: write_contract hashes exactly the page list it is handed and the content axis compares finished bytes against that receipt, so the two parties cannot disagree about membership — the verifier has no independent list to disagree with. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-acceptable | code-verified |  | The stale axis is checked against OBLIGATION_BEARING_CLASSIFICATIONS, a denominator that exists whether or not any file is stale, so a classification claimed by two headings or by none turns the axis red over an empty stale set — the structural repair for the zero-denominator green the schema records against itself. |

### Survey artifact

#### **B-09** · Projection read-back and publication custody

Structural inventory at `258ccd2`.

##### Key types

| Symbol | Role | Source |
|---|---|---|
| `write_contract` | one hash per published page, written at the end of a render | `materializer/amanuensis_materializer/readback.py:write_contract@258ccd2` |
| `LEDGER_STALE_SECTIONS` | three headings by classification, each with its own denominator | `materializer/amanuensis_materializer/readback.py:LEDGER_STALE_SECTIONS@258ccd2` |

##### State containers

None in memory. What persists is on disk beside the pages: `.projection-contract.json` and
`.manifest.json`, each written once per publish and read by the next verification, so the
custody record outlives the process that made it. Recorded as an explicit negative claim
(`B-09/state-container`).

##### Data flow · verifying a publish

1. Every listed page is hashed into the contract (`…readback.py:write_contract@258ccd2`).
2. The content axis compares finished bytes to that receipt, which is what lets a tree verified
   at one path be shown to be the tree committed at another.

##### Concurrency model

Single-threaded, after the render, over files on disk. The guarantee is about bytes, not about
the store: it can show that what was written is what the contract recorded, and cannot show that
the store did not change while the render ran. Recorded as an inference.

##### Seam contracts

- **[SM-07](../seams.md#sm-07) · `.projection-contract.json`, with [B-08](b08-materializer-rendering-pipeline.md).** The render decides the denominator; this
  side writes the receipt and the verdict.

##### Concern review

Six active concerns, all terminal at `0fee11b`. No confirmed bug.

| Concern | Disposition | Reading |
|---|---|---|
| [CC-1](../concerns.md#cc-1) | confirmed-acceptable | The two queries against `findings` select `finding_id` alone; no status is mapped to a resolution here. |
| [RC-1](../concerns.md#rc-1) | confirmed-acceptable | Single-threaded over files on disk; the receipt outlives the process on purpose. |
| [BV-1](../concerns.md#bv-1) | confirmed-acceptable | Every path is the output root joined with a page name the render produced. |
| [EV-1](../concerns.md#ev-1) | out-of-scope | What this subsystem binds is bytes, not revisions. |
| [GT-1](../concerns.md#gt-1) | confirmed-acceptable | The classifications it partitions on come from the generated vocabulary, so a new one arrives as an unclaimed value reported by name. |
| [ZD-1](../concerns.md#zd-1) | confirmed-acceptable | The partition is checked against `OBLIGATION_BEARING_CLASSIFICATIONS`, so the axis can turn red over an empty stale set. |

##### Adversarial review

No finding to challenge. Four claim targets, all survived.

| Claim | Challenge | Outcome |
|---|---|---|
| `B-09/key-type/…write-contract` | Does the content axis re-render anything to compare against? | survived |
| `B-09/key-type/…ledger-stale-sections` | Can a classification belong to two headings, or to none? | survived — checked against a denominator independent of the page. |
| `B-09/state-container` | Is either custody file retained in memory across a call? | survived |
| `B-09/concurrency` | Does the verification overstate what it can show about the store? | survived; it opens no store connection at all. |
