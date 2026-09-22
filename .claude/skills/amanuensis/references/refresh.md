# Refresh (discharge drift, don't just measure it)

When the human says "refresh", "refresh the survey", "refresh the
conspectus", or "bring the conspectus up to date", run this loop.

The audit sweep produces a worklist. **This route works it.** The
difference matters: a conspectus that reports its drift accurately and
never retires any of it is a more honest version of the same problem —
the reader still cannot rely on what it says about unreviewed files.

You read source code here. That is the whole point.

## The cardinal rule

`clear_staleness` asserts **"I re-examined this file at this commit."**
It is a claim, not a counter reset.

Never clear a row you have not read. Never clear in bulk. If you find
yourself about to clear more rows than you have read excerpts from this
session, stop — you are about to write the single failure the
methodology exists to prevent, in the one record whose job is to say
what has actually been looked at.

Reading a file and finding it unchanged in substance is a legitimate
re-examination. Skipping it is not.

## Loop

### 1. Reconcile

```
detect_changes(current_sha=<HEAD>)
```

Read every part of the result, not just `stale_count`:

- `unledgered_paths` — tracked files no subsystem has classified. Assign
  them with `add_files_to_scope` before anything else; coverage claims
  made over an incomplete ledger are worthless.
- `absent_ledger_paths` — rows whose file the repository no longer
  tracks. Retire each with `retire_ledger_file`. This does not touch the
  subsystem's dispositions, findings, artifacts, or cross-references.
- `reconciled_tracked_paths` / `reconciled_ledger_rows` — the
  denominators. Report them alongside any zero.
- `unverifiable_ref_rows` — rows whose examination commit is no longer
  reachable. These need re-examination and a clear at a reachable
  commit; they cannot be verified in place. The status ladder says the
  same thing back: *"an unreachable anchor cannot be verified in
  place"*.

`detect_changes` writes a reconciliation record, and two operations now
read it rather than take your word. Advancing a subsystem to `mapped`
and calling `materialize_docs` are both refused while *"the store has
not been reconciled against the repository at"* the revision being
published. Assigning the unledgered list before anything else is not
advice any more: publication is refused while the standing
reconciliation reports *"tracked path(s) with no ledger row"* or rows
the tree no longer carries. Every tracked path needs exactly one
subsystem assignment or an explicit exclusion with a reason before
coverage over that tree is published.

### 2. Order the work

```
get_stale_backlog(limit=<n>)
```

Ranked by access heat, so the files people actually read come first.
Rows exempt from obligation — `generated-ignore`, `vendor-ignore`,
`irrelevant` — never appear here and are not work. Their drift is
reported separately as `stale_exempt` and should be left alone.

### 3. Re-examine each file, then decide

Read the file at HEAD and compare it against what the conspectus already
claims about it. There are three outcomes, and only one of them is a
clear:

**Substantively unchanged** — formatting, comments, moved code, no
behavioral difference. Re-examination is complete.
`clear_staleness(subsystem_id, file_path, ref_sha=<HEAD>)`.

**Changed, and the recorded claims still hold** — the file evolved but
the dispositions, findings, and seam contracts written against it remain
true. Clear it, and record a field note if the change narrowed or
widened something a later reader would want to know about.

**Changed in a way that touches recorded claims** — a disposition cites a
symbol that no longer behaves as described, a finding's root cause was
refactored away, a seam contract moved. Do **not** simply clear. Attach
fresh evidence at HEAD and re-run the concern for that subsystem, or
record an open question naming what needs re-deciding. Then clear.

A file that invalidates a claim is the reason this loop exists. Treating
it as a flag to lower is how a conspectus rots while reporting itself
healthy.

### 4. Checkpoint as you go

The backlog can be large. Work it in heat order, and
`commit_phase_gate` every batch with a label naming what was cleared.
Partial progress that is committed and honest beats a long run that
loses its work. Report how many rows were cleared, how many were
escalated to a concern re-pass, and how many remain.

### 5. Close

Re-run `detect_changes` to confirm the reconciliation still holds, then
`materialize_docs(clean_publish=true, verify_readback=true)` so the
published surface matches the state you just established. Check
`get_dashboard().staleness_measured` before repeating any freshness
claim in your summary.

## Reinitialization (a rebuild, not a refresh)

A reinitialization discards a conspectus and surveys again. The findings
the old one held do not go with it: they carry forward as unverified
obligations that this store has to decide.

- **`--carry-from` is required.** The rebuild driver refuses to start
  without it. An empty carry is a reasoned declaration, stated with
  `--carry-reason`; it is never expressed by leaving the argument off.
- **Three outcomes, each asserting something about this store.**
  `successor-finding` names a finding filed in this session;
  `ruled-out` requires evidence collected in this store and attached;
  `repaired` requires a commit that resolves and an attached reading
  taken at or after it. Overturning requires evidence, not vibes.
- **A fourth is written by the carry, not by hand.**
  `archived-terminal` records that the archive had already closed the
  finding. It is not one of the three authority-bearing outcomes and
  cannot be claimed as one.
- **The store is not fully surveyed while *"carried finding(s) have no
  terminal outcome"*.** A discarded defect is not a decided one.

## What finishing means

The route is finished when every obligation-bearing row has either been
cleared against a real re-examination or escalated into recorded work —
not when the count reaches zero. A remaining count with named reasons is
a healthy result. A zero you cannot account for is not.
