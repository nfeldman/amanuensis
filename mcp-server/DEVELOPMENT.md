# amanuensis-memory

MCP server that owns the persistent storage for the Amanuensis agent toolkit.
It replaces fragile `sqlite3`-in-bash patterns with typed tools over a SQLite
database (WAL mode, via `better-sqlite3`).

## What it does

- Resolves a project key from the git remote (or workspace path as fallback)
- Creates `~/.amanuensis/workspaces/<owner>/<project>/memory.db` on first use
- Initializes the storage directory as a git repo (first open only) so phase
  gates and session boundaries can be committed for free history/rollback
- Exposes a typed tool surface over the conspectus schema, plus a
  `materialize_docs` tool that shells out to the Python materializer

## Unattended refresh protocol

The refresh tools compose change impact, revalidation, and projection proof
without treating a worker callback as completion:

1. `plan_refresh_run` writes an immutable commit/provider/budget/authority
   manifest. A configured provider inside this envelope is preauthorized;
   provider expansion, output outside project storage, and irreversible side
   effects are blocked before dispatch.
2. `execute_refresh_run` advances durable stages and creates provider-outbox
   attempts. A worker adapter reads the attempt's `runtime_route` and
   `runtime_input` from `get_refresh_run`.
3. The adapter returns through `land_refresh_result` or
   `fail_refresh_result`. Accepted work is closed through
   `score_refresh_result`, which retains A3's evidence and boundary gates.
4. `resume_refresh_run` adopts deterministic children after interruption and
   advances only from database state. A run becomes complete after exact
   revalidation fan-in and state/coverage/content read-back of the clean
   projection. `cancel_refresh_run` preserves prior attempt history.

`simulation_crash_after` exists only for fault-injection tests. The provider
outbox is deliberate: external API calls cannot share a SQLite transaction,
so dispatch and landing are separate, auditable boundaries.

## Independent review protocol

The review-analysis tools turn a published ReviewBrief into staged,
observe-only work packets. Generators land candidates before hypotheses are
frozen. Refuters then receive anonymous claims and evidence without generator
rationale or identity. Verifiers receive the same claims plus pooled evidence,
but no refuter verdict or rationale. Only after every planned pass lands can a
mechanical aggregation retain, contest, or defeat a hypothesis; defeat requires
new evidence found by a refuter and independently reused by an overturning
verifier.

Blind evaluation uses sealed clean, marker-only, treated, and null arms with at
least two replicates per condition. Scoring checks the shapes of the packets
actually dispatched, preserves matched-arm denominators, reports test-retest
Jaccard and metric step size per cell, never pools conditions, and excludes any
run whose structural or content canary fires. The deterministic harness proves
protocol custody and red-gate behavior; it does not establish the semantic
quality of a model, the benefit of additional compute, or an effect size for
model heterogeneity.

## Composition and integral HEAD protocol

Composition runs list every expected artifact, commit, test, and A7 review
result before collection. Each item names whether its verification object is a
unit or the assembled repository. A landed worker message is only an
observation: a separate scorer checks it against the artifact registry, Git,
test identity and exit status, or a terminal review aggregation. Fan-in reports
the realized expected/dispatched/landed/scored/passed/failed/deferred N and
cannot turn green from a nonempty subset.

After all unit items pass, one integral lane receives the exact assembled HEAD
and tree, every impacted seam with named concern codes, and the remaining
composition-scoped checks. It must report a clean worktree at that same commit.
Deferred concerns are blocking rows with an open obligation destination and
remain visible in reconciliation. The A8 corpus deliberately changes a
producer version while both producer and consumer unit checks still pass; only
the integral contract fails. A follow-up compatibility commit demonstrates the
same instrument reaching green.

The live tool inventory below is auto-generated from the running server's
`tools/list` response — do not hand-edit. Run `node scripts/gen-tool-inventory.mjs`
to regenerate; CI fails if the block is stale.

## Review session and export protocol

A review session derives an immutable, compact decision surface from a terminal
composition reconciliation. Operational rules keep a reopened verified repair
as a regression, an open finding anchored before the change base as a latent
defect, a disproved finding as ruled-out history, an open candidate concern as
an unverified suspicion, and an open question as an unknown. These labels are
data, not presentation prose.

Each compact item has a stable content-derived ID, a durable record URI, and a
single expansion call that returns its source record, cited evidence, and
backlink. Actionable claims without evidence are rejected, except for an open
obligation whose structured row is itself the work-custody record. Completion
stores advice furnished separately from decisions accepted.

Exports are fixed beneath project storage and emitted as canonical JSON plus a
Markdown view. Before an export can count as verified, a separate read-back
reconciles session identity/state, exact item coverage, and item content hashes.
Lexical containment and real paths of existing ancestors reject symlink-parent
escapes. Evaluation captures verification minutes and missed-constraint counts;
satisfaction is optional context rather than the success measure.

## CodebaseBrief contract

`CodebaseBrief 1.0.0` is the stable seam between Amanuensis records and review,
design, or generative sessions. It is deliberately not a serialization of
SQLite tables. `prepare_codebase_brief_source` freezes one task-bounded source
manifest from an A9 review session, direct task constraints, and any
provenance-bound inferred intent or candidate options. All projections retain
that source hash and copy selected candidates without changing their truth.

Every candidate carries a stable ID and hash, an explicit epistemic kind,
record URI, provenance, validity, declared modes, and relevance terms. The
contract keeps observed behavior, direct intent, inferred intent,
recommendations, inferences, and open questions distinct after JSON round-trip.
The JSON Schema ships in `contracts/codebase-brief.schema.json`; the runtime
semantic validator additionally reconciles hashes and the exact source census.

Selection is `registry-then-lexical-v1`: explicit IDs resolve locally before a
deterministic lexical rank, and the trace records `model_calls: 0`. A caller may
explicitly request a candidate outside a mode's normal policy, but that override
is visible as `registry-exact`. Every remaining candidate appears once in the
omission ledger with a `policy`, `irrelevant`, or `budget` reason. Missing
epistemic metadata, category drift, hash drift, duplicate accounting, and silent
truncation are invalid.

## Dialectical design sessions

Design sessions bind three immutable CodebaseBrief projections to independent
immanent, adversarial, and speculative lanes. Each has its own controlled
section set, context profile, provider/model identity, and mandate. All packets
dispatch before any output can land, and none contains another lane's output.
Each option explicitly records what it preserves, rejects, enables, and
forecloses, along with cost, reversibility, evidence, gaps, falsifiers, and
research needs.

Mechanical aggregation runs only after exact three-lens fan-in. It keeps
preference and option-field disagreements, and furnishes an advice-only lean
only when an option has an independent strict majority, decisive evidence, and
no unresolved mutually exclusive or highest-priority desire. Otherwise the
result is underdetermined and names the missing human desire. Blind evaluation
packets anonymize lanes, remove runtime identities and condition labels, and
halt when supplied content canaries survive.

## Decision custody

Decision records separate proposal authorship from acceptance authority. A
model, human, or owning system may draft an immutable revision, but only a
human or owning-system event whose scope matches the decision may authorize the
`draft → accepted` transition. SQLite requires that event before both the
status transition and the current-authority pointer. Rejection, supersession,
and invalidation retain the original payload and append events; reconsideration
always creates a successor revision.

Each revision carries direct desire sources, the selected option, rejected
alternatives, constraints, consequences, falsifiers, typed premises, and code
links. `detect_decision_impacts` compares applied A2 impacts with accepted
premises and creates a blocking decision-review obligation without changing
the accepted row. `CodebaseDecision 1.0.0` projections are source-authoritative
copies for Chorusmith custody; three-axis read-back rejects missing authority,
alternatives, desire sources, or falsifiers.

## Research-question broker

`ResearchRequest 1.0.0` is the decision-bound seam from Amanuensis to
Scholiast. Admission requires a real decision revision and field, current local
evidence, an exhausted repository search, named source classes and
disconfirmers, a bounded budget, and transparent expected-information-value
inputs. Curiosity-only proposals are retained as rejected; incomplete or
low-value proposals are retained as nonblocking deferrals. Exact duplicates
link their prior request unless an existing changed premise is named.

Only admitted requests can dispatch. The handoff records an existing durable
`scholiast/<slug>` workspace, required output, established and ruled-out ground,
held evidence, source-quality guidance, access-status degradation, budget, and
decision destination. Landing re-reads and hashes its artifacts. Source rows
retain locators, class, access status, excerpt, and limitation.

External testimony is stored separately from repository-backed temporal claims.
It may target a hypothesis, option, premise, or confidence reason, but never a
code observation, and its target must match the admitted request. A conflict
with current code behavior creates an open typed contradiction and preserves
both records. Consumption names the exact changed
field or why nothing changed; it cannot mutate accepted decision history.

<!-- TOOL-INVENTORY-START -->

_159 tools across 37 groups. Generated from `tools/list` — do not hand-edit._

### `artifacts` (3)

| Tool | Description |
|---|---|
| `register_artifact` | Record that a prose artifact exists and capture its content hash. `path` is relative to the project storage directory. If the file exists, its size and sha256 are computed automatically. This is the source of truth the diff-aware materializer uses to decide what to re-render. |
| `list_artifacts` | List registered prose artifacts. Filter by kind ('subsystem-survey', 'findings-index', etc.) and/or subsystem_id. |
| `rehash_artifact` | Re-read an artifact from disk and update its stored content_hash + bytes. Called by the agents right after writing an artifact file so the materializer's diff check reflects the current contents. |

### `claims` (6)

| Tool | Description |
|---|---|
| `add_claim` | Create one current, immutable, epistemically typed claim backed by structured evidence. The Git commit and every evidence SHA must resolve in the target workspace. A claim_key may have only one current version. |
| `invalidate_claim` | Close a current claim's validity interval at an exclusive Git boundary while preserving its history. Requires new contradictory evidence and a reason; rejected transitions are transactional. |
| `supersede_claim` | Atomically close a current predecessor and create its successor in the same claim_key at one Git commit. The successor id must be new and its supporting evidence must not already support the predecessor. |
| `get_claims` | Return typed claims, current by default. query_sha performs a Git-ancestry as-of query using exclusive invalidation boundaries; include_historical returns every stored version when query_sha is omitted. |
| `get_claim_history` | Return every version, evidence link, validity event, and supersession edge for one claim_key. |
| `get_legacy_claim_projection` | Read the non-destructive compatibility projection of legacy entries, evidence, dispositions, findings, and contradictions. Null temporal fields remain null rather than being invented. |

### `codebase-brief` (5)

| Tool | Description |
|---|---|
| `prepare_codebase_brief_source` | Freeze a storage-independent CodebaseBrief source record from one A9 review session plus typed direct constraints, provenance-bound inferred intent, and candidate options. The source is immutable and shared by all mode projections. |
| `compile_codebase_brief` | Compile a versioned review, design, or generative CodebaseBrief from one immutable source. Exact registry IDs are resolved first, lexical ranking is deterministic, model_calls is always zero, and every excluded candidate receives a policy, irrelevance, or budget reason. |
| `get_codebase_brief` | Read one immutable CodebaseBrief projection, its source identity, explicit omissions, deterministic selection trace, and append-only validation records. |
| `lookup_codebase_brief_objects` | Resolve exact candidate IDs in a frozen CodebaseBrief source through the local registry. This path is deterministic, preserves source objects byte-for-byte, and performs zero model calls. |
| `validate_codebase_brief` | Validate a stored or caller-supplied CodebaseBrief 1.0.0. Semantic checks reject erased epistemic kinds, category drift, duplicate accounting, and any source candidate missing from both selected content and explicit omissions. |

### `compare` (1)

| Tool | Description |
|---|---|
| `compare_conspectuses` | Diff two Amanuensis memory.db files structurally. Useful for comparing a local vs. cloud autoprogress run of the same codebase, or before/after a methodology change. Paths point at the memory.db files directly, not at storage directories. Returns a JSON summary; if write_to is set, also renders the diff as a markdown page at that path. |

### `composition` (10)

| Tool | Description |
|---|---|
| `plan_composition_run` | Create an immutable fan-in manifest for artifacts, commits, tests, and A7 review results. Every item declares its verification object and target commit; integral items bind to the exact currently assembled HEAD, and impacted seams require named concern coverage. |
| `dispatch_composition_item` | Dispatch one expected composition item with an explicit unit or integral-HEAD verification object. Integral items remain unavailable until unit fan-in has admitted the separate integral lane. |
| `land_composition_item` | Land a worker observation exactly once without trusting its success label. A separate scorer checks the expected artifact, commit, test identity/SHA/exit, or terminal A7 aggregation against durable state. |
| `score_composition_item` | Independently score a landed item against its immutable manifest and durable repository/conspectus state. A success message without the expected artifact or commit becomes scored-fail. |
| `dispatch_integral_verification` | After exact passing unit fan-in, dispatch the sole composition-scoped lane over the assembled HEAD, expected integral checks, and every impacted seam's selected concerns. Missing, failed, or deferred unit work halts here. |
| `land_integral_verification` | Land immutable proof coordinates from a clean checkout of the assembled HEAD. Test and review results still land as their separately expected integral composition items. |
| `score_integral_verification` | Verify that the integral lane used the exact assembled HEAD/tree in a clean worktree. A mismatched or dirty checkout blocks composition before final fan-in. |
| `record_composition_deferral` | Record a composition concern as an immutable RED deferral with an existing open blocking obligation as its named destination. A source phrase alone cannot discharge the concern. |
| `reconcile_composition_run` | Append a reconciliation that reports expected, dispatched, landed, scored, passed, failed, and deferred N. Green requires exact item fan-in, no deferrals, and a passing clean integral lane; missing work remains RED rather than counting as less data. |
| `get_composition_run` | Read the immutable composition manifest, verification-object custody, seam concerns, named deferrals, integral checkout proof, and every fan-in reconciliation for one assembled HEAD. |

### `concerns` (3)

| Tool | Description |
|---|---|
| `list_concerns` | Return concern codes with status and origin. Use status_filter='active' to get the working checklist; 'retired' and 'merged' are excluded by default only if a filter is passed. |
| `add_concern` | Add a concern to the calibrated checklist. origin='seeded' for concerns derived from territory map; 'discovered' for those found mid-survey. Use codes like CC-1 (cache coherence #1), SC-3 (seam contract #3). |
| `retire_concern` | Retire a concern or merge it into another. For action='merge', provide merged_into. Retiring records a final state — it does not delete the row, so historical dispositions keyed on this code remain readable. |

### `contradictions` (3)

| Tool | Description |
|---|---|
| `add_contradiction` | Record a contradiction between two findings. Use when the same file/symbol is implicated in findings whose classifications or severities are logically incompatible. conflict_type: 'classification-conflict', 'severity-conflict', etc. Leaves the contradiction as 'unresolved' until resolve_contradiction is called. |
| `resolve_contradiction` | Apply an evidence-backed resolution to a contradiction and append its proof history. Non-unresolved resolutions require structured evidence collected in the active session, attached to one of the contradictory findings, plus a rationale. scope_note is additionally required for scope-distinction. |
| `get_contradictions` | List contradictions. resolution_filter defaults to 'unresolved'; pass 'all' to return every row regardless of status. |

### `dashboard` (2)

| Tool | Description |
|---|---|
| `get_hot_subsystems` | Return the most-accessed subsystems over the last 7 days, weighted by recency. Reads from the hot_subsystems view. |
| `get_dashboard` | Return a high-level project overview: project key, canonical branch, SHAs, subsystem counts, open bugs, stale entries, open field notes, unresolved contradictions. |

### `decisions` (8)

| Tool | Description |
|---|---|
| `draft_decision_revision` | Create an immutable draft decision revision from qualified design advice or direct human/system authorship. Desire sources, selected option, rejected alternatives, constraints, consequences, falsifiers, premises, and code links are mandatory custody; a rejected or accepted decision can only be reconsidered as a new revision. |
| `accept_decision_revision` | Accept one draft revision only through an explicit human or owning-system authority event whose scope covers this decision. Acceptance names the actor, authority source, and reason; an accepted predecessor becomes superseded without losing history. |
| `reject_decision_revision` | Reject one draft through explicit human or owning-system authority. The proposal, alternatives, evidence, and reason remain immutable and queryable; reconsideration requires a successor revision. |
| `invalidate_decision_revision` | Invalidate accepted decision authority without editing its premises. New evidence or an applied impact run is required, history remains readable, and a blocking decision-review obligation is created. |
| `detect_decision_impacts` | Compare an applied A2 impact artifact with every accepted decision's typed claim, evidence, and code premises. Matches append an impact event and create a blocking decision-review obligation; accepted history is never silently rewritten. |
| `get_decision` | Read a decision's complete immutable revision and authority-event history, rejected and superseded alternatives, current authority pointer, and open review obligations. |
| `project_decision_revision` | Create a portable CodebaseDecision 1.0.0 projection for Chorusmith session custody. It carries desire sources, authority events, alternatives, consequences, falsifiers, premises, and source-owned acceptance without transferring decision authority. |
| `verify_decision_projection` | Read a stored or caller-supplied portable decision projection back against durable source state. State, exact required-field coverage, and semantic content must all agree; dropping desire source, acceptance authority, alternatives, or falsifiers turns red. |

### `design-session` (6)

| Tool | Description |
|---|---|
| `plan_design_session` | Plan exactly three independent immanent, adversarial, and speculative architecture lenses over review/design/generative projections of one CodebaseBrief source. Human-origin desires, exclusive conflicts, context profiles, model-family diversity, and no-deliberation fan-in are frozen before dispatch. |
| `dispatch_design_lens` | Dispatch one frozen design-lens packet. Packets contain only that lens's controlled CodebaseBrief sections and human-origin desires, never another lens output; all three must dispatch before any can land. |
| `land_design_lens` | Land one independent lens's option matrix contribution. Every option names what it preserves, rejects, enables, and forecloses plus migration cost, reversibility, visible evidence, gaps, falsifiers, and research needs. Decision or acceptance fields are forbidden. |
| `aggregate_design_session` | Mechanically aggregate exact three-lens fan-in without a deliberation round. Preserve option-field and preference disagreements; furnish an advice-only lean only with an independent strict majority, decisive evidence, and no unresolved mutually exclusive or highest-priority desire. |
| `prepare_design_evaluation_packet` | Create a content-checked blind evaluation packet for clean, marker-only, treated, or null design artifacts. The returned packet omits condition, session, lens, provider, and model identities; lens contributions are anonymously relabeled and surviving canary terms halt delivery. |
| `get_design_session` | Read a design session's immutable desire and lens manifests, controlled packets, independent outputs, preserved disagreements, option matrix, advice-only or underdetermined result, and blinded evaluation-packet metadata. |

### `diagnosticity` (5)

| Tool | Description |
|---|---|
| `open_diagnosticity_matrix` | Open an Analysis of Competing Hypotheses matrix when two or more concerns could independently explain the same symptom in a subsystem. Per Heuer/concern-seeding.md: enumerate concerns without pre-ranking, evaluate each piece of evidence against each concern row-wise, and rank by inconsistency — reject the concern with the most contradicting evidence first. |
| `record_diagnosticity_verdict` | Record the verdict for a single cell (one concern × one evidence row). Verdict ∈ {consistent, contradicts, irrelevant, ambiguous}. Evidence consistent with all competing concerns has zero diagnostic value; evidence that contradicts only one has maximum diagnostic value. |
| `resolve_diagnosticity_matrix` | Close a matrix with an outcome. 'resolved' requires a leading_concern (winner after inconsistency ranking); 'unresolved-competition' is allowed when the evidence does not disambiguate. linchpin_note documents fragile evidence the resolution depends on. |
| `get_diagnosticity_matrix` | Return a fully-populated matrix: the session row, its competing concerns, its evidence rows, and every cell's verdict. Used by the materializer to render the matrix as a table. |
| `list_diagnosticity_matrices` | List matrices, newest first. Filter by outcome ('open', 'resolved', 'unresolved-competition') or subsystem. |

### `dispatch` (3)

| Tool | Description |
|---|---|
| `log_dispatch` | Record a sub-agent dispatch. Use role ∈ {mapping-agent, memory-auditor, explore, custom}. file_path points to the dispatch record (e.g., _meta/prompts/<timestamp>-<role>-<seq>.md). Status starts as 'dispatched'. |
| `complete_dispatch` | Mark a dispatch complete. artifacts_written is a JSON array of paths the sub-agent wrote to. |
| `get_dispatch_history` | List dispatch records, newest first. Filter by session_id; omit to get the global history. |

### `dispositions` (3)

| Tool | Description |
|---|---|
| `set_disposition` | Record how a concern applies to a subsystem. Every disposition must carry evidence (file:symbol@sha), evidence_quality (how solid that evidence is), a rationale, and the pass that produced it. This is the primary DB analog of the subsystem survey's Concern Disposition Table. |
| `get_dispositions` | Return dispositions. Filter by subsystem_id, concern_code, or both. Omit both to return everything (useful for adversarial review across the conspectus). |
| `get_concern_coverage` | Return the concern × subsystem matrix (active concerns × registered subsystems) with current disposition or '—' for unexamined cells. Used to produce the materialized heatmap. |

### `evidence` (6)

| Tool | Description |
|---|---|
| `add_evidence` | Record a structured code citation. file_path + symbol + line_range + ref_sha uniquely anchor a piece of observed behavior; kind captures how solid the observation is. Returns the evidence id to be attached to dispositions/findings/diagnosticity cells. |
| `attach_evidence_to_disposition` | Link an evidence row to a disposition with a role (supports / contradicts / linchpin / compensating). Idempotent — repeated calls just update the role. |
| `attach_evidence_to_finding` | Link an evidence row to a finding with a role (symptom / root-cause / fix-anchor / fix-verification / compensating). verify_finding_fix requires fix-verification. |
| `get_evidence` | Fetch evidence rows. Filter by id, file_path, kind, ref_sha, or any combination. Returns the full row with collected_at timestamp. |
| `get_disposition_evidence` | Return all evidence rows attached to a disposition, including role. |
| `get_finding_evidence` | Return all evidence rows attached to a finding, including role. |

### `field-notes` (3)

| Tool | Description |
|---|---|
| `add_field_note` | Record a peripheral observation the phase structure did not ask for. Categories: pattern (recurrence), anomaly (deviation), connection (cross-subsystem), tension (local correctness vs. global coherence), candidate-concern (pattern that might warrant a new concern code). |
| `get_field_notes` | List field notes, newest first. Filter by category and/or follow_up ('open', a finding ID, or 'dismissed'). limit defaults to 50. |
| `resolve_field_note` | Attach a resolution to a field note: a finding ID if it was promoted to a confirmed finding, or 'dismissed' if it was determined not to be relevant. Leaves 'open' for the default pending state. |

### `files` (3)

| Tool | Description |
|---|---|
| `add_files_to_scope` | Append or update file ledger rows for a subsystem. Each file gets a why_in_scope rationale and an optional classification (default 'candidate'). ref_sha anchors the observation to a specific commit. |
| `update_file_classification` | Transition a scoped file to a new classification (e.g., candidate → examined). Updates examined_at when the new classification is 'examined'. |
| `get_subsystem_files` | List the file ledger for a subsystem. classification_filter narrows to e.g. 'examined' or 'candidate'. |

### `findings` (6)

| Tool | Description |
|---|---|
| `add_finding` | Record a confirmed finding. finding_id conventionally looks like 'B01-1' (subsystem code + sequence). primary_files is a JSON array of file:symbol@sha references. business_context explains why this is (or isn't) a real bug in domain terms. |
| `update_finding_status` | Change a finding's coarse compatibility status. A transition to fixed requires fix_location + fix_sha and creates fixed-pending-verification; it never creates verified-fixed. Use verify_finding_fix with post-fix evidence for that. Overturning to ruled-out requires new disproving evidence attached in the current session. |
| `verify_finding_fix` | Promote a fixed-pending-verification finding to verified-fixed. The evidence must be attached to the finding, collected in the active session, and repository-bound to the fix commit or one of its descendants. Historical events remain append-only. |
| `get_finding_resolution_history` | Return the append-only resolution history for one finding, including pending repairs, verification evidence, reopenings, and superseded verified states. |
| `get_findings` | List findings with optional filters (subsystem_id, severity, status). primary_files is returned as a JSON-parsed array. |
| `get_finding_summary` | Return per-subsystem roll-up, distinguishing fixed-pending-verification from verified-fixed. |

### `git` (3)

| Tool | Description |
|---|---|
| `get_git_state` | Return the stored git baseline (canonical branch, onboarding SHA, last-checked SHA, detected branches). |
| `set_git_state` | Create or update the git baseline. On first call, onboarding_sha and canonical_branch are required. Subsequent calls may update any subset of fields. detected_branches is an array; stored as JSON. |
| `detect_changes` | Compare current_sha against last_checked_sha for files tracked in the file_ledger. Marks affected entries stale and updates last_checked_sha. Requires the target workspace to be a git repo the server can shell out to. |

### `impact` (3)

| Tool | Description |
|---|---|
| `predict_change_impact` | Compute and durably record an explainable predicted diff before comparison or invalidation. Uses rename-aware Git changes, file-ledger mappings, claim/finding evidence, xrefs, seams, and open obligations. Explicit gaps can emit a non-executing discovery request; this tool never calls a model. |
| `get_change_impact` | Read a durable predicted-diff artifact and its current application state. Optional object_type/object_id filters return the exact traversable reason path for one impacted object. |
| `apply_change_impact` | Atomically apply a previously recorded prediction: create structured git-change evidence, close every still-current predicted claim at head_sha, append validity events, and retain the immutable predicted artifact for audit. |

### `locks` (3)

| Tool | Description |
|---|---|
| `acquire_lock` | Acquire a write lock on an artifact path (relative to project storage). Used by the coordinator to serialize sub-agent writes to the same artifact. ttl_minutes defaults to 15. Returns {ok:true} on success, or {ok:false, held_by, expires_at} when the artifact is already locked. |
| `release_lock` | Release a write lock. Only the holder may release it. Safe to call even if no lock exists. |
| `get_active_locks` | Return all currently held (non-expired) locks. Reads from the active_write_locks view. |

### `logging` (3)

| Tool | Description |
|---|---|
| `log_access` | Record that an entry was loaded or read (for access-heat tracking). trigger is free text like 'phase-3 read' or 'xref from B-02'. entry_tier ∈ {0, 1, 2}. |
| `log_query` | Record a human query and which of the seven fields the answer drew on (what, why, how, when, where, see-also, confidence). tier_reached is the deepest tier the agent had to load (0–3). Used to compute field demand for adaptive compression. |
| `get_field_demand` | Return demand ranking across the seven fields (what, why, how, when, where, see-also, confidence). Used to prioritize what gets preserved during Tier 2 → Tier 1 compression. |

### `materialize` (2)

| Tool | Description |
|---|---|
| `materialize_docs` | Render the conspectus and read the finished projection back on independent state, coverage, and content axes. clean_publish=true renders in isolation and promotes only when every axis is green; a red run leaves the previous output untouched and records mismatches without altering durable truth. |
| `verify_materialized_docs` | Read back an existing projection without rendering or repairing it. Records state, coverage, and content mismatches as an auditable verification run; durable source truth is read-only. |

### `open-questions` (4)

| Tool | Description |
|---|---|
| `record_open_question` | Record something the agent could not answer without human input. In autoprogress mode (cloud runs), use this instead of pausing for human review: log the question, log the assumption you proceeded with, and continue. A human reviewer later works through the queue via get_open_questions and closes each one via resolve_open_question. Always populate what_assumed when the agent proceeded on an assumption — the reviewer needs to know what to check. |
| `get_open_questions` | Return open questions. resolution_filter defaults to 'open' so the human reviewer sees only outstanding items; pass 'all' to see everything including resolved/dismissed history. |
| `resolve_open_question` | Close out an open question. 'answered' requires `answer`; 'dismissed' is for questions no longer relevant (e.g. scope narrowed); 'superseded' is for questions folded into a later question that gives the same information. |
| `get_autoprogress_mode` | Return whether the server is running in autoprogress mode. The coordinator should call this at the top of every phase gate: if autoprogress is on, do NOT pause for human review — record any blocking question via record_open_question and proceed. The mode is set via the AMANUENSIS_AUTOPROGRESS environment variable when the server is launched. |

### `project` (5)

| Tool | Description |
|---|---|
| `get_project_info` | Return metadata about the current project: key, workspace, storage directory, whether the DB is initialized, and stored git baseline. |
| `start_session` | Begin a new survey session. Intent is free text like 'onboarding', 'survey B-01', 'refresh'. Returns a session_id used to tag dispositions, findings, field notes, and access/query logs. |
| `get_session` | Return the stored metadata for a session. If no session_id is provided, returns the most recently started session. |
| `end_session` | Mark a session ended with an outcome ('completed', 'deferred', 'superseded', etc.). Not required — sessions are still valid while open — but closing them makes the activity log legible. |
| `list_sessions` | List sessions, newest first. Filter by state ('active' = not ended, 'ended' = ended, or omit for all). |

### `refresh` (8)

| Tool | Description |
|---|---|
| `plan_refresh_run` | Create an immutable unattended-refresh execution manifest. Pins commit range, source/provider/model/runtime inputs, determinism route, budgets, replicate identity, authority, side-effect envelope, child IDs, and output. Out-of-envelope providers or effects create a durable blocked plan before any dispatch. |
| `execute_refresh_run` | Advance a planned refresh idempotently through impact prediction/application, revalidation planning, bounded automatic dispatch, durable reconciliation, clean publication read-back, and completion. simulation_crash_after is a validation fault injector; deterministic child identities let resume adopt landed work. |
| `resume_refresh_run` | Resume an interrupted refresh by adopting deterministic child runs and attempts, then advancing from durable state. No worker success message is treated as completion. |
| `cancel_refresh_run` | Cancel a nonterminal refresh. Dispatched attempts are retained as failed history, their unfinished obligations return to ready, and no claim or obligation is marked resolved. |
| `land_refresh_result` | Land one provider result through the refresh envelope. A3 records budget/source/authority violations; this wrapper updates the refresh outbox but does not score or complete the run. |
| `fail_refresh_result` | Record a failed or timed-out refresh attempt without losing retry identity. Resume may dispatch the next deterministic attempt while policy permits. |
| `score_refresh_result` | Score a landed refresh result through the evidence-gated A3 closure contract. Completion still requires resume to reconcile all landed state and pass final projection read-back. |
| `get_refresh_run` | Read the immutable refresh manifest, custody events, provider outbox attempts, child-run state, blockers, durable projection proof, and completion basis. |

### `research` (7)

| Tool | Description |
|---|---|
| `propose_research_request` | Record and mechanically admit, defer, or reject a bounded external-research question. Admission requires a real decision field, anchored current evidence, an exhausted local search, named source classes and disconfirmers, expected information value of at least 9, and duplicate reconciliation. Rejections and deferrals remain durable and nonblocking by default. |
| `dispatch_research_request` | Dispatch only an admitted request as a complete Scholiast handoff. The workspace must already be a real, non-temporary scholiast/<slug> directory; the packet preserves the destination, local evidence, ruled-out ground, source ladder, disconfirmers, budget, output shape, and access-status rule. |
| `land_research_result` | Land a Scholiast result only with readable durable artifacts, append-only source provenance, per-source access status and limitations, calibrated external claims, and explicit contradictions to current repository observations. External claims are structurally separate from code claims. |
| `consume_research_result` | Reconcile one landed result to a named hypothesis, option, premise, or confidence reason, or record why it changed nothing. A changed effect must cite an external claim and exactly match its destination; this does not rewrite immutable decision or repository observations. |
| `expire_research_request` | Expire an admitted, deferred, dispatched, or landed request with a durable reason. Expiry is terminal and retained in queue metrics; rejected and consumed requests cannot be erased or relabeled. |
| `get_research_request` | Read one research request with its immutable contract, queue events, Scholiast handoff, landed source/claim provenance, preserved code contradictions, and consumption record. |
| `list_research_requests` | List the durable research queue, including rejected, deferred, admitted, dispatched, landed, consumed, and expired rows. Optional filters preserve visibility into backlog and research decision-yield denominators. |

### `resolution` (1)

| Tool | Description |
|---|---|
| `audit_resolution_invariants` | Audit authoritative resolution invariants across findings, temporal claims, contradictions, and revalidation obligations. Returns explicit violations; it never repairs or rewrites durable truth. |

### `revalidation` (7)

| Tool | Description |
|---|---|
| `plan_revalidation_run` | Create a bounded revalidation run from an applied impact run. The planner verifies one durable obligation per applied invalidation, compiles source-filtered evidence neighborhoods, and stores the exact work packets before dispatch. |
| `dispatch_revalidation_attempt` | Dispatch one immutable, uniquely identified attempt from a planned work packet. Enforces provider, concurrency, per-attempt, aggregate budget, retry-number, and maximum-attempt bounds before work begins. |
| `land_revalidation_result` | Record one worker result without discarding over-budget or out-of-authority telemetry. Duplicate or unknown deliveries become durable protocol violations and keep reconciliation red. |
| `fail_revalidation_attempt` | Record a failed or timed-out attempt, preserving it and reopening its obligation only when the configured retry budget remains. |
| `score_revalidation_result` | Score a landed result. Accepted work can close an obligation only with new structured evidence; revalidated outcomes additionally require a current replacement claim backed by that evidence. Rejected/inconclusive work retries or dead-letters by policy. |
| `reconcile_revalidation_run` | Reconcile expected obligations against attempts, landings, scores, closures, and protocol/budget/authority violations. Completion is exact fan-in, never non-emptiness; every diagnostic remains queryable. |
| `get_revalidation_dashboard` | Return revalidation summary counts plus queryable obligations, runs, attempts, and protocol violations. Filters keep blocked, retried, deferred, dead-letter, and orphaned work visible. |

### `review` (4)

| Tool | Description |
|---|---|
| `compile_review_brief` | Compile and persist a typed, token-bounded ReviewBrief from one durable change-impact run. Explicit impact relations select context first; every inclusion, declared drop, truncation, or block receives a reversible trace and every real gap receives an obligation destination. validation_ablate is a fault-injection control for A6 tests. |
| `publish_review_brief` | Publish a compiled ReviewBrief only after independently reconciling its immutable hash, every required section, the A2 impacted-seam denominator with nonempty provenance, and a perfect structural control score. |
| `get_review_brief` | Read a ReviewBrief with its typed sections, section-status and budget declarations, full retrieval trace, gap obligations, control components, and publication receipt. |
| `expand_review_brief_item` | Expand one included compact ReviewBrief item through its trace ID to the full typed source, evidence, impact provenance, and repository-validity checks at the reviewed commit. |

### `review-analysis` (9)

| Tool | Description |
|---|---|
| `plan_review_analysis` | Plan a sealed, observe-only A7 review analysis with at least two generator, refuter, and verifier passes. The manifest isolates same-context, varied-context, or heterogeneous-runtime conditions, pins provider and budget bounds, and accepts only published A6 briefs from one reviewed commit. |
| `dispatch_review_pass` | Dispatch one durable review outbox packet at its allowed stage. Generators receive one published ReviewBrief; refuters receive anonymous claim-plus-evidence packets; verifiers receive pooled evidence without prior verdicts. Structural leakage marks the run contaminated before provider work. |
| `land_review_pass` | Land one independent pass exactly once with usage, structured judgments, and repository-valid evidence inside the sealed source and budget envelope. Generator empty results require a non-vacuity report; refuter overturns require newly discovered disproving evidence. |
| `fail_review_pass` | Record a dispatched review pass failure and halt the analysis without manufacturing fan-in or retrying under the same pass identity. |
| `freeze_review_hypotheses` | After every generator lands, mechanically freeze candidate finding keys into anonymous challenge packets containing claim variants and structured evidence but no rationale, confidence, provider, model, or pass identity. |
| `aggregate_review_analysis` | Mechanically aggregate only after exact generator/refuter/verifier fan-in. Retain every disagreement and rationale; mark a hypothesis defeated only when a refuter's newly discovered evidence is independently reused by an overturning verifier. |
| `reveal_review_analysis_truth` | Reveal a blind fixture only after judgment is terminal, verify its salted seal, scan every dispatched packet for the content canary, and durably mark contaminated runs for exclusion. |
| `score_review_evaluation` | Score sealed clean, marker-only, treated, and null arms with at least two replicates per same-context, varied-context, and heterogeneous-runtime condition. Report each cell separately with set stability and metric step size; never pool, and exclude contaminated runs. |
| `get_review_analysis` | Read review-analysis manifest, pass custody, contamination, aggregation, and post-judgment reveal. Before aggregation it exposes pass status and hashes, never another pass's private runtime input or judgment payload. |

### `review-session` (7)

| Tool | Description |
|---|---|
| `compile_review_session` | Compile a compact decision surface from one reconciled composition run. It operationally distinguishes changed situation, active findings, survived/contested/defeated challenges, regressions, latent defects, stale knowledge, open obligations, unknowns, unverified suspicions, and ruled-out or fixed history. |
| `get_review_session` | Read the compact review situation, optionally one named section, plus advice-versus-decision completion custody, exports, and measured verification evaluations. Compact items expose stable record URIs and a one-call expansion pointer. |
| `expand_review_session_item` | Expand one compact review item directly to its durable source record and structured evidence, with a backlink to the parent review. This is the single progressive-disclosure hop for every actionable claim. |
| `complete_review_session` | Record which advice items were actually furnished and any user decisions separately. A decision can reference only furnished advice; absence of an accepted decision never becomes implicit acceptance. |
| `export_review_session` | Generate canonical JSON and Markdown under project storage from a furnished review session, with stable item identifiers, record links, expansion pointers, and an immutable publication hash. The export remains derived, never authoritative. |
| `verify_review_export` | Read the canonical export paths back and independently reconcile state, exact item coverage, and semantic content against the source review session. Label swaps, missing unknowns, path errors, and edited completion custody turn RED. |
| `record_review_session_evaluation` | Record decision-surface usability as verification minutes, missed constraints over an explicit denominator, and expansion count; satisfaction is optional context and cannot replace the task metrics. |

### `seams` (3)

| Tool | Description |
|---|---|
| `upsert_seam` | Record (or update) a seam — a boundary where two subsystems share an object (cache, queue, table, event bus, RPC interface, etc.). Per concern-seeding.md Territory 11, seams are mandatory Phase 2 output. Seam concerns (SC-N codes) can only be assessed once both parties reach 'mapped'; use get_seam_assessability to check readiness. |
| `list_seams` | List seams. Filter by a subsystem (returns seams where the subsystem is party_a or party_b). |
| `get_seam_assessability` | Return every seam with the status of both parties and whether it is currently assessable (both parties 'mapped'). Lets the adversarial agent triage which seam concerns can be evaluated now vs. which must wait. |

### `stale` (2)

| Tool | Description |
|---|---|
| `get_stale_backlog` | Return stale entries prioritized by access heat (hottest stale items first). limit defaults to 10. Read from the stale_backlog view. |
| `clear_staleness` | Mark an entry fresh after re-examination. Updates ref_sha to the sha at which the entry was reverified. |

### `storage-history` (2)

| Tool | Description |
|---|---|
| `commit_phase_gate` | Commit the current state of the storage directory with a label. Call at phase boundaries, end of onboarding, or any other moment that should be recoverable. Returns the short SHA and whether a commit actually happened (no-op if nothing changed since the last commit). The label is passed via stdin so special characters are never interpreted as args; labels must be single-line ≤500 chars. |
| `get_storage_history` | List recent commits on the storage directory. Useful for inspecting phase-gate history, auditing what changed across a session, or picking a rollback target. Returns short SHA, ISO date, and message for each commit, newest first. |

### `subsystems` (5)

| Tool | Description |
|---|---|
| `list_subsystems` | Return the registered subsystems (master plan), sorted by survey priority (1 = survey first), with unprioritized subsystems falling back to alphabetical. Optionally filter by status. Each row includes a finding rollup (confirmed_bugs) for quick dashboarding and the layer / priority the coordinator assigned. |
| `upsert_subsystem` | Create or replace a subsystem entry. status defaults to 'unmapped'. `priority` (integer, 1 = survey first) is optional — set it during onboarding Phase 5 so the master plan orders subsystems by survey urgency. Omit priority to leave it unchanged on update. Use update_subsystem_status to advance status without rewriting the other fields. |
| `update_subsystem_status` | Advance a subsystem's status along the survey progression (unmapped → scoping → structural → concerns → adversarial → mapped). Transitions are monotonic: the server rejects regressions so dependent dispositions and findings cannot be silently orphaned. Use reset_subsystem to explicitly discard prior survey data and restart from an earlier phase. The 'deferred' flag is orthogonal and can be set or cleared from any status. Returns the previous status. |
| `set_subsystem_priority` | Set a subsystem's survey priority (1 = survey first). Pass `priority: null` to clear. The coordinator assigns these during onboarding Phase 5 (ranking every identified subsystem by how much downstream work depends on it) and may refine them later when new dependencies are discovered or a human answers a `priority-ranking` open question. |
| `reset_subsystem` | Discard a subsystem's survey artifacts and reset its status to an earlier phase. This is the only path that regresses a subsystem's knowledge depth — the normal update_subsystem_status tool rejects regressions. reset_subsystem deletes dependent rows (dispositions, findings, field-notes, xrefs, artifact manifest entries for this subsystem) so the conspectus remains internally consistent with the new status. The reason is recorded for audit; supply enough context that a future analyst understands why the earlier survey was discarded. |

### `vocabulary` (3)

| Tool | Description |
|---|---|
| `define_term` | Record a domain-vocabulary term used in this codebase. gloss is a one-sentence compressed definition (enough to use the term); expansion is the full explanation (enough to teach it). subsystem_id scopes a term; omit for codebase-wide terms. first_seen is a file:symbol@sha anchor. |
| `lookup_term` | Return a vocabulary entry (or null). Used by the notes agent to answer 'what does X mean here?' |
| `list_vocabulary` | List vocabulary. If subsystem_id is given, returns codebase-wide terms AND terms scoped to that subsystem (the set an agent operating inside a subsystem should know). Otherwise returns everything. |

### `xrefs` (2)

| Tool | Description |
|---|---|
| `add_xref` | Record a cross-reference between two subsystems. relationship is free-form but should use one of the canonical values: shared-pattern, data-flow, dependency, mirrors, contention, temporal-coupling. strength ∈ {observed, confirmed, structural}; defaults to 'observed'. |
| `get_xrefs` | Return cross-references involving a subsystem (as either source or target). |

<!-- TOOL-INVENTORY-END -->

See `../dev/specs/amanuensis-mcp-spec.md` for the tool surface and design
decisions (note: some areas have evolved past the spec — seams, artifacts,
evidence, and diagnosticity matrices are now first-class schema tables
rather than the markdown-only surface the spec describes).

## Install

```bash
cd mcp-server
npm install
npm run build
```

## Run

The server speaks stdio and is intended to be launched by a VS Code agent:

```bash
node dist/index.js --workspace /path/to/your/codebase
```

Or configured in `.vscode/mcp.json`:

```json
{
  "servers": {
    "amanuensis-memory": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/mcp-server/dist/index.js", "--workspace", "${workspaceFolder}"]
    }
  }
}
```

## Smoke test

`node test-smoke.mjs` exercises every tool against a fresh temp DB without
MCP transport. Useful for catching schema drift.

## Structure

```
src/
  index.ts           stdio transport + tool registry
  db.ts              schema load + idempotent init
  project.ts         project-key resolution, storage-dir git init
  session.ts         session table (server-owned)
  storage-git.ts     git operations over the storage directory
  helpers.ts         argument validators, result helpers
  schema.sql         canonical conspectus schema (embedded at install)
  tools/             30 tool groups — see auto-generated inventory above
```
