Fix materialization of a conspectus moved to another working copy.

### Changes

The MCP connection's bound checkout now reaches the materializer and its
independent read-back through an explicit `--workspace` argument. The historical
`workspace_path` record remains provenance; it no longer overrides the active
connection. Report promotion also verifies against the publishing repository.

This closes a second workspace boundary: beta.3 correctly bound the MCP server,
but a relocated store could still make the generated report inspect its old
survey worktree and publish that worktree's Git head.

The README now explains the reader tools and refresh workflow. The published
self-conspectus has been refreshed, with unresolved findings and inherited
obligations retained explicitly.

### Validation scope

Regression coverage exercises both the tool from `cwd=/` and real rendering with
an old workspace record. The release's clean-installed packed-artifact check
also launches the installed server from `/`, binds a checkout whose Git head
differs from the original checkout, and verifies both report formats and
independent read-back while preserving the provenance record.
The same installed-package regression fails against published beta.3 because
its overview uses the original checkout's Git head, and passes with beta.4.

Repository-wide CI retains the previously recorded historical receipt and
roadmap-job failures. This release does not claim that workflow is green.
Post-reconnect native Codex app verification and product efficacy remain
unestablished.

Install this exact prerelease with:

```bash
npm install -g @gruetech/amanuensis@0.2.0-beta.4
```

Restart Codex after upgrading so existing MCP connections load the new server
and materializer. Until `1.0.0`, breaking changes remain possible between releases.
