# **B-03** — Knowledge tools and workflow API

**Status**: 🟡 adversarial  
**Layer**: Runtime

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server/src/tools/** — the tool surface a survey writes and reads through

## Start here

src/tools/evidence.ts; src/tools/dispositions.ts; src/tools/git.ts; src/tools/carried.ts

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/state-container/eight-unshared-git-probes` | `mcp-server/src/tools/xrefs.ts:resolvesInWorkspace` | Revision resolution is implemented eight times across this tool surface rather than once. xrefs.ts names itself the eighth copy and records that they are deliberately unshared because each owns a different failure policy. The consequence the comment does not name is that a property added to one — such as the wall-clock bound B02-R1 and B02-R2 ask for — has to be added to all eight, and nothing in the build compares them. | Inference | `c0734040022f` |

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/atomicity/every-durable-write-is-one-transaction` | `B-03` | Every tool in this surface that writes more than one row writes them inside one ctx.db.transaction, so the invariant the pair expresses cannot be observed half-true. set_disposition writes the disposition and its attachments together; detect_changes writes the staleness marks, the scope_gaps rewrite, the git_state update and the append-only reconciliation row together; carry_finding writes the carried record and its archived-terminal pre-record together; add_finding writes the finding and its opening resolution event together. | Observation | `c0734040022f` |
| `B-03/trust/a-worker-report-is-never-the-verdict` | `B-03` | Wherever this surface accepts a report from something it did not run, the report is landed and then scored by a separate call that re-reads durable state rather than believing the label. score_composition_item re-resolves the commit, re-reads the artifact registry's content hash, and requires a terminal review aggregation; score_integral_verification compares the reported checkout HEAD and tree against the manifest and requires zero dirty paths; record_carried_outcome requires a post-repair reading whose revision is a descendant of, or equal to, the claimed repair. | Inference | `c0734040022f` |

## Vocabulary

- **verification object** — What a composition item was verified *over* — either one unit subject at its own target commit, or the whole assembled HEAD in a clean worktree — recorded on the item so a unit pass can never be read as an integral one.
- **wire budget** — The 8192-byte ceiling a list tool's response must fit, measured on the doubled envelope — the indented text block plus the structuredContent that repeats it — not on the payload.

## Known defects here

4 defects here are open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- A subsystem can report status 'mapped' with zero unledgered paths, zero absent files and zero stale entries while most of its scoped files have never been examined. Nothing in the server measures examination within the ledger, so the store's own census cannot distinguish a subsystem that was read from one that was inventoried. — [B03-R1](../findings.md#b03-r1) · 🟠 HIGH · Open
- A finding can be promoted to verified-fixed while its recorded fix_sha names a commit at which the repair does not exist, so the resolution record misattributes the repair to the wrong commit and nothing in the custody chain detects it. — [B03-R2](../findings.md#b03-r2) · 🟡 MEDIUM · Open
- When a file's content moves but every claim written against it still holds, the conspectus has no action that records the move. A citation whose line range has shifted keeps pointing at lines that now hold something else, and a range that lands on unrelated prose in the same document reads as correct — it makes the conspectus look wrong where it is right. — [B03-R3](../findings.md#b03-r3) · 🟡 MEDIUM · Open
- A finding's severity cannot be amended after it is filed, so an adversarial pass that re-grades one can record the re-grade in a resolution note, a disposition and the survey artifact while the findings.severity column keeps the original grade — leaving the published index and the store's own column disagreeing about the same finding. — [B03-R4](../findings.md#b03-r4) · 🟡 MEDIUM · Open

## Standing

**Adversarial** — Candidate conclusions are being challenged; treat them as provisional. It cannot justify that the challenge pass has finished.

| Metric | Value |
|---|---|
| Files read | 43 of 43 ledger rows |
| Files in scope, not yet read | 0 of 43 |
| Files excluded from the survey obligation | 0 of 43 |
| Ledger rows the repository has changed under | 0 of 43 |
| Active concerns with a disposition recorded here | 12 of 12 — 1 confirmed-bug, 9 confirmed-acceptable, 2 out-of-scope |
| Findings by resolution state | 4 open |
| Seams assessable from both sides | no seam names this subsystem |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-52ddba3d3b"></a>`mcp-server/src/tools/artifacts.ts` | examined | register_artifact's lexical and realpath containment checks on the storage-relative path, and the content hash the materializer's diff reads. | `c0734040` |
| <a id="le-8635244b2d"></a>`mcp-server/src/tools/carried.ts` | examined | The carry's five writes and two reads, the archived-terminal pre-record, the three outcome authority rules, and the 8192-byte wire budget list_carried_findings measures on the doubled envelope. | `c0734040` |
| <a id="le-8a6e1799d4"></a>`mcp-server/src/tools/chorusmith-adapter.ts` | examined | The knowledge tools and the workflow API the survey writes through. | `410d769b` |
| <a id="le-8374f2c77c"></a>`mcp-server/src/tools/claims.ts` | examined | Claim custody: the file-anchored evidence rule enforced in insertClaim for both doors, the challenge-outcome vocabulary and its 24-character floor, invalidation and supersession. | `c0734040` |
| <a id="le-e764a016a5"></a>`mcp-server/src/tools/codebase-brief.ts` | examined | The immutable brief source and its mode projections, with deterministic selection and zero model calls. | `c0734040` |
| <a id="le-b9de4cef8b"></a>`mcp-server/src/tools/compare.ts` | examined | Structural diff of two stores opened read-only, with signature-based finding overlap and Kendall tau over shared priorities. | `c0734040` |
| <a id="le-65e66fcabf"></a>`mcp-server/src/tools/composition.ts` | examined | The fan-in manifest: expected items scored independently of the worker's own success label, the integral lane gated on exact unit fan-in, and reconciliation that is red on any missing work. | `c0734040` |
| <a id="le-d6880bf731"></a>`mcp-server/src/tools/concerns.ts` | examined | The calibrated checklist's writers; retire_concern records a final state rather than deleting, so historical dispositions stay readable. | `c0734040` |
| <a id="le-140b6f3d29"></a>`mcp-server/src/tools/contradictions.ts` | examined | resolve_contradiction requires evidence from the active session attached to one of the two findings, and appends the resolution event in the same transaction. | `c0734040` |
| <a id="le-4e74e78132"></a>`mcp-server/src/tools/crosswalk.ts` | examined | The knowledge tools and the workflow API the survey writes through. | `410d769b` |
| <a id="le-bc82b199a5"></a>`mcp-server/src/tools/dashboard.ts` | examined | get_dashboard's single-round-trip census, and staleness_measured carrying the denominator so an empty ledger cannot read as a fresh conspectus. | `c0734040` |
| <a id="le-1512fd6020"></a>`mcp-server/src/tools/decisions.ts` | examined | Decision custody: immutable revisions, explicit human or owning-system acceptance authority, and the projection read-back on three axes. | `c0734040` |
| <a id="le-b85c143ab2"></a>`mcp-server/src/tools/design-session.ts` | examined | The knowledge tools and the workflow API the survey writes through. | `410d769b` |
| <a id="le-0e49fbf332"></a>`mcp-server/src/tools/diagnosticity.ts` | examined | The ACH matrix: concerns and evidence enrolled first, one verdict per cell, and resolved requiring a leading concern that is in the matrix. | `c0734040` |
| <a id="le-cee13c0a54"></a>`mcp-server/src/tools/dispatch.ts` | examined | The sub-agent dispatch log. | `c0734040` |
| <a id="le-23127afcd5"></a>`mcp-server/src/tools/dispositions.ts` | examined | set_disposition's ordered refusals: depth, concern existence, revision resolution, evidence_ids, batched reachability, the quality ceiling, then one transaction for the row and its attachments. | `c0734040` |
| <a id="le-2412897637"></a>`mcp-server/src/tools/evaluation.ts` | examined | The knowledge tools and the workflow API the survey writes through. | `410d769b` |
| <a id="le-ed6472d9a0"></a>`mcp-server/src/tools/evidence.ts` | examined | add_evidence resolves ref_sha at ingress and stores it resolved; the two attach tools carry the role vocabularies the resolution rules read. | `c0734040` |
| <a id="le-4020309e5e"></a>`mcp-server/src/tools/field-notes.ts` | examined | Field notes and their follow_up resolution, which the review session reads as unverified suspicions. | `c0734040` |
| <a id="le-566054a018"></a>`mcp-server/src/tools/files.ts` | examined | The ledger writers: add_files_to_scope's validated batch upsert inside one transaction, and update_file_classification. | `c0734040` |
| <a id="le-44c699c32a"></a>`mcp-server/src/tools/findings.ts` | examined | add_finding's opening resolution event, update_finding_status's overturn-evidence rule, and verify_finding_fix's ancestry requirement between repair and verification. | `c0734040` |
| <a id="le-17468c4b96"></a>`mcp-server/src/tools/git.ts` | examined | detect_changes: the whole reconciliation — tree at the resolved revision, unledgered/absent/exempt, duplicate ownership, staleness re-derived both ways, scope_gaps rebuilt, and one append-only scope_reconciliations row with both digests. | `c0734040` |
| <a id="le-b57fab0c08"></a>`mcp-server/src/tools/impact.ts` | examined | predict/apply change impact: rename-aware diff, the explicit relation graph over xrefs and seams, reason paths, and the unaffected-control set. | `c0734040` |
| <a id="le-fd76969f61"></a>`mcp-server/src/tools/learning.ts` | examined | The knowledge tools and the workflow API the survey writes through. | `410d769b` |
| <a id="le-6ef26ea3bf"></a>`mcp-server/src/tools/locks.ts` | examined | The write-lock table with TTL expiry cleared on every acquire. | `c0734040` |
| <a id="le-f1e1e50eb5"></a>`mcp-server/src/tools/locus.ts` | examined | The knowledge tools and the workflow API the survey writes through. | `410d769b` |
| <a id="le-2c73cbdb5d"></a>`mcp-server/src/tools/logging.ts` | examined | Access and query logging, and the default field-demand priority used before any query_log evidence exists. | `c0734040` |
| <a id="le-4a321e9eb2"></a>`mcp-server/src/tools/materialize.ts` | examined | The publication preflight that refuses on an incomplete reconciliation before anything renders, and the projection read-back recorded as an auditable run. | `c0734040` |
| <a id="le-be8daa9f30"></a>`mcp-server/src/tools/open-questions.ts` | examined | The autoprogress contract: record_open_question with what_assumed, and get_autoprogress_mode echoing the raw env value. | `c0734040` |
| <a id="le-d4e50bcb20"></a>`mcp-server/src/tools/project.ts` | examined | Session lifecycle and the end_session auto-commit that checkpoints the WAL before committing storage. | `c0734040` |
| <a id="le-dd3a3c7de8"></a>`mcp-server/src/tools/refresh.ts` | examined | The knowledge tools and the workflow API the survey writes through. | `410d769b` |
| <a id="le-975eb9a6ea"></a>`mcp-server/src/tools/research.ts` | examined | The knowledge tools and the workflow API the survey writes through. | `410d769b` |
| <a id="le-95db056444"></a>`mcp-server/src/tools/resolution.ts` | examined | audit_resolution_invariants over findings, claims, contradictions and obligations — it reports violations and never repairs. | `c0734040` |
| <a id="le-7ae5c96125"></a>`mcp-server/src/tools/revalidation.ts` | examined | The knowledge tools and the workflow API the survey writes through. | `410d769b` |
| <a id="le-8278578c81"></a>`mcp-server/src/tools/review-analysis.ts` | examined | The knowledge tools and the workflow API the survey writes through. | `410d769b` |
| <a id="le-6d61e2146d"></a>`mcp-server/src/tools/review-session.ts` | examined | The decision surface compiled from a reconciled composition run, the actionable-items-need-evidence refusal, and the export read-back on state, coverage and content. | `c0734040` |
| <a id="le-f9a7088ebf"></a>`mcp-server/src/tools/review.ts` | examined | The knowledge tools and the workflow API the survey writes through. | `410d769b` |
| <a id="le-1be82c1094"></a>`mcp-server/src/tools/seams.ts` | examined | Seam records and get_seam_assessability, which gates SC-N concerns on both parties being mapped. | `c0734040` |
| <a id="le-6a992a5f92"></a>`mcp-server/src/tools/stale.ts` | examined | The stale backlog over the ledger, clear_staleness refusing an absent file, and retire_ledger_file refusing a still-tracked one. | `c0734040` |
| <a id="le-503791eb6f"></a>`mcp-server/src/tools/storage-history.ts` | examined | commit_phase_gate: the second caller of checkpointDatabaseForStorageCommit, and the storage log reader. | `c0734040` |
| <a id="le-8aacc5b615"></a>`mcp-server/src/tools/subsystems.ts` | examined | Status writers and the finding rollup over finding_state_current. | `c0734040` |
| <a id="le-80bab4fb82"></a>`mcp-server/src/tools/vocabulary.ts` | examined | define_term's three-step anchor resolution — parse, resolve the revision, require the path in that tree — the scope join that stops a re-definition revoking another subsystem's discharge, and decline_domain_vocabulary. | `c0734040` |
| <a id="le-b46e91be2b"></a>`mcp-server/src/tools/xrefs.ts` | examined | add_xref requires a citation token in the context prose whose revision resolves; the eighth local copy of the git probe, kept local for its own failure policy. | `c0734040` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AT-1](../concerns.md#at-1)** | confirmed-acceptable | code-verified | 🔗 | Every multi-row mutation read in this pass is wrapped in one ctx.db.transaction, and the pairs are exactly the invariants: disposition with attachments, reconciliation with its gap rewrite and both digests, carried record with its pre-record, finding with its opening event, reset with its five deletes and the ladder rung. Acceptable rather than ruled out on two counts: the pattern is a convention at 30-odd call sites with nothing enforcing it, and 11 of the 43 modules are unread at this pass, so the claim is over what was read. |
| **[AT-2](../concerns.md#at-2)** | confirmed-acceptable | code-verified | 🔗 | This surface holds both callers of commitStorage — commit_phase_gate and end_session — and both call checkpointDatabaseForStorageCommit immediately before it, so the recoverability invariant B02-1 is about is upheld here. Acceptable rather than ruled out for the same reason it is in [B-02](b02-mcp-core-persistence-and-lifecycle.md): the obligation is a convention at two call sites in this subsystem rather than a property of the function in [B-02](b02-mcp-core-persistence-and-lifecycle.md) that publishes the commit, and a third tool that wanted to commit storage would have to know to checkpoint. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | code-verified | 🔗 | The derived surfaces here are answered through shared generated predicates rather than restated per reader: OPEN_FINDING_SQL over finding_state_current is what the dashboard, the subsystem rollup and get_finding_summary all count, which is the repair for F9/codex — a repaired finding that stayed open on one surface and closed on the others. OBLIGATION_BEARING_SQL plays the same role for the stale split. Acceptable rather than ruled out because scope_gaps is rebuilt only by detect_changes, so between a ledger write and the next reconciliation the dashboard's unclassified_paths is a count of the last reading rather than of the tree — which is exactly why §3 requires the standing reconciliation, not the gap rows, to license a coverage fraction. |
| **[CR-1](../concerns.md#cr-1)** | confirmed-acceptable | code-verified | 🔗 | Handlers are synchronous end to end, so two calls cannot interleave inside one process, and the multi-row writes are transactional against a second process. The write_locks table is an advisory coordinator-level lock over artifact paths, not a database lock: acquire_lock clears expired holders and refuses a live one, but nothing in the tool surface requires a writer to hold it, so it serializes only sub-agents that agree to use it. Acceptable rather than ruled out on exactly that: the mechanism is sound and its use is voluntary. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | code-verified | 🔗 | Refusals run before the transaction opens, so a refused call leaves no partial row: every guard in set_disposition, add_finding, carry_finding and detect_changes throws or returns before the transaction body. Inside a transaction, better-sqlite3 rolls back on a throw. Acceptable rather than ruled out for one asymmetry the code makes visible: two error styles coexist — ToolError (surfaced as {ok:false,error}) and a returned {ok:false,error} object — and which a handler uses is a per-handler choice, so a caller distinguishing a refusal from a failure has to read the message rather than the shape. |
| **[IF-1](../concerns.md#if-1)** | out-of-scope | code-verified |  | This surface passes --force-full and --clean-publish through to the materializer and records the read-back it returns; it implements neither path. Whether incremental, full and clean-publish renders agree from identical state is a property of materializer/ ([B-04](b04-diff-aware-materializer.md)), where the probe can be run. What this side does own is the preflight that refuses to render at all over an unreconciled store, which is disposed under [CC-1](../concerns.md#cc-1) and [SC-1](../concerns.md#sc-1). |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | code-verified | 🔗 | The two resources this surface opens on its own are foreign database handles and child processes. compare_conspectuses opens two read-only handles and closes both in a finally, which is the right shape. Every child process is spawnSync or execFileSync and so cannot outlive its call. Acceptable rather than ruled out because materialize_docs spawns the Python materializer with no timeout: an unresponsive renderer blocks the server's only thread indefinitely, which is the same unbounded-subprocess family as B02-R1 and is recorded there rather than duplicated as a second finding. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified | 🔗 | The seams this surface publishes twice are held together by generated sources rather than by prose: every enum a schema advertises comes from ../vocabulary.js, the citation grammar a schema's pattern publishes is CITATION_TOKEN_SOURCE — the same source the handler enforces — and the open-findings predicate is one generated SQL string. Acceptable rather than ruled out because one seam is compared only by a checker outside this subsystem: the advertised tool set against DEVELOPMENT.md, reconciled by scripts/gen-tool-inventory.mjs ([B-05](b05-packaging-installer-validation-and-product-docs.md)). Nothing inside these modules would notice a tool added without its inventory entry. |
| **[SI-1](../concerns.md#si-1)** | out-of-scope | code-verified |  | Project-key and workspace-binding derivation is [B-02](b02-mcp-core-persistence-and-lifecycle.md)'s (project.ts), and nothing in this surface re-derives either: every handler reads ctx.project, which the dispatcher has already re-asserted. What these modules own is the narrower containment question — that a path a caller supplies cannot escape the bound storage root — and resolveArtifactPath and resolveStorageOutputPath both enforce it lexically and through realpath. Recorded out-of-scope so the identity concern stays owned where the derivation is. |
| **[SI-2](../concerns.md#si-2)** | confirmed-acceptable | code-verified | 🔗 | Every revision this surface accepts is resolved at the write and re-resolved at the read, and the strongest case — define_term's anchor — goes further, requiring the path to exist in that revision's tree because parsing a citation cannot see an absent file. Acceptable rather than ruled out because the resolution is implemented eight times with eight failure policies and nothing compares them: xrefs.ts:581 names itself the eighth copy. A property added to one, such as a wall-clock bound, reaches the other seven only by hand. |
| **[TB-1](../concerns.md#tb-1)** | confirmed-bug | code-verified |  | Not one of the eight spawnSync git probes in this surface carries a timeout or a killSignal, and each runs on the server's only thread inside a synchronous handler. The repository already states the rule — codex-host.ts declares STARTUP_PROBE_TIMEOUT_MS and names the hang it prevents — and applies it to three sites, all of them on the startup path. The write path, which runs a probe on every durable write, is unbounded everywhere. Recorded as B02-R1 against the shared helper and B02-R2 against index.ts:gitRoot; this disposition is the same defect counted over its full surface. |
| **[TR-1](../concerns.md#tr-1)** | confirmed-acceptable | code-verified |  | The model-facing boundary is treated as untrusted throughout: a worker's success label is landed and then independently scored against durable state; a carried finding cannot be ruled out without evidence collected in this session; a claim cannot be overturned without new contradictory evidence; artifact paths are contained lexically and by realpath; and add_xref refuses prose carrying no resolvable citation. The one asymmetry is deliberate and documented: the symbol half of a citation is not checked for reachability, because deciding whether a symbol exists at a revision needs a parser the server does not have, and the description says a citation records where the edge was read rather than a symbol the server confirmed. |

### Survey artifact

#### **B-03** — Knowledge tools and workflow API

Structural account, read at `c073404`. Scope: `mcp-server/src/tools/**` — 43 modules, the
surface a survey is written and read through.

##### Observed

**One shape, repeated.** Every module exports a `ToolDefinition[]`: a name, a description
that is the agent-facing contract, a JSON Schema the dispatcher validates against with Ajv
in strict mode, and a synchronous handler taking `(args, ctx)`. There is no shared base
class and no middleware; the guards are ordinary calls at the top of each handler —
`requireActiveSession`, `requireSubsystemStatus`, `requireWorkspaceSourcePath`,
`resolveWorkspaceCommit` — in an order each handler chooses.

**Refusal order is deliberate.** `set_disposition` checks session, then depth, then the
concern's existence, then resolves its revision, then the evidence ids, then their
reachability, then the quality ceiling. The comments say why: a caller who got the depth
wrong is better told that than told about its revision, and a refused write should not
spawn a git subprocess first.

**Multi-row writes are transactional.** `set_disposition` (row + attachments),
`detect_changes` (staleness + `scope_gaps` + `git_state` + the reconciliation row),
`carry_finding` (record + archived-terminal pre-record), `add_finding` (finding + opening
resolution event), `reset_subsystem` (five deletes + the status write + the ladder rung).

**A report is landed, then scored.** Composition never reads a worker's success label as a
verdict: `land_composition_item` stores the observation, and `score_composition_item`
re-resolves the commit, re-reads the artifact registry's hash, checks the test's identity,
SHA and exit code, and requires a terminal review aggregation. The integral lane is the
same shape one level up.

**Revision resolution is eight local copies.** `xrefs.ts:581` names itself the eighth and
records that they are unshared on purpose, each owning a different failure policy —
return `false`, throw `ToolError`, return `null`. None carries a timeout.

##### State containers

`ctx.db` (one `better-sqlite3` handle), `ctx.sessionId` (mutable, set by `start_session`
and cleared by `end_session`), and `ctx.project` (frozen at startup). No module holds
state of its own between calls.

##### Seam contracts from this side

- **the tables** — this surface is the only writer; the materializer ([B-04](b04-diff-aware-materializer.md)) reads them
  `mode=ro`. Schema ownership is [B-02](b02-mcp-core-persistence-and-lifecycle.md)'s.
- **`tools/list`** — read by every host and by `scripts/gen-tool-inventory.mjs`, which
  reconciles the advertised set against `DEVELOPMENT.md` ([B-05](b05-packaging-installer-validation-and-product-docs.md)).
- **the skill references** — `.claude/skills/amanuensis/**` ([B-01](b01-survey-methodology-and-agent-contracts.md)) instructs the calls
  these handlers refuse; `check-refusal-parity` compares the two.

##### Open

Eleven of the 43 modules — `revalidation`, `design-session`, `refresh`,
`chorusmith-adapter`, `research`, `learning`, `evaluation`, `crosswalk`, `review`,
`review-analysis`, `locus` — are scoped and unread at this pass and remain `candidate` in
the ledger. They are the long-tail research and review machinery rather than the survey
write path; the concern dispositions below are taken over the 32 modules that were read,
and say so.
