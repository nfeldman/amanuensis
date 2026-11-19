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
- **May a claim close at the revision it was recorded at?** An adversarial pass that finds a claim
  wrong at the commit it was recorded at cannot record `overturned` (self-conspectus finding
  B04-R6, carried from B04-R2; all 8 recorded outcomes there are `survived`). `invalidate_claim`
  and `supersede_claim` require a strict descendant of `valid_from_sha`, and the `claims` table
  forbids an empty interval with a `CHECK`, so allowing "never held" means rebuilding `claims`
  in every store behind its append-only triggers (`db.ts` has the pattern, in
  `migrateVocabularyChecks`). Until then the Phase 4 reference tells the pass to record the
  disproof as evidence and an anomaly note and to leave the subsystem short of `mapped`. The
  server does not enforce that: the `mapped` check accepts any earlier outcome on the claim, so
  a claim that recorded `survived` and was disproved later at the same commit still lets the
  subsystem advance (found by review, 2026-11-18). A latest-outcome rule would close it, but it
  needs a way to record the negative outcome first.
- **Resume the self-rebuild?** Paused 2026-11-06. The plan has three stages: real exclusion (an
  `.amanuensisignore` file: excluded paths get no ledger row, count or label anywhere), a model
  pilot (Haiku, Sonnet, Opus, Luna, Terra and Sol, two runs each, judged blind; judge not settled
  between one shared judge and cross-lab judging), then a from-scratch rebuild of the
  self-conspectus. Until exclusion lands, the published self-conspectus still maps research and
  design directories. Re-measure the gate baseline on `main` before resuming.
- **Release-time host evidence.** The A25/A26 activation checks left CI on 2026-11-06. Nothing
  compares the recorded host runs with the code between releases. A release that wants them needs
  a live Codex capture first, and the capture harness needs repair before it passes on current
  code. `dev/test-activation-evidence.mjs` (B07-R1) is red for the same reason: a recorded source
  digest for `mcp-server/src/project.ts` has drifted.
- **Reconcile the self-conspectus, or wait for the rebuild?** P11
  (`dev/test-survey-depth-acceptance.mjs`) is red only on its binding: the acceptance receipt's
  ledger accounts for 690 paths; at 7d7e153 the tree has 711, of which 23 are unledgered, and two ledgered paths were deleted with P20. The gap grows with each commit that adds a file.
  EX8 and EX14 run P11, so they are red with it. Repairing it means running `detect_changes` on
  the self-conspectus store and assigning or exempting each new path, which is Amanuensis use and
  needs the owner's go-ahead; the self-rebuild would replace it anyway.

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
| B04-5 | Publishing went red on seven dangling anchors. Mechanism unknown; reproducing it needs the downstream store's rows |
| B04-R2 | The adversarial pass cannot record a negative outcome at a single revision. Now B04-R6 in the self-conspectus; see the decision above. The Phase 4 reference says so (8ca8754) |
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
