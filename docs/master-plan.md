# Master plan

## coordination

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 2 | **[B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)** | Survey methodology and agent contracts | 🟢 mapped | .claude/skills/amanuensis/** — SKILL.md plus the phase instructions, concern calibration, artifact templates, reporting-style contract, and setup reference. The former agents/** directory was removed in 3f3065d; role handoffs now live entirely in the skill references. | .claude/skills/amanuensis/SKILL.md; .claude/skills/amanuensis/references/subsystem-survey.md; .claude/skills/amanuensis/references/reporting-style.md | 0 (0 open) |

## delivery

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 3 | **[B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)** | Packaging, installer, validation, and product docs | 🟢 mapped | mcp-server/src/cli.ts, mcp-server/scripts/**, the mcp-server test suites and fixtures, package metadata, .github/**, dev/adr/** (ADRs 0001-0020), dev/conspectus/** and the living-conspectus and pecia roadmap gates, README/CONTRIBUTING/ROADMAP/INSTALLATION/HISTORY, and workspace MCP config. | mcp-server/src/cli.ts; .github/workflows/test.yml; INSTALLATION.md | 1 (0 open) |

## delivery evidence

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 2 | **[B-08](subsystems/b08-activation-evidence-and-release-readiness-harness.md)** | Activation evidence and release-readiness harness | 🟢 mapped | dev/activation-evidence/**, the dev/ activation and friction-free release harness scripts (run-/check-/test-/capture-/cleanup-/adopt-/render-), mcp-server/fixtures/activation/**, the mcp-server activation and binding tests, dev/adr/0021, dev/friction-free-release-checklist.md, and dev/release-notes-v0.2.0-beta.1.md; the A19-A26 program that produced and gates the v0.2.0-beta.1 activation claim. | dev/adr/0021-friction-free-codex-activation.md; dev/check-friction-free-release-readiness.mjs; dev/activation-evidence/a26-release-readiness.json | 1 (0 open) |

## design evidence

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 3 | **[B-06](subsystems/b06-report-interface-design-and-validation-studies.md)** | Report interface design and validation studies | 🟢 mapped | design/delightful-output-panel/**; source captures, blind panel records, prototypes, task tests, screenshots, and validation reports used to define and test the human report projection. | design/delightful-output-panel/README.md; design/delightful-output-panel/design-language.md; design/delightful-output-panel/validation/report.md | 0 (0 open) |

## projection

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 2 | **[B-04](subsystems/b04-diff-aware-materializer.md)** | Diff-aware materializer | 🟢 mapped | materializer/**; read-only DB access, page planning and rendering, the typed HTML projection and its independent read-back, manifest dependency hashes, xref resolution, and clean documentation output. | materializer/amanuensis_materializer/core.py; materializer/amanuensis_materializer/html_projection.py; materializer/amanuensis_materializer/diagrams.py | 1 (0 open) |

## research evidence

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 3 | **[B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md)** | Embedded research surveys and platform trials | 🟢 mapped | scholiast/**; embedded research conspectuses, measurement scripts and JSON outputs, and generated platform trial implementations used to evaluate report presentation and web-platform choices. | scholiast/ai-primary-web-platform-landscape/README.md; scholiast/ai-primary-web-platform-landscape/conspectus.md; scholiast/report-record-presentation/conspectus.md | 1 (1 open) |

## runtime

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 1 | **[B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)** | MCP core, persistence, and lifecycle | 🟢 mapped | mcp-server/src root modules and schema.sql except cli.ts: server bootstrap, SQLite lifecycle and migrations, invariants, sessions, project identity and repository binding (project.ts, codex-host.ts), the codebase-brief contract module, and storage git. | mcp-server/src/project.ts; mcp-server/src/schema.sql; mcp-server/src/invariants.ts | 2 (0 open) |
| 1 | **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** | Knowledge tools and workflow API | 🟢 mapped | mcp-server/src/tools/** (41 modules) and mcp-server/contracts/**; MCP handlers implementing evidence, findings, files, seams, dispatch, locks, staleness, materialization and queries, plus the living-conspectus surfaces added since onboarding — claims, change impact, revalidation, resolution, refresh, review and review sessions, composition, codebase briefs, design sessions, decisions, research, crosswalk, learning, evaluation, and the Chorusmith adapter. | mcp-server/src/tools/evidence.ts; mcp-server/src/tools/git.ts; mcp-server/src/tools/dispositions.ts | 4 (1 open) |

