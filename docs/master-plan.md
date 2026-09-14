# Master plan

## api

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 1 | **[B-04](subsystems/b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)** | Reader lenses: standing, locus account, claims, edges, vocabulary | 🟢 mapped | mcp-server/src/standing.ts, vocabulary.ts, tools/locus.ts, tools/claims.ts, tools/xrefs.ts, tools/vocabulary.ts, contracts/locus-account.schema.json, contracts/locus-history.schema.json, contracts/attention.schema.json, contracts/conspectus-vocabulary.json | contracts/conspectus-vocabulary.json for the single enum source, then src/standing.ts for the state predicate, then tools/locus.ts (3607 lines) for describe_locus / get_attention / get_history. | 4 (4 open) |
| 2 | **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** | Knowledge tools and workflow API | 🟢 mapped | mcp-server/src/tools/ — every handler module except locus.ts, claims.ts, xrefs.ts and vocabulary.ts (which are [B-04](subsystems/b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)): subsystems, files, evidence, dispositions, findings, resolution, concerns, contradictions, diagnosticity, field-notes, open-questions, seams, stale, impact, refresh, review, review-analysis, review-session, composition, codebase-brief, design-session, decisions, research, crosswalk, learning, evaluation, chorusmith-adapter, revalidation, compare, dashboard, artifacts, git, locks, logging, dispatch, project, storage-history, materialize. | tools/evidence.ts and tools/dispositions.ts — the evidence anchor is the methodology's load-bearing constraint; then tools/findings.ts and tools/resolution.ts for the resolution chain, then tools/subsystems.ts for the knowledge-depth gates. | 2 (2 open) |

## core

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 1 | **[B-02](subsystems/b02-server-core-repository-binding-storage-schema-lifecycle.md)** | Server core: repository binding, storage, schema, lifecycle | 🟢 mapped | mcp-server/src/index.ts, db.ts, project.ts, session.ts, helpers.ts, invariants.ts, storage-git.ts, schema.sql | mcp-server/src/index.ts — the tool registry and dispatch loop; then project.ts for how a workspace becomes a bound store, then db.ts for the lazy open. | 4 (4 open) |

## distribution

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 3 | **[B-06](subsystems/b06-packaging-installer-and-host-activation.md)** | Packaging, installer, and host activation | 🟢 mapped | mcp-server/src/cli.ts, mcp-server/src/codex-host.ts, mcp-server/scripts/ (prepack-bundle-assets.mjs, ensure-built.mjs, gen-tool-inventory.mjs, gen-vocabulary.mjs, check-*.mjs, historical-evaluation.mjs), mcp-server/package.json, mcp-server/contracts/activation-parity.schema.json, mcp-server/fixtures/activation/ | mcp-server/src/cli.ts — install, doctor, repair, upgrade, rollback, uninstall for each client adapter; then codex-host.ts for parent-workspace discovery. | 0 (0 open) |

## methodology

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 4 | **[B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)** | Survey methodology and agent contracts | 🟢 mapped | .claude/skills/amanuensis/SKILL.md and .claude/skills/amanuensis/references/ (onboarding, subsystem-survey, phase-1 through phase-5, notes, memory-audit, refresh, open-questions, concern-territories, artifact-templates, reporting-style, setup) | SKILL.md — the routing table and the authorized-claims ladder; then references/subsystem-survey.md for the five-phase loop the ladder gates. | 1 (1 open) |

## projection

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 2 | **[B-05](subsystems/b05-materializer-human-projection-read-back-html.md)** | Materializer: human projection, read-back, HTML | 🟢 mapped | materializer/materialize.py and materializer/amanuensis_materializer/ (core.py, db.py, renderers.py, html_projection.py, readback.py, manifest.py, diagrams.py, lint.py, slugs.py, vocabulary.py, xref.py) | materializer/amanuensis_materializer/core.py — the publish orchestration and the clean-publish contract; then readback.py for the three verification axes, then renderers.py / html_projection.py for the page set. | 1 (1 open) |

## records

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 5 | **[B-08](subsystems/b08-records-design-research-published-projection-execution-ledger.md)** | Records: design, research, published projection, execution ledger | 🟢 mapped | design/ (reader-lenses, delightful-output-panel), scholiast/, dev/adr/, dev/roadmap.json and ROADMAP.md, docs/ (the checked-in projection), .pecia/ and dev/pecia-*.mjs, README.md, HISTORY.md, INSTALLATION.md, CONTRIBUTING.md | design/reader-lenses/spec.md — the most recent design record and the one the merged work implements; then .pecia/work.jsonl with dev/pecia-resolve-finding.mjs for how execution custody refers back to the conspectus. | 0 (0 open) |

## validation

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 3 | **[B-07](subsystems/b07-gates-evidence-custody-and-ci.md)** | Gates, evidence custody, and CI | 🟢 mapped | dev/ (test-*.mjs gates, render-*.mjs and check-*.mjs projections, run-*.mjs harnesses, record-*.mjs receipt writers, conspectus/ A0 fixtures, activation-evidence/ receipts, hooks/pre-commit), mcp-server/test-*.mjs, materializer/test-*.py, .github/workflows/ | .github/workflows/test.yml for what actually runs, then dev/test-rebuild-coverage.mjs and dev/test-reader-lenses-dogfood.mjs as the shape every recent gate follows (two arms, a named red condition, and a declared false green). | 2 (2 open) |

