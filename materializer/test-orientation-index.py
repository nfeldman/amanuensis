#!/usr/bin/env python3
"""Gate for orientation packet O2 — the page index with "Use it when"
(design/orientation/PLAN.md §2.4, §4 O2, Appendix D).

Turns red when:

  - `PagePlan` or `SitePage` carries no `use_when` field;
  - a static page's HTML head does not open with an H1, or its "About this
    page" popover in the head holds no `use_when` paragraph reading "Use it
    when <Appendix D text>"; in particular when a prose source opens with an H2
    rather than an H1;
  - a top-level page or an evidence matrix page prints a hint under its title
    (the title says what the page holds; owner ruling 2026-11-25), or a
    subsystem page prints none (its hint is its layer);
  - a page's HTML head prints no `use_when` at all, carries markup inside its
    hint or `use_when`, or prints the same hint paragraph a second time inside
    the article body, including when the xref pass has bolded or linked an ID
    inside it (a subsystem named after its own ID);
  - the xref pass links or names an ID inside a static page's generated head
    paragraphs (the lowercase subsystem `code` in "the part of the code that
    does something");
  - the reader's guide has no "Pages on this site" section, still has "What to
    look at first", or its tables are not headed Page / Use it when;
  - the index is not grouped by lens in reading order, a lens heading lacks the
    lens's one-sentence meaning from the vocabulary contract, or a planned
    top-level page has no row, or a row's "Use it when" cell is not the
    Appendix D text for that page;
  - the index has one row per subsystem or per evidence matrix instead of one
    row per subgroup ("Subsystem pages", "Evidence tables"), or those rows do
    not route to a page that lists every page of the subgroup;
  - a subsystem page or an evidence matrix page prints no `use_when`;
  - the HTML index's lens groups, the lens meaning under each heading, its
    column headers, or any row's page label, link or "Use it when" differ
    from the planned pages (so an index whose tables are dropped is red);
  - the gate does not run in CI.

Also red when a published HTML page hides its report from assistive technology
(`orientation_exposure.hidden_pages`: `aria-hidden="true"`, `hidden`, `inert`,
an inline `display: none` or `role="presentation"` on `<main>`, the page head,
the article or any element around them), which every text check above reads
straight through.

False green it cannot exclude: the fixture is small (four subsystems, one
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
# What PLAN.md Appendix D fixes, written out here rather than imported, so that
# rewriting an implementation string cannot also rewrite what this gate expects.
# ---------------------------------------------------------------------------
# path -> (label, group, use_when). Labels follow the owner's retitling of
# 2026-11-25; no top-level page has a hint.
STATIC_PAGES: dict[str, tuple[str, str, str]] = {
    "index.html": ("Overview", "Overview", "you arrive, or want the current counts."),
    "architecture.html": ("Architecture", "Codebase", "you want the overall shape before reading any one part."),
    "master-plan.html": ("Subsystems", "Codebase", "you are looking for the part of the code that does something."),
    "files.html": ("Files", "Codebase", "you want to know whether a particular file was read."),
    "not-yet-surveyed.html": ("Not yet surveyed", "Codebase", "you want to know what the survey has not covered."),
    "seams.html": ("Boundaries", "Codebase", "you are changing something two subsystems share."),
    "vocabulary.html": ("Glossary", "Codebase", "a project-specific name is unfamiliar."),
    "findings.html": ("Open findings", "Unresolved", "you want the defects still open."),
    "disagreements.html": ("Disagreements", "Unresolved", "you want to know where the record contradicts itself."),
    "open-questions.html": ("Decisions needed", "Unresolved", "you want to know what the agent needs from you."),
    "field-notes.html": ("Leads", "Unresolved", "you want things noticed but not yet confirmed."),
    "stale.html": ("Stale knowledge", "Unresolved", "you want to know what may be out of date since the code changed."),
    "hot-spots.html": ("Hot spots", "Unresolved", "you want to know where open work concentrates."),
    "resolved-findings.html": ("Resolved findings", "History", "you want to know what was fixed or ruled out, and on what basis."),
    "resolution-history.html": ("Resolution history", "History", "you want to know how a record reached its state."),
    "resolved-leads.html": ("Resolved leads and questions", "History", "you want to know how a question was answered."),
    "sessions.html": ("Sessions", "History", "you want to know when the survey ran."),
    "contradictions.html": ("Settled conflicts", "History", "you want to see how a disagreement was settled."),
    "how-to-read.html": ("Reader's guide", "Method", "a word, an ID or a page is unfamiliar."),
    "concerns.html": ("Review coverage", "Method", "you want to know which defect kinds were checked where."),
    "concern-checklist.html": ("Review checklist", "Method", "you want the list of defect kinds and where it came from."),
    "diagnosticity.html": ("Competing explanations", "Method", "you want to see how a symptom's cause was weighed."),
    "onboarding-report.html": ("Onboarding record", "Method", "you want the first pass's decisions about scope and split."),
    "entry-point.html": ("First reading path", "Method", "you want the reading path an earlier session wrote."),
}
SUBSYSTEM_ROW = ("Subsystem pages", "you have picked a subsystem.")
MATRIX_ROW = ("Evidence tables", "you followed a DM- link.")
SUBGROUP_LABELS = (SUBSYSTEM_ROW[0], MATRIX_ROW[0])
GROUP_ORDER = ("Overview", "Codebase", "Unresolved", "History", "Method")
LENS_OF_GROUP = {"Codebase": "codebase", "Unresolved": "unresolved", "History": "history", "Method": "method"}
INDEX_HEADING = "Pages on this site"
INDEX_COLUMNS = ["Page", "Use it when"]

SHA = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"
SUBSYSTEMS = (
    ("B-01", "Read path", "mapped", "backend", "src/reader.ts", None, None),
    ("B-02", "Write path", "mapped", "backend", "src/writer.ts", None, None),
    ("F-01", "Console", "scoping", "frontend", "ui/console.ts", None, None),
    # A name that carries its own ID: the xref pass bolds the self-reference
    # inside the page-head paragraph, which must still be found and printed once.
    ("B-03", "B-03 reader", "mapped", "backend", "src/cache.ts", None, None),
    # A lowercase ID that is an ordinary word of the page-head copy ("the part
    # of the code that does something"): the generated head must not link it.
    ("code", "Code gen", "mapped", "tooling", "src/gen.ts", None, None),
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
    # The pages read the imports the store holds, never a file in storage.
    # An imported body that opens with an H2, not an H1: the published page must
    # still open with an H1 carrying the page head.
    import_onboarding(
        db,
        session_id="o2",
        entry_point="# Where to begin\n\nStart at the reader.\n",
        onboarding_report="## Onboarding\n\nOne repository.\n",
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
def head_of(text: str) -> tuple[str, str, str] | None:
    """(H1, hint, use_when) of an HTML page, with the markup inside the paragraphs
    kept, or None unless the page head holds an H1 and an "About this page"
    popover holding the use_when with a button that opens it. The hint is the
    paragraph directly under the H1, or "" when there is none."""

    head = re.search(r'<header class="page-head">(.*?)</header>', text, re.S)
    if not head:
        return None
    match = re.search(r'<h1\b[^>]*>(.*?)</h1>(?:\s*<p class="page-hint">(.*?)</p>)?', head.group(1), re.S)
    use = re.search(
        r'<div class="help-popover" id="page-help" popover\b[^>]*>.*?<p class="page-use-when">(.*?)</p>',
        head.group(1),
        re.S,
    )
    opener = re.search(r'<button\b[^>]*\bpopovertarget="page-help"[^>]*>', head.group(1))
    if not match or not use or not opener:
        return None
    return html_text(match.group(1)), match.group(2) or "", use.group(1)


def article_of(text: str) -> str:
    match = re.search(r"<article\b.*?</article>", text, re.S)
    return match.group(0) if match else ""


def html_text(fragment: str) -> str:
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", "", fragment)).split())


def html_section(text: str, heading: str) -> str | None:
    """The HTML between the `<h2>` titled `heading` and the next `<h2>`."""

    for match in re.finditer(r"<h2\b[^>]*>(.*?)</h2>", text, re.S):
        if html_text(match.group(1)).lstrip("§").strip() == heading:
            rest = text[match.end() :]
            end = re.search(r"<h2\b", rest)
            return rest[: end.start()] if end else rest
    return None


def html_index_groups(section: str) -> list[tuple[str, str, list[tuple[list[str], list[tuple[str, str, str]]]]]]:
    """(group, prose under the heading, [(header, [(label, href, use)])]) per `<h3>`."""

    out: list[tuple[str, str, list[tuple[list[str], list[tuple[str, str, str]]]]]] = []
    parts = re.split(r"(<h3\b[^>]*>.*?</h3>)", section, flags=re.S)
    for heading, body in zip(parts[1::2], parts[2::2], strict=True):
        name = html_text(heading).lstrip("§").strip()
        prose = " ".join(html_text(p) for p in re.findall(r"<p\b[^>]*>(.*?)</p>", body.split("<table", 1)[0], re.S))
        tables: list[tuple[list[str], list[tuple[str, str, str]]]] = []
        for table in re.findall(r"<table\b.*?</table>", body, re.S):
            header = [html_text(th) for th in re.findall(r"<th\b[^>]*>(.*?)</th>", table, re.S)]
            rows: list[tuple[str, str, str]] = []
            tbody = re.search(r"<tbody\b.*?</tbody>", table, re.S)
            for tr in re.findall(r"<tr\b[^>]*>(.*?)</tr>", tbody.group(0) if tbody else "", re.S):
                cells = re.findall(r"<td\b[^>]*>(.*?)</td>", tr, re.S)
                link = re.search(r'<a\b[^>]*href="([^"]*)"[^>]*>(.*?)</a>', cells[0] if cells else "", re.S)
                if len(cells) != 2 or not link:
                    rows.append((html_text(cells[0]) if cells else "", "", ""))
                    continue
                rows.append((html_text(link.group(2)), htmllib.unescape(link.group(1)), html_text(cells[1])))
            tables.append((header, rows))
        out.append((name, prose, tables))
    return out


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
            if not (docs / "how-to-read.html").is_file():
                return "docs/how-to-read.html was not written"
            return None

        check("the fixture publishes", published)

        # -- every static page opens with its title and "Use it when" in its head
        parsed: dict[str, tuple[str, str]] = {}

        def static_pages_open_with_the_head() -> str | None:
            for path, (label, _group, fragment) in STATIC_PAGES.items():
                text = read(docs / path)
                if text is None:
                    return f"{path} ({label}) is not published"
                head = head_of(text)
                if head is None:
                    return f"{path} does not open with an H1 and a use_when in its popover"
                if re.search(r"<a\b|<abbr\b|<strong\b", head[1] + head[2]) or re.search(r"\(Code gen\)", head[1] + head[2]):
                    return f"{path}: the generated head paragraphs were linked or named by the xref pass ({head[1][:60]!r}, {head[2][:60]!r})"
                hint, use = htmllib.unescape(head[1]).strip(), htmllib.unescape(head[2]).strip()
                if not use.startswith("Use it when "):
                    return f"{path}: the popover's paragraph is not 'Use it when' ({use[:80]!r})"
                if hint:
                    return f"{path} ({label}) prints a hint under its title ({hint[:80]!r}); a top-level page has none"
                if use != f"Use it when {fragment}":
                    return f"{path}: use_when reads {use!r}, Appendix D says 'Use it when {fragment}'"
                parsed[path] = (hint, use)
            return None

        check("every static page's HTML opens with its title, no hint, and Appendix D's 'Use it when'", static_pages_open_with_the_head)

        def dynamic_pages_carry_use_when() -> str | None:
            subsystem_pages = sorted((docs / "subsystems").glob("*.html")) if (docs / "subsystems").is_dir() else []
            matrix_pages = sorted((docs / "diagnosticity").glob("*.html")) if (docs / "diagnosticity").is_dir() else []
            if len(subsystem_pages) != len(SUBSYSTEMS) or len(matrix_pages) != 1:
                return f"fixture published {len(subsystem_pages)} subsystem pages and {len(matrix_pages)} matrix pages"
            for pages, (_label, fragment), hinted in ((subsystem_pages, SUBSYSTEM_ROW, True), (matrix_pages, MATRIX_ROW, False)):
                for page in pages:
                    head = head_of(page.read_text())
                    if head is None:
                        return f"{page.name} does not open with an H1 and a use_when in its popover"
                    if hinted and not htmllib.unescape(head[1]).strip():
                        return f"{page.name} has no hint (its layer) under its H1"
                    if not hinted and htmllib.unescape(head[1]).strip():
                        return f"{page.name} prints a hint under its H1 ({head[1][:80]!r}); a matrix page has none"
                    use = htmllib.unescape(head[2]).strip()
                    if use != f"Use it when {fragment}":
                        return f"{page.name}: use_when reads {use!r}, not 'Use it when {fragment}'"
            return None

        check("subsystem pages carry their layer as a hint, matrix pages none, both the subgroup's use_when", dynamic_pages_carry_use_when)

        # -- the head is printed once, as plain text -------------------------
        def head_printed_once() -> str | None:
            for path in list(STATIC_PAGES) + ["subsystems/*", "diagnosticity/*"]:
                if "*" in path:
                    directory, _ = path.split("/")
                    targets = sorted((docs / directory).glob("*.html")) if (docs / directory).is_dir() else []
                else:
                    targets = [docs / path]
                for target in targets:
                    rel = target.relative_to(docs)
                    page_html = read(target)
                    if page_html is None:
                        return f"{rel} is not published"
                    head = head_of(page_html)
                    if head is None:
                        return f"{rel}: the HTML head carries no use_when"
                    if re.search(r"<[a-z]", head[1] + head[2]):
                        return f"{rel}: the hint or use_when carries markup {head[1] + head[2]!r}"
                    hint, use = htmllib.unescape(head[1]).strip(), htmllib.unescape(head[2]).strip()
                    body = article_of(page_html)
                    printed = f"{hint} {use}" if hint else use
                    if printed in htmllib.unescape(re.sub(r"<[^>]+>", "", body)):
                        return f"{rel}: the head's paragraphs are printed again inside the article body"
            return None

        check("HTML prints the hint and use_when in the head, as plain text, once", head_printed_once)

        # -- the index ------------------------------------------------------
        guide = read(docs / "how-to-read.html") or ""
        index_section = html_section(guide, INDEX_HEADING)
        index_groups = html_index_groups(index_section) if index_section is not None else []

        def index_is_renamed() -> str | None:
            if index_section is None:
                return f"the reader's guide has no '{INDEX_HEADING}' section"
            if "What to look at first" in html_text(guide):
                return "the guide still carries 'What to look at first'"
            return None

        check("the index is 'Pages on this site'", index_is_renamed)

        def index_is_grouped_by_lens() -> str | None:
            names = [name for name, _p, _t in index_groups]
            if names != list(GROUP_ORDER):
                return f"index groups are {names!r}, not {list(GROUP_ORDER)!r}"
            vocabulary = modules.get("vocabulary")
            if vocabulary is None:
                return f"vocabulary.py could not be read — {import_errors.get('vocabulary')}"
            meanings = {
                entry["value"]: entry["meaning"]
                for entry in vocabulary.VOCABULARY["lens"]["values"]
            }
            for name, prose, tables in index_groups:
                if len(tables) != 1:
                    return f"{name}: the group has {len(tables)} index tables, not one"
                header, rows = tables[0]
                if header != INDEX_COLUMNS:
                    return f"{name}: table is headed {header!r}, not {INDEX_COLUMNS!r}"
                if not rows:
                    return f"{name}: the table has no rows"
                if name in LENS_OF_GROUP:
                    meaning = meanings[LENS_OF_GROUP[name]]
                    # `prose` is what sits between the heading and the table.
                    if meaning not in prose:
                        return f"{name}: the heading is not followed by the lens's meaning {meaning!r} before the table"
            return None

        check("the index is grouped by lens, each lens with its meaning, two columns", index_is_grouped_by_lens)

        def index_rows_match_appendix() -> str | None:
            seen: dict[str, tuple[str, str]] = {}
            all_rows = [(name, row) for name, _p, tables in index_groups for _h, rows in tables for row in rows]
            for group, (label, href, use) in all_rows:
                if not href:
                    return f"a row in {group} does not link its page or lacks two cells: {label!r}"
                if label in SUBGROUP_LABELS:
                    continue  # a subgroup row routes to a page that has a row of its own
                seen[href] = (group, use)
            for path, (label, group, fragment) in STATIC_PAGES.items():
                if path not in seen:
                    return f"{path} ({label}) is planned and has no row in the index"
                row_group, use = seen[path]
                if row_group != group:
                    return f"{path} sits under {row_group!r}, Appendix D's lens is {group!r}"
                if use != fragment:
                    return f"{path}: 'Use it when' cell reads {use!r}, not {fragment!r}"
            return None

        check("every planned top-level page has one row, with Appendix D's use_when", index_rows_match_appendix)

        def one_row_per_subgroup() -> str | None:
            rows = [row for _g, _p, tables in index_groups for _h, table in tables for row in table]
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
            for _g, _p, tables in index_groups:
                for _h, rows in tables:
                    for label_text, href, _use in rows:
                        for label, directory in targets.items():
                            if label in label_text:
                                if not href:
                                    return f"{label!r} row has no link"
                                found.add(label)
                                listing = read(docs / href) or ""
                                members = sorted((docs / directory).glob("*.html"))
                                for member in members:
                                    if (
                                        f'href="{directory}{member.name}"' not in listing
                                        and f'href="{directory}{member.name}#' not in listing
                                    ):
                                        return f"{label!r} routes to {href}, which does not list {directory}{member.name}"
            if found != set(targets):
                return f"the index has no row for {sorted(set(targets) - found)!r}"
            return None

        check("each subgroup row routes to a page that lists every member", subgroup_rows_route_to_a_listing)

        # -- the HTML index carries the planned pages ------------------------
        def html_index_agrees() -> str | None:
            if index_section is None:
                return f"how-to-read.html has no '{INDEX_HEADING}' section"
            subgroup_hrefs = {SUBSYSTEM_ROW[0]: "master-plan.html", MATRIX_ROW[0]: "diagnosticity.html"}
            for name, _prose, tables in index_groups:
                header, rows = tables[0] if tables else ([], [])
                if header != INDEX_COLUMNS:
                    return f"{name}: HTML table is headed {header!r}, not {INDEX_COLUMNS!r}"
                expected = [
                    (label, path, fragment)
                    for path, (label, group, fragment) in STATIC_PAGES.items()
                    if group == name
                ]
                static_rows = [row for row in rows if row[0] not in SUBGROUP_LABELS]
                if static_rows != expected:
                    return f"{name}: HTML rows {static_rows!r} differ from the planned pages {expected!r}"
                for row in rows:
                    if row[0] in SUBGROUP_LABELS and row[1] != subgroup_hrefs[row[0]]:
                        return f"{name}: the {row[0]!r} row links {row[1]!r}, not {subgroup_hrefs[row[0]]!r}"
            return None

        check("the HTML index has the planned groups, columns and rows", html_index_agrees)
        check("no published page hides its report from assistive technology", lambda: hidden_pages(docs))

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
