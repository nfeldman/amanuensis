# Calibrated concern checklist — Amanuensis

Twenty concerns, derived at `7c1c1a9` from the eleven territories plus two local classes.
This supersedes the territory catalog for this project. Every subsystem's Phase 3 must reach
a terminal disposition on every concern that is active for it.

A well-formed disposition here cites `file:symbol@sha`, states an evidence quality it can
actually support, and is one of `confirmed-bug`, `confirmed-acceptable`, `ruled-out`,
`out-of-scope`, or `unresolved-competition`.

| Code | Territory | What would make it true here |
|---|---|---|
| `ID-1` | 1 · scope/context identity | A caller-supplied key (finding id, claim key, subsystem id, artifact path) is reused across a store generation, a binding, or a worktree without carrying what distinguishes them. |
| `ID-2` | 1 · scope/context identity | A locus row is read back without the `ref_sha` it was recorded at, so a fact true at one revision is served as current. |
| `VR-1` | 1 · scope/context identity (local) | A version, revision, or digest is stated in more than one place with no single source and no check binding them. |
| `CC-1` | 2 · cache coherence | A generated artifact is not regenerated when its source changes and no `--check` detects it. |
| `CC-2` | 2 · cache coherence | A derived view or dashboard counter disagrees with the tables it is computed from. |
| `TB-1` | 3 · temporal bound | An exogenous subprocess is invoked with no timeout on a startup or handler path. |
| `EP-1` | 4 · exceptional path | A failure part-way through a multi-file write leaves a partial store, docs tree, or host config with no restore. |
| `EP-2` | 4 · exceptional path | An error path skips a lock release, session close, or storage commit the success path performs. |
| `AL-1` | 5 · aliasing/ownership | Module-level mutable state is handed to a caller that can mutate the server's own copy. |
| `IF-1` | 6 · incremental/full divergence | Incremental publish and `clean_publish` do not produce the same tree from the same store. |
| `IF-2` | 6 · incremental/full divergence | The drift detector and a full reconciliation disagree about which files are stale. |
| `AT-1` | 7 · atomicity | A multi-table mutation is not one transaction, so a failure leaves the store internally inconsistent. |
| `AT-2` | 7 · atomicity | A storage Git commit and the DB mutation it records can diverge in either direction. |
| `CR-1` | 8 · concurrency | Two processes bound to one store race on a write the lock table does not cover. |
| `CR-2` | 8 · concurrency | Lazy first use races, or an interruption leaves an incomplete store a later open accepts. |
| `RL-1` | 9 · resource lifecycle | A handle, child process, or temp directory is acquired without a guaranteed release on every exit path. |
| `TR-1` | 10 · trust boundary | A model-authored tool argument reaches a path, a subprocess argument, or SQL without validation. |
| `TR-2` | 10 · trust boundary | Stored content is rendered into an agent's context or into HTML as instruction or safe markup rather than as untrusted data. |
| `SE-1` | 11 · seam contract | A contract stated on one side of a seam is not enforced on the other. |
| `ZD-1` | local | A gate reports green while asserting over an empty set. |

## Seam concerns

`SC-N` codes are derived per seam during seam assessment, once both parties are `mapped`.
They are not seeded here: an `SC` code names two specific parties, so seeding it against
eleven subsystems would create a denominator it does not belong to.
