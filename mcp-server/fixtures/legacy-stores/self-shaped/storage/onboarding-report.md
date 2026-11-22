# Onboarding report

**Codebase**: Scribe — a survey server and the pages it publishes
**Date**: 2026-09-12
**Onboarding SHA**: d395c4d5a9e1f0b2c3d4e5f60718293a4b5c6d7e

## Runtime boundary map

| Runtime / Process | Language | Communicates with | Mechanism | Notes |
|---|---|---|---|---|
| MCP server | TypeScript | Agent host | stdio JSON-RPC | One process per session. |
| MCP server | TypeScript | Materializer | Subprocess | Spawned per publish. |
