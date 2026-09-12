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
from hashlib import sha256
from pathlib import Path
from typing import Any

from .db import row, rows
from .diagrams import (
    concern_coverage_heatmap,
    runtime_boundary_map,
    seam_graph,
    staleness_map,
    subsystem_dependency_graph,
)
from .lint import orientation_violations
from .manifest import sha256_bytes, sha256_json
from .readback import (
    FINDING_LENS_PAGES,
    LEDGER_STALE_SECTIONS,
    finding_marker,
    finding_page,
    ledger_stale_anchor,
    ledger_stale_marker,
    stale_marker,
)
from .slugs import matrix_slug, subsystem_page
from .vocabulary import OBLIGATION_BEARING_SQL, labels, values_of

RenderResult = tuple[str, dict[str, str]]

# The resolution states each findings page renders, from the one definition in
# readback.py, and their human labels from the enum source (spec §6.1, §10).
FINDING_LENS_STATES: dict[str, tuple[str, ...]] = {
    page: states for _lens, page, states in FINDING_LENS_PAGES
}
RESOLUTION_LABELS = labels("finding_resolution_state")


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
    return Thesis(body, recorded=True)


def resolve_workspace(storage: Path) -> Path:
    """The surveyed workspace: the recorded path, else the storage's parent."""

    record = storage / "workspace_path"
    if record.is_file():
        recorded = record.read_text().strip()
        if recorded:
            return Path(recorded)
    return storage.parent


def project_name(storage: Path) -> str:
    """The project's own name, which is the projection's primary identity.

    Amanuensis is the producing method and never the title
    (`reporting-style.md` § "Keep information architecture and interface design
    separate").
    """

    report = storage / "onboarding-report.md"
    if report.is_file():
        for line in report.read_text().splitlines():
            if line.startswith("**Codebase**:"):
                recorded = line.partition(":")[2].strip().split(" — ", 1)[0].strip()
                if recorded:
                    return recorded
                break
    return resolve_workspace(storage).name or "Project"


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
    examined = int(alignment["examined"])
    scoped = int(alignment["scoped_files"])

    subs = rows(conn, "SELECT id, name, status, layer FROM subsystems ORDER BY id")
    ladder = {
        status: sum(1 for s in subs if (s["status"] or "unmapped") == status)
        for status in values_of("subsystem_status")
    }
    depth = ", ".join(f"{count} {status}" for status, count in ladder.items() if count)
    unledgered = row(
        conn, "SELECT COUNT(*) AS n FROM scope_gaps WHERE kind='unledgered'"
    ) or {"n": 0}

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
        f"An architecture survey of {name}, recorded by Amanuensis. The durable"
        " records are authoritative; every page here is derived from them.",
        "",
        # 2. Thesis — by heading, from entry-point.md, or the named instruction.
        "## What is this codebase?",
        "",
        thesis.text,
        "",
        # 3. Four status dimensions, each a separate named fact.
        "## Where the record stands",
        "",
        "Four dimensions, each read from durable records and each reported on its"
        " own terms. None of them is combined with another.",
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
                "Files carrying a survey obligation marked stale",
                f"{stale_obligation} of {obligation}"
                if obligation
                else "not measured by this projection",
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
    out += _metric_table(
        [
            (
                "Subsystems by survey depth",
                depth if depth else "no subsystem is registered",
            ),
            (
                "Files read, of those carrying an obligation",
                f"{examined} of {obligation}"
                if obligation
                else "no scoped file carries a survey obligation",
            ),
            (
                "Paths in scope with no ledger row",
                str(unledgered["n"] or 0),
            ),
        ]
    )
    out += ["### Open engineering work", ""]
    out += _metric_table(
        [
            ("Findings open", str(state_counts.get("open", 0))),
            (
                "Repairs awaiting verification",
                str(state_counts.get("fixed-pending-verification", 0)),
            ),
            ("Contradictions unresolved", str(unresolved["n"] or 0)),
            ("Decisions open", str(decisions["n"] or 0)),
        ]
    )
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
    sources = {
        **_db_source("index:alignment", alignment),
        **_db_source("index:subs", subs),
        **_db_source("index:states", state_counts),
        **_db_source("index:unledgered", unledgered),
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
    out = [
        "# Architecture",
        "",
        "## Runtime boundary map",
        "",
        runtime_boundary_map(storage),
        "",
        "## Subsystem dependency graph" if xrefs else "## Subsystem atlas",
        "",
        subsystem_dependency_graph(conn),
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
    finds = rows(
        conn,
        "SELECT subsystem_id, COUNT(*) AS n, SUM(CASE WHEN status='confirmed-bug' THEN 1 ELSE 0 END) AS open_bugs FROM findings GROUP BY subsystem_id",
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
    sid = s["id"]
    files = rows(
        conn,
        "SELECT file_path, why_in_scope, classification, ref_sha FROM file_ledger WHERE subsystem_id = ? ORDER BY classification, file_path",
        (sid,),
    )
    dispositions = rows(
        conn,
        """
        SELECT d.*, c.category
        FROM dispositions d JOIN concerns c ON c.code = d.concern_code
        WHERE d.subsystem_id = ?
        ORDER BY d.concern_code
        """,
        (sid,),
    )
    findings = rows(
        conn,
        "SELECT * FROM findings WHERE subsystem_id = ? ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END, finding_id",
        (sid,),
    )
    vocab = rows(
        conn,
        "SELECT term, gloss FROM vocabulary WHERE subsystem_id = ? ORDER BY term",
        (sid,),
    )
    xrefs = rows(
        conn,
        "SELECT from_id, to_id, relationship, strength, context FROM xrefs WHERE from_id = ? OR to_id = ? ORDER BY relationship",
        (sid, sid),
    )
    seams = rows(
        conn,
        "SELECT id, shared_object, party_a, party_b FROM seams WHERE party_a = ? OR party_b = ? ORDER BY id",
        (sid, sid),
    )

    # The per-subsystem survey artifact — hand-authored markdown lives in
    # storage root as <ID>-<slug>.md or similar. We look for any registered
    # artifact with kind='subsystem-survey' and this subsystem_id.
    survey_rows = rows(
        conn,
        "SELECT path, content_hash FROM artifacts WHERE kind = 'subsystem-survey' AND subsystem_id = ?",
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
    if s.get("scope"):
        out += ["## Scope", "", s["scope"], ""]
    if s.get("jump_in_reading"):
        out += ["## Start here", "", s["jump_in_reading"], ""]
    if s.get("notes"):
        out += ["## Notes", "", s["notes"], ""]

    if files:
        out += ["## File ledger", "", "| Path | Classification | Why in scope | Ref SHA |", "|---|---|---|---|"]
        for f in files:
            out.append(
                f"| `{f['file_path']}` | {f['classification'] or '—'} | {f['why_in_scope'] or '—'} | "
                f"`{(f['ref_sha'] or '—')[:8]}` |"
            )
        out.append("")

    if dispositions:
        out += [
            "## Concern review",
            "",
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

    if findings:
        out += ["## Findings", ""]
        for f in findings:
            files_cited = json.loads(f["primary_files"]) if f["primary_files"] else []
            out += [
                f"### {f['finding_id']} · {_sev_badge(f['severity'])} · {f['status']}",
                "",
                f"**Symptom**: {f['symptom']}  ",
                f"**Root cause**: {f['root_cause']}",
                "",
            ]
            if f.get("business_context"):
                out += [f"_Business context_: {f['business_context']}", ""]
            if files_cited:
                out += ["**Primary files**:"]
                for fc in files_cited:
                    out.append(f"- `{fc}`")
                out.append("")

    if xrefs:
        out += [
            "## Related subsystems",
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

    if seams:
        out += ["## Seams", "", "| Seam | Shared object | Other party |", "|---|---|---|"]
        for sm in seams:
            other = sm["party_b"] if sm["party_a"] == sid else sm["party_a"]
            out.append(f"| **{sm['id']}** | {sm['shared_object']} | **{other}** |")
        out.append("")

    if vocab:
        out += ["## Vocabulary", ""]
        for v in vocab:
            out.append(f"- **{v['term']}** — {v['gloss']}")
        out.append("")

    if survey_prose:
        out += ["## Survey notes", "", survey_prose]

    text = "\n".join(out).rstrip() + "\n"
    sources: dict[str, str] = (
        _db_source(f"subsystem:{sid}:row", s)
        | _db_source(f"subsystem:{sid}:files", files)
        | _db_source(f"subsystem:{sid}:disp", dispositions)
        | _db_source(f"subsystem:{sid}:findings", findings)
        | _db_source(f"subsystem:{sid}:vocab", vocab)
        | _db_source(f"subsystem:{sid}:xrefs", xrefs)
        | _db_source(f"subsystem:{sid}:seams", seams)
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
        out.append(
            "_No finding is open or awaiting verification. "
            f"{resolved['n'] or 0} resolved record(s) are on "
            "[resolved-findings.md](resolved-findings.md)._"
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
    return "\n".join(out) + "\n", _db_source("findings:open", fs)


def render_resolved_findings(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The History lens for findings: verified, ruled out, and accepted.

    One section per resolution state, newest resolution first within it. A row
    whose state came from the legacy-status fallback has no recorded resolution
    time and sorts last in its section, which is what the store knows.
    """
    fs = _finding_rows(
        conn,
        FINDING_LENS_STATES["resolved-findings.md"],
        "v.resolution_recorded_at DESC, f.subsystem_id, f.finding_id",
    )
    out = ["# Resolved findings", ""]
    if not fs:
        out.append("_No resolution is recorded for any finding._")
    for state in FINDING_LENS_STATES["resolved-findings.md"]:
        state_rows = [f for f in fs if f["resolution_state"] == state]
        if not state_rows:
            continue
        out += [f"## {RESOLUTION_LABELS.get(state, state)}", ""]
        for subsystem_rows in _by_subsystem(state_rows):
            out += _finding_table(subsystem_rows)
    return "\n".join(out) + "\n", _db_source("findings:resolved", fs)


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


def render_contradictions(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    cs = rows(
        conn,
        "SELECT * FROM contradictions ORDER BY CASE resolution WHEN 'unresolved' THEN 0 ELSE 1 END, detected_at DESC",
    )
    out = ["# Contradictions", ""]
    unresolved = [c for c in cs if c["resolution"] == "unresolved"]
    resolved = [c for c in cs if c["resolution"] != "unresolved"]
    out.append(
        "_Contradictions are the conspectus's epistemic honesty surface — when two findings "
        "about the same code disagree, we record the disagreement explicitly instead of silently "
        "choosing one. Unresolved contradictions are a priority signal for the adversarial pass._"
    )
    out.append("")
    if unresolved:
        out += [
            "## Unresolved",
            "",
            "| Finding A | Finding B | Shared location | Conflict type | Detected |",
            "|---|---|---|---|---|",
        ]
        for c in unresolved:
            out.append(
                f"| **{c['finding_a']}** | **{c['finding_b']}** | "
                f"`{c['shared_location'] or '—'}` | {c['conflict_type']} | "
                f"{_fmt_time(c['detected_at'])} |"
            )
        out.append("")
    if resolved:
        out += [
            "## Resolved",
            "",
            "| Finding A | Finding B | Resolution | Scope note |",
            "|---|---|---|---|",
        ]
        for c in resolved:
            out.append(
                f"| **{c['finding_a']}** | **{c['finding_b']}** | {c['resolution']} | "
                f"{(c['scope_note'] or '—').replace('|', '/')} |"
            )
        out.append("")
    if not cs:
        out.append("_No contradictions recorded._")
    return "\n".join(out) + "\n", _db_source("contradictions:all", cs)


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
    return "\n".join(out) + "\n", _db_source("vocab:all", terms)


def render_field_notes(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    notes = rows(
        conn,
        "SELECT * FROM field_notes ORDER BY created_at DESC",
    )
    out = [
        "# Field notes",
        "",
        "_Peripheral observations from every survey pass. Agents record patterns, anomalies, "
        "connections, tensions, and candidate concerns here when they notice something the "
        "phase structure does not ask for. The memory-auditor agent periodically reviews open "
        "notes for promotion to findings or dismissal._",
        "",
    ]
    if not notes:
        out.append("_No field notes recorded._")
    else:
        by_cat: dict[str, list[dict[str, Any]]] = {}
        for n in notes:
            by_cat.setdefault(n["category"], []).append(n)
        for cat in ("tension", "anomaly", "candidate-concern", "connection", "pattern"):
            items = by_cat.get(cat, [])
            if not items:
                continue
            out += [f"## {cat.replace('-', ' ').title()} ({len(items)})", ""]
            for n in items:
                state = "**OPEN**" if n["follow_up"] == "open" else f"→ {n['follow_up']}"
                loc = f" @ `{n['location']}`" if n["location"] else ""
                out.append(
                    f"- [{state}] {n['observation']}{loc} · _{_fmt_time(n['created_at'])}_"
                )
            out.append("")
    return "\n".join(out) + "\n", _db_source("notes:all", notes)



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
        out += [
            "No file is recorded in the ledger, so this projection does not measure"
            " freshness. Nothing below is a claim that the survey is current; it is"
            " a statement that nothing was measured.",
            "",
        ]
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


def render_how_to_read(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The reader's guide. Identical for every conspectus — Amanuensis
    explains how to read its own output so a stranger landing on the
    site understands the vocabulary and the epistemic guarantees
    without having to read the methodology upstream.

    This page is intentionally static (not DB-derived). It is declared
    as a synthetic source so the materializer's diff-aware re-render
    won't touch it unless the renderer itself changes — which is what
    we want.
    """
    del conn  # unused — content is static apart from optional provenance
    body = HOW_TO_READ_BODY
    for optional in ("provenance.md", "entry-point.md"):
        if not (storage / optional).is_file():
            body = body.replace(f"[`{optional}`]({optional})", f"`{optional}`")
    return body, {
        "synthetic:how-to-read": _hash_text(body),
        **_prose_source(storage, "provenance.md"),
        **_prose_source(storage, "entry-point.md"),
    }


HOW_TO_READ_BODY = """\
# How to read this conspectus

An Amanuensis conspectus is a **persistent, evidence-driven
architectural record** of a codebase. This site is the human-facing
view; behind it sits a SQLite database every claim on the site was
generated from. Every assertion carries provenance: who said it, when,
against what commit, with what evidence, at what depth of survey.

This page is shipped automatically with every conspectus. Read it
once; you won't need to read it again.

## What to look at first

| If you're here because… | Start here |
|---|---|
| You've never seen this project before | [`entry-point.md`](entry-point.md) → [`master-plan.md`](master-plan.md) |
| You're investigating a specific bug | [`findings.md`](findings.md), filtered by severity |
| You want to understand the architecture | [`architecture.md`](architecture.md), then a subsystem page |
| You're evaluating how trustworthy this is | [`open-questions.md`](open-questions.md), [`contradictions.md`](contradictions.md), [`diagnosticity.md`](diagnosticity.md) |
| You want to reproduce or extend the survey | [`provenance.md`](provenance.md) (if present) + the repo's git log |

## Reading the status badges

Every subsystem carries a **status** that defines what claims about
it you should accept. This is the knowledge-depth contract — the
methodology's most important epistemic guardrail.

| Status | What claims are authorized |
|---|---|
| `unmapped` | **None.** No assertions about behavior. |
| `scoping` | File scope only: "F is in scope for S." No behavioral claims. |
| `structural` | Types, state containers, data flows, concurrency model. **No correctness claims.** |
| `concerns` | Concern review with evidence. Findings at evidence_quality ≥ code-verified. |
| `adversarial` | As above, plus findings survived attempted refutation. **Highest confidence.** |
| `mapped` | Complete. Seam contracts filled in. Ready for composition with mapped peers. |
| `deferred` | Orthogonal flag: "do not survey yet." Not a knowledge level. |

If you see a confident-sounding claim about a subsystem that is still
`structural`, that's a methodology violation — treat the claim as
speculation. The server enforces this at write time, but readers are
the final check.

## Reading evidence quality

Every disposition and every finding carries an `evidence_quality`
tag that describes how solid the underlying observation is. Higher
quality supports stronger claims.

| Quality | What it means |
|---|---|
| `code-verified` | The reviewer read the code and confirmed the behavior. Strongest. |
| `contract-stated` | An explicit contract (type signature, schema, docstring with semantics) asserts the behavior. |
| `comment-asserted` | A code comment claims the behavior, but the code was not verified against the claim. |
| `name-inferred` | Inferred from a symbol's name (e.g. `sanitizeInput` must sanitize). Weak; needs adversarial review. |
| `pattern-matched` | Fits a pattern we've seen elsewhere. Weakest; used only as a scoping signal. |

Any finding classified `confirmed-bug` should rest on
`code-verified` or `contract-stated` evidence. If you see a
confirmed-bug with `name-inferred` evidence that survived adversarial
review, that's a flag to look closely — either the adversarial pass
was inadequate or the reviewer genuinely had no better evidence and
flagged the finding as linchpin-dependent.

## Reading finding severity

Severity reflects impact, not confidence.

| Severity | Typical shape |
|---|---|
| `CRITICAL` | Data loss, security hole, privilege escalation, production outage path. |
| `HIGH` | Incorrect behavior on a common code path; corrupt state; wedged queues. |
| `MEDIUM` | Incorrect behavior on an edge case; correctness issue with a known workaround. |
| `LOW` | Readability/maintainability; defensive-coding gaps; would bite a future change. |

## Reading finding status

After adversarial review, each finding carries one of:

| Status | What it means |
|---|---|
| `confirmed-bug` | The bug is real at the surveyed commit, survived refutation. |
| `confirmed-acceptable` | The behavior exists but is the intended design — documented as such. |
| `ruled-out` | Claim was made but adversarial review overturned it. Record preserved so future analysts don't re-tread the same ground. |
| `fixed` | Confirmed at the surveyed commit; a later commit has addressed it. |

Note that `ruled-out` findings stay in the record. That's a feature,
not dead wood — if somebody reads a later version of the code and
starts to form the same suspicion, the overturn argument is already
written down.

## Reading open questions

If the conspectus was produced by the autoprogress coordinator
(cloud mode), [`open-questions.md`](open-questions.md) is the queue
of things the agent could not answer without human input. Each entry
records:

- the **question** (what the agent couldn't decide)
- **what it blocked** (the classification or decision that was held up)
- **what the agent assumed** (the best-available interpretation it
  proceeded with)

A small open-question queue, mostly in the `priority-ranking` or
`scope-judgment` categories, means the run was confident. A large
queue weighted toward `domain-knowledge` or `contradiction` means
the survey is walking on thin ice — treat its findings with more
skepticism and plan a focused human pass on those subsystems.

## Reading contradictions

[`contradictions.md`](contradictions.md) pairs findings that make
incompatible claims about the same `file:symbol@sha`. The conspectus
preserves these rather than smoothing them away; an unresolved
contradiction is the most honest thing a survey can say about a
genuinely ambiguous situation.

Resolutions:

- `a-supersedes-b` / `b-supersedes-a` — one claim is now considered
  correct; the other stays on record for traceability.
- `scope-distinction` — both claims are right, about different
  scopes (different inputs, different code paths). The `scope_note`
  explains.
- `unresolved` — the evidence genuinely does not disambiguate.

If you see `unresolved`, that's the survey telling you: "two
credible readings, no way to choose between them yet." That is
information.

## Reading diagnosticity matrices

When two or more concerns could independently explain the same
observable symptom in a subsystem, the coordinator opens a matrix
(the Analysis of Competing Hypotheses pattern). The matrix's columns
are the competing concerns; its rows are pieces of evidence; each
cell records whether that evidence is `consistent`, `contradicts`,
`irrelevant`, or `ambiguous` for that concern.

The methodology ranks concerns by **inconsistency** — the one with
the most contradicting evidence is rejected first — rather than by
supporting evidence, because an evidence base consistent with all
competing explanations tells you nothing. The `leading_concern` on
a resolved matrix is the surviving best explanation; the
`linchpin_note` identifies the single piece of evidence the
resolution most depends on (and therefore the one a reviewer should
re-verify first).

Matrices that resolve to `unresolved-competition` are analogous to
unresolved contradictions: a legitimate terminal state when the
evidence does not disambiguate.

## Provenance

If the conspectus ships with a [`provenance.md`](provenance.md)
page, that is the chronological event log: sessions in order,
findings within sessions in order, with commit SHAs and timestamps.
It's the evidence that the survey was run in the order it claims —
not retroactively curated.

Combined with the git log of the conspectus repo itself (every
phase gate is a commit; every commit is timestamped), provenance is
the strongest claim the methodology can make about its own honesty.

## Reproducing what you're reading

Anyone with:

- the surveyed codebase's commit SHA (the `ref_sha` on findings and
  evidence),
- the Amanuensis version that ran the survey (captured in commit
  messages on the conspectus repo), and
- sufficient API budget to drive an LLM through the same phases

…can replay the survey and see whether their conclusions overlap
with these. Non-determinism in the LLM means the two runs won't be
identical; structural overlap is the expected property, and the
[`compare_conspectuses`](https://github.com/search?q=compare_conspectuses)
tool in the Amanuensis server measures it.

## If something here looks wrong

Say so. The conspectus treats reader-surfaced disagreement as a
first-class signal: a reviewer who disagrees with a finding should
open an issue against this conspectus repo; the next survey session
records the disagreement as a field note or converts it into a
diagnosticity matrix if the reviewer's argument looks credible
enough to compete with the existing finding.

A methodology that refuses to hear its readers is one that should
not be trusted.
"""


def _hash_text(s: str) -> str:
    return sha256(s.encode("utf-8")).hexdigest()[:16]


def render_open_questions(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """Queue of items the autoprogress coordinator could not decide
    without human input. In cloud runs this page IS the human's
    intervention point — a reviewer works through the open entries,
    answers what they can, and dismisses what's no longer relevant.
    """
    del storage  # unused — kept for renderer signature uniformity
    # Include resolved rows too, grouped separately, so the page serves
    # as an audit trail after review.
    questions = rows(
        conn,
        "SELECT * FROM open_questions ORDER BY resolution = 'open' DESC, created_at DESC",
    )
    out = [
        "# Open questions",
        "",
        "_Items the autoprogress coordinator could not decide without human input. "
        "Each entry records the question, what the agent could not do because of it, "
        "and what assumption (if any) the agent proceeded with. Close out via "
        "`resolve_open_question` once answered; the reviewer's answers can feed back "
        "into a `reset_subsystem` + re-survey if the assumption turned out wrong._",
        "",
    ]
    if not questions:
        out.append("_No open questions recorded. Either the survey is pristine, or it hasn't run yet._")
        return "\n".join(out) + "\n", _db_source("open_questions:all", questions)

    by_state: dict[str, list[dict[str, Any]]] = {"open": [], "other": []}
    for q in questions:
        by_state["open" if q["resolution"] == "open" else "other"].append(q)

    if by_state["open"]:
        out += [f"## Open ({len(by_state['open'])})", ""]
        # Group by category within open — the reviewer usually wants to
        # batch similar questions.
        by_cat: dict[str, list[dict[str, Any]]] = {}
        for q in by_state["open"]:
            by_cat.setdefault(q["category"], []).append(q)
        category_order = (
            "contradiction",
            "domain-knowledge",
            "scope-judgment",
            "ambiguous-evidence",
            "priority-ranking",
            "tooling-limit",
            "other",
        )
        for cat in category_order:
            items = by_cat.get(cat, [])
            if not items:
                continue
            out += [f"### {cat.replace('-', ' ').title()} ({len(items)})", ""]
            for q in items:
                loc = f" · subsystem `{q['subsystem_id']}`" if q["subsystem_id"] else ""
                phase = f" · phase `{q['phase']}`" if q["phase"] else ""
                out.append(f"#### #{q['id']}{loc}{phase}")
                out.append("")
                out.append(f"> {q['question']}")
                out.append("")
                if q["what_blocked"]:
                    out.append(f"- **What this blocked:** {q['what_blocked']}")
                if q["what_assumed"]:
                    out.append(f"- **Assumption the agent proceeded with:** {q['what_assumed']}")
                out.append(f"- _recorded {_fmt_time(q['created_at'])}_")
                out.append("")

    if by_state["other"]:
        out += [f"## Resolved ({len(by_state['other'])})", ""]
        out += ["| # | Category | Question | Resolution | Answer |", "|---|---|---|---|---|"]
        for q in by_state["other"]:
            answer = (q["answer"] or "").replace("|", "\\|").replace("\n", " ") if q["answer"] else ""
            qtxt = q["question"].replace("|", "\\|").replace("\n", " ")
            out.append(f"| #{q['id']} | {q['category']} | {qtxt} | {q['resolution']} | {answer} |")
        out.append("")

    return "\n".join(out) + "\n", _db_source("open_questions:all", questions)


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
