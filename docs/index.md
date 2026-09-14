# amanuensis

An architecture survey of amanuensis, recorded by Amanuensis. The durable records are authoritative; every page here is derived from them.

## What is this codebase?

Amanuensis gives a coding agent a durable, evidence-backed account of a repository. It has
three parts. An MCP server (`mcp-server/`, TypeScript, ~38k lines of `src/`) holds the
account in a SQLite database beside the repository and exposes it as tools: record a
subsystem, a file's place in scope, a piece of structured evidence, a revision-bound claim,
a concern's disposition, a finding and the events that resolve it. A Python materializer
(`materializer/`) opens that database read-only and projects it into Markdown pages and a
self-contained HTML index for people. A skill (`.claude/skills/amanuensis/`) is the
methodology the agent follows: a phased survey in which each phase has a deliverable, and
each status a subsystem reaches authorizes a narrower or wider set of claims than the one
before.

The organising idea is that an assertion about code is only worth carrying forward if the
record says how it was reached. Every claim cites structured evidence; every piece of
evidence names a file, a symbol, and the git revision it was read at; a status advance is
refused unless the phase before it left the deliverable it owes.

## Where the record stands

Four dimensions, each read from durable records and each reported on its own terms. None of them is combined with another.

### Source alignment

| Metric | Value |
|---|---|
| Checked at | `0fee11b0fea1` on `reader-lenses`, 2026-09-12 13:14 UTC |
| Repository head | `331078257db7` — a different revision from the one the survey checked |
| Upstream head | not known here |
| Files carrying a survey obligation marked stale | 0 of 58 |
| Scoped files exempt from that obligation, marked stale | none in scope |

### Survey coverage

| Metric | Value |
|---|---|
| Subsystems by survey depth | 11 mapped, 1 deferred |
| Files read, of those carrying an obligation | 29 of 58 |
| Paths in scope with no ledger row | 0 |

### Open engineering work

| Metric | Value |
|---|---|
| Findings open | 10 |
| Repairs awaiting verification | 0 |
| Contradictions unresolved | 0 |
| Decisions open | 5 |

### Publication integrity

| Metric | Value |
|---|---|
| State axis | green |
| Coverage axis | green |
| Content axis | green |
| Verified at | 2026-09-12 14:52 UTC |

## Findings by resolution state

| Metric | Value |
|---|---|
| [Open](findings.md) | 10 |
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

`P20 regeneration: clean publish and promotion of the regenerated projection` — started 2026-09-12 14:59 UTC · **active**

