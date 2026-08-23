# Master plan

## coordination

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 2 | **[B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)** | Survey methodology and agent contracts | 🟢 mapped | .claude/skills/amanuensis/** and agents/**; phase instructions, concern calibration, artifact templates, and role handoffs. | .claude/skills/amanuensis/SKILL.md; agents/amanuensis.agent.md; .claude/skills/amanuensis/references/subsystem-survey.md | 0 (0 open) |

## delivery

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 3 | **[B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)** | Packaging, installer, validation, and product docs | 🟢 mapped | mcp-server/src/cli.ts, mcp-server/scripts/**, tests/config/package metadata, .github/**, README/CONTRIBUTING/ROADMAP/dev, and workspace MCP config. | mcp-server/src/cli.ts; .github/workflows/test.yml; CONTRIBUTING.md | 0 (0 open) |

## design evidence

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 3 | **[B-06](subsystems/b06-report-interface-design-and-validation-studies.md)** | Report interface design and validation studies | 🟢 mapped | design/delightful-output-panel/**; source captures, blind panel records, prototypes, task tests, screenshots, and validation reports used to define and test the human report projection. | design/delightful-output-panel/README.md; design/delightful-output-panel/design-language.md; design/delightful-output-panel/validation/report.md | 0 (0 open) |

## projection

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 2 | **[B-04](subsystems/b04-diff-aware-materializer.md)** | Diff-aware materializer | 🟢 mapped | materializer/**; read-only DB access, page planning/rendering, manifest dependency hashes, xref resolution, and clean documentation output. | materializer/amanuensis_materializer/core.py; materializer/amanuensis_materializer/renderers.py; materializer/test-materializer.py | 0 (0 open) |

## research evidence

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 3 | **[B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md)** | Embedded research surveys and platform trials | 🟢 mapped | scholiast/**; embedded research conspectuses, measurement scripts and JSON outputs, and generated platform trial implementations used to evaluate report presentation and web-platform choices. | scholiast/ai-primary-web-platform-landscape/README.md; scholiast/ai-primary-web-platform-landscape/conspectus.md; scholiast/report-record-presentation/conspectus.md | 1 (1 open) |

## runtime

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 1 | **[B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)** | MCP core, persistence, and lifecycle | 🟢 mapped | mcp-server/src root modules and schema.sql except cli.ts; server bootstrap, SQLite lifecycle/migrations, invariants, sessions, project identity, and storage git. | mcp-server/src/index.ts; mcp-server/src/schema.sql; mcp-server/src/invariants.ts | 1 (0 open) |
| 1 | **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** | Knowledge tools and workflow API | 🟢 mapped | mcp-server/src/tools/**; 75 MCP handlers implementing evidence, findings, files, seams, dispatch, locks, staleness, materialization, and queries. | mcp-server/src/tools/evidence.ts; mcp-server/src/tools/dispositions.ts; mcp-server/src/tools/git.ts | 0 (0 open) |

