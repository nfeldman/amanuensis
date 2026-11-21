"""Architecture projection generation from recorded survey state.

Every diagram is a pure function of DB rows — no relationships are inferred
from names. Surfaces may be portable Markdown
tables or Mermaid where a graph exists.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any

from .db import rows, table_exists
from .page import (
    COVERAGE_STATES,
    EMPTY,
    Atlas,
    AtlasItem,
    AtlasRegion,
    Block,
    BoundaryDiagram,
    BoundaryRow,
    Chip,
    CoverageIndex,
    CoverageReview,
    CoverageRow,
    DiagramSource,
    Inlines,
    Paragraph,
    RuntimeDiagram,
    RuntimeRow,
    StalenessBars,
    Topology,
    TopologyEdge,
)
from .prose import _plain, inlines
from .slugs import subsystem_page

# The obligation predicate is generated from the `obligation_bearing` flag on
# each file_classification value in contracts/conspectus-vocabulary.json, so the
# server and the projection cannot disagree about which scoped files carry work.
from .vocabulary import OBLIGATION_BEARING_SQL as _OBLIGATION_BEARING
from .vocabulary import labels

# An atlas prints a depth's contract label, as the HTML chip does, never the
# stored value.
_DEPTH_LABELS = labels("subsystem_status")


def _safe_label(text: str) -> str:
    # Mermaid doesn't like pipes or newlines inside node labels.
    return text.replace("|", "/").replace("\n", " ").replace('"', "'")


# The two headings the architecture page's first topology section can carry.
# The heading and the body are one decision (§9.2): a page headed "dependency
# graph" over an atlas would assert edges nobody recorded, so `render_architecture`
# takes both from `subsystem_dependency_view` rather than re-deciding on its own
# read of `xrefs`.
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


def subsystem_dependency_view(conn: sqlite3.Connection) -> tuple[str, str]:
    """The heading and body of the architecture page's dependency section."""
    edges = rows(
        conn,
        "SELECT from_id, to_id, relationship, strength, context FROM xrefs ORDER BY from_id",
    )
    subs = {
        r["id"]: r
        for r in rows(conn, "SELECT id, name, status, layer FROM subsystems")
    }
    if not subs and not edges:
        return ATLAS_HEADING, "_No subsystems recorded yet._"
    if not edges:
        lines = [
            "_No dependency edges are recorded in this publication. The layer map below is a subsystem atlas, not an inferred dependency graph._",
            "",
            "| Region | Subsystem | Survey depth |",
            "|---|---|---|",
        ]
        for sid, subsystem in sorted(subs.items(), key=lambda item: ((item[1].get("layer") or "Other"), item[0])):
            name = subsystem["name"]
            route = subsystem_page(sid, name)
            region = _safe_label(subsystem.get("layer") or "Other")
            lines.append(
                f"| {region} | **[{sid}]({route})** {_safe_label(name)} | {_DEPTH_LABELS.get(subsystem['status'], subsystem['status'])} |"
            )
        return ATLAS_HEADING, "\n".join(lines)

    # The census counts recorded subsystems an edge names, so an edge naming an
    # id no `subsystems` row carries cannot inflate the covered set.
    covered = {
        endpoint
        for edge in edges
        for endpoint in (edge["from_id"], edge["to_id"])
        if endpoint in subs
    }
    lines = [
        _edge_coverage_sentence(len(covered), len(subs)),
        "",
        "| From | Relationship | To | Strength | Context |",
        "|---|---|---|---|---|",
    ]
    for edge in edges:
        from_subsystem = subs.get(edge["from_id"], {"name": edge["from_id"]})
        to_subsystem = subs.get(edge["to_id"], {"name": edge["to_id"]})
        from_name = from_subsystem["name"]
        to_name = to_subsystem["name"]
        from_route = subsystem_page(edge["from_id"], from_name)
        to_route = subsystem_page(edge["to_id"], to_name)
        context = _safe_label(edge.get("context") or "No additional context recorded")
        lines.append(
            f"| **[{edge['from_id']}]({from_route})** {_safe_label(from_name)} "
            f"| {_safe_label(edge['relationship'])} "
            f"| **[{edge['to_id']}]({to_route})** {_safe_label(to_name)} "
            f"| {edge['strength']} | {context} |"
        )
    return DEPENDENCY_HEADING, "\n".join(lines)


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


def _no_boundary_sentence(unconnected: int, total: int) -> str:
    verb = "has" if unconnected == 1 else "have"
    noun = "subsystem" if total == 1 else "subsystems"
    return f"{unconnected} of {total} {noun} {verb} no recorded boundary."


def boundary_view(conn: sqlite3.Connection) -> str:
    """The boundary section: a sentence, or the census and the table the HTML draws."""
    graph = boundary_relations(conn)
    nodes, edges = graph["nodes"], graph["edges"]
    if not nodes:
        return "_No subsystems recorded yet._"
    touching: dict[str, list[tuple[str, str]]] = {node["id"]: [] for node in nodes}
    for edge in edges:
        if edge["kind"] == "seam":
            link = f"**[{edge['label']}](seams.html#{edge['label'].lower()})** seam"
            touching[edge["from"]].append((link, edge["to"]))
            touching[edge["to"]].append((link, edge["from"]))
        else:
            relationship = _safe_label(edge["label"])
            touching[edge["from"]].append((f"{relationship} →", edge["to"]))
            touching[edge["to"]].append((f"← {relationship}", edge["from"]))
    census = _no_boundary_sentence(sum(1 for found in touching.values() if not found), len(nodes))
    not_drawn = graph["not_drawn"]
    skipped = (
        f" {not_drawn} recorded relation{' names' if not_drawn == 1 else 's name'} one subsystem"
        " twice or a subsystem with no record, and is not drawn."
        if not_drawn
        else ""
    )
    if not edges:
        return f"_{BOUNDARY_NONE} {census}{skipped}_"

    kinds = []
    if any(edge["kind"] == "seam" for edge in edges):
        kinds.append("seam")
    if any(edge["kind"] == "xref" for edge in edges):
        kinds.append("recorded dependency")
    names = {node["id"]: node["name"] for node in nodes}

    def subsystem_cell(sid: str) -> str:
        return f"**[{sid}]({subsystem_page(sid, names[sid])})** {_safe_label(names[sid])}"

    lines = [
        f"_{census} Each {' and each '.join(kinds)} below joins two recorded subsystems;"
        f" no line is inferred from a name or a layer.{skipped}_",
        "",
        "| " + " | ".join(BOUNDARY_COLUMNS) + " |",
        "|---|---|---|---|",
    ]
    for node in nodes:
        sid = node["id"]
        layer = _safe_label(node["layer"])
        for boundary, other in touching[sid] or [("none recorded", "")]:
            other_cell = subsystem_cell(other) if other else "—"
            lines.append(f"| {layer} | {subsystem_cell(sid)} | {boundary} | {other_cell} |")
    return "\n".join(lines)


def subsystem_dependency_graph(conn: sqlite3.Connection) -> str:
    """Dependency surface from xrefs, or a truthful layer atlas without them."""
    return subsystem_dependency_view(conn)[1]

def staleness_map(conn: sqlite3.Connection) -> str:
    """Bar chart of stale entries per subsystem.

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
            "_No staleness data recorded. This conspectus predates ledger-derived "
            "staleness, so this view reports absence of measurement rather than "
            "freshness; the next reconciliation will populate it._"
        )
    rs = rows(
        conn,
        "SELECT subsystem_id, COUNT(*) AS n FROM file_ledger"
        " WHERE stale = 1 AND " + _OBLIGATION_BEARING + " GROUP BY subsystem_id ORDER BY n DESC",
    )
    if not rs:
        measured = rows(
            conn,
            "SELECT COUNT(*) AS n FROM file_ledger WHERE " + _OBLIGATION_BEARING,
        )
        scoped = measured[0]["n"] if measured else 0
        if not scoped:
            return (
                "_No staleness data recorded. No files have been scoped, so this "
                "view reports absence of measurement rather than freshness._"
            )
        return (
            f"_No stale files across {scoped} scoped file"
            f"{'' if scoped == 1 else 's'} carrying a survey obligation, at the last"
            " reconciliation._"
        )
    lines = ["```mermaid", "pie showData", '    title Stale entries by subsystem']
    for r in rs:
        lines.append(f'    "{r["subsystem_id"]}" : {r["n"]}')
    lines.append("```")
    return "\n".join(lines)


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


def _table_text(value: object) -> str:
    """One table cell whose pipes stay pipes, escaped as `\\|` (F2/codex, slice S2)."""

    return " ".join(str(value or "").split()).replace("|", "\\|")


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


def _recorded_runtime_table(conn: sqlite3.Connection) -> str | None:
    """The effective boundaries as the five-column table the HTML draws, or None."""

    edges = runtime_boundary_rows(conn)
    if not edges:
        return None
    lines = [
        "| " + " | ".join(RUNTIME_BOUNDARY_COLUMNS) + " |",
        "|" + "---|" * len(RUNTIME_BOUNDARY_COLUMNS),
    ]
    for edge in edges:
        cells = (
            edge["from_runtime"],
            edge["from_language"],
            edge["to_runtime"],
            edge["mechanism"],
            edge["notes"],
        )
        lines.append("| " + " | ".join(_table_text(cell) for cell in cells) + " |")
    return "\n".join(lines)


def runtime_boundary_state(conn: sqlite3.Connection) -> str:
    """`recorded` or `absent`: the one answer the page and the census both read."""
    return "recorded" if runtime_boundary_rows(conn) else "absent"


def runtime_boundary_map(conn: sqlite3.Connection) -> str:
    """Project the recorded runtime boundaries into architecture output."""
    table = _recorded_runtime_table(conn)
    if table is None:
        return f"_{RUNTIME_BOUNDARY_ABSENT}_"
    label = imported_runtime_line(runtime_boundary_rows(conn))
    return "\n\n".join(
        [
            "_Projected from the recorded runtime boundaries; mechanisms and targets"
            " are preserved as recorded._",
            table,
            *([label] if label else []),
        ]
    )


# ---------------------------------------------------------------------------
# The same sections as page blocks (store-only PLAN §3.2 step 4). The architecture
# page prints these; the Markdown functions above stay for the pages that
# still hand Markdown to the parser. Each takes the caption its section names.
# ---------------------------------------------------------------------------


def _sentence(text: str) -> Paragraph:
    return Paragraph(inlines(text))


def _linked_subsystem(sid: str, name: str) -> Inlines:
    """`**[ID](page)** Name`, the cell every table of subsystems opens its rows with."""

    return inlines(f"**[{sid}]({subsystem_page(sid, name)})** {_safe_label(name)}")


def dependency_blocks(conn: sqlite3.Connection, caption: str) -> tuple[Block, ...]:
    """The dependency section's body: the atlas when no edge is recorded, else the edge table."""

    edges = rows(
        conn,
        "SELECT from_id, to_id, relationship, strength, context FROM xrefs ORDER BY from_id",
    )
    subs = {r["id"]: r for r in rows(conn, "SELECT id, name, status, layer FROM subsystems")}
    if not subs and not edges:
        return (_sentence("_No subsystems recorded yet._"),)
    if not edges:
        regions: dict[str, list[AtlasItem]] = {}
        for sid, subsystem in sorted(
            subs.items(), key=lambda item: ((item[1].get("layer") or "Other"), item[0])
        ):
            region = _plain(_safe_label(subsystem.get("layer") or "Other")) or "Other"
            label = _DEPTH_LABELS.get(subsystem["status"], subsystem["status"])
            regions.setdefault(region, []).append(
                AtlasItem(_linked_subsystem(sid, subsystem["name"]), depth_cell(label))
            )
        return (
            _sentence(
                "_No dependency edges are recorded in this publication. The layer map below is a subsystem atlas, not an inferred dependency graph._"
            ),
            Atlas(caption, tuple(AtlasRegion(name, tuple(items)) for name, items in regions.items())),
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
    touching: dict[str, list[tuple[str, str, str]]] = {node["id"]: [] for node in nodes}
    for edge in edges:
        if edge["kind"] == "seam":
            label = edge["label"]
            touching[edge["from"]].append((f"{label} seam", label, edge["to"]))
            touching[edge["to"]].append((f"{label} seam", label, edge["from"]))
        else:
            relationship = _safe_label(edge["label"])
            touching[edge["from"]].append((f"{relationship} →", "", edge["to"]))
            touching[edge["to"]].append((f"← {relationship}", "", edge["from"]))
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
    rows_out: list[BoundaryRow] = []
    for node in nodes:
        sid = node["id"]
        layer = _plain(_safe_label(node["layer"])) or "unlayered"
        for boundary, seam_id, other in touching[sid] or [("none recorded", "", "")]:
            rows_out.append(
                BoundaryRow(
                    layer=layer,
                    subsystem_id=sid,
                    name=_plain(_safe_label(names[sid])),
                    other_id=other,
                    relation=boundary,
                    seam=bool(seam_id),
                    seam_id=seam_id,
                )
            )
    return (
        _sentence(
            f"_{census} Each {' and each '.join(kinds)} below joins two recorded subsystems;"
            f" no line is inferred from a name or a layer.{skipped}_"
        ),
        BoundaryDiagram(caption, tuple(rows_out)),
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
    """The staleness section's body: bars of stale files per subsystem, or what is not measured."""

    text = staleness_map(conn)
    if not text.startswith("```mermaid"):
        return (_sentence(text),)
    values: list[tuple[str, float]] = []
    for line in text.splitlines()[3:-1]:
        match = re.fullmatch(r'"(.+?)"\s*:\s*([0-9.]+)', line.strip())
        if match:
            values.append((match.group(1), float(match.group(2))))
    return (StalenessBars(tuple(values)),) if values else (DiagramSource(text),)


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
                    )
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
