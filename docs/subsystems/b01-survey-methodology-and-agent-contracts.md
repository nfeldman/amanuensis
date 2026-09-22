# **B-01** — Survey methodology and agent contracts

**Status**: 🟡 adversarial  
**Layer**: Coordination

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

.claude/skills/amanuensis/** and dev/adr/** — the method the coordinator executes and the decisions it is written against

## Start here

SKILL.md; references/subsystem-survey.md; references/phase-3-concerns.md; dev/adr/ADR-0001

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-01/method/every-obligation-has-a-substrate-half` | `B-01` | Every obligation the references instruct has a matching refusal in the server, and the references quote that refusal in the words it returns rather than paraphrasing it. onboarding.md Phase 5 carries the whole ladder in one place — empty ledger, missing claim_key, undischarged vocabulary, missing survey artifact, no dispositions, unattached or unreachable evidence, unchallenged claims, unreconciled store, undecided carried findings — and each phase reference repeats the one that ends it. The exception, stated as a rule rather than left implicit, is refresh.md's cardinal rule: the server cannot distinguish a file that was read from one that was merely cleared. | Observation | `c0734040022f` |

## Vocabulary

- **discharge or decline** — The shape every generative obligation in this method takes: satisfy it with one real record, or state out loud that none applies — never a numeric floor.
- **refusal parity** — The rule that a skill reference instructing a call the server refuses must quote the refusal in the words the server returns, so the two sides can be compared mechanically rather than read side by side.

## Known defects here

No defect here is open or awaiting verification.

## Standing

**Adversarial** — Candidate conclusions are being challenged; treat them as provisional. It cannot justify that the challenge pass has finished.

| Metric | Value |
|---|---|
| Files read | 37 of 37 ledger rows |
| Files in scope, not yet read | 0 of 37 |
| Files excluded from the survey obligation | 0 of 37 |
| Ledger rows the repository has changed under | 0 of 37 |
| Active concerns with a disposition recorded here | 12 of 12 — 8 confirmed-acceptable, 4 out-of-scope |
| Findings by resolution state | none recorded |
| Seams assessable from both sides | no seam names this subsystem |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-017d152868"></a>`.claude/skills/amanuensis/SKILL.md` | examined | The coordinator's contract: autonomy default, the stop conditions, the command routing table, the authorized-claims ladder, and the hard constraints. | `c0734040` |
| <a id="le-592927548e"></a>`.claude/skills/amanuensis/references/artifact-templates.md` | examined | The prose artifact formats the materializer's diff reads, and the entry-point acceptance gate. | `c0734040` |
| <a id="le-18b6f1fc80"></a>`.claude/skills/amanuensis/references/concern-territories.md` | examined | The eleven-territory catalog onboarding Phase 4 calibrates against, and the diagnosticity protocol. | `c0734040` |
| <a id="le-87251d5427"></a>`.claude/skills/amanuensis/references/memory-audit.md` | examined | The hygiene sweep that lists drift without working it — the route refresh.md is defined against. | `c0734040` |
| <a id="le-6a8610a679"></a>`.claude/skills/amanuensis/references/notes.md` | examined | Conversational observer mode and the describe_locus answer shape: standing first, then the account, then what is not known. | `c0734040` |
| <a id="le-fc1d1bfe9e"></a>`.claude/skills/amanuensis/references/onboarding.md` | examined | The eight-phase first pass, and the one place every status-advance refusal is quoted in the words the server returns. | `c0734040` |
| <a id="le-e6e16a1164"></a>`.claude/skills/amanuensis/references/open-questions.md` | examined | The record-and-continue protocol, its seven categories, and the headless preflight that reads get_autoprogress_mode. | `c0734040` |
| <a id="le-5b5cb8ab3d"></a>`.claude/skills/amanuensis/references/phase-1-scope.md` | examined | Phase 1: the ledger as the anti-sampling-bias deliverable, the six classifications, vocabulary seeding with a resolving anchor, seam stubs. | `c0734040` |
| <a id="le-f89e91947a"></a>`.claude/skills/amanuensis/references/phase-2-structural.md` | examined | Phase 2: key types, state containers, flows, concurrency, seam contracts, the claim_key grammar and the file-anchored evidence rule, and the discharge-or-decline vocabulary obligation. | `c0734040` |
| <a id="le-2905b9aa75"></a>`.claude/skills/amanuensis/references/phase-3-concerns.md` | examined | Phase 3: the evidence-kind ladder, set_disposition's evidence_ids requirement quoted in the server's own words, the four context dimensions, competing concerns. | `c0734040` |
| <a id="le-28758b2404"></a>`.claude/skills/amanuensis/references/phase-4-adversarial.md` | examined | Phase 4: findings and claims as targets, the five finding verdicts and three claim outcomes, and the refusals the advance to mapped raises. | `c0734040` |
| <a id="le-87d1cc2ac1"></a>`.claude/skills/amanuensis/references/phase-5-packaging.md` | examined | Phase 5: the four prose artifacts, register/rehash, materialize, contradiction detection, seam assessability, and the mapped advance. | `c0734040` |
| <a id="le-b9d0f2a875"></a>`.claude/skills/amanuensis/references/refresh.md` | examined | The drift-discharge loop, the cardinal rule against clearing what was not read, and the reinitialization section carrying the carry contract. | `c0734040` |
| <a id="le-10fb8244f3"></a>`.claude/skills/amanuensis/references/reporting-style.md` | examined | The IA/UI boundary, the register, the typed HTML projections, and the colour-per-enum rule the materializer implements. | `c0734040` |
| <a id="le-056443afa8"></a>`.claude/skills/amanuensis/references/setup.md` | examined | The installer adapters per host, the workspace-resolution contract, and the worktree-local storage default this lane depends on. | `c0734040` |
| <a id="le-a19a8b2374"></a>`.claude/skills/amanuensis/references/subsystem-survey.md` | examined | The coordinator's loop: resume logic, session setup, per-phase dispatch, and what to do when a phase cannot produce what the next needs. | `c0734040` |
| <a id="le-99ac01afce"></a>`dev/adr/0001-living-conspectus-terms.md` | examined | The executable definitions of fully surveyed, current, stale, invalid, resolved, verified-fixed and complete — clause 1 is what §3's reconciliation enforces and clause 7 is what this lane added. | `c0734040` |
| <a id="le-c0491c92b8"></a>`dev/adr/0002-temporal-claim-model.md` | examined | Why claims carry both Git validity intervals and explicit supersession edges. | `c0734040` |
| <a id="le-226f2a230b"></a>`dev/adr/0003-predict-before-apply-change-impact.md` | examined | The prediction/apply split and why a rename at similarity 100 is observable but not invalidating. | `c0734040` |
| <a id="le-5b00d1d9d8"></a>`dev/adr/0004-obligation-custody-and-reconciliation.md` | examined | Revalidation as a custody protocol: exact fan-in rather than a count of successful calls. | `c0734040` |
| <a id="le-911d983db6"></a>`dev/adr/0005-resolution-proof-and-projection-readback.md` | examined | Why repair intent, verified resolution and projection proof are three different things, and the three read-back axes. | `c0734040` |
| <a id="le-54edbab72e"></a>`dev/adr/0006-unattended-refresh-authority-and-recovery.md` | examined | The immutable execution envelope, deterministic child identities, and crash adoption. | `c0734040` |
| <a id="le-488d9c0ea1"></a>`dev/adr/0007-impact-aware-review-brief.md` | examined | Impact-first context selection, the retrieval trace, and why required-context loss blocks rather than truncates. | `c0734040` |
| <a id="le-d2039b4370"></a>`dev/adr/0008-independent-review-custody-and-blinding.md` | examined | Generator/refuter/verifier custody with no deliberation round, and content-tested blinding. | `c0734040` |
| <a id="le-84bcc53f49"></a>`dev/adr/0009-integral-head-composition-fan-in.md` | examined | Why unit verification does not compose, and what an integral-HEAD verification object is. | `c0734040` |
| <a id="le-506f96e7c2"></a>`dev/adr/0010-derived-review-surface-and-semantic-readback.md` | examined | The operational definitions of regression, latent defect, stale knowledge and unverified suspicion. | `c0734040` |
| <a id="le-c633678fc3"></a>`dev/adr/0011-codebase-brief-contract.md` | examined | The versioned brief contract, deterministic selection, and the omission ledger. | `c0734040` |
| <a id="le-6ec9a90e4e"></a>`dev/adr/0012-independent-dialectical-design.md` | examined | Three lenses, no deliberation, and underdetermination as a legitimate terminal state. | `c0734040` |
| <a id="le-a143f2f4cd"></a>`dev/adr/0013-decision-acceptance-and-premise-custody.md` | examined | Drafting is open, acceptance is not: the append-only authority event SQLite requires. | `c0734040` |
| <a id="le-b13a5ced09"></a>`dev/adr/0014-decision-bounded-research-custody.md` | examined | External research admitted only through a decision-bound queue, and why an external claim never enters the code claims table. | `c0734040` |
| <a id="le-a463017ec5"></a>`dev/adr/0015-identity-first-crosswalk-and-qualified-methods.md` | examined | Identity before enrichment, and the four-boundary method qualification. | `c0734040` |
| <a id="le-6a6719d9f9"></a>`dev/adr/0016-typed-revisable-learning-ledger.md` | examined | Five epistemically disjoint learning channels and the policy read-back at the consumer boundary. | `c0734040` |
| <a id="le-c2a2be8108"></a>`dev/adr/0017-stratified-operating-envelope.md` | examined | Why there is no pooled efficacy field, and the instrument-first treatment of a negative observation. | `c0734040` |
| <a id="le-071256362b"></a>`dev/adr/0018-chorusmith-adapter-parity-boundary.md` | examined | The adapter invokes handlers, never domain tables — the load-bearing extraction rule. | `c0734040` |
| <a id="le-bdd3f22734"></a>`dev/adr/0019-qualified-natural-history-corpus.md` | examined | Public evaluation mechanics separated from private historical truth, and the canary scan. | `c0734040` |
| <a id="le-bed3b9d920"></a>`dev/adr/0020-practice-catalog-v2.10-reconciliation.md` | examined | The claim adjudication table: what was withdrawn, what survives, and the two verification obligations still unchecked. | `c0734040` |
| <a id="le-8921a1e5e6"></a>`dev/adr/0021-friction-free-codex-activation.md` | examined | The activation contract and its explicit acceptance boundary, which [B-08](b08-activation-evidence-and-release-readiness.md)'s evidence corpus is about. | `c0734040` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AT-1](../concerns.md#at-1)** | out-of-scope | doc-asserted |  | This subsystem writes no rows: atomicity of the writes it instructs is [B-03](b03-knowledge-tools-and-workflow-api.md)'s property, and the references correctly describe a disposition and its attachments as one write rather than two steps. Out-of-scope rather than ruled out so the concern stays owned where the transaction is. |
| **[AT-2](../concerns.md#at-2)** | confirmed-acceptable | doc-asserted | 🔗 | The method instructs a checkpoint at every phase boundary and states the reason — the storage directory is a git repo and phase commits are how a mid-session crash is recovered — which is the behaviour [B-02](b02-mcp-core-persistence-and-lifecycle.md)'s checkpoint makes recoverable. Acceptable rather than ruled out because a coordinator that skips commit_phase_gate loses nothing the server will complain about: end_session's auto-commit is the backstop and it only fires if the session is closed. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | doc-asserted | 🔗 | The derived surface here is the method's own description of the server: every quoted refusal is a copy of a string that lives elsewhere. Coherence is maintained by the checker rather than by discipline, which is the right shape. Acceptable rather than ruled out because the copies that are not refusal strings have no such check — concern-territories.md's catalog against contracts/concern-checklist.json, and reporting-style.md against the renderer — and B01-1's history is exactly this failure mode: the references described a survey route that had drifted away from a whole tool surface, and nothing noticed for as long as nobody counted claims. |
| **[CR-1](../concerns.md#cr-1)** | out-of-scope | doc-asserted |  | Prose does not race. The nearest thing the method owns is the advisory acquire_lock it instructs before each phase handoff, which is the coordinator's own serialization of sub-agent writes to one artifact; the concurrency that matters is [B-02](b02-mcp-core-persistence-and-lifecycle.md)'s and [B-03](b03-knowledge-tools-and-workflow-api.md)'s. Out-of-scope rather than ruled out. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | doc-asserted |  | The method's exceptional path is specified rather than left to improvisation: a status-advance ToolError is explicitly not a human gate but a missing deliverable, the route is diagnose, re-run the phase once with the deficiency made explicit, then mark the subsystem deferred with the exact gap and continue to the next independent unit. Deferred subsystems carry their reason and are stated not to degrade the checklist, which is what keeps a blocked unit from becoming a silent one. |
| **[IF-1](../concerns.md#if-1)** | out-of-scope | doc-asserted |  | The method instructs materialize_docs and states that the materializer is diff-aware; whether the incremental and full paths agree is [B-04](b04-diff-aware-materializer.md)'s property. Out-of-scope so the probe stays where it can be run. |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | doc-asserted | 🔗 | The two method-level resources are the session and the advisory artifact lock. Both have an instructed release — end_session at Phase 5 step 8, release_lock after the phase completes — and the lock additionally expires on its own TTL, so a crashed coordinator does not hold it forever. A session has no such expiry: an abandoned run leaves an open session row indefinitely, which costs nothing durable but makes list_sessions(state='active') a less useful signal than it looks. Acceptable, and noted rather than raised. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | doc-asserted | 🔗 | The seam this subsystem owns is the one between an instruction and the refusal that answers it, and it is held by a checker: the references quote refusal strings verbatim and check-refusal-parity.mjs derives the candidate set from the server's own thrown messages. Acceptable rather than ruled out for a second seam nothing compares: reporting-style.md specifies the typed HTML projections and the colour-per-enum rule in detail, and the materializer implements them with no check between the two. Linchpin-dependent because the evidence for the first half is doc-asserted — the reference text — and the comparison itself lives in [B-05](b05-packaging-installer-validation-and-product-docs.md). |
| **[SI-1](../concerns.md#si-1)** | confirmed-acceptable | doc-asserted | 🔗 | setup.md states the identity contract the lane depends on in the terms the server enforces: worktree-local storage by default, two worktrees of one repository sharing a logical identity but holding different workspace-instance IDs and storage paths, and AMANUENSIS_STORAGE_ROOT named as the deliberate change of custody to shared-by-repository-identity with an explicit warning against it for concurrent worktrees. The method also instructs the coordinator to stop on a workspace mismatch rather than proceed. Acceptable rather than ruled out because this is documentation of a property enforced elsewhere; the enforcement is [B-02](b02-mcp-core-persistence-and-lifecycle.md)'s. |
| **[SI-2](../concerns.md#si-2)** | confirmed-acceptable | doc-asserted |  | Every reference that instructs a write instructs a revision with it, and says what the revision must satisfy: the survey-session SHA is captured once from git rev-parse HEAD and used for every ref_sha in the session; first_seen must resolve and its path must exist in that revision's tree; a claim's valid_from must be an ancestor of its assertion. ADR-0001 then defines current, stale and invalid against a named revision R rather than against wall-clock time. The method never instructs an unanchored write. |
| **[TB-1](../concerns.md#tb-1)** | out-of-scope | doc-asserted |  | Prose has no wall-clock behaviour. The temporal bounds that matter to this method are the server's, disposed under [B-02](b02-mcp-core-persistence-and-lifecycle.md) [TB-1](../concerns.md#tb-1) and re-found as B02-R1 and B02-R2. Recorded out-of-scope so the concern stays where the subprocess is. |
| **[TR-1](../concerns.md#tr-1)** | confirmed-acceptable | doc-asserted | 🔗 | The authority boundary this method defends is between what an agent asserts and what the record can support, and it is defended everywhere the substrate can reach: claims are typed by epistemic kind, a status names the claims it authorizes, and every advance is refused rather than requested. The residual is exactly one gap and it is stated rather than hidden: clear_staleness asserts a re-examination the server cannot witness, so a bulk clear is indistinguishable from a careful one. Linchpin-dependent on prose, because prose is the only enforcement that gap has. |

### Survey artifact

#### **B-01** — Survey methodology and agent contracts

Structural account, read at `c073404`. Scope: `.claude/skills/amanuensis/**` (16 files)
and `dev/adr/**` (21 ADRs). The method is the deliverable here, not documentation about
one.

##### Observed

**Two halves of one contract.** `SKILL.md` routes; the phase references carry the work;
the ADRs carry the decisions the server's refusals implement. The references quote the
server's refusal strings verbatim — `onboarding.md` Phase 5 carries the whole status
ladder in one place — which is what makes `check-refusal-parity.mjs` able to compare them
mechanically rather than by reading.

**The ladder.** `unmapped → scoping → structural → concerns → adversarial → mapped`, with
one prerequisite per rung: a populated ledger, a `<sid>/` claim and a discharged-or-declined
vocabulary, a registered `subsystem-survey` artifact, at least one disposition, every
current claim challenged, and a reconciled store. Two more bind outside it: an active
session on every durable write, and every carried finding decided before the store is
fully surveyed.

**Discharge or decline, never a floor.** No obligation in the method is a count. One
anchored term or a reasoned declination; every concern terminal with no minimum; a
`survived` outcome on every claim is a legitimate result and inventing an overturn to look
rigorous is named as corrupting the record.

**The one unenforceable rule.** `refresh.md`'s cardinal rule — `clear_staleness` asserts a
re-examination — is the single obligation the substrate cannot check, and it is written as
a rule with its failure named rather than left implicit.

**The ADRs are a claim-adjudication history.** ADR-0020's table is the shape: prior claims
listed with `withdrawn`, `survives as …`, or `rejected`, and two verification obligations
left unchecked rather than quietly dropped. ADR-0001 clause 7 — every carried finding
terminal — was added by this lane.

##### No state containers

This subsystem holds none: it is prose consumed by an agent at read time. Claimed as an
explicit negative rather than omitted.

##### Seam contracts from this side

- **the server's refusal strings** — quoted here, thrown in `mcp-server/src/invariants.ts`
  ([B-02](b02-mcp-core-persistence-and-lifecycle.md)); compared by `scripts/check-refusal-parity.mjs` ([B-05](b05-packaging-installer-validation-and-product-docs.md)) against
  `contracts/refusal-parity.json`.
- **`concern-territories.md` → `contracts/concern-checklist.json`** — the catalog is
  calibrated once per repository into the checklist a survey actually works from.
- **`reporting-style.md` → `materializer/`** ([B-04](b04-diff-aware-materializer.md)) — the typed HTML projections and the
  colour-per-enum rule are specified here and implemented there.

##### Open

`reporting-style.md` specifies typed projections in considerable detail; nothing compares
its specification against the renderer that implements it, so the two can drift silently.
Recorded under [SC-1](../concerns.md#sc-1).
