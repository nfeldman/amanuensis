# Backlog

Tracked work that is real and intentional but not the current focus.
Items listed here have a thought-through scope and known acceptance
criteria — they are not "maybe someday" wishes.

When pulled into active work, items move out of this file and into the
session's TODO list.

---

## `npx amanuensis init` — one-step per-project install

**Why.** Today's install is three steps (clone Amanuensis, build the MCP
server, hand-copy agents and `.vscode/mcp.json` into the target
workspace). The point of public release is for somebody to type a
single command and survey their codebase. A `bin` entry plus a small
CLI bridges that gap.

**Scope.** Per-project `init` only. Uninstall is a separate item
(below).

**Decisions made:**
- `npx amanuensis init` is the surface. Global install via
  `npm install -g amanuensis-memory` should also work but the README
  pitches the npx form.
- Handle the **`.vscode/mcp.json` merge-vs-overwrite** case explicitly.
  Many users will already have other MCP servers configured. Behavior:
  - If file is absent: write a minimal one with the `amanuensis-memory`
    server entry.
  - If file is present and lacks `amanuensis-memory`: merge in the
    server entry and pretty-print the result, preserving the user's
    existing entries and any comments we can preserve.
  - If file is present and has an `amanuensis-memory` entry: leave it
    alone unless `--force` is passed, in which case overwrite that one
    entry only. Always back up to `mcp.json.bak.<timestamp>` before
    overwriting.
- **Verify the current VS Code agent-file convention before
  committing to `.github/agents/`.** Custom-agent support is evolving;
  different VS Code releases have looked at different paths. Confirm
  the right path against the current GA / Insiders docs before the
  installer hardwires it. If multiple paths are common, write to all
  of them or make the path configurable via `--agents-dir`.

**Implementation sketch:**
- Add `"amanuensis": "dist/cli.js"` to `mcp-server/package.json`'s
  `bin` map (alongside the existing `amanuensis-memory`).
- New `src/cli.ts` parses subcommands. Initial subcommand: `init`.
- Bundle `agents/` into the npm package via the `files` field.
- Adversarial probes: init into a fresh temp dir (no prior
  `.vscode/mcp.json`), then init again with one already there
  containing a different MCP server, then init with `--force` over an
  existing `amanuensis-memory` entry. Verify each lands the expected
  state and validates against the JSON Schema.

**Acceptance criteria:**
- Fresh project: `npx amanuensis init` writes agents and a valid
  `.vscode/mcp.json`; running the agent in VS Code starts the server.
- Project with other MCP servers configured: those entries survive
  unchanged.
- Project with a prior `amanuensis-memory` entry: untouched without
  `--force`; backed up and overwritten with `--force`.

---

## `amanuensis uninstall`

**Why.** Symmetry with `init`; useful for projects that abandon the
methodology or for clean re-installs during development.

**Scope.** Removes the agent files this Amanuensis version installed,
removes the `amanuensis-memory` entry from `.vscode/mcp.json`
(preserving other entries), and prints a hint about
`~/.amanuensis/workspaces/<project>/` so the user can decide whether to
keep the conspectus storage.

**Open questions:**
- Should it offer to wipe the workspace storage too? Default to no;
  surface a `--purge-storage` flag.

---

## Cloud-runnable Amanuensis (minimum viable)

**Why.** Run a survey on a codebase without tying up the laptop, and
produce a comparison conspectus next to a locally-run one to see how
much (or how little) human-in-the-loop oversight matters for output
quality.

**Scope (intentionally smaller than `dev/loc-toolkit/cloud-architecture-plan.md`).**
The full toolkit cloud plan (R2 + Turso + Modal + Workers + SvelteKit)
is the right long-term vision. This item is a one-week MVP that uses
GitHub Actions and Claude Code's headless mode, defers all the
hyperscaler economics work, and produces a usable cloud conspectus
ready for comparison.

**Architecture:**
- **Conspectus repo** (one per surveyed codebase or one shared, user's
  call): a regular GitHub repo. Stores `memory.db` (yes, binary —
  acceptable trade-off for MVP), `docs/`, prose artifacts. Phase
  commits land here.
- **Target repo**: any GitHub repo the user's account can read.
- **Workflow**: `survey.yml` in the conspectus repo. Manual dispatch.
  Inputs: `target_repo` (owner/name), `target_ref` (branch or SHA),
  `subsystem_id` (optional — defaults to "run onboarding"),
  `max_runtime_min` (default 90).
- **Runtime**: ubuntu-latest GitHub Actions runner. Sets up Node +
  Python + git, clones target repo, installs Amanuensis (via the
  `npx amanuensis init` from the item above — this item depends on
  that one), installs Claude Code CLI, runs Claude Code in `--print`
  mode with the amanuensis agent, with autoprogress on.
- **Auth**: `ANTHROPIC_API_KEY` as a workflow secret on the conspectus
  repo. GitHub token already available for the target-repo clone.
- **Commit cadence**: Claude Code calls `commit_phase_gate` at every
  phase boundary; a final commit at the end. The workflow then pushes
  the conspectus repo back to GitHub.

**Autoprogress mode:**
- New MCP tool `record_open_question(category, question, what_blocked,
  what_assumed)` writing to a new `open_questions` table. Materialized
  to `docs/open-questions.md` so a human reviewer sees the queue.
- Server respects `AMANUENSIS_AUTOPROGRESS=1`. Mostly informational at
  the server level — the agents drive the actual behavior. The server
  exposes a `get_autoprogress_mode()` tool the agents check at phase
  boundaries.
- A new agent file `amanuensis-auto.agent.md` (a thin wrapper over the
  coordinator) replaces "pause for human review" with "if the
  question is blocking, call `record_open_question`; otherwise commit
  the gate via `commit_phase_gate` and continue."

**Comparison protocol:**
- New MCP tool `compare_conspectuses(local_storage, cloud_storage)`
  that opens both DBs and produces a structural diff: subsystem
  overlap, finding overlap, evidence-quality distribution, vocabulary
  size, contradiction count, open-question count.
- Renders the diff as `docs/comparison.md` so the experiment is
  reproducible and presentable.

**Why GitHub Actions, not Modal/Fly:**
- Zero new infrastructure to set up; user already has a GitHub account.
- 6-hour job limit on the free tier is enough for any single subsystem
  survey; for full-codebase onboarding, split into multiple workflow
  runs (one per subsystem).
- Trivial migration to Modal later — Claude Code CLI runs anywhere
  Node runs; the workflow YAML translates 1:1 to a Modal function.

**Why Claude Code, not Copilot:**
- We already know Claude Code works with our agent files and MCP
  server. Zero re-wiring.
- Copilot's coding agent has its own constraints and can't easily run
  a custom MCP server today. Re-evaluate when the platform matures.

**Acceptance criteria:**
- A user with a conspectus repo and a target repo can dispatch the
  workflow and, an hour later, see committed phase-gate progress in
  the conspectus repo and a populated `docs/`.
- Open questions land in `docs/open-questions.md` so a reviewer
  knows what the cloud agent skipped.
- `compare_conspectuses` produces a diff between a known-good local
  conspectus and the cloud one, surfacing concrete overlap and
  divergence numbers.

**Out of scope for this item (defer to the larger cloud plan):**
- Cloudflare R2 / object storage for scratch material.
- Turso/libSQL — local SQLite is fine since memory.db lives in git.
- Web UI — `docs/` rendered to GitHub Pages is enough.
- Modal/Fly migration.
- Multi-tenant isolation.

---

## Publish the `amanuensis` package to npm

**Why.** Publishing is the blocker for *public distribution*, not for
the current comparison experiment. The pre-publish workflow
(`cloud/survey.private.yml`) clones and builds Amanuensis from the
private source repo via a PAT, so the Grafana experiment can run
without a published package. What the publish enables:

- anyone outside the dev circle using `npm install -g amanuensis`
  instead of cloning and building from source,
- the simpler `cloud/survey.yml` workflow (published-package variant)
  to be usable as-dispatched by anyone,
- `npx amanuensis init` to work from a clean machine against any
  project.

**Package-shape work is already done.** The package is renamed to
`amanuensis`, the `prepack` script bundles both `agents/` and
`materializer/` into the published tarball, the minimal npm-facing
README is in place at `mcp-server/README.md`, and the developer-
facing README with the auto-generated tool inventory now lives at
`mcp-server/DEVELOPMENT.md`. Only the publish itself + the first-
end-to-end validation remain.

**Remaining scope.**
- Make the name public-ready: add `homepage`, `repository`, `bugs`,
  and `author` to `package.json` once the public Amanuensis repo
  exists. (Deferred until the repo goes public — per the user's
  plan, the private dev repo will be renamed and a new public
  Amanuensis repo will be created, at which point the published
  `amanuensis` npm page can get its proper README too.)
- Claim the name on npm (one-way door — no re-use once taken, but
  also no one else can take it).
- Run `npm publish --access public` from `mcp-server/`.
- Tag the release in git.

**Acceptance criteria.**
- `npm install -g amanuensis` from an arbitrary machine puts both
  `amanuensis` and `amanuensis-memory` on PATH with the agents and
  materializer bundled.
- `npx amanuensis init` works against a fresh target workspace (no
  prior global install required).
- The cloud workflow template works end-to-end when dispatched
  against a real target repo, producing a conspectus that
  `compare_conspectuses` can diff against a locally-produced one.

---

## First comparison-experiment artifact

**Why.** The point of building the cloud harness was the comparison
study (local vs. autoprogress on the same codebase). Running it, then
publishing the comparison markdown with commentary, validates the
methodology and the `compare_conspectuses` output.

**Scope.**
- Pick a small-to-medium OSS codebase (probably something Amanuensis
  itself has been run against in dev).
- Run a local survey to completion.
- Run the cloud workflow against the same target_sha.
- Run `compare_conspectuses` with `write_to` targeting a
  `comparisons/` dir in the conspectus repo.
- Annotate the report with observations: where autoprogress agreed
  with local, where it diverged, whether divergences correlate with
  specific open-question categories.

**Acceptance criteria.**
- A committed comparison report, with commentary, in the conspectus
  repo.
- The observations feed back into either the agent prompts (to fix
  systemic autoprogress failure modes) or the BACKLOG.

---

## Out-of-scope hold list

These are real but explicitly not on the active backlog. Listed so a
future session can resurface them when the moment is right.

- **Tiered entries / compression system.** The most complex part of the
  schema. Add when the conspectus is large enough that context
  management becomes a problem.
- **Full HTML site generation.** Markdown + mermaid in GitHub /
  Obsidian / VS Code preview is sufficient for v1. Revisit if a
  curated public showcase needs HTML.
- **Property-based testing with fast-check.** Not currently signal-
  positive given the smoke + invariants suites.
- **Statistical perf tracking** (github-action-benchmark). Coarse
  ceilings catch the regressions that matter; statistical tracking
  needs persistent storage and produces noisy alerts on shared runners.
