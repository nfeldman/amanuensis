# Release history

This file summarizes user-visible releases. The [roadmap](ROADMAP.md) and its linked
receipts carry the executable evidence, exact revisions, and current claim boundaries.

## [Unreleased]

## [0.3.0-beta.1] - 2026-11-26

This release changes the published output: pages are HTML only, and the store holds
everything they print.

- Keep every piece of a survey in the store. The project's name and thesis
  (`record_project_profile`), its runtime boundaries (`record_runtime_boundary`),
  territory dispositions, structure and onboarding narratives (`record_narrative`,
  `decline_narrative`, `get_narratives`) and the marks that tie a claim to a place in
  the code (`record_claim_mark`) are records with evidence, not files the agent writes.
  `import_artifact_bodies` copies an older store's prose files into the store once,
  with their provenance.
- Publish HTML only. The materializer builds each page from the store, no longer writes
  or parses Markdown, and drops the `.md` form of every page. The read-back checks every
  rendered record and diagram against the store.
- Draw the survey: the workflow and status ladder, coverage bars, finding badges, the
  seam between two subsystems and the flow through one, as inline SVG built at publish time.
- Help a first-time reader: a guide with the page index, Amanuensis's own terms, what the
  ID letters mean and how a survey proceeds. The overview is two parts, what the codebase
  is and its parts; the survey's figures are on an About this survey page.
- Add a code index. `outline_file` lists a file's definitions and imports,
  `read_symbol` returns one definition's source and the arguments that cite it,
  `find_symbol` finds definitions by name and references by name only, and
  `search_records` searches the store's current records. Ten languages are parsed with
  tree-sitter grammars compiled to WebAssembly; results are cached in a sidecar beside the
  store, never in the store. The package is about 26 MB installed.
- Anchor evidence to definitions. When `add_evidence` names a symbol in a supported
  language, the server resolves it at the cited revision, refuses one it cannot find or
  cannot tell apart, and keeps the cited range inside that definition. For a stale file,
  the refresh backlog says whether the cited definition is the same, moved, changed or gone.
- Ask less of an explanation and let the reader replace it. Accounts and narratives aim
  for 2048 bytes, keep only what a reader would otherwise get wrong, and leave findings
  out. Any recorded prose can be rewritten on the reader's word, with what to focus on,
  or replaced by text they write.
- Add a survey set: the paths a survey has to account for. It is the tree at a
  revision minus the paths its own ignore files match, the paths the owner
  excluded and the paths onboarding sorted as meta. An owner include rule brings
  a path back from the ignore files or from meta, and between two owner rules the
  more specific pattern decides. Reconciliation, the ledger, the completion
  checks, the pages and the readers all use the survey set where they used the
  whole tree.
- Record the rules through three tools: `set_scope_rule` records an owner's
  exclude or include with the owner's words, `record_scope_sorting` records a
  product or meta sorting (a meta row carries an inventory of cited files), and
  `get_scope` reads the rules, the counts by source and the paths still unsorted.
- Leave an excluded path out of the record. It gets no ledger row and no evidence,
  no new record may name it, and it appears on no page except as one count on the
  overview, which also names the owner's rules. `describe_locus` still answers for
  it, as `excluded` with its source (gitignore, user or meta) and the rule.
- Refuse publication while a store in sorted mode has unsorted paths, naming up to
  20 of them. Recording a rule or a sorting row takes the standing of the last
  reconciliation away until `detect_changes` runs again.
- Add Phase 0b to onboarding: it records the git state, any owner rule, then sorts
  every path, code included, as product or meta before the survey starts.
- Keep an existing store working. A store that already had ledger rows or a
  reconciliation opens in legacy mode and changes in one way only: paths its ignore
  files match leave the survey set, and any ledger row on one is reported as
  `excluded_with_rows` and kept.

## [0.2.0-beta.7] - 2026-11-19

- Let a survey correct a claim at the revision it was recorded at:
  `invalidate_claim` and `supersede_claim` accept the claim's own `valid_from_sha`,
  which records that the claim never held. Previously a claim found wrong during
  the adversarial pass could not be closed until the repository gained a commit.
  An older store is migrated when it is opened, keeping every claim.
- Relink a published page whose own content did not change when a finding it links
  to has moved, for example from open to resolved findings. Such a publish was
  previously marked failed for a dangling link.
- Refuse `mapped` while any file in the subsystem's scope has not been examined;
  record each file as examined or deferred with a reason. `get_dashboard` reports
  examined and unexamined files.
- Check every status a subsystem skipped when it resumes from `deferred`, and refuse
  a `reset_subsystem` target above its current depth. A status and its recorded
  depth are now written together.
- Carry stale files in the review brief, and drop the index page's stale-entry
  markers, which could never appear; the stale-files page is the census.
- Raise the default `describe_locus` budget to 15360 bytes, so a default call on a
  surveyed file returns its purpose and structure.
- Correct four tool calls the skill's references wrote with the wrong tool or
  argument name; CI now checks every call the references write out.

## [0.2.0-beta.6] - 2026-11-19

- `amanuensis install` sets up every agent it finds on the machine (Codex, Claude
  Code, and GitHub Copilot's CLI and VS Code) with one user-level registration and
  skill each, so one command covers every repository. `--client` names agents
  explicitly.
- Add `amanuensis status`, which reports what is installed for each agent and exits
  non-zero until every agent it found is set up. `upgrade` and `uninstall` cover
  every installed agent.
- Bind a Claude Code session started in a repository subdirectory to the
  repository root, and leave a user-level server unbound outside any repository
  instead of claiming the directory it was started in.
- Recognize the installer's Codex entry by its activation contract rather than its
  comment markers, which Codex drops when it rewrites `config.toml`. Install, upgrade,
  uninstall, status, and doctor previously refused or reported such an entry as
  unmanaged. Every rewrite is checked by parsing to change nothing else in the file.
- Leave a symbolically linked skill in place at every scope, and stop reporting two
  links to the same checkout as one skill shadowing the other.
- Tell the user to restart only the agents whose files changed.
- Register the user-level server by the absolute path of the Node.js that ran the
  installer and the package's server file, as source installations already did. A
  bare `amanuensis-memory` was missing for agents started from a desktop app when
  Node.js came from a version manager, and with a second Node.js on the agent's
  `PATH` the server started but failed at its first database call. Existing
  installations report `outdated` until `amanuensis upgrade`. Committed project
  registrations keep the bare command.
- Record every tool call in a local call log beside each repository's store: the
  tool, its outcome, the refusing rule where one is declared, latency and sizes, but
  no argument values or response text. It never enters the store's history, and
  `AMANUENSIS_CALL_LOG=off` disables it.
- Rewrite the README, installation guide, and package README around the one-command
  installation, with steps an agent can follow to set it up.
- Validate evidence citations, repair commits, and claim keys when they are
  written; allow a finding's severity to be re-graded and a mistaken
  carried-finding outcome to be corrected; refuse a finding id that a carried
  record already holds; bound every subprocess call with a timeout. See
  [BACKLOG.md](BACKLOG.md) for the itemized repairs.

## [0.2.0-beta.5] - 2026-11-07

- Record a purpose and an account for each subsystem and the project with
  `record_explanation` and `decline_explanation`, read them with `get_explanations`,
  and require both before a subsystem advances to `mapped`.
- Lead subsystem pages with Purpose and How it works, render findings' business
  context and subsystem notes, present claims as a register and group ledger rows.
- Report unfilled explanation slots from `materialize_docs`.
- Republish the self-conspectus with recorded explanations.

## [0.2.0-beta.4] - 2026-10-07

- Pass the bound checkout to materialization and independent read-back, so a
  relocated conspectus does not inspect its historical worktree instead.
- Preserve the original workspace record as provenance.
- Verify the complete materialization path from a clean-installed npm artifact
  launched from `/`, with different Git heads in the original and bound checkouts.
- Update the README and refresh the published self-conspectus.

## [0.2.0-beta.3] - 2026-10-07

- Bind Codex app connections through an explicit chat-workspace handshake;
  reject filesystem root and cross-workspace rebinding before database access.
- Add revision-aware locus, attention, and history tools and searchable report
  views that preserve unresolved work and the basis for recorded conclusions.
- Enforce survey depth with evidence-backed dispositions, vocabulary discharge,
  repository scope reconciliation, and terminal outcomes for carried findings.
- Open a conspectus moved to another working copy of the same verified
  repository while continuing to refuse foreign stores.
- Probe deferred MCP tools before declaring the memory server disconnected.
- Update the locked transitive `proxy-addr` dependency to `2.0.8` to address the
  critical advisory found by the release audit.

The desktop launch boundary has stdio regression coverage. Post-reload native
app verification and product efficacy remain unestablished.

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

[0.2.0-beta.4]: https://github.com/nfeldman/amanuensis/compare/v0.2.0-beta.3...v0.2.0-beta.4
[0.2.0-beta.3]: https://github.com/nfeldman/amanuensis/compare/v0.2.0-beta.2...v0.2.0-beta.3
[0.2.0-beta.1]: https://github.com/nfeldman/amanuensis/compare/v0.2.0-alpha.1...v0.2.0-beta.1
[0.2.0-alpha.1]: https://github.com/nfeldman/amanuensis/compare/v0.2.0-alpha.0...v0.2.0-alpha.1
[0.2.0-alpha.0]: https://github.com/nfeldman/amanuensis/compare/v0.1.0...v0.2.0-alpha.0
[0.1.0]: https://github.com/nfeldman/amanuensis/releases/tag/v0.1.0
