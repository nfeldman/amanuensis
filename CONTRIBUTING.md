# Contributing

Amanuensis ships from this repository. The MCP server, the agent
files, and the materializer all live here, and they all have to
work together — schema changes ripple into tool handlers and into
materialized output, so the test suite is broad on purpose.

## Setup

- Node.js ≥ 20
- Python 3.11+ (stdlib only — no `pip install` for the materializer
  itself; `ruff` is needed only for the lint step)

```bash
git clone https://github.com/nfeldman/amanuensis
cd amanuensis/mcp-server
npm ci
npm run build
```

The build produces `dist/`. Point your VS Code MCP config at
`mcp-server/dist/index.js` to run the server out of the source
checkout instead of the published package.

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
node test-adversarial-correctness.mjs   # tries to violate the data contracts
node test-adversarial-security.mjs      # input handling, SQL safety, path traversal
node test-resolution-proof.mjs          # repair proof and append-only resolution history
node test-projection-custody.mjs        # projection mismatch custody and repair

node scripts/check-sql-identifiers.mjs  # SQL identifiers resolve against schema
node scripts/check-tool-schemas.mjs     # tool inputSchemas are valid JSON Schema
node scripts/gen-tool-inventory.mjs --check  # DEVELOPMENT.md inventory is current
```

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
[`dev/conspectus/baseline-report.json`](dev/conspectus/baseline-report.json) from
that fixture and fails if the checked-in report drifts.

Run both A0 commands after changing the fixture or completion contract. The
control test removes obligations independently, executes all eight graded
controls, regenerates an export under a clean temporary root, and reads state,
coverage, and content back. Retargeting the baseline requires a new fixture ID,
revision/tree inventory, and baseline report; do not edit the existing fixture
to follow HEAD.

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
- **Generated mirrors.** `mcp-server/agents/` and
  `mcp-server/materializer/` are regenerated by
  `scripts/prepack-bundle-assets.mjs` at `npm pack` time and are
  gitignored. Edit the repo-root sources of truth instead.

## Commits

Write descriptive commit messages. Lead with the *why*; the diff
shows the *what*. Multi-line messages are welcome — the public
history is the design rationale future contributors will read.

## Reporting issues

File issues at <https://github.com/nfeldman/amanuensis/issues>.
Reproductions against `node test-smoke.mjs` or a small example
codebase are helpful but not required.
