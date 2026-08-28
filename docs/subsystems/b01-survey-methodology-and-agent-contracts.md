# **B-01** — Survey methodology and agent contracts

**Status**: 🟢 mapped  
**Layer**: coordination

## Scope

.claude/skills/amanuensis/** — SKILL.md plus the phase instructions, concern calibration, artifact templates, reporting-style contract, and setup reference. The former agents/** directory was removed in 3f3065d; role handoffs now live entirely in the skill references.

## Start here

.claude/skills/amanuensis/SKILL.md; .claude/skills/amanuensis/references/subsystem-survey.md; .claude/skills/amanuensis/references/reporting-style.md

## Notes

Prompt/contract layer. Claims about runtime enforcement must cross to [B-02](b02-mcp-core-persistence-and-lifecycle.md)/[B-03](b03-knowledge-tools-and-workflow-api.md). Ledger caveat: 11 rows for agents/** name files deleted in 3f3065d and cannot be retired without a destructive **B-01** reset — see finding [B03-1](../findings.md#b03-1) and open question 7.

## File ledger

| Path | Classification | Why in scope | Ref SHA |
|---|---|---|---|
| `.claude/skills/amanuensis/SKILL.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `.claude/skills/amanuensis/references/artifact-templates.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `.claude/skills/amanuensis/references/concern-territories.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `.claude/skills/amanuensis/references/memory-audit.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `.claude/skills/amanuensis/references/notes.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `.claude/skills/amanuensis/references/onboarding.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `.claude/skills/amanuensis/references/open-questions.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `.claude/skills/amanuensis/references/phase-1-scope.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `.claude/skills/amanuensis/references/phase-2-structural.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `.claude/skills/amanuensis/references/phase-3-concerns.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `.claude/skills/amanuensis/references/phase-4-adversarial.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `.claude/skills/amanuensis/references/phase-5-packaging.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `.claude/skills/amanuensis/references/reporting-style.md` | examined | Reporting-style contract governing human-facing labels, IA/UI boundary, and register; modified in this refresh range. | `5694080` |
| `.claude/skills/amanuensis/references/setup.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `.claude/skills/amanuensis/references/subsystem-survey.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `agents/README.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `agents/amanuensis-adversarial.agent.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `agents/amanuensis-auto.agent.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `agents/amanuensis-concerns.agent.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `agents/amanuensis-memory-auditor.agent.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `agents/amanuensis-notes.agent.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `agents/amanuensis-scoper.agent.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `agents/amanuensis-structural.agent.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `agents/amanuensis.agent.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `agents/references/artifact-templates.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |
| `agents/references/concern-territories.md` | examined | Pinned A0 inventory assigns this file to **B-01**. | `b8b566f` |

## Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AT-1](../concerns.md#at-1)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [AT-1](../concerns.md#at-1) in **B-01**. |
| **[AT-2](../concerns.md#at-2)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [AT-2](../concerns.md#at-2) in **B-01**. |
| **[CC-1](../concerns.md#cc-1)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [CC-1](../concerns.md#cc-1) in **B-01**. |
| **[CR-1](../concerns.md#cr-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [CR-1](../concerns.md#cr-1) in **B-01**. |
| **[EP-1](../concerns.md#ep-1)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [EP-1](../concerns.md#ep-1) in **B-01**. |
| **[EP-2](../concerns.md#ep-2)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [EP-2](../concerns.md#ep-2) in **B-01**. |
| **[IF-1](../concerns.md#if-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [IF-1](../concerns.md#if-1) in **B-01**. |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [RL-1](../concerns.md#rl-1) in **B-01**. |
| **[RL-2](../concerns.md#rl-2)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [RL-2](../concerns.md#rl-2) in **B-01**. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified |  | [SM-01](../seams.md#sm-01) integral contract was read from both mapped endpoints and passed at the pinned revision; residuals remain separately visible. |
| **[SC-2](../concerns.md#sc-2)** | confirmed-acceptable | code-verified |  | [SM-04](../seams.md#sm-04) integral contract was read from both mapped endpoints and passed at the pinned revision; residuals remain separately visible. |
| **[SC-4](../concerns.md#sc-4)** | confirmed-acceptable | contract-stated |  | The reporting-style contract and [B-06](b06-report-interface-design-and-validation-studies.md) design language agree after both intervening commits, including the exact primary/secondary coverage split and contextual identifier treatment. |
| **[SI-1](../concerns.md#si-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [SI-1](../concerns.md#si-1) in **B-01**. |
| **[SI-2](../concerns.md#si-2)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [SI-2](../concerns.md#si-2) in **B-01**. |
| **[TB-1](../concerns.md#tb-1)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [TB-1](../concerns.md#tb-1) in **B-01**. |
| **[TR-1](../concerns.md#tr-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [TR-1](../concerns.md#tr-1) in **B-01**. |
| **[TR-2](../concerns.md#tr-2)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [TR-2](../concerns.md#tr-2) in **B-01**. |

## Seams

| Seam | Shared object | Other party |
|---|---|---|
| **[SM-01](../seams.md#sm-01)** | MCP tool protocol and survey phase contract | **[B-03](b03-knowledge-tools-and-workflow-api.md)** |
| **[SM-04](../seams.md#sm-04)** | packaged agent and reference mirrors | **[B-05](b05-packaging-installer-validation-and-product-docs.md)** |
| **[SM-07](../seams.md#sm-07)** | reporting terminology and information-architecture contract | **[B-06](b06-report-interface-design-and-validation-studies.md)** |
| **[SM-10](../seams.md#sm-10)** | activation contract (installation scope, skill destination, config markers) | **[B-05](b05-packaging-installer-validation-and-product-docs.md)** |

## Survey notes

# **B-01** · Survey methodology and agent contracts

- Survey revision: `b8b566f`
- Status: adversarial pass complete; packaging pending

## Key types

The subsystem is an executable human/agent protocol rather than a runtime module. Its load-bearing types are the six survey depths, the evidence-quality ladder, terminal concern dispositions, phase artifacts, open questions, and seam assessments (`.claude/skills/amanuensis/SKILL.md:Survey workflow@b8b566f`; `.claude/skills/amanuensis/references/phase-3-concerns.md:For each concern@b8b566f`). The `agents/*.agent.md` files are role-specific adapters; the root skill and its references remain the source of truth (`agents/README.md:Agent roster@b8b566f`).

## State containers

This layer owns no private mutable runtime state. It names and constrains the durable MCP rows and prose artifacts written by each phase. Phase status is persistent; locks, session authority, and storage history are delegated to [B-02](b02-mcp-core-persistence-and-lifecycle.md)/[B-03](b03-knowledge-tools-and-workflow-api.md) (`.claude/skills/amanuensis/references/subsystem-survey.md:Session setup@b8b566f`).

## Data flow

1. Onboarding inventories repository structure and calibrates concerns before subsystem claims are authorized.
2. Scoping creates a complete file ledger before method bodies are read.
3. Structural mapping records types, state, flows, concurrency, and seams.
4. Concern review records evidence before terminal dispositions.
5. A refutation-framed adversarial pass tries to overturn confirmed or linchpin-dependent claims.
6. Packaging updates navigators, materializes projections, checks seam assessability, and advances the subsystem to mapped.

Evidence: `.claude/skills/amanuensis/references/onboarding.md:Process@b8b566f`; `.claude/skills/amanuensis/references/subsystem-survey.md:Running a phase@b8b566f`.

## Concurrency model

The workflow permits phase agents but serializes writes to a shared artifact with MCP locks. This survey ran inline because no user-authorized subagents were available. The method treats parallel findings as independent inputs and reserves aggregation and contradiction handling for the coordinator (`.claude/skills/amanuensis/references/subsystem-survey.md:Running a phase@b8b566f`).

## Seam contracts

- **[SM-01](../seams.md#sm-01) · **B-01** ↔ [B-03](b03-knowledge-tools-and-workflow-api.md):** agent protocol writes through MCP tools; server invariants, not prose, enforce subtractive guards.
- **[SM-04](../seams.md#sm-04) · **B-01** ↔ [B-05](b05-packaging-installer-validation-and-product-docs.md):** installer/package mirrors must reproduce the source agent bundle and references.

## Concern dispositions

All 16 active concerns have terminal dispositions. Scope/revision identity, interruption recovery, trust boundaries, and schema/mirror consistency are applicable; cache, subprocess, and database atomicity concerns are assigned to their owning runtime subsystem. No confirmed **B-01** defect survived this pass.

## Adversarial review

The strongest disproof target was that the phase protocol could claim progress without prior-phase output. Server-side monotonic/prerequisite checks compensate for the mechanically representable part (`mcp-server/src/invariants.ts:enforcePhasePrerequisites@b8b566f`). Generative truth remains outside those guards and is explicitly bounded by evidence and adversarial review. Verdict: method contract upheld with that scope restriction.
