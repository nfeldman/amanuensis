# amanuensis-materializer

Renders a navigable human-facing architectural conspectus from the
Amanuensis `memory.db` and the project's prose artifacts. Every materialized
Markdown page has a first-class HTML companion; `index.html` is the primary
reading surface and Markdown remains the portable, inspectable projection.

The database is the agent's source of truth. The materialized docs are
the human's source of truth. Both exist; neither is a cache of the
other.

## What it produces

Under `<project-storage>/docs/` (each `.md` page below is accompanied by a
same-path `.html` page):

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
.projection-contract.json post-xref publication and read-back receipt
```

The HTML projection is self-contained: it makes no font, stylesheet,
JavaScript, or diagram-renderer requests. It can be opened directly from the
filesystem or served by any static server. Its global navigation uses
human-facing page names and descriptions, exposes subsystem IDs without making
them the primary label, supports name/ID/topic filtering, and keeps Markdown
one click away for audit.

Status, severity, evidence-quality, and survey-depth values render with plain
language labels and explanatory hints. Recorded runtime boundaries render as
embedded SVG with an equivalent readable relationship account. Generated
Mermaid relationship data is projected into accessible linked relationship
traces and staleness bars, so the browser view never depends on a client-side
Mermaid runtime.

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
4. Transform the finished, post-xref Markdown into HTML. Shared navigation is
   rebuilt from the complete page plan, so renamed, added, removed, or
   status-changed subsystems are reflected everywhere in the same run.
5. Retire pages whose generators no longer exist (both their Markdown and
   HTML files, plus their manifest entries, are deleted).
6. Read both formats back independently for state markers, planned-page and
   local-link coverage, fragment targets, and byte correspondence.

Bumping `MATERIALIZER_VERSION` in `manifest.py` invalidates every page.
`--force-full` does a full rebuild without touching the version.

## Run

```bash
python3 materialize.py --storage /path/to/project/.amanuensis
```

With optional flags:

- `--output <dir>` — output dir (default: `<storage>/docs`)
- `--force-full` — ignore the manifest and rebuild every page
- `--clean-publish` — render and verify in isolation before promotion
- `--readback-only` — verify the existing projection without changing it

On success the last line of stdout is a JSON summary the MCP server's
`materialize_docs` tool parses.

Every normal render writes `.projection-contract.json` after global
cross-reference resolution and HTML generation, then reads both finished
formats back on independent state, coverage, and content axes. Healthy
Markdown cannot mask damaged HTML, or vice versa. A read-back failure makes
the command fail.

For publication, use clean staging:

```bash
python3 materializer/materialize.py --storage /path/to/conspectus --clean-publish
```

This promotes the staged output only after all three axes pass. To audit an
existing projection without changing it:

```bash
python3 materializer/materialize.py --storage /path/to/conspectus --readback-only
```

The MCP `verify_materialized_docs` tool additionally records each run and its
mismatches in `memory.db`. Verification never edits durable source records to
make them agree with a derived projection.

## Called from the MCP server

`mcp-server/src/tools/materialize.ts` exposes `materialize_docs` which
shells out to this script. Set `AMANUENSIS_MATERIALIZER` to a custom
`materialize.py` path, or `AMANUENSIS_PYTHON` to a custom Python
interpreter, to override the defaults.

## Tests

```bash
python3 test-materializer.py
python3 test-readback.py
```

Seeds a temp DB, runs the materializer five times (full render,
no-op, prose change, add subsystem, remove subsystem) and verifies the
manifest-driven behavior in both formats at each step. The read-back suite
damages finding markers, cross-links, and stale markers in Markdown and HTML
independently and requires the gate to turn red on the appropriate axis.
