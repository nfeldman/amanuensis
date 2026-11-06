# **B-04** — Diff-aware materializer

**Status**: 🟡 adversarial  
**Layer**: Projection

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

materializer/** and the promoted docs/ it renders

### Survey note

*A note the survey left on the subsystem record; not bound to a revision.*

The only Python in the product and the only reader-facing surface. docs/ is its output and is classified generated-ignore. Carries archived findings B04-1 through B04-5, four of them open.

## Start here

amanuensis_materializer/core.py; renderers.py; readback.py

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Projection

- Every way this renderer can fail leaves the published projection as it was. A missing required view refuses before the plan is built; an unknown nav group refuses before a byte is written; a renderer exception records the traceback and clears ok; a read-back mismatch clears ok; and clean publication renders into a staging directory, promotes only on a green summary, and removes the stage otherwise. The one destructive step — replacing the output directory — is additionally refused while the output holds a file no prior manifest claims.
    - `B-04/projection/a-refusal-leaves-the-previous-output-untouched` · subject `B-04` · Observation · asserted at `c0734040022f` · evidence: `materializer/amanuensis_materializer/renderers.py:407-430`, `materializer/amanuensis_materializer/core.py:259-276`

### Survey narrative

*Narrative from the survey artifact; not individually bound to a revision.* Its source is `subsystems/B-04-structural.md` at content hash `a5a73c29df74`, recorded at `c0734040022f`.

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

## Vocabulary

- **page plan** — The list of pages the current store requires, computed once per render and used four times over: to decide what to write, what to link, what to navigate, and what the read-back must find.

## Known defects here

6 defects here are open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- A default describe_locus on a surveyed file returns standing and a census and serves none of the account. Called on mcp-server/src/tools/locus.ts at 466f193 it reported census total 5, items [] in all eight sections, response_bytes 9248 against budget_bytes 8192, and within_budget false. — [B04-R5](../findings.md#b04-r5) · 🟠 HIGH · Open
- An adversarial pass at the revision a claim was recorded at can only record `survived`. `overturned` and `superseded` are unreachable, so the mapped prerequisite that requires an outcome on every claim cannot record a negative one. All 8 outcomes in this store are survived. — [B04-R6](../findings.md#b04-r6) · 🟠 HIGH · Open
- The projection read-back's per-row stale-marker expectation set is empty for every real conspectus, so a projection that drops every stale marker still passes that part of the state axis; and the index page's stale reading is drawn from the same dead source. — [B04-R1](../findings.md#b04-r1) · 🟡 MEDIUM · Open
- A clean publish can go red on the read-back's coverage axis with dangling anchors whose only distinguishing property is the length of the record prose beside them: shortening five long rationales returned all seven missing anchors and the next publish was green on all three axes. — [B04-R2](../findings.md#b04-r2) · 🟡 MEDIUM · Open
- add_claim accepts a claim_key whose slug does not identify its subject. The writer learns the rule only from a gate that runs after the record is durable, when correcting it means discarding the structural phase. — [B04-R7](../findings.md#b04-r7) · 🟡 MEDIUM · Open
- A hung git inside a tool handler blocks that call indefinitely, and because the call is synchronous the whole server stops answering. — [B04-R8](../findings.md#b04-r8) · 🟡 MEDIUM · Open

## Standing

**Adversarial** — Candidate conclusions are being challenged; treat them as provisional. It cannot justify that the challenge pass has finished.

| Metric | Value |
|---|---|
| Files read | 24 of 99 ledger rows |
| Files in scope, not yet read | 5 of 99 |
| Files excluded from the survey obligation | 70 of 99 |
| Ledger rows the repository has changed under | 70 of 99 |
| Active concerns with a disposition recorded here | 12 of 12 — 1 confirmed-bug, 8 confirmed-acceptable, 1 ruled-out, 2 out-of-scope |
| Findings by resolution state | 6 open |
| Seams assessable from both sides | no seam names this subsystem |

## Survey record

### File ledger

- **The diff-aware materializer's test suite: GATE EX3. Assigned by convention; not read.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-fe5e48a8c3"></a>`materializer/test-claim-register.py`
- **The diff-aware materializer's test suite: GATE EX5. Assigned by convention; not read.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-fcfaf8cd3f"></a>`materializer/test-ledger-grouping.py`
- **The diff-aware materializer's test suite: GATE EX4. Assigned by convention; not read.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-e2d66af2d0"></a>`materializer/test-narrative-placement.py`
- **The diff-aware materializer's test suite: GATE EX6. Assigned by convention; only its heading-parity check was read.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-47ed434b98"></a>`materializer/test-placeholder-census.py`
- **The diff-aware materializer's test suite: GATE EX2. Assigned by convention; not read.** — candidate, 1 file, recorded at `2ceb0d2d`
    - <a id="le-31ff311bf8"></a>`materializer/test-prose-retention.py`
- **Local build state kept out of the tree.** — examined, 1 file, examined at `c0734040`
    - <a id="le-e1695ac22a"></a>`materializer/.gitignore`
- **The contract the renderer states for itself: what it produces, the three source kinds, and the self-contained HTML requirement.** — examined, 1 file, examined at `c0734040`
    - <a id="le-57bb25eb0e"></a>`materializer/README.md`
- **The package surface: one exported class.** — examined, 1 file, examined at `c0734040`
    - <a id="le-023291b933"></a>`materializer/amanuensis_materializer/__init__.py`
- **The orchestrator: the page plan, the diff-aware render decision, the global xref pass, the HTML projection, the retirement of orphaned pages, and the post-xref read-back.** — examined, 1 file, examined at `2ceb0d2d`
    - <a id="le-018dc6529d"></a>`materializer/amanuensis_materializer/core.py`
- **The read-only open and the REQUIRED_VIEWS probe with the one fix it names — the reason an older store is refused rather than rendered short.** — examined, 1 file, examined at `c0734040`
    - <a id="le-a209ebc791"></a>`materializer/amanuensis_materializer/db.py`
- **The topology surfaces, and the atlas-not-graph rule: with no recorded edges the page says so and renders a subsystem atlas rather than asserting a dependency graph.** — examined, 1 file, examined at `c0734040`
    - <a id="le-e43ec1bc36"></a>`materializer/amanuensis_materializer/diagrams.py`
- **The diff-aware materializer: the Python projection of the store.** — examined, 11 files, examined at 3 revisions
    - <a id="le-699fcb91c7"></a>`materializer/amanuensis_materializer/html_projection.py` (`410d769b`)
    - <a id="le-d827cc413f"></a>`materializer/amanuensis_materializer/readback.py` (`ec5824bc`)
    - <a id="le-40e31187ab"></a>`materializer/amanuensis_materializer/vocabulary.py` (`410d769b`)
    - <a id="le-1460bf49b2"></a>`materializer/test-history-and-disagreements.py` (`410d769b`)
    - <a id="le-1a2e92873c"></a>`materializer/test-ledger-freshness.py` (`410d769b`)
    - <a id="le-bda9fc3b96"></a>`materializer/test-lens-pages.py` (`410d769b`)
    - <a id="le-c96468c2ef"></a>`materializer/test-materializer.py` (`ec5824bc`)
    - <a id="le-a5aca71c9b"></a>`materializer/test-overview-truthfulness.py` (`410d769b`)
    - <a id="le-f9d8a99915"></a>`materializer/test-readback.py` (`410d769b`)
    - <a id="le-b741a152cd"></a>`materializer/test-search-index.py` (`410d769b`)
    - <a id="le-cfcb878cc4"></a>`materializer/test-unmeasured-coverage.py` (`a521e28`)
- **The orientation-prose lints: survey-status assertions shaped as assertions rather than matched as bare words, and the composite-index rule.** — examined, 1 file, examined at `c0734040`
    - <a id="le-9e6fa5d9c6"></a>`materializer/amanuensis_materializer/lint.py`
- **The per-page source-hash record, the version bump that invalidates everything, and prune_retired.** — examined, 1 file, examined at `c0734040`
    - <a id="le-c1cd26d6d4"></a>`materializer/amanuensis_materializer/manifest.py`
- **The diff-aware materializer: page renderers, read-back axes, and the HTML projection.** — examined, 1 file, examined at `a521e28`
    - <a id="le-6d3cf24ae6"></a>`materializer/amanuensis_materializer/renderers.py`
- **The deterministic routing every page and every xref target is derived from.** — examined, 1 file, examined at `c0734040`
    - <a id="le-9b07a74728"></a>`materializer/amanuensis_materializer/slugs.py`
- **The global cross-reference pass: code fences and existing links stashed, self-references rendered bold rather than linked, and every candidate path verified inside the output root.** — examined, 1 file, examined at `c0734040`
    - <a id="le-98b16d5714"></a>`materializer/amanuensis_materializer/xref.py`
- **The CLI: the three modes, the unmanaged-file refusal that protects a human's files from clean publication, and the stage/backup/promote sequence that leaves the prior output untouched on a red run.** — examined, 1 file, examined at `ec5824bc`
    - <a id="le-fcd34ce394"></a>`materializer/materialize.py`
- **The ruff configuration the regression list runs.** — examined, 1 file, examined at `c0734040`
    - <a id="le-9deec6b840"></a>`materializer/pyproject.toml`
- **materialize_docs renders these pages and dev/promote-docs.mjs checks them in; they are the projection's output, not its source.** — generated-ignore, 69 files, recorded at 2 revisions
    - <a id="le-18215313a9"></a>`docs/.manifest.json` (`a7f9384d`)
    - <a id="le-bb8ccd168e"></a>`docs/.projection-contract.json` (`a7f9384d`)
    - <a id="le-650632fa57"></a>`docs/architecture.html` (`a7f9384d`)
    - <a id="le-e45b0ac05f"></a>`docs/architecture.md` (`a7f9384d`)
    - <a id="le-1be0525cc9"></a>`docs/concern-checklist.html` (`a7f9384d`)
    - <a id="le-626a2ecce5"></a>`docs/concern-checklist.md` (`a7f9384d`)
    - <a id="le-810d6b88c8"></a>`docs/concerns.html` (`a7f9384d`)
    - <a id="le-6fd75da6e4"></a>`docs/concerns.md` (`a7f9384d`)
    - <a id="le-4eb74c67a0"></a>`docs/contradictions.html` (`a7f9384d`)
    - <a id="le-9322e0f077"></a>`docs/contradictions.md` (`a7f9384d`)
    - <a id="le-3e2e05ff39"></a>`docs/diagnosticity.html` (`a7f9384d`)
    - <a id="le-5447ec5cdd"></a>`docs/diagnosticity.md` (`a7f9384d`)
    - <a id="le-b1824b8c63"></a>`docs/disagreements.html` (`a7f9384d`)
    - <a id="le-c67d6779d3"></a>`docs/disagreements.md` (`a7f9384d`)
    - <a id="le-0576973004"></a>`docs/entry-point.html` (`a7f9384d`)
    - <a id="le-06b4fec7f7"></a>`docs/entry-point.md` (`a7f9384d`)
    - <a id="le-8ca7ff4eb6"></a>`docs/field-notes.html` (`a7f9384d`)
    - <a id="le-be88de46d4"></a>`docs/field-notes.md` (`a7f9384d`)
    - <a id="le-361b24ecec"></a>`docs/files.html` (`a7f9384d`)
    - <a id="le-c743b81b75"></a>`docs/files.md` (`a7f9384d`)
    - <a id="le-61fb8f0b98"></a>`docs/findings.html` (`a7f9384d`)
    - <a id="le-63c8ccce2c"></a>`docs/findings.md` (`a7f9384d`)
    - <a id="le-b27fcfc85f"></a>`docs/hot-spots.html` (`a7f9384d`)
    - <a id="le-a06ba26706"></a>`docs/hot-spots.md` (`a7f9384d`)
    - <a id="le-28974e2892"></a>`docs/how-to-read.html` (`a7f9384d`)
    - <a id="le-7b2d92ad09"></a>`docs/how-to-read.md` (`a7f9384d`)
    - <a id="le-237b7ad940"></a>`docs/index.html` (`a7f9384d`)
    - <a id="le-ec4c654062"></a>`docs/index.md` (`a7f9384d`)
    - <a id="le-6718fc6322"></a>`docs/master-plan.html` (`a7f9384d`)
    - <a id="le-32cbcd6c0d"></a>`docs/master-plan.md` (`a7f9384d`)
    - <a id="le-02d1e35b8d"></a>`docs/not-yet-surveyed.html` (`a7f9384d`)
    - <a id="le-d0fe60a8a5"></a>`docs/not-yet-surveyed.md` (`a7f9384d`)
    - <a id="le-5dd0060ef1"></a>`docs/onboarding-report.html` (`a7f9384d`)
    - <a id="le-383ff89ad2"></a>`docs/onboarding-report.md` (`a7f9384d`)
    - <a id="le-890cd8434f"></a>`docs/open-questions.html` (`a7f9384d`)
    - <a id="le-d0510183e6"></a>`docs/open-questions.md` (`a7f9384d`)
    - <a id="le-2b8b4a4c57"></a>`docs/resolution-history.html` (`a7f9384d`)
    - <a id="le-8736eb43ee"></a>`docs/resolution-history.md` (`a7f9384d`)
    - <a id="le-73a000bf16"></a>`docs/resolved-findings.html` (`a7f9384d`)
    - <a id="le-57ca08047c"></a>`docs/resolved-findings.md` (`a7f9384d`)
    - <a id="le-bad77e6f7a"></a>`docs/resolved-leads.html` (`a7f9384d`)
    - <a id="le-0ac114fffe"></a>`docs/resolved-leads.md` (`a7f9384d`)
    - <a id="le-44afe236ae"></a>`docs/seams.html` (`a7f9384d`)
    - <a id="le-b34e98d920"></a>`docs/seams.md` (`a7f9384d`)
    - <a id="le-e137bf1068"></a>`docs/search-index.js` (`a7f9384d`)
    - <a id="le-ce77ff646d"></a>`docs/sessions.html` (`a7f9384d`)
    - <a id="le-a0ed38ec68"></a>`docs/sessions.md` (`a7f9384d`)
    - <a id="le-9482886e39"></a>`docs/stale.html` (`a7f9384d`)
    - <a id="le-30810cfd13"></a>`docs/stale.md` (`a7f9384d`)
    - <a id="le-b7efa3c038"></a>`docs/subsystems/b01-survey-methodology-and-agent-contracts.html` (`a7f9384d`)
    - <a id="le-b1e5f74f44"></a>`docs/subsystems/b01-survey-methodology-and-agent-contracts.md` (`a7f9384d`)
    - <a id="le-e43cdcafa2"></a>`docs/subsystems/b02-mcp-core-persistence-and-lifecycle.html` (`50abc288`)
    - <a id="le-b38a7eae97"></a>`docs/subsystems/b02-mcp-core-persistence-and-lifecycle.md` (`50abc288`)
    - <a id="le-296c83f36f"></a>`docs/subsystems/b03-knowledge-tools-and-workflow-api.html` (`a7f9384d`)
    - <a id="le-d022e2477c"></a>`docs/subsystems/b03-knowledge-tools-and-workflow-api.md` (`a7f9384d`)
    - <a id="le-3ea4588e82"></a>`docs/subsystems/b04-diff-aware-materializer.html` (`50abc288`)
    - <a id="le-e09b62fb85"></a>`docs/subsystems/b04-diff-aware-materializer.md` (`50abc288`)
    - <a id="le-f7d75eba5a"></a>`docs/subsystems/b05-packaging-installer-validation-and-product-docs.html` (`50abc288`)
    - <a id="le-93aac7e845"></a>`docs/subsystems/b05-packaging-installer-validation-and-product-docs.md` (`50abc288`)
    - <a id="le-dd479ba038"></a>`docs/subsystems/b06-report-interface-design-and-validation-studies.html` (`50abc288`)
    - <a id="le-2f3bb88274"></a>`docs/subsystems/b06-report-interface-design-and-validation-studies.md` (`50abc288`)
    - <a id="le-f7d3cbaf4f"></a>`docs/subsystems/b07-embedded-research-surveys-and-platform-trials.html` (`50abc288`)
    - <a id="le-2a5170fe68"></a>`docs/subsystems/b07-embedded-research-surveys-and-platform-trials.md` (`50abc288`)
    - <a id="le-57cd9e6e3a"></a>`docs/subsystems/b08-activation-evidence-and-release-readiness.html` (`50abc288`)
    - <a id="le-01f0843bad"></a>`docs/subsystems/b08-activation-evidence-and-release-readiness.md` (`50abc288`)
    - <a id="le-31026b301a"></a>`docs/subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.html` (`50abc288`)
    - <a id="le-fe02a0e84e"></a>`docs/subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md` (`50abc288`)
    - <a id="le-6d939ae1ac"></a>`docs/vocabulary.html` (`a7f9384d`)
    - <a id="le-9c4690dd50"></a>`docs/vocabulary.md` (`a7f9384d`)
- **uv writes this lockfile; it is resolver output.** — generated-ignore, 1 file, recorded at `a7f9384d`
    - <a id="le-bb739a0c9b"></a>`materializer/uv.lock`

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

The survey artifact is rendered above, under Structure. Its source is `subsystems/B-04-structural.md` at content hash `a5a73c29df74`, recorded at `c0734040022f`.
