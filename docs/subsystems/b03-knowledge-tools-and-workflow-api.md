# **B-03** — Knowledge tools and workflow API

**Status**: 🟢 mapped  
**Layer**: api

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server/src/tools/ — every handler module except locus.ts, claims.ts, xrefs.ts and vocabulary.ts (which are [B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)): subsystems, files, evidence, dispositions, findings, resolution, concerns, contradictions, diagnosticity, field-notes, open-questions, seams, stale, impact, refresh, review, review-analysis, review-session, composition, codebase-brief, design-session, decisions, research, crosswalk, learning, evaluation, chorusmith-adapter, revalidation, compare, dashboard, artifacts, git, locks, logging, dispatch, project, storage-history, materialize.

## Start here

tools/evidence.ts and tools/dispositions.ts — the evidence anchor is the methodology's load-bearing constraint; then tools/findings.ts and tools/resolution.ts for the resolution chain, then tools/subsystems.ts for the knowledge-depth gates.

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/key-type/mcp-server-src-tools-subsystems-ts-reset-subsystem` | `mcp-server/src/tools/subsystems.ts:reset_subsystem` | reset_subsystem is the only path that regresses knowledge depth, and it clears dependent rows in one transaction so an interrupted reset cannot leave a subsystem at an earlier status carrying survey output from a later one. Dispositions, findings, field notes, xrefs and artifacts always go; the file ledger and every claim under the subsystem's prefix go only when the target is scoping or earlier, on the stated reasoning that a reset below structural discards that phase. Claim matching uses substr rather than LIKE because a subsystem id may contain wildcard characters, and it removes historical versions with current ones so no history is left with a hole. The xref deletion matches either endpoint, so a reset also removes edges other subsystems recorded toward this one. | Observation | `7c1c1a9f5689` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/state-container/mcp-server-src-tools-dispositions-ts-set-disposition` | `mcp-server/src/tools/dispositions.ts:set_disposition` | A disposition cannot be written without an evidence anchor, an evidence-quality tag, a rationale, a revision that resolves in the bound workspace, and a pass type. Three of its vocabulary-bearing fields — classification, evidence_quality and pass_type — go through requireEnum against the generated vocabulary source rather than being accepted as free text. The methodology's central constraint is therefore a refusal in code, not a request in prose. | Observation | `7c1c1a9f5689` |
| `B-03/state-container/mcp-server-src-tools-findings-ts-add-finding` | `mcp-server/src/tools/findings.ts:add_finding` | add_finding writes the finding row and its opening resolution event in one step, so a finding cannot exist without a resolution state, and it resolves ref_sha at ingress as the revision that opening event is placed at. The identifier is taken from the caller through requireString with only a documented convention behind its shape, and the primary key on finding_id is the only uniqueness constraint it carries — scoped to one store, with nothing in the row recording which store generation minted it. That is the property [S-10](../seams.md#s-10)'s foreign reference depends on and does not get. | Observation | `7c1c1a9f5689` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/flow/status-ladder/01` | `mcp-server/src/invariants.ts:enforcePhasePrerequisites` | Four of the five status transitions carry a mechanical prerequisite, each naming the deliverable of the phase being left: `structural` requires a non-empty file ledger and at least one current claim under the subsystem's prefix; `concerns` requires a registered subsystem-survey artifact; `adversarial` requires at least one disposition; `mapped` requires a recorded challenge outcome on every current claim. enforceForwardPrerequisites walks every rung between the current status and the target, so a skipped phase names itself rather than being silently jumped, and it treats an insert opening at a later status as an advance from unmapped because upsert_subsystem is a status writer too. | Observation | `7c1c1a9f5689` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/concurrency` | `B-03` | Roughly forty handler modules share one connection and run one at a time within a process, because the MCP dispatcher awaits each handler and better-sqlite3 is synchronous. Multi-row mutations that must not be seen half-done are wrapped individually in db.transaction by the handler that owns them — reset_subsystem is the clearest case — rather than by a transaction around dispatch, so atomicity is per-handler and opt-in. Across processes, exclusion is advisory: acquire_lock and release_lock write and clear rows in active_write_locks, and nothing compels a writer to take one first. | Inference | `7c1c1a9f5689` |

### Seam contracts

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/seam/S-10` | `S-10` | From this side, what [S-10](../seams.md#s-10)'s foreign reference resolves against is a finding id and its current resolution state, and this subsystem guarantees only the second of those. The resolution chain is append-only and its terminal states are meaningful: the resolver exits 0 only for verified-fixed or ruled-out, and fixed-pending-verification deliberately does not resolve, so Pecia inherits the distinction between claiming a repair and proving one rather than re-deciding it. What this side does not guarantee is that a finding id means the same thing over time. finding_id is caller-supplied, carries no store generation, and a rebuilt store may mint it again for an unrelated finding; the resolver reads whatever store is at .amanuensis/memory.db now and cannot tell one generation from another. | Observation | `7c1c1a9f5689` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[S-01](../seams.md#s-01)** | .amanuensis/memory.db — the SQLite store, its schema, and the single open handle | **[B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)** | both parties are `mapped` |
| **[S-06](../seams.md#s-06)** | The claims, claim_evidence, evidence and xrefs tables — written by the survey handlers, read by the reader route | **[B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)** | both parties are `mapped` |
| **[S-08](../seams.md#s-08)** | The phase contract — stated as prose in the skill, enforced as prerequisites in the server | **[B-01](b01-survey-methodology-and-agent-contracts.md)** | both parties are `mapped` |
| **[S-10](../seams.md#s-10)** | The `amanuensis:&lt;finding_id&gt;` foreign reference from the Pecia ledger into the conspectus | **[B-08](b08-records-design-research-published-projection-execution-ledger.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-03** | → | **[B-05](b05-materializer-human-projection-read-back-html.md)** | data-flow | structural | materialize_docs is a handler here that spawns the Python materializer as a child process and asserts the output path stays inside project storage, which is why the tool cannot be pointed at the tracked docs tree and promotion is a second explicit step. Read at mcp-server/src/tools/materialize.ts:resolveStorageOutputPath@7c1c1a9 which resolves a relative output_dir against storagePath and asserts containment. |
| **[B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)** | → | **B-03** | data-flow | structural | The reader route serves rows the survey handlers write: a claim binds evidence rows created by add_evidence and describe_locus reads them back as a locus account, so this subsystem's output is only as good as that subsystem's input. Read at mcp-server/src/tools/claims.ts:requireFileAnchoredEvidence@7c1c1a9 which resolves each evidence id and reads its kind and file_path. |
| **[B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)** | → | **B-03** | dependency | structural | index.ts imports roughly forty handler modules from tools/ and hands each the same DB getter, so every knowledge tool writes through the one handle this subsystem owns — read at mcp-server/src/index.ts:main@7c1c1a9 where allTools is assembled and ctx.db is defined as a lazy getter. |
| **[B-01](b01-survey-methodology-and-agent-contracts.md)** | → | **B-03** | dependency | structural | The skill states the phase contract as prose and this subsystem enforces the subset of it that is mechanical, so a phase obligation the prose states and the code does not check is enforced only by a model choosing to comply. Read at mcp-server/src/invariants.ts:enforcePhasePrerequisites@7c1c1a9 which is the enforced subset in full: a ledger, a claim, an artifact, a disposition, and a challenge outcome. |
| **[B-08](b08-records-design-research-published-projection-execution-ledger.md)** | → | **B-03** | dependency | structural | The Pecia ledger holds defect records whose evidence is the foreign reference amanuensis: plus a finding id, and a resolver opens this store to answer them, so a scheduling system outside the conspectus depends on this subsystem's finding ids and resolution states remaining meaningful. Read at mcp-server/src/tools/findings.ts:add_finding@7c1c1a9 where finding_id is taken from the caller with no generation component. |

## Known defects here

2 defects here are open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- A finding id can be re-minted by a rebuilt store and silently satisfy an external reference that was made against a different finding. Discarding a store makes every `amanuensis:&lt;finding_id&gt;` reference fail, which is loud and correct; re-minting one of those ids makes a closed defect resolve again, with nothing anywhere reporting that the referent changed. — [B03-R1](../findings.md#b03-r1) · 🟠 HIGH · Open
- A clean-slate rebuild has no supported path for carrying an unresolved finding forward. Discarding a conspectus discards its open defects with it, and nothing tells the systems that referenced them that the referents were destroyed rather than resolved. — [B03-R2](../findings.md#b03-r2) · 🟡 MEDIUM · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 14 of 20 ledger rows |
| Files in scope, not yet read | 6 of 20 |
| Files excluded from the survey obligation | 0 of 20 |
| Ledger rows the repository has changed under | 0 of 20 |
| Active concerns with a disposition recorded here | 24 of 30 — 4 confirmed-bug, 14 confirmed-acceptable, 1 ruled-out, 5 out-of-scope |
| Findings by resolution state | 2 open |
| Seams assessable from both sides | 4 of 4 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-65e66fcabf"></a>`mcp-server/src/tools/composition.ts` | candidate | Exact fan-in and the integral HEAD lane. Read for shape only. | `7c1c1a9f` |
| <a id="le-140b6f3d29"></a>`mcp-server/src/tools/contradictions.ts` | candidate | First-class contradiction rows. Read for shape only. | `7c1c1a9f` |
| <a id="le-0e49fbf332"></a>`mcp-server/src/tools/diagnosticity.ts` | candidate | Competing-concern matrices. Read for shape only. | `7c1c1a9f` |
| <a id="le-b57fab0c08"></a>`mcp-server/src/tools/impact.ts` | candidate | Change impact and claim invalidation on file change. Read for shape only. | `7c1c1a9f` |
| <a id="le-dd3a3c7de8"></a>`mcp-server/src/tools/refresh.ts` | candidate | Unattended refresh custody: dispatch and landing boundaries, obligation reconciliation. Read for shape only; its recovery contract was not exercised. | `7c1c1a9f` |
| <a id="le-8278578c81"></a>`mcp-server/src/tools/review-analysis.ts` | candidate | Independent review passes, blinding and null controls. Read for shape only. | `7c1c1a9f` |
| <a id="le-d6880bf731"></a>`mcp-server/src/tools/concerns.ts` | examined | The calibrated checklist and its coverage view. | `7c1c1a9f` |
| <a id="le-bc82b199a5"></a>`mcp-server/src/tools/dashboard.ts` | examined | The derived counters a reader and the projection both read. | `7c1c1a9f` |
| <a id="le-23127afcd5"></a>`mcp-server/src/tools/dispositions.ts` | examined | The per-concern verdict writer; enforces the evidence anchor and the evidence-quality tag. | `7c1c1a9f` |
| <a id="le-ed6472d9a0"></a>`mcp-server/src/tools/evidence.ts` | examined | add_evidence — the row every claim, disposition and finding must cite. | `7c1c1a9f` |
| <a id="le-4020309e5e"></a>`mcp-server/src/tools/field-notes.ts` | examined | The catch-all for observations the phase structure did not ask for. | `7c1c1a9f` |
| <a id="le-566054a018"></a>`mcp-server/src/tools/files.ts` | examined | add_files_to_scope and update_file_classification — the ledger the standing predicate reads. | `7c1c1a9f` |
| <a id="le-44c699c32a"></a>`mcp-server/src/tools/findings.ts` | examined | add_finding, update_finding_status and verify_finding_fix — the resolution chain a Pecia reference resolves against. | `7c1c1a9f` |
| <a id="le-6ef26ea3bf"></a>`mcp-server/src/tools/locks.ts` | examined | acquire_lock and release_lock — the advisory cross-process exclusion [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s concurrency claim defers to. | `7c1c1a9f` |
| <a id="le-4a321e9eb2"></a>`mcp-server/src/tools/materialize.ts` | examined | The handler that spawns the materializer and asserts output containment; the [S-04](../seams.md#s-04) boundary from this side. | `7c1c1a9f` |
| <a id="le-be8daa9f30"></a>`mcp-server/src/tools/open-questions.ts` | examined | The autoprogress escape valve: record_open_question with what_assumed. | `7c1c1a9f` |
| <a id="le-95db056444"></a>`mcp-server/src/tools/resolution.ts` | examined | The append-only resolution history and its invariant audit. | `7c1c1a9f` |
| <a id="le-1be82c1094"></a>`mcp-server/src/tools/seams.ts` | examined | upsert_seam and get_seam_assessability — both parties mapped is the assessability predicate. | `7c1c1a9f` |
| <a id="le-6a992a5f92"></a>`mcp-server/src/tools/stale.ts` | examined | The ledger-derived staleness surface and its denominator. | `7c1c1a9f` |
| <a id="le-8aacc5b615"></a>`mcp-server/src/tools/subsystems.ts` | examined | upsert_subsystem, update_subsystem_status and reset_subsystem — the knowledge-depth ladder's writers and its one escape hatch. | `7c1c1a9f` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AL-1](../concerns.md#al-1)** | ruled-out | code-verified | 🔗 | Each module's exported tool array is built once at module load from literals and never mutated; handlers construct their responses from SQLite rows per call, so a caller holds no reference into server state. Marked linchpin-dependent because eight modules were read for shape only. |
| **[AT-1](../concerns.md#at-1)** | confirmed-acceptable | code-verified | 🔗 | Atomicity is per-handler and opt-in, and the handlers whose partial state would be visible take it: reset_subsystem wraps five deletes plus the claim cascade in one transaction with the stated reason that an interrupted reset must not leave a scoping-status subsystem carrying later-phase output; add_finding writes the finding and its opening resolution event together. Marked linchpin-dependent because the reading rests on the handlers examined, and eight modules in this subsystem's ledger are classified candidate precisely because their multi-row writes were not read. |
| **[AT-2](../concerns.md#at-2)** | out-of-scope | code-verified |  | The checkpoint-versus-mutation divergence is [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s: it owns the WAL checkpoint and the storage commit. The tools here read that history rather than writing it. |
| **[CC-1](../concerns.md#cc-1)** | out-of-scope | code-verified |  | Nothing in this subsystem is a generated artifact. Its output is rows, computed per call. Generated-artifact drift belongs to [B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md) (the vocabulary) and [B-06](b06-packaging-installer-and-host-activation.md) (the tool inventory). |
| **[CC-2](../concerns.md#cc-2)** | confirmed-acceptable | runtime-observed | 🔗 | The derived counters agreed with the tables throughout this survey wherever both were visible: get_attention's open census of 3 matched the three findings written, its decisions census of 4 matched the four open questions, and describe_locus's per-section censuses matched the rows the store held. This is agreement observed on a small, freshly written store, which is the weakest form of the check — marked linchpin-dependent for that reason. The known historical failure in this area was a whole staleness surface derived from a table nothing wrote, and that specific defect is closed by the move to file_ledger. |
| **[CR-1](../concerns.md#cr-1)** | confirmed-acceptable | code-verified | 🔗 | Cross-process exclusion exists and is advisory by design: acquire_lock and release_lock write and clear active_write_locks rows, and no writer is compelled to take one. Acceptable because SQLite's own write serialization prevents corruption and the surviving risk is a lost update between two read-modify-write handlers, which requires two agents surveying one repository at once. Marked linchpin-dependent, and the residual question — whether the writers that need the lock actually take it — was not established here and is recorded as this subsystem's open item. |
| **[CR-2](../concerns.md#cr-2)** | out-of-scope | code-verified |  | Store creation and its interruption boundaries are entirely [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s. Handlers here touch ctx.db and inherit whatever it returns. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | contract-stated | 🔗 | The one handler here that writes outside SQLite is materialize_docs, and its contract states the asymmetry correctly: clean_publish renders in isolation and promotes only when all three read-back axes are green, and a red run leaves the previous output untouched. Marked linchpin-dependent because that is the tool's stated contract read from its description and the materializer's own code, not a failure this pass induced; the behaviour under a mid-write failure is [B-05](b05-materializer-human-projection-read-back-html.md)'s to establish. |
| **[EP-2](../concerns.md#ep-2)** | confirmed-acceptable | code-verified | 🔗 | A throw inside a handler unwinds through better-sqlite3's transaction wrapper, which rolls back, and out to the dispatcher, which converts it to a structured refusal; nothing here holds a resource across the boundary that a catch would have to release. The one asymmetry that matters is not a leak but an omission: commit_phase_gate is a call an agent makes, so a session that throws before checkpointing leaves work only in the untracked store. That is [B-01](b01-survey-methodology-and-agent-contracts.md)'s obligation and is dispositioned there. Marked linchpin-dependent because eight modules were read for shape only. |
| **[ID-1](../concerns.md#id-1)** | confirmed-bug | code-verified |  | finding_id is caller-supplied, carries no store generation, and is the key an external system references. The Pecia ledger holds 22 live amanuensis:&lt;finding_id&gt; references minted against a store that no longer exists, and dev/pecia-resolve-finding.mjs answers them by opening whatever store is at .amanuensis/memory.db now. Discarding a store therefore makes every reference fail, which is loud and correct; but re-minting an id an old reference names would make it silently succeed against an unrelated finding, and nothing anywhere prevents that. This survey avoided the collision by choosing a distinct id namespace, which is a convention a person followed, not a property the system has. |
| **[ID-2](../concerns.md#id-2)** | confirmed-acceptable | code-verified |  | ref_sha is required on every durable writer here and is resolved through the shared helper at ingress, so the stored value is a 40-character object name that resolved in the bound workspace rather than the string as typed. The helper's own header records that this was retrofitted onto add_evidence, add_finding and set_disposition after describe_locus was found reporting revision_bound true for a sha that resolved nowhere. |
| **[IF-1](../concerns.md#if-1)** | out-of-scope | code-verified |  | The incremental and clean publish paths both live in the materializer; this subsystem passes a flag through to it. The divergence, if any, is [B-05](b05-materializer-human-projection-read-back-html.md)'s. |
| **[IF-2](../concerns.md#if-2)** | confirmed-acceptable | code-verified | 🔗 | Staleness was moved off the never-written entries table onto file_ledger, which the survey always populates, and the columns carry the reason and the since-revision rather than a bare flag. The live reader confirms the denominator survives the move: get_attention reported staleness_measured true with separate claim and ledger counts, and describe_locus reported staleness_measured false on an unledgered path rather than a reassuring zero. Marked linchpin-dependent because agreement between the incremental detector and a full reconciliation was not tested — only that the derivation now has a populated source and a visible denominator. |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | code-verified | 🔗 | Subprocesses here are synchronous and reaped by spawnSync on every exit path; no handler opens a second database handle or holds a temporary directory across a call. The advisory write locks are the one resource with an asymmetric lifetime — acquire_lock writes a row that only release_lock or expiry clears — and the table carries an expiry for exactly that reason. Marked linchpin-dependent: the eight candidate modules include refresh and composition, which manage durable dispatch state, and their release paths were not read. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified | 🔗 | Assessed from **B-03**'s side, same evidence. The handlers that would be visibly broken by a partial write do take a transaction — reset_subsystem wraps five deletes plus the claim cascade, add_finding writes the finding with its opening resolution event — so this party does not rely on the seam for atomicity it needs. Marked linchpin-dependent because eight modules in this subsystem were read for shape only, so the claim is about the handlers examined rather than about all of them; a candidate module writing several tables unwrapped would be an instance of this concern that this pass could not see. |
| **[SC-10](../concerns.md#sc-10)** | confirmed-bug | code-verified |  | Assessed from **B-03**'s side, and the defect is on this side of the seam. This party mints the identifier the reference depends on and gives it no generation, no creation revision, and no uniqueness beyond the primary key within one store — so it cannot distinguish its own finding from a same-named finding in the store it replaced. It also offers no way to record that a finding is inherited from a discarded store, which is the counterpart Pecia's discovered_from would need. This survey avoided the collision by convention, choosing the &lt;SID&gt;-R&lt;n&gt; namespace deliberately; a rebuild that used the documented convention would have re-created B02-1 and B03-1 with different meanings. |
| **[SC-6](../concerns.md#sc-6)** | confirmed-acceptable | code-verified |  | Assessed from **B-03**'s side, same evidence. This party's obligation across the seam is to supply evidence rows that resolve and are honestly kinded, and it discharges it: add_evidence resolves ref_sha at ingress and stores the resolved object name, and the claim writer resolves and ancestry-checks every cited row before inserting. The over-admission is on the reader's side of the seam, not this one — this party wrote exactly the rows it validated. Observed during this survey: two malformed claims were refused with errors naming the kinds found and the file required. |
| **[SC-8](../concerns.md#sc-8)** | confirmed-acceptable | code-verified |  | Assessed from **B-03**'s side. This party's half of the boundary is legible: enforcePhasePrerequisites is one switch listing exactly what it requires at each rung, so what the server enforces can be read in one place, and enforceForwardPrerequisites ensures no rung is skipped by a different writer — the comment records that upsert_subsystem is a status writer too and that a prerequisite one writer honours and another walks around is not enforced. The server's side is therefore enumerable; the prose's side is not, which is why the defect is dispositioned against [B-01](b01-survey-methodology-and-agent-contracts.md). |
| **[SE-1](../concerns.md#se-1)** | confirmed-bug | code-verified |  | A clean-slate rebuild has no supported path for carrying an unresolved finding forward, and the seam that needs one is [S-10](../seams.md#s-10). The skill authorizes "reinit survey" as a destructive operation and the rebuild procedure implements it, but nothing exports, migrates or re-mints an open finding, and nothing tells the external ledger that its referents were discarded rather than resolved. Observed directly: this rebuild left 13 open and 1 fixed-pending-verification findings in an archive file outside the repository, with 22 Pecia records still pointing at ids the store no longer holds. The obligation the seam creates is stated in dev/pecia-dogfood.md and in the resolver's own header; the tooling to discharge it does not exist on either side. |
| **[TB-1](../concerns.md#tb-1)** | confirmed-bug | code-verified | 🔗 | Same class as B02-R1 and B04-R4, at this subsystem's sites: git subprocesses in findings.ts, resolution.ts, git.ts, impact.ts, materialize.ts, refresh.ts, review.ts, review-analysis.ts, review-session.ts, composition.ts and chorusmith-adapter.ts, none with a timeout. Recorded here as one disposition rather than eleven because the cause is one — the shared revision-resolution helper has no bound, and every durable writer pays a subprocess on every call by design. The finding is filed against [B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md), where the helper's fix location is; this disposition records that the concern is live in this subsystem too. Marked linchpin-dependent: read from the absence of an options field, not from an observed hang. |
| **[TR-1](../concerns.md#tr-1)** | confirmed-acceptable | code-verified | 🔗 | The model-authored argument with the most reach here is materialize_docs's output_dir, and it is resolved against project.storagePath and containment-asserted, which is why the tool cannot be pointed at the repository root and why promotion is a separate script. Evidence and disposition file paths go through the shared workspace-path validation, and every subprocess is invoked with an argv array rather than a shell string. Marked linchpin-dependent because eight modules in this subsystem were read for shape only and their argument handling was not audited; the dedicated adversarial-security suite covers this surface and is [B-07](b07-gates-evidence-custody-and-ci.md)'s disposition. |
| **[TR-2](../concerns.md#tr-2)** | confirmed-acceptable | code-verified | 🔗 | Stored prose is written and returned as typed fields on named rows; nothing here interprets it or renders it as markup. The two places it can acquire authority are the reader route ([B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)) and the generated HTML ([B-05](b05-materializer-human-projection-read-back-html.md)), dispositioned there. Marked linchpin-dependent because this rests on the absence of an interpreter rather than on an enforced boundary. |
| **[VR-1](../concerns.md#vr-1)** | out-of-scope | code-verified |  | No version, digest or contract identity is declared in this subsystem. It records the revisions a survey read at, which is [ID-2](../concerns.md#id-2)'s territory and is dispositioned there; the version drift is stated in [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s SERVER_VERSION and in [B-08](b08-records-design-research-published-projection-execution-ledger.md)'s documentation. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-acceptable | code-verified |  | The prerequisites this subsystem enforces all have denominators that cannot be empty by construction: a ledger count, a claim count, an artifact count, a disposition count. Each fired against this survey when its deliverable was missing, which is a denominator demonstrated rather than assumed. The one prerequisite whose denominator is populated but whose outcome is fixed is `mapped`'s challenge requirement, and that is filed against [B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md) rather than here, because the constraint is in the claims module. |

### Survey artifact

#### **B-03** · Knowledge tools and workflow API

**Revision read:** `7c1c1a9` · **Layer:** api · **Priority:** 2

##### Scope

`mcp-server/src/tools/` less the four reader-lens modules — twenty files carried into the
ledger, of which twelve are `examined` and eight are `candidate`: `refresh.ts`,
`review-analysis.ts`, `composition.ts`, `impact.ts`, `contradictions.ts`, `diagnosticity.ts`
were read for shape and interface only, and their recovery and custody contracts were not
exercised. They are marked `candidate` rather than `examined` so no reader takes a structural
claim about them from this pass.

##### Observed structure

**The data model is enforced, not requested.** `set_disposition` requires an evidence anchor,
an evidence-quality tag, a rationale, a revision that resolves in the bound workspace, and a
pass type; `classification`, `evidence_quality` and `pass_type` each go through `requireEnum`
against the generated vocabulary. The methodology's central constraint is a refusal in code.

**The status ladder has four mechanical prerequisites,** one per transition, each naming the
deliverable of the phase being left:

| To | Requires |
|---|---|
| `structural` | a non-empty file ledger **and** ≥1 current claim under `<sid>/` |
| `concerns` | a registered `subsystem-survey` artifact |
| `adversarial` | ≥1 disposition |
| `mapped` | a recorded challenge outcome on **every** current claim |

`enforceForwardPrerequisites` walks every rung between the current status and the target, so a
skipped phase names itself; and a fresh insert opening at a later status is read as an advance
from `unmapped`, because `upsert_subsystem` is a status writer as much as
`update_subsystem_status` is. All four fired during this survey.

**`reset_subsystem` is the only regression path,** and it is transactional. Dispositions,
findings, field notes, xrefs and artifacts always go; the ledger and every claim under the
prefix go only when the target is `scoping` or earlier. Claim matching uses `substr` rather
than `LIKE` because a subsystem id may contain wildcard characters, and historical versions go
with current ones so no chain is left with a hole. Observed: the xref deletion matches
**either** endpoint, so resetting [B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md) also removed the `B-02 → B-04` edge that [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s pass had
recorded.

##### Concurrency

One connection, one handler at a time within a process: the dispatcher awaits each handler and
`better-sqlite3` is synchronous. Atomicity is **per-handler and opt-in** — the handlers that
need it call `db.transaction` themselves; nothing wraps dispatch. Across processes, exclusion
is advisory: `acquire_lock` and `release_lock` write and clear rows in `active_write_locks`,
and nothing compels a writer to take one first.

##### Seam contract offered ([S-10](../seams.md#s-10))

What the Pecia reference resolves against is a finding id and its current resolution state,
and this side guarantees only the second. The chain is append-only and its terminal states
mean what they say: the resolver exits 0 only for `verified-fixed` or `ruled-out`, and
`fixed-pending-verification` deliberately does not resolve, so Pecia inherits the distinction
between claiming a repair and proving one. What this side does **not** guarantee is that a
finding id means the same thing over time: `finding_id` is caller-supplied, carries no store
generation, and a rebuilt store can mint it again for an unrelated finding.

##### Inference, separated from observation

The concurrency reading is an inference from the dispatcher's shape and the synchronous
driver; no concurrent run was performed. The eight `candidate` files carry no structural claim.

##### Open

Whether the advisory lock is actually taken by the writers that need it was not established —
the tools exist and are correct in isolation; their callers were not audited.
