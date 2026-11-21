#!/usr/bin/env python3
"""Gate for orientation packet O14 — say what the Markdown view leaves out
(design/orientation/PLAN.md §4 O14, "Publishing defects", §7.2).

Turns red when, on a seeded store:

  - the publish does not write index.html or the guide (how-to-read.html);
  - the guide's "What this site is" section does not end with the paragraph
    "Each page is written twice from the same record: ... A copy of the
    Markdown alone leaves those out.", word for word, as its last paragraph
    and after Appendix C's own paragraph, or that paragraph carries a code
    element or a backtick;
  - the paragraph appears anywhere but the guide's "What this site is" section
    (the overview must stay unchanged, §7.2), or appears twice;
  - the first 600 bytes of the guide's visible text carry a backtick or code;
  - the gate does not run in CI.

Also red when a published HTML page hides its report from assistive technology
(`orientation_exposure.hidden_pages`: `aria-hidden="true"`, `hidden`, `inert`,
an inline `display: none` or `role="presentation"` on `<main>`, the page head,
the article or any element around them), which every text check above reads
straight through.

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
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

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
    # The pages read the imports the store holds, never a file in storage.
    import_onboarding(
        db,
        session_id="o14",
        entry_point="# Where to begin\n\nStart at the reader.\n",
        onboarding_report="# Onboarding\n\nOne repository.\n",
        concern_checklist="# Checklist\n\n## Active concerns\n\n- none\n",
    )
    db.commit()
    db.close()


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


class _Head(HTMLParser):
    """The visible text of a page up to a byte budget, and whether a `<code>`
    element opened inside that budget."""

    def __init__(self, budget: int) -> None:
        super().__init__(convert_charrefs=True)
        self.budget = budget
        self.text = ""
        self.code_in_head = False
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style"):
            self._skip += 1
        if tag == "code" and len(self.text.encode("utf-8")) < self.budget:
            self.code_in_head = True

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.text += data


def html_section_markup(text: str, title: str) -> str | None:
    """The markup between the `<h2>` named `title` and the next `<h2>`."""

    heads = list(re.finditer(r"<h2\b[^>]*>(.*?)</h2>", text, re.S))
    for index, match in enumerate(heads):
        if html_text(match.group(1)).lstrip("§").strip() == title:
            end = heads[index + 1].start() if index + 1 < len(heads) else len(text)
            return text[match.end() : end]
    return None


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
        guide_html = read(docs / "how-to-read.html") or ""
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
                    ("index.html", index_html),
                    ("how-to-read.html", guide_html),
                )
                if not body
            ]
            return f"not written: {', '.join(missing)}" if missing else None

        check("the publish writes the overview and the guide as HTML", both_views_written)

        # -- the views paragraph is plain text ---------------------------------
        def views_paragraph_has_no_code() -> str | None:
            section = html_section_markup(guide_html, SECTION)
            if section is None:
                return f"how-to-read.html has no '{SECTION}' section"
            paras = re.findall(r"<p\b[^>]*>(.*?)</p>", section, re.S)
            if len(paras) < 2:
                return "how-to-read.html has only Appendix C's paragraph; the views paragraph is missing"
            if "<code" in paras[-1] or "`" in html_text(paras[-1]):
                return "the views paragraph in how-to-read.html carries code or a backtick"
            return None

        check("'What this site is' ends with the views paragraph, with no code", views_paragraph_has_no_code)

        def no_backtick_up_top() -> str | None:
            start = guide_html.find('<header class="page-head"')
            parser = _Head(BYTES_WITHOUT_CODE)
            parser.feed(guide_html[start:] if start >= 0 else guide_html)
            parser.close()
            head = parser.text.encode("utf-8")[:BYTES_WITHOUT_CODE].decode("utf-8", "ignore")
            if "`" in head:
                return f"a backtick sits at byte {head.index('`')}"
            if parser.code_in_head:
                return "how-to-read.html opens a <code> element within the first 600 bytes of visible text"
            return None

        check("the first 600 bytes of the guide's visible text carry no backtick or code", no_backtick_up_top)

        # -- the paragraph closes the section -------------------------------
        def html_ends_with_paragraph() -> str | None:
            paras = html_section_paragraphs(guide_html, SECTION)
            if paras is None:
                return f"how-to-read.html has no '{SECTION}' section"
            if not paras[0].startswith(SITE_OPENING):
                return f"the section's first paragraph is not Appendix C's: {paras[:1]!r}"
            if len(paras) < 2:
                return "how-to-read.html has only Appendix C's paragraph; the views paragraph is missing"
            if paras[-1] != VIEWS_PARAGRAPH:
                return f"the section's last paragraph is {paras[-1][:200]!r}, not the views paragraph"
            return None

        check("HTML: 'What this site is' ends with the views paragraph", html_ends_with_paragraph)

        # -- the paragraph lives there only ---------------------------------
        def said_once_per_view() -> str | None:
            count = html_text(guide_html).count(VIEWS_PARAGRAPH)
            if count != 1:
                return f"how-to-read.html says it {count} times, not once"
            return None

        check("the guide says it exactly once", said_once_per_view)

        def overview_unchanged() -> str | None:
            flat = html_text(index_html or "")
            for probe in ("written twice", "Markdown alone", "leaves those out"):
                if probe in flat:
                    return f"index.html carries {probe!r}; the overview is not changed (§7.2)"
            return None

        check("the overview does not carry the paragraph (§7.2)", overview_unchanged)

        def other_pages_do_not() -> str | None:
            pages = sorted(docs.rglob("*.html"))
            if not any(path.name == "architecture.html" for path in pages):
                return "the fixture published no architecture.html to check"
            for path in pages:
                if path.stem == "how-to-read":
                    continue
                body = read(path) or ""
                flat = html_text(body)
                for probe in ("written twice", "Markdown alone", "leaves those out"):
                    if probe in flat:
                        return f"{path.relative_to(docs)} repeats the paragraph ({probe!r})"
            return None

        check("no other page repeats the paragraph", other_pages_do_not)
        check("no published page hides its report from assistive technology", lambda: hidden_pages(docs))

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
