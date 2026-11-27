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

### Call log

Every tool call is recorded locally in `call-log/calls.db` inside the store
directory. This sidecar sits beside the record, not inside it. A row holds:

- the tool and its outcome (`ok`, `validation`, `refusal` or `exception`);
- a stable rule id, where the refusing check declares one;
- for a thrown refusal, the source line that threw it;
- latency, argument and response sizes, and a SHA-256 of the arguments;
- the session.

No argument values, response text or refusal messages are stored, because messages
can echo arguments. The store's history never includes the sidecar: its directory has
its own `.gitignore`, storage commits exclude it, and recording is refused if that
history already tracks it. The sidecar is opened only after the store exists, so
startup stays read-only. Rows are written after each response and never wait on
another process's lock. Set `AMANUENSIS_CALL_LOG=off` to disable it. Nothing is sent
anywhere.

## Code index

Available from 0.3.0-beta.1. The code index reads a source file at one revision and
keeps what it finds, the file's definitions and imports, in a cache beside the store.
Four tools use it: `outline_file` (a file's shape), `read_symbol` (one definition's
source and the location fields for `add_evidence`), `find_symbol` (definitions by name,
and references matched by name) and `search_records` (the store's own records).

The index adds to reading files. An agent may read a whole file whenever that helps;
nothing here asks it not to. One real limit applies: a `find_symbol` reference is
name-matched, not resolved, so it is a lead to confirm in the code, not proof of a call.

### Languages

Ten languages are parsed with vendored tree-sitter grammars. A file in any other language
is refused as `unsupported-language`; read it directly.

| Language | Extensions | Grammar | Size |
|---|---|---|---|
| TypeScript | `.ts` `.mts` `.cts` | `tree-sitter-typescript@0.23.2` | 1.41 MB |
| TSX | `.tsx` | `tree-sitter-typescript@0.23.2` | 1.45 MB |
| JavaScript | `.js` `.mjs` `.cjs` `.jsx` | `tree-sitter-javascript@0.25.0` | 0.41 MB |
| Python | `.py` `.pyi` | `tree-sitter-python@0.25.0` | 0.46 MB |
| Rust | `.rs` | `tree-sitter-rust@0.24.0` | 1.10 MB |
| Go | `.go` | `tree-sitter-go@0.25.0` | 0.22 MB |
| Java | `.java` | `tree-sitter-java@0.23.5` | 0.41 MB |
| C | `.c` | `tree-sitter-c@0.24.1` | 0.63 MB |
| C++ | `.h` `.cc` `.cpp` `.cxx` `.c++` `.hpp` `.hh` `.hxx` `.h++` | `tree-sitter-cpp@0.23.4` | 3.43 MB |
| C# | `.cs` | `tree-sitter-c-sharp@0.24.0` | 7.25 MB |

Size is the compiled grammar. Each language has its own definition queries in
`queries/` (TSX shares TypeScript's). The runtime is `web-tree-sitter@0.27.2`, an npm
dependency with no install script. The grammars are not dependencies: they are vendored
into the package at pinned versions, and the server refuses a grammar file whose bytes
differ from `grammars/manifest.json`.

### Weight

The grammars take 16.8 MB unpacked, in the package's `grammars/` directory. The package
test fails when the tarball grows above 3.6 MB packed or 31 MB installed.

### Location

The index is a cache, not a record. It is stored at
`<storage>/code-index/<extractor_id>/index.db`, beside the store's database and not in
`memory.db`. The `extractor_id` changes with the extractor, the definition queries and
the grammars, so two package versions sharing a storage directory do not rebuild each
other's cache. Its directory has its own `.gitignore` and the store's history never
includes it. Deleting `code-index/` is always safe; the next call rebuilds what it needs
from the repository's own revisions. A generation untouched for 30 days is collected.

### Switches and limits

The index is on by default. Set `AMANUENSIS_CODE_INDEX=off` to turn it off; `off`, `0`,
`false` and `no` all do. The four tools are then not registered and nothing under
`code-index/` is created. `add_evidence` behaves as it does without a symbol.

`AMANUENSIS_CODE_INDEX_MAX_FILES` sets how many files one whole-tree call parses. Other
limits are fixed. Defaults:

- a file over 2 MiB is recorded as too large and not parsed;
- one whole-tree call parses at most 20,000 files and 200 MiB of source, and stops
  after 30 seconds;
- a generation may use 1 GiB on disk; older entries are evicted first.

### Notices

The grammars and the runtime are MIT licensed. Each grammar directory carries the
license its package published, and `THIRD_PARTY_NOTICES.md`, which ships in the package,
lists every package, its version and its copyright holder.

### Check an installed package

CI packs the package, installs the tarball into an empty directory, starts the installed
server and calls `outline_file` and `read_symbol` on a fixture with one file per
language. It fails if a grammar or a definition query is missing from the tarball. It
runs on Node 20 and 22, on Linux and macOS. To run it locally:

```bash
cd mcp-server && node scripts/check-installed-package.mjs
```

Node 20 is still the floor. Set `AMANUENSIS_TEST_PACKAGE` to check a tarball or a registry
version instead of packing the checkout.

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
