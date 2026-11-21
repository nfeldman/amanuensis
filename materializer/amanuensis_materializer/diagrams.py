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
from .vocabulary import (
    STATUS_PREREQUISITES,
    SURVEY_PASSES,
    VOCABULARY,
    VOCABULARY_CONTRACT_VERSION,
    labels,
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
    return heading, _dependency_blocks(edges, subs, caption(heading))


def dependency_blocks(conn: sqlite3.Connection, caption: str) -> tuple[Block, ...]:
    """The dependency section's body: the atlas when no edge is recorded, else the edge table."""

    return _dependency_blocks(*_dependency_rows(conn), caption)


def _dependency_blocks(
    edges: list[dict[str, Any]], subs: dict[str, dict[str, Any]], caption: str
) -> tuple[Block, ...]:
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
                AtlasItem(
                    _linked_subsystem(sid, subsystem["name"]),
                    depth_cell(label),
                    record=f"subsystem:{sid}",
                    state=str(subsystem["status"]),
                )
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
