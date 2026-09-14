# Onboarding report — Amanuensis

**Revision surveyed:** `7c1c1a9f5689d396487072d012abe6fafd5f348c` (branch `main`)
**Pass:** clean-slate rebuild. The previous self-conspectus was discarded whole and this
record starts from an empty store; nothing below is carried over from it.

## Phase 0 · Orientation

The workspace is readable. `.amanuensis/` is excluded from every scan and from the file
ledger: it is Amanuensis's own state, not evidence about the target system.

Navigation available: project-wide search (`rg`), `git` history, and the language
toolchains themselves (`tsc`, `ruff`, `python3`). **No semantic language-intelligence
service is available** — no call hierarchy, no find-references, no go-to-definition.
Phase 2 therefore reads structure by following imports and grepping for symbol names,
which is weaker than a resolved call graph. Every structural claim below states the file
and line it was read from rather than asserting a call path the tooling did not resolve.

## Phase 1 · Repository shape

607 tracked files. One repository, no submodules, no vendored dependencies in tree.

| Directory | Apparent role | Language | Confidence | Notes |
|---|---|---|---|---|
| `mcp-server/src/` | The MCP server: tool registry, persistence, ~40 handler modules | TypeScript | high | 38,752 lines including a 4,746-line `schema.sql` |
| `mcp-server/scripts/` | Generators and drift checks (vocabulary, tool inventory, SQL identifiers) | JavaScript (ESM) | high | several are `--check` gates run by CI |
| `mcp-server/test-*.mjs` | The server's own gate suite | JavaScript (ESM) | high | ~40 files, each a named contract |
| `mcp-server/contracts/` | JSON Schemas and the single enum source | JSON | high | `conspectus-vocabulary.json` generates two modules |
| `materializer/` | The human projection: renders and reads back HTML + Markdown | Python 3.11+, stdlib only | high | 10,706 lines; a separate process reading the same store |
| `.claude/skills/amanuensis/` | The methodology the coordinating agent executes | Markdown | high | prose contract, 16 files |
| `dev/` | Gates, harnesses, receipts, ADRs, the roadmap source | JS + JSON + Markdown | high | 146 files; 72 are activation-evidence receipts |
| `docs/` | The checked-in projection of this conspectus | generated HTML + MD | high | under a byte-match gate; not hand-edited |
| `design/` | Design records (`reader-lenses`, `delightful-output-panel`) | Markdown + JSON | high | `reader-lenses/spec.md` is what the merged work implements |
| `scholiast/` | Embedded research surveys | Markdown | medium | consumed by design work, not by the running server |
| `.pecia/` | Execution-custody ledger with foreign references into the conspectus | JSONL + YAML | high | 163 records |
| `.github/workflows/` | CI | YAML | high | `test.yml` is the authoritative gate list |

Build systems: `npm` for the server (Node 24.18.0 pinned in `.tool-versions`), `uv`/plain
stdlib for the materializer, `mise` for both. Code generation is real and load-bearing:
`vocabulary.ts` and `vocabulary.py`, `DEVELOPMENT.md`'s tool inventory, `ROADMAP.md`, and
`docs/` are all generated with drift checks.

## Phase 2 · Runtime boundary map

| Process | Language | Peers | Mechanism |
|---|---|---|---|
| MCP server (`mcp-server/dist/index.js`) | Node 24 | the host agent (Claude Code, Codex CLI, VS Code/Copilot) | MCP over stdio |
| MCP server | Node 24 | `.amanuensis/memory.db` | SQLite via `node:sqlite`, one handle for the life of the process |
| MCP server | Node 24 | `git` | `execFileSync`/`spawnSync` against the bound workspace and the storage repository |
| Materializer | Python 3.11+ | `.amanuensis/memory.db` | SQLite, read-only, in a **separate process** spawned by the server |
| Installer CLI (`cli.js`) | Node 24 | host configuration files | direct file writes, digest-bound, dry-run first |
| Gates (`dev/*.mjs`, `mcp-server/test-*.mjs`) | Node 24 | receipts, throwaway stores, sometimes a live server | child processes and temporary workspaces |
| `pecia` CLI | Python (external, private) | `.pecia/work.jsonl`, and the conspectus via a resolver child process | subprocess |

The important boundary property: **one user-scoped installation serves every repository the
host enters.** Binding is decided per process from the launch cwd and is then immutable, so
several server processes bound to different repositories can run at once, and linked
worktrees of one repository share a storage root.

## Phase 3 · Stateful entities

| Name | Location | Stores | Lifetime | Populated by | Invalidated by |
|---|---|---|---|---|---|
| `memory.db` | `.amanuensis/` | the whole conspectus | until explicitly discarded | every write tool | `reset_subsystem`; nothing else, by design |
| The open DB handle | server process | the SQLite connection | life of the process | first use, lazily | process exit only |
| WAL + `-shm` | `.amanuensis/` | uncommitted pages | until checkpoint | every write | checkpoint |
| Storage Git repository | `.amanuensis/.git` | recoverable snapshots of the store | until the directory is removed | `commit_phase_gate` | nothing — it is the recovery record |
| Binding receipt | server process, in memory | canonical root, project key, storage path | life of the process | `resolveProject` at startup | never — immutability is the contract |
| `initialization.json` | `.amanuensis/` | the completion marker | until discard | first-use initialization | validated on every open |
| Derived views | `memory.db` | `file_standing`, `finding_state_current`, `finding_summary`, `concern_coverage`, `hot_subsystems`, others | recreated on every open | `schema.sql` | recomputed per query |
| `active_write_locks` | `memory.db` | advisory cross-process locks | until released or expired | `acquire_lock` | `release_lock` |
| `.amanuensis/docs` | `.amanuensis/` | rendered projection | until the next publish | `materialize_docs` | clean publish |
| `docs/` | repository root | the committed projection | until the next promotion | `dev/promote-docs.mjs` | promotion |
| Receipts | `dev/`, `design/` | frozen facts about a past run | until regenerated | `record-*.mjs`, `render-*.mjs` | their own `--check` gates |
| `.pecia/work.jsonl` | repository root | execution custody, with references into the store | append-only | the `pecia` CLI | never rewritten in place |

## Phase 4 · Concern calibration

All eleven territories were checked for applicability. **None was disqualified**; twenty
concerns were derived, listed with their falsification probes in `concern-checklist.md`.
Two are local rather than catalogued: `ZD-1` (a gate green over an empty denominator),
because this project's own history records the failure three times; and `VR-1` (a version or
digest stated in several places with nothing binding them), because the repository states its
version in five places.

Territory 5 (aliasing) is the weakest fit — TypeScript with SQLite and a Python process that
reads and exits gives it little surface. One concern was kept rather than disqualifying the
territory, and the reasoning is recorded as open question 4.

## Phase 5 · Master plan

Eight subsystems, dense priority ranks 1–5. See `master-plan.md`.

## Phase 6 · Questions for the human

Four open questions, all with a working assumption recorded and none blocking: two
scope-judgment (the [B-04](subsystems/b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md) split; the finding-id namespace), one priority-ranking ([B-07](subsystems/b07-gates-evidence-custody-and-ci.md)'s
rank), one domain-knowledge (Territory 5's proportionality).

## Phase 7 · Conspectus

Artifacts written and registered; `set_git_state` records `main` at the revision above as
both the onboarding and the last-checked SHA.
