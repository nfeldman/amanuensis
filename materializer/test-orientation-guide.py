#!/usr/bin/env python3
"""Gate for orientation packet O3 — the guide's new shape and Terms
(design/orientation/PLAN.md §2.1, §2.6, §3, §4 O3, Appendix A, Appendix C).

Turns red when:

  - the guide's H2 sections are not, in order, What this site is, Pages on this
    site, [How a survey works], Terms, [How IDs are formed], Status values,
    Full vocabulary (the two bracketed sections are absent until O4 and O5, and
    must sit in their slot once present);
  - the guide's title (Markdown H1, HTML h1, HTML <title>) is not "How to read
    this survey", or any of them says "conspectus" (D2);
  - the first 600 bytes of the guide's Markdown contain a backtick;
  - "What this site is" is not Appendix C's paragraph for the project;
  - the Terms section lacks a `###` per `reader_terms` entry in contract order,
    an `<a id="term-<slug>">` anchor per entry (Markdown), a matching id in the
    HTML, the entry's definition, an "Also called:" line with every alias, or a
    "Seen on:" line whose links are not exactly the pages the entry names (a
    glob stands for its listing page); or lacks Conspectus or Mapped (D2, D3);
  - an enum whose `reader_facing` is false is named before the "Full
    vocabulary" heading, or a reader-facing enum is not under "Status values"
    with a plain heading and its stored name in a code span; the plain heading
    is the enum's contract `title`, which every reader-facing enum must carry
    and which must not be its stored name's words ("Field note category");
  - the HTML puts a non-reader-facing enum outside a closed `<details>` with a
    `<summary>`, or a reader-facing enum inside it, or an enum table is
    missing in either view;
  - the HTML Terms or Status values differ from the Markdown's (an HTML guide
    that drops them is red while the Markdown is whole), or an enum table's
    HTML Value cell is anything but the stored value as literal code (a status
    chip would print another enum's label there);
  - reader-lenses spec §7.8 does not point to design/orientation/PLAN.md;
  - the gate does not run in CI.

Also red when a published HTML page hides its report from assistive technology
(`orientation_exposure.hidden_pages`: `aria-hidden="true"`, `hidden`, `inert`,
an inline `display: none` or `role="presentation"` on `<main>`, the page head,
the article or any element around them), which every text check above reads
straight through.

False green it cannot exclude: the fixture is small, so a Terms section that
only breaks at AxiomDB's size is exercised by count, not by reading. The HTML
checks read bytes; they do not drive a browser.

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

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
CONTRACT = REPO / "mcp-server" / "contracts" / "conspectus-vocabulary.json"
SPEC = REPO / "design" / "reader-lenses" / "spec.md"
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
TITLE = "How to read this survey"
H2_ORDER = (
    "What this site is",
    "Pages on this site",
    "How a survey works",
    "Terms",
    "How IDs are formed",
    "Status values",
    "Full vocabulary",
)
OPTIONAL_H2 = ("How a survey works", "How IDs are formed")  # absent until O4 and O5
SITE_PARAGRAPH = (
    "This site is the record of an AI agent's survey of {name}. The agent read the code,"
    " recorded what it concluded and the code each conclusion rests on, and listed what it"
    " could not settle. It does not change the code. Every page is as of one commit, shown"
    " at the top of each HTML page as *Checked* and in the overview's *Checked at* row."
)
# A glob in a term's `pages` stands for the page that lists the family.
FAMILY_LISTING = {"subsystems/*.md": "master-plan.md", "diagnosticity/*.md": "diagnosticity.md"}
BYTES_WITHOUT_CODE = 600
REQUIRED_TERMS = ("Conspectus", "Mapped")

SHA = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"
SUBSYSTEMS = (
    ("B-01", "Read path", "mapped", "backend", "src/reader.ts", None, None),
    ("F-01", "Console", "scoping", "frontend", "ui/console.ts", None, None),
)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


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
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('o3', 'fixture')")
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        list(SUBSYSTEMS),
    )
    cur.execute(
        "INSERT INTO diagnosticity_sessions (id, subsystem_id, symptom, outcome, session_id)"
        " VALUES (7, 'B-01', 'rows appear twice after a restart', 'open', 'o3')"
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
LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def md_sections(text: str) -> list[tuple[str, list[str]]]:
    """(H2 title, its lines) in page order."""

    out: list[tuple[str, list[str]]] = []
    for line in text.splitlines():
        if line.startswith("## "):
            out.append((line[3:].strip(), []))
        elif out:
            out[-1][1].append(line)
    return out


def md_blocks(lines: list[str]) -> list[tuple[str, list[str]]]:
    """(H3 title, its lines) inside one H2 section; lines before the first H3 are dropped."""

    out: list[tuple[str, list[str]]] = []
    for line in lines:
        if line.startswith("### "):
            out.append((line[4:].strip(), []))
        elif out:
            out[-1][1].append(line)
    return out


def md_visible(text: str) -> str:
    text = LINK.sub(r"\1", text)
    return re.sub(r"\*\*(.+?)\*\*|\*(.+?)\*|`([^`]*)`", lambda m: m.group(1) or m.group(2) or m.group(3) or "", text)


def html_text(fragment: str) -> str:
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", "", fragment)).split())


def html_h2_spans(text: str) -> list[tuple[str, int, int]]:
    """(title, start, end) of each `<h2>` and the markup up to the next one."""

    heads = list(re.finditer(r"<h2\b[^>]*>(.*?)</h2>", text, re.S))
    out: list[tuple[str, int, int]] = []
    for index, match in enumerate(heads):
        end = heads[index + 1].start() if index + 1 < len(heads) else len(text)
        title = html_text(match.group(1)).lstrip("§").strip()
        out.append((title, match.end(), end))
    return out


def html_h3_blocks(fragment: str) -> list[tuple[str, str]]:
    """(H3 title, markup up to the next h3) inside a fragment."""

    heads = list(re.finditer(r"<h3\b[^>]*>(.*?)</h3>", fragment, re.S))
    out: list[tuple[str, str]] = []
    for index, match in enumerate(heads):
        end = heads[index + 1].start() if index + 1 < len(heads) else len(fragment)
        out.append((html_text(match.group(1)).lstrip("§").strip(), fragment[match.end() : end]))
    return out


def load_contract() -> dict[str, Any]:
    return json.loads(CONTRACT.read_text())


def stored_name_words(name: str) -> str:
    return name.replace("_", " ").capitalize()


def enum_title(name: str) -> str:
    """The heading an enum's table must carry: its contract `title` (PLAN §2.1's
    plain name), read from the contract rather than recomputed from the stored
    name. An enum with no title (only the non-reader-facing ones may lack one)
    falls back to its stored name's words."""

    try:
        title = load_contract()["enums"][name].get("title")
    except (OSError, KeyError, ValueError):
        title = None
    return title if isinstance(title, str) and title.strip() else stored_name_words(name)


def expected_targets(pages: list[str], docs: Path) -> set[str]:
    """The pages a term names that this store published; the rest cannot be linked."""

    return {t for t in (FAMILY_LISTING.get(page, page) for page in pages) if (docs / t).is_file()}


def main() -> int:
    emit("GATE O3 — the guide's new shape and Terms")
    emit("")

    contract: dict[str, Any] = {}
    try:
        contract = load_contract()
    except Exception as exc:
        FAILURES.append(f"contract: could not read the vocabulary contract — {scrub(repr(exc))}")
        emit(f"  FAIL contract: could not read the vocabulary contract — {scrub(repr(exc))}")
    terms: list[dict[str, Any]] = list(contract.get("reader_terms") or [])
    enums: dict[str, Any] = dict(contract.get("enums") or {})

    with tempfile.TemporaryDirectory(prefix="o3-gate-") as tmp:
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
        md = read(docs / "how-to-read.md") or ""
        full_page = read(docs / "how-to-read.html") or ""
        article = re.search(r"<article\b.*?</article>", full_page, re.S)
        page = article.group(0) if article else full_page

        def published() -> str | None:
            if not summary or summary.get("_returncode") != 0 or summary.get("ok") is False:
                return f"the materializer did not publish the fixture — {summary.get('_diagnostic', summary)}"
            if not md:
                return "docs/how-to-read.md was not written"
            if not full_page:
                return "docs/how-to-read.html was not written"
            return None

        check("the fixture publishes", published)

        sections = md_sections(md)
        by_title = dict(sections)

        # -- title (D2) --------------------------------------------------
        def title_says_survey() -> str | None:
            h1 = re.search(r"^# (.+)$", md, re.M)
            if not h1 or h1.group(1).strip() != TITLE:
                return f"the Markdown H1 is {h1.group(1).strip() if h1 else 'absent'!r}, not {TITLE!r}"
            html_h1 = re.search(r"<h1\b[^>]*>(.*?)</h1>", full_page, re.S)
            if not html_h1 or html_text(html_h1.group(1)) != TITLE:
                return f"the HTML h1 is {html_text(html_h1.group(1)) if html_h1 else 'absent'!r}, not {TITLE!r}"
            doc_title = re.search(r"<title>(.*?)</title>", full_page, re.S)
            if not doc_title or TITLE not in html_text(doc_title.group(1)):
                return f"the HTML <title> is {html_text(doc_title.group(1)) if doc_title else 'absent'!r}"
            if "conspectus" in html_text(doc_title.group(1)).lower():
                return "the HTML <title> says 'conspectus' (D2)"
            return None

        check("the guide is titled 'How to read this survey', not 'conspectus' (D2)", title_says_survey)

        # -- nothing raw at the top ------------------------------------
        def no_backtick_up_top() -> str | None:
            head = md.encode("utf-8")[:BYTES_WITHOUT_CODE].decode("utf-8", "ignore")
            if "`" in head:
                at = head.index("`")
                return f"a backtick sits at byte {at}, near {head[max(0, at - 30) : at + 30]!r}"
            if len(md.encode("utf-8")) < BYTES_WITHOUT_CODE:
                return "the guide is shorter than 600 bytes"
            return None

        check("the first 600 bytes of the guide carry no backtick", no_backtick_up_top)

        # -- section order ------------------------------------------------
        def h2_order() -> str | None:
            found = [title for title, _ in sections]
            core = [t for t in found if t not in OPTIONAL_H2]
            want_core = [t for t in H2_ORDER if t not in OPTIONAL_H2]
            if core != want_core:
                return f"H2 sections are {found}, expected {want_core} in that order (plus the two later ones in their slots)"
            kept = [t for t in H2_ORDER if t in found]
            if found != kept:
                return f"H2 sections are {found}; the later sections sit out of order, expected {kept}"
            return None

        check("the H2 order is site, pages, [survey], Terms, [IDs], Status values, Full vocabulary", h2_order)

        def html_h2_order() -> str | None:
            spans = [title for title, _, _ in html_h2_spans(page)]
            want = [title for title, _ in sections]
            if spans != want:
                return f"HTML h2 sections are {spans}, the Markdown's are {want}"
            return None

        check("the HTML guide has the Markdown's sections in the same order", html_h2_order)

        # -- What this site is -------------------------------------------
        def site_paragraph() -> str | None:
            lines = by_title.get("What this site is")
            if lines is None:
                return "no 'What this site is' section"
            paragraph = " ".join(line.strip() for line in "\n".join(lines).strip().split("\n\n")[0].splitlines())
            match = re.fullmatch(re.escape(SITE_PARAGRAPH).replace(re.escape("{name}"), r"(.+?)"), paragraph)
            if not match:
                return f"the first paragraph is {paragraph[:160]!r}, not Appendix C's"
            if not match.group(1).strip():
                return "the paragraph names no project"
            return None

        check("'What this site is' is Appendix C's paragraph, naming the project", site_paragraph)

        def checked_where_promised() -> str | None:
            # The paragraph names where the commit is shown; each place must show it.
            # A Markdown page carries no Checked line at its top, so the sentence
            # may not promise one there.
            html_pages = sorted(docs.rglob("*.html"))
            if not html_pages:
                return "the fixture published no HTML pages"
            for path in html_pages:
                text = read(path) or ""
                if not re.search(r'<span class="snapshot-item"><b>Checked</b>', text):
                    return f"{path.relative_to(docs)} shows no Checked commit at the top"
            index_md = read(docs / "index.md") or ""
            if not re.search(r"^\| Checked at \| \S", index_md, re.M):
                return "index.md has no 'Checked at' row"
            bare = [
                str(path.relative_to(docs))
                for path in sorted(docs.rglob("*.md"))
                if not re.search(r"^\*?\*?Checked\b", (read(path) or "").split("\n## ", 1)[0], re.M)
            ]
            if bare and "at the top as *Checked*." in md:
                return f"the guide says every page shows Checked at the top; {bare[0]} and {len(bare) - 1} other Markdown pages do not"
            return None

        check("the guide's 'Checked' promise holds where it says, in both views", checked_where_promised)

        # -- Terms ---------------------------------------------------------
        terms_lines = by_title.get("Terms", [])
        blocks = md_blocks(terms_lines)

        def every_term_is_a_block() -> str | None:
            if not terms:
                return "the contract carries no reader_terms"
            if not blocks:
                return "the Terms section has no ### entries"
            want = [t["term"] for t in terms]
            got = [title for title, _ in blocks]
            if got != want:
                return f"Terms entries are {got[:6]}…, the contract's are {want[:6]}… (count {len(got)} vs {len(want)}, order matters)"
            return None

        check("Terms has one ### entry per reader_terms entry, in contract order", every_term_is_a_block)

        def required_terms() -> str | None:
            got = {title for title, _ in blocks}
            missing = [t for t in REQUIRED_TERMS if t not in got]
            return f"Terms lacks {missing} (D2, D3)" if missing else None

        check("Terms defines Conspectus and Mapped (D2, D3)", required_terms)

        def term_anchors() -> str | None:
            anchors = re.findall(r'<a id="(term-[^"]+)"></a>', "\n".join(terms_lines))
            want = [f"term-{slug(t['term'])}" for t in terms]
            if anchors != want:
                missing = [a for a in want if a not in anchors]
                return f"anchors differ from term-<slug> per entry; missing {missing[:4]}, found {len(anchors)} of {len(want)}"
            if len(set(want)) != len(want):
                return "two terms share one anchor"
            # The anchor must directly precede its own heading.
            for term in terms:
                needle = f'<a id="term-{slug(term["term"])}"></a>\n\n### {term["term"]}\n'
                if needle not in "\n".join(terms_lines) + "\n":
                    return f"the anchor for {term['term']!r} is not directly above its heading"
            return None

        check("each term has an <a id=\"term-<slug>\"> anchor directly above its heading", term_anchors)

        def term_bodies() -> str | None:
            by_block = dict(blocks)
            for term in terms:
                body = "\n".join(by_block.get(term["term"], []))
                visible = md_visible(body)
                if str(term["definition"]) not in visible:
                    return f"{term['term']!r} does not carry its definition"
                aliases = [str(a) for a in term.get("aliases") or []]
                alias_lines = [ln for ln in body.splitlines() if ln.strip().startswith("*Also called:")]
                if aliases:
                    if len(alias_lines) != 1:
                        return f"{term['term']!r} has {len(alias_lines)} 'Also called:' lines, wanted one"
                    for alias in aliases:
                        if alias not in alias_lines[0]:
                            return f"{term['term']!r}: the alias {alias!r} is not on its 'Also called:' line"
                elif alias_lines:
                    return f"{term['term']!r} has no aliases but prints an 'Also called:' line"
                seen = [ln for ln in body.splitlines() if ln.strip().startswith("Seen on:")]
                pages = [str(p) for p in term.get("pages") or []]
                if expected_targets(pages, docs):
                    if len(seen) != 1:
                        return f"{term['term']!r} has {len(seen)} 'Seen on:' lines, wanted one"
                    targets = {m.group(2) for m in LINK.finditer(seen[0])}
                    want = expected_targets(pages, docs)
                    if targets != want:
                        return f"{term['term']!r} 'Seen on:' links {sorted(targets)}, wanted {sorted(want)}"
                    for target in targets:
                        if not (docs / target).is_file():
                            return f"{term['term']!r} links {target}, which is not published"
                elif seen:
                    return f"{term['term']!r} names no published page but prints 'Seen on:'"
            return None

        check("each term carries its definition, aliases on one line, and Seen on: links to its pages", term_bodies)

        def html_terms() -> str | None:
            spans = {title: (start, end) for title, start, end in html_h2_spans(page)}
            if "Terms" not in spans:
                return "the HTML has no Terms section"
            fragment = page[spans["Terms"][0] : spans["Terms"][1]]
            for term in terms:
                tid = f"term-{slug(term['term'])}"
                if not re.search(rf'id="{re.escape(tid)}"', fragment):
                    return f"the HTML has no id={tid!r} in Terms"
            text = html_text(fragment)
            by_block = {title: html_text(body) for title, body in html_h3_blocks(fragment)}
            for term in terms:
                body = by_block.get(term["term"])
                if body is None:
                    return f"the HTML Terms has no heading for {term['term']!r}"
                if str(term["definition"]) not in body:
                    return f"the HTML entry for {term['term']!r} lacks its definition"
                for alias in term.get("aliases") or []:
                    if alias not in body:
                        return f"the HTML entry for {term['term']!r} lacks the alias {alias!r}"
            hrefs = set(re.findall(r'href="([^"#]+)\.html"', fragment))
            for term in terms:
                for target in expected_targets([str(p) for p in term.get("pages") or []], docs):
                    if target[:-3] not in hrefs:
                        return f"the HTML Terms carries no link to {target[:-3]}.html"
            if "Seen on" not in text:
                return "the HTML Terms prints no 'Seen on' line"
            return None

        check("the HTML Terms carries each term's id, definition, aliases and links", html_terms)

        # -- enums ---------------------------------------------------------
        def locate_enums() -> tuple[dict[str, str], str | None]:
            """enum -> the H2 section whose ### heading names it."""

            where: dict[str, str] = {}
            for title, lines in sections:
                for heading, _ in md_blocks(lines):
                    for name in enums:
                        if heading == enum_title(name):
                            where[name] = title
            return where, None

        where, _ = locate_enums()

        def plain_titles() -> str | None:
            # PLAN §2.1, §1.1: a reader-facing table is headed by a plain name,
            # not its stored name's words ("Field note category", "Subsystem
            # status"); the stored name follows in small type.
            bad = [
                name
                for name, definition in enums.items()
                if definition.get("reader_facing")
                and (
                    not isinstance(definition.get("title"), str)
                    or not definition["title"].strip()
                    or definition["title"].strip().lower() == stored_name_words(name).lower()
                )
            ]
            return f"reader-facing enums headed by their stored name, with no plain contract title: {bad}" if bad else None

        check("each reader-facing enum has a plain title in the contract, not its stored name", plain_titles)

        def enum_placement() -> str | None:
            if not enums:
                return "the contract carries no enums"
            for name, definition in enums.items():
                flag = definition.get("reader_facing")
                if flag is None:
                    return f"the contract's {name} has no reader_facing flag"
                want = "Status values" if flag else "Full vocabulary"
                got = where.get(name)
                if got != want:
                    return f"{name} (reader_facing={flag}) sits under {got!r}, expected {want!r}"
            # A stored name of a non-reader-facing enum must not appear before the heading.
            order = [title for title, _ in sections]
            if "Full vocabulary" not in order:
                return "no 'Full vocabulary' section"
            before = "\n".join("\n".join(lines) for title, lines in sections if order.index(title) < order.index("Full vocabulary"))
            for name, definition in enums.items():
                if not definition.get("reader_facing") and f"`{name}`" in before:
                    return f"the stored name `{name}` of a non-reader-facing enum appears before 'Full vocabulary'"
            return None

        check("reader-facing enums are under Status values, the rest only under Full vocabulary", enum_placement)

        def enum_headings() -> str | None:
            for title in ("Status values", "Full vocabulary"):
                for heading, lines in md_blocks(by_title.get(title, [])):
                    name = next((n for n in enums if enum_title(n) == heading), None)
                    if name is None:
                        return f"{title} has the heading {heading!r}, which names no enum"
                    body = "\n".join(lines)
                    if f"`{name}`" not in body:
                        return f"{heading!r} does not print its stored name {name!r} in a code span"
                    rows = [ln for ln in lines if ln.startswith("|")]
                    values = enums[name].get("values") or []
                    if len(rows) != len(values) + 2:
                        return f"{heading!r} has {len(rows) - 2} rows for {len(values)} values"
            return None

        check("each enum table has a plain heading, its stored name in a code span, and a row per value", enum_headings)

        def enum_cells() -> str | None:
            # Each row must carry its own value's label, meaning and limit, in
            # contract order, in both views: a row count cannot see a label
            # moved onto the wrong value.
            def expected(entry: dict[str, Any]) -> list[str]:
                return [
                    " ".join(str(entry[key]).split()).replace("|", "/")
                    for key in ("value", "label", "meaning", "cannot_justify")
                ]

            html_blocks = dict(html_h3_blocks(page))
            for name, definition in enums.items():
                title = enum_title(name)
                lines = next(
                    (
                        body
                        for section in ("Status values", "Full vocabulary")
                        for heading, body in md_blocks(by_title.get(section, []))
                        if heading == title
                    ),
                    None,
                )
                if lines is None:
                    return f"the Markdown guide has no table for {name}"
                rows = [ln for ln in lines if ln.startswith("|")][2:]
                block = html_blocks.get(title)
                if block is None:
                    return f"the HTML guide has no table for {name}"
                body = block.split("</tbody>")[0].split("<tbody>")[-1]
                raw_rows = [
                    re.findall(r"<td\b[^>]*>(.*?)</td>", tr, re.S)
                    for tr in re.findall(r"<tr\b[^>]*>(.*?)</tr>", body, re.S)
                ]
                html_rows = [[html_text(c) for c in cells] for cells in raw_rows]
                values = list(definition.get("values") or [])
                if len(rows) != len(values) or len(html_rows) != len(values):
                    return f"{name} has {len(rows)} Markdown and {len(html_rows)} HTML rows for {len(values)} values"
                for index, entry in enumerate(values):
                    want = expected(entry)
                    got = [md_visible(c).strip() for c in rows[index].strip().strip("|").split(" | ")]
                    if got != want:
                        return f"{name} row {index + 1} reads {got!r} in Markdown, the contract says {want!r}"
                    # The Value column is the stored value, printed literally. A
                    # chip would print some enum's label in its place (pass_type's
                    # `adversarial` as subsystem_status's "Challenging claims").
                    if html_rows[index] != want:
                        return f"{name} row {index + 1} reads {html_rows[index]!r} in HTML, the contract says {want!r}"
                    literal = f"<code>{htmllib.escape(want[0], quote=False)}</code>"
                    if raw_rows[index][0].strip() != literal:
                        return f"{name} row {index + 1}: the HTML Value cell is {raw_rows[index][0].strip()[:80]!r}, not {literal!r}"
            return None

        check("each enum row carries its own value's label, meaning and limit, in both views", enum_cells)

        def html_disclosure() -> str | None:
            spans = {title: (start, end) for title, start, end in html_h2_spans(page)}
            if "Full vocabulary" not in spans or "Status values" not in spans:
                return "the HTML lacks a Status values or Full vocabulary section"
            status = page[spans["Status values"][0] : spans["Status values"][1]]
            full = page[spans["Full vocabulary"][0] : spans["Full vocabulary"][1]]
            if "<details" in status:
                return "Status values sits inside a <details>"
            opened = re.findall(r"<details\b([^>]*)>", full)
            if len(opened) != 1:
                return f"Full vocabulary has {len(opened)} <details> elements, wanted one"
            if re.search(r"\bopen\b", opened[0]):
                return "the Full vocabulary <details> is open, not closed"
            if "<summary" not in full or "</details>" not in full:
                return "the Full vocabulary <details> has no <summary> or is not closed"
            inside = full[full.index("<details") : full.index("</details>")]
            outside = full[: full.index("<details")] + full[full.index("</details>") :]
            status_names = {n: enum_title(n) for n, d in enums.items() if d.get("reader_facing")}
            hidden_names = {n: enum_title(n) for n, d in enums.items() if not d.get("reader_facing")}
            inside_h3 = [t for t, _ in html_h3_blocks(inside)]
            for name, title in hidden_names.items():
                if title not in inside_h3:
                    return f"the HTML <details> does not hold the table for {name}"
            if [t for t, _ in html_h3_blocks(outside) if t in hidden_names.values()]:
                return "a non-reader-facing table sits outside the <details>"
            status_h3 = [t for t, _ in html_h3_blocks(status)]
            for name, title in status_names.items():
                if title not in status_h3:
                    return f"the HTML Status values lacks the table for {name}"
                if title in inside_h3:
                    return f"reader-facing {name} is inside the closed <details>"
            # A value that is also a status prints as a chip, so count rows
            # rather than looking for each label's text.
            for name, definition in enums.items():
                block = next(
                    (body for part in (status, full) for t, body in html_h3_blocks(part) if t == enum_title(name)),
                    None,
                )
                if block is None:
                    return f"the HTML has no table for {name}"
                rows = len(re.findall(r"<tr>", block.split("</tbody>")[0].split("<tbody>")[-1]))
                if rows != len(definition.get("values") or []):
                    return f"the HTML table for {name} has {rows} rows for {len(definition.get('values') or [])} values"
            return None

        check("the HTML shows reader-facing tables openly and the rest in a closed <details>", html_disclosure)

        # -- spec §7.8 -----------------------------------------------------
        def spec_note() -> str | None:
            spec = read(SPEC)
            if spec is None:
                return "design/reader-lenses/spec.md is unreadable"
            match = re.search(r"^### 7\.8 .*?(?=^### |^## )", spec, re.M | re.S)
            if not match:
                return "spec §7.8 was not found"
            if "design/orientation/PLAN.md" not in match.group(0):
                return "spec §7.8 does not point to design/orientation/PLAN.md"
            if "one table per enum" not in match.group(0):
                return "spec §7.8 lost its original sentence"
            return None

        check("reader-lenses spec §7.8 points to the orientation plan", spec_note)
        check("no published page hides its report from assistive technology", lambda: hidden_pages(docs))

        # -- CI ----------------------------------------------------------
        def runs_in_ci() -> str | None:
            ci = read(CI_FILE)
            if ci is None or "test-orientation-guide.py" not in ci:
                return "test.yml has no step that runs test-orientation-guide.py"
            return None

        check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE O3 RED: {FAILURES[0][:230]}")
        return 1
    emit("GATE O3 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
