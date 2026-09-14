# Not yet surveyed

Counted at `7c1c1a9f5689` on `main`.

## Paths with no ledger row

**0 of 106** tracked paths are named by no `file_ledger` row in any subsystem. They participate in no subsystem's scope, so nothing here has been read, excluded, or deferred.

## Files in scope that no one has read

**20 of 104** ledger rows that carry a survey obligation are classified `candidate`: the file participates in its subsystem and no one has read it.

### Survey methodology and agent contracts **[B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)** — 4 unread of 16 rows carrying an obligation

- `.claude/skills/amanuensis/references/artifact-templates.md` — Prose artifact formats. Read for existence and role.
- `.claude/skills/amanuensis/references/memory-audit.md` — The hygiene sweep route. Not exercised this pass.
- `.claude/skills/amanuensis/references/reporting-style.md` — The IA/UI boundary and register rules. Read for existence and role, not audited against the projection.
- `.claude/skills/amanuensis/references/setup.md` — MCP wiring shapes for each client. Read in the skill-reference inventory's context rather than surveyed.

### Knowledge tools and workflow API **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** — 6 unread of 20 rows carrying an obligation

- `mcp-server/src/tools/composition.ts` — Exact fan-in and the integral HEAD lane. Read for shape only.
- `mcp-server/src/tools/contradictions.ts` — First-class contradiction rows. Read for shape only.
- `mcp-server/src/tools/diagnosticity.ts` — Competing-concern matrices. Read for shape only.
- `mcp-server/src/tools/impact.ts` — Change impact and claim invalidation on file change. Read for shape only.
- `mcp-server/src/tools/refresh.ts` — Unattended refresh custody: dispatch and landing boundaries, obligation reconciliation. Read for shape only; its recovery contract was not exercised.
- `mcp-server/src/tools/review-analysis.ts` — Independent review passes, blinding and null controls. Read for shape only.

### Materializer: human projection, read-back, HTML **[B-05](subsystems/b05-materializer-human-projection-read-back-html.md)** — 3 unread of 11 rows carrying an obligation

- `materializer/amanuensis_materializer/diagrams.py` — Deterministic embedded runtime-boundary diagrams. Read for shape only.
- `materializer/amanuensis_materializer/html_projection.py` — 3155 lines of HTML projection. Read for structure only.
- `materializer/amanuensis_materializer/renderers.py` — 3744 lines of Markdown rendering. Read for page-plan structure only; individual renderers were not read.

### Packaging, installer, and host activation **[B-06](subsystems/b06-packaging-installer-and-host-activation.md)** — 1 unread of 12 rows carrying an obligation

- `mcp-server/scripts/historical-evaluation.mjs` — The historical-evaluation instrument. Read for shape only.

### Gates, evidence custody, and CI **[B-07](subsystems/b07-gates-evidence-custody-and-ci.md)** — 3 unread of 14 rows carrying an obligation

- `dev/check-living-conspectus.mjs` — The A0 historical fixture checker. Read for contract only; the fixture is immutable and out of this rebuild's scope.
- `dev/test-activation-evidence.mjs` — The one dev gate not referenced in .github/workflows/test.yml. Read to establish that fact, not its contract.
- `dev/test-amanuensis-pecia-defects.mjs` — Exits 2 rather than passing when the pecia CLI is absent. Read for that property only.

### Records: design, research, published projection, execution ledger **[B-08](subsystems/b08-records-design-research-published-projection-execution-ledger.md)** — 3 unread of 14 rows carrying an obligation

- `ROADMAP.md` — Generated from dev/roadmap.json under a drift check. Read for its generated status only.
- `dev/roadmap.json` — The canonical roadmap source. Read for its role, not its content.
- `docs/index.html` — The committed projection's entry page — a generated artifact under a byte-match gate, republished by this rebuild rather than surveyed.

## Subsystems set aside

**0 of 8** subsystems are deferred. `deferred` is not a rung on the survey ladder but an orthogonal do-not-survey flag, so nothing in them has been surveyed at any depth.

## Seam sides no one has assessed

**0 of 20** (seam, side) pairs carry no recorded assessment. The unit is the pair, not the seam: a seam assessed from one side only is half-known, and counting seams would report it as covered.

Binding: per-party-proxy; no seam-bound disposition is recorded. An `SC-%` disposition says a party has assessed some seam concern, never that it assessed this seam.

## Concerns no one has dispositioned here

**60 of 240** (subsystem, active concern) pairs carry no disposition. The unit is the pair: a concern dispositioned somewhere else says nothing about this subsystem, and counting concern codes would report a checklist as complete while most regions were never tested against it.

| Subsystem | Undispositioned | Concerns |
|---|---|---|
| [Survey methodology and agent contracts](subsystems/b01-survey-methodology-and-agent-contracts.md) **[B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)** | 9 of 30 | **[SC-1](concerns.md#sc-1)**, **[SC-10](concerns.md#sc-10)**, **[SC-2](concerns.md#sc-2)**, **[SC-3](concerns.md#sc-3)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-6](concerns.md#sc-6)**, **[SC-7](concerns.md#sc-7)**, **[SC-9](concerns.md#sc-9)** |
| [Server core: repository binding, storage, schema, lifecycle](subsystems/b02-server-core-repository-binding-storage-schema-lifecycle.md) **[B-02](subsystems/b02-server-core-repository-binding-storage-schema-lifecycle.md)** | 5 of 30 | **[SC-10](concerns.md#sc-10)**, **[SC-5](concerns.md#sc-5)**, **[SC-6](concerns.md#sc-6)**, **[SC-7](concerns.md#sc-7)**, **[SC-8](concerns.md#sc-8)** |
| [Knowledge tools and workflow API](subsystems/b03-knowledge-tools-and-workflow-api.md) **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)** | 6 of 30 | **[SC-2](concerns.md#sc-2)**, **[SC-3](concerns.md#sc-3)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-7](concerns.md#sc-7)**, **[SC-9](concerns.md#sc-9)** |
| [Reader lenses: standing, locus account, claims, edges, vocabulary](subsystems/b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md) **[B-04](subsystems/b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)** | 7 of 30 | **[SC-1](concerns.md#sc-1)**, **[SC-10](concerns.md#sc-10)**, **[SC-3](concerns.md#sc-3)**, **[SC-4](concerns.md#sc-4)**, **[SC-7](concerns.md#sc-7)**, **[SC-8](concerns.md#sc-8)**, **[SC-9](concerns.md#sc-9)** |
| [Materializer: human projection, read-back, HTML](subsystems/b05-materializer-human-projection-read-back-html.md) **[B-05](subsystems/b05-materializer-human-projection-read-back-html.md)** | 7 of 30 | **[SC-1](concerns.md#sc-1)**, **[SC-10](concerns.md#sc-10)**, **[SC-2](concerns.md#sc-2)**, **[SC-3](concerns.md#sc-3)**, **[SC-6](concerns.md#sc-6)**, **[SC-8](concerns.md#sc-8)**, **[SC-9](concerns.md#sc-9)** |
| [Packaging, installer, and host activation](subsystems/b06-packaging-installer-and-host-activation.md) **[B-06](subsystems/b06-packaging-installer-and-host-activation.md)** | 9 of 30 | **[SC-1](concerns.md#sc-1)**, **[SC-10](concerns.md#sc-10)**, **[SC-2](concerns.md#sc-2)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-6](concerns.md#sc-6)**, **[SC-7](concerns.md#sc-7)**, **[SC-8](concerns.md#sc-8)**, **[SC-9](concerns.md#sc-9)** |
| [Gates, evidence custody, and CI](subsystems/b07-gates-evidence-custody-and-ci.md) **[B-07](subsystems/b07-gates-evidence-custody-and-ci.md)** | 9 of 30 | **[SC-1](concerns.md#sc-1)**, **[SC-10](concerns.md#sc-10)**, **[SC-2](concerns.md#sc-2)**, **[SC-3](concerns.md#sc-3)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-6](concerns.md#sc-6)**, **[SC-7](concerns.md#sc-7)**, **[SC-8](concerns.md#sc-8)** |
| [Records: design, research, published projection, execution ledger](subsystems/b08-records-design-research-published-projection-execution-ledger.md) **[B-08](subsystems/b08-records-design-research-published-projection-execution-ledger.md)** | 8 of 30 | **[SC-1](concerns.md#sc-1)**, **[SC-2](concerns.md#sc-2)**, **[SC-3](concerns.md#sc-3)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-6](concerns.md#sc-6)**, **[SC-8](concerns.md#sc-8)**, **[SC-9](concerns.md#sc-9)** |

