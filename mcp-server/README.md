# @gruetech/amanuensis

Evidence-backed codebase memory for MCP-capable coding agents. The package
ships:

- the **MCP server** (`amanuensis-memory`) that owns persistent
  conspectus storage and exposes the typed tool surface the agents
  depend on,
- the portable **Amanuensis Agent Skill**, which defines the workflow,
- the **installer CLI** (`amanuensis init`) that wires the selected client's
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

mise exec -- node mcp-server/dist/cli.js init --client codex --scope user --dry-run
mise exec -- node mcp-server/dist/cli.js init --client codex --scope user
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
permissions remain authoritative. Run `amanuensis doctor --client codex
--dir /path/to/project --json` to inspect effective config precedence, launch
paths, predicted repository/storage identity, skill shadows, and restart state.
Doctor is read-only and exits non-zero for actionable faults. A safe repair is
two-step: `doctor --repair --dry-run --json` returns a digest-bound plan ID;
`doctor --repair --apply-plan <PLAN_ID> --json` applies it with timestamped
configuration backups and refuses changed inputs.

The server requires Node.js 20 or newer. Materialization also requires Python
3.11 or newer; set `AMANUENSIS_PYTHON` if `python3` is not the desired
interpreter. Survey state defaults to `<project>/.amanuensis/`.

Install the current prerelease with
`npm install -g @gruetech/amanuensis`. The alpha is the current `latest` tag.

## Documentation

See the [source repository](https://github.com/nfeldman/amanuensis)
for the full README, methodology overview, and current limitations.
`amanuensis init --help` prints the installer surface; the server itself is a
stdio process launched by the selected MCP client.

## License

MIT.
