# **B-07** — Embedded research surveys and platform trials

**Status**: 🟡 concerns  
**Layer**: Research evidence

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

scholiast/**

## Start here

ai-primary-web-platform-landscape/README.md; report-record-presentation/conspectus.md

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-07/corpus/captures-are-unbounded-network-calls` | `B-07` | Every capture and verification script in this corpus reaches the network or a child process with no wall-clock bound: the GitHub and npm fetches in capture-component-landscape.mjs carry no AbortSignal, the shadcn registry capture spawns the CLI with no timeout, and verify-trial-snapshot.py runs a child detector through subprocess.check_output with none. The scripts are operator-run rather than server-hosted, so the cost is a hung terminal rather than a hung service — which is why this is LOW and why the same pattern in [B-02](b02-mcp-core-persistence-and-lifecycle.md) is not. | Observation | `c0734040022f` |

## Vocabulary

**Domain vocabulary** — none. Declared at `c0734040022f` in session `mu274z8h-ylgc5fy0`: _This subsystem is an embedded corpus of completed research surveys and captured platform trials, not a component of the product. Its vocabulary is the vocabulary of the domains it surveyed — web component registries, island architectures, trial snapshots — and those terms belong to the surveys' own vocabulary.md files, where each survey already defines them for its own readers. Recording them here would create a second glossary of terms this codebase does not implement, scoped to a subsystem whose files the product never loads. The three files read at this pass carry no internal jargon of their own: they are capture scripts named for what they capture._

## Known defects here

1 defect here is open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- A research refresh or snapshot verification hangs indefinitely when GitHub, npm, the shadcn CLI, or a child detector stalls. — [B07-R1](../findings.md#b07-r1) · 🔵 LOW · Open

## Standing

**Concerns** — Structural mapping is complete and concern-by-concern review is in progress. It cannot justify that a finding survived adversarial challenge.

| Metric | Value |
|---|---|
| Files read | 5 of 103 ledger rows |
| Files in scope, not yet read | 74 of 103 |
| Files excluded from the survey obligation | 24 of 103 |
| Ledger rows the repository has changed under | 0 of 103 |
| Active concerns with a disposition recorded here | 1 of 12 — 1 confirmed-bug |
| Findings by resolution state | 1 open |
| Seams assessable from both sides | no seam names this subsystem |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-f6ebefdcf7"></a>`scholiast/ai-primary-web-platform-landscape/baseline-inspection.py` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-b33d60534e"></a>`scholiast/ai-primary-web-platform-landscape/baseline.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-b888497f62"></a>`scholiast/ai-primary-web-platform-landscape/claims.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-377c0bc72e"></a>`scholiast/ai-primary-web-platform-landscape/component-landscape-metadata.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-734e762fe8"></a>`scholiast/ai-primary-web-platform-landscape/conspectus.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-3182238e31"></a>`scholiast/ai-primary-web-platform-landscape/dependency-footprint.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-c029ee4f45"></a>`scholiast/ai-primary-web-platform-landscape/dependency-footprint.py` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-e44c4bac5a"></a>`scholiast/ai-primary-web-platform-landscape/github-health.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-bc2e94c616"></a>`scholiast/ai-primary-web-platform-landscape/link-audit.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-474a4875a2"></a>`scholiast/ai-primary-web-platform-landscape/link-audit.py` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-3c2788a110"></a>`scholiast/ai-primary-web-platform-landscape/notes.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-4764fbbc10"></a>`scholiast/ai-primary-web-platform-landscape/npm-audit.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-44a02506b3"></a>`scholiast/ai-primary-web-platform-landscape/npm-metadata.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-9c31d47ba2"></a>`scholiast/ai-primary-web-platform-landscape/registry-policy.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-91580f74cb"></a>`scholiast/ai-primary-web-platform-landscape/registry-policy.py` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-928b66bb4a"></a>`scholiast/ai-primary-web-platform-landscape/registry-trial-inspection.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-608f61b140"></a>`scholiast/ai-primary-web-platform-landscape/registry-trial-inspection.py` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-1845c49d9c"></a>`scholiast/ai-primary-web-platform-landscape/registry-trial-verification.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-8d17ec9f9c"></a>`scholiast/ai-primary-web-platform-landscape/shortlist.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-31b14061e0"></a>`scholiast/ai-primary-web-platform-landscape/sources.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-86bbaa1a02"></a>`scholiast/ai-primary-web-platform-landscape/specialist-npm-metadata.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-d8bd079be1"></a>`scholiast/ai-primary-web-platform-landscape/taxonomy.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-276ba8e6d7"></a>`scholiast/ai-primary-web-platform-landscape/trial-inspection.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-48827725a0"></a>`scholiast/ai-primary-web-platform-landscape/trial-inspection.py` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-3b01c9551d"></a>`scholiast/ai-primary-web-platform-landscape/trial-red-proof.py` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-3c15334af6"></a>`scholiast/ai-primary-web-platform-landscape/trials.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-7982eace94"></a>`scholiast/ai-primary-web-platform-landscape/trials/.gitignore` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-b17a188e21"></a>`scholiast/ai-primary-web-platform-landscape/trials/alpine/alpine-csp.js` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-4928dec797"></a>`scholiast/ai-primary-web-platform-landscape/trials/alpine/index.html` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-c7feead923"></a>`scholiast/ai-primary-web-platform-landscape/trials/alpine/report-filter.js` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-dec12c907b"></a>`scholiast/ai-primary-web-platform-landscape/trials/alpine/report.css` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-5f34c85ab0"></a>`scholiast/ai-primary-web-platform-landscape/trials/astro/astro.config.mjs` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-518dfadfc3"></a>`scholiast/ai-primary-web-platform-landscape/trials/astro/src/pages/index.astro` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-325e8b62b6"></a>`scholiast/ai-primary-web-platform-landscape/trials/astro/src/pages/methods.astro` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-e0ee74ff3b"></a>`scholiast/ai-primary-web-platform-landscape/trials/astro/src/report.css` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-bbd64e9f30"></a>`scholiast/ai-primary-web-platform-landscape/trials/eleventy/.eleventy.js` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-a50cf81a13"></a>`scholiast/ai-primary-web-platform-landscape/trials/eleventy/src/index.njk` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-e38165513c"></a>`scholiast/ai-primary-web-platform-landscape/trials/eleventy/src/methods.njk` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-0517345cad"></a>`scholiast/ai-primary-web-platform-landscape/trials/lit/src/report-filter.js` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-2363a3bf07"></a>`scholiast/ai-primary-web-platform-landscape/trials/observable/observablehq.config.js` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-3cb1be4abe"></a>`scholiast/ai-primary-web-platform-landscape/trials/observable/src/index.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-1d0b21a3df"></a>`scholiast/ai-primary-web-platform-landscape/trials/package.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-4891c47b93"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/components.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-0d6ea3dc21"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/index.html` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-240d263d6a"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/npm-audit.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-0cf62f8d20"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/package.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-005cad6ffd"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/registry-snapshot.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-5a671d6954"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/scripts/build-document.tsx` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-2d1288f251"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/scripts/capture-audit.mjs` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-856bb899d5"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/src/client.tsx` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-c89ff9b005"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/src/index.css` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-ee207bc568"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/src/lib/utils.ts` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-f672d7f301"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/src/report-filter.js` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-e60bf5bc6c"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/src/report.tsx` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-dcd873d481"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/tsconfig.json` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-bb322f0c98"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/upgrade-diff.txt` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-8a3a047259"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/vite.config.ts` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-be3f5f1693"></a>`scholiast/ai-primary-web-platform-landscape/trials/shared/classic-filter.js` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-8ab3617e55"></a>`scholiast/ai-primary-web-platform-landscape/trials/shared/report.css` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-577f37d153"></a>`scholiast/ai-primary-web-platform-landscape/vendor-matrix.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-05099383a4"></a>`scholiast/ai-primary-web-platform-landscape/verify-registry-trial-snapshot.py` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-16d46a73fe"></a>`scholiast/ai-primary-web-platform-landscape/verify-survey.py` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-7e06b19fd1"></a>`scholiast/ai-primary-web-platform-landscape/vocabulary.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-6b858014b6"></a>`scholiast/report-record-presentation/analyze_corpus.py` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-d03839abc2"></a>`scholiast/report-record-presentation/claims.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-e3dd3f5892"></a>`scholiast/report-record-presentation/conspectus.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-059b01ef36"></a>`scholiast/report-record-presentation/corpus-profile.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-2b9778ffd5"></a>`scholiast/report-record-presentation/notes.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-f5254fd222"></a>`scholiast/report-record-presentation/sources.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-e39a934fd4"></a>`scholiast/report-record-presentation/vocabulary.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-22bfc49ae6"></a>`scholiast/task-workspace-reorientation-indexes/claims.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-d5d146ddc3"></a>`scholiast/task-workspace-reorientation-indexes/conspectus.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-2d553f2c9b"></a>`scholiast/task-workspace-reorientation-indexes/notes.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-01d12c0746"></a>`scholiast/task-workspace-reorientation-indexes/sources.md` | candidate | Embedded research surveys and platform trials carried in this repository. | `a7f9384d` |
| <a id="le-23264d528a"></a>`scholiast/ai-primary-web-platform-landscape/README.md` | examined | Embedded research surveys and platform trials carried in this repository. | `410d769b` |
| <a id="le-f6f8e38c45"></a>`scholiast/ai-primary-web-platform-landscape/baseline-inspection.json` | examined | Embedded research surveys and platform trials carried in this repository. | `410d769b` |
| <a id="le-40eaf90f77"></a>`scholiast/ai-primary-web-platform-landscape/capture-component-landscape.mjs` | examined | One of the three unbounded network captures B07-1 names: the GitHub and npm metadata fetches. | `c0734040` |
| <a id="le-656f92c8cd"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/scripts/capture-registry.mjs` | examined | The third site B07-1 names: the shadcn registry capture. | `c0734040` |
| <a id="le-c04bfc1982"></a>`scholiast/ai-primary-web-platform-landscape/verify-trial-snapshot.py` | examined | The snapshot verifier B07-1 names: subprocess.check_output with no timeout. | `c0734040` |
| <a id="le-7fa92abcb8"></a>`scholiast/ai-primary-web-platform-landscape/trials/astro/dist/index.html` | generated-ignore | Build output of the trial's own source, which is separately scoped; not authored survey material. | `c0734040` |
| <a id="le-0e5c3e64c8"></a>`scholiast/ai-primary-web-platform-landscape/trials/astro/dist/methods.html` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-d7722ee24d"></a>`scholiast/ai-primary-web-platform-landscape/trials/eleventy/dist/classic-filter.js` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-038dbe1036"></a>`scholiast/ai-primary-web-platform-landscape/trials/eleventy/dist/index.html` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-361a83eb93"></a>`scholiast/ai-primary-web-platform-landscape/trials/eleventy/dist/methods.html` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-2630a2dd4a"></a>`scholiast/ai-primary-web-platform-landscape/trials/eleventy/dist/report.css` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-7c206713d7"></a>`scholiast/ai-primary-web-platform-landscape/trials/lit/dist/index.html` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-2ed13ca880"></a>`scholiast/ai-primary-web-platform-landscape/trials/lit/dist/report-filter.js` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-fcc4d07aa1"></a>`scholiast/ai-primary-web-platform-landscape/trials/observable/dist/_observablehq/client.adcc8ae6.js` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-0ad0013d69"></a>`scholiast/ai-primary-web-platform-landscape/trials/observable/dist/_observablehq/runtime.607a8173.js` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-4a4f69eb9f"></a>`scholiast/ai-primary-web-platform-landscape/trials/observable/dist/_observablehq/stdlib.c27a8c1f.js` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-02f420d5f8"></a>`scholiast/ai-primary-web-platform-landscape/trials/observable/dist/index.html` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-a76ba6adc7"></a>`scholiast/ai-primary-web-platform-landscape/trials/package-lock.json` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-44971645b4"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/dist-client/assets/index-C358O-a9.css` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-9695161fc2"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/dist-client/assets/index-DZwiDhHX.js` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-dcd7114536"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/dist-client/index.html` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-04039a0788"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/dist/index.html` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-5e01e34584"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/dist/report-filter.js` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-b24c428277"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/dist/report.css` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-ecf53a6bf1"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/package-lock.json` | generated-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-24018d7d38"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/src/components/ui/button.tsx` | vendor-ignore | Copied verbatim from the shadcn registry as part of the trial; the trial's own sources are separately scoped. | `c0734040` |
| <a id="le-de7aa27b5d"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/src/components/ui/input.tsx` | vendor-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-7f3d33a66a"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/src/components/ui/label.tsx` | vendor-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |
| <a id="le-92abe94590"></a>`scholiast/ai-primary-web-platform-landscape/trials/shadcn-copy/src/components/ui/table.tsx` | vendor-ignore | Embedded research surveys and platform trials carried in this repository. | `c0734040` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[TB-1](../concerns.md#tb-1)** | confirmed-bug | code-verified |  | All three sites carried finding B07-1 names are unbounded at HEAD: an awaited fetch with no AbortSignal, a spawnSync of the shadcn CLI with no timeout, and a subprocess.check_output of a child detector with none. Filed as B07-R1 at LOW, because these are operator-run capture scripts rather than a hosted path, so an unresponsive endpoint costs a hung terminal and a re-run. |

### Survey artifact

#### **B-07** — Embedded research surveys and platform trials

Scoping-and-carried-adjudication pass, read at `c073404`. Scope: `scholiast/**` — three
completed research surveys and the captured trial corpus one of them produced.

**This pass is partial and says so.** Three of 103 scoped files were read: the three
capture and verification scripts carried finding B07-1 names. The remaining 100 — the
surveys' own prose (`conspectus.md`, `claims.md`, `sources.md`, `vocabulary.md` per
survey), their captured JSON, and the 58-file `trials/` corpus — are scoped and unread.

##### Observed

Every capture script reaches the network or a child process with no wall-clock bound.
`capture-component-landscape.mjs:39` awaits `fetch` with no `AbortSignal`;
`trials/shadcn-copy/scripts/capture-registry.mjs:7` spawns the shadcn CLI with no
`timeout`; `verify-trial-snapshot.py:13` runs `trial-inspection.py` through
`subprocess.check_output` with none. A grep for `timeout`, `AbortSignal` and `signal:`
across the three returns nothing.

These are operator-run scripts, not server-hosted paths, so an unresponsive endpoint
costs a hung terminal rather than a hung service. That is why B07-1 is LOW where the same
pattern in [B-02](b02-mcp-core-persistence-and-lifecycle.md) is MEDIUM.

##### Domain vocabulary

Declined. The vocabulary here belongs to the domains the surveys studied, and each survey
defines its own terms in its own `vocabulary.md`.

##### Seam contracts from this side

None recorded. This corpus is read by people and by the Scholiast method, not by the
product: no file under `mcp-server/` or `materializer/` imports or reads anything under
`scholiast/`.

##### Open

100 of 103 scoped files unread at this pass. Parts of `trials/` are third-party
scaffolding and build output rather than authored survey material; the ledger records
those as `vendor-ignore` and `generated-ignore` respectively, with the authored trial
sources left obligation-bearing.
