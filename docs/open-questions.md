# Decisions needed

_Questions the survey could not settle on its own. Each records what it blocked and the assumption the survey proceeded with, so a reader can see which readings would change if the assumption turns out wrong. Questions already settled are on [Resolved leads and questions](resolved-leads.md)._

## Scope judgment

_1 open question._

<a id="question-1"></a>
### #1

> Territory T5 (aliasing and ownership) is disqualified for this pass. Does a subsystem's structural pass find one?

- **Assumption the survey proceeded with** — No cross-request shared mutable object is established in this read: every request and response crosses MCP serialization, and residual process-local state is covered by [CR-1](concerns.md#cr-1) and [RL-1](concerns.md#rl-1). Reopen if a subsystem's structural pass finds an alias.
- **Recorded** — 2026-09-15 03:43 UTC.

