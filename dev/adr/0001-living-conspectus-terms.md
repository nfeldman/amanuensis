# ADR 0001: Executable living-conspectus terms

- Status: accepted for A0
- Date: 2026-08-12
- Decision owner: Amanuensis
- Pinned baseline: `b8b566f` (`4ec74205c42b4c23d0034fd3f67001ba510bde6d`)
- Practice catalog: v2.7 (frozen for this run)

## Context

The roadmap uses words such as *fully surveyed*, *current*, and *complete* as gates. If those words remain prose, later work can make itself look successful by changing their meaning. A0 therefore gives each word a mechanically decidable meaning and a named failure destination. The repository and runtime remain the truth about behavior; this record is authoritative only about what Amanuensis has established at a named repository state.

The decision applies GP8, GP12, GP20, GP24, GP25, and GP28: mechanical checks are subtractive, observations remain separate from interpretations, gaps have destinations, fan-in checks exact sets, failures halt, and the report is derived and checked back against its source. The controls apply VP4, VP5, VP6, VP10, VP11, VP12, VP17, VP19, and VP20. These references mean Practice Catalog v2.7, not an unversioned recollection.

## Decision

### Fully surveyed

A conspectus is **fully surveyed at revision R** exactly when all of the following are true:

1. Its inventory names R and its immutable tree. Every tracked path in the pinned inventory has exactly one subsystem assignment or an explicit exclusion with owner and reason.
2. Every assigned subsystem is `mapped` and records completion of scope, structural, concerns, adversarial review, and packaging.
3. Every active concern has one terminal, evidence-backed disposition in every subsystem. Terminal means `confirmed-bug`, `confirmed-acceptable`, `ruled-out`, `out-of-scope`, or `unresolved-competition`; the last state is visible debt, not hidden success.
4. Every declared seam names two mapped endpoints and has an evidence-bearing integral assessment.
5. Every expected work item appears in the dispatched, landed, and scored sets of every run. Equality, not non-emptiness, is the contract.
6. A clean export agrees with durable state on three independent axes: state, coverage, and content.

Fully surveyed does not mean defect-free, question-free, or safe at revisions other than R.

### Current

An authoritative object is **current at revision R** when its evidence resolves at R, every validity predicate includes R, no unresolved invalidation or supersession event withdraws its authority, and all blocking obligations reachable from the object are closed. “Last checked” without those conditions is not current.

### Stale

An object is **stale** when repository change or dependency change makes its continued authority uncertain but no contrary evidence has yet established that it is false. Stale objects remain historically readable and are excluded from current-authority answers. Staleness creates a named revalidation obligation.

### Invalid

An object is **invalid at revision R** when evidence establishes that its assertion, evidence location, scope, or dependency contract does not hold at R. Invalid is stronger than stale and requires evidence or a mechanically demonstrated broken reference. Invalid history is retained.

### Resolved

An obligation, contradiction, or open question is **resolved** only when it has a terminal resolution, an owning actor or rule authorized to make that resolution, and resolution evidence or an explicit authorized dismissal. Disappearance from a view, a closed session, or a prose claim of completion is not resolution.

### Verified-fixed

A confirmed defect is **verified-fixed at revision R** only when new evidence collected at R exercises or inspects the repaired path and supports the fix. A code change, a developer assertion, or status `fixed` without new evidence is `fixed-pending-verification`, never verified-fixed. Historical defect identity is retained rather than relabeled as a new finding.

### Complete

A run is **complete** when its pinned conspectus is fully surveyed, no blocking obligation is missing, dispatched/landed/scored sets are equal to the expected set, every required control has a recorded red proof, and a clean export passes state/coverage/content read-back. Completion is boolean and halting; warnings cannot aggregate to green.

## Executable obligations

The checker emits stable IDs so every red has a destination:

| Contract | Obligation ID shape |
|---|---|
| File assignment or exclusion | `file:<path>:assignment` |
| Exclusion provenance | `file:<path>:exclusion-reason` |
| Phase sequence | `subsystem:<id>:phase-sequence` |
| Concern coverage | `concern:<subsystem>/<code>:disposition` |
| Seam endpoints | `seam:<id>:endpoint:<subsystem>` |
| Integral seam review | `seam:<id>:integral-assessment` |
| Run fan-in | `run:<run>:<dispatched|landed|scored>:<work>` |
| Replication | `run:unchanged-replicates:minimum-two` |
| Control presence | `control:<class>:specified` |
| Projection read-back | `export:<state|coverage|content>:read-back` |

The A0 checker deliberately does not decide whether an authored disposition is *true*. That is a generative field and is validated by the survey’s evidence/adversarial method. The checker enforces that the field exists, is terminal, is grounded, and remains reconciled. This is the catalog’s stated scope boundary for GP8.

## Alternatives considered

### Treat “mapped” as complete

Rejected. A collection of mapped subsystem rows cannot prove inventory coverage, seam composition, run fan-in, or projection integrity. It is vulnerable to unit-scoped verification being mistaken for system verification.

### Recompute the baseline from current HEAD

Rejected. That would let the baseline move with the treatment. The fixture names a commit, tree, ordered path hash, and fixture ID. Changes require a new fixture identity and a new baseline report.

### Store only aggregate counts

Rejected. Counts can remain equal while identities drift. The checker compares exact path/work/identifier sets and hashes content on export.

### Estimate statistical reliability from two repeats

Rejected. Two unchanged replicates establish separate outcomes and the metric’s discrete step size, not a variance-based reliability estimate. The report explicitly marks statistical MDE as not estimable.

## Consequences

- A0 can turn every named completion class red and identify the missing destination.
- Later initiatives may extend the manifest, but may not weaken these meanings without a superseding ADR and a new fixture identity.
- The pinned baseline is specific to Amanuensis and one runtime configuration. It proves the instrument is wired; it does not establish cross-repository or cross-model generality.
- `baseline-report.json` is derived from the fixture and checked on every run. Hand-editing the report cannot change the result.

## Falsifiers

This decision fails if any of these occur:

- Removing one file assignment, concern disposition, seam endpoint, landed item, scored item, or projection hash leaves the checker green.
- A failure does not name the missing obligation.
- The two unchanged repeats are pooled or lose their distinct run and replicate IDs.
- The checker passes only in the source checkout and fails from a clean export.
- A future implementation can label a defect verified-fixed without evidence at the repaired revision.
