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
import sys
import tempfile
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


def main() -> int:
    print("Severity re-grades on the resolution history page\n")
    with tempfile.TemporaryDirectory(prefix="amanuensis-severity-") as tmp:
        base = Path(tmp)

        db = store(base / "regraded.db", with_regrade=True)
        text, sources = render_resolution_history(db, base)
        db.close()
        rows = [line for line in text.splitlines() if "`HIGH` → `MEDIUM`" in line]
        check(
            "a re-grade is a row on the timeline, with both grades",
            None if len(rows) == 1 else f"{len(rows)} re-grade rows; page:\n{text}",
        )
        row = rows[0] if rows else ""
        check(
            "the row links to its finding and names the revision it was judged at",
            None
            if "(findings.md#b01-1)" in row and JUDGED[:7] in row and "batch path" in row
            else f"row reads: {row!r}",
        )
        lines = text.splitlines()
        regrade_at = next((i for i, line in enumerate(lines) if "`HIGH` → `MEDIUM`" in line), -1)
        open_at = next((i for i, line in enumerate(lines) if "`open`" in line), -1)
        check(
            "the later re-grade reads above the earlier resolution event",
            None if 0 <= regrade_at < open_at else f"re-grade at line {regrade_at}, open at {open_at}",
        )
        check(
            "the page's sources include the re-grade table",
            None if "db:history:severity-events" in sources else f"sources: {sorted(sources)}",
        )

        db = store(base / "older.db", with_regrade=False, drop_table=True)
        try:
            text, sources = render_resolution_history(db, base)
            problem = None if "`open`" in text and "db:history:severity-events" not in sources else text
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
