#!/usr/bin/env python3
"""Gate for orientation packet O5 — IDs: link every known ID, name first
mentions, explain the letters (design/orientation/PLAN.md §2.2, §1.4, §4 O5,
§5 D1, Appendix B).

Two seeded stores: one whose subsystem letters map one-to-one to layers (Q is
Query, S is Storage), one like AxiomDB's (C and P both in "Contract and
tooling"), which also carries a lowercase subsystem ID and a `B04-R6`-shaped
finding ID.

Turns red when:

  - the guide has no "How IDs are formed" section between Terms and Status
    values, in either view, or it lacks Appendix B's sentence or a row per
    `id_kinds` entry with an example taken from this store, or any row's kind,
    shape, names, chosen-by or links-to cell differs from the contract in
    either view;
  - the guide's letter sentence is wrong for either store: the one-to-one store
    must read "Here the letter is the layer: Q is Query, S is Storage.", the
    AxiomDB-like store must say the letters do not encode anything (§2.2 item 2);
  - `B04-R6` or the lowercase ID `auth` in prose is not linked to its record in
    Markdown, or carries no definition in HTML (§2.2 item 4);
  - the first body mention of a subsystem ID on a page lacks its name beside it,
    in either view, or a second mention on the same page gains one (§2.2 item 3);
  - an ID in a table row that already holds the name (an adjacent Name column)
    gains it again;
  - a concern code in prose lacks the "concern" prefix in its link text, or the
    review-coverage matrix's column header gains one (§2.2 item 5);
  - a second publish over the unchanged store changes any Markdown page (the
    resolver re-runs over its own output, so naming must be idempotent);
  - either resolver's pattern is a fixed shape rather than built from the xref
    index's keys (an ID outside the old shape stays plain);
  - the resolver takes a subsystem's name inside a link destination
    (`[auth](subsystems/auth-login.md)`) for a name the reader sees, so the
    first mention of `auth` (name `login`) gains no name (§2.2 item 3);
  - a concern code the resolver did not write as "concern RC-2" stays bare
    because it is already a link's label or a table row's key cell (§2.2
    item 5 exempts only the review-coverage matrix);
  - the read-back's explanation census misreads what the resolver adds: a
    faithfully published account whose text holds an interior concern code
    ("Review RC-2 before …", printed "concern RC-2") or an ID followed by its
    name in other words ("R-06 — Rule evaluation stores …") is reported
    missing, or deleting an author-written "(Contract checks)" after C-01 from
    both views is not reported;
  - the gate does not run in CI.

Also red when a published HTML page hides its report from assistive technology
(`orientation_exposure.hidden_pages`: `aria-hidden="true"`, `hidden`, `inert`,
an inline `display: none` or `role="presentation"` on `<main>`, the page head,
the article or any element around them), which every text check above reads
straight through.

False green it cannot exclude: the fixture's prose is short, so first-mention
tracking is exercised on a handful of pages, not at AxiomDB's size. The HTML
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
IDS_HEADING = "How IDs are formed"
IDS_LEAD = (
    "IDs are short labels so records can point at each other. Except where this page"
    " says otherwise, the letters are not a code: read the name beside the ID."
)
LETTERS_ARE_LAYERS = "Here the letter is the layer: Q is Query, S is Storage."
LETTERS_ENCODE_NOTHING = (
    "The letters were chosen when the survey began and do not encode anything."
    " Read the name beside the ID."
)

SHA = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"

# (id, name, status, layer)
ALIGNED = (
    ("Q-01", "Query planner", "mapped", "Query"),
    ("Q-02", "Query cache", "structural", "Query"),
    ("S-01", "Page store", "mapped", "Storage"),
)
MIXED = (
    ("C-01", "Contract checks", "mapped", "Contract and tooling"),
    ("P-01", "Packaging", "structural", "Contract and tooling"),
    ("R-06", "Rule evaluation", "mapped", "Reasoning"),
    ("auth", "Sign-in", "scoping", "Service"),
)
# The lead's prose: R-06 twice (first named, second not), C-01 once, the
# lowercase ID, a concern code, and a finding ID outside the old shape.
LEAD = "R-06 calls C-01 twice, and R-06 caches it; auth retries too. RC-2 may apply. See B04-R6."
ENTRY = "Start at R-06. Then read R-06 again."
# Recorded accounts the read-back must find on their pages as written: an
# interior concern code the resolver prefixes, an ID whose name follows in
# other words, and a name the author wrote in brackets.
PROJECT_ACCOUNT = "Review RC-2 before updating the cache."
R06_ACCOUNT = "R-06 — Rule evaluation stores all entries."
C01_ACCOUNT = "The subsystem is C-01 (Contract checks)."
AUTHORED_NAME = " (Contract checks)"


def seed(storage: Path, subsystems: tuple[tuple[str, str, str, str], ...], prose: bool) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-20T12:00:00Z')",
        (SHA, SHA),
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('o5', 'fixture')")
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope) VALUES (?, ?, ?, ?, 'src/x.ts')",
        list(subsystems),
    )
    if prose:
        cur.execute(
            "INSERT INTO concerns (code, category, origin, notes)"
            " VALUES ('RC-2', 'concurrency', 'seeded', 'a race on the rule cache')"
        )
        cur.execute(
            "INSERT INTO dispositions (subsystem_id, concern_code, classification, rationale)"
            " VALUES ('R-06', 'RC-2', 'ruled-out', 'the cache is per request')"
        )
        cur.execute(
            "INSERT INTO seams (id, shared_object, party_a, party_b)"
            " VALUES ('SM-01', 'rule table', 'R-06', 'C-01')"
        )
        cur.execute(
            "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity,"
            " status, session_id)"
            " VALUES ('B04-R6', 'R-06', 'rules evaluate twice', 'the loop re-enters',"
            " 'HIGH', 'confirmed-bug', 'o5')"
        )
        cur.execute(
            "INSERT INTO field_notes (category, observation, session_id) VALUES ('pattern', ?, 'o5')",
            (LEAD,),
        )
        (storage / "entry-point.md").write_text(f"# Where to begin\n\n{ENTRY}\n")
    db.commit()
    db.close()


def seed_accounts(storage: Path) -> None:
    """The mixed store's subsystems and RC-2, with three recorded accounts."""

    seed(storage, MIXED, False)
    db = sqlite3.connect(storage / "memory.db")
    db.execute(
        "INSERT INTO concerns (code, category, origin, notes)"
        " VALUES ('RC-2', 'concurrency', 'seeded', 'a race on the rule cache')"
    )
    db.executemany(
        "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
        " ref_sha, session_id) VALUES (?, ?, 'account', 'recorded', ?, ?, 'o5')",
        [
            ("project", "project", PROJECT_ACCOUNT, SHA),
            ("subsystem", "R-06", R06_ACCOUNT, SHA),
            ("subsystem", "C-01", C01_ACCOUNT, SHA),
        ],
    )
    db.commit()
    db.close()


def explanation_mismatches(summary: dict[str, Any]) -> list[str]:
    """A publish nests its read-back under `readback`; `--readback-only` does not."""

    found = summary.get("mismatches") or (summary.get("readback") or {}).get("mismatches") or []
    return [
        f"{m.get('object_type')} {m.get('object_id')}"
        for m in found
        if str(m.get("object_type", "")).startswith("explanation")
    ]


def publish(storage: Path, *extra: str) -> dict[str, Any]:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage), *extra],
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


def read(path: Path) -> str:
    try:
        return path.read_text()
    except OSError:
        return ""


def snapshot(docs: Path) -> dict[str, str]:
    return {str(p.relative_to(docs)): read(p) for p in sorted(docs.rglob("*.md"))}


# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------
def html_text(fragment: str) -> str:
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", "", fragment)).split())


def md_section(text: str, title: str) -> str | None:
    match = re.search(rf"^## {re.escape(title)}\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    return match.group(1) if match else None


def md_h2(text: str) -> list[str]:
    return [line[3:].strip() for line in text.splitlines() if line.startswith("## ")]


def html_section(page: str, title: str) -> str | None:
    heads = list(re.finditer(r"<h2\b[^>]*>(.*?)</h2>", page, re.S))
    for index, match in enumerate(heads):
        if html_text(match.group(1)).lstrip("§").strip() == title:
            end = heads[index + 1].start() if index + 1 < len(heads) else len(page)
            return page[match.end() : end]
    return None


def article(page: str) -> str:
    found = re.search(r"<article\b.*?</article>", page, re.S)
    return found.group(0) if found else page


def line_with(text: str, needle: str) -> str | None:
    return next((line for line in text.splitlines() if needle in line), None)


def published(summary: dict[str, Any], docs: Path) -> str | None:
    if not summary or summary.get("_returncode") != 0 or summary.get("ok") is False:
        return f"the materializer did not publish the fixture — {summary.get('_diagnostic', summary)}"
    if not (docs / "how-to-read.md").is_file():
        return "docs/how-to-read.md was not written"
    return None


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------
# Appendix B's columns in order; None is "Example here", which comes from the store.
KIND_COLUMNS: tuple[str | None, ...] = ("kind", "shape", "names", "chosen_by", None, "links_to")


def one_cell(value: object) -> str:
    return " ".join(str(value).split()).replace("|", "/")


def guide_checks(name: str, docs: Path, letters: str, wrong: str, kinds: list[dict[str, Any]], examples: dict[str, str]) -> None:
    md = read(docs / "how-to-read.md")
    page = article(read(docs / "how-to-read.html"))

    def placed() -> str | None:
        found = md_h2(md)
        if IDS_HEADING not in found:
            return f"no '## {IDS_HEADING}' section; the guide's H2s are {found}"
        at = found.index(IDS_HEADING)
        if at == 0 or found[at - 1] != "Terms" or at + 1 >= len(found) or found[at + 1] != "Status values":
            return f"'{IDS_HEADING}' sits at {found}, not between Terms and Status values"
        if html_section(page, IDS_HEADING) is None:
            return f"the HTML guide has no '{IDS_HEADING}' section"
        return None

    check(f"{name}: the guide has '{IDS_HEADING}' between Terms and Status values, in both views", placed)

    def lead_and_letters() -> str | None:
        section = md_section(md, IDS_HEADING) or ""
        flat = " ".join(section.split())
        if IDS_LEAD not in flat:
            return "the section lacks Appendix B's sentence"
        if letters not in flat:
            return f"the letter sentence is not {letters!r}; the section reads {flat[len(IDS_LEAD):][:200]!r}"
        if wrong in flat:
            return f"the section also says {wrong!r}, which is wrong for this store"
        body = html_text(html_section(page, IDS_HEADING) or "")
        if letters not in body or IDS_LEAD not in body:
            return "the HTML section lacks the lead or the letter sentence the Markdown has"
        if wrong in body:
            return f"the HTML section says {wrong!r}"
        return None

    check(f"{name}: the guide states what this store's letters mean (§2.2 item 2)", lead_and_letters)

    def kinds_table() -> str | None:
        section = md_section(md, IDS_HEADING) or ""
        rows = [line for line in section.splitlines() if line.startswith("|")][2:]
        if not kinds:
            return "the contract carries no id_kinds"
        if len(rows) != len(kinds):
            return f"the table has {len(rows)} rows for {len(kinds)} id_kinds entries"
        for row, kind in zip(rows, kinds, strict=True):
            cells = [c.strip() for c in row.strip().strip("|").split("|")]
            if cells[0] != kind["kind"]:
                return f"a row starts {cells[0]!r}, expected {kind['kind']!r} in contract order"
            if len(cells) != len(KIND_COLUMNS):
                return f"the {kind['kind']} row has {len(cells)} cells, not {len(KIND_COLUMNS)}"
            for column, (key, cell) in enumerate(zip(KIND_COLUMNS, cells, strict=True)):
                if key and cell != one_cell(kind[key]):
                    return f"the {kind['kind']} row's column {column + 1} is {cell!r}, not its {key} {kind[key]!r}"
            want = examples.get(str(kind["kind"]))
            if want and want not in cells[KIND_COLUMNS.index(None)]:
                return f"the {kind['kind']} row does not give this store's example {want!r}"
        section_html = html_section(page, IDS_HEADING) or ""
        html_rows = [
            [html_text(cell) for cell in re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", tr, re.S)]
            for tr in re.findall(r"<tr\b[^>]*>(.*?)</tr>", section_html, re.S)
        ][1:]
        if len(html_rows) != len(kinds):
            return f"the HTML table has {len(html_rows)} rows for {len(kinds)} id_kinds entries"
        for cells, kind in zip(html_rows, kinds, strict=True):
            if len(cells) != len(KIND_COLUMNS):
                return f"the HTML {kind['kind']} row has {len(cells)} cells, not {len(KIND_COLUMNS)}"
            for column, (key, cell) in enumerate(zip(KIND_COLUMNS, cells, strict=True)):
                if key and cell != html_text(one_cell(kind[key]).replace("`", "")):
                    return f"the HTML {kind['kind']} row's column {column + 1} is {cell!r}, not its {key} {kind[key]!r}"
        return None

    check(f"{name}: one row per ID kind, each with an example from this store", kinds_table)


def prose_checks(docs: Path) -> None:
    leads = read(docs / "field-notes.md")
    lead = line_with(leads, "calls") or ""
    leads_html = article(read(docs / "field-notes.html"))

    def odd_ids_link() -> str | None:
        if not lead:
            return "the lead's line is not on field-notes.md"
        if "[B04-R6](findings.md#b04-r6)" not in lead:
            return f"B04-R6 is not linked to findings.md#b04-r6: {lead[:220]!r}"
        if not re.search(r"\[auth\]\(subsystems/[^)]+\.md\)", lead):
            return f"the lowercase ID auth is not linked to its subsystem page: {lead[:220]!r}"
        if not re.search(r'<abbr class="identifier-definition" title="B04-R6 — [^"]+"', leads_html):
            return "the HTML gives B04-R6 no definition"
        if not re.search(r'<abbr class="identifier-definition" title="auth — Sign-in"', leads_html):
            return "the HTML gives auth no definition"
        return None

    check("B04-R6 and the lowercase auth link and carry a definition (§2.2 item 4)", odd_ids_link)

    def first_mention_named() -> str | None:
        if not re.search(r"\[R-06\]\([^)]+\) \(Rule evaluation\) calls \[C-01\]\([^)]+\) \(Contract checks\) twice", lead):
            return f"the first R-06 and C-01 on field-notes.md lack their names: {lead[:240]!r}"
        if re.search(r"\[auth\]\([^)]+\) \(Sign-in\) retries", lead) is None:
            return f"the first auth on field-notes.md lacks its name: {lead[:240]!r}"
        entry = read(docs / "entry-point.md")
        if not re.search(r"Start at \[R-06\]\([^)]+\) \(Rule evaluation\)\.", entry):
            return f"the first R-06 on entry-point.md lacks its name: {line_with(entry, 'Start at')!r}"
        visible = html_text(leads_html)
        if "R-06 (Rule evaluation) calls C-01 (Contract checks) twice" not in visible:
            return "the HTML lead does not show the names beside the first R-06 and C-01"
        sub = read(docs / "subsystems" / "r06-rule-evaluation.md")
        seam_row = line_with(sub, "rule table")
        if not seam_row or "Contract checks" not in seam_row:
            return f"the first C-01 on R-06's page, in a table with no name column, lacks its name: {seam_row!r}"
        return None

    check("the first body mention of a subsystem ID on a page carries its name (§2.2 item 3)", first_mention_named)

    def later_mentions_plain() -> str | None:
        if lead.count("(Rule evaluation)") != 1 or "R-06" not in lead.split("(Rule evaluation)", 1)[1]:
            return f"the second R-06 on field-notes.md gains its name, or there is no second mention: {lead[:240]!r}"
        entry = read(docs / "entry-point.md")
        if entry.count("Rule evaluation") != 1:
            return f"entry-point.md names R-06 {entry.count('Rule evaluation')} times, wanted once"
        if leads.count("Rule evaluation") != 1:
            return f"field-notes.md prints 'Rule evaluation' {leads.count('Rule evaluation')} times, wanted once"
        return None

    check("a second mention on the same page gains no name", later_mentions_plain)

    def tables_with_names() -> str | None:
        for page, needle in (("master-plan.md", "[R-06]"), ("hot-spots.md", "[R-06]"), ("architecture.md", "| Reasoning |")):
            row = line_with(read(docs / page), needle)
            if row is None:
                return f"{page} has no row for R-06"
            if row.count("Rule evaluation") != 1:
                return f"{page}'s R-06 row prints the name {row.count('Rule evaluation')} times: {row[:200]!r}"
        return None

    check("an ID in a row that already holds its name gains nothing", tables_with_names)

    def concern_prefix() -> str | None:
        if "[concern RC-2](concerns.md#rc-2) may apply" not in lead:
            return f"RC-2 in prose is not linked as 'concern RC-2': {lead[:240]!r}"
        if "concern RC-2 may apply" not in html_text(leads_html):
            return "the HTML lead does not read 'concern RC-2'"
        concerns = read(docs / "concerns.md")
        header = next((line for line in concerns.splitlines() if line.startswith("| Subsystem |")), None)
        if header is None:
            return "concerns.md has no review-coverage matrix"
        if "concern" in header.lower():
            return f"the review-coverage matrix header gained a prefix: {header!r}"
        if 'class="coverage-index"' not in read(docs / "concerns.html"):
            return "concerns.html lost its coverage index"
        return None

    check("a concern code in prose reads 'concern RC-2'; the coverage matrix is left alone (§2.2 item 5)", concern_prefix)


def account_checks(storage: Path) -> None:
    docs = storage / "docs"
    summary = publish(storage)

    def faithful_accounts_read_back() -> str | None:
        missing = explanation_mismatches(summary)
        if missing:
            return f"the read-back reports faithfully published accounts missing: {missing}"
        if summary.get("_returncode") != 0 or summary.get("ok") is False:
            return f"the accounts fixture did not publish — {summary.get('_diagnostic', summary.get('mismatches'))}"
        architecture = read(docs / "architecture.md")
        if "[concern RC-2](concerns.md#rc-2) before updating the cache" not in architecture:
            return "the project account's RC-2 is not printed as 'concern RC-2', so the case is not exercised"
        return None

    check("accounts: the read-back finds accounts the resolver prefixed or left unnamed", faithful_accounts_read_back)

    def authored_name_owed() -> str | None:
        pages = [p for stem in ("c01-*.md", "c01-*.html") for p in sorted((docs / "subsystems").glob(stem))]
        if len(pages) != 2:
            return f"C-01's two views are not published: {[p.name for p in pages]}"
        originals = {p: read(p) for p in pages}
        for p, text in originals.items():
            if AUTHORED_NAME not in text and "(Contract checks)" not in text:
                return f"{p.name} does not carry the authored name to delete"
        try:
            for p, text in originals.items():
                p.write_text(text.replace(AUTHORED_NAME, "", 1) if p.suffix == ".md" else text.replace(" (Contract checks).", ".", 1))
            red = publish(storage, "--readback-only", "--output", str(docs))
        finally:
            for p, text in originals.items():
                p.write_text(text)
        hits = explanation_mismatches(red)
        for kind in ("explanation C-01:account", "explanation-html C-01:account"):
            if kind not in hits:
                return f"deleting the author's '(Contract checks)' from both views is not reported as {kind!r}: {hits}"
        return None

    check("accounts: an author-written name deleted from both views is reported missing", authored_name_owed)


def resolver_reads_visible_text() -> str | None:
    sys.path.insert(0, str(ROOT))
    from amanuensis_materializer import xref  # noqa: PLC0415

    index = xref.XrefIndex(
        entries={
            "auth": ("auth", "subsystems/auth-login.md", "login"),
            "RC-2": ("RC-2", "concerns.md#rc-2", "Concurrency"),
        },
        names={"auth": "login"},
        kinds={"auth": "subsystem", "RC-2": "concern"},
    )
    text = xref.resolve_text("See [auth](subsystems/auth-login.md). Then auth.\n", "index.md", index)
    if "[auth](subsystems/auth-login.md) (login). Then [auth]" not in text:
        return f"a name inside a link destination counted as shown; the first auth gained no name: {text!r}"
    linked = xref.resolve_text("See [RC-2](concerns.md#rc-2).\n", "index.md", index)
    if "[concern RC-2](concerns.md#rc-2)" not in linked:
        return f"an existing link to RC-2 kept a bare label: {linked!r}"
    keyed = xref.resolve_text("| Concern | Classification |\n|---|---|\n| RC-2 | ruled-out |\n", "subsystems/x.md", index)
    if "| [concern RC-2](../concerns.md#rc-2) | ruled-out |" not in keyed:
        return f"a concern code in a row's key cell kept a bare label: {keyed!r}"
    if "concern" in keyed.splitlines()[0].lower().replace("| concern |", ""):
        return f"a table header gained a prefix: {keyed.splitlines()[0]!r}"
    for once in (text, linked, keyed):
        again = xref.resolve_text(once, "subsystems/x.md" if once is keyed else "index.md", index)
        if again != once:
            return f"a second pass changed {once!r} to {again!r}"
    return None


def resolvers_use_index_keys() -> str | None:
    sys.path.insert(0, str(ROOT))
    from amanuensis_materializer import html_projection, xref  # noqa: PLC0415

    index = xref.XrefIndex(entries={"core": ("core", "subsystems/core.md", "Core"), "B04-R6": ("B04-R6", "findings.md#b04-r6", "Finding")})
    text = xref.resolve_text("See core and B04-R6, not ZZ-9.\n", "findings.md", index)
    if "[core](subsystems/core.md)" not in text:
        return f"xref.resolve_text left a lowercase key unlinked: {text!r}"
    if "**B04-R6**" not in text:
        return f"xref.resolve_text did not resolve B04-R6 as a self-reference: {text!r}"
    if "[ZZ-9]" in text:
        return "xref.resolve_text linked an ID the index does not hold"
    markup = html_projection._identifier_markup("<p>core B04-R6 XY-1</p>", {"core": "Core", "B04-R6": "Finding"})
    if markup.count('class="identifier-definition"') != 2:
        return f"the HTML markup did not define both index keys: {markup!r}"
    return None


def main() -> int:
    emit("GATE O5 — IDs: link every known ID, name first mentions, explain the letters")
    emit("")

    kinds: list[dict[str, Any]] = []
    try:
        kinds = list(json.loads(CONTRACT.read_text()).get("id_kinds") or [])
    except Exception as exc:
        FAILURES.append(f"contract: could not read the vocabulary contract — {scrub(repr(exc))}")

    with tempfile.TemporaryDirectory(prefix="o5-gate-") as tmp:
        stores = {
            "aligned": (ALIGNED, False, LETTERS_ARE_LAYERS, LETTERS_ENCODE_NOTHING, {"Subsystem": "Q-01"}),
            "mixed": (
                MIXED,
                True,
                LETTERS_ENCODE_NOTHING,
                "Here the letter is the layer",
                {"Subsystem": "C-01", "Finding": "B04-R6", "Seam": "SM-01", "Concern": "RC-2"},
            ),
        }
        for name, (subsystems, prose, letters, wrong, examples) in stores.items():
            storage = Path(tmp) / name
            storage.mkdir()
            try:
                seed(storage, subsystems, prose)
            except Exception as exc:
                FAILURES.append(f"{name}: could not seed a store — {scrub(repr(exc))}")
                emit(f"  FAIL {name}: could not seed a store — {scrub(repr(exc))}")
                continue
            docs = storage / "docs"
            summary = publish(storage)
            check(f"{name}: the fixture publishes", lambda s=summary, d=docs: published(s, d))
            guide_checks(name, docs, letters, wrong, kinds, examples)
            check(f"{name}: no published page hides its report from assistive technology", lambda d=docs: hidden_pages(d))
            if prose:
                prose_checks(docs)
                first = snapshot(docs)
                again = publish(storage)

                def idempotent(first: dict[str, str] = first, again: dict[str, Any] = again, docs: Path = docs) -> str | None:
                    if published(again, docs):
                        return published(again, docs)
                    second = snapshot(docs)
                    changed = [p for p in first if first[p] != second.get(p)]
                    if changed:
                        return f"a second publish changed {changed[:4]}"
                    return None

                check("mixed: a second publish over the unchanged store changes no Markdown page", idempotent)

        accounts = Path(tmp) / "accounts"
        accounts.mkdir()
        try:
            seed_accounts(accounts)
        except Exception as exc:
            FAILURES.append(f"accounts: could not seed a store — {scrub(repr(exc))}")
            emit(f"  FAIL accounts: could not seed a store — {scrub(repr(exc))}")
        else:
            account_checks(accounts)

    check("both resolvers build their pattern from the index's keys", resolvers_use_index_keys)
    check("the resolver names and prefixes by what the reader sees (§2.2 items 3 and 5)", resolver_reads_visible_text)

    def runs_in_ci() -> str | None:
        ci = read(CI_FILE)
        if "test-orientation-ids.py" not in ci:
            return "test.yml has no step that runs test-orientation-ids.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE O5 RED: {FAILURES[0][:230]}")
        return 1
    emit("GATE O5 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
