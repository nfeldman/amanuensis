# **B-04** — Survey record tools

**Status**: 🟢 mapped  
**Layer**: mcp-server

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server/src/tools/{subsystems,files,evidence,claims,xrefs,seams,vocabulary,artifacts}.ts — the writes a survey makes: the master plan, the file ledger, structured evidence, revision-bound claims, crossing edges, seams, terms, and prose artifacts.

## Start here

mcp-server/src/tools/claims.ts, then mcp-server/src/tools/xrefs.ts

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-04/key-type/mcp-server-src-tools-claims-ts-file-anchored-claim-key` | `mcp-server/src/tools/claims.ts:FILE_ANCHORED_CLAIM_KEY` | Which claims the strong rule applies to is decided by the claim_key's shape, not by an argument: only key-type, state-container and flow keys match. Concurrency and seam keys sit outside the pattern on purpose, because they are derived more often than read, and the accepted kinds are filtered out of the generated vocabulary so that dropping a kind from the enum shrinks this list with it. | Observation | `258ccd28fc19` |
| `B-04/key-type/mcp-server-src-tools-claims-ts-requirefileanchoredevidence` | `mcp-server/src/tools/claims.ts:requireFileAnchoredEvidence` | The file-anchored check requires one attached evidence row to satisfy both halves at once: a kind in {code-verified, contract-stated} and a file_path equal to the path in subject_id. Two rows that each satisfy one half do not satisfy it together, and the refusal names the kinds it found, so a caller can see which half failed. | Observation | `258ccd28fc19` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-04/state-container` | `B-04` | **B-04** holds no mutable state container: every tool module here is a list of definitions whose handlers read arguments, validate them, and write rows through the context's connection. What persists is the database, and the handle to it belongs to [B-02](b02-repository-binding-and-storage-custody.md). | Inference | `258ccd28fc19` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-04/flow/record-an-edge/01` | `mcp-server/src/tools/xrefs.ts:xrefTools` | Step 1 of recording an edge: add_xref's inputSchema requires a context of at least one character carrying a citation token, with the pattern built from the same source string the handler enforces, so a host that validates its calls refuses an uncited edge before the call is made. | Observation | `258ccd28fc19` |
| `B-04/flow/record-an-edge/02` | `mcp-server/src/helpers.ts:extractWorkspaceCitations` | Step 2: the context is split on whitespace, each matching token's path is validated as a workspace source path, and its revision is resolved through the caller's probe. One unresolvable token refuses the whole value, so a single good citation cannot launder the rest. Symbol reachability is not checked, and the contract says so. | Observation | `258ccd28fc19` |
| `B-04/flow/record-an-edge/03` | `mcp-server/src/tools/xrefs.ts:resolvesInWorkspace` | Step 3: the revision probe is `git rev-parse --verify <rev>^{commit}` run with cwd set to the bound workspace, so a sha that resolves only in some other repository is not a citation of this one. The comment records it as the eighth local copy of the probe, kept separate because each caller owns a different failure policy. | Observation | `258ccd28fc19` |

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-01/key-type/mcp-server-src-helpers-ts-servercontext` | `mcp-server/src/helpers.ts:ServerContext` | ServerContext carries the resolved project, the database, and the current session id, and is the only channel a handler has to any of the three; a handler that needs the workspace path or the store reaches it through this object rather than through module state. | Observation | `258ccd28fc19` |
| `B-01/key-type/mcp-server-src-helpers-ts-tooldefinition` | `mcp-server/src/helpers.ts:ToolDefinition` | ToolDefinition is the single shape every tool module exports and it has five members: name, description, inputSchema, a handler taking (args, ctx) in that order, and an optional `compact` flag the dispatcher reads to serialize that tool's text block without indentation. A tool is registered by being present in one of the arrays index.ts concatenates, not by any registration call of its own; and a tool that carries a wire budget is one that sets `compact`, so the budget is enforced on the bytes the host receives rather than promised in a comment. | Observation | `0fee11b0fea1` |
| `B-03/key-type/mcp-server-src-schema-sql-claims` | `mcp-server/src/schema.sql:claims` | A claim is a row over a revision interval: claim_key plus subject, a statement, an epistemic_kind constrained by CHECK, and valid_from_sha / valid_until_sha. Only the interval's end is ever written after insertion: invalidation and supersession both UPDATE the predecessor's valid_until_sha, and supersession then inserts the successor, so the history is preserved by a controlled close-plus-insert rather than by immutability. | Observation | `1542c61ee9ba` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-03](../seams.md#sm-03)** | the ToolDefinition registry (every tool module's exported array) | **[B-01](b01-server-runtime-and-tool-dispatch.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **[B-08](b08-materializer-rendering-pipeline.md)** | → | **B-04** | data-flow | observed | the topology page is rendered from recorded xrefs rows and from nothing else, so an edge exists on the page because a survey recorded it here, read at mcp-server/src/tools/xrefs.ts:xrefTools@258ccd2 |
| **B-04** | → | **[B-01](b01-server-runtime-and-tool-dispatch.md)** | dependency | structural | the edge contract is enforced by a shared helper the tool delegates to, not by the tool module itself, read at mcp-server/src/helpers.ts:extractWorkspaceCitations@258ccd2 |
| **B-04** | → | **[B-03](b03-conspectus-schema-vocabulary-and-invariants.md)** | dependency | structural | the accepted evidence kinds are filtered out of the generated vocabulary module rather than restated, so the enum source decides what a claim may rest on, read at mcp-server/src/tools/claims.ts:FILE_ANCHORED_EVIDENCE@258ccd2 |
| **[B-01](b01-server-runtime-and-tool-dispatch.md)** | → | **B-04** | dependency | structural | the survey tools reach a client only by being concatenated into the one registry the server advertises and dispatches against, read at mcp-server/src/index.ts:main@258ccd2 |
| **[B-10](b10-the-amanuensis-skill.md)** | → | **B-04** | dependency | structural | the structural phase's instructions decide which tools a survey calls and with what claim_key shapes, so the record's form is set here before any handler sees it, read at .claude/skills/amanuensis/references/phase-2-structural.md:Record@258ccd2 |

## Known defects here

2 defects here are open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- add_evidence writes an evidence row whose ref_sha was never resolved, so a disposition or finding can be published citing file:symbol@&lt;sha&gt; for a sha that names no commit in the bound workspace, and every reader downstream presents it as a revision binding. — [B04-4](../findings.md#b04-4) · 🟡 MEDIUM · Open
- The confirmed_bugs rollup on every row list_subsystems returns is computed from findings.status, not from finding_state_current, so the dashboard's count of open bugs and a subsystem page's list of them are produced by two separate definitions of the same predicate. — [B04-5](../findings.md#b04-5) · 🔵 LOW · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 3 of 8 ledger rows |
| Files in scope, not yet read | 5 of 8 |
| Files excluded from the survey obligation | 0 of 8 |
| Ledger rows the repository has changed under | 0 of 8 |
| Active concerns with a disposition recorded here | 7 of 15 — 3 confirmed-bug, 3 confirmed-acceptable, 1 out-of-scope |
| Findings by resolution state | 2 open |
| Seams assessable from both sides | 1 of 1 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-cba3b7d274"></a>`mcp-server/src/tools/artifacts.ts` | candidate | register_artifact and rehash_artifact bind prose to a content hash and a revision. | `258ccd28` |
| <a id="le-c1838fb57e"></a>`mcp-server/src/tools/evidence.ts` | candidate | add_evidence writes the rows every claim is attached to; its kind column is the vocabulary the file-anchored check reads. | `258ccd28` |
| <a id="le-22a0285b77"></a>`mcp-server/src/tools/files.ts` | candidate | add_files_to_scope and update_file_classification write the file ledger the standing view reads. | `258ccd28` |
| <a id="le-cc6692d7ea"></a>`mcp-server/src/tools/seams.ts` | candidate | upsert_seam records the boundary an edge is expected to accompany. | `258ccd28` |
| <a id="le-a1bf1d4393"></a>`mcp-server/src/tools/subsystems.ts` | candidate | upsert_subsystem and update_subsystem_status, where the phase prerequisites are called from. | `258ccd28` |
| <a id="le-c0a8a97339"></a>`mcp-server/src/helpers.ts` | examined | extractWorkspaceCitations is where an edge's context is actually split, path-validated and revision-resolved; the tool delegates the whole grammar to it. | `258ccd28` |
| <a id="le-f3ae99722d"></a>`mcp-server/src/tools/claims.ts` | examined | add_claim and its two subtractive checks: the subject_type enum, and the requirement that a key-type, state-container or flow claim rest on code-grade evidence citing the file its subject names. | `258ccd28` |
| <a id="le-f7badfcd57"></a>`mcp-server/src/tools/xrefs.ts` | examined | add_xref and the citation contract an edge must satisfy before it can be recorded. | `258ccd28` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[BV-1](../concerns.md#bv-1)** | confirmed-acceptable | code-verified |  | Every path this subsystem stores reaches requireWorkspaceSourcePath, directly or through the citation scanner, so an absolute path, a traversing one, or one pointing into reserved tool state is refused before it is written; and the scanner refuses the whole value on one bad token rather than keeping the good ones. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-bug | code-verified |  | list_subsystems computes its confirmed_bugs rollup inline from the coarse findings.status column instead of joining finding_state_current, so the definition of "an open bug" is held here as well as in the view the schema says every reader of finding resolution selects from. |
| **[EV-1](../concerns.md#ev-1)** | confirmed-bug | code-verified |  | add_evidence takes ref_sha as an unvalidated string, so the row every disposition and finding cites can be bound to a revision that resolves in no repository; the claim and edge paths in this same subsystem both resolve their revisions against the bound workspace, which is what shows the omission to be an omission rather than a policy. |
| **[GT-1](../concerns.md#gt-1)** | confirmed-acceptable | code-verified |  | This subsystem consumes the generated vocabulary rather than restating it, and does so by filtering: the accepted file-anchored kinds are derived from EVIDENCE_KINDS, so dropping a kind from the source shrinks this rule with it instead of leaving it naming a kind nothing can carry. The citation grammar is exported as one pattern source and used for both the advertised schema and the handler's check. |
| **[RC-1](../concerns.md#rc-1)** | out-of-scope | code-verified |  | These handlers open nothing and hold nothing: they read arguments, validate them, and write through the connection the context supplies, so the only resources with a lifecycle here are the short-lived git subprocesses the revision probes spawn and reap synchronously. |
| **[SC-3](../concerns.md#sc-3)** | confirmed-bug | code-verified |  | From the producer's side: a module exports an array and does nothing else — no import side effect, no registration call, no manifest — so this party cannot tell whether it was concatenated either, and the two sides agree about the contract while neither can observe a breach of it; finding of record [B01-1](../findings.md#b01-1). |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-acceptable | code-verified |  | The strongest check here selects its subject by claim_key shape and returns silently for a key outside the pattern, which is the zero-denominator shape — but the exemption is stated in the contract rather than accidental, the pattern is anchored so it cannot be evaded by a prefix, and the categories it covers are exactly the ones a claim_key must use to record a type, container or flow at all. |

### Survey artifact

#### **B-04** · Survey record tools

Structural inventory at `258ccd2`.

##### Key types

| Symbol | Role | Source |
|---|---|---|
| `requireFileAnchoredEvidence` | one row must be code-grade **and** cite the subject's own file | `mcp-server/src/tools/claims.ts:requireFileAnchoredEvidence@258ccd2` |
| `FILE_ANCHORED_CLAIM_KEY` | selects which claims that rule applies to, by key shape | `mcp-server/src/tools/claims.ts:FILE_ANCHORED_CLAIM_KEY@258ccd2` |
| `extractWorkspaceCitations` | the whole citation grammar, path validation and revision resolution | `mcp-server/src/helpers.ts:extractWorkspaceCitations@258ccd2` |

##### State containers

None. Every module here is a list of definitions whose handlers validate arguments and write
rows through the context's connection; the durable state is the database, and the handle to it
belongs to [B-02](b02-repository-binding-and-storage-custody.md). Recorded as an explicit negative claim (`B-04/state-container`).

##### Data flow · recording an edge

1. `add_xref`'s `inputSchema` requires a `context` carrying a citation token, with a pattern
   built from the same source string the handler enforces
   (`mcp-server/src/tools/xrefs.ts:xrefTools@258ccd2`).
2. The context is split on whitespace, each token's path is validated as a workspace source
   path, and one unresolvable token refuses the whole value
   (`mcp-server/src/helpers.ts:extractWorkspaceCitations@258ccd2`).
3. The revision probe runs `git rev-parse --verify <rev>^{commit}` with cwd set to the bound
   workspace (`mcp-server/src/tools/xrefs.ts:resolvesInWorkspace@258ccd2`).

Symbol reachability is not checked at any step, and the tool description says so.

##### Concurrency model

Not separately recorded: these handlers run inside [B-01](b01-server-runtime-and-tool-dispatch.md)'s single synchronous dispatch, so
[B-01](b01-server-runtime-and-tool-dispatch.md)'s concurrency claim covers them. Nothing here spawns, defers, or shares state between calls.

##### Seam contracts

- **[SM-03](../seams.md#sm-03) · the `ToolDefinition` registry, with [B-01](b01-server-runtime-and-tool-dispatch.md).** This side exports the arrays; a module
  not concatenated in `index.ts` is invisible with no error.

##### Concern review

Six active concerns, all terminal at `0fee11b`. Two confirmed bugs.

| Concern | Disposition | Reading |
|---|---|---|
| [CC-1](../concerns.md#cc-1) | **confirmed-bug** ([B04-5](../findings.md#b04-5)) | `list_subsystems` computes its bug rollup inline from `findings.status` instead of joining the view. |
| [RC-1](../concerns.md#rc-1) | out-of-scope | These handlers open nothing and hold nothing; the only resources are git subprocesses spawned and reaped synchronously. |
| [BV-1](../concerns.md#bv-1) | confirmed-acceptable | Every stored path reaches `requireWorkspaceSourcePath`, and the citation scanner refuses a whole value on one bad token. |
| [EV-1](../concerns.md#ev-1) | **confirmed-bug** ([B04-4](../findings.md#b04-4)) | `add_evidence` takes `ref_sha` as an unvalidated string, while the claim and edge paths beside it resolve theirs. |
| [GT-1](../concerns.md#gt-1) | confirmed-acceptable | Consumes the generated vocabulary by filtering it, so dropping a kind from the source shrinks the rule with it. |
| [ZD-1](../concerns.md#zd-1) | confirmed-acceptable | The file-anchored check exempts by key shape, which is the zero-denominator form — but the exemption is stated in the contract and the pattern is anchored. |

##### Adversarial review

**Finding [B04-4](../findings.md#b04-4) — upheld.** Claim A: an evidence row's revision is resolved by nobody.
Claim B: a downstream pass validates it. Evidence for Claim B: `detect_changes` reconciles
`file_ledger.ref_sha` and never reads `evidence.ref_sha`; `standing.ts:reachability@0fee11b`
reads the ledger row. The only resolver is `add_claim`, which runs when a claim cites the
row and not when a disposition or finding does. Verdict: **upheld**.

**Finding [B04-5](../findings.md#b04-5) — scope-restricted.** Claim A: the two definitions can report different
numbers. Claim B: they cannot at this revision, because every transition tool writes the
coarse column and the event in one transaction. Evidence for Claim B:
`mcp-server/src/tools/findings.ts:add_finding@0fee11b`. In scope: the schema's stated
invariant, which is false, and a third copy of the predicate. Out of scope: any present
disagreement between surfaces. Verdict: **scope-restricted**.

**Claims.** Six targets, all survived — including `flow/record-an-edge/03`, whose "eighth
local copy" wording was checked against the comment it reports.
