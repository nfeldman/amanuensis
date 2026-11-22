#!/usr/bin/env python3
"""A finding's severity re-grades appear on the resolution history page.

`update_finding_severity` appends each re-grade, with the revision it was
judged at, to `finding_severity_events`. Before this check the pages showed only
the current grade, so a reader of a re-graded finding could not tell it had
ever been graded otherwise. The timeline is where every other recorded change of
a finding's state is read, so a re-grade belongs on it too.

A store last opened by a server older than the table must still render: the
renderer reads the table only when it exists.
"""

from __future__ import annotations

import sqlite3
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from amanuensis_materializer.renderers import render_resolution_history  # noqa: E402

SCHEMA = ROOT.parent / "mcp-server" / "src" / "schema.sql"
SHA = "a" * 40
JUDGED = "b" * 40

FAILURES: list[str] = []


def check(label: str, problem: str | None) -> None:
    if problem:
        FAILURES.append(label)
        print(f"  FAIL {label}\n       {problem}")
    else:
        print(f"  ok   {label}")


def store(path: Path, *, with_regrade: bool, drop_table: bool = False) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.row_factory = None
    db.executescript(SCHEMA.read_text())
    db.execute("INSERT INTO subsystems (id, name, status) VALUES ('B-01', 'Core', 'concerns')")
    db.execute(
        "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity,"
        " status, primary_files, ref_sha, session_id, pass_type)"
        f" VALUES ('B01-1', 'B-01', 'lost write', 'no lock', 'MEDIUM', 'confirmed-bug',"
        f" '[]', '{SHA}', 's1', 'survey')"
    )
    db.execute(
        "INSERT INTO finding_resolution_events (finding_id, resolution_state, rationale,"
        " session_id, recorded_at) VALUES ('B01-1', 'open', 'Recorded open.', 's1',"
        " '2026-11-01 10:00:00')"
    )
    if with_regrade:
        db.execute(
            "INSERT INTO finding_severity_events (finding_id, previous_severity, severity,"
            " rationale, at_sha, session_id, recorded_at) VALUES ('B01-1', 'HIGH', 'MEDIUM',"
            f" 'Only the batch path reaches it.', '{JUDGED}', 's2', '2026-11-02 10:00:00')"
        )
    if drop_table:
        db.execute("DROP TABLE finding_severity_events")
    db.commit()
    return db


class TimelineRows(HTMLParser):
    """The rows of the timeline table: each cell's text and every link target in the row."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[tuple[list[str], list[str]]] = []
        self._cells: list[str] | None = None
        self._hrefs: list[str] = []
        self._in_cell = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._cells, self._hrefs = [], []
        elif tag == "td" and self._cells is not None:
            self._cells.append("")
            self._in_cell = True
        elif tag == "a":
            self._hrefs.extend(v or "" for k, v in attrs if k == "href")

    def handle_endtag(self, tag: str) -> None:
        if tag == "td":
            self._in_cell = False
        elif tag == "tr" and self._cells is not None:
            self.rows.append((self._cells, self._hrefs))
            self._cells = None

    def handle_data(self, data: str) -> None:
        if self._in_cell and self._cells:
            self._cells[-1] += data


def publish_history(storage: Path) -> list[tuple[list[str], list[str]]]:
    """Materialize the store and read the timeline rows off the HTML history page."""

    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage)],
        capture_output=True,
        text=True,
    )
    page = storage / "docs" / "resolution-history.html"
    if proc.returncode != 0 or not page.is_file():
        return []
    parser = TimelineRows()
    parser.feed(page.read_text())
    return parser.rows


def main() -> int:
    print("Severity re-grades on the resolution history page\n")
    with tempfile.TemporaryDirectory(prefix="amanuensis-severity-") as tmp:
        base = Path(tmp)

        (base / "regraded").mkdir()
        db = store(base / "regraded" / "memory.db", with_regrade=True)
        _text, sources = render_resolution_history(db, base)
        db.close()
        timeline = publish_history(base / "regraded")
        rows = [(cells, hrefs) for cells, hrefs in timeline if "HIGH → MEDIUM" in " ".join(cells)]
        check(
            "a re-grade is a row on the timeline, with both grades",
            None if len(rows) == 1 else f"{len(rows)} re-grade rows; timeline:\n{timeline}",
        )
        cells, hrefs = rows[0] if rows else ([], [])
        row = " ".join(cells)
        check(
            "the row links to its finding and names the revision it was judged at",
            None
            if "findings.html#b01-1" in hrefs and JUDGED[:7] in row and "batch path" in row
            else f"row reads: {row!r} linking {hrefs!r}",
        )
        regrade_at = next(
            (i for i, (c, _h) in enumerate(timeline) if "HIGH → MEDIUM" in " ".join(c)), -1
        )
        open_at = next((i for i, (c, _h) in enumerate(timeline) if "Open" in " ".join(c)), -1)
        check(
            "the later re-grade reads above the earlier resolution event",
            None if 0 <= regrade_at < open_at else f"re-grade at row {regrade_at}, open at {open_at}",
        )
        check(
            "the page's sources include the re-grade table",
            None if "db:history:severity-events" in sources else f"sources: {sorted(sources)}",
        )

        (base / "older").mkdir()
        db = store(base / "older" / "memory.db", with_regrade=False, drop_table=True)
        try:
            text, sources = render_resolution_history(db, base)
            older = publish_history(base / "older")
            shows_open = any("Open" in " ".join(cells) for cells, _hrefs in older)
            problem = None if shows_open and "db:history:severity-events" not in sources else text
        except sqlite3.Error as exc:
            problem = f"rendering a store without the table raised: {exc}"
        db.close()
        check("a store that predates the table still renders", problem)

    print()
    if FAILURES:
        print(f"SEVERITY HISTORY RED: {len(FAILURES)} check(s) failed; first: {FAILURES[0]}")
        return 1
    print("SEVERITY HISTORY GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
