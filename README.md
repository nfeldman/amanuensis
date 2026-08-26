# Amanuensis

## Give your code agents a memory they have to earn.

Amanuensis turns a codebase into a living, evidence-backed map that agents can actually
rely on.

It is for developers using agents on systems that are too large, consequential, or
long-lived to reconstruct safely from scratch in every session.

A capable model can produce twenty plausible concerns in a minute. The expensive part is
deciding which ones are real. If you still have to verify every claim yourself, the
bottleneck has only moved downstream and filled up with confident-sounding noise.

Amanuensis changes the starting point. An agent begins with a durable account of what the
code does, why that account is believed, what changed, what is now stale, which findings
survived challenge, and which questions are still open.

## What that changes

- **Stop reconstructing the system every session.** Architecture, intent, uncertainty,
  decisions, and ruled-out concerns carry forward as a codebase memory rather than a chat
  transcript.
- **Review changes in context.** The diff arrives with affected seams, prior findings,
  unresolved obligations, and the evidence behind them.
- **Act on findings without redoing the review.** Concerns are independently challenged;
  repairs remain unverified until new evidence proves them at the repaired revision.
- **Design from the system that actually exists.** Compare alternatives against recorded
  constraints, then carry the decision, its premises, consequences, and falsifiers forward.
- **Give people the same map.** The conspectus is published as a searchable, hyperlinked
  architectural atlas, with Markdown companions for portability and audit.

The result is a reusable situation model for code: compact enough to work from, detailed
enough to inspect, and explicit about the edge of what is known.

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

## See it work

[Browse the conspectus Amanuensis built for itself](https://nfeldman.github.io/amanuensis/):
a human-readable map of the architecture, evidence, findings, seams, contradictions, and
open questions behind this repository.

## Try the beta

The default installation is for Codex:

```bash
npm install -g @gruetech/amanuensis
amanuensis install
```

Restart Codex once, open a trusted Git repository, and ask it to **run Amanuensis
onboarding**. After that one user-scoped installation, each new trusted repository binds
to its own Amanuensis store without repository-local setup or another restart.

Requires Node.js 20 or newer and Python 3.11 or newer. For Claude Code, VS Code, another
MCP host, source installs, upgrades, rollback, diagnosis, storage policy, or uninstalling,
see [Installation and operations](INSTALLATION.md).

## Beta means beta

The current source is versioned as `0.2.0-beta.1`. Its internal contracts and failure
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
