# Installation and operations

This is the reference for installing, upgrading, diagnosing, and removing Amanuensis.
For the product overview, start with the [README](README.md).

## Requirements

- Node.js 20 or newer
- Python 3.11 or newer for materialization
- A local MCP-capable coding agent

Set `AMANUENSIS_PYTHON` when `python3` is not the interpreter Amanuensis should use.

## Install for Codex

Install the current prerelease from npm:

```bash
npm install -g @gruetech/amanuensis
amanuensis install
```

Codex user scope is the default. The command installs the Amanuensis skill and one managed,
cwd-relative MCP registration under `$CODEX_HOME` (normally `~/.codex`). Restart Codex once
after installation.

From then on, launch Codex from any trusted Git repository and ask it to **run Amanuensis
onboarding**. The repository needs no Amanuensis command, local configuration, skill copy,
or additional restart.

Codex trust is a host prerequisite. Amanuensis does not grant trust or replace Codex's
approvals and filesystem permissions.

### Deliberate project pinning

Use project scope only when Codex should be pinned to one repository:

```bash
amanuensis init --client codex --scope project --dir /path/to/your/project
```

## Install for another client

Claude Code and VS Code use project-scoped adapters:

```bash
amanuensis init --client claude --dir /path/to/your/project
amanuensis init --client vscode --dir /path/to/your/project
```

For another local MCP-capable agent, use `--client generic`. The installer adds the
portable Agent Skill and prints the stdio registration command and environment:

```bash
amanuensis init --client generic --dir /path/to/your/project
```

If the host loads Agent Skills or equivalent workflow instructions, ask the agent to run
onboarding. Otherwise the MCP tools and concise server instructions remain available, but
the complete workflow is not installed automatically.

MCP standardizes tool calls, not the project configuration file each host discovers. Each
adapter therefore writes the discovery shape documented by that client.

## Work from source

The source checkout uses the repository-pinned Node.js and Python versions through `mise`:

```bash
git clone https://github.com/nfeldman/amanuensis
cd amanuensis
mise install
mise exec -- npm --prefix mcp-server ci
mise exec -- npm --prefix mcp-server run build

mise exec -- node mcp-server/dist/cli.js install --mcp-only --dry-run
mise exec -- node mcp-server/dist/cli.js install --mcp-only
```

The dry run shows the proposed changes before installation. Source development commonly
keeps the global skill as a directory-level link to the checkout; omit `--mcp-only` when
the packaged skill should be installed instead.

## First use and storage

Opening a repository, negotiating MCP, listing tools, and calling `get_project_info` are
read-only. The first database-backed tool call creates one identity-bound `.amanuensis/`
store through a sibling staging directory and atomic publication.

An interrupted initialization can resume from a dead, identity-matching stage. Amanuensis
preserves unknown or nonempty incomplete stores for diagnosis instead of trusting or
deleting them.

Survey state defaults to `<project>/.amanuensis/`, is excluded from the project's source
history, and has its own checkpoint history.

### Worktrees and shared storage

Ordinary Git worktrees receive separate worktree-local `.amanuensis` stores. They share
the logical repository identity but retain distinct workspace-instance IDs and storage
paths.

`AMANUENSIS_STORAGE_ROOT` explicitly selects shared-by-repository-identity storage. Clones
or worktrees with the same verified repository identity intentionally converge there. Do
not use the override when concurrent worktrees need isolated state.

## Repository binding and containment

Each Amanuensis server process binds to one repository. `get_project_info` returns its
immutable `binding_receipt`, including the canonical root, workspace and repository
identities, storage location and policy, server instance, and server version. The server
revalidates that binding before every tool call and rejects file-producing paths or
symbolic-link traversal outside the bound store.

This is application containment, not an OS sandbox. The host's trust, approvals, and
filesystem permissions remain the security boundary. MCP side-effect annotations are host
hints and do not expand filesystem authority.

For `codex exec --cd <repository>` or `-C`, Amanuensis recovers the exact task root from its
direct Codex parent process and records `parent-codex-cli-cd-git-root` in the binding
receipt. It does not infer the repository from prompt text or a hard-coded path. An
unreadable `--cd` value halts before storage initialization.

## Diagnose and repair Codex activation

Diagnosis is read-only:

```bash
amanuensis doctor --client codex --dir /path/to/your/project --json
```

Doctor reports effective configuration precedence, executable and arguments, the cwd
contract, predicted repository and storage identity, skill shadowing, and restart state.
It exits non-zero for actionable faults such as duplicate registrations, hard-coded
user-scoped paths, stale launchers, unsafe project shadows, invalid TOML, or a
wrong-repository binding.

Repair is deliberately two-step. First request a dry-run plan, then apply that exact
digest-bound plan:

```bash
amanuensis doctor \
  --client codex --dir /path/to/your/project --repair --dry-run --json
amanuensis doctor \
  --client codex --dir /path/to/your/project --repair --apply-plan <PLAN_ID> --json
```

The plan becomes invalid if relevant configuration or skill inputs change. Repair creates
timestamped configuration backups, migrates only the Amanuensis user registration, and
removes a shadowing project registration or skill only when it is installer-managed and
the skill exactly matches the packaged copy.

Configuration inspection cannot prove what an already-running host loaded. Restart Codex
after repair and verify the new task's binding with `get_project_info`.

## Upgrade, roll back, and uninstall

Lifecycle changes support dry runs:

```bash
amanuensis upgrade --dry-run
amanuensis upgrade

amanuensis uninstall --client codex --scope user --dry-run
amanuensis uninstall --client codex --scope user
```

Upgrade and uninstall touch only Amanuensis-managed configuration and the managed skill.
They make timestamped configuration backups before rewrites and leave every repository
conspectus untouched. Managed skills are replaced or removed in place rather than archived.

To roll back, install the desired package version and run that version's `amanuensis
upgrade`; inspect its dry run first. Restore a timestamped `config.toml` backup only when
deliberately reversing a configuration migration.

## Verified operating envelope

The release-candidate suite compares the source checkout with a clean installation of the
exact packed npm tarball across two repositories. It checks repository identity, storage,
configuration ownership, restart state, skill content, diagnosis and repair, upgrade, and
uninstall. Absolute installation paths and source-versus-package launcher spelling are the
only declared representation differences.

The separately dispatched published-package smoke covers Node.js 20 and 22 on Linux and
macOS after publication. The current real-host evidence covers `codex-cli-exec` across six
independent runs and five logical repositories, including nested launch, a linked
worktree, parent `--cd`, and three concurrent processes.

That evidence begins after Codex trusts the repository. It does not establish the Codex
desktop UI, other MCP hosts, Windows, a registry version that has not yet been published,
or longitudinal product usefulness. The [roadmap](ROADMAP.md) carries the exact receipts,
red cases, and current claim boundaries; [HISTORY.md](HISTORY.md) summarizes user-visible
releases.
