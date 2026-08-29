# Contributing

Amanuensis ships from this repository. The MCP server, the agent
files, and the materializer all live here, and they all have to
work together — schema changes ripple into tool handlers and into
materialized output, so the test suite is broad on purpose.

## Setup

The repository's reproducible development and CI toolchain is pinned in
[`.tool-versions`](.tool-versions): Node.js 24.18.0 and Python 3.12.13. The
published MCP package retains its broader Node.js ≥ 20 compatibility contract,
and the materializer itself supports Python 3.11+ and uses only the standard
library. `ruff` is needed only for the lint step.

```bash
git clone https://github.com/nfeldman/amanuensis
cd amanuensis
mise install
mise exec -- npm --prefix mcp-server ci
mise exec -- npm --prefix mcp-server run build
```

The build produces `dist/`. Point any stdio-capable MCP client at
`mcp-server/dist/index.js` to run the server out of the source checkout instead
of the published package. See
[`references/setup.md`](.claude/skills/amanuensis/references/setup.md) for the
Claude Code, Codex, VS Code, and generic registration shapes.

Local Codex development uses a directory-level global skill link plus one
user-scoped `install --mcp-only` source launcher. This keeps the working checkout
live without creating project-local registrations or changing the
versioned-copy behavior of published npm installs. Claude and VS Code retain
their project-scoped development adapters; see “Live global skill, versioned
published skill” in the setup reference.

## Running the test suite

CI runs everything in [`.github/workflows/test.yml`](.github/workflows/test.yml).
To run a representative slice locally:

```bash
node dev/render-roadmap.mjs --check     # roadmap structure and generated projection
node dev/test-roadmap.mjs               # prove roadmap gates fail under sabotage
node dev/check-living-conspectus.mjs    # verify the pinned self-survey and derived report
node dev/test-living-conspectus.mjs     # prove every A0 gate red + clean-export read-back

cd mcp-server

node test-smoke.mjs                     # exercises every tool against a fresh DB
node test-invariants.mjs                # knowledge-depth gates, monotonic transitions
node test-derived-staleness.mjs         # ledger-derived staleness and scope reconciliation
node test-startup-bounds.mjs            # activation-path probes are time-bounded
node test-adversarial-correctness.mjs   # tries to violate the data contracts
node test-adversarial-security.mjs      # input handling, SQL safety, path traversal
node test-resolution-proof.mjs          # repair proof and append-only resolution history
node test-projection-custody.mjs        # projection mismatch custody and repair
node test-refresh-recovery.mjs          # unattended authority and crash recovery
node test-review-brief.mjs              # impact context, ablations, and publication
node test-review-analysis.mjs           # independent passes, blinding, and null controls
node test-composition.mjs               # exact fan-in and integral HEAD seam controls
node test-review-session.mjs            # compact review, expansion, and semantic export read-back
node test-codebase-brief.mjs            # mode projections, omission custody, and contract red gates
node test-design-session.mjs            # independent lenses, disagreement, and underdetermination
node test-decisions.mjs                 # acceptance authority, impact custody, and portable read-back
node test-research-broker.mjs           # admission, Scholiast custody, and external/code contradiction
node test-crosswalk-qualification.mjs   # identity red gates, relation custody, and qualified activation
node test-learning-ledger.mjs           # typed distillation, scored promotion, and rollback/read-back
node test-operating-envelope.mjs        # stratified controls, instrument clearance, and no-pooling red gates
node test-chorusmith-adapter.mjs        # adapter contracts, direct parity, bypass, and restart recovery
node test-historical-evaluation.mjs     # clean historical packets, hidden kill witnesses, and leak canaries

node scripts/check-sql-identifiers.mjs  # SQL identifiers resolve against schema
node scripts/check-tool-schemas.mjs     # tool inputSchemas are valid JSON Schema
node scripts/check-evidence-vocabulary.mjs # evidence vocabulary agrees across tools and skill
node test-installer.mjs                  # client adapters, migration, and uninstall custody
node test-activation-contract.mjs        # user-scope cwd binding and wrong-workspace halt
node test-activation-doctor.mjs          # diagnosis and digest-bound repair red gate
node test-workspace-binding.mjs          # immutable receipt, symlink halt, worktree policy
node test-codex-parent-workspace.mjs     # recover Codex CLI --cd workspace without a fixed path
node test-nested-activation-binding.mjs  # nested cwd binds the Git root and initializes lazily
node test-first-use-laziness.mjs         # prove startup is read-only and first DB use creates one store
node test-first-use-recovery.mjs         # interrupt and recover every first-use mutation boundary
node test-mcp-compatibility.mjs          # initialization, annotations, results, errors
node test-package-artifact.mjs           # packed adapters, assets, and MCP handshake
node test-package-activation-parity.mjs  # source/clean-package lifecycle parity in two repositories
node test-release-rollback.mjs           # exact-tarball rollback and five-store lifecycle custody
node scripts/gen-tool-inventory.mjs --check  # DEVELOPMENT.md inventory is current
```

From the repository root, `node dev/check-codex-host-evidence.mjs --receipt
dev/activation-evidence/a22-codex-host.json` verifies every committed Codex
host run independently. `node dev/test-codex-host-evidence-red-gates.mjs`
proves the wrong-cwd, reused-server, cross-write, and missing-restart controls
exit nonzero. The authenticated launcher itself is
`node dev/run-codex-host-harness.mjs --execute`; it uses temporary repositories
and must not be substituted for the committed-log verifier in CI.

`node dev/test-package-activation-parity-red-gates.mjs` packs two deliberately
bad candidates independently and requires both the hard-coded packed cwd and
packed skill-version mismatch to exit nonzero with the causal field named. The
unsabotaged parity test requires registry access for a clean dependency install;
run it under `mise exec --` from the pinned toolchain.

`node dev/check-activation-operating-envelope.mjs --receipt
dev/activation-evidence/a25-activation-operating-envelope.json` verifies each
committed A25 Codex run against raw host events and DB-backed store custody.
`node dev/test-activation-operating-envelope-red-gates.mjs` proves that pooled
failure, omitted intervention accounting, and reused run identity each halt.
The authenticated launcher is
`node dev/run-activation-operating-envelope.mjs --execute`; use its dry run
first, run it only against Codex-trusted temporary repositories, and do not
replace the committed-log checker in CI with a live host call. Codex-created
trust state is a host-side effect outside Amanuensis's managed configuration
surface and must be reported separately rather than counted as product setup.
`node dev/test-activation-operating-trust-cleanup.mjs` verifies that the
separate cleanup helper is dry-run-first, backup-bearing, and removes only the
exact temporary A25 trust entries while preserving unrelated bytes.

The A26 pre-publication gate keeps execution and projection separate. Run
`mise exec -- node dev/run-friction-free-release-replay.mjs` to regenerate the
isolated source/package, interruption, migration, rollback, uninstall, and
documentation receipt. Run `mise exec -- node
dev/run-friction-free-candidate-suite.mjs` only when the candidate inputs or
gate bytes change; its 19 results remain independent. Then regenerate the
criterion-linked report with `node
dev/render-friction-free-release-readiness.mjs` and verify it with `node
dev/check-friction-free-release-readiness.mjs --report
dev/activation-evidence/a26-release-readiness.json`, `node
dev/test-friction-free-release-readiness-red-gates.mjs`, and `node
dev/render-friction-free-release-readiness.mjs --check`. These commands prove
readiness only; they neither authorize nor perform publication and do not
establish product proof outside the named operating envelope.

The adversarial suites are first-class. After any schema change,
new tool, or handler edit, run them — and extend them when the
new code surfaces a class of input the existing probes don't cover.

For the materializer, from the repo root:

```bash
ruff check materializer/
python3 materializer/test-materializer.py
python3 materializer/test-readback.py
```

## Lint

- TypeScript: `npx biome check src/` from `mcp-server/`
- Python: `ruff check .` from `materializer/`

CI runs both and fails on findings.

## Generated roadmap

[`ROADMAP.md`](ROADMAP.md) is generated from the canonical
[`dev/roadmap.json`](dev/roadmap.json). The generator validates initiative IDs,
dependency order and cycles, evidence paths, metrics, acceptance and red-gate
criteria, implementation slices, and practice-catalog coverage before rendering.

Edit the JSON source, then run from the repository root:

```bash
node dev/render-roadmap.mjs --write
node dev/render-roadmap.mjs --check
node dev/test-roadmap.mjs
```

CI fails if the generated document drifts from its source. This check proves the
roadmap's structure and correspondence, not the truth of its product assumptions;
those are governed by the roadmap's controls, metrics, and kill criteria.

## Living-conspectus baseline

[`dev/conspectus/self-baseline.json`](dev/conspectus/self-baseline.json) is the
immutable A0 self-survey pinned to commit `b8b566f`. It owns the expected file,
subsystem, concern, seam, run, and export sets. The checker derives
[`dev/conspectus/baseline-report-detector-1.0.0.json`](dev/conspectus/baseline-report-detector-1.0.0.json)
from that fixture and fails if the checked-in successor report drifts. The
original [`dev/conspectus/baseline-report.json`](dev/conspectus/baseline-report.json)
remains frozen under its unversioned historical checker; the detector registry
preserves both identities.

Run both A0 commands after changing the fixture or completion contract. The
control test removes obligations independently, executes all eight graded
controls, regenerates an export under a clean temporary root, and reads state,
coverage, and content back. A detector change requires an explicit successor
report identity. Retargeting the baseline requires a new fixture ID,
revision/tree inventory, and report; do not edit the existing fixture to follow
HEAD.

## Auto-generated tool inventory

The block between `<!-- TOOL-INVENTORY-START -->` and
`<!-- TOOL-INVENTORY-END -->` in [`mcp-server/DEVELOPMENT.md`](mcp-server/DEVELOPMENT.md)
is generated from the running server's `tools/list` response by
`mcp-server/scripts/gen-tool-inventory.mjs`. **CI fails on drift.**
After adding, removing, or modifying a tool description, regenerate:

```bash
cd mcp-server
node scripts/gen-tool-inventory.mjs
```

Commit the regenerated `DEVELOPMENT.md` alongside the code change.

## Architectural contracts

A few things are load-bearing and easy to break inadvertently. If
your change touches one, the contract belongs in the server, not
in agent prose:

- **Knowledge-depth gates.** A subsystem's status determines what
  claims its agents are authorized to make. `update_subsystem_status`
  rejects regressions; `reset_subsystem` is the explicit escape hatch
  that also discards dependent rows.
- **Evidence requirements.** Dispositions and findings cannot be
  written without an evidence anchor (file:symbol@sha) and an
  evidence-quality tag.
- **Phase-gate idempotency.** `commit_phase_gate` is a no-op when
  nothing has changed since the last commit.
- **Generated mirrors.** `mcp-server/skills/` and `mcp-server/materializer/`
  are regenerated by
  `scripts/prepack-bundle-assets.mjs` at `npm pack` time and are
  gitignored. Edit the repo-root sources of truth instead.
- **Unattended refresh custody.** A refresh manifest is immutable. Provider
  work crosses a durable dispatch/landing boundary, and completion requires
  exact obligation reconciliation plus final projection read-back. Extend
  `test-refresh-recovery.mjs` whenever a mutating stage or authority axis is
  added.
- **Review-brief custody.** Required context comes from the durable impact
  artifact, every retrieval choice has an immutable trace, and seam provenance
  is independently reconciled before publication. Extend
  `test-review-brief.mjs` whenever a required section, context profile, or
  publication gate changes.
- **Independent-review custody.** Generator, refuter, and verifier passes cross
  separate durable dispatch/landing boundaries. Challenge packets exclude
  rationale, confidence, pass identity, and prior verdicts; exact fan-in is
  required before mechanical aggregation. Extend `test-review-analysis.mjs`
  whenever a role packet, condition axis, verdict rule, blind arm, or scoring
  denominator changes.
- **Composition custody.** Unit success cannot imply system success. Expected
  artifacts, commits, tests, and review results must reconcile exactly before
  a separate clean-checkout integral lane runs against the assembled HEAD.
  Extend `test-composition.mjs` whenever an item kind, seam-selection rule,
  deferral destination, checkout proof, or final fan-in condition changes.
- **Review-session custody.** The compact decision surface is derived from a
  reconciled composition and preserves operational labels for regressions,
  latent defects, ruled-out history, suspicions, and unknowns. Every actionable
  item expands to its durable record and evidence in one call. Export success
  requires independent state, coverage, and content read-back. Extend
  `test-review-session.mjs` whenever a section, label, expansion, completion,
  export, or user-evaluation contract changes.
- **CodebaseBrief custody.** The versioned contract is not a storage DTO.
  Review, design, and generative projections share one immutable source hash;
  exact registry identity precedes deterministic lexical selection, and every
  unselected candidate has a policy, irrelevance, or budget reason. Extend
  `test-codebase-brief.mjs` whenever a category, epistemic kind, mode policy,
  selection route, budget rule, or omission contract changes.
- **Design-session custody.** Immanent, adversarial, and speculative lenses
  dispatch independently over controlled projections before any output lands.
  Aggregation preserves disagreement and may furnish advice, never acceptance;
  unresolved desire conflicts force underdetermination. Extend
  `test-design-session.mjs` whenever a lens packet, option field, desire rule,
  aggregation condition, or evaluation-blinding guard changes.
- **Decision custody.** Generated recommendations remain immutable drafts until
  a human or owning-system acceptance event names its actor, authority source,
  and matching scope. Premise impacts create blocking obligations rather than
  editing accepted history; rejected and superseded revisions remain readable.
  Extend `test-decisions.mjs` whenever an authority transition, premise kind,
  impact route, revision rule, or portable projection field changes.
- **Research-broker custody.** A research request must resolve to a named
  decision field, exhaust local evidence, cross a durable Scholiast handoff,
  and land external sources with access status and limitations. External claims
  never enter the repository-claim table; contradictions preserve both sides.
  Extend `test-research-broker.mjs` whenever admission, queue transitions,
  handoff fields, source confidence, result targeting, or consumption changes.
- **Crosswalk and method-qualification custody.** Similar labels create an
  identity question, not an automatic merge. Relations use a finite vocabulary
  with positive and negative criteria; counterevidence remains attached through
  supersession. An unattended method must cross a frozen, authorized Collatio
  adapter plan, mechanically scored controls and red gates, and artifact
  read-back before SQLite accepts activation. Extend
  `test-crosswalk-qualification.mjs` whenever identity resolution, relation
  semantics, qualification axes, policy activation, or projection content
  changes. The checked-in fixture demonstrates the adapter only; it does not
  assert that the Collatio v2 research program itself is authorized or passed.
- **Learning-ledger custody.** Distillation outcomes retain exact planned,
  produced, accepted, and later-invalidated artifact counts. Corpus, retrieval,
  method, research, and user-preference lessons cannot exchange epistemic kinds
  or evidence classes. Every policy change starts as a candidate, passes a
  scored channel-specific evaluation, stages as an immutable version, and turns
  active only after the next-run representation reads back on state, coverage,
  and content. Supersession preserves both lesson and policy history plus the
  selector for affected future runs. Extend `test-learning-ledger.mjs` whenever
  an outcome state, channel, qualification rule, lifecycle transition,
  rollback field, or runtime policy representation changes.
- **Operating-envelope custody.** Evaluation manifests freeze repository,
  change, mode, context, model/runtime, metric, MDE, stopping, control, and
  replicate assignments before results land. Publication requires exact fan-in,
  instrument clearance, per-stratum derivation, and positive-claim alternative
  review; it never emits pooled efficacy. Extend `test-operating-envelope.mjs`
  whenever a condition role, metric contract, instrument state, stratum field,
  verdict rule, exclusion field, or report projection changes.
- **Chorusmith-adapter custody.** Project-type manifests freeze an exact commit,
  allowlisted adapter/tool mapping, ordered step arguments, output keys, direct
  parity snapshot, and recovery/time policy. Adapter execution must invoke the
  existing Amanuensis handler inside the step transaction; it may not write
  domain tables. No feature leaves `retained-direct` until behavior, evidence,
  restart recovery, and verification-time parity are green. Extend
  `test-chorusmith-adapter.mjs` whenever an adapter version, allowed operation,
  custody owner, parity field, restart rule, or extraction status changes.
- **Historical-evaluation custody.** Exact tasks and evaluator oracles live
  outside the public product repository. Every admitted case resolves full
  target/fix commits, exports a history-free participant packet, fails its
  hidden oracle before the repair, passes after it, and scans forbidden future
  fragments and canaries before scoring. A qualification receipt proves the
  instrument path only; it is never an efficacy result. Corpus schema and
  detector versions are separate, detector mismatch is out-of-band rather than
  repository drift, ordinary receipts are create-only, and explicit rebaseline
  creates a new manifest and mandatory successor receipt without mutating the
  source. Extend
  `test-historical-evaluation.mjs` whenever manifest custody, export, leakage,
  witness, scoring, timeout, or receipt behavior changes.

## Commits

Write descriptive commit messages. Lead with the *why*; the diff
shows the *what*. Multi-line messages are welcome — the public
history is the design rationale future contributors will read.

## Reporting issues

File issues at <https://github.com/nfeldman/amanuensis/issues>.
Reproductions against `node test-smoke.mjs` or a small example
codebase are helpful but not required.
