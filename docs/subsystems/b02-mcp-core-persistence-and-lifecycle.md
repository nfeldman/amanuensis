# **B-02** — MCP core, persistence, and lifecycle

**Status**: 🟢 mapped  
**Layer**: runtime

## Scope

mcp-server/src root modules and schema.sql except cli.ts; server bootstrap, SQLite lifecycle/migrations, invariants, sessions, project identity, and storage git.

## Start here

mcp-server/src/index.ts; mcp-server/src/schema.sql; mcp-server/src/invariants.ts

## Notes

Highest fan-in and durable-state authority.

## File ledger

| Path | Classification | Why in scope | Ref SHA |
|---|---|---|---|
| `mcp-server/src/db.ts` | examined | MCP process, project identity, SQLite persistence, lifecycle, or server invariants. | `b8b566f` |
| `mcp-server/src/helpers.ts` | examined | MCP process, project identity, SQLite persistence, lifecycle, or server invariants. | `b8b566f` |
| `mcp-server/src/index.ts` | examined | MCP process, project identity, SQLite persistence, lifecycle, or server invariants. | `b8b566f` |
| `mcp-server/src/invariants.ts` | examined | MCP process, project identity, SQLite persistence, lifecycle, or server invariants. | `b8b566f` |
| `mcp-server/src/project.ts` | examined | MCP process, project identity, SQLite persistence, lifecycle, or server invariants. | `b8b566f` |
| `mcp-server/src/schema.sql` | examined | MCP process, project identity, SQLite persistence, lifecycle, or server invariants. | `b8b566f` |
| `mcp-server/src/session.ts` | examined | MCP process, project identity, SQLite persistence, lifecycle, or server invariants. | `b8b566f` |
| `mcp-server/src/storage-git.ts` | examined | MCP process, project identity, SQLite persistence, lifecycle, or server invariants. | `b8b566f` |

## Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AT-1](../concerns.md#at-1)** | confirmed-acceptable | code-verified |  | Core batch mutations use explicit better-sqlite3 transactions where partial writes would violate invariants. |
| **[AT-2](../concerns.md#at-2)** | confirmed-bug | code-verified |  | WAL pages are excluded from Git and commitStorage performs no checkpoint, so a phase commit may omit the database mutations it names. |
| **[CC-1](../concerns.md#cc-1)** | out-of-scope | code-verified |  | No cache or derived cache is owned by the persistence core. |
| **[CR-1](../concerns.md#cr-1)** | unresolved-competition | code-verified | 🔗 | SQLite coordinates DB writers, but storage Git lacks a demonstrated cross-process serialization contract. |
| **[EP-1](../concerns.md#ep-1)** | out-of-scope | code-verified |  | Aggregate rendering failure belongs to the tool/materializer boundary, not the core. |
| **[EP-2](../concerns.md#ep-2)** | unresolved-competition | code-verified | 🔗 | Database and Git phase state are separate transactions; [AT-2](../concerns.md#at-2) captures the confirmed consequence while broader atomicity remains unresolved. |
| **[IF-1](../concerns.md#if-1)** | out-of-scope | code-verified |  | Incremental rendering behavior belongs to the materializer. |
| **[RL-1](../concerns.md#rl-1)** | unresolved-competition | code-verified | 🔗 | The open database has no explicit shutdown path; impact beyond normal process cleanup is not measured. |
| **[RL-2](../concerns.md#rl-2)** | unresolved-competition | code-verified | 🔗 | Durable sessions cannot be reattached to ServerContext after restart; recovery semantics are not specified. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified |  | [SM-02](../seams.md#sm-02) integral contract was read from both mapped endpoints and passed at the pinned revision; residuals remain separately visible. |
| **[SC-2](../concerns.md#sc-2)** | out-of-scope | code-verified |  | Generated agent/materializer mirror drift belongs to [B-05](b05-packaging-installer-validation-and-product-docs.md). |
| **[SI-1](../concerns.md#si-1)** | confirmed-acceptable | code-verified |  | Canonical workspace resolution and project key derivation bound records to one repository identity. |
| **[SI-2](../concerns.md#si-2)** | confirmed-acceptable | code-verified |  | Git state and every evidence row retain an explicit revision anchor. |
| **[TB-1](../concerns.md#tb-1)** | unresolved-competition | code-verified | 🔗 | Git subprocesses have no timeout, but practical hang conditions and severity need fault injection. |
| **[TR-1](../concerns.md#tr-1)** | confirmed-acceptable | code-verified |  | Project paths and dynamic values are parameterized or resolved, while interpolated SQL identifiers are internal literals. |
| **[TR-2](../concerns.md#tr-2)** | out-of-scope | code-verified |  | Installer and external configuration trust belongs to [B-05](b05-packaging-installer-validation-and-product-docs.md). |

## Findings

### [B02-1](../findings.md#b02-1) · 🟠 HIGH · fixed

**Symptom**: A phase-gate Git commit can omit the database mutations completed in that phase.  
**Root cause**: SQLite runs in WAL mode, WAL is ignored by storage Git, and commitStorage does not checkpoint the database before staging.

_Business context_: Phase-gate history is advertised as recoverable state; restoring the named commit can restore prose without the dispositions and evidence it describes.

**Primary files**:
- `mcp-server/src/db.ts:openDatabase@b8b566f`
- `mcp-server/src/storage-git.ts:commitStorage@b8b566f`

## Seams

| Seam | Shared object | Other party |
|---|---|---|
| **[SM-02](../seams.md#sm-02)** | ServerContext and memory.db | **[B-03](b03-knowledge-tools-and-workflow-api.md)** |

## Survey notes

# **B-02** · MCP core, persistence, and lifecycle

- Survey revision: `b8b566f`
- Status: adversarial pass complete; packaging pending
- Scope: MCP process bootstrap, project identity, SQLite schema/migrations, session state, invariants, and storage Git history.

## Key types

| Symbol | Role | Evidence |
|---|---|---|
| `ServerContext` | Process-local container for project, open SQLite handle, and active session id. | `mcp-server/src/helpers.ts:ServerContext@b8b566f` |
| `ProjectContext` | Resolves workspace identity, canonical storage directory, and database path. | `mcp-server/src/project.ts:ProjectContext@b8b566f` |
| `SubsystemStatus` / `STATUS_ORDER` | Knowledge-depth state machine enforced at mutating tool boundaries. | `mcp-server/src/invariants.ts:SubsystemStatus@b8b566f` |
| `DB` | `better-sqlite3` connection opened in WAL mode with foreign keys enabled. | `mcp-server/src/db.ts:openDatabase@b8b566f` |
| `GitResult` | Result envelope for recoverable storage-history operations. | `mcp-server/src/storage-git.ts:GitResult@b8b566f` |

## State containers

| State | Contents | Lifetime and update path | Evidence |
|---|---|---|---|
| `ServerContext.sessionId` | Active session authority for mutating calls. | Per MCP process; changed by `startSession`, cleared by `end_session`, and not reattached from durable session rows after restart. | `mcp-server/src/session.ts:startSession@b8b566f`; `mcp-server/src/tools/project.ts:end_session@b8b566f` |
| `memory.db` | Survey entities, evidence, dispositions, findings, seams, artifacts, sessions, and logs. | Persistent; opened once by `main`, WAL journal mode, no explicit close/signal lifecycle. | `mcp-server/src/index.ts:main@b8b566f`; `mcp-server/src/db.ts:openDatabase@b8b566f` |
| SQLite WAL/SHM | Uncheckpointed durable mutations and coordination state. | Persistent sidecars while the connection is live; explicitly ignored by storage Git. | `mcp-server/src/db.ts:openDatabase@b8b566f`; `mcp-server/src/storage-git.ts:GITIGNORE_CONTENTS@b8b566f` |
| storage Git repository | Recoverable prose and tracked database snapshots. | Persistent; `commitStorage` stages and commits the storage path, but does not checkpoint SQLite first. | `mcp-server/src/storage-git.ts:commitStorage@b8b566f` |

## Data flows

1. `main` parses `--workspace`, resolves a project key/storage path, opens `memory.db`, constructs `ServerContext`, and registers 75 tool definitions (`mcp-server/src/index.ts:main@b8b566f`).
2. A tool call is resolved by name and its handler receives the shared context; `ToolError` becomes a structured error response (`mcp-server/src/index.ts:CallToolRequestSchema handler@b8b566f`).
3. Mutating handlers call `requireActiveSession` and, where applicable, `requireSubsystemStatus`, then write synchronously through `better-sqlite3` (`mcp-server/src/invariants.ts:requireActiveSession@b8b566f`).
4. Phase gates call `commitStorage`, which stages the storage directory and creates a Git commit if tracked files differ (`mcp-server/src/storage-git.ts:commitStorage@b8b566f`).

## Concurrency model

Within one server, dispatch and `better-sqlite3` calls execute synchronously on the Node event loop. Across server processes, SQLite WAL coordinates database access, while artifact locks are advisory rows and storage Git has no cross-process commit lock. The process disables Git prompts and optional locks but supplies no subprocess timeout (`mcp-server/src/storage-git.ts:runGit@b8b566f`).

## Seam contracts

### [SM-02](../seams.md#sm-02) · **B-02** ↔ [B-03](b03-knowledge-tools-and-workflow-api.md)

**B-02** owns the SQLite schema, process context, session authority, and knowledge-depth predicates. [B-03](b03-knowledge-tools-and-workflow-api.md) tool handlers read/write through that context. The expected consistency is strong at each synchronous handler return; multi-table handlers must use explicit transactions when partial writes would violate an invariant (`mcp-server/src/helpers.ts:ServerContext@b8b566f`; `mcp-server/src/invariants.ts:enforcePhasePrerequisites@b8b566f`).

## Concern dispositions

The durable concern matrix contains all 16 active concerns. Most are acceptable, ruled out, or explicitly outside this subsystem. One issue is confirmed:

- **[AT-2](../concerns.md#at-2) — confirmed bug.** `openDatabase` enables WAL; `GITIGNORE_CONTENTS` excludes `memory.db-wal`; `commitStorage` stages Git without executing a SQLite checkpoint. While the server remains live, a phase gate can commit prose while the database changes that justify the prose exist only in the ignored WAL. A Git rollback to that gate therefore does not reproduce the claimed phase state. Evidence: `mcp-server/src/db.ts:openDatabase@b8b566f`; `mcp-server/src/storage-git.ts:GITIGNORE_CONTENTS@b8b566f`; `mcp-server/src/storage-git.ts:commitStorage@b8b566f`.

Bounded subprocess waits, cross-process Git serialization, explicit database shutdown, and session reattachment remain visible unresolved competitions rather than being promoted to bugs without execution-context measurements.

## Adversarial review

### [B02-1](../findings.md#b02-1) · phase-gate database state can be absent from its Git commit

- **Claim A:** Phase-gate commits are not recoverable snapshots of the whole system of record.
- **Claim B sought:** WAL auto-checkpointing, connection close, or a pre-commit checkpoint might force database pages into `memory.db` before Git stages it.
- **Probe:** The startup path keeps one connection open; neither `commit_phase_gate` nor `commitStorage` receives the database handle; WAL files are ignored. No pre-commit checkpoint exists in the examined call path.
- **Verdict:** upheld, code-verified. Runtime WAL durability compensates for process crashes, but it does not make a named Git phase gate reproduce the database state.

## Gaps

- Whether concurrent cloud-mode storage commits can entangle index state needs a multi-process runtime control; tracked as a concern disposition, not asserted as a defect.
- Git and materializer subprocess duration needs a hang/fault injection control before severity can be assigned.
