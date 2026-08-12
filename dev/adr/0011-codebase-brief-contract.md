# ADR-0011: Make CodebaseBrief a versioned contract, not a storage DTO

- Status: accepted for A10
- Date: 2026-08-12
- Deciders: Amanuensis roadmap implementation; Chorusmith extraction and final architecture authority remain external

## Context

A9 offers a fast, inspectable review surface, but review rows are still shaped
for that product moment. Design and generative sessions need additional
distinctions—especially direct versus inferred intent, options versus observed
behavior, and explicit selection loss—without reaching into SQLite or making
storage schema an accidental public API.

The difficult tension is compression versus custody. A task-bounded brief must
omit most of a surveyed codebase to be useful, but unrecorded omission makes a
small prompt look complete. Model-assisted retrieval would also be wasteful and
less trustworthy when a caller already names an exact durable object.

## Decision

### Freeze source truth before projecting a mode

`prepare_codebase_brief_source` creates one immutable source manifest from an A9
review session, a direct objective, typed task constraints, and optional
provenance-bound inferred intents and candidate options. Each candidate has:

- a stable ID and content hash;
- one of eight content categories: facts, direct intent, inferred intent,
  constraints, contradictions, changes, options, or gaps;
- an explicit epistemic kind that keeps observed behavior, inference, direct
  intent, inferred intent, recommendation, and open question distinct;
- a durable record URI, source identity, provenance list, and validity record;
- declared mode eligibility and lexical relevance terms; and
- a required flag.

The source itself has a content hash over the complete candidate census.
Review, design, and generative briefs all retain that identity. Projection may
select a different subset, but it cannot rewrite the selected candidate.

The external contract is version `1.0.0` and ships as
`mcp-server/contracts/codebase-brief.schema.json`. Pure compilation and
validation code has no SQLite dependency, and the seeded fixture runs through
all three modes without opening a database.

### Select deterministically and account for loss

Selection is `registry-then-lexical-v1`:

1. required task intent and constraints are admitted;
2. explicit candidate IDs resolve exactly in the frozen local registry;
3. remaining mode-eligible candidates are ranked by deterministic lexical
   overlap and stable ID; and
4. the declared item limit bounds the result.

The trace states `model_calls: 0`. Exact identity may intentionally override a
mode's default policy, and that fact remains visible as `registry-exact` rather
than masquerading as lexical relevance.

Every source candidate appears exactly once as selected or omitted. Omissions
have one operational reason:

- `policy`: excluded by the declared mode policy;
- `irrelevant`: zero lexical overlap with the task query; or
- `budget`: relevant and mode-eligible but ranked below the item limit.

The item limit cannot evict required or explicitly requested candidates; an
undersized request fails instead of silently dropping them.

### Validate shape and meaning

JSON Schema catches missing fields and enum drift. The semantic validator also
recomputes candidate and source hashes, enforces category/epistemic pairings,
checks manifest hashes, rejects duplicates, and reconciles the source manifest
against selected plus omitted IDs and stored counts. SQLite independently binds
stored source, projection, and validation summary columns to their JSON.

## Alternatives rejected

- **Expose review-session or SQLite rows directly:** freezes storage accidents
  into every future session engine and makes extraction harder.
- **One universal projection:** either overloads review with speculative options
  or strips design and generation of the distinctions they require.
- **Model retrieval first:** spends inference on exact identity, introduces
  nondeterministic omission, and makes lookup harder to audit.
- **Token truncation without an omission ledger:** presents an unknown subset as
  if it were the complete situation.
- **Flatten all claims to facts:** erases the authority boundary between user
  desire, inferred intent, observed behavior, and recommendation.
- **Let required context overflow the declared budget:** makes the budget false;
  failing early gives the caller a truthful sizing decision.

## Consequences and limits

- A11 can consume one typed contract and vary analytical lenses without
  querying storage tables.
- Future Chorusmith integration has an explicit adapter seam and can be parity
  tested against versioned fixtures before extraction.
- Registry and lexical routes are implemented and measured structurally; A10
  does not claim that lexical relevance is semantically sufficient.
- Optional inferred intent and options must cite existing A9 review-item IDs,
  but their content quality remains an A11 generation and challenge concern.
- The current budget is item-count based. A token or cost budget can be added in
  a backward-compatible contract revision only if its omissions remain exact.

## Practice basis

Practice catalog v2.8: GP7 (uncertainty remains explicit), GP11 (separate
observation, inference, and question), GP12 (provenance preservation), GP14
(progressive disclosure), GP27 (deterministic retrieval before model use), GP28
(semantic read-back), and VP20 (task-relevant outcome measures rather than
satisfaction alone).

## Verification obligations

- [x] One frozen source produces distinct review, design, and generative briefs
  with the same source hash.
- [x] JSON round-trip preserves observed behavior, direct intent, inferred
  intent, and recommendation as distinct epistemic kinds.
- [x] Every excluded candidate is accounted for by policy, irrelevance, or
  budget; the source census reconciles exactly.
- [x] Exact registry lookup and selection preserve identity and report zero
  model calls.
- [x] JSON Schema and semantic validation reject erased epistemic metadata.
- [x] Semantic validation rejects a removed omission even when counts are
  adjusted to disguise the loss.
- [x] The contract fixture compiles and validates without SQLite.
- [x] MCP preparation, compilation, exact lookup, persistence, and validation
  pass against a fresh database.
