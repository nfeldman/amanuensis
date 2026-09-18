# **B-05** — Packaging, installer, validation, and product docs

**Status**: 🟡 concerns  
**Layer**: Delivery

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server packaging, checkers, fixtures and test suite; .github/**; .pecia/**; the dev/ harness that is not a lane's; root product artifacts

## Start here

mcp-server/src/cli.ts; .github/workflows/test.yml; CONTRIBUTING.md; mcp-server/scripts/

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-05/contracts/generate-or-assert-every-duplicated-fact` | `B-05` | The checker set in mcp-server/scripts/ is organized around one rule: a fact published twice is either generated from one source or asserted against it. gen-vocabulary.mjs generates two enum modules and asserts the schema's CHECKs; gen-tool-inventory.mjs generates DEVELOPMENT.md's block and --check refuses a divergence; check-refusal-parity.mjs cannot generate prose so it generates the candidate refusal set and compares that against a register; check-concern-checklist.mjs holds the calibrated checklist to its contract. Where a duplicated fact has neither a generator nor an assertion, it drifts — which is what B05-2 is. | Inference | `c0734040022f` |

## Vocabulary

- **generated copy, asserted schema** — This repository's rule for a fact published in more than one place: generate every copy that can be generated, and assert the one that cannot rather than rewriting it.

## Known defects here

1 defect here is open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- The server identifies itself to every MCP host as 0.2.0-beta.1 while the package it ships from is 0.2.0-beta.2, and stamps that wrong version into the immutable binding receipt the setup documentation tells users to read back when verifying an installation. — [B05-R1](../findings.md#b05-r1) · 🟡 MEDIUM · Open

## Standing

**Concerns** — Structural mapping is complete and concern-by-concern review is in progress. It cannot justify that a finding survived adversarial challenge.

| Metric | Value |
|---|---|
| Files read | 88 of 154 ledger rows |
| Files in scope, not yet read | 65 of 154 |
| Files excluded from the survey obligation | 1 of 154 |
| Ledger rows the repository has changed under | 4 of 154 |
| Active concerns with a disposition recorded here | 1 of 12 — 1 confirmed-bug |
| Findings by resolution state | 1 open |
| Seams assessable from both sides | no seam names this subsystem |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-64a8983657"></a>`mcp-server/test-activation-contract.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-19aa5d891a"></a>`mcp-server/test-activation-doctor.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-5aa5225fb8"></a>`mcp-server/test-adversarial-correctness.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-105f9875a5"></a>`mcp-server/test-adversarial-performance.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-94a7ff5615"></a>`mcp-server/test-adversarial-security.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-8231c0b17f"></a>`mcp-server/test-attention-history.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-6e2867fe0b"></a>`mcp-server/test-autoprogress.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-266e756c8c"></a>`mcp-server/test-carried-findings.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-5f7eb5d68f"></a>`mcp-server/test-change-impact.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-f03a3ce504"></a>`mcp-server/test-chorusmith-adapter.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-a761dd6f02"></a>`mcp-server/test-cloud-e2e.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-565935c892"></a>`mcp-server/test-cloud-storage.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-d61cc4b7f6"></a>`mcp-server/test-codebase-brief.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-746e0cfbab"></a>`mcp-server/test-codex-parent-workspace.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-4d983fef8c"></a>`mcp-server/test-compare.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-63b8d45ccc"></a>`mcp-server/test-composition.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-054fe5d600"></a>`mcp-server/test-consumer-route.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-87a86a59b3"></a>`mcp-server/test-crosswalk-qualification.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-d6fb67fadd"></a>`mcp-server/test-decisions.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-7c7b81d869"></a>`mcp-server/test-derived-staleness.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-6b0afee912"></a>`mcp-server/test-design-session.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-ce5c7211ca"></a>`mcp-server/test-disposition-evidence.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-1d1fa0dd1e"></a>`mcp-server/test-edge-contract.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-d71de5a069"></a>`mcp-server/test-existing-store-migration.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-eae63e762a"></a>`mcp-server/test-finding-partition.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-412f31aabb"></a>`mcp-server/test-first-use-laziness.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-2218638605"></a>`mcp-server/test-first-use-recovery.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-aea866485a"></a>`mcp-server/test-historical-evaluation.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-edbb880904"></a>`mcp-server/test-installer.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-2b9b868fff"></a>`mcp-server/test-invariants.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-83a40c2056"></a>`mcp-server/test-learning-ledger.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-65566a0862"></a>`mcp-server/test-locus-compactness.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-6ed416af60"></a>`mcp-server/test-locus-index-view.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-751d36c7d4"></a>`mcp-server/test-locus-standing.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-222f754475"></a>`mcp-server/test-mcp-compatibility.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-989c1f0415"></a>`mcp-server/test-nested-activation-binding.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-dc84f3a2ab"></a>`mcp-server/test-operating-envelope.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-9ca8cfec7e"></a>`mcp-server/test-package-activation-parity.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-00604160be"></a>`mcp-server/test-package-artifact.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-5dc9dc9507"></a>`mcp-server/test-perf-ceilings.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-90d0fbe49b"></a>`mcp-server/test-perf-tier2.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-830ea13c08"></a>`mcp-server/test-perf.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-059f32e098"></a>`mcp-server/test-phase2-claims-gate.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-d68b404524"></a>`mcp-server/test-priority.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-e0e6e6e5d9"></a>`mcp-server/test-projection-custody.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-708a135f37"></a>`mcp-server/test-refresh-recovery.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-d082e92394"></a>`mcp-server/test-refusal-parity.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-b867c5be2f"></a>`mcp-server/test-release-rollback.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-c01e8ac234"></a>`mcp-server/test-research-broker.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-d20f1bb5b3"></a>`mcp-server/test-residual-hardening.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-ac865b771e"></a>`mcp-server/test-resolution-proof.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-628b239bf3"></a>`mcp-server/test-revalidation-scheduler.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-4133590a18"></a>`mcp-server/test-review-analysis.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-5e28e6fd06"></a>`mcp-server/test-review-brief.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-8a10c5166e"></a>`mcp-server/test-review-session.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-b4bb46c944"></a>`mcp-server/test-scope-reconciliation.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-a1342c1ab3"></a>`mcp-server/test-smoke.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-6c42e25d8d"></a>`mcp-server/test-startup-bounds.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-c5242d809d"></a>`mcp-server/test-storage-git.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-1ac915c09d"></a>`mcp-server/test-structural-claims.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-996c8d9035"></a>`mcp-server/test-temporal-claims.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-dd0fce72cf"></a>`mcp-server/test-vocabulary-discharge.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-80b9cab913"></a>`mcp-server/test-vocabulary-source.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-ebdfbb3cfc"></a>`mcp-server/test-workspace-binding.mjs` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-9c91991914"></a>`mcp-server/tsconfig.json` | candidate | Packaging, configuration, fixtures, checkers and the server's own test suite. | `a7f9384d` |
| <a id="le-f55c3d9a96"></a>`.github/FUNDING.yml` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-93f283a230"></a>`.github/workflows/pages.yml` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-934e7538b8"></a>`.github/workflows/publish.yml` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-4271f9070c"></a>`.github/workflows/published-smoke.yml` | examined | The published-tarball smoke job named in B05-2's root cause: it asserts the binding receipt's canonicalRoot and storage_path and never asserts the reported server version. | `c0734040` |
| <a id="le-71fbb7b0fb"></a>`.github/workflows/test.yml` | examined | The CI registration of every gate this lane ships, including GATE D0's three-state block and GATE D1 beside it. | `c0734040` |
| <a id="le-77e0d693fa"></a>`.gitignore` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-662f11f38b"></a>`.mcp.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-e3123e5c9f"></a>`.pecia/config.yaml` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-5413b0286b"></a>`.pecia/snapshot.head` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-bdef40c028"></a>`.pecia/snapshot.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-5fcd03e3a4"></a>`.pecia/work.jsonl` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-79244d1ddf"></a>`.tool-versions` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-f4f8cb0763"></a>`CONTRIBUTING.md` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-fc65beb71e"></a>`HISTORY.md` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-2ae149d716"></a>`INSTALLATION.md` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-92b9b267c5"></a>`LICENSE` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-31a487e865"></a>`README.md` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-42e248e1cb"></a>`ROADMAP.md` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-257be3305f"></a>`dev/conspectus/README.md` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-798c28a252"></a>`dev/conspectus/baseline-report-detector-1.0.0.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-b21ec90750"></a>`dev/conspectus/baseline-report.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-e190b2bd3a"></a>`dev/conspectus/detector-registry.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-809af737fc"></a>`dev/conspectus/self-baseline.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-405ad18f5f"></a>`dev/hooks/pre-commit` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-9e304511e2"></a>`dev/render-roadmap.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-c5cc24fa88"></a>`dev/roadmap.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-fcd5a4581d"></a>`dev/survey-depth-baseline.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-390f0c9e45"></a>`dev/test-amanuensis-pecia-defects.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-ed1b9d303f"></a>`dev/test-pecia-roadmap-red-gates.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-b5122252a2"></a>`dev/test-pecia-roadmap.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-afca65075c"></a>`dev/test-roadmap.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-b6124b6738"></a>`mcp-server/.gitignore` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-58e5638e34"></a>`mcp-server/DEVELOPMENT.md` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-995065865c"></a>`mcp-server/README.md` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-5f3891d9ab"></a>`mcp-server/biome.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-49955b2f56"></a>`mcp-server/contracts/activation-parity.schema.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-5796a0162b"></a>`mcp-server/contracts/append-only-tables.txt` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-c539967abb"></a>`mcp-server/contracts/attention.schema.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-7d4cac2f39"></a>`mcp-server/contracts/chorusmith/artifact-input.schema.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-d25d8fe690"></a>`mcp-server/contracts/chorusmith/custody-matrix.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-59809cb346"></a>`mcp-server/contracts/chorusmith/extraction-parity-ledger.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-e14afbf384"></a>`mcp-server/contracts/chorusmith/project-type.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-a557f7880d"></a>`mcp-server/contracts/chorusmith/run-manifest.schema.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-a529c0aaeb"></a>`mcp-server/contracts/codebase-brief.schema.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-894ac2f2dc"></a>`mcp-server/contracts/codebase-decision.schema.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-f73b924c8d"></a>`mcp-server/contracts/concern-checklist.json` | examined | The calibrated checklist and the finding-id convention, moved here so a gate's denominator is not read from the document reporting the coverage. | `c0734040` |
| <a id="le-79b8cf1dc5"></a>`mcp-server/contracts/conspectus-vocabulary.json` | examined | The enum source every generated copy and every SQL CHECK is derived from, including the obligation_bearing flag D2's exempt set comes from. | `c0734040` |
| <a id="le-e5b7f0855c"></a>`mcp-server/contracts/historical-evaluation-corpus.schema.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-d3145f9c21"></a>`mcp-server/contracts/locus-account.schema.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-7351f36a91"></a>`mcp-server/contracts/locus-history.schema.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-5f5f5d12d0"></a>`mcp-server/contracts/refusal-parity.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-c2d1589f28"></a>`mcp-server/contracts/research-request.schema.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-710e35c322"></a>`mcp-server/fixtures/activation/codex-config-healthy.toml` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-54e6612017"></a>`mcp-server/fixtures/activation/codex-config-residual-trust.toml` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-645c2487ec"></a>`mcp-server/fixtures/activation/codex-config-shadowed.toml` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-e49ccc8447"></a>`mcp-server/fixtures/activation/codex-config-workspace-pinned.toml` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-ed76bf2d83"></a>`mcp-server/fixtures/activation/codex-context-probe.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-16a60a42b0"></a>`mcp-server/fixtures/activation/codex-host-red-matrix.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-abfaa97acb"></a>`mcp-server/fixtures/activation/conflicting-user-project.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-a196a23da8"></a>`mcp-server/fixtures/activation/first-use-interruption.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-4fbbbc2f0f"></a>`mcp-server/fixtures/activation/first-use-worker.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-7377244b8c"></a>`mcp-server/fixtures/activation/hard-coded-global-project-local.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-e9619a9e18"></a>`mcp-server/fixtures/activation/operating-envelope-red-matrix.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-f76c211054"></a>`mcp-server/fixtures/activation/package-parity.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-0d9e15dd09"></a>`mcp-server/fixtures/activation/release-readiness-red-matrix.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-57b14bbf44"></a>`mcp-server/fixtures/activation/storage-symlink-escape.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-b9a798f4d1"></a>`mcp-server/fixtures/change-impact/manifest.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-ea8437d5b3"></a>`mcp-server/fixtures/codebase-brief/source-input.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-2bf613ec9e"></a>`mcp-server/fixtures/composition/manifest.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-b34e7d6a71"></a>`mcp-server/fixtures/crosswalk/qualification-result.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-6c31de2de3"></a>`mcp-server/fixtures/evaluation/program.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-bf8ece109b"></a>`mcp-server/fixtures/learning/method-qualification.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-e6bc2c95fc"></a>`mcp-server/fixtures/research/scholiast/version-semantics/claims.md` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-592d928ebc"></a>`mcp-server/fixtures/research/scholiast/version-semantics/sources.md` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-19ddb7b4a8"></a>`mcp-server/fixtures/revalidation/manifest.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-8e69b93183"></a>`mcp-server/fixtures/review-analysis/manifest.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-18d1eed634"></a>`mcp-server/fixtures/review-session/semantic-states.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-fd6d9d5c10"></a>`mcp-server/package.json` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-a8ef18af84"></a>`mcp-server/scripts/check-concern-checklist.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-08348b4626"></a>`mcp-server/scripts/check-evidence-vocabulary.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-865f114b66"></a>`mcp-server/scripts/check-refusal-parity.mjs` | examined | The skill/server refusal register, and the generated candidate set that narrows what an unregistered refusal can hide — with the three sentence forms it can see stated as its own scope limit. | `c0734040` |
| <a id="le-2dc342dbb4"></a>`mcp-server/scripts/check-sql-identifiers.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-d8348e85e1"></a>`mcp-server/scripts/check-tool-schemas.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-9ff6e60fd4"></a>`mcp-server/scripts/ensure-built.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-7d5eace926"></a>`mcp-server/scripts/gen-tool-inventory.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-0c0feac4cb"></a>`mcp-server/scripts/gen-vocabulary.mjs` | examined | The single-source generator: it writes the TypeScript and Python enum modules and asserts the schema's CHECK literals against the contract, and states why the schema is checked rather than rewritten. | `c0734040` |
| <a id="le-d3fca4883b"></a>`mcp-server/scripts/historical-evaluation.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-bdecfca941"></a>`mcp-server/scripts/prepack-bundle-assets.mjs` | examined | Packaging, installer, validation harnesses, contracts, fixtures and product documentation. | `410d769b` |
| <a id="le-ab14f85ccf"></a>`mcp-server/package-lock.json` | generated-ignore | npm writes this lockfile; it is resolver output. | `a7f9384d` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[SC-1](../concerns.md#sc-1)** | confirmed-bug | code-verified |  | This subsystem owns the checkers that hold every other seam, and one seam it owns is unheld: the package manifest's version against the runtime literal. At c073404 they disagree — 0.2.0-beta.2 against 0.2.0-beta.1 — and that literal is frozen into the binding receipt the setup documentation tells a user to read back when verifying an installation. render-roadmap.mjs relates the manifest to the roadmap's release record and published-smoke.yml asserts the receipt's canonicalRoot and storage_path, so both halves exist and neither compares these two. Filed as B05-R1. |

### Survey artifact

#### **B-05** — Packaging, installer, validation, and product docs

Scoping-and-carried-adjudication pass, read at `c073404`. Scope: the mcp-server package,
its checkers, contracts and fixtures, the CI workflows, `.pecia/`, the non-lane `dev/`
harness, and the root product artifacts.

**This pass is partial and says so.** Six of 154 scoped files were read: the two
generator/checker scripts that carry the subsystem's organizing rule, the two CI
workflows that bear on it, and the two contracts they read. The remaining 148 — chiefly
the ~100 `mcp-server/test-*.mjs` suites and the fixture corpora — are scoped and unread,
and the ledger says `candidate` for each. The claim and the concern work below are stated
over what was read.

##### Observed

**One rule, four checkers.** A fact published in more than one place is generated from a
single source or asserted against it: `gen-vocabulary.mjs` writes the TypeScript and
Python enum modules and compares the schema's `CHECK` literals without rewriting them,
because `schema.sql` is applied to live databases on every open;
`gen-tool-inventory.mjs` writes `DEVELOPMENT.md`'s block and `--check` refuses a
divergence; `check-refusal-parity.mjs` cannot generate prose, so it generates the
*candidate refusal set* from the server's own thrown messages and compares that against a
hand-kept register, stating the three sentence forms it can see as its own scope limit.

**Where the rule is not applied, the fact drifts.** `SERVER_VERSION` in `index.ts` is a
literal with no generator and no assertion. At `c073404` it reads `0.2.0-beta.1` while
`package.json` reads `0.2.0-beta.2`, and it is the only source for both the version
advertised at `initialize` and the `serverVersion` frozen into the binding receipt.
Recorded as B05-R1.

##### Seam contracts from this side

- **`contracts/conspectus-vocabulary.json` → `src/vocabulary.ts`, `vocabulary.py`,
  `schema.sql`** — generated, generated, asserted.
- **`tools/list` → `DEVELOPMENT.md`** — generated and `--check`ed.
- **server refusals → the skill references** ([B-01](b01-survey-methodology-and-agent-contracts.md)) — register plus generated candidate
  set.
- **`package.json` → `SERVER_VERSION`** — neither. The open seam.

##### Open

148 of 154 scoped files unread at this pass.
