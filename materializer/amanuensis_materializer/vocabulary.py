"""Generated from contracts/conspectus-vocabulary.json — do not edit by hand.
Run `node scripts/gen-vocabulary.mjs` after changing the source; CI runs
`--check` and `--check-sql` and fails when a copy or a SQL CHECK diverges."""

from __future__ import annotations

VOCABULARY_CONTRACT_VERSION = "1.0.0"

# finding_resolution_state — resolution axis.
FINDING_RESOLUTION_STATES: tuple[str, ...] = (
    "open",
    "accepted",
    "ruled-out",
    "fixed-pending-verification",
    "verified-fixed",
)

# finding_status — resolution axis.
FINDING_STATUSES: tuple[str, ...] = (
    "confirmed-bug",
    "confirmed-acceptable",
    "fixed",
    "ruled-out",
)

# standing_state — standing axis.
STANDING_STATES: tuple[str, ...] = (
    "unledgered",
    "excluded",
    "scoped-unread",
    "examined",
    "examined-stale",
    "absent",
    "mixed",
)

# stale_reason — standing axis.
STALE_REASONS: tuple[str, ...] = (
    "git-drift",
    "absent",
    "unverifiable-ref",
    "unreachable-ref",
)

# file_classification — standing axis.
FILE_CLASSIFICATIONS: tuple[str, ...] = (
    "candidate",
    "examined",
    "generated-ignore",
    "vendor-ignore",
    "irrelevant",
    "deferred-with-reason",
)

# subsystem_status — survey axis.
SUBSYSTEM_STATUSES: tuple[str, ...] = (
    "unmapped",
    "scoping",
    "structural",
    "concerns",
    "adversarial",
    "mapped",
    "deferred",
)

# evidence_kind — evidence axis.
EVIDENCE_KINDS: tuple[str, ...] = (
    "code-verified",
    "runtime-observed",
    "contract-stated",
    "test-observed",
    "config-asserted",
    "doc-asserted",
    "comment-asserted",
    "name-inferred",
    "pattern-matched",
)

# evidence_quality — evidence axis.
EVIDENCE_QUALITIES: tuple[str, ...] = (
    "code-verified",
    "runtime-observed",
    "contract-stated",
    "test-observed",
    "config-asserted",
    "doc-asserted",
    "comment-asserted",
    "name-inferred",
    "pattern-matched",
)

# disposition_classification — disposition axis.
DISPOSITION_CLASSIFICATIONS: tuple[str, ...] = (
    "confirmed-bug",
    "confirmed-acceptable",
    "ruled-out",
    "out-of-scope",
    "unresolved-competition",
)

# severity — severity axis.
SEVERITIES: tuple[str, ...] = (
    "CRITICAL",
    "HIGH",
    "MEDIUM",
    "LOW",
)

# field_note_category — lead axis.
FIELD_NOTE_CATEGORIES: tuple[str, ...] = (
    "pattern",
    "anomaly",
    "connection",
    "tension",
    "candidate-concern",
)

# open_question_category — question axis.
OPEN_QUESTION_CATEGORIES: tuple[str, ...] = (
    "domain-knowledge",
    "scope-judgment",
    "priority-ranking",
    "contradiction",
    "tooling-limit",
    "ambiguous-evidence",
    "other",
)

# open_question_resolution — resolution axis.
OPEN_QUESTION_RESOLUTIONS: tuple[str, ...] = (
    "open",
    "answered",
    "dismissed",
    "superseded",
)

# field_note_follow_up — lead axis.
FIELD_NOTE_FOLLOW_UPS: tuple[str, ...] = (
    "open",
    "dismissed",
)

# xref_relationship — relation axis.
XREF_RELATIONSHIPS: tuple[str, ...] = (
    "shared-pattern",
    "data-flow",
    "dependency",
    "mirrors",
    "contention",
    "temporal-coupling",
)

# xref_strength — relation axis.
XREF_STRENGTHS: tuple[str, ...] = (
    "observed",
    "confirmed",
    "structural",
)

# contradiction_resolution — resolution axis.
CONTRADICTION_RESOLUTIONS: tuple[str, ...] = (
    "a-supersedes-b",
    "b-supersedes-a",
    "scope-distinction",
    "unresolved",
)

# diagnosticity_outcome — resolution axis.
DIAGNOSTICITY_OUTCOMES: tuple[str, ...] = (
    "open",
    "resolved",
    "unresolved-competition",
)

# claim_epistemic_kind — claim axis.
CLAIM_EPISTEMIC_KINDS: tuple[str, ...] = (
    "observation",
    "inference",
    "hypothesis",
    "open-question",
    "direct-intent",
    "inferred-intent",
    "decision",
)

# claim_subject_type — claim axis.
CLAIM_SUBJECT_TYPES: tuple[str, ...] = (
    "symbol",
    "subsystem",
    "seam",
)

# concern_status — concern axis.
CONCERN_STATUSES: tuple[str, ...] = (
    "active",
    "retired",
    "merged",
    "candidate",
)

# pass_type — provenance axis.
PASS_TYPES: tuple[str, ...] = (
    "onboarding",
    "survey",
    "adversarial",
    "refresh",
)

# lens — lens axis.
LENSES: tuple[str, ...] = (
    "codebase",
    "unresolved",
    "history",
    "method",
)

# omission_reason — omission axis.
OMISSION_REASONS: tuple[str, ...] = (
    "policy",
    "budget",
)

# attention_label — attention axis.
ATTENTION_LABELS: tuple[str, ...] = (
    "open",
    "regression",
    "unverified-suspicion",
    "unknown",
    "stale-knowledge",
    "awaiting-verification",
    "undiscriminated",
)

# Every enum with its per-value label, meaning, and authorization limit.
VOCABULARY: dict[str, dict[str, object]] = {
    "finding_resolution_state": {
        "axis": "resolution",
        "open_vocabulary": False,
        "values": (
            {
                "value": "open",
                "label": "Open",
                "meaning": "No terminal resolution event has been recorded; the item is still open.",
                "cannot_justify": "that the defect is still reproducible at the repository head",
            },
            {
                "value": "accepted",
                "label": "Accepted",
                "meaning": "The behavior is recorded as understood and acceptable; it is not an open defect.",
                "cannot_justify": "that the judgement was revisited at the repository head",
            },
            {
                "value": "ruled-out",
                "label": "Ruled out",
                "meaning": "The candidate problem was overturned by evidence or adversarial review.",
                "cannot_justify": "that no related defect exists at the same locus",
            },
            {
                "value": "fixed-pending-verification",
                "label": "Unverified fix",
                "meaning": "A repair is recorded, but independent fix evidence has not yet closed the finding.",
                "cannot_justify": "that the defect is gone at the repository head",
            },
            {
                "value": "verified-fixed",
                "label": "Verified fixed",
                "meaning": "A later revision contains a repair backed by recorded verification evidence.",
                "cannot_justify": "that the repair is still present at the repository head",
            },
        ),
    },
    "finding_status": {
        "axis": "resolution",
        "open_vocabulary": False,
        "values": (
            {
                "value": "confirmed-bug",
                "label": "Confirmed defect",
                "meaning": "A defect supported by evidence and retained after adversarial review.",
                "cannot_justify": "that the defect is unrepaired at the repository head; the resolution events are the authority",
            },
            {
                "value": "confirmed-acceptable",
                "label": "Accepted behavior",
                "meaning": "The observed behavior is real and judged to be intended or acceptable.",
                "cannot_justify": "that the judgement was revisited at the repository head",
            },
            {
                "value": "fixed",
                "label": "Fixed",
                "meaning": "The defect was confirmed at an earlier revision and is recorded as addressed later.",
                "cannot_justify": "that verification evidence closed the finding; only a verified-fixed event carries that",
            },
            {
                "value": "ruled-out",
                "label": "Ruled out",
                "meaning": "The candidate problem was overturned by evidence or adversarial review.",
                "cannot_justify": "that no related defect exists at the same locus",
            },
        ),
    },
    "standing_state": {
        "axis": "standing",
        "open_vocabulary": False,
        "values": (
            {
                "value": "unledgered",
                "label": "No record",
                "meaning": "No file_ledger row names this path in any subsystem.",
                "cannot_justify": "\"there are no findings here\"; \"this file is out of scope\"",
                "authorizes": "nothing",
            },
            {
                "value": "excluded",
                "label": "Excluded",
                "meaning": "A ledger row classifies the path as generated, vendored, irrelevant, or deferred with a recorded reason.",
                "cannot_justify": "any claim about the file's content or behavior",
                "authorizes": "the recorded exclusion reason and classification",
            },
            {
                "value": "scoped-unread",
                "label": "In scope, not yet read",
                "meaning": "A ledger row classifies the path candidate: it participates in a subsystem, and no one has read it.",
                "cannot_justify": "any claim about content, behavior, or the absence of defects",
                "authorizes": "that this file participates in its owning subsystem",
            },
            {
                "value": "examined",
                "label": "Examined",
                "meaning": "A ledger row classifies the path examined, it is not stale, and its examination revision resolves in the workspace.",
                "cannot_justify": "claims about symbols no evidence cites; the absence of defects",
                "authorizes": "current claims whose evidence cites this file",
            },
            {
                "value": "examined-stale",
                "label": "Examined, since changed",
                "meaning": "The path was examined, and drift, absence, or an unreachable examination revision has withdrawn that reading's currency.",
                "cannot_justify": "any current claim at the repository head",
                "authorizes": "a dated historical reading, attributed to its examination revision",
            },
            {
                "value": "absent",
                "label": "No longer in the repository",
                "meaning": "A scope_gaps row of kind absent, or a ledger row whose stale_reason is absent.",
                "cannot_justify": "anything at the repository head",
                "authorizes": "that the path was once surveyed",
            },
            {
                "value": "mixed",
                "label": "Owners disagree",
                "meaning": "Two or more owning subsystems record different standing states for the same path.",
                "cannot_justify": "anything the weakest owner state cannot justify",
                "authorizes": "only what the weakest owner state authorizes",
            },
        ),
    },
    "stale_reason": {
        "axis": "standing",
        "open_vocabulary": False,
        "values": (
            {
                "value": "git-drift",
                "label": "Changed since examination",
                "meaning": "The file's content differs from the revision it was examined at.",
                "cannot_justify": "that the recorded reading is wrong, only that it is no longer current",
            },
            {
                "value": "absent",
                "label": "Gone from the repository",
                "meaning": "The examined path is no longer tracked in the workspace.",
                "cannot_justify": "anything about the current tree at that path",
            },
            {
                "value": "unverifiable-ref",
                "label": "Examination revision cannot be compared",
                "meaning": "The examination revision could not be diffed against the current head, so drift could not be computed.",
                "cannot_justify": "that the file did or did not change",
            },
            {
                "value": "unreachable-ref",
                "label": "Examination revision is not an ancestor",
                "meaning": "The examination revision resolves in the workspace but is not an ancestor of the current head.",
                "cannot_justify": "any current claim at the repository head",
            },
        ),
    },
    "file_classification": {
        "axis": "standing",
        "open_vocabulary": False,
        "values": (
            {
                "value": "candidate",
                "label": "In scope, not yet read",
                "meaning": "The path participates in a subsystem and has not been read.",
                "cannot_justify": "any claim about content or behavior",
                "obligation_bearing": True,
            },
            {
                "value": "examined",
                "label": "Examined",
                "meaning": "The path was read and its reading is anchored to an examination revision.",
                "cannot_justify": "claims about symbols no evidence cites",
                "obligation_bearing": True,
            },
            {
                "value": "generated-ignore",
                "label": "Generated",
                "meaning": "The path is build or projection output and is not read as a source of claims.",
                "cannot_justify": "anything about the generator that produced it",
                "obligation_bearing": False,
            },
            {
                "value": "vendor-ignore",
                "label": "Vendored",
                "meaning": "The path is third-party code carried in the tree and is not surveyed.",
                "cannot_justify": "anything about the upstream project's behavior",
                "obligation_bearing": False,
            },
            {
                "value": "irrelevant",
                "label": "Ruled irrelevant",
                "meaning": "The path was judged to carry nothing the survey needs.",
                "cannot_justify": "that the judgement was re-examined at the repository head",
                "obligation_bearing": False,
            },
            {
                "value": "deferred-with-reason",
                "label": "Deferred",
                "meaning": "The path is in scope but deliberately left unread, with the reason recorded.",
                "cannot_justify": "any claim about content or behavior",
                "obligation_bearing": True,
            },
        ),
    },
    "subsystem_status": {
        "axis": "survey",
        "open_vocabulary": False,
        "values": (
            {
                "value": "unmapped",
                "label": "Unmapped",
                "meaning": "This subsystem has not yet been surveyed; no architectural claims are authorized.",
                "cannot_justify": "any claim about this subsystem's behavior",
            },
            {
                "value": "scoping",
                "label": "Scoping",
                "meaning": "Only the subsystem boundary and file scope are established so far.",
                "cannot_justify": "any behavioral claim; file scope is all that is established",
            },
            {
                "value": "structural",
                "label": "Structural",
                "meaning": "Types, state, flows, and concurrency are mapped; correctness claims are not yet authorized.",
                "cannot_justify": "any correctness claim",
            },
            {
                "value": "concerns",
                "label": "Concerns",
                "meaning": "Structural mapping is complete and concern-by-concern review is in progress.",
                "cannot_justify": "that a finding survived adversarial challenge",
            },
            {
                "value": "adversarial",
                "label": "Adversarial",
                "meaning": "Candidate conclusions are being challenged; treat them as provisional.",
                "cannot_justify": "that the challenge pass has finished",
            },
            {
                "value": "mapped",
                "label": "Mapped",
                "meaning": "Survey complete through structural analysis, concern review, and adversarial challenge.",
                "cannot_justify": "that the reading is current at the repository head",
            },
            {
                "value": "deferred",
                "label": "Deferred",
                "meaning": "This subsystem is intentionally outside the active survey plan.",
                "cannot_justify": "anything about this subsystem's behavior",
            },
        ),
    },
    "evidence_kind": {
        "axis": "evidence",
        "open_vocabulary": False,
        "values": (
            {
                "value": "code-verified",
                "label": "Code verified",
                "meaning": "The implementation was read and the stated behavior was verified directly.",
                "cannot_justify": "behavior at any revision other than the one cited",
            },
            {
                "value": "runtime-observed",
                "label": "Runtime observed",
                "meaning": "The behavior was observed in a running system and the observation was recorded.",
                "cannot_justify": "that the same behavior holds under other inputs or configurations",
            },
            {
                "value": "contract-stated",
                "label": "Contract stated",
                "meaning": "An explicit schema, type, or behavioral contract states this claim.",
                "cannot_justify": "that the implementation honors the contract",
            },
            {
                "value": "test-observed",
                "label": "Test observed",
                "meaning": "A test run or recorded observation demonstrates this behavior.",
                "cannot_justify": "behavior outside what the test exercises",
            },
            {
                "value": "config-asserted",
                "label": "Config asserted",
                "meaning": "Configuration states the behavior, but runtime behavior was not independently verified.",
                "cannot_justify": "that this configuration is the one in effect",
            },
            {
                "value": "doc-asserted",
                "label": "Docs asserted",
                "meaning": "Project documentation states the claim; implementation agreement is not yet verified.",
                "cannot_justify": "that the implementation matches the documentation",
            },
            {
                "value": "comment-asserted",
                "label": "Comment asserted",
                "meaning": "A code comment states the claim; the implementation was not verified against it.",
                "cannot_justify": "that the comment is current with the code beside it",
            },
            {
                "value": "name-inferred",
                "label": "Name inferred",
                "meaning": "The claim is inferred from a symbol name and should be treated as weak evidence.",
                "cannot_justify": "any correctness claim; a name is not an implementation",
            },
            {
                "value": "pattern-matched",
                "label": "Pattern matched",
                "meaning": "The claim matches a known pattern and is only a scoping signal.",
                "cannot_justify": "any claim about what this locus actually does",
            },
        ),
    },
    "evidence_quality": {
        "axis": "evidence",
        "open_vocabulary": False,
        "values": (
            {
                "value": "code-verified",
                "label": "Code verified",
                "meaning": "The implementation was read and the stated behavior was verified directly.",
                "cannot_justify": "behavior at any revision other than the one cited",
            },
            {
                "value": "runtime-observed",
                "label": "Runtime observed",
                "meaning": "The behavior was observed in a running system and the observation was recorded.",
                "cannot_justify": "that the same behavior holds under other inputs or configurations",
            },
            {
                "value": "contract-stated",
                "label": "Contract stated",
                "meaning": "An explicit schema, type, or behavioral contract states this claim.",
                "cannot_justify": "that the implementation honors the contract",
            },
            {
                "value": "test-observed",
                "label": "Test observed",
                "meaning": "A test run or recorded observation demonstrates this behavior.",
                "cannot_justify": "behavior outside what the test exercises",
            },
            {
                "value": "config-asserted",
                "label": "Config asserted",
                "meaning": "Configuration states the behavior, but runtime behavior was not independently verified.",
                "cannot_justify": "that this configuration is the one in effect",
            },
            {
                "value": "doc-asserted",
                "label": "Docs asserted",
                "meaning": "Project documentation states the claim; implementation agreement is not yet verified.",
                "cannot_justify": "that the implementation matches the documentation",
            },
            {
                "value": "comment-asserted",
                "label": "Comment asserted",
                "meaning": "A code comment states the claim; the implementation was not verified against it.",
                "cannot_justify": "that the comment is current with the code beside it",
            },
            {
                "value": "name-inferred",
                "label": "Name inferred",
                "meaning": "The claim is inferred from a symbol name and should be treated as weak evidence.",
                "cannot_justify": "any correctness claim; a name is not an implementation",
            },
            {
                "value": "pattern-matched",
                "label": "Pattern matched",
                "meaning": "The claim matches a known pattern and is only a scoping signal.",
                "cannot_justify": "any claim about what this locus actually does",
            },
        ),
    },
    "disposition_classification": {
        "axis": "disposition",
        "open_vocabulary": False,
        "values": (
            {
                "value": "confirmed-bug",
                "label": "Confirmed defect",
                "meaning": "A defect supported by evidence and retained after adversarial review.",
                "cannot_justify": "that the defect is unrepaired at the repository head",
            },
            {
                "value": "confirmed-acceptable",
                "label": "Accepted behavior",
                "meaning": "The observed behavior is real and judged to be intended or acceptable.",
                "cannot_justify": "that the judgement was revisited at the repository head",
            },
            {
                "value": "ruled-out",
                "label": "Ruled out",
                "meaning": "The candidate problem was overturned by evidence or adversarial review.",
                "cannot_justify": "that no related defect exists at the same locus",
            },
            {
                "value": "out-of-scope",
                "label": "Out of scope",
                "meaning": "The concern does not apply within this subsystem's declared boundary.",
                "cannot_justify": "that the concern does not apply elsewhere in the project",
            },
            {
                "value": "unresolved-competition",
                "label": "Competing explanations",
                "meaning": "Multiple explanations remain viable; the evidence does not discriminate.",
                "cannot_justify": "that any one of the competing explanations is the right one",
            },
        ),
    },
    "severity": {
        "axis": "severity",
        "open_vocabulary": False,
        "values": (
            {
                "value": "CRITICAL",
                "label": "Critical",
                "meaning": "Potential data loss, security failure, privilege escalation, or production outage path.",
                "cannot_justify": "how likely the path is to be reached; severity is impact, not confidence",
            },
            {
                "value": "HIGH",
                "label": "High",
                "meaning": "Incorrect behavior on a common path, corrupt state, or a seriously wedged workflow.",
                "cannot_justify": "how confident the finding is; severity is impact, not confidence",
            },
            {
                "value": "MEDIUM",
                "label": "Medium",
                "meaning": "Incorrect edge-case behavior or a correctness issue with a known workaround.",
                "cannot_justify": "that the edge case is rare in practice",
            },
            {
                "value": "LOW",
                "label": "Low",
                "meaning": "Maintainability, clarity, or defensive-coding risk most likely to affect a future change.",
                "cannot_justify": "that the risk will never be reached",
            },
        ),
    },
    "field_note_category": {
        "axis": "lead",
        "open_vocabulary": False,
        "values": (
            {
                "value": "pattern",
                "label": "Pattern",
                "meaning": "A recurrence noticed in more than one place.",
                "cannot_justify": "that the recurrence is intentional",
            },
            {
                "value": "anomaly",
                "label": "Anomaly",
                "meaning": "A deviation from the surrounding conventions or expectations.",
                "cannot_justify": "that the deviation is a defect",
            },
            {
                "value": "connection",
                "label": "Connection",
                "meaning": "A relationship noticed across subsystem boundaries.",
                "cannot_justify": "that the relationship is load-bearing",
            },
            {
                "value": "tension",
                "label": "Tension",
                "meaning": "Local correctness that sits awkwardly against global coherence.",
                "cannot_justify": "that either side is wrong",
            },
            {
                "value": "candidate-concern",
                "label": "Candidate concern",
                "meaning": "A pattern that might warrant a concern code of its own.",
                "cannot_justify": "that the concern has been reviewed anywhere",
            },
        ),
    },
    "open_question_category": {
        "axis": "question",
        "open_vocabulary": False,
        "values": (
            {
                "value": "domain-knowledge",
                "label": "Domain knowledge",
                "meaning": "A business rule or domain fact the record cannot supply.",
                "cannot_justify": "the assumption recorded in its place",
            },
            {
                "value": "scope-judgment",
                "label": "Scope judgment",
                "meaning": "A scope fence that needs a human to confirm.",
                "cannot_justify": "that the assumed boundary is the right one",
            },
            {
                "value": "priority-ranking",
                "label": "Priority ranking",
                "meaning": "A survey order the agent guessed and a reviewer can override.",
                "cannot_justify": "that the ranking reflects project priorities",
            },
            {
                "value": "contradiction",
                "label": "Contradiction",
                "meaning": "Two credible sources disagree and the record does not settle it.",
                "cannot_justify": "either reading",
            },
            {
                "value": "tooling-limit",
                "label": "Tooling limit",
                "meaning": "An operation the agent could not perform.",
                "cannot_justify": "anything about what that operation would have shown",
            },
            {
                "value": "ambiguous-evidence",
                "label": "Ambiguous evidence",
                "meaning": "The evidence permits more than one interpretation.",
                "cannot_justify": "any single interpretation",
            },
            {
                "value": "other",
                "label": "Other",
                "meaning": "A question that fits none of the recorded categories.",
                "cannot_justify": "anything beyond the question as asked",
            },
        ),
    },
    "open_question_resolution": {
        "axis": "resolution",
        "open_vocabulary": False,
        "values": (
            {
                "value": "open",
                "label": "Open",
                "meaning": "No answer has been recorded.",
                "cannot_justify": "that the question is still the right one to ask",
            },
            {
                "value": "answered",
                "label": "Answered",
                "meaning": "A human recorded an answer.",
                "cannot_justify": "that the answer was applied to the record",
            },
            {
                "value": "dismissed",
                "label": "Dismissed",
                "meaning": "The question was withdrawn without an answer.",
                "cannot_justify": "that the underlying uncertainty was resolved",
            },
            {
                "value": "superseded",
                "label": "Superseded",
                "meaning": "A later question or decision replaced this one.",
                "cannot_justify": "what the replacement decided",
            },
        ),
    },
    "field_note_follow_up": {
        "axis": "lead",
        "open_vocabulary": True,
        "values": (
            {
                "value": "open",
                "label": "Open",
                "meaning": "The lead has not been taken up.",
                "cannot_justify": "that the lead is still worth taking up",
            },
            {
                "value": "dismissed",
                "label": "Dismissed",
                "meaning": "The lead was closed without becoming a finding.",
                "cannot_justify": "that the observation behind it was wrong",
            },
        ),
    },
    "xref_relationship": {
        "axis": "relation",
        "open_vocabulary": True,
        "values": (
            {
                "value": "shared-pattern",
                "label": "Shared pattern",
                "meaning": "Both subsystems implement the same pattern.",
                "cannot_justify": "that either copy is derived from the other",
            },
            {
                "value": "data-flow",
                "label": "Data flow",
                "meaning": "Data produced by one subsystem is consumed by the other.",
                "cannot_justify": "the direction of control, only of data",
            },
            {
                "value": "dependency",
                "label": "Dependency",
                "meaning": "One subsystem depends on the other to do its work.",
                "cannot_justify": "that the dependency is the only one between them",
            },
            {
                "value": "mirrors",
                "label": "Mirrors",
                "meaning": "The two subsystems maintain parallel structures that must stay in step.",
                "cannot_justify": "that anything enforces the parallel",
            },
            {
                "value": "contention",
                "label": "Contention",
                "meaning": "Both subsystems compete for the same resource.",
                "cannot_justify": "that the contention is unmanaged",
            },
            {
                "value": "temporal-coupling",
                "label": "Temporal coupling",
                "meaning": "The two must run, or change, in a particular order.",
                "cannot_justify": "that the order is enforced anywhere",
            },
        ),
    },
    "xref_strength": {
        "axis": "relation",
        "open_vocabulary": False,
        "values": (
            {
                "value": "observed",
                "label": "Observed",
                "meaning": "The link was seen once in the code and recorded.",
                "cannot_justify": "that the link is intentional or stable",
            },
            {
                "value": "confirmed",
                "label": "Confirmed",
                "meaning": "The link was checked from both sides.",
                "cannot_justify": "that the link is architecturally required",
            },
            {
                "value": "structural",
                "label": "Structural",
                "meaning": "The link follows from a structure both sides depend on.",
                "cannot_justify": "that either side is aware of the other",
            },
        ),
    },
    "contradiction_resolution": {
        "axis": "resolution",
        "open_vocabulary": False,
        "values": (
            {
                "value": "a-supersedes-b",
                "label": "A supersedes B",
                "meaning": "The first finding stands and the second is withdrawn.",
                "cannot_justify": "that the withdrawn finding was wrong about everything it said",
            },
            {
                "value": "b-supersedes-a",
                "label": "B supersedes A",
                "meaning": "The second finding stands and the first is withdrawn.",
                "cannot_justify": "that the withdrawn finding was wrong about everything it said",
            },
            {
                "value": "scope-distinction",
                "label": "Scope distinction",
                "meaning": "Both findings stand; they apply to scopes the record now distinguishes.",
                "cannot_justify": "that either finding was re-verified",
            },
            {
                "value": "unresolved",
                "label": "Unresolved",
                "meaning": "The conflict is recorded and not yet settled.",
                "cannot_justify": "either finding",
            },
        ),
    },
    "diagnosticity_outcome": {
        "axis": "resolution",
        "open_vocabulary": False,
        "values": (
            {
                "value": "open",
                "label": "Open",
                "meaning": "The competing explanations have not been analyzed to a verdict.",
                "cannot_justify": "any one of the competing explanations",
            },
            {
                "value": "resolved",
                "label": "Resolved",
                "meaning": "This item has a recorded resolution.",
                "cannot_justify": "that the resolution was independently checked",
            },
            {
                "value": "unresolved-competition",
                "label": "Competing explanations",
                "meaning": "Multiple explanations remain viable; the evidence does not discriminate.",
                "cannot_justify": "that any one of the competing explanations is the right one",
            },
        ),
    },
    "claim_epistemic_kind": {
        "axis": "claim",
        "open_vocabulary": False,
        "values": (
            {
                "value": "observation",
                "label": "Observation",
                "meaning": "Something read directly in the code or an artifact.",
                "cannot_justify": "why it is that way",
            },
            {
                "value": "inference",
                "label": "Inference",
                "meaning": "A conclusion drawn from observations, not read directly.",
                "cannot_justify": "itself as an observation",
            },
            {
                "value": "hypothesis",
                "label": "Hypothesis",
                "meaning": "A candidate explanation offered for testing.",
                "cannot_justify": "any conclusion until it has been tested",
            },
            {
                "value": "open-question",
                "label": "Open question",
                "meaning": "A question the record raises and does not answer.",
                "cannot_justify": "any answer to it",
            },
            {
                "value": "direct-intent",
                "label": "Direct intent",
                "meaning": "Intent a human stated.",
                "cannot_justify": "intent the human did not state",
            },
            {
                "value": "inferred-intent",
                "label": "Inferred intent",
                "meaning": "Intent attributed from the code or the record, not stated.",
                "cannot_justify": "that the attributed intent is the actual one",
            },
            {
                "value": "decision",
                "label": "Decision",
                "meaning": "A choice recorded with the authority that made it.",
                "cannot_justify": "that the decision was carried out",
            },
        ),
    },
    "claim_subject_type": {
        "axis": "claim",
        "open_vocabulary": False,
        "values": (
            {
                "value": "symbol",
                "label": "Symbol",
                "meaning": "A named function, type, or value at a path.",
                "cannot_justify": "anything about its callers",
            },
            {
                "value": "subsystem",
                "label": "Subsystem",
                "meaning": "A registered subsystem id.",
                "cannot_justify": "anything about a specific file within it",
            },
            {
                "value": "seam",
                "label": "Seam",
                "meaning": "A registered boundary between two subsystems.",
                "cannot_justify": "either party's internals",
            },
        ),
    },
    "concern_status": {
        "axis": "concern",
        "open_vocabulary": False,
        "values": (
            {
                "value": "active",
                "label": "Active",
                "meaning": "The concern is on the checklist and must be dispositioned.",
                "cannot_justify": "that any subsystem has dispositioned it",
            },
            {
                "value": "retired",
                "label": "Retired",
                "meaning": "The concern was withdrawn from the checklist.",
                "cannot_justify": "that past dispositions were revisited",
            },
            {
                "value": "merged",
                "label": "Merged",
                "meaning": "The concern was folded into another concern code.",
                "cannot_justify": "anything the target concern has not recorded",
            },
            {
                "value": "candidate",
                "label": "Candidate",
                "meaning": "The concern was proposed and not yet accepted onto the checklist.",
                "cannot_justify": "that it is reviewed anywhere",
            },
        ),
    },
    "pass_type": {
        "axis": "provenance",
        "open_vocabulary": False,
        "values": (
            {
                "value": "onboarding",
                "label": "Onboarding",
                "meaning": "The first pass, which establishes scope and the survey plan.",
                "cannot_justify": "any correctness claim",
            },
            {
                "value": "survey",
                "label": "Survey",
                "meaning": "The structural and concern-review pass over a subsystem.",
                "cannot_justify": "that a conclusion survived challenge",
            },
            {
                "value": "adversarial",
                "label": "Adversarial",
                "meaning": "The pass that tries to overturn what the survey concluded.",
                "cannot_justify": "that nothing was missed",
            },
            {
                "value": "refresh",
                "label": "Refresh",
                "meaning": "A later pass that re-examines the record against a newer revision.",
                "cannot_justify": "anything the refresh did not re-read",
            },
        ),
    },
    "lens": {
        "axis": "lens",
        "open_vocabulary": False,
        "values": (
            {
                "value": "codebase",
                "label": "Codebase",
                "meaning": "The recorded account of what the project is, how it works, and which of its territory has not been read.",
                "cannot_justify": "that unread territory holds no defects",
            },
            {
                "value": "unresolved",
                "label": "Unresolved",
                "meaning": "Records that have not reached a terminal, evidence-backed state at the checked revision.",
                "cannot_justify": "that a record here is still reproducible at the repository head",
            },
            {
                "value": "history",
                "label": "History",
                "meaning": "Records that have reached a terminal state, plus the recorded account of how they got there where one exists.",
                "cannot_justify": "that a terminal state was re-checked at the repository head",
            },
            {
                "value": "method",
                "label": "Method",
                "meaning": "The apparatus by which a reader judges how far the rest of the record can be trusted.",
                "cannot_justify": "any claim about the project itself",
            },
        ),
    },
    "omission_reason": {
        "axis": "omission",
        "open_vocabulary": False,
        "values": (
            {
                "value": "policy",
                "label": "Not requested",
                "meaning": "The section was not requested by the call.",
                "cannot_justify": "that the section is empty",
            },
            {
                "value": "budget",
                "label": "Over budget",
                "meaning": "The item was eligible and ranked below the byte or item budget.",
                "cannot_justify": "that the omitted items matter less than the selected ones",
            },
        ),
    },
    "attention_label": {
        "axis": "attention",
        "open_vocabulary": False,
        "values": (
            {
                "value": "open",
                "label": "Open",
                "meaning": "A finding with no terminal resolution event, ordered by severity.",
                "cannot_justify": "that the defect is still reproducible at the repository head",
            },
            {
                "value": "regression",
                "label": "Regression",
                "meaning": "A currently open finding with a prior verified-fixed event.",
                "cannot_justify": "that the recorded repair was reverted rather than defeated another way",
            },
            {
                "value": "unverified-suspicion",
                "label": "Unverified suspicion",
                "meaning": "An open candidate-concern field note.",
                "cannot_justify": "that the suspicion is a defect",
            },
            {
                "value": "unknown",
                "label": "Unknown",
                "meaning": "An open question.",
                "cannot_justify": "any answer to it",
            },
            {
                "value": "stale-knowledge",
                "label": "Stale knowledge",
                "meaning": "A claim validity interval closed at or before the reviewed head, or an obligation-bearing ledger row marked stale.",
                "cannot_justify": "that the recorded reading was wrong, only that it is no longer current",
            },
            {
                "value": "awaiting-verification",
                "label": "Awaiting verification",
                "meaning": "A finding whose current resolution state is fixed-pending-verification.",
                "cannot_justify": "that the defect is gone at the repository head",
            },
            {
                "value": "undiscriminated",
                "label": "Undiscriminated",
                "meaning": "Two or more credible accounts stand and the record does not say which of them the evidence picks out.",
                "cannot_justify": "any one of the competing accounts",
            },
        ),
    },
}

# Classifications that exempt a scoped file from survey obligation: generated
# output, vendored third-party code, and files ruled irrelevant. Counting their
# drift would let a republished projection — which changes on every publish —
# read as the conspectus going stale, diluting the signal.
OBLIGATION_EXEMPT_CLASSIFICATIONS: tuple[str, ...] = (
    "generated-ignore",
    "vendor-ignore",
    "irrelevant",
)
OBLIGATION_BEARING_CLASSIFICATIONS: tuple[str, ...] = (
    "candidate",
    "examined",
    "deferred-with-reason",
)

# SQL predicate selecting ledger rows that do carry a survey obligation.
OBLIGATION_BEARING_SQL = (
    "COALESCE(classification, 'candidate') NOT IN ('generated-ignore', 'vendor-ignore', 'irrelevant')"
)

# Terms orientation prose may not use; see the orientation lint.
ORIENTATION_FORBIDDEN_TERMS: tuple[str, ...] = (
    "stale",
    "fresh",
    "mapped",
    "unmapped",
    "re-anchored",
    "up to date",
    "out of date",
    "current as of",
    "fully surveyed",
)


def values_of(*enum_names: str) -> tuple[str, ...]:
    """Every value of the named enums, in declaration order, first occurrence kept."""
    seen: list[str] = []
    for name in enum_names:
        for entry in VOCABULARY[name]["values"]:  # type: ignore[index]
            if entry["value"] not in seen:
                seen.append(entry["value"])
    return tuple(seen)


def _flatten(field: str, enum_names: tuple[str, ...]) -> dict[str, str]:
    """Flat value -> field map over the named enums.

    The projection's hint tables are one flat namespace across several axes, so a
    value carried by more than one enum is taken from the first enum listed. The
    order is the caller's declared precedence, never dictionary chance.
    """
    out: dict[str, str] = {}
    for name in enum_names:
        for entry in VOCABULARY[name]["values"]:  # type: ignore[index]
            out.setdefault(str(entry["value"]), str(entry[field]))
    return out


def meanings(*enum_names: str) -> dict[str, str]:
    """Flat value -> one-sentence meaning, in the caller's precedence order."""
    return _flatten("meaning", enum_names)


def labels(*enum_names: str) -> dict[str, str]:
    """Flat value -> reader-facing label, in the caller's precedence order."""
    return _flatten("label", enum_names)


def cannot_justify(*enum_names: str) -> dict[str, str]:
    """Flat value -> what the value cannot be used to claim (VP12)."""
    return _flatten("cannot_justify", enum_names)


def axes(*enum_names: str) -> dict[str, str]:
    """Flat value -> the axis of the first named enum that carries it."""
    out: dict[str, str] = {}
    for name in enum_names:
        axis = str(VOCABULARY[name]["axis"])
        for entry in VOCABULARY[name]["values"]:  # type: ignore[index]
            out.setdefault(str(entry["value"]), axis)
    return out
