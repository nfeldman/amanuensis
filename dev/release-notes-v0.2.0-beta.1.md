This is Amanuensis's first friction-free Codex activation beta.

### Highlights

- Install Amanuensis once at Codex user scope, restart Codex at most once, then enter new
  trusted Git repositories without another Amanuensis setup command or restart.
- Launch remains cwd-relative, with no hard-coded repository path. Each server process binds
  immutably to one repository and exposes an identity-bound receipt.
- Repository state is created lazily on the first DB-backed tool call. Concurrent repositories
  and linked worktrees retain independent write custody.
- `amanuensis doctor` diagnoses stale or conflicting configuration without mutation; repair is
  dry-run first, digest-bound, backup-producing, and limited to Amanuensis-managed state.
- Source-checkout and packed-package activation paths pass the same lifecycle contract.

### Evidence

The release gate passed 19 of 19 candidate checks. Real Codex CLI evidence consists of six
independent runs across five logical repositories and six workspaces, including nested cwd,
linked-worktree, parent `--cd`, and three-process concurrent cases. Failures are evaluated per
repository rather than pooled. See the [roadmap](https://github.com/nfeldman/amanuensis/blob/v0.2.0-beta.1/ROADMAP.md)
for exact committed receipts and unsupported strata.

### Scope

Repository binding is an application containment contract, not an OS sandbox. The measured host
is `codex-cli-exec`; desktop UI, other MCP hosts, Windows, and longitudinal product efficacy
remain unestablished.

Install this exact prerelease with:

```bash
npm install -g @gruetech/amanuensis@0.2.0-beta.1
```

Until `1.0.0`, expect breaking changes between releases.
