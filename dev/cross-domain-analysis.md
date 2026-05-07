# Cross-Domain Methodological Analysis for Amanuensis

**Purpose**: Identify concepts and processes from rigorous investigative disciplines
that, when applied to the codebase surveying task Amanuensis is designed for, would
strengthen its methodology, catch failure modes it currently misses, or formalize
practices it currently performs only implicitly.

**Domains surveyed**: Intelligence analysis, archaeology, forensic science, medical
diagnosis, accident investigation, ethnography.

**Structure**: Each section identifies a domain concept, explains what makes it powerful
in its home domain, maps it to the Amanuensis surveying context, and notes whether
Amanuensis already does something analogous (and if so, where the analogy breaks down).

---

## 1. Analysis of Competing Hypotheses (Intelligence Analysis)

### The concept

ACH, developed by Richards Heuer at the CIA, is an 8-step process for evaluating
multiple competing explanations for observed evidence. The key insight is
**diagnosticity**: evidence should be evaluated *across* hypotheses, not *for* a
single hypothesis. A piece of evidence that is consistent with all hypotheses tells
you nothing. A piece of evidence that is consistent with only one hypothesis is
maximally diagnostic.

The process:
1. Enumerate all plausible hypotheses (not just the two most obvious).
2. List all significant evidence and arguments.
3. Build a matrix: hypotheses as columns, evidence as rows.
4. Work *across* rows (which hypotheses does this evidence discriminate between?)
   rather than *down* columns (does this evidence support my preferred hypothesis?).
5. Refine the matrix — delete evidence with no diagnostic value.
6. Tentatively rank hypotheses by *inconsistency*: reject those with the most
   contradicting evidence, rather than accepting the one with the most supporting evidence.
7. Perform sensitivity analysis: if one or two key pieces of evidence were wrong,
   would the conclusion change? Those are **linchpin** items.
8. Report conclusions as probabilities across the surviving hypotheses, not as a
   single verdict. Identify future indicators that would change the assessment.

### Where Amanuensis already does this

The concern-driven deep read (Phase 3) and adversarial review (Phase 4) together
approximate ACH's core loop: hypothesize a concern, gather evidence, attempt to
disprove it. The adversarial review's explicit "Claim A / Claim B / Evidence / Verdict"
structure is a two-hypothesis ACH.

### Where the analogy breaks down — and what to adopt

**1a. Amanuensis evaluates concerns independently; ACH evaluates them against each other.**

When Amanuensis investigates a concern like "cache invalidation is incomplete," it
gathers evidence for or against that single concern. It does not ask: "If this evidence
also explains concern X, does it weaken or strengthen my confidence in concern Y?"
In codebases where multiple hypotheses compete to explain the same observed behavior
(e.g., a race condition vs. a cache staleness bug vs. a replication delay — all
producing the same symptom of "stale data"), evaluating concerns independently risks
confirming the wrong one.

**Recommendation**: When multiple concerns in the same subsystem could explain the
same observable symptom, construct a **diagnosticity matrix**. List the shared evidence
as rows and the competing concerns as columns. Evaluate each piece of evidence across
all competing concerns before classifying any of them. Add this as a directive in
`concern-seeding.md` under a new section: "When Concerns Compete."

**1b. Amanuensis does not perform sensitivity analysis.**

The methodology does not ask: "Which single piece of evidence, if it turned out to be
wrong, would change this finding?" Identifying these linchpin pieces of evidence is
critical when the evidence base is thin (early in a survey, or in sparsely documented
subsystems).

**Recommendation**: After Phase 4 (Adversarial Review), add a **Sensitivity Analysis**
step: for each confirmed finding, identify the one or two pieces of evidence it most
depends on. If those are fragile (e.g., inferred from naming conventions rather than
observed behavior, or dependent on a comment being accurate), flag the finding as
**linchpin-dependent** and note what future observation would resolve it.

**1c. Amanuensis does not track future indicators.**

ACH's Step 8 asks: "What would I expect to see in the future if hypothesis A is
correct vs. hypothesis B?" This creates a forward-looking monitoring agenda.

**Recommendation**: When a concern is classified as "confirmed acceptable" or "ruled
out" with moderate confidence, record one or two **sentinel conditions** — observable
future states of the codebase that would change the classification. These would live
in the `dispositions` table as a new column or in a companion `sentinels` table.
Examples: "If the retry count is ever changed from 3 to >5, re-evaluate timeout
concern T-04." "If a second consumer of this cache is added, re-evaluate invalidation
concern CC-2."

---

## 2. Information Classification Hierarchy (Intelligence Analysis)

### The concept

Intelligence analysis classifies incoming information on a five-level reliability
scale:

| Level | Name | Meaning |
|-------|------|---------|
| 1 | **Fact** | Verified beyond reasonable doubt |
| 2 | **Direct information** | First-hand observation, single source |
| 3 | **Indirect information** | Second-hand/inferential, plausible chain |
| 4 | **Direct data** | Raw observation, not yet contextualized |
| 5 | **Indirect data** | Rumor, hearsay, uncorroborated signal |

Every piece of information entering an intelligence product is tagged with its
reliability level. This prevents high-confidence conclusions from being built on
low-reliability inputs without explicit acknowledgment.

### What Amanuensis currently does

The Knowledge Depth Contract (Tier 0/1/2) classifies *knowledge* by summarization
depth, not by *evidential reliability*. The seven-field invariant records facts about
entries, but does not distinguish between "I read the code and verified this" and "I
inferred this from a comment" and "I inferred this from a file name."

### What to adopt

**2a. Evidence-quality tags on findings.**

Each finding's evidence reference (`file + symbol`) should carry a reliability tag:

| Tag | Meaning | Example |
|-----|---------|---------|
| `code-verified` | Read the implementation, traced the logic | "Checked that `invalidateAll()` is never called after mutation X" |
| `contract-stated` | Documented API contract or type signature | "The return type is `Option<T>`, so callers must handle `None`" |
| `comment-asserted` | A comment or docstring claims this | "Comment says 'thread-safe' but no synchronization visible" |
| `name-inferred` | Inferred from naming convention alone | "Method named `clearCache` — assumed to clear cache" |
| `pattern-matched` | Matches a known pattern, not individually verified | "Follows the repository pattern seen in adjacent services" |

**Recommendation**: Add an `evidence_quality` column to the `dispositions` table.
Findings based on `comment-asserted` or `name-inferred` evidence should automatically
receive a lower confidence rating and should be flagged for verification in the next
survey pass.

---

## 3. Collation Attributes (Intelligence Analysis)

### The concept

Intelligence analysis requires that collated information (the organized body of evidence
an analyst works from) satisfy four properties:

1. **Impersonal** — not dependent on any single analyst's memory.
2. **Not master of the analyst** — the collation serves the analyst; the analyst is
   not constrained to only what the collation contains.
3. **Free of bias** — organized by structure, not by conclusion.
4. **Receptive to new data** — can incorporate new information without extensive
   restructuring.

### What Amanuensis already does

The database-backed memory system satisfies (1) — it is impersonal and persistent.
The adaptive compression and heat shield systems partially address (4) — they allow
new information to coexist with condensed older information. The seven-field invariant
provides structural organization.

### Where the analogy breaks down

**Attribute 2 ("not master of the analyst")** is the most interesting gap. Amanuensis's
Tier 1 loading budget (~500 lines) constrains what information is immediately available
to the agent at session start. If a concern does not appear in the loaded Tier 1
summaries, the agent may not think to look for it. The concern checklist partially
addresses this, but the checklist itself is filtered through the Tier 1 loading window.

**Recommendation**: The concern checklist should be loaded *independently* of the Tier 1
budget — it is a generative tool (it tells you what to look for), not a summary of
what was found. If the checklist is buried inside a subsystem's Tier 1 summary, it is
subject to the loading budget and may be truncated. Ensure the calibrated concern
checklist is always fully loaded at session start, separate from the Tier 1 summaries.

**Attribute 3 ("free of bias")** is partially violated by the field-demand tracking
system. Field demand tracks which fields are queried most, then prioritizes retaining
those fields during compression. This is useful for efficiency but risks creating a
feedback loop: fields that were queried frequently in the past are retained, fields
that were not queried are compressed away, and the agent never sees them again — even
if they would be relevant to a new type of concern. This is the intelligence analysis
equivalent of "circular reporting."

**Recommendation**: Add a **demand decay** mechanism to field-demand tracking. Fields
that have not been queried in N sessions should have their demand scores reduced
*gradually*, not maintained indefinitely. This prevents permanent feedback-loop bias
toward early-session query patterns. Alternatively, periodic "full-spectrum" passes
that ignore demand weighting would serve the same purpose.

---

## 4. Harris Matrix and Stratigraphic Recording (Archaeology)

### The concept

The Harris Matrix is archaeology's formal system for recording temporal relationships
between depositional events. It is governed by five laws:

1. **Law of Superposition** — in undisturbed deposits, the upper layer is younger.
2. **Law of Original Horizontality** — deposits tend to form in horizontal layers.
3. **Law of Original Continuity** — a deposit originally extended continuously; any
   missing edge must be explained by a later event (erosion, truncation, later cut).
4. **Law of Stratigraphic Succession** — a unit's temporal position is determined by
   its relationships to the units directly above and below it, not by distant layers.
5. **Law of Original Consolidation** — a deposit was consolidated at the time of
   formation; later disturbance requires explanation.

The matrix itself is a directed acyclic graph showing "earlier than" relationships
between individual depositional contexts (not layers — individual events). It is built
*during* excavation, not after, because excavation is destructive: once you remove a
layer, the spatial relationships are gone forever.

Key practices:
- **Single-context recording**: Each depositional event gets its own record, no matter
  how thin. Grouping happens later, not during recording.
- **Loop detection**: A cycle in the matrix means a recording error — time cannot be
  circular. Loops are diagnosed and corrected during excavation.
- **Higher-order groupings**: Individual contexts are grouped into features (a pit, a
  wall, a ditch), features into structures, structures into phases. Interpretation
  increases at each higher level, but the individual context records remain unchanged.

### Mapping to Amanuensis

A codebase evolves through a series of changes (commits) that are analogous to
depositional events. Understanding why code looks the way it does often requires
understanding the *sequence* of changes that produced it and the *relationships*
between those changes — which is exactly what a Harris Matrix formalizes.

**4a. Single-context recording → Single-observation entries.**

Amanuensis already practices something like this: each entry in the `entries` table
records a single observation. But the seven-field invariant compresses multiple
observations into a single entry during adaptive compression. This is like an
archaeologist combining two distinct depositional events into a single context record
because they "seem related" — it loses temporal resolution.

**Recommendation**: The compression system should preserve **temporal atomicity** at
Tier 2. Compression should merge *summaries* of observations, not the observations
themselves. The `entry_versions` table (which stores pre-compression snapshots) already
provides a form of this, but the methodology does not explicitly flag it as the
archival record of record. Make this explicit: Tier 2 entries may be compressed, but
`entry_versions` rows are the stratigraphic record and should never be deleted or
compressed.

**4b. Loop detection → Contradiction detection.**

In a Harris Matrix, a cycle means "Event A happened before Event B, and Event B
happened before Event A" — a temporal impossibility that indicates a recording error.
In Amanuensis, the analogous impossibility is a **logical contradiction** between
two findings: "Finding F-1 says module X is thread-safe; Finding F-7 says module X
has a race condition." Both findings cite evidence. At least one is wrong, or they
apply to different scopes.

Amanuensis does not currently detect contradictions between findings. Two findings
in the `findings` table can directly contradict each other indefinitely.

**Recommendation**: Add a **contradiction check** to the Phase 5 output packaging step.
After all findings are recorded, scan for finding pairs where:
- They reference the same file/symbol
- Their classifications or severity assessments are logically incompatible
- They were recorded in different survey passes (and thus may reflect different code states)

Contradictions should be flagged for resolution — either one finding supersedes the
other (and the superseded one is marked with the reason), or they apply to different
scopes that should be explicitly distinguished.

**4c. Higher-order groupings → Concern clustering.**

Archaeology assembles individual contexts into features, features into structures,
structures into phases. This multi-level interpretive hierarchy allows both granular
analysis and high-level pattern recognition.

Amanuensis has concerns and findings, but no formal mechanism for grouping related
findings into higher-order patterns. Three findings about missing error handling in
different methods of the same service are individually categorized, but not grouped
into the higher-order observation: "This service systematically omits error-path
cleanup."

**Recommendation**: Add optional **finding clusters** — a lightweight grouping mechanism
in the `findings` table (a `cluster_id` column and a `clusters` table with a summary).
The cluster summary is an interpretation of the pattern the individual findings
collectively reveal. Like archaeological higher-order groupings, the individual finding
records remain unchanged; the cluster is a separate interpretive layer.

---

## 5. Chain of Custody (Forensic Science)

### The concept

Chain of custody is the chronological documentation of who had control of a piece of
evidence, from the moment of collection to its presentation in court. Every transfer
is recorded with:
- Identity of the handler
- Duration of custody
- Security and storage conditions
- Manner of transfer
- Signatures

The purpose is to ensure that evidence has not been tampered with, contaminated, or
substituted. A break in the chain of custody does not prove that evidence was tampered
with, but it removes the guarantee that it was not.

### Mapping to Amanuensis

Amanuensis's findings are a form of evidence. They are collected by an LLM agent,
stored in a database, and used by future LLM agents (or humans) to make decisions. The
chain of custody question is: **Can a future consumer of a finding determine who
recorded it, when, from what state of the code, and whether the code has changed since?**

**5a. Provenance tracking.**

Amanuensis partially addresses this: the `ref_sha` field anchors findings to a specific
commit. But the methodology does not record:
- Which LLM session produced the finding (session identity).
- Whether the finding was produced by an onboarding pass, a deep survey pass, or an
  adversarial review pass (provenance type).
- Whether the code referenced by the finding has been modified since the finding was
  recorded (staleness relative to current HEAD).

**Recommendation**: Add a `provenance` column to the `findings` and `dispositions`
tables with at minimum: `session_id` (a unique identifier for the survey session),
`pass_type` (onboarding / survey / adversarial / refresh), and `recorded_at` (timestamp).
The change detection protocol should cross-reference findings with `git diff` output to
flag findings whose referenced files have been modified since `ref_sha`.

**5b. Contamination prevention.**

In forensics, evidence must be protected from contamination — especially from the
investigator's own actions. The Amanuensis equivalent is **confirmation bias
contamination**: an agent reading a previous agent's findings before examining the code
may be primed to see what the previous agent saw, rather than making an independent
assessment.

**Recommendation**: For high-stakes adversarial review passes, consider a **clean-room
protocol**: the adversarial reviewer reads the code and forms its own assessment
*before* reading the prior findings. It then compares its independent assessment to the
prior findings. Disagreements are diagnostic — they reveal either (a) a prior error,
(b) a current blind spot, or (c) an ambiguity in the code that reasonable analysts
interpret differently. This is standard practice in intelligence analysis (Team A/Team B
methodology) and in some forms of forensic peer review.

---

## 6. Locard's Exchange Principle (Forensic Science)

### The concept

Edmond Locard's principle: "Every contact leaves a trace." When two objects come into
contact, material is exchanged — the perpetrator both brings something to the scene and
takes something away. The principle applies to digital forensics as well: every
interaction with a system leaves artifacts (logs, timestamps, cache entries, file
metadata).

### Mapping to Amanuensis

For codebase analysis, the principle inverts: **every code change leaves traces beyond
the changed lines themselves.** A function signature change leaves traces in every call
site. A schema migration leaves traces in the ORM layer. A configuration change leaves
traces in the runtime behavior.

Amanuensis's current methodology traces concerns *forward* (from a concern to the code
that confirms or rules it out) but does not systematically trace *backward* (from an
observed anomaly to all the contacts that could have produced it).

**Recommendation**: Add a **trace-back** directive to the concern-driven deep read
(Phase 3): when a concern is confirmed, trace backward from the symptom to identify
all code changes that could have introduced or modified the behavior. This serves two
purposes: (a) it identifies the root cause rather than just the symptom, and (b) it
identifies *other* places the same change may have introduced similar symptoms (the
Locard corollary: if the change left a trace here, it likely left traces elsewhere
too).

---

## 7. Differential Diagnosis (Medicine)

### The concept

Differential diagnosis is the systematic process of distinguishing between conditions
that share similar symptoms. The physician:

1. Collects presenting symptoms.
2. Generates an ordered list of candidate diagnoses (the "differential").
3. Orders tests to discriminate between candidates — choosing tests that distinguish
   between the most likely candidates, not tests that merely confirm the most obvious one.
4. Narrows the differential as results come in.
5. Re-expands the differential if test results are inconsistent with remaining candidates.

Key principles:
- **"When you hear hoofbeats, think horses, not zebras"** — common things are common.
  But after ruling out horses, escalate to uncommon diagnoses rather than confirming the
  least-bad horse.
- **Occam's Razor vs. Hickam's Dictum**: Occam says prefer the single explanation that
  accounts for all symptoms. Hickam says a patient can have as many diseases as they
  damn well please. In complex systems, multiple independent bugs co-exist.
- **Test ordering is economically constrained** — you do the cheap, safe, informative
  tests first. You escalate to expensive, risky, or invasive tests only when warranted.

### Mapping to Amanuensis

Codebase surveying shares the structure of differential diagnosis in important ways:
symptoms (observed behavior, test failures, performance anomalies) can have multiple
root causes, and investigation has costs (token budget, time, context window).

**7a. Hickam's Dictum for codebases.**

Amanuensis's concern-driven methodology implicitly assumes concerns are independent.
But complex subsystems frequently have multiple active bugs simultaneously, and those
bugs can interact (one bug masks another, or two bugs cancel each other's symptoms in
normal operation but compound them under load).

**Recommendation**: When a subsystem has 3+ confirmed findings, explicitly ask: "Do
any of these interact? Could fixing one expose or worsen another?" Add this as a
checkpoint in Phase 4 (Adversarial Review). This is Hickam's Dictum applied to code:
a subsystem can have as many bugs as it damn well pleases, and they may not be
independent.

**7b. Investigation cost ordering.**

Medical diagnosis orders tests by cost-effectiveness. Amanuensis does not explicitly
order its investigations by cost. Some concerns can be ruled out cheaply (a type
signature check, a grep for a pattern), while others require deep trace reads that
consume significant context window.

**Recommendation**: During Phase 3 (Concern-Driven Deep Read), explicitly triage
concerns into cost tiers before beginning deep reads:
- **Quick-check**: Can be confirmed or ruled out by a single pattern search or type
  signature inspection (cost: low).
- **Trace-required**: Requires following a code path across files (cost: medium).
- **Context-dependent**: Requires understanding runtime behavior, configuration state,
  or domain semantics (cost: high).

Process quick-check concerns first. This maximizes the number of concerns resolved per
unit of context-window expenditure and often reveals structural patterns that make the
more expensive investigations more efficient.

---

## 8. Swiss Cheese Model (Accident Investigation)

### The concept

James Reason's Swiss Cheese Model, developed for accident investigation, models
system failures as the alignment of holes in multiple defensive layers. No single
failure causes a catastrophe — it takes holes lining up across multiple layers
simultaneously. Each layer (design, training, procedures, hardware safeguards,
monitoring) has "holes" (latent conditions, active failures), and an accident occurs
when a hazard finds a path through aligned holes in every layer.

Key insight: **fixing a hole in any one layer prevents the accident, even if holes
in other layers remain.** This means that defensive depth matters, and the most
valuable fixes are those that close holes in layers that have the fewest other defenses.

### Mapping to Amanuensis

Amanuensis's concern-seeding territories (error paths, cache invalidation, blocking,
etc.) are essentially single-layer checks. Each territory asks: "Is there a hole in
this layer?" But it does not ask: "If this layer has a hole, what other layers would
prevent the failure from reaching the user?"

This is partially addressed by the adversarial review's "compensating mechanism"
directive ("What mechanism would you need to find to overturn this?"). But the Swiss
Cheese Model adds a structural insight: some bugs are *individually non-critical* but
*collectively dangerous* when multiple defensive layers fail simultaneously.

**Recommendation**: Add a **defense-in-depth assessment** to Phase 4 (Adversarial
Review). For each confirmed finding, enumerate the defensive layers between that
failure mode and user-visible impact:

- Is there input validation that prevents the triggering condition?
- Is there a retry/recovery mechanism that masks the failure?
- Is there monitoring/alerting that would catch it before user impact?
- Is there a rate limit or circuit breaker that bounds the blast radius?

A finding with zero remaining defensive layers between it and user impact is
**unmitigated** and should be flagged at the highest severity regardless of likelihood.
A finding with two or more intact defensive layers may be genuinely lower severity,
and the assessment should record *which* layers provide the defense.

---

## 9. Thick Description (Ethnography)

### The concept

Clifford Geertz's "thick description" (borrowed from Gilbert Ryle) distinguishes
between a **thin description** (observable behavior: "he contracted his eyelid") and
a **thick description** (behavior plus context, intention, and meaning: "he winked
conspiratorially at his friend"). The same physical action has entirely different
meaning depending on context. Thick description captures not just what happened, but
what it *means* within its cultural/social context.

### Mapping to Amanuensis

Amanuensis's survey outputs face the thin/thick description problem directly. A thin
description of a codebase finding is: "Function `processOrder()` does not validate
the `quantity` field." A thick description is: "Function `processOrder()` does not
validate the `quantity` field. This is downstream of the order intake API, which *does*
validate quantity at the schema level. The unvalidated path exists because
`processOrder()` is also called by the batch import system, which was added later and
bypasses the API validation layer. The missing validation is a real bug, but only for
the batch import path."

**What Amanuensis already does**: The methodology explicitly requires business/domain
context for concern classification: "You know enough domain and business context to
distinguish a real bug from an acceptable tradeoff." The seven-field invariant's `why`
field partially captures intent. The vocabulary system captures domain terminology.

**Where it falls short**: The methodology requires thick description but does not give
the agent a structural framework for producing it. The instruction "know enough domain
context" is correct but does not specify *what dimensions of context* to capture.

**Recommendation**: Define a **context frame** for findings — a small set of dimensions
that distinguish thin from thick description:

1. **Call-path context**: How does execution reach this code? (All paths, not just the
   primary one.)
2. **Historical context**: Why does the code look like this? (Intentional design,
   accretion, known tech debt, migration artifact?)
3. **Domain context**: What domain rule or business constraint makes this behavior
   acceptable or unacceptable?
4. **Scope context**: Is this finding specific to one call path, or does it apply to all
   consumers of this code?

A finding that fills all four dimensions is thick. A finding that fills only (1) is thin
and higher risk of being incorrect.

---

## 10. Triangulation (Ethnography / Social Science)

### The concept

Triangulation is the practice of using multiple independent methods or data sources to
study the same phenomenon. If different methods converge on the same conclusion, confidence
increases. If they diverge, the divergence itself is informative.

Forms of triangulation:
- **Data triangulation**: Multiple data sources (different informants, different time periods)
- **Methodological triangulation**: Multiple methods (observation, interview, document analysis)
- **Investigator triangulation**: Multiple investigators independently analyzing the same data

### What Amanuensis already does

The adversarial review (Phase 4) is a form of methodological triangulation: it re-examines
findings using a different analytical lens (attempt to disprove rather than confirm). The
clean-room protocol recommended in §5b above would add investigator triangulation.

### What to adopt

**10a. Data triangulation for evidence assessment.**

A finding supported by only one type of evidence (e.g., only code reading) is less reliable
than one supported by multiple types (code reading + test examination + runtime behavior +
git history). Amanuensis currently treats all code-derived evidence as equivalent.

**Recommendation**: When a finding is high-severity, explicitly seek corroborating evidence
from a *different data source*:
- If the finding came from code reading, check whether tests cover the scenario.
- If from test absence, check git blame to see if tests were intentionally removed.
- If from a static pattern, check runtime configuration to see if it's dynamically guarded.

This is cost-effective only for high-severity findings. Do not mandate it for every concern.

---

## Summary: Adoption Priority

The recommendations above are ordered by expected impact on Amanuensis's surveying
accuracy, weighted against implementation cost.

| Priority | Recommendation | Source Domain | Section |
|----------|---------------|---------------|---------|
| **High** | Diagnosticity matrix for competing concerns | Intelligence (ACH) | §1a |
| **High** | Evidence-quality tags on findings | Intelligence (Info Classification) | §2a |
| **High** | Contradiction detection between findings | Archaeology (Loop Detection) | §4b |
| **High** | Provenance tracking for findings | Forensics (Chain of Custody) | §5a |
| **High** | Context frame for thick description | Ethnography | §9 |
| **Medium** | Sensitivity analysis / linchpin identification | Intelligence (ACH) | §1b |
| **Medium** | Defense-in-depth assessment | Accident Investigation (Swiss Cheese) | §8 |
| **Medium** | Investigation cost ordering | Medicine (Differential Diagnosis) | §7b |
| **Medium** | Sentinel conditions for future monitoring | Intelligence (ACH) | §1c |
| **Medium** | Finding clusters for pattern recognition | Archaeology (Higher-Order Groupings) | §4c |
| **Medium** | Demand decay for field-demand tracking | Intelligence (Collation Attributes) | §3 |
| **Low** | Trace-back from symptom to root cause | Forensics (Locard's Principle) | §6 |
| **Low** | Clean-room protocol for adversarial review | Forensics (Contamination) | §5b |
| **Low** | Hickam's Dictum interaction check | Medicine (Differential Diagnosis) | §7a |
| **Low** | Data triangulation for high-severity findings | Ethnography (Triangulation) | §10a |
| **Low** | Temporal atomicity in compression | Archaeology (Single-Context Recording) | §4a |
| **Low** | Concern checklist independent of Tier 1 budget | Intelligence (Collation Attributes) | §3 |

"High" = addresses a gap where Amanuensis currently has no mechanism and the failure mode
is likely. "Medium" = strengthens an existing mechanism or addresses a less frequent failure
mode. "Low" = valuable in specific scenarios, low urgency for general adoption.

---

## Appendix: What Amanuensis Already Gets Right

Several core design choices in Amanuensis already reflect investigative best practices,
even though they were not explicitly derived from these domains:

- **Evidence over intuition** (methodology.md: "Both questions require evidence, not
  intuition") — mirrors the intelligence community's core principle.
- **Adversarial review with explicit contradiction pairs** — isomorphic to ACH's
  attempt-to-disprove methodology.
- **Observed facts / inferences / open questions separation** (onboarding.md operating
  principles) — parallels the intelligence information classification hierarchy.
- **Vocabulary system** — parallels ethnographic fieldwork's practice of learning the
  community's own terminology before interpreting behavior.
- **File ledger** — parallels archaeological site registers and forensic evidence logs.
- **Survey-session SHA anchoring** — a basic form of chain of custody.
- **Concern-driven investigation** — parallels both differential diagnosis (symptom-driven
  investigation) and archaeological excavation (question-driven rather than area-driven).

The recommendations above build on these existing strengths rather than replacing them.
