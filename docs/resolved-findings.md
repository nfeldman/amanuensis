# Resolved findings

No finding has reached a terminal state.

- **Scope** — findings recorded verified-fixed, ruled out, or accepted, each with the basis its resolution rests on.
- **Basis** — `finding_state_current` over `findings` and `finding_resolution_events`.
- **Checked revision** — `20839da454b0` on `main`, recorded 2026-09-18 01:53 UTC.

## Carried obligations

_22 inherited obligations carried forward from an earlier store and decided here. The archived record is what the predecessor held; the outcome is what this store did about it._

### B02-1 · 🟠 HIGH · Closed in the archive

<!-- amanuensis:carried:f16f8639586dbc6395bd1a4c692610f5db6bdb9b59760c3716c2bb16c9ec5a52 --><a id="cf-f16f863958"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `verified-fixed`
- **Subsystem there** [B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)
- **Outcome** `archived-terminal`
- **Recorded because** the archive store-legacy-36f2623f4d9afe92 recorded B02-1 as verified-fixed before this store existed; the carry records that state rather than re-deciding it

A phase-gate Git commit can omit the database mutations completed in that phase.

**Root cause, as archived.** SQLite runs in WAL mode, WAL is ignored by storage Git, and commitStorage does not checkpoint the database before staging.

### B02-4 · 🟠 HIGH · Repaired here

<!-- amanuensis:carried:caa954e0396a2beb69604c00d6cffefa199674ea76d4ff6c0cea29d941e8d261 --><a id="cf-caa954e039"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `open`
- **Subsystem there** [B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)
- **Outcome** `repaired` — repaired at `34a8762d0c05`
- **Recorded because** The mechanism B02-4 described is closed at HEAD. The legacy sweep in schema.sql now carries AND NOT EXISTS (SELECT 1 FROM finding_resolution_events e WHERE e.finding_id = findings.finding_id), so a finding that already has any recorded resolution history is skipped and no fresh pending event is appended behind a verification. The comment above the statement states that exact failure — a sweep keyed on findings.status alone would append a newer pending event that finding_resolution_current, which takes the newest event, would then report as unverified — as the reason for the guard. The view still selects MAX(id) per finding; what changed is that the re-open no longer writes a competing row. Repaired at 34a8762; post-repair reading is evidence 10 at c073404.

A finding already promoted to verified-fixed is silently demoted back to fixed-pending-verification: the current-state resolution projection reverts the state, drops the verification evidence link, and substitutes the survey anchor for fix_sha. Four findings were affected in one maintenance run of a downstream project, and audit_resolution_invariants reported zero violations over them.

**Root cause, as archived.** Confirmed. schema.sql's one-time legacy backfill (schema.sql:834-851) is re-executed on every database open, because initializeSchema runs the entire schema file each time (db.ts:47-53). Any finding that reached findings.status='fixed' since the last open — which includes findings already verified, since verify_finding_fix leaves that column at 'fixed' — gets a fresh 'legacy-fixed:<id>' event whose recorded_at is the older findings.updated_at, whose fix_sha is COALESCE(findings.ref_sha, ...) (the survey anchor) and whose evidence_id is NULL. finding_resolution_current picks the MAX(id) event per finding rather than the latest recorded_at (schema.sql:852-862), so that backfill row outranks the real verification. audit_resolution_invariants reads through the same view (resolution.ts:30-72) and only demands proof of rows that still read verified-fixed, so the regression is invisible to it.

### B03-1 · 🟠 HIGH · Closed in the archive

<!-- amanuensis:carried:fdab8b4f7248c5d90dcadda005337fff32e223790bec775e934dde11a27aa725 --><a id="cf-fdab8b4f72"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `verified-fixed`
- **Subsystem there** [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)
- **Outcome** `archived-terminal`
- **Recorded because** the archive store-legacy-36f2623f4d9afe92 recorded B03-1 as verified-fixed before this store existed; the carry records that state rather than re-deciding it

A subsystem can report status 'mapped' with zero stale entries while an arbitrary fraction of its declared scope has never been classified, and while ledger rows continue to assert that deleted files were examined.

**Root cause, as archived.** The refresh path never reconciles the file ledger against the working tree. detect_changes inner-joins the commit-range diff against file_ledger, so paths added since the baseline match no row and are silently dropped; no ledger writer enumerates the tree; the scoping-to-structural invariant checks only that at least one ledger row exists; and no classification value or non-destructive tool can retire a row whose file was deleted.

### B03-2 · 🟠 HIGH · Closed in the archive

<!-- amanuensis:carried:e2e3e1468ed93d2f5a3ad77447037e5b391a8a4c1853309d618a3fa9ef2abf70 --><a id="cf-e2e3e1468e"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `verified-fixed`
- **Subsystem there** [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)
- **Outcome** `archived-terminal`
- **Recorded because** the archive store-legacy-36f2623f4d9afe92 recorded B03-2 as verified-fixed before this store existed; the carry records that state rather than re-deciding it

The entire staleness surface is inert. detect_changes reports drift to its caller but persists none of it, get_stale_backlog always returns empty, clear_staleness has nothing to clear, and the dashboard's stale_entries is permanently 0 regardless of how far the conspectus has drifted from HEAD.

**Root cause, as archived.** All staleness state lives in the entries table, and no server code path ever inserts a row into it. The only INSERT INTO entries in the repository is in materializer/test-readback.py, a test fixture. Every read and update of staleness therefore operates on a permanently empty table.

### B03-5 · 🟠 HIGH · Re-found here

<!-- amanuensis:carried:b1af4f3aeadab94b1d0ed41ee28177dc1cfe69e72705c18d9b0e2d91d3fb555d --><a id="cf-b1af4f3aea"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `open`
- **Subsystem there** [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)
- **Outcome** `successor-finding` — [B03-R1](findings.md#b03-r1)
- **Recorded because** Re-found at c073404. get_dashboard still has no examined count and enforcePhasePrerequisites still gates structural on one ledger row. The lane's own GATE D0 B2 measures the fraction from outside the store, which is why this rebuild can be held to it — but the store's reader surface still cannot answer the question, which is what B03-5 was about.

A subsystem can report status 'mapped' with zero unledgered paths, zero absent files and zero stale entries while most of its scoped files have never been examined. At 61bc6b5 the dashboard reports 8 of 8 subsystems mapped and 0 unclassified paths while 158 of 371 obligation-bearing ledger rows (43%) are still classification 'candidate' with examined_at NULL.

**Root cause, as archived.** The B03-1 repair reconciles the ledger against the working tree, but nothing measures examination within the ledger. get_dashboard counts subsystems, mapped subsystems, staleness split by obligation, total scoped_files and scope_gaps, but has no field counting rows that reached classification 'examined'; scoped_files is a raw total mixing examined, candidate and exempt rows. The status machine does not close the gap either: enforcePhasePrerequisites gates the scoping-to-structural transition on COUNT(*) >= 1 in file_ledger, so a single classified row authorizes advancing a subsystem whose remaining scope is untouched, and no later gate revisits it. Staleness cannot surface it because a candidate row carries a ref_sha and drifts only when its content changes, which says nothing about whether it was ever read.

### B04-2 · 🟠 HIGH · Repaired here

<!-- amanuensis:carried:9cb0425945934a63e870483b71f3b765c66b5f62c072a5149986d568bc03f149 --><a id="cf-9cb0425945"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `open`
- **Subsystem there** [B-04](subsystems/b04-diff-aware-materializer.md)
- **Outcome** `repaired` — repaired at `3f8b7f39ee85`
- **Recorded because** B04-2 said the HTML shell's freshness badge was derived from a permanently-zero count over the never-written `entries` table, so only the healthy branch was reachable and it rendered on every page. At c073404 core.py:352 builds that context from renderers.ledger_freshness, which counts stale rows over file_ledger with the generated obligation predicate and names B03-2 in its own docstring as the reason entries is not consulted; staleness_measured comes from scoped_files &gt; 0, so an empty ledger renders as unmeasured rather than as healthy. Repaired at 3f8b7f3; post-repair reading is evidence 28.

Every page of the published HTML conspectus displays the freshness badge "No recorded stale entries", styled as healthy, regardless of how far the survey has drifted. At 61bc6b5 all 23 published pages carry that badge and none carry the stale variant, while the conspectus behind them holds 86 stale ledger rows.

**Root cause, as archived.** The B04-1 repair migrated one staleness reader and missed another. diagrams.py:staleness_map was moved onto file_ledger with the obligation-bearing predicate, but core.py still builds the HTML projection context with stale_entry_count from "SELECT COUNT(*) AS n FROM entries WHERE stale=1". entries is the table B03-2 established no server code path ever writes; the only INSERT INTO entries in the repository is a fixture in test-readback.py. html_projection.py:_shell then derives source_aligned = bool(checked and stale_count == 0) from that permanently-zero value, so the healthy branch is the only reachable one, and because the badge lives in the shared shell it renders on every page rather than on the single page that carried the B04-1 diagram.

### B04-3 · 🟠 HIGH · Re-found here

<!-- amanuensis:carried:c0b97330d1ccc451320b210a85765740c590c929871d2c8e041d9c755901e003 --><a id="cf-c0b97330d1"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `open`
- **Subsystem there** [B-04](subsystems/b04-diff-aware-materializer.md)
- **Outcome** `successor-finding` — [B04-R1](findings.md#b04-r1)
- **Recorded because** Re-found at c073404 and narrowed. readback.py:687 still draws its per-row stale-marker expectations from `entries`, and renderers.py:696 still reads it for the index; the ledger-derived _ledger_stale_census added since covers the aggregate case but not the marker-level one, so the unreachable arm survives beside a live check.

The projection read-back gate can never turn red on a stale-marker fault for any real conspectus. Its staleness axis expects one marker per row of a table that production never writes, so the expectation set is always empty and a projection that silently drops every stale marker still passes the state axis.

**Root cause, as archived.** readback.py loads its expected stale markers with "SELECT id, tier FROM entries WHERE stale=1", and no server code path inserts into entries — staleness lives on file_ledger (finding B03-2). The per-row loop therefore never executes in production. The condition is masked by the test suite: test-readback.py:seed hand-inserts a stale row into entries, which is the only INSERT INTO entries in the repository, and the case commented "VP4 red arm 3" deletes the resulting marker and asserts the axis turns red. That assertion passes on fixture-seeded state while the same arm is unreachable on any conspectus the product actually produces. renderers.py:91 reads the same dead table for the index page's "Stale entries" row and for the stale markers it emits, so the markers being verified and the expectations verifying them are consistently derived from an empty source.

### B05-1 · 🟠 HIGH · Closed in the archive

<!-- amanuensis:carried:8d5c890a647283714b2823da3103ced32a7ffde7676bf48804c846a374d574c5 --><a id="cf-8d5c890a64"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `verified-fixed`
- **Subsystem there** [B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)
- **Outcome** `archived-terminal`
- **Recorded because** the archive store-legacy-36f2623f4d9afe92 recorded B05-1 as verified-fixed before this store existed; the carry records that state rather than re-deciding it

The roadmap and the A26 receipt both assert v0.2.0-beta.1 is an unpublished candidate, while the package is published on npm holding the latest dist-tag. The publication gate cannot detect the discrepancy because nothing checks the registry or the tag.

**Root cause, as archived.** render-roadmap.mjs validates delivery.release only for internal consistency — field shapes, and agreement between roadmap.json and the A26 receipt. It never queries the registry, the git tag, or the publish workflow run. A release that has actually been published therefore satisfies every candidate assertion, including publicationStatus 'not-published', indefinitely.

### B02-2 · 🟡 MEDIUM · Repaired here

<!-- amanuensis:carried:7c6226f6ac273cde1d62add85eef2c4f4399380c255a3b678f544785c3a1c3b6 --><a id="cf-7c6226f6ac"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `fixed-pending-verification`
- **Subsystem there** [B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)
- **Outcome** `repaired` — repaired at `56940800af7a`
- **Recorded because** Both sites B02-2 named are bounded at HEAD. codex-host.ts declares STARTUP_PROBE_TIMEOUT_MS (5s) and passes it with killSignal SIGKILL to the ps probe; project.ts imports the same constant and applies it to its git invocations, including safeGitOrigin. The repair landed at 5694080 ("Restore the B02-2 repair that merging main would have stripped") and the post-repair reading is evidence 9, taken at c073404. Note what this does not cover and B02-3 does: index.ts's own gitRoot is still unbounded, which is why that carried record is decided separately.

A stalled ps or git subprocess during server startup hangs the MCP server indefinitely with no timeout, no diagnosis, and no usable state.

**Root cause, as archived.** Every subprocess on the startup and project-binding path is synchronous and unbounded: discoverCodexParentWorkspace runs ps via execFileSync, and project binding runs six git invocations via execSync, execFileSync, and spawnSync. None passes a timeout option, and execFileSync blocks the Node event loop for the call's full duration. The error handler in codex-host.ts returns null only for errors carrying an errno code, so a hang — which raises nothing — is not covered.

### B02-3 · 🟡 MEDIUM · Re-found here

<!-- amanuensis:carried:0f725e9be1c6783555dc447345e45ebb037e98efb19529b30ed991de5ce06b24 --><a id="cf-0f725e9be1"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `open`
- **Subsystem there** [B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)
- **Outcome** `successor-finding` — [B02-R2](findings.md#b02-r2)
- **Recorded because** Re-found unchanged. index.ts:gitRoot still calls execFileSync with no timeout and no killSignal, index.ts still does not import STARTUP_PROBE_TIMEOUT_MS, and gitRoot still runs up to four times before the transport connects. Filed here as B02-R2 under this rebuild's own id convention so the obligation is a live finding of this store rather than only an inherited one.

A stalled git subprocess during server startup still hangs the MCP server indefinitely with no timeout and no diagnosis, despite the B02-2 repair. The remaining unbounded probe runs on every start that selects its workspace from the environment — the registration Claude Code uses.

**Root cause, as archived.** The B02-2 repair bounded two modules but missed a third on the same path. codex-host.ts declares STARTUP_PROBE_TIMEOUT_MS and project.ts imports it for all six of its git invocations, but index.ts imports execFileSync directly, never imports the constant, and its gitRoot helper (lines 90-101) passes cwd, encoding and stdio with no timeout and no killSignal. gitRoot is called four times before the transport connects: twice from assertWorkspaceMatchesLaunch (lines 110, 111) and twice from parseArgs (lines 156, 162), and parseArgs is the first statement of main().

### B03-3 · 🟡 MEDIUM · Closed in the archive

<!-- amanuensis:carried:bd28e34009b4d83bbde233cce683421ce82a3db892bf8f90d03e5287229d25da --><a id="cf-bd28e34009"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `verified-fixed`
- **Subsystem there** [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)
- **Outcome** `archived-terminal`
- **Recorded because** the archive store-legacy-36f2623f4d9afe92 recorded B03-3 as verified-fixed before this store existed; the carry records that state rather than re-deciding it

A disposition whose strongest supporting evidence is test-observed, config-asserted, or doc-asserted cannot record that quality; set_disposition rejects the value, forcing the agent to overstate it as code-verified or understate it as contract-stated.

**Root cause, as archived.** The EVIDENCE_QUALITY enum in tools/dispositions.ts lists five values while the KINDS enum in tools/evidence.ts lists nine, and the [B-01](subsystems/b01-survey-methodology-and-agent-contracts.md) methodology contract publishes an eight-rung ladder as the authoritative evidence-quality scale. The two vocabularies were allowed to diverge, and nothing checks them against each other or against the published contract.

### B03-6 · 🟡 MEDIUM · Re-found here

<!-- amanuensis:carried:80d83d81677c47c45ceecb9cdb2560b1452fc4706ec37af08e6c325198f5db3e --><a id="cf-80d83d8167"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `open`
- **Subsystem there** [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)
- **Outcome** `successor-finding` — [B03-R2](findings.md#b03-r2)
- **Recorded because** Re-found unchanged at c073404: verify_finding_fix still resolves both revisions and compares ancestry without inspecting either tree, so a fix_sha at which the repair does not exist is still accepted.

A finding can be promoted to verified-fixed while its recorded fix_sha names a commit at which the repair does not exist. The resolution record then misattributes the repair to the wrong commit, and nothing in the custody chain detects it. Two of the findings resolved on this repository are in that state.

**Root cause, as archived.** verify_finding_fix enforces ancestry between two commits but never inspects the tree at either. It resolves current.fix_sha and the evidence ref_sha, then calls requireAncestor, which accepts when git merge-base --is-ancestor fixSha evidenceSha exits 0. That proves the evidence was collected at or after the claimed fix, which is the weaker of the two properties the tool's description implies; the stronger one, that the repair is present at fix_sha, is never tested. Because fix_sha is supplied by the caller at update_finding_status time and only validated by resolveCommit for existence, any ancestor of the evidence commit is accepted, and the further back it is the more likely it is to pass.

### B03-7 · 🟡 MEDIUM · Re-found here

<!-- amanuensis:carried:4c12d2eb2fd64cfd6a29e0ee3101675b1ae28777d756748cbf936419eeb9de90 --><a id="cf-4c12d2eb2f"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `open`
- **Subsystem there** [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)
- **Outcome** `successor-finding` — [B03-R3](findings.md#b03-r3)
- **Recorded because** Re-found at c073404: evidence coordinates are still insert-only with no re-anchor operation, and clear_staleness still rewrites only the ledger row, so the refresh route still has two actions where it needs three.

When a file's content moves but every claim written against it still holds, the conspectus has no action that records the move: the refresh route can clear the file's staleness row or re-decide the claim, and nothing in between. Downstream, every re-checked fact held while every cited line number had moved, and one cited range now holds unrelated prose — a citation that lands on a different claim in the same document reads as correct and makes the conspectus look wrong when it is right.

**Root cause, as archived.** Confirmed as an absence in the tool surface. Evidence rows are insert-only: add_evidence (evidence.ts:36-71) is the only writer of the evidence table, and no tool updates a row's line_range — the only UPDATE statements in that module target the join tables' role column (evidence.ts:104, 137). clear_staleness (stale.ts:46-92) makes its freshness assertion per file, rewriting file_ledger alone, and never touches the citations anchored to that file. Because the substrate has no re-anchor operation, the documented route has only the two actions it lists (refresh.md:63-88), and a file cleared after a faithful re-read keeps citations pointing at lines that have moved.

### B03-8 · 🟡 MEDIUM · Re-found here

<!-- amanuensis:carried:79c2dbdbe4d90c3fc956675c277327c0479b31e002153319a66b696a95ba733f --><a id="cf-79c2dbdbe4"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `open`
- **Subsystem there** [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)
- **Outcome** `successor-finding` — [B03-R4](findings.md#b03-r4)
- **Recorded because** Re-found unchanged at c073404: update_finding_status is still the only UPDATE against findings and still writes status and fix_location only, so severity remains unwritable after insert.

A finding's severity cannot be amended after it is filed. In the downstream W-06 survey an adversarial-phase downgrade could only be written into the finding's resolution note, its disposition and the survey artifact, while the findings.severity column kept the original grade — leaving the published index and the store's own column disagreeing about the same finding.

**Root cause, as archived.** Confirmed. add_finding performs a plain INSERT and, on primary-key conflict, returns 'use update_finding_status to change it' (findings.ts:126-168); update_finding_status writes only status and fix_location (findings.ts:238-241), and that statement is the only UPDATE against the findings table in the server. No tool writes severity after insert, so an adversarial pass that re-grades a finding — the pass whose explicit job is to overturn or restrict Phase 3 conclusions — cannot record the re-grade in the field every downstream projection sorts and filters on.

### B04-1 · 🟡 MEDIUM · Closed in the archive

<!-- amanuensis:carried:d3261648bdeaec257ae5d1093de8af4c2fce363c59460186c573dc24e5609728 --><a id="cf-d3261648bd"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `verified-fixed`
- **Subsystem there** [B-04](subsystems/b04-diff-aware-materializer.md)
- **Outcome** `archived-terminal`
- **Recorded because** the archive store-legacy-36f2623f4d9afe92 recorded B04-1 as verified-fixed before this store existed; the carry records that state rather than re-deciding it

The published conspectus states 'No stale entries — the conspectus is fresh.' in both the HTML reading surface and its Markdown companion, regardless of how far behind HEAD the survey actually is.

**Root cause, as archived.** diagrams.py:staleness_map renders an empty query result as an affirmative freshness claim. Its source, the entries table, is never populated by the server (see B03-2), so the empty branch is the only branch that ever executes — but the deeper defect is that the empty case is reported as positive health rather than as absent data.

### B04-4 · 🟡 MEDIUM · Repaired here

<!-- amanuensis:carried:d01a46890ee11ccf809929dc874c159728e091a7e7771054ef321c0e38b33eef --><a id="cf-d01a46890e"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `open`
- **Subsystem there** [B-04](subsystems/b04-diff-aware-materializer.md)
- **Outcome** `repaired` — repaired at `3f8b7f39ee85`
- **Recorded because** B04-4 said the reader's guide was a static string carrying a sixth hand-maintained copy of the evidence-quality ladder and a second copy of the knowledge-depth table. At c073404 the guide is generated: render_how_to_read takes the connection, the storage and the page plan's route table, and the ladder it renders comes from values_of("evidence_quality") over the generated vocabulary module, so a widened enum reaches the page the same way it reaches the server. The route table is derived from the plan rather than hand-written, so a page added cannot be left out of the guide. Repaired at 3f8b7f3; post-repair reading is evidence 31, taken over the same generated-projection discipline in diagrams.py.

The published "How to read this conspectus" page teaches a superseded version of the two contracts it exists to explain. Its evidence-quality table defines five of the nine recorded evidence kinds, and its knowledge-depth table states the un-hedged claims for adversarial and mapped that the methodology deliberately weakened. A reader meeting a test-observed or runtime-observed finding finds no entry for it in the guide.

**Root cause, as archived.** HOW_TO_READ_BODY in renderers.py is a static string, declared to the manifest as synthetic:how-to-read so it re-renders only when the renderer itself changes. It therefore holds a sixth, hand-maintained copy of the evidence vocabulary — alongside evidence.ts KINDS, dispositions.ts EVIDENCE_QUALITY, review-analysis.ts EVIDENCE_KINDS, the schema.sql CHECK, and the SKILL.md ladder — and a second copy of the knowledge-depth table that SKILL.md and artifact-templates.md also carry. Nothing relates any of these to each other. When B03-3 widened the enums from five values to nine and when [B-01](subsystems/b01-survey-methodology-and-agent-contracts.md) hedged the adversarial and mapped rows, both changes were applied to the sources that had failing call sites and not to the static page that only humans read.

### B04-5 · 🟡 MEDIUM · Re-found here

<!-- amanuensis:carried:6342a9daf1152bdbe585710e22135199a8048977179c692c3a722f0e9c7c87a6 --><a id="cf-6342a9daf1"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `open`
- **Subsystem there** [B-04](subsystems/b04-diff-aware-materializer.md)
- **Outcome** `successor-finding` — [B04-R2](findings.md#b04-r2)
- **Recorded because** Carried forward as an open finding of this store rather than closed. The length-dependent dangling-anchor behaviour is a real recorded observation whose mechanism the archive could not locate, and it cannot be located here either: reproducing it needs the downstream store's rows, which this repository does not hold. Ruling it out would require evidence that the behaviour does not obtain, and no such reading exists, so the honest outcome is a live obligation with the next step named.

Publishing the conspectus went red on the read-back's coverage axis with seven dangling anchors and promoted nothing, for a positional reason rather than a real coverage gap: every dropped anchor sorted after one of the run's newly added dispositions, the surviving rows differing only in length (330-900 characters against 2,000-3,500 for the new ones). Shortening the five long rationales to about 1,000 characters returned all seven anchors and the second publish was green on all three axes.

**Root cause, as archived.** Not confirmed; recorded as an open question. What is established at HEAD is the failing check and the anchors' shape: the coverage axis fails a publish when a recorded local link's fragment does not resolve to an anchor on the target page (readback.py:255-275), and every record anchor is emitted as raw HTML inside a single-line Markdown table row into which record prose is interpolated with only '|' escaped (renderers.py:361-371, 484, 505, 536). Two candidate mechanisms were tested against HEAD this session and did not reproduce — the read-back's anchor inventory feeding HTMLParser without close() (readback.py:44-79), and a table row broken by a newline inside a long cell — so the length-dependence is real but its mechanism is not located. Reproducing it needs the downstream store's rows, which are not in this repository.

### B05-2 · 🟡 MEDIUM · Re-found here

<!-- amanuensis:carried:9311d53ac37c52316bc9f8318af900ef31221604291066e21f4fb353f1ab6bd0 --><a id="cf-9311d53ac3"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `open`
- **Subsystem there** [B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)
- **Outcome** `successor-finding` — [B05-R1](findings.md#b05-r1)
- **Recorded because** Re-found at c073404 with the divergence now directly observable rather than inferred: index.ts:28 reads 0.2.0-beta.1 and mcp-server/package.json reads 0.2.0-beta.2. Neither the roadmap release check nor the published-tarball smoke job relates the two.

The published 0.2.0-beta.2 package identifies itself to every MCP host as 0.2.0-beta.1, and stamps that wrong version into the immutable binding receipt the setup documentation tells users to read back when verifying an installation.

**Root cause, as archived.** SERVER_VERSION is a hardcoded string literal in index.ts that was not advanced when the package version was. It is the only source for both the MCP Server version advertised during initialize and the serverVersion field frozen into the ProjectBindingReceipt, and nothing derives it from or checks it against mcp-server/package.json. The release gate does not cover it either: render-roadmap.mjs asserts that delivery.release package and version match the package manifest, but no check relates the manifest to the runtime literal, and published-smoke.yml installs the real tarball and asserts binding_receipt.canonicalRoot and storage_path while never asserting the reported version.

### B08-1 · 🟡 MEDIUM · Closed in the archive

<!-- amanuensis:carried:16f42ad83a516431c30ca9d366da5b8984baaae5d2d4225b90bfca7154bd1a89 --><a id="cf-16f42ad83a"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `verified-fixed`
- **Subsystem there** [B-08](subsystems/b08-activation-evidence-and-release-readiness.md)
- **Outcome** `archived-terminal`
- **Recorded because** the archive store-legacy-36f2623f4d9afe92 recorded B08-1 as verified-fixed before this store existed; the carry records that state rather than re-deciding it

Release readiness depends on the byte state of the user's live ~/.codex/config.toml. Once that file changes for any reason, the A22 checker reports drift permanently, the A26 candidate suite fails, and no release can be cut until another real-host A22 campaign rebaselines the pin.

**Root cause, as archived.** The A22 receipt records host.configSha256Before/After and configurationCustody.restoredConfigSha256 for the developer's own Codex configuration, and check-codex-host-evidence compares the live file against them. That file is user-level and mutable independently of this repository, so the pin is a snapshot of something the project does not own and cannot hold still. dev/refresh-a22-evidence.mjs rebaselines the fourteen source digests but not the config pin, leaving no cheap recovery.

### B01-1 · 🔵 LOW · Repaired here

<!-- amanuensis:carried:ba0149948a7198d72a23a1ed7d2ef5e18a555cd6c46e4a64e8b01086ed099bcf --><a id="cf-ba0149948a"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `open`
- **Subsystem there** [B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)
- **Outcome** `repaired` — repaired at `1d6516aee47f`
- **Recorded because** B01-1 said the claims surface and the survey route were disjoint: add_claim was the only writer of the claims table and no file under .claude/skills/amanuensis/ mentioned it. At c073404 phase-2-structural.md step 7 is a named step of the structural phase carrying the claim_key grammar, the file-anchored evidence rule and the explicit-negative form; phase-4-adversarial.md pulls every current &lt;sid&gt;/ claim as a target and names the three claim outcomes; and onboarding.md quotes the server's refusal for a missing claim_key. The advance to structural now refuses a pass that recorded none, so a zero claim count is no longer reachable through the documented route. Repaired at 1d6516a; post-repair reading is evidence 24 at c073404.

A subsystem surveyed exactly as the route documents reports zero claims. The downstream W-06 survey completed all five phases with 36 dispositions and 89 evidence rows and still recorded 'Claims: 0', and had to state the zero in its report so it would not be read as missing work.

**Root cause, as archived.** Confirmed as an absence in the route. add_claim (claims.ts:225) is the only tool that writes the claims table (claims.ts:179), and no file under .claude/skills/amanuensis/ mentions it: the concern pass instructs add_evidence, set_disposition and add_finding and nothing else (phase-3-concerns.md:38-140). The claims surface and the survey route are therefore disjoint, and any reader who treats a claim count as a coverage or completeness measure reads a zero that means only 'this route does not write here'.

### B03-4 · 🔵 LOW · Closed in the archive

<!-- amanuensis:carried:ddbfe09307a0822ef48aaacb187c9f06172d4c0b6e9e113fbf046fb073bdc828 --><a id="cf-ddbfe09307"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `verified-fixed`
- **Subsystem there** [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)
- **Outcome** `archived-terminal`
- **Recorded because** the archive store-legacy-36f2623f4d9afe92 recorded B03-4 as verified-fixed before this store existed; the carry records that state rather than re-deciding it

A scoped file whose content is identical to what was examined can be reported stale indefinitely, because staleness is decided by whether its path appeared in a commit range rather than by whether its content changed.

**Root cause, as archived.** The drift predicate in detect_changes tests path membership in the lastSha..currentSha diff and only null-checks the row's ref_sha, never comparing content at that commit against the current one. Nothing clears stale except an explicit clear_staleness, so a path touched and reverted — or touched on a branch later deleted — remains flagged against unchanged content.

### B07-1 · 🔵 LOW · Re-found here

<!-- amanuensis:carried:eab80c61d4ebd5bd1800dd0882fcf53c91eaaf42ffbe732ed714c5555d9bb604 --><a id="cf-eab80c61d4"></a>

- **Carried from** `store-legacy-36f2623f4d9afe92` at `61bc6b5c89f7`, recorded there as `open`
- **Subsystem there** [B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md)
- **Outcome** `successor-finding` — [B07-R1](findings.md#b07-r1)
- **Recorded because** Re-found unchanged at c073404: all three sites named in the archived record still reach the network or a child process with no timeout, no AbortSignal and no cancellation path.

A research refresh or snapshot verification can hang indefinitely when GitHub, npm, the shadcn CLI, or a child detector stalls.

**Root cause, as archived.** The affected fetch(), spawnSync(), and subprocess.check_output() calls provide no timeout, abort signal, or cancellation path.

