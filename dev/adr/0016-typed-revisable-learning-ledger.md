# ADR-0016: Distill sessions into typed, scored, and revisable lessons

- Status: accepted for A15
- Date: 2026-08-12
- Deciders: Amanuensis owns learning and runtime-policy custody; the human retains preference authority; A14 owns method qualification

## Context

Completed review and design work contains reusable information, but “remember
what worked” is too coarse to automate. A code observation, a retrieval shortcut,
an evaluated method, an external research claim, and a user's presentation
preference have different sources, truth conditions, scopes, and rollback risks.
Putting them in one mutable memory object would let convenience masquerade as
truth and let an attractive session summary silently alter later runs.

The production transcript-distillation work supplies several measured boundary
conditions. Completion is a verified scanner-state transition rather than exit
zero; candidate generation is not verification; output count is not value;
evidence, corrections, negative results, and limitations survive; promotion is a
typed serialized mutation with preimage and rollback; and measured, grounded,
and asserted claims remain distinguishable. Amanuensis adopts those custody
properties, not the transcript pipeline's provider routing or population-level
quality claims.

## Decision

### Extract a session outcome before proposing a lesson

`extract_learning_outcome` accepts only an ended agent session, furnished review
session, or terminal design session. It freezes typed artifact records whose
states must form a prefix of:

`planned → produced → accepted → later-invalidated`

Counts are derived from the artifact set and reconciled again by SQLite. Source
references must exist; agent-session artifacts must belong to that session where
the source exposes authorship. Later invalidation is accepted only for kinds with
a mechanically checkable current state, such as a closed temporal claim,
superseded/invalidated decision revision, expired research request, or failed
method qualification. The immutable extraction is a comparison surface, not a
success headline.

### Keep five channels epistemically disjoint

Every lesson belongs to exactly one channel with one allowed epistemic kind and
at least one channel-appropriate artifact:

| Channel | Epistemic kind | Required evidence boundary |
|---|---|---|
| corpus | observation | repository claim or finding |
| retrieval | inference | measured query/review retrieval behavior |
| method | inference | method qualification, evaluation, or design option |
| research | external-claim | research request or external claim |
| user-preference | direct-intent | matching named human statement and exact scope |

A preference must preserve human actor, source reference, statement, and scope.
It cannot enter the corpus or research channel. Conversely, code or external
evidence cannot manufacture a preference.

Every candidate also freezes its intended configuration and a rollback plan:
trigger, action, records to preserve, and an explicit selector plus known IDs for
future runs affected by activation or supersession.

### Qualification is scored and channel-specific

Candidate creation confers no policy authority. A separate immutable evaluation
records metric, baseline, observation, direction, minimum effect, exact evidence,
limitations, and mechanically derived pass status. Corpus and research use a
provenance audit; retrieval may use provenance audit or ablation; method requires
treatment-versus-clean or ablation plus a passed A14 qualification/read-back;
preference requires scored confirmation by the same named human.

A failed evaluation stays visible as a candidate. It cannot be reinterpreted as
qualified; changed evidence requires a new candidate revision.

### Runtime policy has version and read-back custody

`stage_learning_policy` accepts only a qualified lesson whose configuration
exactly matches the frozen candidate. If a policy is already active, the new
lesson must name that active lesson as predecessor. A method lesson additionally
requires the matching method to be active in A14's unattended registry.

`verify_learning_policy` first reads the staged runtime representation, then in
one transaction activates the new version, supersedes the old lesson and policy,
and calls the same active-policy reader used by future runs. State, field
coverage, and full semantic content must match; otherwise the transaction rolls
back. Both preactivation and postactivation reports are append-only. Later
audits use the same reader and may turn red without mutating policy.
The runtime reader returns no policy for an `active` row lacking a green
postactivation read-back, so a forged status label is not consumable authority.

Lesson and policy histories are never rewritten or deleted. Supersession links
the old policy to its successor and exposes the successor's affected-run selector.
Rollback is therefore a qualified successor, optionally marked as restoring an
earlier lesson, rather than deletion or in-place reversal.

## Options considered

- **One general memory channel:** rejected because its values would have no
  common truth or authority semantics.
- **Promote directly from a good session summary:** rejected because generation
  would verify and authorize itself.
- **Treat user preference as observed product truth:** rejected because a direct
  scoped desire is neither repository behavior nor an external fact.
- **Allow self-reported method improvement:** rejected because A14 qualification
  and a treatment/clean or ablation comparison are both required.
- **Overwrite active configuration:** rejected because later regressions would
  have no recoverable preimage or affected-run record.
- **Count produced lessons as value:** rejected because output volume says
  nothing about acceptance, later invalidation, or task outcome.

## Consequences

- Sparse feedback leaves more candidates unqualified; this is visible rather
  than converted into false learning.
- Preference activation is intentionally narrow and may require repeated scoped
  confirmations instead of global generalization.
- Policy history grows append-only, but rollback and attribution remain cheap.
- A16 can evaluate learning yield and regression across repositories without
  pooling channels or treating one self-run as general effectiveness evidence.
- The checked-in method fixture demonstrates A14/A15 composition only; it does
  not establish population efficacy for selective distillation.

## Practice basis

Practice catalog v2.8: GP11 (source custody), GP12 (epistemic separation), GP16
(derived status), GP18 (append-only history and recovery), GP28 (qualified
promotion), VP1 (operational definitions), VP9 (ablation), VP17 (measured
outcomes rather than volume), and VP20 (read-back at the consumer boundary).
The distillation system supplies the parsimonious candidate/promotion and
compare-and-set precedents; A14 supplies method qualification.

## Verification obligations

- [x] Outcome state sets reconcile exact planned, produced, accepted, and later-invalidated counts.
- [x] An invalidated temporal claim remains in the extraction rather than disappearing.
- [x] All five channels accept their own evidence and reject preference-as-code masquerade.
- [x] An unscored attractive summary cannot enter staged or active policy.
- [x] Method learning requires both an A14 pass/read-back and a scored ablation.
- [x] Preference learning retains scope and requires its named human's scored confirmation.
- [x] Activation reads the exact next-run representation on state, coverage, and content.
- [x] The runtime consumer hides an active row that lacks postactivation read-back.
- [x] Supersession retains old lesson/policy versions and names an affected future run.
- [x] Fault-injected configuration drift turns audit red without changing durable policy.
