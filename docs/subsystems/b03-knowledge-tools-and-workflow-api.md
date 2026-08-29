# **B-03** — Knowledge tools and workflow API

**Status**: 🟢 mapped  
**Layer**: runtime

## Scope

mcp-server/src/tools/** (41 modules) and mcp-server/contracts/**; MCP handlers implementing evidence, findings, files, seams, dispatch, locks, staleness, materialization and queries, plus the living-conspectus surfaces added since onboarding — claims, change impact, revalidation, resolution, refresh, review and review sessions, composition, codebase briefs, design sessions, decisions, research, crosswalk, learning, evaluation, and the Chorusmith adapter.

## Start here

mcp-server/src/tools/evidence.ts; mcp-server/src/tools/git.ts; mcp-server/src/tools/dispositions.ts

## Notes

Large mutation and validation surface coupled to [B-02](b02-mcp-core-persistence-and-lifecycle.md) schema/invariants. Grew from 24 to 41 modules between b8b566f and 5694080; the seventeen added modules have a file ledger but no concern pass (open question 9), so the sixteen b8b566f dispositions cover roughly half the subsystem. Three findings recorded in the 2026-08-27 refresh: [B03-1](../findings.md#b03-1) (ledger never reconciled against the tree), [B03-2](../findings.md#b03-2) (staleness surface inert), [B03-3](../findings.md#b03-3) (evidence-quality vocabulary narrower than the published ladder).

## File ledger

| Path | Classification | Why in scope | Ref SHA |
|---|---|---|---|
| `mcp-server/contracts/activation-parity.schema.json` | candidate | JSON Schema constraining activation parity payloads; consumed by the [B-08](b08-activation-evidence-and-release-readiness-harness.md) parity checker. | `5694080` |
| `mcp-server/contracts/chorusmith/artifact-input.schema.json` | candidate | Chorusmith adapter artifact input contract. | `5694080` |
| `mcp-server/contracts/chorusmith/custody-matrix.json` | candidate | Chorusmith custody matrix defining parity obligations. | `5694080` |
| `mcp-server/contracts/chorusmith/extraction-parity-ledger.json` | candidate | Chorusmith extraction parity ledger. | `5694080` |
| `mcp-server/contracts/chorusmith/project-type.json` | candidate | Chorusmith project-type descriptor. | `5694080` |
| `mcp-server/contracts/chorusmith/run-manifest.schema.json` | candidate | Chorusmith adapter run manifest contract. | `5694080` |
| `mcp-server/contracts/codebase-brief.schema.json` | candidate | JSON Schema constraining codebase-brief tool payloads. | `5694080` |
| `mcp-server/contracts/codebase-decision.schema.json` | candidate | JSON Schema constraining decision tool payloads. | `5694080` |
| `mcp-server/contracts/historical-evaluation-corpus.schema.json` | candidate | JSON Schema constraining the historical evaluation corpus. | `5694080` |
| `mcp-server/contracts/research-request.schema.json` | candidate | JSON Schema constraining research-request payloads. | `5694080` |
| `mcp-server/src/tools/chorusmith-adapter.ts` | candidate | Chorusmith adapter parity boundary handlers (ADR-0018). | `5694080` |
| `mcp-server/src/tools/claims.ts` | candidate | Temporal claim model handlers (ADR-0002). | `5694080` |
| `mcp-server/src/tools/codebase-brief.ts` | candidate | Codebase brief contract handlers (ADR-0011). | `5694080` |
| `mcp-server/src/tools/composition.ts` | candidate | Integral head composition fan-in handlers (ADR-0009). | `5694080` |
| `mcp-server/src/tools/crosswalk.ts` | candidate | Identity-first crosswalk and qualified-method handlers (ADR-0015). | `5694080` |
| `mcp-server/src/tools/decisions.ts` | candidate | Decision acceptance and premise custody handlers (ADR-0013). | `5694080` |
| `mcp-server/src/tools/design-session.ts` | candidate | Independent dialectical design handlers (ADR-0012). | `5694080` |
| `mcp-server/src/tools/evaluation.ts` | candidate | Stratified operating envelope and evaluation program handlers (ADR-0017). | `5694080` |
| `mcp-server/src/tools/impact.ts` | candidate | Predict-before-apply change-impact handlers (ADR-0003). | `5694080` |
| `mcp-server/src/tools/learning.ts` | candidate | Typed revisable learning ledger handlers (ADR-0016). | `5694080` |
| `mcp-server/src/tools/refresh.ts` | candidate | Unattended refresh authority and recovery handlers (ADR-0006); changed in this refresh range. | `5694080` |
| `mcp-server/src/tools/research.ts` | candidate | Decision-bounded research custody handlers (ADR-0014). | `5694080` |
| `mcp-server/src/tools/resolution.ts` | candidate | Resolution proof and projection read-back handlers (ADR-0005). | `5694080` |
| `mcp-server/src/tools/revalidation.ts` | candidate | Obligation custody and reconciliation handlers (ADR-0004). | `5694080` |
| `mcp-server/src/tools/review-analysis.ts` | candidate | Derived review surface and semantic read-back handlers (ADR-0010). | `5694080` |
| `mcp-server/src/tools/review-session.ts` | candidate | Independent review custody and blinding handlers (ADR-0008); changed in this refresh range. | `5694080` |
| `mcp-server/src/tools/review.ts` | candidate | Impact-aware review brief handlers (ADR-0007); also reads the file ledger. | `5694080` |
| `mcp-server/src/tools/artifacts.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/compare.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/concerns.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/contradictions.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/dashboard.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/diagnosticity.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/dispatch.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/dispositions.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/evidence.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/field-notes.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/files.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/findings.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/git.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/locks.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/logging.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/materialize.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/open-questions.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/project.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/seams.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/stale.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/storage-history.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/subsystems.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/vocabulary.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |
| `mcp-server/src/tools/xrefs.ts` | examined | Pinned A0 inventory assigns this file to **B-03**. | `b8b566f` |

## Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AT-1](../concerns.md#at-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [AT-1](../concerns.md#at-1) in **B-03**. |
| **[AT-2](../concerns.md#at-2)** | unresolved-competition | code-verified | 🔗 | Code shape makes [AT-2](../concerns.md#at-2) plausible in **B-03**, but runtime or domain evidence is required before confirmation. |
| **[CC-1](../concerns.md#cc-1)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [CC-1](../concerns.md#cc-1) in **B-03**. |
| **[CR-1](../concerns.md#cr-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [CR-1](../concerns.md#cr-1) in **B-03**. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [EP-1](../concerns.md#ep-1) in **B-03**. |
| **[EP-2](../concerns.md#ep-2)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [EP-2](../concerns.md#ep-2) in **B-03**. |
| **[IF-1](../concerns.md#if-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [IF-1](../concerns.md#if-1) in **B-03**. |
| **[RL-1](../concerns.md#rl-1)** | unresolved-competition | code-verified | 🔗 | Code shape makes [RL-1](../concerns.md#rl-1) plausible in **B-03**, but runtime or domain evidence is required before confirmation. |
| **[RL-2](../concerns.md#rl-2)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [RL-2](../concerns.md#rl-2) in **B-03**. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified |  | [SM-03](../seams.md#sm-03) integral contract was read from both mapped endpoints and passed at the pinned revision; residuals remain separately visible. |
| **[SC-2](../concerns.md#sc-2)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [SC-2](../concerns.md#sc-2) in **B-03**. |
| **[SC-6](../concerns.md#sc-6)** | confirmed-bug | code-verified |  | The [B-01](b01-survey-methodology-and-agent-contracts.md) methodology contract publishes an eight-rung evidence ladder and instructs that a disposition's evidence_quality match its strongest attached evidence row. The **B-03** tool layer accepts only five of those rungs, omitting test-observed, config-asserted, and doc-asserted, while add_evidence accepts all of them plus runtime-observed. An agent holding test-observed as its strongest evidence must therefore either overstate it as code-verified or understate it as contract-stated. Encountered live in this refresh when two [B-08](b08-activation-evidence-and-release-readiness-harness.md) dispositions backed by executed red-gate suites were rejected. |
| **[SD-1](../concerns.md#sd-1)** | confirmed-bug | code-verified |  | The refresh path cannot detect scope drift in either direction. detect_changes inner-joins the commit-range diff against file_ledger, so files added since the baseline are structurally invisible to it; no ledger writer enumerates the working tree; and the scoping-to-structural invariant is a presence check rather than a coverage check. The result is that a subsystem can be reported 'mapped' with 0 stale entries while an arbitrary fraction of its declared scope has never been classified. Confirmed empirically at this SHA: 197 of 422 tracked files unledgered and 11 ledger rows naming files deleted in 3f3065d. |
| **[SI-1](../concerns.md#si-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [SI-1](../concerns.md#si-1) in **B-03**. |
| **[SI-2](../concerns.md#si-2)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [SI-2](../concerns.md#si-2) in **B-03**. |
| **[TB-1](../concerns.md#tb-1)** | unresolved-competition | code-verified | 🔗 | Code shape makes [TB-1](../concerns.md#tb-1) plausible in **B-03**, but runtime or domain evidence is required before confirmation. |
| **[TR-1](../concerns.md#tr-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [TR-1](../concerns.md#tr-1) in **B-03**. |
| **[TR-2](../concerns.md#tr-2)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [TR-2](../concerns.md#tr-2) in **B-03**. |
| **[VG-1](../concerns.md#vg-1)** | confirmed-bug | code-verified |  | The entries table holds the schema's only staleness columns and is never written by the server; the sole INSERT in the repository is a Python test fixture. Every consumer of staleness therefore reads an empty source: detect_changes marks zero rows, get_stale_backlog returns empty, clear_staleness is inert, and the dashboard's stale_entries is pinned at 0. Verified live at this SHA — detect_changes reported five stale subsystems and the backlog and dashboard both reported none immediately after. |

## Findings

### [B03-1](../findings.md#b03-1) · 🟠 HIGH · fixed

**Symptom**: A subsystem can report status 'mapped' with zero stale entries while an arbitrary fraction of its declared scope has never been classified, and while ledger rows continue to assert that deleted files were examined.  
**Root cause**: The refresh path never reconciles the file ledger against the working tree. detect_changes inner-joins the commit-range diff against file_ledger, so paths added since the baseline match no row and are silently dropped; no ledger writer enumerates the tree; the scoping-to-structural invariant checks only that at least one ledger row exists; and no classification value or non-destructive tool can retire a row whose file was deleted.

_Business context_: Coverage completeness is the core product claim: the conspectus exists so a reader can trust that a 'mapped' subsystem was actually surveyed. Because the completeness signal is computed from survey status rather than from scope coverage, the dashboard reports full coverage in exactly the state where it is least true. Observed at 5694080 before this refresh: 197 of 422 tracked files (47%) carried no ledger row and 11 rows named files deleted in 3f3065d, while the dashboard reported 7 of 7 mapped and 0 stale. The drift accumulates silently across releases and is only visible to someone who reconciles the ledger by hand.

**Primary files**:
- `mcp-server/src/tools/git.ts:detect_changes@5694080`
- `mcp-server/src/tools/files.ts:add_files_to_scope@5694080`
- `mcp-server/src/invariants.ts:enforcePhasePrerequisites@5694080`
- `mcp-server/src/tools/subsystems.ts:reset_subsystem@5694080`

### [B03-2](../findings.md#b03-2) · 🟠 HIGH · fixed

**Symptom**: The entire staleness surface is inert. detect_changes reports drift to its caller but persists none of it, get_stale_backlog always returns empty, clear_staleness has nothing to clear, and the dashboard's stale_entries is permanently 0 regardless of how far the conspectus has drifted from HEAD.  
**Root cause**: All staleness state lives in the entries table, and no server code path ever inserts a row into it. The only INSERT INTO entries in the repository is in materializer/test-readback.py, a test fixture. Every read and update of staleness therefore operates on a permanently empty table.

_Business context_: Staleness is the mechanism by which a living conspectus is supposed to admit that it has fallen behind the code. Because the gate can never turn red, the product's freshness claim is unfalsifiable: a conspectus 23 commits and 197 unclassified files behind HEAD reports the same clean dashboard as one surveyed at HEAD this minute. This is a zero-denominator green — the gate passes because nothing can ever populate it, not because the state is healthy. It also masks [B03-1](../findings.md#b03-1): the reviewer sees stale_entries 0 and has no signal prompting a manual reconciliation.

**Primary files**:
- `mcp-server/src/schema.sql:entries@5694080`
- `mcp-server/src/tools/git.ts:detect_changes@5694080`
- `mcp-server/src/tools/dashboard.ts:get_dashboard@5694080`
- `mcp-server/src/tools/stale.ts:clear_staleness@5694080`

### [B03-3](../findings.md#b03-3) · 🟡 MEDIUM · fixed

**Symptom**: A disposition whose strongest supporting evidence is test-observed, config-asserted, or doc-asserted cannot record that quality; set_disposition rejects the value, forcing the agent to overstate it as code-verified or understate it as contract-stated.  
**Root cause**: The EVIDENCE_QUALITY enum in tools/dispositions.ts lists five values while the KINDS enum in tools/evidence.ts lists nine, and the [B-01](b01-survey-methodology-and-agent-contracts.md) methodology contract publishes an eight-rung ladder as the authoritative evidence-quality scale. The two vocabularies were allowed to diverge, and nothing checks them against each other or against the published contract.

_Business context_: The methodology names overstating evidence quality as the single most common way it fails, and the evidence ladder is the mechanism meant to prevent that. Here the substrate makes the rule unfollowable in exactly the case that matters most — an agent that actually ran a test and wants to say so. The bias is systematic and one-directional in practice: code-verified is the nearest acceptable value and reads as stronger, so executed-test evidence is silently promoted to code-read evidence across the corpus. Because dispositions are the primary durable record of concern verdicts, this corrupts the quality signal a later reader uses to decide how far to trust a verdict.

**Primary files**:
- `mcp-server/src/tools/dispositions.ts:EVIDENCE_QUALITY@5694080`
- `mcp-server/src/tools/evidence.ts:KINDS@5694080`
- `.claude/skills/amanuensis/SKILL.md:evidence kind ladder@5694080`

### [B03-4](../findings.md#b03-4) · 🔵 LOW · confirmed-bug

**Symptom**: A scoped file whose content is identical to what was examined can be reported stale indefinitely, because staleness is decided by whether its path appeared in a commit range rather than by whether its content changed.  
**Root cause**: The drift predicate in detect_changes tests path membership in the lastSha..currentSha diff and only null-checks the row's ref_sha, never comparing content at that commit against the current one. Nothing clears stale except an explicit clear_staleness, so a path touched and reverted — or touched on a branch later deleted — remains flagged against unchanged content.

_Business context_: The failure is conservative — it over-reports obligation and never under-reports, so unlike [B03-2](../findings.md#b03-2) it cannot manufacture false confidence, and a reader acting on it re-examines a file that did not need it. It matters because the metric it inflates is the headline repair of this release: the commit that introduced the exemption filter is titled 'Count staleness as obligation, not as churn', and the count is still partly churn. Two such rows exist on this repository at adc4ce0 from a probe branch that no longer exists. Making ref_sha load-bearing also needs a reachability fallback, since clear_staleness can store a sha that later becomes unreachable.

**Primary files**:
- `mcp-server/src/tools/git.ts:detect_changes@adc4ce0`

## Related subsystems

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-03** | → | **[B-04](b04-diff-aware-materializer.md)** | data-flow | confirmed | Staleness flows from **B-03**'s detect_changes into [B-04](b04-diff-aware-materializer.md)'s staleness_map projection via the entries table (seam [SM-09](../seams.md#sm-09)). Because no writer inserts rows, the defect propagates from an inert internal metric ([B03-2](../findings.md#b03-2)) into a published freshness claim in the primary reading surface ([B04-1](../findings.md#b04-1)). |

## Seams

| Seam | Shared object | Other party |
|---|---|---|
| **[SM-01](../seams.md#sm-01)** | MCP tool protocol and survey phase contract | **[B-01](b01-survey-methodology-and-agent-contracts.md)** |
| **[SM-02](../seams.md#sm-02)** | ServerContext and memory.db | **[B-02](b02-mcp-core-persistence-and-lifecycle.md)** |
| **[SM-03](../seams.md#sm-03)** | materialize_docs subprocess and storage/docs projection | **[B-04](b04-diff-aware-materializer.md)** |
| **[SM-09](../seams.md#sm-09)** | entries table (staleness columns: stale, stale_since, stale_reason) | **[B-04](b04-diff-aware-materializer.md)** |

## Survey notes

# **B-03** · Knowledge tools and workflow API

- Survey revision: `b8b566f`
- Status: adversarial pass complete; packaging pending

## Key types

`ToolDefinition` couples a tool name, JSON input schema, description, and synchronous handler (`mcp-server/src/helpers.ts:ToolDefinition@b8b566f`). Tool families expose project/session, Git state, subsystem/file scope, concerns/dispositions/evidence/findings, seams, artifacts/materialization, diagnosticity, dispatch/reconciliation, logging, and comparison (`mcp-server/src/index.ts:allTools@b8b566f`).

## State containers

Handlers share [B-02](b02-mcp-core-persistence-and-lifecycle.md)'s `ServerContext` and write normalized SQLite tables. Important lifecycle state includes artifact content hashes, advisory write locks, open questions, dispatch/land/scored rows, and evidence link tables (`mcp-server/src/schema.sql:artifacts@b8b566f`; `mcp-server/src/schema.sql:open_questions@b8b566f`).

## Data flows

1. Session and scope tools authorize a phase and establish the file ledger.
2. Evidence is inserted independently, then linked to dispositions/findings by role.
3. Status transitions query durable prerequisites before granting deeper claim authority.
4. `materialize_docs` invokes [B-04](b04-diff-aware-materializer.md) against the same storage directory and returns a structured summary.
5. Dashboard/comparison tools read the record without mutating claim authority.

Evidence: `mcp-server/src/tools/evidence.ts:add_evidence@b8b566f`; `mcp-server/src/tools/dispositions.ts:set_disposition@b8b566f`; `mcp-server/src/tools/materialize.ts:materialize_docs@b8b566f`.

## Concurrency model

Handlers are synchronous inside one Node process. SQLite supplies database locking across processes; artifact locks are explicit rows. `materialize_docs` is a blocking child process with no timeout in the handler (`mcp-server/src/tools/materialize.ts:materialize_docs@b8b566f`).

## Seam contracts

- **[SM-01](../seams.md#sm-01) · [B-01](b01-survey-methodology-and-agent-contracts.md) ↔ **B-03**:** tool schemas and invariant failures realize the survey protocol.
- **[SM-02](../seams.md#sm-02) · [B-02](b02-mcp-core-persistence-and-lifecycle.md) ↔ **B-03**:** tools consume one `ServerContext` and the canonical schema.
- **[SM-03](../seams.md#sm-03) · **B-03** ↔ [B-04](b04-diff-aware-materializer.md):** a Python subprocess reads durable storage and writes the docs projection; non-zero exit is returned as failure.

## Concern dispositions

All active concerns are terminally covered. The unbounded materializer child is retained as an unresolved competition pending fault injection rather than assigned severity from code shape alone. The WAL/Git phase-gate defect is owned and confirmed in [B-02](b02-mcp-core-persistence-and-lifecycle.md). Tool schema validation and SQL-identifier checks are compensating mechanisms for [SC-1](../concerns.md#sc-1)/[TR-1](../concerns.md#tr-1).

## Adversarial review

The pass looked for handlers that could write higher-depth claims without a session or subsystem state. The principal write paths call `requireActiveSession`, and dispositions/findings additionally call `requireSubsystemStatus`; tests deliberately exercise premature writes (`mcp-server/src/invariants.ts:requireSubsystemStatus@b8b566f`; `mcp-server/test-invariants.mjs:knowledge-depth cases@b8b566f`). Verdict: upheld for covered handlers; schema-wide coverage remains enforced by the inventory/check scripts rather than inferred.
