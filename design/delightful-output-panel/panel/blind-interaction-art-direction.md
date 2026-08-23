# Blind first-reading memo — interaction and art direction

## Discipline and reader need privileged

I am approaching this as an interaction designer and art director. I privilege **emotional orientation before exhaustive navigation**: a reader should feel, within one screen, whether this is a dependable map, a partial expedition log, or an alarm bell—and why. Epistemic status should alter the experience of reading, not sit beside it as a tiny technical label.

## Observations from the reading object

### What became easy

- The HTML has a handsome, quiet field-notebook character: strong serif display type, a restrained palette, generous measure, durable anchors, visible branch/SHA/as-of metadata, a local Markdown companion, and no apparent external asset dependency. Its fixed rail makes the report feel like a real publication rather than a dump of Markdown.
- The rail's four groupings—Orientation, Evidence, Working record, Reference—are a lucid mental model. It also makes name/ID discovery unusually strong: all 34 subsystems are listed by human name, ID, and mapped/unmapped state, and the search can narrow them.
- The facts needed for caution are genuinely present. The overview says 19 of 34 subsystems are mapped, 11 findings are open, 20 field notes remain open, and the latest session is active. The reader's guide carefully explains what a mapped status, a severity, and evidence quality do and do not authorize.
- Individual records contain consequential, memorable material. `R04-1` is not merely “high”: ABox writes can fail to produce expected OWL EL inferences without reporting it. `Q01-1` can turn unreadable visibility metadata into a successful empty or wrong query result. `V03-1` exposes reasoning-status RPCs without authorization. `W05-1` combines unbounded retained storage with silent resurrection after 65,536 CLEAR/DROP operations.

### Where I lost orientation

- “No recorded stale entries,” “no unresolved contradictions,” and a calm green dot arrive before the much more consequential incompleteness: 15 subsystems are unmapped and 20 notes remain unresolved. Currentness, absence of contradiction, depth of coverage, and safety to rely on are distinct axes, but the presentation makes them emotionally blur into *all clear*.
- The overview starts with a metric table and then a flat list of routes. It does not give a new engineer a single sentence of system shape, a first useful reading route, or a salient reason to care. The active next session (“SM-07 … then Q-01 onward”) is exposed as a raw resume command rather than a legible “what is currently being investigated.”
- Findings are technically excellent but visually table-shaped. The six-column wide table asks a human to reconstruct consequence, reachability, certainty, and next reading move from a wall of prose. A high-severity record competes at the same visual level as its root-cause implementation detail.
- Architecture is a useful source projection, but the visible “diagram source” is not an orienting relationship picture. A specialist following `W-01` toward `R-05` or `W-05` must translate Mermaid text and then recover their place from the rail.
- The repeating “Reading hint” restates the page hint without changing the reader’s decision. That prime real estate could carry the *interpretation* the page currently makes the reader infer.

## Creative judgments: direction

### Governing principle: **truth has weather**

Make the conspectus feel like a calm field station at the edge of a partly charted territory. It must never simulate certainty with a dashboard's cheerful completion glow. The reader should feel four distinct conditions at once:

1. **What is surveyed enough to use** (depth),
2. **What needs attention now** (consequence),
3. **What is unresolved or unseen** (limits), and
4. **How fresh this reading is** (time).

These are separate signals, with words and shapes as well as color. “Fresh” must read as *recently checked*, not *safe*. “Mapped” must read as *surveyed to its stated depth*, not *correct*. The visual voice stays editorial and tactile—ink, margin notes, rule lines, carefully controlled signal color—rather than adopting a generic monitoring-console aesthetic.

### Information architecture and first viewport

Replace the overview's first content block with a **Survey horizon** beneath the existing title and SHA strip.

```
AXIOMDB / SURVEY HORIZON                         checked d19ade703e3c · 22 Aug
Partly charted; current at this commit.          Markdown ↗

19 / 34  mapped and composable     15  not yet surveyed
11       confirmed open findings   20  open field notes
0        recorded stale entries    0   unresolved contradictions

BEGIN HERE
Reasoning after ordinary data writes is not wired.  HIGH · R04-1 · code-verified
An ABox assertion can return without its expected OWL EL inference.
[Read the case]  [See the reasoning territory]

THE MAP IN ONE BREATH
Data enters through write/service surfaces; query and reasoning sit over storage,
dictionary, catalog, and index layers.  [Open the living map]
```

The surrounding labels do epistemic work: “mapped and composable,” “not yet surveyed,” “recorded stale entries,” and “unresolved contradictions” prevent counts from collapsing into an invented health score. “Partly charted” is a plain-language status sentence that remains true even with fresh data.

After the horizon, arrange the landing page as four deliberate routes rather than a general navigation list:

- **Act now** — confirmed open findings, led by the highest consequence and then a compact, named queue.
- **Understand the terrain** — the interactive/textual system map and subsystem atlas.
- **Test the limits** — unmapped territory, open questions, tensions, and evidence/knowledge-depth guide.
- **Resume the expedition** — what the last session was pursuing, what changed since the reader’s last visit when history exists, and the next named trail.

Each route is ordinary semantic HTML with direct links and a one-click Markdown companion; progressive enhancement only filters, pins, and remembers a reader’s trail.

### Signature moves

1. **The Weatherline.** A persistent, compact band at the top of every page and in print: `Fresh at d19ade7` · `19/34 mapped` · `11 confirmed open` · `20 notes still open`. Each datum opens its definition or filtered destination. It uses a glyph + label + value, never color alone. The band changes language by page—on a subsystem, for example, “Mapped: complete through stated survey gates” and “1 open finding”—so the status is felt continuously rather than remembered from a guide read once.

2. **Casefiles, not rows.** Findings become expandable-but-complete-without-JS casefiles. Their closed face carries human consequence, status, severity, evidence quality, surveyed SHA, and a named subsystem; the open face has four short, stable blocks: **What happens**, **Why this is believed**, **Scope/unknowns**, and **Follow the evidence**. For `R04-1`, the lead is “Ordinary ABox writes do not materialize expected OWL EL inferences,” not the internal function name. The proof remains one tab away, never decorative. Tables persist as a dense comparison/list mode for experts and screen-reader navigation.

3. **The trail line.** When a reader opens `W-01`, `R-05`, or a finding, a quiet line under the page title shows their path and adjacent seams: `Write coordinator W-01 → mutation-log boundary SM-07 → Graph catalog W-05`, plus “You came from: R04-1” when applicable. On the relationship map, each seam is a readable two-sided sentence and a focusable link, not a client-rendered diagram requirement. A “Pin this trail” control can store a returning reader’s next stop locally; the underlying anchors and URLs remain the durable state.

## The five reader tasks

1. **New engineer, five minutes.** The Survey horizon answers coverage and urgency before navigation. “Map in one breath” names the system’s broad paths; `R04-1` and the first-route links supply a defensible place to begin instead of asking them to interpret 34 entries.
2. **Maintainer responding to change.** “Act now” ranks named casefiles by impact but exposes evidence quality, SHA, scope, and the exact downstream effect. A maintainer can reach `R04-1`, see the unwired scheduler/bulk-loader junctions, and follow into `R-04`, `R-06`, and the evidence rather than treating a red badge as a prescription.
3. **Skeptical reviewer.** The Weatherline never converts coverage into correctness. “Test the limits” places 15 unmapped areas, 20 open field notes, open questions, contradictions (including an honest zero), and the knowledge-depth contract beside—not after—the reassuring currentness signal.
4. **Returning reader.** The resume route turns the active `SM-07`/`Q-01` session state into a readable trail and preserves a local pin. A generated “since your last visit” delta may be added only when actual prior-state data exists; otherwise it honestly says “no comparison recorded” rather than inventing change.
5. **Specialist locating a subsystem.** Search accepts names, IDs, and topic terms and presents results as territory entries: `W-05 · Graph catalog, mutation log, and retention · mapped · 1 open finding`. The trail line and accessible seam sentences keep context when the specialist moves through `W-01`, `R-05`, `Q-01`, or `S-02`.

## Content-specific sketches

### A high-stakes casefile

> **HIGH · R04-1 · B/F incremental deletion**  
> **Reasoning is not connected to ordinary data writes.**  
> Insert `:a rdf:type :C` while `:C rdfs:subClassOf :D` is already in the TBox; a query need not return `:a rdf:type :D`. Nothing announces the missing inference.  
> **Why this is believed:** code-verified at `d19ade70`; both incremental reasoners are tested but have no production caller, ABox-only writes schedule no rebuild, and the bulk finalization hook has no implementation.  
> **Read the case** · **Open R-04** · **Follow to R-06**

This is considerably more legible than making the reader scan “Symptom” and “Root cause” columns, while retaining all of the report’s qualifying structure.

### An uncertainty card that resists false reassurance

> **UNSEEN TERRITORY · not a clean bill of health**  
> `V-01` gRPC service surface, `V-02` HTTP SPARQL surface, `H-01` capability evidence, and 12 other subsystems are **unmapped**: the survey authorizes no behavioral claims about them.  
> The 11 confirmed open findings are real at their cited SHAs; they are not a count of all defects.  
> **Browse unmapped territory** · **How the evidence contract works**

### A seam as place, not source text

> **SM-07 · Write result ↔ mutation history**  
> `W-01 Graph write coordinator` prepares sequence allocation with `W-05 Graph catalog, mutation log, and retention`, then appends the mutation log after commit.  
> **Current trail:** an active survey session is assessing this boundary.  
> [Read W-01] — **post-commit append** → [Read W-05]

## Hardest tradeoff and refusal

The hardest tradeoff is accepting a less dense first screen and less immediate access to every table cell in exchange for a reader who understands the report’s limits before acting. Experts still get compact tables, IDs, source prose, fragments, Markdown, and full text search one interaction away.

I would refuse two temptations: a single red/yellow/green “project health” score, because it fuses consequence with coverage and freshness; and decorative animated graphs, because they make a partial survey feel more complete while failing direct-file, reduced-motion, keyboard, print, and semantic-readback use. The report should be memorable because its truth conditions are palpable, not because it performs confidence.
