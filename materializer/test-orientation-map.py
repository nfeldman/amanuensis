#!/usr/bin/env python3
"""Gate for orientation packet O7 — the Subsystem map carries the atlas and one
name (design/orientation/PLAN.md §2.5 item 1, §2.7, §4 O7, D3).

Turns red when:

  - the H1 of `master-plan.html` is anything but "Subsystem map" (the old
    "Master plan" heading, or a heading that differs from the page title);
  - `master-plan.html` has no `class="subsystem-atlas"`, has more than one, or
    carries a number of `atlas-item` entries other than one per subsystem — the
    fixture has three layers and one subsystem at every survey depth the schema
    admits, so a filter on any status or layer drops a row;
  - the atlas does not sit above the per-layer record lists;
  - an atlas row's region, subsystem ID, name, link or survey depth differs from
    the subsystem's recorded layer, ID, name and status, or a deferred
    subsystem's depth reads as anything but "deferred"; or a depth is not the
    status chip of the recorded value;
  - the atlas's regions are not the layers, in the order the per-layer sections
    follow, or a region's count differs from its subsystems;
  - an atlas row lacks any of its three fields (region, subsystem, survey
    depth), sits under a heading, follows another block, or prints a depth that
    is the stored value rather than the contract's label;
  - the atlas and the per-layer record lists hold different rows;
  - the per-layer record lists are gone or changed: each layer keeps its own
    `<h2>` heading and a record list presenting Priority/ID/Name/Status, one
    record per subsystem;
  - a store with no subsystems renders an atlas element instead of the existing
    sentence, or loses the "Subsystem map" H1;
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
def html_text(fragment: str) -> str:
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", "", fragment)).split())


def html_h1s(page: str) -> list[str]:
    return [html_text(h1) for h1 in re.findall(r"<h1\b[^>]*>(.*?)</h1>", page, re.S)]


def html_layers(page: str) -> dict[str, dict[str, list[str]]]:
    """{layer: fact labels, record IDs, names and statuses} for every `<h2>` section
    that holds a subsystem record list."""

    out: dict[str, dict[str, list[str]]] = {}
    for heading, body in re.findall(r'<h2 id="([^"]*)"[^>]*>.*?</h2>(.*?)(?=<h2\b|\Z)', page, re.S):
        if 'class="record-list record-list-subsystem"' not in body:
            continue
        records = re.findall(r'<article class="record record-subsystem"[^>]*>(.*?)</article>', body, re.S)

        def fact(label: str, record: str) -> str | None:
            found = re.search(rf'<dt>{label}</dt><dd>(.*?)</dd>', record, re.S)
            return html_text(found.group(1)) if found else None

        names = [re.search(r'<h3 class="record-primary"[^>]*>(.*?)</h3>', rec, re.S) for rec in records]
        out[heading] = {
            "labels": [html_text(dt) for dt in re.findall(r"<dt>(.*?)</dt>", records[0], re.S)] if records else [],
            "ids": [fact("ID", rec) or "" for rec in records],
            "names": [html_text(m.group(1)) if m else "" for m in names],
            "statuses": [fact("Status", rec) or "" for rec in records],
        }
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
        page = read(docs / "master-plan.html")

        def published() -> str | None:
            for label, result, folder in (("seeded", summary, docs), ("empty", empty_summary, empty / "docs")):
                if not result or result.get("_returncode") != 0 or result.get("ok") is False:
                    return f"the materializer did not publish the {label} fixture — {result.get('_diagnostic', result)}"
                if not (folder / "master-plan.html").is_file():
                    return f"the {label} fixture wrote no master-plan.html"
            return None

        check("the fixtures publish", published)

        def title_is_one_name() -> str | None:
            if page is None:
                return "master-plan.html is not published"
            h1s = html_h1s(page)
            if h1s != [PAGE_TITLE]:
                return f"the HTML's H1 headings are {h1s}, not [{PAGE_TITLE!r}] (D3)"
            if "Master plan" in html_text(page):
                return "the old heading 'Master plan' still appears on the page"
            return None

        check("the page's H1 is 'Subsystem map' and 'Master plan' is gone", title_is_one_name)

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
            # The text prints the contract's label; the markup still carries the
            # status chip of the stored value, not plain text.
            if page is None:
                return "master-plan.html is not published"
            chips = re.findall(r'<div class="atlas-depth"><span class="status\b[^"]*\bstatus-([a-z-]+)"', page)
            want = sorted(status for _sid, _name, status, _layer, _scope in SUBSYSTEMS)
            return None if sorted(chips) == want else f"atlas depth chips are {sorted(chips)}, expected {want}"

        check("each atlas depth is the status chip of its recorded value", depth_chips)

        # -- the atlas rows, field by field ------------------------------------
        def atlas_fields() -> str | None:
            if page is None:
                return "master-plan.html is not published"
            start = page.find('<div class="subsystem-atlas"')
            if start < 0:
                return "no subsystem-atlas element to read"
            if re.search(r"<h2\b", page[page.find('<article class="content') : start]):
                return "the atlas sits under an <h2> heading; it belongs above the per-layer sections"
            if not re.search(r'<article class="content[^"]*">\s*<div class="subsystem-atlas"', page):
                return "a block precedes the atlas; it belongs above the per-layer sections"
            regions = html_atlas(page)
            if regions is None:
                return "no subsystem-atlas element to read"
            expected = expected_rows()
            seen = [(name, text, href, depth) for name, _count, items in regions for text, href, depth in items]
            if len(seen) != len(expected):
                return f"{len(seen)} atlas rows, expected {len(expected)}"
            for (region, text, href, depth), (layer, sid, name, status) in zip(seen, expected, strict=True):
                if not region or not text or not href or not depth:
                    return f"{sid}: an atlas row lacks a region, subsystem, link or depth ({region!r}, {text!r}, {href!r}, {depth!r})"
                if region != layer:
                    return f"{sid}: region {region!r}, layer is {layer!r}"
                if not re.search(rf"\b{re.escape(sid)}\b", text):
                    return f"{sid}: subsystem cell {text!r} carries no ID"
                if not href.startswith(slug_href(sid, name)):
                    return f"{sid}: subsystem cell links to {href!r}, not {slug_href(sid, name)}"
                if name not in text:
                    return f"{sid}: subsystem cell {text!r} lacks the name {name!r}"
                if depth.strip().lower() != DEPTH_LABEL[status]:
                    return f"{sid}: depth {depth!r}, the contract's label for {status!r} is {DEPTH_LABEL[status]!r}"
            return None

        check("the atlas carries Region, Subsystem and Survey depth for every row, above the layers", atlas_fields)

        def atlas_matches_layers() -> str | None:
            if page is None:
                return "master-plan.html is not published"
            regions = html_atlas(page)
            layers = html_layers(page)
            if regions is None or not layers:
                return "the page carries no atlas or no per-layer record list to compare"
            atlas_rows = [
                (region, (re.findall(r"[A-Z]-\d+", text) or [text])[0], depth.strip().lower())
                for region, _count, items in regions
                for text, _href, depth in items
            ]
            layer_rows = [
                (layer, sid, status.strip().lower())
                for layer in LAYER_ORDER
                for sid, status in zip(layers.get(layer, {}).get("ids", []), layers.get(layer, {}).get("statuses", []), strict=True)
            ]
            if atlas_rows != layer_rows:
                return f"atlas rows {atlas_rows} differ from the per-layer record lists {layer_rows}"
            return None

        check("the atlas and the per-layer record lists hold the same rows", atlas_matches_layers)

        def atlas_above_layers() -> str | None:
            if page is None:
                return "master-plan.html is not published"
            html_atlas_at = page.find('class="subsystem-atlas"')
            first_layer_html = page.find(f'<h2 id="{LAYER_ORDER[0]}"')
            first_list = page.find('class="record-list record-list-subsystem"')
            if html_atlas_at < 0 or first_layer_html < 0 or html_atlas_at > first_layer_html:
                return "the HTML atlas does not precede the first per-layer section"
            if first_list < 0 or html_atlas_at > first_list:
                return "the HTML atlas does not precede the first per-layer record list"
            return None

        check("the atlas sits above the per-layer sections", atlas_above_layers)

        # -- what stays ---------------------------------------------------------
        def layers_kept() -> str | None:
            if page is None:
                return "master-plan.html is not published"
            by_layer = html_layers(page)
            for layer in LAYER_ORDER:
                section = by_layer.get(layer)
                if section is None:
                    return f"the per-layer section '<h2 id=\"{layer}\">' with its record list is gone"
                labels = section["labels"]
                if [label for label in ("Priority", "ID", "Status") if label not in labels] or not any(section["names"]):
                    return f"the '{layer}' records present {labels}, not Priority/ID/Name/Status"
                if sorted(section["ids"]) != sorted(want := [sid for sid, _n, _s, lay, _sc in SUBSYSTEMS if lay == layer]):
                    return f"the '{layer}' record list holds {section['ids']}, expected {want}"
                names = [name for _sid, name, _s, lay, _sc in SUBSYSTEMS if lay == layer]
                if sorted(section["names"]) != sorted(names):
                    return f"the '{layer}' record list names {section['names']}, expected {names}"
            return None

        check("each layer keeps its own heading and a Priority/ID/Name/Status record list", layers_kept)

        def empty_store() -> str | None:
            page_html = read(empty / "docs" / "master-plan.html")
            if page_html is None:
                return "the empty store's master plan is not published"
            if html_h1s(page_html) != [PAGE_TITLE]:
                return f"the empty store's H1 headings are {html_h1s(page_html)}"
            if "No subsystems registered yet" not in html_text(page_html):
                return "the empty store lost its 'No subsystems registered yet' sentence"
            if 'class="atlas-item"' in page_html or 'class="subsystem-atlas"' in page_html:
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
