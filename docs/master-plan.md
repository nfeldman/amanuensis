# Master plan

## corpus

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 5 | **[B-12](subsystems/b12-vendored-research-corpus.md)** | Vendored research corpus | ⚫ deferred | scholiast/** — a checked-in Scholiast survey of the AI-primary web platform landscape: prose, claim tables, and two capture scripts that were run once to produce them. | scholiast/ai-primary-web-platform-landscape/conspectus.md | 0 (0 open) |

## harness

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 4 | **[B-11](subsystems/b11-development-harness-and-gates.md)** | Development harness and gates | 🟢 mapped | dev/*.mjs, mcp-server/scripts/*.mjs, mcp-server/test-*.mjs, materializer/test-*.py, .github/workflows/test.yml — the red-provable gates, the generated-artifact checkers, and the CI job list that runs them. | .github/workflows/test.yml, then dev/check-living-conspectus.mjs | 2 (2 open) |

## materializer

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 3 | **[B-08](subsystems/b08-materializer-rendering-pipeline.md)** | Materializer rendering pipeline | 🟢 mapped | materializer/amanuensis_materializer/{core,renderers,html_projection,diagrams,slugs,xref,vocabulary,lint}.py and materializer/materialize.py — the read-only projection of the store into Markdown pages and a self-contained HTML index. | materializer/amanuensis_materializer/core.py, then materializer/amanuensis_materializer/renderers.py | 1 (1 open) |
| 3 | **[B-09](subsystems/b09-projection-read-back-and-publication-custody.md)** | Projection read-back and publication custody | 🟢 mapped | materializer/amanuensis_materializer/{readback,manifest,db}.py and mcp-server/src/tools/materialize.ts — the three read-back axes, the projection contract, the manifest, and the tool that stages a publish into project storage. | materializer/amanuensis_materializer/readback.py, then mcp-server/src/tools/materialize.ts | 0 (0 open) |

## mcp-server

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 1 | **[B-01](subsystems/b01-server-runtime-and-tool-dispatch.md)** | Server runtime and tool dispatch | 🟢 mapped | mcp-server/src/index.ts, mcp-server/src/helpers.ts, mcp-server/src/session.ts — the stdio MCP server, the tool table it registers, the shared argument validators every tool handler calls, and session lifecycle. | mcp-server/src/index.ts, then mcp-server/src/helpers.ts | 1 (1 open) |
| 1 | **[B-02](subsystems/b02-repository-binding-and-storage-custody.md)** | Repository binding and storage custody | 🟢 mapped | mcp-server/src/project.ts, mcp-server/src/db.ts, mcp-server/src/storage-git.ts, mcp-server/src/codex-host.ts — workspace selection, the immutable binding receipt, storage path containment, the SQLite handle, and the storage directory's own git repository. | mcp-server/src/project.ts, then mcp-server/src/db.ts | 0 (0 open) |
| 1 | **[B-03](subsystems/b03-conspectus-schema-vocabulary-and-invariants.md)** | Conspectus schema, vocabulary, and invariants | 🟢 mapped | mcp-server/src/schema.sql, mcp-server/src/vocabulary.ts, mcp-server/src/invariants.ts, mcp-server/contracts/conspectus-vocabulary.json — the tables and views, the single enum source and its generated modules, and the phase prerequisites that gate every status advance. | mcp-server/src/schema.sql, then mcp-server/src/invariants.ts | 1 (1 open) |
| 2 | **[B-04](subsystems/b04-survey-record-tools.md)** | Survey record tools | 🟢 mapped | mcp-server/src/tools/{subsystems,files,evidence,claims,xrefs,seams,vocabulary,artifacts}.ts — the writes a survey makes: the master plan, the file ledger, structured evidence, revision-bound claims, crossing edges, seams, terms, and prose artifacts. | mcp-server/src/tools/claims.ts, then mcp-server/src/tools/xrefs.ts | 2 (2 open) |
| 2 | **[B-05](subsystems/b05-findings-dispositions-and-resolution-custody.md)** | Findings, dispositions, and resolution custody | 🟢 mapped | mcp-server/src/tools/{findings,resolution,dispositions,concerns,contradictions}.ts — concern dispositions, findings and their severity, the append-only resolution event spine, and the current-state views read from it. | mcp-server/src/tools/findings.ts, then mcp-server/src/tools/resolution.ts | 1 (1 open) |
| 2 | **[B-06](subsystems/b06-locus-standing-and-the-reader-lenses.md)** | Locus standing and the reader lenses | 🟢 mapped | mcp-server/src/standing.ts, mcp-server/src/tools/locus.ts — describe_locus, the standing ladder and its authorization text, the compactness budget and omission ledger, and get_attention / get_history. | mcp-server/src/standing.ts, then mcp-server/src/tools/locus.ts | 0 (0 open) |
| 3 | **[B-07](subsystems/b07-git-state-staleness-and-refresh.md)** | Git state, staleness, and refresh | 🟢 mapped | mcp-server/src/tools/{git,stale,refresh,impact}.ts — detect_changes against the recorded baseline, the stale reasons written into the file ledger, unattended refresh runs, and change-impact prediction. | mcp-server/src/tools/git.ts, then mcp-server/src/tools/stale.ts | 1 (1 open) |

## methodology

| Priority | ID | Name | Status | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|
| 4 | **[B-10](subsystems/b10-the-amanuensis-skill.md)** | The Amanuensis skill | 🟢 mapped | .claude/skills/amanuensis/SKILL.md and .claude/skills/amanuensis/references/*.md — the phased survey methodology the coordinator executes, its routing table, and the per-phase instructions that decide which tools are called and in what order. | .claude/skills/amanuensis/SKILL.md, then .claude/skills/amanuensis/references/phase-2-structural.md | 1 (1 open) |

