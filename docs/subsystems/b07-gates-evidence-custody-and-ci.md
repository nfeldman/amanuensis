# **B-07** — Gates, evidence custody, and CI

**Status**: 🟢 mapped  
**Layer**: validation

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

dev/ (test-*.mjs gates, render-*.mjs and check-*.mjs projections, run-*.mjs harnesses, record-*.mjs receipt writers, conspectus/ A0 fixtures, activation-evidence/ receipts, hooks/pre-commit), mcp-server/test-*.mjs, materializer/test-*.py, .github/workflows/

## Start here

.github/workflows/test.yml for what actually runs, then dev/test-rebuild-coverage.mjs and dev/test-reader-lenses-dogfood.mjs as the shape every recent gate follows (two arms, a named red condition, and a declared false green).

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-07/key-type/github-workflows-test-yml-jobs-steps-run` | `.github/workflows/test.yml:jobs.steps.run` | Of the 106 gate files in the tree — 41 under dev/, 58 under mcp-server/, 7 under materializer/ — exactly four do not run in CI, and three of those are performance suites deliberately excluded from the correctness list. The fourth is dev/test-activation-evidence.mjs. Every materializer test runs. Several recent gates additionally assert their own presence in this workflow as one of their red conditions, which makes "the gate does not run in CI" a failure the gate itself reports rather than a silence. | Observation | `7c1c1a9f5689` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-07/state-container/dev-promote-docs-mjs-promote` | `dev/promote-docs.mjs:promote` | Promotion refuses six things in a stated order chosen so that a refusal never depends on a store or an interpreter being present, and writes nothing until all six pass. It then stages a copy beside the destination, renames it into place, and holds the previous contents in a backup until the promoted tree has been verified at the destination path — a red post-promotion read-back restores the backup and exits non-zero. The bytes committed are therefore the bytes verified at the path they were committed to. Run during this pass: 67 files promoted, read-back green on all three axes at docs. | Observation | `7c1c1a9f5689` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-07/flow/two-arm-gate/01` | `dev/test-rebuild-coverage.mjs:check` | The recent gates share one shape, stated in each header, and it is a direct response to this repository's recorded zero-denominator failures. Each has two arms — a committed receipt whose every property is re-derived rather than trusted from a summary, and the live subject wherever one exists, held to the same invariants — and each prints which mode it ran in, because a receipt nobody can contradict is a claim about a claim. Each enumerates the conditions that turn it red and states the false greens it cannot exclude. Each scrubs launcher crash signatures from its output so an absent deliverable reads as a failed assertion rather than as a gate that never ran, and each asserts its own presence in the CI workflow. | Observation | `7c1c1a9f5689` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-07/concurrency` | `B-07` | Gates run as independent short-lived processes and are designed not to share state: those that need a store build one in a throwaway workspace rather than using the repository's, and the rebuild procedure's own gate runs the real procedure against a temporary directory so the sequence is executed rather than described. The one shared-state hazard is a gate reading the live untracked store while a survey is writing it, which is why the live arm is read-only and secondary to the receipt arm. CI has no live store at all, so the concurrency exposure exists only on a developer machine. | Inference | `7c1c1a9f5689` |

### Seam contracts

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-07/seam/S-09` | `S-09` | From this side, [S-09](../seams.md#s-09)'s problem is that the subject is untracked and CI never has it. The contract adopted is: write a receipt from the store at a stated revision, re-derive every property from the receipt rather than trusting a summary, additionally read the live store wherever one exists, and print which mode ran. The receipt arm is what CI executes; the live arm is what stops the receipt being unfalsifiable. The obligation this places on the other party is that the receipt must be regenerated whenever the store changes — and this rebuild demonstrated the failure mode: the dogfood gate's three live-store assertions went red purely because the committed receipt still described the discarded store, while its receipt arm stayed green. | Observation | `7c1c1a9f5689` |

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-08/seam/S-07` | `S-07` | From this side, the tracked docs tree is a committed artifact that no one edits by hand and that a gate holds to the contract the materializer wrote: every page the promoted contract names must byte-match at the path it was committed to, every promoted file must be tracked so the commit contains what was verified, and the destination must hold no file no contract page or receipt artifact claims. The obligation this side accepts is therefore to commit exactly what the promotion verified and nothing else — the docs tree is not a place to add a page. | Observation | `7c1c1a9f5689` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[S-09](../seams.md#s-09)** | Committed receipts under dev/ and design/, and the untracked live store they describe | **[B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-07** | → | **[B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)** | dependency | observed | The gate that proves the activation path is time-bounded imports this subsystem's modules directly and runs them against a deliberately slow git on PATH, which makes the gate's coverage exactly the set of modules it imports. Read at mcp-server/test-startup-bounds.mjs:imports@7c1c1a9 which loads dist/codex-host.js and dist/project.js and nothing else. |
| **B-07** | → | **[B-05](b05-materializer-human-projection-read-back-html.md)** | dependency | structural | The promotion script drives the materializer's own read-back through its CLI in readback-only mode rather than reimplementing the three axes, so the gate and the projection agree by construction rather than by two implementations staying in step. Read at dev/promote-docs.mjs:promote@7c1c1a9 which invokes the same code path verify_materialized_docs executes. |

## Known defects here

2 defects here are open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- `dev/test-rebuild-depth.mjs` cannot be satisfied by a genuine clean-slate rebuild. It requires the rebuilt conspectus to carry the *previous* survey's concern codes, and to mint finding ids in exactly the shape that lets a stale external reference silently re-resolve. — [B07-R2](../findings.md#b07-r2) · 🟡 MEDIUM · Open
- `dev/test-activation-evidence.mjs` exists in the tree and never runs in CI, with nothing recording whether that is deliberate. — [B07-R1](../findings.md#b07-r1) · 🔵 LOW · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 11 of 14 ledger rows |
| Files in scope, not yet read | 3 of 14 |
| Files excluded from the survey obligation | 0 of 14 |
| Ledger rows the repository has changed under | 0 of 14 |
| Active concerns with a disposition recorded here | 21 of 30 — 3 confirmed-bug, 13 confirmed-acceptable, 5 out-of-scope |
| Findings by resolution state | 2 open |
| Seams assessable from both sides | 1 of 1 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-220212db51"></a>`dev/check-living-conspectus.mjs` | candidate | The A0 historical fixture checker. Read for contract only; the fixture is immutable and out of this rebuild's scope. | `7c1c1a9f` |
| <a id="le-f94389a270"></a>`dev/test-activation-evidence.mjs` | candidate | The one dev gate not referenced in .github/workflows/test.yml. Read to establish that fact, not its contract. | `7c1c1a9f` |
| <a id="le-18d39b8cd7"></a>`dev/test-amanuensis-pecia-defects.mjs` | candidate | Exits 2 rather than passing when the pecia CLI is absent. Read for that property only. | `7c1c1a9f` |
| <a id="le-f098d5ae6a"></a>`.github/workflows/test.yml` | examined | The authoritative gate list: 96 run steps across the roadmap, Pecia, server, materializer and packaging jobs. | `7c1c1a9f` |
| <a id="le-f18f27cb0e"></a>`dev/hooks/pre-commit` | examined | The Pecia write gate: reads the index rather than the working tree, and refuses rather than skips when the checker is absent. | `7c1c1a9f` |
| <a id="le-7ffe2b69df"></a>`dev/promote-docs.mjs` | examined | The six ordered refusals before any byte is written, and the verify-at-the-destination rule. Run and green during this pass. | `7c1c1a9f` |
| <a id="le-0ad260376b"></a>`dev/record-rebuild-coverage.mjs` | examined | Writes the coverage receipt from the live store, deriving rather than accepting, with a denominator read from a different place than the numerator. | `7c1c1a9f` |
| <a id="le-d808c16f8a"></a>`dev/record-rebuild-depth.mjs` | examined | Writes the depth receipt; expects storage checkpoints labelled 'Depth batch N' distinct from the coverage receipt's 'Rebuild batch N'. | `7c1c1a9f` |
| <a id="le-6b3ae3a5ee"></a>`dev/test-reader-lenses-dogfood.mjs` | examined | The dogfood gate. Run during this pass; its live-store arm went red against the rebuilt store while its receipt arm stayed green. | `7c1c1a9f` |
| <a id="le-09ac15f8ac"></a>`dev/test-rebuild-coverage.mjs` | examined | The clearest instance of the two-arm gate shape: a committed receipt re-derived rather than trusted, plus the live store, with the false green declared. | `7c1c1a9f` |
| <a id="le-ad1ef401f2"></a>`dev/test-rebuild-depth.mjs` | examined | The depth gate. Run during this pass and red on constraints this survey could not satisfy — a hard-coded checklist and a hard-coded finding-id shape. | `7c1c1a9f` |
| <a id="le-36f52f9a3d"></a>`dev/test-rebuild-readback.mjs` | examined | The P16 gate. Run during this pass and green, over both the receipt and its own throwaway workspace. | `7c1c1a9f` |
| <a id="le-89b23d75cb"></a>`mcp-server/test-locus-compactness.mjs` | examined | Run during this pass and green; its own measurements show it accepts a declared over-budget response and a served-zero census by design. | `7c1c1a9f` |
| <a id="le-64f6d49e14"></a>`mcp-server/test-startup-bounds.mjs` | examined | The activation-bound gate whose denominator excludes index.ts — finding B02-R2. | `7c1c1a9f` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AL-1](../concerns.md#al-1)** | out-of-scope | code-verified |  | Gates are one-shot scripts with no long-lived shared mutable state and no consumers holding references into them. |
| **[AT-1](../concerns.md#at-1)** | out-of-scope | code-verified |  | The receipt writers open the store read-only and the gates never mutate it, so there is no multi-table write to wrap. Promotion's file-write atomicity is dispositioned under [EP-1](../concerns.md#ep-1). |
| **[AT-2](../concerns.md#at-2)** | confirmed-acceptable | code-verified |  | This subsystem audits storage commits rather than writing them, in the direction that matters: batch membership is read off the checkpoint commit that made it recoverable, and the coverage gate turns red when a batch records no checkpoint, on the stated grounds that without one a failure resumes from the start. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-bug | test-observed |  | The receipts under dev/ and design/ are generated artifacts describing an untracked subject, and nothing regenerates them when it changes. Observed: after the store was rebuilt the dogfood gate went red on three live-store assertions purely because the committed receipt still described the discarded store. The two-arm design makes this visible rather than silent, so the check works — but it is still a generated artifact whose source moved, with regeneration left to a person remembering. |
| **[CC-2](../concerns.md#cc-2)** | confirmed-acceptable | code-verified |  | The receipt writers derive rather than accept, and deliberately give the gate a denominator it does not read from the same place as the numerator: registry_ownership maps every module index.ts imports to its owning subsystem, and the gate re-parses that tracked file for itself, so an edge missing from the store cannot be hidden by omitting it from the receipt too. |
| **[CR-1](../concerns.md#cr-1)** | confirmed-acceptable | test-observed | 🔗 | Gates that need a store build one in a throwaway workspace, which is why the rebuild gate can run the real procedure — including its stop-the-server and delete steps — without touching the live store; running it this pass left the live store intact. The remaining exposure is a read-only live arm during a concurrent survey. Marked linchpin-dependent: no gate was run concurrently with a write. |
| **[CR-2](../concerns.md#cr-2)** | out-of-scope | code-verified |  | Store creation is [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s; where a gate needs a store it builds one in a throwaway workspace. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | code-verified |  | The multi-file write this subsystem owns is the promotion, and its failure path is the strongest in the repository: six refusals before any byte is written, ordered so a refusal never depends on a store or interpreter being present; stage beside the destination and rename into place; hold a backup until the promoted tree verifies at the destination path; restore and exit non-zero on a red post-promotion read-back. The dogfood gate exercises the restore case independently and was green on it this pass. |
| **[EP-2](../concerns.md#ep-2)** | confirmed-acceptable | code-verified |  | The failure path this subsystem most needs to get right is "the checker is missing", and it refuses rather than skips: the hook exits 1 saying this is a refusal and not a skip, because a gate that passes without its checker is worse than none. test-amanuensis-pecia-defects.mjs takes the same line, exiting 2 rather than passing when the pecia CLI is absent. |
| **[ID-1](../concerns.md#id-1)** | confirmed-bug | test-observed |  | Two identity conventions are hard-coded into the depth gate in a way that binds a rebuild to the identities of the store it replaces. CHECKLIST_CONCERNS is the literal ["BV-1","[CC-1](../concerns.md#cc-1)","EV-1","GT-1","RC-1","[ZD-1](../concerns.md#zd-1)"] — the previous survey's codes — and the gate turns red when they are not active, so a fresh calibration is refused for not re-deriving codes onboarding Phase 4 exists to derive. And the finding-id assertion mandates exactly the id shape that lets a stale Pecia reference silently re-resolve against a new store. Both were hit by this rebuild, and the second one caught me directly: minting B07-1 to satisfy it collided with an archived finding of the same id that pc-861e still references. |
| **[ID-2](../concerns.md#id-2)** | confirmed-acceptable | code-verified |  | Every receipt binds itself to a repository revision and each gate checks that binding rather than assuming it. The dogfood gate's red conditions include the receipt not binding itself to a revision and to a workspace-local store with a resolved last_checked_sha, and it went red this pass on exactly the revision comparison. |
| **[IF-1](../concerns.md#if-1)** | confirmed-acceptable | code-verified |  | The two arms are this subsystem's full-versus-partial pair and their divergence is the point rather than a hazard: the receipt arm is complete and runs everywhere, the live arm is conditional, and each gate prints which it ran, so a gate that ran only the weaker arm says so. |
| **[IF-2](../concerns.md#if-2)** | out-of-scope | code-verified |  | Staleness is derived by the server and asserted over by the materializer's freshness gate; nothing here derives it. |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | code-verified | 🔗 | Temporary directories are removed on every exit path — the hook uses trap on EXIT, and gates that spawn a server probe the pid after shutdown rather than assuming it. The rebuild procedure's stop step was executed this pass: it signalled, waited, and confirmed ESRCH before deleting anything. Marked linchpin-dependent because not every gate was read for cleanup. |
| **[SC-9](../concerns.md#sc-9)** | confirmed-acceptable | test-observed |  | Assessed from **B-07**'s side, and answered by running the experiment rather than reading the design. Nothing forces regeneration, but the live arm detects the omission, which is the enforceable half: this pass rebuilt the store, left the receipt alone, and the dogfood gate went red on exactly three live-store assertions while every receipt-arm assertion stayed green. A receipt-only gate would have stayed green about a store that no longer exists. Detection rather than prevention is the right contract here, because the store is untracked and CI can never have it. |
| **[SE-1](../concerns.md#se-1)** | confirmed-acceptable | code-verified |  | Where this subsystem depends on a contract stated elsewhere it drives the other side's implementation rather than reimplementing it: promote-docs runs the materializer's own read-back through its CLI in readback-only mode, the same code path verify_materialized_docs executes, so the gate and the projection cannot drift into two definitions of green. The pre-commit hook likewise resolves the real pecia checker and refuses when it is absent. |
| **[TB-1](../concerns.md#tb-1)** | out-of-scope | code-verified |  | Gates are batch processes under a job timeout, not request handlers a host waits on; an unbounded subprocess here costs a slow job with a visible cause. |
| **[TR-1](../concerns.md#tr-1)** | confirmed-acceptable | code-verified | 🔗 | Gates run developer-authored code against repository-local paths, a weaker threat model than the server's, and the one place untrusted content crosses is the pecia resolver's argument, which is re-validated and never echoed. The hook reads the index rather than the working tree so a staged defect cannot be hidden by an unstaged repair. Marked linchpin-dependent because the harness scripts that drive live hosts were not audited. |
| **[TR-2](../concerns.md#tr-2)** | confirmed-acceptable | code-verified |  | The one place this subsystem handles content written by another system is the pecia resolver, and it is the clearest instance of the right treatment: it re-validates the target against a character class even though the caller already bounded it, because the value crosses a process boundary into a SQL parameter, and it never prints its argument, because a resolver echoing ledger text launders it into an agent's context. |
| **[VR-1](../concerns.md#vr-1)** | confirmed-acceptable | test-observed |  | Every receipt declares a contract string and a repository revision and each gate asserts both — the rebuild gate's first two green assertions this pass were that the receipt declares its contract and the packet that wrote it. Detector identities are versioned separately from corpus schemas, and the A0 baseline preserves both the original and successor detector rather than retargeting in place. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-bug | test-observed |  | The recent gates answer this concern well and the two run this pass behaved as designed. It is confirmed rather than closed because the older gates do not follow that shape and one is measurably deficient: test-startup-bounds.mjs certifies that activation-path probes are time-bounded while importing only two of the modules on that path, so the unbounded call at index.ts:108 is outside anything it can fail on. Filed as B02-R2. |

### Survey artifact

#### **B-07** · Gates, evidence custody, and CI

**Revision read:** `7c1c1a9` · **Layer:** validation · **Priority:** 3

##### Scope

`.github/workflows/test.yml`, eleven gate and receipt scripts read closely, three read only
far enough to establish one fact each. 14 ledger rows; 11 `examined`, 3 `candidate`.

##### Observed structure

**Coverage is near-total and measured, not assumed.** Of 106 gate files — 41 `dev/*.mjs`, 58
`mcp-server/test-*.mjs`, 7 `materializer/test-*.py` — exactly four are not referenced by the
workflow's 96 `run:` steps: `test-perf.mjs`, `test-perf-tier2.mjs`,
`test-adversarial-performance.mjs` (performance, deliberately out of the correctness list) and
`dev/test-activation-evidence.mjs`. Every materializer test runs.

**The recent gates share one shape,** stated in each header and aimed squarely at this
repository's recorded zero-denominator failures:

1. Two arms — a committed receipt whose every property is **re-derived** rather than trusted
   from a summary, and the live subject wherever one exists, held to the same invariants.
2. The mode is printed, "because a receipt nobody can contradict is a claim about a claim."
3. The red conditions are enumerated.
4. The **false green it cannot exclude** is stated explicitly.
5. Output is scrubbed of launcher crash signatures, so an absent deliverable reads as a failed
   assertion rather than as a gate that never ran.
6. The gate asserts **its own presence in CI** as one of its red conditions.

**Promotion refuses six things in a stated order** — chosen so a refusal never depends on a
store or an interpreter being present — then stages, renames, and holds a backup until the
promoted tree verifies *at the destination path*. A red post-promotion read-back restores the
backup and exits non-zero.

**The write gate reads the index, not the working tree.** `dev/hooks/pre-commit` extracts
`.pecia/work.jsonl` and `.pecia/config.yaml` from the index as a pair, so an unstaged repair
cannot hide a staged defect and unstaged edits cannot block a clean staged commit. When the
checker is absent it **refuses rather than skips**, on the stated grounds that a gate passing
without its checker is worse than none.

##### Concurrency

Gates are independent short-lived processes that avoid shared state: those needing a store
build one in a throwaway workspace, and the rebuild gate runs the real procedure against a
temporary directory so the sequence is executed rather than described. The one hazard is a
gate reading the live untracked store while a survey writes it, which is why the live arm is
read-only and secondary. CI has no live store at all.

##### Measured this pass

`dev/test-rebuild-readback.mjs` — green. `mcp-server/test-locus-compactness.mjs` — green, and
its own printed measurements show it accepts a declared over-budget response and a
served-zero census by design. `dev/test-reader-lenses-dogfood.mjs` — **red on three live-store
assertions**, all because the committed receipt still describes the discarded store; its
receipt arm passed. That is the seam working as designed, not a gate defect.

##### Seam contract offered ([S-09](../seams.md#s-09))

The subject is untracked and CI never has it, so the receipt arm is what CI executes and the
live arm is what stops the receipt being unfalsifiable. The obligation this places on the
other party is that the receipt must be regenerated whenever the store changes.

##### Inference, separated from observation

The concurrency reading is an inference from the gates' construction; no concurrent gate run
was performed. The three `candidate` files carry no structural claim.

##### Open

Why `dev/test-activation-evidence.mjs` is absent from CI was not established — whether it is
superseded by `check-activation-evidence.mjs` or simply dropped.
