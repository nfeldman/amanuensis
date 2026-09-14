CANARY: 6ba197132a56f2c85300dc20

# Survey depth: rationale

Everything persuasive about `spec.md` lives here. `claims.md` carries the decisions without
their reasons, so a blind reviewer re-derives rather than agrees.

---

## 1. The measurement that changed the design

The proposal names "examined fraction of obligation-bearing rows" as one of six axes a rebuild
must dominate. I re-derived it before writing anything:

```sql
SELECT printf('%.2f', 100.0 * SUM(classification='examined')
     / SUM(classification IS NULL OR classification IN ('candidate','examined')))
  FROM file_ledger;
-- baseline 59.57   candidate 80.77
```

The candidate wins by twenty-one points. The rebuild that covered a fifth of the repository
scores *better* on the proposal's own coverage measure than the survey it replaced, because it
ledgered only what it read. The denominator moved with the numerator.

This is not a quibble about arithmetic. It is the same failure the whole lane exists to fix,
appearing inside the fix: a measure that a session can satisfy by doing less. Had the gate
shipped as proposed, a future rebuild could pass the depth gate's coverage axis by ledgering
twenty files and examining eighteen.

So §1.4 makes every coverage denominator come from the repository's tracked paths at the store's
reconciled revision. Recomputed that way, at each store's own `last_checked_sha`:

| | baseline @ `61bc6b5` | candidate @ `7c1c1a9` |
|---|---:|---:|
| tracked paths | 503 | 607 |
| obligation-bearing | 371 | 605 |
| examined | 221 | 84 |
| **examined fraction** | **59.57 %** | **13.88 %** |

Forty-six points apart, in the direction everyone expected. And the baseline's ledger is exactly
complete at its own revision — 503 rows against 503 tracked paths, zero unledgered — which is why
its ledger-based and tree-based fractions agree to the hundredth. The two measures coincide
precisely when the store is reconciled, and diverge exactly to the degree it is not. The
reconciliation obligation of §3 is therefore not a separate rule that happens to sit nearby; it
is the precondition that makes a coverage fraction mean anything at all. That is the argument
for making §3 a publication gate rather than advice.

There is a cost, and it should be said plainly. A fraction target rises with the repository: a
rebuild at a revision with 900 tracked files must examine ~535 of them to clear 59.57 %, where
the baseline examined 221 of 371. I considered freezing an absolute count instead (≥ 221
examined). I rejected it because a conspectus covering a shrinking share of a growing repository
*is* getting shallower, and an absolute floor would let it. The fraction is the honest measure,
and the cost of honesty here is that a growing repository demands a growing survey. That is a
true statement about surveys.

## 2. Why the generative axes are printed and not enforced

`decisions.md` §3 and the proposal's §3.5 disagree. The proposal wants the gate red unless the
candidate meets or exceeds the baseline on field notes and vocabulary terms; the decision forbids
numeric minimums on exactly those obligations. The decisions bind, so §1.6 splits the axes.

The reason the decision is right, beyond its being the owner's: this repository has already
written the argument down twice, in the two places it had to make the same choice.

> Forcing a count, or a row per category, is a quota over a field the writer must author, which
> is the fabrication-to-order hazard BP4 names and the case GP8's v2 scope note excludes from
> substrate enforcement. — `mcp-server/src/invariants.ts:152-160`

> One outcome per claim is enough and no outcome is privileged — `survived` is a legitimate and
> common result, and demanding a quota of overturnings would manufacture them (BP4).
> — `mcp-server/src/invariants.ts:199-203`

A gate demanding 36 field notes produces 36 field notes. It does not produce 36 observations.
The obligation that actually bites is per-record and subtractive: *this* disposition carries
*this* attached row whose revision resolves; *this* subsystem either has a term with an anchor
that opens or has said out loud that it has none; *this* carried finding has been decided. None
of those can be satisfied by volume.

The check that this split is sufficient is empirical, and it passes: applied to the candidate as
measured, five of the six blocking axes are independently red — 501 unledgered against 0
recorded, 13.88 % against 59.57 %, 177 of 180 dispositions unattached, 0 terms and 0 declinations
across 8 mapped subsystems, 0 carried records against 13 open baseline findings. The rebuild
would have been stopped five times over without a single count over an authored field. If the
blocking set had needed a field-note floor to catch this rebuild, the tension would have been
real; it did not, so it is not.

What this costs is stated in §8.5 and is worth repeating: a future rebuild can meet B1–B6 while
recording a sixth of the baseline's field notes and be green. The mitigation is not a floor, it
is visibility — the deltas are printed by the gate and recorded in the acceptance receipt where
the slice review and the owner see them. A number a human reads and a number a gate enforces are
different instruments, and only the second one gets optimized against.

## 3. Why reconciliation needs its own record

The obvious implementation is to ask whether a `scope_gaps` row exists at the published revision.
It is wrong, and wrong in this repository's signature way: a perfectly reconciled store has zero
`scope_gaps` rows, because `detect_changes` deletes and rewrites the table on every run
(`git.ts:303-312`). "Zero gaps found" and "nobody looked" would be the same state. That is VP4(e)
— the silent-failure state must be out of band, not plausibly in range — and it is the exact
defect being fixed one layer up, where the projection prints `0` for the candidate's 501
unledgered paths because its query counts rows of an empty table.

Hence `scope_reconciliations`: an append-only row per run, carrying the counts and the revision.
It doubles as the fix for the projection, whose `_tracked_paths` currently reconstructs the
tracked universe *from the ledger it is measuring* (`renderers.py:2689-2708`) — a derived value
whose generator is the thing under test, which is GP28's stated bound on what a `--check` can
ever catch. Reading the universe from a record written by the comparison against `git ls-files`
replaces a self-referential denominator with a witnessed one.

The choice to gate `mapped` rather than `structural` follows the proposal's own suggestion and
ADR-0001's clause 1: `mapped` is where the inventory claim is made. Gating `structural` would
block a rebuild from making progress subsystem by subsystem, which is the working mode the
reader-lenses packetization established and which nothing here has reason to break.

## 4. Why the disposition rule is a required input, not a validator

`set_disposition` could simply refuse to write a disposition unless `attach_evidence_to_disposition`
had already run. That is worse: it makes the common path a two-call dance where the first call
fails, and a route whose happy path requires knowing to do something first is a route sessions
skip. 177 of 180 candidate dispositions are the measurement of exactly that.

Taking `evidence_ids` and attaching inside the same transaction makes the depth obligation
unskippable on the *common* path rather than enforced on the *exceptional* one. The status-advance
refusal stays anyway, for two reasons: it catches dispositions written before this change, and it
catches a `ref_sha` that stopped resolving after the write. Belt and braces here is not ceremony,
because the two checks fail on different populations.

The one honest weakness is named in §8.1: at the advance *to* `concerns` a subsystem usually holds
zero dispositions, so the check is vacuously satisfied — VP4(d), a conditional whose predicate
excludes its own motivating case. The proposal's wording ("`concerns` or beyond") is kept because
the real bite lands at `adversarial`, whose existing prerequisite is already ≥1 disposition, and
at `mapped`. Writing the vacuity into the gate's header is better than quietly narrowing the rule
or quietly pretending it bites earlier than it does.

## 5. Why carried findings are their own table

Putting a carried finding into `findings` is tempting and breaks three things. It collides with
the successor's id in a `TEXT PRIMARY KEY` namespace. It lets an inherited defect be counted as
one this survey found, which is a claim about work that did not happen. And it makes
`finding_resolution_current` — the resolver's authority — answer about a store that no longer
exists.

The separate table also makes `archived_store_id` possible, which is candidate finding B03-R1's
actual request: a finding id with no store generation lets a rebuilt store silently re-satisfy a
closed Pecia reference. Deriving the id from the archived `git_state` row means a carried record
always knows which conspectus it came from, and two different stores that happen to use the same
finding-id scheme cannot be confused.

The three terminal outcomes are not symmetrical and should not be. `ruled-out` requires evidence
collected in the *current session*, which is `requireOverturnEvidence`'s existing rule
(`invariants.ts:422-447`) transposed: pre-existing evidence carried over cannot overturn, because
the pass that overturns has to have looked. `repaired` requires both a resolving commit and a
post-repair reading, because ADR-0001 is explicit that a code change without new evidence is
`fixed-pending-verification`, never verified-fixed. `successor-finding` requires only a finding
filed here, because the successor carries its own evidence obligations.

Resolving Pecia references *through* the carried record, rather than resolving them the moment a
carry exists, is the load-bearing detail. An undecided carried finding exits 1. That makes
`pecia audit` report the closed Pecia record as unresolvable, which is precisely the cross-system
alarm the reference exists to raise — and it is why the 2026-09-14 rebuild's eight stale closures
were caught while its six destroyed *open* findings were not. The audit only looks at closed
records. Making the resolver honest does not close that gap; §8.9 says so, and B03-R2 stays open.

## 6. What the parity check does and does not buy

String identity between a hand-maintained register, a server file, and a reference file. That is
all. It catches the failure that actually happened — candidate finding B01-R1,
`phase-4-adversarial.md` instructing an operation the server refuses — and it cannot tell whether
either side is right, nor notice a fifth refusal nobody registered.

I considered a stronger design where refusal messages are generated from a single source into
both the server and the references. It is better and it is out of scope: it would touch every
refusal in the server, not the four this lane adds, and the lane's budget is better spent on the
obligations than on a refactor of message plumbing. The register is the cheap version that stops
the observed drift. §8.7 says exactly what it leaves open, so nobody later reads a green parity
check as evidence the prose is correct.

`check-evidence-vocabulary.mjs` is the precedent: it already holds a source, two generated copies
and `SKILL.md`'s prose ladder together, and it is a string check too.

## 7. On the acceptance rebuild running in this worktree

This worktree has no `.amanuensis` store. The reader-lenses recipe's snapshot and delete steps
are therefore no-ops here, and §7.4 runs them anyway. A recipe with a step that only executes in
some environments has a branch nothing has tested, and the next real reinitialization — in the
primary checkout, or in AxiomDB — will run the branch that was skipped. Running both steps
against an empty directory costs seconds and keeps the procedure single-pathed.

Inserting the carry *before* any survey work is the other deliberate ordering. If the carry ran
at the end, a session could survey, publish, and only then discover thirteen obligations it had
no plan for. Carrying first makes them visible from the first session, which is what an
obligation is for.

## 8. Parsimony, and what was cut

GP37 says a gate earns its place only when it protects a named invariant. Three things were
considered and dropped:

- **A field-note or open-question floor.** Dropped for §2's reasons; the deltas are printed.
- **A separate packet for the skill-reference edits, apart from the parity check.** Merged: the
  edits without the check are prose that drifts, and the check without the edits fails on its
  first run. One packet, one gate, one session.
- **A carried-finding block on `mapped` for the affected subsystem.** Dropped per the proposal's
  §4 and kept at the fully-surveyed predicate, so a rebuild can progress subsystem by subsystem.

Nine packets across four slices, one gate each, no shared gate files. S1 carries four because the
four substrate obligations touch different tables and different refusal sites and are
independently revertible; collapsing them would make a single red block all four.

## 9. Unsettled

- **AxiomDB's discharge cost.** §2.4 gives a mechanical path — `get_dispositions`, then
  `get_evidence(file_path=…)`, then `attach_evidence_to_disposition` — but whether the evidence
  rows it needs already exist in that store is unmeasured, because the repository is outside this
  lane's custody and was not opened. If they largely do not, its next refresh is a re-survey, not
  a backfill, and the owner may want to know that before the obligation lands.
- **Whether a reported axis should ever become blocking.** §1.6 chose no. The acceptance
  rebuild's printed deltas are the first real evidence for revisiting it: if a rebuild under the
  new obligations still records a sixth of the baseline's field notes, the obligations did not
  reach what the prose was holding up, and that is worth knowing.
- **The expected outcomes of the six lost findings.** §5.8 lists what I expect — B03-5 has a
  successor in this specification's own §3, the other five are undecided — but the acceptance
  rebuild decides them, and it may contradict me. It should be allowed to.
- **`B02-3` and `B07-1`.** Both are unbounded-hang defects, and candidate finding B02-R1 and
  B04-R4 describe the same class in the rebuilt store (`index.ts:108 gitRoot` with no timeout,
  ~60 unbounded subprocess sites). Whether the acceptance rebuild's successor findings absorb
  them or they belong to a separate lane is not settled here.
- **The `<SID>-R<n>` finding-id convention.** The clean-slate survey adopted it deliberately and
  recorded an open question asking the owner to confirm or override it; `dev/test-rebuild-depth.mjs`
  still expects `<subsystem-id-compact>-<N>`. §8.10 widens the gate to read the convention from a
  declared source rather than picking a winner, because picking one is the owner's call.

## 10. Unsettled after round 1

The round-1 reviews are dispositioned in `reviews/round-1/dispositions.md`: 60 items applied,
1 rejected.

A second pass over the applied result swept the spec against the plan for gates the reviews had
not reached, and found three the revision's own edits had left inconsistent. `GATE CR1`
(`dev/test-carry-receipt.mjs`, P8) existed only in `plan.json`: the spec never declared it, so the
gate the launcher would verify had no red condition, no control and no false-green statement
anywhere in the normative text — §8.9a now supplies all three, and C41 records the carry receipt as
the denominator document P10 reads and P11 does not rewrite. `GATE PA1` (P9) had a red condition in
prose inside §8.9 but neither of the other two, and now has its own §8.9b. C34's evidence
enumerated nine of the twelve packet gates; all twelve were checked against disk and `HEAD` and none
exists, so the claim held and only its enumeration was short.

The same sweep found two defects in `plan.json` that no review item had named. `completion.commands`
ran ten of the twelve packet gates: `dev/test-carry-receipt.mjs` and `dev/test-pecia-carry-audit.mjs`
were absent, so the lane could have reached completion with two of its own gates never run there;
both are added. Four packets carried a regression command twice. §7.5 also held two consecutive
sentences making the same claim, the first added by `3c4caf5` over the second without removing it —
the appended-not-replaced artifact of the revision's own editing. What the sweep did not find is any
packet gate whose red condition still rests on the absence of its file.

A third sweep, this one driven by the launcher's now-explicit red-commit rule, found the protocol
recorded in §8.0 was two-state where three of the gates are three-state. `GATE D0`, `GATE XS1` and
`GATE CR1` each exit **2** in a `cannot run`, which is non-zero — so a launcher checking only the
exit code would have accepted a gate that never read its inputs as that packet's red proof. That is
the `MODULE_NOT_FOUND` failure one level up: the gate's *file* is present, its *inputs* are not, and
nothing was asserted either way. §8.0 gains clause 3 making the red check a conjunction and naming
the input each of the three requires, and it records that D0's red proof is machine-local — the
store is untracked, so the same commit reports `cannot run` in a clean checkout. The same sweep
found §8.0's enumeration ran "§8.1 to §8.9b", which silently excluded the one packet gate specified
outside §8: D0's red conditions are §7.3's B1–B6. Both references now say §7.3 and §8.

What the revision did not close:

- **The two reviewers disagreed about 11 claims and the disagreement was never about the facts.**
  On every one of C12, C13, C15, C20, C21, C29, C31, C32 and C33, codex overturned and claude
  upheld or qualified — and when I checked the evidence, codex's was right in every case. The
  pattern is legible: codex challenged the *mechanism named* (does `requireWorkspaceCitation`
  actually resolve? does `git ls-files` read R's tree?) while claude challenged the *substrate
  behind it* (is the table really append-only? does the export really carry the id?). Neither
  reviewer found the other's class. One heterogeneous pair covered more than either pass did, and
  it is worth recording that both classes existed in a specification whose author believed it had
  already checked them.

- **Whether `store_generation` can be minted without a migration that rewrites rows.** §5.3 mints
  an immutable identity at schema creation. An existing store — AxiomDB, the candidate — has none,
  and the legacy derivation is sound only for a frozen archive. What identity a *live* pre-existing
  store should acquire, and when, is not settled. P0 will find out on a copy; if minting one on
  first open counts as rewriting the store, the fallback is that a live store has no identity until
  its next archive, and carried records from it name the archive rather than the store.

- **Whether `vocabulary_scopes` is a join table or a refusal.** §4.4 specifies the join table and
  names the narrower fallback. The join table is the right shape and the larger change; P3 chooses
  under its own budget, and the constraint that binds either way is that silent revocation is not
  permitted.

- **Whether the derived refusal set in §6.2 finds enough to justify itself.** It is a lexical scan
  for three message openings. It found `phase-1-scope.md:58`, which the hand register had missed
  for the whole of the design round — one real catch. Whether it catches a second, or whether the
  register plus a human reading is the honest ceiling here, is a measurement P7 can make and this
  revision cannot.

- **The 420 minutes in P10.** It is derived from the baseline's 35 sessions across a month against
  the rebuild's 6 in an evening, scaled to the 361 examined paths B2 requires. That is a better
  estimate than the 300 it replaces and it is still an estimate from two points. If P10 exhausts
  its budget the answer is more batches, not a lower B2: the fraction is frozen with the baseline.

- **`GATE CF2` is proved red more weakly than every other gate here.** The launcher verifies the
  red-then-green protocol against each packet's single `gate` field, and `plan-tool.mjs:221-224`
  permits one per packet with no two sharing a test path. §8.9 argues CF2 belongs to P4 — the
  resolver it tests ships there, so P9 would find it already green — but P4's gate field is CF1.
  CF2's red is therefore shipped inside P4's red commit and checked by P4's acceptance, by hand,
  and it runs as a regression command from P8 onward. §8.0 now says so. Whether the right repair is
  a plan schema that admits two gates per packet, or a packet boundary drawn where each gate gets
  its own red commit, is not settled here.

- **Decision 2's fallback was not triggered.** `decisions.md` §2 ("Substrate, not prose") names no
  fallback, and no claim it rests on was overturned. What the reviews found is that four of its
  obligations were still prose at the DDL level — tables declared append-only in a paragraph, with
  no trigger — and the revision replaced the paragraph with 12 triggers and the `IF NOT EXISTS`
  form the schema already requires. That is decision 2 being applied, not withdrawn.

- **Whether a machine-local red proof is a red proof.** §8.0 clause 3 requires `GATE D0`'s red to
  be taken where a live store exists, which is this worktree and not CI. The proof is real and it
  is unreproducible by anyone who does not hold the store — the same property the untracked store
  already forces on the depth measures themselves. Whether P10's red should instead be proved
  against a synthetic store committed for the purpose, as `GATE D1` already does for B1–B6, is a
  question the acceptance rebuild will be in a position to answer and this revision is not.
