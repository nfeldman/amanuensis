# ADR-0013: Separate decision authorship, acceptance, and premise validity

- Status: accepted for A12
- Date: 2026-08-12
- Deciders: Amanuensis implements custody; only a human or explicitly owning system accepts a product decision

## Context

A11 can furnish a well-supported architecture lean, but persuasive advice is
not authority. If storing it makes it “the decision,” Amanuensis has invented
desire and policy. Conversely, storing only the selected option loses why it
was chosen, what was rejected, what it costs, and what future observation
should reopen it. Accepted decisions also become dangerous when their premises
change silently while the record still appears current.

## Decision

### Revisions are immutable; authority is an event

A decision owns an ordered series of immutable revisions. A revision may be
`draft`, `accepted`, `rejected`, `superseded`, or `invalidated`. Draft payloads
retain direct-user desire sources, the proposed selected option, alternatives,
constraints, consequences, falsifiers, typed premises, code links, rationale,
and authorship.

Drafting is allowed for a model, human, or owning system. Acceptance is not:
the database requires an append-only event from `human` or `owning-system`, a
named actor, an authority source, and a scope equal to the decision or exact
revision. That event must exist before SQLite permits the revision to become
accepted, and the current-authority pointer may reference only an accepted
revision. Handler prose is not the guard.

Rejecting a draft preserves its full option and evidence record. Reconsidering
it creates a successor revision. Accepting a successor supersedes an accepted
predecessor, retaining both histories. Invalidation requires new evidence or an
applied impact and removes current authority without editing the premise.

### Premise changes produce obligations

Premises are typed as claims, evidence, or code paths. Decision code links name
implementation relationships separately. `detect_decision_impacts` consumes an
applied A2 artifact and compares its invalidated claims and changed paths with
every accepted decision. A match appends an impact event and creates an open,
blocking `decision-impact` revalidation obligation. It does not automatically
reverse the decision: changed evidence demands review, not synthetic desire.

### Projection transfers custody, not authority

The versioned `CodebaseDecision 1.0.0` projection carries the decision identity,
revision payload, full authority-event history, and an explicit
`projection-only` boundary for Chorusmith. State, required-field coverage, and
semantic content are independently read back against durable storage. The
projection cannot accept or mutate its source decision.

## Options considered

- **Treat A11's lean as accepted:** rejected because a recommendation is not a
  human desire or acceptance event.
- **Mutable ADR row:** rejected because premise, alternative, and authority
  history could be silently rewritten.
- **Automatically invalidate on any code match:** rejected because an impact is
  a reason to review; it may not falsify the premise.
- **Keep alternatives only in prose:** rejected because rejected options would
  not be queryable or safely reconsiderable.
- **Give Chorusmith a writable decision copy:** rejected because transport
  custody must not split acceptance authority.

## Consequences

- Accepted architecture becomes explicit, attributable, and reconstructable.
- A stale premise remains visible as a blocking obligation even while the
  accepted decision stays historically intact.
- Decision records are heavier than a conventional ADR; drafting helpers must
  keep authoring cost low without weakening required custody.
- The system records asserted authority identity and scope; cryptographic or
  organizational identity verification remains an integration concern.
- A13 can derive research questions from decision falsifiers and evidence gaps
  without treating those questions as changes to the decision.

## Practice basis

Practice catalog v2.8: GP9 (preserve contradiction and alternatives), GP10
(bound assertion authority), GP11 (provenance custody), GP16 (human origin of
desire), GP18 (persistent revisable history), GP20 (gaps receive destinations),
and GP25 (authority violations halt).

## Verification obligations

- [x] A model-authored recommendation remains draft; handler and direct SQL
  promotion without authorized acceptance both fail.
- [x] Acceptance preserves actor, source, and matching authority scope.
- [x] Accepted premise payload is immutable.
- [x] An applied code impact creates a visible blocking review obligation and
  leaves the accepted decision unchanged.
- [x] Successor acceptance supersedes history; evidence-backed invalidation
  removes current authority without deletion.
- [x] Rejected options remain queryable and require a new revision to revisit.
- [x] The portable projection validates against its versioned schema.
- [x] Read-back rejects missing desire sources, alternatives, falsifiers, and
  acceptance-event content.
