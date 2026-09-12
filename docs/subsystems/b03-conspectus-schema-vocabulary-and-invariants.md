# **B-03** — Conspectus schema, vocabulary, and invariants

**Status**: 🟢 mapped  
**Layer**: mcp-server

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server/src/schema.sql, mcp-server/src/vocabulary.ts, mcp-server/src/invariants.ts, mcp-server/contracts/conspectus-vocabulary.json — the tables and views, the single enum source and its generated modules, and the phase prerequisites that gate every status advance.

## Start here

mcp-server/src/schema.sql, then mcp-server/src/invariants.ts

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/key-type/mcp-server-contracts-conspectus-vocabulary-json-enums-evidence-kind` | `mcp-server/contracts/conspectus-vocabulary.json:enums.evidence_kind` | Every enum value in the vocabulary source carries a label, a meaning, and a cannot_justify line, so the enum states what a value does not authorize as well as what it means. evidence_kind is where code-verified and contract-stated are defined as the two readings a file-anchored claim may rest on, with name-inferred present as a value that rule excludes. | Observation | `258ccd28fc19` |
| `B-03/key-type/mcp-server-src-invariants-ts-enforcemonotonictransition` | `mcp-server/src/invariants.ts:enforceMonotonicTransition` | Status is monotonic by rank: a transition to a lower rank throws, so dependent dispositions and findings cannot be orphaned by a silent regression. `deferred` is exempt in both directions and is parking rather than a rank, which is why a deferred subsystem resumes at whatever depth it held. | Observation | `258ccd28fc19` |
| `B-03/key-type/mcp-server-src-schema-sql-claims` | `mcp-server/src/schema.sql:claims` | A claim is a row over a revision interval: claim_key plus subject, a statement, an epistemic_kind constrained by CHECK, and valid_from_sha / valid_until_sha. Only the interval's end is ever written after insertion: invalidation and supersession both UPDATE the predecessor's valid_until_sha, and supersession then inserts the successor, so the history is preserved by a controlled close-plus-insert rather than by immutability. | Observation | `1542c61ee9ba` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/state-container` | `B-03` | **B-03** holds no mutable state container of its own: schema.sql is applied at open and never mutated afterwards, invariants.ts is a set of pure predicates over rows passed in, and the generated vocabulary module is a frozen set of literals. The state this subsystem describes lives in the database, which [B-02](b02-repository-binding-and-storage-custody.md) owns the handle to. | Inference | `258ccd28fc19` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/flow/status-advance/01` | `mcp-server/src/invariants.ts:requireStructuralClaim` | Step 1 of advancing to `structural`: the file ledger must be non-empty, and a count of current claims whose claim_key begins '<sid>/' must be greater than zero. The refusal names one claim as sufficient and says an empty category is recorded as an explicit negative rather than omitted, so the prerequisite is a floor and not a quota. | Observation | `258ccd28fc19` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/concurrency` | `B-03` | The invariants are checked in the same synchronous call that performs the write, against the same connection, so there is no window between a prerequisite passing and the row it authorized being inserted within one process. Across processes the guarantee is SQLite's, not this subsystem's. | Inference | `258ccd28fc19` |

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-05/concurrency` | `B-05` | There is no locking around a finding's state because there is nothing to lock: the state is derived from an append-only table, so two writers produce two events and the view reports the later one rather than a lost update. Ordering is the insertion order of the events, within one synchronous connection. | Inference | `258ccd28fc19` |
| `B-05/key-type/mcp-server-src-schema-sql-finding-state-current` | `mcp-server/src/schema.sql:finding_state_current` | A finding's resolution state is a view, not a column: COALESCE over finding_resolution_current with a CASE fallback from the legacy findings.status. Every finding therefore has exactly one state, and the legacy column survives only as the default for findings that never received an event. | Observation | `258ccd28fc19` |
| `B-06/flow/describe-a-file/01` | `mcp-server/src/schema.sql:file_standing` | Step 1 of answering about a file: the ledger row is mapped to a standing state by a CASE over classification and stale — absent, excluded, scoped-unread, examined, examined-stale — with the owning subsystem's status carried along as the authority ceiling. A path with no ledger row reaches no branch, which is what makes `unledgered` an answer rather than an error. | Observation | `258ccd28fc19` |
| `B-06/state-container` | `B-06` | [B-06](b06-locus-standing-and-the-reader-lenses.md) retains nothing between calls: describe_locus, get_attention and get_history each assemble an answer from views and tables and return it. The only per-call state is the section-build scratch inside one handler, and it does not outlive the response. | Inference | `258ccd28fc19` |
| `B-10/concurrency` | `B-10` | The skill permits phases to run as subagents, so two phase passes may be in flight at once against one store. Nothing in the prose coordinates them; the ordering that matters is enforced by the server's phase prerequisites, which refuse an advance whose deliverable is absent whatever order the passes finished in. | Inference | `258ccd28fc19` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-02](../seams.md#sm-02)** | memory.db and the views initializeSchema creates on it | **[B-02](b02-repository-binding-and-storage-custody.md)** | both parties are `mapped` |
| **[SM-04](../seams.md#sm-04)** | file_standing and finding_state_current (the two derived views) | **[B-06](b06-locus-standing-and-the-reader-lenses.md)** | both parties are `mapped` |
| **[SM-08](../seams.md#sm-08)** | the conspectus vocabulary (enum values and what each authorizes) | **[B-10](b10-the-amanuensis-skill.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **[B-06](b06-locus-standing-and-the-reader-lenses.md)** | → | **B-03** | data-flow | structural | every file answer's standing state comes out of the view rather than from a predicate the reader recomputes, read at mcp-server/src/schema.sql:file_standing@258ccd2 |
| **[B-02](b02-repository-binding-and-storage-custody.md)** | → | **B-03** | dependency | structural | the open applies schema.sql and then refuses itself if the required views are absent afterwards, so the store's shape is **B-03**'s and the refusal is [B-02](b02-repository-binding-and-storage-custody.md)'s, read at mcp-server/src/db.ts:openDatabase@258ccd2 |
| **[B-04](b04-survey-record-tools.md)** | → | **B-03** | dependency | structural | the accepted evidence kinds are filtered out of the generated vocabulary module rather than restated, so the enum source decides what a claim may rest on, read at mcp-server/src/tools/claims.ts:FILE_ANCHORED_EVIDENCE@258ccd2 |
| **[B-09](b09-projection-read-back-and-publication-custody.md)** | → | **B-03** | dependency | observed | the state axis's denominator is the stale ledger rows the schema defines, split by the classification column rather than pooled, read at materializer/amanuensis_materializer/readback.py:LEDGER_STALE_SECTIONS@258ccd2 |
| **[B-10](b10-the-amanuensis-skill.md)** | → | **B-03** | dependency | observed | the skill names enum values in prose and is the only hand-written party to the vocabulary contract, which is why a checker reads it independently of the generated copies, read at .claude/skills/amanuensis/SKILL.md:Autonomous@258ccd2 |

## Known defects here

1 defect here is open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- schema.sql tells a reader of dispositions.evidence_quality that "databases created before this widening keep the narrower constraint", which stopped being true when the vocabulary CHECK migration landed: the source binds evidence_quality to that very column, so every open compares its live CHECK against the source and rebuilds the table when it is narrower. — [B03-4](../findings.md#b03-4) · 🔵 LOW · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 3 of 4 ledger rows |
| Files in scope, not yet read | 1 of 4 |
| Files excluded from the survey obligation | 0 of 4 |
| Ledger rows the repository has changed under | 0 of 4 |
| Active concerns with a disposition recorded here | 9 of 15 — 2 confirmed-bug, 6 confirmed-acceptable, 1 out-of-scope |
| Findings by resolution state | 1 open |
| Seams assessable from both sides | 3 of 3 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-6e3d148104"></a>`mcp-server/src/vocabulary.ts` | candidate | The generated TypeScript enum module the validators import; one of the four parties to the vocabulary contract. | `258ccd28` |
| <a id="le-2cc520912c"></a>`mcp-server/contracts/conspectus-vocabulary.json` | examined | The single enum source the generated modules, the SQL CHECK literals, the tool validators, and SKILL.md all have to agree with. | `258ccd28` |
| <a id="le-52e57f0975"></a>`mcp-server/src/invariants.ts` | examined | The status ladder, the monotonic-transition rule, and the phase prerequisites that decide whether a status advance is admitted. | `258ccd28` |
| <a id="le-5328e62966"></a>`mcp-server/src/schema.sql` | examined | Every table, CHECK constraint, index, and view the record is made of; the shape of everything the system can know. | `258ccd28` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[BV-1](../concerns.md#bv-1)** | confirmed-acceptable | code-verified |  | The schema does the half of boundary validation a substrate can do — a CHECK on every vocabulary-constrained column, so an out-of-enum value is refused by SQLite whatever the handler believed — and none of the half it cannot: containment of a path against a canonical root is not expressible in SQL and is asserted at ingress in [B-02](b02-repository-binding-and-storage-custody.md) and [B-04](b04-survey-record-tools.md) instead. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | code-verified |  | This subsystem holds the single definition rather than a copy of it: the view COALESCEs the newest resolution event over one legacy CASE, and the comment beside it records the divergence that motivated the view — one legacy row reading as accepted on one surface and as an active defect on another. Whether a given reader honours it is that reader's disposition, not this one's. |
| **[EV-1](../concerns.md#ev-1)** | confirmed-acceptable | code-verified |  | The schema makes a revision structurally mandatory on every claim and evidence row and refuses a validity interval that closes where it opened, and stops exactly where a substrate must: whether a recorded sha resolves, and whether it is an ancestor of the authority commit, needs git and is enforced in the claim handlers. |
| **[GT-1](../concerns.md#gt-1)** | confirmed-bug | code-verified |  | The generated and checked parties hold, but the schema carries hand-written prose about a vocabulary binding that the code has since falsified: the comment beside dispositions.evidence_quality states that a database created before the widening keeps the narrower constraint, and migrateVocabularyChecks rebuilds exactly that column on every open because the source declares the binding — a divergence in the one direction the four-party check does not look, since prose in schema.sql is not one of the four parties. |
| **[RC-1](../concerns.md#rc-1)** | out-of-scope | code-verified |  | There is no resource here to have a lifecycle: schema.sql is text applied by [B-02](b02-repository-binding-and-storage-custody.md) at open, invariants.ts is pure predicates over a connection passed in, and the generated vocabulary module is frozen literals — the subsystem opens no handle, spawns no process, and writes no directory. |
| **[SC-2](../concerns.md#sc-2)** | confirmed-acceptable | code-verified |  | From the owner's side: every object is written CREATE ... IF NOT EXISTS so the file is safe to apply repeatedly, which is what makes the custodian's per-open application the delivery mechanism; the owner cannot reach an existing store itself, and says so in the comment beside the column where it matters. |
| **[SC-4](../concerns.md#sc-4)** | confirmed-acceptable | code-verified |  | From the definer's side: both predicates are held once, as views the custodian's open asserts the existence of, and the reader on this seam consumes them without a fallback — the two copies that do exist are in [B-04](b04-survey-record-tools.md) and [B-08](b08-materializer-rendering-pipeline.md), which are not parties here, and are recorded as [B04-5](../findings.md#b04-5) and [B08-1](../findings.md#b08-1). |
| **[SC-8](../concerns.md#sc-8)** | confirmed-bug | code-verified |  | From the source's side: the contract declares twenty-five enums and provides no anchor by which a prose party could be located and compared, so the checker has to hand-write a regex per vocabulary and has written two; finding of record [B10-1](../findings.md#b10-1). |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-acceptable | code-verified |  | This subsystem is where the repository's own zero-denominator green is recorded and repaired: the schema names finding B03-2 in a comment and states the fix, which is that staleness lives on file_ledger because enforcePhasePrerequisites makes that table non-empty for any subsystem past scoping, so the denominator behind every derived staleness signal is non-empty by construction rather than by luck. |

### Survey artifact

#### **B-03** · Conspectus schema, vocabulary, and invariants

Structural inventory at `258ccd2`.

##### Key types

| Symbol | Role | Source |
|---|---|---|
| `claims` | an immutable row over a revision interval; supersession closes an interval and inserts | `mcp-server/src/schema.sql:claims@258ccd2` |
| `enforceMonotonicTransition` | a status may not regress; `deferred` is parking, exempt in both directions | `mcp-server/src/invariants.ts:enforceMonotonicTransition@258ccd2` |
| `enums.evidence_kind` | each value carries a label, a meaning, and what it cannot justify | `mcp-server/contracts/conspectus-vocabulary.json:enums.evidence_kind@258ccd2` |

##### State containers

None. `schema.sql` is applied at open and not mutated afterwards, `invariants.ts` is pure
predicates over rows passed in, and the generated vocabulary module is frozen literals. The
state this subsystem describes lives in the database [B-02](b02-repository-binding-and-storage-custody.md) holds the handle to. Recorded as an
explicit negative claim (`B-03/state-container`) rather than an omitted section.

##### Data flow · a status advance

1. `requireStructuralClaim` counts current claims whose `claim_key` begins `<sid>/` and refuses
   the advance at zero, after the file ledger has been found non-empty
   (`mcp-server/src/invariants.ts:requireStructuralClaim@258ccd2`).
2. The refusal names one claim as sufficient and says an empty category is recorded as an
   explicit negative claim — a floor, not a quota.

##### Concurrency model

The prerequisite is checked in the same synchronous call as the write it authorizes, against
the same connection, so there is no in-process window between the two. Across processes the
guarantee is SQLite's. Recorded as an inference.

##### Seam contracts

- **[SM-02](../seams.md#sm-02) · `memory.db` and its views, with [B-02](b02-repository-binding-and-storage-custody.md).** This side defines every table, CHECK, index
  and view, including the two the open asserts. The views are `CREATE VIEW IF NOT EXISTS`, so
  they exist because a server opened the store, not because the file is a database.

##### Concern review

Six active concerns, all terminal at `0fee11b`.

| Concern | Disposition | Reading |
|---|---|---|
| [CC-1](../concerns.md#cc-1) | confirmed-acceptable | Holds the single definition of both derived predicates, with the divergence that motivated the view recorded beside it. |
| [RC-1](../concerns.md#rc-1) | out-of-scope | No handle, no process, no directory: schema text, pure predicates, and generated literals. |
| [BV-1](../concerns.md#bv-1) | confirmed-acceptable | Does the half a substrate can do — a CHECK on every vocabulary-constrained column — and none of the half it cannot. |
| [EV-1](../concerns.md#ev-1) | confirmed-acceptable | Makes a revision structurally mandatory and an interval non-degenerate; resolution and ancestry need git and live in the handlers. |
| [GT-1](../concerns.md#gt-1) | **confirmed-bug** ([B03-4](../findings.md#b03-4)) | Hand-written prose inside `schema.sql` is a fifth party to the vocabulary contract, and no check reads it. |
| [ZD-1](../concerns.md#zd-1) | confirmed-acceptable | Where the repository's own zero-denominator green is recorded and repaired, by moving staleness onto a table the prerequisites keep non-empty. |

##### Adversarial review

**Finding [B03-4](../findings.md#b03-4) — upheld.** Claim A: the comment beside `dispositions.evidence_quality` is
false at `0fee11b`, because the vocabulary migration rebuilds that column on open. Claim B:
`gen-vocabulary.mjs --check-sql` reads `schema.sql` and might have caught it. Evidence for
Claim B: `mcp-server/scripts/gen-vocabulary.mjs:the generator header and --check-sql@0fee11b`
— it extracts CHECK literals and compares value lists, and parses no comment.
Verdict: **upheld**.

**Claims.** Six targets, all survived.

| Claim | Challenge | Outcome |
|---|---|---|
| `B-03/key-type/…claims` | Is a claim ever updated in place rather than closed and re-inserted? | survived |
| `B-03/key-type/…enforcemonotonictransition` | Is `deferred` exempt in both directions, or only on the way in? | survived |
| `B-03/key-type/…enums-evidence-kind` | Does every value really carry what it cannot justify? | survived |
| `B-03/flow/status-advance/01` | Can an insert opening at a later status skip the prerequisite? | survived — `enforceForwardPrerequisites` replays every intermediate rung. |
| `B-03/state-container` | Is the generated module actually frozen? | survived, with the word qualified: `as const` is readonly to the type checker and an ordinary array at run time. The claim's consequence holds; nothing mutates them. |
| `B-03/concurrency` | Is there a window between a prerequisite passing and the row it admitted? | survived |
