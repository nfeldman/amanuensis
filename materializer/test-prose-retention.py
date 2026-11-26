#!/usr/bin/env python3
"""Gate for explanation packet EX2 — prose retention (spec.md §2.1; claims C1,
C2, C3).

Seeds a store in which every model-authored field of `design/reader-lenses/spec.md`
§3.4 carries a unique sentinel, materializes it, and asserts that each sentinel
is on at least one generated page. A field that is deliberately not rendered is
named in `ALLOWLIST` with its reason, and the allowlist is two-sided: an
allowlisted field whose sentinel does appear fails the gate, so the list cannot
go stale.

Turns red when:

  - a seeded field that must render reaches no generated page;
  - `findings.business_context` is not labelled "Why it matters", is not a
    field of the open-finding record after the symptom and before the root
    cause, is printed for a finding with none, is missing from the
    resolved-findings record or from either page's HTML record, or is present
    in a record whose value is empty;
  - either page's HTML record does not put "Why it matters" after the symptom
    and before the root cause;
  - a field holding two paragraphs splits a table row or leaves its record, on
    any page;
  - a scoped vocabulary term prints its gloss and not its expansion;
  - `subsystems.notes` is not under the Scope section as a "Survey note" subsection
    with the fixed label sentence, whether or not the subsystem has claims or an
    artifact, or appears more than once on its page;
  - the allowlist is not empty (the eight seam prose columns left it at SO24, as
    `explanations.body` did at EX11), or lists a field whose sentinel appears;
  - `test-materializer.py` does not assert the "Why it matters" field of the findings record;
  - the gate is not listed in `.github/workflows/test.yml`.

False green it cannot exclude: a field can render somewhere a reader will not
find it. This gate asserts that the text is on a page, not that the page puts it
where it helps.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed, so a missing
deliverable reports as an assertion failure and not as a crash.
"""

from __future__ import annotations

import html as htmllib
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

from store_only_seed import import_body

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
MATERIALIZER_TEST = ROOT / "test-materializer.py"

PACKET = "EX2"
RED_EXPECT = "a model-authored field reaches no generated page"

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
    ("NameError", "name-error"),
    ("Traceback (most recent call last)", "stack trace"),
    ("ENOENT", "PATH-ABSENT"),
    ("is not a function", "is not callable"),
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
# What the specification fixes, written out here rather than imported.
# ---------------------------------------------------------------------------
SHA = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"


def sentinel(field: str) -> str:
    """A string no other seeded field contains and no renderer would rewrite."""

    return f"SENTINEL {field.replace('.', ' ').replace('_', ' ')} 7q3x"


# Every field that must reach a page. `vocabulary.expansion` is seeded twice.
RENDERED_FIELDS: tuple[str, ...] = (
    "subsystems.scope",
    "subsystems.jump_in_reading",
    "subsystems.notes",
    "claims.statement",
    "findings.symptom",
    "findings.root_cause",
    "findings.business_context",
    "dispositions.rationale",
    "finding_resolution_events.rationale",
    "field_notes.observation",
    "open_questions.question",
    "open_questions.what_assumed",
    "open_questions.answer",
    "vocabulary.gloss",
    "vocabulary.expansion.scoped",
    "vocabulary.expansion.global",
    "seams.shared_object",
    "seams.notes",
    # SO24 draws the seam contract (A2) on Boundaries: the four fields and the four assumptions.
    "seams.a_writes",
    "seams.a_reads",
    "seams.b_writes",
    "seams.b_reads",
    "seams.ordering_assumption",
    "seams.cardinality",
    "seams.staleness_tolerance",
    "seams.schema_owner",
    "explanations.body",
    "survey artifact",
)

# EX2 fixed an allowlist of the eight seam prose columns no renderer read. SO24 renders them
# (the seam contract, A2), so they moved to `RENDERED_FIELDS` and the allowlist is empty. The
# machinery stays: a field a renderer stops reading goes back here with its reason, and an
# entry whose sentinel appears fails the gate.
ALLOWLIST: dict[str, str] = {}
EXPECTED_ALLOWLIST: frozenset[str] = frozenset()

# The open-finding record presents these fields in this order (the old record had no Why it matters).
NEW_COLUMNS = ["ID", "Status", "Symptom", "Why it matters", "Root cause", "Revision"]
OLD_COLUMNS = ["ID", "Status", "Symptom", "Root cause", "Revision"]
OLD_HEADER = "| ID | Status | Symptom | Root cause | Ref SHA |"
# The note once opened with this caveat; the owner had it removed (2026-11-25).
SURVEY_NOTE_LABEL = "A note the survey left on the subsystem record; not bound to a revision."

# Subsystems. B-01 carries claims and an artifact, B-02 carries neither, so the
# note is asserted in both states. B-03 has no notes at all.
SUBSYSTEMS = (
    ("B-01", "Read path", "mapped"),
    ("B-02", "Write path", "mapped"),
    ("B-03", "Queue", "mapped"),
)
ARTIFACT_NAME = "B-01-read-path.md"

NO_CONTEXT_FINDING = "B01-2"

# Two-paragraph values. A line break in a table cell ends the row, and what follows
# prints outside the record it belongs to.
TAIL = "Tail paragraph 7q3x."
MULTILINE_TABLE_FIELDS: tuple[tuple[str, str], ...] = (
    ("subsystems", "scope"),
    ("subsystems", "jump_in_reading"),
    ("dispositions", "rationale"),
    ("finding_resolution_events", "rationale"),
    ("field_notes", "observation"),
    ("open_questions", "question"),
    ("open_questions", "what_assumed"),
    ("open_questions", "answer"),
    ("vocabulary", "gloss"),
    ("vocabulary", "expansion"),
    ("seams", "shared_object"),
    ("seams", "notes"),
)


def multiline(column: str) -> tuple[str, str]:
    name = column.replace("_", " ")
    return (f"First paragraph of {name}.", f"Second paragraph of {name}.")


def seed(storage: Path) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-05T12:00:00Z')",
        (SHA, SHA),
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('ex2', 'fixture')")
    for sid, name, status in SUBSYSTEMS:
        scope = sentinel("subsystems.scope") if sid == "B-01" else None
        jump = sentinel("subsystems.jump_in_reading") if sid == "B-01" else None
        notes = {
            "B-01": sentinel("subsystems.notes"),
            "B-02": sentinel("subsystems.notes") + " second",
        }.get(sid)
        cur.execute(
            "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading, notes)"
            " VALUES (?, ?, ?, 'backend', ?, ?, ?)",
            (sid, name, status, scope, jump, notes),
        )
    cur.execute(
        "INSERT INTO claims (claim_id, claim_key, subject_type, subject_id, statement,"
        " epistemic_kind, asserted_at_sha, valid_from_sha, session_id)"
        " VALUES ('c1', 'B-01/contracts/reader', 'subsystem', 'B-01', ?,"
        " 'observation', ?, ?, 'ex2')",
        (sentinel("claims.statement"), SHA, SHA),
    )
    cur.execute(
        "INSERT INTO concerns (code, category, origin, status)"
        " VALUES ('SC-1', 'composition', 'seeded', 'active')"
    )
    cur.execute(
        "INSERT INTO dispositions (subsystem_id, concern_code, classification,"
        " evidence_quality, rationale, ref_sha, session_id, pass_type)"
        " VALUES ('B-01', 'SC-1', 'confirmed-acceptable', 'code-verified', ?, ?,"
        " 'ex2', 'survey')",
        (sentinel("dispositions.rationale"), SHA),
    )
    # An open finding with business context, an open one without, and a ruled-out
    # one with context whose resolution rationale is the sentinel.
    findings = (
        ("B01-1", "HIGH", "confirmed-bug", "findings.business_context", "open"),
        (NO_CONTEXT_FINDING, "LOW", "confirmed-bug", None, "open"),
        ("B01-3", "MEDIUM", "ruled-out", "findings.business_context resolved", "ruled-out"),
    )
    for fid, severity, status, context, state in findings:
        cur.execute(
            "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity,"
            " status, primary_files, business_context, ref_sha, session_id, pass_type)"
            " VALUES (?, 'B-01', ?, ?, ?, ?, '[]', ?, ?, 'ex2', 'survey')",
            (
                fid,
                sentinel("findings.symptom") + f" {fid}",
                sentinel("findings.root_cause") + f" {fid}",
                severity,
                status,
                sentinel(context) if context else None,
                SHA,
            ),
        )
        cur.execute(
            "INSERT INTO finding_resolution_events (finding_id, resolution_state, rationale,"
            " session_id) VALUES (?, ?, ?, 'ex2')",
            (fid, state, sentinel("finding_resolution_events.rationale")),
        )
    cur.execute(
        "INSERT INTO field_notes (category, observation, location, ref_sha, session_id)"
        " VALUES ('pattern', ?, 'B-01', ?, 'ex2')",
        (sentinel("field_notes.observation"), SHA),
    )
    cur.execute(
        "INSERT INTO open_questions (category, subsystem_id, question, what_assumed,"
        " session_id, ref_sha) VALUES ('domain-knowledge', 'B-01', ?, ?, 'ex2', ?)",
        (sentinel("open_questions.question"), sentinel("open_questions.what_assumed"), SHA),
    )
    cur.execute(
        "INSERT INTO open_questions (category, subsystem_id, question, session_id, ref_sha,"
        " resolution, answer, resolved_at) VALUES ('domain-knowledge', 'B-01', ?, 'ex2', ?,"
        " 'answered', ?, '2026-11-05T12:00:00Z')",
        (
            sentinel("open_questions.question") + " answered",
            SHA,
            sentinel("open_questions.answer"),
        ),
    )
    cur.execute(
        "INSERT INTO vocabulary (term, gloss, expansion, subsystem_id, first_seen, ref_sha)"
        " VALUES ('row buffer', ?, ?, 'B-01', 'src/reader.ts', ?)",
        (
            sentinel("vocabulary.gloss"),
            sentinel("vocabulary.expansion.scoped"),
            SHA,
        ),
    )
    cur.execute(
        "INSERT INTO vocabulary (term, gloss, expansion, subsystem_id, first_seen, ref_sha)"
        " VALUES ('page frame', ?, ?, NULL, 'src/frame.ts', ?)",
        (
            sentinel("vocabulary.gloss") + " global",
            sentinel("vocabulary.expansion.global"),
            SHA,
        ),
    )
    cur.execute(
        "INSERT INTO seams (id, shared_object, party_a, party_b, a_writes, a_reads,"
        " b_writes, b_reads, ordering_assumption, cardinality, staleness_tolerance,"
        " schema_owner, notes) VALUES ('SM-01', ?, 'B-01', 'B-02', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            sentinel("seams.shared_object"),
            sentinel("seams.a_writes"),
            sentinel("seams.a_reads"),
            sentinel("seams.b_writes"),
            sentinel("seams.b_reads"),
            sentinel("seams.ordering_assumption"),
            sentinel("seams.cardinality"),
            sentinel("seams.staleness_tolerance"),
            sentinel("seams.schema_owner"),
            sentinel("seams.notes"),
        ),
    )
    cur.execute(
        "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
        " ref_sha, session_id) VALUES ('subsystem', 'B-01', 'account', 'recorded', ?, ?, 'ex2')",
        (sentinel("explanations.body"), SHA),
    )
    # The survey body reaches the page from the store's import, not from a file.
    import_body(
        db,
        ARTIFACT_NAME,
        "subsystem-survey",
        f"# Read path\n\n{sentinel('survey artifact')}\n",
        session_id="ex2",
        subsystem_id="B-01",
        ref_sha=SHA,
        registered_hash="abc123abc123",
    )
    db.commit()
    db.close()


def publish(storage: Path) -> dict[str, object]:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage)],
        capture_output=True,
        text=True,
        check=False,
    )
    return {"returncode": proc.returncode, "diagnostic": scrub(proc.stderr)[-300:]}


def read(path: Path) -> str:
    try:
        return path.read_text()
    except OSError:
        return ""


BLOCK_TAGS = r"p|li|ul|ol|div|h[1-6]|section|article|header|footer|tr|td|th|br|dl|dt|dd|blockquote|table|caption"
HEADING = re.compile(r"(?is)<h([1-6])\b[^>]*>(.*?)</h\1>")


def visible(markup: str) -> str:
    """The reader's text of an HTML fragment: scripts, styles and heading anchors dropped, block
    boundaries read as spaces, inline tags as nothing, entities decoded, whitespace collapsed."""

    body = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", markup)
    body = re.sub(r'(?is)<a class="heading-anchor"[^>]*>.*?</a>', "", body)
    body = re.sub(rf"(?i)</?(?:{BLOCK_TAGS})\b[^>]*>", " ", body)
    body = re.sub(r"<[^>]+>", "", body)
    return " ".join(htmllib.unescape(body).split())


def article_of(markup: str) -> str:
    """The report an HTML page carries: its content article, without the navigation around it."""

    start = markup.find('<article class="content')
    end = markup.rfind("</article>")
    return markup[start:end] if 0 <= start < end else ""


def headings(markup: str, level: int | None = None) -> list[str]:
    """The text of the report's headings, of one level or of every level."""

    body = article_of(markup) or markup
    return [visible(m.group(2)) for m in HEADING.finditer(body) if level is None or int(m.group(1)) == level]


def section(markup: str, heading: str, level: int = 2) -> str:
    """The HTML of one section: from the heading of this text and level to the next heading of
    its level or higher. It reads a page's report, or a fragment of one."""

    body = article_of(markup) or markup
    found = -1
    for match in HEADING.finditer(body):
        depth = int(match.group(1))
        if found < 0:
            if depth == level and visible(match.group(2)) == heading:
                found = match.end()
        elif depth <= level:
            return body[found : match.start()]
    return body[found:] if found >= 0 else ""


def subsystem_page(docs: Path, sid: str) -> str:
    pages = sorted((docs / "subsystems").glob(f"{sid.lower().replace('-', '')}-*.html"))
    return read(pages[0]) if pages else ""


def open_record(markup: str, fid: str) -> str:
    """The open-finding record of one finding on findings.html."""

    match = re.search(
        rf'<article class="record record-finding"[^>]*data-record-label="finding {fid}".*?</article>',
        markup,
        re.S,
    )
    return match.group(0) if match else ""


def record_columns(record: str) -> tuple[list[str], list[str]]:
    """The columns an open-finding record presents, in reading order, and their values: its ID,
    status, symptom (the lede, then any "Observed behavior" the symptom's later paragraphs
    became), each other labelled field, and its revision."""

    ident = re.search(r'(?is)<h4 class="record-primary"[^>]*>(.*?)</h4>', record)
    facts = {
        visible(term): visible(value)
        for term, value in re.findall(r'(?is)<div class="record-fact[^"]*"><dt>(.*?)</dt><dd>(.*?)</dd></div>', record)
    }
    lede = re.search(r'(?is)<p class="record-lede">(.*?)</p>', record)
    fields = [
        (visible(label), visible(copy))
        for label, copy in re.findall(
            r'(?is)<div class="record-field"><p class="record-label">(.*?)</p><div class="record-copy">(.*?)</div></div>',
            record,
        )
    ]
    symptom = " ".join([visible(lede.group(1)) if lede else ""] + [v for k, v in fields if k == "Observed behavior"])
    rest = [(k, v) for k, v in fields if k != "Observed behavior"]
    columns = ["ID", "Status", "Symptom", *(k for k, _ in rest), "Revision"]
    cells = [visible(ident.group(1)) if ident else "", facts.get("Status", ""), symptom, *(v for _, v in rest), facts.get("Revision", "")]
    return columns, cells


def resolved_block(markup: str, fid: str) -> str:
    """The resolved-finding record of one finding: from its anchor to the end of its list."""

    match = re.search(rf'<span id="{fid.lower()}" class="record-anchor"></span>.*?</ul>', markup, re.S)
    return match.group(0) if match else ""


def main() -> int:
    emit("GATE EX2 — prose retention: every model-authored field reaches a page")
    emit("")
    root = Path(tempfile.mkdtemp(prefix="amanuensis-ex2-"))
    try:
        storage = root / "store"
        storage.mkdir()
        seed_error: str | None = None
        try:
            seed(storage)
        except Exception as exc:
            seed_error = f"the fixture could not be seeded — {scrub(exc)}"
        outcome = publish(storage) if seed_error is None else {}
        docs = storage / "docs"
        pages = {
            str(p.relative_to(docs)): read(p) for p in sorted(docs.rglob("*.html"))
        }
        corpus = "\n".join(visible(markup) for markup in pages.values())

        # -- 1. the first assertion: every field reaches a page ----------------
        def reaches_a_page() -> str | None:
            if seed_error:
                return seed_error
            if outcome.get("returncode") != 0:
                return f"the materializer failed — {outcome.get('diagnostic')}"
            missing = [f for f in RENDERED_FIELDS if sentinel(f) not in corpus]
            if missing:
                return f"{RED_EXPECT}: {', '.join(missing)}"
            return None

        check("every seeded field reaches at least one generated page", reaches_a_page)

        # -- 2. the allowlist is exactly the eight seam columns, two-sided ----
        def allowlist_is_exact() -> str | None:
            if set(ALLOWLIST) != EXPECTED_ALLOWLIST or ALLOWLIST:
                return f"the allowlist is {sorted(ALLOWLIST)}"
            if any(not reason for reason in ALLOWLIST.values()):
                return "an allowlist entry has no reason"
            return None

        check(
            "the allowlist is empty: the eight seam prose columns render",
            allowlist_is_exact,
        )

        def allowlist_is_not_stale() -> str | None:
            if seed_error or outcome.get("returncode") != 0:
                return "the store was not published"
            appearing = [f for f in ALLOWLIST if sentinel(f) in corpus]
            if appearing:
                return f"allowlisted but rendered, so the entry is stale: {appearing}"
            return None

        check("no allowlisted field is rendered (two-sided)", allowlist_is_not_stale)

        # The two-sided check must itself fail on a stale entry: re-run its
        # predicate against a corpus that carries one allowlisted sentinel.
        def two_sided_has_teeth() -> str | None:
            planted = corpus + "\n" + sentinel("seams.a_writes")
            probe = {**ALLOWLIST, "seams.a_writes": "a stale entry planted by the control"}
            appearing = [f for f in probe if sentinel(f) in planted]
            return None if appearing == ["seams.a_writes"] else "the stale-entry control passed"

        check("the two-sided control turns red on a stale entry", two_sided_has_teeth)

        # -- 3. findings: Why it matters ---------------------------------------
        findings_html = pages.get("findings.html", "")
        resolved_html = pages.get("resolved-findings.html", "")

        def open_table() -> str | None:
            columns: dict[str, list[str]] = {}
            cells: dict[str, list[str]] = {}
            for fid in ("B01-1", NO_CONTEXT_FINDING):
                record = open_record(findings_html, fid)
                if not record:
                    return f"findings.html has no record for {fid}"
                columns[fid], cells[fid] = record_columns(record)
            if columns["B01-1"] != NEW_COLUMNS:
                return f"findings.html's record for B01-1 presents {columns['B01-1']}, not {NEW_COLUMNS}"
            if columns["B01-1"] == OLD_COLUMNS:
                return "findings.html still carries the old five-column record"
            with_context = cells["B01-1"]
            if len(with_context) != 6:
                return f"the record for B01-1 has {len(with_context)} cells, not 6"
            if sentinel("findings.business_context") not in with_context[3]:
                return "the Why it matters cell of B01-1 is not the fourth column"
            if sentinel("findings.symptom") not in with_context[2]:
                return "the symptom is not the third column"
            if sentinel("findings.root_cause") not in with_context[4]:
                return "the root cause is not the fifth column"
            if columns[NO_CONTEXT_FINDING] != OLD_COLUMNS:
                return (
                    "the record of a finding with no business context presents"
                    f" {columns[NO_CONTEXT_FINDING]}, not {OLD_COLUMNS}: its Why it matters is not left out"
                )
            return None

        check("open findings carry Why it matters between symptom and root cause", open_table)

        def resolved_record() -> str | None:
            record = visible(resolved_block(resolved_html, "B01-3"))
            if not record:
                return "resolved-findings.html has no record for B01-3"
            label = "Why it matters"
            if label not in record:
                return "the resolved record has no Why it matters field"
            if sentinel("findings.business_context resolved") not in record:
                return "the resolved record does not carry the business context"
            at = {k: record.find(k) for k in (sentinel("findings.symptom"), label, "Root cause")}
            symptom_at, why_at, root_at = at.values()
            if not (0 <= symptom_at < why_at < root_at):
                return "Why it matters is not after the symptom and before the root cause"
            return None

        check("resolved findings carry Why it matters in order", resolved_record)

        def resolved_omits_empty() -> str | None:
            planted = scrub_empty_context()
            return planted

        def scrub_empty_context() -> str | None:
            # Materialize a second store whose resolved finding has no context.
            alt = root / "store-empty"
            alt.mkdir()
            seed(alt)
            db = sqlite3.connect(alt / "memory.db")
            db.execute("UPDATE findings SET business_context = NULL WHERE finding_id = 'B01-3'")
            db.commit()
            db.close()
            result = publish(alt)
            if result.get("returncode") != 0:
                return f"the second store did not publish — {result.get('diagnostic')}"
            record = visible(resolved_block(read(alt / "docs" / "resolved-findings.html"), "B01-3"))
            if not record:
                return "the second store's resolved page has no record for B01-3"
            if "Why it matters" in record:
                return "a resolved finding with no business context still prints Why it matters"
            return None

        check("a resolved finding with no business context omits the field", resolved_omits_empty)

        def html_records() -> str | None:
            for page, fid, text in (
                ("findings.html", "B01-1", sentinel("findings.business_context")),
                (
                    "resolved-findings.html",
                    "B01-3",
                    sentinel("findings.business_context resolved"),
                ),
            ):
                html = read(docs / page)
                if text not in html:
                    return f"{page} does not carry the business context of {fid}"
                if "Why it matters" not in html:
                    return f"{page} has no Why it matters label"
            html = read(docs / "findings.html")
            if html.count("Why it matters") != 1:
                return (
                    "findings.html labels Why it matters"
                    f" {html.count('Why it matters')} times, not once (B01-2 has none)"
                )
            return None

        check("both pages' HTML records carry Why it matters where non-empty", html_records)

        def html_field_order() -> str | None:
            def ordered(where: str, record: str, fid: str, why: str, root: str, context: str) -> str | None:
                positions = [
                    ("the symptom", record.find(sentinel("findings.symptom"))),
                    ("the Why it matters label", record.find(why)),
                    ("the business context", record.find(context)),
                    ("the Root cause label", record.find(root)),
                    ("the root cause", record.find(sentinel("findings.root_cause"))),
                ]
                for name, at in positions:
                    if at < 0:
                        return f"{where}'s record for {fid} has no {name}"
                for (before, a), (after, b) in zip(positions, positions[1:], strict=False):
                    if a >= b:
                        return f"{where}'s record for {fid} puts {after} before {before}"
                return None

            def article(page: str, fid: str) -> str:
                match = re.search(
                    rf'<article class="record record-finding"[^>]*data-record-label="finding {fid}".*?</article>',
                    page,
                    re.S,
                )
                return match.group(0) if match else ""

            html = read(docs / "findings.html")
            label = '<p class="record-label">{}</p>'
            reason = ordered(
                "findings.html",
                article(html, "B01-1"),
                "B01-1",
                label.format("Why it matters"),
                label.format("Root cause"),
                sentinel("findings.business_context"),
            )
            if reason:
                return reason
            empty = article(html, NO_CONTEXT_FINDING)
            if not empty:
                return f"findings.html has no record for {NO_CONTEXT_FINDING}"
            if "Why it matters" in empty:
                return f"findings.html's record for {NO_CONTEXT_FINDING} prints Why it matters with no value"

            resolved = read(docs / "resolved-findings.html")
            start = resolved.find('id="b01-3"')
            end = resolved.find("</ul>", start)
            if start < 0 or end < 0:
                return "resolved-findings.html has no record for B01-3"
            return ordered(
                "resolved-findings.html",
                resolved[start:end],
                "B01-3",
                "<strong>Why it matters</strong>",
                "<strong>Root cause</strong>",
                sentinel("findings.business_context resolved"),
            )

        check("each HTML record orders symptom, Why it matters, root cause", html_field_order)

        def multiline_store() -> Path | str:
            """A store whose authored fields each hold two paragraphs."""

            alt = root / "store-multiline"
            alt.mkdir()
            seed(alt)
            db = sqlite3.connect(alt / "memory.db")
            for column in ("symptom", "business_context", "root_cause"):
                db.execute(
                    f"UPDATE findings SET {column} = ? WHERE finding_id IN ('B01-1', 'B01-3')",
                    (f"{multiline(column)[0]}\n\n{multiline(column)[1]}",),
                )
            for table, column in MULTILINE_TABLE_FIELDS:
                db.execute(f"UPDATE {table} SET {column} = {column} || ?", (f"\n\n{TAIL}",))
            db.commit()
            db.close()
            result = publish(alt)
            if result.get("returncode") != 0:
                return f"the multi-paragraph store did not publish — {result.get('diagnostic')}"
            return alt / "docs"

        multiline_docs = multiline_store()

        def open_multiline() -> str | None:
            if isinstance(multiline_docs, str):
                return multiline_docs
            html = read(multiline_docs / "findings.html")
            records = len(re.findall(r'data-record-label="finding B01-1"', html))
            if records != 1:
                return f"findings.html has {records} records for B01-1"
            record = open_record(html, "B01-1")
            if not record:
                return "findings.html has no record for B01-1"
            columns, cells = record_columns(record)
            if columns != NEW_COLUMNS or len(cells) != 6:
                return (
                    "a two-paragraph field split the record for B01-1:"
                    f" it presents {columns} with {len(cells)} cells"
                )
            for at, column in ((2, "symptom"), (3, "business_context"), (4, "root_cause")):
                first, second = multiline(column)
                if first not in cells[at] or second not in cells[at]:
                    return f"the {column} cell of B01-1 does not carry both paragraphs"
            outside = re.sub(r"<[^>]+>", " ", html.replace(record, ""))
            for column in ("symptom", "business_context", "root_cause"):
                for paragraph in multiline(column):
                    if paragraph not in record:
                        return f"the HTML record of B01-1 does not carry {column}: {paragraph}"
                    if paragraph in outside:
                        return f"findings.html prints {paragraph} outside its record"
            if SHA[:8] not in record:
                return "the HTML record of B01-1 does not carry its revision"
            return None

        check("a two-paragraph field stays inside its open-finding record", open_multiline)

        def resolved_multiline() -> str | None:
            if isinstance(multiline_docs, str):
                return multiline_docs
            record = resolved_block(read(multiline_docs / "resolved-findings.html"), "B01-3")
            if not record:
                return "resolved-findings.html has no record for B01-3"
            lines = [visible(item) for item in re.findall(r"(?is)<li\b[^>]*>(.*?)</li>", record)]
            for label, column in (("Why it matters", "business_context"), ("Root cause", "root_cause")):
                item = next((ln for ln in lines if ln.startswith(f"{label} — ")), "")
                first, second = multiline(column)
                if first not in item or second not in item:
                    return f"a two-paragraph {column} left the {label} item of B01-3"
            return None

        check("a two-paragraph field stays inside its resolved-finding item", resolved_multiline)

        def tables_hold_rows() -> str | None:
            if isinstance(multiline_docs, str):
                return multiline_docs
            for path in sorted(multiline_docs.rglob("*.html")):
                for table in re.findall(r"(?is)<table\b.*?</table>", read(path)):
                    widths = {len(re.findall(r"(?is)<t[dh]\b", row)) for row in re.findall(r"(?is)<tr\b.*?</tr>", table)}
                    if len(widths) > 1:
                        return f"{path.name} has a table row a line break split: rows of {sorted(widths)} cells"
                    for cell in re.findall(r"(?is)<td\b.*?</td>", table):
                        if TAIL in visible(cell) and "SENTINEL" not in visible(cell):
                            return f"{path.name} has a table cell holding {TAIL!r} apart from its field: {visible(cell)[:60]}"
            return None

        check("a two-paragraph field splits no table row on any page", tables_hold_rows)

        # -- 4. the vocabulary page renders a scoped expansion ----------------
        def scoped_expansion() -> str | None:
            vocab = pages.get("vocabulary.html", "")
            # The renderer links the subsystem id, so the heading is matched by
            # its leading words and the id inside it.
            scoped_heading = next(
                (h for h in headings(vocab, 2) if h.startswith("Scoped to ") and "B-01" in h),
                "",
            )
            scoped = visible(section(vocab, scoped_heading)) if scoped_heading else ""
            if sentinel("vocabulary.expansion.scoped") not in scoped:
                return "the scoped term's expansion is not under its subsystem heading"
            if sentinel("vocabulary.gloss") not in scoped:
                return "the scoped term's gloss is not under its subsystem heading"
            glob = visible(section(vocab, "page frame", level=3))
            if sentinel("vocabulary.expansion.global") not in glob:
                return "the codebase-wide term lost its expansion"
            return None

        check("a scoped vocabulary term renders its expansion", scoped_expansion)

        # -- 5. the survey note under Scope ------------------------------------
        def survey_note(sid: str) -> Callable[[], str | None]:
            def run() -> str | None:
                page = subsystem_page(docs, sid)
                if not page:
                    return f"no page for {sid}"
                scope = section(page, "Scope")
                note = section(scope, "Survey note", level=3)
                if not note:
                    return "there is no Survey note under Scope"
                if SURVEY_NOTE_LABEL in visible(page):
                    return "the Survey note still opens with the removed caveat sentence"
                if sentinel("subsystems.notes") not in visible(note):
                    return "the notes are not under the Survey note heading"
                seen = visible(article_of(page)).count(sentinel("subsystems.notes"))
                if seen != 1:
                    return f"the notes appear {seen} times on the page, not once"
                if headings(page).count("Survey note") != 1:
                    return "the Survey note heading does not appear exactly once"
                return None

            return run

        check("B-01 (claims and an artifact) shows its survey note once", survey_note("B-01"))
        check("B-02 (no claims, no artifact) shows its survey note once", survey_note("B-02"))

        def no_note_when_empty() -> str | None:
            if "Survey note" in visible(article_of(subsystem_page(docs, "B-03"))):
                return "a subsystem with no notes prints a Survey note"
            return None

        check("a subsystem with no notes prints no Survey note", no_note_when_empty)

        # §2.1: an H3 under Scope, never a new H2, whatever the note holds. The old
        # fallback nested the note; moving it under Scope lost that (F17/claude, final).
        def note_cannot_open_a_section() -> str | None:
            if seed_error:
                return seed_error
            nested = root / "nested-note"
            nested.mkdir()
            seed(nested)
            db = sqlite3.connect(nested / "memory.db")
            db.execute(
                "UPDATE subsystems SET notes = ? WHERE id = 'B-03'",
                ("A note.\n\n## Note heading\n\nBelow it.\n\n# Note title\n\nEnd.",),
            )
            db.commit()
            db.close()
            done = publish(nested)
            if done.get("returncode") != 0:
                return f"the materializer failed — {done.get('diagnostic')}"
            text = subsystem_page(nested / "docs", "B-03")
            outline = headings(text, 2)
            for heading in ("Note heading", "Note title"):
                if heading in outline:
                    return f"the survey note opened a new section: {heading!r}"
                if heading not in visible(section(section(text, "Scope"), "Survey note", level=3)):
                    return f"{heading!r} is not under the Survey note heading"
            return None

        check("a survey note cannot open a section on the page", note_cannot_open_a_section)

        # §0.4: what the materializer emits follows this file (F20/claude, final).
        def style_names_the_field() -> str | None:
            style = read(ROOT.parent / ".claude" / "skills" / "amanuensis" / "references" / "reporting-style.md")
            if "**Why it matters**" not in style:
                return "reporting-style.md does not place Why it matters in the finding record"
            return None

        check("the reporting style places Why it matters in the finding record", style_names_the_field)

        def fallback_removed() -> str | None:
            page = subsystem_page(docs, "B-02")
            structure = visible(section(page, "Structure"))
            if sentinel("subsystems.notes") in structure:
                return "the old no-claims fallback still prints the notes under Structure"
            return None

        check("the notes fallback under Structure is removed", fallback_removed)

        # -- 6. the old header literal is replaced in the existing test --------
        def header_literal() -> str | None:
            text = read(MATERIALIZER_TEST)
            asserted = [ln for ln in text.splitlines() if re.match(r"\s*assert\b", ln) and "Why it matters" in ln]
            if not asserted:
                return "test-materializer.py does not assert the Why it matters field of the findings record"
            if f'"{OLD_HEADER}" in findings' in text:
                return "test-materializer.py still asserts the old header"
            return None

        check("test-materializer.py asserts the Why it matters field of the findings record", header_literal)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    # -- CI ------------------------------------------------------------------
    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if not text:
            return "the CI workflow .github/workflows/test.yml is not readable"
        if "test-prose-retention.py" not in text:
            return "the workflow does not run test-prose-retention.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE {PACKET} RED: {FAILURES[0].split(': ', 1)[1]}")
        return 1
    emit(f"GATE {PACKET} GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
