#!/usr/bin/env python3
"""Gate for store-only packet SO18 — Method and the remaining pages are built as page models
(design/store-only/PLAN.md §3.1, §3.2 step 4, §3.3, §3.4, §5.4, §8 SO18).

The family is `concerns` (review coverage), `concern-checklist`, `diagnosticity` and its
`diagnosticity/dm-N` matrices (competing explanations), `onboarding-report`, `entry-point`
(where to begin), `files`, `not-yet-surveyed`, `seams` (system boundaries) and `vocabulary`
(the glossary). Each store fixture of the golden corpus is rebuilt from its recorded SQL
dump into a temporary store and published in this process, with the Markdown parser
instrumented. Five more stores are built here from the `lens` dump plus rows the corpus does
not hold, in a git workspace of their own: a rich one (concerns of every status with
territories and probes, dispositions of every outcome, concern reasoning, project narratives,
territory dispositions, seams, matrices of every verdict, glossary terms with declinations in
each of the three states, multi-owner files with open defects, a standing reconciliation,
unledgered paths, deferred subsystems and imported bodies of every shape), a bare one (every
record these pages read removed, so each page prints its empty state and the three record
pages are not planned), and three partial ones (records with no import, imports with no
record, and no concern at all). The tree this packet started from publishes all of them too,
and its HTML is the reference for every page.

Turns red when:

  - the golden corpus is absent, or one of its stores lacks a family page;
  - a family page of a rebuilt fixture differs by one byte from the golden HTML;
  - any file the lens, rich, bare or partial stores publish (every page, not only the family)
    differs by one byte from what the packet's start tree publishes for the same store;
  - the Markdown parser is reached by anything but `legacy_prose.py` while a family page is
    built; `legacy_prose.py` reads imported bodies and nothing else, so it runs once for each
    imported body a record page prints beside its records, once for an import-only page, and
    never for a page that prints none; or the counter is blind (it sees no parse of any other
    page);
  - a family renderer does not return a `Page` with a title, the page's own path, blocks and
    sources, or a publication is not green on all three read-back axes;
  - a mutated store (a note, a narrative, a seam, a matrix cell, a term, a declination, a
    ledger revision, an unledgered path, a probe, a territory condition or an imported body
    changed) leaves the page that reads it unchanged, which would show the page is not built
    from the store;
  - the gate does not run in CI.

False green it cannot exclude: byte identity is proved on four golden stores and five stores
seeded here; a record shape none of them holds could print differently. The parser stays in
the tree until SO19, which is what makes the comparison possible.

Output protocol: exactly one status line, last, on stdout. Every message is scrubbed, so a
missing deliverable reports as an assertion failure and not as a crash.
"""

from __future__ import annotations

import contextlib
import hashlib
import importlib
import io
import json
import os
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
GOLDEN = ROOT / "fixtures" / "store-only-golden"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
START_SHA = "8ad57bd6e096676de57aaf3ac8f1062a98dd7dd6"

# SO20 marks every rendered record and drawn node or edge with these four attributes
# (PLAN §3.5). The start tree predates them, so the current page is compared with
# them removed; SO20's own gate checks their values.
_SO20_MARKS = re.compile(r' data-(?:record|state|node|edge)="[^"]*"')


# SO22 adds a drawn figure to the guide and to each subsystem page (PLAN §3.2's update
# rule); the start tree predates them, so a figure is removed whole as well.
_SO22_FIGURES = re.compile(r'<figure\b[^>]*data-diagram="[^"]*"[^>]*>.*?</figure>\n?', re.S)


def unmarked(text: str) -> str:
    return _SO20_MARKS.sub("", _SO22_FIGURES.sub("", text))

BASE = (
    "concerns", "concern-checklist", "diagnosticity", "onboarding-report", "entry-point",
    "files", "not-yet-surveyed", "seams", "vocabulary",
)
STORES = ("materializer", "axiomdb-shaped", "self-shaped", "lens")
LEGACY = "amanuensis_materializer.legacy_prose"

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
    ("ENOENT", "PATH-ABSENT"),
    ("is not defined", "is undeclared"),
    ("command not found", "executable is absent"),
    ("Traceback (most recent call last)", "trace follows"),
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


def load(name: str) -> tuple[Any, str | None]:
    sys.path.insert(0, str(ROOT))
    try:
        return importlib.import_module(f"amanuensis_materializer.{name}"), None
    except Exception as exc:  # absent or broken module: an assertion, not a crash
        return None, f"amanuensis_materializer/{name}.py could not be loaded ({type(exc).__name__}: {exc})"


# ---------------------------------------------------------------------------
# The corpus, the seeded stores, and the stores rebuilt from them.
# ---------------------------------------------------------------------------


def unfold(text: str) -> str:
    return re.sub(
        r"@@golden-asset ([0-9a-f]{64})@@",
        lambda m: (GOLDEN / "assets" / m.group(1)).read_text(),
        text,
    )


def rebuild(store: str, root: Path, name: str | None = None) -> Path:
    """A storage directory holding the fixture's recorded database."""

    storage = root / (name or store) / "storage"
    storage.mkdir(parents=True)
    db = sqlite3.connect(storage / "memory.db")
    try:
        db.executescript((GOLDEN / store / "memory.sql").read_text())
        db.commit()
    finally:
        db.close()
    if store == "materializer":
        (storage / "workspace_path").write_text("/example/FictionalProject\n")
    return storage


def golden_page(store: str, page: str) -> str | None:
    path = GOLDEN / store / "html" / f"{page}.html"
    return unfold(path.read_text()) if path.is_file() else None


def golden_pages(store: str) -> list[str]:
    """The family's golden pages of one store: the nine, and every matrix page it holds."""

    base = GOLDEN / store / "html"
    found = [page for page in BASE if (base / f"{page}.html").is_file()]
    found += sorted(f"diagnosticity/{p.stem}" for p in (base / "diagnosticity").glob("*.html"))
    return found


def family_pages(output: Path) -> list[str]:
    found = [page for page in BASE if (output / f"{page}.html").is_file()]
    found += sorted(f"diagnosticity/{p.stem}" for p in (output / "diagnosticity").glob("*.html"))
    return found


WHEN = "2026-11-12 09:30:00"


def drop_triggers(db: sqlite3.Connection) -> None:
    """The store's immutability triggers, which would refuse the seeds and the edits made here."""

    for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'").fetchall():
        db.execute(f'DROP TRIGGER "{name}"')


WORKSPACE_FILES = (
    "src/reader.ts", "src/cursor.ts", "src/shared.ts", "src/queue.ts", "src/deep/x.ts", "src/deep/y.ts",
    "lib/z.ts", "Makefile", "README.md", "notes/guide.md", "src/new.ts",
)


def make_workspace(root: Path) -> tuple[str, str]:
    """A git repository beside the store, with two commits whose revisions are the same on every run."""

    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "gate", "GIT_AUTHOR_EMAIL": "gate@example.invalid",
        "GIT_COMMITTER_NAME": "gate", "GIT_COMMITTER_EMAIL": "gate@example.invalid",
        "GIT_AUTHOR_DATE": "2026-11-12T09:00:00Z", "GIT_COMMITTER_DATE": "2026-11-12T09:00:00Z",
    }

    def git(*args: str) -> str:
        done = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, env=env, check=True)
        return done.stdout.strip()

    git("init", "-q", "-b", "main")
    for path in WORKSPACE_FILES:
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"// {path}\n")
    git("add", *WORKSPACE_FILES)
    git("commit", "-q", "-m", "first")
    first = git("rev-parse", "HEAD")
    (root / "src/cursor.ts").write_text("// src/cursor.ts\n// moved\n")
    git("add", "src/cursor.ts")
    git("commit", "-q", "-m", "second")
    return first, git("rev-parse", "HEAD")


ENTRY_BODY = (
    "Start with `src/reader.ts`, then [the map](master-plan.md).\n\n1. read the cursor\n2. read the drain\n\n"
    "```ts\nconst page = buffer.next();\n```\n\n### Notes\n\n| Subsystem | Layer |\n|---|---|\n| B-01 | backend |\n"
)
ENTRY_SECOND = "# Reading path, second\n\n## Later\n\nMore to read, in B-02.\n"
ONBOARDING_BODY = (
    "# Onboarding report\n\n**Codebase**: LensFixture — P8 gate fixture\n\n## Directory clusters\n\n"
    "- src/ — the read and write paths\n\n## Split\n\nThe split follows the two paths; see [seams](seams.md).\n\n"
    "~~~\nraw\n~~~\n"
)
CHECKLIST_BODY = (
    "# Concern checklist\n\n## Active concerns (2)\n\n"
    "| Code | Category | Territory | Codebase-specific probe (abbreviated) | Primary subsystems |\n|---|---|---|---|---|\n"
    "| CC-1 | concurrency | T8 | Race two writers. | B-01 |\n| CC-2 | data-integrity | T7 | Crash between write and flag. | B-02 |\n\n"
    "## Retired\n\nNone.\n"
)


def seed_rich(storage: Path, shas: tuple[str, str]) -> None:
    """Add what the corpus lacks to the `lens` store, so every branch of the family prints."""

    first, head = shas
    db = sqlite3.connect(storage / "memory.db")
    try:
        drop_triggers(db)
        db.execute("PRAGMA foreign_keys = OFF")
        cur = db.cursor()
        since = db.execute("SELECT datetime('now', '-2 minutes')").fetchone()[0]
        cur.execute("UPDATE git_state SET last_checked_sha = ? WHERE repo_id = 'default'", (head,))

        # Concerns: every status, a territory the contract does not name, probes with pipes.
        for sql in (
            "UPDATE concerns SET notes = 'Retired | in favour of CC-1.' WHERE code = 'CC-9'",
            "UPDATE concerns SET notes = 'Bare note.', discovered_in = 'B-02', territory = 'T7',"
            " probe = 'Crash between the write and the flag.' WHERE code = 'CC-2'",
            "UPDATE concerns SET territory = 'T8', probe = 'Race two writers.' WHERE code = 'CC-1'",
            "UPDATE concerns SET territory = 'Zq-local', probe = NULL WHERE code = 'CC-3'",
            "UPDATE concerns SET territory = 'T7', probe = 'Two phases | one commit.' WHERE code = 'SC-1'",
        ):
            cur.execute(sql)
        for concern in (
            ("CC-4", "data-integrity", "discovered", "merged", "B-01", "CC-2", "Folded into CC-2, one line.", None, None),
            ("RC-1", "concurrency", "discovered", "active", "B-02", None, "Added late | by hand.", "T8",
             "Open a handle and kill its owner | see what leaks."),
            ("RC-2", "concurrency", "seeded", "candidate", None, None, None, None, None),
        ):
            cur.execute(
                "INSERT INTO concerns (code, category, origin, status, discovered_in, merged_into, notes, territory, probe)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                concern,
            )
        for disposition in (
            ("B-02", "CC-1", "unresolved-competition", "code-verified", 1, "Two writers | one wins."),
            ("B-03", "CC-2", "confirmed-bug", "test-observed", 0, None),
            ("F-02", "CC-3", "ruled-out", "name-inferred", 0, "The console is deferred."),
            ("B-02", "RC-1", "confirmed-acceptable", "runtime-observed", 1, "Handled by the owner."),
            ("B-03", "CC-3", None, None, 0, None),
            ("B-02", "SC-1", "ruled-out", None, 0, None),
        ):
            cur.execute(
                "INSERT INTO dispositions (subsystem_id, concern_code, classification, evidence_quality,"
                " linchpin_dependent, rationale, ref_sha, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'p8')",
                (*disposition, first),
            )
        for territory in (
            ("T7", "applies", None), ("T8", "disqualified", "No threads | no tasks."),
            ("Zq-local", "applies", "Only here."), ("T7", "applies", "Applies since the queue."),
        ):
            cur.execute(
                "INSERT INTO territory_dispositions (territory, disposition, condition, ref_sha, session_id)"
                " VALUES (?, ?, ?, ?, 'p8')",
                (*territory, first),
            )

        def narrative(kind: str, sid: str, section: str, topic: str, body: str, disposition: str = "recorded", cites: tuple[str, ...] = ()) -> None:
            cur.execute(
                "INSERT INTO narratives (subject_type, subject_id, section, topic, disposition, body, ref_sha,"
                " session_id, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'p8', ?)",
                (kind, sid, section, topic, disposition, body, first, WHEN),
            )
            narrative_id = cur.lastrowid
            for path in cites:
                cur.execute(
                    "INSERT INTO evidence (file_path, ref_sha, kind, session_id) VALUES (?, ?, 'code-verified', 'p8')",
                    (path, first),
                )
                cur.execute(
                    "INSERT INTO narrative_evidence (narrative_id, evidence_id) VALUES (?, ?)", (narrative_id, cur.lastrowid)
                )

        narrative("subsystem", "B-01", "concern-reasoning", "", "Each concern was weighed against the cursor.\n\n- CC-1 holds\n- CC-2 does not", cites=("src/reader.ts", "src/cursor.ts"))
        narrative("subsystem", "B-02", "concern-reasoning", "Why these", "The writer takes one lock. See B-01.")
        narrative("subsystem", "B-03", "concern-reasoning", "", "Nothing was weighed yet.", "declined")
        narrative("project", "project", "repository-shape", "Layout", "The code is two paths and a console.\n\n- src/ holds both paths\n- ui/ holds the console", cites=("src/reader.ts",))
        narrative("project", "project", "repository-shape", "", "A second note on the layout.")
        narrative("project", "project", "runtime", "", "It runs in one process.")
        narrative("project", "project", "stateful-entities", "Rows", "Rows live in the buffer until drained.")
        narrative("project", "project", "survey-plan", "", "No plan was written.", "declined")
        narrative("project", "project", "start-here", "", "Read `src/reader.ts` first.\n\n1. the cursor\n2. the drain", cites=("src/cursor.ts",))
        narrative("project", "project", "start-here", "Then", "Then the writer in B-02.")

        # Seams.
        cur.execute("UPDATE seams SET notes = 'Written by A | read by B.\nSecond line.' WHERE id = 'SM-1'")
        cur.execute("UPDATE seams SET shared_object_kind = 'queue' WHERE id = 'SM-2'")
        cur.execute(
            "INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b) VALUES"
            " ('SM-4', 'the \"batch\" | list', 'event-bus', 'B-03', 'B-02')"
        )

        # Matrices: every verdict, a missing cell, a matrix with no evidence, an open one.
        def evidence(path: str, symbol: str | None, lines: str | None, kind: str, excerpt: str | None, note: str | None) -> int:
            cur.execute(
                "INSERT INTO evidence (file_path, symbol, line_range, ref_sha, kind, excerpt, note, session_id)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, 'p8')",
                (path, symbol, lines, first, kind, excerpt, note),
            )
            return int(cur.lastrowid or 0)

        cur.execute(
            "INSERT INTO diagnosticity_sessions (id, subsystem_id, symptom, shared_location, leading_concern, linchpin_note,"
            " outcome, session_id, created_at) VALUES (8, 'B-01', 'Rows vanish | after a restart.', 'src/reader.ts:cursor@x',"
            " 'CC-1', 'Fragile if the log is trimmed.', 'resolved', 'p8', ?)",
            (WHEN,),
        )
        e1 = evidence("src/reader.ts", "cursor", "10-20", "code-verified", "const c = load();\nreturn c.next;", "The cursor is loaded once.")
        e2 = evidence("src/writer.ts", None, None, "test-observed", None, None)
        e3 = evidence("src/shared.ts", "flush", "5", "contract-stated", None, "Names the winner.")
        for code, rank, eliminated in (("CC-1", 1, 0), ("CC-2", 2, 1), ("RC-1", None, 0)):
            cur.execute("INSERT INTO diagnosticity_concerns (matrix_id, concern_code, rank, eliminated) VALUES (8, ?, ?, ?)", (code, rank, eliminated))
        for order, ev in enumerate((e1, e2, e3), start=1):
            cur.execute("INSERT INTO diagnosticity_evidence (matrix_id, evidence_id, row_order) VALUES (8, ?, ?)", (ev, order))
        for code, ev, verdict, note in (
            ("CC-1", e1, "consistent", None), ("CC-2", e1, "contradicts", "No."), ("RC-1", e1, "ambiguous", None),
            ("CC-1", e2, "irrelevant", None), ("CC-2", e2, "contradicts", None), ("CC-1", e3, "consistent", None),
        ):
            cur.execute(
                "INSERT INTO diagnosticity_cells (matrix_id, concern_code, evidence_id, verdict, note) VALUES (8, ?, ?, ?, ?)",
                (code, ev, verdict, note),
            )
        cur.execute(
            "INSERT INTO diagnosticity_sessions (id, symptom, outcome, session_id, created_at)"
            " VALUES (9, 'No evidence yet.', 'open', 'p8', ?)",
            (WHEN,),
        )
        cur.execute(
            "INSERT INTO diagnosticity_sessions (id, subsystem_id, symptom, outcome, session_id, created_at)"
            " VALUES (10, 'B-03', 'Two readings of the queue.', 'unresolved-competition', 'p8', ?)",
            (WHEN,),
        )
        for code in ("CC-1", "CC-2"):
            cur.execute("INSERT INTO diagnosticity_concerns (matrix_id, concern_code) VALUES (10, ?)", (code,))

        # The glossary: codebase-wide and scoped terms, and declinations in each of the three states.
        cur.execute(
            "UPDATE vocabulary SET first_seen = ?, expansion = 'The shared page.\n\nIt holds rows.' WHERE term = 'row buffer'",
            (f"src/reader.ts:buffer@{first}",),
        )
        for term in (
            ("cursor", "Where the reader stopped.", "The position the writer must not pass.\n\nSecond paragraph.", None, f"src/reader.ts:cursor@{first}"),
            ("drain", "Empty a page.", None, None, None),
            ("lag", "Rows behind the writer.", None, "B-03", f"src/queue.ts:lag@{first}"),
        ):
            cur.execute(
                "INSERT INTO vocabulary (term, gloss, expansion, subsystem_id, first_seen, ref_sha) VALUES (?, ?, ?, ?, ?, ?)",
                (*term, first),
            )
        for sid in ("B-03", "B-02"):
            cur.execute("INSERT INTO vocabulary_scopes (term, subsystem_id) VALUES ('lag', ?)", (sid,))
        for sid, reason, sha in (
            ("B-01", "It named nothing at first.", first),
            ("F-01", "The console uses plain words.", first),
            ("F-02", "Declared at a revision that is gone.", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
        ):
            cur.execute(
                "INSERT INTO vocabulary_declinations (subsystem_id, reason, session_id, ref_sha) VALUES (?, ?, 'p8', ?)",
                (sid, reason, sha),
            )

        # Files: a path with three owners at different revisions, open defects, a path with a pipe-free odd name.
        cur.execute(
            "INSERT INTO file_ledger (subsystem_id, file_path, classification, ref_sha, examined_at) VALUES"
            " ('B-03', 'src/shared.ts', 'examined', ?, ?)",
            (head, WHEN),
        )
        cur.execute("UPDATE file_ledger SET why_in_scope = 'The queue body.' WHERE file_path = 'src/queue.ts'")
        for finding in (
            ("B01-91", "B-01", "Flush loses a row.", "Early cursor.", "HIGH", "confirmed-bug", '["src/shared.ts:flush@x","src/a/b.ts:y@z","src/shared.ts:other@x"]'),
            ("B02-91", "B-02", "The cited paths are not JSON.", "A bad write.", "LOW", "confirmed-bug", "not json"),
        ):
            cur.execute(
                "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status, primary_files,"
                " ref_sha, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'p8')",
                (*finding, first),
            )

        # Not yet surveyed: more unledgered paths in more directories, deferred subsystems with and without a reason.
        for path in ("src/deep/x.ts", "src/deep/y.ts", "lib/z.ts", "Makefile"):
            cur.execute(
                "INSERT INTO scope_gaps (file_path, kind, detected_sha) VALUES (?, 'unledgered', ?)", (path, head)
            )
        cur.execute("UPDATE subsystems SET notes = 'Parked | until the console is rebuilt.' WHERE id = 'F-01'")
        cur.execute("UPDATE subsystems SET layer = NULL, notes = NULL WHERE id = 'F-02'")

        # Imported bodies: three kinds, a second body, an edited one, a withdrawn one.
        def imported(path: str, kind: str, body: str, matches: int = 1) -> None:
            cur.execute(
                "INSERT INTO imported_artifacts (path, kind, body, body_sha256, registered_hash, hash_matches,"
                " registered_ref_sha, written_at, session_id) VALUES (?, ?, ?, ?, 'abc', ?, ?, '2026-10-02 09:30:00', 'p8')",
                (path, kind, body, hashlib.sha256(body.encode("utf-8")).hexdigest(), matches, first),
            )

        cur.execute("DELETE FROM imported_artifacts")
        imported("entry-point.md", "entry-point", ENTRY_BODY)
        imported("entry-point-2.md", "entry-point", ENTRY_SECOND)
        imported("onboarding-report.md", "onboarding-report", ONBOARDING_BODY, 0)
        imported("onboarding-old.md", "onboarding-report", "A withdrawn body that must not print.\n")
        imported("concern-checklist.md", "concern-checklist", CHECKLIST_BODY)
        cur.execute(
            "INSERT INTO imported_artifact_withdrawals (path, reason, session_id) VALUES ('onboarding-old.md', 'reset', 'p8')"
        )
        # A column the store fills with the time of the insert would make two publications differ.
        for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall():
            for column in db.execute(f'PRAGMA table_info("{table}")').fetchall():
                if column[1].endswith("_at") or column[1] == "at":
                    db.execute(f'UPDATE "{table}" SET "{column[1]}" = ? WHERE "{column[1]}" >= ?', (WHEN, since))
        db.commit()
    finally:
        db.close()


def seal_reconciliation(storage: Path, head: str) -> str | None:
    """A reconciliation recorded at the checked revision that stands over the workspace's tree."""

    readback, error = load("readback")
    core, error2 = load("core")
    if readback is None or core is None:
        return error or error2
    conn = core.open_ro(storage / "memory.db")
    try:
        paths = readback.tree_paths(storage.parent, head)
        ledger = readback.ledger_digest(conn)
    finally:
        conn.close()
    if paths is None:
        return "git cannot list the workspace's tree"
    db = sqlite3.connect(storage / "memory.db")
    try:
        drop_triggers(db)
        db.execute("PRAGMA foreign_keys = OFF")
        db.execute(
            "INSERT INTO scope_reconciliations (detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows,"
            " unledgered, absent, exempt, session_id, detected_at) VALUES (?, ?, ?, ?, 15, 8, 1, 2, 'p8', ?)",
            (head, readback.tracked_path_digest(paths), ledger, len(paths), WHEN),
        )
        db.commit()
    finally:
        db.close()
    return None


def _delete(storage: Path, tables: tuple[str, ...]) -> None:
    db = sqlite3.connect(storage / "memory.db")
    try:
        db.execute("PRAGMA foreign_keys = OFF")
        drop_triggers(db)
        for table in tables:
            db.execute(f"DELETE FROM {table}")
        db.commit()
    finally:
        db.close()


def seed_bare(storage: Path, shas: tuple[str, str]) -> None:
    """Remove every record the family reads from the `lens` store: each page prints its empty state."""

    del shas
    _delete(
        storage,
        (
            "diagnosticity_cells", "diagnosticity_evidence", "diagnosticity_concerns", "diagnosticity_sessions",
            "dispositions", "territory_dispositions", "narrative_evidence", "narratives", "concerns", "seams",
            "vocabulary_scopes", "vocabulary_declinations", "vocabulary", "file_ledger", "scope_gaps",
            "imported_artifact_withdrawals", "imported_artifacts",
        ),
    )


def seed_records(storage: Path, shas: tuple[str, str]) -> None:
    """The rich store with no imported body: the three record pages hold records alone."""

    seed_rich(storage, shas)
    _delete(storage, ("imported_artifact_withdrawals", "imported_artifacts"))


def seed_imports(storage: Path, shas: tuple[str, str]) -> None:
    """The rich store with no narrative, territory, probe or territory: the three pages are imports alone."""

    seed_rich(storage, shas)
    _delete(storage, ("narrative_evidence", "narratives", "territory_dispositions"))
    db = sqlite3.connect(storage / "memory.db")
    try:
        db.execute("UPDATE concerns SET territory = NULL, probe = NULL")
        db.commit()
    finally:
        db.close()


def seed_noconcerns(storage: Path, shas: tuple[str, str]) -> None:
    """The rich store with no concern: no heatmap, no active list, no checklist row."""

    seed_rich(storage, shas)
    _delete(storage, ("dispositions", "concerns"))


def prepare(source: str, root: Path, name: str, seed: Callable[[Path, tuple[str, str]], None] | None) -> tuple[Path, str | None]:
    """A storage directory, with its own git workspace and standing reconciliation when seeded."""

    storage = rebuild(source, root, name)
    if seed is None:
        return storage, None
    shas = make_workspace(storage.parent)
    seed(storage, shas)
    if seed is seed_bare:
        return storage, None
    return storage, seal_reconciliation(storage, shas[1])


def publish_instrumented(storage: Path, output: Path) -> tuple[dict[str, Any], list[tuple[str, str]]]:
    """Publish in this process, recording the page path and calling module of each Markdown parse."""

    hp, error = load("legacy_prose")
    if hp is None:
        raise RuntimeError(error)
    import materialize  # noqa: PLC0415 — the CLI module, run in this process

    calls: list[tuple[str, str]] = []
    real = hp._LegacyParser.parse

    def counting(self: Any, markdown: str) -> Any:
        depth = 1
        caller = sys._getframe(depth).f_globals.get("__name__", "")
        while caller.endswith("html_projection"):
            depth += 1
            caller = sys._getframe(depth).f_globals.get("__name__", "")
        calls.append((self.current_html_path, caller))
        return real(self, markdown)

    hp._LegacyParser.parse = counting
    saved = sys.argv
    sys.argv = ["materialize.py", "--storage", str(storage), "--output", str(output), "--allow-external-output"]
    buffer = io.StringIO()
    try:
        with contextlib.redirect_stdout(buffer):
            code = materialize.main()
    finally:
        sys.argv = saved
        hp._LegacyParser.parse = real
    lines = [line for line in buffer.getvalue().splitlines() if line.strip()]
    summary = json.loads(lines[-1]) if lines else {}
    summary["exit"] = code
    return summary, calls


def axes_green(summary: dict[str, Any]) -> str | None:
    readback = summary.get("readback") or {}
    axes = readback.get("axes") or {}
    red = [axis for axis in ("state", "coverage", "content") if not (axes.get(axis) or {}).get("ok")]
    if summary.get("exit") != 0 or not summary.get("ok") or red:
        first = (readback.get("mismatches") or [{}])[0]
        return f"publish not green: exit {summary.get('exit')}, axes {red or 'ok'}, {json.dumps(first)[:200]}"
    return None


def start_tree(into: Path) -> Path | None:
    """The materializer as it was when this packet started, extracted from git."""

    archive = subprocess.run(["git", "-C", str(REPO), "archive", START_SHA, "materializer"], capture_output=True)
    if archive.returncode != 0 or not archive.stdout:
        return None
    tarball = into / "start.tar"
    tarball.write_bytes(archive.stdout)
    if subprocess.run(["tar", "-xf", str(tarball), "-C", str(into)], capture_output=True).returncode != 0:
        return None
    tree = into / "materializer"
    return tree if (tree / "materialize.py").is_file() else None


def run_start_tree(tree: Path, storage: Path, output: Path) -> bool:
    proc = subprocess.run(
        [sys.executable, str(tree / "materialize.py"), "--storage", str(storage), "--output", str(output), "--allow-external-output"],
        capture_output=True,
        text=True,
        cwd=tree,
    )
    return proc.returncode == 0 and (output / "index.html").is_file()


def differs(got: str, wanted: str) -> str:
    at = next((i for i, (a, b) in enumerate(zip(got, wanted, strict=False)) if a != b), min(len(got), len(wanted)))
    return f"differs at byte {at}: {got[at:at + 70]!r} for {wanted[at:at + 70]!r}"


# ---------------------------------------------------------------------------
# The checks.
# ---------------------------------------------------------------------------

# What each seeded store must print, so the seed provably reaches the branch it was made for.
REACH: dict[str, dict[str, tuple[str, ...]]] = {
    "rich": {
        "concerns": (
            "Coverage overview", "Concern reasoning", "Why these", "Active concerns", "Retired/merged concerns",
            "Retired | in favour of", "Added late / by hand.", "Folded into", "one line.", "Nothing was weighed yet.",
        ),
        "concern-checklist": (
            "Territories", "T7 (Atomicity Violation)", "Zq-local", "Applies since the queue.", "No threads | no tasks.",
            "Two phases | one commit.", "Open a handle and kill its owner | see what leaks.", "As written at onboarding",
            "Active concerns", "Retired",
        ),
        "diagnosticity": ("Rows vanish | after a restart.", "No evidence yet.", "Two readings of the queue.", "unresolved-competition"),
        "diagnosticity/dm-8": ("Cell legend", "Evidence detail", "Linchpin note", "Fragile if the log is trimmed.", "const c = load();", "The cursor is loaded once."),
        "diagnosticity/dm-9": ("Matrix has no concerns or evidence rows.",),
        "diagnosticity/dm-10": ("Matrix has no concerns or evidence rows.",),
        "seams": ("Written by A / read by B. Second line.", "The &quot;batch&quot; | list", "Assessment ready", "SM-4"),
        "vocabulary": (
            "Codebase-wide", "Scoped to", "First seen:", "The position the writer must not pass.", "Second paragraph.",
            "Subsystems that declared no domain vocabulary (1 of 5)", "The console uses plain words.", "declared none earlier",
        ),
        "files": ("distinct path", "Every owner", "src/shared.ts", "Open defects"),
        "not-yet-surveyed": (
            "Paths with no ledger row", "tracked paths", "(repository root)", "unread of", "The queue body.",
            "Subsystems set aside", "Parked / until the console is rebuilt.", "No reason is recorded.",
            "Seam sides no one has assessed", "Concerns no one has dispositioned here",
        ),
        "onboarding-report": ("Layout", "A second note on the layout.", "It runs in one process.", "Rows", "As written at onboarding", "It was edited after it was registered."),
        "entry-point": ("Then", "Read", "As written at onboarding", "Reading path, second", "More to read"),
    },
    "bare": {
        "concerns": ("Heatmap requires at least one subsystem and one active concern.",),
        "diagnosticity": ("No diagnosticity matrices recorded.",),
        "seams": ("No seams recorded yet.",),
        "vocabulary": ("No vocabulary recorded.",),
        "files": ("No file is recorded in the ledger",),
        "not-yet-surveyed": ("No tracked paths is recorded",),
    },
    "records": {
        "onboarding-report": ("Layout", "It runs in one process."),
        "entry-point": ("Read", "Then"),
        "concern-checklist": ("Territories", "Two phases | one commit."),
    },
    "imports": {
        "onboarding-report": ("Directory clusters", "It was edited after it was registered."),
        "entry-point": ("Reading path, second", "More to read"),
        "concern-checklist": ("Active concerns", "Race two writers."),
    },
    "noconcerns": {
        "concerns": ("Heatmap requires at least one subsystem and one active concern.", "Concern reasoning"),
        "concern-checklist": ("Territories", "Active concerns"),
    },
}
# Pages whose golden HTML was written against a git workspace the corpus does not carry; the start
# tree's HTML for the same store, compared below, is their reference.
WORKSPACE_DEPENDENT = {("lens", "not-yet-surveyed")}
ABSENT = {"bare": ("onboarding-report", "entry-point", "concern-checklist")}
NOT_IN = {"records": {"onboarding-report": ("As written at",), "entry-point": ("As written at",)}}

# One edit to the rich store each, the page that must change for it, and the word that must appear
# (None: only that the page differs).
MUTATIONS: tuple[tuple[str, str, str, str | None], ...] = (
    ("an active concern's note", "concerns", "UPDATE concerns SET notes = 'Zq note zq.' WHERE code = 'CC-2'", "Zq note zq."),
    ("a retired concern's note", "concerns", "UPDATE concerns SET notes = 'Zq retired zq.' WHERE code = 'CC-9'", "Zq retired zq."),
    ("a concern-reasoning narrative", "concerns", "UPDATE narratives SET body = 'Zq reasoning zq.' WHERE subject_id = 'B-01' AND section = 'concern-reasoning'", "Zq reasoning zq."),
    ("a disposition's outcome", "concerns", "UPDATE dispositions SET classification = 'confirmed-bug' WHERE subsystem_id = 'B-02' AND concern_code = 'CC-2'", None),
    ("a seam's shared object", "seams", "UPDATE seams SET shared_object = 'the zq buffer' WHERE id = 'SM-1'", "the zq buffer"),
    ("a seam's notes", "seams", "UPDATE seams SET notes = 'Zq seam zq.' WHERE id = 'SM-2'", "Zq seam zq."),
    ("a matrix's symptom", "diagnosticity", "UPDATE diagnosticity_sessions SET symptom = 'Zq symptom zq.' WHERE id = 8", "Zq symptom zq."),
    ("a matrix's evidence excerpt", "diagnosticity/dm-8", "UPDATE evidence SET excerpt = 'zq excerpt zq' WHERE symbol = 'cursor' AND excerpt IS NOT NULL", "zq excerpt zq"),
    ("a matrix cell's verdict", "diagnosticity/dm-8", "UPDATE diagnosticity_cells SET verdict = 'irrelevant' WHERE matrix_id = 8 AND concern_code = 'CC-1' AND evidence_id = (SELECT MIN(evidence_id) FROM diagnosticity_evidence WHERE matrix_id = 8)", None),
    ("a term's gloss", "vocabulary", "UPDATE vocabulary SET gloss = 'Zq gloss zq.' WHERE term = 'cursor'", "Zq gloss zq."),
    ("a declination's reason", "vocabulary", "UPDATE vocabulary_declinations SET reason = 'Zq reason zq.' WHERE subsystem_id = 'F-01'", "Zq reason zq."),
    ("a file's examined revision", "files", "UPDATE file_ledger SET ref_sha = 'dddddddd5555dddddddd5555dddddddd55555555' WHERE subsystem_id = 'B-03' AND file_path = 'src/shared.ts'", "dddddddd"),
    ("an open finding's cited paths", "files", "UPDATE findings SET primary_files = '[\"src/queue.ts:x@y\"]' WHERE finding_id = 'B01-91'", None),
    ("an unledgered path", "not-yet-surveyed", "UPDATE scope_gaps SET file_path = 'src/zq/new.ts' WHERE file_path = 'lib/z.ts'", "src/zq/new.ts"),
    ("a deferred subsystem's reason", "not-yet-surveyed", "UPDATE subsystems SET notes = 'Zq parked zq.' WHERE id = 'F-01'", "Zq parked zq."),
    ("a file's reason in scope", "not-yet-surveyed", "UPDATE file_ledger SET why_in_scope = 'Zq scope zq.' WHERE file_path = 'src/queue.ts'", "Zq scope zq."),
    ("a project narrative", "onboarding-report", "UPDATE narratives SET body = 'Zq layout zq.' WHERE section = 'repository-shape' AND topic = 'Layout'", "Zq layout zq."),
    ("a concern's probe", "concern-checklist", "UPDATE concerns SET probe = 'Zq probe zq.' WHERE code = 'CC-1'", "Zq probe zq."),
    ("a territory's condition", "concern-checklist", "UPDATE territory_dispositions SET condition = 'Zq cond zq.' WHERE territory = 'T8'", "Zq cond zq."),
    ("an imported body of the entry point", "entry-point", "UPDATE imported_artifacts SET body = replace(body, 'the drain', 'zq drain zq') WHERE path = 'entry-point.md'", "zq drain zq"),
    ("a start-here narrative", "entry-point", "UPDATE narratives SET body = 'Zq start zq.' WHERE section = 'start-here' AND topic = 'Then'", "Zq start zq."),
)


def expected_parses(html: str) -> int:
    """What the Markdown parser may be asked to read for one page: one run for each imported body
    printed beside records, one for an import-only page, none for a page with no import."""

    bodies = len(re.findall(r"As written at (?!onboarding)", html))
    return bodies if "As written at onboarding" in html else min(bodies, 1)


def main() -> int:
    page_mod, page_error = load("page")

    def corpus_present() -> str | None:
        if not (GOLDEN / "VERSION").is_file():
            return "the golden corpus has no VERSION"
        missing = [f"{store}/{page}" for store in STORES for page in BASE if golden_page(store, page) is None]
        return f"golden pages are absent: {missing[:4]}" if missing else None

    check("the golden corpus holds the family's pages for every store fixture", corpus_present)

    with tempfile.TemporaryDirectory(prefix="amanuensis-so18-") as tmp:
        root = Path(tmp)
        runs: dict[str, tuple[Path, Path, dict[str, Any], list[tuple[str, str]]]] = {}
        seeds: dict[str, Callable[[Path, tuple[str, str]], None]] = {
            "rich": seed_rich, "bare": seed_bare, "records": seed_records, "imports": seed_imports,
            "noconcerns": seed_noconcerns,
        }
        names = (*STORES, *seeds)

        def publish_all() -> str | None:
            for store in names:
                source = store if store in STORES else "lens"
                if not (GOLDEN / source / "memory.sql").is_file():
                    return f"{source}: the golden corpus has no memory.sql"
                storage, sealed = prepare(source, root, store, seeds.get(store))
                if sealed:
                    return f"{store}: {sealed}"
                output = root / store / "docs"
                summary, calls = publish_instrumented(storage, output)
                runs[store] = (storage, output, summary, calls)
            return None

        check("every store fixture and every seeded store rebuilds and publishes", publish_all)

        def green() -> str | None:
            for store, (_storage, _output, summary, _calls) in runs.items():
                reason = axes_green(summary)
                if reason:
                    return f"{store}: {reason}"
            return None if len(runs) == len(names) else "not every store was published"

        check("each publication reads back green on all three axes", green)

        def seeds_reach() -> str | None:
            for store, pages in REACH.items():
                if store not in runs:
                    return f"{store} was not published"
                for page, words in pages.items():
                    path = runs[store][1] / f"{page}.html"
                    if not path.is_file():
                        return f"{store}/{page}.html is not published"
                    text = path.read_text()
                    absent = [word for word in words if word not in text]
                    if absent:
                        return f"{store}/{page}.html does not print {absent}, so the seed misses its branch"
            for store, pages in ABSENT.items():
                for page in pages:
                    if (runs[store][1] / f"{page}.html").exists():
                        return f"{store} publishes {page}.html though it holds no record or import for it"
            for store, pages in NOT_IN.items():
                for page, words in pages.items():
                    text = (runs[store][1] / f"{page}.html").read_text()
                    present = [word for word in words if word in text]
                    if present:
                        return f"{store}/{page}.html prints {present} though the seed holds no import"
            return None

        check("the seeded stores reach the branches they were made for", seeds_reach)

        def no_parse() -> str | None:
            if len(runs) != len(names):
                return "not every store was published"
            blind = 0
            for store, (_storage, output, _summary, calls) in runs.items():
                pages = family_pages(output)
                family = {f"{page}.html" for page in pages}
                for path, caller in calls:
                    if path in family and caller != LEGACY:
                        return f"{store}: the Markdown parser ran for {path} from {caller or 'unknown'}, not from legacy_prose.py"
                for page in pages:
                    html = (output / f"{page}.html").read_text()
                    seen = sum(1 for path, _caller in calls if path == f"{page}.html")
                    wanted = expected_parses(html)
                    if seen != wanted:
                        return f"{store}/{page}.html: the parser ran {seen} time(s) where {wanted} imported body(ies) are printed"
                blind += sum(1 for path, _caller in calls if path not in family)
            return None if blind >= 5 else f"the counter saw {blind} parses of other pages, so it is not counting"

        check("only legacy_prose reads Markdown for a family page, once per imported body, and the counter counts the others", no_parse)

        def golden_equal() -> str | None:
            for store in STORES:
                if store not in runs:
                    return "not every store was published"
                output = runs[store][1]
                pages = golden_pages(store)
                if family_pages(output) != pages:
                    return f"{store} publishes the family pages {family_pages(output)}, the golden has {pages}"
                for page in pages:
                    if (store, page) in WORKSPACE_DEPENDENT:
                        continue
                    wanted = golden_page(store, page)
                    path = output / f"{page}.html"
                    if wanted is None or not path.is_file():
                        return f"{store}/{page}.html is missing"
                    if path.read_text() != wanted:
                        return f"{store}/{page}.html {differs(path.read_text(), wanted)}"
            return None

        check("every family page of every golden store is reproduced byte for byte", golden_equal)

        def start_equal() -> str | None:
            with tempfile.TemporaryDirectory(prefix="amanuensis-so18-start-") as old:
                tree = start_tree(Path(old))
                if tree is None:
                    return f"the tree at {START_SHA[:12]} cannot be extracted from git"
                for store in ("lens", *seeds):
                    if store not in runs:
                        return f"{store} was not published"
                    source = store if store in STORES else "lens"
                    storage, sealed = prepare(source, Path(old), store, seeds.get(store))
                    if sealed:
                        return f"{store}: {sealed}"
                    before = Path(old) / store / "docs"
                    if not run_start_tree(tree, storage, before):
                        return f"the tree this packet started from did not publish the {store} store"
                    after = runs[store][1]
                    files = sorted(
                        {str(p.relative_to(before)) for p in before.rglob("*") if p.is_file() and p.suffix in (".html", ".js")}
                        | {str(p.relative_to(after)) for p in after.rglob("*") if p.is_file() and p.suffix in (".html", ".js")}
                    )
                    for name in files:
                        a, b = after / name, before / name
                        if not a.is_file() or not b.is_file():
                            return f"{store}/{name} is published by only one of the two trees"
                        if unmarked(a.read_text()) != b.read_text():
                            return f"{store}/{name} {differs(unmarked(a.read_text()), b.read_text())}"
            return None

        check("the lens, rich, bare and partial stores print what the packet's start tree prints for them", start_equal)

        def renderers_return_pages() -> str | None:
            if page_mod is None:
                return page_error
            core, error = load("core")
            renderers, error2 = load("renderers")
            if core is None or renderers is None:
                return error or error2
            if "rich" not in runs:
                return "the rich store was not published"
            storage = runs["rich"][0]
            conn = core.open_ro(storage / "memory.db")
            try:
                matrix = dict(conn.execute("SELECT * FROM diagnosticity_sessions WHERE id = 8").fetchone())
                built = [
                    ("concerns", renderers.render_concerns(conn, storage)),
                    ("seams", renderers.render_seams(conn, storage)),
                    ("diagnosticity", renderers.render_diagnosticity(conn, storage)),
                    ("diagnosticity/dm-8", renderers.render_diagnosticity_matrix(conn, storage, matrix)),
                    ("vocabulary", renderers.render_vocabulary(conn, storage)),
                    ("files", renderers.render_files(conn, storage)),
                    ("not-yet-surveyed", renderers.render_not_yet_surveyed(conn, storage)),
                    ("concern-checklist", renderers.record_page(conn, storage, "concern-checklist", "Calibrated review checklist")),
                    ("onboarding-report", renderers.record_page(conn, storage, "onboarding-report", "Onboarding record")),
                    ("entry-point", renderers.record_page(conn, storage, "entry-point", "Where to begin")),
                ]
                for page, result in built:
                    if result is None:
                        return f"the renderer of {page} returns nothing for a store that holds its records"
                    model, sources = result
                    if not isinstance(model, page_mod.Page):
                        return f"the renderer of {page} returns {type(model).__name__}, not a Page"
                    if model.path != f"{page}.html":
                        return f"the Page of {page} has the path {model.path!r}"
                    if not model.title or not model.blocks or not sources:
                        return f"the {page} Page has no title, no blocks or no sources"
            finally:
                conn.close()
            return None

        check("each renderer returns a Page with its title, path, blocks and sources", renderers_return_pages)

        def imported_only_page() -> str | None:
            legacy, error = load("legacy_prose")
            if legacy is None:
                return error
            if "imports" not in runs:
                return "the imports store was not published"
            core, error = load("core")
            renderers, error2 = load("renderers")
            if core is None or renderers is None:
                return error or error2
            storage = runs["imports"][0]
            conn = core.open_ro(storage / "memory.db")
            try:
                result = renderers.record_page(conn, storage, "onboarding-report", "Onboarding record")
            finally:
                conn.close()
            if result is None or isinstance(result[0], str):
                return "an import-only page is not returned as a Page"
            return None

        check("an import-only page is a Page too", imported_only_page)

        def mutations_reach() -> str | None:
            for number, (label, page, statement, word) in enumerate(MUTATIONS):
                name = f"mut-{number}"
                storage, sealed = prepare("lens", root, name, seed_rich)
                if sealed:
                    return f"{label}: {sealed}"
                db = sqlite3.connect(storage / "memory.db")
                try:
                    drop_triggers(db)
                    changed = db.execute(statement).rowcount
                    db.commit()
                finally:
                    db.close()
                if not changed:
                    return f"the edit of {label} matched no row, so the seed does not hold it"
                output = root / name / "docs"
                publish_instrumented(storage, output)
                path = output / f"{page}.html"
                if not path.is_file():
                    return f"{page}.html is not published after {label} was changed"
                text = path.read_text()
                if word is not None and word not in text:
                    return f"{page}.html does not print {word!r} after {label} was changed"
                if text == (runs["rich"][1] / f"{page}.html").read_text():
                    return f"{page}.html is unchanged by an edit of {label}"
            return None

        check("an edit to a record the page reads changes that page", mutations_reach)

    def in_ci() -> str | None:
        text = CI_FILE.read_text() if CI_FILE.is_file() else ""
        return None if "test-store-only-convert-method.py" in text else "test.yml does not run the gate"

    check("the gate runs in CI", in_ci)

    if FAILURES:
        emit(f"GATE SO18 RED: {FAILURES[0]}"[:480])
        return 1
    emit("GATE SO18 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
