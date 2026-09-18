# Master plan

## Coordination

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 2 | **[B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)** | Survey methodology and agent contracts | 🟡 adversarial | .claude/skills/amanuensis/** and dev/adr/** — the method the coordinator executes and the decisions it is written against | SKILL.md; references/subsystem-survey.md; references/phase-3-concerns.md; dev/adr/ADR-0001 | 0 (0 open) |

## Delivery

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 3 | **[B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)** | Packaging, installer, validation, and product docs | 🟡 concerns | mcp-server packaging, checkers, fixtures and test suite; .github/**; .pecia/**; the dev/ harness that is not a lane's; root product artifacts | mcp-server/src/cli.ts; .github/workflows/test.yml; CONTRIBUTING.md; mcp-server/scripts/ | 1 (1 open) |
| 3 | **[B-08](subsystems/b08-activation-evidence-and-release-readiness.md)** | Activation evidence and release readiness | ⚪ unmapped | dev/activation-evidence/** and the activation, Codex-host, friction-free and release-readiness harnesses in dev/ | dev/check-friction-free-release-readiness.mjs; dev/run-codex-host-harness.mjs; dev/activation-evidence/ | 0 (0 open) |

## Design evidence

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 2 | **[B-09](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md)** | Conspectus design lanes, their drivers and receipts | ⚪ unmapped | design/reader-lenses/**, design/survey-depth/**, and the dev/ drivers, gates and receipts those lanes own | design/survey-depth/spec.md; dev/rebuild-self-conspectus-store.mjs; dev/test-survey-depth.mjs | 0 (0 open) |
| 4 | **[B-06](subsystems/b06-report-interface-design-and-validation-studies.md)** | Report interface design and validation studies | ⚪ unmapped | design/delightful-output-panel/** | README.md; design-language.md; validation/report.md | 0 (0 open) |

## Projection

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 2 | **[B-04](subsystems/b04-diff-aware-materializer.md)** | Diff-aware materializer | 🟡 adversarial | materializer/** and the promoted docs/ it renders | amanuensis_materializer/core.py; renderers.py; readback.py | 2 (2 open) |

## Research evidence

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 4 | **[B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md)** | Embedded research surveys and platform trials | 🟡 concerns | scholiast/** | ai-primary-web-platform-landscape/README.md; report-record-presentation/conspectus.md | 1 (1 open) |

## Runtime

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 1 | **[B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)** | MCP core, persistence, and lifecycle | 🟡 adversarial | mcp-server/src/*.ts and schema.sql — the server root modules, the storage lifecycle, the invariants | mcp-server/src/index.ts; src/db.ts; src/schema.sql; src/invariants.ts | 2 (2 open) |
| 1 | **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** | Knowledge tools and workflow API | 🟡 adversarial | mcp-server/src/tools/** — the tool surface a survey writes and reads through | src/tools/evidence.ts; src/tools/dispositions.ts; src/tools/git.ts; src/tools/carried.ts | 4 (4 open) |

