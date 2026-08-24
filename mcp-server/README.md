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

mise exec -- node mcp-server/dist/cli.js init --client claude --dir /path/to/your-project
```

Use `--client codex` or `--client vscode` for those runtimes. Use
`--client generic` for another local MCP host; it installs the portable skill
and prints the stdio registration command and environment. Ask the agent to run
onboarding only when that host loads Agent Skills or equivalent workflow
instructions. Without them, the typed MCP tools and concise server instructions
remain available, but the complete method is not installed automatically.

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
