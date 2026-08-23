# **B-03** — Knowledge tools and workflow API

**Status**: 🟢 mapped  
**Layer**: runtime

## Scope

mcp-server/src/tools/**; 75 MCP handlers implementing evidence, findings, files, seams, dispatch, locks, staleness, materialization, and queries.

## Start here

mcp-server/src/tools/evidence.ts; mcp-server/src/tools/dispositions.ts; mcp-server/src/tools/git.ts

## Notes

Large mutation and validation surface coupled to [B-02](b02-mcp-core-persistence-and-lifecycle.md) schema/invariants.

## File ledger

| Path | Classification | Why in scope | Ref SHA |
|---|---|---|---|
| `mcp-server/src/tools/artifacts.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/compare.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/concerns.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/contradictions.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/dashboard.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/diagnosticity.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/dispatch.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/dispositions.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/evidence.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/field-notes.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/files.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/findings.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/git.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/locks.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/logging.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/materialize.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/open-questions.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/project.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/seams.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/stale.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/storage-history.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/subsystems.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/vocabulary.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/xrefs.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |

## Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AT-1](../concerns.md#at-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [AT-1](../concerns.md#at-1) in **B-03**. |
| **[AT-2](../concerns.md#at-2)** | unresolved-competition | code-verified | 🔗 | Code shape makes [AT-2](../concerns.md#at-2) plausible in **B-03**, but runtime or domain evidence is required before confirmation. |
| **[CC-1](../concerns.md#cc-1)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [CC-1](../concerns.md#cc-1) in **B-03**. |
| **[CR-1](../concerns.md#cr-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [CR-1](../concerns.md#cr-1) in **B-03**. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [EP-1](../concerns.md#ep-1) in **B-03**. |
| **[EP-2](../concerns.md#ep-2)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [EP-2](../concerns.md#ep-2) in **B-03**. |
| **[IF-1](../concerns.md#if-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [IF-1](../concerns.md#if-1) in **B-03**. |
| **[RL-1](../concerns.md#rl-1)** | unresolved-competition | code-verified | 🔗 | Code shape makes [RL-1](../concerns.md#rl-1) plausible in **B-03**, but runtime or domain evidence is required before confirmation. |
| **[RL-2](../concerns.md#rl-2)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [RL-2](../concerns.md#rl-2) in **B-03**. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified |  | [SM-03](../seams.md#sm-03) integral contract was read from both mapped endpoints and passed at the pinned revision; residuals remain separately visible. |
| **[SC-2](../concerns.md#sc-2)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [SC-2](../concerns.md#sc-2) in **B-03**. |
| **[SI-1](../concerns.md#si-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [SI-1](../concerns.md#si-1) in **B-03**. |
| **[SI-2](../concerns.md#si-2)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [SI-2](../concerns.md#si-2) in **B-03**. |
| **[TB-1](../concerns.md#tb-1)** | unresolved-competition | code-verified | 🔗 | Code shape makes [TB-1](../concerns.md#tb-1) plausible in **B-03**, but runtime or domain evidence is required before confirmation. |
| **[TR-1](../concerns.md#tr-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [TR-1](../concerns.md#tr-1) in **B-03**. |
| **[TR-2](../concerns.md#tr-2)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [TR-2](../concerns.md#tr-2) in **B-03**. |

## Seams

| Seam | Shared object | Other party |
|---|---|---|
| **[SM-01](../seams.md#sm-01)** | MCP tool protocol and survey phase contract | **[B-01](b01-survey-methodology-and-agent-contracts.md)** |
| **[SM-02](../seams.md#sm-02)** | ServerContext and memory.db | **[B-02](b02-mcp-core-persistence-and-lifecycle.md)** |
| **[SM-03](../seams.md#sm-03)** | materialize_docs subprocess and storage/docs projection | **[B-04](b04-diff-aware-materializer.md)** |

## Survey notes

# **B-03** · Knowledge tools and workflow API

- Survey revision: `b8b566f`
- Status: adversarial pass complete; packaging pending

## Key types

`ToolDefinition` couples a tool name, JSON input schema, description, and synchronous handler (`mcp-server/src/helpers.ts:ToolDefinition@b8b566f`). Tool families expose project/session, Git state, subsystem/file scope, concerns/dispositions/evidence/findings, seams, artifacts/materialization, diagnosticity, dispatch/reconciliation, logging, and comparison (`mcp-server/src/index.ts:allTools@b8b566f`).

## State containers

Handlers share [B-02](b02-mcp-core-persistence-and-lifecycle.md)'s `ServerContext` and write normalized SQLite tables. Important lifecycle state includes artifact content hashes, advisory write locks, open questions, dispatch/land/scored rows, and evidence link tables (`mcp-server/src/schema.sql:artifacts@b8b566f`; `mcp-server/src/schema.sql:open_questions@b8b566f`).

## Data flows

1. Session and scope tools authorize a phase and establish the file ledger.
2. Evidence is inserted independently, then linked to dispositions/findings by role.
3. Status transitions query durable prerequisites before granting deeper claim authority.
4. `materialize_docs` invokes [B-04](b04-diff-aware-materializer.md) against the same storage directory and returns a structured summary.
5. Dashboard/comparison tools read the record without mutating claim authority.

Evidence: `mcp-server/src/tools/evidence.ts:add_evidence@b8b566f`; `mcp-server/src/tools/dispositions.ts:set_disposition@b8b566f`; `mcp-server/src/tools/materialize.ts:materialize_docs@b8b566f`.

## Concurrency model

Handlers are synchronous inside one Node process. SQLite supplies database locking across processes; artifact locks are explicit rows. `materialize_docs` is a blocking child process with no timeout in the handler (`mcp-server/src/tools/materialize.ts:materialize_docs@b8b566f`).

## Seam contracts

- **[SM-01](../seams.md#sm-01) · [B-01](b01-survey-methodology-and-agent-contracts.md) ↔ **B-03**:** tool schemas and invariant failures realize the survey protocol.
- **[SM-02](../seams.md#sm-02) · [B-02](b02-mcp-core-persistence-and-lifecycle.md) ↔ **B-03**:** tools consume one `ServerContext` and the canonical schema.
- **[SM-03](../seams.md#sm-03) · **B-03** ↔ [B-04](b04-diff-aware-materializer.md):** a Python subprocess reads durable storage and writes the docs projection; non-zero exit is returned as failure.

## Concern dispositions

All active concerns are terminally covered. The unbounded materializer child is retained as an unresolved competition pending fault injection rather than assigned severity from code shape alone. The WAL/Git phase-gate defect is owned and confirmed in [B-02](b02-mcp-core-persistence-and-lifecycle.md). Tool schema validation and SQL-identifier checks are compensating mechanisms for [SC-1](../concerns.md#sc-1)/[TR-1](../concerns.md#tr-1).

## Adversarial review

The pass looked for handlers that could write higher-depth claims without a session or subsystem state. The principal write paths call `requireActiveSession`, and dispositions/findings additionally call `requireSubsystemStatus`; tests deliberately exercise premature writes (`mcp-server/src/invariants.ts:requireSubsystemStatus@b8b566f`; `mcp-server/test-invariants.mjs:knowledge-depth cases@b8b566f`). Verdict: upheld for covered handlers; schema-wide coverage remains enforced by the inventory/check scripts rather than inferred.
