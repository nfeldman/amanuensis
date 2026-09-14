# Decisions needed

_Questions the survey could not settle on its own. Each records what it blocked and the assumption the survey proceeded with, so a reader can see which readings would change if the assumption turns out wrong. Questions already settled are on [Resolved leads and questions](resolved-leads.md)._

## Domain knowledge

_1 open question._

<a id="question-4"></a>
### #4 · phase `onboarding-4`

> Territory 5 (aliasing and ownership) is weakly applicable to TypeScript-with-SQLite and to a Python process that reads and exits. Is one concern ([AL-1](concerns.md#al-1)) proportionate, or is the territory effectively disqualified here?

- **Assumption the survey proceeded with** — Kept one concern rather than disqualifying the territory. Long-lived module-level state does exist — the tool-definition arrays, the parsed contracts, the vocabulary tables — and the server is a long-running process, so a mutation that escapes lives for the life of the session. One concern is the smallest form that keeps the territory falsifiable instead of assumed away.
- **Recorded** — 2026-09-14 03:32 UTC.

## Ambiguous evidence

_1 open question._

<a id="question-5"></a>
### #5 · subsystem **[B-05](subsystems/b05-materializer-human-projection-read-back-html.md)** · phase `B-05 phase 3`

> Do the diff-aware incremental publish and clean_publish produce byte-identical trees from one store state? Two accounts of the code are both defensible and this pass could not discriminate between them.

- **Assumption the survey proceeded with** — Recorded [IF-1](concerns.md#if-1) as `unresolved-competition` rather than choosing. The optimistic reading is that both paths share one page plan, one write_contract and one three-axis verifier, so a divergence would have to survive a byte comparison. The pessimistic reading is that the diff-aware path decides what to re-render from registered artifacts' content hashes, so a page whose inputs changed without its artifact hash changing is skipped by one path and rendered by the other — and the shared verifier would not catch it, because it verifies what was written, not what should have been. Discriminating needs two runs over one store state and a tree diff; this pass ran only clean publishes.
- **Recorded** — 2026-09-14 04:09 UTC.

## Scope judgment

_2 open questions._

<a id="question-2"></a>
### #2 · phase `onboarding-5`

> This survey mints finding ids in a new namespace (`&lt;SID&gt;-R&lt;n&gt;`, e.g. B02-R1) rather than the previous store's `&lt;SID&gt;-&lt;n&gt;`. Is that the right convention, or should a rebuilt store restart the plain sequence?

- **Assumption the survey proceeded with** — Use the distinct namespace. The Pecia ledger holds 22 live `amanuensis:&lt;finding_id&gt;` foreign references minted against the discarded store; the resolver reads whatever store is on disk now, so a rebuilt store that re-minted `B03-1` would make a closed defect resolve against a different finding with no signal that the referent had changed. The distinct namespace makes every stale reference fail loudly, which is the behaviour the reference exists to provide.
- **Recorded** — 2026-09-14 03:32 UTC.

<a id="question-1"></a>
### #1 · phase `onboarding-5`

> Should the reader-lens code (standing.ts, tools/locus.ts, tools/claims.ts, tools/xrefs.ts, tools/vocabulary.ts, src/vocabulary.ts) be its own subsystem, or part of the knowledge-tools subsystem it is registered alongside?

- **Assumption the survey proceeded with** — Split out as [B-04](subsystems/b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md). It has a distinct contract (a compactness budget, a standing state machine, a single enum source, a consumer-facing route) that the other handlers do not share, and it is the newest code with the least prior scrutiny. The cost of the split is that [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) and [B-04](subsystems/b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md) share the claims and evidence tables, which is recorded as seam [S-06](seams.md#s-06) rather than hidden inside one subsystem.
- **Recorded** — 2026-09-14 03:32 UTC.

## Priority ranking

_1 open question._

<a id="question-3"></a>
### #3 · phase `onboarding-5`

> [B-07](subsystems/b07-gates-evidence-custody-and-ci.md) (gates, evidence custody, CI) is ranked 3, below the code it validates. Should the validation substrate be surveyed first instead, on the grounds that a defect there hides defects everywhere else?

- **Assumption the survey proceeded with** — Ranked 3. A gate defect is only legible once you know what the gate is asserting over, so reading the subject first makes the zero-denominator concern ([ZD-1](concerns.md#zd-1)) falsifiable rather than speculative. The risk accepted is that a gate defect found late does not get to inform the earlier subsystems' passes.
- **Recorded** — 2026-09-14 03:32 UTC.

