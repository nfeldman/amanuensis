# **B-05** — Packaging, installer, validation, and product docs

**Status**: 🟢 mapped  
**Layer**: delivery

## Scope

mcp-server/src/cli.ts, mcp-server/scripts/**, tests/config/package metadata, .github/**, README/CONTRIBUTING/ROADMAP/dev, and workspace MCP config.

## Start here

mcp-server/src/cli.ts; .github/workflows/test.yml; CONTRIBUTING.md

## Notes

Owns install/config merge, generated package mirrors, CI gates, and public product contract.

## File ledger

| Path | Classification | Why in scope | Ref SHA |
|---|---|---|---|
| `.github/workflows/published-smoke.yml` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `.github/workflows/test.yml` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `.mcp.json` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `CONTRIBUTING.md` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
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
| `mcp-server/test-installer.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-invariants.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-perf-ceilings.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-perf-tier2.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-perf.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-priority.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-smoke.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/test-storage-git.mjs` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
| `mcp-server/tsconfig.json` | examined | Pinned A0 inventory assigns this file to **B-05**. | `b8b566f` |
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
| **[TR-2](../concerns.md#tr-2)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [TR-2](../concerns.md#tr-2) in **B-05**. |

## Seams

| Seam | Shared object | Other party |
|---|---|---|
| **[SM-04](../seams.md#sm-04)** | packaged agent and reference mirrors | **[B-01](b01-survey-methodology-and-agent-contracts.md)** |
| **[SM-05](../seams.md#sm-05)** | packaged Python materializer mirror | **[B-04](b04-diff-aware-materializer.md)** |

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
