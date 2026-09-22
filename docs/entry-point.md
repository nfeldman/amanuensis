# Entry point

## What this system does

Amanuensis turns reading a codebase into a durable, evidence-backed record. An MCP server holds a
SQLite store per workspace; a survey writes observations, evidence, claims, concern dispositions and
findings into it through tools that refuse a write the record does not support; a Python
materializer projects the store into Markdown and self-contained HTML a person reads. The record
survives across sessions and agent boundaries, which is the point: the survey is the deliverable,
not the session.

## What to map first

`B-02` (MCP core, persistence, lifecycle) and `B-03` (knowledge tools and workflow API), both at
priority 1. Every durable write, the WAL, the storage git repository and the workspace binding pass
through them, and 12 of the 22 carried obligations are theirs.

## Given a bug report

Start at the subsystem the reported surface belongs to in `master-plan.md`, then read that
subsystem's scope in the file ledger before reading code: the ledger says which files have been
examined at which revision and which have not been read at all. Check the carried obligations for
that subsystem in `findings-index.md` — a defect reported today may be one this store inherited and
has not yet decided.

## Given a feature request

Read the seams. A change that crosses a subsystem boundary is a seam-contract question
(concern `SC-1`), and this repository's recorded defects cluster there: an enum declared in one
place and checked in another, a refusal the server enforces and a reference that instructs the call
it refuses.

## What this store is not

It is a rebuild. The conspectus it replaced was discarded on 2026-09-14, and its 22 findings were
carried here as obligations, not as answers. Until each has a terminal outcome, this store is not
fully surveyed and says so.
