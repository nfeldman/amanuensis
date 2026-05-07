# amanuensis

Agent toolkit for disciplined, evidence-driven architectural surveys
of large codebases. The package ships:

- the **MCP server** (`amanuensis-memory`) that owns persistent
  conspectus storage and exposes the typed tool surface the agents
  depend on,
- the **installer CLI** (`amanuensis init`) that wires a workspace up
  with the agent files and an MCP config, and
- the **materializer** that renders the conspectus into a
  navigable human-readable site.

## Install

```bash
npm install -g amanuensis

cd your-project
amanuensis init
```

Then open the workspace in a VS Code build that supports custom
agents and invoke the `amanuensis` agent.

## Documentation

Full documentation will ship alongside the public release of the
source repository. In the meantime, `amanuensis init --help` prints
the installer options and `amanuensis-memory --help` is the MCP
server's CLI surface.

## License

MIT.
