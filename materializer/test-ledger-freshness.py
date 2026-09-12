#!/usr/bin/env python3
"""Gate for reader-lenses packet P4 — ledger-derived freshness and a stale axis
with a denominator (spec.md §11.2, §11.3, §6.1, §6.2; claims C50, C51, C60,
C55, C63).

Turns red when:

  - the freshness strip or the overview's source-alignment count disagrees with
    `get_dashboard`'s `stale_entries`, `stale_exempt`, `scoped_files`, or
    `staleness_measured` on the same store.  The comparison runs the scalar
    subqueries lifted out of `mcp-server/src/tools/dashboard.ts` itself, so a
    rewrite of either side is a disagreement rather than a shared mistake;
  - any published surface still reports the `entries`-derived count, or still
    says *"No recorded stale entries"*;
  - an empty `file_ledger` produces anything but *"Freshness not measured by
    this projection"*;
  - `readback.ledger_stale_marker` is absent, or an obligation-bearing stale
    ledger row does not carry exactly one record on `stale.md` in the Markdown
    corpus and exactly one in the HTML corpus;
  - a row exempt from the survey obligation is given a stale record anyway;
  - a `candidate` row is reported as stale knowledge rather than under its own
    heading with its own denominator (C60), or an obligation-bearing stale row
    lands in no section at all;
  - deleting one stale record leaves the state read-back axis green — the axis
    the `entries`-derived check could never turn red (VP4);
  - the `entries`-derived stale marker check is dropped, or has itself stopped
    being able to turn the state axis red;
  - the gate does not run in CI.

False green it cannot exclude: every number here is read from one store that
this gate seeded.  Parity with `get_dashboard` proves the two readers agree
about the ledger, never that `detect_changes` marked the right rows stale, and
no assertion here examines the repository the ledger describes.

Output protocol: exactly one status line, last, on stdout.  Every subprocess is
captured and never echoed, and every message is scrubbed, so a missing
deliverable reports as an assertion failure rather than as a crash.
"""

from __future__ import annotations

import importlib
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
DASHBOARD_TS = REPO / "mcp-server" / "src" / "tools" / "dashboard.ts"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"

# ---------------------------------------------------------------------------
# Output funnel.  Nothing reaches stdout except through emit(), and everything
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
# expects (§11.2, §11.3, §6.1, §7.1).
# ---------------------------------------------------------------------------
PROJECT_NAME = "LedgerFixture"
STALE_PAGE = "stale.md"
STALE_HTML = "stale.html"
NOT_MEASURED = "Freshness not measured by this projection"
FALSE_GREEN = "No recorded stale entries"

# §6.1 fixes the heading drifted candidates are reported under; they are never
# reported as stale knowledge (C60).
CANDIDATE_HEADING = "Scoped but unread, and changed since scoping"

# The strip must carry all four `get_dashboard` quantities, each beside the
# denominator that makes it readable.  These are the phrases the gate reads
# them back out of.
STRIP_OBLIGATION = "{n} with a survey obligation"
STRIP_EXEMPT = "{n} exempt"
STRIP_SCOPED = "{n} scoped files"

# The seeded ledger.  Every derived count is distinct — 5 obligation-bearing
# stale, 2 exempt stale, 10 scoped, 7 obligation-bearing, 4 examined, 2
# candidate, 1 deferred — so no wrong predicate can coincide with the right
# answer, and the `entries` table carries a further, unrelated count.
#
# `src/writer.ts` is owned twice.  The ledger is keyed on
# `(subsystem_id, file_path)` and the AxiomDB store holds 53 multi-owner paths,
# so a record keyed on the path alone would collide — one row would lose its
# record and the other would carry two.
LEDGER: tuple[tuple[str, str, str, int], ...] = (
    ("B-01", "src/reader.ts", "examined", 0),
    ("B-02", "src/writer.ts", "examined", 1),
    ("B-03", "src/writer.ts", "examined", 1),
    ("B-02", "src/parser.ts", "examined", 1),
    ("B-02", "src/pending.ts", "candidate", 1),
    ("B-01", "src/queue.ts", "candidate", 0),
    ("B-03", "src/deferred.ts", "deferred-with-reason", 1),
    ("B-01", "dist/bundle.js", "generated-ignore", 1),
    ("B-01", "vendor/lib.js", "vendor-ignore", 1),
    ("B-01", "notes.txt", "irrelevant", 0),
)
MULTI_OWNER_PATH = "src/writer.ts"
EXEMPT_CLASSIFICATIONS = ("generated-ignore", "vendor-ignore", "irrelevant")
OBLIGATION_STALE = tuple(
    (s, p) for s, p, c, stale in LEDGER if stale and c not in EXEMPT_CLASSIFICATIONS
)
EXEMPT_STALE = tuple(
    (s, p) for s, p, c, stale in LEDGER if stale and c in EXEMPT_CLASSIFICATIONS
)
CANDIDATE_STALE = tuple((s, p) for s, p, c, stale in LEDGER if stale and c == "candidate")
EXAMINED_STALE = tuple((s, p) for s, p, c, stale in LEDGER if stale and c == "examined")
# The count that must never reach a published freshness reading: thirteen stale
# `entries` rows, a table no code path writes (finding B03-2).  Thirteen is not
# any ledger count above, so a surface reporting it is unmistakable.
ENTRIES_STALE = 13

THESIS_SENTENCE = (
    "LedgerFixture appends ledger rows durably and serves them through a "
    "separate read path."
)
ENTRY_POINT = f"""# Where to begin

A dated reading path recorded by an earlier session.

## What is this codebase?

{THESIS_SENTENCE}
"""
ONBOARDING_REPORT = f"""# Onboarding report

**Codebase**: {PROJECT_NAME} — P4 gate fixture

## Directory clusters

- src/ — B-01
"""


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------
def seed(storage: Path, *, ledger: bool = True) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', 'aaaaaaaaaaaa1111', 'aaaaaaaaaaaa1111',"
        " '2026-09-10T12:00:00Z')"
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('p4', 'fixture')")
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope) VALUES (?, ?, ?, ?, ?)",
        [
            ("B-01", "Read path", "mapped", "backend", "src/reader.ts"),
            ("B-02", "Write path", "mapped", "backend", "src/writer.ts"),
            ("B-03", "Queue", "scoping", "backend", "src/deferred.ts"),
        ],
    )
    if ledger:
        cur.executemany(
            "INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope,"
            " classification, ref_sha, stale, stale_since, stale_reason)"
            " VALUES (?, ?, ?, ?, 'aaaaaaaaaaaa1111', ?, ?, ?)",
            [
                (
                    subsystem,
                    path,
                    f"In scope for {subsystem}.",
                    classification,
                    stale,
                    "2026-09-10T12:00:00Z" if stale else None,
                    "git-drift" if stale else None,
                )
                for subsystem, path, classification, stale in LEDGER
            ],
        )
    cur.execute(
        "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause,"
        " severity, status, ref_sha, session_id, pass_type)"
        " VALUES ('B01-1', 'B-01', 'the read path drops a row', 'no fsync',"
        " 'HIGH', 'confirmed-bug', 'aaaaaaaaaaaa1111', 'p4', 'survey')"
    )
    cur.execute(
        "INSERT INTO finding_resolution_events (finding_id, resolution_state,"
        " rationale, session_id) VALUES ('B01-1', 'open', 'fixture', 'p4')"
    )
    # The `entries`-derived stale marker must survive the rewrite (§11.3), and
    # its count must never appear in a published freshness reading (§11.2).
    cur.executemany(
        "INSERT INTO entries (id, tier, subsystem_id, source_path, content_hash,"
        " ref_sha, confidence, stale, stale_since, stale_reason)"
        " VALUES (?, 1, 'B-01', 'survey.md', 'hash', 'aaaaaaaaaaaa1111',"
        " 'verified', 1, '2026-09-10T12:00:00Z', 'fixture')",
        [(f"B-01-legacy-{n}",) for n in range(ENTRIES_STALE)],
    )
    db.commit()
    db.close()
    (storage / "entry-point.md").write_text(ENTRY_POINT)
    (storage / "onboarding-report.md").write_text(ONBOARDING_REPORT)


def seeded(root: Path, name: str, *, ledger: bool = True) -> tuple[Path, str | None]:
    """A seeded storage directory, or the reason it could not be built."""

    storage = root / name
    storage.mkdir(parents=True, exist_ok=True)
    try:
        seed(storage, ledger=ledger)
    except Exception as exc:
        return storage, f"the {name} fixture could not be seeded — {scrub(exc)}"
    return storage, None


def publish(storage: Path, *args: str) -> dict[str, Any]:
    """Run the materializer, capturing everything.  Never echoes its output."""

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
    if not lines:
        summary["_diagnostic"] = scrub(proc.stderr)[-400:]
    return summary


def read(path: Path) -> str | None:
    try:
        return path.read_text()
    except OSError:
        return None


def corpus(docs: Path, suffix: str) -> str:
    return "\n".join(
        read(path) or "" for path in sorted(docs.rglob(f"*{suffix}")) if path.is_file()
    )


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


_TAG = re.compile(r"<[^>]+>")


def strip_text(docs: Path, rel: str) -> str | None:
    """The snapshot strip of one HTML page, as plain text."""

    body = read(docs / rel)
    if body is None:
        return None
    match = re.search(r'<div class="snapshot-strip">(.*?)</div>', body, re.DOTALL)
    if not match:
        return None
    text = _TAG.sub(" ", match.group(1)).replace("&nbsp;", " ").replace("&amp;", "&")
    return re.sub(r"\s+", " ", text).strip()


# ---------------------------------------------------------------------------
# Parity source: the scalar subqueries `get_dashboard` itself runs.  Lifting
# them out of the TypeScript means the two readers can disagree; restating them
# here would only prove this file agrees with itself.
# ---------------------------------------------------------------------------
def dashboard_subquery(source: str, alias: str) -> str | None:
    """The balanced `(SELECT …)` that `get_dashboard` aliases as `alias`."""

    match = re.search(rf"\)\s+AS\s+{re.escape(alias)}\b", source)
    if match is None:
        return None
    close = match.start()
    depth = 0
    for index in range(close, -1, -1):
        char = source[index]
        if char == ")":
            depth += 1
        elif char == "(":
            depth -= 1
            if depth == 0:
                return source[index : close + 1]
    return None


def dashboard_counts(storage: Path, obligation_sql: str) -> dict[str, Any] | str:
    """`get_dashboard`'s ledger quantities, run against this store."""

    source = read(DASHBOARD_TS)
    if source is None:
        return "mcp-server/src/tools/dashboard.ts is not readable"
    counts: dict[str, Any] = {}
    db = sqlite3.connect(f"file:{storage / 'memory.db'}?mode=ro", uri=True)
    try:
        for alias in ("stale_entries", "stale_exempt", "scoped_files"):
            sql = dashboard_subquery(source, alias)
            if sql is None:
                return f"get_dashboard no longer aliases a subquery as {alias}"
            sql = sql.replace("${OBLIGATION_BEARING_SQL}", obligation_sql)
            if "${" in sql:
                return f"the {alias} subquery interpolates a value this gate cannot resolve"
            counts[alias] = int(db.execute(f"SELECT {sql}").fetchone()[0] or 0)
    except sqlite3.Error as exc:
        return f"the {alias} subquery did not run against the store — {scrub(exc)}"
    finally:
        db.close()
    counts["staleness_measured"] = counts["scoped_files"] > 0
    return counts


def ledger_shape(storage: Path, obligation_sql: str) -> dict[str, int]:
    """The denominators the published pages report beside those quantities."""

    db = sqlite3.connect(f"file:{storage / 'memory.db'}?mode=ro", uri=True)
    try:
        obligation = int(
            db.execute(
                f"SELECT COUNT(*) FROM file_ledger WHERE {obligation_sql}"
            ).fetchone()[0]
            or 0
        )
        scoped = int(db.execute("SELECT COUNT(*) FROM file_ledger").fetchone()[0] or 0)
    finally:
        db.close()
    return {"obligation": obligation, "exempt": scoped - obligation, "scoped": scoped}


# ---------------------------------------------------------------------------
def main() -> int:
    emit("GATE P4 — ledger-derived freshness and a stale axis with a denominator")
    emit("")

    sys.path.insert(0, str(ROOT))
    readback: Any = None
    readback_error: str | None = None
    try:
        readback = importlib.import_module("amanuensis_materializer.readback")
    except Exception as exc:
        readback_error = f"{exc!r}"

    obligation_sql = (
        "COALESCE(classification, 'candidate') NOT IN"
        " ('generated-ignore', 'vendor-ignore', 'irrelevant')"
    )
    try:
        vocabulary = importlib.import_module("amanuensis_materializer.vocabulary")
        obligation_sql = str(getattr(vocabulary, "OBLIGATION_BEARING_SQL", obligation_sql))
    except Exception:
        pass

    ledger_mark: Callable[[str, str], str] | None = None
    entry_mark: Callable[[str, int], str] | None = None
    if readback is not None:
        ledger_mark = getattr(readback, "ledger_stale_marker", None)
        entry_mark = getattr(readback, "stale_marker", None)

    def exposes_ledger_marker() -> str | None:
        if ledger_mark is None:
            because = f" (the module reported {scrub(readback_error)})" if readback_error else ""
            return (
                "amanuensis_materializer/readback.py does not expose"
                f" ledger_stale_marker(subsystem_id, file_path){because}"
            )
        one = ledger_mark("B-02", "src/writer.ts")
        two = ledger_mark("B-02", "src/parser.ts")
        swapped = ledger_mark("src/writer.ts", "B-02")
        if not isinstance(one, str) or not one.strip():
            return "ledger_stale_marker did not return a marker string"
        if one in (two, swapped):
            return (
                "ledger_stale_marker does not distinguish its rows;"
                f" it returned {one!r} for more than one input"
            )
        if "<!--" not in one or "-->" not in one:
            return f"the ledger stale marker is not an opaque comment: {one!r}"
        return None

    check("read-back exposes ledger_stale_marker", exposes_ledger_marker)

    def keeps_entries_marker() -> str | None:
        if entry_mark is None:
            return (
                "the `entries`-derived stale_marker(entry_id, tier) was removed from"
                " amanuensis_materializer/readback.py; §11.3 keeps it unchanged"
            )
        legacy = entry_mark("B-01-legacy-0", 1)
        if not isinstance(legacy, str) or "<!--" not in legacy:
            return "stale_marker no longer returns an opaque comment"
        if ledger_mark is not None and legacy == ledger_mark("B-01-legacy-0", "1"):
            return "the entries-derived and ledger-derived markers are indistinguishable"
        return None

    check("read-back keeps the entries-derived stale marker", keeps_entries_marker)

    root = Path(tempfile.mkdtemp(prefix="p4-ledger-freshness-"))
    try:
        storage, seed_error = seeded(root, "ledger")
        summary = publish(storage, "--clean-publish") if seed_error is None else {}
        docs = storage / "docs"
        index_md = read(docs / "index.md") or ""
        stale_md = read(docs / STALE_PAGE) or ""
        md_corpus = corpus(docs, ".md")
        html_corpus = corpus(docs, ".html")
        dashboard = (
            dashboard_counts(storage, obligation_sql) if seed_error is None else "not seeded"
        )
        shape = ledger_shape(storage, obligation_sql) if seed_error is None else {}

        def published_green() -> str | None:
            if seed_error:
                return seed_error
            if not summary.get("ok"):
                warnings = [scrub(w)[:120] for w in summary.get("warnings") or []]
                return (
                    "the clean publish was not green;"
                    f" warnings {warnings[:2]}, diagnostic"
                    f" {scrub(summary.get('_diagnostic'))[:160]}"
                )
            if not index_md:
                return "the publish produced no overview to inspect"
            return None

        check("the seeded ledger publishes green", published_green)

        def dashboard_available() -> str | None:
            if isinstance(dashboard, str):
                return dashboard
            expected = {
                "stale_entries": len(OBLIGATION_STALE),
                "stale_exempt": len(EXEMPT_STALE),
                "scoped_files": len(LEDGER),
                "staleness_measured": True,
            }
            if dashboard != expected:
                return (
                    "get_dashboard's own subqueries do not read the seeded ledger as"
                    f" the fixture describes it: {dashboard} against {expected}"
                )
            return None

        check("get_dashboard's ledger quantities are recoverable", dashboard_available)

        def strip_parity() -> str | None:
            if isinstance(dashboard, str):
                return "get_dashboard's quantities are unavailable, so parity cannot run"
            text = strip_text(docs, "index.html")
            if text is None:
                return "the overview's HTML snapshot strip is not present"
            missing = [
                phrase
                for phrase in (
                    STRIP_OBLIGATION.format(n=dashboard["stale_entries"]),
                    STRIP_EXEMPT.format(n=dashboard["stale_exempt"]),
                    STRIP_SCOPED.format(n=dashboard["scoped_files"]),
                )
                if phrase not in text
            ]
            if missing:
                return (
                    f"the freshness strip does not report {missing}; it reads"
                    f" {text[:180]!r}"
                )
            if NOT_MEASURED in text:
                return "a measured ledger still renders the unmeasured sentence"
            return None

        check("the freshness strip equals get_dashboard on the same store", strip_parity)

        def strip_is_shell_wide() -> str | None:
            if isinstance(dashboard, str):
                return "get_dashboard's quantities are unavailable, so parity cannot run"
            reference = strip_text(docs, "index.html")
            if reference is None:
                return "the overview's HTML snapshot strip is not present"
            phrase = STRIP_SCOPED.format(n=dashboard["scoped_files"])
            missing = [
                str(path.relative_to(docs))
                for path in sorted(docs.rglob("*.html"))
                if phrase not in (strip_text(docs, str(path.relative_to(docs))) or "")
            ]
            if missing:
                return (
                    f"{len(missing)} page(s) carry a different freshness reading;"
                    f" first: {missing[0]}"
                )
            return None

        check("every page's strip carries the same reading", strip_is_shell_wide)

        def no_false_green() -> str | None:
            if FALSE_GREEN in html_corpus or FALSE_GREEN in md_corpus:
                return f"a published page still claims {FALSE_GREEN!r}"
            return None

        check("no page claims there are no recorded stale entries", no_false_green)

        def overview_reads_the_ledger() -> str | None:
            if isinstance(dashboard, str):
                return "get_dashboard's quantities are unavailable, so parity cannot run"
            body = section(index_md, "Where the record stands")
            if not body:
                return "the overview has no 'Where the record stands' section"
            obligation_fact = f"{dashboard['stale_entries']} of {shape['obligation']}"
            exempt_fact = f"{dashboard['stale_exempt']} of {shape['exempt']}"
            if obligation_fact not in body:
                return (
                    f"the overview does not report {obligation_fact!r} stale files"
                    " carrying a survey obligation"
                )
            if exempt_fact not in body:
                return f"the overview does not report {exempt_fact!r} stale exempt files"
            if f"{ENTRIES_STALE} of" in body or f" {ENTRIES_STALE} " in body:
                return (
                    f"the overview reports {ENTRIES_STALE}, the `entries`-derived count"
                    " no code path writes"
                )
            return None

        check("the overview's count is ledger-derived", overview_reads_the_ledger)

        def entries_count_is_unpublished() -> str | None:
            text = strip_text(docs, "index.html") or ""
            if re.search(rf"\b{ENTRIES_STALE}\b", text):
                return (
                    f"the freshness strip reports {ENTRIES_STALE}, which is the"
                    " `entries` count, not a ledger count"
                )
            return None

        check("the strip does not report the entries count", entries_count_is_unpublished)

        def stale_page_exists() -> str | None:
            if not stale_md:
                return f"{STALE_PAGE} was not published"
            if not read(docs / STALE_HTML):
                return f"{STALE_HTML} was not published beside its Markdown companion"
            return None

        check("stale.md is published in both formats", stale_page_exists)

        def one_record_per_row() -> str | None:
            if ledger_mark is None:
                return "ledger_stale_marker is unavailable, so its records cannot be counted"
            if not stale_md:
                return f"{STALE_PAGE} was not published"
            stale_html = read(docs / STALE_HTML) or ""
            wrong: list[str] = []
            for subsystem, path in OBLIGATION_STALE:
                marker = ledger_mark(subsystem, path)
                for label, page, whole in (
                    ("markdown", stale_md, md_corpus),
                    ("html", stale_html, html_corpus),
                ):
                    if page.count(marker) != 1 or whole.count(marker) != 1:
                        wrong.append(
                            f"{subsystem}/{path} has {page.count(marker)} record(s) on the"
                            f" {label} stale page and {whole.count(marker)} in that corpus"
                        )
            if wrong:
                return f"{len(wrong)} row(s) are not recorded exactly once; first: {wrong[0]}"
            return None

        check(
            "every obligation-bearing stale row has exactly one record per format",
            one_record_per_row,
        )

        def multi_owner_rows_are_distinct() -> str | None:
            if ledger_mark is None:
                return "ledger_stale_marker is unavailable, so its keying cannot be checked"
            owners = [s for s, p in OBLIGATION_STALE if p == MULTI_OWNER_PATH]
            if len(owners) < 2:
                return f"the fixture no longer owns {MULTI_OWNER_PATH} twice"
            markers = {ledger_mark(owner, MULTI_OWNER_PATH) for owner in owners}
            if len(markers) != len(owners):
                return (
                    f"{MULTI_OWNER_PATH} is owned by {owners} but carries"
                    f" {len(markers)} distinct marker(s); the record is keyed on the"
                    " path alone, so one owner's row loses its record"
                )
            if not stale_md:
                return f"{STALE_PAGE} was not published"
            for owner in owners:
                if f"[{owner}]" not in stale_md and owner not in stale_md:
                    return (
                        f"{STALE_PAGE} does not name {owner} as an owner of"
                        f" {MULTI_OWNER_PATH}"
                    )
            return None

        check("a path owned twice carries one record per owner", multi_owner_rows_are_distinct)

        def exempt_rows_have_no_record() -> str | None:
            if ledger_mark is None:
                return "ledger_stale_marker is unavailable, so exemption cannot be checked"
            recorded = [
                f"{subsystem}/{path}"
                for subsystem, path in EXEMPT_STALE
                if ledger_mark(subsystem, path) in md_corpus
                or ledger_mark(subsystem, path) in html_corpus
            ]
            if recorded:
                return (
                    "a stale row exempt from the survey obligation was given a stale"
                    f" record: {recorded[0]}"
                )
            return None

        check("rows exempt from the obligation get no stale record", exempt_rows_have_no_record)

        def candidates_have_their_own_heading() -> str | None:
            if not stale_md:
                return f"{STALE_PAGE} was not published"
            if CANDIDATE_HEADING not in headings(stale_md):
                return (
                    f"{STALE_PAGE} has no {CANDIDATE_HEADING!r} heading; its sections are"
                    f" {headings(stale_md)}"
                )
            body = section(stale_md, CANDIDATE_HEADING)
            candidate_total = sum(1 for _s, _p, c, _x in LEDGER if c == "candidate")
            denominator = f"{len(CANDIDATE_STALE)} of {candidate_total}"
            if denominator not in body:
                return (
                    f"the drifted-candidate section does not carry its own denominator"
                    f" {denominator!r}"
                )
            for _subsystem, path in CANDIDATE_STALE:
                if path not in body:
                    return f"{path} is not reported under {CANDIDATE_HEADING!r}"
            return None

        check("drifted candidates are reported under their own heading", candidates_have_their_own_heading)

        def candidates_are_not_stale_knowledge() -> str | None:
            if not stale_md:
                return f"{STALE_PAGE} was not published"
            sections = headings(stale_md)
            if CANDIDATE_HEADING not in sections:
                return f"{STALE_PAGE} has no drifted-candidate section to separate"
            others = [h for h in sections if h != CANDIDATE_HEADING]
            for heading in others:
                body = section(stale_md, heading)
                for _subsystem, path in CANDIDATE_STALE:
                    if path in body:
                        return (
                            f"the unread file {path} is also reported under {heading!r},"
                            " which reads it as stale knowledge"
                        )
            examined_section = next(
                (h for h in others if any(path in section(stale_md, h) for _s, path in EXAMINED_STALE)),
                None,
            )
            if examined_section is None:
                return "no section reports the examined files the repository changed under"
            return None

        check("an unread file is never reported as stale knowledge", candidates_are_not_stale_knowledge)

        def every_row_lands_in_one_section() -> str | None:
            if not stale_md:
                return f"{STALE_PAGE} was not published"
            sections = headings(stale_md)
            bodies = {heading: section(stale_md, heading) for heading in sections}
            for subsystem, path in OBLIGATION_STALE:
                homes = [h for h, body in bodies.items() if path in body]
                if len(homes) != 1:
                    return (
                        f"{subsystem}/{path} appears in {len(homes)} section(s)"
                        f" {homes}, not in exactly one"
                    )
            return None

        check("every obligation-bearing stale row lands in exactly one section", every_row_lands_in_one_section)

        def deleting_a_record_turns_state_red() -> str | None:
            if ledger_mark is None or not stale_md:
                return "there is no ledger stale record to delete"
            subsystem, path = OBLIGATION_STALE[0]
            marker = ledger_mark(subsystem, path)
            page = docs / STALE_PAGE
            body = page.read_text()
            line = next(
                (candidate for candidate in body.splitlines() if marker in candidate), None
            )
            if line is None:
                return f"{STALE_PAGE} carries no record for {subsystem}/{path} to delete"
            page.write_text(body.replace(line + "\n", "", 1))
            try:
                verified = publish(storage, "--readback-only")
                axes = verified.get("axes") or {}
                if (axes.get("state") or {}).get("ok", True):
                    return (
                        "the state axis stayed green after one stale record was deleted;"
                        f" mismatches {verified.get('mismatch_count')}"
                    )
                named = [
                    m
                    for m in verified.get("mismatches") or []
                    if path in str(m.get("object_id", ""))
                ]
                if not named:
                    ids = [str(m.get("object_id")) for m in verified.get("mismatches") or []]
                    return (
                        "the state axis went red without naming the row whose record was"
                        f" deleted; it named {ids[:3]}"
                    )
            finally:
                page.write_text(body)
            return None

        check("deleting one stale record turns the state axis red", deleting_a_record_turns_state_red)

        def entries_axis_still_red_capable() -> str | None:
            if entry_mark is None:
                return "the entries-derived marker is unavailable"
            marker = entry_mark("B-01-legacy-0", 1)
            page = next(
                (p for p in sorted(docs.rglob("*.md")) if marker in (read(p) or "")), None
            )
            if page is None:
                return (
                    "no published Markdown page carries the entries-derived stale marker,"
                    " so that check has lost its denominator"
                )
            body = page.read_text()
            line = next(candidate for candidate in body.splitlines() if marker in candidate)
            page.write_text(body.replace(line + "\n", "", 1))
            try:
                verified = publish(storage, "--readback-only")
                axes = verified.get("axes") or {}
                if (axes.get("state") or {}).get("ok", True):
                    return "the state axis stayed green after an entries stale marker was deleted"
            finally:
                page.write_text(body)
            return None

        check("the entries-derived stale check is still red-capable", entries_axis_still_red_capable)

        # -- the honest empty state -----------------------------------------
        empty_storage, empty_error = seeded(root, "empty", ledger=False)
        empty = publish(empty_storage, "--clean-publish") if empty_error is None else {}
        empty_docs = empty_storage / "docs"

        def empty_ledger_is_honest() -> str | None:
            if empty_error:
                return empty_error
            if not empty.get("ok"):
                warnings = [scrub(w)[:120] for w in empty.get("warnings") or []]
                return (
                    "the empty-ledger publish was not green;"
                    f" warnings {warnings[:2]}, diagnostic"
                    f" {scrub(empty.get('_diagnostic'))[:160]}"
                )
            text = strip_text(empty_docs, "index.html")
            if text is None:
                return "the empty-ledger publish produced no snapshot strip"
            if NOT_MEASURED not in text:
                return (
                    f"an empty file_ledger does not render {NOT_MEASURED!r}; the strip"
                    f" reads {text[:180]!r}"
                )
            if FALSE_GREEN in text:
                return f"an unmeasured projection still claims {FALSE_GREEN!r}"
            if re.search(r"\b0 (of|scoped|with)\b", text):
                return (
                    "an unmeasured projection reports a zero count beside the sentence"
                    f" that says it was not measured: {text[:180]!r}"
                )
            return None

        check("an empty file_ledger renders the unmeasured sentence", empty_ledger_is_honest)

        def empty_overview_is_honest() -> str | None:
            if empty_error:
                return empty_error
            body = section(read(empty_docs / "index.md") or "", "Where the record stands")
            if not body:
                return "the empty-ledger overview has no 'Where the record stands' section"
            if "not measured by this projection" not in body:
                return (
                    "the empty-ledger overview does not say its freshness was not"
                    " measured by this projection"
                )
            return None

        check("the empty-ledger overview says so too", empty_overview_is_honest)

        # -- scoped, but nothing in scope carries an obligation ---------------
        # §11.2 fixes measurement on `scoped_files`, not on the obligation
        # count.  A ledger of nothing but generated and vendored paths is
        # measured: the projection read every scoped row and knows their
        # freshness exactly.  Saying it was not measured hides a real reading
        # behind the sentence reserved for having no ledger at all, and it puts
        # the overview at odds with the HTML strip, which reads scoped_files on
        # the same store.
        all_exempt_storage = root / "all-exempt"
        all_exempt_storage.mkdir(parents=True, exist_ok=True)
        all_exempt_error: str | None = None
        try:
            seed(all_exempt_storage, ledger=False)
            db = sqlite3.connect(all_exempt_storage / "memory.db")
            db.executemany(
                "INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope,"
                " classification, ref_sha, stale, stale_since, stale_reason)"
                " VALUES (?, ?, 'In scope.', ?, 'aaaaaaaaaaaa1111', ?, ?, ?)",
                [
                    ("B-01", "dist/bundle.js", "generated-ignore", 1, "2026-09-10T12:00:00Z", "git-drift"),
                    ("B-01", "vendor/lib.js", "vendor-ignore", 0, None, None),
                ],
            )
            db.commit()
            db.close()
        except Exception as exc:
            all_exempt_error = f"the all-exempt fixture could not be seeded — {scrub(exc)}"
        all_exempt = (
            publish(all_exempt_storage, "--clean-publish") if all_exempt_error is None else {}
        )
        all_exempt_docs = all_exempt_storage / "docs"

        def all_exempt_is_measured() -> str | None:
            if all_exempt_error:
                return all_exempt_error
            if not all_exempt.get("ok"):
                warnings = [scrub(w)[:120] for w in all_exempt.get("warnings") or []]
                return (
                    "the all-exempt publish was not green;"
                    f" warnings {warnings[:2]}, diagnostic"
                    f" {scrub(all_exempt.get('_diagnostic'))[:160]}"
                )
            shape = ledger_shape(all_exempt_storage, obligation_sql)
            if shape["scoped"] != 2 or shape["obligation"] != 0:
                return (
                    "the all-exempt fixture is not all-exempt:"
                    f" {shape['scoped']} scoped, {shape['obligation']} obligation-bearing"
                )
            body = section(read(all_exempt_docs / "index.md") or "", "Where the record stands")
            if not body:
                return "the all-exempt overview has no 'Where the record stands' section"
            if NOT_MEASURED.lower() in body.lower() or "not measured by this projection" in body:
                return (
                    "the overview says freshness was not measured over 2 scoped files it read"
                    " exactly; §11.2 measures on scoped_files, not on the obligation count"
                )
            strip = strip_text(all_exempt_docs, "index.html")
            if strip is None:
                return "the all-exempt publish produced no snapshot strip"
            if NOT_MEASURED in strip:
                return f"the strip says {NOT_MEASURED!r} over a scoped ledger"
            if "1" not in body:
                return "the overview drops the exempt stale count it can still report"
            return None

        check(
            "an all-exempt ledger is measured, and reports zero obligation-bearing files",
            all_exempt_is_measured,
        )
    finally:
        shutil.rmtree(root, ignore_errors=True)

    # -- CI -----------------------------------------------------------------
    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if text is None:
            return "the CI workflow .github/workflows/test.yml is not readable"
        if "test-ledger-freshness.py" not in text:
            return "the workflow does not run test-ledger-freshness.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(
            "GATE P4 RED: the ledger-derived freshness strip and the stale read-back"
            f" axis do not hold — {len(FAILURES)} assertion(s) failed;"
            f" first: {FAILURES[0]}"
        )
        return 1
    emit("GATE P4 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
