"""Independent read-back checks for a materialized conspectus.

The renderer is a projection, never the system of record.  This verifier reads
the durable database and the finished files independently along three axes:

* state: authoritative objects have exactly one durable marker in the output;
* coverage: every planned page and recorded local cross-link is present;
* content: finished page bytes match the post-xref publication receipt.

The receipt is intentionally post-processing-aware.  The older incremental
manifest hashes pre-xref renderer output and therefore cannot prove the bytes a
reader actually sees.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from collections import Counter
from contextvars import ContextVar
from dataclasses import dataclass
from html import escape, unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from .db import open_ro, row, rows, table_exists
from .lint import (
    THESIS_REFUSED,
    THESIS_REFUSED_COMPOSITE,
    composite_index_violations,
    explanation_refusal,
    orientation_violations,
)
from .manifest import sha256_bytes
from .slugs import subsystem_page
from .vocabulary import (
    OBLIGATION_BEARING_CLASSIFICATIONS,
    OBLIGATION_BEARING_SQL,
    VOCABULARY,
    labels,
    values_of,
)

CONTRACT_NAME = ".projection-contract.json"
CONTRACT_VERSION = "2"
HTML_SUFFIXES = {".html", ".htm"}
LINKED_SUFFIXES = HTML_SUFFIXES

# The generated locus index (spec §8.1.1). It is a projection file like any
# page: inventoried, hashed into the receipt, and — unlike a page — read back
# against the ledger and the evidence it indexes.
SEARCH_INDEX_NAME = "search-index.js"
SEARCH_INDEX_ASSIGNMENT = re.compile(
    r"window\.__amanuensisLocusIndex\s*=\s*(\{.*\})\s*;", re.DOTALL
)

# Lens membership for a finding, defined once (spec §6.1) and read by the
# renderer, the cross-reference index, and the census below.  A finding renders
# as a full marked record on exactly one of these pages; every other surface
# links to it.  The order is the page order a reader meets.
FINDING_LENS_PAGES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("Unresolved", "findings.html", ("open", "fixed-pending-verification")),
    ("History", "resolved-findings.html", ("verified-fixed", "ruled-out", "accepted")),
)

FINDING_PAGE_BY_STATE: dict[str, str] = {
    state: page for _lens, page, states in FINDING_LENS_PAGES for state in states
}


def finding_page(resolution_state: str | None) -> str | None:
    """The page a finding in this resolution state renders on, or None."""
    return FINDING_PAGE_BY_STATE.get(str(resolution_state or ""))


#: Every durable marker kind the projection emits, named once. The HTML view
#: accepts raw HTML from the Markdown bytes only for these, so a marker kind
#: added here reaches both corpora and one added only to a renderer is stripped
#: out of the HTML and reported by the state axis as absent (§11.3).
MARKER_KINDS: tuple[str, ...] = ("finding", "ledger-stale", "carried")


def finding_marker(finding_id: str) -> str:
    token = hashlib.sha256(finding_id.encode("utf-8")).hexdigest()
    return f"<!-- amanuensis:finding:{token} -->"


# Where a stale ledger row is recorded, and under which heading (spec §6.1,
# §6.2, §11.3).  Defined once and read by the renderer and the census below.
#
# The partition is over the obligation-bearing classifications, not over
# staleness: `detect_changes` marks drift on every row that carries a `ref_sha`
# regardless of classification, so a file nobody has read can be stale.  Saying
# so under "Examined files the repository has changed under" would assert a
# reading the ledger does not record, which is why a `candidate` row is
# reported under its own heading with its own denominator (C60), and why
# `deferred-with-reason` gets a third heading rather than being folded into
# either of the other two.
LEDGER_STALE_PAGE = "stale.html"

LEDGER_STALE_SECTIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Examined files the repository has changed under", ("examined",)),
    ("Scoped but unread, and changed since scoping", ("candidate",)),
    (
        "Deferred files that changed after they were set aside",
        ("deferred-with-reason",),
    ),
)

LEDGER_STALE_HEADING_BY_CLASSIFICATION: dict[str, str] = {
    classification: heading
    for heading, classifications in LEDGER_STALE_SECTIONS
    for classification in classifications
}


def _ledger_row_token(subsystem_id: str, file_path: str) -> str:
    """One digest per `(subsystem_id, file_path)`, the ledger's own key.

    The NUL separator keeps the pair unambiguous: no path or subsystem id may
    contain it, so two different rows cannot produce one token by concatenating
    to the same string.
    """

    return hashlib.sha256(f"{subsystem_id}\x00{file_path}".encode()).hexdigest()


def ledger_stale_marker(subsystem_id: str, file_path: str) -> str:
    """The durable marker for one stale `file_ledger` row (§11.3)."""

    return f"<!-- amanuensis:ledger-stale:{_ledger_row_token(subsystem_id, file_path)} -->"


# ---------------------------------------------------------------------------
# The standing reconciliation (spec.md §3.2, §3.3, §3.4)
#
# The projection is a reader of the store, never the system of record, and this
# is the one reading that decides whether any coverage fraction on any page has
# a denominator at all.  It lives here rather than in `renderers.py` so the
# renderer and the independent read-back cannot disagree about whether a store
# is reconciled: one definition, read by the page that prints the number and by
# the axis that checks it (GP28).
# ---------------------------------------------------------------------------

#: The one byte a repository path cannot contain, so a joined set is unambiguous.
NUL = "\x00"

# The classifications that exempt a tracked path from the obligation to be read
# come from the generated vocabulary, never from a list maintained here.
EXEMPT_CLASSIFICATIONS: tuple[str, ...] = tuple(
    value
    for value in values_of("file_classification")
    if value not in OBLIGATION_BEARING_CLASSIFICATIONS
)


#: What the overview prints where a coverage figure has no denominator (§3.4).
UNMEASURED = "not measured"

#: The two overview rows §3.4 moves to the standing reconciliation, named once
#: and read by the renderer that prints them and the axis that checks them.
COVERAGE_ROW_FILES_READ = "Files read, of those carrying an obligation"
COVERAGE_ROW_UNLEDGERED = "Paths in scope with no ledger row"
# The renderer's out-of-band reading for a store whose tracked paths all carry
# an exempting classification: a denominator of zero is not a fraction (§1.4).
NO_OBLIGATION_SENTENCE = "no tracked path carries a survey obligation"
COVERAGE_ROW_CARRIED = "Carried defects undecided"

OVERVIEW_PAGE_HTML = "index.html"

# The HTML view renders a metric table as a description list, and a data table
# as a table; both shapes are read, so this axis does not depend on which one
# the shared template happens to use.
_HTML_PAIR_RE = re.compile(
    r"<dt\b[^>]*>(?P<label>.*?)</dt>\s*<dd\b[^>]*>(?P<value>.*?)</dd>", re.S | re.I
)
_HTML_ROW_RE = re.compile(r"<tr\b[^>]*>(?P<body>.*?)</tr>", re.S | re.I)
_HTML_CELL_RE = re.compile(r"<t[dh]\b[^>]*>(?P<cell>.*?)</t[dh]>", re.S | re.I)
_TAG_RE = re.compile(r"<[^>]+>")


def _plain(fragment: str) -> str:
    return unescape(_TAG_RE.sub("", fragment)).strip()


def _metric_cell(text: str, label: str) -> str | None:
    """The value cell of one metric row on an HTML page, as a pair or a table row."""

    for pair in _HTML_PAIR_RE.finditer(text):
        if _plain(pair.group("label")).strip("*` ") == label:
            return _plain(pair.group("value"))
    for match in _HTML_ROW_RE.finditer(text):
        cells = [_plain(c.group("cell")) for c in _HTML_CELL_RE.finditer(match.group("body"))]
        if len(cells) >= 2 and cells[0].strip("*` ") == label:
            return cells[1]
    return None


BOUND_WORKSPACE: ContextVar[Path | None] = ContextVar("bound_workspace", default=None)


def resolve_workspace(storage: Path) -> Path:
    """Prefer the caller's binding; recorded paths are legacy provenance."""

    bound = BOUND_WORKSPACE.get()
    if bound is not None:
        return bound

    record = storage / "workspace_path"
    if record.is_file():
        recorded = record.read_text().strip()
        if recorded:
            return Path(recorded)
    return storage.parent


# §9.2's one-token citation grammar, as `CITATION_TOKEN_SOURCE` publishes it:
# `path:symbol@sha`, the revision 7-40 hex.
CITATION_TOKEN = re.compile(r"^([^\s:]+(?:/[^\s:]+)*):([^\s@]+)@([0-9a-fA-F]{7,40})$")


def anchor_opens(workspace: Path, anchor: object) -> bool:
    """Whether `anchor` is a citation whose path exists in its own revision.

    §4.4 discharges a subsystem's vocabulary obligation with an **anchored**
    term, and D0's B4 reads the same word by running `git cat-file -e
    <sha>:<path>`.  A projection that asks only whether `first_seen` is a
    non-empty string calls a term current that no reader can open, and renders
    the declination it supposedly superseded as history (F6/codex).
    """

    match = CITATION_TOKEN.match(str(anchor or "").strip())
    if match is None or not workspace.is_dir():
        return False
    path, _symbol, revision = match.groups()
    try:
        result = subprocess.run(
            ["git", "-C", str(workspace), "cat-file", "-e", f"{revision}:{path}"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


# ---------------------------------------------------------------------------
# The effective explanation (spec §3.2)
# ---------------------------------------------------------------------------

#: Statuses at which a subsystem owes an explanation, from the one field the
#: contract carries (§3.1). Every reader asks it, so none restates the list.
EXPLANATION_ELIGIBLE_STATUSES: tuple[str, ...] = tuple(
    str(entry["value"])
    for entry in VOCABULARY["subsystem_status"]["values"]  # type: ignore[index, union-attr]
    if entry.get("explanation_eligible")  # type: ignore[union-attr]
)


@dataclass(frozen=True)
class ExplanationReading:
    """What a slot's effective row says: its state, the row, and whether it was checked."""

    state: str
    row: dict[str, Any] | None
    checked: bool


def select_explanation(
    candidates: list[dict[str, Any]],
    resolvable: set[str] | None,
    eligible: bool,
    admits_imported: bool = False,
) -> ExplanationReading:
    """§3.2 as a pure function over `(rows, resolvable revisions, eligibility)`.

    With a bound workspace (`resolvable` is a set) the effective row is the one
    with the greatest `id` whose `ref_sha` is in it; without one (`None`) nothing
    can be resolved, the greatest `id` is effective and the reading is unchecked.
    A `withdrawn` effective row, no row, or an ineligible subject all read
    `not-recorded`. The TypeScript reader runs the same cases from
    `mcp-server/contracts/explanation-effective-cases.json`.

    An `imported` row is the thesis the import copied in (store-only PLAN §2.2).
    With `admits_imported`, which only the project's purpose passes, it reads as
    `recorded`; anywhere else it reads `not-recorded`.
    """

    checked = resolvable is not None
    if not eligible:
        return ExplanationReading("not-recorded", None, checked)
    pool = [
        candidate
        for candidate in candidates
        if resolvable is None or str(candidate["ref_sha"]) in resolvable
    ]
    if not pool:
        return ExplanationReading("not-recorded", None, checked)
    effective = max(pool, key=lambda candidate: int(candidate["id"]))
    disposition = str(effective["disposition"])
    if disposition == "imported":
        disposition = "recorded" if admits_imported else "withdrawn"
    if disposition == "withdrawn":
        return ExplanationReading("not-recorded", None, checked)
    return ExplanationReading(disposition, effective, checked)


# D2: an imported thesis is printed with this qualification until a recorded
# purpose replaces it. The census owes it beside the body (F1/codex, slice-S1).
IMPORTED_PURPOSE_LABEL = (
    "This thesis was imported from the entry point, not tied to evidence;"
    " a recorded purpose replaces it."
)


def project_purpose_text(reading: ExplanationReading) -> tuple[str, tuple[str, ...]] | None:
    """What the overview owes for the project's purpose, and the lint's reasons.

    The overview's thesis slot prints the effective project purpose (store-only
    PLAN §2.2, §3.3), so the renderer and the read-back's census ask this one
    function what the slot holds. A recorded or imported body that the
    orientation lint or C32's composite rule refuses is replaced by the refusal
    sentence; an imported body carries its label (D2); a declination is the
    reason. `None` when the store holds no effective purpose.
    """

    if reading.state not in {"recorded", "declined"} or reading.row is None:
        return None
    body = str(reading.row["body"])
    if reading.state == "declined":
        return body, ()
    status = tuple(orientation_violations(body))
    composite = tuple(composite_index_violations(body))
    if status or composite:
        return (THESIS_REFUSED if status else THESIS_REFUSED_COMPOSITE), status + composite
    if str(reading.row["disposition"]) == "imported":
        return f"{body}\n\n{IMPORTED_PURPOSE_LABEL}", ()
    return body, ()


def subject_explanation_eligible(
    subject_type: str,
    status: str | None,
    all_statuses: list[str | None],
    slot: str | None = None,
) -> bool:
    """Whether a subject can hold an effective explanation, by the shared cases.

    A subsystem answers by its own status. The project's account is written once a
    subsystem has been read (R3), and reads `not-recorded` while none is eligible.
    The project's purpose is its thesis, written at onboarding before any subsystem
    is read, so it is eligible whatever the statuses are (store-only PLAN §2.2).
    """

    if subject_type == "project":
        return slot == "purpose" or any(
            value in EXPLANATION_ELIGIBLE_STATUSES for value in all_statuses
        )
    return status in EXPLANATION_ELIGIBLE_STATUSES


def workspace_is_bound(workspace: Path) -> bool:
    """Whether `workspace` is a git work tree revisions can be resolved in."""

    if not workspace.is_dir():
        return False
    return git_answer(workspace, "rev-parse", "--is-inside-work-tree") == "true"


def git_answer(workspace: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(workspace), *args],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def git_paths(workspace: Path, *args: str) -> list[str] | None:
    """The NUL-delimited paths a git command names, or None when git cannot answer.

    Newline output quotes a non-ASCII path and `git_answer` trims the first one,
    so neither compares equal to a stored path. Pathspecs are literal, since a
    stored path is a file's name and not a pattern.
    """

    try:
        result = subprocess.run(
            ["git", "--literal-pathspecs", "-C", str(workspace), *args],
            capture_output=True,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return [path for path in result.stdout.decode("utf-8", "surrogateescape").split(NUL) if path]


def revision_resolves(workspace: Path, revision: object) -> bool:
    """Whether the repository has a commit named `revision`."""

    text = str(revision or "").strip()
    return bool(text) and git_answer(workspace, "rev-parse", "--verify", "--quiet", f"{text}^{{commit}}") is not None


def explanation_rows(conn: Any) -> list[dict[str, Any]]:
    """Every stored explanation row, oldest first, with the files its evidence cites."""

    if not table_exists(conn, "explanations"):
        return []
    cited: dict[int, list[str]] = {}
    if table_exists(conn, "explanation_evidence"):
        for link in rows(
            conn,
            "SELECT x.explanation_id, e.file_path FROM explanation_evidence x"
            " JOIN evidence e ON e.id = x.evidence_id ORDER BY e.id",
        ):
            cited.setdefault(int(link["explanation_id"]), []).append(str(link["file_path"]))
    stored = rows(
        conn,
        "SELECT id, subject_type, subject_id, slot, disposition, body, ref_sha, session_id,"
        " recorded_at FROM explanations ORDER BY id",
    )
    for record in stored:
        record["cited_files"] = cited.get(int(record["id"]), [])
    return stored


def effective_explanations(
    conn: Any, storage: Path, subject_id: str | None = None
) -> dict[tuple[str, str, str], ExplanationReading]:
    """The reading for every `(subject_type, subject_id, slot)` that has a row.

    One implementation for the pages and the read-back, so the two cannot
    disagree about which row is effective. A subject with no row is absent from
    the result and reads `not-recorded` by omission. `subject_id` limits the
    reading to one subject, so a page resolves only the revisions it cites.
    """

    stored = [
        record
        for record in explanation_rows(conn)
        if subject_id is None or record["subject_id"] == subject_id
    ]
    if not stored:
        return {}
    workspace = resolve_workspace(storage)
    bound = workspace_is_bound(workspace)
    resolvable: set[str] | None = None
    if bound:
        resolvable = {
            sha for sha in {str(r["ref_sha"]) for r in stored} if revision_resolves(workspace, sha)
        }
    statuses = {
        str(r["id"]): str(r["status"] or "")
        for r in rows(conn, "SELECT id, status FROM subsystems")
    }
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for record in stored:
        key = (str(record["subject_type"]), str(record["subject_id"]), str(record["slot"]))
        grouped.setdefault(key, []).append(record)
    readings: dict[tuple[str, str, str], ExplanationReading] = {}
    for key, candidates in grouped.items():
        subject_type, subject_id, slot = key
        eligible = subject_explanation_eligible(
            subject_type, statuses.get(subject_id), list(statuses.values()), slot
        )
        readings[key] = select_explanation(
            candidates,
            resolvable,
            eligible,
            admits_imported=subject_type == "project" and slot == "purpose",
        )
    return readings


# ---------------------------------------------------------------------------
# The records the survey keeps beside its explanations (store-only PLAN §2.1, §2.2)
# ---------------------------------------------------------------------------

#: The page a project narrative's section is printed on. A subsystem's
#: narratives are printed on the subsystem's own page.
PROJECT_NARRATIVE_PAGES: dict[str, str] = {
    "repository-shape": "onboarding-report.html",
    "runtime": "onboarding-report.html",
    "stateful-entities": "onboarding-report.html",
    "concern-calibration": "onboarding-report.html",
    "survey-plan": "onboarding-report.html",
    "start-here": "entry-point.html",
}
CHECKLIST_PAGE = "concern-checklist.html"
#: Review coverage: a subsystem's concern reasoning prints here, under the
#: subsystem's name (store-only PLAN §8 SO9; F8/codex, slice S2).
COVERAGE_PAGE = "concerns.html"
ARCHITECTURE_PAGE = "architecture.html"
#: The subsystem map (atlas and record list) and the seam register (§3.5).
MASTER_PLAN_PAGE = "master-plan.html"
SEAM_PAGE = "seams.html"
#: The import kind a subsystem's survey body carries; it prints on the subsystem's page.
SURVEY_KIND = "subsystem-survey"
NARRATIVE_LABELS = labels("narrative_section")


def narrative_rows(conn: Any) -> list[dict[str, Any]]:
    """Every stored narrative row, oldest first, with the files its evidence cites."""

    if not table_exists(conn, "narratives"):
        return []
    cited: dict[int, list[str]] = {}
    if table_exists(conn, "narrative_evidence"):
        for link in rows(
            conn,
            "SELECT x.narrative_id, e.file_path FROM narrative_evidence x"
            " JOIN evidence e ON e.id = x.evidence_id ORDER BY e.id",
        ):
            cited.setdefault(int(link["narrative_id"]), []).append(str(link["file_path"]))
    stored = rows(
        conn,
        "SELECT id, subject_type, subject_id, section, topic, disposition, body, ref_sha,"
        " session_id, recorded_at FROM narratives ORDER BY id",
    )
    for record in stored:
        record["cited_files"] = cited.get(int(record["id"]), [])
    return stored


def effective_narratives(
    conn: Any, storage: Path, subject_id: str | None = None
) -> list[dict[str, Any]]:
    """The recorded or declined narrative in force for each `(subject, section, topic)`.

    The newest row per key wins, as `readNarratives` (`invariants.ts`) decides
    it. A key whose newest row is `withdrawn` is absent, and so is one whose
    newest row is recorded at a revision a bound workspace cannot resolve: an
    older row is never brought back in its place, since the server has already
    replaced or withdrawn it (F1/codex, slice S2). Rows come back in the order
    their topic was first written, so a correction does not move a topic. The
    page and the read-back both ask this function which rows are in force.
    """

    stored = [
        record
        for record in narrative_rows(conn)
        if subject_id is None or record["subject_id"] == subject_id
    ]
    if not stored:
        return []
    workspace = resolve_workspace(storage)
    resolvable: set[str] | None = None
    if workspace_is_bound(workspace):
        resolvable = {
            sha for sha in {str(r["ref_sha"]) for r in stored} if revision_resolves(workspace, sha)
        }
    grouped: dict[tuple[str, str, str, str], list[dict[str, Any]]] = {}
    for record in stored:
        key = (
            str(record["subject_type"]),
            str(record["subject_id"]),
            str(record["section"]),
            str(record["topic"]),
        )
        grouped.setdefault(key, []).append(record)
    effective: list[dict[str, Any]] = []
    for candidates in grouped.values():
        newest = max(candidates, key=lambda c: int(c["id"]))
        if resolvable is not None and str(newest["ref_sha"]) not in resolvable:
            continue
        if str(newest["disposition"]) in {"recorded", "declined"}:
            effective.append({**newest, "first_id": min(int(c["id"]) for c in candidates)})
    return sorted(effective, key=lambda r: int(r["first_id"]))


def narrative_page(record: dict[str, Any], names: dict[str, str]) -> str | None:
    """The page a narrative is printed on, or None when its subject has no page."""

    if str(record["subject_type"]) == "project":
        return PROJECT_NARRATIVE_PAGES.get(str(record["section"]))
    if str(record["section"]) == "concern-reasoning":
        return COVERAGE_PAGE
    sid = str(record["subject_id"])
    return subsystem_page(sid, names[sid]) if sid in names else None


def narrative_heading(record: dict[str, Any]) -> str:
    """The subheading a narrative is printed under: its topic, else its section's label."""

    topic = str(record["topic"]).strip()
    if topic:
        return topic
    section = str(record["section"])
    return NARRATIVE_LABELS.get(section, section)


def narrative_text(record: dict[str, Any]) -> tuple[str, bool]:
    """What a page prints for a narrative, and whether that is the body.

    A body or declination reason the orientation lint refuses is replaced by the
    refusal sentence, as for an explanation; the renderer and the census ask this
    one function.
    """

    body = str(record["body"])
    if orientation_violations(body):
        return explanation_refusal(NARRATIVE_LABELS.get(str(record["section"]), "narrative").lower() + " narrative"), False
    return body, True


#: Each territory of the skill's `references/concern-territories.md`, by the id
#: `record_territory_disposition` takes, so a page never prints a bare `T7`
#: (F6/codex, slice S2). The SO9 gate checks these against the catalog's headings.
TERRITORY_NAMES = {
    "T1": "Scope-Context Identity Conflation",
    "T2": "Cache Coherence Failure",
    "T3": "Temporal Bound Violation",
    "T4": "Exceptional Path Invariant Asymmetry",
    "T5": "Aliasing and Ownership Violation",
    "T6": "Incremental/Full Path Divergence",
    "T7": "Atomicity Violation",
    "T8": "Concurrency Race Windows",
    "T9": "Resource Lifecycle Asymmetry",
    "T10": "Trust Boundary Elision",
    "T11": "Seam Contract Violations",
}


def territory_label(territory: Any) -> str:
    """A territory id with its name beside it, or the stored text when it names none."""

    text = str(territory or "").strip()
    name = TERRITORY_NAMES.get(text)
    return f"{text} ({name})" if name else text


def escaped_cell(text: Any) -> str:
    """An authored value as one table cell whose pipes stay pipes.

    A pipe is written `\\|`, which a table reader (`_split_table_row`) turns back
    into `|`, so a condition such as "A | B" prints as written in both views
    (F2/codex, slice S2).
    """

    return " ".join(str(text).split()).replace("|", "\\|")


def territory_row(record: dict[str, Any]) -> str:
    """The Territories table row for one effective disposition: the page prints it, the census owes it."""

    return (
        f"| {escaped_cell(territory_label(record['territory']))} | {record['disposition']}"
        f" | {escaped_cell(record['condition'] or '—')} |"
    )


def effective_territory_dispositions(conn: Any) -> list[dict[str, Any]]:
    """The newest disposition for each territory, in the order the territories were first recorded."""

    if not table_exists(conn, "territory_dispositions"):
        return []
    newest: dict[str, dict[str, Any]] = {}
    first: dict[str, int] = {}
    for record in rows(conn, "SELECT * FROM territory_dispositions ORDER BY id"):
        territory = str(record["territory"])
        newest[territory] = record
        first.setdefault(territory, int(record["id"]))
    return [newest[t] for t in sorted(newest, key=lambda t: first[t])]


def checklist_concerns(conn: Any) -> list[dict[str, Any]]:
    """The active concerns that carry a territory or a probe, and the subsystems that dispositioned each."""

    if not table_exists(conn, "concerns"):
        return []
    columns = {str(r["name"]) for r in rows(conn, "PRAGMA table_info(concerns)")}
    if not {"territory", "probe"} <= columns:
        return []
    found = rows(
        conn,
        "SELECT code, category, territory, probe FROM concerns"
        " WHERE status = 'active' AND (coalesce(territory, '') <> '' OR coalesce(probe, '') <> '')"
        " ORDER BY category, territory, code",
    )
    where: dict[str, list[str]] = {}
    for link in rows(
        conn, "SELECT DISTINCT concern_code, subsystem_id FROM dispositions ORDER BY subsystem_id"
    ):
        where.setdefault(str(link["concern_code"]), []).append(str(link["subsystem_id"]))
    for record in found:
        record["subsystems"] = where.get(str(record["code"]), [])
    return found


def _flat(text: str) -> str:
    """Whitespace-collapsed text with heading marks removed, for presence checks.

    An account is nested beneath the page's own headings, so its `#` marks move
    while its words do not; presence is a question about the words. The
    publication also links every subsystem id an account names and bolds the
    page's own id, so a link is read as its label and bold marks are dropped on
    both sides of the comparison. Every line break counts as one, since a recorded
    heading behind a carriage return is nested on the page like any other.
    """

    lines = "\n".join(text.splitlines())
    unlinked = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", lines).replace("**", "")
    return " ".join(re.sub(r"(?m)^\s*#{1,6}(?=\s)", "", unlinked).split())


def _resolver_pattern(
    owed: str,
    names: dict[str, str],
    concerns: set[str],
    *,
    words: bool = False,
    tokens: bool = False,
) -> re.Pattern[str]:
    """`owed` as a pattern that also matches what the xref resolver adds to it.

    The resolver prints a subsystem's name beside its first mention on a page
    (PLAN §2.2 item 3) and introduces a concern code as "concern RC-2" (item 5),
    so an account reads, on the page, with words its author did not write.
    Whether a mention is the page's first depends on what precedes the account,
    so each such addition is optional; every word the author wrote stays owed,
    including a name the author wrote in brackets after an ID. The two shapes
    recognised are exactly those: ` (<name>)` directly after a subsystem ID and
    `concern ` directly before a concern code. With `words`, `owed` and the
    page are `_html_words` text and the additions are matched as words; with
    `tokens`, they are `_tokens_of` text, and the brackets around a name are
    tokens too.
    """

    def form(text: str) -> str:
        if tokens:
            return _tokens_of(text)
        return _html_words(text).strip() if words else text

    shown = {identifier: form(name.replace("|", "/")) for identifier, name in names.items()}
    forms = {form(identifier): identifier for identifier in [*names, *concerns] if form(identifier)}
    if not forms:
        return re.compile(re.escape(owed))
    ids = "|".join(re.escape(f) for f in sorted(forms, key=lambda f: (-len(f), f)))
    found = re.compile(rf"(?<!\S)({ids})(?!\S)" if words or tokens else rf"(?<![\w-])({ids})(?![\w-])")
    parts: list[str] = []
    at = 0
    for match in found.finditer(owed):
        identifier = forms[match.group(1)]
        parts.append(re.escape(owed[at : match.start()]))
        if identifier in concerns:
            parts.append(f"(?:concern )?{re.escape(match.group(1))}")
        else:
            name = shown[identifier]
            if tokens:
                addition = rf" \( {re.escape(name)} \)"
            else:
                addition = f" {re.escape(name)}" if words else rf" \({re.escape(name)}\)"
            parts.append(f"{re.escape(match.group(1))}(?:{addition})?" if name else re.escape(match.group(1)))
        at = match.end()
    parts.append(re.escape(owed[at:]))
    return re.compile("".join(parts))


def _html_words(text: str) -> str:
    """A generated HTML page's visible words, space-delimited, for presence checks.

    Scripts and styles are not read, and a tag's attributes (a hover definition,
    a link target) are not on the page in the sense a reader means.
    """

    visible = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", text)
    plain = unescape(re.sub(r"<[^>]+>", " ", visible))
    return " " + " ".join(re.findall(r"[^\W_]+", plain)) + " "


def _missing_html_line(
    owed: str,
    page_words: str,
    names: dict[str, str] | None = None,
    concerns: set[str] | None = None,
) -> str | None:
    """The first line of an explanation the HTML page does not carry, or None.

    Compared by line and by word, since the projection turns Markdown marks
    into elements: a list marker or an ordered item's number becomes structure
    and a fence line opens a block, and neither is a word on the page. The words
    expected are the ones the projection's own inline renderer gives, which can
    differ from the record's: a status in a code span prints as its chip's label
    and a few schema phrases print as the reader's. A fenced line is printed as
    written. Outside a fence, a subsystem's name after its ID and "concern"
    before a concern code may be the resolver's (`_resolver_pattern`).
    """

    from .html_projection import _inline  # noqa: PLC0415 — it imports this module

    fence = False
    for line in re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", owed).splitlines():
        if re.match(r"\s*(```|~~~)", line):
            fence = not fence
            continue
        text = re.sub(r"^\s*(\d+[.)]|[-*+>])\s+", "", line)
        words = _html_words(text if fence else _inline(text)).strip()
        if not words:
            continue
        if fence:
            if f" {words} " not in page_words:
                return line
        elif not _resolver_pattern(f" {words} ", names or {}, concerns or set(), words=True).search(
            page_words
        ):
            return line
    return None


def set_digest(parts: list[str]) -> str:
    """A set, as one hash: sorted, NUL-joined, SHA-256 (§3.2).

    Sorted so the digest states the set and not the order git or SQLite
    happened to return it in, and joined on NUL because that is the one byte a
    repository path cannot contain.  The same construction the server uses
    (`mcp-server/src/invariants.ts` `digestOf`); a second construction here
    would make every reconciliation this process reads look stale.
    """

    return hashlib.sha256(NUL.join(sorted(parts)).encode()).hexdigest()


def tracked_path_digest(paths: list[str]) -> str:
    """§3.2's `tree_digest`: the tracked path set the counts were taken over."""

    return set_digest(paths)


def examined_tracked(conn: Any) -> int:
    """§1.2's D3: distinct examined ledger paths the tree still carries.

    The numerator of the overview's `Files read` row, defined once so the
    read-back recomputes the published value from the store rather than
    searching the page for a substring of it (F7/codex).
    """

    return int(
        (
            row(
                conn,
                "SELECT COUNT(*) AS n FROM (SELECT DISTINCT file_path FROM file_ledger"
                " WHERE classification='examined' AND file_path NOT IN"
                " (SELECT file_path FROM scope_gaps WHERE kind='absent'))",
            )
            or {}
        ).get("n")
        or 0
    )


def ledger_digest(conn: Any) -> str:
    """§3.2's `ledger_digest`: the ledger the counts were taken against."""

    return set_digest(
        [
            f"{r['file_path']}{NUL}{r['classification'] or ''}"
            for r in rows(conn, "SELECT file_path, classification FROM file_ledger")
        ]
    )


def tree_paths(workspace: Path, revision: str) -> list[str] | None:
    """The paths the **tree** at `revision` carries, or None when git cannot say.

    `git ls-files` reads the index, which moves under an unrelated `git add`
    and does not describe the revision at all (§3.3).  `-z` because git quotes
    any path it cannot print literally, and a quoted path is a different string
    from the one the ledger stores.
    """

    if not revision or not workspace.is_dir():
        return None
    try:
        result = subprocess.run(
            ["git", "-C", str(workspace), "ls-tree", "-r", "--name-only", "-z", revision],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return [path for path in result.stdout.split(NUL) if path]


#: Why a reading does not stand, in the words the projection prints.  Named
#: constants because §8.6 makes an omitted reason a red condition: a sentence
#: that says only "not measured" tells a reader nothing to repair.
WHY_NONE_RECORDED = "no reconciliation has been recorded at that revision"
WHY_NONE_AT_ALL = (
    "no reconciliation has been recorded, at that revision or at any other"
)
WHY_LEDGER_MOVED = (
    "the file ledger has changed since the reconciliation recorded there was taken"
)
WHY_OTHER_TREE = "the reconciliation recorded there was taken over a different tree"
WHY_NO_REVISION = "the store records no checked revision to reconcile against"
WHY_NO_TREE = (
    "the bound workspace cannot enumerate the tree at that revision, so the"
    " reconciliation could not be re-derived"
)


@dataclass(frozen=True)
class ReconciliationStanding:
    """Whether the store is *reconciled at* the revision it stamps, and why not.

    `record` is the standing reconciliation (§3.3: the most recent qualifying
    row) or None.  `why` is None exactly when `record` is not, so a caller can
    never read a reason for a reading that stands, or a reading from a store
    that has none.
    """

    sha: str
    record: dict[str, Any] | None
    latest_sha: str | None
    why: str | None

    @property
    def stands(self) -> bool:
        return self.record is not None

    @property
    def tracked_paths(self) -> int | None:
        """|tracked| at the reconciled revision, or None — never 0 for absent."""

        return None if self.record is None else int(self.record["tracked_paths"] or 0)

    @property
    def unledgered(self) -> int | None:
        return None if self.record is None else int(self.record["unledgered"] or 0)

    @property
    def obligation_paths(self) -> int | None:
        """§1.2's D2: tracked paths minus those an exempting classification frees."""

        if self.record is None:
            return None
        return int(self.record["tracked_paths"] or 0) - int(self.record["exempt"] or 0)


def reconciliation_standing(conn: Any, storage: Path) -> ReconciliationStanding:
    """§3.3, as far as a read-only reader of the store can evaluate it.

    Conditions 1 and 3 collapse here: the revision the projection stamps *is*
    `git_state.last_checked_sha`, so a row's `detected_sha` is compared against
    the revision the pages are stamped with.  Condition 5 — the ledger digest
    re-derived now — is pure SQL and is always checked; it is the ordinary
    invalidation, because every later `add_files_to_scope` or classification
    change moves it.  Condition 4 is checked whenever the bound workspace can
    enumerate the tree at that revision.

    **Where git cannot answer**, conditions 1 and 4 are unevaluated and the
    reconciliation does not stand: §3.3 is a conjunction, and a reading nothing
    can re-derive is not one.  An earlier draft let the row's own
    `ledger_digest` carry it, which published a fraction over a path set no
    reader of this projection could check (F4/codex).  `GATE SR1` owns whether
    a written reconciliation was correct; this reader owns whether one is being
    read at the revision it claims, against the tree it claims.
    """

    sha = str((row(conn, "SELECT last_checked_sha FROM git_state WHERE repo_id='default'") or {}).get("last_checked_sha") or "")
    if not table_exists(conn, "scope_reconciliations"):
        return ReconciliationStanding(sha, None, None, WHY_NONE_AT_ALL)
    latest = row(
        conn, "SELECT detected_sha FROM scope_reconciliations ORDER BY id DESC LIMIT 1"
    )
    latest_sha = str(latest["detected_sha"]) if latest else None
    if not sha:
        return ReconciliationStanding(sha, None, latest_sha, WHY_NO_REVISION)
    at_sha = rows(
        conn,
        "SELECT id, detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows,"
        " unledgered, absent, exempt, detected_at FROM scope_reconciliations"
        " WHERE detected_sha = ? ORDER BY id DESC",
        (sha,),
    )
    if not at_sha:
        return ReconciliationStanding(
            sha, None, latest_sha, WHY_NONE_AT_ALL if latest_sha is None else WHY_NONE_RECORDED
        )
    current_ledger = ledger_digest(conn)
    tracked = tree_paths(resolve_workspace(storage), sha)
    if tracked is None:
        # §3.3 is a conjunction of five conditions, and conditions 1 and 4 both
        # need the tree at R. Where no workspace answers, neither was evaluated,
        # so the store is not reconciled at R and has no denominator -- the same
        # answer §3.4 gives every other reading that does not stand. Reporting
        # the recorded counts instead would publish a fraction of a set nobody
        # here inventoried, which is the silent failure this section exists to
        # remove (F4/codex, VP4(e)).
        return ReconciliationStanding(sha, None, latest_sha, WHY_NO_TREE)
    expected_tree = tracked_path_digest(tracked)
    for candidate in at_sha:
        if str(candidate["ledger_digest"]) != current_ledger:
            continue
        if str(candidate["tree_digest"]) != expected_tree:
            continue
        return ReconciliationStanding(sha, candidate, latest_sha, None)
    # No qualifying row. Name which condition failed: a store whose ledger moved
    # under the reading and one whose revision was re-pointed both run
    # `detect_changes`, but a reader told only "unreconciled" cannot tell one
    # lost reading from a reading never taken.
    if any(str(c["ledger_digest"]) == current_ledger for c in at_sha):
        return ReconciliationStanding(sha, None, latest_sha, WHY_OTHER_TREE)
    return ReconciliationStanding(sha, None, latest_sha, WHY_LEDGER_MOVED)


# ---------------------------------------------------------------------------
# Carried obligations (spec.md §5.2, §5.6)
#
# Lens membership for a carried record, defined once and read by the renderer
# and by the census below.  The partition is over *decidedness*, not over the
# archived resolution state: a carried record is an obligation this store has
# either discharged or not, and the archived store's own verdict is history
# that travelled with it.
# ---------------------------------------------------------------------------
CARRIED_UNDECIDED = "undecided"

CARRIED_LENS_PAGES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("Unresolved", "findings.html", (CARRIED_UNDECIDED,)),
    (
        "History",
        "resolved-findings.html",
        ("successor-finding", "ruled-out", "repaired", "archived-terminal"),
    ),
)

CARRIED_PAGE_BY_OUTCOME: dict[str, str] = {
    outcome: page for _lens, page, outcomes in CARRIED_LENS_PAGES for outcome in outcomes
}

CARRIED_HEADING = "Carried obligations"


def carried_page(outcome: str | None) -> str | None:
    """The page a carried record with this outcome renders on, or None."""

    return CARRIED_PAGE_BY_OUTCOME.get(str(outcome or CARRIED_UNDECIDED))


def _carried_token(archived_store_id: str, archived_finding_id: str) -> str:
    """One digest per carried record, over the key the store is unique by.

    `carried_findings` is `UNIQUE (archived_store_id, archived_finding_id)`, and
    §5.7 refuses an unqualified id for exactly that reason: two archives can
    carry the same finding id.  The marker is qualified the same way, so two
    archives' records cannot collide into one marker.
    """

    return hashlib.sha256(
        f"{archived_store_id}{NUL}{archived_finding_id}".encode()
    ).hexdigest()


def carried_marker(archived_store_id: str, archived_finding_id: str) -> str:
    """The durable marker for one carried obligation (§5.6)."""

    return f"<!-- amanuensis:carried:{_carried_token(archived_store_id, archived_finding_id)} -->"


def carried_anchor(archived_store_id: str, archived_finding_id: str) -> str:
    """A collision-resistant anchor for one carried record."""

    return f"cf-{_carried_token(archived_store_id, archived_finding_id)[:10]}"


def carried_records(conn: Any) -> list[dict[str, Any]]:
    """Every carried obligation, with its outcome or the word `undecided`."""

    if not table_exists(conn, "carried_findings"):
        return []
    # A corrected outcome stays in the table with the row that superseded it;
    # only the row nothing supersedes is the record's outcome. A store last
    # opened before corrections existed has no such column and one row each.
    corrected = any(
        column["name"] == "supersedes_outcome_id"
        for column in rows(conn, "PRAGMA table_info(carried_finding_outcomes)")
    )
    current = (
        " AND NOT EXISTS (SELECT 1 FROM carried_finding_outcomes later"
        " WHERE later.supersedes_outcome_id = o.id)"
        if corrected
        else ""
    )
    return rows(
        conn,
        "SELECT c.carried_id, c.archived_finding_id, c.archived_store_id,"
        " c.archived_anchor_sha, c.subsystem_id, c.severity, c.symptom, c.root_cause,"
        " c.archived_resolution, c.primary_files,"
        " COALESCE(o.outcome, ?) AS outcome, o.successor_id, o.repaired_sha,"
        " o.rationale, o.ref_sha AS outcome_ref_sha"
        " FROM carried_findings c"
        " LEFT JOIN carried_finding_outcomes o ON o.carried_id = c.carried_id" + current +
        " ORDER BY CASE c.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1"
        "   WHEN 'MEDIUM' THEN 2 ELSE 3 END, c.archived_store_id, c.archived_finding_id",
        (CARRIED_UNDECIDED,),
    )


def carry_was_run(conn: Any) -> bool:
    """Whether any carry ran at all, including a reasoned empty one (§5.2).

    "Nothing was carried" and "nobody ran a carry" are different facts, and the
    overview must not report the first when it means the second: the row is
    published when a carry is on record, and omitted when none is.
    """

    if table_exists(conn, "carry_runs") and int(
        (row(conn, "SELECT COUNT(*) AS n FROM carry_runs") or {"n": 0})["n"] or 0
    ):
        return True
    return bool(carried_records(conn))


def ledger_stale_anchor(subsystem_id: str, file_path: str) -> str:
    """A collision-resistant anchor for that row's record (§7.4).

    `slugify` collapses every run of non-`[a-z0-9-]` characters, so
    `src/a/b.ts`, `src/a-b.ts`, and `src/a.b.ts` would share one anchor. The
    digest does not, and the readable path stays beside it as link text.
    """

    return f"ls-{_ledger_row_token(subsystem_id, file_path)[:10]}"


class _HtmlInventory(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []
        self.anchors: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            self.anchors.add(str(values["id"]))
        if tag == "a" and values.get("href"):
            self.links.append(str(values["href"]))


def _links(text: str) -> list[str]:
    parser = _HtmlInventory()
    parser.feed(text)
    return parser.links


def _anchors(text: str, suffix: str) -> set[str]:
    if suffix not in HTML_SUFFIXES:
        return set()
    parser = _HtmlInventory()
    parser.feed(text)
    return parser.anchors


def _local_links(text: str, suffix: str) -> list[str]:
    # Only HTML pages carry cross-links. The generated index is JavaScript, and
    # reading links out of a JSON payload would invent link targets for the
    # coverage axis to fail to resolve.
    if suffix not in LINKED_SUFFIXES:
        return []
    return [
        target
        for target in _links(text)
        if not target.startswith(("http://", "https://", "mailto:", "#"))
    ]


def write_contract(output: Path, page_paths: list[str], notice: str = "") -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    links: list[dict[str, str]] = []
    for rel in sorted(page_paths):
        path = output / rel
        if not path.is_file():
            continue
        body = path.read_text()
        pages.append({"path": rel, "content_hash": sha256_bytes(path.read_bytes())})
        links.extend(
            {"source": rel, "target": target}
            for target in _local_links(body, path.suffix.lower())
        )
    contract = {
        "version": CONTRACT_VERSION,
        "pages": pages,
        "local_links": sorted(links, key=lambda x: (x["source"], x["target"])),
        # The command-line render notice every page carries, or null for a
        # publication whose caller records its read-back (PLAN O15). A later
        # `--readback-only` reads it here, since it has no render flags of its own.
        "render_notice": notice or None,
    }
    (output / CONTRACT_NAME).write_text(json.dumps(contract, indent=2) + "\n")
    return contract


# ---------------------------------------------------------------------------
# Record marks and drawn elements (store-only PLAN §3.5).
# ---------------------------------------------------------------------------

#: The attributes a rendered record and a drawn node or edge carry. Nothing else
#: in a page is named by them, so a golden page that gained only these is unchanged.
RECORD_MARK_ATTRIBUTES = ("data-record", "data-state", "data-node", "data-edge")
_RECORD_MARK = re.compile(r' data-(?:record|state|node|edge)="[^"]*"')


def without_record_marks(text: str) -> str:
    """A page with its record marks removed: what it printed before SO20 added them."""

    return _RECORD_MARK.sub("", text)


#: The diagrams whose drawn elements are read back, by their SVG's class.
DRAWN_DIAGRAMS = {"runtime-boundary-svg": "runtime", "boundary-svg": "boundary"}
#: The record types whose text is compared with the store's (the prose bodies).
PROSE_RECORDS = ("narrative", "imported-body")
#: Elements that print a whole record: two of them side by side are two records.
_WHOLE_RECORD_TAGS = {"article", "li"}
_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
#: What may sit between two elements of one record: whitespace and the prose
#: column the writer wraps a run of paragraphs in.
_RUN_GAP = re.compile(r'(?:\s|<div class="prose-flow">|</div>)*')


@dataclass
class _Piece:
    record: str
    state: str | None
    tag: str
    start: int
    end: int = -1
    text: list[str] | None = None
    chips: list[tuple[set[str], str]] | None = None


class _MarkInventory(HTMLParser):
    """The record marks on one page, and the nodes and edges its two census'd SVGs draw.

    A marked element nested in one carrying the same record is part of it. Text
    inside `<caption>` is left out: a table's caption names the section it sits
    in, not the record.
    """

    def __init__(self, text: str) -> None:
        super().__init__(convert_charrefs=True)
        self.source = text
        self.line_starts = [0, *(m.end() for m in re.finditer("\n", text))]
        self.stack: list[tuple[str, _Piece | None, str | None, bool]] = []
        self.pieces: list[_Piece] = []
        self.drawn: dict[str, list[tuple[str, str, str]]] = {}
        self.chip: tuple[set[str], list[str]] | None = None

    def _offset(self) -> int:
        line, column = self.getpos()
        return self.line_starts[line - 1] + column

    def _open_piece(self) -> _Piece | None:
        return next((piece for _tag, piece, _svg, _c in reversed(self.stack) if piece is not None), None)

    def _svg(self) -> str | None:
        return next((svg for _tag, _piece, svg, _c in reversed(self.stack) if svg is not None), None)

    def _start(self, tag: str, attrs: list[tuple[str, str | None]], closed: bool) -> None:
        values = {name: value or "" for name, value in attrs}
        classes = set(values.get("class", "").split())
        svg = next((DRAWN_DIAGRAMS[c] for c in classes if tag == "svg" and c in DRAWN_DIAGRAMS), None)
        if svg is None and tag == "figure" and "data-diagram" in values:
            svg = f"figure:{values['data-diagram']}:{values.get('data-subject', '')}"
        within = svg or self._svg()
        if within is not None:
            if tag in ("line", "path"):
                self.drawn.setdefault(within, []).append(("edge", tag, values.get("data-edge", "")))
            elif "data-node" in values or (tag == "rect" and "runtime-svg-node" in classes) or (
                tag == "g" and "boundary-svg-node" in classes
            ):
                self.drawn.setdefault(within, []).append(("node", tag, values.get("data-node", "")))
        piece = None
        record = values.get("data-record")
        current = self._open_piece()
        if current is not None and current.text is not None:
            current.text.append(" ")  # a tag is a word boundary, as `_html_words` reads it
        if record and (current is None or current.record != record):
            piece = _Piece(record, values.get("data-state"), tag, self._offset(), text=[], chips=[])
            self.pieces.append(piece)
        # A status chip inside a record is the state the reader sees printed; a
        # territory prints its disposition as a table cell, read as one too.
        cell = tag == "td" and values.get("data-label") == "Disposition"
        chip = (tag == "span" and "status" in classes or cell) and (piece or current) is not None
        if chip:
            self.chip = ({"cell-disposition"} if cell else classes, [])
        if closed or tag in _VOID:
            if piece is not None:
                piece.end = self._offset() + len(self.get_starttag_text() or "")
            return
        self.stack.append((tag, piece, svg, chip))

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, False)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, True)

    def handle_endtag(self, tag: str) -> None:
        if not any(open_tag == tag for open_tag, *_rest in self.stack):
            return
        at = self._offset()
        holder = self._open_piece()
        if holder is not None and holder.text is not None:
            holder.text.append(" ")
        while self.stack:
            open_tag, piece, _svg, chip = self.stack.pop()
            if chip and self.chip is not None:
                piece_open = piece or self._open_piece()
                if piece_open is not None and piece_open.chips is not None:
                    piece_open.chips.append((self.chip[0], " ".join("".join(self.chip[1]).split())))
                self.chip = None
            if piece is not None:
                close = self.source.find(">", at)
                piece.end = close + 1 if close >= 0 else at
            if open_tag == tag:
                break

    def handle_data(self, data: str) -> None:
        if any(open_tag == "caption" for open_tag, *_rest in self.stack):
            return
        piece = self._open_piece()
        if piece is not None and piece.text is not None:
            piece.text.append(data)
        if self.chip is not None:
            self.chip[1].append(data)


def _tokens_of(text: str) -> str:
    """Text as tokens one space apart: each run of letters and digits, and each other mark.

    Punctuation, operators and the underscore are kept, each as its own token, so
    `attempts < 3` and `attempts > 3` differ; only where the spaces fall is not
    compared, since a tag the cross-reference pass adds is a boundary on the page
    and not in the store's body.
    """

    return " ".join(re.findall(r"[^\W_]+|[^\s\w]|_", text))


def _fragment_tokens(fragment: str) -> str:
    """The tokens an HTML fragment prints, its table captions, scripts and styles left out."""

    visible = re.sub(r"(?is)<(script|style|caption)\b.*?</\1>", " ", fragment)
    return _tokens_of(unescape(re.sub(r"<[^>]+>", " ", visible)))


#: Tags an owed body whose page prints it as runs, each compared with its own (§3.5).
_RUNS = object()


@dataclass
class _Occurrence:
    record: str
    states: set[str | None]
    text: str
    chips: list[tuple[set[str], str]]


def _record_occurrences(text: str) -> tuple[list[_Occurrence], dict[str, list[tuple[str, str, str]]]]:
    """A page's marked records, one per run of elements carrying the same mark, and its drawn elements."""

    parser = _MarkInventory(text)
    parser.feed(text)
    parser.close()
    out: list[_Occurrence] = []
    previous: _Piece | None = None
    for piece in parser.pieces:
        joined = (
            previous is not None
            and previous.record == piece.record
            and not {previous.tag, piece.tag} & _WHOLE_RECORD_TAGS
            and previous.end >= 0
            and _RUN_GAP.fullmatch(text[previous.end : piece.start]) is not None
        )
        words = _tokens_of("".join(piece.text or []))
        if joined and out:
            last = out[-1]
            last.states.add(piece.state)
            last.text = f"{last.text} {words}".strip()
            last.chips += piece.chips or []
        else:
            out.append(_Occurrence(piece.record, {piece.state}, words, list(piece.chips or [])))
        previous = piece
    return out, parser.drawn


def _resolver_names(conn: Any) -> tuple[dict[str, str], dict[str, str], set[str]]:
    """The names the xref resolver adds beside an ID: `(all subsystems, the ones it names, concern codes)`.

    The kinds the resolver acts on are those the xref index keeps: a later
    family's ID overrides an earlier one's (`_build_xref_index`).
    """

    names = {str(r["id"]): str(r["name"]) for r in rows(conn, "SELECT id, name FROM subsystems")}
    later = {str(r["id"]) for r in rows(conn, "SELECT id FROM seams")}
    later |= {str(r["finding_id"]) for r in rows(conn, "SELECT finding_id FROM findings")}
    later |= {f"DM-{r['id']}" for r in rows(conn, "SELECT id FROM diagnosticity_sessions")}
    concerns = {str(r["code"]) for r in rows(conn, "SELECT code FROM concerns")} - later
    named = {i: n for i, n in names.items() if i not in concerns and i not in later}
    return names, named, concerns


class ProjectionVerifier:
    def __init__(
        self,
        storage: Path,
        output: Path,
        expected_pages: list[str],
        notice: str | None = None,
    ) -> None:
        self.storage = storage
        self.output = output
        self.expected_pages = sorted(expected_pages)
        # The render notice the pages must carry: the render's own flag when a
        # render runs this read-back, or None to take it from the receipt.
        self.notice = notice

    def verify(self) -> dict[str, Any]:
        mismatches: list[dict[str, str]] = []
        contract_path = self.output / CONTRACT_NAME
        contract: dict[str, Any] = {}
        if not contract_path.is_file():
            for axis in ("state", "coverage", "content"):
                mismatches.append(
                    {
                        "axis": axis,
                        "object_type": "projection-contract",
                        "object_id": CONTRACT_NAME,
                        "detail": "publication receipt is missing",
                    }
                )
            return self._summary(mismatches)
        try:
            contract = json.loads(contract_path.read_text())
        except (json.JSONDecodeError, OSError) as exc:
            for axis in ("state", "coverage", "content"):
                mismatches.append(
                    {
                        "axis": axis,
                        "object_type": "projection-contract",
                        "object_id": CONTRACT_NAME,
                        "detail": f"publication receipt is unreadable: {exc}",
                    }
                )
            return self._summary(mismatches)

        # `*.js` joins the inventory so the generated index is a page the
        # coverage axis can find. Without it the file is present, expected, and
        # reported missing — the wrong red, which is as much a defect as the
        # wrong green (§8.2). `*.md` is inventoried though no run writes one
        # (store-only PLAN §3.2 step 3): a `.md` left in the output is an
        # unplanned page, and coverage reports it.
        projection = {
            str(path.relative_to(self.output)): path.read_text()
            for pattern in ("*.md", "*.html", "*.js")
            for path in self.output.rglob(pattern)
            if path.is_file()
        }

        # State correspondence comes from the DB, not from the renderer or its
        # receipt.  A missing or duplicated marker is independently visible.
        conn = open_ro(self.storage / "memory.db")
        try:
            findings = rows(conn, "SELECT finding_id FROM findings ORDER BY finding_id")
            mismatches.extend(self._finding_partition_census(conn, projection))
            mismatches.extend(self._ledger_stale_census(conn, projection))
            mismatches.extend(self._locus_index_census(conn, projection))
            mismatches.extend(self._carried_record_census(conn, projection))
            mismatches.extend(self._coverage_measurement_census(conn, projection))
            mismatches.extend(self._explanation_census(conn, projection))
            mismatches.extend(self._record_page_census(conn, projection))
            mismatches.extend(self._record_mark_census(conn, projection))
            mismatches.extend(self._drawn_element_census(conn, projection))
            mismatches.extend(self._figure_census(conn, projection))
            mismatches.extend(self._badge_census(conn, projection))
        finally:
            conn.close()
        # Every finding carries exactly one authoritative marker across the
        # HTML pages, the only view (store-only PLAN §3.2 step 3).
        html_text = "\n".join(
            body for rel, body in projection.items() if Path(rel).suffix in HTML_SUFFIXES
        )
        for finding in findings:
            marker = finding_marker(str(finding["finding_id"]))
            count = html_text.count(marker)
            if count != 1:
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "finding-html",
                        "object_id": str(finding["finding_id"]),
                        "detail": f"expected exactly one html state marker, found {count}",
                    }
                )

        # Coverage compares both the current page plan and the link receipt to
        # the completed output.  This catches retired/missing pages and links
        # stripped after xref resolution.
        actual_pages = sorted(projection)
        expected_set = set(self.expected_pages)
        actual_set = set(actual_pages)
        for rel in sorted(expected_set - actual_set):
            mismatches.append(
                {
                    "axis": "coverage",
                    "object_type": "page",
                    "object_id": rel,
                    "detail": "planned page is missing",
                }
            )
        for rel in sorted(actual_set - expected_set):
            mismatches.append(
                {
                    "axis": "coverage",
                    "object_type": "page",
                    "object_id": rel,
                    "detail": "unplanned page remains in the clean projection",
                }
            )

        expected_links = Counter(
            (str(link["source"]), str(link["target"])) for link in contract.get("local_links", [])
        )
        actual_links = Counter(
            (source, target)
            for source, body in projection.items()
            for target in _local_links(body, Path(source).suffix.lower())
        )
        for (source, target), expected_count in sorted(expected_links.items()):
            actual_count = actual_links[(source, target)]
            if actual_count < expected_count:
                mismatches.append(
                    {
                        "axis": "coverage",
                        "object_type": "cross-link",
                        "object_id": f"{source}->{target}",
                        "detail": f"expected {expected_count} occurrence(s), found {actual_count}",
                    }
                )
            target_path = target.split("#", 1)[0]
            if target_path:
                resolved = (self.output / source).parent.joinpath(target_path).resolve()
                try:
                    resolved.relative_to(self.output.resolve())
                except ValueError:
                    exists = False
                else:
                    exists = resolved.is_file()
                if not exists:
                    mismatches.append(
                        {
                            "axis": "coverage",
                            "object_type": "cross-link-target",
                            "object_id": f"{source}->{target}",
                            "detail": "local link target does not resolve inside the projection",
                        }
                    )
                elif "#" in target:
                    fragment = target.split("#", 1)[1]
                    target_rel = str(resolved.relative_to(self.output.resolve()))
                    target_text = projection.get(target_rel)
                    if target_text is None:
                        try:
                            target_text = resolved.read_text()
                        except OSError:
                            target_text = ""
                    if fragment not in _anchors(target_text, resolved.suffix.lower()):
                        mismatches.append(
                            {
                                "axis": "coverage",
                                "object_type": "cross-link-anchor",
                                "object_id": f"{source}->{target}",
                                "detail": "local link fragment does not resolve to an anchor",
                            }
                        )

        # Content is a byte-for-byte drift check against the post-xref receipt.
        # It proves projection correspondence, not the semantic truth of the DB.
        #
        # Membership is checked before the hashes, because hashing the receipt's
        # own members can only ever prove the receipt agrees with itself. A page
        # removed from the receipt while its bytes stay on disk shortens the
        # list this loop walks, and coverage does not see it either — that axis
        # compares the plan to the files present, and the file is present. Left
        # unchecked, the receipt is a place to hide a page from custody
        # (F11/codex).
        receipt_paths = {str(page["path"]) for page in contract.get("pages", [])}
        for rel in self.expected_pages:
            if rel in receipt_paths:
                continue
            if not (self.output / rel).is_file():
                continue  # coverage already owns the missing-page diagnostic
            mismatches.append(
                {
                    "axis": "content",
                    "object_type": "page",
                    "object_id": rel,
                    "detail": "projected page is absent from the publication receipt",
                }
            )
        for page in contract.get("pages", []):
            rel = str(page["path"])
            path = self.output / rel
            if not path.is_file():
                continue  # coverage already owns this diagnostic
            actual_hash = sha256_bytes(path.read_bytes())
            if actual_hash != page.get("content_hash"):
                mismatches.append(
                    {
                        "axis": "content",
                        "object_type": "page",
                        "object_id": rel,
                        "detail": "finished page bytes differ from the publication receipt",
                    }
                )
        mismatches.extend(self._render_notice_census(contract, projection))
        mismatches.extend(self._readme_census(projection))
        return self._summary(mismatches)

    @staticmethod
    def _readme_census(projection: dict[str, str]) -> list[dict[str, str]]:
        """The README is exactly the pointer text, the same for every store (D10).

        A README carrying anything else carries something a survey recorded, or
        something a person typed, into a file the publication says is generated.
        """

        from .html_projection import (  # noqa: PLC0415 — it imports this module
            README_PATH,
            README_TEXT,
        )

        body = projection.get(README_PATH)
        if body is None or body == README_TEXT:
            return []  # a missing README is the coverage axis's to report
        return [
            {
                "axis": "content",
                "object_type": "readme",
                "object_id": README_PATH,
                "detail": "the README differs from the generated pointer text",
            }
        ]

    def _render_notice_census(
        self, contract: dict[str, Any], projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """Each page carries the command-line render notice exactly when it should (O15).

        The notice is part of every page a command-line render writes, so the
        receipt's hashes already cover its bytes; this checks that it is there on
        every page of such a render, in its place, and on no page of a recorded
        publication. A render passes its own flag, which must agree with the
        receipt it just wrote; `--readback-only` takes the receipt's word.
        """

        from .html_projection import CLI_RENDER_NOTICES  # noqa: PLC0415 — it imports this module

        mismatches: list[dict[str, str]] = []
        stated = str(contract.get("render_notice") or "")
        expected = stated if self.notice is None else self.notice
        if stated != expected:
            mismatches.append(
                {
                    "axis": "content",
                    "object_type": "render-notice",
                    "object_id": CONTRACT_NAME,
                    "detail": "the publication receipt states a different render notice from the render's",
                }
            )
        others = [n for n in CLI_RENDER_NOTICES if n != expected]
        forms = [escape(n) for n in others]
        for rel in self.expected_pages:
            body = projection.get(rel)
            if body is None or Path(rel).suffix not in HTML_SUFFIXES:
                continue  # coverage owns a missing page; the search index has no head
            count = body.count(escape(expected)) if expected else 0
            head = re.search(r'<header class="page-head">(.*?)</header>', body, re.S)
            placed = not expected or (
                count == 1 and head is not None and escape(expected) in head.group(1)
            )
            if not placed:
                detail = (
                    "page lacks the command-line render notice"
                    if count == 0
                    else "page carries the command-line render notice out of place or more than once"
                )
            elif any(form in body for form in forms):
                detail = (
                    "page carries a command-line render notice on a recorded publication"
                    if not expected
                    else "page carries the other command-line render notice"
                )
            else:
                continue
            mismatches.append(
                {
                    "axis": "content",
                    "object_type": "render-notice",
                    "object_id": rel,
                    "detail": detail,
                }
            )
        return mismatches

    def _finding_partition_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """Exhaustive census of the finding partition (spec §6.1, §6.2).

        Three properties, each able to turn the state axis red on its own:

        * every value of the resolution vocabulary is claimed by exactly one
          lens — a new enum value with no lens is a partition hole, not a
          rendering detail;
        * `finding_state_current` returns exactly one row per `findings` row,
          and each row lands in exactly one lens membership query.  A row in
          both or in neither is reported by id;
        * the row's marker is on the HTML page its lens selects.
          The marker count check above proves a finding renders once; this
          proves it renders in the right lens.
        """
        mismatches: list[dict[str, str]] = []
        claimed: dict[str, list[str]] = {}
        for lens, _page, states in FINDING_LENS_PAGES:
            for state in states:
                claimed.setdefault(state, []).append(lens)
        for state in values_of("finding_resolution_state"):
            lenses = claimed.get(state, [])
            if len(lenses) != 1:
                named = ", ".join(lenses) or "no lens"
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "finding-partition-vocabulary",
                        "object_id": state,
                        "detail": (
                            f"the resolution state is claimed by {named}"
                            f" ({len(lenses)} lenses), not by exactly one"
                        ),
                    }
                )
        for state in claimed:
            if state not in values_of("finding_resolution_state"):
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "finding-partition-vocabulary",
                        "object_id": state,
                        "detail": "a lens claims a resolution state the vocabulary does not carry",
                    }
                )

        if not table_exists(conn, "finding_state_current"):
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "finding-partition",
                    "object_id": "finding_state_current",
                    "detail": "the partition view is absent from the store",
                }
            )
            return mismatches

        recorded = [str(r["finding_id"]) for r in rows(conn, "SELECT finding_id FROM findings")]
        membership: dict[str, list[str]] = {finding_id: [] for finding_id in recorded}
        states: dict[str, str] = {}
        for lens, _page, lens_states in FINDING_LENS_PAGES:
            placeholders = ",".join("?" for _ in lens_states)
            for r in rows(
                conn,
                "SELECT finding_id, resolution_state FROM finding_state_current"
                f" WHERE resolution_state IN ({placeholders})",
                list(lens_states),
            ):
                finding_id = str(r["finding_id"])
                membership.setdefault(finding_id, []).append(lens)
                states[finding_id] = str(r["resolution_state"])
        view_total = (
            row(conn, "SELECT COUNT(*) AS n FROM finding_state_current") or {"n": 0}
        )["n"]
        if int(view_total or 0) != len(recorded):
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "finding-partition",
                    "object_id": "finding_state_current",
                    "detail": (
                        f"the partition view returns {view_total} rows for {len(recorded)}"
                        " findings rows"
                    ),
                }
            )
        for finding_id in sorted(membership):
            lenses = membership[finding_id]
            if len(lenses) != 1:
                named = ", ".join(lenses) or "no lens"
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "finding-partition",
                        "object_id": finding_id,
                        "detail": (
                            f"the finding lands in {named} ({len(lenses)} lens membership"
                            " queries), not in exactly one"
                        ),
                    }
                )
                continue
            expected = finding_page(states.get(finding_id))
            if expected is None:
                continue
            marker = finding_marker(finding_id)
            page = str(Path(expected).with_suffix(".html"))
            count = projection.get(page, "").count(marker)
            if count != 1:
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "finding-partition",
                        "object_id": finding_id,
                        "detail": (
                            f"{states.get(finding_id)} selects {page}, which carries the"
                            f" state marker {count} times"
                        ),
                    }
                )
        return mismatches

    def _ledger_stale_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """Every obligation-bearing stale ledger row, recorded once (§11.3).

        This replaced an `entries`-derived marker check, retired on 2026-11-19
        (finding B04-3): no code path writes `entries`, so that check's
        denominator was always zero (finding B03-2, recorded in `schema.sql`).
        `file_ledger` is populated by construction — a subsystem cannot leave
        scoping without rows in it — so this axis has a denominator, and
        deleting one record turns it red (VP4).

        Three properties, each able to turn the state axis red on its own:

        * every obligation-bearing classification is claimed by exactly one
          section of `stale.html` — a new classification with no section is a
          partition hole, not a rendering detail;
        * each obligation-bearing stale row carries exactly one marker in the
          HTML corpus, on the page §6.2 selects;
        * a row exempt from the survey obligation carries none.  Recording one
          would report drift in generated or vendored territory as survey
          staleness, which is the reading §11.2 keeps separate.
        """

        mismatches: list[dict[str, str]] = []
        if not table_exists(conn, "file_ledger"):
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "ledger-stale",
                    "object_id": "file_ledger",
                    "detail": "the file ledger is absent from the store",
                }
            )
            return mismatches

        claimed: dict[str, list[str]] = {}
        for heading, classifications in LEDGER_STALE_SECTIONS:
            for classification in classifications:
                claimed.setdefault(classification, []).append(heading)
        for classification in OBLIGATION_BEARING_CLASSIFICATIONS:
            sections = claimed.get(classification, [])
            if len(sections) != 1:
                named = ", ".join(sections) or "no section"
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "ledger-stale-partition",
                        "object_id": classification,
                        "detail": (
                            f"the classification is claimed by {named}"
                            f" ({len(sections)} sections), not by exactly one"
                        ),
                    }
                )
        for classification in claimed:
            if classification not in OBLIGATION_BEARING_CLASSIFICATIONS:
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "ledger-stale-partition",
                        "object_id": classification,
                        "detail": (
                            "a section claims a classification that carries no survey"
                            " obligation"
                        ),
                    }
                )

        corpus = "\n".join(
            body for rel, body in projection.items() if Path(rel).suffix in HTML_SUFFIXES
        )
        for ledger_row in rows(
            conn,
            "SELECT subsystem_id, file_path,"
            " COALESCE(classification,'candidate') AS classification"
            f" FROM file_ledger WHERE stale=1 AND {OBLIGATION_BEARING_SQL}"
            " ORDER BY subsystem_id, file_path",
        ):
            subsystem_id = str(ledger_row["subsystem_id"])
            file_path = str(ledger_row["file_path"])
            marker = ledger_stale_marker(subsystem_id, file_path)
            page = str(Path(LEDGER_STALE_PAGE).with_suffix(".html"))
            page_count = projection.get(page, "").count(marker)
            corpus_count = corpus.count(marker)
            if page_count != 1 or corpus_count != 1:
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "ledger-stale-html",
                        "object_id": f"{subsystem_id}:{file_path}",
                        "detail": (
                            f"expected exactly one html record on {page};"
                            f" found {page_count} there and {corpus_count} in the"
                            " html corpus"
                        ),
                    }
                )
        for ledger_row in rows(
            conn,
            "SELECT subsystem_id, file_path FROM file_ledger"
            f" WHERE stale=1 AND NOT ({OBLIGATION_BEARING_SQL})"
            " ORDER BY subsystem_id, file_path",
        ):
            subsystem_id = str(ledger_row["subsystem_id"])
            file_path = str(ledger_row["file_path"])
            marker = ledger_stale_marker(subsystem_id, file_path)
            count = corpus.count(marker)
            if count:
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "ledger-stale-exempt-html",
                        "object_id": f"{subsystem_id}:{file_path}",
                        "detail": (
                            "a row exempt from the survey obligation carries"
                            f" {count} html stale record(s)"
                        ),
                    }
                )
        return mismatches

    def _locus_index_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """The generated locus index, read back against what it indexes (§8.2).

        The content axis proves the file's bytes match the receipt and the
        coverage axis proves it is present; neither can tell a correct index
        from an empty one that was hashed honestly. This axis reads the two
        durable tables the index is derived from:

        * every obligation-bearing `file_ledger.file_path` appears in `paths`
          exactly once — a path indexed twice gives a reader two results for
          one file and hides which is current, and a path missing is a file
          ⌘K cannot reach;
        * every `evidence` row with a non-null `symbol` appears in `symbols` at
          least once. At least, not exactly: one symbol can carry evidence in
          several files, and each of those is a separate place to land.

        A row exempt from the survey obligation may be indexed — the Files
        index lists it — but nothing here requires it, so the denominator is
        the obligation, not the ledger's whole extent.
        """

        mismatches: list[dict[str, str]] = []
        text = projection.get(SEARCH_INDEX_NAME)
        if text is None:
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "locus-index",
                    "object_id": SEARCH_INDEX_NAME,
                    "detail": "the generated locus index is absent from the projection",
                }
            )
            return mismatches
        found = SEARCH_INDEX_ASSIGNMENT.search(text)
        if not found:
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "locus-index",
                    "object_id": SEARCH_INDEX_NAME,
                    "detail": "the index carries no window.__amanuensisLocusIndex assignment",
                }
            )
            return mismatches
        try:
            index = json.loads(found.group(1))
        except json.JSONDecodeError as exc:
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "locus-index",
                    "object_id": SEARCH_INDEX_NAME,
                    "detail": f"the index payload is unreadable: {exc}",
                }
            )
            return mismatches

        indexed = Counter(
            str(entry.get("p"))
            for entry in index.get("paths") or []
            if isinstance(entry, dict)
        )
        if not table_exists(conn, "file_ledger"):
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "locus-index",
                    "object_id": "file_ledger",
                    "detail": "the file ledger is absent from the store",
                }
            )
            return mismatches
        for ledger_row in rows(
            conn,
            "SELECT DISTINCT file_path FROM file_ledger"
            f" WHERE {OBLIGATION_BEARING_SQL} ORDER BY file_path",
        ):
            file_path = str(ledger_row["file_path"])
            count = indexed.get(file_path, 0)
            if count != 1:
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "locus-index-path",
                        "object_id": file_path,
                        "detail": (
                            "the obligation-bearing ledger path is indexed"
                            f" {count} time(s), not exactly once"
                        ),
                    }
                )

        symbols = {
            (str(entry.get("y")), str(entry.get("p")))
            for entry in index.get("symbols") or []
            if isinstance(entry, dict)
        }
        if table_exists(conn, "evidence"):
            for cited in rows(
                conn,
                "SELECT DISTINCT symbol, file_path FROM evidence"
                " WHERE symbol IS NOT NULL AND TRIM(symbol) <> ''"
                " ORDER BY symbol, file_path",
            ):
                pair = (str(cited["symbol"]), str(cited["file_path"]))
                if pair not in symbols:
                    mismatches.append(
                        {
                            "axis": "state",
                            "object_type": "locus-index-symbol",
                            "object_id": f"{pair[0]} in {pair[1]}",
                            "detail": "the cited symbol is absent from the index",
                        }
                    )
        return mismatches

    def _carried_record_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """Every carried obligation, recorded once, on the lens its outcome selects.

        A carried record is an obligation this store inherited and has either
        decided or not.  The census is the finding partition's shape applied to
        the second population `readback.py` had never seen (§5.6, C39):

        * every `carried_finding_outcome` value, and the word `undecided`, is
          claimed by exactly one lens — an outcome with no lens is a partition
          hole, not a rendering detail;
        * each carried record carries exactly one marker in the HTML corpus, on
          the page its outcome selects.

        A store that carried nothing has no denominator here and reports
        nothing, which is the honest reading: `carry_runs` is where "nobody ran
        a carry" is told apart from "a carry found nothing" (§5.2).
        """

        mismatches: list[dict[str, str]] = []
        claimed: dict[str, list[str]] = {}
        for lens, _page, outcomes in CARRIED_LENS_PAGES:
            for outcome in outcomes:
                claimed.setdefault(outcome, []).append(lens)
        for outcome in (*values_of("carried_finding_outcome"), CARRIED_UNDECIDED):
            lenses = claimed.get(outcome, [])
            if len(lenses) != 1:
                named = ", ".join(lenses) or "no lens"
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "carried-partition-vocabulary",
                        "object_id": outcome,
                        "detail": (
                            f"the carried outcome is claimed by {named}"
                            f" ({len(lenses)} lenses), not by exactly one"
                        ),
                    }
                )
        for outcome in claimed:
            if outcome != CARRIED_UNDECIDED and outcome not in values_of(
                "carried_finding_outcome"
            ):
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "carried-partition-vocabulary",
                        "object_id": outcome,
                        "detail": "a lens claims an outcome the vocabulary does not carry",
                    }
                )

        records = carried_records(conn)
        if not records:
            return mismatches
        corpus = "\n".join(
            body for rel, body in projection.items() if Path(rel).suffix in HTML_SUFFIXES
        )
        for record in records:
            store_id = str(record["archived_store_id"])
            archived_id = str(record["archived_finding_id"])
            marker = carried_marker(store_id, archived_id)
            expected = carried_page(str(record["outcome"]))
            if expected is None:
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "carried-record",
                        "object_id": f"{store_id}:{archived_id}",
                        "detail": (
                            f"the recorded outcome {record['outcome']!r} selects no lens"
                        ),
                    }
                )
                continue
            page = str(Path(expected).with_suffix(".html"))
            page_count = projection.get(page, "").count(marker)
            corpus_count = corpus.count(marker)
            if page_count != 1 or corpus_count != 1:
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "carried-record-html",
                        "object_id": f"{store_id}:{archived_id}",
                        "detail": (
                            f"outcome {record['outcome']} selects {page}, which carries"
                            f" the html record {page_count} time(s); the html"
                            f" corpus carries it {corpus_count} time(s)"
                        ),
                    }
                )
        return mismatches

    def _explanation_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """Every effective explanation is on the HTML page that owes it (§3.6).

        The effective row comes from `effective_explanations`, the function the
        renderer reads, and the body or declination reason is searched for on the
        subsystem's own page. A text the orientation lint refuses is not printed
        by design, so the page owes the refusal sentence in its place. The project
        account is owed by the architecture page. HTML is the only view
        (store-only PLAN §3.2 step 3), so it is the one checked.
        """

        mismatches: list[dict[str, str]] = []
        names, named, concerns = _resolver_names(conn)
        readings = effective_explanations(conn, self.storage)
        for (subject_type, subject_id, slot), reading in sorted(readings.items()):
            if reading.state not in {"recorded", "declined"} or reading.row is None:
                continue
            body = str(reading.row["body"])
            owed = explanation_refusal(slot) if orientation_violations(body) else body
            if subject_type == "subsystem":
                page = subsystem_page(subject_id, names.get(subject_id, subject_id))
            elif slot == "purpose":
                # The project's purpose is the overview's thesis (store-only PLAN
                # §3.3), with its imported label when it was imported (D2).
                page = "index.html"
                owed = (project_purpose_text(reading) or (owed, ()))[0]
            else:
                # The project account is owed by the architecture page (§3.7).
                page = "architecture.html"
            html_page = str(Path(page).with_suffix(".html"))
            absent = _missing_html_line(
                owed, _html_words(projection.get(html_page, "")), named, concerns
            )
            if absent is not None:
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "explanation-html",
                        "object_id": f"{subject_id}:{slot}",
                        "detail": (
                            f"the effective {reading.state} {slot} (row {reading.row['id']}) is not on"
                            f" {html_page}: {absent.strip()[:80]!r}"
                        ),
                    }
                )
        return mismatches

    def _record_page_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """Each narrative, territory disposition and runtime boundary is on its HTML page.

        The rows in force come from the functions the renderer reads
        (`effective_narratives`, `effective_territory_dispositions`,
        `runtime_boundary_rows`), so the page and its check cannot name different
        rows. A narrative is owed its topic and its body (or the refusal sentence
        in its place), a territory its whole row (its id and name, its
        disposition and its condition), a runtime boundary its runtimes, mechanism and notes. The
        HTML view, the only one, is checked, and a page's hash is not what is
        trusted here: a page edited with its receipt rewritten still fails.
        """

        from .diagrams import imported_runtime_line, runtime_boundary_rows  # noqa: PLC0415

        mismatches: list[dict[str, str]] = []
        names, named, concerns = _resolver_names(conn)

        def absent(kind: str, identifier: str, page: str, owed: list[str], label: str) -> None:
            """Report the HTML twin of `page` if it lacks any of the `owed` text."""

            html_page = str(Path(page).with_suffix(".html"))
            html_words = _html_words(projection.get(html_page, ""))
            for text in owed:
                lost = _missing_html_line(text, html_words, named, concerns)
                if lost is not None:
                    mismatches.append(
                        {
                            "axis": "state",
                            "object_type": f"{kind}-html",
                            "object_id": identifier,
                            "detail": f"{label} is not on {html_page}: {lost.strip()[:80]!r}",
                        }
                    )
                    break

        for record in effective_narratives(conn, self.storage):
            page = narrative_page(record, names)
            if page is None:
                continue
            text, _is_body = narrative_text(record)
            owed = [text]
            topic = str(record["topic"]).strip()
            if topic:
                owed.insert(0, topic)
            absent(
                "narrative",
                f"{record['subject_id']}:{record['section']}:{topic}",
                page,
                owed,
                f"the {record['disposition']} {record['section']} narrative (row {record['id']})",
            )
        for territory in effective_territory_dispositions(conn):
            # The whole row, so the verdict is owed beside its territory and a
            # ruled-out territory printed as applying is a mismatch (F11/codex).
            owed = [territory_row(territory)]
            absent(
                "territory",
                str(territory["territory"]),
                CHECKLIST_PAGE,
                owed,
                f"the {territory['disposition']} territory (row {territory['id']})",
            )
        edges = runtime_boundary_rows(conn)
        label = imported_runtime_line(edges)
        for edge in edges:
            # As the table cells print them: a pipe is escaped, not replaced.
            owed = [escaped_cell(edge[key]) for key in ("from_runtime", "to_runtime", "mechanism")]
            if edge["notes"]:
                owed.append(escaped_cell(edge["notes"]))
            if str(edge["origin"]) == "imported" and label:
                owed.append(label)
            absent(
                "runtime-boundary",
                f"{edge['from_runtime']}>{edge['to_runtime']}:{edge['mechanism']}",
                ARCHITECTURE_PAGE,
                owed,
                f"the runtime boundary (row {edge['id']})",
            )
        return mismatches

    def _record_mark_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """Each rendered record against the store, by its mark (store-only PLAN §3.5).

        The records owed come from the store: a finding on the page its state
        selects, a subsystem in the map's atlas and record list (and in the
        architecture page's atlas when no dependency is recorded), a seam on the
        seam page, each narrative in force and each imported survey body on its
        page. Three checks, one per axis:

        * coverage: each owed record is printed exactly as often as its page
          prints it, on no other page, and no mark names a record the store does
          not hold;
        * state: the state a record is marked with is the store's, and a status
          chip it prints for that state shows the store's value and label;
        * content: a prose body's words are the stored body's, rendered again
          from the store, with only the names the cross-reference pass adds.

        A mark is printed by the writer; nothing here trusts it beyond what it
        names, and a page edited with its receipt rewritten still fails.
        """

        from .diagrams import runtime_boundary_rows, runtime_edge_record  # noqa: PLC0415
        from .html_projection import (  # noqa: PLC0415 — it imports this module
            DISPLAY_STATUS,
            _HtmlWriter,
        )
        from .legacy_prose import (  # noqa: PLC0415
            IMPORTED_PAGES,
            body_blocks,
            imported_bodies,
            imported_page_blocks,
        )
        from .page import Marked, Page  # noqa: PLC0415
        from .renderers import (  # noqa: PLC0415
            AS_WRITTEN_HEADING,
            explanation_body,
            narrative_body,
            project_thesis,
            record_page_imports_only,
            subsystem_claims,
            thesis_blocks,
        )

        names, named, concerns = _resolver_names(conn)
        owed: dict[str, tuple[dict[str, int], str | None, Any]] = {}
        # An import-only page prints its bodies as one document, so a body may print
        # as more than one run of marked elements: each page's runs, by record, as the
        # page's own blocks print them.
        import_only_runs: dict[str, dict[str, list[str]]] = {}

        if table_exists(conn, "finding_state_current"):
            for r in rows(conn, "SELECT finding_id, resolution_state FROM finding_state_current"):
                page = finding_page(r["resolution_state"])
                if page is not None:
                    owed[f"finding:{r['finding_id']}"] = ({page: 1}, str(r["resolution_state"]), None)
        atlas_on_architecture = not (
            table_exists(conn, "xrefs") and rows(conn, "SELECT 1 FROM xrefs LIMIT 1")
        )
        for r in rows(conn, "SELECT id, status FROM subsystems ORDER BY id"):
            # The master plan's atlas item and record, and the subsystem page's status line.
            pages = {MASTER_PLAN_PAGE: 2, subsystem_page(str(r["id"]), names[str(r["id"])]): 1}
            if atlas_on_architecture:
                pages[ARCHITECTURE_PAGE] = 1
            owed[f"subsystem:{r['id']}"] = (pages, str(r["status"]), None)
        if table_exists(conn, "seams"):
            for r in rows(conn, "SELECT id FROM seams ORDER BY id"):
                owed[f"seam:{r['id']}"] = ({SEAM_PAGE: 1}, None, None)
        for edge in runtime_boundary_rows(conn):
            owed[runtime_edge_record(edge)] = ({ARCHITECTURE_PAGE: 1}, None, None)
        for sid, name in names.items():
            page = subsystem_page(sid, name)
            for claim in subsystem_claims(conn, sid):
                pages = owed.get(f"claim:{claim['claim_id']}", ({}, None, None))[0]
                owed[f"claim:{claim['claim_id']}"] = ({**pages, page: 1}, None, None)
            for d in rows(
                conn,
                "SELECT d.concern_code, d.classification FROM dispositions d"
                " JOIN concerns c ON c.code = d.concern_code WHERE d.subsystem_id = ?",
                (sid,),
            ):
                owed[f"disposition:{sid}:{d['concern_code']}"] = ({page: 1}, str(d["classification"]), None)
        for territory in effective_territory_dispositions(conn):
            owed[f"territory:{territory['territory']}"] = ({CHECKLIST_PAGE: 1}, str(territory["disposition"]), None)
        for (subject_type, subject_id, slot), reading in sorted(effective_explanations(conn, self.storage).items()):
            if subject_type == "subsystem" and subject_id not in names:
                continue
            printed = explanation_body(subject_type, subject_id, slot, reading)
            if printed is None or reading.row is None:
                continue
            page = ARCHITECTURE_PAGE if subject_type == "project" else subsystem_page(subject_id, names[subject_id])
            owed[f"explanation:{reading.row['id']}"] = ({page: 1}, reading.state, (printed[0], page))
        # The project's purpose is the overview's thesis, printed there once.
        thesis = project_thesis(conn, self.storage)
        if thesis.record:
            marked = thesis_blocks(thesis)[0]
            owed[thesis.record] = ({OVERVIEW_PAGE_HTML: 1}, thesis.record_state, (marked, OVERVIEW_PAGE_HTML))
        for record in effective_narratives(conn, self.storage):
            page = narrative_page(record, names)
            if page is not None:
                owed[f"narrative:{record['id']}"] = (
                    {page: 1},
                    str(record["disposition"]),
                    (narrative_body(record), page),
                )
        for body in imported_bodies(conn):
            if not body.body.strip():
                continue
            # Read lazily: a body is read again only if its page is compared.
            if body.kind == SURVEY_KIND and body.subsystem_id in names:
                page = subsystem_page(str(body.subsystem_id), names[str(body.subsystem_id)])
                owed[f"imported-body:{body.path}"] = (
                    {page: 1},
                    None,
                    (body.body, 3, ("Structure", "Survey record"), page),
                )
            elif (f"{body.kind}.html", body.kind) in IMPORTED_PAGES:
                # The other kinds are held, not printed (§5.4), and owed nowhere.
                page = f"{body.kind}.html"
                record = f"imported-body:{body.path}"
                if not record_page_imports_only(conn, self.storage, body.kind):
                    owed[record] = ({page: 1}, None, (body.body, 2, (AS_WRITTEN_HEADING,), page))
                    continue
                if page not in import_only_runs:
                    fragment = _HtmlWriter({}, page).write(
                        Page("", page, imported_page_blocks(conn, body.kind, page))
                    )
                    import_only_runs[page] = {}
                    for run in _record_occurrences(fragment)[0]:
                        import_only_runs[page].setdefault(run.record, []).append(run.text)
                runs = import_only_runs[page].get(record, [])
                owed[record] = ({page: len(runs)}, None, (_RUNS, runs))

        found: dict[str, dict[str, list[_Occurrence]]] = {}
        for rel, text in projection.items():
            if Path(rel).suffix not in HTML_SUFFIXES or "data-record=" not in text:
                continue
            for occurrence in _record_occurrences(text)[0]:
                found.setdefault(occurrence.record, {}).setdefault(rel, []).append(occurrence)

        # The status chip each stated record prints, by its family's class and enum.
        families = {
            "finding": ("resolution", set(values_of("finding_resolution_state"))),
            "subsystem": ("survey", set(values_of("subsystem_status"))),
            "disposition": ("disposition", set(values_of("disposition_classification"))),
        }
        mismatches: list[dict[str, str]] = []

        def report(axis: str, record: str, detail: str) -> None:
            kind, _, identifier = record.partition(":")
            mismatches.append(
                {"axis": axis, "object_type": kind, "object_id": identifier, "detail": detail}
            )

        for record in sorted(set(owed) | set(found)):
            printed = found.get(record, {})
            if record in owed:
                pages, state, prose = owed[record]
            else:
                report("coverage", record, "the mark names no record the store holds")
                continue
            for page, count in sorted(pages.items()):
                seen = len(printed.get(page, []))
                if seen != count:
                    report("coverage", record, f"{page} prints the record {seen} time(s), not {count}")
            for page in sorted(set(printed) - set(pages)):
                report("coverage", record, f"{page} prints the record, and the page plan does not put it there")
            expected_words = None
            expected_runs: list[str] | None = None
            if prose is not None and prose[0] is _RUNS:
                expected_runs = prose[1]
            elif prose is not None and printed:
                if isinstance(prose[0], Marked):
                    blocks, page = prose[0].blocks, prose[1]
                else:
                    text, under, sections, page = prose
                    blocks = body_blocks(text, under=under, sections=sections, path=page)
                expected_words = _fragment_tokens(_HtmlWriter({}, page).write(Page("", page, blocks)))
            kind = record.partition(":")[0]
            for page, occurrences in sorted(printed.items()):
                for index, occurrence in enumerate(occurrences):
                    if expected_runs is not None:
                        expected_words = expected_runs[index] if index < len(expected_runs) else None
                    if state is not None and occurrence.states != {state}:
                        marked = ", ".join(sorted(str(s) for s in occurrence.states))
                        report("state", record, f"{page} marks it {marked}; the store holds {state}")
                    if state is not None and kind in families:
                        # Every occurrence prints its state as a chip of its family, and
                        # only the store's value: a missing chip or an unknown value is red.
                        family, values = families[kind]
                        wanted = DISPLAY_STATUS.get(state, state.replace("-", " ").title())
                        chips = [(c, label) for c, label in occurrence.chips if f"status-{family}" in c]
                        if not chips:
                            report("state", record, f"{page} prints no {family} status for it; the store holds {state} ({wanted!r})")
                        for classes, label in chips:
                            keys = {c.removeprefix("status-") for c in classes if c.startswith("status-")} - {family}
                            if keys != {state} or label != wanted:
                                unknown = "" if keys <= values else "; the schema holds no such value"
                                report(
                                    "state",
                                    record,
                                    f"{page} prints {label!r} as {', '.join(sorted(keys)) or 'no value'}{unknown};"
                                    f" the store holds {state} ({wanted!r})",
                                )
                    if state is not None and kind == "territory":
                        # Its disposition prints as the value itself, in its row's cell.
                        printed_as = [label for c, label in occurrence.chips if "cell-disposition" in c]
                        if printed_as != [state]:
                            report("state", record, f"{page} prints {printed_as or 'no disposition'}; the store holds {state}")
                    if expected_words is not None:
                        pattern = _resolver_pattern(f" {expected_words} ", named, concerns, tokens=True)
                        if not pattern.fullmatch(f" {occurrence.text} "):
                            report(
                                "content",
                                record,
                                f"{page} prints {occurrence.text[:80]!r}; the store's body reads"
                                f" {expected_words[:80]!r}",
                            )
        return mismatches

    def _drawn_element_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """The architecture page's two SVGs, element by element, against the store (§3.5).

        The drawn nodes and edges are read from the SVG elements themselves (every
        line and arrow is an edge, every runtime box and subsystem box a node) and
        compared, as counts, with the diagram's model recomputed from the rows: a
        line no record joins, a record drawn twice and a missing box each turn the
        content axis red.
        """

        from .diagrams import (  # noqa: PLC0415 — it imports this module
            boundary_edge_record,
            boundary_relations,
            runtime_boundary_rows,
            runtime_edge_record,
            runtime_node,
        )

        text = projection.get(ARCHITECTURE_PAGE)
        if text is None:
            return []  # coverage owns the missing page
        drawn = _record_occurrences(text)[1]
        expected: dict[str, Counter[tuple[str, str, str]]] = {"runtime": Counter(), "boundary": Counter()}
        for edge in runtime_boundary_rows(conn):
            record = runtime_edge_record(edge)
            expected["runtime"].update(
                [
                    ("edge", "line", record),
                    ("edge", "path", record),
                    ("node", "rect", f"runtime:{runtime_node(edge['from_runtime'])}"),
                    ("node", "rect", f"runtime:{runtime_node(edge['to_runtime'])}"),
                ]
            )
        graph = boundary_relations(conn)
        if graph["edges"]:
            expected["boundary"].update(("node", "g", f"subsystem:{node['id']}") for node in graph["nodes"])
            seams: set[str] = set()
            for edge in graph["edges"]:
                record = boundary_edge_record(edge)
                if edge["kind"] == "seam":
                    if edge["label"] not in seams:
                        seams.add(edge["label"])
                        expected["boundary"].update([("edge", "line", record)])
                else:
                    expected["boundary"].update([("edge", "line", record), ("edge", "path", record)])
        mismatches: list[dict[str, str]] = []
        for diagram, wanted in expected.items():
            got = Counter(drawn.get(diagram, []))
            for element, tag, record in sorted(set(wanted) | set(got)):
                if got[(element, tag, record)] == wanted[(element, tag, record)]:
                    continue
                named_as = record or f"(an unmarked <{tag}>)"
                mismatches.append(
                    {
                        "axis": "content",
                        "object_type": f"{diagram}-diagram-{element}",
                        "object_id": record,
                        "detail": (
                            f"the {diagram} SVG draws {named_as} as <{tag}> {got[(element, tag, record)]}"
                            f" time(s); the store's rows draw it {wanted[(element, tag, record)]}"
                        ),
                    }
                )
        return mismatches

    def _badge_census(self, conn: Any, projection: dict[str, str]) -> list[dict[str, str]]:
        """The finding badges (A4), badge by badge, against the Hot spots measures they are read from.

        The atlas and the boundary diagram each print a badge per measure above zero for a
        subsystem at `concerns` or above, and nothing else. A badge the store does not hold, one
        missing, one whose mark disagrees with its printed words, or one whose count is not
        the store's is a content mismatch.
        """

        from .diagrams import finding_badges  # noqa: PLC0415 — it imports this module

        wanted = {
            (sid, b.measure): (b.count, b.review) for sid, found in finding_badges(conn).items() for b in found
        }
        mismatches: list[dict[str, str]] = []
        for rel, text in sorted(projection.items()):
            if Path(rel).suffix not in HTML_SUFFIXES:
                continue
            surfaces = {
                "atlas": 'class="subsystem-atlas"' in text,
                "boundary": 'class="boundary-svg-node"' in text,
            }
            found: dict[str, Counter[tuple[str, str, int, bool, bool]]] = {"atlas": Counter(), "boundary": Counter()}
            for m in re.finditer(r'<(span|g)\b([^>]*\bdata-finding-badge="[^"]*"[^>]*)>(.*?)</\1>', text, re.S):
                attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(2)))
                surface = "atlas" if m.group(1) == "span" else "boundary"
                count = int(attrs.get("data-count") or -1)
                printed = count in {int(n) for n in re.findall(r"\d+", re.sub(r"<[^>]+>", " ", m.group(3)))}
                found[surface][(attrs.get("data-subsystem", ""), attrs["data-finding-badge"], count, attrs.get("data-under-review") == "yes", printed)] += 1
            for surface, drawn in surfaces.items():
                if not drawn and not found[surface]:
                    continue
                want = Counter({(sid, measure, n, review, True): 1 for (sid, measure), (n, review) in wanted.items()}) if drawn else Counter()
                for key in sorted(set(want) | set(found[surface])):
                    if want[key] == found[surface][key]:
                        continue
                    sid, measure, count, review, printed = key
                    mismatches.append(
                        {
                            "axis": "content",
                            "object_type": "finding-badge",
                            "object_id": f"{surface}:{sid}:{measure}",
                            "detail": (
                                f"{rel} prints the {surface} badge {measure} on {sid} {found[surface][key]} time(s) with count {count}"
                                f"{', under review' if review else ''}{'' if printed else ' (its words say another count)'};"
                                f" the store's rows draw it {want[key]} time(s)"
                            ),
                        }
                    )
        return mismatches

    def _figure_census(self, conn: Any, projection: dict[str, str]) -> list[dict[str, str]]:
        """The survey workflow and the status ladders, figure by figure, against their models (§3.5, §7.3).

        Each model is recomputed from the contract and the store. The figures a page
        carries must be the ones the models say it should (a missing or extra one is a
        coverage mismatch), and the nodes and edges their SVGs draw, read from the
        elements, must be the models' records (a content mismatch).
        """

        from .diagrams import (  # noqa: PLC0415 — it imports this module
            coverage_bars_model,
            flow_keys,
            flow_strip_model,
            seam_contract_model,
            status_ladder_model,
            survey_workflow_model,
        )

        models: dict[str, list[tuple[tuple[str, str], Any]]] = {}
        if "how-to-read.html" in projection:
            models["how-to-read.html"] = [(("survey-workflow", ""), survey_workflow_model()), (("status-ladder", ""), status_ladder_model())]
        if "files.html" in projection:
            models["files.html"] = [(("coverage-bars", ""), coverage_bars_model(conn))]
        if "seams.html" in projection:
            models["seams.html"] = [
                (("seam-contract", str(seam["id"])), seam_contract_model(conn, str(seam["id"])))
                for seam in rows(conn, "SELECT id FROM seams ORDER BY id")
            ]
        for sub in rows(conn, "SELECT id, name FROM subsystems ORDER BY id"):
            page = subsystem_page(str(sub["id"]), str(sub["name"]))
            if page in projection:
                models[page] = [
                    (("status-ladder", str(sub["id"])), status_ladder_model(conn, str(sub["id"]))),
                    (("coverage-bars", str(sub["id"])), coverage_bars_model(conn, str(sub["id"]))),
                    *((("flow-strip", key), flow_strip_model(conn, key)) for key in flow_keys(conn, str(sub["id"]))),
                ]
        mismatches: list[dict[str, str]] = []
        for rel, text in sorted(projection.items()):
            if Path(rel).suffix not in HTML_SUFFIXES or (rel not in models and 'data-diagram="' not in text):
                continue
            wanted_figures = Counter(key for key, model in models.get(rel, []) if model.nodes)
            found_figures = Counter(
                (kind, re.search(r'data-subject="([^"]*)"', attrs).group(1) if 'data-subject="' in attrs else "")  # type: ignore[union-attr]
                for kind, attrs in re.findall(r'<figure\b[^>]*?data-diagram="([^"]*)"([^>]*)>', text)
            )
            for key in sorted(set(wanted_figures) | set(found_figures)):
                if wanted_figures[key] != found_figures[key]:
                    mismatches.append(
                        {
                            "axis": "coverage",
                            "object_type": f"{key[0]}-diagram",
                            "object_id": key[1] or rel,
                            "detail": f"{rel} carries {found_figures[key]} {key[0]} figure(s) for {key[1] or 'the page'}; the store's rows draw {wanted_figures[key]}",
                        }
                    )
            drawn = _record_occurrences(text)[1]
            for (kind, subject), model in models.get(rel, []):
                if not model.nodes:
                    continue
                wanted: Counter[tuple[str, str, str]] = Counter(
                    [*(("node", "g", n.record) for n in model.nodes), *(("edge", "path", e.record) for e in model.edges)]
                )
                got = Counter(drawn.get(f"figure:{kind}:{subject}", []))
                for element, tag, record in sorted(set(wanted) | set(got)):
                    if got[(element, tag, record)] == wanted[(element, tag, record)]:
                        continue
                    named_as = record or f"(an unmarked <{tag}>)"
                    mismatches.append(
                        {
                            "axis": "content",
                            "object_type": f"{kind}-diagram-{element}",
                            "object_id": record or subject,
                            "detail": (
                                f"the {kind} SVG{' of ' + subject if subject else ''} draws {named_as} as <{tag}>"
                                f" {got[(element, tag, record)]} time(s); the store's rows draw it {wanted[(element, tag, record)]}"
                            ),
                        }
                    )
        return mismatches

    def _coverage_measurement_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """Each published coverage row, against the store's own standing (§3.4).

        The coverage axis already asks whether a planned page and a recorded
        link are present.  This asks the same question of a *reading*: a
        `not measured` row is present and honest, and is never a satisfied
        coverage claim.  Both directions turn it red, because both are silent
        failures:

        * an **unreconciled** store whose overview publishes a number has
          published a fraction of a set nobody inventoried (§1.4);
        * a **reconciled** store whose overview withholds the reading it has,
          or publishes one the record contradicts, is no more honest — the
          numbers are checked against the standing reconciliation here, read
          from the database, not from the page that printed them.

        No other axis is touched: the state axis still owns markers and the
        content axis still owns bytes.
        """

        mismatches: list[dict[str, str]] = []
        standing = reconciliation_standing(conn, self.storage)
        # The exact cell the record implies, not a fragment of it. `of 5` is a
        # substring of `999 of 5`, so a numerator nobody recomputed used to read
        # back green (F7/codex); the renderer's own two out-of-band sentences
        # are spelled out here rather than matched loosely.
        obligation = standing.obligation_paths
        files_read: str | None
        if obligation is None:
            files_read = None
        elif obligation:
            files_read = f"{examined_tracked(conn)} of {obligation}"
        else:
            files_read = NO_OBLIGATION_SENTENCE
        expected: dict[str, str | None] = {
            COVERAGE_ROW_UNLEDGERED: (
                None if standing.unledgered is None else str(standing.unledgered)
            ),
            COVERAGE_ROW_FILES_READ: files_read,
        }
        for rel in (OVERVIEW_PAGE_HTML,):
            text = projection.get(rel)
            if text is None:
                continue  # coverage already owns the missing-page diagnostic
            for label, wanted in expected.items():
                cell = _metric_cell(text, label)
                if cell is None:
                    mismatches.append(
                        {
                            "axis": "coverage",
                            "object_type": "coverage-measurement",
                            "object_id": f"{rel}:{label}",
                            "detail": "the overview publishes no such row",
                        }
                    )
                    continue
                if UNMEASURED in cell:
                    if standing.stands:
                        mismatches.append(
                            {
                                "axis": "coverage",
                                "object_type": "coverage-measurement",
                                "object_id": f"{rel}:{label}",
                                "detail": (
                                    f"the store is reconciled at {standing.sha[:12]} and the"
                                    " row withholds the reading the record carries"
                                ),
                            }
                        )
                    continue
                if not standing.stands:
                    mismatches.append(
                        {
                            "axis": "coverage",
                            "object_type": "coverage-measurement",
                            "object_id": f"{rel}:{label}",
                            "detail": (
                                "the store is unreconciled and the row publishes a reading"
                                f" anyway: {cell!r} ({standing.why})"
                            ),
                        }
                    )
                    continue
                if wanted is not None and cell.strip() != wanted:
                    mismatches.append(
                        {
                            "axis": "coverage",
                            "object_type": "coverage-measurement",
                            "object_id": f"{rel}:{label}",
                            "detail": (
                                f"the row reads {cell!r}; the standing reconciliation at"
                                f" {standing.sha[:12]} says {wanted!r}"
                            ),
                        }
                    )
        return mismatches

    @staticmethod
    def _summary(mismatches: list[dict[str, str]]) -> dict[str, Any]:
        axes = {
            axis: {"ok": not any(m["axis"] == axis for m in mismatches)}
            for axis in ("state", "coverage", "content")
        }
        return {
            "ok": all(result["ok"] for result in axes.values()),
            "axes": axes,
            "mismatch_count": len(mismatches),
            "mismatches": mismatches,
        }
