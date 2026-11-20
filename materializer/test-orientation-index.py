#!/usr/bin/env python3
"""Gate for orientation packet O2 — the page index with "Use it when"
(design/orientation/PLAN.md §2.4, §4 O2, Appendix D).

Turns red when:

  - `PagePlan` or `SitePage` carries no `use_when` field;
  - a static page's Markdown does not open, directly under its H1, with an
    italic paragraph holding its hint and then "Use it when <Appendix D text>";
    in particular when the overview's or the reader's guide's hint is still
    empty or is not the Appendix D sentence, or a kept hint was replaced;
  - a page's HTML head prints a different hint or `use_when` than its Markdown
    prints, prints no `use_when` at all, or prints the Markdown's italic
    paragraph a second time inside the article body;
  - the reader's guide has no "Pages on this site" section, still has "What to
    look at first", or its tables are not headed Page / What it shows /
    Use it when;
  - the index is not grouped by lens in reading order, a lens heading lacks the
    lens's one-sentence meaning from the vocabulary contract, or a planned
    top-level page has no row, or a row's "Use it when" cell is not the
    Appendix D text for that page;
  - the index has one row per subsystem or per evidence matrix instead of one
    row per subgroup ("Subsystem pages", "Evidence tables"), or those rows do
    not route to a page that lists every page of the subgroup;
  - a subsystem page or an evidence matrix page prints no `use_when`;
  - the gate does not run in CI.

False green it cannot exclude: the fixture is small (three subsystems, one
matrix), so a collapse that only starts to matter at 35 rows is exercised by
count, not by reading. The HTML checks read bytes; they do not drive a browser.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed.
"""

from __future__ import annotations

import html as htmllib
import importlib
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
# What PLAN.md Appendix D fixes, written out here rather than imported, so that
# rewriting an implementation string cannot also rewrite what this gate expects.
# ---------------------------------------------------------------------------
# path -> (label, group, use_when). The hint is checked separately where the
# plan says it is new; "kept" hints are checked as non-empty and as a sentence.
STATIC_PAGES: dict[str, tuple[str, str, str]] = {
    "index.md": ("Overview", "Overview", "you arrive, or want the current counts."),
    "architecture.md": ("Architecture", "Codebase", "you want the overall shape before reading any one part."),
    "master-plan.md": ("Subsystems", "Codebase", "you are looking for the part of the code that does something."),
    "files.md": ("Files", "Codebase", "you want to know whether a particular file was read."),
    "not-yet-surveyed.md": ("Not yet surveyed", "Codebase", "you want to know what the survey has not covered."),
    "seams.md": ("System boundaries", "Codebase", "you are changing something two subsystems share."),
    "vocabulary.md": ("Codebase glossary", "Codebase", "a project-specific name is unfamiliar."),
    "findings.md": ("Open findings", "Unresolved", "you want the defects still open."),
    "disagreements.md": ("Disagreements", "Unresolved", "you want to know where the record contradicts itself."),
    "open-questions.md": ("Decisions needed", "Unresolved", "you want to know what the agent needs from you."),
    "field-notes.md": ("Leads", "Unresolved", "you want things noticed but not yet confirmed."),
    "stale.md": ("Stale knowledge", "Unresolved", "you want to know what may be out of date since the code changed."),
    "hot-spots.md": ("Hot spots", "Unresolved", "you want to know where open work concentrates."),
    "resolved-findings.md": ("Resolved findings", "History", "you want to know what was fixed or ruled out, and on what basis."),
    "resolution-history.md": ("Resolution history", "History", "you want to know how a record reached its state."),
    "resolved-leads.md": ("Resolved leads and questions", "History", "you want to know how a question was answered."),
    "sessions.md": ("Sessions and publications", "History", "you want to know when the survey ran."),
    "contradictions.md": ("Conflicting evidence", "History", "you want to see how a disagreement was settled."),
    "how-to-read.md": ("Reader's guide", "Method", "a word, an ID or a page is unfamiliar."),
    "concerns.md": ("Review coverage", "Method", "you want to know which defect kinds were checked where."),
    "concern-checklist.md": ("Review checklist", "Method", "you want the list of defect kinds and where it came from."),
    "diagnosticity.md": ("Competing explanations", "Method", "you want to see how a symptom's cause was weighed."),
    "onboarding-report.md": ("Onboarding record", "Method", "you want the first pass's decisions about scope and split."),
    "entry-point.md": ("Where to begin", "Method", "you want the reading path an earlier session wrote."),
}
NEW_HINTS: dict[str, str] = {
    "index.md": "What the codebase is, and where the survey stands.",
    "how-to-read.md": "What each page is for, the terms the site uses, and how a survey works.",
}
SUBSYSTEM_ROW = ("Subsystem pages", "you have picked a subsystem.")
MATRIX_ROW = ("Evidence tables", "you followed a DM- link.")
GROUP_ORDER = ("Overview", "Codebase", "Unresolved", "History", "Method")
LENS_OF_GROUP = {"Codebase": "codebase", "Unresolved": "unresolved", "History": "history", "Method": "method"}
INDEX_HEADING = "Pages on this site"
INDEX_COLUMNS = ["Page", "What it shows", "Use it when"]

SHA = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"
SUBSYSTEMS = (
    ("B-01", "Read path", "mapped", "backend", "src/reader.ts", None, None),
    ("B-02", "Write path", "mapped", "backend", "src/writer.ts", None, None),
    ("F-01", "Console", "scoping", "frontend", "ui/console.ts", None, None),
)
MATRIX_ID = 7
MATRIX_SYMPTOM = "rows appear twice after a restart"


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
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('o2', 'fixture')")
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        list(SUBSYSTEMS),
    )
    cur.execute(
        "INSERT INTO diagnosticity_sessions (id, subsystem_id, symptom, outcome, session_id)"
        " VALUES (?, 'B-01', ?, 'open', 'o2')",
        (MATRIX_ID, MATRIX_SYMPTOM),
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
def md_head(text: str) -> tuple[str, str] | None:
    """(H1, the first paragraph under it) of a Markdown page, or None."""

    lines = text.splitlines()
    index = next((i for i, line in enumerate(lines) if line.strip()), None)
    if index is None or not lines[index].startswith("# "):
        return None
    rest = [line for line in lines[index + 1 :]]
    start = next((i for i, line in enumerate(rest) if line.strip()), None)
    if start is None:
        return lines[index][2:].strip(), ""
    end = start
    while end < len(rest) and rest[end].strip():
        end += 1
    return lines[index][2:].strip(), " ".join(line.strip() for line in rest[start:end])


def split_head(paragraph: str) -> tuple[str, str] | None:
    """(hint, use_when sentence) from `*<hint> Use it when <x>*`, or None."""

    if not (paragraph.startswith("*") and paragraph.endswith("*") and not paragraph.startswith("**")):
        return None
    inner = paragraph[1:-1].strip()
    marker = "Use it when "
    cut = inner.rfind(marker)
    if cut < 0:
        return None
    return inner[:cut].strip(), inner[cut:].strip()


def html_head(text: str) -> tuple[str, str]:
    hint = re.search(r'<p class="page-hint">(.*?)</p>', text, re.S)
    use = re.search(r'<p class="page-use-when">(.*?)</p>', text, re.S)
    return (
        htmllib.unescape(hint.group(1)).strip() if hint else "",
        htmllib.unescape(use.group(1)).strip() if use else "",
    )


def article_of(text: str) -> str:
    match = re.search(r"<article\b.*?</article>", text, re.S)
    return match.group(0) if match else ""


def section_lines(text: str, heading: str) -> list[str]:
    out: list[str] = []
    inside = False
    for line in text.splitlines():
        if line.startswith("## "):
            if inside:
                break
            inside = line[3:].strip() == heading
            continue
        if inside:
            out.append(line)
    return out


def groups_of(lines: list[str]) -> list[tuple[str, list[str]]]:
    out: list[tuple[str, list[str]]] = []
    for line in lines:
        if line.startswith("### "):
            out.append((line[4:].strip(), []))
        elif out:
            out[-1][1].append(line)
    return out


def table_rows(lines: list[str]) -> tuple[list[str], list[list[str]]]:
    header: list[str] = []
    rows: list[list[str]] = []
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if all(cell and set(cell) <= {"-", ":", " "} for cell in cells):
            continue
        if not header:
            header = cells
        else:
            rows.append(cells)
    return header, rows


LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def main() -> int:
    emit("GATE O2 — the page index with 'Use it when'")
    emit("")

    sys.path.insert(0, str(ROOT))
    modules: dict[str, Any] = {}
    import_errors: dict[str, str] = {}
    for name in ("html_projection", "core", "vocabulary"):
        try:
            modules[name] = importlib.import_module(f"amanuensis_materializer.{name}")
        except Exception as exc:
            import_errors[name] = scrub(f"{exc!r}")

    def carries_field() -> str | None:
        missing: list[str] = []
        for module, cls in (("core", "PagePlan"), ("html_projection", "SitePage")):
            mod = modules.get(module)
            fields = getattr(getattr(mod, cls, None), "__dataclass_fields__", {}) if mod else {}
            if "use_when" not in fields:
                missing.append(f"{module}.{cls}")
        if missing:
            return f"{', '.join(missing)} carries no use_when field (§2.4)"
        return None

    check("PagePlan and SitePage carry a use_when field", carries_field)

    with tempfile.TemporaryDirectory(prefix="o2-gate-") as tmp:
        root = Path(tmp)
        storage = root / "store"
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

        def published() -> str | None:
            if not summary or summary.get("_returncode") not in (0,) or summary.get("ok") is False:
                return f"the materializer did not publish the fixture — {summary.get('_diagnostic', summary)}"
            if not (docs / "how-to-read.md").is_file():
                return "docs/how-to-read.md was not written"
            return None

        check("the fixture publishes", published)

        # -- every static page opens with hint + "Use it when" in Markdown ---
        parsed: dict[str, tuple[str, str]] = {}

        def static_pages_open_with_the_head() -> str | None:
            for path, (label, _group, fragment) in STATIC_PAGES.items():
                text = read(docs / path)
                if text is None:
                    return f"{path} ({label}) is not published"
                head = md_head(text)
                if head is None:
                    return f"{path} does not open with an H1"
                split = split_head(head[1])
                if split is None:
                    return f"{path}: the paragraph under the H1 is not an italic hint plus 'Use it when' ({head[1][:80]!r})"
                hint, use = split
                if not hint:
                    return f"{path} ({label}) has an empty hint"
                if use != f"Use it when {fragment}":
                    return f"{path}: use_when reads {use!r}, Appendix D says 'Use it when {fragment}'"
                if path in NEW_HINTS and hint != NEW_HINTS[path]:
                    return f"{path}: hint reads {hint!r}, Appendix D says {NEW_HINTS[path]!r}"
                parsed[path] = (hint, use)
            return None

        check("every static page's Markdown opens with its hint and Appendix D's 'Use it when'", static_pages_open_with_the_head)

        def dynamic_pages_carry_use_when() -> str | None:
            subsystem_pages = sorted((docs / "subsystems").glob("*.md")) if (docs / "subsystems").is_dir() else []
            matrix_pages = sorted((docs / "diagnosticity").glob("*.md")) if (docs / "diagnosticity").is_dir() else []
            if len(subsystem_pages) != len(SUBSYSTEMS) or len(matrix_pages) != 1:
                return f"fixture published {len(subsystem_pages)} subsystem pages and {len(matrix_pages)} matrix pages"
            for pages, (_label, fragment) in ((subsystem_pages, SUBSYSTEM_ROW), (matrix_pages, MATRIX_ROW)):
                for page in pages:
                    head = md_head(page.read_text())
                    split = split_head(head[1]) if head else None
                    if split is None or not split[0]:
                        return f"{page.name} has no italic hint under its H1"
                    if split[1] != f"Use it when {fragment}":
                        return f"{page.name}: use_when reads {split[1]!r}, not 'Use it when {fragment}'"
            return None

        check("subsystem and matrix pages carry the subgroup's use_when once", dynamic_pages_carry_use_when)

        # -- HTML says what Markdown says ----------------------------------
        def html_agrees() -> str | None:
            for path in list(STATIC_PAGES) + ["subsystems/*", "diagnosticity/*"]:
                if "*" in path:
                    directory, _ = path.split("/")
                    targets = sorted((docs / directory).glob("*.md")) if (docs / directory).is_dir() else []
                else:
                    targets = [docs / path]
                for target in targets:
                    rel = target.relative_to(docs)
                    md = md_head(target.read_text()) if target.is_file() else None
                    split = split_head(md[1]) if md else None
                    if split is None:
                        return f"{rel}: Markdown carries no hint and use_when to compare"
                    page_html = read(target.with_suffix(".html"))
                    if page_html is None:
                        return f"{rel.with_suffix('.html')} is not published"
                    hint, use = html_head(page_html)
                    if hint != split[0]:
                        return f"{rel}: HTML hint {hint!r} differs from Markdown hint {split[0]!r}"
                    if use != split[1]:
                        return f"{rel}: HTML use_when {use!r} differs from Markdown {split[1]!r}"
                    body = article_of(page_html)
                    if f"{split[0]} {split[1]}" in htmllib.unescape(re.sub(r"<[^>]+>", "", body)):
                        return f"{rel}: the italic hint paragraph is printed again inside the article body"
            return None

        check("HTML prints the same hint and use_when as Markdown, once", html_agrees)

        # -- the index ------------------------------------------------------
        guide = read(docs / "how-to-read.md") or ""
        index_lines = section_lines(guide, INDEX_HEADING)

        def index_is_renamed() -> str | None:
            if not index_lines:
                return f"the reader's guide has no '{INDEX_HEADING}' section"
            if "What to look at first" in guide:
                return "the guide still carries 'What to look at first'"
            return None

        check("the index is 'Pages on this site'", index_is_renamed)

        def index_is_grouped_by_lens() -> str | None:
            grouped = groups_of(index_lines)
            names = [name for name, _ in grouped]
            if names != list(GROUP_ORDER):
                return f"index groups are {names!r}, not {list(GROUP_ORDER)!r}"
            vocabulary = modules.get("vocabulary")
            if vocabulary is None:
                return f"vocabulary.py could not be read — {import_errors.get('vocabulary')}"
            meanings = {
                entry["value"]: entry["meaning"]
                for entry in vocabulary.VOCABULARY["lens"]["values"]
            }
            for name, body in grouped:
                header, rows = table_rows(body)
                if header != INDEX_COLUMNS:
                    return f"{name}: table is headed {header!r}, not {INDEX_COLUMNS!r}"
                if not rows:
                    return f"{name}: the table has no rows"
                if name in LENS_OF_GROUP:
                    meaning = meanings[LENS_OF_GROUP[name]]
                    prose = " ".join(line.strip() for line in body if line.strip() and not line.strip().startswith("|"))
                    if meaning not in prose:
                        return f"{name}: the heading is not followed by the lens's meaning {meaning!r}"
                    first_table_line = next((i for i, line in enumerate(body) if line.strip().startswith("|")), len(body))
                    meaning_line = next((i for i, line in enumerate(body) if meaning in line), len(body))
                    if meaning_line > first_table_line:
                        return f"{name}: the lens meaning comes after the table, not under the heading"
            return None

        check("the index is grouped by lens, each lens with its meaning, three columns", index_is_grouped_by_lens)

        def index_rows_match_appendix() -> str | None:
            seen: dict[str, tuple[str, str, str]] = {}
            all_rows: list[tuple[str, list[str]]] = []
            for name, body in groups_of(index_lines):
                for cells in table_rows(body)[1]:
                    all_rows.append((name, cells))
            for group, cells in all_rows:
                if len(cells) != 3:
                    return f"a row in {group} has {len(cells)} cells: {cells!r}"
                match = LINK.search(cells[0])
                if not match:
                    return f"a row in {group} does not link its page: {cells[0]!r}"
                seen[match.group(2)] = (group, cells[1], cells[2])
            for path, (label, group, fragment) in STATIC_PAGES.items():
                if path not in seen:
                    return f"{path} ({label}) is planned and has no row in the index"
                row_group, shows, use = seen[path]
                if row_group != group:
                    return f"{path} sits under {row_group!r}, Appendix D's lens is {group!r}"
                if use != fragment:
                    return f"{path}: 'Use it when' cell reads {use!r}, not {fragment!r}"
                if not shows.strip():
                    return f"{path}: 'What it shows' cell is empty"
                hint = parsed.get(path, ("", ""))[0]
                if hint and shows != hint:
                    return f"{path}: 'What it shows' reads {shows!r}, not the page's hint {hint!r}"
            return None

        check("every planned top-level page has one row, with its hint and Appendix D's use_when", index_rows_match_appendix)

        def one_row_per_subgroup() -> str | None:
            rows = [cells for _g, body in groups_of(index_lines) for cells in table_rows(body)[1]]
            total_static = len(STATIC_PAGES)
            if len(rows) != total_static + 2:
                return f"{len(rows)} rows; expected {total_static} pages plus one row each for subsystems and matrices"
            joined = "\n".join(" | ".join(cells) for cells in rows)
            for name in [s[1] for s in SUBSYSTEMS] + [MATRIX_SYMPTOM]:
                if name in joined:
                    return f"the index names {name!r}: a per-record row, not a subgroup row"
            if "subsystems/" in joined or "diagnosticity/dm-" in joined:
                return "the index links an individual subsystem or matrix page"
            for label, fragment in (SUBSYSTEM_ROW, MATRIX_ROW):
                hits = [cells for cells in rows if label in cells[0]]
                if len(hits) != 1:
                    return f"{len(hits)} rows are named {label!r}, not exactly one"
                if hits[0][2] != fragment:
                    return f"{label!r}: 'Use it when' reads {hits[0][2]!r}, not {fragment!r}"
            return None

        check("one row per subgroup, not one per subsystem or matrix", one_row_per_subgroup)

        def subgroup_rows_route_to_a_listing() -> str | None:
            targets = {SUBSYSTEM_ROW[0]: "subsystems/", MATRIX_ROW[0]: "diagnosticity/"}
            found: set[str] = set()
            for _g, body in groups_of(index_lines):
                for cells in table_rows(body)[1]:
                    for label, directory in targets.items():
                        if label in cells[0]:
                            match = LINK.search(cells[0])
                            if not match:
                                return f"{label!r} row has no link"
                            found.add(label)
                            listing = read(docs / match.group(2)) or ""
                            members = sorted((docs / directory).glob("*.md"))
                            for member in members:
                                if f"({directory}{member.name})" not in listing and f"({directory}{member.name}#" not in listing:
                                    return f"{label!r} routes to {match.group(2)}, which does not list {directory}{member.name}"
            if found != set(targets):
                return f"the index has no row for {sorted(set(targets) - found)!r}"
            return None

        check("each subgroup row routes to a page that lists every member", subgroup_rows_route_to_a_listing)

    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if text is None:
            return ".github/workflows/test.yml could not be read"
        if "test-orientation-index.py" not in text:
            return "test.yml has no step that runs test-orientation-index.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE O2 RED: {FAILURES[0][:230]}")
        return 1
    emit("GATE O2 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
