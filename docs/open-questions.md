# Decisions needed

_Questions the survey could not settle on its own. Each records what it blocked and the assumption the survey proceeded with, so a reader can see which readings would change if the assumption turns out wrong. Questions already settled are on [Resolved leads and questions](resolved-leads.md)._

## Scope judgment

_3 open questions._

<a id="question-5"></a>
### #5 · subsystem **[B-11](subsystems/b11-development-harness-and-gates.md)** · phase `P19 Phase 3, concern review`

> [B11-2](findings.md#b11-2) records that three harness files carry raw NUL bytes and are therefore binary to grep and rg. It is filed under [ZD-1](concerns.md#zd-1) because the failure has the same shape — an answer taken from a denominator the instrument silently emptied — but [ZD-1](concerns.md#zd-1)'s recorded question is about gates asserting over absent records, not about searching source. Should this be its own discovered concern code, or does [ZD-1](concerns.md#zd-1) legitimately cover it?

- **What this blocked** — Nothing; the finding is recorded either way.
- **Assumption the survey proceeded with** — Filed under [ZD-1](concerns.md#zd-1) rather than opening a new concern mid-pass. Adding an active concern after ten subsystems are already mapped would require a disposition in each of them or a gap record for each, which would be ceremony over a single observation. The stretch is stated in the [ZD-1](concerns.md#zd-1) disposition's rationale rather than hidden.
- **Recorded** — 2026-09-12 13:09 UTC.

<a id="question-4"></a>
### #4 · subsystem **[B-12](subsystems/b12-vendored-research-corpus.md)** · phase `rebuild batch 6`

> [B-12](subsystems/b12-vendored-research-corpus.md)'s deferral was recorded at directory granularity: three entry documents carry a deferred-with-reason ledger row and the remaining 100 tracked files under scholiast/ carry none, so they count as unclassified rather than as deferred. Should the deferral be expanded to one row per file, or is a directory-scoped deferral the right granularity for a vendored corpus?

- **Assumption the survey proceeded with** — Directory-scoped, with the count left unclassified stated in the rebuild receipt rather than hidden. A conspectus that reported complete coverage while 47 percent of files were unclassified is a defect this repository has already recorded; leaving them visibly unclassified is the opposite failure mode and the safer one.
- **Recorded** — 2026-09-12 12:18 UTC.

<a id="question-1"></a>
### #1 · phase `onboarding Phase 5`

> Should scholiast/ (103 tracked files of a checked-in Scholiast research survey) be surveyed as part of this repository's conspectus, or treated as vendored corpus?

- **Assumption the survey proceeded with** — Treated as vendored corpus: registered as [B-12](subsystems/b12-vendored-research-corpus.md) and deferred with the reason on the subsystem row, so the census counts the files rather than reporting coverage over a repository it never looked at.
- **Recorded** — 2026-09-12 12:04 UTC.

## Tooling limit

_1 open question._

<a id="question-3"></a>
### #3 · phase `onboarding Phase 0`

> No language-intelligence tooling (call hierarchy, find-references) was available in this pass. How much of the structural inventory should be treated as provisional because call graphs were read rather than resolved?

- **Assumption the survey proceeded with** — Every flow step recorded as a claim names a symbol that was read in the file its evidence cites; no step is recorded from an inferred call. Edges are recorded only where the crossing was read, never from a shared name or path prefix.
- **Recorded** — 2026-09-12 12:04 UTC.

## Priority ranking

_1 open question._

<a id="question-2"></a>
### #2 · phase `onboarding Phase 5`

> [B-11](subsystems/b11-development-harness-and-gates.md) (development harness and gates) carries the repository's highest concentration of red-provable guarantees but is ranked 4. Should a subsystem that verifies the others be surveyed before them?

- **Assumption the survey proceeded with** — Ranked 4: the gates assert over the subsystems, so reading a gate before its subject gives the gate's claims nothing to be checked against. The ranking is by structural depth, not by importance.
- **Recorded** — 2026-09-12 12:04 UTC.

