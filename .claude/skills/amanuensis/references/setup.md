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
amanuensis init --client codex --scope user  # Codex CLI, app, or IDE extension
amanuensis init --client vscode   # VS Code / GitHub Copilot
amanuensis init --client generic  # any other local MCP host
```

Run `--dry-run` first when installing with existing agent or MCP
configuration. The installer preserves unrelated configuration and JSONC
comments, refuses conflicts, and writes timestamped backups before configuration
replacements. It does not archive superseded skill copies. It also archives
obsolete Amanuensis `.agent.md` files left by
the pre-portable VS Code installer so they cannot compete with the skill.

## What each adapter writes

| Client | MCP configuration | Skill location |
|---|---|---|
| Claude Code | `.mcp.json` (`mcpServers`) | `.claude/skills/amanuensis/` |
| Codex user (default) | `$CODEX_HOME/config.toml` (`mcp_servers`) | `$CODEX_HOME/skills/amanuensis/` |
| Codex project pin | `.codex/config.toml` (`mcp_servers`) | `.agents/skills/amanuensis/` |
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
for trusted projects. Restart Codex once after changing its user-scoped
registration. New repositories require no Amanuensis-specific restart.
These are host security/discovery rules, not Amanuensis workflow review gates.

The default Codex registration contains no target repository path. It launches
the stdio server with `cwd = "."`; the server resolves and binds the Git root
containing that process cwd. A deliberate project pin is explicit:

```bash
amanuensis init --client codex --scope project --dir /path/to/project
```

The pin carries an explicit workspace and activation-contract marker. A stale,
unmarked cross-repository `--workspace` launch halts before project state is
opened. This is repository binding and write containment, not an OS sandbox;
Codex trust, approvals, and filesystem permissions remain authoritative.

## Direct server registration

An MCP host can launch Amanuensis directly:

```text
command: amanuensis-memory
args: ["--workspace", "/absolute/path/to/project"]
env: {"AMANUENSIS_AUTOPROGRESS": "1"}
transport: stdio
```

When that explicit workspace may differ from the launcher process cwd, add
`--allow-workspace-pin`; this opt-in is what distinguishes a deliberate direct
pin from a stale hard-coded registration. The server also accepts
`AMANUENSIS_WORKSPACE`; Claude Code supplies
`CLAUDE_PROJECT_DIR`, and an explicit `--workspace` takes precedence over both.
For a non-Git workspace, use an explicit project pin; zero-touch user-scoped
activation currently covers trusted Git repositories.

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
mise exec -- node mcp-server/dist/cli.js init \
  --client codex --scope user --mcp-only --dry-run
mise exec -- node mcp-server/dist/cli.js init \
  --client codex --scope user --mcp-only
```

Use the appropriate `--client` value. In a source checkout the installer writes
the absolute pinned Node executable and in-tree `dist/index.js` path, so a GUI
host does not depend on the shell that ran `mise`. An installed npm package uses
the `amanuensis-memory` bin instead.

### Live global skill, versioned published skill

For local Amanuensis development, keep one canonical skill and link each real
global loader to the whole skill directory:

- Codex: `$CODEX_HOME/skills/amanuensis` → the checkout's
  `.claude/skills/amanuensis` directory. Codex silently omits a skill when only
  `SKILL.md` is linked, so the directory-level link is required.
- Claude Code and Copilot: `~/.claude/skills/amanuensis` → the same canonical
  directory.

Do not leave a copied project skill at `.agents/skills/amanuensis` in a Codex
development project: it shadows the global link and freezes that project on
the copied version. Configure Codex's live source MCP launcher once at user
scope with the preceding `--mcp-only` commands. Claude Code and VS Code remain
project adapters:

```bash
mise exec -- node mcp-server/dist/cli.js init \
  --client <claude|vscode> --dir /path/to/project --mcp-only
mise exec -- node mcp-server/dist/cli.js init \
  --client codex --scope project --dir /path/to/project --mcp-only
```

The second Codex command is only for a deliberate repository pin. Restart
Codex once after changing its user MCP registration. A task that already loaded
a skill retains that task's instructions; new tasks read through the global
link. Published package installation continues to use ordinary `init`, which
copies the versioned bundled skill into the selected user or project scope.

## Verifying the connection

After starting or reloading the client, call:

```text
get_project_info
```

A successful result includes `project_key`, `workspace_path`, and `db_exists`.
It also includes an immutable `binding_receipt` with the canonical root,
workspace-instance ID, repository identity, storage path/policy, selection
source, server-instance ID, server version, and binding ID. The server revalidates that binding and
its symlink-free storage tree before every tool call. Then call
`get_autoprogress_mode` and confirm it matches the intended mode. If
the tools are absent, the client did not load the server configuration; if the
tools are present but the workspace path is wrong, fix the registration before
writing survey state.

Before restarting a stale or conflicted Codex setup, inspect it without writes:

```bash
amanuensis doctor --client codex --dir /path/to/project --json
amanuensis doctor --client codex --dir /path/to/project \
  --repair --dry-run --json
```

The second command exits non-zero while faults remain but returns a
`repairPlanId`. Apply that exact digest with `--repair --apply-plan <PLAN_ID>
--json`. A changed config or skill invalidates the plan. Repair backs up each
configuration it changes, migrates only the Amanuensis user entry, and removes
a project shadow only when it is installer-managed and the skill is an exact
packaged copy. Restart Codex afterward and read back `get_project_info` in a new
task; file inspection cannot establish what an already-running host loaded.

Default state is worktree-local: two worktrees of one repository have the same
logical repository identity but different workspace-instance IDs and storage
paths. `AMANUENSIS_STORAGE_ROOT` deliberately changes custody to
shared-by-repository-identity; avoid it for concurrent worktrees that need
isolated state. File-producing tools accept only destinations inside the bound
store. These checks are repository binding and write containment, not an OS
sandbox, and MCP side-effect annotations remain hints to the host.

When using `codex exec --cd <repository>` or `-C`, Codex leaves the MCP child
at the launcher cwd. The user-scope adapter recovers the exact `--cd` argument
from its direct Codex parent and the receipt reports
`parent-codex-cli-cd-git-root`; no per-project registration is required.

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
