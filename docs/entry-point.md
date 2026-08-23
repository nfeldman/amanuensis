# Entry point

**Conspectus version**: full-project survey at `e33bb5f`
**Canonical branch**: `main`
**Onboarding SHA**: `b8b566f`

## What is this codebase?

Amanuensis is an evidence-driven codebase-survey system. A host agent follows phased
methodology from the skill/agent files and calls the `amanuensis-memory` stdio MCP server.
That Node/TypeScript server owns a SQLite WAL database plus a git-backed prose storage
directory and enforces survey-depth and evidence contracts. A Python subprocess renders the
DB and prose into cross-linked Markdown using per-page dependency hashes. A separate Node CLI
installs the agent bundle and MCP configuration. These boundaries are observed at
`mcp-server/src/index.ts:main@b8b566f`, `mcp-server/src/project.ts:resolveProject@b8b566f`,
and `materializer/amanuensis_materializer/core.py:Materializer@b8b566f`.

## Domain vocabulary

- **Conspectus**: persistent evidence-bearing record of what was observed, concluded,
  contradicted, ruled out, or left open about a repository.
- **Disposition**: terminal per-subsystem answer to one calibrated concern, with evidence.
- **Depth contract**: the subsystem status bounds what claims may be written.
- **Seam**: a shared boundary whose correctness cannot be inferred from either party alone.
- **Materialization**: derivation of human-readable docs from durable DB/prose state.

## Directory map

| Path | Kind | Canonical source |
|---|---|---|
| `entry-point.md` | entry point | this file |
| `onboarding-report.md` | onboarding observations and calibration | onboarding session |
| `master-plan.md` | subsystem inventory and order | SQLite subsystem rows |
| `findings-index.md` | finding summary | SQLite findings rows |
| `concern-checklist.md` | calibrated probes | SQLite concern rows |
| `field-notes.md` | narrative observations | field-note rows plus prose |
| `B-XX-*.md` | subsystem survey | one per mapped subsystem |
| `design/delightful-output-panel/` | report-interface design evidence | [B-06](subsystems/b06-report-interface-design-and-validation-studies.md) survey |
| `scholiast/` | embedded research and platform-trial evidence | [B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md) survey |

## Knowledge depth contract

| Mapping status | Authorized claims |
|---|---|
| `unmapped` | None. |
| `scoping` | File scope only. |
| `structural` | Types, state containers, flows, concurrency; no correctness claims. |
| `concerns` | Evidence-backed concern dispositions and findings. |
| `adversarial` | Concern results that survived a refutation pass. |
| `mapped` | Packaged subsystem knowledge; seams still need composed assessment. |

Any claim exceeding its source depth is speculative.

## Survey status

All seven subsystems are mapped at the current survey revision. The original five-subsystem
runtime/method/materializer/delivery map remains mapped, [B-06](subsystems/b06-report-interface-design-and-validation-studies.md) covers report-interface design and
validation, and [B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md) covers the embedded research and platform-trial evidence layer. This is a
coverage claim, not a defect-free claim; current finding resolution is read from durable finding
records rather than this orientation paragraph.

## Open confirmed bugs

- **[B07-1](findings.md#b07-1) (LOW):** research capture and snapshot-verification calls lack a caller-controlled
  completion deadline (`scholiast/ai-primary-web-platform-landscape/capture-component-landscape.mjs:github/npmMetadata@073cee8`;
  `scholiast/ai-primary-web-platform-landscape/verify-trial-snapshot.py:module verification@073cee8`).

## Verified fixed

- **[B02-1](findings.md#b02-1) (HIGH):** the phase-gate WAL/checkpoint defect was fixed at `7bfa45c` and independently
  verified through the durable finding-resolution gate.

## Mode selection

| Task | Start here |
|---|---|
| Bug report | Search findings, then identify its subsystem and read that survey's cited evidence. If the subsystem is below concerns depth, treat the report as an unverified hypothesis. |
| New feature | Use design mode: compile observed behavior, direct intent, inferred intent, constraints, contradictions, and unknowns separately before proposing options. At onboarding, read `ROADMAP.md` plus the target subsystem's jump-in files. |
| Report projection change | Read `design/delightful-output-panel/design-language.md`, [B-06](subsystems/b06-report-interface-design-and-validation-studies.md), [B-04](subsystems/b04-diff-aware-materializer.md), and seams [SM-06](seams.md#sm-06)/[SM-07](seams.md#sm-07) before changing presentation semantics. |
| Research-backed report change | Read [B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md), the relevant `scholiast/` conspectus, [B-06](subsystems/b06-report-interface-design-and-validation-studies.md), and seam [SM-08](seams.md#sm-08); preserve the research claim's stated scope and limitations. |
| Refactor | Read the target subsystem plus every declared seam and current git validity state. |
| New contributor | This entry point, `master-plan.md`, then the target subsystem's jump-in reading. |

## Minimal bootstrapping read

1. `entry-point.md`
2. `master-plan.md`
3. The target subsystem's jump-in files
4. `findings-index.md`
5. `concern-checklist.md` for any correctness claim
6. `seam-assessments-b8b566f.md` for any cross-subsystem claim
