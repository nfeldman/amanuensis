# amanuensis-materializer

Renders a navigable human-facing architectural conspectus from the
Amanuensis `memory.db` and the project's prose artifacts.

The database is the agent's source of truth. The materialized docs are
the human's source of truth. Both exist; neither is a cache of the
other.

## What it produces

Under `<project-storage>/docs/`:

```
index.md                project overview, navigation
architecture.md         runtime map + dependency graph + seam graph + staleness
master-plan.md          subsystem registry, grouped by layer
findings.md             confirmed findings, sortable by severity
concerns.md             active concerns + coverage heatmap
seams.md                inter-subsystem boundaries + assessability status
contradictions.md       epistemic conflicts, resolved and open
diagnosticity.md        ACH matrices (when concerns compete)
vocabulary.md           codebase-native glossary
field-notes.md          peripheral observations by category
onboarding-report.md    passthrough of the onboarding report
entry-point.md          passthrough of the entry-point doc
subsystems/
  b01-<slug>.md         per-subsystem survey pages
  ...
diagnosticity/
  dm-<id>.md            per-matrix detail pages
.manifest.json          diff-aware rendering manifest
```

## Diff-aware rendering

`.manifest.json` records, per page, the source identifiers it was
rendered from and their content hashes. Sources are one of:

- `db:<logical-name>` — canonical-JSON hash of a DB query result
- `prose:<relative-path>` — sha256 of a markdown file
- `synthetic:<name>` — no stable source; always re-rendered

On each run we:

1. Compute every page's current source hashes.
2. Write only pages whose sources changed, whose content hash changed,
   or that are missing on disk.
3. Run a global cross-reference resolver over every alive page — IDs
   like `B-01`, `CC-1`, `SM-3`, `B01-1`, `DM-5` become working links,
   skipping code fences, inline code, and self-references.
4. Retire pages whose generators no longer exist (their files and
   manifest entries are deleted).

Bumping `MATERIALIZER_VERSION` in `manifest.py` invalidates every page.
`--force-full` does a full rebuild without touching the version.

## Run

```bash
python3 materialize.py --storage ~/.amanuensis/workspaces/<owner>/<repo>
```

With optional flags:

- `--output <dir>` — output dir (default: `<storage>/docs`)
- `--force-full` — ignore the manifest and rebuild every page

On success the last line of stdout is a JSON summary the MCP server's
`materialize_docs` tool parses.

## Called from the MCP server

`mcp-server/src/tools/materialize.ts` exposes `materialize_docs` which
shells out to this script. Set `AMANUENSIS_MATERIALIZER` to a custom
`materialize.py` path, or `AMANUENSIS_PYTHON` to a custom Python
interpreter, to override the defaults.

## Tests

```bash
python3 test-materializer.py
```

Seeds a temp DB, runs the materializer five times (full render,
no-op, prose change, add subsystem, remove subsystem) and verifies the
manifest-driven behavior at each step.
