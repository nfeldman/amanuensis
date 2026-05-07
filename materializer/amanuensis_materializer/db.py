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
