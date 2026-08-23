# Onboarding report

**Codebase**: Amanuensis
**Date**: 2026-08-12
**Onboarding session**: `mspky4v5-2wuk50if`

## Epistemic status

This report is an onboarding map at repository revision `b8b566f`, not a completed
subsystem survey. Observations cite code or repository contracts. Subsystem behavior and
correctness remain unverified until the corresponding subsystem reaches the required
survey phase.

## Repository shape

| Dimension | Observed value | Confidence |
|---|---|---|
| Primary language(s) | TypeScript/JavaScript and Python | code-verified |
| Secondary language(s) | SQL, Markdown, YAML/JSON | code-verified |
| Build system(s) | npm/TypeScript; Python standard library with Ruff for lint | config-asserted |
| Code generation present? | Yes | code-verified |
| Generated file patterns | `mcp-server/dist/**`; package mirrors of `agents/**` and `materializer/**`; generated `ROADMAP.md` | code-verified |
| Monorepo or single service? | One product with server, materializer, prompt/agent, and delivery surfaces | doc-asserted |
| Deployable unit count | Two executables: `amanuensis-memory` and installer CLI; Python materializer is invoked as a subprocess | code-verified |
| Canonical branch | `main` | config-asserted |
| Branch convention | `codex/` for this implementation lane; historical `feat/` and `docs/` branches exist | config-asserted |
| Onboarding SHA | `b8b566f` | git-observed |

### Directory cluster map

| Cluster | Apparent role | Language | Confidence | Notes |
|---|---|---|---|---|
| `.claude/skills/amanuensis/` | Canonical survey methodology and phase references | Markdown | high | Source for skill-driven operation. `.claude/skills/amanuensis/SKILL.md@b8b566f`. |
| `agents/` | VS Code custom-agent bundle and public references | Markdown | high | Package source copied by prepack. `mcp-server/scripts/prepack-bundle-assets.mjs@b8b566f`. |
| `mcp-server/src/` | MCP bootstrap, persistence, invariants, CLI, and tool handlers | TypeScript/SQL | high | One stdio server registers 75 tools. `mcp-server/src/index.ts:main@b8b566f`. |
| `mcp-server/test-*.mjs` and `scripts/` | Contract, adversarial, integration, performance, and generation gates | JavaScript | high | CI enumerates the authoritative gate set. `.github/workflows/test.yml@b8b566f`. |
| `materializer/` | Read-only projection of DB/prose state into linked Markdown | Python | high | Uses per-page source hashes and a manifest. `materializer/amanuensis_materializer/core.py:Materializer@b8b566f`. |
| `dev/`, root docs, `.github/` | Product direction, research/design notes, contribution and delivery contracts | Markdown/JSON/JS/YAML | high | `ROADMAP.md` is generated from `dev/roadmap.json`. `dev/render-roadmap.mjs@b8b566f`. |

## Runtime boundary map

| Runtime / Process | Language | Communicates with | Mechanism | Notes |
|---|---|---|---|---|
| Host agent runtime | external | MCP server | stdio MCP | Starts the server with a workspace path. `.mcp.json@b8b566f`. |
| `amanuensis-memory` | Node/TypeScript | host, SQLite, git, Python | MCP stdio, native SQLite binding, subprocess | Owns validation and durable records. `mcp-server/src/index.ts:main@b8b566f`. |
| SQLite `memory.db` | SQL | MCP server and materializer | WAL; one writer API, read-only materializer connection | Schema initializes and migrates on open. `mcp-server/src/db.ts:openDatabase@b8b566f`. |
| Git storage history | git subprocess | storage directory | synchronous child process | Commits DB/prose state at gates. `mcp-server/src/storage-git.ts:commitStorage@b8b566f`. |
| Python materializer | Python | SQLite and prose storage | child process and filesystem | Emits docs and `.manifest.json`. `materializer/amanuensis_materializer/core.py:Materializer.materialize@b8b566f`. |
| Installer CLI | Node/TypeScript | workspace files | filesystem/config merge | Writes agents and VS Code MCP config. `mcp-server/src/cli.ts:plan@b8b566f`. |

## Significant stateful entities

| Name | Location | What it stores | Lifetime | Populated by | Invalidated by |
|---|---|---|---|---|---|
| `memory.db` + WAL | `~/.amanuensis/workspaces/<owner>/<repo>/` | Survey entities, evidence, findings, sessions, queries, locks, seams | Cross-session | MCP tool handlers | Explicit reset/status/validity operations; schema has no general claim-time model yet |
| `ServerContext.sessionId` | `mcp-server/src/index.ts` | Active writer session | Server process | `start_session` | `end_session` or process exit |
| Storage git repository | project storage directory | Checkpoint history of non-ignored storage files | Cross-session | `commit_phase_gate`, `end_session` | Git history only; rollback is external |
| File ledger and git baseline | SQLite tables | File-to-subsystem assignment and checked revision | Cross-session | scope and git tools | reset/change detection |
| Materializer manifest | rendered docs directory | Per-page source/content hashes | Cross-render | materializer | source/version/content difference or page retirement |
| Write locks and dispatch rows | SQLite tables | Advisory coordination and fan-out history | Cross-process | lock/dispatch tools | release/expiry and completion calls |

## Concern calibration

| Territory | Verdict | Derived concerns / disqualifier |
|---|---|---|
| T1 scope-context identity | applicable | [SI-1](concerns.md#si-1), [SI-2](concerns.md#si-2) |
| T2 cache coherence | applicable by analogy to derived-state manifests and git baselines | [CC-1](concerns.md#cc-1) |
| T3 temporal bounds | applicable | [TB-1](concerns.md#tb-1) |
| T4 exceptional-path asymmetry | applicable | [EP-1](concerns.md#ep-1), [EP-2](concerns.md#ep-2) |
| T5 aliasing/ownership | not seeded | MCP values cross serialization boundaries and no shared returned mutable object was established during onboarding; revisit if [B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)/[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) finds one |
| T6 incremental/full divergence | applicable | [IF-1](concerns.md#if-1) |
| T7 atomicity | applicable | [AT-1](concerns.md#at-1), [AT-2](concerns.md#at-2) |
| T8 concurrency races | applicable | [CR-1](concerns.md#cr-1) |
| T9 resource lifecycle | applicable | [RL-1](concerns.md#rl-1), [RL-2](concerns.md#rl-2) |
| T10 trust boundary | applicable | [TR-1](concerns.md#tr-1), [TR-2](concerns.md#tr-2) |
| T11 seam contracts | applicable | [SC-1](concerns.md#sc-1), [SC-2](concerns.md#sc-2) |

The calibrated checklist is in `concern-checklist.md`; the SQLite concern rows are
authoritative for later disposition coverage.

## Draft master plan

Five subsystems were registered. [B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md) and [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) share priority 1 because all durable
authority flows through their schema/invariant and handler seam. [B-04](subsystems/b04-diff-aware-materializer.md) and [B-01](subsystems/b01-survey-methodology-and-agent-contracts.md) share
priority 2; delivery and documentation are [B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md) at priority 3. See `master-plan.md`.

## Questions for the human

### Tier 1 — Blockers

1. Should “fully surveyed” include every tracked test, generated file, prompt, and product
   document? Working assumption: yes, with explicit exclusions only.

### Tier 2 — Priority shapers

1. Should the installer support Codex MCP registration alongside VS Code? Working
   assumption: record the gap in [B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md); do not expand A0 installer scope.

### Tier 3 — Context

1. Should phase checkpoints version live SQLite contents? Working assumption: yes; [AT-2](concerns.md#at-2)
   remains active because WAL-backed mutations produced no storage commit during onboarding.

## Recommended first mapping

**Top**: [B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md) — it owns database initialization, validity gates, session identity, project
identity, and checkpoint mechanics.

**Second**: [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) — it is the largest mutation surface and turns the [B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md) contracts into the
actual workflow API.
