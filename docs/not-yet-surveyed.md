# Not yet surveyed

The recorded edge of the map at `0fee11b0fea1` on `reader-lenses`. Each section counts the unit its gap actually occupies and carries that unit's denominator: a file that no one has read, a seam side no one has assessed, and a concern no one has dispositioned here are three different kinds of not-knowing, and none of them is evidence about the others.

## Paths with no ledger row

**0 of 55** tracked paths are named by no `file_ledger` row in any subsystem. They participate in no subsystem's scope, so nothing here has been read, excluded, or deferred.

## Files in scope that no one has read

**25 of 58** ledger rows that carry a survey obligation are classified `candidate`: the file participates in its subsystem and no one has read it.

### Server runtime and tool dispatch **[B-01](subsystems/b01-server-runtime-and-tool-dispatch.md)** — 1 unread of 7 rows carrying an obligation

- `mcp-server/package.json` — Declares the bin entry and the build that produces dist/index.js, which is what a host actually launches.

### Repository binding and storage custody **[B-02](subsystems/b02-repository-binding-and-storage-custody.md)** — 2 unread of 4 rows carrying an obligation

- `mcp-server/src/codex-host.ts` — Workspace discovery when the host is Codex and the launch cwd is not the repository root; feeds resolveProject's selection source.
- `mcp-server/src/storage-git.ts` — The storage directory's own git repository — the mechanism behind commit_phase_gate and the only record of a discarded store.

### Conspectus schema, vocabulary, and invariants **[B-03](subsystems/b03-conspectus-schema-vocabulary-and-invariants.md)** — 1 unread of 4 rows carrying an obligation

- `mcp-server/src/vocabulary.ts` — The generated TypeScript enum module the validators import; one of the four parties to the vocabulary contract.

### Survey record tools **[B-04](subsystems/b04-survey-record-tools.md)** — 5 unread of 8 rows carrying an obligation

- `mcp-server/src/tools/artifacts.ts` — register_artifact and rehash_artifact bind prose to a content hash and a revision.
- `mcp-server/src/tools/evidence.ts` — add_evidence writes the rows every claim is attached to; its kind column is the vocabulary the file-anchored check reads.
- `mcp-server/src/tools/files.ts` — add_files_to_scope and update_file_classification write the file ledger the standing view reads.
- `mcp-server/src/tools/seams.ts` — upsert_seam records the boundary an edge is expected to accompany.
- `mcp-server/src/tools/subsystems.ts` — upsert_subsystem and update_subsystem_status, where the phase prerequisites are called from.

### Findings, dispositions, and resolution custody **[B-05](subsystems/b05-findings-dispositions-and-resolution-custody.md)** — 4 unread of 5 rows carrying an obligation

- `mcp-server/src/tools/concerns.ts` — add_concern and the coverage view the checklist is read back through.
- `mcp-server/src/tools/contradictions.ts` — The second record family with its own resolution event table, which the History lens reads beside findings.
- `mcp-server/src/tools/dispositions.ts` — set_disposition is the concerns phase's deliverable and the prerequisite for the adversarial advance.
- `mcp-server/src/tools/resolution.ts` — verify_finding_fix and the audit tool: post-fix evidence at the repaired revision, with ancestry checked.

### Git state, staleness, and refresh **[B-07](subsystems/b07-git-state-staleness-and-refresh.md)** — 3 unread of 4 rows carrying an obligation

- `mcp-server/src/tools/impact.ts` — predict_change_impact and apply_change_impact, which close claims a change has overtaken.
- `mcp-server/src/tools/refresh.ts` — Unattended refresh runs: planning, execution, and the final read-back over the backlog.
- `mcp-server/src/tools/stale.ts` — The stale backlog readers and clear_staleness, which is how an obligation is discharged.

### Materializer rendering pipeline **[B-08](subsystems/b08-materializer-rendering-pipeline.md)** — 3 unread of 5 rows carrying an obligation

- `materializer/amanuensis_materializer/html_projection.py` — The self-contained HTML index and its no-JavaScript reading path.
- `materializer/amanuensis_materializer/renderers.py` — One renderer per page; where claims, findings and prose become Markdown.
- `materializer/materialize.py` — The CLI the server spawns; the process boundary between the two languages.

### Projection read-back and publication custody **[B-09](subsystems/b09-projection-read-back-and-publication-custody.md)** — 2 unread of 3 rows carrying an obligation

- `materializer/amanuensis_materializer/manifest.py` — The manifest the diff-aware renderer and the contract are both written from.
- `mcp-server/src/tools/materialize.ts` — The tool that spawns the CLI and resolves its output path under project storage, which is why a publish cannot write the tracked docs/ directly.

### The Amanuensis skill **[B-10](subsystems/b10-the-amanuensis-skill.md)** — 2 unread of 5 rows carrying an obligation

- `.claude/skills/amanuensis/references/phase-1-scope.md` — The file-ledger discipline every later phase's denominator depends on.
- `.claude/skills/amanuensis/references/reporting-style.md` — The register rules every label, hint and page this system emits is written to.

### Development harness and gates **[B-11](subsystems/b11-development-harness-and-gates.md)** — 2 unread of 7 rows carrying an obligation

- `dev/check-living-conspectus.mjs` — Checks the immutable A0 historical fixture, which the rebuild must leave untouched.
- `mcp-server/scripts/gen-tool-inventory.mjs` — Generates the tool inventory in DEVELOPMENT.md and re-checks it, so a new tool cannot land undocumented.

## Subsystems set aside

**1 of 12** subsystems are deferred. `deferred` is not a rung on the survey ladder but an orthogonal do-not-survey flag, so nothing in them has been surveyed at any depth.

| Subsystem | Layer | Recorded reason |
|---|---|---|
| [Vendored research corpus](subsystems/b12-vendored-research-corpus.md) **[B-12](subsystems/b12-vendored-research-corpus.md)** | corpus | Deferred, not omitted: 103 tracked files that no part of the running system imports or executes. Recorded so the census counts them rather than reporting complete coverage over a repository it never looked at. |

## Seam sides no one has assessed

**0 of 18** (seam, side) pairs carry no recorded assessment. The unit is the pair, not the seam: a seam assessed from one side only is half-known, and counting seams would report it as covered.

Binding: per-party-proxy; no seam-bound disposition is recorded. An `SC-%` disposition says a party has assessed some seam concern, never that it assessed this seam.

## Concerns no one has dispositioned here

**96 of 180** (subsystem, active concern) pairs carry no disposition. The unit is the pair: a concern dispositioned somewhere else says nothing about this subsystem, and counting concern codes would report a checklist as complete while most regions were never tested against it.

| Subsystem | Undispositioned | Concerns |
|---|---|---|
| [Server runtime and tool dispatch](subsystems/b01-server-runtime-and-tool-dispatch.md) **[B-01](subsystems/b01-server-runtime-and-tool-dispatch.md)** | 6 of 15 | **[SC-2](concerns.md#sc-2)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-6](concerns.md#sc-6)**, **[SC-7](concerns.md#sc-7)**, **[SC-8](concerns.md#sc-8)** |
| [Repository binding and storage custody](subsystems/b02-repository-binding-and-storage-custody.md) **[B-02](subsystems/b02-repository-binding-and-storage-custody.md)** | 6 of 15 | **[SC-3](concerns.md#sc-3)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-7](concerns.md#sc-7)**, **[SC-8](concerns.md#sc-8)**, **[SC-9](concerns.md#sc-9)** |
| [Conspectus schema, vocabulary, and invariants](subsystems/b03-conspectus-schema-vocabulary-and-invariants.md) **[B-03](subsystems/b03-conspectus-schema-vocabulary-and-invariants.md)** | 6 of 15 | **[SC-1](concerns.md#sc-1)**, **[SC-3](concerns.md#sc-3)**, **[SC-5](concerns.md#sc-5)**, **[SC-6](concerns.md#sc-6)**, **[SC-7](concerns.md#sc-7)**, **[SC-9](concerns.md#sc-9)** |
| [Survey record tools](subsystems/b04-survey-record-tools.md) **[B-04](subsystems/b04-survey-record-tools.md)** | 8 of 15 | **[SC-1](concerns.md#sc-1)**, **[SC-2](concerns.md#sc-2)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-6](concerns.md#sc-6)**, **[SC-7](concerns.md#sc-7)**, **[SC-8](concerns.md#sc-8)**, **[SC-9](concerns.md#sc-9)** |
| [Findings, dispositions, and resolution custody](subsystems/b05-findings-dispositions-and-resolution-custody.md) **[B-05](subsystems/b05-findings-dispositions-and-resolution-custody.md)** | 8 of 15 | **[SC-1](concerns.md#sc-1)**, **[SC-2](concerns.md#sc-2)**, **[SC-3](concerns.md#sc-3)**, **[SC-4](concerns.md#sc-4)**, **[SC-6](concerns.md#sc-6)**, **[SC-7](concerns.md#sc-7)**, **[SC-8](concerns.md#sc-8)**, **[SC-9](concerns.md#sc-9)** |
| [Locus standing and the reader lenses](subsystems/b06-locus-standing-and-the-reader-lenses.md) **[B-06](subsystems/b06-locus-standing-and-the-reader-lenses.md)** | 7 of 15 | **[SC-1](concerns.md#sc-1)**, **[SC-2](concerns.md#sc-2)**, **[SC-3](concerns.md#sc-3)**, **[SC-6](concerns.md#sc-6)**, **[SC-7](concerns.md#sc-7)**, **[SC-8](concerns.md#sc-8)**, **[SC-9](concerns.md#sc-9)** |
| [Git state, staleness, and refresh](subsystems/b07-git-state-staleness-and-refresh.md) **[B-07](subsystems/b07-git-state-staleness-and-refresh.md)** | 9 of 15 | **[SC-1](concerns.md#sc-1)**, **[SC-2](concerns.md#sc-2)**, **[SC-3](concerns.md#sc-3)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-6](concerns.md#sc-6)**, **[SC-7](concerns.md#sc-7)**, **[SC-8](concerns.md#sc-8)**, **[SC-9](concerns.md#sc-9)** |
| [Materializer rendering pipeline](subsystems/b08-materializer-rendering-pipeline.md) **[B-08](subsystems/b08-materializer-rendering-pipeline.md)** | 7 of 15 | **[SC-1](concerns.md#sc-1)**, **[SC-2](concerns.md#sc-2)**, **[SC-3](concerns.md#sc-3)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-8](concerns.md#sc-8)**, **[SC-9](concerns.md#sc-9)** |
| [Projection read-back and publication custody](subsystems/b09-projection-read-back-and-publication-custody.md) **[B-09](subsystems/b09-projection-read-back-and-publication-custody.md)** | 8 of 15 | **[SC-1](concerns.md#sc-1)**, **[SC-2](concerns.md#sc-2)**, **[SC-3](concerns.md#sc-3)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-6](concerns.md#sc-6)**, **[SC-8](concerns.md#sc-8)**, **[SC-9](concerns.md#sc-9)** |
| [The Amanuensis skill](subsystems/b10-the-amanuensis-skill.md) **[B-10](subsystems/b10-the-amanuensis-skill.md)** | 8 of 15 | **[SC-1](concerns.md#sc-1)**, **[SC-2](concerns.md#sc-2)**, **[SC-3](concerns.md#sc-3)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-6](concerns.md#sc-6)**, **[SC-7](concerns.md#sc-7)**, **[SC-9](concerns.md#sc-9)** |
| [Development harness and gates](subsystems/b11-development-harness-and-gates.md) **[B-11](subsystems/b11-development-harness-and-gates.md)** | 8 of 15 | **[SC-1](concerns.md#sc-1)**, **[SC-2](concerns.md#sc-2)**, **[SC-3](concerns.md#sc-3)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-6](concerns.md#sc-6)**, **[SC-7](concerns.md#sc-7)**, **[SC-8](concerns.md#sc-8)** |
| [Vendored research corpus](subsystems/b12-vendored-research-corpus.md) **[B-12](subsystems/b12-vendored-research-corpus.md)** | 15 of 15 | **[BV-1](concerns.md#bv-1)**, **[CC-1](concerns.md#cc-1)**, **[EV-1](concerns.md#ev-1)**, **[GT-1](concerns.md#gt-1)**, **[RC-1](concerns.md#rc-1)**, **[SC-1](concerns.md#sc-1)**, **[SC-2](concerns.md#sc-2)**, **[SC-3](concerns.md#sc-3)**, **[SC-4](concerns.md#sc-4)**, **[SC-5](concerns.md#sc-5)**, **[SC-6](concerns.md#sc-6)**, **[SC-7](concerns.md#sc-7)**, **[SC-8](concerns.md#sc-8)**, **[SC-9](concerns.md#sc-9)**, **[ZD-1](concerns.md#zd-1)** |

