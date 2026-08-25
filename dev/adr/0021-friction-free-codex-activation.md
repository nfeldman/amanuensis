# ADR 0021 — Friction-free Codex activation

**Status:** Accepted  
**Date:** 2026-08-25  
**Authority:** Direct user product decision  
**Roadmap initiatives:** A19–A26

## Context

The v2 alpha is installable and its project-local Codex adapter emits a valid
`cwd = "."` MCP registration. In direct use, however, a running Codex task
remained connected to an older global Amanuensis registration whose
`--workspace` argument was hard-coded to the Amanuensis source repository.
Initializing a second repository did not repair the already-running process;
the survey correctly stopped on workspace mismatch.

This is safe failure, but it is not a usable multi-repository activation
contract. The product goal is to install Amanuensis once, open any trusted Git
repository, and begin work with one natural-language request. Repository-local
configuration remains useful for deliberate version or workspace pinning, but
it cannot be the default ceremony for ordinary use.

## Decision

1. Codex receives a supported user-scoped installation mode. It registers the
   global skill and a cwd-relative stdio launcher without a hard-coded
   `--workspace` argument.
2. Each launched server process resolves exactly one canonical repository at
   startup and holds that binding immutably for its lifetime. One process never
   switches projects.
3. Survey state remains project-local at `<project>/.amanuensis/` by default and
   is created lazily on the first stateful Amanuensis operation.
4. Existing hard-coded global entries, duplicate project entries, and shadowed
   skills are diagnosed before writes and migrated only through a dry-run,
   backup-bearing managed operation.
5. Project-scoped installation remains available as an explicit pinning mode.
6. Host trust and approval boundaries remain authoritative. Amanuensis calls
   this a repository binding and containment contract, not an OS sandbox.
7. The friction-free claim requires real-host, concurrent multi-repository
   evidence. Parsing generated TOML is necessary but insufficient.

## Acceptance boundary

After one user-scoped installation and its single required host restart, a
fresh trusted repository with no Amanuensis configuration must start a new task,
resolve the correct Git root, create no project state until first use, and begin
an Amanuensis workflow without another setup command or restart. Two concurrent
repositories and worktrees must retain distinct workspace identities and
storage, with zero cross-repository writes.

The claim excludes security ceremonies required by Codex itself, non-Git
workspaces without an explicit root contract, and publication of a package or
release without human authorization.

## Consequences

- Activation work preempts new review, design, research, and orchestration
  surface expansion until its Now-stage gates pass.
- Installer and host integration tests become product-critical rather than
  packaging-only checks.
- The roadmap distinguishes the integrated v2 baseline from the active
  friction-free expansion; completed historical initiatives are not reopened.
- A failure to establish cwd-relative launch behavior in a real Codex host
  forces an explicit launcher or host-contract redesign rather than a prompt
  instruction asking users to remember the correct repository.

## Rejected alternatives

- **Initialize every repository.** Rejected as the ceremony this decision is
  intended to remove.
- **One long-lived server that switches repositories per tool call.** Rejected
  because it expands the cross-project contamination surface and weakens
  immutable project custody.
- **Keep a hard-coded global workspace and rely on the skill preflight.**
  Rejected because a safe stop is not successful activation.
- **Describe project locality as sandboxing.** Rejected because Amanuensis does
  not create the host OS sandbox and must not overstate its security boundary.
