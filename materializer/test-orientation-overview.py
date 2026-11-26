#!/usr/bin/env python3
"""Gate for orientation packet O9 — the overview's Method route
(design/orientation/PLAN.md §4 O9, §3).

Turns red when:

  - the overview (index.html) has no "The four lenses" section, or the section
    has other than one route per lens;
  - the Method route's visible text does not read "Reader's guide: what
    each page is for, the terms it uses, and how a survey works";
  - the Method route's link text is not "Reader's guide", or the link
    does not point at the guide (how-to-read.html), or the guide it points at is
    not published;
  - the old Method wording ("every recorded state, what it authorizes, and what
    it cannot justify") is still on the overview;
  - anything else on the overview moved: the Codebase, Unresolved and History
    routes differ from their published text or targets, or the overview's H2
    sections are not the expected list in order;
  - the gate does not run in CI.

Also red when a published HTML page hides its report from assistive technology
(`orientation_exposure.hidden_pages`: `aria-hidden="true"`, `hidden`, `inert`,
an inline `display: none` or `role="presentation"` on `<main>`, the page head,
the article or any element around them), which every text check above reads
straight through.

False green it cannot exclude: "nothing else changes" is checked on the lens
routes, the H2 list and the identity paragraph, not byte for byte against the
previous overview. The HTML checks read bytes; they do not drive a browser.

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
# What PLAN.md fixes, written out here rather than imported, so that rewriting
# an implementation string cannot also rewrite what this gate expects.
# ---------------------------------------------------------------------------
SECTION = "The four lenses"
LENSES = ("Codebase", "Unresolved", "History", "Method")
METHOD_LINK_TEXT = "Reader's guide"
METHOD_TEXT = "Reader's guide: what each page is for, the terms it uses, and how a survey works"
OLD_METHOD_WORDS = "every recorded state, what it authorizes, and what it cannot justify"
# The other three routes, as visible text and target, unchanged by O9.
OTHER_ROUTES: dict[str, tuple[str, str, str]] = {
    "Codebase": (
        "Subsystems",
        "master-plan",
        "Subsystems: every region, grouped by layer, with the boundaries and terms recorded for it",
    ),
    "Unresolved": (
        "Open findings",
        "findings",
        "Open findings: defects open or awaiting verification at the checked revision",
    ),
    "History": (
        "Resolved findings",
        "resolved-findings",
        "Resolved findings: the records that reached a terminal state, with the basis each one rests on",
    ),
}
EXPECTED_H2 = (
    "What is this codebase?",
    "Where the record stands",
    "Findings by resolution state",
    "The four lenses",
    "Latest session",
)
PROJECT = "Fixture Repo"
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


def html_route_list(section: str) -> list[tuple[str, str]]:
    """(lens, inner HTML) per <li>, <p> or <tr> that opens with a lens name, duplicates kept."""

    out: list[tuple[str, str]] = []
    for m in re.finditer(r"<(li|p|tr)\b[^>]*>(.*?)</\1>", section, re.S):
        for lens in LENSES:
            if re.match(rf"\s*(<[^>]+>\s*)*{lens}\b", m.group(2)):
                out.append((lens, m.group(2)))
                break
    return out


def html_routes(section: str) -> dict[str, str]:
    """lens -> the inner HTML of the first <li> or <p> that opens with the lens name."""

    out: dict[str, str] = {}
    for lens, raw in html_route_list(section):
        out.setdefault(lens, raw)
    return out


def href_pages(fragment: str) -> list[str]:
    return [h.split("#", 1)[0] for h in re.findall(r'href="([^"]+)"', fragment)]


def strip_dash(text: str) -> str:
    return re.sub(r"^[\s—–:-]+", "", text)


def strip_trailing(text: str) -> str:
    return text.strip().rstrip(".").strip()


# ---------------------------------------------------------------------------
def main() -> int:
    emit("GATE O9 — the overview's Method route")
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

        def published() -> str | None:
            if summary.get("_returncode") != 0 or not summary.get("ok"):
                return f"the materializer did not publish a fixture store — {summary.get('_diagnostic', 'no summary')}"
            if not page.strip():
                return "docs/index.html was not published"
            return None

        check("a fixture store publishes its overview", published)

        html_sec = html_section(page, SECTION)
        html_r = html_routes(html_sec)

        def routes_present() -> str | None:
            if not html_sec.strip():
                return f"index.html has no {SECTION!r} section"
            for lens in LENSES:
                if lens not in html_r:
                    return f"index.html has no {lens} route"
            return None

        check("the overview has a route for each lens", routes_present)

        def one_route_each() -> str | None:
            # Count before the dictionary folds duplicates away.
            names = [lens for lens, _ in html_route_list(html_sec)]
            if names != list(LENSES):
                return f"index.html has the routes {names}, expected one each: {list(LENSES)}"
            return None

        check("the overview has exactly one route per lens, in order", one_route_each)

        def method_text_html() -> str | None:
            raw = html_r.get("Method")
            if raw is None:
                return "index.html has no Method route"
            visible = html_text(raw)
            got = strip_trailing(re.sub(r"^Method\b\s*[—–:-]?\s*", "", visible))
            if got != METHOD_TEXT:
                return f"the HTML Method route reads {got!r}, not {METHOD_TEXT!r}"
            return None

        check("the Method route reads the plan's sentence", method_text_html)

        def method_link_html() -> str | None:
            raw = html_r.get("Method", "")
            anchors = re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', raw, re.S)
            if len(anchors) != 1:
                return f"the HTML Method route carries {len(anchors)} links, expected 1"
            href, inner = anchors[0]
            if html_text(inner) != METHOD_LINK_TEXT:
                return f"the HTML Method link text is {html_text(inner)!r}, not {METHOD_LINK_TEXT!r}"
            if href.split("#", 1)[0] != "how-to-read.html":
                return f"the HTML Method link points at {href!r}, not how-to-read.html"
            if not (docs / "how-to-read.html").is_file():
                return "the guide the Method route links is not published"
            return None

        check("the Method route links the guide", method_link_html)

        def old_wording_gone() -> str | None:
            if OLD_METHOD_WORDS in html_text(page):
                return "index.html still carries the old Method wording"
            return None

        check("the old Method wording is gone", old_wording_gone)

        def others_text_unchanged() -> str | None:
            for lens, (_link_text, _page_stem, want) in OTHER_ROUTES.items():
                hraw = html_r.get(lens)
                if hraw is None:
                    return f"the {lens} route is missing"
                hgot = strip_trailing(re.sub(rf"^{lens}\b\s*[—–:-]?\s*", "", html_text(hraw)))
                if hgot != want:
                    return f"the HTML {lens} route reads {hgot!r}, not {want!r}"
            return None

        def others_links_unchanged() -> str | None:
            for lens, (link_text, page_stem, _want) in OTHER_ROUTES.items():
                hraw = html_r.get(lens)
                if hraw is None:
                    return f"the {lens} route is missing"
                links = re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', hraw, re.S)
                if len(links) != 1 or html_text(links[0][1]) != link_text:
                    return f"the HTML {lens} link is {links!r}, not {link_text!r} -> {page_stem}.html"
                if href_pages(hraw) != [f"{page_stem}.html"]:
                    return f"the HTML {lens} link targets {href_pages(hraw)!r}, not {page_stem}.html"
            return None

        check("the Codebase, Unresolved and History routes read as before", others_text_unchanged)
        check("the Codebase, Unresolved and History routes link their pages as before", others_links_unchanged)

        def sections_unchanged() -> str | None:
            hgot = html_h2_titles(page)
            if tuple(hgot) != EXPECTED_H2:
                return f"the HTML overview's H2 sections are {hgot!r}, not {list(EXPECTED_H2)!r}"
            return None

        check("the overview's sections are unchanged", sections_unchanged)
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
