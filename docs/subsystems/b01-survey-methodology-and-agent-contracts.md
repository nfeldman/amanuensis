# **B-01** — Survey methodology and agent contracts

**Status**: 🟢 mapped  
**Layer**: methodology

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

.claude/skills/amanuensis/SKILL.md and .claude/skills/amanuensis/references/ (onboarding, subsystem-survey, phase-1 through phase-5, notes, memory-audit, refresh, open-questions, concern-territories, artifact-templates, reporting-style, setup)

## Start here

SKILL.md — the routing table and the authorized-claims ladder; then references/subsystem-survey.md for the five-phase loop the ladder gates.

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-01/key-type/claude-skills-amanuensis-references-phase-2-structural-md-symbol-slug` | `.claude/skills/amanuensis/references/phase-2-structural.md:symbol-slug` | The stable claim_key rule is defined here and nowhere else that binds a writer. It specifies the slug as the whole path:symbol pair lowercased with non-alphanumerics collapsed, states why the path must be included — a symbol-only slug makes two files defining Config collide, and the unique index refuses the second reading rather than recording it, leaving the inventory silently short — and cites the incident that produced the rule. The server's add_claim validates the category prefix and stops, so this prose is the entire enforcement a writer sees at the moment of writing. | Observation | `7c1c1a9f5689` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-01/flow/authorized-claims-ladder/01` | `.claude/skills/amanuensis/SKILL.md:authorized-claims` | The methodology's central epistemic constraint is a ladder tying authorized claims to recorded depth: unmapped authorizes none, scoping file scope only, structural types and flows but no correctness claims, concerns evidenced concern decisions, adversarial work in progress, mapped a workflow completion mark that the skill itself says is not proof every finding survived challenge — the underlying records govern. Enforcement is split: the server refuses status transitions whose deliverable is missing, and the rest is stated as an instruction to the model, which the skill frames honestly by requiring any claim exceeding its source's authorized level to be flagged as speculative. | Observation | `7c1c1a9f5689` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-01/concurrency` | `B-01` | This subsystem is prose and executes nothing, so it has no concurrency of its own; the category is recorded rather than omitted. What it does have is a temporal contract that behaves like one: the skill instructs the coordinator to commit every checkpoint, on the stated grounds that the storage directory is a Git repository and commit_phase_gate is how the methodology recovers from a mid-session crash. Two agents surveying one repository at once is addressed nowhere in the prose, and the advisory lock the server provides is mentioned in no phase reference. | Inference | `7c1c1a9f5689` |

### Seam contracts

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-01/seam/S-08` | `S-08` | From this side, [S-08](../seams.md#s-08) carries the fuller contract and the weaker enforcement, and the gap runs in both directions. The prose states obligations the server does not check — most consequentially the stable claim_key shape, which phase-2-structural.md defines with its rationale and which add_claim does not validate. And it offers capabilities the server refuses: phase-4-adversarial.md lists `overturned` as an outcome available when a claim is wrong at the current revision, which is exactly the case invalidate_claim rejects, so the pass is instructed to do something it cannot do. Both were met during this survey, at the moment of writing rather than in review. | Observation | `7c1c1a9f5689` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[S-08](../seams.md#s-08)** | The phase contract — stated as prose in the skill, enforced as prerequisites in the server | **[B-03](b03-knowledge-tools-and-workflow-api.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **[B-06](b06-packaging-installer-and-host-activation.md)** | → | **B-01** | data-flow | structural | The installer copies the skill into each host's skill directory, so the methodology a host executes is a packaged copy of this repository's prose and can be a different version from the checkout that produced it. Read at mcp-server/src/cli.ts:findBundledSkill@7c1c1a9 which resolves the bundled skill source the install and upgrade paths walk. |
| **B-01** | → | **[B-03](b03-knowledge-tools-and-workflow-api.md)** | dependency | structural | The skill states the phase contract as prose and this subsystem enforces the subset of it that is mechanical, so a phase obligation the prose states and the code does not check is enforced only by a model choosing to comply. Read at mcp-server/src/invariants.ts:enforcePhasePrerequisites@7c1c1a9 which is the enforced subset in full: a ledger, a claim, an artifact, a disposition, and a challenge outcome. |

## Known defects here

1 defect here is open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- The phase references have drifted from the tools they describe, with nothing checking them. `phase-4-adversarial.md` instructs the coordinator to do one thing the server refuses and one thing the server has since replaced. — [B01-R1](../findings.md#b01-r1) · 🟡 MEDIUM · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 12 of 16 ledger rows |
| Files in scope, not yet read | 4 of 16 |
| Files excluded from the survey obligation | 0 of 16 |
| Ledger rows the repository has changed under | 0 of 16 |
| Active concerns with a disposition recorded here | 21 of 30 — 6 confirmed-bug, 7 confirmed-acceptable, 8 out-of-scope |
| Findings by resolution state | 1 open |
| Seams assessable from both sides | 1 of 1 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-592927548e"></a>`.claude/skills/amanuensis/references/artifact-templates.md` | candidate | Prose artifact formats. Read for existence and role. | `7c1c1a9f` |
| <a id="le-87251d5427"></a>`.claude/skills/amanuensis/references/memory-audit.md` | candidate | The hygiene sweep route. Not exercised this pass. | `7c1c1a9f` |
| <a id="le-10fb8244f3"></a>`.claude/skills/amanuensis/references/reporting-style.md` | candidate | The IA/UI boundary and register rules. Read for existence and role, not audited against the projection. | `7c1c1a9f` |
| <a id="le-056443afa8"></a>`.claude/skills/amanuensis/references/setup.md` | candidate | MCP wiring shapes for each client. Read in the skill-reference inventory's context rather than surveyed. | `7c1c1a9f` |
| <a id="le-017d152868"></a>`.claude/skills/amanuensis/SKILL.md` | examined | The coordinator's contract: the routing table, the autonomous-execution rules, the authorized-claims ladder, and the hard constraints. | `7c1c1a9f` |
| <a id="le-18b6f1fc80"></a>`.claude/skills/amanuensis/references/concern-territories.md` | examined | The eleven-territory catalog used to calibrate this survey's twenty concerns. | `7c1c1a9f` |
| <a id="le-6a8610a679"></a>`.claude/skills/amanuensis/references/notes.md` | examined | The consumer route's answer shape — standing first, then the account, then what is not known. | `7c1c1a9f` |
| <a id="le-fc1d1bfe9e"></a>`.claude/skills/amanuensis/references/onboarding.md` | examined | The eight-phase first pass. Executed in full during this survey. | `7c1c1a9f` |
| <a id="le-e6e16a1164"></a>`.claude/skills/amanuensis/references/open-questions.md` | examined | The categories and the requirement that what_assumed accompany every autonomous judgment call. | `7c1c1a9f` |
| <a id="le-5b5cb8ab3d"></a>`.claude/skills/amanuensis/references/phase-1-scope.md` | examined | Phase 1's deliverable: the file ledger the status gate then requires. | `7c1c1a9f` |
| <a id="le-f89e91947a"></a>`.claude/skills/amanuensis/references/phase-2-structural.md` | examined | The new Phase 2 contract: structural claims with code-grade evidence, and the stable claim_key shape the server does not enforce. | `7c1c1a9f` |
| <a id="le-2905b9aa75"></a>`.claude/skills/amanuensis/references/phase-3-concerns.md` | examined | Phase 3's requirement that every concern reach a terminal disposition. | `7c1c1a9f` |
| <a id="le-28758b2404"></a>`.claude/skills/amanuensis/references/phase-4-adversarial.md` | examined | The adversarial pass, whose negative outcome is unreachable at a single revision. | `7c1c1a9f` |
| <a id="le-87d1cc2ac1"></a>`.claude/skills/amanuensis/references/phase-5-packaging.md` | examined | Phase 5: master-plan update, materialization, session close. | `7c1c1a9f` |
| <a id="le-b9d0f2a875"></a>`.claude/skills/amanuensis/references/refresh.md` | examined | The route that discharges drift rather than listing it. | `7c1c1a9f` |
| <a id="le-a19a8b2374"></a>`.claude/skills/amanuensis/references/subsystem-survey.md` | examined | The per-subsystem five-phase loop. | `7c1c1a9f` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AL-1](../concerns.md#al-1)** | out-of-scope | contract-stated |  | No runtime object graph exists here to alias. |
| **[AT-1](../concerns.md#at-1)** | out-of-scope | contract-stated |  | No database mutation is performed by prose; transaction boundaries are the handlers'. |
| **[AT-2](../concerns.md#at-2)** | confirmed-acceptable | contract-stated | 🔗 | The half of the checkpoint divergence the server cannot close — a mutation with no commit — is this subsystem's to state, and it states it as a hard constraint: commit every checkpoint, the storage directory is a git repo, commit_phase_gate is how the methodology recovers from mid-session crashes, do not skip. That is the correct placement for an obligation only an agent can discharge. Marked linchpin-dependent because compliance is what makes it work, and compliance is what prose cannot guarantee. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-bug | contract-stated |  | The prose is a derived artifact of the tools it describes and has gone stale against them with no check to notice. phase-4-adversarial.md still instructs recording a survived outcome as a field note because "no claim row changes, so the outcome has to be recorded explicitly" — the exact problem record_claim_challenge and the claim_challenge_outcomes table now solve, and which the mapped prerequisite now requires. One check exists in this direction and is narrow: check-evidence-vocabulary.mjs holds SKILL.md's evidence ladder to the vocabulary source. Nothing holds the phase references to the tool surface they describe. |
| **[CC-2](../concerns.md#cc-2)** | out-of-scope | contract-stated |  | No SQL view or counter is defined here; the prose-versus-tool drift this subsystem does have is dispositioned under [CC-1](../concerns.md#cc-1). |
| **[CR-1](../concerns.md#cr-1)** | confirmed-bug | contract-stated | 🔗 | The server provides advisory cross-process write locks and no phase reference mentions them. The stop conditions cover a workspace mismatch — the wrong repository — but not two agents in the right one, which is the configuration the product encourages by serving every repository from one installation and supporting linked worktrees that share a storage root. The methodology is where a convention for taking the advisory lock would have to live, since the lock is advisory precisely because the server does not impose it. Marked linchpin-dependent: read from absence across sixteen files. |
| **[CR-2](../concerns.md#cr-2)** | out-of-scope | contract-stated |  | Store creation is entirely the server's; the methodology only probes whether a store exists via get_project_info and branches on the answer. |
| **[EP-1](../concerns.md#ep-1)** | out-of-scope | contract-stated |  | Prose performs no multi-file write. It does state that the agent must never modify source and may write only through the tools or to the storage directory, which bounds the blast radius rather than providing a rollback. |
| **[EP-2](../concerns.md#ep-2)** | confirmed-acceptable | contract-stated | 🔗 | The failure paths are specified and each names what must still happen: an unauthorized destructive operation requires a snapshot before stopping; a workspace mismatch stops rather than risking another project's conspectus; a server unreachable mid-run surfaces the last durable checkpoint. A status-advance error is explicitly not a human gate but a diagnosis-and-retry, with deferral and an exact gap as the terminal option. Marked linchpin-dependent because these are instructions rather than mechanisms. |
| **[ID-1](../concerns.md#id-1)** | confirmed-bug | contract-stated |  | The methodology defines two caller-supplied identity conventions and neither is enforced where it is used. The claim_key slug is specified here in full, with the collision it prevents, and add_claim does not check it — this survey got it wrong three times, twice with a bare symbol name and once with an untrimmed leading hyphen. The finding_id convention, which SKILL.md and add_finding's own description give as "conventionally B01-1", carries no store generation, which is what lets a rebuilt store re-mint an id an external reference names. |
| **[ID-2](../concerns.md#id-2)** | confirmed-acceptable | contract-stated |  | The prose is emphatic that every claim carries a revision — "Cite everything. Every claim in an artifact carries either a file:symbol@sha reference or a row id" — and onboarding fixes one SHA that every evidence row in the pass uses. The server independently resolves that revision at ingress, so this is one of the few obligations enforced on both sides of [S-08](../seams.md#s-08). |
| **[IF-1](../concerns.md#if-1)** | out-of-scope | contract-stated |  | The publish paths are the materializer's. The prose's own full-versus-partial pair is onboarding against refresh, dispositioned under [IF-2](../concerns.md#if-2). |
| **[IF-2](../concerns.md#if-2)** | confirmed-acceptable | contract-stated | 🔗 | The methodology draws the distinction this concern depends on and routes on it: the audit route lists drift and the refresh route discharges it by reconciling the ledger and then re-examining and clearing each stale row, with SKILL.md's routing table stating the difference in one line. Marked linchpin-dependent because the refresh route was not exercised — the store was rebuilt from nothing, so there was no backlog. |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | contract-stated | 🔗 | The one resource the methodology owns the lifetime of is the survey session, and Phase 5 instructs closing it with an outcome. The server treats an open session as still valid rather than as a leak, so omission costs a less legible activity log rather than a stuck resource. Marked linchpin-dependent: it is an instruction, and a session abandoned by a crashed run is cleaned up by nothing. |
| **[SC-8](../concerns.md#sc-8)** | confirmed-bug | contract-stated |  | Assessed from **B-01**'s side. Neither side knows which obligations fall in the gap, and that is the defect rather than the gap's existence. Three concrete instances found by executing the methodology: the stable claim_key slug is stated here and unchecked there; `overturned` is offered here and refused there; recording a survived outcome as a field note is instructed here and superseded there. Nothing enumerates the boundary from either direction, so a reader of the prose cannot tell which sentences are load-bearing and which are advisory. The repository has the pattern for closing this and applies it to one passage out of sixteen files. |
| **[SE-1](../concerns.md#se-1)** | confirmed-bug | contract-stated |  | Two gaps across [S-08](../seams.md#s-08), both met while executing the methodology rather than while reading it. The prose states an obligation the server does not check — phase-2-structural.md defines the stable claim_key slug with its rationale and its originating incident, and add_claim validates only the category prefix. And the prose offers a capability the server refuses — phase-4-adversarial.md lists `overturned` as an outcome for a claim wrong "at the current revision", precisely the case invalidate_claim rejects. A third, smaller instance: the same reference still instructs recording a survived outcome as a field note, which predates the claim_challenge_outcomes table. |
| **[TB-1](../concerns.md#tb-1)** | out-of-scope | contract-stated |  | Prose invokes no subprocess; bounding the ones the tools invoke is [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s and [B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)'s. |
| **[TR-1](../concerns.md#tr-1)** | out-of-scope | contract-stated |  | Prose validates nothing and reaches no filesystem or SQL surface. The constraint it states — never modify source, write only through the tools or to the storage directory — is a scope rule for the agent, enforced by the server's containment checks. |
| **[TR-2](../concerns.md#tr-2)** | confirmed-acceptable | contract-stated | 🔗 | The consumer route's answer shape is specified so stored content arrives with its authority bounded before it is read: standing first in one line with the authority ceiling and the checked revision, then the account, then what is not known — never omitted, never softened. The skill also forbids classifying anything unread and forbids treating name, location and metadata as evidence. Marked linchpin-dependent: a shape an agent must follow, not one the tools impose. |
| **[VR-1](../concerns.md#vr-1)** | confirmed-acceptable | contract-stated |  | SKILL.md restates the evidence-kind ladder by hand, a second statement of the vocabulary source — and it is the one hand-written party check-evidence-vocabulary.mjs holds to that source explicitly, on the stated reasoning that agreeing generated copies can share one wrong definition. The skill declares no version of its own; the packaged copy's version is [B-06](b06-packaging-installer-and-host-activation.md)'s concern. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-bug | contract-stated |  | The methodology's own adversarial phase is a check that cannot fail when the survey is conducted at one revision. Phase 4 is instructed to record one of three outcomes per claim, the mapped prerequisite requires an outcome on every claim, and two of the three are unreachable — so the prerequisite establishes that a pass ran and can never establish that anything was overturned. The denominator is populated and the verdict set has collapsed to one, in the phase the methodology calls its most important. Filed against [B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md) where the constraint lives; recorded here because this is where the pass is specified. |

### Survey artifact

#### **B-01** · Survey methodology and agent contracts

**Revision read:** `7c1c1a9` · **Layer:** methodology · **Priority:** 4

##### Scope

`.claude/skills/amanuensis/` — `SKILL.md` and fifteen references. Twelve `examined`, four
`candidate`. This pass has an unusual evidence source: the methodology was **executed** during
this survey rather than only read, so several readings below are runtime-observed as well as
contract-stated.

##### Observed structure

**The authorized-claims ladder is the central constraint,** and it is stated honestly. Each
status authorizes a bounded set of claims; the `mapped` row explicitly denies that status is
proof — "Status alone is not proof that every finding survived challenge; the underlying
records govern." Enforcement is split: the server refuses transitions whose deliverable is
missing, and the rest is an instruction to the model, which SKILL.md frames as such rather
than as a guarantee.

**The stable `claim_key` rule lives only here.** `phase-2-structural.md:111-121` defines the
slug as the whole `path:symbol` pair, gives the reason (two files defining `Config` collide
under a symbol-only slug, and the unique index refuses the second reading rather than
recording it), and cites the incident. `add_claim` validates the category prefix and stops.

##### The two gaps, both met during execution

| The prose says | The tools do |
|---|---|
| `claim_key` is the slug of the whole `path:symbol` pair | `add_claim` accepts any slug; only a much later gate checks |
| Phase 4 may record `overturned` when a claim is wrong **at the current revision** | `invalidate_claim` requires a strict descendant of `valid_from_sha`, so at the survey revision only `survived` is expressible |

The first cost two `reset_subsystem` calls in this session. The second means every `survived`
outcome recorded in this conspectus is `survived` **by construction**, and should be read that
way. `phase-4-adversarial.md:146-151` also still instructs that a survived outcome be recorded
as a field note, which predates the `claim_challenge_outcomes` table that now records it.

##### Concurrency

Prose executes nothing. The temporal contract that behaves like one is "commit every
checkpoint", on the stated grounds that the storage directory is a Git repository and
`commit_phase_gate` is how the methodology recovers from a mid-session crash. Two agents
surveying one repository at once is addressed nowhere in the prose, and the advisory lock the
server provides is mentioned in no phase reference.

##### Seam contract offered ([S-08](../seams.md#s-08))

This side carries the fuller contract and the weaker enforcement, and the gap runs both ways:
obligations the server does not check, and capabilities the server refuses.

##### Inference, separated from observation

The concurrency reading is an inference from absence — no phase reference mentions
coordination — which is weaker than reading one that does. The four `candidate` references
carry no structural claim.

##### Open

Whether `reporting-style.md`'s register and IA/UI rules are actually honoured by the published
projection was not checked; that is a comparison between this subsystem and [B-05](b05-materializer-human-projection-read-back-html.md) that neither
pass performed.
