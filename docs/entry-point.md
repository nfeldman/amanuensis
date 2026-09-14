# Entry point

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

## What do I map first?

`mcp-server/src/index.ts` and `mcp-server/src/helpers.ts` — the server and the argument
validators every tool handler calls. Then `mcp-server/src/schema.sql`, which is the shape
of everything the system knows, and `mcp-server/src/invariants.ts`, which is the rules a
record must satisfy before it is admitted.

## Given a bug report, what do I read first?

`describe_locus` on the file the report names. It answers with the standing of that path —
what the record authorizes you to say about it and what it cannot justify — before any
account of the code. If standing comes back unledgered, the record has nothing on that path
and you should say so rather than read the file and improvise.

## Given a feature request, what mode applies?

A feature that adds a tool touches [B-01](subsystems/b01-server-runtime-and-tool-dispatch.md) (registration and dispatch), [B-03](subsystems/b03-conspectus-schema-vocabulary-and-invariants.md) (schema and the
vocabulary contract) and [B-11](subsystems/b11-development-harness-and-gates.md) (the gate and its CI row) together; none of those three can be
changed alone. A feature that changes what a reader sees touches [B-06](subsystems/b06-locus-standing-and-the-reader-lenses.md) and [B-08](subsystems/b08-materializer-rendering-pipeline.md)/[B-09](subsystems/b09-projection-read-back-and-publication-custody.md), where
the read-back axes decide whether a projection is published at all.

## Confirmed bugs

Ten, at `0fee11b`, all with attached evidence and an adversarial verdict. The full index with
severities is `findings-index.md`; the three patterns are what a new reader needs.

- **A predicate held twice.** `finding_state_current` exists so that "an open bug" has one
  definition. Two readers still compute it inline from `findings.status`: `list_subsystems`
  ([B04-5](findings.md#b04-5)) and the subsystem-map renderer ([B08-1](findings.md#b08-1)). They agree today because every transition
  tool writes the column and the event together — `verify_finding_fix` already does not.
- **A revision nobody resolved.** `add_claim` and `add_xref` resolve every revision they cite
  against the bound workspace. `add_evidence` ([B04-4](findings.md#b04-4)), `set_disposition` and `add_finding`
  ([B05-1](findings.md#b05-1)) do not, so the rows that carry a reading are the ones whose binding is unchecked.
- **A vocabulary party no check reads.** Prose in `schema.sql` describing a CHECK the migration
  now repairs ([B03-4](findings.md#b03-4)); prose in `SKILL.md` publishing twenty-three enums the four-party check
  never compares ([B10-1](findings.md#b10-1)); and `STALE_REASONS`, generated into two modules and imported by
  neither of its writers ([B07-1](findings.md#b07-1)).

Two more are about the gates themselves: an ancestry axis that cannot turn red where CI runs it
([B11-1](findings.md#b11-1)), and three harness files a `grep` reports as empty ([B11-2](findings.md#b11-2)).

## Minimal read

Unchanged by this pass, with one addition. `mcp-server/src/tools/evidence.ts` is now part of
the smallest set: it is the single ingress for every evidence row in the store, which is what
makes [B04-4](findings.md#b04-4) one change rather than many.
