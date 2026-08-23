# Panel synthesis and competing directions

## Evidence labels

- **[O] Observation:** directly visible in the generated AxiomDB report or its regeneration during this panel.
- **[R] Research claim:** carried in the Scholiast claim inventory, with scope and source access preserved.
- **[J] Creative judgment:** a panel or lead design choice. It may be informed by evidence but is not presented as research.

Independent memo agreement is not counted as empirical evidence. All three panelists are Codex lineage; see `method-and-lineage.md`.

## What survived the blind disagreement

The three disciplines began from different governing objects—a field atlas, a field station whose “truth has weather,” and a decision docket—but independently found the same structural tensions:

1. **[O] The entrance describes report furniture before it describes AxiomDB or the next consequential decision.** The useful system model lives in `entry-point.html`, behind a reader-guide hop.
2. **[O] Coverage, freshness, absence of recorded contradiction, and correctness are distinct but emotionally collapse in the current summary.** A calm freshness indicator can read as “all clear” beside unmapped territory and open findings.
3. **[O] Findings are decision-grade records forced into comparison-table geometry.** Consequence, evidence, assumption, and action are hard to scan inside wide prose cells.
4. **[O] Global navigation is stable but too exhaustive to be a useful map.** It preserves the taxonomy while giving every report page and all 34 subsystems similar visual weight.
5. **[O] Deep links preserve destination but not investigative purpose or recovery.** Browser Back is the only “return to the case” mechanism.
6. **[O] The projection changed repeatedly at stable paths during the reading window.** A settled captured write then disagreed across files: the overview said `22 / 34` and `13 (0 critical)`, the master plan contained `23 / 34`, and the findings register contained 14 findings including one critical `V02-1`.
7. **[R] Existing Scholiast work defines static-first output, authoritative-record separation, evidence-rich reorientation, progressive enhancement, and output-level accessibility verification as product constraints—not optional polish.** See the research workspace C-002.
8. **[R] Existing Scholiast design precedent supports stable destinations, named relation types, returnable cross-references, and a stable reading frame even when composition becomes expressive.** See C-003, with its transfer limits.

## Direction A — The Field Atlas

### Governing object

**[J]** A partly charted territory with a visible route. The primary promise is place: every screen answers where the reader is, what territory is authorized, what is adjacent, and how to return.

### First viewport

- One-breath project model: Rust RDF quad store; five Fjall index permutations; SPARQL through LTJ/Volcano; write-time OWL EL ambition with known gaps.
- A nine-region coverage atlas, shown as named regions and subsystem cells rather than a completion ring.
- A compass line: `AxiomDB / Service / V-02 HTTP SPARQL surface · mapped · 1 critical finding`.
- Four routes: understand the system, follow the highest risk, audit the survey, resume work.

### Signature behavior

- A compact six-landmark global map; Subsystems expands by architectural region.
- One jump field across pages, subsystems, findings, seams, question numbers, symbols, and topics.
- A persistent structural breadcrumb and local section map; evidence links include a return-to-case target.
- Unmapped cells are readable text: “scope only; no behavioral claim authorized.”

### What it optimizes

New-engineer orientation, specialist navigation, and honest blank territory.

### Accepted cost

The highest-risk action competes with the map. A maintainer may understand the terrain before knowing what to do.

### Refusal / kill criterion

Reject if the atlas becomes a single heroic graph, if blank territory feels decorative, or if a mobile reader loses the current coordinate when the rail closes.

## Direction B — The Decision Docket

### Governing object

**[J]** A short argued brief with receipts. The primary promise is action: state the consequential matter, the decision it requires, the warrant, and the assumption that could change the remedy.

### First viewport

- A one-sentence current thesis.
- “Act now” led by `V02-1`: unauthenticated HTTP query/update can execute as the system tenant; the route is shipped and bound to all interfaces.
- A projection-coherence notice: the summary and underlying registers disagree, so counts are not safe to repeat until regenerated coherently.
- Routes grouped by action: contain/fix, verify intent, clarify published capability, survey next.

### Signature behavior

- Findings become vertical casefiles: **What happens → Why believed → What remains unsettled → Next appropriate action → Receipts**.
- The lead rule is inspectable: severity, reach, evidence quality, and blocking human decision.
- An evidence aperture keeps severity, status, evidence quality, checked SHA, and key assumption visible; implementation details may disclose below.
- A slim decision trail remains when following a case into a subsystem or concern.

### What it optimizes

Maintainer action, consequence scanning, and skeptical verification of a conclusion.

### Accepted cost

The entrance becomes editorial. Choosing a lead matter can age badly and can underrepresent the system shape.

### Refusal / kill criterion

Reject if the docket becomes a generic ticket queue, hides the map more than one interaction away, or turns a severity label into an unqualified prescription.

## Direction C — The Living Evidence Edition

### Governing object

**[J]** A calm edition with a visible publication state, typed glosses, and a re-entry note. The primary promise is continuity: show what the report says, what qualifies it, and what is known—or not known—to have changed.

### First viewport

- A “publication weatherline” with four separate axes: checked source SHA, survey reach, consequential open findings, and unresolved record state.
- A change panel with three non-conflated rows: publication-to-publication delta, reader-local last seen state, and active survey work. Unknown remains explicit.
- A central current thesis, with nearby typed glosses: qualification, source, decision, contradiction, and related subsystem.
- Clean reading and fully glossed views share the same URLs and factual content.

### Signature behavior

- Typed marginalia on wide screens; inline call-site glosses with return links on narrow screens.
- “Fresh” always expands to “recently checked,” never “safe.”
- No inferred “since your last visit” claim unless a real earlier publication or reader-local baseline exists.
- Quiet but memorable art direction: hard ink/teal/coral intervals, precise rules, and rare expressive type events; no ambient animation.

### What it optimizes

Returning-reader reorientation, epistemic honesty, long-form reading, and qualification proximity.

### Accepted cost

The apparatus can feel academic and less immediately actionable. Marginalia can collapse badly on small screens.

### Refusal / kill criterion

Reject if readers cannot distinguish the report's claim from a later gloss, if the “weather” metaphor softens a critical issue, or if mobile glosses detach from the sentence they qualify.

## Dialectical decision — Field Docket

The prototype is not a visual average of the three. **[J]** It adopts the Decision Docket as the content sequence, the Field Atlas as the stable coordinate system, and only the Living Edition's four-axis weatherline and typed qualification behavior.

It deliberately rejects:

- Direction A's map-first entrance; the project model remains, but the most consequential safe-to-act-on matter follows immediately.
- Direction B's temptation to make every page a ticket; subsystem pages remain places with relationships and survey boundaries.
- Direction C's alternate clean/glossed modes; essential qualifiers never depend on a reader selecting the “right” view.
- adaptive route-specific reordering; task routes highlight and jump but do not secretly change the underlying publication.

The governing sentence is:

> **Lead with consequence, keep the coordinate, expose the warrant, and never make the reader infer whether the publication itself is coherent.**

## Rejected tradeoffs

| Temptation | Why rejected | Cost retained instead |
|---|---|---|
| Single health/trust/completion score | Fuses coverage, correctness, freshness, severity, and uncertainty into false authority | Several slower but interpretable signals |
| All 34 subsystems always visible | Makes the rail a warehouse inventory and overwhelms page-level landmarks | One expansion or search for a specific subsystem |
| One dependency graph as architecture | A partial survey can look complete; text and mobile recovery suffer | Region map plus typed seam sentences |
| Finding tables as the primary reading mode | Long consequence/root-cause prose is unreadable in cells | Casefiles first; dense comparison table remains secondary |
| Hide all evidence under `<details>` | The assumption and evidence quality are part of the claim | A slightly taller closed casefile |
| Infer “what changed” from timestamps or active-session prose | Publication delta, reader baseline, and survey activity are different facts | Explicit “no comparison recorded” states |
| Decorative animation and celebratory completion rings | They imply confidence and add little to task completion | Tactile static composition and purposeful focus/hover states |

## Unresolved disagreements carried forward

1. **Project model versus top issue in the first eye.** IA wants system shape first; decision design wants the consequential matter first. The prototype gives the project model one sentence, then the issue, and the disagreement remains open to reader testing.
2. **Local memory.** A pinned trail can make return delightful, but localStorage can be mistaken for durable report history or surprise privacy-sensitive readers. The prototype labels local state and keeps it optional; production policy remains unresolved.
3. **How much metaphor the status band can bear.** “Weather” makes separate epistemic conditions felt, but a critical security finding must not become atmospheric. The prototype uses the structure without relying on the word as a status label.
4. **How much editorial authority Amanuensis should exercise.** Leading by severity/reach is defensible, but recommending a remedy may exceed what the evidence authorizes when intent is unresolved. The prototype separates “contain/verify” from “fix.”
5. **Whether projection incoherence should block publication.** The design can disclose disagreement, but a generated report may be safer if read-back prevents publication until summary/register counts agree. The prototype exposes the condition; production policy is unresolved.
