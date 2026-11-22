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
  the Markdown parser had, the record-list projections included, so a body prints
  as it always did. The parser (`_LegacyParser`) lives here and is called by nothing
  else: stored prose has its own, smaller grammar (`prose.py`), and every other page
  is built as a model.

A store that has not been opened by a server carrying the tables reads as one
with no imports.
"""

from __future__ import annotations

import html
import re
import sqlite3
from contextvars import ContextVar
from dataclasses import dataclass, replace
from typing import Any

from .db import rows, table_exists
from .manifest import sha256_json
from .page import (
    Anchor,
    Block,
    Chip,
    Code,
    ConcernChecklist,
    ConcernFamily,
    ConcernItem,
    DiagramSource,
    Fact,
    Heading,
    Inlines,
    LifecycleTable,
    Marked,
    Page,
    Paragraph,
    Quote,
    Record,
    RecordList,
    RecordMarker,
    RelationshipTrace,
    Row,
    RuntimeDiagram,
    RuntimeRow,
    Section,
    StalenessBars,
    SummaryItem,
    SummaryList,
    Table,
    TraceEdge,
    TraceNode,
)
from .prose import _LIST_ITEM, _parse_list, _plain, parse_inlines
from .slugs import slugify

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


#: The bodies one publication has read, by `(text, under, section, path)`, so the
#: read-back that follows the render compares a page with the blocks the page was
#: printed from rather than reading the body a second time (store-only PLAN §3.5).
#: A run sets it; outside a run each body is read when asked for.
RENDERED_BODIES: ContextVar[dict[tuple[str, int, str, str], tuple[Block, ...]] | None] = ContextVar(
    "rendered_bodies", default=None
)


def body_blocks(text: str, *, under: int, sections: tuple[str, ...], path: str) -> tuple[Block, ...]:
    """An imported body's blocks as this run read them under one of `sections`, else read now.

    The section names only its tables' captions, so any of the sections a page
    may print the body under gives the same words.
    """

    read = RENDERED_BODIES.get() or {}
    for section in sections:
        blocks = read.get((text, under, section, path))
        if blocks is not None:
            return blocks
    return render_body(text, under=under, section=sections[0], path=path)


def render_body(text: str, *, under: int, section: str, path: str) -> tuple[Block, ...]:
    """An imported body as page blocks, its headings moved `under` levels down.

    The body is full Markdown (headings, tables, fences, record-list tables), so
    it is read with the legacy block grammar, as it always was; this is the one
    place a page's blocks still come from Markdown. It is read as the content of
    a level-2 section titled `section`, which is what names its tables' captions,
    so the body prints exactly as it did when it sat inside that section of the
    page's Markdown. `under` must be 2 or more: a body whose headings reached
    level 2 would close the section it sits in.
    """

    if under < 2:
        raise ValueError("an imported body's headings must move beneath the section's own")
    read = RENDERED_BODIES.get()
    key = (text, under, section, path)
    if read is not None and key in read:
        return read[key]
    body = nest_headings(text.strip(), under)
    if not body.strip():
        return ()
    page = _LegacyParser(path).parse(f"## {section}\n\n{body}")
    held = page.blocks[0]
    assert isinstance(held, Section)
    out = list(held.blocks[1:])
    # A level-2 heading that survives the shift (one inside a `~~~` fence, which
    # the parser does not read as a fence) opens another section in the parser's
    # reading. Its content stays on the page, under the section it was written in.
    for later in page.blocks[1:]:
        out += later.blocks if isinstance(later, Section) else (later,)
    if read is not None:
        read[key] = tuple(out)
    return tuple(out)


#: The pages the imports of one kind are printed on, as `(page path, kind)`.
#: Master plan, findings index and field notes are held, not rendered (§5.4):
#: the pages already print the tables they duplicated.
IMPORTED_PAGES: tuple[tuple[str, str], ...] = (
    ("concern-checklist.html", "concern-checklist"),
    ("onboarding-report.html", "onboarding-report"),
    ("entry-point.html", "entry-point"),
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
    conn: sqlite3.Connection, kind: str, title: str, path: str
) -> tuple[Page, dict[str, str]] | None:
    """A page of the three imported ones, or None when no body of its kind is printed.

    The page is the body as written, its headings where its author put them, with
    its label as the first thing under the page's heading (D1, §5.4). A body that
    does not open with a heading of its own is given the page's title. A second
    body of the same kind follows the first behind its own label, its headings
    moved beneath the page's. The whole document is read once, as one page of
    `path`.
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
    page = _LegacyParser(path).parse("\n".join(out))
    page = replace(page, blocks=_mark_bodies(page.blocks, bodies))
    read = RENDERED_BODIES.get()
    if read is not None:
        read[_imported_page_key(bodies, path)] = page.blocks
    return page, imports_source(f"imports:{kind}", bodies)


def _imported_page_key(bodies: list[ImportedBody], path: str) -> tuple[str, int, str, str]:
    """What a run's memo holds an import-only page's blocks under: its bodies, labels and path."""

    return ("\0".join(f"{b.label()}\0{b.body}" for b in bodies), 0, "imported_page", path)


def imported_page_blocks(conn: sqlite3.Connection, kind: str, path: str) -> tuple[Block, ...]:
    """An import-only page's blocks as this run printed them, else read now (§3.5).

    The read-back compares the page with them. The page's title is not among the
    marked blocks, so a reading made here needs none.
    """

    bodies = imported_bodies(conn, kind=kind)
    read = RENDERED_BODIES.get() or {}
    held = read.get(_imported_page_key(bodies, path))
    if held is not None:
        return held
    built = imported_page(conn, kind, "Imported", path)
    return built[0].blocks if built is not None else ()


def _mark_bodies(blocks: tuple[Block, ...], bodies: list[ImportedBody]) -> tuple[Block, ...]:
    """Each body's blocks marked with its record (store-only PLAN §3.5), its label left unmarked.

    The document is read as one, so a body is found by the label paragraph printed
    before it, in order, and holds everything up to the next label. A second body's
    headings sit beneath the first's, inside its last section: that section is
    entered, its heading left outside the mark, since the cross-reference pass names
    a section by its heading.
    """

    labels = [Paragraph(parse_inlines(b.label())) for b in bodies]
    marks = [f"imported-body:{b.path}" for b in bodies]
    state = {"next": 0, "record": ""}

    def is_label(block: Block) -> bool:
        return state["next"] < len(labels) and block == labels[int(state["next"])]

    def holds_label(block: Block) -> bool:
        return isinstance(block, Section) and any(is_label(b) or holds_label(b) for b in block.blocks)

    def walk(items: tuple[Block, ...]) -> list[Block]:
        out: list[Block] = []
        run: list[Block] = []

        def flush() -> None:
            if run:
                record = str(state["record"])
                out.extend([Marked(record, "", tuple(run))] if record else run)
                run.clear()

        for block in items:
            if is_label(block):
                flush()
                out.append(block)
                state["record"] = marks[int(state["next"])]
                state["next"] = int(state["next"]) + 1
            elif holds_label(block):
                assert isinstance(block, Section)
                flush()
                head = block.blocks[:1] if block.blocks and isinstance(block.blocks[0], Heading) else ()
                out.append(replace(block, blocks=(*head, *walk(block.blocks[len(head) :]))))
            else:
                run.append(block)
        flush()
        return out

    return tuple(walk(blocks))


# ---------------------------------------------------------------------------
# The block grammar of an imported body.
#
# Imported bodies are whole documents an earlier version wrote by hand: headings,
# tables, fences, lists, quotes. They are read into the page model once, here. The
# table shapes below are the ones those documents carry and the page printed as
# records, not as tables: a survey narrative's key types and state containers, the
# onboarding report's runtime table, the concern checklist. Nothing else in the
# package reads Markdown.
# ---------------------------------------------------------------------------


def _split_table_row(line: str) -> list[str]:
    raw = line.strip().strip("|")
    cells = re.split(r"(?<!\\)\|", raw)
    return [cell.strip().replace("\\|", "|") for cell in cells]


def _is_table_separator(line: str) -> bool:
    cells = _split_table_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def _header_key(value: str) -> str:
    return re.sub(r"\s+", " ", _plain(value)).strip().lower()


@dataclass(frozen=True)
class _RecordTable:
    """How one known table shape of an imported body prints as records."""

    kind: str
    key: str
    metadata: tuple[str, ...]
    content: tuple[str, ...]


_RECORD_TABLES: dict[tuple[str, ...], _RecordTable] = {
    ("id", "status", "symptom", "why it matters", "root cause", "ref sha"): _RecordTable(
        "finding", "id", ("status", "ref sha"), ("symptom", "why it matters", "root cause")
    ),
    ("id", "status", "symptom", "root cause", "ref sha"): _RecordTable(
        "finding", "id", ("status", "ref sha"), ("symptom", "root cause")
    ),
    ("path", "classification", "why in scope", "ref sha"): _RecordTable(
        "file-ledger", "path", ("classification", "ref sha"), ("why in scope",)
    ),
    ("concern", "classification", "evidence quality", "linchpin?", "rationale"): _RecordTable(
        "concern-disposition",
        "concern",
        ("classification", "evidence quality", "linchpin?"),
        ("rationale",),
    ),
    ("symbol", "role", "source"): _RecordTable("structural-inventory", "symbol", ("source",), ("role",)),
    ("priority", "id", "name", "status", "purpose", "scope", "jump-in", "findings"): _RecordTable(
        "subsystem",
        "name",
        ("id", "status", "findings", "priority"),
        ("purpose", "scope", "jump-in"),
    ),
    ("code", "category", "origin", "discovered in", "notes"): _RecordTable(
        "concern", "code", ("category", "origin", "discovered in"), ("notes",)
    ),
    ("code", "category", "discovered in", "notes"): _RecordTable(
        "concern", "code", ("category", "discovered in"), ("notes",)
    ),
    ("territory", "verdict", "derived", "rationale"): _RecordTable(
        "territory", "territory", ("verdict", "derived"), ("rationale",)
    ),
    ("id", "sev", "subsystem", "one-line"): _RecordTable(
        "finding-summary", "id", ("sev", "subsystem"), ("one-line",)
    ),
    ("#", "category", "question", "resolution", "answer"): _RecordTable(
        "open-question", "#", ("category", "resolution"), ("question", "answer")
    ),
    ("seam", "shared object", "kind", "parties", "assessable?", "notes"): _RecordTable(
        "seam", "seam", ("kind", "parties", "assessable?"), ("shared object", "notes")
    ),
}

_SUMMARY_TABLES = {
    ("metric", "value"),
    ("status", "what it means"),
    ("status", "what claims are authorized"),
    ("mapping status", "authorized claims"),
    ("quality", "what it means"),
    ("severity", "typical shape"),
    ("task", "start here"),
    ("if you're here because…", "start here"),
    ("prefix", "maps"),
    ("exit", "meaning"),
    ("territory", "attenuating condition"),
}

_LIFECYCLE_TABLES = {
    ("name", "location", "stores", "lifetime", "populated by", "invalidated by"),
    ("name", "location", "what it stores", "lifetime", "populated by", "invalidated by"),
}

# The onboarding report's runtime table, which drew the runtime diagram, and the
# concern checklist's table, which printed as concerns grouped by category.
_RUNTIME_TABLE = ("runtime / process", "language", "communicates with", "mechanism", "notes")
_CHECKLIST_TABLE = (
    "code",
    "category",
    "territory",
    "codebase-specific probe (abbreviated)",
    "primary subsystems",
)
_CHECKLIST_PAGE = "concern-checklist.html"


def _trace_name(record_id: str, label: str) -> str:
    name = re.sub(r"<br\s*/?>", " ", label, flags=re.IGNORECASE)
    name = html.unescape(name).strip()
    if name.startswith(record_id):
        name = name[len(record_id) :].strip()
    return name


def _parse_mermaid(source: str) -> Block:
    lines = [line.strip() for line in source.splitlines() if line.strip()]
    if lines and lines[0].startswith("graph "):
        nodes: dict[str, tuple[str, str]] = {}
        edges: list[tuple[str, str, str, str]] = []
        for line in lines[1:]:
            node = re.fullmatch(r'(\w+)\["(.+?)"\]', line)
            if node:
                label = node.group(2)
                record = re.split(r"<br\s*/?>", label, flags=re.IGNORECASE)[0]
                nodes[node.group(1)] = (record, label)
                continue
            edge = re.fullmatch(r'(\w+)\s+(-->|<-->)\|"?(.+?)"?\|\s+(\w+)', line)
            if edge:
                edges.append((edge.group(1), edge.group(2), edge.group(3), edge.group(4)))
        if edges:
            traced: list[TraceEdge] = []
            for left, arrow, edge_label, right in edges:
                left_id, left_label = nodes.get(left, (left, left))
                right_id, right_label = nodes.get(right, (right, right))
                traced.append(
                    TraceEdge(
                        TraceNode(left_id, _trace_name(left_id, left_label)),
                        TraceNode(right_id, _trace_name(right_id, right_label)),
                        re.sub(r"<br\s*/?>", " · ", edge_label, flags=re.IGNORECASE).strip('"'),
                        arrow == "<-->",
                    )
                )
            return RelationshipTrace(tuple(traced))
    if lines and lines[0] == "pie showData":
        values: list[tuple[str, float]] = []
        for line in lines[1:]:
            match = re.fullmatch(r'"(.+?)"\s*:\s*([0-9.]+)', line)
            if match:
                values.append((match.group(1), float(match.group(2))))
        if values:
            return StalenessBars(tuple(values))
    return DiagramSource(source)


class _LegacyParser:
    """One imported body's Markdown, read into page blocks."""

    def __init__(self, current_html_path: str) -> None:
        self.current_html_path = current_html_path

    @staticmethod
    def _records(
        headers: list[str],
        rows: list[tuple[list[str], list[str]]],
        caption: str,
        projection: _RecordTable,
    ) -> RecordList:
        keys = [_header_key(header) for header in headers]
        records: list[Record] = []
        for row_number, (values, markers) in enumerate(rows, start=1):
            record = dict(zip(keys, values, strict=True))
            key_raw = record[projection.key]
            key_text = _plain(key_raw) or f"Record {row_number}"
            # A concern's anchor is its code, not the "concern RC-2" the cross-reference
            # pass prints before it.
            anchor_text = (
                re.sub(r"^concern\s+", "", key_text)
                if projection.kind == "concern-disposition"
                else key_text
            )
            facts: list[Fact] = []
            if projection.kind == "file-ledger":
                facts.append(Fact("path", parse_inlines(key_raw)))
            for key in projection.metadata:
                value = record.get(key, "")
                if not _plain(value):
                    continue
                if projection.kind == "finding" and key == "status":
                    facts.append(
                        Fact(key, Inlines((Chip("status", _plain(value), show_hint=False),), _plain(value)))
                    )
                else:
                    facts.append(Fact(key, parse_inlines(value)))

            lede: Inlines | None = None
            fields: list[Fact] = []
            if projection.kind == "finding":
                parts = re.split(r"(?<=[.!?])\s+", record["symptom"], maxsplit=1)
                lede = parse_inlines(parts[0])
                if len(parts) == 2 and _plain(parts[1]):
                    fields.append(Fact("observed behavior", parse_inlines(parts[1])))
                if _plain(record.get("why it matters", "")):
                    fields.append(Fact("why it matters", parse_inlines(record["why it matters"])))
                fields.append(Fact("root cause", parse_inlines(record["root cause"])))
            else:
                for key in projection.content:
                    value = record.get(key, "")
                    if _plain(value):
                        fields.append(Fact(key, parse_inlines(value)))
            records.append(
                Record(
                    markers=tuple(markers),
                    key=parse_inlines(key_raw),
                    key_text=key_text,
                    slug_text=_plain(f"{projection.kind}-{anchor_text}"),
                    facts=tuple(facts),
                    fields=tuple(fields),
                    lede=lede,
                    path=_plain(key_raw),
                    revision=_plain(record.get("ref sha", "")),
                    subsystem_id=_plain(record.get("id", "")),
                )
            )
        return RecordList(projection.kind, caption, tuple(records))

    @staticmethod
    def _checklist(
        headers: list[str],
        rows: list[tuple[list[str], list[str]]],
        caption: str,
    ) -> ConcernChecklist:
        """The calibrated concern table, grouped by category and territory."""

        keys = [_header_key(header) for header in headers]
        groups: dict[tuple[str, str], list[tuple[dict[str, str], list[str]]]] = {}
        for values, markers in rows:
            record = dict(zip(keys, values, strict=True))
            group_key = (_plain(record["category"]), _plain(record["territory"]))
            groups.setdefault(group_key, []).append((record, markers))

        families: list[ConcernFamily] = []
        for (category, territory), records in groups.items():
            family_name = category.replace("-", " ").capitalize()
            items: list[ConcernItem] = []
            for row_number, (record, markers) in enumerate(records, start=1):
                code_raw = record["code"]
                code_text = _plain(code_raw) or f"Concern {row_number}"
                items.append(
                    ConcernItem(
                        code=parse_inlines(code_raw),
                        code_text=code_text,
                        slug_text=_plain(f"concern-checklist-{code_text}"),
                        primary_subsystems=parse_inlines(record.get("primary subsystems", "")),
                        probe=parse_inlines(record.get("codebase-specific probe (abbreviated)", "")),
                        markers=tuple(markers),
                    )
                )
            families.append(
                ConcernFamily(
                    name=family_name,
                    territory=territory,
                    slug_text=_plain(f"{family_name} concerns"),
                    items=tuple(items),
                )
            )
        return ConcernChecklist(caption, tuple(families))

    def _table(
        self,
        headers: list[str],
        rows: list[tuple[list[str], list[str]]],
        caption: str,
    ) -> Block:
        signature = tuple(_header_key(header) for header in headers)
        if signature == _RUNTIME_TABLE:
            return RuntimeDiagram(
                caption,
                tuple(
                    RuntimeRow(*(parse_inlines(value) for value in values[:5]), markers=tuple(markers))
                    for values, markers in rows
                ),
            )
        if signature == _CHECKLIST_TABLE:
            return self._checklist(headers, rows, caption)
        projection = _RECORD_TABLES.get(signature)
        if projection:
            return self._records(headers, rows, caption, projection)
        if signature in _SUMMARY_TABLES:
            return SummaryList(
                caption,
                tuple(
                    SummaryItem(parse_inlines(values[0]), parse_inlines(values[1]), tuple(markers))
                    for values, markers in rows
                ),
            )
        table_rows = [
            Row(tuple(parse_inlines(value) for value in values), tuple(markers)) for values, markers in rows
        ]
        kind = LifecycleTable if signature in _LIFECYCLE_TABLES else Table
        return kind(caption, tuple(parse_inlines(header) for header in headers), tuple(table_rows))

    def parse(self, markdown: str) -> Page:
        lines = markdown.splitlines()
        title = "Conspectus"
        root: list[Block] = []
        section: tuple[str, list[Block]] | None = None
        current_section = ""

        def target() -> list[Block]:
            return section[1] if section is not None else root

        def close_section() -> None:
            nonlocal section
            if section is not None:
                root.append(Section(section[0], tuple(section[1])))
            section = None

        i = 0
        while i < len(lines):
            line = lines[i]
            if not line.strip():
                i += 1
                continue

            if line.startswith("<!--") and line.rstrip().endswith("-->"):
                target().append(RecordMarker(line))
                i += 1
                continue

            anchor = re.fullmatch(r'<a\s+id="([a-zA-Z0-9_.:-]+)"></a>', line.strip())
            if anchor:
                target().append(Anchor(anchor.group(1)))
                i += 1
                continue

            fence = re.match(r"^```\s*([\w-]*)\s*$", line)
            if fence:
                language = fence.group(1).lower()
                code_lines: list[str] = []
                i += 1
                while i < len(lines) and not lines[i].startswith("```"):
                    code_lines.append(lines[i])
                    i += 1
                i += 1 if i < len(lines) else 0
                source = "\n".join(code_lines)
                target().append(_parse_mermaid(source) if language == "mermaid" else Code(language, source))
                continue

            heading = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
            if heading:
                level = len(heading.group(1))
                raw = heading.group(2)
                if level == 1:
                    title = _plain(raw)
                    i += 1
                    continue
                display_raw = raw
                if (
                    self.current_html_path == _CHECKLIST_PAGE
                    and level == 2
                    and re.fullmatch(r"Active concerns(?:\s+\(\d+\))?", _plain(raw), re.IGNORECASE)
                ):
                    display_raw = "Active concerns"
                if level == 2:
                    close_section()
                    current_section = slugify(_plain(display_raw))
                    section = (current_section, [])
                target().append(Heading(level, parse_inlines(display_raw)))
                i += 1
                continue

            if line.startswith("|") and i + 1 < len(lines) and _is_table_separator(lines[i + 1]):
                headers = _split_table_row(line)
                i += 2
                rows: list[tuple[list[str], list[str]]] = []
                pending_markers: list[str] = []
                while i < len(lines):
                    if lines[i].startswith("<!--") and lines[i].rstrip().endswith("-->"):
                        pending_markers.append(lines[i])
                        i += 1
                        continue
                    if not lines[i].startswith("|"):
                        break
                    rows.append((_split_table_row(lines[i]), pending_markers))
                    pending_markers = []
                    i += 1
                # A table before the first `##` has no section to name it; the
                # body's own title is a true caption.
                caption = current_section.replace("-", " ") or title or "Data"
                normalized_rows = []
                for values, markers in rows:
                    values += [""] * max(0, len(headers) - len(values))
                    normalized_rows.append((values[: len(headers)], markers))
                target().append(self._table(headers, normalized_rows, caption))
                continue

            if _LIST_ITEM.match(line):
                parsed, i = _parse_list(lines, i)
                target().append(parsed)
                continue

            if line.startswith(">"):
                quoted: list[str] = []
                while i < len(lines) and lines[i].startswith(">"):
                    quoted.append(lines[i][1:].lstrip())
                    i += 1
                target().append(Quote(parse_inlines(" ".join(quoted))))
                continue

            paragraph = [line.strip()]
            i += 1
            while i < len(lines) and lines[i].strip():
                candidate = lines[i]
                if (
                    re.match(r"^(#{1,6})\s+", candidate)
                    or candidate.startswith(("```", "|", ">", "<!--", '<a id="'))
                    or re.match(r"^\s*([-*+] |\d+\. )", candidate)
                ):
                    break
                paragraph.append(candidate.strip())
                i += 1
            target().append(Paragraph(parse_inlines(" ".join(paragraph))))

        close_section()
        return Page(title, self.current_html_path, tuple(root))
