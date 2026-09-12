# **B-06** — Locus standing and the reader lenses

**Status**: 🟢 mapped  
**Layer**: mcp-server

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server/src/standing.ts, mcp-server/src/tools/locus.ts — describe_locus, the standing ladder and its authorization text, the compactness budget and omission ledger, and get_attention / get_history.

## Start here

mcp-server/src/standing.ts, then mcp-server/src/tools/locus.ts

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-06/key-type/mcp-server-src-standing-ts-standing-authority-order` | `mcp-server/src/standing.ts:STANDING_AUTHORITY_ORDER` | Standing is one of seven states with an explicit weakest-first authority order, so a file owned by several subsystems that disagree resolves to `mixed` authorizing only what its weakest owner authorizes. The comment records the ordering as a gap the specification left open, decided here rather than left to each caller. | Observation | `258ccd28fc19` |
| `B-06/key-type/mcp-server-src-tools-locus-ts-no-claims-statement` | `mcp-server/src/tools/locus.ts:NO_CLAIMS_STATEMENT` | A subsystem with no claims renders the literal "Structural inventory not recorded as claims" rather than an empty section, and any survey prose attached beside it carries a label saying it is not individually bound to a revision. Silence and absence are made distinguishable in the response itself. | Observation | `258ccd28fc19` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-06/state-container` | `B-06` | **B-06** retains nothing between calls: describe_locus, get_attention and get_history each assemble an answer from views and tables and return it. The only per-call state is the section-build scratch inside one handler, and it does not outlive the response. | Inference | `258ccd28fc19` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-06/flow/describe-a-file/01` | `mcp-server/src/schema.sql:file_standing` | Step 1 of answering about a file: the ledger row is mapped to a standing state by a CASE over classification and stale — absent, excluded, scoped-unread, examined, examined-stale — with the owning subsystem's status carried along as the authority ceiling. A path with no ledger row reaches no branch, which is what makes `unledgered` an answer rather than an error. | Observation | `258ccd28fc19` |
| `B-06/flow/describe-a-file/02` | `mcp-server/src/tools/locus.ts:WIRE_BUDGET` | Step 2: the assembled account is bounded at 8192 bytes measured on what the host receives — the compact text block plus the structuredContent that repeats it — and the caller's locus is capped at 512 bytes because it is echoed into untruncatable parts of the response, where each byte costs four on the wire. | Observation | `258ccd28fc19` |

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/key-type/mcp-server-src-schema-sql-claims` | `mcp-server/src/schema.sql:claims` | A claim is an immutable row over a revision interval: claim_key plus subject, a statement, an epistemic_kind constrained by CHECK, and valid_from_sha / valid_until_sha. Superseding a claim closes the old interval and inserts a new row, so the record keeps both readings rather than overwriting one. | Observation | `258ccd28fc19` |
| `B-05/concurrency` | `B-05` | There is no locking around a finding's state because there is nothing to lock: the state is derived from an append-only table, so two writers produce two events and the view reports the later one rather than a lost update. Ordering is the insertion order of the events, within one synchronous connection. | Inference | `258ccd28fc19` |
| `B-05/key-type/mcp-server-src-schema-sql-finding-state-current` | `mcp-server/src/schema.sql:finding_state_current` | A finding's resolution state is a view, not a column: COALESCE over finding_resolution_current with a CASE fallback from the legacy findings.status. Every finding therefore has exactly one state, and the legacy column survives only as the default for findings that never received an event. | Observation | `258ccd28fc19` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-04](../seams.md#sm-04)** | file_standing and finding_state_current (the two derived views) | **[B-03](b03-conspectus-schema-vocabulary-and-invariants.md)** | both parties are `mapped` |
| **[SM-05](../seams.md#sm-05)** | finding_resolution_events and the current-state view over it | **[B-05](b05-findings-dispositions-and-resolution-custody.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-06** | → | **[B-03](b03-conspectus-schema-vocabulary-and-invariants.md)** | data-flow | structural | every file answer's standing state comes out of the view rather than from a predicate the reader recomputes, read at mcp-server/src/schema.sql:file_standing@258ccd2 |
| **[B-05](b05-findings-dispositions-and-resolution-custody.md)** | → | **B-06** | data-flow | observed | the resolution state the findings tools append is what the attention lens partitions on, so an event written here changes which lens a finding appears in, read at mcp-server/src/schema.sql:finding_state_current@258ccd2 |
| **[B-07](b07-git-state-staleness-and-refresh.md)** | → | **B-06** | data-flow | structural | the stale flag and reason this pass writes are what turn an examined standing into examined-stale for every later answer, read at mcp-server/src/tools/git.ts:gitTools@258ccd2 |

## Known defects here

No defect here is open or awaiting verification.

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 3 of 3 ledger rows |
| Files in scope, not yet read | 0 of 3 |
| Files excluded from the survey obligation | 0 of 3 |
| Ledger rows the repository has changed under | 0 of 3 |
| Active concerns with a disposition recorded here | 8 of 15 — 7 confirmed-acceptable, 1 out-of-scope |
| Findings by resolution state | none recorded |
| Seams assessable from both sides | 2 of 2 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-4d254f76a1"></a>`mcp-server/src/schema.sql` | examined | file_standing is the view every file answer is derived from; read here for the CASE that maps a ledger row onto a standing state. | `258ccd28` |
| <a id="le-a93b554a94"></a>`mcp-server/src/standing.ts` | examined | The seven standing states, the authority order mixed is resolved against, and the locus kind inference; 1137 lines that decide what an answer is allowed to say. | `258ccd28` |
| <a id="le-263cb941e6"></a>`mcp-server/src/tools/locus.ts` | examined | describe_locus, get_attention and get_history: the account sections, the wire budgets, and the omission ledger that declares what a budget cost. | `258ccd28` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[BV-1](../concerns.md#bv-1)** | confirmed-acceptable | code-verified |  | The only agent-supplied argument here is a locus, which is matched against ledger and vocabulary rows and never opened, so there is no filesystem boundary to contain it against; the bound that does apply is enforced twice from one constant — advertised as maxLength and re-checked in code — so a host that validates its calls and one that does not are refused alike. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | code-verified |  | This is the subsystem the concern was written about and the one that honours it: every standing read selects from file_standing and every resolution read from finding_state_current, and the CASE expressions here aggregate over standing_state — a column the view already produced — rather than re-deriving it from classification and stale. |
| **[EV-1](../concerns.md#ev-1)** | confirmed-acceptable | code-verified |  | This subsystem reads revisions rather than recording them, and it is the one place where the record's meaning depends on ancestry and the check is made for that reason: a ledger row's examination revision is resolved and then asked whether it reaches HEAD, with an unresolvable revision and a resolvable one off this branch given different reasons rather than collapsed. |
| **[GT-1](../concerns.md#gt-1)** | confirmed-acceptable | code-verified |  | The reader surfaces import their labels and their cannot-justify lines from the generated module instead of restating them, and the enums they own carry no SQL binding, so those vocabularies have only the source and two generated copies as parties — both rewritten by the generator and compared by the checker. |
| **[RC-1](../concerns.md#rc-1)** | out-of-scope | code-verified |  | These handlers are read-only and retain nothing between calls: each assembles an answer from views and tables and returns it, so there is no handle, no process, and no directory whose lifecycle could be wrong. |
| **[SC-4](../concerns.md#sc-4)** | confirmed-acceptable | code-verified |  | From the reader's side: every standing read selects from file_standing and every resolution read from finding_state_current, and the CASE expressions in this module aggregate over a column the view produced rather than re-deriving it, so this party holds no copy of the definer's predicate. |
| **[SC-5](../concerns.md#sc-5)** | confirmed-acceptable | code-verified |  | From the partitioner's side: the lens membership queries select resolution_state from the view, and because the view yields exactly one row per finding a record cannot satisfy two partitions or none by this party's own doing — a finding in both lenses or in neither would be a partition defect, which the projection's own state axis is what checks. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-acceptable | code-verified |  | The hot-spots reader takes its emptiness test on the joined result rather than on the source table, so a column of zeros is never printed over an access log whose rows reach no subsystem, and an unknown locus is answered with a standing state instead of an error — absence is a reading here, not a silence. |

### Survey artifact

#### **B-06** · Locus standing and the reader lenses

Structural inventory at `258ccd2`.

##### Key types

| Symbol | Role | Source |
|---|---|---|
| `STANDING_AUTHORITY_ORDER` | seven states, weakest first, so `mixed` authorizes what its weakest owner does | `mcp-server/src/standing.ts:STANDING_AUTHORITY_ORDER@258ccd2` |
| `WIRE_BUDGET` | 8192 bytes measured on the text block plus the `structuredContent` repeating it | `mcp-server/src/tools/locus.ts:WIRE_BUDGET@258ccd2` |
| `NO_CLAIMS_STATEMENT` | the literal a subsystem with no claims renders instead of an empty section | `mcp-server/src/tools/locus.ts:NO_CLAIMS_STATEMENT@258ccd2` |

##### State containers

None: each call assembles an answer from views and tables and returns it, and the per-call
scratch does not outlive the response. Recorded as an explicit negative claim
(`B-06/state-container`).

##### Data flow · describing a file

1. The ledger row is mapped to a standing state by a CASE over classification and stale, with
   the owning subsystem's status carried as the authority ceiling
   (`mcp-server/src/schema.sql:file_standing@258ccd2`). A path with no ledger row reaches no
   branch, which is what makes `unledgered` an answer rather than an error.
2. The assembled account is bounded at 8192 wire bytes, and the caller's locus is capped at 512
   bytes because it is echoed into untruncatable parts of the response
   (`mcp-server/src/tools/locus.ts:WIRE_BUDGET@258ccd2`).

##### Concurrency model

Read-only within a call; `describe_locus` is annotated read-only and writes nothing.

##### Seam contracts

- **[SM-04](../seams.md#sm-04) · the two derived views, with [B-03](b03-conspectus-schema-vocabulary-and-invariants.md).** This side reads and never reimplements the
  predicate; that is concern [CC-1](../concerns.md#cc-1).
- **[SM-05](../seams.md#sm-05) · the event spine, with [B-05](b05-findings-dispositions-and-resolution-custody.md).** This side partitions on the state the other appends.

##### Concern review

Six active concerns, all terminal at `0fee11b`. No confirmed bug.

| Concern | Disposition | Reading |
|---|---|---|
| [CC-1](../concerns.md#cc-1) | confirmed-acceptable | The subsystem the concern was written about, and the one that honours it: every read selects from the view. |
| [RC-1](../concerns.md#rc-1) | out-of-scope | Read-only handlers that retain nothing between calls. |
| [BV-1](../concerns.md#bv-1) | confirmed-acceptable | The one bound on an agent-supplied argument is enforced twice from one constant; a locus is matched, never opened. |
| [EV-1](../concerns.md#ev-1) | confirmed-acceptable | The one place where the record's meaning depends on ancestry and the check is made for that reason. |
| [GT-1](../concerns.md#gt-1) | confirmed-acceptable | Labels and cannot-justify lines are imported from the generated module, not restated. |
| [ZD-1](../concerns.md#zd-1) | confirmed-acceptable | The hot-spots emptiness test is taken on the joined result, so a column of zeros is never printed over a table that looks non-empty. |

##### Adversarial review

No finding to challenge. Five claim targets, all survived.

| Claim | Challenge | Outcome |
|---|---|---|
| `B-06/key-type/…standing-authority-order` | Is `mixed` a first-wins scan rather than a minimum? | survived |
| `B-06/key-type/…no-claims-statement` | Can an unrecorded inventory read as an empty one? | survived |
| `B-06/flow/describe-a-file/01` | Does the CASE produce the five states claimed? | survived — the unmentioned `ELSE` is reachable only for a classification outside the CHECK and folds to `scoped-unread`. |
| `B-06/flow/describe-a-file/02` | Is the budget measured on the emitted bytes or on a promise? | survived |
| `B-06/state-container` | Is anything memoized across calls — the repeated git probes, say? | survived; `GitProbe` is built per call. |
