# Findings

## High findings

### [MCP core, persistence, and lifecycle](subsystems/b02-mcp-core-persistence-and-lifecycle.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:47d5c6eae5b99f1bfe21308db51867ae17da48ba25d361eb042149ccdbe0f877 -->
| <a id="b02-1"></a>**B02-1** | verified-fixed | A phase-gate Git commit can omit the database mutations completed in that phase. | SQLite runs in WAL mode, WAL is ignored by storage Git, and commitStorage does not checkpoint the database before staging. | `b8b566f` |

### [Knowledge tools and workflow API](subsystems/b03-knowledge-tools-and-workflow-api.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:a1e44b20bb88cf816e2cf058cfd11b2afa1ca2a248c0d9853eb8b12904881f43 -->
| <a id="b03-1"></a>**B03-1** | open | A subsystem can report status 'mapped' with zero stale entries while an arbitrary fraction of its declared scope has never been classified, and while ledger rows continue to assert that deleted files were examined. | The refresh path never reconciles the file ledger against the working tree. detect_changes inner-joins the commit-range diff against file_ledger, so paths added since the baseline match no row and are silently dropped; no ledger writer enumerates the tree; the scoping-to-structural invariant checks only that at least one ledger row exists; and no classification value or non-destructive tool can retire a row whose file was deleted. | `5694080` |
<!-- amanuensis:finding:9f021cbf58b96ca414b52864a779000d8654574782578f1a0a787ac1f97918d2 -->
| <a id="b03-2"></a>**B03-2** | open | The entire staleness surface is inert. detect_changes reports drift to its caller but persists none of it, get_stale_backlog always returns empty, clear_staleness has nothing to clear, and the dashboard's stale_entries is permanently 0 regardless of how far the conspectus has drifted from HEAD. | All staleness state lives in the entries table, and no server code path ever inserts a row into it. The only INSERT INTO entries in the repository is in materializer/test-readback.py, a test fixture. Every read and update of staleness therefore operates on a permanently empty table. | `5694080` |

### [Packaging, installer, validation, and product docs](subsystems/b05-packaging-installer-validation-and-product-docs.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:12cbd57d87e0a1b81b7e15720e21a6900c7c87978c1699bcd48440da44a33ade -->
| <a id="b05-1"></a>**B05-1** | verified-fixed | The roadmap and the A26 receipt both assert v0.2.0-beta.1 is an unpublished candidate, while the package is published on npm holding the latest dist-tag. The publication gate cannot detect the discrepancy because nothing checks the registry or the tag. | render-roadmap.mjs validates delivery.release only for internal consistency — field shapes, and agreement between roadmap.json and the A26 receipt. It never queries the registry, the git tag, or the publish workflow run. A release that has actually been published therefore satisfies every candidate assertion, including publicationStatus 'not-published', indefinitely. | `5694080` |

## Medium findings

### [MCP core, persistence, and lifecycle](subsystems/b02-mcp-core-persistence-and-lifecycle.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:5b8a8674582a5618d24e7cfc7c5784abd9ce3abf2e609ff6c2a6f5861b46da9d -->
| <a id="b02-2"></a>**B02-2** | open | A stalled ps or git subprocess during server startup hangs the MCP server indefinitely with no timeout, no diagnosis, and no usable state. | Every subprocess on the startup and project-binding path is synchronous and unbounded: discoverCodexParentWorkspace runs ps via execFileSync, and project binding runs six git invocations via execSync, execFileSync, and spawnSync. None passes a timeout option, and execFileSync blocks the Node event loop for the call's full duration. The error handler in codex-host.ts returns null only for errors carrying an errno code, so a hang — which raises nothing — is not covered. | `5694080` |

### [Knowledge tools and workflow API](subsystems/b03-knowledge-tools-and-workflow-api.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:a2dada7a319ab8eeb4c655c2ec2365f734c38d3fabb937c8c4ce813892dbb61f -->
| <a id="b03-3"></a>**B03-3** | open | A disposition whose strongest supporting evidence is test-observed, config-asserted, or doc-asserted cannot record that quality; set_disposition rejects the value, forcing the agent to overstate it as code-verified or understate it as contract-stated. | The EVIDENCE_QUALITY enum in tools/dispositions.ts lists five values while the KINDS enum in tools/evidence.ts lists nine, and the [B-01](subsystems/b01-survey-methodology-and-agent-contracts.md) methodology contract publishes an eight-rung ladder as the authoritative evidence-quality scale. The two vocabularies were allowed to diverge, and nothing checks them against each other or against the published contract. | `5694080` |

### [Diff-aware materializer](subsystems/b04-diff-aware-materializer.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:706a0f871ac7b99e4357cc4264ec047e37a7ea55f63e3addee9fdd32523704b4 -->
| <a id="b04-1"></a>**B04-1** | verified-fixed | The published conspectus states 'No stale entries — the conspectus is fresh.' in both the HTML reading surface and its Markdown companion, regardless of how far behind HEAD the survey actually is. | diagrams.py:staleness_map renders an empty query result as an affirmative freshness claim. Its source, the entries table, is never populated by the server (see **B03-2**), so the empty branch is the only branch that ever executes — but the deeper defect is that the empty case is reported as positive health rather than as absent data. | `5694080` |

## Low findings

### [Embedded research surveys and platform trials](subsystems/b07-embedded-research-surveys-and-platform-trials.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:5b90b53ec0f81ef847766380b42be22e6c08d6dca7946efc2439fe965de77143 -->
| <a id="b07-1"></a>**B07-1** | open | A research refresh or snapshot verification can hang indefinitely when GitHub, npm, the shadcn CLI, or a child detector stalls. | The affected fetch(), spawnSync(), and subprocess.check_output() calls provide no timeout, abort signal, or cancellation path. | `073cee86` |

