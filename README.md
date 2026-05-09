# Amanuensis

> _An architectural scribe for codebases, built as an agentic methodology to
> overcome the fact that LLMs are unreliable narrators of code._

Amanuensis is a set of VS Code agents plus an MCP server plus a materializer
that, together, survey a codebase and produce a persistent, navigable,
evidence-driven **conspectus** — a structured architectural record that
survives across sessions and agent boundaries.

It is designed for both: 
 1. A tool to validate and understand the firehose of code LLMs can produce
 when let loose and build sufficient confidence to use it.
 2. Working in large, mixed-language production codebases where a single-
pass "review my code" from a chat assistant produces plausible-sounding
analysis that can't be trusted.

## The problem

Single-pass LLM code review has four recurring failure modes:

1. **Confirmation without compensation.** The model identifies a concern
   (missing timeout, unchecked deref, race on shared state) and reports it
   without looking for the retry loop, the supervisor, the type-system
   guarantee, or the single-caller invariant that bounds the blast radius.
2. **Classification from naming.** `UserCache` must be a cache;
   `sanitize_input` must sanitize input; `deprecated` means deprecated.
   The model classifies from names and file paths without reading the code.
3. **Smoothing over contradictions.** When two observations disagree, the
   model averages them into a hedged sentence instead of surfacing the
   disagreement. Contradictions are the epistemically honest output of
   investigation; hedging hides them.
4. **Amnesia across sessions.** Every conversation starts from zero. What
   the model confirmed last week, it re-verifies from scratch today — or,
   worse, re-confabulates. There is no persistent state of what is
   known, what is suspected, and what was ruled out with evidence.

Amanuensis is a methodology that constrains LLM output to prevent each of
these. The tooling in this repo makes the methodology executable.

## The approach

A survey is **phased, evidence-driven, and adversarially reviewed**.

1. **Scope.** Populate a structured file ledger for the subsystem. Seed
   domain vocabulary. Stub every seam (inter-subsystem boundary). No
   reading of method bodies yet — the ledger exists to prevent sampling
   bias in later phases.
2. **Structural inventory.** Types before implementation. State containers,
   data flows, concurrency model, seam contracts from this side. Document
   the map before evaluating concerns against the territory.
3. **Concern-driven deep read.** A calibrated checklist of concerns
   specific to *this* codebase's languages, runtime substrates, and
   architecture (derived during onboarding from 11 concern territories).
   Every concern gets a terminal classification — confirmed-bug,
   confirmed-acceptable, ruled-out, out-of-scope, or unresolved-competition
   — backed by evidence, an evidence-quality tag, and a rationale.
4. **Adversarial review.** For every confirmed finding and every
   linchpin-dependent disposition, an adversarial agent tries to
   *disprove* it. Claim A, Claim B, evidence for Claim B, verdict.
   Findings that survive this are the highest-confidence claims in the
   conspectus. Findings that don't survive are reclassified to `ruled-out`
   with evidence — not silently deleted, so future analysts don't re-tread
   the same ground.
5. **Output packaging.** Structured data (file ledger, dispositions,
   findings, field notes, evidence, seams, diagnosticity matrices) lives
   in the database. Prose artifacts (onboarding report, entry-point doc,
   subsystem narratives) live in markdown. The materializer renders both
   into navigable, cross-referenced documentation.

The methodology is **confidence-gated**: a subsystem's mapping status
determines what claims the agents are authorized to make about it.

| Status | Authorized claims |
|---|---|
| `unmapped` | None. No assertions about behavior. |
| `scoping` | File scope only: "F is in scope for S." |
| `structural` | Types, state containers, flows, concurrency model. No correctness claims. |
| `concerns` | Concern dispositions with evidence. Findings at evidence_quality ≥ code-verified. |
| `adversarial` | As above, plus survived adversarial probes. Highest confidence. |
| `mapped` | Complete. Seam contracts filled in. Ready for composition. |

An agent or LLM using the conspectus that makes a claim exceeding the
authorized level for its source must flag the claim explicitly as
speculative. This is Amanuensis's most important epistemic constraint.

A subsystem can also carry a seventh status, `deferred` — not a knowledge
level but an explicit "do not survey yet" flag (e.g. out-of-scope for the
current engagement, blocked on a dependency, owner unavailable). Deferred
subsystems don't advance through the phases and don't participate in
concern coverage.

## What's genuinely new

Much of the methodology borrows. These parts are Amanuensis-specific
structural contributions:

- **Confidence-gated assertion authority.** Every subsystem has a
  survey status, and that status defines what claims any downstream
  agent (or human) is authorized to make about it. Exceeding the
  authorized level requires explicit speculation framing.
- **Codebase-calibrated concern derivation.** Onboarding Phase 4
  instantiates 11 concern territories against the specific codebase's
  language, runtime, and concurrency substrate — not a generic
  checklist. Non-applicable territories are recorded with the
  disqualifying condition, not silently skipped.
- **Adversarial review as a first-class phase.** Phase 4 isn't a
  polish step. It is a separate agent that applies one of five prose
  verdicts — `upheld`, `overturned`, `scope-restricted`,
  `quality-upgraded`, `quality-downgraded` — to every confirmed
  finding, recorded in the subsystem-survey markdown. Each verdict
  has a defined schema consequence: `overturned` flips
  `findings.status` to `ruled-out`; `quality-upgraded` attaches new
  evidence; `scope-restricted` narrows `business_context`. Overturned
  findings are reclassified, not deleted — the trail remains.
- **Contradiction pair tracking.** When two findings about the same
  `file:symbol@sha` reach incompatible conclusions, the disagreement
  is a first-class row in the `contradictions` table and surfaces on
  a dedicated materialized page. The conspectus makes its own
  uncertainty visible; it does not smooth.
- **Structured ACH matrices.** The diagnosticity matrix is four
  tables (`diagnosticity_sessions`, `_concerns`, `_evidence`,
  `_cells`) with a dedicated materialized page per matrix. Competing
  concerns don't get independent evaluations — the cells enforce the
  across-row discrimination that makes ACH work.
- **First-class seam registry.** Inter-subsystem boundaries are rows,
  not prose. A seam becomes *assessable* only when both parties reach
  `mapped` — enforced by a view the coordinator consults before
  running seam assessment. Composition bugs get a home.
- **Diff-aware materialization.** The human-facing docs are a
  deliverable, not a report. A per-page source-hash manifest re-renders
  only pages whose DB or prose sources changed, with a global
  cross-reference resolver that links every ID on every page without
  rewriting unchanged content.

## Where it came from

The methodology started as 10 general areas I found myself exploring whenever
getting a feel for unfamiliar code and evolved through a handful of iterations. 
Once it was able to produce usable results, I did some research into six 
disciplines that felt relevant, ultimately borrowing the following concepts 
(a longer treatment lives /dev; this section sketches the provenance):

- **Intelligence analysis.** Richards Heuer's *Analysis of Competing
  Hypotheses* (ACH) is the model for the diagnosticity-matrix protocol.
  When two or more concerns could independently explain the same
  symptom, Amanuensis opens a matrix (columns: concerns, rows:
  evidence), evaluates each cell, and ranks by *inconsistency* — the
  concern with the most contradicting evidence is rejected first. ACH's
  linchpin-evidence concept became Amanuensis's `linchpin_dependent`
  flag and the related hygiene pass.
- **Archaeology.** The Harris Matrix's insistence that every
  stratigraphic relationship be recorded, even when the interpretation
  is uncertain, became Amanuensis's insistence on recording every
  concern's disposition even when the verdict is "ruled out" or
  "insufficient evidence." The matrix is the record, not the conclusion.
- **Forensic science.** Chain of custody for evidence maps onto
  Amanuensis's `evidence` table: every citation is a structured row with
  file, symbol, line range, commit SHA, kind, and collection context.
  Shared evidence can attach to multiple dispositions and findings, and
  "find everything that cites file X" is a query, not a grep.
- **Medicine.** Differential diagnosis — enumerate the candidate
  explanations, test discriminating evidence, rank by inconsistency —
  is ACH with a stethoscope. The mindset informs the adversarial pass:
  *what observation would overturn this finding?*
- **Accident investigation.** James Reason's Swiss Cheese model
  shaped the concern-territory framing: defects rarely occur at a
  single layer, and the methodology's job is to map how adjacent
  layers align (or fail to) rather than to judge each layer in
  isolation. Seam concerns are composition bugs — bugs that don't
  exist in either subsystem alone, only in their joint behavior.
- **Ethnography.** Clifford Geertz's *thick description* is the model
  for context framing: a disposition is not thick — and not
  authoritative — until it supplies call-path, historical, domain, and
  scope context. A thin disposition (only call-path) is marked
  `linchpin_dependent` so adversarial review knows where to look.

Amanuensis concretizes the first two — ACH and chain of custody — into
first-class database tables (`diagnosticity_sessions`, `diagnosticity_cells`,
`evidence`, `disposition_evidence`, `finding_evidence`). The others live
in the methodology prose and the agents' instructions.

## What's in this repo

```
mcp-server/            TypeScript MCP server (better-sqlite3, @modelcontextprotocol/sdk)
                         Owns memory.db + the git-backed storage directory.
                         Tool inventory auto-generated in mcp-server/DEVELOPMENT.md.
materializer/          Python package that renders the conspectus into
                         navigable docs/. Diff-aware, cross-referenced,
                         mermaid diagrams generated from DB state.
agents/                Seven VS Code .agent.md files:
                         amanuensis (coordinator),
                         amanuensis-scoper (Phase 1),
                         amanuensis-structural (Phase 2),
                         amanuensis-concerns (Phase 3),
                         amanuensis-adversarial (Phase 4),
                         amanuensis-notes (conversational),
                         amanuensis-memory-auditor (hygiene sweep)
  references/          Amanuensis's own reference docs:
                         concern-territories.md, artifact-templates.md
dev/                   Development archive: design specs and source material
                         from the broader research program Amanuensis is
                         part of.
```

## Architecture

```
┌──────────────────────────────────────┐
│   VS Code custom agents              │
│   (.agent.md files)                  │
│                                      │
│   coordinator ─┬─ scoper             │
│                ├─ structural         │
│                ├─ concerns           │
│                ├─ adversarial        │
│                ├─ notes              │
│                └─ memory-auditor     │
└──────────┬───────────────────────────┘
           │ MCP stdio
           ▼
┌────────────────────────────────────┐
│   amanuensis-memory MCP server     │
│   (TypeScript · better-sqlite3)    │
│                                    │
│   Owns: memory.db (WAL)            │
│   Owns: git state, sessions        │
│   Owns: ~/.amanuensis/workspaces/  │
│                                    │
│   materialize_docs ──┐             │
└──────────┬───────────┼─────────────┘
           │           │ subprocess
           ▼           ▼
┌───────────────┐  ┌──────────────────────┐
│   memory.db   │  │  Python materializer │
│   + prose     │  │  (stdlib only)       │
│   artifacts   │  │                      │
└───────────────┘  │  docs/.manifest.json │
                   │  diff-aware renders  │
                   │  cross-ref resolver  │
                   │  mermaid diagrams    │
                   └──────────┬───────────┘
                              ▼
                   ┌──────────────────────────┐
                   │  docs/                   │
                   │  (navigable conspectus)  │
                   └──────────────────────────┘
```

## Quick start

### Prerequisites

- Node.js ≥ 20
- Python 3.11+ (stdlib only; no pip install required)
- VS Code with an MCP-compatible agent runtime

### Install

```bash
npm install -g amanuensis

cd your-project
amanuensis init
```

`amanuensis init` writes the agent files into your workspace and
adds an `amanuensis-memory` entry to `.vscode/mcp.json`, merging
with any existing MCP server configuration. Re-run with `--force`
to overwrite an existing entry.

### Run onboarding

Invoke the `amanuensis` agent in VS Code on the codebase you want to
survey. Say "run onboarding." The coordinator walks the eight
onboarding phases (Phase 0 orientation through Phase 7 packaging),
pausing at each gate for your acknowledgment. On completion you'll
have a seeded `memory.db`, six prose artifacts, a materialized
`docs/` site, and a calibrated concern checklist specific to your
codebase.

From there:

- **Survey a subsystem**: "survey B-01" → the coordinator invokes the
  scoper → structural → concerns → adversarial agents in sequence,
  pausing at each phase boundary for your review.
- **Browse**: "what have you noticed?" → invokes the notes agent.
- **Audit**: "audit the conspectus" → invokes the memory-auditor.

The project storage directory (`~/.amanuensis/workspaces/<owner>/<project>/`)
is initialized as a git repo on first open. Every `end_session` call
auto-commits, and agents can call `commit_phase_gate` at any phase
boundary. Rollback, history, and diffing are free. If the git binary
isn't available or init fails, the server still runs — history is a
nice-to-have, not load-bearing.

## One instrument in a larger project

Amanuensis is a concrete realization of a broader theory of disciplined
LLM use — the conditions under which a language model is a reliable
narrator of complex systems, and the conditions under which it is not.
The full argument, and the rest of the toolkit it implies, continue to
develop elsewhere. This repository is the first piece to ship. The bigger
vision is something I've been calling Living Operational Context.

## License

MIT. See [`LICENSE`](LICENSE).

## Example

See [grafana-conspectus](https://github.com/nfeldman/grafana-conspectus)
for a partial demonstration of what this can be used for in practice.