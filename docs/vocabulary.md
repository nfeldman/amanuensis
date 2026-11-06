# Glossary

## Scoped to **[B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)**

### discharge or decline

_The shape every generative obligation in this method takes: satisfy it with one real record, or state out loud that none applies — never a numeric floor._

A quota over a field the agent authors is filled to order, so the vocabulary obligation is not "at least N terms" but "one anchored term, or a reasoned declination". decline_domain_vocabulary is append-only, attributed to the session that judged it, and refused for a subsystem that already has an anchored term — a subsystem cannot both carry vocabulary and declare it has none. The same shape governs the concern checklist (every concern terminal, no minimum count), the adversarial pass (a survived outcome on every claim is a legitimate result, and inventing one overturn to look rigorous corrupts the record), and the field notes and claims the depth gate reports without blocking on.

First seen: `.claude/skills/amanuensis/references/phase-2-structural.md:vocabulary@c0734040022f0e1f1b9d8c480259f6142a875fca`

### refusal parity

_The rule that a skill reference instructing a call the server refuses must quote the refusal in the words the server returns, so the two sides can be compared mechanically rather than read side by side._

The method is a deliverable here, not documentation: a reference that tells an agent to make a call the server has since started refusing produces a survey that stalls on a ToolError with no route forward. Quoting the refusal string verbatim — "the file ledger is empty", "no current claim carries a claim_key beginning", "carried finding(s) have no terminal outcome" — turns the correspondence into something a checker can hold: mcp-server/scripts/check-refusal-parity.mjs derives the candidate refusal set from the server's own thrown messages and compares that complete set against the register, so an unregistered refusal is a finding rather than silence. onboarding.md's Phase 5 is where the whole ladder is quoted in one place.

First seen: `.claude/skills/amanuensis/references/onboarding.md:phase-5-draft-master-plan@c0734040022f0e1f1b9d8c480259f6142a875fca`

## Scoped to **[B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)**

### independent storage mode

_The .storage-mode marker that makes a project-local .amanuensis/ its own nested git repository and forbids it from ever falling through to the surveyed repository's git._

repoState distinguishes six starting states. Without the marker, a storage directory with no .git of its own would be probed with `git rev-parse --is-inside-work-tree` and, inside a source checkout, would answer 'nested-ready' — so an interrupted `git init` would leave the conspectus committing into the repository it is surveying. The marker short-circuits that probe to 'not-a-repo', which is the state that runs `git init` and writes the first commit. The nested-ready path is real and is for cloud mode, where one outer conspectus repository holds many per-project subdirectories; project-local storage is the deliberate independent exception.

First seen: `mcp-server/src/storage-git.ts:repoState@c0734040022f0e1f1b9d8c480259f6142a875fca`

### store generation

_The random 32-hex identity a store mints once, at the open that creates store_identity, and never recomputes — the name a carried record calls the conspectus it came out of._

Identity here is a fact the store carries, not a function of its mutable state. The rejected alternative was a digest over (repo_id, canonical_branch, onboarding_sha, last_checked_sha), which fails both ways: set_git_state may move last_checked_sha at any time, so a live store's identity would change every time it reconciled and an id written into a successor could not be recomputed from the source later; and two clean-slate rebuilds of the same repository at the same revision produce the same tuple and would collide. mintStoreIdentity writes it with INSERT OR IGNORE so the mint happens on the open that creates the table and never again — including for an existing populated store, which gains its identity the first time it is opened after this schema lands. The immutability trigger is on UPDATE and DELETE, so the second open is a silent no-op rather than a refusal.

First seen: `mcp-server/src/db.ts:mintStoreIdentity@c0734040022f0e1f1b9d8c480259f6142a875fca`

## Scoped to **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)**

### verification object

_What a composition item was verified *over* — either one unit subject at its own target commit, or the whole assembled HEAD in a clean worktree — recorded on the item so a unit pass can never be read as an integral one._

Composition separates two questions a single fan-in conflates: did each piece pass on its own, and does the assembly pass as a whole. Unit items bind to their own target_sha; integral-head items must target the exact assembled HEAD, and the integral lane refuses to dispatch until every unit item has scored pass with zero failures and zero deferrals. The lane's score then compares the worker's reported checkout HEAD and tree against the manifest's and requires zero dirty paths, so an integral pass taken over a modified working tree is scored fail rather than accepted.

First seen: `mcp-server/src/tools/composition.ts:dispatchIntegral@c0734040022f0e1f1b9d8c480259f6142a875fca`

### wire budget

_The 8192-byte ceiling a list tool's response must fit, measured on the doubled envelope — the indented text block plus the structuredContent that repeats it — not on the payload._

MCP returns the same object twice: once serialized into a text block and once as structuredContent, and a host pays for both. Measuring the payload alone is what turned a comfortable-looking response into one over budget in the reader-lens work, so envelopeBytes in carried.ts adds both serializations. The budget is enforced by dropping rows until the envelope fits and publishing next_cursor, with one further step for the case a single row exceeds it alone: the row is cut down and the count of cut rows is published, because answering a page request with an empty page and no cursor leaves the reader no way forward. MAX_ID_LENGTH exists for the same reason — a 9,000-character archived_finding_id produced an 18,428-byte envelope from one record.

First seen: `mcp-server/src/tools/carried.ts:WIRE_BUDGET@c0734040022f0e1f1b9d8c480259f6142a875fca`

## Scoped to **[B-04](subsystems/b04-diff-aware-materializer.md)**

### page plan

_The list of pages the current store requires, computed once per render and used four times over: to decide what to write, what to link, what to navigate, and what the read-back must find._

Each PagePlan carries its route, its build closure, its navigation group and subgroup, and the record id the cross-reference index routes to it. Because the same list drives rendering, the HTML shell's navigation, the reader's-guide route table and the read-back's expected-path set, a page added or renamed cannot appear in one of those and not the others — which is the failure the orphan-retirement step and the coverage axis both exist to catch. A page whose group is not in NAV_GROUPS is a render error raised before a byte is written, because the rail would have nowhere to route it from.

First seen: `materializer/amanuensis_materializer/core.py:PagePlan@c0734040022f0e1f1b9d8c480259f6142a875fca`

## Scoped to **[B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)**

### generated copy, asserted schema

_This repository's rule for a fact published in more than one place: generate every copy that can be generated, and assert the one that cannot rather than rewriting it._

scripts/gen-vocabulary.mjs writes src/vocabulary.ts and the materializer's vocabulary.py from contracts/conspectus-vocabulary.json, and compares the SQL CHECK literals in schema.sql against the same source without editing them — because schema.sql is applied to live databases on every open, so rewriting it mechanically is a migration risk rather than a formatting one. The same shape appears in check-refusal-parity.mjs, which cannot generate the skill's prose and so generates the *candidate set* instead and compares it against a hand-kept register. Where neither half is applied the drift is silent, which is what B05-2 is: a version literal with no generator and no assertion.

First seen: `mcp-server/scripts/gen-vocabulary.mjs:loadSource@c0734040022f0e1f1b9d8c480259f6142a875fca`

## Subsystems that declared no domain vocabulary (1 of 9)

- **[B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md)** — Declared at `c0734040022f` in session `mu274z8h-ylgc5fy0`: _This subsystem is an embedded corpus of completed research surveys and captured platform trials, not a component of the product. Its vocabulary is the vocabulary of the domains it surveyed — web component registries, island architectures, trial snapshots — and those terms belong to the surveys' own vocabulary.md files, where each survey already defines them for its own readers. Recording them here would create a second glossary of terms this codebase does not implement, scoped to a subsystem whose files the product never loads. The three files read at this pass carry no internal jargon of their own: they are capture scripts named for what they capture._

