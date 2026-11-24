# Survey scope: what a survey leaves out

Written 2026-11-23. This is Part 1 of `design/self-survey/PLAN.md`. The owner approved its
direction and decisions F1–F3 on 2026-11-23. The packets below were written against main
at `6a6dc43`.

## 0. Summary

Today a survey has to account for every path in the repository's tree. The tree at a
revision (`listTrackedPaths`, `mcp-server/src/invariants.ts:1274`) is the denominator of
every reconciliation:

- every path needs a ledger row before the store is complete;
- the only way to exempt a path is a ledger classification, which needs a subsystem;
- the row then prints on the pages.

This plan adds a **survey set**, the paths the survey has to account for.

- It is the tree at a revision, minus three kinds of excluded path:
  1. **gitignore**: paths the repository's own ignore files match at that revision. Out by
     default.
  2. **user**: paths the owner said are irrelevant, recorded as exclude rules.
  3. **meta**: paths onboarding sorted as about the project rather than part of it, such
     as plans, reviews, research and recorded evidence. Each meta prefix gets a cheap,
     cited inventory first.
- The owner's **include** rules bring a path back from gitignore or meta, always. Between
  two owner rules, the more specific one decides. So an exclude of `design/spec.md` inside an
  included `design/` keeps that one file out.

Everything that uses the tree as its denominator uses the survey set instead:
reconciliation, the ledger, the `mapped` and publication checks, the readers, the pages and
the completion checker. An excluded path:

- gets no ledger row and no evidence;
- appears on no page except as a count on the overview;
- answers `describe_locus` as `excluded`, with its source and rule.

## 1. The owner's rule

As stated on 2026-11-23, condensed:

> Anything git ignored, we should ignore by default (user can override as needed); anything
> the user says is irrelevant the survey should skip; anything that seems like it isn't code
> or relevant to code should be skimmed and categorized as product or meta product/product
> adjacent, with the latter being inventoried cheaply to ensure it is what it seems, then not
> included in any work until/unless instructed otherwise.

Decisions F1–F3, approved:

- **F1:** the rules live in the store, written through tools.
- **F2:** the pages omit excluded paths. The overview carries one line with the count for
  each source and the owner's rules.
- **F3:** sorting is by directory prefix where a prefix is uniform, and by single path where
  it isn't. New paths under a meta prefix inherit its category.

The owner also ruled, on 2026-11-06, that "excluded" means not included, not listed with a
label. This plan follows from that ruling.

## 2. Design

### 2.1 Records

There are three new tables in `schema.sql`. All are append-only, enforced by triggers like
`scope_reconciliations`. A rule is withdrawn by a later row that supersedes it, never by an
edit.

- **`scope_rules`**: the owner's rules.
  - Columns: `id`, `pattern`, `action` (`exclude` or `include`), `reason`, `owner_words`
    (the owner's words that asked for it, quoted, required), `supersedes` (nullable rule id),
    `session_id`, `recorded_at`.
- **`scope_sorting`**: onboarding's sorting decisions.
  - Columns: `id`, `pattern`, `category` (`product` or `meta`), `description` (one line:
    what is there), `supersedes`, `session_id`, `recorded_at`.
  - A `meta` row needs an inventory: at least one citation of a file under its pattern,
    with a line range and an excerpt. That is the cheap inventory, proof that the folder
    was opened.
    - `record_scope_sorting` writes the citations itself, into **`scope_inventory`**:
      `sorting_id`, `file_path`, `line_range`, `excerpt`, `ref_sha`.
    - It checks them exactly as `add_evidence` does: the file exists at the revision, and
      the excerpt is in those lines.
    - They are kept apart from `evidence`. So an inventory row can never become a citation
      for a claim, and the pages never print it.
- **`scope_exclusions`**: the resolved result.
  - Columns: `reconciliation_id`, `file_path`, `source` (`gitignore`, `user` or `meta`),
    `rule_id` (null for gitignore).
  - Written by `detect_changes` in the same transaction as its `scope_reconciliations` row.
  - Readers that re-check a reconciliation read this table instead of re-deriving the
    gitignore matches (§2.5).

`scope_reconciliations` gains six columns, added with `ALTER TABLE ... ADD COLUMN`, which
its triggers allow:

- `scope_digest`: SHA-256 over the active rules and sorting rows, in a formula restated in
  §2.5;
- `exclusion_digest`: SHA-256 over this reconciliation's own `scope_exclusions` rows. It
  witnesses the resolved set, so a row inserted later, swapped or given another source is
  detected (§2.5);
- `excluded`;
- `unsorted`;
- `survey_paths`;
- `scope_mode`.

One more table, **`scope_mode_changes (id, mode, reason, recorded_at)`**, is append-only
like the rest. The store's mode is its latest row, `sorted` or `legacy`:

- The first row is seeded by a post-schema step that runs after `initializeSchema` in
  `openDatabase` (`db.ts:76–77`). Migrations run before the schema exists, so the step can't
  be a migration probe. When `scope_mode_changes` is empty, the step writes:
  - `legacy` if `file_ledger` or `scope_reconciliations` has any row;
  - `sorted` otherwise.
  At that moment nothing has been written by this version yet, so the rows present are
  exactly the rows from before the upgrade.
- A `legacy` store gets a `sorted` row when its first sorting row is recorded. The tool's
  response says so.

### 2.2 Patterns

A pattern is one of three things:

- an exact path;
- a directory prefix ending in `/` (`design/` covers everything under it);
- a glob, where `*` matches within one path segment and `**` matches across segments.

One small matcher in `src/scope.ts` handles all three, with a table-driven test. Patterns
are normalized (no leading `./`, no `..`, no `.amanuensis/`) and refused otherwise.

**Precedence when more than one rule matches a path:**

1. The owner's rules win over everything.
   - Between two of them, the more specific pattern wins: exact, then the longer prefix or
     the glob with more literal characters.
   - On a tie, the later rule wins.
   - An `include` returns the path to the survey set.
2. Then gitignore: a path ignored at the revision is excluded.
3. Then sorting, where the most specific pattern wins and the later row breaks a tie.
   - `meta` excludes the path.
   - `product` keeps it in.
4. In `sorted` mode, a path no sorting row covers is **unsorted**.
   - It stays in the survey set, so it is still owed a ledger row.
   - It also counts as unsorted.

### 2.3 Gitignore at a revision

The ignore files are read as they are at the revision, not from the working tree. Then the
survey set is a property of the commit, like the tree digest.

The server:

1. finds every `.gitignore` in the tree at the revision;
2. writes those blobs into a scratch directory that is a fresh `git init`, with
   `core.excludesFile` set to `/dev/null` and `info/exclude` empty;
3. runs `git check-ignore --no-index --stdin -z` over the tree's paths.

That gives git's own semantics: negation, anchoring, directory patterns and nested ignore
files. The local `.git/info/exclude` and a global excludes file are not part of a commit, so
they are deliberately left out.

Every call goes through `src/subprocess.ts` with its timeout. The result is cached under a
key with two parts:
- every ignore file's path together with its blob id, so moving an unchanged `.gitignore`
  changes the key;
- the digest of the tree's path set, so a commit that adds a tracked path the existing rules
  ignore changes the key.

A repeat resolution with the same key runs no git command. If git fails, the reconciliation fails and names the command.
It never silently counts nothing as ignored.

### 2.4 Tools

- **`set_scope_rule({pattern, action, reason, owner_words, supersedes?})`**
  - Records an owner rule.
  - Its description says to call it only when the owner has asked, and to quote them in
    `owner_words`.
  - Returns the paths the rule now covers at the last reconciled revision, as a count plus
    a capped list, and reminds the caller to run `detect_changes`.
- **`record_scope_sorting({pattern, category, description, inventory?, supersedes?})`**
  - `inventory` is a list of `{file_path, line_range, excerpt}`.
  - A `meta` row is refused when its inventory is missing, when it cites a file outside its
    pattern, or when it lacks a range and an excerpt.
  - The citations are accepted even when the path is already excluded. Re-sorting an
    excluded prefix has to be possible.
  - Returns what `set_scope_rule` returns.
- **`get_scope({revision?, path?})`**
  - Read-only.
  - Returns the mode, the active rules and sorting rows, and the counts for each source at
    the last reconciliation.
  - Lists the unsorted paths, capped with a count.
  - With `path`, it names which rule or source decides that path, or that none does.

Each new refusal goes into the refusal register and passes `test-refusal-parity.mjs`.
`DEVELOPMENT.md`'s tool inventory is regenerated.

### 2.5 Reconciliation and the two refusals

**`detect_changes`** (`src/tools/git.ts:270`) resolves the survey set at the revision and
then works on that set:

- `unledgered` is computed over the survey set.
- `exempt` keeps today's meaning, but only inside the survey set.
- Ledger rows for excluded paths are reported as `excluded_with_rows`. They aren't deleted,
  and they carry no obligation.
- It writes `scope_exclusions` and the new reconciliation columns.
- Its response adds:
  - `scope: {mode, survey_paths, excluded: {gitignore, user, meta}, unsorted, unsorted_paths}`
  - `excluded_with_rows`

**Standing** (`readReconciliationStanding`, `invariants.ts:1325`) also requires two things:
- the recorded `scope_digest` equals the digest of the current rules and sorting rows;
- the recorded `exclusion_digest` equals the digest recomputed from the
  `scope_exclusions` rows that carry its id. Recording a
rule therefore takes away standing until `detect_changes` runs again. The refusal names that
as its reason: "the scope rules have changed since the reconciliation recorded there was
taken".

**The `scope_digest` formula** is restated in the checker and the materializer, as
`tree_digest` is today (GP24):

- SHA-256 over the active rows;
- rules first, then sorting;
- each row as `kind \0 id \0 pattern \0 action-or-category`;
- rows sorted by id and joined with `\n`.

**The `exclusion_digest` formula** is restated the same way:
- SHA-256 over one reconciliation's `scope_exclusions` rows;
- each row as `file_path \0 source \0 rule_id-or-empty`;
- rows sorted by path and joined with `\n`.

The checker and the read-back recompute both digests before they trust the set.

**The tree digest** keeps its meaning: the whole tree. The survey set is the tree minus that
reconciliation's `scope_exclusions` rows.

**The `ledger_digest` formula** is restated the same way:
- today's formula, one `file_path \0 classification-or-empty` part per ledger row, sorted
  and joined with `\0`;
- leaving out the rows on paths that reconciliation's `scope_exclusions` rows name (§2.6a);
- so a reader takes it once per candidate reconciliation, with that candidate's exclusions.

**Publication** (`requireCompleteReconciliation`, `invariants.ts:1455`) is also refused, in
`sorted` mode, while `unsorted > 0`. It names up to 20 unsorted paths.

**The `mapped` advance** keeps its current rule: a reconciled store is enough. So a pilot
subsystem can be mapped before every path is sorted. The completion check (SV1) is where
sorting has to be complete.

### 2.6 Writes refused on excluded paths

**A new write guard, `requireSurveyScopeForWrite`**, sits apart from
`requireWorkspaceSourcePath` (`helpers.ts:239`). That function stays a path normalizer with no
context, because reads use it too (`standing.ts:299`, `code-index.ts:356`), and §2.7 promises
those reads keep working.

The guard covers every route by which a **new** durable record can name or rest on a source
path. The routes were found at `6a6dc43` by searching `src/tools/` for every argument that
names a path or carries evidence, and for every `INSERT INTO evidence`.

**Routes that name a path or write evidence (SC10):**

| Tool file | Argument or sink |
|---|---|
| `files.ts` | `add_files_to_scope` `files[].file_path`; `update_file_classification` `file_path` |
| `stale.ts` | `clear_staleness` `file_path` (`retire_ledger_file` is the exception below) |
| `evidence.ts` | `add_evidence` `file_path` |
| `review-analysis.ts` | `land_review_pass` `new_evidence[]`, which inserts evidence directly (`:966`) |
| `impact.ts` | the evidence it inserts (`:825`) |
| `vocabulary.ts` | `define_term` `first_seen` |
| `field-notes.ts` | `add_field_note` `location` |
| `findings.ts` | `add_finding` `primary_files` |
| `carried.ts` | `primary_files` on a carried finding's successor |
| `dispatch.ts` | `file_path` |

**Routes that attach an existing evidence row (SC12).** Each refuses an evidence row whose
`file_path` is excluded, whether it arrives as `evidence_id` or `evidence_ids`:

| Tool file | Arguments |
|---|---|
| `claims.ts` | `evidence_ids`, in three tools |
| `evidence.ts` | `attach_evidence_to_disposition`, `attach_evidence_to_finding` `evidence_id` |
| `dispositions.ts` | `evidence_ids`, `evidence` |
| `findings.ts` | `evidence_id` |
| `stale.ts` | `evidence_id` |
| `explanations.ts` | `evidence_ids` |
| `narratives.ts` | `evidence_ids` |
| `project-records.ts` | `evidence_ids`, including runtime boundaries |
| `diagnosticity.ts` | `evidence_id`, `evidence_ids` |
| `decisions.ts` | `evidence_id` |
| `contradictions.ts` | `evidence_id` |
| `claim-marks.ts` | `evidence_id` |
| `carried.ts` | `evidence_id` (`attach_carried_evidence`) |
| `chorusmith-adapter.ts` | `evidence_ids`, `evidence` |

**Exempt, with reasons the SC12 census table carries:**
- `artifacts.ts` `path` names a store artifact, not a source path.
- `import.ts` `path` names a store archive.
- `compare.ts` `paths` names store paths.
- `code-index.ts` `path` is a read.
- `evidence.ts` `get_evidence` `file_path` is a read.
- `scope.ts`:
  - `get_scope` `path` is a read;
  - `record_scope_sorting` `inventory[].file_path` writes only `scope_inventory`, never
    `evidence` (§2.1), and it has to reach excluded prefixes.
- Any other read the census finds is added here with its reason, by the step that finds it.
  A write never is.

The SC12 gate builds a census from the registered tool schemas at run time. It finds every
property named `file_path`, `location`, `first_seen`, `path`, `paths`, `files`,
`primary_files`, `evidence_id`, `evidence_ids`, `new_evidence` or `evidence`, at any depth.
Each tool it finds must appear in one of the tables above, so a new tool that isn't listed
turns the gate red.

Under the guard:

- An excluded path is refused, with its source, its rule and how to bring it back: "an
  owner include rule".
- This follows the owner's rule that meta is "not included in any work".
- One consequence is accepted: a survey can't cite a `design/` spec as evidence while
  `design/` is meta. A record of intended behavior then rests on the code and its comments.

Reads are never refused: `describe_locus`, `outline_file`, `read_symbol`,
`get_evidence` and the rest answer for an excluded path (§2.7).

**The one exception among writes:** `retire_ledger_file` accepts an excluded path, so an agent can clear
`excluded_with_rows`. The sorting inventory doesn't go through these tools at all (§2.1).

### 2.6a Records made before a path was excluded

A path can leave the survey set after records about it exist. For example, an owner rule is
recorded on a store that has already surveyed it, or a legacy store gains a gitignore
match. Nothing is deleted. Each kind of record is treated as follows:

- **Its ledger rows become inactive.**
  - Standing ignores them, because the scope exclusion decides.
  - `requireExaminedScope` (`invariants.ts:1008`) skips them, so a `candidate` row on an
    excluded path doesn't block `mapped`.
  - The ledger digest leaves them out.
  - Pages don't print them.
  - They create no work:
    - `detect_changes` doesn't map their changes to subsystems (`git.ts:229`) or mark them
      stale;
    - the stale backlog (`stale.ts:146`), and `get_attention`'s stale and hot-spot counts
      (`locus.ts:2788`, `:2925`), leave them out;
    - change impact neither maps a change to them nor opens a gap for one
      (`impact.ts:242`, `:271`);
    - review planning doesn't make them required work (`review.ts:634`);
    - a refresh run doesn't block on them (`refresh.ts:424`).
  - A change that touches only excluded paths creates no work on any of those routes.
  - `detect_changes` lists them as `excluded_with_rows`.
  - An include rule makes them active again, as they were. Their `ref_sha` is then checked
    for staleness like any other row.
- **Its evidence, claims, findings, dispositions and vocabulary anchors stay.** They are
  published, but **without the path becoming a destination**:
  - The citation prints its path as plain text: no link to a Files anchor or a source page,
    no locus-index entry, no search-index entry.
  - A citation says where a finding's support is, and dropping it would hide the finding's
    evidence. Printing it as text keeps that, without listing the path as surveyed.
  - Read-back checks that no link on any page targets an anchor that doesn't exist.
  - `detect_changes` reports `records_citing_excluded` (a count, plus a capped list of
    record ids), so the owner can see them.
  - In a store that sorted first, as a fresh survey does, this list stays empty, because
    the write guard in §2.6 prevents such records.
- **A subsystem whose ledger rows are all excluded is outside the survey.**
  - No status advance is owed for it.
  - Clauses 2, 3 and 4 of the completion checker skip it and name it.
  - `get_dashboard` and `list_subsystems` report it as `outside_survey`.
  - Its page is still published, so its claims, dispositions and findings keep a home, and
    read-back keeps the destinations it expects (`readback.py:2404`).
    - The page is headed "Outside this survey" and carries no file listing.
    - Its citations print as plain text.
  - **A seam with at least one endpoint outside the survey is outside the survey too.**
    - It owes no assessment.
    - It is drawn on no diagram.
    - It is listed on the outside subsystem's page.
  - This case arises only in a store that had records before it had rules. A fresh survey
    sorts first, so it can't arise there.

### 2.7 Readers

- **`describe_locus` on an excluded path:**
  - Returns standing `excluded`, with `exclusion: {source, rule_id, pattern, reason}`.
  - Change `fileStanding` (`standing.ts:839`), and add a step to `resolveLocus`
    (`standing.ts:357`) before "named nowhere".
  - **Two kinds of `excluded`, kept apart.** Today's `excluded` (a ledger classification
    inside the survey set, such as `generated-ignore` or `deferred-with-reason`) answers
    `exclusion.source: "ledger"` with its classification.
    - Only the three scope sources are absent from pages. A ledger-exempt path, such as a
      generated golden, still prints, as it does today.
  - The `excluded` value's meaning changes in the canonical contract,
    `mcp-server/contracts/conspectus-vocabulary.json`. `vocabulary.ts` is then regenerated
    with `scripts/gen-vocabulary.mjs` and passes `--check` and `--check-sql`; it's never
    edited by hand.
  - The `exclusion` object is added to the closed response schema,
    `mcp-server/contracts/locus-account.schema.json` (around :285).
- **`get_dashboard`** gains `excluded_paths` (by source) and `unsorted_paths`.
  `unclassified_paths` keeps counting unledgered gaps, now over the survey set.
- **The code index:**
  - `find_symbol` leaves out definitions in excluded paths by default, and accepts
    `include_excluded: true`.
  - `search_records` hits are records, not paths (`code-index/records.ts:513`). A hit is
    left out only when its subject is itself outside the survey: a file locus on an
    excluded path, or a subsystem outside the survey.
    - A record that cites both included and excluded evidence is kept.
    - `include_excluded: true` restores the left-out hits.
    - Filtering happens before pagination, so a page is never short because hits were
      dropped after it was cut.
    - History search follows the same rule.
  - `outline_file` and `read_symbol` still read an excluded path, because reading isn't
    recording, and their answers carry `excluded` and its source.
- **The server instructions** (`cli.ts:57`, `index.ts:42`) name the new standing source.

### 2.8 Pages

- **Paths excluded by scope are absent from every listing and index.** Ledger-exempt paths
  print as they do today. Nothing reaches the pages from `scope_inventory`. The only place
  such a path can appear is an older record's citation, printed as plain text (§2.6a). The
  listings and indexes are:
  - the Files page (`renderers.py:4764`);
  - the coverage bars (`diagrams.py:1124`; the check at :1219 becomes survey set = in-tree
    + unledgered);
  - the not-yet-surveyed page (`renderers.py:4945`);
  - the unmeasured-coverage helpers (`renderers.py:4850–4917`);
  - the locus index and the search index, built in `materializer/amanuensis_materializer/core.py`
    (`:149`), including entries for evidence symbols.
- **Coverage is computed over the survey set.**
- **The overview** (`render_index`, coverage block at `renderers.py:1656–1780`) gains one
  line when anything is excluded. For example: "Outside this survey: 2 paths ignored by
  git, 280 the owner excluded (`scholiast/`, `design/`, `dev/activation-evidence/`), 0
  sorted as meta."
  - It lists the owner's rules by pattern, and never lists paths.
  - With nothing excluded, there is no line.
- **Read-back** (`readback.py:870` `tree_paths`, `:949` `obligation_paths`, `:2785–2800`)
  takes the survey set from `scope_exclusions` and checks `scope_digest` with the restated
  formula. A store with no scope tables reads as today.
- **`REQUIRED_VIEWS`** in `materializer/amanuensis_materializer/db.py:50` and
  `mcp-server/src/db.ts:65` stays identical between the two.

### 2.9 Migration

- **New tables** come from `schema.sql`, which runs on every open (`db.ts:307`).
- **The six new reconciliation columns** use one numbered migration step in `runMigrations`, as
  probe 8.
- **`scope_mode_changes`** gets its first row from the post-schema step in §2.1, not from
  a migration probe.
- **Legacy reconciliations** that predate these columns have `scope_digest` null. They count
  as standing only while the store has no rules and no sorting rows, so an untouched legacy
  store doesn't lose its standing by being upgraded.
- **One behavior change for legacy stores:** gitignore matches leave the survey set. They
  show up as `excluded_with_rows` if they were ledgered.
- **The legacy outcomes are tested on the AxiomDB-shaped and self-shaped golden stores**, in
  SC1's gate. `test-existing-store-migration.mjs` needs a private store and exits 2 without
  one, so it is not a lane gate.

### 2.10 The completion checker

- **`dev/check-store-fully-surveyed.mjs`, clause 1:**
  - The survey set is the tree minus the standing reconciliation's `scope_exclusions`
    (restated, not imported; see `:172`).
  - It checks `scope_digest`.
  - In `sorted` mode, it adds an obligation `unsorted:<path>`.
- **Clauses 2, 3 and 4** skip a subsystem, and a seam, that is outside the survey
  (§2.6a), and name it in their output.
- **Clauses 5–7** are unchanged.

### 2.11 Skill

- **`references/onboarding.md`** gets a new Phase 0b, "What the survey leaves out", run
  after Phase 0 and before Phase 1. In order, the agent:
  1. calls `set_git_state` (moved here from Phase 7), because `detect_changes` refuses
     without it (`git.ts:193`);
  2. records any owner rule the request states, with the owner's words quoted;
  3. runs `detect_changes` to see the gitignore matches;
  4. sorts **every** path not yet excluded by prefix, code included: `mcp-server/src/` gets
     a `product` row too. Every uncovered path counts as unsorted.
     - Product is code, or material relevant to code: tests, fixtures, build, CI,
       configuration, and documentation that ships or describes use.
     - Meta is material about the project rather than part of it: plans, specs and reviews
       of past work, research, recorded evidence, and notes.
  5. for each meta prefix, lists its files, opens the first lines of a sample (every file up
     to 5, otherwise 5 spread across the listing), and cites them;
  6. records the sorting;
  7. runs `detect_changes` again and confirms `unsorted` is 0.

  When in doubt, the agent sorts as product, because a wrong product costs reading time while
  a wrong meta hides code. It logs the doubt with `record_open_question`.
- **`phase-1-scope.md`:** paths outside the survey set get no ledger row.
- **`notes.md`:** what `excluded` with a source means when answering about a locus.
- **`refresh.md`:** new paths under a meta prefix inherit; new paths under no rule are
  unsorted and need sorting before publication.
- **`SKILL.md`'s routing table:** "ignore X" / "don't survey X" calls `set_scope_rule`
  exclude, and "survey X after all" calls it with include.

## 3. Packets

The format and lane conventions are those of `design/semantic-index/plan.json`:

- one gate per packet, with the marker `GATE <id>`, red before and green after, checked by
  the launcher;
- regression commands run serially;
- every new gate is added to `.github/workflows/test.yml`, since these are product tests;
- Sonnet, unless a packet names Opus.

**When a step adds a refusal, it adds the skill sentence that refusal needs in the same
step.** `test-refusal-parity.mjs` checks the real skill, so a refusal whose sentence waited
for SC8 would leave every gate in between red. The files:
- SC3: `references/onboarding.md`;
- SC4: `references/phase-5-packaging.md`, for the unsorted publication refusal;
- SC10 and SC12: `references/records.md`.

### Slice S1 · Records and resolution

- **SC0 Record the plan in BACKLOG.md.**
  - The scope item links this plan and states the owner's rule and F1–F3.
  - Gate: `dev/test-scope-backlog.mjs`.
- **SC1 Schema and migration (Opus).** Covers §2.1 and §2.9.
  - Deliverables:
    - `schema.sql`;
    - `db.ts`: probe 8 for the six columns, and the post-schema mode seeding;
    - the new trigger pairs in `mcp-server/contracts/append-only-tables.txt`, whose parity
      check is two-sided.
  - Gate: `mcp-server/test-scope-schema.mjs`, which checks that:
    - `scope_rules`, `scope_sorting`, `scope_inventory`, `scope_exclusions` and
      `scope_mode_changes` exist, and updates and deletes are refused;
    - the effective mode is the latest `scope_mode_changes` row;
    - the six columns are added to an existing store with its rows unchanged;
    - a store with ledger rows opens as `legacy`, and an empty one as `sorted`;
    - opening twice is idempotent and adds no second mode row;
    - the AxiomDB-shaped and self-shaped golden `memory.sql` stores open as `legacy`;
    - **a positive standing fixture:**
      - The gate makes a scratch git repository with two commits and loads the
        pre-upgrade schema (`git show 6a6dc43:mcp-server/src/schema.sql`).
      - It writes a reconciliation row there, using the restated `tree_digest` and
        `ledger_digest` formulas, and asserts that it stands under the pre-upgrade rules.
      - It opens the store with this server and asserts that the reconciliation still
        stands.
- **SC2 Resolution (Opus).** §2.2 and §2.3, in `src/scope.ts`. Gate:
  `mcp-server/test-scope-resolve.mjs`, which checks that:
  - a table of at least 30 patterns against paths gives the expected matches, including
    `**`, a trailing `/`, an exact path, and refusal of `..`, a leading `/` and
    `.amanuensis/`;
  - precedence:
    - an owner include beats gitignore and meta;
    - between owner rules, the more specific wins, so an exact exclude inside an included
      prefix stays excluded;
    - the later rule wins a tie;
    - the same rules apply among sorting rows;
  - gitignore at a revision:
    - a negated pattern;
    - a nested `.gitignore`;
    - a directory pattern;
    - an ignore file changed between two commits gives two different sets;
    - a commit that adds a tracked path the existing rules ignore, with the ignore files
      unchanged, gives a different set;
    - an identical `.gitignore` moved to another directory gives a different set;
    - a working-tree edit to `.gitignore` changes nothing;
    - a pattern in `.git/info/exclude` changes nothing;
  - a repeat resolution with the same key runs no git command;
  - a git failure is an error, never an empty set;
  - every subprocess goes through `src/subprocess.ts`, and the existing subprocess gate
    still passes.

### Slice S2 · Tools and reconciliation

- **SC3 The three tools (Opus).** §2.4.
  - Deliverables:
    - `src/tools/scope.ts`;
    - registration in `src/index.ts`;
    - the new refusals in `contracts/refusal-parity.json`, with their sentences in
      `references/onboarding.md`;
    - `DEVELOPMENT.md`'s inventory.
  - Gate: `mcp-server/test-scope-tools.mjs`, which checks that:
    - a rule without `owner_words` is refused;
    - a `meta` sorting without an inventory is refused, and so is one citing outside its
      pattern or without a range and an excerpt;
    - an inventory excerpt that isn't at its lines is refused;
    - inventory rows never appear in `evidence`;
    - an inventory on an already-excluded prefix is accepted;
    - `supersedes` withdraws a row;
    - `get_scope` names the deciding rule for a path;
    - the first sorting row moves a `legacy` store to `sorted`, appends a mode row and says
      so;
    - `test-refusal-parity.mjs` passes;
    - the inventory regenerates with `--check` clean.
- **SC4 Reconciliation core (Opus).** §2.5, and the parts of §2.6a about ledger rows.
  - Deliverables:
    - `src/tools/git.ts` (the reconciliation itself);
    - `src/invariants.ts`: standing, both digests, `requireExaminedScope`, publication;
    - `src/tools/materialize.ts`;
    - `contracts/refusal-parity.json`, with its sentence in `phase-5-packaging.md`;
    - `test-scope-reconciliation.mjs`, whose positive publication control (`:1069`) now
      records a `product` sorting row so that it still publishes in `sorted` mode. The control
      stays a real control, and the change is listed in `notes`.
  - Gate: `mcp-server/test-scope-reconcile.mjs`, which checks that:
    - `unledgered` is computed over the survey set;
    - `scope_exclusions` and both digests are written in the same transaction as the
      reconciliation;
    - the ledger rows, the ledger digest and the counts are read inside that transaction;
    - standing:
      - a rule recorded after a reconciliation takes it away, with the named reason;
      - an extra, swapped or re-sourced `scope_exclusions` row takes it away through
        `exclusion_digest`;
    - publication and `mapped`:
      - publication is refused while `unsorted > 0` in `sorted` mode, and allowed in
        `legacy`;
      - `mapped` is allowed with unsorted paths;
    - excluded rows with ledger rows:
      - they are reported, not deleted;
      - a `candidate` row there doesn't block `mapped`;
      - the ledger digest leaves them out;
      - an include rule reactivates them;
    - `records_citing_excluded` lists a claim made before the rule;
    - an untouched legacy store keeps its standing after the upgrade.
  - Its regression list includes `test-scope-reconciliation.mjs`,
    `test-derived-staleness.mjs`, `test-consumer-route.mjs`, `test-carried-findings.mjs`
    and `test-evidence-anchors.mjs`.
- **SC11 Consumers of inactive rows (Opus).** The work-creating routes of §2.6a.
  - Deliverables:
    - `src/tools/git.ts`: the changed-file-to-subsystem mapping and staleness marking;
    - `src/tools/stale.ts` (the backlog);
    - `src/tools/locus.ts` (`get_attention`);
    - `src/tools/impact.ts` (`:242`, `:271`);
    - `src/tools/review.ts` (`:634`);
    - `src/tools/refresh.ts` (`:424`).
  - Gate: `mcp-server/test-scope-consumers.mjs`, using one store with an inactive row on an
    excluded path, and a commit that changes only that path. It checks that:
    - `detect_changes` neither maps the change nor marks the row stale;
    - the stale backlog and `get_attention` leave it out;
    - change impact neither maps it nor opens a gap;
    - review planning doesn't require it;
    - a refresh run doesn't block on it;
    - **the positive control:** the same commit on an in-scope path creates work on every
      one of those routes.

### Slice S3 · Write guard and checker

- **SC10 The write guard for paths and new evidence (Opus).** §2.6, first table.
  - Deliverables:
    - `requireSurveyScopeForWrite` in `src/helpers.ts`;
    - each tool file in the first table of §2.6;
    - `contracts/refusal-parity.json`, with its sentence in `references/records.md`.
  - Gate: `mcp-server/test-scope-write-guard.mjs`, which checks that:
    - every route in the first table refuses an excluded path with its source, its rule
      and the include remedy;
    - `land_review_pass` refuses `new_evidence` on an excluded path;
    - change impact writes no evidence row for one;
    - `retire_ledger_file` accepts an excluded path;
    - `record_scope_sorting`'s inventory is not refused;
    - reads still answer: `describe_locus`, `outline_file`, `read_symbol` and
      `get_evidence` on an excluded path return a result, not a refusal.
- **SC12 The write guard for evidence attachments, and the census.** §2.6, second table and
  census.
  - Deliverables:
    - each tool file in the second table of §2.6;
    - `contracts/refusal-parity.json`;
    - `references/records.md`.
  - Gate: `mcp-server/test-scope-attach-guard.mjs`, which checks that:
    - every route in the second table refuses an evidence row on an excluded path, whether
      it comes as `evidence_id` or as `evidence_ids`;
    - the same routes accept an evidence row on an included path;
    - **the census:**
      - Every registered tool with one of §2.6's argument names, at any depth, is guarded
        or listed as exempt with its reason.
      - Adding a dummy tool with an `evidence_ids` argument to the census input turns the
        gate red.
- **SC5 The completion checker.** §2.10.
  - Deliverable: `dev/check-store-fully-surveyed.mjs`.
  - Gate: `dev/test-store-fully-surveyed-scope.mjs`, which checks that:
    - the survey set excludes the recorded paths;
    - both digests are recomputed, and a tampered exclusion row or a changed rule makes
      clause 1 red with its reason;
    - the ledger digest leaves out the excluded rows, so a store with an inactive row
      reconciles;
    - an unsorted path in `sorted` mode is a named obligation;
    - clauses 2, 3 and 4 skip a subsystem, and a seam, that is outside the survey, and name
      them;
    - a legacy store reads as before.

### Slice S4 · Readers and pages

- **SC6 Readers.** §2.7, and `outside_survey` in the readers' responses.
  - Deliverables:
    - `standing.ts`;
    - the vocabulary contract and its regenerated `vocabulary.ts`;
    - `locus-account.schema.json`;
    - `tools/locus.ts`, `tools/dashboard.ts`, `tools/subsystems.ts` (`list_subsystems`),
      `tools/code-index.ts` (all four index handlers) and `code-index/records.ts`;
    - `cli.ts` and `index.ts`.
  - Gate: `mcp-server/test-scope-standing.mjs`, which checks that:
    - `describe_locus` returns `excluded` with source, rule and pattern for each of the
      three sources, and with `source: "ledger"` and its classification for a ledger-exempt
      path;
    - the response validates against `locus-account.schema.json`;
    - `gen-vocabulary.mjs --check` and `--check-sql` pass;
    - an included path that is also gitignored has ordinary standing;
    - the dashboard counts, and `get_dashboard` and `list_subsystems` report
      `outside_survey`;
    - `find_symbol` leaves out excluded paths unless `include_excluded`;
    - `search_records` follows §2.7's rule:
      - it leaves out an excluded file locus and a subsystem outside the survey;
      - it keeps a record that cites both included and excluded evidence;
      - it filters before pagination: page 1 is full when more hits exist;
    - `outline_file` and `read_symbol` on an excluded path answer, and carry `excluded`;
    - the unledgered case of `test-locus-standing.mjs` still holds for an in-scope path.
- **SC7 Pages and read-back (Opus).** §2.8 and §2.6a's publication rule.
  - Deliverables:
    - `renderers.py`, `diagrams.py`, `readback.py`, `db.py` and `core.py` (the locus and
      search index entries, evidence symbols included).
  - Gate: `materializer/test-scope-pages.py`, which checks that:
    - with each kind of exclusion, a store publishes with no excluded path in any listing,
      the search index or the locus index;
    - a store with records made before an exclusion prints those citations as plain text,
      with no link;
    - no link on any page targets an anchor that doesn't exist;
    - a ledger-exempt golden still prints;
    - **a subsystem outside the survey, with claims, dispositions and a finding:**
      - its page is published, headed "Outside this survey", with no file listing;
      - all three record kinds appear on it;
      - its seam appears on no diagram;
    - coverage is computed over the survey set;
    - the overview line names the counts and the owner's patterns, and is absent when
      nothing is excluded;
    - read-back:
      - it is green on a valid store;
      - it goes red when a `scope_exclusions` row is added, swapped or re-sourced, or when a
        rule changes without a reconciliation;
    - a store with no scope tables renders byte-identical to the golden corpus.
  - If the corpus has to change, this packet regenerates it with
    `cd materializer && python3 make-golden.py --packet SC7 --recorded`, and says why in
    the commit.
  - Its regression list includes the materializer tests on unmeasured coverage, overview
    truthfulness, coverage badges, ledger grouping, lens pages, the search index and
    convert-unresolved.

### Slice S5 · Skill and docs

- **SC8 Skill.** §2.11.
  - Gate: `dev/test-skill-scope.mjs`. It has two halves:
    1. **Text.** Onboarding's Phase 0b exists, with its seven steps in order:
       - `set_git_state` comes first, and Phase 7 no longer calls it first;
       - the steps name the tools, the sample rule, the rule that code gets a `product`
         row, and the when-in-doubt rule;
       - the routing rows exist;
       - `phase-1-scope.md`, `notes.md` and `refresh.md` carry their sentences;
       - every refusal sentence the earlier steps added is still there.
    2. **An executable fresh-store control**, run against the built server over stdio in a
       scratch git repository:
       - Phase 0b's tool calls run in the skill's order: `set_git_state`, `set_scope_rule`,
         `detect_changes`, `record_scope_sorting` for every prefix (code included, meta with
         an inventory), then `detect_changes` again.
       - It ends with `unsorted` 0.
       - The negative arm leaves out `set_git_state`, and `detect_changes` then refuses. So
         the control can turn red.
  - The skill's code-index fixture (`dev/fixtures/skill-code-index`) is updated if its test
    requires it.
- **SC9 Docs and release notes.**
  - `README.md` gets one sentence under "Trust is part of the architecture" on what a
    survey leaves out.
  - `INSTALLATION.md` gets nothing unless a command changes.
  - `HISTORY.md` gets an unreleased entry.
  - `mcp-server/DEVELOPMENT.md` gets a short section on the survey set.
  - Gate: `dev/test-scope-docs.mjs`.

**Completion**, run serially:
- every gate;
- `npm run build && npx biome check src/`;
- `test-smoke.mjs`;
- `test-refusal-parity.mjs`;
- `test-package-artifact.mjs`;
- `scripts/check-sql-identifiers.mjs`;
- `gen-tool-inventory.mjs --check`;
- the full CI step list from `test.yml`, serially, as the final review's first act.

## 4. Acceptance after the lane, outside it

A blind sorting test, run by the planning session after the lane finishes and before the
merge question:

- **The setup:**
  - Clone this repository at the lane's tip into a scratch directory.
  - Run one top-level `claude -p` session (Opus), with only the lane's built server and the
    branch's skill.
  - Ask it to run onboarding Phase 0b only, with no owner rules.
- **The measure:** compare its meta set with the owner's list (`scholiast/`, `design/`,
  `dev/activation-evidence/`) and its gitignore set with the two known paths.
- **The report** lists every disagreement for the owner. No fix is made by hand.

## 5. Not in this plan

- A tracked `.amanuensisignore` file. F1 chose the store.
- Deleting ledger rows when a path leaves the survey set. They are reported instead, and
  `retire_ledger_file` clears them.
- The code index skipping excluded paths when it builds the index. It filters at query
  time, because the index is a cache keyed by content.

## 6. Reviews and their dispositions

### 6.1 Codex, survey plan, 2026-11-23 (two reads)

Five of the ten findings in the first read of `design/self-survey/PLAN.md` changed this plan.
Each was accepted:
- **Scope needs its own witness** beyond the tree and ledger digests. That is `scope_digest`.
- **Readers restate the formulas rather than import them.** The materializer and the
  checker re-derive the tree themselves, so they need the formulas restated (§2.5).
- **Rows kept for excluded paths must be inactive**, and scope exclusion must be kept apart
  from the ledger's `excluded` (§2.6a, §2.7).
- **Refusing ledger rows doesn't keep a path out of the pages.** Evidence, the code index and
  vocabulary anchors also lead there (§2.6, §2.7).
- **`detect_changes` reads the ledger outside its transaction.** Fixed in SC4.

### 6.2 Codex, this plan, 2026-11-23

There were 15 findings, and all 15 were accepted. SC4 was then split in two, and SC10 now
holds the write guard:

| # | Finding | Where it changed the plan |
|---|---|---|
| 1 | Phase 0b can't reconcile before `set_git_state` | §2.11 step 1; SC8's executable control |
| 2 | The gitignore cache key misses added paths and moved files | §2.3 key; SC2 cases |
| 3 | A single-row settings table can't be append-only and also change | `scope_mode_changes` (§2.1) |
| 4 | One shared path check would also refuse reads | a separate write guard (§2.6); SC10 read checks |
| 5 | Publishing old citations contradicts "absent everywhere" | plain-text citations and link integrity (§2.6a, §2.8); SC7 |
| 6 | Other routes still write new records about a path | full route list (§2.6); SC10, which also checks itself against the registered tools |
| 7 | Inactive rows still create refresh and attention work | §2.6a; SC4 |
| 8 | Subsystems with every path excluded still owed survey work | `outside_survey` (§2.6a, §2.10); SC4, SC5, SC6, SC7 |
| 9 | "Include always wins" contradicts precedence by specificity | §0 restated; SC2 |
| 10 | Phase 0b leaves recognized code unsorted | code gets `product` rows (§2.11 step 4) |
| 11 | No witness over the resolved exclusion set | `exclusion_digest` (§2.1, §2.5); SC4, SC5, SC7 |
| 12 | Missing deliverables: `append-only-tables.txt`, `refusal-parity.json`, `code-index.ts`, `core.py` | §3 |
| 13 | SC4 breaks the existing publication control | SC4 updates that control |
| 14 | `record_vocabulary` doesn't exist; a line number was wrong | removed; `invariants.ts:1325` |
| 15 | `make-golden.py` needs `--packet` | SC7 command |

### 6.3 Codex, this plan, second read, 2026-11-23

There were 11 findings, and all 11 were accepted:

| # | Finding | Where it changed the plan |
|---|---|---|
| 1 | Change impact, review and refresh still create work for excluded paths | §2.6a; new SC11, with a positive control |
| 2 | The write census missed `land_review_pass`'s `new_evidence` and singular `evidence_id`; deliverables were short | the route tables and census in §2.6; split into SC10 (paths) and SC12 (attachments) |
| 3 | Refusals landed before their skill sentences | each step adds its own sentence (§3 preamble) |
| 4 | Mode seeding ran before its table existed | post-schema seeding (§2.1, §2.9) |
| 5 | Seams touching an excluded subsystem were still owed work | §2.6a, §2.10 clause 4; SC5, SC7 |
| 6 | Hiding the page dropped claims and dispositions | the page is kept, headed "Outside this survey" (§2.6a); SC7 |
| 7 | SC4 asserted `outside_survey`, which SC6 owns | moved to SC5 and SC6 |
| 8 | The migration fixtures had no standing to preserve | SC1's positive standing fixture |
| 9 | `search_records` filtering was unspecified | §2.7 rule; SC6 |
| 10 | SC8's negative arm couldn't turn red | it leaves out `set_git_state` |
| 11 | SC4 and SC10 were too large for one session | split into SC4 and SC11, and SC10 and SC12 |

A focused third read checked that each of these was resolved. It found one gap: the census
exemptions omitted three legitimate argument sites, `get_evidence`, `get_scope` and the
sorting inventory. They were added to §2.6.
