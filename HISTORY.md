# Release history

This file summarizes user-visible releases. The [roadmap](ROADMAP.md) and its linked
receipts carry the executable evidence, exact revisions, and current claim boundaries.

## [0.2.0-beta.1] - 2026-08-26

This is the first friction-free Codex activation beta.

### Added

- One user-scoped Codex installation with a cwd-relative MCP launch and no hard-coded
  repository path.
- Automatic binding to each trusted Git repository, with zero Amanuensis setup commands or
  restarts when entering another repository after the installation restart.
- Immutable per-process repository receipts, lazy identity-bound `.amanuensis` state, and
  contained writes across concurrent repositories and linked worktrees.
- Read-only diagnosis plus digest-bound, dry-run-first repair for stale or conflicting
  Amanuensis-managed Codex configuration.
- Reversible install, upgrade, rollback, and uninstall flows that preserve unrelated Codex
  configuration byte-for-byte and do not archive old skills.

### Proved

- Source-checkout and packed-package behavior match across the activation, migration,
  diagnosis, repair, upgrade, rollback, and uninstall lifecycle.
- Six independent real Codex CLI runs cover five logical repositories and six workspaces,
  including nested cwd, linked-worktree, parent `--cd`, and three-process concurrent cases.
- The release-candidate suite passes without pooling away repository-specific failures.

### Boundaries

- Repository binding is an application containment contract, not an OS sandbox; Codex trust,
  approvals, and filesystem permissions remain authoritative.
- The measured host is `codex-cli-exec`. Desktop UI, other MCP hosts, Windows, and
  longitudinal product efficacy remain unestablished rather than inferred.

## [0.2.0-alpha.1] - 2026-08-23

- Added deterministic embedded runtime-boundary diagrams to generated conspectus reports.
- Published the self-conspectus for GitHub Pages with source and rendered-report checks.

## [0.2.0-alpha.0] - 2026-08-20

- Introduced the v2 evidence-backed conspectus, review, design, refresh, and materialization
  workflows.
- Added an MCP server, portable Agent Skill, installer adapters, and trusted npm publishing.

## [0.1.0] - 2026-05-09

- Initial public Amanuensis MCP server and development documentation.

[0.2.0-beta.1]: https://github.com/nfeldman/amanuensis/compare/v0.2.0-alpha.1...v0.2.0-beta.1
[0.2.0-alpha.1]: https://github.com/nfeldman/amanuensis/compare/v0.2.0-alpha.0...v0.2.0-alpha.1
[0.2.0-alpha.0]: https://github.com/nfeldman/amanuensis/compare/v0.1.0...v0.2.0-alpha.0
[0.1.0]: https://github.com/nfeldman/amanuensis/releases/tag/v0.1.0
