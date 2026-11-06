# Glossary

## Codebase-wide

### carried finding

_A finding inherited from a discarded store, held as an obligation until this store decides it._

A rebuild discards a conspectus and not what it had found. `carry_finding` records each finding with the store it came from, and `record_carried_outcome` closes it one of three ways: a successor finding filed here, ruled out with evidence collected here, or repaired at a commit that resolves. A carried finding is a question and not an answer, so its text is not evidence about the current code.

First seen: `mcp-server/src/tools/carried.ts:carry_finding@1015b8e29bd6a54ddbc7412b9f78a4dcc3ff5782`

### conspectus

_The durable record of a survey: the SQLite store, the prose artifacts beside it, and the pages generated from them._

It outlives the session that wrote it, which is the point: a later session or a person reads it instead of reconstructing what was already read. The store is the agent's source of truth and is written only through the server's tools; the pages are a projection and are never edited by hand. A conspectus records what a session read and concluded at a revision. It does not establish that a conclusion is true, and each kind of record says what it can and cannot justify.

First seen: `.claude/skills/amanuensis/SKILL.md:Amanuensis@1015b8e29bd6a54ddbc7412b9f78a4dcc3ff5782`

### evidence row

_One recorded citation: a file, an optional symbol and line range, a resolved revision, and a kind saying how solid the observation is._

Evidence is recorded first and cited by id from dispositions, findings and explanations. The kind is a ladder from `code-verified` down to `pattern-matched`, and overstating it is the most common way the method fails. `add_evidence` resolves the revision in the workspace and refuses a path outside it or inside `.amanuensis`. It stores the line range as given, so a range is a claim and may not open where it says.

First seen: `mcp-server/src/tools/evidence.ts:add_evidence@1015b8e29bd6a54ddbc7412b9f78a4dcc3ff5782`

### file ledger

_The table assigning each tracked path to a subsystem with a classification, the revision it was examined at, and whether it has drifted since._

`detect_changes` reconciles the ledger against the tree at a revision: a tracked path with no row is unledgered, a row whose file is gone is absent, and a row whose file differs from the revision it names is marked stale. `generated-ignore`, `vendor-ignore` and `irrelevant` rows carry no obligation to be read. A row classified `candidate` is in scope and has not been read, so a populated ledger says what has to be read and only `examined` rows say what was.

First seen: `mcp-server/src/schema.sql:file_ledger@1015b8e29bd6a54ddbc7412b9f78a4dcc3ff5782`

### read-back

_The independent check that reads the store and the finished pages after a render, on state, coverage and content axes, and clears the run's ok when they differ._

A renderer cannot vouch for itself, so `ProjectionVerifier` reads the durable database and the output files separately. State: each authoritative record has its one marker on the page that owes it. Coverage: every planned page and local cross-link exists. Content: the finished bytes match a receipt taken after cross-references are resolved. Markdown and HTML are checked separately. A green read-back says records reached pages and does not judge the prose.

First seen: `materializer/amanuensis_materializer/readback.py:ProjectionVerifier@1015b8e29bd6a54ddbc7412b9f78a4dcc3ff5782`

### standing

_What the record authorizes about one file, symbol, subsystem or term and what it cannot justify, computed from stored rows and a git ancestry check with no model involved._

`describe_locus` leads with standing because a reader needs to know how far to trust an account before reading it. The per-owner predicate is the `file_standing` view in the schema; `standing.ts` decides what SQL cannot: whether a path has an owner, whether its owners agree, and whether an examination revision is still reachable from `HEAD`. The same store against the same `HEAD` gives the same answer, so a tool can quote a standing block as evidence.

First seen: `mcp-server/src/standing.ts:describeLocusStanding@1015b8e29bd6a54ddbc7412b9f78a4dcc3ff5782`

### status ladder

_The ordered survey statuses a subsystem climbs, unmapped, scoping, structural, concerns, adversarial and mapped, each refused until the previous phase's work is on record._

A status is a claim about work that happened, so `enforceForwardPrerequisites` checks every rung between the current status and the target, and both status writers call it: a populated ledger, a claim and discharged vocabulary to reach `structural`, a registered survey artifact for `concerns`, dispositions for `adversarial`, and challenged claims, discharged explanations and a reconciled store for `mapped`. `deferred` is orthogonal and can be set from any rung. A rung says which passes ran and does not say how much of the subsystem's ledger was read.

First seen: `mcp-server/src/invariants.ts:STATUS_ORDER@1015b8e29bd6a54ddbc7412b9f78a4dcc3ff5782`

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

