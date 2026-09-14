# **B-08** — Records: design, research, published projection, execution ledger

**Status**: 🟢 mapped  
**Layer**: records

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

design/ (reader-lenses, delightful-output-panel), scholiast/, dev/adr/, dev/roadmap.json and ROADMAP.md, docs/ (the checked-in projection), .pecia/ and dev/pecia-*.mjs, README.md, HISTORY.md, INSTALLATION.md, CONTRIBUTING.md

## Start here

design/reader-lenses/spec.md — the most recent design record and the one the merged work implements; then .pecia/work.jsonl with dev/pecia-resolve-finding.mjs for how execution custody refers back to the conspectus.

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-08/state-container/pecia-work-jsonl-amanuensis-references` | `.pecia/work.jsonl:amanuensis-references` | The committed ledger holds 163 records, 22 of which carry an `amanuensis:&lt;finding_id&gt;` foreign reference into the conspectus. Eight of those defects are closed, one is in-progress, and thirteen are open. The reference is attached as resolvable evidence only where it can resolve, because attaching it to open defects made `pecia audit` report legitimately-open work as unresolvable and destroyed the one signal that should mean a closure lost its licence. The eight closed records are therefore exactly the set whose closure licence depends on a finding the store must still hold. | Observation | `7c1c1a9f5689` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-08/flow/reference-not-copy/01` | `dev/pecia-dogfood.md:operating-contract` | Execution custody refers rather than copies, and the two systems keep one distinction each rather than re-deciding the other's. Amanuensis owns finding state; Pecia owns scheduling. `fixed-pending-verification` maps to `in-progress` and never to `done`, because both systems independently refuse to let "fixed" mean "verified", and the resolver licenses a closure only for `verified-fixed` or `ruled-out`. Because Pecia treats closure as final, a finding that returns after its defect closed gets a successor carrying `discovered_from` rather than an illegal reopen, and a label resolves to that chain's tail. The successor mechanism exists on the ledger side only. | Observation | `7c1c1a9f5689` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-08/concurrency` | `B-08` | These are records rather than running code, so the ordering that matters is between a record and the thing it describes, not between two processes. The Pecia ledger is append-only and treats closure as final, which makes ordering explicit rather than implicit. The one genuine multi-writer surface is the Pecia v2 timeline, which lives in Git's common directory rather than on a branch — the adoption record states that a clone must reconstruct or sync it before writing, and that the committed manifest is projection-only and deliberately does not claim machine-local timeline authority. | Inference | `7c1c1a9f5689` |

### Seam contracts

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-08/seam/S-07` | `S-07` | From this side, the tracked docs tree is a committed artifact that no one edits by hand and that a gate holds to the contract the materializer wrote: every page the promoted contract names must byte-match at the path it was committed to, every promoted file must be tracked so the commit contains what was verified, and the destination must hold no file no contract page or receipt artifact claims. The obligation this side accepts is therefore to commit exactly what the promotion verified and nothing else — the docs tree is not a place to add a page. | Observation | `7c1c1a9f5689` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[S-07](../seams.md#s-07)** | The published projection tree — .amanuensis/docs rendered, then promoted to the tracked docs/ | **[B-05](b05-materializer-human-projection-read-back-html.md)** | both parties are `mapped` |
| **[S-10](../seams.md#s-10)** | The `amanuensis:&lt;finding_id&gt;` foreign reference from the Pecia ledger into the conspectus | **[B-03](b03-knowledge-tools-and-workflow-api.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **[B-05](b05-materializer-human-projection-read-back-html.md)** | → | **B-08** | data-flow | structural | The rendered tree in project storage becomes the tracked docs tree only through a separate promotion step, and the projection contract written here is what that step re-verifies at the destination path before the bytes are committed. Read at materializer/amanuensis_materializer/readback.py:write_contract@7c1c1a9 which records a sha256 per page. |
| **B-08** | → | **[B-03](b03-knowledge-tools-and-workflow-api.md)** | dependency | structural | The Pecia ledger holds defect records whose evidence is the foreign reference amanuensis: plus a finding id, and a resolver opens this store to answer them, so a scheduling system outside the conspectus depends on this subsystem's finding ids and resolution states remaining meaningful. Read at mcp-server/src/tools/findings.ts:add_finding@7c1c1a9 where finding_id is taken from the caller with no generation component. |

## Known defects here

No defect here is open or awaiting verification.

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 11 of 14 ledger rows |
| Files in scope, not yet read | 3 of 14 |
| Files excluded from the survey obligation | 0 of 14 |
| Ledger rows the repository has changed under | 0 of 14 |
| Active concerns with a disposition recorded here | 22 of 30 — 4 confirmed-bug, 11 confirmed-acceptable, 7 out-of-scope |
| Findings by resolution state | none recorded |
| Seams assessable from both sides | 2 of 2 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-2becf3bfc5"></a>`ROADMAP.md` | candidate | Generated from dev/roadmap.json under a drift check. Read for its generated status only. | `7c1c1a9f` |
| <a id="le-04ee758d5c"></a>`dev/roadmap.json` | candidate | The canonical roadmap source. Read for its role, not its content. | `7c1c1a9f` |
| <a id="le-553765f28a"></a>`docs/index.html` | candidate | The committed projection's entry page — a generated artifact under a byte-match gate, republished by this rebuild rather than surveyed. | `7c1c1a9f` |
| <a id="le-d7a2c0bfb9"></a>`.pecia/config.yaml` | examined | Declares the amanuensis resolver scheme that makes a reference checkable. | `7c1c1a9f` |
| <a id="le-769c9585e0"></a>`.pecia/work.jsonl` | examined | 163 records, 22 of which carry amanuensis: foreign references into the conspectus. The live obligation this rebuild has to reconcile. | `7c1c1a9f` |
| <a id="le-d7578bf887"></a>`CONTRIBUTING.md` | examined | The test commands and the architectural-contract list, including the policy that a load-bearing contract belongs in the server rather than in agent prose. | `7c1c1a9f` |
| <a id="le-c8f616bce9"></a>`HISTORY.md` | examined | The user-visible release record. Its most recent entry is 0.2.0-beta.1 and there is no beta.2 entry. | `7c1c1a9f` |
| <a id="le-41cad45fe0"></a>`INSTALLATION.md` | examined | The installation surface a user follows; checked for a locally runnable evidence harness. | `7c1c1a9f` |
| <a id="le-b0e30cda16"></a>`README.md` | examined | States the source version as 0.2.0-beta.1, disagreeing with package.json. | `7c1c1a9f` |
| <a id="le-3bf79c7089"></a>`design/reader-lenses/spec.md` | examined | The design record the merged work implements: labels, standing, compactness, the survey changes, the rebuild procedure, and the gate table with each gate's false green. | `7c1c1a9f` |
| <a id="le-ef7b8e6007"></a>`dev/amanuensis-defects-to-pecia.mjs` | examined | The reconciler that carries a confirmed finding into the ledger by reference rather than by copy. | `7c1c1a9f` |
| <a id="le-de99d31b0f"></a>`dev/pecia-dogfood.md` | examined | The operating contract for execution custody, and three recorded limitations of the adoption. | `7c1c1a9f` |
| <a id="le-55faf822c4"></a>`dev/pecia-resolve-finding.mjs` | examined | The resolver: exits 0 only for verified-fixed or ruled-out, and never echoes its argument. | `7c1c1a9f` |
| <a id="le-ae7576563d"></a>`mcp-server/README.md` | examined | States the packaged version as 0.2.0-beta.1 and pins an install to that version. | `7c1c1a9f` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AL-1](../concerns.md#al-1)** | out-of-scope | code-verified |  | No runtime object graph exists here; these are files. |
| **[AT-1](../concerns.md#at-1)** | confirmed-acceptable | code-verified |  | The ledger is an append-only JSONL projection with one record revision per line, so a partial write leaves earlier revisions intact and the checker reads the sequence rather than a mutable head. There is no multi-row update that could be seen half-applied. |
| **[AT-2](../concerns.md#at-2)** | out-of-scope | code-verified |  | These records are tracked by the repository's own Git, not by the storage repository, so the checkpoint divergence [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md) owns does not arise here. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | doc-asserted |  | The two generated artifacts here both have drift checks in CI: ROADMAP.md is rendered from dev/roadmap.json with render-roadmap.mjs --check, and docs/ is held to the materializer's projection contract by the dogfood gate, which re-hashes every promoted page at the committed path. The un-generated documents are the drift problem, and that is [VR-1](../concerns.md#vr-1). |
| **[CC-2](../concerns.md#cc-2)** | confirmed-acceptable | config-asserted |  | The derived value here is a defect's status, and it is deliberately not derived: the ledger stores scheduling state and defers the truth of a repair to the resolver, which reads the conspectus live. That is a reference rather than a cached copy, so the two cannot disagree — which is what the reconciler's header says it is for, since duplicating findings into the ledger would create a second authority for one fact. |
| **[CR-1](../concerns.md#cr-1)** | confirmed-acceptable | contract-stated | 🔗 | The one multi-writer surface is the Pecia v2 timeline in Git's common directory, and the adoption record addresses it by refusing to claim more than it can: the committed manifest is declared projection-only, another clone must reconstruct or sync the timeline before writing, and the correspondence test deliberately does not assert machine-local timeline authority. Declaring the limit is the correct handling for a surface this repository does not own. Marked linchpin-dependent because the limit is stated rather than enforced. |
| **[CR-2](../concerns.md#cr-2)** | out-of-scope | config-asserted |  | No store is created here; the resolver only reads one and reports when it cannot. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | code-verified | 🔗 | The projection tool is a reconciler rather than an importer, the right failure shape for this seam: re-running writes nothing, and a finding whose state moved appends one revision, so a partial run leaves the ledger consistent and the next run completes it. Marked linchpin-dependent because the reconciler's --apply was not run in this pass. |
| **[EP-2](../concerns.md#ep-2)** | confirmed-acceptable | code-verified |  | The resolver distinguishes its failure paths rather than collapsing them: 0 resolved, 1 not resolved, 2 cannot run. The third code is the one that matters — an absent store is reported as an inability to answer rather than as a negative answer, so a missing conspectus cannot be read as a defect that failed to resolve. |
| **[ID-1](../concerns.md#id-1)** | confirmed-bug | code-verified |  | The concern's signature seen from the referencing side: 22 records name a finding by an id that carries no store generation, and eight stake a closure on it. The rebuild made all 22 point at nothing — loud and correct. What makes it a defect rather than a design choice is the other outcome: a rebuilt store that re-mints one of those ids satisfies the reference again, against an unrelated finding, with nothing reporting the substitution. The ledger side has vocabulary for the honest case, a successor carrying discovered_from, and no way to say the referent was destroyed. |
| **[ID-2](../concerns.md#id-2)** | confirmed-acceptable | contract-stated |  | The records that need a revision carry one and the ones that do not say so. The design spec pins its citations to file and line at a stated revision; the Pecia manifest binds a digest and a claimed timeline head and declares itself projection-only; the published projection records the revision it was rendered at. Where a record is deliberately not revision-bound — the A0 baseline pinned to b8b566f, which must not follow HEAD — that is stated as a rule rather than left implicit. |
| **[IF-1](../concerns.md#if-1)** | out-of-scope | doc-asserted |  | This subsystem receives a promoted tree; the incremental and clean publish paths are [B-05](b05-materializer-human-projection-read-back-html.md)'s and the divergence question is recorded there as unresolved. |
| **[IF-2](../concerns.md#if-2)** | out-of-scope | doc-asserted |  | Staleness of the ledger is derived by the server and rendered by the materializer; nothing here derives or reconciles it. |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | code-verified |  | The only resource acquired anywhere in this subsystem is the resolver's read-only database handle, released when its short-lived process exits. |
| **[SC-10](../concerns.md#sc-10)** | confirmed-bug | code-verified |  | Assessed from **B-08**'s side. Both halves confirmed. The reference can resolve against the wrong finding: it names an id with no generation, and the resolver opens whatever store is at .amanuensis/memory.db and reads that id's current resolution state, so a rebuilt store that re-mints the id satisfies a closure licence with an unrelated record. And neither side can express that a referent was destroyed: Pecia has discovered_from for a finding that returned and no vocabulary for one that ceased to exist, so this rebuild's eight closed references have to be argued in prose from an out-of-tree archive. Filed as B03-R1 and B03-R2. |
| **[SC-7](../concerns.md#sc-7)** | confirmed-acceptable | test-observed |  | Assessed from **B-08**'s side, answered by running the gate. The dogfood gate re-hashed 73 promoted pages at the committed path against the contract, confirmed the promoted contract and manifest are byte-identical to the artifacts the receipt verified, and confirmed every promoted file is tracked so the commit contains what was verified. All green this pass. The bytes verified are the bytes committed, established at the destination rather than inferred from the source. |
| **[SE-1](../concerns.md#se-1)** | confirmed-bug | contract-stated |  | [S-10](../seams.md#s-10)'s contract is only half-implemented. The ledger side has the vocabulary a rebuild needs — closure is final, and a returning finding gets a successor carrying discovered_from resolving to a chain's tail — and the conspectus side has nothing corresponding: no way to mint a finding as the successor of a discarded one, no export of open findings, no record in a new store that a finding is inherited. The honest reconciliation of this rebuild therefore has to be assembled by hand from an out-of-tree archive. Filed as B03-R2. |
| **[TB-1](../concerns.md#tb-1)** | out-of-scope | config-asserted |  | Records invoke nothing. The resolver is a subprocess Pecia spawns under its own control, not a call on any request path Amanuensis owns. |
| **[TR-1](../concerns.md#tr-1)** | out-of-scope | config-asserted |  | No model-authored argument reaches a filesystem path or SQL from these records. The one value crossing a process boundary is the resolver's target, dispositioned under [TR-2](../concerns.md#tr-2). |
| **[TR-2](../concerns.md#tr-2)** | confirmed-acceptable | code-verified |  | The ledger holds text written elsewhere and the boundary is handled explicitly: the resolver never prints its argument, on the recorded reasoning that a resolver echoing ledger text launders it into an agent's context, and it re-validates the target against a character class even though the caller already bounded it, because the value crosses a process boundary into a SQL parameter. The audit output withholds command text and says that it does. |
| **[VR-1](../concerns.md#vr-1)** | confirmed-bug | doc-asserted |  | Three of the four documents in this subsystem state the version and all three disagree with the package: README.md:78 says the current source is versioned as 0.2.0-beta.1, mcp-server/README.md:18 says the source tree packages as 0.2.0-beta.1 and :118 pins an install to that exact version, and HISTORY.md's most recent release entry is 0.2.0-beta.1 with no beta.2 entry at all — so a user reading the release history would conclude beta.2 does not exist. Nothing binds any of them to package.json. This is the documentation half of B02-R3 and the half a user actually reads. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-acceptable | contract-stated |  | The design record is where this concern is most explicitly answered rather than merely avoided. Section 13 opens by requiring every gate to name the condition that turns it red and the false green it cannot exclude, then does so for sixteen gates. It also identifies a subtler instance in the harness itself — a missing gate file exits non-zero for the wrong reason and the launcher would accept it as red — and requires each packet to carry a red_expect pattern plus a rejection of module-not-found output. A specification that anticipates its own false red is the strongest form of this concern being addressed. |

### Survey artifact

#### **B-08** · Records: design, research, published projection, execution ledger

**Revision read:** `7c1c1a9` · **Layer:** records · **Priority:** 5

##### Scope

`design/`, `.pecia/`, `dev/pecia-*`, the four root documents, `ROADMAP.md` and `docs/`.
Fourteen ledger rows; eleven `examined`, three `candidate` (`ROADMAP.md`, `dev/roadmap.json`,
`docs/index.html` — all generated, read for their generated status rather than their content).

##### Observed structure

**Execution custody refers rather than copies.** Amanuensis owns finding state; Pecia owns
scheduling. Two mappings carry the weight: `fixed-pending-verification` becomes `in-progress`
and never `done`, because both systems independently refuse to let "fixed" mean "verified";
and because Pecia treats closure as final, a finding that returns after its defect closed gets
a **successor carrying `discovered_from`** rather than an illegal reopen, with a label
resolving to its chain's tail.

**The reference attaches only where it can resolve.** The committed ledger holds 163 records;
22 carry an `amanuensis:<finding_id>` reference. Eight are closed, one is in-progress, thirteen
are open. Attaching the reference to open defects was tried and reverted: it made `pecia audit`
report nine legitimately-open defects as unresolvable and destroyed the one signal that should
mean a closure lost its licence. So the eight closed records are exactly the set whose closure
licence depends on a finding the store must still hold — and exactly the set this rebuild
invalidated.

**The documentation states the version four times and disagrees with the package.** `README.md`
"the current source is versioned as 0.2.0-beta.1", `mcp-server/README.md` "this source tree
packages as 0.2.0-beta.1" plus an install pin to that version, `HISTORY.md` with no
`0.2.0-beta.2` entry at all, against `package.json`'s `0.2.0-beta.2`. See B02-R3.

**`CONTRIBUTING.md` states the policy the rest of this survey is measured against:** "If your
change touches one, the contract belongs in the server, not in agent prose."

##### Concurrency

Records, not running code, so the ordering that matters is between a record and its subject.
The ledger is append-only and closure is final, which makes ordering explicit. The one real
multi-writer surface is the Pecia v2 timeline in Git's common directory: the adoption record
states a clone must reconstruct or sync it before writing, and that the committed manifest is
**projection-only** and deliberately does not claim machine-local timeline authority.

##### Seam contract offered ([S-07](../seams.md#s-07))

The tracked `docs/` is committed, never hand-edited, and held to the materializer's contract:
every named page byte-matches at the path it was committed to, every promoted file is tracked,
and the destination holds no file the contract and receipts do not claim. The obligation
accepted is to commit exactly what the promotion verified — `docs/` is not a place to add a
page.

##### Inference, separated from observation

The concurrency reading is an inference from the ledger's append-only shape and the adoption
record's own statement; no concurrent write was attempted.

##### Open

The machine-local Pecia timeline in `.git/pecia` is red under the current CLI — 19 `E014`
errors on `touched` derivation — while the committed projection passes. That is a
machine-local condition, not a property of this tree, but it bounds what this session can
write to the ledger.
