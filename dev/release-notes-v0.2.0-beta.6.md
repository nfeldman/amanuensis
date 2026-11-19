Install Amanuensis for Codex, Claude Code and GitHub Copilot with one command.

### Changes

`amanuensis install` now finds every supported agent on the machine and gives each
one user-level server registration and one copy of the skill, so a single
installation covers every repository. Codex, Claude Code, and GitHub Copilot (the
Copilot CLI and VS Code, which share `~/.copilot`) are supported; `--client` names
agents explicitly. Nothing is written into any repository.

- `amanuensis status` reports, for each agent, whether its registration and skill
  are installed, outdated, absent, or not the installer's, whether the server
  launcher exists and whether the native database module loads. It exits non-zero
  until every agent it found is set up and names the command that fixes it.
  `upgrade` and `uninstall` cover every installed agent.
- A user-level registration names the absolute Node.js that ran the installer and
  the package's server file. An agent started from a desktop app, which does not see
  the shell's `PATH`, previously could not find a version-managed
  `amanuensis-memory`, or started it under another Node.js and failed at the first
  database call. Existing registrations report `outdated` until
  `amanuensis upgrade`. Committed project registrations keep the bare command.
- The installer recognizes its Codex entry by its activation contract, so it keeps
  managing the entry after Codex rewrites `config.toml` and drops the comment
  markers. Earlier releases refuse such an entry as unmanaged; this release's
  `amanuensis upgrade` recognizes and updates it.
- A Claude Code session started in a repository subdirectory binds the repository
  root, and a user-level server outside any repository stays unbound instead of
  claiming the directory it was started in.
- A symbolically linked skill is left in place at every scope, and only agents whose
  files changed are told to restart.
- Every tool call is recorded in a local call log beside the repository's store:
  tool, outcome, refusing rule, latency and sizes, with no argument values or
  response text. It never enters the store's history; `AMANUENSIS_CALL_LOG=off`
  disables it. Nothing is sent anywhere.
- Evidence citations, repair commits and claim keys are validated when written; a
  finding's severity can be re-graded and a mistaken carried-finding outcome
  corrected; every subprocess call is bounded by a timeout.
- The README and installation guide are rewritten around the one-command
  installation, with steps an agent can follow to set it up.

### Validation scope

The installer is covered by tests in isolated home directories for all three agents,
and the packed-artifact test starts the user-level registration with only the system
`PATH`, from `/`, through a database call. A real Claude Code session bound the
repository root from a subdirectory. No real Copilot CLI or VS Code session has yet
been observed loading the registration. Product efficacy remains unestablished.

Install this exact prerelease with:

```bash
npm install -g @gruetech/amanuensis@0.2.0-beta.6
amanuensis install
amanuensis status
```

If you installed an earlier release, run `amanuensis upgrade` instead of `install`,
then restart your agents so existing connections load the new server. Until
`1.0.0`, breaking changes remain possible between releases.
