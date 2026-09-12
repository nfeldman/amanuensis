#!/usr/bin/env python3
"""Gate for reader-lenses packet P9 — the remaining Unresolved and History
pages, the basis a resolution rests on, and the reader's guide generated from
the enum source (spec.md §6.1, §7.1, §7.6, §7.7, §7.8, §10; claims C28, C36,
C37, C38, C58, C61, C55, C63).

Turns red when:

  - `disagreements.md` is absent, is not an Unresolved page, drops an
    unresolved contradiction, an `open` or `unresolved-competition` matrix, or
    an `unresolved-competition` disposition, or carries anything already
    resolved; or a seeded `unresolved-competition` matrix also appears on a
    History page, which would put one record in both lenses (§1.1);
  - `contradictions.md` still carries the unresolved rows that moved;
  - `hot-spots.md` is absent, does not carry one row per subsystem, prints a
    composite column or a total row, sorts by anything but open critical+high,
    then open medium+low, then unread fraction, then subsystem id, or reports a
    measure that disagrees with the store. The fixture ties two subsystems at
    every level of that sort, so a wrong key is visible rather than incidental;
  - the access-heat column is printed when no `access_log` row reaches a
    subsystem — or is still missing once one does. A column that can never
    appear and a column that can never be omitted are the same
    zero-denominator green (VP4), so both directions are measured;
  - `resolution-history.md` is absent, is not newest-first over both event
    tables, or fails to link an event to the page its record renders on;
  - `resolved-leads.md` is absent, drops or reorders the answered, dismissed,
    and superseded questions, drops the closed leads, orders either group by
    something other than `resolved_at` and `id`, or omits §1.1's statement of
    what the store does not record about how they got there; or the rows it
    received are still rendered on `open-questions.md` and `field-notes.md`;
  - `sessions.md` is absent or does not carry the sessions, the refresh runs,
    and the projection verification runs with their three axes;
  - a resolved finding renders without its basis, or a terminal finding with no
    recorded rationale and no evidence renders as resolved-with-proof instead
    of `none-recorded` and a count under **Terminal without a recorded basis**;
  - `how-to-read.md` is not generated from `conspectus-vocabulary.json`: any
    enum, value, label, operational meaning, or what-it-cannot-justify the
    contract carries and the page does not, or a route table that a published
    page is missing from;
  - an empty lens page renders as a bare "none" rather than stating its scope,
    its basis, and the checked revision (§6.1);
  - the gate does not run in CI.

False green it cannot exclude: every count is read from one store this gate
seeded, so agreement proves the renderers read the store they were given, never
that `resolve_finding` or `detect_changes` wrote the right rows. The ordering
checks read Markdown source order, not what a browser paints. The basis check
proves the page reports what the event carries; it cannot tell a truthful
rationale from a false one.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed, so a missing
deliverable reports as an assertion failure rather than as a crash.
"""

from __future__ import annotations

import json
import re
import shutil
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
VOCABULARY_CONTRACT = REPO / "mcp-server" / "contracts" / "conspectus-vocabulary.json"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"

# ---------------------------------------------------------------------------
# Output funnel. Nothing reaches stdout except through emit(), and everything is
# scrubbed of the launcher's crash signatures so a genuine assertion failure is
# never mistaken for a gate that never ran.
# ---------------------------------------------------------------------------
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
    ("KeyError", "key-error"),
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
# What the specification fixes, written out here rather than imported, so that
# rewriting an implementation constant cannot also rewrite what this gate
# expects (§6.1, §7.1, §7.6, §7.7).
# ---------------------------------------------------------------------------
PROJECT_NAME = "LensFixture"

DISAGREEMENTS = "disagreements.md"
HOT_SPOTS = "hot-spots.md"
RESOLUTION_HISTORY = "resolution-history.md"
RESOLVED_LEADS = "resolved-leads.md"
SESSIONS_PAGE = "sessions.md"
CONTRADICTIONS = "contradictions.md"
RESOLVED_FINDINGS = "resolved-findings.md"
FINDINGS_PAGE = "findings.md"
OPEN_QUESTIONS = "open-questions.md"
FIELD_NOTES = "field-notes.md"
HOW_TO_READ = "how-to-read.md"

# §7.1's group for each new page.
EXPECTED_GROUP_OF: dict[str, str] = {
    DISAGREEMENTS: "Unresolved",
    HOT_SPOTS: "Unresolved",
    RESOLUTION_HISTORY: "History",
    RESOLVED_LEADS: "History",
    SESSIONS_PAGE: "History",
}

# Every page a record can reach a terminal state on. A record still competing
# must appear on none of them (§1.1: no record is a full record in both lenses).
HISTORY_PAGES: tuple[str, ...] = (
    RESOLVED_FINDINGS,
    RESOLUTION_HISTORY,
    RESOLVED_LEADS,
    SESSIONS_PAGE,
    CONTRADICTIONS,
)

# §7.6's columns, in order, without the conditional tenth.
HOT_SPOT_COLUMNS: tuple[str, ...] = (
    "Subsystem",
    "Open critical + high",
    "Open medium + low",
    "Awaiting verification",
    "Undiscriminated",
    "Weakest evidence quality",
    "Unread files",
    "Stale files",
    "Unassessed seam sides",
)
ACCESS_COLUMN = "Access heat"
# A composite of several measures is exactly what §7.6 forbids (BP26).
COMPOSITE_WORDS: tuple[str, ...] = ("score", "index", "composite", "total", "health", "rank")

PER_PARTY_PROXY_PHRASE = "per-party-proxy"

# §1.1's two statements, verbatim. They are the point of C58: History never
# presents a reconstruction it cannot source.
QUESTION_LIMIT = "When this reached its state is recorded; how it did is not."
LEAD_LIMIT = (
    "Neither when nor how this lead reached its state is recorded, only that it"
    " did; the order below is the order the leads were opened."
)

# §7.7's basis vocabulary.
BASIS_KINDS: tuple[str, ...] = ("evidence", "authorized-dismissal", "none-recorded")
NO_BASIS_SENTENCE = "No basis is recorded for this resolution."
NO_BASIS_HEADING = "Terminal without a recorded basis"

# §6.1: an empty lens page states its scope, its basis, and the checked
# revision. A bare "none" is the failure.
EMPTY_LENS_PAGES: tuple[str, ...] = (
    FINDINGS_PAGE,
    DISAGREEMENTS,
    OPEN_QUESTIONS,
    FIELD_NOTES,
    HOT_SPOTS,
    "stale.md",
    RESOLVED_FINDINGS,
    RESOLUTION_HISTORY,
    RESOLVED_LEADS,
    SESSIONS_PAGE,
    CONTRADICTIONS,
)
EMPTY_LABELS: tuple[str, ...] = ("Scope", "Basis", "Checked revision")

SHA_A = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"
SHA_B = "bbbbbbbbbbbb2222bbbbbbbbbbbb2222bbbbbbbb"
SHA_FIX = "cccccccccccc3333cccccccccccc3333cccccccc"

# ---------------------------------------------------------------------------
# The seeded store. Every derived count is distinct, and the hot-spot sort ties
# at each of its first three keys, so no wrong sort key can coincide with the
# right answer.
# ---------------------------------------------------------------------------
# The subsystems are read in id order, so the expected hot-spot order below is
# deliberately *not* id order at any level: the highest open critical+high count
# is on the last id, each tie is broken against id order, and the two subsystems
# that tie on everything carry names in the opposite order to their ids. A sort
# that drops any one of §7.6's four keys therefore produces a different table,
# rather than the same one by the accident of a stable sort (VP4).
SUBSYSTEMS: tuple[tuple[str, str, str, str, str], ...] = (
    ("B-01", "Read path", "mapped", "backend", "src/read and the files it re-exports"),
    ("B-02", "Write path", "mapped", "backend", "src/write"),
    ("B-03", "Queue", "concerns", "backend", "src/queue"),
    ("C-01", "Cache", "mapped", "backend", "src/cache"),
    ("D-01", "Zephyr", "scoping", "backend", "src/zephyr"),
    ("E-01", "Aqueduct", "scoping", "backend", "src/aqueduct"),
    ("F-01", "Console", "mapped", "frontend", "ui/console"),
)
SUBSYSTEM_IDS = tuple(s[0] for s in SUBSYSTEMS)
SUBSYSTEM_NAMES = {s[0]: s[1] for s in SUBSYSTEMS}

# (subsystem, path, classification, stale)
LEDGER: tuple[tuple[str, str, str, int], ...] = (
    ("B-01", "src/read/a.ts", "examined", 1),
    ("B-01", "src/read/b.ts", "examined", 0),
    ("B-01", "src/read/c.ts", "examined", 0),
    ("B-01", "src/read/d.ts", "candidate", 0),
    ("B-01", "dist/read.min.js", "generated-ignore", 0),
    ("B-02", "src/write/w1.ts", "examined", 0),
    ("B-02", "src/write/w2.ts", "examined", 0),
    ("B-03", "src/queue/q1.ts", "examined", 0),
    ("B-03", "src/queue/q2.ts", "examined", 0),
    ("B-03", "src/queue/q3.ts", "examined", 0),
    ("B-03", "src/queue/q4.ts", "candidate", 0),
    ("C-01", "src/cache/k1.ts", "examined", 0),
    ("C-01", "src/cache/k2.ts", "candidate", 0),
    ("C-01", "src/cache/k3.ts", "candidate", 0),
    ("C-01", "src/cache/k4.ts", "candidate", 0),
    ("F-01", "ui/console/u1.ts", "examined", 0),
    ("F-01", "ui/console/u2.ts", "examined", 0),
    ("F-01", "ui/console/u3.ts", "examined", 0),
    ("F-01", "ui/console/u4.ts", "candidate", 0),
)
EVIDENCE_PATH = "src/write/w1.ts"

CONCERNS: tuple[tuple[str, str, str], ...] = (
    ("SC-1", "composition", "active"),
    ("CC-1", "concurrency", "active"),
    ("CC-2", "data-integrity", "active"),
)
# (subsystem, concern, classification, evidence_quality)
DISPOSITIONS: tuple[tuple[str, str, str, str], ...] = (
    ("B-01", "SC-1", "confirmed-acceptable", "code-verified"),
    ("B-01", "CC-1", "confirmed-bug", "name-inferred"),
    ("B-01", "CC-2", "confirmed-bug", "code-verified"),
    ("B-02", "CC-2", "confirmed-bug", "pattern-matched"),
    ("B-03", "CC-1", "ruled-out", "code-verified"),
    ("F-01", "CC-1", "unresolved-competition", "contract-stated"),
)
UNDISCRIMINATED_DISPOSITION = ("F-01", "CC-1")

SEAMS: tuple[tuple[str, str, str, str], ...] = (
    ("SM-1", "the row buffer", "B-01", "B-02"),
    ("SM-2", "the queue handle", "B-02", "B-03"),
    ("SM-3", "the console bridge", "C-01", "F-01"),
)

# (finding_id, subsystem, severity, legacy status, resolution state, recorded_at)
# A resolution state of "" means no event at all: the legacy-status fallback
# selects the state and the store records no rationale for it, which is one of
# the two ways §7.7's `none-recorded` basis arises.
FINDINGS: tuple[tuple[str, str, str, str, str, str], ...] = (
    ("B01-1", "B-01", "CRITICAL", "confirmed-bug", "open", "2026-09-01T01:00:00Z"),
    ("B01-2", "B-01", "HIGH", "confirmed-bug", "open", "2026-09-01T02:00:00Z"),
    ("B01-3", "B-01", "LOW", "confirmed-bug", "open", "2026-09-01T03:00:00Z"),
    ("B01-4", "B-01", "HIGH", "fixed", "fixed-pending-verification", "2026-09-02T01:00:00Z"),
    ("B02-1", "B-02", "CRITICAL", "confirmed-bug", "open", "2026-09-01T04:00:00Z"),
    ("B02-2", "B-02", "HIGH", "confirmed-bug", "open", "2026-09-01T05:00:00Z"),
    ("B02-3", "B-02", "MEDIUM", "confirmed-bug", "open", "2026-09-01T12:00:00Z"),
    ("B02-4", "B-02", "LOW", "confirmed-bug", "open", "2026-09-01T13:00:00Z"),
    ("B02-5", "B-02", "HIGH", "fixed", "verified-fixed", "2026-09-03T01:00:00Z"),
    ("B02-6", "B-02", "MEDIUM", "ruled-out", "ruled-out", "2026-09-03T02:00:00Z"),
    ("B03-1", "B-03", "MEDIUM", "confirmed-bug", "open", "2026-09-01T06:00:00Z"),
    ("B03-2", "B-03", "LOW", "confirmed-bug", "open", "2026-09-01T07:00:00Z"),
    ("B03-3", "B-03", "LOW", "confirmed-acceptable", "accepted", "2026-09-04T01:00:00Z"),
    ("C01-1", "C-01", "MEDIUM", "confirmed-bug", "open", "2026-09-01T08:00:00Z"),
    ("C01-2", "C-01", "LOW", "confirmed-bug", "open", "2026-09-01T09:00:00Z"),
    ("C01-3", "C-01", "LOW", "confirmed-acceptable", "accepted", "2026-09-04T02:00:00Z"),
    ("F01-1", "F-01", "CRITICAL", "confirmed-bug", "open", "2026-09-01T10:00:00Z"),
    ("F01-2", "F-01", "HIGH", "confirmed-bug", "open", "2026-09-01T11:00:00Z"),
    ("F01-3", "F-01", "HIGH", "confirmed-bug", "open", "2026-09-01T14:00:00Z"),
    ("F01-4", "F-01", "LOW", "confirmed-acceptable", "", ""),
)
FINDING_IDS = tuple(f[0] for f in FINDINGS)
EVIDENCE_BACKED = "B02-5"           # verified-fixed: basis is the evidence row
DISMISSAL_BACKED = "B02-6"          # ruled-out: basis is an authorized dismissal
ACCEPTED_WITH_RATIONALE = "C01-3"   # accepted, rationale recorded
EMPTY_RATIONALE = "B03-3"           # accepted, rationale recorded empty
LEGACY_TERMINAL = "F01-4"           # accepted by fallback, no event at all
NO_BASIS_FINDINGS: tuple[str, ...] = (EMPTY_RATIONALE, LEGACY_TERMINAL)
DISMISSAL_RATIONALE = "Adversarial review overturned the claim at the fixed revision."
ACCEPTED_RATIONALE = "The behaviour is the recorded design and is documented as such."
FIX_LOCATION = "src/write/w1.ts:flush"

# (id, finding_a, finding_b, resolution, recorded_at)
CONTRADICTIONS_SEED: tuple[tuple[int, str, str, str, str], ...] = (
    (1, "B01-1", "B01-2", "unresolved", "2026-09-02T12:00:00Z"),
    (2, "B02-1", "B03-1", "unresolved", ""),
    (3, "B01-1", "B01-3", "a-supersedes-b", "2026-09-05T12:00:00Z"),
)
UNRESOLVED_CONTRADICTIONS = (1, 2)
RESOLVED_CONTRADICTION = 3

# (id, subsystem, outcome)
MATRICES: tuple[tuple[int, str, str], ...] = (
    (1, "B-01", "open"),
    (2, "C-01", "unresolved-competition"),
    (3, "B-02", "resolved"),
)
COMPETING_MATRICES = (1, 2)
SETTLED_MATRIX = 3

# (id, category, resolution, resolved_at)
QUESTIONS: tuple[tuple[int, str, str, str], ...] = (
    (1, "contradiction", "open", ""),
    (2, "domain-knowledge", "answered", "2026-09-05T10:00:00Z"),
    (3, "scope-judgment", "dismissed", "2026-09-07T10:00:00Z"),
    (4, "priority-ranking", "superseded", "2026-09-06T10:00:00Z"),
)
OPEN_QUESTION_IDS = (1,)
# §7.7: answered, dismissed, and superseded, newest first by `resolved_at`.
RESOLVED_QUESTION_ORDER = (3, 4, 2)

# (id, category, follow_up)
NOTES: tuple[tuple[int, str, str], ...] = (
    (1, "tension", "open"),
    (2, "anomaly", "dismissed"),
    (3, "candidate-concern", "B01-1"),
)
OPEN_NOTE_IDS = (1,)
# §7.7: closed leads by `id` descending — creation order reversed, because the
# store records no resolution time for them at all.
CLOSED_NOTE_ORDER = (3, 2)

SESSIONS: tuple[tuple[str, str, str, str, str], ...] = (
    ("p9-survey", "survey B-01", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "completed"),
    ("p9-refresh", "refresh", "2026-09-03T00:00:00Z", "", ""),
)
REFRESH_RUN_ID = "rr-p9-1"
REFRESH_RUN_STATUS = "completed"
VERIFICATION_RUN_ID = "pv-p9-1"
VERIFICATION_AXES = {"state_ok": 1, "coverage_ok": 0, "content_ok": 1}
ACCESS_ENTRY = "E-1"

# §7.6's expected table, in the order the sort produces. B-01 and B-02 tie on
# open critical+high; B-03, C-01 and F-01 tie on open medium+low; C-01 and F-01
# tie on the unread fraction as well and separate only on subsystem id.
# (id, crit+high, med+low, awaiting, undiscriminated, weakest quality, unread,
#  stale, seam sides)
EXPECTED_HOT_SPOTS: tuple[tuple[str, str, str, str, str, str, str, str, str], ...] = (
    ("F-01", "3", "0", "0", "1", "—", "1/4", "0", "2/2"),
    ("B-02", "2", "2", "0", "1", "pattern-matched", "0/2", "0", "3/4"),
    ("B-01", "2", "1", "1", "2", "name-inferred", "1/4", "1", "1/2"),
    ("C-01", "0", "2", "0", "1", "—", "3/4", "0", "2/2"),
    ("B-03", "0", "2", "0", "1", "—", "1/4", "0", "2/2"),
    ("D-01", "0", "0", "0", "0", "—", "0/0", "0", "0/0"),
    ("E-01", "0", "0", "0", "0", "—", "0/0", "0", "0/0"),
)
ACCESS_HEAT_SUBSYSTEM = "B-01"

# §7.7's timeline, newest first across both event tables. `f:` is a finding
# event and `c:` a contradiction event.
EXPECTED_TIMELINE: tuple[str, ...] = (
    "c:3", "f:C01-3", "f:B03-3", "f:B02-6", "f:B02-5", "c:1", "f:B01-4",
    "f:F01-3", "f:B02-4", "f:B02-3", "f:F01-2", "f:F01-1", "f:C01-2",
    "f:C01-1", "f:B03-2", "f:B03-1", "f:B02-2", "f:B02-1", "f:B01-3",
    "f:B01-2", "f:B01-1",
)
# Where each record's full record lives, so the timeline's link is checkable.
EXPECTED_EVENT_TARGET: dict[str, str] = {
    "c:1": f"{DISAGREEMENTS}#contradiction-1",
    "c:3": f"{CONTRADICTIONS}#contradiction-3",
    **{
        f"f:{fid}": (
            f"{FINDINGS_PAGE}#{fid.lower()}"
            if state in ("open", "fixed-pending-verification")
            else f"{RESOLVED_FINDINGS}#{fid.lower()}"
        )
        for fid, _sid, _sev, _st, state, _at in FINDINGS
        if state
    },
}

THESIS_SENTENCE = (
    "LensFixture records rows on one path and serves them on another, with a "
    "shared buffer between them."
)
ENTRY_POINT = f"""# Where to begin

A dated reading path recorded by an earlier session.

## What is this codebase?

{THESIS_SENTENCE}
"""
ONBOARDING_REPORT = f"""# Onboarding report

**Codebase**: {PROJECT_NAME} — P9 gate fixture

## Directory clusters

- src/ — the read, write, queue, and cache paths
"""
CONCERN_CHECKLIST = "# Concern checklist\n\nSeeded from the calibrated set.\n"


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------
def _connect(storage: Path) -> sqlite3.Connection:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    return db


def seed_empty(storage: Path) -> None:
    """A store with a checked revision and nothing else recorded.

    §6.1's honest empty state has to say what it looked at, so the revision is
    present and every lens is genuinely empty.
    """

    db = _connect(storage)
    db.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        f" VALUES ('default', 'main', '{SHA_A}', '{SHA_A}', '2026-09-11T12:00:00Z')"
    )
    db.commit()
    db.close()
    (storage / "entry-point.md").write_text(ENTRY_POINT)


def seed(storage: Path) -> None:
    db = _connect(storage)
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        f" VALUES ('default', 'main', '{SHA_A}', '{SHA_A}', '2026-09-11T12:00:00Z')"
    )
    cur.executemany(
        "INSERT INTO sessions (session_id, intent, started_at, ended_at, outcome)"
        " VALUES (?, ?, ?, ?, ?)",
        [
            (sid, intent, started, ended or None, outcome or None)
            for sid, intent, started, ended, outcome in SESSIONS
        ],
    )
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope) VALUES (?, ?, ?, ?, ?)",
        list(SUBSYSTEMS),
    )
    cur.executemany(
        "INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification,"
        " ref_sha, stale, stale_since, stale_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                subsystem,
                path,
                f"In scope for {subsystem}.",
                classification,
                SHA_A,
                stale,
                "2026-09-11T12:00:00Z" if stale else None,
                "git-drift" if stale else None,
            )
            for subsystem, path, classification, stale in LEDGER
        ],
    )
    cur.executemany(
        "INSERT INTO concerns (code, category, origin, status) VALUES (?, ?, 'seeded', ?)",
        list(CONCERNS),
    )
    cur.executemany(
        "INSERT INTO dispositions (subsystem_id, concern_code, classification,"
        " evidence_quality, rationale, ref_sha, session_id, pass_type)"
        f" VALUES (?, ?, ?, ?, 'fixture', '{SHA_A}', 'p9-survey', 'survey')",
        list(DISPOSITIONS),
    )
    cur.executemany(
        "INSERT INTO seams (id, shared_object, party_a, party_b, ordering_assumption)"
        " VALUES (?, ?, ?, ?, 'the buffer is written before it is read')",
        list(SEAMS),
    )
    cur.executemany(
        "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity,"
        " status, primary_files, ref_sha, session_id, pass_type)"
        f" VALUES (?, ?, ?, ?, ?, ?, ?, '{SHA_A}', 'p9-survey', 'survey')",
        [
            (
                fid,
                sid,
                f"{fid} drops a row under load",
                "the buffer is reused before the reader is done with it",
                severity,
                status,
                json.dumps([EVIDENCE_PATH]),
            )
            for fid, sid, severity, status, _state, _at in FINDINGS
        ],
    )
    cur.execute(
        "INSERT INTO evidence (id, file_path, symbol, line_range, ref_sha, kind, note,"
        " session_id) VALUES (1, ?, 'flush', '10-20', ?, 'test-observed',"
        " 'The regression test fails before the repair and passes after it.', 'p9-survey')",
        (EVIDENCE_PATH, SHA_FIX),
    )
    # `finding_verification_evidence_integrity` refuses a verified-fixed event
    # whose evidence is not attached to the finding as fix-verification.
    cur.execute(
        "INSERT INTO finding_evidence (finding_id, evidence_id, role)"
        " VALUES (?, 1, 'fix-verification')",
        (EVIDENCE_BACKED,),
    )
    # `contradiction_resolution_evidence_integrity` refuses a settled
    # contradiction whose evidence is attached to neither party.
    cur.execute(
        "INSERT INTO evidence (id, file_path, symbol, ref_sha, kind, note, session_id)"
        " VALUES (2, ?, 'read', ?, 'code-verified',"
        " 'The later reading is the one the code takes.', 'p9-survey')",
        (EVIDENCE_PATH, SHA_A),
    )
    cur.execute(
        "INSERT INTO finding_evidence (finding_id, evidence_id, role)"
        " VALUES ('B01-1', 2, 'root-cause')"
    )
    for fid, _sid, _sev, _status, state, recorded_at in FINDINGS:
        if not state:
            continue  # legacy row: the fallback picks the state, nothing records why
        rationale = ""
        evidence_id = None
        fix_location = None
        fix_sha = None
        if state in ("fixed-pending-verification", "verified-fixed"):
            fix_location, fix_sha = FIX_LOCATION, SHA_FIX
            rationale = "The repair is recorded against the commit above."
        if state == "verified-fixed":
            evidence_id = 1
        elif state == "ruled-out":
            rationale = DISMISSAL_RATIONALE
        elif state == "accepted" and fid == ACCEPTED_WITH_RATIONALE:
            rationale = ACCEPTED_RATIONALE
        elif state == "open":
            rationale = "Recorded open by the survey pass."
        cur.execute(
            "INSERT INTO finding_resolution_events (finding_id, resolution_state,"
            " fix_location, fix_sha, evidence_id, rationale, session_id, recorded_at)"
            " VALUES (?, ?, ?, ?, ?, ?, 'p9-survey', ?)",
            (fid, state, fix_location, fix_sha, evidence_id, rationale, recorded_at),
        )
    for cid, finding_a, finding_b, resolution, recorded_at in CONTRADICTIONS_SEED:
        cur.execute(
            "INSERT INTO contradictions (id, finding_a, finding_b, shared_location,"
            " conflict_type, detected_at, resolution, scope_note, resolved_at, session_id)"
            " VALUES (?, ?, ?, ?, 'classification-conflict', '2026-09-01T00:00:00Z',"
            " ?, NULL, ?, 'p9-survey')",
            (
                cid,
                finding_a,
                finding_b,
                EVIDENCE_PATH,
                resolution,
                recorded_at or None,
            ),
        )
        if not recorded_at:
            continue
        cur.execute(
            "INSERT INTO contradiction_resolution_events (contradiction_id, resolution,"
            " scope_note, evidence_id, rationale, session_id, recorded_at)"
            " VALUES (?, ?, NULL, ?, ?, 'p9-survey', ?)",
            (
                cid,
                resolution,
                2 if resolution != "unresolved" else None,
                "The later reading supersedes the earlier one."
                if resolution != "unresolved"
                else "The evidence does not discriminate between the two readings.",
                recorded_at,
            ),
        )
    cur.executemany(
        "INSERT INTO diagnosticity_sessions (id, subsystem_id, symptom, outcome,"
        " leading_concern, session_id, created_at)"
        " VALUES (?, ?, ?, ?, NULL, 'p9-survey', '2026-09-01T00:00:00Z')",
        [
            (mid, sid, f"rows appear twice after a restart ({mid})", outcome)
            for mid, sid, outcome in MATRICES
        ],
    )
    cur.executemany(
        "INSERT INTO open_questions (id, category, subsystem_id, phase, question,"
        " what_blocked, what_assumed, session_id, resolution, answer, created_at,"
        " resolved_at) VALUES (?, ?, 'B-01', 'phase-2', ?, 'a classification',"
        " 'the narrower reading', 'p9-survey', ?, ?, '2026-09-01T00:00:00Z', ?)",
        [
            (
                qid,
                category,
                f"Question {qid}: which reading of the buffer contract holds?",
                resolution,
                None if resolution == "open" else f"Recorded answer for question {qid}.",
                resolved_at or None,
            )
            for qid, category, resolution, resolved_at in QUESTIONS
        ],
    )
    cur.executemany(
        "INSERT INTO field_notes (id, category, observation, location, ref_sha,"
        f" follow_up, session_id, created_at) VALUES (?, ?, ?, '{EVIDENCE_PATH}',"
        f" '{SHA_A}', ?, 'p9-survey', '2026-09-01T00:00:00Z')",
        [
            (nid, category, f"Lead {nid}: the flush path is reached twice.", follow_up)
            for nid, category, follow_up in NOTES
        ],
    )
    cur.execute(
        "INSERT INTO projection_verification_runs (run_id, output_dir, mode, source_sha,"
        " state_ok, coverage_ok, content_ok, ok, summary_json, session_id, verified_at)"
        " VALUES (?, 'docs', 'readback', ?, ?, ?, ?, 0, '{}', 'p9-survey',"
        " '2026-09-06T00:00:00Z')",
        (
            VERIFICATION_RUN_ID,
            SHA_A,
            VERIFICATION_AXES["state_ok"],
            VERIFICATION_AXES["coverage_ok"],
            VERIFICATION_AXES["content_ok"],
        ),
    )
    cur.execute(
        "INSERT INTO refresh_runs (run_id, replicate_id, status, base_sha, head_sha,"
        " allowed_sources, provider_allowlist, selected_provider, model, runtime,"
        " determinism_mode, determinism_seed, runtime_input_json, relation_discovery_mode,"
        " max_relation_depth, authority_mode, allowed_write_prefixes,"
        " allowed_side_effects, auto_dispatch, max_concurrency,"
        " max_attempts_per_obligation, max_tokens_per_attempt, max_total_tokens,"
        " max_total_cost_microusd, planned_tokens_per_attempt, planned_cost_microusd,"
        " output_dir, manifest_json, manifest_hash, impact_run_id, projection_run_id,"
        " session_id, created_at, completed_at)"
        " VALUES (?, 'rep-1', ?, ?, ?, '[]', '[]', 'local', 'fixture-model', 'node',"
        " 'seeded', 7, '{}', 'explicit-only', 2, 'observe-only', '[]', '[]', 0, 1, 1,"
        " 1000, 2000, 0, 500, 0, 'docs', '{}', 'hash', 'impact-1', ?, 'p9-survey',"
        " '2026-09-05T00:00:00Z', '2026-09-05T01:00:00Z')",
        (REFRESH_RUN_ID, REFRESH_RUN_STATUS, SHA_A, SHA_B, VERIFICATION_RUN_ID),
    )
    cur.execute(
        "INSERT INTO entries (id, tier, subsystem_id, source_path, ref_sha, stale)"
        f" VALUES ('{ACCESS_ENTRY}', 1, '{ACCESS_HEAT_SUBSYSTEM}', 'src/read/a.ts',"
        f" '{SHA_A}', 0)"
    )
    cur.execute(
        "INSERT INTO vocabulary (term, gloss, subsystem_id, first_seen, ref_sha)"
        f" VALUES ('row buffer', 'the shared page the writer fills', 'B-01',"
        f" 'src/read/a.ts', '{SHA_A}')"
    )
    cur.execute(
        "INSERT INTO xrefs (from_id, to_id, relationship, strength, context)"
        " VALUES ('B-01', 'B-02', 'depends-on', 'confirmed', 'the reader drains the buffer')"
    )
    db.commit()
    db.close()
    (storage / "entry-point.md").write_text(ENTRY_POINT)
    (storage / "onboarding-report.md").write_text(ONBOARDING_REPORT)
    (storage / "concern-checklist.md").write_text(CONCERN_CHECKLIST)


def record_access(storage: Path) -> None:
    """One access against a subsystem-owned entry (§7.6 column 10)."""

    db = sqlite3.connect(storage / "memory.db")
    db.execute(
        "INSERT INTO access_log (entry_id, entry_tier, trigger, session_id)"
        f" VALUES ('{ACCESS_ENTRY}', 1, 'phase-3 read', 'p9-survey')"
    )
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# Reading helpers
# ---------------------------------------------------------------------------
def publish(storage: Path, *args: str) -> dict[str, Any]:
    """Run the materializer, capturing everything. Never echoes its output."""

    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage), *args],
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
    if not summary:
        summary["_diagnostic"] = scrub(proc.stderr)[-400:]
    return summary


def read(path: Path) -> str | None:
    try:
        return path.read_text()
    except OSError:
        return None


def section(text: str, heading: str, level: int = 2) -> str:
    """The body of one Markdown section, up to the next heading of its level."""

    lines = text.splitlines()
    marker = "#" * level + " "
    start = None
    for index, line in enumerate(lines):
        if line.startswith(marker) and line[len(marker):].strip() == heading:
            start = index + 1
            break
    if start is None:
        return ""
    body: list[str] = []
    for line in lines[start:]:
        stripped = line.lstrip("#")
        depth = len(line) - len(stripped)
        if line.startswith("#") and 0 < depth <= level:
            break
        body.append(line)
    return "\n".join(body)


def headings(text: str, level: int = 2) -> list[str]:
    marker = "#" * level + " "
    return [
        line[len(marker):].strip() for line in text.splitlines() if line.startswith(marker)
    ]


def tables(body: str) -> list[tuple[list[str], list[list[str]]]]:
    """Every Markdown table in `body` as (headers, data rows)."""

    out: list[tuple[list[str], list[list[str]]]] = []
    lines = body.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line.startswith("|"):
            index += 1
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        separator = lines[index + 1].strip() if index + 1 < len(lines) else ""
        parts = [cell.strip() for cell in separator.strip("|").split("|")]
        if not (
            separator.startswith("|")
            and parts
            and all(set(cell) <= {"-", ":"} and cell for cell in parts)
        ):
            index += 1
            continue
        rows: list[list[str]] = []
        index += 2
        while index < len(lines) and lines[index].strip().startswith("|"):
            rows.append(
                [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
            )
            index += 1
        out.append((cells, rows))
    return out


def plain(cell: str) -> str:
    """A table cell's text with Markdown link and emphasis syntax removed."""

    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", cell)
    text = re.sub(r"<a id=\"[^\"]*\"></a>", "", text)
    return text.replace("**", "").replace("`", "").strip()


def nav_group_of(html_text: str, page_html: str) -> str | None:
    """The navigation group heading whose section links `page_html`."""

    for block in re.findall(
        r'<section class="nav-group">(.*?)</section>', html_text, flags=re.S
    ):
        title = re.search(r'<h2 class="nav-group-title"[^>]*>(.*?)</h2>', block, flags=re.S)
        if not title:
            continue
        if re.search(rf'href="{re.escape(page_html)}"', block):
            return re.sub(r"<[^>]+>", "", title.group(1)).strip()
    return None


def order_of(text: str, tokens: list[str]) -> list[str]:
    """`tokens` in the order they first appear in `text`, skipping absent ones."""

    positions = [(text.find(token), token) for token in tokens]
    return [token for index, token in sorted(positions) if index >= 0]


# ---------------------------------------------------------------------------
def main() -> int:
    emit("GATE P9 — the Unresolved and History pages, the resolution basis,")
    emit("         and the reader's guide generated from the enum source")
    emit("")

    root = Path(tempfile.mkdtemp(prefix="p9-lens-"))
    try:
        storage = root / "store"
        storage.mkdir(parents=True)
        (storage / "project.json").write_text(json.dumps({"name": PROJECT_NAME}))
        seed_error: str | None = None
        try:
            seed(storage)
        except Exception as exc:
            seed_error = f"the fixture store could not be seeded — {scrub(exc)[:200]}"

        summary = publish(storage, "--clean-publish") if seed_error is None else {}
        docs = storage / "docs"
        page: dict[str, str] = {}
        for rel in sorted(p.name for p in docs.glob("*.md")) if docs.is_dir() else []:
            page[rel] = read(docs / rel) or ""
        index_html = read(docs / "index.html") or ""

        def publish_is_green() -> str | None:
            if seed_error:
                return seed_error
            if not summary.get("ok"):
                warnings = [scrub(w)[:160] for w in summary.get("warnings") or []]
                return (
                    "the fixture publish was not green;"
                    f" warnings={warnings[:3]}"
                    f" {scrub(summary.get('_diagnostic'))[:200]}"
                )
            return None

        check("the seeded store publishes green", publish_is_green)

        # -- the five new pages exist and sit in their lens ------------------
        def pages_planned() -> str | None:
            missing = [rel for rel in EXPECTED_GROUP_OF if rel not in page]
            if missing:
                return f"the projection publishes no {', '.join(missing)}"
            absent_html = [
                rel for rel in EXPECTED_GROUP_OF
                if not (docs / rel.replace(".md", ".html")).is_file()
            ]
            if absent_html:
                return f"no HTML companion for {', '.join(absent_html)}"
            return None

        check("disagreements, hot-spots, resolution-history, resolved-leads and sessions publish", pages_planned)

        def pages_in_their_lens() -> str | None:
            if not index_html:
                return "the published index.html is not readable"
            for rel, group in EXPECTED_GROUP_OF.items():
                found = nav_group_of(index_html, rel.replace(".md", ".html"))
                if found is None:
                    return f"{rel} is in no navigation group"
                if found != group:
                    return f"{rel} is navigated under {found!r}, not {group!r}"
            return None

        check("each new page is navigated under the lens §7.1 assigns it", pages_in_their_lens)

        # -- disagreements.md ------------------------------------------------
        disagreements = page.get(DISAGREEMENTS, "")

        def disagreements_carry_the_undiscriminated() -> str | None:
            if not disagreements:
                return f"{DISAGREEMENTS} is absent or empty"
            for cid in UNRESOLVED_CONTRADICTIONS:
                if f'<a id="contradiction-{cid}"></a>' not in disagreements:
                    return f"contradiction {cid} has no record on {DISAGREEMENTS}"
            for mid in COMPETING_MATRICES:
                if f"diagnosticity/dm-{mid}.md" not in disagreements:
                    return (
                        f"matrix DM-{mid} is not linked from {DISAGREEMENTS}; §7.1 lists"
                        " open and unresolved-competition matrices there"
                    )
            subsystem, concern = UNDISCRIMINATED_DISPOSITION
            if not re.search(
                rf"{re.escape(subsystem)}[\s\S]{{0,400}}{re.escape(concern)}",
                disagreements,
            ):
                return (
                    f"the unresolved-competition disposition ({subsystem}, {concern})"
                    f" is not recorded on {DISAGREEMENTS}"
                )
            return None

        check("disagreements.md carries the contradictions, matrices and dispositions that stand undiscriminated", disagreements_carry_the_undiscriminated)

        def disagreements_carry_nothing_resolved() -> str | None:
            if not disagreements:
                return f"{DISAGREEMENTS} is absent or empty"
            if f'id="contradiction-{RESOLVED_CONTRADICTION}"' in disagreements:
                return (
                    f"contradiction {RESOLVED_CONTRADICTION} is resolved and still"
                    f" renders on {DISAGREEMENTS}"
                )
            if f"diagnosticity/dm-{SETTLED_MATRIX}.md" in disagreements:
                return f"the settled matrix DM-{SETTLED_MATRIX} is listed on {DISAGREEMENTS}"
            for fid, _sid, _sev, _st, state, _at in FINDINGS:
                if state in ("verified-fixed", "ruled-out", "accepted") and fid in disagreements:
                    return f"{fid} has reached a terminal state and appears on {DISAGREEMENTS}"
            return None

        check("disagreements.md carries nothing already resolved", disagreements_carry_nothing_resolved)

        def competing_matrix_reaches_no_history_page() -> str | None:
            token = f"dm-{[m for m in MATRICES if m[2] == 'unresolved-competition'][0][0]}"
            for rel in HISTORY_PAGES:
                body = page.get(rel)
                if body is None:
                    return f"{rel} is absent, so the partition cannot be read"
                if f"diagnosticity/{token}.md" in body:
                    return (
                        f"the unresolved-competition matrix is listed on {rel}, a History"
                        " page; §1.1 puts no record in both lenses"
                    )
            return None

        check("an unresolved-competition matrix reaches no History page", competing_matrix_reaches_no_history_page)

        def contradictions_narrowed() -> str | None:
            body = page.get(CONTRADICTIONS)
            if not body:
                return f"{CONTRADICTIONS} is absent or empty"
            if f'<a id="contradiction-{RESOLVED_CONTRADICTION}"></a>' not in body:
                return (
                    f"the resolved contradiction {RESOLVED_CONTRADICTION} has no record on"
                    f" {CONTRADICTIONS}"
                )
            for cid in UNRESOLVED_CONTRADICTIONS:
                if f'id="contradiction-{cid}"' in body:
                    return (
                        f"contradiction {cid} is unresolved and still renders on"
                        f" {CONTRADICTIONS}; §7.1 moves it to {DISAGREEMENTS}"
                    )
            return None

        check("contradictions.md keeps only the disagreements the evidence settled", contradictions_narrowed)

        # -- hot-spots.md ----------------------------------------------------
        hot_spots = page.get(HOT_SPOTS, "")

        def hot_spot_table() -> tuple[list[str], list[list[str]]] | None:
            for headers, data in tables(hot_spots):
                if headers and plain(headers[0]) == HOT_SPOT_COLUMNS[0]:
                    return headers, data
            return None

        def hot_spot_columns() -> str | None:
            if not hot_spots:
                return f"{HOT_SPOTS} is absent or empty"
            found = hot_spot_table()
            if found is None:
                return f"{HOT_SPOTS} carries no table headed {HOT_SPOT_COLUMNS[0]!r}"
            headers = [plain(cell) for cell in found[0]]
            if tuple(headers) != HOT_SPOT_COLUMNS:
                return (
                    f"the columns are {tuple(headers)!r}, not §7.6's"
                    f" {HOT_SPOT_COLUMNS!r} (the access column is omitted here because"
                    " no access_log row reaches a subsystem)"
                )
            return None

        check("hot-spots.md carries §7.6's separate measures and no composite column", hot_spot_columns)

        def hot_spot_has_no_composite() -> str | None:
            if not hot_spots:
                return f"{HOT_SPOTS} is absent or empty"
            found = hot_spot_table()
            if found is None:
                return f"{HOT_SPOTS} carries no table headed {HOT_SPOT_COLUMNS[0]!r}"
            headers, data = found
            for cell in headers:
                lowered = plain(cell).lower()
                for word in COMPOSITE_WORDS:
                    if word in lowered:
                        return f"the column {plain(cell)!r} reads as a composite measure"
            if len(data) != len(SUBSYSTEMS):
                return (
                    f"the table carries {len(data)} rows for {len(SUBSYSTEMS)} subsystems;"
                    " §7.6 allows one row each and no total row"
                )
            return None

        check("hot-spots.md carries one row per subsystem and no total row", hot_spot_has_no_composite)

        def hot_spot_values() -> str | None:
            if not hot_spots:
                return f"{HOT_SPOTS} is absent or empty"
            found = hot_spot_table()
            if found is None:
                return f"{HOT_SPOTS} carries no table headed {HOT_SPOT_COLUMNS[0]!r}"
            _headers, data = found
            actual = [[plain(cell) for cell in row] for row in data]
            order = [
                next((sid for sid in SUBSYSTEM_IDS if sid in row[0]), row[0])
                for row in actual
            ]
            expected_order = [r[0] for r in EXPECTED_HOT_SPOTS]
            if order != expected_order:
                return (
                    f"the rows read {order!r}; §7.6 sorts by open critical+high, then"
                    f" open medium+low, then unread fraction, then id — {expected_order!r}"
                )
            for row, expected in zip(actual, EXPECTED_HOT_SPOTS, strict=False):
                for column, (value, want) in enumerate(
                    zip(row[1:], expected[1:], strict=False), start=1
                ):
                    if value != want:
                        return (
                            f"{expected[0]} reports {value!r} under"
                            f" {HOT_SPOT_COLUMNS[column]!r}, not {want!r}"
                        )
            return None

        check("every hot-spot measure agrees with the store", hot_spot_values)

        def hot_spot_carries_the_proxy_sentence() -> str | None:
            if not hot_spots:
                return f"{HOT_SPOTS} is absent or empty"
            if PER_PARTY_PROXY_PHRASE not in hot_spots:
                return (
                    "the unassessed-seam column carries no per-party-proxy binding;"
                    " §2.4.6 requires it wherever that proxy is read"
                )
            return None

        check("the unassessed-seam column declares its per-party proxy", hot_spot_carries_the_proxy_sentence)

        def access_column_absent() -> str | None:
            if not hot_spots:
                return f"{HOT_SPOTS} is absent or empty"
            found = hot_spot_table()
            if found is None:
                return f"{HOT_SPOTS} carries no table headed {HOT_SPOT_COLUMNS[0]!r}"
            if any(plain(cell) == ACCESS_COLUMN for cell in found[0]):
                return (
                    f"the {ACCESS_COLUMN!r} column is printed while no access_log row"
                    " reaches a subsystem; §7.6 omits it rather than printing zeros"
                )
            return None

        check("the access column is absent when no access row reaches a subsystem", access_column_absent)

        # -- resolution-history.md -------------------------------------------
        timeline = page.get(RESOLUTION_HISTORY, "")

        def timeline_is_newest_first() -> str | None:
            if not timeline:
                return f"{RESOLUTION_HISTORY} is absent or empty"
            reverse = {target: token for token, target in EXPECTED_EVENT_TARGET.items()}
            seen: list[str] = []
            for target in re.findall(r"\]\(([^)]+)\)", timeline):
                token = reverse.get(target.strip())
                if token and (not seen or seen[-1] != token):
                    seen.append(token)
            if not seen:
                return (
                    "no event on the timeline links to the page its record renders on;"
                    " §7.7 links every event to its finding or contradiction"
                )
            if tuple(seen) != EXPECTED_TIMELINE:
                missing = [t for t in EXPECTED_TIMELINE if t not in seen]
                return (
                    f"the timeline reads {seen[:6]!r}… for {len(seen)} events;"
                    f" §7.7 is newest first — {list(EXPECTED_TIMELINE)[:6]!r}… for"
                    f" {len(EXPECTED_TIMELINE)}"
                    + (f"; absent: {missing!r}" if missing else "")
                )
            return None

        check("resolution-history.md is newest-first and links every event to its record", timeline_is_newest_first)

        def timeline_covers_both_event_tables() -> str | None:
            if not timeline:
                return f"{RESOLUTION_HISTORY} is absent or empty"
            for token, target in EXPECTED_EVENT_TARGET.items():
                if token.startswith("c:") and target not in timeline:
                    return (
                        f"no contradiction event links to {target};"
                        " §7.7 spans both event tables"
                    )
            return None

        check("resolution-history.md spans finding and contradiction events alike", timeline_covers_both_event_tables)

        # -- resolved-leads.md ------------------------------------------------
        leads = page.get(RESOLVED_LEADS, "")

        def resolved_leads_membership() -> str | None:
            if not leads:
                return f"{RESOLVED_LEADS} is absent or empty"
            question_tokens = [f"question-{qid}" for qid in RESOLVED_QUESTION_ORDER]
            seen = order_of(leads, question_tokens)
            if seen != question_tokens:
                return (
                    f"the resolved questions read {seen!r}; §7.7 orders answered,"
                    f" dismissed and superseded by resolved_at — {question_tokens!r}"
                )
            for qid in OPEN_QUESTION_IDS:
                if f"question-{qid}" in leads:
                    return f"open question {qid} renders on the History page"
            note_tokens = [f"lead-{nid}" for nid in CLOSED_NOTE_ORDER]
            seen_notes = order_of(leads, note_tokens)
            if seen_notes != note_tokens:
                return (
                    f"the closed leads read {seen_notes!r}; §7.7 orders them by id"
                    f" descending — {note_tokens!r}"
                )
            for nid in OPEN_NOTE_IDS:
                if f"lead-{nid}" in leads:
                    return f"open lead {nid} renders on the History page"
            return None

        check("resolved-leads.md carries the closed questions and leads in their recorded order", resolved_leads_membership)

        def resolved_leads_state_their_limit() -> str | None:
            if not leads:
                return f"{RESOLVED_LEADS} is absent or empty"
            if QUESTION_LIMIT not in leads:
                return (
                    "the questions group does not state what the store records about how"
                    f" they were resolved; §1.1 fixes the sentence: {QUESTION_LIMIT!r}"
                )
            if LEAD_LIMIT not in leads:
                return (
                    "the leads group does not state what the store records about how they"
                    f" were closed; §1.1 fixes the sentence: {LEAD_LIMIT!r}"
                )
            return None

        check("each resolved-leads group states what the store does not record (C58)", resolved_leads_state_their_limit)

        def unresolved_pages_narrowed() -> str | None:
            questions = page.get(OPEN_QUESTIONS)
            if not questions:
                return f"{OPEN_QUESTIONS} is absent or empty"
            for qid in RESOLVED_QUESTION_ORDER:
                if f"question-{qid}" in questions:
                    return (
                        f"question {qid} reached a terminal state and still renders on"
                        f" {OPEN_QUESTIONS}"
                    )
            notes = page.get(FIELD_NOTES)
            if not notes:
                return f"{FIELD_NOTES} is absent or empty"
            for nid in CLOSED_NOTE_ORDER:
                if f"lead-{nid}" in notes:
                    return f"closed lead {nid} still renders on {FIELD_NOTES}"
            for nid in OPEN_NOTE_IDS:
                if f"lead-{nid}" not in notes:
                    return f"open lead {nid} is no longer on {FIELD_NOTES}"
            return None

        check("the Unresolved lens keeps only what is still open", unresolved_pages_narrowed)

        # -- sessions.md ------------------------------------------------------
        def sessions_page_is_complete() -> str | None:
            body = page.get(SESSIONS_PAGE)
            if not body:
                return f"{SESSIONS_PAGE} is absent or empty"
            for sid, intent, started, ended, outcome in SESSIONS:
                for token in (sid, intent, started[:10]):
                    if token not in body:
                        return f"the session {sid} does not carry {token!r}"
                if ended and ended[:10] not in body:
                    return f"the session {sid} does not carry its end"
                if outcome and outcome not in body:
                    return f"the session {sid} does not carry its outcome"
            if REFRESH_RUN_ID not in body or REFRESH_RUN_STATUS not in body:
                return "no refresh run is recorded; §7.7 lists them beside the sessions"
            if VERIFICATION_RUN_ID not in body:
                return "no projection verification run is recorded"
            lowered = body.lower()
            for axis in ("state", "coverage", "content"):
                if axis not in lowered:
                    return f"the verification run does not report its {axis} axis"
            return None

        check("sessions.md carries the sessions, refresh runs and verification runs", sessions_page_is_complete)

        # -- the basis a resolution rests on (§7.7) ---------------------------
        resolved = page.get(RESOLVED_FINDINGS, "")

        def basis_is_labelled_by_kind() -> str | None:
            if not resolved:
                return f"{RESOLVED_FINDINGS} is absent or empty"
            for kind in BASIS_KINDS:
                if kind not in resolved:
                    return (
                        f"the page never labels a basis {kind!r}; §7.7 labels the basis by"
                        " kind because the schema requires different things of different"
                        " states"
                    )
            if "test-observed" not in resolved:
                return (
                    f"{EVIDENCE_BACKED} is verified-fixed and its basis does not name the"
                    " kind of the evidence row that verified it"
                )
            if SHA_FIX[:8] not in resolved or FIX_LOCATION not in resolved:
                return "a verified repair does not carry its fix revision and location"
            if DISMISSAL_RATIONALE not in resolved:
                return f"{DISMISSAL_BACKED} is ruled out and its overturning argument is not rendered"
            if ACCEPTED_RATIONALE not in resolved:
                return f"{ACCEPTED_WITH_RATIONALE} is accepted and its rationale is not rendered"
            return None

        check("every resolved finding renders the basis its resolution rests on", basis_is_labelled_by_kind)

        def terminal_without_basis_is_declared() -> str | None:
            if not resolved:
                return f"{RESOLVED_FINDINGS} is absent or empty"
            if NO_BASIS_SENTENCE not in resolved:
                return (
                    "a terminal finding with neither evidence nor a rationale does not"
                    f" render {NO_BASIS_SENTENCE!r}; §7.7 refuses to claim a basis it does"
                    " not have"
                )
            if NO_BASIS_HEADING not in resolved:
                return f"the page carries no {NO_BASIS_HEADING!r} section"
            body = section(resolved, NO_BASIS_HEADING)
            if not body.strip():
                body = section(resolved, NO_BASIS_HEADING, level=3)
            if not body.strip():
                return f"the {NO_BASIS_HEADING!r} section is empty"
            for fid in NO_BASIS_FINDINGS:
                if fid not in body:
                    return (
                        f"{fid} reached a terminal state with no recorded basis and is not"
                        f" counted under {NO_BASIS_HEADING!r}"
                    )
            if ACCEPTED_WITH_RATIONALE in body:
                return (
                    f"{ACCEPTED_WITH_RATIONALE} records a rationale and is counted as"
                    " having no basis"
                )
            if not re.search(rf"(?<![0-9]){len(NO_BASIS_FINDINGS)}(?![0-9])", body):
                return (
                    f"the section does not report the count {len(NO_BASIS_FINDINGS)};"
                    " §7.7 requires it"
                )
            return None

        check("a terminal finding with no recorded basis is none-recorded and counted", terminal_without_basis_is_declared)

        def one_marker_per_finding() -> str | None:
            import hashlib

            corpus = "\n".join(
                read(path) or "" for path in sorted(docs.rglob("*.md")) if path.is_file()
            )
            for fid in FINDING_IDS:
                token = hashlib.sha256(fid.encode("utf-8")).hexdigest()
                marker = f"<!-- amanuensis:finding:{token} -->"
                if corpus.count(marker) != 1:
                    return (
                        f"{fid} carries {corpus.count(marker)} durable markers across the"
                        " Markdown corpus, not exactly one (§6.2)"
                    )
            return None

        check("each finding keeps exactly one durable marker", one_marker_per_finding)

        def terminal_records_leave_the_unresolved_lens() -> str | None:
            questions = page.get(OPEN_QUESTIONS)
            if not questions:
                return f"{OPEN_QUESTIONS} is absent or empty"
            for qid in RESOLVED_QUESTION_ORDER:
                if f"Question {qid}:" in questions:
                    return (
                        f"question {qid} reached a terminal state and its text still"
                        f" renders on {OPEN_QUESTIONS}"
                    )
            if f"Question {OPEN_QUESTION_IDS[0]}:" not in questions:
                return f"the open question is no longer on {OPEN_QUESTIONS}"
            notes = page.get(FIELD_NOTES)
            if not notes:
                return f"{FIELD_NOTES} is absent or empty"
            for nid in CLOSED_NOTE_ORDER:
                if f"Lead {nid}:" in notes:
                    return f"closed lead {nid}'s observation still renders on {FIELD_NOTES}"
            if f"Lead {OPEN_NOTE_IDS[0]}:" not in notes:
                return f"the open lead is no longer on {FIELD_NOTES}"
            for qid in RESOLVED_QUESTION_ORDER:
                if f"Question {qid}:" not in leads:
                    return f"question {qid} left {OPEN_QUESTIONS} without reaching {RESOLVED_LEADS}"
            for nid in CLOSED_NOTE_ORDER:
                if f"Lead {nid}:" not in leads:
                    return f"lead {nid} left {FIELD_NOTES} without reaching {RESOLVED_LEADS}"
            return None

        check("every closed question and lead moved rather than vanished", terminal_records_leave_the_unresolved_lens)

        # -- how-to-read.md, generated from the enum source (§7.8, §10) -------
        guide = page.get(HOW_TO_READ, "")

        def guide_is_generated_from_the_contract() -> str | None:
            if not guide:
                return f"{HOW_TO_READ} is absent or empty"
            try:
                contract = json.loads(VOCABULARY_CONTRACT.read_text())
            except (OSError, json.JSONDecodeError) as exc:
                return f"the vocabulary contract could not be read — {scrub(exc)[:120]}"
            enums = contract.get("enums") or {}
            if not enums:
                return "the vocabulary contract declares no enums"
            for name, definition in sorted(enums.items()):
                if name not in guide:
                    return (
                        f"the reader's guide carries no table for the {name!r} vocabulary;"
                        " §7.8 generates one per enum"
                    )
                for entry in definition.get("values") or []:
                    for field in ("value", "label", "meaning", "cannot_justify"):
                        text = str(entry.get(field) or "")
                        if not text:
                            return (
                                f"{name}.{entry.get('value')!r} declares no {field} in the"
                                " contract"
                            )
                        if text not in guide and text.replace("|", "/") not in guide:
                            return (
                                f"{name}.{entry.get('value')!r} reaches the page without its"
                                f" {field}; §7.8 carries value, label, operational meaning,"
                                " and what it cannot justify"
                            )
            return None

        check("how-to-read.md is generated from conspectus-vocabulary.json", guide_is_generated_from_the_contract)

        def guide_routes_every_published_page() -> str | None:
            if not guide:
                return f"{HOW_TO_READ} is absent or empty"
            body = section(guide, "What to look at first")
            if not body.strip():
                return "the reader's guide carries no 'What to look at first' section"
            published = sorted(
                str(path.relative_to(docs)) for path in docs.rglob("*.md") if path.is_file()
            )
            for rel in published:
                if f"]({rel})" not in body:
                    return (
                        f"{rel} is published and is not routed from the reader's guide;"
                        " §7.8 generates that table from the page plan"
                    )
            return None

        check("the reader's guide routes every page the plan publishes", guide_routes_every_published_page)

        # -- the access column, once an access row reaches a subsystem (VP4) --
        def access_column_appears() -> str | None:
            if seed_error:
                return seed_error
            try:
                record_access(storage)
            except Exception as exc:
                return f"an access row could not be recorded — {scrub(exc)[:160]}"
            again = publish(storage, "--clean-publish")
            if not again.get("ok"):
                return (
                    "the republish after recording an access was not green;"
                    f" {scrub(again.get('_diagnostic'))[:200]}"
                )
            body = read(docs / HOT_SPOTS) or ""
            if not body:
                return f"{HOT_SPOTS} is absent after the republish"
            found = None
            for headers, data in tables(body):
                if headers and plain(headers[0]) == HOT_SPOT_COLUMNS[0]:
                    found = (headers, data)
                    break
            if found is None:
                return f"{HOT_SPOTS} carries no table headed {HOT_SPOT_COLUMNS[0]!r}"
            headers = [plain(cell) for cell in found[0]]
            if tuple(headers) != (*HOT_SPOT_COLUMNS, ACCESS_COLUMN):
                return (
                    f"one access_log row reaches {ACCESS_HEAT_SUBSYSTEM} and the columns"
                    f" are still {tuple(headers)!r}; §7.6 omits the {ACCESS_COLUMN!r}"
                    " column only while no subsystem has one"
                )
            for row in found[1]:
                cells = [plain(cell) for cell in row]
                if ACCESS_HEAT_SUBSYSTEM in cells[0]:
                    if cells[-1] != "1":
                        return (
                            f"{ACCESS_HEAT_SUBSYSTEM} records one access and the column"
                            f" reads {cells[-1]!r}"
                        )
                    return None
            return f"{ACCESS_HEAT_SUBSYSTEM} has no row after the republish"

        check("the access column appears once an access row reaches a subsystem (VP4)", access_column_appears)

        # -- the honest empty state (§6.1) ------------------------------------
        empty_storage = root / "empty"
        empty_storage.mkdir(parents=True)
        (empty_storage / "project.json").write_text(json.dumps({"name": "EmptyFixture"}))
        empty_error: str | None = None
        try:
            seed_empty(empty_storage)
        except Exception as exc:
            empty_error = f"the empty fixture could not be seeded — {scrub(exc)[:200]}"
        empty_summary = publish(empty_storage, "--clean-publish") if empty_error is None else {}
        empty_docs = empty_storage / "docs"

        def empty_lens_pages_state_their_scope() -> str | None:
            if empty_error:
                return empty_error
            if not empty_summary.get("ok"):
                return (
                    "the empty-store publish was not green;"
                    f" {scrub(empty_summary.get('_diagnostic'))[:200]}"
                )
            for rel in EMPTY_LENS_PAGES:
                body = read(empty_docs / rel)
                if body is None:
                    return f"{rel} is not published for an empty store"
                for label in EMPTY_LABELS:
                    if label not in body:
                        return (
                            f"the empty {rel} does not state its {label.lower()};"
                            " §6.1 refuses a bare 'none'"
                        )
                if SHA_A[:8] not in body:
                    return (
                        f"the empty {rel} does not name the checked revision it looked at"
                    )
            return None

        check("every empty lens page states scope, basis and checked revision", empty_lens_pages_state_their_scope)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    # -- CI -----------------------------------------------------------------
    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if text is None:
            return "the CI workflow .github/workflows/test.yml is not readable"
        if "test-history-and-disagreements.py" not in text:
            return "the workflow does not run test-history-and-disagreements.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(
            "GATE P9 RED: the Unresolved and History pages do not hold —"
            " disagreements, hot-spots, resolution-history, resolved-leads, sessions,"
            " the resolution basis, and the generated reader's guide —"
            f" {len(FAILURES)} assertion(s) failed; first: {FAILURES[0]}"
        )
        return 1
    emit("GATE P9 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
