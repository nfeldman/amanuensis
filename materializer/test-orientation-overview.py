#!/usr/bin/env python3
"""Gate for the two-part overview (owner, 2026-11-26; first orientation packet O9).

The overview says what the codebase is and what its parts are, and nothing
else. The survey's own bookkeeping is on a back page, About this survey, and
each page's provenance (branch, commit, freshness, how it was rendered) is in
its footer.

Turns red when:

  - the overview's H2 sections are not exactly "What <codebase> is" and "Its
    parts", or the first does not carry the recorded purpose;
  - "Its parts" does not list every subsystem once, under its layer, linked to
    its page; or a part's line is not its name followed by the first sentence
    of its recorded purpose, cut at a colon, without repeating the name; or a
    part with no purpose recorded carries anything but its name;
  - the overview carries any of the survey's bookkeeping (the old status
    sections, the lens routes, the method's identity sentence) or a digit;
  - its closing line does not link the Reader's guide and About this survey,
    or either page is not published;
  - About this survey is not the last page of the Method group, or lacks the
    bookkeeping sections the overview gave up;
  - a page's snapshot strip sits in its head rather than its footer;
  - the gate does not run in CI.

Also red when a published HTML page hides its report from assistive technology
(`orientation_exposure.hidden_pages`).

False green it cannot exclude: the HTML checks read bytes; they do not drive a
browser, so a stylesheet that hid the footer or the parts list would pass.

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
# What the owner fixed, written out here rather than imported, so that
# rewriting an implementation string cannot also rewrite what this gate expects.
# ---------------------------------------------------------------------------
PROJECT = "Fixture Repo"
PURPOSE = "Fixture Repo keeps a ledger of records and serves them to readers."
B01_PURPOSE = (
    "B-01 (Read path) reads every record by key: it opens the store, checks the key"
    " and returns the row. It never writes."
)
B01_LINE = "Read path reads every record by key."
EXPECTED_H2 = (f"What {PROJECT} is", "Its parts")
LAYER_HEADINGS = ("Backend", "Frontend")
GUIDE_LINK = ("Reader's guide", "how-to-read.html")
ABOUT_LINK = ("About this survey", "about.html")
ABOUT_H2 = ("Where the record stands", "Findings by resolution state", "Latest session")
BOOKKEEPING = (
    "Where the record stands",
    "Source alignment",
    "Survey coverage",
    "Open engineering work",
    "Publication integrity",
    "Findings by resolution state",
    "The four lenses",
    "Latest session",
    "An agent running Amanuensis",
    "Amanuensis",
)
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
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('o9', 'fixture')")
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        list(SUBSYSTEMS),
    )
    cur.execute(
        "INSERT INTO evidence (file_path, line_range, ref_sha, kind, excerpt, session_id)"
        " VALUES ('src/reader.ts', '1-1', ?, 'code-verified', 'export function read() {}', 'o9')",
        (SHA,),
    )
    evidence_id = cur.lastrowid
    for subject_type, sid, body in (("project", "project", PURPOSE), ("subsystem", "B-01", B01_PURPOSE)):
        cur.execute(
            "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
            " ref_sha, session_id) VALUES (?, ?, 'purpose', 'recorded', ?, ?, 'o9')",
            (subject_type, sid, body, SHA),
        )
        cur.execute(
            "INSERT INTO explanation_evidence (explanation_id, evidence_id) VALUES (?, ?)",
            (cur.lastrowid, evidence_id),
        )
    # The pages read the imports the store holds, never a file in storage.
    import_onboarding(
        db,
        session_id="o9",
        entry_point="# Where to begin\n\nStart at the reader.\n",
        onboarding_report=f"# Onboarding\n\n**Codebase**: {PROJECT} — one repository.\n",
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


def html_section(text: str, title: str) -> str:
    heads = list(re.finditer(r"<h2\b[^>]*>(.*?)</h2>", text, re.S))
    for index, match in enumerate(heads):
        if html_text(match.group(1)).lstrip("§").strip() == title:
            end = heads[index + 1].start() if index + 1 < len(heads) else len(text)
            return text[match.end() : end]
    return ""


def html_h2_titles(text: str) -> list[str]:
    return [html_text(m.group(1)).lstrip("§").strip() for m in re.finditer(r"<h2\b[^>]*>(.*?)</h2>", text, re.S)]


def href_pages(fragment: str) -> list[str]:
    return [h.split("#", 1)[0] for h in re.findall(r'href="([^"]+)"', fragment)]


def anchors(fragment: str) -> list[tuple[str, str]]:
    """(visible text, target page) per link."""

    return [
        (html_text(inner), href.split("#", 1)[0])
        for href, inner in re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', fragment, re.S)
    ]


def nav_group(text: str, group: str) -> list[str]:
    """The labels of one navigation group, in order."""

    for section in re.findall(r'<section class="nav-group">(.*?)</section>', text, re.S):
        title = re.search(r'<h2 class="nav-group-title"[^>]*>(.*?)</h2>', section, re.S)
        if title and html_text(title.group(1)) == group:
            return [html_text(m) for m in re.findall(r"<a\b[^>]*>(.*?)</a>", section, re.S)]
    return []


# ---------------------------------------------------------------------------
def main() -> int:
    emit("GATE O9 — the two-part overview")
    emit("")

    with tempfile.TemporaryDirectory(prefix="o9-gate-") as tmpdir:
        storage = Path(tmpdir) / "store"
        storage.mkdir()
        summary: dict[str, Any]
        try:
            seed(storage)
            summary = publish(storage)
        except Exception as exc:
            summary = {"_returncode": 1, "_diagnostic": f"could not seed a store — {scrub(repr(exc))}"}
        docs = storage / "docs"
        full_html = read(docs / "index.html") or ""
        article = re.search(r"<article\b.*?</article>", full_html, re.S)
        page = article.group(0) if article else full_html
        about_html = read(docs / "about.html") or ""

        def published() -> str | None:
            if summary.get("_returncode") != 0 or not summary.get("ok"):
                return f"the materializer did not publish a fixture store — {summary.get('_diagnostic', 'no summary')}"
            if not page.strip():
                return "docs/index.html was not published"
            return None

        check("a fixture store publishes its overview", published)

        def two_sections() -> str | None:
            got = tuple(html_h2_titles(page))
            return None if got == EXPECTED_H2 else f"the overview's H2 sections are {list(got)!r}, not {list(EXPECTED_H2)!r}"

        check("the overview has two sections: what the codebase is, and its parts", two_sections)

        def purpose_first() -> str | None:
            body = html_text(html_section(page, EXPECTED_H2[0]))
            return None if PURPOSE in body else f"the first section reads {body[:160]!r}, not the recorded purpose"

        check("the first section is the recorded purpose", purpose_first)

        parts = html_section(page, EXPECTED_H2[1])
        items = [html_text(li) for li in re.findall(r"<li\b[^>]*>(.*?)</li>", parts, re.S)]

        def every_part_once() -> str | None:
            links = anchors(parts)
            wanted = {name: f"subsystems/{sid.lower().replace('-', '')}-{name.lower().replace(' ', '-')}.html" for sid, name, *_ in SUBSYSTEMS}
            if len(items) != len(SUBSYSTEMS):
                return f"Its parts lists {len(items)} items for {len(SUBSYSTEMS)} subsystems: {items!r}"
            for name, target in wanted.items():
                hits = [href for text, href in links if text == name]
                if hits != [target]:
                    return f"{name!r} is linked {hits!r}, not once to {target}"
            heads = [html_text(h) for h in re.findall(r"<h3\b[^>]*>(.*?)</h3>", parts, re.S)]
            if tuple(h.lstrip("§").strip() for h in heads) != LAYER_HEADINGS:
                return f"the layer headings are {heads!r}, not {list(LAYER_HEADINGS)!r}"
            return None

        check("Its parts lists every subsystem once, under its layer, linked to its page", every_part_once)

        def part_lines() -> str | None:
            if B01_LINE not in items:
                return f"the Read path line is not {B01_LINE!r}: {items!r}"
            if "Console" not in items:
                return f"a part with no purpose recorded carries more than its name: {items!r}"
            return None

        check("a part reads its name and its purpose's gist; a part with none, its name", part_lines)

        def no_bookkeeping() -> str | None:
            text = html_text(page)
            for words in BOOKKEEPING:
                if words in text:
                    return f"the overview still carries {words!r}"
            digits = re.findall(r"\d", text)
            if digits:
                return f"the overview prints a digit: {text[:200]!r}"
            return None

        check("the overview carries no bookkeeping and no figure", no_bookkeeping)

        def closing_line() -> str | None:
            links = anchors(page)
            for text, target in (GUIDE_LINK, ABOUT_LINK):
                if (text, target) not in links:
                    return f"the overview does not link {text!r} -> {target}: {links!r}"
                if not (docs / target).is_file():
                    return f"{target} is not published"
            return None

        check("the closing line links the Reader's guide and About this survey", closing_line)

        def about_page() -> str | None:
            if not about_html:
                return "about.html was not published"
            method = nav_group(full_html, "Method")
            if not method or method[-1] != ABOUT_LINK[0]:
                return f"the Method group ends {method[-3:]!r}, not with {ABOUT_LINK[0]!r}"
            article = re.search(r"<article\b.*?</article>", about_html, re.S)
            got = html_h2_titles(article.group(0) if article else "")
            missing = [h for h in ABOUT_H2 if h not in got]
            return f"About this survey lacks {missing!r}; it has {got!r}" if missing else None

        check("About this survey ends the Method group and carries the bookkeeping", about_page)

        def strip_in_footer() -> str | None:
            pages = sorted(docs.rglob("*.html"))
            if not pages:
                return "no HTML page was published"
            for path in pages:
                text = read(path) or ""
                head = re.search(r'<header class="page-head">(.*?)</header>', text, re.S)
                foot = re.search(r'<footer class="page-foot">(.*?)</footer>', text, re.S)
                if head is None or foot is None:
                    return f"{path.name} has no page head or no page footer"
                if "snapshot-strip" in head.group(1) or "snapshot-strip" not in foot.group(1):
                    return f"{path.name} prints its snapshot strip outside its footer"
            return None

        check("every page prints its provenance in its footer, not its head", strip_in_footer)
        check("no published page hides its report from assistive technology", lambda: hidden_pages(docs))

    def in_ci() -> str | None:
        ci = read(CI_FILE)
        if ci is None:
            return "could not read .github/workflows/test.yml"
        if "python3 test-orientation-overview.py" not in ci:
            return "test.yml has no step running test-orientation-overview.py"
        return None

    check("the gate runs in CI", in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE O9 RED: {FAILURES[0]}")
        return 1
    emit("GATE O9 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
