# **B-08** — Activation evidence and release-readiness harness

**Status**: 🟢 mapped  
**Layer**: delivery evidence

## Scope

dev/activation-evidence/**, the dev/ activation and friction-free release harness scripts (run-/check-/test-/capture-/cleanup-/adopt-/render-), mcp-server/fixtures/activation/**, the mcp-server activation and binding tests, dev/adr/0021, dev/friction-free-release-checklist.md, and dev/release-notes-v0.2.0-beta.1.md; the A19-A26 program that produced and gates the v0.2.0-beta.1 activation claim.

## Start here

dev/adr/0021-friction-free-codex-activation.md; dev/check-friction-free-release-readiness.mjs; dev/activation-evidence/a26-release-readiness.json

## Notes

Created during the 2026-08-27 full refresh. Distinct evidence corpus in the pattern of [B-06](b06-report-interface-design-and-validation-studies.md) (design evidence) and [B-07](b07-embedded-research-surveys-and-platform-trials.md) (research evidence): captured host transcripts are generated witnesses, while the checkers, red-gate suites, and receipts are authored instruments. Runtime code it exercises lives in [B-02](b02-mcp-core-persistence-and-lifecycle.md) (codex-host.ts, project.ts) and [B-05](b05-packaging-installer-validation-and-product-docs.md) (cli.ts) — claims about enforcement must cross to those subsystems.

## File ledger

| Path | Classification | Why in scope | Ref SHA |
|---|---|---|---|
| `dev/activation-evidence/a19-user-scoped-contract.json` | candidate | A19 receipt: user-scoped installation contract. | `5694080` |
| `dev/activation-evidence/a20-activation-doctor.json` | candidate | A20 receipt: activation diagnosis output. | `5694080` |
| `dev/activation-evidence/a21-immutable-workspace-binding.json` | candidate | A21 receipt: immutable workspace binding. | `5694080` |
| `dev/activation-evidence/a22-codex-host.json` | candidate | A22 receipt: real Codex host activation evidence. | `5694080` |
| `dev/activation-evidence/a22-host-runs/parent-cd-recovery.json` | candidate | A22 structured host-run summary for parent --cd recovery. | `5694080` |
| `dev/activation-evidence/a22-host-runs/stale-process-cwd.sanitization.json` | candidate | A22 sanitization record for the stale-process-cwd transcript. | `5694080` |
| `dev/activation-evidence/a22-host-runs/storage-readback.json` | candidate | A22 storage read-back witness for cross-repository containment. | `5694080` |
| `dev/activation-evidence/a23-zero-touch-lifecycle.json` | candidate | A23 receipt: lazy first-use lifecycle. | `5694080` |
| `dev/activation-evidence/a24-package-parity.json` | candidate | A24 receipt: source vs package activation parity. | `5694080` |
| `dev/activation-evidence/a25-activation-operating-envelope.json` | candidate | A25 receipt: stratified activation operating envelope. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-a-root.store-custody.json` | candidate | A25 storage custody witness for repository A. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-b-root.store-custody.json` | candidate | A25 storage custody witness for repository B. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-c-nested.store-custody.json` | candidate | A25 storage custody witness for the nested repository case. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-d-root.store-custody.json` | candidate | A25 storage custody witness for repository D root. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-d-worktree.store-custody.json` | candidate | A25 storage custody witness for the worktree case. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-e-parent-cd.store-custody.json` | candidate | A25 storage custody witness for the parent --cd case. | `5694080` |
| `dev/activation-evidence/a26-candidate-suite.json` | candidate | A26 receipt: prepublication candidate suite. | `5694080` |
| `dev/activation-evidence/a26-clean-replay.json` | candidate | A26 receipt: clean-replay reproduction of the release gate. | `5694080` |
| `dev/activation-evidence/a26-release-readiness-red-gates.json` | candidate | A26 receipt: red-gate proof that the readiness gate can fail. | `5694080` |
| `dev/adopt-codex-host-evidence.mjs` | candidate | Authored adoption step promoting captured host runs into receipts. | `5694080` |
| `dev/capture-activation-launch.mjs` | candidate | Authored launch-audit capture used by the envelope runner. | `5694080` |
| `dev/check-activation-operating-envelope.mjs` | candidate | Authored checker validating the A25 envelope receipt. | `5694080` |
| `dev/cleanup-activation-operating-trust.mjs` | candidate | Authored trust-state cleanup for A25 runs; portability of its temp root was changed in 3270cac. | `5694080` |
| `dev/cleanup-codex-host-trust.mjs` | candidate | Authored trust-state cleanup for A22 host runs. | `5694080` |
| `dev/friction-free-release-checklist.md` | candidate | Authored human checklist for the friction-free release. | `5694080` |
| `dev/refresh-a22-evidence.mjs` | candidate | Authored refresh path for A22 evidence. | `5694080` |
| `dev/release-notes-v0.2.0-beta.1.md` | candidate | Authored release notes for the beta candidate this program gates. | `5694080` |
| `dev/render-friction-free-release-readiness.mjs` | candidate | Authored renderer projecting the readiness receipt for humans. | `5694080` |
| `dev/run-activation-operating-envelope.mjs` | candidate | Authored A25 stratified operating-envelope runner. | `5694080` |
| `dev/run-codex-parent-cd-evidence.mjs` | candidate | Authored harness for the parent --cd recovery case. | `5694080` |
| `dev/run-friction-free-candidate-suite.mjs` | candidate | Authored A26 prepublication candidate suite runner. | `5694080` |
| `dev/run-friction-free-release-replay.mjs` | candidate | Authored A26 clean-replay runner. | `5694080` |
| `dev/test-activation-evidence.mjs` | candidate | Authored test over activation evidence receipts. | `5694080` |
| `dev/test-activation-operating-envelope-red-gates.mjs` | candidate | Red-gate suite proving the A25 envelope checker can fail. | `5694080` |
| `dev/test-activation-operating-trust-cleanup.mjs` | candidate | Test covering A25 trust cleanup. | `5694080` |
| `dev/test-codex-host-evidence-red-gates.mjs` | candidate | Red-gate suite proving the A22 checker can fail. | `5694080` |
| `dev/test-friction-free-release-readiness-red-gates.mjs` | candidate | Red-gate suite proving the A26 readiness gate can fail. | `5694080` |
| `dev/test-package-activation-parity-red-gates.mjs` | candidate | Red-gate suite proving the A24 parity checker can fail. | `5694080` |
| `mcp-server/fixtures/activation/codex-context-probe.mjs` | candidate | Fixture probe used to observe Codex launch context. | `5694080` |
| `mcp-server/fixtures/activation/codex-host-red-matrix.json` | candidate | Negative-case matrix for the A22 checker. | `5694080` |
| `mcp-server/fixtures/activation/conflicting-user-project.json` | candidate | Fixture for conflicting user and project registrations. | `5694080` |
| `mcp-server/fixtures/activation/first-use-interruption.json` | candidate | Fixture for interrupted first-use recovery. | `5694080` |
| `mcp-server/fixtures/activation/first-use-worker.mjs` | candidate | Fixture worker exercising lazy first-use lifecycle. | `5694080` |
| `mcp-server/fixtures/activation/hard-coded-global-project-local.json` | candidate | Fixture reproducing the hard-coded global registration defect ADR-0021 names. | `5694080` |
| `mcp-server/fixtures/activation/operating-envelope-red-matrix.json` | candidate | Negative-case matrix for the A25 envelope checker. | `5694080` |
| `mcp-server/fixtures/activation/package-parity.json` | candidate | Fixture for source vs package activation parity. | `5694080` |
| `mcp-server/fixtures/activation/release-readiness-red-matrix.json` | candidate | Negative-case matrix for the A26 readiness gate. | `5694080` |
| `mcp-server/fixtures/activation/storage-symlink-escape.json` | candidate | Fixture for storage containment against symlink escape. | `5694080` |
| `mcp-server/test-activation-contract.mjs` | candidate | Test of the activation registration contract. | `5694080` |
| `mcp-server/test-activation-doctor.mjs` | candidate | Test of the A20 activation diagnosis path. | `5694080` |
| `mcp-server/test-codex-parent-workspace.mjs` | candidate | Test of codex-host.ts parent workspace resolution. | `5694080` |
| `mcp-server/test-first-use-laziness.mjs` | candidate | Test that no project state is created before first stateful use. | `5694080` |
| `mcp-server/test-first-use-recovery.mjs` | candidate | Test of interrupted first-use recovery. | `5694080` |
| `mcp-server/test-nested-activation-binding.mjs` | candidate | Test of nested-repository binding resolution. | `5694080` |
| `mcp-server/test-operating-envelope.mjs` | candidate | Test of the stratified operating envelope. | `5694080` |
| `mcp-server/test-package-activation-parity.mjs` | candidate | Test of source vs published-package activation parity. | `5694080` |
| `mcp-server/test-release-rollback.mjs` | candidate | Test of release rollback behavior. | `5694080` |
| `mcp-server/test-workspace-binding.mjs` | candidate | Test of immutable per-process workspace binding. | `5694080` |
| `dev/activation-evidence/a26-release-readiness.json` | examined | A26 receipt: release-readiness gate result with sha256 source custody. | `5694080` |
| `dev/adr/0021-friction-free-codex-activation.md` | examined | Charter ADR defining the friction-free activation decision and acceptance boundary for A19-A26. | `5694080` |
| `dev/check-codex-host-evidence.mjs` | examined | Authored checker validating A22 host receipts. | `5694080` |
| `dev/check-friction-free-release-readiness.mjs` | examined | Authored checker gating the v0.2.0-beta.1 release-readiness claim. | `5694080` |
| `dev/run-codex-host-harness.mjs` | examined | Authored harness that drives real Codex hosts and emits the A22 transcripts. | `5694080` |
| `mcp-server/fixtures/activation/codex-config-healthy.toml` | examined | Control fixture: a healthy live Codex configuration that also carries an unrelated MCP server and an ordinary project trust entry, proving both are tolerated. | `aba6d04` |
| `mcp-server/fixtures/activation/codex-config-residual-trust.toml` | examined | Negative fixture: harness trust surviving cleanup. | `aba6d04` |
| `mcp-server/fixtures/activation/codex-config-shadowed.toml` | examined | Negative fixture: duplicate Amanuensis registration. | `aba6d04` |
| `mcp-server/fixtures/activation/codex-config-workspace-pinned.toml` | examined | Negative fixture: registration pinning a repository via --workspace. | `aba6d04` |
| `mcp-server/test-startup-bounds.mjs` | examined | Red gates proving no probe on the activation path runs unbounded; the [B02-2](../findings.md#b02-2) repair. | `aba6d04` |
| `dev/activation-evidence/a22-host-runs/configuration-conflict.jsonl` | generated-ignore | Captured Codex host transcript emitted by dev/run-codex-host-harness.mjs. | `5694080` |
| `dev/activation-evidence/a22-host-runs/configuration-conflict.stderr.log` | generated-ignore | Captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a22-host-runs/interrupted-a.jsonl` | generated-ignore | Captured Codex host transcript. | `5694080` |
| `dev/activation-evidence/a22-host-runs/interrupted-a.stderr.log` | generated-ignore | Captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a22-host-runs/parent-cd-recovery.jsonl` | generated-ignore | Captured Codex host transcript. | `5694080` |
| `dev/activation-evidence/a22-host-runs/parent-cd-recovery.stderr.log` | generated-ignore | Captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a22-host-runs/repository-a-resume.jsonl` | generated-ignore | Captured Codex host transcript. | `5694080` |
| `dev/activation-evidence/a22-host-runs/repository-a-resume.stderr.log` | generated-ignore | Captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a22-host-runs/repository-a.jsonl` | generated-ignore | Captured Codex host transcript. | `5694080` |
| `dev/activation-evidence/a22-host-runs/repository-a.stderr.log` | generated-ignore | Captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a22-host-runs/repository-b.jsonl` | generated-ignore | Captured Codex host transcript. | `5694080` |
| `dev/activation-evidence/a22-host-runs/repository-b.stderr.log` | generated-ignore | Captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a22-host-runs/stale-process-cwd.jsonl` | generated-ignore | Captured Codex host transcript. | `5694080` |
| `dev/activation-evidence/a22-host-runs/stale-process-cwd.stderr.log` | generated-ignore | Captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a22-host-runs/worktree-a.jsonl` | generated-ignore | Captured Codex host transcript. | `5694080` |
| `dev/activation-evidence/a22-host-runs/worktree-a.stderr.log` | generated-ignore | Captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-negative-config.jsonl` | generated-ignore | A25 captured host transcript emitted by dev/run-activation-operating-envelope.mjs. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-negative-config.launch-audit.jsonl` | generated-ignore | A25 launch audit stream. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-negative-config.stderr.log` | generated-ignore | A25 captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-a-root.jsonl` | generated-ignore | A25 captured host transcript. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-a-root.stderr.log` | generated-ignore | A25 captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-b-root.jsonl` | generated-ignore | A25 captured host transcript. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-b-root.stderr.log` | generated-ignore | A25 captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-c-nested.jsonl` | generated-ignore | A25 captured host transcript. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-c-nested.stderr.log` | generated-ignore | A25 captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-d-root.jsonl` | generated-ignore | A25 captured host transcript. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-d-root.stderr.log` | generated-ignore | A25 captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-d-worktree.jsonl` | generated-ignore | A25 captured host transcript for the worktree case. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-d-worktree.stderr.log` | generated-ignore | A25 captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-e-parent-cd.jsonl` | generated-ignore | A25 captured host transcript for the parent --cd case. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-26T17-16-03-446Z-c435874d-repo-e-parent-cd.stderr.log` | generated-ignore | A25 captured host stderr stream. | `5694080` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-negative-config.jsonl` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-negative-config.launch-audit.jsonl` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-negative-config.stderr.log` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-a-root.jsonl` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-a-root.stderr.log` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-a-root.store-custody.json` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-b-root.jsonl` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-b-root.stderr.log` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-b-root.store-custody.json` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-c-nested.jsonl` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-c-nested.stderr.log` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-c-nested.store-custody.json` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-d-root.jsonl` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-d-root.stderr.log` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-d-root.store-custody.json` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-d-worktree.jsonl` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-d-worktree.stderr.log` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-d-worktree.store-custody.json` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-e-parent-cd.jsonl` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-e-parent-cd.stderr.log` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |
| `dev/activation-evidence/a25-host-runs/a25-2026-08-28T22-52-43-706Z-e0b75e9d-repo-e-parent-cd.store-custody.json` | generated-ignore | Captured Codex host transcript from the 2026-08-28 A25 re-measurement. | `aba6d04` |

## Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[SI-2](../concerns.md#si-2)** | confirmed-acceptable | code-verified |  | Receipts bind to an explicit baselineCommit and implementationCommit and carry sha256 digests for their declared source files, and the checker re-hashes those files off the working tree rather than trusting the recorded digest. Independently recomputed during this refresh: all six digests match at 5694080 and implementationCommit db00515 is an ancestor of HEAD. A receipt cannot silently be reused as current evidence after its sources change. Recording note: partly test-observed, recorded at the nearest permitted rung per finding [B03-3](../findings.md#b03-3). |
| **[TB-1](../concerns.md#tb-1)** | confirmed-acceptable | code-verified |  | Both host-driving harnesses wrap their child processes in an explicit timer that is cleared on completion, so a stalled Codex host terminates with a recorded outcome rather than hanging the evidence run. This is the discipline [TB-1](../concerns.md#tb-1) asks for. It also sharpens finding [B02-2](../findings.md#b02-2): the evidence apparatus bounds its subprocesses while the production activation path it certifies does not. |
| **[VG-1](../concerns.md#vg-1)** | ruled-out | code-verified |  | Every gate in this subsystem was executed during the refresh and each showed a green control alongside a complete set of nonzero sabotage exits: A26 readiness 4/4, A22 Codex host evidence 4/4, A25 operating envelope 3/3, and A24 package parity halting on both packed-cwd and skill-version drift. The gates have non-zero denominators and turn red on demand — the direct contrast to [B-03](b03-knowledge-tools-and-workflow-api.md) and [B-04](b04-diff-aware-materializer.md), where this concern is a confirmed bug. Recording note: the attached evidence is test-observed, but set_disposition does not accept that value (finding [B03-3](../findings.md#b03-3)), so it is recorded here at the nearest permitted rung. |

## Findings

### [B08-1](../findings.md#b08-1) · 🟡 MEDIUM · fixed

**Symptom**: Release readiness depends on the byte state of the user's live ~/.codex/config.toml. Once that file changes for any reason, the A22 checker reports drift permanently, the A26 candidate suite fails, and no release can be cut until another real-host A22 campaign rebaselines the pin.  
**Root cause**: The A22 receipt records host.configSha256Before/After and configurationCustody.restoredConfigSha256 for the developer's own Codex configuration, and check-codex-host-evidence compares the live file against them. That file is user-level and mutable independently of this repository, so the pin is a snapshot of something the project does not own and cannot hold still. dev/refresh-a22-evidence.mjs rebaselines the fourteen source digests but not the config pin, leaving no cheap recovery.

_Business context_: This is what blocked v0.2.0-beta.2 after A25 had been successfully re-measured. The A25 campaign landed 6/6 real-host runs against the repaired startup path and left the configuration byte-identical, so the activation claim itself is sound; the release still could not proceed because an unrelated pin on a user-level file had drifted since 2026-08-26. The coupling also makes the gate weaker than it looks: it turns red for ordinary local activity while telling the reader that host evidence drifted, which is a different and more alarming claim. A developer on another machine could never satisfy it at all.

**Primary files**:
- `dev/activation-evidence/a22-codex-host.json:host.configSha256Before@8c779e1`
- `dev/check-codex-host-evidence.mjs:live configuration check@8c779e1`
- `dev/run-friction-free-candidate-suite.mjs:A22 gate@8c779e1`

## Survey notes

# **B-08** — Activation evidence and release-readiness harness

**Status:** structural → concerns (2026-08-27 refresh)
**Anchored at:** `5694080`
**Layer:** delivery evidence

## What this subsystem is

The A19–A26 program that produced, and now gates, the v0.2.0-beta.1 activation
claim. It is an evidence corpus plus the authored instruments that generate and
verify it — not runtime production code. The runtime it exercises lives in [B-02](b02-mcp-core-persistence-and-lifecycle.md)
(`project.ts`, `codex-host.ts`) and [B-05](b05-packaging-installer-validation-and-product-docs.md) (`cli.ts`); claims about enforcement
must cross to those subsystems.

Created during the 2026-08-27 full refresh. Before that refresh none of its 94
files carried a ledger row.

## Observed structure

Three tiers, deliberately separated in the file ledger:

| Tier | Classification | Contents |
|---|---|---|
| Authored instruments | `examined` / `candidate` | `dev/run-*`, `dev/check-*`, `dev/test-*-red-gates`, `dev/cleanup-*`, `mcp-server/fixtures/activation/**` |
| Receipts | `candidate` / `examined` | `dev/activation-evidence/a19..a26*.json` |
| Captured witnesses | `generated-ignore` | `dev/activation-evidence/a2{2,5}-host-runs/*.jsonl`, `*.stderr.log` |

`dev/adr/0021-friction-free-codex-activation.md` is the charter. Its acceptance
boundary is explicit: after one user-scoped installation and one host restart, a
fresh trusted repository must resolve its own Git root, create no project state
until first use, and begin a workflow without another setup command — with two
concurrent repositories retaining distinct storage and zero cross-repository
writes. It also states that parsing generated TOML is necessary but insufficient,
which is why the host-run corpus exists.

## Observed facts (verified at 5694080)

- **The gates are falsifiable.** All four red-gate suites were executed during
  this refresh. Each reported a green control and a full set of nonzero
  sabotage exits: A26 readiness 4/4, A22 Codex host evidence 4/4, A25 operating
  envelope 3/3, A24 package parity halting on both packed-cwd and skill-version
  drift. (evidence 69)
- **The claim is content-bound and revision-bound.** The A26 receipt carries a
  `baselineCommit`, an `implementationCommit`, and sha256 digests for six source
  files; `check-friction-free-release-readiness.mjs` re-hashes each file off the
  working tree and fails on drift. Recomputed independently here: all six match
  at `5694080`, and `implementationCommit` `db00515` is an ancestor of HEAD.
  The real receipt validates: "7/7 initiatives, 6 repository results".
  (evidence 70)
- **Subprocesses are bounded.** Both host-driving harnesses wrap their children
  in an explicit timer cleared on completion. (evidence 71)

## Inference

The separation of generated witnesses from authored instruments is what makes
the corpus auditable: a reader can tell which files are claims and which are
transcripts. Combined with red-gate proofs and off-disk digest verification,
this subsystem meets the falsifiability standard that [B-03](b03-knowledge-tools-and-workflow-api.md)'s staleness surface
and [B-04](b04-diff-aware-materializer.md)'s freshness sentence do not (findings [B03-2](../findings.md#b03-2), [B04-1](../findings.md#b04-1)).

## Tension worth recording

The harnesses bound their subprocesses; the production activation path they
certify does not. Finding [B02-2](../findings.md#b02-2) records six unbounded `git` calls and one
unbounded `ps` probe on the startup path. The evidence apparatus is more
disciplined than the runtime it measures.

## Open questions

- Whether `dev/adr/**` belongs to [B-05](b05-packaging-installer-validation-and-product-docs.md) (documentation delivery) or should be
  split, with ADR-0021 following **B-08**. Recorded as a scope-judgment call;
  ADRs currently sit in [B-05](b05-packaging-installer-validation-and-product-docs.md).
