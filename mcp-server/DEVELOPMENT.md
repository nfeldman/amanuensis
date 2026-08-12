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

The live tool inventory below is auto-generated from the running server's
`tools/list` response — do not hand-edit. Run `node scripts/gen-tool-inventory.mjs`
to regenerate; CI fails if the block is stale.

<!-- TOOL-INVENTORY-START -->

_81 tools across 25 groups. Generated from `tools/list` — do not hand-edit._

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

### `compare` (1)

| Tool | Description |
|---|---|
| `compare_conspectuses` | Diff two Amanuensis memory.db files structurally. Useful for comparing a local vs. cloud autoprogress run of the same codebase, or before/after a methodology change. Paths point at the memory.db files directly, not at storage directories. Returns a JSON summary; if write_to is set, also renders the diff as a markdown page at that path. |

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
| `resolve_contradiction` | Apply a resolution to a contradiction. resolution ∈ {a-supersedes-b, b-supersedes-a, scope-distinction, unresolved}. scope_note is required for scope-distinction and documents why the findings apply to distinct scopes. |
| `get_contradictions` | List contradictions. resolution_filter defaults to 'unresolved'; pass 'all' to return every row regardless of status. |

### `dashboard` (2)

| Tool | Description |
|---|---|
| `get_hot_subsystems` | Return the most-accessed subsystems over the last 7 days, weighted by recency. Reads from the hot_subsystems view. |
| `get_dashboard` | Return a high-level project overview: project key, canonical branch, SHAs, subsystem counts, open bugs, stale entries, open field notes, unresolved contradictions. |

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
| `attach_evidence_to_finding` | Link an evidence row to a finding with a role (symptom / root-cause / fix-anchor / compensating). |
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

### `findings` (4)

| Tool | Description |
|---|---|
| `add_finding` | Record a confirmed finding. finding_id conventionally looks like 'B01-1' (subsystem code + sequence). primary_files is a JSON array of file:symbol@sha references. business_context explains why this is (or isn't) a real bug in domain terms. |
| `update_finding_status` | Change a finding's status (e.g., confirmed-bug → fixed). Optionally record fix_location. Returns previous_status. Overturning a finding to 'ruled-out' requires new disproving evidence attached to it in the current session (add_evidence + attach_evidence_to_finding). A bare reclassification is rejected. |
| `get_findings` | List findings with optional filters (subsystem_id, severity, status). primary_files is returned as a JSON-parsed array. |
| `get_finding_summary` | Return per-subsystem severity/status roll-up (total, critical, high, medium, low, open_bugs, fixed). Reads from the finding_summary view. |

### `git` (3)

| Tool | Description |
|---|---|
| `get_git_state` | Return the stored git baseline (canonical branch, onboarding SHA, last-checked SHA, detected branches). |
| `set_git_state` | Create or update the git baseline. On first call, onboarding_sha and canonical_branch are required. Subsequent calls may update any subset of fields. detected_branches is an array; stored as JSON. |
| `detect_changes` | Compare current_sha against last_checked_sha for files tracked in the file_ledger. Marks affected entries stale and updates last_checked_sha. Requires the target workspace to be a git repo the server can shell out to. |

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

### `materialize` (1)

| Tool | Description |
|---|---|
| `materialize_docs` | Render the conspectus from memory.db + prose artifacts into navigable documentation under <storage>/docs/. Diff-aware: re-renders only pages whose source data or prose has changed since the last run. output_dir overrides the default (project storage /docs). force_full=true re-renders everything. |

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
  tools/             24 tool groups — see auto-generated inventory above
```
