# ADR-0015: Resolve identity before enrichment and qualify methods before activation

- Status: accepted for A14
- Date: 2026-08-12
- Deciders: Amanuensis owns crosswalk and policy custody; Scholiast owns external-source custody; Collatio supplies the qualification shape

## Context

A13 can land external claims without misclassifying them as repository facts,
but learning across code, research, decisions, and methods creates another
failure boundary. Two resources can share a name while referring to different
things. Two resources can also be usefully analogous while transferring none of
each other's authority or properties. A graph that turns lexical resemblance
into identity would make cross-domain synthesis look coherent by silently
destroying its epistemic distinctions.

Method adoption has a parallel problem. An attractive technique can produce a
persuasive demonstration while failing on clean controls, scramble controls,
or the production fault it claims to prevent. The method registry is consumed
by unattended workflows, so activation must be a mechanically enforced state
transition, not prose approval in a session summary.

Collatio v2 defines the relevant experimental discipline—frozen predictions,
graded controls, production red gates, exact result custody, and derived
status—but its current research program remains in design review and is not
authorized to run. Amanuensis therefore needs an adapter compatible with that
shape without claiming that Collatio itself has been executed or qualified.

## Decision

### Identity precedes enrichment

Every crosswalk endpoint is an immutable, provenance-bearing reference to one
code claim, external claim, concern, decision revision, or method. Registration
normalizes the label only to find possible collisions. A unique label records a
`unique` resolution; a collision stays `pending` until evidence resolves it as
`same-as` or `distinct`.

Pending endpoints cannot receive properties or relations. Properties copied
from another endpoint require equal canonical identity. Analogy, shared naming,
and topical proximity never authorize inheritance. A `same-as` edge can only be
created by the identity-resolution path after both endpoints share a canonical
identity.

### Relations are finite, qualified, and historical

User-created relations are restricted to `supports`, `contradicts`, `refines`,
`analogous-to`, `applies-to`, `derived-from`, and `supersedes`; `same-as` is
reserved for identity resolution. Every relation requires a statement,
positive criteria, negative criteria, validated provenance, and a validity
start. Supersession creates a new immutable relation over the same endpoints
and closes the predecessor's validity interval.

Counterevidence is an append-only record attached to the relation it challenges.
It is not averaged into a consensus score and is not deleted when a successor
narrows the relation. Consequently, projections report both historical
relations and unresolved counterevidence rather than only current conclusions.

### Qualification is separate from landing and activation

Method qualification has four authority boundaries:

1. `plan_method_qualification` freezes an explicitly authorized scope, an
   integer prediction and falsifier, the baseline/positive/negative/scramble/
   inconclusive controls, production red gates, result custody, and one target
   policy key.
2. `land_method_qualification` requires one durable JSON artifact whose name,
   schema version, observations, controls, red-gate demonstrations,
   reconciliation counts, and limitations exactly match the landed result,
   then re-reads and hashes it. Landing cannot award a pass.
3. `score_method_qualification` mechanically compares the result with the
   frozen plan across prediction, controls, red gates, custody, and read-back.
4. `activate_qualified_method` writes the frozen policy destination. A SQLite
   trigger independently rejects any write without a passed score and read-back.

The repository fixture uses `v2-adapter-fixture` and states its limitation. It
tests the adapter contract. It does not authorize the Collatio v2 program or
claim population-level efficacy for the example method.

### Projections must survive semantic read-back

A crosswalk projection includes exact endpoint and relation records, relation
type counts, identity state, unresolved counterevidence, and active methods.
Verification derives the expected projection again and separately records
state, coverage, and content axes. A structurally plausible projection that
drops counterevidence fails content read-back.

## Options considered

- **Merge on normalized label:** rejected because names are candidate generators,
  not evidence of referential identity.
- **Allow property transfer over analogy:** rejected because structural
  similarity does not transfer scope, truth, provenance, or authority.
- **Use an open-ended ontology:** rejected for A14 because relation-vocabulary
  growth would outrun the evidence and make projection behavior unpredictable.
- **Let a landed result self-report pass:** rejected because the producer would
  grade its own work and could bypass frozen controls.
- **Treat the fixture as a Collatio qualification result:** rejected because the
  upstream v2 program is not authorized and the fixture establishes only adapter
  mechanics.

## Consequences

- Cross-domain synthesis is deliberately slower at ambiguous identity boundaries.
- Historical relations and open counterevidence increase storage and projection
  volume but keep semantic changes auditable.
- Low-risk heuristics whose outcomes resist measurement may remain manual; that
  is an explicit false-negative risk rather than silent unattended authority.
- A15 can reuse the qualification and policy boundary for learned methods while
  keeping corpus, retrieval, research, and user-preference channels distinct.
- The relation vocabulary remains intentionally small; additions require new
  positive/negative semantics and projection tests.

## Practice basis

Practice catalog v2.8: GP1 (explicit contracts), GP6 (negative criteria), GP9
(preserve contradiction), GP11 (provenance), GP12 (epistemic-kind separation),
GP27 (identity before enrichment), GP28 (qualified promotion), VP4 (prediction
before execution), VP7 (graded controls), VP10 (red-gate demonstration), and
VP12 (derived status and read-back). The adapter follows Collatio's experimental
shape while retaining its actual authorization boundary.

## Verification obligations

- [x] Surface-similar concepts remain pending rather than auto-merging.
- [x] Pending or distinct identities cannot inherit each other's properties.
- [x] Relations require positive criteria, negative criteria, and resolvable provenance.
- [x] External counterevidence survives relation supersession.
- [x] Unauthorized qualification plans are rejected.
- [x] Direct unattended-policy writes fail before passed qualification and read-back.
- [x] Prediction, all five control types, every red gate, custody, and artifact hashes are mechanically scored.
- [x] A qualification receipt whose content disagrees with the landed measurement is rejected.
- [x] Removing counterevidence makes projection content verification red.
