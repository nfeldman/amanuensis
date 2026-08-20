# Setup — connect Amanuensis to an MCP-capable coding agent

Amanuensis has two portable parts:

- `amanuensis-memory`, a local stdio MCP server that owns persistent state;
- the `amanuensis` Agent Skill, which teaches an agent how to use the tools as
  a survey, review, design, and refresh workflow.

MCP standardizes the server protocol, but clients still discover project
servers and skills from different files. Use the installer adapter for the
runtime that will operate on the target project:

```bash
amanuensis init --client claude   # Claude Code
amanuensis init --client codex    # Codex CLI, app, or IDE extension
amanuensis init --client vscode   # VS Code / GitHub Copilot
amanuensis init --client generic  # any other local MCP host
```

Run `--dry-run` first when installing into a project with existing agent or MCP
configuration. The installer preserves unrelated configuration and JSONC
comments, refuses conflicts, and writes timestamped backups before `--force`
replacements. It also archives obsolete Amanuensis `.agent.md` files left by
the pre-portable VS Code installer so they cannot compete with the skill.

## What each adapter writes

| Client | MCP configuration | Skill location |
|---|---|---|
| Claude Code | `.mcp.json` (`mcpServers`) | `.claude/skills/amanuensis/` |
| Codex | `.codex/config.toml` (`mcp_servers`) | `.agents/skills/amanuensis/` |
| VS Code | `.vscode/mcp.json` (`servers`) | `.agents/skills/amanuensis/` |
| Generic | host-specific | `.agents/skills/amanuensis/` |

The generic adapter prints the stdio command and required
`AMANUENSIS_AUTOPROGRESS=1` environment setting to register. Asking the agent
to run full onboarding assumes the host loads Agent Skills or that you provide
equivalent workflow instructions. A host without that facility can still call
every MCP tool and receives concise server initialization instructions, but it
does not automatically receive the full method.

Client-native activation still applies: Claude Code may ask you to approve a
project-scoped MCP server, and Codex reads project `.codex/config.toml` only
for trusted projects. Reload the client after changing its configuration.
These are host security/discovery rules, not Amanuensis workflow review gates.

## Direct server registration

An MCP host can launch Amanuensis directly:

```text
command: amanuensis-memory
args: ["--workspace", "/absolute/path/to/project"]
env: {"AMANUENSIS_AUTOPROGRESS": "1"}
transport: stdio
```

The server also accepts `AMANUENSIS_WORKSPACE`; Claude Code supplies
`CLAUDE_PROJECT_DIR`, and an explicit `--workspace` takes precedence over both.
The Codex adapter sets `cwd = "."`; the server resolves the Git root containing
that working directory, which also keeps nested Codex launches on the project
root. For a non-Git workspace, start Codex at the intended project root or add
an explicit `--workspace` path to its server `args`.

`AMANUENSIS_AUTOPROGRESS=1` enables unattended progress and durable open
questions. Set it to `0` only when deliberately testing strict-interactive
behavior.

## Local development

To run the in-tree server instead of the installed package, install `mise` and
use the repository pins (Node.js 24 and Python 3.12). The supported package
floors are Node.js 20 and Python 3.11; set `AMANUENSIS_PYTHON` to select a
different compatible Python interpreter.

```bash
mise install
mise exec -- npm --prefix mcp-server ci
mise exec -- npm --prefix mcp-server run build
mise exec -- node mcp-server/dist/cli.js init --client claude --dir /path/to/project
```

Use the appropriate `--client` value. In a source checkout the installer writes
the absolute pinned Node executable and in-tree `dist/index.js` path, so a GUI
host does not depend on the shell that ran `mise`. An installed npm package uses
the `amanuensis-memory` bin instead.

## Verifying the connection

After starting or reloading the client, call:

```text
get_project_info
```

A successful result includes `project_key`, `workspace_path`, and `db_exists`.
Then call `get_autoprogress_mode` and confirm it matches the intended mode. If
the tools are absent, the client did not load the server configuration; if the
tools are present but the workspace path is wrong, fix the registration before
writing survey state.

Persistent state lives at `<project>/.amanuensis/`: the SQLite database,
materialized prose, projection manifests, and an independent storage Git
history. Amanuensis adds this path to the source repository's local
`.git/info/exclude`; the survey also excludes it from evidence collection.
Verified compatible home-directory storage is migrated on first use. State
whose project identity cannot be verified is preserved in place and reported,
not adopted or merged. Set
`AMANUENSIS_STORAGE_ROOT` only when deliberately using a shared external
conspectus repository. Shared keys include the normalized Git host and full
namespace, and a stored project identity must agree before a clone can reuse
state. If legacy and configured locations contain different state, Amanuensis
preserves both and prints the path that still needs deliberate reconciliation.
