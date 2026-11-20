#!/usr/bin/env python3
"""Gate for orientation packet O8 — the recorded-boundary diagram on the
architecture page (design/orientation/PLAN.md §2.5 item 2 and its layout,
§4 O8, §1.3).

Turns red when:

  - the SVG has a node count other than the subsystem count (the fixture has a
    `deferred` subsystem, a subsystem with no layer and two with no relation);
  - a node's `data-subsystem`, ID line or name line is not its subsystem's
    recorded ID and name, including the lowercase `auth` (name `Sign-in`),
    which is also an arrow's endpoint;
  - the SVG has a line count other than seams plus `xrefs`;
  - any line joins two subsystems no seam or xref names, read from geometry:
    each line's two ends must sit on the edges of the two boxes the record
    names, and a seam's label must be that seam's ID at the line's midpoint;
  - an xref is not drawn as an arrow from its `from_id` to its `to_id`, or a
    seam carries an arrow; an arrowhead is not one visible triangle (three
    distinct vertices, nonzero area) whose tip is its line's end and whose base
    lies behind the tip and across the line, or an xref line has no arrowhead
    or two;
  - the caption (the section heading, figcaption, SVG title and description)
    says "dependency" while zero `xrefs` are recorded;
  - the "N of M subsystems have no recorded boundary" count is wrong in either
    view;
  - the SVG lacks `role="img"`, a `<title>` or a `<desc>`;
  - the page contains `<script` referencing a diagram library;
  - zero seams and zero xrefs produce an SVG instead of a sentence;
  - the layout differs from §2.5: columns are not the layers in the order the
    Subsystem map lists them; boxes in a column are not in ID order; a box is
    not 200×44 with the ID on line 1 and the (truncated) name on line 2; lines
    are not drawn under the boxes; nine layers do not wrap to a second band;
  - the section is not the one after the atlas or dependency section and
    before the seam topology, in either view, or omits a subsystem or seam in
    the Markdown;
  - the gate does not run in CI.

False green it cannot exclude: the HTML checks read bytes; they do not drive a
browser, so overlapping labels or clipped text at a real store's size are not
measured.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed.
"""

from __future__ import annotations

import html as htmllib
import json
import re
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"

_SCRUB: tuple[tuple[str, str], ...] = (
    ("MODULE_NOT_FOUND", "module-absent"),
    ("ModuleNotFoundError", "python-module-absent"),
    ("Cannot find module", "cannot load module"),
    ("No such file or directory", "path is absent"),
    ("No such file", "path is absent"),
    ("can't open file", "cannot open path"),
    ("SyntaxError", "syntax-error"),
    ("ImportError", "python-import-error"),
    ("ReferenceError", "reference-error"),
    ("TypeError", "type-error"),
    ("AttributeError", "attribute-error"),
    ("Traceback (most recent call last)", "stack trace"),
    ("ENOENT", "PATH-ABSENT"),
    ("is not defined", "is undeclared"),
    ("command not found", "executable is absent"),
)


def scrub(text: object) -> str:
    out = "" if text is None else str(text)
    for needle, replacement in _SCRUB:
        out = out.replace(needle, replacement)
    return out


def emit(line: str = "") -> None:
    sys.stdout.write(f"{scrub(line)}\n")


FAILURES: list[str] = []


def check(label: str, fn: Callable[[], str | None]) -> None:
    try:
        reason = fn()
    except Exception as exc:  # the gate must survive any absent deliverable
        reason = f"raised while checking — {exc!r}"
    if reason:
        FAILURES.append(f"{label}: {reason}")
        emit(f"  FAIL {label}: {reason}")
    else:
        emit(f"  ok   {label}")


# ---------------------------------------------------------------------------
# What PLAN.md §2.5 fixes, written out here rather than imported.
# ---------------------------------------------------------------------------
SECTION = "Recorded boundaries"
BOX_W, BOX_H = 200, 44
MAX_NAME = 30
SHA = "bbbbbbbbbbbb2222bbbbbbbbbbbb2222bbbbbbbb"
LONG_NAME = "Background compaction and checkpoint scheduling coordinator"
NO_RELATION_SENTENCE = "No boundary between subsystems is recorded"
DIAGRAM_LIBRARIES = re.compile(
    r"mermaid|d3(?:\.min)?\.js|\bd3@|cytoscape|vis-network|vis\.js|dagre|elkjs|graphviz|viz\.js|sigma|jointjs|gojs",
    re.I,
)

Subsystem = tuple[str, str, str, str | None]  # id, name, status, layer

SUBSYSTEMS: tuple[Subsystem, ...] = (
    ("B-03", LONG_NAME, "structural", "backend"),
    ("B-01", "Read path", "mapped", "backend"),
    ("B-02", "Write path", "structural", "backend"),
    ("F-01", "Console", "scoping", "frontend"),
    ("F-02", "Charts", "deferred", "frontend"),
    ("T-01", "Release tooling", "mapped", "tooling"),
    ("U-01", "Loose scripts", "unmapped", None),
    # An ID outside the letters-dash-number shape, as an endpoint (F8/codex).
    ("auth", "Sign-in", "mapped", "frontend"),
)
# The Subsystem map lists layers ORDER BY layer: a missing layer sorts first
# and is headed "unlayered".
LAYER_ORDER = ("unlayered", "backend", "frontend", "tooling")
SEAMS: tuple[tuple[str, str, str, str], ...] = (
    ("SM-01", "row cache", "B-01", "B-02"),
    ("SM-02", "write queue", "B-02", "F-01"),
    ("SM-03", "release manifest", "T-01", "B-03"),
)
XREFS: tuple[tuple[str, str, str], ...] = (
    ("F-02", "B-01", "data-flow"),
    ("B-01", "B-03", "dependency"),
    ("auth", "F-01", "data-flow"),
)
QUIET: tuple[Subsystem, ...] = (
    ("A-01", "Alpha", "mapped", "core"),
    ("A-02", "Beta", "scoping", "core"),
    ("E-01", "Edge", "deferred", "edge"),
)
NINE_LAYERS = tuple(f"layer-{letter}" for letter in "abcdefghi")
WIDE: tuple[Subsystem, ...] = tuple(
    (f"L-{index + 1:02d}", f"Part {index + 1}", "mapped", layer) for index, layer in enumerate(NINE_LAYERS)
)
WIDE_SEAMS = (("SM-09", "shared table", "L-01", "L-09"),)


def seed(
    storage: Path,
    subsystems: tuple[Subsystem, ...],
    seams: tuple[tuple[str, str, str, str], ...] = (),
    xrefs: tuple[tuple[str, str, str], ...] = (),
) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-20T12:00:00Z')",
        (SHA, SHA),
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('o8', 'fixture')")
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer) VALUES (?, ?, ?, ?)",
        list(subsystems),
    )
    cur.executemany(
        "INSERT INTO seams (id, shared_object, party_a, party_b) VALUES (?, ?, ?, ?)",
        list(seams),
    )
    cur.executemany(
        "INSERT INTO xrefs (from_id, to_id, relationship) VALUES (?, ?, ?)",
        list(xrefs),
    )
    db.commit()
    db.close()


def publish(storage: Path) -> dict[str, Any]:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage)],
        capture_output=True,
        text=True,
        check=False,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    summary: dict[str, Any] = {}
    if lines:
        try:
            summary = json.loads(lines[-1])
        except json.JSONDecodeError:
            summary = {}
    summary["_returncode"] = proc.returncode
    if not summary.get("ok") and "_diagnostic" not in summary:
        summary["_diagnostic"] = scrub(proc.stderr)[-300:]
    return summary


def read(path: Path) -> str | None:
    try:
        return path.read_text()
    except OSError:
        return None


# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------
ATTR = re.compile(r'([\w:-]+)="([^"]*)"')


def attrs(tag: str) -> dict[str, str]:
    return {key: htmllib.unescape(value) for key, value in ATTR.findall(tag)}


def html_text(fragment: str) -> str:
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", "", fragment)).split())


def md_section(text: str, heading: str) -> str | None:
    match = re.search(rf"^## {re.escape(heading)}\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    return match.group(1) if match else None


def html_section(page: str, heading: str) -> str | None:
    for match in re.finditer(r"<h2\b[^>]*>(.*?)</h2>", page, re.S):
        if html_text(match.group(1)).lstrip("§").strip() == heading:
            end = page.find("<h2", match.end())
            return page[match.start() : end if end >= 0 else len(page)]
    return None


def h2s_md(text: str) -> list[str]:
    return [line[3:].strip() for line in text.splitlines() if line.startswith("## ")]


def h2s_html(page: str) -> list[str]:
    return [html_text(m).lstrip("§").strip() for m in re.findall(r"<h2\b[^>]*>(.*?)</h2>", page, re.S)]


class Box:
    def __init__(self, sid: str, x: float, y: float, w: float, h: float, lines: list[str]):
        self.sid, self.x, self.y, self.w, self.h, self.lines = sid, x, y, w, h, lines

    def on_edge(self, px: float, py: float, tol: float = 0.75) -> bool:
        inside_x = self.x - tol <= px <= self.x + self.w + tol
        inside_y = self.y - tol <= py <= self.y + self.h + tol
        on_vertical = abs(px - self.x) <= tol or abs(px - (self.x + self.w)) <= tol
        on_horizontal = abs(py - self.y) <= tol or abs(py - (self.y + self.h)) <= tol
        return inside_x and inside_y and (on_vertical or on_horizontal)


class Diagram:
    def __init__(self, svg: str):
        self.svg = svg
        self.open_tag = re.match(r"<svg\b[^>]*>", svg).group(0)  # type: ignore[union-attr]
        self.boxes: dict[str, Box] = {}
        self.node_order: list[str] = []
        for match in re.finditer(r'<g\b[^>]*class="[^"]*\bboundary-svg-node\b[^"]*"[^>]*>(.*?)</g>', svg, re.S):
            tag = re.match(r"<g\b[^>]*>", match.group(0)).group(0)  # type: ignore[union-attr]
            sid = attrs(tag).get("data-subsystem", "")
            rect = re.search(r"<rect\b[^>]*>", match.group(1))
            r = attrs(rect.group(0)) if rect else {}
            texts = [html_text(t) for t in re.findall(r"<text\b[^>]*>(.*?)</text>", match.group(1), re.S)]
            self.node_order.append(sid)
            self.boxes[sid] = Box(
                sid,
                float(r.get("x", "nan")),
                float(r.get("y", "nan")),
                float(r.get("width", "nan")),
                float(r.get("height", "nan")),
                texts,
            )
        self.node_start = svg.find("boundary-svg-node")
        self.lines: list[dict[str, Any]] = []
        for match in re.finditer(r"<line\b[^>]*>", svg):
            a = attrs(match.group(0))
            self.lines.append(
                {
                    "cls": a.get("class", ""),
                    "x1": float(a.get("x1", "nan")),
                    "y1": float(a.get("y1", "nan")),
                    "x2": float(a.get("x2", "nan")),
                    "y2": float(a.get("y2", "nan")),
                    "at": match.start(),
                }
            )
        self.labels: list[tuple[str, float, float]] = []
        for match in re.finditer(r'<text\b([^>]*class="[^"]*\bboundary-svg-label\b[^"]*"[^>]*)>(.*?)</text>', svg, re.S):
            a = attrs(match.group(1))
            self.labels.append((html_text(match.group(2)), float(a.get("x", "nan")), float(a.get("y", "nan"))))
        self.arrows = re.findall(r'<path\b[^>]*class="[^"]*\bboundary-svg-arrow\b[^"]*"[^>]*>', svg)
        self.column_labels = [
            html_text(t)
            for t in re.findall(r'<text\b[^>]*class="[^"]*\bboundary-svg-column\b[^"]*"[^>]*>(.*?)</text>', svg, re.S)
        ]

    def box_at(self, px: float, py: float) -> str | None:
        hits = [sid for sid, box in self.boxes.items() if box.on_edge(px, py)]
        return hits[0] if len(hits) == 1 else None


def diagram_of(page: str | None) -> Diagram | None:
    if page is None:
        return None
    found = re.findall(r'<svg\b[^>]*class="[^"]*\bboundary-svg\b[^"]*"[^>]*>.*?</svg>', page, re.S)
    if len(found) != 1:
        return None
    return Diagram(found[0])


COUNT = re.compile(r"(\d+) of (\d+) subsystems? (?:has|have) no recorded boundary")


def unconnected(subsystems: tuple[Subsystem, ...], seams: tuple, xrefs: tuple) -> int:
    touched = {s[2] for s in seams} | {s[3] for s in seams} | {x[0] for x in xrefs} | {x[1] for x in xrefs}
    return sum(1 for s in subsystems if s[0] not in touched)


def layer_label(layer: str | None) -> str:
    return layer or "unlayered"


def arrowhead_shape(d: str, xref_lines: list[dict[str, Any]]) -> tuple[str | None, int]:
    """(problem, index of the xref line it heads): a visible triangle whose tip is
    the line's end and whose base lies behind the tip, across the line."""

    if not re.fullmatch(r"\s*M[^MZ]*Z\s*", d):
        return f"an arrowhead path {d!r} is not one closed figure", -1
    numbers = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", d)]
    points = [(numbers[i], numbers[i + 1]) for i in range(0, len(numbers) - 1, 2)]
    if len(numbers) % 2 or len(points) != 3 or len(set(points)) != 3:
        return f"an arrowhead path {d!r} is not a triangle of three distinct vertices", -1
    (ax, ay), (bx, by), (cx, cy) = points
    area = abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
    if area < 10:
        return f"an arrowhead path {d!r} has area {area:g}; it would not show", -1
    for index, ln in enumerate(xref_lines):
        tip = next((p for p in points if abs(p[0] - ln["x2"]) <= 0.75 and abs(p[1] - ln["y2"]) <= 0.75), None)
        if tip is None:
            continue
        dx, dy = ln["x2"] - ln["x1"], ln["y2"] - ln["y1"]
        length = (dx * dx + dy * dy) ** 0.5 or 1.0
        ux, uy = dx / length, dy / length
        base = [p for p in points if p is not tip]
        behind = [(p[0] - tip[0]) * ux + (p[1] - tip[1]) * uy for p in base]
        across = [(p[0] - tip[0]) * uy - (p[1] - tip[1]) * ux for p in base]
        if not all(b <= -3 for b in behind):
            return f"an arrowhead path {d!r} does not point along its line toward the target", -1
        if not across[0] * across[1] < 0:
            return f"an arrowhead path {d!r} does not straddle its line", -1
        return None, index
    return f"an arrowhead path {d!r} does not sit at the end of an xref line", -1


def main() -> int:
    emit("GATE O8 — the recorded-boundary diagram on the architecture page")
    emit("")

    stores: dict[str, tuple[tuple[Subsystem, ...], tuple, tuple]] = {
        "seams": (SUBSYSTEMS, SEAMS, ()),
        "xrefs": (SUBSYSTEMS, SEAMS, XREFS),
        "quiet": (QUIET, (), ()),
        "wide": (WIDE, WIDE_SEAMS, ()),
    }
    with tempfile.TemporaryDirectory(prefix="o8-gate-") as tmp:
        root = Path(tmp)
        md: dict[str, str | None] = {}
        page: dict[str, str | None] = {}
        summaries: dict[str, dict[str, Any]] = {}
        for name, (subs, seams, xrefs) in stores.items():
            storage = root / name
            storage.mkdir()
            try:
                seed(storage, subs, seams, xrefs)
                summaries[name] = publish(storage)
            except Exception as exc:
                summaries[name] = {"_diagnostic": f"could not seed — {scrub(repr(exc))}"}
            md[name] = read(storage / "docs" / "architecture.md")
            page[name] = read(storage / "docs" / "architecture.html")

        def published() -> str | None:
            for name, result in summaries.items():
                if result.get("_returncode") != 0 or result.get("ok") is False:
                    return f"the {name} fixture did not publish — {result.get('_diagnostic', result)}"
                if md[name] is None or page[name] is None:
                    return f"the {name} fixture wrote no architecture.md and architecture.html"
            return None

        check("the fixtures publish", published)

        # -- the section's place ------------------------------------------------
        def section_placed() -> str | None:
            for name in stores:
                text, html_page = md[name], page[name]
                if text is None or html_page is None:
                    return f"the {name} architecture page is not published"
                for view, heads in (("Markdown", h2s_md(text)), ("HTML", h2s_html(html_page))):
                    if heads.count(SECTION) != 1:
                        return f"{name}: the {view} view has {heads.count(SECTION)} '{SECTION}' sections, expected one"
                    at = heads.index(SECTION)
                    before = heads[at - 1] if at else ""
                    after = heads[at + 1] if at + 1 < len(heads) else ""
                    if before not in ("Subsystem atlas", "Subsystem dependency graph") or after != "Seam topology":
                        return (
                            f"{name}: in the {view} view '{SECTION}' sits between {before!r} and {after!r};"
                            " it belongs after the atlas or dependency section and before the seam topology"
                        )
            return None

        check("the section follows the atlas or dependency section, before the seam topology", section_placed)

        # -- nodes and lines ----------------------------------------------------
        def nodes_are_subsystems() -> str | None:
            for name in ("seams", "xrefs", "wide"):
                subs = stores[name][0]
                diagram = diagram_of(page[name])
                if diagram is None:
                    return f"{name}: architecture.html does not carry exactly one boundary SVG"
                want = sorted(s[0] for s in subs)
                if sorted(diagram.node_order) != want:
                    return f"{name}: SVG nodes are {sorted(diagram.node_order)}, expected one per subsystem {want}"
            return None

        check("the SVG draws one box per subsystem, deferred, unlayered and unconnected included", nodes_are_subsystems)

        def lines_are_relations() -> str | None:
            for name in ("seams", "xrefs", "wide"):
                _subs, seams, xrefs = stores[name]
                diagram = diagram_of(page[name])
                if diagram is None:
                    return f"{name}: no boundary SVG"
                if len(diagram.lines) != len(seams) + len(xrefs):
                    return f"{name}: {len(diagram.lines)} lines for {len(seams)} seams and {len(xrefs)} xrefs"
                seam_lines = [ln for ln in diagram.lines if "boundary-svg-seam" in ln["cls"]]
                xref_lines = [ln for ln in diagram.lines if "boundary-svg-xref" in ln["cls"]]
                if len(seam_lines) != len(seams) or len(xref_lines) != len(xrefs):
                    return f"{name}: {len(seam_lines)} seam lines and {len(xref_lines)} xref lines, expected {len(seams)} and {len(xrefs)}"
                wanted_seams = {frozenset((a, b)): sid for sid, _obj, a, b in seams}
                drawn_seams: set[frozenset[str]] = set()
                for ln in seam_lines:
                    a = diagram.box_at(ln["x1"], ln["y1"])
                    b = diagram.box_at(ln["x2"], ln["y2"])
                    pair = frozenset((a or "?", b or "?"))
                    if pair not in wanted_seams:
                        return f"{name}: a seam line joins {a} and {b}, which no seam names"
                    drawn_seams.add(pair)
                    mx, my = (ln["x1"] + ln["x2"]) / 2, (ln["y1"] + ln["y2"]) / 2
                    label = [t for t, x, y in diagram.labels if abs(x - mx) <= 1 and abs(y - my) <= 8]
                    if label != [wanted_seams[pair]]:
                        return f"{name}: the line joining {a} and {b} is labelled {label} at its midpoint, expected [{wanted_seams[pair]!r}]"
                if len(drawn_seams) != len(seams):
                    return f"{name}: seam lines join {len(drawn_seams)} distinct pairs for {len(seams)} seams"
                wanted_xrefs = {(f, t) for f, t, _rel in xrefs}
                drawn_xrefs: set[tuple[str, str]] = set()
                for ln in xref_lines:
                    a = diagram.box_at(ln["x1"], ln["y1"])
                    b = diagram.box_at(ln["x2"], ln["y2"])
                    if (a, b) not in wanted_xrefs:
                        return f"{name}: an arrow runs from {a} to {b}, which no xref records in that direction"
                    drawn_xrefs.add((a, b))  # type: ignore[arg-type]
                if drawn_xrefs != wanted_xrefs:
                    return f"{name}: arrows drawn {sorted(drawn_xrefs)}, xrefs recorded {sorted(wanted_xrefs)}"
                if len(diagram.arrows) != len(xrefs):
                    return f"{name}: {len(diagram.arrows)} arrowheads for {len(xrefs)} xrefs; seams are undirected"
                headed: list[int] = []
                for path in diagram.arrows:
                    problem, line_at = arrowhead_shape(attrs(path).get("d", ""), xref_lines)
                    if problem:
                        return f"{name}: {problem}"
                    headed.append(line_at)
                if sorted(headed) != list(range(len(xref_lines))):
                    return f"{name}: arrowheads sit on xref lines {sorted(headed)}, expected one on each of {len(xref_lines)}"
            return None

        check("every line is a recorded seam or xref, joining the boxes the record names", lines_are_relations)

        # -- caption ------------------------------------------------------------
        def caption_words() -> str | None:
            for name in ("seams", "wide"):
                html_page, text = page[name], md[name]
                section = html_section(html_page or "", SECTION)
                md_part = md_section(text or "", SECTION)
                if section is None or md_part is None:
                    return f"{name}: no '{SECTION}' section to read"
                figcaption = re.search(r"<figcaption\b[^>]*>(.*?)</figcaption>", section, re.S)
                if not figcaption or SECTION not in html_text(figcaption.group(1)):
                    return f"{name}: the figure's caption does not say {SECTION!r}"
                for label, fragment in (("HTML section", html_text(section)), ("Markdown section", md_part)):
                    if re.search(r"dependenc", fragment, re.I):
                        return f"{name}: the {label} says 'dependency' with zero xrefs recorded"
            section = html_section(page["xrefs"] or "", SECTION)
            if section is None or not re.search(r"dependenc", html_text(section), re.I):
                return "xrefs: with xrefs recorded the caption does not name the dependency arrows"
            return None

        check("the caption says 'Recorded boundaries' and 'dependency' only when xrefs exist", caption_words)

        def no_boundary_count() -> str | None:
            for name, (subs, seams, xrefs) in stores.items():
                want = (unconnected(subs, seams, xrefs), len(subs))
                for view, fragment in (
                    ("Markdown", md_section(md[name] or "", SECTION)),
                    ("HTML", html_text(html_section(page[name] or "", SECTION) or "")),
                ):
                    if not fragment:
                        return f"{name}: no '{SECTION}' section in the {view} view"
                    counts = {(int(a), int(b)) for a, b in COUNT.findall(" ".join(fragment.split()))}
                    if counts != {want}:
                        return f"{name}: the {view} view states {sorted(counts)} subsystems with no recorded boundary, expected {want}"
            return None

        check("the 'N of M subsystems have no recorded boundary' count is right in both views", no_boundary_count)

        # -- accessibility and build time ----------------------------------------
        def accessible_svg() -> str | None:
            for name in ("seams", "xrefs", "wide"):
                diagram = diagram_of(page[name])
                if diagram is None:
                    return f"{name}: no boundary SVG"
                tag = attrs(diagram.open_tag)
                if tag.get("role") != "img":
                    return f"{name}: the SVG's role is {tag.get('role')!r}, not 'img'"
                title = re.search(r'<title\b([^>]*)>(.*?)</title>', diagram.svg, re.S)
                desc = re.search(r'<desc\b([^>]*)>(.*?)</desc>', diagram.svg, re.S)
                if not title or not html_text(title.group(2)) or not desc or not html_text(desc.group(2)):
                    return f"{name}: the SVG lacks a non-empty <title> or <desc>"
                labelled = set(tag.get("aria-labelledby", "").split())
                if attrs(title.group(1)).get("id") not in labelled or attrs(desc.group(1)).get("id") not in labelled:
                    return f"{name}: aria-labelledby does not name the title and the description"
            return None

        check("the SVG has role=img, a title and a description it is labelled by", accessible_svg)

        def no_diagram_runtime() -> str | None:
            for name in stores:
                for script in re.findall(r"<script\b[^>]*>.*?</script>", page[name] or "", re.S | re.I):
                    hit = DIAGRAM_LIBRARIES.search(script)
                    if hit:
                        return f"{name}: a <script> references the diagram library {hit.group(0)!r}"
            return None

        check("no <script> on the page references a diagram library", no_diagram_runtime)

        def sentence_without_relations() -> str | None:
            html_page, text = page["quiet"], md["quiet"]
            section = html_section(html_page or "", SECTION)
            md_part = md_section(text or "", SECTION)
            if section is None or md_part is None:
                return f"quiet: no '{SECTION}' section"
            if "<svg" in section or diagram_of(html_page) is not None:
                return "zero seams and zero xrefs produce an SVG instead of a sentence"
            if NO_RELATION_SENTENCE not in html_text(section) or NO_RELATION_SENTENCE not in md_part:
                return f"zero seams and zero xrefs do not produce the sentence {NO_RELATION_SENTENCE!r} in both views"
            if "|" in md_part:
                return "zero seams and zero xrefs still produce a boundary table in the Markdown"
            return None

        check("zero seams and zero xrefs produce a sentence, not an SVG", sentence_without_relations)

        # -- layout -------------------------------------------------------------
        def layout() -> str | None:
            diagram = diagram_of(page["seams"])
            if diagram is None:
                return "seams: no boundary SVG"
            for sid, box in diagram.boxes.items():
                if (box.w, box.h) != (BOX_W, BOX_H):
                    return f"{sid}'s box is {box.w:g}×{box.h:g}, expected {BOX_W}×{BOX_H}"
            names = {s[0]: s[1] for s in SUBSYSTEMS}
            for sid, box in diagram.boxes.items():
                if len(box.lines) != 2 or box.lines[0] != sid:
                    return f"{sid}'s box reads {box.lines}, expected the ID on line 1 and the name on line 2"
                name = names[sid]
                shown = box.lines[1]
                if len(name) <= MAX_NAME - 5 and shown != name:
                    return f"{sid}'s box shows {shown!r}, its name is {name!r}"
                if len(name) > MAX_NAME and not (
                    len(shown) <= MAX_NAME and shown.endswith("…") and name.startswith(shown[:-1].rstrip())
                ):
                    return f"{sid}'s long name shows as {shown!r}, not truncated to {MAX_NAME} characters with an ellipsis"
            columns: list[float] = []
            for layer in LAYER_ORDER:
                members = sorted(s[0] for s in SUBSYSTEMS if layer_label(s[3]) == layer)
                xs = {diagram.boxes[sid].x for sid in members}
                if len(xs) != 1:
                    return f"layer {layer!r}'s boxes are not in one column: x = {sorted(xs)}"
                columns.append(xs.pop())
                ys = [diagram.boxes[sid].y for sid in members]
                if ys != sorted(ys) or len(set(ys)) != len(ys):
                    return f"layer {layer!r}'s boxes are not in ID order down the column: {list(zip(members, ys, strict=True))}"
            if columns != sorted(columns) or len(set(columns)) != len(columns):
                return f"columns are not the layers {list(LAYER_ORDER)} left to right: x = {columns}"
            if diagram.column_labels[: len(LAYER_ORDER)] != list(LAYER_ORDER):
                return f"the column labels read {diagram.column_labels}, expected {list(LAYER_ORDER)}"
            if any(ln["at"] > diagram.node_start for ln in diagram.lines):
                return "a line is drawn after the boxes; lines belong under them"
            return None

        check("columns are layers in Subsystem-map order, boxes 200×44 in ID order, lines under boxes", layout)

        def wraps() -> str | None:
            diagram = diagram_of(page["wide"])
            if diagram is None:
                return "wide: no boundary SVG"
            boxes = [diagram.boxes.get(s[0]) for s in WIDE]
            if any(box is None for box in boxes):
                return "wide: a subsystem has no box"
            first = boxes[:8]
            last = boxes[8]
            xs = [b.x for b in first]  # type: ignore[union-attr]
            if xs != sorted(xs) or len(set(xs)) != 8:
                return f"the first eight layers are not eight columns left to right: x = {xs}"
            if last.y < max(b.y + b.h for b in first) or last.x != first[0].x:  # type: ignore[union-attr]
                return "the ninth layer does not wrap to a second band under the first column"
            return None

        check("above eight layers the SVG wraps to a second band", wraps)

        # -- Markdown account -----------------------------------------------------
        def markdown_account() -> str | None:
            for name in ("seams", "xrefs"):
                subs, seams, xrefs = stores[name]
                part = md_section(md[name] or "", SECTION)
                if part is None:
                    return f"{name}: no Markdown section"
                for sid, *_rest in subs:
                    if not re.search(rf"\[{re.escape(sid)}\]\(subsystems/", part):
                        return f"{name}: the Markdown section does not link subsystem {sid}"
                for seam in seams:
                    if not re.search(rf"\[{re.escape(seam[0])}\]\(seams\.md#{seam[0].lower()}\)", part):
                        return f"{name}: the Markdown section does not link seam {seam[0]}"
                for from_id, to_id, rel in xrefs:
                    if rel not in part:
                        return f"{name}: the Markdown section omits the xref {from_id} {rel} {to_id}"
            return None

        check("the Markdown view links every subsystem and seam and names every xref", markdown_account)

    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if text is None:
            return "the CI workflow is not readable"
        if not re.search(r"run:\s*python3 test-orientation-diagram\.py\b", text):
            return "no CI step runs test-orientation-diagram.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE O8 RED: {FAILURES[0]}"[:400])
        return 1
    emit("GATE O8 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
