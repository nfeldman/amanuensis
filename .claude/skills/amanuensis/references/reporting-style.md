# Reporting Style

Use this contract for HTML labels, navigation, hints, generated prose, and
design handoffs. It governs the human projection, not identifiers stored by
the target codebase.

## Keep information architecture and interface design separate

- Let information architecture determine what exists, its hierarchy, its
  routes, and which status dimensions must remain distinct.
- Let interface design determine layout, typography, color, density, and
  interaction within that structure.
- Do not let a visual direction rename records, merge status dimensions, or
  create unsupported workflow state.
- Keep the project name as the primary identity. Present Amanuensis as the
  producing system or method, never as the project's title.

## Register

Write primarily for experienced software practitioners. Prefer established
terms such as project, subsystem, component, module, interface, dependency,
implementation, finding, evidence, decision, risk, test, status, source,
revision, and next step.

Use textual-critical vocabulary only when it identifies the evidence
relationship more precisely:

- **witness** — a specific source file, revision, artifact, or recorded output
  being compared;
- **variant** — a materially different implementation or recorded reading;
- **reading** — an interpretation of behavior supported by cited witnesses;
- **locus** — the exact code or artifact location under discussion;
- **collation** — systematic comparison of witnesses or revisions;
- **apparatus** — a compact presentation of variants, evidence, and provenance;
- **gloss** or **annotation** — explanatory material attached to a technical
  record;
- **provenance**, **transmission**, and **recension** — use only when tracking
  origin, transformation, or a distinct derived version.

Do not rename ordinary software concepts merely to add atmosphere. A file is
a file unless its role as a witness matters. A finding remains a finding.

Two specialized labels are explicitly part of the Amanuensis voice:

- **Decision docket** — a bounded list of unresolved decisions and the
  information needed to make them. Do not use it as a synonym for all findings.
- **Warrants** — the explicit reasoning that connects evidence to a claim or
  recommendation. Keep the underlying evidence directly reachable.

## Avoid decorative registers

- Avoid clinical labels such as `casefile`, `triage`, `diagnosis`, or
  `condition` when the object is a finding, priority, status, or decision.
  Technical uses such as race condition and precondition remain correct.
- Avoid implying personal memory or task prediction. Prefer `Continue
  reviewing` over `Resume this report` unless reader-specific state actually
  exists and is disclosed.
- Prefer `Supporting evidence` over `Evidence trail`, and `Not yet surveyed`
  over `Unseen territory`.
- Do not style the interface as paper, parchment, a field notebook, an archive,
  or a manuscript facsimile. Textual-critical precision does not require
  antiquarian visual treatment.
- Avoid decorative metaphor in navigation. Use direct labels that remain
  meaningful when read out of context.

## Projection copy examples

| Avoid | Prefer |
|---|---|
| Casefiles | Findings |
| Four conditions | Project status |
| Resume this report | Continue reviewing |
| Evidence trail | Supporting evidence |
| Unseen territory | Not yet surveyed |
| Living architecture evidence register | Architecture survey produced by Amanuensis |

Keep labels concise. Put qualifications in adjacent hints or definitions,
not in invented terminology.
