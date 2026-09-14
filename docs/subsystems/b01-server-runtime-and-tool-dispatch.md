# **B-01** — Server runtime and tool dispatch

**Status**: 🟢 mapped  
**Layer**: mcp-server

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server/src/index.ts, mcp-server/src/helpers.ts, mcp-server/src/session.ts — the stdio MCP server, the tool table it registers, the shared argument validators every tool handler calls, and session lifecycle.

## Start here

mcp-server/src/index.ts, then mcp-server/src/helpers.ts

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-01/key-type/mcp-server-src-helpers-ts-servercontext` | `mcp-server/src/helpers.ts:ServerContext` | ServerContext carries the resolved project, the database, and the current session id, and is the only channel a handler has to any of the three; a handler that needs the workspace path or the store reaches it through this object rather than through module state. | Observation | `258ccd28fc19` |
| `B-01/key-type/mcp-server-src-helpers-ts-tooldefinition` | `mcp-server/src/helpers.ts:ToolDefinition` | ToolDefinition is the single shape every tool module exports and it has five members: name, description, inputSchema, a handler taking (args, ctx) in that order, and an optional `compact` flag the dispatcher reads to serialize that tool's text block without indentation. A tool is registered by being present in one of the arrays index.ts concatenates, not by any registration call of its own; and a tool that carries a wire budget is one that sets `compact`, so the budget is enforced on the bytes the host receives rather than promised in a comment. | Observation | `0fee11b0fea1` |
| `B-01/key-type/mcp-server-src-index-ts-toolannotations` | `mcp-server/src/index.ts:toolAnnotations` | Advertised annotations are derived, not declared per tool: readOnlyHint from the get_/list_/lookup_ name prefixes plus an explicit READ_ONLY_TOOLS set, and destructiveHint true for everything outside ADDITIVE_TOOLS. The default is therefore destructive, and a new read tool is read-only only by carrying one of those prefixes or being named. | Observation | `258ccd28fc19` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-01/state-container/mcp-server-src-index-ts-main` | `mcp-server/src/index.ts:main` | main holds the process's only mutable state: a `db` binding that ensureDatabase opens on first use and returns thereafter, reached through a getter on ServerContext. Lifetime is per-process; it is never invalidated or reopened, so a store replaced underneath a running server would be written through a stale handle. | Observation | `258ccd28fc19` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-01/flow/tool-call/01` | `mcp-server/src/index.ts:main` | Step 1 of a tool call: the advertised list and the dispatch table are both built from one concatenation of the per-module ToolDefinition arrays, with the reader-lens tools first, and a Map keyed by tool name is what dispatch resolves against. | Observation | `258ccd28fc19` |
| `B-01/flow/tool-call/02` | `mcp-server/src/index.ts:main` | Step 2: arguments are validated against the tool's own inputSchema by an Ajv validator compiled once at startup with strict:true, so an unknown or mistyped argument is refused before any handler runs and a malformed schema fails the process rather than the call. | Observation | `258ccd28fc19` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-01/concurrency` | `B-01` | One process, one stdio transport, one database handle: requests arrive on a single stdio stream and each handler runs to completion against the same synchronous better-sqlite3 connection, so there is no shared mutable state crossing threads. Concurrency, where it exists, is between separate server processes over one store file, not inside one. | Inference | `258ccd28fc19` |

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-02/concurrency` | `B-02` | The store is opened in WAL mode, so several processes may read while one writes; this is what lets a read-only reader open the same file as a running server. Coordination between processes is not provided by this subsystem — nothing here detects a second writer — and the one place where two processes must not overlap, replacing the store underneath a live handle, is handled by stopping the process rather than by a lock. | Inference | `258ccd28fc19` |
| `B-04/flow/record-an-edge/02` | `mcp-server/src/helpers.ts:extractWorkspaceCitations` | Step 2: the context is split on whitespace, each matching token's path is validated as a workspace source path, and its revision is resolved through the caller's probe. One unresolvable token refuses the whole value, so a single good citation cannot launder the rest. Symbol reachability is not checked, and the contract says so. | Observation | `258ccd28fc19` |
| `B-04/state-container` | `B-04` | [B-04](b04-survey-record-tools.md) holds no mutable state container: every tool module here is a list of definitions whose handlers read arguments, validate them, and write rows through the context's connection. What persists is the database, and the handle to it belongs to [B-02](b02-repository-binding-and-storage-custody.md). | Inference | `258ccd28fc19` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-01](../seams.md#sm-01)** | ServerContext (the resolved project and the lazily opened database handle) | **[B-02](b02-repository-binding-and-storage-custody.md)** | both parties are `mapped` |
| **[SM-03](../seams.md#sm-03)** | the ToolDefinition registry (every tool module's exported array) | **[B-04](b04-survey-record-tools.md)** | both parties are `mapped` |
| **[SM-09](../seams.md#sm-09)** | the built server at mcp-server/dist/index.js, spawned by gates over the MCP protocol | **[B-11](b11-development-harness-and-gates.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-01** | → | **[B-02](b02-repository-binding-and-storage-custody.md)** | dependency | structural | main resolves the binding and opens the store before any handler runs, so every tool call depends on [B-02](b02-repository-binding-and-storage-custody.md) having already decided which repository this process speaks for, read at mcp-server/src/index.ts:main@258ccd2 |
| **B-01** | → | **[B-04](b04-survey-record-tools.md)** | dependency | structural | the survey tools reach a client only by being concatenated into the one registry the server advertises and dispatches against, read at mcp-server/src/index.ts:main@258ccd2 |
| **B-01** | → | **[B-05](b05-findings-dispositions-and-resolution-custody.md)** | dependency | structural | the finding, disposition, concern, contradiction and resolution tools reach a client only through the single registry this module concatenates and dispatches against, so the resolution custody surface exists for a caller exactly when the registry carries it, read at mcp-server/src/index.ts:allTools@0fee11b0fea10eb55d6113dd27b57ef3d41065d3 |
| **B-01** | → | **[B-06](b06-locus-standing-and-the-reader-lenses.md)** | dependency | structural | the reader-lens tools are placed at the head of the advertised list deliberately — §5.5 makes list order the order a host reads — and describe_locus is also the one name the read-only annotation carve-out holds, so the registry decides both that the consumer route is reachable and that it is annotated as a query, read at mcp-server/src/index.ts:READ_ONLY_TOOLS@0fee11b0fea10eb55d6113dd27b57ef3d41065d3 |
| **B-01** | → | **[B-07](b07-git-state-staleness-and-refresh.md)** | dependency | structural | the git-state, staleness, change-impact and refresh tools are registered by this module and by nothing else, so the freshness surface a host can call is whatever the registry admits, read at mcp-server/src/index.ts:allTools@0fee11b0fea10eb55d6113dd27b57ef3d41065d3 |
| **B-01** | → | **[B-09](b09-projection-read-back-and-publication-custody.md)** | dependency | structural | materialize_docs and verify_materialized_docs are dispatched through this registry, so the publication and read-back custody path is entered through the same validator and annotation rules every other tool call is, read at mcp-server/src/index.ts:allTools@0fee11b0fea10eb55d6113dd27b57ef3d41065d3 |
| **[B-04](b04-survey-record-tools.md)** | → | **B-01** | dependency | structural | the edge contract is enforced by a shared helper the tool delegates to, not by the tool module itself, read at mcp-server/src/helpers.ts:extractWorkspaceCitations@258ccd2 |
| **[B-11](b11-development-harness-and-gates.md)** | → | **B-01** | dependency | structural | the gates drive spawned server processes over the protocol rather than importing handlers, so what they exercise is the built server a host would launch, read at dev/test-rebuild-readback.mjs:client@258ccd2 |

## Known defects here

1 defect here is open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- A ToolDefinition array exported from a module under mcp-server/src/tools/ but never concatenated into index.ts's registry is served by nothing, advertised by nothing, and reported by no check: the tool-inventory gate stays green and DEVELOPMENT.md simply omits it. — [B01-1](../findings.md#b01-1) · 🟡 MEDIUM · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 5 of 7 ledger rows |
| Files in scope, not yet read | 1 of 7 |
| Files excluded from the survey obligation | 1 of 7 |
| Ledger rows the repository has changed under | 0 of 7 |
| Active concerns with a disposition recorded here | 9 of 15 — 2 confirmed-bug, 5 confirmed-acceptable, 1 ruled-out, 1 out-of-scope |
| Findings by resolution state | 1 open |
| Seams assessable from both sides | 3 of 3 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-8d61f6cc4f"></a>`mcp-server/package.json` | candidate | Declares the bin entry and the build that produces dist/index.js, which is what a host actually launches. | `258ccd28` |
| <a id="le-2e2ad572d4"></a>`mcp-server/src/cli.ts` | deferred-with-reason | The installer CLI shares the project-resolution code but is not on the server's request path; surveyed with the activation work rather than here. | `258ccd28` |
| <a id="le-26498f7833"></a>`mcp-server/scripts/check-tool-schemas.mjs` | examined | Concern probe for [ZD-1](../concerns.md#zd-1): imports every dist/tools module directly, so it sees an unregistered module — checked for whether it compares that set to the served list. | `0fee11b0` |
| <a id="le-0f86f37e7f"></a>`mcp-server/scripts/gen-tool-inventory.mjs` | examined | Concern probe for [ZD-1](../concerns.md#zd-1): the only artifact that reads both the exported tool modules and the served tool list, and therefore the only place a tool module left out of the registry could be caught. | `0fee11b0` |
| <a id="le-a7ea629c79"></a>`mcp-server/src/helpers.ts` | examined | The ServerContext and ToolDefinition types every handler is written against, plus the argument validators and the result-shaping helpers they all call. | `258ccd28` |
| <a id="le-56e79a5f85"></a>`mcp-server/src/index.ts` | examined | The stdio server entry: parses the workspace argument, resolves the binding, assembles the tool registry, compiles a JSON Schema validator per tool, and maps handler errors onto MCP responses. | `258ccd28` |
| <a id="le-6c054a83ba"></a>`mcp-server/src/session.ts` | examined | Session lifecycle: the sessions rows that every survey write is tagged with, and the lookup requireActiveSession uses. | `258ccd28` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[BV-1](../concerns.md#bv-1)** | confirmed-acceptable | code-verified |  | The dispatcher validates each call against the tool's own inputSchema with an Ajv validator compiled once at strict: true and deliberately does not re-check paths, leaving containment to one guard at durable ingress; a second copy in the dispatcher is what would let the two definitions diverge. |
| **[CC-1](../concerns.md#cc-1)** | ruled-out | code-verified |  | Nothing in the dispatch path reads derived state: index.ts, helpers.ts and session.ts issue no query against findings, file_ledger, finding_state_current or file_standing, so there is no second copy of a view's predicate here to drift from the view. |
| **[EV-1](../concerns.md#ev-1)** | out-of-scope | code-verified |  | **B-01** records no revision and resolves none: the dispatcher, the context constructor and the session module write no ref_sha and invoke git nowhere, so evidence integrity has no subject in this subsystem and is answered where the writes are, in [B-04](b04-survey-record-tools.md) and [B-05](b05-findings-dispositions-and-resolution-custody.md). |
| **[GT-1](../concerns.md#gt-1)** | confirmed-acceptable | code-verified |  | The one artifact derived from this subsystem's registry, DEVELOPMENT.md's tool-inventory block, is regenerated from the live tools/list and re-checked by gen-tool-inventory.mjs --check in CI, which names the block when it is stale; toolAnnotations is hand-written but publishes no value from the vocabulary source, so it is not a fourth party to that contract. |
| **[RC-1](../concerns.md#rc-1)** | confirmed-acceptable | code-verified |  | The handle is opened once through the ctx.db getter and never revalidated, so it can outlive its file — but the server exposes no operation that unlinks its own store, the only route to that state is an out-of-band deletion, and the storage marker refuses the next open, which is why the rebuild procedure stops the process before deleting rather than asking the running server to reinitialize. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified |  | From this side: the context is built once and the handle is reached only through a getter that returns the existing connection, so this party never asks for a replacement and has no way to notice one — which is the same consequence the other side records, not a disagreement with it. |
| **[SC-3](../concerns.md#sc-3)** | confirmed-bug | code-verified |  | From the consumer's side: this party decides visibility by what it concatenates and has no list of what exists to compare that against, so an array left out is not a discrepancy it could detect; the finding of record is [B01-1](../findings.md#b01-1), which names the artifact that holds both sides and throws the comparison away. |
| **[SC-9](../concerns.md#sc-9)** | confirmed-acceptable | code-verified |  | From the server side: the process advertises its whole surface over the protocol on request, so a gate never has to guess what it is talking to, and a malformed schema fails the process at startup rather than one call — a gate spawning this server learns immediately that it cannot be judged. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-bug | code-verified |  | The tool-inventory gate takes its denominator from tools/list, the very list a tool module left out of index.ts never reaches, so an unregistered module is absent from the subject the gate counts and --check goes green; check-tool-schemas.mjs does import every module and so could supply the missing denominator, but it validates schema shape only and makes no statement about registration. |

### Survey artifact

#### **B-01** · Server runtime and tool dispatch

Structural inventory at `258ccd2`. Every statement here is also recorded as a claim; the
claims are what a later reader should trust, because they carry the revision this prose does not.

##### Key types

| Symbol | Role | Source |
|---|---|---|
| `ToolDefinition` | name, description, `inputSchema`, handler `(ctx, args)` — the only shape a tool has | `mcp-server/src/helpers.ts:ToolDefinition@258ccd2` |
| `ServerContext` | the resolved project, the database, the current session id | `mcp-server/src/helpers.ts:ServerContext@258ccd2` |
| `toolAnnotations` | derives `readOnlyHint` / `destructiveHint` from name prefixes and two explicit sets | `mcp-server/src/index.ts:toolAnnotations@258ccd2` |

##### State containers

| Name | Location | Stores | Lifetime | Populated by | Invalidated by |
|---|---|---|---|---|---|
| the `db` binding | `mcp-server/src/index.ts:main@258ccd2` | the open SQLite connection | per process | `ensureDatabase` on first access through the `ctx.db` getter | nothing — it is never reopened |

##### Data flow · a tool call

1. The advertised list and the dispatch map are both built from one concatenation of the
   per-module `ToolDefinition` arrays, reader-lens tools first
   (`mcp-server/src/index.ts:main@258ccd2`).
2. Arguments are validated against the tool's own `inputSchema` by an Ajv validator compiled
   once at startup with `strict: true` (`mcp-server/src/index.ts:main@258ccd2`).
3. The handler runs against `ServerContext`; a `ToolError` becomes an error response, anything
   else propagates.

##### Concurrency model

One process, one stdio transport, one synchronous `better-sqlite3` connection. No shared
mutable state crosses a thread or an async boundary inside the process. Concurrency, where it
exists, is between separate server processes over one store file — recorded as an inference,
because it was derived from the single handle and the synchronous driver rather than read from
a statement about threading.

##### Seam contracts

- **[SM-01](../seams.md#sm-01) · `ServerContext`, with [B-02](b02-repository-binding-and-storage-custody.md).** This side constructs the context once and reads
  `project.workspacePath` and `project.dbPath` from it. Ordering total; single consumer;
  strongly consistent; schema owned by [B-02](b02-repository-binding-and-storage-custody.md).
- **[SM-03](../seams.md#sm-03) · the `ToolDefinition` registry, with [B-04](b04-survey-record-tools.md).** This side concatenates, compiles, and
  dispatches. A module whose array is not concatenated here is invisible with no error.

##### Concern review

Six active concerns, all terminal at `0fee11b`.

| Concern | Disposition | Reading |
|---|---|---|
| [CC-1](../concerns.md#cc-1) | ruled-out | Nothing in the dispatch path queries `findings`, `file_ledger`, or either derived view, so there is no second copy of a view's predicate here. |
| [RC-1](../concerns.md#rc-1) | confirmed-acceptable | The handle is opened once and never revalidated; it can be orphaned only by an out-of-band deletion, and the storage marker refuses the next open. |
| [BV-1](../concerns.md#bv-1) | confirmed-acceptable | Ajv at `strict: true` validates shape; path containment stays in one guard at durable ingress rather than being copied into the dispatcher. |
| [EV-1](../concerns.md#ev-1) | out-of-scope | This subsystem records no revision and resolves none. |
| [GT-1](../concerns.md#gt-1) | confirmed-acceptable | The one artifact derived from the registry, `DEVELOPMENT.md`'s tool inventory, is regenerated and `--check`ed in CI. |
| [ZD-1](../concerns.md#zd-1) | **confirmed-bug** ([B01-1](../findings.md#b01-1)) | The tool-inventory gate takes its denominator from `tools/list`, which an unregistered module never reaches. |

##### Adversarial review

**Finding [B01-1](../findings.md#b01-1) — upheld.** Claim A: an unregistered tool module is caught by nothing.
Claim B: `check-tool-schemas.mjs` imports every `dist/tools` module and would catch it.
Evidence for Claim B: `mcp-server/scripts/check-tool-schemas.mjs:main@0fee11b` — it does hold
the complete exported set and asserts schema shape only. Second candidate:
`mcp-server/test-mcp-compatibility.mjs:the tool-surface assertion@0fee11b` asserts
`tools.length > 100`, a floor over the served list, not an equality against the exported set.
Verdict: **upheld**.

**Claims.** Seven targets, one overturned.

| Claim | Challenge | Outcome |
|---|---|---|
| `B-01/key-type/…tooldefinition` | Does the declaration match the recorded shape? | **overturned** — five members, not four, and the handler takes `(args, ctx)`. `B-01-C01` invalidated at `0fee11b`; `B-01-C08` re-asserts the key with the `compact` flag the wire budget depends on. |
| `B-01/key-type/…servercontext` | Can a handler reach the store or the workspace off-context? | survived |
| `B-01/key-type/…toolannotations` | Is the default really destructive? | survived |
| `B-01/state-container/…main` | Is the binding reopened or cleared anywhere? | survived |
| `B-01/flow/tool-call/01` | Can the advertised list and the dispatch map differ? | survived |
| `B-01/flow/tool-call/02` | Can a call reach a handler unvalidated? | survived |
| `B-01/concurrency` | Is there an async boundary inside a handler? | survived |
