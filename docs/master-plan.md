# Master plan

## Coordination

| Priority | ID | Name | Status | Purpose | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|---|
| 2 | **[B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)** | Survey methodology and agent contracts | 🟡 adversarial | Gives an agent the procedure for reading a codebase and writing what it learned into the store: which phase comes next, what each phase owes, and what the server will refuse. The ADRs beside it say why each rule exists, so a later change cannot pass a gate by redefining a word in it. | .claude/skills/amanuensis/** and dev/adr/** — the method the coordinator executes and the decisions it is written against | SKILL.md; references/subsystem-survey.md; references/phase-3-concerns.md; dev/adr/ADR-0001 | 1 (1 open) |

## Delivery

| Priority | ID | Name | Status | Purpose | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|---|
| 3 | **[B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)** | Packaging, installer, validation, and product docs | 🟡 concerns | Makes the tool installable and keeps what is said about it from drifting. It packages the server with its skill and materializer, publishes on a tag, and holds the generators and CI checks that fail when a fact published in two places disagrees. An operator gets something to install; a contributor gets the checks that say a duplicated fact has moved. | mcp-server packaging, checkers, fixtures and test suite; .github/**; .pecia/**; the dev/ harness that is not a lane's; root product artifacts | mcp-server/src/cli.ts; .github/workflows/test.yml; CONTRIBUTING.md; mcp-server/scripts/ | 1 (1 open) |
| 3 | **[B-08](subsystems/b08-activation-evidence-and-release-readiness.md)** | Activation evidence and release readiness | ⚪ unmapped | Not recorded | dev/activation-evidence/** and the activation, Codex-host, friction-free and release-readiness harnesses in dev/ | dev/check-friction-free-release-readiness.mjs; dev/run-codex-host-harness.mjs; dev/activation-evidence/ | 0 (0 open) |

## Design evidence

| Priority | ID | Name | Status | Purpose | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|---|
| 2 | **[B-09](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md)** | Conspectus design lanes, their drivers and receipts | ⚪ unmapped | Not recorded | design/reader-lenses/**, design/survey-depth/**, and the dev/ drivers, gates and receipts those lanes own | design/survey-depth/spec.md; dev/rebuild-self-conspectus-store.mjs; dev/test-survey-depth.mjs | 0 (0 open) |
| 4 | **[B-06](subsystems/b06-report-interface-design-and-validation-studies.md)** | Report interface design and validation studies | ⚪ unmapped | Not recorded | design/delightful-output-panel/** | README.md; design-language.md; validation/report.md | 0 (0 open) |

## Projection

| Priority | ID | Name | Status | Purpose | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|---|
| 2 | **[B-04](subsystems/b04-diff-aware-materializer.md)** | Diff-aware materializer | 🟡 adversarial | Turns the store into the pages a person reads: Markdown and self-contained HTML, generated from the record and then read back against it. A clean publish that fails a render or its read-back leaves the previous pages in place, so what it publishes has passed its checks. | materializer/** and the promoted docs/ it renders | amanuensis_materializer/core.py; renderers.py; readback.py | 6 (6 open) |

## Research evidence

| Priority | ID | Name | Status | Purpose | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|---|
| 4 | **[B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md)** | Embedded research surveys and platform trials | 🟡 concerns | Holds the research behind decisions about how Amanuensis presents a report: three research surveys and the trial corpus one of them produced. A designer reads them to see what was established and what was rejected, with the sources. No server or materializer code reads them at run time. | scholiast/** | ai-primary-web-platform-landscape/README.md; report-record-presentation/conspectus.md | 3 (3 open) |

## Runtime

| Priority | ID | Name | Status | Purpose | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|---|
| 1 | **[B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)** | MCP core, persistence, and lifecycle | 🟡 adversarial | Everything durable depends on this part. It binds one server process to one workspace and one store, opens and upgrades the SQLite database, decides whether a write or a status advance is allowed, and makes a checkpoint of the store recoverable. The tool modules call into it for every rule they share. | mcp-server/src/*.ts and schema.sql — the server root modules, the storage lifecycle, the invariants | mcp-server/src/index.ts; src/db.ts; src/schema.sql; src/invariants.ts | 4 (3 open) |
| 1 | **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** | Knowledge tools and workflow API | 🟡 adversarial | The surface an agent works through: the tools that write evidence, claims, dispositions and findings, refuse a write the record does not support, and serve back what was concluded. It decides what an agent may assert and what a later reader is told about it, which is what lets a session rely on a record it did not write. | mcp-server/src/tools/** — the tool surface a survey writes and reads through | src/tools/evidence.ts; src/tools/dispositions.ts; src/tools/git.ts; src/tools/carried.ts | 6 (6 open) |

