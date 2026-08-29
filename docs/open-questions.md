# Open questions

_Items the autoprogress coordinator could not decide without human input. Each entry records the question, what the agent could not do because of it, and what assumption (if any) the agent proceeded with. Close out via `resolve_open_question` once answered; the reviewer's answers can feed back into a `reset_subsystem` + re-survey if the assumption turned out wrong._

## Open (9)

### Domain Knowledge (2)

#### #6 · subsystem `B-03` · phase `Refresh 2026-08-27`

> Is the typed claims surface (ADR-0002) intended to be populated automatically by the survey workflow, or only by explicit agent calls to add_claim? The answer determines whether [B03-2](findings.md#b03-2) is a broken migration or an unadopted-but-working successor.

- **What this blocked:** claims, claim_validity_events, and revalidation_obligations are all empty in this project's own conspectus, and the code does not state whether that is expected.
- **Assumption the agent proceeded with:** Treated [B03-2](findings.md#b03-2) as a defect in the shipped freshness path regardless of the answer, because detect_changes still writes to entries and get_dashboard still publishes stale_entries as a current health signal. If the claims surface is opt-in by design, the fix is narrower: retire or rewire the stale_entries metric rather than populate entries.
- _recorded 2026-08-28 02:10 UTC_

#### #5 · subsystem `B-06` · phase `B-06 Phase 2`

> What privacy and persistence policy should govern optional device-local trail pinning in production?

- **What this blocked:** The validation report explicitly leaves the production policy unresolved.
- **Assumption the agent proceeded with:** Keep trail pinning optional, explicitly device-local, clearable, and outside required route recovery until a product policy is accepted.
- _recorded 2026-08-23 05:55 UTC_

### Scope Judgment (2)

#### #12 · subsystem `B-08` · phase `Release prep 2026-08-28`

> Should the A22 live-configuration pin be replaced with property checks, or re-baselined by another real-host campaign, before v0.2.0-beta.2 is cut?

- **What this blocked:** A25 was successfully re-measured against the repaired startup path — 6/6 real-host runs, all digests matching, configuration byte-identical — but the A26 candidate suite then failed on the A22 checker, which pins the developer's whole live ~/.codex/config.toml by sha256. That file has drifted since 2026-08-26 for reasons beyond harness residue, and no backup on the machine still holds the pinned value.
- **Assumption the agent proceeded with:** Stopped rather than running a sixth real-host campaign, since re-baselining A22 by that route would pin the configuration again and reproduce the same fragility at the next unrelated change. Recorded the coupling as finding [B08-1](findings.md#b08-1) and left the branch carrying the genuine progress — the re-measured A25 receipt and its captures, plus refreshed A22 source digests — with the version reverted to 0.2.0-beta.1 so the tree stays internally consistent. Treat [B08-1](findings.md#b08-1) as the gate on beta.2 rather than anything about the activation claim itself, which the re-measurement supports.
- _recorded 2026-08-28 23:00 UTC_

#### #10 · subsystem `B-08` · phase `Refresh 2026-08-27 Phase 1`

> Should dev/adr/** stay wholly in [B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md) (documentation delivery), or should ADR-0021 follow [B-08](subsystems/b08-activation-evidence-and-release-readiness-harness.md) and the remaining ADRs be split toward the subsystems whose design they govern?

- **What this blocked:** The twenty ADRs map almost one-to-one onto [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)'s new tool modules, so they read as design evidence for [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) rather than product documentation; but they are authored docs and [B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md) owns the documentation surface.
- **Assumption the agent proceeded with:** Ledgered all twenty general ADRs under [B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md) and only ADR-0021 under [B-08](subsystems/b08-activation-evidence-and-release-readiness-harness.md), on the grounds that the charter ADR is inseparable from the activation program it authorizes. Cross-references were recorded in each ADR's why_in_scope naming the module it backs, so the mapping survives whichever way the question is answered.
- _recorded 2026-08-28 02:19 UTC_

### Ambiguous Evidence (3)

#### #9 · subsystem `B-03` · phase `Refresh 2026-08-27`

> Do [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)'s sixteen b8b566f concern dispositions extend to the seventeen tool modules added since onboarding, which no concern pass has ever examined?

- **What this blocked:** [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)'s concern pass ran when mcp-server/src/tools held 24 modules; it now holds 41. The dispositions are recorded at subsystem granularity, so they read as covering the whole subsystem while resting on evidence from roughly half of it.
- **Assumption the agent proceeded with:** Treated the seventeen new modules as unassessed for concern coverage and left their ledger classification at 'candidate' rather than promoting them to 'examined'. Any claim that a concern is dispositioned for [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md) should be read as applying only to the modules present at b8b566f until a concern pass runs over the remainder.
- _recorded 2026-08-28 02:13 UTC_

#### #8 · subsystem `B-02` · phase `Refresh 2026-08-27`

> Which of the concern dispositions still anchored at b8b566f remain valid at 5694080, given that project.ts and index.ts were substantially rewritten between those commits?

- **What this blocked:** This refresh re-verified only the concerns whose evidence most clearly moved ([EP-2](concerns.md#ep-2), [SI-1](concerns.md#si-1), [AT-2](concerns.md#at-2), [TB-1](concerns.md#tb-1)). [AT-1](concerns.md#at-1), [CC-1](concerns.md#cc-1), [CR-1](concerns.md#cr-1), [EP-1](concerns.md#ep-1), [IF-1](concerns.md#if-1), [RL-1](concerns.md#rl-1), [RL-2](concerns.md#rl-2), [SC-1](concerns.md#sc-1), [SC-2](concerns.md#sc-2), [SI-2](concerns.md#si-2), [TR-1](concerns.md#tr-1), and [TR-2](concerns.md#tr-2) still carry evidence gathered at the onboarding SHA, and concern [SI-2](concerns.md#si-2) explicitly forbids reusing evidence from another revision as current.
- **Assumption the agent proceeded with:** Left those dispositions at their recorded b8b566f ref_sha rather than silently re-anchoring them, so their staleness is visible in the record. Treat any b8b566f-anchored claim about [B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md) as speculative with respect to current behavior until re-verified. [CR-1](concerns.md#cr-1) and [RL-1](concerns.md#rl-1) are the highest priority: the new staging, publish-race, and abandoned-stage-cleanup paths bear directly on them.
- _recorded 2026-08-28 02:13 UTC_

#### #4 · subsystem `B-06` · phase `B-06 Phase 2`

> What production gate and owner will close the remaining forced-colors, zoom, screen-reader order, print-pagination, and representative-reader validation limits?

- **What this blocked:** No owner or closing run is recorded in the design corpus.
- **Assumption the agent proceeded with:** Treat these as explicit pre-production obligations; do not infer accessibility or reader-performance conformance from the current structural and visual checks.
- _recorded 2026-08-23 05:55 UTC_

### Tooling Limit (2)

#### #11 · subsystem `B-08` · phase `Release prep 2026-08-28`

> Who runs the A25 real-host campaign needed to land the [B02-2](findings.md#b02-2) timeouts and cut v0.2.0-beta.2?

- **What this blocked:** [B02-2](findings.md#b02-2)'s repair edits mcp-server/src/project.ts, which is one of the ten files the A25 operating-envelope receipt binds by sha256 and one of the twenty-three in the A26 candidate manifest. Both checkers correctly report 'source custody digest drifted' and turn red, and both run in CI. Re-measuring requires dev/run-activation-operating-envelope.mjs --execute against Codex-trusted temporary repositories, which needs host trust this session cannot grant, followed by dev/cleanup-activation-operating-trust.mjs to remove the trust records Codex persists.
- **Assumption the agent proceeded with:** Did not bypass either gate or revert the fix. The [B02-2](findings.md#b02-2) work is verified and preserved on branch codex/b02-2-startup-bounds at 8c779e1, where both red gates pass; the branch heading to main carries A1-A3 and [B03-3](findings.md#b03-3) only, and its custody gates are green. The codex-host.ts ps timeout travels with the project.ts change rather than landing alone, so [B02-2](findings.md#b02-2) stays one atomic repair. v0.2.0-beta.2 cannot be cut until A25 and A26 are re-measured, because the roadmap release gate requires an A26 receipt naming the candidate version.
- _recorded 2026-08-28 20:05 UTC_

#### #7 · subsystem `B-01` · phase `Refresh 2026-08-27`

> How should the 11 [B-01](subsystems/b01-survey-methodology-and-agent-contracts.md) ledger rows for agents/** — deleted in 3f3065d — be retired without discarding [B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)'s survey record?

- **What this blocked:** No classification value expresses 'absent from the repository', and the only tool that deletes ledger rows is reset_subsystem to unmapped/scoping, which in the same transaction deletes [B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)'s dispositions, findings, field notes, xrefs, and artifacts.
- **Assumption the agent proceeded with:** Left the 11 rows in place rather than resetting [B-01](subsystems/b01-survey-methodology-and-agent-contracts.md), and recorded the gap under finding [B03-1](findings.md#b03-1). [B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)'s scope and jump_in_reading were rewritten in this refresh so they no longer direct a reader to deleted files.
- _recorded 2026-08-28 02:10 UTC_

## Resolved (3)

| # | Category | Question | Resolution | Answer |
|---|---|---|---|---|
| #1 | scope-judgment | For the A0 definition of fully surveyed, should every tracked repository file be assigned/excluded, including tests, generated dist files, prompts, and product documentation? | answered | For the immutable A0 fixture at b8b566f, yes: every tracked file is assigned or explicitly excluded, and any generated surface is admitted only with its generator/drift contract. This answer is historical-fixture scope only; it does not claim the live conspectus inventories current HEAD. |
| #2 | priority-ranking | Should Codex MCP registration become a supported installer target alongside VS Code MCP configuration? | answered | No under the currently accepted installer contract. The shipped installer owns VS Code MCP configuration; Codex registration is unsupported until a separate portable configuration contract and accepted product decision add it. The v2.10 reconciliation did not expand installer scope. |
| #3 | ambiguous-evidence | Is a phase checkpoint intended to version the SQLite database itself, or only prose artifacts while SQLite durability relies on WAL? | answered | A phase checkpoint is intended to version all durable survey state, including SQLite. The handler now checkpoints the live WAL connection before staging memory.db, and [B02-1](findings.md#b02-1) is verified-fixed by evidence 24 at 457e1c1. |

