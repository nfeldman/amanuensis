# @gruetech/amanuensis

Evidence-backed codebase memory for MCP-capable coding agents. The package
ships:

- the **MCP server** (`amanuensis-memory`) that owns persistent
  conspectus storage and exposes the typed tool surface the agents
  depend on,
- the portable **Amanuensis Agent Skill**, which defines the workflow,
- the **installer CLI** (`amanuensis install`, with `init` retained for
  explicit project adapters) that wires the selected client's
  project discovery files, and
- the **materializer** that renders the conspectus into a
  navigable human-readable site.

## v2 alpha

This source tree packages as `0.2.0-alpha.1`. It is being dogfooded and remains
under longitudinal validation. Until `1.0.0`, expect breaking changes between
releases.

```bash
git clone https://github.com/nfeldman/amanuensis
cd amanuensis
mise install
mise exec -- npm --prefix mcp-server ci
mise exec -- npm --prefix mcp-server run build

mise exec -- node mcp-server/dist/cli.js install --dry-run
mise exec -- node mcp-server/dist/cli.js install
```

Codex user scope is the default: it installs one global skill and a cwd-relative
stdio registration under `$CODEX_HOME`, then requires one Codex restart. New
trusted Git repositories require no Amanuensis setup or restart. Use
`--scope project` only for a deliberate repository pin. Use `--client claude`
or `--client vscode` for those project-scoped runtimes. Use
`--client generic` for another local MCP host; it installs the portable skill
and prints the stdio registration command and environment. Ask the agent to run
onboarding only when that host loads Agent Skills or equivalent workflow
instructions. Without them, the typed MCP tools and concise server instructions
remain available, but the complete method is not installed automatically.

Repository binding is not an OS sandbox; host trust, approvals, and filesystem
permissions remain authoritative. Every process exposes an immutable binding
receipt through `get_project_info` and revalidates its canonical repository,
identity, storage, and symlink-free write path before each tool call. Direct
materialization, review export, refresh output, and comparison reports are
restricted to the bound storage directory. MCP side-effect annotations are
host hints, not broader filesystem authority.

The Codex user-scope adapter normally binds the MCP child's cwd. For
`codex exec --cd <repository>` / `-C`, where Codex retains the launcher cwd for
the MCP child, Amanuensis reads the exact task-root argument from its direct
`codex` parent and records `parent-codex-cli-cd-git-root`. It does not inspect
prompt text or use a hard-coded repository path.

Default storage is worktree-local: worktrees share repository identity but
receive distinct workspace-instance IDs and `.amanuensis` paths. An explicit
`AMANUENSIS_STORAGE_ROOT` instead selects shared-by-repository-identity custody;
do not use it when concurrent worktrees need isolation. Run `amanuensis doctor --client codex
--dir /path/to/project --json` to inspect effective config precedence, launch
paths, predicted repository/storage identity, skill shadows, and restart state.
Doctor is read-only and exits non-zero for actionable faults, including an
absolute user-scoped cwd or workspace argument. A safe repair is
two-step: `doctor --repair --dry-run --json` returns a digest-bound plan ID;
`doctor --repair --apply-plan <PLAN_ID> --json` applies it with timestamped
configuration backups and refuses changed inputs.

Startup, MCP negotiation, tool discovery, and `get_project_info` are read-only
in a fresh repository. The first DB-backed tool call initializes one
identity-bound `.amanuensis/` store by staging a complete schema and marker and
publishing it atomically. Dead identity-matching stages are recoverable;
unknown or nonempty incomplete stores halt for diagnosis. Use
`amanuensis upgrade --dry-run` before `amanuensis upgrade`, and dry-run
`amanuensis uninstall --client codex --scope user` before applying it. Both
lifecycle commands preserve every repository store and unrelated Codex config.
Configuration rewrites receive timestamped backups; managed skills are
replaced or removed without creating skill archives. A deliberate package
rollback installs the intended version and runs that version's upgrade path.

The pre-publication parity gate compares this source checkout with a clean
installation of its exact packed tarball across two repositories. It holds
identity, storage, config ownership, restart state, skill digest, diagnosis and
repair, upgrade, and uninstall results equal; only absolute install paths and
launcher representation may differ. The manual published smoke repeats the
user-scoped lifecycle on Node 20/22 and Linux/macOS after an authorized publish.
Its presence does not claim that the current source has been published. Current
real-host evidence covers `codex-cli-exec`; a distinct desktop-host result is
not inferred from it. Codex trust remains a host prerequisite, and project
scope remains the explicit pinning escape hatch.

The committed A25 real-host envelope contains six independent Codex runs over
five logical repositories, including nested cwd, linked-worktree,
parent-`--cd`, and three-process concurrent conditions. Raw host events and
DB-backed store custody bind every run ID to one thread, server instance,
repository receipt, and exact session intent. Each run records zero Amanuensis
setup commands, per-repository restarts, user interventions, and
cross-repository writes. The result applies only after Codex trust; an
untrusted control that caused Codex itself to persist project trust was kept
outside the positive denominator. Desktop UI, other MCP clients, Windows, and
published-registry operation remain unsupported or unmeasured strata.

The server requires Node.js 20 or newer. Materialization also requires Python
3.11 or newer; set `AMANUENSIS_PYTHON` if `python3` is not the desired
interpreter. Survey state defaults to `<project>/.amanuensis/`.

Install the current prerelease with
`npm install -g @gruetech/amanuensis`. The alpha is the current `latest` tag.

## Documentation

See the [source repository](https://github.com/nfeldman/amanuensis)
for the full README, methodology overview, and current limitations.
`amanuensis --help` prints the installer surface; the server itself is a
stdio process launched by the selected MCP client.

## License

MIT.
