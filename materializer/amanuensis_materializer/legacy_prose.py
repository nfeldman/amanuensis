"""Imported bodies: prose an earlier version had the survey write by hand.

Store-only PLAN §3.3, §3.4 and §5.4. `import_artifact_bodies` copies every
hand-written file into `imported_artifacts` as written, and the pages read the
copy and never the file. These bodies are full Markdown (headings, tables,
fences), so they are the one input that is still Markdown once stored prose has
its own grammar; this module is where that input is read.

What it owns:

- which imports a page may print: a row with no withdrawal, since a subsystem
  reset retires a body by appending a withdrawal and never by deleting it;
- the label every imported body is printed under, which says when and at which
  revision it was written and that nothing ties it to evidence;
- the heading shift that keeps a body written as a document of its own from
  closing the page section it sits in;
- the source hash a page records for the imports it printed, so a withdrawal or a
  new import re-renders the page.

- the page blocks an imported body is read into (`render_body`): the block grammar
  of today's parser, the record-list projections included, so a body prints as it
  always did.

A store that has not been opened by a server carrying the tables reads as one
with no imports.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from typing import Any

from .db import rows, table_exists
from .html_projection import _MarkdownParser
from .manifest import sha256_json
from .page import Block, Section

# CommonMark fences: three or more backticks or tildes, indented at most three
# spaces.  Tracking only the backtick form let a `~~~` block's contents through
# as prose, and a `#` inside one was demoted as if it were a document heading
# (slice-S3, F10/codex).
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")

_LINE_BREAK = re.compile(r"\r\n|[\n\r\v\f\x1c\x1d\x1e\x85  ]")


def nest_headings(text: str, under: int) -> str:
    """Shift a recorded document's ATX headings beneath a page heading.

    An artifact was written as a document of its own and opens at `#`.  Rendered
    verbatim inside a page section, its first heading would close the section it
    was placed in and the reader would be told the narrative sits somewhere it
    does not.  Only the heading *level* moves; the heading text, the order, and
    every other line are the recorded bytes.  Levels saturate at six rather than
    wrapping, so a deeply nested source flattens instead of re-opening the page.
    A line ends at every break the HTML projection's `splitlines()` recognizes, so
    a heading cannot wait behind a carriage return; each such break becomes a
    newline on the page.
    """

    out: list[str] = []
    fence: tuple[str, int] | None = None
    for line in _LINE_BREAK.split(text):
        opener = FENCE.match(line)
        if fence is None:
            # CommonMark: a fence opens on three or more backticks or tildes.
            if opener:
                fence = (opener.group(1)[0], len(opener.group(1)))
        elif opener and opener.group(1)[0] == fence[0] and len(opener.group(1)) >= fence[1]:
            # …and closes only on the same character, at least as long. A
            # shorter run, or the other character, is content.
            fence = None
        if fence is None and not opener:
            match = re.match(r"^(#{1,6})(\s)", line)
            if match:
                level = min(6, len(match.group(1)) + under)
                line = "#" * level + line[len(match.group(1)) :]
        out.append(line)
    return "\n".join(out)


def render_body(text: str, *, under: int, section: str, path: str) -> tuple[Block, ...]:
    """An imported body as page blocks, its headings moved `under` levels down.

    The body is full Markdown (headings, tables, fences, record-list tables), so
    it is read with the parser's block grammar, as it always was; this is the one
    place a page's blocks still come from Markdown. It is read as the content of
    a level-2 section titled `section`, which is what names its tables' captions,
    so the body prints exactly as it did when it sat inside that section of the
    page's Markdown. `under` must be 2 or more: a body whose headings reached
    level 2 would close the section it sits in.
    """

    if under < 2:
        raise ValueError("an imported body's headings must move beneath the section's own")
    body = nest_headings(text.strip(), under)
    if not body.strip():
        return ()
    page = _MarkdownParser(path).parse(f"## {section}\n\n{body}")
    held = page.blocks[0]
    assert isinstance(held, Section)
    out = list(held.blocks[1:])
    # A level-2 heading that survives the shift (one inside a `~~~` fence, which
    # the parser does not read as a fence) opens another section in the parser's
    # reading. Its content stays on the page, under the section it was written in.
    for later in page.blocks[1:]:
        out += later.blocks if isinstance(later, Section) else (later,)
    return tuple(out)


#: The pages the imports of one kind are printed on, as `(page path, kind)`.
#: Master plan, findings index and field notes are held, not rendered (§5.4):
#: the pages already print the tables they duplicated.
IMPORTED_PAGES: tuple[tuple[str, str], ...] = (
    ("concern-checklist.md", "concern-checklist"),
    ("onboarding-report.md", "onboarding-report"),
    ("entry-point.md", "entry-point"),
)

EDITED_SENTENCE = "It was edited after it was registered."
NOT_RECORDED = "not recorded"


@dataclass(frozen=True)
class ImportedBody:
    """One import a page may print."""

    path: str
    kind: str
    subsystem_id: str | None
    body: str
    body_sha256: str
    registered_hash: str
    hash_matches: bool
    ref_sha: str
    written_at: str

    @property
    def date(self) -> str:
        """The date the file was written: the first ten characters of its stamp."""

        return self.written_at[:10] or NOT_RECORDED

    @property
    def revision(self) -> str:
        return self.ref_sha[:8] or NOT_RECORDED

    def label(self) -> str:
        """The line an imported body is printed under (§5.4)."""

        text = (
            f"As written at {self.date}, revision `{self.revision}`;"
            " kept as written, not tied to evidence."
        )
        return f"*{text} {EDITED_SENTENCE}*" if not self.hash_matches else f"*{text}*"


def imported_bodies(
    conn: sqlite3.Connection, *, kind: str | None = None, subsystem_id: str | None = None
) -> list[ImportedBody]:
    """The imports with no withdrawal, in the order they were imported."""

    if not table_exists(conn, "imported_artifacts"):
        return []
    clauses = []
    params: list[Any] = []
    if table_exists(conn, "imported_artifact_withdrawals"):
        clauses.append(
            "NOT EXISTS (SELECT 1 FROM imported_artifact_withdrawals w WHERE w.path = a.path)"
        )
    if kind is not None:
        clauses.append("a.kind = ?")
        params.append(kind)
    if subsystem_id is not None:
        clauses.append("a.subsystem_id = ?")
        params.append(subsystem_id)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    return [
        ImportedBody(
            path=str(r["path"]),
            kind=str(r["kind"]),
            subsystem_id=r["subsystem_id"],
            body=str(r["body"]),
            body_sha256=str(r["body_sha256"]),
            registered_hash=str(r["registered_hash"] or ""),
            hash_matches=bool(r["hash_matches"]),
            ref_sha=str(r["registered_ref_sha"] or ""),
            written_at=str(r["written_at"] or ""),
        )
        for r in rows(
            conn,
            "SELECT a.path, a.kind, a.subsystem_id, a.body, a.body_sha256, a.registered_hash,"
            " a.hash_matches, a.registered_ref_sha, a.written_at"
            f" FROM imported_artifacts a{where} ORDER BY a.id",
            params,
        )
    ]


def imports_source(name: str, bodies: list[ImportedBody]) -> dict[str, str]:
    """The manifest source for the imports a page printed.

    It names each body by path, bytes and the dates the label prints, so a new
    import changes it and a withdrawal, which removes a body from the list,
    changes it too.
    """

    return {
        f"db:{name}": sha256_json(
            [
                [b.path, b.kind, b.subsystem_id, b.body_sha256, b.hash_matches, b.ref_sha, b.written_at]
                for b in bodies
            ]
        )
    }


_H1 = re.compile(r"#[ \t]")


def imported_page(
    conn: sqlite3.Connection, kind: str, title: str
) -> tuple[str, dict[str, str]] | None:
    """A page of the three imported ones, or None when no body of its kind is printed.

    The page is the body as written, its headings where its author put them, with
    its label as the first thing under the page's heading (D1, §5.4). A body that
    does not open with a heading of its own is given the page's title. A second
    body of the same kind follows the first behind its own label, its headings
    moved beneath the page's.
    """

    bodies = imported_bodies(conn, kind=kind)
    if not bodies:
        return None
    out: list[str] = []
    for index, body in enumerate(bodies):
        text = body.body.strip()
        if index:
            out += [body.label(), "", nest_headings(text, 1), ""]
        elif _H1.match(text):
            heading, _, rest = text.partition("\n")
            out += [heading, "", body.label(), "", rest.strip(), ""]
        else:
            out += [f"# {title}", "", body.label(), "", text, ""]
    return "\n".join(out), imports_source(f"imports:{kind}", bodies)
