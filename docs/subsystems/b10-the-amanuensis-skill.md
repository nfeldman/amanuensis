# **B-10** — The Amanuensis skill

**Status**: 🟢 mapped  
**Layer**: methodology

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

.claude/skills/amanuensis/SKILL.md and .claude/skills/amanuensis/references/*.md — the phased survey methodology the coordinator executes, its routing table, and the per-phase instructions that decide which tools are called and in what order.

## Start here

.claude/skills/amanuensis/SKILL.md, then .claude/skills/amanuensis/references/phase-2-structural.md

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-10/key-type/claude-skills-amanuensis-skill-md-autonomous-phase-execution` | `.claude/skills/amanuensis/SKILL.md:Autonomous phase execution` | The status ladder is published in the skill with a table of what each status authorizes, and the text states that autonomous execution does not relax it: a claim exceeding its source's status must be flagged speculative. The ladder is therefore a contract the prose asserts and the server separately enforces at each advance. | Observation | `258ccd28fc19` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-10/state-container` | `B-10` | **B-10** holds no state at all: it is prose read into a model's context. Everything it establishes is held elsewhere — in the store the tools write, or in the session the coordinator keeps. That is also its failure mode: an instruction here is followed only as far as a reader follows it, which is why the rules that must not be optional are enforced by code instead. | Inference | `258ccd28fc19` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-10/flow/survey-a-subsystem/01` | `.claude/skills/amanuensis/references/phase-2-structural.md:Record the inventory as claims` | Step 1 of the structural phase's recording: five claim_key shapes are named, the symbol slug is the whole path:symbol pair so two files defining the same name cannot collide under one key, and a genuinely empty category is recorded as an explicit negative claim rather than omitted. The prose and the server's refusal say the same thing, in that order. | Observation | `258ccd28fc19` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-10/concurrency` | `B-10` | The skill permits phases to run as subagents, so two phase passes may be in flight at once against one store. Nothing in the prose coordinates them; the ordering that matters is enforced by the server's phase prerequisites, which refuse an advance whose deliverable is absent whatever order the passes finished in. | Inference | `258ccd28fc19` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-08](../seams.md#sm-08)** | the conspectus vocabulary (enum values and what each authorizes) | **[B-03](b03-conspectus-schema-vocabulary-and-invariants.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-10** | → | **[B-03](b03-conspectus-schema-vocabulary-and-invariants.md)** | dependency | observed | the skill names enum values in prose and is the only hand-written party to the vocabulary contract, which is why a checker reads it independently of the generated copies, read at .claude/skills/amanuensis/SKILL.md:Autonomous@258ccd2 |
| **B-10** | → | **[B-04](b04-survey-record-tools.md)** | dependency | structural | the structural phase's instructions decide which tools a survey calls and with what claim_key shapes, so the record's form is set here before any handler sees it, read at .claude/skills/amanuensis/references/phase-2-structural.md:Record@258ccd2 |

## Known defects here

1 defect here is open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- SKILL.md can drift from the vocabulary source on twenty-three of the twenty-five enums with no check naming the divergence: the four-party check compares the hand-written party only on evidence kinds and disposition classifications, while the prose also publishes the six-value status ladder and the five field-note categories as lists an agent acts on directly. — [B10-1](../findings.md#b10-1) · 🟡 MEDIUM · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 3 of 5 ledger rows |
| Files in scope, not yet read | 2 of 5 |
| Files excluded from the survey obligation | 0 of 5 |
| Ledger rows the repository has changed under | 0 of 5 |
| Active concerns with a disposition recorded here | 7 of 15 — 2 confirmed-bug, 4 confirmed-acceptable, 1 out-of-scope |
| Findings by resolution state | 1 open |
| Seams assessable from both sides | 1 of 1 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-c976057001"></a>`.claude/skills/amanuensis/references/phase-1-scope.md` | candidate | The file-ledger discipline every later phase's denominator depends on. | `258ccd28` |
| <a id="le-7e5807cdf9"></a>`.claude/skills/amanuensis/references/reporting-style.md` | candidate | The register rules every label, hint and page this system emits is written to. | `258ccd28` |
| <a id="le-1d35e873d1"></a>`.claude/skills/amanuensis/SKILL.md` | examined | The coordinator's contract: the start-up probe, the routing table, the status ladder and what each status authorizes, and the conditions that stop execution. | `258ccd28` |
| <a id="le-607a29a6d4"></a>`.claude/skills/amanuensis/references/onboarding.md` | examined | The eight-phase first pass, including the artifacts it must register and the git state it must set. | `258ccd28` |
| <a id="le-991d96e6c1"></a>`.claude/skills/amanuensis/references/phase-2-structural.md` | examined | The instructions that decide which tools a structural pass calls, in what order, and with what claim_key shapes. | `258ccd28` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[BV-1](../concerns.md#bv-1)** | confirmed-acceptable | contract-stated |  | The one boundary this subsystem states — never scan, classify, or cite .amanuensis as target-project source — is not left to a reader following it: requireWorkspaceSourcePath refuses a path whose first segment is .amanuensis at every durable ingress, so the prose describes a rule the substrate holds rather than substituting for one. |
| **[CC-1](../concerns.md#cc-1)** | out-of-scope | contract-stated |  | The skill issues no query and reads no derived state; it names the tools that do, so a predicate cannot be duplicated here in the sense the concern means — what it can duplicate is a vocabulary, which is [GT-1](../concerns.md#gt-1) and is answered there. |
| **[EV-1](../concerns.md#ev-1)** | confirmed-acceptable | contract-stated |  | The skill states the rule the whole conspectus rests on — if you cannot cite, you cannot claim, and evidence quality must be the strongest the evidence actually supports — and it is accurate as a statement of the methodology; where it is not enforced beneath the prose is recorded against the subsystems that own those writes, as [B04-4](../findings.md#b04-4) and [B05-1](../findings.md#b05-1), not doubled here. |
| **[GT-1](../concerns.md#gt-1)** | confirmed-bug | code-verified |  | The four-party check compares the two generated parties against every enum the source declares and the hand-written party against exactly two of the twenty-five, each found by its own literal regex; SKILL.md also publishes the six-value status ladder and the five field-note categories as prose an agent acts on, and neither is compared with anything. |
| **[RC-1](../concerns.md#rc-1)** | confirmed-acceptable | contract-stated |  | The skill permits phases to run as subagents and coordinates none of them, which would be the lifecycle hazard — but every phase reaches the store through one server process whose connection is synchronous, so two passes serialize at the handle, and the ordering that matters is refused by the phase prerequisites whatever order the passes finished in. |
| **[SC-8](../concerns.md#sc-8)** | confirmed-bug | contract-stated |  | From the hand-written side: this party publishes at least four of the contract's vocabularies as prose an agent acts on directly, and is held to the source on two of them; finding of record [B10-1](../findings.md#b10-1). |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-acceptable | contract-stated |  | The skill's own checks are instructions, so their denominator is whatever the reader looked at — and it does not pretend otherwise: it routes every gate that must hold to the server, tells the coordinator that a refused advance means a deliverable is missing and not to force it, and requires each phase to report what it did not reach. |

### Survey artifact

#### **B-10** · The Amanuensis skill

Structural inventory at `258ccd2`. Prose, not code — which is the fact that matters most about it.

##### Key types

| Symbol | Role | Source |
|---|---|---|
| the status ladder | what each status authorizes, published as a table and stated not to be relaxed by autonomous execution | `.claude/skills/amanuensis/SKILL.md:Autonomous phase execution@258ccd2` |
| the claim_key shapes | five shapes, with the slug defined as the whole `path:symbol` pair | `.claude/skills/amanuensis/references/phase-2-structural.md:Record the inventory as claims@258ccd2` |

##### State containers

None: it is prose read into a model's context. Everything it establishes is held elsewhere — in
the store the tools write, or in the session the coordinator keeps. That is also its failure
mode, and the reason the rules that must not be optional are enforced by code instead. Recorded
as an explicit negative claim (`B-10/state-container`).

##### Data flow · surveying a subsystem

1. The structural phase's instructions name the claim shapes, require the slug to be the whole
   `path:symbol` pair so two files defining one name cannot collide under a single key, and say
   that an empty category is an explicit negative claim
   (`.claude/skills/amanuensis/references/phase-2-structural.md:Record the inventory as claims@258ccd2`).
   The prose and the server's refusal say the same thing, in that order.

##### Concurrency model

Phases may run as subagents, so two passes may be in flight against one store. Nothing in the
prose coordinates them; the ordering that matters is enforced by the phase prerequisites, which
refuse an advance whose deliverable is absent whatever order the passes finished in. Recorded as
an inference.

##### Seam contracts

- **[SM-08](../seams.md#sm-08) · the conspectus vocabulary, with [B-03](b03-conspectus-schema-vocabulary-and-invariants.md).** This side is the only hand-written party to
  a four-party contract, which is why a checker reads it independently of the generated copies.

##### Concern review

Six active concerns, all terminal at `0fee11b`. One confirmed bug.

| Concern | Disposition | Reading |
|---|---|---|
| [CC-1](../concerns.md#cc-1) | out-of-scope | The skill issues no query; what it can duplicate is a vocabulary, which is [GT-1](../concerns.md#gt-1). |
| [RC-1](../concerns.md#rc-1) | confirmed-acceptable | It coordinates concurrent phase subagents not at all; they serialize at one server process's synchronous connection. |
| [BV-1](../concerns.md#bv-1) | confirmed-acceptable | Its one boundary rule has a code counterpart that refuses `.amanuensis` at every durable ingress. |
| [EV-1](../concerns.md#ev-1) | confirmed-acceptable | The cite-everything rule is accurate as methodology; where the substrate does not hold it is recorded as [B04-4](../findings.md#b04-4) and [B05-1](../findings.md#b05-1). |
| [GT-1](../concerns.md#gt-1) | **confirmed-bug** ([B10-1](../findings.md#b10-1)) | The hand-written party is compared on two of twenty-five enums. |
| [ZD-1](../concerns.md#zd-1) | confirmed-acceptable | It routes every gate that must hold to the server and tells the coordinator not to force a refused advance. |

##### Adversarial review

**Finding [B10-1](../findings.md#b10-1) — upheld.** Claim A: SKILL.md can drift on twenty-three enums with nothing
naming the divergence. Claim B: a second checker reads the prose. Evidence for Claim B:
`test-vocabulary-source.mjs` asserts the source's own shape, not its agreement with prose, and
no other script in the repository reads `SKILL.md`. Verdict: **upheld**.

**Claims.** Four targets, all survived — including `state-container`, for which this pass is
itself the evidence: everything durable it produced went through a tool call.
