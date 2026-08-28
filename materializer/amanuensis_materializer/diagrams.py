"""Architecture projection generation from recorded survey state.

Every diagram is a pure function of DB rows or registered prose artifacts —
no relationships are inferred from names. Surfaces may be portable Markdown
tables or Mermaid where a graph exists.
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from .db import rows
from .slugs import subsystem_page


def _safe_label(text: str) -> str:
    # Mermaid doesn't like pipes or newlines inside node labels.
    return text.replace("|", "/").replace("\n", " ").replace('"', "'")


def subsystem_dependency_graph(conn: sqlite3.Connection) -> str:
    """Dependency surface from xrefs, or a truthful layer atlas without them."""
    edges = rows(
        conn,
        "SELECT from_id, to_id, relationship, strength, context FROM xrefs ORDER BY from_id",
    )
    subs = {
        r["id"]: r
        for r in rows(conn, "SELECT id, name, status, layer FROM subsystems")
    }
    if not subs and not edges:
        return "_No subsystems recorded yet._"
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
                f"| {region} | **[{sid}]({route})** {_safe_label(name)} | {subsystem['status']} |"
            )
        return "\n".join(lines)

    lines = [
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
    return "\n".join(lines)

def concern_coverage_heatmap(conn: sqlite3.Connection) -> str:
    """Table-form heatmap (mermaid doesn't do heatmaps natively; we use
    a GitHub-rendered table with emoji cells)."""
    ss = rows(conn, "SELECT id, name, status FROM subsystems ORDER BY id")
    cn = rows(
        conn,
        "SELECT code, category FROM concerns WHERE status='active' ORDER BY code",
    )
    if not ss or not cn:
        return "_Heatmap requires at least one subsystem and one active concern._"
    disp = rows(
        conn,
        "SELECT subsystem_id, concern_code, classification, linchpin_dependent FROM dispositions",
    )
    key = {(d["subsystem_id"], d["concern_code"]): d for d in disp}

    def cell(subsystem_id: str, concern_code: str) -> str:
        d = key.get((subsystem_id, concern_code))
        if not d:
            return "—"
        c = d["classification"]
        lp = d["linchpin_dependent"]
        base = {
            "confirmed-bug": "🔴",
            "confirmed-acceptable": "🟡",
            "ruled-out": "🟢",
            "out-of-scope": "⚪",
            "unresolved-competition": "⚠️",
        }.get(c, "?")
        return f"{base}{'🔗' if lp else ''}"

    # Header row: concern codes.
    header = "| Subsystem | " + " | ".join(c["code"] for c in cn) + " |"
    sep = "|---|" + "|".join(["---"] * len(cn)) + "|"
    body = []
    for s in ss:
        row_cells = [cell(s["id"], c["code"]) for c in cn]
        body.append(f"| **{s['id']}** {s['name']} | " + " | ".join(row_cells) + " |")
    legend = (
        "\n\n**Legend**: 🟢 ruled-out · 🟡 confirmed-acceptable · 🔴 confirmed-bug · "
        "⚠️ unresolved-competition · ⚪ out-of-scope · 🔗 linchpin-dependent · — not assessed"
    )
    return "\n".join([header, sep, *body]) + legend


def staleness_map(conn: sqlite3.Connection) -> str:
    """Bar chart of stale entries per subsystem.

    An empty result is reported as absent measurement, not as health. The
    staleness columns live on `entries`, and a projection cannot tell a
    conspectus with nothing stale from one where nothing ever recorded
    staleness — so it must not assert the stronger of the two.
    """
    rs = rows(
        conn,
        "SELECT subsystem_id, COUNT(*) AS n FROM file_ledger WHERE stale = 1 GROUP BY subsystem_id ORDER BY n DESC",
    )
    if not rs:
        measured = rows(conn, "SELECT COUNT(*) AS n FROM file_ledger")
        scoped = measured[0]["n"] if measured else 0
        if not scoped:
            return (
                "_No staleness data recorded. No files have been scoped, so this "
                "view reports absence of measurement rather than freshness._"
            )
        return (
            f"_No stale files across {scoped} scoped file"
            f"{'' if scoped == 1 else 's'} at the last reconciliation._"
        )
    lines = ["```mermaid", "pie showData", '    title Stale entries by subsystem']
    for r in rs:
        lines.append(f'    "{r["subsystem_id"]}" : {r["n"]}')
    lines.append("```")
    return "\n".join(lines)


_RUNTIME_BOUNDARY_HEADERS = (
    "runtime / process",
    "language",
    "communicates with",
    "mechanism",
    "notes",
)


def _table_cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


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


def runtime_boundary_map(storage: Path) -> str:
    """Project the recorded onboarding runtime table into architecture output."""
    source = storage / "onboarding-report.md"
    table = _runtime_boundary_table(source.read_text() if source.exists() else "")
    if not table:
        return "_No structured runtime boundary map is recorded yet._"
    return "\n\n".join(
        [
            "_Projected from the recorded [onboarding runtime boundary table]"
            "(onboarding-report.md#runtime-boundary-map); mechanisms and targets "
            "are preserved as surveyed._",
            table,
        ]
    )


def seam_graph(conn: sqlite3.Connection) -> str:
    """Seams as a portable relation table; HTML builds connected areas."""
    seams = rows(conn, "SELECT * FROM seams ORDER BY id")
    if not seams:
        return "_No seams recorded yet._"
    subs = {
        r["id"]: r for r in rows(conn, "SELECT id, name FROM subsystems")
    }
    lines = [
        "| Seam | Party A | Shared object | Party B |",
        "|---|---|---|---|",
    ]
    for s in seams:
        party_a = s["party_a"]
        party_b = s["party_b"]
        name_a = subs.get(party_a, {}).get("name", party_a)
        name_b = subs.get(party_b, {}).get("name", party_b)
        route_a = subsystem_page(party_a, name_a)
        route_b = subsystem_page(party_b, name_b)
        lines.append(
            f"| **[{s['id']}](seams.md#{s['id'].lower()})** "
            f"| **[{party_a}]({route_a})** {_safe_label(name_a)} "
            f"| {_safe_label(s['shared_object'])} "
            f"| **[{party_b}]({route_b})** {_safe_label(name_b)} |"
        )
    return "\n".join(lines)
