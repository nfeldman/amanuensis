#!/usr/bin/env python3
"""Gate for orientation packet O7 — the Subsystem map carries the atlas and one
name (design/orientation/PLAN.md §2.5 item 1, §2.7, §4 O7, D3).

Turns red when:

  - the Markdown H1 of `master-plan.md` is anything but "Subsystem map" (the
    old "Master plan" heading, or a heading that differs from the page title);
  - `master-plan.html` has no `class="subsystem-atlas"`, has more than one, or
    carries a number of `atlas-item` entries other than one per subsystem — the
    fixture has three layers and one subsystem at every survey depth the schema
    admits, so a filter on any status or layer drops a row;
  - the atlas does not sit above the per-layer tables, in either view;
  - an atlas row's region, subsystem ID, name, link or survey depth differs from
    the subsystem's recorded layer, ID, name and status, or a deferred
    subsystem's depth reads as anything but "deferred"; or an HTML depth is not
    the status chip of the recorded value;
  - the atlas's regions are not the layers, in the order the per-layer tables
    follow, or a region's count differs from its subsystems;
  - the Markdown carries the atlas table (Region | Subsystem | Survey depth)
    with a different set of rows than the HTML atlas shows, or a depth cell
    that is the stored value rather than the contract's label (the HTML prints
    the label, so the two views would disagree);
  - the per-layer tables are gone or changed: each layer keeps its own `##`
    heading and its Priority/ID/Name/Status table with one row per subsystem;
  - a store with no subsystems renders an atlas table or atlas element instead
    of the existing sentence, or loses the "Subsystem map" H1;
  - the gate does not run in CI.

Also red when a published HTML page hides its report from assistive technology
(`orientation_exposure.hidden_pages`: `aria-hidden="true"`, `hidden`, `inert`,
an inline `display: none` or `role="presentation"` on `<main>`, the page head,
the article or any element around them), which every text check above reads
straight through.

False green it cannot exclude: the fixture is eight subsystems in three layers,
so a layout that fails only at 35 rows is exercised by count. The HTML checks
read bytes; they do not drive a browser.

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

from orientation_exposure import hidden_pages

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
# What PLAN.md §2.5 and D3 fix, written out here rather than imported.
# ---------------------------------------------------------------------------
PAGE_TITLE = "Subsystem map"
ATLAS_HEADER = ["Region", "Subsystem", "Survey depth"]
SHA = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"

# id, name, status, layer, scope — three layers, every legal survey depth (so a
# filter on any one status drops a row), and a layer whose only subsystem is
# deferred (so dropping deferred drops a region).
SUBSYSTEMS: tuple[tuple[str, str, str, str, str], ...] = (
    ("B-01", "Read path", "mapped", "backend", "src/reader.ts"),
    ("B-02", "Write path", "structural", "backend", "src/writer.ts"),
    ("B-03", "Cache", "concerns", "backend", "src/cache.ts"),
    ("B-04", "Index", "adversarial", "backend", "src/index.ts"),
    ("F-01", "Console", "scoping", "frontend", "ui/console.ts"),
    ("F-02", "Charts", "deferred", "frontend", "ui/charts.ts"),
    ("F-03", "Settings", "unmapped", "frontend", "ui/settings.ts"),
    ("T-01", "Release tooling", "deferred", "tooling", "scripts/release.sh"),
)
# Layer order the per-layer tables follow: ORDER BY layer.
LAYER_ORDER = ("backend", "frontend", "tooling")
# What both views print for each recorded status: the contract's label, never
# the stored value. "scoping" reads "Scoped" (D4); "concerns" and "adversarial"
# print the contract's in-progress labels.
DEPTH_LABEL = {
    "unmapped": "unmapped",
    "scoping": "scoped",
    "structural": "structural",
    "concerns": "reviewing concerns",
    "adversarial": "challenging claims",
    "mapped": "mapped",
    "deferred": "deferred",
}


def legal_depths() -> set[str]:
    """The statuses `subsystems.status` admits, read from the schema's CHECK."""

    table = re.search(r"CREATE TABLE IF NOT EXISTS subsystems\s*\((.*?)\n\);", SCHEMA.read_text(), re.S)
    check_clause = re.search(r"\bstatus\b[^\n]*\n?[^(]*CHECK \(status IN \((.*?)\)\)", table.group(1) if table else "", re.S)
    return set(re.findall(r"'([a-z_]+)'", check_clause.group(1))) if check_clause else set()


def slug_href(sid: str, name: str) -> str:
    """The subsystem page, written out: `<id without dash>-<slugified name>`."""

    slug = re.sub(r"-+", "-", re.sub(r"[^a-z0-9-]+", "-", name.lower())).strip("-")
    return f"subsystems/{sid.lower().replace('-', '')}-{slug}"


def seed(storage: Path, subsystems: tuple[tuple[str, str, str, str, str], ...]) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-20T12:00:00Z')",
        (SHA, SHA),
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('o7', 'fixture')")
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope) VALUES (?, ?, ?, ?, ?)",
        list(subsystems),
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
LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def md_visible(text: str) -> str:
    text = LINK.sub(r"\1", text)
    return " ".join(re.sub(r"\*\*(.+?)\*\*|`([^`]*)`", lambda m: m.group(1) or m.group(2) or "", text).split())


def html_text(fragment: str) -> str:
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", "", fragment)).split())


def md_h1s(text: str) -> list[str]:
    return [line[2:].strip() for line in text.splitlines() if line.startswith("# ")]


def md_tables(text: str) -> list[tuple[str, list[str], list[list[str]]]]:
    """(the `##` heading above it, header cells, body rows) for every table."""

    out: list[tuple[str, list[str], list[list[str]]]] = []
    heading = ""
    current: tuple[str, list[str], list[list[str]]] | None = None
    for line in text.splitlines():
        stripped = line.strip()
        if line.startswith("## "):
            heading = line[3:].strip()
        if not stripped.startswith("|"):
            current = None
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if all(cell and set(cell) <= {"-", ":", " "} for cell in cells):
            continue
        if current is None:
            current = (heading, cells, [])
            out.append(current)
        else:
            current[2].append(cells)
    return out


def html_atlas(page: str) -> list[tuple[str, int, list[tuple[str, str, str]]]] | None:
    """[(region, stated count, [(subsystem text, href, depth)])] of the one atlas."""

    start = page.find('<div class="subsystem-atlas"')
    if start < 0:
        return None
    end = page.find("<h2", start)
    atlas = re.search(r".*", page[start : end if end >= 0 else len(page)], re.S)
    if not atlas:
        return None
    regions: list[tuple[str, int, list[tuple[str, str, str]]]] = []
    for region in re.findall(r'<section class="atlas-region">.*?</section>', atlas.group(0), re.S):
        name = html_text(re.search(r"<h3>(.*?)</h3>", region, re.S).group(1))  # type: ignore[union-attr]
        count = re.search(r'class="atlas-region-count">(\d+) subsystem', region)
        items: list[tuple[str, str, str]] = []
        for item in re.findall(r'<li class="atlas-item">(.*?)</li>', region, re.S):
            link = re.search(r'<a\b[^>]*href="([^"]*)"', item)
            subsystem = re.search(r'<div class="atlas-subsystem"[^>]*>(.*?)</div>', item, re.S)
            depth = re.search(r'<div class="atlas-depth">(.*?)</div>', item, re.S)
            items.append(
                (
                    html_text(subsystem.group(1)) if subsystem else "",
                    htmllib.unescape(link.group(1)) if link else "",
                    html_text(depth.group(1)) if depth else "",
                )
            )
        regions.append((name, int(count.group(1)) if count else -1, items))
    return regions


def expected_rows() -> list[tuple[str, str, str, str]]:
    """(region, id, name, depth) in the order the per-layer tables follow."""

    return [
        (layer, sid, name, status)
        for layer in LAYER_ORDER
        for sid, name, status, lay, _scope in SUBSYSTEMS
        if lay == layer
    ]


def main() -> int:
    emit("GATE O7 — the Subsystem map carries the atlas and one name")
    emit("")

    with tempfile.TemporaryDirectory(prefix="o7-gate-") as tmp:
        root = Path(tmp)
        storage = root / "store"
        storage.mkdir()
        empty = root / "empty"
        empty.mkdir()
        seeded = True
        try:
            seed(storage, SUBSYSTEMS)
            seed(empty, ())
        except Exception as exc:
            seeded = False
            FAILURES.append(f"fixture: could not seed a store — {scrub(repr(exc))}")
            emit(f"  FAIL fixture: could not seed a store — {scrub(repr(exc))}")
        summary: dict[str, Any] = publish(storage) if seeded else {}
        empty_summary: dict[str, Any] = publish(empty) if seeded else {}
        docs = storage / "docs"
        md = read(docs / "master-plan.md")
        page = read(docs / "master-plan.html")

        def published() -> str | None:
            for label, result, folder in (("seeded", summary, docs), ("empty", empty_summary, empty / "docs")):
                if not result or result.get("_returncode") != 0 or result.get("ok") is False:
                    return f"the materializer did not publish the {label} fixture — {result.get('_diagnostic', result)}"
                if not (folder / "master-plan.md").is_file() or not (folder / "master-plan.html").is_file():
                    return f"the {label} fixture wrote no master-plan.md and master-plan.html"
            return None

        check("the fixtures publish", published)

        def title_is_one_name() -> str | None:
            if md is None or page is None:
                return "master-plan.md or master-plan.html is not published"
            h1s = md_h1s(md)
            if h1s != [PAGE_TITLE]:
                return f"the Markdown's H1 headings are {h1s}, not [{PAGE_TITLE!r}] (D3)"
            if "Master plan" in md or "Master plan" in html_text(page):
                return "the old heading 'Master plan' still appears on the page"
            title = re.search(r"<h1\b[^>]*>(.*?)</h1>", page, re.S)
            if not title or html_text(title.group(1)) != PAGE_TITLE:
                return f"the HTML's H1 is {html_text(title.group(1)) if title else None!r}, not {PAGE_TITLE!r}"
            return None

        check("the page's H1 is 'Subsystem map' in both views, and 'Master plan' is gone", title_is_one_name)

        # -- the atlas in HTML ------------------------------------------------
        def atlas_item_per_subsystem() -> str | None:
            if page is None:
                return "master-plan.html is not published"
            found = len(re.findall(r'class="subsystem-atlas"', page))
            if found != 1:
                return f"{found} elements carry class=\"subsystem-atlas\", expected exactly one"
            items = len(re.findall(r'class="atlas-item"', page))
            if items != len(SUBSYSTEMS):
                return f"{items} atlas-item entries for {len(SUBSYSTEMS)} subsystems (deferred included)"
            return None

        check("master-plan.html has one subsystem-atlas with one atlas-item per subsystem", atlas_item_per_subsystem)

        def fixture_covers_every_depth() -> str | None:
            legal = legal_depths()
            if not legal:
                return "could not read the legal subsystem statuses from schema.sql"
            seeded_depths = {status for _sid, _name, status, _layer, _scope in SUBSYSTEMS}
            if seeded_depths != legal or set(DEPTH_LABEL) != legal:
                return f"the fixture seeds {sorted(seeded_depths)}, the schema admits {sorted(legal)}"
            return None

        check("the fixture seeds every survey depth the schema admits", fixture_covers_every_depth)

        def atlas_rows_match_record() -> str | None:
            if page is None:
                return "master-plan.html is not published"
            regions = html_atlas(page)
            if regions is None:
                return "no subsystem-atlas element to read"
            if [name for name, _c, _i in regions] != list(LAYER_ORDER):
                return f"atlas regions are {[n for n, _c, _i in regions]}, expected the layers {list(LAYER_ORDER)}"
            expected = expected_rows()
            seen: list[tuple[str, str, str, str]] = []
            for name, count, items in regions:
                if count != len(items):
                    return f"region {name!r} states {count} subsystems but lists {len(items)}"
                for text, href, depth in items:
                    seen.append((name, text, href, depth))  # type: ignore[arg-type]
            if len(seen) != len(expected):
                return f"{len(seen)} atlas rows, expected {len(expected)}"
            for (region, text, href, depth), (layer, sid, name, status) in zip(seen, expected, strict=True):
                if region != layer:
                    return f"{sid} sits in region {region!r}, its layer is {layer!r}"
                if sid not in text or name not in text:
                    return f"atlas row {text!r} does not carry {sid} and {name!r}"
                if not href.startswith(slug_href(sid, name)):
                    return f"{sid} links to {href!r}, expected the subsystem page {slug_href(sid, name)!r}"
                if depth.strip().lower() != DEPTH_LABEL[status]:
                    return f"{sid}'s survey depth reads {depth!r}, the recorded status is {status!r}"
            return None

        check("the atlas rows are the recorded subsystems: region, ID, name, link, depth", atlas_rows_match_record)

        def depth_chips() -> str | None:
            # The Markdown prints the label; the HTML still shows it as the
            # status chip of the stored value, not as plain text.
            if page is None:
                return "master-plan.html is not published"
            chips = re.findall(r'<div class="atlas-depth"><span class="status\b[^"]*\bstatus-([a-z-]+)"', page)
            want = sorted(status for _sid, _name, status, _layer, _scope in SUBSYSTEMS)
            return None if sorted(chips) == want else f"atlas depth chips are {sorted(chips)}, expected {want}"

        check("each atlas depth is the status chip of its recorded value", depth_chips)

        # -- the atlas in Markdown -------------------------------------------
        def md_atlas_table() -> str | None:
            if md is None:
                return "master-plan.md is not published"
            tables = md_tables(md)
            atlas = [t for t in tables if t[1] == ATLAS_HEADER]
            if len(atlas) != 1:
                return f"{len(atlas)} tables headed {ATLAS_HEADER}, expected one"
            heading, _header, body = atlas[0]
            if heading:
                return f"the atlas table sits under '## {heading}'; it belongs above the per-layer tables"
            if tables[0][1] != ATLAS_HEADER:
                return "a table precedes the atlas; it belongs above the per-layer tables"
            expected = expected_rows()
            if len(body) != len(expected):
                return f"{len(body)} atlas rows, expected {len(expected)}"
            for cells, (layer, sid, name, status) in zip(body, expected, strict=True):
                if len(cells) != 3:
                    return f"atlas row {cells} does not have three cells"
                if md_visible(cells[0]) != layer:
                    return f"{sid}: region cell {cells[0]!r}, layer is {layer!r}"
                link = LINK.search(cells[1])
                if not link or sid not in link.group(1) and sid not in cells[1]:
                    return f"{sid}: subsystem cell {cells[1]!r} carries no ID link"
                if not any(slug_href(sid, name) in target for _text, target in LINK.findall(cells[1])):
                    return f"{sid}: subsystem cell {cells[1]!r} does not link to {slug_href(sid, name)}"
                if name not in md_visible(cells[1]):
                    return f"{sid}: subsystem cell {cells[1]!r} lacks the name {name!r}"
                if md_visible(cells[2]).strip().lower() != DEPTH_LABEL[status]:
                    return f"{sid}: depth cell {cells[2]!r}, the contract's label for {status!r} is {DEPTH_LABEL[status]!r}"
            return None

        check("the Markdown carries the Region | Subsystem | Survey depth table, above the layers", md_atlas_table)

        def views_agree() -> str | None:
            if md is None or page is None:
                return "a view is not published"
            regions = html_atlas(page)
            tables = [t for t in md_tables(md) if t[1] == ATLAS_HEADER]
            if regions is None or len(tables) != 1:
                return "one view carries no atlas to compare"
            html_rows = [
                (region, re.findall(r"[A-Z]-\d+", text)[0] if re.findall(r"[A-Z]-\d+", text) else text, depth.strip().lower())
                for region, _count, items in regions
                for text, _href, depth in items
            ]
            md_rows = [
                (md_visible(cells[0]), (re.findall(r"[A-Z]-\d+", cells[1]) or [cells[1]])[0], md_visible(cells[2]).strip().lower())
                for cells in tables[0][2]
            ]
            if html_rows != md_rows:
                return f"HTML atlas rows {html_rows} differ from Markdown rows {md_rows}"
            return None

        check("the HTML atlas and the Markdown table hold the same rows", views_agree)

        def atlas_above_layers() -> str | None:
            if md is None or page is None:
                return "a view is not published"
            first_layer = md.find(f"## {LAYER_ORDER[0]}")
            atlas_at = md.find("| Region |")
            if first_layer < 0 or atlas_at < 0 or atlas_at > first_layer:
                return "the Markdown atlas does not precede the first per-layer heading"
            html_atlas_at = page.find('class="subsystem-atlas"')
            first_layer_html = page.find(f'<h2 id="{LAYER_ORDER[0]}"')
            if html_atlas_at < 0 or first_layer_html < 0 or html_atlas_at > first_layer_html:
                return "the HTML atlas does not precede the first per-layer section"
            return None

        check("the atlas sits above the per-layer tables in both views", atlas_above_layers)

        # -- what stays ---------------------------------------------------------
        def layers_kept() -> str | None:
            if md is None:
                return "master-plan.md is not published"
            by_layer = {t[0]: t for t in md_tables(md) if t[0]}
            for layer in LAYER_ORDER:
                table = by_layer.get(layer)
                if table is None:
                    return f"the per-layer table under '## {layer}' is gone"
                if table[1][:4] != ["Priority", "ID", "Name", "Status"]:
                    return f"the '{layer}' table's columns are {table[1]}"
                ids = [md_visible(row[1]) for row in table[2]]
                want = [sid for sid, _n, _s, lay, _sc in SUBSYSTEMS if lay == layer]
                if sorted(ids) != sorted(want):
                    return f"the '{layer}' table lists {ids}, expected {want}"
            return None

        check("each layer keeps its own heading and its Priority/ID/Name/Status table", layers_kept)

        def empty_store() -> str | None:
            text = read(empty / "docs" / "master-plan.md")
            page_html = read(empty / "docs" / "master-plan.html")
            if text is None or page_html is None:
                return "the empty store's master plan is not published"
            if md_h1s(text) != [PAGE_TITLE]:
                return f"the empty store's H1 headings are {md_h1s(text)}"
            if "No subsystems registered yet" not in text:
                return "the empty store lost its 'No subsystems registered yet' sentence"
            if any(t[1] == ATLAS_HEADER for t in md_tables(text)) or 'class="subsystem-atlas"' in page_html:
                return "a store with no subsystems renders an atlas"
            return None

        check("a store with no subsystems keeps its sentence and renders no atlas", empty_store)
        check("no published page hides its report from assistive technology", lambda: hidden_pages(docs, empty / "docs"))

    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if text is None:
            return "the CI workflow is not readable"
        if not re.search(r"run:\s*python3 test-orientation-map\.py\b", text):
            return "no CI step runs test-orientation-map.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE O7 RED: {FAILURES[0]}"[:400])
        return 1
    emit("GATE O7 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
