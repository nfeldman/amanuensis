# **B-04** — Diff-aware materializer

**Status**: 🟢 mapped  
**Layer**: projection

## Scope

materializer/**; read-only DB access, page planning/rendering, manifest dependency hashes, xref resolution, and clean documentation output.

## Start here

materializer/amanuensis_materializer/core.py; materializer/amanuensis_materializer/renderers.py; materializer/test-materializer.py

## Notes

Derived-artifact correctness boundary.

## File ledger

| Path | Classification | Why in scope | Ref SHA |
|---|---|---|---|
| `materializer/.gitignore` | examined | Pinned A0 inventory assigns this file to **B-04**. | `b8b566f` |
| `materializer/README.md` | examined | Pinned A0 inventory assigns this file to **B-04**. | `b8b566f` |
| `materializer/amanuensis_materializer/__init__.py` | examined | Pinned A0 inventory assigns this file to **B-04**. | `b8b566f` |
| `materializer/amanuensis_materializer/core.py` | examined | Pinned A0 inventory assigns this file to **B-04**. | `b8b566f` |
| `materializer/amanuensis_materializer/db.py` | examined | Pinned A0 inventory assigns this file to **B-04**. | `b8b566f` |
| `materializer/amanuensis_materializer/diagrams.py` | examined | Pinned A0 inventory assigns this file to **B-04**. | `b8b566f` |
| `materializer/amanuensis_materializer/manifest.py` | examined | Pinned A0 inventory assigns this file to **B-04**. | `b8b566f` |
| `materializer/amanuensis_materializer/renderers.py` | examined | Pinned A0 inventory assigns this file to **B-04**. | `b8b566f` |
| `materializer/amanuensis_materializer/slugs.py` | examined | Pinned A0 inventory assigns this file to **B-04**. | `b8b566f` |
| `materializer/amanuensis_materializer/xref.py` | examined | Pinned A0 inventory assigns this file to **B-04**. | `b8b566f` |
| `materializer/materialize.py` | examined | Pinned A0 inventory assigns this file to **B-04**. | `b8b566f` |
| `materializer/pyproject.toml` | examined | Pinned A0 inventory assigns this file to **B-04**. | `b8b566f` |
| `materializer/test-materializer.py` | examined | Pinned A0 inventory assigns this file to **B-04**. | `b8b566f` |

## Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AT-1](../concerns.md#at-1)** | unresolved-competition | code-verified | 🔗 | Code shape makes [AT-1](../concerns.md#at-1) plausible in **B-04**, but runtime or domain evidence is required before confirmation. |
| **[AT-2](../concerns.md#at-2)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [AT-2](../concerns.md#at-2) in **B-04**. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [CC-1](../concerns.md#cc-1) in **B-04**. |
| **[CR-1](../concerns.md#cr-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [CR-1](../concerns.md#cr-1) in **B-04**. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [EP-1](../concerns.md#ep-1) in **B-04**. |
| **[EP-2](../concerns.md#ep-2)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [EP-2](../concerns.md#ep-2) in **B-04**. |
| **[IF-1](../concerns.md#if-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [IF-1](../concerns.md#if-1) in **B-04**. |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [RL-1](../concerns.md#rl-1) in **B-04**. |
| **[RL-2](../concerns.md#rl-2)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [RL-2](../concerns.md#rl-2) in **B-04**. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified |  | [SM-03](../seams.md#sm-03) integral contract was read from both mapped endpoints and passed at the pinned revision; residuals remain separately visible. |
| **[SC-2](../concerns.md#sc-2)** | confirmed-acceptable | code-verified |  | [SM-05](../seams.md#sm-05) integral contract was read from both mapped endpoints and passed at the pinned revision; residuals remain separately visible. |
| **[SC-3](../concerns.md#sc-3)** | confirmed-acceptable | code-verified |  | **B-04** implements the refined [B-06](b06-report-interface-design-and-validation-studies.md) coverage index with retained semantic matrix, contextual identifier definitions, and prose-flow thresholds; integration and failure/read-back gates pass. |
| **[SI-1](../concerns.md#si-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [SI-1](../concerns.md#si-1) in **B-04**. |
| **[SI-2](../concerns.md#si-2)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [SI-2](../concerns.md#si-2) in **B-04**. |
| **[TB-1](../concerns.md#tb-1)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [TB-1](../concerns.md#tb-1) in **B-04**. |
| **[TR-1](../concerns.md#tr-1)** | confirmed-acceptable | code-verified |  | The structural and behavioral read supports confirmed-acceptable for [TR-1](../concerns.md#tr-1) in **B-04**. |
| **[TR-2](../concerns.md#tr-2)** | out-of-scope | code-verified |  | The structural and behavioral read supports out-of-scope for [TR-2](../concerns.md#tr-2) in **B-04**. |

## Seams

| Seam | Shared object | Other party |
|---|---|---|
| **[SM-03](../seams.md#sm-03)** | materialize_docs subprocess and storage/docs projection | **[B-03](b03-knowledge-tools-and-workflow-api.md)** |
| **[SM-05](../seams.md#sm-05)** | packaged Python materializer mirror | **[B-05](b05-packaging-installer-validation-and-product-docs.md)** |
| **[SM-06](../seams.md#sm-06)** | report projection design/component contract | **[B-06](b06-report-interface-design-and-validation-studies.md)** |

## Survey notes

# **B-04** · Diff-aware materializer

- Survey revision: `b8b566f`
- Status: adversarial pass complete; packaging pending

## Key types

`Materializer` plans and renders the documentation site, `PagePlan` binds a page to its sources/renderer, `Summary` reports the run, and `Manifest`/`PageManifest` retain source and content hashes (`materializer/amanuensis_materializer/core.py:Materializer@b8b566f`; `materializer/amanuensis_materializer/manifest.py:Manifest@b8b566f`). `XrefIndex` resolves IDs into relative links after rendering (`materializer/amanuensis_materializer/xref.py:XrefIndex@b8b566f`).

## State containers

- Read-only SQLite connection: durable survey source, one materialization run (`materializer/amanuensis_materializer/db.py:open_ro@b8b566f`).
- `.manifest.json`: per-page source hashes, output hash, and render timestamp; persistent projection metadata (`materializer/amanuensis_materializer/manifest.py:Manifest.save@b8b566f`).
- `.materializer-lock`: excludes concurrent writers for the output directory (`materializer/amanuensis_materializer/core.py:Materializer@b8b566f`).
- `docs/`: derived Markdown projection; never the durable survey authority.

## Data flow

The CLI resolves storage/output, opens the database read-only, builds page plans from aggregate and subsystem renderers, compares stable source hashes to the previous manifest, renders affected pages, resolves cross-references, prunes retired pages, saves the new manifest, and prints a JSON summary (`materializer/materialize.py:main@b8b566f`; `materializer/amanuensis_materializer/core.py:Materializer.run@b8b566f`).

## Concurrency model

One process owns an output-directory lock. Database access is read-only. File updates and final manifest persistence are sequential; the manifest warns and rebuilds on corrupt JSON (`materializer/amanuensis_materializer/manifest.py:Manifest.load@b8b566f`).

## Seam contracts

- **[SM-03](../seams.md#sm-03) · [B-03](b03-knowledge-tools-and-workflow-api.md) ↔ **B-04**:** [B-03](b03-knowledge-tools-and-workflow-api.md) supplies storage/output and treats process exit as the operation result; **B-04** reads `memory.db` plus registered prose and writes only the derived output tree.
- **[SM-05](../seams.md#sm-05) · **B-04** ↔ [B-05](b05-packaging-installer-validation-and-product-docs.md):** packaging copies the root materializer as the published mirror.

## Concern dispositions

All active concerns are covered. Incremental/full parity is exercised by repeated and forced renders. Corrupt-manifest recovery is visible via warnings. Multi-file projection atomicity remains an unresolved competition: the lock prevents concurrent writers, but a killed process may leave some page files updated before the manifest is saved. It is not promoted to a confirmed defect without a kill-point control.

## Adversarial review

The pass tried to disprove diff-awareness by finding a change source absent from page plans. Tests cover unchanged runs, prose changes, disposition changes, retired pages, and forced full output (`materializer/test-materializer.py:main@b8b566f`). The baseline A0 clean-export checker adds independent state, coverage, and content read-back. Verdict: incremental contract upheld for the observed source classes; generator correctness still needs independent accept-corpus evidence.
