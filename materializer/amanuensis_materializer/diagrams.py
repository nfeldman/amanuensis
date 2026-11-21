"""Architecture projection generation from recorded survey state.

Every diagram is a pure function of DB rows — no relationships are inferred
from names. Each section is built as page-model blocks; no Markdown is written.
"""
from __future__ import annotations

import re
import sqlite3
import textwrap
from collections.abc import Callable, Sequence
from html import escape
from typing import Any

from .db import row, rows, table_exists
from .page import (
    COVERAGE_STATES,
    EMPTY,
    Atlas,
    AtlasItem,
    AtlasRegion,
    Badge,
    BadgeNote,
    Block,
    BoundaryDiagram,
    BoundaryRow,
    Chip,
    CoverageIndex,
    CoverageReview,
    CoverageRow,
    Diagram,
    DiagramEdge,
    DiagramNode,
    Inlines,
    Paragraph,
    Row,
    RuntimeDiagram,
    RuntimeRow,
    StalenessBars,
    Table,
    Topology,
    TopologyEdge,
)
from .prose import _plain, inlines
from .slugs import subsystem_page

# The obligation predicate is generated from the `obligation_bearing` flag on
# each file_classification value in contracts/conspectus-vocabulary.json, so the
# server and the projection cannot disagree about which scoped files carry work.
from .vocabulary import OBLIGATION_BEARING_SQL as _OBLIGATION_BEARING
from .vocabulary import (
    STATUS_PREREQUISITES,
    SURVEY_PASSES,
    VOCABULARY,
    VOCABULARY_CONTRACT_VERSION,
    labels,
    values_of,
)

# An atlas prints a depth's contract label, as the HTML chip does, never the
# stored value.
_DEPTH_LABELS = labels("subsystem_status")


def _safe_label(text: str) -> str:
    # Mermaid doesn't like pipes or newlines inside node labels.
    return text.replace("|", "/").replace("\n", " ").replace('"', "'")


# The two headings the architecture page's first topology section can carry.
# The heading and the body are one decision (§9.2): a page headed "dependency
# graph" over an atlas would assert edges nobody recorded, so `render_architecture`
# takes both from `dependency_section` rather than re-deciding on its own read of
# `xrefs`.
DEPENDENCY_HEADING = "Subsystem dependency graph"
ATLAS_HEADING = "Subsystem atlas"


def _edge_coverage_sentence(covered: int, total: int) -> str:
    """State how much of the recorded subsystem set the recorded edges reach.

    A dependency table shows only the subsystems some edge names. Without the
    census a reader cannot tell a subsystem with no dependencies from one whose
    edges were never recorded, and the table reads as a complete graph.
    """
    if total == 0:
        return ""
    uncovered = total - covered
    if uncovered == 0:
        return (
            f"_All {total} recorded subsystems carry at least one recorded edge. No edge"
            " below is inferred from a name, a prefix, or a nearby seam._"
        )
    verb = "carries" if uncovered == 1 else "carry"
    return (
        f"_{uncovered} of {total} recorded subsystems {verb} no recorded edge; the table"
        " below is what the survey recorded, not the whole dependency surface. No edge is"
        " inferred from a name, a prefix, or a nearby seam._"
    )


#: The architecture page's boundary section. The HTML recognises the table by
#: these four headers and draws it as an SVG, as it does the runtime table.
BOUNDARY_HEADING = "Recorded boundaries"
BOUNDARY_COLUMNS = ("Layer", "Subsystem", "Boundary", "Other end")
#: What the section says when no seam or xref joins two recorded subsystems.
BOUNDARY_NONE = "No boundary between subsystems is recorded, so no diagram is drawn."


def boundary_relations(conn: sqlite3.Connection) -> dict[str, Any]:
    """Nodes, edges and layer order for the recorded-boundary diagram (§2.5).

    Layers are in the order the Subsystem map lists them (`ORDER BY layer`, a
    missing layer headed "unlayered"); nodes are in ID order within a layer.
    Edges are the recorded seams and `xrefs` and nothing else. A relation that
    names one subsystem twice, or an ID no `subsystems` row carries, has no
    pair of boxes to join, so it is counted in `not_drawn` instead.
    """
    layers: dict[str, list[dict[str, str]]] = {}
    for s in rows(conn, "SELECT id, name, layer FROM subsystems ORDER BY layer, id"):
        layer = s["layer"] or "unlayered"
        layers.setdefault(layer, []).append(
            {"id": str(s["id"]), "name": str(s["name"]), "layer": layer}
        )
    nodes = [node for layer in layers.values() for node in sorted(layer, key=lambda n: n["id"])]
    known = {node["id"] for node in nodes}
    candidates = [
        {"kind": "seam", "label": str(s["id"]), "from": str(s["party_a"]), "to": str(s["party_b"])}
        for s in rows(conn, "SELECT id, party_a, party_b FROM seams ORDER BY id")
    ] + [
        {"kind": "xref", "label": str(x["relationship"]), "from": str(x["from_id"]), "to": str(x["to_id"])}
        for x in rows(
            conn, "SELECT from_id, to_id, relationship FROM xrefs ORDER BY from_id, to_id, relationship"
        )
    ]
    edges = [
        edge
        for edge in candidates
        if edge["from"] in known and edge["to"] in known and edge["from"] != edge["to"]
    ]
    return {
        "layers": list(layers),
        "nodes": nodes,
        "edges": edges,
        "not_drawn": len(candidates) - len(edges),
    }


def boundary_edge_record(edge: dict[str, Any]) -> str:
    """The record a drawn boundary line names: its seam, or its xref's two ends and relationship."""

    if edge["kind"] == "seam":
        return f"seam:{edge['label']}"
    return f"xref:{edge['from']}>{edge['to']}:{edge['label']}"


def _no_boundary_sentence(unconnected: int, total: int) -> str:
    verb = "has" if unconnected == 1 else "have"
    noun = "subsystem" if total == 1 else "subsystems"
    return f"{unconnected} of {total} {noun} {verb} no recorded boundary."


RUNTIME_BOUNDARY_COLUMNS = (
    "Runtime / Process",
    "Language",
    "Communicates with",
    "Mechanism",
    "Notes",
)
_RUNTIME_BOUNDARY_HEADERS = tuple(column.lower() for column in RUNTIME_BOUNDARY_COLUMNS)

#: What the architecture page says while the onboarding record holds no table.
#: The page prints it between underscores; the census names the same state.
RUNTIME_BOUNDARY_ABSENT = "No structured runtime boundary map is recorded yet."


def _table_cells(line: str) -> list[str]:
    """A table row's cells, split on unescaped pipes; an escaped `\\|` is a pipe in its cell."""
    cells = re.split(r"(?<!\\)\|", line.strip().strip("|"))
    return [cell.strip().replace("\\|", "|") for cell in cells]


def _runtime_boundary_table(markdown: str) -> str | None:
    """Extract the typed runtime table without interpreting its relationships."""
    lines = markdown.splitlines()
    heading_index = next(
        (
            index
            for index, line in enumerate(lines)
            if re.fullmatch(r"#{1,6}\s+Runtime boundary map\s*", line, re.IGNORECASE)
        ),
        None,
    )
    if heading_index is None:
        return None

    index = heading_index + 1
    while index < len(lines) and not lines[index].strip():
        index += 1
    if index + 1 >= len(lines):
        return None

    headers = tuple(cell.lower() for cell in _table_cells(lines[index]))
    separator = _table_cells(lines[index + 1])
    if headers != _RUNTIME_BOUNDARY_HEADERS or not separator or not all(
        re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in separator
    ):
        return None

    table_lines = [lines[index], lines[index + 1]]
    index += 2
    while index < len(lines) and lines[index].lstrip().startswith("|"):
        table_lines.append(lines[index])
        index += 1
    return "\n".join(table_lines) if len(table_lines) > 2 else None


def _cell(value: object) -> str:
    """One table cell: a row's text on one line, with no pipe to split it."""

    return " ".join(str(value or "").replace("|", "/").split())


def runtime_boundary_rows(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """The effective runtime boundaries: the newest row per edge, none withdrawn.

    An edge is `(from_runtime, to_runtime, mechanism)`. A later row replaces an
    earlier one, and a row with `withdrawn = 1` retracts the edge. Edges keep the
    order in which they were first recorded, so a replacement does not move one.
    """

    if not table_exists(conn, "runtime_boundaries"):
        return []
    newest: dict[tuple[str, str, str], dict[str, Any]] = {}
    first: dict[tuple[str, str, str], int] = {}
    for record in rows(conn, "SELECT * FROM runtime_boundaries ORDER BY id"):
        edge = (record["from_runtime"], record["to_runtime"], record["mechanism"])
        newest[edge] = record
        first.setdefault(edge, int(record["id"]))
    return [
        newest[edge]
        for edge in sorted(newest, key=lambda edge: first[edge])
        if not int(newest[edge]["withdrawn"])
    ]


def runtime_edge_record(edge: dict[str, Any]) -> str:
    """The record a drawn runtime edge names: the boundary row in force (§3.5)."""

    return f"runtime-boundary:{edge['id']}"


def runtime_node(value: object) -> str:
    """A drawn runtime's name, as the store holds it on one line."""

    return " ".join(str(value or "").split())


#: What the page says of the rows the import copied from the onboarding report:
#: they are as written, and no evidence ties them to the code (store-only PLAN §8 SO9).
IMPORTED_RUNTIME_LABEL = "Imported from the onboarding report and not tied to evidence:"


def imported_runtime_line(edges: list[dict[str, Any]]) -> str | None:
    """The sentence that labels the imported rows of the table, or None when there are none.

    The rows keep the cells they were recorded with, so the label names the edges
    instead of changing a cell: the drawing and the table stay what the store holds.
    """

    imported = [edge for edge in edges if str(edge["origin"]) == "imported"]
    if not imported:
        return None
    named = "; ".join(
        f"{_cell(edge['from_runtime'])} → {_cell(edge['to_runtime'])} by {_cell(edge['mechanism'])}"
        for edge in imported
    )
    return f"{IMPORTED_RUNTIME_LABEL} {named}."


def runtime_boundary_state(conn: sqlite3.Connection) -> str:
    """`recorded` or `absent`: the one answer the page and the census both read."""
    return "recorded" if runtime_boundary_rows(conn) else "absent"


# ---------------------------------------------------------------------------
# The sections as page blocks (store-only PLAN §3.1), built from the rows. The
# architecture page prints these. Each takes the caption its section names.
# ---------------------------------------------------------------------------


def _sentence(text: str) -> Paragraph:
    return Paragraph(inlines(text))


def _linked_subsystem(sid: str, name: str) -> Inlines:
    """`**[ID](page)** Name`, the cell every table of subsystems opens its rows with."""

    return inlines(f"**[{sid}]({subsystem_page(sid, name)})** {_safe_label(name)}")


def _dependency_rows(conn: sqlite3.Connection) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    edges = rows(
        conn,
        "SELECT from_id, to_id, relationship, strength, context FROM xrefs ORDER BY from_id",
    )
    return edges, {r["id"]: r for r in rows(conn, "SELECT id, name, status, layer FROM subsystems")}


def dependency_section(
    conn: sqlite3.Connection, caption: Callable[[str], str]
) -> tuple[str, tuple[Block, ...]]:
    """The dependency section's heading and body, decided by one read of the rows (§9.2)."""

    edges, subs = _dependency_rows(conn)
    heading = DEPENDENCY_HEADING if edges else ATLAS_HEADING
    return heading, _dependency_blocks(edges, subs, caption(heading), conn if not edges else None)


def dependency_blocks(conn: sqlite3.Connection, caption: str) -> tuple[Block, ...]:
    """The dependency section's body: the atlas when no edge is recorded, else the edge table."""

    edges, subs = _dependency_rows(conn)
    return _dependency_blocks(edges, subs, caption, conn if not edges else None)


def _dependency_blocks(
    edges: list[dict[str, Any]],
    subs: dict[str, dict[str, Any]],
    caption: str,
    conn: sqlite3.Connection | None = None,
) -> tuple[Block, ...]:
    if not subs and not edges:
        return (_sentence("_No subsystems recorded yet._"),)
    if not edges:
        badges = finding_badges(conn) if conn is not None else {}
        regions: dict[str, list[AtlasItem]] = {}
        for sid, subsystem in sorted(
            subs.items(), key=lambda item: ((item[1].get("layer") or "Other"), item[0])
        ):
            region = _plain(_safe_label(subsystem.get("layer") or "Other")) or "Other"
            label = _DEPTH_LABELS.get(subsystem["status"], subsystem["status"])
            regions.setdefault(region, []).append(
                AtlasItem(
                    _linked_subsystem(sid, subsystem["name"]),
                    depth_cell(label),
                    record=f"subsystem:{sid}",
                    state=str(subsystem["status"]),
                    badges=badges.get(sid, ()),
                )
            )
        return (
            _sentence(
                "_No dependency edges are recorded in this publication. The layer map below is a subsystem atlas, not an inferred dependency graph._"
            ),
            Atlas(caption, tuple(AtlasRegion(name, tuple(items)) for name, items in regions.items())),
            *(badge_note(conn, badges) if conn is not None else ()),
        )

    covered = {
        endpoint
        for edge in edges
        for endpoint in (edge["from_id"], edge["to_id"])
        if endpoint in subs
    }
    census = _edge_coverage_sentence(len(covered), len(subs))
    topology: list[TopologyEdge] = []
    for edge in edges:
        from_name = subs.get(edge["from_id"], {"name": edge["from_id"]})["name"]
        to_name = subs.get(edge["to_id"], {"name": edge["to_id"]})["name"]
        topology.append(
            TopologyEdge(
                key=inlines(_safe_label(edge["relationship"])),
                left_id=edge["from_id"],
                left=_linked_subsystem(edge["from_id"], from_name),
                right_id=edge["to_id"],
                right=_linked_subsystem(edge["to_id"], to_name),
                detail=inlines(_safe_label(edge.get("context") or "No additional context recorded")),
                qualifier=inlines(str(edge["strength"])),
                directed=True,
            )
        )
    return (*((_sentence(census),) if census else ()), Topology("dependency", caption, tuple(topology)))


def boundary_blocks(conn: sqlite3.Connection, caption: str) -> tuple[Block, ...]:
    """The boundary section's body: a sentence, or the census and the boundary diagram's rows."""

    graph = boundary_relations(conn)
    nodes, edges = graph["nodes"], graph["edges"]
    if not nodes:
        return (_sentence("_No subsystems recorded yet._"),)
    touching: dict[str, list[tuple[str, str, str, str]]] = {node["id"]: [] for node in nodes}
    for edge in edges:
        record = boundary_edge_record(edge)
        if edge["kind"] == "seam":
            label = edge["label"]
            touching[edge["from"]].append((f"{label} seam", label, edge["to"], record))
            touching[edge["to"]].append((f"{label} seam", label, edge["from"], record))
        else:
            relationship = _safe_label(edge["label"])
            touching[edge["from"]].append((f"{relationship} →", "", edge["to"], record))
            touching[edge["to"]].append((f"← {relationship}", "", edge["from"], record))
    census = _no_boundary_sentence(sum(1 for found in touching.values() if not found), len(nodes))
    not_drawn = graph["not_drawn"]
    skipped = (
        f" {not_drawn} recorded relation{' names' if not_drawn == 1 else 's name'} one subsystem"
        " twice or a subsystem with no record, and is not drawn."
        if not_drawn
        else ""
    )
    if not edges:
        return (_sentence(f"_{BOUNDARY_NONE} {census}{skipped}_"),)

    kinds = []
    if any(edge["kind"] == "seam" for edge in edges):
        kinds.append("seam")
    if any(edge["kind"] == "xref" for edge in edges):
        kinds.append("recorded dependency")
    names = {node["id"]: node["name"] for node in nodes}
    badges = finding_badges(conn)
    rows_out: list[BoundaryRow] = []
    for node in nodes:
        sid = node["id"]
        layer = _plain(_safe_label(node["layer"])) or "unlayered"
        for boundary, seam_id, other, record in touching[sid] or [("none recorded", "", "", "")]:
            rows_out.append(
                BoundaryRow(
                    layer=layer,
                    subsystem_id=sid,
                    name=_plain(_safe_label(names[sid])),
                    other_id=other,
                    relation=boundary,
                    seam=bool(seam_id),
                    seam_id=seam_id,
                    record=record,
                    badges=badges.get(sid, ()),
                )
            )
    return (
        _sentence(
            f"_{census} Each {' and each '.join(kinds)} below joins two recorded subsystems;"
            f" no line is inferred from a name or a layer.{skipped}_"
        ),
        BoundaryDiagram(caption, tuple(rows_out)),
        *badge_note(conn, badges),
    )


def coverage_blocks(conn: sqlite3.Connection) -> tuple[Block, ...]:
    """The review-coverage heatmap's body: every subsystem against every active concern.

    Each cell is the outcome recorded for the pair (its mark and label come from
    `COVERAGE_STATES`) and whether it leans on a linchpin; a pair nobody assessed
    has no cell. The row's link is the reference pass's to give.
    """

    ss = rows(conn, "SELECT id, name, status FROM subsystems ORDER BY id")
    cn = rows(
        conn,
        "SELECT code, category FROM concerns WHERE status='active' ORDER BY code",
    )
    if not ss or not cn:
        return (_sentence("_Heatmap requires at least one subsystem and one active concern._"),)
    disp = rows(
        conn,
        "SELECT subsystem_id, concern_code, classification, linchpin_dependent FROM dispositions",
    )
    key = {(d["subsystem_id"], d["concern_code"]): d for d in disp}
    states = {state[0]: state for state in COVERAGE_STATES}
    out: list[CoverageRow] = []
    for s in ss:
        reviews: list[CoverageReview] = []
        for c in cn:
            d = key.get((s["id"], c["code"]))
            if not d:
                continue
            state = states.get(d["classification"])
            reviews.append(
                CoverageReview(
                    c["code"],
                    state[0] if state else "unknown",
                    state[1] if state else "Recorded outcome",
                    state[2] if state else "?",
                    bool(d["linchpin_dependent"]),
                )
            )
        name = _plain(f"**{s['id']}** {s['name']}")
        if name.startswith(s["id"]):
            name = name[len(s["id"]) :].strip()
        out.append(CoverageRow(s["id"], name or s["id"], None, tuple(reviews)))
    return (CoverageIndex(tuple(c["code"] for c in cn), tuple(out)),)


def seam_blocks(conn: sqlite3.Connection, caption: str) -> tuple[Block, ...]:
    """Seams as the topology block the HTML draws as connected areas."""

    seams = rows(conn, "SELECT * FROM seams ORDER BY id")
    if not seams:
        return (_sentence("_No seams recorded yet._"),)
    subs = {r["id"]: r for r in rows(conn, "SELECT id, name FROM subsystems")}
    edges: list[TopologyEdge] = []
    for s in seams:
        name_a = subs.get(s["party_a"], {}).get("name", s["party_a"])
        name_b = subs.get(s["party_b"], {}).get("name", s["party_b"])
        edges.append(
            TopologyEdge(
                key=inlines(f"**[{s['id']}](seams.html#{s['id'].lower()})**"),
                left_id=s["party_a"],
                left=_linked_subsystem(s["party_a"], name_a),
                right_id=s["party_b"],
                right=_linked_subsystem(s["party_b"], name_b),
                detail=inlines(_safe_label(s["shared_object"])),
                qualifier=EMPTY,
                directed=False,
            )
        )
    return (Topology("seam", caption, tuple(edges)),)


def staleness_blocks(conn: sqlite3.Connection) -> tuple[Block, ...]:
    """The staleness section's body: bars of stale files per subsystem, or what is not measured.


    An empty result is reported as absent measurement, not as health: a
    projection cannot tell a conspectus with nothing stale from one where
    nothing ever recorded staleness, so it must not assert the stronger of
    the two. Staleness is read from `file_ledger`.
    """
    # The materializer reads databases it does not own and may run against a
    # store written before staleness moved onto the ledger. A missing column is
    # an unmeasured conspectus, not a broken projection — turning the whole
    # publish red here would be a worse failure than reporting absence.
    if not any(
        column["name"] == "stale" for column in rows(conn, "PRAGMA table_info(file_ledger)")
    ):
        return (
            _sentence(
                "_No staleness data recorded. This conspectus predates ledger-derived "
                "staleness, so this view reports absence of measurement rather than "
                "freshness; the next reconciliation will populate it._"
            ),
        )
    rs = rows(
        conn,
        "SELECT subsystem_id, COUNT(*) AS n FROM file_ledger"
        " WHERE stale = 1 AND " + _OBLIGATION_BEARING + " GROUP BY subsystem_id ORDER BY n DESC",
    )
    if rs:
        return (StalenessBars(tuple((str(r["subsystem_id"]), float(r["n"])) for r in rs)),)
    measured = rows(conn, "SELECT COUNT(*) AS n FROM file_ledger WHERE " + _OBLIGATION_BEARING)
    scoped = measured[0]["n"] if measured else 0
    if not scoped:
        return (
            _sentence(
                "_No staleness data recorded. No files have been scoped, so this "
                "view reports absence of measurement rather than freshness._"
            ),
        )
    return (
        _sentence(
            f"_No stale files across {scoped} scoped file"
            f"{'' if scoped == 1 else 's'} carrying a survey obligation, at the last"
            " reconciliation._"
        ),
    )


def runtime_boundary_blocks(conn: sqlite3.Connection, caption: str) -> tuple[Block, ...]:
    """The runtime section's body: the recorded edges as the runtime diagram's rows."""

    edges = runtime_boundary_rows(conn)
    if not edges:
        return (_sentence(f"_{RUNTIME_BOUNDARY_ABSENT}_"),)
    label = imported_runtime_line(edges)
    return (
        _sentence(
            "_Projected from the recorded runtime boundaries; mechanisms and targets"
            " are preserved as recorded._"
        ),
        RuntimeDiagram(
            caption,
            tuple(
                RuntimeRow(
                    *(
                        inlines(" ".join(str(cell or "").split()))
                        for cell in (
                            edge["from_runtime"],
                            edge["from_language"],
                            edge["to_runtime"],
                            edge["mechanism"],
                            edge["notes"],
                        )
                    ),
                    record=runtime_edge_record(edge),
                    source_node=runtime_node(edge["from_runtime"]),
                    target_node=runtime_node(edge["to_runtime"]),
                )
                for edge in edges
            ),
        ),
        *((_sentence(label),) if label else ()),
    )


def depth_cell(label: str) -> Inlines:
    """A survey-depth label as its status chip, as the atlas prints it."""

    for value, name in _DEPTH_LABELS.items():
        if name.lower() == _plain(label).lower():
            return Inlines((Chip("status", value),), _plain(label))
    return inlines(label)


# ---------------------------------------------------------------------------
# The hot-spots measures (store-only PLAN §7.6), shared by the Hot spots page and the
# finding badges (A4) so a badge can never count what the table does not.
# ---------------------------------------------------------------------------


def hot_spot_access(conn: sqlite3.Connection) -> dict[str, int]:
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


def hot_spot_measures(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """One dict per subsystem, in ID order: nine separate measures, none combined with another."""

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
        f" COALESCE(stale,0) AS stale FROM file_ledger WHERE {_OBLIGATION_BEARING}",
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
    access = hot_spot_access(conn)

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
    return measures


#: A4's measures, in the order a subsystem's badges print: the badge key, the Hot spots
#: measure it is read from, the short mark on the boundary diagram, and its words.
BADGE_MEASURES = (
    ("crit-high", "crit_high", "C+H", "open critical or high"),
    ("med-low", "med_low", "M+L", "open medium or low"),
    ("awaiting", "awaiting", "V", "awaiting verification"),
    ("undiscriminated", "undiscriminated", "U", "undiscriminated"),
)
#: Appendix B rule 2: finding badges come from `concerns` up; the first two are still under review.
BADGE_FROM = ("concerns", "adversarial", "mapped")
UNDER_REVIEW = ("concerns", "adversarial")


def finding_badges(
    conn: sqlite3.Connection, measures: Sequence[dict[str, Any]] | None = None
) -> dict[str, tuple[Badge, ...]]:
    """A4: each subsystem's open-finding counts as badges, from the Hot spots measures (§7.6).

    One badge per measure, never merged. A zero count draws nothing: no badge says "clean",
    because an absent count is not a verdict. A subsystem below `concerns` has none, since a
    verdict badge before the concerns pass would assert a review nobody did.
    """

    measures = hot_spot_measures(conn) if measures is None else measures
    status = {str(r["id"]): str(r["status"] or "unmapped") for r in rows(conn, "SELECT id, status FROM subsystems")}
    out: dict[str, tuple[Badge, ...]] = {}
    for m in measures:
        sid = str(m["id"])
        if status.get(sid) not in BADGE_FROM:
            continue
        found = tuple(
            Badge(key, int(m[field]), short, f"{int(m[field])} {words}", status[sid] in UNDER_REVIEW)
            for key, field, short, words in BADGE_MEASURES
            if int(m[field]) > 0
        )
        if found:
            out[sid] = found
    return out


def badge_note(conn: sqlite3.Connection, badges: dict[str, tuple[Badge, ...]]) -> tuple[Block, ...]:
    """The sentence under a surface that draws badges: what they count, and what no badge means."""

    if not badges:
        return ()
    eligible = [r for r in rows(conn, "SELECT status FROM subsystems") if str(r["status"]) in BADGE_FROM]
    bare = len(eligible) - len(badges)
    review = any(b.review for found in badges.values() for b in found)
    return (
        BadgeNote(
            "Each badge is one count from the Hot spots page: open critical or high (C+H), open medium or low (M+L),"
            " awaiting verification (V), undiscriminated (U). Subsystems below Concerns carry none."
            + (" Those at Concerns or Adversarial are under review." if review else "")
            + f" {bare} of {len(eligible)} subsystems at Concerns or above show no badge: nothing is counted for"
            " them, which is not a verdict that they are clean."
        ),
    )


# ---------------------------------------------------------------------------
# Diagram primitives (store-only PLAN §7, Appendix B).
#
# A diagram is a pure function of records, never of names or of the renderer's own
# knowledge. Each model function returns a `Diagram`: nodes and edges that each
# name the record they draw, and an account that says the same in words. `draw_svg`
# lays a model out on a grid, in fixed order, with no layout engine and no script;
# every box is `<g data-node>` and every arrow `<path data-edge>`, so the read-back
# can count what was drawn against what the store holds.
# ---------------------------------------------------------------------------

VIEW_WIDTH = 960
KIND_SEAM = "seam-contract"
KIND_FLOW = "flow-strip"
#: Marks a diagram needs before it is worth drawing (Appendix B rule 11).
MIN_PASSES = 2
MIN_RUNGS = 2
#: Moves a ladder draws; past this they are listed and not drawn.
MAX_MOVES = 24

_WHEN = {"end": "when the pass is done", "start": "as the pass starts"}
_DASH = {"dashed": "5 3", "dotted": "1.5 3"}


def _depths() -> list[dict[str, Any]]:
    return [dict(v) for v in VOCABULARY["subsystem_status"]["values"]]  # type: ignore[union-attr,index]


def _checks_for(status: str) -> list[str]:
    for rung in STATUS_PREREQUISITES:
        if rung["status"] == status:
            return [str(need["what"]) for need in rung["requires"]]  # type: ignore[union-attr,index]
    return []


def _count(n: int, noun: str) -> str:
    return f"{n} {noun}" if n == 1 else f"{n} {noun}s"


def survey_workflow_model(
    passes: Sequence[dict[str, Any]] | None = None,
    prerequisites: Sequence[dict[str, Any]] | None = None,
) -> Diagram:
    """B1: how a subsystem survey runs, in three lanes: the agent, the server, you.

    The agent lane has a box per pass, in the contract's order. The server lane has a
    box under each pass whose depth the server checks before it is set. Your lane has a
    box after each pass that tells you something. Nothing is drawn that
    `survey_passes` and `status_prerequisites` do not hold.
    """

    spec = [dict(p) for p in (SURVEY_PASSES if passes is None else passes)]
    needs = [dict(r) for r in (STATUS_PREREQUISITES if prerequisites is None else prerequisites)]
    caption = "Who does what while one subsystem is surveyed, and when the server and you come in?"
    title = "How a survey runs"
    if len(spec) < MIN_PASSES:
        return Diagram(
            "survey-workflow", "", title, caption,
            below=f"The contract records {_count(len(spec), 'survey pass')}, too few to draw how a survey runs.",
            read_at=f"Read from the vocabulary contract, version {VOCABULARY_CONTRACT_VERSION}.",
        )
    labels_by_status = {v["value"]: v["label"] for v in _depths()}
    ruled = {str(r["status"]): [str(n["what"]) for n in r["requires"]] for r in needs}
    nodes: list[DiagramNode] = []
    edges: list[DiagramEdge] = []
    items: list[tuple[str, str]] = []
    unchecked: list[str] = []
    told = 0
    for column, p in enumerate(spec):
        phase, status = p["phase"], str(p["status"])
        label = labels_by_status.get(status, status)
        pass_id = f"survey-workflow-pass-{phase}"
        nodes.append(DiagramNode(f"survey-pass:{phase}", str(p["pass"]), 0, column, f"Pass {phase}", href=f"#{pass_id}"))
        if column:
            edges.append(DiagramEdge(f"pass-order:{spec[column - 1]['phase']}:{phase}", f"survey-pass:{spec[column - 1]['phase']}", f"survey-pass:{phase}"))
        checks = ruled.get(status, [])
        if checks:
            nodes.append(DiagramNode(f"status-check:{status}", "Server checks", 1, column, f"{_count(len(checks), 'check')} for {label}", href=f"#{pass_id}"))
            edges.append(DiagramEdge(f"pass-check:{status}", f"survey-pass:{phase}", f"status-check:{status}"))
        else:
            unchecked.append(str(p["pass"]))
        checkpoint = str(p.get("checkpoint") or "").strip()
        if checkpoint:
            told += 1
            nodes.append(DiagramNode(f"checkpoint:{status}", "Your checkpoint", 2, column + 1, "Summary in your chat", href=f"#survey-workflow-checkpoint-{phase}"))
            edges.append(DiagramEdge(f"pass-checkpoint:{status}", f"survey-pass:{phase}", f"checkpoint:{status}"))
        sentence = f"{p['pass']} (pass {phase}). {p['does']} It sets {label} {_WHEN.get(str(p['set_when']), str(p['set_when']))}."
        sentence += f" The server checks: {'; '.join(c.rstrip('.') for c in checks)}." if checks else " The server checks nothing before it."
        items.append((pass_id, sentence))
        if checkpoint:
            items.append((f"survey-workflow-checkpoint-{phase}", f"After {p['pass']}: {checkpoint}"))
    absent = len(unchecked)
    account = (
        "The agent does each pass in order and does not wait for approval between them. "
        "The server answers only when a depth is set: it refuses the move unless the checks below it hold. "
        "You are told at the checkpoints; the site itself is read-only.",
        f"{absent} of {len(spec)} passes {'has' if absent == 1 else 'have'} no server check"
        + (f" ({', '.join(unchecked)})." if unchecked else ".")
        + f" {told} of {len(spec)} {'pass tells' if told == 1 else 'passes tell'} you something when {'it is' if told == 1 else 'they are'} done.",
    )
    return Diagram(
        "survey-workflow", "", title, caption, ("Agent", "Server", "You"), tuple(nodes), tuple(edges), account, tuple(items),
        read_at=f"Read from the vocabulary contract, version {VOCABULARY_CONTRACT_VERSION}.",
    )


def status_ladder_model(
    conn: sqlite3.Connection | None = None,
    subsystem_id: str | None = None,
    rungs: Sequence[dict[str, Any]] | None = None,
    guide_href: str = "",
) -> Diagram:
    """B2: the survey depths as a ladder; for one subsystem, where it stands and the moves it made.

    Rungs and the server's checks come from the contract. `deferred` is drawn beside
    the ladder, never as a rung. With a subsystem, the marker is its current depth and
    each `subsystem_status_transitions` row is an arrow; a subsystem with no row says its
    history was not recorded rather than drawing a climb nobody recorded.
    """

    depths = _depths()
    steps = [dict(r) for r in rungs] if rungs is not None else [d for d in depths if d["value"] != "deferred"]
    parked = next((d for d in depths if d["value"] == "deferred"), {"value": "deferred", "label": "Deferred", "meaning": ""})
    subject = str(subsystem_id) if conn is not None and subsystem_id is not None else ""
    caption = (
        f"Where does {subject} stand in the survey, and how did it get there?" if subject
        else "What are the survey depths, and what does the server ask before each?"
    )
    title = f"Survey depth of {subject}" if subject else "The survey depths"
    revision_note = f"Read from the vocabulary contract, version {VOCABULARY_CONTRACT_VERSION}."
    if len(steps) < MIN_RUNGS:
        return Diagram(
            "status-ladder", subject, title, caption,
            below=f"The contract records {_count(len(steps), 'survey depth')}, too few to draw a ladder.", read_at=revision_note,
        )
    top = len(steps)
    nodes: list[DiagramNode] = []
    edges: list[DiagramEdge] = []
    items: list[tuple[str, str]] = []
    here, moves = "", []
    if subject and conn is not None:
        found = row(conn, "SELECT status FROM subsystems WHERE id = ?", (subject,))
        here = str(found["status"]) if found and found["status"] else "unmapped"
        if table_exists(conn, "subsystem_status_transitions"):
            moves = rows(
                conn,
                "SELECT id, from_status, to_status, tool, ref_sha, created_at FROM subsystem_status_transitions"
                " WHERE subsystem_id = ? ORDER BY id",
                (subject,),
            )
    anchor = f"{guide_href}#status-ladder-"
    for index, rung in enumerate(steps):
        value = str(rung["value"])
        nodes.append(DiagramNode(
            f"status:{value}", str(rung.get("label", value)), top - index, index,
            style="current" if value == here else "solid", href=f"{anchor}{value}",
        ))
    column_of = {str(r["value"]): i for i, r in enumerate(steps)}
    row_of = {str(r["value"]): top - i for i, r in enumerate(steps)}
    park_column = len(steps)
    nodes.append(DiagramNode(
        "status:deferred", str(parked["label"]), top, park_column,
        style="current" if here == "deferred" else "dashed", href=f"{anchor}deferred",
    ))
    column_of["deferred"], row_of["deferred"] = park_column, top
    labels_by_value = {str(d["value"]): str(d["label"]) for d in depths}
    if not subject:
        for a, b in zip(steps, steps[1:], strict=False):
            edges.append(DiagramEdge(f"ladder-step:{a['value']}:{b['value']}", f"status:{a['value']}", f"status:{b['value']}"))
        for d in [*steps, parked]:
            value = str(d["value"])
            checks = _checks_for(value)
            asks = f"The server checks before it: {'; '.join(c.rstrip('.') for c in checks)}." if checks else "The server asks nothing of it."
            if value == "deferred":
                asks = "It parks a subsystem outside the ladder: it is not a rung, and a parked subsystem resumes from the depth it held."
            items.append((f"status-ladder-{value}", f"{d.get('label', value)}. {d.get('meaning', '')} {asks}".replace("  ", " ")))
        account = (
            "A subsystem climbs one rung at a time, from the bottom. Each rung authorizes more of what a reader may rely on, "
            "and the server checks the prerequisites below before it lets a subsystem reach one.",
        )
        return Diagram("status-ladder", "", title, caption, (), tuple(nodes), tuple(edges), account, tuple(items), read_at=revision_note)
    # One subsystem: the marker, then each recorded move.
    if here in column_of:
        # The marker sits above a rung; below `deferred`, where no arrow comes in.
        above = -1 if here != "deferred" else 1
        nodes.append(DiagramNode(f"subsystem:{subject}", "Here", row_of[here] + above, column_of[here], subject, marker=True))
    drawn_moves = moves if len(moves) <= MAX_MOVES else []
    seen: dict[frozenset[str], int] = {}
    for move in drawn_moves:
        source = str(move["from_status"]) if move["from_status"] else ""
        target = str(move["to_status"])
        if (source and source not in column_of) or target not in column_of:
            continue
        pair = frozenset({source or "(new)", target})
        n = seen.get(pair, 0)
        seen[pair] = n + 1
        bow = (0 if n == 0 else 16 * ((n + 1) // 2) * (1 if n % 2 else -1))
        reach = abs(column_of[source] - column_of[target]) if source and "deferred" not in (source, target) else 0
        if reach > 1:
            bow += 40 * reach
        edges.append(DiagramEdge(f"transition:{move['id']}", f"status:{source}" if source else "", f"status:{target}", bow=bow))
    for move in moves:
        before = labels_by_value.get(str(move["from_status"]), str(move["from_status"])) if move["from_status"] else "Created at"
        after = labels_by_value.get(str(move["to_status"]), str(move["to_status"]))
        day = str(move["created_at"] or "")[:10] or "date not recorded"
        items.append((f"status-ladder-{subject.lower()}-move-{move['id']}", f"{before} → {after}, {day}, by {str(move['tool']).replace('_', ' ')}."))
    standing = next((d for d in depths if d["value"] == here), {})
    paragraphs = [
        f"{subject} is here, at {labels_by_value.get(here, here)}. {standing.get('meaning', '')}"
        f" It cannot justify {standing.get('cannot_justify', 'more than it records')}.".replace("  ", " "),
        "Deferred is drawn beside the ladder, not as a rung: it parks a subsystem outside the climb.",
    ]
    if not moves:
        paragraphs.append(f"Its history was not recorded: no move between depths is held for {subject}, so no climb is drawn.")
    else:
        paragraphs.append(
            f"{_count(len(moves), 'move')} recorded, oldest first."
            + ("" if drawn_moves else f" That is more than the {MAX_MOVES} the ladder draws, so they are listed here and not drawn.")
        )
    last = next((str(m["ref_sha"]) for m in reversed(moves) if m["ref_sha"]), "")
    read_at = (
        f"Read at revision {last[:8]}, the latest recorded move's." if last
        else "No revision is recorded for this history, so none is printed."
    )
    return Diagram("status-ladder", subject, title, caption, (), tuple(nodes), tuple(edges), tuple(paragraphs), tuple(items), read_at=read_at)



# -- A5: coverage bars --------------------------------------------------------

#: Standings a bar can hold, in the order its segments run, with the fill token and the
#: line that tells them apart without colour.
_STANDING_ORDER: tuple[tuple[str, str, str], ...] = (
    ("examined", "accent", "solid"),
    ("examined-stale", "accent-soft", "dashed"),
    ("scoped-unread", "surface", "solid"),
    ("excluded", "canvas-subtle", "dotted"),
    ("absent", "surface", "dashed"),
)
#: Appendix B rule 2: a subsystem's files are drawn as coverage from `scoping` up.
COVERAGE_FROM = ("scoping", "structural", "concerns", "adversarial", "mapped")
_STANDING_LABELS = labels("standing_state")
_NOT_MEASURED = "Coverage not measured"


def _latest_reconciliation(conn: sqlite3.Connection) -> dict[str, Any] | None:
    if not table_exists(conn, "scope_reconciliations"):
        return None
    return row(
        conn,
        "SELECT id, detected_sha, tracked_paths, ledger_rows, unledgered, absent, exempt"
        " FROM scope_reconciliations ORDER BY id DESC LIMIT 1",
    )


def _bar(sid: str, lane: int, counts: dict[str, int]) -> tuple[list[DiagramNode], list[tuple[str, str]], int]:
    """One bar's segments (a state with no file has none), and an account line for every state."""

    total = sum(counts.values())
    nodes: list[DiagramNode] = []
    items: list[tuple[str, str]] = []
    for state, tone, style in _STANDING_ORDER:
        n = counts.get(state, 0)
        label = _STANDING_LABELS.get(state, state)
        anchor = f"coverage-{_id_part(sid)}-{state}"
        if n:
            nodes.append(DiagramNode(f"coverage:{sid}:{state}", label, lane, len(nodes), str(n), style, f"#{anchor}", count=n, tone=tone))
            items.append((anchor, f"{label} — {n} of {total} files."))
        else:
            items.append((anchor, f"{label} — none of the {total} files."))
    return nodes, items, total


def coverage_bars_model(conn: sqlite3.Connection, subsystem_id: str | None = None) -> Diagram:
    """A5: what was read, as bars of `file_standing`; for no subsystem, every subsystem's and the repository's.

    A bar is a share of its own total. The repository bar is the latest `scope_reconciliations`
    row, read at the revision it names; without a reconciliation there is no denominator, so a
    sentence says coverage is not measured and nothing is drawn as zero. A subsystem at `unmapped`
    or `deferred`, or with no ledger row, is not drawn either.
    """

    subject = str(subsystem_id) if subsystem_id is not None else ""
    caption = (
        f"Which of {subject}'s files have been read, and how much of the repository do they reach?" if subject
        else "Which files have been read in each subsystem, and how much of the repository does the ledger reach?"
    )
    title = f"Coverage of {subject}" if subject else "Coverage of the repository"

    def sentence(why: str) -> Diagram:
        return Diagram("coverage-bars", subject, title, caption, below=f"{_NOT_MEASURED}: {why}")

    depth_of = {str(r["id"]): str(r["status"] or "unmapped") for r in rows(conn, "SELECT id, status FROM subsystems")}
    standing: dict[str, dict[str, int]] = {}
    for r in rows(conn, "SELECT subsystem_id, standing_state, COUNT(*) AS n FROM file_standing GROUP BY subsystem_id, standing_state"):
        standing.setdefault(str(r["subsystem_id"]), {})[str(r["standing_state"])] = int(r["n"])
    if subject and depth_of.get(subject, "unmapped") not in COVERAGE_FROM:
        shown = _DEPTH_LABELS.get(depth_of.get(subject, "unmapped"), depth_of.get(subject, "unmapped"))
        return sentence(f"{subject} is at {shown}, a depth that authorizes no reading of its files, so no bar is drawn.")
    recon = _latest_reconciliation(conn)
    if recon is None:
        return sentence(
            "no reconciliation of the repository's tracked files against the ledger is recorded, so no bar is drawn."
            " That says nothing about how much was read."
        )
    sha = str(recon["detected_sha"])
    read_at = f"Read at revision {sha[:8]}, the latest reconciliation's, and at the ledger as it stands now."
    tracked, ledgered, unledgered = int(recon["tracked_paths"]), int(recon["ledger_rows"]), int(recon["unledgered"])
    absent, exempt = int(recon["absent"]), int(recon["exempt"])
    reconciliation_line = (
        f"The repository tracked {_count(tracked, 'path')} at {sha[:8]}; the ledger holds {ledgered} of them"
        f" and {unledgered} {'has' if unledgered == 1 else 'have'} no ledger row."
    )

    lanes: list[str] = []
    nodes: list[DiagramNode] = []
    items: list[tuple[str, str]] = []
    account: list[str] = []
    if subject:
        counts = standing.get(subject, {})
        if not counts:
            return sentence(f"no file is recorded against {subject}, so no bar is drawn.")
        bar, lines, total = _bar(subject, 0, counts)
        lanes.append(f"{subject}\n{_count(total, 'file')}")
        nodes += bar
        items += lines
        account += [
            f"{subject} has {_count(total, 'ledger file')}. Each segment is the share of them in one standing,"
            " not a share of the repository.",
            reconciliation_line,
        ]
    else:
        ids = sorted(depth_of)
        parked = [sid for sid in ids if depth_of[sid] not in COVERAGE_FROM]
        eligible = [sid for sid in ids if sid not in parked]
        bare = [sid for sid in eligible if not standing.get(sid)]
        for sid in eligible:
            if not standing.get(sid):
                continue
            bar, lines, total = _bar(sid, len(lanes), standing[sid])
            lanes.append(f"{sid}\n{_count(total, 'file')}")
            nodes += bar
            items += lines
        if not nodes:
            return sentence("no subsystem at Scoping or above has a ledger row, so no bar is drawn.")
        account.append(
            "Each bar is one subsystem's ledger by standing, and the last is the repository's tracked paths at the latest"
            " reconciliation. A segment is a share of its own bar."
        )
        if bare:
            account.append(
                f"{len(bare)} of {len(depth_of)} subsystems {'has' if len(bare) == 1 else 'have'} no ledger row, so"
                f" {'it has' if len(bare) == 1 else 'they have'} no bar ({', '.join(bare)})."
            )
        if parked:
            account.append(f"{_count(len(parked), 'subsystem')} at Unmapped or Deferred {'is' if len(parked) == 1 else 'are'} not drawn ({', '.join(parked)}).")
        account.append(reconciliation_line)
        in_tree = ledgered - absent
        if tracked == in_tree + unledgered and 0 <= exempt <= in_tree:
            lane = len(lanes)
            lanes.append(f"Repository\n{_count(tracked, 'path')}")
            wanted = (
                ("ledgered", "In the ledger", in_tree - exempt, "accent", "solid"),
                ("exempt", "In the ledger, exempt from the survey", exempt, "canvas-subtle", "dotted"),
                ("unledgered", "In no ledger", unledgered, "surface", "dashed"),
            )
            for key, label, n, tone, style in wanted:
                anchor = f"coverage-repository-{key}"
                if n:
                    nodes.append(DiagramNode(f"coverage:repository:{key}", label, lane, len(nodes), str(n), style, f"#{anchor}", count=n, tone=tone))
                    items.append((anchor, f"{label} — {n} of {tracked} tracked paths."))
                else:
                    items.append((anchor, f"{label} — none of the {tracked} tracked paths."))
        else:
            account.append(
                f"The reconciliation's counts do not add up ({tracked} tracked; {ledgered} in the ledger, {absent} gone,"
                f" {exempt} exempt, {unledgered} with no row), so the repository bar is not drawn."
            )
    return Diagram("coverage-bars", subject, title, caption, tuple(lanes), tuple(nodes), (), tuple(account), tuple(items), read_at=read_at)

# -- A2: the seam contract ----------------------------------------------------

#: The four fields a seam records, in the order its arrows are listed: whose side, and write or read.
_SEAM_FIELDS = (("a", "writes"), ("a", "reads"), ("b", "writes"), ("b", "reads"))
_SEAM_ASSUMPTIONS = (
    ("ordering_assumption", "Ordering"),
    ("cardinality", "Cardinality"),
    ("staleness_tolerance", "Staleness tolerance"),
    ("schema_owner", "Schema owner"),
)
#: Appendix B rule 2: a subsystem's half of a seam is drawn from `structural` up; below it the box stands alone.
SEAM_HALVES_FROM = ("structural", "concerns", "adversarial", "mapped")
SEAM_NOT_RECORDED = "not recorded"


def _recorded(value: object) -> str:
    return str(value).strip() if value is not None else ""


def seam_contract_model(conn: sqlite3.Connection, seam_id: str) -> Diagram:
    """A2: one seam as party A, the shared object and party B, joined by the four recorded fields.

    A write is an arrow into the shared object and a read an arrow out of it. A field nobody
    recorded is drawn dashed and labelled "not recorded", which differs from a recorded "none".
    A party's half is drawn only from `structural` up (Appendix B rule 2). A seam that records
    none of its four fields is a sentence. The seam's assumptions are the drawing's caption.
    """

    seam = row(conn, "SELECT * FROM seams WHERE id = ?", (seam_id,))
    caption_for = f"What does each side of {seam_id} write to and read from what they share, and what do they assume?"
    if seam is None:
        return Diagram(KIND_SEAM, seam_id, f"Seam {seam_id}", caption_for, below=f"No seam {seam_id} is recorded, so no contract is drawn.")
    sides = {"a": str(seam["party_a"]), "b": str(seam["party_b"])}
    names = {str(r["id"]): (str(r["name"]), str(r["status"] or "unmapped")) for r in rows(conn, "SELECT id, name, status FROM subsystems")}
    shared = str(seam["shared_object"])
    title = f"Seam {seam_id}: {shared}"
    caption = f"What does each side of {seam_id} write to and read from {shared}, and what do they assume?"
    values = {(side, verb): _recorded(seam[f"{side}_{verb}"]) for side, verb in _SEAM_FIELDS}
    assumed = [(label, _recorded(seam[column])) for column, label in _SEAM_ASSUMPTIONS]
    day = str(seam["updated_at"] or "")[:10]
    read_at = (
        f"Read from the seams table, last updated {day}. A seam records no revision, so none is printed."
        if day else "Read from the seams table. A seam records no revision, so none is printed."
    )
    if not any(values.values()):
        recorded = [f"{label}: {value}" for label, value in assumed if value]
        kept = f" It does record: {'; '.join(recorded)}." if recorded else " It records no assumption either."
        return Diagram(
            KIND_SEAM, seam_id, title, caption,
            below=(
                f"{seam_id} ({shared}) records none of what {sides['a']} and {sides['b']} write or read through it,"
                f" so no contract is drawn. That differs from a recorded \"none\": nobody has recorded these fields.{kept}"
            ),
            read_at=read_at,
        )
    depth_of = {side: names.get(sides[side], ("", "unmapped"))[1] for side in sides}
    hidden = sorted({sides[side] for side in sides if depth_of[side] not in SEAM_HALVES_FROM})
    nodes = [
        DiagramNode(f"subsystem:{sides['a']}", sides["a"], 0, 0, _seam_party_detail(names, sides["a"], depth_of["a"]), href=subsystem_page(sides["a"], names.get(sides["a"], ("", ""))[0])),
        DiagramNode(f"seam:{seam_id}", shared, 0, 1, str(seam["shared_object_kind"] or "kind not recorded"), href=f"#{seam_id.lower()}"),
        DiagramNode(f"subsystem:{sides['b']}", sides["b"], 0, 2, _seam_party_detail(names, sides["b"], depth_of["b"]), href=subsystem_page(sides["b"], names.get(sides["b"], ("", ""))[0])),
    ]
    edges: list[DiagramEdge] = []
    items: list[tuple[str, str]] = []
    for side, verb in _SEAM_FIELDS:
        value = values[(side, verb)]
        party = sides[side]
        drawn = depth_of[side] in SEAM_HALVES_FROM
        record = f"seam-field:{seam_id}:{side}_{verb}"
        if drawn:
            source, target = (f"subsystem:{party}", f"seam:{seam_id}") if verb == "writes" else (f"seam:{seam_id}", f"subsystem:{party}")
            edges.append(DiagramEdge(record, source, target, value or SEAM_NOT_RECORDED, "solid" if value else "dashed"))
        anchor = f"seam-contract-{_id_part(seam_id)}-{side}-{verb}"
        line = f"{party} {verb}: {value or SEAM_NOT_RECORDED}."
        items.append((anchor, line if drawn else f"{line[:-1]} (not drawn)."))
    notes = tuple(f"{label}: {value or SEAM_NOT_RECORDED}" for label, value in assumed)
    for index, (label, value) in enumerate(assumed):
        items.append((f"seam-contract-{_id_part(seam_id)}-assumption-{index}", f"{label}: {value or SEAM_NOT_RECORDED}."))
    absent_fields = sum(1 for v in values.values() if not v)
    absent_assumptions = sum(1 for _, v in assumed if not v)
    account = [
        f"{sides['a']} is party A and {sides['b']} is party B, as the seam records them, and they meet at {shared}."
        " Each arrow is one recorded field of the seam:"
        " a write goes into the shared object and a read comes out of it. A dashed arrow labelled"
        f" \"{SEAM_NOT_RECORDED}\" is a field nobody recorded; that differs from a recorded \"none\".",
        f"{absent_fields} of 4 fields have no recorded value. {absent_assumptions} of 4 assumptions"
        f" {'has' if absent_assumptions == 1 else 'have'} no recorded value.",
    ]
    for party in hidden:
        shown = _DEPTH_LABELS.get(names.get(party, ("", "unmapped"))[1], names.get(party, ("", "unmapped"))[1])
        account.append(
            f"{party} is at {shown}, so its half of this seam is not drawn: a seam half is drawn from Structural up."
            " Its fields are listed below."
        )
    if seam["notes"]:
        account.append(f"Notes on the seam: {_recorded(seam['notes'])}")
    return Diagram(KIND_SEAM, seam_id, title, caption, (), tuple(nodes), tuple(edges), tuple(account), tuple(items), read_at=read_at, notes=notes)


def _seam_party_detail(names: dict[str, tuple[str, str]], sid: str, depth: str) -> str:
    name = names.get(sid, (sid, depth))[0]
    shown = _DEPTH_LABELS.get(depth, depth)
    return f"{name}\n{shown}" + ("" if depth in SEAM_HALVES_FROM else "\nhalf not drawn")


# -- A3: the flow strip -------------------------------------------------------

#: Appendix B rule 2: a flow is drawn from `structural` up; below it the flow is a sentence.
FLOW_FROM = ("structural", "concerns", "adversarial", "mapped")
#: A strip needs this many steps to be worth drawing, wraps after FLOW_BAND, and past MAX_FLOW_STEPS is a table.
MIN_FLOW_STEPS = 3
FLOW_BAND = 12
MAX_FLOW_STEPS = 20
#: A step with more exits than this lists them in the account and draws none.
MAX_EXITS_DRAWN = 2
FLOW_MARKS_NOT_RECORDED = (
    "Marks not recorded: no commit point, crash point, exit or seam crossing is recorded for this flow,"
    " and the survey did not say it has none."
)
_FLOW_KEY = re.compile(r"^([^/\s]+)/flow/([a-z0-9]+(?:-[a-z0-9]+)*)$")
_FLOW_STEP_KEY = re.compile(r"^([^/\s]+)/flow/([a-z0-9]+(?:-[a-z0-9]+)*)/([0-9]{2,})$")
#: How sure a step's claim is, as the line its box is drawn with (Appendix B rule 7).
_STEP_STYLE = {"inference": "dashed", "hypothesis": "dotted", "open-question": "dotted"}
_STEP_KIND_PHRASE = {"observation": "an observation", "inference": "an inference", "hypothesis": "a hypothesis", "open-question": "an open question"}
#: The marks drawn below their step; every other kind but the commit point is drawn above.
_MARKS_BELOW = ("exit",)
_LEAVES_FLOW = "leaves-flow"


def _like_escaped(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def flow_steps(conn: sqlite3.Connection, flow_key: str) -> list[dict[str, Any]]:
    """A flow's current step claims (`<sid>/flow/<slug>/<nn>`), in step-number order."""

    found = rows(
        conn,
        "SELECT claim_id, claim_key, statement, epistemic_kind, asserted_at_sha FROM claims"
        " WHERE valid_until_sha IS NULL AND claim_key LIKE ? ESCAPE '\\'",
        (f"{_like_escaped(flow_key)}/%",),
    )
    steps = []
    for claim in found:
        match = _FLOW_STEP_KEY.match(str(claim["claim_key"]))
        if match and f"{match.group(1)}/flow/{match.group(2)}" == flow_key:
            steps.append({**claim, "step": match.group(3)})
    return sorted(steps, key=lambda c: (int(c["step"]), str(c["step"])))


def flow_keys(conn: sqlite3.Connection, subsystem_id: str) -> list[str]:
    """The flows (`<sid>/flow/<slug>`) a subsystem has a current step claim for, in name order."""

    found = rows(
        conn,
        "SELECT claim_key FROM claims WHERE valid_until_sha IS NULL AND claim_key LIKE ? ESCAPE '\\'",
        (f"{_like_escaped(subsystem_id)}/flow/%",),
    )
    keys = set()
    for claim in found:
        match = _FLOW_STEP_KEY.match(str(claim["claim_key"]))
        if match and match.group(1) == subsystem_id:
            keys.add(f"{match.group(1)}/flow/{match.group(2)}")
    return sorted(keys)


def _flow_marks(conn: sqlite3.Connection, flow_key: str) -> list[dict[str, Any]]:
    """The current, unwithdrawn marks of a flow's current steps, oldest first.

    A closed claim's marks are not current (§7.2): only a mark on a step that is still current is read.
    """

    if not table_exists(conn, "claim_marks"):
        return []
    withdrawn = (
        " AND NOT EXISTS (SELECT 1 FROM claim_mark_withdrawals w WHERE w.mark_id = m.id)"
        if table_exists(conn, "claim_mark_withdrawals") else ""
    )
    found = rows(
        conn,
        "SELECT m.id, m.claim_id, m.kind, m.label, m.target, c.claim_key FROM claim_marks m"
        " JOIN claims c ON c.claim_id = m.claim_id"
        f" WHERE c.valid_until_sha IS NULL AND c.claim_key LIKE ? ESCAPE '\\'{withdrawn} ORDER BY m.id",
        (f"{_like_escaped(flow_key)}/%",),
    )
    marks = []
    for mark in found:
        match = _FLOW_STEP_KEY.match(str(mark["claim_key"]))
        if match and f"{match.group(1)}/flow/{match.group(2)}" == flow_key:
            marks.append({**mark, "step": match.group(3)})
    return marks


def _flow_declination(conn: sqlite3.Connection, flow_key: str) -> str:
    if not table_exists(conn, "claim_mark_declinations"):
        return ""
    found = row(conn, "SELECT reason FROM claim_mark_declinations WHERE flow_key = ? ORDER BY id DESC LIMIT 1", (flow_key,))
    return " ".join(str(found["reason"]).split()) if found else ""


def _flow_marks_note(marks: Sequence[dict[str, Any]], declination: str) -> list[str]:
    """What the store says about a flow's marks: none recorded, declined, or present without a commit point."""

    if not marks and declination:
        return [f"The survey recorded no marks for this flow and said why: {declination}"]
    if not marks:
        return [FLOW_MARKS_NOT_RECORDED]
    out = []
    if not any(m["kind"] == "commit-point" for m in marks):
        out.append(
            "The survey declined to name a commit point and said why: " + declination
            if declination else "No commit point is recorded for this flow."
        )
    elif declination:
        out.append(f"A declination is also on record: {declination}")
    return out


def _flow_mark_text(mark: dict[str, Any]) -> str:
    """One mark as a reader's line: the account's item and the words in its box."""

    step, label, target = mark["step"], str(mark["label"] or "").strip(), str(mark["target"] or "").strip()
    kind = str(mark["kind"])
    if kind == "commit-point":
        return f"Commit point after step {step}: the flow's effect is kept from here."
    if kind == "crash-point":
        return f"Crash point at step {step}: {label or 'no label recorded'}."
    if kind == "exit":
        where = "leaves the flow" if target == _LEAVES_FLOW else f"unwinds to step {target}"
        return f"Exit at step {step}: {label or 'no label recorded'}, {where}."
    if kind == "crosses-seam":
        return f"Crosses seam {target} at step {step}."
    return f"Trigger at step {step}: the flow starts here."


def _flow_mark_box(mark: dict[str, Any]) -> str:
    """What a mark's box says, shorter than its account line."""

    kind, label, target = str(mark["kind"]), str(mark["label"] or "").strip(), str(mark["target"] or "").strip()
    if kind == "crash-point":
        return f"Crash: {label}"
    if kind == "exit":
        return f"Exit: {label} → " + ("leaves flow" if target == _LEAVES_FLOW else f"step {target}")
    if kind == "crosses-seam":
        return f"Seam {target}"
    if kind == "commit-point":
        return "Kept"
    return "Trigger"


def flow_strip_model(conn: sqlite3.Connection, flow_key: str) -> Diagram:
    """A3: one flow as a strip of its steps in `<nn>` order, with the marks the survey recorded on them.

    A step is a box (solid for an observation, dashed for an inference, dotted for a hypothesis
    or an open question), joined to its neighbour on the same row. A commit point is a line just
    after its step; a trigger, a crash point and a seam crossing sit above their step and an exit
    below it. A flow of fewer than three steps, or one below `structural`, is a sentence; one
    of more than twenty is a sentence and a table (`flow_step_table`); one of more than twelve
    wraps. A flow with no marks and no declination says its marks were not recorded.
    """

    found = _FLOW_KEY.match(flow_key)
    sid, slug = found.groups() if found else (flow_key.split("/", 1)[0], flow_key)
    title = f"Flow {slug} of {sid}"
    caption = f"In what order does {slug} run, where is its effect kept, and where can it stop?"
    steps = flow_steps(conn, flow_key)
    marks = _flow_marks(conn, flow_key)
    declination = _flow_declination(conn, flow_key)
    note = " ".join(_flow_marks_note(marks, declination))
    shas = sorted({str(s["asserted_at_sha"]) for s in steps if s["asserted_at_sha"]})
    read_at = (
        f"Read at revision {shas[0][:8]}, the one its steps were asserted at." if len(shas) == 1
        else f"Its steps were asserted at revisions {', '.join(sha[:8] for sha in shas)}." if shas
        else "No revision is recorded for these steps, so none is printed."
    )
    n = len(steps)
    if n == 0:
        return Diagram(KIND_FLOW, flow_key, title, caption, below=f"No current step is recorded for {flow_key}, so no strip is drawn.", read_at=read_at)
    found_status = row(conn, "SELECT status FROM subsystems WHERE id = ?", (sid,))
    depth = str(found_status["status"]) if found_status and found_status["status"] else "unmapped"
    if depth not in FLOW_FROM:
        return Diagram(
            KIND_FLOW, flow_key, title, caption,
            below=(
                f"{flow_key} has {_count(n, 'step')}, but {sid} is at {_DEPTH_LABELS.get(depth, depth)},"
                " and a flow is drawn from Structural up, so no strip is drawn."
            ),
            read_at=read_at,
        )
    if n < MIN_FLOW_STEPS:
        return Diagram(
            KIND_FLOW, flow_key, title, caption,
            below=f"{flow_key} has {_count(n, 'step')}, and a strip is drawn from {MIN_FLOW_STEPS}, so none is drawn. {note}",
            read_at=read_at,
        )
    if n > MAX_FLOW_STEPS:
        return Diagram(
            KIND_FLOW, flow_key, title, caption,
            below=(
                f"{flow_key} has {_count(n, 'step')}, more than the {MAX_FLOW_STEPS} a strip draws,"
                f" so they are numbered in the table below. {note}"
            ),
            read_at=read_at,
        )
    slug_id = _id_part(slug)
    exits_at: dict[str, int] = {}
    for mark in marks:
        if mark["kind"] == "exit":
            exits_at[mark["step"]] = exits_at.get(mark["step"], 0) + 1
    column_of = {s["step"]: i for i, s in enumerate(steps)}
    nodes: list[DiagramNode] = []
    edges: list[DiagramEdge] = []
    items: list[tuple[str, str]] = []
    for index, s in enumerate(steps):
        kind = str(s["epistemic_kind"] or "")
        anchor = f"flow-strip-{slug_id}-{s['step']}"
        nodes.append(DiagramNode(
            f"flow-step:{s['claim_id']}", str(s["step"]), index // FLOW_BAND, index % FLOW_BAND, " ".join(str(s["statement"]).split()),
            _STEP_STYLE.get(kind, "solid"), f"#{anchor}",
        ))
        items.append((anchor, f"Step {s['step']}: {' '.join(str(s['statement']).split())} ({_STEP_KIND_PHRASE.get(kind, kind or 'kind not recorded')})."))
        if index and index // FLOW_BAND == (index - 1) // FLOW_BAND:
            before = steps[index - 1]
            edges.append(DiagramEdge(f"flow-next:{before['claim_id']}:{s['claim_id']}", f"flow-step:{before['claim_id']}", f"flow-step:{s['claim_id']}"))
    crowded = sorted(step for step, count in exits_at.items() if count > MAX_EXITS_DRAWN)
    for mark in marks:
        anchor = f"flow-strip-{slug_id}-mark-{mark['id']}"
        items.append((anchor, _flow_mark_text(mark)))
        if mark["kind"] == "exit" and mark["step"] in crowded:
            continue
        position = column_of[mark["step"]]
        href = f"../seams.html#{str(mark['target']).lower()}" if mark["kind"] == "crosses-seam" and mark["target"] else f"#{anchor}"
        nodes.append(DiagramNode(f"flow-mark:{mark['id']}", _flow_mark_box(mark), position // FLOW_BAND, position % FLOW_BAND, str(mark["kind"]), "solid", href))
    bands = (n + FLOW_BAND - 1) // FLOW_BAND
    kinds_present = [str(v["value"]) for v in VOCABULARY["claim_mark_kind"]["values"] if any(m["kind"] == v["value"] for m in marks)]  # type: ignore[index,union-attr]
    contract = {str(v["value"]): v for v in VOCABULARY["claim_mark_kind"]["values"]}  # type: ignore[index,union-attr]
    marked = {m["step"] for m in marks}
    bare = n - len(marked)
    account = [
        f"{_count(n, 'step')}, in number order, left to right"
        + (f", then down: the strip wraps after {FLOW_BAND} steps. Rows are not joined by an arrow." if bands > 1 else ".")
        + " An arrow joins a step to the next one on its row. A solid box rests on an observation, a dashed one on an inference,"
        " a dotted one on a hypothesis or an open question.",
    ]
    if marks:
        key = {
            "commit-point": "a vertical line just after a step is a commit point",
            "trigger": "a box above step 00 is its trigger",
            "crash-point": "a box above a step is a crash point",
            "crosses-seam": "a box above a step that names a seam crosses it, and links it",
            "exit": "a box below a step is an exit",
        }
        account.append(f"{_count(len(marks), 'mark')} recorded: " + "; ".join(key[k] for k in kinds_present) + ".")
    account.append(f"{bare} of {n} steps {'has' if bare == 1 else 'have'} no recorded mark.")
    account.extend(_flow_marks_note(marks, declination))
    for step in crowded:
        account.append(
            f"Step {step} has {exits_at[step]} exits, more than {_count_word(MAX_EXITS_DRAWN)}, so they are listed here and not drawn."
        )
    for kind in kinds_present:
        account.append(f"A {str(contract[kind]['label']).lower()} cannot justify {contract[kind]['cannot_justify']}.")
    return Diagram(KIND_FLOW, flow_key, title, caption, (), tuple(nodes), tuple(edges), tuple(account), tuple(items), read_at=read_at)


def _count_word(n: int) -> str:
    return {1: "one", 2: "two"}.get(n, str(n))


def flow_step_table(conn: sqlite3.Connection, flow_key: str) -> Table | None:
    """A flow past the strip's size: every step, numbered, with the marks recorded on it."""

    steps = flow_steps(conn, flow_key)
    if len(steps) <= MAX_FLOW_STEPS:
        return None
    marks = _flow_marks(conn, flow_key)
    body = []
    for s in steps:
        here = " ".join(_flow_mark_text(m) for m in marks if m["step"] == s["step"])
        body.append((str(s["step"]), " ".join(str(s["statement"]).split()), here or "none recorded"))
    return Table(
        f"steps of {flow_key}",
        (inlines("Step"), inlines("What it does"), inlines("Marks")),
        tuple(Row(tuple(inlines(cell) for cell in cells)) for cells in body),
    )


def flow_strip_blocks(conn: sqlite3.Connection, subsystem_id: str) -> list[Block]:
    """Each flow of a subsystem, as the strip or sentence its model says, and the table when it is too long to draw."""

    out: list[Block] = []
    for key in flow_keys(conn, subsystem_id):
        model = flow_strip_model(conn, key)
        out.append(model)
        if not model.nodes and (table := flow_step_table(conn, key)) is not None and "table below" in model.below:
            out.append(table)
    return out


# -- drawing ----------------------------------------------------------------

_GRID: dict[str, tuple[float, float, float, float, float, float]] = {
    # left, top, column width, row height, box width, box height
    "survey-workflow": (96.0, 14.0, 144.0, 104.0, 126.0, 66.0),
    "status-ladder": (14.0, 10.0, 134.0, 58.0, 100.0, 38.0),
}


def _n(value: float) -> str:
    """A coordinate, printed the same way every time."""

    text = f"{value:.1f}"
    return text[:-2] if text.endswith(".0") else text


def _wrap(text: str, width: int) -> list[str]:
    return textwrap.wrap(text, width=width, break_long_words=False, break_on_hyphens=False) or [text]


def svg_text(lines: Sequence[str], x: float, y: float, *, size: int = 12, weight: str = "400", anchor: str = "middle", fill: str = "var(--text)") -> str:
    """Lines of text, centred on `y`, in the page's heading face; never under 11 px."""

    size = max(size, 11)
    lead = size + 3
    first = y - (len(lines) - 1) * lead / 2 + size * 0.35
    spans = "".join(
        f'<tspan x="{_n(x)}" y="{_n(first + i * lead)}">{escape(line, quote=False)}</tspan>' for i, line in enumerate(lines)
    )
    return (
        f'<text x="{_n(x)}" y="{_n(first)}" text-anchor="{anchor}" font-family="var(--heading)" '
        f'font-size="{size}" font-weight="{weight}" fill="{fill}">{spans}</text>'
    )


def svg_box(x: float, y: float, w: float, h: float, *, style: str = "solid", marker: bool = False) -> str:
    """A box's outline; its look says how sure the record is, and a heavy accent edge says here."""

    stroke, width = "var(--rule-strong)", 1.0
    fill = "var(--surface)"
    if style == "current" or marker:
        stroke, width = "var(--accent)", 2.5
        fill = "var(--canvas-subtle)"
    dash = f' stroke-dasharray="{_DASH[style]}"' if style in _DASH else ""
    return (
        f'<rect x="{_n(x)}" y="{_n(y)}" width="{_n(w)}" height="{_n(h)}" rx="4" fill="{fill}" '
        f'stroke="{stroke}" stroke-width="{_n(width)}"{dash}/>'
    )


def _clip(cx: float, cy: float, w: float, h: float, toward: tuple[float, float]) -> tuple[float, float]:
    """Where the line from a box's centre toward a point leaves the box."""

    dx, dy = toward[0] - cx, toward[1] - cy
    if dx == 0 and dy == 0:
        return cx, cy
    t = min((w / 2 + 2) / abs(dx) if dx else float("inf"), (h / 2 + 2) / abs(dy) if dy else float("inf"))
    return cx + dx * t, cy + dy * t


def svg_arrow(record: str, start: tuple[float, float], control: tuple[float, float], end: tuple[float, float], *, style: str = "solid") -> str:
    """One marked path from `start` to `end`, bowed through `control`, and its head as a polygon."""

    dash = f' stroke-dasharray="{_DASH[style]}"' if style in _DASH else ""
    straight = control == ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
    d = f"M {_n(start[0])} {_n(start[1])} " + (
        f"L {_n(end[0])} {_n(end[1])}" if straight else f"Q {_n(control[0])} {_n(control[1])} {_n(end[0])} {_n(end[1])}"
    )
    vx, vy = end[0] - control[0], end[1] - control[1]
    length = (vx * vx + vy * vy) ** 0.5 or 1.0
    ux, uy = vx / length, vy / length
    base = (end[0] - ux * 9, end[1] - uy * 9)
    left, right = (base[0] - uy * 4.5, base[1] + ux * 4.5), (base[0] + uy * 4.5, base[1] - ux * 4.5)
    return (
        f'<path data-edge="{escape(record, quote=True)}" d="{d}" fill="none" stroke="var(--accent)" stroke-width="1.5"{dash}/>'
        f'<polygon aria-hidden="true" points="{_n(end[0])},{_n(end[1])} {_n(left[0])},{_n(left[1])} {_n(right[0])},{_n(right[1])}" fill="var(--accent)"/>'
    )


def _id_part(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def svg_ids(diagram: Diagram) -> tuple[str, str]:
    """The ids of an SVG's `<title>` and `<desc>`: one pair per diagram on a page."""

    stem = f"diagram-{_id_part(diagram.kind)}" + (f"-{_id_part(diagram.subject)}" if diagram.subject else "")
    return f"{stem}-title", f"{stem}-desc"


def draw_svg(diagram: Diagram) -> str:
    """A diagram as one inline SVG: a fixed 960-wide viewBox, tokens for colour, no script."""

    if diagram.kind == "coverage-bars":
        return _draw_bars(diagram)
    if diagram.kind == KIND_SEAM:
        return _draw_seam(diagram)
    if diagram.kind == KIND_FLOW:
        return _draw_flow(diagram)
    left, top, colw, rowh, boxw, boxh = _GRID.get(diagram.kind, _GRID["status-ladder"])
    centres: dict[str, tuple[float, float]] = {}
    for node in diagram.nodes:
        centres[node.record] = (left + node.column * colw + colw / 2, top + node.row * rowh + rowh / 2)
    rows_used = max((n.row for n in diagram.nodes), default=0) + 1
    height = top + rows_used * rowh + 10
    title_id, desc_id = svg_ids(diagram)
    boxes, arrows = len(diagram.nodes), len(diagram.edges)
    body: list[str] = []
    for lane_row, lane in enumerate(diagram.lanes):
        y = top + lane_row * rowh
        shade = "var(--canvas-subtle)" if lane_row % 2 == 0 else "var(--surface)"
        body.append(f'<rect x="0" y="{_n(y)}" width="{VIEW_WIDTH}" height="{_n(rowh)}" fill="{shade}" opacity="0.7"/>')
        body.append(svg_text([lane], 10, y + rowh / 2, size=12, weight="600", anchor="start", fill="var(--text-muted)"))
    for edge in diagram.edges:
        target = centres[edge.target]
        if edge.source:
            source = centres[edge.source]
            mid = ((source[0] + target[0]) / 2, (source[1] + target[1]) / 2)
            dx, dy = target[0] - source[0], target[1] - source[1]
            length = (dx * dx + dy * dy) ** 0.5 or 1.0
            control = (mid[0] - dy / length * edge.bow, mid[1] + dx / length * edge.bow)
            start = _clip(*source, boxw, boxh, control)
            end = _clip(*target, boxw, boxh, control)
        else:
            end = _clip(*target, boxw, boxh, (target[0] - 100, target[1]))
            start = (end[0] - 36, end[1])
            control = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        body.append(svg_arrow(edge.record, start, control, end, style=edge.style))
    for node in diagram.nodes:
        cx, cy = centres[node.record]
        width = boxw if not node.marker else boxw * 0.6
        lines = _wrap(node.label, max(int(width / 6.6), 8))[:2]
        detail = _wrap(node.detail, max(int(width / 6.0), 8))[:2] if node.detail else []
        first = cy - (len(lines) + len(detail) - 1) * 7.5
        text = svg_text(lines, cx, first + (len(lines) - 1) * 7.5, size=12, weight="600")
        if detail:
            text += svg_text(detail, cx, first + len(lines) * 15 + (len(detail) - 1) * 7.5, size=11, fill="var(--text-muted)")
        inner = svg_box(cx - width / 2, cy - boxh / 2, width, boxh, style=node.style, marker=node.marker) + text
        if node.href:
            inner = f'<a href="{escape(node.href, quote=True)}">{inner}</a>'
        body.append(f'<g data-node="{escape(node.record, quote=True)}">{inner}</g>')
    description = f"{boxes} {'box' if boxes == 1 else 'boxes'} and {arrows} {'arrow' if arrows == 1 else 'arrows'}: {diagram.caption}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" class="diagram-svg" viewBox="0 0 {VIEW_WIDTH} {_n(height)}" '
        f'width="{VIEW_WIDTH}" role="img" aria-labelledby="{title_id} {desc_id}">'
        f'<title id="{title_id}">{escape(diagram.title, quote=False)}</title>'
        f'<desc id="{desc_id}">{escape(description, quote=False)}</desc>'
        + "".join(body)
        + "</svg>"
    )


_BAR_LEFT, _BAR_RIGHT, _BAR_ROW, _BAR_HEIGHT = 112.0, 950.0, 46.0, 26.0


def _draw_bars(diagram: Diagram) -> str:
    """Bars as one inline SVG: a full-width bar per lane, its segments sized by count, a legend beneath."""

    title_id, desc_id = svg_ids(diagram)
    width = _BAR_RIGHT - _BAR_LEFT
    body: list[str] = []
    for lane_row, lane in enumerate(diagram.lanes):
        y = 8 + lane_row * _BAR_ROW
        shade = "var(--canvas-subtle)" if lane_row % 2 == 0 else "var(--surface)"
        body.append(f'<rect x="0" y="{_n(y)}" width="{VIEW_WIDTH}" height="{_n(_BAR_ROW)}" fill="{shade}" opacity="0.7"/>')
        body.append(svg_text(lane.split("\n"), 10, y + _BAR_ROW / 2, size=12, weight="600", anchor="start", fill="var(--text-muted)"))
        segments = [n for n in diagram.nodes if n.row == lane_row]
        total = sum(n.count for n in segments) or 1
        raw = [max(n.count / total * width, 4.0) for n in segments]
        scale = width / (sum(raw) or 1.0)
        x = _BAR_LEFT
        for node, size in zip(segments, raw, strict=True):
            w = size * scale
            top = y + (_BAR_ROW - _BAR_HEIGHT) / 2
            stroke = "var(--accent-strong)" if node.tone == "accent" else "var(--rule-strong)"
            dash = f' stroke-dasharray="{_DASH[node.style]}"' if node.style in _DASH else ""
            ink = "var(--canvas)" if node.tone == "accent" else "var(--text)"
            words = f"{node.label}: {node.count} of {total}"
            inner = (
                f"<title>{escape(words, quote=False)}</title>"
                f'<rect x="{_n(x)}" y="{_n(top)}" width="{_n(w)}" height="{_n(_BAR_HEIGHT)}" fill="var(--{node.tone})" stroke="{stroke}" stroke-width="1.2"{dash}/>'
            )
            if w >= 30:
                inner += svg_text([str(node.count)], x + w / 2, top + _BAR_HEIGHT / 2, size=12, weight="600", fill=ink)
            if node.href:
                inner = f'<a href="{escape(node.href, quote=True)}">{inner}</a>'
            body.append(f'<g data-node="{escape(node.record, quote=True)}">{inner}</g>')
            x += w
    present: list[tuple[str, str, str, str]] = []
    for node in diagram.nodes:
        key = (node.label, node.tone, node.style)
        if all(key != (p[0], p[1], p[2]) for p in present):
            present.append((node.label, node.tone, node.style, ""))
    legend_top = 8 + len(diagram.lanes) * _BAR_ROW + 8
    per_line, cell = 3, (VIEW_WIDTH - 20) / 3
    for index, (label, tone, style, _) in enumerate(present):
        lx = 10 + (index % per_line) * cell
        ly = legend_top + (index // per_line) * 20
        dash = f' stroke-dasharray="{_DASH[style]}"' if style in _DASH else ""
        stroke = "var(--accent-strong)" if tone == "accent" else "var(--rule-strong)"
        body.append(f'<rect x="{_n(lx)}" y="{_n(ly)}" width="22" height="12" fill="var(--{tone})" stroke="{stroke}" stroke-width="1.2"{dash}/>')
        body.append(svg_text([label], lx + 30, ly + 6, size=11, anchor="start", fill="var(--text-muted)"))
    legend_rows = (len(present) + per_line - 1) // per_line
    height = legend_top + legend_rows * 20 + 6
    segments = len(diagram.nodes)
    description = f"{segments} {'segment' if segments == 1 else 'segments'} in {len(diagram.lanes)} {'bar' if len(diagram.lanes) == 1 else 'bars'}: {diagram.caption}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" class="diagram-svg" viewBox="0 0 {VIEW_WIDTH} {_n(height)}" '
        f'width="{VIEW_WIDTH}" role="img" aria-labelledby="{title_id} {desc_id}">'
        f'<title id="{title_id}">{escape(diagram.title, quote=False)}</title>'
        f'<desc id="{desc_id}">{escape(description, quote=False)}</desc>'
        + "".join(body)
        + "</svg>"
    )


#: Where the seam contract's boxes sit: centres of party A, the shared object and party B, their size, and the arrows' rows.
_SEAM_X = (120.0, 480.0, 840.0)
_SEAM_BOX = (176.0, 96.0)
_SEAM_Y = 140.0
_SEAM_WRITE_Y, _SEAM_READ_Y = 112.0, 168.0


def _seam_label(text: str, width: int = 27, limit: int = 3) -> list[str]:
    lines = _wrap(text, width)
    if len(lines) > limit:
        lines = lines[:limit]
        lines[-1] = lines[-1][: max(width - 1, 1)].rstrip() + "…"
    return lines


def _draw_seam(diagram: Diagram) -> str:
    """A seam contract as one inline SVG: party A, the shared object and party B in a row, a pair of arrows each side."""

    title_id, desc_id = svg_ids(diagram)
    boxw, boxh = _SEAM_BOX
    by_record = {n.record: n for n in diagram.nodes}
    centre = {n.record: (_SEAM_X[n.column], _SEAM_Y) for n in diagram.nodes}
    body: list[str] = [f'<rect x="0" y="0" width="{VIEW_WIDTH}" height="{_n(_SEAM_Y * 2 - 20)}" fill="var(--canvas-subtle)" opacity="0.7"/>']
    for edge in diagram.edges:
        source, target = centre[edge.source], centre[edge.target]
        y = _SEAM_WRITE_Y if edge.record.endswith("writes") else _SEAM_READ_Y
        facing = 1 if target[0] > source[0] else -1
        start = (source[0] + facing * (boxw / 2 + 2), y)
        end = (target[0] - facing * (boxw / 2 + 2), y)
        body.append(svg_arrow(edge.record, start, ((start[0] + end[0]) / 2, y), end, style=edge.style))
        lines = _seam_label(edge.label)
        mid = (start[0] + end[0]) / 2
        absent = edge.label == SEAM_NOT_RECORDED
        fill = "var(--text-muted)" if absent else "var(--text)"
        if y == _SEAM_WRITE_Y:
            body.append(svg_text(lines, mid, y - 10 - (len(lines) - 1) * 7.5 - 7, size=11, fill=fill))
        else:
            body.append(svg_text(lines, mid, y + 10 + (len(lines) - 1) * 7.5 + 7, size=11, fill=fill))
    for record, node in by_record.items():
        cx, cy = centre[record]
        head = _wrap(node.label, 24)[:2]
        detail = [line for part in node.detail.split("\n") for line in _wrap(part, 28)[:1]][:3]
        total = len(head) + len(detail)
        first = cy - (total - 1) * 7.5
        text = svg_text(head, cx, first + (len(head) - 1) * 7.5, size=12, weight="600")
        if detail:
            text += svg_text(detail, cx, first + len(head) * 15 + (len(detail) - 1) * 7.5, size=11, fill="var(--text-muted)")
        inner = svg_box(cx - boxw / 2, cy - boxh / 2, boxw, boxh, style=node.style) + text
        if node.href:
            inner = f'<a href="{escape(node.href, quote=True)}">{inner}</a>'
        body.append(f'<g data-node="{escape(record, quote=True)}">{inner}</g>')
    caption_top = _SEAM_Y * 2 - 4
    height = caption_top + 10
    if diagram.notes:
        wrapped = _wrap("Assumes — " + "  ·  ".join(diagram.notes), 118)
        body.append(svg_text(wrapped, 480, caption_top + 8 + (len(wrapped) - 1) * 7.5, size=11, fill="var(--text-muted)"))
        height = caption_top + 8 + len(wrapped) * 14 + 10
    boxes, arrows = len(diagram.nodes), len(diagram.edges)
    description = f"{boxes} {'box' if boxes == 1 else 'boxes'} and {arrows} {'arrow' if arrows == 1 else 'arrows'}: {diagram.caption}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" class="diagram-svg" viewBox="0 0 {VIEW_WIDTH} {_n(height)}" '
        f'width="{VIEW_WIDTH}" role="img" aria-labelledby="{title_id} {desc_id}">'
        f'<title id="{title_id}">{escape(diagram.title, quote=False)}</title>'
        f'<desc id="{desc_id}">{escape(description, quote=False)}</desc>'
        + "".join(body)
        + "</svg>"
    )


_FLOW_LEFT, _FLOW_RIGHT = 14.0, 946.0
_FLOW_BOX_H, _FLOW_MARK_H, _FLOW_SLOT, _FLOW_GAP = 52.0, 32.0, 40.0, 24.0
#: Room above a row for the commit line's label, and below it for the next row.
_FLOW_HEAD, _FLOW_FOOT = 18.0, 14.0


def _flow_label(text: str, width: int, limit: int) -> list[str]:
    lines = _wrap(text, max(width, 4))
    if len(lines) > limit:
        lines = lines[:limit]
        lines[-1] = lines[-1][: max(width - 1, 1)].rstrip() + "…"
    return [line if len(line) <= width else line[: max(width - 1, 1)] + "…" for line in lines]


def _draw_flow(diagram: Diagram) -> str:
    """A flow as one inline SVG: its steps in rows of twelve, a commit line, marks above and exits below."""

    title_id, desc_id = svg_ids(diagram)
    steps = [n for n in diagram.nodes if n.record.startswith("flow-step:")]
    marks = [n for n in diagram.nodes if n.record.startswith("flow-mark:")]
    per_row = max(min(len(steps), FLOW_BAND), 6)
    colw = (_FLOW_RIGHT - _FLOW_LEFT) / per_row
    boxw = colw - _FLOW_GAP
    chars = int((boxw - 8) / 6.1)
    bands = max(n.row for n in steps) + 1
    above: dict[tuple[int, int], list[DiagramNode]] = {}
    below: dict[tuple[int, int], list[DiagramNode]] = {}
    commits: list[DiagramNode] = []
    for mark in marks:
        if mark.detail == "commit-point":
            commits.append(mark)
        elif mark.detail in _MARKS_BELOW:
            below.setdefault((mark.row, mark.column), []).append(mark)
        else:
            above.setdefault((mark.row, mark.column), []).append(mark)
    top_of: list[float] = []
    box_top: list[float] = []
    cursor = 8.0
    for band in range(bands):
        tall_above = max((len(v) for (b, _), v in above.items() if b == band), default=0)
        tall_below = max((len(v) for (b, _), v in below.items() if b == band), default=0)
        top_of.append(cursor)
        box_top.append(cursor + _FLOW_HEAD + tall_above * _FLOW_SLOT)
        cursor = box_top[-1] + _FLOW_BOX_H + tall_below * _FLOW_SLOT + _FLOW_FOOT
    height = cursor
    body: list[str] = []
    centre = {n.record: (_FLOW_LEFT + n.column * colw + colw / 2, box_top[n.row] + _FLOW_BOX_H / 2) for n in steps}
    for edge in diagram.edges:
        (sx, sy), (tx, ty) = centre[edge.source], centre[edge.target]
        body.append(svg_arrow(edge.record, (sx + boxw / 2 + 3, sy), ((sx + tx) / 2, sy), (tx - boxw / 2 - 3, ty), style=edge.style))
    for node in steps:
        cx, cy = centre[node.record]
        lines = _flow_label(node.detail, chars, 2) if chars >= 14 else []
        text = svg_text([node.label], cx, cy - 14 if lines else cy, size=12, weight="600")
        if lines:
            text += svg_text(lines, cx, cy + 9, size=11, fill="var(--text-muted)")
        inner = svg_box(cx - boxw / 2, cy - _FLOW_BOX_H / 2, boxw, _FLOW_BOX_H, style=node.style) + text
        name = escape(f"Step {node.label}: {node.detail}", quote=True)
        body.append(f'<g data-node="{escape(node.record, quote=True)}"><a href="{escape(node.href, quote=True)}" aria-label="{name}">{inner}</a></g>')
    for (band, column), group in sorted(above.items()):
        cx = _FLOW_LEFT + column * colw + colw / 2
        for slot, mark in enumerate(group):
            bottom = box_top[band] - 8 - slot * _FLOW_SLOT
            body.append(_flow_mark(mark, cx, bottom - _FLOW_MARK_H, boxw, chars, bottom, bottom + 8))
    for (band, column), group in sorted(below.items()):
        cx = _FLOW_LEFT + column * colw + colw / 2
        for slot, mark in enumerate(group):
            top = box_top[band] + _FLOW_BOX_H + 8 + slot * _FLOW_SLOT
            body.append(_flow_mark(mark, cx, top, boxw, chars, top - 8, top))
    for mark in commits:
        x = _FLOW_LEFT + (mark.column + 1) * colw
        y1, y2 = top_of[mark.row] + _FLOW_HEAD - 2, box_top[mark.row] + _FLOW_BOX_H + 4
        label = svg_text(["Kept"], x, top_of[mark.row] + 6, size=11, weight="600", fill="var(--accent)")
        line = f'<rect x="{_n(x - 1.5)}" y="{_n(y1)}" width="3" height="{_n(y2 - y1)}" fill="var(--accent)"/>'
        name = escape(f"Commit point: {mark.label}", quote=True)
        body.append(f'<g data-node="{escape(mark.record, quote=True)}"><a href="{escape(mark.href, quote=True)}" aria-label="{name}">{line}{label}</a></g>')
    boxes, arrows = len(diagram.nodes), len(diagram.edges)
    description = f"{boxes} {'box' if boxes == 1 else 'boxes'} and {arrows} {'arrow' if arrows == 1 else 'arrows'}: {diagram.caption}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" class="diagram-svg" viewBox="0 0 {VIEW_WIDTH} {_n(height)}" '
        f'width="{VIEW_WIDTH}" role="img" aria-labelledby="{title_id} {desc_id}">'
        f'<title id="{title_id}">{escape(diagram.title, quote=False)}</title>'
        f'<desc id="{desc_id}">{escape(description, quote=False)}</desc>'
        + "".join(body)
        + "</svg>"
    )


def _flow_mark(mark: DiagramNode, cx: float, top: float, boxw: float, chars: int, from_y: float, to_y: float) -> str:
    """A mark's box over or under its step, a short stub joining them, and its words; a link to what it names."""

    lines = _flow_label(mark.label, max(chars, 7), 2)
    # Thin rectangles, not lines: the read-back counts every `<line>` of a figure as an arrow.
    stub = f'<rect x="{_n(cx - 0.75)}" y="{_n(from_y)}" width="1.5" height="{_n(to_y - from_y)}" fill="var(--rule-strong)"/>'
    box = svg_box(cx - boxw / 2, top, boxw, _FLOW_MARK_H)
    text = svg_text(lines, cx, top + _FLOW_MARK_H / 2, size=11)
    name = escape(mark.label, quote=True)
    return f'<g data-node="{escape(mark.record, quote=True)}"><a href="{escape(mark.href, quote=True)}" aria-label="{name}">{stub}{box}{text}</a></g>'
