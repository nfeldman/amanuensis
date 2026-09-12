# **B-02** — Repository binding and storage custody

**Status**: 🟢 mapped  
**Layer**: mcp-server

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server/src/project.ts, mcp-server/src/db.ts, mcp-server/src/storage-git.ts, mcp-server/src/codex-host.ts — workspace selection, the immutable binding receipt, storage path containment, the SQLite handle, and the storage directory's own git repository.

## Start here

mcp-server/src/project.ts, then mcp-server/src/db.ts

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-02/key-type/mcp-server-src-project-ts-assertcontainedpath` | `mcp-server/src/project.ts:assertContainedPath` | Containment is asserted structurally, not by string prefix: the target must be strictly inside the canonical root, and every existing segment on the way is refused if it is a symbolic link, a non-directory, or resolves outside the root. A path that escapes by symlink is rejected at the segment that does it. | Observation | `258ccd28fc19` |
| `B-02/key-type/mcp-server-src-project-ts-projectcontext` | `mcp-server/src/project.ts:ProjectContext` | ProjectContext is fully readonly and carries a ProjectBindingReceipt with a contract version, the canonical root, the workspace instance id, the project identity and key, and the storage policy. The binding is therefore a value resolved once at startup, not a setting a later call can change. | Observation | `258ccd28fc19` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-02/state-container/mcp-server-src-db-ts-opendatabase` | `mcp-server/src/db.ts:openDatabase` | openDatabase is the only place a connection is created: it sets WAL and foreign_keys, runs migrations before initializeSchema so additive columns exist before the indexes that name them, and then refuses the open if the applied schema did not leave file_standing and finding_state_current in place. Lifetime is per-process; nothing invalidates or reopens it. | Observation | `258ccd28fc19` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-02/flow/storage-write/01` | `mcp-server/src/project.ts:resolveStorageOutputPath` | Step 1 of any tool-directed write into project storage: the binding is re-asserted, a relative path is resolved against project.storagePath rather than the workspace, and the result is containment-asserted. A tool asked for "docs" therefore writes .amanuensis/docs, and no argument can point it at the repository root. | Observation | `258ccd28fc19` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-02/concurrency` | `B-02` | The store is opened in WAL mode, so several processes may read while one writes; this is what lets a read-only reader open the same file as a running server. Coordination between processes is not provided by this subsystem — nothing here detects a second writer — and the one place where two processes must not overlap, replacing the store underneath a live handle, is handled by stopping the process rather than by a lock. | Inference | `258ccd28fc19` |

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/concurrency` | `B-03` | The invariants are checked in the same synchronous call that performs the write, against the same connection, so there is no window between a prerequisite passing and the row it authorized being inserted within one process. Across processes the guarantee is SQLite's, not this subsystem's. | Inference | `258ccd28fc19` |
| `B-03/state-container` | `B-03` | [B-03](b03-conspectus-schema-vocabulary-and-invariants.md) holds no mutable state container of its own: schema.sql is applied at open and never mutated afterwards, invariants.ts is a set of pure predicates over rows passed in, and the generated vocabulary module is a frozen set of literals. The state this subsystem describes lives in the database, which **B-02** owns the handle to. | Inference | `258ccd28fc19` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-01](../seams.md#sm-01)** | ServerContext (the resolved project and the lazily opened database handle) | **[B-01](b01-server-runtime-and-tool-dispatch.md)** | both parties are `mapped` |
| **[SM-02](../seams.md#sm-02)** | memory.db and the views initializeSchema creates on it | **[B-03](b03-conspectus-schema-vocabulary-and-invariants.md)** | both parties are `mapped` |
| **[SM-06](../seams.md#sm-06)** | memory.db, opened read-only by the projection while the server holds it read-write | **[B-08](b08-materializer-rendering-pipeline.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **[B-08](b08-materializer-rendering-pipeline.md)** | → | **B-02** | data-flow | structural | the projection reads the store the server owns, through a read-only URI that cannot create anything the store lacks, read at materializer/amanuensis_materializer/db.py:open_ro@258ccd2 |
| **B-02** | → | **[B-03](b03-conspectus-schema-vocabulary-and-invariants.md)** | dependency | structural | the open applies schema.sql and then refuses itself if the required views are absent afterwards, so the store's shape is [B-03](b03-conspectus-schema-vocabulary-and-invariants.md)'s and the refusal is **B-02**'s, read at mcp-server/src/db.ts:openDatabase@258ccd2 |
| **[B-01](b01-server-runtime-and-tool-dispatch.md)** | → | **B-02** | dependency | structural | main resolves the binding and opens the store before any handler runs, so every tool call depends on **B-02** having already decided which repository this process speaks for, read at mcp-server/src/index.ts:main@258ccd2 |

## Known defects here

No defect here is open or awaiting verification.

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 2 of 4 ledger rows |
| Files in scope, not yet read | 2 of 4 |
| Files excluded from the survey obligation | 0 of 4 |
| Ledger rows the repository has changed under | 0 of 4 |
| Active concerns with a disposition recorded here | 9 of 15 — 8 confirmed-acceptable, 1 ruled-out |
| Findings by resolution state | none recorded |
| Seams assessable from both sides | 3 of 3 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-fcffcd1e95"></a>`mcp-server/src/codex-host.ts` | candidate | Workspace discovery when the host is Codex and the launch cwd is not the repository root; feeds resolveProject's selection source. | `258ccd28` |
| <a id="le-07c11b6cef"></a>`mcp-server/src/storage-git.ts` | candidate | The storage directory's own git repository — the mechanism behind commit_phase_gate and the only record of a discarded store. | `258ccd28` |
| <a id="le-28d2d6d8a8"></a>`mcp-server/src/db.ts` | examined | Opens the SQLite connection, sets WAL and foreign keys, runs migrations then the schema, and refuses an open that did not leave the required views in place. | `258ccd28` |
| <a id="le-97fd8ef43b"></a>`mcp-server/src/project.ts` | examined | Resolves the workspace, derives the project key and storage path, writes and enforces the immutable binding receipt, and owns the containment assertion every storage-writing tool goes through. | `258ccd28` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[BV-1](../concerns.md#bv-1)** | confirmed-acceptable | code-verified |  | Containment here is structural rather than a prefix test — every existing segment is rejected if it is a symlink, is a non-directory before the leaf, or realpaths outside the root, and equality with the root is refused — and a tool-supplied output directory is resolved against storagePath before it reaches that check, which is why materialize_docs writes .amanuensis/docs and cannot be aimed at the repository root. |
| **[CC-1](../concerns.md#cc-1)** | ruled-out | code-verified |  | **B-02** creates the two derived views by applying schema.sql and then asserts their presence by name, closing the connection and refusing the open if either is absent; it selects from neither and reimplements neither, so this subsystem holds no second copy of a view's predicate. |
| **[EV-1](../concerns.md#ev-1)** | confirmed-acceptable | code-verified |  | **B-02** records no revision of its own, and supplies the thing the phrase "resolves in the bound workspace" refers to: every revision probe in the server runs git with cwd set to project.workspacePath, a canonical root that is containment-asserted and receipt-bound rather than whatever directory the process was started in. |
| **[GT-1](../concerns.md#gt-1)** | confirmed-acceptable | code-verified |  | This subsystem carries the party the four-party contract cannot check statically — an existing database whose CHECK literals predate a widening, which CREATE TABLE IF NOT EXISTS will never rewrite — and repairs it on every open by comparing the live DDL text against the source and rebuilding the table transactionally when the live one is strictly narrower. |
| **[RC-1](../concerns.md#rc-1)** | confirmed-acceptable | code-verified |  | Both halves of the concern are answered by code: a commit against the storage directory truncate-checkpoints the WAL first and raises rather than committing when the checkpoint is partial, so the committed memory.db is a recoverable file, and every git invocation is scoped to the storage directory by an explicit pathspec so a concurrent survey sharing one outer repository cannot be entangled into it. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified |  | From this side: openDatabase is the only place a connection is created and nothing in this subsystem closes or replaces one for a live process, so both parties record the same lifetime and the same single route out of it — stopping the process — and neither believes it may replace the handle under the other. |
| **[SC-2](../concerns.md#sc-2)** | confirmed-acceptable | code-verified |  | From the custodian's side: schema.sql is applied on every open, the two views are asserted by name afterwards with the connection closed on failure, and the one thing CREATE IF NOT EXISTS cannot rewrite — a CHECK narrowed before a widening — is repaired by rebuilding the table against the schema owner's canonical text. |
| **[SC-6](../concerns.md#sc-6)** | confirmed-acceptable | code-verified |  | From the writer's side: WAL is what lets the reader open the same file without blocking, and the writer truncate-checkpoints before any storage commit, so the memory.db a later reader or a git checkout sees carries every committed frame; what neither side provides is a snapshot across a long publish, which both record rather than assume away. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-acceptable | code-verified |  | The two assertions this subsystem makes are triggered by absence rather than satisfied by it: requireViews refuses the open precisely when a view is missing, and the WAL checkpoint raises on a busy or partial result instead of committing. The one silent path is migrateVocabularyChecks declining a table whose canonical CREATE it cannot locate in schema.sql, which is a contract error CI's --check-sql reads schema.sql to catch; it is recorded as a field note rather than passed over. |

### Survey artifact

#### **B-02** · Repository binding and storage custody

Structural inventory at `258ccd2`.

##### Key types

| Symbol | Role | Source |
|---|---|---|
| `ProjectContext` | fully readonly: workspace, project key, storage path, db path, and the binding receipt | `mcp-server/src/project.ts:ProjectContext@258ccd2` |
| `ProjectBindingReceipt` | contract version, canonical root, workspace instance id, project identity, storage policy | `mcp-server/src/project.ts:ProjectBindingReceipt@258ccd2` |
| `assertContainedPath` | structural containment: no escape, no symlink traversal, no non-directory segment | `mcp-server/src/project.ts:assertContainedPath@258ccd2` |

##### State containers

| Name | Location | Stores | Lifetime | Populated by | Invalidated by |
|---|---|---|---|---|---|
| the SQLite connection | `mcp-server/src/db.ts:openDatabase@258ccd2` | the whole conspectus | per process | the first call that needs it | nothing in-process |
| `initialization.json` | the storage directory | the storage marker naming the database and the binding | persistent | first initialization | never rewritten; a mismatch refuses the open |

##### Data flow · a tool-directed write into project storage

1. `resolveStorageOutputPath` re-asserts the binding, resolves a relative path against
   `project.storagePath` rather than the workspace, and containment-asserts the result
   (`mcp-server/src/project.ts:resolveStorageOutputPath@258ccd2`).
2. `assertContainedPath` walks every existing segment, refusing a symlink, a non-directory, or
   a segment whose realpath leaves the root (`mcp-server/src/project.ts:assertContainedPath@258ccd2`).

A tool asked for `"docs"` therefore writes `.amanuensis/docs`. That is the reason the published
projection has to be promoted to the tracked `docs/` by a separate step rather than rendered
into it.

##### Concurrency model

WAL, so several readers may run beside one writer — which is how the materializer opens the
same file read-only while a server is live. Nothing here detects a second writer; the one case
where two processes must not overlap, replacing the store under a live handle, is handled by
stopping the process. Recorded as an inference.

##### Seam contracts

- **[SM-01](../seams.md#sm-01) · `ServerContext`, with [B-01](b01-server-runtime-and-tool-dispatch.md).** This side owns the schema of the object and the
  lifetime of the handle inside it.
- **[SM-02](../seams.md#sm-02) · `memory.db` and its views, with [B-03](b03-conspectus-schema-vocabulary-and-invariants.md).** This side applies `schema.sql` at every
  open and refuses the open when a required view is absent afterwards. Schema owned by [B-03](b03-conspectus-schema-vocabulary-and-invariants.md).

##### Concern review

Six active concerns, all terminal at `0fee11b`. No confirmed bug.

| Concern | Disposition | Reading |
|---|---|---|
| [CC-1](../concerns.md#cc-1) | ruled-out | This side creates the two views and asserts their presence by name; it selects from neither and reimplements neither. |
| [RC-1](../concerns.md#rc-1) | confirmed-acceptable | A storage commit truncate-checkpoints the WAL first and raises on a partial result; every git call is pathspec-scoped to the storage directory. |
| [BV-1](../concerns.md#bv-1) | confirmed-acceptable | Containment is structural — per-segment `lstat` and `realpath`, equality with the root refused — and storage output resolves against `storagePath` before reaching it. |
| [EV-1](../concerns.md#ev-1) | confirmed-acceptable | Records no revision, and supplies the canonical root that makes "resolves in the bound workspace" mean something. |
| [GT-1](../concerns.md#gt-1) | confirmed-acceptable | Carries the party the static check cannot reach: an existing database whose CHECK literals predate a widening, repaired on open. |
| [ZD-1](../concerns.md#zd-1) | confirmed-acceptable | Its assertions are triggered by absence, not satisfied by it. One silent decline is recorded as a field note. |

##### Adversarial review

No finding to challenge. Five claim targets, all survived.

| Claim | Challenge | Outcome |
|---|---|---|
| `B-02/key-type/…projectcontext` | Can a later call rebind the workspace? | survived |
| `B-02/key-type/…assertcontainedpath` | Is containment a string prefix test a sibling directory could satisfy? | survived |
| `B-02/state-container/…opendatabase` | Is there a second connection, or a handle handed back after a failed view assertion? | survived |
| `B-02/flow/storage-write/01` | Can any argument reach a path outside the storage directory? | survived |
| `B-02/concurrency` | Does `write_locks` make "nothing here detects a second writer" wrong? | survived — it is an advisory artifact-path registry tools opt into, consulted by no storage write. |
