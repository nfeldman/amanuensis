# Amanuensis

## Give your code agents a memory they have to earn.

Amanuensis turns a codebase into a living, evidence-backed map that agents can actually
rely on.

It is for developers using agents on systems that are too large, consequential, or
long-lived to reconstruct safely from scratch in every session.

Instead, an agent (AI or human) can begin with a durable account of what the code does, why that
account is believed, what changed, what is now stale, which findings survived challenge, and which
questions are still open.

That changes the job. Review becomes less about generating plausible concerns and more
about resolving the ones that survive scrutiny. Design starts from the real constraints of
the system. Work can continue across sessions without turning yesterday's understanding
into today's folklore.

## What Amanuensis makes possible

- **Build a codebase memory.** Survey structure, behavior, seams, risks, intent, and
  uncertainty into a durable conspectus rather than a disposable chat transcript.
- **Keep that memory alive.** Bind knowledge to Git history, detect relevant changes,
  withdraw stale authority, and schedule focused revalidation instead of starting over.
- **Review with context.** Combine the diff with prior findings, affected seams, open
  obligations, and independent attempts to generate, refute, and verify concerns.
- **Prove repairs.** Keep “fixed” separate from “verified-fixed” until new evidence exists
  at the repaired revision.
- **Think in productive tension.** Run design work through independent immanent,
  adversarial, and speculative lenses without collapsing disagreement into false
  consensus.
- **Carry decisions forward.** Preserve alternatives, premises, consequences, falsifiers,
  research inputs, and the authority behind an accepted choice.
- **Work unattended without losing the plot.** Bound authority up front, recover from
  interruption, reconcile every dispatched result, and verify published output against
  durable state before calling the run complete.

## Trust is part of the architecture

Amanuensis does not depend on a prompt asking the model to be careful. Its MCP server owns
the record and enforces the rules:

- claims need evidence and a repository revision;
- claim supersession and invalidation remain revision-bound and historical;
- independent review cannot aggregate before its generator, refuter, and verifier fan-in lands;
- repairs need post-fix proof;
- partial fan-in cannot masquerade as completion; and
- generated documentation must pass state, coverage, and content read-back.

The result is a reusable situation model for code: compact enough to work from, detailed
enough to inspect, and explicit about the edge of what is known.

For people, that model is published as a self-contained HTML conspectus: a searchable,
hyperlinked architectural atlas with plain-language names, reading hints, survey-depth and
evidence cues, and responsive subsystem and finding pages. Markdown companions remain
available for portability and audit. Both forms are regenerated together and must pass the
same state, link-coverage, and byte-correspondence read-back before publication succeeds.

## Beta

The v2 implementation is distributed as `0.2.0-alpha.0` and passes
its full CI suite. The tool is in beta and is being dogfooded now in active development
work.

Its internal contracts and failure gates are extensively tested. What is still being
learned is the practical part: whether the conspectus stays useful as a real project
changes, how much repeated explanation and verification it saves, and where the workflow
creates friction. Longitudinal results are not yet available.

Until `1.0.0`, expect breaking changes between releases.

The [roadmap](ROADMAP.md) carries the exact implementation evidence and current claim
boundaries.

## Try the current beta

Install the current prerelease from npm:

```bash
npm install -g @gruetech/amanuensis
amanuensis init --client claude --dir /path/to/your/project
```

To work from source instead:

```bash
git clone https://github.com/nfeldman/amanuensis
cd amanuensis
mise install
mise exec -- npm --prefix mcp-server ci
mise exec -- npm --prefix mcp-server run build

mise exec -- node mcp-server/dist/cli.js init --client claude --dir /path/to/your/project --dry-run
mise exec -- node mcp-server/dist/cli.js init --client claude --dir /path/to/your/project
```

Use `--client codex` or `--client vscode` instead when that is where the project will run.
For another local MCP-capable agent, use `--client generic`; the installer adds the
portable Agent Skill and prints the stdio registration command and environment. If that
host loads Agent Skills (or equivalent workflow instructions), ask the agent to **run
onboarding**; otherwise the MCP tools and concise server instructions remain available,
but the complete workflow is not installed automatically.

Each client-specific adapter writes the documented discovery shape for the same local MCP
server and workflow. Direct stdio compatibility is tested independently; host discovery
still follows each client's own trust and activation rules. The adapters exist because MCP
standardizes tool calls, not the project config file each host discovers.

The source beta uses the repository-pinned Node.js and Python versions through `mise`. The
package contract remains Node.js ≥20; the materializer supports Python 3.11+.
Survey state lives with the target at `<project>/.amanuensis/`, is excluded from the
project's source history, and retains its own checkpoint history.

## Help shape it

Amanuensis is early enough that careful use and specific criticism can materially improve
the product. If you work with coding agents on a substantial codebase, try the beta and
tell us:

- where durable context saved you from repeating work;
- where the record became noisy, stale, or difficult to trust;
- which review or design surfaces changed a decision;
- where the safeguards created useful discipline or needless friction; and
- what would make Amanuensis worth keeping in the loop every day.

Bug reports, workflow reports, failed experiments, and concrete examples are all useful.
[Open an issue](https://github.com/nfeldman/amanuensis/issues) to share feedback or propose
a collaboration.

## Go deeper

- [Roadmap and current evidence status](ROADMAP.md)
- [Contributor setup and test commands](CONTRIBUTING.md)
- [MCP server protocols and generated tool inventory](mcp-server/DEVELOPMENT.md)
- [Practice-catalog v2.10 reconciliation](dev/adr/0020-practice-catalog-v2.10-reconciliation.md)

## License

MIT. See [LICENSE](LICENSE).
