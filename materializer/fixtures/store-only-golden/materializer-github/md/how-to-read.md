# How to read this survey

*What each page is for, the terms the site uses, and how a survey works. Use it when a word, an ID or a page is unfamiliar.*


## What this site is

This site is the record of an AI agent's survey of FictionalProject. The agent read the code, recorded what it concluded and the code each conclusion rests on, and listed what it could not settle. It does not change the code. Every page is as of one commit, shown at the top of each HTML page as *Checked* and in the overview's *Checked at* row.

Each page is HTML, written to one directory that starts at index.html. The diagrams, the search and the definitions shown on hover need nothing outside that directory, so a copy of the whole directory reads the same.

## Pages on this site

Every kind of page this survey publishes, grouped by lens. The lens says what kind of claim a page carries. Subsystem pages and evidence tables take one row each; the pages they stand for are listed on the pages the rows link to.

### Overview

| Page | What it shows | Use it when |
|---|---|---|
| [Overview](index.md) | What the codebase is, and where the survey stands. | you arrive, or want the current counts. |

### Codebase

The recorded account of what the project is, how it works, and which of its territory has not been read.

| Page | What it shows | Use it when |
|---|---|---|
| [Architecture](architecture.md) | Runtime shape, recorded edges, and boundaries, read as one connected system. | you want the overall shape before reading any one part. |
| [Subsystems](master-plan.md) | Every region, grouped by layer, with the scope recorded for it. | you are looking for the part of the code that does something. |
| [Files](files.md) | One row per ledger file with owners, standing, and open defects. | you want to know whether a particular file was read. |
| [Not yet surveyed](not-yet-surveyed.md) | The recorded edge of the map, each gap counted over the unit it occupies. | you want to know what the survey has not covered. |
| [System boundaries](seams.md) | Shared objects and ordering assumptions where independently understandable subsystems meet. | you are changing something two subsystems share. |
| [Codebase glossary](vocabulary.md) | The project's own names, with the meanings Amanuensis observed in context. | a project-specific name is unfamiliar. |
| [Subsystem pages](master-plan.md) | 3 pages, one page per subsystem. | you have picked a subsystem. |

### Unresolved

Records that have not reached a terminal, evidence-backed state at the checked revision.

| Page | What it shows | Use it when |
|---|---|---|
| [Open findings](findings.md) | Defects open or awaiting verification at the checked revision. | you want the defects still open. |
| [Disagreements](disagreements.md) | Where credible records disagree or the evidence does not discriminate between them. | you want to know where the record contradicts itself. |
| [Decisions needed](open-questions.md) | Questions the survey could not settle, with the assumption used to keep moving. | you want to know what the agent needs from you. |
| [Leads](field-notes.md) | Open observations that are not yet findings. | you want things noticed but not yet confirmed. |
| [Stale knowledge](stale.md) | Examined files the repository has changed under, and scoped files that changed before anyone read them. | you want to know what may be out of date since the code changed. |
| [Hot spots](hot-spots.md) | Where unresolved work and unread territory concentrate, as separate measures. | you want to know where open work concentrates. |

### History

Records that have reached a terminal state, plus the recorded account of how they got there where one exists.

| Page | What it shows | Use it when |
|---|---|---|
| [Resolved findings](resolved-findings.md) | Verified, ruled out, and accepted, each with the basis its resolution rests on. | you want to know what was fixed or ruled out, and on what basis. |
| [Resolution history](resolution-history.md) | The append-only account of how records reached their state. | you want to know how a record reached its state. |
| [Resolved leads and questions](resolved-leads.md) | Questions that were answered or dismissed, and leads that were closed. | you want to know how a question was answered. |
| [Sessions and publications](sessions.md) | What ran, when, and what it produced. | you want to know when the survey ran. |
| [Conflicting evidence](contradictions.md) | Resolved disagreements and the evidence that settled them. | you want to see how a disagreement was settled. |

### Method

The apparatus by which a reader judges how far the rest of the record can be trusted.

| Page | What it shows | Use it when |
|---|---|---|
| [Reader's guide](how-to-read.md) | What each page is for, the terms the site uses, and how a survey works. | a word, an ID or a page is unfamiliar. |
| [Review coverage](concerns.md) | Which failure modes were tested where, and the disposition each one reached. | you want to know which defect kinds were checked where. |
| [Review checklist](concern-checklist.md) | The concern set and its provenance. | you want the list of defect kinds and where it came from. |
| [Competing explanations](diagnosticity.md) | Index of evidence matrices and their outcomes. | you want to see how a symptom's cause was weighed. |
| [Onboarding record](onboarding-report.md) | The repository boundary and initial decomposition that established this conspectus. | you want the first pass's decisions about scope and split. |
| [Where to begin](entry-point.md) | A dated reading path recorded by an earlier session; it is survey history, not a current index. | you want the reading path an earlier session wrote. |
| [Evidence tables](diagnosticity.md) | 1 pages, one page per evidence matrix. | you followed a DM- link. |

## How a survey works

The agent works in two stages and does not wait for approval between steps.

**Onboarding**, once. The agent reads the repository's shape, splits it into subsystems grouped by layer, writes a review checklist of defects worth looking for in this codebase, ranks the subsystems, and publishes the first version of this site.

**A survey of each subsystem**, highest priority first, in five passes:

| Pass | What the agent does | Survey depth it sets, and when | What that depth means |
|---|---|---|---|
| Scope | Lists the subsystem's files and the terms it uses. | **Scoped**, when the pass is done | The scope pass is done: the subsystem's boundary and files are established, nothing more. |
| Structure | Reads the files; records types, state, data flows, concurrency, and claims. | **Structural**, when the pass is done | The structure pass is done: types, state, flows and concurrency are mapped; correctness claims are not yet authorized. |
| Concern review | Gives every checklist item a verdict with evidence. Confirmed defects become findings. | **Reviewing concerns**, as the pass starts | Structural mapping is complete and concern-by-concern review is in progress. |
| Challenge | Tries to prove each claim and finding wrong. | **Challenging claims**, as the pass starts | Candidate conclusions are being challenged; treat them as provisional. |
| Packaging | Writes the subsystem's purpose and account, updates the site. | **Mapped**, when the pass is done | Survey complete through structural analysis, concern review, and adversarial challenge. |

A subsystem shown as *Reviewing concerns* or *Challenging claims* is in the middle of that pass: its verdicts and findings so far are not the last word.

**Refresh**, when the code changes. The agent re-reads files that changed since it read them. Until then they are listed on Stale knowledge.

### What it expects from you

- Nothing, for it to keep going. When it cannot decide something, it records a *decision needed* with the assumption it used, and carries on.
- At each checkpoint (after onboarding, after each subsystem, and at the start of each session) it posts a summary in your chat. Read **Decisions needed** then, and answer what you can by telling the agent in your session. This site is read-only; answers reach the record only through the agent.
- You can redirect it at any time: name a subsystem to survey next, say "stop", or ask "what do we know about `<file>`".

### Phase numbers

Notes written by the agent may say "Phase 2". The numbers belong to one of two sequences:

| Numbering | Phases | What they are |
|---|---|---|
| Onboarding | 0–7 | The one-time stage above, before any subsystem is surveyed. |
| Subsystem survey | 1–5 | Scope (1), Structure (2), Concern review (3), Challenge (4), Packaging (5), in order. |

## Terms

Words this site uses in a particular sense. Each entry says where you will meet it.

<a id="term-amanuensis"></a>

### Amanuensis

The tool that produced this site. An AI agent runs it to survey a repository.

Seen on: [Overview](index.md), [Sessions and publications](sessions.md)

<a id="term-conspectus"></a>

### Conspectus

*Also called: survey record.*

Amanuensis's name for what a survey keeps: a database of what was read and concluded, plus this site, which is built from it.

Seen on: [Overview](index.md), [Onboarding record](onboarding-report.md)

<a id="term-survey"></a>

### Survey

The agent's reading of the repository, done in passes, with each conclusion tied to the code it read.

Seen on: [Overview](index.md), [Not yet surveyed](not-yet-surveyed.md), [Sessions and publications](sessions.md), [Subsystem pages](master-plan.md)

<a id="term-session"></a>

### Session

One stretch of work by the agent. Sessions and publications lists them.

Seen on: [Sessions and publications](sessions.md), [Resolution history](resolution-history.md), [Where to begin](entry-point.md), [Overview](index.md)

<a id="term-subsystem"></a>

### Subsystem

A part of the codebase the survey treats as one unit, with its own files and its own page. The agent chose the split during onboarding.

Seen on: [Subsystems](master-plan.md), [Architecture](architecture.md), [Onboarding record](onboarding-report.md), [Subsystem pages](master-plan.md), [Overview](index.md), [Not yet surveyed](not-yet-surveyed.md), [Hot spots](hot-spots.md), [Disagreements](disagreements.md), [Competing explanations](diagnosticity.md), [Evidence tables](diagnosticity.md)

<a id="term-layer"></a>

### Layer

*Also called: region.*

A group of subsystems with a similar role. Pages group subsystems by layer.

Seen on: [Subsystems](master-plan.md), [Architecture](architecture.md), [Subsystem pages](master-plan.md)

<a id="term-survey-depth"></a>

### Survey depth

*Also called: status.*

How far the survey of a subsystem has got. Unmapped: not started. Scoped and Structural: that pass is done. Reviewing concerns and Challenging claims: that pass is under way. Mapped: every pass is done. Deferred: left out of the survey on purpose. Each depth limits what the record may claim.

Seen on: [Subsystems](master-plan.md), [Architecture](architecture.md), [Not yet surveyed](not-yet-surveyed.md), [Subsystem pages](master-plan.md), [Overview](index.md)

<a id="term-mapped"></a>

### Mapped

The last survey depth: every pass has run. It does not mean every file is read or every bug found.

Seen on: [Subsystems](master-plan.md), [Not yet surveyed](not-yet-surveyed.md), [Subsystem pages](master-plan.md)

<a id="term-scope"></a>

### Scope

*Also called: file ledger.*

The files a subsystem owns, each marked as read, not yet read, or left out with a reason.

Seen on: [Files](files.md), [Not yet surveyed](not-yet-surveyed.md), [Subsystem pages](master-plan.md), [Overview](index.md), [Subsystems](master-plan.md)

<a id="term-evidence"></a>

### Evidence

A pointer to code at a commit (file, symbol, lines) with a note of how strong it is: read in code, seen in a test, stated in a comment, and so on.

Seen on: [Open findings](findings.md), [Resolved findings](resolved-findings.md), [Review coverage](concerns.md), [Subsystem pages](master-plan.md), [Conflicting evidence](contradictions.md), [Disagreements](disagreements.md), [Hot spots](hot-spots.md)

<a id="term-claim"></a>

### Claim

A statement about how the code is built ("this cache is per request"), with evidence.

Seen on: [Disagreements](disagreements.md), [Subsystem pages](master-plan.md)

<a id="term-challenge"></a>

### Challenge

*Also called: adversarial pass.*

A pass in which the agent tries to prove its own claims and findings wrong. Each claim records whether it survived.

Seen on: [Open findings](findings.md), [Resolved findings](resolved-findings.md), [Subsystem pages](master-plan.md)

<a id="term-concern"></a>

### Concern

One kind of defect worth looking for in this codebase, such as a race on a shared cache. The review checklist is the full list.

Seen on: [Review coverage](concerns.md), [Review checklist](concern-checklist.md), [System boundaries](seams.md), [Not yet surveyed](not-yet-surveyed.md), [Competing explanations](diagnosticity.md), [Subsystem pages](master-plan.md)

<a id="term-concern-review"></a>

### Concern review

*Also called: disposition.*

The verdict for one concern in one subsystem: bug found, acceptable, ruled out, out of scope, or undecided.

Seen on: [Review coverage](concerns.md), [Subsystem pages](master-plan.md), [Disagreements](disagreements.md)

<a id="term-finding"></a>

### Finding

A defect the survey confirmed, with evidence, a severity, and a state (open, repaired, verified, ruled out, accepted).

Seen on: [Open findings](findings.md), [Resolved findings](resolved-findings.md), [Hot spots](hot-spots.md), [Files](files.md), [Subsystem pages](master-plan.md), [Overview](index.md), [Subsystems](master-plan.md), [Disagreements](disagreements.md)

<a id="term-lead"></a>

### Lead

*Also called: field note.*

Something the agent noticed that is not a finding: a pattern, an oddity, a tension, a possible concern.

Seen on: [Leads](field-notes.md), [Resolved leads and questions](resolved-leads.md), [Subsystem pages](master-plan.md)

<a id="term-decision-needed"></a>

### Decision needed

*Also called: open question.*

Something the agent could not settle alone. It records the assumption it used and keeps going; you answer it.

Seen on: [Decisions needed](open-questions.md), [Resolved leads and questions](resolved-leads.md), [Subsystem pages](master-plan.md)

<a id="term-disagreement"></a>

### Disagreement

*Also called: contradiction.*

Two records that cannot both be true. The survey keeps both until one is settled.

Seen on: [Disagreements](disagreements.md), [Conflicting evidence](contradictions.md)

<a id="term-competing-explanations"></a>

### Competing explanations

*Also called: diagnosticity matrix.*

A table weighing several causes for one symptom against the evidence.

Seen on: [Competing explanations](diagnosticity.md), [Evidence tables](diagnosticity.md), [Disagreements](disagreements.md)

<a id="term-system-boundary"></a>

### System boundary

*Also called: seam.*

A place where two subsystems share something (a table, a queue, a cache) and depend on each other's assumptions about it.

Seen on: [System boundaries](seams.md), [Architecture](architecture.md), [Subsystem pages](master-plan.md)

<a id="term-recorded-edge"></a>

### Recorded edge

*Also called: xref.*

A dependency or data flow between two subsystems that the agent wrote down. Edges are never guessed from names.

Seen on: [Architecture](architecture.md), [Subsystem pages](master-plan.md)

<a id="term-stale"></a>

### Stale

A file that changed after the revision the survey recorded for it: the one it was read at, scoped at, or set aside at. What the survey said about it may no longer hold.

Seen on: [Stale knowledge](stale.md), [Files](files.md), [Overview](index.md), [Hot spots](hot-spots.md)

<a id="term-checked-at"></a>

### Checked at

*Also called: revision.*

The commit the survey last compared itself against. Everything on the site is as of that commit.

Seen on: [Overview](index.md), [Stale knowledge](stale.md)

<a id="term-standing"></a>

### Standing

What the record says about one file: no record, left out, in scope but unread, read, read but changed since.

Seen on: [Files](files.md), [Stale knowledge](stale.md), [Subsystem pages](master-plan.md)

<a id="term-lens"></a>

### Lens

One of four groups of pages: Codebase (what the project is), Unresolved (open work), History (what was settled), Method (how far to trust the rest).

Seen on: [Overview](index.md)

<a id="term-thesis"></a>

### Thesis

The paragraph on the overview that says what the codebase does.

Seen on: [Overview](index.md)

<a id="term-purpose-account"></a>

### Purpose, account

*Also called: explanation.*

A subsystem's one-sentence purpose and its longer explanation of how it works, each written from evidence.

Seen on: [Architecture](architecture.md), [Subsystem pages](master-plan.md)

<a id="term-publication-check"></a>

### Publication check

*Also called: read-back.*

After building the site, Amanuensis reads it back to confirm it matches the record. The overview shows the result.

Seen on: [Overview](index.md), [Sessions and publications](sessions.md)

## How IDs are formed

IDs are short labels so records can point at each other. Except where this page says otherwise, the letters are not a code: read the name beside the ID.

Here the letter is the layer: B is backend, F is frontend.

| Kind | Shape | Names | Chosen by | Example here | Links to |
|---|---|---|---|---|---|
| Subsystem | letters, dash, number: `R-06` | a subsystem | the agent, at onboarding | [B-01](subsystems/b01-job-scheduler.md) (Job Scheduler) | the subsystem's page |
| Finding | subsystem code, dash, sequence: `R06-2` | a defect in that subsystem | the agent, when it records the finding | [B01-1](resolved-findings.md#b01-1) | Open or Resolved findings |
| Seam | `SM-` and a number: `SM-03` | a system boundary | the agent | [SM-01](seams.md#sm-01) | System boundaries |
| Concern | short letters, dash, number: `RC-2` | a checklist item | the agent, at onboarding | [concern CB-1](concerns.md#cb-1) | Review coverage |
| Seam concern | `SC-` and a number | a checklist item about one boundary | the agent | none yet | Review coverage |
| Competing explanations | `DM-` and a number | one evidence table | numbered by Amanuensis | [DM-1](diagnosticity/dm-1.md) | its own page |
| Decision | `#` and a number | a decision needed | numbered by Amanuensis | none yet | Decisions needed |

## Status values

The values this site prints as labels, from the vocabulary contract, version `1.2.0`: the same source the server checks writes against. Each table gives the label, what it means, and what it cannot justify.

### Finding state

Stored as `finding_resolution_state` · resolution axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `open` | Open | No terminal resolution event has been recorded; the item is still open. | that the defect is still reproducible at the repository head |
| `accepted` | Accepted | The behavior is recorded as understood and acceptable; it is not an open defect. | that the judgement was revisited at the repository head |
| `ruled-out` | Ruled out | The candidate problem was overturned by evidence or adversarial review. | that no related defect exists at the same locus |
| `fixed-pending-verification` | Unverified fix | A repair is recorded, but independent fix evidence has not yet closed the finding. | that the defect is gone at the repository head |
| `verified-fixed` | Verified fixed | A later revision contains a repair backed by recorded verification evidence. | that the repair is still present at the repository head |

### File standing

Stored as `standing_state` · standing axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `unledgered` | No record | No file_ledger row names this path in any subsystem. | "there are no findings here"; "this file is out of scope" |
| `excluded` | Excluded | A ledger row classifies the path as generated, vendored, irrelevant, or deferred with a recorded reason. | any claim about the file's content or behavior |
| `scoped-unread` | In scope, not yet read | A ledger row classifies the path candidate: it participates in a subsystem, and no one has read it. | any claim about content, behavior, or the absence of defects |
| `examined` | Examined | A ledger row classifies the path examined, it is not stale, and its examination revision resolves in the workspace. | claims about symbols no evidence cites; the absence of defects |
| `examined-stale` | Examined, since changed | The path was examined, and drift, absence, or an unreachable examination revision has withdrawn that reading's currency. | any current claim at the repository head |
| `absent` | No longer in the repository | A scope_gaps row of kind absent, or a ledger row whose stale_reason is absent. | anything at the repository head |
| `mixed` | Owners disagree | Two or more owning subsystems record different standing states for the same path. | anything the weakest owner state cannot justify |

### Why a file is stale

Stored as `stale_reason` · standing axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `git-drift` | Changed since examination | The file's content differs from the revision it was examined at. | that the recorded reading is wrong, only that it is no longer current |
| `absent` | Gone from the repository | The examined path is no longer tracked in the workspace. | anything about the current tree at that path |
| `unverifiable-ref` | Examination revision cannot be compared | The examination revision could not be diffed against the current head, so drift could not be computed. | that the file did or did not change |
| `unreachable-ref` | Examination revision is not an ancestor | The examination revision resolves in the workspace but is not an ancestor of the current head. | any current claim at the repository head |

### File scope

Stored as `file_classification` · standing axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `candidate` | In scope, not yet read | The path participates in a subsystem and has not been read. | any claim about content or behavior |
| `examined` | Examined | The path was read and its reading is anchored to an examination revision. | claims about symbols no evidence cites |
| `generated-ignore` | Generated | The path is build or projection output and is not read as a source of claims. | anything about the generator that produced it |
| `vendor-ignore` | Vendored | The path is third-party code carried in the tree and is not surveyed. | anything about the upstream project's behavior |
| `irrelevant` | Ruled irrelevant | The path was judged to carry nothing the survey needs. | that the judgement was re-examined at the repository head |
| `deferred-with-reason` | Deferred | The path is in scope but deliberately left unread, with the reason recorded. | any claim about content or behavior |

### Survey depth

Stored as `subsystem_status` · survey axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `unmapped` | Unmapped | This subsystem has not yet been surveyed; no architectural claims are authorized. | any claim about this subsystem's behavior |
| `scoping` | Scoped | The scope pass is done: the subsystem's boundary and files are established, nothing more. | any behavioral claim; file scope is all that is established |
| `structural` | Structural | The structure pass is done: types, state, flows and concurrency are mapped; correctness claims are not yet authorized. | any correctness claim |
| `concerns` | Reviewing concerns | Structural mapping is complete and concern-by-concern review is in progress. | that a finding survived adversarial challenge |
| `adversarial` | Challenging claims | Candidate conclusions are being challenged; treat them as provisional. | that the challenge pass has finished |
| `mapped` | Mapped | Survey complete through structural analysis, concern review, and adversarial challenge. | that the reading is current at the repository head |
| `deferred` | Deferred | This subsystem is intentionally outside the active survey plan. | anything about this subsystem's behavior |

### Evidence kind

Stored as `evidence_kind` · evidence axis

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

### Concern review verdict

Stored as `disposition_classification` · disposition axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `confirmed-bug` | Confirmed defect | A defect supported by evidence and retained after adversarial review. | that the defect is unrepaired at the repository head |
| `confirmed-acceptable` | Accepted behavior | The observed behavior is real and judged to be intended or acceptable. | that the judgement was revisited at the repository head |
| `ruled-out` | Ruled out | The candidate problem was overturned by evidence or adversarial review. | that no related defect exists at the same locus |
| `out-of-scope` | Out of scope | The concern does not apply within this subsystem's declared boundary. | that the concern does not apply elsewhere in the project |
| `unresolved-competition` | Competing explanations | Multiple explanations remain viable; the evidence does not discriminate. | that any one of the competing explanations is the right one |

### Severity

Stored as `severity` · severity axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `CRITICAL` | Critical | Potential data loss, security failure, privilege escalation, or production outage path. | how likely the path is to be reached; severity is impact, not confidence |
| `HIGH` | High | Incorrect behavior on a common path, corrupt state, or a seriously wedged workflow. | how confident the finding is; severity is impact, not confidence |
| `MEDIUM` | Medium | Incorrect edge-case behavior or a correctness issue with a known workaround. | that the edge case is rare in practice |
| `LOW` | Low | Maintainability, clarity, or defensive-coding risk most likely to affect a future change. | that the risk will never be reached |

### Lead category

Stored as `field_note_category` · lead axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `pattern` | Pattern | A recurrence noticed in more than one place. | that the recurrence is intentional |
| `anomaly` | Anomaly | A deviation from the surrounding conventions or expectations. | that the deviation is a defect |
| `connection` | Connection | A relationship noticed across subsystem boundaries. | that the relationship is load-bearing |
| `tension` | Tension | Local correctness that sits awkwardly against global coherence. | that either side is wrong |
| `candidate-concern` | Candidate concern | A pattern that might warrant a concern code of its own. | that the concern has been reviewed anywhere |

### Decision category

Stored as `open_question_category` · question axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `domain-knowledge` | Domain knowledge | A business rule or domain fact the record cannot supply. | the assumption recorded in its place |
| `scope-judgment` | Scope judgment | A scope fence that needs a human to confirm. | that the assumed boundary is the right one |
| `priority-ranking` | Priority ranking | A survey order the agent guessed and a reviewer can override. | that the ranking reflects project priorities |
| `contradiction` | Contradiction | Two credible sources disagree and the record does not settle it. | either reading |
| `tooling-limit` | Tooling limit | An operation the agent could not perform. | anything about what that operation would have shown |
| `ambiguous-evidence` | Ambiguous evidence | The evidence permits more than one interpretation. | any single interpretation |
| `other` | Other | A question that fits none of the recorded categories. | anything beyond the question as asked |

### Decision outcome

Stored as `open_question_resolution` · resolution axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `open` | Open | No answer has been recorded. | that the question is still the right one to ask |
| `answered` | Answered | A human recorded an answer. | that the answer was applied to the record |
| `dismissed` | Dismissed | The question was withdrawn without an answer. | that the underlying uncertainty was resolved |
| `superseded` | Superseded | A later question or decision replaced this one. | what the replacement decided |

### How a disagreement was settled

Stored as `contradiction_resolution` · resolution axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `a-supersedes-b` | A supersedes B | The first finding stands and the second is withdrawn. | that the withdrawn finding was wrong about everything it said |
| `b-supersedes-a` | B supersedes A | The second finding stands and the first is withdrawn. | that the withdrawn finding was wrong about everything it said |
| `scope-distinction` | Scope distinction | Both findings stand; they apply to scopes the record now distinguishes. | that either finding was re-verified |
| `unresolved` | Unresolved | The conflict is recorded and not yet settled. | either finding |

### Competing explanations outcome

Stored as `diagnosticity_outcome` · resolution axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `open` | Open | The competing explanations have not been analyzed to a verdict. | any one of the competing explanations |
| `resolved` | Resolved | This item has a recorded resolution. | that the resolution was independently checked |
| `unresolved-competition` | Competing explanations | Multiple explanations remain viable; the evidence does not discriminate. | that any one of the competing explanations is the right one |

### Lens

Stored as `lens` · lens axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `codebase` | Codebase | The recorded account of what the project is, how it works, and which of its territory has not been read. | that unread territory holds no defects |
| `unresolved` | Unresolved | Records that have not reached a terminal, evidence-backed state at the checked revision. | that a record here is still reproducible at the repository head |
| `history` | History | Records that have reached a terminal state, plus the recorded account of how they got there where one exists. | that a terminal state was re-checked at the repository head |
| `method` | Method | The apparatus by which a reader judges how far the rest of the record can be trusted. | any claim about the project itself |

## Full vocabulary

The remaining values the record stores, which the pages rarely print as labels. They come from the same contract.

### Carried finding outcome

Stored as `carried_finding_outcome` · carried axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `successor-finding` | Re-found here | A finding filed in this store records the same defect, so the carried obligation is discharged into it and a reference to the archived id follows the finding into its successor. | that the successor is the same defect; the substrate can require that a finding was filed in this store and in this session, and cannot read the judgement that the two are one |
| `ruled-out` | Ruled out here | A reading taken in this store, in the session that overturned it, does not show the defect the archive recorded. | that no related defect exists at the same locus; overturning requires evidence collected by the overturning pass, not that the locus was exhausted |
| `repaired` | Repaired here | A commit that resolves in the bound workspace carries the repair, and at least one attached evidence row was read at a revision that is a descendant of, or equal to, that commit. | that the repair is still present at the repository head, or that it is complete; a claimed repair with no post-repair reading is fixed-pending-verification, never a discharge |
| `archived-terminal` | Closed in the archive | The archive had already closed this finding — verified-fixed, ruled-out or accepted — and the carry recorded that state rather than re-deciding it. Written by the carry alone. | anything about this store: nobody here checked a commit or read a repaired path, and the row carries the archive's judgement and not this survey's |

### Finding status

Stored as `finding_status` · resolution axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `confirmed-bug` | Confirmed defect | A defect supported by evidence and retained after adversarial review. | that the defect is unrepaired at the repository head; the resolution events are the authority |
| `confirmed-acceptable` | Accepted behavior | The observed behavior is real and judged to be intended or acceptable. | that the judgement was revisited at the repository head |
| `fixed` | Fixed | The defect was confirmed at an earlier revision and is recorded as addressed later. | that verification evidence closed the finding; only a verified-fixed event carries that |
| `ruled-out` | Ruled out | The candidate problem was overturned by evidence or adversarial review. | that no related defect exists at the same locus |

### Vocabulary discharge

Stored as `vocabulary_discharge` · vocabulary axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `terms` | Terms recorded | The subsystem carries at least one vocabulary term scoped to it whose first_seen anchor still resolves: the token parses, its revision is reachable, and its path exists in that revision's tree. | that the recorded terms are the ones a reader most needs, or that the list is complete; one anchored term discharges the obligation and no count is required |
| `declined` | Declared none | A reader examined the subsystem and declared, at a recorded revision and in an attributed session, that it carries no domain vocabulary of its own. | that the judgement is true; the substrate can require that it be made, attributed and dated, and cannot check whether the subsystem really coins nothing |
| `not-recorded` | Not recorded | Neither a term nor a declination has been recorded for this subsystem, so nobody has answered the question either way. | that the subsystem has no domain vocabulary; nothing was asked and nothing was answered, which is not the same as 'none' |

### Explanation subject

Stored as `explanation_subject` · explanation axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `subsystem` | Subsystem | The explanation is about one subsystem, named by its id. | that the subsystem still has the status it had when the row was written; eligibility is read from the status at the time of each reading |
| `project` | Project | The explanation is about the codebase as a whole, and its subject id is the literal 'project'. | that the project's account still matches the subsystems it was written from; the account is recorded once a subsystem has been read to 'structural', and the purpose at any status |

### Explanation slot

Stored as `explanation_slot` · explanation axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `purpose` | Purpose | One paragraph on what this part is for, in terms of what the rest of the system or its users get from it. | that the paragraph is a restatement of scope or a list of files; a purpose is a judgement and the record cannot check it |
| `account` | Account | A short prose account of how the subject works: its moving parts, the rules it enforces and where, what it depends on, what a newcomer gets wrong, and where to start reading. | that the account is complete or current; it is bound to the revision it was written at |

### Explanation disposition

Stored as `explanation_disposition` · explanation axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `recorded` | Recorded | A survey session wrote the explanation, at a revision and over cited evidence. | that the explanation is true; the record establishes who wrote it, at which revision and over which evidence |
| `declined` | Declined | A survey session read the subject and declined to write the explanation, with the reason. | that nothing true can be said about the subject; it says only that the session could not say something true and specific |
| `withdrawn` | Withdrawn | An earlier explanation was withdrawn, with the reason, and the subject owes a new one. | that the earlier explanation was wrong; it says only that it no longer stands for this subject |
| `imported` | Imported | The project's purpose, copied from the entry point an earlier version wrote, with no evidence attached. Only the project purpose may be imported. | that anyone has checked the purpose against the code; the copy carries the old entry point's words as they were |

### Explanation discharge

Stored as `explanation_discharge` · explanation axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `recorded` | Recorded | The effective row for this slot is an explanation a survey session recorded, at a revision the workspace can resolve and over cited evidence. | that the explanation is true; the record establishes who wrote it, at which revision and over which evidence, and not that it is true |
| `declined` | Declined | The effective row for this slot is a declination: a survey session read the subject and gave the reason it wrote none. | that nothing can be said about the subject; the reason is a judgement the record keeps and cannot check |
| `not-recorded` | Not recorded | There is no effective row for this slot: none was written, the newest one was withdrawn, none resolves at a reachable revision, or the subject is not explanation-eligible. | that the subject has no purpose or account worth writing; nothing was asked or nothing stands, which is not the same as declined |

### Evidence quality

Stored as `evidence_quality` · evidence axis

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

### Field note follow up

Stored as `field_note_follow_up` · lead axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `open` | Open | The lead has not been taken up. | that the lead is still worth taking up |
| `dismissed` | Dismissed | The lead was closed without becoming a finding. | that the observation behind it was wrong |

### Xref relationship

Stored as `xref_relationship` · relation axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `shared-pattern` | Shared pattern | Both subsystems implement the same pattern. | that either copy is derived from the other |
| `data-flow` | Data flow | Data produced by one subsystem is consumed by the other. | the direction of control, only of data |
| `dependency` | Dependency | One subsystem depends on the other to do its work. | that the dependency is the only one between them |
| `mirrors` | Mirrors | The two subsystems maintain parallel structures that must stay in step. | that anything enforces the parallel |
| `contention` | Contention | Both subsystems compete for the same resource. | that the contention is unmanaged |
| `temporal-coupling` | Temporal coupling | The two must run, or change, in a particular order. | that the order is enforced anywhere |

### Xref strength

Stored as `xref_strength` · relation axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `observed` | Observed | The link was seen once in the code and recorded. | that the link is intentional or stable |
| `confirmed` | Confirmed | The link was checked from both sides. | that the link is architecturally required |
| `structural` | Structural | The link follows from a structure both sides depend on. | that either side is aware of the other |

### Claim epistemic kind

Stored as `claim_epistemic_kind` · claim axis

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

Stored as `claim_subject_type` · claim axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `symbol` | Symbol | A named function, type, or value at a path. | anything about its callers |
| `subsystem` | Subsystem | A registered subsystem id. | anything about a specific file within it |
| `seam` | Seam | A registered boundary between two subsystems. | either party's internals |

### Concern status

Stored as `concern_status` · concern axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `active` | Active | The concern is on the checklist and must be dispositioned. | that any subsystem has dispositioned it |
| `retired` | Retired | The concern was withdrawn from the checklist. | that past dispositions were revisited |
| `merged` | Merged | The concern was folded into another concern code. | anything the target concern has not recorded |
| `candidate` | Candidate | The concern was proposed and not yet accepted onto the checklist. | that it is reviewed anywhere |

### Pass type

Stored as `pass_type` · provenance axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `onboarding` | Onboarding | The first pass, which establishes scope and the survey plan. | any correctness claim |
| `survey` | Survey | The structural and concern-review pass over a subsystem. | that a conclusion survived challenge |
| `adversarial` | Adversarial | The pass that tries to overturn what the survey concluded. | that nothing was missed |
| `refresh` | Refresh | A later pass that re-examines the record against a newer revision. | anything the refresh did not re-read |

### Omission reason

Stored as `omission_reason` · omission axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `policy` | Not requested | The section was not requested by the call. | that the section is empty |
| `budget` | Over budget | The item was eligible and ranked below the byte or item budget. | that the omitted items matter less than the selected ones |

### Attention label

Stored as `attention_label` · attention axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `open` | Open | A finding with no terminal resolution event, ordered by severity. | that the defect is still reproducible at the repository head |
| `regression` | Regression | A currently open finding with a prior verified-fixed event. | that the recorded repair was reverted rather than defeated another way |
| `unverified-suspicion` | Unverified suspicion | An open candidate-concern field note. | that the suspicion is a defect |
| `unknown` | Unknown | An open question. | any answer to it |
| `stale-knowledge` | Stale knowledge | A claim validity interval closed at or before the reviewed head, or an obligation-bearing ledger row marked stale. | that the recorded reading was wrong, only that it is no longer current |
| `awaiting-verification` | Awaiting verification | A finding whose current resolution state is fixed-pending-verification. | that the defect is gone at the repository head |
| `undiscriminated` | Undiscriminated | Two or more credible accounts stand and the record does not say which of them the evidence picks out. | any one of the competing accounts |

### Narrative section

Stored as `narrative_section` · narrative axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `structure` | Structure | How the subsystem is built: its parts, what it holds, and how work moves through it. | that the structure is correct; it says how the subsystem is built as read at one revision, not that it works |
| `concern-reasoning` | Concern reasoning | Why each concern was judged to apply, to be acceptable, or to be a bug. | that no other concern applies; it gives the reasons for the verdicts the session reached |
| `challenge` | Challenge | What was tried to disprove the subsystem's findings, and what held. | that a finding is true; it says only what the challenge attempted and found |
| `repository-shape` | Repository shape | How the repository is laid out and where its parts meet. | that every directory is accounted for; it describes the layout the survey read |
| `runtime` | Runtime | What runs, in which language or process, and how the parts call each other. | that the system behaves this way in production; it describes the code as read |
| `stateful-entities` | Stateful entities | What the system stores or remembers between calls, and what may change it. | that the list is complete; it names the state the survey found |
| `concern-calibration` | Concern calibration | Which kinds of concern apply to this project and which do not, and why. | that a concern ruled out here cannot occur; it says the survey did not look for it |
| `start-here` | Start here | Where a new reader should begin, and in what order to read on. | that the rest of the survey can be skipped; it is a route into the record, not a summary of it |
| `survey-plan` | Survey plan | What the survey means to read next, and in what order. | that any of it has been read; a plan is not a reading |

### Narrative disposition

Stored as `narrative_disposition` · narrative axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `recorded` | Recorded | A survey session wrote the prose, at a revision and over cited evidence. | that the prose is true; the record establishes who wrote it, at which revision and over which evidence |
| `declined` | Declined | A survey session read the subject and declined to write the section, with the reason. | that nothing true can be said; it says only that the session could not say something specific |
| `withdrawn` | Withdrawn | Earlier prose was withdrawn, with the reason, and the subject owes a new section. | that the earlier prose was wrong; it says only that it no longer stands |

### Claim mark kind

Stored as `claim_mark_kind` · flow-mark axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `commit-point` | Commit point | The step after which the flow's effect is kept even if a later step fails. | that every failure after it is harmless; it says only where the effect becomes durable |
| `crash-point` | Crash point | A step where the process can stop partway; the label says what is left half done. | that the flow recovers from the stop; it says only that the stop leaves the state named |
| `exit` | Exit | A way the flow stops before its last step; the label says why and the target says where it unwinds to, or that it leaves the flow. | that the exit is handled by the caller; it says only where the flow ends up |
| `crosses-seam` | Crosses a seam | A step where work passes over a named system boundary. | that the other side behaves as the step expects; it says only that the call crosses |
| `trigger` | Trigger | What starts the flow. It belongs to the flow's first step. | that nothing else can start the flow; it names the start the survey found |

### Territory disposition

Stored as `territory_disposition` · territory axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `applies` | Applies | The territory applies to this project and the survey reviews it. | that the territory has been reviewed; it says only that it is in scope |
| `disqualified` | Disqualified | A named condition rules the territory out for this project. | that the condition still holds at a later revision; it was read at one revision |

### Runtime boundary origin

Stored as `runtime_boundary_origin` · runtime axis

| Value | Label | What it means | What it cannot justify |
|---|---|---|---|
| `recorded` | Recorded | A survey session recorded the boundary over cited evidence. | that the boundary is complete; it records one crossing the session read |
| `imported` | Imported | Copied from the survey notes of an earlier version, with no evidence attached. | that anyone has checked the boundary against the code; the copy carries the old notes as they were |

