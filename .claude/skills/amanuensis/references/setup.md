# Setup — how Claude Code discovers Amanuensis

Amanuensis's persistent state lives in an MCP server
(`amanuensis-memory`) plus a git-backed workspace under
`~/.amanuensis/workspaces/<owner>/<project>/`. The methodology is
unworkable without the server, so this file documents the wiring.

## What Claude Code reads

Project-level MCP servers are declared in `.mcp.json` at the project
root. The repo ships one — see `/.mcp.json` from the workspace root.

## Two ways to point at the server

All variants set `AMANUENSIS_AUTOPROGRESS=1` by default — this is what
turns on `record_open_question` and `get_autoprogress_mode()`, which
the skill uses to run autonomously rather than pausing at every
phase boundary. To force strict-interactive (gate at every phase),
remove the env block.

### Option A — installed via npm (recommended)

If the package is globally installed (`npm i -g @gruetech/amanuensis`),
the `amanuensis-memory` binary is on PATH and `.mcp.json` can call it
directly:

```json
{
  "mcpServers": {
    "amanuensis-memory": {
      "type": "stdio",
      "command": "amanuensis-memory",
      "args": ["--workspace", "${workspaceFolder}"],
      "env": { "AMANUENSIS_AUTOPROGRESS": "1" }
    }
  }
}
```

### Option B — local development against this repo

If you're working on this repo itself and want Claude Code to run the
in-tree TypeScript build:

```json
{
  "mcpServers": {
    "amanuensis-memory": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/mcp-server/dist/index.js",
        "--workspace",
        "${workspaceFolder}"
      ],
      "env": { "AMANUENSIS_AUTOPROGRESS": "1" }
    }
  }
}
```

Run `npm --prefix mcp-server run build` first so `dist/` exists.

### Strict-interactive mode (opt-in)

Drop the `env` block (or set `AMANUENSIS_AUTOPROGRESS=0`) to pause at
every phase boundary. `record_open_question` becomes unavailable in
this mode; onboarding Phase 6 and per-subsystem phase transitions
block waiting for human input. Pick this if you want a tight
collaboration loop on a single subsystem and don't trust the autopilot
yet.

## Workspace layout the server expects

```
~/.amanuensis/workspaces/<owner>/<project>/
  memory.db                  # the SQLite DB (WAL mode)
  *.md                       # prose artifacts (onboarding-report,
                             # concern-checklist, master-plan,
                             # findings-index, entry-point,
                             # field-notes, <subsystem>-survey.md ...)
  docs/                      # materialized navigable docs
  docs/.manifest.json        # per-page source-hash manifest
  .git/                      # storage history (init on first open)
```

The directory is initialized as a git repo on first open. Every
`end_session` auto-commits; agents can call `commit_phase_gate` at any
phase boundary. If the git binary isn't available or init fails, the
server still runs — history is a nice-to-have, not load-bearing.

## Headless runs

For unattended runs (GitHub Actions, Claude Code in
`--dangerously-skip-permissions` mode, etc.), the same `.mcp.json` works
as long as `AMANUENSIS_AUTOPROGRESS=1` is set (the default above). The
CI environment may launch the server directly instead of via Claude
Code; either way:

```
AMANUENSIS_AUTOPROGRESS=1 amanuensis-memory --workspace <repo>
```

See `open-questions.md` for the headless preflight and the
end-of-run report format.

## Verifying connection

Once Claude Code starts and the skill triggers, the first MCP call
should succeed:

```
get_project_info  →  { project_key, workspace_path, db_exists, ... }
```

If MCP tools aren't visible at all, the server isn't connected — check
`.mcp.json`, restart Claude Code, and re-verify.
