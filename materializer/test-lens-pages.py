#!/usr/bin/env python3
"""Gate for reader-lenses packet P8 — the page plan, navigation groups, the
Files index, and Not yet surveyed (spec.md §7.1, §7.3, §7.4, §7.5; claims C30,
C31, C33, C34, C35, C55, C63).

Turns red when:

  - `NAV_GROUPS` is absent, or is not the five reader lenses in order, or the
    rendered navigation emits groups in a different order, or emits a group the
    constant does not name;
  - a planned page carries a group outside `NAV_GROUPS` and the projection
    publishes anyway — a sixth group silently appended is the failure §7.1
    forbids;
  - subsystem pages do not render under the Subsystems subgroup of Codebase, or
    a subgroup is not introduced by an `<h3>`, or a subgrouped item precedes an
    ungrouped one inside its group;
  - any page path the plan produced before this change is no longer produced;
  - `files.md` is absent, carries more or fewer than one row per distinct
    ledger path, drops an owner of a multi-owner path, prints one revision for
    owners that record different ones, presents one owner's standing as the
    file's standing when owners disagree, counts a resolved finding as an open
    defect, or anchors rows with `slugify` — three seeded paths that collide
    under `slugify` must reach three distinct `f-<sha1>` anchors, each present
    in the finished HTML with no script having run;
  - `not-yet-surveyed.md` is absent or does not carry its five sections, each
    with the denominator of the unit its gap occupies; in particular when the
    unassessed-seam section counts seams rather than `(seam, side)` pairs, or
    the concern section counts concern codes rather than `(subsystem, concern)`
    pairs. The fixture is built so both global predicates report **zero** while
    the pair predicates report 5 of 6 and 15 of 20 (VP4);
  - an unassessed-seam entry drops §2.4.6's `per-party-proxy` sentence;
  - a subsystem page renders Scope without saying that no purpose statement
    is recorded, leaving a file-and-boundary list to read as a purpose;
  - a subsystem page does not open with identity and Scope, labels the scope
    Purpose, renders its sections out of §7.3's order, does not end with the
    survey record, or re-records a finding instead of linking to it (§6.2);
  - the gate does not run in CI.

False green it cannot exclude: every count is read from one store this gate
seeded, so agreement proves the renderer reads the store it was given, never
that `detect_changes` or `set_disposition` wrote the right rows. Nothing here
examines the repository the ledger describes, and the HTML checks read bytes —
they do not drive a browser, so keyboard reachability is asserted only as
"present without script", which is P10's axis to measure properly.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed, so a missing
deliverable reports as an assertion failure rather than as a crash.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Callable
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"

# ---------------------------------------------------------------------------
# Output funnel. Nothing reaches stdout except through emit(), and everything
# is scrubbed of the launcher's crash signatures so a genuine assertion failure
# is never mistaken for a gate that never ran.
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
# expects (§7.1, §7.3, §7.4, §7.5).
# ---------------------------------------------------------------------------
PROJECT_NAME = "LensFixture"

EXPECTED_NAV_GROUPS: tuple[str, ...] = (
    "Overview",
    "Codebase",
    "Unresolved",
    "History",
    "Method",
)
SUBSYSTEM_SUBGROUP = "Subsystems"
MATRIX_SUBGROUP = "Evidence matrices"
MATRIX_ID = 7
MATRIX_SYMPTOM = "rows appear twice after a restart"

FILES_PAGE = "files.md"
GAPS_PAGE = "not-yet-surveyed.md"

# The group each page belongs to, from §7.1's table. Only the pages this packet
# is responsible for planning are listed; P9's pages are checked by P9's gate.
EXPECTED_GROUP_OF: dict[str, str] = {
    "Overview": "Overview",
    "Architecture": "Codebase",
    "Subsystems": "Codebase",
    "Files": "Codebase",
    "Not yet surveyed": "Codebase",
    "System boundaries": "Codebase",
    "Codebase glossary": "Codebase",
    "Open findings": "Unresolved",
    "Decisions needed": "Unresolved",
    "Leads": "Unresolved",
    "Stale knowledge": "Unresolved",
    "Resolved findings": "History",
    "Conflicting evidence": "History",
    "Reader's guide": "Method",
    "Review coverage": "Method",
    "Review checklist": "Method",
    "Competing explanations": "Method",
    "Onboarding record": "Method",
    "Where to begin": "Method",
}

# Every page path the plan produced before this change. §7.1: "No page is
# retired." A path that stops being produced is a broken authored link and a
# red coverage axis, so the whole set is asserted by name.
LEGACY_PAGE_PATHS: tuple[str, ...] = (
    "index.md",
    "architecture.md",
    "master-plan.md",
    "findings.md",
    "resolved-findings.md",
    "concerns.md",
    "seams.md",
    "contradictions.md",
    "diagnosticity.md",
    "open-questions.md",
    "field-notes.md",
    "stale.md",
    "vocabulary.md",
    "how-to-read.md",
    "onboarding-report.md",
    "entry-point.md",
    "concern-checklist.md",
)

# §7.3's order. Identity is the page title and the layer line; the H2 sequence
# begins at Scope and ends at the survey record.
SUBSYSTEM_SECTION_ORDER: tuple[str, ...] = (
    "Scope",
    "Start here",
    "Structure",
    "Boundaries",
    "Vocabulary",
    "Known defects here",
    "Standing",
    "Survey record",
)
SUBSYSTEM_REQUIRED_SECTIONS: tuple[str, ...] = (
    "Scope",
    "Structure",
    "Known defects here",
    "Standing",
    "Survey record",
)

# §7.5's five sections, in order.
GAPS_SECTIONS: tuple[str, ...] = (
    "Paths with no ledger row",
    "Files in scope that no one has read",
    "Subsystems set aside",
    "Seam sides no one has assessed",
    "Concerns no one has dispositioned here",
)
PER_PARTY_PROXY = "per-party-proxy"

# §1.2's label for a path whose owners record different standing states.
MIXED_LABEL = "Owners disagree"

SHA_A = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"
SHA_B = "bbbbbbbbbbbb2222bbbbbbbbbbbb2222bbbbbbbb"

# ---------------------------------------------------------------------------
# The seeded store. Every derived count is distinct, so no wrong predicate can
# coincide with the right answer.
# ---------------------------------------------------------------------------
SUBSYSTEMS: tuple[tuple[str, str, str, str, str | None, str | None, str | None], ...] = (
    (
        "B-01",
        "Read path",
        "mapped",
        "backend",
        "src/reader.ts and the two files it re-exports",
        "Open src/reader.ts first; it names every other file in this region.",
        None,
    ),
    ("B-02", "Write path", "mapped", "backend", "src/writer.ts, src/shared.ts", None, None),
    # No scope recorded: §7.3 requires the page to say so rather than invent one.
    ("B-03", "Queue", "scoping", "backend", None, None, None),
    (
        "F-01",
        "Console",
        "deferred",
        "frontend",
        "ui/console.ts",
        None,
        "Set aside: the console is vendored from upstream and is not read here.",
    ),
    ("F-02", "Widgets", "deferred", "frontend", None, None, None),
)
SUBSYSTEM_COUNT = len(SUBSYSTEMS)
DEFERRED_SUBSYSTEMS = tuple(s[0] for s in SUBSYSTEMS if s[2] == "deferred")

# Three paths that collide under `slugify` (every non-alphanumeric run becomes
# one dash), so a slug anchor would give all three the same id.
COLLIDING_PATHS: tuple[str, str, str] = ("src/a/b.ts", "src/a-b.ts", "src/a.b.ts")
MULTI_OWNER_DISAGREEING = "src/shared.ts"
MULTI_OWNER_AGREEING = "src/agreed.ts"
MIXED_STANDING_PATH = "src/mixed.ts"
ABSENT_PATH = "src/gone.ts"

# (subsystem, path, classification, stale, ref_sha, stale_reason)
LEDGER: tuple[tuple[str, str, str, int, str, str | None], ...] = (
    ("B-01", "src/a/b.ts", "examined", 0, SHA_A, None),
    ("B-01", "src/a-b.ts", "examined", 0, SHA_A, None),
    ("B-01", "src/a.b.ts", "candidate", 0, SHA_A, None),
    ("B-01", MULTI_OWNER_DISAGREEING, "examined", 0, SHA_A, None),
    ("B-02", MULTI_OWNER_DISAGREEING, "examined", 0, SHA_B, None),
    ("B-01", MULTI_OWNER_AGREEING, "examined", 0, SHA_A, None),
    ("B-02", MULTI_OWNER_AGREEING, "examined", 0, SHA_A, None),
    ("B-01", MIXED_STANDING_PATH, "examined", 0, SHA_A, None),
    ("B-02", MIXED_STANDING_PATH, "candidate", 0, SHA_A, None),
    ("B-03", "src/queue.ts", "candidate", 0, SHA_A, None),
    ("B-03", "src/pending.ts", "candidate", 0, SHA_A, None),
    ("F-01", "ui/console.ts", "deferred-with-reason", 0, SHA_A, None),
    ("B-01", "dist/bundle.js", "generated-ignore", 0, SHA_A, None),
    ("B-01", "vendor/lib.js", "vendor-ignore", 0, SHA_A, None),
    ("B-02", ABSENT_PATH, "examined", 1, SHA_A, "absent"),
)
LEDGER_PATHS = tuple(dict.fromkeys(path for _s, path, _c, _st, _r, _rr in LEDGER))
DISTINCT_PATHS = len(LEDGER_PATHS)                                   # 12
EXEMPT = ("generated-ignore", "vendor-ignore", "irrelevant")
OBLIGATION_ROWS = sum(1 for r in LEDGER if r[2] not in EXEMPT)       # 13
CANDIDATE_ROWS = sum(1 for r in LEDGER if r[2] == "candidate")       # 4
CANDIDATES_BY_SUBSYSTEM: dict[str, int] = {}
for _row in LEDGER:
    if _row[2] == "candidate":
        CANDIDATES_BY_SUBSYSTEM[_row[0]] = CANDIDATES_BY_SUBSYSTEM.get(_row[0], 0) + 1

UNLEDGERED_PATHS: tuple[str, ...] = (
    "README.md",
    "docs/guide.md",
    "src/new.ts",
    "tools/build.sh",
)
# The tree `detect_changes` reconciled the ledger against: the unledgered paths
# plus the ledger paths the tree still carries. §3.4 reads this from the
# `scope_reconciliations` row `seed` writes below, never from `scope_gaps` —
# an empty `scope_gaps` is indistinguishable from a reconciliation that found
# nothing, and the universe is no longer reconstructed from the ledger the
# section is about to measure (finding B03-5, packet P6).
TRACKED_AT_R: tuple[str, ...] = tuple(
    sorted(set(UNLEDGERED_PATHS) | (set(LEDGER_PATHS) - {ABSENT_PATH}))
)
TRACKED_PATHS = len(TRACKED_AT_R)                                    # 15
EXEMPT_TRACKED = len(
    {path for _s, path, c, *_rest in LEDGER if c in EXEMPT} - {ABSENT_PATH}
)


def _set_digest(parts: list[str]) -> str:
    """A path set as one hash, the construction `schema.sql` documents (§3.2)."""

    return hashlib.sha256("\x00".join(sorted(parts)).encode()).hexdigest()

# Four active concerns and one retired one. Every *active* code carries a
# disposition somewhere, so the global "concern dispositioned nowhere"
# predicate reports zero while 15 of 20 pairs are undispositioned (§7.5, C35).
CONCERNS: tuple[tuple[str, str, str], ...] = (
    ("SC-1", "composition", "active"),
    ("CC-1", "concurrency", "active"),
    ("CC-2", "data-integrity", "active"),
    ("CC-3", "error-handling", "active"),
    ("CC-9", "legacy", "retired"),
)
ACTIVE_CONCERNS = tuple(c[0] for c in CONCERNS if c[2] == "active")
DISPOSITIONS: tuple[tuple[str, str, str], ...] = (
    ("B-01", "SC-1", "confirmed-acceptable"),
    ("B-03", "SC-1", "confirmed-acceptable"),
    ("B-01", "CC-1", "confirmed-bug"),
    ("B-02", "CC-2", "ruled-out"),
    ("F-01", "CC-3", "out-of-scope"),
)
# CC-9 is retired and deliberately carries no disposition: a subsystem page that
# named it would linkify a code `concerns.md` does not anchor, and the point it
# proves — that a retired concern is outside the denominator — is carried by the
# 5 x 4 pair count, not by a disposition row.
CONCERN_PAIRS = SUBSYSTEM_COUNT * len(ACTIVE_CONCERNS)               # 20
DISPOSITIONED_PAIRS = sum(1 for d in DISPOSITIONS if d[1] in ACTIVE_CONCERNS)
UNDISPOSITIONED_PAIRS = CONCERN_PAIRS - DISPOSITIONED_PAIRS          # 15

# Three seams, six sides. SM-1 is assessable and only B-01 holds an `SC-%`
# disposition; SM-2 and SM-3 are not assessable at all. Every seam has `SC-%`
# on at least one side, so the global predicate reports zero (VP4).
SEAMS: tuple[tuple[str, str, str, str], ...] = (
    ("SM-1", "the row buffer", "B-01", "B-02"),
    ("SM-2", "the queue handle", "B-02", "B-03"),
    ("SM-3", "the console bridge", "B-01", "F-01"),
)
SEAM_SIDES = 2 * len(SEAMS)                                          # 6
UNASSESSED_SIDES = 5

FINDINGS: tuple[tuple[str, str, str, str, str, list[str]], ...] = (
    (
        "B01-1",
        "B-01",
        "CRITICAL",
        "confirmed-bug",
        "open",
        ["src/a/b.ts", "src/shared.ts:writeRow@aaaa1111"],
    ),
    ("B02-1", "B-02", "HIGH", "fixed", "fixed-pending-verification", ["src/shared.ts"]),
    ("B02-2", "B-02", "LOW", "confirmed-acceptable", "accepted", ["src/shared.ts"]),
)
OPEN_STATES = ("open", "fixed-pending-verification")
OPEN_DEFECTS_BY_PATH: dict[str, int] = {}
for _fid, _sid, _sev, _st, _state, _files in FINDINGS:
    if _state not in OPEN_STATES:
        continue
    for _cited in _files:
        _path = _cited.split(":", 1)[0]
        OPEN_DEFECTS_BY_PATH[_path] = OPEN_DEFECTS_BY_PATH.get(_path, 0) + 1

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

**Codebase**: {PROJECT_NAME} — P8 gate fixture

## Directory clusters

- src/ — the read and write paths
"""
CONCERN_CHECKLIST = """# Concern checklist

Seeded from the calibrated set.
"""


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------
def seed(storage: Path) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        f" VALUES ('default', 'main', '{SHA_A}', '{SHA_A}', '2026-09-11T12:00:00Z')"
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('p8', 'fixture')")
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        list(SUBSYSTEMS),
    )
    cur.executemany(
        "INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification,"
        " ref_sha, stale, stale_since, stale_reason)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                subsystem,
                path,
                f"In scope for {subsystem}.",
                classification,
                ref_sha,
                stale,
                "2026-09-11T12:00:00Z" if stale else None,
                stale_reason,
            )
            for subsystem, path, classification, stale, ref_sha, stale_reason in LEDGER
        ],
    )
    cur.executemany(
        "INSERT INTO scope_gaps (file_path, kind, subsystem_id, detected_sha)"
        f" VALUES (?, 'unledgered', NULL, '{SHA_A}')",
        [(path,) for path in UNLEDGERED_PATHS],
    )
    cur.execute(
        "INSERT INTO scope_gaps (file_path, kind, subsystem_id, detected_sha)"
        f" VALUES ('{ABSENT_PATH}', 'absent', 'B-02', '{SHA_A}')"
    )
    # The reading `not-yet-surveyed.md` §1 counts over (§3.2, §3.4). Its two
    # digests are what make it *stand*: the ledger digest is re-derived on every
    # render, so a later classification change would invalidate this row rather
    # than leave it quietly describing a ledger that has moved.
    cur.execute(
        "INSERT INTO scope_reconciliations (detected_sha, tree_digest, ledger_digest,"
        " tracked_paths, ledger_rows, unledgered, absent, exempt, session_id)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'p8')",
        (
            SHA_A,
            _set_digest(list(TRACKED_AT_R)),
            _set_digest([f"{path}\x00{c}" for _s, path, c, *_rest in LEDGER]),
            TRACKED_PATHS,
            DISTINCT_PATHS,
            len(UNLEDGERED_PATHS),
            1,
            EXEMPT_TRACKED,
        ),
    )
    cur.executemany(
        "INSERT INTO concerns (code, category, origin, status) VALUES (?, ?, 'seeded', ?)",
        list(CONCERNS),
    )
    cur.executemany(
        "INSERT INTO dispositions (subsystem_id, concern_code, classification,"
        " evidence_quality, rationale, ref_sha, session_id, pass_type)"
        f" VALUES (?, ?, ?, 'code-verified', 'fixture', '{SHA_A}', 'p8', 'survey')",
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
        f" VALUES (?, ?, ?, ?, ?, ?, ?, '{SHA_A}', 'p8', 'survey')",
        [
            (
                fid,
                sid,
                f"{fid} drops a row under load",
                "the buffer is reused before the reader is done with it",
                severity,
                status,
                json.dumps(files),
            )
            for fid, sid, severity, status, _state, files in FINDINGS
        ],
    )
    for fid, _sid, _sev, _status, state, _files in FINDINGS:
        if state in ("fixed-pending-verification", "verified-fixed"):
            cur.execute(
                "INSERT INTO finding_resolution_events (finding_id, resolution_state,"
                " fix_location, fix_sha, rationale, session_id)"
                f" VALUES (?, ?, 'src/writer.ts', '{SHA_B}', 'fixture', 'p8')",
                (fid, state),
            )
        else:
            cur.execute(
                "INSERT INTO finding_resolution_events (finding_id, resolution_state,"
                " rationale, session_id) VALUES (?, ?, 'fixture', 'p8')",
                (fid, state),
            )
    cur.executemany(
        "INSERT INTO vocabulary (term, gloss, subsystem_id, first_seen, ref_sha)"
        f" VALUES (?, ?, 'B-01', 'src/reader.ts', '{SHA_A}')",
        [("row buffer", "the shared page the writer fills and the reader drains")],
    )
    cur.execute(
        "INSERT INTO xrefs (from_id, to_id, relationship, strength, context)"
        " VALUES ('B-01', 'B-02', 'depends-on', 'confirmed', 'the reader drains the buffer')"
    )
    cur.execute(
        "INSERT INTO diagnosticity_sessions (id, subsystem_id, symptom, outcome, session_id)"
        f" VALUES ({MATRIX_ID}, 'B-01', ?, 'open', 'p8')",
        (MATRIX_SYMPTOM,),
    )
    db.commit()
    db.close()
    (storage / "entry-point.md").write_text(ENTRY_POINT)
    (storage / "onboarding-report.md").write_text(ONBOARDING_REPORT)
    (storage / "concern-checklist.md").write_text(CONCERN_CHECKLIST)


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


def table_rows(body: str) -> list[list[str]]:
    """The data rows of the first Markdown table in `body`."""

    out: list[list[str]] = []
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if all(set(cell) <= {"-", ":", " "} and cell for cell in cells):
            continue
        out.append(cells)
    return out


def file_anchor(path: str) -> str:
    """§7.4's collision-resistant anchor, computed independently here."""

    return "f-" + hashlib.sha1(path.encode("utf-8")).hexdigest()[:10]  # noqa: S324


# ---------------------------------------------------------------------------
# Navigation reader. Walks the finished HTML in document order and reports the
# group headings, subgroup headings, and item labels the reader meets.
# ---------------------------------------------------------------------------
class _Nav(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.events: list[tuple[str, str]] = []
        self.ids: set[str] = set()
        self._capture: str | None = None
        self._depth = 0
        self._text: list[str] = []
        self._in_rail = False
        self._rail_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {k: (v or "") for k, v in attrs}
        if values.get("id"):
            self.ids.add(values["id"])
        if tag == "aside" and "nav-rail" in values.get("class", ""):
            self._in_rail = True
            self._rail_depth = 0
        if not self._in_rail:
            return
        if tag == "aside":
            self._rail_depth += 1
        if self._capture is not None:
            self._depth += 1
            return
        if tag in ("h2", "h3"):
            self._capture = tag
            self._depth = 0
            self._text = []
        elif tag == "span" and "nav-name" in values.get("class", ""):
            self._capture = "item"
            self._depth = 0
            self._text = []

    def handle_endtag(self, tag: str) -> None:
        if not self._in_rail:
            return
        if self._capture is not None:
            if self._depth:
                self._depth -= 1
                return
            self.events.append((self._capture, "".join(self._text).strip()))
            self._capture = None
            return
        if tag == "aside":
            self._rail_depth -= 1
            if self._rail_depth <= 0:
                self._in_rail = False

    def handle_data(self, data: str) -> None:
        if self._in_rail and self._capture is not None:
            self._text.append(data)


def nav_of(html_text: str) -> list[tuple[str, str]]:
    parser = _Nav()
    parser.feed(html_text)
    return parser.events


def html_ids(html_text: str) -> set[str]:
    parser = _Nav()
    parser.feed(html_text)
    return parser.ids


def nav_groups(events: list[tuple[str, str]]) -> list[str]:
    return [text for kind, text in events if kind == "h2"]


def group_contents(events: list[tuple[str, str]], group: str) -> list[tuple[str, str]]:
    """The (kind, text) events inside one group, up to the next group."""

    out: list[tuple[str, str]] = []
    inside = False
    for kind, text in events:
        if kind == "h2":
            if inside:
                break
            inside = text == group
            continue
        if inside:
            out.append((kind, text))
    return out


# ---------------------------------------------------------------------------
def main() -> int:
    emit("GATE P8 — the page plan, navigation groups, Files, and Not yet surveyed")
    emit("")

    sys.path.insert(0, str(ROOT))
    modules: dict[str, Any] = {}
    import_errors: dict[str, str] = {}
    for name in ("html_projection", "core", "renderers", "slugs"):
        try:
            modules[name] = importlib.import_module(f"amanuensis_materializer.{name}")
        except Exception as exc:
            import_errors[name] = scrub(f"{exc!r}")

    html_projection = modules.get("html_projection")
    core = modules.get("core")
    slugs = modules.get("slugs")

    # -- the constant and the two dataclasses -------------------------------
    def nav_groups_constant() -> str | None:
        if html_projection is None:
            return (
                "amanuensis_materializer/html_projection.py could not be read"
                f" — {import_errors.get('html_projection', 'reason not recorded')}"
            )
        groups = getattr(html_projection, "NAV_GROUPS", None)
        if groups is None:
            return (
                "html_projection.py defines no NAV_GROUPS constant; §7.1 makes the"
                " navigation group order explicit rather than dict insertion order"
            )
        if tuple(groups) != EXPECTED_NAV_GROUPS:
            return f"NAV_GROUPS is {tuple(groups)!r}, not {EXPECTED_NAV_GROUPS!r}"
        return None

    check("NAV_GROUPS names the five lenses in reading order", nav_groups_constant)

    def carries_subgroup() -> str | None:
        missing: list[str] = []
        if html_projection is not None:
            page_cls = getattr(html_projection, "SitePage", None)
            fields = getattr(page_cls, "__dataclass_fields__", {})
            if "subgroup" not in fields:
                missing.append("html_projection.SitePage")
        else:
            missing.append("html_projection.SitePage")
        if core is not None:
            plan_cls = getattr(core, "PagePlan", None)
            fields = getattr(plan_cls, "__dataclass_fields__", {})
            if "subgroup" not in fields:
                missing.append("core.PagePlan")
        else:
            missing.append("core.PagePlan")
        if missing:
            return f"{', '.join(missing)} carries no subgroup field (§7.1)"
        return None

    check("PagePlan and SitePage carry a subgroup field", carries_subgroup)

    def slugs_collide() -> str | None:
        """The premise of §7.4's anchor rule, asserted rather than assumed."""

        if slugs is None:
            return f"slugs.py could not be read — {import_errors.get('slugs', 'no reason')}"
        slugify = getattr(slugs, "slugify", None)
        if slugify is None:
            return "slugs.py exposes no slugify"
        produced = {slugify(path) for path in COLLIDING_PATHS}
        if len(produced) != 1:
            return (
                "the three seeded paths no longer collide under slugify"
                f" ({sorted(produced)}); the fixture must be rebuilt so §7.4's anchor"
                " rule is still under test"
            )
        return None

    check("the three seeded paths do collide under slugify", slugs_collide)

    root = Path(tempfile.mkdtemp(prefix="amanuensis-p8-"))
    try:
        storage = root / "store"
        storage.mkdir(parents=True, exist_ok=True)
        seed_error: str | None = None
        try:
            seed(storage)
        except Exception as exc:
            seed_error = f"the fixture could not be seeded — {scrub(exc)}"
        summary = publish(storage, "--clean-publish") if seed_error is None else {}
        docs = storage / "docs"

        def published() -> str | None:
            if seed_error:
                return seed_error
            if not summary.get("ok"):
                warnings = [scrub(w)[:160] for w in summary.get("warnings") or []]
                readback = summary.get("readback") or {}
                return (
                    "the publish was not green;"
                    f" warnings {warnings[:2]},"
                    f" readback {scrub(readback.get('mismatches'))[:200]},"
                    f" diagnostic {scrub(summary.get('_diagnostic'))[:200]}"
                )
            return None

        check("the fixture publishes green on every read-back axis", published)

        index_html = read(docs / "index.html") or ""
        nav = nav_of(index_html)

        # -- navigation ------------------------------------------------------
        def nav_order() -> str | None:
            if not index_html:
                return "the projection produced no index.html to read navigation from"
            groups = nav_groups(nav)
            if not groups:
                return "the navigation rail emits no group headings"
            if tuple(groups) != EXPECTED_NAV_GROUPS:
                return (
                    f"navigation renders groups {tuple(groups)!r}, not NAV_GROUPS order"
                    f" {EXPECTED_NAV_GROUPS!r}"
                )
            return None

        check("navigation renders the five groups in NAV_GROUPS order", nav_order)

        def order_survives_a_reordered_plan() -> str | None:
            """The rail's order is NAV_GROUPS', not the order pages are planned.

            The plan is written in NAV_GROUPS order, so grouping by first
            appearance renders the same rail on any ordinary store. Reversing
            the plan separates the two: only a renderer reading the constant
            still emits Overview first.
            """

            if core is None:
                return f"core.py could not be read — {import_errors.get('core', 'no reason')}"
            materializer_cls = getattr(core, "Materializer", None)
            if materializer_cls is None:
                return "core.py exposes no Materializer"

            class ReversedPlan(materializer_cls):  # type: ignore[misc, valid-type]
                def _plan(self, conn):  # noqa: ANN001, ANN202
                    return list(reversed(super()._plan(conn)))

            out = root / "reversed-docs"
            reversed_summary = ReversedPlan(
                storage=storage, output=out, force_full=True, verify_readback=False
            ).materialize()
            if not reversed_summary.get("ok"):
                warnings = [scrub(w)[:160] for w in reversed_summary.get("warnings") or []]
                return f"the reordered plan did not render; warnings {warnings[:2]}"
            groups = nav_groups(nav_of(read(out / "index.html") or ""))
            if tuple(groups) != EXPECTED_NAV_GROUPS:
                return (
                    "reversing the page plan reordered the rail to"
                    f" {tuple(groups)!r}; the order must come from NAV_GROUPS,"
                    " not from the order pages are planned in"
                )
            return None

        check(
            "the rail's group order comes from NAV_GROUPS, not the plan's order",
            order_survives_a_reordered_plan,
        )

        def pages_sit_in_their_group() -> str | None:
            if not nav:
                return "the navigation rail could not be read"
            placed: dict[str, str] = {}
            current = ""
            for kind, text in nav:
                if kind == "h2":
                    current = text
                elif kind == "item":
                    placed[text] = current
            wrong = [
                f"{label!r} in {placed.get(label, 'no group')!r}, expected {group!r}"
                for label, group in EXPECTED_GROUP_OF.items()
                if placed.get(label) != group
            ]
            if wrong:
                return f"{len(wrong)} page(s) in the wrong group: {'; '.join(wrong[:3])}"
            return None

        check("every §7.1 page renders in the group the table gives it", pages_sit_in_their_group)

        def subsystems_are_a_subgroup() -> str | None:
            if not nav:
                return "the navigation rail could not be read"
            inside = group_contents(nav, "Codebase")
            if not inside:
                return "the Codebase group has no items"
            subgroups = [text for kind, text in inside if kind == "h3"]
            if SUBSYSTEM_SUBGROUP not in subgroups:
                return (
                    f"Codebase carries no {SUBSYSTEM_SUBGROUP!r} subgroup heading;"
                    f" its h3 headings are {subgroups!r}"
                )
            index_of_h3 = next(i for i, (k, t) in enumerate(inside) if k == "h3")
            ungrouped = [t for k, t in inside[:index_of_h3] if k == "item"]
            after = [t for k, t in inside[index_of_h3:] if k == "item"]
            if "Files" not in ungrouped:
                return (
                    "an item with no subgroup does not precede the first subgroup"
                    f" heading; the items before it are {ungrouped!r}"
                )
            expected_names = {name for _id, name, *_rest in SUBSYSTEMS}
            if not expected_names.issubset(set(after)):
                return (
                    "not every subsystem page renders under the Subsystems subgroup;"
                    f" it holds {sorted(after)!r}"
                )
            if expected_names & set(ungrouped):
                return "a subsystem page renders outside the Subsystems subgroup"
            return None

        check(
            "subsystem pages render under the Subsystems subgroup of Codebase",
            subsystems_are_a_subgroup,
        )

        def matrices_are_a_subgroup() -> str | None:
            if not nav:
                return "the navigation rail could not be read"
            inside = group_contents(nav, "Method")
            if not inside:
                return "the Method group has no items"
            subgroups = [text for kind, text in inside if kind == "h3"]
            if MATRIX_SUBGROUP not in subgroups:
                return (
                    f"Method carries no {MATRIX_SUBGROUP!r} subgroup; its h3"
                    f" headings are {subgroups!r}"
                )
            index_of_h3 = next(i for i, (k, t) in enumerate(inside) if k == "h3")
            after = [t for k, t in inside[index_of_h3:] if k == "item"]
            if MATRIX_SYMPTOM not in after:
                return (
                    "the seeded evidence matrix does not render under it;"
                    f" the subgroup holds {after!r}"
                )
            if not (docs / "diagnosticity" / f"dm-{MATRIX_ID}.md").is_file():
                return "the per-matrix page path changed, retiring the old one"
            return None

        check(
            "evidence matrices render under the Evidence matrices subgroup of Method",
            matrices_are_a_subgroup,
        )

        def rogue_group_is_a_render_error() -> str | None:
            if core is None:
                return f"core.py could not be read — {import_errors.get('core', 'no reason')}"
            plan_cls = getattr(core, "PagePlan", None)
            materializer_cls = getattr(core, "Materializer", None)
            if plan_cls is None or materializer_cls is None:
                return "core.py exposes no PagePlan or Materializer"

            class RoguePlan(materializer_cls):  # type: ignore[misc, valid-type]
                def _plan(self, conn):  # noqa: ANN001, ANN202
                    plan = super()._plan(conn)
                    plan.append(
                        plan_cls(
                            "rogue.md",
                            lambda: ("# Rogue\n", {}),
                            title="Rogue page",
                            label="Rogue page",
                            hint="A page that belongs to no lens.",
                            group="Apparatus",
                            kind="reference",
                        )
                    )
                    return plan

            out = root / "rogue-docs"
            try:
                rogue = RoguePlan(
                    storage=storage, output=out, force_full=True, verify_readback=False
                ).materialize()
            except Exception as exc:
                # A raised render error is acceptable: it is not a silent append.
                return None if "Apparatus" in scrub(f"{exc}") else (
                    f"the rogue group raised something that does not name it — {scrub(exc)[:160]}"
                )
            if rogue.get("ok"):
                return (
                    "a page whose group is outside NAV_GROUPS published green;"
                    " §7.1 makes it a render error, not a silently appended group"
                )
            warnings = " ".join(scrub(w) for w in rogue.get("warnings") or [])
            if "Apparatus" not in warnings:
                return f"the refusal does not name the offending group — {warnings[:200]}"
            rogue_html = read(out / "rogue.html")
            if rogue_html is not None:
                return "the rogue page was still rendered to HTML"
            return None

        check(
            "a page outside NAV_GROUPS is a render error, not a sixth group",
            rogue_group_is_a_render_error,
        )

        def nothing_retired() -> str | None:
            absent = [
                path
                for path in LEGACY_PAGE_PATHS
                if not (docs / path).is_file()
                or not (docs / path).with_suffix(".html").is_file()
            ]
            if absent:
                return f"{len(absent)} previously planned page path(s) retired: {absent[:5]}"
            subsystem_pages = sorted((docs / "subsystems").glob("*.md"))
            if len(subsystem_pages) != SUBSYSTEM_COUNT:
                return (
                    f"{len(subsystem_pages)} subsystem page(s) produced for"
                    f" {SUBSYSTEM_COUNT} subsystems"
                )
            retired = summary.get("pages_retired") or []
            if retired:
                return f"the publish retired {retired!r}"
            return None

        check("no previously planned page path is retired", nothing_retired)

        # -- files.md --------------------------------------------------------
        files_md = read(docs / FILES_PAGE) or ""
        files_html = read(docs / "files.html") or ""
        rows_of_files = table_rows(files_md)
        body_rows = rows_of_files[1:] if rows_of_files else []

        def one_row_per_path() -> str | None:
            if not files_md:
                return f"{FILES_PAGE} is absent from the projection"
            if not body_rows:
                return f"{FILES_PAGE} carries no table rows"
            paths = [
                re.sub(r"[`*]", "", re.sub(r"<[^>]+>", "", cell)).strip()
                for cell, *_rest in body_rows
            ]
            found = {p for p in paths if p}
            expected = set(LEDGER_PATHS)
            if len(body_rows) != DISTINCT_PATHS:
                return (
                    f"{FILES_PAGE} carries {len(body_rows)} rows for {DISTINCT_PATHS}"
                    " distinct ledger paths (one row per path, not per ledger row)"
                )
            missing = sorted(p for p in expected if not any(p in cell for cell in paths))
            if missing:
                return f"{len(missing)} path(s) have no row: {missing[:3]}"
            del found
            ordered = [p for p in paths if p]
            if ordered != sorted(ordered):
                return "the rows are not sorted by path"
            return None

        check("files.md carries one row per distinct ledger path, sorted", one_row_per_path)

        def row_for(path: str) -> str:
            for row in body_rows:
                if path in row[0]:
                    return " | ".join(row)
            return ""

        def every_owner_listed() -> str | None:
            if not body_rows:
                return f"{FILES_PAGE} carries no rows to read owners from"
            row = row_for(MULTI_OWNER_DISAGREEING)
            if not row:
                return f"{MULTI_OWNER_DISAGREEING} has no row"
            for owner in ("Read path", "Write path"):
                if owner not in row:
                    return f"the row for {MULTI_OWNER_DISAGREEING} does not name {owner!r}"
            links = re.findall(r"\]\((subsystems/[^)]+)\)", row)
            if len(links) < 2:
                return (
                    "the row does not link each owner to its subsystem page"
                    f" — {len(links)} link(s) found"
                )
            if not all("#" in link for link in links):
                return "an owner link does not reach the subsystem page's ledger entry anchor"
            return None

        check("every owner of a multi-owner path is listed and linked", every_owner_listed)

        def revision_is_per_owner() -> str | None:
            disagreeing = row_for(MULTI_OWNER_DISAGREEING)
            agreeing = row_for(MULTI_OWNER_AGREEING)
            if not disagreeing or not agreeing:
                return "the multi-owner rows are absent"
            short_a, short_b = SHA_A[:8], SHA_B[:8]
            if short_a not in disagreeing or short_b not in disagreeing:
                return (
                    "owners that record different examination revisions do not each show"
                    f" their own; the row reads {disagreeing[:160]!r}"
                )
            if agreeing.count(short_a) != 1:
                return (
                    "owners that agree on the examination revision should show one value;"
                    f" the row shows it {agreeing.count(short_a)} time(s)"
                )
            return None

        check("the examined revision renders per owner, not per file", revision_is_per_owner)

        def mixed_standing_is_not_one_owner() -> str | None:
            row = row_for(MIXED_STANDING_PATH)
            if not row:
                return f"{MIXED_STANDING_PATH} has no row"
            if MIXED_LABEL not in row:
                return (
                    f"a path whose owners disagree does not read {MIXED_LABEL!r};"
                    f" the row reads {row[:160]!r}"
                )
            return None

        check(
            "a path whose owners disagree is not given one owner's standing",
            mixed_standing_is_not_one_owner,
        )

        def open_defect_count() -> str | None:
            for path, expected in OPEN_DEFECTS_BY_PATH.items():
                row = row_for(path)
                if not row:
                    return f"{path} has no row"
                if not re.search(rf"(?<![0-9]){expected}(?![0-9])", row.split("|")[-1]):
                    return (
                        f"the open-defect count for {path} does not read {expected};"
                        f" the row ends {row.split('|')[-1].strip()!r}"
                    )
            quiet = row_for("src/queue.ts")
            if quiet and re.search(r"[1-9]", quiet.split("|")[-1]):
                return "a path with no open defect is given a non-zero count"
            return None

        check("the open-defect count counts open and awaiting verification only", open_defect_count)

        def anchors_do_not_collide() -> str | None:
            if not files_md:
                return f"{FILES_PAGE} is absent"
            expected = {path: file_anchor(path) for path in COLLIDING_PATHS}
            if len(set(expected.values())) != 3:
                return "the three expected anchors are not distinct"
            missing = [
                path for path, anchor in expected.items() if f'id="{anchor}"' not in files_md
            ]
            if missing:
                present = re.findall(r'id="(f-[0-9a-f]+)"', files_md)
                return (
                    f"{len(missing)} colliding path(s) carry no f-<sha1> anchor"
                    f" ({missing}); the page carries {present[:4]}"
                )
            ids = html_ids(files_html)
            unreachable = [
                path for path, anchor in expected.items() if anchor not in ids
            ]
            if unreachable:
                return (
                    f"{len(unreachable)} anchor(s) are not element ids in files.html,"
                    " so they are unreachable with scripts disabled"
                )
            return None

        check(
            "three colliding path slugs produce three distinct reachable anchors",
            anchors_do_not_collide,
        )

        # -- not-yet-surveyed.md ---------------------------------------------
        gaps_md = read(docs / GAPS_PAGE) or ""
        gaps_sections = headings(gaps_md)

        def five_sections() -> str | None:
            if not gaps_md:
                return f"{GAPS_PAGE} is absent from the projection"
            if gaps_sections != list(GAPS_SECTIONS):
                return (
                    f"{GAPS_PAGE} carries sections {gaps_sections!r}, not §7.5's five"
                    f" {list(GAPS_SECTIONS)!r}"
                )
            return None

        check("not-yet-surveyed.md carries §7.5's five sections in order", five_sections)

        def denominator(name: str) -> str:
            return section(gaps_md, name)

        def counted_over_tracked_paths() -> str | None:
            body = denominator(GAPS_SECTIONS[0])
            if not body:
                return f"{GAPS_SECTIONS[0]!r} has no body"
            if f"{len(UNLEDGERED_PATHS)} of {TRACKED_PATHS}" not in body:
                return (
                    f"unledgered paths are not counted as {len(UNLEDGERED_PATHS)} of"
                    f" {TRACKED_PATHS} tracked paths; the section reads {body[:200]!r}"
                )
            for path in UNLEDGERED_PATHS[:2]:
                if path not in body:
                    return f"the section does not name the unledgered path {path}"
            return None

        check("unledgered paths are counted over tracked paths", counted_over_tracked_paths)

        def candidates_by_subsystem() -> str | None:
            body = denominator(GAPS_SECTIONS[1])
            if not body:
                return f"{GAPS_SECTIONS[1]!r} has no body"
            if f"{CANDIDATE_ROWS} of {OBLIGATION_ROWS}" not in body:
                return (
                    f"candidate rows are not counted as {CANDIDATE_ROWS} of"
                    f" {OBLIGATION_ROWS} obligation-bearing ledger rows;"
                    f" the section reads {body[:200]!r}"
                )
            for subsystem, count in CANDIDATES_BY_SUBSYSTEM.items():
                if not re.search(rf"{subsystem}\b[^\n]*?(?<![0-9]){count}(?![0-9])", body):
                    return f"{subsystem} is not reported with its {count} candidate row(s)"
            return None

        check(
            "candidate rows are grouped by subsystem over obligation-bearing rows",
            candidates_by_subsystem,
        )

        def deferred_subsystems() -> str | None:
            body = denominator(GAPS_SECTIONS[2])
            if not body:
                return f"{GAPS_SECTIONS[2]!r} has no body"
            if f"{len(DEFERRED_SUBSYSTEMS)} of {SUBSYSTEM_COUNT}" not in body:
                return (
                    f"deferred subsystems are not counted as {len(DEFERRED_SUBSYSTEMS)}"
                    f" of {SUBSYSTEM_COUNT} subsystems; the section reads {body[:200]!r}"
                )
            reason = next(s[6] for s in SUBSYSTEMS if s[0] == "F-01")
            if reason and reason not in body:
                return "the recorded reason for F-01 is not carried"
            if "F-02" not in body:
                return "a deferred subsystem with no recorded reason is dropped"
            return None

        check("deferred subsystems carry their recorded reason", deferred_subsystems)

        def seam_sides_are_pairs() -> str | None:
            body = denominator(GAPS_SECTIONS[3])
            if not body:
                return f"{GAPS_SECTIONS[3]!r} has no body"
            if f"{UNASSESSED_SIDES} of {SEAM_SIDES}" not in body:
                return (
                    f"unassessed seam sides are not counted as {UNASSESSED_SIDES} of"
                    f" {SEAM_SIDES} (seam, side) pairs — a section that counts seams"
                    " reports zero on this fixture, which is the VP4 failure C35"
                    f" names; the section reads {body[:200]!r}"
                )
            if PER_PARTY_PROXY not in body:
                return "the section drops §2.4.6's per-party-proxy sentence"
            for seam_id, _obj, party_a, party_b in SEAMS:
                if seam_id not in body:
                    return f"{seam_id} is not named in the section"
                del party_a, party_b
            return None

        check(
            "unassessed seam sides are counted as (seam, side) pairs over 2 × seams",
            seam_sides_are_pairs,
        )

        def concern_pairs() -> str | None:
            body = denominator(GAPS_SECTIONS[4])
            if not body:
                return f"{GAPS_SECTIONS[4]!r} has no body"
            if f"{UNDISPOSITIONED_PAIRS} of {CONCERN_PAIRS}" not in body:
                return (
                    f"undispositioned pairs are not counted as {UNDISPOSITIONED_PAIRS}"
                    f" of {CONCERN_PAIRS} (subsystem, active concern) pairs — every"
                    " active concern here is dispositioned somewhere, so a section"
                    " counting concern codes reports zero (VP4); the section reads"
                    f" {body[:200]!r}"
                )
            if "CC-9" in body:
                return "a retired concern is counted as an active one"
            return None

        check(
            "undispositioned pairs are counted over subsystems × active concerns",
            concern_pairs,
        )

        def global_predicates_are_zero() -> str | None:
            """The fixture's own premise: the rejected predicates report zero."""

            conn = sqlite3.connect(f"file:{storage / 'memory.db'}?mode=ro", uri=True)
            try:
                seeded = conn.execute(
                    "SELECT (SELECT COUNT(*) FROM concerns), (SELECT COUNT(*) FROM seams),"
                    " (SELECT COUNT(*) FROM dispositions), (SELECT COUNT(*) FROM file_ledger)"
                ).fetchone()
                if seeded != (len(CONCERNS), len(SEAMS), len(DISPOSITIONS), len(LEDGER)):
                    return (
                        "the fixture store is not the one this gate describes:"
                        f" {seeded} rows against"
                        f" {(len(CONCERNS), len(SEAMS), len(DISPOSITIONS), len(LEDGER))};"
                        " a zero-denominator premise proves nothing (VP4)"
                    )
                concerns_nowhere = conn.execute(
                    "SELECT COUNT(*) FROM concerns c WHERE c.status='active'"
                    " AND NOT EXISTS (SELECT 1 FROM dispositions d"
                    " WHERE d.concern_code = c.code)"
                ).fetchone()[0]
                seams_neither_side = conn.execute(
                    "SELECT COUNT(*) FROM seams s WHERE NOT EXISTS"
                    " (SELECT 1 FROM dispositions d WHERE d.concern_code LIKE 'SC-%'"
                    "  AND d.subsystem_id IN (s.party_a, s.party_b))"
                ).fetchone()[0]
            finally:
                conn.close()
            if concerns_nowhere or seams_neither_side:
                return (
                    "the fixture no longer isolates the pair predicates:"
                    f" {concerns_nowhere} concern(s) and {seams_neither_side} seam(s)"
                    " are caught by the global predicates too"
                )
            return None

        check(
            "the fixture's global predicates report zero, so only the pair unit can be red",
            global_predicates_are_zero,
        )

        # -- subsystem pages -------------------------------------------------
        subsystem_md = {
            sid: read(docs / "subsystems" / f"{sid.lower().replace('-', '')}-{slug}.md") or ""
            for sid, slug in (
                ("B-01", "read-path"),
                ("B-02", "write-path"),
                ("B-03", "queue"),
                ("F-01", "console"),
            )
        }

        def opens_with_scope() -> str | None:
            page = subsystem_md.get("B-01", "")
            if not page:
                return "the B-01 subsystem page could not be read"
            order = headings(page)
            if not order:
                return "the B-01 page carries no sections"
            if order[0] != "Scope":
                return f"the first section is {order[0]!r}, not 'Scope'"
            if "Purpose" in order:
                return "the page carries a Purpose heading; §3.1 forbids relabelling scope"
            scope = next(s[4] for s in SUBSYSTEMS if s[0] == "B-01")
            body = section(page, "Scope")
            if scope and scope not in body:
                return "the Scope section does not carry subsystems.scope verbatim"
            return None

        check("subsystem pages open with identity and Scope, verbatim", opens_with_scope)

        def scope_says_no_purpose_is_recorded() -> str | None:
            """§3.1 and §7.3: the page says no purpose statement is recorded.

            `subsystems` has no purpose column at all, so this holds for every
            subsystem, not only for one whose `scope` is empty. Rendering scope
            alone leaves a reader to read a file-and-boundary list as the
            statement of what the subsystem is *for*, which is the relabelling
            §3.1 forbids and BP6 names.
            """
            missing = []
            for sid, page in subsystem_md.items():
                if not page:
                    return f"the {sid} subsystem page could not be read"
                body = section(page, "Scope")
                if not re.search(r"no purpose statement is recorded", body, re.IGNORECASE):
                    missing.append(sid)
            if missing:
                shown = subsystem_md.get(missing[0], "")
                return (
                    f"{len(missing)} subsystem page(s) render Scope without saying that no"
                    f" purpose statement is recorded; {missing[0]}'s section reads"
                    f" {section(shown, 'Scope').strip()[:160]!r}"
                )
            return None

        check(
            "every Scope section says no purpose statement is recorded",
            scope_says_no_purpose_is_recorded,
        )

        def absent_scope_says_so() -> str | None:
            page = subsystem_md.get("B-03", "")
            if not page:
                return "the B-03 subsystem page could not be read"
            body = section(page, "Scope")
            if not body.strip():
                return "a subsystem with no recorded scope renders an empty Scope section"
            if not re.search(r"\bno\b", body, re.IGNORECASE):
                return (
                    "a subsystem with no recorded scope does not say so;"
                    f" the section reads {body.strip()[:160]!r}"
                )
            # B-03 owns two ledger rows, so a sentence that sends the reader to
            # the ledger is true and one that calls the ledger empty is not.
            if "ledger" not in body.lower():
                return (
                    "the section does not point at the only other record of what"
                    f" belongs to this subsystem; it reads {body.strip()[:160]!r}"
                )
            if re.search(r"no file is recorded", body, re.IGNORECASE):
                owned = sum(1 for r in LEDGER if r[0] == "B-03")
                return (
                    f"the section says no file is recorded while {owned} ledger row(s)"
                    " name this subsystem"
                )
            return None

        check("a subsystem with no recorded scope says so", absent_scope_says_so)

        def section_order() -> str | None:
            for sid, page in subsystem_md.items():
                if not page:
                    return f"the {sid} subsystem page could not be read"
                order = headings(page)
                missing = [h for h in SUBSYSTEM_REQUIRED_SECTIONS if h not in order]
                if missing:
                    return f"{sid} is missing section(s) {missing}"
                ranked = [SUBSYSTEM_SECTION_ORDER.index(h) for h in order if h in SUBSYSTEM_SECTION_ORDER]
                if ranked != sorted(ranked):
                    return f"{sid} renders its sections out of §7.3's order: {order!r}"
                unknown = [h for h in order if h not in SUBSYSTEM_SECTION_ORDER]
                if unknown:
                    return f"{sid} carries section(s) §7.3 does not place: {unknown}"
                if order[-1] != "Survey record":
                    return f"{sid} does not end with the survey record; it ends {order[-1]!r}"
            return None

        check("subsystem pages follow §7.3's order and end with the survey record", section_order)

        def survey_record_order() -> str | None:
            page = subsystem_md.get("B-01", "")
            body = section(page, "Survey record")
            if not body:
                return "the B-01 survey record is empty"
            order = headings(body, level=3)
            expected = ["File ledger", "Concern review"]
            if order[:2] != expected:
                return (
                    "the survey record does not open with the file ledger and the"
                    f" concern review; it reads {order!r}"
                )
            return None

        check("the survey record keeps the ledger and concern review subordinate", survey_record_order)

        def defects_link_not_record() -> str | None:
            page = subsystem_md.get("B-02", "")
            if not page:
                return "the B-02 subsystem page could not be read"
            body = section(page, "Known defects here")
            if not body:
                return "B-02 carries no 'Known defects here' section"
            if "findings.md#b02-1" not in body:
                return "the open defect is not linked to its record on findings.md"
            if "resolved-findings.md" not in body:
                return "the resolved count does not link to resolved-findings.md"
            if not re.search(r"(?<![0-9])1(?![0-9])", body):
                return f"the resolved count is not reported; the section reads {body[:200]!r}"
            if "root cause" in body.lower() or "Root cause" in body:
                return "the section re-records a finding instead of linking to it (§6.2)"
            return None

        check("known defects link to their record rather than re-recording it", defects_link_not_record)

        def markers_stay_unique() -> str | None:
            """§6.2: the subsystem page links, so it must emit no finding marker."""

            try:
                readback = importlib.import_module("amanuensis_materializer.readback")
            except Exception as exc:
                return f"readback.py could not be read — {scrub(exc)[:120]}"
            marker = getattr(readback, "finding_marker", None)
            if marker is None:
                return "readback.py exposes no finding_marker"
            for sid, page in subsystem_md.items():
                for fid, *_rest in FINDINGS:
                    if marker(fid) in page:
                        return f"{sid} emits the durable marker for {fid}"
            corpus = "\n".join(
                read(path) or "" for path in sorted(docs.rglob("*.md")) if path.is_file()
            )
            for fid, *_rest in FINDINGS:
                if corpus.count(marker(fid)) != 1:
                    return (
                        f"{fid} carries {corpus.count(marker(fid))} markers across the"
                        " Markdown corpus, not exactly one"
                    )
            return None

        check("each finding keeps exactly one durable marker", markers_stay_unique)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    # -- CI ------------------------------------------------------------------
    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if text is None:
            return "the CI workflow .github/workflows/test.yml is not readable"
        if "test-lens-pages.py" not in text:
            return "the workflow does not run test-lens-pages.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(
            "GATE P8 RED: the NAV_GROUPS page plan, the Files index, and"
            f" not-yet-surveyed.md do not hold — {len(FAILURES)} assertion(s) failed;"
            f" first: {FAILURES[0]}"
        )
        return 1
    emit("GATE P8 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
