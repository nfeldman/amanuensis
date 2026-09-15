"""Page renderers — each function returns (markdown_text, sources_dict).

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
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha1, sha256
from pathlib import Path
from typing import Any

from .db import row, rows, table_exists
from .diagrams import (
    concern_coverage_heatmap,
    runtime_boundary_map,
    seam_graph,
    staleness_map,
    subsystem_dependency_view,
)
from .lint import composite_index_violations, orientation_violations
from .manifest import sha256_bytes, sha256_json
from .readback import (
    CARRIED_HEADING,
    CARRIED_UNDECIDED,
    COVERAGE_ROW_CARRIED,
    COVERAGE_ROW_FILES_READ,
    COVERAGE_ROW_UNLEDGERED,
    FINDING_LENS_PAGES,
    LEDGER_STALE_SECTIONS,
    UNMEASURED,
    WHY_NO_REVISION,
    WHY_NO_TREE,
    WHY_NONE_AT_ALL,
    WHY_NONE_RECORDED,
    ReconciliationStanding,
    anchor_opens,
    carried_anchor,
    carried_marker,
    carried_page,
    carried_records,
    carry_was_run,
    finding_marker,
    finding_page,
    ledger_stale_anchor,
    ledger_stale_marker,
    reconciliation_standing,
    resolve_workspace,
    stale_marker,
)
from .slugs import matrix_page, matrix_slug, subsystem_page
from .vocabulary import (
    OBLIGATION_BEARING_SQL,
    OPEN_FINDING_SQL,
    VOCABULARY,
    VOCABULARY_CONTRACT_VERSION,
    cannot_justify,
    labels,
    meanings,
    values_of,
)

RenderResult = tuple[str, dict[str, str]]

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

# §9.1's literal and §3.4's label, verbatim.  The subsystem page and
# `describe_locus` say the same words for the same state, because a reader who
# meets both must not have to work out whether they mean the same thing.
NO_STRUCTURAL_CLAIMS = "Structural inventory not recorded as claims"
NARRATIVE_LABEL = "Narrative from the survey artifact; not individually bound to a revision"

# §9.1's five structural categories, as the `claim_key` segment that names each
# and the heading it groups under.  A claim reached through its subject or its
# evidence rather than through the subsystem's own namespace has no segment to
# read, so it groups last under its own heading rather than being dropped or
# filed under a category nothing recorded it as (BP6).
CLAIM_KIND_HEADINGS: tuple[tuple[str, str], ...] = (
    ("key-type", "Key types"),
    ("state-container", "State containers"),
    ("flow", "Flow steps"),
    ("concurrency", "Concurrency invariants"),
    ("seam", "Seam contracts"),
    ("other", "Other claims"),
)
_CLAIM_KINDS = frozenset(kind for kind, _ in CLAIM_KIND_HEADINGS if kind != "other")


def _like_prefix(sid: str) -> str:
    """`<sid>/%` with SQLite's LIKE wildcards escaped, for the namespace arm."""

    escaped = sid.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"{escaped}/%"


# CommonMark fences: three or more backticks or tildes, indented at most three
# spaces.  Tracking only the backtick form let a `~~~` block's contents through
# as prose, and a `#` inside one was demoted as if it were a document heading
# (slice-S3, F10/codex).
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")


def _nest_prose(text: str, under: int) -> str:
    """Shift a recorded document's ATX headings beneath a page heading.

    An artifact was written as a document of its own and opens at `#`.  Rendered
    verbatim inside a page section, its first heading would close the section it
    was placed in and the reader would be told the narrative sits somewhere it
    does not.  Only the heading *level* moves; the heading text, the order, and
    every other line are the recorded bytes.  Levels saturate at six rather than
    wrapping, so a deeply nested source flattens instead of re-opening the page.
    """

    out: list[str] = []
    fence: tuple[str, int] | None = None
    for line in text.split("\n"):
        opener = _FENCE.match(line)
        if fence is None:
            # CommonMark: a fence opens on three or more backticks or tildes.
            if opener:
                fence = (opener.group(1)[0], len(opener.group(1)))
        elif opener and opener.group(1)[0] == fence[0] and len(opener.group(1)) >= fence[1]:
            # …and closes only on the same character, at least as long. A
            # shorter run, or the other character, is content.
            fence = None
        if fence is None and not opener:
            match = re.match(r"^(#{1,6})(\s)", line)
            if match:
                level = min(6, len(match.group(1)) + under)
                line = "#" * level + line[len(match.group(1)) :]
        out.append(line)
    return "\n".join(out)


def _claim_kind(sid: str, claim_key: str) -> str:
    """The §9.1 category a `claim_key` names, or `other` when it names none."""

    prefix = f"{sid}/"
    if not claim_key.startswith(prefix):
        return "other"
    segment = claim_key[len(prefix) :].split("/", 1)[0]
    return segment if segment in _CLAIM_KINDS else "other"

THESIS_SOURCE = "entry-point.md"
THESIS_SECTION_PATTERN = re.compile(
    r"^#{1,6}\s*what is this (?:codebase|project)\??\s*$", re.IGNORECASE
)
THESIS_ABSENT = (
    "No thesis section is recorded; add a 'What is this codebase?' section to "
    "`entry-point.md`."
)
THESIS_REFUSED = (
    "The recorded thesis carries status vocabulary and was not published; "
    "correct `entry-point.md`."
)
THESIS_REFUSED_COMPOSITE = (
    "The recorded thesis presents a composite index of the record and was not "
    "published; correct `entry-point.md`."
)


@dataclass(frozen=True)
class Thesis:
    """What the overview's thesis slot holds, and why it holds it."""

    text: str
    recorded: bool
    violations: tuple[str, ...] = ()


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
    """The thesis taken by heading, from `entry-point.md` and nowhere else.

    The first paragraph is deliberately not a fallback: `entry-point.md` is a
    dated reading path recorded by an earlier session, and its opening paragraph
    carries no contract to describe the project. When the named section is
    absent the page says which section to add, which is a fact about the record
    rather than a sentence about the codebase that nobody wrote (§7.2).
    """

    path = storage / THESIS_SOURCE
    body = _thesis_body(path.read_text()) if path.is_file() else ""
    if not body:
        return Thesis(THESIS_ABSENT, recorded=False)
    violations = tuple(orientation_violations(body))
    if violations:
        return Thesis(THESIS_REFUSED, recorded=True, violations=violations)
    # C32 forbids a composite score in the overview, and the thesis is the one
    # slot on it a session writes by hand. Refusing it here is what keeps the
    # figure out of the published bytes; the whole-page lint below is what makes
    # the publish red whoever put it there (F5/codex, slice-S7).
    composite = tuple(composite_index_violations(body))
    if composite:
        return Thesis(THESIS_REFUSED_COMPOSITE, recorded=True, violations=composite)
    return Thesis(body, recorded=True)


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


def project_name(storage: Path) -> str:
    """The project's own name, which is the projection's primary identity.

    Amanuensis is the producing method and never the title
    (`reporting-style.md` § "Keep information architecture and interface design
    separate").

    Three sources, in the order of how deliberately each was chosen: the name
    onboarding recorded, the name the repository binding resolved, and the name
    the workspace's package manifest declares. A directory name is not among
    them at any position. A store surveyed from a second worktree, a scratch
    clone, or a temporary checkout answers with the same project name as the
    first, because none of those change the binding — and where the record
    genuinely names nothing, the page says so rather than presenting the
    checkout's folder as an identity.
    """

    report = storage / "onboarding-report.md"
    if report.is_file():
        for line in report.read_text().splitlines():
            if line.startswith("**Codebase**:"):
                recorded = line.partition(":")[2].strip().split(" — ", 1)[0].strip()
                if recorded:
                    return recorded
                break
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
        " FROM file_ledger",
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


def _metric_table(pairs: Sequence[tuple[str, str]]) -> list[str]:
    """Metric/value facts, which the HTML projection renders as a definition list."""

    out = ["| Metric | Value |", "|---|---|"]
    out.extend(f"| {metric} | {value} |" for metric, value in pairs)
    out.append("")
    return out


def _prose_source(storage: Path, rel: str) -> dict[str, str]:
    p = storage / rel
    if not p.is_file():
        return {}
    return {f"prose:{rel}": sha256_bytes(p.read_bytes())}


def _db_source(name: str, data: Any) -> dict[str, str]:
    return {f"db:{name}": sha256_json(data)}


# ---------------------------------------------------------------------------
# The honest empty state, and where a record that is not a finding lives
# ---------------------------------------------------------------------------

# §6.1 partitions contradictions by whether the evidence settled them, exactly
# as `finding_state_current` partitions findings. The page a contradiction's
# record renders on is read from that one predicate, so the record, the
# timeline that links to it, and the reader all agree about where it is.
DISAGREEMENTS_PAGE = "disagreements.md"
CONTRADICTIONS_PAGE = "contradictions.md"


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


def _empty_lens(
    conn: sqlite3.Connection, nothing: str, scope: str, basis: str
) -> list[str]:
    """What a lens page with no rows says instead of "none" (§6.1, C28).

    An empty page is the one place a reader cannot check the record against
    itself. *No open findings* alone is indistinguishable from a survey that
    never ran, from one whose store was never written to, and from one whose
    predicate is wrong. So the page states what it would have carried, which
    records it read, and the revision it read them at, and the absence becomes
    a reading rather than a silence.
    """

    return [
        nothing,
        "",
        f"- **Scope** — {scope}",
        f"- **Basis** — {basis}",
        f"- **Checked revision** — {checked_revision(conn)}.",
        "",
    ]


# ---------------------------------------------------------------------------
# Index / dashboard / architecture
# ---------------------------------------------------------------------------


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

    name = project_name(storage)
    thesis = read_thesis(storage)
    if thesis.violations and warn is not None:
        warn(
            f"{THESIS_SOURCE}: the recorded thesis was not published because it "
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
                " (SELECT file_path FROM scope_gaps WHERE kind='absent'))",
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

    stale_rows = rows(conn, "SELECT id, tier FROM entries WHERE stale=1 ORDER BY id, tier")
    latest_session = row(
        conn,
        "SELECT intent, started_at, ended_at FROM sessions ORDER BY started_at DESC LIMIT 1",
    )

    # 1. Identity.  The project is the subject; Amanuensis is the method that
    #    recorded it (`reporting-style.md`).
    out = [
        f"# {name}",
        "",
        f"An architecture survey of {name}, recorded by Amanuensis.",
        "",
        # 2. Thesis — by heading, from entry-point.md, or the named instruction.
        "## What is this codebase?",
        "",
        thesis.text,
        "",
        # 3. Four status dimensions, each a separate named fact.
        "## Where the record stands",
        "",
        "### Source alignment",
        "",
    ]
    out += _metric_table(
        [
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
    )
    out += ["### Survey coverage", ""]
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
    out += _metric_table(
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
        ]
    )
    out += ["### Open engineering work", ""]
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
    out += _metric_table(work)
    out += ["### Publication integrity", ""]
    if verification:
        out += _metric_table(
            [
                *(
                    (
                        f"{axis.title()} axis",
                        "green" if int(verification[f"{axis}_ok"] or 0) else "red",
                    )
                    for axis in ("state", "coverage", "content")
                ),
                ("Verified at", _fmt_time(str(verification["verified_at"]))),
            ]
        )
    else:
        out += [
            "No publication read-back is recorded for this store, so none of the"
            " three axes has a result to report.",
            "",
        ]

    # 4. One linked count per resolution state, generated from the enum source so
    #    the line cannot drift from the enum (§7.2 step 4, §10).
    out += ["## Findings by resolution state", ""]
    out += _metric_table(
        [
            (
                f"[{RESOLUTION_LABELS.get(state, state)}]({finding_page(state)})",
                str(state_counts.get(state, 0)),
            )
            for state in values_of("finding_resolution_state")
        ]
    )

    # 5. One route into each lens (§1.1, §7.1).
    out += [
        "## The four lenses",
        "",
        "- **Codebase** — [Subsystem map](master-plan.md): every region, grouped by"
        " layer, with the boundaries and terms recorded for it.",
        "- **Unresolved** — [Open findings](findings.md): defects open or awaiting"
        " verification at the checked revision.",
        "- **History** — [Resolved findings](resolved-findings.md): the records that"
        " reached a terminal state, with the basis each one rests on.",
        "- **Method** — [How to read the conspectus](how-to-read.md): every recorded"
        " state, what it authorizes, and what it cannot justify.",
        "",
    ]

    # Secondary apparatus.  The `entries`-derived stale markers stay here until
    # `stale.md` carries the ledger-derived ones (§11.3): read-back requires
    # exactly one marker per stale `entries` row in each format, and nothing
    # above may depend on them.
    if latest_session:
        out += [
            "## Latest session",
            "",
            f"`{latest_session['intent']}` — started {_fmt_time(latest_session['started_at'])}"
            + (
                f" · ended {_fmt_time(latest_session['ended_at'])}"
                if latest_session["ended_at"]
                else " · **active**"
            ),
            "",
        ]
    out += [stale_marker(str(e["id"]), int(e["tier"])) for e in stale_rows]

    text = "\n".join(out) + "\n"
    # Over the page as published, not over the thesis alone. C32's rule is about
    # what the overview carries, so a renderer that grows a composite row is the
    # same violation as a session that writes one into `entry-point.md`, and
    # only a lint over the rendered bytes sees both. Until slice-S7 this check
    # lived in the packet's gate, where it could report on a publish it could
    # not stop (F5/codex).
    if warn is not None:
        for message in composite_index_violations(text):
            warn(f"index.md: the overview may not publish a composite index — {message}")

    sources = {
        **_db_source("index:alignment", alignment),
        **_db_source("index:subs", subs),
        **_db_source("index:states", state_counts),
        **_db_source("index:reconciliation", standing.record or {"why": standing.why}),
        **_db_source("index:carried", carried),
        **_db_source("index:unresolved", unresolved),
        **_db_source("index:decisions", decisions),
        **_db_source("index:verification", verification or {}),
        **_db_source("index:stale-objects", stale_rows),
        **_db_source("index:session", latest_session or {}),
        **_db_source("index:identity", {"project_name": name}),
        **_prose_source(storage, THESIS_SOURCE),
    }
    return text, sources


def render_architecture(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    xrefs = rows(conn, "SELECT * FROM xrefs ORDER BY from_id")
    subs = rows(conn, "SELECT id, name, status FROM subsystems ORDER BY id")
    seams = rows(conn, "SELECT id, shared_object, party_a, party_b FROM seams ORDER BY id")
    # Heading and body come from one call. They were two reads of `xrefs` in two
    # modules, so a change to either predicate could head an atlas "Subsystem
    # dependency graph" — a page asserting edges no row records (§9.2). The
    # `xrefs` rows above stay for the manifest source hash only.
    dependency_heading, dependency_body = subsystem_dependency_view(conn)
    out = [
        "# Architecture",
        "",
        "## Runtime boundary map",
        "",
        runtime_boundary_map(storage),
        "",
        f"## {dependency_heading}",
        "",
        dependency_body,
        "",
        "## Seam topology",
        "",
        seam_graph(conn),
        "",
        "## Staleness map",
        "",
        staleness_map(conn),
    ]
    sources = {
        **_db_source("arch:xrefs", xrefs),
        **_db_source("arch:subs", subs),
        **_db_source("arch:seams", seams),
        **_prose_source(storage, "onboarding-report.md"),
    }
    return "\n".join(out) + "\n", sources


# ---------------------------------------------------------------------------
# Master plan & subsystems
# ---------------------------------------------------------------------------


def render_master_plan(conn: sqlite3.Connection, storage: Path) -> RenderResult:
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

    if not subs:
        body = ["_No subsystems registered yet. Run the Amanuensis coordinator to onboard._"]
    else:
        # Group by layer.
        layers: dict[str, list[dict[str, Any]]] = {}
        for s in subs:
            layers.setdefault(s["layer"] or "unlayered", []).append(s)
        body = []
        for layer, items in layers.items():
            body.append(f"## {layer}")
            body.append("")
            body.append("| Priority | ID | Name | Status | Scope | Jump-in | Findings |")
            body.append("|---|---|---|---|---|---|---|")
            for s in items:
                f = finds_by_ss.get(s["id"], {"n": 0, "open_bugs": 0})
                priority = "—" if s.get("priority") is None else str(s["priority"])
                body.append(
                    f"| {priority} | **{s['id']}** | {s['name']} | {_badge(s['status'])} | "
                    f"{(s['scope'] or '—').replace('|', '/')} | "
                    f"{(s['jump_in_reading'] or '—').replace('|', '/')} | "
                    f"{f['n']} ({f.get('open_bugs', 0)} open) |"
                )
            body.append("")
    text = "# Master plan\n\n" + "\n".join(body) + "\n"
    return text, _db_source("master-plan:subs", subs) | _db_source("master-plan:finds", finds)


def render_subsystem(conn: sqlite3.Connection, storage: Path, s: dict[str, Any]) -> RenderResult:
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
    """

    sid = s["id"]
    files = rows(
        conn,
        "SELECT file_path, why_in_scope, classification, ref_sha, stale, stale_reason"
        " FROM file_ledger WHERE subsystem_id = ? ORDER BY classification, file_path",
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
        " WHERE subsystem_id = ? ORDER BY file_path",
        (sid,),
    )

    # §7.3's Structure section reads claims, and reads them with the same three
    # arms `describe_locus` uses (§3.1's subject and evidence arms, plus §9.1's
    # `<sid>/` namespace).  Two surfaces that answered "what does this subsystem
    # claim" differently would let a claim be current on one and absent from the
    # other, which is the divergence §13 calls a false green.  `valid_until_sha
    # IS NULL` is ADR-0001's current: a claim closed by `apply_change_impact`
    # is history, and history is not rendered here.
    claims = rows(
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
        (sid, _like_prefix(str(sid)), sid),
    )

    # The per-subsystem survey artifact — hand-authored markdown lives in
    # storage root as <ID>-<slug>.md or similar. We look for any registered
    # artifact with kind='subsystem-survey' and this subsystem_id.
    survey_rows = rows(
        conn,
        "SELECT path, content_hash, ref_sha FROM artifacts"
        " WHERE kind = 'subsystem-survey' AND subsystem_id = ?",
        (sid,),
    )
    survey_prose = ""
    prose_sources: dict[str, str] = {}
    for sv in survey_rows:
        prose_path = storage / sv["path"]
        if prose_path.is_file():
            survey_prose += prose_path.read_text() + "\n\n"
            prose_sources.update(_prose_source(storage, sv["path"]))

    out = [
        f"# {sid} — {s['name']}",
        "",
        f"**Status**: {_badge(s['status'])}  ",
        f"**Layer**: {s.get('layer') or '—'}",
        "",
    ]

    # 1. Scope — verbatim, under that heading, never as a purpose sentence.
    #
    # `subsystems` carries no purpose column, so the disclaimer is not
    # conditional on this row: every page says it (§3.1, §7.3). Without it the
    # recorded scope — a file-and-boundary list — sits alone under the first
    # heading and reads as a statement of what the subsystem is for, which is
    # the relabelling §3.1 forbids and BP6 names (F10/codex).
    out += ["## Scope", ""]
    out += [NO_PURPOSE_WITH_SCOPE if s.get("scope") else NO_PURPOSE_ALONE, ""]
    if s.get("scope"):
        out += [str(s["scope"]), ""]
    elif files:
        out += [
            "No scope statement is recorded for this subsystem. The file ledger in"
            " its survey record is the only account of what belongs to it.",
            "",
        ]
    else:
        out += [
            "No scope statement is recorded for this subsystem, and no file is"
            " recorded in its ledger. Nothing here states what it contains.",
            "",
        ]

    # 2. Start here.
    if s.get("jump_in_reading"):
        out += ["## Start here", "", str(s["jump_in_reading"]), ""]

    # 3. Structure — current claims, grouped by what each one records (§7.3).
    #    With none, §9.1's literal and the labelled narrative fallback: unbound
    #    prose is never presented where a revision-bound inventory belongs.
    out += ["## Structure", ""]
    narrative_promoted = False
    provenance = ", ".join(
        f"`{sv['path']}` at content hash `{str(sv['content_hash'] or '—')[:12]}`"
        f", recorded at {_short(str(sv['ref_sha'] or ''))}"
        for sv in survey_rows
    )
    epistemic_labels = labels("claim_epistemic_kind")
    if claims:
        out += [
            "What the survey recorded as claims about this subsystem, grouped by what"
            " each one states. Every claim is bound to the revision it was asserted at"
            " and to the evidence attached to it; a superseded claim is not shown here.",
            "",
        ]
        for kind, heading in CLAIM_KIND_HEADINGS:
            group = [c for c in claims if _claim_kind(sid, str(c["claim_key"])) == kind]
            if not group:
                continue
            out += [
                f"### {heading}",
                "",
                "| Claim | Subject | Statement | Epistemic kind | Asserted at |",
                "|---|---|---|---|---|",
            ]
            for c in group:
                statement = str(c["statement"] or "—").replace("|", "/")
                kind = str(c["epistemic_kind"] or "")
                out.append(
                    f"| `{c['claim_key']}` | `{c['subject_id']}` | {statement}"
                    f" | {epistemic_labels.get(kind, kind) or '—'}"
                    f" | {_short(str(c['asserted_at_sha'] or ''))} |"
                )
            out.append("")
    else:
        out += ["### " + NO_STRUCTURAL_CLAIMS, ""]
        narrative = str(s.get("notes") or "").strip()
        if survey_prose.strip():
            narrative_promoted = True
            out += [
                "No structural claim is recorded for this subsystem."
                f" *{NARRATIVE_LABEL}.*"
                + (f" Its source is {provenance}." if provenance else ""),
                "",
                _nest_prose(survey_prose.strip(), 3),
                "",
            ]
        elif narrative:
            out += [
                "No structural claim is recorded for this subsystem, and no survey"
                " artifact is recorded either. What follows is the note the survey left"
                " on the subsystem record; it is not bound to a revision.",
                "",
                _nest_prose(narrative, 3),
                "",
            ]
        else:
            out += [
                "No structural claim is recorded for this subsystem, and no narrative was"
                " left in its place."
                + (f" The survey artifact is {provenance}." if provenance else ""),
                "",
            ]

    # 4. Boundaries — seams and recorded edges.
    if seams or xrefs:
        out += ["## Boundaries", ""]
        if seams:
            out += [
                "### Seams",
                "",
                "| Seam | Shared object | Other party | Assessable |",
                "|---|---|---|---|",
            ]
            for sm in seams:
                other = sm["party_b"] if sm["party_a"] == sid else sm["party_a"]
                assessable = (
                    "both parties are `mapped`"
                    if int(sm["assessable"] or 0)
                    else "not yet: both parties must be `mapped`"
                )
                out.append(
                    f"| **{sm['id']}** | {sm['shared_object']} | **{other}** |"
                    f" {assessable} |"
                )
            out.append("")
        if xrefs:
            out += [
                "### Recorded edges",
                "",
                "| From | → | To | Relationship | Strength | Context |",
                "|---|---|---|---|---|---|",
            ]
            for x in xrefs:
                out.append(
                    f"| **{x['from_id']}** | → | **{x['to_id']}** | {x['relationship']} | "
                    f"{x['strength']} | {(x['context'] or '—').replace('|', '/')} |"
                )
            out.append("")

    # 5. Vocabulary — §4.5's three states, never collapsed into two. A
    #    subsystem that answered "none" and one nobody asked are different
    #    facts, and the section renders for both: a page that simply omits the
    #    heading makes the silent state unrepresentable (VP4(e)).
    out += ["## Vocabulary", ""]
    if vocab:
        out += [f"- **{v['term']}** — {v['gloss']}" for v in vocab]
        out.append("")
    if vocabulary_state == "declined":
        out += [
            f"**Domain vocabulary** — none. {_declination_sentence(declined[0])}",
            "",
        ]
    elif vocabulary_state == "not-recorded":
        discharge_label = labels("vocabulary_discharge").get("not-recorded", "not recorded")
        out += [
            f"**Domain vocabulary** — {discharge_label.lower()}."
            f" {meanings('vocabulary_discharge').get('not-recorded', '')}",
            "",
        ]
    if vocabulary_state == "terms" and declined:
        # Kept, not erased: a later pass that found a term supersedes the
        # judgment without unsaying it (GP18, §4.3).
        out += [
            f"### {SUPERSEDED_HEADING}",
            "",
            _declination_sentence(declined[0]),
            "",
        ]

    # 6. Known defects here — links, never a second full record (§6.2).
    open_states = FINDING_LENS_STATES.get("findings.md", ())
    open_findings = [f for f in findings if str(f["resolution_state"]) in open_states]
    resolved = [f for f in findings if str(f["resolution_state"]) not in open_states]
    out += ["## Known defects here", ""]
    # Subsystem pages live one directory down, so every link to a top-level
    # lens page is written relative to this page. A bare `findings.md` here
    # resolves to `subsystems/findings.md` and turns the coverage axis red.
    up = "../"
    if open_findings:
        out += [
            f"{_count(len(open_findings), 'defect')} here"
            f" {'is' if len(open_findings) == 1 else 'are'} open or awaiting"
            " verification. Each one's full record, with its evidence, is on"
            f" [Open findings]({up}findings.md).",
            "",
        ]
        for f in open_findings:
            page = finding_page(str(f["resolution_state"])) or "findings.md"
            state = RESOLUTION_LABELS.get(
                str(f["resolution_state"]), str(f["resolution_state"])
            )
            out.append(
                f"- {f['symptom']}"
                f" — [{f['finding_id']}]({up}{page}#{str(f['finding_id']).lower()})"
                f" · {_sev_badge(str(f['severity']))} · {state}"
            )
        out.append("")
    else:
        out += ["No defect here is open or awaiting verification.", ""]
    if resolved:
        out += [
            f"{_count(len(resolved), 'further defect')} here reached a terminal"
            f" state; {'it is' if len(resolved) == 1 else 'they are'} recorded on"
            f" [Resolved findings]({up}resolved-findings.md).",
            "",
        ]

    # 7. Standing (§2.5): what this subsystem's record entitles a reader to claim.
    out += ["## Standing", ""]
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
    # What the ladder status authorizes and what it cannot justify, from the one
    # enum source (§10). A count without that sentence beside it reads as
    # coverage; it is an upper bound on what may be claimed.
    out += [
        f"**{SUBSYSTEM_STATUS_LABELS.get(status, status)}** —"
        f" {SUBSYSTEM_STATUS_MEANINGS.get(status, 'no meaning is recorded for this status.')}"
        f" It cannot justify {SUBSYSTEM_STATUS_LIMITS.get(status, 'more than it records')}.",
        "",
    ]
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
    out += _metric_table(
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
        ]
    )

    # 8. Survey record — apparatus, last.
    out += ["## Survey record", ""]
    out += ["### File ledger", ""]
    if files:
        out += ["| Path | Classification | Why in scope | Examined at |", "|---|---|---|---|"]
        for f in files:
            path = str(f["file_path"])
            out.append(
                f'| <a id="{ledger_entry_anchor(str(sid), path)}"></a>`{path}`'
                f" | {f['classification'] or '—'}"
                f" | {(f['why_in_scope'] or '—').replace('|', '/')}"
                f" | `{(str(f['ref_sha'] or '—'))[:8]}` |"
            )
        out.append("")
    else:
        out += ["No file is recorded in this subsystem's ledger.", ""]

    out += ["### Concern review", ""]
    if dispositions:
        out += [
            "| Concern | Classification | Evidence quality | Linchpin? | Rationale |",
            "|---|---|---|---|---|",
        ]
        for d in dispositions:
            lp = "🔗" if d["linchpin_dependent"] else ""
            out.append(
                f"| **{d['concern_code']}** | {d['classification']} | {d['evidence_quality']} | "
                f"{lp} | {(d['rationale'] or '—').replace('|', '/')} |"
            )
        out.append("")
    else:
        out += ["No concern has been dispositioned in this subsystem.", ""]

    if survey_prose and not narrative_promoted:
        out += ["### Survey artifact", "", _nest_prose(survey_prose, 3)]
    elif survey_prose:
        # §7.3 keeps the artifact in the survey record and §9.1 promotes it into
        # Structure when no claim stands in its place.  Rendering it twice would
        # make one page carry two copies of one witness, so the apparatus points
        # at the reading instead of repeating it.
        out += [
            "### Survey artifact",
            "",
            "The survey artifact is rendered above, under Structure, because no"
            " structural claim is recorded to stand in its place."
            + (f" Its source is {provenance}." if provenance else ""),
            "",
        ]

    text = "\n".join(out).rstrip() + "\n"
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
        | _db_source(f"subsystem:{sid}:claims", claims)
        | _db_source(f"subsystem:{sid}:artifacts", survey_rows)
        | prose_sources
    )
    return text, sources


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


def _finding_table(subsystem_rows: Sequence[dict[str, Any]], level: int = 3) -> list[str]:
    """One subsystem's findings as full marked records (spec §6.2).

    `level` is where the subsystem sits in the page's own hierarchy: the
    Unresolved lens nests it under resolution state and then severity, the
    History lens under resolution state alone.
    """
    subsystem_id = str(subsystem_rows[0]["subsystem_id"])
    subsystem_name = str(subsystem_rows[0].get("subsystem_name") or subsystem_id)
    out = [
        f"{'#' * level} [{subsystem_name}]({subsystem_page(subsystem_id, subsystem_name)})",
        "",
        "| ID | Status | Symptom | Root cause | Ref SHA |",
        "|---|---|---|---|---|",
    ]
    for f in subsystem_rows:
        out.append(finding_marker(str(f["finding_id"])))
        out.append(
            f"| <a id=\"{f['finding_id'].lower()}\"></a>**{f['finding_id']}** | "
            f"{f['resolution_state']} | "
            f"{f['symptom'].replace('|', '/')} | {f['root_cause'].replace('|', '/')} | "
            f"`{(f['ref_sha'] or '—')[:8]}` |"
        )
    out.append("")
    return out


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
    "findings.md": (
        "_{n} carried forward from an earlier store and still undecided. An"
        " inherited defect is an obligation to re-find it, rule it out with"
        " evidence, or mark it repaired at a commit — not a defect this survey"
        " confirmed, and not counted among the findings open above._"
    ),
    "resolved-findings.md": (
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


def _carried_section(
    records: Sequence[dict[str, Any]],
    page: str,
    successors: dict[str, str],
) -> list[str]:
    """Every carried record for one lens, each as a full marked record."""

    if not records:
        return []
    outcome_labels = labels("carried_finding_outcome")
    out = [f"## {CARRIED_HEADING}", ""]
    lead = CARRIED_LEAD.get(page)
    if lead:
        out += [lead.format(n=_count(len(records), "inherited obligation")), ""]
    for record in records:
        store_id = str(record["archived_store_id"])
        archived_id = str(record["archived_finding_id"])
        outcome = str(record["outcome"])
        heading = (
            "Undecided"
            if outcome == CARRIED_UNDECIDED
            else outcome_labels.get(outcome, outcome)
        )
        out += [
            f"### {archived_id} · {_sev_badge(str(record['severity']))} · {heading}",
            "",
            f"{carried_marker(store_id, archived_id)}"
            f'<a id="{carried_anchor(store_id, archived_id)}"></a>',
            "",
            f"- **Carried from** `{store_id}` at {_short(str(record['archived_anchor_sha']))},"
            f" recorded there as `{record['archived_resolution']}`",
            f"- **Subsystem there** {record['subsystem_id']}",
        ]
        if outcome == CARRIED_UNDECIDED:
            out.append(
                f"- **Outcome** `{CARRIED_UNDECIDED}` — nobody here has re-found it,"
                " ruled it out, or recorded a repair"
            )
        else:
            detail = f"- **Outcome** `{outcome}`"
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
            out.append(detail)
            if record.get("rationale"):
                out.append(f"- **Recorded because** {record['rationale']}")
        out += ["", str(record["symptom"]), ""]
        if record.get("root_cause"):
            out += [f"**Root cause, as archived.** {record['root_cause']}", ""]
    return out


def render_findings(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The Unresolved lens: open defects and repairs awaiting verification.

    Resolved records render on `resolved-findings.md` instead, each with its
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
        FINDING_LENS_STATES["findings.md"],
        """CASE v.resolution_state WHEN 'open' THEN 0 ELSE 1 END,
                     CASE f.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                       WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END,
                     f.subsystem_id, f.finding_id""",
    )
    out = ["# Open findings", ""]
    if not fs:
        resolved = row(
            conn,
            "SELECT COUNT(*) AS n FROM finding_state_current"
            " WHERE resolution_state NOT IN ('open','fixed-pending-verification')",
        ) or {"n": 0}
        examined = row(
            conn,
            "SELECT COUNT(*) AS n FROM file_ledger WHERE classification='examined'",
        ) or {"n": 0}
        out += _empty_lens(
            conn,
            "No finding is open or awaiting verification."
            f" {_count(int(resolved['n'] or 0), 'resolved record')} are on"
            " [Resolved findings](resolved-findings.md).",
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
            out += [f"## {heading}", ""]
            out += [_STATE_HINTS[state].format(n=len(state_rows)), ""]
            for sev in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
                sev_rows = [f for f in state_rows if f["severity"] == sev]
                if not sev_rows:
                    continue
                out += [f"### {sev.title()} findings", ""]
                for subsystem_rows in _by_subsystem(sev_rows):
                    out += _finding_table(subsystem_rows, level=4)
    # §5.6: obligations inherited from an earlier store, still undecided here.
    carried = [
        record
        for record in carried_records(conn)
        if carried_page(str(record["outcome"])) == "findings.md"
    ]
    out += _carried_section(carried, "findings.md", _successor_pages(conn))
    return "\n".join(out) + "\n", {
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
    return {
        str(r["file_path"])
        for r in rows(conn, "SELECT DISTINCT file_path FROM file_ledger")
    }


def _cited_path(path: str, ledgered: set[str]) -> str:
    """One cited path, linked into the Files index when the ledger names it.

    A path the ledger does not carry has no anchor to link to, and inventing
    one would break the cross-link read-back rather than help the reader.
    """

    if path in ledgered:
        return f"[`{path}`](files.md#{file_anchor(path)})"
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


def _resolved_records(
    subsystem_rows: Sequence[dict[str, Any]], bases: dict[str, tuple[str, str]]
) -> list[str]:
    """One subsystem's resolved findings as full marked records (§6.2, §7.7).

    A register rather than a table: the basis is a sentence, not a peer column,
    and `reporting-style.md` keeps the identifier and the revision subordinate
    to the language that explains what happened.
    """

    subsystem_id = str(subsystem_rows[0]["subsystem_id"])
    subsystem_name = str(subsystem_rows[0].get("subsystem_name") or subsystem_id)
    out = [
        f"### [{subsystem_name}]({subsystem_page(subsystem_id, subsystem_name)})",
        "",
    ]
    for f in subsystem_rows:
        fid = str(f["finding_id"])
        kind, detail = bases[fid]
        out.append(finding_marker(fid))
        out.append(f'<a id="{fid.lower()}"></a>')
        out += [f"#### {fid} · `{f['severity']}`", ""]
        out += [str(f["symptom"]).strip(), ""]
        out.append(f"- **Root cause** — {str(f['root_cause']).strip()}")
        recorded = str(f["resolution_recorded_at"] or "")
        out.append(
            f"- **Resolution** — `{f['resolution_state']}`"
            + (
                f", recorded {_fmt_time(recorded)}."
                if recorded
                else ", carried by the legacy status with no resolution event recorded."
            )
        )
        if f["fix_sha"] or f["fix_location"]:
            out.append(
                f"- **Repair** — {_short(str(f['fix_sha'] or ''))} at"
                f" `{f['fix_location'] or 'no location recorded'}`."
            )
        out.append(f"- **Basis** — `{kind}`: {detail}")
        out.append("")
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
        FINDING_LENS_STATES["resolved-findings.md"],
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
        if carried_page(str(record["outcome"])) == "resolved-findings.md"
    ]
    carried_block = _carried_section(carried, "resolved-findings.md", _successor_pages(conn))
    carried_source = _db_source("findings:carried-resolved", carried)

    out = ["# Resolved findings", ""]
    if not fs:
        out += _empty_lens(
            conn,
            "No finding has reached a terminal state.",
            "findings recorded verified-fixed, ruled out, or accepted, each with the"
            " basis its resolution rests on.",
            "`finding_state_current` over `findings` and `finding_resolution_events`.",
        )
        out += carried_block
        return "\n".join(out) + "\n", {
            **_db_source("findings:resolved", fs),
            **_db_source("findings:resolved-basis", bases),
            **carried_source,
        }

    out += [
        "_Each record carries the basis its resolution rests on, labelled by kind."
        " A verified repair rests on evidence; a claim ruled out or a behaviour"
        " accepted rests on an argument someone authorized to make it recorded._",
        "",
    ]

    unbacked = [f for f in fs if bases[str(f["finding_id"])][0] == BASIS_NONE]
    if unbacked:
        ids = ", ".join(
            f"[**{f['finding_id']}**](#{str(f['finding_id']).lower()})" for f in unbacked
        )
        out += [
            f"## {NO_BASIS_HEADING}",
            "",
            f"{_count(len(unbacked), 'record')} below reached a terminal state with"
            " neither verification evidence nor a recorded rationale. The store says"
            f" they are closed and does not say on what: {ids}.",
            "",
        ]

    for state in FINDING_LENS_STATES["resolved-findings.md"]:
        state_rows = [f for f in fs if f["resolution_state"] == state]
        if not state_rows:
            continue
        out += [f"## {RESOLUTION_LABELS.get(state, state)}", ""]
        hint = _RESOLVED_STATE_HINTS.get(state)
        if hint:
            out += [hint.format(n=_count(len(state_rows), "record")), ""]
        for subsystem_rows in _by_subsystem(state_rows):
            out += _resolved_records(subsystem_rows, bases)

    out += carried_block
    return "\n".join(out) + "\n", {
        **_db_source("findings:resolved", fs),
        **_db_source("findings:resolved-basis", bases),
        **carried_source,
    }


def render_concerns(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    cs = rows(
        conn,
        "SELECT code, category, origin, status, discovered_in, notes FROM concerns ORDER BY status, code",
    )
    out = ["# Concerns", "", "## Coverage overview", "", concern_coverage_heatmap(conn), ""]
    active = [c for c in cs if c["status"] == "active"]
    retired = [c for c in cs if c["status"] in ("retired", "merged")]
    if active:
        out += ["## Active concerns", "", "| Code | Category | Origin | Discovered in | Notes |", "|---|---|---|---|---|"]
        for c in active:
            out.append(
                f"| <a id=\"{c['code'].lower()}\"></a>**{c['code']}** | {c['category'] or '—'} | "
                f"{c['origin']} | {c['discovered_in'] or '—'} | {(c['notes'] or '').replace('|', '/')} |"
            )
        out.append("")
    if retired:
        out += ["## Retired/merged concerns", ""]
        for c in retired:
            out.append(f"- **{c['code']}** — {c['status']} · {c['notes'] or ''}")
        out.append("")
    return "\n".join(out) + "\n", _db_source("concerns:all", cs) | _db_source(
        "concerns:disp", rows(conn, "SELECT * FROM dispositions")
    ) | _db_source("concerns:subs", rows(conn, "SELECT id FROM subsystems"))


def render_seams(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    seams = rows(conn, "SELECT * FROM seams ORDER BY id")
    assess = rows(conn, "SELECT * FROM seam_assessability")
    asmap = {a["seam_id"]: a for a in assess}
    out = ["# Seams", "", seam_graph(conn), ""]
    if not seams:
        out.append("_No seams recorded yet._")
    else:
        out += [
            "| Seam | Shared object | Kind | Parties | Assessable? | Notes |",
            "|---|---|---|---|---|---|",
        ]
        for s in seams:
            a = asmap.get(s["id"], {})
            assessable = "✅" if a.get("assessable") else "⏳"
            parties = f"**{s['party_a']}** ↔ **{s['party_b']}**"
            out.append(
                f"| <a id=\"{s['id'].lower()}\"></a>**{s['id']}** | {s['shared_object']} | {s['shared_object_kind'] or '—'} | "
                f"{parties} | {assessable} | {(s['notes'] or '').replace('|', '/')} |"
            )
        out.append("")
    return "\n".join(out) + "\n", _db_source("seams:all", seams) | _db_source("seams:assess", assess)


def _contradiction_records(
    cs: Sequence[dict[str, Any]], columns: Sequence[str], cell: Any
) -> list[str]:
    """One contradiction per row, anchored so an event can link back to it."""

    out = [f"| {' | '.join(columns)} |", "|" + "---|" * len(columns)]
    for c in cs:
        anchor = contradiction_anchor(c["id"])
        out.append(
            f'| <a id="{anchor}"></a>**#{c["id"]}** | ' + " | ".join(cell(c)) + " |"
        )
    out.append("")
    return out


def render_contradictions(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The History lens for contradictions: the ones the evidence settled.

    Rows still standing move to `disagreements.md` (§6.1, §7.1). Keeping a copy
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
    out = ["# Conflicting evidence", ""]
    if not cs:
        out += _empty_lens(
            conn,
            "No disagreement between findings has been settled."
            f" {_count(int(standing['n'] or 0), 'pair')} still stand"
            " undiscriminated, on [Records that disagree](disagreements.md).",
            "pairs of findings that made incompatible claims about one locus, and the"
            " evidence or argument that chose between them.",
            "`contradictions` whose resolution is recorded, with"
            " `contradiction_resolution_events` for the account of how.",
        )
        return "\n".join(out) + "\n", {
            **_db_source("contradictions:resolved", cs),
            **_db_source("contradictions:events", sorted(events)),
            **_db_source("contradictions:standing", standing),
        }

    out += [
        "_Two findings made incompatible claims about the same locus and the record"
        " now says which one holds. The disagreement is kept rather than smoothed"
        " away, so a reader who forms the overturned reading again meets the"
        " argument that settled it. Disagreements still standing are on"
        " [Records that disagree](disagreements.md)._",
        "",
    ]

    def cell(c: dict[str, Any]) -> list[str]:
        event = events.get(int(c["id"]))
        rationale = str((event or {}).get("rationale") or "").replace("|", "/").strip()
        scope_note = str(c["scope_note"] or "").replace("|", "/").strip()
        return [
            f"**{c['finding_a']}** / **{c['finding_b']}**",
            f"`{c['resolution']}`",
            f"`{c['shared_location']}`" if c["shared_location"] else "—",
            _fmt_time(c["resolved_at"]) if c["resolved_at"] else "—",
            rationale or scope_note or "No account of the resolution is recorded.",
        ]

    out += _contradiction_records(
        cs,
        ("Record", "Findings", "Resolution", "Shared locus", "Settled", "On what"),
        cell,
    )
    return "\n".join(out) + "\n", {
        **_db_source("contradictions:resolved", cs),
        **_db_source("contradictions:events", sorted(events)),
    }


def render_diagnosticity(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    matrices = rows(
        conn,
        "SELECT id, subsystem_id, symptom, outcome, leading_concern, created_at FROM diagnosticity_sessions ORDER BY created_at DESC",
    )
    out = [
        "# Diagnosticity matrices",
        "",
        "_When two or more concerns could each explain the same symptom, we open a "
        "[diagnosticity matrix](https://en.wikipedia.org/wiki/Analysis_of_competing_hypotheses) "
        "and evaluate evidence row-by-row across the competing concerns. Evidence consistent "
        "with all concerns has zero diagnostic value; evidence that contradicts only one is "
        "decisive. We rank by inconsistency — the concern with the most contradicting evidence "
        "is rejected first. Linchpin evidence (single-point-of-failure for the leading "
        "hypothesis) is flagged explicitly._",
        "",
    ]
    if not matrices:
        out.append("_No diagnosticity matrices recorded._")
    else:
        out += [
            "| ID | Subsystem | Symptom | Outcome | Leading concern | Opened |",
            "|---|---|---|---|---|---|",
        ]
        for m in matrices:
            mid = f"DM-{m['id']}"
            out.append(
                f"| [**{mid}**](diagnosticity/{matrix_slug(m['id'])}.md) | "
                f"**{m['subsystem_id'] or '—'}** | {(m['symptom'] or '').replace('|', '/')} | "
                f"{m['outcome']} | {m['leading_concern'] or '—'} | "
                f"{_fmt_time(m['created_at'])} |"
            )
        out.append("")
    return "\n".join(out) + "\n", _db_source("diagnosticity:index", matrices)


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

    out = [
        f"# DM-{mid} · {m['symptom']}",
        "",
        f"**Subsystem**: **{m['subsystem_id'] or '—'}**  ",
        f"**Shared location**: `{m['shared_location'] or '—'}`  ",
        f"**Outcome**: {m['outcome']}",
    ]
    if m.get("leading_concern"):
        out.append(f"**Leading concern**: **{m['leading_concern']}**  ")
    if m.get("linchpin_note"):
        out.append(f"**Linchpin note**: {m['linchpin_note']}")
    out += ["", "## Matrix", ""]
    if not concerns or not evidence:
        out.append("_Matrix has no concerns or evidence rows._")
    else:
        # Header: evidence row x concerns
        header = "| Evidence | " + " | ".join(f"**{c['concern_code']}**" for c in concerns) + " | Diagnostic value |"
        sep = "|---|" + "|".join(["---"] * len(concerns)) + "|---|"
        out += [header, sep]
        for e in evidence:
            loc = f"`{e['file_path']}`"
            if e["symbol"]:
                loc += f" · `{e['symbol']}`"
            loc += f" · _{e['kind']}_"
            cells_row = [
                _cell_emoji(cell_map.get((c["concern_code"], e["id"]), {}).get("verdict"))
                for c in concerns
            ]
            v = value_map.get(e["id"], {})
            dv = f"{v.get('n_contradicts', 0)}✗ / {v.get('n_consistent', 0)}✓"
            out.append(f"| {loc} | " + " | ".join(cells_row) + f" | {dv} |")
        out += ["", "**Cell legend**: ✓ consistent · ✗ contradicts · · irrelevant · ~ ambiguous", ""]

    if evidence:
        out += ["## Evidence detail", ""]
        for e in evidence:
            out.append(f"### Evidence #{e['id']}")
            out.append("")
            out.append(f"`{e['file_path']}` · `{e.get('symbol') or '—'}` · _{e['kind']}_ · ref `{(e['ref_sha'] or '')[:8]}`")
            if e.get("excerpt"):
                out += ["", "```", e["excerpt"], "```"]
            if e.get("note"):
                out.append("")
                out.append(f"_{e['note']}_")
            out.append("")

    text = "\n".join(out) + "\n"
    sources = (
        _db_source(f"matrix:{mid}:session", m)
        | _db_source(f"matrix:{mid}:concerns", concerns)
        | _db_source(f"matrix:{mid}:evidence", evidence)
        | _db_source(f"matrix:{mid}:cells", cells)
        | _db_source(f"matrix:{mid}:value", value)
    )
    return text, sources


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
    return "declined" if declined else "not-recorded"


def _declination_sentence(record: dict[str, Any]) -> str:
    """One declination, with the three things that make it a judgment (§4.5)."""

    return (
        f"Declared at {_short(str(record['ref_sha'] or ''))} in session"
        f" `{record['session_id']}`: _{record['reason']}_"
    )


def render_vocabulary(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    terms = rows(
        conn,
        "SELECT term, gloss, expansion, subsystem_id, first_seen FROM vocabulary ORDER BY COALESCE(subsystem_id, ''), term",
    )
    out = ["# Glossary", ""]
    if not terms:
        out.append("_No vocabulary recorded._")
    else:
        # Codebase-wide first, then grouped by subsystem.
        global_terms = [t for t in terms if not t["subsystem_id"]]
        scoped = [t for t in terms if t["subsystem_id"]]
        if global_terms:
            out += ["## Codebase-wide", ""]
            for t in global_terms:
                out.append(f"### {t['term']}")
                out += ["", f"_{t['gloss']}_"]
                if t.get("expansion"):
                    out += ["", t["expansion"]]
                if t.get("first_seen"):
                    out += ["", f"First seen: `{t['first_seen']}`"]
                out.append("")
        if scoped:
            # Group by subsystem_id.
            by_ss: dict[str, list[dict[str, Any]]] = {}
            for t in scoped:
                by_ss.setdefault(t["subsystem_id"], []).append(t)
            for sid, items in by_ss.items():
                out += [f"## Scoped to **{sid}**", ""]
                for t in items:
                    out.append(f"- **{t['term']}** — {t['gloss']}")
                out.append("")

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
        out += [
            f"## {VOCABULARY_INDEX_HEADING} ({len(current)} of {len(registered)})",
            "",
        ]
    if current:
        for sid in current:
            out.append(f"- **{sid}** — {_declination_sentence(declined[sid][0])}")
        out.append("")
    elif superseded:
        out += [
            "No subsystem's current state is a declination.",
            "",
        ]
    if superseded:
        out += [
            f"{_count(len(superseded), 'further subsystem')} declared none earlier and"
            " has since recorded a term; the judgment is kept on each subsystem's page"
            f" as superseded history: {', '.join(f'**{sid}**' for sid in superseded)}.",
            "",
        ]
    return "\n".join(out) + "\n", {
        **_db_source("vocab:all", terms),
        **_db_source("vocab:declined", declined),
    }


def render_field_notes(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The Unresolved lens for leads: observations still open (§6.1, §7.1).

    Closed leads move to `resolved-leads.md`, where the page states what the
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
    out = [
        "# Leads",
        "",
        "_Observations from every survey pass that are not yet findings: patterns, "
        "anomalies, connections, tensions, and candidate concerns recorded when a "
        "reader noticed something the phase structure did not ask for. Closed leads "
        "are on [Resolved leads and questions](resolved-leads.md)._",
        "",
    ]
    if not notes:
        out += _empty_lens(
            conn,
            "No lead is open."
            f" {_count(int(closed['n'] or 0), 'closed lead')} are on"
            " [Resolved leads and questions](resolved-leads.md).",
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
            out += [f"## {cat.replace('-', ' ').capitalize()}", ""]
            out += [f"_{_count(len(items), 'open lead')}._", ""]
            for n in items:
                anchor = lead_anchor(n["id"])
                loc = f" @ `{n['location']}`" if n["location"] else ""
                out.append(
                    f'- <a id="{anchor}"></a>{n["observation"]}{loc}'
                    f" · _recorded {_fmt_time(n['created_at'])}_"
                )
            out.append("")
    return "\n".join(out) + "\n", {
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
        " FROM file_ledger ORDER BY subsystem_id, file_path",
    )
    freshness = ledger_freshness(conn)
    names = {
        str(s["id"]): str(s["name"])
        for s in rows(conn, "SELECT id, name FROM subsystems")
    }

    out = ["# Stale knowledge", ""]
    git = row(conn, "SELECT * FROM git_state WHERE repo_id='default'") or {}
    checked = str(git.get("last_checked_sha") or "")
    branch = str(git.get("canonical_branch") or "not recorded")
    if not freshness["scoped_files"]:
        out += _empty_lens(
            conn,
            "No file is recorded in the ledger, so this projection does not measure"
            " freshness. Nothing below is a claim that the survey is current; it is"
            " a statement that nothing was measured.",
            "ledger rows carrying a survey obligation that the repository has changed"
            " under, partitioned by what the row's revision records.",
            "`file_ledger`, read for rows marked stale by `detect_changes`.",
        )
    else:
        out += [
            f"{freshness['stale_obligation']} of {freshness['obligation_files']} files"
            f" carrying a survey obligation are recorded as changed since the revision"
            f" the ledger names, checked at {_short(checked)} on `{branch}`."
            f" {freshness['stale_exempt']} of"
            f" {freshness['scoped_files'] - freshness['obligation_files']} scoped files"
            " exempt from that obligation have also changed; they are counted on the"
            " [overview](index.md) and are not recorded here, because drift in"
            " generated or vendored territory is not survey staleness.",
            "",
        ]

    for heading, classifications in LEDGER_STALE_SECTIONS:
        out += [f"## {heading}", ""]
        for classification in classifications:
            in_class = [r for r in ledger if r["classification"] == classification]
            stale_rows = [r for r in in_class if int(r["stale"] or 0)]
            copy = LEDGER_STALE_SECTION_COPY.get(classification, LEDGER_STALE_FALLBACK_COPY)
            out += [
                _denominator_sentence(copy["measured"], len(stale_rows), len(in_class))
                if in_class
                else copy["absent"],
                "",
            ]
            if stale_rows:
                out += _ledger_stale_table(stale_rows, names, copy["revision"])

    text = "\n".join(out) + "\n"
    sources = {
        **_db_source("stale:ledger", ledger),
        **_db_source("stale:freshness", freshness),
        **_db_source("stale:git", git),
        **_db_source("stale:names", names),
    }
    return text, sources


def _ledger_stale_table(
    stale_rows: Sequence[dict[str, Any]], names: dict[str, str], revision_column: str
) -> list[str]:
    """One section's stale rows as full marked records (§6.2).

    The ledger is a register: the path and the account of why it is in scope
    carry the reading, and the revision and drift facts stay subordinate
    (`reporting-style.md`). `revision_column` names what the row's `ref_sha`
    actually records for this classification.
    """

    out = [
        f"| File | Owner | {revision_column} | Drift recorded | Reason | Why in scope |",
        "|---|---|---|---|---|---|",
    ]
    for r in stale_rows:
        subsystem_id = str(r["subsystem_id"])
        file_path = str(r["file_path"])
        name = names.get(subsystem_id, subsystem_id)
        anchor = ledger_stale_anchor(subsystem_id, file_path)
        out.append(ledger_stale_marker(subsystem_id, file_path))
        out.append(
            f'| <a id="{anchor}"></a>`{file_path}` |'
            f" [{name}]({subsystem_page(subsystem_id, name)}) |"
            f" `{(str(r['ref_sha'] or '—'))[:8]}` |"
            f" {_fmt_time(r['stale_since']) if r['stale_since'] else '—'} |"
            f" {str(r['stale_reason'] or 'not recorded').replace('|', '/')} |"
            f" {str(r['why_in_scope'] or '—').replace('|', '/')} |"
        )
    out.append("")
    return out


# The reader's guide is generated, not written (§7.8, §10.2). Every table below
# comes from `mcp-server/contracts/conspectus-vocabulary.json` by way of the
# generated `vocabulary.py`, and the route table comes from the page plan, so a
# value the server enforces or a page the projection publishes cannot be
# missing from the guide without the generator changing.
HOW_TO_READ_INTRO = """\
# How to read this conspectus
"""

HOW_TO_READ_CLOSING = ""


def _enum_heading(name: str) -> str:
    """A reader-facing name for one enum, with the stored name beside it."""

    return name.replace("_", " ").capitalize()


def _vocabulary_tables() -> list[str]:
    """One table per enum the contract carries, in its declared order (§7.8)."""

    out: list[str] = [
        "## The vocabulary this record uses",
        "",
        "Every value below is generated from the vocabulary contract, version"
        f" `{VOCABULARY_CONTRACT_VERSION}` — the same source the server validates"
        " writes against and the same source this site's labels come from. A value"
        " the server accepts and this page did not carry would be a drift, so the"
        " generator produces both from one definition.",
        "",
    ]
    for name, definition in VOCABULARY.items():
        axis = str(definition.get("axis") or "")
        out += [
            f"### {_enum_heading(name)}",
            "",
            f"`{name}`" + (f" · {axis} axis" if axis else ""),
            "",
            "| Value | Label | What it means | What it cannot justify |",
            "|---|---|---|---|",
        ]
        for entry in definition.get("values") or ():  # type: ignore[union-attr]
            out.append(
                f"| `{entry['value']}` | {str(entry['label']).replace('|', '/')}"
                f" | {str(entry['meaning']).replace('|', '/')}"
                f" | {str(entry['cannot_justify']).replace('|', '/')} |"
            )
        out.append("")
    return out


def _route_tables(routes: Sequence[tuple[str, str, str, str, str]]) -> list[str]:
    """The "what to look at first" table, generated from the page plan (§7.8).

    Written from the plan rather than by hand so a page cannot be published and
    left unroutable: the guide is the one page a stranger is told to read, and a
    site index that silently omits a lens is worse than none.
    """

    out: list[str] = [
        "## What to look at first",
        "",
        "Every page this conspectus publishes, in the order the record presents"
        " them. The lens a page sits under says what kind of claim it carries.",
        "",
    ]
    groups: dict[str, list[tuple[str, str, str, str, str]]] = {}
    for route in routes:
        groups.setdefault(route[3], []).append(route)
    for group, members in groups.items():
        out += [
            f"### {group}",
            "",
            "| Page | What it carries |",
            "|---|---|",
        ]
        for path, label, hint, _group, subgroup in members:
            prefix = f"{subgroup} · " if subgroup else ""
            out.append(
                f"| {prefix}[{label}]({path}) | {str(hint).replace('|', '/')} |"
            )
        out.append("")
    return out


def render_how_to_read(
    conn: sqlite3.Connection,
    storage: Path,
    routes: Sequence[tuple[str, str, str, str, str]] | None = None,
) -> RenderResult:
    """The reader's guide, generated from the enum source and the page plan.

    It was a static string constant, which is how its evidence-quality table
    came to list five of the nine kinds the schema accepts and its finding-status
    table came to carry neither `fixed-pending-verification` nor
    `verified-fixed`. Nothing kept them in step, so nothing did.
    """

    del conn, storage  # the contract and the page plan are the whole source

    body = [HOW_TO_READ_INTRO, ""]
    body += _route_tables(routes or ())
    body += _vocabulary_tables()
    body += [HOW_TO_READ_CLOSING]
    text = "\n".join(body)
    return text, {
        "synthetic:how-to-read": _hash_text(text),
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


def render_open_questions(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The Unresolved lens for decisions: questions still open (§6.1, §7.1).

    Answered, dismissed, and superseded questions move to `resolved-leads.md`.
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
    out = [
        "# Decisions needed",
        "",
        "_Questions the survey could not settle on its own. Each records what it "
        "blocked and the assumption the survey proceeded with, so a reader can see "
        "which readings would change if the assumption turns out wrong. Questions "
        "already settled are on "
        "[Resolved leads and questions](resolved-leads.md)._",
        "",
    ]
    if not questions:
        out += _empty_lens(
            conn,
            "No question is open."
            f" {_count(int(closed['n'] or 0), 'settled question')} are on"
            " [Resolved leads and questions](resolved-leads.md).",
            "questions the survey could not settle, with what each one blocked and"
            " the assumption used to keep moving.",
            "`open_questions` whose resolution is still `open`.",
        )
        return "\n".join(out) + "\n", {
            **_db_source("open_questions:open", questions),
            **_db_source("open_questions:closed-count", closed),
        }

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
        out += [f"## {cat.replace('-', ' ').capitalize()}", ""]
        out += [f"_{_count(len(items), 'open question')}._", ""]
        for q in items:
            loc = f" · subsystem **{q['subsystem_id']}**" if q["subsystem_id"] else ""
            phase = f" · phase `{q['phase']}`" if q["phase"] else ""
            out.append(f'<a id="{question_anchor(q["id"])}"></a>')
            out += [f"### #{q['id']}{loc}{phase}", ""]
            out += [f"> {q['question']}", ""]
            if q["what_blocked"]:
                out.append(f"- **What this blocked** — {q['what_blocked']}")
            if q["what_assumed"]:
                out.append(
                    f"- **Assumption the survey proceeded with** — {q['what_assumed']}"
                )
            out.append(f"- **Recorded** — {_fmt_time(q['created_at'])}.")
            out.append("")

    return "\n".join(out) + "\n", {
        **_db_source("open_questions:open", questions),
        **_db_source("open_questions:closed-count", closed),
    }


# ---------------------------------------------------------------------------
# Prose passthroughs (onboarding report, entry-point, concern-checklist)
# ---------------------------------------------------------------------------


def passthrough_prose(storage: Path, rel_source: str, title: str) -> RenderResult | None:
    p = storage / rel_source
    if not p.is_file():
        return None
    body = p.read_text()
    # Prepend a banner only if the source doesn't already start with #.
    if not body.lstrip().startswith("#"):
        body = f"# {title}\n\n{body}"
    return body, _prose_source(storage, rel_source)


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
    open_states = FINDING_LENS_STATES.get("findings.md", ())
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
        " FROM file_standing ORDER BY file_path, subsystem_id",
    )
    defects = _open_defects_by_path(conn)
    git = row(conn, "SELECT * FROM git_state WHERE repo_id='default'") or {}
    checked = str(git.get("last_checked_sha") or "")

    by_path: dict[str, list[dict[str, Any]]] = {}
    for entry in standing:
        by_path.setdefault(str(entry["file_path"]), []).append(entry)

    out = ["# Files", ""]
    if not by_path:
        out += [
            "No file is recorded in the ledger, so this index has nothing to show."
            " That is a statement about the record, not about the repository: no"
            " path here has been read, excluded, or even scoped.",
            "",
        ]
    else:
        out += [
            f"{_count(len(by_path), 'distinct path')} across"
            f" {_count(len(standing), 'ledger row')},"
            f" read at {_short(checked)}. Every owner of a path is listed, and the"
            " examined revision is the one that owner recorded — two subsystems"
            " may have read the same file at different revisions.",
            "",
            "| File | Owners | Standing | Examined at | Open defects |",
            "|---|---|---|---|---|",
        ]
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
            out.append(
                f'| <a id="{file_anchor(file_path)}"></a>`{file_path}` |'
                f" {owner_links} |"
                f" {STANDING_LABELS.get(headline, headline)} |"
                f" {revision} |"
                f" {defects.get(file_path, 0)} |"
            )
        out.append("")

    sources = {
        **_db_source("files:standing", standing),
        **_db_source("files:defects", defects),
        **_db_source("files:git", git),
    }
    return "\n".join(out) + "\n", sources


def _tracked_paths(
    conn: sqlite3.Connection,
    storage: Path,
    standing: ReconciliationStanding | None = None,
) -> int | None:
    """The tracked-path universe at the revision this projection stamps (§3.4).

    It reads the **standing reconciliation** and nothing else. It used to
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
    return standing.tracked_paths


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
) -> list[str]:
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
        return [sentence if reason is None else f"{sentence} {reason}", ""]
    return [f"**{numerator} of {denominator}** {unit} {clause}", ""]


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
        " ORDER BY file_path",
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
        f" FROM file_ledger WHERE {OBLIGATION_BEARING_SQL}"
        " ORDER BY subsystem_id, file_path",
    )
    candidates = [r for r in ledger if r["classification"] == "candidate"]
    deferred = [s for s in subsystems if str(s["status"]) == "deferred"]
    seams = rows(
        conn,
        "SELECT seam_id, shared_object, party_a, party_b, assessable"
        " FROM seam_assessability ORDER BY seam_id",
    )
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

    out = [
        "# Not yet surveyed",
        "",
        f"Counted at {_short(checked)} on `{branch}`.",
        "",
    ]

    # 1. Unledgered paths, over tracked paths.
    out += ["## Paths with no ledger row", ""]
    out += _gap_denominator(
        len(unledgered),
        tracked,
        "tracked paths",
        "are named by no `file_ledger` row in any subsystem. They participate in no"
        " subsystem's scope, so nothing here has been read, excluded, or deferred.",
        reason=None if standing.stands else _sentence(_unmeasured(standing)),
    )
    if unledgered:
        by_directory: dict[str, list[str]] = {}
        for entry in unledgered:
            path = str(entry["file_path"])
            head = path.split("/", 1)[0] if "/" in path else "(repository root)"
            by_directory.setdefault(head, []).append(path)
        for directory in sorted(by_directory, key=lambda d: (-len(by_directory[d]), d)):
            paths = by_directory[directory]
            out += [f"### {directory} — {_count(len(paths), 'path')}", ""]
            out += [f"- `{path}`" for path in paths]
            out.append("")

    # 2. Candidate rows, over obligation-bearing ledger rows.
    out += ["## Files in scope that no one has read", ""]
    out += _gap_denominator(
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
            out += [
                f"### {name} **{subsystem_id}** — {len(entries)} unread of"
                f" {_count(owned, 'row')} carrying an obligation",
                "",
            ]
            out += [
                f"- `{entry['file_path']}` — {entry['why_in_scope'] or 'no reason recorded'}"
                for entry in entries
            ]
            out.append("")

    # 3. Deferred subsystems, over subsystems.
    out += ["## Subsystems set aside", ""]
    out += _gap_denominator(
        len(deferred),
        len(subsystems),
        "subsystems",
        "are deferred. `deferred` is not a rung on the survey ladder but an"
        " orthogonal do-not-survey flag, so nothing in them has been surveyed at any"
        " depth.",
    )
    if deferred:
        out += ["| Subsystem | Layer | Recorded reason |", "|---|---|---|"]
        for s in deferred:
            reason = str(s["notes"] or "").replace("|", "/").strip()
            out.append(
                f"| [{s['name']}]({subsystem_page(str(s['id']), str(s['name']))})"
                f" **{s['id']}** | {s['layer'] or '—'} |"
                f" {reason or 'No reason is recorded.'} |"
            )
        out.append("")

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
    out += ["## Seam sides no one has assessed", ""]
    out += _gap_denominator(
        len(unassessed),
        2 * len(seams),
        "(seam, side) pairs",
        "carry no recorded assessment. The unit is the pair, not the seam: a seam"
        " assessed from one side only is half-known, and counting seams would report"
        " it as covered.",
    )
    out += [PER_PARTY_PROXY, ""]
    if unassessed:
        out += ["| Seam | Unassessed party | Other party | Why |", "|---|---|---|---|"]
        for seam_id, side, other, why in unassessed:
            out.append(
                f"| **{seam_id}** | [{names.get(side, side)}]"
                f"({subsystem_page(side, names.get(side, side))}) **{side}** |"
                f" **{other}** | {why} |"
            )
        out.append("")

    # 5. Undispositioned (subsystem, active concern) pairs.
    missing: dict[str, list[str]] = {}
    for s in subsystems:
        for concern in active_concerns:
            pair = (str(s["id"]), str(concern["code"]))
            if pair not in dispositioned:
                missing.setdefault(str(s["id"]), []).append(str(concern["code"]))
    undispositioned = sum(len(codes) for codes in missing.values())
    out += ["## Concerns no one has dispositioned here", ""]
    out += _gap_denominator(
        undispositioned,
        len(subsystems) * len(active_concerns),
        "(subsystem, active concern) pairs",
        "carry no disposition. The unit is the pair: a concern dispositioned"
        " somewhere else says nothing about this subsystem, and counting concern"
        " codes would report a checklist as complete while most regions were never"
        " tested against it.",
    )
    if missing:
        out += ["| Subsystem | Undispositioned | Concerns |", "|---|---|---|"]
        for subsystem_id in sorted(missing):
            codes = missing[subsystem_id]
            name = names.get(subsystem_id, subsystem_id)
            out.append(
                f"| [{name}]({subsystem_page(subsystem_id, name)}) **{subsystem_id}** |"
                f" {len(codes)} of {len(active_concerns)} |"
                f" {', '.join(f'**{code}**' for code in codes)} |"
            )
        out.append("")

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
    return "\n".join(out) + "\n", sources


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

    out = ["# Records that disagree", ""]
    if not (contradictions or matrices or competing):
        out += _empty_lens(
            conn,
            "No record stands undiscriminated.",
            "findings that cannot both be right, evidence matrices the evidence does"
            " not separate, and concern reviews that recorded a competition rather"
            " than a verdict.",
            "`contradictions`, `diagnosticity_sessions`, and `dispositions`, each read"
            " for the state that means *the record does not say which*.",
        )
        return "\n".join(out) + "\n", {
            **_db_source("disagreements:contradictions", contradictions),
            **_db_source("disagreements:matrices", matrices),
            **_db_source("disagreements:dispositions", competing),
        }

    out += [
        "_Each record below is a place where the survey could have written one"
        " reading and did not, because the evidence it had does not choose. That is"
        " information: it says where a further pass would change the record, and"
        " what kind of evidence it would take. Records the evidence did settle are"
        " on [Conflicting evidence](contradictions.md)._",
        "",
    ]

    out += ["## Findings that cannot both be right", ""]
    if contradictions:
        out += [f"_{_count(len(contradictions), 'pair')} with no recorded resolution._", ""]
        out += [
            "| Record | Findings | Shared locus | Conflict | Detected |",
            "|---|---|---|---|---|",
        ]
        for c in contradictions:
            anchor = contradiction_anchor(c["id"])
            locus = f"`{c['shared_location']}`" if c["shared_location"] else "—"
            conflict = str(c["conflict_type"]).replace("|", "/")
            out.append(
                f'| <a id="{anchor}"></a>**#{c["id"]}** |'
                f" **{c['finding_a']}** / **{c['finding_b']}** | {locus} |"
                f" {conflict} | {_fmt_time(c['detected_at'])} |"
            )
        out.append("")
    else:
        out += ["No pair of findings is recorded as disagreeing.", ""]

    out += ["## Competing explanations the evidence has not chosen between", ""]
    if matrices:
        out += [
            f"_{_count(len(matrices), 'matrix', 'matrices')} still open or recorded as"
            " unresolved competition. The full matrix is on its own page._",
            "",
        ]
        out += ["| Matrix | Subsystem | Symptom | Outcome | Opened |", "|---|---|---|---|---|"]
        for m in matrices:
            subsystem_id = str(m["subsystem_id"] or "")
            subsystem = (
                f"[{names.get(subsystem_id, subsystem_id)}]"
                f"({subsystem_page(subsystem_id, names.get(subsystem_id, subsystem_id))})"
                if subsystem_id
                else "—"
            )
            out.append(
                f"| [DM-{m['id']}]({matrix_page(int(m['id']))}) | {subsystem} |"
                f" {str(m['symptom'] or '').replace('|', '/')} |"
                f" `{m['outcome'] or 'open'}` | {_fmt_time(m['created_at'])} |"
            )
        out.append("")
    else:
        out += ["No evidence matrix is open or recorded as unresolved competition.", ""]

    out += ["## Concern reviews that recorded a competition", ""]
    if competing:
        out += [
            f"_{_count(len(competing), 'review')} where two or more concerns each"
            " explain what was observed and the evidence does not separate them._",
            "",
        ]
        out += [
            "| Subsystem | Concern | Strongest evidence | Linchpin | Recorded | Rationale |",
            "|---|---|---|---|---|---|",
        ]
        for d in competing:
            subsystem_id = str(d["subsystem_id"])
            name = names.get(subsystem_id, subsystem_id)
            quality = f"`{d['evidence_quality']}`" if d["evidence_quality"] else "not recorded"
            linchpin = "yes" if int(d["linchpin_dependent"] or 0) else "no"
            rationale = str(d["rationale"] or "No rationale is recorded.").replace("|", "/")
            out.append(
                f"| [{name}]({subsystem_page(subsystem_id, name)}) **{subsystem_id}** |"
                f" **{d['concern_code']}** | {quality} | {linchpin} |"
                f" {_fmt_time(d['assessed_at'])} | {rationale} |"
            )
        out.append("")
    else:
        out += ["No concern review recorded an unresolved competition.", ""]

    return "\n".join(out) + "\n", {
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


def _hot_spot_access(conn: sqlite3.Connection) -> dict[str, int]:
    """Recorded accesses per subsystem, by way of the entry each one names.

    `access_log` records an entry, not a subsystem, so an access reaches a
    subsystem only through an `entries` row that carries one. When none does,
    §7.6 omits the column rather than printing a column of zeros: zero recorded
    accesses and no access recording at all are different claims (VP4).
    """

    return {
        str(r["subsystem_id"]): int(r["n"] or 0)
        for r in rows(
            conn,
            "SELECT e.subsystem_id, COUNT(*) AS n"
            "  FROM access_log a"
            "  JOIN entries e ON e.id = a.entry_id AND e.tier = a.entry_tier"
            " WHERE e.subsystem_id IS NOT NULL"
            " GROUP BY e.subsystem_id",
        )
    }


def _weakest_quality(qualities: Sequence[str | None]) -> str:
    """The weakest rung recorded among some confirmed-bug reviews, or `—`.

    A review that records no quality at all is weaker than any recorded rung —
    there is nothing to read the claim against — so it wins the comparison.
    """

    if not qualities:
        return "—"
    ladder = values_of("evidence_quality")
    if any(not quality for quality in qualities):
        return "not recorded"
    return max(
        (str(q) for q in qualities),
        key=lambda q: ladder.index(q) if q in ladder else len(ladder),
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
    findings = rows(
        conn,
        "SELECT v.subsystem_id, f.severity, v.resolution_state"
        "  FROM finding_state_current v"
        "  JOIN findings f ON f.finding_id = v.finding_id"
        " WHERE v.resolution_state IN ('open','fixed-pending-verification')",
    )
    contradiction_parties = rows(
        conn,
        "SELECT DISTINCT c.id, f.subsystem_id"
        "  FROM contradictions c"
        "  JOIN findings f ON f.finding_id IN (c.finding_a, c.finding_b)"
        " WHERE COALESCE(c.resolution,'unresolved')='unresolved'"
        "   AND f.subsystem_id IS NOT NULL",
    )
    competing_matrices = rows(
        conn,
        "SELECT subsystem_id, COUNT(*) AS n FROM diagnosticity_sessions"
        " WHERE COALESCE(outcome,'open') IN ('open','unresolved-competition')"
        "   AND subsystem_id IS NOT NULL GROUP BY subsystem_id",
    )
    competing_reviews = rows(
        conn,
        "SELECT subsystem_id, COUNT(*) AS n FROM dispositions"
        " WHERE classification='unresolved-competition' GROUP BY subsystem_id",
    )
    bug_reviews = rows(
        conn,
        "SELECT subsystem_id, evidence_quality FROM dispositions"
        " WHERE classification='confirmed-bug'",
    )
    ledger = rows(
        conn,
        "SELECT subsystem_id, COALESCE(classification,'candidate') AS classification,"
        f" COALESCE(stale,0) AS stale FROM file_ledger WHERE {OBLIGATION_BEARING_SQL}",
    )
    seams = rows(
        conn,
        "SELECT seam_id, party_a, party_b, assessable FROM seam_assessability"
        " ORDER BY seam_id",
    )
    seam_concern_parties = {
        str(d["subsystem_id"])
        for d in rows(
            conn,
            "SELECT DISTINCT subsystem_id FROM dispositions WHERE concern_code LIKE 'SC-%'",
        )
    }
    access = _hot_spot_access(conn)

    out = ["# Hot spots", ""]
    if not subs:
        out += _empty_lens(
            conn,
            "No subsystem is recorded, so there is nothing to compare.",
            "one row per subsystem, each column a separate measure of unresolved work"
            " or unread territory.",
            "`findings`, `contradictions`, `diagnosticity_sessions`, `dispositions`,"
            " `file_ledger`, and `seam_assessability`.",
        )
        return "\n".join(out) + "\n", _db_source("hotspots:subsystems", subs)

    measures: list[dict[str, Any]] = []
    for s in subs:
        sid = str(s["id"])
        owned = [f for f in findings if str(f["subsystem_id"]) == sid]
        open_rows = [f for f in owned if f["resolution_state"] == "open"]
        crit_high = sum(1 for f in open_rows if f["severity"] in ("CRITICAL", "HIGH"))
        med_low = sum(1 for f in open_rows if f["severity"] in ("MEDIUM", "LOW"))
        awaiting = sum(
            1 for f in owned if f["resolution_state"] == "fixed-pending-verification"
        )
        undiscriminated = (
            sum(1 for c in contradiction_parties if str(c["subsystem_id"]) == sid)
            + sum(int(m["n"] or 0) for m in competing_matrices if str(m["subsystem_id"]) == sid)
            + sum(int(r["n"] or 0) for r in competing_reviews if str(r["subsystem_id"]) == sid)
        )
        quality = _weakest_quality(
            [r["evidence_quality"] for r in bug_reviews if str(r["subsystem_id"]) == sid]
        )
        owned_rows = [r for r in ledger if str(r["subsystem_id"]) == sid]
        unread = sum(1 for r in owned_rows if r["classification"] == "candidate")
        stale = sum(1 for r in owned_rows if int(r["stale"] or 0))
        party_seams = [
            seam for seam in seams if sid in (str(seam["party_a"]), str(seam["party_b"]))
        ]
        unassessed = 0
        for seam in party_seams:
            assessable = int(seam["assessable"] or 0)
            for side in (str(seam["party_a"]), str(seam["party_b"])):
                if not assessable or side not in seam_concern_parties:
                    unassessed += 1
        measures.append(
            {
                "id": sid,
                "name": str(s["name"] or sid),
                "crit_high": crit_high,
                "med_low": med_low,
                "awaiting": awaiting,
                "undiscriminated": undiscriminated,
                "quality": quality,
                "unread": unread,
                "obligation": len(owned_rows),
                "unread_fraction": (unread / len(owned_rows)) if owned_rows else 0.0,
                "stale": stale,
                "unassessed_sides": unassessed,
                "seam_sides": 2 * len(party_seams),
                "access": access.get(sid),
            }
        )

    measures.sort(
        key=lambda m: (-m["crit_high"], -m["med_low"], -m["unread_fraction"], m["id"])
    )

    out += [
        "_Rows are ordered by open critical and high defects, then open medium and low, then the unread fraction._",
        "",
    ]

    headers = list(HOT_SPOT_COLUMNS) + ([ACCESS_COLUMN] if access else [])
    out += [f"| {' | '.join(headers)} |", "|" + "---|" * len(headers)]
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
        out.append(f"| {' | '.join(cells)} |")
    out.append("")

    out += ["## What each column measures", ""]
    for note in HOT_SPOT_COLUMN_NOTES:
        out += [note, ""]
    out += [
        "**Unassessed seam sides** counts `(seam, side)` pairs over twice the seams"
        " this subsystem is party to: a seam assessed from one side only is"
        " half-known, and counting seams would report it as covered."
        f" {PER_PARTY_PROXY}",
        "",
    ]
    if access:
        out += [
            f"**{ACCESS_COLUMN}** counts the accesses recorded against entries this"
            " subsystem owns. It measures what the survey read, not what the"
            " repository runs.",
            "",
        ]
    else:
        out += [
            f"No **{ACCESS_COLUMN}** column is shown: no recorded access reaches a"
            " subsystem, and a column of zeros would read as a measurement that was"
            " taken.",
            "",
        ]

    return "\n".join(out) + "\n", {
        **_db_source("hotspots:measures", measures),
        **_db_source("hotspots:access", access),
    }


# ---------------------------------------------------------------------------
# History: the append-only account of how records reached their state (§7.7)
# ---------------------------------------------------------------------------


def render_resolution_history(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """One newest-first timeline over the two tables that keep an event trail.

    Findings and contradictions are the only record families whose history is
    append-only: no code path in `mcp-server/src` or `materializer` updates or
    deletes either event table. Every other family carries a mutable terminal
    column and is reported on `resolved-leads.md`, which says so (§1.1, C58).
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
    contradiction_events = rows(
        conn,
        "SELECT e.id, e.contradiction_id, e.resolution, e.scope_note, e.rationale,"
        "       e.session_id, e.recorded_at, c.resolution AS current_resolution"
        "  FROM contradiction_resolution_events e"
        "  LEFT JOIN contradictions c ON c.id = e.contradiction_id"
        " ORDER BY e.id DESC",
    )

    out = ["# Resolution history", ""]
    if not (finding_events or contradiction_events):
        out += _empty_lens(
            conn,
            "No resolution event is recorded.",
            "every state a finding or a contradiction was recorded in, newest first,"
            " with the account given at the time.",
            "`finding_resolution_events` and `contradiction_resolution_events`, the"
            " two tables nothing updates or deletes.",
        )
        return "\n".join(out) + "\n", {
            **_db_source("history:finding-events", finding_events),
            **_db_source("history:contradiction-events", contradiction_events),
        }

    timeline: list[tuple[str, int, int, list[str]]] = []
    for e in finding_events:
        fid = str(e["finding_id"])
        page = finding_page(e["current_state"]) or FINDING_LENS_PAGES[0][1]
        account = str(e["rationale"] or "").replace("|", "/").strip()
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
    for e in contradiction_events:
        cid = e["contradiction_id"]
        page = contradiction_page(e["current_resolution"])
        account = str(e["rationale"] or "").replace("|", "/").strip()
        if e["scope_note"]:
            account = f"{account} Scopes: {str(e['scope_note']).replace('|', '/')}".strip()
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

    out += [
        "_Every state a finding or a contradiction was recorded in, newest first,"
        " with the account given at the time. Nothing here is rewritten when a"
        " record moves on: a repair that was later defeated keeps the event that"
        " recorded it, which is how a regression is visible at all. Each row links"
        " to where that record is written in full today._",
        "",
    ]
    out += [
        "| Recorded | Record | State | Session | Account |",
        "|---|---|---|---|---|",
    ]
    out += [f"| {' | '.join(cells)} |" for _at, _rank, _id, cells in timeline]
    out.append("")

    return "\n".join(out) + "\n", {
        **_db_source("history:finding-events", finding_events),
        **_db_source("history:contradiction-events", contradiction_events),
    }


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

    out = ["# Resolved leads and questions", ""]
    if not (questions or notes):
        out += _empty_lens(
            conn,
            "No question has been settled and no lead has been closed.",
            "questions answered, dismissed, or superseded, and leads closed either by"
            " becoming a finding or by being dismissed.",
            "`open_questions.resolution` and `field_notes.follow_up`, both mutable"
            " columns with no event table behind them.",
        )
        return "\n".join(out) + "\n", {
            **_db_source("resolved-leads:questions", questions),
            **_db_source("resolved-leads:notes", notes),
        }

    out += [
        "_These two families reach a terminal state in a column, not in an event"
        " table. The record says what state they are in; for how they got there it"
        " says only what is written below. Findings and contradictions do keep an"
        " event trail, on [Resolution history](resolution-history.md)._",
        "",
    ]

    out += ["## Questions", ""]
    if questions:
        out += [
            f"_{_count(len(questions), 'question')} settled, newest first by the time"
            f" recorded. {QUESTION_TERMINAL_LIMIT}_",
            "",
        ]
        for q in questions:
            settled = (
                _fmt_time(q["resolved_at"]) if q["resolved_at"] else "not recorded"
            )
            subsystem = (
                f" · subsystem **{q['subsystem_id']}**" if q["subsystem_id"] else ""
            )
            out.append(f'<a id="{question_anchor(q["id"])}"></a>')
            out += [f"### #{q['id']} · {q['category']}{subsystem}", ""]
            out += [f"> {q['question']}", ""]
            out.append(f"- **Settled** — `{q['resolution']}`, {settled}.")
            out.append(
                f"- **Answer** — {q['answer']}"
                if q["answer"]
                else "- **Answer** — No answer is recorded."
            )
            if q["what_blocked"]:
                out.append(f"- **What it blocked** — {q['what_blocked']}")
            out.append("")
    else:
        out += ["No question has been answered, dismissed, or superseded.", ""]

    out += ["## Leads", ""]
    if notes:
        out += [
            f"_{_count(len(notes), 'lead')} closed. {LEAD_TERMINAL_LIMIT}_",
            "",
        ]
        out += [
            "| Lead | Category | Opened | Closed as | Observation |",
            "|---|---|---|---|---|",
        ]
        for n in notes:
            anchor = lead_anchor(n["id"])
            observation = str(n["observation"]).replace("|", "/").replace("\n", " ")
            location = f" @ `{n['location']}`" if n["location"] else ""
            out.append(
                f'| <a id="{anchor}"></a>**#{n["id"]}** | {n["category"]} |'
                f" {_fmt_time(n['created_at'])} | {n['follow_up']} |"
                f" {observation}{location} |"
            )
        out.append("")
    else:
        out += ["No lead has been closed.", ""]

    return "\n".join(out) + "\n", {
        **_db_source("resolved-leads:questions", questions),
        **_db_source("resolved-leads:notes", notes),
    }


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

    out = ["# Sessions and publications", ""]
    if not (sessions or refreshes or verifications):
        out += _empty_lens(
            conn,
            "Nothing is recorded as having run against this conspectus.",
            "the survey sessions that were opened, the refresh runs that were"
            " dispatched, and the publications whose read-back was verified.",
            "`sessions`, `refresh_runs`, and `projection_verification_runs`.",
        )
        return "\n".join(out) + "\n", {
            **_db_source("sessions:sessions", sessions),
            **_db_source("sessions:refreshes", refreshes),
            **_db_source("sessions:verifications", verifications),
        }

    out += [
        "_What ran against this conspectus, and what each run produced. A session"
        " still without an end is one that was never closed, which is a fact about"
        " the record rather than about the work._",
        "",
    ]

    out += ["## Survey sessions", ""]
    if sessions:
        out += ["| Session | Intent | Started | Ended | Outcome |", "|---|---|---|---|---|"]
        for s in sessions:
            intent = str(s["intent"] or "").replace("|", "/")
            out.append(
                f"| `{s['session_id']}` | `{intent}` | {_fmt_time(s['started_at'])} |"
                f" {_fmt_time(s['ended_at']) if s['ended_at'] else 'not closed'} |"
                f" {str(s['outcome'] or 'not recorded').replace('|', '/')} |"
            )
        out.append("")
    else:
        out += ["No survey session is recorded.", ""]

    out += ["## Refresh runs", ""]
    if refreshes:
        out += [
            "| Run | Status | Base | Head | Provider | Model | Completed |",
            "|---|---|---|---|---|---|---|",
        ]
        for r in refreshes:
            out.append(
                f"| `{r['run_id']}` | `{r['status']}` | {_short(str(r['base_sha'] or ''))} |"
                f" {_short(str(r['head_sha'] or ''))} | {r['selected_provider']} |"
                f" `{r['model']}` |"
                f" {_fmt_time(r['completed_at']) if r['completed_at'] else 'not completed'} |"
            )
        out.append("")
    else:
        out += ["No refresh run is recorded.", ""]

    out += ["## Publication read-back", ""]
    if verifications:
        out += [
            "| Run | Mode | State | Coverage | Content | Verified |",
            "|---|---|---|---|---|---|",
        ]
        for v in verifications:
            axes = " | ".join(
                "green" if int(v[f"{axis}_ok"] or 0) else "red"
                for axis in ("state", "coverage", "content")
            )
            out.append(
                f"| `{v['run_id']}` | `{v['mode']}` | {axes} |"
                f" {_fmt_time(v['verified_at'])} |"
            )
        out.append("")
    else:
        out += [
            "No publication read-back is recorded, so none of the three axes has a"
            " result to report.",
            "",
        ]

    return "\n".join(out) + "\n", {
        **_db_source("sessions:sessions", sessions),
        **_db_source("sessions:refreshes", refreshes),
        **_db_source("sessions:verifications", verifications),
    }
