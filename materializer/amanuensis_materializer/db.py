"""SQLite helpers for the materializer.

Opens the conspectus DB read-only so concurrent agent writes are safe,
and provides typed query helpers that return plain dicts (not sqlite3
Row objects) so they serialize cleanly for the manifest hash.
"""
from __future__ import annotations

import hashlib
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


# ---------------------------------------------------------------------------
# The survey set (design/scope/PLAN.md §2.8, §2.6a)
#
# A path the last reconciliation excluded from the survey set -- by the
# repository's ignore files, an owner rule, or meta sorting -- is printed on no
# page except as a count on the overview. "The last reconciliation" is the
# server's own (`SCOPE_RECONCILIATION_ID_SQL`, `mcp-server/src/invariants.ts`):
# the latest one whose `scope_exclusions` rows still match its
# `exclusion_digest`, so a row appended after it was taken makes nothing
# inactive. The digest is restated here, not imported (GP24). A store without
# the scope tables excludes nothing and reads as it always has.
# ---------------------------------------------------------------------------
_NUL = "\x00"


def utf16_order(text: str) -> bytes:
    """The key the server's JavaScript `<` and `sort()` order strings by: UTF-16 code units, not code points."""

    return text.encode("utf-16-be")


def exclusion_digest(exclusions: Sequence[dict[str, Any]]) -> str:
    """§2.5's `exclusion_digest`: rows by path, each `file_path \\0 source \\0 rule_id-or-empty`, joined with `\\n`."""

    return hashlib.sha256(
        "\n".join(
            _NUL.join((str(r["file_path"]), str(r["source"]), "" if r["rule_id"] is None else str(r["rule_id"])))
            for r in sorted(exclusions, key=lambda r: utf16_order(str(r["file_path"])))
        ).encode()
    ).hexdigest()


def _active(conn: sqlite3.Connection, table: str, columns: str) -> list[dict[str, Any]]:
    """A rule or sorting row is withdrawn by a later row that supersedes it (§2.1)."""

    if not table_exists(conn, table):
        return []
    found = rows(conn, f"SELECT id, {columns}, supersedes FROM {table} ORDER BY id")
    withdrawn = {r["supersedes"] for r in found if r["supersedes"] is not None}
    return [r for r in found if r["id"] not in withdrawn]


def scope_digest(conn: sqlite3.Connection) -> str:
    """§2.5's `scope_digest` over the rows now: rules then sorting, `kind \\0 id \\0 pattern \\0 action-or-category`."""

    parts = [
        _NUL.join(("rule", str(r["id"]), str(r["pattern"]), str(r["action"])))
        for r in _active(conn, "scope_rules", "pattern, action")
    ] + [
        _NUL.join(("sorting", str(r["id"]), str(r["pattern"]), str(r["category"])))
        for r in _active(conn, "scope_sorting", "pattern, category")
    ]
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()


def has_scope_rows(conn: sqlite3.Connection) -> bool:
    """Whether the store holds a rule or a sorting row, withdrawn or not (§2.9)."""

    return any(
        table_exists(conn, table) and row(conn, f"SELECT 1 AS one FROM {table} LIMIT 1") is not None
        for table in ("scope_rules", "scope_sorting")
    )


def scope_mode(conn: sqlite3.Connection) -> str:
    """The store's mode, its latest `scope_mode_changes` row; `legacy` before survey scope."""

    if not table_exists(conn, "scope_mode_changes"):
        return "legacy"
    latest = row(conn, "SELECT mode FROM scope_mode_changes ORDER BY id DESC LIMIT 1")
    return str(latest["mode"]) if latest else "legacy"


def owner_exclude_patterns(conn: sqlite3.Connection) -> list[str]:
    """The owner's active exclude rules, by pattern, in the order they were recorded."""

    return [str(r["pattern"]) for r in _active(conn, "scope_rules", "pattern, action") if r["action"] == "exclude"]


def reconciliation_exclusion_rows(conn: sqlite3.Connection, reconciliation_id: Any) -> list[dict[str, Any]]:
    """One reconciliation's `scope_exclusions` rows; none on a store without the table."""

    if not table_exists(conn, "scope_exclusions"):
        return []
    return rows(
        conn,
        "SELECT file_path, source, rule_id FROM scope_exclusions WHERE reconciliation_id = ? ORDER BY file_path",
        (reconciliation_id,),
    )


def survey_exclusions(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """The exclusions of the last reconciliation whose rows still match its digest, by path."""

    if not table_exists(conn, "scope_exclusions") or not table_exists(conn, "scope_reconciliations"):
        return []
    has_digest = any(c["name"] == "exclusion_digest" for c in rows(conn, "PRAGMA table_info(scope_reconciliations)"))
    digest = "exclusion_digest" if has_digest else "NULL AS exclusion_digest"
    for recon in rows(conn, f"SELECT id, {digest} FROM scope_reconciliations ORDER BY id DESC"):
        found = reconciliation_exclusion_rows(conn, recon["id"])
        recorded = recon["exclusion_digest"]
        if (recorded is None and not found) or (recorded is not None and recorded == exclusion_digest(found)):
            return found
    return []


def survey_filter(conn: sqlite3.Connection, column: str = "file_path") -> str:
    """A SQL predicate on `column` that keeps only paths inside the survey set.

    The excluded paths are written to a TEMP table on this connection, which a
    `mode=ro` connection still allows, and refreshed on every call so a caller
    that edits the store between renders reads what it holds now.
    """

    conn.execute("CREATE TEMP TABLE IF NOT EXISTS survey_excluded (file_path TEXT PRIMARY KEY)")
    conn.execute("DELETE FROM temp.survey_excluded")
    conn.executemany(
        "INSERT INTO temp.survey_excluded (file_path) VALUES (?)",
        [(r["file_path"],) for r in survey_exclusions(conn)],
    )
    return f"{column} NOT IN (SELECT file_path FROM temp.survey_excluded)"


def outside_survey_subsystems(conn: sqlite3.Connection) -> list[str]:
    """Subsystems whose ledger rows are all on excluded paths (§2.6a); one with no row is not outside."""

    excluded = {str(r["file_path"]) for r in survey_exclusions(conn)}
    if not excluded or not table_exists(conn, "file_ledger"):
        return []
    owned: dict[str, bool] = {}
    for r in rows(conn, "SELECT subsystem_id, file_path FROM file_ledger ORDER BY subsystem_id"):
        sid = str(r["subsystem_id"])
        owned[sid] = owned.get(sid, True) and str(r["file_path"]) in excluded
    return sorted(sid for sid, outside in owned.items() if outside)


def outside_survey_seams(conn: sqlite3.Connection) -> list[str]:
    """Seams with at least one endpoint outside the survey: outside it too (§2.6a)."""

    outside = set(outside_survey_subsystems(conn))
    if not outside or not table_exists(conn, "seams"):
        return []
    return [
        str(r["id"])
        for r in rows(conn, "SELECT id, party_a, party_b FROM seams ORDER BY id")
        if str(r["party_a"]) in outside or str(r["party_b"]) in outside
    ]
