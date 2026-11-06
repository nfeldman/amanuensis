# amanuensis

An architecture survey of amanuensis, recorded by Amanuensis.

## What is this codebase?

Amanuensis turns reading a codebase into a durable, evidence-backed record. An MCP server holds a
SQLite store per workspace; a survey writes observations, evidence, claims, concern dispositions and
findings into it through tools that refuse a write the record does not support; a Python
materializer projects the store into Markdown and self-contained HTML a person reads. The record
survives across sessions and agent boundaries, which is the point: the survey is the deliverable,
not the session.

## Where the record stands

### Source alignment

| Metric | Value |
|---|---|
| Checked at | `7fc7f0654904` on `main`, 2026-11-06 15:21 UTC |
| Repository head | `7fc7f0654904` — the same revision the survey checked |
| Upstream head | `ee12bedf6ff7` — a different revision from the one the survey checked (`origin/main`) |
| Files carrying a survey obligation marked stale | 66 of 534 |
| Scoped files exempt from that obligation, marked stale | 69 of 156 |

### Survey coverage

| Metric | Value |
|---|---|
| Subsystems by survey depth | 3 unmapped, 2 concerns, 4 adversarial |
| Files read, of those carrying an obligation | 372 of 534 |
| Paths in scope with no ledger row | 0 |

### Open engineering work

| Metric | Value |
|---|---|
| Findings open | 20 |
| Carried defects undecided | 0 |
| Repairs awaiting verification | 0 |
| Contradictions unresolved | 0 |
| Decisions open | 6 |

### Publication integrity

| Metric | Value |
|---|---|
| State axis | green |
| Coverage axis | green |
| Content axis | green |
| Verified at | 2026-11-06 08:54 UTC |

## Findings by resolution state

| Metric | Value |
|---|---|
| [Open](findings.md) | 20 |
| [Accepted](resolved-findings.md) | 0 |
| [Ruled out](resolved-findings.md) | 0 |
| [Unverified fix](findings.md) | 0 |
| [Verified fixed](resolved-findings.md) | 1 |

## The four lenses

- **Codebase** — [Subsystem map](master-plan.md): every region, grouped by layer, with the boundaries and terms recorded for it.
- **Unresolved** — [Open findings](findings.md): defects open or awaiting verification at the checked revision.
- **History** — [Resolved findings](resolved-findings.md): the records that reached a terminal state, with the basis each one rests on.
- **Method** — [How to read the conspectus](how-to-read.md): every recorded state, what it authorizes, and what it cannot justify.

## Latest session

`republish docs` — started 2026-11-06 15:21 UTC · **active**

