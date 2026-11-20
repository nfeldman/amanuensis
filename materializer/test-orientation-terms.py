#!/usr/bin/env python3
"""Gate for orientation packet O6 — terms on each page
(design/orientation/PLAN.md §2.1, §4 O6, Appendix A).

Turns red when, on a store this gate seeds and publishes:

  - a published page that some `reader_terms` entry names in its `pages` (an
    exact path, or a `subsystems/*.md` / `diagnosticity/*.md` family glob) lacks
    a "Terms on this page:" line in its Markdown view or in its HTML view;
  - a published page that no entry names has the line in either view;
  - the line's links are not exactly the entries naming the page, in contract
    order, with the term as the link text;
  - the line is not directly under the page's hint and "Use it when" sentence
    (Markdown: the paragraph after it; HTML: after the `page-use-when`
    paragraph, inside the page head);
  - a link's anchor does not exist as an `id` in the guide's HTML, or its path
    does not reach the guide's published file from the page's own directory (a
    subsystem page needs the `../`), in either view;
  - the HTML prints the line without links a reader can follow with scripts
    disabled, or prints it twice (a head line left in the body);
  - the gate does not run in CI.

False green it cannot exclude: the fixture publishes the pages one small store
yields, so a family whose pages this store has none of (a matrix for every
case) is exercised by the ones it has. The HTML checks read bytes; they do not
drive a browser, so keyboard reachability is asserted only as "a real anchor
element".

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed.
"""

from __future__ import annotations

import json
import posixpath
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
CONTRACT = REPO / "mcp-server" / "contracts" / "conspectus-vocabulary.json"
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
# What PLAN.md fixes, written out here rather than imported.
# ---------------------------------------------------------------------------
GUIDE = "how-to-read"
LINE_LABEL = "Terms on this page:"

SHA = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"
SUBSYSTEMS = (
    ("B-01", "Read path", "mapped", "backend", "src/reader.ts", None, None),
    ("F-01", "Console", "scoping", "frontend", "ui/console.ts", None, None),
)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


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
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('o6', 'fixture')")
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        list(SUBSYSTEMS),
    )
    cur.execute(
        "INSERT INTO diagnosticity_sessions (id, subsystem_id, symptom, outcome, session_id)"
        " VALUES (7, 'B-01', 'rows appear twice after a restart', 'open', 'o6')"
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


LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def terms_for(page: str, terms: list[dict[str, Any]]) -> list[str]:
    """The terms whose `pages` name this page, in contract order."""

    out: list[str] = []
    for entry in terms:
        for pattern in entry.get("pages") or []:
            if pattern == page or (
                pattern.endswith("/*.md")
                and page.startswith(pattern[:-4])
                and page.count("/") == pattern.count("/")
            ):
                out.append(str(entry["term"]))
                break
    return out


def relative(from_page: str, to: str) -> str:
    base = posixpath.dirname(from_page) or "."
    return posixpath.relpath(to, base)


def md_head_paragraphs(text: str) -> list[str]:
    """The paragraphs after the H1 up to the next heading or the snapshot."""

    lines = text.split("\n")
    first = next((i for i, line in enumerate(lines) if line.strip()), None)
    if first is None or not lines[first].startswith("# "):
        return []
    paragraphs: list[str] = []
    current: list[str] = []
    for line in lines[first + 1 :]:
        if line.startswith("#"):
            break
        if line.strip():
            current.append(line)
        elif current:
            paragraphs.append(" ".join(current))
            current = []
    if current:
        paragraphs.append(" ".join(current))
    return paragraphs


def html_head(text: str) -> str:
    match = re.search(r'<header class="page-head">(.*?)</header>', text, re.S)
    return match.group(1) if match else ""


def only_separators(text: str) -> bool:
    return not re.search(r"[A-Za-z0-9]", text)


def main() -> int:
    emit("GATE O6 — terms on each page")
    emit("")

    terms: list[dict[str, Any]] = []
    try:
        terms = list(json.loads(CONTRACT.read_text()).get("reader_terms") or [])
    except Exception as exc:
        FAILURES.append(f"contract: could not read reader_terms — {scrub(repr(exc))}")
        emit(f"  FAIL contract: could not read reader_terms — {scrub(repr(exc))}")

    with tempfile.TemporaryDirectory(prefix="o6-gate-") as tmp:
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
        pages = sorted(
            p.relative_to(docs).as_posix()
            for p in docs.rglob("*.md")
        ) if docs.is_dir() else []
        guide_html = read(docs / f"{GUIDE}.html") or ""
        guide_ids = set(re.findall(r'\bid="([^"]+)"', guide_html))

        def published() -> str | None:
            if not summary or summary.get("_returncode") != 0 or summary.get("ok") is False:
                return f"the materializer did not publish the fixture — {summary.get('_diagnostic', summary)}"
            if not pages:
                return "no Markdown page was written"
            if not guide_html:
                return "docs/how-to-read.html was not written"
            if not terms:
                return "the contract has no reader_terms"
            return None

        check("the fixture publishes", published)

        def fixture_covers() -> str | None:
            with_terms = [p for p in pages if terms_for(p, terms)]
            without = [p for p in pages if not terms_for(p, terms)]
            if not any(p.startswith("subsystems/") for p in with_terms):
                return "the fixture has no subsystem page that names terms"
            if not any(p.startswith("diagnosticity/") for p in with_terms):
                return "the fixture has no evidence-table page that names terms"
            if "index.md" not in with_terms:
                return "index.md names no term"
            if GUIDE + ".md" not in without:
                return "the guide itself should carry no terms line"
            if len(without) < 2:
                return "the fixture has no page without terms to test omission on"
            return None

        check("the fixture has pages with and without terms", fixture_covers)

        def anchors_exist() -> str | None:
            for entry in terms:
                anchor = f"term-{slug(str(entry['term']))}"
                if anchor not in guide_ids:
                    return f"the guide's HTML has no id {anchor!r}"
            return None

        check("the guide has an anchor per term", anchors_exist)

        def check_links(page: str, view: str, links: list[tuple[str, str]], want: list[str]) -> str | None:
            if [text for text, _ in links] != want:
                return f"{page} ({view}) links {[text for text, _ in links]}, expected {want}"
            ext = ".md" if view == "Markdown" else ".html"
            for text, href in links:
                path, _, fragment = href.partition("#")
                target = posixpath.normpath(posixpath.join(posixpath.dirname(page), path))
                if target != GUIDE + ext:
                    return f"{page} ({view}): the link for {text!r} goes to {href!r}, not the guide"
                if fragment != f"term-{slug(text)}":
                    return f"{page} ({view}): the link for {text!r} points at #{fragment}"
                if fragment not in guide_ids:
                    return f"{page} ({view}): #{fragment} is not an id in the guide's HTML"
            return None

        def markdown_view() -> str | None:
            for page in pages:
                want = terms_for(page, terms)
                text = read(docs / page) or ""
                paragraphs = md_head_paragraphs(text)
                lines = [p for p in paragraphs if p.startswith(LINE_LABEL)]
                if not want:
                    if LINE_LABEL in text:
                        return f"{page} has the terms line and names no term"
                    continue
                if len(lines) != 1:
                    return f"{page} (Markdown) has {len(lines)} terms lines, expected 1"
                line = lines[0]
                position = paragraphs.index(line)
                if position == 0 or not paragraphs[position - 1].startswith("*"):
                    return f"{page} (Markdown): the terms line is not directly under the hint and use-when line"
                if not paragraphs[position - 1].rstrip().endswith("*") or "Use it when" not in paragraphs[position - 1]:
                    return f"{page} (Markdown): the paragraph above the terms line is not the use-when line"
                links = LINK.findall(line)
                if not only_separators(LINK.sub("", line).replace(LINE_LABEL, "")):
                    return f"{page} (Markdown): the terms line carries text besides links: {line!r}"
                reason = check_links(page, "Markdown", links, want)
                if reason:
                    return reason
            return None

        check("every page that names terms prints the line in Markdown, and no other does", markdown_view)

        def html_view() -> str | None:
            for page in pages:
                want = terms_for(page, terms)
                html_page = page[: -len(".md")] + ".html"
                text = read(docs / html_page)
                if text is None:
                    return f"{html_page} was not written"
                head = html_head(text)
                if not head:
                    return f"{html_page} has no page head"
                if not want:
                    if LINE_LABEL in text:
                        return f"{html_page} has the terms line and names no term"
                    continue
                if text.count(LINE_LABEL) != 1:
                    return f"{html_page} prints the terms line {text.count(LINE_LABEL)} times, expected 1"
                paragraph = re.search(r"<p\b[^>]*>\s*" + re.escape(LINE_LABEL) + r".*?</p>", head, re.S)
                if not paragraph:
                    return f"{html_page}: the terms line is not a paragraph in the page head"
                use_when = re.search(r'<p class="page-use-when">.*?</p>', head, re.S)
                if not use_when:
                    return f"{html_page} has no use-when line to sit under"
                if head[use_when.end() : paragraph.start()].strip():
                    return f"{html_page}: the terms line is not directly under the use-when line"
                links = [
                    (re.sub(r"<[^>]+>", "", t).strip(), h)
                    for h, t in re.findall(r'<a\b[^>]*\bhref="([^"]+)"[^>]*>(.*?)</a>', paragraph.group(0), re.S)
                ]
                reason = check_links(html_page, "HTML", links, want)
                if reason:
                    return reason
            return None

        check("every page that names terms prints the line in HTML, and no other does", html_view)

        def runs_in_ci() -> str | None:
            ci = read(CI_FILE)
            if ci is None or "test-orientation-terms.py" not in ci:
                return "test.yml has no step that runs test-orientation-terms.py"
            return None

        check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE O6 RED: {FAILURES[0][:230]}")
        return 1
    emit("GATE O6 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
