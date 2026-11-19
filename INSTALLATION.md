# Installation and operations

This is the reference for installing, checking, upgrading, and removing Amanuensis.
For what Amanuensis is, start with the [README](README.md).

## Requirements

- Node.js 20 or newer.
- At least one coding agent: Codex, Claude Code, GitHub Copilot (the Copilot CLI or
  VS Code), or another local MCP host.
- Python 3.11 or newer, only to publish the human-readable map. It uses the standard
  library alone. Set `AMANUENSIS_PYTHON` when `python3` is not the interpreter to use.

## Install

```bash
npm install -g @gruetech/amanuensis
amanuensis install
amanuensis status
```

`amanuensis install` looks for each supported agent and sets up every one it finds.
An agent counts as found when its configuration directory exists or its command is
on `PATH`. For Copilot, VS Code's own user directory also counts, since its `code`
command is optional:

| Agent | Found by | Registration | Skill |
|---|---|---|---|
| Codex | `$CODEX_HOME` or `~/.codex`; `codex` | `$CODEX_HOME/config.toml` | `$CODEX_HOME/skills/amanuensis/` |
| Claude Code | `$CLAUDE_CONFIG_DIR` or `~/.claude`; `claude` | `~/.claude.json` | `~/.claude/skills/amanuensis/` |
| GitHub Copilot CLI and VS Code | `$COPILOT_HOME` or `~/.copilot`; `copilot` or `code` | `~/.copilot/mcp-config.json` | `~/.copilot/skills/amanuensis/` |

When `CLAUDE_CONFIG_DIR` is set, Claude Code's registration and skill live inside it.
When `COPILOT_HOME` is set, Copilot's do. VS Code's Copilot reads the same
`~/.copilot` registration and skills as the Copilot CLI, so one entry serves both.

To choose the agents yourself, name them: `amanuensis install --client claude,copilot`.
This also installs for an agent the search did not find. Add `--dry-run` to any
command to print every change without making it.

Each registration is user-level and names no repository, so one installation covers
every repository. Restart each agent once afterwards. A session that was already
running, including the one that ran the installation, does not see the new server.

### What the installer changes

- It adds one `amanuensis-memory` server entry to each agent's configuration and
  copies the `amanuensis` skill into each agent's skills directory. Every other
  entry and setting is preserved.
- Each entry names, by absolute path, the Node.js that ran the installer and the
  package's own server file. An agent started from a desktop app does not see your
  shell's `PATH`, so it starts the same server, on the same Node.js the database
  module was built for, as `amanuensis status` checks.
- Before it rewrites a configuration file, it saves a timestamped copy beside it
  (`config.toml.bak.<time>`, `.claude.json.bak.<time>`, `mcp-config.json.bak.<time>`).
- It writes nothing into any repository.
- Running it again changes nothing when everything is current.

Before writing anything, the installer checks every agent. It stops with a conflict,
and writes nothing for any agent, when it finds an `amanuensis-memory` entry it did
not write, a skill file that differs from the package, or a file or directory the
user cannot write. `--force` replaces the entries and skill files; configuration
files are backed up first, replaced skill files are not. A skill directory that is a
symbolic link, such as a contributor's link to a source checkout, is reported and
left as it is.

A configuration file is re-read at the moment it is changed, and the new version
replaces it in one rename. A setting another program wrote after the installer
started, such as Claude Code's own state in `~/.claude.json`, is kept, and no reader
ever sees a half-written file. A configuration path that is a symbolic link is
refused.

Host rules still apply. Codex loads the server only in projects you have trusted.
Each agent's own approvals and filesystem permissions remain the security boundary.

## Check the installation

```bash
amanuensis status
amanuensis status --json
```

`status` lists each agent as installed, not installed, or not found on this machine.
It exits with code 0 when at least one agent is set up and every agent it found is
set up, and it names the command that fixes anything else. Its JSON form reports, for
each agent:

- `registration`: `installed`, `outdated` (an older Amanuensis entry), `absent`,
  `unmanaged` (an entry the installer did not write), or `unreadable`
- `skill`: `installed`, `outdated`, `absent`, `linked` (a symbolic link left in
  place), or `broken` (a link with no `SKILL.md` behind it)

It also reports whether the server launcher the registrations name can be found,
whether the native database module (`better-sqlite3`) loads, and the Node.js and
Python versions. npm 11 warns that `better-sqlite3` has install scripts; the
warning is expected, and `status` shows whether the module was built.

Inside an agent, the `get_project_info` tool confirms that the server loaded and
names the repository it bound.

## First use

Open a Git repository in any installed agent and ask it to **run Amanuensis
onboarding**. Opening a repository, listing tools, and calling `get_project_info`
change nothing. The first tool call that needs the database creates the repository's
`.amanuensis/` store.

## Upgrade, roll back, and uninstall

```bash
npm install -g @gruetech/amanuensis@latest
amanuensis upgrade
```

`upgrade` updates every agent that already has an Amanuensis installation, or the
agents named with `--client`. It replaces the skill with the package's copy, including
removing files a newer release no longer ships. Restart the agents afterwards.

After switching to another Node.js version, install the package again under it and
run `amanuensis upgrade`. Version managers such as nvm, fnm, and mise keep global
packages per Node.js version, so the `amanuensis` command is missing under the new
one until then. The agents keep starting the server with the Node.js they were
registered with for as long as that version stays installed, and `status` reports
their registrations as `outdated` until `upgrade` points them at the new one.
Homebrew's Node.js keeps the package across `brew upgrade node`, but the versioned
executable a registration names is removed, so run `amanuensis upgrade` after it too.

```bash
amanuensis uninstall --dry-run
amanuensis uninstall
```

`uninstall` removes the entry and skill from every agent that has them, or from the
agents named with `--client`. It refuses to remove an entry the installer did not
write unless given `--force`.

Upgrade and uninstall touch only Amanuensis's own entries and skills. They back up
each configuration file before rewriting it and leave every repository's conspectus
untouched. Managed skills are replaced or removed in place rather than archived.

To roll back, install the version you want and run that version's
`amanuensis upgrade`, checking its `--dry-run` first. Restore a timestamped backup
only when deliberately reversing a configuration change.

## Install into one project instead

A project installation registers Amanuensis in one repository's own configuration,
for a team that wants it committed or for a host without user-level support:

```bash
amanuensis init --client claude --dir /path/to/project   # .mcp.json + .claude/skills/
amanuensis init --client vscode --dir /path/to/project   # .vscode/mcp.json + .agents/skills/
amanuensis init --client codex --scope project --dir /path/to/project
```

`--client vscode` targets VS Code's per-workspace `.vscode/mcp.json`. The user-level
Copilot installation above does not need it.

Because these files are meant to be committed, a project installation from the npm
package names the bare `amanuensis-memory` command rather than a path on one machine.
Each person's agent must then find that command on its own `PATH`, which an agent
started from a desktop app may not see. A project registration also takes precedence
over the user-level one in Claude Code and Codex, so use one or the other.

`--agent-instructions` also adds a short Amanuensis paragraph to the project's
`CLAUDE.md` (Claude Code) or `AGENTS.md` (other clients). Without the flag, the
installer offers the paragraph and writes nothing to either file.

For another local MCP-capable agent, `--client generic` installs the portable Agent
Skill and prints the stdio registration command and environment:

```bash
amanuensis init --client generic --dir /path/to/your/project
```

If the host loads Agent Skills or equivalent workflow instructions, ask the agent to
run onboarding. Otherwise the MCP tools and concise server instructions remain
available, but the complete workflow is not installed automatically.

## Work from source

The source checkout uses the repository-pinned Node.js and Python versions through
`mise`:

```bash
git clone https://github.com/nfeldman/amanuensis
cd amanuensis
mise install
mise exec -- npm --prefix mcp-server ci
mise exec -- npm --prefix mcp-server run build

mise exec -- node mcp-server/dist/cli.js install --mcp-only --dry-run
mise exec -- node mcp-server/dist/cli.js install --mcp-only
```

From a source checkout, the registration launches the pinned Node.js executable and
the in-tree `dist/index.js`. Source development commonly links each agent's
`skills/amanuensis` directory to the checkout's `.claude/skills/amanuensis`, which the
installer leaves in place. Omit `--mcp-only` to install the packaged skill instead.

## How each agent selects the repository

Each Amanuensis server process binds to one repository and never switches.

- **Claude Code** starts the server with `CLAUDE_PROJECT_DIR` set to the directory
  the session began in. The server binds the root of the Git repository containing
  it, so a session started in a subdirectory still uses the repository's store.
- **Codex CLI and Copilot** start the server in the session's working directory. The
  server binds the root of the Git repository containing it. For
  `codex exec --cd <repository>` or `-C`, Amanuensis recovers the task root from its
  direct Codex parent process and records `parent-codex-cli-cd-git-root`.
- **Outside a repository**, for example when an app starts the server in the home
  directory or at `/`, the server stays unbound and creates nothing. The installed
  skill then calls `get_project_info` with `workspace` set to the chat's absolute
  project directory, and the server binds that. A different workspace is refused
  afterwards, and filesystem root is always refused.

Amanuensis never infers a repository from prompt text or a hard-coded path.
`get_project_info` returns an immutable `binding_receipt` with the canonical root,
workspace and repository identities, storage location and policy, server instance,
selection source, and server version. The server revalidates that binding before
every tool call and rejects file-producing paths or symbolic-link traversal outside
the bound store.

This is application containment, not an OS sandbox. The host's trust, approvals, and
filesystem permissions remain the security boundary. MCP side-effect annotations are
host hints and do not expand filesystem authority.

## Storage

Survey state defaults to `<project>/.amanuensis/`. It is excluded from the project's
source history and has its own checkpoint history. The first database-backed tool
call creates the store through a sibling staging directory and atomic publication.
An interrupted initialization can resume from a dead, identity-matching stage.
Amanuensis preserves unknown or nonempty incomplete stores for diagnosis instead of
trusting or deleting them.

A store is bound to its repository's identity, not to the directory it was created
in. A second working copy of the same repository — a colleague's clone, a CI
checkout, the same directory moved — reads a store that travelled with it, and the
server logs once which working copy the store was created in. A store whose recorded
project identity names a different repository is still refused. A repository with no
`origin` remote is identified by its path, so its store does not travel until the
repository has the remote it was surveyed under.

### Worktrees and shared storage

Ordinary Git worktrees receive separate worktree-local `.amanuensis` stores. They
share the logical repository identity but retain distinct workspace-instance IDs and
storage paths.

`AMANUENSIS_STORAGE_ROOT` explicitly selects shared-by-repository-identity storage.
Clones or worktrees with the same verified repository identity intentionally converge
there. Do not use the override when concurrent worktrees need isolated state.

## Diagnose and repair Codex activation

Diagnosis is read-only:

```bash
amanuensis doctor --client codex --dir /path/to/your/project --json
```

Doctor reports effective configuration precedence, executable and arguments, the cwd
contract, predicted repository and storage identity, skill shadowing, and restart
state. It exits non-zero for actionable faults such as duplicate registrations,
hard-coded user-scoped paths, stale launchers, unsafe project shadows, invalid TOML,
or a wrong-repository binding.

Repair is deliberately two-step. First request a dry-run plan, then apply that exact
digest-bound plan:

```bash
amanuensis doctor \
  --client codex --dir /path/to/your/project --repair --dry-run --json
amanuensis doctor \
  --client codex --dir /path/to/your/project --repair --apply-plan <PLAN_ID> --json
```

The plan becomes invalid if relevant configuration or skill inputs change. Repair
creates timestamped configuration backups, migrates only the Amanuensis user
registration, and removes a shadowing project registration or skill only when it is
installer-managed and the skill exactly matches the packaged copy.

Configuration inspection cannot prove what an already-running host loaded. Restart
Codex after repair and verify the new task's binding with `get_project_info`.

## Verified operating envelope

The release-candidate suite compares the source checkout with a clean installation of
the exact packed npm tarball across two repositories. It checks repository identity,
storage, configuration ownership, restart state, skill content, diagnosis and repair,
upgrade, and uninstall for Codex. Absolute installation paths, including the
launcher's, are the only declared representation differences. The package test also
starts the user-level registration with only the system `PATH` and from `/`, and makes
a database call through it.

The separately dispatched published-package smoke covers Node.js 20 and 22 on Linux
and macOS after publication. The real-host evidence for Codex covers `codex-cli-exec`
across six independent runs and five logical repositories, including nested launch, a
linked worktree, parent `--cd`, and three concurrent processes. It begins after Codex
trusts the repository.

The Claude Code and Copilot installations are covered by installer tests in isolated
home directories and by server tests of each launch shape. A real Claude Code session,
given the installed entry and started in a repository subdirectory, bound the
repository root. No real Copilot CLI
or VS Code session has yet been observed loading the registration, and the Codex
desktop UI, Windows, and longitudinal product usefulness are not established. The
[roadmap](ROADMAP.md) carries the exact receipts, red cases, and current claim
boundaries; [HISTORY.md](HISTORY.md) summarizes user-visible releases.
