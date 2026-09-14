# **B-08** — Materializer rendering pipeline

**Status**: 🟢 mapped  
**Layer**: materializer

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

materializer/amanuensis_materializer/{core,renderers,html_projection,diagrams,slugs,xref,vocabulary,lint}.py and materializer/materialize.py — the read-only projection of the store into Markdown pages and a self-contained HTML index.

## Start here

materializer/amanuensis_materializer/core.py, then materializer/amanuensis_materializer/renderers.py

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-08/key-type/materializer-amanuensis-materializer-db-py-open-ro` | `materializer/amanuensis_materializer/db.py:open_ro` | The projection's only connection is opened read-only through a SQLite URI, so it cannot write to the store it reads and cannot create a view the store lacks. That is what makes the view probe a statement about the store's age rather than about a schema the reader could have repaired. | Observation | `258ccd28fc19` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-08/state-container/materializer-amanuensis-materializer-core-py-materializer` | `materializer/amanuensis_materializer/core.py:Materializer` | The Materializer holds the per-run state of a publish — the opened read-only connection, the page plan, and the summary of what was written. Lifetime is one invocation of the CLI; nothing is cached between runs, so a projection is always derived from the store as it stands when the process starts. | Observation | `258ccd28fc19` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-08/flow/publish/01` | `materializer/amanuensis_materializer/core.py:Materializer.materialize` | Step 1 of a publish: the required views are probed before anything is rendered, and a non-empty result refuses the publish naming the views that are absent. The refusal is explicit about not falling back to an inline copy of the predicate — two copies of one definition being the drift the views exist to remove. | Observation | `258ccd28fc19` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-08/concurrency` | `B-08` | The projection runs in its own process and reads a WAL store read-only, so it does not block a writing server and is not blocked by one. What it cannot do is see a consistent moment across a long publish: a writer that commits mid-run is visible to later queries and not to earlier ones, which is why the read-back compares finished bytes against a receipt rather than re-querying. | Inference | `258ccd28fc19` |

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-09/concurrency` | `B-09` | Verification is single-threaded and runs after the render in the same process, over files on disk. Its guarantee is about bytes, not about the store: it can show that what was written is what the contract recorded, and cannot show that the store did not change while the render ran. | Inference | `258ccd28fc19` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-06](../seams.md#sm-06)** | memory.db, opened read-only by the projection while the server holds it read-write | **[B-02](b02-repository-binding-and-storage-custody.md)** | both parties are `mapped` |
| **[SM-07](../seams.md#sm-07)** | .projection-contract.json (the per-page hash receipt) | **[B-09](b09-projection-read-back-and-publication-custody.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-08** | → | **[B-02](b02-repository-binding-and-storage-custody.md)** | data-flow | structural | the projection reads the store the server owns, through a read-only URI that cannot create anything the store lacks, read at materializer/amanuensis_materializer/db.py:open_ro@258ccd2 |
| **B-08** | → | **[B-04](b04-survey-record-tools.md)** | data-flow | observed | the topology page is rendered from recorded xrefs rows and from nothing else, so an edge exists on the page because a survey recorded it here, read at mcp-server/src/tools/xrefs.ts:xrefTools@258ccd2 |
| **B-08** | → | **[B-09](b09-projection-read-back-and-publication-custody.md)** | data-flow | structural | the rendered page list is what the contract is written over, so the render decides the denominator the read-back then verifies, read at materializer/amanuensis_materializer/readback.py:write_contract@258ccd2 |

## Known defects here

1 defect here is open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- The subsystem map prints each subsystem's finding count as "N (M open)" where M is computed from findings.status, while the subsystem page for the same subsystem lists those findings with a resolution_state read from finding_state_current. One publish carries two definitions of open. — [B08-1](../findings.md#b08-1) · 🔵 LOW · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 2 of 5 ledger rows |
| Files in scope, not yet read | 3 of 5 |
| Files excluded from the survey obligation | 0 of 5 |
| Ledger rows the repository has changed under | 0 of 5 |
| Active concerns with a disposition recorded here | 8 of 15 — 1 confirmed-bug, 6 confirmed-acceptable, 1 out-of-scope |
| Findings by resolution state | 1 open |
| Seams assessable from both sides | 2 of 2 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-800e1694d6"></a>`materializer/amanuensis_materializer/html_projection.py` | candidate | The self-contained HTML index and its no-JavaScript reading path. | `258ccd28` |
| <a id="le-5234da7008"></a>`materializer/amanuensis_materializer/renderers.py` | candidate | One renderer per page; where claims, findings and prose become Markdown. | `258ccd28` |
| <a id="le-6e303a6690"></a>`materializer/materialize.py` | candidate | The CLI the server spawns; the process boundary between the two languages. | `258ccd28` |
| <a id="le-c5bae98ee5"></a>`materializer/amanuensis_materializer/core.py` | examined | The Materializer: opens the store read-only, refuses by name when a required view is absent, plans the pages, and records the files it produced. | `258ccd28` |
| <a id="le-5d83ccabbe"></a>`materializer/amanuensis_materializer/db.py` | examined | open_ro is the read-only URI open that makes the whole projection incapable of writing to the store it reads. | `258ccd28` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[BV-1](../concerns.md#bv-1)** | confirmed-acceptable | code-verified |  | This process resolves no agent-supplied path: it is handed a storage directory and an output root, reads memory.db beneath the first and writes only beneath the second, and the containment assertion that decided the output root ran in [B-02](b02-repository-binding-and-storage-custody.md) before the tool spawned it. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-bug | code-verified |  | The subsystem map's open-bug column is computed inline from findings.status while render_subsystem, twelve lines below in the same module, joins finding_state_current for the same findings — so one publish carries two definitions of open, in a module whose own publish gate refuses to start when the views are absent precisely so that no renderer has to keep a copy of the predicate. |
| **[EV-1](../concerns.md#ev-1)** | out-of-scope | code-verified |  | The projection records no revision and invokes no git: it renders the revisions the store already holds, so whether those resolve is decided at the writes [B-04](b04-survey-record-tools.md) and [B-05](b05-findings-dispositions-and-resolution-custody.md) own, and a check here would be a second opinion formed after the fact rather than at ingress. |
| **[GT-1](../concerns.md#gt-1)** | confirmed-acceptable | code-verified |  | The Python half of the vocabulary is generated from the same source as the TypeScript half and compared against it value by value in CI, which is what makes a projection label and a tool validator two renderings of one enum rather than two lists that happen to agree. |
| **[RC-1](../concerns.md#rc-1)** | confirmed-acceptable | code-verified |  | Its own process, its own read-only connection opened inside materialize and closed in that function's finally, so nothing outlives the run; a WAL reader neither blocks nor is blocked by a writing server, and what it cannot do — see one consistent moment across a long publish — is why the read-back compares finished bytes to a receipt instead of re-querying. |
| **[SC-6](../concerns.md#sc-6)** | confirmed-acceptable | code-verified |  | From the reader's side: mode=ro is enforced at the connection, so this party cannot repair what it finds, and it does not try — an absent view refuses the publish by name instead of being created, which is what makes the probe a statement about the store rather than about the reader's willingness to leave it alone. |
| **[SC-7](../concerns.md#sc-7)** | confirmed-acceptable | code-verified |  | From the render's side: the page plan decides which files exist and the manifest records them, so the denominator the verifier hashes is the render's own result rather than a pattern guessed over a directory. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-acceptable | code-verified |  | The publish refuses by name before a byte is written when a required view is absent, so the failure a reader would otherwise see as a lens rendering empty is raised as a refusal instead; absence stops the run here rather than passing through it as a page with nothing on it. |

### Survey artifact

#### **B-08** · Materializer rendering pipeline

Structural inventory at `258ccd2`.

##### Key types

| Symbol | Role | Source |
|---|---|---|
| `open_ro` | the read-only URI open; the projection cannot write the store it reads | `materializer/amanuensis_materializer/db.py:open_ro@258ccd2` |
| `Materializer` | per-run state: the connection, the page plan, the summary | `materializer/amanuensis_materializer/core.py:Materializer@258ccd2` |

##### State containers

| Name | Location | Stores | Lifetime | Populated by | Invalidated by |
|---|---|---|---|---|---|
| the `Materializer` instance | `materializer/amanuensis_materializer/core.py:Materializer@258ccd2` | the open connection, the plan, the summary | one CLI invocation | construction | process exit; nothing is cached between runs |

##### Data flow · a publish

1. The required views are probed before anything renders, and a non-empty result refuses the
   publish naming them, with an inline copy of the predicate explicitly ruled out
   (`materializer/amanuensis_materializer/core.py:Materializer.materialize@258ccd2`).

##### Concurrency model

Its own process, reading a WAL store read-only: it neither blocks nor is blocked by a writing
server. What it cannot do is see one consistent moment across a long publish, which is why the
read-back compares finished bytes to a receipt rather than re-querying. Recorded as an inference.

##### Seam contracts

- **[SM-06](../seams.md#sm-06) · `memory.db`, with [B-02](b02-repository-binding-and-storage-custody.md).** This side reads through a read-only URI and writes only to
  the output directory. The reader cannot repair the schema it finds, which is what makes an
  absent view a refusal rather than a silent `CREATE`.

##### Concern review

Six active concerns, all terminal at `0fee11b`. One confirmed bug.

| Concern | Disposition | Reading |
|---|---|---|
| [CC-1](../concerns.md#cc-1) | **confirmed-bug** ([B08-1](../findings.md#b08-1)) | `render_master_plan` computes the open-bug column inline while `render_subsystem` joins the view for the same findings. |
| [RC-1](../concerns.md#rc-1) | confirmed-acceptable | Own process, own read-only connection, opened in `materialize` and closed in its `finally`. |
| [BV-1](../concerns.md#bv-1) | confirmed-acceptable | Resolves no agent-supplied path; the containment assertion ran in [B-02](b02-repository-binding-and-storage-custody.md) before this process started. |
| [EV-1](../concerns.md#ev-1) | out-of-scope | Records no revision and invokes no git; it renders the revisions the store holds. |
| [GT-1](../concerns.md#gt-1) | confirmed-acceptable | The Python vocabulary is generated from the same source as the TypeScript one and compared against it in CI. |
| [ZD-1](../concerns.md#zd-1) | confirmed-acceptable | An absent view refuses the publish by name before a byte is written. |

##### Adversarial review

**Finding [B08-1](../findings.md#b08-1) — upheld.** Claim A: one publish carries two definitions of open. Claim B: a
read-back axis compares them. Evidence for Claim B: the state axis checks the ledger-stale
partition and the resolution-marker partition; neither brings the subsystem map's count and
the subsystem pages' resolution states together. Verdict: **upheld**.

**Claims.** Four targets, all survived — including `concurrency`, where the probe looked for a
snapshot mechanism and found `immutable=0` set explicitly, the opposite choice.
