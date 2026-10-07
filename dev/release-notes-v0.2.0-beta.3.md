The Codex app workspace fix and the reader and survey-depth changes since beta.2.

### Changes

- Codex app connections bind through `get_project_info({workspace: absolutePath})`
  using the chat's workspace. Filesystem root is rejected, unbound connections
  cannot access project state, and an existing connection cannot switch projects.
  The installed skill performs the handshake automatically.
- `describe_locus`, `get_attention`, and `get_history` provide revision-aware
  accounts of a locus, unresolved work, and recorded conclusions. Searchable
  report views preserve the evidence and limitations behind each account.
- Survey-depth gates require evidence-backed dispositions, discharged or
  declined domain vocabulary, reconciled scope, and decisions on carried findings.
- A conspectus can travel to another working copy of its verified repository;
  stores from a different repository remain refused.
- Skill startup searches and probes deferred MCP tools before reporting that
  the memory server is disconnected.
- The locked transitive `proxy-addr` dependency is patched to `2.0.8`, clearing
  the critical advisory identified by the release audit.

### Validation scope

The workspace regression fails against the pre-fix server and passes with the
repair, including startup from `/`, simultaneous clone isolation, lazy first
use, immutable binding, restart recovery, project pins, and CLI `--cd` behavior.
The installed launcher was independently checked from `/` against a real project.
A live native Codex app call also returned this chat's repository through the
handshake; that connection was still running the repaired beta.2 build.
Native app verification of beta.3 after reconnect and product efficacy remain
unestablished.

Repository-wide CI has pre-existing failures in historical source-custody
receipt validation and the roadmap job's missing server build. This release
does not claim that workflow is green. Publication uses the release workflow's
clean packed-artifact check; the published package is checked separately by the
Linux/macOS Node.js 20/22 smoke matrix. [Publication succeeded](https://github.com/nfeldman/amanuensis/actions/runs/37692059909),
and [all four published-package smoke jobs passed](https://github.com/nfeldman/amanuensis/actions/runs/37693422887).
A clean local installation of the exact registry version matched its published
SHA-512 integrity and passed all ten workspace regression groups against the
installed beta.3 server.

Install this exact prerelease with:

```bash
npm install -g @gruetech/amanuensis@0.2.0-beta.3
```

Restart existing MCP connections after upgrading so they load the new workspace
handshake. Until `1.0.0`, breaking changes remain possible between releases.
