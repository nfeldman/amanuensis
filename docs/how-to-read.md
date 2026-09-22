# How to read this conspectus


## What to look at first

Every page this conspectus publishes, in the order the record presents them. The lens a page sits under says what kind of claim it carries.

### Overview

| Page | What it carries |
|---|---|
| [Overview](index.md) |  |

### Codebase

| Page | What it carries |
|---|---|
| [Architecture](architecture.md) | Runtime shape, recorded edges, and boundaries, read as one connected system. |
| [Subsystems](master-plan.md) | Every region, grouped by layer, with the scope recorded for it. |
| [Files](files.md) | One row per ledger file with owners, standing, and open defects. |
| [Not yet surveyed](not-yet-surveyed.md) | The recorded edge of the map, each gap counted over the unit it occupies. |
| [System boundaries](seams.md) | Shared objects and ordering assumptions where independently understandable subsystems meet. |
| [Codebase glossary](vocabulary.md) | The project's own names, with the meanings Amanuensis observed in context. |
| Subsystems · [Survey methodology and agent contracts](subsystems/b01-survey-methodology-and-agent-contracts.md) | Scope, structure, boundaries, defects, and the survey record for Survey methodology and agent contracts. |
| Subsystems · [MCP core, persistence, and lifecycle](subsystems/b02-mcp-core-persistence-and-lifecycle.md) | Scope, structure, boundaries, defects, and the survey record for MCP core, persistence, and lifecycle. |
| Subsystems · [Knowledge tools and workflow API](subsystems/b03-knowledge-tools-and-workflow-api.md) | Scope, structure, boundaries, defects, and the survey record for Knowledge tools and workflow API. |
| Subsystems · [Diff-aware materializer](subsystems/b04-diff-aware-materializer.md) | Scope, structure, boundaries, defects, and the survey record for Diff-aware materializer. |
| Subsystems · [Packaging, installer, validation, and product docs](subsystems/b05-packaging-installer-validation-and-product-docs.md) | Scope, structure, boundaries, defects, and the survey record for Packaging, installer, validation, and product docs. |
| Subsystems · [Report interface design and validation studies](subsystems/b06-report-interface-design-and-validation-studies.md) | Scope, structure, boundaries, defects, and the survey record for Report interface design and validation studies. |
| Subsystems · [Embedded research surveys and platform trials](subsystems/b07-embedded-research-surveys-and-platform-trials.md) | Scope, structure, boundaries, defects, and the survey record for Embedded research surveys and platform trials. |
| Subsystems · [Activation evidence and release readiness](subsystems/b08-activation-evidence-and-release-readiness.md) | Scope, structure, boundaries, defects, and the survey record for Activation evidence and release readiness. |
| Subsystems · [Conspectus design lanes, their drivers and receipts](subsystems/b09-conspectus-design-lanes-their-drivers-and-receipts.md) | Scope, structure, boundaries, defects, and the survey record for Conspectus design lanes, their drivers and receipts. |

### Unresolved

| Page | What it carries |
|---|---|
| [Open findings](findings.md) | Defects open or awaiting verification at the checked revision. |
| [Disagreements](disagreements.md) | Where credible records disagree or the evidence does not discriminate between them. |
| [Decisions needed](open-questions.md) | Questions the survey could not settle, with the assumption used to keep moving. |
| [Leads](field-notes.md) | Open observations that are not yet findings. |
| [Stale knowledge](stale.md) | Examined files the repository has changed under, and scoped files that changed before anyone read them. |
| [Hot spots](hot-spots.md) | Where unresolved work and unread territory concentrate, as separate measures. |

### History

| Page | What it carries |
|---|---|
| [Resolved findings](resolved-findings.md) | Verified, ruled out, and accepted, each with the basis its resolution rests on. |
| [Resolution history](resolution-history.md) | The append-only account of how records reached their state. |
| [Resolved leads and questions](resolved-leads.md) | Questions that were answered or dismissed, and leads that were closed. |
| [Sessions and publications](sessions.md) | What ran, when, and what it produced. |
| [Conflicting evidence](contradictions.md) | Resolved disagreements and the evidence that settled them. |

### Method

| Page | What it carries |
|---|---|
| [Reader's guide](how-to-read.md) |  |
| [Review coverage](concerns.md) | Which failure modes were tested where, and the disposition each one reached. |
| [Review checklist](concern-checklist.md) | The concern set and its provenance. |
| [Competing explanations](diagnosticity.md) | Index of evidence matrices and their outcomes. |
| [Onboarding record](onboarding-report.md) | The repository boundary and initial decomposition that established this conspectus. |
| [Where to begin](entry-point.md) | A dated reading path recorded by an earlier session; it is survey history, not a current index. |

## The vocabulary this record uses

Every value below is generated from the vocabulary contract, version `1.0.0` — the same source the server validates writes against and the same source this site's labels come from. A value the server accepts and this page did not carry would be a drift, so the generator produces both from one definition.

### Finding resolution state

`finding_resolution_state` · resolution axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `open` | Open | No terminal resolution event has been recorded; the item is still open. | that the defect is still reproducible at the repository head |
| `accepted` | Accepted | The behavior is recorded as understood and acceptable; it is not an open defect. | that the judgement was revisited at the repository head |
| `ruled-out` | Ruled out | The candidate problem was overturned by evidence or adversarial review. | that no related defect exists at the same locus |
| `fixed-pending-verification` | Unverified fix | A repair is recorded, but independent fix evidence has not yet closed the finding. | that the defect is gone at the repository head |
| `verified-fixed` | Verified fixed | A later revision contains a repair backed by recorded verification evidence. | that the repair is still present at the repository head |

### Carried finding outcome

`carried_finding_outcome` · carried axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `successor-finding` | Re-found here | A finding filed in this store records the same defect, so the carried obligation is discharged into it and a reference to the archived id follows the finding into its successor. | that the successor is the same defect; the substrate can require that a finding was filed in this store and in this session, and cannot read the judgement that the two are one |
| `ruled-out` | Ruled out here | A reading taken in this store, in the session that overturned it, does not show the defect the archive recorded. | that no related defect exists at the same locus; overturning requires evidence collected by the overturning pass, not that the locus was exhausted |
| `repaired` | Repaired here | A commit that resolves in the bound workspace carries the repair, and at least one attached evidence row was read at a revision that is a descendant of, or equal to, that commit. | that the repair is still present at the repository head, or that it is complete; a claimed repair with no post-repair reading is fixed-pending-verification, never a discharge |
| `archived-terminal` | Closed in the archive | The archive had already closed this finding — verified-fixed, ruled-out or accepted — and the carry recorded that state rather than re-deciding it. Written by the carry alone. | anything about this store: nobody here checked a commit or read a repaired path, and the row carries the archive's judgement and not this survey's |

### Finding status

`finding_status` · resolution axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `confirmed-bug` | Confirmed defect | A defect supported by evidence and retained after adversarial review. | that the defect is unrepaired at the repository head; the resolution events are the authority |
| `confirmed-acceptable` | Accepted behavior | The observed behavior is real and judged to be intended or acceptable. | that the judgement was revisited at the repository head |
| `fixed` | Fixed | The defect was confirmed at an earlier revision and is recorded as addressed later. | that verification evidence closed the finding; only a verified-fixed event carries that |
| `ruled-out` | Ruled out | The candidate problem was overturned by evidence or adversarial review. | that no related defect exists at the same locus |

### Standing state

`standing_state` · standing axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `unledgered` | No record | No file_ledger row names this path in any subsystem. | "there are no findings here"; "this file is out of scope" |
| `excluded` | Excluded | A ledger row classifies the path as generated, vendored, irrelevant, or deferred with a recorded reason. | any claim about the file's content or behavior |
| `scoped-unread` | In scope, not yet read | A ledger row classifies the path candidate: it participates in a subsystem, and no one has read it. | any claim about content, behavior, or the absence of defects |
| `examined` | Examined | A ledger row classifies the path examined, it is not stale, and its examination revision resolves in the workspace. | claims about symbols no evidence cites; the absence of defects |
| `examined-stale` | Examined, since changed | The path was examined, and drift, absence, or an unreachable examination revision has withdrawn that reading's currency. | any current claim at the repository head |
| `absent` | No longer in the repository | A scope_gaps row of kind absent, or a ledger row whose stale_reason is absent. | anything at the repository head |
| `mixed` | Owners disagree | Two or more owning subsystems record different standing states for the same path. | anything the weakest owner state cannot justify |

### Stale reason

`stale_reason` · standing axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `git-drift` | Changed since examination | The file's content differs from the revision it was examined at. | that the recorded reading is wrong, only that it is no longer current |
| `absent` | Gone from the repository | The examined path is no longer tracked in the workspace. | anything about the current tree at that path |
| `unverifiable-ref` | Examination revision cannot be compared | The examination revision could not be diffed against the current head, so drift could not be computed. | that the file did or did not change |
| `unreachable-ref` | Examination revision is not an ancestor | The examination revision resolves in the workspace but is not an ancestor of the current head. | any current claim at the repository head |

### File classification

`file_classification` · standing axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `candidate` | In scope, not yet read | The path participates in a subsystem and has not been read. | any claim about content or behavior |
| `examined` | Examined | The path was read and its reading is anchored to an examination revision. | claims about symbols no evidence cites |
| `generated-ignore` | Generated | The path is build or projection output and is not read as a source of claims. | anything about the generator that produced it |
| `vendor-ignore` | Vendored | The path is third-party code carried in the tree and is not surveyed. | anything about the upstream project's behavior |
| `irrelevant` | Ruled irrelevant | The path was judged to carry nothing the survey needs. | that the judgement was re-examined at the repository head |
| `deferred-with-reason` | Deferred | The path is in scope but deliberately left unread, with the reason recorded. | any claim about content or behavior |

### Subsystem status

`subsystem_status` · survey axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `unmapped` | Unmapped | This subsystem has not yet been surveyed; no architectural claims are authorized. | any claim about this subsystem's behavior |
| `scoping` | Scoping | Only the subsystem boundary and file scope are established so far. | any behavioral claim; file scope is all that is established |
| `structural` | Structural | Types, state, flows, and concurrency are mapped; correctness claims are not yet authorized. | any correctness claim |
| `concerns` | Concerns | Structural mapping is complete and concern-by-concern review is in progress. | that a finding survived adversarial challenge |
| `adversarial` | Adversarial | Candidate conclusions are being challenged; treat them as provisional. | that the challenge pass has finished |
| `mapped` | Mapped | Survey complete through structural analysis, concern review, and adversarial challenge. | that the reading is current at the repository head |
| `deferred` | Deferred | This subsystem is intentionally outside the active survey plan. | anything about this subsystem's behavior |

### Vocabulary discharge

`vocabulary_discharge` · vocabulary axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `terms` | Terms recorded | The subsystem carries at least one vocabulary term scoped to it whose first_seen anchor still resolves: the token parses, its revision is reachable, and its path exists in that revision's tree. | that the recorded terms are the ones a reader most needs, or that the list is complete; one anchored term discharges the obligation and no count is required |
| `declined` | Declared none | A reader examined the subsystem and declared, at a recorded revision and in an attributed session, that it carries no domain vocabulary of its own. | that the judgement is true; the substrate can require that it be made, attributed and dated, and cannot check whether the subsystem really coins nothing |
| `not-recorded` | Not recorded | Neither a term nor a declination has been recorded for this subsystem, so nobody has answered the question either way. | that the subsystem has no domain vocabulary; nothing was asked and nothing was answered, which is not the same as 'none' |

### Evidence kind

`evidence_kind` · evidence axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `code-verified` | Code verified | The implementation was read and the stated behavior was verified directly. | behavior at any revision other than the one cited |
| `runtime-observed` | Runtime observed | The behavior was observed in a running system and the observation was recorded. | that the same behavior holds under other inputs or configurations |
| `contract-stated` | Contract stated | An explicit schema, type, or behavioral contract states this claim. | that the implementation honors the contract |
| `test-observed` | Test observed | A test run or recorded observation demonstrates this behavior. | behavior outside what the test exercises |
| `config-asserted` | Config asserted | Configuration states the behavior, but runtime behavior was not independently verified. | that this configuration is the one in effect |
| `doc-asserted` | Docs asserted | Project documentation states the claim; implementation agreement is not yet verified. | that the implementation matches the documentation |
| `comment-asserted` | Comment asserted | A code comment states the claim; the implementation was not verified against it. | that the comment is current with the code beside it |
| `name-inferred` | Name inferred | The claim is inferred from a symbol name and should be treated as weak evidence. | any correctness claim; a name is not an implementation |
| `pattern-matched` | Pattern matched | The claim matches a known pattern and is only a scoping signal. | any claim about what this locus actually does |

### Evidence quality

`evidence_quality` · evidence axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `code-verified` | Code verified | The implementation was read and the stated behavior was verified directly. | behavior at any revision other than the one cited |
| `runtime-observed` | Runtime observed | The behavior was observed in a running system and the observation was recorded. | that the same behavior holds under other inputs or configurations |
| `contract-stated` | Contract stated | An explicit schema, type, or behavioral contract states this claim. | that the implementation honors the contract |
| `test-observed` | Test observed | A test run or recorded observation demonstrates this behavior. | behavior outside what the test exercises |
| `config-asserted` | Config asserted | Configuration states the behavior, but runtime behavior was not independently verified. | that this configuration is the one in effect |
| `doc-asserted` | Docs asserted | Project documentation states the claim; implementation agreement is not yet verified. | that the implementation matches the documentation |
| `comment-asserted` | Comment asserted | A code comment states the claim; the implementation was not verified against it. | that the comment is current with the code beside it |
| `name-inferred` | Name inferred | The claim is inferred from a symbol name and should be treated as weak evidence. | any correctness claim; a name is not an implementation |
| `pattern-matched` | Pattern matched | The claim matches a known pattern and is only a scoping signal. | any claim about what this locus actually does |

### Disposition classification

`disposition_classification` · disposition axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `confirmed-bug` | Confirmed defect | A defect supported by evidence and retained after adversarial review. | that the defect is unrepaired at the repository head |
| `confirmed-acceptable` | Accepted behavior | The observed behavior is real and judged to be intended or acceptable. | that the judgement was revisited at the repository head |
| `ruled-out` | Ruled out | The candidate problem was overturned by evidence or adversarial review. | that no related defect exists at the same locus |
| `out-of-scope` | Out of scope | The concern does not apply within this subsystem's declared boundary. | that the concern does not apply elsewhere in the project |
| `unresolved-competition` | Competing explanations | Multiple explanations remain viable; the evidence does not discriminate. | that any one of the competing explanations is the right one |

### Severity

`severity` · severity axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `CRITICAL` | Critical | Potential data loss, security failure, privilege escalation, or production outage path. | how likely the path is to be reached; severity is impact, not confidence |
| `HIGH` | High | Incorrect behavior on a common path, corrupt state, or a seriously wedged workflow. | how confident the finding is; severity is impact, not confidence |
| `MEDIUM` | Medium | Incorrect edge-case behavior or a correctness issue with a known workaround. | that the edge case is rare in practice |
| `LOW` | Low | Maintainability, clarity, or defensive-coding risk most likely to affect a future change. | that the risk will never be reached |

### Field note category

`field_note_category` · lead axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `pattern` | Pattern | A recurrence noticed in more than one place. | that the recurrence is intentional |
| `anomaly` | Anomaly | A deviation from the surrounding conventions or expectations. | that the deviation is a defect |
| `connection` | Connection | A relationship noticed across subsystem boundaries. | that the relationship is load-bearing |
| `tension` | Tension | Local correctness that sits awkwardly against global coherence. | that either side is wrong |
| `candidate-concern` | Candidate concern | A pattern that might warrant a concern code of its own. | that the concern has been reviewed anywhere |

### Open question category

`open_question_category` · question axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `domain-knowledge` | Domain knowledge | A business rule or domain fact the record cannot supply. | the assumption recorded in its place |
| `scope-judgment` | Scope judgment | A scope fence that needs a human to confirm. | that the assumed boundary is the right one |
| `priority-ranking` | Priority ranking | A survey order the agent guessed and a reviewer can override. | that the ranking reflects project priorities |
| `contradiction` | Contradiction | Two credible sources disagree and the record does not settle it. | either reading |
| `tooling-limit` | Tooling limit | An operation the agent could not perform. | anything about what that operation would have shown |
| `ambiguous-evidence` | Ambiguous evidence | The evidence permits more than one interpretation. | any single interpretation |
| `other` | Other | A question that fits none of the recorded categories. | anything beyond the question as asked |

### Open question resolution

`open_question_resolution` · resolution axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `open` | Open | No answer has been recorded. | that the question is still the right one to ask |
| `answered` | Answered | A human recorded an answer. | that the answer was applied to the record |
| `dismissed` | Dismissed | The question was withdrawn without an answer. | that the underlying uncertainty was resolved |
| `superseded` | Superseded | A later question or decision replaced this one. | what the replacement decided |

### Field note follow up

`field_note_follow_up` · lead axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `open` | Open | The lead has not been taken up. | that the lead is still worth taking up |
| `dismissed` | Dismissed | The lead was closed without becoming a finding. | that the observation behind it was wrong |

### Xref relationship

`xref_relationship` · relation axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `shared-pattern` | Shared pattern | Both subsystems implement the same pattern. | that either copy is derived from the other |
| `data-flow` | Data flow | Data produced by one subsystem is consumed by the other. | the direction of control, only of data |
| `dependency` | Dependency | One subsystem depends on the other to do its work. | that the dependency is the only one between them |
| `mirrors` | Mirrors | The two subsystems maintain parallel structures that must stay in step. | that anything enforces the parallel |
| `contention` | Contention | Both subsystems compete for the same resource. | that the contention is unmanaged |
| `temporal-coupling` | Temporal coupling | The two must run, or change, in a particular order. | that the order is enforced anywhere |

### Xref strength

`xref_strength` · relation axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `observed` | Observed | The link was seen once in the code and recorded. | that the link is intentional or stable |
| `confirmed` | Confirmed | The link was checked from both sides. | that the link is architecturally required |
| `structural` | Structural | The link follows from a structure both sides depend on. | that either side is aware of the other |

### Contradiction resolution

`contradiction_resolution` · resolution axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `a-supersedes-b` | A supersedes B | The first finding stands and the second is withdrawn. | that the withdrawn finding was wrong about everything it said |
| `b-supersedes-a` | B supersedes A | The second finding stands and the first is withdrawn. | that the withdrawn finding was wrong about everything it said |
| `scope-distinction` | Scope distinction | Both findings stand; they apply to scopes the record now distinguishes. | that either finding was re-verified |
| `unresolved` | Unresolved | The conflict is recorded and not yet settled. | either finding |

### Diagnosticity outcome

`diagnosticity_outcome` · resolution axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `open` | Open | The competing explanations have not been analyzed to a verdict. | any one of the competing explanations |
| `resolved` | Resolved | This item has a recorded resolution. | that the resolution was independently checked |
| `unresolved-competition` | Competing explanations | Multiple explanations remain viable; the evidence does not discriminate. | that any one of the competing explanations is the right one |

### Claim epistemic kind

`claim_epistemic_kind` · claim axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `observation` | Observation | Something read directly in the code or an artifact. | why it is that way |
| `inference` | Inference | A conclusion drawn from observations, not read directly. | itself as an observation |
| `hypothesis` | Hypothesis | A candidate explanation offered for testing. | any conclusion until it has been tested |
| `open-question` | Open question | A question the record raises and does not answer. | any answer to it |
| `direct-intent` | Direct intent | Intent a human stated. | intent the human did not state |
| `inferred-intent` | Inferred intent | Intent attributed from the code or the record, not stated. | that the attributed intent is the actual one |
| `decision` | Decision | A choice recorded with the authority that made it. | that the decision was carried out |

### Claim subject type

`claim_subject_type` · claim axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `symbol` | Symbol | A named function, type, or value at a path. | anything about its callers |
| `subsystem` | Subsystem | A registered subsystem id. | anything about a specific file within it |
| `seam` | Seam | A registered boundary between two subsystems. | either party's internals |

### Concern status

`concern_status` · concern axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `active` | Active | The concern is on the checklist and must be dispositioned. | that any subsystem has dispositioned it |
| `retired` | Retired | The concern was withdrawn from the checklist. | that past dispositions were revisited |
| `merged` | Merged | The concern was folded into another concern code. | anything the target concern has not recorded |
| `candidate` | Candidate | The concern was proposed and not yet accepted onto the checklist. | that it is reviewed anywhere |

### Pass type

`pass_type` · provenance axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `onboarding` | Onboarding | The first pass, which establishes scope and the survey plan. | any correctness claim |
| `survey` | Survey | The structural and concern-review pass over a subsystem. | that a conclusion survived challenge |
| `adversarial` | Adversarial | The pass that tries to overturn what the survey concluded. | that nothing was missed |
| `refresh` | Refresh | A later pass that re-examines the record against a newer revision. | anything the refresh did not re-read |

### Lens

`lens` · lens axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `codebase` | Codebase | The recorded account of what the project is, how it works, and which of its territory has not been read. | that unread territory holds no defects |
| `unresolved` | Unresolved | Records that have not reached a terminal, evidence-backed state at the checked revision. | that a record here is still reproducible at the repository head |
| `history` | History | Records that have reached a terminal state, plus the recorded account of how they got there where one exists. | that a terminal state was re-checked at the repository head |
| `method` | Method | The apparatus by which a reader judges how far the rest of the record can be trusted. | any claim about the project itself |

### Omission reason

`omission_reason` · omission axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `policy` | Not requested | The section was not requested by the call. | that the section is empty |
| `budget` | Over budget | The item was eligible and ranked below the byte or item budget. | that the omitted items matter less than the selected ones |

### Attention label

`attention_label` · attention axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `open` | Open | A finding with no terminal resolution event, ordered by severity. | that the defect is still reproducible at the repository head |
| `regression` | Regression | A currently open finding with a prior verified-fixed event. | that the recorded repair was reverted rather than defeated another way |
| `unverified-suspicion` | Unverified suspicion | An open candidate-concern field note. | that the suspicion is a defect |
| `unknown` | Unknown | An open question. | any answer to it |
| `stale-knowledge` | Stale knowledge | A claim validity interval closed at or before the reviewed head, or an obligation-bearing ledger row marked stale. | that the recorded reading was wrong, only that it is no longer current |
| `awaiting-verification` | Awaiting verification | A finding whose current resolution state is fixed-pending-verification. | that the defect is gone at the repository head |
| `undiscriminated` | Undiscriminated | Two or more credible accounts stand and the record does not say which of them the evidence picks out. | any one of the competing accounts |

