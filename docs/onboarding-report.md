# Onboarding report

Session `mtyc4dcu-04ike3jr`, at `258ccd2` on branch `reader-lenses`. This pass rebuilt the
self-conspectus after the store was discarded and reinitialized (reader-lenses P16), so the
account here starts from an empty database and cites only what was read in this pass.

## Phase 0 · Orientation

The workspace is a git worktree at `/Users/nfeldman/automation/claude/amanuensis-reader-lenses`,
560 tracked files. `.amanuensis/` is Amanuensis's own state and is excluded from every scan
and from the file ledger; `git check-ignore` confirms it is excluded from version control.
Navigation was by `rg`, `git ls-files`, and direct reading. No language-intelligence server
(call hierarchy, find-references) was available, which is why the structural pass below reads
type declarations and named exports rather than resolved call graphs, and why every flow step
recorded is one that was read rather than traced automatically.

## Phase 1 · Repository shape

| Directory | Apparent role | Language | Confidence | Notes |
|---|---|---|---|---|
| `mcp-server/` | The MCP server and its tests | TypeScript on Node 24 | high | 166 tracked files; `src/` is 55 files and ~38k lines; built with `npm run build` to `dist/` |
| `materializer/` | Read-only projection to Markdown and HTML | Python 3.12 | high | 24 tracked files; a package plus a CLI entry (`materialize.py`) and six test scripts |
| `.claude/skills/amanuensis/` | The survey methodology | Markdown | high | `SKILL.md` plus 15 reference files; read by an agent, and by one mechanical checker |
| `dev/` | Gates, harnesses, one-shot procedures | JavaScript (ESM) | high | 136 tracked files, including the immutable A0 historical fixture under `dev/conspectus/` |
| `docs/` | The checked-in projection | Markdown + HTML | high | 48 tracked files; written by promotion, never by hand |
| `design/` | Design records for in-flight cycles | Markdown + JSON | high | The reader-lenses specification, claims, plan, and review dispositions |
| `scholiast/` | A checked-in research survey | Markdown + JSON | high | 103 files no part of the running system imports; deferred as [B-12](subsystems/b12-vendored-research-corpus.md) |
| `.github/workflows/` | CI | YAML | high | `test.yml` is the gate list; `pages.yml`, `publish.yml`, `published-smoke.yml` are release paths |

## Phase 2 · Runtime boundary map

| Process | Language | Peers | Mechanism |
|---|---|---|---|
| `amanuensis-memory` MCP server | Node 24 | the agent host (Claude Code, Codex) | JSON-RPC over stdio, one process per workspace binding |
| `materialize.py` | Python 3.12 | the store; the server that invokes it | spawned as a subprocess by `materialize_docs`; opens the database read-only |
| `git` | — | the server | `spawnSync` from the server, in the workspace for revisions and in the storage directory for its own history |

The store is a single SQLite database at `<workspace>/.amanuensis/memory.db`, in WAL mode.
The storage directory is itself a git repository, which is how a phase gate is recoverable.

## Phase 3 · Stateful entities

| Name | Location | Stores | Lifetime | Populated by | Invalidated by |
|---|---|---|---|---|---|
| the database handle | `mcp-server/src/db.ts` | the open connection | process | first use | process exit; nothing re-opens it mid-life |
| the binding receipt | `.amanuensis/initialization.json` | workspace identity, storage policy | persistent | first initialization | never rewritten; a mismatch refuses the open |
| the storage git repository | `.amanuensis/.git` | every phase gate commit | persistent | `commit_phase_gate` | nothing; it is append-only in practice |
| the file ledger | `file_ledger` table | one row per scoped path | persistent | `add_files_to_scope` | `detect_changes` writes stale reasons onto it |
| the resolution event spine | `finding_resolution_events` | append-only state transitions | persistent | `add_finding`, the resolution tools | never updated or deleted; current state is a view |

## Phase 4 · Concern calibration

Six concerns were derived and are recorded in `concern-checklist.md`. Territories that did
not apply, with the disqualifying condition: **distributed consensus** — there is one process
and one database, no quorum, no replication. **Request-scoped tenancy** — no multi-tenant
request path exists; the server is bound to one workspace for its lifetime. **Client-side
rendering state** — the published projection is static HTML with a no-JavaScript reading path
by design. **Schema migration under load** — the schema is applied at open with
`CREATE TABLE IF NOT EXISTS`, and no online migration path exists to be raced.

## Phase 5 · Master plan

Twelve subsystems, ranked 1–5. See `master-plan.md`.

## Phase 6 · Questions for the human

Logged rather than blocking; see the open-question queue.

## Phase 7 · Conspectus

Artifacts registered and hashed at `258ccd2`. The per-subsystem surveys that follow are
batched, with a storage checkpoint commit per batch.
