#!/usr/bin/env python3
"""Gate for orientation packet O14 — say what the Markdown view leaves out
(design/orientation/PLAN.md §4 O14, "Publishing defects", §7.2).

Turns red when, on a seeded store:

  - the publish does not write index.html beside index.md, or the guide
    (how-to-read) in either view;
  - the guide's Markdown "What this site is" section does not end with the
    paragraph "Each page is written twice from the same record: ... A copy of
    the Markdown alone leaves those out.", word for word, as its last paragraph
    and after Appendix C's own paragraph, or that paragraph carries a backtick;
  - the guide's HTML "What this site is" section does not end with the same
    paragraph, or Appendix C's paragraph no longer comes first in either view;
  - the paragraph appears anywhere but the guide's "What this site is" section
    (the overview must stay unchanged, §7.2), or appears twice;
  - the first 600 bytes of the guide's Markdown carry a backtick;
  - the gate does not run in CI.

False green it cannot exclude: the paragraph's claims (the HTML adds diagrams,
search and hover definitions) are checked against the plan's wording, not
against what the HTML view actually contains; this fixture has no diagram.
The HTML checks read bytes; they do not drive a browser.

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
from typing import Any

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


# ---------------------------------------------------------------------------
# What PLAN.md fixes, written out here rather than imported, so that rewriting
# an implementation string cannot also rewrite what this gate expects.
# ---------------------------------------------------------------------------
SECTION = "What this site is"
VIEWS_PARAGRAPH = (
    "Each page is written twice from the same record: as HTML, which adds the diagrams, the"
    " search and the definitions shown on hover, and as Markdown. Both are written to the same"
    " directory; the HTML starts at index.html. A copy of the Markdown alone leaves those out."
)
SITE_OPENING = "This site is the record of an AI agent's survey of"
BYTES_WITHOUT_CODE = 600

SHA = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"
SUBSYSTEMS = (
    ("B-01", "Read path", "mapped", "backend", "src/reader.ts", None, None),
    ("F-01", "Console", "scoping", "frontend", "ui/console.ts", None, None),
)


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
        " VALUES ('default', 'main', ?, ?, '2026-11-20T12:00:00Z')",
        (SHA, SHA),
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('o14', 'fixture')")
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        list(SUBSYSTEMS),
    )
    db.commit()
    db.close()
    (storage / "entry-point.md").write_text("# Where to begin\n\nStart at the reader.\n")
    (storage / "onboarding-report.md").write_text("# Onboarding\n\nOne repository.\n")
    (storage / "concern-checklist.md").write_text("# Checklist\n\n## Active concerns\n\n- none\n")


def publish(storage: Path) -> dict[str, Any]:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage)],
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
    if not summary.get("ok") and "_diagnostic" not in summary:
        summary["_diagnostic"] = scrub(proc.stderr)[-300:]
    return summary


def read(path: Path) -> str | None:
    try:
        return path.read_text()
    except OSError:
        return None


# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------
def squash(text: str) -> str:
    return " ".join(text.split())


def md_section_paragraphs(text: str, title: str) -> list[str] | None:
    """The blank-line-separated paragraphs of the H2 section `title`, whitespace squashed."""

    lines: list[str] | None = None
    for line in text.splitlines():
        if line.startswith("## "):
            if lines is not None:
                break
            lines = [] if line[3:].strip() == title else None
        elif lines is not None:
            lines.append(line)
    if lines is None:
        return None
    return [squash(block) for block in "\n".join(lines).split("\n\n") if block.strip()]


def html_text(fragment: str) -> str:
    return squash(htmllib.unescape(re.sub(r"<[^>]+>", "", fragment)))


def html_section_paragraphs(text: str, title: str) -> list[str] | None:
    """The `<p>` texts between the `<h2>` named `title` and the next `<h2>`."""

    heads = list(re.finditer(r"<h2\b[^>]*>(.*?)</h2>", text, re.S))
    for index, match in enumerate(heads):
        if html_text(match.group(1)).lstrip("§").strip() != title:
            continue
        end = heads[index + 1].start() if index + 1 < len(heads) else len(text)
        return [html_text(p) for p in re.findall(r"<p\b[^>]*>(.*?)</p>", text[match.end() : end], re.S)]
    return None


def visible(text: str) -> str:
    return re.sub(r"\*\*(.+?)\*\*|\*(.+?)\*", lambda m: m.group(1) or m.group(2) or "", text)


def main() -> int:
    emit("GATE O14 — what the Markdown view leaves out")
    emit("")

    with tempfile.TemporaryDirectory(prefix="o14-gate-") as tmp:
        storage = Path(tmp) / "store"
        storage.mkdir()
        seeded = True
        try:
            seed(storage)
        except Exception as exc:
            seeded = False
            FAILURES.append(f"fixture: could not seed a store — {scrub(repr(exc))}")
            emit(f"  FAIL fixture: could not seed a store — {scrub(repr(exc))}")
        summary: dict[str, Any] = publish(storage) if seeded else {}
        docs = storage / "docs"
        guide_md = read(docs / "how-to-read.md") or ""
        guide_html = read(docs / "how-to-read.html") or ""
        index_md = read(docs / "index.md")
        index_html = read(docs / "index.html")

        def published() -> str | None:
            if not summary or summary.get("_returncode") != 0 or summary.get("ok") is False:
                return f"the materializer did not publish the fixture — {summary.get('_diagnostic', summary)}"
            return None

        check("the fixture publishes", published)

        def both_views_written() -> str | None:
            missing = [
                name
                for name, body in (
                    ("index.md", index_md),
                    ("index.html", index_html),
                    ("how-to-read.md", guide_md),
                    ("how-to-read.html", guide_html),
                )
                if not body
            ]
            return f"not written: {', '.join(missing)}" if missing else None

        check("the publish writes index.html beside index.md, and the guide in both views", both_views_written)

        # -- Markdown ------------------------------------------------------
        def markdown_ends_with_paragraph() -> str | None:
            paras = md_section_paragraphs(guide_md, SECTION)
            if paras is None:
                return f"the guide's Markdown has no '{SECTION}' section"
            shown = [visible(p) for p in paras]
            if not shown[0].startswith(SITE_OPENING):
                return f"the section's first paragraph is not Appendix C's: {shown[:1]!r}"
            if len(shown) < 2:
                return "the section has only Appendix C's paragraph; the views paragraph is missing"
            if shown[-1] != VIEWS_PARAGRAPH:
                return f"the section's last paragraph is {shown[-1][:200]!r}, not the views paragraph"
            if "`" in paras[-1]:
                return "the views paragraph carries a backtick"
            return None

        check("Markdown: 'What this site is' ends with the views paragraph, no backticks", markdown_ends_with_paragraph)

        def no_backtick_up_top() -> str | None:
            head = guide_md.encode("utf-8")[:BYTES_WITHOUT_CODE].decode("utf-8", "ignore")
            if "`" in head:
                return f"a backtick sits at byte {head.index('`')}"
            return None

        check("the first 600 bytes of the guide carry no backtick", no_backtick_up_top)

        # -- HTML ----------------------------------------------------------
        def html_ends_with_paragraph() -> str | None:
            paras = html_section_paragraphs(guide_html, SECTION)
            if paras is None:
                return f"the guide's HTML has no '{SECTION}' section"
            if not paras[0].startswith(SITE_OPENING):
                return f"the section's first paragraph is not Appendix C's: {paras[:1]!r}"
            if len(paras) < 2:
                return "the section has only Appendix C's paragraph; the views paragraph is missing"
            if paras[-1] != VIEWS_PARAGRAPH:
                return f"the section's last paragraph is {paras[-1][:200]!r}, not the views paragraph"
            return None

        check("HTML: 'What this site is' ends with the views paragraph", html_ends_with_paragraph)

        # -- the paragraph lives there only ---------------------------------
        def said_once_per_view() -> str | None:
            for name, body, flatten in (
                ("how-to-read.md", guide_md, squash),
                ("how-to-read.html", guide_html, html_text),
            ):
                count = flatten(visible(body)).count(VIEWS_PARAGRAPH)
                if count != 1:
                    return f"{name} says it {count} times, not once"
            return None

        check("the guide says it exactly once in each view", said_once_per_view)

        def overview_unchanged() -> str | None:
            for name, body, flatten in (
                ("index.md", index_md or "", squash),
                ("index.html", index_html or "", html_text),
            ):
                flat = flatten(visible(body))
                for probe in ("written twice", "Markdown alone", "leaves those out"):
                    if probe in flat:
                        return f"{name} carries {probe!r}; the overview is not changed (§7.2)"
            return None

        check("the overview does not carry the paragraph (§7.2)", overview_unchanged)

        def other_pages_do_not() -> str | None:
            for path in sorted(docs.rglob("*.md")):
                if path.name == "how-to-read.md":
                    continue
                body = read(path) or ""
                if "Markdown alone" in squash(body):
                    return f"{path.relative_to(docs)} repeats the paragraph"
            return None

        check("no other Markdown page repeats the paragraph", other_pages_do_not)

        # -- CI ------------------------------------------------------------
        def runs_in_ci() -> str | None:
            workflow = read(CI_FILE) or ""
            if "test-orientation-views.py" not in workflow:
                return "test.yml has no step for test-orientation-views.py"
            return None

        check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE O14 RED: {FAILURES[0]}")
        return 1
    emit("GATE O14 GREEN")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as exc:  # a crash is red with a reason, never a stack trace
        emit(f"GATE O14 RED: the gate itself failed — {exc!r}")
        sys.exit(1)
