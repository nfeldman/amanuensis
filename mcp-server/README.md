# @gruetech/amanuensis

Evidence-backed codebase memory for coding agents. Amanuensis gives Codex, Claude
Code, GitHub Copilot, and other MCP-capable agents a durable, checkable account of a
codebase. The account records what the code does, why each claim is believed, what
has changed since, and which questions are still open.

## Install

Requires Node.js 20 or newer.

```bash
npm install -g @gruetech/amanuensis && amanuensis install
```

`amanuensis install` finds Codex, Claude Code, and GitHub Copilot (the CLI and VS
Code) on this machine. It registers the Amanuensis MCP server and workflow skill with
each of them once, for every repository. Restart those agents, open any Git
repository, and ask: **run Amanuensis onboarding**.

```bash
amanuensis status      # what is installed; exits non-zero if something is missing
amanuensis upgrade     # after installing a newer package version
amanuensis uninstall   # remove every registration and skill it added
```

Add `--client codex,claude,copilot` to choose agents and `--dry-run` to preview any
change. Publishing the human-readable map also needs Python 3.11 or newer.

## What the package contains

- `amanuensis-memory`, the local stdio MCP server that owns each repository's
  `.amanuensis/` store and its typed tools;
- the `amanuensis` Agent Skill, which teaches the agent the survey, review, design,
  and refresh workflows;
- the `amanuensis` installer CLI; and
- the materializer that publishes the record as a navigable site.

This is a beta. Until `1.0.0`, expect breaking changes between releases.

## Code index

From 0.3.0-beta.1 the server keeps a cache of each source file's definitions, so an agent
can see a file's shape (`outline_file`), read one definition and cite it exactly
(`read_symbol`), and find a definition by name (`find_symbol`) and a record by topic
(`search_records`). It adds to reading files and never replaces it. A reference
`find_symbol` returns is name-matched, so it is a lead to confirm in the code.

It parses TypeScript, TSX, JavaScript, Python, Rust, Go, Java, C, C++ and C# with
tree-sitter grammars vendored into the package (16.8 MB unpacked). It is on by default;
set `AMANUENSIS_CODE_INDEX=off` to remove the tools. Languages, location, limits and
notices are in [Installation and operations](https://github.com/nfeldman/amanuensis/blob/main/INSTALLATION.md#code-index).

## Read-only consumer mode

Launch `amanuensis-memory --consumer-read-only` for an existing store to expose
only `get_project_info`, `describe_locus`, and `search_records`. The server does
not initialize or migrate the survey store and refuses incompatible schemas;
update such stores using the normal server first. Call logging is disabled in
this mode. The store directory must still be writable: SQLite may create the
store's `-wal` and `-shm` files to read it, and record searches create, update or
clean up the disposable code-index sidecar beside the store. This mode is a reader,
not a way to start or update a survey.

## Documentation

- [README](https://github.com/nfeldman/amanuensis#readme): what Amanuensis does and
  how to work from it
- [Installation and operations](https://github.com/nfeldman/amanuensis/blob/main/INSTALLATION.md):
  every file the installer touches, project-level installs, other MCP hosts,
  repository binding, storage, diagnosis, and upgrades
- [Release history](https://github.com/nfeldman/amanuensis/blob/main/HISTORY.md)

`amanuensis --help` prints the full command reference.

## License

MIT.
