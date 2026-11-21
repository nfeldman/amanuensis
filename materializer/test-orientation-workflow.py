#!/usr/bin/env python3
"""Gate for orientation packet O4 — how a survey works, and how to answer a decision
(design/orientation/PLAN.md §2.3, §4 O4, §5 D4, Appendix C).

Turns red when:

  - the guide has no "How a survey works" section, or it does not sit between
    "Pages on this site" and "Terms";
  - the section's pass table has a row count different from `survey_passes` in
    the contract, a row whose pass or "what the agent does" cell differs from
    the contract's, a depth label that differs from the contract's
    `subsystem_status` label, a depth meaning that differs from the contract's,
    or a "when" cell that disagrees with the row's `set_when` (D4: "when the
    pass is done" for `end`, "as the pass starts" for `start`);
  - the table is not generated: a copy of the materializer whose contract
    constants carry a changed label, a changed meaning and a flipped `set_when`
    still publishes the old words;
  - the section lacks the subheadings "What it expects from you" and "Phase
    numbers", the first does not say the survey keeps going without the reader,
    points the reader to "Decisions needed" and to telling the agent, says the
    site is read-only, and tells them they can redirect or stop it, or the second does not decode onboarding Phases 0–7 and survey
    Phases 1–5 against every pass name;
  - the HTML guide's table, subheadings and prose differ from the Markdown's, or
    the section's Markdown prints a raw HTML tag outside a code span (such as
    `<file>`, which a CommonMark reader drops);
  - the "Decisions needed" page lacks the line saying to tell the agent in the
    session and that the site is read-only, in Markdown or HTML, with a
    question open or with none;
  - the overview's identity paragraph is not Appendix C's sentence for the
    project, contains a digit or an orientation-forbidden term, does not link
    the guide (Markdown and HTML), or the overview still says "recorded by
    Amanuensis";
  - the gate does not run in CI.

Also red when a published HTML page hides its report from assistive technology
(`orientation_exposure.hidden_pages`: `aria-hidden="true"`, `hidden`, `inert`,
an inline `display: none` or `role="presentation"` on `<main>`, the page head,
the article or any element around them), which every text check above reads
straight through.

False green it cannot exclude: the fixture has one open question and two
subsystems, so a section that only misbehaves at a real store's size is exercised
by count, not by reading. The HTML checks read bytes; they do not drive a browser.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed.
"""

from __future__ import annotations

import html as htmllib
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

from orientation_exposure import hidden_pages
from store_only_seed import import_onboarding

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
# What PLAN.md fixes, written out here rather than imported, so that rewriting
# an implementation string cannot also rewrite what this gate expects.
# ---------------------------------------------------------------------------
SECTION = "How a survey works"
H2_NEIGHBOURS = ("Pages on this site", SECTION, "Terms")
SUBHEADINGS = ("What it expects from you", "Phase numbers")
WHEN_END = "when the pass is done"
WHEN_START = "as the pass starts"
PROJECT = "Fixture Repo"
IDENTITY = (
    f"An architecture survey of {PROJECT}. An AI agent running Amanuensis read the repository,"
    " without changing it, and recorded what it found here. New to this site? Start with"
    " [How to read this survey](how-to-read.md)."
)
IDENTITY_FORBIDDEN_OLD = "recorded by Amanuensis"
# The orientation lint's forbidden terms (vocabulary.ORIENTATION_FORBIDDEN_TERMS).
FORBIDDEN = (
    "stale",
    "fresh",
    "mapped",
    "unmapped",
    "re-anchored",
    "up to date",
    "out of date",
    "current as of",
    "fully surveyed",
)
ANSWER_LINE_PHRASES = ("tell the agent", "read-only")

SHA = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"
SUBSYSTEMS = (
    ("B-01", "Read path", "mapped", "backend", "src/reader.ts", None, None),
    ("F-01", "Console", "scoping", "frontend", "ui/console.ts", None, None),
)


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------
def seed(storage: Path, *, with_question: bool) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-20T12:00:00Z')",
        (SHA, SHA),
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('o4', 'fixture')")
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        list(SUBSYSTEMS),
    )
    if with_question:
        cur.execute(
            "INSERT INTO open_questions (id, subsystem_id, phase, category, question,"
            " what_blocked, what_assumed, session_id)"
            " VALUES (12, 'B-01', 'structural', 'domain-knowledge',"
            " 'Is tenancy per account or per user?', 'The access-control claims',"
            " 'Per account', 'o4')"
        )
    # The pages read the imports the store holds, never a file in storage.
    import_onboarding(
        db,
        session_id="o4",
        entry_point="# Where to begin\n\nStart at the reader.\n",
        onboarding_report=f"# Onboarding\n\n**Codebase**: {PROJECT} — one repository.\n",
        concern_checklist="# Checklist\n\n## Active concerns\n\n- none\n",
    )
    db.commit()
    db.close()


def publish(storage: Path, materializer: Path) -> dict[str, Any]:
    proc = subprocess.run(
        [sys.executable, str(materializer / "materialize.py"), "--storage", str(storage)],
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


def make_store(tmp: Path, name: str, materializer: Path, *, with_question: bool = True) -> tuple[Path, dict[str, Any]]:
    storage = tmp / name
    storage.mkdir()
    try:
        seed(storage, with_question=with_question)
    except Exception as exc:
        return storage, {"_returncode": 1, "_diagnostic": f"could not seed a store — {scrub(repr(exc))}"}
    return storage, publish(storage, materializer)


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
    """(H3 title, its lines) inside one H2 section."""

    out: list[tuple[str, list[str]]] = []
    for line in lines:
        if line.startswith("### "):
            out.append((line[4:].strip(), []))
        elif out:
            out[-1][1].append(line)
    return out


def md_visible(text: str) -> str:
    text = LINK.sub(r"\1", text)
    return re.sub(
        r"\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`([^`]*)`",
        lambda m: m.group(1) or m.group(2) or m.group(3) or m.group(4) or "",
        text,
    )


def html_text(fragment: str) -> str:
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", "", fragment)).split())


def html_h2_spans(text: str) -> list[tuple[str, int, int]]:
    heads = list(re.finditer(r"<h2\b[^>]*>(.*?)</h2>", text, re.S))
    out: list[tuple[str, int, int]] = []
    for index, match in enumerate(heads):
        end = heads[index + 1].start() if index + 1 < len(heads) else len(text)
        out.append((html_text(match.group(1)).lstrip("§").strip(), match.end(), end))
    return out


def html_section(text: str, title: str) -> str:
    for found, start, end in html_h2_spans(text):
        if found == title:
            return text[start:end]
    return ""


def html_h3_titles(fragment: str) -> list[str]:
    return [html_text(m.group(1)).lstrip("§").strip() for m in re.finditer(r"<h3\b[^>]*>(.*?)</h3>", fragment, re.S)]


def md_table_rows(lines: list[str]) -> list[list[str]]:
    """Data rows of the first pipe table in the lines, cells as raw markdown."""

    rows: list[list[str]] = []
    in_table = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("|"):
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            if all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
                continue
            rows.append(cells)
            in_table = True
        elif in_table:
            break
    return rows[1:]  # drop the header row


def html_table_rows(fragment: str) -> list[list[str]]:
    table = re.search(r"<table\b.*?</table>", fragment, re.S)
    if not table:
        return []
    body = re.sub(r"<thead\b.*?</thead>", "", table.group(0), flags=re.S)
    out: list[list[str]] = []
    for tr in re.findall(r"<tr\b.*?</tr>", body, re.S):
        cells = [html_text(c) for c in re.findall(r"<td\b[^>]*>(.*?)</td>", tr, re.S)]
        if cells:
            out.append(cells)
    return out


def identity_paragraph(md: str) -> str:
    """The last paragraph before the first H2: the page-head hint, if any, sits above it."""

    head = md.split("\n## ", 1)[0]
    paragraphs = [" ".join(p.split()) for p in re.split(r"\n\s*\n", head) if p.strip()]
    paragraphs = [p for p in paragraphs if not p.startswith("# ")]
    return paragraphs[-1] if paragraphs else ""


def load_contract() -> dict[str, Any]:
    return json.loads(CONTRACT.read_text())


def expected_when(set_when: str) -> str:
    return WHEN_START if set_when == "start" else WHEN_END


def check_pass_table(
    md: str, page: str, passes: list[dict[str, Any]], status_by_value: dict[str, dict[str, Any]]
) -> str | None:
    section = dict(md_sections(md)).get(SECTION)
    if section is None:
        return f"the Markdown guide has no '{SECTION}' section"
    got = md_table_rows(section)
    if len(got) != len(passes):
        return f"the pass table has {len(got)} rows, the contract's survey_passes has {len(passes)}"
    html_rows = html_table_rows(html_section(page, SECTION))
    if len(html_rows) != len(passes):
        return f"the HTML pass table has {len(html_rows)} rows, expected {len(passes)}"
    for index, (spec, cells) in enumerate(zip(passes, got, strict=True)):
        status = status_by_value[spec["status"]]
        if len(cells) < 4:
            return f"row {index + 1} has {len(cells)} cells, expected pass, action, depth and meaning"
        pass_cell, does, depth, meaning = (md_visible(c) for c in cells[:4])
        if pass_cell != spec["pass"]:
            return f"row {index + 1} names the pass {pass_cell!r}, the contract says {spec['pass']!r}"
        if does != spec["does"]:
            return f"row {index + 1} ({spec['pass']}) says {does!r}, the contract says {spec['does']!r}"
        if not depth.startswith(status["label"]):
            return (
                f"row {index + 1} ({spec['pass']}) opens its depth cell {depth!r},"
                f" not with the contract label {status['label']!r}"
            )
        want_when = expected_when(spec["set_when"])
        other = WHEN_START if want_when == WHEN_END else WHEN_END
        if want_when not in depth or other in depth:
            return (
                f"row {index + 1} ({spec['pass']}) says {depth!r}, but set_when is"
                f" {spec['set_when']!r}: expected {want_when!r}"
            )
        if depth != f"{status['label']}, {want_when}":
            return (
                f"row {index + 1} ({spec['pass']}) has the depth cell {depth!r},"
                f" expected exactly {status['label'] + ', ' + want_when!r}"
            )
        if meaning != status["meaning"]:
            return f"row {index + 1} ({spec['pass']}) gives the meaning {meaning!r}, the contract says {status['meaning']!r}"
        if html_rows[index][:4] != [md_visible(c) for c in cells[:4]]:
            return f"row {index + 1} reads {html_rows[index][:4]!r} in HTML, {[md_visible(c) for c in cells[:4]]!r} in Markdown"
    return None


def main() -> int:
    emit("GATE O4 — how a survey works, and how to answer a decision")
    emit("")

    contract: dict[str, Any] = {}
    try:
        contract = load_contract()
    except Exception as exc:
        FAILURES.append(f"contract: could not read the vocabulary contract — {scrub(repr(exc))}")
        emit(f"  FAIL contract: could not read the vocabulary contract — {scrub(repr(exc))}")
    passes: list[dict[str, Any]] = list(contract.get("survey_passes") or [])
    status_by_value: dict[str, dict[str, Any]] = {
        str(v["value"]): v for v in (contract.get("enums", {}).get("subsystem_status", {}).get("values") or [])
    }

    def contract_has_passes() -> str | None:
        if len(passes) != 5:
            return f"the contract carries {len(passes)} survey_passes, expected 5"
        missing = [p["status"] for p in passes if p["status"] not in status_by_value]
        if missing:
            return f"survey_passes name statuses the contract lacks: {missing}"
        return None

    check("the contract carries the survey passes", contract_has_passes)

    with tempfile.TemporaryDirectory(prefix="o4-gate-") as tmpdir:
        tmp = Path(tmpdir)
        storage, summary = make_store(tmp, "store", ROOT)
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
        titles = [t for t, _ in sections]

        def slot() -> str | None:
            if SECTION not in titles:
                return f"the guide's H2 sections are {titles}, with no '{SECTION}'"
            index = titles.index(SECTION)
            if titles[:index][-1:] != [H2_NEIGHBOURS[0]] or titles[index + 1 : index + 2] != [H2_NEIGHBOURS[2]]:
                return f"'{SECTION}' sits between {titles[:index][-1:]} and {titles[index + 1:index + 2]}, not {H2_NEIGHBOURS[0]!r} and {H2_NEIGHBOURS[2]!r}"
            html_titles = [t for t, _, _ in html_h2_spans(page)]
            if SECTION not in html_titles:
                return f"the HTML guide has no '{SECTION}' heading"
            return None

        check("the section sits between Pages on this site and Terms", slot)

        check("the pass table follows the contract", lambda: check_pass_table(md, page, passes, status_by_value))

        section = dict(sections).get(SECTION, [])
        blocks = md_blocks(section)
        block_titles = [t for t, _ in blocks]

        def subheadings() -> str | None:
            missing = [s for s in SUBHEADINGS if s not in block_titles]
            if missing:
                return f"the section lacks the subheadings {missing}; it has {block_titles}"
            html_titles = html_h3_titles(html_section(page, SECTION))
            absent = [s for s in SUBHEADINGS if s not in html_titles]
            if absent:
                return f"the HTML section lacks the subheadings {absent}; it has {html_titles}"
            return None

        check("the section has 'What it expects from you' and 'Phase numbers'", subheadings)

        def body(title: str) -> str:
            lines = dict(blocks).get(title, [])
            return md_visible("\n".join(lines))

        def expects() -> str | None:
            text = body(SUBHEADINGS[0])
            lowered = text.lower()
            for needle in ("decisions needed", "telling the agent", "stop"):
                if needle not in lowered:
                    return f"'{SUBHEADINGS[0]}' does not say {needle!r}: {text[:200]!r}"
            if "nothing" not in lowered:
                return f"'{SUBHEADINGS[0]}' does not say the agent keeps going without the reader: {text[:200]!r}"
            if "read-only" not in lowered:
                return f"'{SUBHEADINGS[0]}' does not say the site is read-only: {text[:200]!r}"
            html_block = html_text(html_section(page, SECTION))
            if "telling the agent" not in html_block.lower():
                return "the HTML section does not say 'telling the agent'"
            return None

        check("'What it expects from you' says what to do, and to tell the agent", expects)

        def no_raw_tags() -> str | None:
            # A CommonMark reader treats `<file>` as inline HTML and drops it, so
            # the Markdown would print a shorter sentence than the HTML. Outside
            # a code span, only the guide's own `<a id>` anchors are HTML.
            section = "\n".join(line for _title, lines in md_sections(md) if _title == SECTION for line in lines)
            outside = re.sub(r"`[^`]*`", "", section)
            tags = [t for t in re.findall(r"</?[A-Za-z][^>]*>", outside) if not re.fullmatch(r'<a id="[^"]+"></a>|</?a\b[^>]*>', t)]
            return f"the Markdown section prints raw HTML a reader drops: {tags[:4]}" if tags else None

        check("the section's Markdown carries no raw HTML tag outside a code span", no_raw_tags)

        def phases() -> str | None:
            text = body(SUBHEADINGS[1])
            for needle in ("0–7", "1–5"):
                if needle not in text:
                    return f"'Phase numbers' does not decode {needle!r}: {text[:200]!r}"
            for spec in passes:
                if spec["pass"] not in text:
                    return f"'Phase numbers' does not name the pass {spec['pass']!r}"
            rows = md_table_rows(dict(blocks).get(SUBHEADINGS[1], []))
            if len(rows) != 2:
                return f"'Phase numbers' key has {len(rows)} rows, expected 2 (onboarding and survey)"
            html_rows = html_table_rows(html_section(page, SECTION).split("Phase numbers", 1)[-1])
            if len(html_rows) != 2:
                return f"the HTML 'Phase numbers' key has {len(html_rows)} rows, expected 2"
            if [[md_visible(c) for c in r] for r in rows] != html_rows:
                return "the 'Phase numbers' key reads differently in HTML and Markdown"
            return None

        check("'Phase numbers' is a two-row key over the pass names", phases)

        # -- Decisions needed ---------------------------------------------------
        def answer_line(md_text: str, html_page: str, state: str) -> str | None:
            if not md_text:
                return f"docs/open-questions.md was not written ({state})"
            head = md_text.split("\n## ", 1)[0].lower()
            for phrase in ANSWER_LINE_PHRASES:
                if phrase not in head:
                    return f"the Markdown page lacks {phrase!r} above its first section ({state})"
            first = re.search(r"^# Decisions needed\s*$", md_text, re.M)
            if not first:
                return f"the Markdown page lacks its title ({state})"
            if "tell the agent" not in html_text(html_page).lower():
                return f"the HTML page lacks 'tell the agent' ({state})"
            return None

        def decisions_with_question() -> str | None:
            md_text = read(docs / "open-questions.md") or ""
            html_text_page = read(docs / "open-questions.html") or ""
            if "tenancy" not in md_text:
                return "the fixture's open question is not on the page, so the check proves nothing"
            return answer_line(md_text, html_text_page, "a question is open")

        check("Decisions needed tells the reader to tell the agent (a question open)", decisions_with_question)

        def decisions_empty() -> str | None:
            empty, empty_summary = make_store(tmp, "empty", ROOT, with_question=False)
            if empty_summary.get("_returncode") != 0:
                return f"the materializer did not publish the empty fixture — {empty_summary.get('_diagnostic')}"
            return answer_line(
                read(empty / "docs" / "open-questions.md") or "",
                read(empty / "docs" / "open-questions.html") or "",
                "no question is open",
            )

        check("Decisions needed tells the reader to tell the agent (none open)", decisions_empty)

        # -- Overview identity ------------------------------------------------
        index_md = read(docs / "index.md") or ""
        index_html = read(docs / "index.html") or ""

        def identity() -> str | None:
            if not index_md:
                return "docs/index.md was not written"
            if IDENTITY_FORBIDDEN_OLD in index_md:
                return f"the overview still says {IDENTITY_FORBIDDEN_OLD!r}"
            paragraph = identity_paragraph(index_md)
            if paragraph != IDENTITY:
                return f"the identity paragraph is {paragraph!r}, expected Appendix C's {IDENTITY!r}"
            digits = re.findall(r"\d", paragraph)
            if digits:
                return f"the identity paragraph contains a digit: {digits}"
            lowered = paragraph.lower()
            hit = [t for t in FORBIDDEN if re.search(rf"(?<![a-z]){re.escape(t)}(?![a-z])", lowered)]
            if hit:
                return f"the identity paragraph contains the forbidden term(s) {hit}"
            return None

        check("the overview's identity paragraph is Appendix C's sentence, no digit, no forbidden term", identity)

        def identity_html() -> str | None:
            if not index_html:
                return "docs/index.html was not written"
            link = re.search(
                r'<a\b[^>]*href="([^"]*how-to-read\.html)"[^>]*>\s*How to read this survey\s*</a>', index_html
            )
            if not link:
                return "the HTML overview does not link 'How to read this survey' to how-to-read.html"
            if "An AI agent running Amanuensis read the repository" not in html_text(index_html):
                return "the HTML overview does not carry the identity sentence"
            return None

        check("the HTML overview carries the sentence and links the guide", identity_html)

        # -- Generated, not copied ---------------------------------------------
        def generated() -> str | None:
            if not passes:
                return "no contract survey_passes to mutate against"
            copy = tmp / "materializer-copy"
            shutil.copytree(
                ROOT,
                copy,
                ignore=shutil.ignore_patterns("__pycache__", ".venv", ".ruff_cache", "test-*"),
            )
            vocab = copy / "amanuensis_materializer" / "vocabulary.py"
            text = vocab.read_text()
            first = passes[0]
            status = status_by_value[first["status"]]
            changes = (
                (f'"label": "{status["label"]}"', '"label": "Xlabel"'),
                (f'"meaning": "{status["meaning"]}"', '"meaning": "Xmeaning is done."'),
                (f'"does": "{first["does"]}"', '"does": "Xdoes."'),
            )
            flip = '"set_when": "start"' if first["set_when"] == "end" else '"set_when": "end"'
            for old, new in changes:
                if old not in text:
                    return f"the generated vocabulary lacks {old!r}, so the gate cannot mutate it"
                text = text.replace(old, new, 1)
            marker = f'"status": "{first["status"]}",\n        "set_when": "{first["set_when"]}"'
            if marker not in text:
                return "the generated survey_passes has an unexpected shape, so the gate cannot mutate it"
            text = text.replace(
                marker, f'"status": "{first["status"]}",\n        {flip}', 1
            )
            vocab.write_text(text)
            mutated, mutated_summary = make_store(tmp, "mutated", copy)
            if mutated_summary.get("_returncode") != 0:
                return f"the mutated copy did not publish — {mutated_summary.get('_diagnostic')}"
            mutated_md = read(mutated / "docs" / "how-to-read.md") or ""
            sec = dict(md_sections(mutated_md)).get(SECTION, [])
            rows = md_table_rows(sec)
            if not rows:
                return "the mutated copy's guide has no pass table"
            cells = [md_visible(c) for c in rows[0]]
            if "Xdoes." not in cells[1]:
                return f"the 'what the agent does' cell did not follow the contract: {cells[1]!r}"
            if not cells[2].startswith("Xlabel"):
                return f"the depth label did not follow the contract: {cells[2]!r}"
            want = expected_when("start" if first["set_when"] == "end" else "end")
            if cells[2] != f"Xlabel, {want}":
                return f"the depth cell did not follow the contract label and set_when: {cells[2]!r}"
            if cells[3] != "Xmeaning is done.":
                return f"the depth meaning did not follow the contract: {cells[3]!r}"
            if want not in cells[2]:
                return f"the 'when' cell did not follow set_when: {cells[2]!r}"
            return None

        check("the table is generated from the contract constants, not copied", generated)
        check("no published page hides its report from assistive technology", lambda: hidden_pages(docs))

    # -- CI ----------------------------------------------------------------
    def in_ci() -> str | None:
        ci = read(CI_FILE)
        if ci is None:
            return "could not read .github/workflows/test.yml"
        if "python3 test-orientation-workflow.py" not in ci:
            return "test.yml has no step running test-orientation-workflow.py"
        return None

    check("the gate runs in CI", in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE O4 RED: {FAILURES[0]}")
        return 1
    emit("GATE O4 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
