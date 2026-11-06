# Explanation: a concern the architecture never gave a home

Proposal, 2026-11-05. Normative rules are in `spec.md`; owner decisions are in `decisions.md`.

## The problem

The published conspectus reads as tables, file paths, identifiers and "not recorded" placeholders.
On this repository's own pages (`docs/`, published at `eae1575`):

- `docs/index.md` carries no description of the project. Its thesis slot prints "No thesis section
  is recorded".
- Every subsystem page opens with "No purpose statement is recorded for this subsystem".
- Subsystem pages are 61–92% table text by visible characters.
- 10 of the store's 11 claims render under "Other claims", with the claim key first.

## Two causes

**Nothing authors explanation.** No skill phase asks what a subsystem is for, what rules it
enforces, or how the parts fit together. The artifact template's "Tier 1 summary" has never been
requested by the packaging phase. `subsystems` has `scope`, `jump_in_reading` and `notes`, and no
purpose field.

**The projection drops or buries prose that exists.** The reader-lenses work of 2026-09-11/12
banned read-time synthesis and unbound prose presented as record. Both bans were right. Four of
its changes also removed or demoted prose a survey session had written:

| Change | Effect |
|---|---|
| Thesis read only under the heading "What is this codebase?" (`3f8b7f3`) | This repository's `entry-point.md` has a thesis under "What this system does"; it is not published |
| Narrative promoted only when a subsystem has zero claims (`1bcaa43`, `1d6516a`) | Phase 2 requires a claim, so every surveyed subsystem's write-up sits below its file ledger |
| `subsystems.notes` and `findings.business_context` removed from the page (`d302237`) | All 11 findings have a business context; none is rendered |
| Every page states that no purpose is recorded (`9babd7f`) | True, and the slot has no way to be filled |

## The rethink

Amanuensis separates these concerns:

| Concern | Owner | Contract |
|---|---|---|
| Record | MCP server and store | Observations with evidence at a revision; refuses writes the record does not support |
| Survey | Skill | How a session earns the record, phase by phase |
| Projection | Materializer | Deterministic pages from the store, read back before publication |
| Agent read surface | `describe_locus`, `get_attention`, `get_history` | Bounded answers, zero model calls |
| Gates | Tests and receipts | Checks that can turn red |

**Explanation** is missing from that table. It is the answer to "what is this for, how does it
fit together, why is it shaped this way". Prior designs treated it only as a liability: prose
that cannot be bound to a revision. This proposal gives it a contract of its own.

An explanation is:

1. written by a survey session that has read the code, at `structural` depth or later;
2. stored as a durable, append-only record, attributed to its session and labelled as written by
   a survey;
3. bound to a revision and to evidence rows;
4. shown with a computed notice when the files it cites have changed, and never hidden for it;
5. rendered first on the pages a person reads;
6. never synthesized at read time: the read tools still make zero model calls;
7. discharged or declined with a reason, with no length floor;
8. orientation, not authority. Claims remain the home of individually falsifiable rules, and a
   reader who needs to rely on a statement follows it to the claims and evidence beneath it.

## What changes

**Recover what exists.** Render `business_context` and `notes`. Render claims as readable
records, statement first. Show the survey narrative with the structure it describes. Group ledger
rows that repeat one reason. Report every unfilled explanatory slot to the session that can fill
it.

**Add the record.** A new `explanations` table with two slots, `purpose` and `account`, for a
subsystem, and an `account` for the project. Two tools write it. Advancing a subsystem to `mapped`
is refused until each slot is recorded or declined.

**Author it.** The structural phase records a purpose and a draft account. The adversarial phase
reads the account against the code. Packaging revises it. A synthesis step records the project
account: what the system does for its users, how a record passes through the parts, and the rules
that hold everywhere.

**Render it.** A subsystem page leads with Purpose and How it works. The architecture page gains
"How the parts fit together". The master plan and identifier hover text carry each subsystem's
purpose.

**Restore the receipt gates.** Three receipt-bound gates are red on `main` as of `ee12bed`. The
lane re-records the receipt chain when it republishes and decides the 14 undecided carried
findings.

## What does not change

- The read tools make no model call and the MCP wire is unchanged.
- The overview thesis is still read by heading from `entry-point.md`.
- Scope is never relabelled as purpose.
- No explanation is derived from a name or a path list.
- No existing test, gate or read-back axis is weakened.

## What this cannot establish

Whether an explanation is true or useful is not mechanically checked. The record requires that
it was written by an attributed session with evidence at a revision, and the page says so. The
adversarial pass and the owner's reading are the only checks on its content.
