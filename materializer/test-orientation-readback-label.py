#!/usr/bin/env python3
"""Gate for orientation packet O12 — say which publication the read-back describes
(design/orientation/PLAN.md §4 O12, "Publishing defects").

Turns red when, on a seeded store with two recorded read-backs (older: state axis
failed; newer: every axis passed), in the HTML overview:

  - the Publication integrity block lacks the sentence "A publication's read-back
    is recorded after its pages are written, so these results describe the
    publication before this one.", word for word, or prints it below the axis rows
    instead of above them, or prints it more than once;
  - the block still labels the time row "Verified at", or lacks a "Read back at"
    row carrying the newer run's date;
  - the block reports the older run (its date, or a failed axis);
  - on a third store whose newer run has mixed axes (state passed, coverage failed,
    content passed; the older run the reverse), any axis row prints a value other
    than its own run's;
  - a store with no recorded read-back prints the lag sentence, or loses its
    "No publication read-back is recorded" sentence;
  - the gate does not run in CI.

Also red when a published HTML page hides its report from assistive technology
(`orientation_exposure.hidden_pages`: `aria-hidden="true"`, `hidden`, `inert`,
an inline `display: none` or `role="presentation"` on `<main>`, the page head,
the article or any element around them), which every text check above reads
straight through.

False green it cannot exclude: it checks the wording and its position, not that the
reader understands it; and it reads bytes, it does not drive a browser.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed.
"""

from __future__ import annotations

import html as htmllib
import json
import re
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

from orientation_exposure import hidden_pages
from store_only_seed import import_onboarding

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"

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
    ("Traceback (most recent call last)", "stack trace"),
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


# What PLAN.md fixes, written out here rather than imported, so that rewriting an
# implementation string cannot also rewrite what this gate expects.
LAG_SENTENCE = (
    "A publication's read-back is recorded after its pages are written, so these"
    " results describe the publication before this one."
)
NO_RUN_SENTENCE = "No publication read-back is recorded for this store"
OLD_LABEL = "Verified at"
NEW_LABEL = "Read back at"
NEWER_DATE = "2026-09-11"
OLDER_DATE = "2026-09-09"
SHA = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"


# (state_ok, coverage_ok, content_ok) for the older and the newer run of each store.
RUNS = {
    "runs": ((0, 1, 1), (1, 1, 1)),
    "mixed": ((0, 1, 0), (1, 0, 1)),
    "none": None,
}


def seed(storage: Path, runs: tuple[tuple[int, int, int], tuple[int, int, int]] | None) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    db.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-20T12:00:00Z')",
        (SHA, SHA),
    )
    if runs:
        older, newer = runs
        db.executemany(
            "INSERT INTO projection_verification_runs (run_id, output_dir, mode, source_sha,"
            " state_ok, coverage_ok, content_ok, ok, summary_json, verified_at)"
            " VALUES (?, 'docs', 'clean-publish', ?, ?, ?, ?, ?, '{}', ?)",
            [
                ("run-older", SHA, *older, int(all(older)), f"{OLDER_DATE}T09:00:00Z"),
                ("run-newer", SHA, *newer, int(all(newer)), f"{NEWER_DATE}T18:30:00Z"),
            ],
        )
    # The pages read the imports the store holds, never a file in storage.
    db.execute("INSERT INTO sessions (session_id, intent) VALUES ('o14', 'fixture')")
    import_onboarding(db, session_id="o14", entry_point="# Where to begin\n\nStart at the reader.\n")
    db.commit()
    db.close()


def publish(storage: Path) -> str | None:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage)],
        capture_output=True,
        text=True,
        check=False,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    try:
        summary = json.loads(lines[-1]) if lines else {}
    except json.JSONDecodeError:
        summary = {}
    if proc.returncode != 0 or summary.get("ok") is False:
        return scrub(f"materializer did not publish: {summary or proc.stderr[-300:]}")
    return None


def read(path: Path) -> str:
    try:
        return path.read_text()
    except OSError:
        return ""


def squash(text: str) -> str:
    return " ".join(text.split())


def html_block(index: str) -> str:
    """The HTML from the Publication integrity heading to the end of its section."""

    start = index.find('<h3 id="publication-integrity"')
    if start < 0:
        return ""
    rest = index[start:]
    end = rest.find("</section>")
    return rest if end < 0 else rest[:end]


def flat_html(block: str) -> str:
    return squash(htmllib.unescape(re.sub(r"<[^>]+>", " ", block)))


def sentence_problem(flat: str, table_marker: str) -> str | None:
    """The lag sentence appears once, and before the first table row."""

    count = flat.count(LAG_SENTENCE)
    if count != 1:
        return f"the block carries the lag sentence {count} times, not once"
    if flat.index(LAG_SENTENCE) > flat.index(table_marker):
        return "the lag sentence sits below the table, not above it"
    return None


def block_problem(flat: str, table_marker: str) -> str | None:
    if not flat:
        return "the Publication integrity block is empty or missing"
    problem = sentence_problem(flat, table_marker)
    if problem:
        return problem
    if OLD_LABEL in flat:
        return f"the block still says {OLD_LABEL!r}"
    if NEW_LABEL not in flat:
        return f"the block has no {NEW_LABEL!r} row"
    after = flat[flat.index(NEW_LABEL) :]
    if NEWER_DATE not in after:
        return f"the {NEW_LABEL!r} row does not carry the newer run's date, {NEWER_DATE}"
    if OLDER_DATE in flat:
        return "the block reports the older run's date"
    # The sentence itself carries neither word; what remains is the three axis values.
    rest = flat.replace(LAG_SENTENCE, "")
    green = len(re.findall(r"(?i)\bgreen\b", rest))
    red = len(re.findall(r"(?i)\bred\b", rest))
    if (green, red) != (3, 0):
        return f"the block reports {green} green and {red} red axes; the newer run is green on all three"
    return None


def main() -> int:
    emit("GATE O12 — say which publication the read-back describes")
    emit("")

    with tempfile.TemporaryDirectory(prefix="o12-gate-") as tmp:
        base = Path(tmp)
        stores: dict[str, tuple[Path, str | None]] = {}
        for name, runs in RUNS.items():
            storage = base / name
            storage.mkdir()
            try:
                seed(storage, runs)
                stores[name] = (storage, publish(storage))
            except Exception as exc:
                stores[name] = (storage, scrub(f"could not seed or publish — {exc!r}"))

        def fixture(name: str) -> Callable[[], str | None]:
            return lambda: stores[name][1]

        check("the store with two read-backs publishes", fixture("runs"))
        check("the store with no read-back publishes", fixture("none"))
        check("the store whose newer read-back has mixed axes publishes", fixture("mixed"))

        docs = stores["runs"][0] / "docs"
        index_html = read(docs / "index.html")

        check(
            "HTML: the sentence leads the block, the row is 'Read back at' with the newer run",
            lambda: block_problem(flat_html(html_block(index_html)), "State axis"),
        )

        def sentence_leads_the_list() -> str | None:
            block = html_block(index_html)
            match = re.search(r'<p>(.*?)</p>\s*<dl class="summary-list"[^>]*>(.*?)</dl>', block, re.S)
            if not match:
                return "index.html: the block is not a paragraph followed by its list of axis rows"
            if squash(htmllib.unescape(match.group(1))) != LAG_SENTENCE:
                return "index.html: the paragraph before the axis rows is not the lag sentence"
            rows = [
                (squash(htmllib.unescape(re.sub(r"<[^>]+>", " ", term))), squash(htmllib.unescape(re.sub(r"<[^>]+>", " ", value))))
                for term, value in re.findall(r"<dt>(.*?)</dt><dd>(.*?)</dd>", match.group(2), re.S)
            ]
            labels = [label for label, _ in rows]
            if labels != ["State axis", "Coverage axis", "Content axis", NEW_LABEL]:
                return f"index.html: the axis rows are {labels}, not the three axes and {NEW_LABEL!r}"
            if not rows[-1][1].startswith(NEWER_DATE):
                return f"index.html: the {NEW_LABEL!r} row reads {rows[-1][1]!r}, not the newer run's date {NEWER_DATE}"
            return None

        check("HTML: the lag sentence is the paragraph above the axis rows, ending in 'Read back at'", sentence_leads_the_list)

        def mixed_axes() -> str | None:
            docs_mixed = stores["mixed"][0] / "docs"
            newer = RUNS["mixed"][1]
            flat = flat_html(html_block(read(docs_mixed / "index.html")))
            for axis, ok in zip(("State", "Coverage", "Content"), newer, strict=True):
                want = "green" if ok else "red"
                match = re.search(rf"\b{axis} axis (\w+)", flat)
                if not match:
                    return f"index.html: the block has no {axis} axis row"
                if match.group(1).lower() != want:
                    return f"index.html: the {axis} axis reads {match.group(1)}; the newer run's is {want}"
            return None

        check("each axis row reports its own value from the newer run", mixed_axes)

        def sentence_is_plain() -> str | None:
            if re.search(r"\d", LAG_SENTENCE) or re.search(r"(?i)\b(red|green)\b", LAG_SENTENCE):
                return "the plan's sentence carries a digit or a status word"
            return None

        check("the sentence stays free of digits and status words (the truthfulness count)", sentence_is_plain)

        def no_run_is_unchanged() -> str | None:
            docs_none = stores["none"][0] / "docs"
            flat = flat_html(html_block(read(docs_none / "index.html")))
            if NO_RUN_SENTENCE not in flat:
                return "index.html: the no-read-back sentence is gone"
            if LAG_SENTENCE in flat:
                return "index.html: a store with no read-back claims a publication before this one"
            if NEW_LABEL in flat or OLD_LABEL in flat:
                return "index.html: a store with no read-back prints a read-back time row"
            return None

        check("a store with no read-back keeps its own sentence and prints no lag claim", no_run_is_unchanged)
        check("no published page hides its report from assistive technology", lambda: hidden_pages(*(path / "docs" for path, _ in stores.values())))

        def runs_in_ci() -> str | None:
            if "test-orientation-readback-label.py" not in read(CI_FILE):
                return "test.yml has no step for test-orientation-readback-label.py"
            return None

        check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE O12 RED: {FAILURES[0]}")
        return 1
    emit("GATE O12 GREEN")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as exc:  # a crash is red with a reason, never a stack trace
        emit(f"GATE O12 RED: the gate itself failed — {exc!r}")
        sys.exit(1)
