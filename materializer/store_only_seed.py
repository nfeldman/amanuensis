"""Seeds what `import_artifact_bodies` leaves in a store, for the materializer's tests.

The materializer reads imported bodies from `imported_artifacts` and never a file
in storage (store-only PLAN §3.3). The tests that used to write `entry-point.md`
or a survey file beside `memory.db` seed the store with these helpers instead, so
they exercise the shape a migrated store has: the body as written, and the
thesis, project name and runtime rows the import extracts from it with the
materializer's own functions (`legacy_extract`).

Nothing here is a test; each function takes an open connection and writes rows.
"""

from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path
from typing import Any

from amanuensis_materializer.legacy_extract import extract_texts

DEFAULT_WRITTEN = "2026-10-02 09:30:00"
DEFAULT_HASH = "0123456789abcdef0123456789abcdef"


def _checked_sha(db: sqlite3.Connection) -> str:
    found = db.execute(
        "SELECT last_checked_sha FROM git_state WHERE repo_id = 'default'"
    ).fetchone()
    return str(found[0]) if found and found[0] else "deadbeef"


def import_body(
    db: sqlite3.Connection,
    path: str,
    kind: str,
    body: str,
    *,
    session_id: str,
    subsystem_id: str | None = None,
    ref_sha: str | None = None,
    written_at: str = DEFAULT_WRITTEN,
    registered_hash: str = DEFAULT_HASH,
    hash_matches: bool = True,
) -> None:
    """One `imported_artifacts` row, as the import writes it."""

    db.execute(
        "INSERT INTO imported_artifacts (path, kind, subsystem_id, body, body_sha256,"
        " registered_hash, hash_matches, registered_ref_sha, written_at, session_id)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            path,
            kind,
            subsystem_id,
            body,
            hashlib.sha256(body.encode("utf-8")).hexdigest(),
            registered_hash,
            1 if hash_matches else 0,
            ref_sha if ref_sha is not None else _checked_sha(db),
            written_at,
            session_id,
        ),
    )


def withdraw_import(db: sqlite3.Connection, path: str, *, session_id: str) -> None:
    db.execute(
        "INSERT INTO imported_artifact_withdrawals (path, reason, session_id)"
        " VALUES (?, 'the subsystem was surveyed again', ?)",
        (path, session_id),
    )


def import_onboarding(
    db: sqlite3.Connection,
    *,
    session_id: str,
    entry_point: str | None = None,
    onboarding_report: str | None = None,
    concern_checklist: str | None = None,
    ref_sha: str | None = None,
    written_at: str = DEFAULT_WRITTEN,
) -> dict[str, Any]:
    """Import the three project files and extract from them what the import does.

    The thesis becomes the project's `imported` purpose, the `**Codebase**:` line
    its profile, and the runtime table `imported` runtime boundaries, each by the
    materializer's own rule and only where the store holds none yet. Returns the
    extraction, so a test can read what the rule decided.
    """

    sha = ref_sha if ref_sha is not None else _checked_sha(db)
    for path, kind, body in (
        ("entry-point.md", "entry-point", entry_point),
        ("onboarding-report.md", "onboarding-report", onboarding_report),
        ("concern-checklist.md", "concern-checklist", concern_checklist),
    ):
        if body is not None:
            import_body(
                db, path, kind, body, session_id=session_id, ref_sha=sha, written_at=written_at
            )
    reading = extract_texts(entry_point, onboarding_report)
    thesis = reading["thesis"]
    if thesis["state"] == "filled" and thesis["text"]:
        db.execute(
            "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
            " ref_sha, session_id) VALUES ('project', 'project', 'purpose', 'imported', ?, ?, ?)",
            (thesis["text"], sha, session_id),
        )
    if reading["project_name"]:
        db.execute(
            "INSERT INTO project_profile (name, ref_sha, session_id) VALUES (?, ?, ?)",
            (reading["project_name"], sha, session_id),
        )
    for edge in reading["runtime_boundaries"]:
        db.execute(
            "INSERT INTO runtime_boundaries (from_runtime, from_language, to_runtime, mechanism,"
            " notes, origin, withdrawn, ref_sha, session_id)"
            " VALUES (?, ?, ?, ?, ?, 'imported', 0, ?, ?)",
            (
                edge["from_runtime"],
                edge["from_language"],
                edge["to_runtime"],
                edge["mechanism"],
                edge["notes"],
                sha,
                session_id,
            ),
        )
    return reading


def import_files(
    db: sqlite3.Connection,
    storage: Path,
    names: dict[str, str],
    *,
    session_id: str,
    **kwargs: Any,
) -> dict[str, Any]:
    """`import_onboarding` over files a test already wrote beside the database.

    `names` maps `entry_point`, `onboarding_report` or `concern_checklist` to the
    file's name in `storage`; the files are read once, here, as the import does.
    """

    texts = {key: (storage / name).read_text() for key, name in names.items()}
    return import_onboarding(db, session_id=session_id, **texts, **kwargs)
