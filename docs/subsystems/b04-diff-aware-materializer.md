# **B-04** — Diff-aware materializer

**Status**: 🟡 adversarial  
**Layer**: Projection

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

materializer/** and the promoted docs/ it renders

## Start here

amanuensis_materializer/core.py; renderers.py; readback.py

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-04/projection/a-refusal-leaves-the-previous-output-untouched` | `B-04` | Every way this renderer can fail leaves the published projection as it was. A missing required view refuses before the plan is built; an unknown nav group refuses before a byte is written; a renderer exception records the traceback and clears ok; a read-back mismatch clears ok; and clean publication renders into a staging directory, promotes only on a green summary, and removes the stage otherwise. The one destructive step — replacing the output directory — is additionally refused while the output holds a file no prior manifest claims. | Observation | `c0734040022f` |

## Vocabulary

- **page plan** — The list of pages the current store requires, computed once per render and used four times over: to decide what to write, what to link, what to navigate, and what the read-back must find.

## Known defects here

2 defects here are open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- The projection read-back's per-row stale-marker expectation set is empty for every real conspectus, so a projection that drops every stale marker still passes that part of the state axis; and the index page's stale reading is drawn from the same dead source. — [B04-R1](../findings.md#b04-r1) · 🟡 MEDIUM · Open
- A clean publish can go red on the read-back's coverage axis with dangling anchors whose only distinguishing property is the length of the record prose beside them: shortening five long rationales returned all seven missing anchors and the next publish was green on all three axes. — [B04-R2](../findings.md#b04-r2) · 🟡 MEDIUM · Open

## Standing

**Adversarial** — Candidate conclusions are being challenged; treat them as provisional. It cannot justify that the challenge pass has finished.

| Metric | Value |
|---|---|
| Files read | 24 of 92 ledger rows |
| Files in scope, not yet read | 0 of 92 |
| Files excluded from the survey obligation | 68 of 92 |
| Ledger rows the repository has changed under | 0 of 92 |
| Active concerns with a disposition recorded here | 12 of 12 — 1 confirmed-bug, 8 confirmed-acceptable, 1 ruled-out, 2 out-of-scope |
| Findings by resolution state | 2 open |
| Seams assessable from both sides | no seam names this subsystem |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-e1695ac22a"></a>`materializer/.gitignore` | examined | Local build state kept out of the tree. | `c0734040` |
| <a id="le-57bb25eb0e"></a>`materializer/README.md` | examined | The contract the renderer states for itself: what it produces, the three source kinds, and the self-contained HTML requirement. | `c0734040` |
| <a id="le-023291b933"></a>`materializer/amanuensis_materializer/__init__.py` | examined | The package surface: one exported class. | `c0734040` |
| <a id="le-018dc6529d"></a>`materializer/amanuensis_materializer/core.py` | examined | The orchestrator: the page plan, the diff-aware render decision, the global xref pass, the HTML projection, the retirement of orphaned pages, and the post-xref read-back. | `c0734040` |
| <a id="le-a209ebc791"></a>`materializer/amanuensis_materializer/db.py` | examined | The read-only open and the REQUIRED_VIEWS probe with the one fix it names — the reason an older store is refused rather than rendered short. | `c0734040` |
| <a id="le-e43ec1bc36"></a>`materializer/amanuensis_materializer/diagrams.py` | examined | The topology surfaces, and the atlas-not-graph rule: with no recorded edges the page says so and renders a subsystem atlas rather than asserting a dependency graph. | `c0734040` |
| <a id="le-699fcb91c7"></a>`materializer/amanuensis_materializer/html_projection.py` | examined | The diff-aware materializer: the Python projection of the store. | `410d769b` |
| <a id="le-9e6fa5d9c6"></a>`materializer/amanuensis_materializer/lint.py` | examined | The orientation-prose lints: survey-status assertions shaped as assertions rather than matched as bare words, and the composite-index rule. | `c0734040` |
| <a id="le-c1cd26d6d4"></a>`materializer/amanuensis_materializer/manifest.py` | examined | The per-page source-hash record, the version bump that invalidates everything, and prune_retired. | `c0734040` |
| <a id="le-d827cc413f"></a>`materializer/amanuensis_materializer/readback.py` | examined | The diff-aware materializer: the Python projection of the store. | `410d769b` |
| <a id="le-6d3cf24ae6"></a>`materializer/amanuensis_materializer/renderers.py` | examined | The diff-aware materializer: page renderers, read-back axes, and the HTML projection. | `410d769b` |
| <a id="le-9b07a74728"></a>`materializer/amanuensis_materializer/slugs.py` | examined | The deterministic routing every page and every xref target is derived from. | `c0734040` |
| <a id="le-40e31187ab"></a>`materializer/amanuensis_materializer/vocabulary.py` | examined | The diff-aware materializer: the Python projection of the store. | `410d769b` |
| <a id="le-98b16d5714"></a>`materializer/amanuensis_materializer/xref.py` | examined | The global cross-reference pass: code fences and existing links stashed, self-references rendered bold rather than linked, and every candidate path verified inside the output root. | `c0734040` |
| <a id="le-fcd34ce394"></a>`materializer/materialize.py` | examined | The CLI: the three modes, the unmanaged-file refusal that protects a human's files from clean publication, and the stage/backup/promote sequence that leaves the prior output untouched on a red run. | `c0734040` |
| <a id="le-9deec6b840"></a>`materializer/pyproject.toml` | examined | The ruff configuration the regression list runs. | `c0734040` |
| <a id="le-1460bf49b2"></a>`materializer/test-history-and-disagreements.py` | examined | The diff-aware materializer: the Python projection of the store. | `410d769b` |
| <a id="le-1a2e92873c"></a>`materializer/test-ledger-freshness.py` | examined | The diff-aware materializer: the Python projection of the store. | `410d769b` |
| <a id="le-bda9fc3b96"></a>`materializer/test-lens-pages.py` | examined | The diff-aware materializer: the Python projection of the store. | `410d769b` |
| <a id="le-c96468c2ef"></a>`materializer/test-materializer.py` | examined | The diff-aware materializer: the Python projection of the store. | `410d769b` |
| <a id="le-a5aca71c9b"></a>`materializer/test-overview-truthfulness.py` | examined | The diff-aware materializer: the Python projection of the store. | `410d769b` |
| <a id="le-f9d8a99915"></a>`materializer/test-readback.py` | examined | The diff-aware materializer: the Python projection of the store. | `410d769b` |
| <a id="le-b741a152cd"></a>`materializer/test-search-index.py` | examined | The diff-aware materializer: the Python projection of the store. | `410d769b` |
| <a id="le-cfcb878cc4"></a>`materializer/test-unmeasured-coverage.py` | examined | The diff-aware materializer: the Python projection of the store. | `410d769b` |
| <a id="le-18215313a9"></a>`docs/.manifest.json` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-bb8ccd168e"></a>`docs/.projection-contract.json` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-650632fa57"></a>`docs/architecture.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-e45b0ac05f"></a>`docs/architecture.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-1be0525cc9"></a>`docs/concern-checklist.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-626a2ecce5"></a>`docs/concern-checklist.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-810d6b88c8"></a>`docs/concerns.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-6fd75da6e4"></a>`docs/concerns.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-4eb74c67a0"></a>`docs/contradictions.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-9322e0f077"></a>`docs/contradictions.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-3e2e05ff39"></a>`docs/diagnosticity.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-5447ec5cdd"></a>`docs/diagnosticity.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-b1824b8c63"></a>`docs/disagreements.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-c67d6779d3"></a>`docs/disagreements.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-0576973004"></a>`docs/entry-point.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-06b4fec7f7"></a>`docs/entry-point.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-8ca7ff4eb6"></a>`docs/field-notes.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-be88de46d4"></a>`docs/field-notes.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-361b24ecec"></a>`docs/files.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-c743b81b75"></a>`docs/files.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-61fb8f0b98"></a>`docs/findings.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-63c8ccce2c"></a>`docs/findings.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-b27fcfc85f"></a>`docs/hot-spots.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-a06ba26706"></a>`docs/hot-spots.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-28974e2892"></a>`docs/how-to-read.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-7b2d92ad09"></a>`docs/how-to-read.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-237b7ad940"></a>`docs/index.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-ec4c654062"></a>`docs/index.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-6718fc6322"></a>`docs/master-plan.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-32cbcd6c0d"></a>`docs/master-plan.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-02d1e35b8d"></a>`docs/not-yet-surveyed.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-d0fe60a8a5"></a>`docs/not-yet-surveyed.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-5dd0060ef1"></a>`docs/onboarding-report.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-383ff89ad2"></a>`docs/onboarding-report.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-890cd8434f"></a>`docs/open-questions.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-d0510183e6"></a>`docs/open-questions.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-2b8b4a4c57"></a>`docs/resolution-history.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-8736eb43ee"></a>`docs/resolution-history.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-73a000bf16"></a>`docs/resolved-findings.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-57ca08047c"></a>`docs/resolved-findings.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-bad77e6f7a"></a>`docs/resolved-leads.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-0ac114fffe"></a>`docs/resolved-leads.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-44afe236ae"></a>`docs/seams.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-b34e98d920"></a>`docs/seams.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-e137bf1068"></a>`docs/search-index.js` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-ce77ff646d"></a>`docs/sessions.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-a0ed38ec68"></a>`docs/sessions.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-9482886e39"></a>`docs/stale.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-30810cfd13"></a>`docs/stale.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-b7efa3c038"></a>`docs/subsystems/b01-survey-methodology-and-agent-contracts.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-b1e5f74f44"></a>`docs/subsystems/b01-survey-methodology-and-agent-contracts.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-bdf73be75c"></a>`docs/subsystems/b02-server-core-repository-binding-storage-schema-lifecycle.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-df1d3f14b8"></a>`docs/subsystems/b02-server-core-repository-binding-storage-schema-lifecycle.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-296c83f36f"></a>`docs/subsystems/b03-knowledge-tools-and-workflow-api.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-d022e2477c"></a>`docs/subsystems/b03-knowledge-tools-and-workflow-api.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-228b5243bd"></a>`docs/subsystems/b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-b3473b5658"></a>`docs/subsystems/b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-06db247ca5"></a>`docs/subsystems/b05-materializer-human-projection-read-back-html.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-01472a3233"></a>`docs/subsystems/b05-materializer-human-projection-read-back-html.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-46af77edbd"></a>`docs/subsystems/b06-packaging-installer-and-host-activation.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-cfe92e4f3a"></a>`docs/subsystems/b06-packaging-installer-and-host-activation.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-84904e1ed9"></a>`docs/subsystems/b07-gates-evidence-custody-and-ci.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-40dad1a97c"></a>`docs/subsystems/b07-gates-evidence-custody-and-ci.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-83f313b973"></a>`docs/subsystems/b08-records-design-research-published-projection-execution-ledger.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-00f0e5dbd1"></a>`docs/subsystems/b08-records-design-research-published-projection-execution-ledger.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-6d939ae1ac"></a>`docs/vocabulary.html` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-9c4690dd50"></a>`docs/vocabulary.md` | generated-ignore | materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source. | `a7f9384d` |
| <a id="le-bb739a0c9b"></a>`materializer/uv.lock` | generated-ignore | uv writes this lockfile; it is resolver output. | `a7f9384d` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AT-1](../concerns.md#at-1)** | confirmed-acceptable | code-verified | 🔗 | Clean publication is the atomic unit and it is a directory rename, which is atomic on one filesystem: the stage is fully rendered and verified before the old output is moved aside and the stage takes its place. The ordinary non-clean render is deliberately not atomic — it writes pages one at a time into the live directory — and the manifest is saved after them, so an interrupted render leaves a partly rewritten projection with a manifest describing the previous one. That is recoverable by the next render and is why publication uses the clean path. |
| **[AT-2](../concerns.md#at-2)** | out-of-scope | code-verified |  | This process opens the store read-only and writes no database rows, so it cannot leave a WAL frame uncommitted. Checkpoint atomicity belongs to [B-02](b02-mcp-core-persistence-and-lifecycle.md), which owns the writer. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-bug | code-verified |  | The derived-state coherence question this subsystem is most exposed to is whether a projection can disagree with the rows behind it, and the read-back answers it on three axes over both formats — except at one point. Two readers still draw from `entries`, a table no code path writes: readback.py:687's per-row stale-marker expectation set and renderers.py:696's index reading. The freshness strip beside them was migrated onto the ledger (B04-2's repair), so the page now shows a live count while the axis that is supposed to verify its markers computes an empty expectation set. Filed as B04-R1. |
| **[CR-1](../concerns.md#cr-1)** | confirmed-acceptable | code-verified | 🔗 | The read side is safe by construction: mode=ro over WAL, so a concurrent agent write never blocks the render and never sees a partial page. The write side is a single process over one output directory with no lock of its own, so two concurrent renders into the same docs/ would interleave; clean publication narrows the window to a rename but does not close it. Not reachable as the product is driven — materialize_docs is a synchronous tool call on a single-threaded server — so acceptable rather than a defect, and recorded as a property of the configuration. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | code-verified |  | The exceptional paths preserve the invariant the nominal path establishes: the previous projection survives every failure. A renderer exception is caught per page, recorded with its traceback, and clears summary.ok so the process exit code carries it; clean publication removes the stage on a red summary and restores the backup if promotion itself throws; the connection is closed in a finally. The deliberate asymmetry is that one failed page does not abort the run — batch behaviour retained on purpose, with the failure propagated rather than swallowed. |
| **[IF-1](../concerns.md#if-1)** | confirmed-acceptable | code-verified | 🔗 | This is the subsystem the concern is really about, and the divergence it guards against is closed in three places rather than one: the cross-reference resolver re-runs over every alive page on every render, not only the rewritten ones, precisely because another page changing can change which ids resolve; the HTML navigation is rebuilt from the whole page plan; and orphaned pages are retired rather than left behind. Acceptable rather than ruled out because the equality is asserted by construction and not compared: nothing in the product renders both ways from one state and diffs them. test-materializer.py's five-step sequence is that comparison, and it is a test fixture rather than a gate on a real store. |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | code-verified | 🔗 | The two resources are the SQLite connection and the staging directory. The connection is closed in a finally on both the render and the verify paths. The stage is removed on a red summary and on an exception, and the backup is restored if promotion throws before the output exists. Acceptable rather than ruled out for one residual the code itself notes: if the backup cannot be removed after a successful promotion the path is retained and reported as a warning, so a repeated failure accumulates backup directories beside the output. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified | 🔗 | The schema seam is held by a probe with a named cause and one fix, and the vocabulary seam by generation: OBLIGATION_BEARING_SQL and the evidence-quality ladder come from the generated module rather than from a hand-kept copy, which is what B04-4's repair was. Acceptable rather than ruled out for the seam nothing holds: reporting-style.md specifies the typed projections this file implements, and no check relates the two. B04-4's history is exactly that failure — a hand-maintained sixth copy of the evidence ladder in a static page that only humans read. |
| **[SI-1](../concerns.md#si-1)** | out-of-scope | code-verified |  | The renderer is handed a storage directory and an output directory by its caller and derives no project identity of its own. Containment of the output is [B-03](b03-knowledge-tools-and-workflow-api.md)'s resolveStorageOutputPath before the spawn, plus the unmanaged-file refusal here. Out-of-scope so the identity concern stays where the derivation is. |
| **[SI-2](../concerns.md#si-2)** | confirmed-acceptable | code-verified | 🔗 | Every revision the projection prints comes from a row that was resolved at write time by the server, so the renderer reproduces rather than re-derives them, and it stamps each page with the store's own checked revision rather than the working tree's. Acceptable rather than ruled out because the renderer performs no ancestry check of its own: a row whose ref_sha the workspace can no longer reach is printed exactly as a reachable one is, and only the gates outside this subsystem — the depth gate, the carry receipt, receipt-provenance — distinguish them. |
| **[TB-1](../concerns.md#tb-1)** | confirmed-acceptable | code-verified |  | The one exogenous call this subsystem makes — git remote get-url origin, to decide whether file identities can open at a github.com revision — carries timeout=3 and check=False and returns None on any OSError or SubprocessError, so an unresponsive git costs the link affordance and nothing else. This is the bound B02-R1 finds missing on the server side, applied here. |
| **[TR-1](../concerns.md#tr-1)** | ruled-out | code-verified |  | Every value this renderer writes comes from a store it opened read-only, and every path it writes is verified inside the output root: resolve_all resolves each candidate and skips anything that escapes, materialize.py refuses a clean replacement over a directory holding a file no manifest claims, and the MCP side resolves the output through resolveStorageOutputPath before the process is spawned. The projection never writes back to the store, so a corrupt derived artifact cannot become durable truth — ADR-0005 names that direction explicitly and the code follows it. |

### Survey artifact

#### **B-04** — Diff-aware materializer

Structural account, read at `c073404`. Scope: `materializer/**` — the only Python in the
product and the only reader-facing surface. `docs/` is its output and is
`generated-ignore`.

##### Observed

**One plan, four consumers.** `core.py:_plan` computes the page list from the store;
rendering, the HTML shell's navigation, the reader's-guide route table and the read-back's
expected-path set all read it. A page cannot exist in one and not the others.

**Diff-aware by source hash.** `.manifest.json` records per page the identifiers it was
rendered from (`db:`, `prose:`, `synthetic:`) and their hashes; a page is rewritten when a
source hash changes, when its own content hash changes, when the file is missing, or when
`MATERIALIZER_VERSION` moves. Pages whose generator disappeared are retired — file and
manifest entry both.

**Two formats, one source, read back independently.** HTML is derived from the finished
post-xref Markdown, and `ProjectionVerifier` checks state, coverage and content on each
format separately, so a healthy Markdown cannot mask damaged HTML.

**Refusal preserves the prior output.** Absent required view, unknown nav group, renderer
exception, red read-back, unmanaged file in the output directory — each leaves `docs/` as
it was. Clean publication stages, verifies, then promotes.

**Derived predicates are generated, not restated.** `OBLIGATION_BEARING_SQL` and the
evidence-quality ladder come from the generated `vocabulary` module, so the renderer, the
server and the lint cannot disagree about what carries an obligation or which rung is
strongest.

##### State containers

None held across calls. `Manifest` and `Summary` are per-run dataclasses; the SQLite
connection is opened `mode=ro` and closed in a `finally`. Claimed as an explicit negative.

##### Seam contracts from this side

- **`memory.db`** — read `mode=ro`, never written. This side depends on the two views
  `REQUIRED_VIEWS` names and refuses by name when they are absent.
- **`<storage>/docs/`** — written here, promoted by `dev/promote-docs.mjs` ([B-09](b09-conspectus-design-lanes-their-drivers-and-receipts.md)) to the
  repository's checked-in `docs/`.
- **`reporting-style.md`** ([B-01](b01-survey-methodology-and-agent-contracts.md)) — specifies the typed projections this implements;
  nothing compares the two.

##### Open

`readback.py:687` and `renderers.py:696` still read `entries`, a table no code path
writes. Recorded as B04-R1.
