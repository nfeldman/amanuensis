# Onboarding report

**Repository**: github.com/nfeldman/amanuensis · **Revision**: `b716a6d1496d9dd312356fb8f3ba6764f7567467` · **Branch**: survey-depth (canonical: main)
**Produced by**: the survey-depth acceptance rebuild, packet P8.

This store replaced a conspectus that was discarded. The 22 findings the predecessor held were
carried forward before any survey work began, and each is an obligation this survey must decide;
they are listed under *Carried obligations* below and in `design/survey-depth/carry-receipt.json`
in the repository.

## Repository shape

TypeScript MCP server (`mcp-server/`, stdio, better-sqlite3, one SQLite store per workspace),
a Python projection (`materializer/`, uv-managed, renders the store to Markdown and self-contained
HTML), the survey method itself as a skill (`.claude/skills/amanuensis/`), a repository-level
harness of drivers and gates (`dev/`), embedded research surveys (`scholiast/`), and design lanes
with their specifications and receipts (`design/`). 638 tracked paths at this
revision.

## Runtime boundary

One process: the MCP server, spawned over stdio by a host. It shells out to `git` for revision
resolution and to the storage git repository for checkpoints, and spawns `python3` for the
materializer. Storage is workspace-local — `.amanuensis/` beside the checkout — which is why two
worktrees of this repository hold two stores under one project key.

## Stateful entities

The SQLite store under WAL; the storage git repository that checkpoints it; the materializer lock;
the write-lock table; the file ledger and its reconciliation record; the carried-finding table this
rebuild introduced.

## Concern calibration

12 concerns seeded from 10 territories of
`references/concern-territories.md`. One territory is disqualified with its condition recorded as
an open question rather than skipped. The checklist is committed as
`mcp-server/contracts/concern-checklist.json`, where the gate that counts concern coverage reads it
from a document the survey does not also write.

## Decomposition

9 subsystems, ranked by survey priority. See `master-plan.md`.

## Reconciliation

`detect_changes` at `a7f9384dee63bc1eb16e564b83ff98f8f7bb7079`: 638 tracked, 638 ledger
rows, 0 unledgered, 0 absent, 69 exempt. Every tracked path
carries exactly one subsystem assignment.

## Carried obligations

22 records from `store-legacy-36f2623f4d9afe92`, the clean-slate store frozen at
`7c1c1a9`. 8 were already closed in
the archive and are pre-recorded `archived-terminal`;
14 are undecided and must each be re-found as a successor
finding, ruled out with evidence collected here, or marked repaired at a commit that resolves.

## Decision docket

- **scope-judgment** — Territory T5 (aliasing and ownership) is disqualified for this pass. Does a subsystem's structural pass find one?
  Working assumption: No cross-request shared mutable object is established in this read: every request and response crosses MCP serialization, and residual process-local state is covered by [CR-1](concerns.md#cr-1) and [RL-1](concerns.md#rl-1). Reopen if a subsystem's structural pass finds an alias.
