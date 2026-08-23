# Findings

## High findings

### [MCP core, persistence, and lifecycle](subsystems/b02-mcp-core-persistence-and-lifecycle.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:47d5c6eae5b99f1bfe21308db51867ae17da48ba25d361eb042149ccdbe0f877 -->
| <a id="b02-1"></a>**B02-1** | verified-fixed | A phase-gate Git commit can omit the database mutations completed in that phase. | SQLite runs in WAL mode, WAL is ignored by storage Git, and commitStorage does not checkpoint the database before staging. | `b8b566f` |

## Low findings

### [Embedded research surveys and platform trials](subsystems/b07-embedded-research-surveys-and-platform-trials.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:5b90b53ec0f81ef847766380b42be22e6c08d6dca7946efc2439fe965de77143 -->
| <a id="b07-1"></a>**B07-1** | open | A research refresh or snapshot verification can hang indefinitely when GitHub, npm, the shadcn CLI, or a child detector stalls. | The affected fetch(), spawnSync(), and subprocess.check_output() calls provide no timeout, abort signal, or cancellation path. | `073cee86` |

