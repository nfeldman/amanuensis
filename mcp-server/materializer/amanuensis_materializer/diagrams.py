"""Mermaid diagram generation from DB state.

Every diagram is a pure function of DB rows — no hand-authored content.
Returned as markdown strings containing a mermaid fenced block.
"""
from __future__ import annotations

import sqlite3

from .db import rows
from .slugs import subsystem_slug


def _safe_label(text: str) -> str:
    # Mermaid doesn't like pipes or newlines inside node labels.
    return text.replace("|", "/").replace("\n", " ").replace('"', "'")


def subsystem_dependency_graph(conn: sqlite3.Connection) -> str:
    """Directed graph from xrefs, colored by subsystem status."""
    edges = rows(
        conn,
        "SELECT from_id, to_id, relationship, strength FROM xrefs ORDER BY from_id",
    )
    subs = {
        r["id"]: r
        for r in rows(conn, "SELECT id, name, status FROM subsystems")
    }
    if not subs and not edges:
        return "_No subsystems recorded yet._"
    lines = ["```mermaid", "graph LR"]
    # Declare nodes with labels.
    for sid, s in sorted(subs.items()):
        label = f"{sid}<br/>{_safe_label(s['name'])}"
        node = subsystem_slug(sid)
        lines.append(f'    {node}["{label}"]')
    # Edges.
    for e in edges:
        a = subsystem_slug(e["from_id"])
        b = subsystem_slug(e["to_id"])
        lines.append(f'    {a} -->|{_safe_label(e["relationship"])}| {b}')
    # Class definitions for status coloring.
    lines.extend(
        [
            "    classDef mapped fill:#d9f7d9,stroke:#1e7a1e,color:#0a3a0a;",
            "    classDef adversarial fill:#fff4c7,stroke:#b58900,color:#584500;",
            "    classDef concerns fill:#fff4c7,stroke:#b58900,color:#584500;",
            "    classDef structural fill:#ffe6c7,stroke:#b5561e,color:#582b08;",
            "    classDef scoping fill:#e6f0ff,stroke:#1e4fb5,color:#0a2358;",
            "    classDef unmapped fill:#f0f0f0,stroke:#888,color:#333;",
            "    classDef deferred fill:#fce0e0,stroke:#a33,color:#500;",
        ]
    )
    for sid, s in subs.items():
        node = subsystem_slug(sid)
        lines.append(f"    class {node} {s['status']};")
    lines.append("```")
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
    """Bar chart of stale entries per subsystem."""
    rs = rows(
        conn,
        "SELECT subsystem_id, COUNT(*) AS n FROM entries WHERE stale = 1 AND subsystem_id IS NOT NULL GROUP BY subsystem_id ORDER BY n DESC",
    )
    if not rs:
        return "_No stale entries — the conspectus is fresh._"
    lines = ["```mermaid", "pie showData", '    title Stale entries by subsystem']
    for r in rs:
        lines.append(f'    "{r["subsystem_id"]}" : {r["n"]}')
    lines.append("```")
    return "\n".join(lines)


def runtime_boundary_placeholder() -> str:
    # The onboarding-report.md holds the runtime boundary table as prose;
    # when we have structural data for it we'll generate a mermaid diagram
    # here. For v0.1 we leave a placeholder the index can reference.
    return (
        "_The runtime boundary map is authored in `onboarding-report.md`. "
        "A generated mermaid version will replace this placeholder once "
        "structural runtime data is in the schema._"
    )


def seam_graph(conn: sqlite3.Connection) -> str:
    """Seams as labeled edges between subsystems."""
    seams = rows(conn, "SELECT * FROM seams ORDER BY id")
    if not seams:
        return "_No seams recorded yet._"
    lines = ["```mermaid", "graph LR"]
    subs = {
        r["id"]: r for r in rows(conn, "SELECT id, name FROM subsystems")
    }
    nodes: dict[str, bool] = {}
    for s in seams:
        for sid in (s["party_a"], s["party_b"]):
            if sid in nodes:
                continue
            name = subs.get(sid, {}).get("name", sid)
            lines.append(f'    {subsystem_slug(sid)}["{sid}<br/>{_safe_label(name)}"]')
            nodes[sid] = True
    for s in seams:
        a = subsystem_slug(s["party_a"])
        b = subsystem_slug(s["party_b"])
        label = f"{s['id']}<br/>{_safe_label(s['shared_object'])}"
        lines.append(f'    {a} <-->|"{label}"| {b}')
    lines.append("```")
    return "\n".join(lines)
