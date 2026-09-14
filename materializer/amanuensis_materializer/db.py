"""SQLite helpers for the materializer.

Opens the conspectus DB read-only so concurrent agent writes are safe,
and provides typed query helpers that return plain dicts (not sqlite3
Row objects) so they serialize cleanly for the manifest hash.
"""
from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from pathlib import Path
from typing import Any


def open_ro(path: Path) -> sqlite3.Connection:
    """Open the DB read-only via URI. WAL readers don't block writers."""
    uri = f"file:{path}?mode=ro&immutable=0"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    # We only read, but foreign_keys doesn't hurt and keeps introspection
    # consistent with the writer.
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def rows(conn: sqlite3.Connection, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    cur = conn.execute(sql, params)
    cols = [d[0] for d in cur.description] if cur.description else []
    return [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]


def row(conn: sqlite3.Connection, sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
    r = rows(conn, sql, params)
    return r[0] if r else None


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?",
        (name,),
    )
    return cur.fetchone() is not None


# The views the reader lenses read and the materializer cannot create.
# `initializeSchema` in the MCP server creates them on every open, and only
# `openDatabase` calls it; this process opens the store `mode=ro` and applies
# no schema, so a store last opened by an older server reaches the renderer
# without them.
REQUIRED_VIEWS = ("file_standing", "finding_state_current")

# What to tell the operator. An absent view is a store-age problem with one
# fix, and naming the fix is the difference between a refusal and a dead end.
VIEW_ABSENT_CAUSE = (
    "the store predates the reader-lens views; "
    "open it once with the current MCP server to create them"
)


def missing_views(conn: sqlite3.Connection, names: Sequence[str] = REQUIRED_VIEWS) -> list[str]:
    """Return the names in `names` the store does not define as views.

    Read once, at the start of a render. Falling back to an inline copy of a
    view's predicate would put the same definition in two places, which is the
    drift the views were introduced to remove -- so the caller refuses instead.
    """

    placeholders = ",".join("?" for _ in names)
    if not placeholders:
        return []
    present = {
        r["name"]
        for r in rows(
            conn,
            f"SELECT name FROM sqlite_master WHERE type='view' AND name IN ({placeholders})",
            tuple(names),
        )
    }
    return [name for name in names if name not in present]
