# Decisions needed

_Questions the survey could not settle on its own. Each records what it blocked and the assumption the survey proceeded with, so a reader can see which readings would change if the assumption turns out wrong. Questions already settled are on [Resolved leads and questions](resolved-leads.md)._

## Contradiction

_1 open question._

<a id="question-2"></a>
### #2 · subsystem **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** · phase `adversarial`

> [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)/[SI-2](concerns.md#si-2) is dispositioned confirmed-acceptable on the rationale that "every revision this surface accepts is resolved at the write and re-resolved at the read", but [SI-2](concerns.md#si-2)'s calibrated probe names the anchor as well as the ref_sha, and finding B03-R5 establishes that an anchor's symbol and line_range are never checked against the file at that revision — 13 of this store's 35 evidence rows point past the end of their own file. Does [SI-2](concerns.md#si-2) on [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) stay confirmed-acceptable with its scope narrowed to the revision half, or become confirmed-bug with B03-R5 as the finding that confirms it?

- **What this blocked** — Nothing. The finding and the measurement are both recorded; only the disposition's classification is left open.
- **Assumption the survey proceeded with** — Left as recorded. B03-R5 is filed as a confirmed bug with its own evidence, and [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)/[SI-2](concerns.md#si-2)'s classification is unchanged: revising a disposition another packet's survey pass recorded is a survey act, and this session is P11, which publishes and records receipts. The next session to survey [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) adjudicates it.
- **Recorded** — 2026-09-18 02:14 UTC.

## Scope judgment

_1 open question._

<a id="question-1"></a>
### #1

> Territory T5 (aliasing and ownership) is disqualified for this pass. Does a subsystem's structural pass find one?

- **Assumption the survey proceeded with** — No cross-request shared mutable object is established in this read: every request and response crosses MCP serialization, and residual process-local state is covered by [CR-1](concerns.md#cr-1) and [RL-1](concerns.md#rl-1). Reopen if a subsystem's structural pass finds an alias.
- **Recorded** — 2026-09-15 03:43 UTC.

