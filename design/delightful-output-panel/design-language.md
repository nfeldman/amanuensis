# Field Docket design language

Implementation-ready language for Amanuensis's self-contained HTML projection. The working specimen is `prototype/index.html`; this document describes the durable rules behind it, not its every pixel.

## North star

> **Lead with consequence, keep the coordinate, expose the warrant, and never make the reader infer whether the publication itself is coherent.**

Delight is the feeling that the report remembers the reader's purpose while refusing false certainty. It comes from legible hierarchy, precise status language, quick recovery, tactile editorial composition, and receipts that are close but not oppressive.

## Non-negotiable separations

Never collapse these into one score, badge, or color:

| Axis | Question it answers | Required visible form |
|---|---|---|
| Source identity | What code state was checked? | Branch, checked SHA, and check time where available |
| Publication identity | Which rendered report state is this? | Immutable publication ID/content hash plus generated time |
| Survey reach | Where are behavioral claims authorized? | Mapped/total plus explicit unmapped meaning |
| Consequence | What confirmed matters need attention? | Severity counts and named lead cases |
| Publication integrity | Did summary and source registers agree at read-back? | `verified`, `warning`, or `not checked`, with reasons |
| Contradictions | Are incompatible finding pairs recorded? | Full phrase “recorded contradictory finding pairs,” never bare “contradictions” |
| Reader baseline | What did this reader last see? | Named prior publication or explicit `unknown`; device-local state labeled as such |
| Active work | What is the survey process doing now? | Separate session/process record, never paraphrased as a completed delta |

## Publication anatomy

### Six global landmarks

1. **Current briefing** — one-breath project model, four-axis condition band, lead matter, task routes.
2. **Risks & decisions** — vertical casefiles grouped by action: contain/verify, repair, clarify intent/capability, survey next.
3. **System terrain** — architectural regions, 34 subsystem records, status, findings, and readable seams.
4. **Trust boundary** — evidence contract, coverage, questions, contradictions, diagnosticity, field notes, and projection integrity.
5. **Re-entry** — publication comparison, device-local optional trail, and active survey work as three separate rows.
6. **Case register** — compact expert comparison mode plus durable source routes.

Reference/method pages remain first-class and searchable, but do not compete as equal first-level entrances.

### Stable reading sequence

Every overview follows:

1. project definition;
2. separate source/coverage/consequence/integrity conditions;
3. leading consequential matter with qualification;
4. system terrain;
5. trust boundary;
6. re-entry state;
7. compact registers and methods.

Task routes jump or highlight this sequence. They do not secretly reorder the publication.

## Component contracts

### `CompassLine`

**Purpose:** expose location at deep arrivals.

**Required data:** project name, architectural region or report landmark, record name/ID, survey depth, checked SHA.

**Rules:** ordinary links; current item is text plus `aria-current`; responsive wrapping; no assumption that breadcrumbs alone improve performance. On a finding-led excursion, add a visible `Return to V02-1 decision` link near the destination.

### `ConditionBand`

**Purpose:** keep separate epistemic axes emotionally distinct.

**Required items:** source identity, survey reach, consequence, publication integrity. Each item has a noun label, plain-language value, and one-sentence limitation.

**Rules:** no color-only meaning; no green “all clear”; four items become 2×2, then one column; printed intact; each value links to its register/definition where the full site has the route.

### `RouteCard`

**Purpose:** translate reader intent into a named path.

**Required routes:** act, understand, audit, resume.

**Rules:** semantic anchors with descriptive destinations; no client-only routing; highlight/jump only.

### `Casefile`

**Purpose:** make a finding usable without stripping qualification.

**Always-visible face:**

- severity, finding status, evidence quality, finding ID, subsystem ID/name;
- human consequence and affected surface;
- the next safe action separated into verify/contain/repair where appropriate;
- the assumption, scope boundary, or open decision that can change remedy/grade;
- checked/ref SHA and direct routes to the full finding and subsystem.

**Disclosable receipts:** root-cause mechanics, file/line handles, full counterargument, concern history, adversarial record, and long excerpts.

The visible face is deliberately taller than a dashboard tile. Disclosure accessibility does not make an essential qualifier safe to hide.

### `EvidenceAperture`

Use native `<details><summary>` for one coherent secondary evidence block. Summary text names what opens: `Open the evidence aperture · three composing decisions`. Do not use “More,” “Details,” or an icon-only control. Do not nest disclosure layers.

### `TerritoryAtlas`

**Purpose:** show surveyed and blank territory together without claiming a complete dependency graph.

**Required data per region:** region name, mapped/total count, subsystem ID/name/status, highest open severity, topic terms.

**Rules:** filled marker = survey-depth mapped; hollow marker = no authorized behavioral claim; squared signal = open finding. All meanings repeat in text/tooltips and in the subsystem result. Group by architectural region before priority. A complete text list is the baseline; diagrams are optional enhancement.

### `RelationshipTrail`

**Purpose:** express a seam as a sentence and preserve investigative context.

Format: `[party A] — typed shared object/action → [party B]`, with both named endpoints and a local return-to-case link. Horizontal layout may scroll as a unit; narrow fallback may become a vertical ordered list. Never emit unlabeled graph edges as the only relationship account.

### `ReentryPanel`

Three fixed cards:

1. **Publication delta:** two immutable endpoints and actual changes, or `comparison unavailable`.
2. **This device:** optional local trail, explicitly local and clearable.
3. **Active survey work:** process state and named next trail.

No timestamp or active-session phrase may be converted into “since your last visit” without a known reader baseline.

### `IntegrityNotice`

**Purpose:** make projection read-back a publication property.

`verified` means summary counts, page inventory, local links/fragments, and key register aggregates agree for the emitted files. `warning` lists exact mismatches. `not checked` is distinct from both. Integrity never means the surveyed conclusions are true.

### `SourceEscape`

Every page retains a one-action Markdown companion plus branch/SHA/publication identity. Links use the report's ordinary local relative paths in production; the prototype uses explicit `file://` routes only because it lives outside the generated AxiomDB directory.

## Content grammar

### Findings

Preferred sentence order:

1. **What happens to a user/system?**
2. **Where is it reachable?**
3. **Why is it believed?**
4. **What remains unsettled?**
5. **What is the next appropriate action?**
6. **Where are the receipts?**

Lead with `Unauthenticated HTTP requests can read and write as the system tenant`, not an internal function name. Preserve the function names in receipts.

### Status language

- `mapped` → “Surveyed through stated gates; behavior claims are available at recorded evidence quality.”
- `unmapped` → “No behavioral claims are authorized yet.”
- `fresh` → avoid as a standalone adjective; write “Source checked at …”.
- `0 contradictions` → “No contradictory finding pairs recorded.”
- `code-verified` → “Implementation read at the cited SHA”; never “certain.”
- `comparison unavailable` → complete state, not an empty state.

### Voice

Calm, exact, and humane. Prefer consequences and verbs. Write limits in full sentences. Identifiers remain visible but secondary to names. Avoid “health,” “confidence score,” “all clear,” “complete,” and “safe” unless the exact object and authorization are named.

## Visual tokens

The prototype token block is the reference implementation.

### Core palette

| Token | Light | Dark | Job |
|---|---|---|---|
| `--paper` | `#f4f1e8` | `#131a17` | page field |
| `--surface` | `#fffdf7` | `#1b2420` | reading surface/cards |
| `--ink` | `#17211e` | `#edf0e8` | primary text |
| `--ink-soft` | `#4e5c56` | `#b4c0b9` | secondary prose |
| `--teal-deep` | `#083d38` | `#b0ded6` | links, identity, mapped/source signal |
| `--coral-deep` | `#812b22` | `#ffb3a4` | critical/consequential emphasis |
| `--amber` | `#8d5a16` | `#e4b46d` | coverage/qualified attention |
| `--blue` | `#315f80` | `#91b9d2` | publication/integrity state |

Measured contrast ratios for primary pairs are 6.91:1 or greater in both themes: light ink/surface 16.22, soft/surface 6.91, teal-deep/surface 11.90, coral-deep/coral-soft 6.97; dark equivalents 13.81, 8.47, 10.81, and 7.60. Runtime zoom/forced-colors/AT validation remains required before a conformance claim.

### Typography

- Display: local system book serif stack; no downloaded font.
- Body: platform sans stack.
- Metadata: platform monospace stack.
- H1: `clamp(3.2rem, 7vw, 6.8rem)`, tight line height; mobile clamps independently.
- Reading prose: 16px base, 1.62 line height, maximum `72ch`.
- Never use display type for status text or code handles.

### Spacing and shape

- Base increments: `.25rem`, `.5rem`, `.75rem`, `1rem`, `1.5rem`, `2.25rem`, `3rem`, `4.5rem`.
- Borders are square or softly `.2rem`; pills are reserved for compact metadata, never whole cards.
- Use double rules for publication boundaries and one coral side-rule for consequential casefiles.
- Shadows are low-contrast depth cues, not floating-app chrome.
- Maximalism is a rare static event (hero scale/grid), never a constant texture.

## Interaction contract

Baseline HTML provides all content, routes, `<details>`, and source links.

Optional JavaScript may add:

- name/ID/topic specimen search;
- mobile navigation drawer;
- theme preference;
- clearly labeled device-local trail pinning.

It may not:

- fetch required content;
- change finding order invisibly;
- create the only relationship rendering;
- infer publication delta;
- hide essential qualifiers;
- make route recovery depend on localStorage.

Keyboard: `Cmd/Ctrl+K` focuses search; Escape closes only the mobile drawer; native controls retain native keys. Respect reduced motion. Forced-color behavior and screen-reader/keyboard order require output-level verification.

## Responsive behavior

- **≥1120px:** fixed 19rem rail; four-column condition band; three-column atlas; sticky local section map.
- **881–1119px:** fixed rail; 2×2 condition band/routes; two-column atlas.
- **≤880px:** navigation drawer with labelled button; content full width; local section map enters document flow.
- **≤620px:** all evidence cards single column; relationship trails scroll as complete labelled units; finding register becomes ID + body + second-row metadata.
- **No JavaScript ≤880px:** rail is static at the top, not inaccessible off-canvas.
- **Print:** rail and enhancement controls disappear; content, statuses, source identity, and disclosed evidence print in reading order.

## Amanuensis implementation map

No production files were changed. These are the intended seams in `/Users/nfeldman/repos/amanuensis/materializer/amanuensis_materializer/html_projection.py`.

| Current seam | Proposed responsibility |
|---|---|
| `SitePage` | Add structured `region`, `topics`, `finding_count`, `highest_severity`, and optional `parent_record_id`; do not derive these from rendered labels |
| page inventory assembled upstream | Group six global landmarks first, then subsystem regions; retain every existing route and Markdown companion |
| `_nav()` | Render compact landmarks plus native `<details>` regions; search index includes page, subsystem, finding, seam, question, heading, and topic objects |
| `_shell()` | Render `CompassLine`, `ConditionBand`, route cards, re-entry state, source escape, and local section map around the article |
| `MarkdownRenderer.render()` | Continue semantic Markdown baseline; add explicit renderer hooks for structured finding casefiles and relationship trails rather than heuristically styling arbitrary tables |
| `_status_html()` / evidence/severity hints | Preserve plain labels; supply axis-specific wording and never reuse “good” color for source freshness |
| `render_html_projection()` | Build a complete in-memory publication manifest, verify aggregates/links/fragments against emitted bytes, then publish or surface an explicit integrity warning according to product policy |
| `_CSS` / `_JS` | Split internally into named constants/modules if useful, but continue embedding the final bytes so `file://` and static hosting require no dependencies |

### Suggested view model

Create an internal structured `ProjectionPublication` before rendering:

```text
publication_id          content hash or immutable generated identifier
generated_at            publication time
previous_publication_id optional immutable comparison endpoint
canonical_branch
last_checked_sha
last_checked_at
coverage { mapped, total, by_region[] }
findings { total_open, by_severity, lead[] }
registers { contradictions, field_notes, questions }
integrity { state, checks[], mismatches[] }
active_work { label, started_at, state }
pages[] / search_objects[]
```

`previous_publication_id` must never be inferred from code SHA alone: this panel observed multiple report publications over one checked SHA.

### Read-back gates

At minimum, verify before declaring publication integrity:

1. overview coverage equals the subsystem register;
2. overview finding total/severity equals the finding register;
3. overview field-note/question/contradiction counts equal their registers;
4. page inventory equals emitted HTML/Markdown companions;
5. all local file links and fragments resolve;
6. every current page has a unique title, one H1, Markdown escape, and checked/publication identity;
7. no external runtime request is introduced.

Whether a mismatch blocks publication or emits a warning is an unresolved product decision. The HTML must never silently assert `verified` when the gate did not run.

## Verification program

### Automated construction checks

Run `node design/delightful-output-panel/validation/validate-prototype.mjs`. It checks 26 invariants including unique IDs, fragment/ARIA targets, JavaScript syntax, no external assets, no-JS/print/reduced-motion hooks, frozen content values, and visible qualification.

### Required pre-production evaluation

1. Keyboard-only and screen-reader traversal at deep finding/subsystem fragments.
2. 200% and 400% zoom, narrow viewport, forced colors, light/dark, print, reduced motion, JavaScript disabled.
3. The five reader tasks in `task-tests.md` with representative readers.
4. Disclosure ablation: qualifier visible + receipts collapsed versus everything visible versus qualifier collapsed.
5. Return mechanism comparison: ordinary browser history versus explicit return-to-case link, measuring successful recovery rather than preference alone.
6. Re-entry comprehension with immutable current/prior publication IDs and a deliberately unknown reader baseline.

No accessibility or reader-performance claim is authorized by the prototype alone.
