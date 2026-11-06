CANARY: 4cd6d2c0de5a48170f9155aa

# Explanation: rationale

Everything persuasive lives here. Reviewers do not see this file.

## Why a dedicated record and not claims

The first design put explanations in reserved claim slots (`<sid>/purpose`, `<sid>/account`).
Claims already carry evidence gating, revision binding, challenges and a place in
`describe_locus`, so reuse looked cheap. Reading the code overturned it on three points, each
of which would need a carve-out with an existing gate asserting the opposite:

1. A claim cannot be corrected at the commit it was written at (`claims.ts:149-160`). A typo, or
   a lint refusal that halts publication, would stay until the repository moved.
2. `apply_change_impact` closes every subsystem-subject claim when any ledger file of that
   subsystem changes, and closed claims are not rendered. An explanation would disappear from
   the page on the first refresh run, which is the opposite of visible ageing.
3. `requireChallengedClaims` refuses `mapped` while a current claim in the namespace has no
   challenge outcome. An account written or revised in Phase 5, after the adversarial pass,
   would block the advance it is part of.

A separate record collides with nothing, allows a correction at the same commit, and can age
in view. The cost is two tables, two tools and the enum and inventory bookkeeping, which the
vocabulary declination work already shows how to do.

The distinction is also the honest one. A claim is an individually falsifiable statement with
authority. An explanation is orientation: it tells a reader where to look and what to expect,
and the reader who needs to rely on a sentence follows it down to claims and evidence. Giving
orientation a claim's authority would overstate what a summary can carry.

## Why the old narrative is a bridge

The survey write-ups are the best prose the store holds and the least bound. Showing them
permanently beside a recorded account would put two accounts of one subsystem on a page with
nothing keeping them in step. Hiding them until every subsystem is re-explained leaves the
pages thin for no gain. Showing them, labelled, until the bound account exists gives readers
prose now and removes the duplicate when it would start to drift.

## Why two republishes

The first, at the end of the recovery slice, puts the improvement in front of the owner with
no new authoring, and it exercises the republish chain while the tree is simplest. If the
record slice stalls, the first slice is still a complete, reviewable result. The second
publishes the explanations.

## Why the chain becomes a script

It has been run by hand three times and each time cost a session a trap: the missing
`--publish-summary`, the hand-edited `end` row, a reconciliation after the publish. The lane
will run it at least twice more, and so will every later republish.

## Why reviews are untracked

A slice review adds two tracked paths after the packet that re-recorded the receipts, and the
acceptance gate inventories every tracked path. The survey-depth lane paid a five-step chain
for each review. Keeping the review record on disk and in the lane's reports removes that cost
without weakening the inventory.

## Why these byte caps

400 bytes holds one or two sentences, which is what a purpose is. 4096 is the optional-section
budget already in the reader-lenses specification, so an account written today can be served
whole if the owner later decides to put it on the wire.

## Why Sonnet implements

Model choice is made on cost and on what the verifier can catch, not on a quality premium the
program has never measured. The launcher verifies every packet's gate at its red commit and at
HEAD and runs the regressions, and an off-lineage reviewer attacks each slice. That is the
structure under which a cheaper producer is safe. Opus takes the packets where the output is
judgement that no gate checks (the carried-finding decisions, the explanations themselves) or
where the blast radius is wide (the `mapped` gate's fixtures). Effort levels are chosen, not
derived.

## Unsettled

- Whether an explanation is true or useful is unchecked. The adversarial phase reads it, and
  nothing records that it did.
- The census depends on every placeholder sentence having a predicate. A sentence added later
  without one is invisible to it.
- The ageing notice counts changed files. A one-line comment edit and a rewrite read the same.
- Five gates stay red on `main` after this lane. The branch is not a green CI run by itself.
- The primary checkout's store is not the store this lane changes. After a merge, the lane
  worktree's `.amanuensis` has to replace the primary's, or the live arms of the receipt gates
  will describe a different store.
- The wire is unchanged, so agents do not see explanations through `describe_locus` yet.
- Readable claims still vanish from a page when a refresh run closes them. That is existing
  behaviour and is more visible once claims are readable.
