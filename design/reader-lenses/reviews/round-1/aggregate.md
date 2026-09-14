# Aggregate of independent design reviews

Reviewers (N=2, exact fan-in): codex, claude.
No deliberation round; verdicts are laid side by side, never merged.

## Verdicts per claim

| Claim | codex | claude |
|---|---|---|
| C1 | overturned | upheld |
| C2 | overturned | qualified |
| C3 | upheld | upheld |
| C4 | upheld | overturned |
| C5 | upheld | qualified |
| C6 | overturned | qualified |
| C7 | upheld | upheld |
| C8 | qualified | upheld |
| C9 | overturned | upheld |
| C10 | upheld | upheld |
| C11 | qualified | upheld |
| C12 | overturned | qualified |
| C13 | overturned | qualified |
| C14 | upheld | upheld |
| C15 | upheld | upheld |
| C16 | overturned | qualified |
| C17 | qualified | upheld |
| C18 | overturned | qualified |
| C19 | qualified | upheld |
| C20 | overturned | qualified |
| C21 | upheld | upheld |
| C22 | upheld | upheld |
| C23 | overturned | overturned |
| C24 | overturned | qualified |
| C25 | upheld | upheld |
| C26 | upheld | upheld |
| C27 | overturned | qualified |
| C28 | overturned | qualified |
| C29 | upheld | qualified |
| C30 | upheld | upheld |
| C31 | qualified | upheld |
| C32 | qualified | upheld |
| C33 | overturned | upheld |
| C34 | qualified | upheld |
| C35 | overturned | qualified |
| C36 | upheld | upheld |
| C37 | overturned | upheld |
| C38 | upheld | upheld |
| C39 | qualified | upheld |
| C40 | upheld | upheld |
| C41 | upheld | qualified |
| C42 | overturned | qualified |
| C43 | overturned | qualified |
| C44 | upheld | upheld |
| C45 | qualified | qualified |
| C46 | upheld | upheld |
| C47 | upheld | upheld |
| C48 | overturned | qualified |
| C49 | qualified | upheld |
| C50 | upheld | upheld |
| C51 | upheld | upheld |
| C52 | qualified | upheld |
| C53 | overturned | upheld |
| C54 | upheld | qualified |
| C55 | overturned | qualified |

## Items requiring a disposition

### C1/codex — overturned

Evidence: `decisions.md:10-12` makes History conditional on surviving review. The asserted historical reading is not reconstructible from mutable, unversioned dispositions, seams, vocabulary, and subsystem rows, while `spec.md:247-250` also omits current claims opened before `as_of_sha`.

Proposed change: Apply the binding fallback: remove History as a lens and place resolved records last in Attention.

### C2/codex — overturned

Evidence: `spec.md:484-496` places only selected finding and event records in History; terminal dispositions, revalidation obligations, and claim-validity records are not partitioned, while disposition records remain on Method pages.

Proposed change: Define an exhaustive record-family census and exactly-one Unresolved or resolved-Attention membership predicate.

### C2/claude — qualified

Evidence: Terminal dispositions render in neither lens: spec §7.1 homes `concerns.md` (Review coverage, the only disposition page) under Method, and no Unresolved or History page carries `dispositions` rows; store has 166 rows (`confirmed-acceptable` 86, `confirmed-bug` 25, `out-of-scope` 21, `ruled-out` 34, `unresolved-competition` 0). Only `unresolved-competition` reaches `contested.md`.

Proposed change: add: "…partition every finding, contradiction, question, and lead; terminal concern dispositions stay on the Method coverage page and are reachable from History by link" (or add a dispositions group to History)

### C4/claude — overturned

Evidence: The inference order (spec §2.1: exact `subsystems.id` → contains `:` → path tables → term) mis-kinds real records. Store: `SELECT term FROM vocabulary WHERE term LIKE '%:%'` → `Severity (sh:Violation / sh:Warning / sh:Info)` — kinded `symbol`, so the vocabulary row is unreachable without `kind`. 71 of 209 `evidence.symbol` values contain `::` (`GraphWriteCoordinator::evict_idle_locks`), so the split point is load-bearing and unstated. A never-reconciled path (absent from `file_ledger`, `scope_gaps`, `evidence`) falls to `term`/`not-defined` instead of `unledgered`, contradicting §2.2's own "never reconciled" case.

Proposed change: order: exact `subsystems.id` → exact `vocabulary.term` → contains `:` split at the first `:` → path-table match → path-shaped (contains `/` or `.<ext>`) ⇒ `file`/`unledgered` → else `term`; state the split rule

### C5/claude — qualified

Evidence: The materializer opens the store read-only (`materializer/amanuensis_materializer/db.py:15-24`, `mode=ro`) and never applies `schema.sql`; views are created only by `openDatabase` (`mcp-server/src/db.ts:46-51`). A store last opened by an older server (the nightly lanes run the primary checkout's `dist`) lacks `file_standing`, and `files.md`/§6.1 read it.

Proposed change: add: "the materializer probes `table_exists(conn,'file_standing')` and turns the publish red with a named cause when absent" (or ships the view SQL and applies it to a temp copy)

### C6/codex — overturned

Evidence: `spec.md:146-147` retains `examined` when Git is unavailable, although `dev/adr/0001-living-conspectus-terms.md:30-36` makes current reachability part of what examined standing authorizes. `claims.ts:65-83` also throws rather than returning unchecked reachability.

Proposed change: Report a non-authorizing unchecked state when ancestry cannot be evaluated, or conservatively downgrade to `examined-stale`.

### C6/claude — qualified

Evidence: `detect_changes` already assigns `stale_reason='unverifiable-ref'` by resolvability, not ancestry: `mcp-server/src/tools/git.ts:246-262` treats a ref as unverifiable only when `git diff --name-only <ref> <head>` fails, and marks rows at `git.ts:274-275`. A resolvable non-ancestor ref is "verifiable" there but `examined-stale` under C6, so one label carries two rules. Also all 4 distinct examined `ref_sha` on the store resolve and are ancestors (checked with `git merge-base --is-ancestor` in `~/repos/axiomdb`), so the store cannot exercise the branch.

Proposed change: either use the same resolvability rule as `git.ts:246-262`, or report the ancestry failure under a distinct reason (`unreachable-ref`) and keep `unverifiable-ref` for unresolvable refs

### C8/codex — qualified

Evidence: `schema.sql:177` permits arbitrarily many owner rows per path; the AxiomDB store already has a path with ten owners. An untruncated array therefore has no enforceable compatibility with the hard response ceilings in C18.

Proposed change: Keep owners complete, but specify a deterministic overflow response or bounded external reference when the hard ceiling cannot be met.

### C9/codex — overturned

Evidence: `schema.sql:619-642` includes `deferred`, while `invariants.ts:23-33` explicitly treats deferred as orthogonal to the ranked survey ladder. Therefore a weakest-owner ladder value is undefined for a deferred owner.

Proposed change: Define deferred’s authority explicitly or exclude it from the rank calculation while reporting it separately.

### C11/codex — qualified

Evidence: `scope_gaps` records only unledgered or absent paths (`schema.sql:186-193`). A ledgered locus with no gap row is indistinguishable from one that has undergone a complete reconciliation, so `ledger_reconciled` cannot generally be derived.

Proposed change: Add a durable reconciliation receipt or narrow the field to the exact condition that existing rows prove.

### C12/codex — overturned

Evidence: A read-only AxiomDB join found 1,094 missing subsystem-by-active-concern dispositions, but every active concern code has a disposition somewhere. Nine seams lack an SC disposition on one side, but none lacks SC on both sides. The global predicates in `spec.md:178-190` therefore hide real unknowns.

Proposed change: Enumerate missing owner-by-concern pairs and missing side-specific seam assessments.

### C12/claude — qualified

Evidence: `unassessed-seam` is a per-party proxy: `dispositions` PK is `(subsystem_id, concern_code)` (`schema.sql:201-219`) with no seam id; store: 6 `SC-%` concerns, 19 `SC-%` dispositions over 20 seams, e.g. R-05 holds SC-1 and SC-3 and is party to SM-01 and SM-03, so both seams count as assessed whichever one the disposition addressed. The only seam-bound record is `composition_seam_concerns` (`schema.sql:2205-2211`, 0 rows). `open-lead`: `field_notes.location` is free-form — `SELECT COUNT(*) FROM field_notes WHERE location IN (SELECT id FROM subsystems)` → 0 of 103; only 6 carry `:…@`; values like `crates/axiomdb-core/src/reason/, crates/axiomdb-core/src/write/` never match the predicate.

Proposed change: add: "`unassessed-seam` is approximated per party (no seam-bound disposition exists) and says so in the item; `open-lead` matches on path-prefix of any comma-separated token in `location` and reports `location_match: exact|prefix|none`"

### C13/codex — overturned

Evidence: `describe_locus` has no subsystem-context parameter, and an unmatched vocabulary term has no subsystem association. The same-subsystem-first nearest-term tier in `spec.md` therefore cannot be evaluated deterministically.

Proposed change: Add subsystem context or remove that tier and specify a globally deterministic distance and tie-break order.

### C13/claude — qualified

Evidence: Nearest-term rule "same-subsystem terms first" has no referent for a `not-defined` term (the subsystem is only known from a vocabulary row, `schema.sql:360-370`); the rule collapses to prefix then lexicographic. Symbol match: 71/209 `evidence.symbol` contain `::` and some carry parenthetical suffixes (`GraphWriteCoordinator::execute_inner (SSI retry fence re-check)`), so exact match on `evidence.symbol` misses cited symbols.

Proposed change: add: "for `not-defined`, nearest terms are prefix matches then lexicographic (no subsystem preference); symbol match is exact on the first-colon remainder and also reports prefix matches on `evidence.symbol`"

### C16/codex — overturned

Evidence: The candidate predicate in `spec.md:247-250` includes `valid_from_sha = as_of_sha` or closed intervals, omitting still-current claims opened at an ancestor. Most other account sources are mutable and have no validity intervals at all.

Proposed change: Remove whole-account historical snapshots, or add append-only/versioned sources and use ancestry checks for both interval boundaries.

### C16/claude — qualified

Evidence: Spec §3.3's candidate SQL (`valid_from_sha = :as_of OR valid_until_sha IS NOT NULL`) excludes open-ended claims whose `valid_from_sha` is a strict ancestor of `as_of` — the common case. The existing as-of path does not pre-filter: `get_claims` (`mcp-server/src/tools/claims.ts:497-500`) selects every row when `query_sha` is set and filters in code with `claimAppliesAt` (`claims.ts:156-159`).

Proposed change: add: "the candidate set is every `claims` row (as `get_claims(query_sha)` does); ancestry decides membership" and delete the §3.3 pre-filter

### C17/codex — qualified

Evidence: Purpose, claim, finding, and narrative fields can contain text authored by a model during the survey; `spec.md:258-264` only establishes that no model call occurs while serving the request.

Proposed change: State “no text generated during this tool call” and identify durable model-authored source fields as such.

### C18/codex — overturned

Evidence: `helpers.ts:43-55` emits pretty JSON in `content` and repeats the object in `structuredContent`. The proposed gates measure only compact payload bytes, so actual MCP responses can exceed the limits by roughly twice the measured size.

Proposed change: Gate the fully serialized MCP response and remove or budget the duplicate representation.

### C18/claude — qualified

Evidence: The budget is measured on compact JSON, but `jsonResult` (`mcp-server/src/helpers.ts:42-55`) emits `JSON.stringify(data, null, 2)` as the text block and the same object as `structuredContent`; the bytes a host places in context exceed the measured number by the indentation overhead. Decision 5 ("do not spam the context") binds the emitted size.

Proposed change: add: "budgets are enforced on the emitted text block; `describe_locus`/`get_attention`/`get_history` serialize compactly (a `compact: true` path in `jsonResult`)"

### C19/codex — qualified

Evidence: `decisions.md:10-12` requires resolved records to move into Attention if History is overturned. The default and opt-in section split otherwise survives.

Proposed change: Replace the History-lens pointer with a pointer to Attention’s resolved-record group or an event-detail tool.

### C20/codex — overturned

Evidence: `spec.md:294-304` defines `not-recorded` as absence of a source row, yet every omitted item must have a distinct id in the census and `selected + omitted = census`. ADR-0011 instead names policy, irrelevant, and budget omissions.

Proposed change: Keep absent-data metadata outside the omission ledger and use omission reasons only for known census members.

### C20/claude — qualified

Evidence: `not-recorded` cannot be an `omitted[]` entry: §4.3 requires every omitted id to be "present in the census" and `selected + omitted == census`, but a section whose table holds no row has census 0 and no id to omit, so a `not-recorded` entry breaks the invariant. ADR-0011 § Select deterministically names `policy`, `irrelevant`, `budget` — not `not-recorded`.

Proposed change: add: "`omitted[]` reasons are `policy` and `budget`; `not-recorded` is a per-section boolean (`census: 0, recorded: false`), never an omission row"

### C23/codex — overturned

Evidence: `dev/adr/0010-derived-review-surface-and-semantic-readback.md:32-43` already defines `contested` as a challenge state. `spec.md:374-379` disclaims that meaning and reintroduces `contested` for a different union, contradicting `decisions.md:24-25`.

Proposed change: Reuse the ADR-0010 labels and meanings exactly; represent additional source distinctions with fields rather than overloaded labels.

### C23/claude — overturned

Evidence: (1) `contested` is not a label "of its own": ADR-0010 § Derive an immutable session already defines "survived, contested, or defeated challenge" (terminal A7 aggregation on a hypothesis); the spec assigns `contested` a different meaning (unresolved contradiction / open matrix / `unresolved-competition`), so the plan's own gate ("a `get_attention` label's meaning differs from ADR-0010's") turns red on it. (2) `latent-defect` cannot be reused "verbatim": its definition needs an impact base — `mcp-server/src/tools/review-session.ts:222-227` computes it with `isAncestor(ctx, finding.ref_sha, impact.base_sha)` — and `get_attention` has no composition or base.

Proposed change: rename the contradiction/matrix label (e.g. `undiscriminated`); either drop `latent-defect` from `get_attention` or define its base explicitly as `git_state.last_checked_sha` under a distinct label (`pre-checkpoint-open`)

### C24/codex — overturned

Evidence: `field_notes` has creation time and free-text `follow_up` but no resolution event or resolved time (`schema.sql:291-305`); `sessions` has no locus relation (`schema.sql:598-607`). Resolved leads and sessions touching a locus therefore cannot be reconstructed newest-first.

Proposed change: Add append-only lead-resolution events and a session-to-locus relation, or remove those promised history categories.

### C24/claude — qualified

Evidence: `file_ledger` has no `session_id` (`schema.sql:158-177`), so "sessions that touched the locus" is derivable only through `evidence`, `findings`, `dispositions`, `field_notes`, `claims`, `finding_resolution_events` rows citing it; a file examined but never cited has no session history. Store: 24 sessions, 209 evidence rows over 71 of 295 ledger paths.

Proposed change: add: "sessions are attributed through citing rows only; the response states `session_attribution: by-citation`"

### C27/codex — overturned

Evidence: Inline legacy fallbacks remain in `renderers.py:443-455`, `tools/findings.ts:399-445`, `review-session.ts:190-225`, and `review.ts:394-418`. P2 does not list the latter three readers as deliverables.

Proposed change: Migrate every reader to `finding_state_current` and add a gate rejecting remaining inline fallback expressions.

### C27/claude — qualified

Evidence: The fallback CASE is duplicated in the server too — `mcp-server/src/tools/findings.ts:402-406` (`list_findings`) and `findings.ts:440-443` (`get_finding_summary`) — and `review-session.ts:192-197` reads `finding_resolution_current` with no fallback; the plan's P2 deliverables list only `schema.sql` and materializer files, so "every reader" is not delivered. The materializer cannot create the view (`db.py:15-24`, read-only; see C5).

Proposed change: add `findings.ts` and `review-session.ts` to the readers that must select from `finding_state_current`, and a probe for the view in the materializer

### C28/codex — overturned

Evidence: `spec.md:500-502` defines Method through a fixed page list rather than a SQL membership predicate.

Proposed change: Either add a real SQL-backed Method membership source or weaken the claim to deterministic, mechanically checked membership.

### C28/claude — qualified

Evidence: Unresolved "stale knowledge" (`stale=1 AND obligation-bearing`) includes drifted `candidate` rows: `detect_changes` checks every ledger row with a `ref_sha` (`git.ts:214-220`, `246-262`) and marks candidates `git-drift`; all 111 candidate rows on the store carry a 40-char `ref_sha`, so unread files would appear as "Examined files the repository has changed under". Contested selects only `COALESCE(outcome,'open')='open'` matrices, while `diagnosticity_sessions.outcome` also admits `unresolved-competition` (`schema.sql:4478-4479`), which then falls in neither lens; History's SQL selects closed `open_questions` and non-open `field_notes` but §7.1 gives them no page.

Proposed change: add `classification='examined'` to the stale-knowledge predicate (report drifted candidates separately), include `outcome='unresolved-competition'` in contested, and give closed questions/resolved leads a History page

### C29/claude — qualified

Evidence: The xref index routes every finding id to `findings.md#<id>` (`materializer/amanuensis_materializer/core.py:455-462`), and the coverage axis re-checks recorded links and anchors (`readback.py:218-272`); once resolved findings move, `[[id]]` references and receipted links to `findings.md#w01-1` fail as `cross-link-anchor`.

Proposed change: add: "`_build_xref_index` routes a finding id to the page selected by `finding_state_current.resolution_state`"

### C31/codex — qualified

Evidence: The table referenced by the claim retains a History navigation group, but the binding fallback in `decisions.md:10-12` applies once that lens is overturned.

Proposed change: Preserve useful pages but regroup resolved material under Attention and update `NAV_GROUPS`.

### C32/codex — qualified

Evidence: “First viewport” varies with viewport size, zoom, font metrics, and translated or enlarged text; source order can be guaranteed, but literal viewport inclusion cannot.

Proposed change: Define semantic source order and test representative responsive breakpoints without making an absolute viewport guarantee.

### C33/codex — overturned

Evidence: `subsystems.scope` is described as key files (`schema.sql:630`), and AxiomDB values are path and boundary lists such as `crates/axiomdb-cli/…`, not purpose sentences.

Proposed change: Add a durable purpose field or render the existing value as Scope rather than Purpose.

### C34/codex — qualified

Evidence: `slugs.py:20-23` collapses punctuation and can map distinct paths to the same anchor. Multi-owner paths can also carry different examined revisions, making a singular revision ambiguous.

Proposed change: Use a collision-resistant path-derived anchor and render examined revisions per owner.

### C35/codex — overturned

Evidence: The same read-only store query as C12 found 1,094 missing owner-by-concern pairs and nine partially assessed seams, while the proposed global predicates report zero in both categories.

Proposed change: Count and render missing concern dispositions per subsystem and seam assessments per side, with matching denominators.

### C35/claude — qualified

Evidence: "Unassessed seams" uses the per-party `SC-%` proxy (see C12 evidence: dispositions carry no seam id; 19 `SC-%` dispositions, 20 seams, all 20 `assessable=1`). The denominator "seams" is right; the numerator cannot bind to a seam.

Proposed change: add: "unassessed = `assessable=0` or neither party holds any `SC-%` disposition; state that per-seam binding is not recorded"

### C37/codex — overturned

Evidence: `schema.sql:811-813` requires evidence only for `verified-fixed`. `findings.ts:54-57,149-155` permits accepted resolutions with rationale but no attached evidence, so every resolved record cannot truthfully render “with its proof.”

Proposed change: Require evidence or an explicitly authorized dismissal record for every terminal resolution, and gate the rendered proof link.

### C39/codex — qualified

Evidence: Existing JavaScript also implements theme and mobile-navigation behavior (`html_projection.py:690-708` in the generated shell), so “may do nothing else” is false when applied to the projection as a whole.

Proposed change: Limit the restriction to new reader-lens behavior and preserve the existing shell functions explicitly.

### C41/claude — qualified

Evidence: `ProjectionVerifier` inventories only `*.md` and `*.html` (`readback.py:147-152`); listing `search-index.js` in `expected_paths` (`core.py:285`) makes the coverage axis report "planned page is missing" (`readback.py:199-207`), while `verify_projection` (`core.py:313-327`) builds expected paths from the plan alone and would never see the file. The content axis (`readback.py:276-290`) does hash it.

Proposed change: add: "the projection inventory includes `*.js`; `verify_projection` derives expected paths from `manifest.projection_files` as well as the plan"

### C42/codex — overturned

Evidence: `spec.md:730-736` requires code-grade evidence only for key type, state, and flow claims; concurrency and seam claims need merely an evidence row. `add_claim` checks nonempty ids, not evidence kind or subject correspondence (`claims.ts:225-269`).

Proposed change: Require and validate code-grade evidence for every listed structural category, including subject and revision correspondence.

### C42/claude — qualified

Evidence: The "code-grade evidence" requirement is prose only: `add_claim` checks evidence reachability (`claims.ts:96-112`) and `minItems: 1` (`claims.ts:235`) but never `evidence.kind`; `claims.subject_type` has no CHECK (`schema.sql:940-947`); no packet gate asserts kind or subject type. Store: `claims` 0, `claim_evidence` 0.

Proposed change: add a substrate check: `add_claim` (or the P12 prerequisite) refuses a `<sid>/key-type|state-container|flow` claim whose evidence kinds are all outside `{code-verified, contract-stated}`, and validates `subject_type ∈ {symbol, subsystem, seam}`

### C43/codex — overturned

Evidence: `phase-4-adversarial.md:29-37` challenges confirmed findings and linchpin dispositions but does not review structural claims. P12 does not modify that phase.

Proposed change: Add current structural claims to the adversarial phase and record their challenge outcome before advancing.

### C43/claude — qualified

Evidence: `add_claim` requires a resolvable `ref_sha` (`claims.ts:63-70`) so the gate implicitly requires a git workspace with commits. `mcp-server/test-perf-ceilings.mjs:92` runs `git init` with no commit and advances to `structural` at line 109; `test-perf-tier2.mjs:70` and `test-cloud-e2e.mjs:140,256` do the same. These break under the gate.

Proposed change: add: "fixtures that advance to `structural` must commit and record one claim; `test-perf-ceilings.mjs` and `test-perf-tier2.mjs` are deliverables of the packet"

### C45/codex — qualified

Evidence: `helpers.ts:97-127` performs only syntactic citation parsing. Direct calls accepted `See src/a.ts:f@NOT_A_SHA because` and `src/a.ts:f@NOT_A_SHA trailing prose`; neither proves a resolvable revision or symbol.

Proposed change: Parse the embedded citation strictly and validate its path, revision, and symbol reachability.

### C45/claude — qualified

Evidence: `requireWorkspaceCitation` in strict mode requires the whole value to parse as `file:symbol@sha` (`helpers.ts:97-127`: `separator`/`revision` positions on the full string), so a `context` that "contains" a citation inside prose ("one-line: why this link matters", `schema.sql:85`) is rejected; `strict:false` only screens `.amanuensis` mentions. `mcp-server/test-smoke.mjs:254` calls `add_xref` with no `context`.

Proposed change: add: "`context` must contain at least one token matching the citation grammar; the token is validated with `requireWorkspaceCitation`, the surrounding prose is kept" and update `test-smoke.mjs:254`

### C48/codex — overturned

Evidence: SQL CHECK enums remain independent literals throughout `schema.sql`, while P1 generates only TypeScript and Python vocabulary files and touches only three tool validators. `check-evidence-vocabulary.mjs:17-63` currently compares only a small subset.

Proposed change: Include schema constraints and every enforcing validator in generation or exhaustive parity checks, with deliberate divergence tests for each surface.

### C48/claude — qualified

Evidence: `check-evidence-vocabulary.mjs:17-28` reads `const KINDS = [` and `const EVIDENCE_QUALITY = [` by regex from `evidence.ts`/`dispositions.ts`; once those files import from generated `vocabulary.ts` the regex finds nothing (throws), and if rewritten to read the import, the "three-way" comparison between two identical imports can no longer turn red.

Proposed change: add: "the check compares the JSON source, generated `vocabulary.ts`, generated `vocabulary.py`, and SKILL.md's ladder; the old two-file comparison is retired as tautological"

### C49/codex — qualified

Evidence: The proposed word-boundary lint rejects legitimate prose such as “memory-mapped” and can reject a thesis that accurately discusses a stale cache.

Proposed change: Match survey-status assertions contextually or provide a narrowly reviewed allowlist.

### C52/codex — qualified

Evidence: The skill authorizes snapshot and deletion, but the MCP server holds an open SQLite connection and exposes no whole-store reinitialization operation. Deleting the file without a process boundary risks continuing against the old handle.

Proposed change: Specify and test snapshot, server shutdown, deletion, initialization, restart, and read-back as distinct steps.

### C53/codex — overturned

Evidence: `materialize.ts:224-260` resolves publication through project storage; `project.ts:1003-1012` confines relative output beneath `.amanuensis`. Thus `materialize_docs` writes `.amanuensis/docs`, while the tracked target is root `docs/`; P16 has no promotion step.

Proposed change: Add an explicit verified export to root `docs/` and re-read that canonical path before committing.

### C54/claude — qualified

Evidence: With budget truncation (§4), the `get_attention` selected id set can be a strict subset of the query on a large store (16 open findings, 31 open questions, 103 open notes on AxiomDB), so "exactly equal" must be computed over `selected ∪ omitted[reason=budget]` or the gate forces the response to exceed its budget.

Proposed change: add: "equality is over selected plus budget-omitted ids"

### C55/codex — overturned

Evidence: Every named gate file is absent in the baseline. Running `cd mcp-server && node test-locus-compactness.mjs` fails with `MODULE_NOT_FOUND`, not the intended compactness assertion. `plan.json` also records no semantic red witness or false-green arm.

Proposed change: Require each test to be installed and observed failing on its intended assertion before implementation, with a sabotage or red-case receipt.

### C55/claude — qualified

Evidence: The launcher's red proof accepts any non-zero exit: `run.sh:326-328` (`[ "$red_status" -ne 0 ]`) counts `Cannot find module`/`No such file` as red, and a failing `npm run build` at the red commit is swallowed (`run.sh:324`, `|| true`). Since every gate is a new file, "fails before its packet" is satisfied by absence, not by the named red condition.

Proposed change: add: "the `red(<id>)` commit contains the gate file; the launcher rejects a red output matching `MODULE_NOT_FOUND|No such file|can't open file`"

### D1/codex — plan defect (high)

Location: P5, P8, P9

Evidence: The global unknown/not-yet predicates yield zero concern codes and zero seams on the current store despite 1,094 missing subsystem-concern pairs and nine one-sided seam gaps.

Proposed change: Test partial coverage fixtures and use owner-pair and seam-side predicates.

### D2/codex — plan defect (high)

Location: P14

Evidence: The proposed `as_of_sha` SQL omits open claims created at ancestors, and P14 adds no version history for mutable account sources.

Proposed change: Narrow history to append-only event tables or add validity histories before promising historical accounts.

### D3/codex — plan defect (high)

Location: P7, P14

Evidence: Compactness gates measure payloads, while `jsonResult` duplicates them as pretty text and structured content. Optional sections and both additional tools lack full wire-size coverage.

Proposed change: Measure serialized MCP responses for every default and expanded mode and eliminate duplicate payload cost.

### D4/codex — plan defect (high)

Location: P1

Evidence: Deliverables omit `schema.sql` and most enforcing tool files, so the claimed single enum source can remain divergent while its gate passes.

Proposed change: Generate or compare SQL constraints and every server/materializer validator.

### D5/codex — plan defect (high)

Location: P10

Evidence: Acceptance checks static ARIA attributes, external hosts, and a no-script anchor, but not Arrow keys, Enter, Escape, focus restoration, state updates, announcements, or native filter operation.

Proposed change: Add browser-driven keyboard and accessibility tests plus a complete no-JavaScript traversal.

### D6/codex — plan defect (high)

Location: P12

Evidence: The gate requires only one prefix-matching claim; it does not enforce the five promised categories, code-grade evidence, or later adversarial review.

Proposed change: Add evidence-kind and subject checks, category coverage receipts, and a Phase 4 claim-review deliverable.

### D7/codex — plan defect (medium)

Location: P13

Evidence: P12 and P13 both edit `phase-2-structural.md`, but P13 depends only on P6 and P8.

Proposed change: Add P12 as a dependency and gate the combined document contract.

### D8/codex — plan defect (high)

Location: P15

Evidence: `mcp-server/src/installer.ts` does not exist; installer behavior lives in `src/cli.ts`. Installer opt-in is also absent from the reviewed normative claims, and a one-call model-routing harness is underspecified.

Proposed change: Remove the extra installer scope or add a binding claim and target `cli.ts`; separate static instruction checks from a reproducible behavioral evaluation.

### D9/codex — plan defect (high)

Location: P16

Evidence: One 150-minute packet combines destructive reinitialization, restart, a full survey of eight subsystems and 513 tracked files, publication, read-back, and commit.

Proposed change: Split snapshot/restart, onboarding, bounded survey batches, publication, and dogfood verification into checkpointed packets.

### D10/codex — plan defect (high)

Location: P16

Evidence: The materializer writes beneath `.amanuensis`, but acceptance requires root `docs/` to byte-match a receipt; no export or canonical-path read-back is delivered.

Proposed change: Add a safe promotion step and verify root `docs/` bytes after promotion.

### D11/codex — plan defect (high)

Location: all packets

Evidence: All sixteen gate paths are absent, so their commands are red only because the test modules do not exist. The JSON does not encode the intended red condition or false-green exclusion.

Proposed change: Make semantic preimplementation red evidence and a red-case arm mandatory packet artifacts.

### D12/codex — plan defect (medium)

Location: P5, P6

Evidence: Gates omit Git-unavailable behavior, deferred-owner authority, historical intervals, origin disagreement, `ledger_reconciled`, and zero-denominator measured fields.

Proposed change: Add fixtures and assertions for every standing and read-back axis.

### D13/codex — plan defect (high)

Location: P14

Evidence: P14 promises resolved leads and sessions touching a locus but supplies no schema deliverable for lead-resolution events or session-locus relations.

Proposed change: Add the required append-only schema and migration, or remove those response categories.

### D14/codex — plan defect (medium)

Location: P8, P10

Evidence: “Stable anchor” tests do not include colliding path slugs or multi-owner revision differences.

Proposed change: Seed slug collisions, require collision-resistant anchors, and verify every owner-specific destination.

### D15/codex — plan defect (medium)

Location: P6

Evidence: The generated inventory currently reports 196 tools across 41 groups, while `spec.md:326-327` states a 195-tool baseline. Adding three tools therefore produces 199, not 198.

Proposed change: Derive expected counts from the generated inventory and correct the specification baseline.

### D16/codex — plan defect (high)

Location: P2, P9

Evidence: P2 tests finding partition only, although C2 covers every resolution, obligation, and terminal disposition family.

Proposed change: Add an exhaustive cross-family census and exactly-one lens-membership gate.

### D17/codex — plan defect (high)

Location: P7

Evidence: Its required `not-recorded` omission reason has no source-row id that can participate in the required census equality.

Proposed change: Separate missing-data declarations from omissions and use only reasons applicable to known items.

### D18/codex — plan defect (high)

Location: P2

Evidence: Deliverables omit several finding readers that retain legacy inline fallback logic.

Proposed change: Include `tools/findings.ts`, review-session, and review readers, with a static regression check for duplicate fallback expressions.

### D19/codex — plan defect (medium)

Location: P9

Evidence: Page tests require proof presentation but do not make proof structurally mandatory for accepted or ruled-out terminal records.

Proposed change: Seed proofless terminal resolutions and require the gate to reject or explicitly label authorized dismissal evidence.

### D1/claude — plan defect (high)

Location: plan.json every packet `gate`

Evidence: Red proofs are degenerate: gates are new files, and `run.sh:322-328` checks out the red commit into a fresh worktree and treats any non-zero exit (including a missing test module) as red; `run.sh:324` ignores a failed build at red.

Proposed change: require each `red(<id>)` commit to add the gate test; add a `gate.red_expect` regex per packet (the test's own assertion text) that the launcher greps in `verify-<id>-red.out`, rejecting module-not-found

### D2/claude — plan defect (high)

Location: plan.json packet P12 deliverables/regression

Evidence: The new `structural` prerequisite breaks `mcp-server/test-perf-ceilings.mjs:92-109` (CI step at `.github/workflows/test.yml:263`; fixture has `git init` and no commit, so `add_claim` cannot resolve a `ref_sha`) and `test-perf-tier2.mjs:68-72`; neither is in P12's deliverables or regression list, and `test-cloud-e2e.mjs:140,256` is in regression but not deliverables.

Proposed change: add the three files to P12 deliverables and `test-perf-ceilings.mjs` to its regression list; fixture seeds one commit, one evidence row, one claim per subsystem

### D3/claude — plan defect (medium)

Location: plan.json packet P2 deliverables

Evidence: `mcp-server/src/tools/findings.ts:402-406` and `440-443` duplicate the fallback CASE the packet exists to remove; `review-session.ts:192-197` reads `finding_resolution_current` with no fallback; P2 lists neither, and `test-finding-partition.mjs` never asserts `list_findings` agrees with the view.

Proposed change: add `findings.ts`, `review-session.ts` to P2 deliverables and an acceptance "`list_findings`, `get_finding_summary`, and `compile_review_session` read `finding_state_current`"

### D4/claude — plan defect (medium)

Location: plan.json packets P2–P16 deliverables; `completion.commands`

Evidence: Only P1 lists `.github/workflows/test.yml`; the other 15 gates are added to `completion.commands` but no packet wires them into CI, contradicting §13 ("the complete CI list … reproduced in completion.commands"). `dev/test-reader-lenses-dogfood.mjs` needs `.amanuensis/memory.db`, which is untracked (`git ls-files .amanuensis` → 0), so it cannot run in CI at all.

Proposed change: add `test.yml` to each packet's deliverables with an acceptance "the gate runs in CI"; make the dogfood gate read a committed receipt (`design/reader-lenses/dogfood-receipt.md` plus `docs/.projection-contract.json`) or mark it launcher-only explicitly

### D5/claude — plan defect (medium)

Location: plan.json packet P10 acceptance

Evidence: `readback.py:147-152` inventories `*.md`/`*.html` only, so adding `search-index.js` to `expected_paths` (`core.py:285`) turns coverage red as "planned page is missing"; `verify_projection` (`core.py:313-327`) never expects it. P10's acceptance checks the receipt, not the coverage axis.

Proposed change: acceptance: "clean publish and `verify_materialized_docs` are green with `search-index.js` present; removing it turns coverage red"

### D6/claude — plan defect (low)

Location: plan.json packet P3 acceptance

Evidence: The `entries` stale markers are emitted only by `render_index` (`renderers.py:154`), which P3 rewrites ("nothing else above the fold"); `test-projection-custody.mjs:66-72` seeds an `entries` stale row and requires a green read-back. Regression would catch it, but nothing tells the implementer where the markers go.

Proposed change: acceptance: "`entries` stale markers are still emitted exactly once (on `stale.md` or the overview)"

### D7/claude — plan defect (medium)

Location: plan.json packet P2 acceptance

Evidence: `core.py:455-462` routes every finding id to `findings.md#<id>`; after partition, links and `[[id]]` references to resolved findings fail the coverage axis (`readback.py:255-272`, `cross-link-anchor`). Not named in P2's acceptance.

Proposed change: acceptance: "`_build_xref_index` routes finding ids by `finding_state_current`; a resolved finding referenced from a subsystem page resolves to `resolved-findings.md`"

### D8/claude — plan defect (medium)

Location: plan.json packet P13 deliverables

Evidence: `test-smoke.mjs:254` calls `add_xref` without `context` and will fail; `helpers.ts:97-127` strict parsing rejects prose containing a citation, contradicting "contains a `file:symbol@sha` citation".

Proposed change: add `test-smoke.mjs` to deliverables; specify token-level citation extraction

### D9/claude — plan defect (medium)

Location: plan.json packet P5 gate `test-locus-index-view.mjs`

Evidence: Acceptance "a hand-written reference query agrees with the view on every row" compares two copies of the same CASE — the "agreeing copies can share one wrong definition" false green §13 itself names; it cannot turn red on a wrong predicate.

Proposed change: seed a fixture table of `(classification, stale, stale_reason) → expected state` for all 7 states, including `candidate` with `stale=1` and `classification IS NULL`, and assert the view against it

### D10/claude — plan defect (medium)

Location: plan.json packet P8 `depends_on`

Evidence: P8 renders `files.md` with a standing column (§7.4) from `file_standing`, delivered by P5, but `depends_on` is `[P2, P4]`; P5 and P8 are unordered, so P8 can run first and must either duplicate the predicate in Python or block.

Proposed change: `depends_on: [P2, P4, P5]`

### D11/claude — plan defect (medium)

Location: plan.json packet P9 acceptance; spec §7.1

Evidence: §6.1 History membership selects `open_questions` in `('answered','dismissed','superseded')` (5 answered on the store) and `field_notes WHERE follow_up <> 'open'`, and §7.1 says resolved notes "move to History", but no History page carries either; `diagnosticity_sessions.outcome='unresolved-competition'` (`schema.sql:4478-4479`) is selected by neither lens.

Proposed change: add a `resolved-leads.md` (or sections on `resolution-history.md`) for closed questions and resolved notes; include `unresolved-competition` matrices in `contested.md`; add both to P9 acceptance

### D12/claude — plan defect (medium)

Location: plan.json packet P7 gate `test-locus-compactness.mjs`

Evidence: The gate measures compact `JSON.stringify` while `jsonResult` (`helpers.ts:42-55`) emits the indented text block plus `structuredContent`; the number gated is not the number that reaches the context (decision 5).

Proposed change: measure the emitted text block; add a compact serialization path for the three tools and assert on it

### D13/claude — plan defect (medium)

Location: plan.json packet P16 `budget_minutes`, gate

Evidence: 150 minutes covers discarding the store, onboarding, re-surveying every subsystem (the checked-in `docs/` has 8, each with 5 phases plus claims and edges), a clean publish, and writing the receipt; the gate's red run happens in a fresh worktree (`run.sh:322`) with no `.amanuensis/`, so it is red for the wrong reason.

Proposed change: split P16 into rebuild (needs_mcp, larger budget) and gate packets; gate reads committed artifacts (see D4)

### D14/claude — plan defect (low)

Location: plan.json packet P14 gate `test-attention-history.mjs`

Evidence: Red condition "a label's meaning differs from ADR-0010's" is not mechanically decidable; `latent-defect` has no base without a composition (`review-session.ts:222-227`), and `contested` already means something else in ADR-0010.

Proposed change: replace with per-label fixture assertions (a finding with a prior `verified-fixed` event is `regression`, etc.) after resolving C23

### D15/claude — plan defect (low)

Location: plan.json packet P1 acceptance

Evidence: `check-evidence-vocabulary.mjs:17-28` parses `const KINDS = [` from `evidence.ts`; after P1 replaces the literal with an import the parser throws, and a comparison of two imports of one array cannot turn red. Acceptance "still turns red when SKILL.md's ladder diverges" covers only the third party.

Proposed change: acceptance: "the check reads the JSON source and both generated files and turns red when any one of the four diverges"

### D16/claude — plan defect (low)

Location: spec §10.1 enum list; `diagrams.py`, `helpers.ts`

Evidence: The single-source contract omits `xrefs.relationship`, `xrefs.strength`, `contradictions.resolution`, `claims.epistemic_kind`, `open_questions.resolution`, `diagnosticity_sessions.outcome`, `field_notes.follow_up`, `pass_type`, `concerns.status`; the obligation predicate exists in three copies (`helpers.ts:19`, `diagrams.py` `_OBLIGATION_BEARING`, the spec's view and §11.2 SQL).

Proposed change: carry the missing enums; generate the obligation predicate from the `file_classification` enum's `obligation_bearing` flag

### D17/claude — plan defect (low)

Location: spec §4.3, packet P7 fixture

Evidence: The omission ledger sits inside the byte budget and grows with the census; on AxiomDB `get_attention`'s default census is 16 open findings + 31 open questions + 103 open notes, so the ledger alone can approach the 12288-byte budget and the tool must error rather than answer. The fixture (30 leads) does not exercise it.

Proposed change: exclude `omitted[]` from the byte budget or aggregate it as `{section, reason, count, ids?}`; add a 150-item census case to the gate

### D18/claude — plan defect (low)

Location: plan.json P5/P6 acceptance "kind inference … in the documented order"

Evidence: The documented order mis-kinds a stored vocabulary term containing `:` and a never-reconciled path (see C4); a gate that asserts the order as written passes a wrong rule.

Proposed change: fixture includes a term with `:`, a Rust `Type::method` symbol, and a path in no table; assert the corrected order

## Summary

```json
{
  "codex": {
    "overturned": 21,
    "qualified": 11,
    "upheld": 23,
    "plan_defects": 19
  },
  "claude": {
    "overturned": 2,
    "qualified": 20,
    "upheld": 33,
    "plan_defects": 18
  }
}
```
