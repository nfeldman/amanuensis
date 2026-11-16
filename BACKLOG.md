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

- **Raise the default `describe_locus` budget?** A default call on a surveyed file returns no
  items at all, explanations included: the response is 8,548–8,708 bytes with every item removed,
  over the 8,192-byte budget, because the envelope carries the payload twice. Serving a purpose
  sentence needs about 10,240. Measured in
  [design/explanation/locus-default-measure.json](design/explanation/locus-default-measure.json);
  deferred in [design/explanation/decisions.md](design/explanation/decisions.md) §5.
- **Resume the self-rebuild?** Paused 2026-11-06. The plan has three stages: real exclusion (an
  `.amanuensisignore` file: excluded paths get no ledger row, count or label anywhere), a model
  pilot (Haiku, Sonnet, Opus, Luna, Terra and Sol, two runs each, judged blind; judge not settled
  between one shared judge and cross-lab judging), then a from-scratch rebuild of the
  self-conspectus. Until exclusion lands, the published self-conspectus still maps research and
  design directories. Re-measure the gate baseline on `main` before resuming.
- **Release-time host evidence.** The A25/A26 activation checks left CI on 2026-11-06. Nothing
  compares the recorded host runs with the code between releases. A release that wants them needs
  a live Codex capture first, and the capture harness needs repair before it passes on current
  code.

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
2. **Run the orientation lint when an explanation is recorded,** not only at render, and narrow
   the count-fraction rule (`lint.py`, `_FRACTION`), which flags any `\d+/\d+`. It withheld an
   account for "exit codes 0/1/3", and the author learned of it only when publishing failed. Done
   when that sentence is accepted and "12/35 subsystems are mapped" is refused at write time and
   at render.
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
6. **`clear_staleness` records its basis:** an evidence id or a one-line reason. Today a clear
   can be audited only from session transcripts.
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

- ~~**Non-ASCII paths break staleness and refresh.**~~ Reproduced, then fixed on branch
  `server-fixes`, 2026-11-16: with `core.quotePath` on (git's default), a modified `café.ts`
  was never marked stale, and change impact recorded `"caf\303\251.ts"`. `detect_changes`,
  the refresh drift check and `predict_change_impact` (a fourth site, not in the original
  report) now read `-z` output.
- ~~**`upsert_subsystem` defaults `status` to `unmapped`.**~~ Fixed on branch `server-fixes`,
  2026-11-16: an omitted status keeps the current one on update.

## Model routing

Nothing chooses the worker model. The skill names no model, nothing estimates task complexity,
and `subagent_log` has no model column (and no rows in the self-conspectus). Before building any
predictor: record the model on every dispatch, give each phase a default model and short
contexts, and run the self-rebuild's pilot. A full-session price comparison found Sonnet only 17%
cheaper than Opus, because cache reads dominate and cost the same; context size moves cost more
than model choice.

## Older defects from the Pecia ledger

Open in `.pecia/work.jsonl` as of 2026-09-22 and not re-checked since; some may be fixed. The ids
are the self-conspectus findings they came from.

| Finding | Defect |
|---|---|
| B04-R1 | A default `describe_locus` call returns no items (see the first decision above) |
| B02-R1, B02-2, B02-3, B04-R4 | A stalled `git` or `ps` subprocess can hang server startup or a tool call indefinitely |
| B02-R2 | The gate certifying time-bounded activation probes passes with an unbounded probe |
| B02-R4 | Under Codex Desktop the user-scoped registration starts the server with cwd `/` |
| B02-R3, B05-2 | The server reported an older version than its package; at beta.5 `SERVER_VERSION` matches, so likely fixed |
| B02-4 | A verified-fixed finding can be silently demoted to fixed-pending-verification |
| B03-5 | A subsystem can report `mapped` with no unledgered, absent or stale rows while most of its scoped files were never examined |
| B03-6 | A finding can reach verified-fixed with a `fix_sha` the fix is not at |
| B03-7 | Moved content with still-valid claims has no way to be re-anchored |
| B03-8 | A finding's severity cannot be amended |
| B03-R1 | A rebuilt store can re-mint a finding id and satisfy an old external reference |
| B03-R2 | A clean-slate rebuild cannot carry an unresolved finding forward |
| B04-2 | Every HTML page shows "No recorded stale entries" whatever the drift |
| B04-3 | The read-back gate cannot turn red on a stale-marker fault |
| B04-4 | "How to read this conspectus" teaches a superseded contradiction model |
| B04-5 | Publishing went red on seven dangling anchors |
| B04-R2 | The adversarial pass cannot record a negative outcome at a single revision |
| B04-R3 | `add_claim` accepts a `claim_key` whose slug does not name the subject |
| B05-R1 | A clean publish and the live site can be green while the overview shows a placeholder thesis |
| B01-1 | A subsystem surveyed as documented reports zero claims |
| B01-R1 | The phase references drift from the tools they describe, unchecked |
| B07-1 | A research refresh can hang on a network fetch |
| B07-R1 | `dev/test-activation-evidence.mjs` never runs in CI |
| B07-R2 | `dev/test-rebuild-depth.mjs` cannot pass on a genuine clean-slate rebuild |
| — | The regeneration gate asserts over a store the acceptance rebuild deleted; two of its failures may be genuine |
| — | A mistaken outcome on a carried finding cannot be corrected |

The `dev/` receipt gates are no longer in CI, and 17 of 27 failed at `71f3450`; most fail only
because they check that they are listed in the workflow. `dev/republish-docs.mjs` ends red until
they are cleaned up or retired.
