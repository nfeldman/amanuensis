# Backlog

Follow-on work for Amanuensis that is agreed or proposed but not yet scheduled. Written
2026-11-14 from the explanation lane (merged 2026-11-06), the 0.2.0-beta.5 release and the
AxiomDB conspectus catch-up (2026-11-11 to 11-12).

This file is the place to record such work. `dev/roadmap.json` (rendered to
[ROADMAP.md](ROADMAP.md)) holds the initiatives, and all 27 are implemented. The Pecia ledger in
`.pecia/` was an experiment from September. Nothing has been written to it since 2026-09-22, its CI
gate was removed on 2026-11-06, and the current Pecia CLI rejects it (`E013`, a pre-hash-chain
log). Its open defects are listed under [Older defects](#older-defects-from-the-pecia-ledger) so
they are not lost.

Each item says what to change, why, and how to tell it is done. "Measured" means counted in a
real run; "read" means found by reading code and not reproduced.

## Decisions waiting on the owner

- ~~**Raise the default `describe_locus` budget?**~~ Decided 2026-11-19: raised from 8192 to
  15360 bytes (4aa6a66). Re-measured on the self-conspectus, each of the three dogfood loci now
  serves its purpose sentence and structure item
  ([design/explanation/locus-default-measure.json](design/explanation/locus-default-measure.json)).
- ~~**May a claim close at the revision it was recorded at?**~~ Yes, decided 2026-11-19 after
  the first beta tester hit it: an adversarial pass found a structural claim overstated
  its scope and could not correct it until HEAD moved. `invalidate_claim` and `supersede_claim`
  now accept the claim's own `valid_from_sha`, which leaves an empty interval: the claim never
  held. Opening a store rebuilds `claims` without the `CHECK` that forbade it
  (`migrateClaimsNeverHeld` in `db.ts`). Every as-of reader already treats `valid_until_sha` as
  exclusive, so a never-held claim is current at no revision. The Phase 4 reference now routes a
  claim wrong when recorded to the recording commit. The `mapped` check still accepts any outcome
  on a current claim; a claim disproved after recording `survived` now has a way to be closed,
  but the server cannot make the pass do it.
- ~~**Resume the self-rebuild?**~~ Wait, decided 2026-11-20: not until the orientation plan
  (`design/orientation/`) and the backlog's other improvements have landed. Paused 2026-11-06. The plan has three stages: real exclusion (an
  `.amanuensisignore` file: excluded paths get no ledger row, count or label anywhere), a model
  pilot (Haiku, Sonnet, Opus, Luna, Terra and Sol, two runs each, judged blind; judge not settled
  between one shared judge and cross-lab judging), then a from-scratch rebuild of the
  self-conspectus. Until exclusion lands, the published self-conspectus still maps research and
  design directories. Re-measure the gate baseline on `main` before resuming.
- ~~**Release-time host evidence.**~~ Not required, decided 2026-11-20: the release-commit CI,
  the publish workflow's packed-artifact check and the published-package smoke test are enough.
  B07-R1 stays out of CI. The A25/A26 activation checks left CI on 2026-11-06. Nothing
  compares the recorded host runs with the code between releases. A release that wants them needs
  a live Codex capture first, and the capture harness needs repair before it passes on current
  code. `dev/test-activation-evidence.mjs` (B07-R1) is red for the same reason: a recorded source
  digest for `mcp-server/src/project.ts` has drifted.
- ~~**Reconcile the self-conspectus, or wait for the rebuild?**~~ Wait, decided 2026-11-20:
  P11, EX8 and EX14 stay red until the rebuild replaces the self-conspectus. P11
  (`dev/test-survey-depth-acceptance.mjs`) is red only on its binding: the acceptance receipt's
  ledger accounts for 690 paths; at 7d7e153 the tree has 711, of which 23 are unledgered, and two ledgered paths were deleted with P20. The gap grows with each commit that adds a file.
  EX8 and EX14 run P11, so they are red with it. Repairing it means running `detect_changes` on
  the self-conspectus store and assigning or exempting each new path, which is Amanuensis use and
  needs the owner's go-ahead; the self-rebuild would replace it anyway.
- **The database holds everything; HTML is the only published projection.** Decided
  2026-11-20; planning starts after the orientation lane lands (its renderer changes would
  collide). Two gaps today:
  - The HTML is built from the published Markdown, so the Markdown is an intermediate no reader
    needs. Correction (PLAN §0): an earlier version of this item said the read-back compares the
    Markdown with the HTML. It does not. The read-back censuses both views against store rows
    and hashes every file; it only has to drop the Markdown branch and cover the new records.
  - The skill has the agent hand-write files whose content the store never holds. These are
    `<id>-<slug>.md` survey narratives, `master-plan.md`, `entry-point.md` (whose thesis
    `record_explanation` treats as the project's purpose) and the onboarding report.
    `artifacts` keeps only their path and hash.

  The plan moves that content into records written through tools, renders HTML from the store
  alone, and stops the skill writing files. It also settles what a downstream copy carries
  (D7 decided HTML).

  Generated diagrams join this plan rather than the orientation lane (decided 2026-11-20).
  The catalog in `design/diagrams/CATALOG.md` (local, not committed) ranks a survey workflow
  diagram, a status ladder and a coverage view first, since all three draw on records the
  store already holds. Code diagrams need new records, flow marks above all. Surveys must
  record those before a diagram has anything to show, so the plan should add them early.

  The plan is [design/store-only/PLAN.md](design/store-only/PLAN.md): 26 packets, SO0 to SO25.
  Its owner decisions, all decided 2026-11-20 as recommended:
  - D1 decided 2026-11-20: render imported survey bodies, onboarding report, entry point and concern checklist "as written"; hold master plan, findings index and field notes.
  - D2 decided 2026-11-20: the imported thesis becomes an `imported` project purpose with no evidence, labelled until a recorded one replaces it.
  - D3 decided 2026-11-20: flow marks are generic `claim_marks` with per-kind contract rules; relations deferred.
  - D4 decided 2026-11-20: flow marks print the gap and never refuse an advance; the skill discharges or declines.
  - D5 decided 2026-11-20: contract entries count as records for the method diagrams, with a gate holding the server's rung prerequisites to them.
  - D6 decided 2026-11-20: import AxiomDB in its maintenance lane after a release with S1–S2, and this repository's store before any republish of `docs/`; each runs only after the lane lands.
  - D7 decided 2026-11-20: `register_artifact` and `rehash_artifact` refuse hand-written kinds now (SO6) and are removed at the next minor version.
  - D8 decided 2026-11-20: drop the dispatch prompt template; keep nothing beyond `subagent_log`.
  - D9 decided 2026-11-20: server-written exports (review export, `compare_conspectuses write_to`, research handoff `claims.md`) are out of scope.
  - D10 decided 2026-11-20: published output and copies carry a content-free `README.md` pointing at `index.html`.
  - D11 decided 2026-11-20: files on disk stay untouched after import; deleting them is the owner's, by hand.
  - D12 decided 2026-11-20: pages lose their `.md` form, a breaking output change released as `0.3.0` with a release note.
  - D13 decided 2026-11-20: the stored-prose grammar (PLAN §3.4) is the documented contract for every prose field.
  - D14 decided 2026-11-20: illustrations are allowed and labelled; no diagram on the overview; scroll inside the frame on narrow screens.
  - D15 decided 2026-11-20: republish and real-store checks (`docs/`, AxiomDB's copy) only after the lane lands and D6's imports run.
  - D16 decided 2026-11-20, amended: legacy data needs no protecting, so the AxiomDB lanes are not paused and the next nightly open migrates the store; one `VACUUM INTO` backup is taken just before `dist` is rebuilt, as a rollback point only.
- **Code index: find and cite code exactly, alongside reading it.** Planned 2026-11-22 as a
  hybrid: the index adds to file reading and takes nothing away. Agents use it to find a
  definition, see a file's shape, search what the store already says and cite code by a checked
  coordinate; they read whole files whenever they want context, exactly as today. The index never
  discourages, forbids or gates whole-file reads. There is no benchmark and no threshold, and
  nothing waits on a measurement; the only measure is a descriptive token report that decides
  nothing. It ships as 0.3.0-beta.2, after store-only's 0.3.0-beta.1. One risk stays and is
  stated plainly: a name-matched reference is a lead, not proof of a call.

  The plan is [design/semantic-index/PLAN.md](design/semantic-index/PLAN.md): 12 packets, SI0 to
  SI11, in four slices. Its owner decisions, all decided 2026-11-22:
  - D1 decided 2026-11-22: store-only ships as 0.3.0-beta.1 and the index as 0.3.0-beta.2; the version bump and publish are release steps outside the lane.
  - D2 decided 2026-11-22: TypeScript, TSX, JavaScript, Python, Rust, Go, Java, C, C++ and C#, each with its own definition queries and golden fixtures.
  - D3 decided 2026-11-22: the index is a sidecar at `<storage>/code-index/<extractor_id>/`, never `memory.db`.
  - D4 decided 2026-11-22: a `symbol` that does not resolve, in a supported language, is refused with candidates; free-text labels go to `note`.
  - D5 decided 2026-11-22: `line_range` is filled from the definition when it is omitted.
  - D6 decided 2026-11-22: no backward compatibility; no backfill, no census, no migration, and older stores open without anchors or are discarded.
  - D10 decided 2026-11-22: keep Node engines at `>=20`; the index runs on 20, measured, and raising the floor is its own change.
  - D12 decided 2026-11-22: the index is on by default, with `AMANUENSIS_CODE_INDEX=off` to turn it off.
  - Removed with the benchmark: D7 (budget), D8 (subjects), D9 (thresholds), D11 (authentication) and D13 (quality margin); none is open.

  Merged 2026-11-23 as 0bd365e. The final review left three low findings unrepaired for lack of
  budget; the owner deferred them here
  ([dispositions](design/semantic-index/reviews/final/dispositions.md)):
  - **F15: no gate kills the index writer mid-publish.** SI4 stays green with the blobs row
    inserted first inside the transaction, with the publish outside its transaction, or with
    plain `INSERT`. Add a case that kills the worker mid-publish and asserts no orphan `symbols`
    rows.
  - **F20: cache eviction is never reported.** `ensureTree` drops `evicted` and
    `disk_over_budget`, and `locate()` drops `file.evicted`, although PLAN §4.1 says each limit is
    reported when it bites. Return them from `find_symbol` and `outline_file` when non-zero.
  - **F21: the refusal register and two descriptions drift from the code.**
    `code-index.line-range` is not in `contracts/refusal-parity.json` or
    `references/code-index.md`; the unsupported-language note says every tool refuses, but
    `find_symbol` answers `ok: true` with a status; and `search_records` calls `subject` a prefix
    when it matches whole segments only.

## Explanation quality

From the AxiomDB catch-up. Codex blind-read every model-written explanation (71 slots, about
139 KB). The first read found 70 false sentences: 47% hung on a universal quantifier ("every",
"only", "never") and 11% on an absence ("no", "not"). Every cited line range was valid. A range
shows that one place does something; the prose said every place does. Two independent reviewers
then overlapped on one finding, which puts the false statements present at about 100 (95% lower
bound 43). Each later read found about 0.1–0.2 false statements per KB of the text it was given.
Measured.

Substrate, smallest first:

1. ~~**Validate evidence when it is written.**~~ Done on branch `server-fixes`, 2026-11-16:
   `add_evidence` and review-pass `new_evidence` refuse a path missing at `ref_sha`, a range
   outside the file, and an excerpt not in the cited lines (whitespace ignored, `...` an
   elision). Rows already in a store are not re-checked. Measured before the change: with
   whitespace and elisions forgiven, 304 of 716 excerpted AxiomDB rows and 29 of 38 in the
   self-conspectus still did not appear at their cited lines. Some are coordinate errors (one is
   off by a line), some HTML-escaped (`&lt;`), some paraphrase. A store audit for the existing rows
   is not scheduled.
2. ~~**Run the orientation lint when an explanation is recorded.**~~ Done on branch
   `server-fixes`, 2026-11-16. `record_explanation` and `decline_explanation` call the
   materializer's own lint (one copy of the rules), and refuse what the pages would withhold.
   With no Python the write goes through and only render checks. `_FRACTION` now skips code
   spans, slash chains (`0/1/3`) and a numerator larger than its denominator; "12/35 subsystems
   are mapped" is still refused, and so is a date such as `11/16`.
3. **Universal and absence claims cite a recorded search.** A new evidence kind records the
   query (an `rg` or `ast-grep` pattern and path globs), the revision, the result count and a
   hash of the result set. Read-back re-runs it. `record_explanation` refuses a sweeping sentence
   without one. A narrow search can still "verify" a universal; read-back cannot judge whether it
   was the right search.
4. **Sentence-level citations.** Markers such as `[e834]` that must name a cited row, required on
   sweeping sentences and rendered as links, so a reviewer checks a sentence against its own
   evidence.
5. **Independent reviews are records.** A review appends findings, and each is later dispositioned
   (applied with the correcting row, or disputed with evidence). Pages and the
   `materialize_docs` census show "reviewed at `<sha>` by `<lineage>`, n findings" or "not
   independently reviewed". Consider printing a residual-error estimate from two independent
   reads instead of a bare "reviewed".
6. ~~**`clear_staleness` records its basis.**~~ Done on branch `server-fixes`, 2026-11-16: each
   clear appends a row to `staleness_clears` (append-only) with an evidence row citing the file
   or a one-line reason, what it discharged, and the commit, now resolved: the old handler
   stored `ref_sha: "HEAD"` literally in the ledger. No tool reads the table yet; it is
   queryable in the store. The bypass found by review is closed (2026-11-18, 1095eb9):
   `add_files_to_scope` and `update_file_classification` refuse to move the `ref_sha` of a row
   marked stale (`add_files_to_scope` keeps the row's revision and reports it as `held_stale`;
   `update_file_classification` refuses), both resolve `ref_sha`, and `detect_changes` reads a
   stored name such as `HEAD` as unverified rather than fresh. Still not
   recorded: a genuine content revert, and a row whose drift no `detect_changes` has seen yet,
   whose `ref_sha` a caller may still move.
7. **Other prose ages too.** Subsystem scope, start-here and survey notes are unbound text that
   never shows as ageing; a scope field carried a file's line count three months after the file
   tripled. Bind them to the revision written at and mark them ageing like explanations, and lint
   volatile numbers out of them.

Skill and prompts:

8. **Write to the scope you read.** Say where something happens; write "every", "only", "never"
   or "no" only after enumerating, and cite the search; name exceptions seen.
9. **Resolve doubts before recording.** A sentence the author would list as weakly supported is
   verified, narrowed or cut; one that cannot be settled becomes an open question.
10. **Correction passes narrow or delete; they do not add.** A pass told to re-check whole items
    found many more errors, but every error a later read found in its output was in a sentence it
    had added on its own. The next pass was told to narrow or delete only and to list missing
    content in its report; a read of its changes found nothing wrong in them. n=1 and small (7.5
    KB), but it reverses the earlier "rewrite the whole paragraph" advice: re-check the whole
    item, and fix by narrowing.
11. **Reading subagents report coverage** for each sweeping claim ("3 of 3 callers", "searched
    `crates/**`"), so the recording session sees where a universal rests on one example.

Workflow:

12. **A cross-lineage blind read is part of every explanation pass:** author, blind read by
    another lab's model, correct (item 10), blind read of the corrected text. One read found at
    most 77% of what two reads found. Reviewer precision was high (27 of 27 hand-checked held).
13. **Explanation and refresh sessions can run concurrently.** Three server processes wrote one
    store at once; all 58 phase-gate snapshots passed `quick_check`. The serial chain and shared
    run lock were inherited from the maintenance lane, not needed.

## Publishing and rendering

- **Survey notes sit below the account, dated.** Old survey narratives can contradict the
  current account on the same page. Move them under it with the date written, rather than
  rewriting them; rewriting would also lose the status history the server appends to them.
- **A CLI render does not update the store's publication record.** Rendering with
  `materializer/materialize.py` leaves the overview's "Verified at" and "Publication integrity"
  rows at the last tool-driven publish. Rendering from a copy of the store also leaves the store's
  own `docs/` stale, which is where the HTML pages live. Either make the CLI record the
  publication or make it refuse to write outside the store without saying so on the page.
- **The overview's state axis reports the previous run.** A publish right after a failed attempt
  prints "State axis: red" for a green publish. Read, then observed once on 2026-11-06.
- **Downstream publishing ships Markdown only.** A conspectus copied into a repository's `docs/`
  carries no HTML. Readers of the HTML need the store's `docs/`, and nothing says so.
- **The AxiomDB maintenance lane's publish step is obsolete.** It lands through a step the
  downstream repository retired when it moved to its own delivery pipeline (2026-11-12). The lane
  is paused; fix its publish step before it restarts. The owner's rule: push the docs commit
  directly, then fast-forward the local checkout and refresh the store's HTML.
- **Record links are still made by scanning text for IDs.** Deferred by the owner from the
  store-only final review (Codex F10), 2026-11-21. `html_projection.py` still runs
  `_identifier_markup` over each finished page's nav, body and eyebrow, which PLAN §3.1 meant to
  replace with typed record references in the page model. The fix needs every builder to emit
  those references, with the golden pages byte-identical, so it needs a packet of its own.
- **Diagram SVGs are images that contain links.** Deferred by the owner from the store-only final
  review (Claude F14), 2026-11-21. The SVGs from SO22–SO25 carry `role="img"` and `<a href>`
  children, and ARIA treats an image's children as presentational, so those links are hidden
  from screen readers. Appendix B rule 8 of `design/store-only/PLAN.md` asks for both, so amend
  the rule first. Proposed: a diagram with links is a labelled `role="group"`, and `role="img"`
  stays for diagrams with none. Then change the four gates that assert `role="img"`.

### Reader orientation

Plan: [design/orientation/PLAN.md](design/orientation/PLAN.md). The W items are its findings;
packets O0–O14 fix them. A reader of the site and the skill meets these inconsistencies:

- **W1.** The site never says the person answers a decision by telling the agent, and the skill says a tool call.
- **W2.** `open-questions.md` points to a page that does not carry the questions.
- **W3.** The skill keeps leftovers of the removed scope menu and review gates ("option A", "(approved)").
- **W4.** Packaging publishes before it marks the subsystem `mapped`, so the site is one rung short.
- **W5.** The seam check runs before either party can be `mapped`, so no packaging step sees it flip.
- **W6.** A status names the pass under way for `concerns` and `adversarial`: decided (D4), the skill advances earlier.
- **W7.** "Deferred" is printed on the Subsystem map and nothing there explains it.
- **W8.** "Phase N" means onboarding Phases 0–7 and survey Phases 1–5, and the pages never say which.
- **W9.** The site and the skill use two names per record family ("Lead" and "field note", and so on).

## Server defects

- ~~**Codex rewrites `config.toml` and breaks the installer's managed block.**~~ Fixed
  on main, 2026-11-18, as proposed below; `test-installer.mjs` replays the rewrite. Observed
  2026-11-18 on the owner's machine: the Codex CLI rewrote `~/.codex/config.toml` at
  startup, dropping the `# >>> amanuensis init (managed)` start comment, turning the
  inline `env` into an `[mcp_servers.amanuensis-memory.env]` sub-table, and moving two
  other servers inside the end marker. `install`, `upgrade`, `uninstall`, `status`, and
  `doctor` all find the Codex entry by those comments, so on such a machine they refuse
  ("incomplete Amanuensis-managed block") or report it unmanaged. The refusal is safe;
  nothing else is deleted. The repair is to recognize the entry by its parsed content
  (`AMANUENSIS_ACTIVATION_CONTRACT = "codex-user-cwd-v1"`) and edit the TOML table, not
  a comment-delimited span, as the Claude Code and Copilot adapters already do.
- ~~**Non-ASCII paths break staleness and refresh.**~~ Reproduced, then fixed on branch
  `server-fixes`, 2026-11-16: with `core.quotePath` on (git's default), a modified `café.ts`
  was never marked stale, and change impact recorded `"caf\303\251.ts"`. `detect_changes`,
  the refresh drift check and `predict_change_impact` (a fourth site, not in the original
  report) now read `-z` output.
- ~~**`dev/check-living-conspectus.mjs` lists the fixture tree without `-z`.**~~ Fixed
  2026-11-19 (ccfcc3c) as detector 1.1.0, by the owner's decision: a new report and registry
  beside the 1.0.0 ones, which stay byte-identical because the rebuild receipts pin them. The
  1.1.0 report differs only in its measurement block; a test pins a non-ASCII path.
- ~~**The impact-aware review brief never lists a stale file.**~~ Found and fixed 2026-11-19 (7d7e153):
  `compile_review_brief` read stale rows from `entries`, which nothing writes, so its
  `unknowns` never carried one. It now reads obligation-bearing stale `file_ledger` rows, as
  object type `stale-file`.
- ~~**Three doors round the status ladder.**~~ Found by cross-family review and fixed 2026-11-19:
  leaving `deferred` skipped every forward prerequisite (3d0d20c); `reset_subsystem` could
  reset *up* to `mapped` (0df7889); and a status committed without its ladder rung lost the
  depth a parked subsystem resumes from (0df7889). A row parked before the ladder was kept
  still has no recorded depth and passes as it always did.
- ~~**`upsert_subsystem` defaults `status` to `unmapped`.**~~ Fixed on branch `server-fixes`,
  2026-11-16: an omitted status keeps the current one on update.

## Self-measurement

From `design/self-observability/README.md`. Layer A, the automatic per-call log, shipped in
0.2.0-beta.6 (21623df).

- **Layers B–D are proposals.** B records session provenance and lifecycle, including the
  model, which MCP does not carry. C adds truth signals: per pass type, model and skill version,
  how often a recorded conclusion is later overturned. D is an analyzer over A–C. Each builds on
  the one before.
- **Two call-log fixes have no test.** Storage migration's `storageManifest` skips `call-log/`,
  and the symlink walk tolerates a file vanishing mid-walk (ENOENT). Either could regress
  silently.

## Hosts and CI

- **No real Copilot session has been seen loading the registration.** The installer writes the
  Copilot CLI and VS Code registration (shared `~/.copilot`) and isolated-home tests cover it,
  but neither host has been observed starting the server. Codex and Claude Code have been.
- **An intermittent CI failure in the Python 3.11 materializer job.** GATE P10
  (`test-search-index.py`) once failed with "the browser never reported a debugging endpoint"
  (run 44238970148, 8464eef): headless Chrome did not start in time. It passed on every later
  run. Not investigated; a longer startup wait or one retry would likely cover it.

## Model routing

Nothing chooses the worker model. The skill names no model, nothing estimates task complexity,
and `subagent_log` has no model column (and no rows in the self-conspectus). Before building any
predictor: record the model on every dispatch, give each phase a default model and short
contexts, and run the self-rebuild's pilot. A full-session price comparison found Sonnet only 17%
cheaper than Opus, because cache reads dominate and cost the same; context size moves cost more
than model choice.

## Older defects from the Pecia ledger

Open in `.pecia/work.jsonl` as of 2026-09-22. Rows were checked against the published
self-conspectus (`docs/findings.md`, `docs/resolved-findings.md`) on 2026-11-17; unmarked rows were not
re-checked. The ids are the self-conspectus findings they came from; several were carried forward under
new ids (B03-6 became B03-R2, for example), and some ids were later re-minted for different findings
(B03-R6).

| Finding | Defect |
|---|---|
| ~~B04-R1~~ | ~~A default `describe_locus` call returns no items~~ Fixed 2026-11-19 (4aa6a66): the default budget is 15360 bytes, and each dogfood locus now serves its purpose sentence |
| ~~B02-R1, B02-2, B02-3, B04-R4~~ | ~~A stalled `git` or `ps` subprocess can hang server startup or a tool call indefinitely~~ Fixed on branch `server-fixes`, 2026-11-16: startup probes were already bounded; the 28 tool-time sites now go through `src/subprocess.ts` (120 s default, `AMANUENSIS_SUBPROCESS_TIMEOUT_MS`). Reproduced first: each tool waited out a stalled `git` |
| ~~B02-R2~~ | ~~The gate certifying time-bounded activation probes passes with an unbounded probe~~ Fixed 2026-11-18 (a18f552, carried as B02-R6): `test-startup-bounds.mjs` also reads `src`, so a direct `node:child_process` call without a `timeout` turns it red; the two it found, the doctor's probes in `cli.ts`, are bounded |
| ~~B02-R4~~ | ~~Under Codex Desktop the user-scoped registration starts the server with cwd `/`~~ Repaired, per `docs/resolved-findings.md` |
| ~~B02-R3, B05-2~~ | ~~The server reported an older version than its package~~ Fixed 2026-11-17 (893d94a, also B05-R1/B02-R7): the server reads its version from `package.json`, the compatibility probe asserts it, and the README no longer names one |
| ~~B02-4~~ | ~~A verified-fixed finding can be silently demoted to fixed-pending-verification~~ Repaired at 34a8762, per `docs/resolved-findings.md` |
| ~~B03-5~~ | ~~A subsystem can report `mapped` with no unledgered, absent or stale rows while most of its scoped files were never examined~~ Fixed 2026-11-19 (3c777a9): the advance to `mapped` refuses while any obligation-bearing ledger row of the subsystem is still `candidate`, naming the files (*"still 'candidate', never examined"*); `deferred-with-reason` or an exempt classification discharges a file. `get_dashboard` reports `examined_files` and `unexamined_files`. A store whose subsystems are already `mapped` is not re-checked |
| ~~B03-6~~ | ~~A finding can reach verified-fixed with a `fix_sha` the fix is not at~~ Fixed 2026-11-17 (carried as B03-R2): `fix_sha` must be the last commit to change the file `fix_location` names (not a directory), checked on write and again at verification; a carried finding's `repaired_sha` must have changed a file it cites |
| B03-7 | Moved content with still-valid claims has no way to be re-anchored. Needs design: evidence is insert-only, so a re-anchor is a new append-only row that supersedes the old citation, validated like `add_evidence`, and every reader of `claim_evidence` and `finding_evidence` has to take the current anchor |
| ~~B03-8~~ | ~~A finding's severity cannot be amended~~ Fixed 2026-11-17 (carried as B03-R4): `update_finding_severity`, with each re-grade and the revision it was judged at in `finding_severity_events`; `describe_locus` with `as_of_sha` replays it, and since f9c7e95 each re-grade is a row on `resolution-history.md`. `get_finding_resolution_history` stays resolution-only |
| B03-R1 | A rebuilt store can re-mint a finding id and satisfy an old external reference. Partly addressed 2026-11-18 (999ab78, then a trigger on `findings` so a racing carry cannot slip past the check): within one store, a live finding cannot take an id a carried record holds, and `carry_finding` reports a live finding that already has the archived id with the `<store-id>:<finding-id>` form the resolver accepts. This reverses `design/survey-depth/spec.md` §5.2, which let a successor re-find keep the archived id; gate A3 in `test-carried-findings.mjs` now asserts the refusal. A fresh store that carries nothing can still re-mint any id |
| ~~B03-R2~~ | ~~A clean-slate rebuild cannot carry an unresolved finding forward~~ Repaired at 6ac8d89, per `docs/resolved-findings.md`; the shadowing it left open is the 999ab78 work under B03-R1 |
| ~~B04-2~~ | ~~Every HTML page shows "No recorded stale entries" whatever the drift~~ Repaired, per `docs/resolved-findings.md` |
| ~~B04-3~~ | ~~The read-back gate cannot turn red on a stale-marker fault~~ Closed 2026-11-19 (056b737): `_ledger_stale_census` checks one marker per stale `file_ledger` row on `stale.md`, and the `entries`-derived marker, its read-back check and the two tests that required it are retired by the owner's decision; those tests now assert no such marker is published |
| ~~B04-4~~ | ~~"How to read this conspectus" teaches a superseded contradiction model~~ Repaired, per `docs/resolved-findings.md` |
| ~~B04-6~~ | ~~A publish fails when a finding resolves, because unchanged pages keep links to its old anchor~~ Fixed 2026-11-19, found by the first beta tester: the materializer kept an unchanged page's file from the last run, and the cross-reference pass skips IDs already inside a link, so the leads page kept `findings.md#<id>` after the record moved to `resolved-findings.md`. Unchanged pages are now relinked from fresh renderer output whenever today's index would link them differently (`test-xref-moved-target.py`, in CI) |
| B04-5 | Publishing went red on seven dangling anchors. Probably B04-6: the recorded workaround, shortening five rationales, changed those pages' sources and so re-rendered and relinked them. Not confirmed; that needs the downstream store's rows |
| ~~B04-R2~~ | ~~The adversarial pass cannot record a negative outcome at a single revision~~ Fixed 2026-11-19 (B04-R6 in the self-conspectus): a claim closes at its own `valid_from_sha`; see the decision above |
| ~~B04-R3~~ | ~~`add_claim` accepts a `claim_key` whose slug does not name the subject~~ Fixed 2026-11-17 (carried as B04-R7): `add_claim` applies the stable-key rule; keys stored earlier stay supersedable. Found by review, not fixed: `dev/test-rebuild-coverage.mjs` builds its flow-key regex from the subsystem id unescaped, so an id with a regex character (`B+01`) passed the server and failed the gate; escaped 2026-11-18 (760bda0) |
| ~~B05-R1~~ | ~~A clean publish and the live site can be green while the overview shows a placeholder thesis~~ Repaired at 30c87d5, per `docs/resolved-findings.md` |
| ~~B01-1~~ | ~~A subsystem surveyed as documented reports zero claims~~ Repaired, per `docs/resolved-findings.md` |
| ~~B01-R1~~ | ~~The phase references drift from the tools they describe, unchecked~~ Fixed 2026-11-19 (22a3005): `scripts/check-reference-calls.mjs`, in CI, requires every `tool(args)` code span in the skill to name a real tool and real arguments. Its first run found four drifts (`field_note` twice, `open_question`, `get_findings(finding_id=…)`), fixed. It cannot see a call outside a code span or a wrong argument value |
| ~~B07-1~~ | ~~A research refresh can hang on a network fetch~~ Fixed 2026-11-19 (dc5ad34): the GitHub fetch, the npm and shadcn CLI calls and the two snapshot verifiers' detector runs are bounded, and fail with the cause |
| B07-R1 | `dev/test-activation-evidence.mjs` never runs in CI. That is now the owner's CI scope (6c6d789); the gate is red on a drifted source digest and needs a live Codex capture (see "Release-time host evidence") |
| B07-R2 | `dev/test-rebuild-depth.mjs` cannot pass on a genuine clean-slate rebuild. It now exits at its designed CANNOT RUN state (2) rather than red, since its CI self-check was removed |
| ~~—~~ | ~~The regeneration gate asserts over a store the acceptance rebuild deleted~~ Deleted 2026-11-19 (443174e), by the owner's 2026-11-06 decision. **Replace it:** a regeneration gate bound to the store it reads, whose denominators come from the live store's own subsystems: every ladder rung witnessed by a recorded transition, every current claim challenged before `mapped`, every cross-subsystem import carried by a recorded edge, and the dogfood and depth receipts recorded at one store revision. Known gaps it would find today: no subsystem is `mapped`, three current claims have no challenge outcome, and the B-02→B-03 edge is unrecorded |
| ~~—~~ | ~~A mistaken outcome on a carried finding cannot be corrected~~ Fixed 2026-11-18 (f564925): `record_carried_outcome` takes `corrects_outcome_id`; the correction is a new append-only row that names the one it supersedes, and every reader takes the current outcome |

The `dev/` receipt gates are no longer in CI. On 2026-11-19 (97b62b4) the twelve that asserted
their own step in `test.yml` stopped doing so. Measured in a worktree with a copy of the store,
19 of the 26 left are green and P19 is at its designed CANNOT RUN exit. Six are still red:
- P11, EX8 and EX14: the self-conspectus is not reconciled with the tree (see the decision above).
- `dev/test-activation-evidence.mjs`: a drifted source digest that needs a live Codex capture.
- `dev/test-pecia-carry-audit.mjs` (P9): `dev/pecia-dogfood.md` does not account for `pc-5465`.
- `dev/test-amanuensis-pecia-defects.mjs`: Pecia v3.5 moved its output behind `--json`, and the
  ledger is rejected by the current Pecia CLI anyway (`E013`).

`dev/republish-docs.mjs` needs P11 among others, so a republish still ends red until the store is
reconciled or rebuilt.
