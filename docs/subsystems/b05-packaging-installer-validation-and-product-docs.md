# **B-05** — Packaging, installer, validation, and product docs

**Status**: 🟢 mapped  
**Layer**: delivery

## Scope

mcp-server/src/cli.ts, mcp-server/scripts/**, the mcp-server test suites and fixtures, package metadata, .github/**, dev/adr/** (ADRs 0001-0020), dev/conspectus/** and the living-conspectus and pecia roadmap gates, README/CONTRIBUTING/ROADMAP/INSTALLATION/HISTORY, and workspace MCP config.

## Start here

mcp-server/src/cli.ts; .github/workflows/test.yml; INSTALLATION.md

## Notes

Owns install/config merge, generated package mirrors, CI gates, and the public product contract. Grew substantially between b8b566f and 5694080: user-scoped Codex installation with activation-contract markers and pre-write diagnosis, twenty ADRs, twenty new test suites, and the INSTALLATION/HISTORY documents. [TR-2](../concerns.md#tr-2) re-assessed at 5694080; the remaining dispositions still carry b8b566f evidence. Seam [SM-10](../seams.md#sm-10) records that setup.md and cli.ts agree today but that nothing machine-checks them.

## File ledger

| Path | Classification | Why in scope | Ref SHA |
|---|---|---|---|
| `.github/workflows/pages.yml` | candidate | Documentation publication workflow. | `5694080` |
| `.github/workflows/publish.yml` | candidate | Release publication workflow. | `5694080` |
| `.gitignore` | candidate | Repository-level exclusion policy affecting what ships and what is tracked. | `5694080` |
| `.tool-versions` | candidate | Toolchain pinning for reproducible builds. | `5694080` |
| `HISTORY.md` | candidate | Public release history added in this refresh range. | `5694080` |
| `dev/adr/0001-living-conspectus-terms.md` | candidate | Architecture decision record for living-conspectus terminology. | `5694080` |
| `dev/adr/0002-temporal-claim-model.md` | candidate | ADR backing the claims tool module. | `5694080` |
| `dev/adr/0003-predict-before-apply-change-impact.md` | candidate | ADR backing the change-impact tool module. | `5694080` |
| `dev/adr/0004-obligation-custody-and-reconciliation.md` | candidate | ADR backing revalidation obligation custody. | `5694080` |
| `dev/adr/0005-resolution-proof-and-projection-readback.md` | candidate | ADR backing resolution proof and projection read-back. | `5694080` |
| `dev/adr/0006-unattended-refresh-authority-and-recovery.md` | candidate | ADR backing the unattended refresh run authority model. | `5694080` |
| `dev/adr/0007-impact-aware-review-brief.md` | candidate | ADR backing the impact-aware review brief. | `5694080` |
| `dev/adr/0008-independent-review-custody-and-blinding.md` | candidate | ADR backing blind review custody. | `5694080` |
| `dev/adr/0009-integral-head-composition-fan-in.md` | candidate | ADR backing exact composition fan-in. | `5694080` |
| `dev/adr/0010-derived-review-surface-and-semantic-readback.md` | candidate | ADR backing the derived review surface. | `5694080` |
| `dev/adr/0011-codebase-brief-contract.md` | candidate | ADR backing the codebase brief contract. | `5694080` |
| `dev/adr/0012-independent-dialectical-design.md` | candidate | ADR backing dialectical design sessions. | `5694080` |
| `dev/adr/0013-decision-acceptance-and-premise-custody.md` | candidate | ADR backing decision acceptance and premise custody. | `5694080` |
| `dev/adr/0014-decision-bounded-research-custody.md` | candidate | ADR backing bounded research custody. | `5694080` |
| `dev/adr/0015-identity-first-crosswalk-and-qualified-methods.md` | candidate | ADR backing the crosswalk identity model. | `5694080` |
| `dev/adr/0016-typed-revisable-learning-ledger.md` | candidate | ADR backing the learning ledger. | `5694080` |
| `dev/adr/0017-stratified-operating-envelope.md` | candidate | ADR backing the stratified operating envelope. | `5694080` |
| `dev/adr/0018-chorusmith-adapter-parity-boundary.md` | candidate | ADR backing the Chorusmith parity boundary. | `5694080` |
| `dev/adr/0019-qualified-natural-history-corpus.md` | candidate | ADR backing the qualified natural-history corpus. | `5694080` |
| `dev/adr/0020-practice-catalog-v2.10-reconciliation.md` | candidate | ADR reconciling the pinned external practice catalog. | `5694080` |
| `dev/check-living-conspectus.mjs` | candidate | Living-conspectus roadmap gate checker. | `5694080` |
| `dev/conspectus/README.md` | candidate | Living-conspectus baseline detector documentation. | `5694080` |
| `dev/conspectus/baseline-report-detector-1.0.0.json` | candidate | Versioned detector baseline report. | `5694080` |
| `dev/conspectus/baseline-report.json` | candidate | Living-conspectus baseline report. | `5694080` |
| `dev/conspectus/detector-registry.json` | candidate | Registry of living-conspectus baseline detectors. | `5694080` |
| `dev/conspectus/self-baseline.json` | candidate | Self-applied baseline measurement. | `5694080` |
| `dev/pecia-dogfood.md` | candidate | Dogfood record for the pecia roadmap workflow. | `5694080` |
| `dev/practice-catalog-v2.10.json` | candidate | Pinned external practice catalog used by ADR-0020 reconciliation. | `5694080` |
| `dev/test-living-conspectus.mjs` | candidate | Test for the living-conspectus gate. | `5694080` |
| `dev/test-pecia-roadmap-red-gates.mjs` | candidate | Red-gate suite proving the pecia roadmap check can fail. | `5694080` |
| `dev/test-pecia-roadmap.mjs` | candidate | Test for the pecia roadmap projection. | `5694080` |
| `mcp-server/fixtures/change-impact/manifest.json` | candidate | Test fixture for change-impact runs. | `5694080` |
| `mcp-server/fixtures/codebase-brief/source-input.json` | candidate | Test fixture for codebase-brief source input. | `5694080` |
| `mcp-server/fixtures/composition/manifest.json` | candidate | Test fixture for composition runs. | `5694080` |
| `mcp-server/fixtures/crosswalk/qualification-result.json` | candidate | Test fixture for crosswalk qualification. | `5694080` |
| `mcp-server/fixtures/evaluation/program.json` | candidate | Test fixture for evaluation programs. | `5694080` |
| `mcp-server/fixtures/learning/method-qualification.json` | candidate | Test fixture for method qualification. | `5694080` |
| `mcp-server/fixtures/research/scholiast/version-semantics/claims.md` | candidate | Test fixture: Scholiast research claims used by the research broker. | `5694080` |
| `mcp-server/fixtures/research/scholiast/version-semantics/sources.md` | candidate | Test fixture: Scholiast research sources used by the research broker. | `5694080` |
| `mcp-server/fixtures/revalidation/manifest.json` | candidate | Test fixture for revalidation runs. | `5694080` |
| `mcp-server/fixtures/review-analysis/manifest.json` | candidate | Test fixture for review analysis. | `5694080` |
| `mcp-server/fixtures/review-session/semantic-states.json` | candidate | Test fixture for review-session semantic states. | `5694080` |
| `mcp-server/scripts/historical-evaluation.mjs` | candidate | Build-time script producing the historical evaluation corpus. | `5694080` |
| `mcp-server/test-change-impact.mjs` | candidate | Test suite for change-impact prediction and application. | `5694080` |
| `mcp-server/test-chorusmith-adapter.mjs` | candidate | Test suite for the Chorusmith adapter parity boundary. | `5694080` |
| `mcp-server/test-codebase-brief.mjs` | candidate | Test suite for the codebase brief contract. | `5694080` |
| `mcp-server/test-composition.mjs` | candidate | Test suite for composition fan-in. | `5694080` |
| `mcp-server/test-crosswalk-qualification.mjs` | candidate | Test suite for crosswalk qualification. | `5694080` |
| `mcp-server/test-decisions.mjs` | candidate | Test suite for decision acceptance. | `5694080` |
| `mcp-server/test-design-session.mjs` | candidate | Test suite for design sessions. | `5694080` |
| `mcp-server/test-historical-evaluation.mjs` | candidate | Test suite for historical evaluation. | `5694080` |
| `mcp-server/test-learning-ledger.mjs` | candidate | Test suite for the learning ledger. | `5694080` |
| `mcp-server/test-mcp-compatibility.mjs` | candidate | Test suite for MCP protocol compatibility. | `5694080` |
| `mcp-server/test-package-artifact.mjs` | candidate | Test suite for the published package artifact. | `5694080` |
| `mcp-server/test-projection-custody.mjs` | candidate | Test suite for projection custody. | `5694080` |
| `mcp-server/test-refresh-recovery.mjs` | candidate | Test suite for unattended refresh recovery. | `5694080` |
| `mcp-server/test-research-broker.mjs` | candidate | Test suite for the research broker. | `5694080` |
| `mcp-server/test-resolution-proof.mjs` | candidate | Test suite for resolution proof. | `5694080` |
| `mcp-server/test-revalidation-scheduler.mjs` | candidate | Test suite for revalidation scheduling. | `5694080` |
| `mcp-server/test-review-analysis.mjs` | candidate | Test suite for review analysis. | `5694080` |
| `mcp-server/test-review-brief.mjs` | candidate | Test suite for the review brief. | `5694080` |
| `mcp-server/test-review-session.mjs` | candidate | Test suite for review session custody and blinding. | `5694080` |
| `mcp-server/test-temporal-claims.mjs` | candidate | Test suite for the claims tool module. | `5694080` |
| `.github/workflows/published-smoke.yml` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `.github/workflows/test.yml` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `.mcp.json` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `CONTRIBUTING.md` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `INSTALLATION.md` | examined | Public installation contract added in this refresh range. | `5694080` |
| `README.md` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `ROADMAP.md` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `dev/cross-domain-analysis.md` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `dev/render-roadmap.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `dev/roadmap.json` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `dev/test-roadmap.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/.gitignore` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/DEVELOPMENT.md` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/README.md` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/biome.json` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/package-lock.json` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/package.json` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/scripts/check-evidence-vocabulary.mjs` | examined | CI guard holding the evidence-quality vocabulary together across add_evidence, set_disposition, and SKILL.md; the substrate fix for [B03-3](../findings.md#b03-3). | `9c53be1` |
| `mcp-server/scripts/check-sql-identifiers.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/scripts/check-tool-schemas.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/scripts/gen-tool-inventory.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/scripts/prepack-bundle-assets.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/src/cli.ts` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-adversarial-correctness.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-adversarial-performance.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-adversarial-security.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-autoprogress.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-cloud-e2e.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-cloud-storage.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-compare.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-derived-staleness.mjs` | examined | Red-gate suite for ledger-derived staleness and scope reconciliation; the A1/A2 gates behind [B03-1](../findings.md#b03-1) and [B03-2](../findings.md#b03-2). | `9c53be1` |
| `mcp-server/test-installer.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-invariants.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-perf-ceilings.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-perf-tier2.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-perf.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-priority.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-smoke.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-storage-git.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/tsconfig.json` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `.pecia/config.yaml` | generated-ignore | Pecia execution-custody projection and its snapshot manifest; tool state regenerated from the local timeline. | `aba6d04` |
| `.pecia/snapshot.head` | generated-ignore | Pecia execution-custody projection and its snapshot manifest; tool state regenerated from the local timeline. | `aba6d04` |
| `.pecia/snapshot.json` | generated-ignore | Pecia execution-custody projection and its snapshot manifest; tool state regenerated from the local timeline. | `aba6d04` |
| `.pecia/work.jsonl` | generated-ignore | Pecia execution-custody projection and its snapshot manifest; tool state regenerated from the local timeline. | `aba6d04` |
| `.github/FUNDING.yml` | irrelevant | Sponsorship metadata does not participate in runtime or survey behavior; retained as a satisfied explicit exclusion. Owner: repository-maintainer. | `b8b566f` |
| `LICENSE` | irrelevant | License text governs distribution but has no executable survey contract; retained as a satisfied explicit exclusion. Owner: repository-maintainer. | `b8b566f` |

## Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AT-1](../concerns.md#at-1)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [AT-1](../concerns.md#at-1) in **B-05**. |
| **[AT-2](../concerns.md#at-2)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [AT-2](../concerns.md#at-2) in **B-05**. |
| **[CC-1](../concerns.md#cc-1)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [CC-1](../concerns.md#cc-1) in **B-05**. |
| **[CR-1](../concerns.md#cr-1)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [CR-1](../concerns.md#cr-1) in **B-05**. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [EP-1](../concerns.md#ep-1) in **B-05**. |
| **[EP-2](../concerns.md#ep-2)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [EP-2](../concerns.md#ep-2) in **B-05**. |
| **[IF-1](../concerns.md#if-1)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [IF-1](../concerns.md#if-1) in **B-05**. |
| **[RL-1](../concerns.md#rl-1)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [RL-1](../concerns.md#rl-1) in **B-05**. |
| **[RL-2](../concerns.md#rl-2)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [RL-2](../concerns.md#rl-2) in **B-05**. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [SC-1](../concerns.md#sc-1) in **B-05**. |
| **[SC-2](../concerns.md#sc-2)** | confirmed-acceptable | code-verified |  | [SM-05](../seams.md#sm-05) integral contract was read from both mapped endpoints and passed at the pinned revision; residuals remain separately visible. |
| **[SI-1](../concerns.md#si-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [SI-1](../concerns.md#si-1) in **B-05**. |
| **[SI-2](../concerns.md#si-2)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [SI-2](../concerns.md#si-2) in **B-05**. |
| **[TB-1](../concerns.md#tb-1)** | unresolved-competition | code-verified | 🔗 | Code shape makes [TB-1](../concerns.md#tb-1) plausible in **B-05**, but runtime or domain evidence is required before confirmation. |
| **[TR-1](../concerns.md#tr-1)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [TR-1](../concerns.md#tr-1) in **B-05**. |
| **[TR-2](../concerns.md#tr-2)** | confirmed-acceptable | code-verified |  | Re-assessed at 5694080; the b8b566f disposition predates the user-scoped installation mode. The installer confines writes through assertSafeRootPath against the scope's own root ($CODEX_HOME for user scope, the workspace for a project pin), rejects --scope user for non-Codex clients, stamps distinct activation-contract markers, and diagnoses unmanaged or shadowing registrations before writing rather than overwriting them. The documented contract in [B-01](b01-survey-methodology-and-agent-contracts.md) setup.md matches this implementation exactly, including the explicit statement that superseded skill copies are not archived. |
| **[VG-1](../concerns.md#vg-1)** | confirmed-bug | code-verified |  | The release gate checks only that roadmap.json and the A26 receipt agree with each other and match field shapes. No assertion resolves the git tag, reads the publish workflow conclusion, or queries the registry, so the publication-status claim has no external denominator and cannot turn red when publication actually occurs. Confirmed at 5694080: the gate passes while asserting not-published for a version npm serves as latest. |

## Findings

### [B05-1](../findings.md#b05-1) · 🟠 HIGH · fixed

**Symptom**: The roadmap and the A26 receipt both assert v0.2.0-beta.1 is an unpublished candidate, while the package is published on npm holding the latest dist-tag. The publication gate cannot detect the discrepancy because nothing checks the registry or the tag.  
**Root cause**: render-roadmap.mjs validates delivery.release only for internal consistency — field shapes, and agreement between roadmap.json and the A26 receipt. It never queries the registry, the git tag, or the publish workflow run. A release that has actually been published therefore satisfies every candidate assertion, including publicationStatus 'not-published', indefinitely.

_Business context_: Two consequences. First, the published record is wrong in the direction that understates exposure: ROADMAP.md tells a reader the beta is authorized but not published, while npm serves it as latest, so anyone installing @gruetech/amanuensis today receives a build carrying [B02-2](../findings.md#b02-2), [B03-1](../findings.md#b03-1), [B03-2](../findings.md#b03-2), [B03-3](../findings.md#b03-3), and [B04-1](../findings.md#b04-1) — including the projection that tells its own readers the conspectus is fresh. Second, the A26 receipt names published npm registry installation as an unsupported stratum on the grounds that publication was not authorized; every real installation now sits in that declared-unsupported stratum. This is the same defect class as [B03-2](../findings.md#b03-2) — a gate whose denominator is structurally empty — applied to the release contract rather than to staleness.

**Primary files**:
- `dev/roadmap.json:delivery.release@5694080`
- `dev/activation-evidence/a26-release-readiness.json:decision@5694080`
- `dev/render-roadmap.mjs:validateEstablishedRelease@5694080`

## Seams

| Seam | Shared object | Other party |
|---|---|---|
| **[SM-04](../seams.md#sm-04)** | packaged agent and reference mirrors | **[B-01](b01-survey-methodology-and-agent-contracts.md)** |
| **[SM-05](../seams.md#sm-05)** | packaged Python materializer mirror | **[B-04](b04-diff-aware-materializer.md)** |
| **[SM-10](../seams.md#sm-10)** | activation contract (installation scope, skill destination, config markers) | **[B-01](b01-survey-methodology-and-agent-contracts.md)** |

## Survey notes

# **B-05** · Packaging, installer, validation, and product docs

- Survey revision: `b8b566f`
- Status: adversarial pass complete; packaging pending

## Key types

The installer models changes as `PlanAction` values, separates `plan` from `applyPlan`, and constructs the server entry installed into host MCP configuration (`mcp-server/src/cli.ts:PlanAction@b8b566f`; `mcp-server/src/cli.ts:plan@b8b566f`). The roadmap JSON is canonical and `render-roadmap.mjs` validates and projects `ROADMAP.md` (`dev/render-roadmap.mjs:validateRoadmap@b8b566f`).

## State containers

- Host MCP configuration and backups: persistent external configuration, mutated only by installer apply.
- `dev/roadmap.json` and `ROADMAP.md`: source/projection pair with a CI drift check.
- Package asset mirrors: generated at prepack from root agents and materializer.
- CI workflow: the fan-in list for roadmap, MCP, installer, adversarial, performance, inventory, and materializer checks.

Evidence: `mcp-server/src/cli.ts:applyPlan@b8b566f`; `mcp-server/scripts/prepack-bundle-assets.mjs:copyTree@b8b566f`; `.github/workflows/test.yml:jobs@b8b566f`.

## Data flows

1. Installer parses flags and existing JSON-with-comments, computes a dry-run-capable plan, backs up overwritten configuration, and applies agent/MCP changes.
2. Prepack copies source assets into package-local generated mirrors before TypeScript compilation.
3. CI installs pinned dependencies, builds, runs schema/tool/invariant/adversarial tests, verifies generated inventories, and runs Python materializer validation.
4. Roadmap edits originate in JSON and are regenerated/read back through `--check`.

## Concurrency model

These are short-lived CLI/CI processes. Installer writes are not designed for concurrent modification of one host config; backups provide recovery. CI jobs are independent and GitHub aggregates job status.

## Seam contracts

- **[SM-04](../seams.md#sm-04) · **B-05** ↔ [B-01](b01-survey-methodology-and-agent-contracts.md):** prepack must copy the source agent and reference bundle consumed by package users.
- **[SM-05](../seams.md#sm-05) · **B-05** ↔ [B-04](b04-diff-aware-materializer.md):** prepack must copy the source Python materializer consumed by `materialize_docs` in installed layouts.

## Concern dispositions

All 16 active concerns have terminal coverage. Installer path/config trust and source/package mirror consistency are applicable and compensated by planning, backup, pack-time generation, installer tests, and published-package smoke tests. The source `.mcp.json` is VS Code/Claude-shaped and does not configure Codex; the current run registered the server in Codex separately. That is a delivery gap, not silently folded into A0 scope.

## Adversarial review

The pass looked for a second editable source of generated docs/assets and for tests absent from CI. `ROADMAP.md` is derived and checked; package mirrors are regenerated at prepack and gitignored; tool inventory has a generator plus `--check` wired in CI (`CONTRIBUTING.md:Generated roadmap@b8b566f`; `CONTRIBUTING.md:Auto-generated tool inventory@b8b566f`). Verdict: mirror contracts upheld at the pinned revision. Clean-export A0 execution is added on the implementation branch because local-only success was not previously a dedicated gate.
