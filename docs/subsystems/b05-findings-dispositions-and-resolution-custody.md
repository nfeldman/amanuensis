# **B-05** — Findings, dispositions, and resolution custody

**Status**: 🟢 mapped  
**Layer**: mcp-server

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server/src/tools/{findings,resolution,dispositions,concerns,contradictions}.ts — concern dispositions, findings and their severity, the append-only resolution event spine, and the current-state views read from it.

## Start here

mcp-server/src/tools/findings.ts, then mcp-server/src/tools/resolution.ts

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-05/key-type/mcp-server-src-schema-sql-finding-state-current` | `mcp-server/src/schema.sql:finding_state_current` | A finding's resolution state is a view, not a column: COALESCE over finding_resolution_current with a CASE fallback from the legacy findings.status. Every finding therefore has exactly one state, and the legacy column survives only as the default for findings that never received an event. | Observation | `258ccd28fc19` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-05/state-container/mcp-server-src-tools-findings-ts-findingtools` | `mcp-server/src/tools/findings.ts:findingTools` | The durable state these tools hold is the append-only finding_resolution_events table. Creating a finding inserts its first event in the same transaction, so a finding has a state from the moment it exists; nothing here updates or deletes an event, and a state change is another row. Lifetime is the store's; invalidation is by appending, never by rewriting. | Observation | `258ccd28fc19` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-05/flow/read-a-findings-state/01` | `mcp-server/src/tools/findings.ts:findingTools` | Step 1 of reading a finding's state: the reader joins finding_state_current rather than selecting findings.status, so the derived view is the single definition of the predicate and not one of two that can drift apart. | Observation | `258ccd28fc19` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-05/concurrency` | `B-05` | There is no locking around a finding's state because there is nothing to lock: the state is derived from an append-only table, so two writers produce two events and the view reports the later one rather than a lost update. Ordering is the insertion order of the events, within one synchronous connection. | Inference | `258ccd28fc19` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-05](../seams.md#sm-05)** | finding_resolution_events and the current-state view over it | **[B-06](b06-locus-standing-and-the-reader-lenses.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-05** | → | **[B-06](b06-locus-standing-and-the-reader-lenses.md)** | data-flow | observed | the resolution state the findings tools append is what the attention lens partitions on, so an event written here changes which lens a finding appears in, read at mcp-server/src/schema.sql:finding_state_current@258ccd2 |

## Known defects here

1 defect here is open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- A concern verdict and a confirmed bug are both stored with a ref_sha nobody resolved, so a disposition or finding can claim to have been assessed at a revision that exists in no repository, and every surface that prints the binding repeats the claim. — [B05-1](../findings.md#b05-1) · 🟡 MEDIUM · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 1 of 5 ledger rows |
| Files in scope, not yet read | 4 of 5 |
| Files excluded from the survey obligation | 0 of 5 |
| Ledger rows the repository has changed under | 0 of 5 |
| Active concerns with a disposition recorded here | 7 of 15 — 1 confirmed-bug, 5 confirmed-acceptable, 1 out-of-scope |
| Findings by resolution state | 1 open |
| Seams assessable from both sides | 1 of 1 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-7ce6ef22ff"></a>`mcp-server/src/tools/concerns.ts` | candidate | add_concern and the coverage view the checklist is read back through. | `258ccd28` |
| <a id="le-c6de90fef6"></a>`mcp-server/src/tools/contradictions.ts` | candidate | The second record family with its own resolution event table, which the History lens reads beside findings. | `258ccd28` |
| <a id="le-9736e1d219"></a>`mcp-server/src/tools/dispositions.ts` | candidate | set_disposition is the concerns phase's deliverable and the prerequisite for the adversarial advance. | `258ccd28` |
| <a id="le-e0b8f662c1"></a>`mcp-server/src/tools/resolution.ts` | candidate | verify_finding_fix and the audit tool: post-fix evidence at the repaired revision, with ancestry checked. | `258ccd28` |
| <a id="le-61c74bed77"></a>`mcp-server/src/tools/findings.ts` | examined | add_finding, update_finding_status and the readers; every state change writes a finding_resolution_events row and every reader joins the derived view. | `258ccd28` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[BV-1](../concerns.md#bv-1)** | confirmed-acceptable | code-verified |  | Every path these tools store is guarded — fix_location through requireWorkspaceSourcePath and each primary_files entry through requireWorkspaceCitation — and the one unguarded string, a disposition's free-text evidence field, is never opened, joined on, or resolved: it is displayed, and non-strict parsing still refuses a value pointing into reserved tool state. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | code-verified |  | Both readers in this subsystem join finding_state_current and return its resolution_state beside the coarse column rather than instead of it, and the verification path reads finding_resolution_current directly, so nothing here holds a second mapping of findings.status. |
| **[EV-1](../concerns.md#ev-1)** | confirmed-bug | code-verified |  | set_disposition and add_finding both take ref_sha as an unvalidated string, and the disposition's free-text citation is parsed in non-strict mode, so a verdict can be bound to a revision that resolves nowhere; verify_finding_fix in the same module resolves both its revisions and checks ancestry, which shows the resolution is available and simply not applied where a reading is recorded. |
| **[GT-1](../concerns.md#gt-1)** | confirmed-acceptable | code-verified |  | This subsystem is where the drift the whole contract was built for was found — a tool accepting nine evidence qualities over a CHECK admitting five — and it now validates every enum argument against the generated arrays rather than a local list, so the tool side and the SQL side are two renderings of one source with parity asserted in CI. |
| **[RC-1](../concerns.md#rc-1)** | out-of-scope | code-verified |  | Nothing here owns a resource: the durable state is an append-only table written through the connection [B-02](b02-repository-binding-and-storage-custody.md) holds, and the writes that must not interleave are wrapped in db.transaction rather than held under a handle of this subsystem's own. |
| **[SC-5](../concerns.md#sc-5)** | confirmed-acceptable | code-verified |  | From the appender's side: every state change is a row on finding_resolution_events written in the same transaction as the change that caused it, and this party's own readers go through the view rather than the column, so what it publishes to the partitioner is one state per finding with no second opinion behind it. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-acceptable | code-verified |  | The guards here cannot be satisfied by an absent subject: add_finding inserts the first resolution event in the same transaction as the finding, so no finding exists without a state to read, and the overturn guard requires evidence attached in the current session — a condition an empty evidence table fails rather than passes. |

### Survey artifact

#### **B-05** · Findings, dispositions, and resolution custody

Structural inventory at `258ccd2`.

##### Key types

| Symbol | Role | Source |
|---|---|---|
| `finding_state_current` | resolution state as a view: COALESCE over the event spine with a legacy fallback | `mcp-server/src/schema.sql:finding_state_current@258ccd2` |
| `findingTools` | the writes and the readers; every state change is an appended event | `mcp-server/src/tools/findings.ts:findingTools@258ccd2` |

##### State containers

| Name | Location | Stores | Lifetime | Populated by | Invalidated by |
|---|---|---|---|---|---|
| `finding_resolution_events` | the store | one row per state transition | persistent | `add_finding` in the same transaction as the finding, then every transition tool | nothing — invalidation is by appending |

##### Data flow · reading a finding's state

1. The reader joins `finding_state_current` rather than selecting `findings.status`, so the
   view is the single definition of the predicate
   (`mcp-server/src/tools/findings.ts:findingTools@258ccd2`).

##### Concurrency model

Nothing is locked because nothing is updated: two writers produce two events and the view
reports the later one rather than a lost update. Ordering is the insertion order of the events.
Recorded as an inference.

##### Seam contracts

- **[SM-05](../seams.md#sm-05) · the event spine and its view, with [B-06](b06-locus-standing-and-the-reader-lenses.md).** This side appends; the reader partitions
  on the result. A finding in both lenses or in neither is the defect the partition gate exists
  to catch.

##### Concern review

Six active concerns, all terminal at `0fee11b`. One confirmed bug.

| Concern | Disposition | Reading |
|---|---|---|
| [CC-1](../concerns.md#cc-1) | confirmed-acceptable | Both readers join `finding_state_current`; the verification path reads the event spine directly. |
| [RC-1](../concerns.md#rc-1) | out-of-scope | The durable state is an append-only table written through [B-02](b02-repository-binding-and-storage-custody.md)'s connection. |
| [BV-1](../concerns.md#bv-1) | confirmed-acceptable | Every stored path is guarded; the one unguarded string is displayed, never opened or joined on. |
| [EV-1](../concerns.md#ev-1) | **confirmed-bug** ([B05-1](../findings.md#b05-1)) | `set_disposition` and `add_finding` bind a reading to an unresolved revision. |
| [GT-1](../concerns.md#gt-1) | confirmed-acceptable | Where the drift the contract was built for was found; every enum argument now validates against the generated arrays. |
| [ZD-1](../concerns.md#zd-1) | confirmed-acceptable | A finding has a state from the moment it exists, and the overturn guard is failed by an empty evidence table, not passed by one. |

##### Adversarial review

**Finding [B05-1](../findings.md#b05-1) — upheld.** Claim A: a verdict can be bound to a revision that resolves
nowhere. Claim B: the schema constrains it. Evidence for Claim B: `dispositions.ref_sha` and
`findings.ref_sha` are both plain nullable `TEXT` — nothing below the handler asks whether the
revision exists. Verdict: **upheld**.

**Claims.** Four targets, all survived.

| Claim | Challenge | Outcome |
|---|---|---|
| `B-05/key-type/…finding-state-current` | Can a finding have two states, or none? | survived — the LEFT JOIN gives exactly one row and the CASE supplies a state for an eventless finding. |
| `B-05/state-container/…findingtools` | Is any event ever updated or deleted? | survived |
| `B-05/flow/read-a-findings-state/01` | Does any reader select `findings.status` instead? | survived here; two readers elsewhere do, which is [B04-5](../findings.md#b04-5) and [B08-1](../findings.md#b08-1). |
| `B-05/concurrency` | Is there a read-modify-write two writers could interleave? | survived |
