# amanuensis

An architecture survey of amanuensis, recorded by Amanuensis. The durable records are authoritative; every page here is derived from them.

## What is this codebase?

Amanuensis produces a **conspectus** of a codebase: an evidence-backed, revision-bound record
of what a system is, what is wrong with it, and what nobody has established yet — one that
survives across sessions and across agents.

It is three things that must agree:

1. **An MCP server** (`mcp-server/`, TypeScript on Node 24) that owns a SQLite store at
   `<repo>/.amanuensis/memory.db` and exposes roughly two hundred tools. It is the authority.
   It enforces the data model: every claim cites `file:symbol@sha`, a subsystem's status caps
   what its agents may assert, dispositions and findings cannot be written without an
   evidence anchor, resolution history is append-only.
2. **A skill** (`.claude/skills/amanuensis/`) — the phased methodology a coordinating agent
   executes: onboarding, then per subsystem scope → structural → concerns → adversarial →
   packaging, then refresh.
3. **A materializer** (`materializer/`, Python) that renders the store into HTML and Markdown
   a person reads, and then reads its own output back on three axes before calling it
   published.

The load-bearing idea is epistemic rather than technical: *authorized claims scale with
recorded depth.* A subsystem at `scoping` may state its file scope and nothing more. This is
enforced in the server, not requested in prose, because the project's own history says that
prose guards get violated and structural ones do not.

What it is **not**: it never modifies the code it surveys. It reads source for evidence and
writes only through its own tools.

## Where the record stands

Four dimensions, each read from durable records and each reported on its own terms. None of them is combined with another.

### Source alignment

| Metric | Value |
|---|---|
| Checked at | `7c1c1a9f5689` on `main`, 2026-09-14 03:27 UTC |
| Repository head | `d3aeeccad870` — a different revision from the one the survey checked |
| Upstream head | `d3aeeccad870` — a different revision from the one the survey checked (`origin/main`) |
| Files carrying a survey obligation marked stale | 0 of 104 |
| Scoped files exempt from that obligation, marked stale | 0 of 2 |

### Survey coverage

| Metric | Value |
|---|---|
| Subsystems by survey depth | 8 mapped |
| Files read, of those carrying an obligation | 84 of 104 |
| Paths in scope with no ledger row | 0 |

### Open engineering work

| Metric | Value |
|---|---|
| Findings open | 13 |
| Repairs awaiting verification | 0 |
| Contradictions unresolved | 0 |
| Decisions open | 5 |

### Publication integrity

| Metric | Value |
|---|---|
| State axis | green |
| Coverage axis | green |
| Content axis | green |
| Verified at | 2026-09-14 04:53 UTC |

## Findings by resolution state

| Metric | Value |
|---|---|
| [Open](findings.md) | 13 |
| [Accepted](resolved-findings.md) | 0 |
| [Ruled out](resolved-findings.md) | 0 |
| [Unverified fix](findings.md) | 0 |
| [Verified fixed](resolved-findings.md) | 0 |

## The four lenses

- **Codebase** — [Subsystem map](master-plan.md): every region, grouped by layer, with the boundaries and terms recorded for it.
- **Unresolved** — [Open findings](findings.md): defects open or awaiting verification at the checked revision.
- **History** — [Resolved findings](resolved-findings.md): the records that reached a terminal state, with the basis each one rests on.
- **Method** — [How to read the conspectus](how-to-read.md): every recorded state, what it authorizes, and what it cannot justify.

## Latest session

`Correct the entry-point thesis heading to the template's 'What is this codebase?' so the overview renders the recorded thesis; republish and promote docs; file the missing artifact-heading contract check as a finding` — started 2026-09-14 05:42 UTC · **active**

