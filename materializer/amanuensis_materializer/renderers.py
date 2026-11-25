"""Page renderers — each function returns (page model, sources_dict).

The sources dict maps source identifiers to their content hashes so the
manifest can detect when to re-render. DB sources are keyed as
`db:<logical-name>:<filter>` and prose sources as `prose:<rel-path>`.

Renderers are deliberately parallel — no shared state — so the
orchestrator can call them in any order.
"""
from __future__ import annotations

import json
import re
import sqlite3
import subprocess
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from hashlib import sha1, sha256
from pathlib import Path
from typing import Any

from .db import (
    outside_survey_seams,
    outside_survey_subsystems,
    owner_exclude_patterns,
    row,
    rows,
    survey_exclusions,
    survey_filter,
    table_exists,
)
from .diagrams import (
    BOUNDARY_HEADING,
    RUNTIME_BOUNDARY_ABSENT,
    RUNTIME_BOUNDARY_COLUMNS,
    badge_note,
    boundary_blocks,
    coverage_bars_model,
    coverage_blocks,
    dependency_section,
    depth_cell,
    finding_badges,
    flow_strip_blocks,
    hot_spot_access,
    hot_spot_measures,
    runtime_boundary_blocks,
    runtime_boundary_rows,
    runtime_boundary_state,
    seam_blocks,
    seam_contract_model,
    staleness_blocks,
    status_ladder_model,
    survey_workflow_model,
)
from .legacy_prose import (
    ImportedBody,
    imported_bodies,
    imported_page,
    imports_source,
    render_body,
)
from .lint import (
    THESIS_REFUSED,
    THESIS_REFUSED_COMPOSITE,
    composite_index_violations,
    explanation_refusal,
    orientation_violations,
)
from .manifest import sha256_json
from .page import (
    Anchor,
    Atlas,
    AtlasItem,
    AtlasRegion,
    Block,
    Chip,
    Code,
    CodeSpan,
    ConcernChecklist,
    ConcernFamily,
    ConcernItem,
    Details,
    Emph,
    EnumTable,
    Facets,
    Fact,
    Heading,
    Inline,
    Inlines,
    Link,
    List,
    ListItem,
    Marked,
    Page,
    Paragraph,
    Quote,
    Record,
    RecordList,
    RecordMarker,
    Row,
    RowFilter,
    Section,
    Strong,
    SummaryItem,
    SummaryList,
    Table,
    Text,
    Topology,
)
from .prose import _plain, inlines, render_prose
from .readback import (
    CARRIED_HEADING,
    CARRIED_UNDECIDED,
    COVERAGE_ROW_CARRIED,
    COVERAGE_ROW_FILES_READ,
    COVERAGE_ROW_UNLEDGERED,
    EXPLANATION_ELIGIBLE_STATUSES,
    FINDING_LENS_PAGES,
    LEDGER_STALE_SECTIONS,
    NARRATIVE_LABELS,
    PROJECT_NARRATIVE_PAGES,
    UNMEASURED,
    WHY_NO_REVISION,
    WHY_NO_TREE,
    WHY_NONE_AT_ALL,
    WHY_NONE_RECORDED,
    ExplanationReading,
    ReconciliationStanding,
    anchor_opens,
    carried_anchor,
    carried_marker,
    carried_page,
    carried_records,
    carry_was_run,
    checklist_concerns,
    effective_explanations,
    effective_narratives,
    effective_territory_dispositions,
    explanation_rows,
    finding_marker,
    finding_page,
    git_paths,
    ledger_stale_anchor,
    ledger_stale_marker,
    narrative_heading,
    narrative_text,
    project_purpose_text,
    reconciliation_standing,
    resolve_workspace,
    revision_resolves,
    territory_label,
    workspace_is_bound,
)
from .slugs import matrix_page, matrix_slug, slugify, subsystem_page
from .vocabulary import (
    ID_KINDS,
    OBLIGATION_BEARING_SQL,
    OPEN_FINDING_SQL,
    READER_TERMS,
    SURVEY_PASSES,
    VOCABULARY,
    VOCABULARY_CONTRACT_VERSION,
    cannot_justify,
    labels,
    meanings,
    values_of,
)

# A renderer returns the page model it built (store-only PLAN §3.2 step 4) and the
# hash of each source it read.
RenderResult = tuple[Page, dict[str, str]]

# The resolution states each findings page renders, from the one definition in
# readback.py, and their human labels from the enum source (spec §6.1, §10).
FINDING_LENS_STATES: dict[str, tuple[str, ...]] = {
    page: states for _lens, page, states in FINDING_LENS_PAGES
}
RESOLUTION_LABELS = labels("finding_resolution_state")
STANDING_LABELS = labels("standing_state")
SUBSYSTEM_STATUS_LABELS = labels("subsystem_status")
SUBSYSTEM_STATUS_MEANINGS = meanings("subsystem_status")
SUBSYSTEM_STATUS_LIMITS = cannot_justify("subsystem_status")


def _one_line(text: Any) -> str:
    """An authored value as one line, for a list item that a line break would end."""
    return " ".join(line.strip() for line in str(text).splitlines() if line.strip())


def _table_cell(text: Any) -> str:
    """An authored value as one table cell: a line break would end the row."""
    return _one_line(text).replace("|", "/")


def _heading(level: int, text: str) -> Heading:
    return Heading(level, inlines(text))


def _caption(title: str) -> str:
    """What a table is captioned by: the words of the section it sits in."""

    return slugify(_plain(title)).replace("-", " ")


def _section(title: str, *blocks: Block) -> Section:
    """A level-2 section: its heading, then the blocks, named by the heading's words."""

    return Section(slugify(_plain(title)), (_heading(2, title), *blocks))


def _paragraph(text: str) -> Paragraph:
    return Paragraph(inlines(text))


def _labelled_line(label: str, text: str, css_class: str) -> list[Block]:
    """A short stored value as one line led by its label.

    A value of one paragraph prints on the label's line; anything longer keeps
    its own blocks after a labelled first paragraph, so nothing stored is lost.
    """

    body = list(render_prose(text))
    lead = Strong((Text(label),))
    if body and isinstance(body[0], Paragraph):
        first = body[0]
        body[0] = Paragraph(
            Inlines((lead, Text(" "), *first.text.nodes), f"{label} {first.text.plain}"), css_class
        )
        return body
    return [Paragraph(Inlines((lead,), label), css_class), *body]


def _paragraphs(text: str) -> list[Paragraph]:
    """A free-text value as paragraphs: a blank line ends one, and its lines are joined."""

    return [
        _paragraph(" ".join(line.strip() for line in chunk.splitlines()))
        for chunk in re.split(r"\n\s*\n", text.strip())
        if chunk.strip()
    ]


def _bullets(items: Sequence[str]) -> List:
    return List(False, tuple(ListItem(inlines(item)) for item in items))


def _summary(caption: str, pairs: Sequence[tuple[str, str]]) -> SummaryList:
    """Metric/value facts, which the HTML prints as a definition list."""

    return SummaryList(caption, tuple(SummaryItem(inlines(key), inlines(value)) for key, value in pairs))


def _table(caption: str, headers: Sequence[str], body: Sequence[Sequence[str | Inlines]]) -> Table:
    """A table of text cells, each read through the inline grammar."""

    return Table(
        caption,
        tuple(inlines(header) for header in headers),
        tuple(
            Row(tuple(cell if isinstance(cell, Inlines) else inlines(cell.strip()) for cell in cells))
            for cells in body
        ),
    )


def _marked_rows(table: Table, marks: Sequence[tuple[str, str]]) -> Table:
    """A table whose rows each print one record: each row carries its record and state (§3.5)."""

    return replace(
        table,
        rows=tuple(replace(row, record=record, state=state) for row, (record, state) in zip(table.rows, marks, strict=True)),
    )


def _status_cell(status: str) -> Inlines:
    """A survey depth as its chip, the word beside the colour the badge once printed."""

    badge = _badge(status)
    if badge.startswith("·"):
        return inlines(badge)
    return Inlines((Chip("status", status),), badge)


def _words(text: Inlines) -> str:
    """An inline run as text, a code span between backticks and a link as `[label](href)`."""

    def one(node: Inline) -> str:
        if isinstance(node, CodeSpan):
            return f"`{node.text}`"
        if isinstance(node, Chip):
            return node.value
        if isinstance(node, Link):
            return f"[{node.label}]({node.href})"
        if isinstance(node, Strong):
            return f"**{''.join(one(child) for child in node.children)}**"
        if isinstance(node, Emph):
            return f"*{''.join(one(child) for child in node.children)}*"
        return getattr(node, "text", "")

    return "".join(one(node) for node in text.nodes)


def page_text(page: Page) -> str:
    """The page's words, a line to a heading, paragraph, list item or table row.

    The overview's composite-index lint reads it (it works on lines), and so do
    the tests that check what a page says of the record. It is a reading aid, not
    a format anyone publishes: no `.md` is written from it.
    """

    lines: list[str] = []

    def row(*cells: Inlines | str) -> str:
        return "| " + " | ".join(cell if isinstance(cell, str) else _words(cell) for cell in cells) + " |"

    def table(headers: Sequence[Inlines | str], body: Sequence[Sequence[Inlines | str]]) -> None:
        lines.extend([row(*headers), "|" + "---|" * len(headers), *(row(*cells) for cells in body)])

    def items(block: List, indent: str) -> None:
        for number, item in enumerate(block.items, start=1):
            lines.append(f"{indent}{f'{number}.' if block.ordered else '-'} {_words(item.text)}")
            for child in item.children:
                items(child, indent + "    ")

    def walk(blocks: Sequence[Block]) -> None:
        for block in blocks:
            if isinstance(block, Section | Details | Marked):
                walk(block.blocks)
            elif isinstance(block, Heading):
                lines.extend(["", f"{'#' * block.level} {_words(block.text)}", ""])
            elif isinstance(block, Paragraph):
                lines.extend([_words(block.text), ""])
            elif isinstance(block, List):
                items(block, "")
                lines.append("")
            elif isinstance(block, SummaryList):
                table(["Metric", "Value"], [(item.key, item.value) for item in block.items])
            elif isinstance(block, Table | EnumTable):
                table(block.headers, [row_.cells for row_ in block.rows])
            elif isinstance(block, Atlas):
                table(
                    ["Region", "Subsystem", "Survey depth"],
                    [(region.name, item.subsystem, item.depth) for region in block.regions for item in region.items],
                )
            elif isinstance(block, Topology):
                if block.kind == "seam":
                    table(
                        ["Seam", "Party A", "Shared object", "Party B"],
                        [(e.key, e.left, e.detail, e.right) for e in block.edges],
                    )
                else:
                    table(
                        ["From", "Relationship", "To", "Strength", "Context"],
                        [(e.left, e.key, e.right, e.qualifier, e.detail) for e in block.edges],
                    )
            elif isinstance(block, RecordList):
                for record in block.records:
                    lines.append(f"- {_words(record.key)}: " + "; ".join(
                        f"{fact.key} {_words(fact.value)}" for fact in (*record.facts, *record.fields)
                    ))
                lines.append("")

    lines.append(f"# {page.title}")
    walk(page.blocks)
    return "\n".join(lines) + "\n"


def _fmt_time(ts: str | None) -> str:
    if not ts:
        return "—"
    try:
        dt = datetime.fromisoformat(ts.replace(" ", "T"))
        return dt.strftime("%Y-%m-%d %H:%M UTC")
    except ValueError:
        return ts


def _badge(status: str) -> str:
    return {
        "mapped": "🟢 mapped",
        "adversarial": "🟡 adversarial",
        "concerns": "🟡 concerns",
        "structural": "🟠 structural",
        "scoping": "🔵 scoping",
        "unmapped": "⚪ unmapped",
        "deferred": "⚫ deferred",
    }.get(status, f"· {status}")


def _sev_badge(sev: str) -> str:
    return {
        "CRITICAL": "🔴 CRITICAL",
        "HIGH": "🟠 HIGH",
        "MEDIUM": "🟡 MEDIUM",
        "LOW": "🔵 LOW",
    }.get(sev, sev)


# ---------------------------------------------------------------------------
# Orientation: identity, the thesis, and the four status dimensions (§7.2)
# ---------------------------------------------------------------------------

# §3.1: `subsystems` has no purpose column, so no page can carry a purpose
# statement and every page has to say so. The trailing clause is dropped when
# there is no recorded scope either, because it would then be false.
NO_PURPOSE_SENTENCE = "No purpose statement is recorded for this subsystem"
NO_PURPOSE_WITH_SCOPE = f"{NO_PURPOSE_SENTENCE}; the scope below states what it covers."
NO_PURPOSE_ALONE = f"{NO_PURPOSE_SENTENCE}."

#: The subsystem page's vocabulary line for the state nobody has answered. The
#: label comes from the vocabulary contract, so the page and the census cannot
#: word the same state differently.
VOCABULARY_NOT_RECORDED = (
    f"**Domain vocabulary** — {labels('vocabulary_discharge').get('not-recorded', 'not recorded').lower()}."
)

# §9.1's literal and §3.4's label, verbatim.  The subsystem page and
# `describe_locus` say the same words for the same state, because a reader who
# meets both must not have to work out whether they mean the same thing.
NO_STRUCTURAL_CLAIMS = "Structural inventory not recorded as claims"
WHY_IT_MATTERS = "Why it matters"
SURVEY_NOTE_HEADING = "Survey note"
SURVEY_NOTE_LABEL = (
    "A note the survey left on the subsystem record; not bound to a revision."
)
NARRATIVE_LABEL = "Narrative from the survey artifact; not individually bound to a revision"
SURVEY_NARRATIVE = "Survey narrative"
NARRATIVE_POINTER = "The survey artifact is rendered above, under Structure."

# §3.6: the explanation a subsystem page leads with. The state word the
# declination sentences carry comes from the enum source, so a page and the
# contract cannot word the same state differently.
_DISCHARGE_LABELS = labels("explanation_discharge")
_DECLINED = _DISCHARGE_LABELS.get("declined", "declined").lower()
PURPOSE_DECLINED = (
    f"{NO_PURPOSE_SENTENCE}: a survey session {_DECLINED} to write one at"
    " `{sha}`. {reason}"
)
ACCOUNT_DECLINED = (
    f"A survey session {_DECLINED} to write an account of how this subsystem works"
    " at `{sha}`. {reason}"
)
# §3.7: the project account sits on the architecture page, opening a section of its own.
ARCHITECTURE_FIT_HEADING = "How the parts fit together"
PROJECT_ACCOUNT_ABSENT = "No account of how the parts fit together is recorded."
PROJECT_ACCOUNT_DECLINED = (
    f"A survey session {_DECLINED} to write an account of how the parts fit together"
    " at `{sha}`. {reason}"
)
PROVENANCE_LINE = "*Written by a survey session at `{sha}` from {n} evidence row(s). {ageing}*"
AGEING_UNCHANGED = "None of the {n} file(s) it cites has changed since."
AGEING_CHANGED = "{k} of the {n} file(s) it cites changed since: {paths}."
AGEING_NOT_MEASURED = "Whether the files it cites have changed since is not measured here."
AGEING_PATH_LIMIT = 5
NARRATIVE_IN_RECORD = "The survey artifact is rendered below, under Survey record."

# Stored narratives (store-only PLAN §2.1): each prints under its topic with the
# date and revision it was recorded at, and how far its cited files have moved.
NARRATIVE_PROVENANCE = "*Recorded on {date} at revision `{sha}` from {n} evidence row(s). {ageing}*"
NARRATIVE_NO_FILES = "*Recorded on {date} at revision `{sha}`. It cites no file.*"
NARRATIVE_DECLINED = "A survey session {declined} to write this at `{sha}` on {date}. {reason}"
NARRATIVE_NO_CLAIMS = "No structural claim is recorded for this subsystem."
CHALLENGE_HEADING = "Challenge"
AS_WRITTEN_HEADING = "As written at onboarding"
CHECKLIST_TITLE = "Calibrated review checklist"
CHECKLIST_HEADERS = ("Code", "Category", "Territory", "Probe", "Primary subsystems")

# §9.1's five structural categories, as the `claim_key` segment that names each
# and the heading it groups under.  Any other segment a survey recorded is its
# own group, headed by the segment's humanised name (§2.2), so the register says
# what each claim was recorded as instead of filing it under a heading nothing
# recorded.  `other` is only a claim reached through its subject or its evidence
# whose key is outside the subsystem's `<sid>/` namespace: it has no segment to
# read, so it groups last rather than being dropped (BP6).
CLAIM_KIND_HEADINGS: tuple[tuple[str, str], ...] = (
    ("key-type", "Key types"),
    ("state-container", "State containers"),
    ("flow", "Flow steps"),
    ("concurrency", "Concurrency invariants"),
    ("seam", "Seam contracts"),
    ("other", "Other claims"),
)
# `other` is the heading for claims outside the namespace, never a segment a key
# can name: a key `<sid>/other/x` is headed "Other", like any unrecognised one.
OTHER_CLAIMS_HEADING = dict(CLAIM_KIND_HEADINGS)["other"]
_CLAIM_KIND_HEADING = {kind: heading for kind, heading in CLAIM_KIND_HEADINGS if kind != "other"}
NO_SEGMENT_HEADING = "No segment"
NO_EVIDENCE_ATTACHED = "evidence: none attached"


def _like_prefix(sid: str) -> str:
    """`<sid>/%` with SQLite's LIKE wildcards escaped, for the namespace arm."""

    escaped = sid.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"{escaped}/%"


def narrative_placement(*, has_account: bool, has_claims: bool, has_artifact: bool) -> str:
    """Where a subsystem's survey narrative renders (spec §2.3).

    A recorded account takes precedence whatever the claim count; without one,
    the narrative stands in for claims that are absent and follows the ones that
    are present.  EX4 calls this with `has_account=False` because no account
    record exists yet.
    """

    if not has_artifact:
        return "none"
    if has_account:
        return "survey-record"
    return "structure-narrative" if has_claims else "inventory-fallback"


def _claim_segment(sid: str, claim_key: str) -> str | None:
    """The first segment of a `claim_key` after `<sid>/`; `None` outside the namespace."""

    prefix = f"{sid}/"
    if not claim_key.startswith(prefix):
        return None
    return claim_key[len(prefix) :].split("/", 1)[0]


def _segment_heading(segment: str | None) -> str:
    """`storage-lifecycle` → `Storage lifecycle`; a recognised kind keeps its own."""

    if segment is None:
        return OTHER_CLAIMS_HEADING
    if segment in _CLAIM_KIND_HEADING:
        return _CLAIM_KIND_HEADING[segment]
    text = segment.replace("-", " ")
    return text[:1].upper() + text[1:] if text else NO_SEGMENT_HEADING


def _claim_groups(
    sid: str, claims: list[dict[str, Any]]
) -> list[tuple[str, list[dict[str, Any]]]]:
    """§2.2's groups: recognised kinds, other segments alphabetically, then the rest."""

    by_segment: dict[str | None, list[dict[str, Any]]] = {}
    for c in claims:
        by_segment.setdefault(_claim_segment(sid, str(c["claim_key"])), []).append(c)
    recognised = [k for k in _CLAIM_KIND_HEADING if k in by_segment]
    others = sorted(k for k in by_segment if k is not None and k not in _CLAIM_KIND_HEADING)
    ordered: list[str | None] = [*recognised, *others]
    if None in by_segment:
        ordered.append(None)
    return [(_segment_heading(segment), by_segment[segment]) for segment in ordered]


def _claim_evidence(
    conn: sqlite3.Connection, claim_ids: list[str]
) -> dict[str, list[dict[str, Any]]]:
    """Each claim's `claim_evidence` rows joined to `evidence`, in evidence id order."""

    by_claim: dict[str, list[dict[str, Any]]] = {}
    if not claim_ids:
        return by_claim
    marks = ",".join("?" * len(claim_ids))
    for cited in rows(
        conn,
        "SELECT ce.claim_id, ce.role, e.file_path, e.line_range"
        " FROM claim_evidence ce JOIN evidence e ON e.id = ce.evidence_id"
        f" WHERE ce.claim_id IN ({marks}) ORDER BY e.id",
        tuple(claim_ids),
    ):
        by_claim.setdefault(str(cited["claim_id"]), []).append(cited)
    return by_claim


def _evidence_text(rows: list[dict[str, Any]]) -> str:
    """`evidence:` and the files a claim's rows cite, in evidence id order (§2.2)."""

    if not rows:
        return NO_EVIDENCE_ATTACHED
    files = []
    for attached in rows:
        path = str(attached["file_path"])
        text = f"`{path}:{attached['line_range']}`" if attached["line_range"] else f"`{path}`"
        role = str(attached["role"] or "supports")
        files.append(text if role == "supports" else f"{text} ({role})")
    return "evidence: " + ", ".join(files)

#: What a refusal of the thesis names as its source when no row is cited.
THESIS_SOURCE = "the project purpose"
THESIS_SECTION_PATTERN = re.compile(
    r"^#{1,6}\s*what is this (?:codebase|project)\??\s*$", re.IGNORECASE
)
THESIS_ABSENT = (
    "No thesis section is recorded; record the project's purpose with "
    "`record_explanation`."
)


@dataclass(frozen=True)
class Thesis:
    """What the overview's thesis slot holds, and why it holds it."""

    text: str
    recorded: bool
    violations: tuple[str, ...] = ()
    #: `absent`, `refused` or `filled`: the state the census reads (§2.5).
    state: str = "filled"
    #: Where the text came from, for the publish warning.
    source: str = THESIS_SOURCE
    #: The explanation row it prints, as its mark, and that row's state (§3.5).
    record: str = ""
    record_state: str = ""


def thesis_blocks(thesis: Thesis) -> tuple[Block, ...]:
    """The thesis as the overview prints it: a stored purpose carries its row's mark.

    The overview and the read-back both build it here (§3.5).
    """

    blocks = tuple(render_prose(thesis.text))
    return (Marked(thesis.record, thesis.record_state, blocks),) if thesis.record else blocks


def _thesis_body(prose: str) -> str:
    """The body of the section headed *What is this codebase?*, or nothing.

    The section ends at the next heading of its own level or higher, so the body
    can carry sub-headings of its own but can never swallow a sibling section.
    """

    lines = prose.splitlines()
    start: int | None = None
    level = 0
    for index, line in enumerate(lines):
        if THESIS_SECTION_PATTERN.match(line):
            level = len(line) - len(line.lstrip("#"))
            start = index + 1
            break
    if start is None:
        return ""
    body: list[str] = []
    for line in lines[start:]:
        if line.startswith("#"):
            depth = len(line) - len(line.lstrip("#"))
            if 0 < depth <= level:
                break
        body.append(line)
    return "\n".join(body).strip()


def read_thesis(storage: Path) -> Thesis:
    """The thesis `entry-point.md` carries, read from the file.

    No page calls this: the overview prints the project's purpose, a record, and
    the materializer opens no prose file (store-only PLAN §3.3). It stays as the
    reference the import's gate compares what `import_artifact_bodies` copied in
    against, by the one rule `thesis_from_prose` holds.
    """

    path = storage / "entry-point.md"
    return thesis_from_prose(path.read_text() if path.is_file() else "")


def thesis_from_prose(prose: str) -> Thesis:
    """The thesis taken by heading from an entry point's text.

    The first paragraph is deliberately not a fallback: `entry-point.md` is a
    dated reading path recorded by an earlier session, and its opening paragraph
    carries no contract to describe the project. When the named section is
    absent there is no thesis.

    Only the import (`legacy_extract`) calls this, over the bytes it copied into
    the store, not over a file on disk, which may have changed since (F3/codex,
    slice-S1). No page reads the entry point: the thesis is the project's
    purpose, a record (store-only PLAN §3.3).
    """

    body = _thesis_body(prose)
    if not body:
        return Thesis(THESIS_ABSENT, recorded=False, state="absent")
    violations = tuple(orientation_violations(body))
    if violations:
        return Thesis(THESIS_REFUSED, recorded=True, violations=violations, state="refused")
    # C32 forbids a composite score in the overview, and the thesis is the one
    # slot on it a session writes by hand. Refusing it here is what keeps the
    # figure out of the published bytes; the whole-page lint below is what makes
    # the publish red whoever put it there (F5/codex, slice-S7).
    composite = tuple(composite_index_violations(body))
    if composite:
        return Thesis(
            THESIS_REFUSED_COMPOSITE, recorded=True, violations=composite, state="refused"
        )
    return Thesis(body, recorded=True)


PROJECT_PURPOSE_DECLINED = (
    f"No thesis is recorded: a survey session {_DECLINED} to write one at"
    " `{sha}`. {reason}"
)


def project_thesis(conn: sqlite3.Connection, storage: Path) -> Thesis:
    """The overview's thesis: the effective project purpose.

    Store-only PLAN §3.3 sources the thesis from the effective project-purpose
    explanation, recorded or imported, and §2.2 requires a purpose recorded at
    onboarding to render. What the slot holds for a stored purpose is decided by
    `project_purpose_text`, the function the read-back's census owes it by, so
    the page and the census cannot disagree (F1/codex, slice-S1). A store with
    no effective purpose has no thesis: the slot says so, and no file is read.
    """

    for (subject_type, _sid, slot), reading in effective_explanations(conn, storage).items():
        if subject_type != "project" or slot != "purpose":
            continue
        owed = project_purpose_text(reading)
        if owed is None or reading.row is None:
            break
        text, violations = owed
        source = f"the project purpose (explanation row {reading.row['id']})"
        if reading.state == "declined":
            text = PROJECT_PURPOSE_DECLINED.format(
                sha=str(reading.row["ref_sha"])[:8], reason=text.strip()
            )
        return Thesis(
            text,
            recorded=True,
            violations=violations,
            state="refused" if violations else "filled",
            source=source,
            record=f"explanation:{reading.row['id']}",
            record_state=reading.state,
        )
    return Thesis(THESIS_ABSENT, recorded=False, state="absent")


def thesis_state(conn: sqlite3.Connection, storage: Path) -> str:
    """The thesis slot's state for the project: the overview prints by it too."""

    return project_thesis(conn, storage).state


#: What a page is titled when nothing in the record names the project. A
#: directory name is *not* the fallback: the worktree this store was surveyed
#: from is an accident of where the checkout lives, and publishing it as the
#: project's identity told readers of the Amanuensis self-conspectus that they
#: were reading about `amanuensis-reader-lenses` (slice-S6, F9/codex).
UNNAMED_PROJECT = "Project (name not recorded)"


def _binding_name(storage: Path) -> str | None:
    """The project name its binding metadata carries, or None.

    `initialization.json` records the identity the binding resolved at first
    use: `remote:<host>/<namespace>/<repo>` when the workspace has an origin,
    and `local:<absolute path>` when it does not. Only the remote form names
    the project — the local form's last segment *is* the worktree directory,
    which is the value this function exists to avoid.
    """

    receipt = storage / "initialization.json"
    if not receipt.is_file():
        return None
    try:
        record = json.loads(receipt.read_text())
    except (OSError, ValueError):
        return None
    identity = str(record.get("projectIdentity") or "")
    if not identity.startswith("remote:"):
        return None
    key = str(record.get("projectKey") or identity[len("remote:") :])
    segments = [segment for segment in key.split("/") if segment]
    return segments[-1] if segments else None


def _package_name(workspace: Path) -> str | None:
    """The name the workspace's own package manifest declares, or None."""

    manifest = workspace / "package.json"
    if manifest.is_file():
        try:
            declared = json.loads(manifest.read_text()).get("name")
        except (OSError, ValueError):
            declared = None
        if isinstance(declared, str) and declared.strip():
            # A scoped npm name (`@scope/pkg`) names the package, not the scope.
            return declared.strip().split("/")[-1]
    for pyproject in (workspace / "pyproject.toml",):
        if not pyproject.is_file():
            continue
        try:
            lines = pyproject.read_text().splitlines()
        except OSError:
            continue
        in_project = False
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("["):
                in_project = stripped == "[project]"
                continue
            if in_project and stripped.startswith("name"):
                _, _, value = stripped.partition("=")
                declared = value.strip().strip("\"'")
                if declared:
                    return declared
    return None


def recorded_project_name(conn: sqlite3.Connection) -> str | None:
    """The name the store records for the project, or None.

    The newest `project_profile` row decides; the import writes one from the
    onboarding report's `**Codebase**:` line. A store whose profile was never
    written but which holds that report as an import reads the name from the
    imported text, by the same rule (store-only PLAN §3.3).
    """

    if table_exists(conn, "project_profile"):
        profile = row(conn, "SELECT name FROM project_profile ORDER BY id DESC LIMIT 1")
        if profile and str(profile["name"]).strip():
            return str(profile["name"]).strip()
    for imported in imported_bodies(conn, kind="onboarding-report"):
        recorded = project_name_from_report(imported.body)
        if recorded:
            return recorded
    return None


def project_name_from_report(text: str) -> str | None:
    """`recorded_project_name` over the onboarding report's text."""

    for line in text.splitlines():
        if line.startswith("**Codebase**:"):
            recorded = line.partition(":")[2].strip().split(" — ", 1)[0].strip()
            return recorded or None
    return None


def project_name(conn: sqlite3.Connection, storage: Path) -> str:
    """The project's own name, which is the projection's primary identity.

    Amanuensis is the producing method and never the title
    (`reporting-style.md` § "Keep information architecture and interface design
    separate").

    Three sources, in the order of how deliberately each was chosen: the name
    the store records (a profile, or the imported onboarding report), the name the
    repository binding resolved, and the name the workspace's package manifest
    declares. A directory name is not among
    them at any position. A store surveyed from a second worktree, a scratch
    clone, or a temporary checkout answers with the same project name as the
    first, because none of those change the binding — and where the record
    genuinely names nothing, the page says so rather than presenting the
    checkout's folder as an identity.
    """

    recorded = recorded_project_name(conn)
    if recorded:
        return recorded
    bound = _binding_name(storage)
    if bound:
        return bound
    declared = _package_name(resolve_workspace(storage))
    if declared:
        return declared
    return UNNAMED_PROJECT


def _git_output(workspace: Path, *args: str) -> str | None:
    """One git answer from the workspace, or nothing when git cannot answer."""

    if not workspace.is_dir():
        return None
    try:
        result = subprocess.run(
            ["git", "-C", str(workspace), *args],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def ledger_freshness(conn: sqlite3.Connection) -> dict[str, int]:
    """Scoped-file counts split by survey obligation (§11.2).

    The obligation predicate is the generated one, so this reading, the
    diagrams, and `get_dashboard` cannot disagree about which classifications
    carry an obligation. `entries` is not consulted: no code path writes it, so
    every signal derived from it was a zero-denominator green (finding B03-2).
    """

    counted = row(
        conn,
        "SELECT"
        f" SUM(CASE WHEN stale=1 AND {OBLIGATION_BEARING_SQL} THEN 1 ELSE 0 END)"
        " AS stale_obligation,"
        f" SUM(CASE WHEN stale=1 AND NOT ({OBLIGATION_BEARING_SQL}) THEN 1 ELSE 0 END)"
        " AS stale_exempt,"
        f" SUM(CASE WHEN {OBLIGATION_BEARING_SQL} THEN 1 ELSE 0 END) AS obligation_files,"
        " SUM(CASE WHEN classification='examined' THEN 1 ELSE 0 END) AS examined,"
        " SUM(CASE WHEN COALESCE(classification,'candidate')='candidate' THEN 1 ELSE 0 END)"
        " AS candidate,"
        " COUNT(*) AS scoped_files"
        f" FROM file_ledger WHERE {survey_filter(conn)}",
    ) or {}
    return {
        key: int(counted.get(key) or 0)
        for key in (
            "stale_obligation",
            "stale_exempt",
            "obligation_files",
            "examined",
            "candidate",
            "scoped_files",
        )
    }


def source_alignment(conn: sqlite3.Connection, storage: Path) -> dict[str, Any]:
    """The recorded revision beside the revisions the workspace can resolve."""

    git = row(conn, "SELECT * FROM git_state WHERE repo_id='default'") or {}
    workspace = resolve_workspace(storage)
    branch = str(git.get("canonical_branch") or "")
    head = _git_output(workspace, "rev-parse", "HEAD")
    upstream_ref, upstream = _upstream_of(workspace, branch)
    return {
        "canonical_branch": branch,
        "last_checked_sha": str(git.get("last_checked_sha") or ""),
        "last_checked_at": str(git.get("last_checked_at") or ""),
        "onboarding_sha": str(git.get("onboarding_sha") or ""),
        "workspace_head": head or "",
        "upstream_ref": upstream_ref,
        # Kept under its original key; the value is now whatever ref the branch
        # actually tracks, which is what the row always meant to report.
        "origin_head": upstream or "",
        **ledger_freshness(conn),
    }


def _upstream_of(workspace: Path, branch: str) -> tuple[str, str]:
    """The remote-tracking revision of the canonical branch, and its ref name.

    `refs/remotes/origin/<branch>` is one configuration, not the shape of the
    question.  A fork tracks `upstream`, a clone made with `--origin` names the
    remote something else, and a branch may track a differently-named branch on
    it -- and in each of those the hard-coded path resolves nothing, so the
    dimension a reader consults to see whether the survey is behind says the
    revision is not known when git can name it exactly.  `@{upstream}` is
    git's own answer to the question; origin remains the fallback for a branch
    with no tracking configured.
    """

    if not branch:
        return "", ""
    configured = _git_output(workspace, "rev-parse", "--abbrev-ref", f"{branch}@{{upstream}}")
    if configured:
        resolved = _git_output(workspace, "rev-parse", "--verify", f"{branch}@{{upstream}}")
        if resolved:
            return configured, resolved
    fallback = _git_output(workspace, "rev-parse", "--verify", f"refs/remotes/origin/{branch}")
    return (f"origin/{branch}" if fallback else ""), (fallback or "")


def _stored_date(stamp: object) -> str:
    """The date of a stored timestamp: its first ten characters."""

    return str(stamp or "")[:10] or "not recorded"


def _short(sha: str) -> str:
    return f"`{sha[:12]}`" if sha else "not recorded"


def _relation(recorded: str, other: str) -> str:
    """How one revision stands to the recorded one, in words, never as a score."""

    if not other:
        return "not known here"
    if not recorded:
        return f"{_short(other)} — no checked revision is recorded to compare it with"
    if other == recorded:
        return f"{_short(other)} — the same revision the survey checked"
    return f"{_short(other)} — a different revision from the one the survey checked"


def _count(n: int, singular: str, plural: str | None = None) -> str:
    """`1 file` / `2 files`. Generated prose is read, not parsed; `file(s)` is
    a schema artifact showing through."""

    return f"{n} {singular if n == 1 else (plural or singular + 's')}"


LEDGER_NO_REASON = "No reason recorded"
LEDGER_NO_REVISION = "no revision recorded"


def _ledger_blocks(sid: str, files: Sequence[Mapping[str, object]]) -> list[Block]:
    """The file ledger as groups of rows sharing `(classification, why_in_scope)` (§2.4).

    `file_ledger.ref_sha` is set for every classification and `examined_at` only
    for examined rows, so the revision on a candidate or exempt row is the one it
    was recorded at, and only an examined row's revision is an examination.
    Groups keep the ledger's order: classification, then the group's first path.
    Each group is one item, its files a list inside it.
    """

    groups: dict[tuple[str, str], list[Mapping[str, object]]] = {}
    for f in files:
        key = (str(f["classification"] or "—"), str(f["why_in_scope"] or "").strip())
        groups.setdefault(key, []).append(f)
    items: list[ListItem] = []
    for (classification, why), members in groups.items():
        # An absent revision is not a revision: the row says it has none, and the
        # head counts only the ones recorded.
        revisions = {str(m["ref_sha"]) for m in members if m["ref_sha"]}
        label = "examined at" if classification == "examined" else "recorded at"
        if len(revisions) > 1:
            revision = f"{label} {len(revisions)} revisions"
        elif revisions:
            revision = f"{label} `{next(iter(revisions))[:8]}`"
        else:
            revision = LEDGER_NO_REVISION
        reason = " ".join(why.split()) or LEDGER_NO_REASON
        paths: list[ListItem] = []
        for m in members:
            path = str(m["file_path"])
            sha = str(m["ref_sha"] or "")
            own = (
                f" (`{sha[:8]}`)" if len(revisions) > 1 and sha else
                f" ({LEDGER_NO_REVISION})" if revisions and not sha else ""
            )
            paths.append(ListItem(inlines(f'<a id="{ledger_entry_anchor(sid, path)}"></a>`{path}`{own}')))
        items.append(
            ListItem(
                inlines(f"**{reason}** — {classification}, {_count(len(members), 'file')}, {revision}"),
                (List(False, tuple(paths)),),
            )
        )
    return [List(False, tuple(items))]


def _concern_review(dispositions: Sequence[Mapping[str, Any]], caption: str) -> RecordList:
    """The concern review as the record list the HTML prints: a record per disposition."""

    records: list[Record] = []
    for number, d in enumerate(dispositions, start=1):
        code = str(d["concern_code"])
        key_text = code or f"Record {number}"
        anchor_text = re.sub(r"^concern\s+", "", key_text)
        facts = [
            Fact(name, inlines(value))
            for name, value in (
                ("classification", str(d["classification"]).strip()),
                ("evidence quality", str(d["evidence_quality"]).strip()),
                ("linchpin?", "🔗" if d["linchpin_dependent"] else ""),
            )
            if _plain(value)
        ]
        rationale = _table_cell(d["rationale"] or "—")
        records.append(
            Record(
                markers=(),
                key=inlines(f"**{code}**"),
                key_text=key_text,
                slug_text=_plain(f"concern-disposition-{anchor_text}"),
                facts=tuple(facts),
                fields=(Fact("rationale", inlines(rationale)),) if _plain(rationale) else (),
                path=_plain(f"**{code}**"),
                record=f"disposition:{d['subsystem_id']}:{code}",
                state=str(d["classification"]),
            )
        )
    return RecordList("concern-disposition", caption, tuple(records))


def _ageing_sentence(
    workspace: Path, bound: bool, record: Mapping[str, Any], head: str
) -> str:
    """How far the files an explanation cites have moved since it was written (§3.6).

    Computed by `git diff` between the explanation's revision and the checked
    revision over the cited files, and never authored. Anything that cannot be
    measured says so; "not measured" is never rendered as "unchanged".
    """

    files = sorted({str(path) for path in record.get("cited_files") or []})
    ref_sha = str(record.get("ref_sha") or "")
    if not (
        bound
        and files
        and head
        and revision_resolves(workspace, ref_sha)
        and revision_resolves(workspace, head)
    ):
        return AGEING_NOT_MEASURED
    # `git_paths`, not `_git_output`: an empty diff is the answer "nothing moved",
    # which `_git_output` folds into "git could not answer".
    changed = git_paths(
        workspace, "diff", "--name-only", "-z", "--no-renames", ref_sha, head, "--", *files
    )
    if changed is None:
        return AGEING_NOT_MEASURED
    moved = sorted(set(changed) & set(files))
    if not moved:
        return AGEING_UNCHANGED.format(n=len(files))
    shown = ", ".join(f"`{path}`" for path in moved[:AGEING_PATH_LIMIT])
    if len(moved) > AGEING_PATH_LIMIT:
        shown += ", and others"
    return AGEING_CHANGED.format(k=len(moved), n=len(files), paths=shown)


def _provenance_line(
    workspace: Path, bound: bool, record: Mapping[str, Any], head: str
) -> str:
    return PROVENANCE_LINE.format(
        sha=str(record["ref_sha"])[:8],
        n=len(record.get("cited_files") or []),
        ageing=_ageing_sentence(workspace, bound, record, head),
    )


def _survey_row(imported: ImportedBody) -> dict[str, str]:
    """An import in the shape the survey provenance and dated line read."""

    return {
        "path": imported.path,
        "content_hash": imported.registered_hash,
        "ref_sha": imported.ref_sha,
        "written_at": imported.written_at,
    }


def _imported_blocks(
    bodies: Sequence[ImportedBody], under: int, section: str, path: str
) -> list[Block]:
    """Imported bodies as blocks: each behind its label, its headings moved under `under`.

    `section` is the title of the page section they print in, which names their
    tables' captions.
    """

    out: list[Block] = []
    for body in bodies:
        out.append(_paragraph(body.label()))
        # Its blocks carry its mark, so the read-back can find the body on the page (§3.5).
        out.append(Marked(f"imported-body:{body.path}", "", render_body(body.body, under=under, section=section, path=path)))
    return out


def narrative_body(record: Mapping[str, Any], level: int = 3) -> Marked:
    """A narrative's body (or its declination) as the blocks that carry its mark (§3.5).

    The page prints these and the read-back renders them again from the store to
    compare with what the page carries, so both read the body one way.
    """

    text, _is_body = narrative_text(record)
    mark = f"narrative:{record['id']}"
    if str(record["disposition"]) == "declined":
        sentence = NARRATIVE_DECLINED.format(
            declined=_DECLINED,
            sha=str(record["ref_sha"])[:8],
            date=_stored_date(record["recorded_at"]),
            reason=text.strip(),
        )
        return Marked(mark, "declined", tuple(render_prose(sentence)))
    return Marked(mark, "recorded", tuple(render_prose(text.strip(), under=level)))


def _narrative_blocks(
    records: Sequence[Mapping[str, Any]],
    level: int,
    workspace: Path,
    bound: bool,
    head: str,
    warn: Callable[[str], None] | None,
    *,
    untitled: bool = True,
) -> list[Block]:
    """Stored narratives as blocks, each under its topic at heading `level`.

    A narrative with no topic prints under
    its section's label; with `untitled` false it prints under whatever heading
    already names its section. A text the orientation lint refuses is replaced by
    the refusal sentence and reported through `warn`. The body is stored prose,
    read in the §3.4 grammar.
    """

    out: list[Block] = []
    for record in records:
        text, is_body = narrative_text(record)
        if not is_body and warn is not None:
            warn(
                f"{record['subject_id']}: the recorded {record['section']} narrative was not"
                " published because it carries survey-status vocabulary or a count fraction"
            )
        if untitled or str(record["topic"]).strip():
            out.append(_heading(level, _one_line(narrative_heading(record))))
        date = _stored_date(record["recorded_at"])
        sha = str(record["ref_sha"])[:8]
        out.append(narrative_body(record, level))
        if str(record["disposition"]) == "declined" or not is_body:
            continue
        files = record.get("cited_files") or []
        out.append(
            _paragraph(
                NARRATIVE_PROVENANCE.format(
                    date=date,
                    sha=sha,
                    n=len(files),
                    ageing=_ageing_sentence(workspace, bound, record, head),
                )
                if files
                else NARRATIVE_NO_FILES.format(date=date, sha=sha)
            )
        )
    return out


def _narrative_source(name: str, head: str, records: Sequence[Mapping[str, Any]]) -> dict[str, str]:
    """The manifest source for the narratives a page printed.

    The effective rows with their cited files, and the checked revision their
    ageing line is measured against, so a new row, a withdrawal or a moved
    head re-renders the page.
    """

    return _db_source(name, {"head": head, "rows": list(records)})


def _record_page_sources(conn: sqlite3.Connection, kind: str) -> dict[str, Any]:
    """What the generated part of one of the three project pages reads."""

    if kind == "concern-checklist":
        return {
            "concerns": checklist_concerns(conn),
            "territories": effective_territory_dispositions(conn),
        }
    return {}


def _project_narratives(
    conn: sqlite3.Connection, storage: Path, kind: str
) -> list[dict[str, Any]]:
    """The project narratives the page for `kind` prints, in the contract's section order."""

    page = {
        "onboarding-report": "onboarding-report.html",
        "entry-point": "entry-point.html",
    }.get(kind)
    if page is None:
        return []
    order = list(NARRATIVE_LABELS)
    chosen = [
        record
        for record in effective_narratives(conn, storage, "project")
        if record["subject_type"] == "project" and PROJECT_NARRATIVE_PAGES.get(record["section"]) == page
    ]
    return sorted(chosen, key=lambda r: (order.index(str(r["section"])), int(r["first_id"])))


def _flat_cell(text: Any) -> str:
    """An authored value as one line, its pipes kept: a table cell as the page prints it."""

    return " ".join(str(text).split())


def _checklist_blocks(
    concerns: Sequence[Mapping[str, Any]], territories: Sequence[Mapping[str, Any]]
) -> list[Block]:
    out: list[Block] = []
    if concerns:
        groups: dict[tuple[str, str], list[Mapping[str, Any]]] = {}
        for c in concerns:
            category = _plain(_table_cell(c["category"] or "—"))
            territory = _plain(_flat_cell(territory_label(c["territory"]) or "—"))
            groups.setdefault((category, territory), []).append(c)
        families: list[ConcernFamily] = []
        for (category, territory), members in groups.items():
            name = category.replace("-", " ").capitalize()
            items: list[ConcernItem] = []
            for number, c in enumerate(members, start=1):
                code = f"**{c['code']}**"
                code_text = _plain(code) or f"Concern {number}"
                where = ", ".join(f"**{sid}**" for sid in c["subsystems"]) or "—"
                items.append(
                    ConcernItem(
                        code=inlines(code),
                        code_text=code_text,
                        slug_text=_plain(f"concern-checklist-{code_text}"),
                        primary_subsystems=inlines(where),
                        probe=inlines(_flat_cell(c["probe"] or "—")),
                    )
                )
            families.append(ConcernFamily(name, territory, _plain(f"{name} concerns"), tuple(items)))
        out.append(
            _section(
                "Concerns",
                _paragraph(
                    "Each concern the survey checks, the kind of territory it came from, and"
                    " the probe that tests it in this codebase."
                ),
                ConcernChecklist(_caption("Concerns"), tuple(families)),
            )
        )
    if territories:
        out.append(
            _section(
                "Territories",
                _paragraph(
                    "Whether each kind of territory applies to this project. A territory that"
                    " does not apply names the condition that rules it out."
                ),
                _marked_rows(
                    _table(
                        _caption("Territories"),
                        ("Territory", "Disposition", "Condition"),
                        [
                            [
                                _flat_cell(territory_label(t["territory"])),
                                str(t["disposition"]),
                                _flat_cell(t["condition"] or "—"),
                            ]
                            for t in territories
                        ],
                    ),
                    [(f"territory:{t['territory']}", str(t["disposition"])) for t in territories],
                ),
            )
        )
    return out


def record_page_exists(conn: sqlite3.Connection, storage: Path, kind: str) -> bool:
    """Whether the page for `kind` has anything to print: a record or an unwithdrawn import."""

    if imported_bodies(conn, kind=kind):
        return True
    if kind == "concern-checklist":
        return bool(checklist_concerns(conn) or effective_territory_dispositions(conn))
    return bool(_project_narratives(conn, storage, kind))


def record_page_imports_only(conn: sqlite3.Connection, storage: Path, kind: str) -> bool:
    """Whether the record page of `kind` prints only its imports, as `imported_page` does."""

    extra = _record_page_sources(conn, kind)
    return not (
        _project_narratives(conn, storage, kind) or extra.get("concerns") or extra.get("territories")
    )


def record_page(
    conn: sqlite3.Connection,
    storage: Path,
    kind: str,
    title: str,
    warn: Callable[[str], None] | None = None,
) -> RenderResult | None:
    """Onboarding record, Review checklist or Where to begin, from the store.

    The records come first, each section under its own heading; what an earlier
    version wrote by hand follows under "As written at onboarding" with its label
    (D1). A store with only an import prints that page as `imported_page` does,
    so an import-only publication is unchanged.
    """

    bodies = imported_bodies(conn, kind=kind)
    narratives = _project_narratives(conn, storage, kind)
    extra = _record_page_sources(conn, kind)
    concerns, territories = extra.get("concerns", []), extra.get("territories", [])
    path = f"{kind}.html"
    if not (narratives or concerns or territories):
        return imported_page(conn, kind, title, path)
    workspace = resolve_workspace(storage)
    bound = workspace_is_bound(workspace)
    head = _checked_head(conn)
    blocks: list[Block] = []
    section: str | None = None
    held: list[Block] = []
    for record in narratives:
        if record["section"] != section:
            if section is not None:
                blocks.append(_section(NARRATIVE_LABELS.get(section, section), *held))
            section = str(record["section"])
            held = []
        held += _narrative_blocks([record], 3, workspace, bound, head, warn, untitled=False)
    if section is not None:
        blocks.append(_section(NARRATIVE_LABELS.get(section, section), *held))
    blocks += _checklist_blocks(concerns, territories)
    if bodies:
        blocks.append(_section(AS_WRITTEN_HEADING, *_imported_blocks(bodies, 2, AS_WRITTEN_HEADING, path)))
    sources = (
        _narrative_source(f"narratives:{kind}", head, narratives)
        | _db_source(f"checklist:{kind}", extra)
        | imports_source(f"imports:{kind}", bodies)
    )
    return Page(title, path, tuple(blocks)), sources


def _survey_notes_line(artifact: Mapping[str, Any], account: Mapping[str, Any]) -> str:
    """The italic line that dates a survey artifact against the recorded account.

    The artifact is working notes kept as written; the account is the later
    reading. Dates are the first ten characters of the stored timestamps.
    """

    return (
        f"*Written on {_stored_date(artifact['written_at'])} at revision"
        f" {str(artifact['ref_sha'] or '')[:8] or 'not recorded'} as the survey's working"
        " notes, and kept as written. The account above was recorded on"
        f" {_stored_date(account.get('recorded_at'))} at revision"
        f" {str(account['ref_sha'] or '')[:8] or 'not recorded'}; where the two disagree,"
        " the later one is the current reading.*"
    )


def explanation_body(
    subject_type: str,
    subject_id: str,
    slot: str,
    reading: ExplanationReading,
    warn: Callable[[str], None] | None = None,
) -> tuple[Marked, bool] | None:
    """An effective explanation's printed body, marked with its row, and whether it is the body.

    A subsystem's purpose (recorded or declined) and account (recorded), and the
    project's account (recorded or declined), print here; anything else is not a
    body a page prints and is None. The page and the read-back both build it here
    (§3.5).
    """

    row = reading.row
    project = subject_type == "project"
    if row is None or reading.state not in ("recorded", "declined"):
        return None
    if project and slot != "account":
        return None  # the project's purpose is the overview's thesis, read on its own
    if not project and slot == "account" and reading.state == "declined":
        return None  # a declined account prints one sentence under the survey record
    text, is_body = _published_explanation(
        subject_id if not project else "project", slot, str(row["body"]), warn
    )
    sha = str(row["ref_sha"])[:8]
    if reading.state == "recorded":
        blocks = render_prose(text.strip()) if project else render_prose(text.strip(), under=2)
    elif project:
        blocks = (_paragraph(PROJECT_ACCOUNT_DECLINED.format(sha=sha, reason=text.strip())),)
    else:
        blocks = render_prose(PURPOSE_DECLINED.format(sha=sha, reason=text.strip()))
    return Marked(f"explanation:{row['id']}", reading.state, tuple(blocks)), is_body


def _published_explanation(
    sid: str, slot: str, body: str, warn: Callable[[str], None] | None
) -> tuple[str, bool]:
    """The text to print for a recorded body or declination reason, and whether it is the body.

    The orientation lint decides (§3.6). A refused text is replaced by the
    refusal sentence and reported through `warn`, which fails the publish, so
    survey-status vocabulary cannot reach a page through a slot a session wrote.
    """

    violations = orientation_violations(body)
    if not violations:
        return body, True
    if warn is not None:
        warn(f"{sid}: the recorded {slot} was not published because it " + "; ".join(violations))
    return explanation_refusal(slot), False


def _db_source(name: str, data: Any) -> dict[str, str]:
    return {f"db:{name}": sha256_json(data)}


# ---------------------------------------------------------------------------
# Where an explanation is read beside the page that owns it (§3.7)
# ---------------------------------------------------------------------------

_UNRECORDED = ExplanationReading("not-recorded", None, False)


def _reading(
    readings: Mapping[tuple[str, str, str], ExplanationReading],
    subject_type: str,
    subject_id: str,
    slot: str,
) -> ExplanationReading:
    """One slot's reading. The pages and the census both ask it, so they cannot disagree.

    A subject with no row is absent from the mapping and reads `not-recorded`;
    an ineligible subsystem already reads that way whatever rows it holds
    (`effective_explanations`).
    """

    return readings.get((subject_type, subject_id, slot), _UNRECORDED)


def _excerpt(
    sid: str, reading: ExplanationReading, warn: Callable[[str], None] | None
) -> str:
    """A subsystem's purpose as one line, or the state's label (§3.7).

    An excerpt carries no provenance line: the subsystem page whose `## Purpose`
    section does is linked by the id beside it. A purpose the orientation lint
    refuses is replaced by the refusal sentence, as on that page.
    """

    if reading.state == "recorded" and reading.row is not None:
        text, _is_body = _published_explanation(sid, "purpose", str(reading.row["body"]), warn)
        return _one_line(text)
    return _DISCHARGE_LABELS.get(reading.state, reading.state)


def recorded_purposes(conn: sqlite3.Connection, storage: Path) -> dict[str, str]:
    """Each subsystem's recorded, lint-clean purpose, for a hover definition (§3.7).

    A purpose the lint refuses is left out, so hover text falls back to the name
    alone; the subsystem page reports the refusal.
    """

    out: dict[str, str] = {}
    for (subject_type, sid, slot), reading in effective_explanations(conn, storage).items():
        if subject_type != "subsystem" or slot != "purpose":
            continue
        if reading.state != "recorded" or reading.row is None:
            continue
        body = str(reading.row["body"])
        if not orientation_violations(body):
            out[sid] = body
    return out


def _checked_head(conn: sqlite3.Connection) -> str:
    return str(
        (row(conn, "SELECT last_checked_sha FROM git_state WHERE repo_id='default'") or {}).get(
            "last_checked_sha"
        )
        or ""
    )


# ---------------------------------------------------------------------------
# The honest empty state, and where a record that is not a finding lives
# ---------------------------------------------------------------------------

# §6.1 partitions contradictions by whether the evidence settled them, exactly
# as `finding_state_current` partitions findings. The page a contradiction's
# record renders on is read from that one predicate, so the record, the
# timeline that links to it, and the reader all agree about where it is.
DISAGREEMENTS_PAGE = "disagreements.html"
CONTRADICTIONS_PAGE = "contradictions.html"


def contradiction_page(resolution: str | None) -> str:
    """The page one contradiction's full record renders on (§6.1, §7.1)."""

    return (
        CONTRADICTIONS_PAGE
        if resolution and resolution != "unresolved"
        else DISAGREEMENTS_PAGE
    )


def contradiction_anchor(contradiction_id: Any) -> str:
    return f"contradiction-{contradiction_id}"


def question_anchor(question_id: Any) -> str:
    return f"question-{question_id}"


def lead_anchor(note_id: Any) -> str:
    return f"lead-{note_id}"


def checked_revision(conn: sqlite3.Connection) -> str:
    """The revision the survey last checked, in words, or that none is recorded."""

    git = row(conn, "SELECT * FROM git_state WHERE repo_id='default'") or {}
    checked = str(git.get("last_checked_sha") or "")
    if not checked:
        return "not recorded"
    branch = str(git.get("canonical_branch") or "not recorded")
    at = str(git.get("last_checked_at") or "")
    return f"{_short(checked)} on `{branch}`" + (
        f", recorded {_fmt_time(at)}" if at else ""
    )


def _empty_lens_blocks(
    conn: sqlite3.Connection, nothing: str, scope: str, basis: str
) -> list[Block]:
    """What a lens page with no rows says instead of "none" (§6.1, C28).

    An empty page is the one place a reader cannot check the record against
    itself. *No open findings* alone is indistinguishable from a survey that
    never ran, from one whose store was never written to, and from one whose
    predicate is wrong. So the page states what it would have carried, which
    records it read, and the revision it read them at, and the absence becomes
    a reading rather than a silence.
    """

    return [
        _paragraph(nothing),
        _bullets(
            [
                f"**Scope** — {scope}",
                f"**Basis** — {basis}",
                f"**Checked revision** — {checked_revision(conn)}.",
            ]
        ),
    ]


# ---------------------------------------------------------------------------
# Index / dashboard / architecture
# ---------------------------------------------------------------------------


# Appendix C, "Overview identity". The project is the subject and Amanuensis the
# method; the sentence carries no digit and none of the orientation lint's terms,
# and ends by sending a new reader to the guide.
OVERVIEW_IDENTITY = (
    "An architecture survey of {name}. An AI agent running Amanuensis read the"
    " repository, without changing it, and recorded what it found here. New to this"
    " site? Start with [{guide}](how-to-read.html)."
)

# The read-back is recorded after the pages are written, so the overview can only
# show the publication before it. No digit and neither "red" nor "green": the
# overview's truthfulness gate counts those words in this block.
PUBLICATION_INTEGRITY_LAG = (
    "A publication's read-back is recorded after its pages are written, so these"
    " results describe the publication before this one."
)


def outside_survey_sentence(conn: sqlite3.Connection) -> str | None:
    """The overview's one line on what the survey leaves out, or None when nothing is excluded.

    Counts by source, and the owner's exclude rules by pattern; never a path
    (design/scope/PLAN.md §2.8, decision F2). Every recorded exclusion counts,
    as `get_dashboard`'s `excluded_paths` does: a ledgered path the tree no
    longer carries stays excluded so its row stays inactive (§2.6a).
    """

    excluded = survey_exclusions(conn)
    if not excluded:
        return None
    counts = {source: sum(1 for r in excluded if r["source"] == source) for source in ("gitignore", "user", "meta")}
    # The patterns of the rules behind the counted `user` exclusions, so a rule
    # that excluded nothing (an include of the same pattern overrides it) is not named.
    deciding = {r["rule_id"] for r in excluded if r["source"] == "user" and r["rule_id"] is not None}
    patterns = owner_exclude_patterns(conn, deciding)
    owner = f"{counts['user']} the owner excluded" + (
        " (" + ", ".join(f"`{pattern}`" for pattern in patterns) + ")" if patterns else ""
    )
    return (
        f"Outside this survey: {_count(counts['gitignore'], 'path')} ignored by git, {owner},"
        f" {counts['meta']} sorted as meta."
    )


def _outside_survey_line(conn: sqlite3.Connection) -> list[Block]:
    sentence = outside_survey_sentence(conn)
    return [] if sentence is None else [_paragraph(sentence)]


def render_index(
    conn: sqlite3.Connection,
    storage: Path,
    warn: Callable[[str], None] | None = None,
) -> RenderResult:
    """The Overview: the entrance to the four lenses, and not a lens (§7.2).

    Five items, first in source order with nothing between them: identity, the
    thesis taken by heading, four separately named status dimensions, one linked
    count per resolution state, and one route into each lens. The dimensions are
    never combined: a single number would let a green publication read as a read
    repository, and there is no arithmetic that turns four different kinds of
    ignorance into one (BP26).

    `warn` receives one message per orientation-lint failure so the publish can
    turn red on it; the thesis slot then carries the refusal rather than the
    prose (§11.1).
    """

    name = project_name(conn, storage)
    thesis = project_thesis(conn, storage)
    if thesis.violations and warn is not None:
        warn(
            f"{thesis.source}: the recorded thesis was not published because it "
            + "; ".join(thesis.violations)
        )

    alignment = source_alignment(conn, storage)
    checked = alignment["last_checked_sha"]
    branch = alignment["canonical_branch"] or "not recorded"
    obligation = int(alignment["obligation_files"])
    stale_obligation = int(alignment["stale_obligation"])
    stale_exempt = int(alignment["stale_exempt"])
    scoped = int(alignment["scoped_files"])

    subs = rows(conn, "SELECT id, name, status, layer FROM subsystems ORDER BY id")
    ladder = {
        status: sum(1 for s in subs if (s["status"] or "unmapped") == status)
        for status in values_of("subsystem_status")
    }
    depth = ", ".join(f"{count} {status}" for status, count in ladder.items() if count)
    # §3.4: both coverage figures are read from the standing reconciliation, not
    # from the ledger they measure and not from `scope_gaps`, which an
    # unreconciled store leaves empty and which is then indistinguishable from
    # a reconciliation that found nothing (finding B03-5, VP4(e)).
    standing = reconciliation_standing(conn, storage)
    unmeasured = _unmeasured(standing)
    examined_tracked = int(
        (
            row(
                conn,
                "SELECT COUNT(*) AS n FROM (SELECT DISTINCT file_path FROM file_ledger"
                " WHERE classification='examined' AND file_path NOT IN"
                " (SELECT file_path FROM scope_gaps WHERE kind='absent')"
                f" AND {survey_filter(conn)})",
            )
            or {"n": 0}
        )["n"]
        or 0
    )
    carried = carried_records(conn)
    undecided_carried = sum(
        1 for record in carried if str(record["outcome"]) == CARRIED_UNDECIDED
    )

    state_counts = {
        str(r["resolution_state"]): int(r["n"] or 0)
        for r in rows(
            conn,
            "SELECT resolution_state, COUNT(*) AS n FROM finding_state_current"
            " GROUP BY resolution_state",
        )
    }
    unresolved = row(
        conn,
        "SELECT COUNT(*) AS n FROM contradictions"
        " WHERE COALESCE(resolution,'unresolved')='unresolved'",
    ) or {"n": 0}
    decisions = row(
        conn,
        "SELECT COUNT(*) AS n FROM open_questions WHERE COALESCE(resolution,'open')='open'",
    ) or {"n": 0}

    verification = row(
        conn,
        "SELECT * FROM projection_verification_runs"
        " ORDER BY verified_at DESC, rowid DESC LIMIT 1",
    )

    latest_session = row(
        conn,
        "SELECT intent, started_at, ended_at FROM sessions ORDER BY started_at DESC LIMIT 1",
    )

    # 1. Identity.  The project is the subject; Amanuensis is the method that
    #    recorded it (`reporting-style.md`).
    alignment_pairs = [
        (
            "Checked at",
            f"{_short(checked)} on `{branch}`"
            + (
                f", {_fmt_time(alignment['last_checked_at'])}"
                if alignment["last_checked_at"]
                else ""
            ),
        ),
        ("Repository head", _relation(checked, alignment["workspace_head"])),
        (
            # The row is named for the question, not for one remote. Which
            # ref answered it belongs in the value, where it is a fact about
            # this workspace rather than a heading that changes shape.
            "Upstream head",
            _relation(checked, alignment["origin_head"])
            + (f" (`{alignment['upstream_ref']}`)" if alignment.get("upstream_ref") else ""),
        ),
        (
            # §11.2 measures freshness on `scoped_files`, never on the
            # obligation count. A ledger whose scoped rows all happen to be
            # exempt has been read exactly, and saying it was not measured
            # would hide a real reading behind the sentence reserved for
            # having no ledger at all -- and put this row at odds with the
            # HTML strip, which reads `scoped_files` on the same store.
            "Files carrying a survey obligation marked stale",
            f"{stale_obligation} of {obligation}"
            if obligation
            else (
                "none of the scoped files carries a survey obligation"
                if scoped
                else "not measured by this projection"
            ),
        ),
        (
            "Scoped files exempt from that obligation, marked stale",
            f"{stale_exempt} of {scoped - obligation}"
            if scoped > obligation
            else "none in scope",
        ),
    ]
    # 3. Four status dimensions, each a separate named fact.
    if not standing.stands:
        files_read = unmeasured
    elif standing.obligation_paths:
        # §1.2's D3 of D2, both over the tracked paths at the reconciled
        # revision. Counting `examined` ledger *rows* against tracked *paths*
        # would put two units either side of one fraction, and a path two
        # subsystems both examined would count twice in the numerator.
        files_read = f"{examined_tracked} of {standing.obligation_paths}"
    else:
        files_read = "no tracked path carries a survey obligation"
    caption = _caption("Where the record stands")
    coverage_summary = _summary(
        caption,
        [
            (
                "Subsystems by survey depth",
                depth if depth else "no subsystem is registered",
            ),
            (COVERAGE_ROW_FILES_READ, files_read),
            (
                COVERAGE_ROW_UNLEDGERED,
                unmeasured if not standing.stands else str(standing.unledgered),
            ),
        ],
    )
    # A defect this store confirmed and a defect it inherited and has not looked
    # at are different facts, so the carried count is its own row and is never
    # summed into `Findings open` (§5.6). The row is published when a carry is
    # on record and omitted when none is: a store nobody ran a carry against
    # has no carried obligations to report, and printing `0` would say a carry
    # found nothing (§5.2, VP4(e)).
    work: list[tuple[str, str]] = [("Findings open", str(state_counts.get("open", 0)))]
    if carry_was_run(conn):
        work.append((COVERAGE_ROW_CARRIED, str(undecided_carried)))
    work += [
        (
            "Repairs awaiting verification",
            str(state_counts.get("fixed-pending-verification", 0)),
        ),
        ("Contradictions unresolved", str(unresolved["n"] or 0)),
        ("Decisions open", str(decisions["n"] or 0)),
    ]
    if verification:
        integrity: tuple[Block, ...] = (
            _paragraph(PUBLICATION_INTEGRITY_LAG),
            _summary(
                caption,
                [
                    *(
                        (
                            f"{axis.title()} axis",
                            "green" if int(verification[f"{axis}_ok"] or 0) else "red",
                        )
                        for axis in ("state", "coverage", "content")
                    ),
                    ("Read back at", _fmt_time(str(verification["verified_at"]))),
                ],
            ),
        )
    else:
        integrity = (
            _paragraph(
                "No publication read-back is recorded for this store, so none of the"
                " three axes has a result to report."
            ),
        )

    blocks: list[Block] = [
        _paragraph(OVERVIEW_IDENTITY.format(name=name, guide=GUIDE_TITLE)),
        # 2. Thesis — the project purpose, else by heading from entry-point.md,
        #    or the named instruction.
        _section("What is this codebase?", *thesis_blocks(thesis)),
        _section(
            "Where the record stands",
            _heading(3, "Source alignment"),
            _summary(caption, alignment_pairs),
            _heading(3, "Survey coverage"),
            coverage_summary,
            *_outside_survey_line(conn),
            _heading(3, "Open engineering work"),
            _summary(caption, work),
            _heading(3, "Publication integrity"),
            *integrity,
        ),
        # 4. One linked count per resolution state, generated from the enum source so
        #    the line cannot drift from the enum (§7.2 step 4, §10).
        _section(
            "Findings by resolution state",
            _summary(
                _caption("Findings by resolution state"),
                [
                    (
                        f"[{RESOLUTION_LABELS.get(state, state)}]({finding_page(state)})",
                        str(state_counts.get(state, 0)),
                    )
                    for state in values_of("finding_resolution_state")
                ],
            ),
        ),
        # 5. One route into each lens (§1.1, §7.1).
        _section(
            "The four lenses",
            _bullets(
                [
                    "**Codebase** — [Subsystem map](master-plan.html): every region, grouped by"
                    " layer, with the boundaries and terms recorded for it.",
                    "**Unresolved** — [Open findings](findings.html): defects open or awaiting"
                    " verification at the checked revision.",
                    "**History** — [Resolved findings](resolved-findings.html): the records that"
                    " reached a terminal state, with the basis each one rests on.",
                    f"**Method** — [{GUIDE_TITLE}](how-to-read.html): what each page is for,"
                    " the terms it uses, and how a survey works.",
                ]
            ),
        ),
    ]
    if latest_session:
        blocks.append(
            _section(
                "Latest session",
                _paragraph(
                    f"`{latest_session['intent']}` — started {_fmt_time(latest_session['started_at'])}"
                    + (
                        f" · ended {_fmt_time(latest_session['ended_at'])}"
                        if latest_session["ended_at"]
                        else " · **active**"
                    )
                ),
            )
        )

    page = Page(name, "index.html", tuple(blocks))
    # Over the page as published, not over the thesis alone. C32's rule is about
    # what the overview carries, so a renderer that grows a composite row is the
    # same violation as a session that writes one into `entry-point.md`, and
    # only a lint over the rendered words sees both. Until slice-S7 this check
    # lived in the packet's gate, where it could report on a publish it could
    # not stop (F5/codex).
    if warn is not None:
        for message in composite_index_violations(page_text(page)):
            warn(f"index.html: the overview may not publish a composite index — {message}")

    sources = {
        **_db_source("index:alignment", alignment),
        **_db_source("index:subs", subs),
        **_db_source("index:states", state_counts),
        **_db_source("index:reconciliation", standing.record or {"why": standing.why}),
        **_db_source("index:carried", carried),
        **_db_source("index:unresolved", unresolved),
        **_db_source("index:decisions", decisions),
        **_db_source("index:verification", verification or {}),
        **_db_source("index:session", latest_session or {}),
        **_db_source("index:identity", {"project_name": name}),
        **_db_source("index:purpose", {"state": thesis.state, "text": thesis.text}),
    }
    return page, sources


def render_architecture(
    conn: sqlite3.Connection,
    storage: Path,
    warn: Callable[[str], None] | None = None,
) -> RenderResult:
    xrefs = rows(conn, "SELECT * FROM xrefs ORDER BY from_id")
    subs = rows(conn, "SELECT id, name, status FROM subsystems ORDER BY id")
    seams = rows(conn, "SELECT id, shared_object, party_a, party_b FROM seams ORDER BY id")
    # Heading and body come from one call. They were two reads of `xrefs` in two
    # modules, so a change to either predicate could head an atlas "Subsystem
    # dependency graph" — a page asserting edges no row records (§9.2). The
    # `xrefs` rows above stay for the manifest source hash only.
    dependency_heading, dependency_body = dependency_section(conn, _caption)

    # §3.7: the project account and a line per subsystem open the page. Read by
    # the function the subsystem pages and the read-back read.
    readings = effective_explanations(conn, storage)
    account = _reading(readings, "project", "project", "account")
    head = _checked_head(conn)
    workspace = resolve_workspace(storage)
    bound = workspace_is_bound(workspace)
    fit: list[Block] = []
    printed = explanation_body("project", "project", "account", account, warn)
    if printed is not None and account.row is not None:
        body, is_body = printed
        fit.append(body)
        if is_body and account.state == "recorded":
            fit.append(_paragraph(_provenance_line(workspace, bound, account.row, head)))
    else:
        fit.append(_paragraph(PROJECT_ACCOUNT_ABSENT))
    lines = []
    for s in subs:
        sid = str(s["id"])
        excerpt = _excerpt(sid, _reading(readings, "subsystem", sid, "purpose"), warn)
        lines.append(f"**{sid} — {_one_line(s['name'])}**: {excerpt}")
    if lines:
        fit.append(_bullets(lines))
    explanations = explanation_rows(conn)

    blocks: tuple[Block, ...] = (
        _section(ARCHITECTURE_FIT_HEADING, *fit),
        _section(
            "Runtime boundary map",
            *runtime_boundary_blocks(conn, _caption("Runtime boundary map")),
        ),
        _section(dependency_heading, *dependency_body),
        # §2.5 item 2: the HTML draws this section's table as the boundary SVG.
        _section(BOUNDARY_HEADING, *boundary_blocks(conn, _caption(BOUNDARY_HEADING))),
        _section("Seam topology", *seam_blocks(conn, _caption("Seam topology"))),
        _section("Staleness map", *staleness_blocks(conn)),
    )
    sources = {
        **_db_source("arch:xrefs", xrefs),
        **_db_source("arch:subs", subs),
        **_db_source("arch:seams", seams),
        **_db_source("arch:explanations", {"head": head, "rows": explanations}),
        **_db_source("arch:runtime", runtime_boundary_rows(conn)),
    }
    return Page("Architecture", "architecture.html", blocks), sources


# ---------------------------------------------------------------------------
# Master plan & subsystems
# ---------------------------------------------------------------------------


def render_master_plan(
    conn: sqlite3.Connection,
    storage: Path,
    warn: Callable[[str], None] | None = None,
) -> RenderResult:
    # Attempt a priority-aware query; fall back to the legacy shape on a
    # pre-migration DB where the column doesn't exist yet.
    try:
        subs = rows(
            conn,
            "SELECT id, name, status, layer, scope, jump_in_reading, notes, priority "
            "FROM subsystems ORDER BY layer, CASE WHEN priority IS NULL THEN 1 ELSE 0 END, priority, id",
        )
    except sqlite3.OperationalError:
        subs = rows(
            conn,
            "SELECT id, name, status, layer, scope, jump_in_reading, notes FROM subsystems "
            "ORDER BY layer, id",
        )
        for s in subs:
            s["priority"] = None
    # One predicate for one question. This roll-up read `findings.status`
    # while every lens read `finding_state_current`, so the master plan called
    # a repaired finding open after the subsystem page had closed it
    # (F9/codex). Both now select the same generated predicate over the view,
    # which also carries the legacy-status fallback for a finding recorded
    # before the resolution event log existed.
    finds = rows(
        conn,
        "SELECT subsystem_id, COUNT(*) AS n,"
        f" SUM(CASE WHEN {OPEN_FINDING_SQL} THEN 1 ELSE 0 END) AS open_bugs"
        " FROM finding_state_current GROUP BY subsystem_id",
    )
    finds_by_ss = {f["subsystem_id"]: f for f in finds}
    readings = effective_explanations(conn, storage)

    blocks: list[Block] = []
    if not subs:
        blocks.append(_paragraph("_No subsystems registered yet. Run the Amanuensis coordinator to onboard._"))
    else:
        # Group by layer.
        layers: dict[str, list[dict[str, Any]]] = {}
        for s in subs:
            layers.setdefault(s["layer"] or "unlayered", []).append(s)
        # The atlas comes first and always has one row per subsystem, whether or
        # not any edge is recorded (§2.5): the HTML turns it into the region cards
        # the architecture page already uses. The depth is the contract's label,
        # never the stored value. It opens the page before any section, so the
        # page's own title is its caption.
        depth_labels = labels("subsystem_status")
        badges = finding_badges(conn)
        regions: dict[str, list[AtlasItem]] = {}
        for layer, items in layers.items():
            for s in items:
                regions.setdefault(_plain(_table_cell(layer)) or "Other", []).append(
                    AtlasItem(
                        inlines(f"**[{s['id']}]({subsystem_page(str(s['id']), str(s['name']))})** {_table_cell(s['name'])}"),
                        depth_cell(_table_cell(depth_labels.get(s["status"], s["status"]))),
                        record=f"subsystem:{s['id']}",
                        state=str(s["status"]),
                        badges=badges.get(str(s["id"]), ()),
                    )
                )
        blocks.append(
            Atlas("Subsystem map", tuple(AtlasRegion(name, tuple(items)) for name, items in regions.items()))
        )
        blocks.extend(badge_note(conn, badges))
        for layer, items in layers.items():
            records: list[Record] = []
            for number, s in enumerate(items, start=1):
                f = finds_by_ss.get(s["id"], {"n": 0, "open_bugs": 0})
                sid = str(s["id"])
                priority = "—" if s.get("priority") is None else str(s["priority"])
                key_text = _plain(str(s["name"])) or f"Record {number}"
                cells: list[tuple[str, Inlines]] = [
                    ("id", Inlines((Strong((Text(sid),)),), sid)),
                    ("status", _status_cell(str(s["status"]))),
                    ("findings", inlines(f"{f['n']} ({f.get('open_bugs', 0)} open)")),
                    ("priority", inlines(priority)),
                    (
                        "purpose",
                        inlines(_table_cell(_excerpt(sid, _reading(readings, "subsystem", sid, "purpose"), warn))),
                    ),
                    ("scope", inlines(_table_cell(s["scope"] or "—"))),
                    ("jump-in", inlines(_table_cell(s["jump_in_reading"] or "—"))),
                ]
                # A fact or field with nothing to print is left out, as the table's reader left it.
                facts = [Fact(key, value) for key, value in cells[:4] if value.plain]
                fields = [Fact(key, value) for key, value in cells[4:] if value.plain]
                records.append(
                    Record(
                        markers=(),
                        key=inlines(str(s["name"])),
                        key_text=key_text,
                        slug_text=_plain(f"subsystem-{key_text}"),
                        facts=tuple(facts),
                        fields=tuple(fields),
                        path=_plain(str(s["name"])),
                        subsystem_id=sid,
                        record=f"subsystem:{sid}",
                        state=str(s["status"]),
                    )
                )
            blocks.append(_section(layer, RecordList("subsystem", _caption(layer), tuple(records))))
    return (
        Page("Subsystem map", "master-plan.html", tuple(blocks)),
        _db_source("master-plan:subs", subs)
        | _db_source("master-plan:finds", finds)
        | _db_source("master-plan:explanations", explanation_rows(conn)),
    )


def subsystem_claims(conn: sqlite3.Connection, sid: str) -> list[dict[str, Any]]:
    """The current claims a subsystem's page prints: about it, keyed under it, or citing its files.

    The page and the read-back's census both ask this function (§3.5).
    """

    return rows(
        conn,
        """
        SELECT c.claim_id, c.claim_key, c.subject_type, c.subject_id, c.statement,
               c.epistemic_kind, c.asserted_at_sha
          FROM claims c
         WHERE c.valid_until_sha IS NULL
           AND (c.subject_id = ?
                OR c.claim_key LIKE ? ESCAPE '\\'
                OR EXISTS (SELECT 1
                             FROM claim_evidence ce
                             JOIN evidence e ON e.id = ce.evidence_id
                            WHERE ce.claim_id = c.claim_id
                              AND e.file_path IN (SELECT file_path FROM file_ledger
                                                   WHERE subsystem_id = ?)))
         ORDER BY c.claim_key
        """,
        (sid, _like_prefix(sid), sid),
    )


def render_subsystem(
    conn: sqlite3.Connection,
    storage: Path,
    s: dict[str, Any],
    warn: Callable[[str], None] | None = None,
) -> RenderResult:
    """One subsystem, in §7.3's order.

    What changed and why: the scope statement leads under its own **Scope**
    heading and is never relabelled Purpose. `schema.sql:675` documents
    `subsystems.scope` as free-text key files, directories, and symbols, and
    the stores hold exactly that — `crates/axiomdb-core/src/write/coordinator.rs
    (4008 lines)` is not a purpose sentence, and calling it one would invent a
    durable field nobody wrote. A subsystem with no scope recorded says so.

    The survey record — the file ledger, the concern review, the adversarial
    notes, the survey artifact — moves last. It is apparatus: how the reading
    was produced, subordinate to what was read (`reporting-style.md`). Known
    defects link to the page their resolution state selects and carry no
    durable marker, because a finding renders as a full record exactly once
    (§6.2).

    A recorded or declined purpose leads the page and a recorded account follows
    Start here (§3.6); both come from the effective explanation, and neither
    heading renders without one. `warn` receives each orientation-lint refusal
    so the publish can turn red on it.
    """

    sid = s["id"]
    files = rows(
        conn,
        "SELECT file_path, why_in_scope, classification, ref_sha, stale, stale_reason"
        f" FROM file_ledger WHERE subsystem_id = ? AND {survey_filter(conn)}"
        " ORDER BY classification, file_path",
        (sid,),
    )
    dispositions = rows(
        conn,
        """
        SELECT d.*, c.category, c.status AS concern_status
        FROM dispositions d JOIN concerns c ON c.code = d.concern_code
        WHERE d.subsystem_id = ?
        ORDER BY d.concern_code
        """,
        (sid,),
    )
    findings = rows(
        conn,
        "SELECT f.finding_id, f.severity, f.symptom, v.resolution_state"
        " FROM findings f JOIN finding_state_current v ON v.finding_id = f.finding_id"
        " WHERE f.subsystem_id = ?"
        " ORDER BY CASE f.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1"
        "   WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END, f.finding_id",
        (sid,),
    )
    vocab = _vocabulary_terms(conn).get(sid, [])
    declined = _declinations(conn).get(sid, [])
    vocabulary_state = _vocabulary_state(vocab, declined, resolve_workspace(storage))
    xrefs = rows(
        conn,
        "SELECT from_id, to_id, relationship, strength, context FROM xrefs WHERE from_id = ? OR to_id = ? ORDER BY relationship",
        (sid, sid),
    )
    seams = rows(
        conn,
        "SELECT a.seam_id AS id, a.shared_object, a.party_a, a.party_b, a.assessable"
        " FROM seam_assessability a WHERE a.party_a = ? OR a.party_b = ? ORDER BY a.seam_id",
        (sid, sid),
    )
    active_concerns = rows(
        conn, "SELECT code FROM concerns WHERE status='active' ORDER BY code"
    )
    standing = rows(
        conn,
        "SELECT file_path, standing_state, stale FROM file_standing"
        f" WHERE subsystem_id = ? AND {survey_filter(conn)} ORDER BY file_path",
        (sid,),
    )
    # A subsystem whose every ledger row is on an excluded path is outside the
    # survey (design/scope/PLAN.md §2.6a): its page is kept, so its records keep
    # a home, but it owes no survey work and lists no file.
    outside = sid in outside_survey_subsystems(conn)
    outside_seams = set(outside_survey_seams(conn))

    # §7.3's Structure section reads claims, and reads them with the same three
    # arms `describe_locus` uses (§3.1's subject and evidence arms, plus §9.1's
    # `<sid>/` namespace).  Two surfaces that answered "what does this subsystem
    # claim" differently would let a claim be current on one and absent from the
    # other, which is the divergence §13 calls a false green.  `valid_until_sha
    # IS NULL` is ADR-0001's current: a claim closed by `apply_change_impact`
    # is history, and history is not rendered here.
    claims = subsystem_claims(conn, str(sid))

    # The per-subsystem survey bodies: the imports of an earlier version's
    # hand-written survey files, which the store holds as written. A body a
    # subsystem reset withdrew is not printed (store-only PLAN §3.3, §5.4).
    surveys = imported_bodies(conn, kind="subsystem-survey", subsystem_id=str(sid))
    survey_rows = [_survey_row(imported) for imported in surveys]
    survey_prose = "".join(imported.body + "\n\n" for imported in surveys)

    # The effective explanation (§3.2), read by the function the read-back reads
    # so the page and its custody check cannot name different rows.
    readings = effective_explanations(conn, storage, str(sid))
    unrecorded = ExplanationReading("not-recorded", None, False)
    purpose = readings.get(("subsystem", str(sid), "purpose"), unrecorded)
    account = readings.get(("subsystem", str(sid), "account"), unrecorded)
    explanations = [r for r in explanation_rows(conn) if r["subject_id"] == sid]
    checked_head = str(
        (row(conn, "SELECT last_checked_sha FROM git_state WHERE repo_id='default'") or {}).get(
            "last_checked_sha"
        )
        or ""
    )
    workspace = resolve_workspace(storage)
    bound = workspace_is_bound(workspace)

    # The survey's stored prose for this subsystem (store-only PLAN §2.1): one
    # row in force per section and topic, read by the function the read-back reads.
    narratives = effective_narratives(conn, storage, str(sid))
    by_section = {
        section: [r for r in narratives if r["section"] == section]
        for section in ("structure", "concern-reasoning", "challenge")
    }

    path = subsystem_page(str(sid), str(s["name"]))
    # The depth prints once, in the page head's snapshot strip, which carries
    # the record's mark (§3.5), and the layer is the page's subheading.
    blocks: list[Block] = []

    if outside:
        held_seams = [str(sm["id"]) for sm in seams if str(sm["id"]) in outside_seams]
        blocks.append(
            _section(
                OUTSIDE_SURVEY_HEADING,
                _paragraph(
                    "Every path this subsystem's ledger names is outside the survey set, so it"
                    " owes no survey work and no file of it is listed. Its records are kept here;"
                    " a citation of an excluded path prints as text."
                ),
                *(
                    [
                        _paragraph(
                            "Outside the survey with it: "
                            + ", ".join(f"seam **{seam}**" for seam in held_seams)
                            + ". A seam outside the survey owes no assessment and is drawn on no diagram."
                        )
                    ]
                    if held_seams
                    else []
                ),
            )
        )

    # 0. Purpose — only from an effective record, recorded or declined. A page
    #    with neither keeps today's opening: Scope and the no-purpose sentence.
    printed = explanation_body("subsystem", str(sid), "purpose", purpose, warn)
    if printed is not None and purpose.row is not None:
        body, is_body = printed
        held: list[Block] = [body]
        if purpose.state == "recorded" and is_body:
            held.append(_paragraph(_provenance_line(workspace, bound, purpose.row, checked_head)))
        blocks.append(_section("Purpose", *held))

    # 1. Scope — verbatim, under that heading, never as a purpose sentence.
    #
    # `subsystems` carries no purpose column, so the disclaimer is not
    # conditional on this row: every page says it (§3.1, §7.3). Without it the
    # recorded scope — a file-and-boundary list — sits alone under the first
    # heading and reads as a statement of what the subsystem is for, which is
    # the relabelling §3.1 forbids and BP6 names (F10/codex).
    scope: list[Block] = []
    if purpose.state == "not-recorded":
        scope.append(_paragraph(NO_PURPOSE_WITH_SCOPE if s.get("scope") else NO_PURPOSE_ALONE))
    if s.get("scope"):
        scope += render_prose(str(s["scope"]))
    elif files:
        scope.append(
            _paragraph(
                "No scope statement is recorded for this subsystem. The file ledger in"
                " its survey record is the only account of what belongs to it."
            )
        )
    else:
        scope.append(
            _paragraph(
                "No scope statement is recorded for this subsystem, and no file is"
                " recorded in its ledger. Nothing here states what it contains."
            )
        )
    # 2. Start here: where to begin reading, usually a path or two. It is a
    #    pointer into the scope just stated, so it prints as one labelled line
    #    at the end of Scope, not as a section of its own.
    jump_in = str(s.get("jump_in_reading") or "").strip()
    if jump_in:
        scope += _labelled_line("Start here", jump_in, "start-here")
    survey_note = str(s.get("notes") or "").strip()
    if survey_note:
        scope += [
            _heading(3, SURVEY_NOTE_HEADING),
            _paragraph(f"*{SURVEY_NOTE_LABEL}*"),
            *render_prose(survey_note, under=3),
        ]
    blocks.append(_section("Scope", *scope))

    # 2b. How it works — the recorded account. A declined account prints one
    #     sentence under the survey record instead.
    printed = explanation_body("subsystem", str(sid), "account", account, warn)
    if account.state == "recorded" and printed is not None and account.row is not None:
        body, is_body = printed
        held = [body]
        if is_body:
            held.append(_paragraph(_provenance_line(workspace, bound, account.row, checked_head)))
        blocks.append(_section("How it works", *held))

    # 3. Structure — current claims, grouped by what each one records (§7.3).
    #    With none, §9.1's literal and the labelled narrative fallback: unbound
    #    prose is never presented where a revision-bound inventory belongs.
    structure: list[Block] = []
    placement = narrative_placement(
        has_account=account.state == "recorded",
        has_claims=bool(claims),
        has_artifact=bool(survey_prose.strip()),
    )
    provenance = ", ".join(
        f"`{sv['path']}` at content hash `{str(sv['content_hash'] or '—')[:12]}`"
        f", recorded at {_short(str(sv['ref_sha'] or ''))}"
        f", written on {_stored_date(sv['written_at'])}"
        for sv in survey_rows
    )
    source = f" Its source is {provenance}." if provenance else ""

    def survey_narrative() -> list[Block]:
        return [
            _heading(3, SURVEY_NARRATIVE),
            _paragraph(f"*{NARRATIVE_LABEL}.*{source}"),
            *_imported_blocks(surveys, 3, "Structure", path),
        ]

    epistemic_labels = labels("claim_epistemic_kind")
    if claims:
        structure.append(
            _paragraph(
                "What the survey recorded as claims about this subsystem, grouped by what"
                " each one states. Every claim is bound to the revision it was asserted at"
                " and to the evidence attached to it; a superseded claim is not shown here."
            )
        )
        claim_evidence = _claim_evidence(conn, [str(c["claim_id"]) for c in claims])
        for heading, group in _claim_groups(str(sid), claims):
            structure.append(_heading(3, heading))
            if heading == _CLAIM_KIND_HEADING["flow"]:
                structure.extend(flow_strip_blocks(conn, str(sid)))
            # The statement is the item's first text and its coordinates are
            # one nested item, so a reader meets the sentence before the key
            # (§2.2).  Whitespace runs collapse because a line break inside the
            # statement would end the item.
            items = []
            for c in group:
                kind = str(c["epistemic_kind"] or "")
                coordinates = (
                    f"`{c['claim_key']}` · subject `{c['subject_id']}`"
                    f" · {epistemic_labels.get(kind, kind) or '—'}"
                    f" · asserted at {_short(str(c['asserted_at_sha'] or ''))}"
                    f" · {_evidence_text(claim_evidence.get(str(c['claim_id']), []))}"
                )
                items.append(
                    ListItem(
                        inlines(" ".join(str(c["statement"] or "—").split())),
                        (List(False, (ListItem(inlines(coordinates)),)),),
                        record=f"claim:{c['claim_id']}",
                    )
                )
            structure.append(List(False, tuple(items)))
        structure += _narrative_blocks(
            by_section["structure"], 3, workspace, bound, checked_head, warn
        )
        if placement == "structure-narrative":
            structure += survey_narrative()
    elif by_section["structure"]:
        # A recorded narrative is the reading here: it leads, bound to its
        # revision, and the imported body follows as the earlier account.
        structure += [_heading(3, NO_STRUCTURAL_CLAIMS), _paragraph(NARRATIVE_NO_CLAIMS)]
        structure += _narrative_blocks(by_section["structure"], 3, workspace, bound, checked_head, warn)
        if placement == "inventory-fallback":
            structure += survey_narrative()
        elif placement == "survey-record":
            structure.append(_paragraph(NARRATIVE_IN_RECORD + source))
    else:
        structure.append(_heading(3, NO_STRUCTURAL_CLAIMS))
        if placement == "inventory-fallback":
            structure += [
                _paragraph(f"No structural claim is recorded for this subsystem. *{NARRATIVE_LABEL}.*{source}"),
                *_imported_blocks(surveys, 3, "Structure", path),
            ]
        elif placement == "survey-record":
            structure.append(
                _paragraph(f"No structural claim is recorded for this subsystem. {NARRATIVE_IN_RECORD}{source}")
            )
        else:
            structure.append(
                _paragraph(
                    "No structural claim is recorded for this subsystem, and no narrative was"
                    " left in its place."
                    + (f" The survey artifact is {provenance}." if provenance else "")
                )
            )
    blocks.append(_section("Structure", *structure))

    # 4. Boundaries — seams and recorded edges.
    if seams or xrefs:
        boundaries: list[Block] = []
        if seams:
            seam_rows: list[Sequence[str]] = []
            for sm in seams:
                other = sm["party_b"] if sm["party_a"] == sid else sm["party_a"]
                assessable = (
                    "no: outside the survey"
                    if str(sm["id"]) in outside_seams
                    else "both parties are `mapped`"
                    if int(sm["assessable"] or 0)
                    else "not yet: both parties must be `mapped`"
                )
                seam_rows.append(
                    (f"**{sm['id']}**", _table_cell(sm["shared_object"]), f"**{other}**", assessable)
                )
            boundaries += [
                _heading(3, "Seams"),
                _table(_caption("Boundaries"), ("Seam", "Shared object", "Other party", "Assessable"), seam_rows),
            ]
        if xrefs:
            boundaries += [
                _heading(3, "Recorded edges"),
                _table(
                    _caption("Boundaries"),
                    ("From", "→", "To", "Relationship", "Strength", "Context"),
                    [
                        (
                            f"**{x['from_id']}**",
                            "→",
                            f"**{x['to_id']}**",
                            f"{x['relationship']}",
                            f"{x['strength']}",
                            _table_cell(x["context"] or "—"),
                        )
                        for x in xrefs
                    ],
                ),
            ]
        blocks.append(_section("Boundaries", *boundaries))

    # 5. Vocabulary — §4.5's three states, never collapsed into two. A
    #    subsystem that answered "none" and one nobody asked are different
    #    facts, and the section renders for both: a page that simply omits the
    #    heading makes the silent state unrepresentable (VP4(e)).
    vocabulary: list[Block] = []
    if vocab:
        vocabulary.append(_bullets([f"**{v['term']}** — {_one_line(v['gloss'])}" for v in vocab]))
    if vocabulary_state == "declined":
        vocabulary.append(
            _paragraph(f"**Domain vocabulary** — none. {_declination_sentence(declined[0])}")
        )
    elif vocabulary_state == "not-recorded":
        vocabulary.append(
            _paragraph(
                f"{VOCABULARY_NOT_RECORDED}"
                f" {meanings('vocabulary_discharge').get('not-recorded', '')}"
            )
        )
    if vocabulary_state == "terms" and declined:
        # Kept, not erased: a later pass that found a term supersedes the
        # judgment without unsaying it (GP18, §4.3).
        vocabulary += [_heading(3, SUPERSEDED_HEADING), _paragraph(_declination_sentence(declined[0]))]
    blocks.append(_section("Vocabulary", *vocabulary))

    # 6. Known defects here — links, never a second full record (§6.2).
    open_states = FINDING_LENS_STATES.get("findings.html", ())
    open_findings = [f for f in findings if str(f["resolution_state"]) in open_states]
    resolved = [f for f in findings if str(f["resolution_state"]) not in open_states]
    defects: list[Block] = []
    # Subsystem pages live one directory down, so every link to a top-level
    # lens page is written relative to this page. A bare `findings.html` here
    # resolves to `subsystems/findings.html` and turns the coverage axis red.
    up = "../"
    if open_findings:
        defects.append(
            _paragraph(
                f"{_count(len(open_findings), 'defect')} here"
                f" {'is' if len(open_findings) == 1 else 'are'} open or awaiting"
                " verification. Each one's full record, with its evidence, is on"
                f" [Open findings]({up}findings.html)."
            )
        )
        lines = []
        for f in open_findings:
            page = finding_page(str(f["resolution_state"])) or "findings.html"
            state = RESOLUTION_LABELS.get(
                str(f["resolution_state"]), str(f["resolution_state"])
            )
            lines.append(
                f"{_one_line(f['symptom'])}"
                f" — [{f['finding_id']}]({up}{page}#{str(f['finding_id']).lower()})"
                f" · {_sev_badge(str(f['severity']))} · {state}"
            )
        defects.append(_bullets(lines))
    else:
        defects.append(_paragraph("No defect here is open or awaiting verification."))
    if resolved:
        defects.append(
            _paragraph(
                f"{_count(len(resolved), 'further defect')} here reached a terminal"
                f" state; {'it is' if len(resolved) == 1 else 'they are'} recorded on"
                f" [Resolved findings]({up}resolved-findings.html)."
            )
        )
    blocks.append(_section("Known defects here", *defects))

    # 7. Standing (§2.5): what this subsystem's record entitles a reader to claim.
    # Read through `file_standing` and counted by the same predicates
    # `describe_locus` uses for a subsystem (§2.5, `mcp-server/src/standing.ts`),
    # so the page and the tool cannot report different coverage for one store.
    examined = sum(
        1 for r in standing if str(r["standing_state"]) in ("examined", "examined-stale")
    )
    candidate = sum(1 for r in standing if str(r["standing_state"]) == "scoped-unread")
    excluded = sum(1 for r in standing if str(r["standing_state"]) == "excluded")
    stale_here = sum(1 for r in standing if int(r["stale"] or 0))
    on_active = [d for d in dispositions if str(d["concern_status"]) == "active"]
    breakdown = ", ".join(
        f"{sum(1 for d in on_active if str(d['classification']) == value)} {value}"
        for value in values_of("disposition_classification")
        if any(str(d["classification"]) == value for d in on_active)
    )
    by_state = {
        state: sum(1 for f in findings if str(f["resolution_state"]) == state)
        for state in values_of("finding_resolution_state")
    }
    assessable_seams = sum(1 for sm in seams if int(sm["assessable"] or 0))
    status = str(s["status"] or "unmapped")
    ladder = status_ladder_model(conn, str(sid), guide_href="../how-to-read.html")
    # What the ladder status authorizes and what it cannot justify, from the one
    # enum source (§10). A count without that sentence beside it reads as
    # coverage; it is an upper bound on what may be claimed.
    # A ledger with no rows has no denominator, and `0 of 0` reads as coverage
    # of an empty set rather than as nothing measured (VP4).
    ledger_facts: list[tuple[str, str]] = (
        [
            ("Files read", f"{examined} of {_count(len(standing), 'ledger row')}"),
            ("Files in scope, not yet read", f"{candidate} of {len(standing)}"),
            ("Files excluded from the survey obligation", f"{excluded} of {len(standing)}"),
            ("Ledger rows the repository has changed under", f"{stale_here} of {len(standing)}"),
        ]
        if standing
        else [("Ledger", "no file is recorded, so nothing here is measured")]
    )
    blocks.append(
        _section(
            "Standing",
            _paragraph(
                f"**{SUBSYSTEM_STATUS_LABELS.get(status, status)}** —"
                f" {SUBSYSTEM_STATUS_MEANINGS.get(status, 'no meaning is recorded for this status.')}"
                f" It cannot justify {SUBSYSTEM_STATUS_LIMITS.get(status, 'more than it records')}."
            ),
            ladder,
            coverage_bars_model(conn, str(sid)),
            _summary(
                _caption("Standing"),
                [
                    *ledger_facts,
                    (
                        "Active concerns with a disposition recorded here",
                        f"{len(on_active)} of {len(active_concerns)}"
                        + (f" — {breakdown}" if breakdown else ""),
                    ),
                    (
                        "Findings by resolution state",
                        ", ".join(
                            f"{count} {RESOLUTION_LABELS.get(state, state).lower()}"
                            for state, count in by_state.items()
                            if count
                        )
                        or "none recorded",
                    ),
                    (
                        "Seams assessable from both sides",
                        f"{assessable_seams} of {len(seams)}" if seams else "no seam names this subsystem",
                    ),
                ],
            ),
        )
    )

    # 8. Survey record — apparatus, last.
    record: list[Block] = []
    if account.state == "declined" and account.row is not None:
        reason, _is_body = _published_explanation(
            str(sid), "account", str(account.row["body"]), warn
        )
        record += render_prose(
            ACCOUNT_DECLINED.format(sha=str(account.row["ref_sha"])[:8], reason=reason.strip())
        )
    if not outside:
        record.append(_heading(3, "File ledger"))
        if files:
            record += _ledger_blocks(str(sid), files)
        else:
            record.append(_paragraph("No file is recorded in this subsystem's ledger."))

    record.append(_heading(3, "Concern review"))
    if dispositions:
        record.append(_concern_review(dispositions, _caption("Survey record")))
    else:
        record.append(_paragraph("No concern has been dispositioned in this subsystem."))
    if by_section["concern-reasoning"]:
        record.append(
            _paragraph(
                "The survey's reasoning about the concerns it reviewed here is on"
                f" [Review coverage]({'../'}concerns.html#concern-reasoning), under this subsystem."
            )
        )
    if by_section["challenge"]:
        record.append(_heading(3, CHALLENGE_HEADING))
        record += _narrative_blocks(by_section["challenge"], 4, workspace, bound, checked_head, warn)

    if survey_prose and placement in ("survey-record", "none"):
        record.append(_heading(3, "Survey artifact"))
        if placement == "survey-record" and account.row is not None:
            record += [_paragraph(_survey_notes_line(sv, account.row)) for sv in survey_rows]
        record += _imported_blocks(surveys, 3, "Survey record", path)
    elif placement == "structure-narrative":
        record += [_heading(3, "Survey artifact"), _paragraph(NARRATIVE_POINTER + source)]
    elif survey_prose:
        # §7.3 keeps the artifact in the survey record and §9.1 promotes it into
        # Structure when no claim stands in its place.  Rendering it twice would
        # make one page carry two copies of one witness, so the apparatus points
        # at the reading instead of repeating it.
        record += [
            _heading(3, "Survey artifact"),
            _paragraph(
                "The survey artifact is rendered above, under Structure, because no"
                " structural claim is recorded to stand in its place." + source
            ),
        ]
    blocks.append(_section("Survey record", *record))

    sources: dict[str, str] = (
        _db_source(f"subsystem:{sid}:row", s)
        | _db_source(f"subsystem:{sid}:files", files)
        | _db_source(f"subsystem:{sid}:disp", dispositions)
        | _db_source(f"subsystem:{sid}:findings", findings)
        | _db_source(f"subsystem:{sid}:vocab", vocab)
        | _db_source(f"subsystem:{sid}:declined", declined)
        | _db_source(f"subsystem:{sid}:xrefs", xrefs)
        | _db_source(f"subsystem:{sid}:seams", seams)
        | _db_source(f"subsystem:{sid}:concerns", active_concerns)
        | _db_source(f"subsystem:{sid}:standing", standing)
        | _db_source(f"subsystem:{sid}:ladder", ladder)
        | _db_source(f"subsystem:{sid}:claims", claims)
        | imports_source(f"subsystem:{sid}:imports", surveys)
        | _db_source(f"subsystem:{sid}:explanations", {"head": checked_head, "rows": explanations})
        | _narrative_source(f"subsystem:{sid}:narratives", checked_head, narratives)
    )
    return Page(_plain(f"{sid} — {s['name']}"), path, tuple(blocks)), sources


# ---------------------------------------------------------------------------
# Findings, concerns, seams, contradictions, diagnosticity, vocabulary, notes
# ---------------------------------------------------------------------------


def _finding_rows(
    conn: sqlite3.Connection, states: Sequence[str], order: str
) -> list[dict[str, Any]]:
    """Findings in the given resolution states, read through the partition view.

    `finding_state_current` carries the legacy-status fallback once (spec §6),
    so the renderer no longer keeps its own copy of it.
    """
    placeholders = ",".join("?" for _ in states)
    return rows(
        conn,
        f"""SELECT f.*,
                  s.name AS subsystem_name,
                  v.resolution_state, v.fix_sha, v.fix_location,
                  v.resolution_evidence_id, v.resolution_recorded_at
             FROM findings f
             JOIN finding_state_current v ON v.finding_id=f.finding_id
             LEFT JOIN subsystems s ON s.id=f.subsystem_id
            WHERE v.resolution_state IN ({placeholders})
            ORDER BY {order}""",
        list(states),
    )


def _by_subsystem(fs: Sequence[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group rows by subsystem, keeping the order the query established."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for f in fs:
        groups.setdefault(str(f["subsystem_id"]), []).append(f)
    return list(groups.values())


# What each group of the Unresolved lens means, in the reader's terms. Taken
# from the enum source so the page and the reader's guide cannot drift.
_STATE_HINTS: dict[str, str] = {
    "open": "_{n} defect(s) with no recorded repair._",
    "fixed-pending-verification": (
        "_{n} repair(s) recorded against a commit, with no evidence yet that they hold._"
    ),
}


# §5.6's carried obligations. A carried record is an obligation this store
# inherited, not a defect it confirmed, so it renders in its own section on the
# lens its decidedness selects — undecided on Unresolved, decided on History —
# and never inside the findings tables. Each record is a full record on exactly
# one page, the rule §6.2 already fixes for findings, which is what lets the
# read-back census count exactly one marker per corpus.
CARRIED_LEAD = {
    "findings.html": (
        "_{n} carried forward from an earlier store and still undecided. An"
        " inherited defect is an obligation to re-find it, rule it out with"
        " evidence, or mark it repaired at a commit — not a defect this survey"
        " confirmed, and not counted among the findings open above._"
    ),
    "resolved-findings.html": (
        "_{n} carried forward from an earlier store and decided here. The"
        " archived record is what the predecessor held; the outcome is what this"
        " store did about it._"
    ),
}

CARRIED_OUTCOME_LINKS = {"successor-finding": "successor_id"}


def _successor_pages(conn: sqlite3.Connection) -> dict[str, str]:
    """Where each finding this store holds renders, so a successor can be linked.

    A carried record discharged into a successor is only useful if the reader
    can reach the successor, and which lens holds it is a property of its
    resolution state rather than of its id (§6.2).
    """

    return {
        str(r["finding_id"]): page
        for r in rows(
            conn, "SELECT finding_id, resolution_state FROM finding_state_current"
        )
        if (page := finding_page(str(r["resolution_state"]))) is not None
    }


def _finding_record(f: Mapping[str, Any]) -> Record:
    """One finding as the record the HTML prints: its lede, then what the symptom goes on to say."""

    finding_id = str(f["finding_id"])
    key = f'<a id="{finding_id.lower()}"></a>**{finding_id}**'
    key_text = _plain(key)
    symptom = _table_cell(f["symptom"])
    state = str(f["resolution_state"])
    ref = f"`{(f['ref_sha'] or '—')[:8]}`"
    parts = re.split(r"(?<=[.!?])\s+", symptom, maxsplit=1)
    fields: list[Fact] = []
    if len(parts) == 2 and _plain(parts[1]):
        fields.append(Fact("observed behavior", inlines(parts[1])))
    context = _table_cell(f.get("business_context") or "")
    if _plain(context):
        fields.append(Fact("why it matters", inlines(context)))
    fields.append(Fact("root cause", inlines(_table_cell(f["root_cause"]))))
    return Record(
        markers=(finding_marker(finding_id),),
        key=inlines(key),
        key_text=key_text,
        slug_text=_plain(f"finding-{key_text}"),
        facts=(
            Fact("status", Inlines((Chip("status", _plain(state), show_hint=False),), _plain(state))),
            Fact("ref sha", inlines(ref)),
        ),
        fields=tuple(fields),
        lede=inlines(parts[0]),
        path=key_text,
        revision=_plain(ref),
        subsystem_id=key_text,
        record=f"finding:{finding_id}",
        state=state,
    )


def _carried_blocks(
    records: Sequence[dict[str, Any]],
    page: str,
    successors: dict[str, str],
) -> list[Block]:
    """Every carried record for one lens, each as a full marked record."""

    if not records:
        return []
    outcome_labels = labels("carried_finding_outcome")
    body: list[Block] = []
    lead = CARRIED_LEAD.get(page)
    if lead:
        body.append(_paragraph(lead.format(n=_count(len(records), "inherited obligation"))))
    for record in records:
        store_id = str(record["archived_store_id"])
        archived_id = str(record["archived_finding_id"])
        outcome = str(record["outcome"])
        heading = (
            "Undecided"
            if outcome == CARRIED_UNDECIDED
            else outcome_labels.get(outcome, outcome)
        )
        facts = [
            f"**Carried from** `{store_id}` at {_short(str(record['archived_anchor_sha']))},"
            f" recorded there as `{record['archived_resolution']}`",
            f"**Subsystem there** {record['subsystem_id']}",
        ]
        if outcome == CARRIED_UNDECIDED:
            facts.append(
                f"**Outcome** `{CARRIED_UNDECIDED}` — nobody here has re-found it,"
                " ruled it out, or recorded a repair"
            )
        else:
            detail = f"**Outcome** `{outcome}`"
            successor = str(record.get("successor_id") or "")
            if successor:
                target = successors.get(successor)
                detail += (
                    f" — [{successor}]({target}#{successor.lower()})"
                    if target
                    else f" — {successor}, which this store does not hold"
                )
            elif record.get("repaired_sha"):
                detail += f" — repaired at {_short(str(record['repaired_sha']))}"
            facts.append(detail)
            if record.get("rationale"):
                facts.append(f"**Recorded because** {_one_line(record['rationale'])}")
        body += [
            Heading(
                3,
                inlines(f"{archived_id} · {_sev_badge(str(record['severity']))} · {heading}"),
                finding_group=page == "resolved-findings.html",
            ),
            _paragraph(
                f"{carried_marker(store_id, archived_id)}"
                f'<a id="{carried_anchor(store_id, archived_id)}"></a>'
            ),
            _bullets(facts),
            *_paragraphs(str(record["symptom"])),
        ]
        if record.get("root_cause"):
            body.append(_paragraph(f"**Root cause, as archived.** {_one_line(record['root_cause'])}"))
    return [_section(CARRIED_HEADING, *body)]


def render_findings(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The Unresolved lens: open defects and repairs awaiting verification.

    Resolved records render on `resolved-findings.html` instead, each with its
    marker, so every finding is a full record on exactly one page (spec §6.2).
    """
    # §6.1 orders the Unresolved lens state-major: every open finding, by
    # severity, before every repair awaiting verification. Severity cannot be
    # the outer key. A critical repair someone has already made would then read
    # as more urgent than an open defect nobody has touched, which inverts what
    # the page is for, and the two groups would interleave so that neither has
    # a denominator a reader can see.
    fs = _finding_rows(
        conn,
        FINDING_LENS_STATES["findings.html"],
        """CASE v.resolution_state WHEN 'open' THEN 0 ELSE 1 END,
                     CASE f.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                       WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END,
                     f.subsystem_id, f.finding_id""",
    )
    blocks: list[Block] = []
    # The Unresolved lens's records are this page's filterable rows (§8.1.2).
    # Subsystem and severity are the headings a record already sits under, so
    # the filter narrows on the page's own grouping and not on a second,
    # restated classification.
    facets: dict[str, list[str]] = {}

    def facet(key: str, value: str) -> str:
        if value:
            values = facets.setdefault(key, [])
            if value not in values:
                values.append(value)
        return value

    if not fs:
        resolved = row(
            conn,
            "SELECT COUNT(*) AS n FROM finding_state_current"
            " WHERE resolution_state NOT IN ('open','fixed-pending-verification')",
        ) or {"n": 0}
        examined = row(
            conn,
            "SELECT COUNT(*) AS n FROM file_ledger WHERE classification='examined'"
            f" AND {survey_filter(conn)}",
        ) or {"n": 0}
        blocks += _empty_lens_blocks(
            conn,
            "No finding is open or awaiting verification."
            f" {_count(int(resolved['n'] or 0), 'resolved record')} are on"
            " [Resolved findings](resolved-findings.html).",
            "defects with no terminal resolution event, and repairs recorded against a"
            " commit with no evidence yet that they hold.",
            f"`finding_state_current` over `findings`, read across"
            f" {_count(int(examined['n'] or 0), 'examined file')}.",
        )
    else:
        # Resolution state is the primary grouping, and it is a heading rather
        # than a column so a reader can see which group a record is in without
        # reading the row. Severity sections nest inside it; the full subsystem
        # name supplies the human-oriented subheading for the records.
        for state, heading in (
            ("open", "Open"),
            ("fixed-pending-verification", "Awaiting verification"),
        ):
            state_rows = [f for f in fs if f["resolution_state"] == state]
            if not state_rows:
                continue
            body: list[Block] = [_paragraph(_STATE_HINTS[state].format(n=len(state_rows)))]
            for sev in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
                sev_rows = [f for f in state_rows if f["severity"] == sev]
                if not sev_rows:
                    continue
                body.append(_heading(3, f"{sev.title()} findings"))
                for subsystem_rows in _by_subsystem(sev_rows):
                    subsystem_id = str(subsystem_rows[0]["subsystem_id"])
                    subsystem_name = str(subsystem_rows[0].get("subsystem_name") or subsystem_id)
                    body.append(
                        Heading(
                            4,
                            inlines(f"[{subsystem_name}]({subsystem_page(subsystem_id, subsystem_name)})"),
                            finding_group=True,
                        )
                    )
                    group = facet("subsystem", _plain(subsystem_name))
                    band = facet("severity", sev.title())
                    records = tuple(
                        replace(_finding_record(f), filter=RowFilter(group, band)) for f in subsystem_rows
                    )
                    body.append(RecordList("finding", _caption(heading), records))
            blocks.append(_section(heading, *body))
    # §5.6: obligations inherited from an earlier store, still undecided here.
    carried = [
        record
        for record in carried_records(conn)
        if carried_page(str(record["outcome"])) == "findings.html"
    ]
    blocks += _carried_blocks(carried, "findings.html", _successor_pages(conn))
    page_facets = (
        Facets("findings", tuple((key, tuple(values)) for key, values in facets.items()))
        if fs
        else None
    )
    return Page("Open findings", "findings.html", tuple(blocks), page_facets), {
        **_db_source("findings:open", fs),
        **_db_source("findings:carried", carried),
    }


# §7.7's three bases. `schema.sql:813` requires `evidence_id` only for
# `verified-fixed`; `accepted` and `ruled-out` rest on an explicit authorized
# dismissal, which ADR-0001 § Resolved licenses, and `findings.ts` accepts them
# that way. Labelling all three "proof" would claim for two of them something
# the schema never asked for — and a terminal row carrying neither says so.
BASIS_EVIDENCE = "evidence"
BASIS_DISMISSAL = "authorized-dismissal"
BASIS_NONE = "none-recorded"
NO_BASIS_SENTENCE = "No basis is recorded for this resolution."
NO_BASIS_HEADING = "Terminal without a recorded basis"

_RESOLVED_STATE_HINTS: dict[str, str] = {
    "verified-fixed": "_{n} with verification evidence attached to the repair._",
    "ruled-out": "_{n} an adversarial pass overturned; the argument is kept on record._",
    "accepted": "_{n} where the behaviour is the intended design rather than a defect._",
}


def _resolution_events(conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    """The current resolution event per finding, by id.

    `finding_state_current` carries the state and the repair coordinates but
    not the rationale or the session that recorded them, and the basis needs
    both.
    """

    return {
        str(r["finding_id"]): r
        for r in rows(conn, "SELECT * FROM finding_resolution_current")
    }


def _evidence_by_id(conn: sqlite3.Connection) -> dict[int, dict[str, Any]]:
    return {int(r["id"]): r for r in rows(conn, "SELECT * FROM evidence")}


def _ledgered_paths(conn: sqlite3.Connection) -> set[str]:
    """The paths the Files index lists: ledgered, and inside the survey set (§2.6a)."""

    return {
        str(r["file_path"])
        for r in rows(conn, f"SELECT DISTINCT file_path FROM file_ledger WHERE {survey_filter(conn)}")
    }


def _cited_path(path: str, ledgered: set[str]) -> str:
    """One cited path, linked into the Files index when the ledger names it.

    A path the ledger does not carry has no anchor to link to, and inventing
    one would break the cross-link read-back rather than help the reader. A
    path outside the survey set is not listed there either, so a record made
    before it was excluded cites it as text (design/scope/PLAN.md §2.6a).
    """

    if path in ledgered:
        return f"[`{path}`](files.html#{file_anchor(path)})"
    return f"`{path}`"


def _resolution_basis(
    finding: dict[str, Any],
    event: dict[str, Any] | None,
    evidence: dict[int, dict[str, Any]],
    ledgered: set[str],
) -> tuple[str, str]:
    """What one resolved finding's resolution rests on, labelled by kind (§7.7)."""

    evidence_id = finding.get("resolution_evidence_id")
    if evidence_id is not None:
        e = evidence.get(int(evidence_id))
        if e is not None:
            locus = _cited_path(str(e["file_path"]), ledgered)
            if e["symbol"]:
                locus += f" `{e['symbol']}`"
            if e["line_range"]:
                locus += f" lines `{e['line_range']}`"
            note = str(e["note"] or "").strip()
            detail = (
                f"the verification evidence recorded at {_short(str(e['ref_sha'] or ''))}"
                f" — {locus}, kind `{e['kind']}`."
            )
            return BASIS_EVIDENCE, detail + (f" {note}" if note else "")
    rationale = str((event or {}).get("rationale") or "").strip()
    if rationale:
        session = str((event or {}).get("session_id") or "")
        recorded = str(finding.get("ref_sha") or "")
        provenance = f" Recorded by session `{session}`." if session else ""
        if recorded:
            provenance += (
                " No revision is recorded for the dismissal itself; the finding was"
                f" recorded at {_short(recorded)}."
            )
        return BASIS_DISMISSAL, rationale + provenance
    return BASIS_NONE, NO_BASIS_SENTENCE


def _resolved_blocks(
    subsystem_rows: Sequence[dict[str, Any]], bases: dict[str, tuple[str, str]]
) -> list[Block]:
    """One subsystem's resolved findings as full marked records (§6.2, §7.7).

    A register rather than a table: the basis is a sentence, not a peer column,
    and `reporting-style.md` keeps the identifier and the revision subordinate
    to the language that explains what happened.
    """

    subsystem_id = str(subsystem_rows[0]["subsystem_id"])
    subsystem_name = str(subsystem_rows[0].get("subsystem_name") or subsystem_id)
    out: list[Block] = [
        Heading(
            3,
            inlines(f"[{subsystem_name}]({subsystem_page(subsystem_id, subsystem_name)})"),
            finding_group=True,
        )
    ]
    for f in subsystem_rows:
        fid = str(f["finding_id"])
        kind, detail = bases[fid]
        facts: list[str] = []
        context = _one_line(f.get("business_context") or "")
        if context:
            facts.append(f"**{WHY_IT_MATTERS}** — {context}")
        facts.append(f"**Root cause** — {_one_line(f['root_cause'])}")
        recorded = str(f["resolution_recorded_at"] or "")
        facts.append(
            f"**Resolution** — `{f['resolution_state']}`"
            + (
                f", recorded {_fmt_time(recorded)}."
                if recorded
                else ", carried by the legacy status with no resolution event recorded."
            )
        )
        if f["fix_sha"] or f["fix_location"]:
            facts.append(
                f"**Repair** — {_short(str(f['fix_sha'] or ''))} at"
                f" `{f['fix_location'] or 'no location recorded'}`."
            )
        facts.append(f"**Basis** — `{kind}`: {_one_line(detail)}")
        out += [
            RecordMarker(finding_marker(fid)),
            Anchor(fid.lower()),
            Marked(
                f"finding:{fid}",
                str(f["resolution_state"]),
                (
                    _heading(4, f"{fid} · `{f['severity']}`"),
                    *_paragraphs(str(f["symptom"])),
                    _bullets(facts),
                ),
            ),
        ]
    return out


def render_resolved_findings(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The History lens for findings: verified, ruled out, and accepted.

    One section per resolution state, newest resolution first within it, each
    record carrying the basis its resolution rests on. A row whose state came
    from the legacy-status fallback has no recorded resolution time and sorts
    last in its section, which is what the store knows.

    The page refuses to present a terminal state as proven when nothing proves
    it. `verified-fixed` must carry evidence; the other two need only a
    rationale, and a row carrying neither is `none-recorded` and is counted at
    the top of the page rather than reading as resolved-with-proof (§7.7).
    """

    del storage  # the findings and their resolution events are the only source

    fs = _finding_rows(
        conn,
        FINDING_LENS_STATES["resolved-findings.html"],
        "v.resolution_recorded_at DESC, f.subsystem_id, f.finding_id",
    )
    events = _resolution_events(conn)
    evidence = _evidence_by_id(conn)
    ledgered = _ledgered_paths(conn)
    bases = {
        str(f["finding_id"]): _resolution_basis(
            f, events.get(str(f["finding_id"])), evidence, ledgered
        )
        for f in fs
    }

    # §5.6: obligations inherited from an earlier store and decided here.
    carried = [
        record
        for record in carried_records(conn)
        if carried_page(str(record["outcome"])) == "resolved-findings.html"
    ]
    carried_block = _carried_blocks(carried, "resolved-findings.html", _successor_pages(conn))
    sources = {
        **_db_source("findings:resolved", fs),
        **_db_source("findings:resolved-basis", bases),
        **_db_source("findings:carried-resolved", carried),
    }

    blocks: list[Block] = []
    if not fs:
        blocks += _empty_lens_blocks(
            conn,
            "No finding has reached a terminal state.",
            "findings recorded verified-fixed, ruled out, or accepted, each with the"
            " basis its resolution rests on.",
            "`finding_state_current` over `findings` and `finding_resolution_events`.",
        )
        blocks += carried_block
        return Page("Resolved findings", "resolved-findings.html", tuple(blocks)), sources

    blocks.append(
        _paragraph(
            "_Each record carries the basis its resolution rests on, labelled by kind."
            " A verified repair rests on evidence; a claim ruled out or a behaviour"
            " accepted rests on an argument someone authorized to make it recorded._"
        )
    )

    unbacked = [f for f in fs if bases[str(f["finding_id"])][0] == BASIS_NONE]
    if unbacked:
        ids = ", ".join(
            f"[**{f['finding_id']}**](#{str(f['finding_id']).lower()})" for f in unbacked
        )
        blocks.append(
            _section(
                NO_BASIS_HEADING,
                _paragraph(
                    f"{_count(len(unbacked), 'record')} below reached a terminal state with"
                    " neither verification evidence nor a recorded rationale. The store says"
                    f" they are closed and does not say on what: {ids}."
                ),
            )
        )

    for state in FINDING_LENS_STATES["resolved-findings.html"]:
        state_rows = [f for f in fs if f["resolution_state"] == state]
        if not state_rows:
            continue
        body: list[Block] = []
        hint = _RESOLVED_STATE_HINTS.get(state)
        if hint:
            body.append(_paragraph(hint.format(n=_count(len(state_rows), "record"))))
        for subsystem_rows in _by_subsystem(state_rows):
            body += _resolved_blocks(subsystem_rows, bases)
        blocks.append(_section(RESOLUTION_LABELS.get(state, state), *body))

    blocks += carried_block
    return Page("Resolved findings", "resolved-findings.html", tuple(blocks)), sources


def render_concerns(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    cs = rows(
        conn,
        "SELECT code, category, origin, status, discovered_in, notes FROM concerns ORDER BY status, code",
    )
    blocks: list[Block] = [_section("Coverage overview", *coverage_blocks(conn))]
    active = [c for c in cs if c["status"] == "active"]
    retired = [c for c in cs if c["status"] in ("retired", "merged")]
    # Each subsystem's concern reasoning, the survey's account of why its
    # concerns apply where they do (store-only PLAN §8 SO9).
    reasoning = [r for r in effective_narratives(conn, storage) if r["section"] == "concern-reasoning"]
    if reasoning:
        workspace = resolve_workspace(storage)
        bound = workspace_is_bound(workspace)
        head = str(
            (row(conn, "SELECT last_checked_sha FROM git_state WHERE repo_id='default'") or {}).get(
                "last_checked_sha"
            )
            or ""
        )
        names = {str(r["id"]): str(r["name"]) for r in rows(conn, "SELECT id, name FROM subsystems")}
        held: list[Block] = [
            _paragraph("Why each subsystem's concerns apply where they do, in the survey's words.")
        ]
        for sid in dict.fromkeys(str(r["subject_id"]) for r in reasoning):
            held.append(_heading(3, f"{sid} — {_one_line(names.get(sid, sid))}"))
            held += _narrative_blocks(
                [r for r in reasoning if r["subject_id"] == sid], 4, workspace, bound, head, None
            )
        blocks.append(_section("Concern reasoning", *held))
    if active:
        blocks.append(
            _section(
                "Active concerns",
                RecordList(
                    "concern",
                    _caption("Active concerns"),
                    tuple(
                        _record(
                            "concern",
                            f"<a id=\"{c['code'].lower()}\"></a>**{c['code']}**",
                            (
                                ("category", c["category"] or "—"),
                                ("origin", c["origin"]),
                                ("discovered in", c["discovered_in"] or "—"),
                            ),
                            (("notes", _table_cell(c["notes"] or "")),),
                            number,
                        )
                        for number, c in enumerate(active, start=1)
                    ),
                ),
            )
        )
    if retired:
        blocks.append(
            _section(
                "Retired/merged concerns",
                _bullets([f"**{c['code']}** — {c['status']} · {_one_line(c['notes'] or '')}" for c in retired]),
            )
        )
    return Page("Concerns", "concerns.html", tuple(blocks)), _db_source("concerns:all", cs) | _db_source(
        "concerns:disp", rows(conn, "SELECT * FROM dispositions")
    ) | _db_source("concerns:subs", rows(conn, "SELECT id FROM subsystems")) | _db_source(
        "concerns:reasoning", reasoning
    )


def _record(
    kind: str,
    key_raw: str,
    facts: Sequence[tuple[str, str]],
    fields: Sequence[tuple[str, str]],
    number: int,
) -> Record:
    """One row of a record table as the record the HTML prints: its facts, then its content fields."""

    key_text = _plain(key_raw) or f"Record {number}"
    anchor_text = re.sub(r"^concern\s+", "", key_text) if kind == "concern-disposition" else key_text
    return Record(
        markers=(),
        key=inlines(key_raw.strip()),
        key_text=key_text,
        slug_text=_plain(f"{kind}-{anchor_text}"),
        facts=tuple(Fact(name, inlines(value.strip())) for name, value in facts if _plain(value)),
        fields=tuple(Fact(name, inlines(value.strip())) for name, value in fields if _plain(value)),
        path=_plain(key_raw),
    )


def render_seams(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    seams = rows(conn, "SELECT * FROM seams ORDER BY id")
    assess = rows(conn, "SELECT * FROM seam_assessability")
    asmap = {a["seam_id"]: a for a in assess}
    blocks: list[Block] = list(seam_blocks(conn, "Seams"))
    if not seams:
        blocks.append(_paragraph("_No seams recorded yet._"))
    else:
        # A seam outside the survey is drawn on no diagram (design/scope/PLAN.md §2.6a).
        outside = set(outside_survey_seams(conn))
        blocks.extend(seam_contract_model(conn, str(s["id"])) for s in seams if str(s["id"]) not in outside)
        records: list[Record] = []
        for number, s in enumerate(seams, start=1):
            a = asmap.get(s["id"], {})
            records.append(
                _record(
                    "seam",
                    f"<a id=\"{s['id'].lower()}\"></a>**{s['id']}**",
                    (
                        ("kind", s["shared_object_kind"] or "—"),
                        ("parties", f"**{s['party_a']}** ↔ **{s['party_b']}**"),
                        ("assessable?", "✅" if a.get("assessable") else "⏳"),
                    ),
                    (("shared object", _table_cell(s["shared_object"])), ("notes", _table_cell(s["notes"] or ""))),
                    number,
                )
            )
            records[-1] = replace(records[-1], record=f"seam:{s['id']}")
        blocks.append(RecordList("seam", "Seams", tuple(records)))
    return Page("Seams", "seams.html", tuple(blocks)), _db_source("seams:all", seams) | _db_source("seams:assess", assess)


def render_contradictions(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The History lens for contradictions: the ones the evidence settled.

    Rows still standing move to `disagreements.html` (§6.1, §7.1). Keeping a copy
    here would put one record in two lenses, and an event linking back to "the
    contradiction" would have two places to land.
    """

    del storage  # the contradictions and their resolution events are the source

    cs = rows(
        conn,
        "SELECT * FROM contradictions"
        " WHERE resolution IS NOT NULL AND resolution <> 'unresolved'"
        " ORDER BY COALESCE(resolved_at, detected_at) DESC, id DESC",
    )
    events = {
        int(e["contradiction_id"]): e
        for e in rows(
            conn,
            "SELECT * FROM contradiction_resolution_events ORDER BY id",
        )
    }
    standing = row(
        conn,
        "SELECT COUNT(*) AS n FROM contradictions"
        " WHERE COALESCE(resolution,'unresolved')='unresolved'",
    ) or {"n": 0}
    if not cs:
        blocks = _empty_lens_blocks(
            conn,
            "No disagreement between findings has been settled."
            f" {_count(int(standing['n'] or 0), 'pair')} still stand"
            " undiscriminated, on [Records that disagree](disagreements.html).",
            "pairs of findings that made incompatible claims about one locus, and the"
            " evidence or argument that chose between them.",
            "`contradictions` whose resolution is recorded, with"
            " `contradiction_resolution_events` for the account of how.",
        )
        return Page("Conflicting evidence", "contradictions.html", tuple(blocks)), {
            **_db_source("contradictions:resolved", cs),
            **_db_source("contradictions:events", sorted(events)),
            **_db_source("contradictions:standing", standing),
        }

    def cells(c: dict[str, Any]) -> list[str]:
        event = events.get(int(c["id"]))
        rationale = _table_cell((event or {}).get("rationale") or "")
        scope_note = _table_cell(c["scope_note"] or "")
        return [
            f'<a id="{contradiction_anchor(c["id"])}"></a>**#{c["id"]}**',
            f"**{c['finding_a']}** / **{c['finding_b']}**",
            f"`{c['resolution']}`",
            f"`{c['shared_location']}`" if c["shared_location"] else "—",
            _fmt_time(c["resolved_at"]) if c["resolved_at"] else "—",
            rationale or scope_note or "No account of the resolution is recorded.",
        ]

    blocks = [
        _paragraph(
            "_Two findings made incompatible claims about the same locus and the record"
            " now says which one holds. The disagreement is kept rather than smoothed"
            " away, so a reader who forms the overturned reading again meets the"
            " argument that settled it. Disagreements still standing are on"
            " [Records that disagree](disagreements.html)._"
        ),
        _table(
            "Conflicting evidence",
            ("Record", "Findings", "Resolution", "Shared locus", "Settled", "On what"),
            [cells(c) for c in cs],
        ),
    ]
    return Page("Conflicting evidence", "contradictions.html", tuple(blocks)), {
        **_db_source("contradictions:resolved", cs),
        **_db_source("contradictions:events", sorted(events)),
    }


def render_diagnosticity(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    matrices = rows(
        conn,
        "SELECT id, subsystem_id, symptom, outcome, leading_concern, created_at FROM diagnosticity_sessions ORDER BY created_at DESC",
    )
    blocks: list[Block] = [
        _paragraph(
            "_When two or more concerns could each explain the same symptom, we open a "
            "[diagnosticity matrix](https://en.wikipedia.org/wiki/Analysis_of_competing_hypotheses) "
            "and evaluate evidence row-by-row across the competing concerns. Evidence consistent "
            "with all concerns has zero diagnostic value; evidence that contradicts only one is "
            "decisive. We rank by inconsistency — the concern with the most contradicting evidence "
            "is rejected first. Linchpin evidence (single-point-of-failure for the leading "
            "hypothesis) is flagged explicitly._"
        )
    ]
    if not matrices:
        blocks.append(_paragraph("_No diagnosticity matrices recorded._"))
    else:
        blocks.append(
            _table(
                "Diagnosticity matrices",
                ("ID", "Subsystem", "Symptom", "Outcome", "Leading concern", "Opened"),
                [
                    [
                        f"[**DM-{m['id']}**](diagnosticity/{matrix_slug(m['id'])}.md)",
                        f"**{m['subsystem_id'] or '—'}**",
                        _table_cell(m["symptom"] or ""),
                        str(m["outcome"]),
                        m["leading_concern"] or "—",
                        _fmt_time(m["created_at"]),
                    ]
                    for m in matrices
                ],
            )
        )
    return Page("Diagnosticity matrices", "diagnosticity.html", tuple(blocks)), _db_source("diagnosticity:index", matrices)


def render_diagnosticity_matrix(
    conn: sqlite3.Connection, storage: Path, m: dict[str, Any]
) -> RenderResult:
    mid = m["id"]
    concerns = rows(
        conn,
        "SELECT concern_code, rank, eliminated FROM diagnosticity_concerns WHERE matrix_id = ? ORDER BY COALESCE(rank, 999), concern_code",
        (mid,),
    )
    evidence = rows(
        conn,
        """
        SELECT de.row_order, e.id, e.file_path, e.symbol, e.kind, e.note, e.excerpt, e.ref_sha
          FROM diagnosticity_evidence de JOIN evidence e ON e.id = de.evidence_id
         WHERE de.matrix_id = ?
         ORDER BY de.row_order
        """,
        (mid,),
    )
    cells = rows(
        conn,
        "SELECT concern_code, evidence_id, verdict, note FROM diagnosticity_cells WHERE matrix_id = ?",
        (mid,),
    )
    value = rows(
        conn,
        "SELECT evidence_id, n_contradicts, n_consistent, n_irrelevant, n_ambiguous FROM diagnosticity_evidence_value WHERE matrix_id = ?",
        (mid,),
    )
    cell_map = {(c["concern_code"], c["evidence_id"]): c for c in cells}
    value_map = {v["evidence_id"]: v for v in value}

    def _cell_emoji(verdict: str | None) -> str:
        return {
            "consistent": "✓",
            "contradicts": "✗",
            "irrelevant": "·",
            "ambiguous": "~",
        }.get(verdict or "", "—")

    head = [
        f"**Subsystem**: **{m['subsystem_id'] or '—'}**",
        f"**Shared location**: `{m['shared_location'] or '—'}`",
        f"**Outcome**: {m['outcome']}",
    ]
    if m.get("leading_concern"):
        head.append(f"**Leading concern**: **{m['leading_concern']}**")
    if m.get("linchpin_note"):
        head.append(f"**Linchpin note**: {m['linchpin_note']}")
    blocks: list[Block] = [_paragraph(" ".join(head))]

    matrix: list[Block] = []
    if not concerns or not evidence:
        matrix.append(_paragraph("_Matrix has no concerns or evidence rows._"))
    else:
        body: list[list[str]] = []
        for e in evidence:
            loc = f"`{e['file_path']}`"
            if e["symbol"]:
                loc += f" · `{e['symbol']}`"
            loc += f" · _{e['kind']}_"
            v = value_map.get(e["id"], {})
            body.append(
                [
                    loc,
                    *(_cell_emoji(cell_map.get((c["concern_code"], e["id"]), {}).get("verdict")) for c in concerns),
                    f"{v.get('n_contradicts', 0)}✗ / {v.get('n_consistent', 0)}✓",
                ]
            )
        matrix.append(
            _table(
                "matrix",
                ("Evidence", *(f"**{c['concern_code']}**" for c in concerns), "Diagnostic value"),
                body,
            )
        )
        matrix.append(_paragraph("**Cell legend**: ✓ consistent · ✗ contradicts · · irrelevant · ~ ambiguous"))
    blocks.append(_section("Matrix", *matrix))

    if evidence:
        detail: list[Block] = []
        for e in evidence:
            detail.append(_heading(3, f"Evidence #{e['id']}"))
            detail.append(
                _paragraph(
                    f"`{e['file_path']}` · `{e.get('symbol') or '—'}` · _{e['kind']}_ · ref `{(e['ref_sha'] or '')[:8]}`"
                )
            )
            if e.get("excerpt"):
                detail.append(Code("", "\n".join(str(e["excerpt"]).splitlines())))
            if e.get("note"):
                detail.append(_paragraph(f"_{_one_line(e['note'])}_"))
        blocks.append(_section("Evidence detail", *detail))

    sources = (
        _db_source(f"matrix:{mid}:session", m)
        | _db_source(f"matrix:{mid}:concerns", concerns)
        | _db_source(f"matrix:{mid}:evidence", evidence)
        | _db_source(f"matrix:{mid}:cells", cells)
        | _db_source(f"matrix:{mid}:value", value)
    )
    title = _plain(f"DM-{mid} · {m['symptom']}")
    return Page(title, matrix_page(mid), tuple(blocks)), sources


# §4.5's three states, named once. `terms`, `declined` and `not-recorded` are
# the `vocabulary_discharge` enum's own values, so a fourth state added to the
# contract reaches this page rather than being silently folded into one of
# these three (GP28).
SUPERSEDED_HEADING = "Superseded: this subsystem previously declared no domain vocabulary"
VOCABULARY_INDEX_HEADING = "Subsystems that declared no domain vocabulary"


def _vocabulary_terms(conn: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    """Terms by subsystem, over the scope set rather than the primary column.

    `vocabulary.subsystem_id` holds one scope and `define_term`'s upsert moves
    it, so a term shared between two subsystems used to belong to whichever was
    defined last. §4.4's `vocabulary_scopes` join is the scope set; the column
    is kept as the primary scope, and both are read here so a store written
    before the join table still answers.
    """

    by_subsystem: dict[str, list[dict[str, Any]]] = {}
    seen: set[tuple[str, str]] = set()

    def record(subsystem_id: str, term: dict[str, Any]) -> None:
        key = (subsystem_id, str(term["term"]))
        if key in seen:
            return
        seen.add(key)
        by_subsystem.setdefault(subsystem_id, []).append(term)

    for term in rows(
        conn,
        "SELECT term, gloss, first_seen, subsystem_id FROM vocabulary"
        " WHERE subsystem_id IS NOT NULL ORDER BY term",
    ):
        record(str(term["subsystem_id"]), term)
    if table_exists(conn, "vocabulary_scopes"):
        for term in rows(
            conn,
            "SELECT v.term, v.gloss, v.first_seen, s.subsystem_id"
            " FROM vocabulary_scopes s JOIN vocabulary v ON v.term = s.term"
            " ORDER BY v.term",
        ):
            record(str(term["subsystem_id"]), term)
    for terms in by_subsystem.values():
        terms.sort(key=lambda term: str(term["term"]))
    return by_subsystem


def _declinations(conn: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    """Every recorded declination, newest first, by subsystem (§4.3).

    Kept across a reset and never deleted, so a subsystem can hold several and
    the most recent is the one §4.4 reads. Whether its revision still resolves
    is the server's prerequisite to enforce; this page reports what was said and
    when, which is what makes `declined` distinguishable from `not recorded`.
    """

    if not table_exists(conn, "vocabulary_declinations"):
        return {}
    by_subsystem: dict[str, list[dict[str, Any]]] = {}
    for record in rows(
        conn,
        "SELECT subsystem_id, reason, session_id, ref_sha, declared_at"
        " FROM vocabulary_declinations ORDER BY id DESC",
    ):
        by_subsystem.setdefault(str(record["subsystem_id"]), []).append(record)
    return by_subsystem


def _vocabulary_state(
    terms: Sequence[dict[str, Any]], declined: Sequence[Any], workspace: Path
) -> str:
    """Which of §4.5's three states a subsystem is in. Current terms win.

    "Current" means **anchored** (§4.4, C18): a term whose `first_seen` opens
    in the revision it names.  A non-empty string is not an anchor — the state
    this page reports is the state D0's B4 recomputes, and a term nobody can
    open discharged nothing, so a declination beside it is the subsystem's
    current answer rather than superseded history (F6/codex).
    """

    if any(anchor_opens(workspace, term.get("first_seen")) for term in terms):
        return "terms"
    # The same rule, applied to the other record.  §4.4 reads the *effective*
    # declination — the newest row for the subsystem whose `ref_sha` still
    # resolves — and says older rows, and rows anchored to a revision the
    # repository no longer has, "render as history (§4.5) and satisfy nothing".
    # A row nobody can open is therefore not this subsystem's answer, and the
    # third state is (F6/codex).
    if any(_declination_resolves(workspace, record) for record in declined):
        return "declined"
    return "not-recorded"


def _declination_resolves(workspace: Path, record: Any) -> bool:
    """Whether a declination's `ref_sha` still resolves in the bound workspace.

    A declination carries a bare revision, not a `path#symbol@sha` citation, so
    the term arm's `anchor_opens` is the wrong predicate: what §4.4 asks of this
    row is only that the repository still has the revision it was declared at.
    """

    revision = record.get("ref_sha") if hasattr(record, "get") else None
    revision = str(revision or "").strip()
    if not revision or not workspace.is_dir():
        return False
    resolved = _git_output(workspace, "rev-parse", "--verify", "--quiet", f"{revision}^{{commit}}")
    return bool(resolved and resolved.strip())


def _declination_sentence(record: dict[str, Any]) -> str:
    """One declination, with the three things that make it a judgment (§4.5)."""

    return (
        f"Declared at {_short(str(record['ref_sha'] or ''))} in session"
        f" `{record['session_id']}`: _{record['reason']}_"
    )


#: The fixed sentences a page prints for a slot nobody has filled (§2.5). The
#: reader-prose measure counts six strings, and each of them occurs in one of
#: these. No other empty-state sentence is listed: "No seams recorded yet" and
#: "No dependency edges are recorded" describe an empty relation, not a slot.
PLACEHOLDER_SENTENCES: tuple[str, ...] = (
    THESIS_ABSENT,
    THESIS_REFUSED,
    THESIS_REFUSED_COMPOSITE,
    RUNTIME_BOUNDARY_ABSENT,
    VOCABULARY_NOT_RECORDED,
    NO_PURPOSE_WITH_SCOPE,
    NO_PURPOSE_ALONE,
    PROJECT_ACCOUNT_ABSENT,
)


def unfilled_slots(conn: sqlite3.Connection, storage: Path) -> list[dict[str, str]]:
    """One row per slot that applies and is unfilled, from the predicates the pages use.

    The thesis, the runtime boundary map and a subsystem's vocabulary are each
    decided by one function that the renderer calls to choose what to print:
    `thesis_state`, `runtime_boundary_state` and `_vocabulary_state`. The rows
    below are emitted by asking the same three, so a row exists exactly when the
    page prints the slot's sentence. A declined slot is filled and has no row.
    Publication does not read this list; it only reports it.
    """

    census: list[dict[str, str]] = []
    state = thesis_state(conn, storage)
    if state == "absent":
        census.append(
            {
                "slot": "thesis",
                "page": "index.html",
                "subject": "project",
                "state": state,
                # Only a recorded purpose discharges it: the server refuses to
                # decline the project's purpose (`explanations.ts`; F4/codex).
                "discharge": (
                    "call record_explanation with subject_type project and slot purpose;"
                    " the project's purpose cannot be declined"
                ),
            }
        )
    elif state == "refused":
        census.append(
            {
                "slot": "thesis",
                "page": "index.html",
                "subject": "project",
                "state": state,
                "discharge": (
                    "call record_explanation with subject_type project and slot purpose,"
                    " so that it carries no status vocabulary and no composite figure"
                ),
            }
        )
    if runtime_boundary_state(conn) == "absent":
        census.append(
            {
                "slot": "runtime-boundary-map",
                "page": "architecture.html",
                "subject": "project",
                "state": "absent",
                "discharge": (
                    "call record_runtime_boundary for each edge between runtimes, with the"
                    f" columns {', '.join(RUNTIME_BOUNDARY_COLUMNS)}"
                ),
            }
        )
    declined = _declinations(conn)
    scoped_terms = _vocabulary_terms(conn)
    workspace = resolve_workspace(storage)
    readings = effective_explanations(conn, storage)
    eligible_subsystems = 0
    for sub in rows(conn, "SELECT id, name, status FROM subsystems ORDER BY id"):
        sid = str(sub["id"])
        # The three explanation slots apply to a subsystem that can have one
        # (§3.1); nothing may be recorded for the others, so nothing is unfilled.
        # Their vocabulary row below is unaffected.
        if str(sub["status"]) in EXPLANATION_ELIGIBLE_STATUSES:
            eligible_subsystems += 1
            for slot, discharge in (
                (
                    "purpose",
                    f"call record_explanation for {sid} with slot purpose, or"
                    f" decline_explanation for {sid} with the reason it has none",
                ),
                (
                    "account",
                    f"call record_explanation for {sid} with slot account, or"
                    f" decline_explanation for {sid} with the reason it has none",
                ),
            ):
                state = _reading(readings, "subsystem", sid, slot).state
                if state == "not-recorded":
                    census.append(
                        {
                            "slot": f"subsystem-{slot}",
                            "page": subsystem_page(sid, str(sub["name"])),
                            "subject": sid,
                            "state": state,
                            "discharge": discharge,
                        }
                    )
        vocabulary = _vocabulary_state(scoped_terms.get(sid, []), declined.get(sid, []), workspace)
        if vocabulary == "not-recorded":
            census.append(
                {
                    "slot": "subsystem-vocabulary",
                    "page": subsystem_page(sid, str(sub["name"])),
                    "subject": sid,
                    "state": vocabulary,
                    "discharge": (
                        f"call define_term for a term scoped to {sid}, or"
                        f" decline_domain_vocabulary for {sid} with the reason it has none"
                    ),
                }
            )
    # The project account applies only when a subsystem can have an explanation.
    if (
        eligible_subsystems
        and _reading(readings, "project", "project", "account").state == "not-recorded"
    ):
        census.append(
            {
                "slot": "project-account",
                "page": "architecture.html",
                "subject": "project",
                "state": "not-recorded",
                "discharge": (
                    "call record_explanation with subject_type project and slot account, or"
                    " decline_explanation with the reason there is none"
                ),
            }
        )
    return census


def render_vocabulary(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    terms = rows(
        conn,
        "SELECT term, gloss, expansion, subsystem_id, first_seen FROM vocabulary ORDER BY COALESCE(subsystem_id, ''), term",
    )
    blocks: list[Block] = []

    def term_blocks(t: dict[str, Any]) -> list[Block]:
        out: list[Block] = [_heading(3, str(t["term"])), _paragraph(f"_{t['gloss']}_")]
        if t.get("expansion"):
            out += render_prose(str(t["expansion"]).strip())
        if t.get("first_seen"):
            out.append(_paragraph(f"First seen: `{t['first_seen']}`"))
        return out

    if not terms:
        blocks.append(_paragraph("_No vocabulary recorded._"))
    else:
        # Codebase-wide first, then grouped by subsystem.
        global_terms = [t for t in terms if not t["subsystem_id"]]
        scoped = [t for t in terms if t["subsystem_id"]]
        if global_terms:
            blocks.append(_section("Codebase-wide", *(b for t in global_terms for b in term_blocks(t))))
        if scoped:
            # Group by subsystem_id.
            by_ss: dict[str, list[dict[str, Any]]] = {}
            for t in scoped:
                by_ss.setdefault(t["subsystem_id"], []).append(t)
            for sid, items in by_ss.items():
                blocks.append(_section(f"Scoped to **{sid}**", *(b for t in items for b in term_blocks(t))))

    # §4.5: a subsystem that answered "none" is listed, with its reason, so a
    # reader can tell it from a subsystem nobody asked. The denominator is
    # every registered subsystem, because a count of declinations with nothing
    # to divide it by says nothing about how much of the map answered.
    declined = _declinations(conn)
    scoped_terms = _vocabulary_terms(conn)
    registered = [str(s["id"]) for s in rows(conn, "SELECT id FROM subsystems ORDER BY id")]
    workspace = resolve_workspace(storage)
    states = {
        sid: _vocabulary_state(scoped_terms.get(sid, []), declined.get(sid, []), workspace)
        for sid in registered
    }
    current = [sid for sid in registered if states[sid] == "declined"]
    superseded = [
        sid for sid in registered if states[sid] == "terms" and declined.get(sid)
    ]
    if current or superseded:
        index: list[Block] = []
        if current:
            index.append(
                _bullets([f"**{sid}** — {_declination_sentence(declined[sid][0])}" for sid in current])
            )
        elif superseded:
            index.append(_paragraph("No subsystem's current state is a declination."))
        if superseded:
            index.append(
                _paragraph(
                    f"{_count(len(superseded), 'further subsystem')} declared none earlier and"
                    " has since recorded a term; the judgment is kept on each subsystem's page"
                    f" as superseded history: {', '.join(f'**{sid}**' for sid in superseded)}."
                )
            )
        blocks.append(_section(f"{VOCABULARY_INDEX_HEADING} ({len(current)} of {len(registered)})", *index))
    return Page("Glossary", "vocabulary.html", tuple(blocks)), {
        **_db_source("vocab:all", terms),
        **_db_source("vocab:declined", declined),
    }


def render_field_notes(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The Unresolved lens for leads: observations still open (§6.1, §7.1).

    Closed leads move to `resolved-leads.html`, where the page states what the
    store does not record about how they got there. `field_notes.follow_up` is
    free text whose one reserved value is `open`, so membership is the negation
    of that value rather than a list of terminal ones.
    """

    del storage  # the notes are the only source this page reads

    notes = rows(
        conn,
        "SELECT * FROM field_notes WHERE COALESCE(follow_up,'open')='open'"
        " ORDER BY created_at DESC, id DESC",
    )
    closed = row(
        conn,
        "SELECT COUNT(*) AS n FROM field_notes WHERE COALESCE(follow_up,'open')<>'open'",
    ) or {"n": 0}
    blocks: list[Block] = [
        _paragraph(
            "_Observations from every survey pass that are not yet findings: patterns, "
            "anomalies, connections, tensions, and candidate concerns recorded when a "
            "reader noticed something the phase structure did not ask for. Closed leads "
            "are on [Resolved leads and questions](resolved-leads.html)._"
        )
    ]
    if not notes:
        blocks += _empty_lens_blocks(
            conn,
            "No lead is open."
            f" {_count(int(closed['n'] or 0), 'closed lead')} are on"
            " [Resolved leads and questions](resolved-leads.html).",
            "observations a survey pass recorded that are not yet findings and have"
            " not been closed.",
            "`field_notes` whose `follow_up` is still `open`.",
        )
    else:
        by_cat: dict[str, list[dict[str, Any]]] = {}
        for n in notes:
            by_cat.setdefault(n["category"], []).append(n)
        # Candidate concerns first: a lead that names a failure mode is the one
        # a reader can act on, and the rest are ordered by how much they
        # constrain a later reading (§6.1).
        for cat in ("candidate-concern", "tension", "anomaly", "connection", "pattern"):
            items = by_cat.get(cat, [])
            if not items:
                continue
            leads = []
            for n in items:
                loc = f" @ `{n['location']}`" if n["location"] else ""
                leads.append(
                    f'<a id="{lead_anchor(n["id"])}"></a>{_one_line(n["observation"])}{loc}'
                    f" · _recorded {_fmt_time(n['created_at'])}_"
                )
            blocks.append(
                _section(
                    cat.replace("-", " ").capitalize(),
                    _paragraph(f"_{_count(len(items), 'open lead')}._"),
                    _bullets(leads),
                )
            )
    return Page("Leads", "field-notes.html", tuple(blocks)), {
        **_db_source("notes:open", notes),
        **_db_source("notes:closed-count", closed),
    }


# What each stale section says about its own rows (§6.1, §11.3). Written per
# classification because the three readings differ: an examined file's drift
# invalidates a reading that was taken, a candidate's drift happened before
# anyone read it, and a deferred file's drift happened after the survey decided
# not to read it yet. One shared sentence would have to be vague enough to be
# true of all three, which is how "stale" came to mean four things.
#
# `revision` names the column too, because `file_ledger.ref_sha` means something
# different in each: the revision a file was read at, scoped at, or deferred at.
# Heading a candidate's revision "Read at" would assert a reading nobody took.
LEDGER_STALE_SECTION_COPY: dict[str, dict[str, str]] = {
    "examined": {
        "measured": (
            "{stale} of {total} examined {files} {have} changed since the revision"
            " {they_were} read at."
        ),
        "absent": "No file in this ledger is classified examined.",
        "revision": "Read at",
    },
    "candidate": {
        "measured": (
            "{stale} of {total} {files} in scope but not yet read {have} changed"
            " since {they_were} scoped."
        ),
        "absent": "No file in this ledger is scoped and still unread.",
        "revision": "Scoped at",
    },
    "deferred-with-reason": {
        "measured": (
            "{stale} of {total} {files} deferred with a recorded reason {have}"
            " changed since {they_were} set aside."
        ),
        "absent": "No file in this ledger is deferred with a recorded reason.",
        "revision": "Deferred at",
    },
}

LEDGER_STALE_FALLBACK_COPY: dict[str, str] = {
    "measured": "{stale} of {total} {files} carrying this classification {have} changed.",
    "absent": "No file in this ledger carries this classification.",
    "revision": "Recorded at",
}


def _denominator_sentence(template: str, stale: int, total: int) -> str:
    """Fill a section's sentence, agreeing in number with what it counts.

    The noun follows the denominator and the verb follows the numerator, which
    is what English does: *1 of 3 files has changed*, *1 of 1 file has changed*.
    """

    return template.format(
        stale=stale,
        total=total,
        files="file" if total == 1 else "files",
        have="has" if stale == 1 else "have",
        they_were="it was" if stale == 1 else "they were",
    )


def render_stale(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The freshness page: one marked record per obligation-bearing stale row.

    Membership is partitioned by classification rather than by staleness
    (§6.1). `detect_changes` marks drift on every ledger row carrying a
    `ref_sha` regardless of classification, so a file nobody has read can be
    stale; reporting it under "Examined files the repository has changed under"
    would assert a reading that was never taken. Each section therefore carries
    its own denominator, and the sections together claim every
    obligation-bearing classification exactly once, which the state read-back
    axis checks (§11.3).

    Rows exempt from the survey obligation — generated, vendored, and
    irrelevant paths — are counted on the overview and are deliberately not
    recorded here: their drift is not survey staleness.
    """

    del storage  # the ledger is the only source this page reads

    ledger = rows(
        conn,
        "SELECT subsystem_id, file_path, why_in_scope,"
        " COALESCE(classification,'candidate') AS classification,"
        " ref_sha, stale, stale_since, stale_reason"
        f" FROM file_ledger WHERE {survey_filter(conn)} ORDER BY subsystem_id, file_path",
    )
    freshness = ledger_freshness(conn)
    names = {
        str(s["id"]): str(s["name"])
        for s in rows(conn, "SELECT id, name FROM subsystems")
    }

    blocks: list[Block] = []
    git = row(conn, "SELECT * FROM git_state WHERE repo_id='default'") or {}
    checked = str(git.get("last_checked_sha") or "")
    branch = str(git.get("canonical_branch") or "not recorded")
    if not freshness["scoped_files"]:
        blocks += _empty_lens_blocks(
            conn,
            "No file is recorded in the ledger, so this projection does not measure"
            " freshness. Nothing below is a claim that the survey is current; it is"
            " a statement that nothing was measured.",
            "ledger rows carrying a survey obligation that the repository has changed"
            " under, partitioned by what the row's revision records.",
            "`file_ledger`, read for rows marked stale by `detect_changes`.",
        )
    else:
        blocks.append(
            _paragraph(
                f"{freshness['stale_obligation']} of {freshness['obligation_files']} files"
                f" carrying a survey obligation are recorded as changed since the revision"
                f" the ledger names, checked at {_short(checked)} on `{branch}`."
                f" {freshness['stale_exempt']} of"
                f" {freshness['scoped_files'] - freshness['obligation_files']} scoped files"
                " exempt from that obligation have also changed; they are counted on the"
                " [overview](index.html) and are not recorded here, because drift in"
                " generated or vendored territory is not survey staleness."
            )
        )

    for heading, classifications in LEDGER_STALE_SECTIONS:
        body: list[Block] = []
        for classification in classifications:
            in_class = [r for r in ledger if r["classification"] == classification]
            stale_rows = [r for r in in_class if int(r["stale"] or 0)]
            copy = LEDGER_STALE_SECTION_COPY.get(classification, LEDGER_STALE_FALLBACK_COPY)
            body.append(
                _paragraph(
                    _denominator_sentence(copy["measured"], len(stale_rows), len(in_class))
                    if in_class
                    else copy["absent"]
                )
            )
            if stale_rows:
                body.append(_ledger_stale_table(stale_rows, names, copy["revision"], _caption(heading)))
        blocks.append(_section(heading, *body))

    sources = {
        **_db_source("stale:ledger", ledger),
        **_db_source("stale:freshness", freshness),
        **_db_source("stale:git", git),
        **_db_source("stale:names", names),
    }
    return Page("Stale knowledge", "stale.html", tuple(blocks)), sources


def _ledger_stale_table(
    stale_rows: Sequence[dict[str, Any]],
    names: dict[str, str],
    revision_column: str,
    caption: str,
) -> Table:
    """One section's stale rows as full marked records (§6.2).

    The ledger is a register: the path and the account of why it is in scope
    carry the reading, and the revision and drift facts stay subordinate
    (`reporting-style.md`). `revision_column` names what the row's `ref_sha`
    actually records for this classification.
    """

    body: list[Row] = []
    for r in stale_rows:
        subsystem_id = str(r["subsystem_id"])
        file_path = str(r["file_path"])
        name = names.get(subsystem_id, subsystem_id)
        anchor = ledger_stale_anchor(subsystem_id, file_path)
        cells = (
            f'<a id="{anchor}"></a>`{file_path}`',
            f"[{name}]({subsystem_page(subsystem_id, name)})",
            f"`{(str(r['ref_sha'] or '—'))[:8]}`",
            _fmt_time(r["stale_since"]) if r["stale_since"] else "—",
            _table_cell(r["stale_reason"] or "not recorded"),
            _table_cell(r["why_in_scope"] or "—"),
        )
        body.append(
            Row(tuple(inlines(cell) for cell in cells), (ledger_stale_marker(subsystem_id, file_path),))
        )
    headers = ("File", "Owner", revision_column, "Drift recorded", "Reason", "Why in scope")
    return Table(caption, tuple(inlines(header) for header in headers), tuple(body))


# The reader's guide is generated, not written (§7.8, §10.2). Its terms and
# tables come from `mcp-server/contracts/conspectus-vocabulary.json` by way of
# the generated `vocabulary.py`, and the route table comes from the page plan,
# so a value the server enforces or a page the projection publishes cannot be
# missing from the guide without the generator changing. The sections run in
# the order PLAN §4 O3 gives: what the site is, pages, how a survey works,
# terms, how IDs are formed, status values, then the vocabulary a reader never
# sees as a label.
GUIDE_TITLE = "How to read this survey"
SURVEY_SECTION = "How a survey works"

# Appendix C, "What this site is". The project name is the only variable. The
# second paragraph (PLAN §4 O14, rewritten by store-only SO13 for the one view
# left) says where the site starts and what a copy must keep; it has no code
# span, since the guide's first 600 bytes carry none.
SITE_IS = (
    "This site is the record of an AI agent's survey of {name}. The agent read the code,"
    " recorded what it concluded and the code each conclusion rests on, and listed what it"
    " could not settle. It does not change the code. Every page is as of one commit, shown"
    " at the top of each HTML page as *Checked* and in the overview's *Checked at* row."
)
SITE_VIEWS = (
    "Each page is HTML, written to one directory that starts at index.html. The diagrams, the"
    " search and the definitions shown on hover need nothing outside that directory, so a copy"
    " of the whole directory reads the same."
)

# A term's `pages` may name a family; the family's listing page stands for it.
_FAMILY_LISTINGS: dict[str, tuple[str, str]] = {
    "subsystems/*.md": ("Subsystem pages", "master-plan.html"),
    "diagnosticity/*.md": ("Evidence tables", "diagnosticity.html"),
}


def term_slug(term: str) -> str:
    """The anchor suffix for a term: `#term-<slug>` on the guide."""

    return re.sub(r"[^a-z0-9]+", "-", term.lower()).strip("-")


def page_terms(page: str) -> tuple[tuple[str, str], ...]:
    """The `READER_TERMS` entries a page names, as `(term, anchor slug)` in contract order.

    A term's `pages` holds exact page paths, or a family glob (`subsystems/*.md`)
    for every page directly under that directory. The contract names pages by the
    stem the server shares; a page here is its `.html` path.
    """

    found: list[tuple[str, str]] = []
    for entry in READER_TERMS:
        for pattern in entry.get("pages") or ():  # type: ignore[union-attr]
            pattern = str(pattern).removesuffix(".md") + ".html"
            if pattern == page or (
                pattern.endswith("/*.html")
                and page.startswith(pattern[: -len("*.html")])
                and "/" not in page[len(pattern) - len("*.html") :]
            ):
                term = str(entry["term"])
                found.append((term, term_slug(term)))
                break
    return tuple(found)


def _enum_heading(name: str) -> str:
    """A reader-facing name for one enum; the stored name goes beside it.

    The plain name is the contract's `title` (every reader-facing enum carries
    one); an internal enum without one falls back to its stored name's words.
    """

    title = VOCABULARY.get(name, {}).get("title")
    return str(title) if title else name.replace("_", " ").capitalize()


def _site_is(name: str) -> Section:
    return _section("What this site is", _paragraph(SITE_IS.format(name=name)), _paragraph(SITE_VIEWS))


# Appendix C, "How a survey works". The surrounding sentences are constants; the
# pass table's labels, meanings and timing come from the contract (`SURVEY_PASSES`
# and `subsystem_status`), so the guide cannot drift from what the server enforces.
SURVEY_LEAD = (
    "The agent works in two stages and does not wait for approval between steps."
)
SURVEY_ONBOARDING = (
    "**Onboarding**, once. The agent reads the repository's shape, splits it into"
    " subsystems grouped by layer, writes a review checklist of defects worth looking"
    " for in this codebase, ranks the subsystems, and publishes the first version of"
    " this site."
)
SURVEY_EACH = (
    "**A survey of each subsystem**, highest priority first, in {passes} passes:"
)
SURVEY_IN_PROGRESS = (
    "A subsystem shown as {labels} is in the middle of that pass: its verdicts and"
    " findings so far are not the last word."
)
SURVEY_REFRESH = (
    "**Refresh**, when the code changes. The agent re-reads files that changed since it"
    " read them. Until then they are listed on Stale knowledge."
)
EXPECTS_HEADING = "What it expects from you"
SURVEY_EXPECTS = (
    "- Nothing, for it to keep going. When it cannot decide something, it records a"
    " *decision needed* with the assumption it used, and carries on.",
    "- At each checkpoint (after onboarding, after each subsystem, and at the start of"
    " each session) it posts a summary in your chat. Read **Decisions needed** then, and"
    " answer what you can by telling the agent in your session. This site is read-only;"
    " answers reach the record only through the agent.",
    '- You can redirect it at any time: name a subsystem to survey next, say "stop", or'
    ' ask "what do we know about `<file>`".',
)
PHASES_HEADING = "Phase numbers"
PHASES_LEAD = (
    'Notes written by the agent may say "Phase 2". The numbers belong to one of two'
    " sequences:"
)
ONBOARDING_PHASES = "0–7"
ONBOARDING_PHASES_MEANING = "The one-time stage above, before any subsystem is surveyed."
_NUMBER_WORDS = {2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven"}

# How the table says when a pass sets its depth (D4): the depths that name a
# finished pass are set when it ends, the two that name one under way as it starts.
_WHEN = {"end": "when the pass is done", "start": "as the pass starts"}


def _survey_passes_section() -> Section:
    """Appendix C's "How a survey works", the pass table generated from the contract."""

    spec = [dict(p) for p in SURVEY_PASSES]
    count = len(spec)
    passes: list[list[str]] = []
    for p in spec:
        status = str(p["status"])
        label = SUBSYSTEM_STATUS_LABELS.get(status, status)
        passes.append(
            [
                _table_cell(p["pass"]),
                _table_cell(p["does"]),
                f"**{_table_cell(label)}**, {_WHEN.get(str(p['set_when']), str(p['set_when']))}",
                _table_cell(SUBSYSTEM_STATUS_MEANINGS.get(status, "")),
            ]
        )
    under_way = [
        f"*{SUBSYSTEM_STATUS_LABELS.get(str(p['status']), p['status'])}*"
        for p in spec
        if p["set_when"] == "start"
    ]
    phases = [int(str(p["phase"])) for p in spec]
    survey_phases = f"{min(phases)}–{max(phases)}"
    named = ", ".join(f"{p['pass']} ({p['phase']})" for p in spec)
    caption = _caption(SURVEY_SECTION)
    return _section(
        SURVEY_SECTION,
        _paragraph(SURVEY_LEAD),
        _paragraph(SURVEY_ONBOARDING),
        _paragraph(SURVEY_EACH.format(passes=_NUMBER_WORDS.get(count, str(count)))),
        _table(
            caption,
            ["Pass", "What the agent does", "Survey depth it sets, and when", "What that depth means"],
            passes,
        ),
        _paragraph(SURVEY_IN_PROGRESS.format(labels=" or ".join(under_way))),
        survey_workflow_model(),
        status_ladder_model(),
        _paragraph(SURVEY_REFRESH),
        _heading(3, EXPECTS_HEADING),
        _bullets([item.removeprefix("- ") for item in SURVEY_EXPECTS]),
        _heading(3, PHASES_HEADING),
        _paragraph(PHASES_LEAD),
        _table(
            caption,
            ["Numbering", "Phases", "What they are"],
            [
                ["Onboarding", ONBOARDING_PHASES, ONBOARDING_PHASES_MEANING],
                ["Subsystem survey", survey_phases, f"{_table_cell(named)}, in order."],
            ],
        ),
    )


def _terms_section(routes: Sequence[tuple[str, str, str, str, str, str]]) -> Section:
    """One entry per `READER_TERMS` row, anchored for the pages that link to it."""

    # Only planned pages are linked: a term's `pages` may name a prose page this
    # store has no source for, and a link to it would not resolve (read-back).
    labels = {route[0]: route[1] for route in routes}
    blocks: list[Block] = [
        _paragraph("Words this site uses in a particular sense. Each entry says where you will meet it."),
    ]
    for entry in READER_TERMS:
        term = str(entry["term"])
        blocks += [Anchor(f"term-{term_slug(term)}"), _heading(3, term)]
        aliases = [str(alias) for alias in entry.get("aliases") or ()]  # type: ignore[union-attr]
        if aliases:
            blocks.append(_paragraph(f"*Also called: {', '.join(aliases)}.*"))
        blocks.append(_paragraph(str(entry["definition"])))
        links: list[str] = []
        for page in entry.get("pages") or ():  # type: ignore[union-attr]
            page = str(page)
            if page in _FAMILY_LISTINGS:
                label, target = _FAMILY_LISTINGS[page]
            elif (target := page.removesuffix(".md") + ".html") in labels:
                label = labels[target]
            else:
                continue  # not planned for this store (a prose page with no source)
            link = f"[{label}]({target})"
            if link not in links:
                links.append(link)
        if links:
            blocks.append(_paragraph(f"Seen on: {', '.join(links)}"))
    return _section("Terms", *blocks)


# Appendix B, "How IDs are formed" (PLAN §2.2 items 1 and 2, D1). The kinds come
# from the contract (`ID_KINDS`); the example in each row and the sentence about
# this store's subsystem letters come from the store, so both stay true per store
# without any rule at onboarding.
IDS_SECTION = "How IDs are formed"
IDS_LEAD = (
    "IDs are short labels so records can point at each other. Except where this page"
    " says otherwise, the letters are not a code: read the name beside the ID."
)
LETTERS_ARE_LAYERS = "Here the letter is the layer: {pairs}."
LETTERS_ENCODE_NOTHING = (
    "The letters were chosen when the survey began and do not encode anything."
    " Read the name beside the ID."
)
NO_EXAMPLE = "none yet"


def _id_letters(identifier: str) -> str:
    """A subsystem ID's leading letters: `R` for `R-06`, `auth` for `auth`."""

    match = re.match(r"[A-Za-z]+", identifier)
    return match.group(0) if match else identifier[:1]


def subsystem_letter_key(subsystems: Sequence[tuple[str, str | None]]) -> str | None:
    """What this store's subsystem letters say, from `(id, layer)` pairs.

    The letter is the layer only when every letter's subsystems sit in one
    layer and no layer is spelled by two letters; a letter that is right most of
    the time is worse for a reader than one that is plainly arbitrary (§2.2).
    """

    if not subsystems:
        return None
    layers: dict[str, set[str | None]] = {}
    for identifier, layer in subsystems:
        layers.setdefault(_id_letters(identifier), set()).add(layer or None)
    owners: dict[str, set[str]] = {}
    for letter, found in layers.items():
        for layer in found:
            owners.setdefault(str(layer), set()).add(letter)
    one_to_one = all(
        len(found) == 1 and None not in found for found in layers.values()
    ) and all(len(letters) == 1 for letters in owners.values())
    if not one_to_one:
        return LETTERS_ENCODE_NOTHING
    pairs = ", ".join(
        f"{letter} is {next(iter(layers[letter]))}" for letter in sorted(layers)
    )
    return LETTERS_ARE_LAYERS.format(pairs=pairs)


def _id_examples(conn: sqlite3.Connection) -> dict[str, str]:
    """One ID per kind from this store, keyed by `ID_KINDS[*].kind`."""

    def first(sql: str) -> str | None:
        found = row(conn, sql)
        return None if found is None or found["v"] is None else str(found["v"])

    concerns = [str(r["code"]) for r in rows(conn, "SELECT code FROM concerns ORDER BY code")]
    matrix = first("SELECT MIN(id) AS v FROM diagnosticity_sessions")
    decision = first("SELECT MIN(id) AS v FROM open_questions")
    found = {
        "Subsystem": first("SELECT MIN(id) AS v FROM subsystems"),
        "Finding": first("SELECT MIN(finding_id) AS v FROM findings"),
        "Seam": first("SELECT MIN(id) AS v FROM seams"),
        "Concern": next((c for c in concerns if not c.startswith("SC-")), None),
        "Seam concern": next((c for c in concerns if c.startswith("SC-")), None),
        "Competing explanations": f"DM-{matrix}" if matrix else None,
        "Decision": f"#{decision}" if decision else None,
    }
    return {kind: example for kind, example in found.items() if example}


def _ids_section(conn: sqlite3.Connection) -> Section:
    """Appendix B's table of ID kinds, with this store's examples and letter key."""

    key = subsystem_letter_key(
        [(str(r["id"]), r["layer"]) for r in rows(conn, "SELECT id, layer FROM subsystems ORDER BY id")]
    )
    examples = _id_examples(conn)
    kinds = [
        [
            _table_cell(str(kind["kind"])),
            _table_cell(kind["shape"]),
            _table_cell(kind["names"]),
            _table_cell(kind["chosen_by"]),
            _table_cell(examples.get(str(kind["kind"]), NO_EXAMPLE)),
            _table_cell(kind["links_to"]),
        ]
        for kind in ID_KINDS
    ]
    return _section(
        IDS_SECTION,
        _paragraph(IDS_LEAD),
        *((_paragraph(key),) if key else ()),
        _table(
            _caption(IDS_SECTION),
            ["Kind", "Shape", "Names", "Chosen by", "Example here", "Links to"],
            kinds,
        ),
    )


def _enum_tables(heading: str, lede: str, reader_facing: bool) -> tuple[Block, ...]:
    """The enum tables whose `reader_facing` flag matches, in declared order."""

    blocks: list[Block] = [_paragraph(lede)]
    for name, definition in VOCABULARY.items():
        if bool(definition.get("reader_facing")) != reader_facing:
            continue
        axis = str(definition.get("axis") or "")
        blocks += [
            _heading(3, _enum_heading(name)),
            _paragraph(f"Stored as `{name}`" + (f" · {axis} axis" if axis else "")),
            EnumTable(
                _caption(heading),
                tuple(
                    inlines(header)
                    for header in ("Value", "Label", "What it means", "What it cannot justify")
                ),
                tuple(
                    Row(
                        (
                            # The stored value prints literally, as the code it is.
                            Inlines((CodeSpan(str(entry["value"])),), str(entry["value"])),
                            inlines(_table_cell(entry["label"])),
                            inlines(_table_cell(entry["meaning"])),
                            inlines(_table_cell(entry["cannot_justify"])),
                        )
                    )
                    for entry in definition.get("values") or ()  # type: ignore[union-attr]
                ),
            ),
        ]
    return tuple(blocks)


def _vocabulary_tables() -> tuple[Section, Section]:
    """Status values, then the full vocabulary, from the enum source (§7.8).

    The second section holds the tables a reader never meets as a label, so it
    stays closed until asked for.
    """

    status = "Status values"
    full = "Full vocabulary"
    return (
        _section(
            status,
            *_enum_tables(
                status,
                "The values this site prints as labels, from the vocabulary contract, version"
                f" `{VOCABULARY_CONTRACT_VERSION}`: the same source the server checks writes"
                " against. Each table gives the label, what it means, and what it cannot justify.",
                True,
            ),
        ),
        _section(
            full,
            Details(
                "Show the full vocabulary",
                _enum_tables(
                    full,
                    "The remaining values the record stores, which the pages rarely print as labels."
                    " They come from the same contract.",
                    False,
                ),
            ),
        ),
    )


# A subgroup is a family with one page per record, so the index gives it one
# row. The row routes to the page that lists the family's members: the
# subsystem map and the competing-explanations index.
_SUBGROUP_ROWS: dict[str, tuple[str, str, str]] = {
    "Subsystems": ("Subsystem pages", "master-plan.html", "one page per subsystem"),
    "Evidence matrices": ("Evidence tables", "diagnosticity.html", "one page per evidence matrix"),
}


def _route_tables(routes: Sequence[tuple[str, str, str, str, str, str]]) -> Section:
    """The index of pages, generated from the page plan (§7.8, PLAN §2.4).

    Written from the plan rather than by hand so a page cannot be published and
    left unroutable: the guide is the one page a stranger is told to read, and a
    site index that silently omits a lens is worse than none. Families with one
    page per record take one row each, so the table stays the length of the
    site's structure, not of the surveyed codebase.
    """

    lens_meanings = meanings("lens")
    title = "Pages on this site"
    blocks: list[Block] = [
        _paragraph(
            "Every kind of page this survey publishes, grouped by lens. The lens says"
            " what kind of claim a page carries. Subsystem pages and evidence tables"
            " take one row each; the pages they stand for are listed on the pages"
            " the rows link to."
        ),
    ]
    groups: dict[str, list[tuple[str, str, str, str, str, str]]] = {}
    for route in routes:
        groups.setdefault(route[3], []).append(route)
    for group, members in groups.items():
        blocks.append(_heading(3, group))
        meaning = lens_meanings.get(group.lower())
        if meaning:
            blocks.append(_paragraph(meaning))
        pages: list[list[str]] = []
        done: set[str] = set()
        for path, label, hint, _group, subgroup, use_when in members:
            if subgroup:
                if subgroup in done:
                    continue
                done.add(subgroup)
                family = [m for m in members if m[4] == subgroup]
                name, target, scope = _SUBGROUP_ROWS.get(
                    subgroup, (subgroup, path, "one page per record")
                )
                pages.append(
                    [f"[{name}]({target})", _table_cell(f"{len(family)} pages, {scope}."), _table_cell(use_when)]
                )
                continue
            pages.append([f"[{label}]({path})", _table_cell(hint), _table_cell(use_when)])
        blocks.append(_table(_caption(title), ["Page", "What it shows", "Use it when"], pages))
    return _section(title, *blocks)


def render_how_to_read(
    conn: sqlite3.Connection,
    storage: Path,
    routes: Sequence[tuple[str, str, str, str, str, str]] | None = None,
) -> RenderResult:
    """The reader's guide, generated from the enum source and the page plan.

    It was a static string constant, which is how its evidence-quality table
    came to list five of the nine kinds the schema accepts and its finding-status
    table came to carry neither `fixed-pending-verification` nor
    `verified-fixed`. Nothing kept them in step, so nothing did.
    """

    sections = [
        _site_is(project_name(conn, storage)),
        _route_tables(routes or ()),
        _survey_passes_section(),
        _terms_section(routes or ()),
        _ids_section(conn),
        *_vocabulary_tables(),
    ]
    page = Page(GUIDE_TITLE, "how-to-read.html", tuple(sections))
    return page, {
        "synthetic:how-to-read": _hash_text(repr(page)),
        "synthetic:how-to-read-contract": _hash_text(VOCABULARY_CONTRACT_VERSION),
    }


def _hash_text(s: str) -> str:
    return sha256(s.encode("utf-8")).hexdigest()[:16]


# §6.1 orders the decision docket by consequence: a question whose two answers
# disagree about the record itself blocks the most, and one that only ranks
# work blocks the least. The order is declared here rather than taken from the
# CHECK's declaration order, which is not a consequence ranking.
OPEN_QUESTION_ORDER: tuple[str, ...] = (
    "contradiction",
    "domain-knowledge",
    "ambiguous-evidence",
    "scope-judgment",
    "tooling-limit",
    "priority-ranking",
    "other",
)


# §2.3 (W1): a reader cannot call the tool that records an answer, and this site
# is read-only, so the page says where an answer goes.
HOW_TO_ANSWER = (
    "To answer, tell the agent in your session, for example: “Decision #12: tenancy is"
    " per account.” This site is read-only."
)


def render_open_questions(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The Unresolved lens for decisions: questions still open (§6.1, §7.1).

    Answered, dismissed, and superseded questions move to `resolved-leads.html`.
    This page is the decision docket: what is still unsettled, what each
    question blocked, and the assumption the survey proceeded with so a reader
    can tell how much of the record rests on it.
    """

    del storage  # unused — kept for renderer signature uniformity

    questions = rows(
        conn,
        "SELECT * FROM open_questions WHERE COALESCE(resolution,'open')='open'"
        " ORDER BY created_at DESC, id DESC",
    )
    closed = row(
        conn,
        "SELECT COUNT(*) AS n FROM open_questions"
        " WHERE COALESCE(resolution,'open')<>'open'",
    ) or {"n": 0}
    sources = {
        **_db_source("open_questions:open", questions),
        **_db_source("open_questions:closed-count", closed),
    }
    blocks: list[Block] = [
        _paragraph(
            "_Questions the survey could not settle on its own. Each records what it "
            "blocked and the assumption the survey proceeded with, so a reader can see "
            "which readings would change if the assumption turns out wrong. Questions "
            "already settled are on "
            "[Resolved leads and questions](resolved-leads.html)._"
        ),
        _paragraph(HOW_TO_ANSWER),
    ]
    if not questions:
        blocks += _empty_lens_blocks(
            conn,
            "No question is open."
            f" {_count(int(closed['n'] or 0), 'settled question')} are on"
            " [Resolved leads and questions](resolved-leads.html).",
            "questions the survey could not settle, with what each one blocked and"
            " the assumption used to keep moving.",
            "`open_questions` whose resolution is still `open`.",
        )
        return Page("Decisions needed", "open-questions.html", tuple(blocks)), sources

    by_cat: dict[str, list[dict[str, Any]]] = {}
    for q in questions:
        by_cat.setdefault(str(q["category"]), []).append(q)
    ordered = list(OPEN_QUESTION_ORDER) + sorted(
        cat for cat in by_cat if cat not in OPEN_QUESTION_ORDER
    )
    for cat in ordered:
        items = by_cat.get(cat, [])
        if not items:
            continue
        body: list[Block] = [_paragraph(f"_{_count(len(items), 'open question')}._")]
        for q in items:
            loc = f" · subsystem **{q['subsystem_id']}**" if q["subsystem_id"] else ""
            phase = f" · phase `{q['phase']}`" if q["phase"] else ""
            facts = []
            if q["what_blocked"]:
                facts.append(f"**What this blocked** — {_one_line(q['what_blocked'])}")
            if q["what_assumed"]:
                facts.append(f"**Assumption the survey proceeded with** — {_one_line(q['what_assumed'])}")
            facts.append(f"**Recorded** — {_fmt_time(q['created_at'])}.")
            body += [
                Anchor(question_anchor(q["id"])),
                _heading(3, f"#{q['id']}{loc}{phase}"),
                Quote(inlines(_one_line(q["question"]))),
                _bullets(facts),
            ]
        blocks.append(_section(cat.replace("-", " ").capitalize(), *body))

    return Page("Decisions needed", "open-questions.html", tuple(blocks)), sources


# ---------------------------------------------------------------------------
# Files index and the recorded edge of the map (§7.4, §7.5)
# ---------------------------------------------------------------------------


# §2.4.6. `dispositions`' primary key is `(subsystem_id, concern_code)` — no
# seam id — and `composition_seam_concerns` holds no rows on any store we have
# read, so an `SC-%` disposition says *this party has assessed some seam
# concern*, never *this party has assessed this seam*. The sentence travels
# with every reading built on that proxy.
PER_PARTY_PROXY = (
    "Binding: per-party-proxy; no seam-bound disposition is recorded. An `SC-%`"
    " disposition says a party has assessed some seam concern, never that it"
    " assessed this seam."
)


#: The heading a subsystem outside the survey is published under (design/scope/PLAN.md §2.6a).
OUTSIDE_SURVEY_HEADING = "Outside this survey"


def file_anchor(file_path: str) -> str:
    """The Files index anchor for one path (§7.4).

    Not `slugify`: it collapses every run of non-`[a-z0-9-]` characters, so
    `src/a/b.ts`, `src/a-b.ts`, and `src/a.b.ts` would share one id and two of
    the three rows would be unreachable. The digest does not collide; the
    readable path stays beside it as link text.
    """

    return "f-" + sha1(file_path.encode("utf-8")).hexdigest()[:10]


def ledger_entry_anchor(subsystem_id: str, file_path: str) -> str:
    """The anchor for one `(subsystem, path)` ledger entry on a subsystem page.

    The Files index carries the path anchor and links onward to the owning
    subsystem's ledger entry, so no per-file page is generated (decision 3).
    Keyed on the ledger's own primary key, because 53 paths on the AxiomDB
    store have more than one owner and each owner records its own reading.
    """

    token = sha1(f"{subsystem_id}\x00{file_path}".encode()).hexdigest()
    return f"le-{token[:10]}"


def _open_defects_by_path(conn: sqlite3.Connection) -> dict[str, int]:
    """Open and awaiting-verification findings per cited path (§7.4).

    `findings.primary_files` is a JSON array of `file:symbol@sha` citations
    (`schema.sql:285`), so a citation matches a path when it equals it or
    begins `<path>:`. Resolved findings are not counted: the column says how
    much open work cites the file, and a verified repair is not open work.
    """

    counts: dict[str, int] = {}
    open_states = FINDING_LENS_STATES.get("findings.html", ())
    if not open_states:
        return counts
    placeholders = ",".join("?" for _ in open_states)
    for f in rows(
        conn,
        "SELECT f.finding_id, f.primary_files FROM findings f"
        " JOIN finding_state_current v ON v.finding_id = f.finding_id"
        f" WHERE v.resolution_state IN ({placeholders})",
        tuple(open_states),
    ):
        try:
            cited = json.loads(f["primary_files"]) if f["primary_files"] else []
        except json.JSONDecodeError:
            cited = []
        seen: set[str] = set()
        for citation in cited:
            path = str(citation).split(":", 1)[0].strip()
            if path and path not in seen:
                seen.add(path)
                counts[path] = counts.get(path, 0) + 1
    return counts


def render_files(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """One row per distinct ledger path (§7.4).

    Two things this page refuses to flatten. Every owner is listed, because
    `file_ledger`'s key is `(subsystem_id, file_path)` and a path with ten
    owners is not a path with one. And the examined revision is **per owner**:
    two subsystems can record different examination revisions for one path, so
    a single value is printed only when every owner agrees — printing one
    anyway would assert an agreement the ledger does not record.
    """

    del storage  # the ledger and the standing view are the only sources

    standing = rows(
        conn,
        "SELECT file_path, subsystem_id, subsystem_name, classification,"
        " standing_state, ref_sha, examined_at, stale, stale_reason"
        f" FROM file_standing WHERE {survey_filter(conn)} ORDER BY file_path, subsystem_id",
    )
    defects = _open_defects_by_path(conn)
    git = row(conn, "SELECT * FROM git_state WHERE repo_id='default'") or {}
    checked = str(git.get("last_checked_sha") or "")

    by_path: dict[str, list[dict[str, Any]]] = {}
    for entry in standing:
        by_path.setdefault(str(entry["file_path"]), []).append(entry)

    blocks: list[Block] = []
    if not by_path:
        blocks.append(
            _paragraph(
                "No file is recorded in the ledger, so this index has nothing to show."
                " That is a statement about the record, not about the repository: no"
                " path here has been read, excluded, or even scoped."
            )
        )
    else:
        blocks.append(
            _paragraph(
                f"{_count(len(by_path), 'distinct path')} across"
                f" {_count(len(standing), 'ledger row')},"
                f" read at {_short(checked)}. Every owner of a path is listed, and the"
                " examined revision is the one that owner recorded — two subsystems"
                " may have read the same file at different revisions."
            )
        )
        body: list[list[str]] = []
        for file_path in sorted(by_path):
            owners = by_path[file_path]
            states = {str(o["standing_state"]) for o in owners}
            headline = next(iter(states)) if len(states) == 1 else "mixed"
            revisions = {str(o["ref_sha"] or "") for o in owners}
            if len(revisions) == 1:
                revision = f"`{(next(iter(revisions)) or '—')[:8]}`"
            else:
                revision = " · ".join(
                    f"{str(o['subsystem_name'] or o['subsystem_id'])}"
                    f" `{(str(o['ref_sha'] or '—'))[:8]}`"
                    for o in owners
                )
            owner_links = " · ".join(
                f"[{str(o['subsystem_name'] or o['subsystem_id'])}]"
                f"({subsystem_page(str(o['subsystem_id']), str(o['subsystem_name'] or ''))}"
                f"#{ledger_entry_anchor(str(o['subsystem_id']), file_path)})"
                for o in owners
            )
            body.append(
                [
                    f'<a id="{file_anchor(file_path)}"></a>`{file_path}`',
                    owner_links,
                    STANDING_LABELS.get(headline, headline),
                    revision,
                    str(defects.get(file_path, 0)),
                ]
            )
        blocks.append(_table("Files", ("File", "Owners", "Standing", "Examined at", "Open defects"), body))
    blocks.append(coverage_bars_model(conn))

    sources = {
        **_db_source("files:standing", standing),
        **_db_source("files:defects", defects),
        **_db_source("files:git", git),
    }
    return Page("Files", "files.html", tuple(blocks)), sources


def _tracked_paths(
    conn: sqlite3.Connection,
    storage: Path,
    standing: ReconciliationStanding | None = None,
) -> int | None:
    """The survey set's size at the revision this projection stamps (§3.4).

    It reads the **standing reconciliation** and nothing else: its tracked
    paths less the ones it excluded from the survey set (design/scope/PLAN.md
    §2.8), which for a reconciliation that excluded nothing is the tree. It used to
    reconstruct the universe from the ledger it was about to measure —
    unledgered `scope_gaps` rows plus the ledger paths the tree still carried —
    which is GP24 exactly: a denominator that counts what the survey was handed
    rather than what it was owed. The candidate store's overview therefore
    printed `0` against 501 unledgered tracked paths, because `detect_changes`
    had never run at its checked revision and an empty `scope_gaps` is
    indistinguishable from a reconciliation that found nothing (finding B03-5).

    `None` is the third answer and is never `0`: a reading of nothing and no
    reading at all are different facts, and collapsing them is the
    zero-denominator green VP4(e) names.
    """

    if standing is None:
        standing = reconciliation_standing(conn, storage)
    return standing.survey_paths


def _sentence(fragment: str) -> str:
    """One clause, promoted to a sentence, without touching the rest of it.

    `str.capitalize` would lowercase every other character, and a revision is
    the one thing on this page that must survive verbatim.
    """

    return f"{fragment[:1].upper()}{fragment[1:]}." if fragment else ""


def _unmeasured(standing: ReconciliationStanding) -> str:
    """Why a coverage figure has no denominator, naming the revision (§3.4).

    Every branch names the revision the projection stamps and the reason the
    reading does not stand. §8.6 makes an omitted revision or an omitted reason
    a red condition in its own right: `not measured` on its own is a refusal
    with nothing a reader could act on, and the four repairs differ.
    """

    published = _short(standing.sha)
    if standing.why == WHY_NO_REVISION:
        return f"{UNMEASURED} — {WHY_NO_REVISION}"
    if standing.why == WHY_NO_TREE:
        return f"{UNMEASURED} — at {published}, {WHY_NO_TREE}"
    if standing.why == WHY_NONE_AT_ALL:
        return (
            f"{UNMEASURED} — no reconciliation has been recorded for this store,"
            f" at {published} or at any other revision"
        )
    if standing.why == WHY_NONE_RECORDED:
        return (
            f"{UNMEASURED} — the store was last reconciled at"
            f" {_short(standing.latest_sha or '')}, not at {published}:"
            f" {WHY_NONE_RECORDED}"
        )
    return (
        f"{UNMEASURED} — the reconciliation recorded at {published} no longer"
        f" stands: {standing.why}"
    )


def _gap_denominator(
    numerator: int,
    denominator: int | None,
    unit: str,
    clause: str,
    reason: str | None = None,
) -> list[Block]:
    """One section's headline: the count, its unit, and its denominator.

    A bare zero is not a reading. Without the denominator beside it, a section
    that reports nothing cannot be told from one that could never report
    anything, which is the zero-denominator green ADR-0001 and VP4 both name.

    `None` and `0` route to the same sentence for the same reason, and `reason`
    is what tells them apart for a reader: a store that has not reconciled at
    the revision it stamps has no denominator to print, and §3.4 requires the
    revision to be named where that is why.
    """

    if not denominator:
        sentence = (
            f"No {unit} is recorded, so this gap is not measured here. That is a"
            " statement about the record, not a claim that the gap is closed."
        )
        return [_paragraph(sentence if reason is None else f"{sentence} {reason}")]
    return [_paragraph(f"**{numerator} of {denominator}** {unit} {clause}")]


def render_not_yet_surveyed(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The recorded edge of the map: five gaps, each over its own unit (§7.5).

    Sections 4 and 5 count **pairs**, not seams and not concern codes. Read
    over the AxiomDB store, the global forms of those two predicates — a
    concern dispositioned nowhere, a seam with no `SC-%` on either side —
    report zero while 1,094 (subsystem, concern) pairs and 9 one-sided seams
    are open. A section that cannot turn red on the only store it has been run
    against is a zero-denominator green (VP4), and this page exists precisely
    to show what is not known.
    """

    git = row(conn, "SELECT * FROM git_state WHERE repo_id='default'") or {}
    checked = str(git.get("last_checked_sha") or "")
    branch = str(git.get("canonical_branch") or "not recorded")

    unledgered = rows(
        conn,
        "SELECT file_path, detected_sha FROM scope_gaps WHERE kind='unledgered'"
        f" AND {survey_filter(conn)} ORDER BY file_path",
    )
    # Section 1's denominator is the tracked universe at the reconciled
    # revision, and an unreconciled store has none (§3.4). `None` routes into
    # the sentence `_gap_denominator` already prints for a zero denominator,
    # carrying the revision and the reason with it.
    standing = reconciliation_standing(conn, storage)
    tracked = _tracked_paths(conn, storage, standing)
    subsystems = rows(
        conn, "SELECT id, name, status, layer, notes FROM subsystems ORDER BY id"
    )
    names = {str(s["id"]): str(s["name"]) for s in subsystems}
    ledger = rows(
        conn,
        "SELECT subsystem_id, file_path, why_in_scope,"
        " COALESCE(classification,'candidate') AS classification"
        f" FROM file_ledger WHERE {OBLIGATION_BEARING_SQL} AND {survey_filter(conn)}"
        " ORDER BY subsystem_id, file_path",
    )
    candidates = [r for r in ledger if r["classification"] == "candidate"]
    deferred = [s for s in subsystems if str(s["status"]) == "deferred"]
    seams = rows(
        conn,
        "SELECT seam_id, shared_object, party_a, party_b, assessable"
        " FROM seam_assessability ORDER BY seam_id",
    )
    # A subsystem, or a seam, outside the survey owes no survey work (§2.6a).
    outside = set(outside_survey_subsystems(conn))
    outside_seams = set(outside_survey_seams(conn))
    seams = [seam for seam in seams if str(seam["seam_id"]) not in outside_seams]
    seam_concern_parties = {
        str(d["subsystem_id"])
        for d in rows(
            conn,
            "SELECT DISTINCT subsystem_id FROM dispositions WHERE concern_code LIKE 'SC-%'",
        )
    }
    active_concerns = rows(
        conn, "SELECT code, category FROM concerns WHERE status='active' ORDER BY code"
    )
    dispositioned = {
        (str(d["subsystem_id"]), str(d["concern_code"]))
        for d in rows(conn, "SELECT subsystem_id, concern_code FROM dispositions")
    }

    blocks: list[Block] = [_paragraph(f"Counted at {_short(checked)} on `{branch}`.")]

    # 1. Unledgered paths, over the survey set's paths.
    held: list[Block] = _gap_denominator(
        len(unledgered),
        tracked,
        "tracked paths" if standing.survey_paths == standing.tracked_paths else "paths in the survey set",
        "are named by no `file_ledger` row in any subsystem. They participate in no"
        " subsystem's scope, so nothing here has been read, excluded, or deferred.",
        reason=None if standing.stands else _sentence(_unmeasured(standing)),
    )
    if unledgered:
        by_directory: dict[str, list[str]] = {}
        for entry in unledgered:
            path = str(entry["file_path"])
            directory = path.split("/", 1)[0] if "/" in path else "(repository root)"
            by_directory.setdefault(directory, []).append(path)
        for directory in sorted(by_directory, key=lambda d: (-len(by_directory[d]), d)):
            paths = by_directory[directory]
            held.append(_heading(3, f"{directory} — {_count(len(paths), 'path')}"))
            held.append(_bullets([f"`{path}`" for path in paths]))
    blocks.append(_section("Paths with no ledger row", *held))

    # 2. Candidate rows, over obligation-bearing ledger rows.
    held = _gap_denominator(
        len(candidates),
        len(ledger),
        "ledger rows that carry a survey obligation",
        "are classified `candidate`: the file participates in its subsystem and no"
        " one has read it.",
    )
    if candidates:
        by_subsystem: dict[str, list[dict[str, Any]]] = {}
        for entry in candidates:
            by_subsystem.setdefault(str(entry["subsystem_id"]), []).append(entry)
        for subsystem_id in sorted(by_subsystem):
            entries = by_subsystem[subsystem_id]
            name = names.get(subsystem_id, subsystem_id)
            owned = sum(1 for r in ledger if str(r["subsystem_id"]) == subsystem_id)
            held.append(
                _heading(
                    3,
                    f"{name} **{subsystem_id}** — {len(entries)} unread of"
                    f" {_count(owned, 'row')} carrying an obligation",
                )
            )
            held.append(
                _bullets(
                    [
                        f"`{entry['file_path']}` — {_one_line(entry['why_in_scope'] or 'no reason recorded')}"
                        for entry in entries
                    ]
                )
            )
    blocks.append(_section("Files in scope that no one has read", *held))

    # 3. Deferred subsystems, over subsystems.
    held = _gap_denominator(
        len(deferred),
        len(subsystems),
        "subsystems",
        "are deferred. `deferred` is not a rung on the survey ladder but an"
        " orthogonal do-not-survey flag, so nothing in them has been surveyed at any"
        " depth.",
    )
    if deferred:
        held.append(
            _table(
                _caption("Subsystems set aside"),
                ("Subsystem", "Layer", "Recorded reason"),
                [
                    [
                        f"[{s['name']}]({subsystem_page(str(s['id']), str(s['name']))}) **{s['id']}**",
                        s["layer"] or "—",
                        _table_cell(s["notes"] or "") or "No reason is recorded.",
                    ]
                    for s in deferred
                ],
            )
        )
    blocks.append(_section("Subsystems set aside", *held))

    # 4. Unassessed seam sides, over 2 × seams.
    unassessed: list[tuple[str, str, str, str]] = []
    for seam in seams:
        assessable = int(seam["assessable"] or 0)
        for side, other in (
            (str(seam["party_a"]), str(seam["party_b"])),
            (str(seam["party_b"]), str(seam["party_a"])),
        ):
            if not assessable:
                why = "the seam is not assessable: both parties must be `mapped`"
            elif side not in seam_concern_parties:
                why = "this party holds no `SC-%` disposition"
            else:
                continue
            unassessed.append((str(seam["seam_id"]), side, other, why))
    held = _gap_denominator(
        len(unassessed),
        2 * len(seams),
        "(seam, side) pairs",
        "carry no recorded assessment. The unit is the pair, not the seam: a seam"
        " assessed from one side only is half-known, and counting seams would report"
        " it as covered.",
    )
    held.append(_paragraph(PER_PARTY_PROXY))
    if unassessed:
        held.append(
            _table(
                _caption("Seam sides no one has assessed"),
                ("Seam", "Unassessed party", "Other party", "Why"),
                [
                    [
                        f"**{seam_id}**",
                        f"[{names.get(side, side)}]({subsystem_page(side, names.get(side, side))}) **{side}**",
                        f"**{other}**",
                        why,
                    ]
                    for seam_id, side, other, why in unassessed
                ],
            )
        )
    blocks.append(_section("Seam sides no one has assessed", *held))

    # 5. Undispositioned (subsystem, active concern) pairs.
    missing: dict[str, list[str]] = {}
    surveyed = [s for s in subsystems if str(s["id"]) not in outside]
    for s in surveyed:
        for concern in active_concerns:
            pair = (str(s["id"]), str(concern["code"]))
            if pair not in dispositioned:
                missing.setdefault(str(s["id"]), []).append(str(concern["code"]))
    undispositioned = sum(len(codes) for codes in missing.values())
    held = _gap_denominator(
        undispositioned,
        len(surveyed) * len(active_concerns),
        "(subsystem, active concern) pairs",
        "carry no disposition. The unit is the pair: a concern dispositioned"
        " somewhere else says nothing about this subsystem, and counting concern"
        " codes would report a checklist as complete while most regions were never"
        " tested against it.",
    )
    if missing:
        held.append(
            _table(
                _caption("Concerns no one has dispositioned here"),
                ("Subsystem", "Undispositioned", "Concerns"),
                [
                    [
                        f"[{names.get(subsystem_id, subsystem_id)}]"
                        f"({subsystem_page(subsystem_id, names.get(subsystem_id, subsystem_id))}) **{subsystem_id}**",
                        f"{len(missing[subsystem_id])} of {len(active_concerns)}",
                        ", ".join(f"**{code}**" for code in missing[subsystem_id]),
                    ]
                    for subsystem_id in sorted(missing)
                ],
            )
        )
    blocks.append(_section("Concerns no one has dispositioned here", *held))

    sources = {
        **_db_source("gaps:unledgered", unledgered),
        **_db_source("gaps:tracked", {"tracked": tracked}),
        **_db_source("gaps:ledger", ledger),
        **_db_source("gaps:subsystems", subsystems),
        **_db_source("gaps:seams", seams),
        **_db_source("gaps:seam-parties", sorted(seam_concern_parties)),
        **_db_source("gaps:concerns", active_concerns),
        **_db_source("gaps:dispositions", sorted(dispositioned)),
        **_db_source("gaps:git", git),
    }
    return Page("Not yet surveyed", "not-yet-surveyed.html", tuple(blocks)), sources


# ---------------------------------------------------------------------------
# Unresolved: where credible records disagree (§6.1, §7.1)
# ---------------------------------------------------------------------------


def render_disagreements(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """Records that stand undiscriminated at the checked revision.

    Three families reach this page, and they are three different failures to
    choose: two findings that cannot both be right, a matrix whose evidence
    does not separate the competing explanations, and a concern review that
    recorded the competition instead of resolving it.

    `diagnosticity_sessions.outcome` admits `unresolved-competition`
    (`schema.sql:4478-4479`), and History selects nothing from that table, so a
    matrix that ended in acknowledged competition would otherwise vanish from
    the projection entirely. ADR-0001 § Fully surveyed calls that state visible
    debt, not hidden success.
    """

    del storage  # every record here is a property of the durable tables

    contradictions = rows(
        conn,
        "SELECT * FROM contradictions"
        " WHERE COALESCE(resolution,'unresolved')='unresolved'"
        " ORDER BY detected_at DESC, id DESC",
    )
    matrices = rows(
        conn,
        "SELECT id, subsystem_id, symptom, outcome, leading_concern, created_at"
        "  FROM diagnosticity_sessions"
        " WHERE COALESCE(outcome,'open') IN ('open','unresolved-competition')"
        " ORDER BY CASE COALESCE(outcome,'open')"
        "            WHEN 'unresolved-competition' THEN 0 ELSE 1 END, id",
    )
    competing = rows(
        conn,
        "SELECT d.subsystem_id, d.concern_code, d.evidence_quality, d.rationale,"
        "       d.assessed_at, d.linchpin_dependent"
        "  FROM dispositions d"
        " WHERE d.classification='unresolved-competition'"
        " ORDER BY d.subsystem_id, d.concern_code",
    )
    names = {
        str(s["id"]): str(s["name"])
        for s in rows(conn, "SELECT id, name FROM subsystems")
    }

    blocks: list[Block] = []
    if not (contradictions or matrices or competing):
        blocks += _empty_lens_blocks(
            conn,
            "No record stands undiscriminated.",
            "findings that cannot both be right, evidence matrices the evidence does"
            " not separate, and concern reviews that recorded a competition rather"
            " than a verdict.",
            "`contradictions`, `diagnosticity_sessions`, and `dispositions`, each read"
            " for the state that means *the record does not say which*.",
        )
        return Page("Records that disagree", "disagreements.html", tuple(blocks)), {
            **_db_source("disagreements:contradictions", contradictions),
            **_db_source("disagreements:matrices", matrices),
            **_db_source("disagreements:dispositions", competing),
        }

    blocks.append(
        _paragraph(
            "_Each record below is a place where the survey could have written one"
            " reading and did not, because the evidence it had does not choose. That is"
            " information: it says where a further pass would change the record, and"
            " what kind of evidence it would take. Records the evidence did settle are"
            " on [Conflicting evidence](contradictions.html)._"
        )
    )

    def rows_of(*cells: str) -> Row:
        return Row(tuple(inlines(cell) for cell in cells))

    heading = "Findings that cannot both be right"
    if contradictions:
        body: list[Block] = [
            _paragraph(f"_{_count(len(contradictions), 'pair')} with no recorded resolution._"),
            Table(
                _caption(heading),
                tuple(inlines(h) for h in ("Record", "Findings", "Shared locus", "Conflict", "Detected")),
                tuple(
                    Row(
                        tuple(
                            inlines(cell)
                            for cell in (
                                f'<a id="{contradiction_anchor(c["id"])}"></a>**#{c["id"]}**',
                                f"**{c['finding_a']}** / **{c['finding_b']}**",
                                f"`{c['shared_location']}`" if c["shared_location"] else "—",
                                _table_cell(c["conflict_type"]),
                                _fmt_time(c["detected_at"]),
                            )
                        )
                    )
                    for c in contradictions
                ),
            ),
        ]
    else:
        body = [_paragraph("No pair of findings is recorded as disagreeing.")]
    blocks.append(_section(heading, *body))

    heading = "Competing explanations the evidence has not chosen between"
    if matrices:
        table_rows: list[Row] = []
        for m in matrices:
            subsystem_id = str(m["subsystem_id"] or "")
            subsystem = (
                f"[{names.get(subsystem_id, subsystem_id)}]"
                f"({subsystem_page(subsystem_id, names.get(subsystem_id, subsystem_id))})"
                if subsystem_id
                else "—"
            )
            table_rows.append(
                rows_of(
                    f"[DM-{m['id']}]({matrix_page(int(m['id']))})",
                    subsystem,
                    _table_cell(m["symptom"] or ""),
                    f"`{m['outcome'] or 'open'}`",
                    _fmt_time(m["created_at"]),
                )
            )
        body = [
            _paragraph(
                f"_{_count(len(matrices), 'matrix', 'matrices')} still open or recorded as"
                " unresolved competition. The full matrix is on its own page._"
            ),
            Table(
                _caption(heading),
                tuple(inlines(h) for h in ("Matrix", "Subsystem", "Symptom", "Outcome", "Opened")),
                tuple(table_rows),
            ),
        ]
    else:
        body = [_paragraph("No evidence matrix is open or recorded as unresolved competition.")]
    blocks.append(_section(heading, *body))

    heading = "Concern reviews that recorded a competition"
    if competing:
        table_rows = []
        for d in competing:
            subsystem_id = str(d["subsystem_id"])
            name = names.get(subsystem_id, subsystem_id)
            table_rows.append(
                rows_of(
                    f"[{name}]({subsystem_page(subsystem_id, name)}) **{subsystem_id}**",
                    f"**{d['concern_code']}**",
                    f"`{d['evidence_quality']}`" if d["evidence_quality"] else "not recorded",
                    "yes" if int(d["linchpin_dependent"] or 0) else "no",
                    _fmt_time(d["assessed_at"]),
                    _table_cell(d["rationale"] or "No rationale is recorded."),
                )
            )
        body = [
            _paragraph(
                f"_{_count(len(competing), 'review')} where two or more concerns each"
                " explain what was observed and the evidence does not separate them._"
            ),
            Table(
                _caption(heading),
                tuple(
                    inlines(h)
                    for h in ("Subsystem", "Concern", "Strongest evidence", "Linchpin", "Recorded", "Rationale")
                ),
                tuple(table_rows),
            ),
        ]
    else:
        body = [_paragraph("No concern review recorded an unresolved competition.")]
    blocks.append(_section(heading, *body))

    return Page("Records that disagree", "disagreements.html", tuple(blocks)), {
        **_db_source("disagreements:contradictions", contradictions),
        **_db_source("disagreements:matrices", matrices),
        **_db_source("disagreements:dispositions", competing),
        **_db_source("disagreements:names", names),
    }


# ---------------------------------------------------------------------------
# Unresolved: where unresolved work and unread territory concentrate (§7.6)
# ---------------------------------------------------------------------------

# §7.6's columns, each a separate measure. There is no composite column and no
# total row: the nine things below are not commensurable, and a subsystem with
# two critical defects and a read ledger is not the same object as one with no
# defects and no one having looked (BP26).
HOT_SPOT_COLUMNS: tuple[str, ...] = (
    "Subsystem",
    "Open critical + high",
    "Open medium + low",
    "Awaiting verification",
    "Undiscriminated",
    "Weakest evidence quality",
    "Unread files",
    "Stale files",
    "Unassessed seam sides",
)
ACCESS_COLUMN = "Access heat"

HOT_SPOT_COLUMN_NOTES: tuple[str, ...] = (
    "**Open critical + high** and **Open medium + low** are kept apart because"
    " severity is an ordinal ramp of consequence and adding the two ends of it"
    " together would let four readability defects outweigh one data-loss path.",
    "**Awaiting verification** counts repairs recorded against a commit with no"
    " evidence yet that they hold. It is not progress and it is not an open"
    " defect; it is a claim nobody has checked.",
    "**Undiscriminated** counts unresolved contradictions, open and"
    " unresolved-competition matrices, and concern reviews that recorded a"
    " competition. A contradiction between findings in two subsystems is"
    " counted in both, because it is undiscriminated territory in both.",
    "**Weakest evidence quality** is the weakest rung any `confirmed-bug`"
    " review here rests on, not an average: the weakest link is what a reader"
    " should re-verify first.",
    "**Unread files** and **Stale files** are counted over ledger rows that"
    " carry a survey obligation; generated, vendored, and irrelevant paths are"
    " outside the denominator.",
)


def render_hot_spots(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """One row per subsystem, nine separate measures, one declared sort (§7.6).

    The sort is open critical+high, then open medium+low, then the unread
    fraction, then subsystem id. Each key is read on its own; none of them is
    combined with another, and the table carries no rank column, because a rank
    is a composite wearing an ordinal's clothes.
    """

    del storage  # every measure is a property of the durable tables

    subs = rows(conn, "SELECT id, name, layer FROM subsystems ORDER BY id")
    access = hot_spot_access(conn)

    blocks: list[Block] = []
    if not subs:
        blocks += _empty_lens_blocks(
            conn,
            "No subsystem is recorded, so there is nothing to compare.",
            "one row per subsystem, each column a separate measure of unresolved work"
            " or unread territory.",
            "`findings`, `contradictions`, `diagnosticity_sessions`, `dispositions`,"
            " `file_ledger`, and `seam_assessability`.",
        )
        return Page("Hot spots", "hot-spots.html", tuple(blocks)), _db_source("hotspots:subsystems", subs)

    measures = hot_spot_measures(conn)

    measures.sort(
        key=lambda m: (-m["crit_high"], -m["med_low"], -m["unread_fraction"], m["id"])
    )

    blocks.append(
        _paragraph(
            "_Rows are ordered by open critical and high defects, then open medium and low, then the unread fraction._"
        )
    )

    # The one measure table carries this page's filterable rows (§8.1.2). The
    # severity facet is named by the band columns themselves: the table keeps
    # critical+high and medium+low apart on purpose, and a filter that merged
    # them into four severities would assert a resolution the columns do not
    # record.
    headers = list(HOT_SPOT_COLUMNS) + ([ACCESS_COLUMN] if access else [])
    bands = {1: HOT_SPOT_COLUMNS[1], 2: HOT_SPOT_COLUMNS[2]}
    subsystem_names: list[str] = []
    table_rows: list[Row] = []
    for m in measures:
        cells = [
            f"[{m['name']}]({subsystem_page(m['id'], m['name'])}) **{m['id']}**",
            str(m["crit_high"]),
            str(m["med_low"]),
            str(m["awaiting"]),
            str(m["undiscriminated"]),
            f"`{m['quality']}`" if m["quality"] not in ("—", "not recorded") else m["quality"],
            f"{m['unread']}/{m['obligation']}",
            str(m["stale"]),
            f"{m['unassessed_sides']}/{m['seam_sides']}",
        ]
        if access:
            cells.append(str(m["access"] or 0))
        name = _plain(str(m["name"]))
        if name and name not in subsystem_names:
            subsystem_names.append(name)
        severity = "|".join(
            label for index, label in bands.items() if int(cells[index]) > 0
        )
        table_rows.append(Row(tuple(inlines(cell) for cell in cells), (), RowFilter(name, severity)))
    blocks.append(Table("Hot spots", tuple(inlines(header) for header in headers), tuple(table_rows)))

    notes: list[Block] = [_paragraph(note) for note in HOT_SPOT_COLUMN_NOTES]
    notes.append(
        _paragraph(
            "**Unassessed seam sides** counts `(seam, side)` pairs over twice the seams"
            " this subsystem is party to: a seam assessed from one side only is"
            " half-known, and counting seams would report it as covered."
            f" {PER_PARTY_PROXY}"
        )
    )
    notes.append(
        _paragraph(
            f"**{ACCESS_COLUMN}** counts the accesses recorded against entries this"
            " subsystem owns. It measures what the survey read, not what the"
            " repository runs."
            if access
            else f"No **{ACCESS_COLUMN}** column is shown: no recorded access reaches a"
            " subsystem, and a column of zeros would read as a measurement that was"
            " taken."
        )
    )
    blocks.append(_section("What each column measures", *notes))

    facets = Facets(
        "hot-spots",
        (("severity", tuple(bands.values())), ("subsystem", tuple(subsystem_names))),
    )
    return Page("Hot spots", "hot-spots.html", tuple(blocks), facets), {
        **_db_source("hotspots:measures", measures),
        **_db_source("hotspots:access", access),
    }


# ---------------------------------------------------------------------------
# History: the append-only account of how records reached their state (§7.7)
# ---------------------------------------------------------------------------


def render_resolution_history(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """One newest-first timeline over the tables that keep an event trail.

    Findings and contradictions are the only record families whose history is
    append-only: no code path in `mcp-server/src` or `materializer` updates or
    deletes their event tables. A finding's severity re-grades are a third
    trail (`finding_severity_events`), read when the store has the table.
    Every other family carries a mutable terminal column and is reported on
    `resolved-leads.html`, which says so (§1.1, C58).
    """

    del storage  # the two event tables are the only source

    finding_events = rows(
        conn,
        "SELECT e.id, e.finding_id, e.resolution_state, e.fix_location, e.fix_sha,"
        "       e.rationale, e.session_id, e.recorded_at,"
        "       v.resolution_state AS current_state"
        "  FROM finding_resolution_events e"
        "  LEFT JOIN finding_state_current v ON v.finding_id = e.finding_id"
        " ORDER BY e.id DESC",
    )
    severity_events = (
        rows(
            conn,
            "SELECT e.id, e.finding_id, e.previous_severity, e.severity, e.rationale,"
            "       e.at_sha, e.session_id, e.recorded_at,"
            "       v.resolution_state AS current_state"
            "  FROM finding_severity_events e"
            "  LEFT JOIN finding_state_current v ON v.finding_id = e.finding_id"
            " ORDER BY e.id DESC",
        )
        if table_exists(conn, "finding_severity_events")
        else []
    )
    contradiction_events = rows(
        conn,
        "SELECT e.id, e.contradiction_id, e.resolution, e.scope_note, e.rationale,"
        "       e.session_id, e.recorded_at, c.resolution AS current_resolution"
        "  FROM contradiction_resolution_events e"
        "  LEFT JOIN contradictions c ON c.id = e.contradiction_id"
        " ORDER BY e.id DESC",
    )

    sources = {
        **_db_source("history:finding-events", finding_events),
        **_db_source("history:contradiction-events", contradiction_events),
    }
    if severity_events:
        sources.update(_db_source("history:severity-events", severity_events))
    if not (finding_events or contradiction_events or severity_events):
        blocks = _empty_lens_blocks(
            conn,
            "No resolution event is recorded.",
            "every state a finding or a contradiction was recorded in, newest first,"
            " with the account given at the time.",
            "`finding_resolution_events` and `contradiction_resolution_events`, the"
            " two tables nothing updates or deletes.",
        )
        return Page("Resolution history", "resolution-history.html", tuple(blocks)), sources

    timeline: list[tuple[str, int, int, list[str]]] = []
    for e in finding_events:
        fid = str(e["finding_id"])
        page = finding_page(e["current_state"]) or FINDING_LENS_PAGES[0][1]
        account = _table_cell(e["rationale"] or "")
        if e["fix_sha"] or e["fix_location"]:
            repair = f"Repair at `{e['fix_location'] or 'no location recorded'}`"
            account = f"{repair}, {_short(str(e['fix_sha'] or ''))}. {account}".strip()
        timeline.append(
            (
                str(e["recorded_at"] or ""),
                0,
                int(e["id"]),
                [
                    _fmt_time(e["recorded_at"]),
                    f"[{fid}]({page}#{fid.lower()})",
                    f"`{e['resolution_state']}`",
                    f"`{e['session_id']}`" if e["session_id"] else "not recorded",
                    account or "No account was recorded with this event.",
                ],
            )
        )
    for e in severity_events:
        fid = str(e["finding_id"])
        page = finding_page(e["current_state"]) or FINDING_LENS_PAGES[0][1]
        account = _table_cell(e["rationale"] or "")
        account = f"Judged at {_short(str(e['at_sha'] or ''))}. {account}".strip()
        timeline.append(
            (
                str(e["recorded_at"] or ""),
                2,
                int(e["id"]),
                [
                    _fmt_time(e["recorded_at"]),
                    f"[{fid}]({page}#{fid.lower()})",
                    f"`{e['previous_severity']}` → `{e['severity']}`",
                    f"`{e['session_id']}`" if e["session_id"] else "not recorded",
                    account,
                ],
            )
        )
    for e in contradiction_events:
        cid = e["contradiction_id"]
        page = contradiction_page(e["current_resolution"])
        account = _table_cell(e["rationale"] or "")
        if e["scope_note"]:
            account = f"{account} Scopes: {_table_cell(e['scope_note'])}".strip()
        timeline.append(
            (
                str(e["recorded_at"] or ""),
                1,
                int(e["id"]),
                [
                    _fmt_time(e["recorded_at"]),
                    f"[#{cid}]({page}#{contradiction_anchor(cid)})",
                    f"`{e['resolution']}`",
                    f"`{e['session_id']}`" if e["session_id"] else "not recorded",
                    account or "No account was recorded with this event.",
                ],
            )
        )
    timeline.sort(key=lambda entry: (entry[0], entry[1], entry[2]), reverse=True)

    blocks = [
        _paragraph(
            "_Every state a finding or a contradiction was recorded in, and every"
            " re-grade of a finding's severity, newest first, with the account given"
            " at the time. Nothing here is rewritten when a"
            " record moves on: a repair that was later defeated keeps the event that"
            " recorded it, which is how a regression is visible at all. Each row links"
            " to where that record is written in full today._"
        ),
        _table(
            "Resolution history",
            ("Recorded", "Record", "State", "Session", "Account"),
            [cells for _at, _rank, _id, cells in timeline],
        ),
    ]
    return Page("Resolution history", "resolution-history.html", tuple(blocks)), sources


# §1.1's two statements about what the store keeps for the record families that
# have no event table. They are the point of C58: `open_questions.resolution`
# and `field_notes.follow_up` are mutable columns, so History carries the
# terminal state and, for one of the two, the time — and nothing about how.
QUESTION_TERMINAL_LIMIT = "When this reached its state is recorded; how it did is not."
LEAD_TERMINAL_LIMIT = (
    "Neither when nor how this lead reached its state is recorded, only that it"
    " did; the order below is the order the leads were opened."
)


def render_resolved_leads(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The History lens for the two families with no event trail (§7.7, C58, C61).

    Questions record a resolution time and order by it. Leads record no
    resolution time at all and order by `id`, which is when they were opened.
    Both say so in one line rather than letting the order imply an account of
    how they were closed.
    """

    del storage  # the two mutable-terminal tables are the only source

    questions = rows(
        conn,
        "SELECT * FROM open_questions"
        " WHERE resolution IN ('answered','dismissed','superseded')"
        " ORDER BY resolved_at DESC, id DESC",
    )
    notes = rows(
        conn,
        "SELECT * FROM field_notes WHERE COALESCE(follow_up,'open')<>'open'"
        " ORDER BY id DESC",
    )
    sources = {
        **_db_source("resolved-leads:questions", questions),
        **_db_source("resolved-leads:notes", notes),
    }

    if not (questions or notes):
        blocks = _empty_lens_blocks(
            conn,
            "No question has been settled and no lead has been closed.",
            "questions answered, dismissed, or superseded, and leads closed either by"
            " becoming a finding or by being dismissed.",
            "`open_questions.resolution` and `field_notes.follow_up`, both mutable"
            " columns with no event table behind them.",
        )
        return Page("Resolved leads and questions", "resolved-leads.html", tuple(blocks)), sources

    blocks: list[Block] = [
        _paragraph(
            "_These two families reach a terminal state in a column, not in an event"
            " table. The record says what state they are in; for how they got there it"
            " says only what is written below. Findings and contradictions do keep an"
            " event trail, on [Resolution history](resolution-history.html)._"
        )
    ]

    settled: list[Block] = []
    if questions:
        settled.append(
            _paragraph(
                f"_{_count(len(questions), 'question')} settled, newest first by the time"
                f" recorded. {QUESTION_TERMINAL_LIMIT}_"
            )
        )
        for q in questions:
            when = _fmt_time(q["resolved_at"]) if q["resolved_at"] else "not recorded"
            subsystem = f" · subsystem **{q['subsystem_id']}**" if q["subsystem_id"] else ""
            facts = [
                f"**Settled** — `{q['resolution']}`, {when}.",
                f"**Answer** — {_one_line(q['answer'])}"
                if q["answer"]
                else "**Answer** — No answer is recorded.",
            ]
            if q["what_blocked"]:
                facts.append(f"**What it blocked** — {_one_line(q['what_blocked'])}")
            settled += [
                Anchor(question_anchor(q["id"])),
                _heading(3, f"#{q['id']} · {q['category']}{subsystem}"),
                Quote(inlines(_one_line(q["question"]))),
                _bullets(facts),
            ]
    else:
        settled.append(_paragraph("No question has been answered, dismissed, or superseded."))
    blocks.append(_section("Questions", *settled))

    closed: list[Block] = []
    if notes:
        closed += [
            _paragraph(f"_{_count(len(notes), 'lead')} closed. {LEAD_TERMINAL_LIMIT}_"),
            _table(
                "leads",
                ("Lead", "Category", "Opened", "Closed as", "Observation"),
                [
                    [
                        f'<a id="{lead_anchor(n["id"])}"></a>**#{n["id"]}**',
                        str(n["category"]),
                        _fmt_time(n["created_at"]),
                        str(n["follow_up"]),
                        _table_cell(n["observation"])
                        + (f" @ `{n['location']}`" if n["location"] else ""),
                    ]
                    for n in notes
                ],
            ),
        ]
    else:
        closed.append(_paragraph("No lead has been closed."))
    blocks.append(_section("Leads", *closed))

    return Page("Resolved leads and questions", "resolved-leads.html", tuple(blocks)), sources


def render_sessions(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """What ran, when, and what it produced (§7.7).

    Three registers that answer three different questions: which survey passes
    were opened, which refresh runs were dispatched against which revisions,
    and whether the last publication's three read-back axes held.
    """

    del storage  # the run tables are the only source

    sessions = rows(
        conn, "SELECT * FROM sessions ORDER BY started_at DESC, session_id DESC"
    )
    refreshes = rows(
        conn,
        "SELECT run_id, status, base_sha, head_sha, selected_provider, model,"
        "       determinism_mode, created_at, completed_at, projection_run_id, error"
        "  FROM refresh_runs ORDER BY created_at DESC, run_id DESC",
    )
    verifications = rows(
        conn,
        "SELECT run_id, mode, source_sha, state_ok, coverage_ok, content_ok, ok,"
        "       verified_at FROM projection_verification_runs"
        " ORDER BY verified_at DESC, run_id DESC",
    )
    sources = {
        **_db_source("sessions:sessions", sessions),
        **_db_source("sessions:refreshes", refreshes),
        **_db_source("sessions:verifications", verifications),
    }

    if not (sessions or refreshes or verifications):
        blocks = _empty_lens_blocks(
            conn,
            "Nothing is recorded as having run against this conspectus.",
            "the survey sessions that were opened, the refresh runs that were"
            " dispatched, and the publications whose read-back was verified.",
            "`sessions`, `refresh_runs`, and `projection_verification_runs`.",
        )
        return Page("Sessions and publications", "sessions.html", tuple(blocks)), sources

    blocks: list[Block] = [
        _paragraph(
            "_What ran against this conspectus, and what each run produced. A session"
            " still without an end is one that was never closed, which is a fact about"
            " the record rather than about the work._"
        )
    ]

    blocks.append(
        _section(
            "Survey sessions",
            _table(
                "survey sessions",
                ("Session", "Intent", "Started", "Ended", "Outcome"),
                [
                    [
                        f"`{s['session_id']}`",
                        f"`{_table_cell(s['intent'] or '')}`",
                        _fmt_time(s["started_at"]),
                        _fmt_time(s["ended_at"]) if s["ended_at"] else "not closed",
                        _table_cell(s["outcome"] or "not recorded"),
                    ]
                    for s in sessions
                ],
            )
            if sessions
            else _paragraph("No survey session is recorded."),
        )
    )

    blocks.append(
        _section(
            "Refresh runs",
            _table(
                "refresh runs",
                ("Run", "Status", "Base", "Head", "Provider", "Model", "Completed"),
                [
                    [
                        f"`{r['run_id']}`",
                        f"`{r['status']}`",
                        _short(str(r["base_sha"] or "")),
                        _short(str(r["head_sha"] or "")),
                        str(r["selected_provider"]),
                        f"`{r['model']}`",
                        _fmt_time(r["completed_at"]) if r["completed_at"] else "not completed",
                    ]
                    for r in refreshes
                ],
            )
            if refreshes
            else _paragraph("No refresh run is recorded."),
        )
    )

    blocks.append(
        _section(
            "Publication read-back",
            _table(
                "publication read back",
                ("Run", "Mode", "State", "Coverage", "Content", "Verified"),
                [
                    [
                        f"`{v['run_id']}`",
                        f"`{v['mode']}`",
                        *(
                            "green" if int(v[f"{axis}_ok"] or 0) else "red"
                            for axis in ("state", "coverage", "content")
                        ),
                        _fmt_time(v["verified_at"]),
                    ]
                    for v in verifications
                ],
            )
            if verifications
            else _paragraph(
                "No publication read-back is recorded, so none of the three axes has a"
                " result to report."
            ),
        )
    )

    return Page("Sessions and publications", "sessions.html", tuple(blocks)), sources
