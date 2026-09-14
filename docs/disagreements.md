# Records that disagree

_Each record below is a place where the survey could have written one reading and did not, because the evidence it had does not choose. That is information: it says where a further pass would change the record, and what kind of evidence it would take. Records the evidence did settle are on [Conflicting evidence](contradictions.md)._

## Findings that cannot both be right

No pair of findings is recorded as disagreeing.

## Competing explanations the evidence has not chosen between

No evidence matrix is open or recorded as unresolved competition.

## Concern reviews that recorded a competition

_1 review where two or more concerns each explain what was observed and the evidence does not separate them._

| Subsystem | Concern | Strongest evidence | Linchpin | Recorded | Rationale |
|---|---|---|---|---|---|
| [Materializer: human projection, read-back, HTML](subsystems/b05-materializer-human-projection-read-back-html.md) **[B-05](subsystems/b05-materializer-human-projection-read-back-html.md)** | **[IF-1](concerns.md#if-1)** | `code-verified` | yes | 2026-09-14 04:07 UTC | Both paths exist — the materializer is diff-aware and clean_publish is a distinct mode — and this pass could not discriminate between two accounts of them. On one reading they cannot diverge, because both render from one page plan and both end at the same write_contract and the same three-axis verifier, so a divergence would have to survive a byte comparison. On the other, the diff-aware path decides what to re-render from the registered artifacts' content hashes, and a page whose inputs changed without its artifact hash changing would be skipped by one path and rendered by the other — which is precisely the class this concern names and which the shared verifier would not catch, because it verifies what was written, not what should have been. Discriminating between them needs two runs over one store state and a tree diff, which this pass did not perform. Recorded as unresolved rather than guessed. |

