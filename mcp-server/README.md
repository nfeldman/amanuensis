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

See the [source repository](https://github.com/nfeldman/amanuensis)
for the full README, methodology overview, and architecture diagram.
`amanuensis init --help` and `amanuensis-memory --help` print their
respective CLI surfaces.

## License

MIT.
