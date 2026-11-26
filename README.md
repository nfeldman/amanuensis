# Amanuensis

## What Amanuensis is

Amanuensis gives coding agents a durable, evidence-backed account of a codebase. An agent
surveys the repository in passes and records what each part is for, how it works, what it
concluded and on what evidence, and what is still open. Later sessions start from that
record instead of rebuilding it, and a refresh brings it up to date as the code changes.

It is meant for codebases too large or long-lived for an agent to reconstruct safely in
every session.

## Its parts

- **The MCP server** keeps each repository's record (claims, findings, evidence and
  explanations) in a SQLite store with its own Git history. It refuses writes the record
  cannot support, such as a claim without evidence at a revision.
- **The agent skill** teaches the method: onboarding, subsystem surveys, review of
  findings, and refresh.
- **The materializer**, in Python, publishes the store as an HTML site and reads each
  page back against the records before the publication counts.
- **The installer**, the `amanuensis` command, registers the server and the skill with
  Codex, Claude Code and GitHub Copilot.

## Install

You need Node.js 20 or newer. One command installs Amanuensis and registers it with
every coding agent it finds on your machine: Codex, Claude Code, and GitHub Copilot
(the Copilot CLI and VS Code).

```bash
npm install -g @gruetech/amanuensis && amanuensis install
```

Restart those agents once. Then open any Git repository and ask your agent to **run
Amanuensis onboarding**. Nothing is set up per repository: each new repository gets
its own record the first time the agent uses it.

`amanuensis status` shows which agents are set up. Publishing the human-readable map
also needs Python 3.11 or newer; everything else works without it.

### Asking an agent to set it up

An agent can do the whole installation. Give it this README and ask it to set
Amanuensis up. For the agent, the steps are:

1. Run `node --version`. If Node.js is missing or older than v20, stop and tell the
   user that Amanuensis needs Node.js 20 or newer.
2. Run `npm install -g @gruetech/amanuensis`. If it fails with a permissions error
   (`EACCES`), do not retry with `sudo`. Tell the user that their Node.js is a system
   installation and that a version manager such as nvm, fnm, or mise avoids the
   problem, then stop. A warning that `better-sqlite3` has install scripts is
   expected; step 4 checks that the module works.
3. Run `amanuensis install`. If it reports a conflict, it has written nothing. Show
   the user the message: it names each conflicting file and why, such as an
   `amanuensis-memory` entry the installer did not write, an edited skill file, or a
   file the user cannot write. Ask before running `amanuensis install --force`,
   which replaces those entries and files. Configuration files are backed up first;
   replaced skill files are not.
4. Run `amanuensis status`. Its first line names the installed version. It exits
   with code 0 when every agent it found is set up and the database module loads;
   otherwise its last line names the command that fixes it. Report its output to
   the user.
5. Tell the user to restart their agents. The session that ran the installation
   cannot see the new server until it restarts. After that, they can ask for
   onboarding in any Git repository.

The installer writes only its own registration and skill into each agent's
user-level configuration. It backs up any configuration file before changing it and
never writes into a repository. `amanuensis uninstall` removes everything it added.
[Installation and operations](INSTALLATION.md) lists every file it touches.

## Trust is part of the architecture

Amanuensis does not rely on a prompt asking the model to be careful. Its MCP server owns
the record and makes the model earn authority:

1. **Read before judging.** A name or file path is not evidence of behavior.
2. **Prove it or qualify it.** Claims cite what supports them and the repository revision
   where that evidence was checked.
3. **Attack the finding.** Independent passes generate, refute, and verify concerns before
   an aggregate review can land.
4. **Remember the result.** Confirmed, uncertain, stale, repaired, and ruled-out knowledge
   remain distinct instead of being rediscovered as fresh speculation.

Those rules are enforced when records are written. A claim cannot outrun its evidence,
partial work cannot masquerade as completion, and “fixed” cannot silently become
“verified-fixed.”

Explanations are held to a different standard. What a part is for and how it works is
written by the model that read the code, bound to that revision and its evidence, and
marked as ageing when the cited files change. No gate checks that an explanation is
true: it orients a reader, while claims remain the home of individually checkable rules.

A survey accounts for the repository's tracked files except the ones it leaves out: paths the repository's own ignore files match, paths the owner excluded and paths onboarding sorted as meta, such as plans and research; an excluded path gets no ledger row and no evidence and appears only as a count on the site's About this survey page, and an owner include rule brings any of them back.

## Work from the memory

Once a conspectus exists, ask your agent:

- **“What is this part for, and how does it work?”** Read the recorded purpose and
  account of a subsystem or of the whole project, with the revision and evidence they
  were written from.
- **“What do we know about this file?”** Get the recorded account, its evidence and
  revision, and the limits of what has actually been surveyed.
- **“What needs attention?”** Find unresolved work and stale knowledge; **“What was
  concluded?”** retrieves the recorded decisions and review history.
- **“Review this change.”** Get the diff with the seams it touches, the findings
  already recorded there, and the evidence behind them.
- **“Compare these designs.”** Weigh alternatives against the recorded constraints,
  then keep the decision with its premises and what would overturn it.
- **“Refresh the conspectus.”** Reconcile it with the current repository, re-examine
  changed files, record affected claims, and republish the human-readable map.

The MCP readers `get_explanations`, `describe_locus`, `get_attention`, and `get_history`
expose these accounts without asking a model to invent a new interpretation. A refresh updates the
record through source examination; it does not make every subsystem fully surveyed.

## Status

The current published release is [0.2.0-beta.7](https://github.com/nfeldman/amanuensis/releases/tag/v0.2.0-beta.7),
available as `latest` on npm. Its internal contracts and failure
gates are extensively tested, and the tool is being dogfooded in active development.

What has not been established yet is the longitudinal product claim: how useful the
conspectus remains as a real project changes, how much repeated explanation and
verification it saves, and where the workflow creates friction. Expect breaking changes
before `1.0.0`.

## Go deeper

- [Installation, client setup, lifecycle, and troubleshooting](INSTALLATION.md)
- [Release history](HISTORY.md)
- [Roadmap, implementation evidence, and current claim boundaries](ROADMAP.md)
- [Contributor setup and test commands](CONTRIBUTING.md)
- [MCP protocols and generated tool inventory](mcp-server/DEVELOPMENT.md)

If you try Amanuensis, reports of where the memory saved work—or became noisy, stale, or
hard to trust—are especially valuable. [Open an issue](https://github.com/nfeldman/amanuensis/issues)
with a bug, workflow report, failed experiment, or concrete example.

## License

MIT. See [LICENSE](LICENSE).
